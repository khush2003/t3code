/// <reference lib="webworker" />
import { pipeline } from "@huggingface/transformers";

import type { VoiceWorkerReply, VoiceWorkerRequest } from "./speechVoice";

declare const self: DedicatedWorkerGlobalScope;

// Small enough to keep in the browser's cache and quick enough on a CPU to keep up with a reply.
const MODEL = "onnx-community/Supertonic-TTS-ONNX";
const SPEAKER = `https://huggingface.co/${MODEL}/resolve/main/voices/M1.bin`;
/** Fewer steps is faster and a little rougher; this is where a sentence stops sounding thin. */
const STEPS = 4;

const reply = (message: VoiceWorkerReply, transfer: Transferable[] = []) =>
  self.postMessage(message, transfer);

const sizes = new Map<string, { loaded: number; total: number }>();
const voice = pipeline("text-to-speech", MODEL, {
  device: "wasm",
  progress_callback: (progress) => {
    if (progress.status !== "progress") return;
    sizes.set(progress.file, { loaded: progress.loaded, total: progress.total });
    let loaded = 0;
    let total = 0;
    for (const size of sizes.values()) {
      loaded += size.loaded;
      total += size.total;
    }
    reply({ type: "loading", loaded, total });
  },
});

const say = async (text: string) =>
  (await voice)(text, { speaker_embeddings: SPEAKER, num_inference_steps: STEPS, speed: 1.05 });
// The first run builds the model's graphs; paying for that here keeps it out of the first reply.
const warm = say("Ready.");

// One piece at a time: the model is not reentrant, and pieces are wanted in the order asked.
let last: Promise<unknown> = Promise.resolve();

self.addEventListener("message", ({ data }: MessageEvent<VoiceWorkerRequest>) => {
  last = last.then(async () => {
    try {
      await warm;
      if (data.type === "load") return reply({ type: "ready" });
      const made = await say(data.text);
      const pcm = new Float32Array(made.audio);
      reply({ type: "audio", id: data.id, pcm, sampleRate: made.sampling_rate }, [pcm.buffer]);
    } catch (error) {
      reply({
        type: "error",
        id: data.type === "say" ? data.id : null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
});
