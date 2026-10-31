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

test("ModelScript Linter underlines only missing struct property and respects for-loop scopes", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const code = `
struct Vec2 {
  x: f64;
  y: f64;
}

function testFn(v: Vec2): f64 {
  let acc = 0.0;
  for (let i = 0; i < 3; i = i + 1) {
    acc = acc + v.x;
  }
  return v.missingProp;
}
`;

  const diags = compiler.lint(code);
  assert.equal(diags.length, 1, `Expected 1 diagnostic, got: ${JSON.stringify(diags)}`);
  const diag = diags[0]!;
  assert.equal(diag.code, ModelScriptErrorCode.UNKNOWN_STRUCT_FIELD.code);
  // "  return v.missingProp;" is on line 12, "missingProp" is columns 12..23 (1-indexed)
  assert.equal(diag.range.startLine, 12);
  assert.equal(diag.range.startColumn, 12);
  assert.equal(diag.range.endLine, 12);
  assert.equal(diag.range.endColumn, 23);
});

test("ModelScript Linter catches unknown type annotations (2003)", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const code = `
let item: MissingCustomType = 10;
`;

  const diags = compiler.lint(code);
  assert.ok(
    diags.some((d) => d.code === ModelScriptErrorCode.UNKNOWN_TYPE.code && d.message.includes("MissingCustomType")),
    `Expected UNKNOWN_TYPE (2003), got: ${JSON.stringify(diags)}`,
  );
});

test("ModelScript Linter catches type mismatch in variable declarations and returns (3001)", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const code = `
let flag: bool = "not-a-bool";

function getCount(): i32 {
  return "wrong-return";
}
`;

  const diags = compiler.lint(code);
  const mismatches = diags.filter((d) => d.code === ModelScriptErrorCode.TYPE_MISMATCH.code);
  assert.equal(mismatches.length, 2, `Expected 2 TYPE_MISMATCH diagnostics, got: ${JSON.stringify(diags)}`);
});

test("ModelScript Linter catches invalid binary operands (3002)", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const code = `
let a: i32 = 10;
let b: bool = true;
let bad = a - b;
`;

  const diags = compiler.lint(code);
  assert.ok(
    diags.some((d) => d.code === ModelScriptErrorCode.INVALID_BINARY_OPERAND.code && d.message.includes("-")),
    `Expected INVALID_BINARY_OPERAND (3002), got: ${JSON.stringify(diags)}`,
  );
});

test("ModelScript Linter catches non-iterable FLWOR collection (4001) and unbound FLWOR variables (4002)", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const code = `
let scalar: i32 = 42;
let badFlwor =
  for x in scalar
  where x > unboundFlworVar
  return x;
`;

  const diags = compiler.lint(code);
  assert.ok(
    diags.some((d) => d.code === ModelScriptErrorCode.NON_ITERABLE_COLLECTION.code),
    `Expected NON_ITERABLE_COLLECTION (4001), got: ${JSON.stringify(diags)}`,
  );
  assert.ok(
    diags.some(
      (d) => d.code === ModelScriptErrorCode.FLWOR_UNBOUND_VARIABLE.code && d.message.includes("unboundFlworVar"),
    ),
    `Expected FLWOR_UNBOUND_VARIABLE (4002), got: ${JSON.stringify(diags)}`,
  );
});
