// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { ModelScriptCompiler } from "../src/index.js";

test("ModelScript executes mini-AssemblyScript algorithms", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const code = `
function fibonacci(n: i32): i32 {
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  let i = 2;
  while (i <= n) {
    let next = a + b;
    a = b;
    b = next;
    i = i + 1;
  }
  return b;
}

return fibonacci(10);
`;

  const result = compiler.executeJs(code);
  assert.equal(result, 55, "Fibonacci(10) should equal 55");
});

test("ModelScript compiles and executes JSONiq FLWOR queries", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const code = `
let selected = 
  for c in components
  let p := c.pressure
  where p > 150
  order by p descending
  return { name: c.name, pressure: p };

return selected;
`;

  const context = {
    components: [
      { name: "TankA", pressure: 100 },
      { name: "Pump1", pressure: 280 },
      { name: "ValveX", pressure: 50 },
      { name: "PipeB", pressure: 310 },
      { name: "Chamber", pressure: 190 },
    ],
  };

  const result = compiler.executeJs(code, context) as any[];
  assert.ok(Array.isArray(result), "Result should be an array");
  assert.equal(result.length, 3, "Should filter down to components with pressure > 150");

  // Sorted descending: PipeB (310), Pump1 (280), Chamber (190)
  assert.deepEqual(result, [
    { name: "PipeB", pressure: 310 },
    { name: "Pump1", pressure: 280 },
    { name: "Chamber", pressure: 190 },
  ]);
});

test("ModelScript handles struct instantiation and property access", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const code = `
struct Vector2D {
  x: f64;
  y: f64;
}

let v = new Vector2D(3, 4);
return (v.x * v.x) + (v.y * v.y);
`;

  const result = compiler.executeJs(code);
  assert.equal(result, 25, "Vector2D magnitude squared should be 25");
});
