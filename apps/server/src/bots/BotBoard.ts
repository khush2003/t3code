import {
  type BotBoardItem,
  type BotBoardThread,
  BotName,
  type BotThreadStatus,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import type {
  BotEpisodeRecord,
  BotItemRecord,
  BotItemThreadRecord,
  BotThreadRef,
} from "./BotStore.ts";

const isBotName = Schema.is(BotName);

/** `bot:<name>`, or `bot:<name>:<generation>` for one started after a deleted thread. */
export function botNameFromThreadId(threadId: ThreadId): BotName | null {
  const name = /^bot:([^:]+)(?::\d+)?$/.exec(threadId)?.[1];
  return name !== undefined && isBotName(name) ? name : null;
}

const botThreadKey = (thread: BotThreadRef) => `${thread.environmentId}\0${thread.threadId}`;

const RESULT_CHARS = 600;
const trimResult = (text: string | null | undefined) =>
  text == null ? null : text.length <= RESULT_CHARS ? text : `${text.slice(0, RESULT_CHARS)}…`;

function shellStatus(shell: OrchestrationV2ThreadShell): BotThreadStatus {
  if (shell.pendingRuntimeRequest !== null) return "needs-input";
  if (shell.activeRunId !== null) return "working";
  switch (shell.status) {
    case "idle":
      return "idle";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
    case "interrupted":
    case "rolled_back":
      return "stopped";
    default:
      return "working";
  }
}

function taskStatus(task: OrchestrationV2Subagent): BotThreadStatus {
  switch (task.status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
    case "interrupted":
      return "stopped";
    case "idle":
      return "idle";
    default:
      return "working";
  }
}

const OUTCOMES: Record<string, BotThreadStatus> = {
  completed: "completed",
  failed: "failed",
  cancelled: "stopped",
  interrupted: "stopped",
};

/** The thread a task runs in, wherever it runs. */
export function taskThread(task: OrchestrationV2Subagent, hereId: EnvironmentId) {
  if (task.remoteChild !== undefined)
    return {
      environmentId: task.remoteChild.environmentId,
      threadId: task.remoteChild.threadId,
      where: task.remoteChild.label,
    };
  return task.childThreadId === null
    ? null
    : { environmentId: hereId, threadId: task.childThreadId, where: "here" };
}

export interface BoardSources {
  readonly hereId: EnvironmentId;
  readonly now: DateTime.Utc;
  readonly items: ReadonlyArray<BotItemRecord>;
  readonly links: ReadonlyArray<BotItemThreadRecord>;
  readonly episodes: ReadonlyArray<BotEpisodeRecord>;
  /** The bot thread's task records: they follow work on other machines too. */
  readonly tasks: ReadonlyArray<OrchestrationV2Subagent>;
  /** Threads on this machine, read now. */
  readonly shells: ReadonlyMap<ThreadId, OrchestrationV2ThreadShell | null>;
}

/**
 * What each thread is doing comes from the thread when it is here, from the task record that
 * follows it when it is elsewhere, and from its last recorded result when neither is known.
 * The bot's own words never set a status.
 */
function boardThread(
  link: BotItemThreadRecord | (BotThreadRef & { readonly title: string; readonly where: string }),
  sources: BoardSources,
): BotBoardThread {
  const key = botThreadKey(link);
  const episode = sources.episodes.find((candidate) => botThreadKey(candidate) === key);
  const task = sources.tasks.findLast((candidate) => {
    const thread = taskThread(candidate, sources.hereId);
    return thread !== null && botThreadKey(thread) === key;
  });
  const shell =
    link.environmentId === sources.hereId ? sources.shells.get(link.threadId) : undefined;
  const base = {
    environmentId: link.environmentId,
    threadId: link.threadId,
    title: shell?.title ?? link.title,
    where: link.where,
    result: trimResult(episode?.result ?? task?.result),
  };
  if (shell != null)
    return { ...base, status: shellStatus(shell), asOf: DateTime.formatIso(sources.now) };
  if (task !== undefined)
    return { ...base, status: taskStatus(task), asOf: DateTime.formatIso(task.updatedAt) };
  if (episode !== undefined)
    return { ...base, status: OUTCOMES[episode.outcome] ?? "unknown", asOf: episode.endedAt };
  return {
    ...base,
    status: "unknown",
    asOf: "linkedAt" in link ? link.linkedAt : DateTime.formatIso(sources.now),
  };
}

export function deriveBoard(sources: BoardSources): ReadonlyArray<BotBoardItem> {
  return sources.items.map((item) => ({
    id: item.id,
    title: item.title,
    detail: item.detail,
    nextStep: item.nextStep,
    state: item.state,
    updatedAt: item.updatedAt,
    threads: sources.links
      .filter((link) => link.itemId === item.id)
      .map((link) => boardThread(link, sources)),
  }));
}

/** Tasks the bot started that sit on no work item, so nothing it started drops out of sight. */
export function unfiledTasks(sources: BoardSources): ReadonlyArray<BotBoardThread> {
  const filed = new Set(sources.links.map(botThreadKey));
  return sources.tasks.flatMap((task) => {
    const thread = taskThread(task, sources.hereId);
    if (thread === null || filed.has(botThreadKey(thread)) || task.result !== null) return [];
    return [
      boardThread({ ...thread, title: task.title ?? task.prompt.slice(0, 60).trim() }, sources),
    ];
  });
}
