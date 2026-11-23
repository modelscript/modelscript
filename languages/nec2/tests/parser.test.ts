// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateNec2Expression, expandNec2Frequencies, expandNec2Geometry, parseNec2Deck } from "../src/index.js";

describe("@modelscript/nec2 Deck Parser", () => {
  it("parses a complete half-wave dipole deck with CM/CE/GW/GE/FR/EX/RP/EN", () => {
    const src = `
CM Half-Wave Dipole at 300 MHz
CE
GW 1 21 0 0 -0.25 0 0 0.25 0.001
GE 0
FR 0 1 0 0 300.0 0
EX 0 1 11 0 1.0 0.0
RP 0 37 1 1000 0 0 5 0
EN
`;
    const deck = parseNec2Deck(src);
    assert.strictEqual(deck.parseErrors.length, 0);
    assert.strictEqual(deck.title, "Half-Wave Dipole at 300 MHz");
    assert.strictEqual(deck.hasCommentEnd, true);
    assert.strictEqual(deck.hasGeometryEnd, true);
    assert.strictEqual(deck.hasEnd, true);
    assert.strictEqual(deck.wires.length, 1);
    assert.strictEqual(deck.wires[0]!.tag, 1);
    assert.strictEqual(deck.wires[0]!.segments, 21);
    assert.strictEqual(deck.wires[0]!.z1, -0.25);
    assert.strictEqual(deck.wires[0]!.z2, 0.25);
    assert.strictEqual(deck.wires[0]!.radius, 0.001);
    assert.strictEqual(deck.frequencies.length, 1);
    assert.strictEqual(deck.frequencies[0]!.fmhz, 300.0);
    assert.strictEqual(deck.excitations.length, 1);
    assert.strictEqual(deck.excitations[0]!.segment, 11);
    assert.strictEqual(deck.radiationPatterns.length, 1);
  });

  it("evaluates 4NEC2 SY symbolic variables and arithmetic expressions", () => {
    const src = `
CM Parametric Dipole
CE
SY freq=146.0
SY lambda=299.792458/freq
SY halfLen=0.25*lambda, rad=0.001
GW 1, 21, 0, 0, -halfLen, 0, 0, halfLen, rad
GE 0
FR 0, 3, 0, 0, freq-2, 2.0
EX 0, 1, 11, 0, 1, 0
XQ
EN
`;
    const deck = parseNec2Deck(src);
    assert.strictEqual(deck.parseErrors.length, 0);
    assert.strictEqual(deck.symbolDefs.length, 4);
    const expectedHalf = (0.25 * 299.792458) / 146.0;
    assert.ok(Math.abs(deck.wires[0]!.z2 - expectedHalf) < 1e-9);
    assert.ok(Math.abs(deck.wires[0]!.z1 + expectedHalf) < 1e-9);

    const freqs = expandNec2Frequencies(deck);
    assert.deepStrictEqual(freqs, [144.0, 146.0, 148.0]);
  });

  it("expands GA arc, GH helix, GM transform, GR symmetry, and GS scale cards", () => {
    const src = `
CM Geometry Transformation Test
CE
GA 1 12 0.2 0 360 0.001
GS 0 0 0.5
GE 0
FR 0 1 0 0 300 0
EX 0 1 1 0 1 0
EN
`;
    const deck = parseNec2Deck(src);
    assert.strictEqual(deck.parseErrors.length, 0);
    const wires = expandNec2Geometry(deck);
    assert.strictEqual(wires.length, 12);
    assert.ok(Math.abs(wires[0]!.x1 - 0.1) < 1e-9);
    assert.ok(Math.abs(wires[0]!.radius - 0.0005) < 1e-9);

    const grDeck = parseNec2Deck(`
CM Radial Ground Plane
CE
GW 1 5 0 0 0 0.25 0 0 0.001
GR 1 4
GE 0
EN
`);
    const grWires = expandNec2Geometry(grDeck);
    assert.strictEqual(grWires.length, 4);
    assert.ok(Math.abs(grWires[1]!.y2 - 0.25) < 1e-9);
    assert.ok(Math.abs(grWires[2]!.x2 + 0.25) < 1e-9);
  });

  it("parses LD, GN, NT, TL, SP, SM cards and math functions in SY expressions", () => {
    const syms = new Map<string, number>([
      ["a", 3],
      ["b", 4],
    ]);
    assert.ok(Math.abs(evaluateNec2Expression("sqrt(a^2 + b^2)", syms) - 5.0) < 1e-12);

    const deck = parseNec2Deck(`
CM Full Card Coverage
CE
GW 1 11 0 0 0 0 0 0.25 0.001
GW 2 11 0.5 0 0 0.5 0 0.25 0.001
SP 0 0 0 0 0 0.1 0.1 0
SM 2 2 0 0 0 0.2 0.2 0
GE 1
GN 1 0 0 0 13 0.005
LD 0 1 6 6 50 1e-7 1e-11
NT 1 1 2 1 0.02 0 -0.01 0 0.02 0
TL 1 2 2 2 50 0.25 0 0 0 0
FR 1 3 0 0 100 1.5
EX 0 1 1 0 1 0
XQ 0
EN
`);
    assert.strictEqual(deck.parseErrors.length, 0);
    assert.strictEqual(deck.patches.length, 2);
    assert.strictEqual(deck.grounds.length, 1);
    assert.strictEqual(deck.loads.length, 1);
    assert.strictEqual(deck.networks.length, 1);
    assert.strictEqual(deck.transmissionLines.length, 1);
    assert.strictEqual(deck.executes.length, 1);
    assert.deepStrictEqual(expandNec2Frequencies(deck), [100, 150, 225]);
  });
});
