// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

/**
 * Enterprise Edition — Telecom Utility SCRM & FCC Regulatory Compliance.
 *
 * Implements:
 *   1. NIST SP 800-161 Rev. 1 & FCC Covered List Supply Chain Risk Management (SCRM)
 *      (Secure and Trusted Communications Networks Act / NDAA Section 889).
 *   2. FCC Part 4 NORS (Network Outage Reporting System) & DIRS (Disaster Information
 *      Reporting System) mandatory outage notification evaluator.
 */

/**
 * FCC Covered List / NDAA Section 889 Prohibited Telecom Vendors.
 * Entities deemed to pose an unacceptable risk to national security.
 */
export const FCC_COVERED_LIST_VENDORS = new Set<string>([
  "HUAWEI",
  "HUAWEI TECHNOLOGIES",
  "ZTE",
  "ZTE CORPORATION",
  "HYTERA",
  "HYTERA COMMUNICATIONS",
  "HIKVISION",
  "HANGZHOU HIKVISION",
  "DAHUA",
  "ZHEJIANG DAHUA",
  "KASPERSKY",
  "AO KASPERSKY LAB",
  "CHINA MOBILE",
  "CHINA MOBILE INTERNATIONAL",
  "CHINA TELECOM",
  "CHINA TELECOM AMERICAS",
  "PACIFIC NETWORKS",
  "COMNET",
  "CHINA UNICOM",
  "CHINA UNICOM AMERICAS",
]);

export interface TelecomEquipmentItem {
  id: string;
  name: string;
  vendor: string;
  model: string;
  category: "optical_transponder" | "roadm" | "switch_router" | "ran_baseband" | "antenna" | "microwave_radio";
  countryOfOrigin?: string | undefined;
  firmwareVersion?: string | undefined;
  hasHardwareRootOfTrust?: boolean | undefined;
}

export interface ScrmAuditResult {
  compliant: boolean;
  totalItemsScanned: number;
  coveredListViolations: {
    itemId: string;
    vendor: string;
    model: string;
    reason: string;
  }[];
  untrustedOriginWarnings: {
    itemId: string;
    vendor: string;
    countryOfOrigin: string;
  }[];
}

/**
 * Evaluates telecom Outside Plant and Central Office BOM equipment against
 * the FCC Covered List and NIST SP 800-161 supply chain trust requirements.
 */
export function auditTelecomSupplyChain(items: TelecomEquipmentItem[]): ScrmAuditResult {
  const violations: ScrmAuditResult["coveredListViolations"] = [];
  const warnings: ScrmAuditResult["untrustedOriginWarnings"] = [];

  for (const item of items) {
    const normVendor = item.vendor.trim().toUpperCase();
    const isCovered = Array.from(FCC_COVERED_LIST_VENDORS).some(
      (cov) => normVendor === cov || normVendor.includes(cov),
    );

    if (isCovered) {
      violations.push({
        itemId: item.id,
        vendor: item.vendor,
        model: item.model,
        reason: `Vendor '${item.vendor}' is designated on the FCC Covered List pursuant to the Secure and Trusted Communications Networks Act. Equipment is prohibited from US critical telecommunications infrastructure.`,
      });
    }

    if (item.countryOfOrigin && ["RU", "IR", "KP", "CN"].includes(item.countryOfOrigin.toUpperCase())) {
      warnings.push({
        itemId: item.id,
        vendor: item.vendor,
        countryOfOrigin: item.countryOfOrigin,
      });
    }
  }

  return {
    compliant: violations.length === 0,
    totalItemsScanned: items.length,
    coveredListViolations: violations,
    untrustedOriginWarnings: warnings,
  };
}

/**
 * FCC Part 4 (47 C.F.R. § 4.9) Outage Event Parameters.
 */
export interface TelecomOutageEvent {
  outageId: string;
  serviceProviderName: string;
  startTimeIso: string;
  endTimeIso?: string | undefined;
  durationMinutes: number;
  affectedUsersEstimate: number;
  is911Affected: boolean;
  psapFacilityAffected?: boolean | undefined;
  majorTransportAffected?: boolean | undefined; // DS3, OC3, OC48, 100G+ link cut
  affectedCounties?: string[] | undefined;
  rootCauseDescription: string;
}

export interface FccPart4NorsEvaluation {
  outageId: string;
  isReportableUnderPart4: boolean;
  userMinutes: number;
  thresholdExceededReason?: string | undefined;
  reportingDeadlineHours: number; // 2 hours for Notification, 72 hours for Initial, 30 days for Final
  filingType: "NORS_NOTIFICATION" | "NORS_INITIAL" | "DIRS_DAILY" | "NONE";
}

/**
 * Evaluates whether an outage reaches mandatory FCC Part 4 NORS reporting thresholds.
 * Thresholds:
 *   1. Outage duration >= 30 minutes AND user-minutes >= 900,000 (47 C.F.R. § 4.9(a)(1)).
 *   2. Potentially affecting 911 special facility / PSAP for >= 30 minutes (2-hour notification required).
 *   3. Major transport facility failure (e.g. >= 100G optical DWDM cut) for >= 30 minutes.
 */
export function evaluateFccPart4Outage(event: TelecomOutageEvent): FccPart4NorsEvaluation {
  const userMinutes = event.durationMinutes * event.affectedUsersEstimate;
  const isDurationEligible = event.durationMinutes >= 30;

  if (isDurationEligible && event.is911Affected) {
    return {
      outageId: event.outageId,
      isReportableUnderPart4: true,
      userMinutes,
      thresholdExceededReason:
        "911 Special Facility Outage: Exceeds 30-minute threshold impacting public safety emergency access (47 C.F.R. § 4.9(e)). Mandatory electronic notification within 2 hours.",
      reportingDeadlineHours: 2.0,
      filingType: "NORS_NOTIFICATION",
    };
  }

  if (isDurationEligible && userMinutes >= 900000) {
    return {
      outageId: event.outageId,
      isReportableUnderPart4: true,
      userMinutes,
      thresholdExceededReason: `User-Minutes Threshold Exceeded: ${userMinutes.toLocaleString()} user-minutes >= 900,000 threshold (47 C.F.R. § 4.9). Initial report required within 72 hours.`,
      reportingDeadlineHours: 72.0,
      filingType: "NORS_INITIAL",
    };
  }

  if (isDurationEligible && event.majorTransportAffected) {
    return {
      outageId: event.outageId,
      isReportableUnderPart4: true,
      userMinutes,
      thresholdExceededReason:
        "Major Transport Facility Interruption: Inter-office optical transport cut >= 30 minutes (47 C.F.R. § 4.9(f)).",
      reportingDeadlineHours: 72.0,
      filingType: "NORS_INITIAL",
    };
  }

  return {
    outageId: event.outageId,
    isReportableUnderPart4: false,
    userMinutes,
    thresholdExceededReason: undefined,
    reportingDeadlineHours: 0,
    filingType: "NONE",
  };
}

export interface NorsFilingDossier {
  filingStage: "notification" | "initial" | "final";
  outageId: string;
  serviceProviderName: string;
  fccFilerId?: string | undefined;
  filingTimestampIso: string;
  deadlineTimestampIso: string;
  isCompliantWithFilingDeadline: boolean;
  eventSummary: {
    startTime: string;
    endTime?: string | undefined;
    durationMinutes: number;
    userMinutes: number;
    affectedUsers: number;
    is911Affected: boolean;
    rootCause: string;
  };
  regulatoryPayloadJson: string;
}

export function generateNorsFilingDossier(
  event: TelecomOutageEvent,
  stage: "notification" | "initial" | "final" = "notification",
  fccFilerId = "FCC-FILER-10023",
): NorsFilingDossier {
  const evalResult = evaluateFccPart4Outage(event);
  const now = new Date();
  const startTime = new Date(event.startTimeIso);

  let deadlineHours = 2.0;
  if (stage === "initial") deadlineHours = 72.0;
  else if (stage === "final") deadlineHours = 720.0; // 30 days

  const deadline = new Date(startTime.getTime() + deadlineHours * 3600 * 1000);
  const isCompliant = now.getTime() <= deadline.getTime();

  const payload = {
    fcc_form: "NORS_PART4_ELECTRONIC",
    filing_stage: stage.toUpperCase(),
    filer_frn: fccFilerId,
    carrier_name: event.serviceProviderName,
    incident_id: event.outageId,
    start_time: event.startTimeIso,
    duration_minutes: event.durationMinutes,
    user_minutes: evalResult.userMinutes,
    affected_users: event.affectedUsersEstimate,
    e911_impact: event.is911Affected,
    psap_contacted: event.is911Affected,
    geographic_areas: event.affectedCounties ?? ["Unspecified"],
    root_cause_category: event.rootCauseDescription,
    legal_certification: "Certified under penalty of perjury pursuant to 47 C.F.R. § 4.11.",
  };

  return {
    filingStage: stage,
    outageId: event.outageId,
    serviceProviderName: event.serviceProviderName,
    fccFilerId,
    filingTimestampIso: now.toISOString(),
    deadlineTimestampIso: deadline.toISOString(),
    isCompliantWithFilingDeadline: isCompliant,
    eventSummary: {
      startTime: event.startTimeIso,
      endTime: event.endTimeIso,
      durationMinutes: event.durationMinutes,
      userMinutes: evalResult.userMinutes,
      affectedUsers: event.affectedUsersEstimate,
      is911Affected: event.is911Affected,
      rootCause: event.rootCauseDescription,
    },
    regulatoryPayloadJson: JSON.stringify(payload, null, 2),
  };
}

export interface DirsSnapshotInput {
  incidentName: string;
  reportingDateIso: string;
  totalCellSitesInDisasterArea: number;
  cellSitesOperational: number;
  cellSitesOnBackupGenerator: number;
  cellSitesOnBatteryOnly: number;
  cellSitesOutServicePower: number;
  cellSitesOutServiceTransport: number;
  cellSitesOutServiceDamage: number;
  minimumFuelHoursRemaining: number;
}

export interface DirsSnapshotReport {
  incidentName: string;
  reportingDateIso: string;
  totalSites: number;
  operationalPercent: number;
  outOfServicePercent: number;
  backupGeneratorPercent: number;
  criticalFuelWarning: boolean;
  dirsFilingXml: string;
}

export function generateDirsEmergencySnapshot(input: DirsSnapshotInput): DirsSnapshotReport {
  const total = Math.max(1, input.totalCellSitesInDisasterArea);
  const operational = input.cellSitesOperational;
  const outOfService = total - operational;

  const operationalPct = Math.round((operational / total) * 1000) / 10;
  const outOfServicePct = Math.round((outOfService / total) * 1000) / 10;
  const generatorPct = Math.round((input.cellSitesOnBackupGenerator / total) * 1000) / 10;

  const criticalFuel = input.minimumFuelHoursRemaining < 24.0;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dirs_daily_report>
  <incident_name>${input.incidentName}</incident_name>
  <report_timestamp>${input.reportingDateIso}</report_timestamp>
  <cell_sites total="${total}" operational="${operational}" out_of_service="${outOfService}">
    <power_loss>${input.cellSitesOutServicePower}</power_loss>
    <transport_cut>${input.cellSitesOutServiceTransport}</transport_cut>
    <physical_damage>${input.cellSitesOutServiceDamage}</physical_damage>
  </cell_sites>
  <backup_power generator="${input.cellSitesOnBackupGenerator}" battery_only="${input.cellSitesOnBatteryOnly}">
    <min_fuel_hours_remaining>${input.minimumFuelHoursRemaining}</min_fuel_hours_remaining>
  </backup_power>
</dirs_daily_report>`;

  return {
    incidentName: input.incidentName,
    reportingDateIso: input.reportingDateIso,
    totalSites: total,
    operationalPercent: operationalPct,
    outOfServicePercent: outOfServicePct,
    backupGeneratorPercent: generatorPct,
    criticalFuelWarning: criticalFuel,
    dirsFilingXml: xml,
  };
}
