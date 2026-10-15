// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Underground & Submarine Coaxial Cable Constants (Wedepohl-Wilcox / Pollaczek).
 *
 * Computes frequency-dependent series impedance Z(omega) = R(omega) + j*omega*L(omega),
 * coaxial dielectric capacitance C, characteristic impedance Z_c(omega), and
 * wave propagation velocity v_p(omega) for single-core and three-phase coaxial
 * XLPE / EPR / mass-impregnated HVDC and HVAC cables.
 *
 * References:
 * - L. M. Wedepohl, D. J. Wilcox, "Transient analysis of underground power-transmission
 *   systems: system-model and wave-propagation characteristics", Proc. IEE, 1973.
 * - F. Pollaczek, "Über das Feld einer unendlich langen wechselstromdurchflossenen
 *   Einfachleitung", ENT, 1926.
 */

import type { FrequencyDependentLineConfig, RationalPoleResidue } from "./elements/frequency-dependent-line.js";

export interface CoaxialCableGeometryConfig {
  lengthKm: number;
  coreRadiusM: number; // Outer radius of core conductor r1 (m), e.g. 0.020 m
  insulationRadiusM: number; // Outer radius of main insulation r2 (m), e.g. 0.045 m
  sheathOuterRadiusM?: number | undefined; // Outer radius of metallic sheath r3 (m)
  outerJacketRadiusM?: number | undefined; // Outer radius of jacket/serving r4 (m)
  coreResistivityOhmM?: number | undefined; // Core resistivity (Ohm*m), default 1.724e-8 (Cu)
  sheathResistivityOhmM?: number | undefined; // Sheath resistivity (Ohm*m), default 2.1e-7 (Pb)
  insulationEpsR?: number | undefined; // Relative permittivity eps_r of insulation (default 2.3 for XLPE)
  burialDepthM?: number | undefined; // Burial depth below surface (m), default 1.2 m
  soilResistivityOhmM?: number | undefined; // Soil / seabed resistivity (Ohm*m), default 100.0
  sheathGroundedBothEnds?: boolean | undefined; // Whether metallic sheath is bonded/grounded (default true)
}

export interface CableConstantsResult {
  rOhmPerKm: number;
  lHPerKm: number;
  cFPerKm: number;
  zcMagOhm: number;
  phaseVelocityKmPerSec: number;
  attenuationNeperPerKm: number;
}

/**
 * Computes frequency-dependent coaxial cable constants at frequency `freqHz`
 * using Wedepohl-Wilcox internal conductor skin-effect Bessel asymptotics,
 * coaxial main insulation inductance/capacitance, and Pollaczek earth return.
 */
export function computeCoaxialCableConstants(geom: CoaxialCableGeometryConfig, freqHz: number): CableConstantsResult {
  const mu0 = 4 * Math.PI * 1e-7; // H/m
  const eps0 = 8.854187817e-12; // F/m
  const omega = 2 * Math.PI * Math.max(1e-3, freqHz);

  const r1 = Math.max(1e-3, geom.coreRadiusM);
  const r2 = Math.max(r1 * 1.15, geom.insulationRadiusM);
  const r3 = Math.max(r2 + 0.001, geom.sheathOuterRadiusM ?? r2 + 0.003);
  const r4 = Math.max(r3 + 0.001, geom.outerJacketRadiusM ?? r3 + 0.005);

  const rhoCore = geom.coreResistivityOhmM ?? 1.724e-8;
  const rhoSheath = geom.sheathResistivityOhmM ?? 2.1e-7;
  const epsR = Math.max(1.0, geom.insulationEpsR ?? 2.3);
  const depth = Math.max(0.2, geom.burialDepthM ?? 1.2);
  const rhoSoil = Math.max(0.05, geom.soilResistivityOhmM ?? 100.0);

  // 1. Core DC resistance (Ohm/km) and Wedepohl-Wilcox skin-effect internal impedance:
  // delta_core = sqrt(2 * rho_c / (omega * mu_0))
  const areaCore = Math.PI * r1 * r1;
  const rDcCorePerKm = (rhoCore / areaCore) * 1000.0;
  const deltaCore = Math.sqrt((2.0 * rhoCore) / (omega * mu0));
  const xiCore = r1 / (Math.SQRT2 * deltaCore);

  // Low-to-high frequency Bessel I0/I1 (Wedepohl coth) transition for solid cylinder:
  // At low xi: R_int = R_dc * (1 + xi^4 / 3), X_int = R_dc * xi^2 / 2
  // At high xi: R_int = R_dc * (xi / sqrt(2) + 0.25), X_int = R_dc * (xi / sqrt(2))
  let rCoreIntPerKm: number;
  let xCoreIntPerKm: number;
  if (xiCore < 1.5) {
    rCoreIntPerKm = rDcCorePerKm * (1.0 + Math.pow(xiCore, 4) / 3.0);
    xCoreIntPerKm = rDcCorePerKm * 0.5 * xiCore * xiCore;
  } else {
    rCoreIntPerKm = rDcCorePerKm * (xiCore / Math.SQRT2 + 0.25);
    xCoreIntPerKm = rDcCorePerKm * (xiCore / Math.SQRT2);
  }

  // 2. Coaxial dielectric insulation geometrical inductance (H/km) and reactance (Ohm/km):
  // L_ins = (mu_0 / (2 * pi)) * ln(r2 / r1) * 1000
  const lInsHPerKm = (mu0 / (2 * Math.PI)) * Math.log(r2 / r1) * 1000.0;
  const xInsPerKm = omega * lInsHPerKm;

  // 3. Sheath & Pollaczek earth return contribution:
  const sheathArea = Math.PI * (r3 * r3 - r2 * r2);
  const rDcSheathPerKm = (rhoSheath / Math.max(1e-8, sheathArea)) * 1000.0;
  const deltaEarth = Math.sqrt((2.0 * rhoSoil) / (omega * mu0));

  // Pollaczek earth return resistance and reactance for buried cable at depth d:
  const kFactor = (omega * mu0 * 1000.0) / (2 * Math.PI);
  const pRe = 0.5 * deltaEarth;
  const pIm = -0.5 * deltaEarth;
  const numRe = (2.0 * (depth + pRe)) / r4;
  const numIm = (2.0 * pIm) / r4;
  const rEarthPerKm = kFactor * Math.max(0, -Math.atan2(numIm, numRe));
  const xEarthPerKm = kFactor * Math.log(Math.hypot(numRe, numIm));

  // At high frequencies (skin depth << sheath thickness), return current is confined to inner sheath;
  // at low frequencies, return current shares between sheath and Pollaczek earth return.
  const sheathThickness = Math.max(1e-4, r3 - r2);
  const deltaSheath = Math.sqrt((2.0 * rhoSheath) / (omega * mu0));
  const screenFactor = Math.exp(-sheathThickness / deltaSheath);

  const rReturnPerKm =
    geom.sheathGroundedBothEnds !== false
      ? (rDcSheathPerKm * rEarthPerKm) / (rDcSheathPerKm + rEarthPerKm + 1e-9) +
        (1.0 - screenFactor) * 0.15 * rDcSheathPerKm
      : rEarthPerKm * screenFactor + (1.0 - screenFactor) * rDcSheathPerKm;

  const xReturnPerKm = screenFactor * 0.25 * xEarthPerKm;

  const rOhmPerKm = rCoreIntPerKm + rReturnPerKm;
  const xTotalPerKm = xCoreIntPerKm + xInsPerKm + xReturnPerKm;
  const lHPerKm = xTotalPerKm / omega;

  // 4. Coaxial dielectric shunt capacitance (F/km):
  // C = (2 * pi * eps_0 * eps_r) / ln(r2 / r1) * 1000
  const cFPerKm = ((2.0 * Math.PI * eps0 * epsR) / Math.log(r2 / r1)) * 1000.0;

  // 5. Propagation constant gamma = sqrt((R + j*omega*L) * (j*omega*C)) = alpha + j*beta
  // and characteristic impedance Z_c = sqrt((R + j*omega*L) / (j*omega*C))
  const zMag = Math.hypot(rOhmPerKm, xTotalPerKm);
  const zAng = Math.atan2(xTotalPerKm, rOhmPerKm);
  const yMag = omega * cFPerKm;
  const yAng = Math.PI / 2.0;

  const gammaMag = Math.sqrt(zMag * yMag);
  const gammaAng = 0.5 * (zAng + yAng);
  const alpha = gammaMag * Math.cos(gammaAng);
  const beta = gammaMag * Math.sin(gammaAng);

  const zcMagOhm = Math.sqrt(zMag / Math.max(1e-18, yMag));
  const phaseVelocityKmPerSec = beta > 1e-12 ? omega / beta : 299792.0 / Math.sqrt(epsR);

  return {
    rOhmPerKm,
    lHPerKm,
    cFPerKm,
    zcMagOhm,
    phaseVelocityKmPerSec,
    attenuationNeperPerKm: alpha,
  };
}

/**
 * Synthesizes a passive, frequency-dependent rational pole/residue model (`FrequencyDependentLineConfig`)
 * directly from physical underground/submarine coaxial cable geometry.
 */
export function synthesizeFdLineFromCable(
  id: string,
  fromNode: number,
  toNode: number,
  geom: CoaxialCableGeometryConfig,
  numPoles = 4,
): FrequencyDependentLineConfig {
  const hf = computeCoaxialCableConstants(geom, 100e3);
  const lf = computeCoaxialCableConstants(geom, 60.0);

  const tauSec = geom.lengthKm / Math.max(1e4, hf.phaseVelocityKmPerSec);
  const y0 = 1.0 / Math.max(1.0, hf.zcMagOhm);
  const yLow = 1.0 / Math.max(1.0, lf.zcMagOhm);

  const yPoles: RationalPoleResidue[] = [];
  const hPoles: RationalPoleResidue[] = [];
  const pMin = 2 * Math.PI * 25;
  const pMax = 2 * Math.PI * 25000;

  const deltaY = yLow - y0;
  const dcTransmissionGain = Math.exp(-lf.attenuationNeperPerKm * geom.lengthKm);

  let weightSum = 0;
  const poles: number[] = [];
  for (let m = 0; m < numPoles; m++) {
    const frac = numPoles > 1 ? m / (numPoles - 1) : 0.5;
    const pole = -pMin * Math.pow(pMax / pMin, frac);
    poles.push(pole);
    weightSum += 1.0 / (m + 1);
  }

  for (let m = 0; m < numPoles; m++) {
    const pole = poles[m]!;
    const w = 1.0 / (m + 1) / weightSum;
    yPoles.push({
      pole,
      residue: -deltaY * w * pole,
    });
    hPoles.push({
      pole,
      residue: -dcTransmissionGain * w * pole,
    });
  }

  return {
    id,
    fromNode,
    toNode,
    lengthKm: geom.lengthKm,
    tauSec,
    y0,
    yPoles,
    hPoles,
  };
}
