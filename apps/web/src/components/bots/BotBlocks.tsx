import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { BotBoardFile, BotBoardThread, EnvironmentId } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleIcon,
  CircleXIcon,
  FileCodeIcon,
  FileTextIcon,
  LinkIcon,
  LoaderCircleIcon,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { useAssetUrls } from "~/assets/assetUrls";
import { useRelativeTimeState } from "~/hooks/useRelativeTimeState";
import { formatBytes } from "~/lib/formatBytes";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { relativeTimeElapsedMs } from "~/timestampFormat";
import { assetEnvironment } from "~/state/assets";
import { useEnvironment, useEnvironmentHttpBaseUrl } from "~/state/environments";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { buildThreadRouteParams } from "~/threadRoutes";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

import { botFileKind, botTaskRunMs } from "./botBoard.logic";

const BLOCK = "rounded-xl border border-border/70 bg-card/40";
/** The board is read again every ten seconds; a status older than this did not come back. */
const BOT_STATUS_STALE_MS = 2 * 60_000;

/** What a task is doing, as one glyph. Still on purpose: a board full of spinners repaints. */
export function BotStateIcon(props: {
  readonly status: BotBoardThread["status"];
  readonly className?: string;
}) {
  const className = cn("size-4 shrink-0", props.className);
  switch (props.status) {
    case "working":
      return <LoaderCircleIcon aria-hidden className={cn(className, "text-primary")} />;
    case "needs-input":
      return <CircleAlertIcon aria-hidden className={cn(className, "text-warning")} />;
    case "failed":
      return <CircleXIcon aria-hidden className={cn(className, "text-destructive")} />;
    case "completed":
      return <CircleCheckIcon aria-hidden className={cn(className, "text-muted-foreground")} />;
    default:
      return <CircleIcon aria-hidden className={cn(className, "text-muted-foreground/60")} />;
  }
}

/** "Running 3m", "Done in 6m", "Needs you": a task's state in the words the person uses. */
export function BotTaskStateLabel(props: { readonly thread: BotBoardThread }) {
  const { thread } = props;
  const since = useRelativeTimeState(thread.status === "working" ? thread.startedAt : null);
  const heard = useRelativeTimeState(thread.asOf);
  // A status this old was read before its machine went out of reach, so "Running" would lie.
  if (
    (thread.status === "working" || thread.status === "needs-input") &&
    heard.status === "relative" &&
    (relativeTimeElapsedMs(thread.asOf) ?? 0) > BOT_STATUS_STALE_MS
  )
    return `Last heard ${heard.value}${heard.suffix === null ? "" : ` ${heard.suffix}`}`;
  switch (thread.status) {
    case "working":
      return since.status === "relative" && since.suffix !== null
        ? `Running ${since.value}`
        : "Running";
    case "needs-input":
      return "Needs you";
    case "completed": {
      const ran = botTaskRunMs(thread);
      return ran === null ? "Done" : `Done in ${formatDuration(ran)}`;
    }
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "idle":
      return "Idle";
    default:
      return "Unknown";
  }
}

/** Opens a task's thread, when its machine is connected here. */
export function useOpenBotTask() {
  const navigate = useNavigate();
  return (thread: Pick<BotBoardThread, "environmentId" | "threadId">) =>
    navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.threadId)),
    });
}

/** Opens a handed-over file: its link, or the copy the bot kept. */
function useOpenBotFile(environmentId: EnvironmentId) {
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  return async (file: BotBoardFile) => {
    if (file.url !== null) return ensureLocalApi().shell.openExternal(file.url);
    if (file.attachmentId === null || httpBaseUrl === null) return;
    const result = await createAssetUrl({
      environmentId,
      input: {
        resource: {
          _tag: "attachment",
          attachmentId: file.attachmentId,
          disposition: "inline",
          ...(file.name === null ? {} : { fileName: file.name }),
          ...(file.mimeType === null ? {} : { mimeType: file.mimeType }),
        },
      },
    });
    if (result._tag !== "Success") return;
    const url = resolveAssetUrl(httpBaseUrl, result.value.relativeUrl);
    if (url !== null) await ensureLocalApi().shell.openExternal(url);
  };
}

/** Says why a block does nothing when pressed, or what it is, without a native tooltip. */
export function BotHint(props: {
  readonly hint: string | undefined;
  readonly children: ReactElement;
}) {
  if (props.hint === undefined) return props.children;
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipPopup>{props.hint}</TooltipPopup>
    </Tooltip>
  );
}

/** A task the bot started: what it is, where it runs, and how it stands. */
export function BotTaskBlock(props: {
  readonly thread: BotBoardThread;
  /** What the task handed over, shown under it. */
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  const { thread } = props;
  const open = useOpenBotTask();
  const reachable = useEnvironment(thread.environmentId) !== null;
  return (
    <div className={cn(BLOCK, props.className)}>
      <BotHint hint={reachable ? undefined : "Connect to its machine to open this task."}>
        <button
          type="button"
          aria-disabled={!reachable || undefined}
          className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-disabled:cursor-default"
          onClick={() => {
            if (reachable) void open(thread);
          }}
        >
          <BotStateIcon status={thread.status} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {thread.title}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{thread.where}</span>
          </span>
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 ps-2 text-xs",
              thread.status === "needs-input"
                ? "text-warning"
                : thread.status === "failed"
                  ? "text-destructive"
                  : "text-muted-foreground",
            )}
          >
            <BotTaskStateLabel thread={thread} />
            <ChevronRightIcon aria-hidden className="size-3.5" />
          </span>
        </button>
      </BotHint>
      {props.children}
    </div>
  );
}

/** Pictures a task handed over, as pictures. The last cell counts the ones not shown. */
export function BotImageStrip(props: {
  readonly environmentId: EnvironmentId;
  readonly images: ReadonlyArray<BotBoardFile>;
  readonly max: number;
  /** Files beyond the pictures shown, counted on the last cell. */
  readonly more?: number;
  /** Shown only, where the block around it is what opens. */
  readonly still?: boolean;
  readonly className?: string;
  readonly cellClassName?: string;
}) {
  const kept = props.images.flatMap((file) =>
    file.attachmentId === null ? [] : [{ file, attachmentId: file.attachmentId }],
  );
  const shown = kept.slice(0, props.max);
  const urls = useAssetUrls(
    props.environmentId,
    shown.map(({ attachmentId }) => ({ _tag: "attachment" as const, attachmentId })),
  );
  const open = useOpenBotFile(props.environmentId);
  const hidden = kept.length - shown.length + (props.more ?? 0);
  if (shown.length === 0) return null;
  return (
    <div className={props.className}>
      {shown.map(({ file }, index) => {
        const url = urls[index] ?? null;
        const cell = cn(
          "relative overflow-hidden rounded-lg bg-background ring-1 ring-border/80 ring-inset",
          props.cellClassName,
        );
        const content = (
          <>
            {url === null ? null : (
              <img
                src={url}
                alt=""
                loading="lazy"
                className="absolute inset-0 size-full object-cover"
              />
            )}
            {index === shown.length - 1 && hidden > 0 ? (
              <span className="absolute inset-0 grid place-items-center bg-background/65 text-sm font-medium text-foreground">
                +{hidden}
              </span>
            ) : null}
          </>
        );
        return props.still ? (
          <div key={file.id} className={cell}>
            {content}
          </div>
        ) : (
          <BotHint key={file.id} hint={file.title}>
            <button
              type="button"
              aria-label={`Open ${file.title}`}
              className={cn(
                cell,
                "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              )}
              onClick={() => void open(file).catch(() => undefined)}
            >
              {content}
            </button>
          </BotHint>
        );
      })}
    </div>
  );
}

/** A handed-over file that is not a picture: a document, a recording, a link. */
export function BotFileRow(props: {
  readonly environmentId: EnvironmentId;
  readonly file: BotBoardFile;
  readonly className?: string;
}) {
  const { file } = props;
  const open = useOpenBotFile(props.environmentId);
  const opens = file.url !== null || file.attachmentId !== null;
  const kind = botFileKind(file);
  const Icon = file.url !== null ? LinkIcon : kind === "HTML" ? FileCodeIcon : FileTextIcon;
  return (
    <BotHint
      hint={
        opens
          ? undefined
          : `No copy is kept. It was at ${file.sourcePath ?? "an unknown place"} when handed over.`
      }
    >
      <button
        type="button"
        aria-disabled={!opens || undefined}
        className={cn(
          "flex w-full min-w-0 cursor-pointer items-center gap-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-disabled:cursor-default",
          props.className,
        )}
        onClick={() => {
          if (opens) void open(file).catch(() => undefined);
        }}
      >
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-foreground/85">{file.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {file.url !== null ? kind : `${kind}, ${formatBytes(file.sizeBytes)}`}
        </span>
      </button>
    </BotHint>
  );
}
