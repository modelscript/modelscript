// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  computeAnalyticalHoldoverDurationHours,
  computeMtie,
  lowerOscillatorHoldoverToDae,
  solvePtpTimeErrorBudget,
  type PtpSyncChain,
} from "../src/index.js";

test("Optical PTP/SyncE timing budget and oscillator holdover DAE", async (t) => {
  await t.test("evaluates ITU-T G.8275.1 PTP time error budget for 5G TDD", () => {
    const chain: PtpSyncChain = {
      id: "FRONTHAUL-CHAIN-01",
      prtcType: "PRTC-B", // +-40 ns to UTC
      nodes: [
        { id: "GM", name: "Central Grandmaster", role: "T-GM", clockClass: "ClassD", calibratedCteNs: 2.0 },
        {
          id: "BC1",
          name: "Core Switch",
          role: "T-BC",
          clockClass: "ClassC",
          calibratedCteNs: 5.0,
          calibratedDteNs: 15.0,
        },
        {
          id: "BC2",
          name: "Aggregation Switch",
          role: "T-BC",
          clockClass: "ClassC",
          calibratedCteNs: 5.0,
          calibratedDteNs: 15.0,
        },
        {
          id: "BC3",
          name: "Cell Site Gateway",
          role: "T-BC",
          clockClass: "ClassC",
          calibratedCteNs: 5.0,
          calibratedDteNs: 15.0,
        },
        {
          id: "TSC",
          name: "5G gNodeB RU",
          role: "T-TSC",
          clockClass: "ClassC",
          calibratedCteNs: 5.0,
          calibratedDteNs: 10.0,
        },
      ],
      links: [
        { fromNodeId: "GM", toNodeId: "BC1", lengthKm: 25.0, fiberLengthDeltaMeters: 0.2 }, // 0.2m = ~0.5 ns asym
        { fromNodeId: "BC1", toNodeId: "BC2", lengthKm: 15.0, fiberLengthDeltaMeters: 0.1 },
        { fromNodeId: "BC2", toNodeId: "BC3", lengthKm: 10.0, fiberLengthDeltaMeters: 0.1 },
        { fromNodeId: "BC3", toNodeId: "TSC", lengthKm: 2.0, fiberLengthDeltaMeters: 0.05 },
      ],
      maxAllowedTimeErrorNs: 1500.0, // 3GPP 5G +-1.5 us
    };

    const budget = solvePtpTimeErrorBudget(chain);
    assert.equal(budget.compliant, true, "Should be compliant with 3GPP 1500 ns limit");
    assert.ok(budget.maxTimeErrorNs < 200.0, `Expected <200 ns, got ${budget.maxTimeErrorNs}`);
    assert.ok(budget.clusterInternalTimeErrorNs < 130.0, "Should satisfy 3GPP Cat A+ intra-cluster limit (130 ns)");
    assert.equal(budget.clusterInternalCompliant, true);
    assert.equal(budget.hopCount, 5);
  });

  await t.test("computes MTIE metric over time error trajectory", () => {
    // Generate simple simulated phase error samples (ns)
    const samples = [0.0, 1.2, 3.4, 2.1, 4.5, 6.0, 5.2, 7.8, 6.5, 8.0, 9.1, 8.5];
    const mtie = computeMtie(samples, 1.0, [1.0, 2.0, 5.0]);

    assert.equal(mtie.length, 3);
    assert.ok(mtie[0]!.mtieNs > 0.0);
    // MTIE must be monotonically non-decreasing with tau
    assert.ok(mtie[1]!.mtieNs >= mtie[0]!.mtieNs);
    assert.ok(mtie[2]!.mtieNs >= mtie[1]!.mtieNs);
  });

  await t.test("computes analytical oscillator holdover duration during GNSS outage", () => {
    // Rubidium in central office (0.5 K/hr) should sustain 1.5 us holdover for >24 hours
    const rbHours = computeAnalyticalHoldoverDurationHours({
      oscillator: "Rubidium",
      temperatureRampKelvinPerHour: 0.5,
      initialTimeErrorNs: 20.0,
      maxAllowableErrorNs: 1500.0,
    });
    assert.ok(rbHours > 24.0, `Expected Rubidium holdover >24h, got ${rbHours}h`);

    // OCXO should sustain 1.5 us holdover for several hours
    const ocxoHours = computeAnalyticalHoldoverDurationHours({
      oscillator: "OCXO",
      temperatureRampKelvinPerHour: 1.0,
      initialTimeErrorNs: 20.0,
      maxAllowableErrorNs: 1500.0,
    });
    assert.ok(ocxoHours > 2.0 && ocxoHours < 24.0, `Expected OCXO holdover between 2 and 24h, got ${ocxoHours}h`);

    // TCXO should fail within a few minutes
    const tcxoHours = computeAnalyticalHoldoverDurationHours({
      oscillator: "TCXO",
      temperatureRampKelvinPerHour: 1.0,
      initialTimeErrorNs: 20.0,
      maxAllowableErrorNs: 1500.0,
    });
    assert.ok(tcxoHours < 0.5, `Expected TCXO holdover <0.5h, got ${tcxoHours}h`);
  });

  await t.test("lowers oscillator holdover ODEs to DAEBuilder", () => {
    const dae = lowerOscillatorHoldoverToDae({
      oscillator: "DOCXO",
      temperatureRampKelvinPerHour: 2.0,
    });

    assert.ok(dae.lookupVariable("x") !== -1, "Should declare state x (time error)");
    assert.ok(dae.lookupVariable("y") !== -1, "Should declare state y (fractional frequency offset)");
    assert.ok(dae.lookupVariable("T") !== -1, "Should declare state T (temperature)");
    assert.ok(dae.lookupVariable("timeErrorNs") !== -1, "Should declare output timeErrorNs");

    // Check that states are properly marked
    const varX = dae.lookupVariable("x");
    assert.ok(dae.isVarState(varX), "x must be marked as continuous state");

    // Equations: 3 parameter equations + der(x)=y, der(T)=dT_dt, der(y)=D+alpha*dT_dt, timeErrorNs=x*scale
    assert.equal(dae.eqCount, 7);
  });
});
