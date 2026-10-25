// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  getOlgaQuickFixes,
  lintOlgaModel,
  simulateDriftFlux,
  simulateOlgaNetwork,
  type OlgaModel,
} from "../src/index.js";

test("OLGA Thermal Coupling: Heat Exchangers, Asphaltene Kinetics & Linter", async (t) => {
  const baseModel: OlgaModel = {
    title: "Thermal Test Pipeline",
    startTime: 0,
    endTime: 100,
    minDt: 0.1,
    maxDt: 1.0,
    flowpaths: [
      {
        name: "MAIN_LINE",
        pipes: [
          {
            label: "PIPE_1",
            length: 1000.0,
            diameter: 0.254,
            elevation: 0.0,
            roughness: 4.5e-5,
            discretization: 10,
          },
          {
            label: "PIPE_2",
            length: 1000.0,
            diameter: 0.254,
            elevation: 0.0,
            roughness: 4.5e-5,
            discretization: 10,
          },
        ],
        valves: [],
        sources: [
          {
            name: "SRC1",
            position: 0.0,
            totalMassRate: 30.0,
            gasMassFraction: 0.2,
            waterCut: 0.05,
            temperature: 335.15, // 62 C
            pressure: 90e5,
          },
        ],
        controllers: [],
        heatTransfer: {
          ambientTemperature: 277.15, // 4 C seawater
          ambientHeatTransferCoeff: 250.0,
          layers: [{ name: "STEEL", thickness: 0.02, conductivity: 45.0 }],
        },
      },
    ],
    nodes: [
      {
        name: "INLET",
        type: "MASS_SOURCE",
        flowpath: "MAIN_LINE",
        boundaryPosition: 0.0,
        pressure: 90e5,
        temperature: 335.15,
        massRate: 30.0,
      },
      {
        name: "OUTLET",
        type: "PRESSURE",
        flowpath: "MAIN_LINE",
        boundaryPosition: 1.0,
        pressure: 30e5,
      },
    ],
  };

  await t.test("1. Heat Exchanger Active Heating raises downstream temperatures", () => {
    // Baseline run without heat exchanger
    const resBase = simulateDriftFlux(baseModel, { durationSeconds: 60, timeStepSeconds: 1.0 });
    const baseArrivalT = resBase.trends.arrivalTemperature[resBase.trends.arrivalTemperature.length - 1]!;

    // Model with 4000 kW inline electric heater near outlet at x = 1950m
    const heaterModel: OlgaModel = JSON.parse(JSON.stringify(baseModel));
    heaterModel.flowpaths[0]!.heatExchangers = [
      {
        name: "INLINE_HEATER",
        position: 1950.0,
        type: "SIMPLE",
        dutyKw: 4000.0, // 4 MW heating
      },
    ];

    const resHeater = simulateDriftFlux(heaterModel, { durationSeconds: 60, timeStepSeconds: 1.0 });
    const heaterArrivalT = resHeater.trends.arrivalTemperature[resHeater.trends.arrivalTemperature.length - 1]!;

    assert.ok(
      heaterArrivalT > baseArrivalT + 2.0,
      `Heater arrival temperature (${heaterArrivalT.toFixed(2)} K) must exceed unheated baseline (${baseArrivalT.toFixed(2)} K)`,
    );

    // Profile check at snapshot: cell temperature at heater position should show a peak
    const lastProfile = resHeater.profiles[resHeater.profiles.length - 1]!;
    const peakT = Math.max(...lastProfile.temperature);
    assert.ok(
      peakT > 335.15,
      `Peak temperature with 4 MW heater (${peakT.toFixed(2)} K) should exceed inlet temperature (335.15 K)`,
    );
  });

  await t.test("2. Heat Exchanger Active Cooling / Subsea Chiller reduces downstream temperatures", () => {
    const resBase = simulateDriftFlux(baseModel, { durationSeconds: 60, timeStepSeconds: 1.0 });
    const baseArrivalT = resBase.trends.arrivalTemperature[resBase.trends.arrivalTemperature.length - 1]!;

    // Model with -3500 kW cooler near outlet at x = 1950m
    const coolerModel: OlgaModel = JSON.parse(JSON.stringify(baseModel));
    coolerModel.flowpaths[0]!.heatExchangers = [
      {
        name: "SUBSEA_COOLER",
        position: 1950.0,
        type: "CROSS_FLOW",
        dutyKw: -3500.0, // 3.5 MW cooling duty
      },
    ];

    const resCooler = simulateDriftFlux(coolerModel, { durationSeconds: 60, timeStepSeconds: 1.0 });
    const coolerArrivalT = resCooler.trends.arrivalTemperature[resCooler.trends.arrivalTemperature.length - 1]!;

    assert.ok(
      coolerArrivalT < baseArrivalT - 2.0,
      `Cooler arrival temperature (${coolerArrivalT.toFixed(2)} K) must be lower than baseline (${baseArrivalT.toFixed(2)} K)`,
    );
  });

  await t.test("3. Heat Exchanger Target Temperature Approach", () => {
    const targetModel: OlgaModel = JSON.parse(JSON.stringify(baseModel));
    const targetTempK = 300.15; // 27 C
    targetModel.flowpaths[0]!.heatExchangers = [
      {
        name: "TEMP_REGULATOR",
        position: 500.0,
        type: "SIMPLE",
        targetTemperature: targetTempK,
      },
    ];

    const resTarget = simulateDriftFlux(targetModel, { totalSteps: 40, dt: 0.5 });
    const lastProfile = resTarget.profiles[resTarget.profiles.length - 1]!;

    // Find cell closest to x = 500
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < lastProfile.x.length; i++) {
      const diff = Math.abs(lastProfile.x[i]! - 500.0);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }

    const cellT = lastProfile.temperature[closestIdx]!;
    assert.ok(
      Math.abs(cellT - targetTempK) < 5.0,
      `Cell temperature at heat exchanger (${cellT.toFixed(2)} K) should approach target (${targetTempK} K)`,
    );
  });

  await t.test("4. Network Solver supports Heat Exchangers across gathering branches", () => {
    const netModel: OlgaModel = JSON.parse(JSON.stringify(baseModel));
    netModel.flowpaths[0]!.heatExchangers = [
      {
        name: "BRANCH_HEATER",
        position: 600.0,
        type: "SIMPLE",
        dutyKw: 3000.0,
      },
    ];

    const netResult = simulateOlgaNetwork(netModel, { totalSteps: 20, dt: 1.0 });
    const fpResult = netResult.flowpathResults["MAIN_LINE"]!;
    assert.ok(fpResult, "Network simulation should return flowpath result for MAIN_LINE");
    const arrT = fpResult.trends.arrivalTemperature;
    assert.ok(arrT[arrT.length - 1]! > 280.0, "Arrival temperature should remain well above subsea ambient");
  });

  await t.test("5. Linter Rule M7012 (asphaltene-precipitation-hazard) & Automated QuickFix", () => {
    const asphModel: OlgaModel = JSON.parse(JSON.stringify(baseModel));
    asphModel.flowpaths[0]!.asphalteneConfig = {
      sara: {
        saturatesPercent: 58.0,
        aromaticsPercent: 18.0,
        resinsPercent: 12.0,
        asphaltenesPercent: 12.0,
      },
      bubblePointPressure: 75e5,
      exposureTimeHours: 720.0,
    };

    const diagnostics = lintOlgaModel(asphModel);
    const m7012 = diagnostics.find((d) => d.code === "M7012");
    assert.ok(m7012, "Linter should emit M7012 for unstable crude operating in AOP envelope");
    assert.strictEqual(m7012.rule, "asphaltene-precipitation-hazard");
    assert.ok(m7012.message.includes("Asphaltene Onset Pressure"), "Message should mention AOP");
    assert.ok(m7012.message.includes("CII="), "Message should report CII index");

    // QuickFix verification
    const sampleKeyText = `FLOWPATH NAME = MAIN_LINE
PIPE LABEL = P1, LENGTH = 1000.0 m, DIAMETER = 0.254 m
ASPHALTENE SATURATES = 58.0 %, AROMATICS = 18.0 %, RESINS = 12.0 %, ASPHALTENES = 12.0 %, BUBBLEPOINT = 75.0 bar
`;
    const fixes = getOlgaQuickFixes(sampleKeyText, "file:///model.key");
    const m7012Fix = fixes.find((f) => f.code === "M7012");
    assert.ok(m7012Fix, "QuickFix provider should offer fix for M7012");
    assert.ok(
      m7012Fix.title.includes("aromatic chemical dispersant"),
      "QuickFix should propose aromatic solvent injection",
    );

    // Applying edit should boost AROMATICS to 45.0 %
    const edit = m7012Fix.edit.changes["file:///model.key"]![0]!;
    assert.ok(edit.newText.includes("45.0"), "QuickFix text must increase aromatics to 45%");
  });

  await t.test("6. Linter Rule M7013 (heatexchanger-parameter-violation)", () => {
    const invalidHexModel: OlgaModel = JSON.parse(JSON.stringify(baseModel));
    invalidHexModel.flowpaths[0]!.heatExchangers = [
      {
        name: "OUT_OF_BOUNDS_HEX",
        position: 5000.0, // Pipeline length is only 2000m!
        type: "SIMPLE",
        dutyKw: 1000.0,
      },
      {
        name: "UNPHYSICAL_TEMP_HEX",
        position: 500.0,
        targetTemperature: 15.0, // 15 K is unphysically low (below liquid nitrogen/helium)
      },
      {
        name: "NEGATIVE_UA_HEX",
        position: 800.0,
        overallUa: -250.0,
      },
    ];

    const diagnostics = lintOlgaModel(invalidHexModel);
    const m7013Errors = diagnostics.filter((d) => d.code === "M7013");
    assert.ok(m7013Errors.length >= 3, `Expected at least 3 M7013 errors, got ${m7013Errors.length}`);
    assert.ok(
      m7013Errors.some((d) => d.message.includes("lies outside flowpath")),
      "Should flag position out of pipeline bounds",
    );
    assert.ok(
      m7013Errors.some((d) => d.message.includes("outside physical bounds")),
      "Should flag target temperature outside physical bounds",
    );
    assert.ok(
      m7013Errors.some((d) => d.message.includes("non-positive overall UA")),
      "Should flag non-positive overall UA",
    );
  });
});
