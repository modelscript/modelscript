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
});
