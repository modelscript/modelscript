// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerNmodlToDae, parseNmodl } from "../src/index.js";

const POTASSIUM_CHANNEL_MOD = `
TITLE Delayed Rectifier Potassium Channel (K_V)

NEURON {
  SUFFIX k_hh
  USEION k READ ek WRITE ik
  RANGE gkbar, gk, ik
  GLOBAL ninf, ntau
}

PARAMETER {
  gkbar = 36.0 (mS/cm2) <0, 1e9>
  ek = -77.0 (mV)
}

STATE {
  n
}

ASSIGNED {
  v (mV)
  ik (mA/cm2)
  gk (mS/cm2)
}

BREAKPOINT {
  SOLVE states METHOD cnexp
  gk = gkbar * (n^4)
  ik = gk * (v - ek)
}

DERIVATIVE states {
  n' = (ninf - n) / ntau
}
`;

test("NMODL DAE: compiles potassium channel to square DAEBuilder in linear memory", () => {
  const doc = parseNmodl(POTASSIUM_CHANNEL_MOD);
  const dae = lowerNmodlToDae(doc);

  assert.ok(dae.varCount >= 7);
  assert.equal(dae.varCount, dae.eqCount, "DAE must be square");

  assert.notEqual(dae.lookupVariable("gkbar"), -1);
  assert.notEqual(dae.lookupVariable("ek"), -1);
  assert.notEqual(dae.lookupVariable("v"), -1);
  assert.notEqual(dae.lookupVariable("n"), -1);
  assert.notEqual(dae.lookupVariable("ik"), -1);
  assert.notEqual(dae.lookupVariable("Cm"), -1);
});
