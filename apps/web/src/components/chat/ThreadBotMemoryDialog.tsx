import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { BotMemory, BotNote, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";

import { botsEnvironment } from "../../state/bots";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
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
  const { note } = props;
  const [retiring, setRetiring] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const retired = note.outdatedAt !== null;
  return (
    <li className="border-border/65 border-t py-2.5 first:border-t-0">
      <p className={retired ? "text-muted-foreground text-sm line-through" : "text-sm"}>
        {note.text}
      </p>
      <blockquote className="mt-1 border-border border-s-2 ps-2 text-muted-foreground text-xs">
        {note.quote}
      </blockquote>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
        <span>
          <RelativeTime timestamp={note.createdAt} />
        </span>
        <Button variant="link" size="xs" onClick={props.onOpenSource}>
          {note.source ?? "This conversation"}
        </Button>
        {retired || !props.canChange || retiring ? null : (
          <Button variant="ghost-muted" size="xs" onClick={() => setRetiring(true)}>
            Retire
          </Button>
        )}
      </div>
      {retired ? (
        <p className="mt-1 text-muted-foreground text-xs">
          Retired <RelativeTime timestamp={note.outdatedAt ?? note.createdAt} />:{" "}
          {note.outdatedReason}
          {note.replacedBy === null ? "" : " A newer note replaced it."}
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
            aria-label="Why this note no longer holds"
            placeholder="Why it no longer holds"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy}>
            Retire
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setRetiring(false)}>
            Cancel
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
          failureMessage(squashAtomCommandFailure(result), "The charter was not saved."),
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
          Charter
        </h3>
        <p className="mt-0.5 mb-2 text-muted-foreground text-xs">
          What the bot is for and what you told it should hold. It reads this at the start of every
          session and may rewrite it; every earlier version is kept below.
        </p>
        <Textarea
          rows={6}
          aria-label="Charter"
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
              Save charter
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
              Discard
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
                    Replaced <RelativeTime timestamp={past.replacedAt} />
                  </span>
                  <span className="line-clamp-3 block whitespace-pre-wrap">{past.charter}</span>
                </span>
                {canChange ? (
                  <Button variant="outline" size="xs" onClick={() => setDraft(past.charter)}>
                    Restore
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
            Notes
          </h3>
          {retired.length === 0 ? null : (
            <Button
              variant="ghost-muted"
              size="xs"
              aria-pressed={showRetired}
              onClick={() => setShowRetired(!showRetired)}
            >
              {showRetired ? "Hide retired" : `Show ${retired.length} retired`}
            </Button>
          )}
        </div>
        <p className="mt-0.5 mb-1 text-muted-foreground text-xs">
          Kept by a background pass. Each rests on the passage shown under it; open its thread to
          read the rest.
        </p>
        {current.length === 0 && !showRetired ? (
          <p className="py-2 text-muted-foreground text-xs">No notes yet.</p>
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
                          "The note was not retired.",
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
          Reflection
        </h3>
        <p className="mt-0.5 text-muted-foreground text-xs">
          {lastPass === undefined ? (
            "No pass has run yet."
          ) : (
            <>
              Last pass <RelativeTime timestamp={lastPass.at} />.
            </>
          )}{" "}
          {memory.unread === 0
            ? "Everything copied has been read."
            : `${memory.unread} copied messages are waiting for the next pass.`}
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
                    Read {pass.messages} messages, added {pass.added}, retired {pass.retired}
                    {pass.rejected === 0 ? "" : `, threw out ${pass.rejected} without a source`}.
                  </>
                ) : (
                  <span className="text-destructive">Failed: {pass.error}</span>
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
            {query.data === null ? "Memory" : `${query.data.name}'s memory`}
          </DialogTitle>
          <DialogDescription>
            A bot also keeps its whole conversation and every message of its finished threads, and
            searches them when asked. This is what it carries into every session.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {query.data === null ? (
            <p className="text-muted-foreground text-sm">
              {query.error === null ? "Reading…" : "The bot's memory could not be read."}
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
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
