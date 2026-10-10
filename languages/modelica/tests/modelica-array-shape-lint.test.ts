// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Modelica Array Shape Linting & Pipeline Preservation", () => {
  let facade: any;

  beforeAll(async () => {
    const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
    const res = await createWasmParser(modelicaWasm);
    facade = res.facade;
  });

  describe("Linter: Array Shape Mismatch (M4003)", () => {
    it("should flag array shape mismatch 4003 when initializing Real x[9] with {8}", () => {
      const code = `model X
  Real x[9] = {8};
end X;`;

      const root = facade.parse(code);
      const diags = facade.getDiagnostics(root);

      const shapeDiag = diags.find((d: any) => d.code === 4003);
      expect(shapeDiag).toBeDefined();
      expect(shapeDiag.message).toContain("Array shape mismatch");
    });

    it("should not flag 4003 when array initializer count matches declared dimension", () => {
      const code = `model X
  Real x[3] = {1.0, 2.0, 3.0};
end X;`;

      const root = facade.parse(code);
      const diags = facade.getDiagnostics(root);

      const shapeDiag = diags.find((d: any) => d.code === 4003);
      expect(shapeDiag).toBeUndefined();
    });
  });

  describe("Flattening Pipeline: Array Shape Preservation", () => {
    it("should preserve array dimensions in graph.dae without unrolling into separate scalar entries", () => {
      const code = `model X
  Real x[9] = {1, 2, 3, 4, 5, 6, 7, 8, 9};
end X;`;

      const root = facade.parse(code);
      const daeData = facade.executePipeline(root, "flatten");

      // Exactly 1 variable emitted (kept as structured array tensor)
      expect(daeData.varCount).toBe(1);
      expect(daeData.variables[0].dimensions).toEqual([9]);
      expect(daeData.flatText).toContain("Real x[9];");
    });

    it("should lower arithmetic equations preserving operators and literals (e.g. x = 1 + x)", () => {
      const code = `model X
  Real x;
equation
  x = 1+x;
end X;`;

      const root = facade.parse(code);
      const daeData = facade.executePipeline(root, "flatten");

      expect(daeData.equations.length).toBe(1);
      expect(daeData.equations[0].text).toBe("x = 1 + x");
      expect(daeData.flatText).toContain("x = 1 + x;");
    });

    it("should lower derivative and unary negative equations", () => {
      const code = `model Spring
  Real x;
  Real v;
equation
  der(x) = v;
  der(v) = -10 * x;
end Spring;`;

      const root = facade.parse(code);
      const daeData = facade.executePipeline(root, "flatten");

      expect(daeData.equations.length).toBe(2);
      expect(daeData.flatText).toContain("der(x) = v;");
      expect(daeData.flatText).toContain("der(v) = -10 * x;");
    });
  });
});
