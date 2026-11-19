import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type BotLook,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { ImageIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";

import { useAssetUrls } from "~/assets/assetUrls";
import { cn } from "~/lib/utils";
import { botsEnvironment } from "~/state/bots";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { BotFace } from "./BotFace";
import { BOT_FACE_NAMES, type BotMood, readBotIcon } from "./botFace.logic";
import { BOT_COLORS, BOT_ICONS, botColorName, readBotAvatar } from "./botLook";
import { useBotMood, useBotSummary, useRefreshBots } from "./useBot";

const SIZES = {
  sm: { box: "size-5", tile: "rounded-md text-2xs", icon: "size-3" },
  row: { box: "size-7", tile: "rounded-lg text-xs", icon: "size-4" },
  md: { box: "size-9", tile: "rounded-lg text-sm", icon: "size-4.5" },
  lg: { box: "size-12", tile: "rounded-xl text-base", icon: "size-6" },
} as const;

/** A bot's face: its picture, else its character, else an icon or its initial on its colour. */
export function BotAvatar(props: {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly look: BotLook | null | undefined;
  readonly size: keyof typeof SIZES;
  /** What a character's face shows. A picture or an icon has no moods. */
  readonly mood?: BotMood;
  /** A character's eyes follow the pointer. */
  readonly follow?: boolean;
  readonly className?: string;
}) {
  const { look } = props;
  const size = SIZES[props.size];
  const [picture] = useAssetUrls(
    props.environmentId,
    look?.avatarAttachmentId == null
      ? []
      : [{ _tag: "attachment" as const, attachmentId: look.avatarAttachmentId }],
  );
  const icon = readBotIcon(props.name, look?.icon);
  const Glyph = icon.kind === "glyph" ? BOT_ICONS[icon.glyph] : undefined;
  const colors = BOT_COLORS[botColorName(props.name, look)];
  // A picture that no longer loads gives way to the icon, never to an empty tile.
  const [failed, setFailed] = useState<string | null>(null);
  const shown = picture != null && failed !== picture ? picture : null;
  if (shown === null && icon.kind === "face")
    return (
      <BotFace
        face={icon.face}
        color={colors?.body}
        mood={props.mood ?? "idle"}
        {...(props.follow === true ? { follow: true } : {})}
        className={cn(size.box, props.className)}
      />
    );
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden font-semibold uppercase",
        size.box,
        size.tile,
        colors?.tile,
        props.className,
      )}
    >
      {shown !== null ? (
        <img
          src={shown}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(shown)}
        />
      ) : Glyph !== undefined ? (
        <Glyph className={size.icon} />
      ) : (
        props.name.slice(0, 1)
      )}
    </span>
  );
}

/** The bot's face as a button that opens where its icon, colour and picture are chosen. */
export function BotLookPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly name: string;
  readonly look: BotLook | null | undefined;
}) {
  const { environmentId, threadId, look } = props;
  const setLook = useAtomCommand(botsEnvironment.setLook, { reportFailure: false });
  const refreshBots = useRefreshBots(environmentId);
  const canChange = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const mood = useBotMood(environmentId, threadId);
  const avatar = (
    <BotAvatar
      environmentId={environmentId}
      name={props.name}
      look={look}
      size="lg"
      mood={mood}
      follow
    />
  );
  const icon = readBotIcon(props.name, look?.icon);
  const bodyColor = BOT_COLORS[botColorName(props.name, look)]?.body;
  if (!canChange) return avatar;

  const change = async (
    next: Omit<Parameters<typeof setLook>[0]["input"], "threadId">,
    problem = "Could not change how the bot looks",
  ) => {
    const result = await setLook({ environmentId, input: { threadId, ...next } });
    if (result._tag === "Success") refreshBots();
    else if (!isAtomCommandInterrupted(result)) toastManager.add({ type: "error", title: problem });
  };
  const upload = async (file: File | undefined) => {
    if (file === undefined) return;
    const picture = await readBotAvatar(file);
    if (picture === null) {
      toastManager.add({
        type: "error",
        title: "That file is not a picture this browser can read",
      });
      return;
    }
    await change({ avatar: picture }, "Could not keep the picture");
  };
  const color = botColorName(props.name, look);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Change how the bot looks"
            className="cursor-pointer rounded-xl outline-none hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          />
        }
      >
        {avatar}
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-68">
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Character</p>
            <div className="grid grid-cols-7 gap-1">
              {BOT_FACE_NAMES.map((face) => (
                <IconChoice
                  key={face}
                  label={face}
                  selected={icon.kind === "face" && icon.face === face}
                  onChoose={() => void change({ icon: `face-${face}` })}
                >
                  <BotFace face={face} color={bodyColor} mood="idle" className="size-6" />
                </IconChoice>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Or an icon</p>
            <div className="grid grid-cols-7 gap-1">
              <IconChoice
                label="Initial"
                selected={icon.kind === "initial"}
                onChoose={() => void change({ icon: "initial" })}
              >
                <span className="text-xs font-semibold uppercase">{props.name.slice(0, 1)}</span>
              </IconChoice>
              {Object.entries(BOT_ICONS).map(([name, Icon]) => (
                <IconChoice
                  key={name}
                  label={name}
                  selected={icon.kind === "glyph" && icon.glyph === name}
                  onChoose={() => void change({ icon: name })}
                >
                  <Icon className="size-4" />
                </IconChoice>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Colour</p>
            <div className="flex gap-1.5">
              {Object.entries(BOT_COLORS).map(([name, classes]) => (
                <button
                  key={name}
                  type="button"
                  aria-label={name}
                  aria-pressed={color === name}
                  className="grid size-6 cursor-pointer place-items-center rounded-full outline-none ring-foreground/60 ring-inset focus-visible:ring-2 aria-pressed:ring-2"
                  onClick={() => void change({ color: name })}
                >
                  <span className={cn("size-3.5 rounded-full", classes.dot)} />
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5 border-t border-border/70 pt-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                void upload(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            <Button variant="outline" size="xs" onClick={() => fileRef.current?.click()}>
              <ImageIcon aria-hidden />
              {look?.avatarAttachmentId == null ? "Use a picture" : "Change picture"}
            </Button>
            {look?.avatarAttachmentId == null ? null : (
              <Button variant="ghost" size="xs" onClick={() => void change({ avatar: null })}>
                <Trash2Icon aria-hidden />
                Remove
              </Button>
            )}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function IconChoice(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly onChoose: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.selected}
      className="grid size-8 cursor-pointer place-items-center rounded-lg text-foreground/80 outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-pressed:bg-foreground/15 aria-pressed:text-foreground"
      onClick={props.onChoose}
    >
      {props.children}
    </button>
  );
}

/** The bot at work, beside the line that says it is working. */
export function BotWorkingFace(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const bot = useBotSummary(props.environmentId, props.threadId);
  return bot === null ? null : (
    <BotAvatar
      environmentId={props.environmentId}
      name={bot.name}
      look={bot.look}
      size="row"
      mood="working"
      className="self-center"
    />
  );
}
