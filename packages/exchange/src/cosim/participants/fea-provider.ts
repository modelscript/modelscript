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

    // Determine total applied force from all connected input ports
    let totalForce = 0.0;
    for (const [k, v] of this.currentInputs.entries()) {
      const lower = k.toLowerCase();
      if (lower.includes("force") || lower.includes("thrust") || lower.includes(".f") || lower.includes("load")) {
        totalForce += v;
      }
    }

    // Distribute force evenly across boundary nodes of matched load tags
    const nodalLoads = new Map<number, [number, number, number]>();
    const axis = this.options.loadAxis ?? "y";

    for (const tag of this.loadTags) {
      const nodes = this.mesh.boundaryNodes.get(tag) || [];
      if (nodes.length === 0) continue;
      const forcePerNode = totalForce / (Math.max(1, this.loadTags.length) * nodes.length);

      for (const node of nodes) {
        const existing = nodalLoads.get(node) || [0, 0, 0];
        if (axis === "x") existing[0] += forcePerNode;
        else if (axis === "z") existing[2] += forcePerNode;
        else existing[1] += forcePerNode;
        nodalLoads.set(node, existing);
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
