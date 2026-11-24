// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pelagos OC-8 — Subsea 8-Arm Robotic Octopus Flagship Showcase Assembly.
 *
 * Validates all Studio CAD + VR Rotunda capabilities end-to-end in <= 18 draw calls:
 *  - 8 independently articulated arms: 202 GPU-instanced segments + 489 GPU-instanced wheels
 *    (updated zero-alloc via `composeTransformMatrixDirect` inside `useFrame`)
 *  - Internal 7-piston axial swashplate pump solved live via `solveSwashplatePumpKinematics`
 *  - Siphon water-jet propulsion (`2.68 m/s`, `6 N` burst thrust) with single-draw-call `JetPlumeRenderer`
 *  - Autonomous Arm 3 detach (`t = 6..12s`) and smooth reconnect (`t = 12..13s`)
 *  - 6 numbered subsystems supporting Solo Isolation, Ghost-Mantle internal inspection,
 *    hierarchical explode, and dual-mode (`"dom" | "sprite"`) 3D Callout Labels
 */

import {
  composeTransformMatrixDirect,
  quaternionFromAxisAngle,
  quaternionMultiply,
  solveSwashplatePumpKinematics,
  type Quat,
  type SimulatorHudSpec,
  type TelemetryChannelProvider,
} from "@modelscript/cad";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  createDefaultAssemblyVisibility,
  resolvePartPresentation,
  type AssemblyVisibilityState,
  type SubsystemSummary,
} from "../cad-viewer/assembly-visibility.js";
import { CalloutLabels3D, type CalloutPin3D } from "../cad-viewer/CalloutLabels3D.js";
import { getCachedHeroPbrTextures } from "../cad-viewer/HeroCadMaterials.js";
import { JetPlumeRenderer } from "../cad-viewer/JetPlumeRenderer.js";
import type { RotundaCaeOverlay, RotundaRenderStyle } from "./types.js";

// ── Exact Mechanical Spec Constants ──────────────────────────────────────────

export const OCTOPUS_ARM_SEGMENT_COUNTS: readonly number[] = [26, 25, 25, 25, 26, 25, 25, 25] as const;
export const OCTOPUS_TOTAL_SEGMENTS = 202; // 2*26 + 6*25 = 202
export const OCTOPUS_ARM_DORSAL_WHEEL_COUNTS: readonly number[] = [11, 11, 11, 11, 11, 10, 10, 10] as const;
export const OCTOPUS_TOTAL_WHEELS = 489; // 202*2 ventral rollers (404) + 85 dorsal traction rollers = 489
export const OCTOPUS_PISTON_COUNT = 7;
export const OCTOPUS_MISSION_DURATION_SEC = 25;

export const OCTOPUS_SUBSYSTEMS: readonly SubsystemSummary[] = [
  {
    id: "optic",
    code: "01",
    label: "OPTIC ARRAY",
    subtitle: "2 × 4K STEREO OPTICS",
    accentColor: "#f97316",
    partCount: 6,
    explodeAxis: [0, 0.25, 1],
    calloutAnchor: [0, 0.06, 0.14],
  },
  {
    id: "mantle",
    code: "02",
    label: "MANTLE SHELL",
    subtitle: "CERAMIC PRESSURE HULL",
    accentColor: "#cbd5e1",
    partCount: 4,
    explodeAxis: [0, 1, 0],
    defaultGhostable: true,
    calloutAnchor: [0, 0.21, 0],
  },
  {
    id: "pump-core",
    code: "03",
    label: "PUMP CORE",
    subtitle: "7-PISTON SWASHPLATE",
    accentColor: "#10b981",
    partCount: 10,
    explodeAxis: [0, 0.4, -0.3],
    calloutAnchor: [0, 0.07, 0],
  },
  {
    id: "arm-chains",
    code: "04",
    label: "ARM CHAINS",
    subtitle: "202 LINKS · 489 WHEELS",
    accentColor: "#38bdf8",
    partCount: OCTOPUS_TOTAL_SEGMENTS + OCTOPUS_TOTAL_WHEELS,
    explodeAxis: [1, -0.2, 0],
    calloutAnchor: [0.34, -0.02, 0.16],
  },
  {
    id: "siphon",
    code: "05",
    label: "SIPHON JET",
    subtitle: "2.68 m/s VECTORED NOZZLE",
    accentColor: "#06b6d4",
    partCount: 3,
    explodeAxis: [0, -0.1, -1],
    calloutAnchor: [0, 0.02, -0.17],
  },
  {
    id: "beak",
    code: "06",
    label: "BEAK GRIPPER",
    subtitle: "TWIN VENTRAL JAWS",
    accentColor: "#a855f7",
    partCount: 3,
    explodeAxis: [0, -1, 0],
    calloutAnchor: [0, -0.09, 0.02],
  },
] as const;

export const OCTOPUS_CALLOUT_PINS: readonly CalloutPin3D[] = [
  {
    id: "pin-optic",
    code: "01",
    label: "OPTIC ARRAY",
    detail: "STEREO SAPPHIRE LENS",
    anchor: [0.065, 0.055, 0.125],
    labelOffset: [0.11, 0.08, 0.11],
    accentColor: "#f97316",
    subsystemId: "optic",
  },
  {
    id: "pin-mantle",
    code: "02",
    label: "MANTLE SHELL",
    detail: "GHOST FOR PUMP CORE",
    anchor: [0, 0.21, 0],
    labelOffset: [-0.14, 0.11, 0.04],
    accentColor: "#94a3b8",
    subsystemId: "mantle",
  },
  {
    id: "pin-pump",
    code: "03",
    label: "7-PISTON PUMP",
    detail: "CLOSED-LOOP SWASHPLATE",
    anchor: [0.02, 0.08, 0],
    labelOffset: [0.16, 0.13, -0.06],
    accentColor: "#10b981",
    subsystemId: "pump-core",
  },
  {
    id: "pin-arms",
    code: "04",
    label: "8 ARM CHAINS",
    detail: "202 LINKS · 489 WHEELS",
    anchor: [0.33, -0.02, 0.14],
    labelOffset: [0.12, 0.08, 0.08],
    accentColor: "#38bdf8",
    subsystemId: "arm-chains",
  },
  {
    id: "pin-siphon",
    code: "05",
    label: "SIPHON THRUSTER",
    detail: "2.68 m/s · 6.0 N BURST",
    anchor: [0, 0.015, -0.17],
    labelOffset: [-0.15, 0.06, -0.14],
    accentColor: "#06b6d4",
    subsystemId: "siphon",
  },
  {
    id: "pin-beak",
    code: "06",
    label: "BEAK GRIPPER",
    detail: "TWIN VENTRAL JAWS",
    anchor: [0, -0.085, 0.01],
    labelOffset: [-0.15, -0.08, 0.09],
    accentColor: "#a855f7",
    subsystemId: "beak",
  },
] as const;

export const OCTOPUS_HUD_SPEC: SimulatorHudSpec = {
  modelCode: "Pelagos OC-8",
  modelSubtitle: "EIGHT-ARM SUBSEA DRONE · FIELD SIMULATOR",
  simId: "OC8-0731",
  durationSec: OCTOPUS_MISSION_DURATION_SEC,
  loadGauge: {
    label: "JET LOAD",
    channel: "jet.load",
    ticks: ["IDLE", "CRUISE", "BURST"],
  },
  statusChannel: "jet.modeCode",
  statusRules: [
    { minValue: 0, label: "DIVE", color: "#38bdf8" },
    { minValue: 1, label: "ARM DETACH", color: "#a855f7" },
    { minValue: 2, label: "JETTING", color: "#f97316" },
    { minValue: 3, label: "SURFACE", color: "#22c55e" },
  ],
  leftWidgets: [
    {
      kind: "sparkline",
      id: "thrust",
      code: "01",
      label: "THRUST",
      unit: "N",
      channel: "jet.thrust",
      min: 0,
      max: 7.5,
      accentColor: "#f97316",
      statusIdleLabel: "SIPHON IDLE",
      statusActiveLabel: "JET ASSIST 2.68 m/s",
      activeThreshold: 2.2,
      windowSec: 8,
      sampleCount: 28,
    },
    {
      kind: "segmented-bar",
      id: "motor-temp",
      code: "02",
      label: "PUMP CORE",
      unit: "°C",
      channel: "pump.tempC",
      min: 12,
      max: 58,
      segments: 10,
      accentColor: "#10b981",
      warnThreshold: 44,
    },
    {
      kind: "bar-array",
      id: "arm-curling",
      code: "03",
      label: "ARM ACTUATION",
      badge: "CURLING",
      accentColor: "#f97316",
      min: 0,
      max: 100,
      channels: Array.from({ length: 8 }, (_, idx) => ({
        id: `arm-${idx + 1}`,
        label: `A${idx + 1}`,
        channel: `arm.${idx}.curl`,
        attachedChannel: `arm.${idx}.attached`,
      })),
    },
  ],
  rightWidgets: [
    {
      kind: "horizon",
      id: "depth-horizon",
      code: "04",
      label: "DEPTH",
      depthChannel: "nav.depthM",
      pitchChannel: "nav.pitchDeg",
      rollChannel: "nav.rollDeg",
      holdChannel: "nav.depthHold",
      depthUnit: "m",
    },
  ],
  missionPhases: [
    { id: "dive", label: "DIVE", startTime: 0, endTime: 6, color: "#38bdf8" },
    { id: "detach", label: "ARM 3 DETACH · SAMPLE", startTime: 6, endTime: 13, color: "#a855f7" },
    { id: "jet-assist", label: "INBOUND · JET ASSIST", startTime: 13, endTime: 20, color: "#f97316" },
    { id: "surface", label: "SURFACE", startTime: 20, endTime: 25, color: "#22c55e" },
  ],
  operationLog: [
    { id: "op-1", time: 0.4, code: "DIVE", label: "Ballast flood & dive profile init", category: "operator" },
    { id: "op-2", time: 3.2, code: "PUMP", label: "7-piston swashplate prime (450 RPM)", category: "autonomy" },
    { id: "op-3", time: 6.2, code: "UNLOCK", label: "Arm 3 magnetic collar release", category: "operator" },
    { id: "op-4", time: 8.5, code: "SAMPLE", label: "Detached Arm 3 seabed specimen sweep", category: "autonomy" },
    { id: "op-5", time: 12.1, code: "DOCK", label: "Arm 3 auto-align & inductive reconnect", category: "autonomy" },
    { id: "op-6", time: 13.5, code: "BURST", label: "Siphon burst 2.68 m/s (6.0 N thrust)", category: "operator" },
    { id: "op-7", time: 17.8, code: "TRIM", label: "Hydrodynamic arm tuck trim", category: "autonomy" },
    { id: "op-8", time: 21.0, code: "SURF", label: "Siphon idle & recovery flare", category: "operator" },
  ],
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Evaluates Arm 3's normalized detachment factor (`0` = docked to mantle, `1` = fully free-floating).
 * Smoothly detaches over `t = 6.0..7.2s`, hovers/samples `7.2..11.6s`, and reconnects `11.6..12.8s`.
 */
export function evaluateOctopusArm3DetachFactor(timeSec: number): number {
  const t = ((timeSec % OCTOPUS_MISSION_DURATION_SEC) + OCTOPUS_MISSION_DURATION_SEC) % OCTOPUS_MISSION_DURATION_SEC;
  if (t < 6.0 || t > 12.8) return 0;
  const outRamp = smoothstep(6.0, 7.2, t);
  const inRamp = 1 - smoothstep(11.6, 12.8, t);
  return Math.min(outRamp, inRamp);
}

/**
 * Analytical deterministic channel provider for the Pelagos OC-8 showcase across `t ∈ [0, 25]s`.
 * Works standalone or as fallback behind a real Modelica/FMI `AnimationController`.
 */
export const sampleOctopusTelemetryChannel: TelemetryChannelProvider = (
  channel: string,
  timeSec: number,
): number | null => {
  const t = ((timeSec % OCTOPUS_MISSION_DURATION_SEC) + OCTOPUS_MISSION_DURATION_SEC) % OCTOPUS_MISSION_DURATION_SEC;

  const jetRampUp = smoothstep(13.0, 14.3, t);
  const jetRampDown = 1 - smoothstep(19.0, 20.5, t);
  const burstPulse = jetRampUp * jetRampDown;
  const cruisePulse = smoothstep(1.2, 3.0, t) * (1 - smoothstep(20.5, 22.0, t)) * 0.18;
  const thrustNorm = Math.min(1, cruisePulse + burstPulse * (0.86 + 0.14 * Math.sin(t * 6.0)));

  if (channel === "jet.thrust") return 6.2 * thrustNorm;
  if (channel === "jet.velocity") return 2.68 * Math.sqrt(Math.max(0, thrustNorm));
  if (channel === "jet.load") return Math.round(13 + 82 * burstPulse + 6 * Math.sin(t * 2.5));
  if (channel === "jet.modeCode") {
    if (t < 6.0) return 0;
    if (t < 13.0) return 1;
    if (t < 20.0) return 2;
    return 3;
  }
  if (channel === "pump.tempC") return 23 + 14 * burstPulse + 2.5 * Math.sin(t * 0.7);
  if (channel === "nav.depthM") {
    if (t < 6) return 4 + smoothstep(0, 6, t) * 34;
    if (t < 13) return 38 + Math.sin(t * 1.1) * 0.6;
    if (t < 20) return 38 - smoothstep(13, 20, t) * 14;
    return 24 - smoothstep(20, 25, t) * 20;
  }
  if (channel === "nav.pitchDeg") {
    if (t < 6) return -14 * Math.sin((t / 6) * Math.PI);
    if (t < 13) return 2.5 * Math.sin(t * 1.3);
    if (t < 20) return 11 * burstPulse + 2 * Math.sin(t * 3.1);
    return 14 * Math.sin(((t - 20) / 5) * Math.PI);
  }
  if (channel === "nav.rollDeg") return 4.2 * Math.sin(t * 0.95) - 5.5 * evaluateOctopusArm3DetachFactor(t);
  if (channel === "nav.depthHold") return t >= 6 && t < 13 ? 1 : 0;

  if (channel.startsWith("arm.")) {
    const parts = channel.split(".");
    const idx = Number(parts[1]);
    const prop = parts[2];
    if (Number.isInteger(idx) && idx >= 0 && idx < 8) {
      if (prop === "attached") {
        return idx === 2 && evaluateOctopusArm3DetachFactor(t) > 0.15 ? 0 : 1;
      }
      if (prop === "curl") {
        const base = 70 + 18 * Math.sin(t * 1.35 + idx * 0.92);
        const tuckBias = burstPulse * -28;
        return Math.max(18, Math.min(98, base + tuckBias));
      }
    }
  }
  return null;
};

// ── R3F Component ────────────────────────────────────────────────────────────

export interface OctopusShowcaseAssemblyProps {
  readonly explodeFactor: number;
  readonly caeOverlay: RotundaCaeOverlay;
  readonly renderStyle: RotundaRenderStyle;
  readonly simulationTime: number;
  readonly simulationTimeRef?: React.RefObject<number> | undefined;
  readonly clippingPlanes: THREE.Plane[];
  readonly isGhost?: boolean | undefined;
  readonly ghostOpacity?: number | undefined;
  readonly visibility?: AssemblyVisibilityState | undefined;
  readonly isInXr?: boolean | undefined;
  readonly dark?: boolean | undefined;
  readonly onSelectSubsystem?: ((subsystemId: string) => void) | undefined;
}

const DEFAULT_VIS = createDefaultAssemblyVisibility();

export const OctopusShowcaseAssembly: React.FC<OctopusShowcaseAssemblyProps> = ({
  explodeFactor,
  caeOverlay,
  renderStyle,
  simulationTime,
  simulationTimeRef,
  clippingPlanes,
  isGhost = false,
  ghostOpacity = 0.2,
  visibility = DEFAULT_VIS,
  isInXr = false,
  dark = true,
  onSelectSubsystem,
}) => {
  const { gl } = useThree();
  const pbrMaps = useMemo(() => getCachedHeroPbrTextures(gl), [gl]);

  const segmentsMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const jointCollarsMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const wheelsMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const pistonsMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const swashplateGroupRef = useRef<THREE.Group | null>(null);
  const pumpShaftRef = useRef<THREE.Mesh | null>(null);
  const bodyGroupRef = useRef<THREE.Group | null>(null);
  const thrustNormRef = useRef<number>(0);

  // Pre-allocated typed matrices for zero-allocation 72/90 FPS useFrame updates
  const segMatrices = useMemo(() => new Float32Array(OCTOPUS_TOTAL_SEGMENTS * 16), []);
  const collarMatrices = useMemo(() => new Float32Array(OCTOPUS_TOTAL_SEGMENTS * 16), []);
  const wheelMatrices = useMemo(() => new Float32Array(OCTOPUS_TOTAL_WHEELS * 16), []);
  const pistonMatrices = useMemo(() => new Float32Array(OCTOPUS_PISTON_COUNT * 16), []);
  const tmpMat4 = useMemo(() => new THREE.Matrix4(), []);

  // Reusable shared geometries for GPU instancing (total ~5 geometries)
  const geometries = useMemo(() => {
    const segmentGeo = new THREE.CylinderGeometry(0.015, 0.019, 0.025, 12);
    segmentGeo.rotateZ(Math.PI / 2); // Align cylinder length along local +X bone axis
    const collarGeo = new THREE.CylinderGeometry(0.0155, 0.0155, 0.008, 10);
    collarGeo.rotateZ(Math.PI / 2);
    const wheelGeo = new THREE.TorusGeometry(0.0068, 0.0026, 7, 12);
    const pistonGeo = new THREE.CylinderGeometry(0.0075, 0.0075, 0.056, 10);
    return { segmentGeo, collarGeo, wheelGeo, pistonGeo };
  }, []);

  useEffect(() => {
    return () => {
      geometries.segmentGeo.dispose();
      geometries.collarGeo.dispose();
      geometries.wheelGeo.dispose();
      geometries.pistonGeo.dispose();
    };
  }, [geometries]);

  const effectiveExplode = Math.max(explodeFactor, visibility.explodeFactor);
  const isWire = renderStyle === "wireframe";
  const isXray = renderStyle === "xray";

  const opticPres = resolvePartPresentation("optic", visibility, { ghostNonIsolated: true });
  const mantlePres = resolvePartPresentation("mantle", visibility, {
    isDefaultGhostable: true,
    ghostNonIsolated: true,
    ghostOpacity: 0.16,
  });
  const pumpPres = resolvePartPresentation("pump-core", visibility, { ghostNonIsolated: true });
  const armsPres = resolvePartPresentation("arm-chains", visibility, { ghostNonIsolated: true });
  const siphonPres = resolvePartPresentation("siphon", visibility, { ghostNonIsolated: true });
  const beakPres = resolvePartPresentation("beak", visibility, { ghostNonIsolated: true });

  const cfdHighlight = caeOverlay === "cfd-flow";
  const thermalHighlight = caeOverlay === "thermal";
  const feaHighlight = caeOverlay === "fea-stress";

  // Precompute arm azimuths and initial per-instance colors once
  useEffect(() => {
    const segMesh = segmentsMeshRef.current;
    const wheelMesh = wheelsMeshRef.current;
    if (!segMesh || !wheelMesh) return;

    const whiteShell = new THREE.Color("#eef2f6");
    const orangeAccent = new THREE.Color("#f97316");
    const detachTint = new THREE.Color("#38bdf8");
    const wheelCrimson = new THREE.Color("#9f1239");
    const wheelDark = new THREE.Color("#334155");

    let segIdx = 0;
    let wheelIdx = 0;
    for (let arm = 0; arm < 8; arm++) {
      const segCount = OCTOPUS_ARM_SEGMENT_COUNTS[arm]!;
      const dorsalCount = OCTOPUS_ARM_DORSAL_WHEEL_COUNTS[arm]!;
      for (let s = 0; s < segCount; s++) {
        // Highlight every 5th ceramic sleeve with subtle orange industrial band; Arm 3 collar hint
        const isStripe = s % 5 === 2;
        const c = arm === 2 && s === 0 ? detachTint : isStripe ? orangeAccent : whiteShell;
        segMesh.setColorAt(segIdx++, c);

        // Two ventral sucker wheels per segment (404 total)
        wheelMesh.setColorAt(wheelIdx++, wheelCrimson);
        wheelMesh.setColorAt(wheelIdx++, wheelCrimson);
        // Dorsal traction rollers on proximal heavy segments (85 total)
        if (s < dorsalCount) {
          wheelMesh.setColorAt(wheelIdx++, wheelDark);
        }
      }
    }
    if (segMesh.instanceColor) segMesh.instanceColor.needsUpdate = true;
    if (wheelMesh.instanceColor) wheelMesh.instanceColor.needsUpdate = true;
  }, []);

  // Zero-alloc 72/90 FPS kinematic evaluator: 8 arms (202 segments + 489 wheels) + 7-piston pump
  useFrame(() => {
    const t = simulationTimeRef?.current ?? simulationTime;
    const cycleT = ((t % OCTOPUS_MISSION_DURATION_SEC) + OCTOPUS_MISSION_DURATION_SEC) % OCTOPUS_MISSION_DURATION_SEC;

    const thrustN = sampleOctopusTelemetryChannel("jet.thrust", cycleT) ?? 0;
    const thrustNorm = Math.max(0, Math.min(1, thrustN / 6.2));
    thrustNormRef.current = thrustNorm;

    const arm3Detach = evaluateOctopusArm3DetachFactor(cycleT);
    const pitchDeg = sampleOctopusTelemetryChannel("nav.pitchDeg", cycleT) ?? 0;
    const rollDeg = sampleOctopusTelemetryChannel("nav.rollDeg", cycleT) ?? 0;

    if (bodyGroupRef.current) {
      bodyGroupRef.current.position.y = Math.sin(cycleT * 1.4) * 0.018;
      bodyGroupRef.current.rotation.x = THREE.MathUtils.degToRad(pitchDeg * 0.35);
      bodyGroupRef.current.rotation.z = THREE.MathUtils.degToRad(rollDeg * 0.35);
    }

    // 1. Closed-loop 7-piston swashplate pump
    const pumpRpmFactor = 3.2 + thrustNorm * 9.5;
    const shaftAngle = cycleT * pumpRpmFactor;
    const pumpSol = solveSwashplatePumpKinematics(shaftAngle, OCTOPUS_PISTON_COUNT, 0.28, 0.042);

    if (swashplateGroupRef.current) {
      const [qx, qy, qz, qw] = pumpSol.swashplateQuaternion;
      swashplateGroupRef.current.quaternion.set(qx, qy, qz, qw);
    }
    if (pumpShaftRef.current) {
      pumpShaftRef.current.rotation.y = shaftAngle;
    }
    const pistonsMesh = pistonsMeshRef.current;
    if (pistonsMesh) {
      for (let i = 0; i < pumpSol.pistons.length; i++) {
        const p = pumpSol.pistons[i]!;
        const radialSpread = 1 + effectiveExplode * 0.45;
        composeTransformMatrixDirect(
          pistonMatrices,
          i * 16,
          [p.radialX * radialSpread, 0.028 + p.axialOffset, p.radialZ * radialSpread],
          [0, 0, 0, 1],
          [1, 1, 1],
        );
        tmpMat4.fromArray(pistonMatrices, i * 16);
        pistonsMesh.setMatrixAt(i, tmpMat4);
      }
      pistonsMesh.instanceMatrix.needsUpdate = true;
    }

    // 2. 8 Articulated Arm Chains (202 linked segments + 489 wheels)
    const segMesh = segmentsMeshRef.current;
    const collarMesh = jointCollarsMeshRef.current;
    const wheelMesh = wheelsMeshRef.current;
    if (!segMesh || !collarMesh || !wheelMesh) return;

    let segIdx = 0;
    let wheelIdx = 0;
    const baseRadius = 0.118 + effectiveExplode * 0.065;
    const tuckFactor = smoothstep(0.25, 0.85, thrustNorm);

    for (let arm = 0; arm < 8; arm++) {
      const azim = (arm / 8) * Math.PI * 2 + Math.PI / 8;
      const cosA = Math.cos(azim);
      const sinA = Math.sin(azim);
      const segCount = OCTOPUS_ARM_SEGMENT_COUNTS[arm]!;
      const dorsalCount = OCTOPUS_ARM_DORSAL_WHEEL_COUNTS[arm]!;

      // Autonomous detach offset on Arm 3 (index 2)
      const isDetachedArm = arm === 2;
      const detachBoost = isDetachedArm ? arm3Detach : 0;
      const detachRadial = detachBoost * 0.18;
      const detachLift = detachBoost * (-0.06 + 0.03 * Math.sin(cycleT * 3.8));
      const detachYawOffset = detachBoost * 0.35 * Math.sin(cycleT * 2.1);

      let px = cosA * (baseRadius + detachRadial);
      let py = -0.045 + detachLift;
      let pz = sinA * (baseRadius + detachRadial);

      const qBaseYaw = quaternionFromAxisAngle([0, 1, 0], -azim + detachYawOffset, false);
      let curPitch = -0.28 - tuckFactor * 0.35 + Math.sin(cycleT * 1.45 + arm * 0.85) * 0.14;
      let curYawWave = 0;

      for (let s = 0; s < segCount; s++) {
        const frac = s / Math.max(1, segCount - 1);
        const taper = 1.0 - frac * 0.72;
        const segLen = 0.0245 * (0.45 + 0.55 * taper) * (1 + effectiveExplode * 0.25);

        // Travelling bio-inspired tentacle curl wave (curls tighter at tips, streamlines during jet burst)
        const curlStrength = (1 - tuckFactor * 0.65) * (0.055 + 0.16 * frac * frac);
        const wave = Math.sin(cycleT * 2.1 - frac * 4.4 + arm * 0.92);
        const dPitch = curlStrength * (0.65 + 0.55 * wave) + detachBoost * 0.06 * Math.cos(cycleT * 3.2 - frac * 3.0);
        const dYaw = 0.042 * Math.cos(cycleT * 1.65 - frac * 3.2 + arm * 1.15) * (1 - tuckFactor * 0.5);

        curPitch += dPitch;
        curYawWave += dYaw;

        const qLocalYaw = quaternionFromAxisAngle([0, 1, 0], curYawWave, false);
        const qLocalPitch = quaternionFromAxisAngle([0, 0, 1], curPitch, false);
        const segQuat: Quat = quaternionMultiply(qBaseYaw, quaternionMultiply(qLocalYaw, qLocalPitch));

        // Bone forward unit vector = rotate([1, 0, 0], segQuat)
        const [qx, qy, qz, qw] = segQuat;
        const fx = 1 - 2 * (qy * qy + qz * qz);
        const fy = 2 * (qx * qy + qw * qz);
        const fz = 2 * (qx * qz - qw * qy);

        // Bone local up unit vector = rotate([0, 1, 0], segQuat)
        const ux = 2 * (qx * qy - qw * qz);
        const uy = 1 - 2 * (qx * qx + qz * qz);
        const uz = 2 * (qy * qz + qw * qx);

        // Bone local right unit vector = rotate([0, 0, 1], segQuat)
        const rx = 2 * (qx * qz + qw * qy);
        const ry = 2 * (qy * qz - qw * qx);
        const rz = 1 - 2 * (qx * qx + qy * qy);

        const midX = px + fx * segLen * 0.5;
        const midY = py + fy * segLen * 0.5;
        const midZ = pz + fz * segLen * 0.5;

        // Write ceramic segment matrix
        composeTransformMatrixDirect(segMatrices, segIdx * 16, [midX, midY, midZ], segQuat, [
          0.95 * (0.45 + 0.55 * taper),
          taper,
          taper,
        ]);
        tmpMat4.fromArray(segMatrices, segIdx * 16);
        segMesh.setMatrixAt(segIdx, tmpMat4);

        // Write dark anodized articulation collar at joint pivot
        composeTransformMatrixDirect(collarMatrices, segIdx * 16, [px, py, pz], segQuat, [
          0.9,
          taper * 0.92,
          taper * 0.92,
        ]);
        tmpMat4.fromArray(collarMatrices, segIdx * 16);
        collarMesh.setMatrixAt(segIdx, tmpMat4);
        segIdx++;

        // Write 2 paired ventral wheels/suckers
        const wScale = 0.42 + 0.65 * taper;
        const ventralOff = -0.0155 * taper;
        const lateralOff = 0.0085 * taper;

        for (const side of [-1, 1] as const) {
          composeTransformMatrixDirect(
            wheelMatrices,
            wheelIdx * 16,
            [
              midX + ux * ventralOff + rx * lateralOff * side,
              midY + uy * ventralOff + ry * lateralOff * side,
              midZ + uz * ventralOff + rz * lateralOff * side,
            ],
            segQuat,
            [wScale, wScale, wScale],
          );
          tmpMat4.fromArray(wheelMatrices, wheelIdx * 16);
          wheelMesh.setMatrixAt(wheelIdx, tmpMat4);
          wheelIdx++;
        }

        // Write proximal dorsal traction roller (85 total -> 404 + 85 = 489 exact)
        if (s < dorsalCount) {
          const dorsalOff = 0.0155 * taper;
          composeTransformMatrixDirect(
            wheelMatrices,
            wheelIdx * 16,
            [midX + ux * dorsalOff, midY + uy * dorsalOff, midZ + uz * dorsalOff],
            segQuat,
            [wScale * 0.85, wScale * 0.85, wScale * 0.85],
          );
          tmpMat4.fromArray(wheelMatrices, wheelIdx * 16);
          wheelMesh.setMatrixAt(wheelIdx, tmpMat4);
          wheelIdx++;
        }

        // Advance joint chain tip
        px += fx * segLen;
        py += fy * segLen;
        pz += fz * segLen;
      }
    }

    segMesh.instanceMatrix.needsUpdate = true;
    collarMesh.instanceMatrix.needsUpdate = true;
    wheelMesh.instanceMatrix.needsUpdate = true;
  });

  const mantleTransparent = isGhost || isXray || mantlePres.ghosted;
  const mantleOpacity = isGhost ? ghostOpacity : isXray ? 0.24 : mantlePres.opacity;
  const mantleLiftY = effectiveExplode * 0.14;

  return (
    <group ref={bodyGroupRef} name="pelagos-oc8-octopus">
      {/* ── 02 MANTLE SHELL (Ceramic Pressure Hull with Procedural Panel Seams & Rivets) ── */}
      {mantlePres.visible && (
        <group name="subsystem-mantle" position={[0, mantleLiftY, 0]}>
          <mesh position={[0, 0.095, 0]} castShadow={!isInXr} receiveShadow={!isInXr}>
            <sphereGeometry args={[0.142, 32, 24]} />
            <meshStandardMaterial
              color={feaHighlight ? "#f59e0b" : thermalHighlight ? "#ec4899" : "#f1f5f9"}
              metalness={0.08}
              roughness={0.22}
              normalMap={pbrMaps.detailNormal}
              normalScale={new THREE.Vector2(0.18, 0.18)}
              roughnessMap={pbrMaps.detailRoughness}
              wireframe={isWire}
              transparent={mantleTransparent}
              opacity={mantleOpacity}
              depthWrite={!mantleTransparent}
              clippingPlanes={isGhost ? [] : clippingPlanes}
            />
          </mesh>
          {/* Equatorial dark anodized structural flange */}
          <mesh position={[0, 0.015, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.143, 0.014, 12, 36]} />
            <meshStandardMaterial
              color="#1e293b"
              metalness={0.85}
              roughness={0.28}
              normalMap={pbrMaps.normal}
              normalScale={new THREE.Vector2(0.06, 0.04)}
              wireframe={isWire}
              transparent={mantleTransparent}
              opacity={mantleTransparent ? Math.min(0.45, mantleOpacity + 0.15) : 1}
              clippingPlanes={isGhost ? [] : clippingPlanes}
            />
          </mesh>
          {/* Safety-orange telemetry beacon hatch */}
          <mesh position={[0.052, 0.175, 0.088]} rotation={[0.45, 0.45, 0]}>
            <boxGeometry args={[0.032, 0.01, 0.032]} />
            <meshStandardMaterial
              color="#f97316"
              metalness={0.14}
              roughness={0.22}
              emissive="#ea580c"
              emissiveIntensity={0.28}
              wireframe={isWire}
              transparent={mantleTransparent}
              opacity={mantleOpacity}
              clippingPlanes={isGhost ? [] : clippingPlanes}
            />
          </mesh>
        </group>
      )}

      {/* ── 01 OPTIC ARRAY (Twin Stereo Subsea Cameras with Orange Retention Bezels) ── */}
      {opticPres.visible && (
        <group name="subsystem-optic" position={[0, 0.048, 0.115 + effectiveExplode * 0.09]}>
          {([-0.056, 0.056] as const).map((xOff, idx) => (
            <group key={idx} position={[xOff, 0, 0]} rotation={[0, xOff < 0 ? -0.26 : 0.26, 0]}>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.042, 0.046, 0.032, 24]} />
                <meshStandardMaterial
                  color="#1e293b"
                  metalness={0.84}
                  roughness={0.26}
                  wireframe={isWire}
                  transparent={isGhost || opticPres.ghosted}
                  opacity={isGhost ? ghostOpacity : opticPres.opacity}
                  clippingPlanes={isGhost ? [] : clippingPlanes}
                />
              </mesh>
              <mesh position={[0, 0, 0.017]}>
                <torusGeometry args={[0.036, 0.0045, 10, 28]} />
                <meshStandardMaterial
                  color="#f97316"
                  metalness={0.15}
                  roughness={0.2}
                  emissive="#f97316"
                  emissiveIntensity={0.22}
                  wireframe={isWire}
                  transparent={isGhost || opticPres.ghosted}
                  opacity={isGhost ? ghostOpacity : opticPres.opacity}
                  clippingPlanes={isGhost ? [] : clippingPlanes}
                />
              </mesh>
              <mesh position={[0, 0, 0.015]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.028, 0.028, 0.012, 20]} />
                <meshStandardMaterial
                  color="#0f172a"
                  metalness={0.3}
                  roughness={0.05}
                  emissive="#0284c7"
                  emissiveIntensity={0.32}
                  wireframe={isWire}
                  transparent={isGhost || opticPres.ghosted}
                  opacity={isGhost ? ghostOpacity : opticPres.opacity}
                  clippingPlanes={isGhost ? [] : clippingPlanes}
                />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {/* ── 03 INTERNAL 7-PISTON SWASHPLATE PUMP CORE (Closed-Loop Kinematics) ── */}
      {pumpPres.visible && (
        <group name="subsystem-pump-core" position={[0, 0.055 + effectiveExplode * 0.04, 0]}>
          {/* Cylinder manifold block */}
          <mesh position={[0, 0.038, 0]}>
            <cylinderGeometry args={[0.064, 0.064, 0.054, 18]} />
            <meshStandardMaterial
              color={thermalHighlight ? "#f97316" : "#475569"}
              metalness={0.86}
              roughness={0.28}
              wireframe={isWire}
              transparent={isGhost || pumpPres.ghosted}
              opacity={isGhost ? ghostOpacity : pumpPres.ghosted ? pumpPres.opacity : 0.92}
              clippingPlanes={isGhost ? [] : clippingPlanes}
            />
          </mesh>
          {/* Rotating central drive shaft */}
          <mesh ref={pumpShaftRef} position={[0, 0.01, 0]}>
            <cylinderGeometry args={[0.013, 0.013, 0.145, 14]} />
            <meshStandardMaterial
              color="#cbd5e1"
              metalness={0.94}
              roughness={0.16}
              wireframe={isWire}
              transparent={isGhost || pumpPres.ghosted}
              opacity={isGhost ? ghostOpacity : pumpPres.opacity}
              clippingPlanes={isGhost ? [] : clippingPlanes}
            />
          </mesh>
          {/* Tilted wobbling swashplate cam disc */}
          <group ref={swashplateGroupRef} position={[0, -0.02, 0]}>
            <mesh>
              <cylinderGeometry args={[0.056, 0.056, 0.011, 20]} />
              <meshStandardMaterial
                color="#10b981"
                metalness={0.82}
                roughness={0.22}
                emissive={thermalHighlight ? "#f59e0b" : "#065f46"}
                emissiveIntensity={0.28}
                wireframe={isWire}
                transparent={isGhost || pumpPres.ghosted}
                opacity={isGhost ? ghostOpacity : pumpPres.opacity}
                clippingPlanes={isGhost ? [] : clippingPlanes}
              />
            </mesh>
          </group>
          {/* 7 Reciprocating Pistons (1 InstancedMesh draw call) */}
          <instancedMesh
            ref={pistonsMeshRef}
            args={[geometries.pistonGeo, undefined, OCTOPUS_PISTON_COUNT]}
            frustumCulled={false}
          >
            <meshStandardMaterial
              color={thermalHighlight ? "#fb923c" : "#e2e8f0"}
              metalness={0.92}
              roughness={0.16}
              wireframe={isWire}
              transparent={isGhost || pumpPres.ghosted}
              opacity={isGhost ? ghostOpacity : pumpPres.opacity}
              clippingPlanes={isGhost ? [] : clippingPlanes}
            />
          </instancedMesh>
        </group>
      )}

      {/* ── 04 EIGHT ARTICULATED ARMS (202 Segments + 202 Collars + 489 Wheels in 3 Draw Calls) ── */}
      {armsPres.visible && (
        <group name="subsystem-arm-chains">
          <instancedMesh
            ref={segmentsMeshRef}
            args={[geometries.segmentGeo, undefined, OCTOPUS_TOTAL_SEGMENTS]}
            castShadow={!isInXr}
            receiveShadow={!isInXr}
            frustumCulled={false}
          >
            <meshStandardMaterial
              color="#ffffff"
              metalness={0.12}
              roughness={0.24}
              normalMap={pbrMaps.detailNormal}
              normalScale={new THREE.Vector2(0.14, 0.14)}
              wireframe={isWire}
              transparent={isGhost || isXray || armsPres.ghosted}
              opacity={isGhost ? ghostOpacity : isXray ? 0.34 : armsPres.opacity}
              clippingPlanes={isGhost ? [] : clippingPlanes}
            />
          </instancedMesh>

          <instancedMesh
            ref={jointCollarsMeshRef}
            args={[geometries.collarGeo, undefined, OCTOPUS_TOTAL_SEGMENTS]}
            frustumCulled={false}
          >
            <meshStandardMaterial
              color={feaHighlight ? "#ef4444" : "#1e293b"}
              metalness={0.86}
              roughness={0.28}
              wireframe={isWire}
              transparent={isGhost || isXray || armsPres.ghosted}
              opacity={isGhost ? ghostOpacity : isXray ? 0.35 : armsPres.opacity}
              clippingPlanes={isGhost ? [] : clippingPlanes}
            />
          </instancedMesh>

          <instancedMesh
            ref={wheelsMeshRef}
            args={[geometries.wheelGeo, undefined, OCTOPUS_TOTAL_WHEELS]}
            frustumCulled={false}
          >
            <meshStandardMaterial
              color="#ffffff"
              metalness={0.25}
              roughness={0.62}
              wireframe={isWire}
              transparent={isGhost || isXray || armsPres.ghosted}
              opacity={isGhost ? ghostOpacity : isXray ? 0.34 : armsPres.opacity}
              clippingPlanes={isGhost ? [] : clippingPlanes}
            />
          </instancedMesh>
        </group>
      )}

      {/* ── 05 SIPHON VECTORED THRUSTER & 2.68 m/s GPU PARTICLE JET PLUME ── */}
      {siphonPres.visible && (
        <group name="subsystem-siphon" position={[0, 0.012, -0.142 - effectiveExplode * 0.1]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.028, 0.042, 0.072, 20]} />
            <meshStandardMaterial
              color={cfdHighlight ? "#06b6d4" : "#334155"}
              metalness={0.82}
              roughness={0.26}
              wireframe={isWire}
              transparent={isGhost || siphonPres.ghosted}
              opacity={isGhost ? ghostOpacity : siphonPres.opacity}
              clippingPlanes={isGhost ? [] : clippingPlanes}
            />
          </mesh>
          <mesh position={[0, 0, -0.036]}>
            <torusGeometry args={[0.028, 0.004, 8, 20]} />
            <meshStandardMaterial
              color="#06b6d4"
              metalness={0.5}
              roughness={0.2}
              emissive="#0ea5e9"
              emissiveIntensity={0.45}
              wireframe={isWire}
              transparent={isGhost || siphonPres.ghosted}
              opacity={isGhost ? ghostOpacity : siphonPres.opacity}
              clippingPlanes={isGhost ? [] : clippingPlanes}
            />
          </mesh>
          {!isGhost && (
            <JetPlumeRenderer
              position={[0, 0, -0.04]}
              direction={[0, 0, -1]}
              thrustNorm={0.5}
              thrustNormRef={thrustNormRef}
              simulationTimeRef={simulationTimeRef}
              jetVelocity={2.68}
              plumeLength={0.52}
              nozzleRadius={0.022}
              isInXr={isInXr}
              coreColor={cfdHighlight ? "#a5f3fc" : "#e0f2fe"}
              edgeColor={cfdHighlight ? "#06b6d4" : "#38bdf8"}
            />
          )}
        </group>
      )}

      {/* ── 06 VENTRAL BEAK / TWIN-JAW MANIPULATOR ── */}
      {beakPres.visible && (
        <group name="subsystem-beak" position={[0, -0.088 - effectiveExplode * 0.08, 0.01]}>
          <mesh position={[0, 0.01, 0]}>
            <cylinderGeometry args={[0.044, 0.03, 0.024, 16]} />
            <meshStandardMaterial
              color="#1e293b"
              metalness={0.84}
              roughness={0.3}
              wireframe={isWire}
              transparent={isGhost || beakPres.ghosted}
              opacity={isGhost ? ghostOpacity : beakPres.opacity}
              clippingPlanes={isGhost ? [] : clippingPlanes}
            />
          </mesh>
          {([-0.016, 0.016] as const).map((xOff, idx) => (
            <mesh key={idx} position={[xOff, -0.014, 0]} rotation={[0, 0, xOff < 0 ? 0.35 : -0.35]}>
              <coneGeometry args={[0.012, 0.036, 8]} />
              <meshStandardMaterial
                color="#a855f7"
                metalness={0.76}
                roughness={0.28}
                wireframe={isWire}
                transparent={isGhost || beakPres.ghosted}
                opacity={isGhost ? ghostOpacity : beakPres.opacity}
                clippingPlanes={isGhost ? [] : clippingPlanes}
              />
            </mesh>
          ))}
        </group>
      )}

      {/* ── DUAL-MODE 3D CALLOUT LABELS (DOM Html in Desktop / Sprite Billboards in Stereo VR) ── */}
      {!isGhost && (
        <CalloutLabels3D
          pins={OCTOPUS_CALLOUT_PINS}
          visible={visibility.showLabels}
          mode={isInXr ? "sprite" : "dom"}
          dark={dark}
          activeSubsystemId={visibility.isolatedSubsystemId}
          onSelectSubsystem={onSelectSubsystem}
        />
      )}
    </group>
  );
};
