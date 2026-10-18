// SPDX-License-Identifier: AGPL-3.0-or-later

import { Tet4Mesher } from "../fea/tet4-mesher.js";
import type { MeshQualityMetrics, Tet4Mesh } from "../fea/tet4-types.js";
import { BoundaryLayerExtruder, type BoundaryLayerOptions, type ExtrusionResult } from "./boundary-layer-extruder.js";
import { MeshQualityAnalyzer } from "./mesh-quality-analyzer.js";
import { PatchClassifier, type ClassifiedPatches, type PatchClassificationRules } from "./patch-classifier.js";

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
    stepInput: Uint8Array | string | { vertices: Float32Array | number[]; indices: Uint32Array | number[] },
    options: StepMesherOptions = {},
  ): MeshingPipelineResult {
    // If surface arrays are passed directly
    if (typeof stepInput === "object" && "vertices" in stepInput && "indices" in stepInput) {
      return StepMesher.meshSurfaceToTetrahedra(stepInput.vertices, stepInput.indices, options);
    }

    // Otherwise extract or synthesize surface triangulation from STEP data
    const surface = StepMesher.extractSurfaceFromStep(stepInput);
    return StepMesher.meshSurfaceToTetrahedra(surface.vertices, surface.indices, options);
  }

  /**
   * Extracts or approximates surface triangles from raw STEP content or fallbacks.
   */
  public static extractSurfaceFromStep(stepInput: Uint8Array | string): {
    vertices: Float32Array;
    indices: Uint32Array;
  } {
    const text = typeof stepInput === "string" ? stepInput : new TextDecoder().decode(stepInput);

    // 1. Parse numbered STEP entities for B-Rep face reconstruction
    const cartesianPoints = new Map<number, [number, number, number]>();
    const directions = new Map<number, [number, number, number]>();
    const axisPlacements = new Map<number, { loc: number; axis?: number | undefined; refDir?: number | undefined }>();
    const circles = new Map<number, { placement: number; radius: number }>();
    const vertexToPoint = new Map<number, number>();
    const edgeCurves = new Map<number, { vStart: number; vEnd: number; curveId?: number | undefined }>();
    const orientedEdges = new Map<number, { edge: number; sense: boolean }>();
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

    const oeRegex = /#(\d+)\s*=\s*ORIENTED_EDGE\s*\(\s*'[^']*'\s*,\s*\*?\s*,\s*\*?\s*,\s*#(\d+)\s*,\s*\.(T|F)\.\s*\)/g;
    while ((m = oeRegex.exec(text)) !== null) {
      orientedEdges.set(parseInt(m[1]!, 10), {
        edge: parseInt(m[2]!, 10),
        sense: m[3] === "T",
      });
    }

    const elRegex = /#(\d+)\s*=\s*(?:EDGE_LOOP|POLY_LOOP)\s*\(\s*'[^']*'\s*,\s*\(([^)]*)\)\s*\)/g;
    while ((m = elRegex.exec(text)) !== null) {
      const loopId = parseInt(m[1]!, 10);
      const refs = Array.from(m[2]!.matchAll(/#(\d+)/g), (r) => parseInt(r[1]!, 10));
      if (refs.length > 0) edgeLoops.set(loopId, refs);
    }

    const fbRegex = /#(\d+)\s*=\s*(?:FACE_OUTER_BOUND|FACE_BOUND)\s*\(\s*'[^']*'\s*,\s*#(\d+)/g;
    while ((m = fbRegex.exec(text)) !== null) {
      faceBounds.set(parseInt(m[1]!, 10), parseInt(m[2]!, 10));
    }

    const afRegex = /#(\d+)\s*=\s*(?:ADVANCED_FACE|FACE_SURFACE)\s*\(\s*'[^']*'\s*,\s*\(([^)]*)\)/g;
    while ((m = afRegex.exec(text)) !== null) {
      const boundIds = Array.from(m[2]!.matchAll(/#(\d+)/g), (r) => parseInt(r[1]!, 10));
      for (const bId of boundIds) {
        const loopId = faceBounds.get(bId);
        if (loopId === undefined) continue;
        const loopItems = edgeLoops.get(loopId);
        if (!loopItems || loopItems.length === 0) continue;
        const polyPointIds: number[] = [];
        for (const itemId of loopItems) {
          if (cartesianPoints.has(itemId)) {
            polyPointIds.push(itemId);
            continue;
          }
          const oe = orientedEdges.get(itemId);
          if (oe) {
            const ec = edgeCurves.get(oe.edge);
            if (ec) {
              const startVertex = oe.sense ? ec.vStart : ec.vEnd;
              const endVertex = oe.sense ? ec.vEnd : ec.vStart;
              const ptId = vertexToPoint.get(startVertex);
              const endPtId = vertexToPoint.get(endVertex);
              if (ptId !== undefined && cartesianPoints.has(ptId)) {
                polyPointIds.push(ptId);
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
                  // v = n x u
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
                  const numSegs = Math.max(4, Math.round((sweep / (2.0 * Math.PI)) * 12));
                  const sign = oe.sense ? 1.0 : -1.0;
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
                  }
                }
              }
            }
          }
        }
        if (polyPointIds.length >= 3) {
          faces.push(polyPointIds);
        }
      }
    }

    if (faces.length >= 4) {
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

      for (const poly of faces) {
        const v0 = getOrAddVertex(poly[0]!);
        for (let k = 1; k < poly.length - 1; k++) {
          const v1 = getOrAddVertex(poly[k]!);
          const v2 = getOrAddVertex(poly[k + 1]!);
          if (v0 !== v1 && v1 !== v2 && v2 !== v0) {
            triIndices.push(v0, v1, v2);
          }
        }
      }

      if (triIndices.length >= 12 && ptIdToVertexIdx.size >= 4) {
        return {
          vertices: new Float32Array(vertCoords),
          indices: new Uint32Array(triIndices),
        };
      }
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

    // Default procedural test geometry: 100mm x 20mm x 20mm beam
    return StepMesher.createBoxSurface(0, 0, 0, 0.1, 0.02, 0.02);
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
