import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../../../languages/modelica/src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Resilient Missing-Value Error Recovery & Zero-Drift Offsets", () => {
  let facade: any;

  before(async () => {
    const wasmPath = path.resolve(__dirname, "../../../languages/modelica/dist/parser.wasm");
    assert.ok(fs.existsSync(wasmPath), `WASM file must exist at ${wasmPath}`);
    const result = await createWasmParser(wasmPath);
    facade = result.facade;
  });

  const validCode = `model ChuaCircuit
  parameter Real C1 = 10.0;
  parameter Real C2 = 100.0;
  parameter Real R = 100.0;
  parameter Real L = 0.001;
  parameter Real G = 0.565;
  parameter Real Ga = -0.757;
  parameter Real Gb = -0.409;
  parameter Real E = 1.0;

  Real v_C1(start = 0.1);
  Real v_C2(start = 0.0);
  Real i_L(start = 0.0);
  Real g_R;

equation
  g_R = Gb * v_C1 + 0.5 * (Ga - Gb) * (abs(v_C1 + E) - abs(v_C1 - E));

  C1 * der(v_C1) = G * (v_C2 - v_C1) - g_R;
  C2 * der(v_C2) = G * (v_C1 - v_C2) + i_L;
  L * der(i_L) = -v_C2;
end ChuaCircuit;`;

  const missingValueCode = `model ChuaCircuit
  parameter Real C1 = 10.0;
  parameter Real C2 = 100.0;
  parameter Real R = ;
  parameter Real L = 0.001;
  parameter Real G = 0.565;
  parameter Real Ga = -0.757;
  parameter Real Gb = -0.409;
  parameter Real E = 1.0;

  Real v_C1(start = 0.1);
  Real v_C2(start = 0.0);
  Real i_L(start = 0.0);
  Real g_R;

equation
  g_R = Gb * v_C1 + 0.5 * (Ga - Gb) * (abs(v_C1 + E) - abs(v_C1 - E));

  C1 * der(v_C1) = G * (v_C2 - v_C1) - g_R;
  C2 * der(v_C2) = G * (v_C1 - v_C2) + i_L;
  L * der(i_L) = -v_C2;
end ChuaCircuit;`;

  it("should cleanly parse valid ChuaCircuit model with zero diagnostics", () => {
    facade.lastAstRoot = 0;
    const ast = facade.parseIncremental(validCode, 0, 0, validCode.length, "file:///chua.mo");
    const diags = facade.getDiagnostics(ast);
    assert.strictEqual(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("should isolate missing value error to line 3 without destroying downstream declarations or equations", () => {
    facade.lastAstRoot = 0;
    const ast = facade.parseIncremental(missingValueCode, 0, 0, missingValueCode.length, "file:///chua_missing.mo");
    const diags = facade.getDiagnostics(ast);
    console.log("AST S-EXPR:\n", facade.getAstSExpr(ast));
    console.log("Missing-value diagnostics:", JSON.stringify(diags, null, 2));

    // Filter syntax errors (severity 1)
    const syntaxErrors = diags.filter((d: any) => d.severity === 1);
    assert.ok(syntaxErrors.length >= 1, "Must report at least 1 syntax error");

    // Line 3 (0-indexed line 3: "parameter Real R = ;") must have the syntax error
    const line3Errors = syntaxErrors.filter((d: any) => d.range.start.line === 3);
    assert.strictEqual(line3Errors.length, 1, `Line 3 must have exactly 1 error, got: ${JSON.stringify(line3Errors)}`);

    // Line 4 ("parameter Real L = 0.001;") must NOT have any syntax error
    const line4Errors = syntaxErrors.filter((d: any) => d.range.start.line === 4);
    assert.strictEqual(line4Errors.length, 0, `Line 4 must have 0 syntax errors, got: ${JSON.stringify(line4Errors)}`);

    // Equation section (lines 14-21) must NOT have syntax errors
    const equationErrors = syntaxErrors.filter((d: any) => d.range.start.line >= 14);
    assert.strictEqual(
      equationErrors.length,
      0,
      `Equation section must have 0 syntax errors, got: ${JSON.stringify(equationErrors)}`,
    );
  });

  it("should handle incremental deletion of '100.0' with zero offset drift", () => {
    // 1. Initial parse
    facade.lastAstRoot = 0;
    let ast = facade.parseIncremental(validCode, 0, 0, validCode.length, "file:///chua_inc.mo");
    assert.strictEqual(facade.getDiagnostics(ast).length, 0);

    // Find the offset of '100.0;' on line 3 ("parameter Real R = 100.0;")
    const line3Prefix = "  parameter Real R = ";
    const editOffset = validCode.indexOf(line3Prefix) + line3Prefix.length;
    const rangeLength = "100.0".length;

    // 2. Incremental edit: delete "100.0"
    ast = facade.parseIncremental("", editOffset, rangeLength, missingValueCode.length, "file:///chua_inc.mo");
    const diags = facade.getDiagnostics(ast);

    // Diagnostics should be localized to line 3
    const syntaxErrors = diags.filter((d: any) => d.severity === 1);
    assert.strictEqual(syntaxErrors.length, 1, `Expected exactly 1 syntax error, got: ${JSON.stringify(syntaxErrors)}`);
    assert.strictEqual(syntaxErrors[0].range.start.line, 3);

    // Zero syntax errors on subsequent lines
    const downstreamErrors = syntaxErrors.filter((d: any) => d.range.start.line > 3);
    assert.strictEqual(
      downstreamErrors.length,
      0,
      `Expected 0 downstream errors, got: ${JSON.stringify(downstreamErrors)}`,
    );

    // 3. Incremental edit: retype "100.0"
    ast = facade.parseIncremental("100.0", editOffset, 0, validCode.length, "file:///chua_inc.mo");
    const repairedDiags = facade.getDiagnostics(ast);
    assert.strictEqual(
      repairedDiags.length,
      0,
      `Expected 0 diagnostics after retype, got: ${JSON.stringify(repairedDiags)}`,
    );
  });
});
