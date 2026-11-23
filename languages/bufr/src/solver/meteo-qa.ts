// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BufrMessage, BufrSoundingLevel, BufrStationSummary, BufrSubset } from "../types.js";

/** Standard gravity (m/s^2) */
export const G0 = 9.80665;
/** Specific gas constant for dry air (J/(kg*K)) */
export const R_DRY = 287.05;
/** Specific heat capacity of dry air at constant pressure (J/(kg*K)) */
export const CP_DRY = 1004.67;
/** Poisson constant kappa = R_d / c_p */
export const KAPPA = R_DRY / CP_DRY;
/** Ratio of molecular weights of water vapor to dry air */
export const EPSILON = 0.62198;
/** ISA sea-level pressure (Pa) */
export const ISA_P0 = 101325.0;
/** ISA sea-level temperature (K) */
export const ISA_T0 = 288.15;
/** ISA tropospheric lapse rate (K/m) */
export const ISA_LAPSE = 0.0065;
/** ISA tropopause pressure at 11,000 m (Pa), consistent with G0, R_DRY, ISA_LAPSE */
export const ISA_P_TROP = ISA_P0 * Math.pow(1 - (ISA_LAPSE * 11000) / ISA_T0, G0 / (R_DRY * ISA_LAPSE));
/** ISA tropopause temperature (K) */
export const ISA_T_TROP = 216.65;

/**
 * Magnus-Tetens saturation vapor pressure over liquid water (Pa).
 * Uses Alduchov & Eskridge (1996) coefficients: A = 17.625, B = 243.04 C, e0 = 610.94 Pa.
 */
export function magnusSaturationVaporPressure(tempK: number): number {
  const tc = tempK - 273.15;
  return 610.94 * Math.exp((17.625 * tc) / (tc + 243.04));
}

/**
 * Computes dewpoint temperature (K) from dry-bulb temperature (K) and relative humidity (%).
 */
export function magnusDewpoint(tempK: number, rhPct: number): number {
  const tc = tempK - 273.15;
  const rh = Math.max(0.01, Math.min(100, rhPct));
  const gamma = Math.log(rh / 100) + (17.625 * tc) / (243.04 + tc);
  const tdc = (243.04 * gamma) / (17.625 - gamma);
  return tdc + 273.15;
}

/**
 * Computes relative humidity (%) from dry-bulb temperature (K) and dewpoint temperature (K).
 */
export function magnusRelativeHumidity(tempK: number, dewpointK: number): number {
  const es = magnusSaturationVaporPressure(tempK);
  const e = magnusSaturationVaporPressure(dewpointK);
  if (es <= 0) return 0;
  return Math.max(0, Math.min(100, (100 * e) / es));
}

/**
 * Computes water-vapor mixing ratio w (kg/kg) from pressure (Pa) and dewpoint (K).
 */
export function waterVaporMixingRatio(pressurePa: number, dewpointK: number): number {
  const e = magnusSaturationVaporPressure(dewpointK);
  const denom = Math.max(1, pressurePa - e);
  return (EPSILON * e) / denom;
}

/**
 * Computes virtual temperature Tv (K) from dry-bulb temperature (K) and mixing ratio (kg/kg).
 */
export function virtualTemperature(tempK: number, mixingRatioKgKg: number): number {
  return tempK * (1 + 0.608 * mixingRatioKgKg);
}

/**
 * Computes potential temperature theta (K) referenced to 1000 hPa (100000 Pa).
 */
export function potentialTemperature(tempK: number, pressurePa: number, pRefPa = 100000): number {
  if (pressurePa <= 0) return tempK;
  return tempK * Math.pow(pRefPa / pressurePa, KAPPA);
}

/**
 * International Standard Atmosphere (ISA) pressure (Pa) at geometric altitude z (m).
 */
export function isaPressureAtAltitude(altitudeM: number): number {
  if (altitudeM <= 11000) {
    const exp = G0 / (R_DRY * ISA_LAPSE);
    return ISA_P0 * Math.pow(1 - (ISA_LAPSE * altitudeM) / ISA_T0, exp);
  }
  return ISA_P_TROP * Math.exp((-G0 * (altitudeM - 11000)) / (R_DRY * ISA_T_TROP));
}

/**
 * International Standard Atmosphere (ISA) altitude (m) from atmospheric pressure (Pa).
 */
export function isaAltitudeFromPressure(pressurePa: number): number {
  if (pressurePa <= 0) return 0;
  if (pressurePa >= ISA_P_TROP) {
    const exp = (R_DRY * ISA_LAPSE) / G0;
    return (ISA_T0 / ISA_LAPSE) * (1 - Math.pow(pressurePa / ISA_P0, exp));
  }
  return 11000 - ((R_DRY * ISA_T_TROP) / G0) * Math.log(pressurePa / ISA_P_TROP);
}

/**
 * Hypsometric thickness delta-z (m) between pressure levels P1 > P2 with layer mean virtual temperature TvBar (K).
 */
export function hypsometricThickness(p1Pa: number, p2Pa: number, meanTvK: number): number {
  if (p1Pa <= 0 || p2Pa <= 0) return 0;
  return ((R_DRY * meanTvK) / G0) * Math.log(p1Pa / p2Pa);
}

export interface BufrMeteorologySolution {
  stations: BufrStationSummary[];
  soundingLevels: BufrSoundingLevel[];
  qaSummary: {
    levelCount: number;
    maxHypsometricResidualM: number;
    meanRhPct: number;
    dewpointConsistent: boolean;
  };
}

function getNumericVal(subset: BufrSubset, codes: readonly string[]): number | undefined {
  for (const code of codes) {
    const found = subset.values.find((v) => v.descriptor === code && typeof v.value === "number");
    if (found && typeof found.value === "number") return found.value;
  }
  return undefined;
}

/**
 * Extracts sounding levels from a subset (supporting repeated pressure/T/Td/wind levels).
 */
export function extractSoundingLevelsFromSubset(subset: BufrSubset): BufrSoundingLevel[] {
  const levels: Array<{
    pressurePa: number;
    altitudeM?: number | undefined;
    temperatureK: number;
    dewpointK?: number | undefined;
    relativeHumidityPct?: number | undefined;
    windDirectionDeg?: number | undefined;
    windSpeedMs?: number | undefined;
  }> = [];

  let current: {
    pressurePa?: number;
    altitudeM?: number;
    temperatureK?: number;
    dewpointK?: number;
    relativeHumidityPct?: number;
    windDirectionDeg?: number;
    windSpeedMs?: number;
  } = {};

  const flush = (): void => {
    if (current.pressurePa !== undefined && current.temperatureK !== undefined) {
      levels.push({
        pressurePa: current.pressurePa,
        altitudeM: current.altitudeM,
        temperatureK: current.temperatureK,
        dewpointK: current.dewpointK,
        relativeHumidityPct: current.relativeHumidityPct,
        windDirectionDeg: current.windDirectionDeg,
        windSpeedMs: current.windSpeedMs,
      });
    }
    current = {};
  };

  for (const obs of subset.values) {
    if (typeof obs.value !== "number") continue;
    const d = obs.descriptor;
    if (d === "0-07-004" || d === "0-10-004") {
      if (current.pressurePa !== undefined && current.temperatureK !== undefined) {
        flush();
      }
      current.pressurePa = obs.value;
    } else if (d === "0-10-009" || d === "0-07-001") {
      current.altitudeM = obs.value;
    } else if (d === "0-12-101" || d === "0-12-001") {
      current.temperatureK = obs.value;
    } else if (d === "0-12-103" || d === "0-12-003") {
      current.dewpointK = obs.value;
    } else if (d === "0-13-003") {
      current.relativeHumidityPct = obs.value;
    } else if (d === "0-11-001") {
      current.windDirectionDeg = obs.value;
    } else if (d === "0-11-002") {
      current.windSpeedMs = obs.value;
    }
  }
  flush();

  // Sort from highest pressure (surface) to lowest pressure (aloft)
  levels.sort((a, b) => b.pressurePa - a.pressurePa);

  const result: BufrSoundingLevel[] = [];
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i]!;
    const isaAlt = isaAltitudeFromPressure(lv.pressurePa);
    let tdK = lv.dewpointK;
    let rhPct = lv.relativeHumidityPct;
    if (tdK === undefined && rhPct !== undefined) {
      tdK = magnusDewpoint(lv.temperatureK, rhPct);
    } else if (rhPct === undefined && tdK !== undefined) {
      rhPct = magnusRelativeHumidity(lv.temperatureK, tdK);
    }
    const w = tdK !== undefined ? waterVaporMixingRatio(lv.pressurePa, tdK) : 0;
    const tv = virtualTemperature(lv.temperatureK, w);
    const theta = potentialTemperature(lv.temperatureK, lv.pressurePa);

    let hypAlt: number;
    if (i === 0) {
      hypAlt = lv.altitudeM ?? isaAlt;
    } else {
      const prev = result[i - 1]!;
      const meanTv = 0.5 * (prev.virtualTemperatureK + tv);
      hypAlt =
        (prev.hypsometricAltitudeM ?? prev.altitudeM) + hypsometricThickness(prev.pressurePa, lv.pressurePa, meanTv);
    }

    result.push({
      pressurePa: lv.pressurePa,
      altitudeM: lv.altitudeM ?? hypAlt,
      temperatureK: lv.temperatureK,
      dewpointK: tdK,
      relativeHumidityPct: rhPct,
      windDirectionDeg: lv.windDirectionDeg,
      windSpeedMs: lv.windSpeedMs,
      isaAltitudeM: isaAlt,
      hypsometricAltitudeM: hypAlt,
      virtualTemperatureK: tv,
      potentialTemperatureK: theta,
      mixingRatioKgKg: w,
    });
  }

  return result;
}

/**
 * Runs meteorological thermodynamic & ISA/hypsometric QA analysis over a parsed BUFR message.
 */
export function solveBufrMeteorology(message: BufrMessage): BufrMeteorologySolution {
  const stations: BufrStationSummary[] = [];
  let soundingLevels: BufrSoundingLevel[] = [];
  const s1 = message.section1;
  const defaultIso = `${String(s1.year).padStart(4, "0")}-${String(s1.month).padStart(2, "0")}-${String(s1.day).padStart(2, "0")}T${String(s1.hour).padStart(2, "0")}:${String(s1.minute).padStart(2, "0")}:${String(s1.second).padStart(2, "0")}Z`;

  for (const subset of message.subsets) {
    const block = getNumericVal(subset, ["0-01-001"]);
    const stn = getNumericVal(subset, ["0-01-002"]);
    const siteNameObs = subset.values.find(
      (v) => (v.descriptor === "0-01-015" || v.descriptor === "0-01-011") && typeof v.value === "string",
    );
    const stationId =
      block !== undefined && stn !== undefined
        ? `${String(Math.round(block)).padStart(2, "0")}${String(Math.round(stn)).padStart(3, "0")}`
        : typeof siteNameObs?.value === "string"
          ? siteNameObs.value
          : (subset.label ?? `SUBSET_${subset.index}`);

    const lat = getNumericVal(subset, ["0-05-001", "0-05-002"]);
    const lon = getNumericVal(subset, ["0-06-001", "0-06-002"]);
    const elev = getNumericVal(subset, ["0-07-001", "0-07-030", "0-07-031"]);
    const pSurf = getNumericVal(subset, ["0-10-004", "0-07-004"]);
    const pMsl = getNumericVal(subset, ["0-10-051"]);
    const tK = getNumericVal(subset, ["0-12-101", "0-12-001"]);
    let tdK = getNumericVal(subset, ["0-12-103", "0-12-003"]);
    let rhPct = getNumericVal(subset, ["0-13-003"]);
    const wDir = getNumericVal(subset, ["0-11-001"]);
    const wSpd = getNumericVal(subset, ["0-11-002"]);
    const precip = getNumericVal(subset, ["0-13-011", "0-13-019"]);

    if (tK !== undefined) {
      if (tdK === undefined && rhPct !== undefined) {
        tdK = magnusDewpoint(tK, rhPct);
      } else if (rhPct === undefined && tdK !== undefined) {
        rhPct = magnusRelativeHumidity(tK, tdK);
      }
    }

    stations.push({
      stationId,
      latitude: lat,
      longitude: lon,
      elevationM: elev,
      timestampIso: defaultIso,
      surfacePressurePa: pSurf,
      seaLevelPressurePa: pMsl,
      temperatureK: tK,
      dewpointK: tdK,
      relativeHumidityPct: rhPct,
      windDirectionDeg: wDir,
      windSpeedMs: wSpd,
      precipitationMm: precip,
    });

    const levels = extractSoundingLevelsFromSubset(subset);
    if (levels.length > soundingLevels.length) {
      soundingLevels = levels;
    }
  }

  let maxHypRes = 0;
  let rhSum = 0;
  let rhCount = 0;
  let dewpointConsistent = true;

  for (const lv of soundingLevels) {
    if (lv.hypsometricAltitudeM !== undefined) {
      const res = Math.abs(lv.altitudeM - lv.hypsometricAltitudeM);
      if (res > maxHypRes) maxHypRes = res;
    }
    if (lv.relativeHumidityPct !== undefined) {
      rhSum += lv.relativeHumidityPct;
      rhCount++;
    }
    if (lv.dewpointK !== undefined && lv.dewpointK > lv.temperatureK + 0.05) {
      dewpointConsistent = false;
    }
  }

  return {
    stations,
    soundingLevels,
    qaSummary: {
      levelCount: soundingLevels.length,
      maxHypsometricResidualM: maxHypRes,
      meanRhPct: rhCount > 0 ? rhSum / rhCount : 0,
      dewpointConsistent,
    },
  };
}
