import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { MessageSquarePlusIcon } from "lucide-react";
import type { AnimaName, EnvironmentId } from "@t3tools/contracts";

import { useComposerDraftStore } from "../../../composerDraftStore";
import { useNewThreadHandler } from "../../../hooks/useHandleNewThread";
import { useProjects } from "../../../state/entities";
import { Button } from "../../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";

/** Opens a draft thread in the chosen project with the anima preselected. */
function useStartAnimaThread(environmentId: EnvironmentId) {
  const handleNewThread = useNewThreadHandler();
  return async (projectId: string, animaName: string) => {
    const created = await handleNewThread(scopeProjectRef(environmentId, projectId as never));
    if (created) {
      useComposerDraftStore.getState().setDraftThreadAnima(created.draftId, animaName as AnimaName);
    }
  };
}

export function StartAnimaThreadMenu({
  environmentId,
  animaName,
  label = "Start a thread",
  variant = "outline",
}: {
  readonly environmentId: EnvironmentId;
  readonly animaName: string;
  readonly label?: string;
  readonly variant?: "outline" | "ghost";
}) {
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const start = useStartAnimaThread(environmentId);
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button size="xs" variant={variant} disabled={projects.length === 0}>
            <MessageSquarePlusIcon className="size-3" />
            {label}
          </Button>
        }
      />
      <MenuPopup align="end">
        {projects.map((project) => (
          <MenuItem key={project.id} onClick={() => void start(project.id, animaName)}>
            {project.title}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
