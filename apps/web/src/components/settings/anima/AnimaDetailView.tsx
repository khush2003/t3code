import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import type { AnimaName, EnvironmentId } from "@t3tools/contracts";

import { animaEnvironment } from "../../../state/anima";
import { useEnvironmentQuery } from "../../../state/query";
import { Button } from "../../ui/button";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { SettingsGroup } from "../SettingsGroup";
import { ANIMA_TABS, ANIMA_TAB_LABELS, type AnimaTab, isAnimaTab } from "../animaSettings.logic";
import { AnimaLiveDot, AnimaRoleBadge } from "./AnimaBits";
import { AnimaSigil } from "./AnimaVisuals";
import { SyncTab } from "./AnimaSyncTab";
import {
  ActivityTab,
  BreathsTab,
  IdentityTab,
  OverviewTab,
  PolicyTab,
  ThreadsTab,
} from "./AnimaTabs";

export function AnimaDetailView({
  environmentId,
  name,
  tab,
  onTab,
  onBack,
}: {
  readonly environmentId: EnvironmentId;
  readonly name: AnimaName;
  readonly tab: AnimaTab;
  readonly onTab: (tab: AnimaTab) => void;
  readonly onBack: () => void;
}) {
  // Detail defaults to the newest breaths; the full history is fetched only when asked for.
  const [allBreaths, setAllBreaths] = useState(false);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const query = useEnvironmentQuery(
    animaEnvironment.detail({
      environmentId,
      input: allBreaths ? { name, breathLimit: 0 } : { name },
    }),
  );
  const detail = query.data;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-3 sm:px-4">
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Back to all animas"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        {detail ? (
          <>
            <AnimaSigil anima={detail.summary} size={24} />
            <h2 className="truncate text-sm font-medium">{detail.summary.name}</h2>
            <AnimaRoleBadge role={detail.summary.role} />
            <AnimaLiveDot live={detail.summary.live} />
          </>
        ) : (
          <h2 className="truncate text-sm font-medium">{name}</h2>
        )}
      </div>
      <div className="overflow-x-auto px-3 sm:px-4">
        <ToggleGroup
          aria-label="Anima sections"
          variant="segmented"
          value={[tab]}
          onValueChange={(next) => {
            const value = next[0];
            if (isAnimaTab(value)) onTab(value);
          }}
        >
          {ANIMA_TABS.map((entry) => (
            <Toggle key={entry} value={entry}>
              {ANIMA_TAB_LABELS[entry]}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      <SettingsGroup>
        {detail ? (
          tab === "overview" ? (
            <OverviewTab
              environmentId={environmentId}
              detail={detail}
              onSelectBreath={(index) => {
                setFocusIndex(index);
                onTab("breaths");
              }}
            />
          ) : tab === "identity" ? (
            <IdentityTab environmentId={environmentId} detail={detail} />
          ) : tab === "breaths" ? (
            <BreathsTab
              environmentId={environmentId}
              detail={detail}
              allLoaded={allBreaths}
              onLoadAll={() => setAllBreaths(true)}
              focusIndex={focusIndex}
            />
          ) : tab === "policy" ? (
            <PolicyTab environmentId={environmentId} detail={detail} />
          ) : tab === "activity" ? (
            <ActivityTab environmentId={environmentId} detail={detail} />
          ) : tab === "threads" ? (
            <ThreadsTab environmentId={environmentId} detail={detail} />
          ) : (
            <SyncTab environmentId={environmentId} name={name} />
          )
        ) : (
          <p className="px-3 py-4 text-xs text-muted-foreground sm:px-4">
            {query.error ?? (query.isPending ? "Loading..." : "Waiting for the environment.")}
          </p>
        )}
      </SettingsGroup>
    </div>
  );
}
