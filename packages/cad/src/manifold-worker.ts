// SPDX-License-Identifier: AGPL-3.0-or-later

import { IDENTITY, mat4Multiply } from "./transforms.js";
import type { BoundaryPatchTag, Mat4, Solid, Vec3 } from "./types.js";
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
  private vertices: number[] = [];
  private indices: number[] = [];
  private normals: number[] = [];
  private faceTags: number[] = [];
  private tagMap: Map<string, number> = new Map(); // key -> 1-based index
  private tags: BoundaryPatchTag[] = [];

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

  public processSolid(solid: Solid, parentMat: Mat4, activeTag?: BoundaryPatchTag): void {
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
        this.emitCylinder(solid.radius, solid.height, solid.segments, parentMat, activeTag);
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

      case SolidKind.Union:
      case SolidKind.Subtract:
      case SolidKind.Intersect: {
        // Evaluate composite CSG branches
        this.processSolid(solid.left, parentMat, activeTag);
        this.processSolid(solid.right, parentMat, activeTag);
        break;
      }
    }
  }

  private transformPoint(mat: Mat4, x: number, y: number, z: number): [number, number, number] {
    const tx = mat[0] * x + mat[4] * y + mat[8] * z + mat[12];
    const ty = mat[1] * x + mat[5] * y + mat[9] * z + mat[13];
    const tz = mat[2] * x + mat[6] * y + mat[10] * z + mat[14];
    return [tx, ty, tz];
  }

  private transformNormal(mat: Mat4, nx: number, ny: number, nz: number): [number, number, number] {
    const tx = mat[0] * nx + mat[4] * ny + mat[8] * nz;
    const ty = mat[1] * nx + mat[5] * ny + mat[9] * nz;
    const tz = mat[2] * nx + mat[6] * ny + mat[10] * nz;
    const len = Math.hypot(tx, ty, tz) || 1.0;
    return [tx / len, ty / len, tz / len];
  }

  private addTriangle(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    normal: [number, number, number],
    tag?: BoundaryPatchTag,
  ): void {
    const baseIdx = this.vertices.length / 3;
    this.vertices.push(...p0, ...p1, ...p2);
    this.normals.push(...normal, ...normal, ...normal);
    this.indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    this.faceTags.push(this.getTagIndex(tag));
  }

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

  private emitCylinder(radius: number, height: number, segments: number, mat: Mat4, tag?: BoundaryPatchTag): void {
    const hh = height / 2;
    const segs = Math.max(8, segments);

    // Barrel
    for (let i = 0; i < segs; i++) {
      const theta0 = (i / segs) * 2 * Math.PI;
      const theta1 = ((i + 1) / segs) * 2 * Math.PI;

      const c0 = Math.cos(theta0);
      const s0 = Math.sin(theta0);
      const c1 = Math.cos(theta1);
      const s1 = Math.sin(theta1);

      const p0 = this.transformPoint(mat, radius * c0, -hh, radius * s0);
      const p1 = this.transformPoint(mat, radius * c1, -hh, radius * s1);
      const p2 = this.transformPoint(mat, radius * c1, hh, radius * s1);
      const p3 = this.transformPoint(mat, radius * c0, hh, radius * s0);

      const midTheta = (theta0 + theta1) / 2;
      const tNorm = this.transformNormal(mat, Math.cos(midTheta), 0, Math.sin(midTheta));

      this.addTriangle(p0, p1, p2, tNorm, tag);
      this.addTriangle(p0, p2, p3, tNorm, tag);
    }

    // Top cap (+Y)
    const topNorm = this.transformNormal(mat, 0, 1, 0);
    const topCenter = this.transformPoint(mat, 0, hh, 0);
    for (let i = 0; i < segs; i++) {
      const theta0 = (i / segs) * 2 * Math.PI;
      const theta1 = ((i + 1) / segs) * 2 * Math.PI;
      const p0 = this.transformPoint(mat, radius * Math.cos(theta0), hh, radius * Math.sin(theta0));
      const p1 = this.transformPoint(mat, radius * Math.cos(theta1), hh, radius * Math.sin(theta1));
      this.addTriangle(topCenter, p0, p1, topNorm, tag);
    }

    // Bottom cap (-Y)
    const botNorm = this.transformNormal(mat, 0, -1, 0);
    const botCenter = this.transformPoint(mat, 0, -hh, 0);
    for (let i = 0; i < segs; i++) {
      const theta0 = (i / segs) * 2 * Math.PI;
      const theta1 = ((i + 1) / segs) * 2 * Math.PI;
      const p0 = this.transformPoint(mat, radius * Math.cos(theta0), -hh, radius * Math.sin(theta0));
      const p1 = this.transformPoint(mat, radius * Math.cos(theta1), -hh, radius * Math.sin(theta1));
      this.addTriangle(botCenter, p1, p0, botNorm, tag);
    }
  }

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

  private spherePoint(r: number, phi: number, theta: number): [number, number, number] {
    const sinPhi = Math.sin(phi);
    return [r * sinPhi * Math.cos(theta), r * Math.cos(phi), r * sinPhi * Math.sin(theta)];
  }

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

  private torusPoint(R: number, r: number, u: number, v: number): [number, number, number] {
    const x = (R + r * Math.cos(v)) * Math.cos(u);
    const y = r * Math.sin(v);
    const z = (R + r * Math.cos(v)) * Math.sin(u);
    return [x, y, z];
  }

  public finalize(): ManifoldSurfaceMesh {
    return {
      vertices: new Float32Array(this.vertices),
      indices: new Uint32Array(this.indices),
      normals: new Float32Array(this.normals),
      faceTagIndices: new Uint32Array(this.faceTags),
      tags: this.tags,
    };
  }
}
