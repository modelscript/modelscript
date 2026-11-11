// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintNmodl, parseNmodl } from "../src/index.js";

test("NMODL Linter: valid channel produces zero diagnostics", () => {
  const code = `
NEURON {
  SUFFIX pas
  RANGE g, e, i
}
PARAMETER {
  g = 0.001 (mho/cm2)
  e = -70.0 (mV)
}
ASSIGNED {
  v (mV)
  i (mA/cm2)
}
BREAKPOINT {
  i = g * (v - e)
}
`;
  const doc = parseNmodl(code);
  const diags = lintNmodl(doc);
  assert.equal(diags.length, 0);
});

test("NMODL Linter: flags missing NEURON M9441 and missing BREAKPOINT M9447", () => {
  const bad = `
PARAMETER {
  g = 0.001
}
`;
  const doc = parseNmodl(bad);
  const diags = lintNmodl(doc);
  assert.ok(diags.some((d) => d.code === 9441));
  assert.ok(diags.some((d) => d.code === 9447));
});

test("NMODL Linter: flags unassigned write current M9444 and missing derivative M9443", () => {
  const bad = `
NEURON {
  SUFFIX bad_ion
  USEION na WRITE ina
}
STATE {
  m
}
BREAKPOINT {
  i = 1.0
}
`;
  const doc = parseNmodl(bad);
  const diags = lintNmodl(doc);
  assert.ok(
    diags.some((d) => d.code === 9443),
    "Should flag missing derivative evolution for m",
  );
  assert.ok(
    diags.some((d) => d.code === 9444),
    "Should flag unassigned ina write current",
  );
});

test("NMODL Linter: flags reversal potential unexpected polarity M9446", () => {
  const bad = `
NEURON {
  SUFFIX pol_check
}
PARAMETER {
  ena = -50.0 (mV)
}
BREAKPOINT {
  i = 1.0
}
`;
  const doc = parseNmodl(bad);
  const diags = lintNmodl(doc);
  assert.ok(diags.some((d) => d.code === 9446));
});
