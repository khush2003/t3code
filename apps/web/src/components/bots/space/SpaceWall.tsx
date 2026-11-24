import s from "./space.module.css";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  ThreadId,
  type BotBoardFile,
  type BotBoardThread,
  type EnvironmentId,
} from "@t3tools/contracts";
import { findBotFile } from "@t3tools/shared/botShow";
import { useGT, useMessages } from "gt-react";
import { ExternalLinkIcon, XIcon } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";

import { useAssetUrls } from "~/assets/assetUrls";
import { ensureLocalApi } from "~/localApi";
import { useQuietThreadShell, useThreadStatus, useThreadVisibleTurnItems } from "~/state/entities";
import { useEnvironment } from "~/state/environments";

import ChatMarkdown from "../../ChatMarkdown";
import { AttachmentFilePreview } from "../../files/AttachmentFilePreview";
import { BotTaskStateLabel, useOpenBotTask } from "../BotBlocks";
import { botFileKind, sortBotTasks } from "../botBoard.logic";
import { taskFeed, type SpaceScreen } from "./botSpace.logic";
import { spaceTasks, type SpaceBoard, type SpaceTask } from "./spaceBoards";
import {
  boardRows,
  firstPiece,
  recentPictures,
  type RecentPicture,
  isBotPicture,
  taskBrief,
  taskPieces,
  taskPlan,
  type WallPiece,
} from "./spaceWall.logic";

const lit = (color: string) => ({ "--c": color }) as CSSProperties;
const FEED_LINES = 40;
const TILE_LINES = 6;
/** More tiles than this and none is large enough to read. */
const TILES = 4;

/** The pictures among `files`, by file id, as addresses the browser can load. */
function usePictureUrls(home: EnvironmentId, files: ReadonlyArray<BotBoardFile>) {
  const pictures = files.filter(isBotPicture);
  const urls = useAssetUrls(
    home,
    pictures.map((file) => ({ _tag: "attachment" as const, attachmentId: file.attachmentId! })),
  );
  return new Map(pictures.map((file, index) => [file.id, urls[index] ?? null]));
}

/** What a task has planned, then what it writes and does, newest at the bottom and kept in view. */
function TaskWork(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly lines: number;
  /** Whether to say what the task was asked, where there is room for it. */
  readonly brief?: boolean;
}) {
  const gt = useGT();
  const ref = scopeThreadRef(props.environmentId, props.threadId);
  const reachable = useEnvironment(props.environmentId) !== null;
  const shell = useQuietThreadShell(reachable ? ref : null);
  const live = useThreadStatus(shell === null ? null : ref) === "live";
  const items = useThreadVisibleTurnItems(shell === null ? null : ref);
  const plan = taskPlan(items);
  const lines = taskFeed(items, props.lines);
  const brief = props.brief ? taskBrief(items) : "";
  if (shell === null)
    return (
      <p className={s.note}>
        {reachable
          ? gt("This task's thread is not on this machine any more.")
          : gt("This task runs on a machine that is not connected here.")}
      </p>
    );
  return (
    <>
      {brief === "" ? null : (
        <p className={s.brief}>
          <b>{gt("Asked to")}</b>
          {brief}
        </p>
      )}
      {plan.length === 0 ? null : (
        <ul className={s.plan}>
          {plan.map((step) => (
            <li
              key={step.id}
              className={
                step.status === "completed" ? s.isDone : step.status === "running" ? s.isDoing : ""
              }
            >
              {step.text}
            </li>
          ))}
        </ul>
      )}
      <div className={s.feed}>
        <div>
          {lines.length === 0 ? (
            <p className={s.isDoes}>
              {live ? gt("Nothing written yet.") : gt("Reaching the task…")}
            </p>
          ) : (
            lines.map((line) => (
              <p key={line.id} className={line.kind === "does" ? s.isDoes : undefined}>
                {line.text}
              </p>
            ))
          )}
        </div>
      </div>
    </>
  );
}

/** Two pictures of one thing, before a change and after it. */
function Pair(props: {
  readonly before: string | null;
  readonly after: string | null;
  readonly show: "both" | "before" | "after";
}) {
  const gt = useGT();
  const side = (url: string | null, label: string) => (
    <figure className={s.shot}>
      {url === null ? null : <img src={url} alt="" />}
      <figcaption>{label}</figcaption>
    </figure>
  );
  return (
    <>
      {props.show === "after" ? null : side(props.before, gt("Before"))}
      {props.show === "before" ? null : side(props.after, gt("After"))}
    </>
  );
}

/** One handed-over file as the thing it is: a picture, a recording, a page to use, a document. */
function FileBody(props: {
  readonly home: EnvironmentId;
  readonly file: BotBoardFile;
  readonly url: string | null;
}) {
  const gt = useGT();
  const { file } = props;
  if (file.url !== null) {
    const url = file.url;
    // A page of this app's own origin could reach the app from a frame, so only others are framed.
    const foreign = URL.canParse(url) && new URL(url).origin !== window.location.origin;
    return (
      <>
        {foreign ? (
          <iframe
            className={s.frame}
            src={url}
            title={file.title}
            // oxlint-disable-next-line react/iframe-missing-sandbox -- a page from another origin needs its scripts and its own storage to run; it still cannot reach this app or navigate it
            sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
            allow="fullscreen; autoplay; gamepad"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <div className={s.link}>
          <p>{url}</p>
        </div>
      </>
    );
  }
  if (file.attachmentId === null)
    return (
      <p className={s.note}>
        {gt("No copy is kept. It was at {place} when handed over.", {
          place: file.sourcePath ?? gt("an unknown place"),
        })}
      </p>
    );
  if (isBotPicture(file))
    return (
      <figure className={s.shot}>
        {props.url === null ? null : <img src={props.url} alt="" />}
      </figure>
    );
  return (
    <div className={s.file}>
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

function Holo(props: {
  readonly color: string;
  readonly label: string;
  readonly title: string;
  readonly sub: ReactNode;
  readonly tools?: ReactNode;
  readonly bare?: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  return (
    <section className={s.holo} aria-label={props.label} style={lit(props.color)}>
      <div className={s.cone} />
      <header className={s.head}>
        <i />
        <div className={s.title}>
          <h2>{props.title}</h2>
          <p>{props.sub}</p>
        </div>
        {props.tools}
        <button
          type="button"
          className={s.tool}
          aria-label={gt("Close the screen")}
          onClick={props.onClose}
        >
          <XIcon />
        </button>
      </header>
      <div className={props.bare ? `${s.body} ${s.isBare}` : s.body}>{props.children}</div>
    </section>
  );
}

/**
 * A task, shown by what tells the most about it: the pictures it handed over, then its other
 * files, its result, and its work as it goes. The row beneath flips between them.
 */
function TaskHolo(props: {
  readonly home: EnvironmentId;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly task: SpaceTask | null;
  /** The file to open on, when the screen was asked for one file of the task. */
  readonly open: BotBoardFile | null;
  readonly color: string;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { task } = props;
  const openThread = useOpenBotTask();
  const reachable = useEnvironment(props.environmentId) !== null;
  const shell = useQuietThreadShell(
    reachable ? scopeThreadRef(props.environmentId, props.threadId) : null,
  );
  const files = task?.files ?? (props.open === null ? [] : [props.open]);
  const pieces = taskPieces(task?.thread ?? null, files, shell !== null);
  const urls = usePictureUrls(props.home, files);
  const [picked, setPicked] = useState<string | null>(null);
  const [sides, setSides] = useState<"both" | "before" | "after">("both");
  const wanted =
    props.open === null
      ? undefined
      : pieces.find(
          (piece) =>
            (piece.kind === "file" && piece.file.id === props.open!.id) ||
            (piece.kind === "pair" &&
              (piece.before.id === props.open!.id || piece.after.id === props.open!.id)),
        );
  const piece =
    pieces.find((candidate) => candidate.id === picked) ??
    wanted ??
    firstPiece(pieces, task?.thread.status === "working");
  const pieceTitle = (of: WallPiece) =>
    of.kind === "pair"
      ? of.title
      : of.kind === "file"
        ? of.file.title
        : of.kind === "result"
          ? gt("Result")
          : gt("Its work");
  const taskTitle = task?.thread.title ?? shell?.title ?? gt("Task");
  const fileUrl = piece?.kind === "file" ? (urls.get(piece.file.id) ?? null) : null;

  return (
    <>
      <Holo
        color={props.color}
        label={gt("A task: {title}", { title: taskTitle })}
        title={
          piece === undefined || piece.kind === "activity" || piece.kind === "result"
            ? taskTitle
            : pieceTitle(piece)
        }
        sub={
          <>
            {task === null ? null : `${task.bot} · `}
            {piece?.kind === "pair" || piece?.kind === "file" ? `${taskTitle} · ` : null}
            {task === null ? null : (
              <span className={task.thread.status === "needs-input" ? s.isNeed : undefined}>
                <BotTaskStateLabel thread={task.thread} />
              </span>
            )}
          </>
        }
        tools={
          <>
            {piece?.kind !== "pair"
              ? null
              : (["both", "before", "after"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    className={side === sides ? `${s.tool} ${s.isOn}` : s.tool}
                    aria-pressed={side === sides}
                    onClick={() => setSides(side)}
                  >
                    {side === "both" ? gt("Both") : side === "before" ? gt("Before") : gt("After")}
                  </button>
                ))}
            {piece?.kind === "file" && piece.file.url !== null ? (
              <button
                type="button"
                className={s.tool}
                onClick={() => void ensureLocalApi().shell.openExternal(piece.file.url!)}
              >
                <ExternalLinkIcon />
                {gt("Open in a tab")}
              </button>
            ) : fileUrl !== null ? (
              <button
                type="button"
                className={s.tool}
                onClick={() => void ensureLocalApi().shell.openExternal(fileUrl)}
              >
                <ExternalLinkIcon />
                {gt("Full size")}
              </button>
            ) : shell !== null && (piece === undefined || piece.kind !== "file") ? (
              <button
                type="button"
                className={s.tool}
                onClick={() =>
                  void openThread({ environmentId: props.environmentId, threadId: props.threadId })
                }
              >
                <ExternalLinkIcon />
                {gt("Open thread")}
              </button>
            ) : null}
          </>
        }
        bare={piece?.kind === "file" && !isBotPicture(piece.file) && piece.file.url === null}
        onClose={props.onClose}
      >
        {piece === undefined ? (
          <p className={s.note}>{gt("Nothing to show for this task yet.")}</p>
        ) : piece.kind === "pair" ? (
          <Pair
            before={urls.get(piece.before.id) ?? null}
            after={urls.get(piece.after.id) ?? null}
            show={sides}
          />
        ) : piece.kind === "file" ? (
          <FileBody home={props.home} file={piece.file} url={fileUrl} />
        ) : piece.kind === "result" ? (
          <div className={s.result}>
            <ChatMarkdown text={piece.text} cwd={undefined} />
          </div>
        ) : (
          <TaskWork
            environmentId={props.environmentId}
            threadId={props.threadId}
            lines={FEED_LINES}
            brief
          />
        )}
      </Holo>
      {pieces.length < 2 ? null : (
        <div className={s.rail} style={lit(props.color)}>
          <span className={s.railLabel}>{gt("From this task")}</span>
          {pieces.map((of) => {
            const picture =
              of.kind === "pair"
                ? urls.get(of.after.id)
                : of.kind === "file"
                  ? urls.get(of.file.id)
                  : undefined;
            return (
              <button
                key={of.id}
                type="button"
                className={of === piece ? `${s.thumb} ${s.isOn}` : s.thumb}
                aria-pressed={of === piece}
                aria-label={pieceTitle(of)}
                onClick={() => setPicked(of.id)}
              >
                {picture != null ? (
                  <img src={picture} alt="" loading="lazy" />
                ) : (
                  <>
                    <b>{pieceTitle(of)}</b>
                    <span>
                      {of.kind === "file"
                        ? botFileKind(of.file, m)
                        : of.kind === "result"
                          ? gt("What it reported")
                          : task?.thread.status === "working"
                            ? gt("Live")
                            : gt("Step by step")}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/** A running task as a tile: its plan and last lines, to watch without opening it. */
function WorkTile(props: {
  readonly task: SpaceTask;
  readonly color: string;
  readonly big: boolean;
  readonly onOpen: () => void;
}) {
  const { thread } = props.task;
  return (
    <button
      type="button"
      className={props.big ? `${s.tile} ${s.isBig}` : s.tile}
      style={lit(props.color)}
      onClick={props.onOpen}
    >
      <h3>{thread.title}</h3>
      <span
        className={
          thread.status === "needs-input"
            ? `${s.tileTime} ${s.num} ${s.isNeed}`
            : `${s.tileTime} ${s.num}`
        }
      >
        <BotTaskStateLabel thread={thread} />
      </span>
      <div className={s.tileSub}>
        <b>{props.task.bot}</b>
        <span>{thread.where}</span>
      </div>
      <TaskWork
        environmentId={thread.environmentId}
        threadId={thread.threadId}
        lines={props.big ? TILE_LINES * 2 : TILE_LINES}
      />
    </button>
  );
}

/** Something a task handed over lately, to look at while nothing else is held up. */
function PictureTile(props: {
  readonly picture: RecentPicture;
  readonly url: string | null;
  readonly color: string;
  readonly big: boolean;
  readonly onOpen: () => void;
}) {
  const { picture } = props;
  return (
    <button
      type="button"
      className={props.big ? `${s.tile} ${s.isShot} ${s.isBig}` : `${s.tile} ${s.isShot}`}
      style={lit(props.color)}
      onClick={props.onOpen}
    >
      {props.url === null ? null : <img src={props.url} alt="" loading="lazy" />}
      <div>
        <h3>{picture.file.title}</h3>
        <div className={s.tileSub}>
          <b>{picture.bot}</b>
          <span>{picture.item}</span>
        </div>
      </div>
    </button>
  );
}

/** With nothing held up: the work going on now, then the newest things the bots have made. */
function IdleWall(props: {
  readonly home: EnvironmentId;
  readonly boards: ReadonlyArray<SpaceBoard>;
  readonly tasks: ReadonlyArray<SpaceTask>;
  readonly light: (bot: string | null) => string;
  readonly onShow: (screen: SpaceScreen | null) => void;
}) {
  const { tasks } = props;
  const live = sortBotTasks(
    tasks
      .map((task) => task.thread)
      .filter((thread) => thread.status === "working" || thread.status === "needs-input"),
  ).slice(0, TILES);
  const recent = recentPictures(props.boards, TILES - live.length);
  const urls = usePictureUrls(
    props.home,
    recent.map((picture) => picture.file),
  );
  // An odd one out would leave a hole; the first tile takes the whole row instead.
  const odd = (live.length + recent.length) % 2 === 1;
  return (
    <section className={s.wall}>
      <div className={s.tiles}>
        {live.map((thread, index) => {
          const task = tasks.find((candidate) => candidate.thread === thread)!;
          return (
            <WorkTile
              key={`${thread.environmentId}:${thread.threadId}`}
              task={task}
              color={props.light(task.bot)}
              big={index === 0 && odd}
              onOpen={() => props.onShow(taskScreen(task))}
            />
          );
        })}
        {recent.map((picture, index) => (
          <PictureTile
            key={picture.file.id}
            picture={picture}
            url={urls.get(picture.file.id) ?? null}
            color={props.light(picture.bot)}
            big={live.length === 0 && index === 0 && odd}
            onOpen={() => props.onShow({ kind: "file", bot: picture.bot, file: picture.file.id })}
          />
        ))}
      </div>
    </section>
  );
}

const taskScreen = (task: SpaceTask): SpaceScreen => ({
  kind: "task",
  bot: task.bot,
  environmentId: task.thread.environmentId,
  threadId: task.thread.threadId,
});

/** A bot's open work at a glance, for when it is asked for. A row opens what it stands for. */
function BoardHolo(props: {
  readonly home: EnvironmentId;
  readonly board: SpaceBoard;
  readonly purpose: string;
  readonly color: string;
  readonly onShow: (screen: SpaceScreen | null) => void;
}) {
  const gt = useGT();
  const { board } = props;
  const rows = boardRows(board.items);
  const urls = usePictureUrls(
    props.home,
    rows.flatMap((row) => row.pictures.slice(0, 1)),
  );
  const taskRow = (thread: BotBoardThread) => (
    <li key={`${thread.environmentId}:${thread.threadId}`}>
      <button
        type="button"
        onClick={() =>
          props.onShow({
            kind: "task",
            bot: board.bot,
            environmentId: thread.environmentId,
            threadId: thread.threadId,
          })
        }
      >
        <i className={thread.status === "needs-input" ? s.isNeed : undefined} />
        <span>{thread.title}</span>
        <em className={thread.status === "needs-input" ? `${s.num} ${s.isNeed}` : s.num}>
          <BotTaskStateLabel thread={thread} />
        </em>
      </button>
    </li>
  );
  const waiting = rows.filter((row) => row.item.waitingOnYou).length;
  return (
    <Holo
      color={props.color}
      label={gt("{name}'s work", { name: board.bot })}
      title={gt("{name}'s open work", { name: board.bot })}
      sub={
        <>
          {gt("{count} open", { count: rows.length })}
          {waiting === 0 ? null : (
            <>
              {" · "}
              <span className={s.isNeed}>{gt("{count} need you", { count: waiting })}</span>
            </>
          )}
          {` · ${props.purpose}`}
        </>
      }
      onClose={() => props.onShow(null)}
    >
      <div className={s.board}>
        {!board.loaded ? (
          <p className={s.note}>{gt("Reading its board…")}</p>
        ) : rows.length === 0 && board.unfiled.length === 0 ? (
          <p className={s.note}>{gt("Nothing open.")}</p>
        ) : null}
        {rows.map((row) => {
          const { item } = row;
          const picture = row.pictures[0];
          const files = row.pictures.length + row.others;
          return (
            <article key={item.id} className={item.waitingOnYou ? s.isNeed : undefined}>
              <div>
                <h3>
                  {item.title}
                  {item.waitingOnYou ? <span>{gt("Needs you")}</span> : null}
                </h3>
                {item.nextStep === "" ? null : <p>{item.nextStep}</p>}
                {row.live.length === 0 ? null : (
                  <ul className={s.tasks}>{sortBotTasks(row.live).slice(0, 3).map(taskRow)}</ul>
                )}
                <small className={s.num}>
                  {[
                    row.live.length > 3
                      ? gt("{count} more at work", { count: row.live.length - 3 })
                      : null,
                    row.ended === 0
                      ? null
                      : gt(
                          "{count, plural, one {{count} task ended} other {{count} tasks ended}}",
                          {
                            count: row.ended,
                          },
                        ),
                    files === 0
                      ? null
                      : gt(
                          "{count, plural, one {{count} file handed over} other {{count} files handed over}}",
                          { count: files },
                        ),
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </small>
              </div>
              {picture === undefined ? null : (
                <button
                  type="button"
                  className={s.peek}
                  aria-label={gt("Show {title}", { title: picture.title })}
                  onClick={() => props.onShow({ kind: "file", bot: board.bot, file: picture.id })}
                >
                  {urls.get(picture.id) == null ? null : (
                    <img src={urls.get(picture.id)!} alt="" loading="lazy" />
                  )}
                  {row.pictures.length < 2 ? null : (
                    <span className={s.num}>{row.pictures.length}</span>
                  )}
                </button>
              )}
            </article>
          );
        })}
        {board.unfiled.length === 0 ? null : (
          <article>
            <div>
              <h3>{gt("Other running tasks")}</h3>
              <ul className={s.tasks}>{board.unfiled.map(taskRow)}</ul>
            </div>
          </article>
        )}
      </div>
    </Holo>
  );
}

/**
 * The screen. It holds up what the conversation is about: a task and what it made, a file, or
 * a board when one is asked for. With nothing held up, it shows the work being done.
 */
export function SpaceWall(props: {
  /** The machine the bots live on, where handed-over files are kept. */
  readonly home: EnvironmentId;
  readonly bots: ReadonlyArray<{ readonly name: string; readonly purpose: string }>;
  readonly boards: ReadonlyArray<SpaceBoard>;
  readonly screen: SpaceScreen | null;
  readonly light: (bot: string | null) => string;
  readonly onShow: (screen: SpaceScreen | null) => void;
}) {
  const { screen, boards } = props;
  const tasks = spaceTasks(boards);
  const close = () => props.onShow(null);

  if (screen === null)
    return (
      <IdleWall
        home={props.home}
        boards={boards}
        tasks={tasks}
        light={props.light}
        onShow={props.onShow}
      />
    );

  if (screen.kind === "board") {
    const board = boards.find((candidate) => candidate.bot === screen.bot);
    const bot = props.bots.find((candidate) => candidate.name === screen.bot);
    return (
      <section className={s.wall}>
        {board === undefined || bot === undefined ? null : (
          <BoardHolo
            home={props.home}
            board={board}
            purpose={bot.purpose}
            color={props.light(board.bot)}
            onShow={props.onShow}
          />
        )}
      </section>
    );
  }

  if (screen.kind === "file") {
    const filesOf = (board: SpaceBoard) => board.items.flatMap((item) => item.files);
    const named = boards.find((board) => board.bot === screen.bot);
    const files = named === undefined ? undefined : filesOf(named);
    // The bot in the middle may name a file of any bot without saying whose it is.
    const file =
      (files === undefined ? null : findBotFile(files, screen.file)) ??
      findBotFile(boards.flatMap(filesOf), screen.file);
    const task =
      file?.threadId == null
        ? null
        : (tasks.find((candidate) => candidate.thread.threadId === file.threadId) ?? null);
    return (
      <section className={s.wall}>
        {file === null ? (
          <FileMissing
            color={props.light(screen.bot)}
            bot={screen.bot}
            file={screen.file}
            looking={files === undefined || !boards.every((board) => board.loaded)}
            onClose={close}
          />
        ) : (
          <TaskHolo
            key={file.id}
            home={props.home}
            environmentId={task?.thread.environmentId ?? props.home}
            // A file of no task still needs a thread to ask about: none has this id, so only the file shows.
            threadId={task?.thread.threadId ?? file.threadId ?? ThreadId.make(file.id)}
            task={task}
            open={file}
            color={props.light(task?.bot ?? screen.bot)}
            onClose={close}
          />
        )}
      </section>
    );
  }

  const task = tasks.find((candidate) => candidate.thread.threadId === screen.threadId) ?? null;
  return (
    <section className={s.wall}>
      <TaskHolo
        key={screen.threadId}
        home={props.home}
        environmentId={screen.environmentId ?? task?.thread.environmentId ?? props.home}
        threadId={screen.threadId}
        task={task}
        open={null}
        color={props.light(task?.bot ?? screen.bot)}
        onClose={close}
      />
    </section>
  );
}

function FileMissing(props: {
  readonly color: string;
  readonly bot: string;
  readonly file: string;
  readonly looking: boolean;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  return (
    <Holo
      color={props.color}
      label={gt("A file from {name}", { name: props.bot })}
      title={props.file}
      sub={props.bot}
      onClose={props.onClose}
    >
      <p className={s.note}>
        {props.looking
          ? gt("Looking for it…")
          : gt("{name} has no handed-over file called {file}.", {
              name: props.bot,
              file: props.file,
            })}
      </p>
    </Holo>
  );
}
