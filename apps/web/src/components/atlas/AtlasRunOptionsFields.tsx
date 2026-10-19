import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type EnvironmentId,
  type ModelSelection,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  type ProjectId,
  ProviderInstanceId,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";

import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentProviders } from "../../state/environments";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";

export interface AtlasRunOptions {
  readonly modelSelection: ModelSelection | null;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly workspaceStrategy?: OrchestrationV2ThreadLaunchWorkspaceStrategy | undefined;
}

export const DEFAULT_ATLAS_RUN_OPTIONS: AtlasRunOptions = {
  modelSelection: null,
  runtimeMode: DEFAULT_RUNTIME_MODE,
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
};

const RUNTIME_MODE_OPTIONS: ReadonlyArray<{ value: RuntimeMode; label: string }> = [
  { value: "full-access", label: "Full access" },
  { value: "auto", label: "Auto" },
  { value: "auto-accept-edits", label: "Auto-accept edits" },
  { value: "approval-required", label: "Approval required" },
];

const INTERACTION_MODE_OPTIONS: ReadonlyArray<{
  value: ProviderInteractionMode;
  label: string;
}> = [
  { value: "default", label: "Default" },
  { value: "plan", label: "Plan mode" },
];

export function selectAtlasModel(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  preferred: ModelSelection | null,
): ModelSelection | null {
  const usable = entries.filter(
    (entry) =>
      entry.enabled &&
      entry.installed &&
      entry.isAvailable &&
      entry.snapshot.auth.status !== "unauthenticated",
  );
  if (preferred) {
    const entry = usable.find((candidate) => candidate.instanceId === preferred.instanceId);
    const model = entry?.models.find((candidate) => candidate.slug === preferred.model);
    if (entry && model && model.isLegacy !== true) return preferred;
  }
  for (const entry of usable) {
    const model = entry.models.find((candidate) => !candidate.isLegacy) ?? entry.models[0];
    if (model) return { instanceId: entry.instanceId, model: model.slug };
  }
  return null;
}

/**
 * The provider/model, runtime, and interaction choices shared by the planner,
 * task execution, and agent review dialogs. A caller that needs the default
 * selection resolved should read it through `selectAtlasModel`.
 */
export function AtlasRunOptionsFields({
  environmentId,
  projectId,
  value,
  onChange,
  disabled = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly value: AtlasRunOptions;
  readonly onChange: (next: AtlasRunOptions) => void;
  readonly disabled?: boolean;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironmentProviders().get(environmentId) ?? [];
  // Project overrides can disable a provider, so the entries must resolve
  // enablement against the initiative's project rather than the environment.
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings, projectId),
  );
  const selection = value.modelSelection;
  const activeInstanceId =
    selection?.instanceId ?? entries[0]?.instanceId ?? ProviderInstanceId.make("");
  const activeModel = selection?.model ?? "";
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    activeInstanceId,
    activeModel,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Model</Label>
        <ProviderModelPicker
          environmentId={environmentId}
          disabled={disabled}
          activeInstanceId={activeInstanceId}
          model={activeModel}
          lockedProvider={null}
          instanceEntries={entries}
          modelOptionsByInstance={modelOptionsByInstance}
          isComposerOwned={false}
          onInstanceModelChange={(instanceId, model) =>
            onChange({ ...value, modelSelection: { instanceId, model } })
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Runtime</Label>
          <Select
            value={value.runtimeMode}
            disabled={disabled}
            onValueChange={(next) => onChange({ ...value, runtimeMode: next as RuntimeMode })}
            items={RUNTIME_MODE_OPTIONS}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {RUNTIME_MODE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Interaction</Label>
          <Select
            value={value.interactionMode}
            disabled={disabled}
            onValueChange={(next) =>
              onChange({ ...value, interactionMode: next as ProviderInteractionMode })
            }
            items={INTERACTION_MODE_OPTIONS}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {INTERACTION_MODE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </div>
    </div>
  );
}
