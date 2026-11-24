import { expect, it, vi } from "vite-plus/test";

import { createSpeechVoice, type VoiceWorkerReply, type VoiceWorkerRequest } from "./speechVoice";

it("makes one piece at a time, says them in order, and a stop drops what was waiting", () => {
  using globals = new DisposableStack();
  const setGlobal = (name: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    globals.defer(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  const asked: VoiceWorkerRequest[] = [];
  let answer!: (reply: VoiceWorkerReply) => void;
  setGlobal(
    "Worker",
    class {
      postMessage = (request: VoiceWorkerRequest) => asked.push(request);
      addEventListener = (_type: string, listener: (event: { data: VoiceWorkerReply }) => void) => {
        answer = (data) => listener({ data });
      };
      terminate = () => undefined;
    },
  );
  const sources: Array<{ end: () => void; stop: ReturnType<typeof vi.fn> }> = [];
  setGlobal(
    "AudioContext",
    class {
      destination = {};
      createAnalyser = () => ({ fftSize: 0, connect: () => undefined });
      createBuffer = () => ({ copyToChannel: () => undefined });
      createBufferSource = () => {
        let ended = () => undefined;
        const source = {
          buffer: null,
          connect: () => undefined,
          start: () => undefined,
          stop: vi.fn(),
          addEventListener: (_type: string, listener: () => undefined) => {
            ended = listener;
          },
          end: () => ended(),
        };
        sources.push(source);
        return source;
      };
      resume = () => Promise.resolve();
      close = () => Promise.resolve();
    },
  );
  const saying: Array<string | null> = [];
  const voice = createSpeechVoice({
    onLoading: () => undefined,
    onReady: () => undefined,
    onSaying: (text) => saying.push(text),
    onError: () => undefined,
  });
  const made = (id: number) =>
    answer({ type: "audio", id, pcm: new Float32Array(8), sampleRate: 44_100 });
  const says = () => asked.flatMap((request) => (request.type === "say" ? [request.text] : []));

  for (const text of ["a", "b", "c"]) voice.say(text);
  expect(says()).toEqual(["a"]);
  made(0);
  expect(saying).toEqual(["a"]);
  expect(says()).toEqual(["a", "b"]);
  // The next piece is made while this one plays, and waits its turn.
  made(1);
  expect(says()).toEqual(["a", "b", "c"]);
  expect(saying).toEqual(["a"]);
  sources[0]!.end();
  expect(saying).toEqual(["a", "b"]);

  voice.stop();
  expect(sources[1]!.stop).toHaveBeenCalled();
  expect(voice.speaking()).toBe(false);
  made(2);
  expect(saying).toEqual(["a", "b", null]);

  voice.say("d");
  expect(says()).toEqual(["a", "b", "c", "d"]);
  made(3);
  sources.at(-1)!.end();
  expect(saying).toEqual(["a", "b", null, "d", null]);
  expect(voice.speaking()).toBe(false);
});
