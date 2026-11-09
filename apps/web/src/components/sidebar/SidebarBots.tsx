import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { BotName, type ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";

import { botsEnvironment } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
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
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";

const isBotName = Schema.is(BotName);

function StartBotDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onStarted: (threadId: ThreadId) => void;
  readonly environmentId: NonNullable<ReturnType<typeof usePrimaryEnvironmentId>>;
}) {
  const id = useId();
  const start = useAtomCommand(botsEnvironment.start, { reportFailure: false });
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
      environmentId: props.environmentId,
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
    props.onStarted(result.value.threadId);
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
  const environmentId = usePrimaryEnvironmentId();
  const [starting, setStarting] = useState(false);
  const bots = props.threads.filter((thread) => thread.bot === true && thread.archivedAt === null);

  const open = (ref: ReturnType<typeof scopeThreadRef>) =>
    router.navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });

  return (
    <div data-testid="sidebar-bots" className="mb-1">
      <div className="flex h-7 items-center justify-between ps-2 pe-1 text-muted-foreground text-xs">
        <span>Bots</span>
        {environmentId === null ? null : (
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
      {environmentId === null ? null : (
        <StartBotDialog
          open={starting}
          onOpenChange={setStarting}
          environmentId={environmentId}
          onStarted={(threadId) => {
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
