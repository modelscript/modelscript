// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * TypeScript Bridge for WebAssembly 3D CAD (BVH, Exact Mesh Clearance, BSP Split)
 * and Orthogonal A* Schematic Diagram Routing Kernels.
 */

import { getDefaultWasmExports } from "../dae/wasm_dae.js";

let cadScratch: {
  wasm: any;
  aabbAPtr: number;
  aabbBPtr: number;
  triAPtr: number;
  triBPtr: number;
  planeNormalPtr: number;
  countsOutPtr: number;
  rayOriginPtr: number;
  rayDirPtr: number;
  hitOutPtr: number;
} | null = null;

function ensureCadScratch(wasm: any) {
  if (!cadScratch || cadScratch.wasm !== wasm) {
    const alloc = (bytes: number): number => wasm.__new(bytes, 0);
    cadScratch = {
      wasm,
      aabbAPtr: alloc(6 * 8),
      aabbBPtr: alloc(6 * 8),
      triAPtr: alloc(9 * 8),
      triBPtr: alloc(9 * 8),
      planeNormalPtr: alloc(3 * 8),
      countsOutPtr: alloc(2 * 4),
      rayOriginPtr: alloc(3 * 8),
      rayDirPtr: alloc(3 * 8),
      hitOutPtr: alloc(4 * 8),
    };
  }
  return cadScratch;
}

/**
 * Computes signed Euclidean distance between two 3D AABBs using the WASM kernel.
 * Returns > 0 for separated boxes, 0 for touching, < 0 for penetration depth.
 */
export function computeAabbDistanceWasm(
  minA: readonly [number, number, number],
  maxA: readonly [number, number, number],
  minB: readonly [number, number, number],
  maxB: readonly [number, number, number],
): number {
  const wasm: any = getDefaultWasmExports();
  if (!wasm || typeof wasm.cad_aabb_distance !== "function") {
    throw new Error("WASM cad_aabb_distance kernel not available");
  }
  const s = ensureCadScratch(wasm);
  const buf = wasm.memory.buffer;
  const a = new Float64Array(buf, s.aabbAPtr, 6);
  a[0] = minA[0];
  a[1] = minA[1];
  a[2] = minA[2];
  a[3] = maxA[0];
  a[4] = maxA[1];
  a[5] = maxA[2];

  const b = new Float64Array(buf, s.aabbBPtr, 6);
  b[0] = minB[0];
  b[1] = minB[1];
  b[2] = minB[2];
  b[3] = maxB[0];
  b[4] = maxB[1];
  b[5] = maxB[2];

  return wasm.cad_aabb_distance(s.aabbAPtr, s.aabbBPtr);
}

/**
 * Performs slab-method raycast over packed AABBs (`6 * numItems` f64s) in WASM linear memory.
 */
export function raycastBvhWasm(
  aabbs: Float64Array,
  ids: Int32Array,
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  maxDist = 1e30,
): { id: number; distance: number; point: [number, number, number] } | null {
  const wasm: any = getDefaultWasmExports();
  if (!wasm || typeof wasm.cad_bvh_raycast !== "function") {
    throw new Error("WASM cad_bvh_raycast kernel not available");
  }
  const numItems = ids.length;
  if (numItems === 0) return null;

  const s = ensureCadScratch(wasm);
  const aabbsPtr = wasm.__new(numItems * 6 * 8, 0);
  const idsPtr = wasm.__new(numItems * 4, 0);

  const buf = wasm.memory.buffer;
  new Float64Array(buf, aabbsPtr, numItems * 6).set(aabbs.subarray(0, numItems * 6));
  new Int32Array(buf, idsPtr, numItems).set(ids);

  const o = new Float64Array(buf, s.rayOriginPtr, 3);
  o[0] = origin[0];
  o[1] = origin[1];
  o[2] = origin[2];

  const d = new Float64Array(buf, s.rayDirPtr, 3);
  d[0] = dir[0];
  d[1] = dir[1];
  d[2] = dir[2];

  const hitId: number = wasm.cad_bvh_raycast(
    numItems,
    aabbsPtr,
    idsPtr,
    s.rayOriginPtr,
    s.rayDirPtr,
    maxDist,
    s.hitOutPtr,
  );
  if (hitId < 0) return null;

  const hitOut = new Float64Array(wasm.memory.buffer, s.hitOutPtr, 4);
  return {
    id: hitId,
    distance: hitOut[0]!,
    point: [hitOut[1]!, hitOut[2]!, hitOut[3]!],
  };
}

/**
 * Performs hierarchical stack-based BVH tree raycasting against 64-byte nodes in WASM.
 */
export function raycastBvhTreeWasm(
  nodes: Float64Array,
  numNodes: number,
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  maxDist = 1e30,
): { id: number; distance: number; point: [number, number, number] } | null {
  const wasm: any = getDefaultWasmExports();
  if (!wasm || typeof wasm.cad_bvh_tree_raycast !== "function") {
    throw new Error("WASM cad_bvh_tree_raycast kernel not available");
  }
  if (numNodes === 0) return null;

  const s = ensureCadScratch(wasm);
  const nodesPtr = wasm.__new(numNodes * 64, 0);

  const buf = wasm.memory.buffer;
  new Float64Array(buf, nodesPtr, numNodes * 8).set(nodes.subarray(0, numNodes * 8));

  const o = new Float64Array(buf, s.rayOriginPtr, 3);
  o[0] = origin[0];
  o[1] = origin[1];
  o[2] = origin[2];

  const d = new Float64Array(buf, s.rayDirPtr, 3);
  d[0] = dir[0];
  d[1] = dir[1];
  d[2] = dir[2];

  const hitId: number = wasm.cad_bvh_tree_raycast(
    numNodes,
    nodesPtr,
    s.rayOriginPtr,
    s.rayDirPtr,
    maxDist,
    s.hitOutPtr,
  );
  if (hitId < 0) return null;

  const hitOut = new Float64Array(wasm.memory.buffer, s.hitOutPtr, 4);
  return {
    id: hitId,
    distance: hitOut[0]!,
    point: [hitOut[1]!, hitOut[2]!, hitOut[3]!],
  };
}

/**
 * Computes exact squared Euclidean distance between two 3D triangles (9 f64s each) in WASM.
 */
export function computeTriTriMinDistanceSqWasm(triA: Float64Array, triB: Float64Array): number {
  const wasm: any = getDefaultWasmExports();
  if (!wasm || typeof wasm.cad_tri_tri_min_distance_sq !== "function") {
    throw new Error("WASM cad_tri_tri_min_distance_sq kernel not available");
  }
  const s = ensureCadScratch(wasm);
  const buf = wasm.memory.buffer;
  new Float64Array(buf, s.triAPtr, 9).set(triA.subarray(0, 9));
  new Float64Array(buf, s.triBPtr, 9).set(triB.subarray(0, 9));
  return wasm.cad_tri_tri_min_distance_sq(s.triAPtr, s.triBPtr);
}

/**
 * Evaluates exact minimum Euclidean clearance between two triangle meshes
 * (`trisA`: `9 * numTrisA` f64s, `trisB`: `9 * numTrisB` f64s) in WASM linear memory.
 */
export function computeMeshPairMinClearanceWasm(
  trisA: Float64Array,
  trisB: Float64Array,
  earlyExitThreshold = 0.0,
): number {
  const wasm: any = getDefaultWasmExports();
  if (!wasm || typeof wasm.cad_mesh_pair_min_clearance !== "function") {
    throw new Error("WASM cad_mesh_pair_min_clearance kernel not available");
  }
  const numTrisA = Math.floor(trisA.length / 9);
  const numTrisB = Math.floor(trisB.length / 9);
  if (numTrisA === 0 || numTrisB === 0) return Infinity;

  const trisAPtr = wasm.__new(numTrisA * 9 * 8, 0);
  const trisBPtr = wasm.__new(numTrisB * 9 * 8, 0);
  new Float64Array(wasm.memory.buffer, trisAPtr, numTrisA * 9).set(trisA.subarray(0, numTrisA * 9));
  new Float64Array(wasm.memory.buffer, trisBPtr, numTrisB * 9).set(trisB.subarray(0, numTrisB * 9));

  return wasm.cad_mesh_pair_min_clearance(numTrisA, trisAPtr, numTrisB, trisBPtr, earlyExitThreshold);
}

/**
 * Classifies and splits a 3D convex polygon against a BSP splitting plane in WASM linear memory.
 * Classification codes: 0 = COPLANAR, 1 = FRONT, 2 = BACK, 3 = SPANNING.
 */
export function bspSplitPolygonWasm(
  vertices: Float64Array,
  planeNormal: readonly [number, number, number],
  planeW: number,
): { classification: number; front: Float64Array; back: Float64Array } {
  const wasm: any = getDefaultWasmExports();
  if (!wasm || typeof wasm.cad_bsp_split_polygon !== "function") {
    throw new Error("WASM cad_bsp_split_polygon kernel not available");
  }
  const numVerts = Math.floor(vertices.length / 3);
  const maxOutVerts = numVerts + 4;
  const vertsPtr = wasm.__new(numVerts * 3 * 8, 0);
  const frontOutPtr = wasm.__new(maxOutVerts * 3 * 8, 0);
  const backOutPtr = wasm.__new(maxOutVerts * 3 * 8, 0);

  const s = ensureCadScratch(wasm);
  const buf = wasm.memory.buffer;
  new Float64Array(buf, vertsPtr, numVerts * 3).set(vertices.subarray(0, numVerts * 3));
  const nArr = new Float64Array(buf, s.planeNormalPtr, 3);
  nArr[0] = planeNormal[0];
  nArr[1] = planeNormal[1];
  nArr[2] = planeNormal[2];

  const classification: number = wasm.cad_bsp_split_polygon(
    numVerts,
    vertsPtr,
    s.planeNormalPtr,
    planeW,
    frontOutPtr,
    backOutPtr,
    s.countsOutPtr,
  );

  if (classification !== 3) {
    return {
      classification,
      front: classification === 1 ? vertices.slice(0, numVerts * 3) : new Float64Array(0),
      back: classification === 2 ? vertices.slice(0, numVerts * 3) : new Float64Array(0),
    };
  }

  const counts = new Int32Array(wasm.memory.buffer, s.countsOutPtr, 2);
  const nFront = counts[0]!;
  const nBack = counts[1]!;
  const front = new Float64Array(nFront * 3);
  front.set(new Float64Array(wasm.memory.buffer, frontOutPtr, nFront * 3));
  const back = new Float64Array(nBack * 3);
  back.set(new Float64Array(wasm.memory.buffer, backOutPtr, nBack * 3));

  return { classification, front, back };
}

/**
 * Routes an orthogonal connection on a 2D grid (`cols x rows`) using the WebAssembly
 * binary-heap A* kernel with bend and wire-crossing penalties.
 */
export function routeOrthogonalAStarWasm(options: {
  cols: number;
  rows: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startDir?: number | undefined;
  bendPenalty?: number | undefined;
  crossingPenalty?: number | undefined;
  grid: Uint8Array;
}): [number, number][] {
  const wasm: any = getDefaultWasmExports();
  if (!wasm || typeof wasm.diagram_route_orthogonal_astar !== "function") {
    throw new Error("WASM diagram_route_orthogonal_astar kernel not available");
  }
  const { cols, rows, startX, startY, endX, endY, grid } = options;
  const totalCells = cols * rows;
  const totalStates = totalCells * 4;
  const maxWaypoints = Math.min(totalCells, 1024);

  const alloc = (bytes: number): number => wasm.__new(bytes, 0);
  const gridPtr = alloc(totalCells);
  const gScorePtr = alloc(totalStates * 8);
  const parentPtr = alloc(totalStates * 4);
  const closedPtr = alloc(totalStates);
  const heapStatesPtr = alloc(totalStates * 4);
  const heapPrioritiesPtr = alloc(totalStates * 8);
  const outWaypointsPtr = alloc(maxWaypoints * 2 * 4);

  new Uint8Array(wasm.memory.buffer, gridPtr, totalCells).set(grid.subarray(0, totalCells));

  const count: number = wasm.diagram_route_orthogonal_astar(
    cols,
    rows,
    startX,
    startY,
    endX,
    endY,
    options.startDir ?? -1,
    options.bendPenalty ?? 2.5,
    options.crossingPenalty ?? 4.0,
    gridPtr,
    gScorePtr,
    parentPtr,
    closedPtr,
    heapStatesPtr,
    heapPrioritiesPtr,
    outWaypointsPtr,
    maxWaypoints,
  );

  const outView = new Int32Array(wasm.memory.buffer, outWaypointsPtr, count * 2);
  const waypoints: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    waypoints.push([outView[i * 2]!, outView[i * 2 + 1]!]);
  }
  return waypoints;
}

/**
 * Evaluates exact minimum edge-to-edge Euclidean clearance between two 2D PCB traces
 * (`pts1`: `2 * nPts1` f64s with width `w1`, `pts2`: `2 * nPts2` f64s with width `w2`) in WASM.
 */
export function computeEcadTracePairMinClearanceWasm(
  pts1: Float64Array,
  w1: number,
  pts2: Float64Array,
  w2: number,
): number {
  const wasm: any = getDefaultWasmExports();
  if (!wasm || typeof wasm.ecad_drc_trace_pair_min_clearance !== "function") {
    throw new Error("WASM ecad_drc_trace_pair_min_clearance kernel not available");
  }
  const nPts1 = Math.floor(pts1.length / 2);
  const nPts2 = Math.floor(pts2.length / 2);
  if (nPts1 < 2 || nPts2 < 2) return Infinity;

  const pts1Ptr = wasm.__new(nPts1 * 2 * 8, 0);
  const pts2Ptr = wasm.__new(nPts2 * 2 * 8, 0);
  new Float64Array(wasm.memory.buffer, pts1Ptr, nPts1 * 2).set(pts1.subarray(0, nPts1 * 2));
  new Float64Array(wasm.memory.buffer, pts2Ptr, nPts2 * 2).set(pts2.subarray(0, nPts2 * 2));

  return wasm.ecad_drc_trace_pair_min_clearance(nPts1, pts1Ptr, w1, nPts2, pts2Ptr, w2);
}

/**
 * Evaluates distance from a 2D point `(px, py)` to a 2D polygon (`poly`: `2 * nVerts` f64s) in WASM.
 * Returns 0 if `(px, py)` is inside the polygon.
 */
export function computeEcadPointToPolygonDistWasm(px: number, py: number, poly: Float64Array): number {
  const wasm: any = getDefaultWasmExports();
  if (!wasm || typeof wasm.ecad_drc_point_to_polygon_dist !== "function") {
    throw new Error("WASM ecad_drc_point_to_polygon_dist kernel not available");
  }
  const nVerts = Math.floor(poly.length / 2);
  if (nVerts < 3) return Infinity;

  const polyPtr = wasm.__new(nVerts * 2 * 8, 0);
  new Float64Array(wasm.memory.buffer, polyPtr, nVerts * 2).set(poly.subarray(0, nVerts * 2));
  return wasm.ecad_drc_point_to_polygon_dist(px, py, nVerts, polyPtr);
}

/**
 * Multiplies two 4x4 row-major affine transformation matrices in WASM linear memory.
 */
export function multiplyMat4Wasm(a: Float64Array, b: Float64Array): Float64Array {
  const wasm: any = getDefaultWasmExports();
  if (!wasm || typeof wasm.scad_multiply_mat4 !== "function") {
    throw new Error("WASM scad_multiply_mat4 kernel not available");
  }
  const aPtr = wasm.__new(16 * 8, 0);
  const bPtr = wasm.__new(16 * 8, 0);
  const outPtr = wasm.__new(16 * 8, 0);
  new Float64Array(wasm.memory.buffer, aPtr, 16).set(a.subarray(0, 16));
  new Float64Array(wasm.memory.buffer, bPtr, 16).set(b.subarray(0, 16));
  wasm.scad_multiply_mat4(aPtr, bPtr, outPtr);
  const res = new Float64Array(16);
  res.set(new Float64Array(wasm.memory.buffer, outPtr, 16));
  return res;
}

/**
 * Compacts 1D integer TSM grid coordinates in WASM linear memory, returning
 * `{ compacted: Int32Array, span: number }`.
 */
export function compactTsm1DWasm(coords: Int32Array): { compacted: Int32Array; span: number } {
  const wasm: any = getDefaultWasmExports();
  if (!wasm || typeof wasm.diagram_tsm_compact_1d !== "function") {
    throw new Error("WASM diagram_tsm_compact_1d kernel not available");
  }
  const n = coords.length;
  if (n === 0) return { compacted: new Int32Array(0), span: 0 };
  const coordsPtr = wasm.__new(n * 4, 0);
  const outPtr = wasm.__new(n * 4, 0);
  new Int32Array(wasm.memory.buffer, coordsPtr, n).set(coords);
  const span: number = wasm.diagram_tsm_compact_1d(n, coordsPtr, outPtr);
  const compacted = new Int32Array(n);
  compacted.set(new Int32Array(wasm.memory.buffer, outPtr, n));
  return { compacted, span };
}

/**
 * Solves 1D monotonic port alignment with minimum spacing `minSpacing` and box bounds
 * `[minBound, maxBound]` for sorted target offsets in WASM linear memory.
 */
export function alignPorts1DWasm(
  targets: Float64Array,
  minSpacing: number,
  minBound: number,
  maxBound: number,
): Float64Array {
  const wasm: any = getDefaultWasmExports();
  if (!wasm || typeof wasm.diagram_port_align_1d !== "function") {
    throw new Error("WASM diagram_port_align_1d kernel not available");
  }
  const n = targets.length;
  if (n === 0) return new Float64Array(0);
  const targetsPtr = wasm.__new(n * 8, 0);
  const outPtr = wasm.__new(n * 8, 0);
  new Float64Array(wasm.memory.buffer, targetsPtr, n).set(targets);
  wasm.diagram_port_align_1d(n, targetsPtr, minSpacing, minBound, maxBound, outPtr);
  const out = new Float64Array(n);
  out.set(new Float64Array(wasm.memory.buffer, outPtr, n));
  return out;
}
