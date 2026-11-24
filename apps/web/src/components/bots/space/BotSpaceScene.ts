import * as THREE from "three";

import { observeResize } from "~/lib/observeResize";

import type { BotStarPlace } from "./botSpace.logic";

export interface SpaceStar {
  readonly id: string;
  /** `#rrggbb`, the light the bot gives off. */
  readonly color: string;
  readonly centre: boolean;
  readonly place: BotStarPlace;
  /** Tasks running now; each is a spark in orbit. */
  readonly working: number;
  /** Things waiting on the person; any makes the bot signal. */
  readonly waiting: number;
  /** Its own chat is mid-reply. */
  readonly busy: boolean;
}

/** What the conversation with the centre bot is doing, and how loud the voice in it is. */
export interface SpaceVoice {
  readonly mode: "off" | "listening" | "hearing" | "thinking" | "speaking";
  /** 0..1: the microphone while hearing, the bot's voice while speaking. */
  readonly level: number;
}

/** One bot is telling another something, or waiting on its answer. */
export interface SpaceLink {
  readonly from: string;
  readonly to: string;
}

export interface SpaceRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface Beam {
  readonly line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly pulse: THREE.Sprite;
}

/** Where a star is on screen, in CSS pixels from the host's top left. */
export interface StarOnScreen {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

const FRAME_MS = 32;
const TASKS_SHOWN = 8;
const CAMERA_HOME = new THREE.Vector3(0, 0, 12);
const WAITING = new THREE.Color("#ffb347");
/** How far a bot's rings reach, in units of its globe's radius. */
const REACH = 2.4;
/** The size of the bot in the middle and of the others, in units of the scene's bot size. */
const LEAD_SIZE = 0.62;
const OTHER_SIZE = 0.32;
/** Where a line between two bots meets a bot: just outside its rings. */
const RING_EDGE = 2.12;
const BEAM_POINTS = 28;

const GLOBE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uScan;
uniform float uLevel;
uniform float uPx;
uniform float uSeed;
varying float vLight;
varying float vFront;
void main() {
  // The voice runs over the globe as bands that swell, like a level meter wrapped round it.
  float ripple = 0.5 + 0.5 * sin(position.y * 8.0 + uTime * 9.0 + uSeed);
  vec4 at = modelViewMatrix * vec4(position * (1.0 + uLevel * 0.22 * ripple), 1.0);
  vFront = smoothstep(-0.25, 0.35, normalize(normalMatrix * position).z);
  float scan = smoothstep(0.72, 1.0, sin(position.y * 2.6 - uScan));
  vLight = 0.5 + scan * 1.1 + uLevel * ripple * 0.6;
  gl_PointSize = uPx * (0.75 + scan * 0.6) * mix(0.7, 1.0, vFront);
  gl_Position = projectionMatrix * at;
}`;

const GLOBE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uGlow;
varying float vLight;
varying float vFront;
void main() {
  float dotEdge = 1.0 - smoothstep(0.28, 0.5, length(gl_PointCoord - 0.5));
  vec3 lit = mix(uColor, vec3(1.0), clamp(vLight - 0.9, 0.0, 0.7)) * vLight * uGlow;
  // The far side shows through, dimmer, so it reads as a globe and not a disc.
  gl_FragColor = vec4(lit, dotEdge * mix(0.2, 1.0, vFront));
  #include <colorspace_fragment>
}`;

const FLAT_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * The rings round a bot, drawn by distance and angle so every line stays sharp at any size.
 * Each ring says one thing: the ticked dial turns faster while the bot works, a light circles
 * for every task, the brackets turn amber when the person is needed, the innermost ring is the
 * voice.
 */
const RINGS_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uWarn;
uniform float uTime;
uniform float uSpin;
uniform float uSeed;
uniform float uGlow;
uniform float uTasks;
uniform float uWaiting;
uniform float uVoice;
uniform float uLevel;
uniform float uLead;
varying vec2 vUv;
const float PI = 3.14159265;
const float TAU = 6.2831853;
float band(float r, float at, float half_, float aa) {
  return 1.0 - smoothstep(half_ - aa, half_ + aa, abs(r - at));
}
// A line with the bloom a bright one throws round itself.
float lit(float r, float at, float half_, float aa) {
  return band(r, at, half_, aa) + exp(-abs(r - at) * 26.0) * 0.16;
}
float arc(float a, float at, float span, float aa) {
  float d = abs(mod(a - at + PI, TAU) - PI);
  return 1.0 - smoothstep(span * 0.5 - aa, span * 0.5 + aa, d);
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0 * ${REACH.toFixed(1)};
  float r = length(p);
  float a = atan(p.y, p.x);
  float aa = fwidth(r);
  // The angle's own derivative breaks where it wraps, so its smoothing comes from the radius.
  float aaA = aa / max(r, 0.05);
  // A small bot gets fewer, bolder marks: a scaled-down dial is only noise.
  float bold = mix(1.9, 1.0, uLead);
  vec3 light = vec3(0.0);

  float wave = sin(a * 9.0 + uTime * 5.0) * 0.5 + sin(a * 17.0 - uTime * 7.0) * 0.3
    + sin(a * 5.0 + uTime * 3.0) * 0.2;
  float voiceAt = 1.3 + wave * (0.015 + uLevel * 0.11);
  light += mix(uColor, vec3(1.0), 0.45) * lit(r, voiceAt, 0.013 * bold, aa) * uVoice;
  light += uColor * band(r, 1.3, 0.005 * bold, aa) * 0.3 * (1.0 - uVoice);

  float count = mix(24.0, 72.0, uLead);
  float turn = (a + uSpin * 0.35 + uSeed) / TAU * count;
  float aaTick = aaA / TAU * count;
  float tick = 1.0 - smoothstep(0.1 - aaTick, 0.1 + aaTick, abs(fract(turn) - 0.5));
  float major = step(mod(floor(turn), 6.0), 0.5);
  float tickBand = mix(band(r, 1.5, 0.024, aa), band(r, 1.5, 0.052, aa), major);
  light += uColor * tick * tickBand * mix(0.42, 0.9, major);

  float third = fract((a - uSpin + uSeed * 2.0) / TAU * 3.0);
  float aaThird = aaA / TAU * 3.0;
  float dash = 1.0 - smoothstep(0.39 - aaThird, 0.39 + aaThird, abs(third - 0.5));
  light += uColor * band(r, 1.67, 0.008 * bold, aa) * dash * 0.8;

  float bracketAt = uSpin * 0.4 + uSeed * 3.0;
  float bracket = max(arc(a, bracketAt, 0.8, aaA), arc(a, bracketAt + PI, 0.8, aaA));
  float between = max(arc(a, bracketAt + PI * 0.5, 1.5, aaA), arc(a, bracketAt - PI * 0.5, 1.5, aaA));
  vec3 edge = mix(uColor, uWarn, uWaiting);
  float throb = mix(1.0, 0.62 + 0.38 * sin(uTime * 3.2), uWaiting);
  light += edge * lit(r, 1.85, 0.03, aa) * bracket * 0.85 * throb;
  light += edge * band(r, 1.85, 0.006 * bold, aa) * between * 0.5;

  float beat = fract(uTime * 0.45 + uSeed * 0.1);
  light += uWarn * uWaiting * band(r, 2.07 + beat * 0.28, 0.012 * bold, aa) * (1.0 - beat) * 0.8;

  float tasks = min(uTasks, ${TASKS_SHOWN.toFixed(1)});
  float comet = 0.0;
  for (int i = 0; i < ${TASKS_SHOWN}; i++) {
    if (float(i) >= tasks) break;
    float head = uTime * (0.55 + float(i) * 0.06) + float(i) * 2.399 + uSeed;
    float behind = mod(head - a, TAU);
    comet = max(comet, max(exp(-behind * 4.0), exp(-(TAU - behind) * 60.0)));
  }
  light += uColor * band(r, 2.03, 0.005 * bold, aa) * 0.16 * step(0.5, tasks);
  light += mix(uColor, vec3(1.0), 0.5 * comet) * lit(r, 2.03, 0.02 * bold, aa) * comet * 1.15;

  gl_FragColor = vec4(light * uGlow, 1.0);
  #include <colorspace_fragment>
}`;

interface Star {
  readonly group: THREE.Group;
  /** Never drawn: what a click or the pointer has to land on. */
  readonly target: THREE.Mesh;
  readonly globe: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly rings: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly core: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly hoops: ReadonlyArray<THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>>;
  readonly heart: THREE.Sprite;
  readonly halo: THREE.Sprite;
  readonly seed: number;
  input: SpaceStar;
  glow: number;
  /** Turned through so far. Kept as a sum so a change of pace never makes a ring jump. */
  spin: number;
  scan: number;
  voice: number;
  waiting: number;
}

function softDisc(inner: number, innerLight = 0.32) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const paint = canvas.getContext("2d")!;
  const fade = paint.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  fade.addColorStop(0, "rgba(255,255,255,1)");
  fade.addColorStop(inner, `rgba(255,255,255,${innerLight})`);
  fade.addColorStop(Math.min(inner * 2.6, 0.9), `rgba(255,255,255,${innerLight * 0.28})`);
  fade.addColorStop(1, "rgba(255,255,255,0)");
  paint.fillStyle = fade;
  paint.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Points along lines of latitude: a globe drawn in dots, which a blur of scattered ones is not. */
function dottedGlobe(latitudes: number, round: number) {
  const points: number[] = [0, 1, 0, 0, -1, 0];
  for (let line = 1; line <= latitudes; line++) {
    const latitude = -Math.PI / 2 + (Math.PI * line) / (latitudes + 1);
    const count = Math.max(4, Math.round(round * Math.cos(latitude)));
    for (let index = 0; index < count; index++) {
      const longitude = ((index + (line % 2) * 0.5) / count) * Math.PI * 2;
      points.push(
        Math.cos(latitude) * Math.cos(longitude),
        Math.sin(latitude),
        Math.cos(latitude) * Math.sin(longitude),
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

const WHITE = new THREE.Color("#ffffff");

function freeMaterial(object: THREE.Object3D) {
  if ("material" in object) (object.material as THREE.Material).dispose();
}

function hoop() {
  const points = Array.from({ length: 128 }, (_, index) => {
    const angle = (index / 128) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
  });
  return new THREE.BufferGeometry().setFromPoints(points);
}

/**
 * The bots as instruments of light in an empty dark, the one you talk to in the middle. The loop
 * runs only while the host is on screen, the tab is visible and motion is allowed, at thirty
 * frames a second; otherwise a frame is drawn only when something changes.
 */
export class BotSpaceScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly stars = new Map<string, Star>();
  private readonly glowTexture = softDisc(0.14, 0.5);
  private readonly sparkTexture = softDisc(0.4);
  private readonly leadGlobe = dottedGlobe(15, 54);
  private readonly otherGlobe = dottedGlobe(9, 30);
  private readonly ringsGeometry = new THREE.PlaneGeometry(REACH * 2, REACH * 2);
  private readonly coreGeometry = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.46, 1));
  private readonly hoopGeometry = hoop();
  private readonly targetGeometry = new THREE.SphereGeometry(1.5, 12, 8);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly beams = new Map<string, Beam>();
  private links: ReadonlyArray<SpaceLink> = [];
  private region: SpaceRegion | null = null;
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  private readonly stopResize: () => void;
  private readonly visibility: IntersectionObserver;
  private voice: SpaceVoice = { mode: "off", level: 0 };
  /** Read once a frame, so a level that moves twenty times a second never renders React. */
  voiceSource: (() => SpaceVoice) | null = null;
  private heard = 0;
  private hovered: string | null = null;
  private onScreen = true;
  private running = false;
  private disposed = false;
  /** World units per unit of a bot's size, set so a bot is the same size on any view. */
  private unit = 1;
  /** Device pixels a world unit covers at the bots' depth: the globe's dots are sized in pixels. */
  private pixelsPerUnit = 1;
  private frame = 0;
  private lastFrame = 0;
  private time = 0;
  private down: { readonly x: number; readonly y: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly onSelect: (id: string | null) => void,
    /** Called for every star after each frame, so labels follow without React rendering. */
    private readonly onPlace: (id: string, at: StarOnScreen | null) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    // Hairlines are the look: at less than the screen's own density they turn soft.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 1);
    this.canvas = this.renderer.domElement;
    this.canvas.className = "absolute inset-0 size-full";
    this.canvas.setAttribute("aria-hidden", "true");
    host.prepend(this.canvas);
    this.camera.position.copy(CAMERA_HOME);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(this.distantStars());

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    document.addEventListener("visibilitychange", this.syncLoop);
    this.reducedMotion.addEventListener("change", this.syncLoop);
    this.stopResize = observeResize(host, () => this.resize());
    this.visibility = new IntersectionObserver(([entry]) => {
      this.onScreen = entry?.isIntersecting ?? true;
      this.syncLoop();
    });
    this.visibility.observe(host);
    this.resize();
    this.syncLoop();
  }

  /** A few far points, still on purpose: the bots are the only things that move. */
  private distantStars() {
    const count = 160;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let index = 0; index < count; index++) {
      const angle = random() * Math.PI * 2;
      const height = random() * 2 - 1;
      const spread = Math.sqrt(1 - height * height);
      const far = 60 + random() * 50;
      positions.set(
        [Math.cos(angle) * spread * far, height * far, Math.sin(angle) * spread * far - 30],
        index * 3,
      );
      const light = 0.18 + random() ** 3 * 0.6;
      colors.set([light, light, light * (0.9 + random() * 0.2)], index * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true }),
    );
  }

  update(inputs: ReadonlyArray<SpaceStar>) {
    if (this.disposed) return;
    const seen = new Set<string>();
    for (const input of inputs) {
      seen.add(input.id);
      // A bot that becomes the one in the middle, or stops being it, is built again at that size.
      const kept = this.stars.get(input.id);
      if (kept !== undefined && kept.input.centre !== input.centre) this.removeStar(kept);
      const star = this.stars.get(input.id) ?? this.addStar(input);
      star.input = input;
      const color = new THREE.Color(input.color);
      star.globe.material.uniforms.uColor!.value = color;
      star.rings.material.uniforms.uColor!.value = color;
      star.rings.material.uniforms.uTasks!.value = Math.min(input.working, TASKS_SHOWN);
      star.core.material.color = color;
      for (const ring of star.hoops) ring.material.color = color;
      star.heart.material.color = color.clone().lerp(WHITE, 0.55);
      star.halo.material.color = color;
      star.group.scale.setScalar((input.centre ? LEAD_SIZE : OTHER_SIZE) * this.unit);
    }
    for (const star of this.stars.values()) {
      if (seen.has(star.input.id)) continue;
      this.removeStar(star);
      this.onPlace(star.input.id, null);
    }
    this.invalidate();
  }

  private removeStar(star: Star) {
    this.scene.remove(star.group);
    star.group.traverse(freeMaterial);
    this.stars.delete(star.input.id);
  }

  private addStar(input: SpaceStar): Star {
    const group = new THREE.Group();
    const seed = [...input.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 97;
    const color = new THREE.Color(input.color);
    const light = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

    const target = new THREE.Mesh(this.targetGeometry, new THREE.MeshBasicMaterial());
    target.visible = false;
    target.userData.starId = input.id;
    const globe = new THREE.Points(
      input.centre ? this.leadGlobe : this.otherGlobe,
      new THREE.ShaderMaterial({
        vertexShader: GLOBE_VERTEX,
        fragmentShader: GLOBE_FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uScan: { value: 0 },
          uLevel: { value: 0 },
          uPx: { value: 2 },
          uSeed: { value: seed },
          uColor: { value: color },
          uGlow: { value: 1 },
        },
        ...light,
      }),
    );
    globe.rotation.x = 0.36;
    const rings = new THREE.Mesh(
      this.ringsGeometry,
      new THREE.ShaderMaterial({
        vertexShader: FLAT_VERTEX,
        fragmentShader: RINGS_FRAGMENT,
        uniforms: {
          uColor: { value: color },
          uWarn: { value: WAITING },
          uTime: { value: 0 },
          uSpin: { value: 0 },
          uSeed: { value: seed },
          uGlow: { value: 1 },
          uTasks: { value: 0 },
          uWaiting: { value: 0 },
          uVoice: { value: 0 },
          uLevel: { value: 0 },
          uLead: { value: input.centre ? 1 : 0 },
        },
        ...light,
      }),
    );
    const line = (opacity: number) => new THREE.LineBasicMaterial({ ...light, opacity });
    const core = new THREE.LineSegments(this.coreGeometry, line(0.6));
    // Two hoops crossing the globe at angles of their own, which is what gives it depth.
    const hoops = (input.centre ? [1.1, 1.18] : [1.12]).map((radius) => {
      const ring = new THREE.LineLoop(this.hoopGeometry, line(0.42));
      ring.scale.setScalar(radius);
      return ring;
    });
    const sprite = (map: THREE.Texture) =>
      new THREE.Sprite(new THREE.SpriteMaterial({ map, ...light }));
    const heart = sprite(this.glowTexture);
    const halo = sprite(this.glowTexture);
    group.add(halo, rings, globe, core, ...hoops, heart, target);
    group.position.copy(this.home(input));
    this.scene.add(group);
    const star: Star = {
      group,
      target,
      globe,
      rings,
      core,
      hoops,
      heart,
      halo,
      seed,
      input,
      glow: 1,
      // Each bot starts turned its own way, so a still frame is not a row of identical dials.
      spin: seed * 0.37,
      scan: seed * 0.61,
      voice: 0,
      waiting: input.waiting > 0 ? 1 : 0,
    };
    this.stars.set(input.id, star);
    return star;
  }

  /** Draws again when the loop is not running, after something `voiceSource` reads changed. */
  refresh() {
    this.invalidate();
  }

  private readonly homePoint = new THREE.Vector3();

  /**
   * The part of the view the bots live in, in CSS pixels from the host's top left. The stars
   * fill the whole view; the bots keep to this part, clear of what is laid over the rest.
   */
  setRegion(region: SpaceRegion) {
    this.region = region;
    this.resize();
  }

  /** A place in the region's own proportions, so the bots fill a wide one and fit a narrow one. */
  private home(input: SpaceStar) {
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * CAMERA_HOME.z;
    const halfWidth = halfHeight * this.camera.aspect;
    const width = this.host.clientWidth || 1;
    const height = this.host.clientHeight || 1;
    const {
      left,
      top,
      width: wide,
      height: tall,
    } = this.region ?? {
      left: 0,
      top: 0,
      width,
      height,
    };
    return this.homePoint.set(
      (((left + wide / 2) / width) * 2 - 1 + input.place.x * (wide / width)) * halfWidth,
      (1 - ((top + tall / 2) / height) * 2 + input.place.y * (tall / height)) * halfHeight,
      input.place.z,
    );
  }

  /**
   * Which bots are talking to each other now. Each pair is joined by a line of light with a
   * point travelling along it, from the one that spoke to the one it spoke to.
   */
  setLinks(links: ReadonlyArray<SpaceLink>) {
    this.links = links;
    const wanted = new Set(links.map((link) => `${link.from}\n${link.to}`));
    for (const [key, beam] of this.beams) {
      if (wanted.has(key)) continue;
      this.scene.remove(beam.line, beam.pulse);
      beam.line.geometry.dispose();
      beam.line.material.dispose();
      beam.pulse.material.dispose();
      this.beams.delete(key);
    }
    for (const key of wanted) {
      if (this.beams.has(key)) continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: BEAM_POINTS }, () => new THREE.Vector3()),
        ),
        new THREE.LineBasicMaterial({
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const pulse = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.sparkTexture,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      this.scene.add(line, pulse);
      this.beams.set(key, { line, pulse });
    }
    this.invalidate();
  }

  private readonly beamAlong = new THREE.Vector3();
  private readonly beamStart = new THREE.Vector3();
  private readonly beamEnd = new THREE.Vector3();
  private readonly beamBow = new THREE.Vector3();
  private readonly beamPoint = new THREE.Vector3();

  private onBow(start: THREE.Vector3, bow: THREE.Vector3, end: THREE.Vector3, t: number) {
    const u = 1 - t;
    return this.beamPoint
      .set(0, 0, 0)
      .addScaledVector(start, u * u)
      .addScaledVector(bow, 2 * u * t)
      .addScaledVector(end, t * t);
  }

  private drawBeams() {
    for (const link of this.links) {
      const beam = this.beams.get(`${link.from}\n${link.to}`);
      const from = this.stars.get(link.from);
      const to = this.stars.get(link.to);
      if (beam === undefined) continue;
      const shown = from !== undefined && to !== undefined;
      beam.line.visible = shown;
      beam.pulse.visible = shown;
      if (!shown) continue;
      // From the edge of one bot's rings to the edge of the other's, not through their middles.
      const along = this.beamAlong.subVectors(to.group.position, from.group.position);
      const length = along.length() || 1;
      const start = this.beamStart
        .copy(from.group.position)
        .addScaledVector(along, (from.group.scale.x * RING_EDGE) / length);
      const end = this.beamEnd
        .copy(to.group.position)
        .addScaledVector(along, (-to.group.scale.x * RING_EDGE) / length);
      // Bowed to one side, so a line to a far bot goes round the ones between and not through.
      const bow = this.beamBow
        .set(-along.y, along.x, 0)
        .multiplyScalar(0.16)
        .addScaledVector(start, 0.5)
        .addScaledVector(end, 0.5);
      const points = beam.line.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index < BEAM_POINTS; index++) {
        const at = this.onBow(start, bow, end, index / (BEAM_POINTS - 1));
        points.setXYZ(index, at.x, at.y, at.z);
      }
      points.needsUpdate = true;
      beam.line.material.color = to.halo.material.color;
      beam.pulse.material.color = to.halo.material.color;
      beam.pulse.position.copy(this.onBow(start, bow, end, (this.time * 0.45) % 1));
      beam.pulse.scale.setScalar(0.16 * this.unit);
    }
  }

  private readonly syncLoop = () => {
    if (this.disposed) return;
    const animate = this.onScreen && !document.hidden && !this.reducedMotion.matches;
    if (animate !== this.running) {
      this.running = animate;
      this.lastFrame = 0;
      this.renderer.setAnimationLoop(animate ? this.tick : null);
    }
    this.invalidate();
  };

  private invalidate() {
    if (this.disposed || this.running || this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw(0);
    });
  }

  private readonly tick = (stamp: number) => {
    if (this.lastFrame && stamp - this.lastFrame < FRAME_MS) return;
    const delta = this.lastFrame ? Math.min((stamp - this.lastFrame) / 1000, 0.06) : 0;
    this.lastFrame = stamp;
    this.draw(delta);
  };

  private draw(delta: number) {
    if (this.disposed) return;
    this.time += delta;
    if (this.voiceSource !== null) this.voice = this.voiceSource();
    // The voice's level jumps; the light follows it a little behind so it does not flicker.
    this.heard += (this.voice.level - this.heard) * (delta === 0 ? 1 : Math.min(1, delta * 14));

    for (const star of this.stars.values()) this.drawStar(star, delta);
    this.drawBeams();
    try {
      this.renderer.render(this.scene, this.camera);
    } catch {
      this.dispose();
      return;
    }
    this.reportPlaces();
  }

  private drawStar(star: Star, delta: number) {
    const { input, seed } = star;
    const t = this.time;
    const mode = input.centre ? this.voice.mode : "off";
    const talking = mode === "speaking";
    const thinking = mode === "thinking" || input.busy;
    // With no time passing (a still frame) every eased value is where it is going.
    const ease = delta === 0 ? 1 : Math.min(1, delta * 7);
    const home = this.home(input);
    star.group.position.set(
      home.x + Math.sin(t * 0.23 + seed) * 0.1,
      home.y + Math.sin(t * 0.31 + seed * 1.3) * 0.12,
      home.z,
    );
    const level = talking || mode === "hearing" ? this.heard : 0;
    star.voice +=
      ((talking || mode === "hearing" ? 1 : mode === "listening" ? 0.55 : 0) - star.voice) * ease;
    star.waiting += ((input.waiting > 0 ? 1 : 0) - star.waiting) * ease;
    star.glow +=
      ((input.working > 0 || thinking ? 1.1 : 0.78) +
        (thinking ? Math.sin(t * 3.1) * 0.08 : 0) +
        (talking ? this.heard * 0.45 : 0) +
        (this.hovered === input.id ? 0.22 : 0) -
        star.glow) *
      ease;
    star.spin += delta * (thinking ? 0.95 : input.working > 0 ? 0.32 : 0.12);
    star.scan += delta * (thinking ? 3.4 : 0.9);

    const globe = star.globe.material.uniforms;
    globe.uTime!.value = t;
    globe.uScan!.value = star.scan;
    globe.uLevel!.value = talking ? level : 0;
    globe.uGlow!.value = star.glow;
    globe.uPx!.value = Math.max(
      star.group.scale.x * this.pixelsPerUnit * (input.centre ? 0.036 : 0.05),
      1.6 * this.renderer.getPixelRatio(),
    );
    star.globe.rotation.y = star.spin * 1.4;
    const rings = star.rings.material.uniforms;
    rings.uTime!.value = t;
    rings.uSpin!.value = star.spin;
    rings.uGlow!.value = star.glow;
    rings.uWaiting!.value = star.waiting;
    rings.uVoice!.value = star.voice;
    rings.uLevel!.value = level;

    star.core.rotation.set(star.spin * 1.1, -star.spin * 1.7, 0);
    star.core.material.opacity = 0.5 * star.glow;
    star.hoops.forEach((ring, index) => {
      ring.rotation.set(
        index === 0 ? 1.15 : -0.95,
        star.spin * (index === 0 ? 0.9 : -1.3),
        index * 0.6,
      );
      ring.material.opacity = 0.4 * star.glow;
    });
    star.heart.scale.setScalar(1.25 + level * 1.3 + (thinking ? Math.sin(t * 3.1) * 0.12 : 0));
    star.heart.material.opacity = Math.min(1, 0.85 * star.glow);
    // Faint, so the bot's own colour is what is seen and not a white bloom.
    star.halo.scale.setScalar(6.5 + level * 2.5);
    star.halo.material.opacity = 0.13 * star.glow;
  }

  private readonly corner = new THREE.Vector3();
  private readonly centrePoint = new THREE.Vector3();

  private reportPlaces() {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    const right = this.corner.set(1, 0, 0).applyQuaternion(this.camera.quaternion).clone();
    for (const [id, star] of this.stars) {
      const centre = this.centrePoint.copy(star.group.position).project(this.camera);
      if (centre.z > 1) {
        this.onPlace(id, null);
        continue;
      }
      const edge = this.corner
        .copy(star.group.position)
        .addScaledVector(right, star.group.scale.x)
        .project(this.camera);
      const x = (centre.x * 0.5 + 0.5) * width;
      this.onPlace(id, {
        x,
        y: (-centre.y * 0.5 + 0.5) * height,
        radius: Math.abs((edge.x * 0.5 + 0.5) * width - x),
      });
    }
  }

  private pick(event: PointerEvent) {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(
      [...this.stars.values()].map((star) => star.target),
      false,
    )[0];
    return (hit?.object.userData.starId as string | undefined) ?? null;
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    this.down = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const down = this.down;
    this.down = null;
    if (down === null || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 7) return;
    this.onSelect(this.pick(event));
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const over = this.pick(event);
    if (over === this.hovered) return;
    this.hovered = over;
    this.canvas.style.cursor = over === null ? "" : "pointer";
    this.invalidate();
  };

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.dispose();
  };

  private resize() {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Bots keep their size on screen whatever the shape of their region: a narrow one would
    // otherwise shrink them to dots, and a wide one would let them fill it.
    const pixelsPerUnit =
      height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * CAMERA_HOME.z);
    this.pixelsPerUnit = pixelsPerUnit * this.renderer.getPixelRatio();
    const room = this.region ?? { width, height };
    this.unit =
      Math.min(Math.max(Math.min(room.width * 0.24, room.height * 0.11), 56), 96) / pixelsPerUnit;
    for (const star of this.stars.values())
      star.group.scale.setScalar((star.input.centre ? LEAD_SIZE : OTHER_SIZE) * this.unit);
    this.invalidate();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.renderer.setAnimationLoop(null);
    this.stopResize();
    this.visibility.disconnect();
    document.removeEventListener("visibilitychange", this.syncLoop);
    this.reducedMotion.removeEventListener("change", this.syncLoop);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.scene.traverse((object) => {
      freeMaterial(object);
      // The far points and the lines between bots own their shape; a bot's parts share theirs.
      if (object.parent === this.scene && "geometry" in object)
        (object.geometry as THREE.BufferGeometry).dispose();
    });
    for (const shared of [
      this.leadGlobe,
      this.otherGlobe,
      this.ringsGeometry,
      this.coreGeometry,
      this.hoopGeometry,
      this.targetGeometry,
    ])
      shared.dispose();
    this.glowTexture.dispose();
    this.sparkTexture.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
