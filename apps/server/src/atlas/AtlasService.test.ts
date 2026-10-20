import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  AtlasDependencyNotApprovedError,
  AtlasInitiativeBusyError,
  AtlasInitiativeNotFoundError,
  AtlasIssuePublishError,
  AtlasInitiative as AtlasInitiativeSchema,
  AtlasPlanImportError,
  AtlasPlanRevisionConflictError,
  AtlasPlanValidationError,
  AtlasProviderLaunchError,
  AtlasProjectBusyError,
  AtlasTaskNotRunnableError,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type AtlasInitiative,
  type AtlasPlanDraft,
  type AtlasTaskDraft,
  type OrchestrationV2ThreadProjection,
  type Project,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { ExitCode } from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as AtlasService from "./AtlasService.ts";
import * as AtlasStore from "./AtlasStore.ts";

const isAtlasDependencyNotApprovedError = Schema.is(AtlasDependencyNotApprovedError);
const isAtlasInitiativeBusyError = Schema.is(AtlasInitiativeBusyError);
const isAtlasInitiativeNotFoundError = Schema.is(AtlasInitiativeNotFoundError);
const isAtlasIssuePublishError = Schema.is(AtlasIssuePublishError);
const isAtlasPlanImportError = Schema.is(AtlasPlanImportError);
const isAtlasPlanValidationError = Schema.is(AtlasPlanValidationError);
const isAtlasPlanRevisionConflictError = Schema.is(AtlasPlanRevisionConflictError);
const decodeInitiative = Schema.decodeUnknownSync(AtlasInitiativeSchema);
const isAtlasProjectBusyError = Schema.is(AtlasProjectBusyError);
const isAtlasProviderLaunchError = Schema.is(AtlasProviderLaunchError);
const isAtlasTaskNotRunnableError = Schema.is(AtlasTaskNotRunnableError);

const projectId = ProjectId.make("project:atlas-test");
const createdAt = "2026-01-01T00:00:00.000Z";
const runTime = DateTime.makeUnsafe(createdAt);
const laterRunTime = DateTime.makeUnsafe("2026-01-01T00:00:05.000Z");

const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.1-codex",
};

const projectionRun = (
  threadId: ThreadId,
  id: RunId,
  ordinal: number,
  status: "running" | "completed",
  completedAt: DateTime.Utc | null,
) =>
  ({
    id,
    threadId,
    ordinal,
    status,
    requestedAt: runTime,
    startedAt: runTime,
    completedAt,
  }) as unknown as OrchestrationV2ThreadProjection["runs"][number];

const projectionMessage = (runId: RunId, text: string) =>
  ({
    runId,
    role: "assistant",
    text,
  }) as unknown as OrchestrationV2ThreadProjection["messages"][number];

const projectionSubagent = (status: "running" | "completed", delivery?: "pending" | "delivered") =>
  ({
    status,
    ...(delivery === undefined
      ? {}
      : { completionDelivery: { state: delivery, observedByRunId: null } }),
  }) as unknown as OrchestrationV2ThreadProjection["subagents"][number];

const projectionProviderThread = (pending: boolean) =>
  ({
    pendingBackgroundTasks: pending ? [{ taskId: "bg-1", kind: "command" }] : [],
  }) as unknown as OrchestrationV2ThreadProjection["providerThreads"][number];

const threadProjection = (input: {
  readonly threadId: ThreadId;
  readonly thread?: { readonly worktreePath: string | null; readonly branch: string | null };
  readonly runs: OrchestrationV2ThreadProjection["runs"];
  readonly messages: OrchestrationV2ThreadProjection["messages"];
  readonly subagents?: OrchestrationV2ThreadProjection["subagents"];
  readonly providerThreads?: OrchestrationV2ThreadProjection["providerThreads"];
}) =>
  ({
    thread: {
      id: input.threadId,
      projectId,
      worktreePath: input.thread?.worktreePath ?? null,
      branch: input.thread?.branch ?? null,
    },
    runs: input.runs,
    messages: input.messages,
    subagents: input.subagents ?? [],
    providerThreads: input.providerThreads ?? [],
  }) as unknown as OrchestrationV2ThreadProjection;

const project: Project = {
  id: projectId,
  title: "Atlas Project",
  workspaceRoot: "/tmp/atlas-project",
  repositoryIdentity: null,
  faviconPath: null,
  projectIcon: null,
  defaultModelSelection: modelSelection,
  defaultThreadEnvMode: null,
  autoPull: false,
  scripts: [],
  createdAt,
  updatedAt: createdAt,
  deletedAt: null,
};

const runOptions = {
  modelSelection,
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
};

const draft = (key: string, overrides: Partial<AtlasTaskDraft> = {}): AtlasTaskDraft => ({
  key,
  title: `Task ${key}`,
  description: `Implement ${key}`,
  specialty: "backend",
  acceptanceCriteria: [`${key} works`],
  dependsOn: [],
  ...overrides,
});

const plan = (...tasks: ReadonlyArray<AtlasTaskDraft>): AtlasPlanDraft => ({
  summary: "Plan summary",
  tasks,
});

const processOutput = (
  stdout: string,
  options: { readonly code?: number; readonly stderr?: string } = {},
): ProcessRunner.ProcessRunOutput => ({
  stdout,
  stderr: options.stderr ?? "",
  code: ExitCode(options.code ?? 0),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

interface FakeRun {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  status: "running" | "completed" | "failed" | "interrupted" | "cancelled";
  result: string | null;
}

interface LaunchCall {
  readonly input: ThreadLaunchService.ThreadLaunchInput;
  readonly threadId: ThreadId;
  readonly runId: RunId;
}

function makeHarness() {
  const runs = new Map<ThreadId, FakeRun>();
  const threads = new Map<
    ThreadId,
    { readonly worktreePath: string | null; readonly branch: string | null }
  >();
  const projections = new Map<ThreadId, OrchestrationV2ThreadProjection>();
  const projectionFailures = new Map<ThreadId, "transient" | "notfound">();
  const launchCalls: Array<LaunchCall> = [];
  const processCalls: Array<ProcessRunner.ProcessRunInput> = [];
  const state = {
    failNextLaunch: false,
    failNextIssue: false,
    issueListJson: "[]",
    launchThread: null as {
      readonly worktreePath: string | null;
      readonly branch: string | null;
    } | null,
  };
  let launchSequence = 0;
  let launchGate: Effect.Effect<void> | null = null;

  const launch = (input: ThreadLaunchService.ThreadLaunchInput) => {
    launchSequence += 1;
    const threadId = ThreadId.make(`thread:atlas:${launchSequence}`);
    const runId = RunId.make(`run:atlas:${launchSequence}`);
    launchCalls.push({ input, threadId, runId });

    if (state.failNextLaunch) {
      state.failNextLaunch = false;
      return Effect.fail(
        new ThreadLaunchService.ThreadLaunchError({
          operation: "create-thread",
          commandId: input.commandId,
          projectId: input.projectId,
          cause: new Error("simulated launch failure"),
        }),
      );
    }

    runs.set(threadId, { threadId, runId, status: "running", result: null });
    const launchedThread =
      input.workspaceStrategy.type === "root"
        ? { worktreePath: null, branch: null }
        : input.workspaceStrategy.type === "existing_worktree"
          ? {
              worktreePath: input.workspaceStrategy.worktreePath,
              branch: input.workspaceStrategy.branch ?? null,
            }
          : {
              worktreePath: "/tmp/atlas-worktree",
              branch: input.workspaceStrategy.branch ?? null,
            };
    const thread = state.launchThread ?? launchedThread;
    threads.set(threadId, thread);
    const result = {
      threadId,
      projection: {
        thread,
        runs: [
          {
            id: runId,
            threadId,
            ordinal: 1,
            status: "running",
            requestedAt: runTime,
            startedAt: runTime,
            completedAt: null,
          },
        ],
      } as unknown as OrchestrationV2ThreadProjection,
      resumed: false,
    } satisfies ThreadLaunchService.ThreadLaunchResult;

    return launchGate === null ? Effect.succeed(result) : launchGate.pipe(Effect.as(result));
  };

  const getThreadProjection = (threadId: ThreadId) => {
    const failure = projectionFailures.get(threadId);
    if (failure !== undefined) {
      return Effect.fail(
        new Orchestrator.OrchestratorProjectionError({
          threadId,
          cause:
            failure === "notfound"
              ? new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId })
              : new Error("transient projection read failure"),
        }),
      );
    }
    const override = projections.get(threadId);
    if (override !== undefined) return Effect.succeed(override);
    const run = runs.get(threadId);
    const thread = threads.get(threadId);
    return Effect.succeed({
      thread: {
        id: threadId,
        projectId,
        worktreePath: thread?.worktreePath ?? null,
        branch: thread?.branch ?? null,
      },
      runs:
        run === undefined
          ? []
          : [
              {
                id: run.runId,
                threadId,
                ordinal: 1,
                status: run.status,
                requestedAt: runTime,
                startedAt: runTime,
                completedAt: run.status === "running" ? null : runTime,
              },
            ],
      messages:
        run === undefined || run.result === null
          ? []
          : [{ runId: run.runId, role: "assistant", text: run.result }],
      subagents: [],
      providerThreads: [],
    } as unknown as OrchestrationV2ThreadProjection);
  };

  const runProcess = (input: ProcessRunner.ProcessRunInput) => {
    processCalls.push(input);
    if (input.command === "git") {
      return Effect.succeed(processOutput("git@github.com:acme/repo.git\n"));
    }
    if (input.command === "gh") {
      if (state.failNextIssue) {
        state.failNextIssue = false;
        return Effect.succeed(processOutput("", { code: 1, stderr: "issue publish failed" }));
      }
      if (input.args[1] === "list") {
        return Effect.succeed(processOutput(state.issueListJson));
      }
      return Effect.succeed(processOutput("https://github.com/acme/repo/issues/42\n"));
    }
    return Effect.succeed(processOutput(""));
  };

  const layer = Layer.provideMerge(
    AtlasService.layer,
    Layer.mergeAll(
      Layer.provideMerge(AtlasStore.layer, SqlitePersistence.layerMemory),
      Layer.mock(ProjectService.ProjectService)({
        getById: (id) => Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
      }),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({ launch }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({ getThreadProjection }),
      Layer.mock(ProcessRunner.ProcessRunner)({ run: runProcess }),
      NodeCrypto.layer,
      Path.layer,
    ),
  );

  return {
    layer,
    state,
    launchCalls,
    processCalls,
    setLaunchGate: (gate: Effect.Effect<void> | null) => {
      launchGate = gate;
    },
    setProjection: (threadId: ThreadId, projection: OrchestrationV2ThreadProjection) => {
      projections.set(threadId, projection);
    },
    setProjectionFailure: (threadId: ThreadId, failure: "transient" | "notfound") => {
      projectionFailures.set(threadId, failure);
    },
    clearProjectionFailure: (threadId: ThreadId) => {
      projectionFailures.delete(threadId);
    },
    complete: (
      threadId: ThreadId,
      result: string,
      status: "completed" | "failed" | "interrupted" | "cancelled" = "completed",
    ) => {
      const run = runs.get(threadId);
      if (run === undefined) throw new Error(`Unknown launch thread ${threadId}.`);
      run.status = status;
      run.result = result;
    },
  };
}

type Harness = ReturnType<typeof makeHarness>;

const ghSubcommandCalls = (harness: Harness, subcommand: string) =>
  harness.processCalls.filter((call) => call.command === "gh" && call.args[1] === subcommand)
    .length;

const taskByTitle = (initiative: AtlasInitiative, title: string) => {
  const task = initiative.tasks.find((candidate) => candidate.title === title);
  assert.isDefined(task, `expected a task titled ${title}`);
  return task!;
};

const createInitiative = (service: AtlasService.AtlasService["Service"]) =>
  service.createInitiative({
    projectId,
    title: "Ship Atlas",
    brief: "Build the feature end to end.",
    deliverables: ["Everything works."],
  });

const importSingleTask = (
  service: AtlasService.AtlasService["Service"],
  initiativeId: AtlasInitiative["id"],
) => service.importPlan({ initiativeId, plan: plan(draft("only")) });

const executeOnlyTask = (
  service: AtlasService.AtlasService["Service"],
  initiativeId: AtlasInitiative["id"],
  taskId: AtlasInitiative["tasks"][number]["id"],
) =>
  service.executeTask({
    initiativeId,
    taskId,
    ...runOptions,
  });

const setupReviewableTask = (service: AtlasService.AtlasService["Service"], harness: Harness) =>
  Effect.gen(function* () {
    const created = yield* createInitiative(service);
    const imported = yield* importSingleTask(service, created.id);
    const taskId = imported.tasks[0]!.id;
    const executed = yield* executeOnlyTask(service, created.id, taskId);
    harness.complete(executed.tasks[0]!.execution!.threadId, "Implemented the task");
    const initiative = yield* service.refreshInitiative({ initiativeId: created.id });
    return { initiativeId: created.id, taskId, initiative, task: initiative.tasks[0]! };
  });

it.effect("persists initiative create, update, list, get, and delete through the store", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const store = yield* AtlasStore.AtlasStore;

    const created = yield* createInitiative(service);
    assert.equal(created.status, "draft");
    assert.equal(created.planner.status, "idle");
    assert.deepEqual(created.tasks, []);
    assert.isTrue(Option.isSome(yield* store.get(created.id)));

    const updated = yield* service.updateInitiative({
      initiativeId: created.id,
      title: "Ship Atlas v2",
      deliverables: ["A", "B"],
    });
    assert.equal(updated.title, "Ship Atlas v2");
    assert.deepEqual(updated.deliverables, ["A", "B"]);

    const fetched = yield* service.getInitiative({ initiativeId: created.id });
    assert.equal(fetched.title, "Ship Atlas v2");

    const listed = yield* service.listInitiatives({ projectId });
    assert.deepEqual(
      listed.initiatives.map((initiative) => initiative.id),
      [created.id],
    );
    const otherProject = yield* service.listInitiatives({
      projectId: ProjectId.make("project:other"),
    });
    assert.equal(otherProject.initiatives.length, 0);

    const deleted = yield* service.deleteInitiative({ initiativeId: created.id });
    assert.equal(deleted.deleted, true);
    assert.isTrue(Option.isNone(yield* store.get(created.id)));
    const missing = yield* Effect.flip(service.getInitiative({ initiativeId: created.id }));
    assert.isTrue(isAtlasInitiativeNotFoundError(missing));
  }).pipe(Effect.provide(harness.layer));
});

const invalidPlans: ReadonlyArray<{
  readonly name: string;
  readonly tasks: ReadonlyArray<AtlasTaskDraft>;
}> = [
  { name: "duplicate task keys", tasks: [draft("a"), draft("a")] },
  {
    name: "a dependency on an unknown key",
    tasks: [draft("a", { dependsOn: ["missing"] })],
  },
  {
    name: "the same dependency listed twice",
    tasks: [draft("a", { dependsOn: ["b", "b"] }), draft("b")],
  },
  {
    name: "a dependency cycle",
    tasks: [draft("a", { dependsOn: ["b"] }), draft("b", { dependsOn: ["a"] })],
  },
  { name: "a self dependency", tasks: [draft("a", { dependsOn: ["a"] })] },
];

it.effect.each(invalidPlans)("rejects a plan with $name", (testCase) => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const error = yield* Effect.flip(
      service.importPlan({
        initiativeId: created.id,
        plan: plan(...testCase.tasks),
      }),
    );
    assert.isTrue(isAtlasPlanValidationError(error));
    const stored = yield* service.getInitiative({ initiativeId: created.id });
    assert.equal(stored.tasks.length, 0);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("imports a valid DAG, maps dependency keys to task ids, and gates blocked tasks", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* service.importPlan({
      initiativeId: created.id,
      plan: plan(
        draft("b", { dependsOn: ["a"] }),
        draft("c", { dependsOn: ["a", "b"] }),
        draft("a"),
      ),
    });

    const a = taskByTitle(imported, "Task a");
    const b = taskByTitle(imported, "Task b");
    const c = taskByTitle(imported, "Task c");
    assert.deepEqual(b.dependsOn, [a.id]);
    assert.deepEqual(c.dependsOn, [a.id, b.id]);
    assert.deepEqual(a.blockedBy, []);
    assert.deepEqual(b.blockedBy, [a.id]);
    assert.deepEqual(c.blockedBy, [a.id, b.id]);
    assert.deepEqual(
      imported.tasks.map((task) => task.title),
      ["Task b", "Task c", "Task a"],
    );
    assert.equal(imported.planSummary, "Plan summary");
    assert.equal(imported.status, "plan_ready");
    assert.isTrue(imported.tasks.every((task) => task.status === "proposed"));
  }).pipe(Effect.provide(harness.layer));
});

it.effect("refuses execution until every dependency is approved, then allows it", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* service.importPlan({
      initiativeId: created.id,
      plan: plan(draft("a"), draft("b", { dependsOn: ["a"] })),
    });
    const a = taskByTitle(imported, "Task a");
    const b = taskByTitle(imported, "Task b");

    const blocked = yield* Effect.flip(executeOnlyTask(service, created.id, b.id));
    if (!isAtlasDependencyNotApprovedError(blocked)) {
      throw new Error(`expected AtlasDependencyNotApprovedError, got ${blocked._tag}`);
    }
    assert.deepEqual(blocked.blockedBy, [a.id]);
    assert.equal(harness.launchCalls.length, 0);

    const executed = yield* executeOnlyTask(service, created.id, a.id);
    harness.complete(
      executed.tasks.find((task) => task.id === a.id)!.execution!.threadId,
      "A done",
    );
    yield* service.refreshInitiative({ initiativeId: created.id });
    const approved = yield* service.approveTask({ initiativeId: created.id, taskId: a.id });

    const unblocked = yield* executeOnlyTask(service, created.id, b.id);
    assert.equal(harness.launchCalls.length, 2);
    assert.equal(unblocked.tasks.find((task) => task.id === b.id)!.execution?.status, "running");
    assert.isTrue(harness.launchCalls.some((call) => call.input.title === "Atlas: Task b"));
    assert.equal(approved.tasks.find((task) => task.id === a.id)!.status, "approved");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("turns a completed execution into needs_review with its result", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* importSingleTask(service, created.id);
    const taskId = imported.tasks[0]!.id;

    const running = yield* executeOnlyTask(service, created.id, taskId);
    assert.equal(running.tasks[0]!.status, "running");
    assert.equal(running.tasks[0]!.execution?.status, "running");

    harness.complete(running.tasks[0]!.execution!.threadId, "Implemented and verified.");
    const refreshed = yield* service.refreshInitiative({ initiativeId: created.id });
    const task = refreshed.tasks[0]!;
    assert.equal(task.status, "needs_review");
    assert.equal(task.execution?.status, "completed");
    assert.equal(task.execution?.result, "Implemented and verified.");
    assert.isNotNull(task.execution?.finishedAt);
    assert.equal(refreshed.status, "in_progress");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("keeps delegated work running until children and wakes settle", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* importSingleTask(service, created.id);
    const taskId = imported.tasks[0]!.id;
    const executed = yield* executeOnlyTask(service, created.id, taskId);
    const execution = executed.tasks[0]!.execution!;
    const { threadId, runId } = execution;
    const parentRun = projectionRun(threadId, runId, 1, "completed", runTime);
    const parentMessage = projectionMessage(runId, "Parent turn finished; children still working.");

    harness.setProjection(
      threadId,
      threadProjection({
        threadId,
        runs: [parentRun],
        messages: [parentMessage],
        subagents: [projectionSubagent("running")],
      }),
    );
    const runningChild = yield* service.refreshInitiative({ initiativeId: created.id });
    assert.equal(runningChild.tasks[0]!.execution?.status, "running");
    assert.equal(runningChild.tasks[0]!.status, "running");
    assert.equal(runningChild.tasks[0]!.humanDecision.outcome, "pending");

    harness.setProjection(
      threadId,
      threadProjection({
        threadId,
        runs: [parentRun],
        messages: [parentMessage],
        subagents: [projectionSubagent("completed", "pending")],
      }),
    );
    const pendingWake = yield* service.refreshInitiative({ initiativeId: created.id });
    assert.equal(pendingWake.tasks[0]!.execution?.status, "running");
    assert.equal(pendingWake.tasks[0]!.status, "running");
    assert.equal(pendingWake.tasks[0]!.humanDecision.outcome, "pending");

    harness.setProjection(
      threadId,
      threadProjection({
        threadId,
        runs: [parentRun],
        messages: [parentMessage],
        subagents: [projectionSubagent("completed", "delivered")],
        providerThreads: [projectionProviderThread(true)],
      }),
    );
    const pendingBackground = yield* service.refreshInitiative({ initiativeId: created.id });
    assert.equal(pendingBackground.tasks[0]!.execution?.status, "running");
    assert.equal(pendingBackground.tasks[0]!.status, "running");
    assert.equal(pendingBackground.tasks[0]!.humanDecision.outcome, "pending");

    const wakeRunId = RunId.make("run:atlas:wake");
    harness.setProjection(
      threadId,
      threadProjection({
        threadId,
        runs: [parentRun, projectionRun(threadId, wakeRunId, 2, "completed", laterRunTime)],
        messages: [parentMessage, projectionMessage(wakeRunId, "Final wake result.")],
        subagents: [projectionSubagent("completed", "delivered")],
        providerThreads: [projectionProviderThread(false)],
      }),
    );
    const settled = yield* service.refreshInitiative({ initiativeId: created.id });
    const task = settled.tasks[0]!;
    assert.equal(task.execution?.status, "completed");
    assert.equal(task.status, "needs_review");
    assert.equal(task.execution?.result, "Final wake result.");
    assert.equal(task.humanDecision.outcome, "pending");
    assert.equal(settled.status, "in_progress");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("passes human change feedback and the previous result into a retry", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const setup = yield* setupReviewableTask(service, harness);
    const { initiativeId, taskId } = setup;

    const requested = yield* service.requestChanges({
      initiativeId,
      taskId,
      feedback: "Fix the failing tests and add coverage.",
    });
    const task = requested.tasks[0]!;
    assert.equal(task.status, "changes_requested");
    assert.equal(task.humanDecision.outcome, "changes_requested");
    assert.equal(task.humanDecision.feedback, "Fix the failing tests and add coverage.");

    const retried = yield* executeOnlyTask(service, initiativeId, taskId);
    const retryCall = harness.launchCalls.at(-1)!;
    assert.equal(harness.launchCalls.length, 2);
    assert.include(retryCall.input.initialMessage!.text, "Implemented the task");
    assert.include(retryCall.input.initialMessage!.text, "Fix the failing tests and add coverage.");
    const retriedTask = retried.tasks[0]!;
    assert.equal(retriedTask.status, "running");
    assert.equal(retriedTask.humanDecision.outcome, "pending");
    assert.equal(retriedTask.execution?.status, "running");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("auto-applies a valid agent verdict only when opted in", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const setup = yield* setupReviewableTask(service, harness);
    const reviewing = yield* service.startAgentReview({
      initiativeId: setup.initiativeId,
      taskId: setup.taskId,
      ...runOptions,
      autoApplyVerdict: true,
    });
    const review = reviewing.tasks[0]!.agentReview!;
    assert.equal(review.status, "running");
    assert.equal(review.autoApplyVerdict, true);

    harness.complete(
      review.threadId,
      '```json\n{"outcome":"approved","feedback":"Meets every criterion."}\n```',
    );
    const refreshed = yield* service.refreshInitiative({ initiativeId: setup.initiativeId });
    const task = refreshed.tasks[0]!;
    assert.equal(task.agentReview?.status, "completed");
    assert.equal(task.agentReview?.outcome, "approved");
    assert.equal(task.agentReview?.feedback, "Meets every criterion.");
    assert.equal(task.humanDecision.outcome, "approved");
    assert.equal(task.humanDecision.feedback, "Meets every criterion.");
    assert.isNotNull(task.humanDecision.decidedAt);
    assert.equal(task.status, "approved");
    assert.equal(refreshed.status, "completed");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("never auto-approves an invalid agent verdict", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const setup = yield* setupReviewableTask(service, harness);
    const reviewing = yield* service.startAgentReview({
      initiativeId: setup.initiativeId,
      taskId: setup.taskId,
      ...runOptions,
      autoApplyVerdict: true,
    });
    harness.complete(reviewing.tasks[0]!.agentReview!.threadId, "Looks good to me.");

    const refreshed = yield* service.refreshInitiative({ initiativeId: setup.initiativeId });
    const task = refreshed.tasks[0]!;
    assert.equal(task.agentReview?.status, "completed");
    assert.isNull(task.agentReview?.outcome);
    assert.isNull(task.agentReview?.feedback);
    assert.equal(task.humanDecision.outcome, "pending");
    assert.equal(task.status, "needs_review");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("records an agent verdict without applying it when auto-apply is off", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const setup = yield* setupReviewableTask(service, harness);
    const reviewing = yield* service.startAgentReview({
      initiativeId: setup.initiativeId,
      taskId: setup.taskId,
      ...runOptions,
    });
    const review = reviewing.tasks[0]!.agentReview!;
    assert.equal(review.autoApplyVerdict, false);
    harness.complete(
      review.threadId,
      '{"outcome":"changes_requested","feedback":"Missing an edge case."}',
    );

    const refreshed = yield* service.refreshInitiative({ initiativeId: setup.initiativeId });
    const task = refreshed.tasks[0]!;
    assert.equal(task.agentReview?.status, "completed");
    assert.equal(task.agentReview?.outcome, "changes_requested");
    assert.equal(task.agentReview?.feedback, "Missing an edge case.");
    assert.equal(task.humanDecision.outcome, "pending");
    assert.equal(task.status, "needs_review");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("reviews in the execution workspace unless the caller overrides it", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* importSingleTask(service, created.id);
    const taskId = imported.tasks[0]!.id;
    const actualWorkspace = {
      type: "existing_worktree" as const,
      worktreePath: "/tmp/atlas-worktree",
      branch: "atlas/feature",
    };

    const executed = yield* service.executeTask({
      initiativeId: created.id,
      taskId,
      ...runOptions,
      workspaceStrategy: { type: "worktree", baseRef: "main", branch: "atlas/feature" },
    });
    assert.deepEqual(executed.tasks[0]!.execution?.workspaceStrategy, actualWorkspace);
    harness.complete(executed.tasks[0]!.execution!.threadId, "Implemented.");
    yield* service.refreshInitiative({ initiativeId: created.id });

    const reviewing = yield* service.startAgentReview({
      initiativeId: created.id,
      taskId,
      ...runOptions,
    });
    const reviewCall = harness.launchCalls.at(-1)!;
    assert.deepEqual(reviewCall.input.workspaceStrategy, actualWorkspace);

    harness.complete(reviewing.tasks[0]!.agentReview!.threadId, "No verdict.");
    yield* service.refreshInitiative({ initiativeId: created.id });

    yield* service.startAgentReview({
      initiativeId: created.id,
      taskId,
      ...runOptions,
      workspaceStrategy: { type: "root" },
    });
    assert.deepEqual(harness.launchCalls.at(-1)!.input.workspaceStrategy, { type: "root" });
  }).pipe(Effect.provide(harness.layer));
});

it.effect("adopts the prepared worktree path after a deferred worktree launch", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* importSingleTask(service, created.id);
    const taskId = imported.tasks[0]!.id;
    harness.state.launchThread = { worktreePath: null, branch: null };

    const executed = yield* service.executeTask({
      initiativeId: created.id,
      taskId,
      ...runOptions,
      workspaceStrategy: { type: "root" },
    });
    const execution = executed.tasks[0]!.execution!;
    assert.deepEqual(execution.workspaceStrategy, { type: "root" });

    harness.setProjection(
      execution.threadId,
      threadProjection({
        threadId: execution.threadId,
        thread: { worktreePath: "/tmp/atlas-worktree", branch: "atlas/feature" },
        runs: [projectionRun(execution.threadId, execution.runId, 1, "completed", runTime)],
        messages: [projectionMessage(execution.runId, "Implemented.")],
      }),
    );
    const refreshed = yield* service.refreshInitiative({ initiativeId: created.id });
    assert.deepEqual(refreshed.tasks[0]!.execution?.workspaceStrategy, {
      type: "existing_worktree",
      worktreePath: "/tmp/atlas-worktree",
      branch: "atlas/feature",
    });

    yield* service.startAgentReview({ initiativeId: created.id, taskId, ...runOptions });
    assert.deepEqual(harness.launchCalls.at(-1)!.input.workspaceStrategy, {
      type: "existing_worktree",
      worktreePath: "/tmp/atlas-worktree",
      branch: "atlas/feature",
    });
  }).pipe(Effect.provide(harness.layer));
});

it.effect("serializes concurrent executions and launches the task once", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* importSingleTask(service, created.id);
    const taskId = imported.tasks[0]!.id;
    const input = { initiativeId: created.id, taskId, ...runOptions };

    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    harness.setLaunchGate(
      Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
    );

    const first = yield* service
      .executeTask(input)
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Deferred.await(entered);
    const second = yield* service
      .executeTask(input)
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Effect.yieldNow;
    yield* Deferred.succeed(release, undefined);

    const firstResult = yield* Fiber.join(first);
    const secondError = yield* Fiber.join(second).pipe(Effect.flip);

    assert.equal(harness.launchCalls.length, 1);
    assert.equal(firstResult.tasks[0]!.status, "running");
    assert.isTrue(isAtlasTaskNotRunnableError(secondError));
  }).pipe(Effect.provide(harness.layer));
});

it.effect("does not let a stale persisted running execution block another initiative", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const first = yield* createInitiative(service);
    const firstImported = yield* importSingleTask(service, first.id);
    const firstExecution = (yield* executeOnlyTask(service, first.id, firstImported.tasks[0]!.id))
      .tasks[0]!.execution!;

    harness.setProjection(
      firstExecution.threadId,
      threadProjection({
        threadId: firstExecution.threadId,
        runs: [
          projectionRun(firstExecution.threadId, firstExecution.runId, 1, "completed", runTime),
        ],
        messages: [projectionMessage(firstExecution.runId, "Already finished.")],
      }),
    );

    const second = yield* createInitiative(service);
    const secondImported = yield* importSingleTask(service, second.id);
    const secondExecution = yield* executeOnlyTask(service, second.id, secondImported.tasks[0]!.id);
    assert.equal(secondExecution.tasks[0]!.status, "running");
    assert.equal(harness.launchCalls.length, 2);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("keeps running through transient projection failures and fails only when missing", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* importSingleTask(service, created.id);
    const taskId = imported.tasks[0]!.id;
    const execution = (yield* executeOnlyTask(service, created.id, taskId)).tasks[0]!.execution!;

    harness.setProjectionFailure(execution.threadId, "transient");
    const transient = yield* service.refreshInitiative({ initiativeId: created.id });
    assert.equal(transient.tasks[0]!.execution?.status, "running");
    assert.equal(transient.tasks[0]!.status, "running");

    const retry = yield* Effect.flip(executeOnlyTask(service, created.id, taskId));
    assert.isTrue(isAtlasTaskNotRunnableError(retry));

    harness.setProjectionFailure(execution.threadId, "notfound");
    const missing = yield* service.refreshInitiative({ initiativeId: created.id });
    const task = missing.tasks[0]!;
    assert.equal(task.execution?.status, "failed");
    assert.equal(task.status, "failed");
    assert.include(task.execution?.result ?? "", "missing or inaccessible");
    assert.isNotNull(task.execution?.finishedAt);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("refresh preserves a human approval when the linked run changes", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const setup = yield* setupReviewableTask(service, harness);
    const approved = yield* service.approveTask({
      initiativeId: setup.initiativeId,
      taskId: setup.taskId,
      feedback: "Ship it.",
    });
    const approvedTask = approved.tasks[0]!;
    const decidedAt = approvedTask.humanDecision.decidedAt;
    assert.equal(approvedTask.status, "approved");

    harness.complete(approvedTask.execution!.threadId, "A late failure after approval.", "failed");
    const refreshed = yield* service.refreshInitiative({ initiativeId: setup.initiativeId });
    const task = refreshed.tasks[0]!;
    assert.equal(task.execution?.status, "failed");
    assert.equal(task.execution?.result, "A late failure after approval.");
    assert.equal(task.humanDecision.outcome, "approved");
    assert.equal(task.humanDecision.feedback, "Ship it.");
    assert.equal(task.humanDecision.decidedAt, decidedAt);
    assert.equal(task.status, "approved");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("refuses deletion and re-import while the initiative has active work", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;

    const planning = yield* createInitiative(service);
    yield* service.startPlanning({
      initiativeId: planning.id,
      ...runOptions,
    });
    const planningError = yield* Effect.flip(
      service.deleteInitiative({ initiativeId: planning.id }),
    );
    if (!isAtlasInitiativeBusyError(planningError)) {
      throw new Error(`expected AtlasInitiativeBusyError, got ${planningError._tag}`);
    }
    assert.equal(planningError.active, "planner");

    const executing = yield* createInitiative(service);
    const imported = yield* importSingleTask(service, executing.id);
    const executed = yield* executeOnlyTask(service, executing.id, imported.tasks[0]!.id);
    const executionError = yield* Effect.flip(
      service.deleteInitiative({ initiativeId: executing.id }),
    );
    if (!isAtlasInitiativeBusyError(executionError)) {
      throw new Error(`expected AtlasInitiativeBusyError, got ${executionError._tag}`);
    }
    assert.equal(executionError.active, "task");
    const importError = yield* Effect.flip(
      service.importPlan({ initiativeId: executing.id, plan: plan(draft("replacement")) }),
    );
    assert.isTrue(isAtlasPlanImportError(importError));

    harness.complete(executed.tasks[0]!.execution!.threadId, "Finished.");
    yield* service.refreshInitiative({ initiativeId: executing.id });

    const reviewing = yield* setupReviewableTask(service, harness);
    yield* service.startAgentReview({
      initiativeId: reviewing.initiativeId,
      taskId: reviewing.taskId,
      ...runOptions,
    });
    const reviewError = yield* Effect.flip(
      service.deleteInitiative({ initiativeId: reviewing.initiativeId }),
    );
    if (!isAtlasInitiativeBusyError(reviewError)) {
      throw new Error(`expected AtlasInitiativeBusyError, got ${reviewError._tag}`);
    }
    assert.equal(reviewError.active, "review");
  }).pipe(Effect.provide(harness.layer));
});

it.effect(
  "publishes a task issue once and treats the stored issue as the idempotency marker",
  () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const service = yield* AtlasService.AtlasService;
      const created = yield* createInitiative(service);
      const imported = yield* importSingleTask(service, created.id);
      const taskId = imported.tasks[0]!.id;

      const published = yield* service.publishTaskIssue({ initiativeId: created.id, taskId });
      const issue = published.tasks[0]!.issue!;
      assert.equal(issue.number, 42);
      assert.equal(issue.url, "https://github.com/acme/repo/issues/42");
      assert.equal(ghSubcommandCalls(harness, "list"), 1);
      assert.equal(ghSubcommandCalls(harness, "create"), 1);
      assert.equal(harness.processCalls.filter((call) => call.command === "git").length, 1);

      const repeated = yield* service.publishTaskIssue({ initiativeId: created.id, taskId });
      assert.deepEqual(repeated.tasks[0]!.issue, issue);
      assert.equal(ghSubcommandCalls(harness, "list"), 1);
      assert.equal(ghSubcommandCalls(harness, "create"), 1);
      assert.equal(harness.processCalls.filter((call) => call.command === "git").length, 1);

      const refreshed = yield* service.refreshInitiative({ initiativeId: created.id });
      assert.deepEqual(refreshed.tasks[0]!.issue, issue);
    }).pipe(Effect.provide(harness.layer));
  },
);

it.effect(
  "adopts an existing issue found by its Atlas task marker instead of creating a duplicate",
  () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const service = yield* AtlasService.AtlasService;
      const created = yield* createInitiative(service);
      const imported = yield* importSingleTask(service, created.id);
      const taskId = imported.tasks[0]!.id;
      harness.state.issueListJson = JSON.stringify([
        {
          number: 7,
          url: "https://github.com/acme/repo/issues/7",
          body: `Previously published.\n\nAtlas task marker: ${taskId}`,
        },
      ]);

      const published = yield* service.publishTaskIssue({ initiativeId: created.id, taskId });
      const issue = published.tasks[0]!.issue!;
      assert.equal(issue.number, 7);
      assert.equal(issue.url, "https://github.com/acme/repo/issues/7");
      assert.equal(ghSubcommandCalls(harness, "create"), 0);
    }).pipe(Effect.provide(harness.layer));
  },
);

it.effect("adopts an exact visible marker without relying on issue search indexing", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* importSingleTask(service, created.id);
    const taskId = imported.tasks[0]!.id;
    harness.state.issueListJson = JSON.stringify([
      {
        number: 6,
        url: "https://github.com/acme/repo/issues/6",
        body: "Unrelated work.",
      },
      {
        number: 7,
        url: "https://github.com/acme/repo/issues/7",
        body: `Previously published.\n\nAtlas task marker: ${taskId}`,
      },
      {
        number: 8,
        url: "https://github.com/acme/repo/issues/8",
        body: "Atlas task marker: a-different-task",
      },
    ]);

    const published = yield* service.publishTaskIssue({ initiativeId: created.id, taskId });
    assert.equal(published.tasks[0]!.issue?.number, 7);
    assert.equal(ghSubcommandCalls(harness, "create"), 0);
    const lookup = harness.processCalls.find(
      (call) => call.command === "gh" && call.args[1] === "list",
    )!;
    assert.isFalse(lookup.args.includes("--search"));
  }).pipe(Effect.provide(harness.layer));
});

it.effect("fails closed when the issue lookup response is malformed", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* importSingleTask(service, created.id);
    const taskId = imported.tasks[0]!.id;
    harness.state.issueListJson = "{not-json";

    const failed = yield* Effect.flip(
      service.publishTaskIssue({ initiativeId: created.id, taskId }),
    );
    assert.isTrue(isAtlasIssuePublishError(failed));
    assert.equal(ghSubcommandCalls(harness, "create"), 0);
    const after = yield* service.getInitiative({ initiativeId: created.id });
    assert.isNull(after.tasks[0]!.issue);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("leaves no issue marker after a publish failure so a retry can succeed", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* importSingleTask(service, created.id);
    const taskId = imported.tasks[0]!.id;

    harness.state.failNextIssue = true;
    const failed = yield* Effect.flip(
      service.publishTaskIssue({ initiativeId: created.id, taskId }),
    );
    assert.isTrue(isAtlasIssuePublishError(failed));
    const afterFailure = yield* service.getInitiative({ initiativeId: created.id });
    assert.isNull(afterFailure.tasks[0]!.issue);

    const retried = yield* service.publishTaskIssue({ initiativeId: created.id, taskId });
    assert.equal(retried.tasks[0]!.issue?.number, 42);
    assert.equal(ghSubcommandCalls(harness, "list"), 2);
    assert.equal(ghSubcommandCalls(harness, "create"), 1);
  }).pipe(Effect.provide(harness.layer));
});

it.effect(
  "recovers from a provider launch failure by marking the task failed and allowing a retry",
  () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const service = yield* AtlasService.AtlasService;
      const created = yield* createInitiative(service);
      const imported = yield* importSingleTask(service, created.id);
      const taskId = imported.tasks[0]!.id;

      harness.state.failNextLaunch = true;
      const failed = yield* Effect.flip(executeOnlyTask(service, created.id, taskId));
      assert.isTrue(isAtlasProviderLaunchError(failed));

      const afterFailure = yield* service.getInitiative({ initiativeId: created.id });
      assert.equal(afterFailure.tasks[0]!.status, "failed");
      assert.isNull(afterFailure.tasks[0]!.execution);
      const recordedAttempt = afterFailure.tasks[0]!.launch;
      assert.isNotNull(recordedAttempt);

      const retried = yield* executeOnlyTask(service, created.id, taskId);
      assert.equal(retried.tasks[0]!.status, "running");
      assert.isNull(retried.tasks[0]!.launch);
      assert.equal(harness.launchCalls.length, 2);
      assert.equal(harness.launchCalls[1]!.input.commandId, recordedAttempt!.commandId);
    }).pipe(Effect.provide(harness.layer));
  },
);

it.effect("preserves execution, feedback, and review when a retry launch fails", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const setup = yield* setupReviewableTask(service, harness);

    const reviewing = yield* service.startAgentReview({
      initiativeId: setup.initiativeId,
      taskId: setup.taskId,
      ...runOptions,
    });
    harness.complete(
      reviewing.tasks[0]!.agentReview!.threadId,
      '```json\n{"outcome":"changes_requested","feedback":"Review found gaps."}\n```',
    );
    yield* service.refreshInitiative({ initiativeId: setup.initiativeId });
    const requested = yield* service.requestChanges({
      initiativeId: setup.initiativeId,
      taskId: setup.taskId,
      feedback: "Fix the gaps.",
    });
    const prior = requested.tasks[0]!;
    assert.equal(prior.status, "changes_requested");
    assert.equal(prior.execution?.result, "Implemented the task");
    assert.equal(prior.agentReview?.feedback, "Review found gaps.");
    assert.equal(prior.humanDecision.feedback, "Fix the gaps.");

    harness.state.failNextLaunch = true;
    const failed = yield* Effect.flip(executeOnlyTask(service, setup.initiativeId, setup.taskId));
    assert.isTrue(isAtlasProviderLaunchError(failed));

    const afterFailure = yield* service.getInitiative({ initiativeId: setup.initiativeId });
    const task = afterFailure.tasks[0]!;
    assert.equal(task.status, "changes_requested");
    assert.deepEqual(task.execution, prior.execution);
    assert.deepEqual(task.agentReview, prior.agentReview);
    assert.deepEqual(task.humanDecision, prior.humanDecision);
    assert.equal(task.launch?.operation, "execution");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("recovers from a planning launch failure and can start planning again", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);

    harness.state.failNextLaunch = true;
    const failed = yield* Effect.flip(
      service.startPlanning({ initiativeId: created.id, ...runOptions }),
    );
    assert.isTrue(isAtlasProviderLaunchError(failed));

    const afterFailure = yield* service.getInitiative({ initiativeId: created.id });
    assert.equal(afterFailure.planner.status, "failed");
    assert.isNotNull(afterFailure.planner.error);
    const recordedAttempt = afterFailure.planner.launch;
    assert.isNotNull(recordedAttempt);

    const retried = yield* service.startPlanning({ initiativeId: created.id, ...runOptions });
    assert.equal(retried.planner.status, "running");
    assert.isNotNull(retried.planner.threadId);
    assert.isNull(retried.planner.launch);
    assert.equal(harness.launchCalls.length, 2);
    assert.equal(harness.launchCalls[1]!.input.commandId, recordedAttempt!.commandId);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("runs independent tasks concurrently in separate worktrees", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* service.importPlan({
      initiativeId: created.id,
      plan: plan(draft("one"), draft("two")),
    });
    const first = yield* service.executeTask({
      initiativeId: created.id,
      taskId: imported.tasks[0]!.id,
      ...runOptions,
      workspaceStrategy: { type: "existing_worktree", worktreePath: "/tmp/worktree-one" },
    });
    const second = yield* service.executeTask({
      initiativeId: created.id,
      taskId: imported.tasks[1]!.id,
      ...runOptions,
      workspaceStrategy: { type: "existing_worktree", worktreePath: "/tmp/worktree-two" },
    });
    assert.equal(first.tasks[0]!.execution?.status, "running");
    assert.deepEqual(
      second.tasks.map((task) => task.execution?.status),
      ["running", "running"],
    );
    assert.equal(harness.launchCalls.length, 2);
  }).pipe(Effect.provide(harness.layer));
});

it.effect.each([
  {
    title: "shared project checkout",
    first: { type: "root" as const },
    second: { type: "root" as const },
  },
  {
    title: "equivalent worktree paths",
    first: { type: "existing_worktree" as const, worktreePath: "/tmp/shared" },
    second: { type: "existing_worktree" as const, worktreePath: "/tmp/nested/../shared" },
  },
  {
    title: "a worktree path pointing at the project root",
    first: { type: "root" as const },
    second: { type: "existing_worktree" as const, worktreePath: "/tmp/atlas-project" },
  },
  {
    title: "a branch already executing in a worktree",
    first: {
      type: "existing_worktree" as const,
      worktreePath: "/tmp/branch-worktree",
      branch: "atlas/shared",
    },
    second: { type: "worktree" as const, baseRef: "HEAD", branch: "atlas/shared" },
  },
])("rejects overlapping execution in $title", ({ first, second }) => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const one = yield* createInitiative(service);
    const firstPlan = yield* importSingleTask(service, one.id);
    yield* service.executeTask({
      initiativeId: one.id,
      taskId: firstPlan.tasks[0]!.id,
      ...runOptions,
      workspaceStrategy: first,
    });
    const two = yield* createInitiative(service);
    const secondPlan = yield* importSingleTask(service, two.id);
    const error = yield* service
      .executeTask({
        initiativeId: two.id,
        taskId: secondPlan.tasks[0]!.id,
        ...runOptions,
        workspaceStrategy: second,
      })
      .pipe(Effect.flip);
    assert.isTrue(isAtlasProjectBusyError(error));
    assert.equal(harness.launchCalls.length, 1);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("reserves an isolated worktree during preparation without blocking a root task", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const first = yield* createInitiative(service);
    const firstPlan = yield* importSingleTask(service, first.id);
    harness.state.launchThread = { worktreePath: null, branch: null };
    const worktree = { type: "worktree" as const, baseRef: "HEAD", branch: "atlas/preparing" };
    const started = yield* service.executeTask({
      initiativeId: first.id,
      taskId: firstPlan.tasks[0]!.id,
      ...runOptions,
      workspaceStrategy: worktree,
    });
    assert.deepEqual(started.tasks[0]!.execution?.workspaceStrategy, worktree);
    const refreshed = yield* service.refreshInitiative({ initiativeId: first.id });
    assert.deepEqual(refreshed.tasks[0]!.execution?.workspaceStrategy, worktree);
    const second = yield* createInitiative(service);
    const secondPlan = yield* importSingleTask(service, second.id);
    yield* service.executeTask({
      initiativeId: second.id,
      taskId: secondPlan.tasks[0]!.id,
      ...runOptions,
    });
    assert.equal(harness.launchCalls.length, 2);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("retries in the existing execution worktree by default", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* importSingleTask(service, created.id);
    const taskId = imported.tasks[0]!.id;
    const workspace = { type: "existing_worktree" as const, worktreePath: "/tmp/retry-worktree" };
    const started = yield* service.executeTask({
      initiativeId: created.id,
      taskId,
      ...runOptions,
      workspaceStrategy: workspace,
    });
    harness.complete(started.tasks[0]!.execution!.threadId, "Please review.");
    yield* service.requestChanges({
      initiativeId: created.id,
      taskId,
      feedback: "Fix the result.",
    });
    yield* service.executeTask({ initiativeId: created.id, taskId, ...runOptions });
    assert.deepEqual(harness.launchCalls.at(-1)!.input.workspaceStrategy, workspace);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("pins a failed launch retry to its original workspace", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* importSingleTask(service, created.id);
    const input = { initiativeId: created.id, taskId: imported.tasks[0]!.id, ...runOptions };
    harness.state.failNextLaunch = true;
    yield* service.executeTask(input).pipe(Effect.flip);
    yield* service.executeTask({
      ...input,
      workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
    });
    assert.deepEqual(
      harness.launchCalls.map((call) => call.input.workspaceStrategy),
      [{ type: "root" }, { type: "root" }],
    );
    assert.equal(harness.launchCalls[0]!.input.commandId, harness.launchCalls[1]!.input.commandId);
  }).pipe(Effect.provide(harness.layer));
});

const setupAdjustablePlan = (service: AtlasService.AtlasService["Service"], harness: Harness) =>
  Effect.gen(function* () {
    const created = yield* createInitiative(service);
    const imported = yield* service.importPlan({
      initiativeId: created.id,
      plan: plan(draft("a"), draft("b", { dependsOn: ["a"] }), draft("c", { dependsOn: ["b"] })),
    });
    const a = taskByTitle(imported, "Task a");
    const executed = yield* executeOnlyTask(service, created.id, a.id);
    harness.complete(
      executed.tasks.find((task) => task.id === a.id)!.execution!.threadId,
      "A shipped the shared contract.",
    );
    const initiative = yield* service.refreshInitiative({ initiativeId: created.id });
    return {
      initiative,
      a: taskByTitle(initiative, "Task a"),
      b: taskByTitle(initiative, "Task b"),
      c: taskByTitle(initiative, "Task c"),
    };
  });

it.effect("decodes legacy initiatives without plan revisions or review policy", () =>
  Effect.sync(() => {
    const legacy = decodeInitiative({
      id: "atlas-initiative:legacy",
      projectId,
      title: "Legacy",
      brief: "Old record",
      deliverables: [],
      status: "draft",
      planSummary: null,
      planner: { status: "idle", threadId: null, runId: null, error: null, launch: null },
      tasks: [],
      createdAt,
      updatedAt: createdAt,
    });
    assert.equal(legacy.planRevision, 0);
    assert.equal(legacy.planner.mode, "plan");
    assert.isNull(legacy.planner.adjustment);
    assert.isNull(legacy.autoReview);
  }),
);

it.effect("persists the auto-review policy, keeps it when omitted, and clears it with null", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    assert.isNull(created.autoReview);
    const policy = {
      enabled: true,
      modelSelection,
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
      autoApplyVerdict: false,
    };
    yield* service.updateInitiative({ initiativeId: created.id, autoReview: policy });
    yield* service.updateInitiative({ initiativeId: created.id, title: "Renamed" });
    const kept = yield* service.getInitiative({ initiativeId: created.id });
    assert.deepEqual(kept.autoReview, policy);
    assert.equal(kept.title, "Renamed");
    const cleared = yield* service.updateInitiative({ initiativeId: created.id, autoReview: null });
    assert.isNull(cleared.autoReview);
    assert.isNull((yield* service.getInitiative({ initiativeId: created.id })).autoReview);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("applies an incremental adjustment while preserving started work and task ids", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const { initiative, a, b, c } = yield* setupAdjustablePlan(service, harness);
    assert.equal(initiative.planRevision, 1);

    const adjusted = yield* service.applyPlanAdjustment({
      initiativeId: initiative.id,
      expectedPlanRevision: 1,
      adjustment: {
        summary: "Split the UI work and drop c.",
        updates: [{ taskId: b.id, title: "Task b2", dependsOn: [] }],
        additions: [
          draft("hud", { dependsOn: [a.id] }),
          draft("hud-tests", { specialty: "tests", dependsOn: ["hud"] }),
        ],
        removals: [c.id],
      },
    });

    assert.equal(adjusted.planRevision, 2);
    assert.equal(adjusted.planSummary, "Plan summary");
    const keptA = adjusted.tasks.find((task) => task.id === a.id)!;
    assert.deepEqual(keptA.execution, a.execution);
    assert.equal(keptA.status, "needs_review");
    const keptB = adjusted.tasks.find((task) => task.id === b.id)!;
    assert.equal(keptB.title, "Task b2");
    assert.equal(keptB.description, b.description);
    assert.deepEqual(keptB.dependsOn, []);
    assert.deepEqual(keptB.blockedBy, []);
    assert.isUndefined(adjusted.tasks.find((task) => task.id === c.id));
    const hud = taskByTitle(adjusted, "Task hud");
    const hudTests = taskByTitle(adjusted, "Task hud-tests");
    assert.deepEqual(hud.dependsOn, [a.id]);
    assert.deepEqual(hudTests.dependsOn, [hud.id]);
    assert.deepEqual(
      adjusted.tasks.map((task) => task.ordinal),
      [0, 1, 3, 4],
    );
    assert.deepEqual(yield* service.getInitiative({ initiativeId: initiative.id }), adjusted);
  }).pipe(Effect.provide(harness.layer));
});

it.effect.each([
  {
    name: "editing a started task",
    build: (ids: { a: string; b: string; c: string }) => ({
      updates: [{ taskId: ids.a, title: "Rewrite history" }],
    }),
  },
  { name: "removing a started task", build: (ids: { a: string }) => ({ removals: [ids.a] }) },
  {
    name: "a dependency cycle",
    build: (ids: { b: string; c: string }) => ({
      updates: [{ taskId: ids.b, dependsOn: [ids.c] }],
    }),
  },
  {
    name: "an unknown dependency",
    build: () => ({ additions: [draft("x", { dependsOn: ["atlas-task:missing"] })] }),
  },
  {
    name: "a dependent left pointing at a removed task",
    build: (ids: { b: string }) => ({ removals: [ids.b] }),
  },
  {
    name: "an edited dependent that keeps pointing at a removed task",
    build: (ids: { b: string; c: string }) => ({
      removals: [ids.b],
      updates: [{ taskId: ids.c, title: "Renamed c" }],
    }),
  },
])("rejects an adjustment with $name and leaves the plan untouched", (testCase) => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const { initiative, a, b, c } = yield* setupAdjustablePlan(service, harness);
    const patch = testCase.build({ a: a.id, b: b.id, c: c.id }) as Record<string, unknown>;
    const error = yield* Effect.flip(
      service.applyPlanAdjustment({
        initiativeId: initiative.id,
        expectedPlanRevision: 1,
        adjustment: {
          summary: "bad",
          updates: [],
          additions: [],
          removals: [],
          ...patch,
        } as never,
      }),
    );
    assert.isTrue(isAtlasPlanValidationError(error), `got ${error._tag}`);
    const after = yield* service.getInitiative({ initiativeId: initiative.id });
    assert.equal(after.planRevision, 1);
    assert.deepEqual(
      after.tasks.map((task) => [task.id, task.title, task.dependsOn]),
      initiative.tasks.map((task) => [task.id, task.title, task.dependsOn]),
    );
  }).pipe(Effect.provide(harness.layer));
});

it.effect("rejects an adjustment prepared against a stale plan revision", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const { initiative } = yield* setupAdjustablePlan(service, harness);
    const error = yield* Effect.flip(
      service.applyPlanAdjustment({
        initiativeId: initiative.id,
        expectedPlanRevision: 0,
        adjustment: { summary: "late", updates: [], additions: [draft("late")], removals: [] },
      }),
    );
    if (!isAtlasPlanRevisionConflictError(error)) throw new Error(`got ${error._tag}`);
    assert.equal(error.actualPlanRevision, 1);
    assert.equal((yield* service.getInitiative({ initiativeId: initiative.id })).tasks.length, 3);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("runs an agent-assisted adjustment as a previewable patch, then applies it", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const { initiative, a, c } = yield* setupAdjustablePlan(service, harness);

    const started = yield* service.startPlanAdjustment({
      initiativeId: initiative.id,
      instructions: "Add a HUD task after the shared contract.",
      ...runOptions,
    });
    assert.equal(started.planner.status, "running");
    assert.equal(started.planner.mode, "adjust");
    assert.equal(started.planner.baseRevision, 1);
    const prompt = harness.launchCalls.at(-1)!.input.initialMessage?.text ?? "";
    assert.include(prompt, "Add a HUD task after the shared contract.");
    assert.include(prompt, a.id);
    assert.include(prompt, "A shipped the shared contract.");
    assert.include(prompt, `${c.id} — Task c\nState: not started, editable\n`);

    const proposal = {
      summary: "Add HUD, drop c.",
      additions: [draft("hud", { dependsOn: [a.id] })],
      removals: [c.id],
    };
    harness.complete(started.planner.threadId!, `Here is the patch:\n${JSON.stringify(proposal)}`);
    const previewed = yield* service.refreshInitiative({ initiativeId: initiative.id });
    assert.isNull(previewed.planner.error);
    assert.deepEqual(previewed.planner.adjustment?.removals, [c.id]);
    assert.deepEqual(previewed.planner.adjustment?.updates, []);
    assert.equal(previewed.tasks.length, 3);

    const importError = yield* Effect.flip(service.importPlan({ initiativeId: initiative.id }));
    assert.isTrue(isAtlasPlanImportError(importError));

    const applied = yield* service.applyPlanAdjustment({
      initiativeId: initiative.id,
      expectedPlanRevision: 1,
    });
    assert.equal(applied.planRevision, 2);
    assert.isNull(applied.planner.adjustment);
    assert.deepEqual(taskByTitle(applied, "Task hud").dependsOn, [a.id]);
    assert.isUndefined(applied.tasks.find((task) => task.id === c.id));

    const again = yield* Effect.flip(
      service.applyPlanAdjustment({ initiativeId: initiative.id, expectedPlanRevision: 2 }),
    );
    assert.isTrue(isAtlasPlanRevisionConflictError(again));
  }).pipe(Effect.provide(harness.layer));
});

it.effect("treats a planner proposal as stale once the plan changes underneath it", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const { initiative } = yield* setupAdjustablePlan(service, harness);
    const started = yield* service.startPlanAdjustment({
      initiativeId: initiative.id,
      instructions: "Add docs.",
      ...runOptions,
    });
    yield* service.applyPlanAdjustment({
      initiativeId: initiative.id,
      expectedPlanRevision: 1,
      adjustment: { summary: "manual", updates: [], additions: [draft("manual")], removals: [] },
    });
    harness.complete(
      started.planner.threadId!,
      JSON.stringify({ summary: "docs", additions: [draft("docs")] }),
    );
    const refreshed = yield* service.refreshInitiative({ initiativeId: initiative.id });
    assert.isNull(refreshed.planner.adjustment);
    const error = yield* Effect.flip(
      service.applyPlanAdjustment({ initiativeId: initiative.id, expectedPlanRevision: 2 }),
    );
    if (!isAtlasPlanRevisionConflictError(error)) throw new Error(`got ${error._tag}`);
    assert.equal(error.expectedPlanRevision, 1);
    assert.equal(error.actualPlanRevision, 2);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("surfaces an unusable planner proposal as a planner error instead of a preview", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const { initiative, a } = yield* setupAdjustablePlan(service, harness);
    const started = yield* service.startPlanAdjustment({
      initiativeId: initiative.id,
      instructions: "Redo a.",
      ...runOptions,
    });
    harness.complete(
      started.planner.threadId!,
      JSON.stringify({ summary: "redo", removals: [a.id] }),
    );
    const refreshed = yield* service.refreshInitiative({ initiativeId: initiative.id });
    assert.equal(refreshed.planner.status, "completed");
    assert.isNull(refreshed.planner.adjustment);
    assert.include(refreshed.planner.error ?? "", "already started");
    const error = yield* Effect.flip(
      service.applyPlanAdjustment({ initiativeId: initiative.id, expectedPlanRevision: 1 }),
    );
    assert.isTrue(isAtlasPlanImportError(error));
  }).pipe(Effect.provide(harness.layer));
});

it.effect("never resurrects or reapplies a consumed planner proposal on later refreshes", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const { initiative } = yield* setupAdjustablePlan(service, harness);
    const started = yield* service.startPlanAdjustment({
      initiativeId: initiative.id,
      instructions: "Add docs.",
      ...runOptions,
    });
    harness.complete(
      started.planner.threadId!,
      JSON.stringify({ summary: "docs", additions: [draft("docs")] }),
    );
    yield* service.refreshInitiative({ initiativeId: initiative.id });
    const applied = yield* service.applyPlanAdjustment({
      initiativeId: initiative.id,
      expectedPlanRevision: 1,
    });
    assert.equal(applied.tasks.length, 4);

    for (let index = 0; index < 2; index += 1) {
      const refreshed = yield* service.refreshInitiative({ initiativeId: initiative.id });
      assert.isNull(refreshed.planner.adjustment);
      assert.isNull(refreshed.planner.error);
      assert.equal(refreshed.planner.threadId, started.planner.threadId);
      assert.equal(refreshed.tasks.length, 4);
    }
    const reapplied = yield* Effect.flip(
      service.applyPlanAdjustment({ initiativeId: initiative.id, expectedPlanRevision: 2 }),
    );
    assert.isTrue(isAtlasPlanRevisionConflictError(reapplied));
    assert.equal((yield* service.getInitiative({ initiativeId: initiative.id })).tasks.length, 4);
  }).pipe(Effect.provide(harness.layer));
});

const publishUnstartedAndEdit = (service: AtlasService.AtlasService["Service"], harness: Harness) =>
  Effect.gen(function* () {
    const { initiative, b, c } = yield* setupAdjustablePlan(service, harness);
    yield* service.publishTaskIssue({ initiativeId: initiative.id, taskId: b.id });
    const published = yield* service.publishTaskIssue({
      initiativeId: initiative.id,
      taskId: c.id,
    });
    const publishedB = published.tasks.find((task) => task.id === b.id)!;
    const adjusted = yield* service.applyPlanAdjustment({
      initiativeId: initiative.id,
      expectedPlanRevision: 1,
      adjustment: {
        summary: "Clarify b.",
        updates: [{ taskId: b.id, title: "Task b revised", dependsOn: [] }],
        additions: [],
        removals: [],
      },
    });
    return { initiativeId: initiative.id, b, c, publishedB, adjusted };
  });

it.effect("lets published but unstarted tasks be edited and marks their issue for sync", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const { initiativeId, b, c, publishedB, adjusted } = yield* publishUnstartedAndEdit(
      service,
      harness,
    );
    const editedB = adjusted.tasks.find((task) => task.id === b.id)!;
    assert.equal(editedB.title, "Task b revised");
    assert.deepEqual(editedB.dependsOn, []);
    assert.deepEqual(editedB.issue, { ...publishedB.issue!, needsSync: true });
    assert.notStrictEqual(adjusted.tasks.find((task) => task.id === c.id)!.issue?.needsSync, true);
    assert.equal(ghSubcommandCalls(harness, "edit"), 0);

    const removal = yield* Effect.flip(
      service.applyPlanAdjustment({
        initiativeId,
        expectedPlanRevision: 2,
        adjustment: { summary: "drop c", updates: [], additions: [], removals: [c.id] },
      }),
    );
    assert.isTrue(isAtlasPlanValidationError(removal));
    assert.isDefined(
      (yield* service.getInitiative({ initiativeId })).tasks.find((task) => task.id === c.id),
    );
  }).pipe(Effect.provide(harness.layer));
});

it.effect("updates an outdated issue in place once and keeps its link", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const { initiativeId, b, publishedB } = yield* publishUnstartedAndEdit(service, harness);
    const createCalls = ghSubcommandCalls(harness, "create");

    const synced = yield* service.publishTaskIssue({ initiativeId, taskId: b.id });
    const edit = harness.processCalls.find(
      (call) => call.command === "gh" && call.args[1] === "edit",
    );
    assert.equal(edit?.args[2], String(publishedB.issue!.number));
    assert.include(edit?.args ?? [], "[Atlas] Task b revised");
    const issue = synced.tasks.find((task) => task.id === b.id)!.issue!;
    assert.deepEqual(
      [issue.number, issue.url, issue.publishedAt],
      [publishedB.issue!.number, publishedB.issue!.url, publishedB.issue!.publishedAt],
    );
    assert.notStrictEqual(issue.needsSync, true);

    yield* service.publishTaskIssue({ initiativeId, taskId: b.id });
    assert.equal(ghSubcommandCalls(harness, "edit"), 1);
    assert.equal(ghSubcommandCalls(harness, "create"), createCalls);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("keeps an issue marked for sync when the update fails so it can be retried", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const { initiativeId, b } = yield* publishUnstartedAndEdit(service, harness);
    harness.state.failNextIssue = true;
    const failure = yield* Effect.flip(service.publishTaskIssue({ initiativeId, taskId: b.id }));
    if (!isAtlasIssuePublishError(failure)) throw new Error(`got ${failure._tag}`);
    assert.equal(failure.operation, "update");
    const afterFailure = yield* service.getInitiative({ initiativeId });
    assert.isTrue(afterFailure.tasks.find((task) => task.id === b.id)!.issue!.needsSync);

    const retried = yield* service.publishTaskIssue({ initiativeId, taskId: b.id });
    assert.notStrictEqual(retried.tasks.find((task) => task.id === b.id)!.issue!.needsSync, true);
    assert.equal(ghSubcommandCalls(harness, "edit"), 2);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("tells the adjustment planner that published unstarted tasks cannot be removed", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const { initiative, c } = yield* setupAdjustablePlan(service, harness);
    yield* service.publishTaskIssue({ initiativeId: initiative.id, taskId: c.id });
    yield* service.startPlanAdjustment({
      initiativeId: initiative.id,
      instructions: "Trim scope.",
      ...runOptions,
    });
    const prompt = harness.launchCalls.at(-1)!.input.initialMessage?.text ?? "";
    assert.include(prompt, `${c.id} — Task c\nState: not started, editable but NOT removable`);
    assert.include(prompt, "issue #42");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("a failed adjustment launch after an applied proposal never resurrects it", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const { initiative } = yield* setupAdjustablePlan(service, harness);
    const first = yield* service.startPlanAdjustment({
      initiativeId: initiative.id,
      instructions: "Add docs.",
      ...runOptions,
    });
    harness.complete(
      first.planner.threadId!,
      JSON.stringify({ summary: "docs", additions: [draft("docs")] }),
    );
    yield* service.refreshInitiative({ initiativeId: initiative.id });
    yield* service.applyPlanAdjustment({ initiativeId: initiative.id, expectedPlanRevision: 1 });

    harness.state.failNextLaunch = true;
    const failed = yield* Effect.flip(
      service.startPlanAdjustment({
        initiativeId: initiative.id,
        instructions: "Add tests.",
        ...runOptions,
      }),
    );
    assert.isTrue(isAtlasProviderLaunchError(failed));
    const refreshed = yield* service.refreshInitiative({ initiativeId: initiative.id });
    assert.equal(refreshed.planner.status, "failed");
    assert.isNull(refreshed.planner.threadId);
    assert.isNull(refreshed.planner.adjustment);
    assert.equal(refreshed.planner.baseRevision, 2);
    assert.equal(refreshed.tasks.length, 4);
    const recorded = refreshed.planner.launch!;

    const retried = yield* service.startPlanAdjustment({
      initiativeId: initiative.id,
      instructions: "Add tests.",
      ...runOptions,
    });
    assert.equal(retried.planner.status, "running");
    assert.equal(harness.launchCalls.at(-1)!.input.commandId, recorded.commandId);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("a failed full replan launch after an adjustment does not revive the old run", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const { initiative } = yield* setupAdjustablePlan(service, harness);
    const adjusting = yield* service.startPlanAdjustment({
      initiativeId: initiative.id,
      instructions: "Add docs.",
      ...runOptions,
    });
    harness.complete(adjusting.planner.threadId!, "not json");
    yield* service.refreshInitiative({ initiativeId: initiative.id });

    harness.state.failNextLaunch = true;
    yield* Effect.flip(service.startPlanning({ initiativeId: initiative.id, ...runOptions }));
    const refreshed = yield* service.refreshInitiative({ initiativeId: initiative.id });
    assert.equal(refreshed.planner.status, "failed");
    assert.equal(refreshed.planner.mode, "plan");
    assert.isNull(refreshed.planner.threadId);
    assert.notEqual(
      harness.launchCalls.at(-1)!.input.commandId,
      harness.launchCalls.at(-2)!.input.commandId,
    );
  }).pipe(Effect.provide(harness.layer));
});

it.effect("records a review launch failure on the task and clears it after a retry", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const { initiativeId, taskId } = yield* setupReviewableTask(service, harness);

    harness.state.failNextLaunch = true;
    const failed = yield* Effect.flip(
      service.startAgentReview({ initiativeId, taskId, ...runOptions }),
    );
    assert.isTrue(isAtlasProviderLaunchError(failed));
    const afterFailure = (yield* service.getInitiative({ initiativeId })).tasks[0]!;
    assert.equal(afterFailure.launch?.operation, "review");
    assert.isString(afterFailure.launch?.error);
    assert.isNull(afterFailure.agentReview);
    assert.equal(afterFailure.status, "needs_review");

    const retried = yield* service.startAgentReview({ initiativeId, taskId, ...runOptions });
    assert.equal(harness.launchCalls.at(-1)!.input.commandId, afterFailure.launch!.commandId);
    assert.isNull(retried.tasks[0]!.launch);
    assert.equal(retried.tasks[0]!.agentReview?.status, "running");
  }).pipe(Effect.provide(harness.layer));
});

const artifactBlock = (entries: unknown) =>
  `\`\`\`atlas-artifacts\n${JSON.stringify(entries)}\n\`\`\``;

it("parses the last artifact block and strips it from the summary", () => {
  const parsed = AtlasService.parseAtlasArtifacts(
    [
      "Added the auth flow doc.",
      artifactBlock([{ kind: "image", title: "Stale", path: "old.png" }]),
      "Verified with the unit tests.",
      artifactBlock([
        { kind: "document", title: "Auth flow", path: "./docs/auth.md", description: "Edge cases" },
        { kind: "link", title: "Preview", url: "https://example.com/preview" },
      ]),
    ].join("\n\n"),
  );
  assert.deepEqual(parsed.artifacts, [
    { kind: "document", title: "Auth flow", path: "docs/auth.md", description: "Edge cases" },
    { kind: "link", title: "Preview", url: "https://example.com/preview" },
  ]);
  assert.equal(
    parsed.summary,
    `Added the auth flow doc.\n\n${artifactBlock([{ kind: "image", title: "Stale", path: "old.png" }])}\n\nVerified with the unit tests.`,
  );
});

it("drops invalid and unsafe artifact entries individually", () => {
  const parsed = AtlasService.parseAtlasArtifacts(
    `Done.\n${artifactBlock([
      { kind: "image", title: "Kept", path: "shots/home.png" },
      { kind: "image", title: "Duplicate", path: "./shots/home.png" },
      { kind: "video", title: "Unknown kind", path: "clip.mp4" },
      { kind: "document", path: "missing-title.md" },
      { kind: "document", title: "No path" },
      { kind: "file", title: "Absolute", path: "/etc/passwd" },
      { kind: "file", title: "Home", path: "~/secrets.txt" },
      { kind: "file", title: "Drive", path: "C:\\Windows\\win.ini" },
      { kind: "file", title: "Escapes", path: "docs/../../outside.md" },
      { kind: "link", title: "Not http", url: "javascript:alert(1)" },
      { kind: "link", title: "No url", path: "page.html" },
      "not an object",
      { kind: "html", title: "Preview", path: "preview/index.html", url: "file:///tmp/x" },
    ])}`,
  );
  assert.deepEqual(parsed.artifacts, [
    { kind: "image", title: "Kept", path: "shots/home.png" },
    { kind: "html", title: "Preview", path: "preview/index.html" },
  ]);
  assert.equal(parsed.summary, "Done.");
});

it("caps reported artifacts", () => {
  const entries = Array.from({ length: 30 }, (_, index) => ({
    kind: "file",
    title: `File ${index}`,
    path: `out/${index}.txt`,
  }));
  assert.equal(AtlasService.parseAtlasArtifacts(artifactBlock(entries)).artifacts.length, 24);
});

it("keeps the result verbatim without a block and strips a malformed block", () => {
  const plain = "Implemented it.\n\n```ts\nconst x = 1;\n```";
  assert.deepEqual(AtlasService.parseAtlasArtifacts(plain), { artifacts: [], summary: plain });
  assert.deepEqual(
    AtlasService.parseAtlasArtifacts("Implemented it.\n```atlas-artifacts\n[{oops\n```"),
    { artifacts: [], summary: "Implemented it." },
  );
});

it.effect("carries the deliverable and reported artifacts from plan to review", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* service.importPlan({
      initiativeId: created.id,
      plan: plan(draft("doc", { deliverable: "A markdown doc at docs/auth.md." }), draft("bare")),
    });
    const task = taskByTitle(imported, "Task doc");
    assert.equal(task.deliverable, "A markdown doc at docs/auth.md.");
    assert.isNull(taskByTitle(imported, "Task bare").deliverable);

    const executed = yield* executeOnlyTask(service, created.id, task.id);
    assert.include(
      harness.launchCalls.at(-1)!.input.initialMessage!.text,
      "A markdown doc at docs/auth.md.",
    );
    assert.include(harness.launchCalls.at(-1)!.input.initialMessage!.text, "```atlas-artifacts");
    assert.deepEqual(executed.tasks.find((t) => t.id === task.id)!.execution?.artifacts, []);

    harness.complete(
      executed.tasks.find((t) => t.id === task.id)!.execution!.threadId,
      `Wrote the doc.\n\n${artifactBlock([{ kind: "document", title: "Auth", path: "docs/auth.md" }])}`,
    );
    const refreshed = yield* service.refreshInitiative({ initiativeId: created.id });
    const execution = refreshed.tasks.find((t) => t.id === task.id)!.execution!;
    assert.equal(execution.result, "Wrote the doc.");
    assert.deepEqual(execution.artifacts, [
      { kind: "document", title: "Auth", path: "docs/auth.md" },
    ]);

    yield* service.startAgentReview({ initiativeId: created.id, taskId: task.id, ...runOptions });
    const reviewText = harness.launchCalls.at(-1)!.input.initialMessage!.text;
    assert.include(reviewText, "A markdown doc at docs/auth.md.");
    assert.include(reviewText, "- [document] Auth: docs/auth.md");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("edits a published task's deliverable and marks its issue for sync", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AtlasService.AtlasService;
    const created = yield* createInitiative(service);
    const imported = yield* service.importPlan({
      initiativeId: created.id,
      plan: plan(draft("only", { deliverable: "Screenshot of the login page." })),
    });
    const taskId = imported.tasks[0]!.id;
    yield* service.publishTaskIssue({ initiativeId: created.id, taskId });
    const createCall = harness.processCalls.findLast(
      (call) => call.command === "gh" && call.args[1] === "create",
    )!;
    assert.include(
      createCall.args[createCall.args.indexOf("--body") + 1]!,
      "## Deliverable\nScreenshot of the login page.",
    );

    const adjusted = yield* service.applyPlanAdjustment({
      initiativeId: created.id,
      expectedPlanRevision: 1,
      adjustment: {
        summary: "Make the deliverable a doc.",
        updates: [{ taskId, deliverable: "Login flow doc at docs/login.md." }],
        additions: [],
        removals: [],
      },
    });
    assert.equal(adjusted.tasks[0]!.deliverable, "Login flow doc at docs/login.md.");
    assert.equal(adjusted.tasks[0]!.issue?.needsSync, true);
  }).pipe(Effect.provide(harness.layer));
});
