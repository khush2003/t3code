import { LegendList } from "@legendapp/list/react-native";
import type { StaticScreenProps } from "@react-navigation/native";
import type { AnimaBreath, AnimaDetail, AnimaName, EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Chip } from "../../components/ui/Chip";
import { useNowMinuteMs } from "../../lib/clock";
import { relativeTime } from "../../lib/time";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { animaEnvironment, describeAnimaError, useAnimaList } from "../../state/anima";
import { animaHealthLabel, animaLastSeen, breathsByDay } from "../../state/anima-presentation";
import { useEnvironmentQuery } from "../../state/query";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { AnimaOrb } from "./AnimaBits";
import {
  ANIMA_DETAIL_TABS,
  type AnimaDetailTab,
  BreathCard,
  HealthTab,
  IdentityTab,
  InboxTab,
  OpensTab,
  OverviewTab,
  PolicyTab,
} from "./AnimaDetailTabs";

type AnimaDetailParams = {
  readonly environmentId: EnvironmentId;
  readonly name: AnimaName;
  readonly tab?: AnimaDetailTab;
  /** Breath index to scroll to and highlight on the Breaths tab. */
  readonly breath?: number;
};

type Row =
  | { readonly kind: "body"; readonly key: string }
  | { readonly kind: "day"; readonly key: string; readonly label: string }
  | { readonly kind: "breath"; readonly key: string; readonly breath: AnimaBreath };

const BODY_ROW: ReadonlyArray<Row> = [{ kind: "body", key: "body" }];

function breathRows(breaths: ReadonlyArray<AnimaBreath>, now: number): Array<Row> {
  return breathsByDay(breaths, now).flatMap((day): Array<Row> => [
    { kind: "day", key: `day:${day.key}`, label: day.label },
    ...day.breaths.map((breath): Row => ({
      kind: "breath",
      key: `breath:${breath.index}`,
      breath,
    })),
  ]);
}

function tabLabel(tab: AnimaDetailTab, detail: AnimaDetail): string {
  const base = ANIMA_DETAIL_TABS.find((entry) => entry.value === tab)?.label ?? tab;
  const count =
    tab === "breaths"
      ? detail.summary.breathCount
      : tab === "inbox"
        ? detail.inbox.length
        : tab === "opens"
          ? detail.opens.filter((open) => open.status.toLowerCase() !== "closed").length
          : tab === "policy"
            ? detail.policy.pending.length
            : 0;
  return count > 0 ? `${base} ${count}` : base;
}

function Header(props: {
  readonly detail: AnimaDetail;
  readonly tab: AnimaDetailTab;
  readonly onTab: (tab: AnimaDetailTab) => void;
}) {
  const { summary } = props.detail;
  const seen = animaLastSeen(summary);
  return (
    <View className="gap-4 pt-4 pb-4">
      <View className="flex-row items-center gap-3 px-5">
        <AnimaOrb anima={summary} size={36} live={summary.live} />
        <View className="min-w-0 flex-1">
          <Text textRole="title" className="font-t3-bold" numberOfLines={1}>
            {summary.name}
          </Text>
          <Text textRole="footnote" className="text-foreground-muted" numberOfLines={2}>
            {[
              summary.role,
              animaHealthLabel(summary.health),
              summary.live ? "Live" : null,
              `${summary.breathCount} breaths`,
              seen ? `seen ${relativeTime(seen)} ago` : null,
              summary.enabled ? null : "Disabled",
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-5"
        accessibilityRole="tablist"
      >
        {ANIMA_DETAIL_TABS.map((entry) => (
          <Chip
            key={entry.value}
            label={tabLabel(entry.value, props.detail)}
            selected={entry.value === props.tab}
            onPress={() => props.onTab(entry.value)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

export function SettingsAnimaDetailRouteScreen({ route }: StaticScreenProps<AnimaDetailParams>) {
  const insets = useSafeAreaInsets();
  const { environmentId, name } = route.params;
  const [tab, setTab] = useState<AnimaDetailTab>(route.params.tab ?? "overview");
  // Selecting a tab by hand drops the deep-linked breath so the list stops pinning it.
  const [focusBreath, setFocusBreath] = useState(route.params.breath ?? null);
  const now = useNowMinuteMs();
  // The server sends the latest 100 breaths; a link to a breath asks for all so an old one can land.
  const query = useEnvironmentQuery(
    animaEnvironment.detail({
      environmentId,
      input: route.params.breath === undefined ? { name } : { name, breathLimit: 0 },
    }),
  );
  const { animas } = useAnimaList(environmentId);
  const detail = query.data;
  const refresh = query.refresh;
  const selectTab = (next: AnimaDetailTab) => {
    setFocusBreath(null);
    setTab(next);
  };

  if (detail === null) {
    return (
      <SettingsScreen title={name}>
        <View className="px-7 pt-6">
          <Text className="text-base text-foreground-muted">
            {query.failure !== null ? describeAnimaError(query.failure) : "Loading…"}
          </Text>
        </View>
      </SettingsScreen>
    );
  }

  const rows = tab === "breaths" ? breathRows(detail.breaths, now) : BODY_ROW;
  const focusIndex =
    tab === "breaths" && focusBreath !== null
      ? rows.findIndex((row) => row.kind === "breath" && row.breath.index === focusBreath)
      : -1;
  const tabProps = { environmentId, detail, onChanged: refresh };
  const renderBody = () => {
    switch (tab) {
      case "overview":
        return <OverviewTab {...tabProps} pool={animas} onShowHealth={() => selectTab("health")} />;
      case "identity":
        return <IdentityTab detail={detail} />;
      case "policy":
        return <PolicyTab {...tabProps} />;
      case "inbox":
        return <InboxTab {...tabProps} />;
      case "opens":
        return <OpensTab {...tabProps} />;
      case "health":
        return <HealthTab {...tabProps} />;
      case "breaths":
        return null;
    }
  };

  return (
    <SettingsScreen title={detail.summary.name}>
      <LegendList
        // Remounting per tab resets scroll and lets `initialScrollIndex` reach a linked breath.
        key={tab}
        renderScrollComponent={Platform.OS === "ios" ? NativeScrollView : undefined}
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        data={rows}
        estimatedItemSize={tab === "breaths" ? 140 : 600}
        getItemType={(row) => row.kind}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        {...(focusIndex >= 0 ? { initialScrollIndex: focusIndex } : {})}
        ListHeaderComponent={<Header detail={detail} tab={tab} onTab={selectTab} />}
        ListEmptyComponent={
          <Text className="px-7 text-base text-foreground-muted">No breaths recorded yet.</Text>
        }
        renderItem={({ item }) => {
          switch (item.kind) {
            case "body":
              return <View className="px-5">{renderBody()}</View>;
            case "day":
              return (
                <Text
                  textRole="footnote"
                  className="px-7 pt-3 pb-2 font-t3-medium text-foreground-muted"
                >
                  {item.label}
                </Text>
              );
            case "breath":
              return (
                <View className="px-5">
                  <BreathCard
                    breath={item.breath}
                    accent={detail.summary.accent}
                    focused={item.breath.index === focusBreath}
                  />
                </View>
              );
          }
        }}
        showsVerticalScrollIndicator={false}
      />
    </SettingsScreen>
  );
}
