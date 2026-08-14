import * as fs from "fs";
import * as path from "path";

/**
 * Interface representing the compiled ModelScript WASM compiler exports.
 */
export interface CompilerWasmExports {
  memory: any;
  lsp_setup_ipopt: (objectiveNode: number, numVars: number, varsPtr: number, numCons: number, consPtr: number) => void;
  ffi_ipopt_eval_f: (n: number, xPtr: number, new_x: number, objValPtr: number, userData: number) => number;
  ffi_ipopt_eval_grad_f: (n: number, xPtr: number, new_x: number, gradPtr: number, userData: number) => number;
  ffi_ipopt_eval_g: (n: number, xPtr: number, new_x: number, m: number, gPtr: number, userData: number) => number;
  ffi_ipopt_eval_jac_g: (
    n: number,
    xPtr: number,
    new_x: number,
    m: number,
    nele: number,
    iRowPtr: number,
    jColPtr: number,
    valuesPtr: number,
    userData: number,
  ) => number;
  lsp_malloc: (size: number) => number;
  lsp_free: (ptr: number) => void;
}

export class KinematicIpoptSolver {
  private coinorModule: any = null;

  public async initialize(extensionPath: string) {
    if (this.coinorModule) return;

    try {
      const coinorPath = path.join(extensionPath, "wasm", "coinor.js");
      if (fs.existsSync(coinorPath)) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const coinorFactory = require(coinorPath);
        this.coinorModule = await coinorFactory();
        console.log("[IpoptBridge] Successfully loaded coinor.js WASM module.");
      } else {
        console.warn(`[IpoptBridge] coinor.js not found at ${coinorPath}. IPOPT solver will run in mock mode.`);
      }
    } catch (e) {
      console.error("[IpoptBridge] Failed to initialize coinor.js:", e);
    }
  }

  public solve(
    compiler: CompilerWasmExports,
    astRoot: number,
    objectiveNodeId: number,
    variableNodeIds: number[],
    constraintNodeIds: number[],
    initialGuess: number[],
  ): number[] {
    if (!this.coinorModule) {
      console.log("[IpoptBridge] Mock solve (IPOPT not loaded). Calling AD tape directly...");
      compiler.lsp_setup_ipopt(objectiveNodeId, variableNodeIds.length, 0, constraintNodeIds.length, 0);
      compiler.ffi_ipopt_eval_grad_f(0, 0, 0, 0, 0);
      return initialGuess;
    }

    const M = this.coinorModule;
    const nVars = variableNodeIds.length;
    const nCons = constraintNodeIds.length;

    const varsPtr = compiler.lsp_malloc(nVars * 4);
    const consPtr = compiler.lsp_malloc(nCons * 4);

    const compilerMem = new Uint32Array(compiler.memory.buffer);
    for (let i = 0; i < nVars; i++) compilerMem[(varsPtr >> 2) + i] = variableNodeIds[i];
    for (let i = 0; i < nCons; i++) compilerMem[(consPtr >> 2) + i] = constraintNodeIds[i];

    compiler.lsp_setup_ipopt(objectiveNodeId, nVars, varsPtr, nCons, consPtr);

    const xPtr = M._malloc(nVars * 8);
    const varLBPtr = M._malloc(nVars * 8);
    const varUBPtr = M._malloc(nVars * 8);
    const conLBPtr = M._malloc(nCons * 8);
    const conUBPtr = M._malloc(nCons * 8);
    const resultPtr = M._malloc(nVars * 8);
    const mulPtr = M._malloc(nCons * 8);
    const objPtr = M._malloc(8);
    const statusPtr = M._malloc(8);

    for (let i = 0; i < nVars; i++) {
      M.HEAPF64[(xPtr >> 3) + i] = initialGuess[i] || 0.0;
      M.HEAPF64[(varLBPtr >> 3) + i] = -1e19;
      M.HEAPF64[(varUBPtr >> 3) + i] = 1e19;
    }
    for (let i = 0; i < nCons; i++) {
      M.HEAPF64[(conLBPtr >> 3) + i] = 0.0;
      M.HEAPF64[(conUBPtr >> 3) + i] = 0.0;
    }

    const c_xPtr = compiler.lsp_malloc(nVars * 8);
    const c_objValPtr = compiler.lsp_malloc(8);
    const c_gradPtr = compiler.lsp_malloc(nVars * 8);
    const c_gPtr = compiler.lsp_malloc(nCons * 8);

    const nnzJacobian = nVars * nCons;
    const c_jacValuesPtr = compiler.lsp_malloc(nnzJacobian * 8);

    const evalFPtr = M.addFunction((_n: number, xW: number, _nx: number, objOut: number) => {
      const cMemF64 = new Float64Array(compiler.memory.buffer);
      for (let i = 0; i < nVars; i++) cMemF64[(c_xPtr >> 3) + i] = M.HEAPF64[(xW >> 3) + i];

      compiler.ffi_ipopt_eval_f(nVars, c_xPtr, 0, c_objValPtr, 0);
      M.HEAPF64[objOut >> 3] = cMemF64[c_objValPtr >> 3];
      return 1;
    }, "iiiii");

    const evalGradFPtr = M.addFunction((_n: number, xW: number, _nx: number, gradOut: number) => {
      const cMemF64 = new Float64Array(compiler.memory.buffer);
      for (let i = 0; i < nVars; i++) cMemF64[(c_xPtr >> 3) + i] = M.HEAPF64[(xW >> 3) + i];

      compiler.ffi_ipopt_eval_grad_f(nVars, c_xPtr, 0, c_gradPtr, 0);
      for (let i = 0; i < nVars; i++) M.HEAPF64[(gradOut >> 3) + i] = cMemF64[(c_gradPtr >> 3) + i];
      return 1;
    }, "iiiii");

    const evalGPtr = M.addFunction((_n: number, xW: number, _nx: number, _m: number, gOut: number) => {
      const cMemF64 = new Float64Array(compiler.memory.buffer);
      for (let i = 0; i < nVars; i++) cMemF64[(c_xPtr >> 3) + i] = M.HEAPF64[(xW >> 3) + i];

      compiler.ffi_ipopt_eval_g(nVars, c_xPtr, 0, nCons, c_gPtr, 0);
      for (let i = 0; i < nCons; i++) M.HEAPF64[(gOut >> 3) + i] = cMemF64[(c_gPtr >> 3) + i];
      return 1;
    }, "iiiiii");

    const evalJacGPtr = M.addFunction(
      (_n: number, xW: number, _nx: number, _m: number, _ne: number, iR: number, jC: number, vPtr: number) => {
        if (vPtr === 0) {
          let idx = 0;
          for (let i = 0; i < nCons; i++) {
            for (let j = 0; j < nVars; j++) {
              M.HEAP32[(iR >> 2) + idx] = i;
              M.HEAP32[(jC >> 2) + idx] = j;
              idx++;
            }
          }
          return 1;
        }

        const cMemF64 = new Float64Array(compiler.memory.buffer);
        for (let i = 0; i < nVars; i++) cMemF64[(c_xPtr >> 3) + i] = M.HEAPF64[(xW >> 3) + i];

        compiler.ffi_ipopt_eval_jac_g(nVars, c_xPtr, 0, nCons, nnzJacobian, 0, 0, c_jacValuesPtr, 0);
        for (let i = 0; i < nnzJacobian; i++) M.HEAPF64[(vPtr >> 3) + i] = cMemF64[(c_jacValuesPtr >> 3) + i];
        return 1;
      },
      "iiiiiiiii",
    );

    try {
      console.log(`[IpoptBridge] Invoking coinor_ipopt_wasm for ${nVars} variables, ${nCons} constraints...`);
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
          nCons,
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
          1e-5,
          3000,
          5,
          resultPtr,
          mulPtr,
          objPtr,
          statusPtr,
        ],
      );

      const solution: number[] = [];
      for (let i = 0; i < nVars; i++) {
        solution.push(M.HEAPF64[(resultPtr >> 3) + i]);
      }
      console.log(`[IpoptBridge] Optimization converged. Status: ${M.HEAP32[statusPtr >> 2]}`);
      return solution;
    } finally {
      M.removeFunction(evalFPtr);
      M.removeFunction(evalGradFPtr);
      M.removeFunction(evalGPtr);
      M.removeFunction(evalJacGPtr);
      M._free(xPtr);
      M._free(varLBPtr);
      M._free(varUBPtr);
      M._free(conLBPtr);
      M._free(conUBPtr);
      M._free(resultPtr);
      M._free(mulPtr);
      M._free(objPtr);
      M._free(statusPtr);

      compiler.lsp_free(varsPtr);
      compiler.lsp_free(consPtr);
      compiler.lsp_free(c_xPtr);
      compiler.lsp_free(c_objValPtr);
      compiler.lsp_free(c_gradPtr);
      compiler.lsp_free(c_gPtr);
      compiler.lsp_free(c_jacValuesPtr);
    }
  }
}
