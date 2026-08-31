// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly Co-Simulation Orchestrator & Zero-Copy FMI Bridge.
 *
 * Provides:
 *  - High-performance multi-rate Gauss-Seidel and Jacobi co-simulation orchestration in WASM linear memory
 *  - Zero-copy variable coupling propagation between FMI 2.0 and FMI 3.0 FMU instances
 *  - Algebraic loop relaxation and convergence checking
 *  - Direct integration between @modelscript/language/cosim and in-memory WASM FMUs
 */

/** Co-simulation coupling method. */
export type WasmCosimMethod = "jacobi" | "gauss-seidel";

/** Configuration for the WASM Co-Simulation Orchestrator. */
export interface WasmCosimConfig {
  /** Master algorithm method (default: "gauss-seidel"). */
  method?: WasmCosimMethod;
  /** Maximum Gauss-Seidel iterations per step (default: 10). */
  maxIterations?: number;
  /** Convergence tolerance for coupled variables (default: 1e-6). */
  tolerance?: number;
  /** Gauss-Seidel relaxation factor in (0, 1] (default: 1.0). */
  relaxation?: number;
}

/** Participant connection spec for WASM co-simulation. */
export interface WasmParticipantSpec {
  /** Memory pointer to the Fmi2Instance or Fmi3Instance. */
  instancePtr: number;
  /** FMI standard version: 2 for FMI 2.0, 3 for FMI 3.0. */
  fmiVersion: 2 | 3;
  /** Integer step ratio for multi-rate stepping (default: 1). */
  stepRatio?: number;
}

/** Direct variable coupling connection between FMU instances. */
export interface WasmCouplingSpec {
  srcInstancePtr: number;
  srcVr: number;
  srcFmiVersion?: 2 | 3;
  dstInstancePtr: number;
  dstVr: number;
  dstFmiVersion?: 2 | 3;
  /** Linear scaling factor: dst = src * scale + offset (default: 1.0). */
  scale?: number;
  /** Linear offset (default: 0.0). */
  offset?: number;
}

/**
 * In-memory WASM Co-Simulation Engine.
 * Executes co-simulation steps with zero-copy buffer exchange.
 */
export class WasmCosimEngine {
  private readonly exports: any;
  public readonly orchestratorPtr: number;

  constructor(wasmExports: any, config?: WasmCosimConfig) {
    this.exports = wasmExports;
    const methodInt = config?.method === "jacobi" ? 0 : 1;
    const maxIter = config?.maxIterations ?? 10;
    const tol = config?.tolerance ?? 1e-6;
    const relax = config?.relaxation ?? 1.0;

    if (typeof this.exports.cosimCreateOrchestrator === "function") {
      this.orchestratorPtr = this.exports.cosimCreateOrchestrator(methodInt, maxIter, tol, relax);
    } else {
      this.orchestratorPtr = 0;
    }
  }

  /**
   * Register an FMU participant in the WASM orchestrator.
   */
  addParticipant(spec: WasmParticipantSpec): number {
    if (!this.exports.cosimAddParticipant || !this.orchestratorPtr) return -1;
    return this.exports.cosimAddParticipant(
      this.orchestratorPtr,
      spec.instancePtr,
      spec.fmiVersion,
      spec.stepRatio ?? 1,
    );
  }

  /**
   * Add a zero-copy variable coupling between two FMU instances.
   */
  addCoupling(coupling: WasmCouplingSpec): number {
    if (!this.exports.cosimAddCoupling || !this.orchestratorPtr) return -1;
    return this.exports.cosimAddCoupling(
      this.orchestratorPtr,
      coupling.srcInstancePtr,
      coupling.srcVr,
      coupling.srcFmiVersion ?? 2,
      coupling.dstInstancePtr,
      coupling.dstVr,
      coupling.dstFmiVersion ?? 2,
      coupling.scale ?? 1.0,
      coupling.offset ?? 0.0,
    );
  }

  /**
   * Advance all coupled FMU participants by one master communication step.
   */
  step(currentTime: number, communicationStepSize: number): number {
    if (!this.exports.cosimStep || !this.orchestratorPtr) return -1;
    return this.exports.cosimStep(this.orchestratorPtr, currentTime, communicationStepSize);
  }

  /**
   * Propagate all couplings and return maximum change norm.
   */
  propagateCouplings(): number {
    if (!this.exports.cosimPropagateCouplings || !this.orchestratorPtr) return 0;
    return this.exports.cosimPropagateCouplings(this.orchestratorPtr);
  }

  /**
   * Returns current participant count.
   */
  get participantCount(): number {
    if (!this.exports.cosimGetParticipantCount || !this.orchestratorPtr) return 0;
    return this.exports.cosimGetParticipantCount(this.orchestratorPtr);
  }

  /**
   * Returns current coupling count.
   */
  get couplingCount(): number {
    if (!this.exports.cosimGetCouplingCount || !this.orchestratorPtr) return 0;
    return this.exports.cosimGetCouplingCount(this.orchestratorPtr);
  }
}

/**
 * Pure TypeScript fallback emulator for WasmCosimEngine when raw WASM binary is not instantiated.
 */
export class WasmCosimEmulator {
  public participants: WasmParticipantSpec[] = [];
  public couplings: WasmCouplingSpec[] = [];
  public config: Required<WasmCosimConfig>;

  constructor(config?: WasmCosimConfig) {
    this.config = {
      method: config?.method ?? "gauss-seidel",
      maxIterations: config?.maxIterations ?? 10,
      tolerance: config?.tolerance ?? 1e-6,
      relaxation: config?.relaxation ?? 1.0,
    };
  }

  addParticipant(spec: WasmParticipantSpec): number {
    const idx = this.participants.length;
    this.participants.push({ ...spec, stepRatio: spec.stepRatio ?? 1 });
    return idx;
  }

  addCoupling(coupling: WasmCouplingSpec): number {
    const idx = this.couplings.length;
    this.couplings.push({
      scale: 1.0,
      offset: 0.0,
      srcFmiVersion: 2,
      dstFmiVersion: 2,
      ...coupling,
    });
    return idx;
  }

  step(
    currentTime: number,
    stepSize: number,
    getReal: (instancePtr: number, vr: number, fmiVersion: number) => number,
    setReal: (instancePtr: number, vr: number, fmiVersion: number, val: number) => void,
    doStep: (instancePtr: number, t: number, dt: number, fmiVersion: number) => void,
  ): void {
    // Propagate couplings
    for (const c of this.couplings) {
      const srcVal = getReal(c.srcInstancePtr, c.srcVr, c.srcFmiVersion ?? 2);
      const dstVal = srcVal * (c.scale ?? 1.0) + (c.offset ?? 0.0);
      setReal(c.dstInstancePtr, c.dstVr, c.dstFmiVersion ?? 2, dstVal);
    }

    // Step participants
    for (const p of this.participants) {
      const ratio = p.stepRatio ?? 1;
      const subDt = stepSize / ratio;
      for (let s = 0; s < ratio; s++) {
        doStep(p.instancePtr, currentTime + s * subDt, subDt, p.fmiVersion);
      }
    }

    // Final coupling propagation
    for (const c of this.couplings) {
      const srcVal = getReal(c.srcInstancePtr, c.srcVr, c.srcFmiVersion ?? 2);
      const dstVal = srcVal * (c.scale ?? 1.0) + (c.offset ?? 0.0);
      setReal(c.dstInstancePtr, c.dstVr, c.dstFmiVersion ?? 2, dstVal);
    }
  }
}
