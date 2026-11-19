import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { msg, useGT, useMessages } from "gt-react";

import { cn } from "~/lib/utils";

import { type BotView, useBotSearch, useOpenBotView } from "./botView";

const VIEWS: ReadonlyArray<{
  readonly id: BotView | "chat";
  readonly label: string;
}> = [
  { id: "chat", label: msg("Chat", { $context: "tab showing the bot's conversation" }) },
  { id: "board", label: msg("Board", { $context: "tab showing a bot's work items" }) },
  { id: "files", label: msg("Files", { $context: "tab listing a bot's files" }) },
];

/** Chat, Board, Files: the three faces of one bot, switched in its header. */
export function BotViewSwitch(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const m = useMessages();
  const current = useBotSearch().bot ?? "chat";
  const openView = useOpenBotView();
  return (
    <div
      role="tablist"
      aria-label={gt("Bot views")}
      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-foreground/[0.05] p-0.5 [-webkit-app-region:no-drag]"
    >
      {VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          role="tab"
          aria-selected={current === view.id}
          className={cn(
            "h-6 cursor-pointer rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            current === view.id
              ? "bg-foreground/[0.09] text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() =>
            void openView(
              { environmentId: props.environmentId, threadId: props.threadId },
              view.id === "chat" ? {} : { bot: view.id },
            )
          }
        >
          {m(view.label)}
        </button>
      ))}
    </div>
  );
}
