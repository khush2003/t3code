import { describe, expect, it } from "vite-plus/test";
import { atlasAgentPriority, describeAtlasAgentRuntime } from "./atlasControlLogic";
import { ProviderInstanceId, RuntimeRequestId } from "@t3tools/contracts";

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

describe("Atlas agent runtime labels", () => {
  const instanceId = ProviderInstanceId.make("codex");
  const providers = [
    {
      instanceId,
      models: [
        {
          slug: "gpt-test",
          name: "GPT Test",
          isCustom: false,
          capabilities: {
            optionDescriptors: [
              {
                id: "reasoningEffort",
                label: "Reasoning",
                type: "select" as const,
                options: [
                  { id: "medium", label: "Medium", isDefault: true },
                  { id: "high", label: "High" },
                ],
              },
              { id: "agent", label: "Agent", type: "select" as const, options: [] },
            ],
          },
        },
      ],
    },
  ];
  const usage = { usedTokens: 48_200, maxTokens: 200_000, updatedAt: "2026-01-01" };

  it("names the model, the chosen reasoning, and context usage", () => {
    expect(
      describeAtlasAgentRuntime(
        {
          modelSelection: {
            instanceId,
            model: "gpt-test",
            options: [
              { id: "reasoningEffort", value: "high" },
              { id: "agent", value: "build" },
            ],
          },
          tokenUsage: usage,
        },
        providers,
      ),
    ).toEqual({ model: "GPT Test", reasoning: "High", tokens: "48k / 200k tokens" });
  });

  it("reports the model's default reasoning when the run chose none", () => {
    expect(
      describeAtlasAgentRuntime(
        { modelSelection: { instanceId, model: "gpt-test" }, tokenUsage: null },
        providers,
      ),
    ).toEqual({ model: "GPT Test", reasoning: "Medium", tokens: null });
  });

  it("falls back to the raw selection for a model the catalog no longer lists", () => {
    expect(
      describeAtlasAgentRuntime(
        {
          modelSelection: {
            instanceId,
            model: "retired-model",
            options: [{ id: "variant", value: "max" }],
          },
          tokenUsage: { usedTokens: 900, updatedAt: "2026-01-01" },
        },
        providers,
      ),
    ).toEqual({ model: "retired-model", reasoning: "max", tokens: "900 tokens" });
  });
});
