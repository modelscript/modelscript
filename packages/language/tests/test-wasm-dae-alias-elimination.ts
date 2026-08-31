// SPDX-License-Identifier: AGPL-3.0-or-later
import * as assert from "assert";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { language, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testGrammar = language({
  name: "DaeAliasDSL",
  rules: {
    Root: ($) => seq(semanticToken("keyword", "model"), "x", ";"),
  },
  extras: ($) => [/\s+/],
});

async function runTests() {
  console.log("=== Testing WASM DaeBuilder Alias Elimination Engine ===");

  const result = buildParser(testGrammar as any);
  const tmpDir = path.join(__dirname, "scratch_build_dae_alias");
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const file of result.assemblyScriptFiles) {
    fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
  }

  const ascPath =
    [
      path.resolve(__dirname, "../../node_modules/.bin/asc"),
      path.resolve(__dirname, "../../../node_modules/.bin/asc"),
      "npx asc",
    ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
  const parserTs = path.join(tmpDir, "parser.ts");
  const outWasm = path.join(tmpDir, "parser.wasm");

  console.log("Compiling AssemblyScript to WASM via asc...");
  const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
  try {
    childProcess.execSync(ascCmd, { stdio: "pipe" });
  } catch (err: any) {
    if (err.stdout) console.error("ASC STDOUT:", err.stdout.toString());
    if (err.stderr) console.error("ASC STDERR:", err.stderr.toString());
    throw err;
  }

  const wasm = fs.readFileSync(outWasm);
  const wasmModule = await WebAssembly.compile(wasm);
  const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });

  const imports = {
    env: {
      memory: memory,
      abort: () => console.log("ABORT!"),
      logNode: () => {},
      debugLog: () => {},
    },
    JavaScript: {
      debugLog: () => {},
      logNode: () => {},
    },
    engine: {
      debugLog: () => {},
    },
    parser: { logInt: () => {} },
    recovery: {},
    host: { runHostQuery: () => {} },
  };

  const instance = await WebAssembly.instantiate(wasmModule, imports);
  const wasmExports = instance.exports as any;

  // Test 1: Simple alias elimination
  console.log("Test 1: Simple alias elimination...");
  {
    const b = wasmExports.dae_createBuilder();
    const nameX = 101;
    const nameY = 102;

    const varX = wasmExports.dae_addVariable(b, nameX, 0, 0, 0, 0.0, 0);
    const varY = wasmExports.dae_addVariable(b, nameY, 0, 0, 0, 0.0, 0);

    const exprX = wasmExports.dae_addExpression(b, 0, nameX);
    const exprY = wasmExports.dae_addExpression(b, 0, nameY);

    wasmExports.dae_addEquation(b, 0, exprX, exprY, 0);

    const lit10 = wasmExports.dae_addRealLiteral(b, 10.0);
    const exprUseX = wasmExports.dae_addExpression(b, 0, nameX);
    wasmExports.dae_addExpression(b, 5, 0, exprUseX, lit10);

    const rewritten = wasmExports.dae_eliminateAliases(b);
    assert.ok(rewritten >= 1, `Expected at least 1 rewritten expression, got ${rewritten}`);

    const aliasTargetX = wasmExports.dae_getAlias(b, varX);
    assert.ok(aliasTargetX === nameX || aliasTargetX === nameY, `Unexpected alias target ${aliasTargetX}`);
    console.log("  Passed!");
  }

  // Test 2: Multi-step transitive alias chains
  console.log("Test 2: Transitive alias chains (a = b, b = c, c = d)...");
  {
    const b = wasmExports.dae_createBuilder();
    const nameA = 201;
    const nameB = 202;
    const nameC = 203;
    const nameD = 204;

    wasmExports.dae_addVariable(b, nameA, 0, 0, 0, 0.0, 0);
    wasmExports.dae_addVariable(b, nameB, 0, 0, 0, 0.0, 0);
    wasmExports.dae_addVariable(b, nameC, 0, 0, 0, 0.0, 0);
    wasmExports.dae_addVariable(b, nameD, 0, 0, 0, 0.0, 0);

    const exprA = wasmExports.dae_addExpression(b, 0, nameA);
    const exprB = wasmExports.dae_addExpression(b, 0, nameB);
    const exprC = wasmExports.dae_addExpression(b, 0, nameC);
    const exprD = wasmExports.dae_addExpression(b, 0, nameD);

    wasmExports.dae_addEquation(b, 0, exprA, exprB, 0);
    wasmExports.dae_addEquation(b, 0, exprB, exprC, 0);
    wasmExports.dae_addEquation(b, 0, exprC, exprD, 0);

    const rewritten = wasmExports.dae_eliminateAliases(b);
    assert.ok(rewritten >= 1, `Expected rewritten >= 1, got ${rewritten}`);
    console.log("  Passed!");
  }

  // Test 3: Connect equations
  console.log("Test 3: Connect equations (EqKind.Connect)...");
  {
    const b = wasmExports.dae_createBuilder();
    const port1V = 301;
    const port2V = 302;

    wasmExports.dae_addVariable(b, port1V, 0, 0, 0, 0.0, 0);
    wasmExports.dae_addVariable(b, port2V, 0, 0, 0, 0.0, 0);

    const expr1 = wasmExports.dae_addExpression(b, 0, port1V);
    const expr2 = wasmExports.dae_addExpression(b, 0, port2V);

    wasmExports.dae_addEquation(b, 6, expr1, expr2, 0);

    const rewritten = wasmExports.dae_eliminateAliases(b);
    assert.ok(rewritten >= 1, `Expected rewritten >= 1, got ${rewritten}`);
    console.log("  Passed!");
  }

  // Test 4: Type mismatch prevention
  console.log("Test 4: Type mismatch prevention (Real vs Integer)...");
  {
    const b = wasmExports.dae_createBuilder();
    const nameReal = 401;
    const nameInt = 402;

    const varR = wasmExports.dae_addVariable(b, nameReal, 0, 0, 0, 0.0, 0);
    const varI = wasmExports.dae_addVariable(b, nameInt, 1, 0, 0, 0.0, 0);

    const exprR = wasmExports.dae_addExpression(b, 0, nameReal);
    const exprI = wasmExports.dae_addExpression(b, 0, nameInt);

    wasmExports.dae_addEquation(b, 0, exprR, exprI, 0);

    const rewritten = wasmExports.dae_eliminateAliases(b);
    assert.strictEqual(rewritten, 0, `Expected 0 rewritten for incompatible types, got ${rewritten}`);
    assert.strictEqual(wasmExports.dae_getAlias(b, varR), nameReal);
    assert.strictEqual(wasmExports.dae_getAlias(b, varI), nameInt);
    console.log("  Passed!");
  }

  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("All WASM DaeBuilder Alias Elimination tests PASSED!");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
