// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  computeSpanNli,
  createEmptyOpticalTopology,
  createSorDocument,
  lintOpticalTopology,
  lintSorDocument,
  lowerOpticalEdfaToDae,
  solveChannelTransmission,
  type OpticalChannel,
  type OpticalNode,
  type OpticalSpan,
  type SorKeyEvent,
} from "../src/index.js";

test("Optical transmission solvers, DAE lowering, and linter rules", async (t) => {
  await t.test("computes non-linear interference with GN-model", () => {
    const nli = computeSpanNli({
      lengthKm: 80.0,
      attenuationDbPerKm: 0.2,
      dispersionPsPerNmKm: 16.7,
      nonLinearCoeffPerWKm: 1.3,
      wavelengthNm: 1550.0,
      baudRateGbaud: 64.0,
      totalChannels: 40,
      channelSpacingGhz: 75.0,
    });

    assert.ok(nli.effectiveLengthKm > 0 && nli.effectiveLengthKm < 80.0);
    assert.ok(nli.nliEfficiencyPerW2 > 0);
    // At 1 mW (0 dBm), NLI power should be very small (< 1 uW)
    const nliPower = nli.nliPowerWatts(1e-3);
    assert.ok(nliPower > 0 && nliPower < 1e-6);
  });

  await t.test("solves multi-span optical GSNR and detects OSNR depletion", () => {
    const topo = createEmptyOpticalTopology("TransConLink");

    const nodeA: OpticalNode = {
      id: "NODE-A",
      name: "Denver Hub",
      nodeType: "rdm",
      degrees: [{ degreeNumber: 1, maxWavelengths: 96 }],
      srgs: [
        { srgNumber: 1, maxAddDropWavelengths: 96, isColorless: true, isDirectionless: true, isContentionless: false },
      ],
      ports: [],
    };
    const nodeB: OpticalNode = {
      id: "NODE-B",
      name: "Chicago Hub",
      nodeType: "rdm",
      degrees: [{ degreeNumber: 1, maxWavelengths: 96 }],
      srgs: [
        { srgNumber: 1, maxAddDropWavelengths: 96, isColorless: true, isDirectionless: true, isContentionless: false },
      ],
      ports: [],
    };
    topo.addNode(nodeA);
    topo.addNode(nodeB);

    // 10-span long haul link (10 x 100 km = 1000 km)
    const spanIds: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const spanId = `SPAN-${i}`;
      spanIds.push(spanId);
      const span: OpticalSpan = {
        id: spanId,
        fromNodeId: i === 1 ? "NODE-A" : `ILA-${i - 1}`,
        toNodeId: i === 5 ? "NODE-B" : `ILA-${i}`,
        lengthKm: 100.0,
        fiberType: "SSMF",
        attenuationDbPerKm: 0.2,
        dispersionPsPerNmKm: 16.7,
        pmdPsPerSqrtKm: 0.04,
        nonLinearCoeffPerWKm: 1.3,
        amplifiers: [{ id: `EDFA-${i}`, ampType: "edfa", gainDb: 20.0, noiseFigureDb: 5.5, maxOutputPowerDbm: 21.0 }],
      };
      topo.addSpan(span);
    }

    const channelGood: OpticalChannel = {
      id: "CH-100G-QPSK",
      sourceNodeId: "NODE-A",
      destinationNodeId: "NODE-B",
      centerFrequencyThz: 193.1,
      baudRateGbaud: 32.0,
      modulation: "PM-QPSK",
      launchPowerDbm: 0.0,
      requiredOsnrDb: 12.0, // QPSK requires low OSNR
      pathSpanIds: spanIds,
    };
    topo.addChannel(channelGood);

    const metricsGood = solveChannelTransmission(topo, channelGood);
    assert.equal(metricsGood.totalLengthKm, 500.0);
    assert.ok(metricsGood.gsnrDb > 15.0, `Expected GSNR > 15 dB, got ${metricsGood.gsnrDb}`);
    assert.ok(metricsGood.osnrMarginDb > 0, "Should have positive OSNR margin");

    // Add high-demand 64-QAM channel requiring 28 dB OSNR
    const channelBad: OpticalChannel = {
      id: "CH-800G-64QAM",
      sourceNodeId: "NODE-A",
      destinationNodeId: "NODE-B",
      centerFrequencyThz: 193.2,
      baudRateGbaud: 96.0,
      modulation: "PM-64QAM",
      launchPowerDbm: 0.0,
      requiredOsnrDb: 28.0, // High OSNR requirement
      pathSpanIds: spanIds,
    };
    topo.addChannel(channelBad);

    const diags = lintOpticalTopology(topo);
    const osnrDiag = diags.find((d) => d.code === 1001);
    assert.ok(osnrDiag, "Should flag T1001 osnr-margin-exhausted for 64-QAM channel");
    assert.equal(osnrDiag.severity, "error");
  });

  await t.test("lowers dynamic EDFA gain saturation state equations to DAEBuilder", () => {
    const dae = lowerOpticalEdfaToDae({
      smallSignalGainDb: 30.0,
      saturationPowerMilliwatts: 15.0,
      fluorescenceLifetimeMs: 10.0,
    });

    assert.ok(dae.lookupVariable("G_0") !== -1, "Should declare G_0");
    assert.ok(dae.lookupVariable("P_sat") !== -1, "Should declare P_sat");
    assert.ok(dae.lookupVariable("G") !== -1, "Should declare dynamic gain G");
    assert.ok(dae.lookupVariable("P_out") !== -1, "Should declare output power P_out");
    assert.equal(dae.eqCount, 5); // 3 parameter equations + P_out + der(G)
  });

  await t.test("lints OTDR traces for excessive splice loss events", () => {
    const events: SorKeyEvent[] = [
      {
        eventNumber: 1,
        distanceMeters: 4500,
        slopeDbPerKm: 0.2,
        eventLossDb: 0.95, // 0.95 dB >> 0.50 dB allowable limit
        reflectanceDb: Number.NEGATIVE_INFINITY,
        eventCode: "0999",
        eventType: "non-reflective",
        leadInLossDb: 1.85,
        comments: "Dirty/pinched fusion splice",
      },
    ];

    const mockDoc = createSorDocument(
      "2.0",
      [],
      {
        cableId: "CABLE-FAIL",
        fiberId: "STRAND-1",
        fiberType: "G.652",
        nominalWavelengthNm: 1550,
        originLocation: "",
        terminateLocation: "",
        cableCode: "",
        currentCondition: "RC",
        operator: "",
        comments: "",
      },
      {
        supplierName: "",
        otdrName: "",
        otdrSerialNumber: "",
        moduleName: "",
        moduleSerialNumber: "",
        softwareVersion: "",
      },
      {
        dateTime: new Date(),
        distanceUnits: "km",
        actualWavelengthNm: 1550,
        acquisitionOffset: 0,
        pulseWidthNs: 100,
        sampleSpacingNs: 1.0,
        numPoints: 0,
        refractiveIndex: 1.4682,
        backscatterCoefficientDb: -79.0,
        numAverages: 1000,
        rangeKm: 20.0,
        frontPanelLossDb: 0.0,
      },
      { numPoints: 0, scalingFactor: 1000, powerDb: new Float64Array(0), distanceMeters: new Float64Array(0) },
      events,
    );

    const diags = lintSorDocument(mockDoc, 0.5);
    assert.equal(diags.length, 1);
    assert.equal(diags[0]?.code, 1006);
    assert.equal(diags[0]?.severity, "error");
    assert.ok(diags[0]?.message.includes("0.95 dB"));
  });
});
