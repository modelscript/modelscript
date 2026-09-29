// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import test from "node:test";
import {
  ActivityEdgeKind,
  ActivityNodeKind,
  PinDirection,
  WasmFumlEngine,
} from "../src/statemachine/wasm_fuml_engine.js";

test("WasmFumlEngine - Discrete fUML Token & Activity Stepper", async (t) => {
  await t.test("executes sequential control flow with action behaviors", () => {
    const engine = new WasmFumlEngine();

    const nInit = engine.addNode("start", ActivityNodeKind.Initial);
    const nStep1 = engine.addNode("step1", ActivityNodeKind.Action, (_, ctx) => {
      ctx.count = (ctx.count || 0) + 10;
    });
    const nStep2 = engine.addNode("step2", ActivityNodeKind.Action, (_, ctx) => {
      ctx.count = (ctx.count || 0) * 2;
    });
    const nFinal = engine.addNode("end", ActivityNodeKind.ActivityFinal);

    engine.addEdge(nInit, nStep1, ActivityEdgeKind.Control);
    engine.addEdge(nStep1, nStep2, ActivityEdgeKind.Control);
    engine.addEdge(nStep2, nFinal, ActivityEdgeKind.Control);

    engine.init({ count: 5 });

    // Step 1: Initial fires, emits token to step1
    const res1 = engine.step();
    assert.deepStrictEqual(res1.firedNodeIds, [nInit]);
    assert.strictEqual(engine.getVariables().count, 5);
    assert.strictEqual(engine.isFinished(), false);

    // Step 2: step1 fires (count = 5 + 10 = 15)
    const res2 = engine.step();
    assert.deepStrictEqual(res2.firedNodeIds, [nStep1]);
    assert.strictEqual(engine.getVariables().count, 15);

    // Step 3: step2 fires (count = 15 * 2 = 30)
    const res3 = engine.step();
    assert.deepStrictEqual(res3.firedNodeIds, [nStep2]);
    assert.strictEqual(engine.getVariables().count, 30);

    // Step 4: final node fires, completing the activity
    const res4 = engine.step();
    assert.deepStrictEqual(res4.firedNodeIds, [nFinal]);
    assert.strictEqual(engine.isFinished(), true);
    assert.strictEqual(res4.isCompleted, true);
    assert.strictEqual(engine.getStatus(), "completed");
  });

  await t.test("executes concurrent fork and join synchronization", () => {
    const engine = new WasmFumlEngine();

    const nInit = engine.addNode("start", ActivityNodeKind.Initial);
    const nFork = engine.addNode("fork1", ActivityNodeKind.Fork);
    const nBranchA = engine.addNode("branchA", ActivityNodeKind.Action, (_, ctx) => {
      ctx.branchA_done = true;
    });
    const nBranchB = engine.addNode("branchB", ActivityNodeKind.Action, (_, ctx) => {
      ctx.branchB_done = true;
    });
    const nJoin = engine.addNode("join1", ActivityNodeKind.Join);
    const nFinal = engine.addNode("end", ActivityNodeKind.ActivityFinal);

    engine.addEdge(nInit, nFork, ActivityEdgeKind.Control);
    engine.addEdge(nFork, nBranchA, ActivityEdgeKind.Control);
    engine.addEdge(nFork, nBranchB, ActivityEdgeKind.Control);
    engine.addEdge(nBranchA, nJoin, ActivityEdgeKind.Control);
    engine.addEdge(nBranchB, nJoin, ActivityEdgeKind.Control);
    engine.addEdge(nJoin, nFinal, ActivityEdgeKind.Control);

    engine.init();

    // Step 1: Initial fires
    engine.step();
    // Step 2: Fork fires, duplicating tokens to branchA and branchB
    engine.step();

    // Step 3: Both branches are enabled and fire concurrently
    const res3 = engine.step();
    assert.ok(res3.firedNodeIds.includes(nBranchA));
    assert.ok(res3.firedNodeIds.includes(nBranchB));
    assert.strictEqual(engine.getVariables().branchA_done, true);
    assert.strictEqual(engine.getVariables().branchB_done, true);

    // Step 4: Join fires (now that both branches have produced tokens)
    const res4 = engine.step();
    assert.deepStrictEqual(res4.firedNodeIds, [nJoin]);

    // Step 5: Final fires
    const res5 = engine.step();
    assert.deepStrictEqual(res5.firedNodeIds, [nFinal]);
    assert.strictEqual(engine.isFinished(), true);
  });

  await t.test("evaluates decision node guards and routes through merge", () => {
    function runThermostat(temp: number): { pathTaken: string; finalStatus: string } {
      const engine = new WasmFumlEngine();

      const nInit = engine.addNode("start", ActivityNodeKind.Initial);
      const nDecision = engine.addNode("checkTemp", ActivityNodeKind.Decision);
      const nCool = engine.addNode("coolDown", ActivityNodeKind.Action, (_, ctx) => {
        ctx.mode = "cooling";
      });
      const nIdle = engine.addNode("idle", ActivityNodeKind.Action, (_, ctx) => {
        ctx.mode = "idle";
      });
      const nMerge = engine.addNode("merge1", ActivityNodeKind.Merge);
      const nFinal = engine.addNode("end", ActivityNodeKind.ActivityFinal);

      engine.addEdge(nInit, nDecision, ActivityEdgeKind.Control);
      engine.addEdge(nDecision, nCool, ActivityEdgeKind.Control, {
        guard: (ctx) => ctx.temp > 75,
      });
      engine.addEdge(nDecision, nIdle, ActivityEdgeKind.Control, {
        guard: (ctx) => ctx.temp <= 75,
      });
      engine.addEdge(nCool, nMerge, ActivityEdgeKind.Control);
      engine.addEdge(nIdle, nMerge, ActivityEdgeKind.Control);
      engine.addEdge(nMerge, nFinal, ActivityEdgeKind.Control);

      engine.init({ temp });
      const summary = engine.run(20);
      return { pathTaken: engine.getVariables().mode, finalStatus: summary.status };
    }

    const hotRun = runThermostat(90);
    assert.strictEqual(hotRun.pathTaken, "cooling");
    assert.strictEqual(hotRun.finalStatus, "completed");

    const coolRun = runThermostat(68);
    assert.strictEqual(coolRun.pathTaken, "idle");
    assert.strictEqual(coolRun.finalStatus, "completed");
  });

  await t.test("transfers object tokens across input and output pins", () => {
    const engine = new WasmFumlEngine();

    const nInit = engine.addNode("start", ActivityNodeKind.Initial);

    // Producer Action: generates x=10, y=20
    const nProduce = engine.addNode("produce", ActivityNodeKind.Action, () => {
      return { outX: 10, outY: 20 };
    });
    const pOutX = engine.addPin(nProduce, "outX", PinDirection.Output, "Real");
    const pOutY = engine.addPin(nProduce, "outY", PinDirection.Output, "Real");

    // Compute Action: receives inA, inB, produces product
    const nMultiply = engine.addNode("multiply", ActivityNodeKind.Action, (inputs, ctx) => {
      const prod = inputs.inA * inputs.inB;
      ctx.result = prod;
      return { outProd: prod };
    });
    const pInA = engine.addPin(nMultiply, "inA", PinDirection.Input, "Real");
    const pInB = engine.addPin(nMultiply, "inB", PinDirection.Input, "Real");
    const pOutProd = engine.addPin(nMultiply, "outProd", PinDirection.Output, "Real");

    const nFinal = engine.addNode("end", ActivityNodeKind.ActivityFinal);

    // Control flow from init to producer
    engine.addEdge(nInit, nProduce, ActivityEdgeKind.Control);

    // Object flows from producer pins to compute pins
    engine.addEdge(nProduce, nMultiply, ActivityEdgeKind.Object, {
      sourcePinId: pOutX,
      targetPinId: pInA,
    });
    engine.addEdge(nProduce, nMultiply, ActivityEdgeKind.Object, {
      sourcePinId: pOutY,
      targetPinId: pInB,
    });

    // Control flow from compute to final
    engine.addEdge(nMultiply, nFinal, ActivityEdgeKind.Control);

    engine.init();
    const summary = engine.run(20);

    assert.strictEqual(summary.status, "completed");
    assert.strictEqual(engine.getVariables().result, 200);
  });

  await t.test("supports time-travel reversible debugging via stepBack()", () => {
    const engine = new WasmFumlEngine();

    const nInit = engine.addNode("start", ActivityNodeKind.Initial);
    const n1 = engine.addNode("inc1", ActivityNodeKind.Action, (_, ctx) => {
      ctx.val = (ctx.val || 0) + 1;
    });
    const n2 = engine.addNode("inc2", ActivityNodeKind.Action, (_, ctx) => {
      ctx.val = (ctx.val || 0) + 10;
    });
    const n3 = engine.addNode("inc3", ActivityNodeKind.Action, (_, ctx) => {
      ctx.val = (ctx.val || 0) + 100;
    });
    const nFinal = engine.addNode("end", ActivityNodeKind.ActivityFinal);

    engine.addEdge(nInit, n1, ActivityEdgeKind.Control);
    engine.addEdge(n1, n2, ActivityEdgeKind.Control);
    engine.addEdge(n2, n3, ActivityEdgeKind.Control);
    engine.addEdge(n3, nFinal, ActivityEdgeKind.Control);

    engine.init({ val: 0 });

    engine.step(); // Initial
    engine.step(); // inc1 -> val = 1
    assert.strictEqual(engine.getVariables().val, 1);

    engine.step(); // inc2 -> val = 11
    assert.strictEqual(engine.getVariables().val, 11);

    engine.step(); // inc3 -> val = 111
    assert.strictEqual(engine.getVariables().val, 111);

    // Now step back!
    assert.strictEqual(engine.stepBack(), true);
    assert.strictEqual(engine.getVariables().val, 11);

    assert.strictEqual(engine.stepBack(), true);
    assert.strictEqual(engine.getVariables().val, 1);

    // Re-step forward to completion
    const summary = engine.run(10);
    assert.strictEqual(summary.status, "completed");
    assert.strictEqual(engine.getVariables().val, 111);
  });
});
