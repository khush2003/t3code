import { EnvironmentId, ProjectId } from "@t3tools/contracts";

export interface AtlasSearch {
  readonly environmentId?: EnvironmentId;
  readonly projectId?: ProjectId;
  readonly initiativeId?: string;
  /** The task whose detail sheet is open, so it survives reloads and back navigation. */
  readonly taskId?: string;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export function validateAtlasSearch(raw: Record<string, unknown>): AtlasSearch {
  return {
    ...(nonEmpty(raw.environmentId)
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(nonEmpty(raw.projectId) ? { projectId: ProjectId.make(raw.projectId) } : {}),
    ...(nonEmpty(raw.initiativeId) ? { initiativeId: raw.initiativeId } : {}),
    ...(nonEmpty(raw.initiativeId) && nonEmpty(raw.taskId) ? { taskId: raw.taskId } : {}),
  };
}
