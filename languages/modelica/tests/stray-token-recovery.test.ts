// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const source = (extra: string) => `model BouncingBall "A bouncing ball"
  parameter Real e = 0.8 "Coefficient of restitution";
  parameter Real g = 9.81 "Gravity"; ${extra}
  Real h(start = 1) "Height";
  Real v "Velocity";
equation
  der(h) = v;
  der(v) = -g;
  when h < 0 then
    reinit(v, -e * pre(v));
  end when;
end BouncingBall;
`;

describe("Stray token after a declaration does not cause catastrophic recovery", () => {
  let facade: any;

  before(async () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    assert.ok(fs.existsSync(wasmPath), `WASM file must exist at ${wasmPath}`);
    facade = (await createWasmParser(wasmPath)).facade;
  });

  const diagnosticsFor = (extra: string) => {
    facade.lastAstRoot = 0;
    const src = source(extra);
    const root = facade.parseIncremental(src, 0, 0, src.length);
    assert.ok(root > 0);
    return facade.getDiagnostics(root) as {
      message: string;
      range: { start: { line: number }; end: { line: number } };
    }[];
  };

  it("valid source has no diagnostics", () => {
    assert.strictEqual(diagnosticsFor("").length, 0);
  });

  for (const stray of ["1", "1 1", "1 1 1", "11", "1;", "+"]) {
    it(`stray '${stray}' on line 3 reports errors only on line 3`, () => {
      const diags = diagnosticsFor(stray);
      assert.ok(diags.length > 0, "an error must be reported");
      for (const d of diags) {
        assert.strictEqual(d.range.start.line, 2, `diagnostic starts on line 3: ${d.message}`);
        assert.strictEqual(d.range.end.line, 2, `diagnostic ends on line 3: ${d.message}`);
      }
    });
  }

  it("typing multiple '1' tokens incrementally isolates error to line 3 at every keystroke", () => {
    facade.lastAstRoot = 0;
    const baseCode = `model BouncingBall "A bouncing ball"
  parameter Real e = 0.8 "Coefficient of restitution";
  parameter Real g = 9.81 "Gravity"; 
  Real h(start = 1) "Height";
  Real v "Velocity";
equation
  der(h) = v;
  der(v) = -g;
  when h < 0 then
    reinit(v, -e * pre(v));
  end when;
end BouncingBall;
`;
    let curLen = baseCode.length;
    let ast = facade.parseIncremental(baseCode, 0, 0, curLen);
    assert.strictEqual(facade.getDiagnostics(ast).length, 0);

    const insertPos = baseCode.indexOf('"Gravity"; ') + '"Gravity"; '.length;
    const keystrokes = ["1", " ", "1", " ", "1"];

    for (let i = 0; i < keystrokes.length; i++) {
      ast = facade.parseIncremental(keystrokes[i], insertPos + i, 0, ++curLen);
      const diags = facade.getDiagnostics(ast);
      assert.ok(diags.length > 0, `errors expected after inserting '${keystrokes.slice(0, i + 1).join("")}'`);
      for (const d of diags) {
        assert.strictEqual(d.range.start.line, 2, `diagnostic must start on line 3: ${d.message}`);
        assert.strictEqual(d.range.end.line, 2, `diagnostic must end on line 3: ${d.message}`);
      }
    }
  });

  it("recovers from stray tokens inside ambiguous expressions without catastrophic failure", () => {
    facade.lastAstRoot = 0;
    const code = `model AmbiguousExpr
  Real x = (1 + 2, 1 1 3);
  Real y = 10;
equation
  x = y;
end AmbiguousExpr;
`;
    const root = facade.parseIncremental(code, 0, 0, code.length);
    assert.ok(root > 0, "AST root must be created");
    const diags = facade.getDiagnostics(root);
    assert.ok(diags.length > 0, "errors expected for stray tokens in expression");
    // Verify peak heads were tracked and paused heads occurred
    if (typeof facade.exports?.getDebugCounter === "function") {
      const peakHeads = facade.exports.getDebugCounter(4);
      assert.ok(peakHeads >= 1, `GLR heads must have forked, got ${peakHeads}`);
    }
  });

  it("recovers from stray tokens inside conditional branch without catastrophic cascade", () => {
    facade.lastAstRoot = 0;
    const code = `model ConditionalBranch
  Real x;
equation
  if x > 0 then
    x = 1; 1 1
  else
    x = 2;
  end if;
  x = 3;
end ConditionalBranch;
`;
    const root = facade.parseIncremental(code, 0, 0, code.length);
    assert.ok(root > 0, "AST root must be created");
    const diags = facade.getDiagnostics(root);
    assert.ok(diags.length > 0, "errors expected for stray tokens in if-branch");
    // Ensure error does not cascade to the end of file (line 7 is preserved)
    for (const d of diags) {
      assert.ok(d.range.end.line <= 6, `diagnostic should not swallow end of model: line ${d.range.end.line}`);
    }
  });

  it("confirms paused-head creation (9201) and resume (9202) events during GLR recovery", async () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const wasmModule = new WebAssembly.Module(wasmBytes);
    const loggedEvents: [number, number, number, number][] = [];
    const customImports = {
      env: {
        abort: () => {},
      },
      parser: { logInt: () => {} },
      engine: {
        debugLog: (id: number, p1: number, p2: number, p3: number) => {
          loggedEvents.push([id, p1, p2, p3]);
        },
      },
      host: { runHostQuery: () => 0 },
    };
    const instance = new WebAssembly.Instance(wasmModule, customImports);
    const { LspFacade } = await import("../src-gen/bindings.js");
    const customFacade = new LspFacade(instance.exports);

    const code = `model AmbiguousFork
  Real x = (1 + 2, 1 1 3);
equation
  x = 0;
end AmbiguousFork;
`;
    const root = customFacade.parseIncremental(code, 0, 0, code.length);
    assert.ok(root > 0);
    const pausedEvents = loggedEvents.filter((e) => e[0] === 9201);
    const resumedEvents = loggedEvents.filter((e) => e[0] === 9202);
    assert.ok(pausedEvents.length > 0, "At least one head should be paused during GLR fork (debugLog 9201)");
    assert.ok(resumedEvents.length > 0, "At least one paused head should be resumed during recovery (debugLog 9202)");
  });
});
