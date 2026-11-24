import s from "./space.module.css";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import {
  MessageId,
  type BotSummary,
  type EnvironmentId,
  type OrchestrationV2ProjectedTurnItem,
  type ThreadId,
} from "@t3tools/contracts";
import { BOT_SPOKEN_PREFIX } from "@t3tools/shared/botShow";
import { resolveSpeechVocabulary } from "@t3tools/shared/speech";
import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  MicIcon,
  SquareIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useClientSettings } from "~/hooks/useSettings";
import { useStableCallback } from "~/hooks/useStableCallback";
import { observeResize } from "~/lib/observeResize";
import { newMessageId } from "~/lib/utils";
import { createSpeechVoice, isSpeechVoiceKept } from "~/speech/speechVoice";
import { useVoiceTranscriptionDestination } from "~/speech/useEnvironmentSpeechInput";
import { bindAudioGrant } from "~/speech/voiceConsent";
import { startVoiceListener, VoiceSetupNeeded } from "~/speech/voiceListener";
import { useQuietThreadShell } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import ChatMarkdown from "../../ChatMarkdown";
import { BotTaskStateLabel } from "../BotBlocks";
import { repliesToSay, spokenUnits, unitsToSay, type SpaceScreen } from "./botSpace.logic";
import type { BotSpaceScene, SpaceVoice } from "./BotSpaceScene";
import type { SpaceTask } from "./spaceBoards";
import {
  leadActivity,
  replyParts,
  talkRows,
  undelivered,
  type Outgoing,
  type TalkRow,
} from "./spaceTalk.logic";

type StartedBot = BotSummary & { readonly threadId: ThreadId };

/** Whether replies are read aloud here, kept across visits. */
const VOICE_ON_KEY = "t3code:space-voice:v1";
const isVoiceSetupNeeded = Schema.is(VoiceSetupNeeded);
/** A reply was spoken to its end, or is not to be spoken at all. */
const ALL_SAID = Number.POSITIVE_INFINITY;
/** How much of the bot's chat the conversation opens on; older is in the chat itself. */
const ROWS = 40;
/** A first paragraph longer than this is a report, not a line to set large. */
const HEADLINE_CHARS = 190;
const WAVE_BARS = 11;
/** Scrolled further up than this, the person is reading back and is left where they are. */
const AWAY_PX = 140;
const lit = (color: string) => ({ "--c": color }) as CSSProperties;

/** What of a reply is set large, and what is detail to read under it. */
function replyLayout(text: string, streaming: boolean) {
  const parts = replyParts(text, streaming);
  const units = spokenUnits(parts.headline, parts.headlineDone);
  if (units.join(" ").length <= HEADLINE_CHARS) return { ...parts, units };
  // A wall of text set large is unreadable: its first sentence leads and the rest follows.
  const lead = unitsToSay(units, false);
  const rest = units.slice(lead.length).join(" ");
  return {
    ...parts,
    units: lead,
    detail: [rest, parts.detail].filter((part) => part !== "").join("\n\n"),
  };
}

function Reply(props: {
  readonly row: Extract<TalkRow, { kind: "reply" }>;
  readonly latest: boolean;
  /** The piece the voice is on, when it is saying this reply. */
  readonly saying: string | null;
}) {
  const { units, detail } = replyLayout(props.row.text, props.row.streaming);
  const at = props.saying === null ? -1 : units.indexOf(props.saying);
  return (
    <div className={props.latest ? `${s.row} ${s.isReply}` : `${s.row} ${s.isReply} ${s.isOld}`}>
      <i className={s.mark} />
      <div>
        {units.length === 0 ? null : (
          <p className={s.said}>
            {units.map((unit, index) => (
              <span
                // oxlint-disable-next-line react/no-array-index-key -- a reply's sentences in order; they only ever grow at the end
                key={index}
                className={
                  at === -1 ? undefined : index === at ? s.isNow : index > at ? s.isNext : undefined
                }
              >
                {unit}{" "}
              </span>
            ))}
          </p>
        )}
        {detail === "" ? null : (
          <div className={s.more}>
            <ChatMarkdown text={detail} cwd={undefined} isStreaming={props.row.streaming} />
          </div>
        )}
      </div>
    </div>
  );
}

/** What the lead told another bot, or what that bot said back; long ones open on a click. */
function Between(props: {
  readonly row: Extract<TalkRow, { kind: "told" | "heard" }>;
  readonly lead: string;
  readonly color: string;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const { row } = props;
  return (
    <div className={s.event} style={lit(props.color)}>
      {row.kind === "told" ? <ArrowRightIcon /> : <ArrowLeftIcon />}
      <div>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {row.kind === "told"
            ? gt("{name} asked", { name: props.lead })
            : gt("Back to {name} from", { name: props.lead })}{" "}
          <b>{row.bot}</b>
        </button>
        <div className={open ? s.quote : `${s.quote} ${s.isShort}`}>
          <ChatMarkdown text={row.text} cwd={undefined} />
        </div>
      </div>
    </div>
  );
}

/**
 * Talking with the bot in the middle. What is said or typed goes to its chat as a message like
 * any other. The whole exchange stays readable here: what was asked, the answer and its detail,
 * the tasks it started, and what it and the other bots told each other.
 */
export function SpaceTalk(props: {
  readonly environmentId: EnvironmentId;
  readonly bot: StartedBot;
  /** The bot's chat, and where this visit starts in it; null until the chat is live. */
  readonly items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
  readonly from: number | null;
  readonly tasks: ReadonlyArray<SpaceTask>;
  readonly words: ReadonlyArray<string>;
  readonly light: (bot: string | null) => string;
  readonly scene: () => BotSpaceScene | null;
  readonly onShow: (screen: SpaceScreen | null) => void;
  /** Escape, when nothing here had a use for it. */
  readonly onEscape: () => void;
  /** The machine is out of reach for now. */
  readonly offline: boolean;
}) {
  const gt = useGT();
  const { environmentId, bot, items, from } = props;
  const shell = useQuietThreadShell(scopeThreadRef(environmentId, bot.threadId));
  const ready = from !== null;
  const destination = useVoiceTranscriptionDestination();
  const settings = useClientSettings();
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });

  const [voiceOn, setVoiceOn] = useLocalStorage(VOICE_ON_KEY, true, Schema.Boolean);
  const [micOn, setMicOn] = useState(false);
  const [listening, setListening] = useState(false);
  /** The person is speaking, or has paused and their words are still being written down. */
  const [heard, setHeard] = useState<"speaking" | "writing" | null>(null);
  const [partial, setPartial] = useState<string | null>(null);
  /** Words already written down, waiting for the rest of what is being said. */
  const [heldWords, setHeldWords] = useState("");
  const [outbox, setOutbox] = useState<ReadonlyArray<Outgoing>>([]);
  /** The person has scrolled up to read; the log is not dragged back down under them. */
  const [away, setAway] = useState(false);
  const [problem, setProblem] = useState<{
    readonly text: string;
    readonly setup: boolean;
  } | null>(null);
  const [draft, setDraft] = useState("");
  /** Whether this browser holds the voice already; null until that is known. */
  const [kept, setKept] = useState<boolean | null>(null);
  /** The person has talked or typed here, which is when a voice not yet held is fetched. */
  const [engaged, setEngaged] = useState(false);
  const [voice] = useState(createSpeechVoice);
  const voiceState = useSyncExternalStore(voice.subscribe, voice.state);
  const { saying } = voiceState;
  const said = useRef(new Map<string, number>());
  const level = useRef(0);
  const wave = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const logRows = useRef<HTMLDivElement>(null);
  /** The voice is paused because the person may be speaking, so its echo cannot be heard. */
  const holding = useRef(false);
  const { prepared, grantId, cloudProvider, cloudModel } = destination;
  const canListen = prepared !== null && grantId !== null;

  const everyRow = talkRows(items, bot.name, BOT_SPOKEN_PREFIX);
  // The log opens on its last rows and then only grows: a row dropped from the top while the
  // person reads further up would move everything under their eyes.
  const [firstRow, setFirstRow] = useState<string | null>(null);
  const firstAt = everyRow.findIndex((row) => row.id === firstRow);
  const rows = firstAt === -1 ? everyRow.slice(-ROWS) : everyRow.slice(firstAt);
  if (ready && firstAt === -1 && rows.length > 0) setFirstRow(rows[0]!.id);
  const replies = from === null ? [] : repliesToSay(items, from, BOT_SPOKEN_PREFIX);
  const unsent = undelivered(outbox, items);
  const lastRow = rows.at(-1);
  const working = shell !== null && isThreadWorking(shell);
  const waiting = unsent.some((message) => message.failed === null) || heard === "writing";
  const mode: SpaceVoice["mode"] =
    // The person first: while they speak the voice is held, though it still has things to say.
    heard === "speaking"
      ? "hearing"
      : saying !== null
        ? "speaking"
        : waiting || working
          ? "thinking"
          : listening
            ? "listening"
            : "off";

  /** Whatever the bot has not finished saying is dropped; a new reply is said from its start. */
  const hush = useStableCallback(() => {
    voice.stop();
    for (const reply of replies) said.current.set(reply.messageId, ALL_SAID);
  });

  const deliver = useStableCallback(async ({ messageId, text }: Outgoing) => {
    const fail = (reason: string) =>
      setOutbox((now) =>
        now.map((message) =>
          message.messageId === messageId ? { ...message, failed: reason } : message,
        ),
      );
    if (shell === null) return fail(gt("{name}'s chat is not reachable yet.", { name: bot.name }));
    const result = await startTurn({
      environmentId,
      input: {
        threadId: bot.threadId,
        message: {
          messageId: MessageId.make(messageId),
          role: "user",
          text: `${BOT_SPOKEN_PREFIX}${text}`,
          attachments: [],
        },
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        dispatchMode: "auto",
      },
    });
    if (result._tag !== "Failure") return;
    const error = squashAtomCommandFailure(result);
    fail(
      error instanceof Error ? error.message : gt("That did not reach {name}.", { name: bot.name }),
    );
  });
  /**
   * Sends one more message. It never waits for the one before and never stops what the bot is
   * doing or saying: a bot at work takes it in at its next step.
   */
  const send = useStableCallback((text: string) => {
    setEngaged(true);
    setProblem(null);
    const message = { messageId: newMessageId(), text, failed: null, waits: props.offline };
    setOutbox((now) => [...undelivered(now, items), message]);
    if (!props.offline) void deliver(message);
  });
  /** What was written while the machine was out of reach goes now, in the order it was written. */
  const sendWaiting = useStableCallback(() => {
    const waitingNow = outbox.filter((message) => message.waits);
    if (waitingNow.length === 0) return;
    setOutbox((now) =>
      now.map((message) => (message.waits ? { ...message, waits: false } : message)),
    );
    for (const message of waitingNow) void deliver(message);
  });
  const { offline } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the connection to the machine is outside React; when it returns, what waited for it is sent
  useEffect(() => {
    if (!offline) sendWaiting();
  }, [offline, sendWaiting]);
  const discard = (message: Outgoing) =>
    setOutbox((now) => now.filter((other) => other.messageId !== message.messageId));

  /** Silences the bot, and stops the turn it is in. */
  const stop = useStableCallback(() => {
    hush();
    if (working) void interruptTurn({ environmentId, input: { threadId: bot.threadId } });
  });

  const toggleMic = useStableCallback(() => {
    if (!ready) return;
    setProblem(
      micOn || canListen
        ? null
        : { text: gt("Choose where your voice is written down first."), setup: true },
    );
    if (!micOn && !canListen) return;
    setEngaged(true);
    setMicOn(!micOn);
  });

  /** Read when listening starts; changing a speech setting does not restart it. */
  const speechOptions = useStableCallback(() => ({
    speechLanguage: settings.speechLanguage,
    speechTranslateToEnglish: settings.speechTranslateToEnglish,
    speechCustomWords: resolveSpeechVocabulary({
      personal: settings.speechCustomWords,
      project: [],
      hints: props.words,
    }),
    speechRemoveFillerWords: settings.speechRemoveFillerWords,
    speechSilenceFiltering: settings.speechSilenceFiltering,
  }));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the browser's cache, which is outside React, whether it holds the voice
  useEffect(() => {
    let closed = false;
    void isSpeechVoiceKept().then((value) => {
      if (!closed) setKept(value);
    });
    return () => {
      closed = true;
    };
  }, []);

  // A voice this browser holds starts with the page; one that must be fetched waits to be wanted.
  // Once started it stays for the visit, so turning replies off and on does not load it again.
  const [wantVoice, setWantVoice] = useState(false);
  if (!wantVoice && voiceOn && kept !== null && (kept || engaged)) setWantVoice(true);
  const keptNow = useStableCallback(() => kept === true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the voice is a worker and an audio output held for as long as this page wants one, so talking again does not load it again
  useEffect(() => {
    if (!wantVoice) return;
    // Read once: a download that ends flips `kept` and must not start the voice over.
    voice.load(keptNow());
    return voice.unload;
  }, [wantVoice, voice, keptNow]);

  const loaded = voiceState.load.step === "ready";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- once a first download ends, asks the browser to keep it and learns whether it did
  useEffect(() => {
    if (!loaded || kept !== false) return;
    let closed = false;
    void (async () => {
      await navigator.storage?.persist?.().catch(() => false);
      const value = await isSpeechVoiceKept();
      if (!closed && value) setKept(true);
    })();
    return () => {
      closed = true;
    };
  }, [loaded, kept]);

  const guarded = useStableCallback(() => voice.speaking() && !holding.current);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the microphone is a browser resource held only while listening is on
  useEffect(() => {
    if (!micOn || prepared === null || grantId === null) return;
    const abort = new AbortController();
    const heights = Array.from({ length: WAVE_BARS }, () => 4);
    const failed = (error: unknown) => {
      if (abort.signal.aborted) return;
      setProblem({
        text: error instanceof Error ? error.message : String(error),
        setup: isVoiceSetupNeeded(error),
      });
      setHeard(null);
    };
    startVoiceListener({
      prepared,
      cloudProvider,
      cloudModel,
      canSend: bindAudioGrant(grantId),
      options: speechOptions(),
      signal: abort.signal,
      isGuarded: guarded,
      onLevel: (value) => {
        level.current = value;
        // The bars follow the microphone twenty times a second, too often to render through React.
        heights.shift();
        heights.push(4 + Math.round(Math.min(1, value * 3) * 24));
        wave.current?.childNodes.forEach((bar, index) => {
          (bar as HTMLElement).style.height = `${heights[index]}px`;
        });
      },
      // A sound is not yet words: the voice waits mid-sentence and is only cut off by words.
      onSpeechStart: () => {
        setHeard("speaking");
        setProblem(null);
        holding.current = true;
        voice.hold();
      },
      onSpeechEnd: () => setHeard((now) => (now === "speaking" ? "writing" : now)),
      onPartial: setPartial,
      onHeld: setHeldWords,
      onUtterance: (text) => {
        setHeard(null);
        holding.current = false;
        hush();
        void send(text);
      },
      onNothing: () => {
        setHeard(null);
        holding.current = false;
        voice.resume();
      },
      onError: failed,
    }).then(
      () => setListening(!abort.signal.aborted),
      (error: unknown) => {
        failed(error);
        // Listening that could not start is off, not on and silently deaf.
        if (!abort.signal.aborted) setMicOn(false);
      },
    );
    return () => {
      abort.abort();
      level.current = 0;
      holding.current = false;
      voice.resume();
      setListening(false);
      setHeard(null);
      setPartial(null);
      setHeldWords("");
    };
  }, [
    micOn,
    prepared,
    grantId,
    cloudProvider,
    cloudModel,
    speechOptions,
    guarded,
    hush,
    send,
    voice,
  ]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the rows being read where they are while new ones arrive below; a reversed column would otherwise slide them up
  useEffect(() => {
    const rowsElement = logRows.current;
    if (rowsElement === null) return;
    let height = rowsElement.offsetHeight;
    return observeResize(rowsElement, () => {
      const grown = rowsElement.offsetHeight - height;
      height = rowsElement.offsetHeight;
      const scroller = log.current;
      if (scroller !== null && scroller.scrollTop < -AWAY_PX) scroller.scrollTop -= grown;
    });
  }, []);

  // A reply that came while the voice was being downloaded is read, not said late.
  const speaks =
    voiceOn && (voiceState.load.step === "starting" || voiceState.load.step === "ready");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands each newly written sentence of a reply to the voice, which is outside React
  useEffect(() => {
    for (const reply of replies) {
      if (!speaks) {
        said.current.set(reply.messageId, ALL_SAID);
        continue;
      }
      // An answer is said as far as its first paragraph; the detail under it is for the eye.
      const parts = replyParts(reply.text, reply.streaming);
      const units = unitsToSay(spokenUnits(parts.headline, parts.headlineDone), reply.asked);
      const before = said.current.get(reply.messageId) ?? 0;
      for (const unit of units.slice(before)) voice.say(unit);
      if (units.length > before) said.current.set(reply.messageId, units.length);
    }
  });

  const modeRef = useRef(mode);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the scene reads the conversation's state once a frame instead of React rendering per frame
  useEffect(() => {
    modeRef.current = mode;
    const scene = props.scene();
    if (scene === null) return;
    scene.voiceSource = () => ({
      mode: modeRef.current,
      level: modeRef.current === "speaking" ? voice.level() : level.current,
    });
    scene.refresh();
  });

  const escape = useStableCallback(() => {
    if (saying !== null || voice.speaking()) hush();
    else props.onEscape();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keys for the whole view come from the window, whatever holds the focus
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(event.target.tagName));
      if (event.key === "Escape") {
        event.preventDefault();
        escape();
      } else if (event.key === " " && !typing) {
        event.preventDefault();
        toggleMic();
      } else if (event.key === "/" && !typing) {
        event.preventDefault();
        field.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escape, toggleMic]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "" || !ready) return;
    setDraft("");
    if (field.current !== null) field.current.style.height = "";
    void send(text);
  };

  const hearingWords = [heldWords, partial ?? ""].filter((part) => part !== "").join(" ");
  const hearing = hearingWords !== "" ? hearingWords : heard !== null ? "…" : null;
  /** A click on a control of the bar leaves the cursor in the field, ready for the next message. */
  const keepFocus = (event: ReactMouseEvent) => event.preventDefault();
  const lastReplyId = rows.findLast((row) => row.kind === "reply")?.id;
  const color = props.light(bot.name);
  const load = voiceOn ? voiceState.load : null;
  const state =
    voiceState.error !== null
      ? gt("The voice could not speak: {reason}", { reason: voiceState.error })
      : load?.step === "downloading"
        ? load.total === 0
          ? gt("Downloading the voice, once…")
          : gt("Downloading the voice, once: {loaded} of {total} MB", {
              loaded: Math.round(load.loaded / 1e6),
              total: Math.round(load.total / 1e6),
            })
        : load?.step === "starting"
          ? gt("Starting the voice…")
          : heard === "speaking"
            ? gt("Hearing you")
            : heard === "writing"
              ? gt("Writing that down…")
              : listening
                ? gt("Listening")
                : micOn
                  ? gt("Opening the microphone…")
                  : voiceOn && loaded && kept === false
                    ? gt("This browser did not keep the voice, so it downloads again next time.")
                    : gt("Microphone off");
  const stoppable = saying !== null || working;
  const taskOf = (threadId: ThreadId) =>
    props.tasks.find((task) => task.thread.threadId === threadId);
  const shownLabel = (screen: SpaceScreen) =>
    screen.kind === "file"
      ? screen.file
      : screen.kind === "board"
        ? gt("{name}'s open work", { name: screen.bot })
        : (taskOf(screen.threadId)?.thread.title ?? gt("A task"));

  return (
    <section className={s.talk} style={lit(color)}>
      <div
        ref={log}
        className={s.log}
        onScroll={(event) => setAway(event.currentTarget.scrollTop < -AWAY_PX)}
      >
        <div ref={logRows} className={s.logRows} aria-live="polite">
          {rows.map((row) => {
            switch (row.kind) {
              case "you":
                return (
                  <div key={row.id} className={`${s.row} ${s.isYou}`}>
                    <p>{row.text}</p>
                  </div>
                );
              case "reply":
                return (
                  <Reply
                    key={row.id}
                    row={row}
                    latest={row.id === lastReplyId}
                    saying={row.id === lastReplyId ? saying : null}
                  />
                );
              case "told":
              case "heard":
                return (
                  <Between key={row.id} row={row} lead={bot.name} color={props.light(row.bot)} />
                );
              case "task": {
                const task = taskOf(row.threadId);
                return (
                  <div key={row.id} className={s.event}>
                    <span />
                    <div>
                      <button
                        type="button"
                        className={s.chip}
                        style={lit(props.light(task?.bot ?? bot.name))}
                        onClick={() =>
                          props.onShow({
                            kind: "task",
                            bot: task?.bot ?? bot.name,
                            environmentId: row.environmentId,
                            threadId: row.threadId,
                          })
                        }
                      >
                        <i />
                        <span>{task?.thread.title ?? row.title}</span>
                        {task === undefined ? null : (
                          <em className={s.num}>
                            <BotTaskStateLabel thread={task.thread} />
                          </em>
                        )}
                      </button>
                    </div>
                  </div>
                );
              }
              case "shown":
                return (
                  <div key={row.id} className={s.event}>
                    <span />
                    <div>
                      <button
                        type="button"
                        className={s.chip}
                        style={lit(props.light(row.screen.bot))}
                        onClick={() => props.onShow(row.screen)}
                      >
                        <i />
                        <span>{shownLabel(row.screen)}</span>
                        <em>{gt("On screen")}</em>
                      </button>
                    </div>
                  </div>
                );
              default:
                return null;
            }
          })}
          {unsent.map((message) => (
            <div
              key={message.messageId}
              className={`${s.row} ${s.isYou} ${message.failed === null ? s.isPending : s.isFailed}`}
            >
              <p>{message.text}</p>
              {message.failed === null ? (
                <small>
                  {message.waits
                    ? gt("Goes when the connection is back")
                    : working
                      ? gt("{name} reads this at its next step", { name: bot.name })
                      : gt("Sending…")}
                </small>
              ) : (
                <small role="alert">
                  {gt("Not sent: {reason}", { reason: message.failed })}{" "}
                  <button
                    type="button"
                    onClick={() => {
                      discard(message);
                      void send(message.text);
                    }}
                  >
                    {gt("Try again")}
                  </button>
                  <button type="button" onClick={() => discard(message)}>
                    {gt("Discard")}
                  </button>
                </small>
              )}
            </div>
          ))}
          {hearing === null ? null : (
            <div className={`${s.row} ${s.isYou} ${s.isHearing}`}>
              <p>{hearing}</p>
            </div>
          )}
          {mode === "thinking" && lastRow?.kind !== "reply" ? (
            <p className={s.status}>
              <span aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {leadActivity(items) ?? gt("{name} is on it…", { name: bot.name })}
            </p>
          ) : null}
        </div>
      </div>
      {away ? (
        <button
          type="button"
          className={s.latest}
          onClick={() => log.current?.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <ArrowDownIcon />
          {gt("Latest")}
        </button>
      ) : null}
      {problem === null ? null : (
        <p role="alert" className={s.alert}>
          {problem.text}{" "}
          {problem.setup ? <Link to="/settings/voice">{gt("Open Voice settings")}</Link> : null}
        </p>
      )}
      <form className={s.dock} onSubmit={submit}>
        <div className={heard === "speaking" ? `${s.bar} ${s.isHot}` : s.bar}>
          <button
            type="button"
            className={micOn ? `${s.mic} ${s.isOn}` : s.mic}
            aria-pressed={micOn}
            disabled={!ready}
            aria-label={micOn ? gt("Stop listening") : gt("Talk with {name}", { name: bot.name })}
            onMouseDown={keepFocus}
            onClick={toggleMic}
          >
            <MicIcon />
          </button>
          {micOn ? (
            <div ref={wave} className={s.wave} aria-hidden>
              {Array.from({ length: WAVE_BARS }, (_, index) => (
                <i key={index} />
              ))}
            </div>
          ) : null}
          <textarea
            ref={field}
            className={s.field}
            rows={1}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              // Grows with what is typed, up to the height its style allows.
              event.target.style.height = "";
              event.target.style.height = `${event.target.scrollHeight}px`;
            }}
            onKeyDown={(event) => {
              // A message never starts with a space, so on an empty field Space is the microphone.
              if (event.key === " " && draft === "" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                toggleMic();
                return;
              }
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
            placeholder={
              !ready
                ? gt("Reaching {name}…", { name: bot.name })
                : working
                  ? gt("Add to it, or ask more")
                  : micOn
                    ? gt("Say it, or type")
                    : gt("Message {name}", { name: bot.name })
            }
            aria-label={gt("Message to {name}", { name: bot.name })}
          />
          {/* Stop has a place of its own: Send never turns into it under the cursor. */}
          {stoppable ? (
            <button
              type="button"
              className={`${s.act} ${s.isStop}`}
              aria-label={gt("Stop {name}", { name: bot.name })}
              onMouseDown={keepFocus}
              onClick={stop}
            >
              <SquareIcon fill="currentColor" strokeWidth={0} />
            </button>
          ) : null}
          <button
            type="submit"
            className={`${s.act} ${s.isSend}`}
            disabled={!ready || draft.trim() === ""}
            aria-label={gt("Send")}
            onMouseDown={keepFocus}
          >
            <ArrowUpIcon />
          </button>
        </div>
        <div className={s.under}>
          <span>{state}</span>
          <span className={s.grow} />
          <button
            type="button"
            className={voiceOn ? s.voice : `${s.voice} ${s.isOff}`}
            aria-pressed={voiceOn}
            aria-label={voiceOn ? gt("Stop reading replies aloud") : gt("Read replies aloud")}
            onMouseDown={keepFocus}
            onClick={() => {
              hush();
              if (!voiceOn) setEngaged(true);
              setVoiceOn(!voiceOn);
            }}
          >
            {voiceOn ? <Volume2Icon /> : <VolumeXIcon />}
            {voiceOn ? gt("Voice on") : gt("Voice off")}
          </button>
          {saying !== null ? (
            <span>
              <kbd>Esc</kbd> {gt("quiets {name}", { name: bot.name })}
            </span>
          ) : (
            <span>
              <kbd>{gt("Space")}</kbd> {micOn ? gt("stops listening") : gt("to talk")}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
