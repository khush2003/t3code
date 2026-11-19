import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { BotFileRow, BotImageStrip, BotTaskBlock } from "./BotBlocks";
import { splitBotFiles } from "./botBoard.logic";
import { useBotBoard, useBotBoardAll } from "./useBot";

/**
 * A task the bot started, in its chat: what it is, how it stands, and what it handed over.
 * The board is the source, so the block reads the same here as on the board. A task the board
 * does not list renders `fallback`.
 */
export function BotChatTask(props: {
  readonly environmentId: EnvironmentId;
  /** The bot's conversation the task was started from. */
  readonly botThreadId: ThreadId;
  readonly taskThreadId: ThreadId;
  readonly fallback: ReactNode;
}) {
  const board = useBotBoard(props.environmentId, props.botThreadId).data;
  const finished = useBotBoardAll(props.environmentId, props.botThreadId).data;
  // A task of open work moves, so it is read from the board that is read often.
  const items = [
    ...(board?.items ?? []),
    ...(finished?.items ?? []).filter((item) => item.state !== "open"),
  ];
  const thread = [...items.flatMap((item) => item.threads), ...(board?.unfiled ?? [])].find(
    (candidate) => candidate.threadId === props.taskThreadId,
  );
  if (thread === undefined) return props.fallback;
  const files = splitBotFiles(
    items.flatMap((item) => item.files).filter((file) => file.threadId === props.taskThreadId),
  );
  return (
    <BotTaskBlock thread={thread} className="my-1 w-full max-w-136">
      {files.images.length + files.others.length === 0 ? null : (
        <div className="flex flex-col gap-1.5 px-3 pb-3 ps-9.5">
          <BotImageStrip
            environmentId={props.environmentId}
            images={files.images}
            max={4}
            className="grid grid-cols-4 gap-1.5"
            cellClassName="aspect-[16/10]"
          />
          {files.others.map((file) => (
            <BotFileRow
              key={file.id}
              environmentId={props.environmentId}
              file={file}
              className="h-7 rounded-md"
            />
          ))}
        </div>
      )}
    </BotTaskBlock>
  );
}
