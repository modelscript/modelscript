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

  it("detects M8003, M8004, M8005, M8009, M8010, M8012, and M8014 propulsion diagnostics", () => {
    const deck = `DECK: ComprehensiveLintDeck
COMPONENTS:
  SHAFT_IMBAL TYPE=SHAFT
    PARAMS: P_PUMP=5.0E6, P_TURB=2.0E6
  SPLIT01 TYPE=SPLITTER
    PARAMS: MDOT_IN=50.0, MDOT_OUT=42.0
  PUMP_CAV TYPE=PUMP
    PARAMS: P_IN=8.0E4, P_VAP=6.0E4, NPSH_R=5.0E4, FLUID=UNOBTANIUM
  VALV_CLOSED TYPE=VALVE
    PARAMS: POSITION=0.0
  CHAMBER_LOW TYPE=CHAMBER
    PARAMS: PC=1.2E5, PA=1.0E5
  USER01 TYPE=USER_ROUTINE
CONNECTIONS:
  PUMP_CAV.OUT_P -> VALV_CLOSED.IN_P
`;
    const model = parseRocetsDeck(deck);
    const diags = lintRocets(model);
    assert.ok(
      diags.some((d) => d.id === RocetsErrorCode.SHAFT_POWER_IMBALANCE.id),
      "Expected M8003",
    );
    assert.ok(
      diags.some((d) => d.id === RocetsErrorCode.UNBALANCED_FLOW_SPLIT.id),
      "Expected M8004",
    );
    assert.ok(
      diags.some((d) => d.id === RocetsErrorCode.PUMP_CAVITATION_RISK.id),
      "Expected M8005",
    );
    assert.ok(
      diags.some((d) => d.id === RocetsErrorCode.CHOKED_FLOW_INCONSISTENCY.id),
      "Expected M8009",
    );
    assert.ok(
      diags.some((d) => d.id === RocetsErrorCode.USER_FORTRAN_ROUTINE_ERROR.id),
      "Expected M8010",
    );
    assert.ok(
      diags.some((d) => d.id === RocetsErrorCode.MISSING_FLUID_TABLE.id),
      "Expected M8012",
    );
    assert.ok(
      diags.some((d) => d.id === RocetsErrorCode.CLOSED_FLOW_CIRCUIT.id),
      "Expected M8014",
    );
  });
});
