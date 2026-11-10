// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintAmpl, parseAmplModel } from "../src/index.js";

test("AMPL Linter — detects undeclared sets, variables, and bounds conflicts", () => {
  const badModelSrc = `
    set REAL_SET;
    var x >= 10, <= 5; # Bounds conflict: 10 > 5

    var y{UNDECLARED_SET}; # Undeclared set

    minimize BadObj:
      x + z; # Undeclared variable z
  `;

  const model = parseAmplModel(badModelSrc);
  const diags = lintAmpl(model);

  assert.ok(diags.length >= 3, `Expected at least 3 diagnostics, found ${diags.length}`);

  const conflict = diags.find((d) => d.code === 9506);
  assert.ok(conflict, "Expected M9506 bounds conflict diagnostic");

  const undeclSet = diags.find((d) => d.code === 9502);
  assert.ok(undeclSet, "Expected M9502 undeclared set diagnostic");

  const undeclVar = diags.find((d) => d.code === 9504);
  assert.ok(undeclVar, "Expected M9504 undeclared variable diagnostic");
});

test("AMPL Linter — detects nonlinear terms on integer variables", () => {
  const minlpSrc = `
    var n integer >= 1;
    var x continuous >= 0;

    minimize Obj:
      x;

    s.t. NonlinearInteger:
      n^2 + x <= 100;
  `;

  const model = parseAmplModel(minlpSrc);
  const diags = lintAmpl(model);

  const warn = diags.find((d) => d.code === 9508);
  assert.ok(warn, "Expected M9508 nonlinear integer constraint warning");
  assert.strictEqual(warn.severity, "warning");
});
