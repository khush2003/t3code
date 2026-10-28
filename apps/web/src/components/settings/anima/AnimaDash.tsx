import { ArrowLeftIcon, WindIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { AnimaDetail, AnimaSummary, EnvironmentId } from "@t3tools/contracts";

import { animaEnvironment } from "../../../state/anima";
import { Button } from "../../ui/button";
import { Skeleton } from "../../ui/skeleton";
import { Switch } from "../../ui/switch";
import { ANIMA_HEALTH_LABELS, animaHealthBucket } from "../animaSettings.logic";
import { AnimaLiveDot, AnimaRoleBadge, RelativeTime, useAnimaMutation } from "./AnimaBits";
import { AnimaHealthRing } from "./AnimaHealth";
import { AnimaTeamChip } from "./AnimaTeam";
import { StartAnimaThreadMenu } from "./StartAnimaThread";
import { AnimaSigil, animaColor } from "./AnimaVisuals";

/** Colour-tinted identity banner with the anima's own actions, above the detail tabs. */
export function AnimaDetailBanner({
  environmentId,
  summary,
  detail,
  onBack,
  onHealth,
  onBreathe,
  onOpenAnima,
}: {
  readonly environmentId: EnvironmentId;
  readonly summary: Pick<AnimaSummary, "name"> & Partial<AnimaSummary>;
  readonly detail: AnimaDetail | null | undefined;
  readonly onBack: () => void;
  readonly onHealth: () => void;
  readonly onBreathe: () => void;
  readonly onOpenAnima: (name: string) => void;
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
    <div className="space-y-2 px-3 sm:px-4">
      <Button size="xs" variant="ghost-muted" onClick={onBack}>
        <ArrowLeftIcon />
        All animas
      </Button>
      <div
        className="relative overflow-hidden rounded-2xl border bg-card p-4 shadow-xs"
        style={style}
      >
        <div className="flex items-center gap-4">
          {full ? (
            <AnimaSigil anima={full} size={88} />
          ) : (
            <Skeleton shape="pill" className="size-[88px] shrink-0" />
          )}
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate text-2xl font-semibold tracking-tight">{summary.name}</h2>
              {full ? <AnimaRoleBadge role={full.role} /> : null}
              {full ? <AnimaLiveDot live={full.live} /> : null}
            </div>
            {full?.aim ? (
              <p className="line-clamp-2 text-base leading-snug text-foreground/85">{full.aim}</p>
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
                {full.projects.length > 0 ? (
                  <span>
                    {full.projects.length} {full.projects.length === 1 ? "project" : "projects"}
                  </span>
                ) : null}
                {full.inboxCount > 0 ? <span>{full.inboxCount} unread</span> : null}
                {detail ? <AnimaTeamChip detail={detail} onOpenAnima={onOpenAnima} /> : null}
              </div>
            ) : (
              <Skeleton className="h-3 w-48" />
            )}
          </div>
          {full ? (
            <button
              type="button"
              className="flex shrink-0 flex-col items-center gap-1 rounded-lg p-1 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-label={`Health: ${ANIMA_HEALTH_LABELS[animaHealthBucket(full.health)]}. Open health details`}
              onClick={onHealth}
            >
              <AnimaHealthRing score={full.health} size={48} showValue />
              <span className="text-2xs text-muted-foreground">
                {ANIMA_HEALTH_LABELS[animaHealthBucket(full.health)]}
              </span>
            </button>
          ) : null}
        </div>
        {full ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
            <StartAnimaThreadMenu
              environmentId={environmentId}
              animaName={full.name}
              label="Start a thread"
              variant="outline"
            />
            {detail && detail.threadIds.length > 0 ? (
              <Button size="sm" variant="outline" onClick={onBreathe}>
                <WindIcon />
                Breathe
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                <WindIcon className="size-3" />
                Start a thread to breathe
              </span>
            )}
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
