import * as THREE from "three";

import { ball, box, rod, shape } from "./clay";

// Locale plans, landscape and campus layout ported from Atlas's Lantern Yard
// (activity-locale-layout.ts, activity-landscape.ts, activity-landmarks.ts, activity-campus.ts).
// GLB landmarks are dropped: every building here is procedural.

export type Point = [number, number];
type Vec3 = [number, number, number];

export interface LocalePlan {
  readonly kind: string;
  readonly outline: Array<Point>;
  readonly paths: Array<Array<Point>>;
  readonly plazas: Array<[number, number, number]>;
  readonly building: [number, number, number];
  readonly secondary: [number, number, number];
  readonly stations: Array<Point>;
  readonly water?: Array<Point>;
  readonly terraces: Array<[number, number, number, number, number]>;
}

export interface CampusSection {
  readonly id: string;
  readonly districtId: string;
  readonly name: string;
  readonly number: number;
  center: Vec3;
  readonly entryIds: Array<string>;
}

export interface Yard {
  readonly root: THREE.Group;
  readonly flames: Array<THREE.Mesh>;
  readonly motes: THREE.Points;
}

const SECTION_SIZE = 12;
export const DISTRICT_COLORS = ["#c29260", "#67b4b3", "#97b47d", "#b0a0d0"];

function hashOf(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

const CENTER: Point = [0, 1];
const GATE_WEST: Point = [-21, 1];
const GATE_EAST: Point = [21, 1];
const GATE_NORTH: Point = [0, -15];
const GATE_SOUTH: Point = [0, 15];
const ring = (points: Array<Point>): Array<Point> => [...points, points[0]!];

function baseLocalePlan(name: string, id: string): LocalePlan {
  const kinds = ["garden", "harbor", "festival", "campus", "cinema"];
  const kind = /film|cinema/i.test(name)
    ? "cinema"
    : /space|town|campus/i.test(name)
      ? "campus"
      : /art|garden|soul/i.test(name)
        ? "garden"
        : /gateway|anima$|harbor|port/i.test(name)
          ? "harbor"
          : /arcade|game|nocturne/i.test(name)
            ? "festival"
            : kinds[hashOf(id) % 5]!;
  if (kind === "cinema")
    return {
      kind,
      outline: [
        [-22, -12],
        [-17, -16],
        [13, -16],
        [22, -10],
        [23, 9],
        [17, 16],
        [-15, 16],
        [-23, 10],
      ],
      paths: [
        [GATE_WEST, [-14, 1], CENTER, [14, 1], GATE_EAST],
        [GATE_NORTH, [-4, -12], [-14, -10], [-14, 1]],
        [GATE_SOUTH, [0, 9], CENTER],
        [
          [-14, 1],
          [-14, 10],
          [0, 9],
          [14, 10],
          [14, 1],
        ],
      ],
      plazas: [
        [0, 3, 5.8],
        [14, 1, 2.8],
      ],
      building: [0, -9, 0],
      secondary: [-15, -9, 0.2],
      stations: [
        [-15, 3],
        [-12, 3],
        [-8, 3],
        [-5, 3],
        [5, 3],
        [8, 3],
        [12, 3],
        [15, 3],
        [-12, 10],
        [-6, 10],
        [6, 10],
        [12, 10],
      ],
      terraces: [[-15, -10, 6, 5, 0.4]],
    };
  if (kind === "campus")
    return {
      kind,
      outline: [
        [-22, -4],
        [-20, -11],
        [-12, -12],
        [-8, -17],
        [5, -17],
        [11, -12],
        [20, -13],
        [23, -6],
        [19, 0],
        [23, 8],
        [17, 15],
        [7, 13],
        [0, 17],
        [-8, 14],
        [-18, 15],
        [-23, 7],
      ],
      paths: [
        ring([
          [-13, -5],
          [0, -5],
          [13, -5],
          [15, 6],
          [0, 10],
          [-14, 7],
        ]),
        [GATE_WEST, [-14, 7]],
        [GATE_EAST, [15, 6]],
        [GATE_NORTH, [0, -5], CENTER, [0, 10], GATE_SOUTH],
        [[-13, -5], CENTER, [13, -5]],
      ],
      plazas: [
        [0, 1, 4.8],
        [-14, 7, 2.6],
      ],
      building: [1, -11, 0],
      secondary: [15, -10, -0.3],
      stations: [
        [-13, -4],
        [-8, -4],
        [7, -4],
        [12, -4],
        [15, 1],
        [14, 6],
        [9, 8],
        [4, 10],
        [-3, 10],
        [-8, 8],
        [-13, 6],
        [-14, 1],
      ],
      terraces: [[15, -10, 7, 6, 0.3]],
    };
  if (kind === "garden")
    return {
      kind,
      outline: [
        [-23, -11],
        [-14, -15],
        [-8, -13],
        [3, -16],
        [16, -14],
        [22, -8],
        [19, -1],
        [23, 6],
        [16, 14],
        [3, 16],
        [-5, 13],
        [-17, 15],
        [-22, 8],
        [-19, 0],
      ],
      paths: [
        [GATE_WEST, [-15, 1], CENTER, [15, 1], GATE_EAST],
        [GATE_NORTH, [12, -11], [15, -7], [0, -6], [-15, -7], [-15, 1]],
        [GATE_SOUTH, [-12, 11], [-15, 7], [0, 8], [15, 7], [15, 1]],
        [CENTER, [0, -6]],
        [CENTER, [0, 8]],
      ],
      plazas: [
        [-14, -7, 3],
        [14, 7, 3],
        [0, 1, 2.5],
      ],
      building: [-13, -11, 0.2],
      secondary: [12, 11, Math.PI],
      stations: [
        [-14, -6],
        [-8, -6],
        [-2, -6],
        [4, -6],
        [10, -6],
        [15, -3],
        [15, 4],
        [10, 8],
        [4, 8],
        [-2, 8],
        [-8, 8],
        [-14, 5],
      ],
      terraces: [
        [-12, -10, 13, 6, 0.3],
        [9, -10, 10, 5, 0.65],
        [11, 10, 12, 6, 0.5],
        [-9, 10, 11, 5, 0.25],
      ],
    };
  if (kind === "harbor")
    return {
      kind,
      outline: [
        [-23, -12],
        [-13, -16],
        [4, -15],
        [11, -11],
        [9, -3],
        [22, -3],
        [23, 1],
        [12, 3],
        [10, 10],
        [3, 15],
        [-13, 16],
        [-23, 10],
      ],
      paths: [
        [GATE_WEST, [-15, 1], CENTER, [10, 1], GATE_EAST],
        [GATE_NORTH, [0, -8], [-12, -8], [-15, 1]],
        [GATE_SOUTH, [-3, 10], CENTER],
        [
          [-15, 1],
          [-14, 9],
          [-3, 10],
          [7, 8],
          [10, 1],
        ],
        [CENTER, [0, -8]],
      ],
      plazas: [
        [-5, 2, 4],
        [5, 9, 2.5],
      ],
      building: [-11, -11, 0],
      secondary: [-17, 10, Math.PI],
      stations: [
        [-15, -2],
        [-13, -6],
        [-8, -7],
        [-3, -7],
        [1, -5],
        [1, -1],
        [1, 3],
        [1, 7],
        [-2, 10],
        [-5, 10],
        [-11, 9],
        [-15, 5],
      ],
      water: [
        [3, -11],
        [8, -10],
        [7, -3],
        [10, 2],
        [8, 9],
        [5, 12],
        [3, 10],
        [5, 6],
        [5, 1],
        [3, -3],
      ],
      terraces: [[-12, -10, 13, 6, 0.2]],
    };
  return {
    kind,
    outline: [
      [-20, -14],
      [-8, -16],
      [0, -14],
      [10, -16],
      [21, -11],
      [23, 0],
      [20, 12],
      [9, 15],
      [0, 13],
      [-10, 16],
      [-22, 10],
      [-23, -1],
    ],
    paths: [
      ring([
        [-13, -7],
        [0, -9],
        [13, -7],
        [16, 2],
        [11, 10],
        [-10, 11],
        [-16, 3],
      ]),
      [GATE_WEST, [-16, 3], CENTER, [16, 2], GATE_EAST],
      [GATE_NORTH, [0, -9], CENTER, [0, 10], GATE_SOUTH],
    ],
    plazas: [
      [0, 1, 6.8],
      [-13, -7, 2.5],
      [13, -7, 2.5],
    ],
    building: [-13, -11, 0.2],
    secondary: [13, -10, -0.2],
    stations: [
      [-12, -6],
      [-6, -8],
      [5, -8],
      [11, -6],
      [15, -1],
      [15, 4],
      [11, 9],
      [5, 10],
      [-3, 10],
      [-10, 10],
      [-15, 6],
      [-15, 1],
    ],
    terraces: [[0, 1, 7, 5, 0.12]],
  };
}

const planCache = new Map<string, LocalePlan>();

/** Seeded proportions and mirroring keep neighbouring locales distinct while gates stay shared. */
export function localePlan(name: string, id: string): LocalePlan {
  const key = `${name}\u0000${id}`;
  const cached = planCache.get(key);
  if (cached) return cached;
  const plan = baseLocalePlan(name, id);
  const seed = hashOf(id);
  const mirror = seed % 2 ? -1 : 1;
  const sx = 0.9 + (seed % 7) * 0.035;
  const sz = 0.88 + ((seed >>> 4) % 7) * 0.035;
  const transform = ([x, z]: Point): Point => {
    if ((Math.abs(x) === 21 && z === 1) || (x === 0 && Math.abs(z) === 15)) return [x * mirror, z];
    return [x * mirror * sx, (z - 1) * sz + 1];
  };
  const anchor = ([x, z, rotation]: [number, number, number]): [number, number, number] => [
    ...transform([x, z]),
    rotation * mirror + ((seed % 3) - 1) * 0.12,
  ];
  const result: LocalePlan = {
    ...plan,
    outline: plan.outline.map(transform),
    paths: plan.paths.map((path) => path.map(transform)),
    plazas: plan.plazas.map(([x, z, r]) => [...transform([x, z]), r * (0.93 + (seed % 4) * 0.04)]),
    building: anchor(plan.building),
    secondary: anchor(plan.secondary),
    stations: plan.stations.map(transform),
    ...(plan.water ? { water: plan.water.map(transform) } : {}),
    terraces: plan.terraces.map(([x, z, w, d, h]) => [...transform([x, z]), w * sx, d * sz, h]),
  };
  planCache.set(key, result);
  return result;
}

/** Breadth-first walk over the locale's path graph, so strolls follow the roads. */
export function localeRoute(plan: LocalePlan, from: Point, to: Point): Array<Point> {
  const points = new Map<string, Point>();
  const adjacent = new Map<string, Set<string>>();
  const key = (point: Point) => point.join(",");
  for (const path of plan.paths) {
    for (let index = 0; index < path.length; index++) {
      const id = key(path[index]!);
      points.set(id, path[index]!);
      if (!adjacent.has(id)) adjacent.set(id, new Set());
      if (index) {
        const before = key(path[index - 1]!);
        adjacent.get(id)!.add(before);
        adjacent.get(before)!.add(id);
      }
    }
  }
  const closest = (point: Point) =>
    [...points].toSorted(
      ([, a], [, b]) =>
        Math.hypot(a[0] - point[0], a[1] - point[1]) - Math.hypot(b[0] - point[0], b[1] - point[1]),
    )[0]![0];
  const start = closest(from);
  const end = closest(to);
  const queue = [start];
  const previous = new Map<string, string | undefined>([[start, undefined]]);
  for (let index = 0; index < queue.length && !previous.has(end); index++) {
    for (const next of adjacent.get(queue[index]!) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, queue[index]);
      queue.push(next);
    }
  }
  const route: Array<Point> = [];
  let cursor: string | undefined = end;
  while (cursor) {
    route.unshift(points.get(cursor)!);
    cursor = previous.get(cursor);
  }
  return [...route, to];
}

function insideLocale([x, z]: Point, plan: LocalePlan) {
  let inside = false;
  for (let i = 0, j = plan.outline.length - 1; i < plan.outline.length; j = i++) {
    const [ax, az] = plan.outline[i]!;
    const [bx, bz] = plan.outline[j]!;
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

function groundedPoint(plan: LocalePlan, requested: Point, radius: number): Point | undefined {
  let point: Point = [...requested];
  for (let attempt = 0; attempt < 28; attempt++) {
    const fits = Array.from({ length: 12 }, (_, n) => (n * Math.PI) / 6).every((angle) =>
      insideLocale(
        [point[0] + Math.cos(angle) * radius, point[1] + Math.sin(angle) * radius],
        plan,
      ),
    );
    if (fits) return point;
    point = [point[0] * 0.93, 1 + (point[1] - 1) * 0.93];
  }
  return undefined;
}

export function districtTheme(id: string, name: string): number {
  if (/film|cinema|studio|workshop|forge/i.test(name)) return 0;
  if (/arcade|game|radio|signal|beacon/i.test(name)) return 1;
  if (/art|library|archive|book|docs/i.test(name)) return 2;
  if (/orbit|space|observatory|research/i.test(name)) return 3;
  return hashOf(id) % 4;
}

/** Desks for running animas sit on the station; others stand a step aside. */
export function localeStations(section: CampusSection, running: boolean): Array<Vec3> {
  return localePlan(section.name, section.districtId).stations.map(([x, z], index) => [
    x,
    0,
    z + (running ? 0 : index % 2 ? 0.4 : -0.4),
  ]);
}

function createLandmark(theme: number): THREE.Group {
  const root = new THREE.Group();
  const accent = DISTRICT_COLORS[theme]!;
  if (theme === 0) {
    box(root, "#dbc399", [0, 1.25, 0], [4.6, 2.5, 2.8]);
    const roof = shape(
      root,
      new THREE.ConeGeometry(3.25, 1.3, 4),
      "#bd784f",
      [0, 3.05, 0],
      [1, 1, 0.75],
    );
    roof.rotation.y = Math.PI / 4;
    box(root, "#698678", [0, 0.96, 1.43], [0.9, 1.9, 0.08]);
    for (const x of [-1.4, 1.4]) box(root, "#ecca7e", [x, 1.6, 1.43], [0.7, 0.8, 0.07]);
    shape(root, new THREE.CylinderGeometry(0.27, 0.36, 1.7, 10), "#a8855f", [1.3, 3.1, -0.4]);
  } else if (theme === 1) {
    shape(root, new THREE.CylinderGeometry(2.1, 2.3, 0.4, 8), "#4d7779", [0, 0.2, 0]);
    shape(root, new THREE.CylinderGeometry(0.65, 1, 2.3, 8), "#7b9d99", [0, 1.5, 0]);
    shape(root, new THREE.OctahedronGeometry(0.95), accent, [0, 3.35, 0], [1, 1.5, 1], 0.4);
    for (const y of [2.6, 4]) {
      const band = shape(root, new THREE.TorusGeometry(1.25, 0.09, 6, 24), "#c8ab6f", [0, y, 0]);
      band.rotation.x = Math.PI / 2;
    }
    for (const x of [-2.2, 2.2]) {
      rod(root, "#bba371", [x, 0, 0], [x, 3.1, 0], 0.09);
      rod(root, "#bba371", [x - 0.65, 2.65, 0], [x + 0.65, 2.65, 0], 0.055);
    }
  } else if (theme === 2) {
    box(root, "#9caa85", [0, 0.15, 0], [5, 0.3, 3]);
    for (const x of [-2, -0.7, 0.7, 2])
      shape(root, new THREE.CylinderGeometry(0.22, 0.27, 2.6, 8), "#d5d6b6", [x, 1.5, -0.8]);
    box(root, "#728966", [0, 2.9, -0.6], [5.2, 0.32, 2.9]);
    for (const x of [-1.6, -0.55, 0.55, 1.6]) {
      box(root, "#8c7856", [x, 1.2, -0.65], [0.8, 1.9, 0.7]);
      for (let n = 0; n < 4; n++) {
        box(
          root,
          ["#b79368", "#6e9789", "#b9897a"][n % 3]!,
          [x - 0.26 + n * 0.17, 1.7, -0.2],
          [0.12, 0.65, 0.3],
        );
      }
    }
    ball(root, "#78996c", [2.3, 2.9, -1], [0.9, 0.7, 0.9]);
  } else {
    shape(root, new THREE.CylinderGeometry(2.2, 2.5, 0.35, 12), "#827893", [0, 0.18, 0]);
    shape(
      root,
      new THREE.SphereGeometry(1.65, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      "#9692b4",
      [0, 0.35, 0],
    );
    for (const angle of [-0.6, 0.6]) {
      const band = shape(root, new THREE.TorusGeometry(2.15, 0.085, 6, 32), "#cdb879", [0, 2, 0]);
      band.rotation.set(angle, 0, angle);
    }
    ball(root, "#e1ca8e", [0, 2.2, 0], [0.55, 0.55, 0.55]);
    rod(root, "#bbaa74", [1.5, 0, 1], [1.5, 2.4, 1], 0.075);
    const telescope = shape(
      root,
      new THREE.CylinderGeometry(0.3, 0.42, 1.4, 10),
      accent,
      [1.5, 2.7, 1],
    );
    telescope.rotation.z = -0.65;
  }
  return root;
}

export function createBridge(points: ReadonlyArray<Vec3>): THREE.Group {
  const root = new THREE.Group();
  for (let index = 1; index < points.length; index++) {
    const [ax, , az] = points[index - 1]!;
    const [bx, , bz] = points[index]!;
    const length = Math.hypot(bx - ax, bz - az);
    const segment = new THREE.Group();
    segment.position.set((ax + bx) / 2, 0, (az + bz) / 2);
    segment.rotation.y = -Math.atan2(bz - az, bx - ax);
    root.add(segment);
    box(segment, "#907759", [0, -0.12, 0], [length + 0.12, 0.24, 1.75]);
    for (let x = -length / 2; x < length / 2; x += 0.65)
      box(segment, "#bda37b", [x, 0.045, 0], [0.59, 0.065, 1.7]);
    for (const z of [-0.86, 0.86]) {
      rod(segment, "#a99165", [-length / 2, 0.65, z], [length / 2, 0.65, z], 0.035);
      if (index % 2 === 0) rod(segment, "#967e5a", [0, -0.3, z], [0, 0.85, z], 0.06);
    }
  }
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = false;
  });
  return root;
}

const PALETTES = [
  ["#7c9475", "#475f54", "#b9ad85"],
  ["#769997", "#3c666a", "#c0b58f"],
  ["#94a17e", "#5d725c", "#c5b595"],
  ["#8a91a5", "#565f79", "#b8b2a3"],
] as const;

/** One locale: landform, roads, plazas, a landmark, desks, groves, lamps and drifting motes. */
export function createLandscape(section: CampusSection, detailed: boolean): Yard {
  const plan = localePlan(section.name, section.districtId);
  const root = new THREE.Group();
  const seed = hashOf(section.districtId);
  const theme = districtTheme(section.districtId, section.name);
  const [ground, cliff, road] = PALETTES[theme]!;
  const outline = new THREE.Shape();
  plan.outline.forEach(([x, z], index) => (index ? outline.lineTo(x, -z) : outline.moveTo(x, -z)));
  outline.closePath();
  const terrain = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outline, {
      depth: 1.3,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 0.32,
      bevelThickness: 0.22,
    }),
    new THREE.MeshStandardMaterial({ color: cliff, roughness: 1 }),
  );
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.y = -1.65;
  terrain.receiveShadow = true;
  root.add(terrain);
  const groundColor = new THREE.Color(ground);
  groundColor.offsetHSL(((seed % 11) - 5) * 0.008, 0, ((seed % 7) - 3) * 0.012);
  const turf = new THREE.Mesh(
    new THREE.ShapeGeometry(outline),
    new THREE.MeshStandardMaterial({ color: groundColor, roughness: 1 }),
  );
  turf.rotation.x = -Math.PI / 2;
  turf.position.y = 0.04;
  turf.receiveShadow = true;
  root.add(turf);
  for (const path of plan.paths) {
    for (let index = 1; index < path.length; index++) {
      const [ax, az] = path[index - 1]!;
      const [bx, bz] = path[index]!;
      const length = Math.hypot(bx - ax, bz - az);
      const harbor = plan.kind === "harbor";
      const segment = box(
        root,
        road,
        [(ax + bx) / 2, harbor ? 0.24 : 0.085, (az + bz) / 2],
        [length + 0.6, harbor ? 0.16 : 0.035, 1.6],
      );
      segment.rotation.y = -Math.atan2(bz - az, bx - ax);
    }
  }
  for (const [x, z, radius] of plan.plazas) {
    shape(
      root,
      new THREE.CylinderGeometry(radius, radius, 0.09, plan.kind === "festival" ? 12 : 28),
      "#c6bc96",
      [x, 0.13, z],
    );
  }
  for (const [x, z, width, depth, height] of plan.terraces) {
    box(root, cliff, [x, height / 2, z], [width, height, depth]);
    box(root, ground, [x, height + 0.03, z], [width, 0.06, depth]);
  }
  const anchor = new THREE.Group();
  anchor.position.set(plan.building[0], 0, plan.building[1]);
  anchor.rotation.y = plan.building[2];
  const landmark = createLandmark(theme);
  landmark.scale.setScalar(1.6);
  anchor.add(landmark);
  root.add(anchor);
  const secondary = new THREE.Group();
  secondary.position.set(plan.secondary[0], 0, plan.secondary[1]);
  secondary.rotation.y = plan.secondary[2];
  root.add(secondary);
  if (theme === 1) {
    for (const x of [-2, 2]) {
      rod(secondary, "#bbab7c", [x, 0, 0], [x, 5, 0], 0.12);
      for (const y of [3, 4.2]) rod(secondary, "#bcad89", [x - 1, y, 0], [x + 1, y, 0], 0.06);
    }
    ball(secondary, "#83bfc3", [0, 1.6, 0], [1.5, 1.5, 1.5]);
  } else if (theme === 2) {
    for (let n = 0; n < 5; n++) {
      box(secondary, "#b9c19b", [-3 + n * 1.5, 1.6, 0], [0.3, 3.2, 0.4]);
      box(secondary, "#857653", [-3 + n * 1.5, 0.5, -0.6], [1.1, 1, 0.6]);
    }
    box(secondary, "#7b9476", [0, 3.3, 0], [7.4, 0.4, 2]);
  } else if (theme === 3) {
    for (const x of [-2, 2]) {
      shape(secondary, new THREE.CylinderGeometry(1.2, 1.6, 2, 8), "#8394aa", [x, 1, 0]);
      const dome = shape(
        secondary,
        new THREE.SphereGeometry(1.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        "#adc5c6",
        [x, 2, 0],
      );
      dome.scale.y = 0.8;
    }
  } else {
    for (const x of [-2, 2]) {
      box(secondary, "#d0bb8b", [x, 1.1, 0], [2.7, 2.2, 2.6]);
      const roof = shape(secondary, new THREE.ConeGeometry(2.15, 1.1, 4), "#a16e52", [x, 2.7, 0]);
      roof.rotation.y = Math.PI / 4;
    }
  }
  const deskColor = theme === 3 ? "#82949a" : "#a6895e";
  const stations = localeStations(section, true);
  section.entryIds.forEach((_, slot) => {
    const [x, , z] = stations[slot]!;
    box(root, deskColor, [x, 0.86, z + 0.8], [1.65, 0.14, 0.8]);
    if (!detailed) return;
    for (const dx of [-0.65, 0.65])
      box(root, "#786f55", [x + dx, 0.42, z + 0.8], [0.12, 0.84, 0.55]);
    box(root, "#e5d8b2", [x - 0.15, 0.95, z + 0.8], [0.56, 0.03, 0.39]);
  });
  if (plan.water) {
    const canal = new THREE.Shape();
    plan.water.forEach(([x, z], index) => (index ? canal.lineTo(x, -z) : canal.moveTo(x, -z)));
    canal.closePath();
    const water = new THREE.Mesh(
      new THREE.ShapeGeometry(canal),
      new THREE.MeshStandardMaterial({ color: "#52888e", roughness: 0.3, metalness: 0.2 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.15;
    root.add(water);
  } else if (plan.kind === "garden") {
    shape(
      root,
      new THREE.CylinderGeometry(1.4, 1.4, 0.07, 24),
      "#5d9397",
      [8, 0.75, -10],
      [1, 1, 0.7],
    );
  }
  const distanceToRoad = (x: number, z: number) =>
    Math.min(
      ...plan.paths.flatMap((path) =>
        path.slice(1).map((point, index) => {
          const [ax, az] = path[index]!;
          const [bx, bz] = point;
          const dx = bx - ax;
          const dz = bz - az;
          const t = Math.max(
            0,
            Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
          );
          return Math.hypot(x - ax - t * dx, z - az - t * dz);
        }),
      ),
    );
  let groves = 0;
  for (const candidate of [
    [-17, -10],
    [17, -9],
    [-8, -13],
    [8, -13],
    [-17, 8],
    [16, 9],
    [7, 12],
    [-8, 12],
  ] as Array<Point>) {
    const point = groundedPoint(plan, candidate, 3.5);
    if (!point) continue;
    const [x, z] = point;
    if (
      Math.hypot(x - plan.building[0], z - plan.building[1]) < 10 ||
      Math.hypot(x - plan.secondary[0], z - plan.secondary[1]) < 5 ||
      distanceToRoad(x, z) < 3.3 ||
      plan.stations.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 3.2)
    ) {
      continue;
    }
    ball(root, groves % 2 ? "#819674" : "#899d7c", [x, 0.16, z], [3.7, 0.42, 2.7]);
    ball(root, cliff, [x + 0.4, 0.4, z - 0.3], [2.1, 0.7, 1.7]);
    ball(root, ground, [x + 0.3, 0.68, z - 0.4], [2.3, 0.55, 1.8]);
    for (let n = 0; n < (detailed ? 6 : 4); n++) {
      const tx = x + Math.sin(n * 2.4 + seed) * 2;
      const tz = z + Math.cos(n * 2.4) * 1.4;
      const height = 1.7 + (n % 3) * 0.45;
      rod(root, "#75634b", [tx, 0.25, tz], [tx, height, tz], 0.12);
      ball(root, n % 2 ? "#66896c" : "#83a078", [tx, height + 0.2, tz], [1.1, 1.2, 1]);
      if (n % 2 === 0) ball(root, "#9ba78b", [tx + 0.65, 0.3, tz + 0.4], [0.65, 0.4, 0.48]);
    }
    if (++groves === 3) break;
  }
  const flames: Array<THREE.Mesh> = [];
  for (const [x, z] of [
    [-3, 3.4],
    [4, -2],
    [-15, -2],
    [15, 3],
  ] as Array<Point>) {
    rod(root, "#978059", [x, 0, z], [x, 2.6, z], 0.055);
    const flame = shape(
      root,
      new THREE.SphereGeometry(1, 16, 12),
      "#efc374",
      [x, 2.6, z],
      [0.16, 0.19, 0.16],
      0.9,
    );
    flames.push(flame);
  }
  for (let n = 0; n < 4; n++) {
    const x = -7 + n * 4.5;
    const z = 10.5 + (seed % 3) * 0.35;
    box(root, "#a99570", [x, 0.5, z], [2, 0.18, 0.6]);
    box(root, "#bbaa83", [x, 0.9, z + 0.25], [2, 0.7, 0.1]);
  }
  const points = new Float32Array(24 * 3);
  for (let n = 0; n < 24; n++) {
    points[n * 3] = Math.sin(n * 7.1 + seed) * 17;
    points[n * 3 + 1] = 0.5 + (n % 7) * 0.38;
    points[n * 3 + 2] = Math.cos(n * 4.7) * 12;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  const motes = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: "#ead49c",
      size: 0.055,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    }),
  );
  root.add(motes);
  root.userData.fitPoints = plan.outline.map(([x, z]) => [x, 0.1, z]);
  if (!detailed) {
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) node.castShadow = false;
    });
  }
  return { root, flames, motes };
}

/** Districts grow in twelve-desk sections packed on a golden-angle spiral. */
export function layoutCampus(
  entries: ReadonlyArray<{
    readonly id: string;
    readonly districtId: string;
    readonly districtName: string;
  }>,
): {
  sections: Array<CampusSection>;
  placements: Map<string, { sectionId: string; slot: number }>;
} {
  const groups = new Map<string, { name: string; ids: Array<string> }>();
  for (const entry of entries) {
    const group = groups.get(entry.districtId) ?? { name: entry.districtName, ids: [] };
    group.ids.push(entry.id);
    groups.set(entry.districtId, group);
  }
  const ordered = [...groups].toSorted(
    ([, a], [, b]) => b.ids.length - a.ids.length || a.name.localeCompare(b.name),
  );
  const sections: Array<CampusSection> = [];
  const placements = new Map<string, { sectionId: string; slot: number }>();
  for (const [districtId, group] of ordered) {
    const ids = group.ids.toSorted();
    for (let first = 0; first < ids.length; first += SECTION_SIZE) {
      const number = first / SECTION_SIZE + 1;
      const section: CampusSection = {
        id: `${districtId}/${number}`,
        districtId,
        name: group.name,
        number,
        center: [0, 0, 0],
        entryIds: ids.slice(first, first + SECTION_SIZE),
      };
      sections.push(section);
      section.entryIds.forEach((id, slot) => placements.set(id, { sectionId: section.id, slot }));
    }
  }
  const maxSections = Math.max(
    1,
    ...ordered.map(([, group]) => Math.ceil(group.ids.length / SECTION_SIZE)),
  );
  const columns = Math.ceil(Math.sqrt(maxSections));
  const rows = Math.ceil(maxSections / columns);
  const packed: Array<Point> = [];
  const positions = new Map<string, Point>();
  ordered.forEach(([districtId], index) => {
    let point: Point = [0, 0];
    if (index) {
      for (let sample = 1; sample < 20000; sample++) {
        const angle = sample * 2.399963229728653;
        const radius = 3.5 * Math.sqrt(sample) * Math.sqrt(maxSections);
        const candidate: Point = [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.84];
        const clear = packed.every(
          ([x, z]) =>
            Math.hypot((candidate[0] - x) / (columns * 47), (candidate[1] - z) / (rows * 36)) >=
            1.03,
        );
        if (clear) {
          point = candidate;
          break;
        }
      }
    }
    packed.push(point);
    positions.set(districtId, point);
  });
  for (const section of sections) {
    const [x, z] = positions.get(section.districtId)!;
    const index = section.number - 1;
    section.center = [
      x + ((index % columns) - (columns - 1) / 2) * 46,
      0,
      z + (Math.floor(index / columns) - (rows - 1) / 2) * 36,
    ];
  }
  return { sections, placements };
}

/** Nearest-neighbour spanning tree: an organic archipelago rather than a grid. */
export function campusConnections(sections: ReadonlyArray<CampusSection>): Array<[string, string]> {
  if (sections.length === 0) return [];
  const joined = new Set([sections[0]!.id]);
  const edges: Array<[string, string]> = [];
  while (joined.size < sections.length) {
    let best: [CampusSection, CampusSection] | undefined;
    let distance = Infinity;
    for (const a of sections) {
      if (!joined.has(a.id)) continue;
      for (const b of sections) {
        if (joined.has(b.id)) continue;
        const next = Math.hypot(a.center[0] - b.center[0], a.center[2] - b.center[2]);
        if (next < distance) {
          distance = next;
          best = [a, b];
        }
      }
    }
    if (!best) break;
    edges.push([best[0].id, best[1].id]);
    joined.add(best[1].id);
  }
  return edges;
}

export function bridgeRoute(a: CampusSection, b: CampusSection): Array<Vec3> {
  const dx = b.center[0] - a.center[0];
  const dz = b.center[2] - a.center[2];
  const horizontal = Math.abs(dx) > Math.abs(dz);
  const sign = Math.sign(horizontal ? dx : dz) || 1;
  const start: Vec3 = horizontal
    ? [a.center[0] + sign * 21, 0, a.center[2] + 1]
    : [a.center[0], 0, a.center[2] + sign * 15];
  const end: Vec3 = horizontal
    ? [b.center[0] - sign * 21, 0, b.center[2] + 1]
    : [b.center[0], 0, b.center[2] - sign * 15];
  const reach = Math.max(4, Math.hypot(end[0] - start[0], end[2] - start[2]) * 0.4);
  const c1 = [
    start[0] + (horizontal ? sign * reach : 0),
    start[2] + (horizontal ? 0 : sign * reach),
  ] as const;
  const c2 = [
    end[0] - (horizontal ? sign * reach : 0),
    end[2] - (horizontal ? 0 : sign * reach),
  ] as const;
  return Array.from({ length: 17 }, (_, index): Vec3 => {
    const t = index / 16;
    const u = 1 - t;
    return [
      u * u * u * start[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
      0,
      u * u * u * start[2] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[2],
    ];
  });
}
