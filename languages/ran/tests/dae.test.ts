// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { DAEBuilder, VarType, Variability, Causality } from "@modelscript/runtime";
import { lowerRanLinkToDae, lowerRanNetworkToDae, type RanLinkParams } from "../src/dae/lowering.js";

describe("@modelscript/ran DAE Arena Lowering Suite", () => {
  const sampleLink: RanLinkParams = {
    id: "TestLink1",
    txSiteName: "SiteAlpha",
    rxSiteName: "SiteBravo",
    frequencyGhz: 15.0,
    pathLengthKm: 5.0,
    txPowerDbm: 23.0,
    txAntennaGainDbi: 35.0,
    rxAntennaGainDbi: 35.0,
    txFeederLossDb: 1.0,
    rxFeederLossDb: 1.0,
    requiredMarginDb: 25.0,
    polarization: "V",
    bandwidthMhz: 56.0,
    noiseFigureDb: 4.0,
    rxSensitivityDbm: -72.0,
    rainRateMmPerHr: 25.0,
  };

  test("lowers single microwave link to DAE arena with 18 variables and 8 equations", () => {
    const builder = new DAEBuilder();
    const result = lowerRanLinkToDae(builder, sampleLink);

    assert.equal(result.linkId, "TestLink1");
    assert.equal(result.equationCount, 8);
    assert.equal(builder.varCount, 18);
    assert.equal(builder.eqCount, 8);

    // Verify key variable indices exist
    assert.ok(result.variableIndices.vTxPower !== undefined);
    assert.ok(result.variableIndices.vEirp !== undefined);
    assert.ok(result.variableIndices.vFspl !== undefined);
    assert.ok(result.variableIndices.vRxPower !== undefined);
    assert.ok(result.variableIndices.vCapacity !== undefined);
  });

  test("lowers multi-link mesh network to linear DAE arena", () => {
    const builder = new DAEBuilder();
    const links: RanLinkParams[] = [
      sampleLink,
      {
        ...sampleLink,
        id: "TestLink2",
        frequencyGhz: 23.0,
        pathLengthKm: 3.0,
      },
      {
        ...sampleLink,
        id: "TestLink3",
        frequencyGhz: 38.0,
        pathLengthKm: 1.5,
      },
    ];

    const netResult = lowerRanNetworkToDae(builder, links);
    assert.equal(netResult.results.length, 3);
    assert.equal(netResult.totalEquations, 24);
    assert.equal(netResult.totalVariables, 54);
    assert.equal(builder.varCount, 54);
    assert.equal(builder.eqCount, 24);
  });
});
