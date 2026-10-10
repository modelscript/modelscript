// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Modelica Equation Type Mismatch", () => {
  it("should flag type mismatch 5001 when assigning scalar 1 to model instance x of type X", async () => {
    const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
    const { facade } = await createWasmParser(modelicaWasm);

    const code = `model X
  Real x;
end X;

model Y
  X x;
equation
  x = 1;
end Y;`;

    const root = facade.parse(code);
    const diags = facade.getDiagnostics(root);

    const mismatchDiag = diags.find((d: any) => d.code === 5001);
    expect(mismatchDiag).toBeDefined();
    expect(mismatchDiag.message).toContain("Type mismatch in equation x = 1");
  });
});
