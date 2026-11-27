// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AssemblyVisibilityState } from "@modelscript/cad-viewer/assembly-visibility.js";
import { useRetainGltfUrl } from "@modelscript/cad-viewer/gltf-cache-guard.js";
import {
  ensureGeometryBrushedUvs,
  getCachedHeroPbrTextures,
  HERO_BRUSHED_NORMAL_SCALE,
  HERO_DETAIL_NORMAL_SCALE,
  resolveHeroSurfaceParams,
  type HeroSurfaceFinish,
} from "@modelscript/cad-viewer/HeroCadMaterials.js";
import { VtkRenderer } from "@modelscript/cad-viewer/VtkRenderer.js";
import { Line, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import React, { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OctopusShowcaseAssembly } from "./OctopusShowcaseAssembly.js";
import {
  computeGeometryCaeVertexColors,
  createCaeFieldGradientTexture,
  sampleCaeFieldRgb,
  type CaeFieldOverlayMode,
} from "./procedural-pbr.js";
import {
  EvBatteryPackAssembly,
  HexacopterDroneAssembly,
  OrbitalSatelliteAssembly,
  WindTurbineAssembly,
} from "./ShowcaseAssemblies.js";
import {
  clampNumber,
  isLoadableGltfUri,
  PLINTH_MODEL_NORMALIZED_SIZE,
  type RotundaAnimationControllerLike,
  type RotundaCadPartInput,
  type RotundaCaeOverlay,
  type RotundaModelEntry,
  type RotundaRenderStyle,
} from "./types.js";

export interface HeroModelAssetProps {
  model: RotundaModelEntry;
  explodeFactor: number; // 0..1 radial/hierarchical assembly explosion
  caeOverlay: RotundaCaeOverlay; // "none" | "fea-stress" | "cfd-flow" | "thermal"
  renderStyle: RotundaRenderStyle; // "shaded" | "wireframe" | "xray"
  simulationTime: number;
  simulationTimeRef?: React.RefObject<number> | undefined;
  isPlaying: boolean;
  clippingPlanes: THREE.Plane[];
  animationController?: RotundaAnimationControllerLike | null | undefined;
  isGhost?: boolean | undefined; // translucent hologram styling for prev/next carousel previews
  ghostOpacity?: number | undefined;
  visibility?: AssemblyVisibilityState | undefined;
  isInXr?: boolean | undefined;
  dark?: boolean | undefined;
  onSelectSubsystem?: ((subsystemId: string) => void) | undefined;
}

function readLiveSimTime(simulationTime: number, simulationTimeRef?: React.RefObject<number> | undefined): number {
  const refVal = simulationTimeRef?.current;
  return typeof refVal === "number" && Number.isFinite(refVal) ? refVal : simulationTime;
}

// ── Color Palettes & Material Resolution ────────────────────────────────────

const TURBO_STOPS: ReadonlyArray<[number, number, number]> = [
  [0x1d / 255, 0x4e / 255, 0xd8 / 255], // cool deep blue
  [0x06 / 255, 0xb6 / 255, 0xd4 / 255], // cyan
  [0x22 / 255, 0xc5 / 255, 0x5e / 255], // emerald
  [0xfa / 255, 0xcc / 255, 0x15 / 255], // amber yellow
  [0xef / 255, 0x44 / 255, 0x44 / 255], // crimson hotspot
];

const THERMAL_STOPS: ReadonlyArray<[number, number, number]> = [
  [0x1e / 255, 0x1b / 255, 0x4b / 255], // deep indigo
  [0x7e / 255, 0x22 / 255, 0xce / 255], // violet
  [0xdb / 255, 0x27 / 255, 0x77 / 255], // magenta
  [0xf5 / 255, 0x9e / 255, 0x0b / 255], // amber
  [0xfe / 255, 0xf9 / 255, 0xc3 / 255], // white-hot core
];

const SHARED_CAE_GRADIENT_TEXTURES: Partial<Record<CaeFieldOverlayMode, THREE.DataTexture>> = {};

function getSharedCaeGradientTexture(mode: CaeFieldOverlayMode): THREE.DataTexture {
  let tex = SHARED_CAE_GRADIENT_TEXTURES[mode];
  if (!tex) {
    tex = createCaeFieldGradientTexture(mode, 128);
    SHARED_CAE_GRADIENT_TEXTURES[mode] = tex;
  }
  return tex;
}

function sampleGradientHex(stops: ReadonlyArray<[number, number, number]>, tRaw: number): string {
  const t = clampNumber(tRaw, 0, 1);
  const maxIdx = stops.length - 1;
  const scaled = t * maxIdx;
  const i0 = Math.min(maxIdx, Math.floor(scaled));
  const i1 = Math.min(maxIdx, i0 + 1);
  const f = scaled - i0;
  const c0 = stops[i0] ?? [0.2, 0.5, 0.9];
  const c1 = stops[i1] ?? c0;
  const r = Math.round((c0[0] + (c1[0] - c0[0]) * f) * 255);
  const g = Math.round((c0[1] + (c1[1] - c0[1]) * f) * 255);
  const b = Math.round((c0[2] + (c1[2] - c0[2]) * f) * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function sampleTurboStressColor(t: number): string {
  return sampleGradientHex(TURBO_STOPS, t);
}

function sampleThermalColor(t: number): string {
  return sampleGradientHex(THERMAL_STOPS, t);
}

export interface PartMaterialProps {
  finish?: HeroSurfaceFinish | undefined;
  baseColor?: string | undefined;
  metalness?: number | undefined;
  roughness?: number | undefined;
  clearcoat?: number | undefined;
  clearcoatRoughness?: number | undefined;
  anisotropy?: number | undefined;
  envMapIntensity?: number | undefined;
  emissive?: string | undefined;
  emissiveIntensity?: number | undefined;
  stressFactor?: number | undefined;
  thermalFactor?: number | undefined;
  doubleSide?: boolean | undefined;
  useVertexColors?: boolean | undefined;
  renderStyle: RotundaRenderStyle;
  caeOverlay: RotundaCaeOverlay;
  isGhost: boolean;
  ghostOpacity: number;
  clippingPlanes: THREE.Plane[];
  simulationTime: number;
}

/**
 * Shared photoreal PBR/CAE/Hologram material component backed by `MeshPhysicalMaterial`
 * with calibrated studio finishes (brushed/anodized aluminium, satin steel, copper, brass,
 * clearcoated ceramics, matte rubber) that cleanly honors clipping planes, render styles
 * (shaded/wireframe/xray), live scientific CAE contour overlays, and ghost hologram styling.
 */
export function PartMaterial({
  finish,
  baseColor,
  metalness,
  roughness,
  clearcoat,
  clearcoatRoughness,
  anisotropy,
  envMapIntensity,
  emissive = "#000000",
  emissiveIntensity = 0,
  stressFactor = 0.45,
  thermalFactor = 0.45,
  doubleSide = false,
  useVertexColors = false,
  renderStyle,
  caeOverlay,
  isGhost,
  ghostOpacity,
  clippingPlanes,
  simulationTime,
}: PartMaterialProps): React.ReactElement {
  const gl = useThree((s) => s.gl);
  const pbrMaps = useMemo(() => getCachedHeroPbrTextures(gl), [gl]);
  const matRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const isInXr = useXR((s) => s.session != null);

  const surface = resolveHeroSurfaceParams({
    finish,
    baseColor,
    metalness,
    roughness,
    clearcoat,
    clearcoatRoughness,
    anisotropy,
    envMapIntensity,
  });

  const effectivePlanes = isGhost ? EMPTY_PLANES : clippingPlanes;
  const hasClipping = effectivePlanes.length > 0;
  const activeVertexColors = !isGhost && useVertexColors && caeOverlay !== "none" && renderStyle === "shaded";
  const activeContourMap: THREE.DataTexture | null =
    !isGhost &&
    !activeVertexColors &&
    renderStyle === "shaded" &&
    (caeOverlay === "fea-stress" || caeOverlay === "thermal")
      ? getSharedCaeGradientTexture(caeOverlay)
      : null;

  const enableSurfaceMaps =
    !isGhost &&
    renderStyle === "shaded" &&
    !activeVertexColors &&
    !activeContourMap &&
    (caeOverlay === "none" || caeOverlay === "cfd-flow") &&
    surface.mapMode !== "none";

  const activeNormalMap: THREE.DataTexture | null = enableSurfaceMaps
    ? surface.mapMode === "detail"
      ? pbrMaps.detailNormal
      : pbrMaps.normal
    : null;
  const activeNormalScale = surface.mapMode === "detail" ? HERO_DETAIL_NORMAL_SCALE : HERO_BRUSHED_NORMAL_SCALE;
  const activeRoughnessMap: THREE.DataTexture | null = enableSurfaceMaps
    ? surface.mapMode === "detail"
      ? pbrMaps.detailRoughness
      : pbrMaps.roughness
    : null;

  const isWireframe = renderStyle === "wireframe";
  const isXray = renderStyle === "xray";

  let resolvedColor = surface.color;
  let resolvedEmissive = emissive;
  let resolvedEmissiveIntensity = emissiveIntensity;
  let resolvedMetalness = surface.metalness;
  let resolvedRoughness = surface.roughness;
  let resolvedClearcoat = surface.clearcoat;
  let resolvedClearcoatRoughness = surface.clearcoatRoughness;
  let resolvedAnisotropy = surface.anisotropy;
  let resolvedIridescence = surface.iridescence;
  let resolvedEnvMapIntensity = surface.envMapIntensity;

  if (isGhost) {
    resolvedColor = "#38bdf8";
    resolvedEmissive = "#1d4ed8";
    resolvedEmissiveIntensity = 0.55;
    resolvedMetalness = 0.2;
    resolvedRoughness = 0.25;
    resolvedClearcoat = 0;
    resolvedClearcoatRoughness = 0;
    resolvedAnisotropy = 0;
    resolvedIridescence = 0;
    resolvedEnvMapIntensity = 0.6;
  } else if (activeVertexColors) {
    // Let the true per-vertex Von Mises / CFD Cp / Thermal colors define the surface cleanly
    resolvedColor = "#ffffff";
    resolvedEmissive = "#000000";
    resolvedEmissiveIntensity = 0;
    resolvedMetalness = caeOverlay === "cfd-flow" ? 0.24 : 0.14;
    resolvedRoughness = caeOverlay === "cfd-flow" ? 0.36 : 0.42;
    resolvedClearcoat = 0;
    resolvedClearcoatRoughness = 0;
    resolvedAnisotropy = 0;
    resolvedIridescence = 0;
    resolvedEnvMapIntensity = 0.85;
  } else if (caeOverlay === "fea-stress") {
    const dynamicStress = clampNumber(stressFactor + 0.05 * Math.sin(simulationTime * 1.8 + stressFactor * 4.2), 0, 1);
    resolvedColor = activeContourMap ? "#ffffff" : sampleTurboStressColor(dynamicStress);
    resolvedEmissive = activeContourMap ? "#000000" : resolvedColor;
    resolvedEmissiveIntensity = activeContourMap ? 0 : 0.16 + dynamicStress * 0.24;
    resolvedMetalness = 0.16;
    resolvedRoughness = 0.44;
    resolvedClearcoat = 0;
    resolvedClearcoatRoughness = 0;
    resolvedAnisotropy = 0;
    resolvedIridescence = 0;
    resolvedEnvMapIntensity = 0.85;
  } else if (caeOverlay === "thermal") {
    const dynamicThermal = clampNumber(
      thermalFactor + 0.06 * Math.sin(simulationTime * 1.6 + thermalFactor * 3.1),
      0,
      1,
    );
    resolvedColor = activeContourMap ? "#ffffff" : sampleThermalColor(dynamicThermal);
    resolvedEmissive = activeContourMap ? "#000000" : resolvedColor;
    resolvedEmissiveIntensity = activeContourMap ? 0 : 0.24 + dynamicThermal * 0.4;
    resolvedMetalness = 0.14;
    resolvedRoughness = 0.46;
    resolvedClearcoat = 0;
    resolvedClearcoatRoughness = 0;
    resolvedAnisotropy = 0;
    resolvedIridescence = 0;
    resolvedEnvMapIntensity = 0.85;
  } else if (caeOverlay === "cfd-flow") {
    resolvedEmissive = "#0284c7";
    resolvedEmissiveIntensity = Math.max(emissiveIntensity, 0.08);
  }

  if (!isGhost && isWireframe) {
    resolvedColor = caeOverlay === "none" ? "#22d3ee" : resolvedColor;
    resolvedEmissive = caeOverlay === "none" ? "#06b6d4" : resolvedColor;
    resolvedEmissiveIntensity = 0.78;
    resolvedMetalness = 0.2;
    resolvedRoughness = 0.3;
    resolvedClearcoat = 0;
    resolvedAnisotropy = 0;
    resolvedIridescence = 0;
  } else if (!isGhost && isXray) {
    resolvedColor = caeOverlay === "none" ? "#38bdf8" : resolvedColor;
    resolvedEmissive = caeOverlay === "none" ? "#0ea5e9" : resolvedColor;
    resolvedEmissiveIntensity = 0.42;
    resolvedMetalness = 0.12;
    resolvedRoughness = 0.18;
    resolvedClearcoat = 0;
    resolvedAnisotropy = 0;
    resolvedIridescence = 0;
  }

  const resolvedTransparent = isGhost || isWireframe || isXray;
  const resolvedOpacity = isGhost ? clampNumber(ghostOpacity, 0.05, 0.85) : isWireframe ? 0.92 : isXray ? 0.28 : 1.0;
  const resolvedDepthWrite = !isGhost && !isXray;
  const resolvedSide =
    isXray || (!isGhost && (hasClipping || doubleSide)) || (isGhost && doubleSide) ? THREE.DoubleSide : THREE.FrontSide;

  const prevStateRef = useRef<{
    hasClipping: boolean;
    vertexColors: boolean;
    hasMap: boolean;
    hasNormalMap: boolean;
    hasRoughnessMap: boolean;
    wireframe: boolean;
    transparent: boolean;
    side: THREE.Side;
  }>({
    hasClipping,
    vertexColors: activeVertexColors,
    hasMap: activeContourMap !== null,
    hasNormalMap: activeNormalMap !== null,
    hasRoughnessMap: activeRoughnessMap !== null,
    wireframe: isWireframe,
    transparent: resolvedTransparent,
    side: resolvedSide,
  });

  // Synchronize Three.js material flags explicitly so wireframe <-> xray <-> shaded never leaves stale state
  useEffect(() => {
    const mat = matRef.current;
    if (!mat) return;
    mat.clippingPlanes = effectivePlanes;
    mat.vertexColors = activeVertexColors;
    mat.map = activeContourMap;
    mat.normalMap = activeNormalMap;
    mat.roughnessMap = activeRoughnessMap;
    mat.wireframe = isWireframe;
    mat.transparent = resolvedTransparent;
    mat.opacity = resolvedOpacity;
    mat.depthWrite = resolvedDepthWrite;
    mat.side = resolvedSide;
    const prev = prevStateRef.current;
    const hasMap = activeContourMap !== null;
    const hasNormalMap = activeNormalMap !== null;
    const hasRoughnessMap = activeRoughnessMap !== null;
    if (
      prev.hasClipping !== hasClipping ||
      prev.vertexColors !== activeVertexColors ||
      prev.hasMap !== hasMap ||
      prev.hasNormalMap !== hasNormalMap ||
      prev.hasRoughnessMap !== hasRoughnessMap ||
      prev.wireframe !== isWireframe ||
      prev.transparent !== resolvedTransparent ||
      prev.side !== resolvedSide
    ) {
      prevStateRef.current = {
        hasClipping,
        vertexColors: activeVertexColors,
        hasMap,
        hasNormalMap,
        hasRoughnessMap,
        wireframe: isWireframe,
        transparent: resolvedTransparent,
        side: resolvedSide,
      };
      mat.needsUpdate = true;
    }
  }, [
    effectivePlanes,
    hasClipping,
    activeVertexColors,
    activeContourMap,
    activeNormalMap,
    activeRoughnessMap,
    isWireframe,
    resolvedTransparent,
    resolvedOpacity,
    resolvedDepthWrite,
    resolvedSide,
    isInXr,
  ]);

  if (isInXr) {
    return (
      <meshStandardMaterial
        key="part-xr-std"
        ref={matRef}
        color={resolvedColor}
        map={activeContourMap}
        normalMap={activeNormalMap}
        normalScale={activeNormalScale}
        roughnessMap={activeRoughnessMap}
        vertexColors={activeVertexColors}
        emissive={resolvedEmissive}
        emissiveIntensity={resolvedEmissiveIntensity}
        metalness={resolvedMetalness}
        roughness={resolvedRoughness}
        wireframe={isWireframe}
        transparent={resolvedTransparent}
        opacity={resolvedOpacity}
        depthWrite={resolvedDepthWrite}
        envMapIntensity={resolvedEnvMapIntensity}
        side={resolvedSide}
        clippingPlanes={effectivePlanes}
        clipShadows={hasClipping}
      />
    );
  }

  return (
    <meshPhysicalMaterial
      key="part-desk-phys"
      ref={matRef}
      color={resolvedColor}
      map={activeContourMap}
      normalMap={activeNormalMap}
      normalScale={activeNormalScale}
      roughnessMap={activeRoughnessMap}
      vertexColors={activeVertexColors}
      emissive={resolvedEmissive}
      emissiveIntensity={resolvedEmissiveIntensity}
      metalness={resolvedMetalness}
      roughness={resolvedRoughness}
      wireframe={isWireframe}
      transparent={resolvedTransparent}
      opacity={resolvedOpacity}
      depthWrite={resolvedDepthWrite}
      anisotropy={resolvedAnisotropy}
      anisotropyRotation={surface.anisotropyRotation}
      clearcoat={resolvedClearcoat}
      clearcoatRoughness={resolvedClearcoatRoughness}
      iridescence={resolvedIridescence}
      iridescenceIOR={surface.iridescenceIOR}
      envMapIntensity={resolvedEnvMapIntensity}
      side={resolvedSide}
      clippingPlanes={effectivePlanes}
      clipShadows={hasClipping}
    />
  );
}

const EMPTY_PLANES: THREE.Plane[] = [];

// ── Error Boundary ──────────────────────────────────────────────────────────

interface HeroAssetErrorBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface HeroAssetErrorBoundaryState {
  hasError: boolean;
}

class HeroAssetErrorBoundary extends React.Component<HeroAssetErrorBoundaryProps, HeroAssetErrorBoundaryState> {
  override state: HeroAssetErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): HeroAssetErrorBoundaryState {
    return { hasError: true };
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// ── Shared Exploded Assembly Leader Lines ───────────────────────────────────

interface LeaderLineSpec {
  id: string;
  from: [number, number, number];
  to: [number, number, number];
  color?: string | undefined;
}

function ExplodeLeaderLines({
  lines,
  explodeFactor,
  isGhost,
}: {
  lines: readonly LeaderLineSpec[];
  explodeFactor: number;
  isGhost: boolean;
}): React.ReactElement | null {
  if (isGhost || explodeFactor <= 0.04 || lines.length === 0) return null;
  const opacity = clampNumber((explodeFactor - 0.04) * 1.4, 0.15, 0.78);
  return (
    <group>
      {lines.map((line) => (
        <Line
          key={line.id}
          points={[line.from, line.to]}
          color={line.color ?? "#38bdf8"}
          lineWidth={1.5}
          dashed={true}
          dashSize={0.028}
          gapSize={0.018}
          transparent={true}
          opacity={opacity}
        />
      ))}
    </group>
  );
}

// ── Shared Assembly Props ───────────────────────────────────────────────────

interface ProceduralAssemblyProps {
  explodeFactor: number;
  caeOverlay: RotundaCaeOverlay;
  renderStyle: RotundaRenderStyle;
  simulationTime: number;
  simulationTimeRef?: React.RefObject<number> | undefined;
  clippingPlanes: THREE.Plane[];
  isGhost: boolean;
  ghostOpacity: number;
  accentColor: string;
}

// ── Assembly 1: Robotic Harmonic Servo Actuator ("cad" | "step" | "generic") ─

const SERVO_ANGLES_6 = [0, 1, 2, 3, 4, 5].map((i) => (i * Math.PI) / 3);
const SERVO_ANGLES_3 = [0, 1, 2].map((i) => (i * Math.PI * 2) / 3);

function HarmonicServoActuator({
  explodeFactor,
  caeOverlay,
  renderStyle,
  simulationTime,
  simulationTimeRef,
  clippingPlanes,
  isGhost,
  ghostOpacity,
  accentColor,
}: ProceduralAssemblyProps): React.ReactElement {
  const e = clampNumber(explodeFactor, 0, 1);
  const carrierGroupRef = useRef<THREE.Group | null>(null);
  const shaftGroupRef = useRef<THREE.Group | null>(null);
  const satGroupRefs = useRef<Array<THREE.Group | null>>([]);

  const initialTime = readLiveSimTime(simulationTime, simulationTimeRef);
  const carrierAngle = initialTime * 0.85;
  const satelliteSpin = -initialTime * 2.55;
  const shaftSpin = initialTime * 1.45;

  const baseY = 0.04 - e * 0.16;
  const statorY = 0.21;
  const coilsY = 0.22 + e * 0.06;
  const coilRadOffset = e * 0.24;
  const carrierY = 0.35 + e * 0.2;
  const satY = 0.39 + e * 0.32;
  const satOrbitR = 0.11 + e * 0.2;
  const shaftY = 0.45 + e * 0.44;
  const capY = 0.56 + e * 0.58;
  const fastenerY = 0.62 + e * 0.72;

  useFrame(() => {
    const t = readLiveSimTime(simulationTime, simulationTimeRef);
    const liveCarrier = t * 0.85;
    const liveSatSpin = -t * 2.55;
    const liveShaftSpin = t * 1.45;
    if (carrierGroupRef.current) {
      carrierGroupRef.current.rotation.y = liveCarrier;
    }
    if (shaftGroupRef.current) {
      shaftGroupRef.current.rotation.y = liveShaftSpin;
    }
    for (let i = 0; i < SERVO_ANGLES_3.length; i++) {
      const sat = satGroupRefs.current[i];
      if (!sat) continue;
      const orbitAngle = (SERVO_ANGLES_3[i] ?? 0) + liveCarrier;
      sat.position.set(Math.cos(orbitAngle) * satOrbitR, 0, Math.sin(orbitAngle) * satOrbitR);
      sat.rotation.y = liveSatSpin;
    }
  });

  const leaderLines = useMemo<LeaderLineSpec[]>(() => {
    if (e <= 0.04 || isGhost) return [];
    const specs: LeaderLineSpec[] = [
      { id: "base", from: [0, 0.04, 0], to: [0, baseY, 0], color: "#38bdf8" },
      { id: "carrier", from: [0, 0.35, 0], to: [0, carrierY, 0], color: "#38bdf8" },
      { id: "shaft", from: [0, 0.45, 0], to: [0, shaftY, 0], color: "#67e8f9" },
      { id: "cap", from: [0, 0.56, 0], to: [0, capY, 0], color: "#38bdf8" },
      { id: "fasteners", from: [0, 0.62, 0], to: [0, fastenerY, 0], color: "#94a3b8" },
    ];
    for (let i = 0; i < SERVO_ANGLES_3.length; i++) {
      const a = (SERVO_ANGLES_3[i] ?? 0) + carrierAngle;
      specs.push({
        id: `sat-${i}`,
        from: [Math.cos(a) * 0.11, 0.39, Math.sin(a) * 0.11],
        to: [Math.cos(a) * satOrbitR, satY, Math.sin(a) * satOrbitR],
        color: "#f59e0b",
      });
    }
    return specs;
  }, [e, isGhost, baseY, carrierY, shaftY, capY, fastenerY, satOrbitR, satY, carrierAngle]);

  const sharedMat = {
    renderStyle,
    caeOverlay,
    isGhost,
    ghostOpacity,
    clippingPlanes,
    simulationTime,
  };

  return (
    <group>
      {/* 1. Base Mounting Flange Ring + 6 perimeter bolt bosses */}
      <group position={[0, baseY, 0]}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.31, 0.33, 0.06, 40]} />
          <PartMaterial
            {...sharedMat}
            finish="dark-anodized"
            baseColor="#6c7582"
            stressFactor={0.32}
            thermalFactor={0.24}
          />
        </mesh>
        {SERVO_ANGLES_6.map((angle, idx) => (
          <mesh
            key={`flange-boss-${idx}`}
            position={[Math.cos(angle) * 0.275, 0.036, Math.sin(angle) * 0.275]}
            castShadow
            receiveShadow
          >
            <cylinderGeometry args={[0.022, 0.022, 0.026, 12]} />
            <PartMaterial {...sharedMat} finish="polished-steel" stressFactor={0.48} thermalFactor={0.22} />
          </mesh>
        ))}
      </group>

      {/* 2. Stator Housing Shell with cooling ribs */}
      <group position={[0, statorY, 0]}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.255, 0.265, 0.26, 36]} />
          <PartMaterial
            {...sharedMat}
            finish="anodized-aluminum"
            baseColor="#8d96a4"
            stressFactor={0.44}
            thermalFactor={0.62}
          />
        </mesh>
        {[-0.08, -0.025, 0.03, 0.085].map((finY, idx) => (
          <mesh key={`fin-${idx}`} position={[0, finY, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <torusGeometry args={[0.268, 0.013, 10, 40]} />
            <PartMaterial
              {...sharedMat}
              finish="brushed-aluminum"
              baseColor="#dce0e6"
              stressFactor={0.4 + idx * 0.04}
              thermalFactor={0.68}
            />
          </mesh>
        ))}
      </group>

      {/* 3. Copper Winding Coils (6 radial stator poles) */}
      <group position={[0, coilsY, 0]}>
        {SERVO_ANGLES_6.map((angle, idx) => {
          const r = 0.165 + coilRadOffset;
          return (
            <group
              key={`coil-${idx}`}
              position={[Math.cos(angle) * r, 0, Math.sin(angle) * r]}
              rotation={[0, -angle, 0]}
            >
              <mesh castShadow receiveShadow>
                <boxGeometry args={[0.068, 0.15, 0.078]} />
                <PartMaterial {...sharedMat} finish="copper" stressFactor={0.54} thermalFactor={0.96} />
              </mesh>
            </group>
          );
        })}
      </group>

      {/* 4. Planetary Carrier Gear & Ring */}
      <group ref={carrierGroupRef} position={[0, carrierY, 0]} rotation={[0, carrierAngle, 0]}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.21, 0.21, 0.044, 32]} />
          <PartMaterial
            {...sharedMat}
            finish="satin-steel"
            baseColor="#a6aeb8"
            stressFactor={0.78}
            thermalFactor={0.74}
          />
        </mesh>
        <mesh position={[0, 0.032, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.065, 0.065, 0.056, 18]} />
          <PartMaterial {...sharedMat} finish="polished-steel" stressFactor={0.86} thermalFactor={0.78} />
        </mesh>
      </group>

      {/* 5. Three Satellite Planetary Gears (orbit + spin smoothly at 72Hz via ref) */}
      <group position={[0, satY, 0]}>
        {SERVO_ANGLES_3.map((baseAngle, idx) => {
          const orbitAngle = baseAngle + carrierAngle;
          return (
            <group
              key={`sat-${idx}`}
              ref={(el) => {
                satGroupRefs.current[idx] = el;
              }}
              position={[Math.cos(orbitAngle) * satOrbitR, 0, Math.sin(orbitAngle) * satOrbitR]}
              rotation={[0, satelliteSpin, 0]}
            >
              <mesh castShadow receiveShadow>
                <cylinderGeometry args={[0.054, 0.054, 0.052, 16]} />
                <PartMaterial {...sharedMat} finish="brass" stressFactor={0.89} thermalFactor={0.76} />
              </mesh>
              <mesh position={[0, 0.034, 0]} castShadow receiveShadow>
                <cylinderGeometry args={[0.018, 0.018, 0.024, 12]} />
                <PartMaterial
                  {...sharedMat}
                  finish="dark-anodized"
                  baseColor="#525b68"
                  stressFactor={0.82}
                  thermalFactor={0.7}
                />
              </mesh>
            </group>
          );
        })}
      </group>

      {/* 6. Output Shaft Spline */}
      <group ref={shaftGroupRef} position={[0, shaftY, 0]} rotation={[0, shaftSpin, 0]}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.048, 0.058, 0.22, 16]} />
          <PartMaterial
            {...sharedMat}
            finish="polished-steel"
            baseColor="#d8dce0"
            stressFactor={0.95}
            thermalFactor={0.58}
          />
        </mesh>
        {[0, 1, 2, 3].map((sIdx) => {
          const a = (sIdx * Math.PI) / 2;
          return (
            <mesh
              key={`spline-${sIdx}`}
              position={[Math.cos(a) * 0.05, 0.02, Math.sin(a) * 0.05]}
              rotation={[0, -a, 0]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[0.018, 0.14, 0.014]} />
              <PartMaterial {...sharedMat} finish="satin-steel" stressFactor={0.96} thermalFactor={0.56} />
            </mesh>
          );
        })}
      </group>

      {/* 7. Top Optical Encoder Cap + Accent Ring */}
      <group position={[0, capY, 0]}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.205, 0.23, 0.068, 36]} />
          <PartMaterial
            {...sharedMat}
            finish="ceramic-grey"
            baseColor="#dfe5ec"
            stressFactor={0.24}
            thermalFactor={0.42}
          />
        </mesh>
        <mesh position={[0, 0.036, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.175, 0.01, 10, 40]} />
          <PartMaterial
            {...sharedMat}
            finish="painted"
            baseColor={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.42}
            stressFactor={0.22}
            thermalFactor={0.38}
          />
        </mesh>
      </group>

      {/* 8. Crown Socket-Head Fasteners (6 bolts) */}
      <group position={[0, fastenerY, 0]}>
        {SERVO_ANGLES_6.map((angle, idx) => {
          const r = 0.17 + e * 0.04;
          return (
            <mesh key={`cap-bolt-${idx}`} position={[Math.cos(angle) * r, 0, Math.sin(angle) * r]} castShadow>
              <cylinderGeometry args={[0.016, 0.016, 0.034, 6]} />
              <PartMaterial
                {...sharedMat}
                finish="dark-anodized"
                baseColor="#505966"
                stressFactor={0.62}
                thermalFactor={0.28}
              />
            </mesh>
          );
        })}
      </group>

      <ExplodeLeaderLines lines={leaderLines} explodeFactor={e} isGhost={isGhost} />
    </group>
  );
}

// ── Assembly 2: Aerospace Cantilever Ribbed Bracket ("fea") ─────────────────

const BRACKET_BOLT_CORNERS: ReadonlyArray<[number, number]> = [
  [-0.14, 0.14],
  [0.14, 0.14],
  [-0.14, -0.14],
  [0.14, -0.14],
];

function AerospaceCantileverBracket({
  explodeFactor,
  caeOverlay,
  renderStyle,
  simulationTime,
  simulationTimeRef,
  clippingPlanes,
  isGhost,
  ghostOpacity,
}: ProceduralAssemblyProps): React.ReactElement {
  const e = clampNumber(explodeFactor, 0, 1);
  const beamGroupRef = useRef<THREE.Group | null>(null);
  const clevisGroupRef = useRef<THREE.Group | null>(null);

  const initialTime = readLiveSimTime(simulationTime, simulationTimeRef);
  const flexAngle = Math.sin(initialTime * 2.5) * 0.048;

  const plateX = -0.26 - e * 0.2;
  const boltsX = -0.32 - e * 0.36;
  const beamX = -0.02 + e * 0.08;
  const clevisX = 0.31 + e * 0.34;
  const centerY = 0.34;

  useFrame(() => {
    const t = readLiveSimTime(simulationTime, simulationTimeRef);
    const liveFlex = Math.sin(t * 2.5) * 0.048;
    if (beamGroupRef.current) {
      beamGroupRef.current.rotation.z = liveFlex;
    }
    if (clevisGroupRef.current) {
      clevisGroupRef.current.position.y = centerY + e * 0.18 + Math.sin(liveFlex) * 0.32;
      clevisGroupRef.current.rotation.z = liveFlex * 1.15;
    }
  });

  const leaderLines = useMemo<LeaderLineSpec[]>(() => {
    if (e <= 0.04 || isGhost) return [];
    return [
      { id: "plate", from: [-0.26, centerY, 0], to: [plateX, centerY, 0], color: "#38bdf8" },
      { id: "bolts", from: [-0.32, centerY, 0], to: [boltsX, centerY, 0], color: "#94a3b8" },
      { id: "beam", from: [-0.02, centerY, 0], to: [beamX, centerY + e * 0.12, 0], color: "#f97316" },
      { id: "clevis", from: [0.31, centerY, 0], to: [clevisX, centerY + e * 0.18, 0], color: "#ef4444" },
    ];
  }, [e, isGhost, plateX, boltsX, beamX, clevisX]);

  const sharedMat = {
    renderStyle,
    caeOverlay,
    isGhost,
    ghostOpacity,
    clippingPlanes,
    simulationTime,
  };

  return (
    <group>
      {/* Plinth fixture pedestal block */}
      <mesh position={[plateX + 0.02, 0.045, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 0.09, 0.42]} />
        <PartMaterial
          {...sharedMat}
          finish="dark-anodized"
          baseColor="#5e6774"
          stressFactor={0.28}
          thermalFactor={0.22}
        />
      </mesh>

      {/* 1. Base Mounting Plate */}
      <group position={[plateX, centerY, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.07, 0.46, 0.42]} />
          <PartMaterial
            {...sharedMat}
            finish="anodized-aluminum"
            baseColor="#b0b8c3"
            stressFactor={0.42}
            thermalFactor={0.3}
          />
        </mesh>
      </group>

      {/* 2. Four Corner Anchor Bolts & Washers */}
      <group position={[boltsX, centerY, 0]}>
        {BRACKET_BOLT_CORNERS.map(([dy, dz], idx) => (
          <group key={`bolt-${idx}`} position={[0, dy, dz]} rotation={[0, 0, Math.PI / 2]}>
            <mesh castShadow receiveShadow>
              <cylinderGeometry args={[0.026, 0.026, 0.07, 6]} />
              <PartMaterial {...sharedMat} finish="polished-steel" stressFactor={0.68} thermalFactor={0.32} />
            </mesh>
            <mesh position={[0, -0.028, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.036, 0.036, 0.012, 16]} />
              <PartMaterial {...sharedMat} finish="satin-steel" stressFactor={0.62} thermalFactor={0.3} />
            </mesh>
          </group>
        ))}
      </group>

      {/* 3. Cantilever Ribbed Web & Gussets (pivoting near root for elastic flex) */}
      <group ref={beamGroupRef} position={[beamX, centerY + e * 0.12, 0]} rotation={[0, 0, flexAngle]}>
        {/* Central web spine */}
        <mesh position={[0.06, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.48, 0.22, 0.048]} />
          <PartMaterial
            {...sharedMat}
            finish="satin-steel"
            baseColor="#bfc4ca"
            stressFactor={0.92}
            thermalFactor={0.78}
          />
        </mesh>
        {/* Top & bottom tapered flanges */}
        <mesh position={[0.05, 0.12, 0]} rotation={[0, 0, -0.14]} castShadow receiveShadow>
          <boxGeometry args={[0.48, 0.04, 0.22]} />
          <PartMaterial {...sharedMat} finish="brushed-aluminum" stressFactor={0.88} thermalFactor={0.74} />
        </mesh>
        <mesh position={[0.05, -0.12, 0]} rotation={[0, 0, 0.14]} castShadow receiveShadow>
          <boxGeometry args={[0.48, 0.04, 0.22]} />
          <PartMaterial {...sharedMat} finish="brushed-aluminum" stressFactor={0.96} thermalFactor={0.84} />
        </mesh>
        {/* Diagonal gusseted web ribs */}
        {[-0.08, 0.08].map((zOff, idx) => (
          <mesh key={`rib-${idx}`} position={[-0.04, 0, zOff]} rotation={[0, 0, 0.32]} castShadow receiveShadow>
            <boxGeometry args={[0.3, 0.032, 0.028]} />
            <PartMaterial
              {...sharedMat}
              finish="anodized-aluminum"
              baseColor="#aeb6c1"
              stressFactor={0.85}
              thermalFactor={0.7}
            />
          </mesh>
        ))}
      </group>

      {/* 4. Clevis Lug & Load Bearing Pin */}
      <group
        ref={clevisGroupRef}
        position={[clevisX, centerY + e * 0.18 + Math.sin(flexAngle) * 0.32, 0]}
        rotation={[0, 0, flexAngle * 1.15]}
      >
        {[-0.075, 0.075].map((zEar, idx) => (
          <mesh key={`ear-${idx}`} position={[0, 0, zEar]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.095, 0.095, 0.036, 24]} />
            <PartMaterial
              {...sharedMat}
              finish="brushed-aluminum"
              baseColor="#d8dce0"
              stressFactor={0.76}
              thermalFactor={0.56}
            />
          </mesh>
        ))}
        {/* Bronze bushing & clevis pin */}
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.044, 0.044, 0.23, 20]} />
          <PartMaterial {...sharedMat} finish="brass" stressFactor={0.9} thermalFactor={0.68} />
        </mesh>
      </group>

      <ExplodeLeaderLines lines={leaderLines} explodeFactor={e} isGhost={isGhost} />
    </group>
  );
}

// ── Assembly 3: Ducted Turbofan Rotor / Fluid Manifold ("cfd" | "vtk") ──────

const ROTOR_BLADE_ANGLES = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * Math.PI) / 4);
const STATOR_VANE_ANGLES = [0, 1, 2, 3, 4, 5].map((i) => (i * Math.PI) / 3);

function TurbofanDuctedRotor({
  explodeFactor,
  caeOverlay,
  renderStyle,
  simulationTime,
  simulationTimeRef,
  clippingPlanes,
  isGhost,
  ghostOpacity,
  accentColor,
}: ProceduralAssemblyProps): React.ReactElement {
  const e = clampNumber(explodeFactor, 0, 1);
  const centerY = 0.36;
  const spinnerGroupRef = useRef<THREE.Group | null>(null);
  const rotorGroupRef = useRef<THREE.Group | null>(null);
  const rotorSpin = readLiveSimTime(simulationTime, simulationTimeRef) * 4.2;

  useFrame(() => {
    const liveSpin = readLiveSimTime(simulationTime, simulationTimeRef) * 4.2;
    if (spinnerGroupRef.current) {
      spinnerGroupRef.current.rotation.z = liveSpin;
    }
    if (rotorGroupRef.current) {
      rotorGroupRef.current.rotation.z = liveSpin;
    }
  });

  const shroudZ = 0.04 + e * 0.22;
  const spinnerZ = 0.23 + e * 0.44;
  const rotorZ = 0.12 + e * 0.18;
  const statorZ = -0.1 - e * 0.18;
  const nozzleZ = -0.28 - e * 0.44;

  const leaderLines = useMemo<LeaderLineSpec[]>(() => {
    if (e <= 0.04 || isGhost) return [];
    return [
      { id: "spinner", from: [0, centerY, 0.23], to: [0, centerY, spinnerZ], color: "#38bdf8" },
      { id: "rotor", from: [0, centerY, 0.12], to: [0, centerY, rotorZ], color: "#06b6d4" },
      { id: "stator", from: [0, centerY, -0.1], to: [0, centerY, statorZ], color: "#f59e0b" },
      { id: "nozzle", from: [0, centerY, -0.28], to: [0, centerY, nozzleZ], color: "#ef4444" },
    ];
  }, [e, isGhost, spinnerZ, rotorZ, statorZ, nozzleZ]);

  const sharedMat = {
    renderStyle,
    caeOverlay,
    isGhost,
    ghostOpacity,
    clippingPlanes,
    simulationTime,
  };

  return (
    <group>
      {/* Low-profile test cradle pylon */}
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.14, 0.08, 0.34]} />
        <PartMaterial
          {...sharedMat}
          finish="dark-anodized"
          baseColor="#59626e"
          stressFactor={0.25}
          thermalFactor={0.2}
        />
      </mesh>

      {/* 1. Inlet Shroud Cowl (open annular nacelle) */}
      <group position={[0, centerY + e * 0.14, shroudZ]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.295, 0.28, 0.38, 40, 1, true]} />
          <PartMaterial
            {...sharedMat}
            finish="ceramic-grey"
            baseColor="#dfe4eb"
            doubleSide={true}
            stressFactor={0.34}
            thermalFactor={0.4}
          />
        </mesh>
        {/* Aerodynamic inlet lip torus */}
        <mesh position={[0, 0, 0.19]} castShadow receiveShadow>
          <torusGeometry args={[0.295, 0.024, 14, 44]} />
          <PartMaterial
            {...sharedMat}
            finish="polished-steel"
            baseColor="#d8dce0"
            stressFactor={0.38}
            thermalFactor={0.34}
          />
        </mesh>
        {/* Glowing intake instrumentation collar */}
        <mesh position={[0, 0, 0.14]}>
          <torusGeometry args={[0.304, 0.006, 8, 44]} />
          <PartMaterial
            {...sharedMat}
            finish="painted"
            baseColor={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.46}
            stressFactor={0.3}
            thermalFactor={0.36}
          />
        </mesh>
      </group>

      {/* 2. Nose Cone Spinner */}
      <group ref={spinnerGroupRef} position={[0, centerY, spinnerZ]} rotation={[0, 0, rotorSpin]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <coneGeometry args={[0.082, 0.17, 28]} />
          <PartMaterial {...sharedMat} finish="ceramic-white" stressFactor={0.44} thermalFactor={0.42} />
        </mesh>
      </group>

      {/* 3. Eight Angled Fan Rotor Blades + Hub */}
      <group ref={rotorGroupRef} position={[0, centerY, rotorZ]} rotation={[0, 0, rotorSpin]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.084, 0.09, 0.09, 24]} />
          <PartMaterial
            {...sharedMat}
            finish="satin-steel"
            baseColor="#b4bac2"
            stressFactor={0.86}
            thermalFactor={0.62}
          />
        </mesh>
        {ROTOR_BLADE_ANGLES.map((angle, idx) => (
          <group key={`blade-${idx}`} rotation={[0, 0, angle]}>
            <mesh position={[0.17, 0, 0]} rotation={[0.48, 0.14, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.185, 0.056, 0.012]} />
              <PartMaterial
                {...sharedMat}
                finish="brushed-aluminum"
                baseColor="#d2d6dc"
                stressFactor={0.92}
                thermalFactor={0.68}
              />
            </mesh>
          </group>
        ))}
      </group>

      {/* 4. Stator Guide Vanes & Bypass Core */}
      <group position={[0, centerY, statorZ]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.125, 0.14, 0.26, 28]} />
          <PartMaterial
            {...sharedMat}
            finish="anodized-aluminum"
            baseColor="#a3acb8"
            stressFactor={0.66}
            thermalFactor={0.94}
          />
        </mesh>
        {STATOR_VANE_ANGLES.map((angle, idx) => (
          <group key={`stator-${idx}`} rotation={[0, 0, angle]}>
            <mesh position={[0.195, 0, 0]} rotation={[-0.36, 0, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.145, 0.044, 0.014]} />
              <PartMaterial
                {...sharedMat}
                finish="satin-steel"
                baseColor="#bfc5cc"
                stressFactor={0.62}
                thermalFactor={0.84}
              />
            </mesh>
          </group>
        ))}
      </group>

      {/* 5. Convergent Exhaust Nozzle */}
      <group position={[0, centerY, nozzleZ]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.25, 0.165, 0.22, 32, 1, true]} />
          <PartMaterial
            {...sharedMat}
            finish="satin-steel"
            baseColor="#9c948c"
            roughness={0.32}
            doubleSide={true}
            emissive="#c2410c"
            emissiveIntensity={0.08}
            stressFactor={0.74}
            thermalFactor={0.98}
          />
        </mesh>
        <mesh position={[0, 0, -0.05]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <coneGeometry args={[0.09, 0.18, 24]} />
          <PartMaterial
            {...sharedMat}
            finish="copper"
            baseColor="#c49476"
            emissive="#ea580c"
            emissiveIntensity={0.1}
            stressFactor={0.7}
            thermalFactor={1.0}
          />
        </mesh>
      </group>

      <ExplodeLeaderLines lines={leaderLines} explodeFactor={e} isGhost={isGhost} />
    </group>
  );
}

// ── Assembly 4: 4-DOF Articulated Robotic Arm ("urdf" | "multibody") ────────

function ArticulatedRoboticArm({
  explodeFactor,
  caeOverlay,
  renderStyle,
  simulationTime,
  simulationTimeRef,
  clippingPlanes,
  isGhost,
  ghostOpacity,
  accentColor,
}: ProceduralAssemblyProps): React.ReactElement {
  const e = clampNumber(explodeFactor, 0, 1);
  const waistGroupRef = useRef<THREE.Group | null>(null);
  const shoulderGroupRef = useRef<THREE.Group | null>(null);
  const elbowGroupRef = useRef<THREE.Group | null>(null);
  const wristGroupRef = useRef<THREE.Group | null>(null);
  const leftFingerRef = useRef<THREE.Mesh | null>(null);
  const rightFingerRef = useRef<THREE.Mesh | null>(null);

  const initialTime = readLiveSimTime(simulationTime, simulationTimeRef);
  const waistYaw = Math.sin(initialTime * 0.72) * 0.7;
  const shoulderPitch = -0.22 + Math.sin(initialTime * 1.15) * 0.28;
  const elbowPitch = 0.72 + Math.cos(initialTime * 1.15) * 0.34;
  const wristRoll = initialTime * 1.25;
  const gripperHalfGap = 0.022 + 0.024 * (0.5 + 0.5 * Math.sin(initialTime * 2.2));

  useFrame(() => {
    const t = readLiveSimTime(simulationTime, simulationTimeRef);
    if (waistGroupRef.current) waistGroupRef.current.rotation.y = Math.sin(t * 0.72) * 0.7;
    if (shoulderGroupRef.current) shoulderGroupRef.current.rotation.z = -0.22 + Math.sin(t * 1.15) * 0.28;
    if (elbowGroupRef.current) elbowGroupRef.current.rotation.z = 0.72 + Math.cos(t * 1.15) * 0.34;
    if (wristGroupRef.current) wristGroupRef.current.rotation.y = t * 1.25;
    const gap = 0.022 + 0.024 * (0.5 + 0.5 * Math.sin(t * 2.2));
    if (leftFingerRef.current) leftFingerRef.current.position.x = -gap;
    if (rightFingerRef.current) rightFingerRef.current.position.x = gap;
  });

  const sharedMat = {
    renderStyle,
    caeOverlay,
    isGhost,
    ghostOpacity,
    clippingPlanes,
    simulationTime,
  };

  const leaderLines = useMemo<LeaderLineSpec[]>(() => {
    if (e <= 0.04 || isGhost) return [];
    return [
      { id: "j1", from: [0, 0.1, 0], to: [0, 0.1 + e * 0.14, 0], color: "#38bdf8" },
      { id: "j2", from: [0, 0.24, 0], to: [0, 0.24 + e * 0.26, 0], color: "#38bdf8" },
      { id: "j3", from: [0, 0.5, 0], to: [0, 0.5 + e * 0.38, 0], color: "#22d3ee" },
    ];
  }, [e, isGhost]);

  return (
    <group>
      {/* 1. Pedestal Base */}
      <group position={[0, 0.045 - e * 0.06, 0]}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.21, 0.24, 0.09, 32]} />
          <PartMaterial
            {...sharedMat}
            finish="dark-anodized"
            baseColor="#5c6572"
            stressFactor={0.28}
            thermalFactor={0.24}
          />
        </mesh>
      </group>

      {/* 2. Waist Turret (Joint 1 - Yaw) */}
      <group ref={waistGroupRef} position={[0, 0.11 + e * 0.1, 0]} rotation={[0, waistYaw, 0]}>
        <mesh position={[0, 0.055, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.135, 0.155, 0.12, 28]} />
          <PartMaterial
            {...sharedMat}
            finish="anodized-aluminum"
            baseColor="#adb6c2"
            stressFactor={0.56}
            thermalFactor={0.52}
          />
        </mesh>
        <mesh position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.138, 0.01, 8, 32]} />
          <PartMaterial
            {...sharedMat}
            finish="painted"
            baseColor={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.42}
            stressFactor={0.5}
            thermalFactor={0.48}
          />
        </mesh>

        {/* 3. Shoulder Joint & Upper Link (Joint 2 - Pitch) */}
        <group ref={shoulderGroupRef} position={[0, 0.145 + e * 0.14, 0]} rotation={[0, 0, shoulderPitch]}>
          {/* Harmonic shoulder drum */}
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.072, 0.072, 0.16, 24]} />
            <PartMaterial
              {...sharedMat}
              finish="dark-anodized"
              baseColor="#58616e"
              stressFactor={0.92}
              thermalFactor={0.84}
            />
          </mesh>
          {/* Upper arm box spar */}
          <mesh position={[0, 0.155, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.078, 0.29, 0.088]} />
            <PartMaterial {...sharedMat} finish="ceramic-white" stressFactor={0.84} thermalFactor={0.68} />
          </mesh>
          {/* Accent rail */}
          <mesh position={[0.042, 0.155, 0]}>
            <boxGeometry args={[0.01, 0.24, 0.036]} />
            <PartMaterial
              {...sharedMat}
              finish="painted"
              baseColor={accentColor}
              emissive={accentColor}
              emissiveIntensity={0.32}
              stressFactor={0.72}
              thermalFactor={0.6}
            />
          </mesh>

          {/* 4. Elbow Joint & Forearm Link (Joint 3 - Pitch) */}
          <group ref={elbowGroupRef} position={[0, 0.305 + e * 0.14, 0]} rotation={[0, 0, elbowPitch]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.058, 0.058, 0.13, 22]} />
              <PartMaterial
                {...sharedMat}
                finish="dark-anodized"
                baseColor="#58616e"
                stressFactor={0.8}
                thermalFactor={0.76}
              />
            </mesh>
            <mesh position={[0, 0.13, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.036, 0.048, 0.24, 20]} />
              <PartMaterial
                {...sharedMat}
                finish="ceramic-grey"
                baseColor="#dfe4ec"
                stressFactor={0.68}
                thermalFactor={0.58}
              />
            </mesh>

            {/* 5. Wrist Roll & Parallel Gripper (Joint 4) */}
            <group ref={wristGroupRef} position={[0, 0.255 + e * 0.12, 0]} rotation={[0, wristRoll, 0]}>
              <mesh castShadow receiveShadow>
                <cylinderGeometry args={[0.042, 0.038, 0.055, 18]} />
                <PartMaterial {...sharedMat} finish="satin-steel" stressFactor={0.48} thermalFactor={0.54} />
              </mesh>
              {/* Gripper crossbar */}
              <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.125, 0.024, 0.042]} />
                <PartMaterial
                  {...sharedMat}
                  finish="brushed-aluminum"
                  baseColor="#d4d8dd"
                  stressFactor={0.44}
                  thermalFactor={0.44}
                />
              </mesh>
              {/* Left & Right Parallel Fingers */}
              <mesh ref={leftFingerRef} position={[-gripperHalfGap, 0.088, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.016, 0.08, 0.026]} />
                <PartMaterial
                  {...sharedMat}
                  finish="painted"
                  baseColor={accentColor}
                  emissive={accentColor}
                  emissiveIntensity={0.14}
                  stressFactor={0.52}
                  thermalFactor={0.42}
                />
              </mesh>
              <mesh ref={rightFingerRef} position={[gripperHalfGap, 0.088, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.016, 0.08, 0.026]} />
                <PartMaterial
                  {...sharedMat}
                  finish="painted"
                  baseColor={accentColor}
                  emissive={accentColor}
                  emissiveIntensity={0.14}
                  stressFactor={0.52}
                  thermalFactor={0.42}
                />
              </mesh>
            </group>
          </group>
        </group>
      </group>

      <ExplodeLeaderLines lines={leaderLines} explodeFactor={e} isGhost={isGhost} />
    </group>
  );
}

// ── Assembly 5: 5-Axis CNC Machined Impeller & Glowing Toolpath ("gcode") ───

const IMPELLER_BLADE_ANGLES = [0, 1, 2, 3, 4, 5, 6].map((i) => (i * Math.PI * 2) / 7);
const CHUCK_JAW_ANGLES = [0, 1, 2].map((i) => (i * Math.PI * 2) / 3);

function evaluateCncToolpathPoint(u: number): [number, number, number] {
  const wraps = 3.5;
  const angle = u * Math.PI * 2 * wraps;
  const radius = 0.255 - u * 0.145 + Math.sin(angle * 7) * 0.014;
  const y = 0.14 + u * 0.22 + Math.cos(angle * 7) * 0.008;
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
}

function CncMachinedImpeller({
  explodeFactor,
  caeOverlay,
  renderStyle,
  simulationTime,
  simulationTimeRef,
  clippingPlanes,
  isGhost,
  ghostOpacity,
}: ProceduralAssemblyProps): React.ReactElement {
  const e = clampNumber(explodeFactor, 0, 1);
  const spindleGroupRef = useRef<THREE.Group | null>(null);
  const cutterMeshRef = useRef<THREE.Mesh | null>(null);

  const toolpathPoints = useMemo<Array<[number, number, number]>>(() => {
    const pts: Array<[number, number, number]> = [];
    const steps = 112;
    for (let i = 0; i <= steps; i++) {
      pts.push(evaluateCncToolpathPoint(i / steps));
    }
    return pts;
  }, []);

  // Trace spindle head smoothly along the helical 5-axis path
  const initialTime = readLiveSimTime(simulationTime, simulationTimeRef);
  const rawPhase = (initialTime * 0.14) % 2;
  const pathU = rawPhase <= 1 ? rawPhase : 2 - rawPhase;
  const [tx, ty, tz] = evaluateCncToolpathPoint(pathU);
  const radialAngle = Math.atan2(tz, tx);
  const spindleTilt = 0.34;

  const chuckY = 0.045 - e * 0.16;
  const impellerY = 0.1 + e * 0.06;
  const toolpathYOffset = e * 0.24;
  const spindleYOffset = e * 0.42;

  useFrame(() => {
    const t = readLiveSimTime(simulationTime, simulationTimeRef);
    const livePhase = (t * 0.14) % 2;
    const u = livePhase <= 1 ? livePhase : 2 - livePhase;
    const [lx, ly, lz] = evaluateCncToolpathPoint(u);
    const rAngle = Math.atan2(lz, lx);
    if (spindleGroupRef.current) {
      spindleGroupRef.current.position.set(lx, ly + spindleYOffset, lz);
      spindleGroupRef.current.rotation.set(Math.sin(rAngle) * spindleTilt, 0, -Math.cos(rAngle) * spindleTilt);
    }
    if (cutterMeshRef.current) {
      cutterMeshRef.current.rotation.y = t * 18;
    }
  });

  const leaderLines: LeaderLineSpec[] =
    e <= 0.04 || isGhost
      ? []
      : [
          { id: "chuck", from: [0, 0.045, 0], to: [0, chuckY, 0], color: "#94a3b8" },
          { id: "impeller", from: [0, 0.1, 0], to: [0, impellerY, 0], color: "#38bdf8" },
          { id: "toolpath", from: [0, 0.26, 0], to: [0, 0.26 + toolpathYOffset, 0], color: "#34d399" },
          { id: "spindle", from: [tx, ty, tz], to: [tx, ty + spindleYOffset, tz], color: "#22d3ee" },
        ];

  const sharedMat = {
    renderStyle,
    caeOverlay,
    isGhost,
    ghostOpacity,
    clippingPlanes,
    simulationTime,
  };

  return (
    <group>
      {/* 1. 5-Axis Rotary Fixture Chuck */}
      <group position={[0, chuckY, 0]}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.29, 0.31, 0.075, 36]} />
          <PartMaterial
            {...sharedMat}
            finish="dark-anodized"
            baseColor="#5c6572"
            stressFactor={0.3}
            thermalFactor={0.24}
          />
        </mesh>
        {CHUCK_JAW_ANGLES.map((angle, idx) => (
          <mesh
            key={`jaw-${idx}`}
            position={[Math.cos(angle) * 0.23, 0.052, Math.sin(angle) * 0.23]}
            rotation={[0, -angle, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[0.095, 0.042, 0.056]} />
            <PartMaterial
              {...sharedMat}
              finish="satin-steel"
              baseColor="#adb4bd"
              stressFactor={0.5}
              thermalFactor={0.28}
            />
          </mesh>
        ))}
      </group>

      {/* 2. Machined Billet Impeller Hub + 7 Swept Blades */}
      <group position={[0, impellerY, 0]}>
        <mesh position={[0, 0.025, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.25, 0.265, 0.045, 36]} />
          <PartMaterial {...sharedMat} finish="brushed-aluminum" stressFactor={0.72} thermalFactor={0.7} />
        </mesh>
        <mesh position={[0, 0.145, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.068, 0.165, 0.22, 32]} />
          <PartMaterial
            {...sharedMat}
            finish="polished-steel"
            baseColor="#dce0e4"
            stressFactor={0.84}
            thermalFactor={0.82}
          />
        </mesh>
        {IMPELLER_BLADE_ANGLES.map((angle, idx) => (
          <group key={`imp-blade-${idx}`} rotation={[0, angle, 0]}>
            <mesh position={[0.145, 0.125, 0.024]} rotation={[0.38, 0.42, -0.32]} castShadow receiveShadow>
              <boxGeometry args={[0.155, 0.175, 0.014]} />
              <PartMaterial {...sharedMat} finish="brushed-aluminum" stressFactor={0.88} thermalFactor={0.86} />
            </mesh>
          </group>
        ))}
      </group>

      {/* 3. Glowing 5-Axis Toolpath Ribbon */}
      <group position={[0, toolpathYOffset, 0]}>
        <Line
          points={toolpathPoints}
          color={isGhost ? "#38bdf8" : "#34d399"}
          lineWidth={isGhost ? 1.2 : 2.2}
          transparent={true}
          opacity={isGhost ? ghostOpacity * 0.8 : 0.88}
        />
      </group>

      {/* 4. Animated 5-Axis Spindle Head & Ball-End Mill */}
      <group
        ref={spindleGroupRef}
        position={[tx, ty + spindleYOffset, tz]}
        rotation={[Math.sin(radialAngle) * spindleTilt, 0, -Math.cos(radialAngle) * spindleTilt]}
      >
        {/* Carbide ball-end mill cutter */}
        <mesh ref={cutterMeshRef} position={[0, 0.065, 0]} rotation={[0, initialTime * 18, 0]} castShadow>
          <cylinderGeometry args={[0.011, 0.009, 0.13, 12]} />
          <PartMaterial {...sharedMat} finish="gold" stressFactor={0.96} thermalFactor={1.0} />
        </mesh>
        {/* ER Collet nut */}
        <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.036, 0.024, 0.055, 16]} />
          <PartMaterial
            {...sharedMat}
            finish="satin-steel"
            baseColor="#b5bcc5"
            stressFactor={0.78}
            thermalFactor={0.76}
          />
        </mesh>
        {/* High-speed spindle housing */}
        <mesh position={[0, 0.245, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.056, 0.048, 0.14, 24]} />
          <PartMaterial
            {...sharedMat}
            finish="dark-anodized"
            baseColor="#58616e"
            stressFactor={0.54}
            thermalFactor={0.62}
          />
        </mesh>
        {/* Cutting contact spark glow */}
        {!isGhost && (
          <mesh position={[0, 0.002, 0]}>
            <sphereGeometry args={[0.018, 12, 12]} />
            <meshStandardMaterial
              color="#fef08a"
              emissive="#34d399"
              emissiveIntensity={2.1}
              transparent={true}
              opacity={0.92}
              clippingPlanes={clippingPlanes}
            />
          </mesh>
        )}
      </group>

      <ExplodeLeaderLines lines={leaderLines} explodeFactor={e} isGhost={isGhost} />
    </group>
  );
}

// ── CadComponents Multi-Part Renderer ───────────────────────────────────────

function CadPartGeometry({ shape }: { shape: string | undefined }): React.ReactElement {
  switch ((shape ?? "").toLowerCase()) {
    case "box":
    case "cube":
      return <boxGeometry args={[0.18, 0.18, 0.18]} />;
    case "cylinder":
    case "tube":
    case "shaft":
      return <cylinderGeometry args={[0.1, 0.1, 0.22, 24]} />;
    case "sphere":
    case "ball":
      return <sphereGeometry args={[0.12, 24, 20]} />;
    case "cone":
    case "nozzle":
      return <coneGeometry args={[0.12, 0.24, 24]} />;
    case "torus":
    case "ring":
      return <torusGeometry args={[0.12, 0.036, 14, 32]} />;
    default:
      // Precision chamfered mechanical hub
      return <cylinderGeometry args={[0.125, 0.14, 0.12, 28]} />;
  }
}

// Local plinth-unit normalization; `hero` scale mode multiplies the whole plinth root so this lands at ~3.2 m.
const PROCEDURAL_PLINTH_TARGET_SIZE = PLINTH_MODEL_NORMALIZED_SIZE;
const PROCEDURAL_PLINTH_FLOOR_Y = 0.04;
const PROCEDURAL_DEFAULT_PALETTE: readonly string[] = [
  "#d6d9dc",
  "#b9bcbf",
  "#dde3ea",
  "#a4adb9",
  "#d4b26a",
  "#38bdf8",
];

function sanitizeVec3(
  raw: readonly [number, number, number] | undefined,
  fallback: readonly [number, number, number],
): [number, number, number] {
  if (!raw) return [fallback[0], fallback[1], fallback[2]];
  return [
    Number.isFinite(raw[0]) ? raw[0] : fallback[0],
    Number.isFinite(raw[1]) ? raw[1] : fallback[1],
    Number.isFinite(raw[2]) ? raw[2] : fallback[2],
  ];
}

function buildProceduralBufferGeometry(
  mesh: NonNullable<RotundaCadPartInput["proceduralMesh"]>,
): THREE.BufferGeometry | null {
  const usableLen = Math.floor(mesh.vertices.length / 3) * 3;
  if (usableLen < 9) return null;

  const posArr =
    mesh.vertices instanceof Float32Array && mesh.vertices.length === usableLen
      ? mesh.vertices
      : new Float32Array(
          mesh.vertices instanceof Float32Array
            ? mesh.vertices.subarray(0, usableLen)
            : mesh.vertices.slice(0, usableLen),
        );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));

  if (mesh.indices && mesh.indices.length >= 3) {
    if (mesh.indices instanceof Uint32Array || mesh.indices instanceof Uint16Array) {
      geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    } else {
      geo.setIndex(mesh.indices);
    }
  }

  if (mesh.normals && mesh.normals.length >= usableLen) {
    const normArr =
      mesh.normals instanceof Float32Array && mesh.normals.length === usableLen
        ? mesh.normals
        : new Float32Array(
            mesh.normals instanceof Float32Array
              ? mesh.normals.subarray(0, usableLen)
              : mesh.normals.slice(0, usableLen),
          );
    geo.setAttribute("normal", new THREE.BufferAttribute(normArr, 3));
  } else {
    geo.computeVertexNormals();
  }

  ensureGeometryBrushedUvs(geo);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

interface NormalizedCadPart {
  part: RotundaCadPartInput;
  geometry: THREE.BufferGeometry | null;
  edgesGeometry: THREE.EdgesGeometry | null;
  caeColorCache: Partial<Record<CaeFieldOverlayMode, Float32Array>>;
  home: [number, number, number];
  visualCenter: [number, number, number];
  baseRotation: [number, number, number];
  explodeDir: [number, number, number];
  scale: [number, number, number];
  fitScale: number;
  stressFactor: number;
  thermalFactor: number;
}

function CadComponentsAssembly({
  parts,
  explodeFactor,
  caeOverlay,
  renderStyle,
  simulationTime,
  clippingPlanes,
  isGhost,
  ghostOpacity,
  accentColor,
  animationController,
}: ProceduralAssemblyProps & {
  parts: readonly RotundaCadPartInput[];
  animationController?: RotundaAnimationControllerLike | null | undefined;
}): React.ReactElement {
  const e = clampNumber(explodeFactor, 0, 1);
  const partGroupRefs = useRef<Array<THREE.Group | null>>([]);
  const explodeRef = useRef(e);
  const animControllerRef = useRef(animationController);
  useEffect(() => {
    explodeRef.current = e;
    animControllerRef.current = animationController;
  }, [e, animationController]);

  const prepared = useMemo<{ items: NormalizedCadPart[]; createdGeometries: THREE.BufferGeometry[] }>(() => {
    const count = Math.max(1, parts.length);
    const createdGeometries: THREE.BufferGeometry[] = [];
    const partGeometries: Array<{ geo: THREE.BufferGeometry; edges: THREE.EdgesGeometry | null } | null> = parts.map(
      (part) => {
        if (part.proceduralMesh && part.proceduralMesh.vertices.length >= 9) {
          const geo = buildProceduralBufferGeometry(part.proceduralMesh);
          if (geo) {
            createdGeometries.push(geo);
            let edges: THREE.EdgesGeometry | null = null;
            try {
              edges = new THREE.EdgesGeometry(geo, 22);
              createdGeometries.push(edges);
            } catch {
              edges = null;
            }
            return { geo, edges };
          }
        }
        return null;
      },
    );

    const hasProceduralMeshes = createdGeometries.length > 0;

    if (hasProceduralMeshes) {
      const combinedBox = new THREE.Box3();
      const tmpPos = new THREE.Vector3();
      const tmpQuat = new THREE.Quaternion();
      const tmpEuler = new THREE.Euler();
      const tmpScale = new THREE.Vector3();
      const tmpMat = new THREE.Matrix4();
      const fallbackLocalBox = new THREE.Box3(
        new THREE.Vector3(-0.12, -0.12, -0.12),
        new THREE.Vector3(0.12, 0.12, 0.12),
      );

      const perPartRaw = parts.map((part, idx) => {
        const pair = partGeometries[idx] ?? null;
        const geo = pair?.geo ?? null;
        const edges = pair?.edges ?? null;
        const rawPos = sanitizeVec3(part.position, [0, 0, 0]);
        const rawRot = sanitizeVec3(part.rotation, [0, 0, 0]);
        const rawScale = sanitizeVec3(part.scale, [1, 1, 1]);

        tmpPos.set(rawPos[0], rawPos[1], rawPos[2]);
        tmpEuler.set(rawRot[0], rawRot[1], rawRot[2]);
        tmpQuat.setFromEuler(tmpEuler);
        tmpScale.set(rawScale[0], rawScale[1], rawScale[2]);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);

        const partBox =
          geo?.boundingBox && !geo.boundingBox.isEmpty()
            ? geo.boundingBox.clone().applyMatrix4(tmpMat)
            : fallbackLocalBox.clone().applyMatrix4(tmpMat);
        combinedBox.union(partBox);
        const worldCenter = partBox.getCenter(new THREE.Vector3());

        return { part, geo, edges, rawPos, rawRot, rawScale, worldCenter };
      });

      const sizeVec = new THREE.Vector3();
      const centerVec = new THREE.Vector3();
      let normScale = 1;
      let minY = 0;

      if (!combinedBox.isEmpty()) {
        combinedBox.getSize(sizeVec);
        combinedBox.getCenter(centerVec);
        const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
        if (Number.isFinite(maxDim) && maxDim > 1e-5) {
          normScale = PROCEDURAL_PLINTH_TARGET_SIZE / maxDim;
        }
        minY = Number.isFinite(combinedBox.min.y) ? combinedBox.min.y : 0;
      }

      const cx = Number.isFinite(centerVec.x) ? centerVec.x : 0;
      const cy = Number.isFinite(centerVec.y) ? centerVec.y : 0;
      const cz = Number.isFinite(centerVec.z) ? centerVec.z : 0;
      const assemblyPlinthCenterY = (cy - minY) * normScale + PROCEDURAL_PLINTH_FLOOR_Y;

      const items: NormalizedCadPart[] = perPartRaw.map(
        ({ part, geo, edges, rawPos, rawRot, rawScale, worldCenter }, idx) => {
          const home: [number, number, number] = [
            (rawPos[0] - cx) * normScale,
            (rawPos[1] - minY) * normScale + PROCEDURAL_PLINTH_FLOOR_Y,
            (rawPos[2] - cz) * normScale,
          ];
          const visualCenter: [number, number, number] = [
            (worldCenter.x - cx) * normScale,
            (worldCenter.y - minY) * normScale + PROCEDURAL_PLINTH_FLOOR_Y,
            (worldCenter.z - cz) * normScale,
          ];

          let dx = visualCenter[0];
          let dy = visualCenter[1] - assemblyPlinthCenterY;
          let dz = visualCenter[2];
          const len = Math.hypot(dx, dy, dz);
          if (len < 0.015) {
            if (count <= 1) {
              dx = 0;
              dy = 0.22;
              dz = 0;
            } else {
              const a = (idx / count) * Math.PI * 2;
              dx = Math.cos(a) * 0.7;
              dy = 0.45 + (idx % 3) * 0.2;
              dz = Math.sin(a) * 0.7;
              const fallbackLen = Math.hypot(dx, dy, dz) || 1;
              dx /= fallbackLen;
              dy /= fallbackLen;
              dz /= fallbackLen;
            }
          } else {
            dx /= len;
            dy /= len;
            dz /= len;
          }

          const scale: [number, number, number] = [
            rawScale[0] * normScale,
            rawScale[1] * normScale,
            rawScale[2] * normScale,
          ];

          return {
            part,
            geometry: geo,
            edgesGeometry: edges,
            caeColorCache: {},
            home,
            visualCenter,
            baseRotation: rawRot,
            explodeDir: [dx, dy, dz],
            scale,
            fitScale: normScale,
            stressFactor: clampNumber(0.25 + ((idx * 0.6180339) % 1) * 0.7, 0, 1),
            thermalFactor: clampNumber(0.25 + (((idx + 2) * 0.381966) % 1) * 0.72, 0, 1),
          };
        },
      );

      return { items, createdGeometries };
    }

    const rawPositions: Array<[number, number, number]> = parts.map((p, idx) => {
      if (p.position) return p.position;
      const angle = (idx / count) * Math.PI * 2;
      const ringR = count > 1 ? 0.22 : 0;
      return [Math.cos(angle) * ringR, 0.24 + (idx % 3) * 0.14, Math.sin(angle) * ringR];
    });

    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const pos of rawPositions) {
      cx += pos[0];
      cy += pos[1];
      cz += pos[2];
    }
    cx /= count;
    cy /= count;
    cz /= count;

    let maxRadius = 0.001;
    for (const pos of rawPositions) {
      const d = Math.hypot(pos[0] - cx, pos[1] - cy, pos[2] - cz);
      if (d > maxRadius) maxRadius = d;
    }
    const fitScale = maxRadius > 0.55 ? 0.45 / maxRadius : 1;

    const items: NormalizedCadPart[] = parts.map((part, idx) => {
      const raw = rawPositions[idx] ?? [0, 0.3, 0];
      const home: [number, number, number] = [
        (raw[0] - cx) * fitScale,
        Math.max(0.1, (raw[1] - cy) * fitScale + 0.34),
        (raw[2] - cz) * fitScale,
      ];

      let dx = home[0];
      let dy = home[1] - 0.34;
      let dz = home[2];
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.02) {
        const a = (idx / count) * Math.PI * 2;
        dx = Math.cos(a) * 0.7;
        dy = 0.45 + (idx % 3) * 0.2;
        dz = Math.sin(a) * 0.7;
      } else {
        dx /= len;
        dy /= len;
        dz /= len;
      }

      const scale: [number, number, number] = part.scale
        ? [
            clampNumber(part.scale[0] * fitScale, 0.15, 2.5),
            clampNumber(part.scale[1] * fitScale, 0.15, 2.5),
            clampNumber(part.scale[2] * fitScale, 0.15, 2.5),
          ]
        : [1, 1, 1];

      const baseRotation: [number, number, number] = part.rotation
        ? [part.rotation[0], part.rotation[1], part.rotation[2]]
        : [0, 0, 0];

      return {
        part,
        geometry: null,
        edgesGeometry: null,
        caeColorCache: {},
        home,
        visualCenter: home,
        baseRotation,
        explodeDir: [dx, dy, dz],
        scale,
        fitScale,
        stressFactor: clampNumber(0.25 + ((idx * 0.6180339) % 1) * 0.7, 0, 1),
        thermalFactor: clampNumber(0.25 + (((idx + 2) * 0.381966) % 1) * 0.72, 0, 1),
      };
    });

    return { items, createdGeometries };
  }, [parts]);

  const normalizedParts = prepared.items;

  // Populate geometry-aware per-vertex Von Mises / CFD Cp / Thermal colors on procedural meshes
  useEffect(() => {
    if (isGhost || caeOverlay === "none") return;
    const mode = caeOverlay as CaeFieldOverlayMode;
    for (const item of normalizedParts) {
      if (!item.geometry) continue;
      let colors = item.caeColorCache[mode];
      if (!colors) {
        colors = computeGeometryCaeVertexColors(item.geometry, mode);
        item.caeColorCache[mode] = colors;
      }
      if (colors.length > 0) {
        const existing = item.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
        if (existing && existing.array.length === colors.length) {
          (existing.array as Float32Array).set(colors);
          existing.needsUpdate = true;
        } else {
          item.geometry.setAttribute("color", new THREE.BufferAttribute(colors.slice(), 3));
        }
      }
    }
  }, [normalizedParts, caeOverlay, isGhost]);

  // Dispose synthesized BufferGeometry instances cleanly on parts change or unmount
  useEffect(() => {
    return () => {
      for (const geo of prepared.createdGeometries) {
        geo.dispose();
      }
    };
  }, [prepared]);

  // Snap group baselines cleanly whenever the part set or auto-normalized scale changes
  useEffect(() => {
    const dist = explodeRef.current * 0.42;
    for (let idx = 0; idx < normalizedParts.length; idx++) {
      const item = normalizedParts[idx];
      const grp = partGroupRefs.current[idx];
      if (!item || !grp) continue;
      grp.position.set(
        item.home[0] + item.explodeDir[0] * dist,
        item.home[1] + item.explodeDir[1] * dist,
        item.home[2] + item.explodeDir[2] * dist,
      );
      grp.rotation.set(item.baseRotation[0], item.baseRotation[1], item.baseRotation[2]);
      grp.scale.set(item.scale[0], item.scale[1], item.scale[2]);
    }
  }, [normalizedParts]);

  // Smoothly apply live Modelica AnimationController transforms alongside radial explodeFactor
  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const alpha = 1 - Math.exp(-delta * 14);
    const dist = explodeRef.current * 0.42;
    const controller = !isGhost ? animControllerRef.current : null;
    const canQueryAnim = Boolean(controller) && controller?.hasData !== false;

    for (let idx = 0; idx < normalizedParts.length; idx++) {
      const item = normalizedParts[idx];
      const grp = partGroupRefs.current[idx];
      if (!item || !grp) continue;

      const tf = canQueryAnim
        ? (controller?.getTransform?.(item.part.name) ?? controller?.getComponentTransform?.(item.part.name))
        : undefined;

      const animPosX = tf?.position && Number.isFinite(tf.position[0]) ? tf.position[0] * item.fitScale : 0;
      const animPosY = tf?.position && Number.isFinite(tf.position[1]) ? tf.position[1] * item.fitScale : 0;
      const animPosZ = tf?.position && Number.isFinite(tf.position[2]) ? tf.position[2] * item.fitScale : 0;

      const targetX = item.home[0] + item.explodeDir[0] * dist + animPosX;
      const targetY = item.home[1] + item.explodeDir[1] * dist + animPosY;
      const targetZ = item.home[2] + item.explodeDir[2] * dist + animPosZ;

      grp.position.x += (targetX - grp.position.x) * alpha;
      grp.position.y += (targetY - grp.position.y) * alpha;
      grp.position.z += (targetZ - grp.position.z) * alpha;

      const animRotX = tf?.rotation && Number.isFinite(tf.rotation[0]) ? tf.rotation[0] : 0;
      const animRotY = tf?.rotation && Number.isFinite(tf.rotation[1]) ? tf.rotation[1] : 0;
      const animRotZ = tf?.rotation && Number.isFinite(tf.rotation[2]) ? tf.rotation[2] : 0;

      const targetRx = item.baseRotation[0] + animRotX;
      const targetRy = item.baseRotation[1] + animRotY;
      const targetRz = item.baseRotation[2] + animRotZ;

      grp.rotation.x += (targetRx - grp.rotation.x) * alpha;
      grp.rotation.y += (targetRy - grp.rotation.y) * alpha;
      grp.rotation.z += (targetRz - grp.rotation.z) * alpha;

      const animScaleX = tf?.scale && Number.isFinite(tf.scale[0]) ? clampNumber(tf.scale[0], 0.05, 5) : 1;
      const animScaleY = tf?.scale && Number.isFinite(tf.scale[1]) ? clampNumber(tf.scale[1], 0.05, 5) : 1;
      const animScaleZ = tf?.scale && Number.isFinite(tf.scale[2]) ? clampNumber(tf.scale[2], 0.05, 5) : 1;

      const targetSx = item.scale[0] * animScaleX;
      const targetSy = item.scale[1] * animScaleY;
      const targetSz = item.scale[2] * animScaleZ;

      grp.scale.x += (targetSx - grp.scale.x) * alpha;
      grp.scale.y += (targetSy - grp.scale.y) * alpha;
      grp.scale.z += (targetSz - grp.scale.z) * alpha;
    }
  });

  const leaderLines = useMemo<LeaderLineSpec[]>(() => {
    if (e <= 0.04 || isGhost) return [];
    const dist = e * 0.42;
    return normalizedParts.map((item, idx) => ({
      id: `cad-line-${item.part.name}-${idx}`,
      from: item.visualCenter,
      to: [
        item.visualCenter[0] + item.explodeDir[0] * dist,
        item.visualCenter[1] + item.explodeDir[1] * dist,
        item.visualCenter[2] + item.explodeDir[2] * dist,
      ],
      color: "#38bdf8",
    }));
  }, [normalizedParts, e, isGhost]);

  return (
    <group>
      {normalizedParts.map((item, idx) => {
        const isDefaultHub =
          !item.geometry &&
          (!item.part.shape ||
            !["box", "cube", "cylinder", "tube", "shaft", "sphere", "ball", "cone", "nozzle", "torus", "ring"].includes(
              item.part.shape.toLowerCase(),
            ));
        const proceduralBaseColor =
          item.part.proceduralMesh?.color ??
          item.part.color ??
          PROCEDURAL_DEFAULT_PALETTE[idx % PROCEDURAL_DEFAULT_PALETTE.length] ??
          "#94a3b8";

        return (
          <group
            key={`cad-part-${item.part.name}-${idx}`}
            ref={(el) => {
              partGroupRefs.current[idx] = el;
            }}
            position={item.home}
            rotation={item.baseRotation}
            scale={item.scale}
          >
            {item.geometry ? (
              <>
                <mesh geometry={item.geometry} castShadow receiveShadow>
                  <PartMaterial
                    finish="brushed-aluminum"
                    baseColor={proceduralBaseColor}
                    stressFactor={item.stressFactor}
                    thermalFactor={item.thermalFactor}
                    doubleSide={true}
                    useVertexColors={caeOverlay !== "none"}
                    renderStyle={renderStyle}
                    caeOverlay={caeOverlay}
                    isGhost={isGhost}
                    ghostOpacity={ghostOpacity}
                    clippingPlanes={clippingPlanes}
                    simulationTime={simulationTime}
                  />
                </mesh>
                {!isGhost && caeOverlay === "fea-stress" && renderStyle === "shaded" && item.edgesGeometry && (
                  <lineSegments geometry={item.edgesGeometry}>
                    <lineBasicMaterial
                      color="#0f172a"
                      transparent={true}
                      opacity={0.22}
                      clippingPlanes={clippingPlanes}
                    />
                  </lineSegments>
                )}
              </>
            ) : (
              <>
                <mesh castShadow receiveShadow>
                  <CadPartGeometry shape={item.part.shape} />
                  <PartMaterial
                    finish={idx % 2 === 0 ? "brushed-aluminum" : "satin-steel"}
                    baseColor={item.part.color}
                    stressFactor={item.stressFactor}
                    thermalFactor={item.thermalFactor}
                    renderStyle={renderStyle}
                    caeOverlay={caeOverlay}
                    isGhost={isGhost}
                    ghostOpacity={ghostOpacity}
                    clippingPlanes={clippingPlanes}
                    simulationTime={simulationTime}
                  />
                </mesh>
                {isDefaultHub && (
                  <mesh position={[0, 0.068, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[0.092, 0.012, 10, 28]} />
                    <PartMaterial
                      finish="painted"
                      baseColor={accentColor}
                      emissive={accentColor}
                      emissiveIntensity={0.38}
                      stressFactor={item.stressFactor}
                      thermalFactor={item.thermalFactor}
                      renderStyle={renderStyle}
                      caeOverlay={caeOverlay}
                      isGhost={isGhost}
                      ghostOpacity={ghostOpacity}
                      clippingPlanes={clippingPlanes}
                      simulationTime={simulationTime}
                    />
                  </mesh>
                )}
              </>
            )}
          </group>
        );
      })}
      <ExplodeLeaderLines lines={leaderLines} explodeFactor={e} isGhost={isGhost} />
    </group>
  );
}

// ── Real GLTF/GLB Asset Loader with Explode, Clipping & RenderStyle ─────────

interface GltfExplodeTarget {
  obj: THREE.Object3D;
  basePos: THREE.Vector3;
  explodeDir: THREE.Vector3;
}

interface GltfClonedMaterialRecord {
  mat: THREE.MeshPhysicalMaterial;
  originalColor: THREE.Color;
  originalEmissive: THREE.Color;
  originalEmissiveIntensity: number;
  originalMetalness: number;
  originalRoughness: number;
  originalClearcoat: number;
  originalClearcoatRoughness: number;
  originalEnvMapIntensity: number;
  originalMap: THREE.Texture | null;
  originalOpacity: number;
  originalTransparent: boolean;
  stressWeight: number;
  thermalWeight: number;
}

interface GltfMeshCaeRecord {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  hasOriginalVertexColors: boolean;
  originalColorAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null;
  caeColorCache: Partial<Record<CaeFieldOverlayMode, Float32Array>>;
  feaEdgeLines: THREE.LineSegments | null;
  feaEdgeMat: THREE.LineBasicMaterial | null;
}

function GltfHeroModel({
  url,
  explodeFactor,
  caeOverlay,
  renderStyle,
  simulationTime: _simulationTime,
  clippingPlanes,
  isGhost,
  ghostOpacity,
}: {
  url: string;
  explodeFactor: number;
  caeOverlay: RotundaCaeOverlay;
  renderStyle: RotundaRenderStyle;
  simulationTime: number;
  clippingPlanes: THREE.Plane[];
  isGhost: boolean;
  ghostOpacity: number;
}): React.ReactElement {
  useRetainGltfUrl(url);
  const { scene } = useGLTF(url);
  const currentExplodeRef = useRef(explodeFactor);
  const tmpColorRef = useRef(new THREE.Color());

  const prepared = useMemo(() => {
    const cloned: THREE.Object3D = scene.clone(true);
    cloned.updateMatrixWorld(true);

    const bbox = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bbox.getSize(size);
    bbox.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const normScale = 0.72 / maxDim;

    const root = new THREE.Group();
    cloned.scale.setScalar(normScale);
    cloned.position.set(-center.x * normScale, -bbox.min.y * normScale + 0.01, -center.z * normScale);
    root.add(cloned);
    root.updateMatrixWorld(true);

    const explodeTargets: GltfExplodeTarget[] = [];
    const materials: GltfClonedMaterialRecord[] = [];
    const meshRecords: GltfMeshCaeRecord[] = [];
    const createdGeometries: THREE.BufferGeometry[] = [];
    const worldCenter = new THREE.Vector3(0, (size.y * normScale) / 2, 0);
    const candidateGroups: THREE.Object3D[] =
      cloned.children.length > 1
        ? cloned.children
        : (() => {
            const meshes: THREE.Object3D[] = [];
            cloned.traverse((child: THREE.Object3D) => {
              if ((child as THREE.Mesh).isMesh) meshes.push(child);
            });
            return meshes;
          })();

    candidateGroups.forEach((child: THREE.Object3D, idx: number) => {
      const childBox = new THREE.Box3().setFromObject(child);
      const childCenter = new THREE.Vector3();
      childBox.getCenter(childCenter);
      const dir = childCenter.sub(worldCenter);
      if (dir.lengthSq() < 1e-4) {
        const angle = (idx / Math.max(1, candidateGroups.length)) * Math.PI * 2;
        dir.set(Math.cos(angle) * 0.7, 0.4 + (idx % 3) * 0.25, Math.sin(angle) * 0.7);
      } else {
        dir.normalize();
      }
      explodeTargets.push({
        obj: child,
        basePos: child.position.clone(),
        explodeDir: dir,
      });
    });

    const sourceMeshes: THREE.Mesh[] = [];
    cloned.traverse((node: THREE.Object3D) => {
      if ((node as THREE.Mesh).isMesh) {
        sourceMeshes.push(node as THREE.Mesh);
      }
    });

    sourceMeshes.forEach((mesh, idx) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Clone geometry so per-vertex CAE color attributes never mutate shared useGLTF cache
      const clonedGeom = mesh.geometry.clone();
      mesh.geometry = clonedGeom;
      createdGeometries.push(clonedGeom);

      const originalColorAttr =
        (clonedGeom.getAttribute("color") as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined) ??
        null;

      // Subtle FEA mesh contour edges attached directly to the mesh (toggled visible only in FEA mode)
      let feaEdgeLines: THREE.LineSegments | null = null;
      let feaEdgeMat: THREE.LineBasicMaterial | null = null;
      try {
        const edgesGeo = new THREE.EdgesGeometry(clonedGeom, 22);
        createdGeometries.push(edgesGeo);
        feaEdgeMat = new THREE.LineBasicMaterial({
          color: "#0f172a",
          transparent: true,
          opacity: 0.22,
        });
        feaEdgeLines = new THREE.LineSegments(edgesGeo, feaEdgeMat);
        feaEdgeLines.visible = false;
        feaEdgeLines.raycast = () => undefined;
        mesh.add(feaEdgeLines);
      } catch {
        feaEdgeLines = null;
        feaEdgeMat = null;
      }

      meshRecords.push({
        mesh,
        geometry: clonedGeom,
        hasOriginalVertexColors: originalColorAttr !== null,
        originalColorAttr: originalColorAttr ? originalColorAttr.clone() : null,
        caeColorCache: {},
        feaEdgeLines,
        feaEdgeMat,
      });

      const cloneOne = (src: THREE.Material): THREE.MeshPhysicalMaterial => {
        const stdSrc = src as THREE.MeshPhysicalMaterial;
        const resolvedMetalness = typeof stdSrc.metalness === "number" ? stdSrc.metalness : 0.65;
        const resolvedRoughness = typeof stdSrc.roughness === "number" ? stdSrc.roughness : 0.34;
        const resolvedClearcoat = typeof stdSrc.clearcoat === "number" ? stdSrc.clearcoat : 0;
        const resolvedClearcoatRoughness =
          typeof stdSrc.clearcoatRoughness === "number" ? stdSrc.clearcoatRoughness : 0.22;
        const resolvedEnvMapIntensity =
          typeof stdSrc.envMapIntensity === "number" && stdSrc.envMapIntensity > 0
            ? Math.max(stdSrc.envMapIntensity, resolvedMetalness >= 0.5 ? 1.22 : 0.96)
            : resolvedMetalness >= 0.5
              ? 1.24
              : 0.96;

        const next = new THREE.MeshPhysicalMaterial({
          color: stdSrc.color ? stdSrc.color.clone() : new THREE.Color("#cfd5dc"),
          emissive: stdSrc.emissive ? stdSrc.emissive.clone() : new THREE.Color("#000000"),
          emissiveIntensity: typeof stdSrc.emissiveIntensity === "number" ? stdSrc.emissiveIntensity : 0,
          metalness: resolvedMetalness,
          roughness: resolvedRoughness,
          clearcoat: resolvedClearcoat,
          clearcoatRoughness: resolvedClearcoatRoughness,
          envMapIntensity: resolvedEnvMapIntensity,
          map: stdSrc.map ?? null,
          normalMap: stdSrc.normalMap ?? null,
          roughnessMap: stdSrc.roughnessMap ?? null,
          metalnessMap: stdSrc.metalnessMap ?? null,
          opacity: typeof stdSrc.opacity === "number" ? stdSrc.opacity : 1,
          transparent: Boolean(stdSrc.transparent),
        });
        materials.push({
          mat: next,
          originalColor: next.color.clone(),
          originalEmissive: next.emissive.clone(),
          originalEmissiveIntensity: next.emissiveIntensity,
          originalMetalness: next.metalness,
          originalRoughness: next.roughness,
          originalClearcoat: next.clearcoat,
          originalClearcoatRoughness: next.clearcoatRoughness,
          originalEnvMapIntensity: next.envMapIntensity,
          originalMap: next.map,
          originalOpacity: next.opacity,
          originalTransparent: next.transparent,
          stressWeight: clampNumber(0.2 + ((idx * 0.6180339) % 1) * 0.78, 0, 1),
          thermalWeight: clampNumber(0.22 + (((idx + 1) * 0.381966) % 1) * 0.76, 0, 1),
        });
        return next;
      };

      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(cloneOne);
      } else if (mesh.material) {
        mesh.material = cloneOne(mesh.material);
      }
    });

    return { root, explodeTargets, materials, meshRecords, createdGeometries, normScale };
  }, [scene]);

  // Dispose cloned materials, geometries, and edge lines cleanly on unmount
  useEffect(() => {
    return () => {
      for (const rec of prepared.materials) {
        rec.mat.dispose();
      }
      for (const mRec of prepared.meshRecords) {
        mRec.feaEdgeMat?.dispose();
      }
      for (const geo of prepared.createdGeometries) {
        geo.dispose();
      }
    };
  }, [prepared]);

  // Synchronize renderStyle, caeOverlay (per-vertex field contours), clippingPlanes, and ghost styling
  useEffect(() => {
    const planes = isGhost ? EMPTY_PLANES : clippingPlanes;
    const hasClipping = planes.length > 0;
    const tmpColor = tmpColorRef.current;
    const applyVertexCae = !isGhost && caeOverlay !== "none" && renderStyle === "shaded";

    for (const mRec of prepared.meshRecords) {
      if (applyVertexCae) {
        const mode = caeOverlay as CaeFieldOverlayMode;
        let colors = mRec.caeColorCache[mode];
        if (!colors) {
          colors = computeGeometryCaeVertexColors(mRec.geometry, mode);
          mRec.caeColorCache[mode] = colors;
        }
        if (colors.length > 0) {
          const existing = mRec.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
          if (existing && existing.array.length === colors.length) {
            (existing.array as Float32Array).set(colors);
            existing.needsUpdate = true;
          } else {
            mRec.geometry.setAttribute("color", new THREE.BufferAttribute(colors.slice(), 3));
          }
        }
      } else if (mRec.originalColorAttr) {
        mRec.geometry.setAttribute("color", mRec.originalColorAttr.clone());
      } else if (mRec.geometry.getAttribute("color")) {
        mRec.geometry.deleteAttribute("color");
      }

      if (mRec.feaEdgeLines && mRec.feaEdgeMat) {
        mRec.feaEdgeLines.visible = !isGhost && caeOverlay === "fea-stress" && renderStyle === "shaded";
        const prevEdgeClip = Array.isArray(mRec.feaEdgeMat.clippingPlanes) && mRec.feaEdgeMat.clippingPlanes.length > 0;
        mRec.feaEdgeMat.clippingPlanes = planes;
        if (prevEdgeClip !== hasClipping) {
          mRec.feaEdgeMat.needsUpdate = true;
        }
      }
    }

    for (const rec of prepared.materials) {
      const m = rec.mat;
      const prevHasClip = Array.isArray(m.clippingPlanes) && m.clippingPlanes.length > 0;
      const prevTransparent = m.transparent;
      const prevWireframe = m.wireframe;
      const prevSide = m.side;
      const prevVertexColors = m.vertexColors;
      const prevHasMap = m.map !== null;
      const prevHasClearcoat = m.clearcoat > 0;
      m.clippingPlanes = planes;
      m.clipShadows = true;

      if (isGhost) {
        m.color.set("#38bdf8");
        m.emissive.set("#1d4ed8");
        m.emissiveIntensity = 0.55;
        m.metalness = 0.2;
        m.roughness = 0.25;
        m.clearcoat = 0;
        m.envMapIntensity = 0.85;
        m.vertexColors = false;
        m.map = null;
        m.transparent = true;
        m.opacity = clampNumber(ghostOpacity, 0.05, 0.85);
        m.depthWrite = false;
        m.wireframe = renderStyle === "wireframe";
        m.side = THREE.FrontSide;
      } else {
        m.color.copy(rec.originalColor);
        m.emissive.copy(rec.originalEmissive);
        m.emissiveIntensity = rec.originalEmissiveIntensity;
        m.metalness = rec.originalMetalness;
        m.roughness = rec.originalRoughness;
        m.clearcoat = rec.originalClearcoat;
        m.clearcoatRoughness = rec.originalClearcoatRoughness;
        m.envMapIntensity = rec.originalEnvMapIntensity;
        m.vertexColors = false;
        m.map = rec.originalMap;

        if (applyVertexCae) {
          // Real geometry-aware per-vertex Von Mises / CFD Cp / Thermal field colors
          m.color.set("#ffffff");
          m.emissive.set("#000000");
          m.emissiveIntensity = 0;
          m.vertexColors = true;
          m.map = null;
          m.metalness = caeOverlay === "cfd-flow" ? 0.16 : 0.08;
          m.roughness = caeOverlay === "cfd-flow" ? 0.42 : 0.54;
          m.clearcoat = 0;
          m.envMapIntensity = 0.85;
        } else if (caeOverlay === "fea-stress") {
          tmpColor.set(sampleTurboStressColor(rec.stressWeight));
          m.color.copy(tmpColor);
          m.emissive.copy(tmpColor);
          m.emissiveIntensity = 0.25 + rec.stressWeight * 0.3;
          m.metalness = 0.22;
          m.roughness = 0.42;
          m.clearcoat = 0;
          m.envMapIntensity = 0.85;
        } else if (caeOverlay === "thermal") {
          tmpColor.set(sampleThermalColor(rec.thermalWeight));
          m.color.copy(tmpColor);
          m.emissive.copy(tmpColor);
          m.emissiveIntensity = 0.36 + rec.thermalWeight * 0.5;
          m.metalness = 0.16;
          m.roughness = 0.45;
          m.clearcoat = 0;
          m.envMapIntensity = 0.85;
        } else if (caeOverlay === "cfd-flow") {
          m.emissive.set("#0284c7");
          m.emissiveIntensity = Math.max(rec.originalEmissiveIntensity, 0.1);
        }

        if (renderStyle === "wireframe") {
          if (caeOverlay === "none") {
            m.color.set("#22d3ee");
            m.emissive.set("#06b6d4");
          }
          m.emissiveIntensity = 0.78;
          m.wireframe = true;
          m.transparent = true;
          m.opacity = 0.9;
          m.depthWrite = true;
          m.side = THREE.FrontSide;
        } else if (renderStyle === "xray") {
          if (caeOverlay === "none") {
            m.color.set("#38bdf8");
            m.emissive.set("#0ea5e9");
          }
          m.emissiveIntensity = 0.42;
          m.wireframe = false;
          m.transparent = true;
          m.opacity = 0.28;
          m.depthWrite = false;
          m.side = THREE.DoubleSide;
        } else {
          m.wireframe = false;
          m.transparent = rec.originalTransparent;
          m.opacity = rec.originalOpacity;
          m.depthWrite = !rec.originalTransparent;
          m.side = hasClipping ? THREE.DoubleSide : THREE.FrontSide;
        }
      }
      if (
        prevHasClip !== hasClipping ||
        prevTransparent !== m.transparent ||
        prevWireframe !== m.wireframe ||
        prevSide !== m.side ||
        prevVertexColors !== m.vertexColors ||
        prevHasMap !== (m.map !== null) ||
        prevHasClearcoat !== m.clearcoat > 0
      ) {
        m.needsUpdate = true;
      }
    }
  }, [prepared, renderStyle, caeOverlay, clippingPlanes, isGhost, ghostOpacity]);

  // Smoothly animate radial explosion displacements on child groups
  useFrame((_, delta) => {
    const target = clampNumber(explodeFactor, 0, 1);
    const alpha = 1 - Math.exp(-Math.min(delta, 0.1) * 10);
    currentExplodeRef.current += (target - currentExplodeRef.current) * alpha;
    const disp = (currentExplodeRef.current * 0.42) / Math.max(0.05, prepared.normScale);

    for (const item of prepared.explodeTargets) {
      item.obj.position.copy(item.basePos).addScaledVector(item.explodeDir, disp);
    }
  });

  return <primitive object={prepared.root} />;
}

// ── Live Universal Volumetric CFD & Thermal Overlays ────────────────────────
// Note: FEA Von Mises stress is rendered directly on the real 3D geometry via
// per-vertex stress contour fields & mesh edges (no detached mid-air spheres).

const STREAMLINE_COUNT = 10;
const PARTICLES_PER_STREAMLINE = 3;
const TOTAL_CFD_PARTICLES = STREAMLINE_COUNT * PARTICLES_PER_STREAMLINE; // 30 directional velocity cones

interface CfdVolumetricStreamline {
  id: string;
  curve: THREE.CatmullRomCurve3;
  tubeGeometry: THREE.TubeGeometry;
}

function positiveMod1(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const m = v % 1;
  return m < 0 ? m + 1 : m;
}

/**
 * Volumetric 3D CFD velocity streamlines rendered with native `THREE.TubeGeometry` ribbons
 * and directional velocity-colored `InstancedMesh` arrowheads.
 *
 * Intentionally avoids `three-stdlib` `<Line vertexColors transparent>` (whose `USE_LINE_COLOR_ALPHA`
 * shader define reads `vec4` from 3-component `itemSize=3` buffers and crashes WebGL2 GPUs).
 */
function CfdFlowStreamlinesOverlay({
  simulationTime,
  simulationTimeRef,
  isPlaying,
  clippingPlanes,
}: {
  simulationTime: number;
  simulationTimeRef?: React.RefObject<number> | undefined;
  isPlaying: boolean;
  clippingPlanes: THREE.Plane[];
}): React.ReactElement {
  const instancedRef = useRef<THREE.InstancedMesh | null>(null);
  const flowPhaseRef = useRef(0);
  const dummyObjRef = useRef(new THREE.Object3D());
  const tmpPosRef = useRef(new THREE.Vector3());
  const tmpTanRef = useRef(new THREE.Vector3());
  const tmpColorRef = useRef(new THREE.Color());
  const upVecRef = useRef(new THREE.Vector3(0, 1, 0));

  const resources = useMemo(() => {
    const streamlines: CfdVolumetricStreamline[] = [];
    const centerY = 0.34;
    const radialSegments = 6;
    const tubularSegments = 40;
    const tmpCol = new THREE.Color();

    for (let s = 0; s < STREAMLINE_COUNT; s++) {
      // Arrange two concentric aerodynamic flow shells (inner boundary layer + outer slipstream)
      const isOuter = s >= 6;
      const ringCount = isOuter ? STREAMLINE_COUNT - 6 : 6;
      const ringIdx = isOuter ? s - 6 : s;
      const azimuth = (ringIdx / ringCount) * Math.PI * 2 + (isOuter ? 0.42 : 0.14);
      const cosA = Math.cos(azimuth);
      const sinA = Math.sin(azimuth);
      const wakeSwirl = azimuth + (isOuter ? 0.38 : 0.62);
      const swirlCos = Math.cos(wakeSwirl);
      const swirlSin = Math.sin(wakeSwirl);

      const baseR = isOuter ? 0.34 : 0.21;
      const waistR = isOuter ? 0.56 : 0.44;
      const wakeR = isOuter ? 0.31 : 0.2;

      const controlPts = [
        new THREE.Vector3(cosA * baseR, Math.max(0.06, centerY + sinA * baseR * 0.72), 0.72),
        new THREE.Vector3(cosA * (baseR + waistR) * 0.5, Math.max(0.08, centerY + sinA * waistR * 0.62), 0.32),
        new THREE.Vector3(cosA * waistR, Math.max(0.11, centerY + sinA * waistR * 0.68), 0.0),
        new THREE.Vector3(swirlCos * (waistR * 0.78), Math.max(0.09, centerY + swirlSin * waistR * 0.58), -0.32),
        new THREE.Vector3(swirlCos * wakeR, Math.max(0.06, centerY + swirlSin * wakeR * 0.72), -0.72),
      ];

      const curve = new THREE.CatmullRomCurve3(controlPts, false, "catmullrom", 0.5);
      const tubeGeometry = new THREE.TubeGeometry(
        curve,
        tubularSegments,
        isOuter ? 0.0032 : 0.0042,
        radialSegments,
        false,
      );

      // Attach true linear per-vertex velocity-magnitude colors along the tube (itemSize = 3)
      const posAttr = tubeGeometry.getAttribute("position");
      const uvAttr = tubeGeometry.getAttribute("uv");
      const vertCount = posAttr.count;
      const colors = new Float32Array(vertCount * 3);
      for (let i = 0; i < vertCount; i++) {
        const u = uvAttr ? clampNumber(uvAttr.getX(i), 0, 1) : i / Math.max(1, vertCount - 1);
        const speedNorm = clampNumber(0.18 + 0.8 * Math.sin(u * Math.PI) * (isOuter ? 0.78 : 1.0), 0, 1);
        const [sr, sg, sb] = sampleCaeFieldRgb("fea-stress", speedNorm * 0.88, false);
        tmpCol.setRGB(sr, sg, sb, THREE.SRGBColorSpace);
        colors[i * 3] = tmpCol.r;
        colors[i * 3 + 1] = tmpCol.g;
        colors[i * 3 + 2] = tmpCol.b;
      }
      tubeGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      streamlines.push({
        id: `cfd-tube-${s}`,
        curve,
        tubeGeometry,
      });
    }

    const tubeMaterial = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      vertexColors: true,
      roughness: 0.28,
      metalness: 0.06,
      transparent: true,
      opacity: 0.82,
    });

    const coneGeometry = new THREE.ConeGeometry(0.011, 0.036, 8);
    const coneMaterial = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.22,
      metalness: 0.08,
      emissive: "#0ea5e9",
      emissiveIntensity: 0.32,
      transparent: true,
      opacity: 0.94,
    });

    return { streamlines, tubeMaterial, coneGeometry, coneMaterial };
  }, []);

  // Clean GPU resource disposal on unmount
  useEffect(() => {
    return () => {
      for (const s of resources.streamlines) {
        s.tubeGeometry.dispose();
      }
      resources.tubeMaterial.dispose();
      resources.coneGeometry.dispose();
      resources.coneMaterial.dispose();
    };
  }, [resources]);

  // Sync section-cut clipping planes onto both tube and arrowhead materials
  const hasClipping = clippingPlanes.length > 0;
  const prevClippingRef = useRef(hasClipping);
  useEffect(() => {
    resources.tubeMaterial.clippingPlanes = clippingPlanes;
    resources.coneMaterial.clippingPlanes = clippingPlanes;
    if (prevClippingRef.current !== hasClipping) {
      prevClippingRef.current = hasClipping;
      resources.tubeMaterial.needsUpdate = true;
      resources.coneMaterial.needsUpdate = true;
    }
  }, [resources, clippingPlanes, hasClipping]);

  const updateArrowInstances = useRef((phase: number) => {
    const mesh = instancedRef.current;
    if (!mesh) return;
    const dummy = dummyObjRef.current;
    const pos = tmpPosRef.current;
    const tan = tmpTanRef.current;
    const up = upVecRef.current;
    const col = tmpColorRef.current;

    let instanceIdx = 0;
    for (let s = 0; s < resources.streamlines.length; s++) {
      const stream = resources.streamlines[s]!;
      const isOuter = s >= 6;
      for (let p = 0; p < PARTICLES_PER_STREAMLINE; p++) {
        const uRaw = positiveMod1(phase + p / PARTICLES_PER_STREAMLINE + s * 0.11);
        const u = clampNumber(uRaw, 0.002, 0.998);
        stream.curve.getPointAt(u, pos);
        stream.curve.getTangentAt(u, tan);

        dummy.position.copy(pos);
        if (tan.lengthSq() > 1e-8) {
          tan.normalize();
          if (tan.y < -0.9995) {
            dummy.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
          } else {
            dummy.quaternion.setFromUnitVectors(up, tan);
          }
        } else {
          dummy.quaternion.identity();
        }

        const taper = Math.sin(u * Math.PI);
        const scaleLen = 0.65 + taper * 0.72;
        dummy.scale.set(0.95, scaleLen, 0.95);
        dummy.updateMatrix();
        mesh.setMatrixAt(instanceIdx, dummy.matrix);

        const speedNorm = clampNumber(0.18 + 0.8 * taper * (isOuter ? 0.78 : 1.0), 0, 1);
        const [sr, sg, sb] = sampleCaeFieldRgb("fea-stress", speedNorm * 0.88, false);
        col.setRGB(sr, sg, sb, THREE.SRGBColorSpace);
        mesh.setColorAt(instanceIdx, col);
        instanceIdx += 1;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  });

  // Populate initial transforms & velocity colors immediately on mount (even if paused)
  useEffect(() => {
    const liveTime = readLiveSimTime(simulationTime, simulationTimeRef);
    updateArrowInstances.current(positiveMod1(flowPhaseRef.current + liveTime * 0.08));
  }, [resources, simulationTime, simulationTimeRef]);

  useFrame((_, delta) => {
    if (isPlaying) {
      flowPhaseRef.current = positiveMod1(flowPhaseRef.current + Math.min(delta, 0.1) * 0.42);
    }
    const liveTime = readLiveSimTime(simulationTime, simulationTimeRef);
    updateArrowInstances.current(positiveMod1(flowPhaseRef.current + liveTime * 0.08));
  });

  return (
    <group name="cfd-volumetric-streamlines">
      {resources.streamlines.map((stream) => (
        <mesh key={stream.id} geometry={stream.tubeGeometry} material={resources.tubeMaterial} />
      ))}
      <instancedMesh
        ref={instancedRef}
        args={[resources.coneGeometry, resources.coneMaterial, TOTAL_CFD_PARTICLES]}
        frustumCulled={false}
      />
    </group>
  );
}

function ThermalFieldOverlay({
  simulationTime,
  simulationTimeRef,
  clippingPlanes,
}: {
  simulationTime: number;
  simulationTimeRef?: React.RefObject<number> | undefined;
  clippingPlanes: THREE.Plane[];
}): React.ReactElement {
  const ringRefs = useRef<Array<THREE.Mesh | null>>([]);
  const matRefs = useRef<Array<THREE.MeshStandardMaterial | null>>([]);

  useFrame(() => {
    const t = readLiveSimTime(simulationTime, simulationTimeRef);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.1);
    for (let idx = 0; idx < 3; idx++) {
      const cycle = (((t * 0.35 + idx / 3) % 1) + 1) % 1;
      const ring = ringRefs.current[idx];
      if (ring) {
        ring.position.y = -0.14 + cycle * 0.42;
        const scale = 1 + cycle * 0.4;
        ring.scale.set(scale, scale, 1);
      }
      const mat = matRefs.current[idx];
      if (mat) {
        mat.opacity = Math.sin(cycle * Math.PI) * 0.46;
        mat.emissiveIntensity = 1.4 + pulse * 0.4;
      }
    }
  });

  return (
    <group position={[0, 0.34, 0]}>
      {[0, 1, 2].map((idx) => (
        <mesh
          key={`thermal-ring-${idx}`}
          ref={(el) => {
            ringRefs.current[idx] = el;
          }}
          position={[0, -0.14 + (idx / 3) * 0.42, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[0.3, 0.005, 8, 36]} />
          <meshStandardMaterial
            ref={(el) => {
              matRefs.current[idx] = el;
            }}
            color="#f59e0b"
            emissive="#fbbf24"
            emissiveIntensity={1.5}
            transparent={true}
            opacity={0.32}
            depthWrite={false}
            clippingPlanes={clippingPlanes}
          />
        </mesh>
      ))}
    </group>
  );
}

// ── Main HeroModelAsset Component ───────────────────────────────────────────

export function HeroModelAsset({
  model,
  explodeFactor,
  caeOverlay,
  renderStyle,
  simulationTime,
  simulationTimeRef,
  isPlaying,
  clippingPlanes,
  animationController,
  isGhost = false,
  ghostOpacity = 0.38,
  visibility,
  isInXr = false,
  dark = true,
  onSelectSubsystem,
}: HeroModelAssetProps): React.ReactElement {
  const safeExplode = clampNumber(explodeFactor, 0, 1);
  const accentColor = model.accentColor ?? "#38bdf8";
  const effectivePlanes = isGhost ? EMPTY_PLANES : clippingPlanes;
  const liveMotionGroupRef = useRef<THREE.Group | null>(null);

  // Smooth 72 Hz ref-driven motion for showcase/external assemblies when React isn't re-rendering per frame
  const hasInternalRefMotion =
    !model.renderCustomContent &&
    !(model.vtkBuffer && model.vtkBuffer.byteLength > 0) &&
    !isLoadableGltfUri(model.artifactUri) &&
    !(model.cadComponents && model.cadComponents.length > 0) &&
    model.kind !== "drone" &&
    model.kind !== "wind-turbine" &&
    model.kind !== "satellite" &&
    model.kind !== "ev-battery";

  useFrame(() => {
    const grp = liveMotionGroupRef.current;
    if (!grp) return;
    if (isGhost || hasInternalRefMotion || !simulationTimeRef) {
      grp.position.set(0, 0, 0);
      grp.rotation.set(0, 0, 0);
      return;
    }

    const t = readLiveSimTime(simulationTime, simulationTimeRef);
    if (model.kind === "drone") {
      grp.position.set(0, Math.sin(t * 2.2) * 0.018, 0);
      grp.rotation.set(Math.sin(t * 1.4) * 0.022, Math.sin(t * 0.5) * 0.08, Math.cos(t * 1.1) * 0.022);
    } else if (model.kind === "satellite") {
      grp.position.set(0, Math.sin(t * 1.1) * 0.016, 0);
      grp.rotation.set(Math.sin(t * 0.6) * 0.018, t * 0.16, 0);
    } else if (isPlaying) {
      grp.position.set(0, 0, 0);
      grp.rotation.set(0, Math.sin(t * 0.35) * 0.16, 0);
    }
  });

  const proceduralAssembly = (() => {
    const showcaseProps = {
      explodeFactor: safeExplode,
      caeOverlay,
      renderStyle,
      simulationTime,
      clippingPlanes: effectivePlanes,
      isGhost,
      ghostOpacity,
      accentColor,
    };

    const assemblyProps: ProceduralAssemblyProps = {
      ...showcaseProps,
      simulationTimeRef,
    };

    switch (model.kind) {
      case "octopus-rov":
        return (
          <OctopusShowcaseAssembly
            explodeFactor={safeExplode}
            caeOverlay={caeOverlay}
            renderStyle={renderStyle}
            simulationTime={simulationTime}
            simulationTimeRef={simulationTimeRef}
            clippingPlanes={effectivePlanes}
            isGhost={isGhost}
            ghostOpacity={ghostOpacity}
            visibility={visibility}
            isInXr={isInXr}
            dark={dark}
            onSelectSubsystem={onSelectSubsystem}
          />
        );
      case "drone":
        return <HexacopterDroneAssembly {...showcaseProps} />;
      case "wind-turbine":
        return <WindTurbineAssembly {...showcaseProps} />;
      case "satellite":
        return <OrbitalSatelliteAssembly {...showcaseProps} />;
      case "ev-battery":
        return <EvBatteryPackAssembly {...showcaseProps} />;
      case "fea":
        return <AerospaceCantileverBracket {...assemblyProps} />;
      case "cfd":
      case "vtk":
        return <TurbofanDuctedRotor {...assemblyProps} />;
      case "urdf":
      case "multibody":
        return <ArticulatedRoboticArm {...assemblyProps} />;
      case "gcode":
        return <CncMachinedImpeller {...assemblyProps} />;
      case "cad":
      case "step":
      case "generic":
      default:
        return <HarmonicServoActuator {...assemblyProps} />;
    }
  })();

  const modelContent = (() => {
    // 1. Bespoke custom R3F content callback
    if (model.renderCustomContent) {
      return (
        <HeroAssetErrorBoundary key={`custom-${model.id}`} fallback={proceduralAssembly}>
          {model.renderCustomContent({
            explodeFactor: safeExplode,
            simulationTime,
            clippingPlanes: effectivePlanes,
          })}
        </HeroAssetErrorBoundary>
      );
    }

    // 2. Real VTK buffer renderer
    if (model.vtkBuffer && model.vtkBuffer.byteLength > 0) {
      return (
        <HeroAssetErrorBoundary key={`vtk-${model.id}`} fallback={proceduralAssembly}>
          <group position={[0, 0.34, 0]}>
            <VtkRenderer
              vtkBuffer={model.vtkBuffer}
              showStreamlines={caeOverlay === "cfd-flow" || model.kind === "cfd"}
              opacity={isGhost ? ghostOpacity : renderStyle === "xray" ? 0.36 : 0.94}
            />
          </group>
        </HeroAssetErrorBoundary>
      );
    }

    // 3. Real GLTF/GLB asset loader with Suspense + ErrorBoundary fallback
    if (isLoadableGltfUri(model.artifactUri)) {
      const gltfUrl = model.artifactUri.trim();
      return (
        <HeroAssetErrorBoundary key={`gltf-${gltfUrl}`} fallback={proceduralAssembly}>
          <Suspense fallback={proceduralAssembly}>
            <GltfHeroModel
              url={gltfUrl}
              explodeFactor={safeExplode}
              caeOverlay={caeOverlay}
              renderStyle={renderStyle}
              simulationTime={simulationTime}
              clippingPlanes={effectivePlanes}
              isGhost={isGhost}
              ghostOpacity={ghostOpacity}
            />
          </Suspense>
        </HeroAssetErrorBoundary>
      );
    }

    // 4. Explicit structural CAD components array
    if (model.cadComponents && model.cadComponents.length > 0) {
      return (
        <CadComponentsAssembly
          parts={model.cadComponents}
          explodeFactor={safeExplode}
          caeOverlay={caeOverlay}
          renderStyle={renderStyle}
          simulationTime={simulationTime}
          clippingPlanes={effectivePlanes}
          isGhost={isGhost}
          ghostOpacity={ghostOpacity}
          accentColor={accentColor}
          animationController={isGhost ? null : animationController}
        />
      );
    }

    // 5. Rich multi-part procedural engineering assembly chosen by model.kind
    return proceduralAssembly;
  })();

  return (
    <group name={`hero-model-${model.id}`}>
      <group ref={liveMotionGroupRef}>{modelContent}</group>

      {/* Live volumetric CFD & Thermal field overlays (FEA stress renders directly on the 3D geometry & mesh edges) */}
      {!isGhost && caeOverlay === "cfd-flow" && (
        <CfdFlowStreamlinesOverlay
          simulationTime={simulationTime}
          simulationTimeRef={simulationTimeRef}
          isPlaying={isPlaying}
          clippingPlanes={effectivePlanes}
        />
      )}
      {!isGhost && caeOverlay === "thermal" && (
        <ThermalFieldOverlay
          simulationTime={simulationTime}
          simulationTimeRef={simulationTimeRef}
          clippingPlanes={effectivePlanes}
        />
      )}
    </group>
  );
}
