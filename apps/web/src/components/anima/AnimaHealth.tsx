import {
  CircleAlertIcon,
  CircleXIcon,
  HeartPulseIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type {
  AnimaAuditFinding,
  AnimaHealthResult,
  AnimaName,
  EnvironmentId,
} from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { animaEnvironment } from "../../state/anima";
import { useEnvironmentQuery } from "../../state/query";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import {
  ANIMA_HEALTH_LABELS,
  type AnimaHealthBucket,
  animaHealthBucket,
  animaWellness,
  groupAuditFindings,
  keyedLines,
} from "./anima.logic";
import { AnimaBlock, AnimaEmptyNote, Meter, type MeterTone } from "./AnimaBits";

const RING_TONES: Readonly<Record<AnimaHealthBucket, string>> = {
  unknown: "text-muted-foreground/40",
  steady: "text-success",
  watch: "text-warning",
  tend: "text-destructive",
};

const BADGE_VARIANTS = {
  unknown: "outline",
  steady: "success",
  watch: "warning",
  tend: "error",
} as const satisfies Readonly<Record<AnimaHealthBucket, string>>;

const METER_TONES: Readonly<Record<AnimaHealthBucket, MeterTone>> = {
  unknown: "muted",
  steady: "success",
  watch: "warning",
  tend: "destructive",
};

const RADIUS = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Fuller and greener is healthier; the CLI's own score rises with need, so the ring inverts it. */
export function AnimaHealthRing({
  score,
  size = 22,
  showValue = false,
  className,
}: {
  readonly score: number | null | undefined;
  readonly size?: number;
  readonly showValue?: boolean;
  readonly className?: string;
}) {
  const bucket = animaHealthBucket(score);
  const wellness = animaWellness(score);
  const label = `Health: ${ANIMA_HEALTH_LABELS[bucket]}${wellness === null ? "" : `, ${wellness}%`}`;
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 36 36" width={size} height={size} className={RING_TONES[bucket]}>
        <circle
          cx={18}
          cy={18}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.18}
          strokeWidth={4}
        />
        {wellness !== null && wellness > 0 ? (
          <circle
            cx={18}
            cy={18}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={`${(wellness / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            transform="rotate(-90 18 18)"
          />
        ) : null}
      </svg>
      {showValue ? (
        <span className="absolute inset-0 flex items-center justify-center text-2xs font-semibold tabular-nums text-foreground">
          {wellness ?? "–"}
        </span>
      ) : null}
    </span>
  );
}

export function AnimaHealthBadge({ score }: { readonly score: number | null | undefined }) {
  const bucket = animaHealthBucket(score);
  return (
    <Badge size="sm" variant={BADGE_VARIANTS[bucket]}>
      {ANIMA_HEALTH_LABELS[bucket]}
    </Badge>
  );
}

const ACTION_COPY = {
  none: "Nothing to tend right now.",
  internal: "The CLI would tend this anima on its own at the next wake.",
  proactive: "The CLI would reach out proactively: this anima needs attention.",
} as const;

const CIRCUIT_COPY = {
  closed: { label: "Circuit closed", variant: "success", detail: "Automation runs normally." },
  "half-open": {
    label: "Circuit half-open",
    variant: "warning",
    detail: "Automation is probing after recent failures.",
  },
  open: {
    label: "Circuit open",
    variant: "error",
    detail: "Automation is paused after repeated failures.",
  },
} as const;

const COMPONENT_LABELS = {
  uncertainty: "Uncertainty",
  negStreak: "Negative streak",
  staleTension: "Stale tension",
  drift: "Colour drift",
  silence: "Silence",
} as const;

type HealthComponent = keyof typeof COMPONENT_LABELS;

function componentDetail(
  key: HealthComponent,
  health: NonNullable<AnimaHealthResult["health"]>,
): string {
  switch (key) {
    case "uncertainty":
      return `max σ ${health.maxSigma.toFixed(2)}`;
    case "negStreak":
      return `${health.maxNegStreak} in a row`;
    case "staleTension":
      return `${health.maxTensionAge} breaths old`;
    case "drift":
      return `Δ ${health.colorDrift.toFixed(2)}`;
    case "silence":
      return health.silenceHours < 48
        ? `${Math.round(health.silenceHours)}h quiet`
        : `${Math.round(health.silenceHours / 24)}d quiet`;
  }
}

const AUDIT_STYLE = {
  error: { label: "Errors", icon: CircleXIcon, tone: "text-destructive" },
  warn: { label: "Warnings", icon: TriangleAlertIcon, tone: "text-warning" },
  info: { label: "Notes", icon: InfoIcon, tone: "text-info" },
} as const satisfies Readonly<Record<AnimaAuditFinding["level"], unknown>>;

function HealthSkeleton() {
  return (
    <div className="space-y-4 px-3 py-4 sm:px-4">
      <div className="flex items-center gap-4">
        <Skeleton shape="pill" className="size-18" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function HealthTab({
  environmentId,
  name,
}: {
  readonly environmentId: EnvironmentId;
  readonly name: AnimaName;
}) {
  const query = useEnvironmentQuery(animaEnvironment.health({ environmentId, input: { name } }));
  const result = query.data;
  if (!result) {
    return query.error ? (
      <p className="px-3 py-4 text-xs text-destructive sm:px-4">{query.error}</p>
    ) : (
      <HealthSkeleton />
    );
  }
  const { health } = result;
  const circuit = CIRCUIT_COPY[result.circuit];
  const audit = groupAuditFindings(result.audit);
  return (
    <div className="space-y-6 px-3 py-4 sm:px-4">
      <div className="flex flex-wrap items-center gap-4">
        <AnimaHealthRing score={health?.score} size={72} showValue />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">
              {ANIMA_HEALTH_LABELS[animaHealthBucket(health?.score)]}
            </span>
            {health ? (
              <span className="text-2xs tabular-nums text-muted-foreground">
                tending score {health.score.toFixed(2)}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {health ? ACTION_COPY[health.action] : "No breaths to assess yet."}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge size="sm" variant={circuit.variant}>
              {circuit.label}
            </Badge>
            <span className="text-2xs text-muted-foreground">
              {circuit.detail}
              {result.circuitCount > 0
                ? ` Tripped ${result.circuitCount} ${result.circuitCount === 1 ? "time" : "times"}.`
                : ""}
            </span>
          </div>
        </div>
      </div>

      {health ? (
        <AnimaBlock title="What feeds the score">
          <ul className="space-y-2">
            {(Object.keys(COMPONENT_LABELS) as HealthComponent[]).map((key) => {
              const value = health.components[key];
              return (
                <li
                  key={key}
                  className="grid grid-cols-[minmax(0,8rem)_1fr_5.5rem] items-center gap-2"
                >
                  <span className="truncate text-xs text-foreground/80">
                    {COMPONENT_LABELS[key]}
                  </span>
                  <Meter
                    value={value}
                    label={COMPONENT_LABELS[key]}
                    tone={METER_TONES[animaHealthBucket(value)]}
                  />
                  <span className="truncate text-right text-2xs tabular-nums text-muted-foreground">
                    {componentDetail(key, health)}
                  </span>
                </li>
              );
            })}
          </ul>
        </AnimaBlock>
      ) : null}

      {health && (health.reasons.length > 0 || health.warnings.length > 0) ? (
        <AnimaBlock title="Assessment">
          <ul className="space-y-1.5">
            {keyedLines(health.warnings).map(({ key, line }) => (
              <li key={`w:${key}`} className="flex items-start gap-2 text-sm">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
                {line}
              </li>
            ))}
            {keyedLines(health.reasons).map(({ key, line }) => (
              <li key={`r:${key}`} className="flex items-start gap-2 text-sm text-foreground/90">
                <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                {line}
              </li>
            ))}
          </ul>
        </AnimaBlock>
      ) : null}

      <AnimaBlock title="Audit" count={result.audit.length}>
        {audit.length === 0 ? (
          <AnimaEmptyNote icon={<HeartPulseIcon />} title="Data checks out">
            The CLI's integrity audit found nothing.
          </AnimaEmptyNote>
        ) : (
          <div className="space-y-3">
            {audit.map((group) => {
              const style = AUDIT_STYLE[group.level];
              const Icon = style.icon;
              return (
                <div key={group.level} className="space-y-1">
                  <p className={cn("text-xs font-medium", style.tone)}>
                    {style.label} · {group.findings.length}
                  </p>
                  <ul className="space-y-1">
                    {keyedLines(group.findings.map((finding) => finding.message)).map(
                      ({ key, line }) => (
                        <li key={key} className="flex items-start gap-2 text-xs">
                          <Icon className={cn("mt-0.5 size-3.5 shrink-0", style.tone)} />
                          <span className="min-w-0 break-words">{line}</span>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </AnimaBlock>
    </div>
  );
}
