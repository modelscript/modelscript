// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FCC OET Bulletin 65 & ICNIRP Electromagnetic Field (EMF)
 * Maximum Permissible Exposure (MPE) Solver for RF Safety.
 *
 * Implements:
 * - FCC 47 CFR § 1.1310 / OET Bulletin 65 (Edition 97-01)
 * - ICNIRP 2020 Guidelines & IEEE C95.1-2019
 * - Multi-emitter collocated Total Exposure Ratio (TER) summation
 * - Near-field cylindrical aperture transitions and far-field power density
 * - Spatial exclusion boundary distance calculations
 */

import type { AntennaPatternDeck } from "../types.js";
import { interpolateAntennaGain } from "../solvers/pattern-interpolator.js";

export type ExposureEnvironment = "general-population" | "occupational";

export type MpeStandard =
  | "FCC_OET65"
  | "ICNIRP_2020"
  | "HEALTH_CANADA_SC6"
  | "EU_CENELEC_EN50383"
  | "SWISS_ORNI_NISV"
  | "ITALY_CEI_211";

export interface RfEmitterConfig {
  id: string;
  name?: string | undefined;
  coordinates: [number, number, number]; // [x, y, z] in meters relative to site datum
  azimuthDeg: number;
  mechanicalTiltDeg: number;
  electricalDowntiltDeg: number;
  frequencyMhz: number;
  inputPowerWatts: number;
  cableLossDb: number;
  antennaPattern?: AntennaPatternDeck | undefined;
  peakGainDbi?: number | undefined;
  apertureAreaM2?: number | undefined;
}

export interface MpeThresholds {
  standard: MpeStandard;
  frequencyMhz: number;
  generalPopulationMilliwattsPerCm2: number;
  occupationalMilliwattsPerCm2: number;
  referenceStandardDoc: string;
}

export interface PointExposureResult {
  point: [number, number, number];
  totalPowerDensityWattsPerM2: number;
  totalPowerDensityMilliwattsPerCm2: number;
  terGeneralPopulation: number; // Total Exposure Ratio (<= 1.0 is compliant)
  terOccupational: number;
  isGeneralPopulationCompliant: boolean;
  isOccupationalCompliant: boolean;
  emitterContributions: Array<{
    emitterId: string;
    powerDensityMilliwattsPerCm2: number;
    fractionalTerGeneralPop: number;
    fractionalTerOccupational: number;
  }>;
}

export interface MpeExclusionBoundary {
  emitterId: string;
  frequencyMhz: number;
  standard: MpeStandard;
  generalPopThresholdMwCm2: number;
  occupationalThresholdMwCm2: number;
  mainBeamExclusionDistanceGeneralPopMeters: number;
  mainBeamExclusionDistanceOccupationalMeters: number;
  rearExclusionDistanceGeneralPopMeters: number;
  rearExclusionDistanceOccupationalMeters: number;
}

export interface SiteMpeReport {
  emitters: RfEmitterConfig[];
  standard: MpeStandard;
  groundReflectionFactor: number;
  boundaries: MpeExclusionBoundary[];
  evaluationPoints: PointExposureResult[];
  maxTerGeneralPopulation: number;
  maxTerOccupational: number;
  isSiteCompliantWithoutMitigation: boolean;
  requiredSignageNotice: "None" | "Notice (Blue)" | "Caution (Yellow)" | "Warning (Orange)" | "Danger (Red)";
}

/**
 * Computes Maximum Permissible Exposure (MPE) power density limits (mW/cm^2)
 * according to the selected national or international regulatory standard.
 */
export function getMpeLimits(frequencyMhz: number, standard: MpeStandard = "FCC_OET65"): MpeThresholds {
  const f = Math.max(0.1, frequencyMhz);

  switch (standard) {
    case "HEALTH_CANADA_SC6": {
      // Health Canada Safety Code 6 (2015/2021) limits
      // Power density in W/m^2; convert to mW/cm^2 by dividing by 10 (1 mW/cm^2 = 10 W/m^2)
      let genPopMwCm2: number;
      let occMwCm2: number;

      if (f < 20.0) {
        genPopMwCm2 = 0.2; // 2.0 W/m^2
        occMwCm2 = 1.0; // 10.0 W/m^2
      } else if (f < 48.0) {
        genPopMwCm2 = (4.416 * Math.pow(f, -0.5)) / 10.0;
        occMwCm2 = (22.08 * Math.pow(f, -0.5)) / 10.0;
      } else if (f < 100.0) {
        genPopMwCm2 = 0.1291; // 1.291 W/m^2
        occMwCm2 = 0.6455; // 6.455 W/m^2
      } else if (f < 6000.0) {
        // Typical cellular frequencies (100 MHz - 6 GHz)
        genPopMwCm2 = (0.02619 * Math.pow(f, 0.6834)) / 10.0;
        occMwCm2 = (0.1631 * Math.pow(f, 0.6834)) / 10.0;
      } else {
        // >= 6 GHz up to mmWave
        genPopMwCm2 = 1.0; // 10.0 W/m^2
        occMwCm2 = 5.0; // 50.0 W/m^2
      }

      return {
        standard,
        frequencyMhz: f,
        generalPopulationMilliwattsPerCm2: genPopMwCm2,
        occupationalMilliwattsPerCm2: occMwCm2,
        referenceStandardDoc: "Health Canada Safety Code 6 (2015/2021) / ISED RSS-102",
      };
    }

    case "ICNIRP_2020":
    case "EU_CENELEC_EN50383": {
      // ICNIRP 2020 / EU Council Recommendation 1999/519/EC & CENELEC EN 50383
      let genPopMwCm2: number;
      let occMwCm2: number;

      if (f < 400.0) {
        genPopMwCm2 = 0.2; // 2 W/m^2
        occMwCm2 = 1.0; // 10 W/m^2
      } else if (f < 2000.0) {
        genPopMwCm2 = f / 2000.0; // f/200 W/m^2 -> f/2000 mW/cm^2
        occMwCm2 = f / 400.0; // f/40 W/m^2 -> f/400 mW/cm^2
      } else {
        genPopMwCm2 = 1.0; // 10 W/m^2
        occMwCm2 = 5.0; // 50 W/m^2
      }

      return {
        standard,
        frequencyMhz: f,
        generalPopulationMilliwattsPerCm2: genPopMwCm2,
        occupationalMilliwattsPerCm2: occMwCm2,
        referenceStandardDoc: standard === "ICNIRP_2020" ? "ICNIRP 2020 Guidelines" : "EU Rec 1999/519/EC & CENELEC EN 50383",
      };
    }

    case "SWISS_ORNI_NISV": {
      // Swiss NISV Installation Limit Value (Anlagegrenzwert) at Places of Sensitive Use (OMEN)
      // Cellular limits: 4.0 V/m (<900MHz), 5.0 V/m (1800MHz), 6.0 V/m (>=2100MHz)
      let genPopMwCm2: number;
      if (f < 1000.0) {
        genPopMwCm2 = 0.00424; // 4.0 V/m => 0.0424 W/m^2
      } else if (f < 2000.0) {
        genPopMwCm2 = 0.00663; // 5.0 V/m => 0.0663 W/m^2
      } else {
        genPopMwCm2 = 0.00955; // 6.0 V/m => 0.0955 W/m^2
      }
      // Occupational follows ICNIRP standard
      const occMwCm2 = f < 400 ? 1.0 : f < 2000 ? f / 400.0 : 5.0;

      return {
        standard,
        frequencyMhz: f,
        generalPopulationMilliwattsPerCm2: genPopMwCm2,
        occupationalMilliwattsPerCm2: occMwCm2,
        referenceStandardDoc: "Swiss ORNI/NISV (SR 814.710) Sensitive Use Limit",
      };
    }

    case "ITALY_CEI_211": {
      // Italian DPCM 08/07/2003 & Law 36/2001 precautionary quality objective (6 V/m = 0.1 W/m^2 = 0.01 mW/cm^2)
      const genPopMwCm2 = 0.010;
      const occMwCm2 = f < 400 ? 1.0 : f < 2000 ? f / 400.0 : 5.0;

      return {
        standard,
        frequencyMhz: f,
        generalPopulationMilliwattsPerCm2: genPopMwCm2,
        occupationalMilliwattsPerCm2: occMwCm2,
        referenceStandardDoc: "Italian DPCM 08/07/2003 & Law 36/2001 (6 V/m Objective)",
      };
    }

    case "FCC_OET65":
    default: {
      // FCC OET Bulletin 65 (Edition 97-01) / 47 CFR § 1.1310
      let genPop: number;
      if (f < 1.34) {
        genPop = 100.0;
      } else if (f < 30.0) {
        genPop = 180.0 / (f * f);
      } else if (f < 300.0) {
        genPop = 0.2;
      } else if (f < 1500.0) {
        genPop = f / 1500.0;
      } else {
        genPop = 1.0;
      }

      let occ: number;
      if (f < 3.0) {
        occ = 100.0;
      } else if (f < 30.0) {
        occ = 900.0 / (f * f);
      } else if (f < 300.0) {
        occ = 1.0;
      } else if (f < 1500.0) {
        occ = f / 300.0;
      } else {
        occ = 5.0;
      }

      return {
        standard: "FCC_OET65",
        frequencyMhz: f,
        generalPopulationMilliwattsPerCm2: genPop,
        occupationalMilliwattsPerCm2: occ,
        referenceStandardDoc: "FCC OET Bulletin 65 / 47 CFR § 1.1310",
      };
    }
  }
}

/**
 * Computes FCC OET Bulletin 65 Maximum Permissible Exposure (MPE) power density limits (mW/cm^2).
 * Retained for backwards-compatibility.
 */
export function getFccMpeLimits(frequencyMhz: number): MpeThresholds {
  return getMpeLimits(frequencyMhz, "FCC_OET65");
}

/**
 * Evaluates spatial RF power density at a specific point [x, y, z] from a single emitter.
 */
export function computeEmitterPowerDensity(
  emitter: RfEmitterConfig,
  targetPoint: [number, number, number],
  groundReflectionFactor = 2.56, // OET-65 100% field reflection default (1.6^2 = 2.56)
): number {
  const dx = targetPoint[0] - emitter.coordinates[0];
  const dy = targetPoint[1] - emitter.coordinates[1];
  const dz = targetPoint[2] - emitter.coordinates[2];
  const distanceMeters = Math.max(0.1, Math.sqrt(dx * dx + dy * dy + dz * dz));

  const netPowerWatts = emitter.inputPowerWatts * Math.pow(10, -Math.max(0, emitter.cableLossDb) / 10);

  // Near-field aperture ceiling
  let maxSurfacePowerDensityWm2 = Number.POSITIVE_INFINITY;
  if (emitter.apertureAreaM2 && emitter.apertureAreaM2 > 0) {
    maxSurfacePowerDensityWm2 = (4.0 * netPowerWatts) / emitter.apertureAreaM2;
  }

  // Determine antenna gain in target direction
  let gainLinear = 1.0;
  if (emitter.antennaPattern) {
    // Calculate spherical angles relative to antenna boresight
    const horizDist = Math.sqrt(dx * dx + dy * dy);
    let azimuthToTarget = (Math.atan2(dx, dy) * 180) / Math.PI; // 0 deg = North (+Y)
    if (azimuthToTarget < 0) azimuthToTarget += 360;

    let relativeAzimuth = azimuthToTarget - emitter.azimuthDeg;
    while (relativeAzimuth < 0) relativeAzimuth += 360;
    while (relativeAzimuth >= 360) relativeAzimuth -= 360;

    const totalTilt = emitter.mechanicalTiltDeg + emitter.electricalDowntiltDeg;
    const elevationAngle = (Math.atan2(dz, horizDist) * 180) / Math.PI;
    const relativeElevation = elevationAngle - (-totalTilt); // Negative tilt points downward

    const gainDbi = interpolateAntennaGain(
      emitter.antennaPattern,
      relativeAzimuth,
      relativeElevation,
      totalTilt,
    );
    gainLinear = Math.pow(10, gainDbi / 10);
  } else if (emitter.peakGainDbi !== undefined) {
    gainLinear = Math.pow(10, emitter.peakGainDbi / 10);
  }

  // Free-space or ground-reflected far-field power density (W/m^2)
  const farFieldWm2 = (netPowerWatts * gainLinear * groundReflectionFactor) / (4.0 * Math.PI * distanceMeters * distanceMeters);

  // Apply near-field saturation transition
  const effectiveWm2 = Math.min(farFieldWm2, maxSurfacePowerDensityWm2);
  return effectiveWm2;
}

/**
 * Solves the main-beam and rear exclusion boundary distances for a single emitter.
 */
export function computeEmitterExclusionBoundary(
  emitter: RfEmitterConfig,
  groundReflectionFactor = 2.56,
  standard: MpeStandard = "FCC_OET65",
): MpeExclusionBoundary {
  const limits = getMpeLimits(emitter.frequencyMhz, standard);
  const netPowerWatts = emitter.inputPowerWatts * Math.pow(10, -Math.max(0, emitter.cableLossDb) / 10);

  const peakGainDbi = emitter.antennaPattern?.peakGainDbi ?? emitter.peakGainDbi ?? 0.0;
  const peakGainLinear = Math.pow(10, peakGainDbi / 10);

  // Convert mW/cm^2 to W/m^2: 1 mW/cm^2 = 10 W/m^2
  const genPopLimitWm2 = limits.generalPopulationMilliwattsPerCm2 * 10.0;
  const occLimitWm2 = limits.occupationalMilliwattsPerCm2 * 10.0;

  // Main beam exclusion distance (meters)
  const mainDistGenPop = Math.sqrt((netPowerWatts * peakGainLinear * groundReflectionFactor) / (4.0 * Math.PI * genPopLimitWm2));
  const mainDistOcc = Math.sqrt((netPowerWatts * peakGainLinear * groundReflectionFactor) / (4.0 * Math.PI * occLimitWm2));

  // Rear exclusion distance (assume front-to-back ratio of 25 dB if not specified)
  const fbrDb = emitter.antennaPattern?.frontToBackRatioDb ?? 25.0;
  const rearGainLinear = peakGainLinear * Math.pow(10, -fbrDb / 10);

  const rearDistGenPop = Math.sqrt((netPowerWatts * rearGainLinear * groundReflectionFactor) / (4.0 * Math.PI * genPopLimitWm2));
  const rearDistOcc = Math.sqrt((netPowerWatts * rearGainLinear * groundReflectionFactor) / (4.0 * Math.PI * occLimitWm2));

  return {
    emitterId: emitter.id,
    frequencyMhz: emitter.frequencyMhz,
    standard,
    generalPopThresholdMwCm2: limits.generalPopulationMilliwattsPerCm2,
    occupationalThresholdMwCm2: limits.occupationalMilliwattsPerCm2,
    mainBeamExclusionDistanceGeneralPopMeters: Math.round(mainDistGenPop * 100) / 100,
    mainBeamExclusionDistanceOccupationalMeters: Math.round(mainDistOcc * 100) / 100,
    rearExclusionDistanceGeneralPopMeters: Math.round(rearDistGenPop * 100) / 100,
    rearExclusionDistanceOccupationalMeters: Math.round(rearDistOcc * 100) / 100,
  };
}

/**
 * Solves multi-emitter collocated RF exposure across a set of 3D query points.
 */
export function evaluateSiteMpe(
  emitters: RfEmitterConfig[],
  queryPoints: Array<[number, number, number]>,
  options?: { groundReflectionFactor?: number | undefined; standard?: MpeStandard | undefined },
): SiteMpeReport {
  const standard = options?.standard ?? "FCC_OET65";
  const groundFactor = options?.groundReflectionFactor ?? 2.56;
  const boundaries = emitters.map((e) => computeEmitterExclusionBoundary(e, groundFactor, standard));

  const evaluationPoints: PointExposureResult[] = [];
  let maxTerGenPop = 0.0;
  let maxTerOcc = 0.0;

  for (const pt of queryPoints) {
    let sumWm2 = 0.0;
    let terGenPop = 0.0;
    let terOcc = 0.0;
    const contributions: PointExposureResult["emitterContributions"] = [];

    for (const emitter of emitters) {
      const limits = getMpeLimits(emitter.frequencyMhz, standard);
      const pdWm2 = computeEmitterPowerDensity(emitter, pt, groundFactor);
      const pdMwCm2 = pdWm2 / 10.0;

      const fracGenPop = pdMwCm2 / limits.generalPopulationMilliwattsPerCm2;
      const fracOcc = pdMwCm2 / limits.occupationalMilliwattsPerCm2;

      sumWm2 += pdWm2;
      terGenPop += fracGenPop;
      terOcc += fracOcc;

      contributions.push({
        emitterId: emitter.id,
        powerDensityMilliwattsPerCm2: Math.round(pdMwCm2 * 10000) / 10000,
        fractionalTerGeneralPop: Math.round(fracGenPop * 10000) / 10000,
        fractionalTerOccupational: Math.round(fracOcc * 10000) / 10000,
      });
    }

    if (terGenPop > maxTerGenPop) maxTerGenPop = terGenPop;
    if (terOcc > maxTerOcc) maxTerOcc = terOcc;

    evaluationPoints.push({
      point: pt,
      totalPowerDensityWattsPerM2: Math.round(sumWm2 * 1000) / 1000,
      totalPowerDensityMilliwattsPerCm2: Math.round((sumWm2 / 10.0) * 10000) / 10000,
      terGeneralPopulation: Math.round(terGenPop * 1000) / 1000,
      terOccupational: Math.round(terOcc * 1000) / 1000,
      isGeneralPopulationCompliant: terGenPop <= 1.0,
      isOccupationalCompliant: terOcc <= 1.0,
      emitterContributions: contributions,
    });
  }

  // Determine required OSHA / FCC / ICNIRP signage
  let requiredSignageNotice: SiteMpeReport["requiredSignageNotice"] = "None";
  if (maxTerGenPop > 5.0) {
    requiredSignageNotice = "Danger (Red)";
  } else if (maxTerGenPop > 1.0 && maxTerOcc > 1.0) {
    requiredSignageNotice = "Warning (Orange)";
  } else if (maxTerGenPop > 1.0) {
    requiredSignageNotice = "Caution (Yellow)";
  } else if (maxTerGenPop > 0.2) {
    requiredSignageNotice = "Notice (Blue)";
  }

  return {
    emitters,
    standard,
    groundReflectionFactor: groundFactor,
    boundaries,
    evaluationPoints,
    maxTerGeneralPopulation: Math.round(maxTerGenPop * 1000) / 1000,
    maxTerOccupational: Math.round(maxTerOcc * 1000) / 1000,
    isSiteCompliantWithoutMitigation: maxTerGenPop <= 1.0,
    requiredSignageNotice,
  };
}
