import s from "./space.module.css";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type {
  BotSummary,
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  ThreadId,
} from "@t3tools/contracts";
import { BOT_SPOKEN_PREFIX } from "@t3tools/shared/botShow";
import { resolveSpeechVocabulary } from "@t3tools/shared/speech";
import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import {
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
} from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useClientSettings } from "~/hooks/useSettings";
import { useStableCallback } from "~/hooks/useStableCallback";
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
import { leadActivity, replyParts, talkRows, type TalkRow } from "./spaceTalk.logic";

type StartedBot = BotSummary & { readonly threadId: ThreadId };

/** Whether replies are read aloud here, kept across visits. */
const VOICE_ON_KEY = "t3code:space-voice:v1";
const isVoiceSetupNeeded = Schema.is(VoiceSetupNeeded);
/** A reply was spoken to its end, or is not to be spoken at all. */
const ALL_SAID = Number.POSITIVE_INFINITY;
/** Older than this the conversation is in the bot's chat, a click away. */
const ROWS = 40;
/** A first paragraph longer than this is a report, not a line to set large. */
const HEADLINE_CHARS = 190;
const WAVE_BARS = 11;
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
  const [sent, setSent] = useState<{ readonly messageId: string; readonly text: string } | null>(
    null,
  );
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
  const { prepared, grantId, cloudProvider, cloudModel } = destination;
  const canListen = prepared !== null && grantId !== null;

  const rows = talkRows(items, bot.name, BOT_SPOKEN_PREFIX).slice(-ROWS);
  const replies = from === null ? [] : repliesToSay(items, from, BOT_SPOKEN_PREFIX);
  const delivered =
    sent !== null &&
    items.some(({ item }) => "messageId" in item && item.messageId === sent.messageId);
  const lastRow = rows.at(-1);
  const working = shell !== null && isThreadWorking(shell);
  const waiting = (sent !== null && !delivered) || heard === "writing";
  const mode: SpaceVoice["mode"] =
    saying !== null
      ? "speaking"
      : heard === "speaking"
        ? "hearing"
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

  const send = useStableCallback(async (text: string) => {
    if (shell === null) return;
    hush();
    setEngaged(true);
    const messageId = newMessageId();
    setSent({ messageId, text });
    setProblem(null);
    const result = await startTurn({
      environmentId,
      input: {
        threadId: bot.threadId,
        message: { messageId, role: "user", text: `${BOT_SPOKEN_PREFIX}${text}`, attachments: [] },
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        dispatchMode: "auto",
      },
    });
    if (result._tag !== "Failure") return;
    setSent(null);
    const error = squashAtomCommandFailure(result);
    setProblem({
      text:
        error instanceof Error
          ? error.message
          : gt("That did not reach {name}.", { name: bot.name }),
      setup: false,
    });
  });

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

  const guarded = voice.speaking;
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
      onSpeechStart: () => {
        setHeard("speaking");
        setProblem(null);
        hush();
      },
      onSpeechEnd: () => setHeard("writing"),
      onPartial: (text) => {
        setPartial(text);
        if (text === null) setHeard((now) => (now === "writing" ? null : now));
      },
      onUtterance: (text) => void send(text),
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
      setListening(false);
      setHeard(null);
      setPartial(null);
    };
  }, [micOn, prepared, grantId, cloudProvider, cloudModel, speechOptions, guarded, hush, send]);

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

  const pending =
    partial !== null && partial !== "" ? partial : sent !== null && !delivered ? sent.text : null;
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
      <div className={s.log}>
        <div className={s.logRows} aria-live="polite">
          {rows.map((row) => {
            switch (row.kind) {
              case "you":
                return (
                  <div key={row.id} className={`${s.row} ${s.isYou}`}>
                    <i className={s.mark} />
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
                  <div key={row.id} className={s.event} style={lit(props.light(row.bot))}>
                    {row.kind === "told" ? <ArrowRightIcon /> : <ArrowLeftIcon />}
                    <div>
                      {row.kind === "told"
                        ? gt("{name} asked", { name: bot.name })
                        : gt("Back to {name} from", { name: bot.name })}{" "}
                      <b>{row.bot}</b>
                      <q>{row.text}</q>
                    </div>
                  </div>
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
          {pending === null ? null : (
            <div className={`${s.row} ${s.isYou} ${s.isPending}`}>
              <i className={s.mark} />
              <p>{pending}</p>
            </div>
          )}
          {mode === "thinking" && lastRow?.kind !== "reply" ? (
            <p className={s.status}>
              {leadActivity(items) ?? gt("{name} is on it…", { name: bot.name })}
            </p>
          ) : null}
        </div>
      </div>
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
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
            placeholder={
              !ready
                ? gt("Reaching {name}…", { name: bot.name })
                : saying !== null
                  ? gt("Talk or type to cut in")
                  : micOn
                    ? gt("Say it, or type")
                    : gt("Type to {name}", { name: bot.name })
            }
            aria-label={gt("Message to {name}", { name: bot.name })}
          />
          {stoppable && draft.trim() === "" ? (
            <button
              type="button"
              className={`${s.act} ${s.isStop}`}
              aria-label={gt("Stop {name}", { name: bot.name })}
              onClick={stop}
            >
              <SquareIcon fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="submit"
              className={`${s.act} ${s.isSend}`}
              disabled={!ready || draft.trim() === ""}
              aria-label={gt("Send")}
            >
              <ArrowUpIcon />
            </button>
          )}
          <button
            type="button"
            className={voiceOn ? s.act : `${s.act} ${s.isOff}`}
            aria-pressed={voiceOn}
            aria-label={voiceOn ? gt("Stop reading replies aloud") : gt("Read replies aloud")}
            onClick={() => {
              hush();
              if (!voiceOn) setEngaged(true);
              setVoiceOn(!voiceOn);
            }}
          >
            {voiceOn ? <Volume2Icon /> : <VolumeXIcon />}
          </button>
        </div>
        <div className={s.under}>
          <span>{state}</span>
          <span className={s.grow} />
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
