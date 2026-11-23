// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * USAF Stability and Control Digital DATCOM Semi-Empirical Aerodynamic Solver.
 *
 * Implements cleanroom public aerodynamic methods:
 * - ISA Standard Atmosphere
 * - NACA 4/5/6-series section properties
 * - Helmbold / Polhamus / DATCOM finite-wing lift-curve slope (subsonic Prandtl-Glauert & supersonic)
 * - Oswald efficiency & parabolic drag polar CD = CD0 + CL^2 / (pi * e * AR)
 * - Horizontal/vertical tail contributions, downwash, neutral point XNP, static margin, Cm
 * - Dynamic damping derivatives (Cmq, Clp, Cnr) & lateral-directional static derivatives
 * - Linearized 6-DOF longitudinal (short-period, phugoid) and lateral (roll, Dutch roll, spiral) modes
 */

import type {
  DatcomAeroPoint,
  DatcomAeroResult,
  DatcomCase,
  DatcomLateralModes,
  DatcomLongitudinalModes,
  DatcomUnitSystem,
  PlanformParams,
} from "../types.js";

const G0 = 9.80665;
const R_AIR = 287.058;
const GAMMA_AIR = 1.4;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export function lengthToMeters(val: number, unit: DatcomUnitSystem): number {
  switch (unit) {
    case "FT":
      return val * 0.3048;
    case "IN":
      return val * 0.0254;
    case "CM":
      return val * 0.01;
    case "M":
    default:
      return val;
  }
}

export function areaToSquareMeters(val: number, unit: DatcomUnitSystem): number {
  const f = lengthToMeters(1, unit);
  return val * f * f;
}

export function weightToKg(val: number, unit: DatcomUnitSystem): number {
  // In FT/IN DATCOM decks, WT is in lbf (1 lbf = 0.45359237 kgf). In M/CM decks, WT is in N or kgf;
  // Digital DATCOM standard specifies weight in Newtons for M (or lbf for FT/IN).
  if (unit === "FT" || unit === "IN") {
    return val * 0.45359237;
  }
  return val / G0;
}

export interface IsaAtmosphere {
  temperatureK: number;
  pressurePa: number;
  densityKgM3: number;
  speedOfSoundMS: number;
}

export function computeIsaAtmosphere(altitudeM: number): IsaAtmosphere {
  const h = Math.max(0, Math.min(altitudeM, 32000));
  if (h <= 11000) {
    const T = 288.15 - 0.0065 * h;
    const P = 101325.0 * Math.pow(T / 288.15, 5.2558797);
    const rho = P / (R_AIR * T);
    const a = Math.sqrt(GAMMA_AIR * R_AIR * T);
    return { temperatureK: T, pressurePa: P, densityKgM3: rho, speedOfSoundMS: a };
  }
  const T = 216.65;
  const P = 22632.06 * Math.exp((-G0 * (h - 11000)) / (R_AIR * T));
  const rho = P / (R_AIR * T);
  const a = Math.sqrt(GAMMA_AIR * R_AIR * T);
  return { temperatureK: T, pressurePa: P, densityKgM3: rho, speedOfSoundMS: a };
}

export interface NacaSectionProps {
  thicknessRatio: number;
  maxCamber: number;
  alphaL0Deg: number;
  clAlphaPerRad: number;
  cmAc: number;
  cd0Section: number;
}

export function parseNacaAirfoilProps(designation?: string): NacaSectionProps {
  const defaults: NacaSectionProps = {
    thicknessRatio: 0.12,
    maxCamber: 0,
    alphaL0Deg: 0,
    clAlphaPerRad: 2 * Math.PI,
    cmAc: 0,
    cd0Section: 0.006,
  };
  if (!designation) return defaults;

  const clean = designation.trim().toUpperCase();
  // 4-digit NACA: MPTT
  if (/^\d{4}$/.test(clean)) {
    const m = parseInt(clean[0]!, 10) / 100;
    const tt = parseInt(clean.slice(2, 4), 10) / 100;
    const tc = Math.max(0.03, Math.min(0.3, tt));
    const alphaL0Deg = m === 0 ? 0 : -m * 105.0; // e.g., 2412 -> -2.1 deg, 4412 -> -4.2 deg
    const cmAc = m === 0 ? 0 : -2.5 * m; // e.g., 2412 -> -0.05
    const cd0Section = 0.0052 + 0.03 * tc * tc;
    return {
      thicknessRatio: tc,
      maxCamber: m,
      alphaL0Deg,
      clAlphaPerRad: 2 * Math.PI,
      cmAc,
      cd0Section,
    };
  }
  // 5-digit NACA: LPQTT (e.g., 23012)
  if (/^\d{5}$/.test(clean)) {
    const clDesign = parseInt(clean[0]!, 10) * 0.15;
    const tt = parseInt(clean.slice(3, 5), 10) / 100;
    const tc = Math.max(0.03, Math.min(0.3, tt));
    const alphaL0Deg = -4.0 * clDesign;
    const cmAc = -0.025 * clDesign;
    const cd0Section = 0.005 + 0.028 * tc * tc;
    return {
      thicknessRatio: tc,
      maxCamber: clDesign * 0.06,
      alphaL0Deg,
      clAlphaPerRad: 2 * Math.PI,
      cmAc,
      cd0Section,
    };
  }
  // 6-series NACA (e.g., 64A010, 64212)
  const m6 = clean.match(/^6\d[A-Z]?(\d)(\d{2})$/);
  if (m6) {
    const clDesign = parseInt(m6[1]!, 10) * 0.1;
    const tc = Math.max(0.03, Math.min(0.3, parseInt(m6[2]!, 10) / 100));
    return {
      thicknessRatio: tc,
      maxCamber: clDesign * 0.05,
      alphaL0Deg: -3.5 * clDesign,
      clAlphaPerRad: 2 * Math.PI,
      cmAc: -0.02 * clDesign,
      cd0Section: 0.0044 + 0.025 * tc * tc,
    };
  }
  return defaults;
}

export interface PlanformGeometry {
  spanM: number;
  rootChordM: number;
  tipChordM: number;
  taperRatio: number;
  areaM2: number;
  macM: number;
  aspectRatio: number;
  sweepQuarterChordDeg: number;
  sweepHalfChordDeg: number;
  sweepLeadingEdgeDeg: number;
  macYFromRootM: number;
}

export function computePlanformGeometry(plnf: PlanformParams, unit: DatcomUnitSystem): PlanformGeometry {
  const sspn = lengthToMeters(plnf.SSPN ?? 5.0, unit);
  const spanM = Math.max(1e-3, 2 * sspn);
  const rootChordM = Math.max(1e-3, lengthToMeters(plnf.CHRDR ?? 1.5, unit));
  const tipChordM = Math.max(0, lengthToMeters(plnf.CHRDTP ?? rootChordM, unit));
  const taperRatio = tipChordM / rootChordM;
  const areaM2 = Math.max(1e-4, 0.5 * (rootChordM + tipChordM) * spanM);
  const macM = ((2 / 3) * rootChordM * (1 + taperRatio + taperRatio * taperRatio)) / (1 + taperRatio);
  const aspectRatio = (spanM * spanM) / areaM2;

  const chstat = plnf.CHSTAT ?? 0.25;
  const savsiRad = (plnf.SAVSI ?? 0) * DEG2RAD;
  const tanRef = Math.tan(savsiRad);
  const factor = (4 / aspectRatio) * ((1 - taperRatio) / (1 + taperRatio));

  const tanLE = tanRef - factor * (0.0 - chstat);
  const tanQC = tanRef - factor * (0.25 - chstat);
  const tanHC = tanRef - factor * (0.5 - chstat);

  const macYFromRootM = (spanM / 6) * ((1 + 2 * taperRatio) / (1 + taperRatio));

  return {
    spanM,
    rootChordM,
    tipChordM,
    taperRatio,
    areaM2,
    macM,
    aspectRatio,
    sweepQuarterChordDeg: Math.atan(tanQC) * RAD2DEG,
    sweepHalfChordDeg: Math.atan(tanHC) * RAD2DEG,
    sweepLeadingEdgeDeg: Math.atan(tanLE) * RAD2DEG,
    macYFromRootM,
  };
}

/**
 * Computes finite-wing lift-curve slope CL_alpha (per rad) using the
 * USAF DATCOM / Helmbold / Polhamus formula with Prandtl-Glauert compressibility.
 */
export function computeFiniteWingCLalpha(
  aspectRatio: number,
  mach: number,
  sweepHalfChordDeg: number,
  clAlpha2DPerRad: number = 2 * Math.PI,
): number {
  const kappa = clAlpha2DPerRad / (2 * Math.PI);
  const tanSweepHC = Math.tan(sweepHalfChordDeg * DEG2RAD);

  const subsonicFormula = (m: number): number => {
    const beta2 = Math.max(1e-4, 1 - m * m);
    const inner = 4 + ((aspectRatio * aspectRatio * beta2) / (kappa * kappa)) * (1 + (tanSweepHC * tanSweepHC) / beta2);
    return (2 * Math.PI * aspectRatio) / (2 + Math.sqrt(inner));
  };

  const supersonicFormula = (m: number): number => {
    const beta = Math.sqrt(Math.max(1e-4, m * m - 1));
    const tipCorrection = Math.max(0.35, 1 - 1 / (2 * aspectRatio * beta));
    return (4 / beta) * tipCorrection;
  };

  if (mach < 0.92) {
    return subsonicFormula(mach);
  }
  if (mach > 1.15) {
    return supersonicFormula(mach);
  }
  // Smooth transonic blending
  const t = (mach - 0.92) / (1.15 - 0.92);
  const subVal = subsonicFormula(0.92);
  const supVal = supersonicFormula(1.15);
  return subVal * (1 - t) + supVal * t;
}

/**
 * Computes Oswald span efficiency factor `e` using DATCOM / Raymer semi-empirical correlations.
 */
export function computeOswaldEfficiency(aspectRatio: number, sweepLeadingEdgeDeg: number): number {
  const absSweep = Math.abs(sweepLeadingEdgeDeg);
  if (absSweep <= 5.0) {
    const e = 1.78 * (1 - 0.045 * Math.pow(aspectRatio, 0.68)) - 0.64;
    return Math.max(0.65, Math.min(0.95, e));
  }
  const e = 4.61 * (1 - 0.045 * Math.pow(aspectRatio, 0.68)) * Math.pow(Math.cos(absSweep * DEG2RAD), 0.15) - 3.1;
  return Math.max(0.55, Math.min(0.9, e));
}

export interface SolveDatcomOptions {
  machIndex?: number | undefined;
  altIndex?: number | undefined;
  machOverride?: number | undefined;
  altitudeMOverride?: number | undefined;
}

/**
 * Solves a parsed Digital DATCOM case for semi-empirical aerodynamic derivatives,
 * drag polar, longitudinal static margin, dynamic damping derivatives, and 6-DOF modes.
 */
export function solveDatcomCase(c: DatcomCase, options?: SolveDatcomOptions): DatcomAeroResult {
  const unit = c.dim;
  const machIdx = options?.machIndex ?? 0;
  const altIdx = options?.altIndex ?? 0;

  const mach = options?.machOverride ?? c.fltcon?.MACH?.[machIdx] ?? c.fltcon?.MACH?.[0] ?? 0.2;
  const rawAlt = c.fltcon?.ALT?.[altIdx] ?? c.fltcon?.ALT?.[0] ?? 0;
  const altitudeM = options?.altitudeMOverride ?? lengthToMeters(rawAlt, unit);

  const isa = computeIsaAtmosphere(altitudeM);
  const airspeedMS = Math.max(5.0, mach * isa.speedOfSoundMS);
  const dynamicPressurePa = 0.5 * isa.densityKgM3 * airspeedMS * airspeedMS;

  // Wing geometry & airfoil
  const wingPlnf: PlanformParams = c.wgplnf ?? {
    CHRDR: 1.5,
    CHRDTP: 1.5,
    SSPN: 5.0,
    SAVSI: 0,
    CHSTAT: 0.25,
  };
  const wingGeom = computePlanformGeometry(wingPlnf, unit);
  const wingNaca = c.nacaCards.find((n) => n.surface === "W");
  const wingSec = parseNacaAirfoilProps(wingNaca?.designation);

  const SrefM2 =
    c.optins?.SREF !== undefined && c.optins.SREF > 0 ? areaToSquareMeters(c.optins.SREF, unit) : wingGeom.areaM2;
  const cbarM =
    c.optins?.CBARR !== undefined && c.optins.CBARR > 0 ? lengthToMeters(c.optins.CBARR, unit) : wingGeom.macM;
  const brefM =
    c.optins?.BLREF !== undefined && c.optins.BLREF > 0 ? lengthToMeters(c.optins.BLREF, unit) : wingGeom.spanM;

  const aspectRatio = wingGeom.aspectRatio;
  const beta = mach < 1 ? Math.sqrt(Math.max(1e-4, 1 - mach * mach)) : Math.sqrt(Math.max(1e-4, mach * mach - 1));

  // Wing lift-curve slope
  const CLalphaWing = computeFiniteWingCLalpha(aspectRatio, mach, wingGeom.sweepHalfChordDeg, wingSec.clAlphaPerRad);

  // Horizontal tail contribution (if present)
  let CLalphaTotal = CLalphaWing;
  let VH = 0;
  let tailArmM = 0;
  let CLalphaHT = 0;
  let dEpsDAlpha = 0;
  const etaH = 0.9;

  const xwM = lengthToMeters(c.synths?.XW ?? 0, unit);
  const wingAcX =
    xwM + wingGeom.macYFromRootM * Math.tan(wingGeom.sweepLeadingEdgeDeg * DEG2RAD) + 0.25 * wingGeom.macM;

  if (c.htplnf && (c.htplnf.SSPN ?? 0) > 0 && (c.htplnf.CHRDR ?? 0) > 0) {
    const htGeom = computePlanformGeometry(c.htplnf, unit);
    const htNaca = c.nacaCards.find((n) => n.surface === "H");
    const htSec = parseNacaAirfoilProps(htNaca?.designation);
    CLalphaHT = computeFiniteWingCLalpha(htGeom.aspectRatio, mach, htGeom.sweepHalfChordDeg, htSec.clAlphaPerRad);
    dEpsDAlpha = Math.min(0.65, (2 * CLalphaWing) / (Math.PI * aspectRatio));

    const xhM = lengthToMeters(c.synths?.XH ?? xwM + 3.0 * cbarM, unit);
    const htAcX = xhM + htGeom.macYFromRootM * Math.tan(htGeom.sweepLeadingEdgeDeg * DEG2RAD) + 0.25 * htGeom.macM;
    tailArmM = Math.max(0.5 * cbarM, htAcX - wingAcX);
    VH = (htGeom.areaM2 * tailArmM) / (SrefM2 * cbarM);

    CLalphaTotal = CLalphaWing + etaH * (htGeom.areaM2 / SrefM2) * CLalphaHT * (1 - dEpsDAlpha);
  }

  // Neutral point & static margin
  const neutralPointX = VH > 0 ? wingAcX + cbarM * etaH * VH * (CLalphaHT / CLalphaTotal) * (1 - dEpsDAlpha) : wingAcX;

  const cgX = c.synths?.XCG !== undefined ? lengthToMeters(c.synths.XCG, unit) : neutralPointX - 0.12 * cbarM;
  const staticMargin = (neutralPointX - cgX) / cbarM;
  const CmalphaPerRad = -CLalphaTotal * staticMargin;

  // Zero-AoA lift and pitching moment
  const aliwRad = (c.synths?.ALIW ?? 0) * DEG2RAD;
  const alihRad = (c.synths?.ALIH ?? 0) * DEG2RAD;
  const CL0 = CLalphaWing * (aliwRad - wingSec.alphaL0Deg * DEG2RAD);
  const Cm0 = wingSec.cmAc + (VH > 0 ? -etaH * VH * CLalphaHT * alihRad : 0);

  // Parasitic drag CD0 and Oswald efficiency
  const oswaldEfficiency = computeOswaldEfficiency(aspectRatio, wingGeom.sweepLeadingEdgeDeg);
  const wingFormFactor = 1 + 2.0 * wingSec.thicknessRatio + 60 * Math.pow(wingSec.thicknessRatio, 4);
  let CD0 = wingSec.cd0Section * wingFormFactor;
  if (c.body && c.body.S && c.body.S.length > 0) {
    const maxBodyArea = areaToSquareMeters(Math.max(...c.body.S), unit);
    CD0 += 0.05 * (maxBodyArea / SrefM2);
  }
  if (c.htplnf && (c.htplnf.SSPN ?? 0) > 0 && (c.htplnf.CHRDR ?? 0) > 0) {
    const htGeom = computePlanformGeometry(c.htplnf, unit);
    CD0 += 0.008 * (htGeom.areaM2 / SrefM2);
  }
  if (c.vtplnf && (c.vtplnf.SSPN ?? 0) > 0 && (c.vtplnf.CHRDR ?? 0) > 0) {
    const vtGeom = computePlanformGeometry(c.vtplnf, unit);
    CD0 += 0.008 * (vtGeom.areaM2 / SrefM2);
  }
  // Wave drag increment for supersonic flight
  if (mach > 1.0) {
    CD0 += (0.015 * Math.pow(wingSec.thicknessRatio / 0.1, 2)) / Math.max(0.5, beta);
  }

  // Dynamic damping derivatives (DATCOM / Etkin / Roskam)
  const Cmq = VH > 0 ? -2.0 * etaH * VH * CLalphaHT * (tailArmM / cbarM) - 0.12 * CLalphaWing : -0.35 * CLalphaWing;

  const Clp = (-CLalphaWing / 12.0) * ((1 + 3 * wingGeom.taperRatio) / (1 + wingGeom.taperRatio));

  // Vertical tail for lateral-directional derivatives
  let VV = 0.04;
  let lvM = Math.max(cbarM * 2.5, tailArmM);
  let CLalphaVT = 2.8;
  const etaV = 0.9;
  if (c.vtplnf && (c.vtplnf.SSPN ?? 0) > 0 && (c.vtplnf.CHRDR ?? 0) > 0) {
    const vtGeom = computePlanformGeometry(c.vtplnf, unit);
    const vtArea = vtGeom.areaM2 * 0.5; // vertical tail is single-sided semispan
    const xvM = lengthToMeters(c.synths?.XV ?? xwM + 3.0 * cbarM, unit);
    lvM = Math.max(0.5 * cbarM, xvM + 0.25 * vtGeom.macM - cgX);
    VV = (vtArea * lvM) / (SrefM2 * brefM);
    CLalphaVT = computeFiniteWingCLalpha(vtGeom.aspectRatio * 1.5, mach, vtGeom.sweepHalfChordDeg, 2 * Math.PI);
  }

  const Cnr = -2.0 * etaV * VV * CLalphaVT * (lvM / brefM) - CD0 / 4.0;
  const CYbeta = -etaV * ((VV * brefM) / Math.max(0.1, lvM)) * CLalphaVT - 0.08;
  const dihedralRad = (wingPlnf.DHDADI ?? 2.0) * DEG2RAD;
  const Clbeta = -0.18 * dihedralRad - 0.04 * Math.sin(wingGeom.sweepQuarterChordDeg * DEG2RAD) - 0.02;
  const Cnbeta = etaV * VV * CLalphaVT - 0.025;

  // Alpha schedule polar
  const alphasDeg = c.fltcon?.ALSCHD && c.fltcon.ALSCHD.length > 0 ? c.fltcon.ALSCHD : [-4, -2, 0, 2, 4, 6, 8, 10];
  const polar: DatcomAeroPoint[] = alphasDeg.map((alphaDeg) => {
    const alphaRad = alphaDeg * DEG2RAD;
    const CL = CL0 + CLalphaTotal * alphaRad;
    const CDi = (CL * CL) / (Math.PI * oswaldEfficiency * aspectRatio);
    const CD = CD0 + CDi;
    const Cm = Cm0 + CmalphaPerRad * alphaRad;
    const LoverD = CD > 1e-9 ? CL / CD : 0;
    return { alphaDeg, alphaRad, CL, CD, CD0, CDi, Cm, LoverD };
  });

  // Mass and inertia estimates for 6-DOF linearized flight dynamics
  const defaultMassKg = Math.max(500, SrefM2 * 65.0);
  const massKg = c.fltcon?.WT !== undefined && c.fltcon.WT > 0 ? weightToKg(c.fltcon.WT, unit) : defaultMassKg;

  // Typical aircraft radii of gyration (Roskam / Raymer)
  const rx = 0.25 * brefM;
  const ry = 0.38 * Math.max(cbarM * 3.0, tailArmM > 0 ? tailArmM * 1.6 : brefM * 0.6);
  const rz = 0.35 * brefM;
  const Ixx = Math.max(100, massKg * rx * rx);
  const Iyy = Math.max(150, massKg * ry * ry);
  const Izz = Math.max(200, massKg * rz * rz);

  // Trim condition for linearized equations
  const CLtrim = Math.min(1.4, Math.max(0.05, (massKg * G0) / Math.max(1.0, dynamicPressurePa * SrefM2)));
  const CDtrim = CD0 + (CLtrim * CLtrim) / (Math.PI * oswaldEfficiency * aspectRatio);
  const CDalpha = (2 * CLtrim * CLalphaTotal) / (Math.PI * oswaldEfficiency * aspectRatio);

  // Longitudinal dimensional stability derivatives (stability axes)
  const Xu = (-2 * dynamicPressurePa * SrefM2 * CDtrim) / (massKg * airspeedMS);
  const Xw = (dynamicPressurePa * SrefM2 * (CLtrim - CDalpha)) / (massKg * airspeedMS);
  const Zu = (-2 * dynamicPressurePa * SrefM2 * CLtrim) / (massKg * airspeedMS);
  const Zw = (-dynamicPressurePa * SrefM2 * (CLalphaTotal + CDtrim)) / (massKg * airspeedMS);
  const Mu = 0.0;
  const Mw = (dynamicPressurePa * SrefM2 * cbarM * CmalphaPerRad) / (Iyy * airspeedMS);
  const Mq = (dynamicPressurePa * SrefM2 * cbarM * cbarM * Cmq) / (2 * Iyy * airspeedMS);
  const Mwdot = (0.3 * Mq) / airspeedMS;

  // Short-period & phugoid modes
  const spOmega2 = Math.max(1e-4, Zw * Mq - airspeedMS * Mw);
  const shortPeriodOmegaN = Math.sqrt(spOmega2);
  const shortPeriodZeta = -(Zw + Mq + airspeedMS * Mwdot) / (2 * shortPeriodOmegaN);

  const phugoidOmegaN = Math.sqrt(Math.max(1e-6, (-Zu * G0) / airspeedMS));
  const phugoidZeta = -Xu / (2 * phugoidOmegaN);

  const longitudinalModes: DatcomLongitudinalModes = {
    shortPeriodOmegaN,
    shortPeriodZeta,
    phugoidOmegaN,
    phugoidZeta,
    Xu,
    Xw,
    Zu,
    Zw,
    Mu,
    Mw,
    Mq,
  };

  // Lateral-directional dimensional stability derivatives
  const Yv = (dynamicPressurePa * SrefM2 * CYbeta) / (massKg * airspeedMS);
  const Yp = 0.0;
  const Yr = 0.0;
  const Lv = (dynamicPressurePa * SrefM2 * brefM * Clbeta) / (Ixx * airspeedMS);
  const Lp = (dynamicPressurePa * SrefM2 * brefM * brefM * Clp) / (2 * Ixx * airspeedMS);
  const Lr = (dynamicPressurePa * SrefM2 * brefM * brefM * (CLtrim / 4.0)) / (2 * Ixx * airspeedMS);
  const Nv = (dynamicPressurePa * SrefM2 * brefM * Cnbeta) / (Izz * airspeedMS);
  const Np = (dynamicPressurePa * SrefM2 * brefM * brefM * (-CLtrim / 8.0)) / (2 * Izz * airspeedMS);
  const Nr = (dynamicPressurePa * SrefM2 * brefM * brefM * Cnr) / (2 * Izz * airspeedMS);

  const rollTimeConstant = Lp < -1e-6 ? -1 / Lp : 1.0;
  const drOmega2 = Math.max(1e-4, airspeedMS * Nv + Yv * Nr);
  const dutchRollOmegaN = Math.sqrt(drOmega2);
  const dutchRollZeta = -(Yv + Nr) / (2 * dutchRollOmegaN);
  const spiralEigenvalue =
    Math.abs(Lv) > 1e-9 ? (G0 / airspeedMS) * ((Lv * Nr - Lr * Nv) / (Lv * Nr - Lp * Nv - 1e-6)) : -0.01;

  const lateralModes: DatcomLateralModes = {
    rollTimeConstant,
    dutchRollOmegaN,
    dutchRollZeta,
    spiralEigenvalue,
    Yv,
    Yp,
    Yr,
    Lv,
    Lp,
    Lr,
    Nv,
    Np,
    Nr,
  };

  return {
    caseId: c.caseId,
    mach,
    altitudeM,
    airDensityKgM3: isa.densityKgM3,
    speedOfSoundMS: isa.speedOfSoundMS,
    airspeedMS,
    dynamicPressurePa,
    massKg,
    SrefM2,
    cbarM,
    brefM,
    aspectRatio,
    taperRatio: wingGeom.taperRatio,
    sweepQuarterChordDeg: wingGeom.sweepQuarterChordDeg,
    sweepHalfChordDeg: wingGeom.sweepHalfChordDeg,
    oswaldEfficiency,
    beta,
    CLalphaPerRad: CLalphaTotal,
    CLalphaPerDeg: CLalphaTotal * DEG2RAD,
    CL0,
    CD0,
    Cm0,
    CmalphaPerRad,
    CmalphaPerDeg: CmalphaPerRad * DEG2RAD,
    neutralPointX,
    cgX,
    staticMargin,
    Cmq,
    Clp,
    Cnr,
    CYbeta,
    Clbeta,
    Cnbeta,
    polar,
    longitudinalModes,
    lateralModes,
  };
}
