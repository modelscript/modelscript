import type { BoundaryPatchTag, Solid, SolidSourceMetadata } from "./types.js";
/**
 * Watertight 2-Manifold Triangulated Surface Mesh with Semantic Boundary Patch Tags.
 */
export interface ManifoldSurfaceMesh {
    /** Vertex positions (x, y, z) packed contiguous [x0, y0, z0, x1, y1, z1, ...]. */
    vertices: Float32Array;
    /** Triangle indices [t0_a, t0_b, t0_c, t1_a, ...]. */
    indices: Uint32Array;
    /** Vertex normals (nx, ny, nz) packed contiguous. */
    normals: Float32Array;
    /** Per-triangle boundary patch tag index (0 = untagged, >= 1 corresponds to tags[id - 1]). */
    faceTagIndices: Uint32Array;
    /** List of distinct semantic boundary patch tags referenced by faceTagIndices. */
    tags: BoundaryPatchTag[];
    /** Optional source code metadata linking this mesh to AST parameters or transforms. */
    sourceMetadata?: SolidSourceMetadata | undefined;
}
/**
 * Procedural Manifold CSG Mesher.
 * Evaluates the constructive solid geometry tree and synthesizes
 * watertight 2-manifold triangular boundary surfaces.
 */
export declare class ManifoldWorker {
    /**
     * Evaluates a Solid CSG tree into a clean watertight triangular mesh.
     */
    static evaluateSolid(solid: Solid): ManifoldSurfaceMesh;
}
//# sourceMappingURL=manifold-worker.d.ts.map