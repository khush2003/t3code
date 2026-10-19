import { describe, expect, it } from "vite-plus/test";
import { atlasAgentPriority } from "./atlasControlLogic";
import { RuntimeRequestId } from "@t3tools/contracts";

describe("Atlas agent attention priority", () => {
  it("keeps a stopped provider's unresolved question ahead of running work", () => {
    const pending = {
      approvals: [],
      userInputs: [
        {
          requestId: RuntimeRequestId.make("question"),
          createdAt: "2026-01-01",
          questions: [],
          responseCapability: "message" as const,
          dismissible: true,
        },
      ],
    };
    expect(atlasAgentPriority({ running: false, failed: false }, pending)).toBeLessThan(
      atlasAgentPriority({ running: true, failed: false }, null),
    );
  });

  it("shows failed work ahead of settled history after requests are resolved", () => {
    const empty = { approvals: [], userInputs: [] };
    expect(atlasAgentPriority({ running: false, failed: true }, empty)).toBeLessThan(
      atlasAgentPriority({ running: false, failed: false }, empty),
    );
    expect(atlasAgentPriority({ running: true, failed: false }, empty)).toBeLessThan(
      atlasAgentPriority({ running: false, failed: true }, empty),
    );
  });
});
