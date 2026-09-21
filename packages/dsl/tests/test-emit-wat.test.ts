import { generateWatEmitter } from "@modelscript/dsl/codegen/emit_wat.js";
import expect from "expect";
import { describe, test } from "node:test";

describe("WebAssembly Text (WAT) Emitter Generator", () => {
  test("generates valid WAT module template function", () => {
    const code = generateWatEmitter({
      name: "test",
      rules: {} as any,
      targets: {
        wat: { exportName: "run_model" },
      },
    });

    expect(code).toContain("export function emit_wat");
    expect(code).toContain("(func $run_model (result i32)");
    expect(code).toContain('export \\"run_model\\"');
  });
});
