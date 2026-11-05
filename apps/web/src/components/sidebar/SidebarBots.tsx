import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type { AnimaName, EnvironmentId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";

import { animaEnvironment, describeAnimaError, useAnimaList } from "../../state/anima";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { AnimaSigil } from "../anima/AnimaVisuals";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { toastManager } from "../ui/toast";

/** Mounted only while the menu is open, so the sidebar never reads every anima just by showing. */
function BotPickerItems(props: {
  readonly environmentId: EnvironmentId;
  readonly onPick: (name: AnimaName) => void;
}) {
  const { animas, cliAvailable } = useAnimaList(props.environmentId);
  if (animas.length === 0) {
    return (
      <MenuItem disabled>{cliAvailable ? "No animas yet" : "The anima CLI is not set up"}</MenuItem>
    );
  }
  return animas.map((anima) => (
    <MenuItem key={anima.name} onClick={() => props.onPick(anima.name)}>
      <AnimaSigil anima={anima} size={18} />
      <span className="min-w-0 truncate">{anima.name}</span>
    </MenuItem>
  ));
}

export function SidebarBots(props: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly routeThreadKey: string | null;
}) {
  const router = useRouter();
  const environmentId = usePrimaryEnvironmentId();
  const startBot = useAtomCommand(animaEnvironment.startBot, { reportFailure: false });
  const bots = props.threads.filter((thread) => thread.bot === true && thread.archivedAt === null);

  const open = (ref: ReturnType<typeof scopeThreadRef>) =>
    router.navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });

  const pick = async (name: AnimaName) => {
    if (environmentId === null) return;
    const result = await startBot({ environmentId, input: { name } });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add({
          type: "error",
          title: "Could not start the bot",
          description: describeAnimaError(squashAtomCommandFailure(result)),
        });
      }
      return;
    }
    await open(scopeThreadRef(environmentId, result.value.threadId));
  };

  return (
    <div data-testid="sidebar-bots" className="mb-1">
      <div className="flex h-7 items-center justify-between ps-2 pe-1 text-muted-foreground text-xs">
        <span>Bots</span>
        {environmentId === null ? null : (
          <Menu>
            <MenuTrigger
              render={<Button variant="ghost-muted" size="icon-xs" />}
              aria-label="Start a bot"
            >
              <PlusIcon aria-hidden />
            </MenuTrigger>
            <MenuPopup align="start" side="bottom" className="max-h-80 w-56 overflow-y-auto">
              <BotPickerItems environmentId={environmentId} onPick={(name) => void pick(name)} />
            </MenuPopup>
          </Menu>
        )}
      </div>
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
                  <span className="min-w-0 flex-1 truncate">{bot.animaName ?? bot.title}</span>
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
