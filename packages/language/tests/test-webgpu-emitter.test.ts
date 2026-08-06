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

  it("should respect custom DSL targets options", () => {
    const customGrammar = {
      name: "Modelica",
      targets: {
        webgpu: {
          tileSize: 32,
          workgroupSize: [32, 32],
        },
      },
    };
    const code = generateWebGPUEmitter(customGrammar as any);
    expect(code).toContain("const TILE_SIZE = 32u;");
    expect(code).toContain("@compute @workgroup_size(32, 32)");
  });
});
