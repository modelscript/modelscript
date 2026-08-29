// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SUNDIALS WASM Solver — TypeScript wrapper.
 *
 * Loads a pre-compiled SUNDIALS WebAssembly module (cvode)
 * and provides a high-level stateful API for ODE/DAE integration with callback bridging.
 */

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

export interface SundialsWasmOptions {
  atol?: number;
  rtol?: number;
}

export type RhsFunction = (t: number, y: Float64Array, ydot: Float64Array) => number;
export type EventFunction = (t: number, y: Float64Array, gout: Float64Array) => number;

export class CvodeSolver {
  private module: SundialsEmscriptenModule;
  private registeredFunctions: number[] = [];
  private ctxPtr: number = 0;

  public nStates: number;
  private nEvents: number;

  // Pointers
  private y0Ptr: number;
  private tRetPtr: number;
  private yRetPtr: number;

  // Memory views for callbacks
  private _callbackY!: Float64Array;
  private _callbackYDot!: Float64Array;
  private _callbackGout!: Float64Array;

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
    for (let i = 0; i < nStates; i++) module.HEAPF64[(this.y0Ptr >> 3) + i] = y0[i] ?? 0;

    this.tRetPtr = module._malloc(8);
    this.yRetPtr = module._malloc(nStates * 8);

    // Register RHS Callback
    const rhsCallback = (t: number, yWasm: number, ydotWasm: number): number => {
      // Re-initialize views to point at WASM memory (in case heap grew)
      this._callbackY = new Float64Array(module.HEAPF64.buffer, yWasm, nStates);
      this._callbackYDot = new Float64Array(module.HEAPF64.buffer, ydotWasm, nStates);
      return rhsFn(t, this._callbackY, this._callbackYDot);
    };
    const rhsFnPtr = module.addFunction(rhsCallback, "idii");
    this.registeredFunctions.push(rhsFnPtr);

    // Register Event Callback
    let eventFnPtr = 0;
    if (nEvents > 0 && eventFn) {
      const eventCallback = (t: number, yWasm: number, goutPtr: number): number => {
        this._callbackY = new Float64Array(module.HEAPF64.buffer, yWasm, nStates);
        this._callbackGout = new Float64Array(module.HEAPF64.buffer, goutPtr, nEvents);
        return eventFn(t, this._callbackY, this._callbackGout);
      };
      eventFnPtr = module.addFunction(eventCallback, "idii");
      this.registeredFunctions.push(eventFnPtr);
    }

    // Call cvode_init
    this.ctxPtr = module.ccall(
      "cvode_init",
      "number",
      ["number", "number", "number", "number", "number", "number", "number", "number"],
      [nStates, t0, this.y0Ptr, rhsFnPtr, nEvents, eventFnPtr, rtol, atol],
    );

    if (!this.ctxPtr) {
      throw new Error("Failed to initialize CVODE context");
    }
  }

  /**
   * Step to tOut.
   * Returns:
   *   { flag, t, y }
   * flag is 2 for CV_ROOT_RETURN, 0 for CV_SUCCESS, <0 for error
   */
  step(tOut: number): { flag: number; t: number; y: number[] } {
    const flag = this.module.ccall(
      "cvode_step",
      "number",
      ["number", "number", "number", "number"],
      [this.ctxPtr, tOut, this.tRetPtr, this.yRetPtr],
    );

    const t = this.module.HEAPF64[this.tRetPtr >> 3] ?? 0;
    const y: number[] = new Array(this.nStates);
    for (let i = 0; i < this.nStates; i++) {
      y[i] = this.module.HEAPF64[(this.yRetPtr >> 3) + i] ?? 0;
    }

    return { flag, t, y };
  }

  /**
   * Reinitialize solver after state mutation (e.g. events)
   */
  reinit(t: number, y: number[]) {
    for (let i = 0; i < this.nStates; i++) {
      this.module.HEAPF64[(this.y0Ptr >> 3) + i] = y[i] ?? 0;
    }
    this.module.ccall("cvode_reinit", "void", ["number", "number", "number"], [this.ctxPtr, t, this.y0Ptr]);
  }

  dispose(): void {
    if (this.ctxPtr) {
      this.module.ccall("cvode_free", "void", ["number"], [this.ctxPtr]);
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

let cachedModule: SundialsEmscriptenModule | null = null;

export async function loadSundialsWasm(wasmUrl?: string): Promise<SundialsEmscriptenModule> {
  if (cachedModule) return cachedModule;

  const isNode = typeof globalThis.process !== "undefined" && globalThis.process.versions?.node;

  if (isNode) {
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const { createRequire } = await import("node:module");
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const wasmDir = join(currentDir, "..", "..", "wasm");
    const jsGlue = join(wasmDir, "sundials.js");
    const { readFileSync } = await import("node:fs");
    const code = readFileSync(jsGlue, "utf8");
    const mod = { exports: {} as any };
    const func = new Function("module", "exports", "require", "__dirname", "__filename", code);
    func(mod, mod.exports, createRequire(import.meta.url), wasmDir, jsGlue);
    const factory = mod.exports.default || mod.exports;
    cachedModule = await factory({
      locateFile: (path: string) => join(wasmDir, path),
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
