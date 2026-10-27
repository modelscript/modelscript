// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — 3D Binary Space Partitioning (BSP) CSG Clipping Engine & Mesh Metrics.
 *
 * Implements exact 3D polygon clipping for Union, Subtract (Difference), and Intersect
 * boolean operations on triangulated manifold boundary representations, plus exact
 * signed tetrahedral volume and surface area computation.
 */

import type { ManifoldSurfaceMesh } from "./manifold-worker.js";
import type { Vec3 } from "./types.js";

/** Coplanarity distance tolerance in world units for BSP plane classification. */
const CSG_EPSILON = 1e-5;
/** Maximum recursion depth when building a `CsgBspNode` tree to guard against stack overflow on dense meshes. */
const MAX_BSP_DEPTH = 64;

/** A 3D vertex with position and outward unit normal used during BSP polygon clipping. */
export interface CsgVertex {
  /** 3D Cartesian coordinates `[x, y, z]`. */
  pos: [number, number, number];
  /** Outward unit normal vector `[nx, ny, nz]`. */
  normal: [number, number, number];
}

/** Oriented 3D plane defined by `normal · x - w = 0`. */
export interface CsgPlane {
  /** Unit normal vector `[nx, ny, nz]`. */
  normal: [number, number, number];
  /** Signed distance from the origin along `normal`. */
  w: number;
}

/** Convex 3D polygon with coplanar vertices, supporting plane, and boundary-patch tag index. */
export interface CsgPolygon {
  /** Ordered counter-clockwise vertices forming the polygon loop. */
  vertices: CsgVertex[];
  /** Supporting plane of the polygon. */
  plane: CsgPlane;
  /** Index into the mesh's boundary patch tag table (`-1` if untagged). */
  tagIndex: number;
}

/** Returns a deep copy of a {@link CsgVertex}. */
function cloneVertex(v: CsgVertex): CsgVertex {
  return {
    pos: [v.pos[0], v.pos[1], v.pos[2]],
    normal: [v.normal[0], v.normal[1], v.normal[2]],
  };
}

/** Returns a copy of `v` with its normal vector inverted. */
function flipVertex(v: CsgVertex): CsgVertex {
  return {
    pos: [v.pos[0], v.pos[1], v.pos[2]],
    normal: [-v.normal[0], -v.normal[1], -v.normal[2]],
  };
}

/** Linearly interpolates position and normal between vertices `a` and `b` at parameter `t` in `[0, 1]`. */
function interpolateVertex(a: CsgVertex, b: CsgVertex, t: number): CsgVertex {
  const px = a.pos[0] + (b.pos[0] - a.pos[0]) * t;
  const py = a.pos[1] + (b.pos[1] - a.pos[1]) * t;
  const pz = a.pos[2] + (b.pos[2] - a.pos[2]) * t;

  const nx = a.normal[0] + (b.normal[0] - a.normal[0]) * t;
  const ny = a.normal[1] + (b.normal[1] - a.normal[1]) * t;
  const nz = a.normal[2] + (b.normal[2] - a.normal[2]) * t;
  const nLen = Math.hypot(nx, ny, nz) || 1.0;

  return {
    pos: [px, py, pz],
    normal: [nx / nLen, ny / nLen, nz / nLen],
  };
}

/** Computes a normalized {@link CsgPlane} from three non-collinear 3D points, or returns `null` if degenerate. */
export function planeFromPoints(a: Vec3, b: Vec3, c: Vec3): CsgPlane | null {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];

  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-11) return null;

  const normal: [number, number, number] = [nx / len, ny / len, nz / len];
  const w = normal[0] * a[0] + normal[1] * a[1] + normal[2] * a[2];
  return { normal, w };
}

/** Returns a copy of plane `p` with inverted normal and negated offset `w`. */
function flipPlane(p: CsgPlane): CsgPlane {
  return {
    normal: [-p.normal[0], -p.normal[1], -p.normal[2]],
    w: -p.w,
  };
}

/** Constructs a validated {@link CsgPolygon} from an ordered vertex loop, aligning winding with vertex normals. */
export function createPolygon(vertices: CsgVertex[], tagIndex: number, plane?: CsgPlane): CsgPolygon | null {
  if (vertices.length < 3) return null;
  if (plane) {
    return {
      vertices: vertices.slice(),
      plane: {
        normal: [plane.normal[0], plane.normal[1], plane.normal[2]],
        w: plane.w,
      },
      tagIndex,
    };
  }
  const verts = vertices.slice();
  let computedPlane = planeFromPoints(verts[0]!.pos, verts[1]!.pos, verts[2]!.pos);
  if (!computedPlane) return null;

  // Ensure geometric winding and plane normal match the vertex outward normal if provided
  const vn = verts[0]!.normal;
  const dot = computedPlane.normal[0] * vn[0] + computedPlane.normal[1] * vn[1] + computedPlane.normal[2] * vn[2];
  if (dot < 0) {
    verts.reverse();
    computedPlane = flipPlane(computedPlane);
  }

  return {
    vertices: verts,
    plane: computedPlane,
    tagIndex,
  };
}

/** Returns a deep copy of a {@link CsgPolygon}. */
function clonePolygon(p: CsgPolygon): CsgPolygon {
  return {
    vertices: p.vertices.map(cloneVertex),
    plane: {
      normal: [p.plane.normal[0], p.plane.normal[1], p.plane.normal[2]],
      w: p.plane.w,
    },
    tagIndex: p.tagIndex,
  };
}

/** Reverses the vertex winding, vertex normals, and supporting plane of `p` in place. */
function flipPolygon(p: CsgPolygon): void {
  p.vertices.reverse();
  for (let i = 0; i < p.vertices.length; i++) {
    p.vertices[i] = flipVertex(p.vertices[i]!);
  }
  p.plane = flipPlane(p.plane);
}

/** Vertex/polygon classification bitflags relative to a splitting plane. */
const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

interface BspWasmExports {
  memory: { buffer: ArrayBuffer };
  __new(bytes: number, id: number): number;
  cad_bsp_split_polygon?: (
    nVerts: number,
    inVertsPtr: number,
    planeNormalPtr: number,
    w: number,
    outFrontPtr: number,
    outBackPtr: number,
    outCountsPtr: number,
  ) => number;
}

/** Cached WebAssembly linear-memory scratch buffers for `cad_bsp_split_polygon`. */
let bspWasmScratch: {
  wasm: BspWasmExports;
  inVertsPtr: number;
  planeNormalPtr: number;
  outFrontPtr: number;
  outBackPtr: number;
  outCountsPtr: number;
} | null = null;

/** Lazily allocates or reuses linear-memory scratch buffers in `wasm` for polygon splitting. */
function ensureBspWasmScratch(wasm: BspWasmExports) {
  if (bspWasmScratch && bspWasmScratch.wasm === wasm) {
    return bspWasmScratch;
  }
  const alloc = (bytes: number): number => wasm.__new(bytes, 0);
  bspWasmScratch = {
    wasm,
    inVertsPtr: alloc(64 * 3 * 8),
    planeNormalPtr: alloc(3 * 8),
    outFrontPtr: alloc(64 * 3 * 8),
    outBackPtr: alloc(64 * 3 * 8),
    outCountsPtr: alloc(2 * 4),
  };
  return bspWasmScratch;
}

let sharedTypesBuffer = new Int32Array(64);
function getTypesBuffer(size: number): Int32Array {
  if (sharedTypesBuffer.length < size) {
    let nextCap = sharedTypesBuffer.length * 2;
    while (nextCap < size) nextCap *= 2;
    sharedTypesBuffer = new Int32Array(nextCap);
  }
  return sharedTypesBuffer;
}

/**
 * Splits a convex `CsgPolygon` against a partitioning `CsgPlane`, routing the polygon
 * (or its clipped fragments) into `coplanarFront`, `coplanarBack`, `front`, or `back`.
 *
 * Uses the WebAssembly `cad_bsp_split_polygon` kernel for polygons with `<= 32` vertices
 * and falls back to an exact Sutherland-Hodgman edge-clipping loop in TypeScript.
 */
export function splitPolygon(
  plane: CsgPlane,
  polygon: CsgPolygon,
  coplanarFront: CsgPolygon[],
  coplanarBack: CsgPolygon[],
  front: CsgPolygon[],
  back: CsgPolygon[],
): void {
  const nx = plane.normal[0];
  const ny = plane.normal[1];
  const nz = plane.normal[2];
  const w = plane.w;
  const nVerts = polygon.vertices.length;

  // 1. WebAssembly fast-path for convex polygons with up to 32 vertices
  const wasm =
    typeof globalThis !== "undefined"
      ? ((globalThis as { __modelscript_wasm_exports__?: BspWasmExports | undefined }).__modelscript_wasm_exports__ ??
        null)
      : null;
  if (wasm && typeof wasm.cad_bsp_split_polygon === "function" && nVerts <= 32) {
    const sc = ensureBspWasmScratch(wasm);
    const buf = wasm.memory.buffer as ArrayBuffer;
    const inView = new Float64Array(buf, sc.inVertsPtr, nVerts * 3);
    for (let i = 0; i < nVerts; i++) {
      const v = polygon.vertices[i]!;
      const off = i * 3;
      inView[off] = v.pos[0];
      inView[off + 1] = v.pos[1];
      inView[off + 2] = v.pos[2];
    }
    const pnView = new Float64Array(buf, sc.planeNormalPtr, 3);
    pnView[0] = nx;
    pnView[1] = ny;
    pnView[2] = nz;

    // Classify and clip the polygon in linear memory; returns bitmask of {COPLANAR, FRONT, BACK, SPANNING}
    const polyType: number = wasm.cad_bsp_split_polygon(
      nVerts,
      sc.inVertsPtr,
      sc.planeNormalPtr,
      w,
      sc.outFrontPtr,
      sc.outBackPtr,
      sc.outCountsPtr,
    );

    if (polyType === COPLANAR) {
      // Orient coplanar polygon by normal alignment with the splitting plane
      const dot = nx * polygon.plane.normal[0] + ny * polygon.plane.normal[1] + nz * polygon.plane.normal[2];
      if (dot > 0) coplanarFront.push(polygon);
      else coplanarBack.push(polygon);
      return;
    }
    if (polyType === FRONT) {
      front.push(polygon);
      return;
    }
    if (polyType === BACK) {
      back.push(polygon);
      return;
    }
    if (polyType === SPANNING) {
      const pNorm = polygon.plane.normal;
      let isFlatShaded = true;
      for (let i = 0; i < nVerts; i++) {
        const vn = polygon.vertices[i]!.normal;
        if (
          Math.abs(vn[0] - pNorm[0]) > 1e-5 ||
          Math.abs(vn[1] - pNorm[1]) > 1e-5 ||
          Math.abs(vn[2] - pNorm[2]) > 1e-5
        ) {
          isFlatShaded = false;
          break;
        }
      }
      if (isFlatShaded) {
        // Reconstruct clipped front and back polygons from the WASM output buffers
        const counts = new Int32Array(wasm.memory.buffer, sc.outCountsPtr, 2);
        const fCount = counts[0]!;
        const bCount = counts[1]!;
        if (fCount >= 3) {
          const fView = new Float64Array(wasm.memory.buffer, sc.outFrontPtr, fCount * 3);
          const fVerts: CsgVertex[] = new Array(fCount);
          for (let i = 0; i < fCount; i++) {
            const off = i * 3;
            fVerts[i] = {
              pos: [fView[off]!, fView[off + 1]!, fView[off + 2]!],
              normal: [pNorm[0], pNorm[1], pNorm[2]],
            };
          }
          const fp = createPolygon(fVerts, polygon.tagIndex, polygon.plane);
          if (fp) front.push(fp);
        }
        if (bCount >= 3) {
          const bView = new Float64Array(wasm.memory.buffer, sc.outBackPtr, bCount * 3);
          const bVerts: CsgVertex[] = new Array(bCount);
          for (let i = 0; i < bCount; i++) {
            const off = i * 3;
            bVerts[i] = {
              pos: [bView[off]!, bView[off + 1]!, bView[off + 2]!],
              normal: [pNorm[0], pNorm[1], pNorm[2]],
            };
          }
          const bp = createPolygon(bVerts, polygon.tagIndex, polygon.plane);
          if (bp) back.push(bp);
        }
        return;
      }
    }
  }

  // 2. TypeScript fallback: classify each vertex against the plane with tolerance CSG_EPSILON
  let polygonType = 0;
  const types = getTypesBuffer(nVerts);

  for (let i = 0; i < nVerts; i++) {
    const pos = polygon.vertices[i]!.pos;
    const t = nx * pos[0] + ny * pos[1] + nz * pos[2] - w;
    const type = t < -CSG_EPSILON ? BACK : t > CSG_EPSILON ? FRONT : COPLANAR;
    polygonType |= type;
    types[i] = type;
  }

  // 3. Dispatch according to the combined vertex classification bitmask
  switch (polygonType) {
    case COPLANAR: {
      const dot = nx * polygon.plane.normal[0] + ny * polygon.plane.normal[1] + nz * polygon.plane.normal[2];
      if (dot > 0) {
        coplanarFront.push(polygon);
      } else {
        coplanarBack.push(polygon);
      }
      break;
    }
    case FRONT: {
      front.push(polygon);
      break;
    }
    case BACK: {
      back.push(polygon);
      break;
    }
    case SPANNING: {
      // Walk polygon edges and linearly interpolate intersection vertices where an edge crosses the plane
      const f: CsgVertex[] = [];
      const b: CsgVertex[] = [];
      const len = polygon.vertices.length;
      for (let i = 0; i < len; i++) {
        const j = (i + 1) % len;
        const ti = types[i]!;
        const tj = types[j]!;
        const vi = polygon.vertices[i]!;
        const vj = polygon.vertices[j]!;

        if (ti !== BACK) f.push(vi);
        if (ti !== FRONT) b.push(ti !== BACK ? cloneVertex(vi) : vi);

        if ((ti | tj) === SPANNING) {
          const d0 = nx * vi.pos[0] + ny * vi.pos[1] + nz * vi.pos[2];
          const d1 = nx * vj.pos[0] + ny * vj.pos[1] + nz * vj.pos[2];
          const denom = d1 - d0;
          const t = Math.abs(denom) > 1e-12 ? Math.max(0, Math.min(1, (w - d0) / denom)) : 0.5;
          const vMid = interpolateVertex(vi, vj, t);
          f.push(vMid);
          b.push(cloneVertex(vMid));
        }
      }
      if (f.length >= 3) {
        const fp = createPolygon(f, polygon.tagIndex, polygon.plane);
        if (fp) front.push(fp);
      }
      if (b.length >= 3) {
        const bp = createPolygon(b, polygon.tagIndex, polygon.plane);
        if (bp) back.push(bp);
      }
      break;
    }
  }
}

/**
 * 3D Binary Space Partitioning (BSP) tree node used for exact polygon clipping
 * in constructive solid geometry boolean operations (`Union`, `Subtract`, `Intersect`).
 */
export class CsgBspNode {
  /** Splitting plane for this BSP subtree. */
  private plane: CsgPlane | null = null;
  /** Front half-space child subtree (`normal · x - w > 0`). */
  private front: CsgBspNode | null = null;
  /** Back half-space child subtree (`normal · x - w < 0`). */
  private back: CsgBspNode | null = null;
  /** Coplanar polygons lying on `plane`. */
  private polygons: CsgPolygon[] = [];

  /** Creates a BSP node and optionally partitions `polygons` into the subtree. */
  constructor(polygons?: CsgPolygon[]) {
    if (polygons && polygons.length > 0) {
      this.build(polygons, 0);
    }
  }

  /** Flips solid and empty space across the entire BSP subtree in place. */
  public invert(): void {
    for (let i = 0; i < this.polygons.length; i++) {
      flipPolygon(this.polygons[i]!);
    }
    if (this.plane) {
      this.plane = flipPlane(this.plane);
    }
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    const temp = this.front;
    this.front = this.back;
    this.back = temp;
  }

  /** Recursively removes all fragments of `polygons` that lie inside this BSP tree's solid volume. */
  public clipPolygons(polygons: CsgPolygon[]): CsgPolygon[] {
    if (!this.plane) return polygons.slice();
    let front: CsgPolygon[] = [];
    let back: CsgPolygon[] = [];

    for (let i = 0; i < polygons.length; i++) {
      splitPolygon(this.plane, polygons[i]!, front, back, front, back);
    }

    if (this.front) {
      front = this.front.clipPolygons(front);
    }
    if (this.back) {
      back = this.back.clipPolygons(back);
    } else {
      back = [];
    }

    if (back.length > 0) {
      for (let i = 0; i < back.length; i++) {
        front.push(back[i]!);
      }
    }
    return front;
  }

  /** Clips all polygons stored in this BSP tree against another BSP tree `bsp`. */
  public clipTo(bsp: CsgBspNode): void {
    this.polygons = bsp.clipPolygons(this.polygons);
    if (this.front) this.front.clipTo(bsp);
    if (this.back) this.back.clipTo(bsp);
  }

  /** Collects and returns all polygons stored in this BSP subtree. */
  public allPolygons(out?: CsgPolygon[]): CsgPolygon[] {
    const polys = out ?? [];
    for (let i = 0; i < this.polygons.length; i++) {
      polys.push(this.polygons[i]!);
    }
    if (this.front) this.front.allPolygons(polys);
    if (this.back) this.back.allPolygons(polys);
    return polys;
  }

  /** Incrementally inserts `polygons` into this BSP subtree up to `MAX_BSP_DEPTH`. */
  public build(polygons: CsgPolygon[], depth = 0): void {
    if (polygons.length === 0) return;
    if (depth >= MAX_BSP_DEPTH) {
      for (const p of polygons) this.polygons.push(p);
      return;
    }

    if (!this.plane) {
      // Choose a balanced splitting plane near the middle of the polygon list
      const midIdx = Math.floor(polygons.length / 2);
      this.plane = {
        normal: [
          polygons[midIdx]!.plane.normal[0],
          polygons[midIdx]!.plane.normal[1],
          polygons[midIdx]!.plane.normal[2],
        ],
        w: polygons[midIdx]!.plane.w,
      };
    }

    const front: CsgPolygon[] = [];
    const back: CsgPolygon[] = [];

    for (let i = 0; i < polygons.length; i++) {
      splitPolygon(this.plane, polygons[i]!, this.polygons, this.polygons, front, back);
    }

    if (front.length > 0) {
      if (!this.front) this.front = new CsgBspNode();
      this.front.build(front, depth + 1);
    }
    if (back.length > 0) {
      if (!this.back) this.back = new CsgBspNode();
      this.back.build(back, depth + 1);
    }
  }
}

/** Axis-aligned bounding box of a polygon soup for broad-phase CSG culling. */
interface PolyBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Computes the axis-aligned bounding box enclosing all vertices in `polys`. */
function computePolygonBounds(polys: CsgPolygon[]): PolyBounds {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < polys.length; i++) {
    const verts = polys[i]!.vertices;
    for (let j = 0; j < verts.length; j++) {
      const p = verts[j]!.pos;
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
      if (p[2] < minZ) minZ = p[2];
      if (p[2] > maxZ) maxZ = p[2];
    }
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/** Returns true if two axis-aligned bounding boxes overlap within `CSG_EPSILON`. */
function boundsOverlap(a: PolyBounds, b: PolyBounds): boolean {
  return (
    a.maxX >= b.minX - CSG_EPSILON &&
    a.minX <= b.maxX + CSG_EPSILON &&
    a.maxY >= b.minY - CSG_EPSILON &&
    a.minY <= b.maxY + CSG_EPSILON &&
    a.maxZ >= b.minZ - CSG_EPSILON &&
    a.minZ <= b.maxZ + CSG_EPSILON
  );
}

/** Computes the boolean CSG union ($A \cup B$) of two closed polygon meshes using 3D BSP clipping. */
export function csgUnion(leftPolys: CsgPolygon[], rightPolys: CsgPolygon[]): CsgPolygon[] {
  if (leftPolys.length === 0) return rightPolys.map(clonePolygon);
  if (rightPolys.length === 0) return leftPolys.map(clonePolygon);

  const boundsA = computePolygonBounds(leftPolys);
  const boundsB = computePolygonBounds(rightPolys);
  if (!boundsOverlap(boundsA, boundsB)) {
    return [...leftPolys.map(clonePolygon), ...rightPolys.map(clonePolygon)];
  }

  const a = new CsgBspNode(leftPolys.map(clonePolygon));
  const b = new CsgBspNode(rightPolys.map(clonePolygon));
  a.clipTo(b);
  b.clipTo(a);
  b.invert();
  b.clipTo(a);
  b.invert();
  a.build(b.allPolygons());
  return a.allPolygons();
}

/** Computes the boolean CSG difference ($A \setminus B$) of two closed polygon meshes using 3D BSP clipping. */
export function csgSubtract(leftPolys: CsgPolygon[], rightPolys: CsgPolygon[]): CsgPolygon[] {
  if (leftPolys.length === 0) return [];
  if (rightPolys.length === 0) return leftPolys.map(clonePolygon);

  const boundsA = computePolygonBounds(leftPolys);
  const boundsB = computePolygonBounds(rightPolys);
  if (!boundsOverlap(boundsA, boundsB)) {
    return leftPolys.map(clonePolygon);
  }

  const a = new CsgBspNode(leftPolys.map(clonePolygon));
  const b = new CsgBspNode(rightPolys.map(clonePolygon));
  a.invert();
  a.clipTo(b);
  b.clipTo(a);
  b.invert();
  b.clipTo(a);
  b.invert();
  a.build(b.allPolygons());
  a.invert();
  return a.allPolygons();
}

/** Computes the boolean CSG intersection ($A \cap B$) of two closed polygon meshes using 3D BSP clipping. */
export function csgIntersect(leftPolys: CsgPolygon[], rightPolys: CsgPolygon[]): CsgPolygon[] {
  if (leftPolys.length === 0 || rightPolys.length === 0) return [];

  const boundsA = computePolygonBounds(leftPolys);
  const boundsB = computePolygonBounds(rightPolys);
  if (!boundsOverlap(boundsA, boundsB)) {
    return [];
  }

  const a = new CsgBspNode(leftPolys.map(clonePolygon));
  const b = new CsgBspNode(rightPolys.map(clonePolygon));
  a.invert();
  b.clipTo(a);
  b.invert();
  a.clipTo(b);
  b.clipTo(a);
  a.build(b.allPolygons());
  a.invert();
  return a.allPolygons();
}

/**
 * Computes exact signed volume and total surface area of a watertight triangle mesh
 * using the divergence theorem (signed tetrahedral volume from the origin).
 */
export function computeMeshVolumeAndArea(mesh: ManifoldSurfaceMesh): {
  volume: number;
  surfaceArea: number;
} {
  const { vertices, indices } = mesh;
  let signedVol6 = 0;
  let totalArea = 0;

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i]! * 3;
    const i1 = indices[i + 1]! * 3;
    const i2 = indices[i + 2]! * 3;

    const x0 = vertices[i0]!,
      y0 = vertices[i0 + 1]!,
      z0 = vertices[i0 + 2]!;
    const x1 = vertices[i1]!,
      y1 = vertices[i1 + 1]!,
      z1 = vertices[i1 + 2]!;
    const x2 = vertices[i2]!,
      y2 = vertices[i2 + 1]!,
      z2 = vertices[i2 + 2]!;

    // Cross product p1 x p2 for signed tetrahedron volume with origin
    const cx = y1 * z2 - z1 * y2;
    const cy = z1 * x2 - x1 * z2;
    const cz = x1 * y2 - y1 * x2;
    signedVol6 += x0 * cx + y0 * cy + z0 * cz;

    // Triangle surface area = 0.5 * ||(p1 - p0) x (p2 - p0)||
    const ux = x1 - x0,
      uy = y1 - y0,
      uz = z1 - z0;
    const vx = x2 - x0,
      vy = y2 - y0,
      vz = z2 - z0;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    totalArea += 0.5 * Math.hypot(nx, ny, nz);
  }

  return {
    volume: Math.abs(signedVol6) / 6.0,
    surfaceArea: totalArea,
  };
}
