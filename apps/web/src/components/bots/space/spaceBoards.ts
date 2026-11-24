import { useAtomValue } from "@effect/atom-react";
import type {
  BotBoardFile,
  BotBoardItem,
  BotBoardThread,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { botsEnvironment } from "~/state/bots";

/** One bot's work as the space reads it: open items as they stand now, then finished ones. */
export interface SpaceBoard {
  readonly bot: string;
  readonly items: ReadonlyArray<BotBoardItem>;
  /** Running tasks the bot started that sit on no item. */
  readonly unfiled: ReadonlyArray<BotBoardThread>;
  /** False until the bot's open work has been read once. */
  readonly loaded: boolean;
}

type Bots = ReadonlyArray<{ readonly name: string; readonly threadId: ThreadId }>;

// One atom per set of bots, so every part of the space reads the same boards in one place.
const atoms = new Map<string, Atom.Atom<ReadonlyArray<SpaceBoard>>>();

function boardsAtom(environmentId: EnvironmentId, bots: Bots) {
  const key = `${environmentId}\n${bots.map((bot) => `${bot.name}\t${bot.threadId}`).join("\n")}`;
  const kept = atoms.get(key);
  if (kept !== undefined) return kept;
  const made = Atom.make((get) =>
    bots.map((bot): SpaceBoard => {
      const open = AsyncResult.getOrElse(
        get(botsEnvironment.board({ environmentId, input: { threadId: bot.threadId } })),
        () => null,
      );
      const all = AsyncResult.getOrElse(
        get(
          botsEnvironment.boardAll({
            environmentId,
            input: { threadId: bot.threadId, includeClosed: true },
          }),
        ),
        () => null,
      );
      return {
        bot: bot.name,
        // Open work moves, so it comes from the board that is read often.
        items: [
          ...(open?.items ?? []),
          ...(all?.items ?? []).filter((item) => item.state !== "open"),
        ],
        unfiled: open?.unfiled ?? [],
        loaded: open !== null,
      };
    }),
  ).pipe(Atom.withLabel("web-space:boards"));
  atoms.set(key, made);
  return made;
}

/** Every bot's board, read together and kept fresh while the space is open. */
export function useSpaceBoards(environmentId: EnvironmentId, bots: Bots) {
  return useAtomValue(boardsAtom(environmentId, bots));
}

export interface SpaceTask {
  readonly bot: string;
  readonly thread: BotBoardThread;
  /** What this task handed over. */
  readonly files: ReadonlyArray<BotBoardFile>;
}

/** Every task on the boards, with the bot it belongs to. */
export function spaceTasks(boards: ReadonlyArray<SpaceBoard>): ReadonlyArray<SpaceTask> {
  return boards.flatMap((board) => {
    const files = board.items.flatMap((item) => item.files);
    return [...board.items.flatMap((item) => item.threads), ...board.unfiled].map((thread) => ({
      bot: board.bot,
      thread,
      files: files.filter((file) => file.threadId === thread.threadId),
    }));
  });
}
