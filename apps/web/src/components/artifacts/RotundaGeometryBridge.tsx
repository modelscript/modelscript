// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RotundaModelEntry } from "@modelscript/editor/workbench/vr-rotunda/types.js";
import "@react-three/fiber";
import React, { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";

export interface StepMeshPartSnapshot {
  name: string;
  geometry: THREE.BufferGeometry;
  offset: [number, number, number];
  colorRgba?: [number, number, number, number] | undefined;
}

export interface MultibodyNodeSnapshot {
  id: string;
  label?: string | undefined;
  position: [number, number, number];
  color?: string | undefined;
  radius?: number | undefined;
}

export interface MultibodyLinkSnapshot {
  from: [number, number, number];
  to: [number, number, number];
  color?: string | undefined;
}

export interface InstancedClusterSnapshot {
  readonly clusterId: string;
  readonly geometry: THREE.BufferGeometry;
  /** Contiguous column-major 4×4 matrices (`count * 16`). */
  readonly matrices: Float32Array;
  /** Optional contiguous RGB colors (`count * 3`). */
  readonly colors?: Float32Array | undefined;
  readonly count: number;
  readonly baseColor?: string | undefined;
  readonly metalness?: number | undefined;
  readonly roughness?: number | undefined;
}

export type ArtifactRotundaGeometrySnapshot =
  | {
      kind: "step-meshes";
      parts: StepMeshPartSnapshot[];
    }
  | {
      kind: "fea-mesh";
      geometry: THREE.BufferGeometry;
      wireframePositions?: Float32Array | undefined;
    }
  | {
      kind: "gcode-path";
      cutSegments: [number, number, number][];
      rapidSegments: [number, number, number][];
    }
  | {
      kind: "multibody";
      nodes: MultibodyNodeSnapshot[];
      links: MultibodyLinkSnapshot[];
    }
  | {
      kind: "instanced-assembly";
      clusters: InstancedClusterSnapshot[];
    };

export interface SnapshotFitTransform {
  center: [number, number, number];
  size: [number, number, number];
  scale: number;
  position: [number, number, number];
  targetCenterY: number;
}

const MAX_REGISTRY_ENTRIES = 12;
const TARGET_PLINTH_SPHERE_DIAMETER = 0.78;
const PLINTH_BASE_CLEARANCE_Y = 0.02;
const FLAT_MODEL_MIN_CENTER_Y = 0.16;
const STEP_EXPLODE_METERS = 0.28;
const MULTIBODY_EXPLODE_METERS = 0.24;
const GOLDEN_ANGLE_RAD = 2.399963229728653;

const STEP_DEFAULT_PALETTE: readonly string[] = ["#64748b", "#38bdf8", "#94a3b8", "#475569", "#0ea5e9", "#7c8ea3"];

const UP_VECTOR = new THREE.Vector3(0, 1, 0);

const geometryRegistry = new Map<string, ArtifactRotundaGeometrySnapshot>();
const registryListeners = new Set<() => void>();

function normalizeKey(key: string | number | null | undefined): string | null {
  if (key === null || key === undefined) return null;
  const normalized = String(key).trim();
  return normalized.length > 0 ? normalized : null;
}

function notifySubscribers(): void {
  for (const listener of registryListeners) {
    try {
      listener();
    } catch {
      // Keep remaining subscribers isolated
    }
  }
}

function subscribeGeometryRegistry(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

/**
 * Registers live parsed Three.js artifact geometry in an LRU-bounded reactive registry (cap: 12)
 * so transitioning from any 3D artifact viewer into the Engineering Rotunda preserves exact geometry.
 * Returns an unregister cleanup function that removes the entry only if unchanged.
 */
export function registerArtifactRotundaGeometry(
  key: string | number,
  snapshot: ArtifactRotundaGeometrySnapshot,
): () => void {
  const norm = normalizeKey(key);
  if (!norm) {
    return () => undefined;
  }

  // Delete before re-inserting so Map iteration order tracks LRU recency
  geometryRegistry.delete(norm);
  geometryRegistry.set(norm, snapshot);

  while (geometryRegistry.size > MAX_REGISTRY_ENTRIES) {
    const oldestKey = geometryRegistry.keys().next().value;
    if (oldestKey === undefined) break;
    geometryRegistry.delete(oldestKey);
  }

  notifySubscribers();

  return () => {
    if (geometryRegistry.get(norm) === snapshot) {
      geometryRegistry.delete(norm);
      notifySubscribers();
    }
  };
}

/** Synchronously reads the latest live geometry snapshot registered under `key`, if any. */
export function getArtifactRotundaGeometry(
  key: string | number | null | undefined,
): ArtifactRotundaGeometrySnapshot | null {
  const norm = normalizeKey(key);
  if (!norm) return null;
  return geometryRegistry.get(norm) ?? null;
}

/** Clears all registered artifact geometry snapshots (primarily for unit test isolation). */
export function clearArtifactRotundaGeometryRegistry(): void {
  if (geometryRegistry.size === 0) return;
  geometryRegistry.clear();
  notifySubscribers();
}

/** React hook subscribing to live parsed geometry snapshots for `key`. */
export function useArtifactRotundaGeometry(
  key: string | number | null | undefined,
): ArtifactRotundaGeometrySnapshot | null {
  const norm = normalizeKey(key);
  return useSyncExternalStore(
    subscribeGeometryRegistry,
    () => (norm ? (geometryRegistry.get(norm) ?? null) : null),
    () => (norm ? (geometryRegistry.get(norm) ?? null) : null),
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function extractThreeClippingPlanes(raw: readonly unknown[]): THREE.Plane[] {
  const planes: THREE.Plane[] = [];
  for (const item of raw) {
    if (item instanceof THREE.Plane) {
      planes.push(item);
    }
  }
  return planes;
}

function computeRadialDirection(
  point: [number, number, number],
  center: [number, number, number],
  index: number,
  totalCount: number,
): [number, number, number] {
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  const dz = point[2] - center[2];
  const len = Math.hypot(dx, dy, dz);
  if (len > 1e-5) {
    return [dx / len, dy / len, dz / len];
  }
  if (totalCount <= 1) {
    return [0, 0, 0];
  }
  const angle = index * GOLDEN_ANGLE_RAD;
  const fx = Math.cos(angle) * 0.85;
  const fy = 0.35 + ((index % 3) - 1) * 0.25;
  const fz = Math.sin(angle) * 0.85;
  const fLen = Math.hypot(fx, fy, fz) || 1;
  return [fx / fLen, fy / fLen, fz / fLen];
}

function computeBoundingBoxFromSnapshot(snapshot: ArtifactRotundaGeometrySnapshot): THREE.Box3 {
  const bbox = new THREE.Box3();
  const tmpBox = new THREE.Box3();
  const tmpVec = new THREE.Vector3();

  switch (snapshot.kind) {
    case "step-meshes": {
      for (const part of snapshot.parts) {
        if (!part.geometry.boundingBox) {
          part.geometry.computeBoundingBox();
        }
        if (part.geometry.boundingBox && !part.geometry.boundingBox.isEmpty()) {
          tmpBox.copy(part.geometry.boundingBox);
          tmpVec.set(part.offset[0], part.offset[1], part.offset[2]);
          tmpBox.translate(tmpVec);
          bbox.union(tmpBox);
        }
      }
      break;
    }
    case "fea-mesh": {
      if (!snapshot.geometry.boundingBox) {
        snapshot.geometry.computeBoundingBox();
      }
      if (snapshot.geometry.boundingBox && !snapshot.geometry.boundingBox.isEmpty()) {
        bbox.copy(snapshot.geometry.boundingBox);
      } else if (snapshot.wireframePositions && snapshot.wireframePositions.length >= 3) {
        const arr = snapshot.wireframePositions;
        for (let i = 0; i + 2 < arr.length; i += 3) {
          tmpVec.set(arr[i]!, arr[i + 1]!, arr[i + 2]!);
          bbox.expandByPoint(tmpVec);
        }
      }
      break;
    }
    case "gcode-path": {
      for (const p of snapshot.cutSegments) {
        tmpVec.set(p[0], p[1], p[2]);
        bbox.expandByPoint(tmpVec);
      }
      for (const p of snapshot.rapidSegments) {
        tmpVec.set(p[0], p[1], p[2]);
        bbox.expandByPoint(tmpVec);
      }
      break;
    }
    case "multibody": {
      for (const node of snapshot.nodes) {
        tmpVec.set(node.position[0], node.position[1], node.position[2]);
        bbox.expandByPoint(tmpVec);
      }
      for (const link of snapshot.links) {
        tmpVec.set(link.from[0], link.from[1], link.from[2]);
        bbox.expandByPoint(tmpVec);
        tmpVec.set(link.to[0], link.to[1], link.to[2]);
        bbox.expandByPoint(tmpVec);
      }
      break;
    }
    case "instanced-assembly": {
      const mat = new THREE.Matrix4();
      for (const cluster of snapshot.clusters) {
        if (!cluster.geometry.boundingBox) {
          cluster.geometry.computeBoundingBox();
        }
        const localBox = cluster.geometry.boundingBox;
        for (let i = 0; i < cluster.count; i++) {
          const off = i * 16;
          if (off + 15 >= cluster.matrices.length) break;
          mat.fromArray(cluster.matrices, off);
          if (localBox && !localBox.isEmpty()) {
            tmpBox.copy(localBox).applyMatrix4(mat);
            bbox.union(tmpBox);
          } else {
            tmpVec.set(cluster.matrices[off + 12]!, cluster.matrices[off + 13]!, cluster.matrices[off + 14]!);
            bbox.expandByPoint(tmpVec);
          }
        }
      }
      break;
    }
  }

  return bbox;
}

/**
 * Computes centering and uniform scale transform placing any `ArtifactRotundaGeometrySnapshot`
 * cleanly inside a `0.78m` diameter sphere resting above the Circular Plinth (`y = 0`).
 */
export function computeSnapshotFitTransform(snapshot: ArtifactRotundaGeometrySnapshot): SnapshotFitTransform {
  const bbox = computeBoundingBoxFromSnapshot(snapshot);
  if (bbox.isEmpty()) {
    return {
      center: [0, 0, 0],
      size: [0, 0, 0],
      scale: 1,
      position: [0, 0.36, 0],
      targetCenterY: 0.36,
    };
  }

  const sizeVec = new THREE.Vector3();
  const centerVec = new THREE.Vector3();
  bbox.getSize(sizeVec);
  bbox.getCenter(centerVec);

  const diag = Math.hypot(sizeVec.x, sizeVec.y, sizeVec.z);
  const scale = diag > 1e-5 ? TARGET_PLINTH_SPHERE_DIAMETER / diag : 1;
  const halfHeight = sizeVec.y * scale * 0.5;
  const targetCenterY = Math.max(halfHeight + PLINTH_BASE_CLEARANCE_Y, FLAT_MODEL_MIN_CENTER_Y);

  return {
    center: [centerVec.x, centerVec.y, centerVec.z],
    size: [sizeVec.x, sizeVec.y, sizeVec.z],
    scale,
    position: [-centerVec.x * scale, targetCenterY - centerVec.y * scale, -centerVec.z * scale],
    targetCenterY,
  };
}

function resolveStepPartColor(
  colorRgba: [number, number, number, number] | undefined,
  partIndex: number,
): { color: string; opacity: number; transparent: boolean } {
  if (colorRgba && colorRgba.length >= 3) {
    const rawR = colorRgba[0];
    const rawG = colorRgba[1];
    const rawB = colorRgba[2];
    const needs255Norm = rawR > 1 || rawG > 1 || rawB > 1;
    const r = clamp(needs255Norm ? rawR / 255 : rawR, 0, 1);
    const g = clamp(needs255Norm ? rawG / 255 : rawG, 0, 1);
    const b = clamp(needs255Norm ? rawB / 255 : rawB, 0, 1);
    const rawA = colorRgba[3];
    const opacity = Number.isFinite(rawA) ? clamp(rawA > 1 ? rawA / 255 : rawA, 0.08, 1) : 1;
    const c = new THREE.Color(r, g, b);
    return {
      color: `#${c.getHexString()}`,
      opacity,
      transparent: opacity < 0.99,
    };
  }
  return {
    color: STEP_DEFAULT_PALETTE[partIndex % STEP_DEFAULT_PALETTE.length] ?? "#64748b",
    opacity: 1,
    transparent: false,
  };
}

interface ClippedStandardMaterialProps {
  color: string;
  vertexColors?: boolean | undefined;
  metalness?: number | undefined;
  roughness?: number | undefined;
  emissive?: string | undefined;
  emissiveIntensity?: number | undefined;
  transparent?: boolean | undefined;
  opacity?: number | undefined;
  doubleSided?: boolean | undefined;
  polygonOffset?: boolean | undefined;
  clippingPlanes: THREE.Plane[];
}

function ClippedStandardMaterial({
  color,
  vertexColors = false,
  metalness = 0.55,
  roughness = 0.32,
  emissive = "#000000",
  emissiveIntensity = 0,
  transparent = false,
  opacity = 1,
  doubleSided = false,
  polygonOffset = false,
  clippingPlanes,
}: ClippedStandardMaterialProps): React.ReactElement {
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
      vertexColors={vertexColors}
      metalness={metalness}
      roughness={roughness}
      emissive={emissive}
      emissiveIntensity={emissiveIntensity}
      transparent={transparent}
      opacity={opacity}
      side={doubleSided || hasClipping ? THREE.DoubleSide : THREE.FrontSide}
      clippingPlanes={clippingPlanes}
      clipShadows={true}
      polygonOffset={polygonOffset}
      polygonOffsetFactor={polygonOffset ? 1 : 0}
      polygonOffsetUnits={polygonOffset ? 1 : 0}
    />
  );
}

interface ClippedLineBasicMaterialProps {
  color: string;
  transparent?: boolean | undefined;
  opacity?: number | undefined;
  clippingPlanes: THREE.Plane[];
}

function ClippedLineBasicMaterial({
  color,
  transparent = false,
  opacity = 1,
  clippingPlanes,
}: ClippedLineBasicMaterialProps): React.ReactElement {
  const matRef = useRef<THREE.LineBasicMaterial | null>(null);
  const hasClipping = clippingPlanes.length > 0;

  useEffect(() => {
    const mat = matRef.current;
    if (!mat) return;
    mat.clippingPlanes = clippingPlanes;
    mat.needsUpdate = true;
  }, [clippingPlanes, hasClipping]);

  return (
    <lineBasicMaterial
      ref={matRef}
      color={color}
      transparent={transparent}
      opacity={opacity}
      clippingPlanes={clippingPlanes}
    />
  );
}

function StepMeshesRotundaContent({
  parts,
  fit,
  explodeFactor,
  clippingPlanes,
}: {
  parts: readonly StepMeshPartSnapshot[];
  fit: SnapshotFitTransform;
  explodeFactor: number;
  clippingPlanes: THREE.Plane[];
}): React.ReactElement {
  const partMeta = useMemo(() => {
    const tmpCenter = new THREE.Vector3();
    return parts.map((part, idx) => {
      if (!part.geometry.boundingBox) {
        part.geometry.computeBoundingBox();
      }
      const bb = part.geometry.boundingBox;
      const partCenter: [number, number, number] =
        bb && !bb.isEmpty()
          ? (() => {
              bb.getCenter(tmpCenter);
              return [tmpCenter.x + part.offset[0], tmpCenter.y + part.offset[1], tmpCenter.z + part.offset[2]];
            })()
          : [part.offset[0], part.offset[1], part.offset[2]];

      const explodeDir = computeRadialDirection(partCenter, fit.center, idx, parts.length);
      const appearance = resolveStepPartColor(part.colorRgba, idx);
      return { part, idx, explodeDir, appearance };
    });
  }, [parts, fit.center]);

  const safeExplode = clamp(explodeFactor, 0, 1);
  const explodeUnits = fit.scale > 1e-9 ? (safeExplode * STEP_EXPLODE_METERS) / fit.scale : 0;

  return (
    <group name="rotunda-live-step-meshes" position={fit.position} scale={[fit.scale, fit.scale, fit.scale]}>
      {partMeta.map(({ part, idx, explodeDir, appearance }) => {
        const px = part.offset[0] + explodeDir[0] * explodeUnits;
        const py = part.offset[1] + explodeDir[1] * explodeUnits;
        const pz = part.offset[2] + explodeDir[2] * explodeUnits;
        return (
          <mesh
            key={`${part.name}-${idx}`}
            name={part.name}
            geometry={part.geometry}
            position={[px, py, pz]}
            castShadow
            receiveShadow
          >
            <ClippedStandardMaterial
              color={appearance.color}
              metalness={0.72}
              roughness={0.28}
              transparent={appearance.transparent}
              opacity={appearance.opacity}
              clippingPlanes={clippingPlanes}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function FeaMeshRotundaContent({
  geometry,
  wireframePositions,
  fit,
  clippingPlanes,
}: {
  geometry: THREE.BufferGeometry;
  wireframePositions?: Float32Array | undefined;
  fit: SnapshotFitTransform;
  clippingPlanes: THREE.Plane[];
}): React.ReactElement {
  const hasVertexColors = Boolean(geometry.getAttribute("color"));

  const wireframeGeometry = useMemo(() => {
    if (!wireframePositions || wireframePositions.length < 6) return null;
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute("position", new THREE.BufferAttribute(wireframePositions, 3));
    return edgeGeo;
  }, [wireframePositions]);

  useEffect(() => {
    return () => {
      wireframeGeometry?.dispose();
    };
  }, [wireframeGeometry]);

  return (
    <group name="rotunda-live-fea-mesh" position={fit.position} scale={[fit.scale, fit.scale, fit.scale]}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <ClippedStandardMaterial
          color={hasVertexColors ? "#ffffff" : "#38bdf8"}
          vertexColors={hasVertexColors}
          metalness={0.18}
          roughness={0.38}
          doubleSided={true}
          polygonOffset={true}
          clippingPlanes={clippingPlanes}
        />
      </mesh>
      {wireframeGeometry && (
        <lineSegments geometry={wireframeGeometry}>
          <ClippedLineBasicMaterial
            color={hasVertexColors ? "#0f172a" : "#bae6fd"}
            transparent={true}
            opacity={0.68}
            clippingPlanes={clippingPlanes}
          />
        </lineSegments>
      )}
    </group>
  );
}

function buildLineSegmentsGeometry(points: readonly [number, number, number][]): THREE.BufferGeometry | null {
  if (points.length < 2) return null;
  const usableCount = points.length - (points.length % 2);
  if (usableCount < 2) return null;
  const buf = new Float32Array(usableCount * 3);
  for (let i = 0; i < usableCount; i++) {
    const p = points[i]!;
    buf[i * 3] = p[0];
    buf[i * 3 + 1] = p[1];
    buf[i * 3 + 2] = p[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(buf, 3));
  return geo;
}

function GCodePathRotundaContent({
  cutSegments,
  rapidSegments,
  fit,
  simulationTime,
  clippingPlanes,
}: {
  cutSegments: readonly [number, number, number][];
  rapidSegments: readonly [number, number, number][];
  fit: SnapshotFitTransform;
  simulationTime: number;
  clippingPlanes: THREE.Plane[];
}): React.ReactElement {
  const cutGeometry = useMemo(() => buildLineSegmentsGeometry(cutSegments), [cutSegments]);
  const rapidGeometry = useMemo(() => buildLineSegmentsGeometry(rapidSegments), [rapidSegments]);

  useEffect(() => {
    return () => {
      cutGeometry?.dispose();
      rapidGeometry?.dispose();
    };
  }, [cutGeometry, rapidGeometry]);

  const toolheadPoint = useMemo<[number, number, number] | null>(() => {
    const source = cutSegments.length >= 2 ? cutSegments : rapidSegments;
    if (source.length < 2) return null;
    const progress = (((simulationTime * 0.12) % 1) + 1) % 1;
    const idx = Math.min(source.length - 1, Math.floor(progress * source.length));
    const pt = source[idx];
    if (!pt) return null;
    return [
      (pt[0] - fit.center[0]) * fit.scale,
      (pt[1] - fit.center[1]) * fit.scale + fit.targetCenterY,
      (pt[2] - fit.center[2]) * fit.scale,
    ];
  }, [cutSegments, rapidSegments, simulationTime, fit.center, fit.scale, fit.targetCenterY]);

  return (
    <group name="rotunda-live-gcode-path">
      <group position={fit.position} scale={[fit.scale, fit.scale, fit.scale]}>
        {cutGeometry && (
          <lineSegments geometry={cutGeometry}>
            <ClippedLineBasicMaterial color="#38bdf8" clippingPlanes={clippingPlanes} />
          </lineSegments>
        )}
        {rapidGeometry && (
          <lineSegments geometry={rapidGeometry}>
            <ClippedLineBasicMaterial
              color="#f59e0b"
              transparent={true}
              opacity={0.45}
              clippingPlanes={clippingPlanes}
            />
          </lineSegments>
        )}
      </group>
      {toolheadPoint && (
        <group position={toolheadPoint}>
          <mesh rotation={[Math.PI, 0, 0]} position={[0, 0.032, 0]}>
            <coneGeometry args={[0.016, 0.064, 12]} />
            <ClippedStandardMaterial
              color="#f43f5e"
              emissive="#fb7185"
              emissiveIntensity={0.45}
              metalness={0.75}
              roughness={0.22}
              clippingPlanes={clippingPlanes}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}

function MultibodyRotundaContent({
  nodes,
  links,
  fit,
  explodeFactor,
  clippingPlanes,
}: {
  nodes: readonly MultibodyNodeSnapshot[];
  links: readonly MultibodyLinkSnapshot[];
  fit: SnapshotFitTransform;
  explodeFactor: number;
  clippingPlanes: THREE.Plane[];
}): React.ReactElement {
  const safeExplode = clamp(explodeFactor, 0, 1);

  const transformPoint = (
    raw: [number, number, number],
    index: number,
    totalCount: number,
  ): [number, number, number] => {
    const dir = computeRadialDirection(raw, fit.center, index, totalCount);
    const shift = safeExplode * MULTIBODY_EXPLODE_METERS;
    return [
      (raw[0] - fit.center[0]) * fit.scale + dir[0] * shift,
      (raw[1] - fit.center[1]) * fit.scale + fit.targetCenterY + dir[1] * shift,
      (raw[2] - fit.center[2]) * fit.scale + dir[2] * shift,
    ];
  };

  const renderedNodes = nodes.map((node, idx) => {
    const position = transformPoint(node.position, idx, nodes.length);
    const radius =
      node.radius !== undefined && Number.isFinite(node.radius) && node.radius > 0
        ? clamp(node.radius * fit.scale, 0.022, 0.085)
        : 0.038;
    return {
      id: node.id,
      label: node.label,
      position,
      color: node.color ?? "#38bdf8",
      radius,
    };
  });

  const renderedLinks = links
    .map((link, idx) => {
      const fromPt = transformPoint(link.from, idx, Math.max(2, nodes.length));
      const toPt = transformPoint(link.to, idx + 1, Math.max(2, nodes.length));
      const p1 = new THREE.Vector3(fromPt[0], fromPt[1], fromPt[2]);
      const p2 = new THREE.Vector3(toPt[0], toPt[1], toPt[2]);
      const delta = new THREE.Vector3().subVectors(p2, p1);
      const length = delta.length();
      if (length < 1e-5) return null;
      const midpoint: [number, number, number] = [(p1.x + p2.x) * 0.5, (p1.y + p2.y) * 0.5, (p1.z + p2.z) * 0.5];
      const quaternion = new THREE.Quaternion().setFromUnitVectors(UP_VECTOR, delta.normalize());
      return {
        key: `mb-link-${idx}`,
        midpoint,
        length,
        quaternion,
        color: link.color ?? "#94a3b8",
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return (
    <group name="rotunda-live-multibody">
      {renderedNodes.map((node, idx) => (
        <mesh key={`${node.id}-${idx}`} name={node.label ?? node.id} position={node.position} castShadow receiveShadow>
          <sphereGeometry args={[node.radius, 18, 18]} />
          <ClippedStandardMaterial
            color={node.color}
            metalness={0.62}
            roughness={0.28}
            clippingPlanes={clippingPlanes}
          />
        </mesh>
      ))}
      {renderedLinks.map((link) => (
        <mesh key={link.key} position={link.midpoint} quaternion={link.quaternion} castShadow receiveShadow>
          <cylinderGeometry args={[0.011, 0.011, link.length, 10]} />
          <ClippedStandardMaterial
            color={link.color}
            metalness={0.55}
            roughness={0.35}
            clippingPlanes={clippingPlanes}
          />
        </mesh>
      ))}
    </group>
  );
}

function InstancedClusterMesh({
  cluster,
  clippingPlanes,
}: {
  cluster: InstancedClusterSnapshot;
  clippingPlanes: THREE.Plane[];
}): React.ReactElement {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const mat = new THREE.Matrix4();
    const col = new THREE.Color();
    for (let i = 0; i < cluster.count; i++) {
      const off = i * 16;
      if (off + 15 >= cluster.matrices.length) break;
      mat.fromArray(cluster.matrices, off);
      mesh.setMatrixAt(i, mat);
      if (cluster.colors && i * 3 + 2 < cluster.colors.length) {
        col.setRGB(cluster.colors[i * 3]!, cluster.colors[i * 3 + 1]!, cluster.colors[i * 3 + 2]!);
        mesh.setColorAt(i, col);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [cluster]);

  return (
    <instancedMesh ref={meshRef} args={[cluster.geometry, undefined, Math.max(1, cluster.count)]} frustumCulled={false}>
      <meshStandardMaterial
        color={cluster.colors ? "#ffffff" : (cluster.baseColor ?? "#94a3b8")}
        metalness={cluster.metalness ?? 0.45}
        roughness={cluster.roughness ?? 0.32}
        clippingPlanes={clippingPlanes}
      />
    </instancedMesh>
  );
}

function InstancedAssemblyRotundaContent({
  clusters,
  fit,
  clippingPlanes,
}: {
  clusters: readonly InstancedClusterSnapshot[];
  fit: SnapshotFitTransform;
  clippingPlanes: THREE.Plane[];
}): React.ReactElement {
  return (
    <group position={fit.position} scale={[fit.scale, fit.scale, fit.scale]}>
      {clusters.map((cluster) => (
        <InstancedClusterMesh key={cluster.clusterId} cluster={cluster} clippingPlanes={clippingPlanes} />
      ))}
    </group>
  );
}

function LiveArtifactRotundaContent({
  snapshot,
  explodeFactor,
  simulationTime,
  clippingPlanes,
}: {
  snapshot: ArtifactRotundaGeometrySnapshot;
  explodeFactor: number;
  simulationTime: number;
  clippingPlanes: readonly unknown[];
}): React.ReactElement {
  const fit = useMemo(() => computeSnapshotFitTransform(snapshot), [snapshot]);
  const planes = useMemo(() => extractThreeClippingPlanes(clippingPlanes), [clippingPlanes]);

  switch (snapshot.kind) {
    case "step-meshes":
      return (
        <StepMeshesRotundaContent
          parts={snapshot.parts}
          fit={fit}
          explodeFactor={explodeFactor}
          clippingPlanes={planes}
        />
      );
    case "fea-mesh":
      return (
        <FeaMeshRotundaContent
          geometry={snapshot.geometry}
          wireframePositions={snapshot.wireframePositions}
          fit={fit}
          clippingPlanes={planes}
        />
      );
    case "gcode-path":
      return (
        <GCodePathRotundaContent
          cutSegments={snapshot.cutSegments}
          rapidSegments={snapshot.rapidSegments}
          fit={fit}
          simulationTime={simulationTime}
          clippingPlanes={planes}
        />
      );
    case "multibody":
      return (
        <MultibodyRotundaContent
          nodes={snapshot.nodes}
          links={snapshot.links}
          fit={fit}
          explodeFactor={explodeFactor}
          clippingPlanes={planes}
        />
      );
    case "instanced-assembly":
      return <InstancedAssemblyRotundaContent clusters={snapshot.clusters} fit={fit} clippingPlanes={planes} />;
  }
}

/**
 * Builds a `RotundaModelEntry["renderCustomContent"]` callback that renders the exact parsed
 * Three.js geometry snapshot scaled to fit inside a `0.78m` sphere on the Circular Plinth,
 * with live radial explode and interactive 3D section cut clipping plane support.
 */
export function buildLiveArtifactRotundaRenderer(
  snapshot: ArtifactRotundaGeometrySnapshot,
): NonNullable<RotundaModelEntry["renderCustomContent"]> {
  return ({ explodeFactor, simulationTime, clippingPlanes }) => (
    <LiveArtifactRotundaContent
      snapshot={snapshot}
      explodeFactor={explodeFactor}
      simulationTime={simulationTime}
      clippingPlanes={clippingPlanes}
    />
  );
}
