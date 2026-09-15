// SPDX-License-Identifier: AGPL-3.0-or-later

import { FeaSolver, type FeaStepResult, type MaterialProperties, type Tet4Mesh } from "@modelscript/simulate";
import type { CosimValue } from "../coupling.js";
import type { ParticipantMetadata } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

/**
 * Structural FEA Mesh frame payload streamed over LSP / Co-Simulation.
 */
export interface FeaMeshPayload {
  type: "fea-mesh";
  participantId: string;
  time: number;
  geometry: {
    positions: number[];
    indices: number[];
    normals?: number[];
  };
  fields: {
    vonMisesStress: number[];
    displacements: number[];
  };
  stats: {
    maxStress: number;
    maxDisplacement: number;
    safetyFactor?: number;
  };
}

/**
 * Extracts outward-facing surface boundary triangles from a tetrahedral mesh (Tet4 or Tet10)
 * by finding unique faces that appear in exactly one tetrahedron.
 */
export function extractSurfaceTriangles(mesh: Tet4Mesh): Uint32Array {
  const { elements, numElements, nodesPerElement = 4 } = mesh;
  const faceMap = new Map<string, { count: number; face: [number, number, number] }>();

  for (let e = 0; e < numElements; e++) {
    const base = e * nodesPerElement;
    const n0 = elements[base + 0];
    const n1 = elements[base + 1];
    const n2 = elements[base + 2];
    const n3 = elements[base + 3];

    // 4 faces of a tetrahedron with outward-consistent vertex orientations
    const faces: [number, number, number][] = [
      [n0, n2, n1],
      [n0, n1, n3],
      [n1, n2, n3],
      [n0, n3, n2],
    ];

    for (const f of faces) {
      const key = [f[0], f[1], f[2]].sort((a, b) => a - b).join("_");
      const entry = faceMap.get(key);
      if (entry) {
        entry.count++;
      } else {
        faceMap.set(key, { count: 1, face: f });
      }
    }
  }

  const surfaceFaces: number[] = [];
  for (const { count, face } of faceMap.values()) {
    if (count === 1) {
      surfaceFaces.push(face[0], face[1], face[2]);
    }
  }
  return new Uint32Array(surfaceFaces);
}

export interface FeaCoSimOptions {
  /** Optional boundary patch tag name for fixed Dirichlet support. Defaults to tags containing 'fixed', 'support', 'hub', 'root'. */
  fixedTag?: string;
  /** Optional boundary patch tag name where force is applied. Defaults to tags containing 'flange', 'motor', 'load', 'tip'. */
  loadTag?: string;
  /** Primary axis of applied load: 'x' | 'y' | 'z' (default: 'y'). */
  loadAxis?: "x" | "y" | "z";
  /** PCG convergence tolerance (default: 1e-5). */
  tolerance?: number;
  /** PCG maximum iterations (default: 300). */
  maxIterations?: number;
  /** Enable geometrically non-linear corotational kinematics (default: true). */
  corotational?: boolean;
}

/**
 * High-performance 3D Structural FEA Co-Simulation Participant.
 * Wraps FeaSolver to sync with 1D Modelica dynamic states in real time.
 */
export class FeaCoSimParticipant implements CoSimParticipant {
  public readonly id: string;
  public readonly modelName: string;
  public readonly metadata: ParticipantMetadata;

  public readonly feaSolver: FeaSolver;
  public readonly mesh: Tet4Mesh;
  public readonly material: MaterialProperties;
  public readonly surfaceIndices: Uint32Array;

  private fixedNodes: Set<number> = new Set();
  private loadTags: string[] = [];
  private currentInputs: Map<string, number> = new Map();
  private latestResult: FeaStepResult;
  private currentTime = 0;
  private options: FeaCoSimOptions;

  constructor(
    id: string,
    modelName: string,
    mesh: Tet4Mesh,
    material: MaterialProperties,
    options: FeaCoSimOptions = {},
  ) {
    this.id = id;
    this.modelName = modelName;
    this.mesh = mesh;
    this.material = material;
    this.options = {
      loadAxis: "y",
      tolerance: 1e-5,
      maxIterations: 300,
      corotational: true,
      ...options,
    };

    this.feaSolver = new FeaSolver(mesh, material);
    this.surfaceIndices = extractSurfaceTriangles(mesh);

    this.autoClassifyBoundaryPatches();

    // Initial zero-state solve
    this.latestResult = this.feaSolver.step(
      {
        fixedNodes: this.fixedNodes,
        nodalLoads: new Map(),
        corotational: this.options.corotational,
      },
      this.options.tolerance,
      this.options.maxIterations,
    );

    this.metadata = {
      participantId: id,
      modelName,
      type: "external",
      classKind: "field",
      timestamp: new Date().toISOString(),
      description: "3D Tet4/Tet10 FEA structural participant",
      variables: [
        { name: "load.force", causality: "input", type: "Real" },
        { name: "maxDisplacement", causality: "output", type: "Real" },
        { name: "maxVonMisesStress", causality: "output", type: "Real" },
        { name: "compliance", causality: "output", type: "Real" },
      ],
    };
  }

  private autoClassifyBoundaryPatches(): void {
    const { boundaryNodes } = this.mesh;
    this.fixedNodes.clear();
    this.loadTags = [];

    for (const [tag, nodes] of boundaryNodes.entries()) {
      const lower = tag.toLowerCase();

      // Fixed support
      if (
        (this.options.fixedTag && this.options.fixedTag === tag) ||
        lower.includes("fixed") ||
        lower.includes("support") ||
        lower.includes("hub") ||
        lower.includes("root") ||
        lower.includes("ground")
      ) {
        for (const n of nodes) this.fixedNodes.add(n);
        continue;
      }

      // Load flange
      if (
        (this.options.loadTag && this.options.loadTag === tag) ||
        lower.includes("motor") ||
        lower.includes("flange") ||
        lower.includes("load") ||
        lower.includes("tip") ||
        lower.includes("thrust")
      ) {
        this.loadTags.push(tag);
      }
    }

    // Fallbacks if no tag explicitly matched
    if (this.fixedNodes.size === 0 && boundaryNodes.size > 0) {
      const firstTag = boundaryNodes.keys().next().value;
      if (firstTag) {
        const nodes = boundaryNodes.get(firstTag) || [];
        for (const n of nodes) this.fixedNodes.add(n);
      }
    }
    if (this.loadTags.length === 0 && boundaryNodes.size > 1) {
      for (const tag of boundaryNodes.keys()) {
        const nodes = boundaryNodes.get(tag) || [];
        if (!nodes.some((n) => this.fixedNodes.has(n))) {
          this.loadTags.push(tag);
          break;
        }
      }
    }
  }

  public async initialize(startTime: number, _stopTime: number, _stepSize: number): Promise<void> {
    this.currentTime = startTime;
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    for (const [k, v] of values.entries()) {
      this.currentInputs.set(k, Number(v));
    }
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    this.currentTime = currentTime + stepSize;

    const nodalLoads = new Map<number, [number, number, number]>();
    const defaultAxis = this.options.loadAxis ?? "y";

    // 1. Group inputs by target patch or global
    const patchForces = new Map<string, [number, number, number]>();
    let globalVector: [number, number, number] = [0, 0, 0];
    let hasGlobalForce = false;

    for (const [k, v] of this.currentInputs.entries()) {
      const lower = k.toLowerCase();
      if (!lower.includes("force") && !lower.includes("thrust") && !lower.includes(".f") && !lower.includes("load")) {
        continue;
      }

      // Check for directional axis
      let axisIdx = defaultAxis === "x" ? 0 : defaultAxis === "z" ? 2 : 1;
      if (lower.endsWith(".fx") || lower.endsWith("_x") || lower.endsWith(".x")) axisIdx = 0;
      else if (lower.endsWith(".fy") || lower.endsWith("_y") || lower.endsWith(".y")) axisIdx = 1;
      else if (lower.endsWith(".fz") || lower.endsWith("_z") || lower.endsWith(".z")) axisIdx = 2;

      // Check if a specific boundary patch is targeted by the input variable name
      let matchedTag: string | null = null;
      for (const tag of this.loadTags) {
        const tagLower = tag.toLowerCase();
        const baseName = tagLower.replace(/(_|-)(mount|flange|load|tip|patch|surface|tag)$/, "");
        if (lower.includes(tagLower) || (baseName.length >= 3 && lower.includes(baseName))) {
          matchedTag = tag;
          break;
        }
      }

      if (matchedTag) {
        let vec = patchForces.get(matchedTag);
        if (!vec) {
          vec = [0, 0, 0];
          patchForces.set(matchedTag, vec);
        }
        vec[axisIdx] += v;
      } else {
        globalVector[axisIdx] += v;
        hasGlobalForce = true;
      }
    }

    // 2. Distribute patch-specific vector forces
    for (const [tag, vec] of patchForces.entries()) {
      const nodes = this.mesh.boundaryNodes.get(tag) || [];
      if (nodes.length === 0) continue;
      const fX = vec[0] / nodes.length;
      const fY = vec[1] / nodes.length;
      const fZ = vec[2] / nodes.length;

      for (const node of nodes) {
        const existing = nodalLoads.get(node) || [0, 0, 0];
        existing[0] += fX;
        existing[1] += fY;
        existing[2] += fZ;
        nodalLoads.set(node, existing);
      }
    }

    // 3. Distribute global force across load tags
    if (hasGlobalForce && this.loadTags.length > 0) {
      for (const tag of this.loadTags) {
        const nodes = this.mesh.boundaryNodes.get(tag) || [];
        if (nodes.length === 0) continue;
        const totalNodes = Math.max(1, this.loadTags.length) * nodes.length;
        const fX = globalVector[0] / totalNodes;
        const fY = globalVector[1] / totalNodes;
        const fZ = globalVector[2] / totalNodes;

        for (const node of nodes) {
          const existing = nodalLoads.get(node) || [0, 0, 0];
          existing[0] += fX;
          existing[1] += fY;
          existing[2] += fZ;
          nodalLoads.set(node, existing);
        }
      }
    }

    // Solve FEA
    this.latestResult = this.feaSolver.step(
      {
        fixedNodes: this.fixedNodes,
        nodalLoads,
        corotational: this.options.corotational,
      },
      this.options.tolerance,
      this.options.maxIterations,
    );
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    const outputs = new Map<string, CosimValue>();
    outputs.set("maxDisplacement", this.latestResult.maxDisplacement);
    outputs.set("maxVonMisesStress", this.latestResult.maxVonMisesStress);
    outputs.set("compliance", this.latestResult.maxDisplacement);

    // Compute patch-specific and directional outputs
    const u = this.latestResult.displacements;
    let maxUx = 0,
      maxUy = 0,
      maxUz = 0;
    for (let i = 0; i < this.mesh.numNodes; i++) {
      const ux = Math.abs(u[i * 3 + 0] ?? 0);
      const uy = Math.abs(u[i * 3 + 1] ?? 0);
      const uz = Math.abs(u[i * 3 + 2] ?? 0);
      if (ux > maxUx) maxUx = ux;
      if (uy > maxUy) maxUy = uy;
      if (uz > maxUz) maxUz = uz;
    }

    outputs.set("displacement_x", maxUx);
    outputs.set("displacement_y", maxUy);
    outputs.set("displacement_z", maxUz);

    for (const tag of this.loadTags) {
      const nodes = this.mesh.boundaryNodes.get(tag) || [];
      if (nodes.length === 0) continue;
      let sumUx = 0,
        sumUy = 0,
        sumUz = 0;
      for (const n of nodes) {
        sumUx += u[n * 3 + 0] ?? 0;
        sumUy += u[n * 3 + 1] ?? 0;
        sumUz += u[n * 3 + 2] ?? 0;
      }
      outputs.set(`${tag}.ux`, sumUx / nodes.length);
      outputs.set(`${tag}.uy`, sumUy / nodes.length);
      outputs.set(`${tag}.uz`, sumUz / nodes.length);
      outputs.set(`${tag}.displacement`, Math.hypot(sumUx, sumUy, sumUz) / nodes.length);
    }

    return outputs;
  }

  /**
   * Generates the serialized mesh payload for real-time visualization via LSP.
   */
  public getMeshPayload(): FeaMeshPayload {
    return {
      type: "fea-mesh",
      participantId: this.id,
      time: this.currentTime,
      geometry: {
        positions: Array.from(this.mesh.nodeCoords),
        indices: Array.from(this.surfaceIndices),
      },
      fields: {
        vonMisesStress: Array.from(this.latestResult.nodalVonMises),
        displacements: Array.from(this.latestResult.displacements),
      },
      stats: {
        maxStress: this.latestResult.maxVonMisesStress,
        maxDisplacement: this.latestResult.maxDisplacement,
        safetyFactor: this.latestResult.safetyFactor,
      },
    };
  }

  public async terminate(): Promise<void> {
    // No-op
  }
}
