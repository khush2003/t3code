import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { BotName, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import {
  ChevronRightIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  MessagesSquareIcon,
  PlusIcon,
} from "lucide-react";
import { useId, useState } from "react";

import { cn } from "~/lib/utils";
import { botsEnvironment } from "../../state/bots";
import { type BotMachine, resolveBotHome } from "./SidebarBots.logic";
import { botMainThreadId, isBotThreadId } from "../bots/botView";
import { BotAvatar } from "../bots/BotAvatar";
import { botMoodOf, useBotSummary, useOpenBotThread } from "../bots/useBot";
import { hasUnseenCompletion } from "../Sidebar.logic";

const botNameOfThread = (threadId: ThreadId) => botMainThreadId(threadId).replace(/^bot:/, "");
import {
  useConnectedEnvironmentIds,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../ui/sidebar";
import { Textarea } from "../ui/textarea";

const isBotName = Schema.is(BotName);

function StartBotDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onStarted: (environmentId: EnvironmentId, threadId: ThreadId) => void;
  readonly machines: readonly BotMachine[];
  readonly home: EnvironmentId;
}) {
  const gt = useGT();
  const id = useId();
  const start = useAtomCommand(botsEnvironment.start, { reportFailure: false });
  const [chosen, setChosen] = useState<EnvironmentId | null>(null);
  const environmentId =
    chosen !== null && props.machines.some((machine) => machine.environmentId === chosen)
      ? chosen
      : props.home;
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [oversees, setOversees] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const normalized = name.trim().toLowerCase().replaceAll(/\s+/g, "-");

  const submit = async () => {
    if (!isBotName(normalized)) {
      setError(gt("Use letters, numbers and dashes, starting with a letter or number."));
      return;
    }
    setStarting(true);
    const result = await start({
      environmentId,
      input: {
        name: normalized,
        ...(purpose.trim() === "" ? {} : { purpose: purpose.trim() }),
        ...(oversees ? { oversees: true } : {}),
      },
    });
    setStarting(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : gt("Could not start the bot."));
      }
      return;
    }
    setName("");
    setPurpose("");
    setOversees(false);
    setError(null);
    props.onStarted(environmentId, result.value.threadId);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              <T>Start a bot</T>
            </DialogTitle>
            <DialogDescription>
              <T>
                A bot keeps one conversation with you and runs the work as threads in your projects.
                Using an existing name reopens that bot.
              </T>
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-name`}>
                <T>Name</T>
                <Input
                  nativeInput
                  id={`${id}-name`}
                  autoFocus
                  required
                  placeholder="atlas"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError(null);
                  }}
                />
              </Label>
              <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-purpose`}>
                <T>What it is for</T>
                <Textarea
                  id={`${id}-purpose`}
                  rows={3}
                  placeholder={gt("Keep my app projects moving and tell me what needs me.")}
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                />
              </Label>
              {props.machines.length < 2 ? null : (
                <Label className="flex min-w-0 flex-col items-stretch">
                  <T>Runs on</T>
                  <Select
                    value={environmentId}
                    onValueChange={(value) => {
                      if (value !== null) setChosen(value as EnvironmentId);
                    }}
                  >
                    <SelectTrigger aria-label={gt("Machine the bot runs on")}>
                      <SelectValue>
                        {
                          props.machines.find((machine) => machine.environmentId === environmentId)
                            ?.label
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {props.machines.map((machine) => (
                        <SelectItem key={machine.environmentId} value={machine.environmentId}>
                          {machine.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <span className="text-muted-foreground text-xs font-normal">
                    <T>
                      Its memory stays on this machine, so keep your bots on one that is always on.
                    </T>
                  </span>
                </Label>
              )}
              <Label className="flex min-w-0 items-start">
                <Checkbox
                  className="mt-0.5 me-2"
                  checked={oversees}
                  onCheckedChange={(checked) => setOversees(checked === true)}
                />
                <span className="min-w-0">
                  <T>Oversees the other bots</T>
                  <span className="block text-muted-foreground text-xs font-normal">
                    <T>
                      It sees what every bot is working on and passes work to the one that fits, so
                      you can talk to it about all of them. Only a new bot can be given this.
                    </T>
                  </span>
                </span>
              </Label>
            </div>
            {error && (
              <p role="alert" className="mt-3 text-destructive">
                {error}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              <T>Cancel</T>
            </Button>
            <Button type="submit" disabled={starting}>
              <T>Start</T>
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** The Threads row leads with a slot as wide as a bot's avatar, so names line up. */
const LEAD_SLOT = "grid size-8 shrink-0 place-items-center";

/** One bot: its face, its name, and the one thing about it worth seeing from here. */
function BotRow(props: {
  readonly bot: EnvironmentThreadShell;
  readonly active: boolean;
  /** Where it runs, shown only when bots are spread over machines. */
  readonly machine: string | null;
  readonly onOpen: () => void;
}) {
  const gt = useGT();
  const { bot } = props;
  const summary = useBotSummary(bot.environmentId, bot.id);
  const waiting =
    (summary?.waitingOnYou ?? 0) + (bot.hasPendingUserInput || bot.hasPendingApprovals ? 1 : 0);
  const working = isThreadWorking(bot);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton size="lg" isActive={props.active} onClick={props.onOpen}>
        <BotAvatar
          environmentId={bot.environmentId}
          name={bot.title}
          look={summary?.look}
          size="md"
          mood={botMoodOf(bot, summary?.waitingOnYou ?? 0)}
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium text-sidebar-foreground">
              {bot.title}
            </span>
            {summary?.oversees === true ? (
              <span className="shrink-0 rounded-sm bg-foreground/10 px-1 text-2xs font-medium text-muted-foreground">
                <T>Lead</T>
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              "block truncate text-xs font-normal",
              waiting > 0 ? "text-warning" : working ? "text-primary" : "text-muted-foreground",
            )}
          >
            {waiting > 0
              ? gt("{count} waiting on you", { count: waiting })
              : working
                ? gt("Working")
                : (props.machine ?? (summary?.purpose || gt("No open work")))}
          </span>
        </span>
        {/* In a span: the row colours the icons that are its own children. */}
        {waiting > 0 ? (
          <span className="shrink-0 text-warning">
            <CircleAlertIcon aria-hidden className="size-4" />
          </span>
        ) : working ? (
          <span className="shrink-0 text-primary">
            <LoaderCircleIcon aria-hidden className="size-4" />
          </span>
        ) : hasUnseenCompletion(bot) ? (
          <span aria-label={gt("New reply")} className="size-2 shrink-0 rounded-full bg-primary" />
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function SidebarBots(props: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly routeThreadKey: string | null;
}) {
  const gt = useGT();
  const router = useRouter();
  const primary = usePrimaryEnvironmentId();
  const connected = useConnectedEnvironmentIds();
  const { environments } = useEnvironments();
  const [starting, setStarting] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const openThread = useOpenBotThread();
  const conversations = props.threads.filter(
    (thread) => thread.bot === true && thread.archivedAt === null,
  );
  // By name, so a bot keeps its place whichever one spoke last.
  const bots = conversations
    .filter((thread) => !isBotThreadId(thread.id))
    .toSorted((a, b) => a.title.localeCompare(b.title));
  // A thread opened and left without a message is not listed. Settled ones go last, so a thread
  // put away can still be found and brought back.
  const isSettled = (thread: EnvironmentThreadShell) => thread.settledOverride === "settled";
  const botThreads = conversations
    .filter((thread) => isBotThreadId(thread.id) && thread.itemCount > 0)
    .toSorted(
      (a, b) =>
        Number(isSettled(a)) - Number(isSettled(b)) || b.updatedAt.localeCompare(a.updatedAt),
    );
  const unseenThreads = botThreads.filter(
    (thread) => !isSettled(thread) && hasUnseenCompletion(thread),
  ).length;
  const machines = environments
    .filter((environment) => connected.includes(environment.environmentId))
    .map(({ environmentId, label }) => ({ environmentId, label }));
  const home = resolveBotHome(bots, machines, primary);
  // Two machines each hosting bots is the case to notice: those bots share no memory.
  const spread = new Set(bots.map((bot) => bot.environmentId)).size > 1;

  const open = (ref: ReturnType<typeof scopeThreadRef>) =>
    router.navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });

  return (
    <div data-testid="sidebar-bots" className="mb-1">
      <div className="flex h-7 items-center justify-between ps-2 pe-1 text-muted-foreground text-xs">
        <span>
          <T>Bots</T>
        </span>
        {home === null ? null : (
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={gt("Start a bot")}
            onClick={() => setStarting(true)}
          >
            <PlusIcon aria-hidden />
          </Button>
        )}
      </div>
      {home === null ? null : (
        <StartBotDialog
          open={starting}
          onOpenChange={setStarting}
          machines={machines}
          home={home}
          onStarted={(environmentId, threadId) => {
            setStarting(false);
            void open(scopeThreadRef(environmentId, threadId));
          }}
        />
      )}
      {bots.length === 0 && botThreads.length === 0 ? null : (
        <SidebarMenu>
          {botThreads.length === 0 ? null : (
            <SidebarMenuItem>
              <SidebarMenuButton
                aria-expanded={threadsOpen}
                onClick={() => setThreadsOpen(!threadsOpen)}
              >
                <span className={LEAD_SLOT}>
                  <MessagesSquareIcon aria-hidden className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <T>Threads</T>
                </span>
                {unseenThreads === 0 ? null : (
                  <span
                    aria-label={gt("{count} with new replies", { count: unseenThreads })}
                    className="shrink-0 text-xs font-medium text-primary tabular-nums"
                  >
                    {unseenThreads}
                  </span>
                )}
                <ChevronRightIcon
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground/70",
                    threadsOpen && "rotate-90",
                  )}
                />
              </SidebarMenuButton>
              {threadsOpen ? (
                <SidebarMenuSub>
                  {botThreads.map((thread) => (
                    <SidebarMenuSubItem
                      key={scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))}
                    >
                      <SidebarMenuSubButton
                        size="sm"
                        className="w-full"
                        render={<button type="button" />}
                        onClick={() => openThread(thread.environmentId, thread.id)}
                      >
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-left",
                            !isSettled(thread) && hasUnseenCompletion(thread)
                              ? "font-medium text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {thread.title}
                        </span>
                        {!isSettled(thread) && hasUnseenCompletion(thread) ? (
                          <span
                            aria-label={gt("New replies")}
                            className="size-1.5 shrink-0 rounded-full bg-primary"
                          />
                        ) : (
                          <span className="shrink-0 text-2xs text-muted-foreground/70">
                            {isSettled(thread) ? gt("Settled") : botNameOfThread(thread.id)}
                          </span>
                        )}
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              ) : null}
            </SidebarMenuItem>
          )}
          {bots.map((bot) => (
            <BotRow
              key={scopedThreadKey(scopeThreadRef(bot.environmentId, bot.id))}
              bot={bot}
              active={
                scopedThreadKey(scopeThreadRef(bot.environmentId, bot.id)) === props.routeThreadKey
              }
              machine={
                spread
                  ? (environments.find(
                      (environment) => environment.environmentId === bot.environmentId,
                    )?.label ?? null)
                  : null
              }
              onOpen={() => void open(scopeThreadRef(bot.environmentId, bot.id))}
            />
          ))}
        </SidebarMenu>
      )}
    </div>
  );
}
