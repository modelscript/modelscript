// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditProtectionCoordination,
  parseRaw,
  type RelaySetting,
} from "../src/index.js";

const TEST_RAW = `0, 100.0, 33, 0, 0, 60.0 / IEEE 9-Bus Generator Test Case
1, 'BUS 1', 16.5, 3, 1, 1, 1, 1.0400, 0.0000, 1.100, 0.900, 1.100, 0.900 /
0 / END OF BUS DATA, BEGIN LOAD DATA
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
1, '1', 100.0, 30.0, 300.0, -300.0, 1.040, 0, 100.0, 0.0, 0.04, 0.0, 0.0, 1.0, 1, 100.0, 250.0, 10.0 /
0 / END OF GENERATOR DATA
Q
`;

describe("NERC PRC-019-2, PRC-024-3, and PRC-026-1 Protection Coordination Auditor", () => {
  it("audits compliant protection settings and issues clean pass report", () => {
    const psseCase = parseRaw(TEST_RAW);

    // Standard compliant settings:
    const compliantRelays: RelaySetting[] = [
      // 1. Undervoltage 27: 0.85 pu at 3.0 s (clears 0.75 pu at 2.0s / 0.88 pu at 4.0s)
      {
        deviceId: "UV_1",
        ansiCode: 27,
        elementName: "Generator 1-1",
        pickupValue: 0.80,
        timeDelaySec: 3.5,
      },
      // 2. Overvoltage 59: 1.18 pu at 0.5 s (above 1.15 pu boundary)
      {
        deviceId: "OV_1",
        ansiCode: 59,
        elementName: "Generator 1-1",
        pickupValue: 1.22,
        timeDelaySec: 0.1,
      },
      // 3. Frequency 81: 57.0 Hz at 0.1 s
      {
        deviceId: "UF_1",
        ansiCode: 81,
        elementName: "Generator 1-1",
        pickupValue: 56.0,
        timeDelaySec: 0.5,
      },
      // 4. Loss of Field 40: Offset = -0.5 * X'd_ohm = -0.5 * (0.04 * (16.5^2 / 100)) = -0.054 Ohm
      {
        deviceId: "LOF_1",
        ansiCode: 40,
        elementName: "Generator 1-1",
        pickupValue: 0.0,
        timeDelaySec: 0.25,
        offsetOhm: -0.054,
        diameterOhm: 2.5,
      },
      // 5. Volts/Hz 24: pickup 1.10 pu (above 1.05 continuous)
      {
        deviceId: "VHZ_1",
        ansiCode: 24,
        elementName: "Generator 1-1",
        pickupValue: 1.12,
        timeDelaySec: 2.0,
      },
      // 6. Distance Relay 21
      {
        deviceId: "DIS_1",
        ansiCode: 21,
        elementName: "Line 1-4",
        pickupValue: 40.0,
        timeDelaySec: 0.0,
      },
    ];

    const report = auditProtectionCoordination(psseCase, compliantRelays);
    assert.equal(report.overallStatus, "COMPLIANT");
    assert.equal(report.summary.violations, 0);
    assert.ok(report.summary.passed >= 5);
    assert.ok(report.markdownReport.includes("Protection Coordination Audit Report"));
  });

  it("detects PRC-024 ride-through and PRC-019 capability violations", () => {
    const psseCase = parseRaw(TEST_RAW);

    // Deficient settings:
    const violatingRelays: RelaySetting[] = [
      // 1. Premature Undervoltage: 0.95 pu at 0.5 s (violates ride-through curve)
      {
        deviceId: "UV_BAD",
        ansiCode: 27,
        elementName: "Generator 1-1",
        pickupValue: 0.95,
        timeDelaySec: 0.2,
      },
      // 2. Overvoltage trip set too low: 1.08 pu at 0.2 s (below 1.20 pu ceiling)
      {
        deviceId: "OV_BAD",
        ansiCode: 59,
        elementName: "Generator 1-1",
        pickupValue: 1.08,
        timeDelaySec: 0.1,
      },
      // 3. Loss of Field mho circle with positive offset (encroaches into normal operation)
      {
        deviceId: "LOF_BAD",
        ansiCode: 40,
        elementName: "Generator 1-1",
        pickupValue: 0.0,
        timeDelaySec: 0.2,
        offsetOhm: 1.5,
        diameterOhm: 3.0,
      },
      // 4. Volts/Hz below 1.05 pu continuous rating
      {
        deviceId: "VHZ_BAD",
        ansiCode: 24,
        elementName: "Generator 1-1",
        pickupValue: 1.02,
        timeDelaySec: 1.0,
      },
    ];

    const report = auditProtectionCoordination(psseCase, violatingRelays);
    assert.equal(report.overallStatus, "NON-COMPLIANT");
    assert.ok(report.summary.violations >= 4, `Expected >= 4 violations, got ${report.summary.violations}`);

    const uvFinding = report.prc024Findings.find((f) => f.rule === "prc-024-undervoltage-encroachment");
    assert.ok(uvFinding);
    assert.equal(uvFinding.severity, "violation");

    const lofFinding = report.prc019Findings.find((f) => f.rule === "prc-019-lof-positive-offset");
    assert.ok(lofFinding);
    assert.equal(lofFinding.severity, "violation");

    const vhzFinding = report.prc019Findings.find((f) => f.rule === "prc-019-vhz-below-continuous");
    assert.ok(vhzFinding);
    assert.equal(vhzFinding.severity, "violation");
  });
});
