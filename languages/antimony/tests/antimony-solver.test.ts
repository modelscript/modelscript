// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseAntimony, solveAntimony } from "../src/index.js";

test("Antimony Solver: solves reversible mass-action reaction equilibrium", () => {
  const modelText = `
    model ReversibleBinding()
      compartment vol = 1.0;
      species A in vol = 10.0, B in vol = 10.0, C in vol = 0.0;
      const kf = 0.1, kr = 0.05;

      J_bind: A + B -> C; kf * A * B - kr * C;
    end
  `;

  const doc = parseAntimony(modelText);
  const sim = solveAntimony(doc, { duration: 10.0, timeStep: 0.05 });

  assert.ok(sim.stepsCount >= 100);
  const finalC = sim.finalConcentrations["C"] ?? 0;
  const finalA = sim.finalConcentrations["A"] ?? 0;
  const finalB = sim.finalConcentrations["B"] ?? 0;

  assert.ok(finalC > 4.0, "Reversible binding must form product C");
  assert.ok(Math.abs(finalA - finalB) < 1e-4, "A and B must remain equal by symmetry");
});

test("Antimony Solver: evaluates discrete events triggered by state threshold", () => {
  const modelText = `
    model ThresholdEvent()
      compartment cell = 1.0;
      species X in cell = 10.0;
      const k_decay = 0.2;

      J1: X => ; k_decay * X;
      E_replenish: at (X < 5.0): X = X + 5.0;
    end
  `;

  const doc = parseAntimony(modelText);
  const sim = solveAntimony(doc, { duration: 6.0, timeStep: 0.05 });

  assert.ok(sim.triggeredEvents.length >= 1, "Expected E_replenish event to trigger");
  assert.equal(sim.triggeredEvents[0]?.eventId, "E_replenish");
});
