import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { BotMemory, BotNote, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { formatDayShort } from "@t3tools/shared/usageFormat";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT, useLocale, Var } from "gt-react";
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  HistoryIcon,
  ListChecksIcon,
  ListIcon,
  type LucideIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TagIcon,
  Trash2Icon,
  Undo2Icon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "~/lib/utils";
import { botsEnvironment } from "~/state/bots";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";

import { RelativeTime } from "../RelativeTime";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { BotAvatar } from "./BotAvatar";
import {
  type BotCharterParts,
  botNoteMatches,
  botNoteTopics,
  type ListedBotNote,
  listBotNotes,
  markBotNoteSearch,
  readBotCharter,
  writeBotCharter,
} from "./botMemory.logic";
import { botMainThreadId, isBotThreadId } from "./botView";
import { useBotSummary } from "./useBot";

const LIST = "m-0 list-none overflow-hidden rounded-xl border border-border/70 bg-card/40 p-0";
const QUIET_BUTTON =
  "cursor-pointer rounded-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
/** What a note removed from this page is marked with; the bot reads it when it recalls the note. */
const REMOVED_BY_PERSON = "Removed by the person.";
const NOTE_CHARS = 600;

/** What the page lists: everything, the charter, one topic's notes, or what was forgotten. */
type Group = "everything" | "rules" | "forgotten" | `topic:${string}`;

const failureMessage = (failure: unknown, fallback: string) =>
  failure instanceof Error && failure.message.trim() !== "" ? failure.message : fallback;

/** Backticked names read as code, and the words being searched for are marked. */
function NoteText(props: { readonly text: string; readonly search?: string }) {
  return props.text.split(/`([^`]+)`/).map((part, index) =>
    index % 2 === 1 ? (
      // oxlint-disable-next-line react/no-array-index-key -- parts of one fixed string, never reordered
      <code key={index} className="rounded-sm bg-foreground/[0.06] px-1 py-px font-mono text-xs">
        {part}
      </code>
    ) : (
      markBotNoteSearch(part, props.search ?? "").map((piece, at) =>
        piece.hit ? (
          // oxlint-disable-next-line react/no-array-index-key -- parts of one fixed string, never reordered
          <mark key={`${index}:${at}`} className="rounded-sm bg-warning/25 text-inherit">
            {piece.text}
          </mark>
        ) : (
          piece.text
        ),
      )
    ),
  );
}

function Rail(props: {
  readonly group: Group;
  readonly onGroup: (group: Group) => void;
  readonly entries: ReadonlyArray<{
    readonly group: Group;
    readonly label: string;
    readonly count: number | null;
    readonly icon: LucideIcon;
    /** Sits under the "Topics" heading, or apart at the end. */
    readonly section: "top" | "topics" | "end";
  }>;
}) {
  const gt = useGT();
  const entry = (item: (typeof props.entries)[number]) => (
    <button
      key={item.group}
      type="button"
      aria-current={props.group === item.group ? "page" : undefined}
      className={cn(
        // A chip in a row while the page is narrow; a line of the rail once there is room for one.
        "flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-full px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring @3xl/memory:h-8 @3xl/memory:w-full @3xl/memory:rounded-lg @3xl/memory:px-2.5 @3xl/memory:text-sm",
        props.group === item.group
          ? "bg-foreground/[0.09] font-medium text-foreground"
          : "bg-foreground/[0.04] text-foreground/80 hover:bg-foreground/[0.07] @3xl/memory:bg-transparent",
      )}
      onClick={() => props.onGroup(item.group)}
    >
      <item.icon aria-hidden className="hidden size-4 shrink-0 opacity-70 @3xl/memory:block" />
      <span className="truncate @3xl/memory:flex-1 @3xl/memory:text-left">{item.label}</span>
      {item.count === null ? null : (
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{item.count}</span>
      )}
    </button>
  );
  const topics = props.entries.filter((item) => item.section === "topics");
  return (
    <nav
      aria-label={gt("What it remembers, by subject")}
      className="flex shrink-0 flex-wrap gap-1.5 @3xl/memory:sticky @3xl/memory:top-3 @3xl/memory:w-60 @3xl/memory:flex-col @3xl/memory:flex-nowrap @3xl/memory:gap-0.5"
    >
      {props.entries.filter((item) => item.section === "top").map(entry)}
      {topics.length === 0 ? null : (
        <>
          <h2 className="hidden px-2.5 pt-4 pb-1 text-xs font-normal text-muted-foreground @3xl/memory:block">
            <T>Topics</T>
          </h2>
          {topics.map(entry)}
        </>
      )}
      <div className="hidden h-4 @3xl/memory:block" />
      {props.entries.filter((item) => item.section === "end").map(entry)}
    </nav>
  );
}

type CharterDraft =
  | ({ readonly kind: "parts" } & BotCharterParts)
  | { readonly kind: "text"; readonly text: string };

const draftOf = (charter: string): CharterDraft => {
  const parts = readBotCharter(charter);
  return parts === null ? { kind: "text", text: charter } : { kind: "parts", ...parts };
};
const charterOf = (draft: CharterDraft) =>
  draft.kind === "text" ? draft.text : writeBotCharter(draft);

function Charter(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly memory: BotMemory;
  readonly canChange: boolean;
  /** Alone on the page: every rule in full, with what the charter said before. */
  readonly full: boolean;
  readonly onOpenFull?: () => void;
  readonly refresh: () => void;
}) {
  const gt = useGT();
  const { memory } = props;
  const setCharter = useAtomCommand(botsEnvironment.setCharter, { reportFailure: false });
  const [draft, setDraft] = useState<CharterDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const parts = readBotCharter(memory.charter);
  const next = draft === null ? memory.charter : charterOf(draft);

  const save = async () => {
    setSaving(true);
    const result = await setCharter({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, charter: next },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result))
        setError(failureMessage(squashAtomCommandFailure(result), gt("That was not saved.")));
      return;
    }
    setError(null);
    setDraft(null);
    props.refresh();
  };

  const row = (label: string, body: ReactNode, key: string) => (
    <div key={key} className="flex gap-4 border-t border-border/70 px-4 py-2.5 first:border-t-0">
      <span className="w-14 shrink-0 pt-0.5 text-xs text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 text-sm leading-relaxed", props.full ? "" : "truncate")}>
        {body}
      </span>
    </div>
  );

  return (
    <section aria-label={gt("How you want work done")}>
      <div className="flex min-h-7 items-center gap-3">
        <h2 className="flex-1 text-sm font-medium text-foreground">
          <T>How you want work done</T>
        </h2>
        {props.full || memory.charterHistory.length === 0 ? null : (
          <button
            type="button"
            className={cn(QUIET_BUTTON, "px-1 text-xs text-muted-foreground")}
            onClick={props.onOpenFull}
          >
            {gt("{count, plural, one {{count} earlier version} other {{count} earlier versions}}", {
              count: memory.charterHistory.length,
            })}
          </button>
        )}
        {!props.canChange || draft !== null ? null : (
          <Button variant="ghost-muted" size="xs" onClick={() => setDraft(draftOf(memory.charter))}>
            <PencilIcon aria-hidden />
            <T>Edit</T>
          </Button>
        )}
      </div>
      {props.full ? (
        <p className="mb-2 max-w-prose text-xs leading-normal text-muted-foreground">
          <T>
            It reads this at the start of every session, and may rewrite it itself when you tell it
            how you like things.
          </T>
        </p>
      ) : null}

      {draft === null ? (
        <div className="mt-1.5 overflow-hidden rounded-xl border border-border/70 bg-card/40">
          {parts === null ? (
            <p
              className={cn(
                "px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                props.full ? "" : "line-clamp-4",
              )}
            >
              {memory.charter}
            </p>
          ) : (
            <>
              {row(gt("Purpose"), parts.purpose, "purpose")}
              {parts.rules.length === 0
                ? row(
                    gt("Rules"),
                    <span className="text-muted-foreground">
                      <T>
                        None yet. Add one here, or tell it in the chat how you like things done.
                      </T>
                    </span>,
                    "none",
                  )
                : parts.rules.map((rule, index) =>
                    row(index === 0 ? gt("Rules") : "", rule, `rule:${index}`),
                  )}
            </>
          )}
        </div>
      ) : (
        <div className="mt-1.5 rounded-xl border border-border/70 bg-card/40 p-3">
          {draft.kind === "text" ? (
            <Textarea
              autoFocus
              rows={Math.min(18, Math.max(4, draft.text.split("\n").length + 1))}
              aria-label={gt("How you want work done")}
              value={draft.text}
              onChange={(event) => setDraft({ kind: "text", text: event.target.value })}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-3 pe-9">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">
                  <T>Purpose</T>
                </span>
                <span className="min-w-0 flex-1">
                  <Input
                    nativeInput
                    aria-label={gt("What it is for")}
                    value={draft.purpose}
                    onChange={(event) => setDraft({ ...draft, purpose: event.target.value })}
                  />
                </span>
              </label>
              {draft.rules.map((rule, index) => (
                // oxlint-disable-next-line react/no-array-index-key -- rules are lines of one text, keyed by place
                <div key={index} className="flex items-start gap-3">
                  <span className="w-14 shrink-0 pt-2 text-xs text-muted-foreground">
                    {index === 0 ? gt("Rules") : ""}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Textarea
                      rows={2}
                      autoFocus={rule === "" && index === draft.rules.length - 1}
                      aria-label={gt("Rule {number}", { number: index + 1 })}
                      placeholder={gt("One thing it should always do, or never do")}
                      value={rule}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          rules: draft.rules.map((old, at) =>
                            at === index ? event.target.value : old,
                          ),
                        })
                      }
                    />
                  </span>
                  <Button
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={gt("Remove rule {number}", { number: index + 1 })}
                    onClick={() =>
                      setDraft({ ...draft, rules: draft.rules.filter((_, at) => at !== index) })
                    }
                  >
                    <XIcon aria-hidden />
                  </Button>
                </div>
              ))}
              <div className="ps-17">
                <Button
                  variant="ghost-muted"
                  size="xs"
                  onClick={() => setDraft({ ...draft, rules: [...draft.rules, ""] })}
                >
                  <PlusIcon aria-hidden />
                  <T>Add a rule</T>
                </Button>
              </div>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              disabled={
                saving ||
                next === memory.charter ||
                (draft.kind === "text" ? draft.text.trim() === "" : draft.purpose.trim() === "")
              }
              onClick={() => void save()}
            >
              <T>Save</T>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              <T>Cancel</T>
            </Button>
            {draft.kind === "parts" ? (
              <button
                type="button"
                className={cn(QUIET_BUTTON, "ms-auto px-1 text-xs text-muted-foreground")}
                onClick={() => setDraft({ kind: "text", text: charterOf(draft) })}
              >
                <T>Edit as plain text</T>
              </button>
            ) : null}
          </div>
        </div>
      )}
      {error === null ? null : (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}

      {!props.full || memory.charterHistory.length === 0 ? null : (
        <div className="mt-6">
          <h3 className="mb-1.5 text-xs text-muted-foreground">
            <T>What it said before</T>
          </h3>
          <ul className={LIST}>
            {memory.charterHistory.map((past) => (
              <li
                key={past.replacedAt}
                className="border-t border-border/70 px-4 py-3 first:border-t-0"
              >
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    <T>
                      Replaced <RelativeTime timestamp={past.replacedAt} />
                    </T>
                  </span>
                  {props.canChange ? (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setDraft(draftOf(past.charter))}
                    >
                      <T>Bring back</T>
                    </Button>
                  ) : null}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-wrap text-foreground/80">
                  {past.charter}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Reading(props: { readonly memory: BotMemory }) {
  const gt = useGT();
  const { memory } = props;
  const [passes, setPasses] = useState(false);
  const last = memory.passes[0];
  return (
    <section aria-label={gt("How it remembers")} className="mt-8 max-w-prose">
      <h2 className="text-xs font-medium text-foreground/85">
        <T>How it remembers</T>
      </h2>
      <p className="mt-1 text-xs leading-normal text-muted-foreground">
        <T>
          It reads back through your conversations on its own and writes down what should last. It
          also keeps every message, and searches them when you ask about something older.
        </T>{" "}
        {last === undefined ? (
          gt("It has not read back yet.")
        ) : (
          <T>
            It last read back <RelativeTime timestamp={last.at} />.
          </T>
        )}{" "}
        {memory.unread === 0
          ? null
          : gt(
              "{count, plural, one {{count} new message is waiting for the next read.} other {{count} new messages are waiting for the next read.}}",
              { count: memory.unread },
            )}
      </p>
      {memory.passes.length === 0 ? null : (
        <div className="mt-1.5">
          <button
            type="button"
            aria-expanded={passes}
            className={cn(QUIET_BUTTON, "flex items-center gap-1 text-xs text-muted-foreground")}
            onClick={() => setPasses(!passes)}
          >
            <ChevronDownIcon aria-hidden className={cn("size-3.5", passes && "rotate-180")} />
            <T>Recent reads</T>
          </button>
          {passes ? (
            <ul className="mt-1.5 list-none p-0">
              {memory.passes.map((pass) => (
                <li
                  key={pass.at}
                  className="border-t border-border/65 py-1.5 text-xs leading-normal first:border-t-0"
                >
                  <span className="text-muted-foreground">
                    <RelativeTime timestamp={pass.at} />
                  </span>{" "}
                  {pass.error !== null ? (
                    <span className="text-destructive">
                      <T>
                        Failed: <Var>{pass.error}</Var>
                      </T>
                    </span>
                  ) : pass.rejected === 0 ? (
                    gt("Read {messages} messages, added {added}, retired {retired}.", {
                      messages: pass.messages,
                      added: pass.added,
                      retired: pass.retired,
                    })
                  ) : (
                    gt(
                      "Read {messages} messages, added {added}, retired {retired}, threw out {rejected} without a source.",
                      {
                        messages: pass.messages,
                        added: pass.added,
                        retired: pass.retired,
                        rejected: pass.rejected,
                      },
                    )
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Where a note is written or reworded. */
function NoteEditor(props: {
  readonly initial: string;
  readonly hint: string;
  readonly save: string;
  readonly onSave: (text: string) => Promise<string | null>;
  readonly onCancel: () => void;
}) {
  const gt = useGT();
  const [text, setText] = useState(props.initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = text.trim().length >= 3 && text.trim() !== props.initial.trim() && !busy;
  const submit = () => {
    if (!ready) return;
    setBusy(true);
    void props.onSave(text.trim()).then((failure) => {
      setBusy(false);
      setError(failure);
    });
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        autoFocus
        rows={3}
        maxLength={NOTE_CHARS}
        aria-label={gt("Note")}
        placeholder={gt("Something it should always know, in a sentence or two")}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
          if (event.key === "Escape") props.onCancel();
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs leading-normal text-muted-foreground">
          {error === null ? props.hint : <span className="text-destructive">{error}</span>}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={props.onCancel}>
          <T>Cancel</T>
        </Button>
        <Button type="submit" size="sm" disabled={!ready}>
          {props.save}
        </Button>
      </div>
    </form>
  );
}

function NoteRow(props: {
  readonly listed: ListedBotNote;
  readonly date: string;
  readonly from: string;
  readonly search: string;
  readonly open: boolean;
  readonly editing: boolean;
  readonly canChange: boolean;
  readonly showTopic: boolean;
  readonly onToggle: () => void;
  readonly onEdit: (editing: boolean) => void;
  readonly onSaveEdit: (text: string) => Promise<string | null>;
  readonly onForget: () => void;
  readonly onRestore: () => void;
  readonly onOpenSource: () => void;
}) {
  const gt = useGT();
  const { note, title, body } = props.listed;
  const forgotten = note.outdatedAt !== null;
  const mine = note.author === "user";
  const changeable = props.canChange && !forgotten;

  if (props.editing)
    return (
      <li className="border-t border-border/70 px-4 py-3 first:border-t-0">
        <NoteEditor
          initial={note.text}
          hint={gt("It files a reworded note under a topic again within a minute.")}
          save={gt("Save note")}
          onSave={props.onSaveEdit}
          onCancel={() => props.onEdit(false)}
        />
      </li>
    );

  return (
    <li className="group/note relative border-t border-border/70 first:border-t-0">
      <button
        type="button"
        aria-expanded={props.open}
        className="block w-full cursor-pointer px-4 py-2.5 text-left outline-none hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={props.onToggle}
      >
        <span className="flex items-center gap-3">
          <span
            className={cn(
              "min-w-0 flex-1 text-sm leading-relaxed",
              body === null ? "" : "font-medium",
              forgotten ? "text-muted-foreground" : "text-foreground",
              props.open ? "" : "truncate",
            )}
          >
            <NoteText text={title} search={props.search} />
          </span>
          {mine ? (
            <span className="shrink-0 rounded-full bg-info/10 px-2 py-0.5 text-xs text-info-foreground">
              <T>Yours</T>
            </span>
          ) : null}
          {props.showTopic && note.topic !== null ? (
            <span className="max-w-40 shrink-0 truncate rounded-full bg-foreground/[0.06] px-2 py-0.5 text-xs text-muted-foreground">
              {note.topic}
            </span>
          ) : null}
          <span
            className={cn(
              "shrink-0 text-right text-xs text-muted-foreground tabular-nums",
              // The hover actions take the date's place, and "Bring back" always sits there.
              changeable
                ? "pointer-fine:group-focus-within/note:invisible pointer-fine:group-hover/note:invisible"
                : "",
              forgotten && props.canChange ? "invisible w-26" : "w-14",
            )}
          >
            {props.date}
          </span>
        </span>
        {body === null || props.open ? null : (
          <span className="mt-0.5 block truncate pe-17 text-xs leading-relaxed text-muted-foreground">
            <NoteText text={body} search={props.search} />
          </span>
        )}
      </button>

      {forgotten && props.canChange ? (
        <div className="absolute top-2 right-3">
          <Button variant="outline" size="xs" onClick={props.onRestore}>
            <Undo2Icon aria-hidden />
            <T>Bring back</T>
          </Button>
        </div>
      ) : changeable ? (
        <div className="absolute top-2 right-3 hidden gap-0.5 pointer-fine:group-focus-within/note:flex pointer-fine:group-hover/note:flex">
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={gt("Edit this note")}
            onClick={() => props.onEdit(true)}
          >
            <PencilIcon aria-hidden />
          </Button>
          <Button
            variant="ghost-destructive"
            size="icon-xs"
            aria-label={gt("Forget this note")}
            onClick={props.onForget}
          >
            <Trash2Icon aria-hidden />
          </Button>
        </div>
      ) : null}

      {props.open ? (
        <div className="px-4 pb-3.5">
          {body === null ? null : (
            <p className="text-sm leading-relaxed text-foreground/90">
              <NoteText text={body} search={props.search} />
            </p>
          )}
          {forgotten ? (
            <p className="mt-2 text-xs leading-normal text-muted-foreground">
              <T>
                Forgotten <RelativeTime timestamp={note.outdatedAt ?? note.createdAt} />.
              </T>{" "}
              {note.outdatedReason === REMOVED_BY_PERSON
                ? gt("You removed it.")
                : note.outdatedReason}
              {note.replacedBy === null ? "" : ` ${gt("A newer note replaced it.")}`}
            </p>
          ) : null}
          {mine ? (
            <p className="mt-2 text-xs leading-normal text-muted-foreground">
              <T>
                You wrote this <RelativeTime timestamp={note.createdAt} />. It reads it at the start
                of every session.
              </T>
            </p>
          ) : (
            <div className="mt-2.5 rounded-lg bg-foreground/[0.04] px-3 py-2.5">
              <blockquote className="text-xs leading-relaxed whitespace-pre-wrap text-foreground/85">
                <NoteText text={note.quote} />
              </blockquote>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span>
                  <T>
                    Said in <Var>{props.from}</Var>, written down{" "}
                    <RelativeTime timestamp={note.createdAt} />
                  </T>
                </span>
                <button
                  type="button"
                  className={cn(
                    QUIET_BUTTON,
                    "inline-flex items-center gap-0.5 text-info-foreground",
                  )}
                  onClick={props.onOpenSource}
                >
                  <T>Open the conversation</T>
                  <ArrowUpRightIcon aria-hidden className="size-3" />
                </button>
              </p>
            </div>
          )}
          {changeable ? (
            <div className="mt-3 flex items-center gap-2">
              <Button variant="outline" size="xs" onClick={() => props.onEdit(true)}>
                <PencilIcon aria-hidden />
                <T>Edit</T>
              </Button>
              <Button variant="ghost-destructive" size="xs" onClick={props.onForget}>
                <Trash2Icon aria-hidden />
                <T>Forget</T>
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Memory(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly memory: BotMemory;
  readonly canChange: boolean;
  readonly refresh: () => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const navigate = useNavigate();
  const { memory } = props;
  const summary = useBotSummary(props.environmentId, props.threadId);
  const addNote = useAtomCommand(botsEnvironment.addNote, { reportFailure: false });
  const editNote = useAtomCommand(botsEnvironment.editNote, { reportFailure: false });
  const retireNote = useAtomCommand(botsEnvironment.retireNote, { reportFailure: false });
  const restoreNote = useAtomCommand(botsEnvironment.restoreNote, { reportFailure: false });
  const [picked, setGroup] = useState<Group>("everything");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const current = memory.notes.filter((note) => note.outdatedAt === null);
  const forgotten = memory.notes.filter((note) => note.outdatedAt !== null);
  const found = current.filter((note) => botNoteMatches(note, search));
  const topics = botNoteTopics(found);
  const rules = readBotCharter(memory.charter)?.rules.length ?? null;
  // A topic goes when its last note does, and the page falls back to everything.
  const group: Group =
    (picked === "forgotten" && forgotten.length === 0) ||
    (picked.startsWith("topic:") && !topics.some((item) => `topic:${item.topic}` === picked))
      ? "everything"
      : picked;
  const topic = group.startsWith("topic:") ? group.slice("topic:".length) : null;
  const searching = search.trim() !== "";
  const listed = listBotNotes(
    group === "forgotten"
      ? forgotten.filter((note) => botNoteMatches(note, search))
      : topic === null
        ? found
        : found.filter((note) => note.topic === topic),
  );
  // The newest notes need no year; older years say theirs.
  const newestYear = listed[0]?.day.slice(0, 4) ?? "";

  const input = { threadId: props.threadId };
  const failed = (
    result: Parameters<typeof isAtomCommandInterrupted>[0] &
      Parameters<typeof squashAtomCommandFailure>[0],
    fallback: string,
  ) =>
    isAtomCommandInterrupted(result)
      ? null
      : failureMessage(squashAtomCommandFailure(result), fallback);
  const restore = async (note: BotNote) => {
    const result = await restoreNote({
      environmentId: props.environmentId,
      input: { ...input, id: note.id },
    });
    if (result._tag === "Failure") {
      const message = failed(result, gt("The note was not brought back."));
      if (message !== null) toastManager.add({ type: "error", title: message });
      return;
    }
    props.refresh();
  };
  const forget = async (shown: ListedBotNote) => {
    const result = await retireNote({
      environmentId: props.environmentId,
      input: { ...input, id: shown.note.id, reason: REMOVED_BY_PERSON },
    });
    if (result._tag === "Failure") {
      const message = failed(result, gt("The note was not forgotten."));
      if (message !== null) toastManager.add({ type: "error", title: message });
      return;
    }
    props.refresh();
    const toast = toastManager.add({
      type: "info",
      title: gt("Forgot “{title}”", { title: shown.title }),
      // Long enough to read the title and reach for the button.
      timeout: 10_000,
      actionProps: {
        children: gt("Undo"),
        onClick: () => {
          toastManager.close(toast);
          void restore(shown.note);
        },
      },
    });
  };

  const from = (note: BotNote) =>
    note.source ??
    (note.threadId === props.threadId
      ? gt("this chat")
      : isBotThreadId(note.threadId)
        ? gt("a thread in this chat")
        : gt("a task it started"));

  const name = summary?.name ?? memory.name;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 pt-3 pb-12 @3xl/memory:flex-row @3xl/memory:items-start @3xl/memory:gap-8">
      <Rail
        group={group}
        onGroup={(next) => {
          setGroup(next);
          setAdding(false);
          if (next === "rules" || next === "forgotten") setSearch("");
        }}
        entries={[
          {
            group: "everything",
            label: gt("Everything"),
            count: found.length,
            icon: ListIcon,
            section: "top",
          },
          {
            group: "rules",
            label: gt("How you want work done"),
            count: rules === 0 ? null : rules,
            icon: ListChecksIcon,
            section: "top",
          },
          ...topics.map((item) => ({
            group: `topic:${item.topic}` as const,
            label: item.topic,
            count: item.count,
            icon: item.topic === "You" ? UserIcon : TagIcon,
            section: "topics" as const,
          })),
          ...(forgotten.length === 0
            ? []
            : [
                {
                  group: "forgotten" as const,
                  label: gt("Forgotten"),
                  count: forgotten.length,
                  icon: HistoryIcon,
                  section: "end" as const,
                },
              ]),
        ]}
      />

      <div className="min-w-0 flex-1">
        <header className="flex items-center gap-3">
          <BotAvatar
            environmentId={props.environmentId}
            name={name}
            look={summary?.look}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-foreground">
              {gt("What {name} remembers", { name })}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {gt(
                "{count, plural, =0 {Nothing written down yet.} one {{count} note.} other {{count} notes.}}",
                { count: current.length },
              )}{" "}
              {memory.passes[0] === undefined ? null : (
                <T>
                  It last read back <RelativeTime timestamp={memory.passes[0].at} />.
                </T>
              )}
            </p>
          </div>
          {props.canChange ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAdding(true);
                setSearch("");
                if (group === "rules" || group === "forgotten") setGroup("everything");
              }}
            >
              <PlusIcon aria-hidden />
              <T>Add a note</T>
            </Button>
          ) : null}
        </header>

        {group === "rules" ? (
          <div className="mt-5">
            <Charter
              environmentId={props.environmentId}
              threadId={props.threadId}
              memory={memory}
              canChange={props.canChange}
              full
              refresh={props.refresh}
            />
          </div>
        ) : (
          <>
            {memory.notes.length < 2 ? null : (
              <div className="mt-4">
                <InputGroup>
                  <InputGroupAddon>
                    <SearchIcon aria-hidden className="size-4 text-muted-foreground" />
                  </InputGroupAddon>
                  <InputGroupInput
                    type="search"
                    aria-label={gt("Search what it remembers")}
                    placeholder={gt("Search what it remembers")}
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      // A search looks through every note, not only the topic that was open.
                      if (!searching && group !== "forgotten") setGroup("everything");
                    }}
                  />
                </InputGroup>
              </div>
            )}

            {group === "everything" && !searching && !adding ? (
              <div className="mt-5">
                <Charter
                  environmentId={props.environmentId}
                  threadId={props.threadId}
                  memory={memory}
                  canChange={props.canChange}
                  full={false}
                  onOpenFull={() => setGroup("rules")}
                  refresh={props.refresh}
                />
              </div>
            ) : null}

            <section aria-label={gt("Notes")} className="mt-6">
              <h2 className="flex min-h-7 items-center text-sm font-medium text-foreground">
                {group === "forgotten" ? gt("Forgotten") : (topic ?? gt("Notes"))}
                <span className="ms-1.5 font-normal text-muted-foreground tabular-nums">
                  {searching && group !== "forgotten"
                    ? gt("{found} of {total}", { found: listed.length, total: current.length })
                    : listed.length}
                </span>
              </h2>
              {group === "forgotten" ? (
                <p className="mb-2 max-w-prose text-xs leading-normal text-muted-foreground">
                  <T>
                    Notes that stopped being true, or that you removed. It no longer reads them, and
                    still finds them when it searches its past.
                  </T>
                </p>
              ) : null}

              {adding ? (
                <div className="mt-1.5 mb-3">
                  <NoteEditor
                    initial=""
                    hint={gt("Written by you. It reads this at the start of every session.")}
                    save={gt("Save note")}
                    onCancel={() => setAdding(false)}
                    onSave={async (text) => {
                      const result = await addNote({
                        environmentId: props.environmentId,
                        input: { ...input, text },
                      });
                      if (result._tag === "Failure")
                        return failed(result, gt("The note was not saved."));
                      props.refresh();
                      setAdding(false);
                      // It has no topic until it is filed, so it shows under everything.
                      setGroup("everything");
                      return null;
                    }}
                  />
                </div>
              ) : null}

              {listed.length === 0 ? (
                <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
                  {searching ? (
                    <T>No note says that.</T>
                  ) : (
                    <T>
                      It writes notes itself after reading back through your conversations. You can
                      also add one, or tell it in the chat what to remember.
                    </T>
                  )}
                </p>
              ) : (
                <ul className={cn(LIST, "mt-1.5")}>
                  {listed.map((shown) => (
                    <NoteRow
                      key={shown.note.id}
                      listed={shown}
                      date={
                        shown.day.startsWith(newestYear)
                          ? formatDayShort(shown.day, locale)
                          : `${formatDayShort(shown.day, locale)} ${shown.day.slice(0, 4)}`
                      }
                      from={from(shown.note)}
                      search={search}
                      open={open === shown.note.id}
                      editing={editing === shown.note.id}
                      canChange={props.canChange}
                      showTopic={topic === null}
                      onToggle={() => setOpen(open === shown.note.id ? null : shown.note.id)}
                      onEdit={(on) => setEditing(on ? shown.note.id : null)}
                      onSaveEdit={async (text) => {
                        const result = await editNote({
                          environmentId: props.environmentId,
                          input: { ...input, id: shown.note.id, text },
                        });
                        if (result._tag === "Failure")
                          return failed(result, gt("The note was not changed."));
                        props.refresh();
                        setEditing(null);
                        return null;
                      }}
                      onForget={() => void forget(shown)}
                      onRestore={() => void restore(shown.note)}
                      onOpenSource={() =>
                        void navigate({
                          to: "/$environmentId/$threadId",
                          params: buildThreadRouteParams(
                            scopeThreadRef(shown.note.environmentId, shown.note.threadId),
                          ),
                          search: {},
                        })
                      }
                    />
                  ))}
                </ul>
              )}
            </section>

            {group === "everything" && !searching ? <Reading memory={memory} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

/** What a bot carries into every session, for the person it works for to read and correct. */
export function BotMemoryView(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const main = botMainThreadId(props.threadId);
  const canChange = useAtomValue(botsEnvironment.setCharter.permissionAtom(props.environmentId));
  const query = useEnvironmentQuery(
    botsEnvironment.memory({ environmentId: props.environmentId, input: { threadId: main } }),
  );
  return (
    <div className="@container/memory h-full min-h-0 overflow-y-auto overscroll-contain">
      {query.data === null ? (
        <p className="px-6 pt-4 text-sm text-muted-foreground">
          {query.error === null ? gt("Reading…") : gt("The bot's memory could not be read.")}
        </p>
      ) : (
        <Memory
          environmentId={props.environmentId}
          threadId={main}
          memory={query.data}
          canChange={canChange}
          refresh={query.refresh}
        />
      )}
    </div>
  );
}
