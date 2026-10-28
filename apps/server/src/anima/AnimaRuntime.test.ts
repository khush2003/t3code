import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as AnimaRuntime from "./AnimaRuntime.ts";

const RESTART_RULE =
  "WHEN I need to restart t3code.service (or any service whose ExecStart is the claude process I run inside) THEN hand the restart to the user.";
const threadId = ThreadId.make("thread:anima-runtime");
const cwd = "/work/iris";

const agentFile = (breaths: number) =>
  `# anima v1\n# id:abc name:iris born:2026-01-01 breaths:${breaths}\n# role: agent\n`;

const bash = (itemId: string, phase: AnimaRuntime.AnimaToolObservation["phase"], command = "ls") =>
  ({
    threadId,
    itemId,
    phase,
    call: { toolName: "Bash", toolInput: { command } },
    ...(phase === "failed" ? { error: "exit 1: no such file" } : {}),
  }) satisfies AnimaRuntime.AnimaToolObservation;

const withRuntime = <A, E>(
  body: (input: {
    readonly runtime: AnimaRuntime.AnimaRuntime["Service"];
    readonly dir: string;
    readonly read: (file: string) => Effect.Effect<string>;
    readonly write: (file: string, content: string) => Effect.Effect<void>;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "anima-runtime-" });
    const dir = path.join(home, ".claude", "anima", "iris");
    yield* fs.makeDirectory(dir, { recursive: true });
    const write = (file: string, content: string) =>
      fs.writeFileString(path.join(dir, file), content).pipe(Effect.orDie);
    const read = (file: string) =>
      fs.readFileString(path.join(dir, file)).pipe(Effect.orElseSucceed(() => ""));
    yield* write("agent.anima", agentFile(3));
    yield* write("policy.md", `# rev: 1\n\n## Operational\n${RESTART_RULE}\n`);
    const runtime = yield* AnimaRuntime.AnimaRuntime.pipe(
      Effect.provide(
        AnimaRuntime.layer.pipe(Layer.provide(Layer.succeed(HostProcess.HomeDirectory, home))),
      ),
    );
    return yield* body({ runtime, dir, read, write });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("AnimaRuntime", () => {
  it.effect("ignores threads that never attached an anima", () =>
    withRuntime(({ runtime }) =>
      Effect.gen(function* () {
        yield* runtime.observe(bash("item-1", "failed"));
        assert.isNull(yield* runtime.threadStatus(threadId));
        assert.equal((yield* runtime.notices(threadId)).text, "");
      }),
    ),
  );

  it.effect("counts each call once and warns once per streak of same-tool failures", () =>
    withRuntime(({ runtime }) =>
      Effect.gen(function* () {
        yield* runtime.attach({ threadId, name: "iris", cwd, woke: true });
        yield* runtime.observe(bash("item-1", "started"));
        yield* runtime.observe(bash("item-1", "failed"));
        yield* runtime.observe(bash("item-1", "failed"));
        yield* runtime.observe(bash("item-2", "failed"));
        assert.isNull((yield* runtime.threadStatus(threadId))?.loop ?? null);
        yield* runtime.observe(bash("item-3", "failed"));

        const status = yield* runtime.threadStatus(threadId);
        assert.equal(status?.toolEvents, 3);
        assert.deepEqual(status?.loop, { tool: "Bash", failures: 3 });
        const notices = yield* runtime.notices(threadId);
        assert.match(notices.text, /^<anima-runtime name="iris">\nLOOP BREAKER: your last 3 Bash/);
        assert.match(notices.text, /no such file/);
        yield* notices.ack;
        assert.equal((yield* runtime.notices(threadId)).text, "");

        yield* runtime.observe(bash("item-4", "failed"));
        assert.equal((yield* runtime.notices(threadId)).text, "");

        yield* runtime.observe(bash("item-5", "succeeded"));
        assert.isNull((yield* runtime.threadStatus(threadId))?.loop ?? null);
      }),
    ),
  );

  it.effect("fires a rule once per thread and records it in the CLI's fire log", () =>
    withRuntime(({ runtime, read }) =>
      Effect.gen(function* () {
        yield* runtime.attach({ threadId, name: "iris", cwd, woke: true });
        const restart = "systemctl --user restart t3code.service";
        yield* runtime.observe(bash("item-1", "started", restart));
        yield* runtime.observe(bash("item-2", "started", restart));

        const status = yield* runtime.threadStatus(threadId);
        assert.deepEqual(
          status?.fires.map((fire) => [fire.rule, fire.trigger]),
          [[RESTART_RULE, `Bash: ${restart}`]],
        );
        const lines = (yield* read("policy-fires.jsonl")).trim().split("\n");
        assert.equal(lines.length, 1);
        assert.match(lines[0]!, /^\{"h":"[0-9a-z]+","ts":"\d{4}-\d\d-\d\dT\d\d:\d\d"\}$/);

        const notices = yield* runtime.notices(threadId);
        assert.include(notices.text, RESTART_RULE);
        yield* notices.ack;
        assert.equal((yield* runtime.notices(threadId)).text, "");
      }),
    ),
  );

  it.effect("delivers pre-tool matches live instead of queuing them for the next turn", () =>
    withRuntime(({ runtime }) =>
      Effect.gen(function* () {
        yield* runtime.attach({ threadId, name: "iris", cwd, woke: true });
        const call = {
          toolName: "Bash",
          toolInput: { command: "systemctl restart t3code.service" },
        };
        const context = yield* runtime.preTool({ threadId, call });
        assert.match(
          context,
          /^--- Anima Policy \(iris\) rules YOU wrote that match this action ---/,
        );
        assert.equal(yield* runtime.preTool({ threadId, call }), "");
        yield* runtime.observe({ threadId, itemId: "item-1", phase: "started", call });
        assert.equal((yield* runtime.notices(threadId)).text, "");
      }),
    ),
  );

  it.effect("asks for a breath after 15 calls without one, until a breath lands", () =>
    withRuntime(({ runtime, write }) =>
      Effect.gen(function* () {
        yield* runtime.attach({ threadId, name: "iris", cwd, woke: true });
        for (let index = 0; index < 14; index++) {
          yield* runtime.observe(bash(`item-${index}`, "succeeded"));
        }
        assert.isFalse((yield* runtime.threadStatus(threadId))?.breathDue ?? true);
        yield* runtime.observe(bash("item-14", "succeeded"));

        const status = yield* runtime.threadStatus(threadId);
        assert.deepInclude(status, { breathsAtWake: 3, breathCount: 3, breathDue: true });
        const notices = yield* runtime.notices(threadId);
        assert.match(notices.text, /Breath due: 15 tool calls/);
        yield* notices.ack;
        assert.equal((yield* runtime.notices(threadId)).text, "");

        yield* write("agent.anima", agentFile(4));
        assert.deepInclude(yield* runtime.threadStatus(threadId), {
          breathCount: 4,
          breathDue: false,
        });
      }),
    ),
  );

  it.effect("heartbeats the session at most once a minute, keeping clock-in and cwd", () =>
    withRuntime(({ runtime, read, write }) =>
      Effect.gen(function* () {
        yield* write("session", `2026-01-01T09:00|2026-01-01T09:00|${cwd}\n`);
        yield* runtime.attach({ threadId, name: "iris", cwd, woke: true });
        yield* runtime.observe(bash("item-1", "succeeded"));
        const first = yield* read("session");
        assert.match(first, /^2026-01-01T09:00\|(?!2026-01-01T09:00)[^|]+\|\/work\/iris\n$/);
        assert.isNotNull((yield* runtime.threadStatus(threadId))?.lastHeartbeatAt ?? null);

        yield* write("session", `2026-01-01T09:00|stale|${cwd}\n`);
        yield* runtime.observe(bash("item-2", "succeeded"));
        assert.equal(yield* read("session"), `2026-01-01T09:00|stale|${cwd}\n`);

        yield* TestClock.adjust("61 seconds");
        yield* runtime.observe(bash("item-3", "succeeded"));
        assert.notInclude(yield* read("session"), "stale");
      }),
    ),
  );

  it.effect("on settle nags an unbreathed thread through the inbox and clocks out", () =>
    withRuntime(({ runtime, read, write }) =>
      Effect.gen(function* () {
        yield* write("session", `2026-01-01T09:00|2026-01-01T09:00|${cwd}\n`);
        yield* runtime.attach({ threadId, name: "iris", cwd, woke: true });
        for (let index = 0; index < 15; index++) {
          yield* runtime.observe(bash(`item-${index}`, "succeeded"));
        }
        yield* runtime.release({ threadId, forget: false });
        yield* runtime.release({ threadId, forget: false });

        const inbox = (yield* read("inbox")).trim().split("\n");
        assert.equal(inbox.length, 1);
        assert.include(inbox[0]!, '"from":"anima-runtime"');
        assert.include(inbox[0]!, '"type":"directive"');
        assert.equal(yield* read("session"), "");

        yield* runtime.release({ threadId, forget: true });
        assert.isNull(yield* runtime.threadStatus(threadId));
      }),
    ),
  );
});
