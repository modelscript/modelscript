// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";

const NOOP_RAYCAST: THREE.Object3D["raycast"] = () => {};

interface PropInstance {
  readonly pos: readonly [number, number, number];
  readonly rot?: readonly [number, number, number] | undefined;
  readonly scale: readonly [number, number, number];
  readonly color: string;
}

interface InstancedBatchProps {
  geometry: THREE.BufferGeometry;
  instances: readonly PropInstance[];
  roughness?: number | undefined;
  metalness?: number | undefined;
  unlit?: boolean | undefined;
  opacity?: number | undefined;
}

/**
 * Single-draw-call `THREE.InstancedMesh` batch with per-instance color tinting and
 * `NOOP_RAYCAST` so rich Job-Simulator faux-realism background dressing costs near-zero
 * GPU & raycasting overhead on Meta Quest 2.
 */
function InstancedBatch({
  geometry,
  instances,
  roughness = 0.62,
  metalness = 0.08,
  unlit = false,
  opacity = 1,
}: InstancedBatchProps): ReactElement | null {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);

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
      dummy.scale.set(inst.scale[0], inst.scale[1], inst.scale[2]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.set(inst.color);
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
          toneMapped={false}
          transparent={opacity < 1}
          opacity={opacity}
          depthWrite={opacity >= 1}
        />
      ) : (
        <meshStandardMaterial
          color="#ffffff"
          roughness={roughness}
          metalness={metalness}
          transparent={opacity < 1}
          opacity={opacity}
        />
      )}
    </instancedMesh>
  );
}

/** Allocates shared unit primitive geometries for an environment prop suite and disposes them cleanly. */
function usePropUnitGeometries(): {
  box: THREE.BoxGeometry;
  cyl: THREE.CylinderGeometry;
  cone: THREE.ConeGeometry;
  sphere: THREE.IcosahedronGeometry;
} {
  const geoms = useMemo(
    () => ({
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
      cone: new THREE.ConeGeometry(0.5, 1, 8),
      sphere: new THREE.IcosahedronGeometry(0.5, 1),
    }),
    [],
  );

  useEffect(() => {
    return () => {
      geoms.box.dispose();
      geoms.cyl.dispose();
      geoms.cone.dispose();
      geoms.sphere.dispose();
    };
  }, [geoms]);

  return geoms;
}

function hashDet(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Procedural blueprint/whiteboard display texture painted once (SSR/JSDOM safe). */
function createDisplayBoardTexture(style: "atrium-kiosk" | "office-whiteboard"): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (style === "atrium-kiosk") {
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#0b3662");
    grad.addColorStop(1, "#082544");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);

    // Subtle blueprint grid
    ctx.strokeStyle = "rgba(125, 211, 252, 0.16)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= 512; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 256);
      ctx.stroke();
    }
    for (let y = 0; y <= 256; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }

    // Outer technical border
    ctx.strokeStyle = "#7dd3fc";
    ctx.lineWidth = 3;
    ctx.strokeRect(12, 12, 488, 232);

    // Left stylized exploded rotor blueprint
    ctx.strokeStyle = "#e0f2fe";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(130, 128, 62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(130, 128, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(52, 128);
    ctx.lineTo(208, 128);
    ctx.moveTo(130, 52);
    ctx.lineTo(130, 204);
    ctx.stroke();

    // Right system block diagram + live waveform
    const blocks: readonly [number, number, number, number, string][] = [
      [246, 44, 74, 42, "#38bdf8"],
      [348, 44, 74, 42, "#22d3ee"],
      [296, 110, 96, 42, "#f59e0b"],
    ];
    for (const [bx, by, bw, bh, col] of blocks) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(bx, by, bw, bh);
    }
    ctx.strokeStyle = "#e0f2fe";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(320, 65);
    ctx.lineTo(348, 65);
    ctx.moveTo(385, 86);
    ctx.lineTo(385, 110);
    ctx.stroke();

    // Bottom oscilloscope wave
    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 246; x <= 474; x += 6) {
      const t = (x - 246) / 228;
      const y = 198 + Math.sin(t * Math.PI * 6) * 20 * Math.exp(-t * 1.1);
      if (x === 246) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else {
    // Bright dry-erase studio whiteboard with colorful block diagram & sticky notes
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 500, 244);

    // Marker schematic boxes
    const boxes: readonly [number, number, number, number, string][] = [
      [34, 42, 108, 56, "#0284c7"],
      [184, 42, 118, 56, "#059669"],
      [112, 138, 128, 58, "#ea580c"],
    ];
    for (const [bx, by, bw, bh, col] of boxes) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 4;
      ctx.strokeRect(bx, by, bw, bh);
    }
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(142, 70);
    ctx.lineTo(184, 70);
    ctx.moveTo(243, 98);
    ctx.lineTo(243, 166);
    ctx.lineTo(240, 166);
    ctx.stroke();

    // Colorful sticky notes clustered on right side
    const stickies: readonly [number, number, string][] = [
      [344, 34, "#fef08a"],
      [414, 42, "#fbcfe8"],
      [356, 108, "#bae6fd"],
      [424, 114, "#bbf7d0"],
      [372, 178, "#fed7aa"],
    ];
    for (const [sx, sy, col] of stickies) {
      ctx.fillStyle = col;
      ctx.fillRect(sx, sy, 56, 52);
      ctx.fillStyle = "rgba(15, 23, 42, 0.25)";
      ctx.fillRect(sx + 8, sy + 14, 38, 4);
      ctx.fillRect(sx + 8, sy + 26, 28, 4);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* -------------------------------------------------------------------------- */
/*  1. Future Atrium Props — Planters, Lounge Benches, Lightbox Kiosks        */
/* -------------------------------------------------------------------------- */

const ATRIUM_CENTER_Z = -3.2;

export function AtriumEnvironmentProps(): ReactElement {
  const geoms = usePropUnitGeometries();
  const kioskTex = useMemo(() => createDisplayBoardTexture("atrium-kiosk"), []);

  useEffect(() => {
    return () => {
      kioskTex?.dispose();
    };
  }, [kioskTex]);

  const { matteBoxes, matteCyls, foliageSpheres, metalBoxes, unlitOrbs, kiosks } = useMemo(() => {
    const boxes: PropInstance[] = [];
    const cyls: PropInstance[] = [];
    const spheres: PropInstance[] = [];
    const metals: PropInstance[] = [];
    const orbs: PropInstance[] = [];
    const kioskList: { pos: [number, number, number]; yaw: number }[] = [];

    // 10 Architectural Potted Olive/Ficus Trees ringing the curved atrium glass
    const planterCount = 10;
    for (let i = 0; i < planterCount; i++) {
      const a = (i / planterCount) * Math.PI * 2 + 0.16;
      const r = 12.1;
      const x = Math.cos(a) * r;
      const z = ATRIUM_CENTER_Z + Math.sin(a) * r;
      // Ribbed architectural terrazzo planter pot
      cyls.push({ pos: [x, 0.36, z], scale: [0.88, 0.72, 0.88], color: i % 2 === 0 ? "#e2e8f0" : "#d6c7b2" });
      // Dark soil disc
      cyls.push({ pos: [x, 0.73, z], scale: [0.76, 0.04, 0.76], color: "#4a3b32" });
      // Warm sculpted oak trunk
      cyls.push({ pos: [x, 1.38, z], scale: [0.13, 1.35, 0.13], color: "#7c5838" });
      // 3-cluster stylized Job-Simulator foliage canopy
      const leafTones = ["#3f7d58", "#52946b", "#68ab7d"];
      spheres.push({ pos: [x, 2.35, z], scale: [1.18, 0.96, 1.18], color: leafTones[0]! });
      spheres.push({ pos: [x + 0.38, 2.02, z - 0.22], scale: [0.84, 0.72, 0.84], color: leafTones[1]! });
      spheres.push({ pos: [x - 0.34, 2.12, z + 0.28], scale: [0.78, 0.68, 0.78], color: leafTones[2]! });
    }

    // 6 Sleek Lounge Benches + Side Tables with Ceramic Coffee Mugs & Rolled Blueprints
    const benchCount = 6;
    const mugColors = ["#38bdf8", "#f97316", "#10b981", "#eab308", "#8b5cf6", "#ef4444"];
    for (let i = 0; i < benchCount; i++) {
      const a = (i / benchCount) * Math.PI * 2 + Math.PI / 6;
      const r = 10.2;
      const x = Math.cos(a) * r;
      const z = ATRIUM_CENTER_Z + Math.sin(a) * r;
      const yaw = Math.atan2(-x, ATRIUM_CENTER_Z - z);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);

      // Slatted oak bench seat + backrest
      boxes.push({ pos: [x, 0.46, z], rot: [0, yaw, 0], scale: [1.85, 0.1, 0.62], color: "#d6b084" });
      boxes.push({
        pos: [x - sin * 0.26, 0.76, z - cos * 0.26],
        rot: [0.14, yaw, 0],
        scale: [1.85, 0.42, 0.08],
        color: "#c89f72",
      });
      // Brushed aluminum bench legs
      metals.push({
        pos: [x + cos * 0.72, 0.22, z - sin * 0.72],
        rot: [0, yaw, 0],
        scale: [0.08, 0.44, 0.54],
        color: "#64748b",
      });
      metals.push({
        pos: [x - cos * 0.72, 0.22, z + sin * 0.72],
        rot: [0, yaw, 0],
        scale: [0.08, 0.44, 0.54],
        color: "#64748b",
      });

      // Side coffee table next to each bench
      const tx = x + cos * 1.42;
      const tz = z - sin * 1.42;
      cyls.push({ pos: [tx, 0.54, tz], scale: [0.68, 0.05, 0.68], color: "#f1f5f9" });
      cyls.push({ pos: [tx, 0.27, tz], scale: [0.08, 0.52, 0.08], color: "#64748b" });
      // Coffee mug + rolled blue blueprint scroll on table
      cyls.push({
        pos: [tx + 0.1, 0.62, tz + 0.06],
        scale: [0.09, 0.11, 0.09],
        color: mugColors[i % mugColors.length]!,
      });
      cyls.push({
        pos: [tx - 0.1, 0.6, tz - 0.06],
        rot: [0, yaw + 0.4, Math.PI / 2],
        scale: [0.06, 0.34, 0.06],
        color: "#0ea5e9",
      });
    }

    // 6 Brushed-Aluminum Holographic Blueprint Kiosk Easels around outer rim
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.52;
      const r = 13.0;
      const x = Math.cos(a) * r;
      const z = ATRIUM_CENTER_Z + Math.sin(a) * r;
      const yaw = Math.atan2(-x, ATRIUM_CENTER_Z - z);
      kioskList.push({ pos: [x, 1.55, z], yaw });
      // Base pedestal & vertical aluminum pylon
      metals.push({ pos: [x, 0.06, z], rot: [0, yaw, 0], scale: [1.35, 0.12, 0.56], color: "#94a3b8" });
      metals.push({ pos: [x, 0.85, z], rot: [0, yaw, 0], scale: [0.22, 1.5, 0.14], color: "#cbd5e1" });
      metals.push({ pos: [x, 1.55, z], rot: [0, yaw, 0], scale: [1.96, 1.12, 0.08], color: "#64748b" });
    }

    // 12 Suspended Architectural Pendant Light Orbs ringing the gallery
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 11.2;
      const x = Math.cos(a) * r;
      const z = ATRIUM_CENTER_Z + Math.sin(a) * r;
      metals.push({ pos: [x, 8.2, z], scale: [0.025, 3.6, 0.025], color: "#94a3b8" });
      orbs.push({ pos: [x, 6.35, z], scale: [0.32, 0.32, 0.32], color: "#fffbeb" });
    }

    return {
      matteBoxes: boxes,
      matteCyls: cyls,
      foliageSpheres: spheres,
      metalBoxes: metals,
      unlitOrbs: orbs,
      kiosks: kioskList,
    };
  }, []);

  return (
    <group name="rotunda-atrium-props">
      <InstancedBatch geometry={geoms.box} instances={matteBoxes} roughness={0.72} metalness={0.04} />
      <InstancedBatch geometry={geoms.cyl} instances={matteCyls} roughness={0.68} metalness={0.06} />
      <InstancedBatch geometry={geoms.sphere} instances={foliageSpheres} roughness={0.82} metalness={0.02} />
      <InstancedBatch geometry={geoms.box} instances={metalBoxes} roughness={0.32} metalness={0.78} />
      <InstancedBatch geometry={geoms.sphere} instances={unlitOrbs} unlit />

      {/* 6 Glowing Cyanotype Blueprint Kiosk Displays (shared CanvasTexture) */}
      {kioskTex &&
        kiosks.map((k, idx) => (
          <mesh
            key={idx}
            position={[k.pos[0] + Math.sin(k.yaw) * 0.046, k.pos[1], k.pos[2] + Math.cos(k.yaw) * 0.046]}
            rotation={[0, k.yaw, 0]}
            raycast={NOOP_RAYCAST}
          >
            <planeGeometry args={[1.82, 0.96]} />
            <meshBasicMaterial map={kioskTex} toneMapped={false} />
          </mesh>
        ))}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  2. Outdoors Meadow Props — Trees, Fence, Benches, Survey Tripods, Clouds  */
/* -------------------------------------------------------------------------- */

export interface OutdoorsEnvironmentPropsArgs {
  sampleGroundY: (x: number, z: number) => number;
  plinthX: number;
  plinthZ: number;
}

export function OutdoorsEnvironmentProps({
  sampleGroundY,
  plinthX,
  plinthZ,
}: OutdoorsEnvironmentPropsArgs): ReactElement {
  const geoms = usePropUnitGeometries();
  const anemometerRef = useRef<THREE.Group | null>(null);
  const cloudsGroupRef = useRef<THREE.Group | null>(null);

  const { trunks, pineCones, leafSpheres, woodBoxes, boulders, metalCyls, clouds, mastPos } = useMemo(() => {
    const trunkList: PropInstance[] = [];
    const coneList: PropInstance[] = [];
    const leafList: PropInstance[] = [];
    const boxList: PropInstance[] = [];
    const rockList: PropInstance[] = [];
    const metalList: PropInstance[] = [];
    const cloudList: PropInstance[] = [];

    const pineShades = ["#2d6a4f", "#3a7d44", "#40916c", "#2b5d44"];
    const oakShades = ["#52b788", "#6ca956", "#7eb85d", "#8ab84e"];

    // 42 Stylized Job-Simulator Pine & Broadleaf Trees grounded directly onto rolling hills
    for (let i = 0; i < 42; i++) {
      const a = (i / 42) * Math.PI * 2 + (hashDet(i * 3.1) - 0.5) * 0.14;
      const r = 9.4 + hashDet(i * 7.3) * 20.5;
      const x = plinthX + Math.cos(a) * r;
      const z = plinthZ + Math.sin(a) * r;
      // Keep direct behind-user entry zone slightly wider
      if (Math.hypot(x, z) < 7.2) continue;
      const gy = sampleGroundY(x, z);
      const hScale = 0.8 + hashDet(i * 11.7) * 0.85;

      if (i % 3 !== 0) {
        // 3-tier alpine pine
        const trunkH = 1.15 * hScale;
        trunkList.push({
          pos: [x, gy + trunkH * 0.5, z],
          scale: [0.34 * hScale, trunkH, 0.34 * hScale],
          color: "#6f4e37",
        });
        const baseShade = pineShades[i % pineShades.length]!;
        coneList.push({
          pos: [x, gy + trunkH + 0.72 * hScale, z],
          scale: [2.1 * hScale, 1.85 * hScale, 2.1 * hScale],
          color: baseShade,
        });
        coneList.push({
          pos: [x, gy + trunkH + 1.65 * hScale, z],
          scale: [1.62 * hScale, 1.55 * hScale, 1.62 * hScale],
          color: "#40916c",
        });
        coneList.push({
          pos: [x, gy + trunkH + 2.45 * hScale, z],
          scale: [1.08 * hScale, 1.25 * hScale, 1.08 * hScale],
          color: "#52b788",
        });
      } else {
        // Chunky Job-Simulator broadleaf oak/meadow tree
        const trunkH = 1.65 * hScale;
        trunkList.push({
          pos: [x, gy + trunkH * 0.5, z],
          scale: [0.36 * hScale, trunkH, 0.36 * hScale],
          color: "#7c5838",
        });
        const c1 = oakShades[i % oakShades.length]!;
        const c2 = oakShades[(i + 1) % oakShades.length]!;
        leafList.push({
          pos: [x, gy + trunkH + 0.85 * hScale, z],
          scale: [2.1 * hScale, 1.65 * hScale, 2.1 * hScale],
          color: c1,
        });
        leafList.push({
          pos: [x + 0.65 * hScale, gy + trunkH + 0.55 * hScale, z - 0.35 * hScale],
          scale: [1.35 * hScale, 1.15 * hScale, 1.35 * hScale],
          color: c2,
        });
        leafList.push({
          pos: [x - 0.58 * hScale, gy + trunkH + 0.62 * hScale, z + 0.42 * hScale],
          scale: [1.28 * hScale, 1.1 * hScale, 1.28 * hScale],
          color: c1,
        });
      }
    }

    // 20 Stylized Low-Poly Granite Boulders scattered across the meadow
    const rockShades = ["#94a3b8", "#8291a4", "#a3adb8", "#788596"];
    for (let i = 0; i < 20; i++) {
      const a = hashDet(i * 19.3 + 4) * Math.PI * 2;
      const r = 7.6 + hashDet(i * 23.1 + 9) * 16.0;
      const x = plinthX + Math.cos(a) * r;
      const z = plinthZ + Math.sin(a) * r;
      if (Math.hypot(x, z) < 6.4) continue;
      const gy = sampleGroundY(x, z);
      const sx = 0.55 + hashDet(i * 5.7) * 1.15;
      const sy = 0.38 + hashDet(i * 8.3) * 0.62;
      const sz = 0.52 + hashDet(i * 13.1) * 1.05;
      rockList.push({
        pos: [x, gy + sy * 0.34, z],
        rot: [hashDet(i) * 0.5, hashDet(i + 2) * Math.PI, hashDet(i + 5) * 0.4],
        scale: [sx, sy, sz],
        color: rockShades[i % rockShades.length]!,
      });
    }

    // Chunky Post-and-Rail Proving-Ground Timber Fence (22 segments arcing around the meadow)
    const fencePosts = 22;
    const fenceR = 7.6;
    for (let i = 0; i < fencePosts; i++) {
      const a = (i / fencePosts) * Math.PI * 2;
      // Leave wide open entry gap behind the user (+Z)
      if (Math.sin(a) > 0.72) continue;
      const x = plinthX + Math.cos(a) * fenceR;
      const z = plinthZ + Math.sin(a) * fenceR;
      const gy = sampleGroundY(x, z);
      boxList.push({ pos: [x, gy + 0.54, z], scale: [0.14, 1.08, 0.14], color: "#a47551" });

      const nextA = ((i + 1) / fencePosts) * Math.PI * 2;
      if (Math.sin(nextA) <= 0.72) {
        const nx = plinthX + Math.cos(nextA) * fenceR;
        const nz = plinthZ + Math.sin(nextA) * fenceR;
        const ngy = sampleGroundY(nx, nz);
        const mx = (x + nx) * 0.5;
        const mz = (z + nz) * 0.5;
        const mgy = (gy + ngy) * 0.5;
        const segLen = Math.hypot(nx - x, nz - z);
        const yaw = Math.atan2(nx - x, nz - z);
        boxList.push({ pos: [mx, mgy + 0.82, mz], rot: [0, yaw, 0], scale: [0.07, 0.1, segLen], color: "#bc8a5f" });
        boxList.push({ pos: [mx, mgy + 0.42, mz], rot: [0, yaw, 0], scale: [0.07, 0.1, segLen], color: "#bc8a5f" });
      }
    }

    // 4 Chunky Park Benches + Field Pelican Equipment Crates
    const benchAngles = [-2.4, -0.75, 0.42, 2.72];
    const crateColors = ["#f97316", "#eab308", "#0284c7", "#4d7c0f"];
    for (let i = 0; i < benchAngles.length; i++) {
      const a = benchAngles[i]!;
      const r = 6.2;
      const x = plinthX + Math.cos(a) * r;
      const z = plinthZ + Math.sin(a) * r;
      const gy = sampleGroundY(x, z);
      const yaw = Math.atan2(plinthX - x, plinthZ - z);
      boxList.push({ pos: [x, gy + 0.46, z], rot: [0, yaw, 0], scale: [1.65, 0.1, 0.52], color: "#c28d5d" });
      boxList.push({ pos: [x, gy + 0.22, z], rot: [0, yaw, 0], scale: [1.35, 0.4, 0.42], color: "#334155" });
      // Field equipment Pelican case beside bench
      const cx = x + Math.cos(yaw) * 1.18;
      const cz = z - Math.sin(yaw) * 1.18;
      boxList.push({
        pos: [cx, gy + 0.2, cz],
        rot: [0, yaw + 0.3, 0],
        scale: [0.64, 0.36, 0.46],
        color: crateColors[i % crateColors.length]!,
      });
    }

    // 2 Yellow Engineering Survey Tripods (Theodolites)
    const tripodCoords: readonly [number, number][] = [
      [plinthX - 4.9, plinthZ - 2.6],
      [plinthX + 4.9, plinthZ - 2.2],
    ];
    for (const [tx, tz] of tripodCoords) {
      const gy = sampleGroundY(tx, tz);
      for (let leg = 0; leg < 3; leg++) {
        const la = (leg / 3) * Math.PI * 2;
        metalList.push({
          pos: [tx + Math.cos(la) * 0.22, gy + 0.65, tz + Math.sin(la) * 0.22],
          rot: [Math.sin(la) * 0.28, 0, -Math.cos(la) * 0.28],
          scale: [0.045, 1.38, 0.045],
          color: "#eab308",
        });
      }
      boxList.push({ pos: [tx, gy + 1.42, tz], scale: [0.24, 0.26, 0.28], color: "#facc15" });
      metalList.push({
        pos: [tx, gy + 1.44, tz + 0.12],
        rot: [Math.PI / 2, 0, 0],
        scale: [0.1, 0.28, 0.1],
        color: "#1e293b",
      });
    }

    // Weather / Anemometer Mast base location
    const mx = plinthX + 5.3;
    const mz = plinthZ - 4.8;
    const mgy = sampleGroundY(mx, mz);
    metalList.push({ pos: [mx, mgy + 1.9, mz], scale: [0.09, 3.8, 0.09], color: "#cbd5e1" });
    boxList.push({ pos: [mx, mgy + 1.3, mz], scale: [0.36, 0.44, 0.24], color: "#f8fafc" });

    // 10 Stylized Puffy Low-Poly Cloud Clusters floating high overhead
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const r = 18 + hashDet(i * 17.1) * 20;
      const cx = Math.cos(a) * r;
      const cz = plinthZ + Math.sin(a) * r;
      const cy = 14.5 + hashDet(i * 29.3) * 5.5;
      const cs = 1.1 + hashDet(i * 6.9) * 0.9;
      cloudList.push({ pos: [cx, cy, cz], scale: [3.2 * cs, 1.6 * cs, 2.2 * cs], color: "#ffffff" });
      cloudList.push({
        pos: [cx + 1.4 * cs, cy - 0.15 * cs, cz + 0.3 * cs],
        scale: [2.2 * cs, 1.25 * cs, 1.8 * cs],
        color: "#f8fafc",
      });
      cloudList.push({
        pos: [cx - 1.3 * cs, cy - 0.2 * cs, cz - 0.2 * cs],
        scale: [2.0 * cs, 1.15 * cs, 1.7 * cs],
        color: "#f1f5f9",
      });
    }

    return {
      trunks: trunkList,
      pineCones: coneList,
      leafSpheres: leafList,
      woodBoxes: boxList,
      boulders: rockList,
      metalCyls: metalList,
      clouds: cloudList,
      mastPos: [mx, mgy + 3.82, mz] as [number, number, number],
    };
  }, [sampleGroundY, plinthX, plinthZ]);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    if (anemometerRef.current) {
      anemometerRef.current.rotation.y += dt * 2.2;
    }
    if (cloudsGroupRef.current) {
      cloudsGroupRef.current.rotation.y += dt * 0.008;
    }
  });

  return (
    <group name="rotunda-outdoors-props">
      <InstancedBatch geometry={geoms.cyl} instances={trunks} roughness={0.88} metalness={0.0} />
      <InstancedBatch geometry={geoms.cone} instances={pineCones} roughness={0.82} metalness={0.02} />
      <InstancedBatch geometry={geoms.sphere} instances={leafSpheres} roughness={0.8} metalness={0.02} />
      <InstancedBatch geometry={geoms.box} instances={woodBoxes} roughness={0.76} metalness={0.06} />
      <InstancedBatch geometry={geoms.sphere} instances={boulders} roughness={0.92} metalness={0.02} />
      <InstancedBatch geometry={geoms.cyl} instances={metalCyls} roughness={0.38} metalness={0.65} />

      {/* Gently spinning 3-cup red/white weather anemometer atop the proving-ground mast */}
      <group ref={anemometerRef} position={mastPos}>
        {[0, 1, 2].map((k) => {
          const a = (k / 3) * Math.PI * 2;
          return (
            <group key={k} rotation={[0, a, 0]}>
              <mesh position={[0.24, 0, 0]} rotation={[0, 0, Math.PI / 2]} raycast={NOOP_RAYCAST}>
                <cylinderGeometry args={[0.014, 0.014, 0.48, 6]} />
                <meshStandardMaterial color="#e2e8f0" metalness={0.7} roughness={0.3} />
              </mesh>
              <mesh position={[0.48, 0, 0]} raycast={NOOP_RAYCAST}>
                <sphereGeometry args={[0.075, 10, 8]} />
                <meshStandardMaterial color={k === 0 ? "#ef4444" : "#f8fafc"} roughness={0.4} />
              </mesh>
            </group>
          );
        })}
      </group>

      {/* Slowly drifting stylized puffy clouds overhead */}
      <group ref={cloudsGroupRef}>
        <InstancedBatch geometry={geoms.sphere} instances={clouds} unlit opacity={0.92} />
      </group>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  3. Warehouse Factory Props — Pallet Racks, Cargo, Drums, Robot Arms       */
/* -------------------------------------------------------------------------- */

export function WarehouseEnvironmentProps(): ReactElement {
  const geoms = usePropUnitGeometries();
  const leftRobotArmRef = useRef<THREE.Group | null>(null);
  const rightRobotArmRef = useRef<THREE.Group | null>(null);

  const { rackSteel, cargoBoxes, drumsAndBollards, trafficCones } = useMemo(() => {
    const steel: PropInstance[] = [];
    const cargo: PropInstance[] = [];
    const cyls: PropInstance[] = [];
    const cones: PropInstance[] = [];

    const cardboardPalette = ["#d4a373", "#c89b6e", "#ddb892", "#b88a5e"];
    const totePalette = ["#0284c7", "#2563eb", "#dc2626", "#eab308", "#0f766e"];

    const addPalletRack = (cx: number, cz: number, yaw: number, seed: number) => {
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const localToWorld = (lx: number, ly: number, lz: number): [number, number, number] => [
        cx + lx * cos + lz * sin,
        ly,
        cz - lx * sin + lz * cos,
      ];

      // 4 Blue Steel Rack Uprights
      for (const ux of [-1.55, 1.55]) {
        for (const uz of [-0.52, 0.52]) {
          steel.push({ pos: localToWorld(ux, 2.25, uz), rot: [0, yaw, 0], scale: [0.1, 4.5, 0.1], color: "#1d4ed8" });
        }
      }

      // 3 Orange Horizontal Beam Levels + Wooden Pallets + Stocked Cargo
      const shelfYs = [0.22, 1.65, 3.08];
      for (let tier = 0; tier < shelfYs.length; tier++) {
        const sy = shelfYs[tier]!;
        steel.push({ pos: localToWorld(0, sy, 0.52), rot: [0, yaw, 0], scale: [3.2, 0.11, 0.08], color: "#ea580c" });
        steel.push({ pos: localToWorld(0, sy, -0.52), rot: [0, yaw, 0], scale: [3.2, 0.11, 0.08], color: "#ea580c" });

        // 2 Wooden pallets per shelf level
        for (let slot = 0; slot < 2; slot++) {
          const sx = slot === 0 ? -0.78 : 0.78;
          cargo.push({
            pos: localToWorld(sx, sy + 0.1, 0),
            rot: [0, yaw, 0],
            scale: [1.32, 0.11, 0.96],
            color: "#a47551",
          });

          const sVal = seed * 17 + tier * 5 + slot * 3;
          // Stack 2–3 boxes/totes on each pallet
          const boxCount = 2 + Math.floor(hashDet(sVal) * 2);
          for (let b = 0; b < boxCount; b++) {
            const isTote = hashDet(sVal + b * 7.1) > 0.62;
            const bw = 0.42 + hashDet(sVal + b * 2.3) * 0.32;
            const bh = 0.34 + hashDet(sVal + b * 3.7) * 0.34;
            const bd = 0.44 + hashDet(sVal + b * 4.9) * 0.34;
            const bx = sx + (b === 0 ? -0.28 : b === 1 ? 0.28 : 0);
            const by = sy + 0.16 + bh * 0.5 + (b === 2 ? 0.48 : 0);
            const bz = (hashDet(sVal + b * 9.3) - 0.5) * 0.22;
            cargo.push({
              pos: localToWorld(bx, by, bz),
              rot: [0, yaw + (hashDet(sVal + b) - 0.5) * 0.14, 0],
              scale: [bw, bh, bd],
              color: isTote
                ? totePalette[(sVal + b) % totePalette.length]!
                : cardboardPalette[(sVal + b) % cardboardPalette.length]!,
            });
          }
        }
      }
    };

    // 6 Flanking Racks along left/right hangar walls + 2 Rear Bulkhead Racks
    addPalletRack(-9.2, -14.5, Math.PI / 2, 1);
    addPalletRack(-9.2, -9.8, Math.PI / 2, 2);
    addPalletRack(-9.2, -4.6, Math.PI / 2, 3);
    addPalletRack(9.2, -14.5, -Math.PI / 2, 4);
    addPalletRack(9.2, -9.8, -Math.PI / 2, 5);
    addPalletRack(9.2, -4.6, -Math.PI / 2, 6);
    addPalletRack(-4.4, -21.2, 0, 7);
    addPalletRack(4.4, -21.2, 0, 8);

    // 4 Red Rolling Mechanic Tool Chests near the flanks
    const chestCoords: readonly [number, number, number][] = [
      [-6.8, -1.8, Math.PI / 2],
      [6.8, -1.8, -Math.PI / 2],
      [-7.2, -12.2, Math.PI / 2],
      [7.2, -12.2, -Math.PI / 2],
    ];
    for (const [tx, tz, yaw] of chestCoords) {
      cargo.push({ pos: [tx, 0.56, tz], rot: [0, yaw, 0], scale: [1.18, 0.98, 0.58], color: "#dc2626" });
      steel.push({ pos: [tx, 1.07, tz], rot: [0, yaw, 0], scale: [1.22, 0.05, 0.62], color: "#334155" });
      // Chrome drawer handles
      for (const dy of [0.34, 0.56, 0.78]) {
        const hx = tx + Math.sin(yaw) * 0.31;
        const hz = tz + Math.cos(yaw) * 0.31;
        steel.push({ pos: [hx, dy, hz], rot: [0, yaw, 0], scale: [0.96, 0.035, 0.03], color: "#e2e8f0" });
      }
    }

    // 14 Safety Yellow Bollards along hangar walkways
    for (const bx of [-5.2, 5.2]) {
      for (const bz of [-15.5, -12.0, -8.5, -5.0, -1.5, 1.8, 4.5]) {
        cyls.push({ pos: [bx, 0.48, bz], scale: [0.16, 0.96, 0.16], color: "#eab308" });
        cyls.push({ pos: [bx, 0.86, bz], scale: [0.168, 0.12, 0.168], color: "#1e293b" });
      }
    }

    // 12 Industrial 55-Gallon Drums clustered near the corners
    const drumPalette = ["#0284c7", "#dc2626", "#0f766e", "#334155"];
    const drumCoords: readonly [number, number][] = [
      [-6.5, -17.5],
      [-7.3, -17.3],
      [-6.9, -18.2],
      [6.5, -17.5],
      [7.3, -17.3],
      [6.9, -18.2],
      [-7.4, 2.2],
      [-6.7, 2.5],
      [7.4, 2.2],
      [6.7, 2.5],
    ];
    drumCoords.forEach(([dx, dz], idx) => {
      cyls.push({ pos: [dx, 0.46, dz], scale: [0.58, 0.92, 0.58], color: drumPalette[idx % drumPalette.length]! });
      cyls.push({ pos: [dx, 0.925, dz], scale: [0.6, 0.04, 0.6], color: "#cbd5e1" });
    });

    // 4 Giant Wooden Cable Spools
    for (const [sx, sz] of [
      [-7.4, -7.2],
      [7.4, -7.2],
    ] as const) {
      cyls.push({ pos: [sx, 0.58, sz], rot: [0, 0, Math.PI / 2], scale: [1.12, 0.08, 1.12], color: "#bc8a5f" });
      cyls.push({ pos: [sx + 0.52, 0.58, sz], rot: [0, 0, Math.PI / 2], scale: [1.12, 0.08, 1.12], color: "#bc8a5f" });
      cyls.push({ pos: [sx + 0.26, 0.58, sz], rot: [0, 0, Math.PI / 2], scale: [0.76, 0.46, 0.76], color: "#1e293b" });
    }

    // 8 Bright Orange Traffic Cones
    const coneCoords: readonly [number, number][] = [
      [-4.6, -6.2],
      [4.6, -6.2],
      [-4.6, 1.2],
      [4.6, 1.2],
      [-5.9, -16.2],
      [5.9, -16.2],
      [-5.9, 3.6],
      [5.9, 3.6],
    ];
    for (const [cx, cz] of coneCoords) {
      cargo.push({ pos: [cx, 0.03, cz], scale: [0.34, 0.06, 0.34], color: "#1e293b" });
      cones.push({ pos: [cx, 0.34, cz], scale: [0.28, 0.58, 0.28], color: "#f97316" });
    }

    // Overhead Yellow Bridge-Crane Double Girder + Trolley spanning the high bay
    steel.push({ pos: [0, 6.9, -10.8], scale: [22.2, 0.46, 0.36], color: "#eab308" });
    steel.push({ pos: [0, 6.9, -9.8], scale: [22.2, 0.46, 0.36], color: "#eab308" });
    steel.push({ pos: [2.8, 6.45, -10.3], scale: [1.35, 0.42, 1.45], color: "#334155" });
    cyls.push({ pos: [2.8, 5.55, -10.3], scale: [0.06, 1.4, 0.06], color: "#475569" });
    steel.push({ pos: [2.8, 4.78, -10.3], scale: [0.38, 0.42, 0.24], color: "#eab308" });

    return { rackSteel: steel, cargoBoxes: cargo, drumsAndBollards: cyls, trafficCones: cones };
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (leftRobotArmRef.current) {
      leftRobotArmRef.current.rotation.y = Math.sin(t * 0.45) * 0.42;
    }
    if (rightRobotArmRef.current) {
      rightRobotArmRef.current.rotation.y = Math.cos(t * 0.38) * 0.42;
    }
  });

  return (
    <group name="rotunda-warehouse-props">
      <InstancedBatch geometry={geoms.box} instances={rackSteel} roughness={0.38} metalness={0.62} />
      <InstancedBatch geometry={geoms.box} instances={cargoBoxes} roughness={0.78} metalness={0.04} />
      <InstancedBatch geometry={geoms.cyl} instances={drumsAndBollards} roughness={0.44} metalness={0.32} />
      <InstancedBatch geometry={geoms.cone} instances={trafficCones} roughness={0.48} metalness={0.05} />

      {/* 2 Articulated Orange Industrial Robot Arms idling in rear corners */}
      {(
        [
          [-6.4, -14.2, leftRobotArmRef],
          [6.4, -14.2, rightRobotArmRef],
        ] as const
      ).map(([rx, rz, armRef], idx) => (
        <group key={idx} position={[rx, 0, rz]}>
          <mesh position={[0, 0.28, 0]} raycast={NOOP_RAYCAST}>
            <cylinderGeometry args={[0.56, 0.64, 0.56, 14]} />
            <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.42} />
          </mesh>
          <group ref={armRef} position={[0, 0.56, 0]}>
            <mesh position={[0, 0.42, 0]} raycast={NOOP_RAYCAST}>
              <boxGeometry args={[0.46, 0.84, 0.46]} />
              <meshStandardMaterial color="#ea580c" roughness={0.36} metalness={0.22} />
            </mesh>
            <mesh position={[0, 1.38, 0.18]} rotation={[0.28, 0, 0]} raycast={NOOP_RAYCAST}>
              <boxGeometry args={[0.28, 1.5, 0.28]} />
              <meshStandardMaterial color="#f97316" roughness={0.34} metalness={0.22} />
            </mesh>
            <mesh position={[0, 2.02, 0.82]} rotation={[1.22, 0, 0]} raycast={NOOP_RAYCAST}>
              <boxGeometry args={[0.22, 1.15, 0.22]} />
              <meshStandardMaterial color="#ea580c" roughness={0.34} metalness={0.22} />
            </mesh>
            <mesh position={[0, 1.88, 1.38]} raycast={NOOP_RAYCAST}>
              <boxGeometry args={[0.18, 0.18, 0.28]} />
              <meshStandardMaterial color="#1e293b" roughness={0.32} metalness={0.74} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  4. Office Studio Props — Workstations, Bookshelves, Whiteboards, Plants   */
/* -------------------------------------------------------------------------- */

export function OfficeEnvironmentProps(): ReactElement {
  const geoms = usePropUnitGeometries();
  const whiteboardTex = useMemo(() => createDisplayBoardTexture("office-whiteboard"), []);

  useEffect(() => {
    return () => {
      whiteboardTex?.dispose();
    };
  }, [whiteboardTex]);

  const { woodAndMatte, darkSteel, glowingScreens, potsAndMugs, foliage, whiteboards } = useMemo(() => {
    const matte: PropInstance[] = [];
    const steel: PropInstance[] = [];
    const screens: PropInstance[] = [];
    const cyls: PropInstance[] = [];
    const leaves: PropInstance[] = [];
    const boards: { pos: [number, number, number]; yaw: number }[] = [];

    const bookColors = ["#ef4444", "#0284c7", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];
    const screenColors = ["#bae6fd", "#dbeafe", "#a7f3d0", "#e0e7ff"];

    // 6 Surrounding Engineering Workstations (Desks, Dual Monitors, Chairs, Lamps, Mugs)
    const deskSpecs: readonly [number, number, number][] = [
      [-6.6, -4.8, Math.PI * 0.42],
      [-6.8, -1.2, Math.PI * 0.5],
      [-6.2, 2.4, Math.PI * 0.6],
      [6.6, -4.8, -Math.PI * 0.42],
      [6.8, -1.2, -Math.PI * 0.5],
      [6.2, 2.4, -Math.PI * 0.6],
    ];
    deskSpecs.forEach(([dx, dz, yaw], idx) => {
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const toW = (lx: number, ly: number, lz: number): [number, number, number] => [
        dx + lx * cos + lz * sin,
        ly,
        dz - lx * sin + lz * cos,
      ];

      // Warm oak desktop + steel frame legs
      matte.push({ pos: toW(0, 0.75, 0), rot: [0, yaw, 0], scale: [1.72, 0.06, 0.82], color: "#d6b084" });
      steel.push({ pos: toW(-0.78, 0.37, 0), rot: [0, yaw, 0], scale: [0.06, 0.74, 0.72], color: "#334155" });
      steel.push({ pos: toW(0.78, 0.37, 0), rot: [0, yaw, 0], scale: [0.06, 0.74, 0.72], color: "#334155" });

      // Dual ultrawide studio monitors
      for (const mx of [-0.34, 0.34]) {
        const myaw = yaw + (mx < 0 ? 0.14 : -0.14);
        steel.push({ pos: toW(mx, 0.88, -0.22), rot: [0, myaw, 0], scale: [0.08, 0.24, 0.06], color: "#475569" });
        steel.push({ pos: toW(mx, 1.08, -0.22), rot: [0, myaw, 0], scale: [0.62, 0.38, 0.04], color: "#1e293b" });
        screens.push({
          pos: toW(mx, 1.08, -0.195),
          rot: [0, myaw, 0],
          scale: [0.56, 0.32, 0.01],
          color: screenColors[(idx + (mx > 0 ? 1 : 0)) % screenColors.length]!,
        });
      }

      // Keyboard + coffee mug + notebook stack
      steel.push({ pos: toW(0, 0.79, 0.12), rot: [0, yaw, 0], scale: [0.42, 0.02, 0.15], color: "#334155" });
      cyls.push({
        pos: toW(0.58, 0.84, 0.14),
        scale: [0.085, 0.11, 0.085],
        color: bookColors[idx % bookColors.length]!,
      });
      matte.push({
        pos: toW(-0.6, 0.81, 0.14),
        rot: [0, yaw + 0.12, 0],
        scale: [0.24, 0.06, 0.3],
        color: bookColors[(idx + 2) % bookColors.length]!,
      });

      // Ergonomic swivel task chair tucked in front of desk
      cyls.push({ pos: toW(0.05, 0.24, 0.66), scale: [0.08, 0.44, 0.08], color: "#475569" });
      matte.push({ pos: toW(0.05, 0.48, 0.66), rot: [0, yaw + 0.2, 0], scale: [0.52, 0.08, 0.5], color: "#1e293b" });
      matte.push({ pos: toW(0.05, 0.82, 0.88), rot: [0, yaw + 0.2, 0], scale: [0.48, 0.56, 0.07], color: "#334155" });
    });

    // 4 Tall Modular Bookshelves stocked with colorful textbooks & prototype cubes
    const shelfCoords: readonly [number, number, number][] = [
      [-4.6, -8.8, 0.38],
      [4.6, -8.8, -0.38],
      [-7.8, -7.2, 0.92],
      [7.8, -7.2, -0.92],
    ];
    shelfCoords.forEach(([sx, sz, yaw], sIdx) => {
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const toW = (lx: number, ly: number, lz: number): [number, number, number] => [
        sx + lx * cos + lz * sin,
        ly,
        sz - lx * sin + lz * cos,
      ];
      steel.push({ pos: toW(-0.82, 1.35, 0), rot: [0, yaw, 0], scale: [0.06, 2.7, 0.42], color: "#475569" });
      steel.push({ pos: toW(0.82, 1.35, 0), rot: [0, yaw, 0], scale: [0.06, 2.7, 0.42], color: "#475569" });
      for (let t = 0; t < 5; t++) {
        const ty = 0.22 + t * 0.56;
        matte.push({ pos: toW(0, ty, 0), rot: [0, yaw, 0], scale: [1.66, 0.045, 0.42], color: "#e5d3b3" });
        // Populate books & colorful prototype boxes on each shelf
        for (let b = 0; b < 5; b++) {
          const bx = -0.58 + b * 0.28;
          const bh = 0.22 + hashDet(sIdx * 31 + t * 7 + b * 3) * 0.16;
          const bw = b % 2 === 0 ? 0.16 : 0.22;
          matte.push({
            pos: toW(bx, ty + 0.025 + bh * 0.5, 0),
            rot: [0, yaw, 0],
            scale: [bw, bh, 0.26],
            color: bookColors[(sIdx + t + b) % bookColors.length]!,
          });
        }
      }
    });

    // 3 Freestanding Rolling Studio Whiteboards
    const wbSpecs: readonly [number, number, number][] = [
      [-1.8, -8.9, 0.16],
      [1.8, -8.9, -0.16],
      [-7.9, 4.2, Math.PI * 0.72],
    ];
    for (const [wx, wz, yaw] of wbSpecs) {
      boards.push({ pos: [wx, 1.52, wz], yaw });
      steel.push({ pos: [wx, 0.08, wz], rot: [0, yaw, 0], scale: [1.85, 0.08, 0.52], color: "#64748b" });
      steel.push({ pos: [wx, 1.52, wz], rot: [0, yaw, 0], scale: [1.96, 1.14, 0.06], color: "#94a3b8" });
    }

    // 8 Potted Studio Plants + 2 Blueprint Roll Bins
    const plantCoords: readonly [number, number][] = [
      [-5.6, -7.8],
      [5.6, -7.8],
      [-8.4, -3.0],
      [8.4, -3.0],
      [-8.2, 0.8],
      [8.2, 0.8],
      [-5.0, 4.8],
      [5.0, 4.8],
    ];
    plantCoords.forEach(([px, pz], idx) => {
      cyls.push({ pos: [px, 0.26, pz], scale: [0.46, 0.52, 0.46], color: idx % 2 === 0 ? "#c87a52" : "#f1f5f9" });
      leaves.push({ pos: [px, 0.88, pz], scale: [0.76, 0.78, 0.76], color: idx % 2 === 0 ? "#2e7d52" : "#3f9162" });
      leaves.push({ pos: [px + 0.18, 1.12, pz - 0.12], scale: [0.52, 0.54, 0.52], color: "#52b788" });
    });

    // 2 Blueprint Roll Carts near rear corners
    for (const [rx, rz] of [
      [-3.4, -8.6],
      [3.4, -8.6],
    ] as const) {
      steel.push({ pos: [rx, 0.36, rz], scale: [0.58, 0.68, 0.58], color: "#334155" });
      for (let k = 0; k < 4; k++) {
        const ox = k % 2 === 0 ? -0.12 : 0.12;
        const oz = k < 2 ? -0.12 : 0.12;
        cyls.push({
          pos: [rx + ox, 0.76, rz + oz],
          scale: [0.1, 0.96, 0.1],
          color: k % 2 === 0 ? "#f8fafc" : "#38bdf8",
        });
      }
    }

    return {
      woodAndMatte: matte,
      darkSteel: steel,
      glowingScreens: screens,
      potsAndMugs: cyls,
      foliage: leaves,
      whiteboards: boards,
    };
  }, []);

  return (
    <group name="rotunda-office-props">
      <InstancedBatch geometry={geoms.box} instances={woodAndMatte} roughness={0.72} metalness={0.04} />
      <InstancedBatch geometry={geoms.box} instances={darkSteel} roughness={0.36} metalness={0.68} />
      <InstancedBatch geometry={geoms.box} instances={glowingScreens} unlit />
      <InstancedBatch geometry={geoms.cyl} instances={potsAndMugs} roughness={0.58} metalness={0.08} />
      <InstancedBatch geometry={geoms.sphere} instances={foliage} roughness={0.82} metalness={0.02} />

      {whiteboardTex &&
        whiteboards.map((b, idx) => (
          <mesh
            key={idx}
            position={[b.pos[0] + Math.sin(b.yaw) * 0.036, b.pos[1], b.pos[2] + Math.cos(b.yaw) * 0.036]}
            rotation={[0, b.yaw, 0]}
            raycast={NOOP_RAYCAST}
          >
            <planeGeometry args={[1.84, 1.02]} />
            <meshBasicMaterial map={whiteboardTex} toneMapped={false} />
          </mesh>
        ))}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*  5. Dark Lab Props — Server Racks, LED Banks, Scope Benches, Cryo Pods     */
/* -------------------------------------------------------------------------- */

export function DarkLabEnvironmentProps(): ReactElement {
  const geoms = usePropUnitGeometries();

  const { rackMonoliths, ledStrips, cryoCyls, podGlass } = useMemo(() => {
    const monoliths: PropInstance[] = [];
    const leds: PropInstance[] = [];
    const cyls: PropInstance[] = [];
    const glass: PropInstance[] = [];

    const ledPalette = ["#22d3ee", "#10b981", "#38bdf8", "#818cf8", "#f59e0b"];

    // 12 Flanking 19" High-Density Compute / Telemetry Server Racks in curved arcs
    const rackAngles = [-2.55, -2.28, -2.0, -1.72, -1.18, -0.9, -0.62, -0.35, 0.35, 0.65, 2.48, 2.78];
    rackAngles.forEach((a, idx) => {
      const r = 8.4;
      const x = Math.cos(a) * r;
      const z = -2.0 + Math.sin(a) * r;
      const yaw = Math.atan2(-x, -2.0 - z);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const toW = (lx: number, ly: number, lz: number): [number, number, number] => [
        x + lx * cos + lz * sin,
        ly,
        z - lx * sin + lz * cos,
      ];

      // Obsidian 42U server cabinet
      monoliths.push({ pos: [x, 1.32, z], rot: [0, yaw, 0], scale: [0.88, 2.64, 0.96], color: "#0f172a" });
      // Metallic side frame trims
      monoliths.push({ pos: toW(-0.45, 1.32, 0.46), rot: [0, yaw, 0], scale: [0.05, 2.66, 0.06], color: "#334155" });
      monoliths.push({ pos: toW(0.45, 1.32, 0.46), rot: [0, yaw, 0], scale: [0.05, 2.66, 0.06], color: "#334155" });

      // 6 Illuminated blade-server status LED bars per rack
      for (let row = 0; row < 6; row++) {
        const ly = 0.42 + row * 0.36;
        leds.push({
          pos: toW(0, ly, 0.49),
          rot: [0, yaw, 0],
          scale: [0.68, 0.032, 0.02],
          color: ledPalette[(idx + row) % ledPalette.length]!,
        });
      }
    });

    // 4 Cleanroom Diagnostic Test Benches with Glowing Oscilloscope Monitors
    const benchSpecs: readonly [number, number, number][] = [
      [-5.6, -5.8, Math.PI * 0.32],
      [5.6, -5.8, -Math.PI * 0.32],
      [-5.8, 0.4, Math.PI * 0.56],
      [5.8, 0.4, -Math.PI * 0.56],
    ];
    benchSpecs.forEach(([bx, bz, yaw], idx) => {
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const toW = (lx: number, ly: number, lz: number): [number, number, number] => [
        bx + lx * cos + lz * sin,
        ly,
        bz - lx * sin + lz * cos,
      ];
      monoliths.push({ pos: toW(0, 0.84, 0), rot: [0, yaw, 0], scale: [1.65, 0.08, 0.78], color: "#1e293b" });
      monoliths.push({ pos: toW(-0.74, 0.42, 0), rot: [0, yaw, 0], scale: [0.08, 0.84, 0.68], color: "#334155" });
      monoliths.push({ pos: toW(0.74, 0.42, 0), rot: [0, yaw, 0], scale: [0.08, 0.84, 0.68], color: "#334155" });
      // Oscilloscope housing + glowing cyan/emerald screen
      monoliths.push({ pos: toW(-0.28, 1.12, -0.14), rot: [0, yaw, 0], scale: [0.54, 0.42, 0.32], color: "#0f172a" });
      leds.push({
        pos: toW(-0.28, 1.14, 0.03),
        rot: [0, yaw, 0],
        scale: [0.42, 0.28, 0.015],
        color: idx % 2 === 0 ? "#22d3ee" : "#10b981",
      });
      // Benchtop power supply unit
      monoliths.push({ pos: toW(0.42, 1.04, -0.12), rot: [0, yaw, 0], scale: [0.42, 0.28, 0.32], color: "#1e293b" });
      leds.push({ pos: toW(0.42, 1.08, 0.05), rot: [0, yaw, 0], scale: [0.28, 0.06, 0.015], color: "#f59e0b" });
    });

    // 8 Stainless Cryogenic Dewars & Color-Coded Lab Gas Cylinders
    const tankCoords: readonly [number, number, string][] = [
      [-6.8, -3.2, "#06b6d4"],
      [-7.2, -2.5, "#10b981"],
      [6.8, -3.2, "#06b6d4"],
      [7.2, -2.5, "#f59e0b"],
      [-6.5, -8.2, "#38bdf8"],
      [6.5, -8.2, "#38bdf8"],
    ];
    for (const [tx, tz, collar] of tankCoords) {
      cyls.push({ pos: [tx, 0.72, tz], scale: [0.36, 1.44, 0.36], color: "#94a3b8" });
      cyls.push({ pos: [tx, 1.48, tz], scale: [0.37, 0.14, 0.37], color: collar });
      cyls.push({ pos: [tx, 1.62, tz], scale: [0.1, 0.16, 0.1], color: "#475569" });
    }

    // 4 Illuminated Cylindrical Specimen / Prototype Containment Pods at outer diagonals
    const podCoords: readonly [number, number][] = [
      [-8.6, -9.8],
      [8.6, -9.8],
      [-9.2, 3.2],
      [9.2, 3.2],
    ];
    for (const [px, pz] of podCoords) {
      cyls.push({ pos: [px, 0.18, pz], scale: [1.32, 0.36, 1.32], color: "#1e293b" });
      cyls.push({ pos: [px, 2.95, pz], scale: [1.32, 0.28, 1.32], color: "#1e293b" });
      glass.push({ pos: [px, 1.58, pz], scale: [1.14, 2.45, 1.14], color: "#0ea5e9" });
      leds.push({ pos: [px, 0.38, pz], scale: [1.18, 0.04, 1.18], color: "#22d3ee" });
      leds.push({ pos: [px, 1.56, pz], scale: [0.36, 0.36, 0.36], color: "#38bdf8" });
    }

    return { rackMonoliths: monoliths, ledStrips: leds, cryoCyls: cyls, podGlass: glass };
  }, []);

  return (
    <group name="rotunda-darklab-props">
      <InstancedBatch geometry={geoms.box} instances={rackMonoliths} roughness={0.34} metalness={0.72} />
      <InstancedBatch geometry={geoms.box} instances={ledStrips} unlit />
      <InstancedBatch geometry={geoms.cyl} instances={cryoCyls} roughness={0.28} metalness={0.82} />
      <InstancedBatch geometry={geoms.cyl} instances={podGlass} unlit opacity={0.18} />
    </group>
  );
}
