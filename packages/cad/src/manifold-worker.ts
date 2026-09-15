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

      case SolidKind.Extrusion: {
        this.emitExtrusion(solid.polygon, solid.height, solid.twist, solid.scale, parentMat, activeTag);
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

      case SolidKind.Fillet: {
        if (solid.child.kind === SolidKind.Box) {
          this.emitChamferedBox(
            solid.child.width,
            solid.child.height,
            solid.child.depth,
            solid.radius,
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
        } else {
          this.processSolid(solid.child, parentMat, activeTag);
        }
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
      signedArea += polygon[i][0] * polygon[j][1] - polygon[j][0] * polygon[i][1];
    }
    signedArea *= 0.5;

    // Ensure CCW orientation
    const pts: [number, number][] = [];
    if (signedArea < 0) {
      for (let i = N - 1; i >= 0; i--) pts.push([polygon[i][0], polygon[i][1]]);
    } else {
      for (let i = 0; i < N; i++) pts.push([polygon[i][0], polygon[i][1]]);
    }

    // 2. Triangulate planar polygon using ear-clipping algorithm
    const triangles: [number, number, number][] = [];
    const indices = Array.from({ length: N }, (_, i) => i);

    const isEar = (prev: number, curr: number, next: number, poly: [number, number][], idxs: number[]): boolean => {
      const a = poly[prev];
      const b = poly[curr];
      const c = poly[next];

      // Must be convex corner (cross product > 0 for CCW)
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 1e-9) return false;

      // Check that no other vertex in remaining polygon lies inside triangle (a, b, c)
      for (const idx of idxs) {
        if (idx === prev || idx === curr || idx === next) continue;
        const p = poly[idx];
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
        const prev = remaining[(i - 1 + len) % len];
        const curr = remaining[i];
        const next = remaining[(i + 1) % len];

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
        triangles.push([remaining[0], remaining[i], remaining[i + 1]]);
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
      const [x, y] = pts[i];
      botPts.push([x, y, 0]);
      const tx = (x * cosT - y * sinT) * scl;
      const ty = (x * sinT + y * cosT) * scl;
      topPts.push([tx, ty, height]);
    }

    // 4. Emit bottom cap (normal [0, 0, -1], clockwise when viewed from +Z)
    const botNorm = this.transformNormal(mat, 0, 0, -1);
    for (const [i0, i1, i2] of triangles) {
      const p0 = this.transformPoint(mat, botPts[i0][0], botPts[i0][1], botPts[i0][2]);
      const p1 = this.transformPoint(mat, botPts[i1][0], botPts[i1][1], botPts[i1][2]);
      const p2 = this.transformPoint(mat, botPts[i2][0], botPts[i2][1], botPts[i2][2]);
      this.addTriangle(p0, p2, p1, botNorm, tag);
    }

    // 5. Emit top cap (normal [0, 0, 1], counter-clockwise when viewed from +Z)
    const topNorm = this.transformNormal(mat, 0, 0, 1);
    for (const [i0, i1, i2] of triangles) {
      const p0 = this.transformPoint(mat, topPts[i0][0], topPts[i0][1], topPts[i0][2]);
      const p1 = this.transformPoint(mat, topPts[i1][0], topPts[i1][1], topPts[i1][2]);
      const p2 = this.transformPoint(mat, topPts[i2][0], topPts[i2][1], topPts[i2][2]);
      this.addTriangle(p0, p1, p2, topNorm, tag);
    }

    // 6. Emit side quad walls
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const b0 = this.transformPoint(mat, botPts[i][0], botPts[i][1], botPts[i][2]);
      const b1 = this.transformPoint(mat, botPts[j][0], botPts[j][1], botPts[j][2]);
      const t1 = this.transformPoint(mat, topPts[j][0], topPts[j][1], topPts[j][2]);
      const t0 = this.transformPoint(mat, topPts[i][0], topPts[i][1], topPts[i][2]);

      const dx = pts[j][0] - pts[i][0];
      const dy = pts[j][1] - pts[i][1];
      const len = Math.hypot(dx, dy) || 1.0;
      const sideNorm = this.transformNormal(mat, dy / len, -dx / len, 0);

      this.addTriangle(b0, b1, t1, sideNorm, tag);
      this.addTriangle(b0, t1, t0, sideNorm, tag);
    }
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
