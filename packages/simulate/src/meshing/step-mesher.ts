// SPDX-License-Identifier: AGPL-3.0-or-later

import { Tet4Mesher } from "../fea/tet4-mesher.js";
import type { MeshQualityMetrics, Tet4Mesh } from "../fea/tet4-types.js";
import { wasmEarClip2D } from "../wasm/simulate-wasm.js";
import { BoundaryLayerExtruder, type BoundaryLayerOptions, type ExtrusionResult } from "./boundary-layer-extruder.js";
import { MeshQualityAnalyzer } from "./mesh-quality-analyzer.js";
import { PatchClassifier, type ClassifiedPatches, type PatchClassificationRules } from "./patch-classifier.js";

export interface NamedFacePatch {
  /** Semantic patch name (e.g. from STEP ADVANCED_FACE or @modelscript/cad TaggedPatch). */
  name: string;
  /** Optional 0-based triangle indices into the input surface mesh's `indices` array. */
  triangleIndices?: number[] | undefined;
  /** Optional standalone surface patch vertices [x0, y0, z0, ...]. */
  vertices?: Float32Array | number[] | undefined;
  /** Optional standalone surface patch triangle indices [i0, i1, i2, ...]. */
  indices?: Uint32Array | number[] | undefined;
}

export interface StepMesherOptions {
  /** Target resolution along the longest bounding box dimension. Default: 20. */
  resolution?: number | undefined;
  /** Element formulation order: 'linear' (Tet4, 4-node) or 'quadratic' (Tet10, 10-node). Default: 'linear'. */
  order?: "linear" | "quadratic" | undefined;
  /** Boundary layer inflation configuration (primarily for viscous CFD walls). */
  inflation?:
    | (BoundaryLayerOptions & {
        /** Target boundary patch name to extrude from. Default: 'WALL_BODY'. */
        targetPatch?: string | undefined;
      })
    | undefined;
  /** Patch classification rules for boundary conditions. */
  patchRules?: PatchClassificationRules | undefined;
  /** Named face patches (from STEP ADVANCED_FACE or @modelscript/cad TaggedPatch) preserved on boundary faces. */
  namedFacePatches?: NamedFacePatch[] | undefined;
  /** Optional per-triangle face tag names (parallel to input surface triangles) preserved on boundary faces. */
  faceTagNames?: (string | undefined)[] | undefined;
}

export interface MeshingPipelineResult {
  mesh: Tet4Mesh;
  patches: ClassifiedPatches;
  quality: MeshQualityMetrics;
  inflationResult?: ExtrusionResult | undefined;
}

export interface InpExportOptions {
  heading?: string | undefined;
  materialName?: string | undefined;
  youngsModulus?: number | undefined; // E in Pa (default: 210e9)
  poissonsRatio?: number | undefined; // nu (default: 0.3)
  density?: number | undefined; // rho in kg/m^3 (default: 7850)
  fixedPatch?: string | undefined; // default: 'FIXED_SUPPORT'
  loadPatch?: string | undefined; // default: 'LOAD_SURFACE'
  loadForceZ?: number | undefined; // default: -1000.0 N
}

/**
 * Computes squared distance from point P to triangle (A, B, C) in 3D.
 */
function pointToTriangleDistSq(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number {
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
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;

  const bpx = px - bx,
    bpy = py - by,
    bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
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
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const qx = ax + w * acx - px;
    const qy = ay + w * acy - py;
    const qz = az + w * acz - pz;
    return qx * qx + qy * qy + qz * qz;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
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

/**
 * Automated CAD-to-Mesh Pipeline Engine.
 * Converts 3D surface geometries into fully discretized, simulation-ready FEA & CFD meshes.
 */
export class StepMesher {
  /**
   * Meshes a triangular surface mesh into volumetric tetrahedra with quality metrics and patch tagging.
   */
  public static meshSurfaceToTetrahedra(
    vertices: Float32Array | number[],
    indices: Uint32Array | number[],
    options: StepMesherOptions = {},
  ): MeshingPipelineResult {
    const resolution = options.resolution ?? 20;
    const order = options.order ?? "linear";

    // 1. Generate base volumetric tetrahedral mesh via SDF voxelization
    const mesh = Tet4Mesher.createFromSurfaceMesh({
      vertices,
      indices,
      resolution,
      order,
    });

    // 2. Extract exterior boundary faces of the volumetric mesh and classify patches in mesh node space
    const npe = mesh.nodesPerElement ?? 4;
    const faceMap = new Map<string, { count: number; tri: [number, number, number] }>();
    const addFace = (a: number, b: number, c: number) => {
      let s0 = a,
        s1 = b,
        s2 = c;
      if (s0 > s1) {
        const t = s0;
        s0 = s1;
        s1 = t;
      }
      if (s1 > s2) {
        const t = s1;
        s1 = s2;
        s2 = t;
      }
      if (s0 > s1) {
        const t = s0;
        s0 = s1;
        s1 = t;
      }
      const key = `${s0}_${s1}_${s2}`;
      const existing = faceMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        faceMap.set(key, { count: 1, tri: [a, b, c] });
      }
    };

    for (let e = 0; e < mesh.numElements; e++) {
      const base = e * npe;
      const n0 = mesh.elements[base + 0]!;
      const n1 = mesh.elements[base + 1]!;
      const n2 = mesh.elements[base + 2]!;
      const n3 = mesh.elements[base + 3]!;
      addFace(n0, n2, n1);
      addFace(n0, n1, n3);
      addFace(n1, n2, n3);
      addFace(n0, n3, n2);
    }

    const exteriorIndicesList: number[] = [];
    for (const entry of faceMap.values()) {
      if (entry.count === 1) {
        exteriorIndicesList.push(entry.tri[0], entry.tri[1], entry.tri[2]);
      }
    }
    const exteriorIndices = new Uint32Array(exteriorIndicesList);

    const patches = PatchClassifier.classify(mesh.nodeCoords, exteriorIndices, options.patchRules);

    // 2b. Preserve explicit named face patches (STEP ADVANCED_FACE / @modelscript/cad TaggedPatch)
    //     so they take precedence over AABB heuristics in PatchClassifier.
    const refTris: Array<{
      name: string;
      ax: number;
      ay: number;
      az: number;
      bx: number;
      by: number;
      bz: number;
      cx: number;
      cy: number;
      cz: number;
    }> = [];

    const pushRefTri = (
      name: string,
      srcVerts: Float32Array | number[],
      srcInds: Uint32Array | number[],
      triIdx: number,
    ) => {
      const base = triIdx * 3;
      if (base + 2 >= srcInds.length) return;
      const i0 = srcInds[base]! * 3;
      const i1 = srcInds[base + 1]! * 3;
      const i2 = srcInds[base + 2]! * 3;
      if (i0 + 2 >= srcVerts.length || i1 + 2 >= srcVerts.length || i2 + 2 >= srcVerts.length) return;
      refTris.push({
        name,
        ax: srcVerts[i0]!,
        ay: srcVerts[i0 + 1]!,
        az: srcVerts[i0 + 2]!,
        bx: srcVerts[i1]!,
        by: srcVerts[i1 + 1]!,
        bz: srcVerts[i1 + 2]!,
        cx: srcVerts[i2]!,
        cy: srcVerts[i2 + 1]!,
        cz: srcVerts[i2 + 2]!,
      });
    };

    if (options.namedFacePatches && options.namedFacePatches.length > 0) {
      for (const patch of options.namedFacePatches) {
        const cleanName = patch.name.trim();
        if (!cleanName) continue;
        if (patch.vertices && patch.indices) {
          const numPatchTris = Math.floor(patch.indices.length / 3);
          for (let t = 0; t < numPatchTris; t++) {
            pushRefTri(cleanName, patch.vertices, patch.indices, t);
          }
        } else if (patch.triangleIndices && patch.triangleIndices.length > 0) {
          for (const triIdx of patch.triangleIndices) {
            pushRefTri(cleanName, vertices, indices, triIdx);
          }
        }
      }
    }

    if (options.faceTagNames && options.faceTagNames.length > 0) {
      for (let t = 0; t < options.faceTagNames.length; t++) {
        const tagName = options.faceTagNames[t]?.trim();
        if (tagName) {
          pushRefTri(tagName, vertices, indices, t);
        }
      }
    }

    if (refTris.length > 0) {
      const dims = patches.boundingBox.dimensions;
      const maxDim = Math.max(dims[0], dims[1], dims[2], 1e-6);
      const voxelSize = maxDim / Math.max(1, resolution);
      const maxDistSq = voxelSize * 1.75 * (voxelSize * 1.75);

      const rebuiltNodeSets = new Map<string, Set<number>>();
      const rebuiltSurfaceTris = new Map<string, [number, number, number][]>();

      const addRebuilt = (tag: string, n0: number, n1: number, n2: number) => {
        let ns = rebuiltNodeSets.get(tag);
        if (!ns) {
          ns = new Set<number>();
          rebuiltNodeSets.set(tag, ns);
        }
        ns.add(n0);
        ns.add(n1);
        ns.add(n2);
        let tl = rebuiltSurfaceTris.get(tag);
        if (!tl) {
          tl = [];
          rebuiltSurfaceTris.set(tag, tl);
        }
        tl.push([n0, n1, n2]);
      };

      for (const [fallbackTag, tris] of patches.surfaceTriangles.entries()) {
        for (const [n0, n1, n2] of tris) {
          const mx = (mesh.nodeCoords[n0 * 3]! + mesh.nodeCoords[n1 * 3]! + mesh.nodeCoords[n2 * 3]!) / 3;
          const my = (mesh.nodeCoords[n0 * 3 + 1]! + mesh.nodeCoords[n1 * 3 + 1]! + mesh.nodeCoords[n2 * 3 + 1]!) / 3;
          const mz = (mesh.nodeCoords[n0 * 3 + 2]! + mesh.nodeCoords[n1 * 3 + 2]! + mesh.nodeCoords[n2 * 3 + 2]!) / 3;

          let bestDistSq = maxDistSq;
          let matchedTag: string | undefined;
          for (let r = 0; r < refTris.length; r++) {
            const rt = refTris[r]!;
            const dSq = pointToTriangleDistSq(
              mx,
              my,
              mz,
              rt.ax,
              rt.ay,
              rt.az,
              rt.bx,
              rt.by,
              rt.bz,
              rt.cx,
              rt.cy,
              rt.cz,
            );
            if (dSq <= bestDistSq) {
              bestDistSq = dSq;
              matchedTag = rt.name;
            }
          }

          addRebuilt(matchedTag ?? fallbackTag, n0, n1, n2);
        }
      }

      patches.nodeSets.clear();
      for (const [name, set] of rebuiltNodeSets.entries()) {
        patches.nodeSets.set(
          name,
          Array.from(set).sort((a, b) => a - b),
        );
      }
      patches.surfaceTriangles.clear();
      for (const [name, tris] of rebuiltSurfaceTris.entries()) {
        patches.surfaceTriangles.set(name, tris);
      }
    }

    // Populate boundary nodes on the resulting Tet4Mesh
    for (const [name, nodeIdxs] of patches.nodeSets) {
      mesh.boundaryNodes.set(name, nodeIdxs);
    }
    if (patches.surfaceTriangles) {
      mesh.boundaryFaces = patches.surfaceTriangles;
    }

    // 3. Optional Boundary Layer Inflation
    let inflationResult: ExtrusionResult | undefined;
    if (options.inflation) {
      const targetPatch = options.inflation.targetPatch ?? "WALL_BODY";
      const surfaceTris = patches.surfaceTriangles.get(targetPatch);

      if (surfaceTris && surfaceTris.length > 0) {
        // Collect unique node indices from the surface triangles
        const nodeMap = new Map<number, number>();
        const subCoords: number[] = [];
        const subTris: number[] = [];

        for (const [a, b, c] of surfaceTris) {
          for (const origIdx of [a, b, c]) {
            if (!nodeMap.has(origIdx)) {
              const newIdx = nodeMap.size;
              nodeMap.set(origIdx, newIdx);
              subCoords.push(
                mesh.nodeCoords[origIdx * 3 + 0]!,
                mesh.nodeCoords[origIdx * 3 + 1]!,
                mesh.nodeCoords[origIdx * 3 + 2]!,
              );
            }
          }
          subTris.push(nodeMap.get(a)!, nodeMap.get(b)!, nodeMap.get(c)!);
        }

        inflationResult = BoundaryLayerExtruder.extrude(
          new Float32Array(subCoords),
          new Uint32Array(subTris),
          options.inflation,
        );
      }
    }

    // 4. Mesh Quality Assessment
    const quality = MeshQualityAnalyzer.analyze(mesh);

    return {
      mesh,
      patches,
      quality,
      inflationResult,
    };
  }

  /**
   * Meshes a STEP buffer or procedural CAD geometry into volumetric tetrahedra.
   */
  public static meshStepToTetrahedra(
    stepInput:
      | Uint8Array
      | string
      | {
          vertices: Float32Array | number[];
          indices: Uint32Array | number[];
          namedFacePatches?: NamedFacePatch[] | undefined;
        },
    options: StepMesherOptions = {},
  ): MeshingPipelineResult {
    // If surface arrays are passed directly
    if (typeof stepInput === "object" && "vertices" in stepInput && "indices" in stepInput) {
      const mergedOptions: StepMesherOptions =
        stepInput.namedFacePatches && !options.namedFacePatches
          ? { ...options, namedFacePatches: stepInput.namedFacePatches }
          : options;
      return StepMesher.meshSurfaceToTetrahedra(stepInput.vertices, stepInput.indices, mergedOptions);
    }

    // Otherwise extract or synthesize surface triangulation from STEP data
    const surface = StepMesher.extractSurfaceFromStep(stepInput);
    const mergedOptions: StepMesherOptions =
      surface.namedFacePatches && !options.namedFacePatches
        ? { ...options, namedFacePatches: surface.namedFacePatches }
        : options;
    return StepMesher.meshSurfaceToTetrahedra(surface.vertices, surface.indices, mergedOptions);
  }

  /**
   * Extracts or approximates surface triangles from raw STEP content or fallbacks.
   */
  public static extractSurfaceFromStep(stepInput: Uint8Array | string): {
    vertices: Float32Array;
    indices: Uint32Array;
    namedFacePatches?: NamedFacePatch[] | undefined;
  } {
    const text = typeof stepInput === "string" ? stepInput : new TextDecoder().decode(stepInput);

    // 1. Parse numbered STEP entities for B-Rep face reconstruction
    const cartesianPoints = new Map<number, [number, number, number]>();
    const directions = new Map<number, [number, number, number]>();
    const axisPlacements = new Map<number, { loc: number; axis?: number | undefined; refDir?: number | undefined }>();
    const circles = new Map<number, { placement: number; radius: number }>();
    const vertexToPoint = new Map<number, number>();
    const edgeCurves = new Map<number, { vStart: number; vEnd: number; curveId?: number | undefined }>();
    const orientedEdges = new Map<
      number,
      { edge: number; sense: boolean; vStart?: number | undefined; vEnd?: number | undefined }
    >();
    const edgeLoops = new Map<number, number[]>();
    const faceBounds = new Map<number, number>();
    const faces: number[][] = [];
    let syntheticPtId = 1000000;

    const idPointRegex =
      /#(\d+)\s*=\s*CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\)\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = idPointRegex.exec(text)) !== null) {
      const id = parseInt(m[1]!, 10);
      const x = parseFloat(m[2]!);
      const y = parseFloat(m[3]!);
      const z = parseFloat(m[4]!);
      if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) {
        cartesianPoints.set(id, [x, y, z]);
        if (id >= syntheticPtId) syntheticPtId = id + 1;
      }
    }

    const dirRegex =
      /#(\d+)\s*=\s*DIRECTION\s*\(\s*'[^']*'\s*,\s*\(\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\)\s*\)/g;
    while ((m = dirRegex.exec(text)) !== null) {
      const id = parseInt(m[1]!, 10);
      const dx = parseFloat(m[2]!);
      const dy = parseFloat(m[3]!);
      const dz = parseFloat(m[4]!);
      if (!Number.isNaN(dx) && !Number.isNaN(dy) && !Number.isNaN(dz)) {
        directions.set(id, [dx, dy, dz]);
      }
    }

    const apRegex =
      /#(\d+)\s*=\s*AXIS2_PLACEMENT_3D\s*\(\s*'[^']*'\s*,\s*#(\d+)(?:\s*,\s*(?:#(\d+)|\$))?(?:\s*,\s*(?:#(\d+)|\$))?\s*\)/g;
    while ((m = apRegex.exec(text)) !== null) {
      axisPlacements.set(parseInt(m[1]!, 10), {
        loc: parseInt(m[2]!, 10),
        axis: m[3] ? parseInt(m[3], 10) : undefined,
        refDir: m[4] ? parseInt(m[4], 10) : undefined,
      });
    }

    const circleRegex =
      /#(\d+)\s*=\s*CIRCLE\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*,\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\)/g;
    while ((m = circleRegex.exec(text)) !== null) {
      circles.set(parseInt(m[1]!, 10), {
        placement: parseInt(m[2]!, 10),
        radius: parseFloat(m[3]!),
      });
    }

    const vpRegex = /#(\d+)\s*=\s*VERTEX_POINT\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*\)/g;
    while ((m = vpRegex.exec(text)) !== null) {
      vertexToPoint.set(parseInt(m[1]!, 10), parseInt(m[2]!, 10));
    }

    const ecRegex = /#(\d+)\s*=\s*EDGE_CURVE\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*,\s*#(\d+)(?:\s*,\s*#(\d+))?/g;
    while ((m = ecRegex.exec(text)) !== null) {
      edgeCurves.set(parseInt(m[1]!, 10), {
        vStart: parseInt(m[2]!, 10),
        vEnd: parseInt(m[3]!, 10),
        curveId: m[4] ? parseInt(m[4], 10) : undefined,
      });
    }

    const oeRegex = /#(\d+)\s*=\s*ORIENTED_EDGE\s*\(([^)]+)\)/gi;
    while ((m = oeRegex.exec(text)) !== null) {
      const id = parseInt(m[1]!, 10);
      const args = m[2]!.split(",").map((s) => s.trim());
      if (args.length >= 2) {
        const senseStr = args[args.length - 1]!;
        const sense = senseStr.toUpperCase().includes("T");
        const edgeIndex = args.length - 2;
        const edgeMatch = args[edgeIndex]?.match(/#(\d+)/);
        if (edgeMatch) {
          const edge = parseInt(edgeMatch[1]!, 10);
          let vStart: number | undefined;
          let vEnd: number | undefined;
          if (edgeIndex >= 2) {
            const vsMatch = args[edgeIndex - 2]?.match(/#(\d+)/);
            const veMatch = args[edgeIndex - 1]?.match(/#(\d+)/);
            if (vsMatch) vStart = parseInt(vsMatch[1]!, 10);
            if (veMatch) vEnd = parseInt(veMatch[1]!, 10);
          }
          orientedEdges.set(id, { edge, sense, vStart, vEnd });
        }
      }
    }

    const bSplineCurves = new Map<number, number[]>();
    const bscRegex = /#(\d+)\s*=\s*B_SPLINE_CURVE_WITH_KNOTS\s*\(\s*'[^'\r\n]*'\s*,\s*\d+\s*,\s*\(([^()]*)\)/gi;
    while ((m = bscRegex.exec(text)) !== null) {
      const curveId = parseInt(m[1]!, 10);
      const ctrlPts = Array.from(m[2]!.matchAll(/#(\d+)/g), (r) => parseInt(r[1]!, 10));
      if (ctrlPts.length >= 2) bSplineCurves.set(curveId, ctrlPts);
    }

    const surfaceTypes = new Map<number, { kind: string; placement?: number | undefined }>();
    const surfRegex =
      /#(\d+)\s*=\s*(PLANE|CYLINDRICAL_SURFACE|CONICAL_SURFACE|SPHERICAL_SURFACE|TOROIDAL_SURFACE|B_SPLINE_SURFACE_WITH_KNOTS)\s*\(\s*'[^'\r\n]*'\s*(?:,\s*#(\d+))?/gi;
    while ((m = surfRegex.exec(text)) !== null) {
      surfaceTypes.set(parseInt(m[1]!, 10), {
        kind: m[2]!.toUpperCase(),
        placement: m[3] ? parseInt(m[3], 10) : undefined,
      });
    }

    const elRegex = /#(\d+)\s*=\s*(?:EDGE_LOOP|POLY_LOOP)\s*\(\s*'[^'\r\n]*'\s*,\s*\(([^()]*)\)\s*\)/gi;
    while ((m = elRegex.exec(text)) !== null) {
      const loopId = parseInt(m[1]!, 10);
      const refs = Array.from(m[2]!.matchAll(/#(\d+)/g), (r) => parseInt(r[1]!, 10));
      if (refs.length > 0) edgeLoops.set(loopId, refs);
    }

    const faceBoundOuter = new Map<number, boolean>();
    const fbRegex = /#(\d+)\s*=\s*(FACE_OUTER_BOUND|FACE_BOUND)\s*\(\s*'[^'\r\n]*'\s*,\s*#(\d+)/gi;
    while ((m = fbRegex.exec(text)) !== null) {
      const bId = parseInt(m[1]!, 10);
      faceBounds.set(bId, parseInt(m[3]!, 10));
      faceBoundOuter.set(bId, m[2]!.toUpperCase() === "FACE_OUTER_BOUND");
    }

    const ptIdToVertexIdx = new Map<number, number>();
    const vertCoords: number[] = [];
    const triIndices: number[] = [];

    const getOrAddVertex = (ptId: number): number => {
      let idx = ptIdToVertexIdx.get(ptId);
      if (idx === undefined) {
        idx = ptIdToVertexIdx.size;
        ptIdToVertexIdx.set(ptId, idx);
        const pt = cartesianPoints.get(ptId)!;
        vertCoords.push(pt[0], pt[1], pt[2]);
      }
      return idx;
    };

    const sampleLoopPoints = (loopItems: number[]): { points: number[]; arcChains: number[][] } => {
      const polyPointIds: number[] = [];
      const arcChains: number[][] = [];
      for (const itemId of loopItems) {
        if (cartesianPoints.has(itemId)) {
          polyPointIds.push(itemId);
          continue;
        }
        const directVpPt = vertexToPoint.get(itemId);
        if (directVpPt !== undefined && cartesianPoints.has(directVpPt)) {
          polyPointIds.push(directVpPt);
          continue;
        }
        const oe = orientedEdges.get(itemId);
        if (!oe) continue;
        const ec = edgeCurves.get(oe.edge);
        if (!ec) continue;

        const rawStart = oe.sense ? (ec.vStart ?? oe.vStart) : (ec.vEnd ?? oe.vEnd);
        const rawEnd = oe.sense ? (ec.vEnd ?? oe.vEnd) : (ec.vStart ?? oe.vStart);
        const ptId =
          rawStart !== undefined
            ? (vertexToPoint.get(rawStart) ?? (cartesianPoints.has(rawStart) ? rawStart : undefined))
            : undefined;
        const endPtId =
          rawEnd !== undefined
            ? (vertexToPoint.get(rawEnd) ?? (cartesianPoints.has(rawEnd) ? rawEnd : undefined))
            : undefined;
        if (ptId !== undefined && cartesianPoints.has(ptId)) {
          if (polyPointIds.length === 0 || polyPointIds[polyPointIds.length - 1] !== ptId) {
            polyPointIds.push(ptId);
          }
        }

        const circle = ec.curveId !== undefined ? circles.get(ec.curveId) : undefined;
        if (circle) {
          const ap = axisPlacements.get(circle.placement);
          const center = ap ? cartesianPoints.get(ap.loc) : undefined;
          if (center && circle.radius > 0) {
            const axisDir = (ap?.axis ? directions.get(ap.axis) : undefined) ?? [0, 0, 1];
            const nLen = Math.hypot(axisDir[0], axisDir[1], axisDir[2]) || 1;
            const nx = axisDir[0] / nLen,
              ny = axisDir[1] / nLen,
              nz = axisDir[2] / nLen;
            let ux = 1,
              uy = 0,
              uz = 0;
            const startPt = ptId !== undefined ? cartesianPoints.get(ptId) : undefined;
            if (startPt) {
              const rx = startPt[0] - center[0],
                ry = startPt[1] - center[1],
                rz = startPt[2] - center[2];
              const rLen = Math.hypot(rx, ry, rz);
              if (rLen > 1e-9) {
                ux = rx / rLen;
                uy = ry / rLen;
                uz = rz / rLen;
              }
            } else if (ap?.refDir && directions.has(ap.refDir)) {
              const rd = directions.get(ap.refDir)!;
              const rLen = Math.hypot(rd[0], rd[1], rd[2]) || 1;
              ux = rd[0] / rLen;
              uy = rd[1] / rLen;
              uz = rd[2] / rLen;
            } else if (Math.abs(nx) > 0.9) {
              ux = 0;
              uy = 1;
              uz = 0;
            }
            const vx = ny * uz - nz * uy;
            const vy = nz * ux - nx * uz;
            const vz = nx * uy - ny * ux;

            let sweep = 2.0 * Math.PI;
            const endPt = endPtId !== undefined ? cartesianPoints.get(endPtId) : undefined;
            if (startPt && endPt && ptId !== endPtId) {
              const ex = endPt[0] - center[0],
                ey = endPt[1] - center[1],
                ez = endPt[2] - center[2];
              const cosA = (ex * ux + ey * uy + ez * uz) / circle.radius;
              const sinA = (ex * vx + ey * vy + ez * vz) / circle.radius;
              let ang = Math.atan2(oe.sense ? sinA : -sinA, cosA);
              if (ang <= 1e-6) ang += 2.0 * Math.PI;
              sweep = ang;
            }
            const numSegs = Math.max(8, Math.round((sweep / (2.0 * Math.PI)) * 24));
            const sign = oe.sense ? 1.0 : -1.0;
            const chain: number[] = [];
            if (ptId !== undefined && cartesianPoints.has(ptId)) chain.push(ptId);
            for (let s = 1; s < numSegs; s++) {
              const theta = (sign * (sweep * s)) / numSegs;
              const c = Math.cos(theta),
                sn = Math.sin(theta);
              const px = center[0] + circle.radius * (c * ux + sn * vx);
              const py = center[1] + circle.radius * (c * uy + sn * vy);
              const pz = center[2] + circle.radius * (c * uz + sn * vz);
              const sid = syntheticPtId++;
              cartesianPoints.set(sid, [px, py, pz]);
              polyPointIds.push(sid);
              chain.push(sid);
            }
            if (endPtId !== undefined && cartesianPoints.has(endPtId)) {
              chain.push(endPtId);
            }
            if (chain.length >= 3) arcChains.push(chain);
          }
        } else if (ec.curveId !== undefined && bSplineCurves.has(ec.curveId)) {
          const ctrlPts = bSplineCurves.get(ec.curveId)!;
          const ordered = oe.sense ? ctrlPts : [...ctrlPts].reverse();
          const chain: number[] = [];
          if (ptId !== undefined && cartesianPoints.has(ptId)) chain.push(ptId);
          for (let i = 1; i < ordered.length - 1; i++) {
            const cid = ordered[i]!;
            if (cartesianPoints.has(cid)) {
              polyPointIds.push(cid);
              chain.push(cid);
            }
          }
          if (endPtId !== undefined && cartesianPoints.has(endPtId)) chain.push(endPtId);
          if (chain.length >= 3) arcChains.push(chain);
        }
      }
      // Remove duplicate closing point if present
      while (polyPointIds.length >= 2 && polyPointIds[0] === polyPointIds[polyPointIds.length - 1]) {
        polyPointIds.pop();
      }
      return { points: polyPointIds, arcChains };
    };

    const triangulatePlanarWithHoles = (outerLoop: number[], holeLoops: number[][]): void => {
      if (outerLoop.length < 3) return;
      // Estimate polygon normal using Newell's method on outerLoop
      let nx = 0,
        ny = 0,
        nz = 0;
      for (let i = 0; i < outerLoop.length; i++) {
        const p0 = cartesianPoints.get(outerLoop[i]!)!;
        const p1 = cartesianPoints.get(outerLoop[(i + 1) % outerLoop.length]!)!;
        nx += (p0[1] - p1[1]) * (p0[2] + p1[2]);
        ny += (p0[2] - p1[2]) * (p0[0] + p1[0]);
        nz += (p0[0] - p1[0]) * (p0[1] + p1[1]);
      }
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;

      // Build 2D basis (u, v) in plane
      let ux = 1,
        uy = 0,
        uz = 0;
      if (Math.abs(nx) > 0.9) {
        ux = 0;
        uy = 1;
        uz = 0;
      }
      const dot = ux * nx + uy * ny + uz * nz;
      ux -= dot * nx;
      uy -= dot * ny;
      uz -= dot * nz;
      const uLen = Math.hypot(ux, uy, uz) || 1;
      ux /= uLen;
      uy /= uLen;
      uz /= uLen;
      const vx = ny * uz - nz * uy;
      const vy = nz * ux - nx * uz;
      const vz = nx * uy - ny * ux;

      const project2D = (ptId: number): [number, number] => {
        const p = cartesianPoints.get(ptId)!;
        return [p[0] * ux + p[1] * uy + p[2] * uz, p[0] * vx + p[1] * vy + p[2] * vz];
      };

      const signedArea2D = (loop: number[]): number => {
        let a = 0;
        for (let i = 0; i < loop.length; i++) {
          const [x0, y0] = project2D(loop[i]!);
          const [x1, y1] = project2D(loop[(i + 1) % loop.length]!);
          a += x0 * y1 - x1 * y0;
        }
        return 0.5 * a;
      };

      let poly = [...outerLoop];
      if (signedArea2D(poly) < 0) poly.reverse();

      // Bridge holes into outer polygon from rightmost hole vertex
      const sortedHoles = holeLoops
        .filter((h) => h.length >= 3)
        .map((h) => {
          const copy = [...h];
          if (signedArea2D(copy) > 0) copy.reverse(); // holes must be CW in 2D
          let maxU = -Infinity;
          let maxIdx = 0;
          for (let i = 0; i < copy.length; i++) {
            const [u] = project2D(copy[i]!);
            if (u > maxU) {
              maxU = u;
              maxIdx = i;
            }
          }
          return { loop: copy, maxU, maxIdx };
        })
        .sort((a, b) => b.maxU - a.maxU);

      for (const hole of sortedHoles) {
        const hPtId = hole.loop[hole.maxIdx]!;
        const [hu, hv] = project2D(hPtId);
        let bestOuterIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < poly.length; i++) {
          const [ou, ov] = project2D(poly[i]!);
          const d = Math.hypot(ou - hu, ov - hv);
          if (d < bestDist) {
            bestDist = d;
            bestOuterIdx = i;
          }
        }
        const rotatedHole: number[] = [];
        for (let i = 0; i < hole.loop.length; i++) {
          rotatedHole.push(hole.loop[(hole.maxIdx + i) % hole.loop.length]!);
        }
        poly = [
          ...poly.slice(0, bestOuterIdx + 1),
          ...rotatedHole,
          rotatedHole[0]!,
          poly[bestOuterIdx]!,
          ...poly.slice(bestOuterIdx + 1),
        ];
      }

      // Ear-clipping on merged 2D polygon
      const coords = poly.map((ptId) => ({ ptId, uv: project2D(ptId) }));

      if (coords.length >= 3) {
        const uvFlat = new Float64Array(coords.length * 2);
        const ptIdArr = new Int32Array(coords.length);
        for (let i = 0; i < coords.length; i++) {
          uvFlat[i * 2] = coords[i]!.uv[0];
          uvFlat[i * 2 + 1] = coords[i]!.uv[1];
          ptIdArr[i] = coords[i]!.ptId;
        }
        const wasmTris = wasmEarClip2D(uvFlat, ptIdArr);
        if (wasmTris && wasmTris.length > 0) {
          for (let t = 0; t < wasmTris.length; t += 3) {
            const v0 = getOrAddVertex(coords[wasmTris[t]!]!.ptId);
            const v1 = getOrAddVertex(coords[wasmTris[t + 1]!]!.ptId);
            const v2 = getOrAddVertex(coords[wasmTris[t + 2]!]!.ptId);
            if (v0 !== v1 && v1 !== v2 && v2 !== v0) {
              triIndices.push(v0, v1, v2);
            }
          }
          return;
        }
      }

      const idxList = coords.map((_, i) => i);

      const cross2D = (a: [number, number], b: [number, number], c: [number, number]): number =>
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

      const pointInTri2D = (
        p: [number, number],
        a: [number, number],
        b: [number, number],
        c: [number, number],
      ): boolean => {
        const c1 = cross2D(a, b, p);
        const c2 = cross2D(b, c, p);
        const c3 = cross2D(c, a, p);
        return c1 >= -1e-9 && c2 >= -1e-9 && c3 >= -1e-9;
      };

      let guard = idxList.length * 4;
      while (idxList.length > 3 && guard-- > 0) {
        let earFound = false;
        const n = idxList.length;
        for (let i = 0; i < n; i++) {
          const iPrev = idxList[(i + n - 1) % n]!;
          const iCurr = idxList[i]!;
          const iNext = idxList[(i + 1) % n]!;
          const a = coords[iPrev]!.uv;
          const b = coords[iCurr]!.uv;
          const c = coords[iNext]!.uv;

          if (cross2D(a, b, c) <= 1e-9) continue;

          let hasInside = false;
          for (let j = 0; j < n; j++) {
            const idxJ = idxList[j]!;
            if (
              coords[idxJ]!.ptId === coords[iPrev]!.ptId ||
              coords[idxJ]!.ptId === coords[iCurr]!.ptId ||
              coords[idxJ]!.ptId === coords[iNext]!.ptId
            ) {
              continue;
            }
            if (pointInTri2D(coords[idxJ]!.uv, a, b, c)) {
              hasInside = true;
              break;
            }
          }
          if (!hasInside) {
            const v0 = getOrAddVertex(coords[iPrev]!.ptId);
            const v1 = getOrAddVertex(coords[iCurr]!.ptId);
            const v2 = getOrAddVertex(coords[iNext]!.ptId);
            if (v0 !== v1 && v1 !== v2 && v2 !== v0) {
              triIndices.push(v0, v1, v2);
            }
            idxList.splice(i, 1);
            earFound = true;
            break;
          }
        }
        if (!earFound) {
          // Fallback: clip sharpest remaining triangle so progress is guaranteed
          const iPrev = idxList[0]!;
          const iCurr = idxList[1]!;
          const iNext = idxList[2]!;
          const v0 = getOrAddVertex(coords[iPrev]!.ptId);
          const v1 = getOrAddVertex(coords[iCurr]!.ptId);
          const v2 = getOrAddVertex(coords[iNext]!.ptId);
          if (v0 !== v1 && v1 !== v2 && v2 !== v0) {
            triIndices.push(v0, v1, v2);
          }
          idxList.splice(1, 1);
        }
      }
      if (idxList.length === 3) {
        const v0 = getOrAddVertex(coords[idxList[0]!]!.ptId);
        const v1 = getOrAddVertex(coords[idxList[1]!]!.ptId);
        const v2 = getOrAddVertex(coords[idxList[2]!]!.ptId);
        if (v0 !== v1 && v1 !== v2 && v2 !== v0) {
          triIndices.push(v0, v1, v2);
        }
      }
    };

    const bridgeTwoArcChains = (chainA: number[], chainB: number[]): void => {
      if (chainA.length < 2 || chainB.length < 2) return;
      // Align chainB direction with chainA so quad strip doesn't twist
      const a0 = cartesianPoints.get(chainA[0]!)!;
      const aEnd = cartesianPoints.get(chainA[chainA.length - 1]!)!;
      const b0 = cartesianPoints.get(chainB[0]!)!;
      const bEnd = cartesianPoints.get(chainB[chainB.length - 1]!)!;
      const distDirect =
        Math.hypot(a0[0] - b0[0], a0[1] - b0[1], a0[2] - b0[2]) +
        Math.hypot(aEnd[0] - bEnd[0], aEnd[1] - bEnd[1], aEnd[2] - bEnd[2]);
      const distReversed =
        Math.hypot(a0[0] - bEnd[0], a0[1] - bEnd[1], a0[2] - bEnd[2]) +
        Math.hypot(aEnd[0] - b0[0], aEnd[1] - b0[1], aEnd[2] - b0[2]);
      const alignedB = distReversed < distDirect ? [...chainB].reverse() : chainB;

      const count = Math.min(chainA.length, alignedB.length);
      for (let i = 0; i < count - 1; i++) {
        const va0 = getOrAddVertex(chainA[i]!);
        const va1 = getOrAddVertex(chainA[i + 1]!);
        const vb0 = getOrAddVertex(alignedB[i]!);
        const vb1 = getOrAddVertex(alignedB[i + 1]!);
        if (va0 !== va1 && va1 !== vb1 && vb1 !== va0) {
          triIndices.push(va0, va1, vb1);
        }
        if (va0 !== vb1 && vb1 !== vb0 && vb0 !== va0) {
          triIndices.push(va0, vb1, vb0);
        }
      }
    };

    const namedFaceTriangles = new Map<string, number[]>();
    const recordFaceName = (rawName: string, triStart: number) => {
      const clean = rawName.trim();
      if (!clean) return;
      const triEnd = Math.floor(triIndices.length / 3);
      if (triEnd <= triStart) return;
      let list = namedFaceTriangles.get(clean);
      if (!list) {
        list = [];
        namedFaceTriangles.set(clean, list);
      }
      for (let t = triStart; t < triEnd; t++) {
        list.push(t);
      }
    };

    const afRegex =
      /#(\d+)\s*=\s*(?:ADVANCED_FACE|FACE_SURFACE)\s*\(\s*'([^'\r\n]*)'\s*,\s*\(([^()]*)\)\s*(?:,\s*#(\d+))?/gi;
    while ((m = afRegex.exec(text)) !== null) {
      const faceName = m[2] ?? "";
      const boundIds = Array.from(m[3]!.matchAll(/#(\d+)/g), (r) => parseInt(r[1]!, 10));
      const surfId = m[4] ? parseInt(m[4], 10) : undefined;
      const surfInfo = surfId !== undefined ? surfaceTypes.get(surfId) : undefined;
      const isCurvedRevolution = surfInfo?.kind === "CYLINDRICAL_SURFACE" || surfInfo?.kind === "CONICAL_SURFACE";

      const sampledBounds: { isOuter: boolean; points: number[]; arcChains: number[][] }[] = [];
      for (const bId of boundIds) {
        const loopId = faceBounds.get(bId);
        if (loopId === undefined) continue;
        const loopItems = edgeLoops.get(loopId);
        if (!loopItems || loopItems.length === 0) continue;
        const sampled = sampleLoopPoints(loopItems);
        if (sampled.points.length >= 3) {
          sampledBounds.push({
            isOuter: faceBoundOuter.get(bId) ?? sampledBounds.length === 0,
            points: sampled.points,
            arcChains: sampled.arcChains,
          });
        }
      }

      if (sampledBounds.length === 0) continue;

      const triStart = Math.floor(triIndices.length / 3);

      if (isCurvedRevolution) {
        // Case 1: 1 loop containing 2 circular arc rims connected by seam edges
        if (sampledBounds.length === 1 && sampledBounds[0]!.arcChains.length >= 2) {
          bridgeTwoArcChains(sampledBounds[0]!.arcChains[0]!, sampledBounds[0]!.arcChains[1]!);
          faces.push(sampledBounds[0]!.points);
          recordFaceName(faceName, triStart);
          continue;
        }
        // Case 2: 2 separate circular bound loops (top rim & bottom rim without seam edge)
        if (sampledBounds.length === 2) {
          const rimA = sampledBounds[0]!.arcChains[0] ?? [...sampledBounds[0]!.points, sampledBounds[0]!.points[0]!];
          const rimB = sampledBounds[1]!.arcChains[0] ?? [...sampledBounds[1]!.points, sampledBounds[1]!.points[0]!];
          bridgeTwoArcChains(rimA, rimB);
          faces.push(sampledBounds[0]!.points);
          recordFaceName(faceName, triStart);
          continue;
        }
      }

      // Planar or general face with optional inner hole bounds
      const outerIdx = sampledBounds.findIndex((b) => b.isOuter);
      const outer = sampledBounds[outerIdx >= 0 ? outerIdx : 0]!;
      const holes = sampledBounds.filter((_, idx) => idx !== (outerIdx >= 0 ? outerIdx : 0)).map((b) => b.points);
      triangulatePlanarWithHoles(outer.points, holes);
      faces.push(outer.points);
      recordFaceName(faceName, triStart);
    }

    if (faces.length >= 1 && triIndices.length >= 3 && ptIdToVertexIdx.size >= 3) {
      const namedFacePatches: NamedFacePatch[] | undefined =
        namedFaceTriangles.size > 0
          ? Array.from(namedFaceTriangles.entries()).map(([name, triangleIndices]) => ({
              name,
              triangleIndices,
            }))
          : undefined;
      return {
        vertices: new Float32Array(vertCoords),
        indices: new Uint32Array(triIndices),
        namedFacePatches,
      };
    }

    // 2. Look for unnumbered or arbitrary CARTESIAN_POINT coordinates in STEP ISO-10303-21 entity syntax
    const pointRegex =
      /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\)\s*\)/g;
    const points: [number, number, number][] = [];
    let match: RegExpExecArray | null;

    while ((match = pointRegex.exec(text)) !== null) {
      const x = parseFloat(match[1]!);
      const y = parseFloat(match[2]!);
      const z = parseFloat(match[3]!);
      if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) {
        points.push([x, y, z]);
      }
    }

    if (points.length >= 8) {
      // Compute bounding box of points and build a surface box
      let minX = Infinity,
        minY = Infinity,
        minZ = Infinity;
      let maxX = -Infinity,
        maxY = -Infinity,
        maxZ = -Infinity;
      for (const [x, y, z] of points) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      return StepMesher.createBoxSurface(minX, minY, minZ, maxX, maxY, maxZ);
    }

    throw new Error("Failed to extract surface mesh from STEP: insufficient geometry entities found.");
  }

  /**
   * Creates a watertight triangular surface mesh for a bounding box.
   */
  public static createBoxSurface(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
  ): { vertices: Float32Array; indices: Uint32Array } {
    // 8 box vertices
    const vertices = new Float32Array([
      x0,
      y0,
      z0, // 0
      x1,
      y0,
      z0, // 1
      x1,
      y1,
      z0, // 2
      x0,
      y1,
      z0, // 3
      x0,
      y0,
      z1, // 4
      x1,
      y0,
      z1, // 5
      x1,
      y1,
      z1, // 6
      x0,
      y1,
      z1, // 7
    ]);

    // 12 triangles (2 per face)
    const indices = new Uint32Array([
      // -Z face
      0, 2, 1, 0, 3, 2,
      // +Z face
      4, 5, 6, 4, 6, 7,
      // -Y face
      0, 1, 5, 0, 5, 4,
      // +Y face
      2, 3, 7, 2, 7, 6,
      // -X face
      0, 4, 7, 0, 7, 3,
      // +X face
      1, 2, 6, 1, 6, 5,
    ]);

    return { vertices, indices };
  }

  /**
   * Serializes a tetrahedral mesh and boundary patches into a complete CalculiX FEA deck (*.inp).
   */
  public static exportToCalculixInp(
    mesh: Tet4Mesh,
    patches: ClassifiedPatches,
    options: InpExportOptions = {},
  ): string {
    const lines: string[] = [];
    const heading = options.heading ?? "Automated ModelScript CAD-to-Mesh FEA Deck";
    const matName = options.materialName ?? "STEEL";
    const E = options.youngsModulus ?? 210e9;
    const nu = options.poissonsRatio ?? 0.3;
    const rho = options.density ?? 7850.0;
    const fixedPatch = options.fixedPatch ?? "FIXED_SUPPORT";
    const loadPatch = options.loadPatch ?? "LOAD_SURFACE";
    const fz = options.loadForceZ ?? -1000.0;

    lines.push("*HEADING");
    lines.push(heading);

    // *NODE block (1-based index)
    lines.push("*NODE");
    for (let i = 0; i < mesh.numNodes; i++) {
      const x = mesh.nodeCoords[i * 3 + 0]!.toFixed(6);
      const y = mesh.nodeCoords[i * 3 + 1]!.toFixed(6);
      const z = mesh.nodeCoords[i * 3 + 2]!.toFixed(6);
      lines.push(`${i + 1}, ${x}, ${y}, ${z}`);
    }

    // *ELEMENT block
    const isQuadratic = mesh.elementOrder === "quadratic" || (mesh.nodesPerElement && mesh.nodesPerElement === 10);
    const elemType = isQuadratic ? "C3D10" : "C3D4";
    const nodesPerElem = isQuadratic ? 10 : 4;

    lines.push(`*ELEMENT, TYPE=${elemType}, ELSET=EALL`);
    for (let e = 0; e < mesh.numElements; e++) {
      const base = e * nodesPerElem;
      const nodeIds: number[] = [];
      for (let k = 0; k < nodesPerElem; k++) {
        nodeIds.push(mesh.elements[base + k]! + 1); // 1-based
      }
      lines.push(`${e + 1}, ${nodeIds.join(", ")}`);
    }

    // *NSET blocks for boundary conditions
    for (const [patchName, nodeIdxs] of patches.nodeSets) {
      if (nodeIdxs.length === 0) continue;
      lines.push(`*NSET, NSET=${patchName}`);
      const oneBased = nodeIdxs.map((idx) => idx + 1);
      // Format 10 nodes per line
      for (let i = 0; i < oneBased.length; i += 10) {
        lines.push(oneBased.slice(i, i + 10).join(", "));
      }
    }

    // Material & Solid Section
    lines.push(`*MATERIAL, NAME=${matName}`);
    lines.push("*ELASTIC");
    lines.push(`${E.toExponential(4)}, ${nu}`);
    lines.push("*DENSITY");
    lines.push(`${rho}`);
    lines.push(`*SOLID SECTION, ELSET=EALL, MATERIAL=${matName}`);

    // Analysis Step
    lines.push("*STEP");
    lines.push("*STATIC");

    if (patches.nodeSets.has(fixedPatch)) {
      lines.push("*BOUNDARY");
      lines.push(`${fixedPatch}, 1, 3, 0.0`);
    }

    if (patches.nodeSets.has(loadPatch)) {
      lines.push("*CLOAD");
      lines.push(`${loadPatch}, 3, ${fz.toFixed(1)}`);
    }

    lines.push("*NODE FILE");
    lines.push("U");
    lines.push("*EL FILE");
    lines.push("S");
    lines.push("*END STEP");

    return lines.join("\n") + "\n";
  }

  /**
   * Serializes a tetrahedral mesh and boundary patches into an SU2 CFD mesh file (*.su2).
   */
  public static exportToSu2Mesh(mesh: Tet4Mesh, patches: ClassifiedPatches): string {
    const lines: string[] = [];

    lines.push("NDIME= 3");
    lines.push(`NELEM= ${mesh.numElements}`);

    const nodesPerElem = mesh.nodesPerElement ?? 4;
    // SU2/VTK element type 10 = 3D Tetrahedron (linear), 24 = quadratic Tet10
    const volElemType = nodesPerElem === 10 ? 24 : 10;
    for (let e = 0; e < mesh.numElements; e++) {
      const base = e * nodesPerElem;
      if (nodesPerElem === 10) {
        const nodes: number[] = [];
        for (let k = 0; k < 10; k++) nodes.push(mesh.elements[base + k]!);
        lines.push(`${volElemType}\t${nodes.join("\t")}\t${e}`);
      } else {
        const n0 = mesh.elements[base + 0];
        const n1 = mesh.elements[base + 1];
        const n2 = mesh.elements[base + 2];
        const n3 = mesh.elements[base + 3];
        lines.push(`${volElemType}\t${n0}\t${n1}\t${n2}\t${n3}\t${e}`);
      }
    }

    lines.push(`NPOIN= ${mesh.numNodes}`);
    for (let i = 0; i < mesh.numNodes; i++) {
      const x = mesh.nodeCoords[i * 3 + 0]!.toFixed(8);
      const y = mesh.nodeCoords[i * 3 + 1]!.toFixed(8);
      const z = mesh.nodeCoords[i * 3 + 2]!.toFixed(8);
      lines.push(`${x}\t${y}\t${z}\t${i}`);
    }

    // Boundary Markers
    const activePatches: [string, [number, number, number][]][] = [];
    for (const [name, tris] of patches.surfaceTriangles) {
      if (tris.length > 0) {
        activePatches.push([name, tris]);
      }
    }

    lines.push(`NMARK= ${activePatches.length}`);
    for (const [markerTag, tris] of activePatches) {
      lines.push(`MARKER_TAG= ${markerTag}`);
      lines.push(`MARKER_ELEMS= ${tris.length}`);
      // SU2/VTK boundary triangle element type = 5
      for (const [n0, n1, n2] of tris) {
        lines.push(`5\t${n0}\t${n1}\t${n2}`);
      }
    }

    return lines.join("\n") + "\n";
  }
}
