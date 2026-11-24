/** What the voice worker is told, and what it answers. */
export type VoiceWorkerRequest =
  | { readonly type: "load" }
  | { readonly type: "say"; readonly id: number; readonly text: string };
export type VoiceWorkerReply =
  | { readonly type: "loading"; readonly loaded: number; readonly total: number }
  | { readonly type: "ready" }
  | {
      readonly type: "audio";
      readonly id: number;
      readonly pcm: Float32Array<ArrayBuffer>;
      readonly sampleRate: number;
    }
  | { readonly type: "error"; readonly id: number | null; readonly message: string };

export interface SpeechVoiceEvents {
  /** The voice is being fetched for the first time: bytes so far, and in all. */
  readonly onLoading: (loaded: number, total: number) => void;
  readonly onReady: () => void;
  /** A piece starts to be heard; null when nothing is left to say. */
  readonly onSaying: (text: string | null) => void;
  readonly onError: (message: string) => void;
}

export interface SpeechVoice {
  /** Says this after whatever is already waiting. */
  readonly say: (text: string) => void;
  /** Falls silent at once and forgets what was waiting. */
  readonly stop: () => void;
  /** Whether anything is being said or waiting to be. */
  readonly speaking: () => boolean;
  /** 0..1, how loud the voice is this instant. */
  readonly level: () => number;
  readonly dispose: () => void;
}

/**
 * Speaks text with a voice made on this device, a piece at a time and in order. Each piece is
 * made while the one before it plays, so a reply starts as soon as its first sentence exists.
 */
export function createSpeechVoice(events: SpeechVoiceEvents): SpeechVoice {
  const worker = new Worker(new URL("./speechVoice.worker.ts", import.meta.url), {
    type: "module",
  });
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.connect(context.destination);
  const samples = new Float32Array(analyser.fftSize);

  // A stop starts a new generation, so audio still being made for the old one is dropped.
  let generation = 0;
  let nextId = 0;
  const waiting = new Map<number, { readonly generation: number; readonly text: string }>();
  const made = new Map<number, AudioBuffer>();
  let playing: { readonly id: number; readonly source: AudioBufferSourceNode } | null = null;
  let playNext = 0;
  // The worker is handed one piece at a time, so a stop leaves it at most that one to finish.
  let unmade: number[] = [];
  let making = false;
  const make = () => {
    if (making) return;
    const id = unmade.shift();
    const entry = id === undefined ? undefined : waiting.get(id);
    if (id === undefined || entry === undefined) return;
    making = true;
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker does not accept a target origin
    worker.postMessage({ type: "say", id, text: entry.text } satisfies VoiceWorkerRequest);
  };

  const advance = () => {
    if (playing !== null) return;
    while (playNext < nextId && !waiting.has(playNext)) playNext++;
    const buffer = made.get(playNext);
    const entry = waiting.get(playNext);
    if (entry === undefined) return events.onSaying(null);
    if (buffer === undefined) return;
    const id = playNext;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    source.addEventListener("ended", () => {
      if (playing?.id !== id) return;
      playing = null;
      waiting.delete(id);
      made.delete(id);
      advance();
    });
    playing = { id, source };
    events.onSaying(entry.text);
    void context.resume();
    source.start();
  };

  worker.addEventListener("message", ({ data }: MessageEvent<VoiceWorkerReply>) => {
    if (data.type === "loading") return events.onLoading(data.loaded, data.total);
    if (data.type === "ready") return events.onReady();
    making = false;
    make();
    if (data.type === "error") {
      if (data.id !== null) waiting.delete(data.id);
      events.onError(data.message);
      return advance();
    }
    if (waiting.get(data.id)?.generation !== generation) return;
    const buffer = context.createBuffer(1, data.pcm.length, data.sampleRate);
    buffer.copyToChannel(data.pcm, 0);
    made.set(data.id, buffer);
    advance();
  });
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker does not accept a target origin
  worker.postMessage({ type: "load" } satisfies VoiceWorkerRequest);

  return {
    say(text) {
      const id = nextId++;
      waiting.set(id, { generation, text });
      unmade.push(id);
      make();
    },
    stop() {
      generation++;
      unmade = [];
      waiting.clear();
      made.clear();
      const current = playing;
      playing = null;
      current?.source.stop();
      events.onSaying(null);
    },
    speaking: () => waiting.size > 0,
    level() {
      if (playing === null) return 0;
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      return Math.min(1, Math.sqrt(energy / samples.length) * 5);
    },
    dispose() {
      worker.terminate();
      void context.close();
    },
  };
}
