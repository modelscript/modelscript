// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect } from "expect";
import { describe, it } from "node:test";
import { interpolateSignal, STLEvaluator, STLFormula } from "../src/analysis/stl_robustness.js";

describe("Signal Temporal Logic (STL) Quantitative Robustness", () => {
  it("should accurately interpolate continuous values between discrete samples", () => {
    const times = [0, 1, 2, 3];
    const values = [10, 20, 40, 10];

    expect(interpolateSignal(times, values, 0)).toBe(10);
    expect(interpolateSignal(times, values, 0.5)).toBe(15);
    expect(interpolateSignal(times, values, 1.5)).toBe(30);
    expect(interpolateSignal(times, values, 3)).toBe(10);
  });

  it("should evaluate atomic predicates with signed robustness margin", () => {
    const times = [0, 1, 2];
    const signals = { speed: [50, 70, 90] };

    // speed <= 100 (satisfied with margin 100 - 50 = +50 at t=0)
    const f1: STLFormula = {
      type: "predicate",
      variable: "speed",
      operator: "<=",
      threshold: 100,
    };
    const res1 = STLEvaluator.evaluate(f1, times, signals);
    expect(res1.isSatisfied).toBe(true);
    expect(res1.robustness).toBeCloseTo(50, 3);

    // speed <= 40 (violated with negative margin 40 - 50 = -10 at t=0)
    const f2: STLFormula = {
      type: "predicate",
      variable: "speed",
      operator: "<=",
      threshold: 40,
    };
    const res2 = STLEvaluator.evaluate(f2, times, signals);
    expect(res2.isSatisfied).toBe(false);
    expect(res2.robustness).toBeCloseTo(-10, 3);
  });

  it("should evaluate temporal operator Always (Box_[a, b])", () => {
    const times = [0, 1, 2, 3, 4, 5];
    const signals = { temp: [20, 22, 24, 26, 25, 22] };

    // Always temp <= 30 on [0, 5] -> satisfied (max temp is 26, margin 30 - 26 = +4)
    const fSafe: STLFormula = {
      type: "always",
      interval: [0, 5],
      formula: {
        type: "predicate",
        variable: "temp",
        operator: "<=",
        threshold: 30,
      },
    };
    const resSafe = STLEvaluator.evaluate(fSafe, times, signals);
    expect(resSafe.isCertifiedSafe ?? resSafe.isSatisfied).toBe(true);
    expect(resSafe.robustness).toBeCloseTo(4, 3);

    // Always temp <= 23 on [0, 5] -> violated at t=2 (temp=24, margin 23 - 26 = -3)
    const fViolated: STLFormula = {
      type: "always",
      interval: [0, 5],
      formula: {
        type: "predicate",
        variable: "temp",
        operator: "<=",
        threshold: 23,
      },
    };
    const resViolated = STLEvaluator.evaluate(fViolated, times, signals);
    expect(resViolated.isSatisfied).toBe(false);
    expect(resViolated.robustness).toBeCloseTo(-3, 3);
    expect(resViolated.violationTime).toBeDefined();
    expect(resViolated.counterexample?.variable).toBe("temp");
  });

  it("should evaluate temporal operator Eventually (Diamond_[a, b])", () => {
    const times = [0, 1, 2, 3, 4, 5];
    const signals = { altitude: [0, 100, 500, 1200, 2000, 2500] };

    // Eventually altitude >= 1000 on [0, 5] -> satisfied (max altitude is 2500, margin 2500 - 1000 = +1500)
    const fAchieve: STLFormula = {
      type: "eventually",
      interval: [0, 5],
      formula: {
        type: "predicate",
        variable: "altitude",
        operator: ">=",
        threshold: 1000,
      },
    };
    const resAchieve = STLEvaluator.evaluate(fAchieve, times, signals);
    expect(resAchieve.isSatisfied).toBe(true);
    expect(resAchieve.robustness).toBeCloseTo(1500, 3);

    // Eventually altitude >= 5000 on [0, 5] -> violated (margin 2500 - 5000 = -2500)
    const fUnreachable: STLFormula = {
      type: "eventually",
      interval: [0, 5],
      formula: {
        type: "predicate",
        variable: "altitude",
        operator: ">=",
        threshold: 5000,
      },
    };
    const resUnreachable = STLEvaluator.evaluate(fUnreachable, times, signals);
    expect(resUnreachable.isSatisfied).toBe(false);
    expect(resUnreachable.robustness).toBeCloseTo(-2500, 3);
  });

  it("should evaluate compound formulas with AND/OR", () => {
    const times = [0, 1, 2];
    const signals = {
      pressure: [10, 15, 20],
      temp: [50, 60, 70],
    };

    const fAnd: STLFormula = {
      type: "and",
      formulas: [
        { type: "predicate", variable: "pressure", operator: "<=", threshold: 25 },
        { type: "predicate", variable: "temp", operator: "<=", threshold: 65 },
      ],
    };

    // At t=0: pressure margin is 25 - 10 = 15; temp margin is 65 - 50 = 15; min = 15
    const res = STLEvaluator.evaluate(fAnd, times, signals);
    expect(res.isSatisfied).toBe(true);
    expect(res.robustness).toBe(15);
  });
});
