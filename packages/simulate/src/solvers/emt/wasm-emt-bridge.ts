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
  factorizationCount: number;
  totalNonlinearIterations: number;
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
   * Adds a Bergeron traveling-wave transmission line with fractional delay interpolation.
   */
  public addBergeronLine(fromNode: number, toNode: number, zc: number, tauSec: number, rTotal = 0): number {
    return this.wasm.emt_add_bergeron_line(this.solverPtr, fromNode, toNode, zc, tauSec, rTotal);
  }

  /**
   * Adds a 4-terminal coupled transformer winding with arbitrary turns ratio a = V1 / V2.
   */
  public addTransformerWinding(
    pPos: number,
    pNeg: number,
    sPos: number,
    sNeg: number,
    gLeakage: number,
    alphaL: number,
    turnsRatio: number,
  ): number {
    return this.wasm.emt_add_transformer_winding(this.solverPtr, pPos, pNeg, sPos, sNeg, gLeakage, alphaL, turnsRatio);
  }

  /**
   * Adds a time-switched fault (nodeB = -1 for phase-to-ground, >= 0 for phase-to-phase).
   */
  public addFault(nodeA: number, nodeB: number, startSec: number, endSec: number, rFaultOhm = 1e-3): number {
    const gFault = 1.0 / Math.max(1e-6, rFaultOhm);
    return this.wasm.emt_add_fault(this.solverPtr, nodeA, nodeB, startSec, endSec, gFault);
  }

  /**
   * Adds a circuit breaker pole with physical current zero-crossing arc extinction and sub-step interpolation.
   */
  public addBreaker(
    fromNode: number,
    toNode: number,
    options?: {
      rClosedOhm?: number;
      rOpenOhm?: number;
      closedInitially?: boolean;
      openTimeSec?: number;
      closeTimeSec?: number;
      choppingCurrentAmp?: number;
    },
  ): number {
    const gClosed = 1.0 / Math.max(1e-6, options?.rClosedOhm ?? 1e-3);
    const gOpen = 1.0 / Math.max(1.0, options?.rOpenOhm ?? 1e9);
    return this.wasm.emt_add_breaker(
      this.solverPtr,
      fromNode,
      toNode,
      gClosed,
      gOpen,
      options?.closedInitially ?? true,
      options?.openTimeSec ?? 1e9,
      options?.closeTimeSec ?? 1e9,
      options?.choppingCurrentAmp ?? 0.5,
    );
  }

  /**
   * Adds a non-linear piecewise-linear saturable magnetic core branch at the specified node.
   */
  public addSaturableCore(
    node: number,
    lUnsatH: number,
    lSatH: number,
    kneeFluxWb: number,
    remanentFluxWb = 0,
  ): number {
    return this.wasm.emt_add_saturable_core(this.solverPtr, node, lUnsatH, lSatH, kneeFluxWb, remanentFluxWb);
  }

  /**
   * Adds an IEEE Std C62.22 non-linear Metal-Oxide Varistor (MOV) surge arrester between fromNode and toNode.
   */
  public addSurgeArrester(fromNode: number, toNode: number, vRefVolts: number): number {
    return this.wasm.emt_add_surge_arrester(this.solverPtr, fromNode, toNode, vRefVolts);
  }

  /**
   * Adds a 6th-order subtransient Park d-q synchronous machine connected to 3-phase nodes (nodeA, nodeB, nodeC).
   */
  public addSynchronousMachine(options: {
    nodeA: number;
    nodeB: number;
    nodeC: number;
    sBaseMva: number;
    vBaseKvLL: number;
    freqHz?: number;
    xd?: number;
    xq?: number;
    xdPrime?: number;
    xqPrime?: number;
    xdSub?: number;
    td0Prime?: number;
    tq0Prime?: number;
    td0Sub?: number;
    tq0Sub?: number;
    hInertia?: number;
    dampingD?: number;
    pmPu?: number;
    efPu?: number;
  }): number {
    return this.wasm.emt_add_sync_machine(
      this.solverPtr,
      options.nodeA,
      options.nodeB,
      options.nodeC,
      options.sBaseMva,
      options.vBaseKvLL,
      options.freqHz ?? 60.0,
      options.xd ?? 1.8,
      options.xq ?? 1.7,
      options.xdPrime ?? 0.3,
      options.xqPrime ?? 0.55,
      options.xdSub ?? 0.2,
      options.td0Prime ?? 8.0,
      options.tq0Prime ?? 0.4,
      options.td0Sub ?? 0.03,
      options.tq0Sub ?? 0.05,
      options.hInertia ?? 3.5,
      options.dampingD ?? 2.0,
      options.pmPu ?? 0.8,
      options.efPu ?? 1.2,
    );
  }

  /**
   * Configures within-step Newton-Raphson non-linear iteration for saturable cores and MOV arresters.
   */
  public setNonlinearIterationOptions(maxIterations: number, toleranceVolts = 1.0): void {
    if (typeof this.wasm.emt_set_nonlinear_options === "function") {
      this.wasm.emt_set_nonlinear_options(this.solverPtr, maxIterations, toleranceVolts);
    }
  }

  /**
   * Returns total number of within-step Newton-Raphson non-linear iterations performed across all steps.
   */
  public getTotalNonlinearIterations(): number {
    if (typeof this.wasm.emt_get_nonlinear_iterations === "function") {
      return this.wasm.emt_get_nonlinear_iterations(this.solverPtr);
    }
    return 0;
  }

  /**
   * Adds a power electronic converter bridge (VSC PWM, 6-pulse LCC thyristor, or MMC Thevenin equivalent)
   * directly into the native WebAssembly EMT kernel.
   */
  public addConverterBridge(options: {
    nodeA: number;
    nodeB: number;
    nodeC: number;
    nodeDcPos: number;
    nodeDcNeg: number;
    mode?: "vsc_pwm" | "lcc_6pulse" | "mmc_thevenin";
    freqHz?: number;
    modulationIndex?: number;
    firingAngleDeg?: number;
    nSubmodulesPerArm?: number;
    cSubmoduleFarad?: number;
    vSmInitVolts?: number;
    lArmHenry?: number;
    rArmOhm?: number;
  }): number {
    const modeCode = options.mode === "lcc_6pulse" ? 2 : options.mode === "mmc_thevenin" ? 3 : 1;
    return this.wasm.emt_add_converter_bridge(
      this.solverPtr,
      options.nodeA,
      options.nodeB,
      options.nodeC,
      options.nodeDcPos,
      options.nodeDcNeg,
      modeCode,
      options.freqHz ?? 60.0,
      options.modulationIndex ?? 0.85,
      options.firingAngleDeg ?? 15.0,
      options.nSubmodulesPerArm ?? 20,
      options.cSubmoduleFarad ?? 0.01,
      options.vSmInitVolts ?? 2000.0,
      options.lArmHenry ?? 0.05,
      options.rArmOhm ?? 0.5,
    );
  }

  /**
   * Returns instantaneous DC-link voltage (kV) for the specified converter bridge index.
   */
  public getConverterDcVoltageKv(convIdx: number): number {
    if (typeof this.wasm.emt_get_converter_dc_voltage_kv === "function") {
      return this.wasm.emt_get_converter_dc_voltage_kv(this.solverPtr, convIdx);
    }
    return 0.0;
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
   * Resets simulation time and history currents to zero without reallocating WASM arena memory.
   */
  public reset(): void {
    if (typeof this.wasm.emt_reset === "function") {
      this.wasm.emt_reset(this.solverPtr);
    }
  }

  /**
   * Pre-allocates a continuous trajectory buffer in WASM linear memory
   * for zero-copy streaming of simulation results.
   */
  public allocateTrajectory(maxSteps: number): void {
    if (this.trajectoryPtr !== 0 && maxSteps <= this.maxTrajectorySteps) {
      this.reset();
      return;
    }
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
   * Returns total number of LU factorizations performed during the simulation.
   */
  public getFactorizationCount(): number {
    if (typeof this.wasm.emt_get_factorization_count === "function") {
      return this.wasm.emt_get_factorization_count(this.solverPtr);
    }
    return 1;
  }

  /**
   * Returns current branch current for the specified branch index.
   */
  public getBranchCurrent(branchIdx: number): number {
    return this.wasm.emt_get_branch_current(this.solverPtr, branchIdx);
  }

  /**
   * Returns cumulative absorbed energy (Joules) for the specified MOV surge arrester index.
   */
  public getArresterEnergy(arrIdx: number): number {
    if (typeof this.wasm.emt_get_arrester_energy === "function") {
      return this.wasm.emt_get_arrester_energy(this.solverPtr, arrIdx);
    }
    return 0;
  }

  /**
   * Returns current per-unit rotor speed (omega / omega_sync) for the specified synchronous machine index.
   */
  public getMachineSpeedPu(macIdx: number): number {
    if (typeof this.wasm.emt_get_machine_speed_pu === "function") {
      return this.wasm.emt_get_machine_speed_pu(this.solverPtr, macIdx);
    }
    return 1.0;
  }

  /**
   * Returns current rotor power angle delta (degrees) for the specified synchronous machine index.
   */
  public getMachineAngleDeg(macIdx: number): number {
    if (typeof this.wasm.emt_get_machine_angle_deg === "function") {
      return this.wasm.emt_get_machine_angle_deg(this.solverPtr, macIdx);
    }
    return 0.0;
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
      factorizationCount: this.getFactorizationCount(),
      totalNonlinearIterations: this.getTotalNonlinearIterations(),
      simulatedTimeSec: this.getTime(),
      executionTimeMs,
      stepsPerSecond,
      timePoints,
      voltages,
    };
  }
}
