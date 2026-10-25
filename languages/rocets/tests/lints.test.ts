// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintRocets, parseRocetsDeck, RocetsErrorCode } from "../src/index.js";

describe("@modelscript/rocets Static Linter Suite", () => {
  it("detects invalid valve stroke schedule (M8008)", () => {
    const deck = `DECK: TestDeck
COMPONENTS:
  VALV01 TYPE=VALVE
    PARAMS: CV=0.005, POSITION=1.5
`;
    const model = parseRocetsDeck(deck);
    const diags = lintRocets(model);
    const found = diags.find((d) => d.id === RocetsErrorCode.INVALID_VALVE_SCHEDULE.id);
    assert.ok(found, "Expected M8008 diagnostic for position > 1.0");
    assert.strictEqual(found?.severity, "error");
  });

  it("detects non-physical negative chamber pressure (M8006)", () => {
    const deck = `DECK: TestDeck
COMPONENTS:
  CHAMBER TYPE=CHAMBER
    PARAMS: PC=-5.0E5, MR=6.0
`;
    const model = parseRocetsDeck(deck);
    const diags = lintRocets(model);
    const found = diags.find((d) => d.id === RocetsErrorCode.NEGATIVE_CHAMBER_PRESSURE.id);
    assert.ok(found, "Expected M8006 diagnostic for negative chamber pressure");
    assert.strictEqual(found?.severity, "error");
  });

  it("detects extreme mixture ratios outside combustion limits (M8011)", () => {
    const deck = `DECK: TestDeck
COMPONENTS:
  CHAMBER TYPE=CHAMBER
    PARAMS: PC=5.0E6, MR=25.0
`;
    const model = parseRocetsDeck(deck);
    const diags = lintRocets(model);
    const found = diags.find((d) => d.id === RocetsErrorCode.EXTREME_MIXTURE_RATIO.id);
    assert.ok(found, "Expected M8011 diagnostic for extreme O/F mixture ratio");
    assert.strictEqual(found?.severity, "warning");
  });

  it("detects turbopump turbine overspeed hazard (M8013)", () => {
    const deck = `DECK: TestDeck
COMPONENTS:
  SHAFT01 TYPE=SHAFT
    PARAMS: SPEED_RPM=48000.0, MAX_RPM=40000.0
`;
    const model = parseRocetsDeck(deck);
    const diags = lintRocets(model);
    const found = diags.find((d) => d.id === RocetsErrorCode.TURBINE_OVERSPEED_HAZARD.id);
    assert.ok(found, "Expected M8013 diagnostic for shaft overspeed");
    assert.strictEqual(found?.severity, "warning");
  });

  it("detects unconnected required fluid inlet ports (M8001)", () => {
    const deck = `DECK: TestDeck
COMPONENTS:
  PUMP01 TYPE=PUMP
`;
    const model = parseRocetsDeck(deck);
    const diags = lintRocets(model);
    const found = diags.find((d) => d.id === RocetsErrorCode.UNCONNECTED_FLUID_PORT.id);
    assert.ok(found, "Expected M8001 diagnostic for unconnected IN_P");
    assert.strictEqual(found?.severity, "error");
  });

  it("detects incompatible fluid stream connections without a reactor (M8002)", () => {
    const deck = `DECK: TestDeck
COMPONENTS:
  PUMP_OX TYPE=PUMP
    PORTS: OUT_P=20E6 FLUID=LOX DIR=out
  VALV01 TYPE=VALVE
    PORTS: IN_P=20E6 FLUID=LH2 DIR=in
CONNECTIONS:
  PUMP_OX.OUT_P -> VALV01.IN_P
`;
    const model = parseRocetsDeck(deck);
    const diags = lintRocets(model);
    const found = diags.find((d) => d.id === RocetsErrorCode.FLUID_TYPE_MISMATCH.id);
    assert.ok(found, "Expected M8002 diagnostic for LOX to LH2 mix in valve");
    assert.strictEqual(found?.severity, "error");
  });
});
