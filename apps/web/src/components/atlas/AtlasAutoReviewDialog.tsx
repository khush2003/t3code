import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiative, EnvironmentId } from "@t3tools/contracts";
import { ShieldCheckIcon } from "lucide-react";
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
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  AtlasRunOptionsFields,
  DEFAULT_ATLAS_RUN_OPTIONS,
  selectAtlasModel,
  type AtlasRunOptions,
} from "./AtlasRunOptionsFields";

export function autoReviewLabel(initiative: AtlasInitiative): string {
  const policy = initiative.autoReview;
  if (!policy?.enabled) return "Auto review off";
  return policy.autoApplyVerdict
    ? `Auto review on · ${policy.modelSelection.model} · applies verdict`
    : `Auto review on · ${policy.modelSelection.model}`;
}

/**
 * Per-initiative policy: when a task's run completes, the server starts a
 * reviewer in that run's workspace. Applying the verdict is a separate,
 * explicit opt-in.
 */
export function AtlasAutoReviewDialog({
  environmentId,
  initiative,
  open,
  onOpenChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: AtlasInitiative;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const policy = initiative.autoReview;
  const updateInitiative = useAtomCommand(atlasEnvironment.updateInitiative, {
    reportFailure: false,
  });
  const canUpdate = useAtomValue(atlasEnvironment.updateInitiative.permissionAtom(environmentId));
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironmentProviders().get(environmentId) ?? [];
  const [enabled, setEnabled] = useState(policy?.enabled ?? true);
  const [autoApplyVerdict, setAutoApplyVerdict] = useState(policy?.autoApplyVerdict ?? false);
  const [options, setOptions] = useState<AtlasRunOptions>(
    policy
      ? {
          modelSelection: policy.modelSelection,
          runtimeMode: policy.runtimeMode,
          interactionMode: policy.interactionMode,
        }
      : DEFAULT_ATLAS_RUN_OPTIONS,
  );
  const [saving, setSaving] = useState(false);
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      initiative.projectId,
    ),
  );
  const modelSelection = selectAtlasModel(entries, options.modelSelection);
  const resolved = { ...options, modelSelection };

  const save = async () => {
    setSaving(true);
    const result = await updateInitiative({
      environmentId,
      input: {
        initiativeId: initiative.id,
        autoReview:
          modelSelection === null
            ? null
            : {
                enabled,
                modelSelection,
                runtimeMode: options.runtimeMode,
                interactionMode: options.interactionMode,
                autoApplyVerdict: enabled && autoApplyVerdict,
              },
      },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not save auto review",
            description: error instanceof Error ? error.message : "The request failed.",
          }),
        );
      }
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Auto review</DialogTitle>
          <DialogDescription>
            When a task&apos;s run finishes, a reviewer agent checks it against the acceptance
            criteria in that run&apos;s workspace, even while Atlas is closed. Completed tasks that
            have not been reviewed yet are picked up too.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-4">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <ShieldCheckIcon className="size-4 text-muted-foreground" />
                Review each task when its run completes
              </span>
              <Switch
                checked={enabled}
                onCheckedChange={(checked) => setEnabled(checked)}
                aria-label="Enable auto review"
              />
            </label>
            <AtlasRunOptionsFields
              environmentId={environmentId}
              projectId={initiative.projectId}
              value={resolved}
              onChange={setOptions}
              disabled={!enabled}
            />
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                aria-label="Apply the reviewer's verdict automatically"
                checked={enabled && autoApplyVerdict}
                disabled={!enabled}
                onCheckedChange={(checked) => setAutoApplyVerdict(checked === true)}
              />
              <span>
                Apply the reviewer&apos;s verdict automatically
                <span className="block text-muted-foreground text-xs">
                  Approving unblocks dependent tasks without waiting for you. Off by default; a
                  failed or unreadable review never approves, and you can change any decision
                  afterward.
                </span>
              </span>
            </label>
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={!canUpdate || saving || (enabled && modelSelection === null)}
            onClick={() => void save()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
