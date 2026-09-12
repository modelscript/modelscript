import { describe, expect, it, jest } from "@jest/globals";
import { CoinorWasmSolver } from "../src/compiler/optimizer/solvers/coinor-wasm.js";

describe("COIN-OR IPOPT WASM Solver", () => {
  it("should initialize CoinorWasmSolver and execute nonlinear problem interface", () => {
    const memory = new ArrayBuffer(65536);
    const heapF64 = new Float64Array(memory);
    const heap32 = new Int32Array(memory);

    let nextPtr = 64;
    const mockModule = {
      _malloc: jest.fn((size: number) => {
        const p = nextPtr;
        nextPtr += Math.ceil(size / 8) * 8;
        return p;
      }),
      _free: jest.fn(),
      HEAPF64: heapF64,
      HEAP32: heap32,
      addFunction: jest.fn((_fn: any, _sig: string) => 1),
      removeFunction: jest.fn(),
      ccall: jest.fn((name: string) => {
        if (name === "coinor_ipopt_solve") {
          return 0; // Success
        }
        return 0;
      }),
    };

    const solver = new CoinorWasmSolver(mockModule as any);
    const result = solver.ipopt(
      2,
      1,
      [0.5, 1.5],
      [0, 0],
      [10, 10],
      [1, 1],
      [5, 5],
      (x) => (x[0] ?? 0) ** 2 + (x[1] ?? 0) ** 2,
      (x) => [2 * (x[0] ?? 0), 2 * (x[1] ?? 0)],
      (x) => [(x[0] ?? 0) + (x[1] ?? 0)],
      (_x) => [1, 1],
      2,
    );

    expect(result.status).toBe(0);
    expect(mockModule._malloc).toHaveBeenCalled();
    expect(mockModule.ccall).toHaveBeenCalled();
  });
});
