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

/** Where a star is on screen, in CSS pixels from the host's top left. */
export interface StarOnScreen {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

const FRAME_MS = 32;
const SPARKS_SHOWN = 8;
const CAMERA_HOME = new THREE.Vector3(0, 0.5, 12);
const WAITING = new THREE.Color("#ffb347");

const BODY_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uSwell;
uniform float uSeed;
varying vec3 vNormal;
varying vec3 vView;
float wobble(vec3 p) {
  return sin(p.x * 2.1 + uTime * 0.9 + uSeed) * sin(p.y * 2.7 + uTime * 0.7)
    * sin(p.z * 2.3 - uTime * 0.8 + uSeed * 1.7);
}
void main() {
  float lift = wobble(normal * 1.4) + wobble(normal * 3.1 + 2.0) * 0.4;
  vec4 at = modelViewMatrix * vec4(position + normal * lift * uSwell, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-at.xyz);
  gl_Position = projectionMatrix * at;
}`;

const BODY_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uGlow;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float facing = max(dot(normalize(vNormal), vView), 0.0);
  // White-hot in the middle and gone at the rim, so it reads as a light and not a ball.
  float core = pow(facing, 2.2);
  vec3 lit = mix(uColor * 1.25, vec3(1.0), core * 0.9) * uGlow;
  gl_FragColor = vec4(lit, pow(facing, 1.6));
}`;

interface Star {
  readonly group: THREE.Group;
  readonly body: THREE.Mesh<THREE.IcosahedronGeometry, THREE.ShaderMaterial>;
  readonly halo: THREE.Sprite;
  readonly signal: THREE.Sprite;
  readonly sparks: THREE.Sprite[];
  readonly seed: number;
  input: SpaceStar;
  glow: number;
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

function thinRing() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const paint = canvas.getContext("2d")!;
  paint.strokeStyle = "white";
  paint.lineWidth = 3;
  paint.beginPath();
  paint.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  paint.stroke();
  return new THREE.CanvasTexture(canvas);
}

/**
 * The bots as lights in an empty dark: the one you talk to in the middle, the rest around it.
 * Rendering is gated like the anima world's: the loop runs only while the host is on screen, the
 * tab is visible and motion is allowed, at thirty frames a second; otherwise a frame is drawn
 * only when something changes.
 */
export class BotSpaceScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly stars = new Map<string, Star>();
  private readonly glowTexture = softDisc(0.14, 0.5);
  private readonly sparkTexture = softDisc(0.4);
  private readonly ringTexture = thinRing();
  private readonly bodyGeometry = new THREE.IcosahedronGeometry(1, 5);
  private readonly ring: THREE.Sprite;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly lookAt = new THREE.Vector3(0, 0.5, 0);
  private readonly wantLookAt = new THREE.Vector3(0, 0.5, 0);
  private readonly wantCamera = CAMERA_HOME.clone();
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  private readonly stopResize: () => void;
  private readonly visibility: IntersectionObserver;
  private voice: SpaceVoice = { mode: "off", level: 0 };
  /** Read once a frame, so a level that moves twenty times a second never renders React. */
  voiceSource: (() => SpaceVoice) | null = null;
  private heard = 0;
  private focused: string | null = null;
  private hovered: string | null = null;
  private onScreen = true;
  private running = false;
  private disposed = false;
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(0x000000, 1);
    this.canvas = this.renderer.domElement;
    this.canvas.className = "absolute inset-0 size-full";
    this.canvas.setAttribute("aria-hidden", "true");
    host.prepend(this.canvas);
    this.camera.position.copy(CAMERA_HOME);

    this.scene.add(this.distantStars());
    this.ring = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.ringTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(this.ring);

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
      const star = this.stars.get(input.id) ?? this.addStar(input);
      star.input = input;
      const color = new THREE.Color(input.color);
      star.body.material.uniforms.uColor!.value = color;
      star.halo.material.color = color;
      star.group.scale.setScalar(input.centre ? 0.62 : 0.36);
      const shown = Math.min(input.working, SPARKS_SHOWN);
      star.sparks.forEach((spark, index) => {
        spark.visible = index < shown;
        spark.material.color = color;
      });
      star.signal.visible = input.waiting > 0;
    }
    for (const [id, star] of this.stars) {
      if (seen.has(id)) continue;
      this.scene.remove(star.group);
      star.body.material.dispose();
      star.halo.material.dispose();
      star.signal.material.dispose();
      for (const spark of star.sparks) spark.material.dispose();
      this.stars.delete(id);
      this.onPlace(id, null);
    }
    this.invalidate();
  }

  private addStar(input: SpaceStar): Star {
    const group = new THREE.Group();
    const seed = [...input.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 97;
    const body = new THREE.Mesh(
      this.bodyGeometry,
      new THREE.ShaderMaterial({
        vertexShader: BODY_VERTEX,
        fragmentShader: BODY_FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uSwell: { value: 0.05 },
          uSeed: { value: seed },
          uColor: { value: new THREE.Color(input.color) },
          uGlow: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    body.userData.starId = input.id;
    const sprite = (map: THREE.Texture) =>
      new THREE.Sprite(
        new THREE.SpriteMaterial({
          map,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
    const halo = sprite(this.glowTexture);
    halo.scale.setScalar(10);
    const signal = sprite(this.ringTexture);
    signal.material.color = WAITING;
    signal.visible = false;
    const sparks = Array.from({ length: SPARKS_SHOWN }, () => {
      const spark = sprite(this.sparkTexture);
      spark.scale.setScalar(0.5);
      spark.visible = false;
      return spark;
    });
    group.add(halo, body, signal, ...sparks);
    group.position.copy(this.home(input));
    this.scene.add(group);
    const star: Star = { group, body, halo, signal, sparks, seed, input, glow: 1 };
    this.stars.set(input.id, star);
    return star;
  }

  /** Draws again when the loop is not running, after something `voiceSource` reads changed. */
  refresh() {
    this.invalidate();
  }

  private readonly homePoint = new THREE.Vector3();

  /** A place in the view's own proportions, so the bots fill a wide window and fit a narrow one. */
  private home(input: SpaceStar) {
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * CAMERA_HOME.z;
    return this.homePoint.set(
      input.place.x * halfHeight * this.camera.aspect,
      input.place.y * halfHeight + (input.centre ? 0.7 : 0.9),
      input.place.z,
    );
  }

  /** Brings one bot close and to the left, leaving the right of the view for its screen. */
  focus(id: string | null) {
    this.focused = id;
    const star = id === null ? undefined : this.stars.get(id);
    if (star === undefined) {
      this.wantCamera.copy(CAMERA_HOME);
      this.wantLookAt.set(0, 0.5, 0);
    } else {
      const at = this.home(star.input).clone();
      const near = star.input.centre ? 7.5 : 5.2;
      const aside = this.camera.aspect > 1.2 ? near * 0.3 : 0;
      this.wantLookAt.set(at.x + aside, at.y, at.z);
      this.wantCamera.set(at.x + aside, at.y + 0.2, at.z + near);
    }
    if (this.reducedMotion.matches) {
      this.camera.position.copy(this.wantCamera);
      this.lookAt.copy(this.wantLookAt);
    }
    this.invalidate();
  }

  private moving() {
    return (
      this.camera.position.distanceToSquared(this.wantCamera) > 1e-5 ||
      this.lookAt.distanceToSquared(this.wantLookAt) > 1e-5
    );
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
    const ease = delta === 0 ? 1 : 1 - Math.exp(-delta * 3.2);
    if (this.moving()) {
      this.camera.position.lerp(this.wantCamera, ease);
      this.lookAt.lerp(this.wantLookAt, ease);
    }
    this.camera.lookAt(this.lookAt);
    if (this.voiceSource !== null) this.voice = this.voiceSource();
    // The voice's level jumps; the light follows it a little behind so it does not flicker.
    this.heard += (this.voice.level - this.heard) * (delta === 0 ? 1 : Math.min(1, delta * 14));

    for (const star of this.stars.values()) this.drawStar(star);
    this.drawRing();
    try {
      this.renderer.render(this.scene, this.camera);
    } catch {
      this.dispose();
      return;
    }
    this.reportPlaces();
  }

  private drawStar(star: Star) {
    const { input, seed } = star;
    const t = this.time;
    const talking = input.centre && this.voice.mode === "speaking";
    const thinking = input.centre ? this.voice.mode === "thinking" : input.busy;
    const home = this.home(input);
    star.group.position.set(
      home.x + Math.sin(t * 0.23 + seed) * 0.14,
      home.y + Math.sin(t * 0.31 + seed * 1.3) * 0.18,
      home.z + Math.cos(t * 0.19 + seed) * 0.12,
    );
    const lit =
      (input.working > 0 || thinking ? 1.12 : 0.82) +
      (thinking ? Math.sin(t * 3.1) * 0.12 : 0) +
      (talking ? this.heard * 0.7 : 0) +
      (this.hovered === input.id || this.focused === input.id ? 0.16 : 0);
    star.glow += (lit - star.glow) * 0.2;
    const uniforms = star.body.material.uniforms;
    uniforms.uTime!.value = t * (thinking ? 2.4 : 1) + (talking ? this.heard * 2 : 0);
    uniforms.uSwell!.value = 0.05 + (thinking ? 0.05 : 0) + (talking ? this.heard * 0.22 : 0);
    uniforms.uGlow!.value = star.glow;
    star.halo.material.opacity = 0.5 * star.glow;
    star.halo.scale.setScalar(8 + star.glow * 2 + (talking ? this.heard * 4 : 0));
    star.sparks.forEach((spark, index) => {
      if (!spark.visible) return;
      const turn = t * (0.42 + index * 0.05) + index * 2.4 + seed;
      const reach = 2.1 + (index % 3) * 0.42;
      const tilt = 0.5 + index * 0.37;
      spark.position.set(
        Math.cos(turn) * reach,
        Math.sin(turn) * reach * Math.sin(tilt),
        Math.sin(turn) * reach * Math.cos(tilt),
      );
    });
    if (star.signal.visible) {
      const beat = (t * 0.42 + seed * 0.1) % 1;
      star.signal.scale.setScalar(2.6 + beat * 3.4);
      star.signal.material.opacity = (1 - beat) * 0.75;
    }
  }

  private drawRing() {
    const centre = [...this.stars.values()].find((star) => star.input.centre);
    const { mode } = this.voice;
    const shown = centre !== undefined && (mode === "listening" || mode === "hearing");
    const want = shown ? (mode === "hearing" ? 0.85 : 0.3) : 0;
    this.ring.material.opacity += (want - this.ring.material.opacity) * 0.25;
    if (centre === undefined) return;
    this.ring.position.copy(centre.group.position);
    this.ring.material.color = centre.halo.material.color;
    this.ring.scale.setScalar(3.1 + (mode === "hearing" ? this.heard * 1.6 : 0));
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
      [...this.stars.values()].map((star) => star.body),
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
    // A narrow view pulls back so the outer bots stay in frame.
    this.camera.fov = this.camera.aspect < 1 ? 62 : 40;
    this.camera.updateProjectionMatrix();
    this.focus(this.focused);
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
      if (object instanceof THREE.Points) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite)
        (object.material as THREE.Material).dispose();
    });
    this.bodyGeometry.dispose();
    this.glowTexture.dispose();
    this.sparkTexture.dispose();
    this.ringTexture.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
