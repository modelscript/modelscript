import { describe, expect, test } from "@jest/globals";
import { generateWit } from "../src/codegen/wit.js";

describe("WASM Interface Types (WIT) Generator", () => {
  test("generates valid WIT interface IDL with model accessors", () => {
    const witCode = generateWit({
      name: "modelica",
      rules: {} as any,
      targets: {
        wit: { package: "modelscript:sim@0.1.0", world: "sim-runner" },
      },
      model: {
        Component: {
          name: "string",
          value: "number",
        },
      },
    });

    expect(witCode).toContain("package modelscript:sim@0.1.0;");
    expect(witCode).toContain("world sim-runner {");
    expect(witCode).toContain("export parse: func(source: string) -> u32;");
    expect(witCode).toContain("export get-component-name: func(node: u32) -> u32;");
    expect(witCode).toContain("export get-component-value: func(node: u32) -> u32;");
  });
});
