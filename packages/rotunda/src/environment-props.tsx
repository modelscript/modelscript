// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";
import {
  createCableStayedBridgeGeometry,
  createConferenceTableGeometry,
  createCylinderPart,
  createErgonomicTaskChairGeometry,
  createHorizonLoungeSofaGeometry,
  createLabWorkbenchGeometry,
  createLakeSailboatGeometry,
  createLoungeCoffeeTableGeometry,
  createObservatoryDomeGeometry,
  createOfficeCubiclePodGeometry,
  createOfficeWaterCoolerGeometry,
  createPanoramicMountainRingGeometry,
  createParkBroadleafTreeGeometry,
  createPottedIndoorTreeGeometry,
  createRoundedBoxPart,
  createSculptedPineTreeGeometry,
  createSilverBirchTreeGeometry,
  createWarehouseAgvGeometry,
  createWindTurbineRotorGeometry,
  createWindTurbineTowerGeometry,
  mergePartGeometries,
} from "./prop-archetypes.js";

const NOOP_RAYCAST: THREE.Object3D["raycast"] = () => {};

export interface PropTransformInstance {
  readonly pos: readonly [number, number, number];
  readonly rot?: readonly [number, number, number] | undefined;
  readonly scale?: readonly [number, number, number] | number | undefined;
  readonly tint?: string | undefined;
}

interface ArchetypeBatchProps {
  geometry: THREE.BufferGeometry;
  instances: readonly PropTransformInstance[];
  roughness?: number | undefined;
  metalness?: number | undefined;
  envMapIntensity?: number | undefined;
  unlit?: boolean | undefined;
  opacity?: number | undefined;
}

/**
 * Single-draw-call `THREE.InstancedMesh` batch for multi-material vertex-colored sculpted archetypes.
 * Multiplies baked per-vertex sRGB colors + AO with optional per-instance tinting, with `NOOP_RAYCAST`
 * so rich Quest 3 Home + Job Simulator rooms cost near-zero CPU/GPU overhead at 72/90 FPS.
 */
function ArchetypeBatch({
  geometry,
  instances,
  roughness = 0.68,
  metalness = 0.06,
  envMapIntensity = 0.72,
  unlit = false,
  opacity = 1,
}: ArchetypeBatchProps): ReactElement | null {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const hasVertexColors = Boolean(geometry.getAttribute("color"));

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || instances.length === 0) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]!;
      dummy.position.set(inst.pos[0], inst.pos[1], inst.pos[2]);
      if (inst.rot) {
        dummy.rotation.set(inst.rot[0], inst.rot[1], inst.rot[2]);
      } else {
        dummy.rotation.set(0, 0, 0);
      }
      if (typeof inst.scale === "number") {
        dummy.scale.setScalar(inst.scale);
      } else if (inst.scale) {
        dummy.scale.set(inst.scale[0], inst.scale[1], inst.scale[2]);
      } else {
        dummy.scale.set(1, 1, 1);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.set(inst.tint ?? "#ffffff");
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [instances]);

  if (instances.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, instances.length]}
      frustumCulled={false}
      raycast={NOOP_RAYCAST}
    >
      {unlit ? (
        <meshBasicMaterial
          color="#ffffff"
          vertexColors={hasVertexColors}
          toneMapped={false}
          transparent={opacity < 1}
          opacity={opacity}
          depthWrite={opacity >= 1}
        />
      ) : (
        <meshStandardMaterial
          color="#ffffff"
          vertexColors={hasVertexColors}
          roughness={roughness}
          metalness={metalness}
          envMapIntensity={envMapIntensity}
          transparent={opacity < 1}
          opacity={opacity}
        />
      )}
    </instancedMesh>
  );
}

function hashDet(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Crisp architectural screen / whiteboard / presentation display CanvasTexture (SSR/JSDOM safe). */
function createDisplayBoardTexture(
  style: "pavilion-totem" | "office-whiteboard" | "conference-screen",
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 288;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (style === "pavilion-totem" || style === "conference-screen") {
    const grad = ctx.createLinearGradient(0, 0, 0, 288);
    grad.addColorStop(0, "#0f172a");
    grad.addColorStop(1, "#1e293b");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 288);

    ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, 484, 260);

    // Clean modern Horizon OS / Keynote telemetry card layout
    ctx.fillStyle = "rgba(56, 189, 248, 0.14)";
    ctx.fillRect(28, 28, 204, 232);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(130, 144, 58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(130, 144, 30, 0, Math.PI * 2);
    ctx.stroke();

    const cards: readonly [number, number, number, number, string][] = [
      [252, 32, 108, 62, "#38bdf8"],
      [376, 32, 108, 62, "#34d399"],
      [252, 112, 232, 64, "#fbbf24"],
    ];
    for (const [bx, by, bw, bh, col] of cards) {
      ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.2;
      ctx.strokeRect(bx, by, bw, bh);
    }

    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 256; x <= 480; x += 6) {
      const t = (x - 256) / 224;
      const y = 228 + Math.sin(t * Math.PI * 5) * 20 * Math.exp(-t * 0.9);
      if (x === 256) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else {
    // Studio glass dry-erase board with clean architecture flow & pastel sticky notes
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, 512, 288);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, 496, 272);

    const boxes: readonly [number, number, number, number, string][] = [
      [38, 48, 112, 58, "#0284c7"],
      [192, 48, 118, 58, "#059669"],
      [116, 152, 132, 60, "#ea580c"],
    ];
    for (const [bx, by, bw, bh, col] of boxes) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 3.5;
      ctx.strokeRect(bx, by, bw, bh);
    }
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(150, 77);
    ctx.lineTo(192, 77);
    ctx.moveTo(251, 106);
    ctx.lineTo(251, 182);
    ctx.lineTo(248, 182);
    ctx.stroke();

    const stickies: readonly [number, number, string][] = [
      [352, 42, "#fef08a"],
      [422, 48, "#bae6fd"],
      [360, 118, "#bbf7d0"],
      [428, 124, "#fbcfe8"],
      [382, 194, "#fed7aa"],
    ];
    for (const [sx, sy, col] of stickies) {
      ctx.fillStyle = col;
      ctx.fillRect(sx, sy, 54, 50);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* -------------------------------------------------------------------------- */
/*  1. Horizon Pavilion ("atrium") — Lounge Sofas, Credenza, Olive Planters   */
/* -------------------------------------------------------------------------- */

function createPavilionCredenzaGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const walnut = "#7a563b";
  const stone = "#f2ede4";
  // Long warm-walnut architectural sideboard + honed stone top + espresso machine & cups
  parts.push(createRoundedBoxPart(2.8, 0.72, 0.56, 0.04, [0, 0.44, 0], { color: walnut, aoStrength: 0.25 }));
  parts.push(createRoundedBoxPart(2.84, 0.04, 0.58, 0.02, [0, 0.82, 0], { color: stone, aoFloorY: 0.78 }));
  for (const lx of [-1.2, 0, 1.2]) {
    parts.push(createCylinderPart(0.024, 0.018, 0.08, 10, [lx, 0.04, 0.2], { color: "#334155", aoStrength: 0.35 }));
    parts.push(createCylinderPart(0.024, 0.018, 0.08, 10, [lx, 0.04, -0.2], { color: "#334155", aoStrength: 0.35 }));
  }
  // Brushed chrome Italian espresso machine + ceramic cups
  parts.push(createRoundedBoxPart(0.46, 0.36, 0.34, 0.03, [-0.65, 1.02, -0.04], { color: "#cbd5e1", aoFloorY: 0.84 }));
  parts.push(createRoundedBoxPart(0.42, 0.06, 0.14, 0.015, [-0.65, 0.87, 0.12], { color: "#475569", aoFloorY: 0.84 }));
  parts.push(createCylinderPart(0.038, 0.03, 0.075, 12, [-0.22, 0.878, 0.05], { color: "#f8fafc", aoFloorY: 0.84 }));
  parts.push(createCylinderPart(0.038, 0.03, 0.075, 12, [-0.11, 0.878, 0.08], { color: "#38bdf8", aoFloorY: 0.84 }));
  // Sculptural ceramic vase + warm arched table lamp on right
  parts.push(createCylinderPart(0.09, 0.13, 0.32, 16, [0.78, 1.0, -0.02], { color: "#d6ccc2", aoFloorY: 0.84 }));
  parts.push(createCylinderPart(0.18, 0.22, 0.2, 18, [0.32, 1.28, -0.02], { color: "#fffbeb", aoStrength: 0 }));
  parts.push(createCylinderPart(0.018, 0.024, 0.38, 10, [0.32, 1.02, -0.02], { color: "#c8a86b", aoFloorY: 0.84 }));
  return mergePartGeometries(parts);
}

function createFloorLampGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(createCylinderPart(0.2, 0.22, 0.035, 18, [0, 0.018, 0], { color: "#e5e0d5", aoStrength: 0.3 }));
  parts.push(createCylinderPart(0.018, 0.022, 1.68, 10, [0, 0.86, 0], { color: "#c8a86b", aoStrength: 0.15 }));
  parts.push(
    createCylinderPart(0.22, 0.28, 0.32, 20, [0, 1.74, 0], { color: "#fff8eb", aoStrength: 0, giStrength: 0.08 }),
  );
  return mergePartGeometries(parts);
}

export function AtriumEnvironmentProps(): ReactElement {
  const sofaGeom = useMemo(() => createHorizonLoungeSofaGeometry(), []);
  const tableGeom = useMemo(() => createLoungeCoffeeTableGeometry(), []);
  const planterGeom = useMemo(() => createPottedIndoorTreeGeometry(), []);
  const credenzaGeom = useMemo(() => createPavilionCredenzaGeometry(), []);
  const lampGeom = useMemo(() => createFloorLampGeometry(), []);
  const mountainNearGeom = useMemo(
    () => createPanoramicMountainRingGeometry(74, -4.5, 4.5, 16.5, "#6b849e", "#dce8f4", 1.4, 96),
    [],
  );
  const mountainFarGeom = useMemo(
    () => createPanoramicMountainRingGeometry(118, -5.0, 9.0, 29.0, "#8ba3bd", "#e8eff7", 4.1, 96),
    [],
  );
  const sailboatGeom = useMemo(() => createLakeSailboatGeometry(), []);
  const totemTex = useMemo(() => createDisplayBoardTexture("pavilion-totem"), []);

  useEffect(() => {
    return () => {
      sofaGeom.dispose();
      tableGeom.dispose();
      planterGeom.dispose();
      credenzaGeom.dispose();
      lampGeom.dispose();
      mountainNearGeom.dispose();
      mountainFarGeom.dispose();
      sailboatGeom.dispose();
      totemTex?.dispose();
    };
  }, [
    sofaGeom,
    tableGeom,
    planterGeom,
    credenzaGeom,
    lampGeom,
    mountainNearGeom,
    mountainFarGeom,
    sailboatGeom,
    totemTex,
  ]);

  const { sofas, tables, planters, credenzas, lamps, boats } = useMemo(() => {
    // Quest 3 Horizon Home conversation lounge zones flanking & behind the user
    const sofaList: PropTransformInstance[] = [
      { pos: [-6.8, 0, -1.6], rot: [0, Math.PI * 0.44, 0], scale: 1.05 },
      { pos: [6.8, 0, -1.6], rot: [0, -Math.PI * 0.44, 0], scale: 1.05 },
      { pos: [0, 0, 5.8], rot: [0, Math.PI, 0], scale: 1.08 },
    ];
    const tableList: PropTransformInstance[] = [
      { pos: [-5.35, 0, -1.85], rot: [0, Math.PI * 0.44, 0], scale: 1.0 },
      { pos: [5.35, 0, -1.85], rot: [0, -Math.PI * 0.44, 0], scale: 1.0 },
      { pos: [0, 0, 4.35], rot: [0, 0, 0], scale: 1.05 },
    ];
    const credenzaList: PropTransformInstance[] = [
      { pos: [-8.4, 0, 2.8], rot: [0, Math.PI * 0.68, 0], scale: 1.0 },
      { pos: [8.4, 0, 2.8], rot: [0, -Math.PI * 0.68, 0], scale: 1.0 },
    ];
    const lampList: PropTransformInstance[] = [
      { pos: [-7.6, 0, -3.4], scale: 1.0 },
      { pos: [7.6, 0, -3.4], scale: 1.0 },
      { pos: [-2.1, 0, 5.9], scale: 1.0 },
      { pos: [2.1, 0, 5.9], scale: 1.0 },
    ];
    const planterList: PropTransformInstance[] = [
      { pos: [-9.8, 0, -6.6], rot: [0, 0.4, 0], scale: 1.12 },
      { pos: [9.8, 0, -6.6], rot: [0, -0.5, 0], scale: 1.12 },
      { pos: [-10.4, 0, -0.4], rot: [0, 1.2, 0], scale: 1.05 },
      { pos: [10.4, 0, -0.4], rot: [0, -1.1, 0], scale: 1.05 },
      { pos: [-5.6, 0, 5.8], rot: [0, 2.1, 0], scale: 1.08 },
      { pos: [5.6, 0, 5.8], rot: [0, -2.2, 0], scale: 1.08 },
    ];
    const boatList: PropTransformInstance[] = [
      { pos: [-28, -1.35, -58], rot: [0, 0.92, 0], scale: 1.15 },
      { pos: [32, -1.35, -66], rot: [0, -0.82, 0], scale: 1.25 },
    ];
    return {
      sofas: sofaList,
      tables: tableList,
      planters: planterList,
      credenzas: credenzaList,
      lamps: lampList,
      boats: boatList,
    };
  }, []);

  return (
    <group name="rotunda-atrium-props">
      {/* Woven soft oatmeal area rugs grounding the 3 lounge seating pits */}
      {[
        [-6.0, -1.75, 2.65],
        [6.0, -1.75, 2.65],
        [0, 4.9, 2.85],
      ].map(([rx, rz, rad], idx) => (
        <mesh key={idx} position={[rx!, 0.004, rz!]} rotation={[-Math.PI / 2, 0, 0]} raycast={NOOP_RAYCAST}>
          <circleGeometry args={[rad!, 48]} />
          <meshStandardMaterial color="#e4ddd2" roughness={0.94} metalness={0} />
        </mesh>
      ))}

      <ArchetypeBatch geometry={sofaGeom} instances={sofas} roughness={0.85} metalness={0.02} />
      <ArchetypeBatch geometry={tableGeom} instances={tables} roughness={0.55} metalness={0.04} />
      <ArchetypeBatch geometry={credenzaGeom} instances={credenzas} roughness={0.52} metalness={0.12} />
      <ArchetypeBatch geometry={lampGeom} instances={lamps} roughness={0.45} metalness={0.25} />
      <ArchetypeBatch geometry={planterGeom} instances={planters} roughness={0.78} metalness={0.02} />
      <ArchetypeBatch geometry={sailboatGeom} instances={boats} roughness={0.48} metalness={0.06} />

      {/* Panoramic 360° Alpine Lake & Mountain Horizon Vista outside the open pavilion terrace */}
      <mesh geometry={mountainFarGeom} raycast={NOOP_RAYCAST}>
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} fog={false} />
      </mesh>
      <mesh geometry={mountainNearGeom} raycast={NOOP_RAYCAST}>
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} fog={false} />
      </mesh>

      {/* 2 Frameless Glass Architectural Telemetry Totems flanking the rear pavilion gallery */}
      {totemTex &&
        (
          [
            [-4.2, 1.48, 5.6, -0.35],
            [4.2, 1.48, 5.6, 0.35],
          ] as const
        ).map(([kx, ky, kz, yaw], idx) => (
          <group key={idx} position={[kx, ky, kz]} rotation={[0, yaw, 0]}>
            <mesh position={[0, -0.74, 0]} raycast={NOOP_RAYCAST}>
              <boxGeometry args={[1.68, 1.42, 0.05]} />
              <meshStandardMaterial color="#cbd5e1" roughness={0.28} metalness={0.62} />
            </mesh>
            <mesh position={[0, 0.06, 0.03]} raycast={NOOP_RAYCAST}>
              <planeGeometry args={[1.56, 0.88]} />
              <meshBasicMaterial map={totemTex} toneMapped={false} />
            </mesh>
          </group>
        ))}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  2. Lakeside Proving Park ("outdoors") — Trees, Pier, Lake, Wind Turbines  */
/* -------------------------------------------------------------------------- */

export interface OutdoorsEnvironmentPropsArgs {
  sampleGroundY: (x: number, z: number) => number;
  plinthX: number;
  plinthZ: number;
}

function createParkBenchGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const cedar = "#c48f61";
  const iron = "#334155";
  parts.push(createRoundedBoxPart(1.75, 0.065, 0.52, 0.025, [0, 0.45, 0], { color: cedar, aoFloorY: 0.38 }));
  parts.push(
    createRoundedBoxPart(1.75, 0.38, 0.055, 0.025, [0, 0.72, -0.22], { color: cedar, aoFloorY: 0.48 }, [-0.18, 0, 0]),
  );
  for (const lx of [-0.68, 0.68]) {
    parts.push(createRoundedBoxPart(0.06, 0.44, 0.48, 0.02, [lx, 0.22, -0.02], { color: iron, aoStrength: 0.32 }));
    parts.push(createRoundedBoxPart(0.055, 0.18, 0.46, 0.02, [lx, 0.54, 0.0], { color: iron, aoFloorY: 0.45 }));
  }
  return mergePartGeometries(parts);
}

function createSmoothCloudGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const puffs: readonly [number, number, number, number, number, number][] = [
    [0, 0, 0, 3.6, 1.45, 2.2],
    [1.65, -0.15, 0.2, 2.4, 1.1, 1.75],
    [-1.55, -0.18, -0.15, 2.3, 1.05, 1.7],
    [0.55, 0.38, -0.1, 2.1, 1.15, 1.6],
  ];
  for (const [x, y, z, sx, sy, sz] of puffs) {
    const sph = new THREE.SphereGeometry(0.5, 14, 10);
    sph.scale(sx, sy, sz);
    sph.translate(x, y, z);
    // Bake subtle sunlit top -> cool sky-blue belly
    const nonIdx = sph.toNonIndexed();
    sph.dispose();
    const pos = nonIdx.getAttribute("position") as THREE.BufferAttribute;
    const norm = nonIdx.getAttribute("normal") as THREE.BufferAttribute;
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ny = norm.getY(i);
      const t = Math.max(0, Math.min(1, ny * 0.5 + 0.5));
      cols[i * 3] = 0.88 + t * 0.12;
      cols[i * 3 + 1] = 0.92 + t * 0.08;
      cols[i * 3 + 2] = 0.97 + t * 0.03;
    }
    nonIdx.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    parts.push(nonIdx);
  }
  return mergePartGeometries(parts);
}

export function OutdoorsEnvironmentProps({
  sampleGroundY,
  plinthX,
  plinthZ,
}: OutdoorsEnvironmentPropsArgs): ReactElement {
  const broadleafGeom = useMemo(() => createParkBroadleafTreeGeometry(), []);
  const birchGeom = useMemo(() => createSilverBirchTreeGeometry(), []);
  const pineGeom = useMemo(() => createSculptedPineTreeGeometry(), []);
  const benchGeom = useMemo(() => createParkBenchGeometry(), []);
  const turbineTowerGeom = useMemo(() => createWindTurbineTowerGeometry(), []);
  const turbineRotorGeom = useMemo(() => createWindTurbineRotorGeometry(), []);
  const bridgeGeom = useMemo(() => createCableStayedBridgeGeometry(), []);
  const domeGeom = useMemo(() => createObservatoryDomeGeometry(), []);
  const sailboatGeom = useMemo(() => createLakeSailboatGeometry(), []);
  const cloudGeom = useMemo(() => createSmoothCloudGeometry(), []);
  const mountainNearGeom = useMemo(
    () => createPanoramicMountainRingGeometry(88, -2.5, 5.5, 19.0, "#5e7d73", "#cde0f0", 2.2, 96),
    [],
  );
  const mountainFarGeom = useMemo(
    () => createPanoramicMountainRingGeometry(126, -3.5, 11.0, 32.0, "#7b98b2", "#dae8f5", 5.8, 96),
    [],
  );

  const rotorRefs = [
    useRef<THREE.Mesh | null>(null),
    useRef<THREE.Mesh | null>(null),
    useRef<THREE.Mesh | null>(null),
  ] as const;
  const boatGroupRef = useRef<THREE.Group | null>(null);
  const cloudsGroupRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    return () => {
      broadleafGeom.dispose();
      birchGeom.dispose();
      pineGeom.dispose();
      benchGeom.dispose();
      turbineTowerGeom.dispose();
      turbineRotorGeom.dispose();
      bridgeGeom.dispose();
      domeGeom.dispose();
      sailboatGeom.dispose();
      cloudGeom.dispose();
      mountainNearGeom.dispose();
      mountainFarGeom.dispose();
    };
  }, [
    broadleafGeom,
    birchGeom,
    pineGeom,
    benchGeom,
    turbineTowerGeom,
    turbineRotorGeom,
    bridgeGeom,
    domeGeom,
    sailboatGeom,
    cloudGeom,
    mountainNearGeom,
    mountainFarGeom,
  ]);

  const { broadleafTrees, birchTrees, pineTrees, benches, turbinePlacements, clouds, pierPlanks } = useMemo(() => {
    const broads: PropTransformInstance[] = [];
    const birches: PropTransformInstance[] = [];
    const pines: PropTransformInstance[] = [];
    const benchList: PropTransformInstance[] = [];
    const cloudList: PropTransformInstance[] = [];
    const pierList: PropTransformInstance[] = [];

    // Curated natural park groves around the wide flat meadow (keeping the right lake vista & center lawn open!)
    const treeCount = 46;
    for (let i = 0; i < treeCount; i++) {
      const a = (i / treeCount) * Math.PI * 2 + (hashDet(i * 3.7) - 0.5) * 0.12;
      const r = 13.5 + hashDet(i * 7.9) * 34.0;
      const x = plinthX + Math.cos(a) * r;
      const z = plinthZ + Math.sin(a) * r;

      // Keep Lake Basin (x > 10, z in [-52, 22]) and immediate terrace lawn completely clear of trees
      if (x > 9.5 && z > -50 && z < 20) continue;
      // Keep direct sightline toward the bridge & wind-turbine ridge open
      if (Math.abs(x) < 6.5 && z < -8) continue;
      if (Math.hypot(x, z) < 11.0) continue;

      const gy = sampleGroundY(x, z);
      if (gy < -0.15) continue;

      const s = 0.88 + hashDet(i * 11.3) * 0.55;
      const yaw = hashDet(i * 17.1) * Math.PI * 2;
      const inst: PropTransformInstance = { pos: [x, gy - 0.04, z], rot: [0, yaw, 0], scale: s };

      if (r > 30 || i % 4 === 0) {
        pines.push(inst);
      } else if (i % 2 === 0) {
        broads.push(inst);
      } else {
        birches.push(inst);
      }
    }

    // 4 Cedar & Cast-Iron Park Benches overlooking the lawn & lakeside boardwalk
    benchList.push(
      { pos: [8.4, 0, -2.2], rot: [0, Math.PI * 0.45, 0], scale: 1.0 },
      { pos: [8.4, 0, -8.4], rot: [0, Math.PI * 0.52, 0], scale: 1.0 },
      { pos: [-7.8, 0, -4.5], rot: [0, Math.PI * 0.35, 0], scale: 1.0 },
      { pos: [-5.5, 0, 5.2], rot: [0, Math.PI * 0.85, 0], scale: 1.0 },
    );

    // Timber Lakeside Pier & Boardwalk Decking extending over the tranquil lake (`x = 9.5..19.5m, z = -5.4m`)
    for (let p = 0; p < 16; p++) {
      const px = 9.6 + p * 0.62;
      pierList.push({ pos: [px, 0.03, -5.4], scale: [0.54, 0.06, 2.8] });
      if (p % 4 === 3) {
        pierList.push({ pos: [px, -0.35, -6.65], scale: [0.18, 0.92, 0.18], tint: "#78553a" });
        pierList.push({ pos: [px, -0.35, -4.15], scale: [0.18, 0.92, 0.18], tint: "#78553a" });
      }
    }

    // 3 Utility-Scale Wind Turbines along the distant green ridge
    const turbines: readonly { pos: [number, number, number]; yaw: number; scale: number; phase: number }[] = [
      { pos: [-24, sampleGroundY(-24, -64), -64], yaw: 0.28, scale: 1.05, phase: 0 },
      { pos: [-6, sampleGroundY(-6, -72), -72], yaw: 0.12, scale: 1.15, phase: 2.1 },
      { pos: [14, sampleGroundY(14, -68), -68], yaw: -0.18, scale: 1.0, phase: 4.2 },
    ];

    // 9 High-Altitude Sculpted Cumulus Clouds
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.25;
      const r = 42 + hashDet(i * 19.7) * 36;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const cy = 28 + hashDet(i * 29.3) * 10;
      const cs = 1.4 + hashDet(i * 6.9) * 1.1;
      cloudList.push({ pos: [cx, cy, cz], rot: [0, -a, 0], scale: cs });
    }

    return {
      broadleafTrees: broads,
      birchTrees: birches,
      pineTrees: pines,
      benches: benchList,
      turbinePlacements: turbines,
      clouds: cloudList,
      pierPlanks: pierList,
    };
  }, [sampleGroundY, plinthX, plinthZ]);

  const plankGeom = useMemo(
    () => createRoundedBoxPart(1, 1, 1, 0.08, [0, 0, 0], { color: "#c89b6e", aoStrength: 0.12 }),
    [],
  );
  useEffect(() => {
    return () => plankGeom.dispose();
  }, [plankGeom]);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const t = state.clock.elapsedTime;
    for (let i = 0; i < rotorRefs.length; i++) {
      const ref = rotorRefs[i]?.current;
      if (ref) {
        ref.rotation.z -= dt * (0.68 + i * 0.05);
      }
    }
    if (boatGroupRef.current) {
      boatGroupRef.current.position.y = -0.34 + Math.sin(t * 0.9) * 0.035;
      boatGroupRef.current.rotation.z = Math.sin(t * 0.7) * 0.022;
    }
    if (cloudsGroupRef.current) {
      cloudsGroupRef.current.rotation.y += dt * 0.004;
    }
  });

  return (
    <group name="rotunda-outdoors-props">
      {/*Panoramic 360° Horizon Foothill & Mountain Rings */}
      <mesh geometry={mountainFarGeom} raycast={NOOP_RAYCAST}>
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} fog={false} />
      </mesh>
      <mesh geometry={mountainNearGeom} raycast={NOOP_RAYCAST}>
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} fog={false} />
      </mesh>

      {/* Sculpted Multi-Species Park Trees */}
      <ArchetypeBatch geometry={broadleafGeom} instances={broadleafTrees} roughness={0.84} metalness={0.01} />
      <ArchetypeBatch geometry={birchGeom} instances={birchTrees} roughness={0.82} metalness={0.01} />
      <ArchetypeBatch geometry={pineGeom} instances={pineTrees} roughness={0.86} metalness={0.01} />

      {/* Park Benches & Cedar Lakeside Pier */}
      <ArchetypeBatch geometry={benchGeom} instances={benches} roughness={0.72} metalness={0.08} />
      <ArchetypeBatch geometry={plankGeom} instances={pierPlanks} roughness={0.78} metalness={0.02} />

      {/* 3 Large-Scale Animated Wind Turbines on the Distant Ridge */}
      {turbinePlacements.map((tb, idx) => (
        <group key={idx} position={tb.pos} rotation={[0, tb.yaw, 0]} scale={tb.scale}>
          <mesh geometry={turbineTowerGeom} raycast={NOOP_RAYCAST}>
            <meshStandardMaterial vertexColors roughness={0.42} metalness={0.14} />
          </mesh>
          <mesh
            ref={rotorRefs[idx]}
            geometry={turbineRotorGeom}
            position={[0, 22.1, 1.42]}
            rotation={[0, 0, tb.phase]}
            raycast={NOOP_RAYCAST}
          >
            <meshStandardMaterial vertexColors roughness={0.38} metalness={0.12} />
          </mesh>
        </group>
      ))}

      {/* Large Cable-Stayed Bridge Spanning the Far Lake Narrows */}
      <mesh
        geometry={bridgeGeom}
        position={[42, -0.45, -56]}
        rotation={[0, -0.38, 0]}
        scale={0.88}
        raycast={NOOP_RAYCAST}
      >
        <meshStandardMaterial vertexColors roughness={0.55} metalness={0.15} />
      </mesh>

      {/* White Geodesic Observatory Dome on the Left Bluff */}
      <mesh
        geometry={domeGeom}
        position={[-42, sampleGroundY(-42, -54) - 0.1, -54]}
        rotation={[0, 0.65, 0]}
        scale={1.05}
        raycast={NOOP_RAYCAST}
      >
        <meshStandardMaterial vertexColors roughness={0.44} metalness={0.16} />
      </mesh>

      {/* Gently Bobbing Sailboats on the Tranquil Lake */}
      <group ref={boatGroupRef} position={[0, -0.34, 0]}>
        <mesh geometry={sailboatGeom} position={[26, 0, -14]} rotation={[0, -0.62, 0]} raycast={NOOP_RAYCAST}>
          <meshStandardMaterial vertexColors roughness={0.46} metalness={0.08} />
        </mesh>
        <mesh
          geometry={sailboatGeom}
          position={[38, 0, -32]}
          rotation={[0, 0.85, 0]}
          scale={1.15}
          raycast={NOOP_RAYCAST}
        >
          <meshStandardMaterial vertexColors roughness={0.46} metalness={0.08} />
        </mesh>
      </group>

      {/* High-Altitude Soft Cumulus Clouds */}
      <group ref={cloudsGroupRef}>
        <ArchetypeBatch geometry={cloudGeom} instances={clouds} unlit opacity={0.94} />
      </group>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  3. Warehouse R&D Hangar Props — Workbenches, AGVs, Racks & Robot Cells    */
/* -------------------------------------------------------------------------- */

function createPalletRackBayGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const uprightBlue = "#1e40af";
  const beamOrange = "#ea580c";
  const wood = "#b0845c";

  for (const ux of [-1.48, 1.48]) {
    for (const uz of [-0.48, 0.48]) {
      parts.push(createRoundedBoxPart(0.09, 4.2, 0.09, 0.015, [ux, 2.1, uz], { color: uprightBlue, aoStrength: 0.28 }));
    }
  }
  const caseColors = ["#0284c7", "#eab308", "#334155", "#0f766e", "#d4a373", "#c89b6e"];
  const tiers = [0.22, 1.56, 2.9];
  tiers.forEach((sy, tIdx) => {
    parts.push(createRoundedBoxPart(3.05, 0.1, 0.07, 0.015, [0, sy, 0.48], { color: beamOrange, aoFloorY: sy - 0.05 }));
    parts.push(
      createRoundedBoxPart(3.05, 0.1, 0.07, 0.015, [0, sy, -0.48], { color: beamOrange, aoFloorY: sy - 0.05 }),
    );
    for (const slotX of [-0.74, 0.74]) {
      parts.push(createRoundedBoxPart(1.24, 0.09, 0.9, 0.015, [slotX, sy + 0.09, 0], { color: wood, aoFloorY: sy }));
      const cA = caseColors[(tIdx * 2 + (slotX > 0 ? 1 : 0)) % caseColors.length]!;
      const cB = caseColors[(tIdx * 2 + (slotX > 0 ? 3 : 2)) % caseColors.length]!;
      parts.push(
        createRoundedBoxPart(0.54, 0.42, 0.62, 0.035, [slotX - 0.28, sy + 0.35, 0], { color: cA, aoFloorY: sy + 0.12 }),
      );
      parts.push(
        createRoundedBoxPart(0.52, 0.36, 0.58, 0.035, [slotX + 0.28, sy + 0.32, 0.04], {
          color: cB,
          aoFloorY: sy + 0.12,
        }),
      );
    }
  });
  return mergePartGeometries(parts);
}

export function WarehouseEnvironmentProps(): ReactElement {
  const benchGeom = useMemo(() => createLabWorkbenchGeometry(), []);
  const agvGeom = useMemo(() => createWarehouseAgvGeometry(), []);
  const rackGeom = useMemo(() => createPalletRackBayGeometry(), []);
  const chairGeom = useMemo(() => createErgonomicTaskChairGeometry(), []);

  const leftRobotArmRef = useRef<THREE.Group | null>(null);
  const rightRobotArmRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    return () => {
      benchGeom.dispose();
      agvGeom.dispose();
      rackGeom.dispose();
      chairGeom.dispose();
    };
  }, [benchGeom, agvGeom, rackGeom, chairGeom]);

  const { benches, stools, agvs, racks } = useMemo(() => {
    const benchList: PropTransformInstance[] = [
      { pos: [-7.2, 0, -3.4], rot: [0, Math.PI / 2, 0], scale: 1.0 },
      { pos: [-7.2, 0, -7.8], rot: [0, Math.PI / 2, 0], scale: 1.0 },
      { pos: [7.2, 0, -3.4], rot: [0, -Math.PI / 2, 0], scale: 1.0 },
      { pos: [7.2, 0, -7.8], rot: [0, -Math.PI / 2, 0], scale: 1.0 },
    ];
    const stoolList: PropTransformInstance[] = [
      { pos: [-6.3, 0, -3.4], rot: [0, -Math.PI / 2 + 0.2, 0], scale: 0.95 },
      { pos: [6.3, 0, -3.4], rot: [0, Math.PI / 2 - 0.2, 0], scale: 0.95 },
    ];
    const agvList: PropTransformInstance[] = [
      { pos: [-5.8, 0, 1.6], rot: [0, 0.35, 0], scale: 1.0 },
      { pos: [5.8, 0, 1.6], rot: [0, -0.4, 0], scale: 1.0 },
      { pos: [0, 0, -16.2], rot: [0, 0, 0], scale: 1.05 },
    ];
    const rackList: PropTransformInstance[] = [
      { pos: [-9.5, 0, -12.6], rot: [0, Math.PI / 2, 0], scale: 1.0 },
      { pos: [-9.5, 0, -16.8], rot: [0, Math.PI / 2, 0], scale: 1.0 },
      { pos: [9.5, 0, -12.6], rot: [0, -Math.PI / 2, 0], scale: 1.0 },
      { pos: [9.5, 0, -16.8], rot: [0, -Math.PI / 2, 0], scale: 1.0 },
    ];
    return { benches: benchList, stools: stoolList, agvs: agvList, racks: rackList };
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (leftRobotArmRef.current) leftRobotArmRef.current.rotation.y = Math.sin(t * 0.42) * 0.38;
    if (rightRobotArmRef.current) rightRobotArmRef.current.rotation.y = Math.cos(t * 0.36) * 0.38;
  });

  return (
    <group name="rotunda-warehouse-props">
      <ArchetypeBatch geometry={benchGeom} instances={benches} roughness={0.58} metalness={0.14} />
      <ArchetypeBatch geometry={chairGeom} instances={stools} roughness={0.62} metalness={0.18} />
      <ArchetypeBatch geometry={agvGeom} instances={agvs} roughness={0.44} metalness={0.22} />
      <ArchetypeBatch geometry={rackGeom} instances={racks} roughness={0.52} metalness={0.25} />

      {/* Inductive AGV Floor Charging Pads */}
      {(
        [
          [-5.8, 1.6],
          [5.8, 1.6],
        ] as const
      ).map(([px, pz], idx) => (
        <mesh key={idx} position={[px, 0.005, pz]} rotation={[-Math.PI / 2, 0, 0]} raycast={NOOP_RAYCAST}>
          <ringGeometry args={[0.72, 0.78, 36]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.65} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}

      {/* Upstairs Glass-Walled Mezzanine Control Room & Catwalk (`z = -20.5m, y = 4.1m`) */}
      <group position={[0, 0, -20.5]}>
        {/* Mezzanine steel deck + columns */}
        <mesh position={[0, 4.0, 0]} raycast={NOOP_RAYCAST}>
          <boxGeometry args={[22.4, 0.28, 4.4]} />
          <meshStandardMaterial color="#475569" metalness={0.62} roughness={0.42} />
        </mesh>
        {[-8.5, -3.2, 3.2, 8.5].map((cx) => (
          <mesh key={cx} position={[cx, 2.0, 1.9]} raycast={NOOP_RAYCAST}>
            <cylinderGeometry args={[0.14, 0.14, 4.0, 12]} />
            <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.35} />
          </mesh>
        ))}
        {/* Safety yellow mezzanine catwalk handrail */}
        <mesh position={[0, 5.05, 2.12]} raycast={NOOP_RAYCAST}>
          <boxGeometry args={[22.2, 0.06, 0.06]} />
          <meshStandardMaterial color="#eab308" roughness={0.38} metalness={0.2} />
        </mesh>
        <mesh position={[0, 4.58, 2.12]} raycast={NOOP_RAYCAST}>
          <boxGeometry args={[22.2, 0.045, 0.045]} />
          <meshStandardMaterial color="#eab308" roughness={0.38} metalness={0.2} />
        </mesh>
        {/* Elevated Glass-Enclosed Engineering Control Room */}
        <mesh position={[0, 5.65, -0.4]} raycast={NOOP_RAYCAST}>
          <boxGeometry args={[12.8, 3.0, 3.2]} />
          <meshStandardMaterial color="#1e293b" roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[0, 5.65, 1.22]} raycast={NOOP_RAYCAST}>
          <planeGeometry args={[11.8, 2.2]} />
          <meshBasicMaterial color="#dbeafe" transparent opacity={0.42} toneMapped={false} />
        </mesh>
        {/* Warm interior control-room ceiling glow */}
        <mesh position={[0, 6.55, 0.6]} raycast={NOOP_RAYCAST}>
          <boxGeometry args={[10.4, 0.08, 0.8]} />
          <meshBasicMaterial color="#fffbeb" toneMapped={false} />
        </mesh>
      </group>

      {/* Overhead Yellow Double-Girder Bridge Crane */}
      <group position={[0, 7.05, -9.8]}>
        <mesh position={[0, 0, -0.45]} raycast={NOOP_RAYCAST}>
          <boxGeometry args={[22.2, 0.42, 0.32]} />
          <meshStandardMaterial color="#eab308" roughness={0.38} metalness={0.28} />
        </mesh>
        <mesh position={[0, 0, 0.45]} raycast={NOOP_RAYCAST}>
          <boxGeometry args={[22.2, 0.42, 0.32]} />
          <meshStandardMaterial color="#eab308" roughness={0.38} metalness={0.28} />
        </mesh>
        <mesh position={[2.6, -0.35, 0]} raycast={NOOP_RAYCAST}>
          <boxGeometry args={[1.3, 0.38, 1.35]} />
          <meshStandardMaterial color="#334155" roughness={0.4} metalness={0.65} />
        </mesh>
      </group>

      {/* 2 Articulated 6-Axis Orange Industrial Robot Arms in Rear Assembly Cells */}
      {(
        [
          [-5.6, -13.4, leftRobotArmRef],
          [5.6, -13.4, rightRobotArmRef],
        ] as const
      ).map(([rx, rz, armRef], idx) => (
        <group key={idx} position={[rx, 0, rz]}>
          <mesh position={[0, 0.28, 0]} raycast={NOOP_RAYCAST}>
            <cylinderGeometry args={[0.52, 0.6, 0.56, 18]} />
            <meshStandardMaterial color="#334155" metalness={0.62} roughness={0.38} />
          </mesh>
          <group ref={armRef} position={[0, 0.56, 0]}>
            <mesh position={[0, 0.42, 0]} raycast={NOOP_RAYCAST}>
              <cylinderGeometry args={[0.24, 0.28, 0.84, 16]} />
              <meshStandardMaterial color="#ea580c" roughness={0.34} metalness={0.24} />
            </mesh>
            <mesh position={[0, 1.38, 0.18]} rotation={[0.28, 0, 0]} raycast={NOOP_RAYCAST}>
              <cylinderGeometry args={[0.14, 0.18, 1.48, 14]} />
              <meshStandardMaterial color="#f97316" roughness={0.34} metalness={0.24} />
            </mesh>
            <mesh position={[0, 2.02, 0.82]} rotation={[1.22, 0, 0]} raycast={NOOP_RAYCAST}>
              <cylinderGeometry args={[0.11, 0.14, 1.15, 14]} />
              <meshStandardMaterial color="#ea580c" roughness={0.34} metalness={0.24} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  4. Office Studio Props — Cubicles, Glass Conference/Manager Rooms & Trees */
/* -------------------------------------------------------------------------- */

function createBookshelfUnitGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const frame = "#334155";
  const walnut = "#9c7350";
  const bookPalette = ["#0284c7", "#ef4444", "#10b981", "#f59e0b", "#6366f1", "#ec4899"];

  parts.push(createRoundedBoxPart(0.055, 2.45, 0.4, 0.014, [-0.78, 1.225, 0], { color: frame, aoStrength: 0.28 }));
  parts.push(createRoundedBoxPart(0.055, 2.45, 0.4, 0.014, [0.78, 1.225, 0], { color: frame, aoStrength: 0.28 }));
  for (let t = 0; t < 5; t++) {
    const ty = 0.2 + t * 0.52;
    parts.push(createRoundedBoxPart(1.58, 0.04, 0.4, 0.014, [0, ty, 0], { color: walnut, aoFloorY: ty - 0.04 }));
    for (let b = 0; b < 5; b++) {
      const bx = -0.54 + b * 0.27;
      const bh = 0.22 + ((t * 3 + b * 7) % 5) * 0.032;
      parts.push(
        createRoundedBoxPart(0.16, bh, 0.25, 0.012, [bx, ty + 0.02 + bh * 0.5, 0], {
          color: bookPalette[(t + b) % bookPalette.length]!,
          aoFloorY: ty,
        }),
      );
    }
  }
  return mergePartGeometries(parts);
}

export function OfficeEnvironmentProps(): ReactElement {
  const cubicleGeom = useMemo(() => createOfficeCubiclePodGeometry(), []);
  const chairGeom = useMemo(() => createErgonomicTaskChairGeometry(), []);
  const confTableGeom = useMemo(() => createConferenceTableGeometry(), []);
  const coolerGeom = useMemo(() => createOfficeWaterCoolerGeometry(), []);
  const credenzaGeom = useMemo(() => createPavilionCredenzaGeometry(), []);
  const planterGeom = useMemo(() => createPottedIndoorTreeGeometry(), []);
  const shelfGeom = useMemo(() => createBookshelfUnitGeometry(), []);
  const courtyardTreeGeom = useMemo(() => createParkBroadleafTreeGeometry(), []);
  const courtyardBirchGeom = useMemo(() => createSilverBirchTreeGeometry(), []);

  const whiteboardTex = useMemo(() => createDisplayBoardTexture("office-whiteboard"), []);
  const confScreenTex = useMemo(() => createDisplayBoardTexture("conference-screen"), []);

  useEffect(() => {
    return () => {
      cubicleGeom.dispose();
      chairGeom.dispose();
      confTableGeom.dispose();
      coolerGeom.dispose();
      credenzaGeom.dispose();
      planterGeom.dispose();
      shelfGeom.dispose();
      courtyardTreeGeom.dispose();
      courtyardBirchGeom.dispose();
      whiteboardTex?.dispose();
      confScreenTex?.dispose();
    };
  }, [
    cubicleGeom,
    chairGeom,
    confTableGeom,
    coolerGeom,
    credenzaGeom,
    planterGeom,
    shelfGeom,
    courtyardTreeGeom,
    courtyardBirchGeom,
    whiteboardTex,
    confScreenTex,
  ]);

  const { cubicles, chairs, planters, shelves, outdoorTrees, outdoorBirches } = useMemo(() => {
    // 6 Sculpted L-Shaped Cubicle Pods arranged in left & right engineering bullpen clusters
    const cubList: PropTransformInstance[] = [
      { pos: [-6.6, 0, -4.4], rot: [0, Math.PI / 2, 0] },
      { pos: [-6.6, 0, -0.8], rot: [0, Math.PI / 2, 0] },
      { pos: [-6.6, 0, 2.8], rot: [0, Math.PI / 2, 0] },
      { pos: [6.6, 0, -4.4], rot: [0, -Math.PI / 2, 0] },
      { pos: [6.6, 0, -0.8], rot: [0, -Math.PI / 2, 0] },
      { pos: [6.6, 0, 2.8], rot: [0, -Math.PI / 2, 0] },
    ];

    // Ergonomic Swivel Chairs: 6 in cubicles + 6 around the Glass Conference Room Table + 1 in Manager's Office
    const chairList: PropTransformInstance[] = [
      // Cubicle chairs
      { pos: [-6.15, 0, -4.4], rot: [0, -Math.PI / 2 + 0.18, 0] },
      { pos: [-6.15, 0, -0.8], rot: [0, -Math.PI / 2 - 0.14, 0] },
      { pos: [-6.15, 0, 2.8], rot: [0, -Math.PI / 2 + 0.1, 0] },
      { pos: [6.15, 0, -4.4], rot: [0, Math.PI / 2 - 0.18, 0] },
      { pos: [6.15, 0, -0.8], rot: [0, Math.PI / 2 + 0.12, 0] },
      { pos: [6.15, 0, 2.8], rot: [0, Math.PI / 2 - 0.1, 0] },
      // Conference Room (-4.6, -10.8) 6 chairs facing walnut boat table
      { pos: [-5.7, 0, -9.95], rot: [0, Math.PI, 0] },
      { pos: [-4.6, 0, -9.95], rot: [0, Math.PI, 0] },
      { pos: [-3.5, 0, -9.95], rot: [0, Math.PI, 0] },
      { pos: [-5.7, 0, -11.65], rot: [0, 0, 0] },
      { pos: [-4.6, 0, -11.65], rot: [0, 0, 0] },
      { pos: [-3.5, 0, -11.65], rot: [0, 0, 0] },
      // Principal Engineer Office (+5.0, -10.8) executive chair + guest chair
      { pos: [5.4, 0, -11.4], rot: [0, 0.25, 0] },
      { pos: [4.5, 0, -9.8], rot: [0, Math.PI - 0.2, 0] },
    ];

    const planterList: PropTransformInstance[] = [
      { pos: [-4.2, 0, -6.8], scale: 0.96 },
      { pos: [4.2, 0, -6.8], scale: 0.96 },
      { pos: [-8.2, 0, -6.8], scale: 1.04 },
      { pos: [8.2, 0, -6.8], scale: 1.04 },
      { pos: [-4.6, 0, 5.2], scale: 1.0 },
      { pos: [4.6, 0, 5.2], scale: 1.0 },
    ];

    const shelfList: PropTransformInstance[] = [
      { pos: [7.6, 0, -12.6], rot: [0, 0, 0] },
      { pos: [5.6, 0, -12.6], rot: [0, 0, 0] },
      { pos: [-8.4, 0, 5.6], rot: [0, Math.PI / 2, 0] },
    ];

    // Exterior Campus Courtyard Trees visible right outside the left & right floor-to-ceiling windows
    const extTrees: PropTransformInstance[] = [
      { pos: [-14.2, -0.1, -6.5], rot: [0, 0.5, 0], scale: 1.15 },
      { pos: [-15.4, -0.1, 0.8], rot: [0, 2.1, 0], scale: 1.05 },
      { pos: [14.2, -0.1, -6.5], rot: [0, -0.6, 0], scale: 1.15 },
      { pos: [15.4, -0.1, 0.8], rot: [0, -2.0, 0], scale: 1.05 },
    ];
    const extBirches: PropTransformInstance[] = [
      { pos: [-13.6, -0.1, -2.8], rot: [0, 1.1, 0], scale: 1.05 },
      { pos: [-14.8, -0.1, 4.4], rot: [0, 0.3, 0], scale: 0.98 },
      { pos: [13.6, -0.1, -2.8], rot: [0, -1.2, 0], scale: 1.05 },
      { pos: [14.8, -0.1, 4.4], rot: [0, -0.4, 0], scale: 0.98 },
    ];

    return {
      cubicles: cubList,
      chairs: chairList,
      planters: planterList,
      shelves: shelfList,
      outdoorTrees: extTrees,
      outdoorBirches: extBirches,
    };
  }, []);

  return (
    <group name="rotunda-office-props">
      {/* Central Warm Acoustic Carpet-Tile Collaboration Zone under the User & Stage */}
      <mesh position={[0, 0.003, -2.2]} rotation={[-Math.PI / 2, 0, 0]} raycast={NOOP_RAYCAST}>
        <planeGeometry args={[8.4, 9.2]} />
        <meshStandardMaterial color="#ddd8cf" roughness={0.95} metalness={0} />
      </mesh>

      {/* Cubicle Bullpen + Chairs + Planters + Bookshelves */}
      <ArchetypeBatch geometry={cubicleGeom} instances={cubicles} roughness={0.74} metalness={0.06} />
      <ArchetypeBatch geometry={chairGeom} instances={chairs} roughness={0.64} metalness={0.18} />
      <ArchetypeBatch geometry={planterGeom} instances={planters} roughness={0.78} metalness={0.02} />
      <ArchetypeBatch geometry={shelfGeom} instances={shelves} roughness={0.68} metalness={0.08} />

      {/* Break Nook (Center Rear Corridor between Conference Room & Principal Office): Water Cooler + Espresso Bar */}
      <mesh geometry={coolerGeom} position={[-0.85, 0, -11.8]} raycast={NOOP_RAYCAST}>
        <meshStandardMaterial vertexColors roughness={0.42} metalness={0.08} />
      </mesh>
      <mesh geometry={credenzaGeom} position={[0.95, 0, -12.2]} scale={0.78} raycast={NOOP_RAYCAST}>
        <meshStandardMaterial vertexColors roughness={0.54} metalness={0.12} />
      </mesh>

      {/* ── Glass-Walled Conference Room (Rear-Left: x = -8.8..-1.4, z = -13.0..-8.4) ── */}
      <group name="office-glass-conference-room">
        {/* Boat-shaped Walnut Conference Table */}
        <mesh geometry={confTableGeom} position={[-4.6, 0, -10.8]} raycast={NOOP_RAYCAST}>
          <meshStandardMaterial vertexColors roughness={0.5} metalness={0.08} />
        </mesh>
        {/* Front Glass Partition Wall + Mullions + Frosted Privacy Band (`z = -8.4m`) */}
        <mesh position={[-5.6, 1.85, -8.4]} raycast={NOOP_RAYCAST}>
          <planeGeometry args={[5.6, 3.7]} />
          <meshBasicMaterial color="#e0f2fe" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh position={[-5.6, 1.25, -8.395]} raycast={NOOP_RAYCAST}>
          <planeGeometry args={[5.6, 0.42]} />
          <meshBasicMaterial color="#f8fafc" transparent opacity={0.52} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {/* Dark anodized glass-room framing + open glass door leaf */}
        <mesh position={[-5.1, 3.72, -8.4]} raycast={NOOP_RAYCAST}>
          <boxGeometry args={[7.4, 0.08, 0.08]} />
          <meshStandardMaterial color="#334155" metalness={0.72} roughness={0.32} />
        </mesh>
        {[-8.8, -5.8, -2.8, -1.4].map((mx) => (
          <mesh key={mx} position={[mx, 1.85, -8.4]} raycast={NOOP_RAYCAST}>
            <boxGeometry args={[0.06, 3.7, 0.08]} />
            <meshStandardMaterial color="#334155" metalness={0.72} roughness={0.32} />
          </mesh>
        ))}
        {/* Side glass divider wall (`x = -1.4m`) */}
        <mesh position={[-1.4, 1.85, -10.7]} rotation={[0, Math.PI / 2, 0]} raycast={NOOP_RAYCAST}>
          <planeGeometry args={[4.6, 3.7]} />
          <meshBasicMaterial color="#e0f2fe" transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {/* Wall-mounted 85" Presentation Display on rear conference wall */}
        {confScreenTex && (
          <group position={[-4.6, 1.85, -12.88]}>
            <mesh raycast={NOOP_RAYCAST}>
              <boxGeometry args={[2.35, 1.32, 0.05]} />
              <meshStandardMaterial color="#0f172a" roughness={0.35} metalness={0.5} />
            </mesh>
            <mesh position={[0, 0, 0.03]} raycast={NOOP_RAYCAST}>
              <planeGeometry args={[2.24, 1.22]} />
              <meshBasicMaterial map={confScreenTex} toneMapped={false} />
            </mesh>
          </group>
        )}
      </group>

      {/* ── Glass-Walled Principal Engineer Office (Rear-Right: x = +2.4..+8.8, z = -13.0..-8.4) ── */}
      <group name="office-glass-manager-room">
        {/* Executive Desk inside glass office */}
        <mesh geometry={cubicleGeom} position={[5.4, 0, -10.6]} rotation={[0, Math.PI, 0]} raycast={NOOP_RAYCAST}>
          <meshStandardMaterial vertexColors roughness={0.72} metalness={0.06} />
        </mesh>
        {/* Front Glass Wall + Mullions + Doorway (`z = -8.4m`) */}
        <mesh position={[6.1, 1.85, -8.4]} raycast={NOOP_RAYCAST}>
          <planeGeometry args={[5.4, 3.7]} />
          <meshBasicMaterial color="#e0f2fe" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh position={[6.1, 1.25, -8.395]} raycast={NOOP_RAYCAST}>
          <planeGeometry args={[5.4, 0.42]} />
          <meshBasicMaterial color="#f8fafc" transparent opacity={0.52} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh position={[5.6, 3.72, -8.4]} raycast={NOOP_RAYCAST}>
          <boxGeometry args={[6.4, 0.08, 0.08]} />
          <meshStandardMaterial color="#334155" metalness={0.72} roughness={0.32} />
        </mesh>
        {[2.4, 3.4, 6.2, 8.8].map((mx) => (
          <mesh key={mx} position={[mx, 1.85, -8.4]} raycast={NOOP_RAYCAST}>
            <boxGeometry args={[0.06, 3.7, 0.08]} />
            <meshStandardMaterial color="#334155" metalness={0.72} roughness={0.32} />
          </mesh>
        ))}
        {/* Rolling Studio Whiteboard */}
        {whiteboardTex && (
          <group position={[2.8, 1.48, -6.2]} rotation={[0, -0.35, 0]}>
            <mesh raycast={NOOP_RAYCAST}>
              <boxGeometry args={[1.88, 1.08, 0.05]} />
              <meshStandardMaterial color="#94a3b8" roughness={0.36} metalness={0.55} />
            </mesh>
            <mesh position={[0, 0, 0.03]} raycast={NOOP_RAYCAST}>
              <planeGeometry args={[1.78, 0.98]} />
              <meshBasicMaterial map={whiteboardTex} toneMapped={false} />
            </mesh>
          </group>
        )}
      </group>

      {/* Exterior Sunlit Campus Lawn & Sculpted Trees visible outside Left & Right Curtain-Wall Windows */}
      {[-15.5, 15.5].map((gx) => (
        <mesh key={gx} position={[gx, -0.05, -2.5]} rotation={[-Math.PI / 2, 0, 0]} raycast={NOOP_RAYCAST}>
          <planeGeometry args={[12, 26]} />
          <meshStandardMaterial color="#7da868" roughness={0.92} metalness={0} />
        </mesh>
      ))}
      <ArchetypeBatch geometry={courtyardTreeGeom} instances={outdoorTrees} roughness={0.85} metalness={0.01} />
      <ArchetypeBatch geometry={courtyardBirchGeom} instances={outdoorBirches} roughness={0.82} metalness={0.01} />
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  5. Dark Lab Props — Acoustic Theater, Glass Control Booth & Scope Benches */
/* -------------------------------------------------------------------------- */

function createServerCabinetGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(createRoundedBoxPart(0.88, 2.48, 0.92, 0.04, [0, 1.24, 0], { color: "#111827", aoStrength: 0.3 }));
  parts.push(createRoundedBoxPart(0.8, 2.34, 0.04, 0.02, [0, 1.24, 0.45], { color: "#1e293b", aoFloorY: 0.1 }));
  return mergePartGeometries(parts);
}

export function DarkLabEnvironmentProps(): ReactElement {
  const rackGeom = useMemo(() => createServerCabinetGeometry(), []);
  const benchGeom = useMemo(() => createLabWorkbenchGeometry(), []);
  const chairGeom = useMemo(() => createErgonomicTaskChairGeometry(), []);
  const ledGeom = useMemo(
    () => createRoundedBoxPart(0.62, 0.024, 0.016, 0.006, [0, 0, 0], { color: "#38bdf8", aoStrength: 0 }),
    [],
  );

  useEffect(() => {
    return () => {
      rackGeom.dispose();
      benchGeom.dispose();
      chairGeom.dispose();
      ledGeom.dispose();
    };
  }, [rackGeom, benchGeom, chairGeom, ledGeom]);

  const { racks, leds, benches, chairs } = useMemo(() => {
    const rackList: PropTransformInstance[] = [];
    const ledList: PropTransformInstance[] = [];
    const rackAngles = [-2.45, -2.18, -1.9, -0.95, -0.68, -0.4, 2.45, 2.72];
    const ledColors = ["#38bdf8", "#22d3ee", "#818cf8", "#34d399"];

    rackAngles.forEach((a, idx) => {
      const r = 9.2;
      const x = Math.cos(a) * r;
      const z = -2.0 + Math.sin(a) * r;
      const yaw = Math.atan2(-x, -2.0 - z);
      rackList.push({ pos: [x, 0, z], rot: [0, yaw, 0] });
      for (let row = 0; row < 5; row++) {
        const ly = 0.52 + row * 0.4;
        ledList.push({
          pos: [x + Math.sin(yaw) * 0.48, ly, z + Math.cos(yaw) * 0.48],
          rot: [0, yaw, 0],
          tint: ledColors[(idx + row) % ledColors.length],
        });
      }
    });

    const benchList: PropTransformInstance[] = [
      { pos: [-5.8, 0, -4.6], rot: [0, Math.PI * 0.35, 0], tint: "#94a3b8" },
      { pos: [5.8, 0, -4.6], rot: [0, -Math.PI * 0.35, 0], tint: "#94a3b8" },
    ];
    const chairList: PropTransformInstance[] = [
      { pos: [-5.1, 0, -4.1], rot: [0, -Math.PI * 0.65, 0] },
      { pos: [5.1, 0, -4.1], rot: [0, Math.PI * 0.65, 0] },
    ];

    return { racks: rackList, leds: ledList, benches: benchList, chairs: chairList };
  }, []);

  return (
    <group name="rotunda-darklab-props">
      <ArchetypeBatch geometry={rackGeom} instances={racks} roughness={0.38} metalness={0.65} />
      <ArchetypeBatch geometry={ledGeom} instances={leds} unlit />
      <ArchetypeBatch geometry={benchGeom} instances={benches} roughness={0.46} metalness={0.38} />
      <ArchetypeBatch geometry={chairGeom} instances={chairs} roughness={0.55} metalness={0.28} />

      {/* Rear Darkened Glass Telemetry Control Booth Window (`z = -12.6m`) */}
      <group position={[0, 2.1, -12.6]}>
        <mesh raycast={NOOP_RAYCAST}>
          <boxGeometry args={[10.4, 3.8, 0.36]} />
          <meshStandardMaterial color="#0f172a" roughness={0.48} metalness={0.55} />
        </mesh>
        <mesh position={[0, 0.15, 0.2]} raycast={NOOP_RAYCAST}>
          <planeGeometry args={[9.2, 2.2]} />
          <meshBasicMaterial color="#0ea5e9" transparent opacity={0.14} toneMapped={false} />
        </mesh>
        <mesh position={[0, 1.26, 0.21]} raycast={NOOP_RAYCAST}>
          <boxGeometry args={[9.2, 0.025, 0.02]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.55} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
