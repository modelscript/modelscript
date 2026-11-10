// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Open Relay Model Catalog, Settings Schema & Omicron/DIgSILENT .rio Parser.
 *
 * Implements comprehensive protection relay model schemas for:
 *   - ANSI 50 (Instantaneous Overcurrent)
 *   - ANSI 51 (Time-Overcurrent / IDMT Curves per IEC 60255 & IEEE C37.112)
 *   - ANSI 21 (Distance Protection - Mho & Quadrilateral Multi-Zone)
 *   - ANSI 87 (Differential Protection - Dual-Slope Percentage Restraint & Harmonic Inrush Blocking)
 *
 * Includes pre-populated commercial relay catalog for Siemens SIPROTEC, ABB Relion, and SEL,
 * parser for Omicron/DIgSILENT `.rio` relay setting files, and selectivity margin grading verification.
 *
 * Academic & Industry Standards:
 * - IEEE Std C37.112-2018: Standard Inverse-Time Characteristic Equations for Overcurrent Relays.
 * - IEC 60255-151: Measuring relays and protection equipment - Over/under current protection.
 * - OMICRON RIO (Relay Information Object) Format Specification v3.00+.
 * - Blackburn, J. L., & Domin, T. J. (2014). Protective Relaying: Principles and Applications. CRC Press.
 */

import type { DistanceZoneSetting } from "./distance-protection.js";

export type OvercurrentCurveType =
  | "iec_standard_inverse"
  | "iec_very_inverse"
  | "iec_extremely_inverse"
  | "iec_long_time_inverse"
  | "ieee_moderately_inverse"
  | "ieee_very_inverse"
  | "ieee_extremely_inverse"
  | "us_co8"
  | "definite_time";

export interface TimeOvercurrentSetting {
  functionName: string;
  curveType: OvercurrentCurveType;
  /** Pickup current setting in secondary Amperes (or primary if secondary false). */
  pickupCurrentA: number;
  /** Time Dial Setting (TDS) or time multiplier setting (TMS) in seconds. */
  timeDial: number;
  /** Minimum operating time floor in seconds (default: 0.02s). */
  minTimeSec?: number | undefined;
  /** Directional supervision: 'forward' | 'reverse' | 'non_directional'. */
  directional?: "forward" | "reverse" | "non_directional" | undefined;
}

export interface InstantaneousOvercurrentSetting {
  functionName: string;
  /** Pickup current in secondary Amperes. */
  pickupCurrentA: number;
  /** Definite operating time delay in seconds (default: 0.0s for instant). */
  delaySec: number;
}

export interface DifferentialProtectionSetting {
  functionName: string;
  /** Basic minimum differential pickup current Id0 in per-unit or secondary Amperes. */
  idMinPu: number;
  /** Restraint knee point current Ir_knee in per-unit where slope transitions. */
  irKneePu: number;
  /** Slope 1 percentage restraint (e.g. 0.25 for 25%). */
  slope1: number;
  /** Slope 2 percentage restraint for high fault current / CT saturation (e.g. 0.50 for 50%). */
  slope2: number;
  /** Unrestrained instantaneous differential trip threshold in per-unit (e.g. 8.0 pu). */
  unrestrainedPickupPu: number;
  /** Second harmonic ratio threshold for transformer inrush blocking (default: 0.15 / 15%). */
  secondHarmonicBlockingRatio?: number | undefined;
  /** Fifth harmonic ratio threshold for overexcitation blocking (default: 0.30 / 30%). */
  fifthHarmonicBlockingRatio?: number | undefined;
}

export interface RelaySettingManifest {
  id: string;
  manufacturer: "Siemens" | "ABB" | "SEL" | "Schneider" | "GeneralElectric" | string;
  series: string;
  model: string;
  deviceDescription?: string | undefined;
  ctRatio: {
    primaryA: number;
    secondaryA: number;
  };
  vtRatio?: {
    primaryV: number;
    secondaryV: number;
  } | undefined;
  ansi50?: InstantaneousOvercurrentSetting[] | undefined;
  ansi51?: TimeOvercurrentSetting[] | undefined;
  ansi21?: DistanceZoneSetting[] | undefined;
  ansi87?: DifferentialProtectionSetting | undefined;
}

/**
 * Calculates IDMT operating trip time per IEC 60255 & IEEE C37.112 standards.
 *
 *   t(I) = TDS * ( A / ( (I / I_s)^p - 1 ) + B )
 */
export function calculateIdmtTripTime(
  setting: TimeOvercurrentSetting,
  faultCurrentA: number,
): number {
  const is = setting.pickupCurrentA;
  if (faultCurrentA <= is) {
    return Infinity; // Below pickup
  }

  const M = faultCurrentA / is;
  const tds = setting.timeDial;

  let A = 0.14;
  let p = 0.02;
  let B = 0.0;

  switch (setting.curveType) {
    case "iec_standard_inverse":
      A = 0.14;
      p = 0.02;
      B = 0.0;
      break;
    case "iec_very_inverse":
      A = 13.5;
      p = 1.0;
      B = 0.0;
      break;
    case "iec_extremely_inverse":
      A = 80.0;
      p = 2.0;
      B = 0.0;
      break;
    case "iec_long_time_inverse":
      A = 120.0;
      p = 1.0;
      B = 0.0;
      break;
    case "ieee_moderately_inverse":
      A = 0.0515;
      p = 0.02;
      B = 0.114;
      break;
    case "ieee_very_inverse":
      A = 19.61;
      p = 2.0;
      B = 0.491;
      break;
    case "ieee_extremely_inverse":
      A = 28.2;
      p = 2.0;
      B = 0.1217;
      break;
    case "us_co8":
      A = 5.95;
      p = 2.0;
      B = 0.18;
      break;
    case "definite_time":
      return Math.max(setting.minTimeSec ?? 0.02, tds);
  }

  const denom = Math.pow(M, p) - 1.0;
  if (denom <= 0) return Infinity;

  const t = tds * (A / denom + B);
  return Math.max(setting.minTimeSec ?? 0.02, t);
}

/**
 * Evaluates whether differential current triggers a percentage restraint differential trip (ANSI 87).
 */
export function evaluateDifferentialTrip(
  setting: DifferentialProtectionSetting,
  i1Pu: number,
  i2Pu: number,
  harmonicRatios: { second?: number; fifth?: number } = {},
): {
  tripped: boolean;
  blockedByHarmonic: boolean;
  iDiffPu: number;
  iRestPu: number;
  thresholdPu: number;
} {
  const iDiff = Math.abs(i1Pu - i2Pu);
  const iRest = 0.5 * (Math.abs(i1Pu) + Math.abs(i2Pu));

  // Check unrestrained instantaneous trip threshold
  if (iDiff >= setting.unrestrainedPickupPu) {
    return {
      tripped: true,
      blockedByHarmonic: false,
      iDiffPu: iDiff,
      iRestPu: iRest,
      thresholdPu: setting.unrestrainedPickupPu,
    };
  }

  // Harmonic blocking check
  let blocked = false;
  if (
    setting.secondHarmonicBlockingRatio !== undefined &&
    (harmonicRatios.second ?? 0) >= setting.secondHarmonicBlockingRatio
  ) {
    blocked = true;
  }
  if (
    setting.fifthHarmonicBlockingRatio !== undefined &&
    (harmonicRatios.fifth ?? 0) >= setting.fifthHarmonicBlockingRatio
  ) {
    blocked = true;
  }

  // Dual-slope characteristic threshold
  let threshold = setting.idMinPu;
  if (iRest <= setting.irKneePu) {
    threshold = setting.idMinPu + setting.slope1 * iRest;
  } else {
    threshold =
      setting.idMinPu +
      setting.slope1 * setting.irKneePu +
      setting.slope2 * (iRest - setting.irKneePu);
  }

  const tripped = !blocked && iDiff >= threshold;

  return {
    tripped,
    blockedByHarmonic: blocked,
    iDiffPu: iDiff,
    iRestPu: iRest,
    thresholdPu: threshold,
  };
}

/**
 * Pre-populated Open Relay Model Catalog with standard commercial relays.
 */
export const OPEN_RELAY_CATALOG: Record<string, RelaySettingManifest> = {
  siemens_siprotec_7sa87: {
    id: "siemens_siprotec_7sa87",
    manufacturer: "Siemens",
    series: "SIPROTEC 5",
    model: "7SA87",
    deviceDescription: "Distance and Line Differential Protection for High Voltage Lines",
    ctRatio: { primaryA: 1200, secondaryA: 1 },
    vtRatio: { primaryV: 110000, secondaryV: 100 },
    ansi21: [
      {
        zoneNumber: 1,
        characteristic: "quadrilateral",
        reachOhm: 3.5,
        lineAngleDeg: 80.0,
        resistanceReachOhm: 8.0,
        delaySec: 0.0,
        directional: "forward",
      },
      {
        zoneNumber: 2,
        characteristic: "quadrilateral",
        reachOhm: 6.0,
        lineAngleDeg: 80.0,
        resistanceReachOhm: 12.0,
        delaySec: 0.35,
        directional: "forward",
      },
      {
        zoneNumber: 3,
        characteristic: "quadrilateral",
        reachOhm: 10.0,
        lineAngleDeg: 80.0,
        resistanceReachOhm: 18.0,
        delaySec: 0.80,
        directional: "forward",
      },
    ],
    ansi50: [{ functionName: "50-1", pickupCurrentA: 12.0, delaySec: 0.0 }],
    ansi51: [
      {
        functionName: "51-1",
        curveType: "iec_standard_inverse",
        pickupCurrentA: 1.2,
        timeDial: 0.15,
        minTimeSec: 0.03,
      },
    ],
  },
  abb_relion_rel670: {
    id: "abb_relion_rel670",
    manufacturer: "ABB",
    series: "Relion 670",
    model: "REL670",
    deviceDescription: "Line Distance Protection IED for Transmission and Subtransmission",
    ctRatio: { primaryA: 1000, secondaryA: 5 },
    vtRatio: { primaryV: 220000, secondaryV: 110 },
    ansi21: [
      {
        zoneNumber: 1,
        characteristic: "mho",
        reachOhm: 8.0,
        lineAngleDeg: 75.0,
        delaySec: 0.0,
        directional: "forward",
      },
      {
        zoneNumber: 2,
        characteristic: "mho",
        reachOhm: 14.0,
        lineAngleDeg: 75.0,
        delaySec: 0.30,
        directional: "forward",
      },
      {
        zoneNumber: 3,
        characteristic: "mho",
        reachOhm: 22.0,
        lineAngleDeg: 75.0,
        delaySec: 0.70,
        directional: "forward",
      },
    ],
    ansi51: [
      {
        functionName: "51P",
        curveType: "ieee_very_inverse",
        pickupCurrentA: 6.0,
        timeDial: 1.0,
        minTimeSec: 0.02,
      },
    ],
  },
  sel_421: {
    id: "sel_421",
    manufacturer: "SEL",
    series: "SEL-400",
    model: "SEL-421",
    deviceDescription: "High-Speed Line Protection, Automation and Control System",
    ctRatio: { primaryA: 2000, secondaryA: 5 },
    vtRatio: { primaryV: 400000, secondaryV: 115 },
    ansi21: [
      {
        zoneNumber: 1,
        characteristic: "mho",
        reachOhm: 4.5,
        lineAngleDeg: 82.0,
        delaySec: 0.0,
        directional: "forward",
      },
      {
        zoneNumber: 2,
        characteristic: "mho",
        reachOhm: 7.5,
        lineAngleDeg: 82.0,
        delaySec: 0.25,
        directional: "forward",
      },
      {
        zoneNumber: 3,
        characteristic: "mho",
        reachOhm: 12.0,
        lineAngleDeg: 82.0,
        delaySec: 0.60,
        directional: "forward",
      },
    ],
  },
  sel_751: {
    id: "sel_751",
    manufacturer: "SEL",
    series: "SEL-700",
    model: "SEL-751",
    deviceDescription: "Feeder Protection Relay with Comprehensive Overcurrent",
    ctRatio: { primaryA: 600, secondaryA: 5 },
    ansi50: [{ functionName: "50P1", pickupCurrentA: 25.0, delaySec: 0.0 }],
    ansi51: [
      {
        functionName: "51P1",
        curveType: "us_co8",
        pickupCurrentA: 5.0,
        timeDial: 2.0,
        minTimeSec: 0.02,
      },
    ],
  },
  siemens_siprotec_7ut86: {
    id: "siemens_siprotec_7ut86",
    manufacturer: "Siemens",
    series: "SIPROTEC 5",
    model: "7UT86",
    deviceDescription: "Transformer Differential Protection Relay",
    ctRatio: { primaryA: 800, secondaryA: 1 },
    ansi87: {
      functionName: "87T",
      idMinPu: 0.20,
      irKneePu: 1.5,
      slope1: 0.25,
      slope2: 0.50,
      unrestrainedPickupPu: 8.0,
      secondHarmonicBlockingRatio: 0.15,
      fifthHarmonicBlockingRatio: 0.30,
    },
  },
};

/**
 * Parses an Omicron / DIgSILENT Relay Information Object (.rio) file into a RelaySettingManifest.
 */
export function parseRioFile(content: string): RelaySettingManifest {
  const lines = content.split(/\r?\n/);

  let manufacturer = "Generic";
  let series = "Generic";
  let model = "Generic";
  let id = "relay_import";
  let ctPrimary = 1000;
  let ctSecondary = 1;
  let vtPrimary = 110000;
  let vtSecondary = 100;

  const distanceZones: DistanceZoneSetting[] = [];
  const overcurrent51: TimeOvercurrentSetting[] = [];
  const overcurrent50: InstantaneousOvercurrentSetting[] = [];
  let diff87: DifferentialProtectionSetting | undefined;

  let currentBlock = "";
  let zoneNumberCounter: 1 | 2 | 3 = 1;
  let currentZoneReach = 5.0;
  let currentZoneAngle = 75.0;
  let currentZoneRReach = 10.0;
  let currentZoneDelay = 0.0;
  let currentZoneShape: "mho" | "quadrilateral" = "quadrilateral";
  let currentZoneDirection: "forward" | "reverse" | "non_directional" = "forward";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;

    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN ")) {
      currentBlock = upper.substring(6).trim();
      continue;
    }
    if (upper.startsWith("END ")) {
      if (currentBlock.startsWith("ZONE")) {
        distanceZones.push({
          zoneNumber: zoneNumberCounter,
          characteristic: currentZoneShape,
          reachOhm: currentZoneReach,
          lineAngleDeg: currentZoneAngle,
          resistanceReachOhm: currentZoneRReach,
          delaySec: currentZoneDelay,
          directional: currentZoneDirection,
        });
        if (zoneNumberCounter < 3) {
          zoneNumberCounter = (zoneNumberCounter + 1) as 1 | 2 | 3;
        }
      }
      currentBlock = "";
      continue;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx < 0) continue;
    const key = line.substring(0, eqIdx).trim().toUpperCase();
    const val = line.substring(eqIdx + 1).trim();

    if (currentBlock === "DEVICE" || currentBlock === "HEADER" || !currentBlock) {
      if (key === "MANUFACTURER") manufacturer = val;
      if (key === "SERIES" || key === "FAMILY") series = val;
      if (key === "DEVICE" || key === "TYPE" || key === "MODEL") {
        model = val;
        id = val.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      }
      if (key === "IPRIM" || key === "CT_PRIM") ctPrimary = parseFloat(val) || ctPrimary;
      if (key === "ISEC" || key === "CT_SEC") ctSecondary = parseFloat(val) || ctSecondary;
      if (key === "VPRIM" || key === "VT_PRIM") vtPrimary = parseFloat(val) || vtPrimary;
      if (key === "VSEC" || key === "VT_SEC") vtSecondary = parseFloat(val) || vtSecondary;
    } else if (currentBlock.startsWith("ZONE") || currentBlock === "DISTANCE") {
      if (key === "Z" || key === "REACH" || key === "X") currentZoneReach = parseFloat(val) || currentZoneReach;
      if (key === "R" || key === "R_REACH") currentZoneRReach = parseFloat(val) || currentZoneRReach;
      if (key === "PHI" || key === "ANGLE" || key === "LINE_ANGLE") currentZoneAngle = parseFloat(val) || currentZoneAngle;
      if (key === "T" || key === "TIME" || key === "DELAY") currentZoneDelay = parseFloat(val) || 0.0;
      if (key === "SHAPE" || key === "CHARACTERISTIC") {
        currentZoneShape = val.toUpperCase().includes("MHO") ? "mho" : "quadrilateral";
      }
      if (key === "DIR" || key === "DIRECTION") {
        currentZoneDirection = val.toUpperCase().includes("REV") ? "reverse" : "forward";
      }
    } else if (currentBlock === "OVERCURRENT") {
      if (key === "I_PICKUP" || key === "IS") {
        const pickup = parseFloat(val) || 1.0;
        overcurrent51.push({
          functionName: "51",
          curveType: "iec_standard_inverse",
          pickupCurrentA: pickup,
          timeDial: 0.1,
          minTimeSec: 0.02,
        });
      }
      if (key === "I_INST" || key === "I_HIGH") {
        const inst = parseFloat(val) || 10.0;
        overcurrent50.push({
          functionName: "50",
          pickupCurrentA: inst,
          delaySec: 0.0,
        });
      }
    } else if (currentBlock === "DIFFERENTIAL") {
      if (!diff87) {
        diff87 = {
          functionName: "87",
          idMinPu: 0.2,
          irKneePu: 1.5,
          slope1: 0.25,
          slope2: 0.5,
          unrestrainedPickupPu: 8.0,
          secondHarmonicBlockingRatio: 0.15,
        };
      }
      if (key === "IDMIN" || key === "ID0") diff87.idMinPu = parseFloat(val) || 0.2;
      if (key === "SLOPE1") diff87.slope1 = parseFloat(val) || 0.25;
      if (key === "SLOPE2") diff87.slope2 = parseFloat(val) || 0.5;
      if (key === "IRKNEE") diff87.irKneePu = parseFloat(val) || 1.5;
    }
  }

  return {
    id,
    manufacturer,
    series,
    model,
    ctRatio: { primaryA: ctPrimary, secondaryA: ctSecondary },
    vtRatio: { primaryV: vtPrimary, secondaryV: vtSecondary },
    ansi21: distanceZones.length > 0 ? distanceZones : undefined,
    ansi50: overcurrent50.length > 0 ? overcurrent50 : undefined,
    ansi51: overcurrent51.length > 0 ? overcurrent51 : undefined,
    ansi87: diff87,
  };
}

export interface SelectivityEvaluationResult {
  selective: boolean;
  coordinationTimeMarginSec: number;
  requiredCtiSec: number;
  primaryTripTimeSec: number;
  backupTripTimeSec: number;
  violationDescription?: string | undefined;
}

/**
 * Verifies selectivity and Coordination Time Interval (CTI) between primary and backup protection.
 *
 * Typically CTI = t_backup - t_primary >= 0.25 - 0.35 seconds to ensure downstream breaker clears
 * the fault before upstream backup initiates tripping.
 */
export function verifyProtectionSelectivity(
  primaryRelay: RelaySettingManifest,
  backupRelay: RelaySettingManifest,
  faultCurrentPrimaryA: number,
  requiredCtiSec = 0.30,
): SelectivityEvaluationResult {
  // Convert primary current to secondary Amperes for each relay
  const iSecPrimary =
    (faultCurrentPrimaryA * primaryRelay.ctRatio.secondaryA) / primaryRelay.ctRatio.primaryA;
  const iSecBackup =
    (faultCurrentPrimaryA * backupRelay.ctRatio.secondaryA) / backupRelay.ctRatio.primaryA;

  let tPrimary = Infinity;
  let tBackup = Infinity;

  // Evaluate primary trip time (check 50 first, then 51)
  if (primaryRelay.ansi50) {
    for (const s50 of primaryRelay.ansi50) {
      if (iSecPrimary >= s50.pickupCurrentA) {
        tPrimary = Math.min(tPrimary, s50.delaySec);
      }
    }
  }
  if (primaryRelay.ansi51 && tPrimary > 0.05) {
    for (const s51 of primaryRelay.ansi51) {
      const t = calculateIdmtTripTime(s51, iSecPrimary);
      tPrimary = Math.min(tPrimary, t);
    }
  }

  // Evaluate backup trip time
  if (backupRelay.ansi50) {
    for (const s50 of backupRelay.ansi50) {
      if (iSecBackup >= s50.pickupCurrentA) {
        tBackup = Math.min(tBackup, s50.delaySec);
      }
    }
  }
  if (backupRelay.ansi51) {
    for (const s51 of backupRelay.ansi51) {
      const t = calculateIdmtTripTime(s51, iSecBackup);
      tBackup = Math.min(tBackup, t);
    }
  }

  const margin = tBackup - tPrimary;
  const selective = margin >= requiredCtiSec;

  let violation: string | undefined;
  if (!selective) {
    violation = `Selectivity margin ${margin.toFixed(3)}s is less than required CTI ${requiredCtiSec.toFixed(3)}s (Primary ${tPrimary.toFixed(3)}s vs Backup ${tBackup.toFixed(3)}s).`;
  }

  return {
    selective,
    coordinationTimeMarginSec: margin,
    requiredCtiSec,
    primaryTripTimeSec: tPrimary,
    backupTripTimeSec: tBackup,
    violationDescription: violation,
  };
}
