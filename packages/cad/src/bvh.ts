// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Bounding Volume Hierarchy (BVH) for Large Assemblies.
 *
 * Provides hierarchical spatial partitioning (AABB tree) over thousands of
 * assembly components for sub-millisecond frustum culling, raycast picking,
 * and spatial collision/clearance queries.
 */

import type { AABB } from "./clearance.js";

export interface BVHItem {
  id: number;
  aabb: AABB;
}

export interface BVHNode {
  aabb: AABB;
  left?: BVHNode | undefined;
  right?: BVHNode | undefined;
  items?: BVHItem[] | undefined;
}

export interface RaycastHit {
  id: number;
  distance: number;
  point: [number, number, number];
}

export interface FrustumPlane {
  normal: [number, number, number];
  distance: number;
}

let bvhWasmScratch: {
  wasm: any;
  capItems: number;
  aabbsPtr: number;
  idsPtr: number;
  rayOriginPtr: number;
  rayDirPtr: number;
  hitOutPtr: number;
} | null = null;

function ensureBvhWasmScratch(wasm: any, nItems: number) {
  const reqItems = Math.max(nItems, 64);
  if (bvhWasmScratch && bvhWasmScratch.wasm === wasm && bvhWasmScratch.capItems >= reqItems) {
    return bvhWasmScratch;
  }
  const alloc = (bytes: number): number => wasm.__new(bytes, 0);
  const capItems = Math.max(reqItems, bvhWasmScratch ? bvhWasmScratch.capItems * 2 : 256);
  bvhWasmScratch = {
    wasm,
    capItems,
    aabbsPtr: alloc(capItems * 6 * 8),
    idsPtr: alloc(capItems * 4),
    rayOriginPtr: alloc(3 * 8),
    rayDirPtr: alloc(3 * 8),
    hitOutPtr: alloc(4 * 8),
  };
  return bvhWasmScratch;
}

export class AssemblyBVH {
  readonly root: BVHNode;
  readonly totalItems: number;
  readonly depth: number;
  readonly flatAABBs: Float64Array;
  readonly flatItemIds: Int32Array;

  constructor(items: BVHItem[], maxLeafSize = 4) {
    this.totalItems = items.length;
    let maxDepth = 0;

    const build = (subset: BVHItem[], currentDepth: number): BVHNode => {
      if (currentDepth > maxDepth) maxDepth = currentDepth;

      const nodeAABB = computeEnclosingAABB(subset);

      if (subset.length <= maxLeafSize) {
        return {
          aabb: nodeAABB,
          items: subset,
        };
      }

      // Find longest axis
      const dx = nodeAABB.max[0] - nodeAABB.min[0];
      const dy = nodeAABB.max[1] - nodeAABB.min[1];
      const dz = nodeAABB.max[2] - nodeAABB.min[2];

      let axis = 0;
      if (dy > dx && dy >= dz) axis = 1;
      else if (dz > dx && dz >= dy) axis = 2;

      // Sort by centroid along the longest axis
      subset.sort((a, b) => {
        const ca = 0.5 * (a.aabb.min[axis]! + a.aabb.max[axis]!);
        const cb = 0.5 * (b.aabb.min[axis]! + b.aabb.max[axis]!);
        return ca - cb;
      });

      const mid = Math.floor(subset.length / 2);
      const leftItems = subset.slice(0, mid);
      const rightItems = subset.slice(mid);

      return {
        aabb: nodeAABB,
        left: build(leftItems, currentDepth + 1),
        right: build(rightItems, currentDepth + 1),
      };
    };

    if (items.length === 0) {
      this.root = {
        aabb: { min: [0, 0, 0], max: [0, 0, 0] },
        items: [],
      };
      this.depth = 0;
      this.flatAABBs = new Float64Array(0);
      this.flatItemIds = new Int32Array(0);
    } else {
      this.root = build([...items], 1);
      this.depth = maxDepth;
      this.flatAABBs = new Float64Array(items.length * 6);
      this.flatItemIds = new Int32Array(items.length);
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const off = i * 6;
        this.flatAABBs[off] = item.aabb.min[0];
        this.flatAABBs[off + 1] = item.aabb.min[1];
        this.flatAABBs[off + 2] = item.aabb.min[2];
        this.flatAABBs[off + 3] = item.aabb.max[0];
        this.flatAABBs[off + 4] = item.aabb.max[1];
        this.flatAABBs[off + 5] = item.aabb.max[2];
        this.flatItemIds[i] = item.id;
      }
    }
  }

  /**
   * Culls instances against camera view frustum planes.
   * Returns list of visible item IDs.
   */
  queryFrustum(planes: FrustumPlane[]): number[] {
    const visibleIds: number[] = [];

    const traverse = (node: BVHNode) => {
      // Test AABB against all frustum planes
      for (let i = 0; i < planes.length; i++) {
        const plane = planes[i]!;
        // p-vertex (point on AABB furthest in the direction of the plane normal)
        const px = plane.normal[0] >= 0 ? node.aabb.max[0] : node.aabb.min[0];
        const py = plane.normal[1] >= 0 ? node.aabb.max[1] : node.aabb.min[1];
        const pz = plane.normal[2] >= 0 ? node.aabb.max[2] : node.aabb.min[2];

        if (px * plane.normal[0] + py * plane.normal[1] + pz * plane.normal[2] + plane.distance < 0) {
          // Completely outside this plane -> prune entire sub-tree
          return;
        }
      }

      if (node.items) {
        for (const item of node.items) {
          let itemVisible = true;
          for (let i = 0; i < planes.length; i++) {
            const plane = planes[i]!;
            const px = plane.normal[0] >= 0 ? item.aabb.max[0] : item.aabb.min[0];
            const py = plane.normal[1] >= 0 ? item.aabb.max[1] : item.aabb.min[1];
            const pz = plane.normal[2] >= 0 ? item.aabb.max[2] : item.aabb.min[2];
            if (px * plane.normal[0] + py * plane.normal[1] + pz * plane.normal[2] + plane.distance < 0) {
              itemVisible = false;
              break;
            }
          }
          if (itemVisible) {
            visibleIds.push(item.id);
          }
        }
      } else {
        if (node.left) traverse(node.left);
        if (node.right) traverse(node.right);
      }
    };

    traverse(this.root);
    return visibleIds;
  }

  /**
   * Query all items intersecting the given query AABB.
   */
  queryAABB(queryBox: AABB): number[] {
    const hits: number[] = [];

    const traverse = (node: BVHNode) => {
      if (!intersectAABB(node.aabb, queryBox)) return;

      if (node.items) {
        for (const item of node.items) {
          if (intersectAABB(item.aabb, queryBox)) {
            hits.push(item.id);
          }
        }
      } else {
        if (node.left) traverse(node.left);
        if (node.right) traverse(node.right);
      }
    };

    traverse(this.root);
    return hits;
  }

  /**
   * Performs an accelerated O(log N) raycast against all AABB boxes in the tree.
   * Returns closest hit item and intersection point.
   */
  raycast(
    rayOrigin: [number, number, number],
    rayDir: [number, number, number],
    maxDist = Infinity,
  ): RaycastHit | null {
    // Normalize direction
    const len = Math.hypot(rayDir[0], rayDir[1], rayDir[2]);
    if (len === 0) return null;
    const dir: [number, number, number] = [rayDir[0] / len, rayDir[1] / len, rayDir[2] / len];

    // Use flat WASM kernel only when the tree is a single leaf node; for multi-level hierarchies
    // use O(log N) BVH tree pruning so large assemblies avoid O(N) linear scans and buffer copies.
    const wasm = typeof globalThis !== "undefined" ? (globalThis as any).__modelscript_wasm_exports__ : null;
    if (this.totalItems > 0 && this.depth <= 1 && wasm && typeof wasm.cad_bvh_raycast === "function") {
      const n = this.totalItems;
      const sc = ensureBvhWasmScratch(wasm, n);
      const buf = wasm.memory.buffer as ArrayBuffer;
      new Float64Array(buf, sc.aabbsPtr, n * 6).set(this.flatAABBs);
      new Int32Array(buf, sc.idsPtr, n).set(this.flatItemIds);
      const o = new Float64Array(buf, sc.rayOriginPtr, 3);
      o[0] = rayOrigin[0];
      o[1] = rayOrigin[1];
      o[2] = rayOrigin[2];
      const d = new Float64Array(buf, sc.rayDirPtr, 3);
      d[0] = dir[0];
      d[1] = dir[1];
      d[2] = dir[2];

      const hitId: number = wasm.cad_bvh_raycast(
        n,
        sc.aabbsPtr,
        sc.idsPtr,
        sc.rayOriginPtr,
        sc.rayDirPtr,
        Number.isFinite(maxDist) ? maxDist : 1e30,
        sc.hitOutPtr,
      );
      if (hitId < 0) return null;
      const hitOut = new Float64Array(wasm.memory.buffer, sc.hitOutPtr, 4);
      return {
        id: hitId,
        distance: hitOut[0]!,
        point: [hitOut[1]!, hitOut[2]!, hitOut[3]!],
      };
    }

    let closestHit: RaycastHit | null = null;
    let closestDist = maxDist;

    const traverse = (node: BVHNode) => {
      const boxHit = intersectRayAABB(rayOrigin, dir, node.aabb);
      if (!boxHit || Math.max(0, boxHit.tMin) > closestDist) return;

      if (node.items) {
        for (const item of node.items) {
          const itemHit = intersectRayAABB(rayOrigin, dir, item.aabb);
          if (itemHit && itemHit.tMax >= 0) {
            const hitDist = Math.max(0, itemHit.tMin);
            if (hitDist < closestDist) {
              closestDist = hitDist;
              closestHit = {
                id: item.id,
                distance: closestDist,
                point: [
                  rayOrigin[0] + dir[0] * closestDist,
                  rayOrigin[1] + dir[1] * closestDist,
                  rayOrigin[2] + dir[2] * closestDist,
                ],
              };
            }
          }
        }
      } else {
        // Traverse closer child first
        const leftHit = node.left ? intersectRayAABB(rayOrigin, dir, node.left.aabb) : null;
        const rightHit = node.right ? intersectRayAABB(rayOrigin, dir, node.right.aabb) : null;
        const leftDist = leftHit ? Math.max(0, leftHit.tMin) : Infinity;
        const rightDist = rightHit ? Math.max(0, rightHit.tMin) : Infinity;

        if (leftDist < rightDist) {
          if (node.left && leftDist <= closestDist) traverse(node.left);
          if (node.right && rightDist <= closestDist) traverse(node.right);
        } else {
          if (node.right && rightDist <= closestDist) traverse(node.right);
          if (node.left && leftDist <= closestDist) traverse(node.left);
        }
      }
    };

    traverse(this.root);
    return closestHit;
  }
}

/**
 * Computes enclosing AABB for an array of BVH items.
 */
function computeEnclosingAABB(items: BVHItem[]): AABB {
  if (items.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }

  let minX = items[0]!.aabb.min[0],
    minY = items[0]!.aabb.min[1],
    minZ = items[0]!.aabb.min[2];
  let maxX = items[0]!.aabb.max[0],
    maxY = items[0]!.aabb.max[1],
    maxZ = items[0]!.aabb.max[2];

  for (let i = 1; i < items.length; i++) {
    const box = items[i]!.aabb;
    if (box.min[0] < minX) minX = box.min[0];
    if (box.min[1] < minY) minY = box.min[1];
    if (box.min[2] < minZ) minZ = box.min[2];
    if (box.max[0] > maxX) maxX = box.max[0];
    if (box.max[1] > maxY) maxY = box.max[1];
    if (box.max[2] > maxZ) maxZ = box.max[2];
  }

  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/**
 * Checks if two AABBs overlap.
 */
function intersectAABB(a: AABB, b: AABB): boolean {
  return (
    a.min[0] <= b.max[0] &&
    a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] &&
    a.max[1] >= b.min[1] &&
    a.min[2] <= b.max[2] &&
    a.max[2] >= b.min[2]
  );
}

/**
 * Ray-AABB intersection via slab method.
 */
function intersectRayAABB(
  origin: [number, number, number],
  dir: [number, number, number],
  box: AABB,
): { tMin: number; tMax: number } | null {
  let tMin = -Infinity;
  let tMax = Infinity;

  for (let i = 0; i < 3; i++) {
    const invD = 1.0 / (Math.abs(dir[i]!) > 1e-9 ? dir[i]! : 1e-9 * (dir[i]! >= 0 ? 1 : -1));
    let t0 = (box.min[i]! - origin[i]!) * invD;
    let t1 = (box.max[i]! - origin[i]!) * invD;

    if (invD < 0) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }

    tMin = t0 > tMin ? t0 : tMin;
    tMax = t1 < tMax ? t1 : tMax;

    if (tMax < tMin) return null;
  }

  if (tMax < 0) return null;

  return { tMin, tMax };
}
