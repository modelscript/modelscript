/**
 * @modelscript/cad — 3D Binary Space Partitioning (BSP) CSG Clipping Engine & Mesh Metrics.
 *
 * Implements exact 3D polygon clipping for Union, Subtract (Difference), and Intersect
 * boolean operations on triangulated manifold boundary representations, plus exact
 * signed tetrahedral volume and surface area computation.
 */
import type { ManifoldSurfaceMesh } from "./manifold-worker.js";
import type { Vec3 } from "./types.js";
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
/** Computes a normalized {@link CsgPlane} from three non-collinear 3D points, or returns `null` if degenerate. */
export declare function planeFromPoints(a: Vec3, b: Vec3, c: Vec3): CsgPlane | null;
/** Constructs a validated {@link CsgPolygon} from an ordered vertex loop, aligning winding with vertex normals. */
export declare function createPolygon(vertices: CsgVertex[], tagIndex: number, plane?: CsgPlane): CsgPolygon | null;
/**
 * Splits a convex `CsgPolygon` against a partitioning `CsgPlane`, routing the polygon
 * (or its clipped fragments) into `coplanarFront`, `coplanarBack`, `front`, or `back`.
 *
 * Uses the WebAssembly `cad_bsp_split_polygon` kernel for polygons with `<= 32` vertices
 * and falls back to an exact Sutherland-Hodgman edge-clipping loop in TypeScript.
 */
export declare function splitPolygon(plane: CsgPlane, polygon: CsgPolygon, coplanarFront: CsgPolygon[], coplanarBack: CsgPolygon[], front: CsgPolygon[], back: CsgPolygon[]): void;
/**
 * 3D Binary Space Partitioning (BSP) tree node used for exact polygon clipping
 * in constructive solid geometry boolean operations (`Union`, `Subtract`, `Intersect`).
 */
export declare class CsgBspNode {
    /** Splitting plane for this BSP subtree. */
    private plane;
    /** Front half-space child subtree (`normal · x - w > 0`). */
    private front;
    /** Back half-space child subtree (`normal · x - w < 0`). */
    private back;
    /** Coplanar polygons lying on `plane`. */
    private polygons;
    /** Creates a BSP node and optionally partitions `polygons` into the subtree. */
    constructor(polygons?: CsgPolygon[]);
    /** Flips solid and empty space across the entire BSP subtree in place. */
    invert(): void;
    /** Recursively removes all fragments of `polygons` that lie inside this BSP tree's solid volume. */
    clipPolygons(polygons: CsgPolygon[]): CsgPolygon[];
    /** Clips all polygons stored in this BSP tree against another BSP tree `bsp`. */
    clipTo(bsp: CsgBspNode): void;
    /** Collects and returns all polygons stored in this BSP subtree. */
    allPolygons(out?: CsgPolygon[]): CsgPolygon[];
    /** Incrementally inserts `polygons` into this BSP subtree up to `MAX_BSP_DEPTH`. */
    build(polygons: CsgPolygon[], depth?: number): void;
}
/** Computes the boolean CSG union ($A \cup B$) of two closed polygon meshes using 3D BSP clipping. */
export declare function csgUnion(leftPolys: CsgPolygon[], rightPolys: CsgPolygon[]): CsgPolygon[];
/** Computes the boolean CSG difference ($A \setminus B$) of two closed polygon meshes using 3D BSP clipping. */
export declare function csgSubtract(leftPolys: CsgPolygon[], rightPolys: CsgPolygon[]): CsgPolygon[];
/** Computes the boolean CSG intersection ($A \cap B$) of two closed polygon meshes using 3D BSP clipping. */
export declare function csgIntersect(leftPolys: CsgPolygon[], rightPolys: CsgPolygon[]): CsgPolygon[];
/**
 * Computes exact signed volume and total surface area of a watertight triangle mesh
 * using the divergence theorem (signed tetrahedral volume from the origin).
 */
export declare function computeMeshVolumeAndArea(mesh: ManifoldSurfaceMesh): {
    volume: number;
    surfaceArea: number;
};
//# sourceMappingURL=csg-bsp.d.ts.map