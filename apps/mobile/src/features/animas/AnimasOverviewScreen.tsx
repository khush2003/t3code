import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import type { AnimaSearchHit, AnimaSummary, EnvironmentId } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Pressable, type TextInputInstance, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { ListRow } from "../../components/ui/ListRow";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SearchField } from "../../components/ui/SearchField";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { useNowMinuteMs } from "../../lib/clock";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { animaEnvironment, useAnimaList, useAnimaSearch } from "../../state/anima";
import {
  ANIMA_SEARCH_MIN_LENGTH,
  animaAlerts,
  animaHealthBucket,
  animaHealthLabel,
  animaHealthNotes,
  animaLastSeen,
  animaNeedsTending,
  animaPoolTotals,
  animaPulse,
  animaSearchTarget,
  animasByNeed,
  groupAnimaSearchHits,
  isUnsupportedAnimaRequest,
  keyedByText,
  searchAnimasLocally,
  tensionBoard,
} from "../../state/anima-presentation";
import { useDebouncedValue } from "../../state/queries";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "../settings/components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { useSettingsEnvironmentFilter } from "../settings/settings-environment-filter";
import {
  AnimaHealthRing,
  AnimaOrb,
  MutedLine,
  Pill,
  SmallAction,
  StatTile,
  useAnimaCommand,
} from "./AnimaBits";

const SEARCH_DEBOUNCE_MS = 200;
const ALERTS_SHOWN = 4;
const TENSIONS_SHOWN = 8;
const HEALTH_SHOWN = 8;

type OpenAnima = (name: AnimaSummary["name"], tab?: "health" | "inbox") => void;

function animaSubtitle(anima: AnimaSummary) {
  return [anima.role, animaHealthLabel(anima.health), anima.live ? "Live" : null]
    .filter((part) => part !== null)
    .join(" · ");
}

function needsWord(anima: AnimaSummary) {
  const bucket = animaHealthBucket(anima.health);
  return bucket === "tend" ? "Tend now" : bucket === "watch" ? "Observing" : "Healthy";
}

function ShowMore(props: {
  readonly total: number;
  readonly shown: number;
  readonly all: boolean;
  readonly noun: string;
  readonly onToggle: () => void;
}) {
  if (props.total <= props.shown && !props.all) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onToggle}
      className="border-t border-border-subtle px-4 py-3 active:opacity-70"
    >
      <Text textRole="footnote" className="font-t3-medium text-primary-text">
        {props.all ? "Show fewer" : `Show all ${props.total} ${props.noun}`}
      </Text>
    </Pressable>
  );
}

function AlertsSection(props: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: OpenAnima;
}) {
  const [all, setAll] = useState(false);
  const alerts = animaAlerts(props.animas);
  if (alerts.length === 0) return null;
  const shown = all ? alerts : alerts.slice(0, ALERTS_SHOWN);
  return (
    <SettingsSection title="Needs tending">
      {shown.map((anima, index) => {
        const notes = animaHealthNotes(anima);
        const bucket = animaHealthBucket(anima.health);
        return (
          <Pressable
            key={anima.name}
            accessibilityRole="button"
            accessibilityLabel={`${anima.name}, ${needsWord(anima)}`}
            onPress={() => props.onOpen(anima.name, "health")}
            className={cn(
              "flex-row items-center gap-3 px-4 py-3 active:opacity-70",
              index > 0 && "border-t border-border-subtle",
            )}
          >
            <AnimaOrb anima={anima} size={14} />
            <View className="min-w-0 flex-1 gap-0.5">
              <View className="flex-row items-center gap-2">
                <Text textRole="body" className="shrink font-t3-medium" numberOfLines={1}>
                  {anima.name}
                </Text>
                <Pill
                  label={needsWord(anima)}
                  tone={bucket === "tend" ? "danger" : bucket === "watch" ? "warning" : "neutral"}
                />
              </View>
              {notes.length > 0 ? (
                <Text textRole="footnote" className="text-foreground-muted" numberOfLines={2}>
                  {notes.slice(0, 2).join(" · ")}
                </Text>
              ) : null}
            </View>
            <AnimaHealthRing score={anima.health} size={30} showValue />
          </Pressable>
        );
      })}
      <ShowMore
        total={alerts.length}
        shown={ALERTS_SHOWN}
        all={all}
        noun="alerts"
        onToggle={() => setAll((value) => !value)}
      />
    </SettingsSection>
  );
}

function TensionsSection(props: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: OpenAnima;
}) {
  const [all, setAll] = useState(false);
  const board = tensionBoard(props.animas);
  if (board.length === 0) return null;
  const byName = new Map(props.animas.map((anima) => [anima.name, anima]));
  const shown = all ? board : board.slice(0, TENSIONS_SHOWN);
  return (
    <SettingsSection
      title="Open tensions"
      footer="Unresolved questions animas carry, oldest first."
    >
      {shown.map((tension, index) => {
        const anima = byName.get(tension.anima);
        return (
          <Pressable
            key={`${tension.anima}:${tension.slug}`}
            accessibilityRole="button"
            onPress={() => props.onOpen(tension.anima)}
            className={cn(
              "gap-1 px-4 py-3 active:opacity-70",
              index > 0 && "border-t border-border-subtle",
            )}
          >
            <View className="flex-row items-center gap-2">
              {anima ? <AnimaOrb anima={anima} size={10} /> : null}
              <Text textRole="footnote" className="flex-1 font-t3-medium" numberOfLines={1}>
                {tension.anima}
              </Text>
              <Pill
                label={`${tension.age} ${tension.age === 1 ? "breath" : "breaths"} old`}
                tone={tension.age >= 8 ? "warning" : "neutral"}
              />
            </View>
            <Text textRole="body" className="text-foreground">
              {tension.text}
            </Text>
          </Pressable>
        );
      })}
      <ShowMore
        total={board.length}
        shown={TENSIONS_SHOWN}
        all={all}
        noun="tensions"
        onToggle={() => setAll((value) => !value)}
      />
    </SettingsSection>
  );
}

/** Who was active in the last 48 hours; the dot sits where on the timeline they were last seen. */
function PulseSection(props: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: OpenAnima;
}) {
  const now = useNowMinuteMs();
  const pulse = animaPulse(props.animas, now);
  if (pulse.length === 0) return null;
  return (
    <SettingsSection title="Last 48 hours" footer="Left is 48 hours ago, right is now.">
      <View className="gap-2 px-4 py-3">
        {pulse.map(({ anima, x, hoursAgo }) => (
          <Pressable
            key={anima.name}
            accessibilityRole="button"
            accessibilityLabel={`${anima.name}, ${Math.round(hoursAgo)} hours ago`}
            onPress={() => props.onOpen(anima.name)}
            className="flex-row items-center gap-3 active:opacity-70"
          >
            <Text textRole="footnote" className="w-24 text-foreground" numberOfLines={1}>
              {anima.name}
            </Text>
            <View className="h-4 flex-1 justify-center">
              <View className="h-px bg-border" />
              <View
                className={cn("absolute", hoursAgo > 24 && "opacity-50")}
                style={{ left: `${x * 100}%`, marginLeft: -6 }}
              >
                <AnimaOrb anima={anima} size={12} live={anima.live} />
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </SettingsSection>
  );
}

function HealthSection(props: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: OpenAnima;
}) {
  const [all, setAll] = useState(false);
  const ranked = animasByNeed(props.animas);
  const needing = ranked.filter((anima) => {
    const bucket = animaHealthBucket(anima.health);
    return bucket === "watch" || bucket === "tend";
  });
  const shown = all ? ranked : needing.slice(0, HEALTH_SHOWN);
  return (
    <SettingsSection title="Health">
      {shown.length === 0 ? <MutedLine>Every anima is steady.</MutedLine> : null}
      {shown.map((anima, index) => {
        const notes = animaHealthNotes(anima);
        return (
          <Pressable
            key={anima.name}
            accessibilityRole="button"
            onPress={() => props.onOpen(anima.name, "health")}
            className={cn(
              "flex-row items-start gap-3 px-4 py-3 active:opacity-70",
              index > 0 && "border-t border-border-subtle",
            )}
          >
            <AnimaHealthRing score={anima.health} size={36} showValue />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text textRole="body" className="font-t3-medium" numberOfLines={1}>
                {anima.name}
              </Text>
              <Text textRole="footnote" className="text-foreground-muted" numberOfLines={3}>
                {notes.length > 0 ? notes.join(" · ") : needsWord(anima)}
              </Text>
            </View>
          </Pressable>
        );
      })}
      <ShowMore
        total={ranked.length}
        shown={shown.length}
        all={all}
        noun="animas"
        onToggle={() => setAll((value) => !value)}
      />
    </SettingsSection>
  );
}

function AnimaRosterRow(props: {
  readonly environmentId: EnvironmentId;
  readonly anima: AnimaSummary;
  readonly separated: boolean;
  readonly canToggle: boolean;
  readonly onOpen: OpenAnima;
  readonly onChanged: () => void;
}) {
  const { anima, environmentId } = props;
  const setEnabled = useAnimaCommand(animaEnvironment.setEnabled, "Could not update the anima");
  const toggle = async (enabled: boolean) => {
    if (await setEnabled({ environmentId, input: { name: anima.name, enabled } })) {
      props.onChanged();
    }
  };
  const seen = animaLastSeen(anima);
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
        onPress={() => props.onOpen(anima.name)}
        className="min-w-0 flex-1 flex-row items-center gap-3 active:opacity-70"
      >
        <AnimaOrb anima={anima} size={22} live={anima.live} />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text textRole="body" className="text-foreground" numberOfLines={1}>
            {anima.name}
          </Text>
          <Text textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
            {[
              animaSubtitle(anima),
              `${anima.breathCount} breaths`,
              seen ? `${relativeTime(seen)} ago` : null,
              anima.inboxCount > 0 ? `${anima.inboxCount} unread` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
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
        disabled={!props.canToggle}
        value={anima.enabled}
        onValueChange={(enabled) => void toggle(enabled)}
      />
    </View>
  );
}

function SearchResults(props: {
  readonly environmentId: EnvironmentId;
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly query: string;
  readonly debounced: string;
}) {
  const navigation = useNavigation();
  const deep = useAnimaSearch(props.environmentId, props.debounced);
  const settled =
    props.debounced === props.query.trim() && deep.data !== null && deep.failure === null;
  const unsupported = deep.failure !== null && isUnsupportedAnimaRequest(deep.failure);
  const hits: ReadonlyArray<AnimaSearchHit> = settled
    ? deep.results
    : searchAnimasLocally(props.animas, props.query);
  const groups = groupAnimaSearchHits(hits);
  const byName = new Map(props.animas.map((anima) => [anima.name, anima]));
  const open = (hit: AnimaSearchHit) => {
    const target = animaSearchTarget(hit);
    if (target === null) return;
    if (target.kind === "library") {
      navigation.navigate("SettingsAnimaLibraryEntry", {
        environmentId: props.environmentId,
        slug: target.slug,
      });
      return;
    }
    navigation.navigate("SettingsAnimaDetail", {
      environmentId: props.environmentId,
      name: target.name,
      ...(target.tab ? { tab: target.tab } : {}),
      ...(target.breath !== undefined ? { breath: target.breath } : {}),
    });
  };
  const footer = unsupported
    ? "This server searches names, aims and tensions only. Update T3 there for breath, identity and library search."
    : !settled && deep.failure === null
      ? "Searching breaths, identity and the library…"
      : deep.error !== null
        ? `Deep search failed: ${deep.error}`
        : undefined;
  if (groups.length === 0) {
    return (
      <SettingsSection footer={footer}>
        <MutedLine>{settled ? "No results." : "Searching…"}</MutedLine>
      </SettingsSection>
    );
  }
  return (
    <View className="gap-4">
      {groups.map((group) => (
        <SettingsSection key={group.type} title={group.label}>
          {keyedByText(
            group.items,
            (hit) =>
              `${hit.type}:${hit.anima ?? ""}:${hit.breath ?? ""}:${hit.title}:${hit.snippet}`,
          ).map(({ key, item: hit }, index) => {
            const anima = hit.anima === null ? undefined : byName.get(hit.anima);
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                onPress={() => open(hit)}
                className={cn(
                  "flex-row items-start gap-3 px-4 py-3 active:opacity-70",
                  index > 0 && "border-t border-border-subtle",
                )}
              >
                <View className="pt-1">
                  {anima ? (
                    <AnimaOrb anima={anima} size={12} />
                  ) : (
                    <View className="size-3 rounded-sm bg-subtle-strong" />
                  )}
                </View>
                <View className="min-w-0 flex-1 gap-0.5">
                  <View className="flex-row items-center gap-2">
                    <Text textRole="footnote" className="shrink font-t3-medium" numberOfLines={1}>
                      {hit.title}
                    </Text>
                    {hit.breath !== null ? (
                      <Text textRole="label" className="text-foreground-muted tabular-nums">
                        #{hit.breath}
                      </Text>
                    ) : null}
                    {hit.status ? <Pill label={hit.status} /> : null}
                  </View>
                  {hit.snippet ? (
                    <Text textRole="footnote" className="text-foreground-muted" numberOfLines={3}>
                      {hit.snippet}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </SettingsSection>
      ))}
      {footer ? (
        <Text textRole="footnote" className="px-2 text-foreground-muted">
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

function EnvironmentAnimas(props: {
  readonly environmentId: EnvironmentId;
  readonly title: string | undefined;
  readonly query: string;
  readonly debounced: string;
}) {
  const navigation = useNavigation();
  const { environmentId } = props;
  const { animas, error, isPending, refresh } = useAnimaList(environmentId);
  const canToggle = useAtomValue(animaEnvironment.setEnabled.permissionAtom(environmentId));
  const [rosterOnlyTending, setRosterOnlyTending] = useState(false);
  const open: OpenAnima = (name, tab) =>
    navigation.navigate("SettingsAnimaDetail", { environmentId, name, ...(tab ? { tab } : {}) });
  const searching = props.query.trim().length >= ANIMA_SEARCH_MIN_LENGTH;
  const heading = props.title ? (
    <Text textRole="headline" className="px-2 font-t3-bold text-foreground">
      {props.title}
    </Text>
  ) : null;
  if (animas.length === 0) {
    return (
      <View className="gap-3">
        {heading}
        <SettingsSection>
          <MutedLine>
            {isPending ? "Loading animas…" : (error ?? "No animas on this environment.")}
          </MutedLine>
        </SettingsSection>
      </View>
    );
  }
  if (searching) {
    return (
      <View className="gap-3">
        {heading}
        <SearchResults
          environmentId={environmentId}
          animas={animas}
          query={props.query}
          debounced={props.debounced}
        />
      </View>
    );
  }
  const totals = animaPoolTotals(animas);
  const roster = rosterOnlyTending ? animas.filter(animaNeedsTending) : animas;
  return (
    <View className="gap-6">
      {heading}
      <View className="flex-row flex-wrap gap-2">
        <StatTile label="Animas" value={totals.animas} />
        <StatTile label="Breaths" value={totals.breaths} />
        <StatTile label="Live now" value={totals.live} />
        <StatTile
          label="Need tending"
          value={totals.tending}
          tone="warning"
          onPress={() => setRosterOnlyTending((value) => !value)}
        />
        <StatTile label="Unread" value={totals.unread} />
      </View>
      <AlertsSection animas={animas} onOpen={open} />
      <TensionsSection animas={animas} onOpen={open} />
      <PulseSection animas={animas} onOpen={open} />
      <HealthSection animas={animas} onOpen={open} />
      <SettingsSection>
        <ListRow
          label="Library"
          description="Notes animas shelve for each other"
          onPress={() => navigation.navigate("SettingsAnimaLibrary", { environmentId })}
        />
      </SettingsSection>
      <SettingsSection
        title={rosterOnlyTending ? "Roster · needs tending" : "Roster"}
        trailing={
          rosterOnlyTending ? (
            <SmallAction label="Show all" onPress={() => setRosterOnlyTending(false)} />
          ) : undefined
        }
        footer="Disabled animas are skipped by automation."
      >
        {roster.map((anima, index) => (
          <AnimaRosterRow
            key={anima.name}
            environmentId={environmentId}
            anima={anima}
            separated={index > 0}
            canToggle={canToggle}
            onOpen={open}
            onChanged={refresh}
          />
        ))}
        {roster.length === 0 ? <MutedLine>No anima needs tending.</MutedLine> : null}
      </SettingsSection>
    </View>
  );
}

export function SettingsAnimasRouteScreen() {
  const insets = useSafeAreaInsets();
  const searchRef = useRef<TextInputInstance>(null);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const { availableTargets, selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Animas" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {selectedTargets.length > 0 ? (
            <>
              <View className="flex-row">
                <SearchField
                  inputRef={searchRef}
                  autoFocus={false}
                  accessibilityLabel="Search animas"
                  clearAccessibilityLabel="Clear anima search"
                  placeholder="Search animas, breaths, identity, library"
                  value={query}
                  onChangeText={setQuery}
                />
              </View>
              {selectedTargets.map((environment) => (
                <EnvironmentAnimas
                  key={environment.environmentId}
                  environmentId={environment.environmentId}
                  title={selectedTargets.length > 1 ? environment.label : undefined}
                  query={query}
                  debounced={debounced}
                />
              ))}
            </>
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
