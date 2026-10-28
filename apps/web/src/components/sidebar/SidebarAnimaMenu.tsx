import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { PlusIcon, SparklesIcon, UsersIcon } from "lucide-react";
import { useState } from "react";

import { animaEnvironment } from "../../state/anima";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAnimaRoster } from "../chat/animaPresence";
import { AnimaAccentDot } from "../settings/anima/AnimaBits";
import { NewAnimaDialog } from "../settings/anima/NewAnimaDialog";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";

const RECENT_LIMIT = 5;

export function SidebarAnimaMenu() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) return null;
  return <SidebarAnimaMenuFor environmentId={environmentId} />;
}

function SidebarAnimaMenuFor({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const roster = useAnimaRoster(environmentId);
  const canCreate = useAtomValue(animaEnvironment.create.permissionAtom(environmentId));
  const [creating, setCreating] = useState(false);
  const recent = roster
    .filter((anima) => anima.enabled)
    .toSorted(
      (a, b) =>
        Number(b.live) - Number(a.live) ||
        (b.lastActiveAt ?? b.lastBreathAt ?? "").localeCompare(
          a.lastActiveAt ?? a.lastBreathAt ?? "",
        ),
    )
    .slice(0, RECENT_LIMIT);

  const openAnima = (anima: string | undefined) => {
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/settings/anima",
      search: { environmentId, ...(anima ? { anima } : {}) },
    });
  };

  return (
    <SidebarMenuItem className="shrink-0">
      <Menu>
        <MenuTrigger render={<SidebarMenuButton aria-label="Animas" size="icon" />} title="Animas">
          <SparklesIcon />
        </MenuTrigger>
        <MenuPopup side="top" align="start" className="min-w-56">
          {recent.length > 0 ? (
            <>
              <MenuGroup>
                <MenuGroupLabel>Recent animas</MenuGroupLabel>
                {recent.map((anima) => (
                  <MenuItem key={anima.name} onClick={() => openAnima(anima.name)}>
                    <AnimaAccentDot accent={anima.accent} live={anima.live} />
                    <span className="min-w-0 flex-1 truncate">{anima.name}</span>
                  </MenuItem>
                ))}
              </MenuGroup>
              <MenuSeparator />
            </>
          ) : null}
          <MenuItem disabled={!canCreate} onClick={() => setCreating(true)}>
            <PlusIcon />
            New anima…
          </MenuItem>
          <MenuItem onClick={() => openAnima(undefined)}>
            <UsersIcon />
            All animas
          </MenuItem>
        </MenuPopup>
      </Menu>
      {creating ? (
        <NewAnimaDialog
          environmentId={environmentId}
          onClose={() => setCreating(false)}
          onCreated={(name) => openAnima(name)}
        />
      ) : null}
    </SidebarMenuItem>
  );
}
