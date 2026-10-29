import type { AnimaName, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ChevronDownIcon, SparklesIcon, TriangleAlertIcon, WindIcon } from "lucide-react";

import type { DraftId } from "../../composerDraftStore";
import type { ThreadPanelPresentation } from "../../rightPanelLayout";
import { AnimaLiveDot } from "../anima/AnimaBits";
import { AnimaSigil } from "../anima/AnimaVisuals";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { PopoverTrigger, type PopoverCreateHandle } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AnimaPickerItems } from "./AnimaPickerItems";
import { useAnimaRoster, useAnimaSummary, useAnimaThreadSignal } from "./animaPresence";
import type { AnimaThreadSignal } from "./threadAnima.logic";
import { useThreadAnimaChoice } from "./useThreadAnimaChoice";

interface ThreadAnimaChipProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftId: DraftId | undefined;
  readonly isServerThread: boolean;
  readonly threadPanelPresentation: ThreadPanelPresentation;
  readonly threadPanelPopoverHandle: ReturnType<typeof PopoverCreateHandle>;
  readonly onToggleThreadPanel: () => void;
}

const SIGNAL_LABELS: Readonly<Record<AnimaThreadSignal, string>> = {
  loop: "Loop suspected",
  "breath-due": "Breath due",
  live: "Live",
  idle: "Idle",
};

function SignalMark({ signal }: { readonly signal: AnimaThreadSignal }) {
  switch (signal) {
    case "loop":
      return <TriangleAlertIcon aria-hidden className="size-3.5 text-warning" />;
    case "breath-due":
      return <WindIcon aria-hidden className="size-3.5 text-info" />;
    case "live":
      return <AnimaLiveDot live />;
    case "idle":
      return null;
  }
}

function AnimaMark({
  environmentId,
  name,
}: {
  readonly environmentId: EnvironmentId;
  readonly name: AnimaName;
}) {
  const summary = useAnimaSummary(environmentId, name);
  // A colourless sigil until the roster loads keeps the chip's width fixed.
  return (
    <AnimaSigil
      anima={summary ?? { hsl: null, accent: null, breathCount: 0, live: false }}
      size={16}
    />
  );
}

/** A woken thread's anima: identity plus the most urgent runtime signal; opens thread details. */
function LockedAnimaChip({
  environmentId,
  threadId,
  name,
  threadPanelPresentation,
  threadPanelPopoverHandle,
  onToggleThreadPanel,
}: Omit<ThreadAnimaChipProps, "draftId" | "isServerThread"> & { readonly name: AnimaName }) {
  const signal = useAnimaThreadSignal(environmentId, threadId);
  const button = (
    <Button
      variant="ghost-muted"
      size="xs"
      aria-label={`Anima ${name}: ${SIGNAL_LABELS[signal]}. Open thread details`}
      data-anima-signal={signal}
    />
  );
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          threadPanelPresentation === "popover" ? (
            <PopoverTrigger handle={threadPanelPopoverHandle} render={button} />
          ) : (
            button
          )
        }
        {...(threadPanelPresentation === "popover" ? {} : { onClick: onToggleThreadPanel })}
      >
        <AnimaMark environmentId={environmentId} name={name} />
        <span className="max-w-32 truncate">{name}</span>
        <SignalMark signal={signal} />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {signal === "idle"
          ? `${name} is locked to this thread`
          : `${name}: ${SIGNAL_LABELS[signal]}`}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Before the first wake the chip is the picker itself, so a new thread's anima is one click away. */
function AnimaPickerChip({
  environmentId,
  current,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly current: AnimaName | null;
  readonly onChange: (next: AnimaName | null) => void;
}) {
  const animas = useAnimaRoster(environmentId);
  if (animas.length === 0 && current === null) return null;
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={<Button variant="ghost-muted" size="xs" />}
              aria-label={current === null ? "Choose an anima" : `Anima ${current}, change`}
            />
          }
        >
          {current === null ? (
            <>
              <SparklesIcon aria-hidden />
              <span>Anima</span>
            </>
          ) : (
            <>
              <AnimaMark environmentId={environmentId} name={current} />
              <span className="max-w-32 truncate">{current}</span>
            </>
          )}
          <ChevronDownIcon aria-hidden className="size-3" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {current === null
            ? "Run this thread as a persistent anima"
            : "Locks to this thread on your next message"}
        </TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="w-72">
        <AnimaPickerItems animas={animas} current={current} onChange={onChange} />
      </MenuPopup>
    </Menu>
  );
}

export function ThreadAnimaChip(props: ThreadAnimaChipProps) {
  const { current, locked, change } = useThreadAnimaChoice(props);
  if (locked && current !== null) return <LockedAnimaChip {...props} name={current} />;
  // A started thread without an anima keeps the header quiet; its details row can still set one.
  if (props.isServerThread && current === null) return null;
  return (
    <AnimaPickerChip
      environmentId={props.environmentId}
      current={current}
      onChange={(next) => void change(next)}
    />
  );
}
