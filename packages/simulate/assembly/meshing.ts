// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Volumetric Tetrahedral Meshing & Surface Voxelization Kernels.
 * Zero-allocation linear-memory implementation for Tet4Mesher & MeshQualityAnalyzer.
 */

export function mesh_createBoxCoords(
  nx: i32,
  ny: i32,
  nz: i32,
  ox: f64,
  oy: f64,
  oz: f64,
  dx: f64,
  dy: f64,
  dz: f64,
  outCoordsPtr: usize,
): void {
  const numX = nx + 1;
  const numY = ny + 1;
  const strideZ = numX * numY;
  for (let iz: i32 = 0; iz <= nz; iz++) {
    const zVal = <f32>(oz + <f64>iz * dz);
    const baseZ = iz * strideZ;
    for (let iy: i32 = 0; iy <= ny; iy++) {
      const yVal = <f32>(oy + <f64>iy * dy);
      const baseYZ = baseZ + iy * numX;
      for (let ix: i32 = 0; ix <= nx; ix++) {
        const idx = baseYZ + ix;
        const off = outCoordsPtr + (<usize>(idx * 3) << 2);
        store<f32>(off, <f32>(ox + <f64>ix * dx));
        store<f32>(off + 4, yVal);
        store<f32>(off + 8, zVal);
      }
    }
  }
}

export function mesh_createBoxTets(
  nx: i32,
  ny: i32,
  nz: i32,
  outElemsPtr: usize,
): i32 {
  const numX = nx + 1;
  const numY = ny + 1;
  const strideZ = numX * numY;
  let elemCursor: usize = outElemsPtr;
  let tetCount: i32 = 0;

  for (let iz: i32 = 0; iz < nz; iz++) {
    const z0 = iz * strideZ;
    const z1 = (iz + 1) * strideZ;
    for (let iy: i32 = 0; iy < ny; iy++) {
      const y0 = iy * numX;
      const y1 = (iy + 1) * numX;
      for (let ix: i32 = 0; ix < nx; ix++) {
        const v0 = <u32>(ix + y0 + z0);
        const v1 = <u32>(ix + 1 + y0 + z0);
        const v2 = <u32>(ix + 1 + y1 + z0);
        const v3 = <u32>(ix + y1 + z0);
        const v4 = <u32>(ix + y0 + z1);
        const v5 = <u32>(ix + 1 + y0 + z1);
        const v6 = <u32>(ix + 1 + y1 + z1);
        const v7 = <u32>(ix + y1 + z1);

        // 6 consistent Kuhns tetrahedra per hex cell
        store<u32>(elemCursor, v0);
        store<u32>(elemCursor + 4, v1);
        store<u32>(elemCursor + 8, v2);
        store<u32>(elemCursor + 12, v6);

        store<u32>(elemCursor + 16, v0);
        store<u32>(elemCursor + 20, v2);
        store<u32>(elemCursor + 24, v3);
        store<u32>(elemCursor + 28, v6);

        store<u32>(elemCursor + 32, v0);
        store<u32>(elemCursor + 36, v3);
        store<u32>(elemCursor + 40, v7);
        store<u32>(elemCursor + 44, v6);

        store<u32>(elemCursor + 48, v0);
        store<u32>(elemCursor + 52, v7);
        store<u32>(elemCursor + 56, v4);
        store<u32>(elemCursor + 60, v6);

        store<u32>(elemCursor + 64, v0);
        store<u32>(elemCursor + 68, v4);
        store<u32>(elemCursor + 72, v5);
        store<u32>(elemCursor + 76, v6);

        store<u32>(elemCursor + 80, v0);
        store<u32>(elemCursor + 84, v5);
        store<u32>(elemCursor + 88, v1);
        store<u32>(elemCursor + 92, v6);

        elemCursor += 96;
        tetCount += 6;
      }
    }
  }
  return tetCount;
}

/**
 * Ray-casting parity voxelizer (+X ray) for closed triangle surface meshes.
 * Writes 1 (solid) or 0 (empty) into `outGridPtr` (u8[nx * ny * nz]).
 */
export function mesh_voxelizeSurface(
  vertsPtr: usize,
  indicesPtr: usize,
  numTris: i32,
  nx: i32,
  ny: i32,
  nz: i32,
  minX: f64,
  minY: f64,
  minZ: f64,
  dx: f64,
  outGridPtr: usize,
): i32 {
  const totalVoxels = nx * ny * nz;
  memory.fill(outGridPtr, 0, <usize>totalVoxels);
  if (numTris <= 0 || totalVoxels <= 0) return 0;

  // Precompute per-triangle Y/Z bounding boxes in linear memory for fast rejection
  const triCount = <usize>numTris;
  const triBoxPtr = heap.alloc(triCount * 32); // [minY, maxY, minZ, maxZ] as f64
  for (let t: i32 = 0; t < numTris; t++) {
    const idxOff = indicesPtr + (<usize>(t * 3) << 2);
    const ia = <usize>load<u32>(idxOff);
    const ib = <usize>load<u32>(idxOff + 4);
    const ic = <usize>load<u32>(idxOff + 8);

    const ay = <f64>load<f32>(vertsPtr + (ia * 12) + 4);
    const az = <f64>load<f32>(vertsPtr + (ia * 12) + 8);
    const by = <f64>load<f32>(vertsPtr + (ib * 12) + 4);
    const bz = <f64>load<f32>(vertsPtr + (ib * 12) + 8);
    const cy = <f64>load<f32>(vertsPtr + (ic * 12) + 4);
    const cz = <f64>load<f32>(vertsPtr + (ic * 12) + 8);

    const loY = Math.min(ay, Math.min(by, cy));
    const hiY = Math.max(ay, Math.max(by, cy));
    const loZ = Math.min(az, Math.min(bz, cz));
    const hiZ = Math.max(az, Math.max(bz, cz));

    const bOff = triBoxPtr + (<usize>t << 5);
    store<f64>(bOff, loY);
    store<f64>(bOff + 8, hiY);
    store<f64>(bOff + 16, loZ);
    store<f64>(bOff + 24, hiZ);
  }

  // Scratch buffer for X-intersections along a single (iy, iz) scanline
  let hitCap: i32 = 64;
  let hitsPtr = heap.alloc(<usize>hitCap << 3);
  let solidCount: i32 = 0;

  for (let iz: i32 = 0; iz < nz; iz++) {
    const pz = minZ + (<f64>iz + 0.5) * dx + 1e-9;
    const zBase = iz * nx * ny;
    for (let iy: i32 = 0; iy < ny; iy++) {
      const py = minY + (<f64>iy + 0.5) * dx + 1.3e-9;
      let hitCount: i32 = 0;

      for (let t: i32 = 0; t < numTris; t++) {
        const bOff = triBoxPtr + (<usize>t << 5);
        if (py < load<f64>(bOff) || py > load<f64>(bOff + 8)) continue;
        if (pz < load<f64>(bOff + 16) || pz > load<f64>(bOff + 24)) continue;

        const idxOff = indicesPtr + (<usize>(t * 3) << 2);
        const ia = <usize>load<u32>(idxOff);
        const ib = <usize>load<u32>(idxOff + 4);
        const ic = <usize>load<u32>(idxOff + 8);

        const ax = <f64>load<f32>(vertsPtr + ia * 12);
        const ay = <f64>load<f32>(vertsPtr + ia * 12 + 4);
        const az = <f64>load<f32>(vertsPtr + ia * 12 + 8);
        const bx = <f64>load<f32>(vertsPtr + ib * 12);
        const by = <f64>load<f32>(vertsPtr + ib * 12 + 4);
        const bz = <f64>load<f32>(vertsPtr + ib * 12 + 8);
        const cx = <f64>load<f32>(vertsPtr + ic * 12);
        const cy = <f64>load<f32>(vertsPtr + ic * 12 + 4);
        const cz = <f64>load<f32>(vertsPtr + ic * 12 + 8);

        // 2D barycentric test in (Y, Z) plane for +X ray
        const e1y = by - ay;
        const e1z = bz - az;
        const e2y = cy - ay;
        const e2z = cz - az;
        const det = e1y * e2z - e1z * e2y;
        if (Math.abs(det) < 1e-14) continue;

        const invDet = 1.0 / det;
        const ry = py - ay;
        const rz = pz - az;
        const u = (ry * e2z - rz * e2y) * invDet;
        if (u < 0.0 || u > 1.0) continue;
        const v = (e1y * rz - e1z * ry) * invDet;
        if (v < 0.0 || u + v > 1.0) continue;

        const xHit = ax + u * (bx - ax) + v * (cx - ax);
        if (hitCount >= hitCap) {
          const newCap = hitCap * 2;
          const newBuf = heap.alloc(<usize>newCap << 3);
          memory.copy(newBuf, hitsPtr, <usize>hitCount << 3);
          heap.free(hitsPtr);
          hitsPtr = newBuf;
          hitCap = newCap;
        }
        store<f64>(hitsPtr + (<usize>hitCount << 3), xHit);
        hitCount++;
      }

      if (hitCount < 2) continue;

      // Insertion sort hits along X (typically 2-8 crossings)
      for (let i: i32 = 1; i < hitCount; i++) {
        const key = load<f64>(hitsPtr + (<usize>i << 3));
        let j = i - 1;
        while (j >= 0 && load<f64>(hitsPtr + (<usize>j << 3)) > key) {
          store<f64>(hitsPtr + (<usize>(j + 1) << 3), load<f64>(hitsPtr + (<usize>j << 3)));
          j--;
        }
        store<f64>(hitsPtr + (<usize>(j + 1) << 3), key);
      }

      const rowBase = zBase + iy * nx;
      for (let p: i32 = 0; p + 1 < hitCount; p += 2) {
        const xEnter = load<f64>(hitsPtr + (<usize>p << 3));
        const xExit = load<f64>(hitsPtr + (<usize>(p + 1) << 3));
        let ixStart = <i32>Math.ceil((xEnter - minX) / dx - 0.5);
        let ixEnd = <i32>Math.floor((xExit - minX) / dx - 0.5);
        if (ixStart < 0) ixStart = 0;
        if (ixEnd >= nx) ixEnd = nx - 1;
        for (let ix = ixStart; ix <= ixEnd; ix++) {
          const cellOff = outGridPtr + <usize>(rowBase + ix);
          if (load<u8>(cellOff) == 0) {
            store<u8>(cellOff, 1);
            solidCount++;
          }
        }
      }
    }
  }

  heap.free(hitsPtr);
  heap.free(triBoxPtr);
  return solidCount;
}

/**
 * Computes signed volume (6*V) and aspect ratio for every Tet4 element.
 * Returns number of inverted (volume <= 0) tetrahedra.
 */
export function mesh_tet4QualityMetrics(
  coordsPtr: usize,
  elemsPtr: usize,
  numElems: i32,
  outVolPtr: usize,
  outAspectPtr: usize,
): i32 {
  let invertedCount: i32 = 0;
  for (let e: i32 = 0; e < numElems; e++) {
    const eOff = elemsPtr + (<usize>(e * 4) << 2);
    const n0 = <usize>load<u32>(eOff);
    const n1 = <usize>load<u32>(eOff + 4);
    const n2 = <usize>load<u32>(eOff + 8);
    const n3 = <usize>load<u32>(eOff + 12);

    const x0 = <f64>load<f32>(coordsPtr + n0 * 12);
    const y0 = <f64>load<f32>(coordsPtr + n0 * 12 + 4);
    const z0 = <f64>load<f32>(coordsPtr + n0 * 12 + 8);

    const x1 = <f64>load<f32>(coordsPtr + n1 * 12);
    const y1 = <f64>load<f32>(coordsPtr + n1 * 12 + 4);
    const z1 = <f64>load<f32>(coordsPtr + n1 * 12 + 8);

    const x2 = <f64>load<f32>(coordsPtr + n2 * 12);
    const y2 = <f64>load<f32>(coordsPtr + n2 * 12 + 4);
    const z2 = <f64>load<f32>(coordsPtr + n2 * 12 + 8);

    const x3 = <f64>load<f32>(coordsPtr + n3 * 12);
    const y3 = <f64>load<f32>(coordsPtr + n3 * 12 + 4);
    const z3 = <f64>load<f32>(coordsPtr + n3 * 12 + 8);

    const ax = x1 - x0;
    const ay = y1 - y0;
    const az = z1 - z0;
    const bx = x2 - x0;
    const by = y2 - y0;
    const bz = z2 - z0;
    const cx = x3 - x0;
    const cy = y3 - y0;
    const cz = z3 - z0;

    // 6 * signed volume = det([a, b, c])
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const vol = det / 6.0;
    store<f64>(outVolPtr + (<usize>e << 3), vol);
    if (vol <= 0.0) invertedCount++;

    // Edge lengths for aspect ratio (l_max / l_min)
    const l01 = Math.sqrt(ax * ax + ay * ay + az * az);
    const l02 = Math.sqrt(bx * bx + by * by + bz * bz);
    const l03 = Math.sqrt(cx * cx + cy * cy + cz * cz);
    const d12x = x2 - x1;
    const d12y = y2 - y1;
    const d12z = z2 - z1;
    const l12 = Math.sqrt(d12x * d12x + d12y * d12y + d12z * d12z);
    const d13x = x3 - x1;
    const d13y = y3 - y1;
    const d13z = z3 - z1;
    const l13 = Math.sqrt(d13x * d13x + d13y * d13y + d13z * d13z);
    const d23x = x3 - x2;
    const d23y = y3 - y2;
    const d23z = z3 - z2;
    const l23 = Math.sqrt(d23x * d23x + d23y * d23y + d23z * d23z);

    let lMin = l01;
    let lMax = l01;
    if (l02 < lMin) lMin = l02;
    if (l02 > lMax) lMax = l02;
    if (l03 < lMin) lMin = l03;
    if (l03 > lMax) lMax = l03;
    if (l12 < lMin) lMin = l12;
    if (l12 > lMax) lMax = l12;
    if (l13 < lMin) lMin = l13;
    if (l13 > lMax) lMax = l13;
    if (l23 < lMin) lMin = l23;
    if (l23 > lMax) lMax = l23;

    const aspect = lMin > 1e-15 ? lMax / lMin : 1e12;
    store<f64>(outAspectPtr + (<usize>e << 3), aspect);
  }
  return invertedCount;
}

/**
 * Promotes a Tet4 mesh to quadratic Tet10 in linear memory using a u64 open-addressing
 * edge hash table `(min(u,v) << 32) | max(u,v)` — zero string allocations.
 *
 * Outputs:
 *   - `outQuadElemsPtr`: u32[numElems * 10]
 *   - `outMidCoordsPtr`: f32[maxEdges * 3]  (caller allocates numElems * 6 * 3 floats)
 *   - `outEdgePairsPtr`: u32[maxEdges * 2]  ([a, b] endpoints for each midpoint node)
 * Returns total unique mid-edge nodes created.
 */
export function mesh_promoteTet4ToTet10(
  coordsPtr: usize,
  numNodes: i32,
  elemsPtr: usize,
  numElems: i32,
  outQuadElemsPtr: usize,
  outMidCoordsPtr: usize,
  outEdgePairsPtr: usize,
): i32 {
  if (numElems <= 0) return 0;

  let tableSize: i32 = 64;
  const targetSize = numElems * 12;
  while (tableSize < targetSize) tableSize <<= 1;
  const mask: u64 = <u64>(tableSize - 1);

  const keyPtr = heap.alloc(<usize>tableSize << 3);
  const valPtr = heap.alloc(<usize>tableSize << 2);
  memory.fill(keyPtr, 0xff, <usize>tableSize << 3); // 0xffffffffffffffff = empty sentinel

  let midCount: i32 = 0;

  for (let e: i32 = 0; e < numElems; e++) {
    const eOff = elemsPtr + (<usize>(e * 4) << 2);
    const n0 = load<u32>(eOff);
    const n1 = load<u32>(eOff + 4);
    const n2 = load<u32>(eOff + 8);
    const n3 = load<u32>(eOff + 12);

    const qOff = outQuadElemsPtr + (<usize>(e * 10) << 2);
    store<u32>(qOff, n0);
    store<u32>(qOff + 4, n1);
    store<u32>(qOff + 8, n2);
    store<u32>(qOff + 12, n3);

    // 6 local edges: (0,1), (1,2), (2,0), (0,3), (1,3), (2,3)
    for (let edge: i32 = 0; edge < 6; edge++) {
      let a: u32 = 0;
      let b: u32 = 0;
      if (edge == 0) { a = n0; b = n1; }
      else if (edge == 1) { a = n1; b = n2; }
      else if (edge == 2) { a = n2; b = n0; }
      else if (edge == 3) { a = n0; b = n3; }
      else if (edge == 4) { a = n1; b = n3; }
      else { a = n2; b = n3; }

      const lo: u32 = a < b ? a : b;
      const hi: u32 = a < b ? b : a;
      const key: u64 = ((<u64>lo) << 32) | (<u64>hi);

      // Mix hash
      let h: u64 = key ^ (key >> 33);
      h *= 0xff51afd7ed558ccd;
      h ^= h >> 33;
      let slot: usize = <usize>(h & mask);

      let midNodeIdx: u32 = 0;
      while (true) {
        const k = load<u64>(keyPtr + (slot << 3));
        if (k == 0xffffffffffffffff) {
          midNodeIdx = <u32>(numNodes + midCount);
          store<u64>(keyPtr + (slot << 3), key);
          store<u32>(valPtr + (slot << 2), midNodeIdx);

          const cLo = coordsPtr + (<usize>lo * 12);
          const cHi = coordsPtr + (<usize>hi * 12);
          const mOff = outMidCoordsPtr + (<usize>(midCount * 3) << 2);
          store<f32>(mOff, <f32>0.5 * (load<f32>(cLo) + load<f32>(cHi)));
          store<f32>(mOff + 4, <f32>0.5 * (load<f32>(cLo + 4) + load<f32>(cHi + 4)));
          store<f32>(mOff + 8, <f32>0.5 * (load<f32>(cLo + 8) + load<f32>(cHi + 8)));

          const pOff = outEdgePairsPtr + (<usize>(midCount * 2) << 2);
          store<u32>(pOff, lo);
          store<u32>(pOff + 4, hi);

          midCount++;
          break;
        }
        if (k == key) {
          midNodeIdx = load<u32>(valPtr + (slot << 2));
          break;
        }
        slot = <usize>(((<u64>slot) + 1) & mask);
      }

      store<u32>(qOff + (<usize>(4 + edge) << 2), midNodeIdx);
    }
  }

  heap.free(keyPtr);
  heap.free(valPtr);
  return midCount;
}

@inline
function cross2D(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64): f64 {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * 2D Ear-Clipping Polygon Triangulator in WASM linear memory using circular
 * doubly-linked vertex indices (O(1) ear removal, zero GC).
 *
 * Inputs:
 *   - `uvPtr`: f64[nVerts * 2] packed [u0, v0, u1, v1, ...]
 *   - `ptIdsPtr`: i32[nVerts] original point IDs (used to skip bridge-duplicate vertices)
 * Output:
 *   - `outTrisPtr`: i32[(nVerts - 2) * 3] triangle index triples (indices into 0..nVerts-1)
 * Returns number of triangles emitted.
 */
export function mesh_earClip2D(
  uvPtr: usize,
  ptIdsPtr: usize,
  nVerts: i32,
  outTrisPtr: usize,
): i32 {
  if (nVerts < 3) return 0;

  const prevPtr = heap.alloc(<usize>nVerts << 2);
  const nextPtr = heap.alloc(<usize>nVerts << 2);
  for (let i: i32 = 0; i < nVerts; i++) {
    store<i32>(prevPtr + (<usize>i << 2), i == 0 ? nVerts - 1 : i - 1);
    store<i32>(nextPtr + (<usize>i << 2), i == nVerts - 1 ? 0 : i + 1);
  }

  let remaining = nVerts;
  let head: i32 = 0;
  let triCount: i32 = 0;
  let guard = nVerts * 4;

  while (remaining > 3 && guard > 0) {
    guard--;
    let earFound = false;
    let cur = head;
    for (let step: i32 = 0; step < remaining; step++) {
      const iPrev = load<i32>(prevPtr + (<usize>cur << 2));
      const iNext = load<i32>(nextPtr + (<usize>cur << 2));

      const ax = load<f64>(uvPtr + (<usize>(iPrev * 2) << 3));
      const ay = load<f64>(uvPtr + (<usize>(iPrev * 2 + 1) << 3));
      const bx = load<f64>(uvPtr + (<usize>(cur * 2) << 3));
      const by = load<f64>(uvPtr + (<usize>(cur * 2 + 1) << 3));
      const cx = load<f64>(uvPtr + (<usize>(iNext * 2) << 3));
      const cy = load<f64>(uvPtr + (<usize>(iNext * 2 + 1) << 3));

      if (cross2D(ax, ay, bx, by, cx, cy) > 1e-9) {
        const idA = load<i32>(ptIdsPtr + (<usize>iPrev << 2));
        const idB = load<i32>(ptIdsPtr + (<usize>cur << 2));
        const idC = load<i32>(ptIdsPtr + (<usize>iNext << 2));

        let hasInside = false;
        let probe = load<i32>(nextPtr + (<usize>iNext << 2));
        while (probe != iPrev) {
          const idP = load<i32>(ptIdsPtr + (<usize>probe << 2));
          if (idP != idA && idP != idB && idP != idC) {
            const px = load<f64>(uvPtr + (<usize>(probe * 2) << 3));
            const py = load<f64>(uvPtr + (<usize>(probe * 2 + 1) << 3));
            if (
              cross2D(ax, ay, bx, by, px, py) >= -1e-9 &&
              cross2D(bx, by, cx, cy, px, py) >= -1e-9 &&
              cross2D(cx, cy, ax, ay, px, py) >= -1e-9
            ) {
              hasInside = true;
              break;
            }
          }
          probe = load<i32>(nextPtr + (<usize>probe << 2));
        }

        if (!hasInside) {
          const tOff = outTrisPtr + (<usize>(triCount * 3) << 2);
          store<i32>(tOff, iPrev);
          store<i32>(tOff + 4, cur);
          store<i32>(tOff + 8, iNext);
          triCount++;

          // O(1) unlink cur
          store<i32>(nextPtr + (<usize>iPrev << 2), iNext);
          store<i32>(prevPtr + (<usize>iNext << 2), iPrev);
          if (head == cur) head = iNext;
          remaining--;
          earFound = true;
          break;
        }
      }
      cur = iNext;
    }

    if (!earFound) break;
  }

  // Emit final triangle if 3 vertices remain
  if (remaining == 3) {
    const v0 = head;
    const v1 = load<i32>(nextPtr + (<usize>v0 << 2));
    const v2 = load<i32>(nextPtr + (<usize>v1 << 2));
    const tOff = outTrisPtr + (<usize>(triCount * 3) << 2);
    store<i32>(tOff, v0);
    store<i32>(tOff + 4, v1);
    store<i32>(tOff + 8, v2);
    triCount++;
  }

  heap.free(prevPtr);
  heap.free(nextPtr);
  return triCount;
}


