import type { AnimaSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  animaBonds,
  bondLayout,
  graphNodes,
  groupByDay,
  parseIdentity,
} from "./animaPortrait.logic";

describe("parseIdentity", () => {
  it("separates the origin story from titled sections and unwraps lines", () => {
    const parsed = parseIdentity(
      "# ink\n\nI was born\ninside a repo.\n\n## voice\n\nDirect and\nshort.\n\n## likes\nThings I like:\n- dark rooms\n- one warm\n  light\n\n## empty\n",
    );
    expect(parsed.origin).toEqual([{ kind: "paragraph", lines: ["I was born inside a repo."] }]);
    expect(parsed.sections).toEqual([
      { title: "voice", blocks: [{ kind: "paragraph", lines: ["Direct and short."] }] },
      {
        title: "likes",
        blocks: [
          { kind: "paragraph", lines: ["Things I like:"] },
          { kind: "list", lines: ["dark rooms", "one warm light"] },
        ],
      },
    ]);
  });
});

function anima(name: string, extra: Partial<AnimaSummary> = {}): AnimaSummary {
  return {
    name,
    id: `id-${name}`,
    parent: null,
    homeProject: null,
    lastActiveAt: null,
    ...extra,
  } as AnimaSummary;
}

describe("animaBonds", () => {
  it("collects each tie once, keeping the closest relation", () => {
    const self = anima("ink", { homeProject: "web" });
    const animas = [
      self,
      anima("atlas"),
      anima("cobalt"),
      anima("kid", { parent: "id-ink" }),
      anima("web-peer", { homeProject: "web" }),
    ];
    const bonds = animaBonds(
      {
        summary: self,
        lead: "atlas",
        team: ["cobalt"],
        header: [{ key: "kin", value: "cobalt=quiet-builder.3,ghost=sibling:?" }],
      },
      animas,
    );
    expect(bonds.map((bond) => [bond.name, bond.kind])).toEqual([
      ["atlas", "lead"],
      ["cobalt", "crew"],
      ["kid", "child"],
      ["ghost", "kin"],
      ["web-peer", "neighbour"],
    ]);
    expect(bonds.find((bond) => bond.name === "ghost")?.anima).toBeNull();
  });

  it("puts close ties on the inner ring", () => {
    const layout = bondLayout(
      animaBonds(
        {
          summary: anima("ink"),
          lead: "atlas",
          team: [],
          header: [{ key: "kin", value: "b=x.2" }],
        },
        [anima("atlas"), anima("b")],
      ),
    );
    const distance = (name: string) => {
      const point = layout.find((entry) => entry.bond.name === name)!;
      return Math.hypot(point.x - 50, point.y - 50);
    };
    expect(distance("atlas")).toBeLessThan(distance("b"));
  });
});

describe("groupByDay", () => {
  it("labels today and yesterday and keeps undated items apart", () => {
    const now = new Date(2026, 9, 29, 12).getTime();
    const items = [
      { id: "a", at: new Date(2026, 9, 29, 9).toISOString() },
      { id: "b", at: new Date(2026, 9, 29, 1).toISOString() },
      { id: "c", at: new Date(2026, 9, 28, 20).toISOString() },
      { id: "d", at: new Date(2026, 8, 1, 10).toISOString() },
      { id: "e", at: null },
    ];
    const groups = groupByDay(items, (item) => item.at, now);
    expect(
      groups.map((group) => [
        group.label === "Today" || group.label === "Yesterday" || group.label === "Undated"
          ? group.label
          : "date",
        group.items.map((item) => item.id),
      ]),
    ).toEqual([
      ["Today", ["a", "b"]],
      ["Yesterday", ["c"]],
      ["date", ["d"]],
      ["Undated", ["e"]],
    ]);
  });
});

describe("graphNodes", () => {
  it("reads named legacy nodes and counted modern graphs", () => {
    expect(graphNodes("ship-api:D,write-docs:?,bad")).toEqual([
      { name: "ship api", status: "done", count: 1 },
      { name: "write docs", status: "open", count: 1 },
    ]);
    expect(graphNodes("6D")).toEqual([{ name: null, status: "done", count: 6 }]);
    expect(graphNodes(null)).toEqual([]);
  });
});
