// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { lintScadCst } from "../src/linter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

describe("@modelscript/scad: lintScadCst semantic linter & narrow ranges", async () => {
  const wasmBytes = fs.readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes);

  function lint(src: string) {
    const tree = parser.parse(src);
    return lintScadCst(tree.rootNode, src);
  }

  it("reports zero diagnostics on valid OpenSCAD models with hoisted modules/functions", () => {
    const src = `
arm_length = 200;
$fn = 32;

tag_port("hub", "fixed_support")
  motor_mount(dia = 28);

cube([arm_length, 20, 10])
  .fillet(2.0)
  .translate([10, 0, 0]);

module motor_mount(dia = 28, h = half(24)) {
  difference() {
    cylinder(r = dia / 2 + 4, h = h);
    cylinder(r = dia / 2, h = h + 2);
  }
}

function half(x) = x / 2;
`;
    const diags = lint(src);
    assert.strictEqual(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("underlines only the offending identifier for undefined variables, modules, functions, and methods", () => {
    const src = `x = missing_var + 10;
y = unknown_fn(x);
unknown_mod(10);
cube([10, 10, 10]).bad_method(5);
`;
    const diags = lint(src);
    const varDiag = diags.find((d) => d.code === "SCAD_UNDEFINED_VARIABLE");
    assert.ok(varDiag, "Expected SCAD_UNDEFINED_VARIABLE");
    assert.strictEqual(src.slice(varDiag.startOffset, varDiag.endOffset), "missing_var");

    const fnDiag = diags.find((d) => d.code === "SCAD_UNDEFINED_FUNCTION");
    assert.ok(fnDiag, "Expected SCAD_UNDEFINED_FUNCTION");
    assert.strictEqual(src.slice(fnDiag.startOffset, fnDiag.endOffset), "unknown_fn");

    const modDiag = diags.find((d) => d.code === "SCAD_UNDEFINED_MODULE");
    assert.ok(modDiag, "Expected SCAD_UNDEFINED_MODULE");
    assert.strictEqual(src.slice(modDiag.startOffset, modDiag.endOffset), "unknown_mod");

    const methodDiag = diags.find((d) => d.code === "SCAD_UNKNOWN_METHOD");
    assert.ok(methodDiag, "Expected SCAD_UNKNOWN_METHOD");
    assert.strictEqual(src.slice(methodDiag.startOffset, methodDiag.endOffset), "bad_method");
  });

  it("underlines only the duplicate declaration name or parameter name", () => {
    const src = `width = 10;
width = 20;
module bracket(a, a) {
  cube([a, 10, 10]);
}
module bracket(b) {
  sphere(r = b);
}
`;
    const diags = lint(src);
    const dupDiags = diags.filter((d) => d.code === "SCAD_DUPLICATE_DECLARATION");
    assert.strictEqual(dupDiags.length, 3);
    assert.strictEqual(src.slice(dupDiags[0]!.startOffset, dupDiags[0]!.endOffset), "width");
    assert.strictEqual(dupDiags[0]!.line, 2);
    assert.strictEqual(src.slice(dupDiags[1]!.startOffset, dupDiags[1]!.endOffset), "a");
    assert.strictEqual(src.slice(dupDiags[2]!.startOffset, dupDiags[2]!.endOffset), "bracket");
    assert.strictEqual(dupDiags[2]!.line, 6);
  });

  it("underlines only the offending vector element or argument expression on non-positive dimensions", () => {
    const src = `cube([10, -5, 20]);
cylinder(h = 10, r = 0);
sphere(r = -3).fillet(-1);
`;
    const diags = lint(src);
    const dimDiags = diags.filter((d) => d.code === "SCAD_INVALID_DIMENSION");
    assert.strictEqual(dimDiags.length, 4);
    assert.strictEqual(src.slice(dimDiags[0]!.startOffset, dimDiags[0]!.endOffset), "-5");
    assert.strictEqual(src.slice(dimDiags[1]!.startOffset, dimDiags[1]!.endOffset), "0");
    assert.strictEqual(src.slice(dimDiags[2]!.startOffset, dimDiags[2]!.endOffset), "-3");
    assert.strictEqual(src.slice(dimDiags[3]!.startOffset, dimDiags[3]!.endOffset), "-1");
  });

  it("detects user-defined call arity errors, unknown named parameters, and division by zero with narrow ranges", () => {
    const src = `module hole(d, depth = 10) {
  cylinder(d = d, h = depth);
}
hole(5, 10, 99);
hole(d = 5, bogus_param = 12);
hole();
ratio = 100 / (5 - 5);
`;
    const diags = lint(src);
    const excessDiag = diags.find((d) => d.code === "SCAD_ARGUMENT_COUNT" && d.severity === "error");
    assert.ok(excessDiag, "Expected excess argument error");
    assert.strictEqual(src.slice(excessDiag.startOffset, excessDiag.endOffset), "99");

    const unknownParam = diags.find((d) => d.code === "SCAD_UNKNOWN_PARAMETER");
    assert.ok(unknownParam, "Expected unknown parameter error");
    assert.strictEqual(src.slice(unknownParam.startOffset, unknownParam.endOffset), "bogus_param");

    const missingParam = diags.find((d) => d.code === "SCAD_ARGUMENT_COUNT" && d.severity === "warning");
    assert.ok(missingParam, "Expected missing required parameter warning");
    assert.strictEqual(src.slice(missingParam.startOffset, missingParam.endOffset), "hole");

    const divZero = diags.find((d) => d.code === "SCAD_DIVISION_BY_ZERO");
    assert.ok(divZero, "Expected division by zero error");
    assert.strictEqual(src.slice(divZero.startOffset, divZero.endOffset), "(5 - 5)");
  });
});
