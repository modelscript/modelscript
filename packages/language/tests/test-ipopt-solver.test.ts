import { describe, expect, it, jest } from "@jest/globals";
import { KinematicIpoptSolver } from "../src/ipopt-bridge";

describe("IPOPT WASM Solver Bridge", () => {
  it("should initialize and execute mock optimization when coinor.js is absent", async () => {
    const solver = new KinematicIpoptSolver();
    await solver.initialize("/non/existent/path");

    const mockCompiler = {
      memory: new WebAssembly.Memory({ initial: 1 }),
      lsp_setup_ipopt: jest.fn(),
      ffi_ipopt_eval_f: jest.fn(),
      ffi_ipopt_eval_grad_f: jest.fn(),
      ffi_ipopt_eval_g: jest.fn(),
      ffi_ipopt_eval_jac_g: jest.fn(),
      lsp_malloc: jest.fn().mockReturnValue(0),
      lsp_free: jest.fn(),
    };

    const result = solver.solve(mockCompiler as any, 1, 10, [1, 2], [3], [0.5, 1.5]);
    expect(result).toEqual([0.5, 1.5]);
    expect(mockCompiler.lsp_setup_ipopt).toHaveBeenCalled();
  });
});
