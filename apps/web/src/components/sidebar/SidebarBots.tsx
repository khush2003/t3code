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
import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";

import { botsEnvironment } from "../../state/bots";
import { type BotMachine, resolveBotHome } from "./SidebarBots.logic";
import {
  useConnectedEnvironmentIds,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
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
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";

const isBotName = Schema.is(BotName);

function StartBotDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onStarted: (environmentId: EnvironmentId, threadId: ThreadId) => void;
  readonly machines: readonly BotMachine[];
  readonly home: EnvironmentId;
}) {
  const id = useId();
  const start = useAtomCommand(botsEnvironment.start, { reportFailure: false });
  const [chosen, setChosen] = useState<EnvironmentId | null>(null);
  const environmentId =
    chosen !== null && props.machines.some((machine) => machine.environmentId === chosen)
      ? chosen
      : props.home;
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const normalized = name.trim().toLowerCase().replaceAll(/\s+/g, "-");

  const submit = async () => {
    if (!isBotName(normalized)) {
      setError("Use letters, numbers and dashes, starting with a letter or number.");
      return;
    }
    setStarting(true);
    const result = await start({
      environmentId,
      input: { name: normalized, ...(purpose.trim() === "" ? {} : { purpose: purpose.trim() }) },
    });
    setStarting(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : "Could not start the bot.");
      }
      return;
    }
    setName("");
    setPurpose("");
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
            <DialogTitle>Start a bot</DialogTitle>
            <DialogDescription>
              A bot keeps one conversation with you and runs the work as threads in your projects.
              Using an existing name reopens that bot.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-name`}>
                Name
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
                What it is for
                <Textarea
                  id={`${id}-purpose`}
                  rows={3}
                  placeholder="Keep my app projects moving and tell me what needs me."
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                />
              </Label>
              {props.machines.length < 2 ? null : (
                <Label className="flex min-w-0 flex-col items-stretch">
                  Runs on
                  <Select
                    value={environmentId}
                    onValueChange={(value) => {
                      if (value !== null) setChosen(value as EnvironmentId);
                    }}
                  >
                    <SelectTrigger aria-label="Machine the bot runs on">
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
                    Its memory stays on this machine, so keep your bots on one that is always on.
                  </span>
                </Label>
              )}
            </div>
            {error && (
              <p role="alert" className="mt-3 text-destructive">
                {error}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={starting}>
              Start
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function SidebarBots(props: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly routeThreadKey: string | null;
}) {
  const router = useRouter();
  const primary = usePrimaryEnvironmentId();
  const connected = useConnectedEnvironmentIds();
  const { environments } = useEnvironments();
  const [starting, setStarting] = useState(false);
  const bots = props.threads.filter((thread) => thread.bot === true && thread.archivedAt === null);
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
        <span>Bots</span>
        {home === null ? null : (
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Start a bot"
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
      {bots.length === 0 ? null : (
        <SidebarMenu>
          {bots.map((bot) => {
            const ref = scopeThreadRef(bot.environmentId, bot.id);
            return (
              <SidebarMenuItem key={scopedThreadKey(ref)}>
                <SidebarMenuButton
                  size="sm"
                  isActive={scopedThreadKey(ref) === props.routeThreadKey}
                  onClick={() => void open(ref)}
                >
                  <span className="min-w-0 flex-1 truncate">{bot.title}</span>
                  {spread ? (
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {environments.find(
                        (environment) => environment.environmentId === bot.environmentId,
                      )?.label ?? ""}
                    </span>
                  ) : null}
                  {isThreadWorking(bot) ? (
                    <span
                      aria-label="Working"
                      className="size-1.5 shrink-0 rounded-full bg-primary"
                    />
                  ) : null}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      )}
    </div>
  );
}
