// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * COIN-OR WASM Solver — TypeScript wrapper.
 *
 * Loads a pre-compiled COIN-OR WebAssembly module (IPOPT + CLP + CBC)
 * and provides a high-level API for optimization with callback bridging.
 */

// ── Emscripten module interface ──

/** Low-level Emscripten WebAssembly module interface for the compiled COIN-OR suite. */
interface CoinorEmscriptenModule {
  /** Allocates `size` bytes on the WebAssembly linear memory heap. */
  _malloc(size: number): number;
  /** Frees a previously allocated pointer on the WebAssembly linear memory heap. */
  _free(ptr: number): void;
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

// ── Public interface ──

/** Configuration options for IPOPT, Bonmin, and Couenne nonlinear/MINLP solvers in WebAssembly. */
export interface IpoptWasmOptions {
  /** Convergence tolerance on KKT optimality error (default: `1e-8`). */
  tolerance?: number | undefined;
  /** Maximum number of interior-point or branch-and-bound iterations (default: `3000`). */
  maxIterations?: number | undefined;
  /** Verbosity level for solver console output (`0` = silent). */
  printLevel?: number | undefined;
}

/** Result returned by IPOPT, Bonmin, or Couenne WASM nonlinear/MINLP solvers. */
export interface IpoptWasmResult {
  /** Optimal primal decision variable vector $x^*$. */
  solution: number[];
  /** Objective function value $f(x^*)$ at the solution. */
  objectiveValue: number;
  /** Dual Lagrange multipliers $\lambda^*$ associated with the constraints. */
  multipliers: number[];
  /** Native COIN-OR termination status code (`0` = optimal solution found). */
  status: number;
  /** Human-readable solver status message. */
  message: string;
}

/** Configuration options for CLP (LP) and CBC (MILP) solvers in WebAssembly. */
export interface LpWasmOptions {
  /** Primal/dual feasibility and optimality tolerance (default: `1e-8`). */
  tolerance?: number | undefined;
  /** Maximum number of simplex or branch-and-cut iterations (default: `10000`). */
  maxIterations?: number | undefined;
  /** Verbosity level for solver console output (`0` = silent). */
  printLevel?: number | undefined;
}

/** Result returned by CLP (LP) or CBC (MILP) WebAssembly solvers. */
export interface LpWasmResult {
  /** Optimal primal decision variable vector $x^*$. */
  solution: number[];
  /** Optimal objective value $c^T x^*$. */
  objectiveValue: number;
  /** Total number of simplex or branch-and-cut iterations performed. */
  iterations: number;
  /** Native CLP/CBC termination status code (`0` = optimal). */
  status: number;
  /** Human-readable solver termination message. */
  message: string;
}

/**
 * Sparse Linear Programming (LP) or Mixed-Integer Linear Programming (MILP) problem
 * in Compressed Sparse Column (CSC) matrix format:
 * $$\min_x \; c^T x \quad \text{s.t.} \quad l_c \le A x \le u_c, \;\; l_x \le x \le u_x$$
 */
export interface LpProblem {
  /** Number of decision variables $n$. */
  nVars: number;
  /** Number of linear constraints $m$. */
  nConstraints: number;
  /** Objective cost vector $c$ of length `nVars`. */
  objCoeffs: number[];
  /** Decision variable lower bounds $l_x$ of length `nVars`. */
  varLB: number[];
  /** Decision variable upper bounds $u_x$ of length `nVars`. */
  varUB: number[];
  /** Constraint row lower bounds $l_c$ of length `nConstraints`. */
  conLB: number[];
  /** Constraint row upper bounds $u_c$ of length `nConstraints`. */
  conUB: number[];
  /** Constraint matrix $A$ in Compressed Sparse Column (CSC) format. */
  A: { values: number[]; rowIndices: number[]; colPointers: number[] };
  /** Optional boolean mask indicating which decision variables are integer-constrained (for MILP / CBC). */
  isInteger?: boolean[] | undefined;
}

/**
 * COIN-OR WASM solver instance providing high-level TypeScript bindings to
 * IPOPT (NLP), Bonmin (convex MINLP), Couenne (global nonconvex MINLP),
 * CLP (simplex/barrier LP), and CBC (branch-and-cut MILP).
 */
export class CoinorWasmSolver {
  /** Underlying Emscripten WebAssembly module instance. */
  private module: CoinorEmscriptenModule;
  /** Registered indirect function-table pointers to clean up on {@link dispose}. */
  private registeredFunctions: number[] = [];

  /**
   * Wraps an initialized COIN-OR Emscripten module.
   *
   * @param module Initialized `CoinorEmscriptenModule` instance.
   */
  constructor(module: CoinorEmscriptenModule) {
    this.module = module;
  }

  /**
   * Solve a continuous nonlinear program (NLP) using COIN-OR IPOPT:
   * $$\min_x \; f(x) \quad \text{s.t.} \quad g_L \le g(x) \le g_U, \;\; x_L \le x \le x_U$$
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

  /**
   * Marshals an NLP/MINLP optimization problem across the Emscripten WASM boundary
   * into COIN-OR (Ipopt, Bonmin, or Couenne), registering C function-table callbacks
   * for objective, gradient, constraint, and Jacobian evaluations.
   */
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

    // 1. Allocate f64 buffers on the WASM heap for primal variables, bounds, and output scalars
    const xPtr = M._malloc(nVars * 8);
    const varLBPtr = M._malloc(nVars * 8);
    const varUBPtr = M._malloc(nVars * 8);
    const conLBPtr = M._malloc(nConstraints * 8);
    const conUBPtr = M._malloc(nConstraints * 8);
    const resultPtr = M._malloc(nVars * 8);
    const objPtr = M._malloc(8);
    const statusPtr = M._malloc(8);
    let intPtr = 0;

    // Copy initial guess and box/constraint bounds into WASM linear memory
    this.writeF64(xPtr, x0);
    this.writeF64(varLBPtr, varLB);
    this.writeF64(varUBPtr, varUB);
    this.writeF64(conLBPtr, conLB);
    this.writeF64(conUBPtr, conUB);

    // Optional integer-variable indicator array (0 = continuous, 1 = integer) for Bonmin/Couenne
    if (isInteger) {
      intPtr = M._malloc(nVars * 4);
      this.writeI32(
        intPtr,
        isInteger.map((b) => (b ? 1 : 0)),
      );
    }

    // 2. Register JS evaluation callbacks in the WASM indirect function table
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

    // Jacobian callback: when vPtr == 0, Ipopt queries sparsity structure (handled on C side);
    // when vPtr != 0, populate dense/sparse Jacobian values at xW.
    const evalJacGPtr = M.addFunction(
      (_n: number, xW: number, _nx: number, _m: number, _ne: number, _iR: number, _jC: number, vPtr: number) => {
        if (vPtr === 0) return 1;
        this.writeF64(vPtr, evalJacobian(this.readF64(xW, nVars)));
        return 1;
      },
      "iiiiiiiiiii",
    );
    this.registeredFunctions.push(evalJacGPtr);

    // 3. Invoke the native COIN-OR C entrypoint synchronously via ccall
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

    // 4. Read optimal primal vector, final objective value, and termination status from WASM heap
    const solution = this.readF64(resultPtr, nVars);
    const objectiveValue = M.HEAPF64[objPtr >> 3] ?? 0;
    const status = M.HEAPF64[statusPtr >> 3] ?? -1;

    // 5. Release all temporary WASM heap allocations
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

  /** Solves a continuous Linear Programming (LP) problem using COIN-OR CLP in WebAssembly. */
  clp(problem: LpProblem, options?: LpWasmOptions): LpWasmResult {
    return this.solveLp("coinor_clp_wasm", problem, options);
  }

  /** Solves a Mixed-Integer Linear Programming (MILP) problem using COIN-OR CBC in WebAssembly. */
  cbc(problem: LpProblem, options?: LpWasmOptions): LpWasmResult {
    return this.solveLp("coinor_cbc_wasm", problem, options);
  }

  /**
   * Marshals a sparse CSC linear or mixed-integer linear program across the WASM
   * boundary into COIN-OR CLP (`coinor_clp_wasm`) or CBC (`coinor_cbc_wasm`).
   */
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

  /**
   * Unregisters all JavaScript callback function pointers added to the WASM
   * indirect function table during optimization runs.
   */
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

  /** Reads `length` 64-bit floats from WASM linear memory starting at byte offset `ptr`. */
  private readF64(ptr: number, length: number): number[] {
    const result: number[] = new Array(length);
    for (let i = 0; i < length; i++) result[i] = this.module.HEAPF64[(ptr >> 3) + i] ?? 0;
    return result;
  }

  /** Writes an array of 64-bit floats into WASM linear memory starting at byte offset `ptr`. */
  private writeF64(ptr: number, data: number[]): void {
    for (let i = 0; i < data.length; i++) this.module.HEAPF64[(ptr >> 3) + i] = data[i] ?? 0;
  }

  /** Writes an array of 32-bit signed integers into WASM linear memory starting at byte offset `ptr`. */
  private writeI32(ptr: number, data: number[]): void {
    for (let i = 0; i < data.length; i++) this.module.HEAP32[(ptr >> 2) + i] = data[i] ?? 0;
  }
}

// ── Module loader ──

/** Singleton cache for the initialized COIN-OR WASM solver instance. */
let cachedSolver: CoinorWasmSolver | null = null;

/**
 * Asynchronously loads and initializes the pre-compiled COIN-OR WebAssembly
 * module (IPOPT + Bonmin + Couenne + CLP + CBC), caching the resulting
 * {@link CoinorWasmSolver} singleton across calls.
 *
 * @param wasmUrl Optional custom URL to `coinor.wasm` (used in browser environments).
 */
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
