import { LegendList } from "@legendapp/list/react-native";
import { type StaticScreenProps, useNavigation } from "@react-navigation/native";
import type { AnimaLibraryEntry, EnvironmentId } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Platform, Pressable, type TextInputInstance, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SearchField } from "../../components/ui/SearchField";
import { relativeTime } from "../../lib/time";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { animaEnvironment, describeAnimaError } from "../../state/anima";
import { filterLibraryEntries } from "../../state/anima-presentation";
import { useEnvironmentQuery } from "../../state/query";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import { SettingsScreen } from "../settings/components/SettingsScreen";

const NO_ENTRIES: ReadonlyArray<AnimaLibraryEntry> = Object.freeze([]);

function entryByline(entry: AnimaLibraryEntry) {
  return [
    entry.author ? `From ${entry.author}` : null,
    entry.target ? (entry.target === "pool" ? "For every anima" : `For ${entry.target}`) : null,
    entry.modifiedAt ? `${relativeTime(entry.modifiedAt)} ago` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function SettingsAnimaLibraryRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId: EnvironmentId }>) {
  const { environmentId } = route.params;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const searchRef = useRef<TextInputInstance>(null);
  const [query, setQuery] = useState("");
  const list = useEnvironmentQuery(animaEnvironment.libraryList({ environmentId, input: {} }));
  const entries = filterLibraryEntries(list.data?.entries ?? NO_ENTRIES, query);
  return (
    <SettingsScreen title="Library">
      <LegendList
        renderScrollComponent={Platform.OS === "ios" ? NativeScrollView : undefined}
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 18) + 18,
          paddingHorizontal: 20,
        }}
        data={entries}
        estimatedItemSize={96}
        keyExtractor={(entry) => entry.slug}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View className="flex-row pt-4 pb-4">
            <SearchField
              inputRef={searchRef}
              autoFocus={false}
              accessibilityLabel="Search the library"
              clearAccessibilityLabel="Clear library search"
              placeholder="Search titles, authors, previews"
              value={query}
              onChangeText={setQuery}
            />
          </View>
        }
        ListEmptyComponent={
          <Text className="px-2 text-base text-foreground-muted">
            {list.failure !== null
              ? describeAnimaError(list.failure)
              : list.data === null
                ? "Loading the library…"
                : query.trim() !== ""
                  ? "No entries match that search."
                  : "Nothing has been shelved yet."}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title ?? item.slug}
            onPress={() =>
              navigation.navigate("SettingsAnimaLibraryEntry", { environmentId, slug: item.slug })
            }
            className="mb-2 gap-1 rounded-2xl bg-grouped-card px-4 py-3 active:opacity-70"
          >
            <Text textRole="body" className="font-t3-medium" numberOfLines={2}>
              {item.title ?? item.slug}
            </Text>
            {entryByline(item) ? (
              <Text textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
                {entryByline(item)}
              </Text>
            ) : null}
            {item.preview ? (
              <Text textRole="footnote" className="text-foreground-secondary" numberOfLines={2}>
                {item.preview}
              </Text>
            ) : null}
          </Pressable>
        )}
        showsVerticalScrollIndicator={false}
      />
    </SettingsScreen>
  );
}

export function SettingsAnimaLibraryEntryRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId: EnvironmentId; readonly slug: string }>) {
  const { environmentId, slug } = route.params;
  const insets = useSafeAreaInsets();
  const styles = useMarkdownPreviewStyles();
  const entry = useEnvironmentQuery(
    animaEnvironment.libraryRead({ environmentId, input: { slug } }),
  );
  return (
    <SettingsScreen title={slug}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {entry.data === null ? (
          <Text className="px-2 text-base text-foreground-muted">
            {entry.failure !== null ? describeAnimaError(entry.failure) : "Loading…"}
          </Text>
        ) : (
          <SelectableMarkdownText
            markdown={entry.data.content}
            textStyle={styles.nativeTextStyle}
          />
        )}
      </ScrollView>
    </SettingsScreen>
  );
}
