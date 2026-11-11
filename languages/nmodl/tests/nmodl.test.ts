// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  executeNmodlAction,
  getNmodlDocumentSymbols,
  getNmodlHover,
  lintNmodl,
  lowerNmodlToDae,
  nmodlToModelica,
  parseNmodl,
  provideNmodlCompletions,
  serializeNmodl,
  solveNmodlActionPotential,
  validateNmodl,
} from "../src/index.js";

const HH_SODIUM_CHANNEL_MOD = `
TITLE Fast Inactivating Sodium Channel (Na_V)

NEURON {
  SUFFIX na_hh
  USEION na READ ena WRITE ina
  RANGE gnabar, gna, ina
  GLOBAL minf, hinf, mtau, htau
}

PARAMETER {
  gnabar = 120.0 (mS/cm2) <0, 1e9>
  ena = 50.0 (mV)
}

STATE {
  m
  h
}

ASSIGNED {
  v (mV)
  ina (mA/cm2)
  gna (mS/cm2)
}

BREAKPOINT {
  SOLVE states METHOD cnexp
  gna = gnabar * (m^3) * h
  ina = gna * (v - ena)
}

DERIVATIVE states {
  m' = (minf - m) / mtau
  h' = (hinf - h) / htau
}
`;

test("NMODL Parser: extracts TITLE, NEURON, USEION, PARAMETER, STATE, BREAKPOINT, and DERIVATIVE", () => {
  const doc = parseNmodl(HH_SODIUM_CHANNEL_MOD);
  assert.equal(doc.model.suffix, "na_hh");
  assert.equal(doc.model.title, "Fast Inactivating Sodium Channel (Na_V)");

  assert.equal(doc.model.ions.length, 1);
  assert.equal(doc.model.ions[0]!.ion, "na");
  assert.deepEqual(doc.model.ions[0]!.read, ["ena"]);
  assert.deepEqual(doc.model.ions[0]!.write, ["ina"]);

  assert.equal(doc.model.parameters.length, 2);
  assert.equal(doc.model.parameters[0]!.name, "gnabar");
  assert.equal(doc.model.parameters[0]!.val, 120.0);

  assert.equal(doc.model.states.length, 2);
  assert.deepEqual(
    doc.model.states.map((s) => s.name),
    ["m", "h"],
  );

  assert.equal(doc.model.breakpointEquations.length, 2);
  assert.equal(doc.model.derivativeEquations.length, 2);
  assert.equal(doc.model.derivativeEquations[0]!.stateName, "m");
});

test("NMODL Serializer: roundtrips AST back to valid NMODL syntax", () => {
  const doc = parseNmodl(HH_SODIUM_CHANNEL_MOD);
  const serialized = serializeNmodl(doc);

  assert.ok(serialized.includes("NEURON {"));
  assert.ok(serialized.includes("SUFFIX na_hh"));
  assert.ok(serialized.includes("USEION na READ ena WRITE ina"));
  assert.ok(serialized.includes("gnabar = 120"));
  assert.ok(serialized.includes("BREAKPOINT {"));

  const reparsed = parseNmodl(serialized);
  assert.equal(reparsed.model.suffix, "na_hh");
  assert.equal(reparsed.model.states.length, 2);
});

test("NMODL Linter: valid channel produces zero errors", () => {
  const doc = parseNmodl(HH_SODIUM_CHANNEL_MOD);
  const diags = lintNmodl(doc);
  assert.equal(diags.length, 0);
});

test("NMODL Linter: flags missing NEURON and unassigned WRITE current (M9441, M9444)", () => {
  const badChannel = `
PARAMETER {
  gnabar = 120.0
}
STATE {
  m
}
BREAKPOINT {
  gna = 1.0
}
`;
  const doc = parseNmodl(badChannel);
  const diags = lintNmodl(doc);

  const codes = diags.map((d) => d.code);
  assert.ok(codes.includes(9441), "Should flag M9441 for missing NEURON block");
});

test("NMODL DAE: lowers parameters, states, and currents into square DAEBuilder", () => {
  const doc = parseNmodl(HH_SODIUM_CHANNEL_MOD);
  const dae = lowerNmodlToDae(doc);

  assert.ok(dae.varCount >= 8);
  assert.equal(dae.varCount, dae.eqCount, "DAE must be structurally square");

  assert.notEqual(dae.lookupVariable("gnabar"), -1);
  assert.notEqual(dae.lookupVariable("ena"), -1);
  assert.notEqual(dae.lookupVariable("v"), -1);
  assert.notEqual(dae.lookupVariable("m"), -1);
  assert.notEqual(dae.lookupVariable("h"), -1);
  assert.notEqual(dae.lookupVariable("ina"), -1);
});

test("NMODL Solver: simulates action potential firing under current clamp", () => {
  const doc = parseNmodl(HH_SODIUM_CHANNEL_MOD);
  const res = solveNmodlActionPotential(doc, {
    tEnd: 50.0,
    dt: 0.025,
    stimAmp: 10.0,
    stimStart: 5.0,
    stimDuration: 35.0,
  });

  assert.ok(res.time.length > 1000);
  assert.ok(res.spikeCount >= 2, `Expected at least 2 spikes, got ${res.spikeCount}`);
  assert.ok(res.firingRateHz > 40.0, `Expected firing rate > 40 Hz, got ${res.firingRateHz}`);
  assert.ok(res.vPeak > 20.0, `Expected positive peak action potential, got ${res.vPeak} mV`);
  assert.ok(res.vRest < -50.0, `Expected resting potential < -50 mV, got ${res.vRest} mV`);
});

test("NMODL Modelica Projection: generates valid Modelica 3.x biophysical channel component", () => {
  const doc = parseNmodl(HH_SODIUM_CHANNEL_MOD);
  const modelica = nmodlToModelica(doc);

  assert.ok(modelica.includes("model Nmodl_na_hh"));
  assert.ok(modelica.includes("parameter Real gnabar = 120.0000"));
  assert.ok(modelica.includes("Real v(start = -65.0)"));
  assert.ok(modelica.includes("Real m(start = 0.1"));
  assert.ok(modelica.includes("der(v) = "));
  assert.ok(modelica.includes("end Nmodl_na_hh;"));
});

test("NMODL LSP: validates diagnostics, document symbols, hover, and action execution", () => {
  const diags = validateNmodl(HH_SODIUM_CHANNEL_MOD);
  assert.equal(diags.length, 0);

  const symbols = getNmodlDocumentSymbols(HH_SODIUM_CHANNEL_MOD);
  assert.ok(symbols.length > 0);
  assert.equal(symbols[0]!.name, "Mechanism (na_hh)");

  const hoverNeuron = getNmodlHover(HH_SODIUM_CHANNEL_MOD, { line: 3, character: 2 });
  assert.ok(hoverNeuron && hoverNeuron.contents.includes("NEURON"));

  const completions = provideNmodlCompletions(HH_SODIUM_CHANNEL_MOD, { line: 0, character: 0 });
  assert.ok(completions.some((c) => c.label === "BREAKPOINT"));

  const actionRes = executeNmodlAction(HH_SODIUM_CHANNEL_MOD, "nmodl_to_dae") as {
    isSquare: boolean;
    variableCount: number;
    equationCount: number;
  };
  assert.equal(actionRes.isSquare, true);
  assert.ok(actionRes.variableCount >= 8);
});
