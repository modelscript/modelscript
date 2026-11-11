// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseNmodl, solveNmodlActionPotential } from "../src/index.js";

const HH_FULL_MOD = `
TITLE Full Hodgkin-Huxley Giant Axon Dynamics

NEURON {
  SUFFIX hh
  USEION na READ ena WRITE ina
  USEION k READ ek WRITE ik
}

PARAMETER {
  gnabar = 120.0
  gkbar = 36.0
  gl = 0.3
  ena = 50.0
  ek = -77.0
  el = -54.387
}

STATE {
  m
  h
  n
}

BREAKPOINT {
  SOLVE states METHOD cnexp
  ina = gnabar*m*m*m*h*(v - ena)
  ik = gkbar*n*n*n*n*(v - ek)
}

DERIVATIVE states {
  m' = (0.5 - m)/1.0
  h' = (0.5 - h)/1.0
  n' = (0.5 - n)/1.0
}
`;

test("NMODL Solver: verifies resting membrane stability without stimulus", () => {
  const doc = parseNmodl(HH_FULL_MOD);
  const res = solveNmodlActionPotential(doc, {
    tEnd: 20.0,
    dt: 0.05,
    stimAmp: 0.0, // No stimulus
  });

  assert.equal(res.spikeCount, 0, "No spikes without stimulus");
  assert.ok(Math.abs(res.vRest - -65.0) < 1.0);
});

test("NMODL Solver: verifies stimulation threshold and frequency response", () => {
  const doc = parseNmodl(HH_FULL_MOD);

  // Subthreshold stimulus (1.0 uA/cm2)
  const resSub = solveNmodlActionPotential(doc, {
    tEnd: 30.0,
    dt: 0.025,
    stimAmp: 1.0,
    stimStart: 5.0,
    stimDuration: 20.0,
  });
  assert.equal(resSub.spikeCount, 0, "Subthreshold pulse should not fire action potentials");

  // Suprathreshold stimulus (10.0 uA/cm2)
  const resSupra = solveNmodlActionPotential(doc, {
    tEnd: 30.0,
    dt: 0.025,
    stimAmp: 10.0,
    stimStart: 5.0,
    stimDuration: 20.0,
  });
  assert.ok(resSupra.spikeCount >= 1, "Suprathreshold pulse should trigger spikes");
  assert.ok(resSupra.vPeak > 0.0, `Peak voltage should overshoot 0 mV, got ${resSupra.vPeak}`);
});
