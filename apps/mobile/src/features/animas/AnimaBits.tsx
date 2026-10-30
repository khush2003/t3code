import {
  type AtomCommand,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AnimaSummary, AnimaTrait } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Circle, Svg } from "react-native-svg";
import { useResolveClassNames } from "uniwind";

import * as Dialog from "../../components/ui/Dialog";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { describeAnimaError } from "../../state/anima";
import {
  animaColor,
  animaHealthBucket,
  animaWellness,
  traitPercent,
} from "../../state/anima-presentation";
import { useAtomCommand } from "../../state/use-atom-command";

/** The anima's colour as a still orb; the glow is a static shadow, never an animation. */
export function AnimaOrb(props: {
  readonly anima: Pick<AnimaSummary, "hsl" | "accent">;
  readonly size: number;
  readonly live?: boolean;
}) {
  const color = animaColor(props.anima);
  const glow = props.size >= 24;
  return (
    <View
      className={cn(
        "rounded-full",
        color === null && "bg-subtle-strong",
        props.live && "border-2 border-adaptive-emerald-500",
      )}
      style={{
        width: props.size,
        height: props.size,
        ...(color === null
          ? {}
          : {
              backgroundColor: color,
              ...(glow
                ? {
                    shadowColor: color,
                    shadowOpacity: 0.6,
                    shadowRadius: props.size / 3,
                    shadowOffset: { width: 0, height: 0 },
                    elevation: 8,
                  }
                : {}),
            }),
      }}
    />
  );
}

/** Fuller rings are healthier; the CLI's score rises with need. */
export function AnimaHealthRing(props: {
  readonly score: number | null;
  readonly size: number;
  readonly showValue?: boolean;
}) {
  const wellness = animaWellness(props.score);
  const bucket = animaHealthBucket(props.score);
  const stroke = Math.max(3, props.size / 10);
  const radius = (props.size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = useResolveClassNames(
    bucket === "tend"
      ? "text-danger-foreground"
      : bucket === "watch"
        ? "text-warning-foreground"
        : "text-foreground-secondary",
  ).color;
  const track = useResolveClassNames("bg-border").backgroundColor;
  return (
    <View
      accessibilityLabel={wellness === null ? "No health reading" : `${wellness}% healthy`}
      className="items-center justify-center"
      style={{ width: props.size, height: props.size }}
    >
      <Svg width={props.size} height={props.size} accessible={false}>
        <Circle
          cx={props.size / 2}
          cy={props.size / 2}
          r={radius}
          stroke={typeof track === "string" ? track : undefined}
          strokeWidth={stroke}
          fill="none"
        />
        {wellness !== null ? (
          <Circle
            cx={props.size / 2}
            cy={props.size / 2}
            r={radius}
            stroke={typeof color === "string" ? color : undefined}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${(circumference * wellness) / 100} ${circumference}`}
            transform={`rotate(-90 ${props.size / 2} ${props.size / 2})`}
          />
        ) : null}
      </Svg>
      {props.showValue ? (
        <Text
          textRole={props.size >= 64 ? "headline" : "caption"}
          className="absolute font-t3-medium text-foreground tabular-nums"
        >
          {wellness === null ? "–" : wellness}
        </Text>
      ) : null}
    </View>
  );
}

export function AnimaTraitBars(props: {
  readonly traits: ReadonlyArray<AnimaTrait>;
  readonly color: string | null;
}) {
  return (
    <View className="gap-2.5 px-4 py-3">
      {props.traits.map((trait) => {
        const percent = traitPercent(trait);
        return (
          <View key={trait.name} className="gap-1">
            <View className="flex-row items-baseline justify-between gap-3">
              <Text
                textRole="footnote"
                className="min-w-0 shrink text-foreground"
                numberOfLines={1}
              >
                {trait.name}
                {trait.negStreak ? ` · ↓${trait.negStreak}` : ""}
              </Text>
              <Text textRole="label" className="text-foreground-muted tabular-nums">
                {percent}%{trait.sigma !== null ? ` ±${Math.round(trait.sigma * 100)}` : ""}
              </Text>
            </View>
            <View className="h-1.5 overflow-hidden rounded-full bg-subtle-strong">
              <View
                className={cn("h-full rounded-full", props.color === null && "bg-foreground-muted")}
                style={{
                  width: `${percent}%`,
                  ...(props.color === null ? {} : { backgroundColor: props.color }),
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function StatTile(props: {
  readonly label: string;
  readonly value: number | string;
  readonly tone?: "neutral" | "warning";
  readonly onPress?: () => void;
}) {
  const body = (
    <View
      className={cn(
        "min-w-0 gap-0.5 rounded-2xl px-3.5 py-3",
        props.tone === "warning" && props.value !== 0 ? "bg-warning" : "bg-grouped-card",
      )}
    >
      <Text
        textRole="title"
        className={cn(
          "font-t3-bold tabular-nums",
          props.tone === "warning" && props.value !== 0
            ? "text-warning-foreground"
            : "text-foreground",
        )}
      >
        {typeof props.value === "number" ? props.value.toLocaleString() : props.value}
      </Text>
      <Text textRole="label" className="text-foreground-muted" numberOfLines={1}>
        {props.label}
      </Text>
    </View>
  );
  return (
    <View className="min-w-[30%] flex-1">
      {props.onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${props.value} ${props.label}`}
          onPress={props.onPress}
          className="active:opacity-70"
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
    </View>
  );
}

export function Pill(props: {
  readonly label: string;
  readonly tone?: "neutral" | "warning" | "danger";
}) {
  return (
    <View
      className={cn(
        "rounded-full px-2 py-0.5",
        props.tone === "warning"
          ? "bg-warning"
          : props.tone === "danger"
            ? "bg-danger"
            : "bg-subtle",
      )}
    >
      <Text
        textRole="caption"
        className={cn(
          "tabular-nums",
          props.tone === "warning"
            ? "text-warning-foreground"
            : props.tone === "danger"
              ? "text-danger-foreground"
              : "text-foreground-muted",
        )}
      >
        {props.label}
      </Text>
    </View>
  );
}

export function SmallAction(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      hitSlop={6}
      onPress={props.onPress}
      className={cn(
        "rounded-full bg-subtle px-3 py-1",
        props.disabled ? "opacity-45" : "active:opacity-70",
      )}
    >
      <Text textRole="label" className="font-t3-medium text-foreground">
        {props.label}
      </Text>
    </Pressable>
  );
}

export function MutedLine(props: { readonly children: ReactNode }) {
  return (
    <Text textRole="footnote" className="px-4 py-3 text-foreground-muted">
      {props.children}
    </Text>
  );
}

export function RowDivider(props: { readonly index: number; readonly children: ReactNode }) {
  return (
    <View className={cn("px-4 py-3", props.index > 0 && "border-t border-border-subtle")}>
      {props.children}
    </View>
  );
}

/** Runs an anima command and alerts on failure; resolves true on success. */
export function useAnimaCommand<W, A, E>(command: AtomCommand<W, A, E>, failureTitle: string) {
  const run = useAtomCommand(command, { reportFailure: false });
  return async (input: W): Promise<boolean> => {
    const result = await run(input);
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result)) {
      Dialog.alert(failureTitle, describeAnimaError(squashAtomCommandFailure(result)));
    }
    return false;
  };
}
