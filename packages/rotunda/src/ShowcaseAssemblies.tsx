// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getCachedHeroPbrTextures,
  HERO_BRUSHED_NORMAL_SCALE,
  resolveHeroSurfaceParams,
  type HeroSurfaceFinish,
} from "@modelscript/cad-viewer/HeroCadMaterials.js";
import { Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import type React from "react";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createCaeFieldGradientTexture, type CaeFieldOverlayMode } from "./procedural-pbr.js";
import { clampNumber, type RotundaCaeOverlay, type RotundaRenderStyle } from "./types.js";

// ── Shared Types & Material / Leader-Line Helpers ───────────────────────────

export interface ShowcaseAssemblyProps {
  explodeFactor: number;
  caeOverlay: RotundaCaeOverlay;
  renderStyle: RotundaRenderStyle;
  simulationTime: number;
  clippingPlanes: THREE.Plane[];
  isGhost: boolean;
  ghostOpacity: number;
  accentColor: string;
}

export interface ShowcasePartMaterialProps {
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
  renderStyle: RotundaRenderStyle;
  caeOverlay: RotundaCaeOverlay;
  isGhost: boolean;
  ghostOpacity: number;
  clippingPlanes: THREE.Plane[];
  simulationTime: number;
}

const EMPTY_PLANES: THREE.Plane[] = [];

const SHARED_SHOWCASE_CAE_MAPS: Partial<Record<CaeFieldOverlayMode, THREE.DataTexture>> = {};

function getSharedShowcaseCaeMap(mode: CaeFieldOverlayMode): THREE.DataTexture {
  let tex = SHARED_SHOWCASE_CAE_MAPS[mode];
  if (!tex) {
    tex = createCaeFieldGradientTexture(mode, 128);
    SHARED_SHOWCASE_CAE_MAPS[mode] = tex;
  }
  return tex;
}

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

/**
 * Shared photoreal PBR/CAE/Hologram material helper matching HeroModelAsset's exact
 * renderStyle, caeOverlay, isGhost, ghostOpacity, clippingPlanes, stressFactor,
 * and thermalFactor behavior.
 */
export function ShowcasePartMaterial({
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
  renderStyle,
  caeOverlay,
  isGhost,
  ghostOpacity,
  clippingPlanes,
  simulationTime,
}: ShowcasePartMaterialProps): React.ReactElement {
  const { gl } = useThree();
  const pbrMaps = useMemo(() => getCachedHeroPbrTextures(gl), [gl]);
  const matRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const isInXr = useXR((s) => s.session != null);
  const effectivePlanes = isGhost ? EMPTY_PLANES : clippingPlanes;
  const hasClipping = effectivePlanes.length > 0;
  const activeContourMap: THREE.DataTexture | null =
    !isGhost && renderStyle === "shaded" && (caeOverlay === "fea-stress" || caeOverlay === "thermal")
      ? getSharedShowcaseCaeMap(caeOverlay)
      : null;

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

  const isWireframe = renderStyle === "wireframe";
  const isXray = renderStyle === "xray";
  const isShadedPbr = !isGhost && renderStyle === "shaded";
  const isCaeContour = caeOverlay === "fea-stress" || caeOverlay === "thermal";
  const useBrushedMaps = isShadedPbr && !isCaeContour && surface.mapMode === "brushed";
  const activeNormalMap = useBrushedMaps ? pbrMaps.normal : null;
  const activeRoughnessMap = useBrushedMaps ? pbrMaps.roughness : null;

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
  } else if (caeOverlay === "fea-stress") {
    const dynamicStress = clampNumber(stressFactor + 0.05 * Math.sin(simulationTime * 1.8 + stressFactor * 4.2), 0, 1);
    resolvedColor = activeContourMap ? "#ffffff" : sampleGradientHex(TURBO_STOPS, dynamicStress);
    resolvedEmissive = activeContourMap ? "#000000" : resolvedColor;
    resolvedEmissiveIntensity = activeContourMap ? 0 : 0.16 + dynamicStress * 0.24;
    resolvedMetalness = 0.14;
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
    resolvedColor = activeContourMap ? "#ffffff" : sampleGradientHex(THERMAL_STOPS, dynamicThermal);
    resolvedEmissive = activeContourMap ? "#000000" : resolvedColor;
    resolvedEmissiveIntensity = activeContourMap ? 0 : 0.24 + dynamicThermal * 0.4;
    resolvedMetalness = 0.12;
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
  const resolvedSide = isXray || (!isGhost && hasClipping) ? THREE.DoubleSide : THREE.FrontSide;

  const prevStateRef = useRef<{
    hasClipping: boolean;
    hasMap: boolean;
    hasNormalMap: boolean;
    hasRoughnessMap: boolean;
    wireframe: boolean;
    transparent: boolean;
    side: THREE.Side;
  }>({
    hasClipping,
    hasMap: activeContourMap !== null,
    hasNormalMap: activeNormalMap !== null,
    hasRoughnessMap: activeRoughnessMap !== null,
    wireframe: isWireframe,
    transparent: resolvedTransparent,
    side: resolvedSide,
  });

  useEffect(() => {
    const mat = matRef.current;
    if (!mat) return;
    mat.clippingPlanes = effectivePlanes;
    mat.map = activeContourMap;
    mat.normalMap = activeNormalMap;
    mat.roughnessMap = activeRoughnessMap;
    mat.wireframe = isWireframe;
    mat.transparent = resolvedTransparent;
    mat.opacity = resolvedOpacity;
    mat.depthWrite = resolvedDepthWrite;
    mat.side = resolvedSide;
    const hasMap = activeContourMap !== null;
    const hasNormalMap = activeNormalMap !== null;
    const hasRoughnessMap = activeRoughnessMap !== null;
    const prev = prevStateRef.current;
    if (
      prev.hasClipping !== hasClipping ||
      prev.hasMap !== hasMap ||
      prev.hasNormalMap !== hasNormalMap ||
      prev.hasRoughnessMap !== hasRoughnessMap ||
      prev.wireframe !== isWireframe ||
      prev.transparent !== resolvedTransparent ||
      prev.side !== resolvedSide
    ) {
      prevStateRef.current = {
        hasClipping,
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
        key="showcase-xr-std"
        ref={matRef}
        color={resolvedColor}
        map={activeContourMap}
        emissive={resolvedEmissive}
        emissiveIntensity={resolvedEmissiveIntensity}
        metalness={resolvedMetalness}
        roughness={resolvedRoughness}
        wireframe={isWireframe}
        transparent={resolvedTransparent}
        opacity={resolvedOpacity}
        depthWrite={resolvedDepthWrite}
        normalMap={activeNormalMap}
        normalScale={HERO_BRUSHED_NORMAL_SCALE}
        roughnessMap={activeRoughnessMap}
        envMapIntensity={resolvedEnvMapIntensity}
        side={resolvedSide}
        clippingPlanes={effectivePlanes}
        clipShadows={hasClipping}
      />
    );
  }

  return (
    <meshPhysicalMaterial
      key="showcase-desk-phys"
      ref={matRef}
      color={resolvedColor}
      map={activeContourMap}
      emissive={resolvedEmissive}
      emissiveIntensity={resolvedEmissiveIntensity}
      metalness={resolvedMetalness}
      roughness={resolvedRoughness}
      wireframe={isWireframe}
      transparent={resolvedTransparent}
      opacity={resolvedOpacity}
      depthWrite={resolvedDepthWrite}
      clearcoat={resolvedClearcoat}
      clearcoatRoughness={resolvedClearcoatRoughness}
      anisotropy={resolvedAnisotropy}
      anisotropyRotation={surface.anisotropyRotation}
      iridescence={resolvedIridescence}
      iridescenceIOR={surface.iridescenceIOR}
      normalMap={activeNormalMap}
      normalScale={HERO_BRUSHED_NORMAL_SCALE}
      roughnessMap={activeRoughnessMap}
      envMapIntensity={resolvedEnvMapIntensity}
      side={resolvedSide}
      clippingPlanes={effectivePlanes}
      clipShadows={hasClipping}
    />
  );
}

interface ClippedGlowMaterialProps {
  color: string;
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
  clippingPlanes: THREE.Plane[];
  depthWrite?: boolean | undefined;
  side?: THREE.Side | undefined;
}

/** Translucent emissive accent material (plasma plumes, LEDs, rotor blur discs) that respects clipping planes. */
function ClippedGlowMaterial({
  color,
  emissive,
  emissiveIntensity,
  opacity,
  clippingPlanes,
  depthWrite = false,
  side = THREE.FrontSide,
}: ClippedGlowMaterialProps): React.ReactElement {
  const matRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const hasClipping = clippingPlanes.length > 0;

  useEffect(() => {
    const mat = matRef.current;
    if (!mat) return;
    mat.clippingPlanes = clippingPlanes;
    mat.needsUpdate = true;
  }, [clippingPlanes, hasClipping]);

  return (
    <meshStandardMaterial
      ref={matRef}
      color={color}
      emissive={emissive}
      emissiveIntensity={emissiveIntensity}
      metalness={0.1}
      roughness={0.2}
      transparent={true}
      opacity={clampNumber(opacity, 0, 1)}
      depthWrite={depthWrite}
      side={side}
      clippingPlanes={clippingPlanes}
    />
  );
}

interface ShowcaseLeaderLineSpec {
  id: string;
  from: [number, number, number];
  to: [number, number, number];
  color?: string | undefined;
}

function ShowcaseLeaderLines({
  lines,
  explodeFactor,
  isGhost,
}: {
  lines: readonly ShowcaseLeaderLineSpec[];
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

// ── Showcase 1: Autonomous Carbon Hexacopter Drone ("drone") ────────────────

const DRONE_ARM_ANGLES: readonly number[] = [0, 1, 2, 3, 4, 5].map((i) => (i * Math.PI) / 3);
const DRONE_STANDOFF_ANGLES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * Math.PI) / 4 + Math.PI / 8);

function buildCurvedLandingSkidGeometry(): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.046, -0.185),
    new THREE.Vector3(0, 0.014, -0.132),
    new THREE.Vector3(0, 0.01, 0),
    new THREE.Vector3(0, 0.014, 0.132),
    new THREE.Vector3(0, 0.046, 0.185),
  ]);
  return new THREE.TubeGeometry(curve, 22, 0.0085, 8, false);
}

export function HexacopterDroneAssembly({
  explodeFactor,
  caeOverlay,
  renderStyle,
  simulationTime,
  clippingPlanes,
  isGhost,
  ghostOpacity,
  accentColor,
}: ShowcaseAssemblyProps): React.ReactElement {
  const e = clampNumber(explodeFactor, 0, 1);

  const skidGeom = useMemo(() => buildCurvedLandingSkidGeometry(), []);
  useEffect(() => () => skidGeom.dispose(), [skidGeom]);

  // Subtle hover vibration & gimbal pitch stabilization
  const chassisY = 0.255 + e * 0.085;
  const upperDeckOffsetY = 0.04 + e * 0.075;
  const pcbOffsetY = 0.016 + e * 0.036;
  const domeY = 0.312 + e * 0.255;
  const batteryY = 0.205 - e * 0.108;
  const armRadialExplode = e * 0.13;
  const gimbalZ = 0.145 + e * 0.095;
  const gimbalY = chassisY - 0.048 - e * 0.025;
  const skidSideOffset = e * 0.05;

  const gimbalYaw = Math.sin(simulationTime * 0.85) * 0.2;
  const gimbalPitch = -0.12 + Math.sin(simulationTime * 1.75) * 0.22;

  const leaderLines = useMemo<ShowcaseLeaderLineSpec[]>(() => {
    if (e <= 0.04 || isGhost) return [];
    const specs: ShowcaseLeaderLineSpec[] = [
      { id: "dome", from: [0, 0.312, 0], to: [0, domeY, 0], color: "#38bdf8" },
      { id: "battery", from: [0, 0.205, 0], to: [0, batteryY, 0], color: "#f59e0b" },
      { id: "gimbal", from: [0, 0.207, 0.145], to: [0, gimbalY, gimbalZ], color: "#22d3ee" },
    ];
    for (let i = 0; i < DRONE_ARM_ANGLES.length; i++) {
      const a = DRONE_ARM_ANGLES[i] ?? 0;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      specs.push({
        id: `arm-${i}`,
        from: [cx * 0.125, chassisY, cz * 0.125],
        to: [cx * (0.125 + armRadialExplode), chassisY, cz * (0.125 + armRadialExplode)],
        color: "#38bdf8",
      });
    }
    return specs;
  }, [e, isGhost, domeY, batteryY, gimbalY, gimbalZ, chassisY, armRadialExplode]);

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
      {/* 1. Twin Curved Carbon Landing Skids */}
      {[-1, 1].map((side) => {
        const skidX = side * (0.138 + skidSideOffset);
        return (
          <group key={`skid-${side}`} position={[skidX, 0, 0]}>
            <mesh geometry={skidGeom} castShadow receiveShadow>
              <ShowcasePartMaterial {...sharedMat} finish="carbon-fiber" stressFactor={0.44} thermalFactor={0.18} />
            </mesh>
            {/* Front & rear slanted carbon landing struts */}
            {[-0.075, 0.075].map((zOff, idx) => (
              <mesh
                key={`strut-${idx}`}
                position={[-side * 0.028, 0.128, zOff]}
                rotation={[0, 0, side * 0.24]}
                castShadow
              >
                <cylinderGeometry args={[0.007, 0.008, 0.235, 10]} />
                <ShowcasePartMaterial
                  {...sharedMat}
                  finish="carbon-fiber"
                  baseColor="#4a5360"
                  stressFactor={0.56}
                  thermalFactor={0.2}
                />
              </mesh>
            ))}
            {/* Horizontal stabilizer cross-brace bar */}
            <mesh position={[-side * 0.036, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.005, 0.005, 0.155, 8]} />
              <ShowcasePartMaterial {...sharedMat} finish="anodized-aluminum" stressFactor={0.42} thermalFactor={0.2} />
            </mesh>
          </group>
        );
      })}

      {/* 2. Underside LiPo Flight Battery Pack with Retaining Strap (explodes along -Y) */}
      <group position={[0, batteryY, -0.015]}>
        {/* Main high-discharge 6S LiPo cell brick */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.106, 0.052, 0.156]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="rubber"
            baseColor="#464d57"
            roughness={0.78}
            stressFactor={0.34}
            thermalFactor={0.88}
          />
        </mesh>
        {/* Amber high-voltage cell specification label band */}
        <mesh position={[0, 0.002, 0]}>
          <boxGeometry args={[0.108, 0.016, 0.12]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="painted"
            baseColor="#e89a25"
            stressFactor={0.3}
            thermalFactor={0.84}
          />
        </mesh>
        {/* Twin Velcro retaining straps wrapping battery */}
        {[-0.042, 0.042].map((zStrap, idx) => (
          <mesh key={`strap-${idx}`} position={[0, 0, zStrap]}>
            <boxGeometry args={[0.112, 0.057, 0.018]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="rubber"
              baseColor="#383e47"
              roughness={0.88}
              stressFactor={0.5}
              thermalFactor={0.65}
            />
          </mesh>
        ))}
        {/* Rear XT90 yellow power connector */}
        <mesh position={[0, 0.006, -0.088]}>
          <boxGeometry args={[0.028, 0.018, 0.024]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="painted"
            baseColor="#e3b22c"
            stressFactor={0.28}
            thermalFactor={0.78}
          />
        </mesh>
      </group>

      {/* 3. Central Octagonal Carbon-Fiber Chassis Deck + Internal Flight Controller PCB */}
      <group position={[0, chassisY, 0]}>
        {/* Lower octagonal carbon-fiber plate */}
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.138, 0.144, 0.012, 8]} />
          <ShowcasePartMaterial {...sharedMat} finish="carbon-fiber" stressFactor={0.72} thermalFactor={0.58} />
        </mesh>

        {/* 8 anodized standoff posts around perimeter */}
        {DRONE_STANDOFF_ANGLES.map((angle, idx) => (
          <mesh key={`standoff-${idx}`} position={[Math.cos(angle) * 0.116, 0.02, Math.sin(angle) * 0.116]}>
            <cylinderGeometry args={[0.006, 0.006, 0.036, 8]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="anodized-aluminum"
              baseColor={accentColor}
              stressFactor={0.58}
              thermalFactor={0.48}
            />
          </mesh>
        ))}

        {/* Internal Flight-Controller PCB with Glowing Green/Cyan Status LEDs */}
        <group position={[0, pcbOffsetY, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.112, 0.008, 0.112]} />
            <ShowcasePartMaterial {...sharedMat} finish="pcb" stressFactor={0.24} thermalFactor={0.84} />
          </mesh>
          {/* Central IMU / Flight Processor IC */}
          <mesh position={[0, 0.008, 0]}>
            <boxGeometry args={[0.036, 0.009, 0.036]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="rubber"
              baseColor="#3d434c"
              roughness={0.78}
              stressFactor={0.2}
              thermalFactor={0.96}
            />
          </mesh>
          {/* Silver RF telemetry shield can + gold ESC bus pads */}
          <mesh position={[-0.032, 0.007, -0.028]}>
            <boxGeometry args={[0.028, 0.008, 0.024]} />
            <ShowcasePartMaterial {...sharedMat} finish="brushed-aluminum" stressFactor={0.18} thermalFactor={0.86} />
          </mesh>
          <mesh position={[0.034, 0.006, 0.026]}>
            <boxGeometry args={[0.024, 0.006, 0.032]} />
            <ShowcasePartMaterial {...sharedMat} finish="gold" stressFactor={0.2} thermalFactor={0.8} />
          </mesh>
          {/* 4 Glowing Green/Cyan Status LEDs */}
          {!isGhost &&
            (
              [
                [-0.038, 0.036, "#10b981", "#34d399", 0],
                [0.038, 0.036, "#06b6d4", "#22d3ee", 1.6],
                [-0.038, -0.036, "#06b6d4", "#22d3ee", 3.1],
                [0.038, -0.036, "#10b981", "#34d399", 4.7],
              ] as const
            ).map(([lx, lz, col, em, phase], idx) => {
              const pulse = 0.55 + 0.45 * Math.sin(simulationTime * 5.2 + phase);
              return (
                <mesh key={`fc-led-${idx}`} position={[lx, 0.009, lz]}>
                  <sphereGeometry args={[0.007, 10, 10]} />
                  <ClippedGlowMaterial
                    color={col}
                    emissive={em}
                    emissiveIntensity={1.2 + pulse * 1.4}
                    opacity={0.95}
                    depthWrite={true}
                    clippingPlanes={clippingPlanes}
                  />
                </mesh>
              );
            })}
        </group>

        {/* Upper octagonal carbon-fiber deck plate */}
        <mesh position={[0, upperDeckOffsetY, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.132, 0.138, 0.011, 8]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="carbon-fiber"
            baseColor="#4b5462"
            stressFactor={0.68}
            thermalFactor={0.56}
          />
        </mesh>

        {/* 4. Six Radial Carbon Arms + Brushless Motor Pods + Spinning Dual-Blade Rotors */}
        {DRONE_ARM_ANGLES.map((angle, idx) => {
          const dir = idx % 2 === 0 ? 1 : -1;
          const rotorSpin = simulationTime * 11.5 * dir + idx * 0.85;
          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);
          const isFrontArm = sinA > 0.2;
          const navColor = isFrontArm ? "#22c55e" : "#ef4444";

          return (
            <group
              key={`drone-arm-${idx}`}
              position={[cosA * armRadialExplode, 0.012, sinA * armRadialExplode]}
              rotation={[0, -angle, 0]}
            >
              {/* Anodized root clamp block */}
              <mesh position={[0.134, 0, 0]} castShadow>
                <boxGeometry args={[0.028, 0.026, 0.032]} />
                <ShowcasePartMaterial
                  {...sharedMat}
                  finish="anodized-aluminum"
                  stressFactor={0.94}
                  thermalFactor={0.52}
                />
              </mesh>
              {/* Tubular carbon-fiber radial boom */}
              <mesh position={[0.212, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.01, 0.012, 0.162, 12]} />
                <ShowcasePartMaterial {...sharedMat} finish="carbon-fiber" stressFactor={0.84} thermalFactor={0.46} />
              </mesh>

              {/* Brushless Motor Pod & ESC Mount at tip (r = 0.292) */}
              <group position={[0.292, 0.01, 0]}>
                {/* Motor mount base plate */}
                <mesh position={[0, -0.012, 0]} castShadow>
                  <cylinderGeometry args={[0.027, 0.024, 0.012, 16]} />
                  <ShowcasePartMaterial {...sharedMat} finish="satin-steel" stressFactor={0.78} thermalFactor={0.72} />
                </mesh>
                {/* Underside navigation beacon LED */}
                {!isGhost && (
                  <mesh position={[0, -0.022, 0]}>
                    <sphereGeometry args={[0.007, 10, 10]} />
                    <ClippedGlowMaterial
                      color={navColor}
                      emissive={navColor}
                      emissiveIntensity={1.6}
                      opacity={0.95}
                      depthWrite={true}
                      clippingPlanes={clippingPlanes}
                    />
                  </mesh>
                )}
                {/* Copper stator winding core ring */}
                <mesh position={[0, 0.006, 0]}>
                  <cylinderGeometry args={[0.021, 0.021, 0.018, 16]} />
                  <ShowcasePartMaterial {...sharedMat} finish="copper" stressFactor={0.68} thermalFactor={0.94} />
                </mesh>
                {/* Brushless outrunner bell housing */}
                <mesh position={[0, 0.012, 0]} castShadow>
                  <cylinderGeometry args={[0.025, 0.026, 0.022, 18]} />
                  <ShowcasePartMaterial {...sharedMat} finish="dark-anodized" stressFactor={0.72} thermalFactor={0.9} />
                </mesh>

                {/* Spinning Rotor Hub & Dual Pitched Blades (CW/CCW alternating) */}
                <group position={[0, 0.028, 0]} rotation={[0, rotorSpin, 0]}>
                  {/* Machined spinner nut */}
                  <mesh castShadow>
                    <coneGeometry args={[0.011, 0.018, 12]} />
                    <ShowcasePartMaterial
                      {...sharedMat}
                      finish="brushed-aluminum"
                      stressFactor={0.42}
                      thermalFactor={0.46}
                    />
                  </mesh>
                  {/* Dual pitched carbon propeller blades */}
                  {[-1, 1].map((bSide) => (
                    <group
                      key={`blade-${bSide}`}
                      position={[bSide * 0.048, -0.002, 0]}
                      rotation={[0.18 * dir * bSide, 0, 0]}
                    >
                      <mesh castShadow>
                        <boxGeometry args={[0.088, 0.0035, 0.017]} />
                        <ShowcasePartMaterial
                          {...sharedMat}
                          finish="carbon-fiber"
                          stressFactor={0.76}
                          thermalFactor={0.34}
                        />
                      </mesh>
                      {/* High-visibility blade tip stripe */}
                      <mesh position={[bSide * 0.036, 0.0005, 0]}>
                        <boxGeometry args={[0.014, 0.004, 0.016]} />
                        <ShowcasePartMaterial
                          {...sharedMat}
                          finish="painted"
                          baseColor={dir > 0 ? "#2ca9e6" : "#eb6b21"}
                          emissive={dir > 0 ? "#0284c7" : "#c2410c"}
                          emissiveIntensity={0.22}
                          stressFactor={0.62}
                          thermalFactor={0.32}
                        />
                      </mesh>
                    </group>
                  ))}
                </group>

                {/* Subtle translucent motion-blur rotor disc ring */}
                {!isGhost && renderStyle === "shaded" && (
                  <mesh position={[0, 0.026, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.028, 0.092, 24]} />
                    <ClippedGlowMaterial
                      color={dir > 0 ? "#38bdf8" : "#fb923c"}
                      emissive={dir > 0 ? "#0284c7" : "#ea580c"}
                      emissiveIntensity={0.35}
                      opacity={0.14}
                      side={THREE.DoubleSide}
                      clippingPlanes={clippingPlanes}
                    />
                  </mesh>
                )}
              </group>
            </group>
          );
        })}
      </group>

      {/* 5. Top Aerodynamic Sensor Dome (explodes upward along +Y) */}
      <group position={[0, domeY, 0]}>
        {/* Sculpted low-profile canopy dome */}
        <mesh scale={[1.0, 0.56, 1.12]} castShadow receiveShadow>
          <sphereGeometry args={[0.122, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
          <ShowcasePartMaterial {...sharedMat} finish="ceramic-white" stressFactor={0.22} thermalFactor={0.4} />
        </mesh>
        {/* Front optical sensor visor inlay */}
        <mesh position={[0, 0.026, 0.114]} rotation={[0.32, 0, 0]}>
          <boxGeometry args={[0.072, 0.018, 0.022]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="glass-lens"
            emissive="#0c4a6e"
            emissiveIntensity={0.24}
            stressFactor={0.18}
            thermalFactor={0.45}
          />
        </mesh>
        {/* Elevated RTK-GPS / LiDAR mast & puck */}
        <mesh position={[0, 0.072, -0.015]} castShadow>
          <cylinderGeometry args={[0.008, 0.01, 0.036, 12]} />
          <ShowcasePartMaterial {...sharedMat} finish="satin-steel" stressFactor={0.28} thermalFactor={0.32} />
        </mesh>
        <mesh position={[0, 0.094, -0.015]} castShadow>
          <cylinderGeometry args={[0.036, 0.038, 0.016, 20]} />
          <ShowcasePartMaterial {...sharedMat} finish="dark-anodized" stressFactor={0.2} thermalFactor={0.38} />
        </mesh>
        <mesh position={[0, 0.094, -0.015]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.038, 0.0035, 8, 24]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="painted"
            baseColor={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.55}
            stressFactor={0.18}
            thermalFactor={0.36}
          />
        </mesh>
      </group>

      {/* 6. Front 2-Axis Stabilized Camera Gimbal */}
      <group position={[0, gimbalY, gimbalZ]}>
        {/* Isolation damper mount */}
        <mesh position={[0, 0.022, -0.01]}>
          <boxGeometry args={[0.052, 0.014, 0.044]} />
          <ShowcasePartMaterial {...sharedMat} finish="rubber" stressFactor={0.4} thermalFactor={0.35} />
        </mesh>
        {/* Yaw yoke + Pitch-stabilizing optical payload */}
        <group rotation={[0, gimbalYaw, 0]}>
          <mesh position={[0, 0.004, 0]}>
            <boxGeometry args={[0.068, 0.012, 0.018]} />
            <ShowcasePartMaterial {...sharedMat} finish="brushed-aluminum" stressFactor={0.38} thermalFactor={0.42} />
          </mesh>
          <group position={[0, -0.016, 0.006]} rotation={[gimbalPitch, 0, 0]}>
            {/* Camera housing */}
            <mesh castShadow>
              <boxGeometry args={[0.052, 0.04, 0.046]} />
              <ShowcasePartMaterial {...sharedMat} finish="dark-anodized" stressFactor={0.26} thermalFactor={0.56} />
            </mesh>
            {/* Optical lens barrel */}
            <mesh position={[0, 0, 0.028]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.016, 0.018, 0.022, 18]} />
              <ShowcasePartMaterial
                {...sharedMat}
                finish="satin-steel"
                baseColor="#6f7884"
                stressFactor={0.2}
                thermalFactor={0.48}
              />
            </mesh>
            {/* Coated glass lens element */}
            <mesh position={[0, 0, 0.039]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.013, 0.013, 0.003, 18]} />
              <ShowcasePartMaterial
                {...sharedMat}
                finish="glass-lens"
                baseColor="#17385c"
                emissive="#0ea5e9"
                emissiveIntensity={0.22}
                stressFactor={0.15}
                thermalFactor={0.42}
              />
            </mesh>
          </group>
        </group>
      </group>

      <ShowcaseLeaderLines lines={leaderLines} explodeFactor={e} isGhost={isGhost} />
    </group>
  );
}

// ── Showcase 2: Offshore Direct-Drive / Geared Wind Turbine ("wind-turbine") ─

const TURBINE_BLADE_ANGLES: readonly number[] = [0, 1, 2].map((i) => (i * Math.PI * 2) / 3);
const TURBINE_BASE_BOLT_ANGLES: readonly number[] = Array.from({ length: 12 }, (_, i) => (i * Math.PI * 2) / 12);
const TURBINE_PLANET_ANGLES: readonly number[] = [0, 1, 2].map((i) => (i * Math.PI * 2) / 3);

/** Builds a smooth ogive aerodynamic nose spinner cone pointing along +Y (rotated to +Z when mounted). */
function buildSpinnerConeGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.001, 0.108),
    new THREE.Vector2(0.016, 0.095),
    new THREE.Vector2(0.032, 0.074),
    new THREE.Vector2(0.045, 0.046),
    new THREE.Vector2(0.053, 0.018),
    new THREE.Vector2(0.056, 0.0),
    new THREE.Vector2(0.001, 0.0),
  ];
  return new THREE.LatheGeometry(pts, 24);
}

/** Builds a thick-walled curved fiberglass nacelle clam-shell arch extruded along Z. */
function buildNacelleClamShellGeometry(): THREE.ExtrudeGeometry {
  const outerR = 0.078;
  const innerR = 0.066;
  const shape = new THREE.Shape();
  const segs = 20;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI;
    const x = Math.cos(a) * outerR;
    const y = Math.sin(a) * outerR * 0.94;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = segs; i >= 0; i--) {
    const a = (i / segs) * Math.PI;
    const x = Math.cos(a) * innerR;
    const y = Math.sin(a) * innerR * 0.94;
    shape.lineTo(x, y);
  }
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: 0.25,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.007,
    bevelSegments: 2,
  });
  geom.translate(0, 0, -0.125);
  return geom;
}

/** Builds a lofted, tapered, twisted aerodynamic wind-turbine airfoil blade spanning +Y from r=0.032 to r=0.275. */
function buildTurbineBladeGeometry(): THREE.BufferGeometry {
  const stations = 10;
  const ringSegs = 12;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s <= stations; s++) {
    const t = s / stations;
    const y = 0.032 + t * 0.243;
    // Blend from cylindrical root into cambered airfoil chord
    const airBlend = clampNumber((t - 0.08) / 0.2, 0, 1);
    const chord = 0.024 * (1 - airBlend) + 0.052 * (1 - t * 0.72) * airBlend;
    const thickness = 0.024 * (1 - airBlend) + chord * (0.28 - t * 0.14) * airBlend;
    const twist = 0.36 * (1 - t) + 0.06;
    const cosTw = Math.cos(twist);
    const sinTw = Math.sin(twist);

    for (let i = 0; i < ringSegs; i++) {
      const theta = (i / ringSegs) * Math.PI * 2;
      // Parameterize CCW when viewed from +Y so (b-a)x(c-a) faces outward
      const lx = Math.cos(theta) * (chord * 0.5) - airBlend * chord * 0.12;
      const camber =
        airBlend * Math.sin(theta) * (thickness * 0.5) +
        airBlend * (1 - Math.cos(theta) * Math.cos(theta)) * thickness * 0.18;
      const lz = -camber - (1 - airBlend) * Math.sin(theta) * (thickness * 0.5);

      const rx = lx * cosTw - lz * sinTw;
      const rz = lx * sinTw + lz * cosTw;
      positions.push(rx, y, rz);
    }
  }

  for (let s = 0; s < stations; s++) {
    for (let i = 0; i < ringSegs; i++) {
      const next = (i + 1) % ringSegs;
      const a = s * ringSegs + i;
      const b = s * ringSegs + next;
      const c = (s + 1) * ringSegs + i;
      const d = (s + 1) * ringSegs + next;
      indices.push(a, b, d, a, d, c);
    }
  }

  // Close blade tip cap cleanly
  const tipCenterIdx = positions.length / 3;
  positions.push(0, 0.275, 0);
  const lastRingStart = stations * ringSegs;
  for (let i = 0; i < ringSegs; i++) {
    const next = (i + 1) % ringSegs;
    indices.push(tipCenterIdx, lastRingStart + i, lastRingStart + next);
  }

  const uvs: number[] = [];
  for (let s = 0; s <= stations; s++) {
    const v = s / stations;
    for (let i = 0; i < ringSegs; i++) {
      uvs.push(i / ringSegs, v);
    }
  }
  uvs.push(0.5, 1);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

export function WindTurbineAssembly({
  explodeFactor,
  caeOverlay,
  renderStyle,
  simulationTime,
  clippingPlanes,
  isGhost,
  ghostOpacity,
  accentColor,
}: ShowcaseAssemblyProps): React.ReactElement {
  const e = clampNumber(explodeFactor, 0, 1);

  const spinnerGeom = useMemo(() => buildSpinnerConeGeometry(), []);
  const clamShellGeom = useMemo(() => buildNacelleClamShellGeometry(), []);
  const bladeGeom = useMemo(() => buildTurbineBladeGeometry(), []);

  useEffect(
    () => () => {
      spinnerGeom.dispose();
      clamShellGeom.dispose();
      bladeGeom.dispose();
    },
    [spinnerGeom, clamShellGeom, bladeGeom],
  );

  const hubY = 0.48;
  const rotorAngle = simulationTime * 1.45;
  const highSpeedSpin = rotorAngle * 4.6;
  const anemometerSpin = simulationTime * 6.5;
  const beaconPulse = 0.5 + 0.5 * Math.sin(simulationTime * 3.8);

  const upperShellY = hubY + 0.004 + e * 0.175;
  const lowerShellY = hubY - 0.004 - e * 0.072;
  const hubZ = 0.128 + e * 0.145;
  const gearboxZ = -0.01 - e * 0.032;
  const generatorZ = -0.105 - e * 0.135;
  const bladeRadialExplode = e * 0.042;

  const leaderLines = useMemo<ShowcaseLeaderLineSpec[]>(() => {
    if (e <= 0.04 || isGhost) return [];
    const specs: ShowcaseLeaderLineSpec[] = [
      { id: "upper-shell", from: [0, hubY + 0.004, -0.03], to: [0, upperShellY, -0.03], color: "#38bdf8" },
      { id: "lower-shell", from: [0, hubY - 0.004, -0.03], to: [0, lowerShellY, -0.03], color: "#94a3b8" },
      { id: "hub", from: [0, hubY, 0.128], to: [0, hubY, hubZ], color: "#22d3ee" },
      { id: "generator", from: [0, hubY, -0.105], to: [0, hubY, generatorZ], color: "#f59e0b" },
    ];
    for (let i = 0; i < TURBINE_BLADE_ANGLES.length; i++) {
      const a = (TURBINE_BLADE_ANGLES[i] ?? 0) + rotorAngle;
      const sx = -Math.sin(a);
      const sy = Math.cos(a);
      specs.push({
        id: `blade-${i}`,
        from: [sx * 0.04, hubY + sy * 0.04, hubZ],
        to: [sx * (0.04 + bladeRadialExplode), hubY + sy * (0.04 + bladeRadialExplode), hubZ],
        color: "#38bdf8",
      });
    }
    return specs;
  }, [e, isGhost, hubY, upperShellY, lowerShellY, hubZ, generatorZ, rotorAngle, bladeRadialExplode]);

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
      {/* 1. Bolted Base Flange Ring + Tapered Tubular Steel Tower + Yaw Slewing Collar */}
      <group>
        {/* Bolted base flange ring */}
        <mesh position={[0, 0.018, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.132, 0.144, 0.036, 32]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="anodized-aluminum"
            baseColor="#9aa3ae"
            stressFactor={0.78}
            thermalFactor={0.2}
          />
        </mesh>
        {TURBINE_BASE_BOLT_ANGLES.map((angle, idx) => (
          <mesh key={`base-bolt-${idx}`} position={[Math.cos(angle) * 0.114, 0.042, Math.sin(angle) * 0.114]}>
            <cylinderGeometry args={[0.008, 0.008, 0.018, 6]} />
            <ShowcasePartMaterial {...sharedMat} finish="polished-steel" stressFactor={0.74} thermalFactor={0.18} />
          </mesh>
        ))}

        {/* Tapered tubular steel tower */}
        <mesh position={[0, 0.23, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.042, 0.076, 0.4, 28]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="ceramic-grey"
            baseColor="#e5e9ef"
            stressFactor={0.64}
            thermalFactor={0.24}
          />
        </mesh>

        {/* Service access door detail near base */}
        <mesh position={[0, 0.095, 0.068]} rotation={[-0.08, 0, 0]}>
          <boxGeometry args={[0.034, 0.072, 0.012]} />
          <ShowcasePartMaterial {...sharedMat} finish="dark-anodized" stressFactor={0.62} thermalFactor={0.22} />
        </mesh>

        {/* Yaw slewing ring collar & bearing race */}
        <mesh position={[0, 0.436, 0]} castShadow>
          <cylinderGeometry args={[0.056, 0.052, 0.028, 28]} />
          <ShowcasePartMaterial {...sharedMat} finish="satin-steel" stressFactor={0.82} thermalFactor={0.48} />
        </mesh>
        <mesh position={[0, 0.444, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.056, 0.006, 8, 28]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="painted"
            baseColor={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.32}
            stressFactor={0.76}
            thermalFactor={0.46}
          />
        </mesh>
      </group>

      {/* 2. Nacelle Upper Fiberglass Clam-Shell + Rear Anemometer Mast (lifts on explode) */}
      <group position={[0, upperShellY, -0.032]}>
        <mesh geometry={clamShellGeom} castShadow receiveShadow>
          <ShowcasePartMaterial {...sharedMat} finish="ceramic-white" stressFactor={0.32} thermalFactor={0.42} />
        </mesh>
        {/* Sculpted upper rear fiberglass tail dome closing the clam-shell cleanly */}
        <mesh position={[0, 0, -0.132]} scale={[1.0, 0.94, 0.56]} castShadow>
          <sphereGeometry args={[0.076, 20, 12, Math.PI, Math.PI, 0, Math.PI / 2]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="ceramic-white"
            baseColor="#e8edf3"
            stressFactor={0.28}
            thermalFactor={0.44}
          />
        </mesh>
        {/* Side aerodynamic accent stripes */}
        {[-1, 1].map((side) => (
          <mesh key={`livery-${side}`} position={[side * 0.075, 0.022, 0]}>
            <boxGeometry args={[0.006, 0.014, 0.24]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="painted"
              baseColor={accentColor}
              emissive={accentColor}
              emissiveIntensity={0.25}
              stressFactor={0.26}
              thermalFactor={0.36}
            />
          </mesh>
        ))}

        {/* Glowing Anemometer Mast & Aviation Obstacle Beacon at rear of nacelle */}
        <group position={[0, 0.078, -0.108]}>
          <mesh position={[0, 0.036, 0]} castShadow>
            <cylinderGeometry args={[0.005, 0.007, 0.072, 10]} />
            <ShowcasePartMaterial {...sharedMat} finish="satin-steel" stressFactor={0.3} thermalFactor={0.24} />
          </mesh>
          {/* Crossbar */}
          <mesh position={[0, 0.062, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.0035, 0.0035, 0.064, 8]} />
            <ShowcasePartMaterial {...sharedMat} finish="brushed-aluminum" stressFactor={0.24} thermalFactor={0.22} />
          </mesh>
          {/* Spinning 3-cup anemometer on left tip */}
          <group position={[-0.032, 0.072, 0]} rotation={[0, anemometerSpin, 0]}>
            {TURBINE_PLANET_ANGLES.map((a, idx) => (
              <mesh key={`cup-${idx}`} position={[Math.cos(a) * 0.014, 0, Math.sin(a) * 0.014]}>
                <sphereGeometry args={[0.006, 8, 8]} />
                <ShowcasePartMaterial
                  {...sharedMat}
                  finish="painted"
                  baseColor="#2ca9e6"
                  emissive="#0284c7"
                  emissiveIntensity={0.35}
                  stressFactor={0.22}
                  thermalFactor={0.26}
                />
              </mesh>
            ))}
          </group>
          {/* Glowing aviation warning strobe + wind vane on right tip */}
          {!isGhost && (
            <mesh position={[0.032, 0.074, 0]}>
              <sphereGeometry args={[0.009, 12, 12]} />
              <ClippedGlowMaterial
                color="#ef4444"
                emissive="#f87171"
                emissiveIntensity={1.2 + beaconPulse * 1.6}
                opacity={0.96}
                depthWrite={true}
                clippingPlanes={clippingPlanes}
              />
            </mesh>
          )}
        </group>
      </group>

      {/* 3. Nacelle Lower Fiberglass Clam-Shell (separates downward on explode) */}
      <group position={[0, lowerShellY, -0.032]} rotation={[0, 0, Math.PI]}>
        <mesh geometry={clamShellGeom} castShadow receiveShadow>
          <ShowcasePartMaterial {...sharedMat} finish="ceramic-grey" stressFactor={0.52} thermalFactor={0.44} />
        </mesh>
        <mesh position={[0, 0, -0.132]} scale={[1.0, 0.94, 0.56]} castShadow>
          <sphereGeometry args={[0.076, 20, 12, Math.PI, Math.PI, 0, Math.PI / 2]} />
          <ShowcasePartMaterial {...sharedMat} finish="ceramic-grey" stressFactor={0.48} thermalFactor={0.44} />
        </mesh>
      </group>

      {/* 4. Internal Drivetrain: Main Low-Speed Shaft + Planetary Gearbox + High-Speed Copper Generator */}
      <group position={[0, hubY, 0]}>
        {/* Structural bedplate frame rail */}
        <mesh position={[0, -0.04, -0.032]} castShadow>
          <boxGeometry args={[0.078, 0.018, 0.22]} />
          <ShowcasePartMaterial {...sharedMat} finish="dark-anodized" stressFactor={0.84} thermalFactor={0.52} />
        </mesh>

        {/* Main Low-Speed Shaft + Pillow-Block Bearing */}
        <mesh position={[0, 0, 0.068]} rotation={[Math.PI / 2, 0, rotorAngle]} castShadow>
          <cylinderGeometry args={[0.018, 0.018, 0.115, 16]} />
          <ShowcasePartMaterial {...sharedMat} finish="polished-steel" stressFactor={0.92} thermalFactor={0.62} />
        </mesh>
        <mesh position={[0, 0, 0.065]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.036, 0.036, 0.03, 20]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="satin-steel"
            baseColor="#9aa3ae"
            stressFactor={0.88}
            thermalFactor={0.68}
          />
        </mesh>

        {/* Planetary Gearbox Housing & Multi-Stage Rotating Gears */}
        <group position={[0, 0, gearboxZ]}>
          {/* Open-ribbed planetary ring gear housing */}
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.052, 0.01, 10, 24]} />
            <ShowcasePartMaterial {...sharedMat} finish="satin-steel" stressFactor={0.94} thermalFactor={0.82} />
          </mesh>
          <mesh position={[0, 0, -0.022]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.054, 0.054, 0.024, 24]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="anodized-aluminum"
              baseColor="#8d96a2"
              stressFactor={0.92}
              thermalFactor={0.86}
            />
          </mesh>
          {/* Orbiting Planetary Satellite Gear Carrier (3 gears + sun pinion) */}
          <group position={[0, 0, 0.008]} rotation={[0, 0, rotorAngle]}>
            {TURBINE_PLANET_ANGLES.map((a, idx) => (
              <mesh
                key={`planet-gear-${idx}`}
                position={[Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0]}
                rotation={[Math.PI / 2, -rotorAngle * 3, 0]}
                castShadow
              >
                <cylinderGeometry args={[0.017, 0.017, 0.024, 12]} />
                <ShowcasePartMaterial {...sharedMat} finish="brass" stressFactor={0.96} thermalFactor={0.9} />
              </mesh>
            ))}
            {/* Central high-speed sun pinion */}
            <mesh rotation={[Math.PI / 2, highSpeedSpin, 0]} castShadow>
              <cylinderGeometry args={[0.014, 0.014, 0.038, 12]} />
              <ShowcasePartMaterial {...sharedMat} finish="polished-steel" stressFactor={0.94} thermalFactor={0.88} />
            </mesh>
          </group>
        </group>

        {/* High-Speed Copper-Wound Generator Rotor & Finned Stator */}
        <group position={[0, 0, generatorZ]}>
          {/* High-speed coupling shaft */}
          <mesh position={[0, 0, 0.044]} rotation={[Math.PI / 2, 0, highSpeedSpin]}>
            <cylinderGeometry args={[0.01, 0.01, 0.052, 12]} />
            <ShowcasePartMaterial {...sharedMat} finish="polished-steel" stressFactor={0.78} thermalFactor={0.82} />
          </mesh>
          {/* Spinning copper-wound generator rotor */}
          <group rotation={[0, 0, highSpeedSpin]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.036, 0.036, 0.072, 20]} />
              <ShowcasePartMaterial {...sharedMat} finish="copper" stressFactor={0.74} thermalFactor={0.98} />
            </mesh>
            {/* 6 copper armature slot bars so high-speed rotation reads vividly */}
            {DRONE_ARM_ANGLES.map((a, idx) => (
              <mesh key={`coil-bar-${idx}`} position={[Math.cos(a) * 0.037, Math.sin(a) * 0.037, 0]}>
                <boxGeometry args={[0.008, 0.008, 0.068]} />
                <ShowcasePartMaterial {...sharedMat} finish="brass" stressFactor={0.7} thermalFactor={0.98} />
              </mesh>
            ))}
          </group>
          {/* Outer open stator cooling rings */}
          {[-0.028, 0, 0.028].map((zRing, idx) => (
            <mesh key={`stator-ring-${idx}`} position={[0, 0, zRing]} castShadow>
              <torusGeometry args={[0.048, 0.006, 8, 24]} />
              <ShowcasePartMaterial {...sharedMat} finish="brushed-aluminum" stressFactor={0.56} thermalFactor={0.86} />
            </mesh>
          ))}
        </group>

        {/* 5. Aerodynamic Spinner Nose Cone + 3 Long Pitched Airfoil Rotor Blades */}
        <group position={[0, 0, hubZ]} rotation={[0, 0, rotorAngle]}>
          {/* Ogive fiberglass spinner nose cone */}
          <mesh geometry={spinnerGeom} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <ShowcasePartMaterial {...sharedMat} finish="ceramic-white" stressFactor={0.48} thermalFactor={0.3} />
          </mesh>
          {/* Spinner collar accent ring */}
          <mesh position={[0, 0, 0.008]}>
            <torusGeometry args={[0.056, 0.005, 8, 28]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="painted"
              baseColor={accentColor}
              emissive={accentColor}
              emissiveIntensity={0.3}
              stressFactor={0.52}
              thermalFactor={0.34}
            />
          </mesh>

          {/* 3 Long Pitched Airfoil Rotor Blades (rotating + subtly oscillating pitch) */}
          {TURBINE_BLADE_ANGLES.map((bladeAngle, idx) => {
            const pitchOsc = 0.22 + Math.sin(simulationTime * 1.65 + idx * 0.45) * 0.095;
            return (
              <group key={`turbine-blade-${idx}`} rotation={[0, 0, bladeAngle]}>
                <group position={[0, bladeRadialExplode, 0.018]} rotation={[0, pitchOsc, 0]}>
                  {/* Blade pitch bearing collar */}
                  <mesh position={[0, 0.036, 0]}>
                    <cylinderGeometry args={[0.016, 0.017, 0.018, 14]} />
                    <ShowcasePartMaterial
                      {...sharedMat}
                      finish="satin-steel"
                      stressFactor={0.95}
                      thermalFactor={0.42}
                    />
                  </mesh>
                  {/* Lofted tapered twisted airfoil blade */}
                  <mesh geometry={bladeGeom} castShadow receiveShadow>
                    <ShowcasePartMaterial
                      {...sharedMat}
                      finish="ceramic-white"
                      stressFactor={0.84}
                      thermalFactor={0.3}
                    />
                  </mesh>
                  {/* Aviation safety orange tip band */}
                  <mesh position={[-0.002, 0.248, 0]}>
                    <boxGeometry args={[0.019, 0.038, 0.006]} />
                    <ShowcasePartMaterial
                      {...sharedMat}
                      finish="painted"
                      baseColor="#e04231"
                      stressFactor={0.62}
                      thermalFactor={0.28}
                    />
                  </mesh>
                </group>
              </group>
            );
          })}
        </group>
      </group>

      <ShowcaseLeaderLines lines={leaderLines} explodeFactor={e} isGhost={isGhost} />
    </group>
  );
}

// ── Showcase 3: Orbital Telecommunications Satellite ("satellite") ──────────

const SAT_RADIATOR_ANGLES: readonly number[] = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
const SAT_TRIPOD_ANGLES: readonly number[] = [0, 1, 2].map((i) => (i * Math.PI * 2) / 3);

/** Builds a thick-walled paraboloid high-gain antenna reflector bowl. */
function buildParabolicDishGeometry(): THREE.LatheGeometry {
  const outerPts: THREE.Vector2[] = [];
  const innerPts: THREE.Vector2[] = [];
  const steps = 12;
  const maxR = 0.114;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const r = Math.max(0.002, u * maxR);
    outerPts.push(new THREE.Vector2(r, 0.036 * u * u));
  }
  for (let i = steps; i >= 0; i--) {
    const u = i / steps;
    const r = Math.max(0.002, u * maxR);
    innerPts.push(new THREE.Vector2(r, 0.006 + 0.035 * u * u));
  }
  return new THREE.LatheGeometry([...outerPts, ...innerPts], 28);
}

interface SolarPanelCardProps {
  sharedMat: Omit<
    ShowcasePartMaterialProps,
    "baseColor" | "metalness" | "roughness" | "emissive" | "emissiveIntensity" | "stressFactor" | "thermalFactor"
  >;
  thermalFactor: number;
  stressFactor: number;
}

function SolarPanelCard({ sharedMat, thermalFactor, stressFactor }: SolarPanelCardProps): React.ReactElement {
  return (
    <group>
      {/* Brushed aluminum structural perimeter frame */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.096, 0.158, 0.007]} />
        <ShowcasePartMaterial
          {...sharedMat}
          finish="brushed-aluminum"
          stressFactor={stressFactor}
          thermalFactor={thermalFactor * 0.7}
        />
      </mesh>
      {/* Deep navy monocrystalline photovoltaic silicon cells (front & back face) */}
      <mesh>
        <boxGeometry args={[0.086, 0.146, 0.0086]} />
        <ShowcasePartMaterial
          {...sharedMat}
          finish="solar-cell"
          stressFactor={stressFactor * 0.85}
          thermalFactor={thermalFactor}
        />
      </mesh>
      {/* Silver horizontal cell busbars */}
      {[-0.048, 0, 0.048].map((yBar, idx) => (
        <mesh key={`hbar-${idx}`} position={[0, yBar, 0]}>
          <boxGeometry args={[0.086, 0.003, 0.0096]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="polished-steel"
            stressFactor={0.3}
            thermalFactor={thermalFactor * 0.85}
          />
        </mesh>
      ))}
      {/* Silver vertical collector busbars */}
      {[-0.022, 0.022].map((xBar, idx) => (
        <mesh key={`vbar-${idx}`} position={[xBar, 0, 0]}>
          <boxGeometry args={[0.0028, 0.146, 0.0096]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="polished-steel"
            stressFactor={0.3}
            thermalFactor={thermalFactor * 0.85}
          />
        </mesh>
      ))}
    </group>
  );
}

export function OrbitalSatelliteAssembly({
  explodeFactor,
  caeOverlay,
  renderStyle,
  simulationTime,
  clippingPlanes,
  isGhost,
  ghostOpacity,
  accentColor,
}: ShowcaseAssemblyProps): React.ReactElement {
  const e = clampNumber(explodeFactor, 0, 1);

  const dishGeom = useMemo(() => buildParabolicDishGeometry(), []);
  useEffect(() => () => dishGeom.dispose(), [dishGeom]);

  const centerY = 0.36;
  const attitudeBob = Math.sin(simulationTime * 0.9) * 0.008;
  const sunTrackTilt = 0.16 + Math.sin(simulationTime * 0.55) * 0.14;
  // Accordion fold unfolds cleanly to 0 rad as explodeFactor goes 0 -> 1
  const wingFoldRoot = (1 - e) * 0.68;
  const wingFoldOuter = (1 - e) * 1.36;
  const wingRootOffsetX = 0.128 + e * 0.068;

  const panelExplodeR = e * 0.17;
  const dishY = 0.132 + e * 0.145;
  const thrusterZ = -0.125 - e * 0.095;
  const plumePulse = 0.5 + 0.5 * Math.sin(simulationTime * 9.5);
  const plumeFlicker = 0.5 + 0.5 * Math.sin(simulationTime * 17.3 + 1.1);

  // 3 orthogonal reaction wheel spins
  const rwSpinX = simulationTime * 3.8;
  const rwSpinY = -simulationTime * 3.1;
  const rwSpinZ = simulationTime * 4.5;

  const leaderLines = useMemo<ShowcaseLeaderLineSpec[]>(() => {
    if (e <= 0.04 || isGhost) return [];
    const specs: ShowcaseLeaderLineSpec[] = [
      { id: "dish", from: [0, centerY + 0.132, 0], to: [0, centerY + dishY, 0], color: "#38bdf8" },
      {
        id: "thruster",
        from: [0, centerY - 0.015, -0.125],
        to: [0, centerY - 0.015, thrusterZ],
        color: "#a855f7",
      },
      {
        id: "wing-l",
        from: [-0.128, centerY, 0],
        to: [-wingRootOffsetX, centerY, 0],
        color: "#60a5fa",
      },
      {
        id: "wing-r",
        from: [0.128, centerY, 0],
        to: [wingRootOffsetX, centerY, 0],
        color: "#60a5fa",
      },
    ];
    for (let i = 0; i < SAT_RADIATOR_ANGLES.length; i++) {
      const a = SAT_RADIATOR_ANGLES[i] ?? 0;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      specs.push({
        id: `mli-${i}`,
        from: [cx * 0.105, centerY, cz * 0.105],
        to: [cx * (0.105 + panelExplodeR), centerY, cz * (0.105 + panelExplodeR)],
        color: "#f59e0b",
      });
    }
    return specs;
  }, [e, isGhost, centerY, dishY, thrusterZ, wingRootOffsetX, panelExplodeR]);

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
      {/* Low-profile zero-G orbital metrology ring on plinth floor */}
      <mesh position={[0, 0.012, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.16, 0.007, 8, 36]} />
        <ShowcasePartMaterial
          {...sharedMat}
          finish="anodized-aluminum"
          emissive={accentColor}
          emissiveIntensity={0.2}
          stressFactor={0.18}
          thermalFactor={0.14}
        />
      </mesh>

      <group position={[0, centerY + attitudeBob, 0]}>
        {/* 1. Octagonal Spacecraft Bus End Bulkheads & Corner Longerons */}
        <mesh position={[0, 0.112, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.114, 0.118, 0.016, 8]} />
          <ShowcasePartMaterial {...sharedMat} finish="gold" stressFactor={0.46} thermalFactor={0.62} />
        </mesh>
        <mesh position={[0, -0.112, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.118, 0.114, 0.016, 8]} />
          <ShowcasePartMaterial {...sharedMat} finish="brass" stressFactor={0.5} thermalFactor={0.58} />
        </mesh>
        {/* 4 structural corner posts framing the internal avionics/reaction-wheel bay */}
        {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((a, idx) => (
          <mesh key={`longeron-${idx}`} position={[Math.cos(a) * 0.098, 0, Math.sin(a) * 0.098]}>
            <boxGeometry args={[0.014, 0.212, 0.014]} />
            <ShowcasePartMaterial {...sharedMat} finish="brushed-aluminum" stressFactor={0.66} thermalFactor={0.48} />
          </mesh>
        ))}

        {/* 2. Four Detachable Gold-Foil MLI Radiator Side Panels (explode radially outward!) */}
        {SAT_RADIATOR_ANGLES.map((angle, idx) => {
          const r = 0.106 + panelExplodeR;
          return (
            <group
              key={`mli-panel-${idx}`}
              position={[Math.cos(angle) * r, 0, Math.sin(angle) * r]}
              rotation={[0, -angle + Math.PI / 2, 0]}
            >
              {/* Gold Kapton MLI blanket panel */}
              <mesh castShadow receiveShadow>
                <boxGeometry args={[0.096, 0.205, 0.012]} />
                <ShowcasePartMaterial
                  {...sharedMat}
                  finish="gold"
                  roughness={0.32}
                  stressFactor={0.36}
                  thermalFactor={0.74}
                />
              </mesh>
              {/* Silver Optical Solar Reflector (OSR) radiator window */}
              <mesh position={[0, 0.012, 0.007]}>
                <boxGeometry args={[0.068, 0.088, 0.004]} />
                <ShowcasePartMaterial
                  {...sharedMat}
                  finish="polished-steel"
                  baseColor="#dfe4ea"
                  roughness={0.18}
                  stressFactor={0.28}
                  thermalFactor={0.82}
                />
              </mesh>
              {/* Quilted thermal-foil horizontal retainer ribs */}
              {[-0.068, 0.072].map((yRib, rIdx) => (
                <mesh key={`rib-${rIdx}`} position={[0, yRib, 0.007]}>
                  <boxGeometry args={[0.084, 0.01, 0.004]} />
                  <ShowcasePartMaterial
                    {...sharedMat}
                    finish="copper"
                    baseColor="#d69c6c"
                    stressFactor={0.32}
                    thermalFactor={0.68}
                  />
                </mesh>
              ))}
            </group>
          );
        })}

        {/* 3. Exposed Internal Core: Spherical Titanium Propellant Tank, 3 Orthogonal Reaction Wheels & Avionics Cards */}
        <group>
          {/* Spherical Titanium Xenon Propellant Tank */}
          <mesh position={[0, 0.036, -0.015]} castShadow>
            <sphereGeometry args={[0.048, 20, 16]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="satin-steel"
              baseColor="#c4cad2"
              stressFactor={0.88}
              thermalFactor={0.56}
            />
          </mesh>
          {/* Tank equatorial weld seam */}
          <mesh position={[0, 0.036, -0.015]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.049, 0.003, 8, 24]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="anodized-aluminum"
              baseColor="#8c95a2"
              stressFactor={0.82}
              thermalFactor={0.52}
            />
          </mesh>

          {/* 3 Orthogonal Spinning Reaction Wheels (X, Y, Z axes) */}
          {/* Reaction Wheel X */}
          <group position={[-0.044, -0.046, 0.012]} rotation={[rwSpinX, 0, Math.PI / 2]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.026, 0.006, 8, 20]} />
              <ShowcasePartMaterial
                {...sharedMat}
                finish="anodized-aluminum"
                baseColor="#68b8e8"
                stressFactor={0.76}
                thermalFactor={0.74}
              />
            </mesh>
            <mesh>
              <boxGeometry args={[0.048, 0.005, 0.006]} />
              <ShowcasePartMaterial {...sharedMat} finish="polished-steel" stressFactor={0.7} thermalFactor={0.72} />
            </mesh>
          </group>

          {/* Reaction Wheel Y */}
          <group position={[0.006, -0.072, 0.018]} rotation={[0, rwSpinY, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.026, 0.006, 8, 20]} />
              <ShowcasePartMaterial
                {...sharedMat}
                finish="anodized-aluminum"
                baseColor="#5ec492"
                stressFactor={0.76}
                thermalFactor={0.74}
              />
            </mesh>
            <mesh>
              <boxGeometry args={[0.048, 0.005, 0.006]} />
              <ShowcasePartMaterial {...sharedMat} finish="polished-steel" stressFactor={0.7} thermalFactor={0.72} />
            </mesh>
          </group>

          {/* Reaction Wheel Z */}
          <group position={[0.044, -0.046, 0.012]} rotation={[Math.PI / 2, 0, rwSpinZ]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.026, 0.006, 8, 20]} />
              <ShowcasePartMaterial {...sharedMat} finish="brass" stressFactor={0.76} thermalFactor={0.76} />
            </mesh>
            <mesh>
              <boxGeometry args={[0.048, 0.005, 0.006]} />
              <ShowcasePartMaterial {...sharedMat} finish="polished-steel" stressFactor={0.7} thermalFactor={0.72} />
            </mesh>
          </group>

          {/* Stacked Avionics Flight-Computer Cards */}
          {[-0.022, 0, 0.022].map((yCard, idx) => (
            <group key={`avionics-card-${idx}`} position={[0, yCard - 0.008, 0.055]}>
              <mesh>
                <boxGeometry args={[0.072, 0.008, 0.046]} />
                <ShowcasePartMaterial {...sharedMat} finish="pcb" stressFactor={0.28} thermalFactor={0.9} />
              </mesh>
              <mesh position={[0, 0.005, 0.018]}>
                <boxGeometry args={[0.052, 0.004, 0.008]} />
                <ShowcasePartMaterial {...sharedMat} finish="gold" stressFactor={0.22} thermalFactor={0.86} />
              </mesh>
            </group>
          ))}
        </group>

        {/* 4. Dual 3-Panel Hinged Photovoltaic Solar Array Wings (unfold & extend along ±X) */}
        {([-1, 1] as const).map((side) => (
          <group
            key={`solar-wing-${side}`}
            position={[side * wingRootOffsetX, 0.005, 0]}
            rotation={[sunTrackTilt, 0, 0]}
          >
            {/* Root deployment yoke boom */}
            <mesh position={[-side * 0.016, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.007, 0.008, 0.036, 10]} />
              <ShowcasePartMaterial {...sharedMat} finish="satin-steel" stressFactor={0.84} thermalFactor={0.46} />
            </mesh>
            {/* Hinge 1 -> Panel 1 */}
            <group rotation={[0, side * wingFoldRoot, 0]}>
              <mesh>
                <cylinderGeometry args={[0.006, 0.006, 0.036, 8]} />
                <ShowcasePartMaterial
                  {...sharedMat}
                  finish="brushed-aluminum"
                  stressFactor={0.78}
                  thermalFactor={0.44}
                />
              </mesh>
              <group position={[side * 0.052, 0, 0]}>
                <SolarPanelCard sharedMat={sharedMat} thermalFactor={0.68} stressFactor={0.64} />
              </group>

              {/* Hinge 2 -> Panel 2 */}
              <group position={[side * 0.104, 0, 0]} rotation={[0, -side * wingFoldOuter, 0]}>
                <mesh>
                  <cylinderGeometry args={[0.0055, 0.0055, 0.032, 8]} />
                  <ShowcasePartMaterial
                    {...sharedMat}
                    finish="brushed-aluminum"
                    stressFactor={0.62}
                    thermalFactor={0.42}
                  />
                </mesh>
                <group position={[side * 0.052, 0, 0]}>
                  <SolarPanelCard sharedMat={sharedMat} thermalFactor={0.64} stressFactor={0.5} />
                </group>

                {/* Hinge 3 -> Panel 3 */}
                <group position={[side * 0.104, 0, 0]} rotation={[0, side * wingFoldOuter, 0]}>
                  <mesh>
                    <cylinderGeometry args={[0.005, 0.005, 0.028, 8]} />
                    <ShowcasePartMaterial
                      {...sharedMat}
                      finish="brushed-aluminum"
                      stressFactor={0.44}
                      thermalFactor={0.4}
                    />
                  </mesh>
                  <group position={[side * 0.052, 0, 0]}>
                    <SolarPanelCard sharedMat={sharedMat} thermalFactor={0.6} stressFactor={0.36} />
                  </group>
                </group>
              </group>
            </group>
          </group>
        ))}

        {/* 5. Top High-Gain Parabolic Dish Antenna + Feed Horn Tripod */}
        <group position={[0, dishY, 0.006]} rotation={[0.22, 0, 0]}>
          {/* Antenna gimbal pedestal */}
          <mesh position={[0, -0.012, 0]}>
            <cylinderGeometry args={[0.022, 0.028, 0.026, 16]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="satin-steel"
              baseColor="#8f98a4"
              stressFactor={0.58}
              thermalFactor={0.46}
            />
          </mesh>
          {/* Parabolic dish reflector */}
          <mesh geometry={dishGeom} castShadow receiveShadow>
            <ShowcasePartMaterial {...sharedMat} finish="ceramic-white" stressFactor={0.38} thermalFactor={0.48} />
          </mesh>
          {/* Feed horn tripod struts converging cleanly at focal feed horn */}
          {SAT_TRIPOD_ANGLES.map((a, idx) => (
            <group key={`tripod-${idx}`} rotation={[0, -a, 0]}>
              <mesh position={[0.044, 0.06, 0]} rotation={[0, 0, 1.004]}>
                <cylinderGeometry args={[0.0028, 0.0028, 0.104, 8]} />
                <ShowcasePartMaterial
                  {...sharedMat}
                  finish="brushed-aluminum"
                  stressFactor={0.42}
                  thermalFactor={0.44}
                />
              </mesh>
            </group>
          ))}
          {/* Central Gold/Copper RF Feed Horn at Focal Point */}
          <mesh position={[0, 0.088, 0]} castShadow>
            <cylinderGeometry args={[0.014, 0.01, 0.024, 16]} />
            <ShowcasePartMaterial {...sharedMat} finish="gold" stressFactor={0.34} thermalFactor={0.72} />
          </mesh>
        </group>

        {/* 6. Star Tracker Optical Baffle */}
        <group position={[0.068, 0.132 + e * 0.072, 0.068]} rotation={[0.42, 0.36, -0.35]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.022, 0.012, 0.052, 16]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="dark-anodized"
              baseColor="#535c69"
              stressFactor={0.24}
              thermalFactor={0.36}
            />
          </mesh>
          <mesh position={[0, 0.025, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.022, 0.0025, 8, 20]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="painted"
              baseColor={accentColor}
              emissive={accentColor}
              emissiveIntensity={0.45}
              stressFactor={0.2}
              thermalFactor={0.34}
            />
          </mesh>
        </group>

        {/* 7. Rear Hall-Effect Ion Thruster + Pulsing Cyan/Violet Plasma Plume */}
        <group position={[0, -0.015, thrusterZ]}>
          {/* Magnetic coil thruster body */}
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.042, 0.036, 0.044, 22]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="satin-steel"
              baseColor="#8d96a2"
              stressFactor={0.8}
              thermalFactor={0.98}
            />
          </mesh>
          {/* Ceramic annular acceleration channel */}
          <mesh position={[0, 0, -0.022]}>
            <torusGeometry args={[0.026, 0.007, 10, 24]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="ceramic-white"
              emissive="#38bdf8"
              emissiveIntensity={0.45 + plumePulse * 0.35}
              stressFactor={0.84}
              thermalFactor={0.98}
            />
          </mesh>
          {/* Exterior cathode neutralizer emitter */}
          <mesh position={[0.036, 0.024, -0.024]} rotation={[Math.PI / 2, 0, -0.3]}>
            <cylinderGeometry args={[0.005, 0.006, 0.028, 10]} />
            <ShowcasePartMaterial {...sharedMat} finish="polished-steel" stressFactor={0.52} thermalFactor={0.92} />
          </mesh>

          {/* Pulsing Cyan/Violet Ion Plasma Plume */}
          {!isGhost && (
            <group position={[0, 0, -0.026]}>
              {/* Annular plasma discharge ring */}
              <mesh>
                <torusGeometry args={[0.026, 0.005, 8, 24]} />
                <ClippedGlowMaterial
                  color="#67e8f9"
                  emissive="#22d3ee"
                  emissiveIntensity={1.9 + plumePulse * 0.9}
                  opacity={0.92}
                  clippingPlanes={clippingPlanes}
                />
              </mesh>
              {/* Inner cyan high-velocity plasma core */}
              <mesh
                position={[0, 0, -0.068 - plumePulse * 0.014]}
                rotation={[-Math.PI / 2, 0, 0]}
                scale={[1 + plumeFlicker * 0.08, 1 + plumePulse * 0.14, 1 + plumeFlicker * 0.08]}
              >
                <coneGeometry args={[0.024, 0.132, 18, 1, true]} />
                <ClippedGlowMaterial
                  color="#67e8f9"
                  emissive="#06b6d4"
                  emissiveIntensity={1.65 + plumePulse * 0.75}
                  opacity={0.62 + plumeFlicker * 0.18}
                  side={THREE.DoubleSide}
                  clippingPlanes={clippingPlanes}
                />
              </mesh>
              {/* Outer violet ionized exhaust halo */}
              <mesh
                position={[0, 0, -0.095 - plumePulse * 0.02]}
                rotation={[-Math.PI / 2, 0, 0]}
                scale={[1 + plumePulse * 0.12, 1 + plumeFlicker * 0.18, 1 + plumePulse * 0.12]}
              >
                <coneGeometry args={[0.044, 0.188, 18, 1, true]} />
                <ClippedGlowMaterial
                  color="#a855f7"
                  emissive="#8b5cf6"
                  emissiveIntensity={1.35 + plumeFlicker * 0.7}
                  opacity={0.34 + plumePulse * 0.16}
                  side={THREE.DoubleSide}
                  clippingPlanes={clippingPlanes}
                />
              </mesh>
            </group>
          )}
        </group>
      </group>

      <ShowcaseLeaderLines lines={leaderLines} explodeFactor={e} isGhost={isGhost} />
    </group>
  );
}

// ── Showcase 4: EV High-Voltage Structural Battery Pack ("ev-battery") ──────

interface BatteryModuleSpec {
  id: string;
  col: number; // -1 or +1
  row: number; // -1 (rear), 0 (center core), +1 (front)
  thermalFactor: number;
  stressFactor: number;
}

const BATTERY_MODULES: readonly BatteryModuleSpec[] = [
  // Rear row (warm outlet side)
  { id: "m-rl", col: -1, row: -1, thermalFactor: 0.7, stressFactor: 0.56 },
  { id: "m-rr", col: 1, row: -1, thermalFactor: 0.74, stressFactor: 0.56 },
  // Center core row (peak thermal hotspot!)
  { id: "m-cl", col: -1, row: 0, thermalFactor: 0.96, stressFactor: 0.68 },
  { id: "m-cr", col: 1, row: 0, thermalFactor: 0.94, stressFactor: 0.68 },
  // Front row (cool inlet / BMS side)
  { id: "m-fl", col: -1, row: 1, thermalFactor: 0.42, stressFactor: 0.52 },
  { id: "m-fr", col: 1, row: 1, thermalFactor: 0.46, stressFactor: 0.52 },
];

const FLANGE_BOLT_POSITIONS: ReadonlyArray<[number, number]> = [
  [-0.252, -0.28],
  [-0.252, -0.14],
  [-0.252, 0.0],
  [-0.252, 0.14],
  [-0.252, 0.28],
  [0.252, -0.28],
  [0.252, -0.14],
  [0.252, 0.0],
  [0.252, 0.14],
  [0.252, 0.28],
  [-0.14, -0.312],
  [0.0, -0.312],
  [0.14, -0.312],
  [-0.14, 0.312],
  [0.0, 0.312],
  [0.14, 0.312],
];

/** Builds a smooth serpentine liquid-cooling channel geometry on one half of the cold plate. */
function buildSerpentineCoolingTube(side: -1 | 1): THREE.TubeGeometry {
  const s = side;
  const pts = [
    new THREE.Vector3(s * 0.165, 0.011, -0.255),
    new THREE.Vector3(s * 0.165, 0.011, 0.175),
    new THREE.Vector3(s * 0.132, 0.011, 0.205),
    new THREE.Vector3(s * 0.098, 0.011, 0.175),
    new THREE.Vector3(s * 0.098, 0.011, -0.175),
    new THREE.Vector3(s * 0.065, 0.011, -0.205),
    new THREE.Vector3(s * 0.032, 0.011, -0.175),
    new THREE.Vector3(s * 0.032, 0.011, 0.175),
    new THREE.Vector3(0, 0.011, 0.205),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.35);
  return new THREE.TubeGeometry(curve, 52, 0.0075, 8, false);
}

export function EvBatteryPackAssembly({
  explodeFactor,
  caeOverlay,
  renderStyle,
  simulationTime,
  clippingPlanes,
  isGhost,
  ghostOpacity,
  accentColor,
}: ShowcaseAssemblyProps): React.ReactElement {
  const e = clampNumber(explodeFactor, 0, 1);

  const coldLoopGeom = useMemo(() => buildSerpentineCoolingTube(-1), []);
  const warmLoopGeom = useMemo(() => buildSerpentineCoolingTube(1), []);
  useEffect(
    () => () => {
      coldLoopGeom.dispose();
      warmLoopGeom.dispose();
    },
    [coldLoopGeom, warmLoopGeom],
  );

  const trayY = 0.038;
  const coldPlateY = 0.062 + e * 0.055;
  const busbarY = 0.156 + e * 0.265;
  const lidY = 0.168 + e * 0.355;
  const bmsZ = 0.258 + e * 0.11;
  const bmsY = 0.106 + e * 0.085;

  const hvPulse = 0.5 + 0.5 * Math.sin(simulationTime * 3.4);
  const flowPhase = (simulationTime * 0.55) % 1;

  const leaderLines = useMemo<ShowcaseLeaderLineSpec[]>(() => {
    if (e <= 0.04 || isGhost) return [];
    const specs: ShowcaseLeaderLineSpec[] = [
      // 4 corner tray-to-lid vertical leader lines
      { id: "lid-fl", from: [-0.24, 0.168, 0.29], to: [-0.24, lidY, 0.29], color: "#38bdf8" },
      { id: "lid-fr", from: [0.24, 0.168, 0.29], to: [0.24, lidY, 0.29], color: "#38bdf8" },
      { id: "lid-rl", from: [-0.24, 0.168, -0.29], to: [-0.24, lidY, -0.29], color: "#38bdf8" },
      { id: "lid-rr", from: [0.24, 0.168, -0.29], to: [0.24, lidY, -0.29], color: "#38bdf8" },
      { id: "bms", from: [0, 0.106, 0.258], to: [0, bmsY, bmsZ], color: "#fb923c" },
    ];
    for (const mod of BATTERY_MODULES) {
      const bx = mod.col * 0.106;
      const bz = mod.row * 0.152 - 0.025;
      const mx = bx + mod.col * e * 0.082;
      const mz = bz + mod.row * e * 0.075;
      const my = 0.112 + e * (0.175 + (mod.row === 0 ? 0.042 : 0));
      specs.push({
        id: `mod-${mod.id}`,
        from: [bx, 0.112, bz],
        to: [mx, my, mz],
        color: "#f97316",
      });
    }
    return specs;
  }, [e, isGhost, lidY, bmsY, bmsZ]);

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
      {/* 1. Ribbed Cast-Aluminum Crash-Rail Structural Tray + Perimeter Flange Bolts */}
      <group position={[0, trayY, 0]}>
        {/* 4 corner rubber vibration isolator mounts resting on plinth */}
        {(
          [
            [-0.22, -0.27],
            [0.22, -0.27],
            [-0.22, 0.27],
            [0.22, 0.27],
          ] as const
        ).map(([ix, iz], idx) => (
          <mesh key={`iso-${idx}`} position={[ix, -0.026, iz]}>
            <cylinderGeometry args={[0.024, 0.028, 0.024, 14]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="rubber"
              roughness={0.86}
              stressFactor={0.42}
              thermalFactor={0.14}
            />
          </mesh>
        ))}

        {/* Cast-aluminum lower structural floor pan */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.51, 0.022, 0.63]} />
          <ShowcasePartMaterial {...sharedMat} finish="cast-aluminum" stressFactor={0.62} thermalFactor={0.22} />
        </mesh>

        {/* Left & Right extruded aluminum side crash rails with external ribs */}
        {([-1, 1] as const).map((side) => (
          <group key={`rail-${side}`} position={[side * 0.246, 0.056, 0]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.044, 0.112, 0.65]} />
              <ShowcasePartMaterial {...sharedMat} finish="anodized-aluminum" stressFactor={0.84} thermalFactor={0.2} />
            </mesh>
            {/* External crash-absorption stiffening ribs */}
            {[-0.22, -0.075, 0.075, 0.22].map((zRib, rIdx) => (
              <mesh key={`c-rib-${rIdx}`} position={[side * 0.024, 0, zRib]} castShadow>
                <boxGeometry args={[0.012, 0.092, 0.022]} />
                <ShowcasePartMaterial
                  {...sharedMat}
                  finish="brushed-aluminum"
                  stressFactor={0.88}
                  thermalFactor={0.18}
                />
              </mesh>
            ))}
          </group>
        ))}

        {/* Front & Rear perimeter structural crossbeams */}
        {[-0.312, 0.312].map((zEnd, idx) => (
          <mesh key={`end-beam-${idx}`} position={[0, 0.056, zEnd]} castShadow receiveShadow>
            <boxGeometry args={[0.534, 0.112, 0.036]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="cast-aluminum"
              baseColor="#b8bec6"
              stressFactor={0.74}
              thermalFactor={0.22}
            />
          </mesh>
        ))}

        {/* Internal longitudinal center crash spine */}
        <mesh position={[0, 0.048, -0.03]}>
          <boxGeometry args={[0.016, 0.078, 0.49]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="satin-steel"
            baseColor="#9aa3ae"
            stressFactor={0.78}
            thermalFactor={0.44}
          />
        </mesh>

        {/* 16 Perimeter Flange Bolts along top rail */}
        {FLANGE_BOLT_POSITIONS.map(([bx, bz], idx) => (
          <mesh key={`flange-bolt-${idx}`} position={[bx, 0.118, bz]}>
            <cylinderGeometry args={[0.008, 0.008, 0.014, 6]} />
            <ShowcasePartMaterial {...sharedMat} finish="polished-steel" stressFactor={0.6} thermalFactor={0.18} />
          </mesh>
        ))}
      </group>

      {/* 2. Serpentine Aluminum Liquid-Cooling Cold Plate + Dual Cyan/Coral-Red Manifolds */}
      <group position={[0, coldPlateY, -0.025]}>
        {/* Aluminum thermal transfer cold plate */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.425, 0.012, 0.48]} />
          <ShowcasePartMaterial {...sharedMat} finish="brushed-aluminum" stressFactor={0.42} thermalFactor={0.4} />
        </mesh>
        {/* Cold inlet serpentine cooling loop (cyan) */}
        <mesh geometry={coldLoopGeom}>
          <ShowcasePartMaterial
            {...sharedMat}
            finish="painted"
            baseColor="#0ea5c6"
            emissive="#0891b2"
            emissiveIntensity={0.24}
            stressFactor={0.34}
            thermalFactor={0.12}
          />
        </mesh>
        {/* Warm return serpentine cooling loop (coral-red) */}
        <mesh geometry={warmLoopGeom}>
          <ShowcasePartMaterial
            {...sharedMat}
            finish="painted"
            baseColor="#e54865"
            emissive="#be123c"
            emissiveIntensity={0.24}
            stressFactor={0.34}
            thermalFactor={0.78}
          />
        </mesh>

        {/* Dual Rear Coolant Inlet (Cyan) & Outlet (Coral-Red) Manifold Pipes & Fittings */}
        <group position={[-0.165, 0.011, -0.298]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.012, 0.012, 0.1, 14]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="painted"
              baseColor="#0ea5c6"
              emissive="#0891b2"
              emissiveIntensity={0.28}
              stressFactor={0.36}
              thermalFactor={0.1}
            />
          </mesh>
          <mesh position={[0, 0, -0.048]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.017, 0.017, 0.018, 12]} />
            <ShowcasePartMaterial {...sharedMat} finish="polished-steel" stressFactor={0.42} thermalFactor={0.14} />
          </mesh>
          {!isGhost && (
            <mesh position={[0, 0, -0.042 + flowPhase * 0.084]}>
              <sphereGeometry args={[0.014, 10, 10]} />
              <ClippedGlowMaterial
                color="#67e8f9"
                emissive="#22d3ee"
                emissiveIntensity={1.6}
                opacity={0.72}
                clippingPlanes={clippingPlanes}
              />
            </mesh>
          )}
        </group>

        <group position={[0.165, 0.011, -0.298]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.012, 0.012, 0.1, 14]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="painted"
              baseColor="#e54865"
              emissive="#be123c"
              emissiveIntensity={0.28}
              stressFactor={0.36}
              thermalFactor={0.82}
            />
          </mesh>
          <mesh position={[0, 0, -0.048]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.017, 0.017, 0.018, 12]} />
            <ShowcasePartMaterial {...sharedMat} finish="polished-steel" stressFactor={0.42} thermalFactor={0.72} />
          </mesh>
          {!isGhost && (
            <mesh position={[0, 0, 0.042 - flowPhase * 0.084]}>
              <sphereGeometry args={[0.014, 10, 10]} />
              <ClippedGlowMaterial
                color="#fda4af"
                emissive="#f43f5e"
                emissiveIntensity={1.6}
                opacity={0.72}
                clippingPlanes={clippingPlanes}
              />
            </mesh>
          )}
        </group>
      </group>

      {/* 3. Six Prismatic Battery Cell Modules (2x3) — fan upward & radially outward on explode */}
      {BATTERY_MODULES.map((mod) => {
        const bx = mod.col * 0.106;
        const bz = mod.row * 0.152 - 0.025;
        const mx = bx + mod.col * e * 0.082;
        const mz = bz + mod.row * e * 0.075;
        const my = 0.112 + e * (0.175 + (mod.row === 0 ? 0.042 : 0));

        return (
          <group key={mod.id} position={[mx, my, mz]}>
            {/* Aluminum structural module frame */}
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.184, 0.068, 0.132]} />
              <ShowcasePartMaterial
                {...sharedMat}
                finish="anodized-aluminum"
                baseColor="#9ca4b0"
                stressFactor={mod.stressFactor}
                thermalFactor={mod.thermalFactor}
              />
            </mesh>
            {/* 4 visible prismatic Li-ion cell tops with subtle thermal core gradient */}
            {[-0.042, -0.014, 0.014, 0.042].map((zCell, cIdx) => {
              const isInnerCell = cIdx === 1 || cIdx === 2;
              const cellThermal = clampNumber(mod.thermalFactor + (isInnerCell ? 0.04 : -0.05), 0, 1);
              return (
                <mesh key={`cell-${cIdx}`} position={[0, 0.036, zCell]}>
                  <boxGeometry args={[0.168, 0.008, 0.023]} />
                  <ShowcasePartMaterial
                    {...sharedMat}
                    finish="anodized-aluminum"
                    baseColor="#4a7eb0"
                    stressFactor={mod.stressFactor * 0.9}
                    thermalFactor={cellThermal}
                  />
                </mesh>
              );
            })}
            {/* Anode (silver/aluminum) & Cathode (copper) module terminals */}
            <mesh position={[-0.068, 0.044, 0]}>
              <boxGeometry args={[0.018, 0.012, 0.088]} />
              <ShowcasePartMaterial
                {...sharedMat}
                finish="brushed-aluminum"
                stressFactor={0.44}
                thermalFactor={clampNumber(mod.thermalFactor * 0.92, 0, 1)}
              />
            </mesh>
            <mesh position={[0.068, 0.044, 0]}>
              <boxGeometry args={[0.018, 0.012, 0.088]} />
              <ShowcasePartMaterial
                {...sharedMat}
                finish="copper"
                stressFactor={0.44}
                thermalFactor={clampNumber(mod.thermalFactor * 0.98, 0, 1)}
              />
            </mesh>
            {/* High-voltage orange insulated copper busbar bridge */}
            <mesh position={[0, 0.046, 0]}>
              <boxGeometry args={[0.12, 0.007, 0.018]} />
              <ShowcasePartMaterial
                {...sharedMat}
                finish="painted"
                baseColor="#ee6b1c"
                emissive="#c2410c"
                emissiveIntensity={0.28 + hvPulse * 0.22}
                stressFactor={0.38}
                thermalFactor={clampNumber(mod.thermalFactor + 0.03, 0, 1)}
              />
            </mesh>
          </group>
        );
      })}

      {/* 4. Floating HV Orange Interconnect Busbar Spine (lifts above modules on explode) */}
      <group position={[0, busbarY, -0.025]}>
        {[-0.024, 0.024].map((xBar, idx) => (
          <mesh key={`hv-rail-${idx}`} position={[xBar, 0, 0.025]}>
            <boxGeometry args={[0.012, 0.008, 0.48]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="painted"
              baseColor="#ee6b1c"
              emissive="#c2410c"
              emissiveIntensity={0.32 + hvPulse * 0.24}
              stressFactor={0.35}
              thermalFactor={0.86}
            />
          </mesh>
        ))}
      </group>

      {/* 5. Front BMS Power Electronics Module & Orange HV Pyro-Fuse Connector */}
      <group position={[0, bmsY, bmsZ]}>
        {/* BMS controller enclosure */}
        <mesh position={[-0.042, 0, 0]} castShadow>
          <boxGeometry args={[0.205, 0.048, 0.068]} />
          <ShowcasePartMaterial {...sharedMat} finish="dark-anodized" stressFactor={0.36} thermalFactor={0.76} />
        </mesh>
        {/* BMS heatsink fins */}
        {[-0.095, -0.06, -0.025, 0.01].map((xFin, idx) => (
          <mesh key={`bms-fin-${idx}`} position={[xFin, 0.026, 0]}>
            <boxGeometry args={[0.01, 0.008, 0.062]} />
            <ShowcasePartMaterial {...sharedMat} finish="brushed-aluminum" stressFactor={0.32} thermalFactor={0.72} />
          </mesh>
        ))}
        {/* BMS telemetry status LED */}
        {!isGhost && (
          <mesh position={[-0.115, 0.006, 0.036]}>
            <sphereGeometry args={[0.0065, 10, 10]} />
            <ClippedGlowMaterial
              color="#10b981"
              emissive="#34d399"
              emissiveIntensity={1.4 + hvPulse * 1.1}
              opacity={0.96}
              depthWrite={true}
              clippingPlanes={clippingPlanes}
            />
          </mesh>
        )}

        {/* High-Voltage Orange Pyro-Fuse & Manual Service Disconnect Connector */}
        <group position={[0.118, 0.002, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.082, 0.044, 0.064]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="painted"
              baseColor="#ee6b1c"
              emissive="#c2410c"
              emissiveIntensity={0.22 + hvPulse * 0.16}
              stressFactor={0.4}
              thermalFactor={0.82}
            />
          </mesh>
          {/* Cylindrical HV pyro-disconnect cartridge */}
          <mesh position={[0, 0.026, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.014, 0.014, 0.056, 14]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="painted"
              baseColor="#f27d2e"
              emissive="#c2410c"
              emissiveIntensity={0.26}
              stressFactor={0.36}
              thermalFactor={0.84}
            />
          </mesh>
          {/* Twin armored HV output terminals protruding forward */}
          {[-0.018, 0.018].map((xPlug, idx) => (
            <mesh key={`hv-plug-${idx}`} position={[xPlug, -0.004, 0.042]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.01, 0.01, 0.026, 12]} />
              <ShowcasePartMaterial
                {...sharedMat}
                finish="painted"
                baseColor="#ee6b1c"
                emissive="#9a3412"
                emissiveIntensity={0.2}
                stressFactor={0.34}
                thermalFactor={0.78}
              />
            </mesh>
          ))}
        </group>
      </group>

      {/* 6. Top Protective Composite Cover Lid (lifts upward cleanly on explode) */}
      <group position={[0, lidY, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.532, 0.016, 0.652]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="carbon-fiber"
            baseColor="#49525f"
            stressFactor={0.38}
            thermalFactor={0.34}
          />
        </mesh>
        {/* Embossed structural transverse stiffening ribs on top lid */}
        {[-0.18, 0.0, 0.18].map((zRib, idx) => (
          <mesh key={`lid-rib-${idx}`} position={[0, 0.011, zRib]} castShadow>
            <boxGeometry args={[0.46, 0.008, 0.026]} />
            <ShowcasePartMaterial
              {...sharedMat}
              finish="anodized-aluminum"
              baseColor="#7e8794"
              stressFactor={0.42}
              thermalFactor={0.36}
            />
          </mesh>
        ))}
        {/* High-voltage caution accent band & perimeter trim */}
        <mesh position={[0, 0.01, 0.275]}>
          <boxGeometry args={[0.38, 0.006, 0.022]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="painted"
            baseColor="#ee6b1c"
            emissive="#c2410c"
            emissiveIntensity={0.22}
            stressFactor={0.28}
            thermalFactor={0.38}
          />
        </mesh>
        <mesh position={[0, -0.009, 0]}>
          <boxGeometry args={[0.52, 0.005, 0.64]} />
          <ShowcasePartMaterial
            {...sharedMat}
            finish="painted"
            baseColor={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.24}
            stressFactor={0.26}
            thermalFactor={0.28}
          />
        </mesh>
      </group>

      <ShowcaseLeaderLines lines={leaderLines} explodeFactor={e} isGhost={isGhost} />
    </group>
  );
}
