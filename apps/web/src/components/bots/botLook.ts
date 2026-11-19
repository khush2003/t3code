import type { BotLook } from "@t3tools/contracts";
import {
  AnchorIcon,
  BotIcon,
  BrainIcon,
  BriefcaseIcon,
  BugIcon,
  CameraIcon,
  CompassIcon,
  CrownIcon,
  FeatherIcon,
  FlameIcon,
  Gamepad2Icon,
  GhostIcon,
  GlobeIcon,
  HammerIcon,
  LeafIcon,
  type LucideIcon,
  MusicIcon,
  PaletteIcon,
  RadarIcon,
  RocketIcon,
  ShieldIcon,
  SparklesIcon,
  StarIcon,
  TelescopeIcon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";

/** The icons a bot can be given. The server stores the name, so a name stays once it ships. */
export const BOT_ICONS: Readonly<Record<string, LucideIcon>> = {
  bot: BotIcon,
  rocket: RocketIcon,
  compass: CompassIcon,
  telescope: TelescopeIcon,
  radar: RadarIcon,
  shield: ShieldIcon,
  wrench: WrenchIcon,
  hammer: HammerIcon,
  gamepad: Gamepad2Icon,
  globe: GlobeIcon,
  leaf: LeafIcon,
  flame: FlameIcon,
  zap: ZapIcon,
  star: StarIcon,
  crown: CrownIcon,
  anchor: AnchorIcon,
  feather: FeatherIcon,
  bug: BugIcon,
  brain: BrainIcon,
  music: MusicIcon,
  camera: CameraIcon,
  briefcase: BriefcaseIcon,
  ghost: GhostIcon,
  palette: PaletteIcon,
  sparkles: SparklesIcon,
};

/** Written out in full so the stylesheet keeps every one of them. */
export const BOT_COLORS: Readonly<Record<string, { readonly tile: string; readonly dot: string }>> =
  {
    slate: { tile: "bg-foreground/10 text-foreground/80", dot: "bg-foreground/50" },
    blue: { tile: "bg-blue-500/20 text-blue-600 dark:text-blue-300", dot: "bg-blue-500" },
    teal: { tile: "bg-teal-500/20 text-teal-600 dark:text-teal-300", dot: "bg-teal-500" },
    green: {
      tile: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300",
      dot: "bg-emerald-500",
    },
    amber: { tile: "bg-amber-500/20 text-amber-600 dark:text-amber-300", dot: "bg-amber-500" },
    red: { tile: "bg-red-500/20 text-red-600 dark:text-red-300", dot: "bg-red-500" },
    pink: { tile: "bg-pink-500/20 text-pink-600 dark:text-pink-300", dot: "bg-pink-500" },
    violet: {
      tile: "bg-violet-500/20 text-violet-600 dark:text-violet-300",
      dot: "bg-violet-500",
    },
  };

const COLOR_NAMES = Object.keys(BOT_COLORS);

/** The colour a bot shows in: the one it was given, or one its name picks so bots differ. */
export function botColorName(name: string, look: BotLook | null | undefined): string {
  if (look?.color != null && look.color in BOT_COLORS) return look.color;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  // Slate is left for bots whose person chose it.
  return COLOR_NAMES[1 + (hash % (COLOR_NAMES.length - 1))]!;
}

const AVATAR_PIXELS = 160;

/** A picked picture, cropped square and scaled down to what a bot's avatar needs. */
export async function readBotAvatar(
  file: File,
): Promise<{ readonly mimeType: "image/webp" | "image/png"; readonly base64: string } | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (bitmap === null) return null;
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_PIXELS;
  canvas.height = AVATAR_PIXELS;
  canvas
    .getContext("2d")
    ?.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_PIXELS,
      AVATAR_PIXELS,
    );
  bitmap.close();
  const url = canvas.toDataURL("image/webp", 0.9);
  // A browser without WebP encoding answers with a PNG.
  const mimeType = url.startsWith("data:image/webp") ? "image/webp" : "image/png";
  const base64 = url.slice(url.indexOf(",") + 1);
  return base64 === "" ? null : { mimeType, base64 };
}
