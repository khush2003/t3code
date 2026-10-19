import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiative, AtlasTaskId, EnvironmentId } from "@t3tools/contracts";
import { CheckCircle2Icon, CircleAlertIcon, LoaderIcon } from "lucide-react";
import { useState } from "react";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { atlasEnvironment } from "../../state/atlas";
import { useEnvironmentProviders } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { autoReviewLabel } from "./AtlasAutoReviewDialog";
import {
  AtlasRunOptionsFields,
  DEFAULT_ATLAS_RUN_OPTIONS,
  selectAtlasModel,
  type AtlasRunOptions,
} from "./AtlasRunOptionsFields";
import { bulkCandidates, runBounded, type AtlasBulkAction } from "./atlasTaskListLogic";

// Each call launches an agent or hits GitHub; a small cap keeps a large batch
// from flooding the provider or the remote connection.
const BULK_CONCURRENCY = 3;

const COPY: Record<
  AtlasBulkAction,
  { title: string; description: string; confirm: (count: number) => string }
> = {
  publish: {
    title: "Publish and sync issues",
    description:
      "Creates a GitHub issue for each unpublished task and updates issues whose task changed.",
    confirm: (count) => `Publish ${count} issue${count === 1 ? "" : "s"}`,
  },
  run: {
    title: "Run ready tasks",
    description: "Starts one agent per task, each in its own new worktree so they run in parallel.",
    confirm: (count) => `Run ${count} task${count === 1 ? "" : "s"}`,
  },
  approve: {
    title: "Approve reviewed tasks",
    description: "Marks the checked tasks approved, which unblocks their dependents.",
    confirm: (count) => `Approve ${count} task${count === 1 ? "" : "s"}`,
  },
};

type Outcome =
  | { readonly state: "pending" }
  | { readonly state: "ok" }
  | {
      readonly state: "error";
      readonly message: string;
    };

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The request failed.";
}

export function AtlasBulkActionDialog({
  environmentId,
  initiative,
  action,
  selection,
  onClose,
  onConfigureAutoReview,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: AtlasInitiative;
  readonly action: AtlasBulkAction;
  readonly selection: ReadonlySet<AtlasTaskId>;
  readonly onClose: () => void;
  readonly onConfigureAutoReview: () => void;
}) {
  const publishTaskIssue = useAtomCommand(atlasEnvironment.publishTaskIssue, {
    reportFailure: false,
  });
  const executeTask = useAtomCommand(atlasEnvironment.executeTask, { reportFailure: false });
  const approveTask = useAtomCommand(atlasEnvironment.approveTask, { reportFailure: false });
  const permitted = useAtomValue(
    (action === "publish"
      ? atlasEnvironment.publishTaskIssue
      : action === "run"
        ? atlasEnvironment.executeTask
        : atlasEnvironment.approveTask
    ).permissionAtom(environmentId),
  );
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironmentProviders().get(environmentId) ?? [];

  // The candidate list is frozen when the dialog opens, so polling refreshes
  // never change what the user is confirming.
  const [candidates] = useState(() => bulkCandidates(action, initiative.tasks, selection));
  const [checked, setChecked] = useState<ReadonlySet<AtlasTaskId>>(
    () =>
      new Set(
        candidates.flatMap((candidate) => (candidate.preselected ? [candidate.task.id] : [])),
      ),
  );
  const [outcomes, setOutcomes] = useState<ReadonlyMap<AtlasTaskId, Outcome>>(new Map());
  const [phase, setPhase] = useState<"preview" | "running" | "done">("preview");
  const [options, setOptions] = useState<AtlasRunOptions>(DEFAULT_ATLAS_RUN_OPTIONS);
  const [baseRef, setBaseRef] = useState("HEAD");

  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      initiative.projectId,
    ),
  );
  const resolvedOptions = {
    ...options,
    modelSelection: selectAtlasModel(entries, options.modelSelection),
  };

  const eligible = candidates.filter((candidate) => candidate.skipReason === null);
  const skipped = candidates.filter((candidate) => candidate.skipReason !== null);
  const chosen = eligible.filter((candidate) => checked.has(candidate.task.id));
  const copy = COPY[action];
  const succeeded = [...outcomes.values()].filter((outcome) => outcome.state === "ok").length;
  const failed = [...outcomes.values()].filter((outcome) => outcome.state === "error").length;

  const runOne = async (taskId: AtlasTaskId) => {
    const base = { initiativeId: initiative.id, taskId };
    const result =
      action === "publish"
        ? await publishTaskIssue({ environmentId, input: base })
        : action === "approve"
          ? await approveTask({ environmentId, input: base })
          : await executeTask({
              environmentId,
              input: {
                ...base,
                modelSelection: resolvedOptions.modelSelection!,
                runtimeMode: resolvedOptions.runtimeMode,
                interactionMode: resolvedOptions.interactionMode,
                workspaceStrategy: {
                  type: "worktree",
                  baseRef: baseRef.trim(),
                  startFromOrigin: false,
                },
              },
            });
    if (result._tag === "Failure") {
      throw isAtomCommandInterrupted(result)
        ? new Error("Interrupted")
        : squashAtomCommandFailure(result);
    }
  };

  const start = async () => {
    const ids = chosen.map((candidate) => candidate.task.id);
    setOutcomes(new Map(ids.map((id) => [id, { state: "pending" }])));
    setPhase("running");
    await runBounded(ids, BULK_CONCURRENCY, runOne, (id, result) => {
      setOutcomes((previous) =>
        new Map(previous).set(
          id,
          result.ok ? { state: "ok" } : { state: "error", message: failureMessage(result.error) },
        ),
      );
    });
    setPhase("done");
  };

  const toggle = (id: AtlasTaskId, next: boolean) =>
    setChecked((previous) => {
      const updated = new Set(previous);
      if (next) updated.add(id);
      else updated.delete(id);
      return updated;
    });

  const confirmDisabled =
    !permitted ||
    chosen.length === 0 ||
    (action === "run" && (resolvedOptions.modelSelection === null || baseRef.trim().length === 0));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // A batch in flight keeps the dialog so its results stay visible.
        if (!open && phase !== "running") onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {copy.description}{" "}
            {selection.size > 0
              ? `${eligible.length} of ${selection.size} selected tasks qualify.`
              : `${eligible.length} of ${initiative.tasks.length} tasks qualify.`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4">
            {action === "run" && phase === "preview" ? (
              <div className="flex flex-col gap-3">
                <AtlasRunOptionsFields
                  environmentId={environmentId}
                  projectId={initiative.projectId}
                  value={resolvedOptions}
                  onChange={setOptions}
                />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="atlas-bulk-base">Committed base branch or revision</Label>
                  <Input
                    id="atlas-bulk-base"
                    value={baseRef}
                    onChange={(event) => setBaseRef(event.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    Every worktree starts from this committed revision, not from uncommitted edits
                    or other tasks&apos; worktrees. Integrate approved dependency changes into the
                    base first.
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md bg-muted/48 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">{autoReviewLabel(initiative)}</span>
                  <Button size="xs" variant="ghost" onClick={onConfigureAutoReview}>
                    Configure
                  </Button>
                </div>
              </div>
            ) : null}

            {eligible.length > 0 ? (
              <ul className="flex flex-col divide-y rounded-md border text-sm">
                {eligible.map(({ task, note }) => {
                  const outcome = outcomes.get(task.id);
                  return (
                    <li key={task.id} className="flex items-start gap-2.5 px-3 py-2">
                      {phase === "preview" ? (
                        <Checkbox
                          aria-label={`Include ${task.title}`}
                          checked={checked.has(task.id)}
                          onCheckedChange={(next) => toggle(task.id, next === true)}
                        />
                      ) : outcome?.state === "ok" ? (
                        <CheckCircle2Icon className="size-4 shrink-0 text-success" />
                      ) : outcome?.state === "error" ? (
                        <CircleAlertIcon className="size-4 shrink-0 text-destructive" />
                      ) : outcome?.state === "pending" ? (
                        <LoaderIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <span className="size-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="text-muted-foreground tabular-nums">
                          #{task.ordinal + 1}
                        </span>{" "}
                        {task.title}
                        {note ? (
                          <span className="block text-muted-foreground text-xs">{note}</span>
                        ) : null}
                        {outcome?.state === "error" ? (
                          <span className="block text-destructive-foreground text-xs">
                            {outcome.message}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No tasks qualify right now.</p>
            )}

            {skipped.length > 0 && phase === "preview" ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  {skipped.length} skipped
                </summary>
                <ul className="mt-2 flex flex-col gap-1 text-xs">
                  {skipped.map(({ task, skipReason }) => (
                    <li key={task.id} className="flex gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        #{task.ordinal + 1} {task.title}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{skipReason}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {phase !== "preview" ? (
              <p className="text-sm" aria-live="polite">
                {succeeded} succeeded
                {failed > 0 ? `, ${failed} failed` : ""}
                {phase === "running" ? ". Working…" : "."}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          {phase === "preview" ? (
            <>
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
              <Button disabled={confirmDisabled} onClick={() => void start()}>
                {copy.confirm(chosen.length)}
              </Button>
            </>
          ) : (
            <Button disabled={phase === "running"} onClick={onClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
