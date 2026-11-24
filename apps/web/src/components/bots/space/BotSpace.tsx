import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type {
  BotBoardThread,
  BotSummary,
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  ThreadId,
} from "@t3tools/contracts";
import { BOT_SPOKEN_PREFIX } from "@t3tools/shared/botShow";
import { resolveSpeechVocabulary } from "@t3tools/shared/speech";
import { Link } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import * as Schema from "effect/Schema";
import { ArrowUpIcon, MicIcon, MicOffIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useClientSettings } from "~/hooks/useSettings";
import { useStableCallback } from "~/hooks/useStableCallback";
import { cn, newMessageId } from "~/lib/utils";
import { createSpeechVoice, isSpeechVoiceKept } from "~/speech/speechVoice";
import { useVoiceTranscriptionDestination } from "~/speech/useEnvironmentSpeechInput";
import { bindAudioGrant } from "~/speech/voiceConsent";
import { startVoiceListener, VoiceSetupNeeded } from "~/speech/voiceListener";
import { botsEnvironment } from "~/state/bots";
import {
  useQuietThreadShell,
  useQuietThreadShells,
  useThreadStatus,
  useThreadVisibleTurnItems,
} from "~/state/entities";
import {
  useConnectedEnvironmentIds,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { resolveBotHome } from "../../sidebar/SidebarBots.logic";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { SidebarInset } from "../../ui/sidebar";
import { BotStateIcon, BotTaskStateLabel } from "../BotBlocks";
import { sortBotTasks } from "../botBoard.logic";
import { botColorName } from "../botLook";
import { isBotThreadId } from "../botView";
import { useBotBoard } from "../useBot";
import {
  lastLedScreen,
  placeBotStars,
  repliesToSay,
  spokenUnits,
  unitsToSay,
  type BotStarPlace,
  type SpaceScreen,
} from "./botSpace.logic";
import { SpaceScreenPane } from "./BotSpaceScreens";
import type { BotSpaceScene, SpaceStar, SpaceVoice, StarOnScreen } from "./BotSpaceScene";

/** The light each of a bot's colours gives off against black. */
const STAR_LIGHT: Readonly<Record<string, string>> = {
  slate: "#cbd5e1",
  blue: "#60a5fa",
  teal: "#2dd4bf",
  green: "#34d399",
  amber: "#fbbf24",
  red: "#f87171",
  pink: "#f472b6",
  violet: "#a78bfa",
};

/** Tells the bot its reply will be read aloud; BOT_RULES says what to do with it. */
const SPOKEN = BOT_SPOKEN_PREFIX;
/** Whether replies are read aloud here, kept across visits. */
const VOICE_ON_KEY = "t3code:space-voice:v1";
const isVoiceSetupNeeded = Schema.is(VoiceSetupNeeded);
const OFF_LOAD = { step: "off" } as const;
/** More than this many tasks under a bot crowd the ones beside it. */
const TASKS_UNDER_A_BOT = 3;

type StartedBot = BotSummary & { readonly threadId: ThreadId };

/** The light a bot gives off; a screen that is no bot's is plain white light. */
const starLight = (bot: StartedBot | null) =>
  (bot === null ? undefined : STAR_LIGHT[botColorName(bot.name, bot.look)]) ?? STAR_LIGHT.slate!;

function BotStar(props: {
  readonly environmentId: EnvironmentId;
  readonly bot: StartedBot;
  readonly place: BotStarPlace;
  readonly centre: boolean;
  readonly selected: boolean;
  readonly register: (id: string, star: SpaceStar | null) => void;
  readonly label: (id: string, element: HTMLElement | null) => void;
  readonly onSelect: () => void;
  readonly onShowTask: (thread: BotBoardThread) => void;
}) {
  const gt = useGT();
  const { bot, place, register } = props;
  const board = useBotBoard(props.environmentId, bot.threadId).data;
  const shell = useQuietThreadShell(scopeThreadRef(props.environmentId, bot.threadId));
  const tasks = [
    ...(board?.items.flatMap((item) => item.threads) ?? []),
    ...(board?.unfiled ?? []),
  ];
  // What it is doing now hangs under it: the tasks at work and the ones waiting on the person.
  const live = sortBotTasks(
    tasks.filter((task) => task.status === "working" || task.status === "needs-input"),
  );
  const working = live.filter((task) => task.status === "working").length;
  const waiting = bot.waitingOnYou + live.length - working;
  const busy = shell !== null && isThreadWorking(shell);
  const color = starLight(bot);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the three.js scene is outside React and draws this bot from these values
  useEffect(() => {
    register(bot.name, {
      id: bot.name,
      color,
      centre: props.centre,
      place,
      working,
      waiting,
      busy,
    });
  }, [register, bot.name, color, props.centre, place, working, waiting, busy]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- takes the bot out of the scene when it is no longer listed
  useEffect(() => () => register(bot.name, null), [register, bot.name]);

  const status =
    waiting > 0
      ? gt("Needs you")
      : working > 0
        ? gt("{count, plural, one {# task running} other {# tasks running}}", { count: working })
        : busy
          ? gt("Replying")
          : bot.openItems > 0
            ? gt("{count, plural, one {# thing open} other {# things open}}", {
                count: bot.openItems,
              })
            : gt("Quiet");

  return (
    <div
      ref={(element) => props.label(bot.name, element)}
      className="pointer-events-none absolute top-0 left-0 opacity-0"
    >
      <button
        type="button"
        aria-pressed={props.selected}
        onClick={props.onSelect}
        className={cn(
          "pointer-events-auto flex -translate-x-1/2 flex-col items-center rounded-md px-2 py-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-inset",
          props.selected ? "text-white" : "text-white/75 hover:text-white",
        )}
      >
        <span className={cn("font-medium", props.centre ? "text-base" : "text-sm")}>
          {bot.name}
        </span>
        <span className={cn("text-xs", waiting > 0 ? "text-warning" : "text-white/45")}>
          {status}
        </span>
      </button>
      {live.length === 0 ? null : (
        <ul
          className="pointer-events-auto mt-1 flex w-56 -translate-x-1/2 flex-col overflow-hidden rounded-lg border bg-black/70"
          style={{ borderColor: `${color}40`, boxShadow: `0 0 28px -12px ${color}` }}
        >
          {live.slice(0, TASKS_UNDER_A_BOT).map((task) => (
            <li key={`${task.environmentId}:${task.threadId}`}>
              <button
                type="button"
                onClick={() => props.onShowTask(task)}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-start text-xs outline-none hover:bg-white/8 focus-visible:bg-white/8"
              >
                <BotStateIcon status={task.status} className="size-3" />
                <span className="min-w-0 flex-1 truncate text-white/80">{task.title}</span>
                <span
                  className={cn(
                    "shrink-0",
                    task.status === "needs-input" ? "text-warning" : "text-white/40",
                  )}
                >
                  <BotTaskStateLabel thread={task} />
                </span>
              </button>
            </li>
          ))}
          {live.length <= TASKS_UNDER_A_BOT ? null : (
            <li className="px-2 py-1 text-white/40 text-xs">
              {gt("and {count} more", { count: live.length - TASKS_UNDER_A_BOT })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** A reply was spoken to its end, or is not to be spoken at all. */
const ALL_SAID = Number.POSITIVE_INFINITY;

/**
 * Talking with the bot in the middle. What is said or typed goes to its chat as a message like
 * any other. Its replies are captioned, and spoken a sentence at a time while they are written.
 */
function SpaceConversation(props: {
  readonly environmentId: EnvironmentId;
  readonly bot: StartedBot;
  /** The bot's chat, and where this visit starts in it; null until the chat is live. */
  readonly items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
  readonly from: number | null;
  readonly words: ReadonlyArray<string>;
  readonly scene: () => BotSpaceScene | null;
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
  const { prepared, grantId, cloudProvider, cloudModel } = destination;
  const canListen = prepared !== null && grantId !== null;

  const replies = from === null ? [] : repliesToSay(items, from, SPOKEN);
  const sentAt =
    sent === null
      ? -1
      : items.findIndex(({ item }) => "messageId" in item && item.messageId === sent.messageId);
  const answered =
    sent === null ||
    (sentAt !== -1 &&
      items
        .slice(sentAt + 1)
        .some(({ item }) => item.type === "assistant_message" && item.text.trim() !== ""));
  const working = shell !== null && isThreadWorking(shell);
  const mode: SpaceVoice["mode"] =
    saying !== null
      ? "speaking"
      : heard === "speaking"
        ? "hearing"
        : heard === "writing" || !answered || (working && sent !== null)
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
        message: { messageId, role: "user", text: `${SPOKEN}${text}`, attachments: [] },
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
      const units = unitsToSay(spokenUnits(reply.text, !reply.streaming), reply.asked);
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "" || !ready) return;
    setDraft("");
    void send(text);
  };

  const lastReply = replies.at(-1);
  // Heard a sentence at a time; with no voice the whole reply stays up to be read.
  const caption =
    saying ??
    (lastReply === undefined
      ? null
      : spokenUnits(lastReply.text, !lastReply.streaming).join(" ") || null);
  const load = voiceOn ? voiceState.load : OFF_LOAD;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-4 pb-6">
      <div
        aria-live="polite"
        className="flex min-h-16 w-full max-w-2xl flex-col items-center justify-end gap-1.5 text-center"
      >
        {partial !== null && partial !== "" ? (
          <p className="text-sm text-white/55">{partial}</p>
        ) : sent !== null && !answered ? (
          <p className="text-sm text-white/55">{sent.text}</p>
        ) : null}
        {caption === null || !answered || heard !== null ? null : (
          <p
            className={cn(
              "pointer-events-auto max-h-32 overflow-y-auto text-balance text-white",
              saying === null ? "text-base" : "text-lg",
            )}
          >
            {caption}
          </p>
        )}
        {partial === null && mode === "thinking" ? (
          <p className="text-sm text-white/45">{gt("{name} is on it…", { name: bot.name })}</p>
        ) : null}
      </div>
      {problem === null ? null : (
        <p role="alert" className="pointer-events-auto max-w-xl text-center text-sm text-warning">
          {problem.text}
          {problem.setup ? (
            <>
              {" "}
              <Link to="/settings/voice" className="text-white underline underline-offset-2">
                <T>Open Voice settings</T>
              </Link>
            </>
          ) : null}
        </p>
      )}
      {voiceState.error !== null ? (
        <p role="alert" className="max-w-xl text-center text-sm text-warning">
          {gt("The voice could not speak: {reason}", { reason: voiceState.error })}
        </p>
      ) : load.step === "downloading" ? (
        <p className="text-white/45 text-xs">
          {load.total === 0
            ? gt("Downloading the voice, once…")
            : gt("Downloading the voice, once: {loaded} of {total} MB", {
                loaded: Math.round(load.loaded / 1e6),
                total: Math.round(load.total / 1e6),
              })}
        </p>
      ) : load.step === "starting" ? (
        <p className="text-white/45 text-xs">
          <T>Starting the voice…</T>
        </p>
      ) : voiceOn && loaded && kept === false ? (
        <p className="text-white/45 text-xs">
          <T>This browser did not keep the voice, so it downloads again next time.</T>
        </p>
      ) : null}
      <form
        onSubmit={submit}
        className="pointer-events-auto flex w-full max-w-md items-center gap-2"
      >
        <Button
          type="button"
          variant={micOn ? "default" : "secondary"}
          size="icon"
          aria-pressed={micOn}
          disabled={!ready}
          aria-label={micOn ? gt("Stop listening") : gt("Talk with {name}", { name: bot.name })}
          onClick={() => {
            setProblem(
              micOn || canListen
                ? null
                : {
                    text: gt("Choose where your voice is written down first."),
                    setup: true,
                  },
            );
            if (!micOn && !canListen) return;
            setEngaged(true);
            setMicOn(!micOn);
          }}
        >
          {micOn ? <MicIcon /> : <MicOffIcon />}
        </Button>
        <Input
          nativeInput
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            !ready
              ? gt("Reaching {name}…", { name: bot.name })
              : listening
                ? gt("Speak, or type to {name}", { name: bot.name })
                : gt("Type to {name}", { name: bot.name })
          }
          aria-label={gt("Message to {name}", { name: bot.name })}
        />
        <Button
          type="submit"
          variant="secondary"
          size="icon"
          disabled={!ready}
          aria-label={gt("Send")}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          type="button"
          variant="ghost-muted"
          size="icon"
          aria-pressed={voiceOn}
          aria-label={voiceOn ? gt("Stop reading replies aloud") : gt("Read replies aloud")}
          onClick={() => {
            hush();
            if (!voiceOn) setEngaged(true);
            setVoiceOn(!voiceOn);
          }}
        >
          {voiceOn ? <Volume2Icon /> : <VolumeXIcon />}
        </Button>
      </form>
    </div>
  );
}

function SpaceOf(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const list = useEnvironmentQuery(botsEnvironment.list({ environmentId, input: {} }));
  const bots = (list.data?.bots ?? []).filter((bot): bot is StartedBot => bot.threadId !== null);
  const places = placeBotStars(bots);
  const centre = bots.find((bot) => bot.oversees) ?? bots[0] ?? null;
  const leadRef = centre === null ? null : scopeThreadRef(environmentId, centre.threadId);
  const leadItems = useThreadVisibleTurnItems(leadRef);
  // Until the chat is in step with its machine, an old reply would count as new and be read out.
  const leadLive = useThreadStatus(leadRef) === "live";
  /** This visit starts at this point of the lead's chat; what came before is not said or shown. */
  const [since, setSince] = useState<{ readonly lead: string; readonly position: number } | null>(
    null,
  );
  const from = centre !== null && since?.lead === centre.name ? since.position : null;
  if (centre !== null && leadLive && from === null)
    setSince({ lead: centre.name, position: leadItems.at(-1)?.position ?? -1 });
  // The screen follows what the lead looks at, until the person picks or closes one themselves.
  const led = centre === null || from === null ? null : lastLedScreen(leadItems, from, centre.name);
  const [picked, setPicked] = useState<{
    readonly screen: SpaceScreen | null;
    /** The lead's last look when the person chose; a newer look takes the screen back. */
    readonly after: string | null;
  }>({ screen: null, after: null });
  // A screen the person opened stays until they close it or the lead shows them something.
  const screen =
    led !== null && led.id !== picked.after && (led.shown || picked.screen === null)
      ? led.screen
      : picked.screen;
  const show = useStableCallback((next: SpaceScreen | null) =>
    setPicked({ screen: next, after: led?.id ?? null }),
  );
  const selected = screen?.kind === "board" ? screen.bot : null;
  const select = useStableCallback((name: string | null) =>
    show(name === null || name === selected ? null : { kind: "board", bot: name }),
  );
  const [flat, setFlat] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<BotSpaceScene | null>(null);
  const stars = useRef(new Map<string, SpaceStar>());
  const labels = useRef(new Map<string, HTMLElement>());
  const focused = screen?.bot ?? null;

  const place = useStableCallback((id: string, at: StarOnScreen | null) => {
    const label = labels.current.get(id);
    if (label === undefined) return;
    label.style.opacity = at === null ? "0" : "1";
    if (at !== null)
      label.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y + at.radius * 1.5 + 6)}px)`;
  });
  const register = useStableCallback((id: string, star: SpaceStar | null) => {
    if (star === null) stars.current.delete(id);
    else stars.current.set(id, star);
    scene.current?.update([...stars.current.values()]);
  });
  const label = useStableCallback((id: string, element: HTMLElement | null) => {
    if (element === null) labels.current.delete(id);
    else labels.current.set(id, element);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the WebGL scene for as long as the page is shown; three.js loads only here
  useEffect(() => {
    let closed = false;
    let created: BotSpaceScene | null = null;
    import("./BotSpaceScene")
      .then(({ BotSpaceScene: Scene }) => {
        if (closed || host.current === null) return;
        created = new Scene(host.current, select, place);
        scene.current = created;
        created.update([...stars.current.values()]);
      })
      // A browser without WebGL still gets the labels, the screens and the conversation.
      .catch(() => setFlat(true));
    return () => {
      closed = true;
      created?.dispose();
      scene.current = null;
    };
  }, [place, select]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves the scene's camera, which is outside React, to the chosen bot
  useEffect(() => {
    scene.current?.focus(focused);
  }, [focused]);

  return (
    <div
      ref={host}
      className="dark @container/space relative min-h-0 flex-1 overflow-hidden bg-black text-white"
      // Escape leaves a bot's screen from anywhere in the view.
      onKeyDown={(event) => {
        if (event.key === "Escape" && screen !== null) show(null);
      }}
    >
      {flat ? (
        <p className="absolute inset-x-0 top-6 px-6 text-center text-white/45 text-xs">
          <T>This browser cannot draw the space, so your bots are listed in the sidebar.</T>
        </p>
      ) : null}
      {bots.map((bot) => (
        <BotStar
          key={bot.name}
          environmentId={environmentId}
          bot={bot}
          place={places.get(bot.name)!}
          centre={bot === centre}
          selected={bot.name === selected}
          register={register}
          label={label}
          onSelect={() => select(bot.name)}
          onShowTask={(task) =>
            show({
              kind: "task",
              bot: bot.name,
              environmentId: task.environmentId,
              threadId: task.threadId,
            })
          }
        />
      ))}
      {list.data !== null && bots.length === 0 ? (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/55">
          <T>No bots yet. Start one from the sidebar and it appears here.</T>
        </p>
      ) : null}
      {list.data === null && list.error !== null ? (
        <p
          role="alert"
          className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-warning"
        >
          {list.error}
        </p>
      ) : null}
      {screen === null ? null : (
        <SpaceScreenPane
          key={`${screen.kind}:${screen.bot}:${screen.kind === "board" ? "" : screen.kind === "task" ? screen.threadId : screen.file}`}
          environmentId={environmentId}
          bots={bots}
          screen={screen}
          lights={starLight}
          onShow={show}
        />
      )}
      {centre === null ? null : (
        <SpaceConversation
          key={centre.name}
          environmentId={environmentId}
          bot={centre}
          items={leadItems}
          from={from}
          words={bots.map((bot) => bot.name)}
          scene={() => scene.current}
        />
      )}
    </div>
  );
}

/** Every bot as a light in the dark, with the one that oversees them in the middle to talk to. */
export function BotSpace() {
  const shells = useQuietThreadShells();
  const primary = usePrimaryEnvironmentId();
  const connected = useConnectedEnvironmentIds();
  const { environments } = useEnvironments();
  const bots = shells.filter(
    (thread) => thread.bot === true && thread.archivedAt === null && !isBotThreadId(thread.id),
  );
  const machines = environments
    .filter((environment) => connected.includes(environment.environmentId))
    .map(({ environmentId, label }) => ({ environmentId, label }));
  const home = resolveBotHome(bots, machines, primary);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {home === null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black px-6 text-center text-sm text-white/55">
          <T>No machine is connected.</T>
        </div>
      ) : (
        <SpaceOf key={home} environmentId={home} />
      )}
    </SidebarInset>
  );
}
