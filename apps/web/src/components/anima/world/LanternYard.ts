import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { observeResize } from "~/lib/observeResize";

import {
  animateCreature,
  createCreature,
  createToken,
  disposeClay,
  type CreatureLook,
  type CreatureMode,
  type CreatureRig,
} from "./clay";
import {
  bridgeRoute,
  campusConnections,
  createBridge,
  createLandscape,
  DISTRICT_COLORS,
  districtTheme,
  layoutCampus,
  localePlan,
  localeRoute,
  localeStations,
  type CampusSection,
  type Point,
  type Yard,
} from "./yard";

export interface WorldAgent {
  readonly id: string;
  readonly formIndex: number;
  readonly look: CreatureLook;
  readonly mode: CreatureMode;
  readonly districtId: string;
  readonly districtName: string;
  /** Plain text for the floating label. */
  readonly label: string;
  /** Short status for the floating label, e.g. "Live" or "2h ago". */
  readonly status: string;
  /** What a live or recently active anima is working on, shown as a thought bubble in its town. */
  readonly thought?: string | null;
}

export interface WorldTown {
  readonly id: string;
  readonly name: string;
  readonly residentIds: ReadonlyArray<string>;
}

export type CameraPreset = "campus" | "district" | "follow";

interface Occupant {
  agent: WorldAgent;
  sectionId: string;
  slot: number;
  center: THREE.Vector3;
  node: THREE.Group;
  token: THREE.Group;
  rig: CreatureRig | null;
  rigKey: string;
  target: THREE.Vector3;
  path: Array<THREE.Vector3>;
  nextStroll: number;
  label: HTMLButtonElement;
}

interface SectionView {
  section: CampusSection;
  root: THREE.Group;
  button: HTMLButtonElement;
}

const FRAME_MS = 32;
const SECTION_SUFFIXES = [
  "",
  "East",
  "West",
  "North",
  "South",
  "Glen",
  "Rise",
  "Vale",
  "Reach",
  "Ford",
];
const MODE_PRIORITY: Readonly<Record<CreatureMode, number>> = {
  running: 0,
  recent: 1,
  idle: 2,
  asleep: 3,
};

function sectionName(section: CampusSection) {
  const suffix = SECTION_SUFFIXES[section.number - 1] ?? String(section.number);
  return suffix ? `${section.name} ${suffix}` : section.name;
}
const LABEL_ZOOM = 1.1;
const STROLLING: ReadonlySet<CreatureMode> = new Set(["idle", "recent"]);

/**
 * Lantern Yard: animas as clay creatures in project locales joined by bridges.
 * Rendering is gated: the loop only runs while the host is on screen, the tab is
 * visible and motion is allowed; otherwise frames are drawn only when something changes.
 */
export class LanternYard {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-12, 12, 8, -8, 0.1, 1000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly sun: THREE.DirectionalLight;
  private readonly warm: THREE.PointLight;
  private readonly bridges = new THREE.Group();
  private readonly occupants = new Map<string, Occupant>();
  private readonly sections = new Map<string, SectionView>();
  private readonly labels: HTMLDivElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly stopResize: () => void;
  private readonly visibilityObserver: IntersectionObserver;
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  private yard: Yard | null = null;
  private yardKey = "";
  private topology = "";
  private connections: Array<[string, string]> = [];
  private focusSection = "";
  private selectedId: string | null = null;
  private preset: CameraPreset = "campus";
  private fitted = false;
  private onScreen = false;
  private paused = false;
  private running = false;
  private disposed = false;
  private dirty = true;
  private time = 0;
  private lastFrame = 0;
  private width = 1;
  private height = 1;
  private clickStart = { x: 0, y: 0 };
  private frameRequest = 0;
  private reportedFocus = "";

  constructor(
    private readonly host: HTMLElement,
    private readonly onSelect: (id: string | null) => void,
    private readonly onOpen: (id: string) => void,
    private readonly onFocus: (town: WorldTown | null) => void = () => {},
  ) {
    // Transparent, so the page's dusk gradient shows through as the sky.
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = this.renderer.domElement;
    canvas.className = "absolute inset-0 size-full touch-none outline-none";
    canvas.setAttribute("role", "img");
    canvas.setAttribute(
      "aria-label",
      "Lantern Yard: your animas as creatures in their project towns. Drag to orbit, scroll to zoom, right-drag to pan.",
    );
    host.prepend(canvas);

    this.scene.add(new THREE.HemisphereLight("#d6e9db", "#65775f", 2.05));
    this.sun = new THREE.DirectionalLight("#ffe2b2", 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, {
      left: -24,
      right: 24,
      top: 20,
      bottom: -20,
      near: 1,
      far: 65,
    });
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.bias = -0.0003;
    this.scene.add(this.sun, this.sun.target);
    const rim = new THREE.DirectionalLight("#88c3d5", 1.3);
    rim.position.set(7, 8, -10);
    this.scene.add(rim);
    this.warm = new THREE.PointLight("#ffbd6c", 12, 9);
    this.scene.add(this.warm, this.bridges);

    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: false,
      screenSpacePanning: false,
      minZoom: 0.02,
      maxZoom: 6,
      minPolarAngle: 0.45,
      maxPolarAngle: 1.28,
      rotateSpeed: 0.65,
    });
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.controls.addEventListener("change", this.invalidate);

    this.labels = document.createElement("div");
    this.labels.className = "pointer-events-none absolute inset-0 overflow-hidden";
    host.append(this.labels);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("dblclick", this.onDoubleClick);
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    document.addEventListener("visibilitychange", this.syncLoop);
    this.reducedMotion.addEventListener("change", this.syncLoop);
    this.stopResize = observeResize(host, () => this.resize());
    this.visibilityObserver = new IntersectionObserver((entries) => {
      this.onScreen = entries.some((entry) => entry.isIntersecting);
      this.syncLoop();
    });
    this.visibilityObserver.observe(host);
    this.camera.position.set(15, 20, 28);
    this.resize();
  }

  update(agents: ReadonlyArray<WorldAgent>, selectedId: string | null) {
    const { sections, placements } = layoutCampus(
      agents.map((agent) => ({
        id: agent.id,
        districtId: agent.districtId,
        districtName: agent.districtName,
      })),
    );
    const sectionIds = new Set(sections.map((section) => section.id));
    for (const [id, occupant] of this.occupants) {
      if (placements.has(id)) continue;
      this.scene.remove(occupant.node);
      releaseGeometry(occupant.node);
      occupant.label.remove();
      this.occupants.delete(id);
    }
    for (const [id, view] of this.sections) {
      if (sectionIds.has(id)) continue;
      this.scene.remove(view.root);
      releaseGeometry(view.root);
      view.button.remove();
      this.sections.delete(id);
    }
    const topology = sections
      .map((section) => `${section.id}:${section.center.join(",")}:${section.entryIds.length}`)
      .join("|");
    if (topology !== this.topology) {
      this.topology = topology;
      for (const bridge of this.bridges.children) releaseGeometry(bridge);
      this.bridges.clear();
      this.connections = campusConnections(sections);
      const byId = new Map(sections.map((section) => [section.id, section]));
      for (const [a, b] of this.connections)
        this.bridges.add(createBridge(bridgeRoute(byId.get(a)!, byId.get(b)!)));
      // Desk count is baked into the landscape, so a changed section rebuilds.
      for (const view of this.sections.values()) {
        this.scene.remove(view.root);
        releaseGeometry(view.root);
        view.button.remove();
      }
      this.sections.clear();
      this.yardKey = "";
    }
    for (const section of sections) {
      let view = this.sections.get(section.id);
      if (!view) {
        const root = createLandscape(section, false).root;
        root.position.set(...section.center);
        this.scene.add(root);
        const button = document.createElement("button");
        button.type = "button";
        button.className =
          "pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-black/55 px-3 py-1 text-xs font-medium text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/70";
        button.addEventListener("click", () => {
          this.focusSection = section.id;
          this.focusDetails();
          this.setCamera("district");
        });
        this.labels.append(button);
        view = { section, root, button };
        this.sections.set(section.id, view);
      }
      view.section = section;
      view.button.style.borderColor =
        DISTRICT_COLORS[districtTheme(section.districtId, section.name)]!;
      view.button.textContent = `${sectionName(section)} · ${section.entryIds.length}`;
    }
    const sectionById = new Map(sections.map((section) => [section.id, section]));
    for (const agent of agents) {
      const placement = placements.get(agent.id)!;
      const section = sectionById.get(placement.sectionId)!;
      const center = new THREE.Vector3(...section.center);
      const target = new THREE.Vector3(
        ...localeStations(section, agent.mode === "running")[placement.slot]!,
      ).add(center);
      let occupant = this.occupants.get(agent.id);
      if (!occupant) {
        const node = new THREE.Group();
        node.userData.animaId = agent.id;
        node.position.copy(target);
        node.rotation.y = 0.4;
        const token = createToken(agent.formIndex, agent.look.accent);
        node.add(token);
        this.scene.add(node);
        const label = document.createElement("button");
        label.type = "button";
        label.className =
          "pointer-events-auto absolute flex -translate-x-1/2 -translate-y-full flex-col items-start gap-0.5 whitespace-nowrap rounded-lg border-l-4 bg-white/92 px-2.5 py-1 text-xs font-medium text-neutral-900 shadow-lg transition-transform hover:scale-105 dark:bg-neutral-900/90 dark:text-neutral-100";
        label.addEventListener("click", () => this.onSelect(agent.id));
        label.addEventListener("dblclick", () => this.onOpen(agent.id));
        this.labels.append(label);
        occupant = {
          agent,
          sectionId: section.id,
          slot: placement.slot,
          center,
          node,
          token,
          rig: null,
          rigKey: "",
          target,
          path: [],
          nextStroll: 10 + this.occupants.size * 3.5,
          label,
        };
        this.occupants.set(agent.id, occupant);
      }
      const moved =
        occupant.sectionId !== section.id ||
        occupant.slot !== placement.slot ||
        !occupant.center.equals(center);
      if (moved || occupant.agent.mode !== agent.mode) {
        occupant.target.copy(target);
        if (moved || this.paused || agent.mode === "asleep") {
          occupant.node.position.copy(target);
          occupant.path = [];
        } else {
          occupant.path = [occupant.node.position.clone().setY(0), target.clone()];
        }
      }
      if (
        occupant.agent.formIndex !== agent.formIndex ||
        occupant.agent.look.accent !== agent.look.accent
      ) {
        occupant.node.remove(occupant.token);
        releaseGeometry(occupant.token);
        occupant.token = createToken(agent.formIndex, agent.look.accent);
        occupant.node.add(occupant.token);
      }
      Object.assign(occupant, { agent, sectionId: section.id, slot: placement.slot, center });
      occupant.label.style.borderLeftColor = agent.look.accent;
      const heading = document.createElement("span");
      heading.className = "flex items-center gap-1.5";
      const status = document.createElement("span");
      status.className = "font-normal opacity-60";
      status.textContent = agent.status;
      heading.append(document.createTextNode(agent.label), status);
      occupant.label.replaceChildren(heading);
      if (agent.thought) {
        const thought = document.createElement("span");
        thought.className =
          "line-clamp-2 max-w-56 whitespace-normal text-left font-normal opacity-80";
        thought.textContent = agent.thought;
        occupant.label.append(thought);
      }
    }
    const selected = selectedId ? this.occupants.get(selectedId) : undefined;
    const changed = this.selectedId !== selectedId;
    this.selectedId = selected ? selectedId : null;
    const liveliest = agents.toSorted((a, b) => MODE_PRIORITY[a.mode] - MODE_PRIORITY[b.mode])[0];
    const nextFocus =
      selected?.sectionId ??
      (this.sections.has(this.focusSection)
        ? this.focusSection
        : ((liveliest ? placements.get(liveliest.id)?.sectionId : undefined) ??
          sections[0]?.id ??
          ""));
    if (nextFocus !== this.focusSection) this.focusSection = nextFocus;
    this.focusDetails();
    if (!this.fitted && sections.length > 0) {
      this.fitted = true;
      this.setCamera(selected ? "follow" : "district");
    } else if (changed && selected) {
      this.setCamera("follow");
    }
    this.invalidate();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.syncLoop();
  }

  setCamera(preset: CameraPreset | "zoom-in" | "zoom-out") {
    if (preset === "zoom-in" || preset === "zoom-out") {
      this.camera.zoom = THREE.MathUtils.clamp(
        this.camera.zoom * (preset === "zoom-in" ? 1.25 : 0.8),
        0.02,
        6,
      );
      this.camera.updateProjectionMatrix();
      this.invalidate();
      return;
    }
    this.preset = preset;
    const selected = this.selectedId ? this.occupants.get(this.selectedId) : undefined;
    if (preset === "follow" && selected) {
      const position = selected.node.position.clone().add(new THREE.Vector3(0, 1, 0));
      this.controls.target.copy(position);
      this.camera.position.copy(position).add(new THREE.Vector3(8, 7, 13));
      this.camera.zoom = 2.1;
      this.camera.updateProjectionMatrix();
      this.controls.update();
      this.invalidate();
      return;
    }
    const focused = this.sections.get(this.focusSection);
    const fitting = preset === "district" && focused ? [focused] : [...this.sections.values()];
    const bounds = new THREE.Box3();
    for (const view of fitting) {
      const center = new THREE.Vector3(...view.section.center);
      bounds.expandByPoint(center.clone().add(new THREE.Vector3(-27, -1, -20)));
      bounds.expandByPoint(center.clone().add(new THREE.Vector3(27, 14, 20)));
    }
    const target = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const radius = bounds.isEmpty()
      ? 12
      : Math.max(12, bounds.getSize(new THREE.Vector3()).length() / 2);
    this.camera.position
      .copy(target)
      .add(new THREE.Vector3(radius * 0.65, radius * 0.95, radius * 1.4));
    this.controls.target.copy(target);
    this.controls.update();
    this.camera.updateMatrixWorld();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const view of fitting) {
      const root = view.section.id === this.focusSection && this.yard ? this.yard.root : view.root;
      root.updateMatrixWorld(true);
      for (const [x, y, z] of (root.userData.fitPoints ?? []) as Array<[number, number, number]>) {
        const point = new THREE.Vector3(x, y, z)
          .applyMatrix4(root.matrixWorld)
          .applyMatrix4(this.camera.matrixWorldInverse);
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y - 1);
        maxY = Math.max(maxY, point.y + 4);
      }
    }
    if (Number.isFinite(minX)) {
      const offset = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, 0).applyQuaternion(
        this.camera.quaternion,
      );
      this.camera.position.add(offset);
      this.controls.target.add(offset);
      this.camera.zoom =
        Math.min(
          (this.camera.right - this.camera.left) / Math.max(1, maxX - minX),
          (this.camera.top - this.camera.bottom) / Math.max(1, maxY - minY),
        ) * 0.9;
    } else {
      this.camera.zoom = 1;
    }
    this.camera.far = Math.max(200, radius * 8);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.invalidate();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameRequest);
    this.renderer.setAnimationLoop(null);
    this.stopResize();
    this.visibilityObserver.disconnect();
    this.controls.dispose();
    document.removeEventListener("visibilitychange", this.syncLoop);
    this.reducedMotion.removeEventListener("change", this.syncLoop);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("dblclick", this.onDoubleClick);
    canvas.removeEventListener("webglcontextlost", this.onContextLost);
    releaseGeometry(this.scene);
    disposeClay();
    this.renderer.dispose();
    canvas.remove();
    this.labels.remove();
  }

  private readonly invalidate = () => {
    this.dirty = true;
    if (this.running || this.frameRequest !== 0 || this.disposed) return;
    // Coalesce bursts (orbit drags, roster updates) into one frame.
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      this.draw();
    });
  };

  /** Every town, busiest first, for the town switcher. */
  towns(): Array<WorldTown> {
    return [...this.sections.values()].map(({ section }) => ({
      id: section.id,
      name: sectionName(section),
      residentIds: section.entryIds,
    }));
  }

  focusTown(id: string) {
    if (!this.sections.has(id)) return;
    this.focusSection = id;
    this.focusDetails();
    this.setCamera("district");
  }

  private focusDetails() {
    const view = this.sections.get(this.focusSection);
    const focusKey = view ? `${view.section.id}:${view.section.entryIds.join(",")}` : "";
    if (focusKey !== this.reportedFocus) {
      this.reportedFocus = focusKey;
      this.onFocus(
        view
          ? {
              id: view.section.id,
              name: sectionName(view.section),
              residentIds: view.section.entryIds,
            }
          : null,
      );
    }
    if (view && this.yardKey !== view.section.id) {
      if (this.yard) {
        this.scene.remove(this.yard.root);
        releaseGeometry(this.yard.root);
      }
      this.yard = createLandscape(view.section, true);
      this.yardKey = view.section.id;
      this.scene.add(this.yard.root);
    }
    if (view && this.yard) {
      this.yard.root.position.set(...view.section.center);
      const center = new THREE.Vector3(...view.section.center);
      this.sun.position.copy(center).add(new THREE.Vector3(-12, 25, 12));
      this.sun.target.position.copy(center);
      this.warm.position.copy(center).add(new THREE.Vector3(-5, 2, -2));
    }
    for (const section of this.sections.values())
      section.root.visible = section.section.id !== this.focusSection;
    if (this.yard) this.yard.root.visible = !!view;
    for (const occupant of this.occupants.values()) {
      const detailed = occupant.sectionId === this.focusSection;
      const key = `${occupant.agent.formIndex}:${occupant.agent.look.accent}:${occupant.agent.look.stage}:${occupant.agent.look.role}`;
      if (occupant.rig && (!detailed || occupant.rigKey !== key)) {
        occupant.node.remove(occupant.rig.root);
        releaseGeometry(occupant.rig.root);
        occupant.rig = null;
      }
      if (detailed && !occupant.rig) {
        occupant.rig = createCreature(occupant.agent.formIndex, occupant.agent.look);
        occupant.rig.root.scale.setScalar(0.93);
        occupant.rigKey = key;
        occupant.node.add(occupant.rig.root);
        animateCreature(
          occupant.rig,
          this.time,
          occupant.agent.mode,
          false,
          occupant.agent.id === this.selectedId,
        );
      }
      occupant.token.visible = !detailed;
      if (occupant.rig) {
        occupant.rig.ring.visible = occupant.agent.id === this.selectedId;
        occupant.rig.badge.visible = occupant.agent.id === this.selectedId;
      }
    }
  }

  private resize() {
    if (this.disposed) return;
    const rect = this.host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.width = rect.width;
    this.height = rect.height;
    this.renderer.setSize(rect.width, rect.height, false);
    const aspect = rect.width / rect.height;
    const span = 8.1;
    Object.assign(this.camera, {
      left: -span * aspect,
      right: span * aspect,
      top: span,
      bottom: -span,
    });
    this.camera.updateProjectionMatrix();
    if (this.fitted && this.preset !== "follow") this.setCamera(this.preset);
    this.invalidate();
  }

  private readonly syncLoop = () => {
    if (this.disposed) return;
    const animate =
      this.onScreen && !document.hidden && !this.paused && !this.reducedMotion.matches;
    if (animate === this.running) return;
    this.running = animate;
    this.lastFrame = 0;
    this.renderer.setAnimationLoop(animate ? this.tick : null);
    this.invalidate();
  };

  private readonly tick = (stamp: number) => {
    if (this.lastFrame && stamp - this.lastFrame < FRAME_MS) return;
    const delta = this.lastFrame ? Math.min((stamp - this.lastFrame) / 1000, 0.06) : 0;
    this.lastFrame = stamp;
    this.time += delta;
    for (const occupant of this.occupants.values()) this.step(occupant, delta);
    if (this.preset === "follow" && this.selectedId) {
      const occupant = this.occupants.get(this.selectedId);
      if (occupant) {
        const offset = occupant.node.position
          .clone()
          .add(new THREE.Vector3(0, 1, 0))
          .sub(this.controls.target);
        this.controls.target.add(offset);
        this.camera.position.add(offset);
        this.controls.update();
      }
    }
    if (this.yard) {
      this.yard.motes.rotation.y = Math.sin(this.time * 0.07) * 0.05;
      this.yard.motes.position.y = Math.sin(this.time * 0.5) * 0.08;
      this.yard.flames.forEach((flame, index) =>
        flame.scale.setScalar(0.17 * (1 + Math.sin(this.time * 1.5 + index) * 0.045)),
      );
    }
    this.dirty = true;
    this.draw();
  };

  private step(occupant: Occupant, delta: number) {
    const { agent } = occupant;
    if (agent.mode === "asleep") {
      if (occupant.rig)
        animateCreature(occupant.rig, this.time, "asleep", false, agent.id === this.selectedId);
      return;
    }
    if (
      occupant.path.length === 0 &&
      STROLLING.has(agent.mode) &&
      this.time >= occupant.nextStroll
    ) {
      occupant.path = this.strollRoute(occupant);
      occupant.nextStroll = this.time + 65 + (occupant.slot + 1) * 4.7;
    }
    let walking = false;
    const next = occupant.path[0];
    if (next) {
      const direction = next.clone().sub(occupant.node.position);
      const distance = direction.length();
      if (distance < 0.06) {
        occupant.path.shift();
      } else {
        walking = true;
        occupant.node.position.add(
          direction.normalize().multiplyScalar(Math.min(distance, delta * 1.4)),
        );
        occupant.node.rotation.y = Math.atan2(direction.x, direction.z);
      }
    } else {
      occupant.node.rotation.y += (0.4 - occupant.node.rotation.y) * Math.min(1, delta * 5);
    }
    if (occupant.rig)
      animateCreature(occupant.rig, this.time, agent.mode, walking, agent.id === this.selectedId);
    else occupant.token.position.y = walking ? Math.sin(this.time * 9 + occupant.slot) * 0.07 : 0;
  }

  /** A visit to a neighbouring town over the bridge and back, or a short turn around the desk. */
  private strollRoute(occupant: Occupant): Array<THREE.Vector3> {
    const neighbours = this.connections.flatMap(([a, b]) =>
      a === occupant.sectionId ? [b] : b === occupant.sectionId ? [a] : [],
    );
    const home = this.sections.get(occupant.sectionId)?.section;
    const away = this.sections.get(
      neighbours[occupant.slot % Math.max(1, neighbours.length)] ?? "",
    )?.section;
    if (!home || !away)
      return [
        occupant.target.clone().add(new THREE.Vector3(0.6, 0, -0.45)),
        occupant.target.clone(),
      ];
    const toWorld =
      (section: CampusSection) =>
      ([x, z]: Point) =>
        new THREE.Vector3(x + section.center[0], 0, z + section.center[2]);
    const local = (point: THREE.Vector3): Point => [
      point.x - home.center[0],
      point.z - home.center[2],
    ];
    const crossing = bridgeRoute(home, away).map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const first = crossing[0]!;
    const last = crossing.at(-1)!;
    const exit: Point = [first.x - home.center[0], first.z - home.center[2]];
    const entrance: Point = [last.x - away.center[0], last.z - away.center[2]];
    const homePlan = localePlan(home.name, home.districtId);
    const out = localeRoute(homePlan, local(occupant.node.position), exit).map(toWorld(home));
    const visit = localeRoute(localePlan(away.name, away.districtId), entrance, [0, 1]).map(
      toWorld(away),
    );
    const back = localeRoute(homePlan, exit, local(occupant.target)).map(toWorld(home));
    return [
      ...out,
      ...crossing,
      ...visit,
      ...visit.toReversed(),
      ...crossing.toReversed(),
      ...back,
    ];
  }

  private positionLabel(label: HTMLElement, point: THREE.Vector3, show: boolean) {
    if (!show) {
      label.hidden = true;
      return;
    }
    point.project(this.camera);
    const x = (point.x * 0.5 + 0.5) * this.width;
    const y = (-point.y * 0.5 + 0.5) * this.height;
    label.style.transform = `translate(${x}px, ${y}px)`;
    label.style.left = "0";
    label.style.top = "0";
    label.hidden =
      point.z > 1 || point.z < -1 || x < 0 || x > this.width || y < 0 || y > this.height;
  }

  private draw() {
    if (this.disposed || !this.dirty) return;
    this.camera.updateMatrixWorld();
    const zoomed = this.camera.zoom > LABEL_ZOOM || this.preset !== "campus";
    for (const occupant of this.occupants.values()) {
      const show = zoomed
        ? occupant.sectionId === this.focusSection || this.camera.zoom > 2.5
        : occupant.agent.id === this.selectedId;
      this.positionLabel(
        occupant.label,
        occupant.node.position.clone().add(new THREE.Vector3(0, 2.6, 0)),
        show,
      );
    }
    for (const view of this.sections.values()) {
      this.positionLabel(
        view.button,
        new THREE.Vector3(...view.section.center).add(new THREE.Vector3(0, 0.7, 13.5)),
        !zoomed,
      );
    }
    try {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    } catch {
      this.dispose();
    }
  }

  private pick(event: MouseEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      [...this.occupants.values()].map((occupant) => occupant.node),
      true,
    );
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.animaId) node = node.parent;
      if (node) return node.userData.animaId as string;
    }
    return null;
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    this.clickStart = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - this.clickStart.x, event.clientY - this.clickStart.y) > 7)
      return;
    this.onSelect(this.pick(event));
  };

  private readonly onDoubleClick = (event: MouseEvent) => {
    const id = this.pick(event);
    if (id) this.onOpen(id);
  };

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.dispose();
  };
}

/** Frees a subtree's geometry and its own materials; shared clay materials stay cached. */
function releaseGeometry(root: THREE.Object3D) {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh || node instanceof THREE.Points)) return;
    node.geometry.dispose();
    const material = node.material as THREE.Material;
    if (!material.userData.shared) material.dispose();
  });
}
