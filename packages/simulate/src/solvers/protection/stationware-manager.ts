// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview DIgSILENT StationWare Parity: Relay Asset & Settings Lifecycle Management
 * and Automated NERC PRC Compliance Auditor (PRC-024-3, PRC-027-1, PRC-005-6).
 *
 * Implements:
 *   - Centralized Protection Asset Inventory: Substations, bays, devices, serials, and firmware.
 *   - Setting Lifecycle & Differential Audit: Candidate vs Active setting comparisons with audit trail.
 *   - NERC PRC-024-3: Generator frequency and voltage protective relay trip setting boundary verification.
 *   - NERC PRC-027-1: Fault current change tracking (>10% deviation triggers mandatory restudy).
 *   - NERC PRC-005-6: Protection system maintenance interval and calibration test auditing.
 *
 * Industry Standards:
 * - NERC Reliability Standard PRC-024-3: Generator Frequency and Voltage Protective Relay Settings.
 * - NERC Reliability Standard PRC-027-1: Coordination of Protection Systems for Performance During Faults.
 * - NERC Reliability Standard PRC-005-6: Protection System, Automatic Reclosing, and Sudden Pressure Relaying Maintenance.
 */

import type { RelaySettingManifest } from "./relay-schema.js";

export interface ProtectionAssetRecord {
  assetId: string;
  substationName: string;
  bayName: string;
  deviceType: "distance" | "differential" | "feeder_overcurrent" | "generator_protection";
  manufacturer: string;
  model: string;
  serialNumber: string;
  firmwareVersion: string;
  commissioningDate: string; // ISO format: YYYY-MM-DD
  lastMaintenanceDate: string; // ISO format: YYYY-MM-DD
  maxMaintenanceIntervalYears: number; // e.g. 6 or 12 years per PRC-005
  activeSettingVersion: string;
  activeSettings: RelaySettingManifest;
  settingHistory: Array<{
    version: string;
    date: string;
    author: string;
    approvedBy: string;
    notes: string;
    settings: RelaySettingManifest;
  }>;
}

export interface SettingDiffItem {
  field: string;
  activeValue: string | number;
  candidateValue: string | number;
  description: string;
}

export interface SettingComparisonResult {
  assetId: string;
  hasChanges: boolean;
  totalChanges: number;
  diffs: SettingDiffItem[];
  summary: string;
}

export interface FrequencyTripSetting {
  frequencyHz: number;
  tripDelaySec: number;
  direction: "over_frequency" | "under_frequency";
}

export interface VoltageTripSetting {
  voltagePu: number;
  tripDelaySec: number;
  direction: "over_voltage" | "under_voltage";
}

export interface Prc024AuditResult {
  compliant: boolean;
  totalSettingsAudited: number;
  violations: Array<{
    settingType: "frequency" | "voltage";
    value: number;
    tripDelaySec: number;
    mandatedNoTripDurationSec: number;
    reason: string;
  }>;
  verdict: "COMPLIANT" | "NON_COMPLIANT";
  summaryText: string;
}

export interface Prc005MaintenanceAuditResult {
  assetId: string;
  substation: string;
  bay: string;
  lastMaintenanceDate: string;
  yearsSinceLastMaintenance: number;
  allowedIntervalYears: number;
  maintenanceOverdue: boolean;
  daysUntilOverdue: number;
}

export interface Prc027FaultReviewResult {
  busNumber: number;
  busName: string;
  baselineFaultCurrentKa: number;
  currentFaultCurrentKa: number;
  deviationPercent: number;
  mandatoryRestudyRequired: boolean;
  explanation: string;
}

/**
 * Compares two relay settings manifests and produces an audit diff.
 */
export function compareRelaySettings(
  active: RelaySettingManifest,
  candidate: RelaySettingManifest,
): SettingComparisonResult {
  const diffs: SettingDiffItem[] = [];

  // CT Ratio check
  if (
    active.ctRatio.primaryA !== candidate.ctRatio.primaryA ||
    active.ctRatio.secondaryA !== candidate.ctRatio.secondaryA
  ) {
    diffs.push({
      field: "ctRatio",
      activeValue: `${active.ctRatio.primaryA}/${active.ctRatio.secondaryA}`,
      candidateValue: `${candidate.ctRatio.primaryA}/${candidate.ctRatio.secondaryA}`,
      description: "CT ratio modification affects all secondary pickup currents.",
    });
  }

  // Instantaneous ANSI 50
  const active50 = active.ansi50?.[0];
  const cand50 = candidate.ansi50?.[0];
  if (active50 && cand50 && active50.pickupCurrentA !== cand50.pickupCurrentA) {
    diffs.push({
      field: "ansi50.pickupCurrentA",
      activeValue: active50.pickupCurrentA,
      candidateValue: cand50.pickupCurrentA,
      description: `Instantaneous 50 pickup changed from ${active50.pickupCurrentA}A to ${cand50.pickupCurrentA}A.`,
    });
  }

  // Time-Overcurrent ANSI 51
  const active51 = active.ansi51?.[0];
  const cand51 = candidate.ansi51?.[0];
  if (active51 && cand51) {
    if (active51.pickupCurrentA !== cand51.pickupCurrentA) {
      diffs.push({
        field: "ansi51.pickupCurrentA",
        activeValue: active51.pickupCurrentA,
        candidateValue: cand51.pickupCurrentA,
        description: `IDMT pickup changed from ${active51.pickupCurrentA}A to ${cand51.pickupCurrentA}A.`,
      });
    }
    if (active51.timeDial !== cand51.timeDial) {
      diffs.push({
        field: "ansi51.timeDial",
        activeValue: active51.timeDial,
        candidateValue: cand51.timeDial,
        description: `Time dial changed from ${active51.timeDial} to ${cand51.timeDial}.`,
      });
    }
    if (active51.curveType !== cand51.curveType) {
      diffs.push({
        field: "ansi51.curveType",
        activeValue: active51.curveType,
        candidateValue: cand51.curveType,
        description: `IDMT curve changed from ${active51.curveType} to ${cand51.curveType}.`,
      });
    }
  }

  // Distance ANSI 21 zones
  const actZones = active.ansi21 ?? [];
  const candZones = candidate.ansi21 ?? [];
  for (let z = 0; z < Math.max(actZones.length, candZones.length); z++) {
    const az = actZones[z];
    const cz = candZones[z];
    if (az && cz) {
      if (az.reachOhm !== cz.reachOhm) {
        diffs.push({
          field: `ansi21.Zone${az.zoneNumber}.reachOhm`,
          activeValue: az.reachOhm,
          candidateValue: cz.reachOhm,
          description: `Zone ${az.zoneNumber} reach changed from ${az.reachOhm} Ohm to ${cz.reachOhm} Ohm.`,
        });
      }
      if (az.delaySec !== cz.delaySec) {
        diffs.push({
          field: `ansi21.Zone${az.zoneNumber}.delaySec`,
          activeValue: az.delaySec,
          candidateValue: cz.delaySec,
          description: `Zone ${az.zoneNumber} delay changed from ${az.delaySec}s to ${cz.delaySec}s.`,
        });
      }
    }
  }

  const hasChanges = diffs.length > 0;
  const summary = hasChanges
    ? `Identified ${diffs.length} setting changes between active and candidate versions for ${active.id}.`
    : `Active and candidate settings for ${active.id} are identical.`;

  return {
    assetId: active.id,
    hasChanges,
    totalChanges: diffs.length,
    diffs,
    summary,
  };
}

/**
 * Audits generator protection trip settings against NERC PRC-024-3 mandatory no-trip boundaries.
 */
export function auditNercPrc024(
  freqSettings: FrequencyTripSetting[],
  voltSettings: VoltageTripSetting[],
): Prc024AuditResult {
  const violations: Prc024AuditResult["violations"] = [];

  // NERC PRC-024-3 Attachment 1: Generator Frequency Ride-Through Standard Curve (60 Hz system)
  // Underfrequency:
  // 59.5 - 60.0 Hz: Continuous operation (no trip permitted)
  // 58.5 - 59.4 Hz: >= 180 seconds no-trip
  // 57.8 - 58.4 Hz: >= 30 seconds no-trip
  // 57.0 - 57.7 Hz: >= 0.75 seconds no-trip
  // Overfrequency:
  // 60.0 - 60.5 Hz: Continuous operation
  // 60.6 - 61.5 Hz: >= 180 seconds no-trip
  // 61.6 - 61.7 Hz: >= 30 seconds no-trip
  for (const fSet of freqSettings) {
    const f = fSet.frequencyHz;
    const t = fSet.tripDelaySec;

    if (fSet.direction === "under_frequency") {
      if (f >= 59.5) {
        violations.push({
          settingType: "frequency",
          value: f,
          tripDelaySec: t,
          mandatedNoTripDurationSec: Infinity,
          reason: `Underfrequency trip at ${f} Hz violates continuous operation band (59.5-60.0 Hz).`,
        });
      } else if (f >= 58.5 && t < 180.0) {
        violations.push({
          settingType: "frequency",
          value: f,
          tripDelaySec: t,
          mandatedNoTripDurationSec: 180.0,
          reason: `Underfrequency trip at ${f} Hz has delay ${t}s < mandated 180s.`,
        });
      } else if (f >= 57.8 && t < 30.0) {
        violations.push({
          settingType: "frequency",
          value: f,
          tripDelaySec: t,
          mandatedNoTripDurationSec: 30.0,
          reason: `Underfrequency trip at ${f} Hz has delay ${t}s < mandated 30s.`,
        });
      } else if (f >= 57.0 && t < 0.75) {
        violations.push({
          settingType: "frequency",
          value: f,
          tripDelaySec: t,
          mandatedNoTripDurationSec: 0.75,
          reason: `Underfrequency trip at ${f} Hz has delay ${t}s < mandated 0.75s.`,
        });
      }
    } else {
      // Overfrequency
      if (f <= 60.5) {
        violations.push({
          settingType: "frequency",
          value: f,
          tripDelaySec: t,
          mandatedNoTripDurationSec: Infinity,
          reason: `Overfrequency trip at ${f} Hz violates continuous operation band (60.0-60.5 Hz).`,
        });
      } else if (f <= 61.5 && t < 180.0) {
        violations.push({
          settingType: "frequency",
          value: f,
          tripDelaySec: t,
          mandatedNoTripDurationSec: 180.0,
          reason: `Overfrequency trip at ${f} Hz has delay ${t}s < mandated 180s.`,
        });
      } else if (f <= 61.7 && t < 30.0) {
        violations.push({
          settingType: "frequency",
          value: f,
          tripDelaySec: t,
          mandatedNoTripDurationSec: 30.0,
          reason: `Overfrequency trip at ${f} Hz has delay ${t}s < mandated 30s.`,
        });
      }
    }
  }

  // NERC PRC-024-3 Attachment 2: Generator Voltage Ride-Through Curve
  // Continuous: 0.90 - 1.10 pu
  // 0.85 - 0.90 pu: >= 3.0s no-trip
  // 0.70 - 0.85 pu: >= 1.0s no-trip
  // 0.45 - 0.70 pu: >= 0.15s no-trip
  for (const vSet of voltSettings) {
    const v = vSet.voltagePu;
    const t = vSet.tripDelaySec;

    if (vSet.direction === "under_voltage") {
      if (v >= 0.90) {
        violations.push({
          settingType: "voltage",
          value: v,
          tripDelaySec: t,
          mandatedNoTripDurationSec: Infinity,
          reason: `Undervoltage trip at ${v} pu violates continuous band (0.90-1.10 pu).`,
        });
      } else if (v >= 0.85 && t < 3.0) {
        violations.push({
          settingType: "voltage",
          value: v,
          tripDelaySec: t,
          mandatedNoTripDurationSec: 3.0,
          reason: `Undervoltage trip at ${v} pu has delay ${t}s < mandated 3.0s.`,
        });
      } else if (v >= 0.70 && t < 1.0) {
        violations.push({
          settingType: "voltage",
          value: v,
          tripDelaySec: t,
          mandatedNoTripDurationSec: 1.0,
          reason: `Undervoltage trip at ${v} pu has delay ${t}s < mandated 1.0s.`,
        });
      }
    } else {
      // Overvoltage
      if (v <= 1.10) {
        violations.push({
          settingType: "voltage",
          value: v,
          tripDelaySec: t,
          mandatedNoTripDurationSec: Infinity,
          reason: `Overvoltage trip at ${v} pu violates continuous band (0.90-1.10 pu).`,
        });
      } else if (v <= 1.15 && t < 0.5) {
        violations.push({
          settingType: "voltage",
          value: v,
          tripDelaySec: t,
          mandatedNoTripDurationSec: 0.5,
          reason: `Overvoltage trip at ${v} pu has delay ${t}s < mandated 0.5s.`,
        });
      }
    }
  }

  const compliant = violations.length === 0;
  const verdict = compliant ? "COMPLIANT" : "NON_COMPLIANT";
  const summary = `NERC PRC-024-3 Audit: Verdict = ${verdict}. Audited ${freqSettings.length + voltSettings.length} settings with ${violations.length} violations.`;

  return {
    compliant,
    totalSettingsAudited: freqSettings.length + voltSettings.length,
    violations,
    verdict,
    summaryText: summary,
  };
}

/**
 * Audits protection maintenance compliance per NERC PRC-005-6.
 */
export function auditNercPrc005(
  assets: ProtectionAssetRecord[],
  asOfDateIso = "2026-11-09",
): Prc005MaintenanceAuditResult[] {
  const asOf = new Date(asOfDateIso).getTime();
  const msPerYear = 365.25 * 24 * 3600 * 1000;

  return assets.map((asset) => {
    const lastMaint = new Date(asset.lastMaintenanceDate).getTime();
    const elapsedYears = (asOf - lastMaint) / msPerYear;
    const overdue = elapsedYears > asset.maxMaintenanceIntervalYears;
    const daysUntil = Math.round(
      (asset.maxMaintenanceIntervalYears * msPerYear - (asOf - lastMaint)) / (24 * 3600 * 1000),
    );

    return {
      assetId: asset.assetId,
      substation: asset.substationName,
      bay: asset.bayName,
      lastMaintenanceDate: asset.lastMaintenanceDate,
      yearsSinceLastMaintenance: Math.round(elapsedYears * 10) / 10,
      allowedIntervalYears: asset.maxMaintenanceIntervalYears,
      maintenanceOverdue: overdue,
      daysUntilOverdue: daysUntil,
    };
  });
}

/**
 * Evaluates short-circuit current deviations per NERC PRC-027-1 (10% threshold rule).
 */
export function auditNercPrc027(
  busNumber: number,
  busName: string,
  baselineFaultCurrentKa: number,
  currentFaultCurrentKa: number,
): Prc027FaultReviewResult {
  const dev =
    Math.abs(currentFaultCurrentKa - baselineFaultCurrentKa) / Math.max(0.1, baselineFaultCurrentKa);
  const devPercent = dev * 100.0;
  const requiresRestudy = devPercent >= 10.0;

  const expl = requiresRestudy
    ? `Fault current changed by ${devPercent.toFixed(1)}% (from ${baselineFaultCurrentKa.toFixed(2)}kA to ${currentFaultCurrentKa.toFixed(2)}kA), exceeding the NERC PRC-027-1 10% threshold. Mandatory protection coordination restudy required.`
    : `Fault current changed by ${devPercent.toFixed(1)}%, within the NERC PRC-027-1 10% tolerance. No restudy required.`;

  return {
    busNumber,
    busName,
    baselineFaultCurrentKa,
    currentFaultCurrentKa,
    deviationPercent: devPercent,
    mandatoryRestudyRequired: requiresRestudy,
    explanation: expl,
  };
}
