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
import { ChevronDownIcon, MessagesSquareIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

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
import { botNoteMatches, groupBotNotesByDay, listBotNote } from "./botMemory.logic";
import { botMainThreadId, isBotThreadId } from "./botView";

const LIST = "m-0 list-none overflow-hidden rounded-xl border border-border/70 bg-card/40 p-0";
const QUIET_BUTTON =
  "cursor-pointer rounded-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const failureMessage = (failure: unknown, fallback: string) =>
  failure instanceof Error && failure.message.trim() !== "" ? failure.message : fallback;

/** A note names branches, files and commands in backticks; they read as code, not as punctuation. */
function NoteText(props: { readonly text: string }) {
  return props.text.split(/`([^`]+)`/).map((part, index) =>
    index % 2 === 1 ? (
      // oxlint-disable-next-line react/no-array-index-key -- parts of one fixed string, never reordered
      <code key={index} className="rounded-sm bg-foreground/[0.06] px-1 py-px font-mono text-xs">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

function NoteRow(props: {
  readonly note: BotNote;
  readonly text: string;
  readonly from: string;
  readonly canChange: boolean;
  readonly onOpenSource: () => void;
  readonly onRetire: (reason: string) => Promise<string | null>;
}) {
  const gt = useGT();
  const { note } = props;
  const [open, setOpen] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const retired = note.outdatedAt !== null;
  return (
    <li className="border-t border-border/70 first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full cursor-pointer gap-3 px-4 py-3 text-left outline-none hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => setOpen(!open)}
      >
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-sm leading-relaxed",
              retired ? "text-muted-foreground line-through" : "text-foreground",
              open ? "" : "line-clamp-2",
            )}
          >
            <NoteText text={props.text} />
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <MessagesSquareIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{props.from}</span>
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn("mt-1 size-4 shrink-0 text-muted-foreground", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="px-4 pb-3.5">
          {retired ? (
            <p className="mb-2.5 text-xs text-muted-foreground">
              <T>
                Marked no longer true <RelativeTime timestamp={note.outdatedAt ?? note.createdAt} />
                :
              </T>{" "}
              {note.outdatedReason}
              {note.replacedBy === null ? "" : ` ${gt("A newer note replaced it.")}`}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            <T>
              Written down <RelativeTime timestamp={note.createdAt} />, from this passage:
            </T>
          </p>
          <blockquote className="mt-1.5 border-s-2 border-border ps-2.5 text-xs leading-relaxed whitespace-pre-wrap text-foreground/80">
            <NoteText text={note.quote} />
          </blockquote>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="xs" onClick={props.onOpenSource}>
              <T>Open where it was said</T>
            </Button>
            {retired || !props.canChange || retiring ? null : (
              <Button variant="ghost-muted" size="xs" onClick={() => setRetiring(true)}>
                <T>No longer true</T>
              </Button>
            )}
          </div>
          {retiring ? (
            <form
              className="mt-2.5 flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                void props.onRetire(reason).then((failure) => {
                  setBusy(false);
                  setError(failure);
                  if (failure === null) setRetiring(false);
                });
              }}
            >
              <Input
                nativeInput
                autoFocus
                required
                minLength={3}
                aria-label={gt("Why this note no longer holds")}
                placeholder={gt("Why it no longer holds, so the bot knows")}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button type="submit" size="sm" disabled={busy}>
                <T>Mark it</T>
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setRetiring(false)}>
                <T>Cancel</T>
              </Button>
            </form>
          ) : null}
          {error === null ? null : (
            <p role="alert" className="mt-1.5 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}

function Charter(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly memory: BotMemory;
  readonly canChange: boolean;
  readonly refresh: () => void;
}) {
  const gt = useGT();
  const { memory } = props;
  const setCharter = useAtomCommand(botsEnvironment.setCharter, { reportFailure: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(false);

  const save = async (charter: string) => {
    setSaving(true);
    const result = await setCharter({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, charter },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result))
        setError(
          failureMessage(squashAtomCommandFailure(result), gt("The charter was not saved.")),
        );
      return;
    }
    setError(null);
    setDraft(null);
    props.refresh();
  };

  return (
    <section aria-label={gt("Charter")} className="order-1">
      <div className="flex h-7 items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">
          <T>Charter</T>
        </h2>
        {!props.canChange || draft !== null ? null : (
          <Button variant="ghost-muted" size="xs" onClick={() => setDraft(memory.charter)}>
            <T>Edit</T>
          </Button>
        )}
      </div>
      <p className="mb-2 text-xs leading-normal text-muted-foreground">
        <T>
          What it is for and how you want work done. It reads this at the start of every session,
          and may rewrite it when you tell it how you like things.
        </T>
      </p>
      {draft === null ? (
        <div className="rounded-xl border border-border/70 bg-card/40 px-3.5 py-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
          {memory.charter}
        </div>
      ) : (
        <>
          <Textarea
            autoFocus
            rows={Math.min(18, Math.max(4, draft.split("\n").length + 1))}
            aria-label={gt("Charter")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={saving || draft.trim() === "" || draft === memory.charter}
              onClick={() => void save(draft)}
            >
              <T>Save charter</T>
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
          </div>
        </>
      )}
      {error === null ? null : (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
      {memory.charterHistory.length === 0 ? null : (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={history}
            className={cn(QUIET_BUTTON, "flex items-center gap-1 text-xs text-muted-foreground")}
            onClick={() => setHistory(!history)}
          >
            <ChevronDownIcon aria-hidden className={cn("size-3.5", history && "rotate-180")} />
            {gt("{count, plural, one {{count} earlier version} other {{count} earlier versions}}", {
              count: memory.charterHistory.length,
            })}
          </button>
          {history ? (
            <ul className={cn(LIST, "mt-2")}>
              {memory.charterHistory.map((past) => (
                <li
                  key={past.replacedAt}
                  className="border-t border-border/70 px-3.5 py-2.5 first:border-t-0"
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      <T>
                        Replaced <RelativeTime timestamp={past.replacedAt} />
                      </T>
                    </span>
                    {props.canChange ? (
                      <Button variant="outline" size="xs" onClick={() => setDraft(past.charter)}>
                        <T>Restore</T>
                      </Button>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-4 text-xs leading-normal whitespace-pre-wrap text-foreground/80">
                    {past.charter}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
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
    <section aria-label={gt("How it remembers")} className="order-3 @4xl/memory:mt-7">
      <h2 className="flex h-7 items-center text-sm font-medium text-foreground">
        <T>How it remembers</T>
      </h2>
      <p className="text-xs leading-normal text-muted-foreground">
        <T>
          It reads back through your conversations on its own and writes down what should last. It
          also keeps every message, and searches them when you ask about something older.
        </T>
      </p>
      <p className="mt-2 text-xs leading-normal text-foreground/85">
        {last === undefined ? (
          gt("It has not read back yet.")
        ) : (
          <T>
            Last read back <RelativeTime timestamp={last.at} />.
          </T>
        )}{" "}
        {memory.unread === 0
          ? gt("Nothing new is waiting.")
          : gt(
              "{count, plural, one {{count} new message is waiting for the next read.} other {{count} new messages are waiting for the next read.}}",
              { count: memory.unread },
            )}
      </p>
      {memory.passes.length === 0 ? null : (
        <div className="mt-2">
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

function Notes(props: {
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
  const retireNote = useAtomCommand(botsEnvironment.retireNote, { reportFailure: false });
  const [search, setSearch] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const current = memory.notes.filter((note) => note.outdatedAt === null);
  const retired = memory.notes.filter((note) => note.outdatedAt !== null);
  const found = current.filter((note) => botNoteMatches(note, search));
  const foundRetired = retired.filter((note) => botNoteMatches(note, search));
  const days = groupBotNotesByDay(found);
  // The newest notes need no year; older years say theirs.
  const newestYear = days[0]?.day.slice(0, 4) ?? "";

  const from = (note: BotNote) =>
    note.source ??
    (note.threadId === props.threadId
      ? gt("This chat")
      : isBotThreadId(note.threadId)
        ? gt("A thread in this chat")
        : gt("A task it started"));
  const row = (note: BotNote, text: string) => (
    <NoteRow
      key={note.id}
      note={note}
      text={text}
      from={from(note)}
      canChange={props.canChange}
      onOpenSource={() =>
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(note.environmentId, note.threadId)),
          search: {},
        })
      }
      onRetire={async (reason) => {
        const result = await retireNote({
          environmentId: props.environmentId,
          input: { threadId: props.threadId, id: note.id, reason },
        });
        if (result._tag === "Failure")
          return isAtomCommandInterrupted(result)
            ? null
            : failureMessage(squashAtomCommandFailure(result), gt("The note was not changed."));
        props.refresh();
        return null;
      }}
    />
  );

  return (
    <section aria-label={gt("Notes")} className="order-2 min-w-0 flex-1 @4xl/memory:order-1">
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-sm font-medium text-foreground">
          <T>Notes</T>
          <span className="ms-1.5 font-normal text-muted-foreground">
            {search.trim() === ""
              ? current.length
              : gt("{found} of {total}", { found: found.length, total: current.length })}
          </span>
        </h2>
        {retired.length === 0 ? null : (
          <button
            type="button"
            aria-pressed={showRetired}
            className={cn(QUIET_BUTTON, "px-1 text-xs text-muted-foreground")}
            onClick={() => setShowRetired(!showRetired)}
          >
            {showRetired
              ? gt("Hide what is no longer true")
              : gt("Show {count} no longer true", { count: retired.length })}
          </button>
        )}
        {current.length + retired.length < 2 ? null : (
          <div className="ms-auto w-64 max-w-full">
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon aria-hidden className="size-3.5 text-muted-foreground" />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                size="sm"
                aria-label={gt("Search notes")}
                placeholder={gt("Search notes")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </InputGroup>
          </div>
        )}
      </div>

      {current.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          <T>
            No notes yet. It writes them itself after reading back through your conversations. To
            have it remember something, tell it in the chat.
          </T>
        </p>
      ) : days.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          <T>No note says that.</T>
        </p>
      ) : (
        days.map((group) => (
          <div key={group.day} className="mt-4">
            <h3 className="mb-1.5 text-xs text-muted-foreground">
              {group.day.startsWith(newestYear)
                ? formatDayShort(group.day, locale)
                : `${formatDayShort(group.day, locale)} ${group.day.slice(0, 4)}`}
            </h3>
            <ul className={LIST}>{group.notes.map((listed) => row(listed.note, listed.text))}</ul>
          </div>
        ))
      )}

      {!showRetired || foundRetired.length === 0 ? null : (
        <div className="mt-6">
          <h3 className="mb-1.5 text-xs text-muted-foreground">
            <T>No longer true</T>
          </h3>
          <ul className={LIST}>{foundRetired.map((note) => row(note, listBotNote(note).text))}</ul>
        </div>
      )}
    </section>
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
    <div className="@container/memory h-full min-h-0 overflow-y-auto overscroll-contain px-6 pb-10">
      {query.data === null ? (
        <p className="pt-4 text-sm text-muted-foreground">
          {query.error === null ? gt("Reading…") : gt("The bot's memory could not be read.")}
        </p>
      ) : (
        <div className="flex max-w-6xl flex-col gap-8 pt-3 @4xl/memory:flex-row @4xl/memory:items-start @4xl/memory:gap-10">
          {/* Stacked, the notes sit between the charter and how it remembers; wide, those two share a column. */}
          <aside className="contents @4xl/memory:order-2 @4xl/memory:block @4xl/memory:w-88 @4xl/memory:shrink-0">
            <Charter
              environmentId={props.environmentId}
              threadId={main}
              memory={query.data}
              canChange={canChange}
              refresh={query.refresh}
            />
            <Reading memory={query.data} />
          </aside>
          <Notes
            environmentId={props.environmentId}
            threadId={main}
            memory={query.data}
            canChange={canChange}
            refresh={query.refresh}
          />
        </div>
      )}
    </div>
  );
}
