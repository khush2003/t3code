import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useEnvironmentProviders } from "../../state/environments";
import { Button } from "../ui/button";
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
import {
  AtlasRunOptionsFields,
  DEFAULT_ATLAS_RUN_OPTIONS,
  selectAtlasModel,
  type AtlasRunOptions,
} from "./AtlasRunOptionsFields";

/**
 * Shared launch dialog for the planner, task execution, and agent review. It
 * resolves a default provider model from the environment's live providers so a
 * run never launches with an empty selection.
 */
export function AtlasRunOptionsDialog({
  open,
  onOpenChange,
  environmentId,
  projectId,
  title,
  description,
  confirmLabel,
  confirmDisabled = false,
  children,
  onConfirm,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly confirmDisabled?: boolean;
  readonly children?: ReactNode;
  readonly onConfirm: (options: AtlasRunOptions) => void;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironmentProviders().get(environmentId) ?? [];
  const [value, setValue] = useState<AtlasRunOptions>(DEFAULT_ATLAS_RUN_OPTIONS);
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings, projectId),
  );
  // Resolved during render so an open dialog never launches with an empty
  // selection, without an effect writing state back on mount.
  const resolvedValue: AtlasRunOptions = {
    ...value,
    modelSelection: value.modelSelection ?? selectAtlasModel(entries, null),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <AtlasRunOptionsFields
            environmentId={environmentId}
            projectId={projectId}
            value={resolvedValue}
            onChange={setValue}
            disabled={confirmDisabled}
          />
          {children}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={confirmDisabled || resolvedValue.modelSelection === null}
            onClick={() => onConfirm(resolvedValue)}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
