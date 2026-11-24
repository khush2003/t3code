import s from "./space.module.css";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type { BotSummary, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { BOT_SPOKEN_PREFIX } from "@t3tools/shared/botShow";
import { Link } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { ChevronLeftIcon } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { observeResize } from "~/lib/observeResize";
import { useVoiceTranscriptionDestination } from "~/speech/useEnvironmentSpeechInput";
import { botsEnvironment } from "~/state/bots";
import {
  useQuietThreadShell,
  useQuietThreadShells,
  useThreadStatus,
  useThreadVisibleTurnItems,
} from "~/state/entities";
import {
  useConnectedEnvironmentIds,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";

import { resolveBotHome } from "../../sidebar/SidebarBots.logic";
import { BotTaskStateLabel } from "../BotBlocks";
import { sortBotTasks } from "../botBoard.logic";
import { botColorName } from "../botLook";
import { isBotThreadId } from "../botView";
import {
  lastLedScreen,
  lastOwnMessage,
  placeBotStars,
  TALL_ALONE,
  type BotStarPlace,
  type SpaceScreen,
} from "./botSpace.logic";
import type { BotSpaceScene, SpaceStar, StarOnScreen } from "./BotSpaceScene";
import { spaceTasks, useSpaceBoards, type SpaceTask } from "./spaceBoards";
import { recentPictures } from "./spaceWall.logic";
import { SpaceTalk } from "./SpaceTalk";
import { talkRows } from "./spaceTalk.logic";
import { SpaceWall } from "./SpaceWall";

/** The light each of a bot's colours gives off against black. */
const STAR_LIGHT: Readonly<Record<string, string>> = {
  slate: "#cbd5e1",
  blue: "#7aa8ff",
  teal: "#2dd4bf",
  green: "#34d399",
  amber: "#ffc46b",
  red: "#f87171",
  pink: "#f472b6",
  violet: "#a78bfa",
};
/** More tasks than this under a bot crowd the ones beside it. */
const TASKS_UNDER_A_BOT = 4;
const lit = (color: string) => ({ "--c": color }) as CSSProperties;

type StartedBot = BotSummary & { readonly threadId: ThreadId };

/** One bot among the others: its light in the scene, and under it its name and what it is doing. */
function BotStar(props: {
  readonly environmentId: EnvironmentId;
  readonly bot: StartedBot;
  readonly tasks: ReadonlyArray<SpaceTask>;
  readonly color: string;
  readonly place: BotStarPlace;
  readonly lead: boolean;
  /** There is room under this bot to list its tasks. */
  readonly roomy: boolean;
  readonly register: (id: string, star: SpaceStar | null) => void;
  readonly label: (id: string, element: HTMLElement | null) => void;
  readonly onShow: (screen: SpaceScreen) => void;
}) {
  const gt = useGT();
  const { bot, place, register, color } = props;
  const shell = useQuietThreadShell(scopeThreadRef(props.environmentId, bot.threadId));
  // What it is doing now hangs under it: the tasks at work and the ones waiting on the person.
  const live = sortBotTasks(
    props.tasks
      .map((task) => task.thread)
      .filter((thread) => thread.status === "working" || thread.status === "needs-input"),
  );
  const working = live.filter((thread) => thread.status === "working").length;
  const waiting = bot.waitingOnYou + live.length - working;
  const busy = shell !== null && isThreadWorking(shell);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the three.js scene is outside React and draws this bot from these values
  useEffect(() => {
    register(bot.name, {
      id: bot.name,
      color,
      centre: props.lead,
      place,
      working,
      waiting,
      busy,
    });
  }, [register, bot.name, color, props.lead, place, working, waiting, busy]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- takes the bot out of the scene when it is no longer listed
  useEffect(() => () => register(bot.name, null), [register, bot.name]);

  const status =
    waiting > 0
      ? gt("Needs you")
      : working > 0
        ? gt("{count, plural, one {# task running} other {# tasks running}}", { count: working })
        : busy
          ? gt("Replying")
          : bot.openItems > 0
            ? gt("{count, plural, one {# thing open} other {# things open}}", {
                count: bot.openItems,
              })
            : gt("Quiet");

  return (
    <div
      ref={(element) => props.label(bot.name, element)}
      className={props.lead ? `${s.star} ${s.isLead}` : s.star}
      style={lit(color)}
    >
      <div className={s.starIn}>
        <button
          type="button"
          className={s.name}
          aria-label={gt("Show {name}'s open work", { name: bot.name })}
          onClick={() => props.onShow({ kind: "board", bot: bot.name })}
        >
          <b>{bot.name}</b>
          <span className={waiting > 0 ? s.isNeed : undefined}>{status}</span>
        </button>
        {!props.roomy || live.length === 0 ? null : (
          <ul className={s.tasks}>
            {live.slice(0, TASKS_UNDER_A_BOT).map((thread) => (
              <li key={`${thread.environmentId}:${thread.threadId}`}>
                <button
                  type="button"
                  onClick={() =>
                    props.onShow({
                      kind: "task",
                      bot: bot.name,
                      environmentId: thread.environmentId,
                      threadId: thread.threadId,
                    })
                  }
                >
                  <i className={thread.status === "needs-input" ? s.isNeed : undefined} />
                  <span>{thread.title}</span>
                  <em className={thread.status === "needs-input" ? `${s.num} ${s.isNeed}` : s.num}>
                    <BotTaskStateLabel thread={thread} />
                  </em>
                </button>
              </li>
            ))}
            {live.length <= TASKS_UNDER_A_BOT ? null : (
              <li className={s.isMore}>
                {gt("and {count} more", { count: live.length - TASKS_UNDER_A_BOT })}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function SpaceOf(props: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const { environmentId } = props;
  const list = useEnvironmentQuery(botsEnvironment.list({ environmentId, input: {} }));
  const bots = (list.data?.bots ?? []).filter((bot): bot is StartedBot => bot.threadId !== null);
  const lead = bots.find((bot) => bot.oversees) ?? bots[0] ?? null;
  const boards = useSpaceBoards(environmentId, bots);
  const tasks = spaceTasks(boards);
  const hears = useVoiceTranscriptionDestination().label;
  const light = (name: string | null) => {
    const bot = bots.find((candidate) => candidate.name === name);
    return (
      (bot === undefined ? undefined : STAR_LIGHT[botColorName(bot.name, bot.look)]) ??
      STAR_LIGHT.slate!
    );
  };

  const leadRef = lead === null ? null : scopeThreadRef(environmentId, lead.threadId);
  const leadItems = useThreadVisibleTurnItems(leadRef);
  // Until the chat is in step with its machine, an old reply would count as new and be read out.
  const leadLive = useThreadStatus(leadRef) === "live";
  /** This visit starts at this point of the lead's chat; what came before is not said or shown. */
  const [since, setSince] = useState<{ readonly lead: string; readonly position: number } | null>(
    null,
  );
  const from = lead !== null && since?.lead === lead.name ? since.position : null;
  if (lead !== null && leadLive && from === null)
    setSince({ lead: lead.name, position: leadItems.at(-1)?.position ?? -1 });
  // The screen follows what the lead's answers are about, until the person picks one themselves.
  const nameable = boards.flatMap((board) =>
    board.items.flatMap((item) =>
      item.files.map((file) => ({
        bot: board.bot,
        id: file.id,
        title: file.title,
        createdAt: file.createdAt,
      })),
    ),
  );
  const led =
    lead === null || from === null ? null : lastLedScreen(leadItems, from, lead.name, nameable);
  const said = from === null ? null : lastOwnMessage(leadItems, from);
  const [picked, setPicked] = useState<{
    readonly screen: SpaceScreen | null;
    /** The lead's last subject when the person chose; a newer one may take the screen back. */
    readonly after: string | null;
    /** What the person had last said when they chose. */
    readonly said: string | null;
  }>({ screen: null, after: null, said: null });
  // A screen the person opened stays until they close it, the lead shows them something, or
  // they ask for something else and the answer is about another thing.
  const screen =
    led !== null &&
    led.id !== picked.after &&
    (led.shown || picked.screen === null || (led.after !== null && led.after !== picked.said))
      ? led.screen
      : picked.screen;
  const show = useStableCallback((next: SpaceScreen | null) =>
    setPicked({ screen: next, after: led?.id ?? null, said }),
  );

  // Who the lead has asked and not yet heard back from: a line of light joins them meanwhile.
  const asked = new Set<string>();
  if (lead !== null && from !== null)
    for (const row of talkRows(
      leadItems.filter((item) => item.position > from),
      lead.name,
      BOT_SPOKEN_PREFIX,
    )) {
      if (row.kind === "told") asked.add(row.bot);
      else if (row.kind === "heard") asked.delete(row.bot);
    }
  const links = [...asked].toSorted().join("\n");
  const leadName = lead?.name ?? null;

  const [flat, setFlat] = useState(false);
  const [tall, setTall] = useState(true);
  const places = placeBotStars(bots, tall);
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const scene = useRef<BotSpaceScene | null>(null);
  const stars = useRef(new Map<string, SpaceStar>());
  const labels = useRef(new Map<string, HTMLElement>());

  const place = useStableCallback((id: string, at: StarOnScreen | null) => {
    const label = labels.current.get(id);
    if (label === undefined) return;
    label.style.opacity = at === null ? "0" : "1";
    if (at !== null)
      label.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y + at.radius * 1.55 + 4)}px)`;
  });
  const register = useStableCallback((id: string, star: SpaceStar | null) => {
    if (star === null) stars.current.delete(id);
    else stars.current.set(id, star);
    scene.current?.update([...stars.current.values()]);
  });
  const label = useStableCallback((id: string, element: HTMLElement | null) => {
    if (element === null) labels.current.delete(id);
    else labels.current.set(id, element);
  });
  const select = useStableCallback((name: string | null) => {
    if (name !== null) show({ kind: "board", bot: name });
  });
  /** Tells the scene which part of the window the bots have, and whether it is a tall column. */
  const measure = useStableCallback(() => {
    const room = stage.current?.getBoundingClientRect();
    const whole = host.current?.getBoundingClientRect();
    if (room === undefined || whole === undefined || room.width === 0) return;
    setTall(room.height > room.width * 1.15);
    scene.current?.setRegion({
      left: room.left - whole.left,
      top: room.top - whole.top,
      width: room.width,
      height: room.height,
    });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the WebGL scene for as long as the page is shown; three.js loads only here
  useEffect(() => {
    let closed = false;
    let created: BotSpaceScene | null = null;
    import("./BotSpaceScene")
      .then(({ BotSpaceScene: Scene }) => {
        if (closed || host.current === null) return;
        created = new Scene(host.current, select, place);
        scene.current = created;
        measure();
        created.update([...stars.current.values()]);
      })
      // A browser without WebGL still gets the names, the screen and the conversation.
      .catch(() => setFlat(true));
    return () => {
      closed = true;
      created?.dispose();
      scene.current = null;
    };
  }, [place, select, measure]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the bots' part of the window changes with its size and with what is laid out beside it
  useEffect(() => {
    measure();
    return stage.current === null ? undefined : observeResize(stage.current, measure);
  }, [measure]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the lines between bots are drawn by the scene, which is outside React
  useEffect(() => {
    if (leadName === null) return;
    scene.current?.setLinks(
      links === "" ? [] : links.split("\n").map((to) => ({ from: leadName, to })),
    );
  }, [links, leadName]);

  const running = tasks.filter((task) => task.thread.status === "working").length;
  const pictures = recentPictures(boards, 1).length > 0;
  const needs =
    bots.reduce((sum, bot) => sum + bot.waitingOnYou, 0) +
    tasks.filter((task) => task.thread.status === "needs-input").length;
  const others = bots.length - 1;

  return (
    <div
      // With nothing on the screen a narrow window gives its room to the bots themselves.
      className={
        screen === null && running + needs === 0 && !pictures
          ? `${s.root} dark ${s.isPlain}`
          : `${s.root} dark`
      }
      style={lit(light(leadName))}
    >
      <div ref={host} className={s.scene} />
      <div className={s.top}>
        <Link to="/" className={s.leave}>
          <ChevronLeftIcon />
          {gt("Back to chats")}
        </Link>
        {bots.length === 0 ? null : (
          <>
            <span>{gt("{count, plural, one {# bot} other {# bots}}", { count: bots.length })}</span>
            {running === 0 ? null : (
              <span>
                {gt("{count, plural, one {# task running} other {# tasks running}}", {
                  count: running,
                })}
              </span>
            )}
            {needs === 0 ? null : (
              <span className={s.needs}>
                {gt("{count, plural, one {# needs you} other {# need you}}", { count: needs })}
              </span>
            )}
          </>
        )}
        <span className={s.grow} />
        {hears === null ? null : <span>{gt("Hears you through {where}", { where: hears })}</span>}
      </div>

      {lead === null ? (
        <section className={s.talk} />
      ) : (
        <SpaceTalk
          key={lead.name}
          environmentId={environmentId}
          bot={lead}
          items={leadItems}
          from={from}
          tasks={tasks}
          words={bots.map((bot) => bot.name)}
          light={light}
          scene={() => scene.current}
          onShow={show}
          onEscape={() => show(null)}
        />
      )}

      <section ref={stage} className={s.stage}>
        {flat ? (
          <p className={s.empty}>
            {gt("This browser cannot draw the space. The conversation and the screen still work.")}
          </p>
        ) : null}
        {list.data !== null && bots.length === 0 ? (
          <p className={s.empty}>
            {gt("No bots yet. Start one from the sidebar and it appears here.")}
          </p>
        ) : null}
        {list.data === null && list.error !== null ? (
          <p role="alert" className={s.empty}>
            {list.error}
          </p>
        ) : null}
      </section>

      <SpaceWall
        home={environmentId}
        bots={bots}
        boards={boards}
        screen={screen}
        light={light}
        onShow={show}
      />

      {bots.map((bot) => (
        <BotStar
          key={bot.name}
          environmentId={environmentId}
          bot={bot}
          tasks={tasks.filter((task) => task.bot === bot.name)}
          color={light(bot.name)}
          place={places.get(bot.name)!}
          lead={bot === lead}
          roomy={!tall || others <= TALL_ALONE}
          register={register}
          label={label}
          onShow={show}
        />
      ))}
    </div>
  );
}

/** Every bot as a light in the dark, with the one that oversees them to talk to. */
export function BotSpace() {
  const gt = useGT();
  const shells = useQuietThreadShells();
  const primary = usePrimaryEnvironmentId();
  const connected = useConnectedEnvironmentIds();
  const { environments } = useEnvironments();
  const bots = shells.filter(
    (thread) => thread.bot === true && thread.archivedAt === null && !isBotThreadId(thread.id),
  );
  const machines = environments
    .filter((environment) => connected.includes(environment.environmentId))
    .map(({ environmentId, label }) => ({ environmentId, label }));
  const home = resolveBotHome(bots, machines, primary);

  return home === null ? (
    <div className={`${s.root} dark`}>
      <div className={s.top}>
        <Link to="/" className={s.leave}>
          <ChevronLeftIcon />
          {gt("Back to chats")}
        </Link>
      </div>
      <p className={s.empty}>{gt("No machine is connected.")}</p>
    </div>
  ) : (
    <SpaceOf key={home} environmentId={home} />
  );
}
