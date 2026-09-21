import expect from "expect";
import { describe, it } from "node:test";
import { ModelicaBoundsAnalyzer, OctagonDBM } from "../src/analysis/bounds-analyzer.js";

describe("Modelica Octagon DBM & Static Bounds Analyzer", () => {
  it("should enforce difference constraints and propagate transitivities", () => {
    const dbm = new OctagonDBM(3);

    // Assume x0 - x1 <= 4
    dbm.assumeDiff(0, 1, 4);
    // Assume x1 - x2 <= 3
    dbm.assumeDiff(1, 2, 3);

    // Transitivity implies x0 - x2 <= 7
    expect(dbm.checkDiff(0, 2, 7)).toBe(true);
    expect(dbm.checkDiff(0, 2, 6)).toBe(false);
  });

  it("should enforce unary intervals and retrieve bounds", () => {
    const dbm = new OctagonDBM(2);

    // Assume 1 <= x0 <= 10
    dbm.assumeInterval(0, 1, 10);

    expect(dbm.checkInterval(0, 1, 10)).toBe(true);
    expect(dbm.checkInterval(0, 2, 8)).toBe(false);
    expect(dbm.getLowerBound(0)).toBe(1);
    expect(dbm.getUpperBound(0)).toBe(10);
    expect(dbm.hasNegativeCycle()).toBe(false);
  });

  it("should detect contradictory intervals via negative cycles", () => {
    const dbm = new OctagonDBM(2);

    // Assume lower bound 10, upper bound 5 (contradiction)
    dbm.assumeInterval(0, 10, 5);

    expect(dbm.hasNegativeCycle()).toBe(true);
  });

  it("should verify static array in-bounds and out-of-bounds subscripts", () => {
    const analyzer = new ModelicaBoundsAnalyzer();

    // Constant array indexing
    const validConst = analyzer.checkArraySubscript("arr", 1, 5, 3);
    expect(validConst).toBeNull();

    const invalidConstHigh = analyzer.checkArraySubscript("arr", 1, 5, 6);
    expect(invalidConstHigh).not.toBeNull();
    expect(invalidConstHigh?.subscriptText).toBe("6");
    expect(invalidConstHigh?.dimensionSize).toBe(5);

    const invalidConstLow = analyzer.checkArraySubscript("arr", 1, 5, 0);
    expect(invalidConstLow).not.toBeNull();
    expect(invalidConstLow?.subscriptText).toBe("0");

    // Loop-bounded array indexing: for i in 1:5
    analyzer.setLoopRange("i", 1, 5);

    const validLoop = analyzer.checkArraySubscript("arr", 1, 5, { baseVar: "i", offset: 0 });
    expect(validLoop).toBeNull();

    const invalidLoopOffset = analyzer.checkArraySubscript("arr", 1, 5, { baseVar: "i", offset: 1 });
    expect(invalidLoopOffset).not.toBeNull();
    expect(invalidLoopOffset?.subscriptText).toBe("i + 1");
  });

  it("should detect parameter bound contradictions", () => {
    const analyzer = new ModelicaBoundsAnalyzer();
    analyzer.setParamInterval("speedLimit", 50, 40); // min 50 > max 40
    expect(analyzer.hasContradiction()).toBe(true);

    const validAnalyzer = new ModelicaBoundsAnalyzer();
    validAnalyzer.setParamInterval("speedLimit", 20, 60);
    expect(validAnalyzer.hasContradiction()).toBe(false);
  });
});
