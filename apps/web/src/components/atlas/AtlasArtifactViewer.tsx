import { FileDiff } from "@pierre/diffs/react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  AtlasArtifact,
  AtlasTask,
  AtlasTaskExecution,
  EnvironmentId,
  ProjectId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { Link } from "@tanstack/react-router";
import {
  ExternalLinkIcon,
  GitCompareIcon,
  MessageSquareTextIcon,
  PackageIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { useTheme } from "../../hooks/useTheme";
import { useCheckpointDiff } from "../../lib/checkpointDiffState";
import {
  getDiffLineStat,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "../../lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "../../lib/syntaxHighlighting";
import { cn } from "../../lib/utils";
import {
  useProject,
  useQuietThreadShell,
  useThreadCheckpointSummaries,
  useThreadStatus,
} from "../../state/entities";
import { useFilesystemReadAccess } from "../../state/filesystem";
import ChatMarkdown from "../ChatMarkdown";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { DiffStatLabel } from "../chat/DiffStatLabel";
import { DIFF_VIEW_UNSAFE_CSS } from "../diffs/StyledDiffCodeView";
import { FileMarkdownPreview } from "../files/FileMarkdownPreview";
import { filePreviewReadErrorMessage } from "../files/filePreviewMode";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import ReadOnlySourcePreview from "../files/ReadOnlySourcePreview";
import { WorkspaceBrowserPreview, WorkspaceImagePreview } from "../files/WorkspaceAssetPreviews";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import {
  artifactGroup,
  artifactRelativePath,
  defaultDeliverableKey,
  deliverableEntries,
  latestCheckpointTurnCount,
  type AtlasDeliverableEntry,
} from "./atlasArtifactLogic";
import { ARTIFACT_GROUP_ICON } from "./AtlasTaskCard";

function ViewerMessage({
  title,
  children,
  busy = false,
}: {
  readonly title: string;
  readonly children?: ReactNode;
  readonly busy?: boolean;
}) {
  return (
    <div
      role={busy ? "status" : undefined}
      className="flex min-h-48 flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center"
    >
      {busy ? <Spinner /> : null}
      <p className="font-medium text-sm">{title}</p>
      {children ? (
        <div className="max-w-sm text-muted-foreground text-xs leading-relaxed">{children}</div>
      ) : null}
    </div>
  );
}

export function ThreadLinkButton({
  environmentId,
  threadId,
  label = "Open thread",
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly label?: string;
}) {
  return (
    <Button
      size="xs"
      variant="ghost"
      render={<Link to="/$environmentId/$threadId" params={{ environmentId, threadId }} />}
    >
      {label}
      <ExternalLinkIcon />
    </Button>
  );
}

function entryIcon(entry: AtlasDeliverableEntry): LucideIcon {
  if (entry.kind === "summary") return MessageSquareTextIcon;
  if (entry.kind === "changes") return GitCompareIcon;
  return ARTIFACT_GROUP_ICON[artifactGroup(entry.artifact)];
}

function entryCaption(entry: AtlasDeliverableEntry): string {
  if (entry.kind === "summary") return "The agent's final report";
  if (entry.kind === "changes") return "Everything the run changed";
  const { artifact } = entry;
  if (artifact.path) return artifact.path;
  if (artifact.url) {
    try {
      return new URL(artifact.url).host;
    } catch {
      return artifact.url;
    }
  }
  return "No location reported";
}

// ── Viewers ─────────────────────────────────────────────────────────────────

function SummaryView({
  execution,
  cwd,
  threadRef,
}: {
  readonly execution: AtlasTaskExecution;
  readonly cwd: string | null;
  readonly threadRef: ScopedThreadRef;
}) {
  if (execution.result && execution.result.trim().length > 0) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <ChatMarkdown
          text={execution.result}
          cwd={cwd ?? undefined}
          threadRef={threadRef}
          className="mx-auto max-w-3xl px-6 py-5"
        />
      </ScrollArea>
    );
  }
  if (execution.status === "running") {
    return (
      <ViewerMessage title="The agent is still working" busy>
        Its summary appears here when the run finishes.
      </ViewerMessage>
    );
  }
  return (
    <ViewerMessage title="No summary">
      The run ended without a final message. Open the thread to see what happened.
    </ViewerMessage>
  );
}

function CodeChangesView({
  threadRef,
  running,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly running: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const summaries = useThreadCheckpointSummaries(threadRef);
  const threadStatus = useThreadStatus(threadRef);
  const toTurnCount = latestCheckpointTurnCount(summaries);
  const diff = useCheckpointDiff({
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    fromTurnCount: 0,
    toTurnCount,
    ignoreWhitespace: false,
    cacheScope: `atlas:${threadRef.threadId}`,
  });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const loadingThread = threadStatus === "empty" || threadStatus === "synchronizing";
  if (toTurnCount === null) {
    if (loadingThread) return <ViewerMessage title="Loading code changes" busy />;
    if (threadStatus === "deleted") {
      return <ViewerMessage title="The run's thread was deleted" />;
    }
    return (
      <ViewerMessage title={running ? "No changes yet" : "No code changes"}>
        {running
          ? "Changes appear after the agent finishes a turn."
          : "This run did not record a checkpoint, so there is nothing to diff."}
      </ViewerMessage>
    );
  }
  if (diff.error && !diff.data) {
    return <ViewerMessage title="Could not load the diff">{diff.error}</ViewerMessage>;
  }
  if (!diff.data) return <ViewerMessage title="Loading code changes" busy />;

  const patch = getRenderablePatch(diff.data.diff, `atlas-task:${resolvedTheme}`);
  if (patch === null) {
    return (
      <ViewerMessage title="No code changes">
        The run finished without changing any files.
      </ViewerMessage>
    );
  }
  if (patch.kind === "raw") {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <pre className="p-4 font-mono text-xs leading-relaxed whitespace-pre">{patch.text}</pre>
      </ScrollArea>
    );
  }

  const total = getDiffLineStat(patch.files);
  const selected =
    patch.files.find((file) => resolveFileDiffPath(file) === selectedPath) ?? patch.files[0];
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-3 p-4">
        <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs">
          <span>
            {patch.files.length} file{patch.files.length === 1 ? "" : "s"} changed
          </span>
          <DiffStatLabel additions={total.additions} deletions={total.deletions} layout="inline" />
        </p>
        <ul className="divide-y overflow-clip rounded-lg border" aria-label="Changed files">
          {patch.files.map((file) => {
            const path = resolveFileDiffPath(file);
            const stat = getDiffLineStat([file]);
            const active = file === selected;
            return (
              <li key={`${path}:${file.type}`}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedPath(path)}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-3 px-3 py-1.5 text-left text-xs outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    active && "bg-accent",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono" dir="rtl">
                    <bdi>{path}</bdi>
                  </span>
                  <DiffStatLabel
                    additions={stat.additions}
                    deletions={stat.deletions}
                    layout="inline"
                  />
                </button>
              </li>
            );
          })}
        </ul>
        {selected ? (
          <div className="overflow-clip rounded-lg border">
            <DiffWorkerPoolProvider>
              <FileDiff
                key={`${resolveFileDiffPath(selected)}:${resolvedTheme}`}
                fileDiff={selected}
                options={{
                  diffStyle: "unified",
                  overflow: "scroll",
                  theme: resolveDiffThemeName(resolvedTheme),
                  themeType: resolvedTheme,
                  preferredHighlighter: PREFERRED_HIGHLIGHTER,
                  unsafeCSS: DIFF_VIEW_UNSAFE_CSS,
                }}
              />
            </DiffWorkerPoolProvider>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}

function WorkspaceTextView({
  environmentId,
  cwd,
  relativePath,
  markdown,
  threadRef,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly markdown: boolean;
  readonly threadRef: ScopedThreadRef;
}) {
  const file = useProjectFileQuery(environmentId, cwd, relativePath);
  if (file.data === null) {
    if (file.error || file.readError) {
      return (
        <ViewerMessage title="Could not open this file">
          {file.readError ? filePreviewReadErrorMessage(file.readError) : file.error}
        </ViewerMessage>
      );
    }
    return <ViewerMessage title="Opening file" busy />;
  }
  const notice = file.data.truncated ? (
    <p className="shrink-0 border-b bg-warning/8 px-4 py-1.5 text-warning-foreground text-xs">
      Showing the first 1 MB of this file.
    </p>
  ) : null;
  if (markdown) {
    return (
      <>
        {notice}
        <ScrollArea className="min-h-0 flex-1">
          <FileMarkdownPreview
            text={file.data.contents}
            cwd={cwd}
            relativePath={relativePath}
            threadRef={threadRef}
            workspaceMutationId={null}
          />
        </ScrollArea>
      </>
    );
  }
  return (
    <>
      {notice}
      <ReadOnlySourcePreview name={relativePath} text={file.data.contents} />
    </>
  );
}

function LinkView({ artifact }: { readonly artifact: AtlasArtifact }) {
  return (
    <div className="flex flex-1 items-start justify-center p-6">
      <div className="w-full max-w-lg space-y-3 rounded-xl border bg-card p-5 text-card-foreground">
        <p className="font-medium text-sm">{artifact.title}</p>
        <p className="font-mono text-muted-foreground text-xs break-all">{artifact.url}</p>
        {artifact.description ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{artifact.description}</p>
        ) : null}
        <Button
          size="sm"
          render={<a href={artifact.url} target="_blank" rel="noreferrer noopener" />}
        >
          Open link
          <ExternalLinkIcon />
        </Button>
      </div>
    </div>
  );
}

function ArtifactView({
  environmentId,
  entry,
  cwd,
  threadRef,
}: {
  readonly environmentId: EnvironmentId;
  readonly entry: Extract<AtlasDeliverableEntry, { kind: "artifact" }>;
  readonly cwd: string | null;
  readonly threadRef: ScopedThreadRef;
}) {
  const fileAccess = useFilesystemReadAccess(environmentId);
  const { artifact, viewer } = entry;
  if (viewer === "link") return <LinkView artifact={artifact} />;
  if (viewer === "unavailable" || !artifact.path) {
    return (
      <ViewerMessage title="Nothing to open">
        The agent reported this artifact without a file path or a web link.
      </ViewerMessage>
    );
  }
  if (cwd === null) return <ViewerMessage title="Finding the workspace" busy />;
  if (!fileAccess.canReadFiles) {
    return fileAccess.isPending ? (
      <ViewerMessage title="Checking file access" busy />
    ) : (
      <ViewerMessage title="File access is off for this connection">
        {fileAccess.error ?? "This connection cannot read files on the host."} The agent summary and
        code changes are still available.
      </ViewerMessage>
    );
  }
  const relativePath = artifactRelativePath(artifact.path, cwd);
  if (viewer === "image") {
    return (
      <WorkspaceImagePreview
        key={relativePath}
        environmentId={environmentId}
        threadRef={threadRef}
        draft={false}
        absolutePath={resolvePathLinkTarget(relativePath, cwd)}
        workspaceRoot={cwd}
        alt={artifact.title}
        workspaceMutationId={null}
      />
    );
  }
  if (viewer === "html") {
    return (
      <WorkspaceBrowserPreview
        key={relativePath}
        environmentId={environmentId}
        threadRef={threadRef}
        draft={false}
        absolutePath={resolvePathLinkTarget(relativePath, cwd)}
        workspaceRoot={cwd}
        title={artifact.title}
        workspaceMutationId={null}
      />
    );
  }
  return (
    <WorkspaceTextView
      key={relativePath}
      environmentId={environmentId}
      cwd={cwd}
      relativePath={relativePath}
      markdown={viewer === "markdown"}
      threadRef={threadRef}
    />
  );
}

// ── Deliverables pane ───────────────────────────────────────────────────────

/** Before a run there is nothing to review yet, only what the task promises. */
function DeliverablesBeforeRun({ task }: { readonly task: AtlasTask }) {
  return (
    <ViewerMessage title="Artifacts appear after the agent runs">
      {task.deliverable ? (
        <span className="flex items-start gap-2 text-left">
          <PackageIcon aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>Expected: {task.deliverable}</span>
        </span>
      ) : (
        "Run the task to get a summary, code changes, and anything else the agent produces."
      )}
    </ViewerMessage>
  );
}

export function AtlasDeliverables({
  environmentId,
  projectId,
  task,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly task: AtlasTask;
}) {
  const execution = task.execution;
  const threadRef = execution ? scopeThreadRef(environmentId, execution.threadId) : null;
  const shell = useQuietThreadShell(threadRef);
  const project = useProject({ environmentId, projectId });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  if (execution === null || threadRef === null) return <DeliverablesBeforeRun task={task} />;

  const cwd = shell?.worktreePath ?? project?.workspaceRoot ?? null;
  const entries = deliverableEntries(execution);
  const selected =
    entries.find((entry) => entry.key === selectedKey) ??
    entries.find((entry) => entry.key === defaultDeliverableKey(entries))!;
  const running = execution.status === "running";

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav
        aria-label="Deliverables"
        className="shrink-0 overflow-x-auto border-b md:w-64 md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0 md:[scrollbar-gutter:stable]"
      >
        <ul className="flex gap-1 p-2 md:flex-col">
          {entries.map((entry) => {
            const Icon = entryIcon(entry);
            const active = entry.key === selected.key;
            return (
              <li key={entry.key} className="shrink-0 md:shrink">
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => setSelectedKey(entry.key)}
                  className={cn(
                    "flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    active && "bg-accent hover:bg-accent",
                  )}
                >
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block max-w-48 truncate font-medium text-sm md:max-w-none">
                      {entry.title}
                    </span>
                    <span className="hidden truncate text-muted-foreground text-xs md:block">
                      {entryCaption(entry)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-label={selected.title} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-medium text-sm">{selected.title}</h3>
            {selected.kind === "artifact" && selected.artifact.description ? (
              <p className="line-clamp-2 text-muted-foreground text-xs">
                {selected.artifact.description}
              </p>
            ) : null}
          </div>
          {selected.kind === "artifact" && selected.artifact.path ? (
            <span className="max-w-full truncate font-mono text-muted-foreground text-xs">
              {selected.artifact.path}
            </span>
          ) : null}
          {selected.kind !== "artifact" ? (
            <ThreadLinkButton
              environmentId={environmentId}
              threadId={execution.threadId}
              label="Open in thread"
            />
          ) : null}
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          {selected.kind === "summary" ? (
            <SummaryView execution={execution} cwd={cwd} threadRef={threadRef} />
          ) : selected.kind === "changes" ? (
            <CodeChangesView threadRef={threadRef} running={running} />
          ) : (
            <ArtifactView
              environmentId={environmentId}
              entry={selected}
              cwd={cwd}
              threadRef={threadRef}
            />
          )}
        </div>
      </section>
    </div>
  );
}
