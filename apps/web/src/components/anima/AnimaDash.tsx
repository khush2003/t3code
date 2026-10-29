import { WindIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { AnimaDetail, AnimaSummary, EnvironmentId } from "@t3tools/contracts";

import { animaEnvironment } from "../../state/anima";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { ANIMA_HEALTH_LABELS, animaHealthBucket } from "./anima.logic";
import { AnimaLiveDot, AnimaRoleBadge, RelativeTime, useAnimaMutation } from "./AnimaBits";
import { AnimaHealthRing } from "./AnimaHealth";
import { AnimaTeamChip } from "./AnimaTeam";
import { StartAnimaThreadMenu } from "./StartAnimaThread";
import { CreaturePortrait, LifeStrip, SoulOrb, animaSoulColors } from "./AnimaSoul";

/** Full-width identity hero in the anima's soul colour, above the detail tabs. */
export function AnimaDetailBanner({
  environmentId,
  summary,
  detail,
  onHealth,
  onBreathe,
  onOpenAnima,
  onSelectBreath,
}: {
  readonly environmentId: EnvironmentId;
  readonly summary: Pick<AnimaSummary, "name"> & Partial<AnimaSummary>;
  readonly detail: AnimaDetail | null | undefined;
  readonly onHealth: () => void;
  readonly onBreathe: () => void;
  readonly onOpenAnima: (name: string) => void;
  readonly onSelectBreath: (index: number) => void;
}) {
  const canOperate = useAtomValue(animaEnvironment.setEnabled.permissionAtom(environmentId));
  const setEnabled = useAnimaMutation(animaEnvironment.setEnabled, {
    failureTitle: `Could not update ${summary.name}`,
  });
  const full = detail?.summary;
  const soul = full ? animaSoulColors(full) : null;
  const style: CSSProperties | undefined = soul
    ? {
        backgroundImage: [
          `radial-gradient(70% 120% at 12% 0%, ${soul.glow}, transparent 70%)`,
          `radial-gradient(60% 90% at 95% 10%, ${soul.haze}, transparent 70%)`,
          `linear-gradient(to bottom, transparent 55%, var(--background))`,
        ].join(", "),
      }
    : undefined;
  return (
    <section className="relative border-b border-border/50" style={style}>
      <div className="mx-auto max-w-6xl space-y-6 px-5 pt-8 pb-6 sm:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="relative w-fit shrink-0 pr-6 pb-2">
            {full ? (
              <SoulOrb anima={full} size={120} />
            ) : (
              <Skeleton shape="pill" className="size-30" />
            )}
            {full ? (
              <div className="absolute right-0 bottom-0">
                <CreaturePortrait environmentId={environmentId} anima={full} size={64} />
              </div>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate text-4xl font-semibold tracking-tight">{summary.name}</h2>
              {full ? <AnimaRoleBadge role={full.role} /> : null}
              {full ? <AnimaLiveDot live={full.live} /> : null}
            </div>
            {full?.aim ? (
              <p className="max-w-3xl text-lg leading-snug text-foreground/90">{full.aim}</p>
            ) : full ? (
              <p className="text-lg text-muted-foreground">
                No aim yet. It sets one when it breathes.
              </p>
            ) : (
              <Skeleton className="h-5 w-2/3" />
            )}
            {full?.vow ? (
              <p className="max-w-3xl text-sm text-muted-foreground italic">“{full.vow}”</p>
            ) : null}
            {full ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
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
                  active <RelativeTime value={full.lastActiveAt ?? full.lastBreathAt} />
                </span>
                {full.homeProject ? <span>lives in {full.homeProject}</span> : null}
                {full.inboxCount > 0 ? <span>{full.inboxCount} unread</span> : null}
                {detail ? <AnimaTeamChip detail={detail} onOpenAnima={onOpenAnima} /> : null}
              </div>
            ) : null}
          </div>
          {full ? (
            <button
              type="button"
              className="flex shrink-0 flex-col items-center gap-1 self-start rounded-xl p-2 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:self-center"
              aria-label={`Health: ${ANIMA_HEALTH_LABELS[animaHealthBucket(full.health)]}. Open health details`}
              onClick={onHealth}
            >
              <AnimaHealthRing score={full.health} size={56} showValue />
              <span className="text-2xs text-muted-foreground">
                {ANIMA_HEALTH_LABELS[animaHealthBucket(full.health)]}
              </span>
            </button>
          ) : null}
        </div>
        {full ? (
          <div className="flex flex-wrap items-center gap-2">
            <StartAnimaThreadMenu
              environmentId={environmentId}
              animaName={full.name}
              label="Start a thread"
              variant="default"
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
        {detail && detail.breaths.length > 0 ? (
          <LifeStrip breaths={detail.breaths} onSelect={onSelectBreath} />
        ) : null}
      </div>
    </section>
  );
}
