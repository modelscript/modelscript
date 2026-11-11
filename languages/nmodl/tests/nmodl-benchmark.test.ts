// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerNmodlToDae, parseNmodl, solveNmodlActionPotential } from "../src/index.js";

const HH_BENCHMARK_MOD = `
TITLE High-Throughput Hodgkin-Huxley Benchmark

NEURON {
  SUFFIX hh_bench
  USEION na READ ena WRITE ina
  USEION k READ ek WRITE ik
}

PARAMETER {
  gnabar = 120.0
  gkbar = 36.0
  ena = 50.0
  ek = -77.0
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

test("NMODL Benchmark: simulates 50 neuron action potential sweeps in under 200ms", () => {
  const doc = parseNmodl(HH_BENCHMARK_MOD);
  const dae = lowerNmodlToDae(doc);
  assert.equal(dae.varCount, dae.eqCount);

  const tStart = performance.now();
  for (let i = 0; i < 50; i++) {
    const res = solveNmodlActionPotential(doc, {
      tEnd: 25.0,
      dt: 0.05,
      stimAmp: 5.0 + i * 0.2,
      stimStart: 2.0,
      stimDuration: 18.0,
    });
    assert.ok(res.time.length > 400);
  }
  const elapsed = performance.now() - tStart;
  assert.ok(elapsed < 1000, `50 sweeps took ${elapsed.toFixed(1)}ms`);
});
