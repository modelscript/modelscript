// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared hero-grade Three.js / R3F CAD rendering helpers used by both Ansatz (CadViewer)
 * and Ansatz (CadStepViewer):
 * - Procedural lathe-brushed alloy PBR maps & 7-lobe aerospace softbox studio environment
 * - Dual-pass Solid-Ahead / Feature-Edge-Wireframe-Behind split sectioning + GPU stencil cap
 * - 3D ASME Y14.5 GD&T Feature Control Frame & Datum callout overlays
 */

import {
  ALLOY_MATERIAL_PRESETS,
  SECTION_CAP_FRAGMENT_SHADER,
  SECTION_CAP_VERTEX_SHADER,
  classifyAlloyPreset,
  evaluateStudioDomeColor,
  formatMaterialModifierGlyph,
  sliceSectionContoursAtPlane,
  synthesizeBrushedAlloyTextures,
  synthesizeMechanicalDetailTextures,
  type AlloyMaterialSpec,
  type GdtCallout3D,
  type GdtDatumFeature3D,
  type GdtOverlayPayload,
} from "@modelscript/cad";
import { Html, Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";

export interface HeroPbrTextures {
  normal: THREE.DataTexture;
  roughness: THREE.DataTexture;
  ao: THREE.DataTexture;
  iridescence: THREE.DataTexture;
  detailNormal: THREE.DataTexture;
  detailRoughness: THREE.DataTexture;
  detailAo: THREE.DataTexture;
}

const pbrTextureCache = new WeakMap<THREE.WebGLRenderer, HeroPbrTextures>();
const studioEnvCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

function makeRepeatDataTexture(
  data: Uint8Array,
  width: number,
  height: number,
  anisotropy: number,
  repeat = true,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = repeat ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = repeat;
  if (repeat) tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Returns cached procedural brushed-alloy and mechanical panel/rivet PBR textures scoped to a WebGLRenderer.
 */
export function getCachedHeroPbrTextures(gl: THREE.WebGLRenderer): HeroPbrTextures {
  const cached = pbrTextureCache.get(gl);
  if (cached) return cached;

  const maxAniso = Math.min(gl.capabilities.getMaxAnisotropy(), 8);
  const bufs = synthesizeBrushedAlloyTextures(256);
  const detailBufs = synthesizeMechanicalDetailTextures(256);

  const normal = makeRepeatDataTexture(bufs.normalRgba, bufs.size, bufs.size, maxAniso, true);
  const roughness = makeRepeatDataTexture(bufs.roughnessRgba, bufs.size, bufs.size, maxAniso, true);
  const ao = makeRepeatDataTexture(bufs.aoRgba, bufs.aoWidth, 1, 1, false);
  ao.channel = 1;
  const iridescence = makeRepeatDataTexture(bufs.iridescenceRgba, bufs.iridescenceSize, bufs.iridescenceSize, 1, true);
  iridescence.generateMipmaps = false;
  iridescence.minFilter = THREE.LinearFilter;

  const detailNormal = makeRepeatDataTexture(detailBufs.normalRgba, detailBufs.size, detailBufs.size, maxAniso, true);
  const detailRoughness = makeRepeatDataTexture(
    detailBufs.roughnessRgba,
    detailBufs.size,
    detailBufs.size,
    maxAniso,
    true,
  );
  const detailAo = makeRepeatDataTexture(detailBufs.aoRgba, detailBufs.size, detailBufs.size, maxAniso, true);

  const result: HeroPbrTextures = {
    normal,
    roughness,
    ao,
    iridescence,
    detailNormal,
    detailRoughness,
    detailAo,
  };
  pbrTextureCache.set(gl, result);
  return result;
}

/**
 * Synthesizes and caches the 7-lobe aerospace photography studio PMREM environment
 * completely in-memory (zero network fetches, immune to offline HDRI errors).
 */
export function getCachedHeroStudioEnv(gl: THREE.WebGLRenderer): THREE.Texture {
  const cached = studioEnvCache.get(gl);
  if (cached) return cached;

  const pmrem = new THREE.PMREMGenerator(gl);
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x05070a);

  const domeGeo = new THREE.SphereGeometry(16, 96, 48);
  const domePos = domeGeo.getAttribute("position") as THREE.BufferAttribute;
  const domeColors = new Float32Array(domePos.count * 3);

  for (let i = 0; i < domePos.count; i++) {
    const [r, g, b] = evaluateStudioDomeColor(domePos.getX(i), domePos.getY(i), domePos.getZ(i));
    domeColors[i * 3] = r;
    domeColors[i * 3 + 1] = g;
    domeColors[i * 3 + 2] = b;
  }

  domeGeo.setAttribute("color", new THREE.BufferAttribute(domeColors, 3));
  const domeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  const domeMesh = new THREE.Mesh(domeGeo, domeMat);
  studio.add(domeMesh);

  const envTex = pmrem.fromScene(studio, 0.01).texture;
  domeGeo.dispose();
  domeMat.dispose();
  pmrem.dispose();

  studioEnvCache.set(gl, envTex);
  return envTex;
}

/**
 * Assigns cylindrical/planar UVs onto CAD geometries lacking `uv` attributes so
 * procedural brushed-metal normal and roughness maps render cleanly on STEP & SCAD meshes.
 */
export function ensureGeometryBrushedUvs(geo: THREE.BufferGeometry): void {
  if (geo.getAttribute("uv")) return;
  const pos = geo.getAttribute("position");
  if (!pos || pos.count === 0) return;

  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const theta = Math.atan2(z, y) / (Math.PI * 2) + 0.5;
    uv[i * 2] = x * 0.65;
    uv[i * 2 + 1] = theta * 3.0;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/** Shared normal-scale constants (avoids per-render Vector2 allocations). */
export const HERO_BRUSHED_NORMAL_SCALE = new THREE.Vector2(0.032, 0.014);
export const HERO_DETAIL_NORMAL_SCALE = new THREE.Vector2(0.14, 0.14);
export const HERO_ARM_DETAIL_NORMAL_SCALE = new THREE.Vector2(0.11, 0.11);

/** Physically calibrated surface finishes shared across VR Rotunda & Studio CAD hero assemblies. */
export type HeroSurfaceFinish =
  | "brushed-aluminum"
  | "anodized-aluminum"
  | "dark-anodized"
  | "satin-steel"
  | "polished-steel"
  | "cast-aluminum"
  | "copper"
  | "brass"
  | "gold"
  | "ceramic-white"
  | "ceramic-grey"
  | "painted"
  | "carbon-fiber"
  | "rubber"
  | "glass-lens"
  | "solar-cell"
  | "pcb";

export interface HeroSurfacePreset {
  readonly color: string;
  readonly metalness: number;
  readonly roughness: number;
  readonly anisotropy: number;
  readonly anisotropyRotation: number;
  readonly clearcoat: number;
  readonly clearcoatRoughness: number;
  readonly iridescence: number;
  readonly iridescenceIOR: number;
  readonly envMapIntensity: number;
  readonly mapMode: "brushed" | "detail" | "none";
}

export const HERO_SURFACE_PRESETS: Record<HeroSurfaceFinish, HeroSurfacePreset> = {
  "brushed-aluminum": {
    color: "#d6d9dc",
    metalness: 0.95,
    roughness: 0.31,
    anisotropy: 0.38,
    anisotropyRotation: Math.PI / 2,
    clearcoat: 0,
    clearcoatRoughness: 0,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 1.28,
    mapMode: "brushed",
  },
  "anodized-aluminum": {
    color: "#b4bcc6",
    metalness: 0.93,
    roughness: 0.38,
    anisotropy: 0.28,
    anisotropyRotation: Math.PI / 2,
    clearcoat: 0,
    clearcoatRoughness: 0,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 1.2,
    mapMode: "brushed",
  },
  "dark-anodized": {
    color: "#636c78",
    metalness: 0.92,
    roughness: 0.4,
    anisotropy: 0.24,
    anisotropyRotation: Math.PI / 2,
    clearcoat: 0,
    clearcoatRoughness: 0,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 1.18,
    mapMode: "brushed",
  },
  "satin-steel": {
    color: "#b9bcbf",
    metalness: 0.96,
    roughness: 0.3,
    anisotropy: 0.34,
    anisotropyRotation: Math.PI / 2,
    clearcoat: 0,
    clearcoatRoughness: 0,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 1.3,
    mapMode: "brushed",
  },
  "polished-steel": {
    color: "#d2d6db",
    metalness: 0.98,
    roughness: 0.24,
    anisotropy: 0.38,
    anisotropyRotation: Math.PI / 2,
    clearcoat: 0,
    clearcoatRoughness: 0,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 1.35,
    mapMode: "brushed",
  },
  "cast-aluminum": {
    color: "#c6cbd1",
    metalness: 0.92,
    roughness: 0.42,
    anisotropy: 0.1,
    anisotropyRotation: Math.PI / 2,
    clearcoat: 0,
    clearcoatRoughness: 0,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 1.15,
    mapMode: "brushed",
  },
  copper: {
    color: "#e3a27a",
    metalness: 0.96,
    roughness: 0.31,
    anisotropy: 0.32,
    anisotropyRotation: Math.PI / 2,
    clearcoat: 0,
    clearcoatRoughness: 0,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 1.3,
    mapMode: "brushed",
  },
  brass: {
    color: "#d4b26a",
    metalness: 0.95,
    roughness: 0.29,
    anisotropy: 0.3,
    anisotropyRotation: Math.PI / 2,
    clearcoat: 0,
    clearcoatRoughness: 0,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 1.3,
    mapMode: "brushed",
  },
  gold: {
    color: "#f2c570",
    metalness: 0.96,
    roughness: 0.27,
    anisotropy: 0.26,
    anisotropyRotation: Math.PI / 2,
    clearcoat: 0,
    clearcoatRoughness: 0,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 1.35,
    mapMode: "brushed",
  },
  "ceramic-white": {
    color: "#edf1f5",
    metalness: 0.04,
    roughness: 0.3,
    anisotropy: 0,
    anisotropyRotation: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.22,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 1.0,
    mapMode: "none",
  },
  "ceramic-grey": {
    color: "#dde3ea",
    metalness: 0.05,
    roughness: 0.32,
    anisotropy: 0,
    anisotropyRotation: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.22,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 1.0,
    mapMode: "none",
  },
  painted: {
    color: "#e2e8f0",
    metalness: 0.06,
    roughness: 0.3,
    anisotropy: 0,
    anisotropyRotation: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.22,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 1.0,
    mapMode: "none",
  },
  "carbon-fiber": {
    color: "#434b57",
    metalness: 0.18,
    roughness: 0.42,
    anisotropy: 0.16,
    anisotropyRotation: Math.PI / 4,
    clearcoat: 0.32,
    clearcoatRoughness: 0.24,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 0.98,
    mapMode: "none",
  },
  rubber: {
    color: "#3d434c",
    metalness: 0,
    roughness: 0.84,
    anisotropy: 0,
    anisotropyRotation: 0,
    clearcoat: 0,
    clearcoatRoughness: 0,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 0.78,
    mapMode: "none",
  },
  "glass-lens": {
    color: "#1e324a",
    metalness: 0.12,
    roughness: 0.07,
    anisotropy: 0,
    anisotropyRotation: 0,
    clearcoat: 0.92,
    clearcoatRoughness: 0.05,
    iridescence: 0.34,
    iridescenceIOR: 1.48,
    envMapIntensity: 1.3,
    mapMode: "none",
  },
  "solar-cell": {
    color: "#1a3568",
    metalness: 0.2,
    roughness: 0.18,
    anisotropy: 0,
    anisotropyRotation: 0,
    clearcoat: 0.68,
    clearcoatRoughness: 0.08,
    iridescence: 0.14,
    iridescenceIOR: 1.45,
    envMapIntensity: 1.12,
    mapMode: "none",
  },
  pcb: {
    color: "#1f6148",
    metalness: 0.06,
    roughness: 0.36,
    anisotropy: 0,
    anisotropyRotation: 0,
    clearcoat: 0.36,
    clearcoatRoughness: 0.2,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 0.92,
    mapMode: "none",
  },
};

export interface ResolvedHeroSurfaceParams {
  readonly color: string;
  readonly metalness: number;
  readonly roughness: number;
  readonly anisotropy: number;
  readonly anisotropyRotation: number;
  readonly clearcoat: number;
  readonly clearcoatRoughness: number;
  readonly iridescence: number;
  readonly iridescenceIOR: number;
  readonly envMapIntensity: number;
  readonly mapMode: "brushed" | "detail" | "none";
}

/**
 * Resolves calibrated `MeshPhysicalMaterial` inputs from an explicit `HeroSurfaceFinish`
 * or infers physically plausible defaults for legacy `baseColor`/`metalness`/`roughness` callers.
 */
export function resolveHeroSurfaceParams(opts: {
  finish?: HeroSurfaceFinish | undefined;
  baseColor?: string | undefined;
  metalness?: number | undefined;
  roughness?: number | undefined;
  clearcoat?: number | undefined;
  clearcoatRoughness?: number | undefined;
  anisotropy?: number | undefined;
  envMapIntensity?: number | undefined;
}): ResolvedHeroSurfaceParams {
  if (opts.finish) {
    const preset = HERO_SURFACE_PRESETS[opts.finish];
    return {
      color: opts.baseColor ?? preset.color,
      metalness: opts.metalness ?? preset.metalness,
      roughness: opts.roughness ?? preset.roughness,
      anisotropy: opts.anisotropy ?? preset.anisotropy,
      anisotropyRotation: preset.anisotropyRotation,
      clearcoat: opts.clearcoat ?? preset.clearcoat,
      clearcoatRoughness: opts.clearcoatRoughness ?? preset.clearcoatRoughness,
      iridescence: preset.iridescence,
      iridescenceIOR: preset.iridescenceIOR,
      envMapIntensity: opts.envMapIntensity ?? preset.envMapIntensity,
      mapMode: preset.mapMode,
    };
  }

  const rawMetal = opts.metalness ?? 0.92;
  const rawRough = opts.roughness ?? 0.3;
  const color = opts.baseColor ?? "#d6d9dc";

  if (rawMetal >= 0.65) {
    const metalness = Math.min(0.98, Math.max(0.92, rawMetal));
    // Account for brushed roughnessMap (~0.82 mean) so effective surface roughness lands in 0.24..0.38
    const roughness = Math.min(0.42, Math.max(0.28, rawRough * 1.18));
    return {
      color,
      metalness,
      roughness,
      anisotropy: opts.anisotropy ?? 0.3,
      anisotropyRotation: Math.PI / 2,
      clearcoat: opts.clearcoat ?? 0,
      clearcoatRoughness: opts.clearcoatRoughness ?? 0,
      iridescence: 0,
      iridescenceIOR: 1.3,
      envMapIntensity: opts.envMapIntensity ?? 1.24,
      mapMode: "brushed",
    };
  }

  if (rawRough >= 0.7) {
    return {
      color,
      metalness: 0,
      roughness: Math.min(0.9, Math.max(0.78, rawRough)),
      anisotropy: 0,
      anisotropyRotation: 0,
      clearcoat: opts.clearcoat ?? 0,
      clearcoatRoughness: opts.clearcoatRoughness ?? 0,
      iridescence: 0,
      iridescenceIOR: 1.3,
      envMapIntensity: opts.envMapIntensity ?? 0.78,
      mapMode: "none",
    };
  }

  return {
    color,
    metalness: Math.min(0.18, rawMetal),
    roughness: Math.min(0.45, Math.max(0.22, rawRough)),
    anisotropy: opts.anisotropy ?? 0,
    anisotropyRotation: 0,
    clearcoat: opts.clearcoat ?? 0.35,
    clearcoatRoughness: opts.clearcoatRoughness ?? 0.22,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: opts.envMapIntensity ?? 1.0,
    mapMode: "none",
  };
}

export interface HeroPhysicalMaterialConfig {
  color: number;
  metalness: number;
  roughness: number;
  anisotropy: number;
  anisotropyRotation: number;
  clearcoat: number;
  clearcoatRoughness: number;
  normalMap: THREE.DataTexture | null;
  normalScale: THREE.Vector2;
  roughnessMap: THREE.DataTexture | null;
  iridescence: number;
  iridescenceIOR: number;
  iridescenceThicknessRange: [number, number];
  iridescenceThicknessMap: THREE.DataTexture | null;
  emissive: number;
  emissiveIntensity: number;
  envMapIntensity: number;
}

const COLOR_PRESERVING_PRESETS = new Set<string>([
  "default-machined",
  "molded-abs-plastic",
  "matte-polymer",
  "elastomer-rubber",
  "gloss-paint",
  "clear-polycarbonate",
  "anodized-aluminum",
  "cast-aluminum",
  "stainless-steel",
  "ceramic-white-shell",
  "dark-anodized-joint",
  "safety-orange-accent",
]);

/** Physically calibrated light-environment albedo overrides so metals read realistically under bright IBL. */
const LIGHT_IBL_PRESET_OVERRIDES: Partial<
  Record<
    string,
    {
      colorHex?: number;
      metalness?: number;
      roughness?: number;
      clearcoat?: number;
      clearcoatRoughness?: number;
      anisotropy?: number;
    }
  >
> = {
  "default-machined": { colorHex: 0xd6d9dc, metalness: 0.95, roughness: 0.3, anisotropy: 0.34, clearcoat: 0 },
  "anodized-aluminum": { colorHex: 0xb6bec8, metalness: 0.93, roughness: 0.36, anisotropy: 0.28, clearcoat: 0 },
  "cast-aluminum": { colorHex: 0xc6cbd1, metalness: 0.92, roughness: 0.38, anisotropy: 0.1, clearcoat: 0 },
  "stainless-steel": { colorHex: 0xb9bcbf, metalness: 0.96, roughness: 0.28, anisotropy: 0.34, clearcoat: 0 },
  "dark-anodized-joint": { colorHex: 0x5c6572, metalness: 0.92, roughness: 0.38, anisotropy: 0.24, clearcoat: 0 },
  "al-li-nacelle": { colorHex: 0xc4cad2, metalness: 0.94, roughness: 0.28, anisotropy: 0.3, clearcoat: 0 },
  "titanium-spinner": { colorHex: 0xa6aeb8, metalness: 0.95, roughness: 0.26, anisotropy: 0.34, clearcoat: 0 },
  "ceramic-white-shell": {
    colorHex: 0xeef1f5,
    metalness: 0.04,
    roughness: 0.3,
    clearcoat: 0.35,
    clearcoatRoughness: 0.22,
  },
  "elastomer-rubber": { colorHex: 0x3c424b, metalness: 0.0, roughness: 0.85, clearcoat: 0, clearcoatRoughness: 0 },
  "optical-lens-glass": {
    colorHex: 0x1c2f46,
    metalness: 0.12,
    roughness: 0.07,
    clearcoat: 0.92,
    clearcoatRoughness: 0.05,
  },
};

/**
 * Resolves calibrated MeshPhysicalMaterial properties for any CAD part.
 */
export function resolveHeroAlloyConfig(
  gl: THREE.WebGLRenderer,
  partName?: string | null,
  colorRgba?: readonly number[],
  dark = true,
  materialHint?: string | null,
): HeroPhysicalMaterialConfig {
  const maps = getCachedHeroPbrTextures(gl);
  const presetKey = classifyAlloyPreset(partName, colorRgba, materialHint);
  const spec: AlloyMaterialSpec = ALLOY_MATERIAL_PRESETS[presetKey];
  const lightOverride = !dark ? LIGHT_IBL_PRESET_OVERRIDES[presetKey] : undefined;
  const useBrushed = spec.useBrushedMaps !== false;
  const useDetail = spec.useDetailMaps === true;

  let colorHex = lightOverride?.colorHex ?? (dark ? spec.colorDark : spec.colorLight);
  if (COLOR_PRESERVING_PRESETS.has(presetKey) && colorRgba && colorRgba.length >= 3) {
    const c = new THREE.Color(colorRgba[0]!, colorRgba[1]!, colorRgba[2]!);
    colorHex = c.getHex();
  }

  const metalness = lightOverride?.metalness ?? spec.metalness;
  const roughness = lightOverride?.roughness ?? spec.roughness;
  const isMetal = metalness >= 0.65;
  const defaultClearcoat = isMetal ? 0 : roughness >= 0.7 ? 0 : 0.35;
  const defaultClearcoatRoughness = isMetal ? 0 : 0.22;

  return {
    color: colorHex,
    metalness,
    roughness,
    anisotropy: lightOverride?.anisotropy ?? spec.anisotropy,
    anisotropyRotation: spec.anisotropyRotation,
    clearcoat: lightOverride?.clearcoat ?? spec.clearcoat ?? defaultClearcoat,
    clearcoatRoughness: lightOverride?.clearcoatRoughness ?? spec.clearcoatRoughness ?? defaultClearcoatRoughness,
    normalMap: useDetail ? maps.detailNormal : useBrushed ? maps.normal : null,
    normalScale: new THREE.Vector2(spec.normalScale[0], spec.normalScale[1]),
    roughnessMap: useDetail ? maps.detailRoughness : useBrushed ? maps.roughness : null,
    iridescence: spec.iridescence ?? 0,
    iridescenceIOR: spec.iridescenceIOR ?? 1.3,
    iridescenceThicknessRange: spec.iridescenceThicknessRange
      ? [spec.iridescenceThicknessRange[0], spec.iridescenceThicknessRange[1]]
      : [100, 400],
    iridescenceThicknessMap: spec.iridescence ? maps.iridescence : null,
    emissive: (dark ? spec.emissiveDark : spec.emissiveLight) ?? 0x000000,
    emissiveIntensity: spec.emissiveIntensity ?? 0,
    envMapIntensity: isMetal ? (dark ? 1.35 : 1.28) : roughness >= 0.7 ? 0.78 : 1.0,
  };
}

/**
 * Attaches the procedural 7-lobe aerospace photography environment IBL + optional 3-point
 * studio key/rim/fill lighting to the active R3F scene.
 *
 * Set `includeLights={false}` inside environments (such as the VR Engineering Rotunda)
 * that already provide their own calibrated directional/hemisphere lighting rig.
 */
export const HeroStudioEnvironment: React.FC<{ dark?: boolean; includeLights?: boolean }> = ({
  dark = true,
  includeLights = true,
}) => {
  const { gl, scene } = useThree();

  useEffect(() => {
    const prevEnv = scene.environment;
    const prevToneMapping = gl.toneMapping;
    const prevExposure = gl.toneMappingExposure;

    scene.environment = getCachedHeroStudioEnv(gl);
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = dark ? 1.05 : 1.04;

    return () => {
      scene.environment = prevEnv;
      gl.toneMapping = prevToneMapping;
      gl.toneMappingExposure = prevExposure;
    };
  }, [gl, scene, dark]);

  if (!includeLights) return null;

  return (
    <>
      <directionalLight color="#fffaf0" position={[-5.2, 6.2, 5.0]} intensity={0.75} />
      <directionalLight color="#bae6fd" position={[4.2, 5.2, -5.5]} intensity={0.85} />
      <directionalLight color="#e0f2fe" position={[-6.5, -1.8, 3.8]} intensity={0.35} />
    </>
  );
};

/**
 * Renders the two-pass WebGL stencil-buffer mask and opposing cyan CAD feature-edge
 * wireframe for arbitrary closed CAD geometries when in `"section"` (Split) mode.
 */
export const SplitSectionGeometryPasses: React.FC<{
  geometry: THREE.BufferGeometry;
  solidPlane: THREE.Plane | null;
  wirePlane: THREE.Plane | null;
  position?: [number, number, number];
  dark?: boolean;
  showStencilMask?: boolean;
  showWireOpposite?: boolean;
}> = ({
  geometry,
  solidPlane,
  wirePlane,
  position = [0, 0, 0],
  dark = true,
  showStencilMask = true,
  showWireOpposite = true,
}) => {
  const edgeGeometry = useMemo(() => {
    if (!showWireOpposite) return null;
    return buildCleanCreaseEdgeGeometry(geometry, 32);
  }, [geometry, showWireOpposite]);

  useEffect(() => {
    return () => {
      edgeGeometry?.dispose();
    };
  }, [edgeGeometry]);

  const wireColor = dark ? "#22d3ee" : "#0e7490";
  const contourColor = dark ? "#7dd3fc" : "#0284c7";

  const contourGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    return g;
  }, []);
  const lastPlaneKeyRef = useRef<string>("");

  useEffect(() => {
    lastPlaneKeyRef.current = "";
  }, [geometry, position[0], position[1], position[2]]);

  useEffect(() => {
    return () => {
      contourGeometry.dispose();
    };
  }, [contourGeometry]);

  useFrame(() => {
    if (!showStencilMask || !solidPlane) return;
    const nx = solidPlane.normal.x;
    const ny = solidPlane.normal.y;
    const nz = solidPlane.normal.z;
    const localC = solidPlane.constant + nx * position[0] + ny * position[1] + nz * position[2];
    const key = `${nx.toFixed(4)}:${ny.toFixed(4)}:${nz.toFixed(4)}:${localC.toFixed(4)}`;
    if (key === lastPlaneKeyRef.current) return;
    lastPlaneKeyRef.current = key;

    const posAttr = geometry.getAttribute("position");
    if (!posAttr?.array) return;
    const idxAttr = geometry.getIndex();
    const segs = sliceSectionContoursAtPlane(posAttr.array, idxAttr?.array, [nx, ny, nz], localC);
    contourGeometry.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
    contourGeometry.computeBoundingSphere();
  });

  return (
    <group position={position}>
      {showStencilMask && solidPlane && (
        <>
          <mesh geometry={geometry} renderOrder={1} frustumCulled={false}>
            <meshBasicMaterial
              colorWrite={false}
              depthWrite={false}
              side={THREE.BackSide}
              clippingPlanes={[solidPlane]}
              stencilWrite={true}
              stencilRef={0}
              stencilFunc={THREE.AlwaysStencilFunc}
              stencilFail={THREE.IncrementWrapStencilOp}
              stencilZFail={THREE.IncrementWrapStencilOp}
              stencilZPass={THREE.IncrementWrapStencilOp}
            />
          </mesh>
          <mesh geometry={geometry} renderOrder={2} frustumCulled={false}>
            <meshBasicMaterial
              colorWrite={false}
              depthWrite={false}
              side={THREE.FrontSide}
              clippingPlanes={[solidPlane]}
              stencilWrite={true}
              stencilRef={0}
              stencilFunc={THREE.AlwaysStencilFunc}
              stencilFail={THREE.DecrementWrapStencilOp}
              stencilZFail={THREE.DecrementWrapStencilOp}
              stencilZPass={THREE.DecrementWrapStencilOp}
            />
          </mesh>
          <lineSegments geometry={contourGeometry} renderOrder={4} frustumCulled={false}>
            <lineBasicMaterial color={contourColor} transparent opacity={0.92} depthWrite={false} />
          </lineSegments>
        </>
      )}

      {showWireOpposite && edgeGeometry && wirePlane && (
        <lineSegments geometry={edgeGeometry} renderOrder={3}>
          <lineBasicMaterial
            color={wireColor}
            transparent
            opacity={dark ? 0.42 : 0.52}
            depthWrite={false}
            clippingPlanes={[wirePlane]}
          />
        </lineSegments>
      )}
    </group>
  );
};

/**
 * Draws a plane-aligned cross-hatched blueprint cap across all pixels where the
 * WebGL stencil buffer is non-zero, clearing the stencil buffer back to 0 as it renders.
 */
export const StencilSectionCapQuad: React.FC<{
  plane: THREE.Plane;
  center?: [number, number, number];
  size?: number;
  dark?: boolean;
}> = ({ plane, center = [0, 0, 0], size = 80, dark = true }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const accentHex = dark ? 0x67e8f9 : 0x0891b2;

  const shaderMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: SECTION_CAP_VERTEX_SHADER,
      fragmentShader: SECTION_CAP_FRAGMENT_SHADER,
      uniforms: {
        uColor: { value: new THREE.Color(accentHex) },
        uOpacity: { value: 0.9 },
        uPitch: { value: Math.max(0.03, size * 0.012) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ZeroStencilOp,
      stencilZFail: THREE.ZeroStencilOp,
      stencilZPass: THREE.ZeroStencilOp,
    });
  }, [accentHex, size]);

  useEffect(() => {
    return () => {
      shaderMat.dispose();
    };
  }, [shaderMat]);

  const zAxis = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const targetCenter = useMemo(() => new THREE.Vector3(...center), [center]);
  const projectedRef = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!meshRef.current) return;
    // Project `targetCenter` onto `plane` so the finite cap quad always covers the clipped assembly
    const projected = plane.projectPoint(targetCenter, projectedRef.current);
    meshRef.current.position.copy(projected);
    meshRef.current.quaternion.setFromUnitVectors(zAxis, plane.normal);
  });

  return (
    <mesh ref={meshRef} renderOrder={4} frustumCulled={false} material={shaderMat}>
      <planeGeometry args={[size, size]} />
    </mesh>
  );
};

function getGdtStatusColor(status?: GdtCallout3D["status"]): string {
  if (status === "FAIL") return "#ef4444";
  if (status === "MARGINAL") return "#f59e0b";
  return "#22d3ee";
}

/**
 * Renders 3D ASME Y14.5 GD&T Feature Control Frames, datum feature flags, and
 * leader lines anchored directly to 3D geometry coordinates.
 */
export const Gdt3dOverlay: React.FC<{
  payload: GdtOverlayPayload;
  lift?: number;
  dark?: boolean;
  onSelectCallout?: ((callout: GdtCallout3D) => void) | undefined;
}> = ({ payload, lift = 1.15, dark = true, onSelectCallout }) => {
  const bg = dark ? "rgba(11, 16, 27, 0.92)" : "rgba(255, 255, 255, 0.94)";
  const fg = dark ? "#f8fafc" : "#0f172a";

  return (
    <group>
      {payload.datums.map((d: GdtDatumFeature3D) => {
        const end: [number, number, number] = [d.anchor[0], d.anchor[1] - lift * 0.85, d.anchor[2]];
        return (
          <group key={`datum-${d.label}-${d.sourceRef ?? d.name}`}>
            <mesh position={d.anchor}>
              <sphereGeometry args={[0.045, 12, 12]} />
              <meshBasicMaterial color="#38bdf8" />
            </mesh>
            <Line points={[d.anchor, end]} color="#38bdf8" lineWidth={1.25} dashed dashSize={0.08} gapSize={0.05} />
            <Html position={end} center style={{ pointerEvents: "none" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: bg,
                  border: "1.5px solid #38bdf8",
                  color: fg,
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: "#38bdf8" }}>▲</span>
                <span>{d.label}</span>
              </div>
            </Html>
          </group>
        );
      })}

      {payload.callouts.map((c: GdtCallout3D, idx: number) => {
        const color = getGdtStatusColor(c.status);
        const dirY = idx % 2 === 0 ? lift : -lift;
        const end: [number, number, number] = [c.anchor[0], c.anchor[1] + dirY, c.anchor[2]];
        const mod = formatMaterialModifierGlyph(c.materialCondition);

        return (
          <group key={c.id}>
            <mesh position={c.anchor}>
              <sphereGeometry args={[0.045, 12, 12]} />
              <meshBasicMaterial color={color} />
            </mesh>
            <Line points={[c.anchor, end]} color={color} lineWidth={1.3} dashed dashSize={0.08} gapSize={0.05} />
            <Html position={end} center>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectCallout?.(c);
                }}
                title={c.note || c.label}
                style={{
                  display: "inline-flex",
                  alignItems: "stretch",
                  border: `1.5px solid ${color}`,
                  borderRadius: 4,
                  background: bg,
                  color: fg,
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 10,
                  lineHeight: 1.2,
                  padding: 0,
                  cursor: onSelectCallout ? "pointer" : "default",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    padding: "2px 5px",
                    borderRight: `1px solid ${color}`,
                    fontWeight: 700,
                    color,
                  }}
                >
                  {c.symbol}
                </span>
                <span
                  style={{
                    padding: "2px 6px",
                    borderRight: c.datums.length > 0 ? `1px solid ${color}` : undefined,
                    fontWeight: 600,
                  }}
                >
                  {c.diametrical ? "⌀" : ""}
                  {c.tolerance}
                  {mod ? ` ${mod}` : ""}
                </span>
                {c.datums.map((d, dIdx) => (
                  <span
                    key={`${c.id}-d-${dIdx}`}
                    style={{
                      padding: "2px 5px",
                      borderRight: dIdx < c.datums.length - 1 ? `1px solid ${color}` : undefined,
                      fontWeight: 700,
                    }}
                  >
                    {d.label}
                    {formatMaterialModifierGlyph(d.modifier)}
                  </span>
                ))}
              </button>
            </Html>
          </group>
        );
      })}
    </group>
  );
};

/**
 * Renders crisp Onshape-style CAD feature/crease edges over shaded geometry.
 * Automatically disposes the derived EdgesGeometry on unmount or geometry change.
 */
/**
 * Extracts crisp CAD crease edges from a `BufferGeometry`, welding sub-tolerance
 * CSG boolean vertex drift, ignoring degenerate sliver triangles, and suppressing
 * stray unpaired T-junction cracks on closed solids so curved cylinders and
 * boolean bolt-hole faces render cleanly without black scratch artifacts.
 */
export function buildCleanCreaseEdgeGeometry(
  geometry: THREE.BufferGeometry,
  thresholdAngle = 32,
): THREE.BufferGeometry {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr || posAttr.count < 3) {
    return new THREE.BufferGeometry();
  }

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const diag = bb ? bb.min.distanceTo(bb.max) : 1;
  const weldScale = Math.max(1e-4, diag * 5e-4);
  const invWeld = 1 / weldScale;
  const minAreaSq = weldScale * weldScale * 0.25;
  const planeTol = Math.max(weldScale * 3, diag * 1.5e-3);
  const invPlane = 1 / planeTol;
  const thresholdDot = Math.cos((thresholdAngle * Math.PI) / 180);

  const indexAttr = geometry.getIndex();
  const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3);

  const quantizeKey = (x: number, y: number, z: number): string =>
    `${Math.round(x * invWeld)},${Math.round(y * invWeld)},${Math.round(z * invWeld)}`;

  const canonicalPlane = (nx: number, ny: number, nz: number, px: number, py: number, pz: number) => {
    let cx = nx;
    let cy = ny;
    let cz = nz;
    if (cx < -1e-4 || (Math.abs(cx) <= 1e-4 && (cy < -1e-4 || (Math.abs(cy) <= 1e-4 && cz < 0)))) {
      cx = -cx;
      cy = -cy;
      cz = -cz;
    }
    const d = cx * px + cy * py + cz * pz;
    const nKey = `${Math.round(cx * 16)},${Math.round(cy * 16)},${Math.round(cz * 16)}`;
    const dBin = Math.round(d * invPlane);
    return { cx, cy, cz, d, nKey, dBin };
  };

  interface PlaneTri {
    triIdx: number;
    ax: number;
    ay: number;
    az: number;
    bx: number;
    by: number;
    bz: number;
    cx: number;
    cy: number;
    cz: number;
    nx: number;
    ny: number;
    nz: number;
  }

  interface EdgeEntry {
    ax: number;
    ay: number;
    az: number;
    bx: number;
    by: number;
    bz: number;
    triIdx: number;
    outX: number;
    outY: number;
    outZ: number;
    planeNKey: string;
    planeDBin: number;
    normals: Array<[number, number, number]>;
  }

  const planeBuckets = new Map<string, PlaneTri[]>();
  const edges = new Map<string, EdgeEntry>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();
  const eDir = new THREE.Vector3();
  const outDir = new THREE.Vector3();
  const toOpp = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
    const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;

    a.fromBufferAttribute(posAttr, i0);
    b.fromBufferAttribute(posAttr, i1);
    c.fromBufferAttribute(posAttr, i2);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const lenSq = n.lengthSq();
    if (lenSq < minAreaSq) continue;
    n.multiplyScalar(1 / Math.sqrt(lenSq));

    const plane = canonicalPlane(n.x, n.y, n.z, a.x, a.y, a.z);
    const pKey = `${plane.nKey}|${plane.dBin}`;
    let bucket = planeBuckets.get(pKey);
    if (!bucket) {
      bucket = [];
      planeBuckets.set(pKey, bucket);
    }
    bucket.push({
      triIdx: t,
      ax: a.x,
      ay: a.y,
      az: a.z,
      bx: b.x,
      by: b.y,
      bz: b.z,
      cx: c.x,
      cy: c.y,
      cz: c.z,
      nx: n.x,
      ny: n.y,
      nz: n.z,
    });

    const ka = quantizeKey(a.x, a.y, a.z);
    const kb = quantizeKey(b.x, b.y, b.z);
    const kc = quantizeKey(c.x, c.y, c.z);

    const triPairs: Array<[string, THREE.Vector3, string, THREE.Vector3, THREE.Vector3]> = [
      [ka, a, kb, b, c],
      [kb, b, kc, c, a],
      [kc, c, ka, a, b],
    ];

    for (const [k1, p1, k2, p2, opp] of triPairs) {
      if (k1 === k2) continue;
      const edgeKey = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      let entry = edges.get(edgeKey);
      if (!entry) {
        eDir.subVectors(p2, p1);
        outDir.crossVectors(eDir, n);
        const outLen = outDir.length();
        if (outLen > 1e-12) {
          outDir.multiplyScalar(1 / outLen);
          toOpp.subVectors(opp, p1);
          if (outDir.dot(toOpp) > 0) {
            outDir.negate();
          }
        }
        entry = {
          ax: p1.x,
          ay: p1.y,
          az: p1.z,
          bx: p2.x,
          by: p2.y,
          bz: p2.z,
          triIdx: t,
          outX: outDir.x,
          outY: outDir.y,
          outZ: outDir.z,
          planeNKey: plane.nKey,
          planeDBin: plane.dBin,
          normals: [[n.x, n.y, n.z]],
        };
        edges.set(edgeKey, entry);
      } else {
        entry.normals.push([n.x, n.y, n.z]);
      }
    }
  }

  const pointInCoplanarPlane = (
    px: number,
    py: number,
    pz: number,
    planeNKey: string,
    planeDBin: number,
    skipTriIdx: number,
  ): boolean => {
    for (let db = -1; db <= 1; db++) {
      const bucket = planeBuckets.get(`${planeNKey}|${planeDBin + db}`);
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const tri = bucket[i]!;
        if (tri.triIdx === skipTriIdx) continue;
        const dist = Math.abs((px - tri.ax) * tri.nx + (py - tri.ay) * tri.ny + (pz - tri.az) * tri.nz);
        if (dist > planeTol) continue;

        const v0x = tri.cx - tri.ax;
        const v0y = tri.cy - tri.ay;
        const v0z = tri.cz - tri.az;
        const v1x = tri.bx - tri.ax;
        const v1y = tri.by - tri.ay;
        const v1z = tri.bz - tri.az;
        const v2x = px - tri.ax;
        const v2y = py - tri.ay;
        const v2z = pz - tri.az;

        const dot00 = v0x * v0x + v0y * v0y + v0z * v0z;
        const dot01 = v0x * v1x + v0y * v1y + v0z * v1z;
        const dot02 = v0x * v2x + v0y * v2y + v0z * v2z;
        const dot11 = v1x * v1x + v1y * v1y + v1z * v1z;
        const dot12 = v1x * v2x + v1y * v2y + v1z * v2z;
        const denom = dot00 * dot11 - dot01 * dot01;
        if (denom <= 1e-18) continue;
        const invDenom = 1 / denom;
        const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
        const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
        if (u >= -2e-3 && v >= -2e-3 && u + v <= 1.002) {
          return true;
        }
      }
    }
    return false;
  };

  let pairedEdges = 0;
  let unpairedEdges = 0;
  for (const entry of edges.values()) {
    if (entry.normals.length >= 2) pairedEdges++;
    else unpairedEdges++;
  }
  // On closed CSG solids (including heavily BSP-split boolean meshes), unpaired edges are T-junction cracks, not real boundaries.
  const suppressStrayCracks = pairedEdges > unpairedEdges * 1.2;

  const positions: number[] = [];
  for (const entry of edges.values()) {
    const count = entry.normals.length;
    let keep = false;
    if (count === 1) {
      if (!suppressStrayCracks) {
        const dx = entry.bx - entry.ax;
        const dy = entry.by - entry.ay;
        const dz = entry.bz - entry.az;
        const edgeLen = Math.hypot(dx, dy, dz);
        const probeEps = Math.min(edgeLen * 0.2, Math.max(weldScale * 5, diag * 2.5e-3));
        const isCoplanarTJunction =
          pointInCoplanarPlane(
            entry.ax + dx * 0.5 + entry.outX * probeEps,
            entry.ay + dy * 0.5 + entry.outY * probeEps,
            entry.az + dz * 0.5 + entry.outZ * probeEps,
            entry.planeNKey,
            entry.planeDBin,
            entry.triIdx,
          ) ||
          pointInCoplanarPlane(
            entry.ax + dx * 0.25 + entry.outX * probeEps,
            entry.ay + dy * 0.25 + entry.outY * probeEps,
            entry.az + dz * 0.25 + entry.outZ * probeEps,
            entry.planeNKey,
            entry.planeDBin,
            entry.triIdx,
          ) ||
          pointInCoplanarPlane(
            entry.ax + dx * 0.75 + entry.outX * probeEps,
            entry.ay + dy * 0.75 + entry.outY * probeEps,
            entry.az + dz * 0.75 + entry.outZ * probeEps,
            entry.planeNKey,
            entry.planeDBin,
            entry.triIdx,
          );
        keep = !isCoplanarTJunction;
      }
    } else if (count >= 2) {
      const n0 = entry.normals[0]!;
      for (let i = 1; i < count; i++) {
        const ni = entry.normals[i]!;
        const absDot = Math.abs(n0[0] * ni[0] + n0[1] * ni[1] + n0[2] * ni[2]);
        if (absDot <= thresholdDot) {
          keep = true;
          break;
        }
      }
    }
    if (keep) {
      positions.push(entry.ax, entry.ay, entry.az, entry.bx, entry.by, entry.bz);
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return out;
}

export const CadEdgeOverlay: React.FC<{
  geometry: THREE.BufferGeometry;
  position?: [number, number, number];
  thresholdAngle?: number;
  dark?: boolean;
  color?: string;
  opacity?: number;
  clippingPlanes?: THREE.Plane[];
}> = ({
  geometry,
  position = [0, 0, 0],
  thresholdAngle = 32,
  dark = true,
  color,
  opacity = 0.78,
  clippingPlanes = [],
}) => {
  const edgeGeometry = useMemo(
    () => buildCleanCreaseEdgeGeometry(geometry, thresholdAngle),
    [geometry, thresholdAngle],
  );

  useEffect(() => {
    return () => {
      edgeGeometry.dispose();
    };
  }, [edgeGeometry]);

  const edgeColor = color ?? (dark ? "#0f172a" : "#1e293b");

  return (
    <lineSegments geometry={edgeGeometry} position={position} renderOrder={1}>
      <lineBasicMaterial
        color={edgeColor}
        transparent={opacity < 1.0}
        opacity={opacity}
        clippingPlanes={clippingPlanes}
      />
    </lineSegments>
  );
};

/**
 * Screen-Space Ambient Occlusion (SSAO) post-processing pass for CAD cavities,
 * louvers, and contact seams. Only hijacks R3F rendering when `enabled` is true.
 */
export const StudioSsaoPass: React.FC<{
  enabled?: boolean;
  kernelRadius?: number;
  minDistance?: number;
  maxDistance?: number;
}> = ({ enabled = true, kernelRadius = 0.25, minDistance = 0.001, maxDistance = 0.08 }) => {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  const ssaoRef = useRef<SSAOPass | null>(null);

  useEffect(() => {
    if (!enabled) {
      ssaoRef.current?.dispose();
      composerRef.current?.dispose();
      composerRef.current = null;
      ssaoRef.current = null;
      return;
    }

    const composer = new EffectComposer(gl);
    const renderPass = new RenderPass(scene, camera);
    const ssaoPass = new SSAOPass(scene, camera, Math.max(1, size.width), Math.max(1, size.height));
    ssaoPass.kernelRadius = kernelRadius;
    ssaoPass.minDistance = minDistance;
    ssaoPass.maxDistance = maxDistance;
    ssaoPass.output = SSAOPass.OUTPUT.Default;
    const outputPass = new OutputPass();

    composer.addPass(renderPass);
    composer.addPass(ssaoPass);
    composer.addPass(outputPass);

    composerRef.current = composer;
    ssaoRef.current = ssaoPass;

    return () => {
      ssaoPass.dispose();
      composer.dispose();
      composerRef.current = null;
      ssaoRef.current = null;
    };
  }, [enabled, gl, scene, camera, kernelRadius, minDistance, maxDistance]);

  useEffect(() => {
    if (!enabled || !composerRef.current) return;
    composerRef.current.setSize(Math.max(1, size.width), Math.max(1, size.height));
    ssaoRef.current?.setSize(Math.max(1, size.width), Math.max(1, size.height));
  }, [enabled, size.width, size.height]);

  useFrame(
    () => {
      if (enabled && composerRef.current) {
        composerRef.current.render();
      }
    },
    enabled ? 1 : 0,
  );

  return null;
};
