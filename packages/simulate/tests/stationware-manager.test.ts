// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { OPEN_RELAY_CATALOG } from "../src/solvers/protection/relay-schema.js";
import {
  auditNercPrc005,
  auditNercPrc024,
  auditNercPrc027,
  compareRelaySettings,
  type FrequencyTripSetting,
  type ProtectionAssetRecord,
  type VoltageTripSetting,
} from "../src/solvers/protection/stationware-manager.js";

test("compareRelaySettings: detects setting modifications and generates audit diff", () => {
  const active = OPEN_RELAY_CATALOG.siemens_siprotec_7sa87!;
  // Candidate with modified Zone 1 reach and modified 51 pickup
  const candidate = {
    ...active,
    ansi51: [
      {
        ...active.ansi51![0]!,
        pickupCurrentA: 1.5, // changed from 1.2 to 1.5
      },
    ],
    ansi21: [
      {
        ...active.ansi21![0]!,
        reachOhm: 4.0, // changed from 3.5 to 4.0
      },
      active.ansi21![1]!,
      active.ansi21![2]!,
    ],
  };

  const diffResult = compareRelaySettings(active, candidate);
  assert.strictEqual(diffResult.hasChanges, true);
  assert.strictEqual(diffResult.totalChanges, 2);

  const diffFields = diffResult.diffs.map((d) => d.field);
  assert.ok(diffFields.includes("ansi51.pickupCurrentA"));
  assert.ok(diffFields.includes("ansi21.Zone1.reachOhm"));
});

test("auditNercPrc024: verifies generator frequency and voltage trip settings against mandatory boundaries", () => {
  // Compliant settings: trips outside the mandatory ride-through curves
  const compliantFreq: FrequencyTripSetting[] = [
    { frequencyHz: 56.5, tripDelaySec: 0.10, direction: "under_frequency" }, // f < 57.0 Hz
    { frequencyHz: 62.0, tripDelaySec: 0.10, direction: "over_frequency" }, // f > 61.8 Hz
  ];
  const compliantVolt: VoltageTripSetting[] = [
    { voltagePu: 0.40, tripDelaySec: 0.05, direction: "under_voltage" }, // V < 0.45 pu
    { voltagePu: 1.25, tripDelaySec: 0.05, direction: "over_voltage" }, // V > 1.20 pu
  ];

  const compliantAudit = auditNercPrc024(compliantFreq, compliantVolt);
  assert.strictEqual(compliantAudit.compliant, true);
  assert.strictEqual(compliantAudit.verdict, "COMPLIANT");
  assert.strictEqual(compliantAudit.violations.length, 0);

  // Non-compliant settings: tripping inside continuous operation or mandatory duration
  const nonCompliantFreq: FrequencyTripSetting[] = [
    { frequencyHz: 59.8, tripDelaySec: 0.50, direction: "under_frequency" }, // violates 59.5-60.0 continuous!
  ];
  const nonCompliantVolt: VoltageTripSetting[] = [
    { voltagePu: 0.88, tripDelaySec: 0.50, direction: "under_voltage" }, // violates 0.85-0.90 3.0s duration!
  ];

  const nonCompliantAudit = auditNercPrc024(nonCompliantFreq, nonCompliantVolt);
  assert.strictEqual(nonCompliantAudit.compliant, false);
  assert.strictEqual(nonCompliantAudit.verdict, "NON_COMPLIANT");
  assert.strictEqual(nonCompliantAudit.violations.length, 2);
});

test("auditNercPrc005 & auditNercPrc027: audits maintenance intervals and fault current variations", () => {
  // PRC-005 Maintenance Audit
  const assets: ProtectionAssetRecord[] = [
    {
      assetId: "relay_sub1_bay1",
      substationName: "North Substation",
      bayName: "Bay 1",
      deviceType: "distance",
      manufacturer: "Siemens",
      model: "7SA87",
      serialNumber: "SN-98765",
      firmwareVersion: "V8.40",
      commissioningDate: "2015-06-01",
      lastMaintenanceDate: "2023-01-15", // ~3.8 years ago
      maxMaintenanceIntervalYears: 6.0,
      activeSettingVersion: "1.0",
      activeSettings: OPEN_RELAY_CATALOG.siemens_siprotec_7sa87!,
      settingHistory: [],
    },
    {
      assetId: "relay_sub1_bay2",
      substationName: "North Substation",
      bayName: "Bay 2",
      deviceType: "distance",
      manufacturer: "ABB",
      model: "REL670",
      serialNumber: "SN-12345",
      firmwareVersion: "V2.2",
      commissioningDate: "2010-01-01",
      lastMaintenanceDate: "2018-01-01", // ~8.8 years ago (> 6.0 years allowed)
      maxMaintenanceIntervalYears: 6.0,
      activeSettingVersion: "2.1",
      activeSettings: OPEN_RELAY_CATALOG.abb_relion_rel670!,
      settingHistory: [],
    },
  ];

  const maintResults = auditNercPrc005(assets, "2026-11-09");
  assert.strictEqual(maintResults.length, 2);
  assert.strictEqual(maintResults[0]!.maintenanceOverdue, false);
  assert.strictEqual(maintResults[1]!.maintenanceOverdue, true);

  // PRC-027 Fault Current Review
  // Scenario 1: minor 3% change (no restudy needed)
  const prc027Minor = auditNercPrc027(101, "Bus 101", 20.0, 20.6);
  assert.strictEqual(prc027Minor.mandatoryRestudyRequired, false);

  // Scenario 2: major 15% increase due to new parallel transformer (mandatory restudy required)
  const prc027Major = auditNercPrc027(101, "Bus 101", 20.0, 23.5);
  assert.strictEqual(prc027Major.mandatoryRestudyRequired, true);
  assert.ok(prc027Major.deviationPercent >= 10.0);
});
