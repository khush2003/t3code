import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AnimaBreath, AnimaName, AnimaSummary, EnvironmentId } from "@t3tools/contracts";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as Dialog from "../../components/ui/Dialog";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { animaEnvironment, describeAnimaError, useAnimaList } from "../../state/anima";
import { animaColor, animaHealthLabel } from "../../state/anima-presentation";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { AnimaDot } from "../threads/ThreadAnimaSettings";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";

const RECENT_BREATHS = 10;

type AnimaTarget = { readonly environmentId: EnvironmentId; readonly name: AnimaName };

function animaSubtitle(anima: AnimaSummary) {
  return [anima.role, animaHealthLabel(anima.health), anima.live ? "Live" : null]
    .filter((part) => part !== null)
    .join(" · ");
}

function AnimaRosterRow(props: {
  readonly environmentId: EnvironmentId;
  readonly anima: AnimaSummary;
  readonly separated: boolean;
  readonly onChanged: () => void;
}) {
  const navigation = useNavigation();
  const { anima, environmentId } = props;
  const canToggle = useAtomValue(animaEnvironment.setEnabled.permissionAtom(environmentId));
  const setEnabled = useAtomCommand(animaEnvironment.setEnabled, { reportFailure: false });
  const toggle = async (enabled: boolean) => {
    const result = await setEnabled({ environmentId, input: { name: anima.name, enabled } });
    if (result._tag === "Success") {
      props.onChanged();
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      Dialog.alert(
        "Could not update the anima",
        describeAnimaError(squashAtomCommandFailure(result)),
      );
    }
  };
  return (
    <View
      className={cn(
        "min-h-18 flex-row items-center gap-3 px-4 py-3",
        props.separated && "border-t border-border-subtle",
      )}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${anima.name}, ${animaSubtitle(anima)}`}
        onPress={() =>
          navigation.navigate("SettingsAnimaDetail", { environmentId, name: anima.name })
        }
        className="min-w-0 flex-1 flex-row items-center gap-3 active:opacity-70"
      >
        <AnimaDot anima={anima} />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text textRole="body" className="text-foreground" numberOfLines={1}>
            {anima.name}
          </Text>
          <Text textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
            {animaSubtitle(anima)}
          </Text>
          {anima.aim ? (
            <Text textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
              {anima.aim}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <ThemedSwitch
        accessibilityLabel={`Enable ${anima.name}`}
        disabled={!canToggle}
        value={anima.enabled}
        onValueChange={(enabled) => void toggle(enabled)}
      />
    </View>
  );
}

function EnvironmentAnimas(props: {
  readonly environmentId: EnvironmentId;
  readonly title: string | undefined;
}) {
  const { animas, error, isPending, refresh } = useAnimaList(props.environmentId);
  if (animas.length === 0) {
    return (
      <SettingsSection title={props.title}>
        <Text className="px-4 py-3 text-sm text-foreground-muted">
          {isPending ? "Loading animas…" : (error ?? "No animas on this environment.")}
        </Text>
      </SettingsSection>
    );
  }
  return (
    <SettingsSection title={props.title} footer="Disabled animas are skipped by automation.">
      {animas.map((anima, index) => (
        <AnimaRosterRow
          key={anima.name}
          environmentId={props.environmentId}
          anima={anima}
          separated={index > 0}
          onChanged={refresh}
        />
      ))}
    </SettingsSection>
  );
}

export function SettingsAnimasRouteScreen() {
  const insets = useSafeAreaInsets();
  const { availableTargets, selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Animas" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {selectedTargets.length > 0 ? (
            selectedTargets.map((environment) => (
              <EnvironmentAnimas
                key={environment.environmentId}
                environmentId={environment.environmentId}
                title={selectedTargets.length > 1 ? environment.label : undefined}
              />
            ))
          ) : (
            <Text className="px-2 text-base text-foreground-muted">
              {availableTargets.length === 0
                ? "Connect an environment to view its animas."
                : "No environments match these filters. Change the filter above."}
            </Text>
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

function TextSection(props: { readonly title: string; readonly text: string | null }) {
  if (!props.text) return null;
  return (
    <SettingsSection title={props.title}>
      <Text textRole="body" className="px-4 py-3 text-foreground" selectable>
        {props.text}
      </Text>
    </SettingsSection>
  );
}

function SoulHero(props: { readonly summary: AnimaSummary }) {
  const { summary } = props;
  const color = animaColor(summary);
  return (
    <View className="items-center gap-3 px-4 pt-2 pb-1">
      <View
        className={cn("size-24 rounded-full", color === null && "bg-subtle-strong")}
        style={
          color === null
            ? undefined
            : {
                backgroundColor: color,
                shadowColor: color,
                shadowOpacity: 0.65,
                shadowRadius: 28,
                shadowOffset: { width: 0, height: 0 },
                elevation: 12,
              }
        }
      />
      <View className="items-center gap-1">
        <Text textRole="display" className="font-semibold text-foreground">
          {summary.name}
        </Text>
        <Text textRole="footnote" className="text-foreground-muted">
          {[animaSubtitle(summary), `${summary.breathCount} breaths`].filter(Boolean).join(" · ")}
          {summary.enabled ? "" : " · Disabled"}
        </Text>
      </View>
      {summary.aim ? (
        <Text textRole="headline" className="text-center text-foreground">
          {summary.aim}
        </Text>
      ) : null}
      {summary.vow ? (
        <Text textRole="footnote" className="text-center text-foreground-muted italic">
          “{summary.vow}”
        </Text>
      ) : null}
    </View>
  );
}

/** One bar per breath in that breath's colour, oldest first, like the web page. */
function LifeStrip(props: {
  readonly breaths: ReadonlyArray<AnimaBreath>;
  readonly accent: string | null;
}) {
  if (props.breaths.length < 2) return null;
  return (
    <SettingsSection title="Life in colour" footer={`${props.breaths.length} most recent breaths`}>
      <View className="h-14 flex-row items-end gap-0.5 px-4 py-3">
        {props.breaths.map((breath, index) => {
          const color = animaColor({ hsl: breath.hsl, accent: props.accent });
          return (
            <View
              key={breath.index}
              className={cn("flex-1 rounded-sm", color === null && "bg-subtle-strong")}
              style={{
                height: index === props.breaths.length - 1 ? "100%" : "70%",
                ...(color === null ? {} : { backgroundColor: color }),
              }}
            />
          );
        })}
      </View>
    </SettingsSection>
  );
}

function breathHeadline(breath: AnimaBreath): string {
  return breath.aim ?? (breath.decisions.length > 0 ? breath.decisions.join("; ") : breath.note);
}

export function SettingsAnimaDetailRouteScreen({ route }: StaticScreenProps<AnimaTarget>) {
  const insets = useSafeAreaInsets();
  const { environmentId, name } = route.params;
  const query = useEnvironmentQuery(animaEnvironment.detail({ environmentId, input: { name } }));
  const detail = query.data;
  const summary = detail?.summary ?? null;
  const ordered = detail ? [...detail.breaths].sort((a, b) => a.index - b.index) : [];
  const recent = ordered.slice(-RECENT_BREATHS).reverse();
  return (
    <SettingsScreen title={name}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {summary === null ? (
          <Text className="px-2 text-base text-foreground-muted">{query.error ?? "Loading…"}</Text>
        ) : (
          <>
            <SoulHero summary={summary} />
            <LifeStrip breaths={ordered} accent={summary.accent} />
            <TextSection title="Voice" text={summary.voice} />
            <TextSection title="Memo" text={summary.memo} />
            {recent.length > 0 ? (
              <SettingsSection title="Recent breaths">
                {recent.map((breath, index) => (
                  <View
                    key={breath.index}
                    className={cn(
                      "flex-row items-start gap-3 px-4 py-3",
                      index > 0 && "border-t border-border-subtle",
                    )}
                  >
                    <View className="pt-1.5">
                      <AnimaDot anima={{ hsl: breath.hsl, accent: summary.accent }} />
                    </View>
                    <View className="min-w-0 flex-1 gap-0.5">
                      <Text textRole="body" className="text-foreground" numberOfLines={4}>
                        {breathHeadline(breath)}
                      </Text>
                      {breath.friction ? (
                        <Text
                          textRole="footnote"
                          className="text-foreground-muted"
                          numberOfLines={3}
                        >
                          Friction: {breath.friction}
                        </Text>
                      ) : null}
                      <Text textRole="footnote" className="text-foreground-muted">
                        #{breath.index} · {relativeTime(breath.ts)} ago
                      </Text>
                    </View>
                  </View>
                ))}
              </SettingsSection>
            ) : null}
          </>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}
