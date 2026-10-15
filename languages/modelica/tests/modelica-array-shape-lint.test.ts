// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Modelica Array Shape Linting", () => {
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
});
