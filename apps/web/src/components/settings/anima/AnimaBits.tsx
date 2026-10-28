import { type ReactNode } from "react";
import type { AnimaTrait } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommand,
} from "@t3tools/client-runtime/state/runtime";

import { cn } from "../../../lib/utils";
import { formatRelativeTimeLabel } from "../../../timestampFormat";
import { describeAnimaError } from "../../../state/anima";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Badge } from "../../ui/badge";
import { Label } from "../../ui/label";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import { safeAnimaAccent, traitPercent } from "../animaSettings.logic";

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
        <li key={trait.name} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-2">
          <span className="truncate text-xs text-foreground/80">{trait.name}</span>
          <span
            role="progressbar"
            aria-label={trait.name}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={traitPercent(trait)}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <span
              className="block h-full rounded-full bg-primary/70"
              style={{ width: `${traitPercent(trait)}%` }}
            />
          </span>
          <span className="text-right text-2xs tabular-nums text-muted-foreground">
            {traitPercent(trait)}%
          </span>
        </li>
      ))}
    </ul>
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
