import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "./config.ts";
import * as DiskGuard from "./diskGuard.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as StorageCleanup from "./storageCleanup.ts";

const GIB = 1024 ** 3;

const guard = (free: { bytes: number }, reclaims: number) =>
  Effect.gen(function* () {
    let sweeps = 0;
    const service = yield* DiskGuard.make((_target) =>
      Effect.succeed({ freeBytes: free.bytes, totalBytes: 150 * GIB }),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(StorageCleanup.StorageCleanup)({
            runNow: Effect.sync(() => {
              sweeps++;
              free.bytes += reclaims;
              return { bytesFreed: reclaims } as never;
            }),
          }),
          ServerSettings.layerTest(),
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-disk-guard-" }).pipe(
            Layer.provide(NodeServices.layer),
          ),
          NodeServices.layer,
        ),
      ),
    );
    return { service, sweeps: () => sweeps };
  });

it.effect("keeps a tenth of the disk free, between 10 and 20 GiB", () =>
  Effect.sync(() => {
    assert.equal(DiskGuard.diskFloorBytes(50 * GIB), 10 * GIB);
    assert.equal(DiskGuard.diskFloorBytes(150 * GIB), 15 * GIB);
    assert.equal(DiskGuard.diskFloorBytes(2000 * GIB), 20 * GIB);
  }),
);

it.effect("reclaims below the floor and refuses only when that is not enough", () =>
  Effect.gen(function* () {
    const roomy = yield* guard({ bytes: 40 * GIB }, 0);
    yield* roomy.service.ensureRoomForWorktree;
    assert.equal(roomy.sweeps(), 0);

    const reclaimed = yield* guard({ bytes: 8 * GIB }, 10 * GIB);
    yield* reclaimed.service.ensureRoomForWorktree;
    assert.equal(reclaimed.sweeps(), 1);

    const full = yield* guard({ bytes: 8 * GIB }, GIB);
    const refused = yield* full.service.ensureRoomForWorktree.pipe(Effect.flip);
    assert.equal(full.sweeps(), 1);
    assert.equal(refused.freeBytes, 9 * GIB);
    assert.include(refused.message, "9.0 GB of disk free and keeps 15.0 GB free");
  }),
);
