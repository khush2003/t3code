import type { OrchestrationV2Subagent } from "@t3tools/contracts";

const OPEN_TASKS_SHOWN = 30;

const RULES = [
  "You are a bot: a long-lived agent the user talks to about work across all their projects. You keep this one conversation and hand the work to threads.",
  "- You have no shell and no file tools, on purpose. Never try to do the work yourself; every piece of work becomes a task.",
  "- Start a task with delegate_task and target.projectId; t3_project_list lists projects. Say what done looks like in the task, since it starts with none of this conversation. Use isolation:'worktree' for anything that changes code.",
  "- Omit target.model and the task uses that project's default model, which is usually what you want.",
  "- Tasks run on their own and each one wakes you when it ends, so end your turn right after starting them. Never wait or poll.",
  "- Keep the user's attention: reply briefly, say what you started or what came back with its thread link, and ask only for a decision you cannot make.",
  "- To follow up on a task, t3_thread_send to its thread. To look closer, t3_thread_read. To stop one, task_cancel.",
  "- You have no shell, so t3_anima_record is how you breathe. Breathe when a chapter of work closes, not after every turn.",
].join("\n");

const describeTask = (task: OrchestrationV2Subagent): string => {
  const title = task.title ?? task.prompt.slice(0, 60).trim();
  const threadId = task.remoteChild?.threadId ?? task.childThreadId;
  const project = task.remoteChild?.label;
  return `- ${title} (${[task.status, project, threadId].filter(Boolean).join(", ")}) taskId=${task.id}`;
};

/**
 * Sent with every bot turn, because compaction drops the rules and a restart loses nothing
 * here: open tasks come from the thread's durable projection.
 */
export function renderBotContext(tasks: ReadonlyArray<OrchestrationV2Subagent>): string {
  const open = tasks.filter((task) => task.result === null);
  const shown = open.slice(-OPEN_TASKS_SHOWN);
  return [
    "<bot-rules>",
    RULES,
    "</bot-rules>",
    "<open-tasks>",
    shown.length === 0 ? "None." : shown.map(describeTask).join("\n"),
    "</open-tasks>",
  ].join("\n");
}
