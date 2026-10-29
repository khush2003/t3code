import * as THREE from "three";
import type { AnimaForm } from "@t3tools/contracts";

// Ported from Atlas's Lantern Yard (anima apps/atlas/src/lib/activity-creatures.ts) so the
// creatures look the same in both places. Faces point toward +Z.

type Vec3 = readonly [number, number, number];

const materials = new Map<string, THREE.MeshStandardMaterial>();

export function clay(color: string, glow = 0): THREE.MeshStandardMaterial {
  const key = `${color}:${glow}`;
  let material = materials.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.83,
      metalness: 0,
      ...(glow ? { emissive: color, emissiveIntensity: glow } : {}),
    });
    material.userData.shared = true;
    materials.set(key, material);
  }
  return material;
}

/** Shared clay materials outlive any one world; call when the last world unmounts. */
export function disposeClay() {
  for (const material of materials.values()) material.dispose();
  materials.clear();
}

export function shape(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  color: string,
  position: Vec3,
  scale: Vec3 = [1, 1, 1],
  glow = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, clay(color, glow));
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export const ball = (
  parent: THREE.Object3D,
  color: string,
  position: Vec3,
  scale: Vec3 = [1, 1, 1],
) => shape(parent, new THREE.SphereGeometry(1, 16, 12), color, position, scale);

export const box = (parent: THREE.Object3D, color: string, position: Vec3, scale: Vec3) =>
  shape(parent, new THREE.BoxGeometry(1, 1, 1), color, position, scale);

export function rod(parent: THREE.Object3D, color: string, from: Vec3, to: Vec3, radius = 0.04) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const direction = b.clone().sub(a);
  const middle = a.clone().add(b).multiplyScalar(0.5);
  const mesh = shape(
    parent,
    new THREE.CylinderGeometry(radius, radius, direction.length(), 8),
    color,
    [middle.x, middle.y, middle.z],
  );
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

export const FORM_ORDER: ReadonlyArray<AnimaForm> = [
  "fox",
  "owl",
  "axolotl",
  "frog",
  "moth",
  "raccoon",
];

export interface CreatureLook {
  readonly accent: string;
  readonly role: "architect" | "lead" | "agent";
  readonly stage: "new" | "settled" | "weathered" | "unknown";
}

export interface CreatureRig {
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  readonly head: THREE.Group;
  readonly arms: ReadonlyArray<THREE.Group>;
  readonly legs: ReadonlyArray<THREE.Group>;
  readonly eyes: ReadonlyArray<THREE.Mesh>;
  readonly wings: ReadonlyArray<THREE.Mesh>;
  readonly ring: THREE.Mesh;
  readonly badge: THREE.Mesh;
  readonly index: number;
}

const FUR = ["#d78138", "#ac8c67", "#b899d0", "#83a956", "#dba8b3", "#919294"];
const CLOTHES = ["#376c70", "#567059", "#515576", "#6f8254", "#829fad", "#747d81"];
const CREAM = "#f1dfb5";
const DARK = "#273b37";
const GOLD = "#c49a53";

/** Small clay rigs with separate limbs and a silhouette per form. */
export function createCreature(index: number, look: CreatureLook): CreatureRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const head = new THREE.Group();
  root.add(body);
  body.add(head);
  head.position.y = 1.62;
  const fur = FUR[index]!;
  const clothes = CLOTHES[index]!;
  ball(body, clothes, [0, 0.95, 0], [0.39, 0.52, 0.3]);
  ball(body, CREAM, [0, 1, 0.235], [0.24, 0.32, 0.105]);
  const belt = shape(
    body,
    new THREE.CylinderGeometry(0.405, 0.405, 0.085, 16),
    look.accent,
    [0, 0.76, 0],
    [1, 1, 0.78],
  );
  belt.rotation.z = -0.035;
  ball(head, fur, [0, 0, 0], [index === 2 ? 0.57 : 0.5, 0.47, 0.4]);
  const arms: Array<THREE.Group> = [];
  const legs: Array<THREE.Group> = [];
  const eyes: Array<THREE.Mesh> = [];
  const wings: Array<THREE.Mesh> = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.36, 1.22, 0.03);
    arm.rotation.z = -side * 0.13;
    shape(arm, new THREE.CapsuleGeometry(0.115, 0.29, 4, 8), clothes, [0, -0.18, 0]);
    ball(arm, fur, [0, -0.39, 0.01], [0.14, 0.15, 0.13]);
    body.add(arm);
    arms.push(arm);
    const leg = new THREE.Group();
    leg.position.set(side * 0.18, 0.56, 0);
    shape(
      leg,
      new THREE.CapsuleGeometry(0.13, 0.23, 4, 8),
      index === 3 ? fur : "#5d5b4b",
      [0, -0.16, 0],
    );
    ball(leg, index === 3 ? fur : "#786750", [0, -0.37, 0.09], [0.17, 0.13, 0.25]);
    root.add(leg);
    legs.push(leg);
  }
  const rightArm = arms[1]!;
  if (index === 0 || index === 5) {
    for (const side of [-1, 1]) {
      const ear = shape(head, new THREE.ConeGeometry(0.2, 0.49, 3), fur, [
        side * 0.33,
        0.46,
        -0.04,
      ]);
      ear.rotation.z = -side * 0.18;
      const inner = shape(
        head,
        new THREE.ConeGeometry(0.12, 0.29, 3),
        index === 0 ? "#e0b68b" : "#cbbdb0",
        [side * 0.33, 0.47, 0.055],
      );
      inner.rotation.z = -side * 0.18;
    }
    if (index === 0) {
      const tail = ball(body, fur, [-0.39, 0.66, -0.29], [0.3, 0.55, 0.3]);
      tail.rotation.z = 0.5;
      ball(body, CREAM, [-0.6, 1.04, -0.29], [0.2, 0.23, 0.22]);
    } else {
      for (let n = 0; n < 5; n++) {
        ball(
          body,
          n % 2 ? "#4e5555" : fur,
          [0.34 + n * 0.105, 0.57 + n * 0.06, -0.35 - n * 0.12],
          [0.2, 0.2, 0.23],
        );
      }
      for (const side of [-1, 1])
        ball(head, "#414b4e", [side * 0.19, 0.04, 0.333], [0.23, 0.18, 0.1]);
    }
    ball(head, CREAM, [0, -0.15, 0.34], [0.28, 0.2, 0.2]);
    ball(head, DARK, [0, -0.08, 0.51], [0.07, 0.06, 0.055]);
    if (index === 0) {
      for (const side of [-1, 1]) {
        const rim = shape(head, new THREE.TorusGeometry(0.17, 0.038, 8, 24), GOLD, [
          side * 0.21,
          0.29,
          0.32,
        ]);
        rim.rotation.x = -0.3;
        ball(head, "#467477", [side * 0.21, 0.29, 0.33], [0.125, 0.115, 0.06]);
      }
      rod(rightArm, "#795b38", [0, -0.3, 0], [0, -0.72, 0.07], 0.035);
      box(rightArm, "#ad9670", [0, -0.69, 0.06], [0.32, 0.17, 0.15]);
    }
  } else if (index === 1) {
    for (const side of [-1, 1]) {
      ball(head, CREAM, [side * 0.22, 0.02, 0.28], [0.26, 0.3, 0.15]);
      const ear = shape(head, new THREE.ConeGeometry(0.15, 0.26, 3), fur, [
        side * 0.37,
        0.39,
        -0.03,
      ]);
      ear.rotation.z = -side * 0.4;
      shape(head, new THREE.TorusGeometry(0.205, 0.025, 6, 24), GOLD, [side * 0.22, 0.04, 0.43]);
    }
    const beak = shape(head, new THREE.ConeGeometry(0.085, 0.18, 4), "#c2a062", [0, -0.12, 0.46]);
    beak.rotation.x = Math.PI / 2;
    const book = box(body, "#344e63", [0.03, 1, 0.37], [0.4, 0.43, 0.12]);
    book.rotation.z = -0.12;
    box(body, GOLD, [0.03, 1, 0.439], [0.32, 0.02, 0.015]);
  } else if (index === 2) {
    for (const side of [-1, 1]) {
      for (let n = 0; n < 3; n++) {
        const y = 0.28 - n * 0.2;
        const tip: Vec3 = [side * (0.66 + Math.sin(n) * 0.07), y + 0.17, 0.03];
        rod(head, "#a373ae", [side * 0.42, y, 0], tip, 0.048);
        ball(head, "#cf8bbf", tip, [0.06, 0.1, 0.055]);
      }
    }
    ball(body, fur, [-0.38, 0.63, -0.27], [0.43, 0.18, 0.3]);
    const plan = shape(
      rightArm,
      new THREE.CylinderGeometry(0.09, 0.09, 0.48, 12),
      CREAM,
      [0, -0.31, 0.14],
    );
    plan.rotation.z = -0.15;
  } else if (index === 3) {
    for (const side of [-1, 1]) ball(head, fur, [side * 0.3, 0.34, 0.05], [0.23, 0.24, 0.2]);
    ball(head, "#d7dda1", [0, -0.19, 0.22], [0.4, 0.18, 0.21]);
    const scarf = shape(body, new THREE.TorusGeometry(0.31, 0.08, 8, 20), "#dbac48", [0, 1.34, 0]);
    scarf.rotation.x = Math.PI / 2;
    box(body, "#dbac48", [0.18, 1.1, 0.32], [0.15, 0.42, 0.055]);
    const lantern = box(rightArm, "#ddad57", [0, -0.67, 0], [0.23, 0.31, 0.23]);
    lantern.material = clay("#ffc876", 0.6);
    rod(rightArm, GOLD, [0, -0.37, 0], [0, -0.51, 0], 0.025);
  } else {
    for (const side of [-1, 1]) {
      const wing = ball(body, "#c991a7", [side * 0.43, 1, -0.19], [0.44, 0.65, 0.09]);
      wing.rotation.z = -side * 0.31;
      wings.push(wing);
      ball(wing, "#e5c499", [0, -0.2, 0.7], [0.35, 0.2, 0.3]);
      rod(head, "#a97992", [side * 0.16, 0.34, 0], [side * 0.32, 0.77, 0.02], 0.025);
      ball(head, "#dcb5be", [side * 0.32, 0.78, 0.02], [0.095, 0.15, 0.06]);
    }
    shape(body, new THREE.CylinderGeometry(0.085, 0.085, 0.3, 10), GOLD, [0.1, 1, 0.37]);
  }
  for (const side of [-1, 1]) {
    const eyeY = index === 3 ? 0.38 : 0.04;
    const eyeX = index === 3 ? 0.3 : index === 1 ? 0.22 : 0.18;
    const eyeZ = index === 3 ? 0.205 : 0.382;
    const eye = ball(
      head,
      "#172c2a",
      [side * eyeX, eyeY, eyeZ],
      [index === 1 ? 0.095 : 0.075, 0.105, 0.055],
    );
    eyes.push(eye);
    ball(eye, "#fff3d9", [-0.22, 0.36, 0.86], [0.27, 0.23, 0.24]);
  }
  ball(body, look.accent, [0, 1.13, 0.326], [0.085, 0.085, 0.035]);
  if (look.role === "lead" || look.role === "architect") {
    const clasp = shape(
      body,
      new THREE.OctahedronGeometry(look.role === "architect" ? 0.12 : 0.09),
      look.accent,
      [0, 1.13, 0.365],
      [1, 1.2, 0.55],
      look.role === "architect" ? 0.15 : 0,
    );
    clasp.rotation.z = Math.PI / 4;
  }
  if (look.stage === "settled" || look.stage === "weathered") {
    ball(head, "#d8d0bf", [-0.27, 0.27, 0.3], [0.11, 0.055, 0.055]);
    if (look.stage === "weathered") ball(head, "#d8d0bf", [0.26, 0.25, 0.3], [0.13, 0.07, 0.055]);
  }
  if (index === 2 || index === 3 || index === 4) {
    const smile = shape(head, new THREE.TorusGeometry(0.115, 0.015, 6, 16, Math.PI), "#63505e", [
      0,
      index === 3 ? -0.1 : -0.13,
      0.408,
    ]);
    smile.rotation.z = Math.PI;
  }
  const ring = shape(
    root,
    new THREE.TorusGeometry(0.62, 0.035, 6, 40),
    "#e5c679",
    [0, 0.045, 0],
    [1, 1, 1],
    0.3,
  );
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  const badge = shape(
    root,
    new THREE.OctahedronGeometry(0.11),
    "#f5cd7d",
    [0, 2.62, 0],
    [1, 1.6, 1],
    0.3,
  );
  badge.visible = false;
  return { root, body, head, arms, legs, eyes, wings, ring, badge, index };
}

export type CreatureMode = "running" | "recent" | "idle" | "asleep";

export function animateCreature(
  rig: CreatureRig,
  time: number,
  mode: CreatureMode,
  walking: boolean,
  selected: boolean,
) {
  const phase = time + rig.index * 0.73;
  const rest = mode === "asleep" || mode === "idle";
  rig.body.position.y = walking
    ? Math.abs(Math.sin(phase * 8)) * 0.055
    : Math.sin(phase * (rest ? 1.2 : 2)) * (rest ? 0.008 : 0.02);
  rig.body.rotation.z = mode === "running" && !walking ? Math.sin(phase * 3) * 0.025 : 0;
  rig.head.rotation.z = Math.sin(phase * 0.8) * 0.025;
  rig.head.rotation.x = mode === "asleep" ? 0.35 : 0;
  rig.arms.forEach((arm, index) => {
    arm.rotation.x = walking
      ? Math.sin(phase * 8 + index * Math.PI) * 0.45
      : mode === "running"
        ? -1.05 + Math.sin(phase * 4 + index * 1.6) * 0.23
        : Math.sin(phase) * 0.025;
  });
  rig.legs.forEach((leg, index) => {
    leg.rotation.x = walking ? Math.sin(phase * 8 + index * Math.PI) * 0.5 : 0;
  });
  rig.wings.forEach((wing, index) => {
    wing.rotation.y = Math.sin(phase * (mode === "running" ? 3 : 1.1)) * 0.07 * (index ? 1 : -1);
  });
  const blink = phase % 5.7;
  for (const eye of rig.eyes) eye.scale.y = mode === "asleep" || blink > 5.5 ? 0.02 : 0.105;
  rig.ring.visible = selected;
  rig.badge.visible = selected;
  rig.badge.position.y = 2.62 + Math.sin(phase * 2) * 0.06;
}

/** Cheap far-away stand-in: capsule, head and eyes, no shadows. */
export function createToken(index: number, accent: string): THREE.Group {
  const root = new THREE.Group();
  shape(root, new THREE.CapsuleGeometry(0.3, 0.55, 3, 8), CLOTHES[index]!, [0, 0.78, 0]);
  ball(root, FUR[index]!, [0, 1.52, 0], [0.43, 0.4, 0.35]);
  ball(root, accent, [0, 1.05, 0.29], [0.1, 0.1, 0.05]);
  for (const x of [-0.15, 0.15]) ball(root, "#2d4540", [x, 1.56, 0.32], [0.045, 0.065, 0.03]);
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = false;
  });
  return root;
}
