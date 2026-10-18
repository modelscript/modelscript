// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPolygon, csgIntersect, csgSubtract, csgUnion, type CsgPolygon } from "./csg-bsp.js";
import { IDENTITY, mat4Multiply } from "./transforms.js";
import type { BoundaryPatchTag, Mat4, Solid, SolidSourceMetadata, Vec3 } from "./types.js";
import { SolidKind } from "./types.js";

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
export class ManifoldWorker {
  /**
   * Evaluates a Solid CSG tree into a clean watertight triangular mesh.
   */
  public static evaluateSolid(solid: Solid): ManifoldSurfaceMesh {
    const meshBuilder = new SurfaceMeshBuilder();
    meshBuilder.processSolid(solid, IDENTITY, undefined);
    return meshBuilder.finalize();
  }
}

/**
 * Internal mesh builder that recursively traverses the Solid tree,
 * applies transforms, and preserves semantic boundary patch metadata.
 */
class SurfaceMeshBuilder {
  /** Flat array of 3D vertex coordinates `[x0, y0, z0, x1, y1, z1, ...]`. */
  private vertices: number[] = [];
  /** Flat array of triangle vertex indices `[i0, i1, i2, ...]`. */
  private indices: number[] = [];
  /** Flat array of outward unit vertex normals `[nx0, ny0, nz0, ...]`. */
  private normals: number[] = [];
  /** Per-triangle 1-based boundary patch tag index (`0` = untagged). */
  private faceTags: number[] = [];
  /** Deduplication lookup table mapping `"portName:portType"` to its 1-based tag index. */
  private tagMap: Map<string, number>; // key -> 1-based index
  /** Ordered list of distinct semantic boundary patch tags referenced by `faceTags`. */
  private tags: BoundaryPatchTag[];
  /** Source CST metadata inherited from the root solid node. */
  private sourceMetadata?: SolidSourceMetadata | undefined;

  /** Initializes a surface mesh builder, optionally sharing an existing boundary patch tag table. */
  constructor(tagMap?: Map<string, number>, tags?: BoundaryPatchTag[]) {
    this.tagMap = tagMap ?? new Map();
    this.tags = tags ?? [];
  }

  /** Interns `tag` into `this.tags` and returns its 1-based index (`0` if `tag` is undefined). */
  private getTagIndex(tag?: BoundaryPatchTag): number {
    if (!tag) return 0;
    const key = `${tag.portName}:${tag.portType}`;
    let idx = this.tagMap.get(key);
    if (idx === undefined) {
      this.tags.push(tag);
      idx = this.tags.length; // 1-based index
      this.tagMap.set(key, idx);
    }
    return idx;
  }

  /** Recursively evaluates a `Solid` CSG subtree under cumulative world transform `parentMat`. */
  public processSolid(solid: Solid, parentMat: Mat4, activeTag?: BoundaryPatchTag): void {
    if (solid.sourceMetadata && !this.sourceMetadata) {
      this.sourceMetadata = solid.sourceMetadata;
    }
    switch (solid.kind) {
      case SolidKind.Transform: {
        const combined = mat4Multiply(parentMat, solid.matrix);
        this.processSolid(solid.child, combined, activeTag);
        break;
      }

      case SolidKind.TaggedPatch: {
        const tag = solid.tag ?? activeTag;
        this.processSolid(solid.child, parentMat, tag);
        break;
      }

      case SolidKind.Box: {
        this.emitBox(solid.width, solid.height, solid.depth, parentMat, activeTag);
        break;
      }

      case SolidKind.Cylinder: {
        const rBot = solid.radiusBottom ?? solid.radius;
        const rTop = solid.radiusTop ?? solid.radius;
        this.emitCylinder(rBot, rTop, solid.height, solid.segments, parentMat, activeTag);
        break;
      }

      case SolidKind.Polyhedron: {
        this.emitPolyhedron(solid.points, solid.faces, parentMat, activeTag);
        break;
      }

      case SolidKind.Sphere: {
        this.emitSphere(solid.radius, solid.widthSegments, solid.heightSegments, parentMat, activeTag);
        break;
      }

      case SolidKind.Torus: {
        this.emitTorus(solid.major, solid.minor, solid.majorSegments, solid.minorSegments, parentMat, activeTag);
        break;
      }

      case SolidKind.Extrusion: {
        this.emitExtrusion(solid.polygon, solid.height, solid.twist, solid.scale, parentMat, activeTag);
        break;
      }

      case SolidKind.Union:
      case SolidKind.Subtract:
      case SolidKind.Intersect: {
        const leftBuilder = new SurfaceMeshBuilder(this.tagMap, this.tags);
        const rightBuilder = new SurfaceMeshBuilder(this.tagMap, this.tags);
        leftBuilder.processSolid(solid.left, parentMat, activeTag);
        rightBuilder.processSolid(solid.right, parentMat, activeTag);

        const leftPolys = leftBuilder.toPolygons();
        const rightPolys = rightBuilder.toPolygons();

        let resultPolys: CsgPolygon[];
        if (solid.kind === SolidKind.Union) {
          resultPolys = csgUnion(leftPolys, rightPolys);
        } else if (solid.kind === SolidKind.Subtract) {
          resultPolys = csgSubtract(leftPolys, rightPolys);
        } else {
          resultPolys = csgIntersect(leftPolys, rightPolys);
        }

        this.emitPolygons(resultPolys);
        break;
      }

      case SolidKind.Fillet: {
        if (solid.child.kind === SolidKind.Box) {
          this.emitFilletedBox(
            solid.child.width,
            solid.child.height,
            solid.child.depth,
            solid.radius,
            parentMat,
            activeTag,
          );
        } else if (solid.child.kind === SolidKind.Cylinder) {
          this.emitFilletedCylinder(
            solid.child.radiusBottom ?? solid.child.radius,
            solid.child.radiusTop ?? solid.child.radius,
            solid.child.height,
            solid.child.segments,
            solid.radius,
            false,
            parentMat,
            activeTag,
          );
        } else {
          this.processSolid(solid.child, parentMat, activeTag);
        }
        break;
      }

      case SolidKind.Chamfer: {
        if (solid.child.kind === SolidKind.Box) {
          this.emitChamferedBox(
            solid.child.width,
            solid.child.height,
            solid.child.depth,
            solid.distance,
            parentMat,
            activeTag,
          );
        } else if (solid.child.kind === SolidKind.Cylinder) {
          this.emitFilletedCylinder(
            solid.child.radiusBottom ?? solid.child.radius,
            solid.child.radiusTop ?? solid.child.radius,
            solid.child.height,
            solid.child.segments,
            solid.distance,
            true,
            parentMat,
            activeTag,
          );
        } else {
          this.processSolid(solid.child, parentMat, activeTag);
        }
        break;
      }
    }
  }

  /** Converts all accumulated triangles into convex {@link CsgPolygon} records for 3D BSP boolean clipping. */
  public toPolygons(): CsgPolygon[] {
    const polys: CsgPolygon[] = [];
    for (let i = 0; i < this.indices.length; i += 3) {
      const i0 = this.indices[i]! * 3;
      const i1 = this.indices[i + 1]! * 3;
      const i2 = this.indices[i + 2]! * 3;
      const tagIndex = this.faceTags[i / 3] ?? 0;

      const poly = createPolygon(
        [
          {
            pos: [this.vertices[i0]!, this.vertices[i0 + 1]!, this.vertices[i0 + 2]!],
            normal: [this.normals[i0]!, this.normals[i0 + 1]!, this.normals[i0 + 2]!],
          },
          {
            pos: [this.vertices[i1]!, this.vertices[i1 + 1]!, this.vertices[i1 + 2]!],
            normal: [this.normals[i1]!, this.normals[i1 + 1]!, this.normals[i1 + 2]!],
          },
          {
            pos: [this.vertices[i2]!, this.vertices[i2 + 1]!, this.vertices[i2 + 2]!],
            normal: [this.normals[i2]!, this.normals[i2 + 1]!, this.normals[i2 + 2]!],
          },
        ],
        tagIndex,
      );
      if (poly) polys.push(poly);
    }
    return polys;
  }

  /** Fan-triangulates clipped {@link CsgPolygon} records back into the builder's vertex/index buffers. */
  public emitPolygons(polys: CsgPolygon[]): void {
    for (let i = 0; i < polys.length; i++) {
      const poly = polys[i]!;
      const verts = poly.vertices;
      for (let j = 1; j < verts.length - 1; j++) {
        const v0 = verts[0]!;
        const v1 = verts[j]!;
        const v2 = verts[j + 1]!;
        const baseIdx = this.vertices.length / 3;
        this.vertices.push(...v0.pos, ...v1.pos, ...v2.pos);
        this.normals.push(...v0.normal, ...v1.normal, ...v2.normal);
        this.indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
        this.faceTags.push(poly.tagIndex);
      }
    }
  }

  /** Transforms a 3D point `(x, y, z)` by column-major 4x4 affine matrix `mat`. */
  private transformPoint(mat: Mat4, x: number, y: number, z: number): [number, number, number] {
    const tx = mat[0] * x + mat[4] * y + mat[8] * z + mat[12];
    const ty = mat[1] * x + mat[5] * y + mat[9] * z + mat[13];
    const tz = mat[2] * x + mat[6] * y + mat[10] * z + mat[14];
    return [tx, ty, tz];
  }

  /** Transforms and normalizes a 3D normal vector `(nx, ny, nz)` by the 3x3 linear part of `mat`. */
  private transformNormal(mat: Mat4, nx: number, ny: number, nz: number): [number, number, number] {
    const tx = mat[0] * nx + mat[4] * ny + mat[8] * nz;
    const ty = mat[1] * nx + mat[5] * ny + mat[9] * nz;
    const tz = mat[2] * nx + mat[6] * ny + mat[10] * nz;
    const len = Math.hypot(tx, ty, tz) || 1.0;
    return [tx / len, ty / len, tz / len];
  }

  /** Appends a single triangle `(p0, p1, p2)` with outward `normal`, enforcing CCW winding. */
  private addTriangle(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    normal: [number, number, number],
    tag?: BoundaryPatchTag,
  ): void {
    // Ensure triangle winding is counter-clockwise with respect to the outward normal
    const ux = p1[0] - p0[0],
      uy = p1[1] - p0[1],
      uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0],
      vy = p2[1] - p0[1],
      vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const dot = cx * normal[0] + cy * normal[1] + cz * normal[2];

    const baseIdx = this.vertices.length / 3;
    if (dot < 0) {
      this.vertices.push(...p0, ...p2, ...p1);
    } else {
      this.vertices.push(...p0, ...p1, ...p2);
    }
    this.normals.push(...normal, ...normal, ...normal);
    this.indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    this.faceTags.push(this.getTagIndex(tag));
  }

  /** Tessellates an axis-aligned box of dimensions `(w, h, d)` into 12 triangles. */
  private emitBox(w: number, h: number, d: number, mat: Mat4, tag?: BoundaryPatchTag): void {
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;

    const faces: [Vec3, [Vec3, Vec3, Vec3, Vec3]][] = [
      [
        [0, 0, 1],
        [
          [-hw, -hh, hd],
          [hw, -hh, hd],
          [hw, hh, hd],
          [-hw, hh, hd],
        ],
      ], // +Z
      [
        [0, 0, -1],
        [
          [hw, -hh, -hd],
          [-hw, -hh, -hd],
          [-hw, hh, -hd],
          [hw, hh, -hd],
        ],
      ], // -Z
      [
        [1, 0, 0],
        [
          [hw, -hh, hd],
          [hw, -hh, -hd],
          [hw, hh, -hd],
          [hw, hh, hd],
        ],
      ], // +X
      [
        [-1, 0, 0],
        [
          [-hw, -hh, -hd],
          [-hw, -hh, hd],
          [-hw, hh, hd],
          [-hw, hh, -hd],
        ],
      ], // -X
      [
        [0, 1, 0],
        [
          [-hw, hh, hd],
          [hw, hh, hd],
          [hw, hh, -hd],
          [-hw, hh, -hd],
        ],
      ], // +Y
      [
        [0, -1, 0],
        [
          [-hw, -hh, -hd],
          [hw, -hh, -hd],
          [hw, -hh, hd],
          [-hw, -hh, hd],
        ],
      ], // -Y
    ];

    for (const [norm, [v0, v1, v2, v3]] of faces) {
      const tNorm = this.transformNormal(mat, norm[0], norm[1], norm[2]);
      const p0 = this.transformPoint(mat, v0[0], v0[1], v0[2]);
      const p1 = this.transformPoint(mat, v1[0], v1[1], v1[2]);
      const p2 = this.transformPoint(mat, v2[0], v2[1], v2[2]);
      const p3 = this.transformPoint(mat, v3[0], v3[1], v3[2]);

      this.addTriangle(p0, p1, p2, tNorm, tag);
      this.addTriangle(p0, p2, p3, tNorm, tag);
    }
  }

  /** Tessellates a box with beveled edges and corner facets of chamfer/fillet inset `dist`. */
  private emitChamferedBox(w: number, h: number, d: number, dist: number, mat: Mat4, tag?: BoundaryPatchTag): void {
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const c = Math.min(dist, hw * 0.45, hh * 0.45, hd * 0.45);
    if (c <= 1e-6) {
      this.emitBox(w, h, d, mat, tag);
      return;
    }
    const x1 = hw - c,
      y1 = hh - c,
      z1 = hd - c;

    // Helper for quad emission
    const addQuad = (v0: Vec3, v1: Vec3, v2: Vec3, v3: Vec3, norm: Vec3) => {
      const tNorm = this.transformNormal(mat, norm[0], norm[1], norm[2]);
      const p0 = this.transformPoint(mat, v0[0], v0[1], v0[2]);
      const p1 = this.transformPoint(mat, v1[0], v1[1], v1[2]);
      const p2 = this.transformPoint(mat, v2[0], v2[1], v2[2]);
      const p3 = this.transformPoint(mat, v3[0], v3[1], v3[2]);
      this.addTriangle(p0, p1, p2, tNorm, tag);
      this.addTriangle(p0, p2, p3, tNorm, tag);
    };

    // 1. 6 Center planar faces (quads)
    addQuad([-x1, -y1, hd], [x1, -y1, hd], [x1, y1, hd], [-x1, y1, hd], [0, 0, 1]);
    addQuad([x1, -y1, -hd], [-x1, -y1, -hd], [-x1, y1, -hd], [x1, y1, -hd], [0, 0, -1]);
    addQuad([hw, -y1, hd], [hw, -y1, -hd], [hw, y1, -hd], [hw, y1, hd], [1, 0, 0]);
    addQuad([-hw, -y1, -hd], [-hw, -y1, hd], [-hw, y1, hd], [-hw, y1, -hd], [-1, 0, 0]);
    addQuad([-x1, hh, hd], [x1, hh, hd], [x1, hh, -hd], [-x1, hh, -hd], [0, 1, 0]);
    addQuad([-x1, -hh, -hd], [x1, -hh, -hd], [x1, -hh, hd], [-x1, -hh, hd], [0, -1, 0]);

    // 2. 12 Beveled Edge Quads
    const invSqrt2 = 1.0 / Math.SQRT2;
    // Edges parallel to Z (4)
    addQuad([x1, hh, z1], [hw, y1, z1], [hw, y1, -z1], [x1, hh, -z1], [invSqrt2, invSqrt2, 0]);
    addQuad([-hw, y1, z1], [-x1, hh, z1], [-x1, hh, -z1], [-hw, y1, -z1], [-invSqrt2, invSqrt2, 0]);
    addQuad([-x1, -hh, z1], [-hw, -y1, z1], [-hw, -y1, -z1], [-x1, -hh, -z1], [-invSqrt2, -invSqrt2, 0]);
    addQuad([hw, -y1, z1], [x1, -hh, z1], [x1, -hh, -z1], [hw, -y1, -z1], [invSqrt2, -invSqrt2, 0]);

    // Edges parallel to X (4)
    addQuad([x1, hh, z1], [-x1, hh, z1], [-x1, y1, hd], [x1, y1, hd], [0, invSqrt2, invSqrt2]);
    addQuad([-x1, hh, -z1], [x1, hh, -z1], [x1, y1, -hd], [-x1, y1, -hd], [0, invSqrt2, -invSqrt2]);
    addQuad([-x1, -hh, z1], [x1, -hh, z1], [x1, -y1, hd], [-x1, -y1, hd], [0, -invSqrt2, invSqrt2]);
    addQuad([x1, -hh, -z1], [-x1, -hh, -z1], [-x1, -y1, -hd], [x1, -y1, -hd], [0, -invSqrt2, -invSqrt2]);

    // Edges parallel to Y (4)
    addQuad([hw, y1, z1], [x1, y1, hd], [x1, -y1, hd], [hw, -y1, z1], [invSqrt2, 0, invSqrt2]);
    addQuad([x1, y1, -hd], [hw, y1, -z1], [hw, -y1, -z1], [x1, -y1, -hd], [invSqrt2, 0, -invSqrt2]);
    addQuad([-x1, y1, hd], [-hw, y1, z1], [-hw, -y1, z1], [-x1, -y1, hd], [-invSqrt2, 0, invSqrt2]);
    addQuad([-hw, y1, -z1], [-x1, y1, -hd], [-x1, -y1, -hd], [-hw, -y1, -z1], [-invSqrt2, 0, -invSqrt2]);

    // 3. 8 Corner Triangles
    const invSqrt3 = 1.0 / Math.sqrt(3);
    const signs: readonly (readonly [number, number, number])[] = [
      [1, 1, 1],
      [-1, 1, 1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, -1],
      [1, -1, -1],
    ];

    for (const [sx, sy, sz] of signs) {
      const pA: Vec3 = [sx * hw, sy * y1, sz * z1];
      const pB: Vec3 = [sx * x1, sy * hh, sz * z1];
      const pC: Vec3 = [sx * x1, sy * y1, sz * hd];
      const norm: Vec3 = [sx * invSqrt3, sy * invSqrt3, sz * invSqrt3];
      const tNorm = this.transformNormal(mat, norm[0], norm[1], norm[2]);
      const tpA = this.transformPoint(mat, pA[0], pA[1], pA[2]);
      const tpB = this.transformPoint(mat, pB[0], pB[1], pB[2]);
      const tpC = this.transformPoint(mat, pC[0], pC[1], pC[2]);
      if (sx * sy * sz > 0) {
        this.addTriangle(tpA, tpB, tpC, tNorm, tag);
      } else {
        this.addTriangle(tpA, tpC, tpB, tNorm, tag);
      }
    }
  }

  /** Tessellates a box with multi-segment quarter-cylinder rounded edges and spherical octant corners of radius `r`. */
  private emitFilletedBox(w: number, h: number, d: number, r: number, mat: Mat4, tag?: BoundaryPatchTag): void {
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const c = Math.min(r, hw * 0.45, hh * 0.45, hd * 0.45);
    if (c <= 1e-6) {
      this.emitBox(w, h, d, mat, tag);
      return;
    }
    const x1 = hw - c;
    const y1 = hh - c;
    const z1 = hd - c;
    const arcSegs = 4;

    const addQuad = (v0: Vec3, v1: Vec3, v2: Vec3, v3: Vec3, norm: Vec3) => {
      const tNorm = this.transformNormal(mat, norm[0], norm[1], norm[2]);
      const p0 = this.transformPoint(mat, v0[0], v0[1], v0[2]);
      const p1 = this.transformPoint(mat, v1[0], v1[1], v1[2]);
      const p2 = this.transformPoint(mat, v2[0], v2[1], v2[2]);
      const p3 = this.transformPoint(mat, v3[0], v3[1], v3[2]);
      this.addTriangle(p0, p1, p2, tNorm, tag);
      this.addTriangle(p0, p2, p3, tNorm, tag);
    };

    // 1. 6 Center planar faces
    addQuad([-x1, -y1, hd], [x1, -y1, hd], [x1, y1, hd], [-x1, y1, hd], [0, 0, 1]);
    addQuad([x1, -y1, -hd], [-x1, -y1, -hd], [-x1, y1, -hd], [x1, y1, -hd], [0, 0, -1]);
    addQuad([hw, -y1, hd], [hw, -y1, -hd], [hw, y1, -hd], [hw, y1, hd], [1, 0, 0]);
    addQuad([-hw, -y1, -hd], [-hw, -y1, hd], [-hw, y1, hd], [-hw, y1, -hd], [-1, 0, 0]);
    addQuad([-x1, hh, hd], [x1, hh, hd], [x1, hh, -hd], [-x1, hh, -hd], [0, 1, 0]);
    addQuad([-x1, -hh, -hd], [x1, -hh, -hd], [x1, -hh, hd], [-x1, -hh, hd], [0, -1, 0]);

    // 2. 12 Quarter-cylinder rounded edges
    const signPairs: readonly (readonly [number, number])[] = [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ];
    for (const [s1, s2] of signPairs) {
      for (let i = 0; i < arcSegs; i++) {
        const a0 = (i / arcSegs) * (Math.PI / 2);
        const a1 = ((i + 1) / arcSegs) * (Math.PI / 2);
        const am = 0.5 * (a0 + a1);
        const c0 = Math.cos(a0),
          sn0 = Math.sin(a0);
        const c1 = Math.cos(a1),
          sn1 = Math.sin(a1);
        const cm = Math.cos(am),
          snm = Math.sin(am);

        // Z-parallel edges (varying in X, Y)
        addQuad(
          [s1 * (x1 + c * c0), s2 * (y1 + c * sn0), z1],
          [s1 * (x1 + c * c1), s2 * (y1 + c * sn1), z1],
          [s1 * (x1 + c * c1), s2 * (y1 + c * sn1), -z1],
          [s1 * (x1 + c * c0), s2 * (y1 + c * sn0), -z1],
          [s1 * cm, s2 * snm, 0],
        );

        // X-parallel edges (varying in Y, Z)
        addQuad(
          [x1, s1 * (y1 + c * c0), s2 * (z1 + c * sn0)],
          [-x1, s1 * (y1 + c * c0), s2 * (z1 + c * sn0)],
          [-x1, s1 * (y1 + c * c1), s2 * (z1 + c * sn1)],
          [x1, s1 * (y1 + c * c1), s2 * (z1 + c * sn1)],
          [0, s1 * cm, s2 * snm],
        );

        // Y-parallel edges (varying in Z, X)
        addQuad(
          [s2 * (x1 + c * sn0), y1, s1 * (z1 + c * c0)],
          [s2 * (x1 + c * sn1), y1, s1 * (z1 + c * c1)],
          [s2 * (x1 + c * sn1), -y1, s1 * (z1 + c * c1)],
          [s2 * (x1 + c * sn0), -y1, s1 * (z1 + c * c0)],
          [s2 * snm, 0, s1 * cm],
        );
      }
    }

    // 3. 8 Spherical octant corner patches
    const cornerSigns: readonly (readonly [number, number, number])[] = [
      [1, 1, 1],
      [-1, 1, 1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, -1],
      [1, -1, -1],
    ];
    for (const [sx, sy, sz] of cornerSigns) {
      for (let iy = 0; iy < arcSegs; iy++) {
        const phi0 = (iy / arcSegs) * (Math.PI / 2);
        const phi1 = ((iy + 1) / arcSegs) * (Math.PI / 2);
        for (let ix = 0; ix < arcSegs; ix++) {
          const th0 = (ix / arcSegs) * (Math.PI / 2);
          const th1 = ((ix + 1) / arcSegs) * (Math.PI / 2);
          const sph = (phi: number, th: number): [Vec3, Vec3] => {
            const nx = sx * Math.sin(phi) * Math.cos(th);
            const ny = sy * Math.cos(phi);
            const nz = sz * Math.sin(phi) * Math.sin(th);
            return [
              [sx * x1 + c * nx, sy * y1 + c * ny, sz * z1 + c * nz],
              [nx, ny, nz],
            ];
          };
          const [v00, n00] = sph(phi0, th0);
          const [v10] = sph(phi0, th1);
          const [v01] = sph(phi1, th0);
          const [v11, n11] = sph(phi1, th1);
          const tNorm = this.transformNormal(
            mat,
            0.5 * (n00[0] + n11[0]),
            0.5 * (n00[1] + n11[1]),
            0.5 * (n00[2] + n11[2]),
          );
          const p00 = this.transformPoint(mat, v00[0], v00[1], v00[2]);
          const p10 = this.transformPoint(mat, v10[0], v10[1], v10[2]);
          const p01 = this.transformPoint(mat, v01[0], v01[1], v01[2]);
          const p11 = this.transformPoint(mat, v11[0], v11[1], v11[2]);
          if (iy > 0) {
            this.addTriangle(p00, p01, p10, tNorm, tag);
          }
          this.addTriangle(p10, p01, p11, tNorm, tag);
        }
      }
    }
  }

  /** Tessellates a cylinder with beveled or filleted top and bottom rim edges. */
  private emitFilletedCylinder(
    radiusBottom: number,
    radiusTop: number,
    height: number,
    segments: number,
    inset: number,
    isChamfer: boolean,
    mat: Mat4,
    tag?: BoundaryPatchTag,
  ): void {
    const hh = height / 2;
    const c = Math.min(inset, radiusBottom * 0.4, radiusTop * 0.4, hh * 0.4);
    if (c <= 1e-6) {
      this.emitCylinder(radiusBottom, radiusTop, height, segments, mat, tag);
      return;
    }
    const segs = Math.max(8, segments);
    const rimSteps = isChamfer ? 1 : 4;

    // Build profile (r, y) from bottom cap rim to top cap rim
    const profile: [number, number][] = [];
    for (let s = 0; s <= rimSteps; s++) {
      const t = s / rimSteps;
      if (isChamfer) {
        profile.push([radiusBottom - c * (1 - t), -hh + c * t]);
      } else {
        const ang = (t * Math.PI) / 2;
        profile.push([radiusBottom - c + c * Math.sin(ang), -hh + c - c * Math.cos(ang)]);
      }
    }
    for (let s = 0; s <= rimSteps; s++) {
      const t = s / rimSteps;
      if (isChamfer) {
        profile.push([radiusTop - c * t, hh - c * (1 - t)]);
      } else {
        const ang = (t * Math.PI) / 2;
        profile.push([radiusTop - c + c * Math.cos(ang), hh - c + c * Math.sin(ang)]);
      }
    }

    for (let p = 0; p < profile.length - 1; p++) {
      const [r0, y0] = profile[p]!;
      const [r1, y1] = profile[p + 1]!;
      const dy = y1 - y0;
      const dr = r0 - r1;
      const len = Math.hypot(dr, dy) || 1.0;
      const cosS = dy / len;
      const sinS = dr / len;
      for (let i = 0; i < segs; i++) {
        const th0 = (i / segs) * 2 * Math.PI;
        const th1 = ((i + 1) / segs) * 2 * Math.PI;
        const p0 = this.transformPoint(mat, r0 * Math.cos(th0), y0, r0 * Math.sin(th0));
        const p1 = this.transformPoint(mat, r0 * Math.cos(th1), y0, r0 * Math.sin(th1));
        const p2 = this.transformPoint(mat, r1 * Math.cos(th1), y1, r1 * Math.sin(th1));
        const p3 = this.transformPoint(mat, r1 * Math.cos(th0), y1, r1 * Math.sin(th0));
        const mid = 0.5 * (th0 + th1);
        const norm = this.transformNormal(mat, Math.cos(mid) * cosS, sinS, Math.sin(mid) * cosS);
        this.addTriangle(p0, p2, p1, norm, tag);
        this.addTriangle(p0, p3, p2, norm, tag);
      }
    }

    const rTopInner = Math.max(1e-6, radiusTop - c);
    const topNorm = this.transformNormal(mat, 0, 1, 0);
    const topCenter = this.transformPoint(mat, 0, hh, 0);
    for (let i = 0; i < segs; i++) {
      const th0 = (i / segs) * 2 * Math.PI;
      const th1 = ((i + 1) / segs) * 2 * Math.PI;
      const p0 = this.transformPoint(mat, rTopInner * Math.cos(th0), hh, rTopInner * Math.sin(th0));
      const p1 = this.transformPoint(mat, rTopInner * Math.cos(th1), hh, rTopInner * Math.sin(th1));
      this.addTriangle(topCenter, p1, p0, topNorm, tag);
    }

    const rBotInner = Math.max(1e-6, radiusBottom - c);
    const botNorm = this.transformNormal(mat, 0, -1, 0);
    const botCenter = this.transformPoint(mat, 0, -hh, 0);
    for (let i = 0; i < segs; i++) {
      const th0 = (i / segs) * 2 * Math.PI;
      const th1 = ((i + 1) / segs) * 2 * Math.PI;
      const p0 = this.transformPoint(mat, rBotInner * Math.cos(th0), -hh, rBotInner * Math.sin(th0));
      const p1 = this.transformPoint(mat, rBotInner * Math.cos(th1), -hh, rBotInner * Math.sin(th1));
      this.addTriangle(botCenter, p0, p1, botNorm, tag);
    }
  }

  /** Tessellates a cylinder, cone, or frustum along the Y axis with `segments` radial subdivisions. */
  private emitCylinder(
    radiusBottom: number,
    radiusTop: number,
    height: number,
    segments: number,
    mat: Mat4,
    tag?: BoundaryPatchTag,
  ): void {
    const hh = height / 2;
    const segs = Math.max(8, segments);
    const dr = radiusBottom - radiusTop;
    const slantLen = Math.hypot(dr, height) || 1.0;
    const cosSlope = height / slantLen;
    const sinSlope = dr / slantLen;

    // Barrel / frustum wall
    for (let i = 0; i < segs; i++) {
      const theta0 = (i / segs) * 2 * Math.PI;
      const theta1 = ((i + 1) / segs) * 2 * Math.PI;

      const c0 = Math.cos(theta0);
      const s0 = Math.sin(theta0);
      const c1 = Math.cos(theta1);
      const s1 = Math.sin(theta1);

      const p0 = this.transformPoint(mat, radiusBottom * c0, -hh, radiusBottom * s0);
      const p1 = this.transformPoint(mat, radiusBottom * c1, -hh, radiusBottom * s1);
      const p2 = this.transformPoint(mat, radiusTop * c1, hh, radiusTop * s1);
      const p3 = this.transformPoint(mat, radiusTop * c0, hh, radiusTop * s0);

      const midTheta = (theta0 + theta1) / 2;
      const tNorm = this.transformNormal(mat, Math.cos(midTheta) * cosSlope, sinSlope, Math.sin(midTheta) * cosSlope);

      if (radiusBottom > 1e-9) {
        this.addTriangle(p0, p2, p1, tNorm, tag);
      }
      if (radiusTop > 1e-9) {
        this.addTriangle(p0, p3, p2, tNorm, tag);
      }
    }

    // Top cap (+Y)
    if (radiusTop > 1e-9) {
      const topNorm = this.transformNormal(mat, 0, 1, 0);
      const topCenter = this.transformPoint(mat, 0, hh, 0);
      for (let i = 0; i < segs; i++) {
        const theta0 = (i / segs) * 2 * Math.PI;
        const theta1 = ((i + 1) / segs) * 2 * Math.PI;
        const p0 = this.transformPoint(mat, radiusTop * Math.cos(theta0), hh, radiusTop * Math.sin(theta0));
        const p1 = this.transformPoint(mat, radiusTop * Math.cos(theta1), hh, radiusTop * Math.sin(theta1));
        this.addTriangle(topCenter, p1, p0, topNorm, tag);
      }
    }

    // Bottom cap (-Y)
    if (radiusBottom > 1e-9) {
      const botNorm = this.transformNormal(mat, 0, -1, 0);
      const botCenter = this.transformPoint(mat, 0, -hh, 0);
      for (let i = 0; i < segs; i++) {
        const theta0 = (i / segs) * 2 * Math.PI;
        const theta1 = ((i + 1) / segs) * 2 * Math.PI;
        const p0 = this.transformPoint(mat, radiusBottom * Math.cos(theta0), -hh, radiusBottom * Math.sin(theta0));
        const p1 = this.transformPoint(mat, radiusBottom * Math.cos(theta1), -hh, radiusBottom * Math.sin(theta1));
        this.addTriangle(botCenter, p0, p1, botNorm, tag);
      }
    }
  }

  /** Tessellates an arbitrary polyhedron defined by 3D `points` and polygonal `faces`. */
  private emitPolyhedron(
    points: readonly Vec3[],
    faces: readonly (readonly number[])[],
    mat: Mat4,
    tag?: BoundaryPatchTag,
  ): void {
    if (points.length < 3 || faces.length === 0) return;

    // Compute centroid of points to orient face normals outward
    let cx = 0,
      cy = 0,
      cz = 0;
    for (const pt of points) {
      cx += pt[0];
      cy += pt[1];
      cz += pt[2];
    }
    cx /= points.length;
    cy /= points.length;
    cz /= points.length;
    const worldCenter = this.transformPoint(mat, cx, cy, cz);

    for (const face of faces) {
      if (face.length < 3) continue;
      const v0 = points[face[0]!];
      const v1 = points[face[1]!];
      const v2 = points[face[2]!];
      if (!v0 || !v1 || !v2) continue;

      const p0 = this.transformPoint(mat, v0[0], v0[1], v0[2]);
      const p1 = this.transformPoint(mat, v1[0], v1[1], v1[2]);
      const p2 = this.transformPoint(mat, v2[0], v2[1], v2[2]);

      const ux = p1[0] - p0[0],
        uy = p1[1] - p0[1],
        uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0],
        vy = p2[1] - p0[1],
        vz = p2[2] - p0[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1.0;
      nx /= len;
      ny /= len;
      nz /= len;

      // Orient normal outward from centroid
      const dx = p0[0] - worldCenter[0];
      const dy = p0[1] - worldCenter[1];
      const dz = p0[2] - worldCenter[2];
      if (nx * dx + ny * dy + nz * dz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const norm: [number, number, number] = [nx, ny, nz];

      for (let i = 1; i < face.length - 1; i++) {
        const va = points[face[i]!];
        const vb = points[face[i + 1]!];
        if (!va || !vb) continue;
        const pa = this.transformPoint(mat, va[0], va[1], va[2]);
        const pb = this.transformPoint(mat, vb[0], vb[1], vb[2]);
        this.addTriangle(p0, pa, pb, norm, tag);
      }
    }
  }

  /** Tessellates a UV sphere of `radius` with `wSegs` longitude and `hSegs` latitude subdivisions. */
  private emitSphere(radius: number, wSegs: number, hSegs: number, mat: Mat4, tag?: BoundaryPatchTag): void {
    const widthSegments = Math.max(8, wSegs);
    const heightSegments = Math.max(6, hSegs);

    for (let y = 0; y < heightSegments; y++) {
      const v0 = y / heightSegments;
      const v1 = (y + 1) / heightSegments;
      const phi0 = v0 * Math.PI;
      const phi1 = v1 * Math.PI;

      for (let x = 0; x < widthSegments; x++) {
        const u0 = x / widthSegments;
        const u1 = (x + 1) / widthSegments;
        const theta0 = u0 * 2 * Math.PI;
        const theta1 = u1 * 2 * Math.PI;

        const p00 = this.spherePoint(radius, phi0, theta0);
        const p10 = this.spherePoint(radius, phi0, theta1);
        const p01 = this.spherePoint(radius, phi1, theta0);
        const p11 = this.spherePoint(radius, phi1, theta1);

        const tp00 = this.transformPoint(mat, p00[0], p00[1], p00[2]);
        const tp10 = this.transformPoint(mat, p10[0], p10[1], p10[2]);
        const tp01 = this.transformPoint(mat, p01[0], p01[1], p01[2]);
        const tp11 = this.transformPoint(mat, p11[0], p11[1], p11[2]);

        const norm = this.transformNormal(mat, p00[0] / radius, p00[1] / radius, p00[2] / radius);

        if (y !== 0) {
          this.addTriangle(tp00, tp01, tp10, norm, tag);
        }
        if (y !== heightSegments - 1) {
          this.addTriangle(tp10, tp01, tp11, norm, tag);
        }
      }
    }
  }

  /** Evaluates spherical coordinates `(r, phi, theta)` to Cartesian `[x, y, z]`. */
  private spherePoint(r: number, phi: number, theta: number): [number, number, number] {
    const sinPhi = Math.sin(phi);
    return [r * sinPhi * Math.cos(theta), r * Math.cos(phi), r * sinPhi * Math.sin(theta)];
  }

  /** Tessellates a torus of major radius `R` and minor radius `r`. */
  private emitTorus(
    R: number,
    r: number,
    majorSegs: number,
    minorSegs: number,
    mat: Mat4,
    tag?: BoundaryPatchTag,
  ): void {
    const maj = Math.max(12, majorSegs);
    const min = Math.max(6, minorSegs);

    for (let j = 0; j < maj; j++) {
      const u0 = (j / maj) * 2 * Math.PI;
      const u1 = ((j + 1) / maj) * 2 * Math.PI;

      for (let i = 0; i < min; i++) {
        const v0 = (i / min) * 2 * Math.PI;
        const v1 = ((i + 1) / min) * 2 * Math.PI;

        const p00 = this.torusPoint(R, r, u0, v0);
        const p10 = this.torusPoint(R, r, u1, v0);
        const p01 = this.torusPoint(R, r, u0, v1);
        const p11 = this.torusPoint(R, r, u1, v1);

        const tp00 = this.transformPoint(mat, p00[0], p00[1], p00[2]);
        const tp10 = this.transformPoint(mat, p10[0], p10[1], p10[2]);
        const tp01 = this.transformPoint(mat, p01[0], p01[1], p01[2]);
        const tp11 = this.transformPoint(mat, p11[0], p11[1], p11[2]);

        const n = this.transformNormal(mat, Math.cos(u0) * Math.cos(v0), Math.sin(v0), Math.sin(u0) * Math.cos(v0));

        this.addTriangle(tp00, tp10, tp01, n, tag);
        this.addTriangle(tp10, tp11, tp01, n, tag);
      }
    }
  }

  /** Evaluates toroidal angles `(u, v)` with radii `(R, r)` to Cartesian `[x, y, z]`. */
  private torusPoint(R: number, r: number, u: number, v: number): [number, number, number] {
    const x = (R + r * Math.cos(v)) * Math.cos(u);
    const y = r * Math.sin(v);
    const z = (R + r * Math.cos(v)) * Math.sin(u);
    return [x, y, z];
  }

  /** Tessellates a 2D polygon extrusion using ear-clipping for the end caps and quad strips for the walls. */
  private emitExtrusion(
    polygon: readonly [number, number][],
    height: number,
    twist: number | undefined,
    scale: number | undefined,
    mat: Mat4,
    tag?: BoundaryPatchTag,
  ): void {
    const N = polygon.length;
    if (N < 3) return;

    // 1. Determine orientation via signed area
    let signedArea = 0;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      signedArea += polygon[i]![0] * polygon[j]![1] - polygon[j]![0] * polygon[i]![1];
    }
    signedArea *= 0.5;

    // Ensure CCW orientation
    const pts: [number, number][] = [];
    if (signedArea < 0) {
      for (let i = N - 1; i >= 0; i--) pts.push([polygon[i]![0], polygon[i]![1]]);
    } else {
      for (let i = 0; i < N; i++) pts.push([polygon[i]![0], polygon[i]![1]]);
    }

    // 2. Triangulate planar polygon using ear-clipping algorithm
    const triangles: [number, number, number][] = [];
    const indices = Array.from({ length: N }, (_, i) => i);

    const isEar = (prev: number, curr: number, next: number, poly: [number, number][], idxs: number[]): boolean => {
      const a = poly[prev]!;
      const b = poly[curr]!;
      const c = poly[next]!;

      // Must be convex corner (cross product > 0 for CCW)
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 1e-9) return false;

      // Check that no other vertex in remaining polygon lies inside triangle (a, b, c)
      for (const idx of idxs) {
        if (idx === prev || idx === curr || idx === next) continue;
        const p = poly[idx]!;
        const c0 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        const c1 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
        const c2 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
        if (c0 >= -1e-9 && c1 >= -1e-9 && c2 >= -1e-9) {
          return false;
        }
      }
      return true;
    };

    const remaining = indices.slice();
    let maxIters = remaining.length * remaining.length;
    while (remaining.length > 3 && maxIters-- > 0) {
      let earFound = false;
      const len = remaining.length;
      for (let i = 0; i < len; i++) {
        const prev = remaining[(i - 1 + len) % len]!;
        const curr = remaining[i]!;
        const next = remaining[(i + 1) % len]!;

        if (isEar(prev, curr, next, pts, remaining)) {
          triangles.push([prev, curr, next]);
          remaining.splice(i, 1);
          earFound = true;
          break;
        }
      }
      if (!earFound) {
        break;
      }
    }
    if (remaining.length >= 3) {
      for (let i = 1; i < remaining.length - 1; i++) {
        triangles.push([remaining[0]!, remaining[i]!, remaining[i + 1]!]);
      }
    }

    // 3. Compute top cap transformation (twist and scale)
    const rad = twist ? (twist * Math.PI) / 180.0 : 0;
    const cosT = Math.cos(rad);
    const sinT = Math.sin(rad);
    const scl = scale !== undefined ? scale : 1.0;

    const topPts: [number, number, number][] = [];
    const botPts: [number, number, number][] = [];
    for (let i = 0; i < N; i++) {
      const [x, y] = pts[i]!;
      botPts.push([x, y, 0]);
      const tx = (x * cosT - y * sinT) * scl;
      const ty = (x * sinT + y * cosT) * scl;
      topPts.push([tx, ty, height]);
    }

    // 4. Emit bottom cap (normal [0, 0, -1], clockwise when viewed from +Z)
    const botNorm = this.transformNormal(mat, 0, 0, -1);
    for (const [i0, i1, i2] of triangles) {
      const p0 = this.transformPoint(mat, botPts[i0]![0], botPts[i0]![1], botPts[i0]![2]);
      const p1 = this.transformPoint(mat, botPts[i1]![0], botPts[i1]![1], botPts[i1]![2]);
      const p2 = this.transformPoint(mat, botPts[i2]![0], botPts[i2]![1], botPts[i2]![2]);
      this.addTriangle(p0, p2, p1, botNorm, tag);
    }

    // 5. Emit top cap (normal [0, 0, 1], counter-clockwise when viewed from +Z)
    const topNorm = this.transformNormal(mat, 0, 0, 1);
    for (const [i0, i1, i2] of triangles) {
      const p0 = this.transformPoint(mat, topPts[i0]![0], topPts[i0]![1], topPts[i0]![2]);
      const p1 = this.transformPoint(mat, topPts[i1]![0], topPts[i1]![1], topPts[i1]![2]);
      const p2 = this.transformPoint(mat, topPts[i2]![0], topPts[i2]![1], topPts[i2]![2]);
      this.addTriangle(p0, p1, p2, topNorm, tag);
    }

    // 6. Emit side quad walls
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const b0 = this.transformPoint(mat, botPts[i]![0], botPts[i]![1], botPts[i]![2]);
      const b1 = this.transformPoint(mat, botPts[j]![0], botPts[j]![1], botPts[j]![2]);
      const t1 = this.transformPoint(mat, topPts[j]![0], topPts[j]![1], topPts[j]![2]);
      const t0 = this.transformPoint(mat, topPts[i]![0], topPts[i]![1], topPts[i]![2]);

      const dx = pts[j]![0] - pts[i]![0];
      const dy = pts[j]![1] - pts[i]![1];
      const len = Math.hypot(dx, dy) || 1.0;
      const sideNorm = this.transformNormal(mat, dy / len, -dx / len, 0);

      this.addTriangle(b0, b1, t1, sideNorm, tag);
      this.addTriangle(b0, t1, t0, sideNorm, tag);
    }
  }

  /** Packs accumulated vertex, index, normal, and boundary-tag arrays into a {@link ManifoldSurfaceMesh}. */
  public finalize(): ManifoldSurfaceMesh {
    return {
      vertices: new Float32Array(this.vertices),
      indices: new Uint32Array(this.indices),
      normals: new Float32Array(this.normals),
      faceTagIndices: new Uint32Array(this.faceTags),
      tags: this.tags,
      sourceMetadata: this.sourceMetadata,
    };
  }
}
