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
import { TraitsPicker } from "../chat/TraitsPicker";

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

/**
 * Picks the run's model: the preferred one when it is still usable, otherwise
 * the first usable model. `avoid` steers that fallback away from a model that
 * just failed, preferring another provider since limits are usually per account.
 */
export function selectAtlasModel(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  preferred: ModelSelection | null,
  avoid: ModelSelection | null = null,
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
  const first = (pool: ReadonlyArray<ProviderInstanceEntry>, skipModel: string | null) => {
    for (const entry of pool) {
      const model =
        entry.models.find((candidate) => !candidate.isLegacy && candidate.slug !== skipModel) ??
        entry.models.find((candidate) => candidate.slug !== skipModel);
      if (model) return { instanceId: entry.instanceId, model: model.slug };
    }
    return null;
  };
  if (avoid) {
    return (
      first(
        usable.filter((entry) => entry.instanceId !== avoid.instanceId),
        null,
      ) ??
      first(
        usable.filter((entry) => entry.instanceId === avoid.instanceId),
        avoid.model,
      ) ??
      first(usable, null)
    );
  }
  return first(usable, null);
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
  modelOnly = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly value: AtlasRunOptions;
  readonly onChange: (next: AtlasRunOptions) => void;
  readonly disabled?: boolean;
  /** Hide runtime and interaction, for actions that keep the thread's own policy. */
  readonly modelOnly?: boolean;
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
  const activeEntry = entries.find((entry) => entry.instanceId === activeInstanceId);
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
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
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
          {selection && activeEntry ? (
            <TraitsPicker
              provider={activeEntry.driverKind}
              instanceId={selection.instanceId}
              models={activeEntry.models}
              model={selection.model}
              prompt=""
              onPromptChange={() => {}}
              modelOptions={selection.options ?? []}
              allowPromptInjectedEffort={false}
              planModeEnabled={settings.planModeEnabled}
              isComposerOwned={false}
              disabled={disabled}
              onModelOptionsChange={(options) =>
                onChange({
                  ...value,
                  modelSelection: {
                    instanceId: selection.instanceId,
                    model: selection.model,
                    ...(options && options.length > 0 ? { options } : {}),
                  },
                })
              }
            />
          ) : null}
        </div>
      </div>
      {modelOnly ? null : (
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
      )}
    </div>
  );
}
