// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { DAEBuilder } from "@modelscript/runtime";
import { lowerFiberLinkToDae, lowerFiberNetworkToDae, type FiberLinkParams } from "../src/dae/lowering.js";

describe("@modelscript/fiber DAE Lowering Suite", () => {
  const sampleSpan: FiberLinkParams = {
    id: "Span1",
    spanLengthMeters: 5000.0,
    attenuationDbPerKm: 0.20,
    numSplices: 5,
    spliceLossDb: 0.05,
    numConnectors: 2,
    connectorLossDb: 0.25,
    txPowerDbm: 2.0,
    rxSensitivityDbm: -28.0,
    cableWeightNPerM: 1.5,
    horizontalTensionN: 5000.0,
    attachmentHeightM: 9.0,
  };

  test("lowers single fiber span to DAE arena with 19 variables and 8 equations", () => {
    const builder = new DAEBuilder();
    const result = lowerFiberLinkToDae(builder, sampleSpan);

    assert.equal(result.linkId, "Span1");
    assert.equal(result.equationCount, 8);
    assert.equal(builder.varCount, 19);
    assert.equal(builder.eqCount, 8);

    // Verify key indices
    assert.ok(result.variableIndices.vFiberLoss !== undefined);
    assert.ok(result.variableIndices.vTotalLoss !== undefined);
    assert.ok(result.variableIndices.vRxPower !== undefined);
    assert.ok(result.variableIndices.vSag !== undefined);
  });

  test("lowers multi-span fiber route to DAE arena", () => {
    const builder = new DAEBuilder();
    const spans: FiberLinkParams[] = [
      sampleSpan,
      { ...sampleSpan, id: "Span2", spanLengthMeters: 3000.0 },
      { ...sampleSpan, id: "Span3", spanLengthMeters: 4000.0 },
    ];

    const netRes = lowerFiberNetworkToDae(builder, spans);
    assert.equal(netRes.results.length, 3);
    assert.equal(netRes.totalEquations, 24);
    assert.equal(netRes.totalVariables, 57);
    assert.equal(builder.varCount, 57);
    assert.equal(builder.eqCount, 24);
  });
});
