import { expect, it } from "vite-plus/test";

import { findBotFile } from "./botShow.ts";

it("finds the file a bot names by id, by title, by file name, or by words of either", () => {
  const files = [
    { id: "f1", title: "Poster review notes", name: "review.html", createdAt: "2026-01-01" },
    { id: "f2", title: "Poster layout 1", name: "s1.jpg", createdAt: "2026-01-02" },
    { id: "f3", title: "Poster layout 2", name: null, createdAt: "2026-01-03" },
  ];
  const found = (wanted: string) => findBotFile(files, wanted)?.id ?? null;
  expect(found("f1")).toBe("f1");
  expect(found("  poster   REVIEW notes ")).toBe("f1");
  expect(found("s1.jpg")).toBe("f2");
  // Several fit: the newest is the one meant.
  expect(found("poster layout")).toBe("f3");
  expect(found("invoice")).toBeNull();
  expect(found(" ")).toBeNull();
});
