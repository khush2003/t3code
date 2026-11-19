// @effect-diagnostics nodeBuiltinImport:off
// Effect's FileSystem has no statfs.
import * as NodeFSP from "node:fs/promises";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "./config.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as StorageCleanup from "./storageCleanup.ts";
import { resolveWorktreesDirectory } from "./worktreesDirectory.ts";

const GIB = 1024 ** 3;

/** Free space unattended work must leave: a tenth of the disk, between 10 and 20 GiB. */
export function diskFloorBytes(totalBytes: number): number {
  return Math.max(10 * GIB, Math.min(totalBytes / 10, 20 * GIB));
}

const formatGib = (bytes: number) => `${(bytes / GIB).toFixed(1)} GB`;

export class DiskSpaceLowError extends Schema.TaggedError<DiskSpaceLowError>()(
  "DiskSpaceLowError",
  { freeBytes: Schema.Number, floorBytes: Schema.Number },
) {
  override get message(): string {
    return `This machine has ${formatGib(this.freeBytes)} of disk free and keeps ${formatGib(this.floorBytes)} free, so it cannot make another worktree. Storage cleanup already ran.`;
  }
}

export interface DiskSpace {
  readonly freeBytes: number;
  readonly totalBytes: number;
}

export class DiskGuard extends Context.Service<
  DiskGuard,
  {
    /** Before unattended work makes a worktree: reclaim if needed, then fail if room is still short. */
    readonly ensureRoomForWorktree: Effect.Effect<void, DiskSpaceLowError>;
  }
>()("t3/diskGuard") {}

/** The nearest existing folder's filesystem; null when unreadable, which never blocks work. */
const readDiskSpace = (target: string, path: Path.Path): Effect.Effect<DiskSpace | null> =>
  Effect.promise(() => NodeFSP.statfs(target).catch(() => null)).pipe(
    Effect.flatMap((stats) => {
      if (stats !== null)
        return Effect.succeed({
          freeBytes: Number(stats.bavail) * Number(stats.bsize),
          totalBytes: Number(stats.blocks) * Number(stats.bsize),
        });
      const parent = path.dirname(target);
      return parent === target ? Effect.succeed(null) : readDiskSpace(parent, path);
    }),
  );

export const make = Effect.fn("DiskGuard.make")(function* (
  readSpace?: (target: string) => Effect.Effect<DiskSpace | null>,
) {
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const cleanup = yield* StorageCleanup.StorageCleanup;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const read = readSpace ?? ((target: string) => readDiskSpace(target, path));

  const measure = Effect.gen(function* () {
    const setting = yield* settings.getSettings.pipe(
      Effect.map((current) => current.worktreesDirectory),
      Effect.orElseSucceed(() => ""),
    );
    return yield* read(
      resolveWorktreesDirectory(setting, config.worktreesDir, path, home) ?? config.worktreesDir,
    );
  });

  const short = (space: DiskSpace | null) =>
    space !== null && space.freeBytes < diskFloorBytes(space.totalBytes);

  const ensureRoomForWorktree = Effect.gen(function* () {
    if (!short(yield* measure)) return;
    const bytesFreed = yield* cleanup.runNow.pipe(
      Effect.map((report) => report.bytesFreed),
      Effect.timeoutOption("2 minutes"),
      Effect.map(Option.getOrNull),
      Effect.orElseSucceed(() => null),
    );
    yield* Effect.logInfo("disk guard reclaimed before a worktree", { bytesFreed });
    const after = yield* measure;
    if (after !== null && short(after))
      return yield* new DiskSpaceLowError({
        freeBytes: after.freeBytes,
        floorBytes: diskFloorBytes(after.totalBytes),
      });
  }).pipe(Effect.withSpan("DiskGuard.ensureRoomForWorktree"));

  return DiskGuard.of({ ensureRoomForWorktree });
});

export const layer = Layer.effect(DiskGuard, make());

/** For tests that do not exercise disk space. */
export const layerTest = Layer.succeed(
  DiskGuard,
  DiskGuard.of({ ensureRoomForWorktree: Effect.void }),
);
