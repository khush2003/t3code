import { type AnimaName, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as AnimaService from "../../../anima/AnimaService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller, readCaller, resolveProjectId, unavailable } from "../../threadAccess.ts";
import { AnimaToolkit } from "./tools.ts";

const DEFAULT_BREATH_LIMIT = 20;

const failure = (error: { readonly _tag: string; readonly message: string }) =>
  error._tag === "AnimaNotFoundError" || error._tag === "AnimaCommandRejectedError"
    ? new OrchestratorMcpFailure({ code: "invalid_request", message: error.message })
    : unavailable();

/** The anima the calling thread runs as, for tools whose anima defaults to the caller's. */
const callerAnima = Effect.fn("mcp.anima.callerAnima")(function* (explicit: string | undefined) {
  if (explicit !== undefined) return explicit;
  const { caller } = yield* loadCaller();
  const name = caller?.animaName ?? null;
  if (name !== null) return name;
  return yield* new OrchestratorMcpFailure({
    code: "invalid_request",
    message: "This thread has no anima; pass name.",
  });
});

export const layer = McpToolAccess.toLayer(AnimaToolkit, {
  t3_anima_list: McpToolAccess.reads(() =>
    AnimaService.AnimaService.pipe(
      Effect.flatMap((animas) => animas.list),
      Effect.mapError(failure),
    ),
  ),
  t3_anima_read: McpToolAccess.reads((input) =>
    AnimaService.AnimaService.pipe(
      Effect.flatMap((animas) =>
        animas.get({ name: input.name, breathLimit: input.breathLimit ?? DEFAULT_BREATH_LIMIT }),
      ),
      Effect.mapError(failure),
    ),
  ),
  t3_anima_policy: McpToolAccess.writesEnvironment((input) =>
    AnimaService.AnimaService.pipe(
      Effect.flatMap((animas) => animas.policy(input)),
      Effect.mapError(failure),
    ),
  ),
  t3_anima_attach: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const context = yield* readCaller();
      const projectId = yield* resolveProjectId(context, input.projectId);
      const animas = yield* AnimaService.AnimaService;
      return yield* animas.attach({ name: input.name, projectId }).pipe(Effect.mapError(failure));
    }),
  ),
  t3_anima_create: McpToolAccess.writesEnvironment((input) =>
    AnimaService.AnimaService.pipe(
      Effect.flatMap((animas) => animas.create(input)),
      Effect.mapError(failure),
    ),
  ),
  t3_anima_clinic: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const name = yield* callerAnima(input.name);
      const animas = yield* AnimaService.AnimaService;
      return yield* animas
        .clinic({
          name: name as AnimaName,
          form: input.form,
          ...(input.accent === undefined ? {} : { accent: input.accent }),
        })
        .pipe(Effect.mapError(failure));
    }),
  ),
  t3_anima_record: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const name = yield* callerAnima(input.name);
      const animas = yield* AnimaService.AnimaService;
      return yield* animas
        .record({ ...input, name: name as AnimaName })
        .pipe(Effect.mapError(failure));
    }),
  ),
  t3_anima_opens_list: McpToolAccess.reads((input) =>
    AnimaService.AnimaService.pipe(
      Effect.flatMap((animas) => animas.opens(input.name)),
      Effect.map((opens) => ({ name: input.name, opens })),
      Effect.mapError(failure),
    ),
  ),
  t3_anima_opens_update: McpToolAccess.writesEnvironment((input) =>
    AnimaService.AnimaService.pipe(
      Effect.flatMap((animas) => animas.opensAction(input)),
      Effect.mapError(failure),
    ),
  ),
  t3_anima_library_list: McpToolAccess.reads(() =>
    AnimaService.AnimaService.pipe(
      Effect.flatMap((animas) => animas.libraryList),
      Effect.mapError(failure),
    ),
  ),
  t3_anima_library_read: McpToolAccess.reads((input) =>
    AnimaService.AnimaService.pipe(
      Effect.flatMap((animas) => animas.libraryRead(input.slug)),
      Effect.mapError(failure),
    ),
  ),
  t3_anima_health: McpToolAccess.reads((input) =>
    AnimaService.AnimaService.pipe(
      Effect.flatMap((animas) => animas.health(input.name)),
      Effect.mapError(failure),
    ),
  ),
});
