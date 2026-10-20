import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { AtlasInitiative, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  BotIcon,
  CheckCheckIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  EyeIcon,
  FileTextIcon,
  FlagIcon,
  ListChecksIcon,
  MessageCircleQuestionIcon,
  PlayIcon,
  TriangleAlertIcon,
  WandSparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { AtlasInitiativeCard } from "./AtlasInitiativeCard";
import {
  describeProjectSummary,
  initiativeIsActive,
  overviewHeadline,
  type AtlasAttentionItem,
  type AtlasAttentionKind,
  type AtlasProjectSummary,
} from "./atlasDashboardLogic";

const RECENT_LIMIT = 6;
const PROJECT_LIMIT = 8;

const ATTENTION_ICON: Record<AtlasAttentionKind, { icon: LucideIcon; tone: string }> = {
  input: { icon: MessageCircleQuestionIcon, tone: "bg-warning/12 text-warning-foreground" },
  review: { icon: EyeIcon, tone: "bg-warning/12 text-warning-foreground" },
  adjustment: { icon: WandSparklesIcon, tone: "bg-info/12 text-info-foreground" },
  plan_ready: { icon: ListChecksIcon, tone: "bg-info/12 text-info-foreground" },
  review_failed: { icon: TriangleAlertIcon, tone: "bg-destructive/10 text-destructive-foreground" },
  failed: { icon: TriangleAlertIcon, tone: "bg-destructive/10 text-destructive-foreground" },
  planner_failed: {
    icon: TriangleAlertIcon,
    tone: "bg-destructive/10 text-destructive-foreground",
  },
};

function StatTile({
  icon: Icon,
  label,
  value,
  caption,
  highlight = false,
  children,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: string | number;
  readonly caption: string;
  readonly highlight?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground",
        highlight && "border-warning/40 bg-warning/6",
      )}
    >
      <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <Icon aria-hidden className="size-3.5" />
        {label}
      </span>
      <span
        className={cn(
          "font-semibold text-2xl tracking-tight tabular-nums",
          highlight && "text-warning-foreground",
        )}
      >
        {value}
      </span>
      {children}
      <span className="truncate text-muted-foreground text-xs">{caption}</span>
    </div>
  );
}

function SectionHeading({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count?: number;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-baseline gap-2 font-semibold text-sm">
        {title}
        {count !== undefined ? (
          <span className="font-normal text-muted-foreground text-xs tabular-nums">{count}</span>
        ) : null}
      </h2>
      {children}
    </div>
  );
}

function AttentionList({
  environmentId,
  items,
  projectsById,
}: {
  readonly environmentId: EnvironmentId;
  readonly items: ReadonlyArray<AtlasAttentionItem>;
  readonly projectsById: ReadonlyMap<ProjectId, EnvironmentProject>;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 5);
  return (
    <section aria-label="Needs your attention" className="space-y-3">
      <SectionHeading title="Needs your attention" count={items.length} />
      {items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-3.5">
          <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-success-foreground" />
          <p className="text-muted-foreground text-sm">
            You are all caught up. Reviews, questions, and proposed plans show up here.
          </p>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {visible.map((item) => {
            const { icon: Icon, tone } = ATTENTION_ICON[item.kind];
            const project = projectsById.get(item.initiative.projectId);
            return (
              <li key={item.key}>
                <Link
                  to="/atlas"
                  search={{
                    environmentId,
                    projectId: item.initiative.projectId,
                    initiativeId: item.initiative.id,
                  }}
                  className="group flex min-w-0 items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/60"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      tone,
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-sm">
                      {item.task ? `#${item.task.ordinal + 1} ${item.task.title}` : item.label}
                    </span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {item.task ? `${item.label} · ` : ""}
                      {item.initiative.title}
                    </span>
                  </span>
                  {project ? (
                    <span className="hidden min-w-0 max-w-40 items-center gap-1.5 text-muted-foreground text-xs sm:flex">
                      <ProjectFavicon project={project} className="size-3.5 shrink-0" />
                      <span className="truncate">{project.title}</span>
                    </span>
                  ) : null}
                  <ChevronRightIcon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 5 ? (
        <Button size="xs" variant="ghost-muted" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show less" : `Show ${items.length - 5} more`}
        </Button>
      ) : null}
    </section>
  );
}

function ProjectList({
  environmentId,
  projects,
  summaries,
  onStart,
}: {
  readonly environmentId: EnvironmentId;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly summaries: ReadonlyMap<ProjectId, AtlasProjectSummary>;
  readonly onStart: (projectId: ProjectId) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? projects : projects.slice(0, PROJECT_LIMIT);
  return (
    <section aria-label="Projects" className="space-y-3">
      <SectionHeading title="Projects" count={projects.length} />
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {visible.map((project) => {
          const summary = summaries.get(project.id);
          const hasWork = summary !== undefined && summary.initiatives.length > 0;
          return (
            <li key={project.id} className="relative">
              <Link
                to="/atlas"
                search={{ environmentId, projectId: project.id }}
                className={cn(
                  "flex min-w-0 items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/60",
                  !hasWork && "pr-24",
                )}
              >
                <ProjectFavicon project={project} className="size-6 shrink-0" />
                <span className="min-w-0 flex-1 space-y-1.5">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-sm">{project.title}</span>
                    {summary && summary.running > 0 ? (
                      <span
                        aria-label={`${summary.running} agents running`}
                        className="size-1.5 shrink-0 rounded-full bg-info"
                      />
                    ) : null}
                  </span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {summary ? describeProjectSummary(summary) : "No initiatives yet"}
                  </span>
                  {hasWork && summary.total > 0 ? (
                    <span className="block h-1 overflow-hidden rounded-full bg-muted-foreground/15">
                      <span
                        className="block h-full rounded-full bg-success"
                        style={{ width: `${(summary.approved / summary.total) * 100}%` }}
                      />
                    </span>
                  ) : null}
                </span>
              </Link>
              {hasWork ? null : (
                <Button
                  size="xs"
                  variant="ghost-muted"
                  className="absolute top-1/2 right-3 -translate-y-1/2"
                  onClick={() => onStart(project.id)}
                >
                  <PlayIcon />
                  Start
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {projects.length > PROJECT_LIMIT ? (
        <Button size="xs" variant="ghost-muted" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show fewer projects" : `Show all ${projects.length} projects`}
        </Button>
      ) : null}
    </section>
  );
}

const ONBOARDING_STEPS: ReadonlyArray<{
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string;
}> = [
  {
    icon: FileTextIcon,
    title: "Write a brief",
    body: "Describe the outcome and what must be true when it is done.",
  },
  {
    icon: ListChecksIcon,
    title: "Review the plan",
    body: "A planning agent breaks it into tasks with dependencies and acceptance criteria.",
  },
  {
    icon: BotIcon,
    title: "Run and review",
    body: "Agents work tasks in parallel. You approve results or ask for changes.",
  },
];

function AtlasOnboarding({
  projects,
  onStart,
}: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly onStart: (projectId: ProjectId) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-5 pt-12 pb-16 sm:px-8 sm:pt-16">
      <header className="space-y-3">
        <h1 className="text-balance font-semibold text-3xl tracking-tight">
          Plan large work. Let agents carry it.
        </h1>
        <p className="max-w-[60ch] text-muted-foreground leading-relaxed">
          Atlas turns a brief into a plan of tasks, runs them across agents in parallel, and keeps
          you in the loop for every review and question.
        </p>
      </header>
      <ol className="grid gap-3 sm:grid-cols-3">
        {ONBOARDING_STEPS.map((step, index) => (
          <li key={step.title} className="space-y-2 rounded-xl border bg-card p-4">
            <span className="flex items-center gap-2 text-muted-foreground text-xs">
              <step.icon aria-hidden className="size-3.5" />
              Step {index + 1}
            </span>
            <p className="font-medium text-sm">{step.title}</p>
            <p className="text-muted-foreground text-xs leading-relaxed">{step.body}</p>
          </li>
        ))}
      </ol>
      <section aria-label="Choose a project" className="space-y-3">
        <SectionHeading title="Pick a project to start in" />
        {projects.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-3.5 text-muted-foreground text-sm">
            Add a project from the sidebar first. Atlas plans work inside a project&apos;s
            workspace.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => onStart(project.id)}
                  className="group flex w-full min-w-0 items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left outline-none transition-colors hover:border-foreground/20 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <ProjectFavicon project={project} className="size-6 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-sm">{project.title}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {project.workspaceRoot}
                    </span>
                  </span>
                  <ChevronRightIcon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function AtlasOverview({
  environmentId,
  environmentLabel,
  projects,
  summaries,
  initiatives,
  attention,
  runningAgents,
  onStart,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly summaries: ReadonlyMap<ProjectId, AtlasProjectSummary>;
  readonly initiatives: ReadonlyArray<AtlasInitiative>;
  readonly attention: ReadonlyArray<AtlasAttentionItem>;
  readonly runningAgents: number;
  readonly onStart: (projectId: ProjectId) => void;
}) {
  const [showAllRecent, setShowAllRecent] = useState(false);
  if (initiatives.length === 0) {
    return <AtlasOnboarding projects={projects} onStart={onStart} />;
  }

  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const active = initiatives.filter(initiativeIsActive).length;
  const completed = initiatives.filter((initiative) => initiative.status === "completed").length;
  let approved = 0;
  let total = 0;
  let ready = 0;
  for (const initiative of initiatives) {
    for (const task of initiative.tasks) {
      total += 1;
      if (task.status === "approved") approved += 1;
      else if (task.status === "proposed" && task.blockedBy.length === 0) ready += 1;
    }
  }
  const recent = showAllRecent ? initiatives : initiatives.slice(0, RECENT_LIMIT);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 pt-8 pb-16 sm:px-8">
      <header className="space-y-1.5">
        {environmentLabel ? (
          <p className="text-muted-foreground text-xs">{environmentLabel}</p>
        ) : null}
        <h1 className="font-semibold text-2xl tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {overviewHeadline({ waiting: attention.length, running: runningAgents, active })}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={FlagIcon}
          label="Needs you"
          value={attention.length}
          caption={attention.length === 0 ? "Nothing waiting" : "Reviews, questions, and plans"}
          highlight={attention.length > 0}
        />
        <StatTile
          icon={BotIcon}
          label="Agents working"
          value={runningAgents}
          caption={ready > 0 ? `${ready} task${ready === 1 ? "" : "s"} ready to run` : "Idle"}
        />
        <StatTile
          icon={ListChecksIcon}
          label="Active initiatives"
          value={active}
          caption={`${completed} completed · ${initiatives.length} total`}
        />
        <StatTile
          icon={CheckCheckIcon}
          label="Tasks approved"
          value={total === 0 ? "—" : `${approved}/${total}`}
          caption={
            total === 0
              ? "No tasks planned yet"
              : `${Math.round((approved / total) * 100)}% complete`
          }
        >
          {total > 0 ? (
            <span className="block h-1 overflow-hidden rounded-full bg-muted-foreground/15">
              <span
                className="block h-full rounded-full bg-success"
                style={{ width: `${(approved / total) * 100}%` }}
              />
            </span>
          ) : null}
        </StatTile>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <AttentionList
            environmentId={environmentId}
            items={attention}
            projectsById={projectsById}
          />
          <section aria-label="Recent initiatives" className="space-y-3">
            <SectionHeading title="Recent initiatives" count={initiatives.length} />
            <ul className="grid gap-3 sm:grid-cols-2">
              {recent.map((initiative) => (
                <li key={initiative.id} className="flex min-w-0">
                  <AtlasInitiativeCard
                    environmentId={environmentId}
                    initiative={initiative}
                    project={projectsById.get(initiative.projectId)}
                  />
                </li>
              ))}
            </ul>
            {initiatives.length > RECENT_LIMIT ? (
              <Button
                size="xs"
                variant="ghost-muted"
                onClick={() => setShowAllRecent((value) => !value)}
              >
                {showAllRecent ? "Show recent only" : `Show all ${initiatives.length}`}
              </Button>
            ) : null}
          </section>
        </div>
        <ProjectList
          environmentId={environmentId}
          projects={projects}
          summaries={summaries}
          onStart={onStart}
        />
      </div>
    </div>
  );
}
