import type { AnimaName, EnvironmentId } from "@t3tools/contracts";

import { useAnimaSummary } from "../chat/animaPresence";
import { animaColor } from "../anima/AnimaVisuals";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Reads the shared, non-polling roster snapshot, so rows add no runtime subscriptions. */
export function SidebarAnimaIndicator({
  environmentId,
  name,
}: {
  readonly environmentId: EnvironmentId;
  readonly name: AnimaName;
}) {
  const summary = useAnimaSummary(environmentId, name);
  const color = summary ? animaColor(summary) : null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={`Anima ${name}`}
            className="inline-flex size-3 shrink-0 items-center justify-center"
          />
        }
      >
        <span
          aria-hidden
          className="size-2 rounded-full bg-muted-foreground/45 ring-1 ring-background"
          style={color ? { backgroundColor: color } : undefined}
        />
      </TooltipTrigger>
      <TooltipPopup>
        Anima: {name}
        {summary ? ` · ${summary.role}` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}
