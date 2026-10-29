import { CHORD_INTERVALS, midiToHz, type BreathNote } from "./soul.logic";

function impulse(context: BaseAudioContext, seconds: number) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index++)
      data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 2.5;
  }
  return buffer;
}

function voice(
  context: BaseAudioContext,
  out: AudioNode,
  type: OscillatorType,
  hz: number,
  gain: number,
  at: number,
  length: number,
) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = hz;
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(gain, at + 0.03);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);
  oscillator.connect(envelope).connect(out);
  oscillator.start(at);
  oscillator.stop(at + length + 0.05);
}

type LifeNote = { readonly index: number; readonly note: BreathNote };

function noteSeconds(note: BreathNote) {
  return Math.min(1.6, Math.max(0.18, (note.beats * 60) / note.tempo) * 0.6);
}

/** Wires a gain and reverb bus to `context` and returns its input. */
function bus(context: BaseAudioContext) {
  const master = context.createGain();
  master.gain.value = 0.22;
  const reverb = context.createConvolver();
  reverb.buffer = impulse(context, 2.4);
  const wet = context.createGain();
  wet.gain.value = 0.35;
  master.connect(context.destination);
  master.connect(reverb).connect(wet).connect(context.destination);
  return master;
}

/** One breath as a chord: triangle root, sub-octave and the quality's intervals. */
function chord(context: BaseAudioContext, out: AudioNode, note: BreathNote, at: number) {
  const seconds = noteSeconds(note);
  const loudness = 0.25 + (note.velocity / 127) * 0.75;
  const root = midiToHz(note.midi);
  voice(context, out, "triangle", root, 0.5 * loudness, at, seconds * 1.6);
  voice(context, out, "sine", root / 2, 0.25 * loudness, at, seconds * 1.8);
  for (const interval of CHORD_INTERVALS[note.quality]) {
    voice(context, out, "sine", midiToHz(note.midi + interval), 0.18 * loudness, at, seconds * 1.4);
  }
  return seconds;
}

/** Plays a single breath's chord. */
export function playNote(note: BreathNote): void {
  const context = new AudioContext();
  const seconds = chord(context, bus(context), note, context.currentTime + 0.03);
  setTimeout(() => void context.close(), (seconds * 1.8 + 2.5) * 1000);
}

/** Renders the whole life offline into a 16-bit stereo WAV, for download. */
export async function renderLifeWav(notes: ReadonlyArray<LifeNote>): Promise<Blob> {
  const rate = 44_100;
  const length = notes.reduce((sum, { note }) => sum + noteSeconds(note), 0) + 3;
  const context = new OfflineAudioContext(2, Math.ceil(length * rate), rate);
  const out = bus(context);
  let at = 0.05;
  for (const { note } of notes) at += chord(context, out, note, at);
  const rendered = await context.startRendering();
  const frames = rendered.length;
  const data = new DataView(new ArrayBuffer(44 + frames * 4));
  const text = (offset: number, value: string) =>
    [...value].forEach((char, index) => data.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  data.setUint32(4, 36 + frames * 4, true);
  text(8, "WAVE");
  text(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 2, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * 4, true);
  data.setUint16(32, 4, true);
  data.setUint16(34, 16, true);
  text(36, "data");
  data.setUint32(40, frames * 4, true);
  const left = rendered.getChannelData(0);
  const right = rendered.getChannelData(1);
  for (let frame = 0; frame < frames; frame++) {
    const sample = (value: number) => Math.round(Math.max(-1, Math.min(1, value)) * 0x7fff);
    data.setInt16(44 + frame * 4, sample(left[frame]!), true);
    data.setInt16(46 + frame * 4, sample(right[frame]!), true);
  }
  return new Blob([data.buffer], { type: "audio/wav" });
}

/**
 * Plays an anima's life: one chord per breath, spaced by its own duration and tempo.
 * `onStep` reports the breath sounding now (or null at the end); the returned function stops playback.
 */
export function playLife(
  notes: ReadonlyArray<LifeNote>,
  onStep: (index: number | null) => void,
): () => void {
  const context = new AudioContext();
  const master = bus(context);
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let at = context.currentTime + 0.08;
  for (const { index, note } of notes) {
    const start = at;
    at += chord(context, master, note, at);
    timers.push(setTimeout(() => onStep(index), (start - context.currentTime) * 1000));
  }
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    void context.close();
    onStep(null);
  };
  timers.push(setTimeout(stop, (at - context.currentTime + 1.5) * 1000));
  return stop;
}
