// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  lintRelap5,
  lowerRelap5ToDae,
  parseRelap5,
  relap5ToModelica,
  Relap5WorkspaceIndex,
  serializeRelap5,
  solvePointKinetics,
} from "../src/index.js";

const VALID_PWR_DECK = `* ====================================================================
* PWR Primary Loop Thermal-Hydraulics & Point Kinetics Model
* ====================================================================
100 PWR 4-Loop Reactor Primary System
101 new transnt
* Time step control: endTime, minDt, maxDt, minorFreq, majorFreq
201 10.0 1.0e-5 0.01 100 1000
* Trips
2060001 p-100010000 gt 1.60e7 l
2060002 time gt 5.0 l
2060003 1 or 2 l
* Hydrodynamic Volumes (300-series)
* 1. Reactor Core Channel
1000000 CoreChannel pipe
1000101 4.5 3.8 17.1
1000201 0.0 3.8
1000301 1.5e-5 0.012
1000501 1.55e7 580.0 0.0
* 2. Upper Plenum
1100000 UpperPlenum branch
1100101 8.0 2.5 20.0
1100201 0.0 2.5
1100301 2.0e-5 0.50
1100501 1.54e7 595.0 0.0
* Hydrodynamic Junctions
1050000 CoreToUpper snglj
1050101 100 110 4.5
1050102 0.15 0.25
1050201 4.5 0.0
* Heat Structures (Fuel Cladding)
10100000 5 1
10100101 16.5 2.1e6
10100201 100 100
* Reactor Point Kinetics (600-series)
6000000 point 2.0e-5 0.0065 3000.0e6
6000001 0.0124 0.000215
6000002 0.0305 0.001424
6000003 0.1110 0.001274
6000004 0.3010 0.002568
6000005 1.1400 0.000748
6000006 3.0100 0.000271
6000010 -2.5e-5 -1.0e-4
. end`;

test("RELAP5 Parser: parses PWR primary loop deck into structured AST", () => {
  const deck = parseRelap5(VALID_PWR_DECK, "pwr.i");
  assert.equal(deck.title, "PWR 4-Loop Reactor Primary System");
  assert.equal(deck.executionType, "new");
  assert.equal(deck.problemType, "transnt");
  assert.equal(deck.timeSteps.length, 1);
  assert.equal(deck.timeSteps[0]!.endTime, 10.0);

  // Volumes
  assert.equal(deck.volumes.size, 2);
  const core = deck.volumes.get(100);
  assert.ok(core);
  assert.equal(core.name, "CoreChannel");
  assert.equal(core.type, "pipe");
  assert.equal(core.flowArea, 4.5);
  assert.equal(core.length, 3.8);
  assert.equal(core.initialPressure, 1.55e7);
  assert.equal(core.initialTemperature, 580.0);

  // Junctions
  assert.equal(deck.junctions.size, 1);
  const junc = deck.junctions.get(105);
  assert.ok(junc);
  assert.equal(junc.fromVolume, 100);
  assert.equal(junc.toVolume, 110);
  assert.equal(junc.forwardLoss, 0.15);
  assert.equal(junc.reverseLoss, 0.25);

  // Heat structures
  assert.equal(deck.heatStructures.size, 1);
  const hs = deck.heatStructures.get(10);
  assert.ok(hs);
  assert.equal(hs.thermalConductivity, 16.5);

  // Kinetics
  assert.ok(deck.kinetics);
  assert.equal(deck.kinetics.initialPower, 3000.0e6);
  assert.equal(deck.kinetics.delayedGroups.length, 6);
  assert.equal(deck.kinetics.fuelTempReactivityCoeff, -2.5e-5);
});

test("RELAP5 Serializer: round-trips parsed AST back to valid 80-column card deck", () => {
  const deck = parseRelap5(VALID_PWR_DECK);
  const text = serializeRelap5(deck);
  assert.ok(text.includes("100 PWR 4-Loop Reactor Primary System"));
  assert.ok(text.includes("101 new transnt"));
  assert.ok(text.includes("1000000 CoreChannel pipe"));
  assert.ok(text.includes("6000000 point"));
  assert.ok(text.includes(". end"));

  // Verify re-parsing
  const deck2 = parseRelap5(text);
  assert.equal(deck2.volumes.size, 2);
  assert.equal(deck2.junctions.size, 1);
  assert.ok(deck2.kinetics);
});

test("RELAP5 Linter: detects dangling volume connection and negative form loss (M8601, M8608)", () => {
  const flawedDeck = `100 Flawed Junction Deck
101 new transnt
1000000 Core pipe
1000101 1.0 1.0 1.0
1000501 1.55e7 560.0
* Junction references nonexistent volume 999 and has negative loss
1050000 BadJunc snglj
1050101 100 999 1.0
1050102 -0.5 0.2
. end`;

  const deck = parseRelap5(flawedDeck);
  const diags = lintRelap5(deck);

  const m8601 = diags.find((d) => d.code === 8601);
  assert.ok(m8601, "Expected M8601 dangling volume connection");
  assert.ok(m8601.message.includes("'999'"));

  const m8608 = diags.find((d) => d.code === 8608);
  assert.ok(m8608, "Expected M8608 negative form loss coefficient");
});

test("RELAP5 Linter: detects negative heat capacity and adverse elevation (M8603, M8607)", () => {
  const flawedDeck = `100 Flawed Deck
101 new transnt
1000000 Core pipe
1000101 1.0 2.0 2.0
1000201 0.0 5.0
1000501 1.55e7 560.0
10100000 5 1
10100101 -15.0 -2.0e6
. end`;

  const deck = parseRelap5(flawedDeck);
  const diags = lintRelap5(deck);

  const m8603 = diags.find((d) => d.code === 8603);
  assert.ok(m8603, "Expected M8603 negative conductivity or heat capacity");

  const m8607 = diags.find((d) => d.code === 8607);
  assert.ok(m8607, "Expected M8607 adverse elevation change exceeding length");
});

test("RELAP5 Linter: detects unclosed trip logic cutset and negative pressure (M8602, M8610)", () => {
  const flawedDeck = `100 Flawed Trips & Pressures
101 new transnt
1000000 Core pipe
1000101 1.0 1.0 1.0
1000501 -500.0 560.0
2060001 10 and 20 l
. end`;

  const deck = parseRelap5(flawedDeck);
  const diags = lintRelap5(deck);

  const m8602 = diags.find((d) => d.code === 8602);
  assert.ok(m8602, "Expected M8602 unclosed trip logic cutset");

  const m8610 = diags.find((d) => d.code === 8610);
  assert.ok(m8610, "Expected M8610 negative pressure state");
});

test("RELAP5 Linter: detects missing kinetics delayed groups and prompt lifetime (M8605, M8606)", () => {
  const flawedDeck = `100 Flawed Kinetics
101 new transnt
6000000 point -1.0e-5 0.0065 3000.0e6
6000001 0.0124 0.000215
6000002 0.0305 0.001424
. end`;

  const deck = parseRelap5(flawedDeck);
  const diags = lintRelap5(deck);

  const m8605 = diags.find((d) => d.code === 8605);
  assert.ok(m8605, "Expected M8605 missing delayed precursor groups (only 2 provided)");

  const m8606 = diags.find((d) => d.code === 8606);
  assert.ok(m8606, "Expected M8606 negative prompt neutron lifetime");
});

test("RELAP5 Solver: solves 6-group delayed neutron point kinetics ODEs during SCRAM", () => {
  const deck = parseRelap5(VALID_PWR_DECK);
  const res = solvePointKinetics(deck, { duration: 5.0, tripScramTime: 1.0, stepSize: 0.001 });

  assert.equal(res.initialPowerMW, 3000.0);
  assert.ok(res.stepsCount > 50);
  // After SCRAM at t=1s, power should drop significantly
  assert.ok(res.finalPowerMW < 3000.0 * 0.2);
});

test("RELAP5 Solver: evaluates Doppler fuel temperature negative reactivity feedback", () => {
  const deck = parseRelap5(VALID_PWR_DECK);
  // Reactivity insertion of +0.001 dk/k ($0.15) triggers power rise and Doppler negative feedback
  const res = solvePointKinetics(deck, { duration: 2.0, externalReactivity: 0.001, stepSize: 0.001 });

  assert.ok(res.peakPowerMW > 3000.0);
  assert.ok(res.peakFuelTempK > 850.0);
  // Feedback turns around the transient
  const lastStep = res.trajectory[res.trajectory.length - 1]!;
  assert.ok(lastStep.reactivityPcm !== undefined);
});

test("RELAP5 DAE Lowering: compiles two-phase volumes and kinetics into DAEBuilder linear memory", () => {
  const deck = parseRelap5(VALID_PWR_DECK);
  const dae = lowerRelap5ToDae(deck);

  assert.ok(dae.variables().length >= 18, "Expected at least 18 variables");
  assert.equal(dae.variables().length, dae.equations().length, "Expected structurally square DAE (N_vars == N_eqs)");

  assert.notEqual(dae.lookupVariable("P_100"), -1);
  assert.notEqual(dae.lookupVariable("alpha_100"), -1);
  assert.notEqual(dae.lookupVariable("mf_105"), -1);
  assert.notEqual(dae.lookupVariable("reactor_power"), -1);
  assert.notEqual(dae.lookupVariable("C_1"), -1);
});

test("RELAP5 Modelica Projection: generates syntactically valid Modelica 3.x code", () => {
  const deck = parseRelap5(VALID_PWR_DECK);
  const mo = relap5ToModelica(deck, "PwrPrimaryLoop");

  assert.ok(mo.includes("model PwrPrimaryLoop"));
  assert.ok(mo.includes("Real P_100(start = 15500000.0)"));
  assert.ok(mo.includes("Real mf_105(start = 100.0)"));
  assert.ok(mo.includes("Real reactor_power(start = 1.0)"));
  assert.ok(mo.includes("der(P_100) = (1.0e6 / V_100_vol)"));
  assert.ok(mo.includes("der(reactor_power) = ((reactivity - beta) / Lambda) * reactor_power"));
  assert.ok(mo.includes("end PwrPrimaryLoop;"));
});

test("RELAP5 Workspace Index: indexes multi-file symbols accurately", () => {
  const index = new Relap5WorkspaceIndex();
  index.indexFile("file:///nuclear/pwr.i", VALID_PWR_DECK);

  assert.equal(index.fileCount, 1);
  const symbols = index.getSymbols("file:///nuclear/pwr.i");
  assert.ok(symbols.length >= 5);

  const coreSym = index.findDefinition("CoreChannel");
  assert.ok(coreSym);
  assert.equal(coreSym.name, "CoreChannel");

  const juncSym = index.findDefinition("Junc_105");
  assert.ok(juncSym);

  const pkeSym = index.findDefinition("ReactorPointKinetics");
  assert.ok(pkeSym);
});
