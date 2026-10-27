// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Rendering for the landing-page turbofan hero. Owns the three.js renderer,
// the camera rig, the moving section plane and the DOM callouts. The Vue
// component only wires props / lifecycle to this class.

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  bladeGeometry,
  bladeMatrices,
  bladeWire,
  BODIES,
  CALLOUTS,
  latheGeometry,
  latheWire,
  ROWS,
  sliceBodies,
} from "./geometry";

export type ViewMode = "section" | "wire" | "solid";

export interface CalloutElements {
  label: HTMLElement;
  line: SVGLineElement;
  dot: SVGCircleElement;
}

interface Palette {
  wire: number;
  wireBodyOpacity: number;
  wireBladeOpacity: number;
  accent: number;
  grid: number;
  gridOpacity: number;
  casing: number;
  hub: number;
  blade: number;
  liner: number;
  exposure: number;
}

const PALETTES: Record<"dark" | "light", Palette> = {
  dark: {
    wire: 0x22d3ee,
    wireBodyOpacity: 0.32,
    wireBladeOpacity: 0.42,
    accent: 0x67e8f9,
    grid: 0x22d3ee,
    gridOpacity: 0.22,
    casing: 0x434b55,
    hub: 0x3a414b,
    blade: 0x9aa4b0,
    liner: 0x8a7f74,
    exposure: 1.05,
  },
  light: {
    wire: 0x0e7490,
    wireBodyOpacity: 0.36,
    wireBladeOpacity: 0.55,
    accent: 0x0891b2,
    grid: 0x0e7490,
    gridOpacity: 0.2,
    casing: 0x5a6470,
    hub: 0x4b5562,
    blade: 0xa3adb8,
    liner: 0x8f8377,
    exposure: 0.95,
  },
};

const MAX_INTERVALS = 8;
const SWEEP_MIN = -1.35;
const SWEEP_MAX = 1.95;
const SWEEP_PERIOD = 14;
const MODE_TARGET: Record<Exclude<ViewMode, "section">, number> = { wire: -3.35, solid: 3.45 };
const N1_SPEED = 1.5; // rad/s, display only
const N2_SPEED = 2.4;
const TARGET = new THREE.Vector3(0.12, -0.12, 0);
const BASE_AZIMUTH = 36 * (Math.PI / 180);
const BASE_ELEVATION = 13 * (Math.PI / 180);
const IDLE_YAW = 6 * (Math.PI / 180);

const CAP_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CAP_FRAG = /* glsl */ `
uniform vec2 uIv[${MAX_INTERVALS}];
uniform int uCount;
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vLocal;
void main() {
  float r = length(vLocal.yz);
  float edge = -1.0;
  for (int i = 0; i < ${MAX_INTERVALS}; i++) {
    if (i >= uCount) break;
    vec2 iv = uIv[i];
    if (r >= iv.x && r <= iv.y) edge = min(r - iv.x, iv.y - r);
  }
  if (edge < 0.0) discard;
  float aa = fwidth(r);
  float h = (vLocal.y + vLocal.z) * 0.70710678;
  float period = 0.045;
  float d = abs(fract(h / period) - 0.5) * period;
  float hatch = 1.0 - smoothstep(0.0, fwidth(h) * 1.25, d - 0.0035);
  float border = 1.0 - smoothstep(aa * 0.5, aa * 2.0, edge);
  float a = 0.12 + 0.5 * hatch + 0.88 * border;
  gl_FragColor = vec4(uColor, uOpacity * clamp(a, 0.0, 1.0));
}`;

const GRID_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GRID_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vWorld;
float grid(vec2 p, float size) {
  vec2 q = p / size;
  vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
  return 1.0 - min(min(g.x, g.y), 1.0);
}
void main() {
  vec2 p = vWorld.xz;
  float fine = grid(p, 0.25);
  float major = grid(p, 1.25);
  vec2 e = (p - vec2(0.2, 0.0)) / vec2(5.2, 3.0);
  float fade = 1.0 - smoothstep(0.35, 1.0, length(e));
  float a = (fine * 0.35 + major * 0.9) * fade * uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}`;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

function roundedRect(half: number, radius: number, steps = 6): Float32Array {
  const pts: number[] = [];
  const corners: [number, number, number][] = [
    [half - radius, half - radius, 0],
    [-(half - radius), half - radius, Math.PI / 2],
    [-(half - radius), -(half - radius), Math.PI],
    [half - radius, -(half - radius), (3 * Math.PI) / 2],
  ];
  for (const [cy, cz, a0] of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      pts.push(0, cy + radius * Math.sin(a), cz + radius * Math.cos(a));
    }
  }
  return new Float32Array(pts);
}

export interface TurbineSceneOptions {
  canvas: HTMLCanvasElement;
  callouts: CalloutElements[];
  dark: boolean;
  reducedMotion: boolean;
  onFirstFrame?: () => void;
}

export class TurbineScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(24, 1, 0.5, 60);
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly fog = new THREE.Fog(0x000000, 10, 24);

  private readonly solidPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  private readonly wirePlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);

  private readonly mats: {
    casing: THREE.MeshStandardMaterial;
    hub: THREE.MeshStandardMaterial;
    blade: THREE.MeshStandardMaterial;
    liner: THREE.MeshStandardMaterial;
    wireBody: THREE.LineBasicMaterial;
    wireBlade: THREE.LineBasicMaterial;
    contour: THREE.LineBasicMaterial;
    frame: THREE.LineBasicMaterial;
    frameFill: THREE.MeshBasicMaterial;
    cap: THREE.ShaderMaterial;
    grid: THREE.ShaderMaterial;
  };

  private readonly n1 = new THREE.Group();
  private readonly n2 = new THREE.Group();
  private readonly section = new THREE.Group();
  private readonly contours: THREE.LineLoop[] = [];
  private readonly intervals = new Float32Array(MAX_INTERVALS * 2);
  private readonly capIv: THREE.Vector2[] = Array.from({ length: MAX_INTERVALS }, () => new THREE.Vector2());
  private readonly capUniforms = {
    uIv: { value: this.capIv },
    uCount: { value: 0 },
    uColor: { value: new THREE.Color() },
    uOpacity: { value: 1 },
  };
  private readonly gridUniforms = { uColor: { value: new THREE.Color() }, uOpacity: { value: 1 } };

  private readonly callouts: CalloutElements[];
  private readonly anchors = CALLOUTS.map((c) => new THREE.Vector3(...c.anchor));
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  private mode: ViewMode = "section";
  private paused = false;
  private reducedMotion: boolean;
  private dark: boolean;

  private s = 0.2;
  private time = 0;
  private last = 0;
  private raf = 0;
  private visible = true;
  private disposed = false;
  private firstFrame = true;
  private onFirstFrame: (() => void) | undefined;
  private width = 1;
  private height = 1;
  private distance = 16;

  private dragAz = 0;
  private dragEl = 0;
  private dragging = false;
  private dragPointer = -1;
  private dragX = 0;
  private dragY = 0;
  private releasedAt = -Infinity;

  constructor(opts: TurbineSceneOptions) {
    this.callouts = opts.callouts;
    this.dark = opts.dark;
    this.reducedMotion = opts.reducedMotion;
    this.onFirstFrame = opts.onFirstFrame;

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setClearColor(0x000000, 0);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = this.pmrem.fromScene(room, 0.04).texture;
    room.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.scene.fog = this.fog;

    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-4, 6, 5);
    this.scene.add(key);

    const solid = (color: number, metalness: number, roughness: number) =>
      new THREE.MeshStandardMaterial({
        color,
        metalness,
        roughness,
        side: THREE.DoubleSide,
        clippingPlanes: [this.solidPlane],
        fog: false,
        envMapIntensity: 0.65,
      });
    const line = (opacity: number) =>
      new THREE.LineBasicMaterial({
        transparent: true,
        opacity,
        depthWrite: false,
        clippingPlanes: [this.wirePlane],
      });

    const pal = PALETTES[this.dark ? "dark" : "light"];
    this.mats = {
      casing: solid(pal.casing, 0.6, 0.5),
      hub: solid(pal.hub, 0.6, 0.38),
      blade: solid(pal.blade, 0.85, 0.3),
      liner: solid(pal.liner, 0.6, 0.45),
      wireBody: line(pal.wireBodyOpacity),
      wireBlade: line(pal.wireBladeOpacity),
      contour: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95, fog: false }),
      frame: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, fog: false }),
      frameFill: new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.045,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
      cap: new THREE.ShaderMaterial({
        vertexShader: CAP_VERT,
        fragmentShader: CAP_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: this.capUniforms,
      }),
      grid: new THREE.ShaderMaterial({
        vertexShader: GRID_VERT,
        fragmentShader: GRID_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: this.gridUniforms,
      }),
    };

    this.build();
    this.applyTheme();

    opts.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  // ── Construction ────────────────────────────────────────────────────

  private build(): void {
    const engine = new THREE.Group();
    this.scene.add(engine, this.n1, this.n2, this.section);

    for (const body of BODIES) {
      const parent = body.spool === "n1" ? this.n1 : body.spool === "n2" ? this.n2 : engine;
      parent.add(new THREE.Mesh(latheGeometry(body.profile, body.segments), this.mats[body.material]));
      const wire = new THREE.BufferGeometry();
      wire.setAttribute("position", new THREE.BufferAttribute(latheWire(body.profile, body.meridians), 3));
      parent.add(new THREE.LineSegments(wire, this.mats.wireBody));
    }

    for (const row of ROWS) {
      const parent = row.spool === "n1" ? this.n1 : row.spool === "n2" ? this.n2 : engine;
      const mats = bladeMatrices(row);
      const mesh = new THREE.InstancedMesh(bladeGeometry(row), this.mats.blade, mats.length);
      mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      parent.add(mesh);
      const wire = new THREE.BufferGeometry();
      wire.setAttribute("position", new THREE.BufferAttribute(bladeWire(row), 3));
      parent.add(new THREE.LineSegments(wire, this.mats.wireBlade));
    }

    // Section cap (hatched), contour rings and cut-plane frame.
    const capGeo = new THREE.PlaneGeometry(3.4, 3.4);
    capGeo.rotateY(Math.PI / 2);
    this.section.add(new THREE.Mesh(capGeo, this.mats.cap));

    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(0, Math.cos(a), Math.sin(a)));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
    for (let i = 0; i < MAX_INTERVALS * 2; i++) {
      const ring = new THREE.LineLoop(ringGeo, this.mats.contour);
      ring.visible = false;
      this.contours.push(ring);
      this.section.add(ring);
    }

    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute("position", new THREE.BufferAttribute(roundedRect(1.82, 0.12), 3));
    this.section.add(new THREE.LineLoop(frameGeo, this.mats.frame));
    const fillGeo = new THREE.PlaneGeometry(3.64, 3.64);
    fillGeo.rotateY(Math.PI / 2);
    this.section.add(new THREE.Mesh(fillGeo, this.mats.frameFill));

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), this.mats.grid);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0.2, -1.92, 0);
    floor.renderOrder = -1;
    this.scene.add(floor);
  }

  // ── Public API ──────────────────────────────────────────────────────

  setMode(mode: ViewMode): void {
    this.mode = mode;
    this.wake();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.wake();
  }

  setDark(dark: boolean): void {
    this.dark = dark;
    this.applyTheme();
    this.wake();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.wake();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.wake();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Fit the engine plus label head-room inside both frustum extents.
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanH = tanV * this.camera.aspect;
    this.distance = Math.max(3.75 / tanH, 2.45 / tanV);
    this.camera.near = this.distance - 8;
    this.camera.far = this.distance + 12;
    this.camera.updateProjectionMatrix();
    this.fog.near = this.distance - 1.5;
    this.fog.far = this.distance + 6;
    this.wake();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    document.removeEventListener("visibilitychange", this.onVisibility);
    const geos = new Set<THREE.BufferGeometry>();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line) geos.add(o.geometry);
    });
    geos.forEach((g) => g.dispose());
    Object.values(this.mats).forEach((m) => m.dispose());
    this.scene.environment?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }

  // ── Theme ───────────────────────────────────────────────────────────

  private applyTheme(): void {
    const pal = PALETTES[this.dark ? "dark" : "light"];
    const m = this.mats;
    m.casing.color.setHex(pal.casing);
    m.hub.color.setHex(pal.hub);
    m.blade.color.setHex(pal.blade);
    m.liner.color.setHex(pal.liner);
    m.wireBody.color.setHex(pal.wire);
    m.wireBody.opacity = pal.wireBodyOpacity;
    m.wireBlade.color.setHex(pal.wire);
    m.wireBlade.opacity = pal.wireBladeOpacity;
    m.contour.color.setHex(pal.accent);
    m.frame.color.setHex(pal.wire);
    m.frameFill.color.setHex(pal.wire);
    this.capUniforms.uColor.value.setHex(pal.accent);
    this.gridUniforms.uColor.value.setHex(pal.grid);
    this.gridUniforms.uOpacity.value = pal.gridOpacity;
    this.renderer.toneMappingExposure = pal.exposure;

    // Fog fades distant feature lines into the page background.
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--vp-c-bg").trim();
    this.fog.color.set(bg || (this.dark ? "#1b1b1f" : "#ffffff"));
  }

  // ── Interaction ─────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.dragging = true;
    this.dragPointer = e.pointerId;
    this.dragX = e.clientX;
    this.dragY = e.clientY;
    this.wake();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging || e.pointerId !== this.dragPointer) return;
    const dx = e.clientX - this.dragX;
    const dy = e.clientY - this.dragY;
    this.dragX = e.clientX;
    this.dragY = e.clientY;
    this.dragAz = THREE.MathUtils.clamp(this.dragAz - dx * 0.006, -1.1, 1.6);
    this.dragEl = THREE.MathUtils.clamp(this.dragEl + dy * 0.004, -0.2, 0.5);
    this.wake();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.dragging || e.pointerId !== this.dragPointer) return;
    this.dragging = false;
    this.releasedAt = performance.now();
    this.wake();
  };

  private readonly onVisibility = (): void => {
    if (!document.hidden) this.wake();
  };

  // ── Loop ────────────────────────────────────────────────────────────

  private wake(): void {
    if (this.disposed || this.raf || !this.visible || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.raf = 0;
    if (this.disposed) return;
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    const animate = !this.paused && !this.reducedMotion;

    if (animate) {
      this.time += dt;
      this.n1.rotation.x += N1_SPEED * dt;
      this.n2.rotation.x += N2_SPEED * dt;
    }

    // Section plane position.
    let target: number;
    if (this.mode === "section") {
      const phase = this.reducedMotion ? 0.47 : 0.5 - 0.5 * Math.cos((this.time / SWEEP_PERIOD) * Math.PI * 2);
      target = SWEEP_MIN + (SWEEP_MAX - SWEEP_MIN) * phase;
    } else {
      target = MODE_TARGET[this.mode];
    }
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 3.2);
    this.s += (target - this.s) * k;
    const sSettled = Math.abs(target - this.s) < 1e-4;
    if (sSettled) this.s = target;

    // Camera: idle yaw + user drag that springs back after release.
    if (!this.dragging && now - this.releasedAt > 2600) {
      const decay = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 2.2);
      this.dragAz -= this.dragAz * decay;
      this.dragEl -= this.dragEl * decay;
      if (Math.abs(this.dragAz) < 1e-4) this.dragAz = 0;
      if (Math.abs(this.dragEl) < 1e-4) this.dragEl = 0;
    }
    const idle = this.reducedMotion ? 0 : IDLE_YAW * Math.sin((this.time / 18) * Math.PI * 2);
    const az = BASE_AZIMUTH + idle + this.dragAz;
    const el = BASE_ELEVATION + this.dragEl;
    this.camera.position.set(
      TARGET.x - Math.sin(az) * Math.cos(el) * this.distance,
      TARGET.y + Math.sin(el) * this.distance,
      TARGET.z + Math.cos(az) * Math.cos(el) * this.distance,
    );
    this.camera.lookAt(TARGET);

    this.updateSection();
    this.renderer.render(this.scene, this.camera);
    this.updateCallouts();

    if (this.firstFrame) {
      this.firstFrame = false;
      this.onFirstFrame?.();
    }

    const cameraSettled = !this.dragging && this.dragAz === 0 && this.dragEl === 0;
    const keepGoing = animate || !sSettled || !cameraSettled;
    if (keepGoing) this.wake();
  };

  private updateSection(): void {
    const s = this.s;
    this.solidPlane.constant = s;
    this.wirePlane.constant = -s;
    this.section.position.x = s;

    // Fade the section furniture out when the plane leaves the engine.
    const inside = smoothstep(-3.2, -2.75, s) * (1 - smoothstep(2.9, 3.35, s));
    this.section.visible = inside > 0.001;
    this.mats.frame.opacity = 0.55 * inside;
    this.mats.frameFill.opacity = 0.045 * inside;
    this.mats.contour.opacity = 0.95 * inside;
    this.capUniforms.uOpacity.value = inside;

    const n = sliceBodies(s, this.intervals, MAX_INTERVALS);
    for (let i = 0; i < MAX_INTERVALS; i++) {
      this.capIv[i]!.set(this.intervals[i * 2]!, this.intervals[i * 2 + 1]!);
    }
    this.capUniforms.uCount.value = n;
    for (let i = 0; i < this.contours.length; i++) {
      const ring = this.contours[i]!;
      const iv = i >> 1;
      const r = iv < n ? this.intervals[i]! : 0;
      ring.visible = iv < n && r > 0.02;
      ring.scale.setScalar(r);
    }
  }

  private updateCallouts(): void {
    const w = this.width;
    const h = this.height;
    for (let i = 0; i < CALLOUTS.length; i++) {
      const c = CALLOUTS[i]!;
      const els = this.callouts[i];
      if (!els) continue;
      // Interior parts are only labelled once the section has revealed them.
      const reveal = c.key === "fan" ? 1 : smoothstep(0.02, 0.22, c.x - this.s);
      const p = this.tmp.copy(this.anchors[i]!).project(this.camera);
      const ax = (p.x * 0.5 + 0.5) * w;
      const ay = (-p.y * 0.5 + 0.5) * h;
      const q = this.tmp2.set(c.anchor[0], c.side < 0 ? 1.95 : -1.95, 0).project(this.camera);
      const ly = (-q.y * 0.5 + 0.5) * h + (c.side < 0 ? -6 : 6);
      els.line.setAttribute("x1", ax.toFixed(1));
      els.line.setAttribute("y1", ay.toFixed(1));
      els.line.setAttribute("x2", ax.toFixed(1));
      els.line.setAttribute("y2", ly.toFixed(1));
      els.dot.setAttribute("cx", ax.toFixed(1));
      els.dot.setAttribute("cy", ay.toFixed(1));
      const op = reveal.toFixed(3);
      els.line.style.opacity = op;
      els.dot.style.opacity = op;
      els.label.style.opacity = op;
      els.label.style.transform = `translate(${ax.toFixed(1)}px, ${ly.toFixed(1)}px) translate(-50%, ${
        c.side < 0 ? "-100%" : "0"
      })`;
    }
  }
}
