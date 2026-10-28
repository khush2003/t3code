import type {
  AnimaBundle,
  AnimaCompareResult,
  AnimaMergeStartResult,
  AnimaMutationResult,
  AnimaName,
  AnimaSummary,
  AnimaSyncRelation,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";

/** What a sync of one anima should do, decided purely from the destination's comparison. */
export type AnimaSyncPlan =
  | { readonly kind: "import"; readonly mode: "create" | "fast-forward" }
  | { readonly kind: "up-to-date" }
  /** The destination is ahead; the useful move is the opposite direction. */
  | { readonly kind: "destination-ahead" }
  /** Histories split. The user chooses between an agent merge and replacing the destination. */
  | { readonly kind: "needs-choice"; readonly reason: "diverged" | "unrelated" };

export function planAnimaSync(relation: AnimaSyncRelation): AnimaSyncPlan {
  switch (relation) {
    case "missing":
      return { kind: "import", mode: "create" };
    case "incoming-ahead":
      return { kind: "import", mode: "fast-forward" };
    case "identical":
      return { kind: "up-to-date" };
    case "local-ahead":
      return { kind: "destination-ahead" };
    case "diverged":
    case "unrelated":
      return { kind: "needs-choice", reason: relation };
  }
}

/** The same comparison seen from the other side. */
export function invertAnimaRelation(relation: AnimaSyncRelation): AnimaSyncRelation {
  if (relation === "incoming-ahead") return "local-ahead";
  if (relation === "local-ahead") return "incoming-ahead";
  // `missing` flips to "the other side has nothing to compare"; callers treat that as absent.
  return relation;
}

export type AnimaQuickState = "only-here" | "only-there" | "identical" | "different" | "unrelated";

/** Cheap pre-check from list summaries alone, before any bundle is exported. */
export function quickAnimaState(
  here: Pick<AnimaSummary, "id" | "digest"> | null,
  there: Pick<AnimaSummary, "id" | "digest"> | null,
): AnimaQuickState {
  if (here === null && there === null) return "identical";
  if (there === null) return "only-here";
  if (here === null) return "only-there";
  if (here.id !== there.id) return "unrelated";
  return here.digest === there.digest ? "identical" : "different";
}

export function animaSyncRelationLabel(relation: AnimaSyncRelation): string {
  switch (relation) {
    case "missing":
      return "Not on the other side";
    case "identical":
      return "Identical";
    case "incoming-ahead":
      return "Incoming is ahead";
    case "local-ahead":
      return "Destination is ahead";
    case "diverged":
      return "Diverged";
    case "unrelated":
      return "Different anima with the same name";
  }
}

/** Environment-addressed calls the sync flow needs; each rejects with an Error on failure. */
export interface AnimaSyncPorts {
  readonly exportBundle: (environmentId: EnvironmentId, name: AnimaName) => Promise<AnimaBundle>;
  readonly compare: (
    environmentId: EnvironmentId,
    bundle: AnimaBundle,
  ) => Promise<AnimaCompareResult>;
  readonly importBundle: (
    environmentId: EnvironmentId,
    input: { readonly bundle: AnimaBundle; readonly mode: "create" | "replace" | "fast-forward" },
  ) => Promise<AnimaMutationResult>;
  readonly mergeStart: (
    environmentId: EnvironmentId,
    input: { readonly bundle: AnimaBundle; readonly projectId: ProjectId },
  ) => Promise<AnimaMergeStartResult>;
}

export interface AnimaSyncRequest {
  readonly fromEnvironmentId: EnvironmentId;
  readonly toEnvironmentId: EnvironmentId;
  readonly name: AnimaName;
}

export type AnimaSyncOutcome =
  | { readonly status: "created" | "fast-forwarded"; readonly output: string }
  | { readonly status: "up-to-date" }
  | { readonly status: "destination-ahead"; readonly compare: AnimaCompareResult }
  | {
      readonly status: "needs-choice";
      readonly reason: "diverged" | "unrelated";
      readonly compare: AnimaCompareResult;
      readonly bundle: AnimaBundle;
    };

export async function compareAnimaAcross(request: AnimaSyncRequest, ports: AnimaSyncPorts) {
  const bundle = await ports.exportBundle(request.fromEnvironmentId, request.name);
  const compare = await ports.compare(request.toEnvironmentId, bundle);
  return { bundle, compare, plan: planAnimaSync(compare.relation) };
}

export async function syncAnima(
  request: AnimaSyncRequest,
  ports: AnimaSyncPorts,
): Promise<AnimaSyncOutcome> {
  const { bundle, compare, plan } = await compareAnimaAcross(request, ports);
  switch (plan.kind) {
    case "import": {
      const result = await ports.importBundle(request.toEnvironmentId, {
        bundle,
        mode: plan.mode,
      });
      return {
        status: plan.mode === "create" ? "created" : "fast-forwarded",
        output: result.output,
      };
    }
    case "up-to-date":
      return { status: "up-to-date" };
    case "destination-ahead":
      return { status: "destination-ahead", compare };
    case "needs-choice":
      return { status: "needs-choice", reason: plan.reason, compare, bundle };
  }
}

export type AnimaSyncResolution =
  | { readonly kind: "replaced"; readonly output: string }
  | ({ readonly kind: "merging" } & AnimaMergeStartResult);

/** Resolves a `needs-choice` outcome. Replacing is destructive on the destination (the server keeps a backup). */
export async function resolveAnimaSync(
  choice: { readonly kind: "replace" } | { readonly kind: "merge"; readonly projectId: ProjectId },
  request: Pick<AnimaSyncRequest, "toEnvironmentId">,
  bundle: AnimaBundle,
  ports: AnimaSyncPorts,
): Promise<AnimaSyncResolution> {
  if (choice.kind === "replace") {
    const result = await ports.importBundle(request.toEnvironmentId, { bundle, mode: "replace" });
    return { kind: "replaced", output: result.output };
  }
  const started = await ports.mergeStart(request.toEnvironmentId, {
    bundle,
    projectId: choice.projectId,
  });
  return { kind: "merging", ...started };
}
