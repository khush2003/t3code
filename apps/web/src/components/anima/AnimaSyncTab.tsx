import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  type AnimaSyncOutcome,
  animaSyncRelationLabel,
  compareAnimaAcross,
  quickAnimaState,
  resolveAnimaSync,
  syncAnima,
} from "@t3tools/client-runtime/anima-sync";
import { ArrowDownToLineIcon, ArrowUpFromLineIcon } from "lucide-react";
import { useContext, useState } from "react";
import { Link } from "@tanstack/react-router";
import type {
  AnimaBundle,
  AnimaCompareResult,
  AnimaName,
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
import { useSettingsScope } from "../settings/SettingsScopeContext";
import { mergeStatusLabel } from "./anima.logic";
import { PageHeading, useAnimaMutation } from "./AnimaBits";

type EnvironmentOption = { readonly environmentId: EnvironmentId; readonly label: string };

type DirectionState =
  | { readonly phase: "idle" }
  | { readonly phase: "working" }
  | { readonly phase: "checked"; readonly compare: AnimaCompareResult }
  | {
      readonly phase: "choice";
      readonly reason: "diverged" | "unrelated";
      readonly compare: AnimaCompareResult;
      readonly bundle: AnimaBundle;
    }
  | { readonly phase: "merging"; readonly mergeId: string; readonly threadId: string }
  | { readonly phase: "done"; readonly message: string };

function notify(type: "success" | "error" | "info", title: string, description?: string) {
  toastManager.add(
    stackedThreadToast({ type, title, ...(description === undefined ? {} : { description }) }),
  );
}

function outcomeMessage(outcome: AnimaSyncOutcome, destination: string): string | null {
  switch (outcome.status) {
    case "created":
      return `Created on ${destination}.`;
    case "fast-forwarded":
      return `${destination} fast-forwarded.`;
    case "up-to-date":
      return "Already identical.";
    case "destination-ahead":
      return `${destination} is ahead. Sync the other way to update the source.`;
    case "needs-choice":
      return null;
  }
}

function CompareSummary({ compare }: { readonly compare: AnimaCompareResult }) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        {compare.localOnlyBreaths} breaths only on the destination, {compare.incomingOnlyBreaths}{" "}
        only on the source.
        {compare.commonBreath >= 0 ? ` Last shared breath: #${compare.commonBreath}.` : ""}
      </p>
      {compare.changedFiles.length > 0 ? (
        <p className="break-words font-mono text-2xs">
          Changed: {compare.changedFiles.slice(0, 12).join(", ")}
          {compare.changedFiles.length > 12 ? ` and ${compare.changedFiles.length - 12} more` : ""}
        </p>
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

function SyncDirection({
  title,
  icon,
  name,
  source,
  destination,
}: {
  readonly title: string;
  readonly icon: React.ReactNode;
  readonly name: AnimaName;
  readonly source: EnvironmentOption;
  readonly destination: EnvironmentOption;
}) {
  const registry = useContext(RegistryContext);
  const [state, setState] = useState<DirectionState>({ phase: "idle" });
  const [projectId, setProjectId] = useState("");
  const sourceList = useAnimaList(source.environmentId);
  const destinationList = useAnimaList(destination.environmentId);
  const canImport = useAtomValue(
    animaEnvironment.importBundle.permissionAtom(destination.environmentId),
  );
  const canMerge = useAtomValue(
    animaEnvironment.mergeStart.permissionAtom(destination.environmentId),
  );
  const projects = useProjects().filter(
    (project) => project.environmentId === destination.environmentId,
  );
  const request = {
    fromEnvironmentId: source.environmentId,
    toEnvironmentId: destination.environmentId,
    name,
  };
  const quick = quickAnimaState(
    sourceList.animas.find((anima) => anima.name === name) ?? null,
    destinationList.animas.find((anima) => anima.name === name) ?? null,
  );
  const refreshLists = () => {
    sourceList.refresh();
    destinationList.refresh();
  };
  const fail = (title: string, error: unknown) => {
    setState({ phase: "idle" });
    notify("error", title, describeAnimaError(error));
  };

  const check = async () => {
    setState({ phase: "working" });
    try {
      const { compare } = await compareAnimaAcross(request, createAnimaSyncPorts(registry));
      setState({ phase: "checked", compare });
    } catch (error) {
      fail("Could not compare", error);
    }
  };
  const run = async () => {
    setState({ phase: "working" });
    try {
      const outcome = await syncAnima(request, createAnimaSyncPorts(registry));
      if (outcome.status === "needs-choice") {
        setState({ phase: "choice", ...outcome });
        return;
      }
      const message = outcomeMessage(outcome, destination.label) ?? "";
      setState({ phase: "done", message });
      if (outcome.status === "created" || outcome.status === "fast-forwarded") {
        notify("success", message);
        refreshLists();
      }
    } catch (error) {
      fail("Sync failed", error);
    }
  };
  const replace = async (bundle: AnimaBundle) => {
    const confirmed =
      (await requestConfirmDialog(
        `Replace ${name} on ${destination.label}?\nIts own breaths that ${source.label} lacks are discarded. A backup is kept on that machine.`,
        { variant: "destructive" },
      )) ?? window.confirm(`Replace ${name} on ${destination.label}?`);
    if (!confirmed) return;
    setState({ phase: "working" });
    try {
      await resolveAnimaSync({ kind: "replace" }, request, bundle, createAnimaSyncPorts(registry));
      setState({ phase: "done", message: `Replaced on ${destination.label}.` });
      notify("success", `${name} replaced on ${destination.label}`);
      refreshLists();
    } catch (error) {
      fail("Replace failed", error);
    }
  };
  const merge = async (bundle: AnimaBundle) => {
    setState({ phase: "working" });
    try {
      const started = await resolveAnimaSync(
        { kind: "merge", projectId: projectId as ProjectId },
        request,
        bundle,
        createAnimaSyncPorts(registry),
      );
      if (started.kind === "merging") {
        setState({ phase: "merging", mergeId: started.mergeId, threadId: started.threadId });
      }
    } catch (error) {
      fail("Could not start the merge", error);
    }
  };

  const busy = state.phase === "working";
  const selectedProject = projects.find((project) => project.id === projectId);
  return (
    <div className="space-y-3 rounded-2xl bg-muted/30 p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-medium">{title}</h3>
        <Badge
          size="sm"
          variant={quick === "identical" ? "success" : quick === "unrelated" ? "error" : "outline"}
        >
          {quick === "identical"
            ? "Identical"
            : quick === "only-here"
              ? "Only on source"
              : quick === "only-there"
                ? "Only on destination"
                : quick === "unrelated"
                  ? "Different anima"
                  : "Differs"}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {source.label} to {destination.label}
      </p>
      {state.phase === "checked" ? (
        <div className="space-y-1">
          <Badge size="sm" variant="info">
            {animaSyncRelationLabel(state.compare.relation)}
          </Badge>
          <CompareSummary compare={state.compare} />
        </div>
      ) : null}
      {state.phase === "done" ? <p className="text-xs">{state.message}</p> : null}
      {state.phase === "choice" ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <Badge size="sm" variant="warning">
              {animaSyncRelationLabel(state.reason)}
            </Badge>
            <CompareSummary compare={state.compare} />
            <p className="text-xs">
              Both sides have changes the other lacks. Let an agent merge them, or replace the
              destination.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={projectId} onValueChange={(value) => setProjectId(String(value))}>
              <SelectTrigger size="sm" aria-label="Project for the merge agent">
                <SelectValue>{selectedProject?.title ?? "Merge in project..."}</SelectValue>
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
              size="xs"
              disabled={!selectedProject || !canMerge}
              onClick={() => void merge(state.bundle)}
            >
              Merge with agent
            </Button>
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={!canImport}
              onClick={() => void replace(state.bundle)}
            >
              Replace destination
            </Button>
          </div>
        </div>
      ) : null}
      {state.phase === "merging" ? (
        <MergeProgress
          environmentId={destination.environmentId}
          mergeId={state.mergeId}
          threadId={state.threadId}
          onApplied={() => {
            setState({ phase: "done", message: `Merged on ${destination.label}.` });
            refreshLists();
          }}
        />
      ) : null}
      {state.phase !== "merging" && state.phase !== "choice" ? (
        <div className="flex gap-2">
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void check()}>
            Check differences
          </Button>
          <Button
            size="xs"
            disabled={busy || !canImport || quick === "identical"}
            onClick={() => void run()}
          >
            {busy ? "Working..." : "Sync"}
          </Button>
        </div>
      ) : null}
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
  const { connectedEnvironments } = useSettingsScope();
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
      <div className="grid gap-3 md:grid-cols-2">
        <SyncDirection
          key={`pull:${other.environmentId}`}
          title="Pull"
          icon={<ArrowDownToLineIcon className="size-4" />}
          name={name}
          source={otherOption}
          destination={hereOption}
        />
        <SyncDirection
          key={`push:${other.environmentId}`}
          title="Push"
          icon={<ArrowUpFromLineIcon className="size-4" />}
          name={name}
          source={hereOption}
          destination={otherOption}
        />
      </div>
    </div>
  );
}
