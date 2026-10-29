import type { AnimaDetail, AnimaSummary } from "@t3tools/contracts";

import { parseKin } from "./animaDashboard.logic";

export interface IdentityBlock {
  readonly kind: "paragraph" | "list";
  readonly lines: ReadonlyArray<string>;
}

export interface IdentitySection {
  readonly title: string;
  readonly blocks: ReadonlyArray<IdentityBlock>;
}

/** Hard-wrapped markdown paragraphs become single lines; `- ` runs become lists. */
function blocksOf(body: string): Array<IdentityBlock> {
  const blocks: Array<IdentityBlock> = [];
  for (const chunk of body.split(/\n\s*\n/)) {
    let current: { kind: IdentityBlock["kind"]; lines: Array<string> } | null = null;
    for (const raw of chunk.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const bullet = /^[-*] /.test(line);
      if (bullet) {
        if (current?.kind !== "list") blocks.push((current = { kind: "list", lines: [] }));
        current.lines.push(line.slice(2));
      } else if (current?.kind === "list" && /^\s/.test(raw)) {
        current.lines[current.lines.length - 1] += ` ${line}`;
      } else if (current?.kind === "paragraph") {
        current.lines[0] += ` ${line}`;
      } else {
        blocks.push((current = { kind: "paragraph", lines: [line] }));
      }
    }
  }
  return blocks;
}

/** Splits `identity.md` into its origin story (before the first `##`) and titled sections. */
export function parseIdentity(markdown: string): {
  readonly origin: ReadonlyArray<IdentityBlock>;
  readonly sections: ReadonlyArray<IdentitySection>;
} {
  const parts = markdown.split(/^##\s+(.+)$/m);
  const head = (parts[0] ?? "").replace(/^#\s+.*$/m, "");
  const sections: Array<IdentitySection> = [];
  for (let index = 1; index < parts.length; index += 2) {
    const blocks = blocksOf(parts[index + 1] ?? "");
    if (blocks.length > 0) sections.push({ title: parts[index]!.trim(), blocks });
  }
  return { origin: blocksOf(head), sections };
}

export type BondKind = "lead" | "crew" | "parent" | "child" | "kin" | "neighbour";

export interface Bond {
  readonly name: string;
  readonly kind: BondKind;
  readonly label: string;
  /** 0..1, drives line weight. */
  readonly weight: number;
  readonly anima: AnimaSummary | null;
}

const BOND_ORDER: ReadonlyArray<BondKind> = ["lead", "parent", "crew", "child", "kin", "neighbour"];
const MAX_NEIGHBOURS = 6;

/** Everyone this anima is tied to, closest ties first; each name appears once. */
export function animaBonds(
  detail: Pick<AnimaDetail, "summary" | "team" | "lead" | "header">,
  animas: ReadonlyArray<AnimaSummary>,
): Array<Bond> {
  const { summary } = detail;
  const byName = new Map(animas.map((anima) => [anima.name, anima]));
  const found = new Map<string, Bond>();
  const add = (name: string, kind: BondKind, label: string, weight: number) => {
    if (name === summary.name) return;
    const existing = found.get(name);
    if (existing && BOND_ORDER.indexOf(existing.kind) <= BOND_ORDER.indexOf(kind)) return;
    found.set(name, { name, kind, label, weight, anima: byName.get(name) ?? null });
  };
  if (detail.lead) add(detail.lead, "lead", "leads its crew", 1);
  const parent = animas.find((anima) => anima.id === summary.parent);
  if (parent) add(parent.name, "parent", "parent", 0.9);
  for (const member of detail.team) add(member, "crew", "crew", 0.8);
  for (const anima of animas) {
    if (anima.parent !== null && anima.parent === summary.id)
      add(anima.name, "child", "child", 0.7);
  }
  const kin = parseKin(detail.header.find((entry) => entry.key === "kin")?.value ?? "");
  for (const entry of kin) {
    add(
      entry.name,
      "kin",
      entry.label,
      entry.strength === null ? 0.4 : Math.min(1, entry.strength / 6),
    );
  }
  if (summary.homeProject) {
    animas
      .filter((anima) => anima.homeProject === summary.homeProject)
      .toSorted((a, b) => (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? ""))
      .slice(0, MAX_NEIGHBOURS)
      .forEach((anima) => add(anima.name, "neighbour", `also in ${summary.homeProject}`, 0.3));
  }
  return [...found.values()].toSorted(
    (a, b) => BOND_ORDER.indexOf(a.kind) - BOND_ORDER.indexOf(b.kind) || b.weight - a.weight,
  );
}

/** Places bonds on two rings around the centre: close ties inside, kin and neighbours outside. */
export function bondLayout(
  bonds: ReadonlyArray<Bond>,
): Array<{ bond: Bond; x: number; y: number }> {
  const inner = bonds.filter((bond) => bond.kind !== "kin" && bond.kind !== "neighbour");
  const outer = bonds.filter((bond) => bond.kind === "kin" || bond.kind === "neighbour");
  const ring = (list: ReadonlyArray<Bond>, rx: number, ry: number, offset: number) =>
    list.map((bond, index) => {
      const angle = offset + (index / list.length) * Math.PI * 2;
      return { bond, x: 50 + Math.cos(angle) * rx, y: 50 + Math.sin(angle) * ry };
    });
  const innerOnly = outer.length === 0;
  return [
    ...ring(inner, innerOnly ? 36 : 22, innerOnly ? 36 : 26, -Math.PI / 2),
    ...ring(outer, inner.length === 0 ? 36 : 42, inner.length === 0 ? 36 : 40, -Math.PI / 2 + 0.4),
  ];
}

/** Pseudo-random but stable positions for the hero's starfield of past breath colours. */
export function starfield(count: number): Array<{ x: number; y: number; r: number }> {
  return Array.from({ length: count }, (_, index) => {
    const a = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
    const b = Math.sin(index * 39.3468 + 11.135) * 24634.6345;
    const c = Math.sin(index * 73.156 + 52.235) * 12345.6789;
    return {
      x: (a - Math.floor(a)) * 100,
      y: (b - Math.floor(b)) * 100,
      r: 1 + (c - Math.floor(c)) * 2.5,
    };
  });
}
