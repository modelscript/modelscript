// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TelecomTheoryOracle } from "../src/formal/oracles/telecom_oracle.js";

describe("TelecomTheoryOracle: Nelson-Oppen FOL Verification for Telecom Utilities", () => {
  it("verifies optical transmission GSNR, CD buffer, and Kerr threshold", () => {
    const oracle = new TelecomTheoryOracle();

    // 1. SAT Optical Channel
    oracle.assertOpticalChannel({
      channelId: "CH-193.10THz",
      wavelengthNm: 1550.12,
      actualGsnrDb: 18.5,
      minRequiredGsnrDb: 15.0,
      accumulatedCdPsPerNm: 12000,
      maxDspCdBufferPsPerNm: 40000,
      launchPowerDbm: 0.0,
      maxKerrPowerDbm: 3.0,
    });

    const satRes = oracle.checkSat();
    assert.equal(satRes.isSat, true, "Optical channel with 3.5 dB margin must be SAT");

    // 2. Push level and assert a degraded channel (GSNR deficit)
    oracle.pushLevel();
    oracle.assertOpticalChannel({
      channelId: "CH-193.20THz",
      wavelengthNm: 1550.92,
      actualGsnrDb: 13.8, // Below 15.0 dB!
      minRequiredGsnrDb: 15.0,
      accumulatedCdPsPerNm: 12500,
      maxDspCdBufferPsPerNm: 40000,
      launchPowerDbm: 0.0,
      maxKerrPowerDbm: 3.0,
    });

    const unsatRes = oracle.checkSat();
    assert.equal(unsatRes.isSat, false, "Degraded channel must trigger UNSAT");
    assert.ok(unsatRes.conflict?.explanation.includes("GSNR 13.80 dB is below required"));

    // Pop level back to SAT state
    oracle.popLevel();
    assert.equal(oracle.checkSat().isSat, true, "Popping level must restore SAT state");
  });

  it("verifies PTP/SyncE timing error and 3GPP cluster alignment", () => {
    const oracle = new TelecomTheoryOracle();

    oracle.assertPtpTiming({
      chainId: "FRONTHAUL-NYC",
      actualTimeErrorNs: 125.0,
      maxAllowedTimeErrorNs: 1500.0,
      clusterTimeErrorNs: 65.0,
      maxAllowedClusterErrorNs: 130.0,
    });

    assert.equal(oracle.checkSat().isSat, true);

    // Assert timing chain violating 3GPP limit
    oracle.pushLevel();
    oracle.assertPtpTiming({
      chainId: "LONG-HAUL-FAIL",
      actualTimeErrorNs: 1850.0, // > 1500 ns!
      maxAllowedTimeErrorNs: 1500.0,
      clusterTimeErrorNs: 40.0,
      maxAllowedClusterErrorNs: 130.0,
    });

    const conflict = oracle.checkSat();
    assert.equal(conflict.isSat, false);
    assert.ok(conflict.conflict?.explanation.includes("PTP Timing Violation"));

    oracle.popLevel();
    assert.equal(oracle.checkSat().isSat, true);
  });

  it("verifies microwave Fresnel clearance and OSP SRLG disjointness", () => {
    const oracle = new TelecomTheoryOracle();

    // SAT Microwave link
    oracle.assertMicrowavePath({
      linkId: "MW-01",
      actualClearanceRatio: 0.85,
      minClearanceRatio: 0.6,
      annualAvailabilityPercent: 99.9995,
      minAvailabilityPercent: 99.999,
      eirpDbm: 42.0,
      maxAllowedEirpDbm: 55.0,
    });

    // SAT SRLG disjoint paths
    oracle.assertSrlgPair({
      primaryPathId: "PATH-A",
      backupPathId: "PATH-B",
      sharedSrlgCount: 0,
      sharedSrlgs: [],
    });

    assert.equal(oracle.checkSat().isSat, true);

    // Shared risk on bridge crossing
    oracle.pushLevel();
    oracle.assertSrlgPair({
      primaryPathId: "PATH-EAST",
      backupPathId: "PATH-WEST",
      sharedSrlgCount: 1,
      sharedSrlgs: ["BRIDGE-HUDSON"],
    });

    const spofConflict = oracle.checkSat();
    assert.equal(spofConflict.isSat, false);
    assert.ok(spofConflict.conflict?.explanation.includes("BRIDGE-HUDSON"));

    oracle.popLevel();
    assert.equal(oracle.checkSat().isSat, true);
  });
});
