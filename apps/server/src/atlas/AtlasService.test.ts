import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  AtlasDependencyNotApprovedError,
  AtlasInitiativeBusyError,
  AtlasInitiativeNotFoundError,
  AtlasIssuePublishError,
  AtlasPlanImportError,
  AtlasPlanValidationError,
  AtlasProviderLaunchError,
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
