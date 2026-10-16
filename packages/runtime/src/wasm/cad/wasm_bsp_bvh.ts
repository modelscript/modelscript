// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly 3D CAD Spatial BVH, Triangle-Triangle Clearance, and BSP Polygon Splitting Kernel.
 *
 * Provides zero-allocation linear-memory implementations of:
 * - Signed AABB-to-AABB Euclidean distance & penetration depth (`cad_aabb_distance`)
 * - Fast slab-method Ray-AABB intersection scanning (`cad_bvh_raycast`)
 * - Exact 3D Triangle-to-Triangle squared Euclidean distance (`cad_tri_tri_min_distance_sq`)
 * - Broadphase-culled Mesh-to-Mesh exact minimum clearance (`cad_mesh_pair_min_clearance`)
 * - 3D CSG BSP polygon classification and spanning split (`cad_bsp_split_polygon`)
 */

/**
 * Computes the signed Euclidean distance between two 3D AABBs (`aPtr` and `bPtr`,
 * each 6 f64s: [minX, minY, minZ, maxX, maxY, maxZ]).
 * Returns > 0 for separated boxes, 0 for touching, < 0 for penetration depth.
 */
export function cad_aabb_distance(aPtr: usize, bPtr: usize): f64 {
  const aMinX = load<f64>(aPtr + 0);
  const aMinY = load<f64>(aPtr + 8);
  const aMinZ = load<f64>(aPtr + 16);
  const aMaxX = load<f64>(aPtr + 24);
  const aMaxY = load<f64>(aPtr + 32);
  const aMaxZ = load<f64>(aPtr + 40);

  const bMinX = load<f64>(bPtr + 0);
  const bMinY = load<f64>(bPtr + 8);
  const bMinZ = load<f64>(bPtr + 16);
  const bMaxX = load<f64>(bPtr + 24);
  const bMaxY = load<f64>(bPtr + 32);
  const bMaxZ = load<f64>(bPtr + 40);

  let dx: f64 = 0.0;
  if (aMaxX < bMinX) dx = bMinX - aMaxX;
  else if (bMaxX < aMinX) dx = aMinX - bMaxX;

  let dy: f64 = 0.0;
  if (aMaxY < bMinY) dy = bMinY - aMaxY;
  else if (bMaxY < aMinY) dy = aMinY - bMaxY;

  let dz: f64 = 0.0;
  if (aMaxZ < bMinZ) dz = bMinZ - aMaxZ;
  else if (bMaxZ < aMinZ) dz = aMinZ - bMaxZ;

  if (dx > 0.0 || dy > 0.0 || dz > 0.0) {
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  const overlapX = Math.min(aMaxX, bMaxX) - Math.max(aMinX, bMinX);
  const overlapY = Math.min(aMaxY, bMaxY) - Math.max(aMinY, bMinY);
  const overlapZ = Math.min(aMaxZ, bMaxZ) - Math.max(aMinZ, bMinZ);
  const pen = Math.min(overlapX, Math.min(overlapY, overlapZ));
  return -Math.max(0.0, pen);
}

/**
 * Performs slab-method raycast against `numItems` AABBs in linear memory (`aabbsPtr`, 6 f64s each).
 * Writes `[closestDist, hitX, hitY, hitZ]` to `hitOutPtr` (4 f64s) and returns the hit item ID (or -1).
 */
export function cad_bvh_raycast(
  numItems: i32,
  aabbsPtr: usize,
  idsPtr: usize,
  rayOriginPtr: usize,
  rayDirPtr: usize,
  maxDist: f64,
  hitOutPtr: usize
): i32 {
  const ox = load<f64>(rayOriginPtr + 0);
  const oy = load<f64>(rayOriginPtr + 8);
  const oz = load<f64>(rayOriginPtr + 16);

  let dx = load<f64>(rayDirPtr + 0);
  let dy = load<f64>(rayDirPtr + 8);
  let dz = load<f64>(rayDirPtr + 16);
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len <= 1e-15) return -1;
  dx /= len;
  dy /= len;
  dz /= len;

  let closestDist = maxDist;
  let closestId: i32 = -1;

  for (let i: i32 = 0; i < numItems; i++) {
    const base = aabbsPtr + (((i * 6) as usize) << 3);
    const minX = load<f64>(base + 0);
    const minY = load<f64>(base + 8);
    const minZ = load<f64>(base + 16);
    const maxX = load<f64>(base + 24);
    const maxY = load<f64>(base + 32);
    const maxZ = load<f64>(base + 40);

    let tMin: f64 = -1e30;
    let tMax: f64 = 1e30;
    let valid: bool = true;

    // X slab
    if (Math.abs(dx) < 1e-12) {
      if (ox < minX || ox > maxX) valid = false;
    } else {
      let t1 = (minX - ox) / dx;
      let t2 = (maxX - ox) / dx;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) valid = false;
    }

    // Y slab
    if (valid) {
      if (Math.abs(dy) < 1e-12) {
        if (oy < minY || oy > maxY) valid = false;
      } else {
        let t1 = (minY - oy) / dy;
        let t2 = (maxY - oy) / dy;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) valid = false;
      }
    }

    // Z slab
    if (valid) {
      if (Math.abs(dz) < 1e-12) {
        if (oz < minZ || oz > maxZ) valid = false;
      } else {
        let t1 = (minZ - oz) / dz;
        let t2 = (maxZ - oz) / dz;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) valid = false;
      }
    }

    if (valid && tMax >= 0.0) {
      const tHit = tMin >= 0.0 ? tMin : 0.0;
      if (tHit < closestDist) {
        closestDist = tHit;
        closestId = load<i32>(idsPtr + ((i as usize) << 2));
      }
    }
  }

  if (closestId >= 0) {
    store<f64>(hitOutPtr + 0, closestDist);
    store<f64>(hitOutPtr + 8, ox + dx * closestDist);
    store<f64>(hitOutPtr + 16, oy + dy * closestDist);
    store<f64>(hitOutPtr + 24, oz + dz * closestDist);
  }
  return closestId;
}

@inline
function pointToTriangleDistSq(
  px: f64,
  py: f64,
  pz: f64,
  ax: f64,
  ay: f64,
  az: f64,
  bx: f64,
  by: f64,
  bz: f64,
  cx: f64,
  cy: f64,
  cz: f64
): f64 {
  const abx = bx - ax,
    aby = by - ay,
    abz = bz - az;
  const acx = cx - ax,
    acy = cy - ay,
    acz = cz - az;
  const apx = px - ax,
    apy = py - ay,
    apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0.0 && d2 <= 0.0) {
    return apx * apx + apy * apy + apz * apz;
  }

  const bpx = px - bx,
    bpy = py - by,
    bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0.0 && d4 <= d3) {
    return bpx * bpx + bpy * bpy + bpz * bpz;
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
    const v = d1 / (d1 - d3);
    const qx = ax + v * abx - px;
    const qy = ay + v * aby - py;
    const qz = az + v * abz - pz;
    return qx * qx + qy * qy + qz * qz;
  }

  const cpx = px - cx,
    cpy = py - cy,
    cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0.0 && d5 <= d6) {
    return cpx * cpx + cpy * cpy + cpz * cpz;
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
    const w = d2 / (d2 - d6);
    const qx = ax + w * acx - px;
    const qy = ay + w * acy - py;
    const qz = az + w * acz - pz;
    return qx * qx + qy * qy + qz * qz;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0.0 && d4 - d3 >= 0.0 && d5 - d6 >= 0.0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const qx = bx + w * (cx - bx) - px;
    const qy = by + w * (cy - by) - py;
    const qz = bz + w * (cz - bz) - pz;
    return qx * qx + qy * qy + qz * qz;
  }

  const denom = 1.0 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const qx = ax + abx * v + acx * w - px;
  const qy = ay + aby * v + acy * w - py;
  const qz = az + abz * v + acz * w - pz;
  return qx * qx + qy * qy + qz * qz;
}

@inline
function segToSegDistSq(
  p1x: f64,
  p1y: f64,
  p1z: f64,
  q1x: f64,
  q1y: f64,
  q1z: f64,
  p2x: f64,
  p2y: f64,
  p2z: f64,
  q2x: f64,
  q2y: f64,
  q2z: f64
): f64 {
  const d1x = q1x - p1x,
    d1y = q1y - p1y,
    d1z = q1z - p1z;
  const d2x = q2x - p2x,
    d2y = q2y - p2y,
    d2z = q2z - p2z;
  const rx = p1x - p2x,
    ry = p1y - p2y,
    rz = p1z - p2z;

  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;

  let s: f64 = 0.0;
  let t: f64 = 0.0;

  if (a <= 1e-15 && e <= 1e-15) {
    return rx * rx + ry * ry + rz * rz;
  }
  if (a <= 1e-15) {
    t = Math.max(0.0, Math.min(1.0, f / e));
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-15) {
      s = Math.max(0.0, Math.min(1.0, -c / a));
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      if (denom != 0.0) {
        s = Math.max(0.0, Math.min(1.0, (b * f - c * e) / denom));
      }
      t = (b * s + f) / e;
      if (t < 0.0) {
        t = 0.0;
        s = Math.max(0.0, Math.min(1.0, -c / a));
      } else if (t > 1.0) {
        t = 1.0;
        s = Math.max(0.0, Math.min(1.0, (b - c) / a));
      }
    }
  }

  const cx = p1x + d1x * s - (p2x + d2x * t);
  const cy = p1y + d1y * s - (p2y + d2y * t);
  const cz = p1z + d1z * s - (p2z + d2z * t);
  return cx * cx + cy * cy + cz * cz;
}

/**
 * Computes the exact minimum squared distance between two 3D triangles
 * (`triAPtr` and `triBPtr`, each 9 f64s: [x0,y0,z0, x1,y1,z1, x2,y2,z2]).
 */
export function cad_tri_tri_min_distance_sq(triAPtr: usize, triBPtr: usize): f64 {
  const a0x = load<f64>(triAPtr + 0),
    a0y = load<f64>(triAPtr + 8),
    a0z = load<f64>(triAPtr + 16);
  const a1x = load<f64>(triAPtr + 24),
    a1y = load<f64>(triAPtr + 32),
    a1z = load<f64>(triAPtr + 40);
  const a2x = load<f64>(triAPtr + 48),
    a2y = load<f64>(triAPtr + 56),
    a2z = load<f64>(triAPtr + 64);

  const b0x = load<f64>(triBPtr + 0),
    b0y = load<f64>(triBPtr + 8),
    b0z = load<f64>(triBPtr + 16);
  const b1x = load<f64>(triBPtr + 24),
    b1y = load<f64>(triBPtr + 32),
    b1z = load<f64>(triBPtr + 40);
  const b2x = load<f64>(triBPtr + 48),
    b2y = load<f64>(triBPtr + 56),
    b2z = load<f64>(triBPtr + 64);

  let minSq = pointToTriangleDistSq(a0x, a0y, a0z, b0x, b0y, b0z, b1x, b1y, b1z, b2x, b2y, b2z);
  let d = pointToTriangleDistSq(a1x, a1y, a1z, b0x, b0y, b0z, b1x, b1y, b1z, b2x, b2y, b2z);
  if (d < minSq) minSq = d;
  d = pointToTriangleDistSq(a2x, a2y, a2z, b0x, b0y, b0z, b1x, b1y, b1z, b2x, b2y, b2z);
  if (d < minSq) minSq = d;

  d = pointToTriangleDistSq(b0x, b0y, b0z, a0x, a0y, a0z, a1x, a1y, a1z, a2x, a2y, a2z);
  if (d < minSq) minSq = d;
  d = pointToTriangleDistSq(b1x, b1y, b1z, a0x, a0y, a0z, a1x, a1y, a1z, a2x, a2y, a2z);
  if (d < minSq) minSq = d;
  d = pointToTriangleDistSq(b2x, b2y, b2z, a0x, a0y, a0z, a1x, a1y, a1z, a2x, a2y, a2z);
  if (d < minSq) minSq = d;

  // 9 edge-edge pairs
  for (let i: i32 = 0; i < 3; i++) {
    const p1x = i == 0 ? a0x : i == 1 ? a1x : a2x;
    const p1y = i == 0 ? a0y : i == 1 ? a1y : a2y;
    const p1z = i == 0 ? a0z : i == 1 ? a1z : a2z;
    const q1x = i == 0 ? a1x : i == 1 ? a2x : a0x;
    const q1y = i == 0 ? a1y : i == 1 ? a2y : a0y;
    const q1z = i == 0 ? a1z : i == 1 ? a2z : a0z;

    for (let j: i32 = 0; j < 3; j++) {
      const p2x = j == 0 ? b0x : j == 1 ? b1x : b2x;
      const p2y = j == 0 ? b0y : j == 1 ? b1y : b2y;
      const p2z = j == 0 ? b0z : j == 1 ? b1z : b2z;
      const q2x = j == 0 ? b1x : j == 1 ? b2x : b0x;
      const q2y = j == 0 ? b1y : j == 1 ? b2y : b0y;
      const q2z = j == 0 ? b1z : j == 1 ? b2z : b0z;

      d = segToSegDistSq(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z);
      if (d < minSq) minSq = d;
    }
  }

  return minSq;
}

/**
 * Evaluates the exact minimum Euclidean distance between two triangle meshes in linear memory
 * (`trisAPtr`: `numTrisA * 9` f64s, `trisBPtr`: `numTrisB * 9` f64s) with per-triangle AABB culling.
 */
export function cad_mesh_pair_min_clearance(
  numTrisA: i32,
  trisAPtr: usize,
  numTrisB: i32,
  trisBPtr: usize,
  earlyExitThreshold: f64
): f64 {
  let minSq: f64 = 1e30;
  const threshSq = earlyExitThreshold > 0.0 ? earlyExitThreshold * earlyExitThreshold : 0.0;

  for (let i: i32 = 0; i < numTrisA; i++) {
    const aPtr = trisAPtr + (((i * 9) as usize) << 3);
    const a0x = load<f64>(aPtr + 0),
      a0y = load<f64>(aPtr + 8),
      a0z = load<f64>(aPtr + 16);
    const a1x = load<f64>(aPtr + 24),
      a1y = load<f64>(aPtr + 32),
      a1z = load<f64>(aPtr + 40);
    const a2x = load<f64>(aPtr + 48),
      a2y = load<f64>(aPtr + 56),
      a2z = load<f64>(aPtr + 64);

    const aMinX = Math.min(a0x, Math.min(a1x, a2x));
    const aMaxX = Math.max(a0x, Math.max(a1x, a2x));
    const aMinY = Math.min(a0y, Math.min(a1y, a2y));
    const aMaxY = Math.max(a0y, Math.max(a1y, a2y));
    const aMinZ = Math.min(a0z, Math.min(a1z, a2z));
    const aMaxZ = Math.max(a0z, Math.max(a1z, a2z));

    for (let j: i32 = 0; j < numTrisB; j++) {
      const bPtr = trisBPtr + (((j * 9) as usize) << 3);
      const b0x = load<f64>(bPtr + 0),
        b0y = load<f64>(bPtr + 8),
        b0z = load<f64>(bPtr + 16);
      const b1x = load<f64>(bPtr + 24),
        b1y = load<f64>(bPtr + 32),
        b1z = load<f64>(bPtr + 40);
      const b2x = load<f64>(bPtr + 48),
        b2y = load<f64>(bPtr + 56),
        b2z = load<f64>(bPtr + 64);

      const bMinX = Math.min(b0x, Math.min(b1x, b2x));
      const bMaxX = Math.max(b0x, Math.max(b1x, b2x));
      let dx: f64 = 0.0;
      if (aMaxX < bMinX) dx = bMinX - aMaxX;
      else if (bMaxX < aMinX) dx = aMinX - bMaxX;
      if (dx * dx >= minSq) continue;

      const bMinY = Math.min(b0y, Math.min(b1y, b2y));
      const bMaxY = Math.max(b0y, Math.max(b1y, b2y));
      let dy: f64 = 0.0;
      if (aMaxY < bMinY) dy = bMinY - aMaxY;
      else if (bMaxY < aMinY) dy = aMinY - bMaxY;
      if (dx * dx + dy * dy >= minSq) continue;

      const bMinZ = Math.min(b0z, Math.min(b1z, b2z));
      const bMaxZ = Math.max(b0z, Math.max(b1z, b2z));
      let dz: f64 = 0.0;
      if (aMaxZ < bMinZ) dz = bMinZ - aMaxZ;
      else if (bMaxZ < aMinZ) dz = aMinZ - bMaxZ;
      if (dx * dx + dy * dy + dz * dz >= minSq) continue;

      const dSq = cad_tri_tri_min_distance_sq(aPtr, bPtr);
      if (dSq < minSq) {
        minSq = dSq;
        if (minSq <= threshSq) {
          return Math.sqrt(minSq);
        }
      }
    }
  }

  return Math.sqrt(minSq);
}

/**
 * Classifies and splits a 3D convex polygon (`numVerts` vertices at `vertsPtr`, 3 f64s each)
 * against a BSP plane (`planeNormalPtr` [nx, ny, nz] and `planeW`).
 * Writes front vertices to `frontOutPtr`, back vertices to `backOutPtr`,
 * and `[numFrontVerts, numBackVerts]` (2 i32s) to `countsOutPtr`.
 * Returns polygon classification:
 *   0 = COPLANAR, 1 = FRONT, 2 = BACK, 3 = SPANNING
 */
export function cad_bsp_split_polygon(
  numVerts: i32,
  vertsPtr: usize,
  planeNormalPtr: usize,
  planeW: f64,
  frontOutPtr: usize,
  backOutPtr: usize,
  countsOutPtr: usize
): i32 {
  const EPS: f64 = 1e-5;
  const nx = load<f64>(planeNormalPtr + 0);
  const ny = load<f64>(planeNormalPtr + 8);
  const nz = load<f64>(planeNormalPtr + 16);

  let polygonType: i32 = 0;
  for (let i: i32 = 0; i < numVerts; i++) {
    const off = ((i * 3) as usize) << 3;
    const vx = load<f64>(vertsPtr + off + 0);
    const vy = load<f64>(vertsPtr + off + 8);
    const vz = load<f64>(vertsPtr + off + 16);
    const t = nx * vx + ny * vy + nz * vz - planeW;
    const vType: i32 = t < -EPS ? 2 : t > EPS ? 1 : 0;
    polygonType |= vType;
  }

  if (polygonType != 3) {
    store<i32>(countsOutPtr + 0, 0);
    store<i32>(countsOutPtr + 4, 0);
    return polygonType;
  }

  let nFront: i32 = 0;
  let nBack: i32 = 0;

  for (let i: i32 = 0; i < numVerts; i++) {
    const j = (i + 1) % numVerts;
    const offI = ((i * 3) as usize) << 3;
    const offJ = ((j * 3) as usize) << 3;

    const ix = load<f64>(vertsPtr + offI + 0);
    const iy = load<f64>(vertsPtr + offI + 8);
    const iz = load<f64>(vertsPtr + offI + 16);
    const jx = load<f64>(vertsPtr + offJ + 0);
    const jy = load<f64>(vertsPtr + offJ + 8);
    const jz = load<f64>(vertsPtr + offJ + 16);

    const ti = nx * ix + ny * iy + nz * iz - planeW;
    const tj = nx * jx + ny * jy + nz * jz - planeW;
    const typeI: i32 = ti < -EPS ? 2 : ti > EPS ? 1 : 0;
    const typeJ: i32 = tj < -EPS ? 2 : tj > EPS ? 1 : 0;

    if (typeI != 2) {
      const fOff = ((nFront * 3) as usize) << 3;
      store<f64>(frontOutPtr + fOff + 0, ix);
      store<f64>(frontOutPtr + fOff + 8, iy);
      store<f64>(frontOutPtr + fOff + 16, iz);
      nFront++;
    }
    if (typeI != 1) {
      const bOff = ((nBack * 3) as usize) << 3;
      store<f64>(backOutPtr + bOff + 0, ix);
      store<f64>(backOutPtr + bOff + 8, iy);
      store<f64>(backOutPtr + bOff + 16, iz);
      nBack++;
    }

    if ((typeI | typeJ) == 3) {
      const dx = jx - ix;
      const dy = jy - iy;
      const dz = jz - iz;
      const denom = nx * dx + ny * dy + nz * dz;
      const alpha = Math.abs(denom) > 1e-15 ? (planeW - (nx * ix + ny * iy + nz * iz)) / denom : 0.5;
      const sx = ix + dx * alpha;
      const sy = iy + dy * alpha;
      const sz = iz + dz * alpha;

      const fOff = ((nFront * 3) as usize) << 3;
      store<f64>(frontOutPtr + fOff + 0, sx);
      store<f64>(frontOutPtr + fOff + 8, sy);
      store<f64>(frontOutPtr + fOff + 16, sz);
      nFront++;

      const bOff = ((nBack * 3) as usize) << 3;
      store<f64>(backOutPtr + bOff + 0, sx);
      store<f64>(backOutPtr + bOff + 8, sy);
      store<f64>(backOutPtr + bOff + 16, sz);
      nBack++;
    }
  }

  store<i32>(countsOutPtr + 0, nFront);
  store<i32>(countsOutPtr + 4, nBack);
  return 3;
}

@inline
function seg2dToSeg2dDistSq(
  ax: f64,
  ay: f64,
  bx: f64,
  by: f64,
  cx: f64,
  cy: f64,
  dx: f64,
  dy: f64
): f64 {
  return segToSegDistSq(ax, ay, 0.0, bx, by, 0.0, cx, cy, 0.0, dx, dy, 0.0);
}

/**
 * Evaluates the exact minimum edge-to-edge Euclidean clearance between two 2D PCB traces
 * (`pts1Ptr`: `nPts1 * 2` f64s with width `w1`, `pts2Ptr`: `nPts2 * 2` f64s with width `w2`).
 */
export function ecad_drc_trace_pair_min_clearance(
  nPts1: i32,
  pts1Ptr: usize,
  w1: f64,
  nPts2: i32,
  pts2Ptr: usize,
  w2: f64
): f64 {
  if (nPts1 < 2 || nPts2 < 2) return 1e30;
  let minCenterSq: f64 = 1e30;
  for (let i: i32 = 0; i < nPts1 - 1; i++) {
    const off1 = ((i * 2) as usize) << 3;
    const ax = load<f64>(pts1Ptr + off1 + 0);
    const ay = load<f64>(pts1Ptr + off1 + 8);
    const bx = load<f64>(pts1Ptr + off1 + 16);
    const by = load<f64>(pts1Ptr + off1 + 24);
    for (let j: i32 = 0; j < nPts2 - 1; j++) {
      const off2 = ((j * 2) as usize) << 3;
      const cx = load<f64>(pts2Ptr + off2 + 0);
      const cy = load<f64>(pts2Ptr + off2 + 8);
      const dx = load<f64>(pts2Ptr + off2 + 16);
      const dy = load<f64>(pts2Ptr + off2 + 24);
      const dSq = seg2dToSeg2dDistSq(ax, ay, bx, by, cx, cy, dx, dy);
      if (dSq < minCenterSq) minCenterSq = dSq;
    }
  }
  return Math.sqrt(minCenterSq) - 0.5 * (w1 + w2);
}

/**
 * Computes the signed/unsigned 2D distance from a point `(px, py)` to a 2D polygon boundary
 * (`polyPtr`: `nVerts * 2` f64s). Returns 0.0 if `(px, py)` is strictly inside the polygon.
 */
export function ecad_drc_point_to_polygon_dist(
  px: f64,
  py: f64,
  nVerts: i32,
  polyPtr: usize
): f64 {
  if (nVerts < 3) return 1e30;
  let inside: bool = false;
  let minEdgeSq: f64 = 1e30;

  for (let i: i32 = 0, j: i32 = nVerts - 1; i < nVerts; j = i++) {
    const offI = ((i * 2) as usize) << 3;
    const offJ = ((j * 2) as usize) << 3;
    const xi = load<f64>(polyPtr + offI + 0);
    const yi = load<f64>(polyPtr + offI + 8);
    const xj = load<f64>(polyPtr + offJ + 0);
    const yj = load<f64>(polyPtr + offJ + 8);

    if (yi > py != yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-30) + xi) {
      inside = !inside;
    }

    const dx = xj - xi;
    const dy = yj - yi;
    const lenSq = dx * dx + dy * dy;
    let t: f64 = 0.0;
    if (lenSq > 1e-18) {
      t = Math.max(0.0, Math.min(1.0, ((px - xi) * dx + (py - yi) * dy) / lenSq));
    }
    const cx = xi + t * dx - px;
    const cy = yi + t * dy - py;
    const dSq = cx * cx + cy * cy;
    if (dSq < minEdgeSq) minEdgeSq = dSq;
  }

  return inside ? 0.0 : Math.sqrt(minEdgeSq);
}

/**
 * Multiplies two 4x4 affine transformation matrices in linear memory (`aPtr` and `bPtr`,
 * 16 f64s each in row-major order), writing the product to `outPtr`.
 */
export function scad_multiply_mat4(aPtr: usize, bPtr: usize, outPtr: usize): void {
  const res = new StaticArray<f64>(16);
  for (let r: i32 = 0; r < 4; r++) {
    for (let c: i32 = 0; c < 4; c++) {
      let sum: f64 = 0.0;
      for (let k: i32 = 0; k < 4; k++) {
        sum +=
          load<f64>(aPtr + (((r * 4 + k) as usize) << 3)) *
          load<f64>(bPtr + (((k * 4 + c) as usize) << 3));
      }
      unchecked((res[r * 4 + c] = sum));
    }
  }
  for (let i: i32 = 0; i < 16; i++) {
    store<f64>(outPtr + ((i as usize) << 3), unchecked(res[i]));
  }
}

