// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SUNDIALS WASM Solver — TypeScript wrapper and Direct In-WASM DAE & FMU Bridges.
 *
 * Provides high-performance ODE and DAE integration using LLNL SUNDIALS (CVODE / IDA / KINSOL).
 * Supports:
 *   1. Direct zero-trampoline In-WASM DaeBuilder integration with exact Dual AD Jacobians.
 *   2. Direct compiled FMI 2.0 / FMI 3.0 WebAssembly FMU state integration.
 *   3. Custom user-defined JavaScript callback bridging.
 */

/** Low-level Emscripten WebAssembly module interface for compiled LLNL SUNDIALS (CVODE / IDA / KINSOL). */
export interface SundialsEmscriptenModule {
  /** Allocates `size` bytes on the WebAssembly linear memory heap. */
  _malloc(size: number): number;
  /** Frees a previously allocated pointer on the WebAssembly linear memory heap. */
  _free(ptr: number): void;
  /** Unsigned 8-bit byte view of the WebAssembly linear memory heap. */
  HEAPU8: Uint8Array;
  /** 64-bit floating-point view of the WebAssembly linear memory heap. */
  HEAPF64: Float64Array;
  /** 32-bit signed integer view of the WebAssembly linear memory heap. */
  HEAP32: Int32Array;
  /** Registers a JavaScript callback in the WebAssembly indirect function table and returns its function pointer. */
  addFunction(fn: (...args: number[]) => number, signature: string): number;
  /** Unregisters a previously added callback function pointer from the WebAssembly table. */
  removeFunction(ptr: number): void;
  /** Invokes a compiled C export by name with automatic type marshaling. */
  ccall(name: string, returnType: string | null, argTypes: string[], args: (number | string)[]): number;
}

/** Configuration options for SUNDIALS CVODE / IDA WebAssembly integrators. */
export interface SundialsWasmOptions {
  /** Scalar absolute error tolerance (default: `1e-8`). */
  atol?: number | undefined;
  /** Scalar relative error tolerance (default: `1e-6`). */
  rtol?: number | undefined;
  /** Maximum number of internal solver steps per output interval (default: `50000`). */
  maxSteps?: number | undefined;
  /** Maximum permitted internal step size. */
  maxStep?: number | undefined;
  /** Whether to supply an exact analytical Jacobian (via Dual AD) instead of internal difference quotients. */
  useExactJacobian?: boolean | undefined;
  /** Linear solver backend used inside Newton iterations (`"auto"`, `"dense"`, `"band"`, `"klu"`, or `"spgmr"`). */
  linearSolver?: "auto" | "dense" | "band" | "klu" | "spgmr" | undefined;
  /** Upper half-bandwidth $m_u$ when `linearSolver === "band"`. */
  mu?: number | undefined;
  /** Lower half-bandwidth $m_l$ when `linearSolver === "band"`. */
  ml?: number | undefined;
  /** Estimated number of nonzeros when `linearSolver === "klu"`. */
  nnz?: number | undefined;
}

/**
 * Callback signature for evaluating the ODE right-hand side $\dot{y} = f(t, y)$.
 * Writes derivatives into `ydot` in-place and returns `0` on success.
 */
export type RhsFunction = (t: number, y: Float64Array, ydot: Float64Array) => number;

/**
 * Callback signature for evaluating rootfinding / zero-crossing event indicators $g(t, y)$.
 * Writes indicator values into `gout` in-place and returns `0` on success.
 */
export type EventFunction = (t: number, y: Float64Array, gout: Float64Array) => number;

/** Trajectory and convergence result returned by high-level SUNDIALS simulation helpers. */
export interface SundialsSimulationResult {
  /** Monotonically increasing simulation time points $t_k$. */
  times: number[];
  /** State trajectories keyed by variable identifier (e.g., `x_0`, `x_1`, ...). */
  trajectories: Record<string, number[]>;
  /** Total number of communication steps completed. */
  stepCount: number;
  /** True if the solver reached `stopTime` without integration failure. */
  converged: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Classical / Callback-based CVODE Solver
// ─────────────────────────────────────────────────────────────────────────────

/** Resolves a `Float64Array` view over the current WebAssembly linear memory buffer of a SUNDIALS module. */
function getHeapF64(module: any): Float64Array {
  const buf = module.wasmMemory?.buffer ?? module.HEAPU8?.buffer ?? module.HEAPF64?.buffer ?? module.buffer;
  if (!buf) throw new Error("Unable to locate WASM memory buffer in SUNDIALS module");
  return new Float64Array(buf);
}

/**
 * Variable-order, variable-step BDF / Adams ODE solver wrapping LLNL SUNDIALS CVODE in WebAssembly.
 *
 * Supports user-supplied JavaScript right-hand side and rootfinding (zero-crossing) callbacks,
 * configurable linear solvers (dense, banded, KLU sparse, SPGMR Krylov), and in-place state reinitialization.
 */
export class CvodeSolver {
  /** Underlying SUNDIALS Emscripten WebAssembly module. */
  private module: SundialsEmscriptenModule;
  /** Function-table pointers registered via `addFunction` to be freed on {@link dispose}. */
  private registeredFunctions: number[] = [];
  /** Opaque C pointer to the allocated CVODE solver context in WASM memory. */
  private ctxPtr: number = 0;

  /** Number of continuous state variables $n$. */
  public nStates: number;
  /** Number of zero-crossing rootfinding event indicator functions. */
  public nEvents: number;

  // Pointers
  /** Pointer to the initial/reinitialized state vector $y_0$ in WASM linear memory. */
  private y0Ptr: number;
  /** Pointer to the scalar return time `tRet` written by `cvode_step`. */
  private tRetPtr: number;
  /** Pointer to the output state vector $y(t_{\text{ret}})$ written by `cvode_step`. */
  private yRetPtr: number;

  // Memory views for callbacks
  /** Cached subarray view of the current state vector passed into the RHS/event callback. */
  private _callbackY!: Float64Array;
  /** Cached subarray view of the derivative output vector passed into the RHS callback. */
  private _callbackYDot!: Float64Array;
  /** Cached subarray view of the event indicator output vector passed into the event callback. */
  private _callbackGout!: Float64Array;

  /**
   * Initializes a new SUNDIALS CVODE solver instance in WebAssembly linear memory.
   *
   * @param module   Initialized SUNDIALS Emscripten module.
   * @param nStates  Number of continuous state variables.
   * @param t0       Initial simulation time $t_0$.
   * @param y0       Initial state vector $y(t_0)$ of length `nStates`.
   * @param rhsFn    Right-hand side evaluation callback $\dot{y} = f(t, y)$.
   * @param nEvents  Number of rootfinding event indicators (default: `0`).
   * @param eventFn  Optional rootfinding event indicator callback $g(t, y)$.
   * @param options  Tolerances and linear solver options.
   */
  constructor(
    module: SundialsEmscriptenModule,
    nStates: number,
    t0: number,
    y0: number[],
    rhsFn: RhsFunction,
    nEvents: number = 0,
    eventFn?: EventFunction,
    options?: SundialsWasmOptions,
  ) {
    this.module = module;
    this.nStates = nStates;
    this.nEvents = nEvents;

    const atol = options?.atol ?? 1e-8;
    const rtol = options?.rtol ?? 1e-6;

    this.y0Ptr = module._malloc(nStates * 8);
    const heapF64 = getHeapF64(module);
    for (let i = 0; i < nStates; i++) heapF64[(this.y0Ptr >> 3) + i] = y0[i] ?? 0;

    this.tRetPtr = module._malloc(8);
    this.yRetPtr = module._malloc(nStates * 8);

    // Register RHS Callback
    const rhsCallback = (t: number, yWasm: number, ydotWasm: number, _userData: number): number => {
      const h64 = getHeapF64(module);
      const yIdx = yWasm >> 3;
      const ydotIdx = ydotWasm >> 3;
      this._callbackY = h64.subarray(yIdx, yIdx + nStates);
      this._callbackYDot = h64.subarray(ydotIdx, ydotIdx + nStates);
      return rhsFn(t, this._callbackY, this._callbackYDot);
    };
    const rhsFnPtr = module.addFunction(rhsCallback, "idiii");
    this.registeredFunctions.push(rhsFnPtr);

    // Register Event Callback
    let eventFnPtr = 0;
    if (nEvents > 0 && eventFn) {
      const eventCallback = (t: number, yWasm: number, goutPtr: number, _userData: number): number => {
        const h64 = getHeapF64(module);
        const yIdx = yWasm >> 3;
        const gIdx = goutPtr >> 3;
        this._callbackY = h64.subarray(yIdx, yIdx + nStates);
        this._callbackGout = h64.subarray(gIdx, gIdx + nEvents);
        return eventFn(t, this._callbackY, this._callbackGout);
      };
      eventFnPtr = module.addFunction(eventCallback, "idiii");
      this.registeredFunctions.push(eventFnPtr);
    }

    // Linear solver selection: 0=auto, 1=dense, 2=band, 3=klu, 4=spgmr
    let solverType = 0;
    if (options?.linearSolver === "dense") solverType = 1;
    else if (options?.linearSolver === "band") solverType = 2;
    else if (options?.linearSolver === "klu") solverType = 3;
    else if (options?.linearSolver === "spgmr") solverType = 4;

    const defaultBand = Math.max(1, Math.min(Math.max(nStates - 1, 1), 5));
    const mu = options?.mu ?? defaultBand;
    const ml = options?.ml ?? defaultBand;
    const nnz = options?.nnz ?? 3 * nStates;

    // Call cvode_init_advanced or cvode_init
    if ((module as any)._cvode_init_advanced) {
      this.ctxPtr = (module as any)._cvode_init_advanced(
        nStates,
        solverType,
        mu,
        ml,
        nnz,
        0, // jac_fn_ptr
        t0,
        this.y0Ptr,
        rhsFnPtr,
        nEvents,
        eventFnPtr,
        rtol,
        atol,
      );
    } else if ((module as any)._cvode_init) {
      this.ctxPtr = (module as any)._cvode_init(nStates, t0, this.y0Ptr, rhsFnPtr, nEvents, eventFnPtr, rtol, atol);
    } else {
      this.ctxPtr = module.ccall(
        "cvode_init",
        "number",
        ["number", "number", "number", "number", "number", "number", "number", "number"],
        [nStates, t0, this.y0Ptr, rhsFnPtr, nEvents, eventFnPtr, rtol, atol],
      );
    }

    if (!this.ctxPtr) {
      throw new Error("Failed to initialize CVODE context");
    }
  }

  /**
   * Advances the CVODE integrator toward target time `tOut` (`CV_NORMAL` mode).
   *
   * @param tOut Target output time.
   * @returns Object containing the CVODE return `flag` (`0` = `CV_SUCCESS`, `2` = `CV_ROOT_RETURN`, `< 0` = error),
   *          the actual time `t` reached, and the state vector `y` at time `t`.
   */
  step(tOut: number): { flag: number; t: number; y: number[] } {
    const flag = (this.module as any)._cvode_step
      ? (this.module as any)._cvode_step(this.ctxPtr, tOut, this.tRetPtr, this.yRetPtr)
      : this.module.ccall(
          "cvode_step",
          "number",
          ["number", "number", "number", "number"],
          [this.ctxPtr, tOut, this.tRetPtr, this.yRetPtr],
        );

    const heapF64 = getHeapF64(this.module);
    const t = heapF64[this.tRetPtr >> 3] ?? 0;
    const y: number[] = new Array(this.nStates);
    for (let i = 0; i < this.nStates; i++) {
      y[i] = heapF64[(this.yRetPtr >> 3) + i] ?? 0;
    }

    return { flag, t, y };
  }

  /**
   * Reinitializes the CVODE BDF history at time `t` with a modified state vector `y`
   * (typically invoked after handling a discrete `reinit` event at a zero-crossing).
   *
   * @param t Current simulation time.
   * @param y Updated state vector of length `nStates`.
   */
  reinit(t: number, y: number[]): void {
    const heapF64 = getHeapF64(this.module);
    for (let i = 0; i < this.nStates; i++) {
      heapF64[(this.y0Ptr >> 3) + i] = y[i] ?? 0;
    }
    if ((this.module as any)._cvode_reinit) {
      (this.module as any)._cvode_reinit(this.ctxPtr, t, this.y0Ptr);
    } else {
      this.module.ccall("cvode_reinit", "void", ["number", "number", "number"], [this.ctxPtr, t, this.y0Ptr]);
    }
  }

  /**
   * Frees the native CVODE solver context, WASM heap buffers, and registered function-table callbacks.
   */
  dispose(): void {
    if (this.ctxPtr) {
      if ((this.module as any)._cvode_free) {
        (this.module as any)._cvode_free(this.ctxPtr);
      } else {
        this.module.ccall("cvode_free", "void", ["number"], [this.ctxPtr]);
      }
      this.ctxPtr = 0;
    }
    this.module._free(this.y0Ptr);
    this.module._free(this.tRetPtr);
    this.module._free(this.yRetPtr);
    for (const ptr of this.registeredFunctions) {
      try {
        this.module.removeFunction(ptr);
      } catch {}
    }
    this.registeredFunctions = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Direct In-WASM DaeBuilder CVODE Solver (Zero-Trampoline)
// ─────────────────────────────────────────────────────────────────────────────

/** Options for direct In-WASM DAE arena integration with CVODE. */
export interface CvodeDaeOptions extends SundialsWasmOptions {
  /** Simulation start time $t_0$ (default: `0.0`). */
  startTime?: number | undefined;
  /** Simulation stop time $t_{\text{end}}$ (default: `1.0`). */
  stopTime?: number | undefined;
  /** Output communication step size $\Delta t$ (default: `0.01`). */
  stepSize?: number | undefined;
  /** Variable index of `time` in the DAE arena variable buffer (default: `0`). */
  timeVarId?: number | undefined;
  /** Optional topologically sorted algebraic BLT blocks to evaluate before state derivatives. */
  algebraicBlocks?: { varId: number; exprId: number }[] | undefined;
}

/**
 * Direct In-WASM DAE arena CVODE solver that evaluates algebraic BLT blocks and
 * state derivative expressions directly inside the WebAssembly DAE runtime (`dae_evalExpr`).
 */
export class CvodeDaeDirectSolver {
  /** Underlying CVODE solver instance. */
  private cvode: CvodeSolver;
  /** Exported functions and linear memory of the DAE runtime WASM instance. */
  public wasmExports: any;
  /** Pointer to the DAE arena struct in WASM linear memory. */
  private daePtr: number;
  /** Variable indices of the continuous states in the DAE arena. */
  private stateVarIds: number[];
  /** Expression IDs for the state derivatives $\dot{x}_i$ in the DAE arena. */
  private derivEqIds: number[];
  /** Variable index of `time` in the DAE arena. */
  private timeVarId: number;
  /** Topologically sorted algebraic blocks evaluated before derivatives. */
  private algebraicBlocks: { varId: number; exprId: number }[];
  /** Allocated scratch pointer in WASM linear memory for variable values. */
  private varValuesPtr: number = 0;
  /** Deallocator function if `varValuesPtr` was heap-allocated. */
  private freeScratchFn: ((ptr: number) => void) | null = null;

  /**
   * Creates a direct In-WASM DAE CVODE solver.
   *
   * @param sundialsModule Initialized SUNDIALS Emscripten module.
   * @param wasmExports    Exports of the DAE runtime WebAssembly module.
   * @param daePtr         Pointer to the DAE arena in WASM memory.
   * @param stateVarIds    Arena variable IDs for the state vector.
   * @param derivEqIds     Arena expression IDs for the state derivatives.
   * @param t0             Initial simulation time.
   * @param y0             Initial state values.
   * @param options        CVODE and DAE integration options.
   */
  constructor(
    sundialsModule: SundialsEmscriptenModule,
    wasmExports: any,
    daePtr: number,
    stateVarIds: number[],
    derivEqIds: number[],
    t0: number,
    y0: number[],
    options: CvodeDaeOptions = {},
  ) {
    this.wasmExports = wasmExports;
    this.daePtr = daePtr;
    this.stateVarIds = stateVarIds;
    this.derivEqIds = derivEqIds;
    this.timeVarId = options.timeVarId ?? 0;
    this.algebraicBlocks = options.algebraicBlocks ?? [];

    const nStates = stateVarIds.length;
    let maxVarId = Math.max(
      typeof wasmExports?.dae_getVarCount === "function"
        ? Number(wasmExports.dae_getVarCount(daePtr)) || 0
        : Number(wasmExports?.varCount) || 0,
      this.timeVarId,
    );
    for (let i = 0; i < stateVarIds.length; i++) {
      if ((stateVarIds[i] ?? 0) > maxVarId) maxVarId = stateVarIds[i]!;
    }
    for (const blk of this.algebraicBlocks) {
      if (blk.varId > maxVarId) {
        maxVarId = blk.varId;
      }
    }
    const scratchBytes = Math.max(4096, maxVarId + 64) * 8;
    if (typeof wasmExports.atomicChunkAlloc === "function") {
      this.varValuesPtr = wasmExports.atomicChunkAlloc(scratchBytes);
      if (typeof wasmExports.atomicChunkFree === "function") {
        this.freeScratchFn = (ptr) => wasmExports.atomicChunkFree(ptr);
      }
    } else if (typeof wasmExports._malloc === "function") {
      this.varValuesPtr = wasmExports._malloc(scratchBytes);
      if (typeof wasmExports._free === "function") {
        this.freeScratchFn = (ptr) => wasmExports._free(ptr);
      }
    } else if (typeof wasmExports.malloc === "function") {
      this.varValuesPtr = wasmExports.malloc(scratchBytes);
      if (typeof wasmExports.free === "function") {
        this.freeScratchFn = (ptr) => wasmExports.free(ptr);
      }
    } else if (typeof wasmExports.__new === "function") {
      this.varValuesPtr = wasmExports.__new(scratchBytes, 0);
    } else if (wasmExports.memory instanceof WebAssembly.Memory) {
      const pagesNeeded = Math.max(1, Math.ceil(scratchBytes / 65536));
      const prevPages = wasmExports.memory.grow(pagesNeeded);
      this.varValuesPtr = prevPages * 65536;
    } else {
      throw new Error("WASM exports must provide an allocator or growable WebAssembly.Memory for DAE scratch values.");
    }

    const varValuesPtr = this.varValuesPtr;

    const rhsFn: RhsFunction = (t: number, y: Float64Array, ydot: Float64Array): number => {
      // 1. Set time in WASM memory
      const mem64 = new Float64Array(wasmExports.memory.buffer);
      if (this.timeVarId >= 0) {
        mem64[(varValuesPtr >> 3) + this.timeVarId] = t;
      }

      // 2. Set state variables in WASM memory
      for (let i = 0; i < nStates; i++) {
        const vId = this.stateVarIds[i]!;
        mem64[(varValuesPtr >> 3) + vId] = y[i] ?? 0;
      }

      // 3. Evaluate algebraic BLT blocks before evaluating state derivatives
      if (typeof wasmExports.dae_evalBlocks === "function") {
        wasmExports.dae_evalBlocks(this.daePtr, varValuesPtr);
      }
      if (this.algebraicBlocks.length > 0 && typeof wasmExports.dae_evalExpr === "function") {
        for (let b = 0; b < this.algebraicBlocks.length; b++) {
          const blk = this.algebraicBlocks[b]!;
          mem64[(varValuesPtr >> 3) + blk.varId] = wasmExports.dae_evalExpr(this.daePtr, blk.exprId, varValuesPtr);
        }
      }

      // 4. Direct In-WASM expression evaluation of state derivatives
      for (let i = 0; i < nStates; i++) {
        const eqId = this.derivEqIds[i]!;
        ydot[i] = wasmExports.dae_evalExpr ? wasmExports.dae_evalExpr(this.daePtr, eqId, varValuesPtr) : 0.0;
      }

      return 0; // CV_SUCCESS
    };

    this.cvode = new CvodeSolver(sundialsModule, nStates, t0, y0, rhsFn, 0, undefined, options);
  }

  /** Advances the DAE integration toward `tOut` and returns the solver flag, reached time, and state vector. */
  step(tOut: number): { flag: number; t: number; y: number[] } {
    return this.cvode.step(tOut);
  }

  /** Reinitializes the underlying CVODE solver at time `t` with updated state vector `y`. */
  reinit(t: number, y: number[]): void {
    this.cvode.reinit(t, y);
  }

  /** Releases all native CVODE resources and WASM allocations. */
  dispose(): void {
    this.cvode.dispose();
    if (this.varValuesPtr && this.freeScratchFn) {
      try {
        this.freeScratchFn(this.varValuesPtr);
      } catch {}
      this.varValuesPtr = 0;
      this.freeScratchFn = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Direct Compiled FMU CVODE Solver (Zero-Trampoline)
// ─────────────────────────────────────────────────────────────────────────────

/** Options for integrating a compiled FMI 2.0 / 3.0 Model-Exchange FMU with CVODE. */
export interface CvodeFmuOptions extends SundialsWasmOptions {
  /** Simulation start time $t_0$. */
  startTime?: number | undefined;
  /** Simulation stop time $t_{\text{end}}$. */
  stopTime?: number | undefined;
  /** Communication step size $\Delta t$. */
  stepSize?: number | undefined;
  /** Number of FMI event indicators exposed by the FMU (`getEventIndicators`). */
  nEvents?: number | undefined;
}

/**
 * Direct CVODE integrator for compiled FMI 2.0 / FMI 3.0 Model-Exchange FMU instances,
 * bridging `fmiSetTime`, `setContinuousStates`, `getDerivatives`, and `getEventIndicators`.
 */
export class CvodeFmuDirectSolver {
  /** Underlying CVODE solver instance. */
  private cvode: CvodeSolver;

  /**
   * Creates a CVODE integrator bound to an FMI Model-Exchange instance.
   *
   * @param sundialsModule Initialized SUNDIALS Emscripten module.
   * @param fmuInstance    FMI 2.0 / 3.0 Model-Exchange instance.
   * @param nStates        Number of continuous states in the FMU.
   * @param t0             Initial simulation time.
   * @param y0             Initial continuous state vector.
   * @param options        CVODE and FMU event options.
   */
  constructor(
    sundialsModule: SundialsEmscriptenModule,
    fmuInstance: any,
    nStates: number,
    t0: number,
    y0: number[],
    options: CvodeFmuOptions = {},
  ) {
    const rhsFn: RhsFunction = (t: number, y: Float64Array, ydot: Float64Array): number => {
      if (fmuInstance.fmiSetTime) fmuInstance.fmiSetTime(t);
      if (fmuInstance.setContinuousStates) fmuInstance.setContinuousStates(y);
      if (fmuInstance.getDerivatives) {
        const der = fmuInstance.getDerivatives();
        for (let i = 0; i < nStates; i++) ydot[i] = der[i] ?? 0;
      }
      return 0;
    };

    const nEvents = options.nEvents ?? 0;
    let eventFn: EventFunction | undefined = undefined;

    if (nEvents > 0 && fmuInstance.getEventIndicators) {
      eventFn = (_t: number, _y: Float64Array, gout: Float64Array): number => {
        const ind = fmuInstance.getEventIndicators();
        for (let i = 0; i < nEvents; i++) gout[i] = ind[i] ?? 0;
        return 0;
      };
    }

    this.cvode = new CvodeSolver(sundialsModule, nStates, t0, y0, rhsFn, nEvents, eventFn, options);
  }

  /** Advances the FMU state toward `tOut` using CVODE. */
  step(tOut: number): { flag: number; t: number; y: number[] } {
    return this.cvode.step(tOut);
  }

  /** Reinitializes the CVODE integrator at time `t` with updated FMU continuous states `y`. */
  reinit(t: number, y: number[]): void {
    this.cvode.reinit(t, y);
  }

  /** Releases all native CVODE resources and WASM allocations. */
  dispose(): void {
    this.cvode.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. High-Level Simulation Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convenience function that runs a complete DAE simulation from `startTime` to `stopTime`
 * using {@link CvodeDaeDirectSolver} and returns the collected state trajectories.
 */
export async function simulateDaeWithSundials(
  sundialsModule: SundialsEmscriptenModule,
  wasmExports: any,
  daePtr: number,
  stateVarIds: number[],
  derivEqIds: number[],
  y0: number[],
  options: CvodeDaeOptions = {},
): Promise<SundialsSimulationResult> {
  const t0 = options.startTime ?? 0.0;
  const tEnd = options.stopTime ?? 1.0;
  const dt = options.stepSize ?? 0.01;
  const n = stateVarIds.length;

  const solver = new CvodeDaeDirectSolver(
    sundialsModule,
    wasmExports,
    daePtr,
    stateVarIds,
    derivEqIds,
    t0,
    y0,
    options,
  );

  const times: number[] = [t0];
  const trajectories: Record<string, number[]> = {};
  for (let i = 0; i < n; i++) {
    trajectories[`x_${i}`] = [y0[i]!];
  }

  let t = t0;
  let steps = 0;
  const maxSteps = options.maxSteps ?? 50000;
  let converged = true;

  while (t < tEnd - 1e-12 && steps < maxSteps) {
    const nextT = Math.min(t + dt, tEnd);
    const stepRes = solver.step(nextT);

    if (stepRes.flag < 0) {
      converged = false;
      break;
    }

    t = stepRes.t;
    times.push(t);
    for (let i = 0; i < n; i++) {
      trajectories[`x_${i}`]!.push(stepRes.y[i]!);
    }
    steps++;
  }

  solver.dispose();

  return {
    times,
    trajectories,
    stepCount: steps,
    converged: converged && t >= tEnd - 1e-6,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Module Loader
// ─────────────────────────────────────────────────────────────────────────────

/** Singleton cache for the loaded SUNDIALS Emscripten WebAssembly module. */
let cachedModule: SundialsEmscriptenModule | null = null;

/**
 * Asynchronously loads and initializes the compiled LLNL SUNDIALS WebAssembly module
 * (`sundials.wasm`), caching the module instance across subsequent calls.
 *
 * @param wasmUrl Optional custom URL to `sundials.wasm` (for browser environments).
 */
export async function loadSundialsWasm(wasmUrl?: string): Promise<SundialsEmscriptenModule> {
  if (cachedModule) return cachedModule;

  const isNode = typeof globalThis.process !== "undefined" && globalThis.process.versions?.node;

  if (isNode) {
    const { fileURLToPath, pathToFileURL } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const { existsSync } = await import("node:fs");
    const currentDir = dirname(fileURLToPath(import.meta.url));

    const candidateDirs = [
      join(currentDir, "..", "wasm"),
      join(currentDir, "..", "..", "wasm"),
      join(currentDir, "..", "..", "src", "wasm"),
      join(currentDir, "..", "..", "..", "..", "wasm"),
    ];

    let wasmDir = candidateDirs.find((d) => existsSync(join(d, "sundials.js"))) ?? candidateDirs[0]!;
    const jsGlue = join(wasmDir, "sundials.js");
    const wasmBinaryPath = join(wasmDir, "sundials.wasm");

    const factoryModule = await import(pathToFileURL(jsGlue).href);
    const factory = factoryModule.default || factoryModule;
    cachedModule = await factory({
      locateFile: (p: string) => (p.endsWith(".wasm") ? wasmBinaryPath : join(wasmDir, p)),
    });
    return cachedModule!;
  }

  // Browser
  const url = wasmUrl ?? new URL(/* webpackIgnore: true */ "../../wasm/sundials.wasm", import.meta.url).href;
  const jsUrl = url.replace(/\.wasm$/, ".js");
  const factory = await import(/* webpackIgnore: true */ jsUrl);
  cachedModule = await factory.default({
    locateFile: () => url,
  });

  return cachedModule!;
}
