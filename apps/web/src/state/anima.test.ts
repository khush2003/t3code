import { describe, expect, it } from "vite-plus/test";

import { describeAnimaError } from "./anima";

describe("describeAnimaError", () => {
  it("explains requests an older server does not know, including string defects", () => {
    expect(describeAnimaError("Unknown request tag: anima.export")).toMatch(/older T3 server/);
    expect(describeAnimaError(new Error("no such anima"))).toBe("no such anima");
    expect(describeAnimaError(undefined)).toBe("The anima request failed.");
  });
});
