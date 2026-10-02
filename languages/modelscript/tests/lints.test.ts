// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { ModelScriptCompiler, ModelScriptErrorCode } from "../src/index.js";

test("ModelScript Linter reports 0 diagnostics on sound code", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const code = `
struct Point {
  x: f64;
  y: f64;
}

function compute(p: Point): f64 {
  let factor = 2;
  return p.x * factor + p.y;
}
`;

  const diags = compiler.lint(code);
  assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
});

test("ModelScript Linter catches undefined variables", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const code = `
let a = 10;
let b = a + undeclaredVar;
`;

  const diags = compiler.lint(code);
  assert.ok(
    diags.some((d) => d.code === ModelScriptErrorCode.UNDEFINED_VARIABLE.code && d.message.includes("undeclaredVar")),
  );
});

test("ModelScript Linter catches duplicate declarations in same scope", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const code = `
let x = 10;
let x = 20;
`;

  const diags = compiler.lint(code);
  assert.ok(diags.some((d) => d.code === ModelScriptErrorCode.DUPLICATE_DECLARATION.code && d.message.includes("x")));
});

test("ModelScript Linter catches function argument count mismatch", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const code = `
function add(a: i32, b: i32): i32 {
  return a + b;
}

let result = add(1, 2, 3);
`;

  const diags = compiler.lint(code);
  assert.ok(
    diags.some((d) => d.code === ModelScriptErrorCode.ARGUMENT_COUNT_MISMATCH.code && d.message.includes("add")),
  );
});

test("ModelScript Linter respects FLWOR scopes", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  // Valid FLWOR: item and ratio are bound in for and let
  const validFlwor = `
let items = [1, 2, 3];
let filtered = 
  for item in items
  let ratio := item * 2
  where ratio > 3
  return item + ratio;
`;

  const diagsValid = compiler.lint(validFlwor);
  assert.equal(
    diagsValid.length,
    0,
    `FLWOR with bound variables should have 0 diagnostics: ${JSON.stringify(diagsValid)}`,
  );

  // Invalid FLWOR: unBoundVar is used in where clause without being defined
  const invalidFlwor = `
let items = [1, 2, 3];
let filtered = 
  for item in items
  where item > unBoundVar
  return item;
`;

  const diagsInvalid = compiler.lint(invalidFlwor);
  assert.ok(
    diagsInvalid.some(
      (d) => d.code === ModelScriptErrorCode.UNDEFINED_VARIABLE.code && d.message.includes("unBoundVar"),
    ),
  );
});
