import { describe, expect, it } from "vite-plus/test";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as DateTime from "effect/DateTime";
import {
  EnvironmentId,
  NodeId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import { createAtlasAgentDetailsAtom } from "./atlasControlState";

const parent = ThreadId.make("parent");
const child = ThreadId.make("child");
const environmentId = EnvironmentId.make("test");
const empty: PendingThreadRequests = { approvals: [], userInputs: [] };
const waiting: PendingThreadRequests = {
  approvals: [
    {
      requestId: RuntimeRequestId.make("approval"),
      requestKind: "command",
      createdAt: "2026-01-01",
      responseCapability: "live",
    },
  ],
  userInputs: [],
};
const now = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
function subagent(
  threadId: ThreadId,
): Pick<
  OrchestrationV2Subagent,
  "id" | "childThreadId" | "title" | "status" | "startedAt" | "updatedAt"
> {
  return {
    id: NodeId.make(threadId),
    childThreadId: threadId,
    title: "Child agent",
    status: "waiting",
    startedAt: now,
    updatedAt: now,
  };
}

describe("Atlas live control threads", () => {
  it("surfaces and clears a nested request reactively while deduplicating cyclic child links", () => {
    const childRequests = Atom.make<PendingThreadRequests | null>(empty);
    const noRequests = Atom.make<PendingThreadRequests | null>(empty);
    const parentChildren = Atom.make({ subagents: [subagent(child)] });
    const childChildren = Atom.make({ subagents: [subagent(parent)] });
    const family = createAtlasAgentDetailsAtom({
      pendingRequestsAtom: (ref) => (ref.threadId === child ? childRequests : noRequests),
      turnSubagentsAtom: (ref) => (ref.threadId === parent ? parentChildren : childChildren),
    });
    const registry = AtomRegistry.make();
    const atom = family([environmentId, parent].join("\n"));
    const unmount = registry.mount(atom);
    expect(registry.get(atom).map((entry) => entry.row.threadId)).toEqual([parent, child]);
    registry.set(childRequests, waiting);
    expect(
      registry.get(atom).find((entry) => entry.row.threadId === child)?.pending?.approvals,
    ).toHaveLength(1);
    registry.set(childRequests, empty);
    expect(
      registry.get(atom).find((entry) => entry.row.threadId === child)?.pending?.approvals,
    ).toEqual([]);
    unmount();
    registry.dispose();
  });

  it("starts following a delegated thread added after the pane opens", () => {
    const requests = Atom.make<PendingThreadRequests | null>(waiting);
    const children = Atom.make<{ subagents: ReturnType<typeof subagent>[] }>({ subagents: [] });
    const leaf = Atom.make({ subagents: [] });
    const family = createAtlasAgentDetailsAtom({
      pendingRequestsAtom: () => requests,
      turnSubagentsAtom: (ref) => (ref.threadId === parent ? children : leaf),
    });
    const registry = AtomRegistry.make();
    const atom = family([environmentId, parent].join("\n"));
    const unmount = registry.mount(atom);
    expect(registry.get(atom)).toHaveLength(1);
    registry.set(children, { subagents: [subagent(child)] });
    expect(registry.get(atom).find((entry) => entry.row.threadId === child)?.pending).toEqual(
      waiting,
    );
    unmount();
    registry.dispose();
  });
});
