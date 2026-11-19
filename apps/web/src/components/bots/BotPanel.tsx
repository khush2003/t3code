import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  BotBoardItem,
  BotBoardThread,
  BotThread,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import {
  BrainIcon,
  CircleAlertIcon,
  EllipsisIcon,
  LoaderCircleIcon,
  MessagesSquareIcon,
  MonitorIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { useRelativeTimeState } from "~/hooks/useRelativeTimeState";
import { cn } from "~/lib/utils";
import { useQuietThreadShell } from "~/state/entities";
import { useEnvironment } from "~/state/environments";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";

import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { getTriggerDisplayModelName } from "../chat/providerIconUtils";
import { ThreadBotMemoryDialog } from "../chat/ThreadBotMemoryDialog";
import { hasUnseenCompletion } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { BotLookPicker } from "./BotAvatar";
import { BotHint, BotImageStrip, useOpenBotTask } from "./BotBlocks";
import { botItemColumn, splitBotFiles } from "./botBoard.logic";
import { botMainThreadId, useOpenBotView } from "./botView";
import { startedBotThreads, useBotBoard, useBotSummary, useOpenBotThread } from "./useBot";

const ROW =
  "cursor-pointer outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";
const CARD = "rounded-xl border border-border/70";

function Section(props: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="mt-4 first:mt-0">
      <div className="mb-1.5 flex h-5 items-center justify-between">
        <h3 className="text-xs text-muted-foreground select-none">{props.title}</h3>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

function NeedsYouCard(props: { readonly item: BotBoardItem; readonly onOpen: () => void }) {
  const { item } = props;
  return (
    <button
      type="button"
      className={cn(CARD, ROW, "flex w-full gap-2.5 px-3 py-2.5 text-left")}
      onClick={props.onOpen}
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
        {item.nextStep === "" ? null : (
          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
            {item.nextStep}
          </span>
        )}
      </span>
    </button>
  );
}

function RunningRow(props: { readonly thread: BotBoardThread }) {
  const gt = useGT();
  const { thread } = props;
  const open = useOpenBotTask();
  const reachable = useEnvironment(thread.environmentId) !== null;
  const since = useRelativeTimeState(thread.startedAt);
  return (
    <BotHint hint={reachable ? undefined : gt("Connect to its machine to open this task.")}>
      <button
        type="button"
        aria-disabled={!reachable || undefined}
        className={cn(
          CARD,
          ROW,
          "flex w-full gap-2.5 px-3 py-2.5 text-left aria-disabled:cursor-default",
        )}
        onClick={() => {
          if (reachable) void open(thread);
        }}
      >
        <LoaderCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{thread.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{thread.where}</span>
        </span>
        {since.status === "relative" && since.suffix !== null ? (
          <span className="shrink-0 text-xs text-muted-foreground">{since.value}</span>
        ) : null}
      </button>
    </BotHint>
  );
}

function ThreadRow(props: { readonly environmentId: EnvironmentId; readonly thread: BotThread }) {
  const { thread } = props;
  const open = useOpenBotThread();
  const shell = useQuietThreadShell(scopeThreadRef(props.environmentId, thread.threadId));
  const last = useRelativeTimeState(thread.lastReplyAt);
  const unseen = shell !== null && hasUnseenCompletion(shell);
  // Put away: it is still under Threads in the sidebar.
  if (shell === null || shell.settledOverride === "settled") return null;
  return (
    <button
      type="button"
      className={cn(
        ROW,
        "-mx-1.5 flex h-7.5 w-[calc(100%+0.75rem)] items-center gap-2.5 rounded-lg px-1.5 text-left",
      )}
      onClick={() => open(props.environmentId, thread.threadId)}
    >
      <MessagesSquareIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          unseen ? "font-medium text-foreground" : "text-foreground/85",
        )}
      >
        {thread.title}
      </span>
      {unseen ? (
        <span className="shrink-0 text-xs font-medium text-primary">
          <T>New</T>
        </span>
      ) : last.status === "relative" ? (
        <span className="shrink-0 text-xs text-muted-foreground">{last.value}</span>
      ) : null}
    </button>
  );
}

function Pill(props: { readonly tone: "warning" | "running"; readonly children: ReactNode }) {
  const Icon = props.tone === "warning" ? CircleAlertIcon : LoaderCircleIcon;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium",
        props.tone === "warning"
          ? "bg-warning/12 text-warning"
          : "bg-foreground/[0.06] text-foreground/85",
      )}
    >
      <Icon aria-hidden className={cn("size-3.5", props.tone === "running" && "text-primary")} />
      {props.children}
    </span>
  );
}

function BotModel(props: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId }) {
  const shell = useQuietThreadShell(scopeThreadRef(props.environmentId, props.threadId));
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(props.environmentId)) ??
    EMPTY_SERVER_PROVIDERS;
  if (shell === null) return null;
  const provider = providers.find(
    (candidate) => candidate.instanceId === shell.modelSelection.instanceId,
  );
  const model = provider?.models.find((candidate) => candidate.slug === shell.modelSelection.model);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {provider === undefined ? null : (
        <ProviderInstanceIcon
          driverKind={provider.driver}
          displayName={provider.displayName ?? provider.instanceId}
          className="size-3.5 shrink-0"
        />
      )}
      <span className="truncate">
        {model === undefined
          ? shell.modelSelection.model
          : getTriggerDisplayModelName(model, provider?.driver)}
      </span>
    </span>
  );
}

/** A bot at a glance beside its chat: what waits on you, what runs, its threads and its files. */
export function BotPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const { environmentId } = props;
  const main = botMainThreadId(props.threadId);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const board = useBotBoard(environmentId, props.threadId);
  const bot = useBotSummary(environmentId, props.threadId);
  const machine = useEnvironment(environmentId);
  const openView = useOpenBotView();
  const target = { environmentId, threadId: main };

  const items = board.data?.items ?? [];
  const open = items.filter((item) => item.state === "open");
  const needsYou = open.filter((item) => botItemColumn(item) === "needs-you");
  const running = [...open.flatMap((item) => item.threads), ...(board.data?.unfiled ?? [])].filter(
    (thread) => thread.status === "working",
  );
  const threads = startedBotThreads(bot?.threads ?? []);
  const files = splitBotFiles(items.flatMap((item) => item.files));
  const fileCount = files.images.length + files.others.length;

  return (
    <section data-bot-panel aria-label={gt("Bot")} className="flex flex-col px-4.5 pt-4 pb-3">
      <div className="flex items-start gap-3">
        <BotLookPicker
          environmentId={environmentId}
          threadId={main}
          name={board.data?.name ?? bot?.name ?? "?"}
          look={bot?.look}
        />
        <div className="min-w-0 flex-1 self-center">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {board.data?.name ?? bot?.name ?? gt("Bot")}
          </h2>
          {(board.data?.purpose ?? bot?.purpose ?? "") === "" ? null : (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {board.data?.purpose ?? bot?.purpose}
            </p>
          )}
        </div>
        <Menu>
          <MenuTrigger
            render={<Button variant="ghost" size="icon-xs" aria-label={gt("Bot menu")} />}
          >
            <EllipsisIcon aria-hidden />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => void openView(target, { bot: "board" })}>
              <T>Open board</T>
            </MenuItem>
            <MenuItem onClick={() => void openView(target, { bot: "files" })}>
              <T>Open files</T>
            </MenuItem>
            <MenuItem onClick={() => setMemoryOpen(true)}>
              <T>Memory and charter</T>
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      {needsYou.length === 0 && running.length === 0 ? null : (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {needsYou.length === 0 ? null : (
            <Pill tone="warning">
              {gt("{count, plural, one {{count} needs you} other {{count} need you}}", {
                count: needsYou.length,
              })}
            </Pill>
          )}
          {running.length === 0 ? null : (
            <Pill tone="running">{gt("{count} running", { count: running.length })}</Pill>
          )}
        </div>
      )}

      <div className="mt-4">
        {board.data === null ? (
          board.error === null ? null : (
            <p className="text-xs text-muted-foreground">
              <T>The board could not be read.</T>
            </p>
          )
        ) : needsYou.length === 0 && running.length === 0 && open.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            <T>No open work. Ask for something and it shows up here.</T>
          </p>
        ) : null}

        {needsYou.length === 0 ? null : (
          <Section title={gt("Needs you")}>
            <div className="flex flex-col gap-2">
              {needsYou.map((item) => (
                <NeedsYouCard
                  key={item.id}
                  item={item}
                  onOpen={() => void openView(target, { bot: "board", item: item.id })}
                />
              ))}
            </div>
          </Section>
        )}

        {running.length === 0 ? null : (
          <Section title={gt("Running")}>
            <div className="flex flex-col gap-2">
              {running.map((thread) => (
                <RunningRow key={`${thread.environmentId}:${thread.threadId}`} thread={thread} />
              ))}
            </div>
          </Section>
        )}

        {threads.length === 0 ? null : (
          <Section title={gt("Threads")}>
            <div className="flex flex-col">
              {threads.slice(0, 5).map((thread) => (
                <ThreadRow key={thread.threadId} environmentId={environmentId} thread={thread} />
              ))}
            </div>
          </Section>
        )}

        {fileCount === 0 ? null : (
          <Section
            title={gt("Latest files")}
            action={
              <button
                type="button"
                className={cn(ROW, "-me-1 rounded-md px-1 text-xs text-muted-foreground")}
                onClick={() => void openView(target, { bot: "files" })}
              >
                {gt("All {count}", { count: fileCount })}
              </button>
            }
          >
            <BotImageStrip
              environmentId={environmentId}
              images={files.images.slice(0, 3)}
              max={3}
              className="grid grid-cols-3 gap-1.5"
              cellClassName="aspect-[16/10]"
            />
            {files.images.length > 0 ? null : (
              <button
                type="button"
                className={cn(ROW, "-mx-1.5 rounded-lg px-1.5 py-1 text-sm text-foreground/85")}
                onClick={() => void openView(target, { bot: "files" })}
              >
                {files.others[0]?.title}
              </button>
            )}
          </Section>
        )}
      </div>

      <div className="mt-4 flex h-7 items-center gap-3 text-xs text-muted-foreground">
        {machine === null ? null : (
          <span className="flex min-w-0 items-center gap-1.5">
            <MonitorIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{machine.label}</span>
          </span>
        )}
        <BotModel environmentId={environmentId} threadId={main} />
        <button
          type="button"
          className={cn(
            ROW,
            "-me-1.5 ms-auto flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 font-medium text-foreground/85",
          )}
          onClick={() => setMemoryOpen(true)}
        >
          <BrainIcon aria-hidden className="size-3.5" />
          <T>Memory</T>
        </button>
      </div>
      <ThreadBotMemoryDialog
        environmentId={environmentId}
        threadId={props.threadId}
        open={memoryOpen}
        onOpenChange={setMemoryOpen}
      />
    </section>
  );
}
