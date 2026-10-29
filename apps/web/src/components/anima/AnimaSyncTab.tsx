import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  type AnimaBreathRow,
  type AnimaBundleDiff,
  type AnimaDiffLine,
  animaSyncRelationLabel,
  animaTakeMode,
  diffAnimaBundles,
  invertAnimaRelation,
  quickAnimaState,
  resolveAnimaSync,
} from "@t3tools/client-runtime/anima-sync";
import { ArrowLeftIcon, ArrowRightIcon, CombineIcon } from "lucide-react";
import { useContext, useState } from "react";
import { Link } from "@tanstack/react-router";
import type {
  AnimaBundle,
  AnimaName,
  AnimaSyncRelation,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";

import { requestConfirmDialog } from "../../confirmDialog";
import {
  animaEnvironment,
  createAnimaSyncPorts,
  describeAnimaError,
  useAnimaList,
} from "../../state/anima";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { isConnectedWithConfig } from "../settings/scopedSettings";
import { useEnvironments } from "../../state/environments";
import { cn } from "~/lib/utils";
import { mergeStatusLabel } from "./anima.logic";
import { PageHeading, RelativeTime, useAnimaMutation } from "./AnimaBits";
import { hslToCss, parseHsl } from "./animaVisuals.logic";

type EnvironmentOption = { readonly environmentId: EnvironmentId; readonly label: string };

/** Everything is seen from "here": `there` is the other machine, the diff's source. */
type Comparison = {
  readonly relation: AnimaSyncRelation;
  readonly hereBundle: AnimaBundle | null;
  readonly thereBundle: AnimaBundle | null;
  readonly diff: AnimaBundleDiff;
};

type SyncState =
  | { readonly phase: "idle" }
  | { readonly phase: "working"; readonly label: string; readonly comparison: Comparison | null }
  | { readonly phase: "compared"; readonly comparison: Comparison }
  | { readonly phase: "merging"; readonly mergeId: string; readonly threadId: string }
  | { readonly phase: "done"; readonly message: string };

function notify(type: "success" | "error" | "info", title: string, description?: string) {
  toastManager.add(
    stackedThreadToast({ type, title, ...(description === undefined ? {} : { description }) }),
  );
}

const MODE_VERB = {
  create: "Copy",
  "fast-forward": "Fast-forward",
  replace: "Replace",
} as const;

function BreathList({
  title,
  rows,
  empty,
}: {
  readonly title: string;
  readonly rows: ReadonlyArray<AnimaBreathRow>;
  readonly empty: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 40);
  return (
    <div className="min-w-0 space-y-2">
      <h4 className="flex items-baseline gap-2 text-xs font-medium">
        {title}
        <span className="font-mono text-muted-foreground">{rows.length}</span>
      </h4>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ol className="max-h-96 space-y-1 overflow-y-auto pr-1">
          {shown.map((row) => {
            const hsl = parseHsl(row.hsl);
            return (
              <li key={row.index} className="flex gap-2 rounded-lg bg-background/60 px-2.5 py-1.5">
                <span
                  className="mt-1 size-2.5 shrink-0 rounded-full bg-muted-foreground/40"
                  style={hsl ? { background: hslToCss(hsl) } : undefined}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-2xs text-muted-foreground">
                    <span className="font-mono">#{row.index}</span>
                    {row.at ? <RelativeTime value={row.at} /> : null}
                  </div>
                  <p className="line-clamp-2 text-xs">{row.aim ?? "No aim recorded"}</p>
                </div>
              </li>
            );
          })}
          {rows.length > shown.length ? (
            <li>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setAll(true)}
              >
                Show {rows.length - shown.length} more
              </button>
            </li>
          ) : null}
        </ol>
      )}
    </div>
  );
}

function DiffLines({ lines }: { readonly lines: ReadonlyArray<AnimaDiffLine> }) {
  return (
    <pre className="max-h-[28rem] overflow-auto rounded-lg bg-background/70 py-1 font-mono text-2xs leading-relaxed">
      {lines.map((line, index) =>
        line.kind === "gap" ? (
          <div
            // oxlint-disable-next-line react/no-array-index-key -- diff lines have no identity beyond their position
            key={index}
            className="px-3 py-0.5 text-muted-foreground/70"
          >
            ⋯ {line.count} unchanged
          </div>
        ) : (
          <div
            // oxlint-disable-next-line react/no-array-index-key -- diff lines have no identity beyond their position
            key={index}
            className={cn(
              "whitespace-pre-wrap break-words px-3",
              line.kind === "add" && "bg-success/12 text-success-foreground",
              line.kind === "remove" && "bg-destructive/12 text-destructive-foreground",
            )}
          >
            {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
            {line.text}
          </div>
        ),
      )}
    </pre>
  );
}

function ComparisonView({
  diff,
  here,
  there,
}: {
  readonly diff: AnimaBundleDiff;
  readonly here: string;
  readonly there: string;
}) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-sm font-medium">Breaths</h3>
          <span className="text-xs text-muted-foreground">
            {diff.sharedBreaths} shared by both machines
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <BreathList
            title={`Only on ${there}`}
            rows={diff.sourceOnly}
            empty={`${there} has no breaths ${here} lacks.`}
          />
          <BreathList
            title={`Only on ${here}`}
            rows={diff.destinationOnly}
            empty={`${here} has no breaths ${there} lacks.`}
          />
        </div>
      </section>
      {diff.header.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-sm font-medium">State that differs</h3>
          <div className="overflow-hidden rounded-xl border border-border/60">
            <div className="grid grid-cols-[7rem_1fr_1fr] gap-3 bg-muted/40 px-3 py-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
              <span>Field</span>
              <span>{there}</span>
              <span>{here}</span>
            </div>
            {diff.header.map((change) => (
              <div
                key={change.key}
                className="grid grid-cols-[7rem_1fr_1fr] gap-3 border-t border-border/40 px-3 py-2 text-xs"
              >
                <span className="font-mono text-muted-foreground">{change.key}</span>
                <span className="line-clamp-4 break-words">
                  {change.source ?? <em className="text-muted-foreground">absent</em>}
                </span>
                <span className="line-clamp-4 break-words">
                  {change.destination ?? <em className="text-muted-foreground">absent</em>}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {diff.files.length > 0 ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-sm font-medium">Files</h3>
            <span className="text-xs text-muted-foreground">
              <span className="text-success-foreground">+ {there}</span>
              {"  "}
              <span className="text-destructive-foreground">- {here}</span>
            </span>
          </div>
          <div className="space-y-2">
            {diff.files.map((file, index) => (
              <details
                key={file.path}
                open={index === 0 && file.status === "changed"}
                className="group rounded-xl bg-muted/30"
              >
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none">
                  <span className="font-mono">{file.path}</span>
                  {file.status !== "changed" ? (
                    <Badge size="sm" variant="outline">
                      only on {file.status === "only-source" ? there : here}
                    </Badge>
                  ) : null}
                  <span className="ml-auto font-mono text-2xs">
                    <span className="text-success-foreground">+{file.added}</span>{" "}
                    <span className="text-destructive-foreground">-{file.removed}</span>
                  </span>
                </summary>
                <div className="px-3 pb-3">
                  {file.lines ? (
                    <DiffLines lines={file.lines} />
                  ) : (
                    <p className="text-xs text-muted-foreground">Too large to show line by line.</p>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function MergeProgress({
  environmentId,
  mergeId,
  threadId,
  onApplied,
}: {
  readonly environmentId: EnvironmentId;
  readonly mergeId: string;
  readonly threadId: string;
  readonly onApplied: () => void;
}) {
  const status = useEnvironmentQuery(
    animaEnvironment.mergeStatus({ environmentId, input: { mergeId } }),
  );
  const canApply = useAtomValue(animaEnvironment.mergeApply.permissionAtom(environmentId));
  const apply = useAnimaMutation(animaEnvironment.mergeApply, {
    failureTitle: "Could not apply the merge",
    successTitle: "Merged result applied",
  });
  const state = status.data?.state ?? "running";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge
          size="sm"
          variant={state === "failed" ? "error" : state === "running" ? "info" : "success"}
        >
          {state}
        </Badge>
        <span className="text-xs">{mergeStatusLabel(state)}</span>
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId, threadId }}
          className="ml-auto text-xs underline-offset-2 hover:underline"
        >
          Open merge thread
        </Link>
      </div>
      {status.data?.note ? (
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">{status.data.note}</p>
      ) : null}
      {status.error ? <p className="text-xs text-destructive-foreground">{status.error}</p> : null}
      {state === "ready" ? (
        <Button
          size="xs"
          disabled={!canApply}
          onClick={async () => {
            if (await apply({ environmentId, input: { mergeId } })) onApplied();
          }}
        >
          Apply merged result
        </Button>
      ) : null}
    </div>
  );
}

function SyncPanel({
  name,
  here,
  there,
}: {
  readonly name: AnimaName;
  readonly here: EnvironmentOption;
  readonly there: EnvironmentOption;
}) {
  const registry = useContext(RegistryContext);
  const [state, setState] = useState<SyncState>({ phase: "idle" });
  const [projectId, setProjectId] = useState("");
  const hereList = useAnimaList(here.environmentId);
  const thereList = useAnimaList(there.environmentId);
  const hereSummary = hereList.animas.find((anima) => anima.name === name) ?? null;
  const thereSummary = thereList.animas.find((anima) => anima.name === name) ?? null;
  const canImportHere = useAtomValue(
    animaEnvironment.importBundle.permissionAtom(here.environmentId),
  );
  const canImportThere = useAtomValue(
    animaEnvironment.importBundle.permissionAtom(there.environmentId),
  );
  const canMerge = useAtomValue(animaEnvironment.mergeStart.permissionAtom(here.environmentId));
  const projects = useProjects().filter((project) => project.environmentId === here.environmentId);
  const quick = quickAnimaState(hereSummary, thereSummary);
  const ports = () =>
    createAnimaSyncPorts(registry, (environmentId) =>
      environmentId === here.environmentId
        ? here.label
        : environmentId === there.environmentId
          ? there.label
          : environmentId,
    );
  const fail = (title: string, error: unknown, comparison: Comparison | null) => {
    setState(comparison ? { phase: "compared", comparison } : { phase: "idle" });
    notify("error", title, describeAnimaError(error));
  };

  const compare = async () => {
    setState({ phase: "working", label: "Comparing...", comparison: null });
    try {
      const p = ports();
      const [hereBundle, thereBundle] = await Promise.all([
        hereSummary ? p.exportBundle(here.environmentId, name) : null,
        thereSummary ? p.exportBundle(there.environmentId, name) : null,
      ]);
      if (thereBundle) {
        const { relation } = await p.compare(here.environmentId, thereBundle);
        const diff = diffAnimaBundles(thereBundle, hereBundle);
        setState({ phase: "compared", comparison: { relation, hereBundle, thereBundle, diff } });
      } else if (hereBundle) {
        const diff = diffAnimaBundles(hereBundle, null);
        setState({
          phase: "compared",
          comparison: {
            relation: "missing",
            hereBundle,
            thereBundle,
            diff: { ...diff, sourceOnly: [], destinationOnly: diff.sourceOnly },
          },
        });
      }
    } catch (error) {
      fail("Could not compare", error, null);
    }
  };

  /** Makes `target` match `winner`'s bundle; replace keeps a backup on the target. */
  const take = async (
    comparison: Comparison,
    winner: EnvironmentOption,
    target: EnvironmentOption,
    bundle: AnimaBundle,
    mode: "create" | "fast-forward" | "replace",
  ) => {
    if (mode === "replace") {
      const message = `Replace ${name} on ${target.label} with ${winner.label}'s version?\n${target.label}'s breaths and edits that ${winner.label} lacks are discarded. A backup is kept on ${target.label}.`;
      const confirmed =
        (await requestConfirmDialog(message, { variant: "destructive" })) ??
        window.confirm(message);
      if (!confirmed) return;
    }
    setState({ phase: "working", label: "Syncing...", comparison });
    try {
      await ports().importBundle(target.environmentId, { bundle, mode });
      const message = `${target.label} now matches ${winner.label}.`;
      setState({ phase: "done", message });
      notify("success", message);
      hereList.refresh();
      thereList.refresh();
    } catch (error) {
      fail("Sync failed", error, comparison);
    }
  };

  const merge = async (comparison: Comparison, bundle: AnimaBundle) => {
    setState({ phase: "working", label: "Starting the merge...", comparison });
    try {
      const started = await resolveAnimaSync(
        { kind: "merge", projectId: projectId as ProjectId },
        { toEnvironmentId: here.environmentId },
        bundle,
        ports(),
      );
      if (started.kind === "merging") {
        setState({ phase: "merging", mergeId: started.mergeId, threadId: started.threadId });
      }
    } catch (error) {
      fail("Could not start the merge", error, comparison);
    }
  };

  const comparison =
    state.phase === "compared" || state.phase === "working" ? (state.comparison ?? null) : null;
  const busy = state.phase === "working";
  const selectedProject = projects.find((project) => project.id === projectId);
  const takeThere = comparison?.thereBundle != null ? animaTakeMode(comparison.relation) : null;
  const takeHere =
    comparison?.hereBundle != null
      ? comparison.thereBundle
        ? animaTakeMode(invertAnimaRelation(comparison.relation))
        : "create"
      : null;
  const canMergeHere =
    comparison?.thereBundle != null &&
    comparison.hereBundle !== null &&
    (comparison.relation === "diverged" || comparison.relation === "unrelated");

  return (
    <div className="space-y-6">
      <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
        <MachineCard label={there.label} summary={thereSummary} caption="Other machine" />
        <div className="flex flex-col items-center justify-center gap-2 px-2">
          <Badge
            size="sm"
            variant={
              quick === "identical" ? "success" : quick === "unrelated" ? "error" : "warning"
            }
          >
            {comparison
              ? animaSyncRelationLabel(comparison.relation)
              : quick === "identical"
                ? "Identical"
                : quick === "only-here"
                  ? `Only on ${here.label}`
                  : quick === "only-there"
                    ? `Only on ${there.label}`
                    : quick === "unrelated"
                      ? "Different anima"
                      : "Differs"}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || quick === "identical"}
            onClick={() => void compare()}
          >
            {busy ? state.label : comparison ? "Compare again" : "Compare"}
          </Button>
        </div>
        <MachineCard label={here.label} summary={hereSummary} caption="This machine" />
      </div>

      {comparison ? (
        <div className="space-y-3 rounded-2xl border border-border/60 p-4">
          <div>
            <h3 className="text-sm font-medium">Reconcile</h3>
            <p className="text-xs text-muted-foreground">
              {relationAdvice(comparison.relation, here.label, there.label)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {takeThere && comparison.thereBundle ? (
              <Button
                size="sm"
                variant={takeThere === "replace" ? "destructive-outline" : "default"}
                disabled={busy || !canImportHere}
                onClick={() =>
                  void take(comparison, there, here, comparison.thereBundle!, takeThere)
                }
              >
                <ArrowRightIcon />
                {MODE_VERB[takeThere]} {here.label} from {there.label}
              </Button>
            ) : null}
            {takeHere && comparison.hereBundle ? (
              <Button
                size="sm"
                variant={takeHere === "replace" ? "destructive-outline" : "default"}
                disabled={busy || !canImportThere}
                onClick={() => void take(comparison, here, there, comparison.hereBundle!, takeHere)}
              >
                <ArrowLeftIcon />
                {MODE_VERB[takeHere]} {there.label} from {here.label}
              </Button>
            ) : null}
          </div>
          {canMergeHere ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
              <span className="text-xs text-muted-foreground">
                Or keep both: an agent merges {there.label}&apos;s breaths into {here.label}
              </span>
              <Select value={projectId} onValueChange={(value) => setProjectId(String(value))}>
                <SelectTrigger size="sm" aria-label="Project for the merge agent">
                  <SelectValue>{selectedProject?.title ?? "In project..."}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id} label={project.title}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !selectedProject || !canMerge}
                onClick={() => void merge(comparison, comparison.thereBundle!)}
              >
                <CombineIcon />
                Merge with agent
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {state.phase === "done" ? (
        <p className="rounded-xl bg-muted/30 px-4 py-3 text-sm">{state.message}</p>
      ) : null}
      {state.phase === "merging" ? (
        <div className="rounded-2xl bg-muted/30 p-4">
          <MergeProgress
            environmentId={here.environmentId}
            mergeId={state.mergeId}
            threadId={state.threadId}
            onApplied={() => {
              setState({ phase: "done", message: `Merged on ${here.label}.` });
              hereList.refresh();
            }}
          />
        </div>
      ) : null}
      {comparison ? (
        <ComparisonView diff={comparison.diff} here={here.label} there={there.label} />
      ) : null}
    </div>
  );
}

function relationAdvice(relation: AnimaSyncRelation, here: string, there: string): string {
  switch (relation) {
    case "missing":
      return `Only one machine has this anima. Copy it across.`;
    case "identical":
      return "Both machines hold the same anima.";
    case "incoming-ahead":
      return `${there} has every breath ${here} has, plus more. Fast-forward ${here} to catch up.`;
    case "local-ahead":
      return `${here} has every breath ${there} has, plus more. Fast-forward ${there} to catch up.`;
    case "diverged":
      return `Both machines breathed since the last shared breath. Pick the side that wins, or let an agent merge them. Replacing keeps a backup of the side that loses.`;
    case "unrelated":
      return `These are different animas that share a name. Replacing one keeps a backup of it.`;
  }
}

function MachineCard({
  label,
  caption,
  summary,
}: {
  readonly label: string;
  readonly caption: string;
  readonly summary: {
    readonly breathCount: number;
    readonly lastBreathAt: string | null;
    readonly aim: string | null;
  } | null;
}) {
  return (
    <div className="min-w-0 space-y-1 rounded-2xl bg-muted/30 p-4">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">{caption}</p>
      <p className="truncate text-sm font-medium">{label}</p>
      {summary ? (
        <>
          <p className="text-xs text-muted-foreground">
            {summary.breathCount} breaths
            {summary.lastBreathAt ? (
              <>
                {", last "}
                <RelativeTime value={summary.lastBreathAt} />
              </>
            ) : null}
          </p>
          {summary.aim ? <p className="line-clamp-2 text-xs">{summary.aim}</p> : null}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Not on this machine</p>
      )}
    </div>
  );
}

export function SyncTab({
  environmentId,
  name,
}: {
  readonly environmentId: EnvironmentId;
  readonly name: AnimaName;
}) {
  const connectedEnvironments = useEnvironments().environments.filter(isConnectedWithConfig);
  const others = connectedEnvironments.filter((entry) => entry.environmentId !== environmentId);
  const here = connectedEnvironments.find((entry) => entry.environmentId === environmentId);
  const [otherId, setOtherId] = useState<EnvironmentId | null>(null);
  const other = others.find((entry) => entry.environmentId === otherId) ?? others[0] ?? null;
  if (!here || !other) {
    return (
      <div className="space-y-4">
        <PageHeading eyebrow="Sync" title={`Carry ${name} between machines`} />
        <p className="text-sm text-muted-foreground">
          Connect a second environment to copy {name} between machines.
        </p>
      </div>
    );
  }
  const hereOption = { environmentId: here.environmentId, label: here.label };
  const otherOption = { environmentId: other.environmentId, label: other.label };
  return (
    <div className="space-y-8">
      <PageHeading eyebrow="Sync" title={`Carry ${name} between machines`} />
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Sync with</span>
        <Select
          value={other.environmentId}
          onValueChange={(value) => setOtherId(value as EnvironmentId)}
        >
          <SelectTrigger size="sm" aria-label="Environment to sync with">
            <SelectValue>{other.label}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {others.map((entry) => (
              <SelectItem key={entry.environmentId} value={entry.environmentId} label={entry.label}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <SyncPanel key={other.environmentId} name={name} here={hereOption} there={otherOption} />
    </div>
  );
}
