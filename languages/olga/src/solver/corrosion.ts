// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Sweet CO2 Pipeline Corrosion & Structural Integrity (De Waard / NORSOK M-506).
 *
 * Implements:
 * - De Waard, Lotz & Dugstad (1995) CO2 sweet corrosion rate:
 *     log10(CR_0) = 5.78 - 1710 / T + 0.67 * log10(P_CO2)
 * - Protective iron carbonate (FeCO3) siderite scale formation factor
 * - pH and wall shear stress kinetic corrections
 * - NORSOK M-506 empirical multi-phase corrosion standard
 * - Chemical corrosion inhibitor efficiency credit
 * - Cumulative metal loss, remaining wall thickness, and ASME B31G MAOP derating over 25-year service life
 */

export interface CorrosionInput {
  operatingPressurePa: number;
  operatingTemperatureK: number;
  co2MoleFraction: number; // e.g. 0.03 for 3% CO2
  pH?: number | undefined; // water phase pH (typically 4.0 - 6.5, default 5.0)
  mixtureVelocity: number; // m/s
  wallShearStressPa?: number | undefined; // Pa
  pipeDiameterM: number; // m
  nominalWallThicknessMm: number; // mm (e.g. 19.1 mm for 12" X65 linepipe)
  corrosionAllowanceMm: number; // mm (typically 3.0 mm or 6.0 mm)
  designServiceLifeYears?: number | undefined; // years (default 25)
  inhibitorEfficiencyPercent?: number | undefined; // e.g. 95 for 95% chemical inhibitor availability
  steelGradeSmysMpa?: number | undefined; // Specified Minimum Yield Strength (e.g. 450 MPa for API 5L X65)
}

export interface CorrosionEvaluationResult {
  /** Partial pressure of carbon dioxide [bar]. */
  co2PartialPressureBar: number;
  /** Unmitigated baseline De Waard corrosion rate [mm / year]. */
  unmitigatedCorrosionRateMmPerYear: number;
  /** Protective FeCO3 iron carbonate scale reduction factor [0.05 - 1.0]. */
  protectiveScaleFactor: number;
  /** Water chemistry pH factor. */
  phFactor: number;
  /** Wall shear stress boundary-layer factor. */
  shearStressFactor: number;
  /** Effective mitigated corrosion rate with chemical inhibitor [mm / year]. */
  effectiveCorrosionRateMmPerYear: number;
  /** NORSOK M-506 empirical corrosion rate estimate [mm / year]. */
  norsokCorrosionRateMmPerYear: number;
  /** Total cumulative metal loss over service design life [mm]. */
  cumulativeMetalLossMm: number;
  /** Remaining pipe wall thickness after design life [mm]. */
  remainingWallThicknessMm: number;
  /** Percent consumption of corrosion allowance [%]. */
  allowanceConsumptionPercent: number;
  /** ASME B31G derated Maximum Allowable Operating Pressure (MAOP) [bar]. */
  deratedMaopBar: number;
  /** Whether the pipeline maintains structural integrity over its full design life. */
  isIntegrityMaintained: boolean;
  /** Recommendation for material selection or inhibitor dosing. */
  recommendation: string;
}

/**
 * Calculates De Waard & Milliams and NORSOK M-506 CO2 corrosion rates and ASME B31G pipeline integrity.
 */
export function evaluateCorrosionIntegrity(input: CorrosionInput): CorrosionEvaluationResult {
  const pTotalBar = Math.max(1.0, input.operatingPressurePa / 1e5);
  const pCo2Bar = Math.max(0.001, pTotalBar * input.co2MoleFraction);
  const tK = Math.max(273.15, input.operatingTemperatureK);
  const tC = tK - 273.15;
  const ph = input.pH ?? 5.0;
  const vm = Math.max(0.2, Math.abs(input.mixtureVelocity));
  const tauW = input.wallShearStressPa ?? 0.5 * 850.0 * 0.005 * vm * vm;
  const serviceYears = input.designServiceLifeYears ?? 25;
  const inhibitorEff = (input.inhibitorEfficiencyPercent ?? 90.0) / 100.0;
  const smysMpa = input.steelGradeSmysMpa ?? 450.0; // API 5L X65

  // 1. De Waard, Lotz & Dugstad (1995) Base Reaction Rate:
  // log10(V_corr,0) = 5.78 - 1710 / T + 0.67 * log10(P_CO2)
  const logV0 = 5.78 - 1710.0 / tK + 0.67 * Math.log10(pCo2Bar);
  const vCorr0 = Math.pow(10.0, logV0); // mm / year

  // 2. Protective Siderite (FeCO3) Scale Factor:
  // Above 55 C and high supersaturation, protective scale precipitates
  let scaleFactor = 1.0;
  if (tC > 55.0) {
    const scaleExponent = Math.min(2.0, (tC - 55.0) / 18.0);
    scaleFactor = 1.0 / (1.0 + Math.pow(10.0, scaleExponent));
  }

  // 3. pH factor:
  // Baseline calibration is at pH 4.5
  const phFactor = Math.pow(10.0, -0.15 * (ph - 4.5));

  // 4. Wall shear stress hydrodynamic factor:
  const shearFactor = 1.0 + 0.06 * Math.pow(Math.max(1.0, tauW), 0.6);

  // 5. Chemical corrosion inhibitor factor:
  const inhibitorFactor = Math.max(0.01, 1.0 - inhibitorEff);

  // Effective De Waard corrosion rate:
  const effectiveCR = vCorr0 * scaleFactor * phFactor * shearFactor * inhibitorFactor;

  // 6. NORSOK M-506 Empirical Comparison:
  // CR_norsok = K_t * f(pH) * P_CO2^c * tau^d
  const ktNorsok = Math.max(0.1, 0.45 * Math.exp(0.028 * (tC - 20.0)));
  const phNorsok = Math.max(0.2, 1.0 - 0.22 * (ph - 4.0));
  const norsokCR = Math.min(
    25.0,
    ktNorsok * phNorsok * Math.pow(pCo2Bar, 0.62) * Math.pow(Math.max(1.0, tauW), 0.15) * inhibitorFactor,
  );

  // 7. Structural Integrity & ASME B31G Life Assessment:
  const totalLossMm = effectiveCR * serviceYears;
  const remThicknessMm = Math.max(0.0, input.nominalWallThicknessMm - totalLossMm);
  const allowanceConsumption = (totalLossMm / Math.max(0.5, input.corrosionAllowanceMm)) * 100.0;

  // ASME B31G Barlow hoop stress derating:
  // MAOP = (2 * SMYS * t_rem / D) * F_design (where F_design = 0.72)
  const fDesign = 0.72;
  const dM = Math.max(0.05, input.pipeDiameterM);
  const deratedMaopPa = ((2.0 * smysMpa * 1e6 * (remThicknessMm * 1e-3)) / dM) * fDesign;
  const deratedMaopBar = deratedMaopPa / 1e5;

  const isMaintained = totalLossMm <= input.corrosionAllowanceMm && deratedMaopBar >= pTotalBar;

  let recommendation =
    "Corrosion rate within 25-year design allowance; maintain batch/continuous inhibitor monitoring.";
  if (!isMaintained) {
    if (totalLossMm > input.corrosionAllowanceMm) {
      recommendation = `CRITICAL: Cumulative metal loss (${totalLossMm.toFixed(2)} mm) breaches ${input.corrosionAllowanceMm} mm allowance! Upgrade to 13Cr/22Cr Duplex stainless steel or increase inhibitor availability to >98%.`;
    } else {
      recommendation = `Derated MAOP (${deratedMaopBar.toFixed(1)} bar) falls below operating pressure (${pTotalBar.toFixed(1)} bar); line derating or heavy wall linepipe required.`;
    }
  }

  return {
    co2PartialPressureBar: pCo2Bar,
    unmitigatedCorrosionRateMmPerYear: vCorr0,
    protectiveScaleFactor: scaleFactor,
    phFactor,
    shearStressFactor: shearFactor,
    effectiveCorrosionRateMmPerYear: effectiveCR,
    norsokCorrosionRateMmPerYear: norsokCR,
    cumulativeMetalLossMm: totalLossMm,
    remainingWallThicknessMm: remThicknessMm,
    allowanceConsumptionPercent: allowanceConsumption,
    deratedMaopBar: deratedMaopBar,
    isIntegrityMaintained: isMaintained,
    recommendation,
  };
}
