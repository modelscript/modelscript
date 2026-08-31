import * as assert from "assert";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { analysis, choice, domain, field, language, repeat, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("=== Testing WASM Gröbner Basis Engine ===");

  const groebnerDsl = language({
    name: "GroebnerWasmTest",
    rules: {
      Program: ($: any) => repeat($.Stmt),
      Stmt: ($: any) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Expr), ";"),
      Expr: ($: any) => choice($.Identifier, $.Number),
      Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
      Number: ($: any) => semanticToken("number", /[0-9]+/),
    },
    extras: ($: any) => [/\s+/],
    analysis: {
      systemSolver: analysis({
        domain: domain.dae({
          indexReduction: "pantelides",
          tearing: "minimum_degree",
          groebnerPreReduction: true,
        }),
      }),
    },
  });

  const result = buildParser(groebnerDsl as any);
  const tmpDir = path.join(__dirname, "scratch_build_groebner_wasm");
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const file of result.assemblyScriptFiles) {
    fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
  }

  const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
  const wasmOut = path.join(tmpDir, "groebner.wasm");

  console.log("Compiling AssemblyScript to WASM via asc...");
  childProcess.execSync(
    `node ${ascPath} ${path.join(tmpDir, "parser.ts")} --target release --outFile ${wasmOut} --runtime stub --enable threads --exportRuntime`,
    { stdio: "pipe" },
  );

  const wasmBytes = fs.readFileSync(wasmOut);
  const wasmCompiled = await WebAssembly.compile(wasmBytes);
  const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
  const imports = {
    env: {
      memory: memory,
      abort: (msgPtr: number, filePtr: number, line: number, col: number) => {
        try {
          const u16 = new Uint16Array(memory.buffer);
          let msg = "";
          let file = "";
          if (msgPtr > 4) {
            const len = u16[(msgPtr - 4) >> 1] >> 1;
            const chars = [];
            for (let i = 0; i < len; i++) chars.push(u16[(msgPtr >> 1) + i]);
            msg = String.fromCharCode(...chars);
          }
          if (filePtr > 4) {
            const len = u16[(filePtr - 4) >> 1] >> 1;
            const chars = [];
            for (let i = 0; i < len; i++) chars.push(u16[(filePtr >> 1) + i]);
            file = String.fromCharCode(...chars);
          }
          console.error(`WASM Abort: '${msg}' at ${file}:${line}:${col}`);
        } catch (e) {
          console.error(`WASM Abort: line ${line}, col ${col}`);
        }
      },
    },
    JavaScript: { debugLog: () => {}, logNode: () => {} },
    engine: { debugLog: () => {} },
    parser: { logInt: (n: number) => console.log("[WASM logInt]", n) },
    recovery: {},
    host: { runHostQuery: () => {} },
  };

  const instance = await WebAssembly.instantiate(wasmCompiled, imports);
  const wasmExports: any = instance.exports;

  console.log("Checking exported WASM functions...");
  assert.ok(wasmExports.groebner_triangularize, "groebner_triangularize should be exported");
  assert.strictEqual(typeof wasmExports.groebner_triangularize, "function");

  console.log("Setting up DAE polynomial system in WASM...");
  // 1. Create a DaeBuilder
  const daePtr = wasmExports.dae_createBuilder();
  assert.ok(daePtr > 0, "dae_createBuilder should return valid pointer");

  // 2. Add two variables: x (id 0) and y (id 1)
  const varX = wasmExports.dae_addVariable(daePtr, 1, 0, 0, 0, 0.0, 0); // Real, Continuous, Local
  const varY = wasmExports.dae_addVariable(daePtr, 2, 0, 0, 0, 0.0, 0); // Real, Continuous, Local
  assert.strictEqual(varX, 0);
  assert.strictEqual(varY, 1);

  // 3. Build equation 0: x - y = 0
  const xExpr = wasmExports.dae_addName(daePtr, varX);
  const yExpr = wasmExports.dae_addName(daePtr, varY);
  const eq0 = wasmExports.dae_addEquation(daePtr, 0, xExpr, yExpr, 0xffffffff); // EqKind.Simple = 0

  // 4. Build equation 1: x + y = 2
  const xPlusY = wasmExports.dae_addBinaryExpr(daePtr, 0, xExpr, yExpr); // BinOp.Add = 0
  const twoExpr = wasmExports.dae_addRealLiteral(daePtr, 2.0);
  const eq1 = wasmExports.dae_addEquation(daePtr, 0, xPlusY, twoExpr, 0xffffffff);
  console.log("eq0:", eq0, "eq1:", eq1, "xExpr:", xExpr, "yExpr:", yExpr, "xPlusY:", xPlusY, "twoExpr:", twoExpr);
  console.log(
    "dae_getEqLhs(0):",
    wasmExports.dae_getEqLhs(daePtr, 0),
    "dae_getEqRhs(0):",
    wasmExports.dae_getEqRhs(daePtr, 0),
  );
  console.log(
    "dae_getEqLhs(1):",
    wasmExports.dae_getEqLhs(daePtr, 1),
    "dae_getEqRhs(1):",
    wasmExports.dae_getEqRhs(daePtr, 1),
  );

  // 5. Pass eqIdxs [0, 1] and varIdxs [0, 1] in WASM memory
  const eqIdxsPtr = wasmExports.dae_allocInt32Array(2);
  const varIdxsPtr = wasmExports.dae_allocInt32Array(2);

  wasmExports.dae_setInt32(eqIdxsPtr, 0, eq0);
  wasmExports.dae_setInt32(eqIdxsPtr, 1, eq1);

  wasmExports.dae_setInt32(varIdxsPtr, 0, varX);
  wasmExports.dae_setInt32(varIdxsPtr, 1, varY);

  console.log("eqIdxs in WASM:", wasmExports.dae_getInt32(eqIdxsPtr, 0), wasmExports.dae_getInt32(eqIdxsPtr, 1));
  console.log("varIdxs in WASM:", wasmExports.dae_getInt32(varIdxsPtr, 0), wasmExports.dae_getInt32(varIdxsPtr, 1));

  // 6. Run Gröbner triangularization
  console.log("Running groebner_triangularize in WASM...");
  const success = wasmExports.groebner_triangularize(daePtr, eqIdxsPtr, 2, varIdxsPtr, 2);
  assert.strictEqual(success, 1, "groebner_triangularize should succeed");

  const rewrittenLhs0 = wasmExports.dae_getEqLhs(daePtr, 0);
  const rewrittenRhs0 = wasmExports.dae_getEqRhs(daePtr, 0);
  const rewrittenLhs1 = wasmExports.dae_getEqLhs(daePtr, 1);
  const rewrittenRhs1 = wasmExports.dae_getEqRhs(daePtr, 1);

  console.log("Rewritten Eq 0: lhs =", rewrittenLhs0, ", rhs =", rewrittenRhs0);
  console.log("Rewritten Eq 1: lhs =", rewrittenLhs1, ", rhs =", rewrittenRhs1);

  assert.ok(rewrittenLhs0 !== 0xffffffff && rewrittenRhs0 !== 0xffffffff);
  assert.ok(rewrittenLhs1 !== 0xffffffff && rewrittenRhs1 !== 0xffffffff);

  console.log("Gröbner Basis triangularization successfully solved the loop in WASM!");

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("=== All WASM Gröbner Tests Passed Cleanly ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
