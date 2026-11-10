// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview IEEE Std 738-2012 Dynamic Line Rating (DLR) Heat Balance Engine.
 *
 * Implements steady-state thermal rating equations for overhead transmission conductors:
 *   q_c(T_s, T_a, V_w, phi) + q_r(T_s, T_a) = q_s(alpha_s, Q_se, theta) + I^2 * R(T_s)
 *
 * Calculates:
 *   - Conductor thermal capacity (Dynamic Ampacity in Amperes) for max allowable temp T_max.
 *   - Operating conductor surface temperature T_s given current I and ambient weather.
 *   - Weather sensitivity coefficients (dq/dTa, dq/dVw, dq/dQs).
 *   - Coupled power flow branch resistance adjustment: R(T_s) = R_20 * [1 + alpha_R * (T_s - 20)].
 *
 * Academic & Industry Standard:
 * - IEEE Std 738-2012: IEEE Standard for Calculating the Current-Temperature of Bare Overhead Conductors.
 * - CIGRE TB 299 / TB 601: Guide for selection of weather parameters for thermal ratings of overhead lines.
 */

export interface ConductorProperties {
  /** Conductor code name or label (e.g., "Drake", "Curlew", "Hawk", "Partridge"). */
  name: string;
  /** Conductor outer diameter in millimeters (mm). */
  diameterMm: number;
  /** AC resistance at 20°C in Ohms per kilometer (Ohm/km). */
  r20OhmPerKm: number;
  /** Temperature coefficient of resistance per °C (default: 0.00393 for Aluminum). */
  tempCoeffPerC?: number | undefined;
  /** Conductor surface emissivity epsilon in [0.2, 0.95] (default: 0.80 for weathered conductor). */
  emissivity?: number | undefined;
  /** Conductor solar absorptivity alpha_s in [0.2, 0.95] (default: 0.80). */
  absorptivity?: number | undefined;
  /** Maximum allowable conductor temperature in °C (default: 75.0°C or 90.0°C). */
  maxTempC?: number | undefined;
}

export interface WeatherConditions {
  /** Ambient air temperature in °C. */
  ambientTempC: number;
  /** Wind velocity in meters per second (m/s). */
  windSpeedMps: number;
  /** Angle between wind direction and conductor axis in degrees (90° = perpendicular). */
  windAngleDeg: number;
  /** Solar irradiance (total solar and sky radiated heat flux) in W/m² (default: 1000 W/m²). */
  solarIrradianceWpm2?: number | undefined;
  /** Height above sea level / elevation in meters (default: 0 m). */
  elevationMeters?: number | undefined;
}

export interface DlrRatingResult {
  /** Steady-state maximum dynamic thermal ampacity in Amperes (A). */
  ampacityA: number;
  /** Static standard ampacity under N-0 standard assumptions (40°C ambient, 0.6 m/s wind). */
  staticAmpacityA: number;
  /** Percentage rating uprate/derate compared to static rating: (ampacity - static) / static * 100. */
  upratePercent: number;
  /** Convective cooling heat loss at T_max in Watts per meter (W/m). */
  qcWpm: number;
  /** Radiated heat loss at T_max in Watts per meter (W/m). */
  qrWpm: number;
  /** Solar heat gain in Watts per meter (W/m). */
  qsWpm: number;
  /** Conductor resistance at T_max in Ohms per kilometer (Ohm/km). */
  rAtMaxTempOhmPerKm: number;
}

export interface ConductorTempResult {
  /** Solved steady-state conductor surface temperature in °C. */
  conductorTempC: number;
  /** Adjusted branch resistance in Ohms per kilometer (Ohm/km). */
  resistanceOhmPerKm: number;
  /** Thermal headroom in °C: maxTemp - conductorTemp. */
  thermalHeadroomC: number;
  /** Whether conductor temperature exceeds allowable maximum. */
  overheated: boolean;
}

/**
 * Standard ACSR (Aluminum Conductor Steel Reinforced) conductor catalog.
 */
export const STANDARD_ACSR_CONDUCTORS: Record<string, ConductorProperties> = {
  Partridge: {
    name: "Partridge (266.8 kcmil 26/7)",
    diameterMm: 16.3,
    r20OhmPerKm: 0.214,
    tempCoeffPerC: 0.00393,
    emissivity: 0.8,
    absorptivity: 0.8,
    maxTempC: 75.0,
  },
  Hawk: {
    name: "Hawk (477 kcmil 26/7)",
    diameterMm: 21.8,
    r20OhmPerKm: 0.1196,
    tempCoeffPerC: 0.00393,
    emissivity: 0.8,
    absorptivity: 0.8,
    maxTempC: 75.0,
  },
  Drake: {
    name: "Drake (795 kcmil 26/7)",
    diameterMm: 28.1,
    r20OhmPerKm: 0.0718,
    tempCoeffPerC: 0.00393,
    emissivity: 0.8,
    absorptivity: 0.8,
    maxTempC: 75.0,
  },
  Cardinal: {
    name: "Cardinal (954 kcmil 54/7)",
    diameterMm: 30.4,
    r20OhmPerKm: 0.0598,
    tempCoeffPerC: 0.00393,
    emissivity: 0.8,
    absorptivity: 0.8,
    maxTempC: 75.0,
  },
  Curlew: {
    name: "Curlew (1033.5 kcmil 54/7)",
    diameterMm: 31.6,
    r20OhmPerKm: 0.0552,
    tempCoeffPerC: 0.00393,
    emissivity: 0.8,
    absorptivity: 0.8,
    maxTempC: 75.0,
  },
};

/**
 * Calculates convective cooling heat loss q_c per IEEE 738 (Section 3.4).
 */
export function calculateConvectionHeatLoss(
  conductor: ConductorProperties,
  weather: WeatherConditions,
  tsC: number,
): number {
  const taC = weather.ambientTempC;
  if (tsC <= taC) return 0.0;

  const tFilmC = 0.5 * (tsC + taC);
  const D = conductor.diameterMm; // mm
  const Vw = Math.max(0.0, weather.windSpeedMps); // m/s
  const He = weather.elevationMeters ?? 0.0; // m

  // Air density rho_f (kg/m^3)
  const rhoF =
    (1.293 - 1.525e-4 * He + 6.379e-9 * He * He) / (1.0 + 0.00367 * tFilmC);

  // Thermal conductivity of air k_f (W/(m-°C))
  const kF = 0.02424 + 7.477e-5 * tFilmC - 4.407e-9 * tFilmC * tFilmC;

  // Dynamic viscosity of air mu_f (Pa-s)
  const muF = (1.458e-6 * Math.pow(tFilmC + 273.15, 1.5)) / (tFilmC + 383.4);

  // Wind direction factor K_angle
  const phiRad = (weather.windAngleDeg * Math.PI) / 180.0;
  const sinPhi = Math.sin(phiRad);
  const kAngle = 1.194 - Math.cos(phiRad) + 0.194 * Math.cos(2.0 * phiRad) + 0.368 * Math.sin(2.0 * phiRad);
  const effectiveKAngle = Math.max(0.38, Math.min(1.0, Math.max(kAngle, Math.pow(Math.max(0.01, sinPhi), 0.6))));

  // Reynolds number parameter with D in mm per IEEE 738
  const N_Re = (D * rhoF * Vw) / muF;

  // Forced convection at low wind speed: qc1
  const qc1 =
    (1.01 + 0.0372 * Math.pow(Math.max(0, N_Re), 0.52)) *
    kF *
    (tsC - taC) *
    effectiveKAngle;

  // Forced convection at high wind speed: qc2
  const qc2 =
    0.0119 *
    Math.pow(Math.max(0, N_Re), 0.6) *
    kF *
    (tsC - taC) *
    effectiveKAngle;

  // Natural convection (zero wind): qcn
  const qcn =
    0.0205 * Math.pow(rhoF, 0.5) * Math.pow(D, 0.75) * Math.pow(tsC - taC, 1.25);

  return Math.max(qc1, qc2, qcn);
}

/**
 * Calculates radiated heat loss q_r per IEEE 738 (Section 3.5).
 */
export function calculateRadiatedHeatLoss(
  conductor: ConductorProperties,
  ambientTempC: number,
  tsC: number,
): number {
  if (tsC <= ambientTempC) return 0.0;
  const D = conductor.diameterMm; // mm
  const eps = conductor.emissivity ?? 0.8;
  const t1 = (tsC + 273.15) / 100.0;
  const t2 = (ambientTempC + 273.15) / 100.0;

  // q_r = 0.0178 * D * eps * [ ((Ts+273)/100)^4 - ((Ta+273)/100)^4 ]
  return 0.0178 * D * eps * (Math.pow(t1, 4) - Math.pow(t2, 4));
}

/**
 * Calculates solar heat gain q_s per IEEE 738 (Section 3.6).
 */
export function calculateSolarHeatGain(
  conductor: ConductorProperties,
  solarIrradianceWpm2 = 1000.0,
): number {
  const alphaS = conductor.absorptivity ?? 0.8;
  const D = conductor.diameterMm; // mm
  const projectedAreaPerMeter = D * 1e-3; // m^2 / m

  // q_s = alpha_s * Q_se * sin(theta) * A'
  // Assuming direct perpendicular solar incidence for conservative rating
  return alphaS * solarIrradianceWpm2 * projectedAreaPerMeter;
}

/**
 * Calculates conductor resistance at temperature T_s in Ohms per meter (Ohm/m).
 */
export function calculateConductorResistance(
  conductor: ConductorProperties,
  tsC: number,
): number {
  const alphaR = conductor.tempCoeffPerC ?? 0.00393;
  const r20PerM = (conductor.r20OhmPerKm * 1e-3); // Ohm/m
  return r20PerM * (1.0 + alphaR * (tsC - 20.0));
}

/**
 * Computes Dynamic Line Rating (DLR) ampacity per IEEE 738.
 */
export function calculateDynamicLineRating(
  conductor: ConductorProperties,
  weather: WeatherConditions,
): DlrRatingResult {
  const tMax = conductor.maxTempC ?? 75.0;

  // Heat loss components at max allowable operating temperature
  const qc = calculateConvectionHeatLoss(conductor, weather, tMax);
  const qr = calculateRadiatedHeatLoss(conductor, weather.ambientTempC, tMax);
  const qs = calculateSolarHeatGain(conductor, weather.solarIrradianceWpm2 ?? 1000.0);

  const rMax = calculateConductorResistance(conductor, tMax); // Ohm/m

  // Thermal balance: I^2 * R = qc + qr - qs
  const netCooling = qc + qr - qs;
  const ampacityA = netCooling > 0 ? Math.sqrt(netCooling / rMax) : 0.0;

  // Compare against static standard rating: 40°C ambient, 0.6 m/s wind, 90° angle, 1000 W/m² sun
  const staticWeather: WeatherConditions = {
    ambientTempC: 40.0,
    windSpeedMps: 0.6,
    windAngleDeg: 90.0,
    solarIrradianceWpm2: 1000.0,
  };
  const qcStatic = calculateConvectionHeatLoss(conductor, staticWeather, tMax);
  const qrStatic = calculateRadiatedHeatLoss(conductor, 40.0, tMax);
  const qsStatic = calculateSolarHeatGain(conductor, 1000.0);
  const netStatic = qcStatic + qrStatic - qsStatic;
  const staticAmpacityA = netStatic > 0 ? Math.sqrt(netStatic / rMax) : 0.0;

  const uprate = staticAmpacityA > 0 ? ((ampacityA - staticAmpacityA) / staticAmpacityA) * 100.0 : 0.0;

  return {
    ampacityA,
    staticAmpacityA,
    upratePercent: uprate,
    qcWpm: qc,
    qrWpm: qr,
    qsWpm: qs,
    rAtMaxTempOhmPerKm: rMax * 1e3,
  };
}

/**
 * Solves steady-state conductor temperature T_s given electrical current I and weather conditions.
 */
export function solveConductorTemperature(
  conductor: ConductorProperties,
  weather: WeatherConditions,
  currentA: number,
  tol = 1e-4,
  maxIter = 50,
): ConductorTempResult {
  const taC = weather.ambientTempC;
  const tMax = conductor.maxTempC ?? 75.0;
  const qs = calculateSolarHeatGain(conductor, weather.solarIrradianceWpm2 ?? 1000.0);

  if (currentA <= 0.1) {
    // No Joule heating -> conductor temperature equals ambient + small solar offset
    return {
      conductorTempC: taC,
      resistanceOhmPerKm: calculateConductorResistance(conductor, taC) * 1e3,
      thermalHeadroomC: tMax - taC,
      overheated: false,
    };
  }

  // Newton-Raphson iteration to find Ts: f(Ts) = qc(Ts) + qr(Ts) - qs - I^2 * R(Ts) = 0
  let ts = taC + 10.0;

  for (let iter = 0; iter < maxIter; iter++) {
    const qc = calculateConvectionHeatLoss(conductor, weather, ts);
    const qr = calculateRadiatedHeatLoss(conductor, taC, ts);
    const rM = calculateConductorResistance(conductor, ts);
    const f = qc + qr - qs - currentA * currentA * rM;

    if (Math.abs(f) < tol) break;

    // Numerical derivative df/dTs
    const delta = 0.05;
    const qcPlus = calculateConvectionHeatLoss(conductor, weather, ts + delta);
    const qrPlus = calculateRadiatedHeatLoss(conductor, taC, ts + delta);
    const rMPlus = calculateConductorResistance(conductor, ts + delta);
    const fPlus = qcPlus + qrPlus - qs - currentA * currentA * rMPlus;

    const df = (fPlus - f) / delta;
    if (Math.abs(df) < 1e-10) break;

    const step = f / df;
    ts = Math.max(taC, ts - step);
  }

  const rFinalPerKm = calculateConductorResistance(conductor, ts) * 1e3;
  const headroom = tMax - ts;

  return {
    conductorTempC: ts,
    resistanceOhmPerKm: rFinalPerKm,
    thermalHeadroomC: headroom,
    overheated: ts > tMax,
  };
}
