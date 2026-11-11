// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatChoiceLabel, isFormula, tryEvaluateFormula } from "../src/components/morsel/util/formula.js";

describe("Morsel Formula Evaluator & Utilities", () => {
  it("detects formulas vs plain numbers or booleans", () => {
    assert.equal(isFormula("10"), false);
    assert.equal(isFormula("-5.2"), false);
    assert.equal(isFormula("1e-4"), false);
    assert.equal(isFormula("true"), false);
    assert.equal(isFormula("false"), false);
    assert.equal(isFormula(""), false);
    assert.equal(isFormula("-"), false);

    assert.equal(isFormula("100 * 2.5"), true);
    assert.equal(isFormula("2*Modelica.Constants.pi*f/alpha"), true);
    assert.equal(isFormula("1/sqrt(2^(1/n)-1)"), true);
    assert.equal(isFormula("if normalized then 1 else 2"), true);
    assert.equal(isFormula("2^3"), true);
    assert.equal(isFormula("f * 2"), true);
  });

  it("evaluates basic arithmetic expressions", () => {
    const res1 = tryEvaluateFormula("100 * 2.5");
    assert.equal(res1.success, true);
    assert.equal(res1.value, 250);
    assert.equal(res1.formatted, "250");

    const res2 = tryEvaluateFormula("(10 + 20) / 2");
    assert.equal(res2.success, true);
    assert.equal(res2.value, 15);
    assert.equal(res2.formatted, "15");
  });

  it("evaluates exponentiation and mathematical functions", () => {
    const res1 = tryEvaluateFormula("2^3");
    assert.equal(res1.success, true);
    assert.equal(res1.value, 8);

    const res2 = tryEvaluateFormula("sqrt(144)");
    assert.equal(res2.success, true);
    assert.equal(res2.value, 12);
    assert.equal(res2.formatted, "12");

    const res3 = tryEvaluateFormula("min(5, 10) + max(2, 4)");
    assert.equal(res3.success, true);
    assert.equal(res3.value, 9);
  });

  it("evaluates Modelica constants and expressions with variable scope", () => {
    const scope = { f: 10, alpha: 1 };
    const res = tryEvaluateFormula("2*Modelica.Constants.pi*f/alpha", scope);
    assert.equal(res.success, true);
    assert.ok(typeof res.value === "number");
    assert.ok(Math.abs((res.value as number) - 62.831853) < 0.001);
    assert.equal(res.formatted, "62.83185");
  });

  it("evaluates conditional if-then-else expressions", () => {
    const scope = { normalized: true, n: 2 };
    const res1 = tryEvaluateFormula("if normalized then 1/sqrt(2^(1/n)-1) else 1", scope);
    assert.equal(res1.success, true);
    assert.ok(typeof res1.value === "number");
    // 2^(1/2) - 1 = sqrt(2) - 1 = 0.41421356...
    // sqrt(0.41421356) = 0.643594...
    // 1 / 0.643594... = 1.55377...
    assert.ok(Math.abs((res1.value as number) - 1.55377) < 0.001);

    const scope2 = { normalized: false, n: 2 };
    const res2 = tryEvaluateFormula("if normalized then 1/sqrt(2^(1/n)-1) else 1", scope2);
    assert.equal(res2.success, true);
    assert.equal(res2.value, 1);
    assert.equal(res2.formatted, "1");
  });

  it("handles unresolved identifiers gracefully", () => {
    const res = tryEvaluateFormula("unknown_var * 2");
    assert.equal(res.success, false);
    assert.ok(res.error?.includes("Unresolved identifier"));
  });

  it("formats choice labels by stripping namespace prefixes", () => {
    assert.equal(
      formatChoiceLabel("Modelica.Blocks.Types.Init.SteadyState", "Modelica.Blocks.Types.Init.SteadyState"),
      "SteadyState",
    );
    assert.equal(formatChoiceLabel(undefined, "Modelica.Blocks.Types.Init.NoInit"), "NoInit");
    assert.equal(
      formatChoiceLabel("Custom Friendly Label", "Modelica.Blocks.Types.Init.InitialState"),
      "Custom Friendly Label",
    );
  });
});
