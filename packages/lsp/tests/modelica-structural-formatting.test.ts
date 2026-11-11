// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { formatModelicaTree } from "../src/providers/formattingProvider.js";

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("@modelscript/modelica/parser.wasm");

describe("Modelica Structural Formatting", () => {
  it("reorders declarations and consolidates equation sections", async () => {
    const { parser } = await createWasmParser(wasmPath);
    const input = `model TestReorder
  import Modelica.Constants.pi;
  Real x;
  equation
    x = 1.0;
  public
    parameter Real p = 2.0;
  equation
    der(x) = p * pi;
  algorithm
    x := x + 1;
end TestReorder;`;

    const tree = parser.parse(input);
    const formatted = formatModelicaTree(tree, input, { structural: true, parser });

    assert.ok(formatted.includes("import Modelica.Constants.pi;"));
    // parameter p must appear before Real x
    const pIndex = formatted.indexOf("parameter Real p = 2.0;");
    const xIndex = formatted.indexOf("Real x;");
    assert.ok(pIndex !== -1 && xIndex !== -1 && pIndex < xIndex, "parameter must precede variable");

    // Only one equation section
    const equationOccurrences = formatted.split(/\bequation\b/).length - 1;
    assert.strictEqual(equationOccurrences, 1, "Must merge multiple equation sections into one");

    // Idempotent
    const tree2 = parser.parse(formatted);
    const pass2 = formatModelicaTree(tree2, formatted, { structural: true, parser });
    assert.strictEqual(pass2, formatted, "Formatting must be idempotent");
  });

  it("preserves classes with __ModelScript(format=false) or __MLQT(format=false)", async () => {
    const { parser } = await createWasmParser(wasmPath);
    const input = `model PreservedModel
  annotation(__ModelScript(format=false));
  equation
    x = 1.0;
  public
    Real x;
end PreservedModel;`;

    const tree = parser.parse(input);
    const formatted = formatModelicaTree(tree, input, { structural: true, parser });
    assert.strictEqual(formatted, input, "Must preserve class marked format=false untouched");
  });
});
