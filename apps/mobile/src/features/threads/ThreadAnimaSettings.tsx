import { useAtomValue } from "@effect/atom-react";
import type { AnimaName, AnimaSummary, EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import {
  animaEnvironment,
  breatheAnima,
  isAnimaBreathInFlight,
  useAnimaBreathStatus,
  useAnimaList,
} from "../../state/anima";
import { animaBreathStatusLabel, animaColor } from "../../state/anima-presentation";
import { useEnvironmentQuery } from "../../state/query";
import { ChoiceRow } from "./ThreadSettingsRows";

const LOCK_SYMBOL = { ios: "lock.fill", android: "lock" } as const;

/** The anima a draft or thread runs with, as the thread settings sheet edits it. */
export type ThreadSettingsAnima = {
  readonly environmentId: EnvironmentId;
  readonly current: AnimaName | null;
  /** The first wake locks the choice for good. */
  readonly locked: boolean;
  /** Null for a draft: breaths and runtime status need a thread on the server. */
  readonly threadId: ThreadId | null;
  readonly onChange: (name: AnimaName | null) => void;
};

export function AnimaDot(props: { readonly anima: Pick<AnimaSummary, "hsl" | "accent"> | null }) {
  const color = props.anima ? animaColor(props.anima) : null;
  return (
    <View
      className={cn("size-2.5 rounded-full", color === null && "bg-subtle-strong")}
      style={color === null ? undefined : { backgroundColor: color }}
    />
  );
}

function LockIcon() {
  return <SymbolView name={LOCK_SYMBOL} size={12} tintColorClassName="accent-icon-subtle" />;
}

/** Hidden when the environment has no animas, unless one is already set. */
export function ThreadSettingsAnimaRow(props: {
  readonly anima: ThreadSettingsAnima;
  readonly onPress: () => void;
}) {
  const { animas } = useAnimaList(props.anima.environmentId);
  const { current, locked } = props.anima;
  if (animas.length === 0 && current === null) return null;
  const summary = animas.find((anima) => anima.name === current) ?? null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Anima: ${current ?? "none"}${locked ? ", locked to this thread" : ""}`}
      onPress={props.onPress}
      className="min-h-11 flex-row items-center gap-2 border-b border-border-subtle bg-grouped-card px-4 py-2 active:bg-subtle android:min-h-14"
    >
      <Text className="text-sm font-t3-medium text-foreground">Anima</Text>
      <View className="flex-1" />
      {current === null ? null : <AnimaDot anima={summary} />}
      <Text className="shrink text-sm text-foreground-muted" numberOfLines={1}>
        {current ?? "None"}
      </Text>
      {locked ? <LockIcon /> : null}
      <SymbolView
        name="chevron.right"
        size={12}
        tintColorClassName="accent-icon-subtle"
        type="monochrome"
      />
    </Pressable>
  );
}

function SectionTitle(props: { readonly children: string }) {
  return (
    <Text className="px-1 pb-2 pt-6 text-sm font-t3-medium text-foreground-muted">
      {props.children}
    </Text>
  );
}

function DetailRow(props: {
  readonly label: string;
  readonly value: string;
  readonly isLast?: boolean;
  readonly warning?: boolean;
}) {
  return (
    <View
      className={cn(
        "min-h-11 flex-row items-center gap-2 px-4 py-2",
        !props.isLast && "border-b border-border-subtle",
      )}
    >
      <Text className="text-sm font-t3-medium text-foreground">{props.label}</Text>
      <View className="flex-1" />
      <Text
        className={cn(
          "shrink text-sm",
          props.warning ? "text-warning-foreground" : "text-foreground-muted",
        )}
        numberOfLines={2}
      >
        {props.value}
      </Text>
    </View>
  );
}

/** Mounted only while the anima page is open, so the 5s status poll stops with it. */
function AnimaRuntimeStatus(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const status = useEnvironmentQuery(
    animaEnvironment.threadStatus({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
  ).data;
  if (!status) return null;
  return (
    <>
      <DetailRow
        label="Tool calls since wake"
        value={status.breathsAtWake === null ? "Not woken yet" : String(status.toolEvents)}
      />
      <DetailRow
        label="Breath due"
        value={status.breathDue ? "Yes" : "No"}
        warning={status.breathDue}
        isLast={status.loop === null}
      />
      {status.loop === null ? null : (
        <DetailRow
          isLast
          warning
          label="Possible loop"
          value={`${status.loop.tool} failed ${status.loop.failures}×`}
        />
      )}
    </>
  );
}

function AnimaBreathSection(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const canBreathe = useAtomValue(animaEnvironment.breathe.permissionAtom(props.environmentId));
  const breathStatus = useAnimaBreathStatus(props.environmentId, props.threadId);
  const inFlight = isAnimaBreathInFlight(breathStatus);
  const statusLabel = animaBreathStatusLabel(breathStatus);
  const disabled = !canBreathe || inFlight;
  return (
    <>
      <SectionTitle>Runtime</SectionTitle>
      <View className="overflow-hidden rounded-2xl bg-grouped-card">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled, busy: inFlight }}
          disabled={disabled}
          onPress={() => {
            void Haptics.selectionAsync();
            void breatheAnima(props.environmentId, props.threadId);
          }}
          className="min-h-11 justify-center gap-0.5 border-b border-border-subtle px-4 py-2 active:bg-subtle android:min-h-14"
        >
          <Text
            className={cn(
              "text-sm font-t3-medium",
              disabled ? "text-foreground-muted" : "text-foreground",
            )}
          >
            {inFlight ? "Breathing…" : "Breathe now"}
          </Text>
          {canBreathe ? (
            statusLabel === null ? null : (
              <Text
                className={cn(
                  "text-xs",
                  breathStatus?.kind === "failed"
                    ? "text-danger-foreground"
                    : breathStatus?.kind === "timeout"
                      ? "text-warning-foreground"
                      : "text-foreground-muted",
                )}
              >
                {statusLabel}
              </Text>
            )
          ) : (
            <Text className="text-xs text-foreground-muted">
              You don't have permission to request a breath.
            </Text>
          )}
        </Pressable>
        <AnimaRuntimeStatus environmentId={props.environmentId} threadId={props.threadId} />
      </View>
    </>
  );
}

export function ThreadAnimaContent(props: {
  readonly anima: ThreadSettingsAnima;
  readonly onSelected: () => void;
}) {
  const { environmentId, current, locked, threadId } = props.anima;
  const { animas, error, isPending } = useAnimaList(environmentId);
  const summary = animas.find((anima) => anima.name === current) ?? null;
  const select = (name: AnimaName | null) => {
    void Haptics.selectionAsync();
    if (name !== current) props.anima.onChange(name);
    props.onSelected();
  };

  return (
    <View>
      {locked ? (
        <View className="overflow-hidden rounded-2xl bg-grouped-card">
          <View className="min-h-14 flex-row items-center gap-3 px-4 py-3">
            <AnimaDot anima={summary} />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className="text-base font-t3-medium text-foreground">{current}</Text>
              <Text className="text-sm text-foreground-muted">
                Locked to this thread after its first wake
              </Text>
            </View>
            <LockIcon />
          </View>
        </View>
      ) : (
        <>
          <View className="overflow-hidden rounded-2xl bg-grouped-card">
            <ChoiceRow
              label="None"
              selected={current === null}
              isLast={animas.length === 0}
              onPress={() => select(null)}
            />
            {animas.map((anima, index) => (
              <ChoiceRow
                key={anima.name}
                icon={<AnimaDot anima={anima} />}
                label={anima.name}
                description={anima.role}
                selected={anima.name === current}
                isLast={index === animas.length - 1}
                onPress={() => select(anima.name)}
              />
            ))}
          </View>
          <Text className="px-1 pt-2 text-xs text-foreground-muted">
            {animas.length === 0
              ? isPending
                ? "Loading animas…"
                : (error ?? "No animas on this environment.")
              : "The choice locks to this thread when its anima first wakes."}
          </Text>
        </>
      )}
      {threadId !== null && current !== null ? (
        <AnimaBreathSection environmentId={environmentId} threadId={threadId} />
      ) : null}
    </View>
  );
}
