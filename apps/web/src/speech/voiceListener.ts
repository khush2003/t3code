import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import {
  getEnvironmentSpeechStatus,
  getEnvironmentSpeechStreamUrl,
  openSpeechStream,
} from "@t3tools/client-runtime/voice-input";
import type { SpeechTranscriptionOptions } from "@t3tools/contracts";
import { msg } from "gt-react";

import { m } from "../i18n/messages";
import { chooseRecordingMicrophone } from "./browserMicrophones";
import workletUrl from "./pcmWorklet.ts?worker&url";
import { requestMicrophone } from "./requestMicrophone";
import { runEnvironmentSpeech } from "./runEnvironmentSpeech";
import { createSpeechEndpointer } from "./speechEndpointer";

type Pcm = Float32Array<ArrayBuffer>;

export interface VoiceListenerInput {
  /** The environment the person chose to send microphone audio to. */
  readonly prepared: PreparedConnection;
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

/**
 * Listens for as long as `signal` lives and hands over each thing the person says, hands free.
 * Audio leaves the device only while they speak: the level decides where an utterance starts and
 * ends, and each one is its own transcription stream, since an environment runs one at a time.
 */
export async function startVoiceListener(input: VoiceListenerInput): Promise<void> {
  const { signal } = input;
  const status = await runEnvironmentSpeech(getEnvironmentSpeechStatus(input.prepared), {
    signal,
  });
  if (!status.supported) throw new Error(status.reason);
  if (!status.supportsStreaming && !status.supportsBufferedStreaming)
    throw new Error(m(msg("Talking needs a speech model that transcribes as you speak.")));

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
  let current: { readonly chunks: Pcm[]; feed: ((pcm: Pcm) => void) | null } | null = null;
  let flushed: (() => void) | null = null;
  // One stream at a time: what is said next waits for the last to be written down.
  let previous: Promise<unknown> = Promise.resolve();

  const transcribe = (utterance: NonNullable<typeof current>, ended: Promise<void>) => {
    const run = async () => {
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
      await ended;
      const text = (await stream.finish()).trim();
      input.onPartial(null);
      if (text !== "") input.onUtterance(text);
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
      current = { chunks: before === null ? [] : [before], feed: null };
      before = null;
      const { promise, resolve } = Promise.withResolvers<void>();
      flushed = resolve;
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
