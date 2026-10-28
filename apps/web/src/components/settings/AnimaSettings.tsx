import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import type { AnimaName, EnvironmentId } from "@t3tools/contracts";

import { animaEnvironment, useAnimaList } from "../../state/anima";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useSettingsScope } from "./SettingsScopeContext";
import { AnimaDetailView } from "./anima/AnimaDetailView";
import { AnimaRoster } from "./anima/AnimaRoster";
import { NewAnimaDialog } from "./anima/NewAnimaDialog";
import type { AnimaTab } from "./animaSettings.logic";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

export function AnimaSettings(target: {
  readonly environmentId?: EnvironmentId;
  readonly anima?: string;
  readonly tab?: AnimaTab;
}) {
  const { environment, connectedEnvironments } = useSettingsScope();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const selected =
    connectedEnvironments.find((entry) => entry.environmentId === target.environmentId) ??
    environment ??
    connectedEnvironments[0] ??
    null;
  const environmentId = selected?.environmentId ?? null;
  const canCreate = useAtomValue(animaEnvironment.create.permissionAtom(environmentId));
  const { cliAvailable } = useAnimaList(environmentId);
  const createDisabledReason = !canCreate
    ? "You do not have permission to create animas on this environment."
    : !cliAvailable
      ? "The anima CLI is not installed on this environment."
      : null;

  const open = (anima: string | undefined, tab?: AnimaTab) =>
    void navigate({
      to: "/settings/anima",
      search: {
        ...(environmentId ? { environmentId } : {}),
        ...(anima ? { anima } : {}),
        ...(tab && tab !== "overview" ? { tab } : {}),
      },
    });

  return (
    <SettingsPageContainer>
      <SettingsSection
        title={selected ? `Anima on ${selected.label}` : "Anima"}
        variant="plain"
        headerAction={
          <Tooltip>
            <TooltipTrigger
              render={
                <span>
                  <Button
                    size="sm"
                    disabled={environmentId === null || createDisabledReason !== null}
                    onClick={() => setCreating(true)}
                  >
                    <PlusIcon />
                    New anima
                  </Button>
                </span>
              }
            />
            {createDisabledReason ? <TooltipPopup>{createDisabledReason}</TooltipPopup> : null}
          </Tooltip>
        }
      >
        {environmentId === null ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>No environments available</EmptyTitle>
              <EmptyDescription>Connect an environment to manage animas.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : target.anima ? (
          <AnimaDetailView
            key={`${environmentId}:${target.anima}`}
            environmentId={environmentId}
            name={target.anima as AnimaName}
            tab={target.tab ?? "overview"}
            onTab={(tab) => open(target.anima, tab)}
            onBack={() => open(undefined)}
          />
        ) : (
          <AnimaRoster
            environmentId={environmentId}
            onOpen={(name) => open(name)}
            onCreate={() => setCreating(true)}
            createDisabledReason={createDisabledReason}
          />
        )}
      </SettingsSection>
      {creating && environmentId ? (
        <NewAnimaDialog
          environmentId={environmentId}
          onClose={() => setCreating(false)}
          onCreated={(name) => open(name)}
        />
      ) : null}
    </SettingsPageContainer>
  );
}
