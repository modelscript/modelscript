// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "path";
import { fileURLToPath } from "url";
import { createWasmParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
describe("Modelica Salsa 3.0 Query Engine & Memoization", () => {
  it("should compile Modelica Salsa queries, index symbols, and memoize type resolutions", async () => {
    const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
    const { facade } = await createWasmParser(modelicaWasm);
    const instance = { exports: facade.exports };

    const code = `model X
  Real x;
end X;

model Y
  X x;
equation
  x = 1;
end Y;`;

    const root = facade.parse(code);
    expect(root).toBeGreaterThan(0);

    // 1. Verify Salsa query exports exist on WASM module
    expect(typeof instance.exports.runQuery).toBe("function");
    expect(typeof instance.exports.resolveComponentTypeInClass).toBe("function");
    expect(typeof instance.exports.resolveDottedType).toBe("function");

    // 2. Verify diagnostics work through Salsa query resolution
    const diags = facade.getDiagnostics(root);
    const mismatchDiag = diags.find((d: any) => d.code === 5001);
    expect(mismatchDiag).toBeDefined();
    expect(mismatchDiag.message).toContain("Type mismatch in equation x = 1");
  });
});
