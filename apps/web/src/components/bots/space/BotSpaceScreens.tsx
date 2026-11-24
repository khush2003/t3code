import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type {
  BotBoardFile,
  BotBoardItem,
  BotBoardThread,
  BotSummary,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { findBotFile } from "@t3tools/shared/botShow";
import { T, useGT, useMessages } from "gt-react";
import { ArrowLeftIcon, ExternalLinkIcon, MessageSquareIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useAssetUrls } from "~/assets/assetUrls";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { useQuietThreadShell, useThreadStatus, useThreadVisibleTurnItems } from "~/state/entities";
import { useEnvironment } from "~/state/environments";

import { AttachmentFilePreview } from "../../files/AttachmentFilePreview";
import { Button } from "../../ui/button";
import { BotAvatar } from "../BotAvatar";
import { BotStateIcon, BotTaskStateLabel, useOpenBotTask } from "../BotBlocks";
import { botFileKind, sortBotTasks, splitBotFiles } from "../botBoard.logic";
import { useOpenBotView } from "../botView";
import { useBotBoard, useBotBoardAll } from "../useBot";
import { taskFeed, type SpaceScreen } from "./botSpace.logic";

type StartedBot = BotSummary & { readonly threadId: ThreadId };

const FEED_LINES = 16;
const NOTE = "px-4 py-3 text-sm text-white/50";
const ROW =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-start text-xs outline-none hover:bg-white/8 focus-visible:bg-white/8";

/** Pictures and other files a bot was handed, each opening on a screen of its own. */
function HandedOver(props: {
  readonly environmentId: EnvironmentId;
  readonly files: ReadonlyArray<BotBoardFile>;
  readonly onOpen: (file: BotBoardFile) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { images, others } = splitBotFiles(props.files);
  const urls = useAssetUrls(
    props.environmentId,
    images.flatMap((file) =>
      file.attachmentId === null
        ? []
        : [{ _tag: "attachment" as const, attachmentId: file.attachmentId }],
    ),
  );
  if (props.files.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {images.length === 0 ? null : (
        <div className="grid grid-cols-4 gap-1.5 px-1.5">
          {images.map((file, index) => (
            <button
              key={file.id}
              type="button"
              aria-label={gt("Show {title}", { title: file.title })}
              onClick={() => props.onOpen(file)}
              className="relative aspect-[16/10] overflow-hidden rounded-md bg-white/5 outline-none ring-1 ring-white/15 ring-inset hover:ring-white/40 focus-visible:ring-2 focus-visible:ring-white/60"
            >
              {urls[index] == null ? null : (
                <img
                  src={urls[index]}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover"
                />
              )}
            </button>
          ))}
        </div>
      )}
      {others.map((file) => (
        <button key={file.id} type="button" className={ROW} onClick={() => props.onOpen(file)}>
          <span className="min-w-0 flex-1 truncate text-white/85">{file.title}</span>
          <span className="shrink-0 text-white/45">{botFileKind(file, m)}</span>
        </button>
      ))}
    </div>
  );
}

function TaskRow(props: { readonly thread: BotBoardThread; readonly onOpen: () => void }) {
  return (
    <button type="button" onClick={props.onOpen} className={ROW}>
      <BotStateIcon status={props.thread.status} className="size-3.5" />
      <span className="min-w-0 flex-1 truncate text-white/85">{props.thread.title}</span>
      <span
        className={cn(
          "shrink-0",
          props.thread.status === "needs-input" ? "text-warning" : "text-white/45",
        )}
      >
        <BotTaskStateLabel thread={props.thread} />
      </span>
    </button>
  );
}

/** A bot's open work: each item with its tasks and what they handed over. */
function BoardScreen(props: {
  readonly environmentId: EnvironmentId;
  readonly bot: StartedBot;
  readonly onShow: (screen: SpaceScreen) => void;
}) {
  const { bot } = props;
  const board = useBotBoard(props.environmentId, bot.threadId);
  const items = board.data?.items ?? [];
  const unfiled = board.data?.unfiled ?? [];
  const task = (thread: BotBoardThread): SpaceScreen => ({
    kind: "task",
    bot: bot.name,
    environmentId: thread.environmentId,
    threadId: thread.threadId,
  });
  if (board.data === null)
    return <p className={NOTE}>{board.error ?? <T>Reading its board…</T>}</p>;
  if (items.length === 0 && unfiled.length === 0)
    return (
      <p className={NOTE}>
        <T>Nothing open. Ask it for something and the work shows here.</T>
      </p>
    );
  return (
    <ul className="flex flex-col gap-3 px-2 py-2">
      {[
        ...items.map((item) => ({ key: item.id as string, item, tasks: item.threads })),
        ...(unfiled.length === 0 ? [] : [{ key: "unfiled", item: null, tasks: unfiled }]),
      ].map(({ key, item, tasks }) => (
        <li key={key} className="px-2">
          <p className="text-sm text-white">
            {item === null ? <T>Other running tasks</T> : item.title}
            {item?.waitingOnYou ? (
              <span className="ms-2 text-warning text-xs">
                <T>Needs you</T>
              </span>
            ) : null}
          </p>
          {item === null || item.nextStep === "" ? null : (
            <p className="mt-0.5 text-white/50 text-xs">{item.nextStep}</p>
          )}
          {tasks.length === 0 ? null : (
            <ul className="mt-1.5 flex flex-col">
              {sortBotTasks(tasks).map((thread) => (
                <li key={`${thread.environmentId}:${thread.threadId}`}>
                  <TaskRow thread={thread} onOpen={() => props.onShow(task(thread))} />
                </li>
              ))}
            </ul>
          )}
          {item === null ? null : (
            <HandedOver
              environmentId={props.environmentId}
              files={item.files}
              onOpen={(file) => props.onShow({ kind: "file", bot: bot.name, file: file.id })}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/** A task as it works: how it stands, then what it writes and does, newest at the bottom. */
function TaskBody(props: {
  /** The machine the bots live on, where handed-over files are kept. */
  readonly home: EnvironmentId;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The task as its bot's board has it, when it is on one. */
  readonly thread: BotBoardThread | null;
  readonly files: ReadonlyArray<BotBoardFile>;
  readonly onOpenFile: (file: BotBoardFile) => void;
}) {
  const { thread } = props;
  const ref = scopeThreadRef(props.environmentId, props.threadId);
  const reachable = useEnvironment(props.environmentId) !== null;
  const shell = useQuietThreadShell(reachable ? ref : null);
  const live = useThreadStatus(shell === null ? null : ref) === "live";
  const lines = taskFeed(useThreadVisibleTurnItems(shell === null ? null : ref), FEED_LINES);
  const open = useOpenBotTask();
  const working = thread === null ? shell !== null && isThreadWorking(shell) : null;
  return (
    <>
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2 text-xs">
        {thread === null ? (
          <span className="text-white/60">{working ? <T>Running</T> : <T>Not running</T>}</span>
        ) : (
          <>
            <BotStateIcon status={thread.status} className="size-3.5" />
            <span className={thread.status === "needs-input" ? "text-warning" : "text-white/70"}>
              <BotTaskStateLabel thread={thread} />
            </span>
            <span className="min-w-0 flex-1 truncate text-white/40">{thread.where}</span>
          </>
        )}
        {shell === null ? null : (
          <Button
            variant="ghost-muted"
            size="xs"
            className="ms-auto"
            onClick={() =>
              void open({ environmentId: props.environmentId, threadId: props.threadId })
            }
          >
            <ExternalLinkIcon />
            <T>Open thread</T>
          </Button>
        )}
      </div>
      {/* Reversed so the newest line stays in view as lines arrive, with no scrolling code. */}
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-4 py-3">
        <div className="flex flex-col gap-2">
          {shell === null ? (
            <p className="text-sm text-white/50">
              {reachable ? (
                <T>This task's thread is not on this machine any more.</T>
              ) : (
                <T>This task runs on a machine that is not connected here.</T>
              )}
            </p>
          ) : lines.length === 0 ? (
            <p className="text-sm text-white/50">
              {live ? <T>Nothing written yet.</T> : <T>Reaching the task…</T>}
            </p>
          ) : (
            lines.map((line) =>
              line.kind === "says" ? (
                <p key={line.id} className="text-sm text-white/90">
                  {line.text}
                </p>
              ) : (
                <p key={line.id} className="truncate font-mono text-white/45 text-xs">
                  {line.text}
                </p>
              ),
            )
          )}
          {shell === null && thread?.result != null ? (
            <p className="text-sm whitespace-pre-wrap text-white/85">{thread.result}</p>
          ) : null}
        </div>
      </div>
      {props.files.length === 0 ? null : (
        <div className="border-t border-white/10 px-2.5 pt-1 pb-2.5">
          <HandedOver environmentId={props.home} files={props.files} onOpen={props.onOpenFile} />
        </div>
      )}
    </>
  );
}

const boardItems = (
  open: ReadonlyArray<BotBoardItem> | undefined,
  all: ReadonlyArray<BotBoardItem> | undefined,
) => [...(open ?? []), ...(all ?? []).filter((item) => item.state !== "open")];

/** A task of a known bot, with how its board has it and what it handed over. */
function BotTaskScreen(props: {
  readonly home: EnvironmentId;
  readonly bot: StartedBot;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly onShow: (screen: SpaceScreen) => void;
}) {
  const board = useBotBoard(props.home, props.bot.threadId).data;
  const finished = useBotBoardAll(props.home, props.bot.threadId).data;
  const items = boardItems(board?.items, finished?.items);
  const thread =
    [...items.flatMap((item) => item.threads), ...(board?.unfiled ?? [])].find(
      (candidate) => candidate.threadId === props.threadId,
    ) ?? null;
  return (
    <TaskBody
      home={props.home}
      environmentId={props.environmentId}
      threadId={props.threadId}
      thread={thread}
      files={items.flatMap((item) => item.files).filter((file) => file.threadId === props.threadId)}
      onOpenFile={(file) => props.onShow({ kind: "file", bot: props.bot.name, file: file.id })}
    />
  );
}

/** The handed-over file a screen names, found on its bot's board, open work or finished. */
function useBotFile(home: EnvironmentId, bot: StartedBot, wanted: string) {
  const board = useBotBoard(home, bot.threadId).data;
  const finished = useBotBoardAll(home, bot.threadId);
  return {
    file: findBotFile(
      boardItems(board?.items, finished.data?.items).flatMap((item) => item.files),
      wanted,
    ),
    looking: finished.data === null,
    error: finished.error,
  };
}

function FileBody(props: { readonly home: EnvironmentId; readonly file: BotBoardFile }) {
  const gt = useGT();
  const { file } = props;
  if (file.url !== null) {
    const url = file.url;
    return (
      <div className="flex flex-col items-start gap-3 px-4 py-4">
        <p className="break-all text-sm text-white/70">{url}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void ensureLocalApi().shell.openExternal(url)}
        >
          <ExternalLinkIcon />
          <T>Open the link</T>
        </Button>
      </div>
    );
  }
  if (file.attachmentId === null)
    return (
      <p className={NOTE}>
        {gt("No copy is kept. It was at {place} when handed over.", {
          place: file.sourcePath ?? gt("an unknown place"),
        })}
      </p>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AttachmentFilePreview
        name={file.name ?? file.title}
        mimeType={file.mimeType ?? "application/octet-stream"}
        sizeBytes={file.sizeBytes}
        asset={{ environmentId: props.home, attachmentId: file.attachmentId }}
        htmlRender
      />
    </div>
  );
}

/** The pane itself: lit by its bot and turned a little toward it, like a sheet of light. */
function Pane(props: {
  readonly color: string;
  readonly wide: boolean;
  readonly label: string;
  readonly header: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-4 top-14 bottom-44 flex items-center @3xl/space:inset-x-auto @3xl/space:right-8",
        props.wide ? "@3xl/space:w-[min(46rem,56%)]" : "@3xl/space:w-104",
      )}
    >
      <section
        aria-label={props.label}
        className={cn(
          "pointer-events-auto flex max-h-full w-full flex-col overflow-hidden rounded-2xl border bg-black/85 backdrop-blur-sm transition-[opacity,scale] duration-200 starting:scale-95 starting:opacity-0 motion-reduce:transition-none",
          props.wide ? "h-full" : null,
        )}
        style={{
          borderColor: `${props.color}66`,
          backgroundImage: `linear-gradient(180deg, ${props.color}1f, transparent 9rem)`,
          boxShadow: `0 0 70px -12px ${props.color}66, inset 0 0 40px -24px ${props.color}`,
          transform: props.wide
            ? "perspective(2400px) rotateY(-3deg)"
            : "perspective(1600px) rotateY(-7deg)",
        }}
      >
        <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
          {props.header}
        </header>
        {props.children}
      </section>
    </div>
  );
}

/** Whatever is being held up for the person: a bot's board, a task as it works, or a file. */
export function SpaceScreenPane(props: {
  /** The machine the bots live on. */
  readonly environmentId: EnvironmentId;
  readonly bots: ReadonlyArray<StartedBot>;
  readonly screen: SpaceScreen;
  readonly lights: (bot: StartedBot | null) => string;
  readonly onShow: (screen: SpaceScreen | null) => void;
}) {
  const gt = useGT();
  const { screen, environmentId: home } = props;
  const bot = props.bots.find((candidate) => candidate.name === screen.bot) ?? null;
  const openBot = useOpenBotView();
  const taskRef =
    screen.kind === "task" ? scopeThreadRef(screen.environmentId ?? home, screen.threadId) : null;
  const taskShell = useQuietThreadShell(taskRef);
  const close = (
    <Button
      variant="ghost-muted"
      size="icon-sm"
      aria-label={gt("Close the screen")}
      onClick={() => props.onShow(null)}
    >
      <XIcon />
    </Button>
  );
  const back =
    screen.kind === "board" || bot === null ? null : (
      <Button
        variant="ghost-muted"
        size="icon-sm"
        aria-label={gt("Back to {name}'s work", { name: bot.name })}
        onClick={() => props.onShow({ kind: "board", bot: bot.name })}
      >
        <ArrowLeftIcon />
      </Button>
    );
  const who =
    bot === null ? null : (
      <BotAvatar environmentId={home} name={bot.name} look={bot.look} size="sm" />
    );
  const title = (main: string, sub: string | null) => (
    <div className="min-w-0 flex-1">
      <h2 className="truncate font-medium text-sm text-white">{main}</h2>
      {sub === null ? null : <p className="truncate text-white/50 text-xs">{sub}</p>}
    </div>
  );

  if (screen.kind === "board") {
    if (bot === null) return null;
    return (
      <Pane
        color={props.lights(bot)}
        wide={false}
        label={gt("{name}'s work", { name: bot.name })}
        header={
          <>
            {who}
            {title(bot.name, bot.purpose)}
            <Button
              variant="ghost-muted"
              size="icon-sm"
              aria-label={gt("Open {name}'s chat", { name: bot.name })}
              onClick={() => void openBot({ environmentId: home, threadId: bot.threadId })}
            >
              <MessageSquareIcon />
            </Button>
            {close}
          </>
        }
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <BoardScreen environmentId={home} bot={bot} onShow={props.onShow} />
        </div>
      </Pane>
    );
  }

  if (screen.kind === "task") {
    const environmentId = screen.environmentId ?? home;
    return (
      <Pane
        color={props.lights(bot)}
        wide
        label={gt("A task at work")}
        header={
          <>
            {back}
            {who}
            {title(taskShell?.title ?? gt("Task"), bot?.name ?? null)}
            {close}
          </>
        }
      >
        {bot === null ? (
          <TaskBody
            home={home}
            environmentId={environmentId}
            threadId={screen.threadId}
            thread={null}
            files={[]}
            onOpenFile={() => undefined}
          />
        ) : (
          <BotTaskScreen
            home={home}
            bot={bot}
            environmentId={environmentId}
            threadId={screen.threadId}
            onShow={props.onShow}
          />
        )}
      </Pane>
    );
  }

  if (bot === null) return null;
  return (
    <FilePane home={home} bot={bot} wanted={screen.file} color={props.lights(bot)}>
      {back}
      {who}
      {close}
    </FilePane>
  );
}

/** One handed-over file, shown the way the app shows any file: a picture, a page, a recording. */
function FilePane(props: {
  readonly home: EnvironmentId;
  readonly bot: StartedBot;
  readonly wanted: string;
  readonly color: string;
  /** Back, the bot's face and close, in that order. */
  readonly children: readonly [ReactNode, ReactNode, ReactNode];
}) {
  const gt = useGT();
  const { file, looking, error } = useBotFile(props.home, props.bot, props.wanted);
  const [back, who, close] = props.children;
  return (
    <Pane
      color={props.color}
      wide
      label={gt("A file from {name}", { name: props.bot.name })}
      header={
        <>
          {back}
          {who}
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-medium text-sm text-white">
              {file?.title ?? props.wanted}
            </h2>
            <p className="truncate text-white/50 text-xs">{props.bot.name}</p>
          </div>
          {close}
        </>
      }
    >
      {file !== null ? (
        <FileBody home={props.home} file={file} />
      ) : (
        <p className={NOTE}>
          {looking
            ? (error ?? <T>Looking for it…</T>)
            : gt("{name} has no handed-over file called {file}.", {
                name: props.bot.name,
                file: props.wanted,
              })}
        </p>
      )}
    </Pane>
  );
}
