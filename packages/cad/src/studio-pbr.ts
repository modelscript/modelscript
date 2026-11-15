// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Framework-agnostic studio PBR texture synthesis, aerospace photography
 * cyclorama HDR lighting model, alloy presets, and shared GLSL shaders for
 * ModelScript 3D CAD viewports (Docs Hero, Morsel IDE, and Ansatz).
 */

export type AlloyPresetKey =
  | "al-li-nacelle"
  | "titanium-spinner"
  | "core-cowl"
  | "rotor-drum"
  | "combustor-liner"
  | "titanium-fan"
  | "compressor-blade"
  | "nickel-superalloy"
  | "default-machined";

export interface AlloyMaterialSpec {
  readonly colorDark: number;
  readonly colorLight: number;
  readonly metalness: number;
  readonly roughness: number;
  readonly anisotropy: number;
  readonly anisotropyRotation: number;
  readonly normalScale: readonly [number, number];
  readonly iridescence?: number | undefined;
  readonly iridescenceIOR?: number | undefined;
  readonly iridescenceThicknessRange?: readonly [number, number] | undefined;
  readonly emissiveDark?: number | undefined;
  readonly emissiveLight?: number | undefined;
  readonly emissiveIntensity?: number | undefined;
}

export interface StudioPbrTextureBuffers {
  readonly size: number;
  readonly normalRgba: Uint8Array;
  readonly roughnessRgba: Uint8Array;
  readonly aoWidth: number;
  readonly aoRgba: Uint8Array;
  readonly iridescenceSize: number;
  readonly iridescenceRgba: Uint8Array;
}

export interface StudioSoftboxLobeSpec {
  readonly pos: readonly [number, number, number];
  readonly su: number;
  readonly sv: number;
  readonly color: number;
  readonly intensity: number;
  readonly power: number;
}

export const ALLOY_MATERIAL_PRESETS: Record<AlloyPresetKey, AlloyMaterialSpec> = {
  "al-li-nacelle": {
    colorDark: 0x828890,
    colorLight: 0x8a9098,
    metalness: 0.93,
    roughness: 0.19,
    anisotropy: 0.22,
    anisotropyRotation: Math.PI / 2,
    normalScale: [0.025, 0.01],
  },
  "titanium-spinner": {
    colorDark: 0x646a74,
    colorLight: 0x6e747e,
    metalness: 0.94,
    roughness: 0.17,
    anisotropy: 0.32,
    anisotropyRotation: Math.PI / 2,
    normalScale: [0.035, 0.012],
  },
  "core-cowl": {
    colorDark: 0x8a8e94,
    colorLight: 0x90949c,
    metalness: 0.95,
    roughness: 0.18,
    anisotropy: 0.28,
    anisotropyRotation: Math.PI / 2,
    normalScale: [0.025, 0.01],
    iridescence: 0.18,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [220, 320],
  },
  "rotor-drum": {
    colorDark: 0x989ca4,
    colorLight: 0x9ea2aa,
    metalness: 0.93,
    roughness: 0.21,
    anisotropy: 0.25,
    anisotropyRotation: Math.PI / 2,
    normalScale: [0.028, 0.01],
  },
  "combustor-liner": {
    colorDark: 0xc48e62,
    colorLight: 0xca9468,
    metalness: 0.92,
    roughness: 0.24,
    anisotropy: 0.2,
    anisotropyRotation: Math.PI / 2,
    normalScale: [0.03, 0.012],
    iridescence: 0.26,
    iridescenceIOR: 1.5,
    iridescenceThicknessRange: [260, 420],
    emissiveDark: 0x6b2806,
    emissiveLight: 0x6b2806,
    emissiveIntensity: 0.42,
  },
  "titanium-fan": {
    colorDark: 0x929aa4,
    colorLight: 0x9aa2ac,
    metalness: 0.95,
    roughness: 0.15,
    anisotropy: 0.34,
    anisotropyRotation: Math.PI / 2,
    normalScale: [0.02, 0.008],
  },
  "compressor-blade": {
    colorDark: 0xa2a8b0,
    colorLight: 0xa8aeb6,
    metalness: 0.95,
    roughness: 0.15,
    anisotropy: 0.3,
    anisotropyRotation: Math.PI / 2,
    normalScale: [0.02, 0.008],
  },
  "nickel-superalloy": {
    colorDark: 0xb2967e,
    colorLight: 0xb89e86,
    metalness: 0.93,
    roughness: 0.2,
    anisotropy: 0.24,
    anisotropyRotation: Math.PI / 2,
    normalScale: [0.025, 0.01],
    iridescence: 0.25,
    iridescenceIOR: 1.55,
    iridescenceThicknessRange: [230, 360],
  },
  "default-machined": {
    colorDark: 0x8f9aa8,
    colorLight: 0x8a95a3,
    metalness: 0.88,
    roughness: 0.22,
    anisotropy: 0.24,
    anisotropyRotation: Math.PI / 2,
    normalScale: [0.022, 0.009],
  },
};

/**
 * Classifies a CAD part name (and optional RGBA hint) into a calibrated aerospace
 * alloy PBR preset so generic STEP/SCAD/Modelica viewers match the hero material palette.
 */
export function classifyAlloyPreset(partName?: string | null, colorRgba?: readonly number[]): AlloyPresetKey {
  const name = (partName ?? "").toLowerCase();
  if (/(combust|liner|burner|flame|hot)/.test(name)) return "combustor-liner";
  if (/(turbine|hpt|lpt|nozzle|inconel|superalloy)/.test(name)) return "nickel-superalloy";
  if (/(spinner|cone|hub|nose)/.test(name)) return "titanium-spinner";
  if (/(fan|rotor_1|n1)/.test(name)) return "titanium-fan";
  if (/(compress|hpc|lpc|stator|blade|impeller)/.test(name)) return "compressor-blade";
  if (/(cowl|bypass|duct)/.test(name)) return "core-cowl";
  if (/(drum|shaft|spool|bearing|axis)/.test(name)) return "rotor-drum";
  if (/(nacelle|casing|shroud|housing|flange)/.test(name)) return "al-li-nacelle";

  if (colorRgba && colorRgba.length >= 3) {
    const r = colorRgba[0] ?? 0.5;
    const g = colorRgba[1] ?? 0.5;
    const b = colorRgba[2] ?? 0.5;
    if (r > g + 0.12 && r > b + 0.16) return "combustor-liner";
    if (r > b + 0.06 && g >= b) return "nickel-superalloy";
  }
  return "default-machined";
}

function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

/**
 * Synthesizes high-frequency lathe-turned / brushed alloy normal, roughness,
 * 1D specular-AO, and thin-film oxide iridescence pixel buffers in memory.
 */
export function synthesizeBrushedAlloyTextures(size = 256): StudioPbrTextureBuffers {
  const normalRgba = new Uint8Array(size * size * 4);
  const roughnessRgba = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const rowGrain = (hash2(y, 11.7) - 0.5) * 0.5 + (hash2(y >> 1, 37.1) - 0.5) * 0.35;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const micro = rowGrain * (0.85 + 0.15 * Math.sin(u * 4 + y * 0.31)) + (hash2(x, y) - 0.5) * 0.22;
      height[y * size + x] = micro;
      const rVal = Math.round(Math.min(255, Math.max(0, 210 + micro * 36)));
      const idx = (y * size + x) * 4;
      roughnessRgba[idx] = rVal;
      roughnessRgba[idx + 1] = rVal;
      roughnessRgba[idx + 2] = rVal;
      roughnessRgba[idx + 3] = 255;
    }
  }

  for (let y = 0; y < size; y++) {
    const yPrev = (y - 1 + size) & (size - 1);
    const yNext = (y + 1) & (size - 1);
    for (let x = 0; x < size; x++) {
      const xPrev = (x - 1 + size) & (size - 1);
      const xNext = (x + 1) & (size - 1);
      const dx = (height[y * size + xNext]! - height[y * size + xPrev]!) * 0.35;
      const dy = (height[yNext * size + x]! - height[yPrev * size + x]!) * 0.9;
      const invLen = 1 / Math.hypot(dx, dy, 1);
      const idx = (y * size + x) * 4;
      normalRgba[idx] = Math.round((-dx * invLen * 0.5 + 0.5) * 255);
      normalRgba[idx + 1] = Math.round((-dy * invLen * 0.5 + 0.5) * 255);
      normalRgba[idx + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
      normalRgba[idx + 3] = 255;
    }
  }

  const aoWidth = 64;
  const aoRgba = new Uint8Array(aoWidth * 4);
  for (let i = 0; i < aoWidth; i++) {
    const v = Math.round((i / (aoWidth - 1)) * 255);
    aoRgba[i * 4] = v;
    aoRgba[i * 4 + 1] = v;
    aoRgba[i * 4 + 2] = v;
    aoRgba[i * 4 + 3] = 255;
  }

  const iridescenceSize = 128;
  const iridescenceRgba = new Uint8Array(iridescenceSize * iridescenceSize * 4);
  for (let y = 0; y < iridescenceSize; y++) {
    const v = (y / iridescenceSize) * Math.PI * 2;
    for (let x = 0; x < iridescenceSize; x++) {
      const u = (x / iridescenceSize) * Math.PI * 2;
      const wave =
        0.5 + 0.28 * Math.sin(u * 2 + v * 3) + 0.14 * Math.cos(u * 5 - v * 2) + 0.08 * Math.sin(u * 9 + v * 7);
      const gVal = Math.round(Math.min(255, Math.max(0, wave * 255)));
      const idx = (y * iridescenceSize + x) * 4;
      iridescenceRgba[idx] = gVal;
      iridescenceRgba[idx + 1] = gVal;
      iridescenceRgba[idx + 2] = gVal;
      iridescenceRgba[idx + 3] = 255;
    }
  }

  return {
    size,
    normalRgba,
    roughnessRgba,
    aoWidth,
    aoRgba,
    iridescenceSize,
    iridescenceRgba,
  };
}

export const STUDIO_SOFTBOX_LOBES: readonly StudioSoftboxLobeSpec[] = [
  { pos: [-0.1, 0.72, 0.68], su: 0.85, sv: 0.24, color: 0xfffcf7, intensity: 4.2, power: 1.1 },
  { pos: [-0.2, 0.12, 0.96], su: 0.85, sv: 0.32, color: 0xdbeafe, intensity: 1.35, power: 1.0 },
  { pos: [-0.86, 0.2, 0.46], su: 0.38, sv: 0.38, color: 0xffffff, intensity: 4.0, power: 1.1 },
  { pos: [-0.72, -0.38, 0.56], su: 0.38, sv: 0.32, color: 0xcbd5e1, intensity: 1.9, power: 1.0 },
  { pos: [0.15, 0.7, -0.7], su: 0.82, sv: 0.18, color: 0xbae6fd, intensity: 3.6, power: 1.2 },
  { pos: [0.05, -0.82, 0.56], su: 0.8, sv: 0.24, color: 0xe2e8f0, intensity: 1.75, power: 1.1 },
  { pos: [0.74, 0.22, 0.62], su: 0.42, sv: 0.34, color: 0xf1f5f9, intensity: 2.2, power: 1.0 },
];

interface PreparedLobe {
  dir: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  su: number;
  sv: number;
  power: number;
  r: number;
  g: number;
  b: number;
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function cross3(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function srgbChannelToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

let cachedPreparedLobes: PreparedLobe[] | null = null;

function getPreparedLobes(): PreparedLobe[] {
  if (cachedPreparedLobes) return cachedPreparedLobes;
  cachedPreparedLobes = STUDIO_SOFTBOX_LOBES.map((spec) => {
    const dir = normalize3(spec.pos[0], spec.pos[1], spec.pos[2]);
    let vx = 0;
    let vy = dir[2];
    let vz = -dir[1];
    if (vx * vx + vy * vy + vz * vz < 1e-4) {
      const ref: [number, number, number] = Math.abs(dir[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
      [vx, vy, vz] = cross3(ref, dir);
    }
    const v = normalize3(vx, vy, vz);
    const uRaw = cross3(dir, v);
    const u = normalize3(uRaw[0], uRaw[1], uRaw[2]);
    const r = srgbChannelToLinear((spec.color >> 16) & 0xff) * spec.intensity;
    const g = srgbChannelToLinear((spec.color >> 8) & 0xff) * spec.intensity;
    const b = srgbChannelToLinear(spec.color & 0xff) * spec.intensity;
    return { dir, u, v, su: spec.su, sv: spec.sv, power: spec.power, r, g, b };
  });
  return cachedPreparedLobes;
}

/**
 * Evaluates the studio cyclorama HDR radiance (linear RGB) along unit direction `(dx, dy, dz)`.
 */
export function evaluateStudioDomeColor(dx: number, dy: number, dz: number): [number, number, number] {
  const dir = normalize3(dx, dy, dz);
  const y = dir[1];
  const sky = Math.pow(Math.max(0, y), 1.5);
  const ground = Math.pow(Math.max(0, -y), 1.5);

  let r = 0.06 + 0.12 * sky + 0.07 * ground;
  let g = 0.068 + 0.13 * sky + 0.075 * ground;
  let b = 0.082 + 0.15 * sky + 0.085 * ground;

  for (const l of getPreparedLobes()) {
    const dot = dot3(dir, l.dir);
    if (dot <= 0) continue;
    const du = Math.abs(dot3(dir, l.u) / l.su);
    const dv = Math.abs(dot3(dir, l.v) / l.sv);
    const d2 = du * du + dv * dv;
    const w = Math.exp(-0.5 * Math.pow(d2, l.power)) * dot * dot;
    r += l.r * w;
    g += l.g * w;
    b += l.b * w;
  }

  return [r, g, b];
}

/** Vertex shader for generic stencil-capped cross-section quads in local plane space. */
export const SECTION_CAP_VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorldPos = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** Cross-hatched blueprint section cap fragment shader used on arbitrary stencil-clipped CAD meshes. */
export const SECTION_CAP_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uPitch;
varying vec3 vWorldPos;
void main() {
  float h = (vWorldPos.x + vWorldPos.y + vWorldPos.z) * 0.57735027;
  float period = max(uPitch, 0.01);
  float d = abs(fract(h / period) - 0.5) * period;
#if defined(GL_OES_standard_derivatives) || __VERSION__ >= 300
  float fwH = fwidth(h);
#else
  float fwH = period * 0.08;
#endif
  float hatch = 1.0 - smoothstep(0.0, fwH * 1.35, d - period * 0.08);
  float a = 0.16 + 0.54 * hatch;
  gl_FragColor = vec4(uColor, uOpacity * clamp(a, 0.0, 1.0));
}`;

/** Studio floor grid shaders matching the landing-page hero CAD aesthetic. */
export const STUDIO_GRID_VERTEX_SHADER = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const STUDIO_GRID_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vWorld;
float grid(vec2 p, float size) {
  vec2 q = p / size;
#if defined(GL_OES_standard_derivatives) || __VERSION__ >= 300
  vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
  return 1.0 - min(min(g.x, g.y), 1.0);
#else
  vec2 g = abs(fract(q - 0.5) - 0.5);
  return (g.x < 0.04 || g.y < 0.04) ? 1.0 : 0.0;
#endif
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
