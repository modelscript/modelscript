// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditTelecomSupplyChain,
  evaluateFccPart4Outage,
  FCC_COVERED_LIST_VENDORS,
  generateDirsEmergencySnapshot,
  generateNorsFilingDossier,
  type TelecomEquipmentItem,
  type TelecomOutageEvent,
} from "../src/index.js";

describe("Enterprise Telecom Compliance: NIST SP 800-161 SCRM & FCC Part 4 NORS/DIRS", () => {
  it("verifies telecom hardware against FCC Covered List & untrusted origins", () => {
    assert.ok(FCC_COVERED_LIST_VENDORS.has("HUAWEI"));
    assert.ok(FCC_COVERED_LIST_VENDORS.has("ZTE"));

    const equipment: TelecomEquipmentItem[] = [
      {
        id: "ROADM-BAY-01",
        name: "Ciena 6500 CDC ROADM",
        vendor: "Ciena",
        model: "6500-D14",
        category: "roadm",
        countryOfOrigin: "CA",
        hasHardwareRootOfTrust: true,
      },
      {
        id: "RADIO-02",
        name: "Ericsson AIR 6449",
        vendor: "Ericsson",
        model: "AIR6449",
        category: "ran_baseband",
        countryOfOrigin: "SE",
        hasHardwareRootOfTrust: true,
      },
      {
        id: "ROADM-UNTRUSTED",
        name: "Huawei OptiX OSN 9800",
        vendor: "Huawei Technologies",
        model: "OSN 9800",
        category: "roadm",
        countryOfOrigin: "CN",
      },
    ];

    const result = auditTelecomSupplyChain(equipment);
    assert.equal(result.compliant, false, "Must detect Huawei on Covered List");
    assert.equal(result.coveredListViolations.length, 1);
    assert.equal(result.coveredListViolations[0]!.vendor, "Huawei Technologies");
    assert.ok(result.coveredListViolations[0]!.reason.includes("FCC Covered List"));

    // Filter out untrusted vendor
    const cleanBOM = equipment.filter((e) => e.vendor !== "Huawei Technologies");
    const cleanResult = auditTelecomSupplyChain(cleanBOM);
    assert.equal(cleanResult.compliant, true);
    assert.equal(cleanResult.coveredListViolations.length, 0);
  });

  it("evaluates mandatory FCC Part 4 NORS reporting thresholds", () => {
    // 1. Minor event (<900,000 user-minutes, 911 unaffected): Not reportable
    const minorEvent: TelecomOutageEvent = {
      outageId: "OUTAGE-LOCAL-01",
      serviceProviderName: "FiberNet Utility",
      startTimeIso: "2026-11-09T08:00:00Z",
      durationMinutes: 45,
      affectedUsersEstimate: 1000, // 45,000 user-minutes < 900,000
      is911Affected: false,
      rootCauseDescription: "Local distribution splice closure water intrusion",
    };
    const minorEval = evaluateFccPart4Outage(minorEvent);
    assert.equal(minorEval.isReportableUnderPart4, false);
    assert.equal(minorEval.filingType, "NONE");

    // 2. Major user-minute outage (60 min x 25,000 users = 1,500,000 user-minutes): Reportable within 72 hours
    const majorEvent: TelecomOutageEvent = {
      outageId: "OUTAGE-METRO-02",
      serviceProviderName: "FiberNet Utility",
      startTimeIso: "2026-11-09T10:00:00Z",
      durationMinutes: 60,
      affectedUsersEstimate: 25000,
      is911Affected: false,
      rootCauseDescription: "Backhoe cut on primary feeder route in shared trench",
    };
    const majorEval = evaluateFccPart4Outage(majorEvent);
    assert.equal(majorEval.isReportableUnderPart4, true);
    assert.equal(majorEval.filingType, "NORS_INITIAL");
    assert.equal(majorEval.reportingDeadlineHours, 72.0);
    assert.ok(majorEval.thresholdExceededReason?.includes("900,000 threshold"));

    // 3. 911 Special Facility Outage: Emergency 2-hour notification required
    const psapEvent: TelecomOutageEvent = {
      outageId: "OUTAGE-911-CRITICAL",
      serviceProviderName: "FiberNet Utility",
      startTimeIso: "2026-11-09T14:00:00Z",
      durationMinutes: 35,
      affectedUsersEstimate: 5000,
      is911Affected: true,
      psapFacilityAffected: true,
      rootCauseDescription: "Central office optical transponder failure isolating County PSAP",
    };
    const psapEval = evaluateFccPart4Outage(psapEvent);
    assert.equal(psapEval.isReportableUnderPart4, true);
    assert.equal(psapEval.filingType, "NORS_NOTIFICATION");
    assert.equal(psapEval.reportingDeadlineHours, 2.0);
    assert.ok(psapEval.thresholdExceededReason?.includes("911 Special Facility Outage"));

    // 4. Generate structured NORS filing dossier
    const dossier = generateNorsFilingDossier(psapEvent, "notification", "FRN-0029318");
    assert.equal(dossier.filingStage, "notification");
    assert.equal(dossier.fccFilerId, "FRN-0029318");
    assert.ok(dossier.regulatoryPayloadJson.includes("NORS_PART4_ELECTRONIC"));
    assert.ok(dossier.regulatoryPayloadJson.includes("County PSAP"));

    // 5. Generate DIRS daily emergency snapshot
    const dirsReport = generateDirsEmergencySnapshot({
      incidentName: "Hurricane Helena Response",
      reportingDateIso: "2026-11-09T10:00:00Z",
      totalCellSitesInDisasterArea: 250,
      cellSitesOperational: 215,
      cellSitesOnBackupGenerator: 45,
      cellSitesOnBatteryOnly: 12,
      cellSitesOutServicePower: 28,
      cellSitesOutServiceTransport: 7,
      cellSitesOutServiceDamage: 0,
      minimumFuelHoursRemaining: 36.0,
    });
    assert.equal(dirsReport.totalSites, 250);
    assert.equal(dirsReport.operationalPercent, 86.0);
    assert.equal(dirsReport.criticalFuelWarning, false);
    assert.ok(dirsReport.dirsFilingXml.includes("<dirs_daily_report>"));
    assert.ok(dirsReport.dirsFilingXml.includes("Hurricane Helena Response"));
  });
});
