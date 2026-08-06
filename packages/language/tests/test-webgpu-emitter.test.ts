import { generateWebGPUEmitter } from "../src/codegen/emit_webgpu";

describe("WebGPU WGSL Shader Emitter", () => {
  it("should generate valid WGSL shader code and host glue", () => {
    const mockGrammar = { name: "Modelica" };
    const code = generateWebGPUEmitter(mockGrammar as any);

    expect(code).toContain("emit_wgsl_prelude");
    expect(code).toContain("emit_wgsl_matmul");
    expect(code).toContain("emit_webgpu_host_spmv");
    expect(code).toContain("@compute @workgroup_size(16, 16)");
    expect(code).toContain("GPUBufferUsage.STORAGE");
  });
});
