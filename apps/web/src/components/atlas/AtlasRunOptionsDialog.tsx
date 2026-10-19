import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useEnvironmentProviders } from "../../state/environments";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
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
  workspaceChoice = false,
  reuseWorkspace = false,
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
  readonly workspaceChoice?: boolean;
  readonly reuseWorkspace?: boolean;
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
          {workspaceChoice ? (
            <div className="mt-4 space-y-2">
              <Label>Workspace</Label>
              <Select
                value={value.workspaceStrategy?.type === "worktree" ? "worktree" : "default"}
                onValueChange={(next) =>
                  setValue((previous) => ({
                    ...previous,
                    workspaceStrategy:
                      next === "worktree"
                        ? { type: "worktree", baseRef: "HEAD", startFromOrigin: false }
                        : undefined,
                  }))
                }
                items={[
                  {
                    value: "default",
                    label: reuseWorkspace ? "Reuse previous workspace" : "Project checkout",
                  },
                  { value: "worktree", label: "New worktree · parallel execution" },
                ]}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="default">
                    {reuseWorkspace ? "Reuse previous workspace" : "Project checkout"}
                  </SelectItem>
                  <SelectItem value="worktree">New worktree · parallel execution</SelectItem>
                </SelectPopup>
              </Select>
              {value.workspaceStrategy?.type === "worktree" ? (
                <>
                  <Label htmlFor="atlas-worktree-base">Committed base branch or revision</Label>
                  <Input
                    id="atlas-worktree-base"
                    value={value.workspaceStrategy.baseRef ?? "HEAD"}
                    onChange={(event) =>
                      setValue((previous) => ({
                        ...previous,
                        workspaceStrategy: {
                          type: "worktree",
                          baseRef: event.target.value,
                          startFromOrigin: false,
                        },
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Runs independently alongside other workspaces. Starts from committed code;
                    integrate dependency changes into the base first.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {reuseWorkspace
                    ? "Continues in the previous execution workspace, including its existing changes."
                    : "Uses current project files. Tasks sharing this checkout run one at a time."}
                </p>
              )}
            </div>
          ) : null}
          {children}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={
              confirmDisabled ||
              resolvedValue.modelSelection === null ||
              (workspaceChoice &&
                value.workspaceStrategy?.type === "worktree" &&
                value.workspaceStrategy.baseRef?.trim().length === 0)
            }
            onClick={() => onConfirm(resolvedValue)}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
