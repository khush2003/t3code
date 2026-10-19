import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiative, EnvironmentId } from "@t3tools/contracts";
import { BotIcon, ExternalLinkIcon, MessageCircleQuestionIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { environmentThreadDetails } from "../../state/threads";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { AtlasPendingRequests } from "./AtlasPendingRequests";
import { atlasAgentPriority, collectAtlasAgentRows } from "./atlasControlLogic";
import { createAtlasAgentDetailsAtom } from "./atlasControlState";

const agentDetailsAtom = createAtlasAgentDetailsAtom(environmentThreadDetails);

export function AtlasAgentControlPane({
  environmentId,
  initiative,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: AtlasInitiative;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const baseRows = collectAtlasAgentRows(initiative);
  const baseByThread = new Map(baseRows.map((row) => [row.threadId, row]));
  const details = useAtomValue(
    agentDetailsAtom([environmentId, ...baseRows.map((row) => row.threadId)].join("\n")),
  );
  const rows = details
    .map(({ row, pending }) => ({ row: baseByThread.get(row.threadId) ?? row, pending }))
    .toSorted(
      (left, right) =>
        atlasAgentPriority(left.row, left.pending) - atlasAgentPriority(right.row, right.pending),
    );
  const needsInput = rows.filter(
    ({ pending }) => pending !== null && pending.approvals.length + pending.userInputs.length > 0,
  ).length;
  const running = rows.filter(({ row }) => row.running).length;
  const active = rows.filter(({ row, pending }) => atlasAgentPriority(row, pending) <= 1);
  const history = rows.filter(({ row, pending }) => atlasAgentPriority(row, pending) > 1);
  const visible = showHistory || active.length === 0 ? rows : active;
  return (
    <section className="min-w-0 rounded-lg border bg-card" aria-label="Atlas agent control">
      <div className="space-y-3 border-b px-4 py-4">
        <div className="flex items-center gap-2">
          <BotIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Agent control</h2>
        </div>
        <p className="text-xs text-muted-foreground">Follow every thread and answer agents here.</p>
        <div className="flex flex-wrap gap-2" aria-live="polite">
          <Badge variant={needsInput > 0 ? "warning" : "outline"}>{needsInput} need input</Badge>
          <Badge variant={running > 0 ? "info" : "outline"}>{running} running</Badge>
          <Badge variant="outline">{rows.length} threads</Badge>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="space-y-2 p-4">
          <p className="text-sm">Your agents will appear here.</p>
          <p className="text-xs text-muted-foreground">
            Start a planner or run a task. Questions and approval requests stay visible while other
            threads work.
          </p>
        </div>
      ) : (
        <ul className="divide-y">
          {visible.map(({ row, pending }) => {
            const waiting =
              pending !== null && pending.approvals.length + pending.userInputs.length > 0;
            return (
              <li key={row.threadId} className="min-w-0 space-y-3 px-4 py-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{row.kind}</span>
                    <Badge
                      variant={
                        waiting
                          ? "warning"
                          : row.failed
                            ? "error"
                            : row.running
                              ? "info"
                              : "outline"
                      }
                    >
                      {waiting ? "Needs input" : row.status}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium wrap-anywhere">{row.title}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTimeLabel(row.startedAt)}
                    </span>
                    <Button
                      size="sm"
                      variant="link"
                      render={
                        <Link
                          to="/$environmentId/$threadId"
                          params={{ environmentId, threadId: row.threadId }}
                        />
                      }
                    >
                      Open thread
                      <ExternalLinkIcon />
                    </Button>
                  </div>
                </div>
                {waiting ? (
                  <>
                    <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                      <MessageCircleQuestionIcon className="size-3.5" />
                      Waiting for your response
                    </p>
                    <AtlasPendingRequests
                      threadRef={{ environmentId, threadId: row.threadId }}
                      pending={pending}
                    />
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {active.length > 0 && history.length > 0 ? (
        <div className="border-t px-4 py-2">
          <Button size="sm" variant="ghost" onClick={() => setShowHistory((previous) => !previous)}>
            {showHistory ? "Hide settled threads" : `Show ${history.length} settled threads`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
