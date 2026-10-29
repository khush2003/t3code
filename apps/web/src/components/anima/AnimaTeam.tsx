import { useAtomValue } from "@effect/atom-react";
import { CrownIcon, UserMinusIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { AnimaDetail, AnimaName, AnimaSummary, EnvironmentId } from "@t3tools/contracts";

import { requestConfirmDialog } from "../../confirmDialog";
import { animaEnvironment, useAnimaList } from "../../state/anima";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  AnimaBlock,
  AnimaEmptyNote,
  AnimaLiveDot,
  RelativeTime,
  useAnimaMutation,
} from "./AnimaBits";
import { AnimaHealthRing } from "./AnimaHealth";
import { AnimaSigil } from "./AnimaVisuals";

const TEAM_ROLES = new Set(["lead", "architect"]);

function TeamCard({
  name,
  summary,
  onOpen,
  action,
}: {
  readonly name: string;
  readonly summary: AnimaSummary | undefined;
  readonly onOpen: (name: string) => void;
  readonly action?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-border/60 bg-card pe-1.5 transition-colors hover:border-border">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => onOpen(name)}
      >
        {summary ? (
          <AnimaSigil anima={summary} size={36} />
        ) : (
          <span className="size-9 shrink-0 rounded-full border border-dashed border-border" />
        )}
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{name}</span>
            {summary ? <AnimaLiveDot live={summary.live} /> : null}
          </span>
          <span className="block truncate text-2xs text-muted-foreground">
            {summary
              ? (summary.aim ?? (
                  <>
                    active <RelativeTime value={summary.lastActiveAt} />
                  </>
                ))
              : "Not on this environment"}
          </span>
        </span>
        {summary ? <AnimaHealthRing score={summary.health} size={20} /> : null}
      </button>
      {action}
    </li>
  );
}

export function AnimaTeamSection({
  environmentId,
  detail,
  onOpenAnima,
}: {
  readonly environmentId: EnvironmentId;
  readonly detail: AnimaDetail;
  readonly onOpenAnima: (name: string) => void;
}) {
  const { summary, team, lead } = detail;
  const canOperate = useAtomValue(animaEnvironment.team.permissionAtom(environmentId));
  const { animas } = useAnimaList(environmentId);
  const [candidate, setCandidate] = useState("");
  const run = useAnimaMutation(animaEnvironment.team, { failureTitle: "Could not change team" });
  const leads = team.length > 0 || TEAM_ROLES.has(summary.role);
  if (!leads && lead === null) return null;
  const byName = new Map(animas.map((anima) => [anima.name, anima]));
  const candidates = animas.filter(
    (anima) => anima.name !== summary.name && !team.includes(anima.name),
  );
  const add = async () => {
    if (candidate === "") return;
    const result = await run({
      environmentId,
      input: { lead: summary.name, action: "add", member: candidate as AnimaName },
    });
    if (result) setCandidate("");
  };
  const remove = async (member: string) => {
    const confirmed =
      (await requestConfirmDialog(`Remove ${member} from ${summary.name}'s team?`, {
        variant: "destructive",
      })) ?? window.confirm(`Remove ${member}?`);
    if (!confirmed) return;
    await run({
      environmentId,
      input: { lead: summary.name, action: "remove", member: member as AnimaName },
    });
  };
  return (
    <div className="space-y-5">
      {lead !== null ? (
        <AnimaBlock title="Led by">
          <ul>
            <TeamCard name={lead} summary={byName.get(lead)} onOpen={onOpenAnima} />
          </ul>
        </AnimaBlock>
      ) : null}
      {leads ? (
        <AnimaBlock title="Team" count={team.length}>
          {team.length === 0 ? (
            <AnimaEmptyNote icon={<UsersIcon />} title="No members yet">
              Members take direction from {summary.name} and show up here with their health.
            </AnimaEmptyNote>
          ) : (
            <ul className="grid gap-2 @lg/anima:grid-cols-2">
              {team.map((member) => (
                <TeamCard
                  key={member}
                  name={member}
                  summary={byName.get(member)}
                  onOpen={onOpenAnima}
                  action={
                    <Button
                      size="icon-xs"
                      variant="ghost-destructive"
                      aria-label={`Remove ${member} from the team`}
                      disabled={!canOperate}
                      onClick={() => void remove(member)}
                    >
                      <UserMinusIcon />
                    </Button>
                  }
                />
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <div className="w-48">
              <Select value={candidate} onValueChange={(value) => setCandidate(String(value))}>
                <SelectTrigger size="sm" aria-label="Anima to add to the team">
                  <SelectValue>{candidate === "" ? "Add a member…" : candidate}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {candidates.map((anima) => (
                    <SelectItem key={anima.name} value={anima.name} label={anima.name}>
                      {anima.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <Button
              size="xs"
              variant="outline"
              disabled={!canOperate || candidate === ""}
              onClick={() => void add()}
            >
              <UserPlusIcon />
              Add
            </Button>
          </div>
        </AnimaBlock>
      ) : null}
    </div>
  );
}

export function AnimaTeamChip({
  detail,
  onOpenAnima,
}: {
  readonly detail: AnimaDetail;
  readonly onOpenAnima: (name: string) => void;
}) {
  if (detail.lead !== null) {
    const lead = detail.lead;
    return (
      <Button size="micro" variant="ghost-muted" onClick={() => onOpenAnima(lead)}>
        <CrownIcon />
        Led by {lead}
      </Button>
    );
  }
  if (detail.team.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <UsersIcon className="size-3" />
      leads {detail.team.length}
    </span>
  );
}
