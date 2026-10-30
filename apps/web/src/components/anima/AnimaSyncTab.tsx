import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  type AnimaBreathRow,
  type AnimaBundleDiff,
  type AnimaDiffLine,
  animaSyncRelationLabel,
  diffAnimaBundles,
  quickAnimaState,
  syncAnimaPair,
} from "@t3tools/client-runtime/anima-sync";
import { availableScratchWorkspaceRoot } from "@t3tools/client-runtime/operations/projects";
import { ArrowLeftIcon, ArrowRightIcon, CombineIcon, SparklesIcon } from "lucide-react";
import { useContext, useState } from "react";
import { create } from "zustand";
import { createModelSelection } from "@t3tools/shared/model";
import { Link } from "@tanstack/react-router";
import type {
  AnimaBundle,
  AnimaMergeConflict,
  AnimaName,
  AnimaSyncRelation,
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";

import { requestConfirmDialog } from "../../confirmDialog";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { scheduledTaskDefaultModel } from "../settings/scheduledTasksSettings.logic";
import {
  animaEnvironment,
  createAnimaSyncPorts,
  describeAnimaError,
  useAnimaList,
} from "../../state/anima";
import { useEnvironmentQuery } from "../../state/query";
import { useProjects } from "../../state/entities";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { isConnectedWithConfig } from "../settings/scopedSettings";
import { useEnvironments } from "../../state/environments";
import { cn } from "~/lib/utils";
import { mergeStatusLabel } from "./anima.logic";
import { PageHeading, RelativeTime, useAnimaMutation } from "./AnimaBits";
import { hslToCss, parseHsl } from "./animaVisuals.logic";
import { staySyncKey, useAnimaStaySyncStore } from "./animaStaySync";
import { useRunStaySync } from "./AnimaStaySyncRunner";

type EnvironmentOption = { readonly environmentId: EnvironmentId; readonly label: string };

/** Everything is seen from "here": `there` is the other machine, the diff's source. */
type Comparison = {
  readonly relation: AnimaSyncRelation;
  /** Changed differently on both machines since they last synced; merging stops here. */
  readonly conflicts: ReadonlyArray<AnimaMergeConflict>;
  readonly hereBundle: AnimaBundle | null;
  readonly thereBundle: AnimaBundle | null;
  readonly diff: AnimaBundleDiff;
};

type SyncState =
  | { readonly phase: "idle"; readonly error?: string }
  | { readonly phase: "working"; readonly label: string; readonly comparison: Comparison | null }
  | { readonly phase: "compared"; readonly comparison: Comparison; readonly error?: string }
  | { readonly phase: "merging"; readonly mergeId: string; readonly threadId: string }
  | { readonly phase: "done"; readonly message: string };

/**
 * Kept outside the panel so a comparison or a running merge survives leaving the page; work
 * started before leaving still lands here. In memory only, since bundles can be large.
 */
const useSyncPanelStore = create<{
  readonly panels: Readonly<Record<string, SyncState>>;
  readonly set: (key: string, state: SyncState) => void;
}>((set) => ({
  panels: {},
  set: (key, state) => set((current) => ({ panels: { ...current.panels, [key]: state } })),
}));

const IDLE: SyncState = { phase: "idle" };
const NO_PROJECT = "no-project";

function notify(type: "success" | "error" | "info", title: string, description?: string) {
  toastManager.add(
    stackedThreadToast({ type, title, ...(description === undefined ? {} : { description }) }),
  );
}

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

function ConflictList({
  conflicts,
  here,
  there,
}: {
  readonly conflicts: ReadonlyArray<AnimaMergeConflict>;
  readonly here: string;
  readonly there: string;
}) {
  return (
    <ul className="space-y-2">
      {conflicts.map((conflict) => (
        <li
          key={`${conflict.path}:${conflict.key ?? ""}`}
          className="rounded-xl bg-warning/8 p-3 dark:bg-warning/12"
        >
          <p className="mb-2 font-mono text-xs">
            {conflict.key === null ? conflict.path : `${conflict.key} (${conflict.path})`}
          </p>
          <div className="grid gap-3 text-xs md:grid-cols-2">
            {[
              [there, conflict.incoming],
              [here, conflict.local],
            ].map(([label, text]) => (
              <div key={label} className="min-w-0">
                <p className="mb-1 text-2xs uppercase tracking-wide text-muted-foreground">
                  {label}
                </p>
                <p className="line-clamp-4 whitespace-pre-wrap break-words">{text}</p>
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StaySynced({
  name,
  here,
  there,
  present,
}: {
  readonly name: AnimaName;
  readonly here: EnvironmentOption;
  readonly there: EnvironmentOption;
  readonly present: { readonly first: boolean; readonly second: boolean };
}) {
  const key = staySyncKey(name, here.environmentId, there.environmentId);
  const link = useAnimaStaySyncStore((state) => state.links[key] ?? null);
  const status = useAnimaStaySyncStore((state) => state.statuses[key] ?? null);
  const setEnabled = useAnimaStaySyncStore((state) => state.setEnabled);
  const runSync = useRunStaySync();
  const line = !link
    ? `Off. Turn on to merge every change between ${here.label} and ${there.label} while this app is open.`
    : link.paused
      ? `Paused: ${link.paused.conflicts.join(", ")} changed on both machines. Compare to resolve.`
      : status?.state === "syncing"
        ? "Syncing..."
        : status?.state === "error"
          ? `Last attempt failed: ${status.message}`
          : status?.state === "waiting"
            ? "Waiting for both machines to be connected."
            : status?.state === "synced"
              ? "In sync. Changes on either machine follow within a few seconds."
              : "On.";
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-muted/30 p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Stay synced</p>
        <p
          className={cn(
            "text-xs",
            link?.paused ? "text-warning-foreground" : "text-muted-foreground",
          )}
        >
          {line}
        </p>
      </div>
      <Switch
        aria-label="Stay synced"
        checked={link !== null}
        onCheckedChange={(checked) => {
          setEnabled(name, here.environmentId, there.environmentId, checked);
          const created = useAnimaStaySyncStore.getState().links[key];
          // The runner only acts on differences; a first run also records the shared base.
          if (checked && created) void runSync(key, created, present);
        }}
      />
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
  const panelKey = `${name}|${here.environmentId}|${there.environmentId}`;
  const state = useSyncPanelStore((store) => store.panels[panelKey] ?? IDLE);
  const setState = (next: SyncState) => useSyncPanelStore.getState().set(panelKey, next);
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
  const hereEnvironment = useEnvironments().environments.find(
    (entry) => entry.environmentId === here.environmentId,
  );
  // Without a scratch folder (a server whose data lives in a checkout) the agent needs a project.
  const noProject =
    availableScratchWorkspaceRoot(
      hereEnvironment?.connection.phase,
      hereEnvironment?.serverConfig,
    ) !== null;
  const projects = useProjects().filter((project) => project.environmentId === here.environmentId);
  const [projectId, setProjectId] = useState(() =>
    noProject ? NO_PROJECT : (projects[0]?.id ?? NO_PROJECT),
  );
  const selectedProject = projects.find((project) => project.id === projectId);
  const runInScratch = selectedProject === undefined;
  const settings = useEnvironmentSettings(here.environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(here.environmentId)) ??
    EMPTY_SERVER_PROVIDERS;
  const instanceEntries = providerInstanceEntriesFor(
    providers,
    settings,
    selectedProject?.id ?? null,
  );
  const [pickedModel, setPickedModel] = useState<ModelSelection | null>(null);
  const modelSelection =
    pickedModel &&
    instanceEntries.some((entry) => entry.instanceId === pickedModel.instanceId && entry.enabled)
      ? pickedModel
      : scheduledTaskDefaultModel(settings, selectedProject ?? null, instanceEntries);
  const activeModelEntry = modelSelection
    ? instanceEntries.find((entry) => entry.instanceId === modelSelection.instanceId)
    : undefined;
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    modelSelection?.instanceId ?? instanceEntries[0]?.instanceId ?? ("" as ProviderInstanceId),
    modelSelection?.model ?? "",
  );
  const quick = quickAnimaState(hereSummary, thereSummary);
  // A merge started earlier (before a reload or from another window) stays until it is applied.
  const latestMergeQuery = useEnvironmentQuery(
    animaEnvironment.mergeStatus({ environmentId: here.environmentId, input: { name } }),
  );
  const latestMerge = latestMergeQuery.data;
  const pendingMerge =
    state.phase !== "merging" &&
    latestMerge &&
    (latestMerge.state === "running" || latestMerge.state === "ready") &&
    latestMerge.threadId !== null
      ? { mergeId: latestMerge.mergeId, threadId: latestMerge.threadId }
      : null;
  // Until both lists load, an anima missing from one only looks absent.
  const listsLoaded = hereList.data !== null && thereList.data !== null;
  const present = { first: hereSummary !== null, second: thereSummary !== null };
  const ports = () =>
    createAnimaSyncPorts(registry, (environmentId) =>
      environmentId === here.environmentId
        ? here.label
        : environmentId === there.environmentId
          ? there.label
          : environmentId,
    );
  const refresh = () => {
    hereList.refresh();
    thereList.refresh();
  };
  const fail = (title: string, error: unknown, comparison: Comparison | null) => {
    const message = `${title}: ${describeAnimaError(error)}`;
    setState(
      comparison
        ? { phase: "compared", comparison, error: message }
        : { phase: "idle", error: message },
    );
    notify("error", title, describeAnimaError(error));
  };

  const compare = async () => {
    setState({ phase: "working", label: "Comparing...", comparison: null });
    try {
      const p = ports();
      // A connection that just woke up can drop the first request, so exports retry once.
      const exportFrom = (environmentId: EnvironmentId) =>
        p.exportBundle(environmentId, name).catch(() => p.exportBundle(environmentId, name));
      const [hereBundle, thereBundle] = await Promise.all([
        hereSummary ? exportFrom(here.environmentId) : null,
        thereSummary ? exportFrom(there.environmentId) : null,
      ]);
      if (thereBundle) {
        const result = await p.compare(here.environmentId, thereBundle);
        setState({
          phase: "compared",
          comparison: {
            relation: result.relation,
            conflicts: result.conflicts ?? [],
            hereBundle,
            thereBundle,
            diff: diffAnimaBundles(thereBundle, hereBundle),
          },
        });
      } else if (hereBundle) {
        const diff = diffAnimaBundles(hereBundle, null);
        setState({
          phase: "compared",
          comparison: {
            relation: "missing",
            conflicts: [],
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

  const mergeBoth = async (comparison: Comparison | null) => {
    setState({ phase: "working", label: "Merging...", comparison });
    try {
      const result = await syncAnimaPair(
        { name, first: here.environmentId, second: there.environmentId, present },
        ports(),
      );
      if (result.status === "conflicts") {
        setState(comparison ? { phase: "compared", comparison } : { phase: "idle" });
        notify("info", "Both machines changed the same things", "Resolve them with an agent.");
        return;
      }
      if (result.status === "unrelated") {
        setState({ phase: "done", message: "These are different animas; overwrite one instead." });
        return;
      }
      setState({
        phase: "done",
        message: `${here.label} and ${there.label} now hold the same ${name}, with every breath from both.`,
      });
      notify("success", `${name} merged`);
      refresh();
    } catch (error) {
      fail("Merge failed", error, comparison);
    }
  };

  /** Overwrites `target` with `winner`'s copy; the target keeps a backup. */
  const overwrite = async (
    comparison: Comparison,
    winner: EnvironmentOption,
    target: EnvironmentOption,
    bundle: AnimaBundle,
  ) => {
    const message = `Replace ${name} on ${target.label} with ${winner.label}'s copy?\n${target.label}'s breaths and edits that ${winner.label} lacks are discarded. A backup is kept on ${target.label}.`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (!confirmed) return;
    setState({ phase: "working", label: "Syncing...", comparison });
    try {
      await ports().importBundle(target.environmentId, { bundle, mode: "replace" });
      const done = `${target.label} now matches ${winner.label}.`;
      setState({ phase: "done", message: done });
      notify("success", done);
      refresh();
    } catch (error) {
      fail("Sync failed", error, comparison);
    }
  };

  const resolveWithAgent = async (comparison: Comparison, bundle: AnimaBundle) => {
    setState({ phase: "working", label: "Starting the merge...", comparison });
    try {
      const started = await ports().mergeStart(here.environmentId, {
        bundle,
        ...(selectedProject ? { projectId: selectedProject.id as ProjectId } : {}),
        ...(modelSelection ? { modelSelection } : {}),
        localLabel: here.label,
        incomingLabel: there.label,
      });
      setState({ phase: "merging", mergeId: started.mergeId, threadId: started.threadId });
    } catch (error) {
      fail("Could not start the merge", error, comparison);
    }
  };

  const comparison =
    state.phase === "compared" || state.phase === "working" ? (state.comparison ?? null) : null;
  const busy = state.phase === "working";
  const both = comparison?.hereBundle != null && comparison.thereBundle != null;
  const conflicts = comparison?.conflicts ?? [];
  const canMergeBoth =
    comparison !== null &&
    comparison.relation !== "identical" &&
    comparison.relation !== "unrelated" &&
    conflicts.length === 0;

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
            disabled={busy || !listsLoaded || quick === "identical"}
            onClick={() => void compare()}
          >
            {busy ? state.label : comparison ? "Compare again" : "Compare"}
          </Button>
        </div>
        <MachineCard label={here.label} summary={hereSummary} caption="This machine" />
      </div>

      <StaySynced name={name} here={here} there={there} present={present} />

      {comparison ? (
        <div className="space-y-3 rounded-2xl border border-border/60 p-4">
          <div>
            <h3 className="text-sm font-medium">Reconcile</h3>
            <p className="text-xs text-muted-foreground">
              {relationAdvice(comparison.relation, conflicts.length, here.label, there.label)}
            </p>
          </div>
          {conflicts.length > 0 ? (
            <ConflictList conflicts={conflicts} here={here.label} there={there.label} />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {canMergeBoth ? (
              <Button
                size="sm"
                disabled={busy || !canImportHere || !canImportThere}
                onClick={() => void mergeBoth(comparison)}
              >
                <CombineIcon />
                {both
                  ? "Merge both"
                  : `Copy to ${comparison.hereBundle ? there.label : here.label}`}
              </Button>
            ) : null}
            {conflicts.length > 0 && comparison.thereBundle ? (
              <Button
                size="sm"
                disabled={busy || !canMerge || (runInScratch && !noProject) || !modelSelection}
                onClick={() => void resolveWithAgent(comparison, comparison.thereBundle!)}
              >
                <SparklesIcon />
                Resolve with an agent
              </Button>
            ) : null}
          </div>
          {conflicts.length > 0 && comparison.thereBundle ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Run it in</span>
              <Select value={projectId} onValueChange={(value) => setProjectId(String(value))}>
                <SelectTrigger size="sm" aria-label="Where the merge agent runs">
                  <SelectValue>{selectedProject?.title ?? "No project"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={NO_PROJECT} label="No project" disabled={!noProject}>
                    No project
                  </SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id} label={project.title}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <span>with</span>
              {modelSelection ? (
                <ProviderModelPicker
                  environmentId={here.environmentId}
                  disabled={busy}
                  activeInstanceId={modelSelection.instanceId}
                  model={modelSelection.model}
                  lockedProvider={null}
                  instanceEntries={instanceEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  isComposerOwned={false}
                  onInstanceModelChange={(instanceId, model) =>
                    setPickedModel(createModelSelection(instanceId, model))
                  }
                />
              ) : (
                <span className="text-destructive-foreground">no model is set up here</span>
              )}
              {modelSelection && activeModelEntry ? (
                <TraitsPicker
                  provider={activeModelEntry.driverKind}
                  models={activeModelEntry.models}
                  model={modelSelection.model}
                  modelOptions={modelSelection.options ?? []}
                  allowPromptInjectedEffort={false}
                  planModeEnabled={false}
                  disabled={busy}
                  onModelOptionsChange={(options) =>
                    setPickedModel(
                      createModelSelection(
                        modelSelection.instanceId,
                        modelSelection.model,
                        options,
                      ),
                    )
                  }
                />
              ) : null}
              {runInScratch && !noProject ? (
                <span className="basis-full">
                  No project isn&apos;t available on {here.label}: its data folder is inside a git
                  checkout. Pick a project instead.
                </span>
              ) : null}
            </div>
          ) : null}
          {both && comparison.relation !== "identical" ? (
            <details className="border-t border-border/40 pt-3">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Or overwrite one machine instead
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="destructive-outline"
                  disabled={busy || !canImportHere}
                  onClick={() => void overwrite(comparison, there, here, comparison.thereBundle!)}
                >
                  <ArrowRightIcon />
                  Replace {here.label} with {there.label}&apos;s copy
                </Button>
                <Button
                  size="sm"
                  variant="destructive-outline"
                  disabled={busy || !canImportThere}
                  onClick={() => void overwrite(comparison, here, there, comparison.hereBundle!)}
                >
                  <ArrowLeftIcon />
                  Replace {there.label} with {here.label}&apos;s copy
                </Button>
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      {(state.phase === "idle" || state.phase === "compared") && state.error ? (
        <p className="rounded-xl bg-destructive/8 px-4 py-3 text-sm text-destructive-foreground">
          {state.error}
        </p>
      ) : null}
      {state.phase === "done" ? (
        <p className="rounded-xl bg-muted/30 px-4 py-3 text-sm">{state.message}</p>
      ) : null}
      {pendingMerge ? (
        <div className="rounded-2xl bg-muted/30 p-4">
          <MergeProgress
            environmentId={here.environmentId}
            mergeId={pendingMerge.mergeId}
            threadId={pendingMerge.threadId}
            onApplied={() => {
              latestMergeQuery.refresh();
              void mergeBoth(null);
            }}
          />
        </div>
      ) : null}
      {state.phase === "merging" ? (
        <div className="rounded-2xl bg-muted/30 p-4">
          <MergeProgress
            environmentId={here.environmentId}
            mergeId={state.mergeId}
            threadId={state.threadId}
            onApplied={() => void mergeBoth(null)}
          />
        </div>
      ) : null}
      {comparison ? (
        <ComparisonView diff={comparison.diff} here={here.label} there={there.label} />
      ) : null}
    </div>
  );
}

function relationAdvice(
  relation: AnimaSyncRelation,
  conflicts: number,
  here: string,
  there: string,
): string {
  if (conflicts > 0)
    return "Both machines changed the items below since they last synced; everything else merges on its own. An agent asks you about each one, then the result goes to both machines.";
  switch (relation) {
    case "missing":
      return "Only one machine has this anima. Copy it across.";
    case "identical":
      return "Both machines hold the same anima.";
    case "incoming-ahead":
      return `${there} has every breath ${here} has, plus more. Merging brings ${here} up to date and keeps anything ${here} changed.`;
    case "local-ahead":
      return `${here} has every breath ${there} has, plus more. Merging brings ${there} up to date and keeps anything ${there} changed.`;
    case "diverged":
      return "Both machines did their own work since the last shared breath. Merging keeps every breath from both, ordered by time, and combines the rest.";
    case "unrelated":
      return "These are different animas that share a name. They cannot merge; overwrite one if you mean to.";
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
