import {
  EnvironmentId,
  ThreadId,
  type ScopedThreadRef,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import { Atom } from "effect/reactivity";
import * as DateTime from "effect/DateTime";
import type { AtlasAgentRow } from "./atlasControlLogic";

export function createAtlasAgentDetailsAtom(details: {
  readonly pendingRequestsAtom: (ref: ScopedThreadRef) => Atom.Atom<PendingThreadRequests | null>;
  readonly turnSubagentsAtom: (ref: ScopedThreadRef) => Atom.Atom<{
    readonly subagents: ReadonlyArray<
      Pick<
        OrchestrationV2Subagent,
        "id" | "childThreadId" | "title" | "status" | "startedAt" | "updatedAt"
      >
    >;
  } | null>;
}) {
  return Atom.family((key: string) => {
    const [environment, ...ids] = key.split("\n");
    const environmentId = EnvironmentId.make(environment!);
    return Atom.make((get) => {
      const queue: AtlasAgentRow[] = ids.map((id) => ({
        key: id,
        threadId: ThreadId.make(id),
        kind: "Agent",
        title: "Agent",
        status: "",
        running: false,
        failed: false,
        startedAt: "",
      }));
      const seen = new Set<ThreadId>();
      const rows = [];
      for (let index = 0; index < queue.length; index += 1) {
        const row = queue[index]!;
        if (seen.has(row.threadId)) continue;
        seen.add(row.threadId);
        const ref = { environmentId, threadId: row.threadId };
        const pending = get(details.pendingRequestsAtom(ref));
        const children = get(details.turnSubagentsAtom(ref));
        rows.push({ row, pending });
        for (const child of children?.subagents ?? []) {
          if (!child.childThreadId) continue;
          queue.push({
            key: child.id,
            threadId: child.childThreadId,
            kind: "Subagent",
            title: child.title ?? "Delegated task",
            status: child.status,
            running: ["running", "pending", "waiting", "idle"].includes(child.status),
            failed: child.status === "failed",
            startedAt: DateTime.formatIso(child.startedAt ?? child.updatedAt),
          });
        }
      }
      return rows;
    }).pipe(Atom.setIdleTTL(0));
  });
}
