import type { BotBoardItem, BotBoardThread, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleIcon,
  FileTextIcon,
  ListTreeIcon,
  LoaderCircleIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { useRelativeTimeState } from "~/hooks/useRelativeTimeState";
import { cn } from "~/lib/utils";
import { useEnvironment } from "~/state/environments";

import { RelativeTime } from "../RelativeTime";
import {
  BotFileRow,
  BotHint,
  BotImageStrip,
  BotStateIcon,
  BotTaskStateLabel,
  useOpenBotTask,
} from "./BotBlocks";
import {
  BOT_ITEM_COLUMNS,
  type BotItemColumn,
  botItemColumn,
  countBotTasks,
  groupBotItems,
  nameBotItemRefs,
  sortBotTasks,
  splitBotFiles,
} from "./botBoard.logic";
import { useBotSearch, useOpenBotView } from "./botView";
import { useBotBoard, useBotBoardAll } from "./useBot";

const QUIET_BUTTON =
  "cursor-pointer rounded-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
/** Tasks shown before the rest fold away. */
const TASKS_SHOWN = 4;

const COLUMN_ICON: Record<
  BotItemColumn,
  { readonly Icon: typeof CircleIcon; readonly tone: string }
> = {
  "needs-you": { Icon: CircleAlertIcon, tone: "text-warning" },
  running: { Icon: LoaderCircleIcon, tone: "text-primary" },
  quiet: { Icon: CircleIcon, tone: "text-muted-foreground" },
  done: { Icon: CircleCheckIcon, tone: "text-muted-foreground" },
};

function taskLine(threads: ReadonlyArray<BotBoardThread>, gt: ReturnType<typeof useGT>) {
  const count = countBotTasks(threads);
  const tasks = gt("{count, plural, one {{count} task} other {{count} tasks}}", {
    count: count.total,
  });
  if (count.running === 0) return tasks;
  return count.total === 1
    ? gt("1 task running")
    : gt("{running} of {total} tasks running", { running: count.running, total: count.total });
}

function ItemRow(props: {
  readonly environmentId: EnvironmentId;
  readonly item: BotBoardItem;
  /** Every item on the board, to name the ones a note cites. */
  readonly items: ReadonlyArray<BotBoardItem>;
  readonly column: BotItemColumn;
  readonly selected: boolean;
  readonly onOpen: () => void;
}) {
  const gt = useGT();
  const { item } = props;
  const { Icon, tone } = COLUMN_ICON[props.column];
  const files = splitBotFiles(item.files);
  const doc = files.others[0];
  const moreDocs = files.others.length - 1;
  return (
    <li
      className={cn(
        "relative border-t border-border/70 first:border-t-0",
        props.selected && "bg-foreground/[0.04]",
      )}
    >
      <button
        type="button"
        aria-label={gt("Open {title}", { title: item.title })}
        aria-pressed={props.selected}
        className="absolute inset-0 cursor-pointer outline-none hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={props.onOpen}
      />
      <div
        className={cn(
          "pointer-events-none relative flex gap-3 px-4 py-3",
          props.column === "done" && "opacity-65",
        )}
      >
        <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {item.title}
            </h3>
            <span className="shrink-0 text-xs text-muted-foreground">
              <BoardTime timestamp={item.updatedAt} />
            </span>
          </div>
          {item.nextStep === "" ? null : (
            <p className="mt-0.5 line-clamp-2 text-xs leading-normal text-muted-foreground">
              {nameBotItemRefs(item.nextStep, props.items)}
            </p>
          )}
          {item.threads.length === 0 && doc === undefined ? null : (
            <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {item.threads.length === 0 ? null : (
                <span className="flex shrink-0 items-center gap-1.5">
                  {props.column === "running" ? (
                    <LoaderCircleIcon aria-hidden className="size-3.5 text-primary" />
                  ) : (
                    <ListTreeIcon aria-hidden className="size-3.5" />
                  )}
                  {taskLine(item.threads, gt)}
                </span>
              )}
              {doc === undefined ? null : (
                <span className="flex min-w-0 items-center gap-1.5">
                  <FileTextIcon aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate">{doc.title}</span>
                  {moreDocs <= 0 ? null : (
                    <span className="shrink-0">{gt("and {count} more", { count: moreDocs })}</span>
                  )}
                </span>
              )}
            </p>
          )}
        </div>
        <BotImageStrip
          still
          environmentId={props.environmentId}
          images={files.images}
          max={3}
          className="grid w-36 shrink-0 grid-cols-3 gap-1 self-start max-sm:hidden"
          cellClassName="aspect-square"
        />
      </div>
    </li>
  );
}

/** "20m", "1d": how long ago, without the "ago" a column of them repeats. */
function BoardTime(props: { readonly timestamp: string | null }) {
  const relative = useRelativeTimeState(props.timestamp);
  return relative.status === "relative" && relative.suffix !== null ? relative.value : null;
}

function TaskRow(props: { readonly thread: BotBoardThread }) {
  const gt = useGT();
  const { thread } = props;
  const open = useOpenBotTask();
  const reachable = useEnvironment(thread.environmentId) !== null;
  return (
    <li className="border-t border-border/70 first:border-t-0">
      <BotHint hint={reachable ? thread.where : gt("Connect to its machine to open this task.")}>
        <button
          type="button"
          aria-disabled={!reachable || undefined}
          className="flex h-9.5 w-full min-w-0 cursor-pointer items-center gap-2.5 px-3 text-left outline-none hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-disabled:cursor-default"
          onClick={() => {
            if (reachable) void open(thread);
          }}
        >
          <BotStateIcon status={thread.status} />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{thread.title}</span>
          <span
            className={cn(
              "shrink-0 text-xs",
              thread.status === "needs-input"
                ? "text-warning"
                : thread.status === "failed"
                  ? "text-destructive"
                  : "text-muted-foreground",
            )}
          >
            {thread.status === "completed" && thread.endedAt !== null ? (
              <BoardTime timestamp={thread.endedAt} />
            ) : (
              <BotTaskStateLabel thread={thread} />
            )}
          </span>
        </button>
      </BotHint>
    </li>
  );
}

function ItemPane(props: {
  readonly environmentId: EnvironmentId;
  readonly item: BotBoardItem;
  readonly items: ReadonlyArray<BotBoardItem>;
  readonly onClose: () => void;
  readonly onOpenFiles: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { item } = props;
  const [allTasks, setAllTasks] = useState(false);
  const column = botItemColumn(item);
  const { Icon, tone } = COLUMN_ICON[column];
  const tasks = sortBotTasks(item.threads);
  const shown = allTasks ? tasks : tasks.slice(0, TASKS_SHOWN);
  const files = splitBotFiles(item.files);
  return (
    <aside
      aria-label={gt("Work item")}
      className="flex w-[min(29rem,100%)] shrink-0 flex-col border-s border-border/70 bg-background max-md:absolute max-md:inset-0 max-md:z-10 max-md:w-full"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 ps-5 pe-3">
        <span className="text-sm font-medium text-foreground">
          <T>Work item</T>
        </span>
        <button
          type="button"
          aria-label={gt("Close work item")}
          className={cn(QUIET_BUTTON, "grid size-7 place-items-center text-muted-foreground")}
          onClick={props.onClose}
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 pb-8">
        <h2 className="text-lg font-semibold text-foreground">{item.title}</h2>
        <p className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className={cn("flex items-center gap-1.5", column === "needs-you" && tone)}>
            <Icon aria-hidden className={cn("size-4", tone)} />
            {item.state === "dropped"
              ? gt("Dropped")
              : m(BOT_ITEM_COLUMNS.find((entry) => entry.id === column)?.label ?? "")}
          </span>
          <span>
            <T>
              Updated <RelativeTime timestamp={item.updatedAt} />
            </T>
          </span>
        </p>
        {item.nextStep === "" ? null : (
          <p className="mt-3 rounded-2xl bg-message px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-message-foreground">
            {nameBotItemRefs(item.nextStep, props.items)}
          </p>
        )}
        {item.detail === "" ? null : (
          <p className="mt-3 text-xs leading-normal whitespace-pre-wrap text-muted-foreground">
            {nameBotItemRefs(item.detail, props.items)}
          </p>
        )}

        {tasks.length === 0 ? null : (
          <section className="mt-6">
            <h3 className="mb-2 text-xs text-muted-foreground">
              <T>Tasks</T> <span className="ms-1 text-muted-foreground/70">{tasks.length}</span>
            </h3>
            <ul className="m-0 list-none overflow-hidden rounded-xl border border-border/70 p-0">
              {shown.map((thread) => (
                <TaskRow key={`${thread.environmentId}:${thread.threadId}`} thread={thread} />
              ))}
              {tasks.length <= TASKS_SHOWN ? null : (
                <li className="border-t border-border/70">
                  <button
                    type="button"
                    aria-expanded={allTasks}
                    className="flex h-9.5 w-full cursor-pointer items-center gap-2.5 px-3 text-left text-sm text-muted-foreground outline-none hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    onClick={() => setAllTasks(!allTasks)}
                  >
                    <ChevronDownIcon
                      aria-hidden
                      className={cn("size-4 shrink-0", allTasks && "rotate-180")}
                    />
                    {allTasks
                      ? gt("Show fewer")
                      : gt(
                          "{count, plural, one {{count} earlier task} other {{count} earlier tasks}}",
                          {
                            count: tasks.length - TASKS_SHOWN,
                          },
                        )}
                  </button>
                </li>
              )}
            </ul>
          </section>
        )}

        {item.files.length === 0 ? null : (
          <section className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs text-muted-foreground">
                <T>Files</T>{" "}
                <span className="ms-1 text-muted-foreground/70">{item.files.length}</span>
              </h3>
              <button
                type="button"
                className={cn(QUIET_BUTTON, "px-1 text-xs text-muted-foreground")}
                onClick={props.onOpenFiles}
              >
                <T>All files</T>
              </button>
            </div>
            <BotImageStrip
              environmentId={props.environmentId}
              images={files.images}
              max={9}
              className="grid grid-cols-3 gap-2"
              cellClassName="aspect-[16/10]"
            />
            {files.others.length === 0 ? null : (
              <ul
                className={cn(
                  "m-0 list-none overflow-hidden rounded-xl border border-border/70 p-0",
                  files.images.length > 0 && "mt-2",
                )}
              >
                {files.others.map((file) => (
                  <li key={file.id} className="border-t border-border/70 first:border-t-0">
                    <BotFileRow
                      environmentId={props.environmentId}
                      file={file}
                      className="h-9.5 px-3 hover:bg-foreground/[0.03]"
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

/** A bot's work as one list: what waits on you first, then what runs, then the rest. */
export function BotBoardView(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const m = useMessages();
  const [doneToggled, setDoneToggled] = useState<boolean | null>(null);
  const board = useBotBoard(props.environmentId, props.threadId);
  const all = useBotBoardAll(props.environmentId, props.threadId);
  const search = useBotSearch();
  const openView = useOpenBotView();
  const target = { environmentId: props.environmentId, threadId: props.threadId };
  // Open work from the board that is read often, finished work from the one that is not.
  const items = [
    ...(board.data?.items ?? []),
    ...(all.data?.items ?? []).filter((item) => item.state !== "open"),
  ];
  const groups = groupBotItems(items);
  const open = items.filter((item) => item.state === "open").length;
  const selected = items.find((item) => item.id === search.item) ?? null;
  const unfiled = board.data?.unfiled ?? [];
  // Finished work stays out of the way unless it is all there is, or it is what was opened.
  const showDone =
    doneToggled ?? (open === 0 || (selected !== null && botItemColumn(selected) === "done"));
  const shown = BOT_ITEM_COLUMNS.filter(
    (column) => groups[column.id].length > 0 && (showDone || column.id !== "done"),
  );

  return (
    <div className="relative flex h-full min-h-0 min-w-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {board.data !== null && items.length === 0 && unfiled.length === 0 ? (
          <p className="px-6 pt-4 text-sm text-muted-foreground">
            <T>Nothing here yet. Ask the bot for something and its work shows up on this board.</T>
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-10">
            <div className="flex max-w-3xl flex-col">
              <div className="flex h-11 items-center justify-between text-xs text-muted-foreground">
                <span>
                  {board.data === null
                    ? board.error === null
                      ? ""
                      : gt("The board could not be read.")
                    : gt(
                        "{count, plural, one {{count} open work item} other {{count} open work items}}",
                        { count: open },
                      )}
                </span>
                {groups.done.length === 0 ? null : (
                  <button
                    type="button"
                    aria-pressed={showDone}
                    className={cn(QUIET_BUTTON, "px-1")}
                    onClick={() => setDoneToggled(!showDone)}
                  >
                    {showDone
                      ? gt("Hide done")
                      : gt("Show done ({count})", { count: groups.done.length })}
                  </button>
                )}
              </div>
              {shown.map((column) => (
                <section key={column.id} aria-label={m(column.label)} className="mb-5">
                  <h2 className="mb-1.5 flex h-6 items-center gap-2 text-xs">
                    <span
                      className={
                        column.id === "needs-you"
                          ? "font-medium text-warning"
                          : "text-muted-foreground"
                      }
                    >
                      {m(column.label)}
                    </span>
                    <span className="text-muted-foreground/70">{groups[column.id].length}</span>
                  </h2>
                  <ul className="m-0 list-none overflow-hidden rounded-xl border border-border/70 bg-card/40 p-0">
                    {groups[column.id].map((item) => (
                      <ItemRow
                        key={item.id}
                        environmentId={props.environmentId}
                        item={item}
                        items={items}
                        column={column.id}
                        selected={selected?.id === item.id}
                        onOpen={() => void openView(target, { bot: "board", item: item.id })}
                      />
                    ))}
                  </ul>
                </section>
              ))}
              {unfiled.length === 0 ? null : (
                <section aria-label={gt("Tasks on no work item")} className="mb-5">
                  <h2 className="mb-1.5 flex h-6 items-center gap-2 text-xs text-muted-foreground">
                    <T>Tasks on no work item</T>
                    <span className="text-muted-foreground/70">{unfiled.length}</span>
                  </h2>
                  <ul className="m-0 list-none overflow-hidden rounded-xl border border-border/70 bg-card/40 p-0">
                    {unfiled.map((thread) => (
                      <TaskRow key={`${thread.environmentId}:${thread.threadId}`} thread={thread} />
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
      {selected === null ? null : (
        <ItemPane
          key={selected.id}
          environmentId={props.environmentId}
          item={selected}
          items={items}
          onClose={() => void openView(target, { bot: "board" })}
          onOpenFiles={() => void openView(target, { bot: "files" })}
        />
      )}
    </div>
  );
}

/** Everything the bot's tasks handed over, under the work it was for. */
export function BotFilesView(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const board = useBotBoardAll(props.environmentId, props.threadId);
  const items = (board.data?.items ?? [])
    .filter((item) => item.files.length > 0)
    .map((item) => ({ item, files: splitBotFiles(item.files) }))
    .toSorted((a, b) => latest(b.item).localeCompare(latest(a.item)));
  const total = items.reduce((sum, { item }) => sum + item.files.length, 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center px-6 text-xs text-muted-foreground">
        {board.data === null
          ? board.error === null
            ? ""
            : gt("The files could not be read.")
          : gt("{count, plural, one {{count} file} other {{count} files}}", { count: total })}
      </div>
      {board.data !== null && total === 0 ? (
        <p className="px-6 pt-2 text-sm text-muted-foreground">
          <T>
            No files yet. Screenshots, documents and links the bot&#39;s tasks hand over land here.
          </T>
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-10">
          <div className="flex max-w-5xl flex-col gap-8">
            {items.map(({ item, files }) => (
              <section key={item.id}>
                <h2 className="mb-2.5 flex items-baseline gap-2 text-sm font-medium text-foreground">
                  <span className="min-w-0 truncate">{item.title}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground/70">
                    {item.files.length}
                  </span>
                </h2>
                <BotImageStrip
                  environmentId={props.environmentId}
                  images={files.images}
                  max={48}
                  className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2"
                  cellClassName="aspect-[16/10]"
                />
                {files.others.length === 0 ? null : (
                  <ul
                    className={cn(
                      "m-0 list-none overflow-hidden rounded-xl border border-border/70 p-0",
                      files.images.length > 0 && "mt-2",
                    )}
                  >
                    {files.others.map((file) => (
                      <li key={file.id} className="border-t border-border/70 first:border-t-0">
                        <BotFileRow
                          environmentId={props.environmentId}
                          file={file}
                          className="h-9.5 px-3 hover:bg-foreground/[0.03]"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const latest = (item: BotBoardItem) =>
  item.files.reduce((newest, file) => (file.createdAt > newest ? file.createdAt : newest), "");
