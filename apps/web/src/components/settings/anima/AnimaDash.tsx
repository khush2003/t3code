import { ArrowLeftIcon, WindIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { AnimaDetail, AnimaSummary, EnvironmentId } from "@t3tools/contracts";

import { animaEnvironment } from "../../../state/anima";
import { Button } from "../../ui/button";
import { Switch } from "../../ui/switch";
import { AnimaLiveDot, AnimaRoleBadge, RelativeTime, useAnimaMutation } from "./AnimaBits";
import { StartAnimaThreadMenu } from "./StartAnimaThread";
import { AnimaSigil, animaColor } from "./AnimaVisuals";

function Stat({
  label,
  value,
  accent,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly accent?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-card/60 px-3 py-2">
      <div
        className={`truncate text-lg font-semibold tabular-nums leading-tight ${accent ? "text-success-foreground" : "text-foreground"}`}
      >
        {value}
      </div>
      <div className="truncate text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

/** Pool-level numbers above the roster. */
export function AnimaPoolStats({ animas }: { readonly animas: ReadonlyArray<AnimaSummary> }) {
  const live = animas.filter((anima) => anima.live).length;
  const breaths = animas.reduce((sum, anima) => sum + anima.breathCount, 0);
  const unread = animas.reduce((sum, anima) => sum + anima.inboxCount, 0);
  return (
    <div className="grid grid-cols-2 gap-2 px-3 sm:grid-cols-4 sm:px-4">
      <Stat label="Animas" value={animas.length} />
      <Stat label="Live now" value={live} accent={live > 0} />
      <Stat label="Breaths" value={breaths} />
      <Stat label="Unread" value={unread} />
    </div>
  );
}

/** Colour-tinted identity banner with the anima's own actions, above the detail tabs. */
export function AnimaDetailBanner({
  environmentId,
  summary,
  detail,
  onBack,
}: {
  readonly environmentId: EnvironmentId;
  readonly summary: Pick<AnimaSummary, "name"> & Partial<AnimaSummary>;
  readonly detail: AnimaDetail | null | undefined;
  readonly onBack: () => void;
}) {
  const canOperate = useAtomValue(animaEnvironment.setEnabled.permissionAtom(environmentId));
  const setEnabled = useAnimaMutation(animaEnvironment.setEnabled, {
    failureTitle: `Could not update ${summary.name}`,
  });
  const full = detail?.summary;
  const color = full ? animaColor(full) : null;
  const style: CSSProperties | undefined = color
    ? {
        backgroundImage: `radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, ${color} 22%, transparent), transparent 62%)`,
        borderColor: `color-mix(in srgb, ${color} 35%, var(--border))`,
      }
    : undefined;
  return (
    <div className="px-3 sm:px-4">
      <div
        className="relative overflow-hidden rounded-2xl border bg-card p-4 shadow-xs"
        style={style}
      >
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Back to all animas"
          className="absolute right-3 top-3"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="flex items-center gap-4">
          {full ? <AnimaSigil anima={full} size={88} /> : <div className="size-[88px]" />}
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-tight">{summary.name}</h2>
              {full ? <AnimaRoleBadge role={full.role} /> : null}
              {full ? <AnimaLiveDot live={full.live} /> : null}
            </div>
            {full?.aim ? (
              <p className="line-clamp-2 text-sm text-muted-foreground">{full.aim}</p>
            ) : null}
            {full ? (
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground tabular-nums">
                    {full.breathCount}
                  </span>{" "}
                  {full.breathCount === 1 ? "breath" : "breaths"}
                </span>
                <span>
                  born <RelativeTime value={full.born} />
                </span>
                <span>
                  active <RelativeTime value={full.lastActiveAt} />
                </span>
                <span>
                  {full.projects.length} {full.projects.length === 1 ? "project" : "projects"}
                </span>
                {full.inboxCount > 0 ? <span>{full.inboxCount} unread</span> : null}
              </div>
            ) : null}
          </div>
        </div>
        {full ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
            <StartAnimaThreadMenu
              environmentId={environmentId}
              animaName={full.name}
              label="Start a thread"
              variant="outline"
            />
            <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
              <WindIcon className="size-3" />
              Breathe from a thread's details menu
            </span>
            <label className="ml-auto flex items-center gap-2 text-xs">
              Enabled
              <Switch
                checked={full.enabled}
                disabled={!canOperate}
                onCheckedChange={(enabled) =>
                  void setEnabled({ environmentId, input: { name: full.name, enabled } })
                }
              />
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}
