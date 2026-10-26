// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  fitStateSpaceModel,
  lintTouchstone,
  lowerTouchstoneToDae,
  parseTouchstone,
  serializeTouchstone,
  touchstoneToModelica,
  TouchstoneWorkspaceIndex,
  verifyPassivity,
} from "../src/index.js";

const SAMPLE_1PORT_S1P = `! 1-Port Antenna / Load Reflection
# GHz S MA R 50
1.0000 0.1200 -45.000
2.0000 0.1500 -90.000
3.0000 0.2200 -135.000
`;

const SAMPLE_2PORT_FILTER_S2P = `! 2-Port Bandpass Chebyshev Filter
# MHz S DB R 50
! freq   S11_db S11_deg S21_db S21_deg S12_db S12_deg S22_db S22_deg
100.00  -25.0   15.0    -1.2   -30.0   -1.2   -30.0   -25.0   15.0
200.00  -22.0   -10.0   -1.5   -70.0   -1.5   -70.0   -22.0   -10.0
300.00  -2.1    -160.0  -18.0  -150.0  -18.0  -150.0  -2.1    -160.0
`;

const SAMPLE_TOUCHSTONE_2_0 = `! Touchstone 2.0 Differential Line
[Version] 2.0
[Number of Ports] 2
[Number of Frequencies] 2
# GHz S RI R 50
[Network Data]
1.0  0.05 -0.02  0.95 -0.10  0.95 -0.10  0.05 -0.02
2.0  0.08 -0.04  0.90 -0.20  0.90 -0.20  0.08 -0.04
[End]
`;

const SAMPLE_4PORT_S4P = `! 4-Port Coupled Interconnect
# GHz S RI R 50
1.0
  0.01 0.00  0.98 -0.05  0.02 0.01  0.00 0.00
  0.98 -0.05  0.01 0.00  0.00 0.00  0.02 0.01
  0.02 0.01  0.00 0.00  0.01 0.00  0.98 -0.05
  0.00 0.00  0.02 0.01  0.98 -0.05  0.01 0.00
`;

const SAMPLE_NON_PASSIVE_AMPLIFIER = `! Active RF Amplifier (Violates Passivity ||S|| > 1)
# GHz S MA R 50
1.0 0.10 0.0  3.50 180.0  0.01 0.0  0.15 0.0
`;

const SAMPLE_NON_MONOTONIC_FREQ = `! Bad Frequency Ordering
# GHz S MA R 50
1.0 0.1 0.0 0.9 0.0 0.9 0.0 0.1 0.0
3.0 0.1 0.0 0.9 0.0 0.9 0.0 0.1 0.0
2.0 0.1 0.0 0.9 0.0 0.9 0.0 0.1 0.0
`;

test("Touchstone Parser: parses 1-port .s1p reflection deck", () => {
  const deck = parseTouchstone(SAMPLE_1PORT_S1P, "antenna.s1p");
  assert.strictEqual(deck.numPorts, 1);
  assert.strictEqual(deck.options.frequencyUnit, "GHZ");
  assert.strictEqual(deck.options.parameterType, "S");
  assert.strictEqual(deck.options.format, "MA");
  assert.strictEqual(deck.options.referenceResistance, 50);
  assert.strictEqual(deck.points.length, 3);

  // Check 1.0 GHz point
  const pt0 = deck.points[0]!;
  assert.strictEqual(pt0.frequency, 1.0);
  assert.strictEqual(pt0.frequencyHz, 1e9);
  assert.strictEqual(pt0.matrix.length, 1);
  assert.strictEqual(pt0.matrix[0]!.length, 1);
  const s11 = pt0.matrix[0]![0]!;
  const mag = Math.sqrt(s11.re * s11.re + s11.im * s11.im);
  assert(Math.abs(mag - 0.12) < 1e-4);
});

test("Touchstone Parser: parses 2-port .s2p filter and enforces S21 / S12 ordering", () => {
  const deck = parseTouchstone(SAMPLE_2PORT_FILTER_S2P, "filter.s2p");
  assert.strictEqual(deck.numPorts, 2);
  assert.strictEqual(deck.options.frequencyUnit, "MHZ");
  assert.strictEqual(deck.options.format, "DB");
  assert.strictEqual(deck.points.length, 3);

  // S21 in point 0: -1.2 dB
  const pt0 = deck.points[0]!;
  const s21 = pt0.matrix[1]![0]!; // Row 2, Col 1
  const s21_mag = Math.sqrt(s21.re * s21.re + s21.im * s21.im);
  const s21_db = 20 * Math.log10(s21_mag);
  assert(Math.abs(s21_db - -1.2) < 1e-3);
});

test("Touchstone Parser: parses Touchstone 2.0 specification keywords", () => {
  const deck = parseTouchstone(SAMPLE_TOUCHSTONE_2_0);
  assert.strictEqual(deck.version, "2.0");
  assert.strictEqual(deck.numPorts, 2);
  assert.strictEqual(deck.options.format, "RI");
  assert.strictEqual(deck.points.length, 2);

  const pt0 = deck.points[0]!;
  assert.strictEqual(pt0.matrix[0]![0]!.re, 0.05);
  assert.strictEqual(pt0.matrix[0]![0]!.im, -0.02);
});

test("Touchstone Parser: parses 4-port multi-line matrices (.s4p)", () => {
  const deck = parseTouchstone(SAMPLE_4PORT_S4P, "interconnect.s4p");
  assert.strictEqual(deck.numPorts, 4);
  assert.strictEqual(deck.points.length, 1);
  const pt = deck.points[0]!;
  assert.strictEqual(pt.matrix.length, 4);
  assert.strictEqual(pt.matrix[0]!.length, 4);
  // S12 = row 0, col 1 = 0.98, -0.05
  assert.strictEqual(pt.matrix[0]![1]!.re, 0.98);
  assert.strictEqual(pt.matrix[0]![1]!.im, -0.05);
});

test("Touchstone Serializer: round-trips deck back to valid Touchstone text", () => {
  const deck = parseTouchstone(SAMPLE_2PORT_FILTER_S2P, "filter.s2p");
  const serialized = serializeTouchstone(deck);
  assert(serialized.includes("# MHZ S DB R 50"));
  const reparsed = parseTouchstone(serialized);
  assert.strictEqual(reparsed.points.length, 3);
  assert.strictEqual(reparsed.numPorts, 2);
});

test("Touchstone Linter: detects passivity violation (M8301)", () => {
  const deck = parseTouchstone(SAMPLE_NON_PASSIVE_AMPLIFIER, "amp.s2p");
  const diags = lintTouchstone(deck);
  const passivityDiag = diags.find((d) => d.code === 8301);
  assert(passivityDiag !== undefined, "Expected passivity violation M8301 for active amplifier");
  assert(passivityDiag.message.includes("passivity criterion"));
});

test("Touchstone Linter: detects non-monotonic frequency grid (M8304)", () => {
  const deck = parseTouchstone(SAMPLE_NON_MONOTONIC_FREQ, "bad_freq.s2p");
  const diags = lintTouchstone(deck);
  const monoDiag = diags.find((d) => d.code === 8304);
  assert(monoDiag !== undefined, "Expected non-monotonic frequency grid M8304");
});

test("Touchstone Linter: detects negative reference resistance (M8309)", () => {
  const content = `# GHz S MA R -50\n1.0 0.1 0.0\n`;
  const deck = parseTouchstone(content, "bad_r.s1p");
  const diags = lintTouchstone(deck);
  const rDiag = diags.find((d) => d.code === 8309);
  assert(rDiag !== undefined, "Expected negative reference resistance M8309");
});

test("Touchstone Passivity Solver: evaluates matrix spectral norm correctly", () => {
  const passiveDeck = parseTouchstone(SAMPLE_2PORT_FILTER_S2P, "passive.s2p");
  const reportPassive = verifyPassivity(passiveDeck);
  assert.strictEqual(reportPassive.isPassive, true);
  assert(reportPassive.maxNorm <= 1.0);

  const activeDeck = parseTouchstone(SAMPLE_NON_PASSIVE_AMPLIFIER, "active.s2p");
  const reportActive = verifyPassivity(activeDeck);
  assert.strictEqual(reportActive.isPassive, false);
  assert(reportActive.maxNorm > 3.0);
  assert.strictEqual(reportActive.violations.length, 1);
});

test("Touchstone Vector Fitting: fits rational state space companion realization", () => {
  const deck = parseTouchstone(SAMPLE_2PORT_FILTER_S2P, "filter.s2p");
  const ss = fitStateSpaceModel(deck, 2);
  assert.strictEqual(ss.order, 2);
  assert.strictEqual(ss.numPorts, 2);
  assert.strictEqual(ss.poles.length, 2);
  // All poles must be strictly in left-half plane (Re(pole) < 0) for stability
  for (const pole of ss.poles) {
    assert(pole.re < 0, `Pole must be strictly stable (got ${pole.re})`);
  }
  // State space matrices sizes
  assert.strictEqual(ss.A.length, 4); // 2 poles * 2 ports = 4 states
  assert.strictEqual(ss.B.length, 4);
  assert.strictEqual(ss.C.length, 2);
  assert.strictEqual(ss.D.length, 2);
});

test("Touchstone DAE Lowering: compiles N-port state space into DAEBuilder linear memory", () => {
  const deck = parseTouchstone(SAMPLE_2PORT_FILTER_S2P, "filter.s2p");
  const dae = lowerTouchstoneToDae(deck);
  const vars = dae.variables();
  const eqs = dae.equations();

  assert(vars.length >= 8, `Expected at least 8 variables, got ${vars.length}`);
  assert(eqs.length >= 4, `Expected at least 4 equations, got ${eqs.length}`);

  // Check port voltages and currents exist
  assert.notStrictEqual(dae.lookupVariable("v_1"), -1);
  assert.notStrictEqual(dae.lookupVariable("v_2"), -1);
  assert.notStrictEqual(dae.lookupVariable("i_1"), -1);
  assert.notStrictEqual(dae.lookupVariable("i_2"), -1);
  assert.notStrictEqual(dae.lookupVariable("x_1"), -1);
});

test("Touchstone Modelica Projection: generates syntactically valid Modelica 3.x code", () => {
  const deck = parseTouchstone(SAMPLE_2PORT_FILTER_S2P, "filter.s2p");
  const mo = touchstoneToModelica(deck, "BandpassFilter");

  assert(mo.includes("model BandpassFilter"));
  assert(mo.includes("PositivePin p[2]"));
  assert(mo.includes("NegativePin n[2]"));
  assert(mo.includes("der(x[1]) ="));
  assert(mo.includes("i[1] ="));
  assert(mo.includes("end BandpassFilter;"));
});

test("Touchstone Workspace Index: indexes multi-file symbols accurately", () => {
  const indexer = new TouchstoneWorkspaceIndex();
  const uri = "file:///models/filter.s2p";
  indexer.indexFile(uri, SAMPLE_2PORT_FILTER_S2P);

  assert.strictEqual(indexer.has(uri), true);
  const fileIdx = indexer.getFileIndex(uri);
  assert(fileIdx !== undefined);
  assert(fileIdx.symbols.size >= 5);

  const port1Syms = fileIdx.byName.get("Port_1");
  assert(port1Syms !== undefined && port1Syms.length > 0);
  const s21Syms = fileIdx.byName.get("S21");
  assert(s21Syms !== undefined && s21Syms.length > 0);
});
