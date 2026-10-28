import { useAtomValue } from "@effect/atom-react";
import { CheckIcon, PencilIcon, ShieldCheckIcon, Trash2Icon, XIcon, ZapIcon } from "lucide-react";
import { useState } from "react";
import type { AnimaDetail, EnvironmentId } from "@t3tools/contracts";

import { requestConfirmDialog } from "../../../confirmDialog";
import { animaEnvironment } from "../../../state/anima";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import {
  type AnimaPolicyFireRow,
  type AnimaPolicySort,
  keyedLines,
  policyFireRows,
} from "../animaSettings.logic";
import {
  AnimaBlock,
  AnimaEmptyNote,
  AnimaStat,
  Field,
  Meter,
  RelativeTime,
  useAnimaMutation,
} from "./AnimaBits";

function PolicyRuleRow({
  row,
  pending,
  environmentId,
  name,
  canOperate,
}: {
  readonly row: AnimaPolicyFireRow;
  readonly pending: boolean;
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly canOperate: boolean;
}) {
  const { rule } = row;
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
    <li className="flex items-start gap-2 px-3 py-2.5 sm:px-4">
      <span className="mt-0.5 w-5 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">
        {rule.index}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
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
          <p className="text-sm">{rule.text}</p>
        )}
        {pending ? (
          <p className="text-2xs text-muted-foreground">Waiting for approval</p>
        ) : (
          <div className="grid grid-cols-[minmax(0,6rem)_1fr] items-center gap-x-3 gap-y-1">
            <Meter
              value={row.share}
              label={`${rule.fires} fires`}
              tone={row.neverFired ? "muted" : "primary"}
            />
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
              {row.neverFired ? (
                <Badge size="sm" variant="warning">
                  Never fired · prune candidate
                </Badge>
              ) : (
                <>
                  <span className="tabular-nums text-foreground/80">
                    {rule.fires} {rule.fires === 1 ? "fire" : "fires"}
                  </span>
                  <span>
                    last <RelativeTime value={rule.lastFiredAt} />
                  </span>
                </>
              )}
            </span>
          </div>
        )}
      </div>
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

export function PolicyTab({
  environmentId,
  detail,
}: {
  readonly environmentId: EnvironmentId;
  readonly detail: AnimaDetail;
}) {
  const { policy } = detail;
  const name = detail.summary.name;
  const canOperate = useAtomValue(animaEnvironment.policy.permissionAtom(environmentId));
  const run = useAnimaMutation(animaEnvironment.policy, {
    failureTitle: "Could not change policy",
  });
  const [rule, setRule] = useState("");
  const [direct, setDirect] = useState(false);
  const [sort, setSort] = useState<AnimaPolicySort>("order");
  const [showAudit, setShowAudit] = useState(false);
  const atCap = policy.operational.length >= policy.cap;
  const operational = policyFireRows(policy.operational, sort);
  const pending = policyFireRows(policy.pending, "order");
  const totalFires = policy.operational.reduce((sum, entry) => sum + entry.fires, 0);
  const neverFired = operational.filter((row) => row.neverFired).length;
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
    <div className="space-y-5 py-3">
      <div className="grid grid-cols-3 gap-2 px-3 sm:px-4">
        <AnimaStat
          label="Rules"
          value={`${policy.operational.length}/${policy.cap}`}
          tone={atCap ? "warning" : "default"}
        />
        <AnimaStat label="Fires" value={totalFires} />
        <AnimaStat
          label="Never fired"
          value={neverFired}
          tone={neverFired > 0 ? "warning" : "default"}
        />
      </div>
      <div className="px-3 sm:px-4">
        <AnimaBlock
          title={`Operational · rev ${policy.revision}`}
          action={
            <ToggleGroup
              aria-label="Sort rules"
              value={[sort]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "order" || value === "fires") setSort(value);
              }}
            >
              <Toggle value="order">Order</Toggle>
              <Toggle value="fires">
                <ZapIcon />
                Most fired
              </Toggle>
            </ToggleGroup>
          }
        >
          {operational.length === 0 ? (
            <AnimaEmptyNote icon={<ShieldCheckIcon />} title="No operational rules">
              Rules shape what this anima does at runtime. Add one below.
            </AnimaEmptyNote>
          ) : (
            <ul className="-mx-3 divide-y divide-border/50 sm:-mx-4">
              {operational.map((row) => (
                <PolicyRuleRow
                  key={row.rule.index}
                  row={row}
                  pending={false}
                  environmentId={environmentId}
                  name={name}
                  canOperate={canOperate}
                />
              ))}
            </ul>
          )}
        </AnimaBlock>
      </div>
      <div className="px-3 sm:px-4">
        <AnimaBlock
          title="Pending"
          count={pending.length}
          action={
            <Button
              size="xs"
              variant="outline"
              disabled={!canOperate || pending.length === 0}
              onClick={() =>
                void run({ environmentId, input: { name, action: { type: "apply" } } })
              }
            >
              Apply pending
            </Button>
          }
        >
          {pending.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing is waiting for approval.</p>
          ) : (
            <ul className="-mx-3 divide-y divide-border/50 sm:-mx-4">
              {pending.map((row) => (
                <PolicyRuleRow
                  key={row.rule.index}
                  row={row}
                  pending
                  environmentId={environmentId}
                  name={name}
                  canOperate={canOperate}
                />
              ))}
            </ul>
          )}
        </AnimaBlock>
      </div>
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
