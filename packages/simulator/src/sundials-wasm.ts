// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SUNDIALS WASM Solver — TypeScript wrapper.
 *
 * Loads a pre-compiled SUNDIALS WebAssembly module (cvodes + idas + kinsol)
 * and provides a high-level API for ODE/DAE integration with callback bridging.
 *
 * The key technique: Emscripten's `addFunction()` registers a JavaScript
 * function as a C function pointer in the WASM table, enabling SUNDIALS'
 * integration loop (running in WASM) to call back into TypeScript for
 * model evaluation (f(t, y) → dy/dt).
 */

// ── Emscripten module interface ──

interface SundialsEmscriptenModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  addFunction(fn: (...args: number[]) => number, signature: string): number;
  removeFunction(ptr: number): void;
  ccall(name: string, returnType: string | null, argTypes: string[], args: (number | string)[]): number;
}

// ── Public interface ──

/** Options for SUNDIALS WASM solvers. */
export interface SundialsWasmOptions {
  /** Absolute tolerance (default: 1e-8). */
  atol?: number;
  /** Relative tolerance (default: 1e-6). */
  rtol?: number;
  /** Maximum number of internal steps (default: 50000). */
  maxSteps?: number;
  /** Maximum step size (0 = unlimited). */
  maxStep?: number;
  /** Initial step size (0 = auto). */
  initialStep?: number;
}

/** Result of a SUNDIALS WASM integration. */
export interface SundialsWasmResult {
  /** Output time points. */
  times: number[];
  /** State vectors at each output time. */
  states: number[][];
  /** Number of RHS function evaluations. */
  fEvals: number;
  /** Number of Jacobian evaluations. */
  jEvals: number;
  /** Number of steps taken. */
  steps: number;
  /** Error message (empty on success). */
  message: string;
}

/** Result of KINSOL nonlinear solve. */
export interface KinsolWasmResult {
  /** Solution vector. */
  solution: number[];
  /** Whether the solve converged. */
  converged: boolean;
}

/** RHS function type: dy/dt = f(t, y). */
export type RhsFunction = (t: number, y: number[]) => number[];

/** Event function type: g(t, y) → scalar (sign change triggers event). */
export type EventFunction = (t: number, y: number[]) => number;

/** Event callback type. */
export type EventCallback = (t: number, y: number[], eventIdx: number) => number[];

/**
 * SUNDIALS WASM solver instance.
 *
 * Wraps a loaded Emscripten module and provides high-level methods
 * for ODE/DAE integration via CVODE/IDA and nonlinear solving via KINSOL.
 */
export class SundialsWasmSolver {
  private module: SundialsEmscriptenModule;
  private registeredFunctions: number[] = [];

  constructor(module: SundialsEmscriptenModule) {
    this.module = module;
  }

  /**
   * Integrate an ODE system using CVODE.
   *
   * The RHS function `f` runs in JavaScript — SUNDIALS' CVODE integration
   * loop (in WASM) calls back into JS for each function evaluation via
   * a registered function pointer.
   */
  cvode(
    f: RhsFunction,
    t0: number,
    y0: number[],
    tEnd: number,
    outputTimes: number[],
    options?: SundialsWasmOptions,
    eventFns?: EventFunction[],
  ): SundialsWasmResult {
    const M = this.module;
    const n = y0.length;
    const nOutputs = outputTimes.length;
    const atol = options?.atol ?? 1e-8;
    const rtol = options?.rtol ?? 1e-6;
    const maxSteps = options?.maxSteps ?? 50000;
    const maxStep = options?.maxStep ?? 0;
    const initialStep = options?.initialStep ?? 0;
    const nEvents = eventFns?.length ?? 0;

    // Allocate shared WASM memory buffers
    const yPtr = M._malloc(n * 8);
    const ydotPtr = M._malloc(n * 8);
    const outputTimesPtr = M._malloc(nOutputs * 8);
    const resultTimesPtr = M._malloc(nOutputs * 8);
    const resultStatesPtr = M._malloc(nOutputs * n * 8);
    const statsPtr = M._malloc(4 * 8);

    for (let i = 0; i < n; i++) M.HEAPF64[(yPtr >> 3) + i] = y0[i] ?? 0;
    for (let i = 0; i < nOutputs; i++) M.HEAPF64[(outputTimesPtr >> 3) + i] = outputTimes[i] ?? 0;

    // Register RHS callback: int rhs(double t, double* y, double* ydot, void* ud)
    const rhsCallback = (t: number, yWasm: number, ydotWasm: number): number => {
      const yArr: number[] = new Array(n);
      for (let i = 0; i < n; i++) yArr[i] = M.HEAPF64[(yWasm >> 3) + i] ?? 0;
      const dydt = f(t, yArr);
      for (let i = 0; i < n; i++) M.HEAPF64[(ydotWasm >> 3) + i] = dydt[i] ?? 0;
      return 0;
    };
    const rhsFnPtr = M.addFunction(rhsCallback, "iiiii");
    this.registeredFunctions.push(rhsFnPtr);

    // Register event callbacks if present
    let eventFnPtr = 0;
    if (nEvents > 0 && eventFns) {
      const eventCallback = (t: number, yWasm: number, goutPtr: number): number => {
        const yArr: number[] = new Array(n);
        for (let i = 0; i < n; i++) yArr[i] = M.HEAPF64[(yWasm >> 3) + i] ?? 0;
        for (let i = 0; i < nEvents; i++) {
          const fn = eventFns[i];
          if (fn) M.HEAPF64[(goutPtr >> 3) + i] = fn(t, yArr);
        }
        return 0;
      };
      eventFnPtr = M.addFunction(eventCallback, "iiiii");
      this.registeredFunctions.push(eventFnPtr);
    }

    // Call WASM CVODE solver
    M.ccall(
      "sundials_cvode_wasm",
      "number",
      [
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
      ],
      [
        n,
        t0,
        yPtr,
        rhsFnPtr,
        outputTimesPtr,
        nOutputs,
        eventFnPtr,
        nEvents,
        atol,
        rtol,
        maxSteps,
        maxStep,
        initialStep,
        resultTimesPtr,
        resultStatesPtr,
        statsPtr,
      ],
    );

    // Read results
    const status = M.HEAPF64[(statsPtr >> 3) + 3] ?? -1;
    const actualPoints = status >= 0 ? nOutputs : 0;
    const times: number[] = [];
    const states: number[][] = [];

    for (let k = 0; k < actualPoints; k++) {
      times.push(M.HEAPF64[(resultTimesPtr >> 3) + k] ?? 0);
      const row: number[] = new Array(n);
      for (let i = 0; i < n; i++) row[i] = M.HEAPF64[(resultStatesPtr >> 3) + k * n + i] ?? 0;
      states.push(row);
    }

    const result: SundialsWasmResult = {
      times,
      states,
      fEvals: M.HEAPF64[statsPtr >> 3] ?? 0,
      jEvals: M.HEAPF64[(statsPtr >> 3) + 1] ?? 0,
      steps: M.HEAPF64[(statsPtr >> 3) + 2] ?? 0,
      message: status >= 0 ? "" : "CVODE solver error",
    };

    M._free(yPtr);
    M._free(ydotPtr);
    M._free(outputTimesPtr);
    M._free(resultTimesPtr);
    M._free(resultStatesPtr);
    M._free(statsPtr);

    return result;
  }

  /**
   * Solve a nonlinear system F(z) = 0 using KINSOL.
   */
  kinsol(F: (z: number[]) => number[], z0: number[], options?: { atol?: number; rtol?: number }): KinsolWasmResult {
    const M = this.module;
    const n = z0.length;
    const atol = options?.atol ?? 1e-10;
    const rtol = options?.rtol ?? 1e-10;

    const zPtr = M._malloc(n * 8);
    const statusPtr = M._malloc(8);
    for (let i = 0; i < n; i++) M.HEAPF64[(zPtr >> 3) + i] = z0[i] ?? 0;

    const resFn = (zWasm: number, fvalPtr: number): number => {
      const zArr: number[] = new Array(n);
      for (let i = 0; i < n; i++) zArr[i] = M.HEAPF64[(zWasm >> 3) + i] ?? 0;
      const residual = F(zArr);
      for (let i = 0; i < n; i++) M.HEAPF64[(fvalPtr >> 3) + i] = residual[i] ?? 0;
      return 0;
    };
    const resFnPtr = M.addFunction(resFn, "iiii");
    this.registeredFunctions.push(resFnPtr);

    M.ccall(
      "sundials_kinsol_wasm",
      "number",
      ["number", "number", "number", "number", "number", "number"],
      [n, zPtr, resFnPtr, atol, rtol, statusPtr],
    );

    const status = M.HEAPF64[statusPtr >> 3] ?? -1;
    const solution: number[] = new Array(n);
    for (let i = 0; i < n; i++) solution[i] = M.HEAPF64[(zPtr >> 3) + i] ?? 0;

    M._free(zPtr);
    M._free(statusPtr);

    return { solution, converged: status >= 0 };
  }

  dispose(): void {
    for (const ptr of this.registeredFunctions) {
      try {
        this.module.removeFunction(ptr);
      } catch {
        // Module may already be disposed
      }
    }
    this.registeredFunctions = [];
  }
}

// ── Module loader ──

let cachedSolver: SundialsWasmSolver | null = null;

/** Get the currently cached SUNDIALS WASM solver, if loaded. */
export function getCachedSundialsWasm(): SundialsWasmSolver | null {
  return cachedSolver;
}

/**
 * Load the SUNDIALS WASM module and return a solver instance.
 * Cached after first load.
 *
 * @param wasmUrl Optional URL or path to the sundials.wasm file
 */
export async function loadSundialsWasm(wasmUrl?: string): Promise<SundialsWasmSolver> {
  if (cachedSolver) return cachedSolver;

  const isNode = typeof globalThis.process !== "undefined" && globalThis.process.versions?.node;

  if (isNode) {
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const wasmDir = join(currentDir, "..", "..", "wasm");
    const jsGlue = join(wasmDir, "sundials.js");

    const factory = await import(jsGlue);
    const module = await new Promise<SundialsEmscriptenModule>((resolve) => {
      const mod = factory.default({
        locateFile: (path: string) => join(wasmDir, path),
        onRuntimeInitialized: () => resolve(mod),
      });
    });

    cachedSolver = new SundialsWasmSolver(module);
    return cachedSolver;
  }

  // Browser
  const url = wasmUrl ?? new URL(/* webpackIgnore: true */ "../../wasm/sundials.wasm", import.meta.url).href;
  const jsUrl = url.replace(/\.wasm$/, ".js");
  const factory = await import(/* webpackIgnore: true */ jsUrl);
  const module = await new Promise<SundialsEmscriptenModule>((resolve) => {
    const mod = factory.default({
      locateFile: () => url,
      onRuntimeInitialized: () => resolve(mod),
    });
  });

  cachedSolver = new SundialsWasmSolver(module);
  return cachedSolver;
}
