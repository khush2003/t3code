import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import {
  getEnvironmentSpeechStatus,
  getEnvironmentSpeechStreamUrl,
  openSpeechStream,
  requireCloudSpeechKey,
  transcribeCloudPcm,
} from "@t3tools/client-runtime/voice-input";
import type {
  CloudSpeechModelId,
  CloudSpeechProvider,
  SpeechTranscriptionOptions,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { msg } from "gt-react";

import { m } from "../i18n/messages";
import { chooseRecordingMicrophone } from "./browserMicrophones";
import workletUrl from "./pcmWorklet.ts?worker&url";
import { requestMicrophone } from "./requestMicrophone";
import { runEnvironmentSpeech } from "./runEnvironmentSpeech";
import { createSpeechEndpointer, SPEECH_HANG_MS } from "./speechEndpointer";

type Pcm = Float32Array<ArrayBuffer>;

/** Shorter than this is a click, a cough or a chair, and is not sent to be written down. */
const SHORTEST_UTTERANCE_MS = 150;

/** Hearing cannot start until the person sets something up in Voice settings. */
export class VoiceSetupNeeded extends Schema.TaggedError<VoiceSetupNeeded>()("VoiceSetupNeeded", {
  message: Schema.String,
}) {}

export interface VoiceListenerInput {
  /** The environment the person chose to send microphone audio to. */
  readonly prepared: PreparedConnection;
  /** The provider they chose instead of a model on that environment, with its model if it names one. */
  readonly cloudProvider?: CloudSpeechProvider | undefined;
  readonly cloudModel?: CloudSpeechModelId | undefined;
  readonly canSend: () => boolean;
  readonly options: SpeechTranscriptionOptions;
  readonly signal: AbortSignal;
  /** True while the reply is being spoken, so its echo is not taken for the person. */
  readonly isGuarded: () => boolean;
  readonly onLevel: (level: number) => void;
  readonly onSpeechStart: () => void;
  /** The person paused; what they said is still being written down. */
  readonly onSpeechEnd: () => void;
  /** Words heard so far of what is being said; null once it has been handed over. */
  readonly onPartial: (text: string | null) => void;
  readonly onUtterance: (text: string) => void;
  readonly onError: (error: Error) => void;
}

/** Fails with what the person has to do when their chosen destination cannot write speech down. */
async function requireDestination(input: VoiceListenerInput) {
  const { signal, cloudProvider } = input;
  if (cloudProvider !== undefined) {
    if (cloudProvider === "openrouter" && input.cloudModel === undefined)
      throw new VoiceSetupNeeded({
        message: m(msg("Choose an OpenRouter model in Settings → Voice.")),
      });
    await runEnvironmentSpeech(requireCloudSpeechKey(input.prepared, cloudProvider), { signal });
    return;
  }
  const status = await runEnvironmentSpeech(getEnvironmentSpeechStatus(input.prepared), {
    signal,
  });
  if (!status.supported) throw new VoiceSetupNeeded({ message: status.reason });
  if (status.state === "missing-model")
    throw new VoiceSetupNeeded({
      message: m(
        msg("{model} is not downloaded on the machine that hears you.", {
          model: status.model,
        }),
      ),
    });
}

/**
 * Listens for as long as `signal` lives and hands over each thing the person says, hands free.
 * Audio leaves the device only while they speak: the level decides where an utterance starts and
 * ends. Each is written down where the person chose: streamed to a model on their environment,
 * one stream at a time, or sent whole to their cloud provider when they stop.
 */
export async function startVoiceListener(input: VoiceListenerInput): Promise<void> {
  const { signal, cloudProvider } = input;
  await requireDestination(input);

  const microphone = await requestMicrophone(await chooseRecordingMicrophone(), signal);
  const context = new AudioContext();
  const close = () => {
    microphone.getTracks().forEach((track) => track.stop());
    void context.close();
  };
  if (signal.aborted) {
    close();
    return signal.throwIfAborted();
  }
  signal.addEventListener("abort", close, { once: true });
  await context.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(context, "t3-pcm-capture", {
    channelCount: 1,
    processorOptions: { continuous: true },
  });

  const endpointer = createSpeechEndpointer();
  /** The half second before the person was heard, so their first word is not clipped. */
  let before: Pcm | null = null;
  let current: {
    readonly chunks: Pcm[];
    readonly startedAt: number;
    feed: ((pcm: Pcm) => void) | null;
  } | null = null;
  let flushed: (() => void) | null = null;
  // One at a time: what is said next waits for the last to be written down.
  let previous: Promise<unknown> = Promise.resolve();

  const streamed = async (utterance: NonNullable<typeof current>, ended: Promise<number>) => {
    const url = await runEnvironmentSpeech(getEnvironmentSpeechStreamUrl(input.prepared), {
      signal,
    });
    const stream = openSpeechStream({
      url,
      options: input.options,
      signal,
      canSend: input.canSend,
      onText: (text) => input.onPartial(`${text.committed}${text.tentative}`.trim()),
      onError: () => undefined,
    });
    for (const chunk of utterance.chunks) stream.feed(chunk);
    utterance.feed = (pcm) => stream.feed(pcm);
    const spokenMs = await ended;
    const text = await stream.finish();
    return spokenMs < SHORTEST_UTTERANCE_MS ? "" : text;
  };
  const sentWhole = async (
    utterance: NonNullable<typeof current>,
    ended: Promise<number>,
    provider: CloudSpeechProvider,
  ) => {
    if ((await ended) < SHORTEST_UTTERANCE_MS) return "";
    const pcm = new Float32Array(utterance.chunks.reduce((size, chunk) => size + chunk.length, 0));
    let at = 0;
    for (const chunk of utterance.chunks) {
      pcm.set(chunk, at);
      at += chunk.length;
    }
    const result = await runEnvironmentSpeech(
      transcribeCloudPcm(
        input.prepared,
        provider,
        new Uint8Array(pcm.buffer),
        input.options,
        input.canSend,
        input.cloudModel,
      ),
      { signal },
    );
    return result.text;
  };

  const transcribe = (utterance: NonNullable<typeof current>, ended: Promise<number>) => {
    const run = async () => {
      const text = (
        await (cloudProvider === undefined
          ? streamed(utterance, ended)
          : sentWhole(utterance, ended, cloudProvider))
      ).trim();
      input.onPartial(null);
      // A provider handed a noise answers with punctuation alone.
      if (/[\p{L}\p{N}]/u.test(text)) input.onUtterance(text);
    };
    previous = previous.then(run).catch((error: unknown) => {
      input.onPartial(null);
      if (!signal.aborted) input.onError(error instanceof Error ? error : new Error(String(error)));
    });
  };

  node.port.onmessage = ({ data }: MessageEvent<Pcm | number | "flushed" | "stopped">) => {
    if (signal.aborted) return;
    if (data === "flushed") return flushed?.();
    if (data === "stopped") return;
    if (typeof data !== "number") {
      if (current === null) before = data;
      else if (current.feed) current.feed(data);
      else current.chunks.push(data);
      return;
    }
    input.onLevel(data);
    const heard = endpointer.push(data, performance.now(), input.isGuarded());
    if (heard === "start") {
      current = {
        chunks: before === null ? [] : [before],
        startedAt: performance.now(),
        feed: null,
      };
      before = null;
      const { promise, resolve } = Promise.withResolvers<number>();
      const utterance = current;
      // The pause that ended it is not part of what was said.
      flushed = () => resolve(performance.now() - utterance.startedAt - SPEECH_HANG_MS);
      transcribe(current, promise);
      input.onSpeechStart();
    } else if (heard === "end") {
      // The audio still held in the worklet is handed over before the utterance is closed.
      const ending = flushed;
      const utterance = current;
      flushed = () => {
        if (current === utterance) current = null;
        ending?.();
      };
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- AudioWorklet MessagePorts do not accept a target origin
      node.port.postMessage("flush");
      input.onSpeechEnd();
    }
  };
  node.onprocessorerror = () => input.onError(new Error(m(msg("Microphone processing failed."))));
  for (const track of microphone.getTracks())
    track.addEventListener(
      "ended",
      () => {
        if (!signal.aborted) input.onError(new Error(m(msg("The microphone disconnected."))));
      },
      { once: true },
    );
  context.createMediaStreamSource(microphone).connect(node);
  // The processor emits silence, keeping the graph active without microphone playback.
  node.connect(context.destination);
  await context.resume();
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- AudioWorklet MessagePorts do not accept a target origin
  node.port.postMessage("start");
}
