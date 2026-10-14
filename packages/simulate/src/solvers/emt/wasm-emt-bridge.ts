// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-Performance Native WebAssembly EMT Companion Solver Bridge.
 *
 * Provides a zero-copy, zero-GC TypeScript interface to the AssemblyScript
 * EMT solver kernel running in WebAssembly linear memory.
 */

import { getDefaultWasmExports } from "@modelscript/runtime";

export interface WasmEmtBranchDef {
  from: number;
  to: number;
  r?: number;
  l?: number;
  c?: number;
}

export interface WasmEmtSourceDef {
  node: number;
  vPeakKv: number;
  freqHz: number;
  phaseRad?: number;
  gSource?: number;
  isDc?: boolean;
}

export interface WasmEmtSimulationResult {
  stepCount: number;
  simulatedTimeSec: number;
  executionTimeMs: number;
  stepsPerSecond: number;
  timePoints: Float64Array;
  voltages: Float64Array[]; // Array of Float64Array for each node [0..nNodes-1]
}

export class WasmEmtBridge {
  private readonly wasm: any;
  private readonly memory: WebAssembly.Memory;
  private readonly solverPtr: number;
  private readonly nNodes: number;
  private readonly dt: number;

  private trajectoryPtr: number = 0;
  private maxTrajectorySteps: number = 0;

  constructor(nNodes: number, dt: number, maxBranches = 128, maxSources = 32, wasmExports?: any) {
    this.wasm = wasmExports ?? getDefaultWasmExports();
    if (!this.wasm) {
      throw new Error("Failed to load native WebAssembly runtime exports for WasmEmtBridge");
    }
    this.memory = this.wasm.memory;
    this.nNodes = nNodes;
    this.dt = dt;

    if (typeof this.wasm.emt_create !== "function") {
      throw new Error("WASM binary does not export emt_create");
    }

    this.solverPtr = this.wasm.emt_create(nNodes, maxBranches, maxSources, dt);
    if (!this.solverPtr) {
      throw new Error("Failed to allocate WasmEmtSolver in WASM linear memory");
    }
  }

  /**
   * Adds an RLC branch to the companion circuit.
   * Nodes >= 0 are active buses, -1 is reference/ground (GND).
   */
  public addBranch(from: number, to: number, r = 0, l = 0, c = 0): number {
    return this.wasm.emt_add_branch(this.solverPtr, from, to, r, l, c);
  }

  /**
   * Adds an AC or DC voltage source to a specific node.
   */
  public addSource(source: WasmEmtSourceDef): number {
    const type = source.isDc ? 2 : 1; // 1: AC, 2: DC
    return this.wasm.emt_add_source(
      this.solverPtr,
      source.node,
      source.vPeakKv,
      source.freqHz,
      source.phaseRad ?? 0,
      source.gSource ?? 1000.0,
      type,
    );
  }

  /**
   * Assembles the system conductance matrix [G] and factors it using
   * row-equilibrated LU decomposition with partial pivoting.
   */
  public buildAndFactorize(): boolean {
    const ok = this.wasm.emt_build_and_factorize(this.solverPtr);
    return Boolean(ok);
  }

  /**
   * Pre-allocates a continuous trajectory buffer in WASM linear memory
   * for zero-copy streaming of simulation results.
   */
  public allocateTrajectory(maxSteps: number): void {
    this.maxTrajectorySteps = maxSteps;
    this.trajectoryPtr = this.wasm.emt_alloc_trajectory(this.solverPtr, maxSteps);
  }

  /**
   * Advances the simulation by a single microsecond time step dt.
   */
  public step(): void {
    this.wasm.emt_step(this.solverPtr);
  }

  /**
   * Runs nSteps consecutively entirely inside WebAssembly linear memory
   * with zero JS/V8 boundary crossings.
   */
  public runSteps(nSteps: number): number {
    return this.wasm.emt_run_steps(this.solverPtr, nSteps);
  }

  /**
   * Returns direct Float64Array view of the current node voltages [v0, v1, ..., v(N-1)].
   */
  public getVoltages(): Float64Array {
    const vPtr = this.wasm.emt_get_voltages_ptr(this.solverPtr);
    return new Float64Array(this.memory.buffer, vPtr, this.nNodes);
  }

  /**
   * Returns current simulation time in seconds.
   */
  public getTime(): number {
    return this.wasm.emt_get_time(this.solverPtr);
  }

  /**
   * Returns current branch current for the specified branch index.
   */
  public getBranchCurrent(branchIdx: number): number {
    return this.wasm.emt_get_branch_current(this.solverPtr, branchIdx);
  }

  /**
   * Executes a complete transient simulation for totalSteps with zero GC pauses,
   * returning unpackaged or zero-copy trajectory arrays.
   */
  public solve(totalSteps: number): WasmEmtSimulationResult {
    this.allocateTrajectory(totalSteps);

    const tStart = performance.now();
    this.runSteps(totalSteps);
    const executionTimeMs = performance.now() - tStart;

    const recordedCount = this.wasm.emt_get_trajectory_count(this.solverPtr);
    const stride = 1 + this.nNodes;
    const rawBuffer = new Float64Array(this.memory.buffer, this.trajectoryPtr, recordedCount * stride);

    // Unpack trajectory into time points and node voltage series
    const timePoints = new Float64Array(recordedCount);
    const voltages: Float64Array[] = [];
    for (let i = 0; i < this.nNodes; i++) {
      voltages.push(new Float64Array(recordedCount));
    }

    for (let k = 0; k < recordedCount; k++) {
      const base = k * stride;
      timePoints[k] = rawBuffer[base]!;
      for (let i = 0; i < this.nNodes; i++) {
        voltages[i]![k] = rawBuffer[base + 1 + i]!;
      }
    }

    const stepsPerSecond = executionTimeMs > 0 ? recordedCount / (executionTimeMs / 1000) : 0;

    return {
      stepCount: recordedCount,
      simulatedTimeSec: this.getTime(),
      executionTimeMs,
      stepsPerSecond,
      timePoints,
      voltages,
    };
  }
}
