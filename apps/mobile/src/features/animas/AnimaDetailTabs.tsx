import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import type {
  AnimaBreath,
  AnimaDetail,
  AnimaInboxMessage,
  AnimaOpen,
  AnimaSummary,
  EnvironmentId,
} from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import * as Dialog from "../../components/ui/Dialog";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { animaEnvironment, describeAnimaError } from "../../state/anima";
import {
  animaColor,
  animaHeaderValue,
  animaHealthBucket,
  animaHealthNotes,
  breathNoteText,
  continuedBreathCodec,
  keyedByText,
  parseVoiceSamples,
  tensionText,
} from "../../state/anima-presentation";
import { useEnvironmentQuery } from "../../state/query";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import { SettingsSection } from "../settings/components/SettingsSection";
import {
  AnimaHealthRing,
  AnimaOrb,
  AnimaTraitBars,
  MutedLine,
  Pill,
  RowDivider,
  SmallAction,
  useAnimaCommand,
} from "./AnimaBits";

export const ANIMA_DETAIL_TABS = [
  { value: "overview", label: "Overview" },
  { value: "breaths", label: "Breaths" },
  { value: "identity", label: "Identity" },
  { value: "policy", label: "Policy" },
  { value: "inbox", label: "Inbox" },
  { value: "opens", label: "Opens" },
  { value: "health", label: "Health" },
] as const;
export type AnimaDetailTab = (typeof ANIMA_DETAIL_TABS)[number]["value"];

interface TabProps {
  readonly environmentId: EnvironmentId;
  readonly detail: AnimaDetail;
  readonly onChanged: () => void;
}

const ago = (ts: string | null | undefined) => (ts ? `${relativeTime(ts)} ago` : null);

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

function useOpenAnima(environmentId: EnvironmentId, pool: ReadonlyArray<AnimaSummary>) {
  const navigation = useNavigation();
  return (nameOrId: string) => {
    const match = pool.find((anima) => anima.name === nameOrId || anima.id === nameOrId);
    if (!match) return;
    navigation.dispatch(
      StackActions.push("SettingsAnimaDetail", { environmentId, name: match.name }),
    );
  };
}

function Family(props: TabProps & { readonly pool: ReadonlyArray<AnimaSummary> }) {
  const { summary, lead, team } = props.detail;
  const openAnima = useOpenAnima(props.environmentId, props.pool);
  const parent = summary.parent
    ? (props.pool.find((anima) => anima.id === summary.parent || anima.name === summary.parent)
        ?.name ?? summary.parent)
    : null;
  const kin = summary.kin ?? [];
  if (!parent && !lead && team.length === 0 && kin.length === 0) return null;
  return (
    <SettingsSection title="Family">
      <View className="gap-3 px-4 py-3">
        {parent ? (
          <View className="flex-row flex-wrap items-center gap-2">
            <Text textRole="footnote" className="text-foreground-muted">
              Parent
            </Text>
            <Chip size="small" label={parent} onPress={() => openAnima(parent)} />
          </View>
        ) : null}
        {lead ? (
          <View className="flex-row flex-wrap items-center gap-2">
            <Text textRole="footnote" className="text-foreground-muted">
              Lead
            </Text>
            <Chip size="small" label={lead} onPress={() => openAnima(lead)} />
          </View>
        ) : null}
        {team.length > 0 ? (
          <View className="flex-row flex-wrap items-center gap-2">
            <Text textRole="footnote" className="text-foreground-muted">
              Team
            </Text>
            {team.map((member) => (
              <Chip key={member} size="small" label={member} onPress={() => openAnima(member)} />
            ))}
          </View>
        ) : null}
        {kin.length > 0 ? (
          <View className="flex-row flex-wrap items-center gap-2">
            <Text textRole="footnote" className="text-foreground-muted">
              Kin
            </Text>
            {kin.map((bond) => (
              <Chip
                key={`${bond.name}:${bond.label}`}
                size="small"
                label={`${bond.name} · ${bond.label}${bond.strength === null ? "" : ` ${Math.round(bond.strength * 100)}%`}`}
                onPress={() => openAnima(bond.name)}
              />
            ))}
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}

function Tensions(props: TabProps) {
  const tensions = props.detail.summary.tensions ?? [];
  const canRecord = useAtomValue(animaEnvironment.record.permissionAtom(props.environmentId));
  const record = useAnimaCommand(animaEnvironment.record, "Could not resolve the tension");
  const [resolving, setResolving] = useState<string | null>(null);
  if (tensions.length === 0) return null;
  const resolve = (slug: string) =>
    Dialog.confirm({
      title: "Resolve with a breath?",
      message: `Records a breath for ${props.detail.summary.name} that resolves “${tensionText(slug)}”.`,
      confirmText: "Resolve",
      onConfirm: () => {
        setResolving(slug);
        void record({
          environmentId: props.environmentId,
          input: { ...continuedBreathCodec(props.detail), resolves: [slug] },
        }).then((ok) => {
          setResolving(null);
          if (ok) props.onChanged();
        });
      },
    });
  return (
    <SettingsSection title="Open tensions">
      {[...tensions]
        .sort((a, b) => b.age - a.age)
        .map((tension, index) => (
          <RowDivider key={tension.slug} index={index}>
            <View className="flex-row items-center gap-3">
              <View className="min-w-0 flex-1 gap-1">
                <Text textRole="body">{tensionText(tension.slug)}</Text>
                <View className="flex-row">
                  <Pill
                    label={`${tension.age} ${tension.age === 1 ? "breath" : "breaths"} old`}
                    tone={tension.age >= 8 ? "warning" : "neutral"}
                  />
                </View>
              </View>
              {canRecord ? (
                <SmallAction
                  label={resolving === tension.slug ? "Resolving…" : "Resolve"}
                  accessibilityLabel={`Resolve ${tensionText(tension.slug)}`}
                  disabled={resolving !== null}
                  onPress={() => resolve(tension.slug)}
                />
              ) : null}
            </View>
          </RowDivider>
        ))}
    </SettingsSection>
  );
}

function Voice(props: { readonly detail: AnimaDetail }) {
  const samples = parseVoiceSamples(animaHeaderValue(props.detail, "samples") ?? "");
  const voice = props.detail.summary.voice;
  if (!voice && samples.length === 0) return null;
  return (
    <SettingsSection title="Voice">
      {voice ? (
        <Text textRole="body" className="px-4 py-3 text-foreground" selectable>
          {voice}
        </Text>
      ) : null}
      {keyedByText(samples, (sample) => `${sample.tag}:${sample.text}`).map(
        ({ key, item: sample }, index) => (
          <RowDivider key={key} index={voice ? index + 1 : index}>
            <Text textRole="label" className="text-foreground-muted uppercase">
              {sample.tag}
            </Text>
            <Text textRole="body" className="text-foreground italic" selectable>
              “{sample.text}”
            </Text>
          </RowDivider>
        ),
      )}
    </SettingsSection>
  );
}

/** One bar per breath in that breath's colour, oldest first. */
function LifeStrip(props: {
  readonly breaths: ReadonlyArray<AnimaBreath>;
  readonly accent: string | null;
}) {
  if (props.breaths.length < 2) return null;
  const ordered = [...props.breaths].sort((a, b) => a.index - b.index);
  return (
    <SettingsSection title="Life in colour" footer="One bar per breath, oldest first">
      <View className="h-14 flex-row items-end gap-0.5 px-4 py-3">
        {ordered.map((breath, index) => {
          const color = animaColor({ hsl: breath.hsl, accent: props.accent });
          return (
            <View
              key={breath.index}
              className={cn("flex-1 rounded-sm", color === null && "bg-subtle-strong")}
              style={{
                height: index === ordered.length - 1 ? "100%" : "70%",
                ...(color === null ? {} : { backgroundColor: color }),
              }}
            />
          );
        })}
      </View>
    </SettingsSection>
  );
}

export function OverviewTab(
  props: TabProps & {
    readonly pool: ReadonlyArray<AnimaSummary>;
    readonly onShowHealth: () => void;
  },
) {
  const { summary } = props.detail;
  const color = animaColor(summary);
  const notes = animaHealthNotes(summary);
  const bucket = animaHealthBucket(summary.health);
  return (
    <View className="gap-6">
      <View className="items-center gap-3 px-4 pt-2">
        <AnimaOrb anima={summary} size={88} />
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
        {summary.homeProject ? (
          <Text textRole="footnote" className="text-foreground-muted">
            Home project · {summary.homeProject}
          </Text>
        ) : null}
      </View>
      <SettingsSection title="Health">
        <Pressable
          accessibilityRole="button"
          onPress={props.onShowHealth}
          className="flex-row items-center gap-4 px-4 py-3 active:opacity-70"
        >
          <AnimaHealthRing score={summary.health} size={56} showValue />
          <View className="min-w-0 flex-1 gap-0.5">
            <Text
              textRole="body"
              className={cn(
                "font-t3-medium",
                bucket === "tend"
                  ? "text-danger-foreground"
                  : bucket === "watch"
                    ? "text-warning-foreground"
                    : "text-foreground",
              )}
            >
              {bucket === "tend"
                ? "Needs tending"
                : bucket === "watch"
                  ? "Worth watching"
                  : bucket === "steady"
                    ? "Steady"
                    : "No reading yet"}
            </Text>
            {notes.length > 0 ? (
              <Text textRole="footnote" className="text-foreground-muted" numberOfLines={4}>
                {notes.join(" · ")}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </SettingsSection>
      <TextSection title="Memo" text={summary.memo} />
      <Tensions {...props} />
      <Family {...props} />
      {props.detail.skills.length > 0 ? (
        <SettingsSection title="Skills" footer="Estimate ± uncertainty">
          <AnimaTraitBars traits={props.detail.skills} color={color} />
        </SettingsSection>
      ) : null}
      {props.detail.traits.length > 0 ? (
        <SettingsSection title="Traits">
          <AnimaTraitBars traits={props.detail.traits} color={color} />
        </SettingsSection>
      ) : null}
      <Voice detail={props.detail} />
      <LifeStrip breaths={props.detail.breaths} accent={summary.accent} />
    </View>
  );
}

function timeOfDay(ts: string): string | null {
  const time = Date.parse(ts);
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(time)
    : null;
}

const FILES_SHOWN = 4;

function BulletList(props: { readonly label: string; readonly items: ReadonlyArray<string> }) {
  if (props.items.length === 0) return null;
  return (
    <View className="gap-0.5">
      <Text textRole="label" className="font-t3-medium text-foreground-muted">
        {props.label}
      </Text>
      {keyedByText(props.items, (item) => item).map(({ key, item }) => (
        <Text key={key} textRole="footnote" className="text-foreground" selectable>
          • {item}
        </Text>
      ))}
    </View>
  );
}

export function BreathCard(props: {
  readonly breath: AnimaBreath;
  readonly accent: string | null;
  readonly focused: boolean;
}) {
  const { breath } = props;
  const [allFiles, setAllFiles] = useState(false);
  const note = breathNoteText(breath.note);
  const files = allFiles ? breath.files : breath.files.slice(0, FILES_SHOWN);
  return (
    <View
      className={cn(
        "mb-2 gap-2 rounded-2xl bg-grouped-card px-4 py-3",
        props.focused && "border-2 border-focus",
      )}
    >
      <View className="flex-row items-center gap-2">
        <AnimaOrb anima={{ hsl: breath.hsl, accent: props.accent }} size={10} />
        <Text textRole="footnote" className="font-t3-medium tabular-nums">
          #{breath.index}
        </Text>
        <Text
          textRole="footnote"
          className="min-w-0 flex-1 text-foreground-muted"
          numberOfLines={1}
        >
          {[timeOfDay(breath.ts), breath.project].filter(Boolean).join(" · ")}
        </Text>
      </View>
      {breath.aim ? (
        <Text textRole="body" className="font-t3-medium text-foreground" selectable>
          {breath.aim}
        </Text>
      ) : null}
      {note ? (
        <Text textRole="body" className="text-foreground" selectable>
          {note}
        </Text>
      ) : null}
      <BulletList label="Decisions" items={breath.decisions} />
      {breath.friction ? (
        <View className="gap-0.5">
          <Text textRole="label" className="font-t3-medium text-warning-foreground">
            Friction
          </Text>
          <Text textRole="footnote" className="text-foreground" selectable>
            {breath.friction}
          </Text>
        </View>
      ) : null}
      <BulletList label="Open" items={breath.open} />
      <BulletList label="Closed" items={breath.closedOpens} />
      {breath.seeking ? (
        <Text textRole="footnote" className="text-foreground-muted">
          Seeking · {breath.seeking}
        </Text>
      ) : null}
      {breath.files.length > 0 ? (
        <View className="gap-0.5">
          <Text textRole="label" className="font-t3-medium text-foreground-muted">
            Files · {breath.files.length}
          </Text>
          {files.map((file) => (
            <Text
              key={file}
              textRole="label"
              className="font-mono text-foreground"
              numberOfLines={1}
            >
              {file}
            </Text>
          ))}
          {breath.files.length > FILES_SHOWN ? (
            <Pressable accessibilityRole="button" onPress={() => setAllFiles((value) => !value)}>
              <Text textRole="label" className="text-primary-text">
                {allFiles ? "Show fewer" : `Show ${breath.files.length - FILES_SHOWN} more`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function IdentityTab(props: { readonly detail: AnimaDetail }) {
  const styles = useMarkdownPreviewStyles();
  const identity = props.detail.identity.trim();
  return (
    <SettingsSection title="identity.md">
      {identity === "" ? (
        <MutedLine>No identity written yet.</MutedLine>
      ) : (
        <View className="px-4 py-3">
          <SelectableMarkdownText markdown={identity} textStyle={styles.nativeTextStyle} />
        </View>
      )}
    </SettingsSection>
  );
}

export function PolicyTab(props: TabProps) {
  const { policy, summary } = props.detail;
  const canOperate = useAtomValue(animaEnvironment.policy.permissionAtom(props.environmentId));
  const run = useAnimaCommand(animaEnvironment.policy, "Could not change policy");
  const [rule, setRule] = useState("");
  const [direct, setDirect] = useState(false);
  const [busy, setBusy] = useState(false);
  const act = async (action: Parameters<typeof run>[0]["input"]["action"]) => {
    setBusy(true);
    const ok = await run({
      environmentId: props.environmentId,
      input: { name: summary.name, action },
    });
    setBusy(false);
    if (ok) props.onChanged();
    return ok;
  };
  const audit =
    policy.auditEntries ??
    policy.audit.map((text) => ({ revision: null, at: null, by: null, text }));
  const updated = [ago(policy.updatedAt), policy.updatedBy ? `by ${policy.updatedBy}` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <View className="gap-6">
      <View className="gap-0.5 px-2">
        <Text textRole="headline" className="font-t3-bold">
          Revision {policy.revision} · {policy.operational.length}/{policy.cap} rules
        </Text>
        {updated ? (
          <Text textRole="footnote" className="text-foreground-muted">
            Updated {updated}
          </Text>
        ) : null}
      </View>
      <SettingsSection title="Operational">
        {policy.operational.length === 0 ? <MutedLine>No operational rules.</MutedLine> : null}
        {policy.operational.map((entry, index) => (
          <RowDivider key={entry.index} index={index}>
            <Text textRole="body" selectable>
              {entry.index}. {entry.text}
            </Text>
            <Text textRole="label" className="text-foreground-muted">
              {entry.fires === 0
                ? "Never fired"
                : `Fired ${entry.fires} ${entry.fires === 1 ? "time" : "times"}${entry.lastFiredAt ? ` · last ${ago(entry.lastFiredAt)}` : ""}`}
            </Text>
          </RowDivider>
        ))}
      </SettingsSection>
      {policy.pending.length > 0 ? (
        <SettingsSection
          title="Pending"
          trailing={
            canOperate ? (
              <SmallAction
                label="Approve all"
                disabled={busy}
                onPress={() => void act({ type: "apply" })}
              />
            ) : undefined
          }
          footer="Proposed rules take effect once approved."
        >
          {policy.pending.map((entry, index) => (
            <RowDivider key={entry.index} index={index}>
              <Text textRole="body" selectable>
                {entry.text}
              </Text>
            </RowDivider>
          ))}
        </SettingsSection>
      ) : null}
      {canOperate ? (
        <SettingsSection title="Add a rule">
          <View className="gap-3 px-4 py-3">
            <AppTextInput
              accessibilityLabel="New policy rule"
              placeholder="When …, always …"
              value={rule}
              onChangeText={setRule}
              multiline
            />
            <View className="flex-row items-center justify-between gap-3">
              <Text textRole="footnote" className="flex-1 text-foreground-muted">
                Apply directly instead of proposing
              </Text>
              <ThemedSwitch
                accessibilityLabel="Apply directly"
                value={direct}
                onValueChange={setDirect}
              />
            </View>
            <Button
              label={direct ? "Add rule" : "Propose rule"}
              tone="primary"
              disabled={rule.trim() === "" || busy}
              loading={busy}
              onPress={() => {
                void act({ type: "add", rule: rule.trim(), direct }).then((ok) => {
                  if (ok) setRule("");
                });
              }}
            />
          </View>
        </SettingsSection>
      ) : null}
      {audit.length > 0 ? (
        <SettingsSection title="Audit">
          {keyedByText([...audit].reverse(), (entry) => entry.text).map(
            ({ key, item: entry }, index) => (
              <RowDivider key={key} index={index}>
                <Text textRole="footnote" selectable>
                  {entry.text}
                </Text>
                {entry.revision !== null || entry.at || entry.by ? (
                  <Text textRole="label" className="text-foreground-muted">
                    {[
                      entry.revision !== null ? `rev ${entry.revision}` : null,
                      entry.at,
                      entry.by ? `by ${entry.by}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                ) : null}
              </RowDivider>
            ),
          )}
        </SettingsSection>
      ) : null}
    </View>
  );
}

const MESSAGE_ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,79}$/;

function InboxRow(props: {
  readonly message: AnimaInboxMessage;
  readonly index: number;
  readonly onAck: (() => void) | null;
}) {
  const { message } = props;
  return (
    <RowDivider index={props.index}>
      <View className="flex-row items-center gap-2">
        <Pill label={message.type} />
        <Text textRole="footnote" className="min-w-0 flex-1 font-t3-medium" numberOfLines={1}>
          {message.from}
          {message.to ? ` → ${message.to}` : ""}
        </Text>
        <Text textRole="label" className="text-foreground-muted">
          {ago(message.ts)}
        </Text>
      </View>
      <Text textRole="body" className="mt-1 text-foreground" selectable numberOfLines={12}>
        {message.body}
      </Text>
      {message.status || props.onAck ? (
        <View className="mt-2 flex-row items-center justify-between gap-2">
          <Text textRole="label" className="text-foreground-muted">
            {message.status ?? ""}
          </Text>
          {props.onAck ? <SmallAction label="Acknowledge" onPress={props.onAck} /> : null}
        </View>
      ) : null}
    </RowDivider>
  );
}

export function InboxTab(props: TabProps) {
  const canOperate = useAtomValue(animaEnvironment.inboxAction.permissionAtom(props.environmentId));
  const run = useAnimaCommand(animaEnvironment.inboxAction, "Could not update the inbox");
  const messages = [...props.detail.inbox].sort((l, r) => (l.ts < r.ts ? 1 : l.ts > r.ts ? -1 : 0));
  const ack = (id: string) =>
    void run({
      environmentId: props.environmentId,
      input: { name: props.detail.summary.name, action: { type: "ack", messageIds: [id] } },
    }).then((ok) => {
      if (ok) props.onChanged();
    });
  return (
    <SettingsSection title="Inbox" footer="Acknowledged messages leave the inbox.">
      {messages.length === 0 ? <MutedLine>The inbox is empty.</MutedLine> : null}
      {messages.map((message, index) => (
        <InboxRow
          key={message.id}
          message={message}
          index={index}
          onAck={canOperate && MESSAGE_ID.test(message.id) ? () => ack(message.id) : null}
        />
      ))}
    </SettingsSection>
  );
}

const OPEN_ID = /^open-\d{1,6}$/;
const OPEN_ORDER: Readonly<Record<string, number>> = { blocked: 0, active: 1, watching: 2 };

/** Blocked first, then active, then watching. */
function byOpenStatus(l: AnimaOpen, r: AnimaOpen): number {
  const rank = (open: AnimaOpen) => OPEN_ORDER[open.status.toLowerCase()] ?? 3;
  return rank(l) - rank(r) || l.id.localeCompare(r.id);
}

function OpenRow(props: {
  readonly open: AnimaOpen;
  readonly index: number;
  readonly onClose: (() => void) | null;
}) {
  const { open } = props;
  const status = open.status.toLowerCase();
  return (
    <RowDivider index={props.index}>
      <View className="flex-row items-center gap-2">
        <Pill
          label={open.status}
          tone={status === "blocked" ? "danger" : status === "active" ? "warning" : "neutral"}
        />
        <Text textRole="label" className="min-w-0 flex-1 text-foreground-muted" numberOfLines={1}>
          {[open.id, open.assignee ? `@${open.assignee}` : null, open.openedAt]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {props.onClose ? <SmallAction label="Close" onPress={props.onClose} /> : null}
      </View>
      <Text textRole="body" className="mt-1" selectable>
        {open.question}
      </Text>
      {open.resolves ? (
        <Text textRole="footnote" className="text-foreground-muted" selectable>
          Resolves when · {open.resolves}
        </Text>
      ) : null}
      {open.context ? (
        <Text textRole="footnote" className="text-foreground-muted" selectable numberOfLines={6}>
          {open.context}
        </Text>
      ) : null}
    </RowDivider>
  );
}

export function OpensTab(props: TabProps) {
  const canOperate = useAtomValue(animaEnvironment.opensAction.permissionAtom(props.environmentId));
  const run = useAnimaCommand(animaEnvironment.opensAction, "Could not close the open question");
  const live = props.detail.opens
    .filter((open) => open.status.toLowerCase() !== "closed")
    .sort(byOpenStatus);
  const closed = props.detail.opens.filter((open) => open.status.toLowerCase() === "closed");
  const close = (open: AnimaOpen) =>
    Dialog.confirm({
      title: "Close this question?",
      message: open.question,
      confirmText: "Close",
      onConfirm: () =>
        void run({
          environmentId: props.environmentId,
          input: { name: props.detail.summary.name, action: { type: "close", id: open.id } },
        }).then((ok) => {
          if (ok) props.onChanged();
        }),
    });
  if (props.detail.projectPath === null && props.detail.opens.length === 0) {
    return (
      <SettingsSection>
        <MutedLine>This anima has no home project, so it has no open questions board.</MutedLine>
      </SettingsSection>
    );
  }
  return (
    <View className="gap-6">
      <SettingsSection title="Open questions">
        {live.length === 0 ? <MutedLine>No open questions.</MutedLine> : null}
        {live.map((open, index) => (
          <OpenRow
            key={open.id}
            open={open}
            index={index}
            onClose={canOperate && OPEN_ID.test(open.id) ? () => close(open) : null}
          />
        ))}
      </SettingsSection>
      {closed.length > 0 ? (
        <SettingsSection title={`Closed · ${closed.length}`}>
          {closed.map((open, index) => (
            <OpenRow key={open.id} open={open} index={index} onClose={null} />
          ))}
        </SettingsSection>
      ) : null}
    </View>
  );
}

const HEALTH_COMPONENTS = [
  { key: "uncertainty", label: "Uncertainty" },
  { key: "negStreak", label: "Negative streaks" },
  { key: "staleTension", label: "Stale tensions" },
  { key: "drift", label: "Colour drift" },
  { key: "silence", label: "Silence" },
] as const;

export function HealthTab(props: TabProps) {
  const query = useEnvironmentQuery(
    animaEnvironment.health({
      environmentId: props.environmentId,
      input: { name: props.detail.summary.name },
    }),
  );
  const result = query.data;
  if (result === null) {
    return (
      <SettingsSection>
        <MutedLine>
          {query.failure !== null ? describeAnimaError(query.failure) : "Reading health…"}
        </MutedLine>
      </SettingsSection>
    );
  }
  const health = result.health;
  const levelOrder = { error: 0, warn: 1, info: 2 } as const;
  const findings = [...result.audit].sort((l, r) => levelOrder[l.level] - levelOrder[r.level]);
  return (
    <View className="gap-6">
      <View className="flex-row items-center gap-4 px-2">
        <AnimaHealthRing score={health?.score ?? null} size={84} showValue />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text textRole="headline" className="font-t3-bold">
            {health === null
              ? "No reading yet"
              : health.action === "proactive"
                ? "Tend now"
                : health.action === "internal"
                  ? "Worth watching"
                  : "Healthy"}
          </Text>
          <Text textRole="footnote" className="text-foreground-muted">
            Circuit {result.circuit}
            {result.circuitCount > 0 ? ` · ${result.circuitCount} trips` : ""}
          </Text>
        </View>
      </View>
      {health ? (
        <>
          <SettingsSection title="Components" footer="Each is 0–100; higher means more need.">
            <View className="gap-2.5 px-4 py-3">
              {HEALTH_COMPONENTS.map((component) => {
                const value = Math.round(
                  Math.min(1, Math.max(0, health.components[component.key])) * 100,
                );
                return (
                  <View key={component.key} className="gap-1">
                    <View className="flex-row justify-between">
                      <Text textRole="footnote">{component.label}</Text>
                      <Text textRole="label" className="text-foreground-muted tabular-nums">
                        {value}
                      </Text>
                    </View>
                    <View className="h-1.5 overflow-hidden rounded-full bg-subtle-strong">
                      <View
                        className={cn(
                          "h-full rounded-full",
                          value > 60
                            ? "bg-danger-foreground"
                            : value > 35
                              ? "bg-warning-foreground"
                              : "bg-foreground-muted",
                        )}
                        style={{ width: `${value}%` }}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </SettingsSection>
          <SettingsSection title="Readings">
            <View className="gap-1 px-4 py-3">
              <Text textRole="footnote">Largest σ · {health.maxSigma.toFixed(2)}</Text>
              <Text textRole="footnote">Longest negative streak · {health.maxNegStreak}</Text>
              <Text textRole="footnote">Oldest tension · {health.maxTensionAge} breaths</Text>
              <Text textRole="footnote">Silent for · {Math.round(health.silenceHours)} hours</Text>
              <Text textRole="footnote">Colour drift · {health.colorDrift.toFixed(2)}</Text>
            </View>
          </SettingsSection>
          {health.warnings.length > 0 ? (
            <SettingsSection title="Warnings">
              {keyedByText(health.warnings, (warning) => warning).map(
                ({ key, item: warning }, index) => (
                  <RowDivider key={key} index={index}>
                    <Text textRole="body" className="text-warning-foreground">
                      {warning}
                    </Text>
                  </RowDivider>
                ),
              )}
            </SettingsSection>
          ) : null}
          {health.reasons.length > 0 ? (
            <SettingsSection title="Reasons">
              {keyedByText(health.reasons, (reason) => reason).map(
                ({ key, item: reason }, index) => (
                  <RowDivider key={key} index={index}>
                    <Text textRole="body">{reason}</Text>
                  </RowDivider>
                ),
              )}
            </SettingsSection>
          ) : null}
        </>
      ) : null}
      <SettingsSection title="Audit">
        {findings.length === 0 ? <MutedLine>No integrity findings.</MutedLine> : null}
        {keyedByText(findings, (finding) => `${finding.level}:${finding.message}`).map(
          ({ key, item: finding }, index) => (
            <RowDivider key={key} index={index}>
              <View className="flex-row items-start gap-2">
                <Pill
                  label={finding.level}
                  tone={
                    finding.level === "error"
                      ? "danger"
                      : finding.level === "warn"
                        ? "warning"
                        : "neutral"
                  }
                />
                <Text textRole="footnote" className="min-w-0 flex-1" selectable>
                  {finding.message}
                </Text>
              </View>
            </RowDivider>
          ),
        )}
      </SettingsSection>
    </View>
  );
}
