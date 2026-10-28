import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as AnimaService from "../../../anima/AnimaService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller, resolveProjectId, unavailable } from "../../threadAccess.ts";
import { AnimaToolkit } from "./tools.ts";

const DEFAULT_BREATH_LIMIT = 20;

const failure = (error: { readonly _tag: string; readonly message: string }) =>
  error._tag === "AnimaNotFoundError" || error._tag === "AnimaCommandRejectedError"
    ? new OrchestratorMcpFailure({ code: "invalid_request", message: error.message })
    : unavailable();

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
});
