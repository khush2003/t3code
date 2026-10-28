import type { AnimaName, AnimaSummary } from "@t3tools/contracts";

import { AnimaLiveDot } from "../settings/anima/AnimaBits";
import { AnimaHealthBadge } from "../settings/anima/AnimaHealth";
import { AnimaSigil } from "../settings/anima/AnimaVisuals";
import { MenuRadioGroup, MenuRadioItem, MenuSeparator } from "../ui/menu";

const NONE = "";

/** Radio items for choosing a thread's anima, shared by the header chip and the details row. */
export function AnimaPickerItems({
  animas,
  current,
  onChange,
}: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly current: AnimaName | null;
  readonly onChange: (next: AnimaName | null) => void;
}) {
  return (
    <>
      <MenuRadioGroup
        value={current ?? NONE}
        onValueChange={(next) => onChange(next === NONE ? null : (next as AnimaName))}
      >
        <MenuRadioItem value={NONE} closeOnClick>
          None
        </MenuRadioItem>
        {animas.length > 0 ? <MenuSeparator /> : null}
        {animas.map((anima) => (
          <MenuRadioItem key={anima.name} value={anima.name} closeOnClick>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <AnimaSigil anima={anima} size={18} />
              <span className="flex min-w-0 flex-col">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate">{anima.name}</span>
                  <AnimaLiveDot live={anima.live} />
                </span>
                <span className="truncate text-muted-foreground text-xs">
                  {anima.role} · {anima.breathCount} breaths
                </span>
              </span>
              {anima.health === null ? null : (
                <span className="ms-auto">
                  <AnimaHealthBadge score={anima.health} />
                </span>
              )}
            </span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      {current !== null ? (
        <p className="px-2 py-1.5 text-muted-foreground text-xs">
          Locks to this thread on your next message.
        </p>
      ) : null}
    </>
  );
}
