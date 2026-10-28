import { describe, expect, it } from "@effect/vitest";
import type { OrchestrationV2DomainEvent } from "@t3tools/contracts";

import { animaToolObservation } from "./AnimaRuntimeReactor.ts";

const itemEvent = (payload: Record<string, unknown>) =>
  ({
    type: "turn-item.updated",
    threadId: "thread-1",
    payload: { id: "item-1", threadId: "thread-1", title: null, ...payload },
  }) as unknown as OrchestrationV2DomainEvent;

describe("animaToolObservation", () => {
  it.each([
    {
      label: "a running command as a started Bash call",
      payload: { type: "command_execution", status: "running", input: "bun test" },
      expected: {
        phase: "started",
        call: { toolName: "Bash", toolInput: { command: "bun test" } },
      },
    },
    {
      label: "a completed command with a non-zero exit as a failure",
      payload: {
        type: "command_execution",
        status: "completed",
        input: "bun test",
        exitCode: 1,
        output: "1 failed",
      },
      expected: { phase: "failed", error: "1 failed" },
    },
    {
      label: "a file change as an Edit with its path and bodies",
      payload: {
        type: "file_change",
        status: "completed",
        fileName: "src/a.ts",
        oldStr: "a",
        newStr: "b",
      },
      expected: {
        phase: "succeeded",
        call: {
          toolName: "Edit",
          toolInput: { file_path: "src/a.ts", old_string: "a", new_string: "b" },
        },
      },
    },
    {
      label: "an MCP tool by its own name and object input",
      payload: {
        type: "dynamic_tool",
        status: "failed",
        toolName: "mcp__t3__thread_read",
        input: { path: "x" },
        output: "denied",
      },
      expected: {
        phase: "failed",
        error: "denied",
        call: { toolName: "mcp__t3__thread_read", toolInput: { path: "x" } },
      },
    },
  ])("maps $label", ({ payload, expected }) => {
    expect(animaToolObservation(itemEvent(payload))).toMatchObject({
      threadId: "thread-1",
      itemId: "item-1",
      ...expected,
    });
  });

  it.each([
    { type: "command_execution", status: "cancelled", input: "sleep 100" },
    { type: "assistant_message", status: "completed", text: "hi" },
  ])("ignores $type that is $status", (payload) => {
    expect(animaToolObservation(itemEvent(payload))).toBeNull();
  });
});
