import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { BotMemory, BotNote, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT, Var } from "gt-react";
import { useId, useState } from "react";

import { botsEnvironment } from "../../state/bots";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { cn } from "~/lib/utils";

import { RelativeTime } from "../RelativeTime";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

const failureMessage = (failure: unknown, fallback: string) =>
  failure instanceof Error && failure.message.trim() !== "" ? failure.message : fallback;

function NoteRow(props: {
  readonly note: BotNote;
  readonly canChange: boolean;
  readonly onOpenSource: () => void;
  readonly onRetire: (reason: string) => Promise<string | null>;
}) {
  const gt = useGT();
  const { note } = props;
  const [retiring, setRetiring] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wholeQuote, setWholeQuote] = useState(false);
  const retired = note.outdatedAt !== null;
  return (
    <li className="border-border/65 border-t py-3 first:border-t-0">
      <p
        className={
          retired ? "text-muted-foreground text-sm line-through" : "text-sm leading-relaxed"
        }
      >
        {note.text}
      </p>
      <blockquote className="mt-1.5 border-border border-s-2 ps-2 text-muted-foreground text-xs">
        <button
          type="button"
          aria-expanded={wholeQuote}
          aria-label={wholeQuote ? gt("Show less of the passage") : gt("Show the whole passage")}
          className={cn(
            "block w-full cursor-pointer rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            wholeQuote ? "" : "line-clamp-2",
          )}
          onClick={() => setWholeQuote(!wholeQuote)}
        >
          {note.quote}
        </button>
      </blockquote>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
        <span>
          <RelativeTime timestamp={note.createdAt} />
        </span>
        <Button variant="link" size="xs" onClick={props.onOpenSource}>
          {note.source ?? gt("This conversation")}
        </Button>
        {retired || !props.canChange || retiring ? null : (
          <Button variant="ghost-muted" size="xs" onClick={() => setRetiring(true)}>
            <T>Retire</T>
          </Button>
        )}
      </div>
      {retired ? (
        <p className="mt-1 text-muted-foreground text-xs">
          <T>
            Retired <RelativeTime timestamp={note.outdatedAt ?? note.createdAt} />:
          </T>{" "}
          {note.outdatedReason}
          {note.replacedBy === null ? "" : ` ${gt("A newer note replaced it.")}`}
        </p>
      ) : null}
      {retiring ? (
        <form
          className="mt-2 flex items-center gap-2"
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
            placeholder={gt("Why it no longer holds")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy}>
            <T>Retire</T>
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setRetiring(false)}>
            <T>Cancel</T>
          </Button>
        </form>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="mt-1 text-destructive text-xs">
          {error}
        </p>
      )}
    </li>
  );
}

function MemoryBody(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly memory: BotMemory;
  readonly refresh: () => void;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const { memory } = props;
  const id = useId();
  const navigate = useNavigate();
  const canChange = useAtomValue(botsEnvironment.setCharter.permissionAtom(props.environmentId));
  const setCharter = useAtomCommand(botsEnvironment.setCharter, { reportFailure: false });
  const retireNote = useAtomCommand(botsEnvironment.retireNote, { reportFailure: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [charterError, setCharterError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const charter = draft ?? memory.charter;
  const current = memory.notes.filter((note) => note.outdatedAt === null);
  const retired = memory.notes.filter((note) => note.outdatedAt !== null);
  const lastPass = memory.passes[0];

  const saveCharter = async () => {
    setSaving(true);
    const result = await setCharter({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, charter },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result))
        setCharterError(
          failureMessage(squashAtomCommandFailure(result), gt("The charter was not saved.")),
        );
      return;
    }
    setCharterError(null);
    setDraft(null);
    props.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={`${id}-charter`}>
        <h3 id={`${id}-charter`} className="font-medium text-sm">
          <T>Charter</T>
        </h3>
        <p className="mt-0.5 mb-2 text-muted-foreground text-xs">
          <T>
            What the bot is for and what you told it should hold. It reads this at the start of
            every session and may rewrite it; every earlier version is kept below.
          </T>
        </p>
        <Textarea
          rows={Math.min(12, Math.max(3, charter.split("\n").length + 1))}
          aria-label={gt("Charter")}
          readOnly={!canChange}
          value={charter}
          onChange={(event) => setDraft(event.target.value)}
        />
        {charterError === null ? null : (
          <p role="alert" className="mt-1 text-destructive text-xs">
            {charterError}
          </p>
        )}
        {draft === null || draft === memory.charter ? null : (
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={saving || charter.trim() === ""} onClick={saveCharter}>
              <T>Save charter</T>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
              <T>Discard</T>
            </Button>
          </div>
        )}
        {memory.charterHistory.length === 0 ? null : (
          <ul className="mt-2">
            {memory.charterHistory.map((past) => (
              <li
                key={past.replacedAt}
                className="flex items-start gap-2 border-border/65 border-t py-2 text-xs"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-muted-foreground">
                    <T>
                      Replaced <RelativeTime timestamp={past.replacedAt} />
                    </T>
                  </span>
                  <span className="line-clamp-3 block whitespace-pre-wrap">{past.charter}</span>
                </span>
                {canChange ? (
                  <Button variant="outline" size="xs" onClick={() => setDraft(past.charter)}>
                    <T>Restore</T>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${id}-notes`}>
        <div className="flex items-center justify-between gap-2">
          <h3 id={`${id}-notes`} className="font-medium text-sm">
            <T>Notes</T>
            <span className="ms-1.5 font-normal text-muted-foreground">{current.length}</span>
          </h3>
          {retired.length === 0 ? null : (
            <Button
              variant="ghost-muted"
              size="xs"
              aria-pressed={showRetired}
              onClick={() => setShowRetired(!showRetired)}
            >
              {showRetired
                ? gt("Hide retired")
                : gt("Show {count} retired", { count: retired.length })}
            </Button>
          )}
        </div>
        <p className="mt-0.5 mb-1 text-muted-foreground text-xs">
          <T>
            Kept by a background pass. Each rests on the passage shown under it; open its thread to
            read the rest.
          </T>
        </p>
        {current.length === 0 && !showRetired ? (
          <p className="py-2 text-muted-foreground text-xs">
            <T>No notes yet.</T>
          </p>
        ) : (
          <ul>
            {[...current, ...(showRetired ? retired : [])].map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                canChange={canChange}
                onOpenSource={() => {
                  props.onClose();
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: buildThreadRouteParams(
                      scopeThreadRef(note.environmentId, note.threadId),
                    ),
                  });
                }}
                onRetire={async (reason) => {
                  const result = await retireNote({
                    environmentId: props.environmentId,
                    input: { threadId: props.threadId, id: note.id, reason },
                  });
                  if (result._tag === "Failure")
                    return isAtomCommandInterrupted(result)
                      ? null
                      : failureMessage(
                          squashAtomCommandFailure(result),
                          gt("The note was not retired."),
                        );
                  props.refresh();
                  return null;
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${id}-passes`}>
        <h3 id={`${id}-passes`} className="font-medium text-sm">
          <T>Reflection</T>
        </h3>
        <p className="mt-0.5 text-muted-foreground text-xs">
          {lastPass === undefined ? (
            gt("No pass has run yet.")
          ) : (
            <>
              <T>
                Last pass <RelativeTime timestamp={lastPass.at} />.
              </T>
            </>
          )}{" "}
          {memory.unread === 0
            ? gt("Everything copied has been read.")
            : gt("{count} copied messages are waiting for the next pass.", {
                count: memory.unread,
              })}
        </p>
        {memory.passes.length === 0 ? null : (
          <ul className="mt-1">
            {memory.passes.map((pass) => (
              <li key={pass.at} className="border-border/65 border-t py-1.5 text-xs">
                <span className="text-muted-foreground">
                  <RelativeTime timestamp={pass.at} />
                </span>{" "}
                {pass.error === null ? (
                  <>
                    {pass.rejected === 0
                      ? gt("Read {messages} messages, added {added}, retired {retired}.", {
                          messages: pass.messages,
                          added: pass.added,
                          retired: pass.retired,
                        })
                      : gt(
                          "Read {messages} messages, added {added}, retired {retired}, threw out {rejected} without a source.",
                          {
                            messages: pass.messages,
                            added: pass.added,
                            retired: pass.retired,
                            rejected: pass.rejected,
                          },
                        )}
                  </>
                ) : (
                  <span className="text-destructive">
                    <T>
                      Failed: <Var>{pass.error}</Var>
                    </T>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** What a bot keeps, for the person it works for to read and correct. */
export function ThreadBotMemoryDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const gt = useGT();
  const query = useEnvironmentQuery(
    props.open
      ? botsEnvironment.memory({
          environmentId: props.environmentId,
          input: { threadId: props.threadId },
        })
      : null,
  );
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {query.data === null ? gt("Memory") : gt("{name}''s memory", { name: query.data.name })}
          </DialogTitle>
          <DialogDescription>
            <T>
              A bot also keeps its whole conversation and every message of its finished threads, and
              searches them when asked. This is what it carries into every session.
            </T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {query.data === null ? (
            <p className="text-muted-foreground text-sm">
              {query.error === null ? gt("Reading…") : gt("The bot's memory could not be read.")}
            </p>
          ) : (
            <MemoryBody
              environmentId={props.environmentId}
              threadId={props.threadId}
              memory={query.data}
              refresh={query.refresh}
              onClose={() => props.onOpenChange(false)}
            />
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            <T>Close</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
