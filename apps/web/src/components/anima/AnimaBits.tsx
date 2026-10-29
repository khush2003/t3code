import { type ReactNode } from "react";
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
  if (traits.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {traits.map((trait) => (
        <li
          key={trait.name}
          className="grid grid-cols-[minmax(0,8rem)_1fr_2.5rem] items-center gap-2"
        >
          <span className="truncate text-xs text-foreground/80">{trait.name}</span>
          <Meter value={trait.mean} label={trait.name} />
          <span className="text-right text-2xs tabular-nums text-muted-foreground">
            {traitPercent(trait)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Section heading used across the anima tabs; `action` sits on the right. */
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
  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground/80">
          {title}
          {count !== undefined ? (
            <span className="tabular-nums text-muted-foreground/70">{count}</span>
          ) : null}
        </h3>
        {action}
      </div>
      {children}
    </section>
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
    <div className="min-w-0 rounded-xl border border-border/60 bg-card/60 px-3 py-2">
      <div
        className={cn(
          "truncate text-lg font-semibold tabular-nums leading-tight",
          STAT_TONES[tone],
        )}
      >
        {value}
      </div>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
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
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-border/70 px-3 py-3 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
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
        style={{ width: `${percent}%` }}
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
