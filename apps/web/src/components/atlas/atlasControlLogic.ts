import type { AtlasInitiative, ServerProvider, ThreadId } from "@t3tools/contracts";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";

import { formatContextWindowTokens } from "../../lib/contextWindow";
import type { AtlasAgentRuntime } from "./atlasControlState";
import { agentReviewStatusLabel, runFailure, taskStatusLabel } from "./atlasLogic";

export interface AtlasAgentRow {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly status: string;
  readonly running: boolean;
  readonly failed: boolean;
  /** Stopped for a recoverable reason, such as a provider rate limit. */
  readonly limited?: boolean;
  readonly startedAt: string;
  readonly threadId: ThreadId;
}

export function collectAtlasAgentRows(initiative: AtlasInitiative): AtlasAgentRow[] {
  const rows: AtlasAgentRow[] = [];
  if (initiative.planner.threadId)
    rows.push({
      key: "planner",
      kind: "Planner",
      title: initiative.title,
      status:
        initiative.planner.status === "running"
          ? "Running"
          : initiative.planner.status === "completed"
            ? "Completed"
            : "Failed",
      running: initiative.planner.status === "running",
      failed: initiative.planner.status === "failed",
      startedAt: initiative.updatedAt,
      threadId: initiative.planner.threadId,
    });
  for (const task of initiative.tasks) {
    if (task.execution) {
      const limited = runFailure(task)?.kind === "rate_limit";
      rows.push({
        key: `${task.id}-exec`,
        kind: task.specialty,
        title: task.title,
        status: limited ? "Rate limited" : taskStatusLabel(task.status),
        running: task.execution.status === "running",
        failed: task.execution.status === "failed" && !limited,
        limited,
        startedAt: task.execution.startedAt,
        threadId: task.execution.threadId,
      });
    }
    if (task.agentReview)
      rows.push({
        key: `${task.id}-review`,
        kind: "Reviewer",
        title: task.title,
        status: agentReviewStatusLabel(task.agentReview.status),
        running: task.agentReview.status === "running",
        failed: task.agentReview.status === "failed",
        startedAt: task.agentReview.startedAt,
        threadId: task.agentReview.threadId,
      });
  }
  return rows;
}

export function atlasAgentPriority(
  row: Pick<AtlasAgentRow, "running" | "failed" | "limited">,
  pending: PendingThreadRequests | null,
): number {
  if (pending && pending.approvals.length + pending.userInputs.length > 0) return 0;
  if (row.running) return 1;
  return row.failed || row.limited === true ? 2 : 3;
}

// Providers name their reasoning control differently: Codex `reasoningEffort`,
// Claude `effort`/`thinking`, OpenCode `variant`. Other traits (e.g. an agent) stay out of the row.
const REASONING_OPTION = /effort|reason|variant|think/i;

export interface AtlasAgentRuntimeLabels {
  readonly model: string;
  readonly reasoning: string | null;
  readonly tokens: string | null;
}

export function describeAtlasAgentRuntime(
  runtime: AtlasAgentRuntime | null,
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "models">>,
): AtlasAgentRuntimeLabels | null {
  const selection = runtime?.modelSelection ?? null;
  if (runtime === null || selection === null) return null;
  const model = providers
    .find((provider) => provider.instanceId === selection.instanceId)
    ?.models.find((candidate) => candidate.slug === selection.model);
  const descriptors = getProviderOptionDescriptors({
    caps: model?.capabilities ?? {},
    selections: selection.options ?? null,
  }).filter((descriptor) => REASONING_OPTION.test(descriptor.id));
  const reasoning =
    descriptors.length > 0
      ? descriptors.flatMap((descriptor) => {
          if (descriptor.type === "boolean")
            return descriptor.currentValue ? [descriptor.label] : [];
          const value =
            descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
          const choice = descriptor.options.find((option) => option.id === value);
          return choice ? [choice.label] : value ? [value] : [];
        })
      : // The catalog may no longer list the model; fall back to the raw selection.
        (selection.options ?? []).flatMap((option) =>
          REASONING_OPTION.test(option.id) && typeof option.value === "string"
            ? [option.value]
            : [],
        );
  const usage = runtime.tokenUsage;
  return {
    model: model?.name ?? selection.model,
    reasoning: reasoning.length > 0 ? reasoning.join(" · ") : null,
    tokens:
      usage === null
        ? null
        : usage.maxTokens
          ? `${formatContextWindowTokens(usage.usedTokens)} / ${formatContextWindowTokens(usage.maxTokens)} tokens`
          : `${formatContextWindowTokens(usage.usedTokens)} tokens`,
  };
}
