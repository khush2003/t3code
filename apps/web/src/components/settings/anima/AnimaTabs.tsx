import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { CheckIcon, PencilIcon, Trash2Icon, WindIcon, XIcon } from "lucide-react";
import { useState } from "react";
import type { AnimaDetail, AnimaPolicyRule, EnvironmentId, ThreadId } from "@t3tools/contracts";

import { cn } from "../../../lib/utils";
import { requestConfirmDialog } from "../../../confirmDialog";
import { animaEnvironment } from "../../../state/anima";
import { useProjects, useThreadShell } from "../../../state/entities";
import { useEnvironmentQuery } from "../../../state/query";
import ChatMarkdown from "../../ChatMarkdown";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Switch } from "../../ui/switch";
import { SettingsGroup } from "../SettingsGroup";
import { SettingsSection } from "../settingsLayout";
import { breathNoteText, buildAnimaFeed, keyedLines } from "../animaSettings.logic";
import { AnimaAccentDot, Field, RelativeTime, TraitBars, useAnimaMutation } from "./AnimaBits";
import { StartAnimaThreadMenu } from "./StartAnimaThread";
import { AnimaHero, TraitRadar } from "./AnimaVisuals";

interface TabProps {
  readonly environmentId: EnvironmentId;
  readonly detail: AnimaDetail;
}

function Block({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function WakePreview({
  environmentId,
  name,
}: {
  readonly environmentId: EnvironmentId;
  readonly name: string;
}) {
  const query = useEnvironmentQuery(
    animaEnvironment.wakePreview({ environmentId, input: { name } }),
  );
  return (
    <pre className="max-h-72 overflow-auto rounded-md bg-muted/40 p-2 text-2xs whitespace-pre-wrap">
      {query.data?.payload ?? query.error ?? "Loading..."}
    </pre>
  );
}

export function OverviewTab({
  environmentId,
  detail,
  onSelectBreath,
}: TabProps & { readonly onSelectBreath: (index: number) => void }) {
  const { summary } = detail;
  const canOperate = useAtomValue(animaEnvironment.attach.permissionAtom(environmentId));
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const [projectId, setProjectId] = useState("");
  const [showWake, setShowWake] = useState(false);
  const attach = useAnimaMutation(animaEnvironment.attach, {
    failureTitle: "Could not attach project",
    successTitle: "Project attached",
  });
  const setEnabled = useAnimaMutation(animaEnvironment.setEnabled, {
    failureTitle: `Could not update ${summary.name}`,
  });
  const selected = projects.find((project) => project.id === projectId);
  return (
    <div className="space-y-5 px-3 py-3 sm:px-4">
      <AnimaHero summary={summary} breaths={detail.breaths} onSelectBreath={onSelectBreath} />
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {summary.live ? "A session is running with this anima." : "No active session."} Born{" "}
          <RelativeTime value={summary.born} />, active{" "}
          <RelativeTime value={summary.lastActiveAt} />.
        </div>
        <label className="flex items-center gap-2 text-xs">
          Enabled
          <Switch
            checked={summary.enabled}
            disabled={!canOperate}
            onCheckedChange={(enabled) =>
              void setEnabled({ environmentId, input: { name: summary.name, enabled } })
            }
          />
        </label>
      </div>
      {summary.aim ? (
        <Block title="Aim">
          <p className="text-sm">{summary.aim}</p>
        </Block>
      ) : null}
      {summary.voice ? (
        <Block title="Voice">
          <p className="text-sm text-foreground/90">{summary.voice}</p>
        </Block>
      ) : null}
      {summary.vow ? (
        <Block title="Vow">
          <p className="text-sm text-foreground/90">{summary.vow}</p>
        </Block>
      ) : null}
      {summary.memo ? (
        <Block title="Memo">
          <p className="whitespace-pre-wrap text-sm text-foreground/90">{summary.memo}</p>
        </Block>
      ) : null}
      <div className="grid gap-5 md:grid-cols-2">
        <Block title="Traits">
          <TraitRadar traits={detail.traits} />
          <TraitBars traits={detail.traits} empty="No traits recorded yet." />
        </Block>
        <Block title="Skills">
          <TraitRadar traits={detail.skills} />
          <TraitBars traits={detail.skills} empty="No skills recorded yet." />
        </Block>
      </div>
      {detail.header.length > 0 ? (
        <Block title="Header">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
            {detail.header.map((entry) => (
              <div key={entry.key} className="contents">
                <dt className="truncate text-muted-foreground">{entry.key}</dt>
                <dd className="min-w-0 break-words">{entry.value}</dd>
              </div>
            ))}
          </dl>
        </Block>
      ) : null}
      <Block title="Projects">
        <div className="flex flex-wrap gap-1.5">
          {summary.projects.length === 0 ? (
            <span className="text-xs text-muted-foreground">Not attached to any project.</span>
          ) : (
            summary.projects.map((project) => (
              <Badge key={project} variant="outline" size="sm">
                {project}
              </Badge>
            ))
          )}
        </div>
        <div className="flex items-center gap-2 pt-1.5">
          <Select value={projectId} onValueChange={(value) => setProjectId(String(value))}>
            <SelectTrigger size="sm" aria-label="Project to attach">
              <SelectValue>{selected?.title ?? "Attach to project..."}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id} label={project.title}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Button
            size="xs"
            variant="outline"
            disabled={!selected || !canOperate}
            onClick={() =>
              selected &&
              void attach({ environmentId, input: { name: summary.name, projectId: selected.id } })
            }
          >
            Attach
          </Button>
        </div>
      </Block>
      <Block title="Wake payload">
        <Button size="xs" variant="ghost-muted" onClick={() => setShowWake((value) => !value)}>
          {showWake ? "Hide" : "Preview what a new thread receives"}
        </Button>
        {showWake ? <WakePreview environmentId={environmentId} name={summary.name} /> : null}
      </Block>
    </div>
  );
}

export function IdentityTab({ environmentId, detail }: TabProps) {
  return (
    <div className="px-3 py-3 sm:px-4">
      {detail.identity.trim() === "" ? (
        <p className="text-xs text-muted-foreground">This anima has no identity file yet.</p>
      ) : (
        <ChatMarkdown text={detail.identity} cwd={undefined} environmentId={environmentId} />
      )}
    </div>
  );
}

function scrollIntoCenter(element: HTMLElement | null) {
  element?.scrollIntoView({ block: "center" });
}

function BreathRow({
  breath,
  focused,
}: {
  readonly breath: AnimaDetail["breaths"][number];
  readonly focused?: boolean;
}) {
  const note = breathNoteText(breath.note);
  return (
    <li
      ref={focused ? scrollIntoCenter : undefined}
      className={cn("space-y-1.5 px-3 py-2.5 sm:px-4", focused && "bg-accent/40")}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge size="sm" variant="outline">
          #{breath.index}
        </Badge>
        <RelativeTime value={breath.ts} />
        {breath.project ? <span className="truncate">{breath.project}</span> : null}
      </div>
      {note ? <p className="whitespace-pre-wrap text-sm">{note}</p> : null}
      {breath.aim ? <p className="text-xs text-muted-foreground">Aim: {breath.aim}</p> : null}
      {breath.decisions.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 text-xs">
          {breath.decisions.map((decision) => (
            <li key={decision}>{decision}</li>
          ))}
        </ul>
      ) : null}
      {breath.open.length > 0 ? (
        <p className="text-xs text-warning-foreground">Open: {breath.open.join("; ")}</p>
      ) : null}
      {breath.files.length > 0 ? (
        <p className="truncate font-mono text-2xs text-muted-foreground">
          {breath.files.length} {breath.files.length === 1 ? "file" : "files"}:{" "}
          {breath.files.join(", ")}
        </p>
      ) : null}
    </li>
  );
}

export function BreathsTab({
  environmentId,
  detail,
  allLoaded,
  onLoadAll,
  focusIndex,
}: TabProps & {
  readonly allLoaded: boolean;
  readonly onLoadAll: () => void;
  readonly focusIndex: number | null;
}) {
  const canBreathe = useAtomValue(animaEnvironment.breathe.permissionAtom(environmentId));
  const breathe = useAnimaMutation(animaEnvironment.breathe, {
    failureTitle: "Could not request a breath",
    successTitle: "Breath requested",
  });
  const [threadId, setThreadId] = useState<ThreadId | null>(null);
  const chosen = threadId ?? detail.threadIds[0] ?? null;
  const breaths = detail.breaths.toSorted((a, b) => b.index - a.index);
  const hasMore = !allLoaded && detail.summary.breathCount > detail.breaths.length;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2.5 sm:px-4">
        {chosen ? (
          <>
            {detail.threadIds.length > 1 ? (
              <Select value={chosen} onValueChange={(value) => setThreadId(value as ThreadId)}>
                <SelectTrigger size="sm" aria-label="Thread to breathe in">
                  <SelectValue>
                    <ThreadTitle environmentId={environmentId} threadId={chosen} />
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {detail.threadIds.map((id) => (
                    <SelectItem key={id} value={id} label={id}>
                      <ThreadTitle environmentId={environmentId} threadId={id} />
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : (
              <span className="text-xs text-muted-foreground">
                in <ThreadTitle environmentId={environmentId} threadId={chosen} />
              </span>
            )}
            <Button
              size="xs"
              variant="outline"
              disabled={!canBreathe}
              onClick={() => void breathe({ environmentId, input: { threadId: chosen } })}
            >
              <WindIcon className="size-3" />
              Breathe now
            </Button>
          </>
        ) : (
          <StartAnimaThreadMenu
            environmentId={environmentId}
            animaName={detail.summary.name}
            label="Start a thread to breathe"
          />
        )}
        <span className="ml-auto text-2xs text-muted-foreground">
          {detail.summary.breathCount} total
        </span>
      </div>
      {breaths.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground sm:px-4">No breaths yet.</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {breaths.map((breath) => (
            <BreathRow key={breath.index} breath={breath} focused={breath.index === focusIndex} />
          ))}
        </ul>
      )}
      {hasMore ? (
        <div className="border-t border-border/50 px-3 py-2.5 sm:px-4">
          <Button size="xs" variant="ghost-muted" onClick={onLoadAll}>
            Load all {detail.summary.breathCount} breaths
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ThreadTitle({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const shell = useThreadShell(scopeThreadRef(environmentId, threadId));
  return <span className="truncate">{shell?.title ?? threadId}</span>;
}

function PolicyRuleRow({
  rule,
  pending,
  environmentId,
  name,
  canOperate,
}: {
  readonly rule: AnimaPolicyRule;
  readonly pending: boolean;
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly canOperate: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(rule.text);
  const policy = useAnimaMutation(animaEnvironment.policy, {
    failureTitle: "Could not change rule",
  });
  const save = async () => {
    const trimmed = text.trim();
    if (trimmed === "" || trimmed === rule.text) return setEditing(false);
    const result = await policy({
      environmentId,
      input: { name, action: { type: "update", index: rule.index, rule: trimmed } },
    });
    if (result) setEditing(false);
  };
  const remove = async () => {
    const confirmed =
      (await requestConfirmDialog(`Remove this rule?\n${rule.text}`, { variant: "destructive" })) ??
      window.confirm("Remove this rule?");
    if (!confirmed) return;
    await policy({ environmentId, input: { name, action: { type: "remove", index: rule.index } } });
  };
  return (
    <li className="flex items-start gap-2 px-3 py-2 sm:px-4">
      <span className="mt-0.5 w-5 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">
        {rule.index}
      </span>
      {editing ? (
        <Input
          size="sm"
          autoFocus
          value={text}
          aria-label="Rule text"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
            if (event.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <p className="min-w-0 flex-1 text-sm">{rule.text}</p>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        {editing ? (
          <>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Save rule"
              onClick={() => void save()}
            >
              <CheckIcon />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Cancel"
              onClick={() => setEditing(false)}
            >
              <XIcon />
            </Button>
          </>
        ) : (
          <>
            {pending ? null : (
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Edit rule"
                disabled={!canOperate}
                onClick={() => {
                  setText(rule.text);
                  setEditing(true);
                }}
              >
                <PencilIcon />
              </Button>
            )}
            <Button
              size="icon-xs"
              variant="ghost-destructive"
              aria-label="Remove rule"
              disabled={!canOperate}
              onClick={() => void remove()}
            >
              <Trash2Icon />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

export function PolicyTab({ environmentId, detail }: TabProps) {
  const { policy } = detail;
  const name = detail.summary.name;
  const canOperate = useAtomValue(animaEnvironment.policy.permissionAtom(environmentId));
  const run = useAnimaMutation(animaEnvironment.policy, {
    failureTitle: "Could not change policy",
  });
  const [rule, setRule] = useState("");
  const [direct, setDirect] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const atCap = policy.operational.length >= policy.cap;
  const add = async () => {
    const text = rule.trim();
    if (text === "") return;
    const result = await run({
      environmentId,
      input: { name, action: { type: "add", rule: text, direct } },
    });
    if (result) setRule("");
  };
  return (
    <div className="space-y-4 py-3">
      <div className="flex items-center justify-between px-3 sm:px-4">
        <span className="text-xs text-muted-foreground">Revision {policy.revision}</span>
        <Badge variant={atCap ? "warning" : "outline"} size="sm">
          {policy.operational.length} / {policy.cap} rules
        </Badge>
      </div>
      <SettingsSection title="Operational rules" variant="plain">
        {policy.operational.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">No operational rules.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {policy.operational.map((entry) => (
              <PolicyRuleRow
                key={entry.index}
                rule={entry}
                pending={false}
                environmentId={environmentId}
                name={name}
                canOperate={canOperate}
              />
            ))}
          </ul>
        )}
      </SettingsSection>
      <SettingsSection
        title="Pending rules"
        variant="plain"
        headerAction={
          <Button
            size="xs"
            variant="outline"
            disabled={!canOperate || policy.pending.length === 0}
            onClick={() => void run({ environmentId, input: { name, action: { type: "apply" } } })}
          >
            Apply pending
          </Button>
        }
      >
        {policy.pending.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
            Nothing is waiting for approval.
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {policy.pending.map((entry) => (
              <PolicyRuleRow
                key={entry.index}
                rule={entry}
                pending
                environmentId={environmentId}
                name={name}
                canOperate={canOperate}
              />
            ))}
          </ul>
        )}
      </SettingsSection>
      <div className="space-y-2 px-3 sm:px-4">
        <Field
          label="Add a rule"
          hint={atCap && direct ? "At the cap: remove a rule first" : undefined}
        >
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              value={rule}
              placeholder="Always run the type checker before committing"
              aria-label="New rule"
              onChange={(event) => setRule(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void add();
              }}
            />
            <Button
              size="xs"
              disabled={!canOperate || rule.trim() === ""}
              onClick={() => void add()}
            >
              Add
            </Button>
          </div>
        </Field>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={direct} onCheckedChange={setDirect} />
          Apply directly instead of waiting for approval
        </label>
      </div>
      <div className="space-y-1 px-3 sm:px-4">
        <Button size="xs" variant="ghost-muted" onClick={() => setShowAudit((value) => !value)}>
          {showAudit ? "Hide audit log" : `Show audit log (${policy.audit.length})`}
        </Button>
        {showAudit ? (
          <ul className="max-h-64 space-y-1 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-2xs">
            {policy.audit.length === 0 ? <li>No entries.</li> : null}
            {keyedLines(policy.audit).map(({ key, line }) => (
              <li key={key}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function ActivityTab({ detail }: TabProps) {
  const feed = buildAnimaFeed(detail);
  if (feed.pinned.length === 0 && feed.items.length === 0) {
    return <p className="px-3 py-4 text-xs text-muted-foreground sm:px-4">No activity yet.</p>;
  }
  return (
    <ul className="divide-y divide-border/50">
      {feed.pinned.map((open) => (
        <li key={`open:${open.id}`} className="space-y-0.5 px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-2">
            <Badge size="sm" variant="warning">
              Open
            </Badge>
            <span className="text-2xs text-muted-foreground">
              {open.project}
              {open.assignee ? ` - ${open.assignee}` : ""}
            </span>
          </div>
          <p className="text-sm">{open.question}</p>
        </li>
      ))}
      {feed.items.map((item) =>
        item.kind === "message" ? (
          <li key={item.key} className="space-y-0.5 px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge size="sm" variant="info">
                {item.message.type}
              </Badge>
              <span>from {item.message.from}</span>
              <RelativeTime value={item.ts} />
            </div>
            <p className="whitespace-pre-wrap text-sm">{item.message.body}</p>
          </li>
        ) : (
          <BreathRow key={item.key} breath={item.breath} />
        ),
      )}
    </ul>
  );
}

function ThreadLinkRow({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const shell = useThreadShell(scopeThreadRef(environmentId, threadId));
  return (
    <li className="px-3 py-2 text-sm sm:px-4">
      {shell ? (
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId, threadId }}
          className="flex items-center justify-between gap-3 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="truncate">{shell.title || "Untitled thread"}</span>
          <RelativeTime value={shell.updatedAt} />
        </Link>
      ) : (
        <span className="text-muted-foreground">{threadId} (not loaded)</span>
      )}
    </li>
  );
}

export function ThreadsTab({ environmentId, detail }: TabProps) {
  return (
    <div>
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2.5 sm:px-4">
        <span className="text-xs text-muted-foreground">
          {detail.threadIds.length} {detail.threadIds.length === 1 ? "thread uses" : "threads use"}{" "}
          <AnimaAccentDot accent={detail.summary.accent} className="mx-1 size-1.5" />
          {detail.summary.name}
        </span>
        <StartAnimaThreadMenu environmentId={environmentId} animaName={detail.summary.name} />
      </div>
      {detail.threadIds.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground sm:px-4">
          No thread uses this anima yet.
        </p>
      ) : (
        <SettingsGroup variant="plain" divided={false}>
          <ul className="divide-y divide-border/50">
            {detail.threadIds.map((threadId) => (
              <ThreadLinkRow key={threadId} environmentId={environmentId} threadId={threadId} />
            ))}
          </ul>
        </SettingsGroup>
      )}
    </div>
  );
}
