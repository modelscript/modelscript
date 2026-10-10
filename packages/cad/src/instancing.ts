// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — High-Performance Large-Assembly Instancing Engine.
 *
 * Provides geometry signature clustering, zero-allocation direct matrix composition,
 * and contiguous GPU instance buffer management for rendering assemblies with
 * 1,000 to 50,000+ components at 60 FPS.
 */

import type { AABB } from "./clearance.js";
import { quaternionFromEuler } from "./kinematics.js";
import type { Assembly, PartEntry } from "./types.js";

export interface InstancedPartDescriptor {
  name: string;
  geometryKey: string;
  position?: [number, number, number] | readonly [number, number, number];
  rotation?: [number, number, number] | readonly [number, number, number]; // in degrees
  quaternion?: [number, number, number, number] | readonly [number, number, number, number]; // [x, y, z, w]
  scale?: [number, number, number] | readonly [number, number, number];
  color?: [number, number, number] | readonly [number, number, number];
  boundingBox?: AABB;
  metadata?: Record<string, unknown>;
}

/**
 * Directly composes a 4x4 affine transformation matrix (Three.js column-major order)
 * into a target Float32Array/Float64Array buffer at a specified byte/index offset
 * with ZERO intermediate object allocations.
 */
export function composeTransformMatrixDirect(
  target: Float32Array | Float64Array | number[],
  offset: number,
  pos: [number, number, number] | readonly [number, number, number] = [0, 0, 0],
  rotOrQuat:
    | [number, number, number]
    | readonly [number, number, number]
    | [number, number, number, number]
    | readonly [number, number, number, number] = [0, 0, 0, 1],
  scale: [number, number, number] | readonly [number, number, number] = [1, 1, 1],
): void {
  let qx: number, qy: number, qz: number, qw: number;

  if (rotOrQuat.length === 4) {
    qx = rotOrQuat[0];
    qy = rotOrQuat[1];
    qz = rotOrQuat[2];
    qw = rotOrQuat[3];
  } else {
    // Euler angles in degrees (XYZ order)
    const q = quaternionFromEuler(rotOrQuat[0], rotOrQuat[1], rotOrQuat[2], "XYZ", true);
    qx = q[0];
    qy = q[1];
    qz = q[2];
    qw = q[3];
  }

  const sx = scale[0];
  const sy = scale[1];
  const sz = scale[2];

  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  // Column 0
  target[offset + 0] = (1 - (yy + zz)) * sx;
  target[offset + 1] = (xy + wz) * sx;
  target[offset + 2] = (xz - wy) * sx;
  target[offset + 3] = 0;

  // Column 1
  target[offset + 4] = (xy - wz) * sy;
  target[offset + 5] = (1 - (xx + zz)) * sy;
  target[offset + 6] = (yz + wx) * sy;
  target[offset + 7] = 0;

  // Column 2
  target[offset + 8] = (xz + wy) * sz;
  target[offset + 9] = (yz - wx) * sz;
  target[offset + 10] = (1 - (xx + yy)) * sz;
  target[offset + 11] = 0;

  // Column 3 (Translation)
  target[offset + 12] = pos[0];
  target[offset + 13] = pos[1];
  target[offset + 14] = pos[2];
  target[offset + 15] = 1;
}

/**
 * Manages contiguous GPU buffers for instance transforms and colors.
 */
export class InstanceBatchBuffer {
  readonly count: number;
  readonly matrixBuffer: Float32Array;
  readonly colorBuffer: Float32Array;
  private _matrixNeedsUpdate = true;
  private _colorNeedsUpdate = true;

  constructor(count: number) {
    this.count = count;
    this.matrixBuffer = new Float32Array(count * 16);
    this.colorBuffer = new Float32Array(count * 3);

    // Initialize with identity matrices and default white/gray colors
    for (let i = 0; i < count; i++) {
      composeTransformMatrixDirect(this.matrixBuffer, i * 16);
      this.colorBuffer[i * 3 + 0] = 0.8;
      this.colorBuffer[i * 3 + 1] = 0.8;
      this.colorBuffer[i * 3 + 2] = 0.8;
    }
  }

  get matrixNeedsUpdate(): boolean {
    return this._matrixNeedsUpdate;
  }

  get colorNeedsUpdate(): boolean {
    return this._colorNeedsUpdate;
  }

  markMatrixUpdated(): void {
    this._matrixNeedsUpdate = false;
  }

  markColorUpdated(): void {
    this._colorNeedsUpdate = false;
  }

  setInstanceTransform(
    instanceId: number,
    pos: [number, number, number] | readonly [number, number, number],
    rotOrQuat?:
      | [number, number, number]
      | readonly [number, number, number]
      | [number, number, number, number]
      | readonly [number, number, number, number],
    scale?: [number, number, number] | readonly [number, number, number],
  ): void {
    if (instanceId < 0 || instanceId >= this.count) return;
    composeTransformMatrixDirect(this.matrixBuffer, instanceId * 16, pos, rotOrQuat, scale);
    this._matrixNeedsUpdate = true;
  }

  setInstanceColor(instanceId: number, r: number, g: number, b: number): void {
    if (instanceId < 0 || instanceId >= this.count) return;
    this.colorBuffer[instanceId * 3 + 0] = r;
    this.colorBuffer[instanceId * 3 + 1] = g;
    this.colorBuffer[instanceId * 3 + 2] = b;
    this._colorNeedsUpdate = true;
  }

  getInstanceMatrix(instanceId: number): Float32Array {
    return this.matrixBuffer.subarray(instanceId * 16, instanceId * 16 + 16);
  }

  getInstancePosition(instanceId: number): [number, number, number] {
    const off = instanceId * 16;
    return [this.matrixBuffer[off + 12], this.matrixBuffer[off + 13], this.matrixBuffer[off + 14]];
  }
}

export interface InstanceCluster {
  geometryKey: string;
  count: number;
  batchBuffer: InstanceBatchBuffer;
  instanceNames: string[];
  nameToInstanceId: Map<string, number>;
  combinedAABB: AABB;
  boundingBoxes: AABB[];
}

export interface ClusteringResult {
  clusters: InstanceCluster[];
  singletons: InstancedPartDescriptor[];
  totalParts: number;
  totalClusters: number;
  drawCallReductionRatio: number;
}

export interface ClusteringOptions {
  /** Minimum parts sharing a geometryKey to form an instanced cluster (default: 2) */
  minInstanceCount?: number;
}

/**
 * Partitions assembly components into GPU-instanced batches.
 */
export class AssemblyClusteringEngine {
  /**
   * Clusters an array of part descriptors by geometryKey.
   */
  static cluster(parts: InstancedPartDescriptor[], options: ClusteringOptions = {}): ClusteringResult {
    const minCount = options.minInstanceCount ?? 2;
    const groups = new Map<string, InstancedPartDescriptor[]>();

    for (const part of parts) {
      const key = part.geometryKey || "default_solid";
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(part);
    }

    const clusters: InstanceCluster[] = [];
    const singletons: InstancedPartDescriptor[] = [];

    for (const [key, groupParts] of groups.entries()) {
      if (groupParts.length >= minCount) {
        const count = groupParts.length;
        const batchBuffer = new InstanceBatchBuffer(count);
        const instanceNames: string[] = [];
        const nameToInstanceId = new Map<string, number>();
        const boundingBoxes: AABB[] = [];

        let minX = Infinity,
          minY = Infinity,
          minZ = Infinity;
        let maxX = -Infinity,
          maxY = -Infinity,
          maxZ = -Infinity;

        for (let i = 0; i < count; i++) {
          const p = groupParts[i];
          instanceNames.push(p.name);
          nameToInstanceId.set(p.name, i);

          const pos = p.position ?? [0, 0, 0];
          const rot = p.quaternion ?? p.rotation ?? [0, 0, 0, 1];
          const scl = p.scale ?? [1, 1, 1];
          batchBuffer.setInstanceTransform(i, pos, rot, scl);

          if (p.color) {
            batchBuffer.setInstanceColor(i, p.color[0], p.color[1], p.color[2]);
          }

          // Compute/transform bounding box
          const box: AABB = p.boundingBox ?? {
            min: [-0.5 * scl[0] + pos[0], -0.5 * scl[1] + pos[1], -0.5 * scl[2] + pos[2]],
            max: [0.5 * scl[0] + pos[0], 0.5 * scl[1] + pos[1], 0.5 * scl[2] + pos[2]],
          };
          boundingBoxes.push(box);

          if (box.min[0] < minX) minX = box.min[0];
          if (box.min[1] < minY) minY = box.min[1];
          if (box.min[2] < minZ) minZ = box.min[2];
          if (box.max[0] > maxX) maxX = box.max[0];
          if (box.max[1] > maxY) maxY = box.max[1];
          if (box.max[2] > maxZ) maxZ = box.max[2];
        }

        clusters.push({
          geometryKey: key,
          count,
          batchBuffer,
          instanceNames,
          nameToInstanceId,
          combinedAABB: {
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ],
          },
          boundingBoxes,
        });
      } else {
        singletons.push(...groupParts);
      }
    }

    const totalParts = parts.length;
    const totalDrawCalls = clusters.length + singletons.length;
    const drawCallReductionRatio = totalDrawCalls > 0 ? totalParts / totalDrawCalls : 1;

    return {
      clusters,
      singletons,
      totalParts,
      totalClusters: clusters.length,
      drawCallReductionRatio,
    };
  }

  /**
   * Clusters a CAD Assembly into instanced representation.
   */
  static clusterAssembly(cadAssembly: Assembly, options: ClusteringOptions = {}): ClusteringResult {
    const descriptors: InstancedPartDescriptor[] = cadAssembly.parts.map((p, idx) => {
      // Determine signature based on solid kind and parameters
      const signature = computeSolidSignature(p);
      return {
        name: `part_${idx}`,
        geometryKey: signature,
        color: p.color,
        boundingBox: p.boundingBox,
      };
    });

    return AssemblyClusteringEngine.cluster(descriptors, options);
  }
}

/**
 * Computes a deterministic signature string for an analytical solid.
 */
function computeSolidSignature(partEntry: PartEntry): string {
  const solid = partEntry.solid;
  return `${solid.kind}:${JSON.stringify((solid as any).args ?? {})}`;
}
