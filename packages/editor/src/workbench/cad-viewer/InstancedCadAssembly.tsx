// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * InstancedCadAssembly — High-performance Three.js InstancedMesh renderer
 * for large CAD assemblies (1,000 to 50,000+ parts).
 *
 * Clusters repeated CAD models into GPU InstancedMesh batches, bypasses
 * Three.js scene-graph overhead during animations and hierarchical forward
 * kinematics via direct Float32Array matrix composition, incrementally refits
 * per-cluster AssemblyBVH bounds, switches dynamic LoD tiers with decimated
 * meshes, and provides subsystem visibility/ghosting and instance-accurate picking.
 */

import {
  AssemblyBVH,
  AssemblyClusteringEngine,
  LoDTier,
  composeTransformMatrixDirect,
  decimateMeshForLoD,
  evaluateForwardKinematics,
  selectLoDTier,
  type AABB,
  type AssemblyGraph,
  type BVHItem,
  type CameraViewportConfig,
  type ForwardKinematicsOutput,
  type InstanceCluster,
  type InstancedPartDescriptor,
} from "@modelscript/cad";
import { useGLTF } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AnimationController } from "./animation-controller";
import {
  inferSubsystemsFromPartNames,
  resolvePartPresentation,
  type AssemblyVisibilityState,
} from "./assembly-visibility";
import type { CadComponent } from "./CadViewer";
import { useRetainGltfUrl } from "./gltf-cache-guard";

// ── Constants & Scratch Values ───────────────────────────────────────────────

const LOD_DECIMATE_MIN_TRIANGLES = 240;
const LOD_DECIMATE_TARGET_RATIO = 0.25;
const DEFAULT_LOD_MIN_INSTANCES = 8;

const VIS_HIDDEN = 0;
const VIS_SOLID = 1;
const VIS_GHOSTED = 2;

const EMPTY_JOINT_VALUES: Record<string, number> = Object.freeze({});
const ZERO_SCALE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

// ── URI resolver ─────────────────────────────────────────────────────────────

function resolveModelicaUri(uri: string, baseUrl: string): string {
  const match = uri.match(/^modelica:\/\/([^/]+)\/(.+)$/);
  if (!match) return uri;
  const [, libraryName, resourcePath] = match;
  return `${baseUrl}/${libraryName}/latest/resources/${resourcePath}`;
}

// ── Zero-Allocation Geometry, AABB & LoD Helpers ─────────────────────────────

interface TemplateMeshEntry {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  origTransparent: boolean;
  origOpacity: number;
  origDepthWrite: boolean;
}

interface SharedFkCache {
  out: ForwardKinematicsOutput | undefined;
  servicedKeys: Set<string>;
  lastRenderFrame: number;
  lastElapsedTime: number;
  lastGraph: AssemblyGraph | null;
  lastJointValues: ReadonlyMap<string, number> | Record<string, number> | null | undefined;
  lastDetachedNodes: ReadonlySet<string> | null | undefined;
}

interface ClusterVisibilityPlan {
  /** Per-instance presentation mode: VIS_HIDDEN (0), VIS_SOLID (1), VIS_GHOSTED (2). */
  modes: Uint8Array;
  /** True when every instance in the cluster is hidden. */
  allHidden: boolean;
  /** True when all visible instances are ghosted (uniform ghosting on primary material). */
  allVisibleGhosted: boolean;
  /** True when the cluster mixes solid and ghosted visible instances (requires dedicated ghost pass). */
  hasMixedGhosting: boolean;
  /** Target opacity for ghosted instances. */
  ghostOpacity: number;
  /** Per-instance unit/weighted explode direction vectors (`count * 3`). */
  explodeDirections: Float32Array;
  /** Baseline explode distance multiplier derived from cluster span. */
  explodeRadius: number;
}

/**
 * Computes the tight union AABB of all template sub-mesh geometries in local space.
 */
function computeTemplateLocalAabb(meshes: readonly TemplateMeshEntry[]): AABB {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < meshes.length; i++) {
    const geo = meshes[i]!.geometry;
    if (!geo.boundingBox) {
      geo.computeBoundingBox();
    }
    const bb = geo.boundingBox;
    if (!bb || bb.isEmpty()) continue;
    if (bb.min.x < minX) minX = bb.min.x;
    if (bb.min.y < minY) minY = bb.min.y;
    if (bb.min.z < minZ) minZ = bb.min.z;
    if (bb.max.x > maxX) maxX = bb.max.x;
    if (bb.max.y > maxY) maxY = bb.max.y;
    if (bb.max.z > maxZ) maxZ = bb.max.z;
  }

  if (!Number.isFinite(minX)) {
    return { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

/**
 * Arvo's exact O(1) AABB transform by a 4x4 column-major matrix stored in a flat Float32Array.
 * Writes directly into `out` with zero allocations.
 */
function transformAabbByMatrixBuffer(
  local: AABB,
  matrixBuf: Float32Array,
  offset: number,
  out: AABB,
  offsetX = 0,
  offsetY = 0,
  offsetZ = 0,
): void {
  const lMinX = local.min[0];
  const lMinY = local.min[1];
  const lMinZ = local.min[2];
  const lMaxX = local.max[0];
  const lMaxY = local.max[1];
  const lMaxZ = local.max[2];

  const m0 = matrixBuf[offset + 0]!;
  const m1 = matrixBuf[offset + 1]!;
  const m2 = matrixBuf[offset + 2]!;
  const m4 = matrixBuf[offset + 4]!;
  const m5 = matrixBuf[offset + 5]!;
  const m6 = matrixBuf[offset + 6]!;
  const m8 = matrixBuf[offset + 8]!;
  const m9 = matrixBuf[offset + 9]!;
  const m10 = matrixBuf[offset + 10]!;
  const tx = matrixBuf[offset + 12]! + offsetX;
  const ty = matrixBuf[offset + 13]! + offsetY;
  const tz = matrixBuf[offset + 14]! + offsetZ;

  let a = m0 * lMinX;
  let b = m0 * lMaxX;
  let minX = tx + (a < b ? a : b);
  let maxX = tx + (a > b ? a : b);
  a = m4 * lMinY;
  b = m4 * lMaxY;
  minX += a < b ? a : b;
  maxX += a > b ? a : b;
  a = m8 * lMinZ;
  b = m8 * lMaxZ;
  minX += a < b ? a : b;
  maxX += a > b ? a : b;

  a = m1 * lMinX;
  b = m1 * lMaxX;
  let minY = ty + (a < b ? a : b);
  let maxY = ty + (a > b ? a : b);
  a = m5 * lMinY;
  b = m5 * lMaxY;
  minY += a < b ? a : b;
  maxY += a > b ? a : b;
  a = m9 * lMinZ;
  b = m9 * lMaxZ;
  minY += a < b ? a : b;
  maxY += a > b ? a : b;

  a = m2 * lMinX;
  b = m2 * lMaxX;
  let minZ = tz + (a < b ? a : b);
  let maxZ = tz + (a > b ? a : b);
  a = m6 * lMinY;
  b = m6 * lMaxY;
  minZ += a < b ? a : b;
  maxZ += a > b ? a : b;
  a = m10 * lMinZ;
  b = m10 * lMaxZ;
  minZ += a < b ? a : b;
  maxZ += a > b ? a : b;

  out.min[0] = minX;
  out.min[1] = minY;
  out.min[2] = minZ;
  out.max[0] = maxX;
  out.max[1] = maxY;
  out.max[2] = maxZ;
}

/**
 * Precomputes a decimated `THREE.BufferGeometry` for high-triangle meshes (`> 240` triangles)
 * via `@modelscript/cad`'s `decimateMeshForLoD`. Caller owns disposal.
 */
function createDecimatedGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr || posAttr.count === 0) return null;

  const indexAttr = geometry.getIndex();
  const triangleCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3);
  if (triangleCount <= LOD_DECIMATE_MIN_TRIANGLES) return null;

  let positions: Float32Array;
  if (posAttr instanceof THREE.BufferAttribute && posAttr.array instanceof Float32Array && posAttr.itemSize === 3) {
    positions = posAttr.array;
  } else {
    positions = new Float32Array(posAttr.count * 3);
    for (let v = 0; v < posAttr.count; v++) {
      positions[v * 3] = posAttr.getX(v);
      positions[v * 3 + 1] = posAttr.getY(v);
      positions[v * 3 + 2] = posAttr.getZ(v);
    }
  }

  let indices: Uint16Array | Uint32Array;
  if (indexAttr) {
    if (indexAttr.array instanceof Uint16Array || indexAttr.array instanceof Uint32Array) {
      indices = indexAttr.array;
    } else {
      indices = new Uint32Array(indexAttr.count);
      for (let k = 0; k < indexAttr.count; k++) {
        indices[k] = indexAttr.getX(k);
      }
    }
  } else {
    const idxCount = triangleCount * 3;
    indices = new Uint32Array(idxCount);
    for (let k = 0; k < idxCount; k++) {
      indices[k] = k;
    }
  }

  const result = decimateMeshForLoD(positions, indices, LOD_DECIMATE_TARGET_RATIO);
  if (result.decimatedTriangleCount <= 0 || result.decimatedTriangleCount >= result.originalTriangleCount) {
    return null;
  }

  const decGeo = new THREE.BufferGeometry();
  decGeo.setAttribute("position", new THREE.BufferAttribute(result.vertices, 3));
  decGeo.setAttribute("normal", new THREE.BufferAttribute(result.normals, 3));
  decGeo.setIndex(new THREE.BufferAttribute(result.indices, 1));
  decGeo.computeBoundingBox();
  decGeo.computeBoundingSphere();
  return decGeo;
}

/**
 * Resolves subsystem identity and default-ghostable metadata for any part name,
 * preferring explicit `AssemblyGraph` subsystem assignments and falling back to
 * `inferSubsystemsFromPartNames`.
 */
function resolvePartSubsystemMeta(
  name: string,
  assemblyGraph: AssemblyGraph | null | undefined,
): { id: string; defaultGhostable: boolean } {
  const nodeIdx = assemblyGraph?.nameToNodeIndex.get(name);
  const graphNode = nodeIdx !== undefined ? assemblyGraph?.nodes[nodeIdx] : undefined;
  const explicitSubId = graphNode && graphNode.subsystemId !== "default" ? graphNode.subsystemId : undefined;

  const summary = inferSubsystemsFromPartNames([{ name, subsystemId: explicitSubId }])[0];
  const id = summary?.id ?? "general";
  const graphSub = assemblyGraph?.subsystems.find((s) => s.id === id);
  const defaultGhostable =
    graphSub?.defaultGhostable ?? summary?.defaultGhostable ?? (id === "shell" || id === "mantle");
  return { id, defaultGhostable };
}

/**
 * Uploads cluster instance matrices from `matrixBuf` into primary (and optional mixed-ghost)
 * Three.js `InstancedMesh` buffers while respecting visibility masks and explode offsets.
 */
function uploadClusterMatrices(
  count: number,
  matrixBuf: Float32Array,
  primaryMeshes: readonly (THREE.InstancedMesh | null)[],
  ghostMeshes: readonly (THREE.InstancedMesh | null)[],
  visPlan: ClusterVisibilityPlan,
  explodeFactor: number,
  scratchMat: THREE.Matrix4,
  dynamicHiddenMask?: Uint8Array | null,
): void {
  const explodeScale = explodeFactor > 0 ? explodeFactor * visPlan.explodeRadius : 0;
  const explodeDirs = visPlan.explodeDirections;
  const modes = visPlan.modes;
  const hasMixed = visPlan.hasMixedGhosting;

  for (let mIdx = 0; mIdx < primaryMeshes.length; mIdx++) {
    const mesh = primaryMeshes[mIdx];
    if (!mesh) continue;
    for (let i = 0; i < count; i++) {
      const mode = modes[i]!;
      const dynHidden = dynamicHiddenMask ? dynamicHiddenMask[i] === 1 : false;
      const showOnPrimary = !dynHidden && (hasMixed ? mode === VIS_SOLID : mode !== VIS_HIDDEN);
      if (!showOnPrimary) {
        mesh.setMatrixAt(i, ZERO_SCALE_MATRIX);
      } else {
        scratchMat.fromArray(matrixBuf, i * 16);
        if (explodeScale > 0) {
          scratchMat.elements[12] = scratchMat.elements[12]! + explodeDirs[i * 3]! * explodeScale;
          scratchMat.elements[13] = scratchMat.elements[13]! + explodeDirs[i * 3 + 1]! * explodeScale;
          scratchMat.elements[14] = scratchMat.elements[14]! + explodeDirs[i * 3 + 2]! * explodeScale;
        }
        mesh.setMatrixAt(i, scratchMat);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  if (hasMixed) {
    for (let mIdx = 0; mIdx < ghostMeshes.length; mIdx++) {
      const gMesh = ghostMeshes[mIdx];
      if (!gMesh) continue;
      for (let i = 0; i < count; i++) {
        const mode = modes[i]!;
        const dynHidden = dynamicHiddenMask ? dynamicHiddenMask[i] === 1 : false;
        if (dynHidden || mode !== VIS_GHOSTED) {
          gMesh.setMatrixAt(i, ZERO_SCALE_MATRIX);
        } else {
          scratchMat.fromArray(matrixBuf, i * 16);
          if (explodeScale > 0) {
            scratchMat.elements[12] = scratchMat.elements[12]! + explodeDirs[i * 3]! * explodeScale;
            scratchMat.elements[13] = scratchMat.elements[13]! + explodeDirs[i * 3 + 1]! * explodeScale;
            scratchMat.elements[14] = scratchMat.elements[14]! + explodeDirs[i * 3 + 2]! * explodeScale;
          }
          gMesh.setMatrixAt(i, scratchMat);
        }
      }
      gMesh.instanceMatrix.needsUpdate = true;
    }
  }
}

// ── Single Instanced Cluster Renderer ────────────────────────────────────────

interface InstancedCadClusterProps {
  cluster: InstanceCluster;
  instanceScales: Float32Array;
  assetBaseUrl: string;
  selectedName?: string | null | undefined;
  onSelect?: ((name: string | null) => void) | undefined;
  animationController?: AnimationController | null | undefined;
  assemblyGraph?: AssemblyGraph | null | undefined;
  jointValues?: ReadonlyMap<string, number> | Record<string, number> | null | undefined;
  detachedNodes?: ReadonlySet<string> | null | undefined;
  sharedFkCacheRef: React.RefObject<SharedFkCache>;
  visibility?: AssemblyVisibilityState | null | undefined;
  enableDynamicLoD?: boolean | undefined;
  onBvhReady?: ((bvh: AssemblyBVH, geometryKey?: string) => void) | undefined;
}

function InstancedCadCluster({
  cluster,
  instanceScales,
  assetBaseUrl,
  selectedName,
  onSelect,
  animationController,
  assemblyGraph,
  jointValues,
  detachedNodes,
  sharedFkCacheRef,
  visibility,
  enableDynamicLoD,
  onBvhReady,
}: InstancedCadClusterProps) {
  const url = useMemo(() => resolveModelicaUri(cluster.geometryKey, assetBaseUrl), [cluster.geometryKey, assetBaseUrl]);
  useRetainGltfUrl(url);

  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group | null>(null);
  const instancedMeshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const ghostInstancedMeshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Pre-allocated scratch buffers for zero-allocation useFrame updates
  const scratchMatrixRef = useRef(new THREE.Matrix4());
  const scratchColorRef = useRef(new THREE.Color());
  const scratchPosRef = useRef<[number, number, number]>([0, 0, 0]);
  const scratchQuatRef = useRef<[number, number, number, number]>([0, 0, 0, 1]);
  const scratchScaleRef = useRef<[number, number, number]>([1, 1, 1]);
  const scratchCenterRef = useRef(new THREE.Vector3());
  const lodViewportRef = useRef<CameraViewportConfig>({
    distance: 1,
    fovDegrees: 50,
    viewportHeightPx: 1080,
  });
  const activeLodTierRef = useRef<LoDTier | null>(null);
  const prevExplodeFactorRef = useRef(0);

  const lodEnabled = enableDynamicLoD ?? cluster.count >= DEFAULT_LOD_MIN_INSTANCES;
  const explodeFactor = visibility ? Math.max(0, Math.min(1, visibility.explodeFactor)) : 0;

  // Extract all sub-meshes from the loaded GLTF model template
  const templateMeshes = useMemo<TemplateMeshEntry[]>(() => {
    const meshes: TemplateMeshEntry[] = [];
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        // Clone material so instances can share without mutating source asset
        const mat = child.material
          ? Array.isArray(child.material)
            ? child.material[0]!.clone()
            : child.material.clone()
          : new THREE.MeshStandardMaterial({ color: "#cccccc" });
        meshes.push({
          geometry: child.geometry,
          material: mat,
          origTransparent: mat.transparent,
          origOpacity: mat.opacity,
          origDepthWrite: mat.depthWrite,
        });
      }
    });
    return meshes;
  }, [scene]);

  useEffect(() => {
    instancedMeshRefs.current.length = templateMeshes.length;
    return () => {
      // Only dispose materials cloned by this component; shared scene geometries
      // stay intact while managed by useRetainGltfUrl's deferred LRU cache.
      for (const m of templateMeshes) {
        m.material.dispose();
      }
    };
  }, [templateMeshes]);

  // Precompute local-space AABB for exact world AABB transforms and BVH construction
  const templateLocalAabb = useMemo(() => computeTemplateLocalAabb(templateMeshes), [templateMeshes]);

  // Precompute decimated LoD BufferGeometries for high-triangle sub-meshes (> 240 tris)
  const decimatedGeometries = useMemo<(THREE.BufferGeometry | null)[]>(() => {
    if (!lodEnabled) {
      return templateMeshes.map(() => null);
    }
    return templateMeshes.map((m) => createDecimatedGeometry(m.geometry));
  }, [templateMeshes, lodEnabled]);

  useEffect(() => {
    return () => {
      // Detach any active decimated geometry from InstancedMeshes before disposing
      for (let idx = 0; idx < decimatedGeometries.length; idx++) {
        const decGeo = decimatedGeometries[idx];
        if (!decGeo) continue;
        const fullGeo = templateMeshes[idx]?.geometry;
        const primaryMesh = instancedMeshRefs.current[idx];
        if (primaryMesh && primaryMesh.geometry === decGeo && fullGeo) {
          primaryMesh.geometry = fullGeo;
        }
        const ghostMesh = ghostInstancedMeshRefs.current[idx];
        if (ghostMesh && ghostMesh.geometry === decGeo && fullGeo) {
          ghostMesh.geometry = fullGeo;
        }
        decGeo.dispose();
      }
    };
  }, [decimatedGeometries, templateMeshes]);

  // Pre-resolve instance index -> AssemblyGraph node index for zero-lookup FK writes
  const instanceGraphNodeIndices = useMemo(() => {
    const indices = new Int32Array(cluster.count).fill(-1);
    if (!assemblyGraph) return indices;
    for (let i = 0; i < cluster.count; i++) {
      const nodeIdx = assemblyGraph.nameToNodeIndex.get(cluster.instanceNames[i]!);
      if (nodeIdx !== undefined) {
        indices[i] = nodeIdx;
      }
    }
    return indices;
  }, [cluster, assemblyGraph]);

  // Pre-allocated dynamic-hide mask for AnimationController `visible === false`
  const dynamicHiddenMask = useMemo(() => new Uint8Array(cluster.count), [cluster.count]);

  // Resolve per-instance subsystem presentation (isolated / hidden / ghosted / explode)
  const clusterVisibility = useMemo<ClusterVisibilityPlan>(() => {
    const count = cluster.count;
    const modes = new Uint8Array(count);
    const explodeDirections = new Float32Array(count * 3);

    const cMin = cluster.combinedAABB.min;
    const cMax = cluster.combinedAABB.max;
    const centerX = 0.5 * (cMin[0] + cMax[0]);
    const centerY = 0.5 * (cMin[1] + cMax[1]);
    const centerZ = 0.5 * (cMin[2] + cMax[2]);
    const diag = Math.hypot(cMax[0] - cMin[0], cMax[1] - cMin[1], cMax[2] - cMin[2]);
    const explodeRadius = Math.max(0.25, diag * 0.35);

    const matrixBuf = cluster.batchBuffer.matrixBuffer;
    const hierarchicalExplode = visibility?.explodeMode === "hierarchical";

    let solidCount = 0;
    let ghostedCount = 0;
    let minGhostOpacity = 1;

    for (let i = 0; i < count; i++) {
      const name = cluster.instanceNames[i]!;
      if (!visibility) {
        modes[i] = VIS_SOLID;
        solidCount++;
      } else {
        const subMeta = resolvePartSubsystemMeta(name, assemblyGraph);
        const pres = resolvePartPresentation(subMeta.id, visibility, {
          isDefaultGhostable: subMeta.defaultGhostable,
          ghostNonIsolated: true,
        });
        if (!pres.visible) {
          modes[i] = VIS_HIDDEN;
        } else if (pres.ghosted) {
          modes[i] = VIS_GHOSTED;
          ghostedCount++;
          if (pres.opacity < minGhostOpacity) {
            minGhostOpacity = pres.opacity;
          }
        } else {
          modes[i] = VIS_SOLID;
          solidCount++;
        }
      }

      // Compute explode direction vector per instance
      const nodeIdx = instanceGraphNodeIndices[i]!;
      const graphNode = hierarchicalExplode && nodeIdx >= 0 ? assemblyGraph?.nodes[nodeIdx] : undefined;
      if (graphNode) {
        const weight = 1 + graphNode.depth * 0.45;
        explodeDirections[i * 3] = graphNode.explodeDirection[0] * weight;
        explodeDirections[i * 3 + 1] = graphNode.explodeDirection[1] * weight;
        explodeDirections[i * 3 + 2] = graphNode.explodeDirection[2] * weight;
      } else {
        const dx = matrixBuf[i * 16 + 12]! - centerX;
        const dy = matrixBuf[i * 16 + 13]! - centerY;
        const dz = matrixBuf[i * 16 + 14]! - centerZ;
        const len = Math.hypot(dx, dy, dz);
        if (len > 1e-6) {
          explodeDirections[i * 3] = dx / len;
          explodeDirections[i * 3 + 1] = dy / len;
          explodeDirections[i * 3 + 2] = dz / len;
        } else {
          explodeDirections[i * 3] = 0;
          explodeDirections[i * 3 + 1] = 1;
          explodeDirections[i * 3 + 2] = 0;
        }
      }
    }

    const visibleCount = solidCount + ghostedCount;
    const allHidden = visibleCount === 0;
    const hasMixedGhosting = solidCount > 0 && ghostedCount > 0;
    const allVisibleGhosted = visibleCount > 0 && solidCount === 0;
    const ghostOpacity = ghostedCount > 0 ? minGhostOpacity : 0.16;

    return {
      modes,
      allHidden,
      allVisibleGhosted,
      hasMixedGhosting,
      ghostOpacity,
      explodeDirections,
      explodeRadius,
    };
  }, [cluster, assemblyGraph, visibility, instanceGraphNodeIndices]);

  // Dedicated translucent ghost materials created ONLY when a cluster mixes solid and ghosted instances
  const ghostMaterials = useMemo<THREE.Material[] | null>(() => {
    if (!clusterVisibility.hasMixedGhosting) return null;
    return templateMeshes.map((m) => {
      const ghostMat = m.material.clone();
      ghostMat.transparent = true;
      ghostMat.opacity = 0.16;
      ghostMat.depthWrite = false;
      ghostMat.needsUpdate = true;
      return ghostMat;
    });
  }, [templateMeshes, clusterVisibility.hasMixedGhosting]);

  useEffect(() => {
    ghostInstancedMeshRefs.current.length = ghostMaterials ? ghostMaterials.length : 0;
    return () => {
      if (!ghostMaterials) return;
      for (const mat of ghostMaterials) {
        mat.dispose();
      }
    };
  }, [ghostMaterials]);

  // Sync primary and ghost material translucency with resolved subsystem presentation
  useEffect(() => {
    if (clusterVisibility.allVisibleGhosted) {
      for (const m of templateMeshes) {
        m.material.transparent = true;
        m.material.opacity = clusterVisibility.ghostOpacity;
        m.material.depthWrite = false;
        m.material.needsUpdate = true;
      }
    } else {
      for (const m of templateMeshes) {
        m.material.transparent = m.origTransparent;
        m.material.opacity = m.origOpacity;
        m.material.depthWrite = m.origDepthWrite;
        m.material.needsUpdate = true;
      }
    }

    if (ghostMaterials) {
      for (const gMat of ghostMaterials) {
        gMat.opacity = clusterVisibility.ghostOpacity;
        gMat.needsUpdate = true;
      }
    }
  }, [templateMeshes, ghostMaterials, clusterVisibility.allVisibleGhosted, clusterVisibility.ghostOpacity]);

  // Build per-cluster AssemblyBVH from initial instance world AABBs with pre-allocated refit buffers
  const bvhState = useMemo(() => {
    const count = cluster.count;
    const matrixBuf = cluster.batchBuffer.matrixBuffer;
    const worldAabbs: AABB[] = [];
    const items: BVHItem[] = [];

    for (let i = 0; i < count; i++) {
      const box: AABB = { min: [0, 0, 0], max: [0, 0, 0] };
      transformAabbByMatrixBuffer(templateLocalAabb, matrixBuf, i * 16, box);
      worldAabbs.push(box);
      items.push({
        id: i,
        aabb: {
          min: [box.min[0], box.min[1], box.min[2]],
          max: [box.max[0], box.max[1], box.max[2]],
        },
      });
    }

    const bvh = new AssemblyBVH(items);
    const lookup = (id: number): AABB | undefined => worldAabbs[id];
    return { bvh, worldAabbs, lookup };
  }, [cluster, templateLocalAabb]);

  useEffect(() => {
    onBvhReady?.(bvhState.bvh, cluster.geometryKey);
  }, [bvhState.bvh, cluster.geometryKey, onBvhReady]);

  // Upload matrices, refit BVH on explode changes, and sync mesh visibility/LoD state
  useEffect(() => {
    const count = cluster.count;
    const matrixBuf = cluster.batchBuffer.matrixBuffer;

    uploadClusterMatrices(
      count,
      matrixBuf,
      instancedMeshRefs.current,
      ghostInstancedMeshRefs.current,
      clusterVisibility,
      explodeFactor,
      scratchMatrixRef.current,
    );

    if (explodeFactor > 0 || prevExplodeFactorRef.current > 0) {
      const explodeScale = explodeFactor > 0 ? explodeFactor * clusterVisibility.explodeRadius : 0;
      const explodeDirs = clusterVisibility.explodeDirections;
      for (let i = 0; i < count; i++) {
        if (explodeScale > 0) {
          transformAabbByMatrixBuffer(
            templateLocalAabb,
            matrixBuf,
            i * 16,
            bvhState.worldAabbs[i]!,
            explodeDirs[i * 3]! * explodeScale,
            explodeDirs[i * 3 + 1]! * explodeScale,
            explodeDirs[i * 3 + 2]! * explodeScale,
          );
        } else {
          transformAabbByMatrixBuffer(templateLocalAabb, matrixBuf, i * 16, bvhState.worldAabbs[i]!);
        }
      }
      bvhState.bvh.refit(bvhState.lookup);
    }
    prevExplodeFactorRef.current = explodeFactor;

    // Reset cached LoD tier so the next frame re-evaluates cleanly; restore full geometry when LoD is disabled
    activeLodTierRef.current = null;
    for (let idx = 0; idx < templateMeshes.length; idx++) {
      const fullGeo = templateMeshes[idx]!.geometry;
      const primaryMesh = instancedMeshRefs.current[idx];
      if (primaryMesh) {
        if (!lodEnabled && primaryMesh.geometry !== fullGeo) {
          primaryMesh.geometry = fullGeo;
        }
        primaryMesh.visible = !clusterVisibility.allHidden;
      }
      const ghostMesh = ghostInstancedMeshRefs.current[idx];
      if (ghostMesh) {
        if (!lodEnabled && ghostMesh.geometry !== fullGeo) {
          ghostMesh.geometry = fullGeo;
        }
        ghostMesh.visible = clusterVisibility.hasMixedGhosting;
      }
    }
  }, [
    cluster,
    templateMeshes,
    decimatedGeometries,
    clusterVisibility,
    ghostMaterials,
    bvhState,
    templateLocalAabb,
    explodeFactor,
    lodEnabled,
  ]);

  // Upload instance colors (highlight selected & hovered instances)
  useEffect(() => {
    const selectedIdx = selectedName ? cluster.instanceNames.indexOf(selectedName) : -1;
    const count = cluster.count;
    const col = scratchColorRef.current;

    const applyColors = (meshes: readonly (THREE.InstancedMesh | null)[]) => {
      for (let mIdx = 0; mIdx < meshes.length; mIdx++) {
        const mesh = meshes[mIdx];
        if (!mesh) continue;
        for (let i = 0; i < count; i++) {
          if (i === selectedIdx) {
            col.set("#1976d2"); // Highlight blue
          } else if (i === hoveredIndex) {
            col.set("#ff6b35"); // Hover orange
          } else {
            col.setRGB(
              cluster.batchBuffer.colorBuffer[i * 3 + 0]!,
              cluster.batchBuffer.colorBuffer[i * 3 + 1]!,
              cluster.batchBuffer.colorBuffer[i * 3 + 2]!,
            );
          }
          mesh.setColorAt(i, col);
        }
        if (mesh.instanceColor) {
          mesh.instanceColor.needsUpdate = true;
        }
      }
    };

    applyColors(instancedMeshRefs.current);
    if (clusterVisibility.hasMixedGhosting) {
      applyColors(ghostInstancedMeshRefs.current);
    }
  }, [cluster, selectedName, hoveredIndex, templateMeshes, ghostMaterials, clusterVisibility.hasMixedGhosting]);

  // Animation, hierarchical FK, dynamic BVH refit, and LoD frame loop (zero per-frame allocations)
  useFrame((state) => {
    const count = cluster.count;
    const matrixBuf = cluster.batchBuffer.matrixBuffer;
    const hasActiveAnim = Boolean(animationController && animationController.mode !== "stopped");
    let hasUpdate = false;
    let hasDynHidden = false;

    if (assemblyGraph && count > 0) {
      const fkCache = sharedFkCacheRef.current;
      const nNodes = assemblyGraph.nodes.length;
      let out = fkCache.out;
      if (!out || out.positions.length < nNodes * 3 || out.quaternions.length < nNodes * 4) {
        out = {
          positions: new Float64Array(nNodes * 3),
          quaternions: new Float64Array(nNodes * 4),
        };
        fkCache.out = out;
      }

      const renderFrame = state.gl?.info?.render?.frame ?? -1;
      const elapsedTime = state.clock.elapsedTime;
      const needsFkEval =
        fkCache.lastGraph !== assemblyGraph ||
        fkCache.lastJointValues !== jointValues ||
        fkCache.lastDetachedNodes !== detachedNodes ||
        fkCache.lastRenderFrame !== renderFrame ||
        fkCache.lastElapsedTime !== elapsedTime ||
        fkCache.servicedKeys.has(cluster.geometryKey);

      if (needsFkEval) {
        fkCache.servicedKeys.clear();
        fkCache.lastGraph = assemblyGraph;
        fkCache.lastJointValues = jointValues;
        fkCache.lastDetachedNodes = detachedNodes;
        fkCache.lastRenderFrame = renderFrame;
        fkCache.lastElapsedTime = elapsedTime;
        fkCache.out = evaluateForwardKinematics(
          assemblyGraph,
          jointValues ?? EMPTY_JOINT_VALUES,
          out,
          detachedNodes ?? undefined,
        );
      }
      fkCache.servicedKeys.add(cluster.geometryKey);

      const fkOut = fkCache.out!;
      const fkPositions = fkOut.positions;
      const fkQuats = fkOut.quaternions;
      const sPos = scratchPosRef.current;
      const sQuat = scratchQuatRef.current;
      const sScale = scratchScaleRef.current;

      for (let i = 0; i < count; i++) {
        const nodeIdx = instanceGraphNodeIndices[i]!;
        if (nodeIdx >= 0) {
          const pOff = nodeIdx * 3;
          const qOff = nodeIdx * 4;
          sPos[0] = fkPositions[pOff]!;
          sPos[1] = fkPositions[pOff + 1]!;
          sPos[2] = fkPositions[pOff + 2]!;
          sQuat[0] = fkQuats[qOff]!;
          sQuat[1] = fkQuats[qOff + 1]!;
          sQuat[2] = fkQuats[qOff + 2]!;
          sQuat[3] = fkQuats[qOff + 3]!;
          sScale[0] = instanceScales[i * 3]!;
          sScale[1] = instanceScales[i * 3 + 1]!;
          sScale[2] = instanceScales[i * 3 + 2]!;
          composeTransformMatrixDirect(matrixBuf, i * 16, sPos, sQuat, sScale);
          dynamicHiddenMask[i] = 0;
          hasUpdate = true;
        } else if (hasActiveAnim && animationController) {
          const name = cluster.instanceNames[i]!;
          const tf = animationController.getTransform(name);
          composeTransformMatrixDirect(matrixBuf, i * 16, tf.position, tf.quaternion ?? tf.rotation, tf.scale);
          if (tf.visible === false) {
            dynamicHiddenMask[i] = 1;
            hasDynHidden = true;
          } else {
            dynamicHiddenMask[i] = 0;
          }
          hasUpdate = true;
        }
      }
    } else if (hasActiveAnim && animationController && count > 0) {
      for (let i = 0; i < count; i++) {
        const name = cluster.instanceNames[i]!;
        const tf = animationController.getTransform(name);

        // Direct column-major matrix composition into flat Float32Array
        composeTransformMatrixDirect(matrixBuf, i * 16, tf.position, tf.quaternion ?? tf.rotation, tf.scale);
        if (tf.visible === false) {
          dynamicHiddenMask[i] = 1;
          hasDynHidden = true;
        } else {
          dynamicHiddenMask[i] = 0;
        }
        hasUpdate = true;
      }
    }

    if (hasUpdate) {
      uploadClusterMatrices(
        count,
        matrixBuf,
        instancedMeshRefs.current,
        ghostInstancedMeshRefs.current,
        clusterVisibility,
        explodeFactor,
        scratchMatrixRef.current,
        hasDynHidden ? dynamicHiddenMask : null,
      );

      // Refit cluster AssemblyBVH in-place from updated world AABBs
      const explodeScale = explodeFactor > 0 ? explodeFactor * clusterVisibility.explodeRadius : 0;
      const explodeDirs = clusterVisibility.explodeDirections;
      for (let i = 0; i < count; i++) {
        if (explodeScale > 0) {
          transformAabbByMatrixBuffer(
            templateLocalAabb,
            matrixBuf,
            i * 16,
            bvhState.worldAabbs[i]!,
            explodeDirs[i * 3]! * explodeScale,
            explodeDirs[i * 3 + 1]! * explodeScale,
            explodeDirs[i * 3 + 2]! * explodeScale,
          );
        } else {
          transformAabbByMatrixBuffer(templateLocalAabb, matrixBuf, i * 16, bvhState.worldAabbs[i]!);
        }
      }
      bvhState.bvh.refit(bvhState.lookup);
    }

    // Dynamic LoD tier switching (Full <-> Decimated <-> Culled)
    if (lodEnabled && !clusterVisibility.allHidden && count > 0) {
      const clusterAabb = bvhState.bvh.root.aabb;
      const center = scratchCenterRef.current;
      center.set(
        0.5 * (clusterAabb.min[0] + clusterAabb.max[0]),
        0.5 * (clusterAabb.min[1] + clusterAabb.max[1]),
        0.5 * (clusterAabb.min[2] + clusterAabb.max[2]),
      );
      if (groupRef.current) {
        center.applyMatrix4(groupRef.current.matrixWorld);
      }

      const lodConfig = lodViewportRef.current;
      lodConfig.distance = state.camera.position.distanceTo(center);
      lodConfig.fovDegrees = state.camera instanceof THREE.PerspectiveCamera ? state.camera.fov : 50;
      lodConfig.viewportHeightPx = state.size.height > 0 ? state.size.height : 1080;

      const tier = selectLoDTier(clusterAabb, lodConfig);
      if (tier !== activeLodTierRef.current) {
        activeLodTierRef.current = tier;
        const useDecimated = tier === LoDTier.Decimated || tier === LoDTier.Proxy;
        const culled = tier === LoDTier.Culled;

        for (let idx = 0; idx < templateMeshes.length; idx++) {
          const fullGeo = templateMeshes[idx]!.geometry;
          const targetGeo = useDecimated ? (decimatedGeometries[idx] ?? fullGeo) : fullGeo;

          const primaryMesh = instancedMeshRefs.current[idx];
          if (primaryMesh) {
            if (primaryMesh.geometry !== targetGeo) {
              primaryMesh.geometry = targetGeo;
            }
            primaryMesh.visible = !culled && !clusterVisibility.allHidden;
          }

          if (clusterVisibility.hasMixedGhosting) {
            const ghostMesh = ghostInstancedMeshRefs.current[idx];
            if (ghostMesh) {
              if (ghostMesh.geometry !== targetGeo) {
                ghostMesh.geometry = targetGeo;
              }
              ghostMesh.visible = !culled;
            }
          }
        }
      }
    }
  });

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const instanceId = e.instanceId;
      if (
        instanceId !== undefined &&
        instanceId < cluster.instanceNames.length &&
        clusterVisibility.modes[instanceId] !== VIS_HIDDEN
      ) {
        onSelect?.(cluster.instanceNames[instanceId]!);
      }
    },
    [cluster.instanceNames, clusterVisibility.modes, onSelect],
  );

  const handlePointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const instanceId = e.instanceId;
      if (
        instanceId !== undefined &&
        instanceId < cluster.instanceNames.length &&
        clusterVisibility.modes[instanceId] !== VIS_HIDDEN
      ) {
        setHoveredIndex(instanceId);
      }
    },
    [cluster.instanceNames.length, clusterVisibility.modes],
  );

  const handlePointerOut = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  return (
    <group ref={groupRef} name={`cluster:${cluster.geometryKey}`}>
      {templateMeshes.map((m, idx) => (
        <instancedMesh
          key={idx}
          ref={(el) => {
            instancedMeshRefs.current[idx] = el;
          }}
          args={[m.geometry, m.material, cluster.count]}
          onClick={handleClick}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        />
      ))}
      {ghostMaterials?.map((ghostMat, idx) => {
        const tm = templateMeshes[idx];
        if (!tm) return null;
        return (
          <instancedMesh
            key={`ghost-${idx}`}
            ref={(el) => {
              ghostInstancedMeshRefs.current[idx] = el;
            }}
            args={[tm.geometry, ghostMat, cluster.count]}
            onClick={handleClick}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
          />
        );
      })}
    </group>
  );
}

// ── Instanced CAD Assembly Container ─────────────────────────────────────────

export interface InstancedCadAssemblyProps {
  components: CadComponent[];
  assetBaseUrl: string;
  selectedName?: string | null | undefined;
  onSelect?: ((name: string | null) => void) | undefined;
  animationController?: AnimationController | null | undefined;
  /** Minimum instances of identical geometry to trigger instancing (default: 2) */
  minInstanceCount?: number | undefined;
  /** Custom renderer for singleton components */
  renderSingleton: (component: CadComponent, index: number) => React.ReactNode;
  /** Optional hierarchical assembly graph for parent-before-child forward kinematics */
  assemblyGraph?: AssemblyGraph | null | undefined;
  /** Optional joint values driving `assemblyGraph` forward kinematics */
  jointValues?: ReadonlyMap<string, number> | Record<string, number> | null | undefined;
  /** Optional set of detached node names whose parent kinematic links are severed */
  detachedNodes?: ReadonlySet<string> | null | undefined;
  /** Optional subsystem visibility, isolation, ghost-shell, and explode presentation state */
  visibility?: AssemblyVisibilityState | null | undefined;
  /** Enable automatic dynamic LoD mesh decimation and culling (defaults to true for clusters with count >= 8) */
  enableDynamicLoD?: boolean | undefined;
  /** Optional callback notified whenever a cluster's dynamic AssemblyBVH is constructed */
  onBvhReady?: ((bvh: AssemblyBVH, geometryKey?: string) => void) | undefined;
}

export function InstancedCadAssembly({
  components,
  assetBaseUrl,
  selectedName,
  onSelect,
  animationController,
  minInstanceCount = 2,
  renderSingleton,
  assemblyGraph,
  jointValues,
  detachedNodes,
  visibility,
  enableDynamicLoD,
  onBvhReady,
}: InstancedCadAssemblyProps) {
  // Shared pre-allocated FK output cache reused across all clusters per frame (zero per-frame allocations)
  const sharedFkCacheRef = useRef<SharedFkCache>({
    out: undefined,
    servicedKeys: new Set<string>(),
    lastRenderFrame: -1,
    lastElapsedTime: -1,
    lastGraph: null,
    lastJointValues: undefined,
    lastDetachedNodes: undefined,
  });

  // Pre-allocate FK typed-array buffers whenever the assemblyGraph changes
  useEffect(() => {
    if (!assemblyGraph) return;
    const n = assemblyGraph.nodes.length;
    const cur = sharedFkCacheRef.current.out;
    if (!cur || cur.positions.length < n * 3 || cur.quaternions.length < n * 4) {
      sharedFkCacheRef.current.out = {
        positions: new Float64Array(n * 3),
        quaternions: new Float64Array(n * 4),
      };
    }
    sharedFkCacheRef.current.lastGraph = null;
  }, [assemblyGraph]);

  // Cluster components into instanced batches and singletons
  const { clusters, scalesByClusterKey, singletonComponents } = useMemo(() => {
    const gltfComponents = components.filter((c) => !c.proceduralMesh && !c.cad.uri?.startsWith("procedural://"));
    const proceduralComponents = components.filter(
      (c) => Boolean(c.proceduralMesh) || Boolean(c.cad.uri?.startsWith("procedural://")),
    );

    const componentByName = new Map(gltfComponents.map((c) => [c.name, c]));

    const descriptors: InstancedPartDescriptor[] = gltfComponents.map((comp) => ({
      name: comp.name,
      geometryKey: comp.cad.uri,
      position: comp.cad.position ?? [0, 0, 0],
      rotation: comp.cad.rotation ?? [0, 0, 0],
      scale: comp.cad.scale ?? [1, 1, 1],
    }));

    const result = AssemblyClusteringEngine.cluster(descriptors, { minInstanceCount });

    const scaleMap = new Map<string, Float32Array>();
    for (const cluster of result.clusters) {
      const scales = new Float32Array(cluster.count * 3);
      for (let i = 0; i < cluster.count; i++) {
        const comp = componentByName.get(cluster.instanceNames[i]!);
        const scl = comp?.cad.scale;
        scales[i * 3] = scl ? scl[0] : 1;
        scales[i * 3 + 1] = scl ? scl[1] : 1;
        scales[i * 3 + 2] = scl ? scl[2] : 1;
      }
      scaleMap.set(cluster.geometryKey, scales);
    }

    // Map singletons back to original CadComponent
    const singletonComps = [
      ...result.singletons.map((s) => componentByName.get(s.name)).filter((c): c is CadComponent => c !== undefined),
      ...proceduralComponents,
    ];

    return {
      clusters: result.clusters,
      scalesByClusterKey: scaleMap,
      singletonComponents: singletonComps,
    };
  }, [components, minInstanceCount]);

  // Filter hidden singletons when assembly visibility state is provided
  const visibleSingletonComponents = useMemo(() => {
    if (!visibility) return singletonComponents;
    return singletonComponents.filter((comp) => {
      const subMeta = resolvePartSubsystemMeta(comp.name, assemblyGraph);
      const pres = resolvePartPresentation(subMeta.id, visibility, {
        isDefaultGhostable: subMeta.defaultGhostable,
        ghostNonIsolated: true,
      });
      return pres.visible;
    });
  }, [singletonComponents, visibility, assemblyGraph]);

  return (
    <group name="instanced-assembly">
      {/* Instanced clusters */}
      {clusters.map((cluster) => (
        <Suspense key={cluster.geometryKey} fallback={null}>
          <InstancedCadCluster
            cluster={cluster}
            instanceScales={scalesByClusterKey.get(cluster.geometryKey)!}
            assetBaseUrl={assetBaseUrl}
            selectedName={selectedName}
            onSelect={onSelect}
            animationController={animationController}
            assemblyGraph={assemblyGraph}
            jointValues={jointValues}
            detachedNodes={detachedNodes}
            sharedFkCacheRef={sharedFkCacheRef}
            visibility={visibility}
            enableDynamicLoD={enableDynamicLoD}
            onBvhReady={onBvhReady}
          />
        </Suspense>
      ))}

      {/* Singletons */}
      {visibleSingletonComponents.map((comp, idx) => renderSingleton(comp, idx))}
    </group>
  );
}
