import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiative, EnvironmentId } from "@t3tools/contracts";
import { ArrowUpRightIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { AtlasPendingRequests } from "./AtlasPendingRequests";
import { atlasAgentPriority, collectAtlasAgentRows } from "./atlasControlLogic";
import { reviewLaunchError } from "./atlasLogic";
import { atlasAgentDetailsAtom } from "./atlasAgentDetails";

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
    atlasAgentDetailsAtom([environmentId, ...baseRows.map((row) => row.threadId)].join("\n")),
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
  const failedLaunches = initiative.tasks.flatMap((task) => {
    const error = reviewLaunchError(task);
    return error ? [{ task, error }] : [];
  });
  return (
    <section className="flex min-w-0 flex-col" aria-label="Agents">
      <div className="space-y-1.5 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-sm">Agents</h2>
          <span className="text-muted-foreground text-xs tabular-nums">
            {rows.length} thread{rows.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-live="polite">
          <span
            className={cn(
              "flex items-center gap-1.5",
              needsInput > 0 ? "font-medium text-warning-foreground" : "text-muted-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                needsInput > 0 ? "bg-warning" : "bg-muted-foreground/30",
              )}
            />
            {needsInput} waiting on you
          </span>
          <span
            className={cn(
              "flex items-center gap-1.5",
              running > 0 ? "text-info-foreground" : "text-muted-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                running > 0 ? "bg-info" : "bg-muted-foreground/30",
              )}
            />
            {running} running
          </span>
        </p>
      </div>
      {failedLaunches.length > 0 ? (
        <ul className="border-t" aria-label="Reviews that could not start">
          {failedLaunches.map(({ task, error }) => (
            <li
              key={task.id}
              className="min-w-0 space-y-1 border-b border-l-2 border-l-warning bg-warning/6 py-3 pr-4 pl-3.5 text-xs"
            >
              <p className="font-medium text-warning-foreground">Review could not start</p>
              <p className="line-clamp-2 text-sm leading-snug wrap-anywhere">
                #{task.ordinal + 1} {task.title}
              </p>
              <p className="line-clamp-3 text-muted-foreground wrap-anywhere">{error}</p>
              <p className="text-muted-foreground">
                Retry from the task&apos;s Agent review action.
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length === 0 ? (
        <div className="mx-4 mb-4 rounded-lg border border-dashed p-4">
          <p className="font-medium text-sm">No agents yet</p>
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
            Plan the initiative or run a task. Questions and approval requests show up here while
            other agents keep working.
          </p>
        </div>
      ) : (
        <ul className="border-t">
          {visible.map(({ row, pending }) => {
            const waiting =
              pending !== null && pending.approvals.length + pending.userInputs.length > 0;
            const tone = waiting
              ? "bg-warning"
              : row.failed
                ? "bg-destructive"
                : row.running
                  ? "bg-info"
                  : "bg-muted-foreground/30";
            return (
              <li
                key={row.threadId}
                className={cn(
                  "min-w-0 space-y-3 border-b px-4 py-3",
                  waiting && "border-l-2 border-l-warning bg-warning/6 pl-3.5",
                )}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone)} />
                    <span className="truncate text-muted-foreground">{row.kind}</span>
                    <span
                      className={cn(
                        "shrink-0",
                        waiting
                          ? "font-medium text-warning-foreground"
                          : row.failed
                            ? "text-destructive-foreground"
                            : row.running
                              ? "text-info-foreground"
                              : "text-muted-foreground",
                      )}
                    >
                      {waiting ? "Needs you" : row.status}
                    </span>
                    <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                      {formatRelativeTimeLabel(row.startedAt)}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 min-w-0 text-sm leading-snug wrap-anywhere">
                      {row.title}
                    </p>
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label={`Open ${row.kind} thread`}
                      render={
                        <Link
                          to="/$environmentId/$threadId"
                          params={{ environmentId, threadId: row.threadId }}
                        />
                      }
                    >
                      <ArrowUpRightIcon />
                    </Button>
                  </div>
                </div>
                {waiting ? (
                  <AtlasPendingRequests
                    threadRef={{ environmentId, threadId: row.threadId }}
                    pending={pending}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {active.length > 0 && history.length > 0 ? (
        <div className="px-2 py-2">
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() => setShowHistory((previous) => !previous)}
          >
            {showHistory ? "Hide finished threads" : `Show ${history.length} finished threads`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
