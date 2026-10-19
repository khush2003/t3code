import {
  type AtlasGetInitiativeInput,
  type AtlasListInitiativesInput,
  WS_METHODS,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/reactivity";

import { requestGuarded } from "../rpc/client.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createAtlasEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // Bumped after every mutation so every cached initiative read in that
  // environment refetches, without the client having to know which list inputs
  // are mounted.
  const revisionFamily = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(0).pipe(Atom.withLabel(`environment-data:atlas:revision:${environmentId}`)),
  );
  const scheduler = createAtomCommandScheduler();

  const listInitiatives = createEnvironmentQueryAtomFamily(runtime, {
    label: "environment-data:atlas:list-initiatives",
    staleTimeMs: 15_000,
    idleTtlMs: 5 * 60_000,
    refreshTrigger: ({ environmentId }) => revisionFamily(environmentId),
    execute: (input: AtlasListInitiativesInput) =>
      requestGuarded(WS_METHODS.atlasListInitiatives, input),
  });

  const getInitiative = createEnvironmentQueryAtomFamily(runtime, {
    label: "environment-data:atlas:get-initiative",
    staleTimeMs: 15_000,
    idleTtlMs: 5 * 60_000,
    refreshTrigger: ({ environmentId }) => revisionFamily(environmentId),
    execute: (input: AtlasGetInitiativeInput) =>
      requestGuarded(WS_METHODS.atlasGetInitiative, input),
  });

  const bump = (registry: AtomRegistry.AtomRegistry, environmentId: EnvironmentId) =>
    Effect.sync(() => {
      registry.update(revisionFamily(environmentId), (current) => current + 1);
    });

  return {
    listInitiatives,
    getInitiative,
    createInitiative: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:atlas:create-initiative",
      tag: WS_METHODS.atlasCreateInitiative,
      scheduler,
      onSuccess: ({ environmentId }, registry) => bump(registry, environmentId),
    }),
    updateInitiative: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:atlas:update-initiative",
      tag: WS_METHODS.atlasUpdateInitiative,
      scheduler,
      onSuccess: ({ environmentId }, registry) => bump(registry, environmentId),
    }),
    deleteInitiative: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:atlas:delete-initiative",
      tag: WS_METHODS.atlasDeleteInitiative,
      scheduler,
      onSuccess: ({ environmentId }, registry) => bump(registry, environmentId),
    }),
    startPlanning: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:atlas:start-planning",
      tag: WS_METHODS.atlasStartPlanning,
      scheduler,
      onSuccess: ({ environmentId }, registry) => bump(registry, environmentId),
    }),
    importPlan: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:atlas:import-plan",
      tag: WS_METHODS.atlasImportPlan,
      scheduler,
      onSuccess: ({ environmentId }, registry) => bump(registry, environmentId),
    }),
    refreshInitiative: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:atlas:refresh-initiative",
      tag: WS_METHODS.atlasRefreshInitiative,
      scheduler,
      onSuccess: ({ environmentId }, registry) => bump(registry, environmentId),
    }),
    executeTask: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:atlas:execute-task",
      tag: WS_METHODS.atlasExecuteTask,
      scheduler,
      onSuccess: ({ environmentId }, registry) => bump(registry, environmentId),
    }),
    approveTask: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:atlas:approve-task",
      tag: WS_METHODS.atlasApproveTask,
      scheduler,
      onSuccess: ({ environmentId }, registry) => bump(registry, environmentId),
    }),
    requestChanges: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:atlas:request-changes",
      tag: WS_METHODS.atlasRequestChanges,
      scheduler,
      onSuccess: ({ environmentId }, registry) => bump(registry, environmentId),
    }),
    startAgentReview: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:atlas:start-agent-review",
      tag: WS_METHODS.atlasStartAgentReview,
      scheduler,
      onSuccess: ({ environmentId }, registry) => bump(registry, environmentId),
    }),
    publishTaskIssue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:atlas:publish-task-issue",
      tag: WS_METHODS.atlasPublishTaskIssue,
      scheduler,
      onSuccess: ({ environmentId }, registry) => bump(registry, environmentId),
    }),
  };
}
