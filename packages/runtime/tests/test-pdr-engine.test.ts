// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import test from "node:test";
import { PdrEngine, StateKind, WasmRtcStateMachine } from "../src/index.js";

test("WasmPdrEngine - Property Directed Reachability (IC3)", async (t) => {
  await t.test("proves universal inductive invariant when state space stabilizes without reaching hazard", () => {
    const sm = new WasmRtcStateMachine();

    const sInit = sm.addState("Initial", StateKind.Initial);
    const sOperational = sm.addState("Operational", StateKind.Simple);
    const sDegraded = sm.addState("Degraded", StateKind.Simple);
    const sHazard = sm.addState("MeltdownHazard", StateKind.Simple);

    // Transitions: Initial -> Operational <-> Degraded. MeltdownHazard is never reachable.
    sm.addTransition(sInit, sOperational);
    sm.addTransition(sOperational, sDegraded);
    sm.addTransition(sDegraded, sOperational);

    const pdr = new PdrEngine(sm);
    const result = pdr.check({
      name: "Safety_NoMeltdown",
      forbiddenStates: ["MeltdownHazard"],
    });

    assert.strictEqual(result.isProvenUniversal, true);
    assert.ok(result.convergedDepth! >= 1);
    assert.ok(result.inductiveLemmas && result.inductiveLemmas.length > 0);
    assert.match(result.summary, /Inductive safety proof certified by PDR/);
  });

  await t.test("extracts backward counterexample witness trace when forbidden state is reached", () => {
    const sm = new WasmRtcStateMachine();

    const sInit = sm.addState("Initial", StateKind.Initial);
    const sRunning = sm.addState("Running", StateKind.Simple);
    const sOverheat = sm.addState("Overheat", StateKind.Simple);
    const sCritical = sm.addState("CriticalFailure", StateKind.Simple);

    // Initial -> Running -> Overheat -> CriticalFailure
    sm.addTransition(sInit, sRunning);
    sm.addTransition(sRunning, sOverheat);
    sm.addTransition(sOverheat, sCritical);

    const pdr = new PdrEngine(sm);
    const result = pdr.check({
      name: "Safety_NoCriticalFailure",
      forbiddenStates: ["CriticalFailure"],
    });

    assert.strictEqual(result.isProvenUniversal, false);
    assert.ok(result.counterexample);
    assert.strictEqual(result.counterexample.length, 4); // steps 0, 1, 2, 3
    assert.strictEqual(result.counterexample[0]?.stateName, "Initial");
    assert.strictEqual(result.counterexample[1]?.stateName, "Running");
    assert.strictEqual(result.counterexample[2]?.stateName, "Overheat");
    assert.strictEqual(result.counterexample[3]?.stateName, "CriticalFailure");
    assert.match(result.summary, /PDR discovered counterexample/);
  });

  await t.test("detects step 0 immediate violation if initial state is forbidden", () => {
    const sm = new WasmRtcStateMachine();

    const sInit = sm.addState("FaultyInit", StateKind.Initial);
    const sNext = sm.addState("Next", StateKind.Simple);
    sm.addTransition(sInit, sNext);

    const pdr = new PdrEngine(sm);
    const result = pdr.check({
      name: "InitialSafety",
      forbiddenStates: ["FaultyInit"],
    });

    assert.strictEqual(result.isProvenUniversal, false);
    assert.strictEqual(result.framesCount, 0);
    assert.strictEqual(result.counterexample?.length, 1);
    assert.strictEqual(result.counterexample[0]?.stateName, "FaultyInit");
  });
});
