// SPDX-License-Identifier: AGPL-3.0-or-later

import * as THREE from "three";
import type { RotundaEnvironmentId } from "./types.js";

/**
 * Self-contained, zero-asset procedural PBR material map & equirectangular HDRI
 * synthesizer for the Engineering Rotunda VR workstation.
 *
 * Uses pure typed-array `THREE.DataTexture` synthesis (no DOM canvas needed for
 * PBR or HDRI generation) so it is 100% offline, deterministic, SSR/JSDOM-safe,
 * and stereo-friendly at 72 FPS on Meta Quest 2.
 */

export interface PbrTextureSet {
  readonly map: THREE.DataTexture;
  readonly normalMap: THREE.DataTexture;
  readonly roughnessMap: THREE.DataTexture;
  dispose(): void;
}

export interface RotundaHdriBundle {
  readonly skyTexture: THREE.DataTexture;
  readonly envMap: THREE.Texture | null;
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/*  Seamless Periodic Noise & Height-to-Normal Utilities                      */
/* -------------------------------------------------------------------------- */

function hashInt2(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp255(v: number): number {
  const n = Math.round(v);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

/** Seamless periodic 2D value noise over `[0, period)` in both X and Y. */
function periodicNoise2d(x: number, y: number, periodX: number, periodY: number, seed: number): number {
  const px = Math.max(1, Math.round(periodX));
  const py = Math.max(1, Math.round(periodY));
  const fx = ((x % px) + px) % px;
  const fy = ((y % py) + py) % py;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fade(fx - ix);
  const ty = fade(fy - iy);
  const ix1 = (ix + 1) % px;
  const iy1 = (iy + 1) % py;

  const v00 = hashInt2(ix, iy, seed);
  const v10 = hashInt2(ix1, iy, seed);
  const v01 = hashInt2(ix, iy1, seed);
  const v11 = hashInt2(ix1, iy1, seed);

  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
}

/** Seamless multi-octave fBm noise over normalized UV `(u, v)` in `[0, 1)`. */
function tileableFbm(
  u: number,
  v: number,
  baseFreqX: number,
  baseFreqY: number,
  octaves: number,
  seed: number,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = baseFreqX;
  let fy = baseFreqY;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise2d(u * fx, v * fy, fx, fy, seed + o * 31);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return norm > 0 ? sum / norm : 0.5;
}

function configureMapTexture(
  data: Uint8Array,
  width: number,
  height: number,
  repeatX: number,
  repeatY: number,
  isColor: boolean,
  anisotropy = 4,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Converts a seamless scalar heightfield `[0, 1]` into a tangent-space RGB normal map
 * using periodic central Sobel differences.
 */
function buildNormalDataFromHeight(height: Float32Array, size: number, strength: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;

      const tl = height[ym * size + xm]!;
      const t = height[ym * size + x]!;
      const tr = height[ym * size + xp]!;
      const l = height[y * size + xm]!;
      const r = height[y * size + xp]!;
      const bl = height[yp * size + xm]!;
      const b = height[yp * size + x]!;
      const br = height[yp * size + xp]!;

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const nx = -dx;
      const ny = -dy;
      const nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);

      const idx = (y * size + x) * 4;
      out[idx] = clamp255((nx * invLen * 0.5 + 0.5) * 255);
      out[idx + 1] = clamp255((ny * invLen * 0.5 + 0.5) * 255);
      out[idx + 2] = clamp255((nz * invLen * 0.5 + 0.5) * 255);
      out[idx + 3] = 255;
    }
  }
  return out;
}

function wrapPbrSet(
  albedo: Uint8Array,
  height: Float32Array,
  roughness: Uint8Array,
  size: number,
  normalStrength: number,
  repeatX: number,
  repeatY: number,
  anisotropy = 4,
): PbrTextureSet {
  const normalData = buildNormalDataFromHeight(height, size, normalStrength);
  const map = configureMapTexture(albedo, size, size, repeatX, repeatY, true, anisotropy);
  const normalMap = configureMapTexture(normalData, size, size, repeatX, repeatY, false, anisotropy);
  const roughnessMap = configureMapTexture(roughness, size, size, repeatX, repeatY, false, anisotropy);
  return {
    map,
    normalMap,
    roughnessMap,
    dispose() {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Photorealistic Procedural PBR Material Sets                               */
/* -------------------------------------------------------------------------- */

/**
 * Polished architectural factory concrete (`warehouse`):
 * trowel swirls, subtle mineral aggregate, chamfered expansion joints,
 * and specular polish variation (`roughness 0.24..0.72`).
 */
export function createPolishedConcretePbr(repeatX = 14, repeatY = 14, size = 256): PbrTextureSet {
  const albedo = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = y * size + x;
      const p = idx * 4;

      const trowel = tileableFbm(u, v, 3, 3, 4, 17);
      const micro = tileableFbm(u, v, 16, 16, 3, 43);
      const speck = hashInt2(x, y, 91) - 0.5;
      const sheenPatch = tileableFbm(u + 0.13, v + 0.27, 2, 2, 3, 105);

      // Chamfered control-joint groove along slab boundary + subtle mid-slab saw cut
      const distEdgeX = Math.min(x, size - 1 - x);
      const distEdgeY = Math.min(y, size - 1 - y);
      const jointDist = Math.min(distEdgeX, distEdgeY);
      const jointFactor = jointDist < 3 ? 1 - jointDist / 3 : 0;

      const base = 186 + (trowel - 0.5) * 34 + (micro - 0.5) * 14 + speck * 8 - jointFactor * 42;
      albedo[p] = clamp255(base - 3);
      albedo[p + 1] = clamp255(base + 1);
      albedo[p + 2] = clamp255(base + 7);
      albedo[p + 3] = 255;

      // Heightfield: polished flats + fine aggregate + recessed saw-cut joints
      height[idx] = clamp01(0.55 + (trowel - 0.5) * 0.14 + (micro - 0.5) * 0.16 + speck * 0.04 - jointFactor * 0.45);

      // Roughness: glossy troweled patches reflect skylights; joints & porous flecks stay matte
      const roughVal = clamp01(0.28 + sheenPatch * 0.26 + (micro - 0.5) * 0.12 + jointFactor * 0.42);
      const rByte = clamp255(roughVal * 255);
      roughness[p] = rByte;
      roughness[p + 1] = rByte;
      roughness[p + 2] = rByte;
      roughness[p + 3] = 255;
    }
  }

  return wrapPbrSet(albedo, height, roughness, size, 1.85, repeatX, repeatY, 4);
}

/**
 * Honed architectural travertine / warm limestone tiles (`office`):
 * sedimentary veins, subtle travertine pits, staggered slab joints, and satin honed sheen.
 */
export function createHonedTravertinePbr(repeatX = 14, repeatY = 14, size = 256): PbrTextureSet {
  const albedo = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const half = size >> 1;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    const rowIdx = y >= half ? 1 : 0;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = y * size + x;
      const p = idx * 4;

      // Staggered ashlar tile coordinates
      const tileX = (x + rowIdx * (half >> 1)) % half;
      const tileY = y % half;
      const tileIdX = Math.floor(((x + rowIdx * (half >> 1)) % size) / half);
      const tileTone = (hashInt2(tileIdX, rowIdx, 211) - 0.5) * 10;

      const edgeX = Math.min(tileX, half - 1 - tileX);
      const edgeY = Math.min(tileY, half - 1 - tileY);
      const groutDist = Math.min(edgeX, edgeY);
      const grout = groutDist < 2 ? 1 - groutDist / 2 : 0;

      // Directional sedimentary limestone veining
      const warp = tileableFbm(u, v, 3, 3, 3, 59) * 0.18;
      const vein = Math.sin((v + warp) * Math.PI * 10) * 0.5 + 0.5;
      const mineral = tileableFbm(u, v, 10, 6, 4, 83);
      const poreNoise = tileableFbm(u, v, 24, 14, 2, 137);
      const pit = poreNoise < 0.24 ? (0.24 - poreNoise) * 2.2 : 0;

      const warmBase = 228 + tileTone + (vein - 0.5) * 16 + (mineral - 0.5) * 12 - pit * 22 - grout * 36;
      albedo[p] = clamp255(warmBase + 7);
      albedo[p + 1] = clamp255(warmBase + 2);
      albedo[p + 2] = clamp255(warmBase - 8);
      albedo[p + 3] = 255;

      height[idx] = clamp01(0.62 + (vein - 0.5) * 0.06 + (mineral - 0.5) * 0.08 - pit * 0.28 - grout * 0.42);

      // Honed limestone reflects soft studio skylights; pits & grout stay matte
      const roughVal = clamp01(0.32 + (1 - vein) * 0.14 + pit * 0.35 + grout * 0.48);
      const rByte = clamp255(roughVal * 255);
      roughness[p] = rByte;
      roughness[p + 1] = rByte;
      roughness[p + 2] = rByte;
      roughness[p + 3] = 255;
    }
  }

  return wrapPbrSet(albedo, height, roughness, size, 1.55, repeatX, repeatY, 4);
}

/**
 * Natural architectural white-oak timber PBR (`office` acoustic louvers):
 * directional wood fibers, subtle warm grain rings, and oiled satin sheen.
 */
export function createArchitecturalWoodPbr(repeatX = 1, repeatY = 2, size = 128): PbrTextureSet {
  const albedo = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = y * size + x;
      const p = idx * 4;

      const warp = tileableFbm(u, v, 2, 1, 3, 307) * 0.25;
      const ring = Math.sin((u * 9 + warp * 5) * Math.PI * 2) * 0.5 + 0.5;
      const fiber = tileableFbm(u, v, 32, 4, 3, 331);

      const grain = ring * 0.65 + fiber * 0.35;
      albedo[p] = clamp255(184 + grain * 42);
      albedo[p + 1] = clamp255(142 + grain * 36);
      albedo[p + 2] = clamp255(96 + grain * 28);
      albedo[p + 3] = 255;

      height[idx] = clamp01(0.5 + (fiber - 0.5) * 0.22 + (ring - 0.5) * 0.1);

      const roughVal = clamp01(0.42 + (1 - fiber) * 0.2);
      const rByte = clamp255(roughVal * 255);
      roughness[p] = rByte;
      roughness[p + 1] = rByte;
      roughness[p + 2] = rByte;
      roughness[p + 3] = 255;
    }
  }

  return wrapPbrSet(albedo, height, roughness, size, 1.15, repeatX, repeatY, 4);
}

/**
 * Photographic natural meadow turf PBR (`outdoors` rolling terrain):
 * muted organic sage/emerald/clover variation + micro grass-blade normal relief
 * so terrain reads like sunlit natural grass instead of flat vertex-colored plastic.
 */
export function createMeadowGrassPbr(repeatX = 36, repeatY = 36, size = 256): PbrTextureSet {
  const albedo = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = y * size + x;
      const p = idx * 4;

      const clump = tileableFbm(u, v, 5, 5, 4, 401);
      const blades = tileableFbm(u, v, 32, 18, 3, 419);
      const fine = hashInt2(x, y, 433);
      const dryStraw = clump > 0.64 ? (clump - 0.64) * 1.9 : 0;

      // Muted, realistic sunlit alpine meadow palette (avoids cartoon neon green)
      const r = 92 + clump * 34 + blades * 18 + dryStraw * 44 + (fine - 0.5) * 14;
      const g = 124 + clump * 38 + blades * 24 + dryStraw * 22 + (fine - 0.5) * 16;
      const b = 62 + clump * 16 + blades * 10 + (fine - 0.5) * 10;

      albedo[p] = clamp255(r);
      albedo[p + 1] = clamp255(g);
      albedo[p + 2] = clamp255(b);
      albedo[p + 3] = 255;

      height[idx] = clamp01(0.35 + clump * 0.22 + blades * 0.32 + fine * 0.11);

      const roughVal = clamp01(0.76 + (1 - blades) * 0.16 + dryStraw * 0.08);
      const rByte = clamp255(roughVal * 255);
      roughness[p] = rByte;
      roughness[p + 1] = rByte;
      roughness[p + 2] = rByte;
      roughness[p + 3] = 255;
    }
  }

  return wrapPbrSet(albedo, height, roughness, size, 2.35, repeatX, repeatY, 4);
}

/**
 * Broom-finished architectural precast concrete / natural stone apron (`outdoors` proving pad):
 * directional broom streaks, fine quartz aggregate, and chamfered expansion seams.
 */
export function createProvingPadStonePbr(repeatX = 4, repeatY = 4, size = 256): PbrTextureSet {
  const albedo = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const half = size >> 1;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = y * size + x;
      const p = idx * 4;

      const broom = tileableFbm(u, v, 4, 28, 3, 503);
      const mineral = tileableFbm(u, v, 14, 14, 3, 521);
      const grit = hashInt2(x, y, 541) - 0.5;

      const distX = Math.min(x % half, half - 1 - (x % half));
      const distY = Math.min(y % half, half - 1 - (y % half));
      const seam = Math.min(distX, distY) < 2 ? 1 - Math.min(distX, distY) / 2 : 0;

      const base = 214 + (mineral - 0.5) * 18 + (broom - 0.5) * 12 + grit * 11 - seam * 34;
      albedo[p] = clamp255(base + 2);
      albedo[p + 1] = clamp255(base + 1);
      albedo[p + 2] = clamp255(base - 2);
      albedo[p + 3] = 255;

      height[idx] = clamp01(0.55 + (broom - 0.5) * 0.18 + (mineral - 0.5) * 0.12 + grit * 0.06 - seam * 0.42);

      const roughVal = clamp01(0.58 + (1 - mineral) * 0.16 + seam * 0.24);
      const rByte = clamp255(roughVal * 255);
      roughness[p] = rByte;
      roughness[p + 1] = rByte;
      roughness[p + 2] = rByte;
      roughness[p + 3] = 255;
    }
  }

  return wrapPbrSet(albedo, height, roughness, size, 1.9, repeatX, repeatY, 4);
}

/**
 * Honed obsidian basalt metrology floor (`dark-lab`):
 * deep slate-charcoal granite sheen that catches subtle cyan/indigo overhead softbox reflections.
 */
export function createDarkBasaltPbr(repeatX = 16, repeatY = 16, size = 256): PbrTextureSet {
  const albedo = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = y * size + x;
      const p = idx * 4;

      const macro = tileableFbm(u, v, 3, 3, 4, 601);
      const grain = tileableFbm(u, v, 18, 18, 3, 619);
      const seam = Math.min(x, size - 1 - x, y, size - 1 - y) < 2 ? 1 : 0;

      const base = 18 + macro * 14 + (grain - 0.5) * 7 - seam * 6;
      albedo[p] = clamp255(base);
      albedo[p + 1] = clamp255(base + 3);
      albedo[p + 2] = clamp255(base + 8);
      albedo[p + 3] = 255;

      height[idx] = clamp01(0.55 + (macro - 0.5) * 0.12 + (grain - 0.5) * 0.14 - seam * 0.36);

      // Satin-honed dark stone catches soft HDRI strip highlights cleanly
      const roughVal = clamp01(0.26 + macro * 0.24 + seam * 0.38);
      const rByte = clamp255(roughVal * 255);
      roughness[p] = rByte;
      roughness[p + 1] = rByte;
      roughness[p + 2] = rByte;
      roughness[p + 3] = 255;
    }
  }

  return wrapPbrSet(albedo, height, roughness, size, 1.35, repeatX, repeatY, 4);
}

/**
 * CNC bead-blasted & micro-brushed anodized aluminum PBR (`DraftingPodium` & `TurntableCarousel`):
 * crisp anisotropic hairline brush strokes + subtle machined specular variation.
 */
export function createBrushedAluminumPbr(repeatX = 2, repeatY = 2, baseHex = "#b8c4d2", size = 128): PbrTextureSet {
  const albedo = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const baseColor = new THREE.Color(baseHex);
  const br = baseColor.r * 255;
  const bg = baseColor.g * 255;
  const bb = baseColor.b * 255;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = y * size + x;
      const p = idx * 4;

      const brush = tileableFbm(u, v, 4, 48, 3, 709);
      const bead = hashInt2(x, y, 733) - 0.5;
      const delta = (brush - 0.5) * 20 + bead * 6;

      albedo[p] = clamp255(br + delta);
      albedo[p + 1] = clamp255(bg + delta);
      albedo[p + 2] = clamp255(bb + delta);
      albedo[p + 3] = 255;

      height[idx] = clamp01(0.5 + (brush - 0.5) * 0.34 + bead * 0.08);

      const roughVal = clamp01(0.22 + (1 - brush) * 0.18 + bead * 0.04);
      const rByte = clamp255(roughVal * 255);
      roughness[p] = rByte;
      roughness[p + 1] = rByte;
      roughness[p + 2] = rByte;
      roughness[p + 3] = 255;
    }
  }

  return wrapPbrSet(albedo, height, roughness, size, 1.05, repeatX, repeatY, 4);
}

/**
 * Machined diamond-knurled metal normal map for the interactive grab-to-spin plinth rim.
 */
export function createKnurledMetalNormalMap(repeatX = 36, repeatY = 2, size = 64): THREE.DataTexture {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const d1 = Math.abs((((u + v) * 4) % 1) - 0.5) * 2;
      const d2 = Math.abs((((u - v + 4) * 4) % 1) - 0.5) * 2;
      // Diamond pyramid ridges along outer band
      const band = Math.sin(v * Math.PI);
      height[y * size + x] = clamp01(0.5 + (Math.min(d1, d2) - 0.5) * 0.72 * band);
    }
  }
  const normalData = buildNormalDataFromHeight(height, size, 2.2);
  return configureMapTexture(normalData, size, size, repeatX, repeatY, false, 4);
}

/**
 * Pure DataTexture soft radial ambient-occlusion / contact-shadow decal (works in SSR, JSDOM, WebGL & Quest 2).
 */
export function createRadialContactShadowTexture(centerAlpha = 0.44, midAlpha = 0.22, size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) * 0.5;
  for (let y = 0; y < size; y++) {
    const dy = (y - half) / half;
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half;
      const r = Math.min(1, Math.hypot(dx, dy));
      let a = 0;
      if (r < 0.45) {
        a = lerp(centerAlpha, midAlpha, r / 0.45);
      } else {
        const t = (r - 0.45) / 0.55;
        a = midAlpha * (1 - t) * (1 - t);
      }
      const idx = (y * size + x) * 4;
      data[idx] = 10;
      data[idx + 1] = 15;
      data[idx + 2] = 28;
      data[idx + 3] = clamp255(clamp01(a) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/* -------------------------------------------------------------------------- */
/*  Environment-Matched Procedural Equirectangular Sky & Studio HDRI + PMREM  */
/* -------------------------------------------------------------------------- */

/**
 * Synthesizes an environment-matched equirectangular HDRI texture (`512×256` RGBA Float/Byte)
 * with realistic physical softbox lighting or Rayleigh+Mie atmospheric sky & volumetric clouds,
 * and bakes a zero-per-frame-cost PMREM specular reflection cubemap (`envMap`) for WebXR & Desktop.
 */
export function createRotundaEnvironmentHdri(
  renderer: THREE.WebGLRenderer | null,
  environment: RotundaEnvironmentId,
): RotundaHdriBundle {
  const width = 512;
  const height = 256;
  const pixels = new Uint8Array(width * height * 4);

  const sunDir = new THREE.Vector3(0.54, 0.56, -0.62).normalize();
  const dir = new THREE.Vector3();

  for (let y = 0; y < height; y++) {
    // Three.js DataTexture row 0 is bottom (v=0 -> -Y), row height-1 is top (v=1 -> +Y)
    const v = (y + 0.5) / height;
    const phi = (1 - v) * Math.PI; // 0 = zenith (+Y), PI = nadir (-Y)
    const sinPhi = Math.sin(phi);
    const ny = Math.cos(phi);

    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const theta = (u - 0.5) * Math.PI * 2;
      const nx = Math.cos(theta) * sinPhi;
      const nz = Math.sin(theta) * sinPhi;
      dir.set(nx, ny, nz);

      let r = 0.5;
      let g = 0.5;
      let b = 0.5;

      if (environment === "outdoors") {
        // Physically inspired Rayleigh + Mie daylight sky + layered volumetric clouds + hazy distant ridge
        if (ny >= 0) {
          const elev = Math.pow(clamp01(ny), 0.55);
          // Deep clear azure zenith -> luminous warm-cool horizon haze
          r = lerp(0.84, 0.21, elev);
          g = lerp(0.91, 0.49, elev);
          b = lerp(0.97, 0.87, elev);

          // Mie forward scattering solar halo + crisp warm solar disc
          const sunDot = Math.max(0, dir.dot(sunDir));
          const mieBroad = Math.pow(sunDot, 5) * 0.24 * (1 - ny * 0.45);
          const mieTight = Math.pow(sunDot, 42) * 0.55;
          const sunDisc = sunDot > 0.9982 ? 1.0 : 0;
          r += mieBroad * 1.05 + mieTight * 1.0 + sunDisc;
          g += mieBroad * 0.96 + mieTight * 0.95 + sunDisc * 0.97;
          b += mieBroad * 0.78 + mieTight * 0.82 + sunDisc * 0.88;

          // Volumetric procedural cloud deck projected onto sky hemisphere (fade near horizon for clean haze)
          if (ny > 0.03) {
            const invY = 1 / (ny + 0.18);
            const cu = nx * invY * 0.18 + 0.5;
            const cv = nz * invY * 0.18 + 0.5;
            const cloudMacro = tileableFbm(cu, cv, 4, 4, 5, 811);
            const cloudDetail = tileableFbm(cu * 2.1 + 0.17, cv * 2.1 - 0.09, 6, 6, 3, 853);
            const cloudField = cloudMacro * 0.72 + cloudDetail * 0.28;
            const horizonMask = clamp01((ny - 0.03) / 0.18);
            const density = clamp01((cloudField - 0.53) / 0.25) * horizonMask * 0.88;

            if (density > 0.001) {
              // Sunlit silver-white cloud tops + cool sky-shadowed cloud bellies
              const sunLit = clamp01(0.48 + sunDot * 0.42 + (cloudDetail - 0.45) * 0.35);
              const cr = lerp(0.76, 1.0, sunLit);
              const cg = lerp(0.81, 0.99, sunLit);
              const cb = lerp(0.88, 0.97, sunLit);
              r = lerp(r, cr, density);
              g = lerp(g, cg, density);
              b = lerp(b, cb, density);
            }
          }

          // Layered atmospheric alpine mountain range hugging the distant horizon
          const farRidgeH =
            0.055 +
            0.048 * periodicNoise2d(u * 6, 0.5, 6, 1, 907) +
            0.024 * periodicNoise2d(u * 15, 0.5, 15, 1, 919) +
            0.011 * periodicNoise2d(u * 32, 0.5, 32, 1, 937);
          const nearRidgeH =
            0.028 +
            0.03 * periodicNoise2d(u * 9 + 2.3, 0.5, 9, 1, 953) +
            0.014 * periodicNoise2d(u * 22, 0.5, 22, 1, 971);
          if (ny < farRidgeH) {
            const blend = clamp01((farRidgeH - ny) / 0.008);
            const mist = clamp01(1 - ny / Math.max(0.01, farRidgeH));
            const mr = lerp(0.46, 0.72, mist * 0.65);
            const mg = lerp(0.58, 0.81, mist * 0.65);
            const mb = lerp(0.73, 0.9, mist * 0.65);
            r = lerp(r, mr, blend * 0.86);
            g = lerp(g, mg, blend * 0.86);
            b = lerp(b, mb, blend * 0.86);
          }
          if (ny < nearRidgeH) {
            const blend = clamp01((nearRidgeH - ny) / 0.006);
            const slope = clamp01(ny / Math.max(0.01, nearRidgeH));
            r = lerp(r, lerp(0.34, 0.44, slope), blend * 0.9);
            g = lerp(g, lerp(0.47, 0.55, slope), blend * 0.9);
            b = lerp(b, lerp(0.44, 0.6, slope), blend * 0.9);
          }
        } else {
          // Ground bounce hemisphere (natural meadow green-ochre fading into horizon mist)
          const down = clamp01(-ny * 2.6);
          r = lerp(0.76, 0.28, down);
          g = lerp(0.84, 0.38, down);
          b = lerp(0.82, 0.22, down);
        }
      } else if (environment === "warehouse") {
        // Modern aerospace / robotics assembly hangar with high-bay linear skylight banks
        if (ny >= 0) {
          r = lerp(0.72, 0.48, clamp01(ny));
          g = lerp(0.76, 0.53, clamp01(ny));
          b = lerp(0.82, 0.6, clamp01(ny));
          // Overhead bright softbox skylight bands (creates sharp architectural reflections on CNC aluminum)
          const roofBand = ny > 0.52 && Math.abs(Math.sin(nx * Math.PI * 3.0)) > 0.66;
          if (roofBand) {
            r = 1.0;
            g = 0.99;
            b = 0.97;
          }
          // Warm clerestory perimeter daylight band
          const clerestory = ny > 0.14 && ny < 0.28;
          if (clerestory) {
            const band = 1 - Math.abs(ny - 0.21) / 0.07;
            r = lerp(r, 0.99, band * 0.75);
            g = lerp(g, 0.97, band * 0.75);
            b = lerp(b, 0.91, band * 0.75);
          }
        } else {
          const down = clamp01(-ny * 2.0);
          r = lerp(0.68, 0.46, down);
          g = lerp(0.71, 0.5, down);
          b = lerp(0.76, 0.55, down);
        }
      } else if (environment === "office") {
        // KeyShot / Apple architectural daylight studio with warm limestone bounce & large window softboxes
        if (ny >= 0) {
          const elev = clamp01(ny);
          r = lerp(0.86, 0.74, elev);
          g = lerp(0.88, 0.78, elev);
          b = lerp(0.92, 0.84, elev);
          // Large diffused overhead skylight dome
          if (ny > 0.58) {
            const soft = clamp01((ny - 0.58) / 0.22);
            r = lerp(r, 1.0, soft * 0.85);
            g = lerp(g, 0.99, soft * 0.85);
            b = lerp(b, 0.97, soft * 0.85);
          }
          // Left & right architectural curtain wall softboxes
          const sideWindow = Math.abs(nx) > 0.72 && ny > 0.05 && ny < 0.46;
          if (sideWindow) {
            r = lerp(r, 0.97, 0.72);
            g = lerp(g, 0.99, 0.72);
            b = lerp(b, 1.0, 0.72);
          }
        } else {
          const down = clamp01(-ny * 2.2);
          r = lerp(0.84, 0.66, down);
          g = lerp(0.82, 0.63, down);
          b = lerp(0.78, 0.58, down);
        }
      } else if (environment === "atrium") {
        // Clean-future white atrium: glass daylight oculus, tall glazing bands between fins, cyan LED cove
        if (ny >= 0) {
          const elev = clamp01(ny);
          r = lerp(0.9, 0.82, elev);
          g = lerp(0.92, 0.85, elev);
          b = lerp(0.95, 0.89, elev);
          // Bright overhead oculus disc (soft-edged)
          if (ny > 0.86) {
            const soft = clamp01((ny - 0.86) / 0.06);
            r = lerp(r, 1.0, soft);
            g = lerp(g, 1.0, soft);
            b = lerp(b, 1.0, soft);
          }
          // Tall perimeter glazing bands separated by vertical fins
          if (ny > 0.06 && ny < 0.5) {
            const fin = Math.abs(Math.sin(theta * 24)) > 0.22;
            if (fin) {
              r = lerp(r, 0.97, 0.8);
              g = lerp(g, 0.99, 0.8);
              b = lerp(b, 1.0, 0.8);
            }
          }
          // Thin cyan LED cove line just above the skirting
          if (ny > 0.035 && ny < 0.05) {
            r = lerp(r, 0.22, 0.7);
            g = lerp(g, 0.74, 0.7);
            b = lerp(b, 0.97, 0.7);
          }
        } else {
          // Polished white epoxy floor bounce
          const down = clamp01(-ny * 2.4);
          r = lerp(0.88, 0.8, down);
          g = lerp(0.9, 0.82, down);
          b = lerp(0.93, 0.85, down);
        }
      } else if (environment === "dark-lab") {
        // Automotive / KeyShot dark photography studio with crisp linear overhead softboxes + cyan/indigo rim
        r = 0.04;
        g = 0.055;
        b = 0.095;
        if (ny > 0.68 && Math.abs(nz) < 0.34) {
          const strip = clamp01((ny - 0.68) / 0.14);
          r = lerp(r, 0.98, strip);
          g = lerp(g, 0.99, strip);
          b = lerp(b, 1.0, strip);
        }
        // Left cool cyan rim softbox
        if (nx < -0.78 && ny > 0.08 && ny < 0.42) {
          const rim = clamp01((-nx - 0.78) / 0.15);
          r = lerp(r, 0.25, rim * 0.85);
          g = lerp(g, 0.78, rim * 0.85);
          b = lerp(b, 1.0, rim * 0.85);
        }
        // Right subtle warm-indigo rim softbox
        if (nx > 0.78 && ny > 0.08 && ny < 0.42) {
          const rim = clamp01((nx - 0.78) / 0.15);
          r = lerp(r, 0.45, rim * 0.8);
          g = lerp(g, 0.48, rim * 0.8);
          b = lerp(b, 0.98, rim * 0.8);
        }
      } else {
        // Passthrough MR: balanced neutral studio IBL so metallic CAD parts reflect cleanly in AR
        const elev = clamp01((ny + 1) * 0.5);
        r = lerp(0.32, 0.92, elev);
        g = lerp(0.35, 0.94, elev);
        b = lerp(0.4, 0.98, elev);
      }

      const idx = (y * width + x) * 4;
      pixels[idx] = clamp255(clamp01(r) * 255);
      pixels[idx + 1] = clamp255(clamp01(g) * 255);
      pixels[idx + 2] = clamp255(clamp01(b) * 255);
      pixels[idx + 3] = 255;
    }
  }

  const skyTexture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  skyTexture.mapping = THREE.EquirectangularReflectionMapping;
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  skyTexture.magFilter = THREE.LinearFilter;
  skyTexture.minFilter = THREE.LinearFilter;
  skyTexture.generateMipmaps = false;
  skyTexture.needsUpdate = true;

  let pmremRT: THREE.WebGLRenderTarget | null = null;
  if (renderer && typeof THREE.PMREMGenerator === "function") {
    const xrMgr = (renderer as { xr?: { enabled: boolean } }).xr;
    const prevXrEnabled = xrMgr ? xrMgr.enabled : false;
    try {
      if (xrMgr) xrMgr.enabled = false;
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      pmremRT = pmrem.fromEquirectangular(skyTexture);
      pmrem.dispose();
    } catch {
      pmremRT = null;
    } finally {
      if (xrMgr) xrMgr.enabled = prevXrEnabled;
    }
  }

  return {
    skyTexture,
    envMap: pmremRT ? pmremRT.texture : null,
    dispose() {
      skyTexture.dispose();
      pmremRT?.dispose();
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Scientific Engineering CAE Colormaps & Per-Vertex Field Synthesis         */
/* -------------------------------------------------------------------------- */

export type CaeFieldOverlayMode = "fea-stress" | "cfd-flow" | "thermal";

const FEA_VON_MISES_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [0.07, 0.2, 0.68], // 0.00 deep engineering navy blue (minimal stress)
  [0.04, 0.56, 0.88], // 0.20 azure / sky blue
  [0.08, 0.82, 0.62], // 0.40 teal / emerald green
  [0.64, 0.91, 0.19], // 0.60 yellow-green
  [0.99, 0.74, 0.08], // 0.80 amber / orange
  [0.9, 0.14, 0.14], // 1.00 crimson peak Von Mises hotspot
];

const CFD_CP_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [0.08, 0.24, 0.62], // wake / low pressure suction
  [0.05, 0.58, 0.86], // accelerated flow blue-cyan
  [0.24, 0.8, 0.72], // freestream neutral cyan-teal
  [0.86, 0.84, 0.36], // mild compression
  [0.95, 0.45, 0.16], // stagnation high Cp
];

const THERMAL_CONTOUR_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [0.11, 0.1, 0.34], // cool indigo
  [0.44, 0.13, 0.68], // violet
  [0.82, 0.17, 0.44], // magenta
  [0.96, 0.56, 0.07], // amber
  [0.99, 0.96, 0.74], // white-hot core
];

function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Samples an sRGB RGB triplet `[0..1, 0..1, 0..1]` along the scientific FEA, CFD, or Thermal
 * engineering colormap with optional ANSYS/CalculiX-style contour banding & isoline emphasis.
 */
export function sampleCaeFieldRgb(
  mode: CaeFieldOverlayMode,
  rawT: number,
  withContourBands = true,
): [number, number, number] {
  const stops =
    mode === "fea-stress" ? FEA_VON_MISES_STOPS : mode === "cfd-flow" ? CFD_CP_STOPS : THERMAL_CONTOUR_STOPS;
  const clamped = clamp01(rawT);

  // Subtle contour quantization (10 bands) + faint isoline seam for authentic FEA/CFD readability
  let t = clamped;
  let isolineShade = 1.0;
  if (withContourBands) {
    const bands = 10;
    const scaled = clamped * bands;
    const bandIdx = Math.min(bands - 1, Math.floor(scaled));
    const frac = scaled - bandIdx;
    const quantized = (bandIdx + 0.5) / bands;
    t = lerp(clamped, quantized, 0.34);
    const edgeDist = Math.min(frac, 1 - frac);
    if (edgeDist < 0.045 && clamped > 0.03 && clamped < 0.97) {
      isolineShade = lerp(0.84, 1.0, edgeDist / 0.045);
    }
  }

  const maxIdx = stops.length - 1;
  const pos = t * maxIdx;
  const i0 = Math.min(maxIdx, Math.floor(pos));
  const i1 = Math.min(maxIdx, i0 + 1);
  const f = pos - i0;
  const c0 = stops[i0] ?? [0.1, 0.4, 0.8];
  const c1 = stops[i1] ?? c0;
  return [
    clamp01(lerp(c0[0], c1[0], f) * isolineShade),
    clamp01(lerp(c0[1], c1[1], f) * isolineShade),
    clamp01(lerp(c0[2], c1[2], f) * isolineShade),
  ];
}

/**
 * Computes geometry-aware per-vertex linear RGB colors (`Float32Array`, stride 3) for any
 * real CAD/STEP/OpenSCAD `BufferGeometry` so FEA Von Mises stress, CFD surface Cp, and Thermal
 * overlays map continuously across bores, mounting flanges, fillets, and load paths rather than
 * painting the entire mesh a flat single color.
 */
export function computeGeometryCaeVertexColors(
  geometry: THREE.BufferGeometry,
  mode: CaeFieldOverlayMode,
): Float32Array {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr || posAttr.count === 0) {
    return new Float32Array(0);
  }
  const count = posAttr.count;
  const normAttr = geometry.getAttribute("normal");

  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }
  const box = geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(posAttr as THREE.BufferAttribute);
  const cx = (box.min.x + box.max.x) * 0.5;
  const cy = (box.min.y + box.max.y) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;
  const spanX = Math.max(1e-5, box.max.x - box.min.x);
  const spanY = Math.max(1e-5, box.max.y - box.min.y);
  const spanZ = Math.max(1e-5, box.max.z - box.min.z);
  const maxHorizR = Math.max(1e-5, Math.hypot(spanX * 0.5, spanZ * 0.5));

  const rawField = new Float32Array(count);
  let minVal = Infinity;
  let maxVal = -Infinity;

  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const ux = (x - cx) / (spanX * 0.5); // -1..1
    const uy = (y - box.min.y) / spanY; // 0 (bottom root) .. 1 (top)
    const uz = (z - cz) / (spanZ * 0.5); // -1..1
    const r = Math.hypot(x - cx, z - cz) / maxHorizR; // 0 (center bore) .. 1 (outer rim)

    const nx = normAttr ? normAttr.getX(i) : ux;
    const ny = normAttr ? normAttr.getY(i) : uy * 2 - 1;
    const nz = normAttr ? normAttr.getZ(i) : uz;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    const nnx = nx / nLen;
    const nny = ny / nLen;
    const nnz = nz / nLen;

    let field = 0.5;
    if (mode === "fea-stress") {
      // Physically grounded Von Mises stress distribution combining:
      // 1) Root / cantilever bending moment (peaks near constrained base & load-bearing side)
      // 2) Flange-to-boss fillet shoulder stress concentration ring (transition between base & body)
      // 3) Inner shaft bore hoop concentration Kt & bolt-circle lug stress risers
      const rootBending = clamp01(1 - uy * 0.92);
      const loadSide = clamp01(0.55 - ux * 0.46 + uz * 0.16);
      const hubFilletShoulder = Math.exp(-Math.pow((uy - 0.28) / 0.22, 2)) * clamp01(1.12 - r * 0.65);
      const radLen = Math.hypot(x - cx, z - cz) || 1;
      const radOutDot = ((x - cx) / radLen) * nnx + ((z - cz) / radLen) * nnz;
      const boreKt = clamp01(-radOutDot) * (1 - r * 0.4) * 0.2;
      const boltBossKt =
        0.14 *
        Math.pow(Math.abs(Math.sin(Math.atan2(uz, ux) * 3)), 2) *
        clamp01(1 - Math.abs(r - 0.68) * 2.4) *
        (1 - uy * 0.45);
      field =
        0.5 * rootBending * (0.42 + 0.58 * loadSide) +
        0.28 * hubFilletShoulder +
        0.14 * clamp01(1 - uy * 0.68) * (1 - r * 0.5) +
        boreKt +
        boltBossKt;
    } else if (mode === "cfd-flow") {
      // Aerodynamic Cp surface pressure distribution (flow along +Z -> -Z):
      // Upstream stagnation faces (+Z) = high Cp, curved sides = suction acceleration, wake (-Z) = low recovery
      const windward = clamp01(nnz * 0.65 + uz * 0.35);
      const suctionSides = clamp01(Math.hypot(nnx, nny)) * (1 - Math.abs(uz) * 0.55);
      field = 0.54 * windward + 0.24 * (1 - suctionSides) + 0.22 * clamp01((uz + 1) * 0.5);
    } else {
      // Steady-state thermal conduction: hot internal core / lower stator -> cooler outer radiating surfaces
      const coreDist = Math.hypot(ux, (y - cy) / (spanY * 0.5), uz) / Math.sqrt(3);
      field = 0.72 * clamp01(1 - coreDist * 0.88) + 0.28 * clamp01(1 - uy * 0.65);
    }

    rawField[i] = field;
    if (field < minVal) minVal = field;
    if (field > maxVal) maxVal = field;
  }

  // Robust percentile normalization [p02..p96] (like ANSYS / ParaView auto-range) so degenerate
  // interior sliver triangles never compress visible outer contour bands into a single narrow range.
  let rangeLow = minVal;
  let rangeHigh = maxVal;
  if (count >= 16) {
    const sorted = Float32Array.from(rawField).sort();
    const loIdx = Math.floor((count - 1) * 0.02);
    const hiIdx = Math.floor((count - 1) * 0.96);
    const pLo = sorted[loIdx] ?? minVal;
    const pHi = sorted[hiIdx] ?? maxVal;
    if (pHi - pLo > 1e-4) {
      rangeLow = pLo;
      rangeHigh = pHi;
    }
  }
  const span = Math.max(1e-4, rangeHigh - rangeLow);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const normT = clamp01(((rawField[i] ?? rangeLow) - rangeLow) / span);
    const [sr, sg, sb] = sampleCaeFieldRgb(mode, normT, mode !== "cfd-flow");
    colors[i * 3] = srgbChannelToLinear(sr);
    colors[i * 3 + 1] = srgbChannelToLinear(sg);
    colors[i * 3 + 2] = srgbChannelToLinear(sb);
  }
  return colors;
}

/**
 * Generates a lightweight `128×128` procedural sRGB scientific CAE contour gradient texture
 * for primitive procedural assembly parts (`PartMaterial` & `ShowcasePartMaterial`) so even
 * standard boxes, cylinders, and tori display smooth multi-band FEA/Thermal contours.
 */
export function createCaeFieldGradientTexture(mode: CaeFieldOverlayMode, size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      // Smooth diagonal + radial load-path field across UV space
      const radial = Math.sin(u * Math.PI) * 0.22;
      const baseT = mode === "fea-stress" ? clamp01((1 - v) * 0.78 + radial) : clamp01(v * 0.76 + radial);
      const [r, g, b] = sampleCaeFieldRgb(mode, baseT, true);
      const idx = (y * size + x) * 4;
      data[idx] = clamp255(r * 255);
      data[idx + 1] = clamp255(g * 255);
      data[idx + 2] = clamp255(b * 255);
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
