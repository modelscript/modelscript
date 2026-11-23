// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMelcor } from "../src/parser/melcor-parser.js";

const SAMPLE_DECK = `! Sandia MELCOR 2.x PWR Severe Accident Deck
MELGEN_INPUT
TITLE 'PWR Station Blackout Benchmark'

EXEC_INPUT
  EXEC_TSTART 0.0
  EXEC_TEND 100.0
  EXEC_DT 0.05 1.0 1.0e-5

CVH_INPUT
  CV_ID 'RCS_Vessel' 100 NORMAL
  CV_THR 1.55e7 580.0 0.4 0.6
  CV_PAS 85.0 0.0 12.0
  CV_NCG 'N2' 0.02

  CV_ID 'Containment' 200 NORMAL
  CV_THR 1.01325e5 310.0 0.0 0.1
  CV_PAS 50000.0 0.0 40.0

FL_INPUT
  FL_ID 'LOCA_Break' 10
  FL_FT 100 200 4.0 4.0
  FL_GEO 0.08 1.5 1.0
  FL_USL 1.8 2.2
  FL_IC 0.0

HS_INPUT
  HS_ID 'Vessel_Wall' 1001 CYLINDRICAL
  HS_GD 0.2 120.0 190320.0 21.5 530.0 7930.0
  HS_LB 100 1500.0
  HS_RB 200 50.0
  HS_TEMP 570.0
  HS_SRC 0.0

COR_INPUT
  COR_RP 5 10 3.0e9
  COR_ZDF 95000.0 340.0 600.0 4800.0 22000.0 100
  COR_PWR 3.2e7 3.0e9
  COR_OX ON URBANIC_HEIDRICK 4800.0 22000.0

RN1_INPUT
  RN1_CLS 1 'XE' 150.0 0.05
  RN1_CLS 2 'CS' 120.0 0.02

CF_INPUT
  CF_ID 'Vessel_DP' 1 SUBTRACT
  CF_SAI 1.0 0.0 0.0
  CF_ARG CVH 100 P 1.0
  CF_ARG CVH 200 P -1.0

TF_INPUT
  TF_ID 'Decay_Curve' 10 1.0 0.0
  TF_TAB 0.0 1.0 100.0 0.5 1000.0 0.2

MP_INPUT
  MP_ID 'Fuel_Cp' 1 UO2 CP 310.0

NCG_INPUT
  NCG_ID 'H2' 1 2.01588 14307.0

END
`;

describe("@modelscript/melcor — Parser", () => {
  it("parses all MELCOR 2.x package sections and records", () => {
    const deck = parseMelcor(SAMPLE_DECK, "sbo.mel");

    assert.equal(deck.title, "PWR Station Blackout Benchmark");
    assert.equal(deck.inputPhase, "MELGEN");
    assert.equal(deck.exec.present, true);
    assert.equal(deck.exec.tStart, 0.0);
    assert.equal(deck.exec.tEnd, 100.0);
    assert.equal(deck.exec.dtInit, 0.05);
    assert.equal(deck.exec.dtMax, 1.0);
    assert.equal(deck.exec.dtMin, 1.0e-5);

    assert.equal(deck.controlVolumes.size, 2);
    const cv100 = deck.controlVolumes.get(100);
    assert.ok(cv100);
    assert.equal(cv100.name, "RCS_Vessel");
    assert.equal(cv100.pressure, 1.55e7);
    assert.equal(cv100.temperature, 580.0);
    assert.equal(cv100.volume, 85.0);
    assert.equal(cv100.ncgFractions["N2"], 0.02);

    assert.equal(deck.flowPaths.size, 1);
    const fl10 = deck.flowPaths.get(10);
    assert.ok(fl10);
    assert.equal(fl10.fromCv, 100);
    assert.equal(fl10.toCv, 200);
    assert.equal(fl10.area, 0.08);
    assert.equal(fl10.forwardLoss, 1.8);
    assert.equal(fl10.reverseLoss, 2.2);

    assert.equal(deck.heatStructures.size, 1);
    const hs = deck.heatStructures.get(1001);
    assert.ok(hs);
    assert.equal(hs.geometry, "CYLINDRICAL");
    assert.equal(hs.leftBoundaryCv, 100);
    assert.equal(hs.rightBoundaryCv, 200);

    assert.ok(deck.core?.present);
    assert.equal(deck.core.radialRings, 5);
    assert.equal(deck.core.axialLevels, 10);
    assert.equal(deck.core.decayHeatW, 3.2e7);
    assert.equal(deck.core.oxidationEnabled, true);
    assert.equal(deck.core.oxidationModel, "URBANIC_HEIDRICK");

    assert.equal(deck.rn1Classes.size, 2);
    assert.equal(deck.controlFunctions.size, 1);
    assert.equal(deck.tabularFunctions.size, 1);
    assert.equal(deck.tabularFunctions.get(10)?.points.length, 3);
    assert.equal(deck.materialProperties.size, 1);
    assert.equal(deck.ncgSpecies.size, 1);
  });

  it("handles inline ! comments and MELCOR_INPUT phase headers", () => {
    const src = `MELGEN_INPUT ! start melgen
TITLE 'Combined Run'
MELCOR_INPUT ! start melcor
EXEC_INPUT
  EXEC_TEND 50.0 ! 50 second transient
END
`;
    const deck = parseMelcor(src);
    assert.equal(deck.inputPhase, "COMBINED");
    assert.equal(deck.title, "Combined Run");
    assert.equal(deck.exec.tEnd, 50.0);
  });
});
