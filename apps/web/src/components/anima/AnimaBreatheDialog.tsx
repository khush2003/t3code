import type { AnimaDetail, AnimaRecordInput, EnvironmentId } from "@t3tools/contracts";
import { useState, type CSSProperties } from "react";

import { animaEnvironment } from "../../state/anima";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Field, useAnimaMutation } from "./AnimaBits";
import { soulMeaning } from "./animaDashboard.logic";
import { SoulOrb } from "./AnimaSoul";
import { parseHsl } from "./animaVisuals.logic";
import { parseBreathNote } from "./soul.logic";

const PITCHES = ["C", "D", "E", "F", "G", "A", "B"] as const;
const QUALITIES = [
  { value: "M", label: "major" },
  { value: "m", label: "minor" },
  { value: "d", label: "diminished" },
  { value: "7", label: "seventh" },
] as const;
const HUE_STOPS =
  "sys 0 · data 45 · test 90 · back 135 · front 180 · arch 225 · gen 270 · debug 315";

interface Codec {
  readonly hue: number;
  readonly focus: number;
  readonly vitality: number;
  readonly breadth: number;
  readonly depth: number;
  readonly coupling: number;
  readonly pitch: string;
  readonly quality: string;
  readonly velocity: number;
}

function latest(detail: AnimaDetail) {
  return detail.breaths.reduce<AnimaDetail["breaths"][number] | null>(
    (best, breath) => (best === null || breath.index > best.index ? breath : best),
    null,
  );
}

/** The latest breath's codec values, so a hand-recorded breath continues where the anima left off. */
function codecFrom(detail: AnimaDetail): Codec {
  const head = latest(detail);
  const hsl = parseHsl(head?.hsl ?? detail.summary.hsl);
  const note = head ? parseBreathNote(head.note) : null;
  const shape = head?.shape ?? detail.summary.shape;
  return {
    hue: Math.round(hsl?.h ?? 225),
    focus: Math.round(hsl?.s ?? 60),
    vitality: Math.round(hsl?.l ?? 55),
    breadth: shape?.breadth ?? 0.5,
    depth: shape?.depth ?? 0.5,
    coupling: shape?.coupling ?? 0.5,
    pitch: note?.pitch.charAt(0) ?? "D",
    quality: note ? { major: "M", minor: "m", diminished: "d", seventh: "7" }[note.quality] : "M",
    velocity: note?.velocity ?? 60,
  };
}

function encode(
  name: string,
  codec: Codec,
): Pick<AnimaRecordInput, "name" | "hsl" | "note" | "shape"> {
  const unit = (value: number) => (Math.round(value * 100) / 100).toString();
  return {
    name,
    hsl: `${codec.hue}.${codec.focus}.${codec.vitality}`,
    note: `${codec.pitch}4.${codec.quality}.${codec.velocity}.1.2.100`,
    shape: `${unit(codec.breadth)}/${unit(codec.depth)}/${unit(codec.coupling)}`,
  };
}

/** Records a breath that keeps the latest codec values and only changes what is passed. */
export function useRecordBreath(environmentId: EnvironmentId, detail: AnimaDetail) {
  const record = useAnimaMutation(animaEnvironment.record, {
    failureTitle: `Could not record a breath for ${detail.summary.name}`,
    successTitle: "Breath recorded",
  });
  return (extra: Omit<AnimaRecordInput, "name" | "hsl" | "note" | "shape">) =>
    record({
      environmentId,
      input: { ...encode(detail.summary.name, codecFrom(detail)), ...extra },
    });
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly format?: (value: number) => string;
  readonly onChange: (value: number) => void;
}) {
  const ratio = (value - min) / (max - min);
  return (
    <label className="grid grid-cols-[5.5rem_minmax(0,1fr)_3rem] items-center gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        aria-label={label}
        className="settings-slider min-w-0"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={
          {
            "--settings-slider-progress": `${ratio * 100}%`,
            "--settings-slider-fill-offset": `${0.5 - ratio}rem`,
          } as CSSProperties
        }
      />
      <output className="text-right tabular-nums">{format ? format(value) : value}</output>
    </label>
  );
}

/** Record a breath by hand through `anima breathe`, like the original dashboard's breathe dialog. */
export function AnimaBreatheDialog({
  environmentId,
  detail,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly detail: AnimaDetail;
  readonly onClose: () => void;
}) {
  const [codec, setCodec] = useState(() => codecFrom(detail));
  const [aim, setAim] = useState(detail.summary.aim ?? "");
  const [memo, setMemo] = useState("");
  const [tension, setTension] = useState("");
  const [saving, setSaving] = useState(false);
  const record = useAnimaMutation(animaEnvironment.record, {
    failureTitle: `Could not record a breath for ${detail.summary.name}`,
    successTitle: "Breath recorded",
  });
  const set =
    <K extends keyof Codec>(key: K) =>
    (value: Codec[K]) =>
      setCodec((current) => ({ ...current, [key]: value }));
  const preview = {
    name: detail.summary.name,
    accent: null,
    hsl: `${codec.hue},${codec.focus},${codec.vitality}`,
  };
  const meaning = soulMeaning(preview.hsl);
  const submit = async () => {
    setSaving(true);
    const trimmedAim = aim.trim();
    const trimmedMemo = memo.trim();
    const trimmedTension = tension.trim();
    const result = await record({
      environmentId,
      input: {
        ...encode(detail.summary.name, codec),
        ...(trimmedAim && trimmedAim !== detail.summary.aim ? { aim: trimmedAim } : {}),
        ...(trimmedMemo ? { memo: trimmedMemo } : {}),
        ...(trimmedTension ? { tensions: [trimmedTension] } : {}),
      },
    });
    setSaving(false);
    if (result) onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Breathe for {detail.summary.name}</DialogTitle>
          <DialogDescription>
            Records a breath through the anima CLI, starting from its latest one. Usually an anima
            breathes itself at the end of a session.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <SoulOrb anima={preview} size={72} />
              <p className="text-sm">
                {meaning ? (
                  <>
                    Working in <span className="font-semibold capitalize">{meaning.domain}</span>,{" "}
                    {meaning.focusLabel} and {meaning.vitalityLabel}
                  </>
                ) : null}
              </p>
            </div>
            <div className="space-y-2.5">
              <div
                aria-hidden
                className="h-1.5 rounded-full"
                style={{
                  backgroundImage: `linear-gradient(to right, ${Array.from({ length: 9 }, (_, index) => `oklch(70% 0.15 ${index * 45})`).join(", ")})`,
                }}
              />
              <Slider
                label="Domain (hue)"
                value={codec.hue}
                min={0}
                max={359}
                onChange={set("hue")}
              />
              <p className="text-2xs text-muted-foreground">{HUE_STOPS}</p>
              <Slider label="Focus" value={codec.focus} min={0} max={100} onChange={set("focus")} />
              <Slider
                label="Vitality"
                value={codec.vitality}
                min={0}
                max={100}
                onChange={set("vitality")}
              />
            </div>
            <div className="space-y-2.5">
              <Slider
                label="Breadth"
                value={codec.breadth}
                min={0}
                max={1}
                step={0.05}
                format={(value) => value.toFixed(2)}
                onChange={set("breadth")}
              />
              <Slider
                label="Depth"
                value={codec.depth}
                min={0}
                max={1}
                step={0.05}
                format={(value) => value.toFixed(2)}
                onChange={set("depth")}
              />
              <Slider
                label="Coupling"
                value={codec.coupling}
                min={0}
                max={1}
                step={0.05}
                format={(value) => value.toFixed(2)}
                onChange={set("coupling")}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Pitch">
                <Select value={codec.pitch} onValueChange={(value) => set("pitch")(String(value))}>
                  <SelectTrigger size="sm">
                    <SelectValue>{codec.pitch}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {PITCHES.map((pitch) => (
                      <SelectItem key={pitch} value={pitch} label={pitch}>
                        {pitch}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
              <Field label="Mood">
                <Select
                  value={codec.quality}
                  onValueChange={(value) => set("quality")(String(value))}
                >
                  <SelectTrigger size="sm">
                    <SelectValue>
                      {QUALITIES.find((entry) => entry.value === codec.quality)?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {QUALITIES.map((entry) => (
                      <SelectItem key={entry.value} value={entry.value} label={entry.label}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
              <Field label="Intensity">
                <Input
                  size="sm"
                  type="number"
                  min={1}
                  max={127}
                  value={codec.velocity}
                  onChange={(event) =>
                    set("velocity")(Math.min(127, Math.max(1, Number(event.target.value) || 1)))
                  }
                />
              </Field>
            </div>
            <Field label="Aim" hint="The next concrete step">
              <Input size="sm" value={aim} onChange={(event) => setAim(event.target.value)} />
            </Field>
            <Field label="Memo" hint="Optional">
              <Input size="sm" value={memo} onChange={(event) => setMemo(event.target.value)} />
            </Field>
            <Field label="Open a tension" hint="Optional">
              <Input
                size="sm"
                value={tension}
                placeholder="speed vs care"
                onChange={(event) => setTension(event.target.value)}
              />
            </Field>
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={saving} onClick={() => void submit()}>
            {saving ? "Recording..." : "Record breath"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
