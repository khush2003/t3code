import { VOICE_MODEL } from "./speechVoiceModel";

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

/** The browser cache transformers.js keeps the voice in. */
const VOICE_CACHE = "transformers-cache";

/** Whether this browser already holds the voice, so starting it needs no download. */
export async function isSpeechVoiceKept(): Promise<boolean> {
  try {
    const keys = await (await caches.open(VOICE_CACHE)).keys();
    return keys.some(
      (request) => request.url.includes(`${VOICE_MODEL}/`) && /\.onnx/.test(request.url),
    );
  } catch {
    return false;
  }
}

export interface SpeechVoiceState {
  /** Not asked for, fetching for the first time, starting from this browser's copy, or ready. */
  readonly load:
    | { readonly step: "off" }
    | { readonly step: "downloading"; readonly loaded: number; readonly total: number }
    | { readonly step: "starting" }
    | { readonly step: "ready" };
  /** The piece being heard now; null when nothing is left to say. */
  readonly saying: string | null;
  readonly error: string | null;
}

export interface SpeechVoice {
  /**
   * Starts the voice; `kept` is false when it must first be downloaded, which is said instead of
   * "starting". The voice stays loaded until `unload`.
   */
  readonly load: (kept: boolean) => void;
  readonly unload: () => void;
  /** Says this after whatever is already waiting. Dropped while the voice is not loaded. */
  readonly say: (text: string) => void;
  /** Falls silent at once and forgets what was waiting. */
  readonly stop: () => void;
  /** Whether anything is being said or waiting to be. */
  readonly speaking: () => boolean;
  /** 0..1, how loud the voice is this instant. */
  readonly level: () => number;
  readonly state: () => SpeechVoiceState;
  readonly subscribe: (changed: () => void) => () => void;
}

const OFF: SpeechVoiceState = { load: { step: "off" }, saying: null, error: null };

/**
 * Speaks text with a voice made on this device, a piece at a time and in order. Each piece is
 * made while the one before it plays, so a reply starts as soon as its first sentence exists.
 */
export function createSpeechVoice(): SpeechVoice {
  let state = OFF;
  const listeners = new Set<() => void>();
  const set = (change: Partial<SpeechVoiceState>) => {
    state = { ...state, ...change };
    for (const changed of listeners) changed();
  };
  let loaded: {
    readonly worker: Worker;
    readonly context: AudioContext;
    readonly analyser: AnalyserNode;
    readonly samples: Float32Array<ArrayBuffer>;
  } | null = null;

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
    if (making || loaded === null) return;
    const id = unmade.shift();
    const entry = id === undefined ? undefined : waiting.get(id);
    if (id === undefined || entry === undefined) return;
    making = true;
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker does not accept a target origin
    loaded.worker.postMessage({ type: "say", id, text: entry.text } satisfies VoiceWorkerRequest);
  };

  const advance = () => {
    if (playing !== null || loaded === null) return;
    while (playNext < nextId && !waiting.has(playNext)) playNext++;
    const buffer = made.get(playNext);
    const entry = waiting.get(playNext);
    if (entry === undefined) return set({ saying: null });
    if (buffer === undefined) return;
    const id = playNext;
    const source = loaded.context.createBufferSource();
    source.buffer = buffer;
    source.connect(loaded.analyser);
    source.addEventListener("ended", () => {
      if (playing?.id !== id) return;
      playing = null;
      waiting.delete(id);
      made.delete(id);
      advance();
    });
    playing = { id, source };
    set({ saying: entry.text });
    void loaded.context.resume();
    source.start();
  };

  const stop = () => {
    generation++;
    unmade = [];
    waiting.clear();
    made.clear();
    const current = playing;
    playing = null;
    current?.source.stop();
    if (state.saying !== null) set({ saying: null });
  };

  return {
    load(kept) {
      if (loaded !== null) return;
      const worker = new Worker(new URL("./speechVoice.worker.ts", import.meta.url), {
        type: "module",
      });
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.connect(context.destination);
      loaded = { worker, context, analyser, samples: new Float32Array(analyser.fftSize) };
      set({
        load: kept ? { step: "starting" } : { step: "downloading", loaded: 0, total: 0 },
        error: null,
      });
      worker.addEventListener("message", ({ data }: MessageEvent<VoiceWorkerReply>) => {
        if (loaded?.worker !== worker) return;
        if (data.type === "loading") {
          // A voice read back from this browser's copy reports progress too; that is no download.
          if (state.load.step === "downloading")
            set({ load: { step: "downloading", loaded: data.loaded, total: data.total } });
          return;
        }
        if (data.type === "ready") return set({ load: { step: "ready" } });
        making = false;
        make();
        if (data.type === "error") {
          if (data.id !== null) waiting.delete(data.id);
          set({ error: data.message });
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
    },
    unload() {
      if (loaded === null) return;
      stop();
      loaded.worker.terminate();
      void loaded.context.close();
      loaded = null;
      making = false;
      set(OFF);
    },
    say(text) {
      if (loaded === null) return;
      const id = nextId++;
      waiting.set(id, { generation, text });
      unmade.push(id);
      make();
    },
    stop,
    speaking: () => waiting.size > 0,
    level() {
      if (playing === null || loaded === null) return 0;
      loaded.analyser.getFloatTimeDomainData(loaded.samples);
      let energy = 0;
      for (const sample of loaded.samples) energy += sample * sample;
      return Math.min(1, Math.sqrt(energy / loaded.samples.length) * 5);
    },
    state: () => state,
    subscribe(changed) {
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
  };
}
