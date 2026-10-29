import { createContext, use, type ReactNode } from "react";
import type { AnimaTrait } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommand,
} from "@t3tools/client-runtime/state/runtime";

import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { describeAnimaError } from "../../state/anima";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Label } from "../ui/label";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { safeAnimaAccent, traitPercent } from "./anima.logic";

export interface AnimaSoulTone {
  readonly core: string;
  readonly deep: string;
  readonly glow: string;
  readonly haze: string;
}

/** The open anima's soul colours, so every tab can light itself the way the portrait does. */
export const AnimaSoulContext = createContext<AnimaSoulTone | null>(null);

export function useAnimaSoul(): AnimaSoulTone | null {
  return use(AnimaSoulContext);
}

/** Static on purpose: a pulsing live indicator repaints continuously. */
export function AnimaAccentDot({
  accent,
  live = false,
  className,
}: {
  readonly accent: string | null;
  readonly live?: boolean;
  readonly className?: string;
}) {
  const color = safeAnimaAccent(accent);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full bg-muted-foreground/40",
        live && "ring-2 ring-success/50",
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

export function AnimaLiveDot({ live }: { readonly live: boolean }) {
  return (
    <span
      role="img"
      aria-label={live ? "Live" : "Idle"}
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        live ? "bg-success" : "bg-muted-foreground/30",
      )}
    />
  );
}

export function AnimaRoleBadge({ role }: { readonly role: string }) {
  return (
    <Badge size="sm" variant="secondary">
      {role}
    </Badge>
  );
}

export function RelativeTime({ value }: { readonly value: string | null }) {
  if (value === null) return <span className="text-muted-foreground">never</span>;
  const label = formatRelativeTimeLabel(value);
  return <time dateTime={value}>{label || value}</time>;
}

export function TraitBars({
  traits,
  empty,
}: {
  readonly traits: ReadonlyArray<AnimaTrait>;
  readonly empty: string;
}) {
  const soul = useAnimaSoul();
  if (traits.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2">
      {traits.map((trait) => {
        const mean = Math.min(1, Math.max(0, trait.mean));
        const sigma = trait.sigma ?? 0;
        return (
          <li
            key={trait.name}
            className="grid grid-cols-[minmax(0,8rem)_1fr_4.5rem] items-center gap-2.5"
          >
            <span className="truncate text-xs text-foreground/85">{trait.name}</span>
            <span
              role="progressbar"
              aria-label={trait.name}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(mean * 100)}
              className="relative block h-1.5 rounded-full bg-muted"
            >
              {sigma > 0 ? (
                <span
                  aria-hidden
                  className="absolute inset-y-0 rounded-full opacity-25"
                  style={{
                    left: `${Math.max(0, mean - sigma) * 100}%`,
                    right: `${(1 - Math.min(1, mean + sigma)) * 100}%`,
                    backgroundColor: soul?.core ?? "var(--primary)",
                  }}
                />
              ) : null}
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${mean * 100}%`,
                  backgroundColor: soul?.core ?? "var(--primary)",
                  opacity: 0.85,
                }}
              />
            </span>
            <span className="text-right text-2xs tabular-nums text-muted-foreground">
              {trait.negStreak ? (
                <span
                  className="mr-1 text-warning-foreground"
                  aria-label={`${trait.negStreak} negative updates in a row`}
                >
                  ↓{trait.negStreak}
                </span>
              ) : null}
              {traitPercent(trait)}%
              {trait.sigma !== null ? (
                <span className="text-muted-foreground/60"> ±{Math.round(trait.sigma * 100)}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Section heading used across the anima tabs, lit in the anima's soul colour; `action` sits on the right. */
export function AnimaBlock({
  title,
  count,
  action,
  children,
  className,
}: {
  readonly title: string;
  readonly count?: number | undefined;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const soul = useAnimaSoul();
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3
          className="flex items-center gap-2 text-xs font-semibold tracking-widest uppercase"
          style={soul ? { color: soul.core } : undefined}
        >
          {title}
          {count !== undefined ? (
            <span className="rounded-full bg-muted px-1.5 text-2xs font-medium tracking-normal tabular-nums text-muted-foreground">
              {count}
            </span>
          ) : null}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The heading every detail tab opens with: a soul-coloured eyebrow, a sentence, and actions. */
export function PageHeading({
  eyebrow,
  title,
  children,
}: {
  readonly eyebrow: string;
  readonly title: ReactNode;
  readonly children?: ReactNode;
}) {
  const soul = useAnimaSoul();
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1.5">
        <p
          className="text-xs font-semibold tracking-widest uppercase"
          style={soul ? { color: soul.core } : undefined}
        >
          {eyebrow}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-balance">{title}</h2>
      </div>
      {children}
    </header>
  );
}

const STAT_TONES = {
  default: "text-foreground",
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  destructive: "text-destructive-foreground",
} as const;

export function AnimaStat({
  label,
  value,
  tone = "default",
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: keyof typeof STAT_TONES;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <div
        className={cn(
          "truncate text-3xl font-semibold tracking-tight tabular-nums leading-none",
          STAT_TONES[tone],
        )}
      >
        {value}
      </div>
      <div className="truncate text-2xs font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </div>
    </div>
  );
}

/** Inline empty state for a section inside a tab; whole-tab empties use `Empty`. */
export function AnimaEmptyNote({
  icon,
  title,
  children,
  action,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  const soul = useAnimaSoul();
  return (
    <div
      className="flex items-start gap-3 rounded-2xl px-4 py-4 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground"
      style={{ backgroundColor: soul?.haze ?? "var(--muted)" }}
    >
      {icon}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        {children ? <p className="text-xs text-muted-foreground">{children}</p> : null}
      </div>
      {action}
    </div>
  );
}

const METER_TONES = {
  primary: "bg-primary/70",
  success: "bg-success/70",
  warning: "bg-warning/80",
  destructive: "bg-destructive/80",
  muted: "bg-muted-foreground/40",
} as const;

export type MeterTone = keyof typeof METER_TONES;

export function Meter({
  value,
  label,
  tone = "primary",
}: {
  /** 0..1 */
  readonly value: number;
  readonly label: string;
  readonly tone?: MeterTone;
}) {
  const soul = useAnimaSoul();
  const percent = Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 100);
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="block h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <span
        className={cn("block h-full rounded-full", METER_TONES[tone])}
        style={{
          width: `${percent}%`,
          ...(tone === "primary" && soul ? { backgroundColor: soul.core } : {}),
        }}
      />
    </span>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly htmlFor?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-baseline justify-between" htmlFor={htmlFor}>
        <span>{label}</span>
        {hint ? (
          <span className="font-normal text-2xs text-muted-foreground/80">{hint}</span>
        ) : null}
      </Label>
      {children}
    </div>
  );
}

/** Runs an anima command and toasts its outcome; resolves true on success. */
export function useAnimaMutation<W, A, E>(
  command: AtomCommand<W, A, E>,
  options: {
    readonly failureTitle: string;
    readonly successTitle?: string;
    /** When set, the failure message goes here verbatim instead of into a toast. */
    readonly onFailure?: (message: string) => void;
  },
) {
  const run = useAtomCommand(command, { reportFailure: false });
  return async (input: W): Promise<A | null> => {
    const result = await run(input);
    if (result._tag === "Success") {
      if (options.successTitle !== undefined) {
        toastManager.add(stackedThreadToast({ type: "success", title: options.successTitle }));
      }
      return result.value;
    }
    if (!isAtomCommandInterrupted(result)) {
      if (options.onFailure) {
        options.onFailure(describeAnimaError(squashAtomCommandFailure(result)));
        return null;
      }
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: options.failureTitle,
          description: describeAnimaError(squashAtomCommandFailure(result)),
        }),
      );
    }
    return null;
  };
}
