import {
  CommandId,
  type ModelSelection,
  OrchestratorMcpFailure,
  type OrchestratorMcpDelegateTaskInput,
  type OrchestratorMcpThreadWaitInput,
  type OrchestratorMcpThreadWaitResult,
  type OrchestrationV2AppThread,
  type OrchestrationV2Run,
  type OrchestrationV2Subagent,
  MessageId,
  type ProjectId,
  type RunId,
  ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DiskGuard from "../diskGuard.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { resolveInteractionMode, resolveRuntimeMode } from "../mcp/delegatedTaskModes.ts";
import { runOutcome } from "../orchestration-v2/RestartBackgroundNote.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";

/** Tasks a bot may start after the user last spoke, so tasks waking it cannot run away. */
export const BOT_TASKS_PER_USER_MESSAGE = 20;
const RUNS_SCANNED = 40;

const unavailable = (action: string) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: `Unable to ${action}.` });

/**
 * What RemoteDelegation does through a link, for a task whose thread runs on this machine.
 * A link needs none of this: its calls arrive as the tools these mirror.
 */
export class HereTaskThreads extends Context.Service<
  HereTaskThreads,
  {
    readonly assertMayDelegate: (
      parent: {
        readonly thread: OrchestrationV2AppThread;
        readonly runs: ReadonlyArray<OrchestrationV2Run>;
      },
      tasks: ReadonlyArray<OrchestrationV2Subagent>,
    ) => Effect.Effect<void, OrchestratorMcpFailure>;
    readonly launch: (request: {
      readonly parent: OrchestrationV2AppThread;
      readonly projectId: ProjectId;
      readonly input: OrchestratorMcpDelegateTaskInput;
      readonly task: string;
      readonly key: string;
      readonly requestNamespace: string;
    }) => Effect.Effect<
      {
        readonly threadId: ThreadId;
        readonly runId: RunId | null;
        readonly modelSelection: ModelSelection;
        readonly projectTitle: string;
      },
      OrchestratorMcpFailure
    >;
    readonly waitForThread: (
      input: OrchestratorMcpThreadWaitInput,
    ) => Effect.Effect<OrchestratorMcpThreadWaitResult, OrchestratorMcpFailure>;
    readonly lastReply: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId | null;
      readonly failed: boolean;
    }) => Effect.Effect<string | undefined, OrchestratorMcpFailure>;
    readonly stop: (input: {
      readonly threadId: ThreadId;
      readonly key: string;
      readonly reason?: string | undefined;
    }) => Effect.Effect<void, OrchestratorMcpFailure>;
  }
>()("t3/peer/HereTaskThreads") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const projects = yield* ProjectService.ProjectService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const settings = yield* ServerSettings.ServerSettingsService;
  const diskGuard = yield* DiskGuard.DiskGuard;
  const hereId = yield* ServerEnvironment.ServerEnvironment.pipe(
    Effect.flatMap((environment) => environment.getEnvironmentId),
  );

  const assertMayDelegate: HereTaskThreads["Service"]["assertMayDelegate"] = Effect.fn(
    "HereTaskThreads.assertMayDelegate",
  )(function* (parent, tasks) {
    const recent = parent.runs.toSorted((a, b) => b.ordinal - a.ordinal).slice(0, RUNS_SCANNED);
    const { messages } = yield* threads
      .getThreadRecords(parent.thread.id, ["messages"], {
        messageIds: recent.map((run) => run.userMessageId),
      })
      .pipe(Effect.mapError(() => unavailable("read the thread")));
    const fromUser = new Set(
      messages.filter((message) => message.createdBy === "user").map((message) => message.id),
    );
    const lastAsked = recent.find((run) => fromUser.has(run.userMessageId))?.requestedAt;
    const since = tasks.filter(
      (task) =>
        lastAsked === undefined ||
        task.startedAt === null ||
        DateTime.isGreaterThanOrEqualTo(task.startedAt, lastAsked),
    );
    if (since.length >= BOT_TASKS_PER_USER_MESSAGE) {
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: `You started ${since.length} tasks since the user last spoke. Stop and tell the user what is happening; ask before starting more.`,
      });
    }
  });

  const launch: HereTaskThreads["Service"]["launch"] = Effect.fn("HereTaskThreads.launch")(
    function* ({ parent, projectId, input, task, key, requestNamespace }) {
      const project = yield* projects.getById(projectId).pipe(
        Effect.mapError(() => unavailable("read the project")),
        Effect.map(Option.getOrUndefined),
      );
      if (project === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `Project ${projectId} was not found. t3_project_list lists them.`,
        });
      }
      const available = yield* providers.getProviders;
      const projectSettings = resolveProjectSettings(
        yield* settings.getSettings.pipe(Effect.mapError(() => unavailable("read settings"))),
        projectId,
        project,
      ).settings;
      // A bot runs on a light model; its work runs on what the project normally uses.
      const defaults =
        project.defaultModelSelection ??
        resolveNewThreadModelSelection({
          defaultSelection: projectSettings.defaultModelSelection,
          fallbackSelection: projectSettings.fallbackModelSelection,
          providers: available,
          settings: projectSettings,
          projectId,
          now: DateTime.toEpochMillis(yield* DateTime.now),
        }).selection;
      const instanceId = input.target?.providerInstanceId ?? defaults?.instanceId;
      const model =
        input.target?.model ?? (instanceId === defaults?.instanceId ? defaults?.model : undefined);
      if (instanceId === undefined || model === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "target_required",
          message:
            "Pass target.providerInstanceId and target.model: this project has no default. orchestrator_capabilities lists them.",
        });
      }
      const options =
        input.target?.options ??
        (instanceId === defaults?.instanceId && model === defaults?.model
          ? defaults?.options
          : undefined);
      const modelSelection = { instanceId, model, ...(options === undefined ? {} : { options }) };
      const runtimeMode = yield* resolveRuntimeMode(parent.runtimeMode, input.runtimeMode, {
        modelSelection,
        supportedRuntimeModes: available.find((provider) => provider.instanceId === instanceId)
          ?.supportedRuntimeModes,
      });
      const interactionMode = yield* resolveInteractionMode(
        parent.interactionMode,
        input.interactionMode,
      );
      if (input.isolation === "worktree")
        yield* diskGuard.ensureRoomForWorktree.pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({
                code: "orchestration_error",
                message: `${error.message} Tell the user, and start no worktree task until they free space.`,
              }),
          ),
        );
      const commandId = CommandId.make(
        `command:bot-task:${encodeURIComponent(requestNamespace)}:${encodeURIComponent(key)}`,
      );
      const messageId = MessageId.make(commandId);
      const result = yield* launches
        .launch({
          commandId,
          threadId: ThreadId.make(commandId),
          projectId,
          title: input.title ?? task.slice(0, 60).trim(),
          modelSelection,
          runtimeMode,
          interactionMode,
          workspaceStrategy:
            input.isolation === "worktree"
              ? { type: "worktree", baseRef: "HEAD", startFromOrigin: false }
              : { type: "root" },
          initialMessage: { messageId, senderThreadId: parent.id, text: task, attachments: [] },
          createdBy: "agent",
          creationSource: "mcp",
          // The project thread shows which bot started it, and storage cleanup reclaims it.
          delegatedFrom: { environmentId: hereId, threadId: parent.id, title: parent.title },
        })
        .pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("here-task-threads.launch-failed", { projectId, cause }),
          ),
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({
                code: "orchestration_error",
                message: `Unable to start the task in ${project.title}: ${error.message}`,
              }),
          ),
        );
      return {
        threadId: result.projection.thread.id,
        runId: result.projection.runs.find((run) => run.userMessageId === messageId)?.id ?? null,
        modelSelection,
        projectTitle: project.title,
      };
    },
  );

  const waitForThread: HereTaskThreads["Service"]["waitForThread"] = Effect.fn(
    "HereTaskThreads.waitForThread",
  )(function* (input) {
    const { thread } = yield* threads.getThreadRecords(input.threadId, []).pipe(
      Effect.mapError(
        () =>
          new OrchestratorMcpFailure({
            code: "thread_not_found",
            message: `Thread ${input.threadId} was not found.`,
          }),
      ),
    );
    const result = yield* threads
      .waitForThread({
        projectId: thread.projectId,
        threadId: input.threadId,
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        timeoutMs: input.timeoutMs ?? 600_000,
        ...(input.untilDelegatedWorkSettled === true ? { untilDelegatedWorkSettled: true } : {}),
      })
      .pipe(Effect.mapError(() => unavailable("wait for the thread")));
    return {
      threadId: input.threadId,
      runId: result.run?.id ?? null,
      status: result.run === null ? "idle" : runOutcome(result.run),
      timedOut: result.timedOut,
      ...(result.resultRun === undefined
        ? {}
        : { resultRun: { runId: result.resultRun.id, status: runOutcome(result.resultRun) } }),
    } satisfies OrchestratorMcpThreadWaitResult;
  });

  const lastReply: HereTaskThreads["Service"]["lastReply"] = Effect.fn("HereTaskThreads.lastReply")(
    function* ({ threadId, runId, failed }) {
      const { messages, turnItems } = yield* threads
        .getThreadRecords(threadId, ["messages", "turnItems"], {
          turnItemTypes: ["error"],
        })
        .pipe(Effect.mapError(() => unavailable("read the thread")));
      const ofRun = <T extends { readonly runId: RunId | null }>(item: T) =>
        runId === null || item.runId === runId;
      const error = failed ? turnItems.filter(ofRun).at(-1) : undefined;
      if (error?.type === "error") return error.failure.message;
      return messages.filter((message) => message.role === "assistant" && ofRun(message)).at(-1)
        ?.text;
    },
  );

  const stop: HereTaskThreads["Service"]["stop"] = Effect.fn("HereTaskThreads.stop")(function* ({
    threadId,
    key,
    reason,
  }) {
    const commandId = CommandId.make(
      `command:bot-task-stop:${encodeURIComponent(threadId)}:${encodeURIComponent(key)}`,
    );
    yield* threads
      .dispatch({
        type: "thread.stop",
        commandId,
        threadId,
        ...(reason === undefined ? {} : { reason }),
      })
      .pipe(
        Effect.andThen(threads.stopDelegatedTasks({ threadId, commandId, reason })),
        Effect.mapError(() => unavailable(`stop thread ${threadId}`)),
      );
  });

  return HereTaskThreads.of({ assertMayDelegate, launch, waitForThread, lastReply, stop });
});

export const layer = Layer.effect(HereTaskThreads, make);
