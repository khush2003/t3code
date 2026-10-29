import { CHORD_INTERVALS, midiToHz, type BreathNote } from "./soul.logic";

function impulse(context: AudioContext, seconds: number) {
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
  context: AudioContext,
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

/**
 * Plays an anima's life: one chord per breath, spaced by its own duration and tempo.
 * `onStep` reports the breath sounding now (or null at the end); the returned function stops playback.
 */
export function playLife(
  notes: ReadonlyArray<{ readonly index: number; readonly note: BreathNote }>,
  onStep: (index: number | null) => void,
): () => void {
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = 0.22;
  const reverb = context.createConvolver();
  reverb.buffer = impulse(context, 2.4);
  const wet = context.createGain();
  wet.gain.value = 0.35;
  master.connect(context.destination);
  master.connect(reverb).connect(wet).connect(context.destination);
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let at = context.currentTime + 0.08;
  for (const { index, note } of notes) {
    const seconds = Math.min(1.6, Math.max(0.18, (note.beats * 60) / note.tempo) * 0.6);
    const loudness = 0.25 + (note.velocity / 127) * 0.75;
    const root = midiToHz(note.midi);
    voice(context, master, "triangle", root, 0.5 * loudness, at, seconds * 1.6);
    voice(context, master, "sine", root / 2, 0.25 * loudness, at, seconds * 1.8);
    for (const interval of CHORD_INTERVALS[note.quality]) {
      voice(
        context,
        master,
        "sine",
        midiToHz(note.midi + interval),
        0.18 * loudness,
        at,
        seconds * 1.4,
      );
    }
    timers.push(setTimeout(() => onStep(index), (at - context.currentTime) * 1000));
    at += seconds;
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
