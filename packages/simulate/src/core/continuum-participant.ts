// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LbmGridConfig, LbmStepResult } from "../cfd/lbm-types.js";
import { WebGPULbmRunner } from "../cfd/webgpu-lbm-runner.js";
import { FeaSolver } from "../fea/fea-solver.js";
import type { FeaBoundaryConditions, FeaStepResult, MaterialProperties, Tet4Mesh } from "../fea/tet4-types.js";

export type Vector3D = [number, number, number];

export interface ContinuumBoundaryCondition {
  velocity?: Vector3D;
  pressure?: number;
  massFlow?: number;
  temperature?: number;
  displacement?: Vector3D;
  force?: Vector3D;
}

export interface ContinuumPatchMetrics {
  patchName: string;
  integratedForce: Vector3D;
  meanPressure: number;
  integratedMassFlow?: number;
  areaM2?: number;
}

export interface CfdStepOutput {
  aerodynamicForceN: Vector3D;
  maxVelocity: number;
  pressureDropPa: number;
  patchMetrics?: Map<string, ContinuumPatchMetrics>;
  velocityMagnitude?: Float32Array;
}

export interface FeaStepOutput extends FeaStepResult {
  tagDisplacements?: Map<string, Vector3D>;
}

/**
 * Universal interface for 3D CFD continuum participants in multi-physics co-simulation.
 */
export interface ICfdContinuumParticipant {
  readonly id: string;
  readonly patchNames: readonly string[];
  initialize(startTime: number, stopTime: number, dt: number): Promise<void> | void;
  step(macroDt: number, subSteps?: number): Promise<CfdStepOutput> | CfdStepOutput;
  setBoundaryCondition(patchName: string, bc: ContinuumBoundaryCondition): void;
  getPatchMetrics(patchName: string): ContinuumPatchMetrics;
  getVisualField?(): Float32Array | null;
  terminate(): Promise<void> | void;
}

/**
 * Universal interface for 3D FEA continuum participants in multi-physics co-simulation.
 */
export interface IFeaContinuumParticipant {
  readonly id: string;
  readonly boundaryTags: readonly string[];
  initialize(startTime: number, stopTime: number, dt: number): Promise<void> | void;
  step(boundaryLoads: Map<string, Vector3D>, dt: number): Promise<FeaStepOutput> | FeaStepOutput;
  getNodeDisplacement(nodeOrTag: string | number): Vector3D;
  getMesh?(): Tet4Mesh;
  terminate(): Promise<void> | void;
}

/**
 * Adapter wrapping in-process WebGPULbmRunner to conform to ICfdContinuumParticipant.
 */
export class WebGpuLbmAdapter implements ICfdContinuumParticipant {
  public readonly id: string;
  public readonly patchNames: readonly string[];
  public readonly runner: WebGPULbmRunner;
  private patchMetricsCache: Map<string, ContinuumPatchMetrics> = new Map();

  constructor(
    id: string,
    public readonly config: LbmGridConfig,
    public readonly cellTypes: Uint8Array,
    patchNames: string[] = ["obstacle", "inlet", "outlet"],
  ) {
    this.id = id;
    this.patchNames = patchNames;
    this.runner = new WebGPULbmRunner(config, cellTypes);
  }

  public initialize(_startTime: number, _stopTime: number, _dt: number): void {
    // Reset internal distributions if needed
  }

  public step(_macroDt: number, subSteps = 5): CfdStepOutput {
    const raw: LbmStepResult = this.runner.step(subSteps);
    const force = raw.aerodynamicForceN;

    const obstacleMetrics: ContinuumPatchMetrics = {
      patchName: "obstacle",
      integratedForce: force,
      meanPressure: 101325.0 + raw.pressureDropPa * 0.5,
    };
    this.patchMetricsCache.set("obstacle", obstacleMetrics);

    return {
      aerodynamicForceN: force,
      maxVelocity: raw.maxVelocity,
      pressureDropPa: raw.pressureDropPa,
      patchMetrics: this.patchMetricsCache,
      velocityMagnitude: raw.velocityMagnitude,
    };
  }

  public setBoundaryCondition(patchName: string, bc: ContinuumBoundaryCondition): void {
    if (patchName === "inlet" && bc.velocity) {
      this.config.inletVelocity = bc.velocity;
    }
  }

  public getPatchMetrics(patchName: string): ContinuumPatchMetrics {
    const cached = this.patchMetricsCache.get(patchName);
    if (cached) return cached;
    return {
      patchName,
      integratedForce: [0, 0, 0],
      meanPressure: 101325.0,
    };
  }

  public getVisualField(): Float32Array | null {
    const n = this.runner.totalCells;
    const mag = new Float32Array(n);
    const vx = this.runner.vx;
    const vy = this.runner.vy;
    const vz = this.runner.vz;
    for (let i = 0; i < n; i++) {
      const u = vx[i] ?? 0;
      const v = vy[i] ?? 0;
      const w = vz[i] ?? 0;
      mag[i] = Math.sqrt(u * u + v * v + w * w);
    }
    return mag;
  }

  public terminate(): void {
    // Clean up WebGPU buffers if any
  }
}

/**
 * Adapter wrapping in-WASM FeaSolver to conform to IFeaContinuumParticipant.
 */
export class WasmFeaAdapter implements IFeaContinuumParticipant {
  public readonly id: string;
  public readonly boundaryTags: readonly string[];
  public readonly solver: FeaSolver;
  public readonly mesh: Tet4Mesh;
  public readonly material: MaterialProperties;
  private fixedNodeSet: Set<number> = new Set();
  private lastResult?: FeaStepResult;
  private transient: boolean;

  constructor(
    id: string,
    mesh: Tet4Mesh,
    material: MaterialProperties,
    fixedTags: string[] = ["fixed_support"],
    transient = true,
  ) {
    this.id = id;
    this.mesh = mesh;
    this.material = material;
    this.transient = transient;
    this.boundaryTags = Array.from(mesh.boundaryNodes.keys());
    this.solver = new FeaSolver(mesh, material);

    for (const tag of fixedTags) {
      const nodes = mesh.boundaryNodes.get(tag);
      if (nodes) {
        for (const n of nodes) this.fixedNodeSet.add(n);
      }
    }
  }

  public initialize(_startTime: number, _stopTime: number, dt: number): void {
    const initialBcs: FeaBoundaryConditions = {
      fixedNodes: this.fixedNodeSet,
      nodalLoads: new Map(),
      transient: this.transient,
      dt,
    };
    this.lastResult = this.solver.step(initialBcs);
  }

  public step(boundaryLoads: Map<string, Vector3D>, dt: number): FeaStepOutput {
    // Distribute boundary patch loads across corresponding boundary nodes
    const nodalLoads = new Map<number, Vector3D>();
    for (const [tag, totalLoad] of boundaryLoads.entries()) {
      const nodes = this.mesh.boundaryNodes.get(tag);
      if (nodes && nodes.length > 0) {
        const perNodeLoad: Vector3D = [
          totalLoad[0] / nodes.length,
          totalLoad[1] / nodes.length,
          totalLoad[2] / nodes.length,
        ];
        for (const n of nodes) {
          const existing = nodalLoads.get(n);
          if (existing) {
            nodalLoads.set(n, [
              existing[0] + perNodeLoad[0],
              existing[1] + perNodeLoad[1],
              existing[2] + perNodeLoad[2],
            ]);
          } else {
            nodalLoads.set(n, perNodeLoad);
          }
        }
      }
    }

    const bcs: FeaBoundaryConditions = {
      fixedNodes: this.fixedNodeSet,
      nodalLoads,
      transient: this.transient,
      dt,
    };

    const res = this.solver.step(bcs);
    this.lastResult = res;

    // Calculate mean displacement per boundary tag
    const tagDisplacements = new Map<string, Vector3D>();
    for (const tag of this.boundaryTags) {
      tagDisplacements.set(tag, this.getNodeDisplacement(tag));
    }

    return {
      ...res,
      tagDisplacements,
    };
  }

  public getNodeDisplacement(nodeOrTag: string | number): Vector3D {
    if (!this.lastResult) return [0, 0, 0];
    const disp = this.lastResult.displacements;

    if (typeof nodeOrTag === "number") {
      const idx = nodeOrTag * 3;
      if (idx + 2 < disp.length) {
        return [disp[idx]!, disp[idx + 1]!, disp[idx + 2]!];
      }
      return [0, 0, 0];
    }

    // Mean displacement across nodes of the boundary tag
    const nodes = this.mesh.boundaryNodes.get(nodeOrTag);
    if (!nodes || nodes.length === 0) return [0, 0, 0];

    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const n of nodes) {
      const idx = n * 3;
      sx += disp[idx] ?? 0;
      sy += disp[idx + 1] ?? 0;
      sz += disp[idx + 2] ?? 0;
    }
    const count = nodes.length;
    return [sx / count, sy / count, sz / count];
  }

  public getMesh(): Tet4Mesh {
    return this.mesh;
  }

  public terminate(): void {
    // Release native memory if applicable
  }
}
