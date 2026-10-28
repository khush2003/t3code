import { useAtomValue } from "@effect/atom-react";
import { CheckCircle2Icon, CircleDotIcon, FolderXIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import type {
  AnimaDetail,
  AnimaName,
  AnimaOpen,
  AnimaOpensAction,
  EnvironmentId,
} from "@t3tools/contracts";

import { requestConfirmDialog } from "../../../confirmDialog";
import { animaEnvironment, useAnimaList } from "../../../state/anima";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../ui/empty";
import { Input } from "../../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Textarea } from "../../ui/textarea";
import { ANIMA_OPEN_STATUSES, groupOpens, isAnimaOpenStatus } from "../animaSettings.logic";
import { AnimaBlock, AnimaEmptyNote, Field, useAnimaMutation } from "./AnimaBits";

const STATUS_VARIANTS: Readonly<Record<string, "error" | "info" | "secondary" | "outline">> = {
  blocked: "error",
  active: "info",
  watching: "secondary",
  closed: "outline",
};

const DEFAULT_ASSIGNEE = "__default__";

function AssigneeSelect({
  value,
  names,
  defaultLabel,
  disabled,
  onChange,
}: {
  readonly value: string;
  readonly names: ReadonlyArray<string>;
  readonly defaultLabel?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={(next) => onChange(String(next))}>
      <SelectTrigger size="sm" aria-label="Assignee">
        <SelectValue>
          {value === DEFAULT_ASSIGNEE ? (defaultLabel ?? "Unassigned") : `@${value}`}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {defaultLabel ? (
          <SelectItem value={DEFAULT_ASSIGNEE} label={defaultLabel}>
            {defaultLabel}
          </SelectItem>
        ) : null}
        {names.map((name) => (
          <SelectItem key={name} value={name} label={name}>
            {name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function OpenCard({
  open,
  environmentId,
  owner,
  names,
  canOperate,
}: {
  readonly open: AnimaOpen;
  readonly environmentId: EnvironmentId;
  readonly owner: AnimaName;
  readonly names: ReadonlyArray<string>;
  readonly canOperate: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [resolves, setResolves] = useState(open.resolves ?? "");
  const [context, setContext] = useState(open.context ?? "");
  const run = useAnimaMutation(animaEnvironment.opensAction, {
    failureTitle: `Could not update ${open.id}`,
  });
  const closed = open.status.toLowerCase() === "closed";
  const act = (action: AnimaOpensAction) => run({ environmentId, input: { name: owner, action } });
  const save = async () => {
    const nextResolves = resolves.trim();
    const nextContext = context.trim();
    const result = await act({
      type: "update",
      id: open.id,
      ...(nextResolves !== "" && nextResolves !== open.resolves ? { resolves: nextResolves } : {}),
      ...(nextContext !== "" && nextContext !== open.context ? { context: nextContext } : {}),
    });
    if (result) setEditing(false);
  };
  const close = async () => {
    const confirmed =
      (await requestConfirmDialog(`Close ${open.id}?\n${open.question}`)) ??
      window.confirm(`Close ${open.id}?`);
    if (confirmed) await act({ type: "close", id: open.id });
  };
  const assignee = open.assignee && names.includes(open.assignee) ? open.assignee : null;
  return (
    <li className="space-y-2 rounded-lg border border-border/60 bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        <Badge size="sm" variant={STATUS_VARIANTS[open.status.toLowerCase()] ?? "outline"}>
          {open.status}
        </Badge>
        <span className="font-mono">{open.id}</span>
        {open.openedBy ? <span>by {open.openedBy}</span> : null}
        {open.openedAt ? <span>{open.openedAt}</span> : null}
        {!closed ? (
          <span className="ms-auto flex items-center gap-0.5">
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={`Edit ${open.id}`}
              disabled={!canOperate}
              onClick={() => {
                setResolves(open.resolves ?? "");
                setContext(open.context ?? "");
                setEditing((value) => !value);
              }}
            >
              <PencilIcon />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={`Close ${open.id}`}
              disabled={!canOperate}
              onClick={() => void close()}
            >
              <CheckCircle2Icon />
            </Button>
          </span>
        ) : null}
      </div>
      <p className="text-sm font-medium leading-snug">{open.question}</p>
      {editing ? (
        <div className="space-y-2">
          <Field label="Resolves when" htmlFor={`${open.id}-resolves`}>
            <Input
              id={`${open.id}-resolves`}
              size="sm"
              value={resolves}
              onChange={(event) => setResolves(event.target.value)}
            />
          </Field>
          <Field label="Context" htmlFor={`${open.id}-context`}>
            <Textarea
              id={`${open.id}-context`}
              size="sm"
              value={context}
              onChange={(event) => setContext(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="xs" onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          {open.resolves ? (
            <p className="text-xs text-foreground/80">
              <span className="text-muted-foreground">Resolves when </span>
              {open.resolves}
            </p>
          ) : null}
          {open.context ? (
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{open.context}</p>
          ) : null}
        </>
      )}
      {open.related && open.related.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {open.related.map((related) => (
            <Badge key={related} size="sm" variant="outline">
              {related}
            </Badge>
          ))}
        </div>
      ) : null}
      {!closed ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
          <div className="w-32">
            <Select
              value={isAnimaOpenStatus(open.status) ? open.status : ""}
              disabled={!canOperate}
              onValueChange={(value) => {
                if (isAnimaOpenStatus(value) && value !== open.status) {
                  void act({ type: "update", id: open.id, status: value });
                }
              }}
            >
              <SelectTrigger size="sm" aria-label={`Status of ${open.id}`}>
                <SelectValue>{open.status}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {ANIMA_OPEN_STATUSES.map((status) => (
                  <SelectItem key={status} value={status} label={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <div className="w-40">
            <AssigneeSelect
              value={assignee ?? DEFAULT_ASSIGNEE}
              names={names}
              defaultLabel={open.assignee && !assignee ? `@${open.assignee}` : "Unassigned"}
              disabled={!canOperate}
              onChange={(value) => {
                if (value !== DEFAULT_ASSIGNEE && value !== open.assignee) {
                  void act({ type: "assign", id: open.id, assignee: value as AnimaName });
                }
              }}
            />
          </div>
        </div>
      ) : open.assignee ? (
        <p className="text-2xs text-muted-foreground">@{open.assignee}</p>
      ) : null}
    </li>
  );
}

function NewOpenForm({
  environmentId,
  owner,
  names,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  readonly owner: AnimaName;
  readonly names: ReadonlyArray<string>;
  readonly onDone: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [resolves, setResolves] = useState("");
  const [context, setContext] = useState("");
  const [assignee, setAssignee] = useState(DEFAULT_ASSIGNEE);
  const [saving, setSaving] = useState(false);
  const run = useAnimaMutation(animaEnvironment.opensAction, {
    failureTitle: "Could not open the question",
    successTitle: "Question opened",
  });
  const valid = question.trim() !== "" && resolves.trim() !== "";
  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const result = await run({
      environmentId,
      input: {
        name: owner,
        action: {
          type: "add",
          question: question.trim(),
          resolves: resolves.trim(),
          ...(assignee === DEFAULT_ASSIGNEE ? {} : { assignee: assignee as AnimaName }),
          ...(context.trim() === "" ? {} : { context: context.trim() }),
        },
      },
    });
    setSaving(false);
    if (result) onDone();
  };
  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-card px-3 py-3">
      <Field label="Question" htmlFor="open-question">
        <Textarea
          id="open-question"
          size="sm"
          autoFocus
          value={question}
          placeholder="Should the roster poll or subscribe?"
          onChange={(event) => setQuestion(event.target.value)}
        />
      </Field>
      <Field label="Resolves when" htmlFor="open-resolves">
        <Input
          id="open-resolves"
          size="sm"
          value={resolves}
          placeholder="A benchmark shows which is cheaper"
          onChange={(event) => setResolves(event.target.value)}
        />
      </Field>
      <div className="grid gap-3 @lg/anima:grid-cols-[12rem_1fr]">
        <Field label="Assignee">
          <AssigneeSelect
            value={assignee}
            names={names}
            defaultLabel={`${owner} (default)`}
            onChange={setAssignee}
          />
        </Field>
        <Field label="Context" hint="Optional" htmlFor="open-context">
          <Input
            id="open-context"
            size="sm"
            value={context}
            onChange={(event) => setContext(event.target.value)}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="xs" disabled={!valid || saving} onClick={() => void submit()}>
          {saving ? "Opening…" : "Open question"}
        </Button>
      </div>
    </div>
  );
}

export function OpensTab({
  environmentId,
  detail,
  onAttach,
}: {
  readonly environmentId: EnvironmentId;
  readonly detail: AnimaDetail;
  readonly onAttach: () => void;
}) {
  const owner = detail.summary.name;
  const canOperate = useAtomValue(animaEnvironment.opensAction.permissionAtom(environmentId));
  const { animas } = useAnimaList(environmentId);
  const [adding, setAdding] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  if (detail.projectPath === null) {
    return (
      <Empty size="compact">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderXIcon />
          </EmptyMedia>
          <EmptyTitle>No project directory</EmptyTitle>
          <EmptyDescription>
            Open questions live in the anima's project directory, and {owner} has none yet. Attach
            it to a project to start a board.
          </EmptyDescription>
          <Button size="sm" variant="outline" onClick={onAttach}>
            Attach a project
          </Button>
        </EmptyHeader>
      </Empty>
    );
  }
  const names = animas.map((anima) => anima.name);
  const { live, closed } = groupOpens(detail.opens);
  return (
    <div className="space-y-4 px-3 py-3 sm:px-4">
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">
          {detail.projectPath}
        </span>
        <Button
          size="xs"
          className="ms-auto"
          disabled={!canOperate || adding}
          onClick={() => setAdding(true)}
        >
          <PlusIcon />
          New open
        </Button>
      </div>
      {adding ? (
        <NewOpenForm
          environmentId={environmentId}
          owner={owner}
          names={names}
          onDone={() => setAdding(false)}
        />
      ) : null}
      <AnimaBlock title="Open" count={live.length}>
        {live.length === 0 ? (
          <AnimaEmptyNote icon={<CircleDotIcon />} title="Nothing open">
            Questions that block or steer the work go here until something resolves them.
          </AnimaEmptyNote>
        ) : (
          <ul className="space-y-2">
            {live.map((open) => (
              <OpenCard
                key={open.id}
                open={open}
                environmentId={environmentId}
                owner={owner}
                names={names}
                canOperate={canOperate}
              />
            ))}
          </ul>
        )}
      </AnimaBlock>
      {closed.length > 0 ? (
        <AnimaBlock
          title="Closed"
          count={closed.length}
          action={
            <Button size="micro" variant="ghost-muted" onClick={() => setShowClosed((v) => !v)}>
              {showClosed ? "Hide" : "Show"}
            </Button>
          }
        >
          {showClosed ? (
            <ul className="space-y-2">
              {closed.map((open) => (
                <OpenCard
                  key={open.id}
                  open={open}
                  environmentId={environmentId}
                  owner={owner}
                  names={names}
                  canOperate={canOperate}
                />
              ))}
            </ul>
          ) : null}
        </AnimaBlock>
      ) : null}
    </div>
  );
}
