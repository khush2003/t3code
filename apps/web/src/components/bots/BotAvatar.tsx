import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type BotLook,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { ImageIcon, Trash2Icon } from "lucide-react";
import { useRef } from "react";

import { useAssetUrls } from "~/assets/assetUrls";
import { cn } from "~/lib/utils";
import { botsEnvironment } from "~/state/bots";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { BOT_COLORS, BOT_ICONS, botColorName, readBotAvatar } from "./botLook";
import { useRefreshBots } from "./useBot";

const SIZES = {
  sm: { tile: "size-5 rounded-md text-2xs", icon: "size-3" },
  md: { tile: "size-8 rounded-lg text-sm", icon: "size-4.5" },
  lg: { tile: "size-10 rounded-xl text-base", icon: "size-5.5" },
} as const;

/** A bot's face: its picture, else its icon on its colour, else its initial. */
export function BotAvatar(props: {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly look: BotLook | null | undefined;
  readonly size: keyof typeof SIZES;
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
  const Icon = look?.icon == null ? undefined : BOT_ICONS[look.icon];
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden font-semibold uppercase",
        size.tile,
        BOT_COLORS[botColorName(props.name, look)]?.tile,
        props.className,
      )}
    >
      {picture != null ? (
        <img src={picture} alt="" className="absolute inset-0 size-full object-cover" />
      ) : Icon !== undefined ? (
        <Icon className={size.icon} />
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
  const avatar = (
    <BotAvatar environmentId={environmentId} name={props.name} look={look} size="lg" />
  );
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
            <p className="mb-1.5 text-xs text-muted-foreground">Icon</p>
            <div className="grid grid-cols-7 gap-1">
              <IconChoice
                label="Initial"
                selected={look?.icon == null}
                onChoose={() => void change({ icon: null })}
              >
                <span className="text-xs font-semibold uppercase">{props.name.slice(0, 1)}</span>
              </IconChoice>
              {Object.entries(BOT_ICONS).map(([name, Icon]) => (
                <IconChoice
                  key={name}
                  label={name}
                  selected={look?.icon === name}
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
