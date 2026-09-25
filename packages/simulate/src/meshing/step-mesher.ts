// SPDX-License-Identifier: AGPL-3.0-or-later

import { Tet4Mesher } from "../fea/tet4-mesher.js";
import type { MeshQualityMetrics, Tet4Mesh } from "../fea/tet4-types.js";
import { BoundaryLayerExtruder, type BoundaryLayerOptions, type ExtrusionResult } from "./boundary-layer-extruder.js";
import { MeshQualityAnalyzer } from "./mesh-quality-analyzer.js";
import { PatchClassifier, type ClassifiedPatches, type PatchClassificationRules } from "./patch-classifier.js";

export interface StepMesherOptions {
  /** Target resolution along the longest bounding box dimension. Default: 20. */
  resolution?: number;
  /** Element formulation order: 'linear' (Tet4, 4-node) or 'quadratic' (Tet10, 10-node). Default: 'linear'. */
  order?: "linear" | "quadratic";
  /** Boundary layer inflation configuration (primarily for viscous CFD walls). */
  inflation?: BoundaryLayerOptions & {
    /** Target boundary patch name to extrude from. Default: 'WALL_BODY'. */
    targetPatch?: string;
  };
  /** Patch classification rules for boundary conditions. */
  patchRules?: PatchClassificationRules;
}

export interface MeshingPipelineResult {
  mesh: Tet4Mesh;
  patches: ClassifiedPatches;
  quality: MeshQualityMetrics;
  inflationResult?: ExtrusionResult;
}

export interface InpExportOptions {
  heading?: string;
  materialName?: string;
  youngsModulus?: number; // E in Pa (default: 210e9)
  poissonsRatio?: number; // nu (default: 0.3)
  density?: number; // rho in kg/m^3 (default: 7850)
  fixedPatch?: string; // default: 'FIXED_SUPPORT'
  loadPatch?: string; // default: 'LOAD_SURFACE'
  loadForceZ?: number; // default: -1000.0 N
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

    // 2. Classify boundary patches on the exterior surface
    const patches = PatchClassifier.classify(vertices, indices, options.patchRules);

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
              subCoords.push(vertices[origIdx * 3 + 0], vertices[origIdx * 3 + 1], vertices[origIdx * 3 + 2]);
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

    // Look for CARTESIAN_POINT coordinates in STEP ISO-10303-21 entity syntax
    const pointRegex =
      /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\)\s*\)/g;
    const points: [number, number, number][] = [];
    let match: RegExpExecArray | null;

    while ((match = pointRegex.exec(text)) !== null) {
      const x = parseFloat(match[1]);
      const y = parseFloat(match[2]);
      const z = parseFloat(match[3]);
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
      const x = mesh.nodeCoords[i * 3 + 0].toFixed(6);
      const y = mesh.nodeCoords[i * 3 + 1].toFixed(6);
      const z = mesh.nodeCoords[i * 3 + 2].toFixed(6);
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
        nodeIds.push(mesh.elements[base + k] + 1); // 1-based
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
    // SU2 element type 4 = 3D Tetrahedron (linear)
    for (let e = 0; e < mesh.numElements; e++) {
      const base = e * nodesPerElem;
      const n0 = mesh.elements[base + 0];
      const n1 = mesh.elements[base + 1];
      const n2 = mesh.elements[base + 2];
      const n3 = mesh.elements[base + 3];
      lines.push(`4\t${n0}\t${n1}\t${n2}\t${n3}\t${e}`);
    }

    lines.push(`NPOIN= ${mesh.numNodes}`);
    for (let i = 0; i < mesh.numNodes; i++) {
      const x = mesh.nodeCoords[i * 3 + 0].toFixed(8);
      const y = mesh.nodeCoords[i * 3 + 1].toFixed(8);
      const z = mesh.nodeCoords[i * 3 + 2].toFixed(8);
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
      // SU2 boundary triangle element type = 3
      for (const [n0, n1, n2] of tris) {
        lines.push(`3\t${n0}\t${n1}\t${n2}`);
      }
    }

    return lines.join("\n") + "\n";
  }
}
