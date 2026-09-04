// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * COIN-OR WASM Solver — TypeScript wrapper.
 *
 * Loads a pre-compiled COIN-OR WebAssembly module (IPOPT + CLP + CBC)
 * and provides a high-level API for optimization with callback bridging.
 */

// ── Emscripten module interface ──

interface CoinorEmscriptenModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  addFunction(fn: (...args: number[]) => number, signature: string): number;
  removeFunction(ptr: number): void;
  ccall(name: string, returnType: string | null, argTypes: string[], args: (number | string)[]): number;
}

// ── Public interface ──

export interface IpoptWasmOptions {
  tolerance?: number;
  maxIterations?: number;
  printLevel?: number;
}

export interface IpoptWasmResult {
  solution: number[];
  objectiveValue: number;
  multipliers: number[];
  status: number;
  message: string;
}

export interface LpWasmOptions {
  tolerance?: number;
  maxIterations?: number;
  printLevel?: number;
}

export interface LpWasmResult {
  solution: number[];
  objectiveValue: number;
  iterations: number;
  status: number;
  message: string;
}

export interface LpProblem {
  nVars: number;
  nConstraints: number;
  objCoeffs: number[];
  varLB: number[];
  varUB: number[];
  conLB: number[];
  conUB: number[];
  A: { values: number[]; rowIndices: number[]; colPointers: number[] };
  isInteger?: boolean[];
}

/**
 * COIN-OR WASM solver instance.
 */
export class CoinorWasmSolver {
  private module: CoinorEmscriptenModule;
  private registeredFunctions: number[] = [];

  constructor(module: CoinorEmscriptenModule) {
    this.module = module;
  }

  /**
   * Solve a nonlinear program using IPOPT.
   */
  ipopt(
    nVars: number,
    nConstraints: number,
    x0: number[],
    varLB: number[],
    varUB: number[],
    conLB: number[],
    conUB: number[],
    evalObjective: (x: number[]) => number,
    evalGradient: (x: number[]) => number[],
    evalConstraints: (x: number[]) => number[],
    evalJacobian: (x: number[]) => number[],
    nnzJacobian: number,
    options?: IpoptWasmOptions,
  ): IpoptWasmResult {
    const M = this.module;
    const tol = options?.tolerance ?? 1e-8;
    const maxIter = options?.maxIterations ?? 3000;
    const printLevel = options?.printLevel ?? 0;

    const xPtr = M._malloc(nVars * 8);
    const varLBPtr = M._malloc(nVars * 8);
    const varUBPtr = M._malloc(nVars * 8);
    const conLBPtr = M._malloc(nConstraints * 8);
    const conUBPtr = M._malloc(nConstraints * 8);
    const resultPtr = M._malloc(nVars * 8);
    const mulPtr = M._malloc(nConstraints * 8);
    const objPtr = M._malloc(8);
    const statusPtr = M._malloc(8);

    this.writeF64(xPtr, x0);
    this.writeF64(varLBPtr, varLB);
    this.writeF64(varUBPtr, varUB);
    this.writeF64(conLBPtr, conLB);
    this.writeF64(conUBPtr, conUB);

    // Register NLP callbacks
    const evalFPtr = M.addFunction((_n: number, xW: number, _nx: number, objOut: number) => {
      M.HEAPF64[objOut >> 3] = evalObjective(this.readF64(xW, nVars));
      return 1;
    }, "iiiiii");
    this.registeredFunctions.push(evalFPtr);

    const evalGradFPtr = M.addFunction((_n: number, xW: number, _nx: number, gradOut: number) => {
      this.writeF64(gradOut, evalGradient(this.readF64(xW, nVars)));
      return 1;
    }, "iiiiii");
    this.registeredFunctions.push(evalGradFPtr);

    const evalGPtr = M.addFunction((_n: number, xW: number, _nx: number, _m: number, gOut: number) => {
      this.writeF64(gOut, evalConstraints(this.readF64(xW, nVars)));
      return 1;
    }, "iiiiiii");
    this.registeredFunctions.push(evalGPtr);

    const evalJacGPtr = M.addFunction(
      (_n: number, xW: number, _nx: number, _m: number, _ne: number, _iR: number, _jC: number, vPtr: number) => {
        if (vPtr === 0) return 1;
        this.writeF64(vPtr, evalJacobian(this.readF64(xW, nVars)));
        return 1;
      },
      "iiiiiiiiiii",
    );
    this.registeredFunctions.push(evalJacGPtr);

    M.ccall(
      "coinor_ipopt_wasm",
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
        "number",
        "number",
        "number",
      ],
      [
        nVars,
        nConstraints,
        xPtr,
        varLBPtr,
        varUBPtr,
        conLBPtr,
        conUBPtr,
        evalFPtr,
        evalGradFPtr,
        evalGPtr,
        evalJacGPtr,
        nnzJacobian,
        tol,
        maxIter,
        printLevel,
        resultPtr,
        mulPtr,
        objPtr,
        statusPtr,
      ],
    );

    const solution = this.readF64(resultPtr, nVars);
    const multipliers = this.readF64(mulPtr, nConstraints);
    const objectiveValue = M.HEAPF64[objPtr >> 3] ?? 0;
    const status = M.HEAPF64[statusPtr >> 3] ?? -1;

    M._free(xPtr);
    M._free(varLBPtr);
    M._free(varUBPtr);
    M._free(conLBPtr);
    M._free(conUBPtr);
    M._free(resultPtr);
    M._free(mulPtr);
    M._free(objPtr);
    M._free(statusPtr);

    return {
      solution,
      objectiveValue,
      multipliers,
      status,
      message: status === 0 ? "Optimal solution found" : `IPOPT terminated with status ${status}`,
    };
  }

  /**
   * Solve a mixed-integer nonlinear program using Bonmin.
   */
  bonmin(
    nVars: number,
    nConstraints: number,
    x0: number[],
    varLB: number[],
    varUB: number[],
    conLB: number[],
    conUB: number[],
    evalObjective: (x: number[]) => number,
    evalGradient: (x: number[]) => number[],
    evalConstraints: (x: number[]) => number[],
    evalJacobian: (x: number[]) => number[],
    nnzJacobian: number,
    isInteger?: boolean[],
    options?: IpoptWasmOptions,
  ): IpoptWasmResult {
    return this.solveMinlp(
      "coinor_bonmin_wasm",
      nVars,
      nConstraints,
      x0,
      varLB,
      varUB,
      conLB,
      conUB,
      evalObjective,
      evalGradient,
      evalConstraints,
      evalJacobian,
      nnzJacobian,
      isInteger,
      options,
    );
  }

  /**
   * Solve an exact global mixed-integer nonlinear program using Couenne.
   */
  couenne(
    nVars: number,
    nConstraints: number,
    x0: number[],
    varLB: number[],
    varUB: number[],
    conLB: number[],
    conUB: number[],
    evalObjective: (x: number[]) => number,
    evalGradient: (x: number[]) => number[],
    evalConstraints: (x: number[]) => number[],
    evalJacobian: (x: number[]) => number[],
    nnzJacobian: number,
    isInteger?: boolean[],
    options?: IpoptWasmOptions,
  ): IpoptWasmResult {
    return this.solveMinlp(
      "coinor_couenne_wasm",
      nVars,
      nConstraints,
      x0,
      varLB,
      varUB,
      conLB,
      conUB,
      evalObjective,
      evalGradient,
      evalConstraints,
      evalJacobian,
      nnzJacobian,
      isInteger,
      options,
    );
  }

  private solveMinlp(
    fnName: string,
    nVars: number,
    nConstraints: number,
    x0: number[],
    varLB: number[],
    varUB: number[],
    conLB: number[],
    conUB: number[],
    evalObjective: (x: number[]) => number,
    evalGradient: (x: number[]) => number[],
    evalConstraints: (x: number[]) => number[],
    evalJacobian: (x: number[]) => number[],
    nnzJacobian: number,
    isInteger?: boolean[],
    options?: IpoptWasmOptions,
  ): IpoptWasmResult {
    const M = this.module;
    const tol = options?.tolerance ?? 1e-8;
    const maxIter = options?.maxIterations ?? 3000;
    const printLevel = options?.printLevel ?? 0;

    const xPtr = M._malloc(nVars * 8);
    const varLBPtr = M._malloc(nVars * 8);
    const varUBPtr = M._malloc(nVars * 8);
    const conLBPtr = M._malloc(nConstraints * 8);
    const conUBPtr = M._malloc(nConstraints * 8);
    const resultPtr = M._malloc(nVars * 8);
    const objPtr = M._malloc(8);
    const statusPtr = M._malloc(8);
    let intPtr = 0;

    this.writeF64(xPtr, x0);
    this.writeF64(varLBPtr, varLB);
    this.writeF64(varUBPtr, varUB);
    this.writeF64(conLBPtr, conLB);
    this.writeF64(conUBPtr, conUB);

    if (isInteger) {
      intPtr = M._malloc(nVars * 4);
      this.writeI32(
        intPtr,
        isInteger.map((b) => (b ? 1 : 0)),
      );
    }

    const evalFPtr = M.addFunction((_n: number, xW: number, _nx: number, objOut: number) => {
      M.HEAPF64[objOut >> 3] = evalObjective(this.readF64(xW, nVars));
      return 1;
    }, "iiiiii");
    this.registeredFunctions.push(evalFPtr);

    const evalGradFPtr = M.addFunction((_n: number, xW: number, _nx: number, gradOut: number) => {
      this.writeF64(gradOut, evalGradient(this.readF64(xW, nVars)));
      return 1;
    }, "iiiiii");
    this.registeredFunctions.push(evalGradFPtr);

    const evalGPtr = M.addFunction((_n: number, xW: number, _nx: number, _m: number, gOut: number) => {
      this.writeF64(gOut, evalConstraints(this.readF64(xW, nVars)));
      return 1;
    }, "iiiiiii");
    this.registeredFunctions.push(evalGPtr);

    const evalJacGPtr = M.addFunction(
      (_n: number, xW: number, _nx: number, _m: number, _ne: number, _iR: number, _jC: number, vPtr: number) => {
        if (vPtr === 0) return 1;
        this.writeF64(vPtr, evalJacobian(this.readF64(xW, nVars)));
        return 1;
      },
      "iiiiiiiiiii",
    );
    this.registeredFunctions.push(evalJacGPtr);

    M.ccall(
      fnName,
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
        "number",
        "number",
        "number",
      ],
      [
        nVars,
        nConstraints,
        xPtr,
        varLBPtr,
        varUBPtr,
        conLBPtr,
        conUBPtr,
        evalFPtr,
        evalGradFPtr,
        evalGPtr,
        evalJacGPtr,
        nnzJacobian,
        intPtr,
        tol,
        maxIter,
        printLevel,
        resultPtr,
        objPtr,
        statusPtr,
      ],
    );

    const solution = this.readF64(resultPtr, nVars);
    const objectiveValue = M.HEAPF64[objPtr >> 3] ?? 0;
    const status = M.HEAPF64[statusPtr >> 3] ?? -1;

    M._free(xPtr);
    M._free(varLBPtr);
    M._free(varUBPtr);
    M._free(conLBPtr);
    M._free(conUBPtr);
    M._free(resultPtr);
    M._free(objPtr);
    M._free(statusPtr);
    if (intPtr) M._free(intPtr);

    return {
      solution,
      objectiveValue,
      multipliers: [],
      status,
      message: status === 0 ? "Optimal solution found" : `Solver terminated with status ${status}`,
    };
  }

  clp(problem: LpProblem, options?: LpWasmOptions): LpWasmResult {
    return this.solveLp("coinor_clp_wasm", problem, options);
  }

  cbc(problem: LpProblem, options?: LpWasmOptions): LpWasmResult {
    return this.solveLp("coinor_cbc_wasm", problem, options);
  }

  private solveLp(fnName: string, problem: LpProblem, options?: LpWasmOptions): LpWasmResult {
    const M = this.module;
    const tol = options?.tolerance ?? 1e-8;
    const maxIter = options?.maxIterations ?? 10000;
    const printLevel = options?.printLevel ?? 0;

    const objPtr = M._malloc(problem.nVars * 8);
    const varLBPtr = M._malloc(problem.nVars * 8);
    const varUBPtr = M._malloc(problem.nVars * 8);
    const conLBPtr = M._malloc(problem.nConstraints * 8);
    const conUBPtr = M._malloc(problem.nConstraints * 8);
    const aValPtr = M._malloc(problem.A.values.length * 8);
    const aRowPtr = M._malloc(problem.A.rowIndices.length * 4);
    const aColPtr = M._malloc(problem.A.colPointers.length * 4);
    const resultPtr = M._malloc(problem.nVars * 8);
    const objValPtr = M._malloc(8);
    const statusPtr = M._malloc(8);
    const iterPtr = M._malloc(4);

    this.writeF64(objPtr, problem.objCoeffs);
    this.writeF64(varLBPtr, problem.varLB);
    this.writeF64(varUBPtr, problem.varUB);
    this.writeF64(conLBPtr, problem.conLB);
    this.writeF64(conUBPtr, problem.conUB);
    this.writeF64(aValPtr, problem.A.values);
    this.writeI32(aRowPtr, problem.A.rowIndices);
    this.writeI32(aColPtr, problem.A.colPointers);

    let intPtr = 0;
    if (problem.isInteger) {
      intPtr = M._malloc(problem.nVars * 4);
      this.writeI32(
        intPtr,
        problem.isInteger.map((b) => (b ? 1 : 0)),
      );
    }

    M.ccall(
      fnName,
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
        "number",
        "number",
        "number",
      ],
      [
        problem.nVars,
        problem.nConstraints,
        objPtr,
        varLBPtr,
        varUBPtr,
        conLBPtr,
        conUBPtr,
        aValPtr,
        aRowPtr,
        aColPtr,
        problem.A.values.length,
        intPtr,
        tol,
        maxIter,
        printLevel,
        resultPtr,
        objValPtr,
        statusPtr,
        iterPtr,
      ],
    );

    const solution = this.readF64(resultPtr, problem.nVars);
    const objectiveValue = M.HEAPF64[objValPtr >> 3] ?? 0;
    const status = M.HEAPF64[statusPtr >> 3] ?? -1;
    const iterations = M.HEAP32[iterPtr >> 2] ?? 0;

    M._free(objPtr);
    M._free(varLBPtr);
    M._free(varUBPtr);
    M._free(conLBPtr);
    M._free(conUBPtr);
    M._free(aValPtr);
    M._free(aRowPtr);
    M._free(aColPtr);
    M._free(resultPtr);
    M._free(objValPtr);
    M._free(statusPtr);
    M._free(iterPtr);
    if (intPtr) M._free(intPtr);

    return {
      solution,
      objectiveValue,
      iterations,
      status,
      message: status === 0 ? "Optimal solution found" : `Solver terminated with status ${status}`,
    };
  }

  dispose(): void {
    for (const ptr of this.registeredFunctions) {
      try {
        this.module.removeFunction(ptr);
      } catch {
        // Ignore
      }
    }
    this.registeredFunctions = [];
  }

  private readF64(ptr: number, length: number): number[] {
    const result: number[] = new Array(length);
    for (let i = 0; i < length; i++) result[i] = this.module.HEAPF64[(ptr >> 3) + i] ?? 0;
    return result;
  }

  private writeF64(ptr: number, data: number[]): void {
    for (let i = 0; i < data.length; i++) this.module.HEAPF64[(ptr >> 3) + i] = data[i] ?? 0;
  }

  private writeI32(ptr: number, data: number[]): void {
    for (let i = 0; i < data.length; i++) this.module.HEAP32[(ptr >> 2) + i] = data[i] ?? 0;
  }
}

// ── Module loader ──

let cachedSolver: CoinorWasmSolver | null = null;

export async function loadCoinorWasm(wasmUrl?: string): Promise<CoinorWasmSolver> {
  if (cachedSolver) return cachedSolver;

  const isNode = typeof globalThis.process !== "undefined" && globalThis.process.versions?.node;

  if (isNode) {
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const wasmDir = join(currentDir, "..", "..", "wasm");
    const jsGlue = join(wasmDir, "coinor.js");

    const factory = await import(jsGlue);
    const module = await new Promise<CoinorEmscriptenModule>((resolve) => {
      const mod = factory.default({
        locateFile: (path: string) => join(wasmDir, path),
        onRuntimeInitialized: () => resolve(mod),
      });
    });

    cachedSolver = new CoinorWasmSolver(module);
    return cachedSolver;
  }

  const url = wasmUrl ?? new URL(/* webpackIgnore: true */ "../../wasm/coinor.wasm", import.meta.url).href;
  const jsUrl = url.replace(/\.wasm$/, ".js");
  const factory = await import(/* webpackIgnore: true */ jsUrl);
  const module = await new Promise<CoinorEmscriptenModule>((resolve) => {
    const mod = factory.default({
      locateFile: () => url,
      onRuntimeInitialized: () => resolve(mod),
    });
  });

  cachedSolver = new CoinorWasmSolver(module);
  return cachedSolver;
}
