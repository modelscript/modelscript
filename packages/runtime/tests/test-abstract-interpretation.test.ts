// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  ArraySegmentState,
  CFGEdgeKind,
  FixpointSolver,
  GenericCFG,
  NumericalInterval as Interval,
  OctagonDBM,
  ReducedProductDomain,
  ReducedProductState,
  type CFGInstruction,
} from "../src/index.js";

describe("Phase 1: Abstract Interpretation Generic Engine (@modelscript/runtime)", () => {
  it("should compute accurate RPO, Dominators, and Natural Loops on GenericCFG", () => {
    const cfg = new GenericCFG();
    const entry = cfg.createBlock("entry");
    const header = cfg.createBlock("loop_header");
    const body = cfg.createBlock("loop_body");
    const exit = cfg.createBlock("exit");

    cfg.addEdge(entry.id, header.id, CFGEdgeKind.Normal);
    cfg.addEdge(header.id, body.id, CFGEdgeKind.TrueBranch);
    cfg.addEdge(body.id, header.id, CFGEdgeKind.Normal); // back-edge
    cfg.addEdge(header.id, exit.id, CFGEdgeKind.FalseBranch);

    const rpo = cfg.computeRPO();
    assert.strictEqual(rpo[0], 0);
    assert.strictEqual(rpo[1], 1);
    assert.strictEqual(rpo.length, 4);

    const idom = cfg.computeDominators();
    assert.strictEqual(idom.get(header.id), entry.id);
    assert.strictEqual(idom.get(body.id), header.id);
    assert.strictEqual(idom.get(exit.id), header.id);

    const loops = cfg.detectNaturalLoops();
    assert.strictEqual(loops.length, 1);
    assert.strictEqual(loops[0]!.headerBlockId, header.id);
    assert.strictEqual(loops[0]!.backEdgeFromBlockId, body.id);
    assert.ok(loops[0]!.bodyBlockIds.has(header.id));
    assert.ok(loops[0]!.bodyBlockIds.has(body.id));
  });

  it("should verify Interval arithmetic, division-by-zero, and sqrt domain violations", () => {
    const a = new Interval(2, 10);
    const b = new Interval(3, 5);

    const sum = a.add(b);
    assert.strictEqual(sum.low, 5);
    assert.strictEqual(sum.high, 15);

    // Proven safe division (b does not contain 0)
    const divSafe = a.div(b);
    assert.strictEqual(divSafe.divisionByZero, "never");
    assert.ok(divSafe.result.low >= 2 / 5);
    assert.ok(divSafe.result.high <= 10 / 3);

    // Definite division by zero
    const zeroDiv = a.div(Interval.ZERO);
    assert.strictEqual(zeroDiv.divisionByZero, "definite");

    // Potential division by zero
    const riskyDiv = a.div(new Interval(-1, 2));
    assert.strictEqual(riskyDiv.divisionByZero, "possible");

    // Proven safe sqrt
    const sqrtSafe = new Interval(4, 16).sqrt();
    assert.strictEqual(sqrtSafe.domainViolation, "never");
    assert.strictEqual(sqrtSafe.result.low, 2);
    assert.strictEqual(sqrtSafe.result.high, 4);

    // Definite sqrt domain violation
    const sqrtDefinite = new Interval(-10, -1).sqrt();
    assert.strictEqual(sqrtDefinite.domainViolation, "definite");

    // Potential sqrt domain violation
    const sqrtPotential = new Interval(-2, 9).sqrt();
    assert.strictEqual(sqrtPotential.domainViolation, "possible");
    assert.strictEqual(sqrtPotential.result.low, 0);
    assert.strictEqual(sqrtPotential.result.high, 3);
  });

  it("should perform widening with literal thresholds on Octagon DBM", () => {
    const dbm1 = new OctagonDBM(2);
    dbm1.setInterval(0, 0, 10); // x0 in [0, 10]
    dbm1.close();

    const dbm2 = new OctagonDBM(2);
    dbm2.setInterval(0, 0, 25); // x0 in [0, 25]
    dbm2.close();

    const thresholds = [5, 10, 20, 50, 100];
    const widened = dbm1.widenWithThresholds(dbm2, thresholds);

    // Should jump to threshold 50 (closest threshold >= 25)
    const uBound = widened.getUpperBound(0);
    assert.strictEqual(uBound, 50);
  });

  it("should prove 1-based array bounds safety with ArraySegmentState", () => {
    const arr = new ArraySegmentState(new Interval(10, 10)); // length is fixed 10

    // Index i in [1, 10] -> 100% Proven Safe
    const safeIdx = arr.checkInBounds(new Interval(1, 10));
    assert.strictEqual(safeIdx.inBounds, "safe");

    // Index 0 in 1-based Modelica -> Definite Out of Bounds
    const oobIdx = arr.checkInBounds(new Interval(0, 0));
    assert.strictEqual(oobIdx.inBounds, "out_of_bounds");

    // Index 11 -> Definite Out of Bounds
    const oobIdx11 = arr.checkInBounds(new Interval(11, 15));
    assert.strictEqual(oobIdx11.inBounds, "out_of_bounds");

    // Index in [5, 15] -> Potential Out of Bounds (needs assert/precondition)
    const potIdx = arr.checkInBounds(new Interval(5, 15));
    assert.strictEqual(potIdx.inBounds, "potential_out_of_bounds");
  });

  it("should perform bidirectional reduction in ReducedProductDomain", () => {
    const domain = new ReducedProductDomain(4);
    let state = domain.top();

    // Set variable i in [1, 5]
    state = new ReducedProductState(
      state.intervals.set("i", new Interval(1, 5)),
      state.octagon,
      state.varIndices,
      state.arraySegments,
      false,
    ).reduce();

    assert.strictEqual(state.octagon.getLowerBound(state.getVarIndex("i")), 1);
    assert.strictEqual(state.octagon.getUpperBound(state.getVarIndex("i")), 5);

    // Impose relation j = i + 2 in Octagon
    const idxI = state.getVarIndex("i");
    const idxJ = state.getVarIndex("j");
    state.octagon.setDifference(idxJ, idxI, 2); // j - i <= 2
    state.octagon.setDifference(idxI, idxJ, -2); // i - j <= -2 <=> j - i >= 2
    state = state.reduce();

    // Interval for j should automatically tighten to [3, 7]!
    const jIval = state.intervals.get("j");
    assert.strictEqual(jIval.low, 3);
    assert.strictEqual(jIval.high, 7);
  });

  it("should run FixpointSolver on a loop proving complete absence of RTEs", () => {
    // Construct CFG for:
    // int i = 1;
    // int total = 0;
    // while (i <= 10) {
    //   total = total + (100 / i); // division check
    //   i = i + 1;
    // }
    const cfg = new GenericCFG();
    const entry = cfg.createBlock("entry");
    const header = cfg.createBlock("loop_header");
    const body = cfg.createBlock("loop_body");
    const exit = cfg.createBlock("exit");

    cfg.addEdge(entry.id, header.id, CFGEdgeKind.Normal);
    cfg.addEdge(header.id, body.id, CFGEdgeKind.TrueBranch);
    cfg.addEdge(body.id, header.id, CFGEdgeKind.Normal);
    cfg.addEdge(header.id, exit.id, CFGEdgeKind.FalseBranch);

    entry.addInstruction(cfg.createInstruction("ASSIGN_CONST", "i", [1]));
    entry.addInstruction(cfg.createInstruction("ASSIGN_CONST", "total", [0]));

    body.addInstruction(cfg.createInstruction("DIV", "tmp", ["100", "i"]));
    body.addInstruction(cfg.createInstruction("ADD", "total", ["total", "tmp"]));
    body.addInstruction(cfg.createInstruction("ADD_CONST", "i", ["i", 1]));

    const transfer = (inst: CFGInstruction, s: ReducedProductState, collect: any) => {
      let env = s.intervals;
      if (inst.op === "ASSIGN_CONST") {
        env = env.set(inst.targetVar!, Interval.const(inst.operands![0]));
      } else if (inst.op === "ADD_CONST") {
        const curr = env.get(inst.operands![0]);
        env = env.set(inst.targetVar!, curr.add(Interval.const(inst.operands![1])));
      } else if (inst.op === "DIV") {
        const denom = env.get(inst.operands![1]);
        const divCheck = denom.canBeZero();
        collect({
          instId: inst.id,
          category: "division_by_zero",
          verdict: denom.isDefiniteZero() ? "definite_bug" : divCheck ? "potential_bug" : "proven_safe",
          description: `Division by variable '${inst.operands![1]}' [${denom.low}, ${denom.high}]`,
        });
        const num = Interval.const(Number(inst.operands![0]));
        const res = num.div(denom);
        env = env.set(inst.targetVar!, res.result);
      }
      return new ReducedProductState(env, s.octagon, s.varIndices, s.arraySegments, false).reduce();
    };

    const solver = new FixpointSolver(cfg, transfer, [1, 2, 5, 10, 11, 20]);
    const summary = solver.solve();

    // The division '100 / i' must be PROVEN SAFE because i starts at 1 and increases!
    assert.strictEqual(summary.definiteBugCount, 0);
    assert.strictEqual(summary.potentialBugCount, 0);
    assert.ok(summary.provenSafeCount >= 1);
  });
});
