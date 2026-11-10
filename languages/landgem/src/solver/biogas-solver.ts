// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  LandgemModel,
  BiogasSimulationSummary,
  AnnualLfgResult,
  DigesterResult,
} from "../types.js";

/**
 * Solves LandGEM first-order methane decay emissions and ADM1 anaerobic digester biogas yields.
 */
export function solveBiogas(model: LandgemModel): BiogasSimulationSummary {
  const { sites, digesters } = model;

  const annualLfg: AnnualLfgResult[] = [];
  let peakYear = 2000;
  let peakMethane = 0.0;
  let cumulativeMethane = 0.0;

  if (sites.length > 0) {
    const site = sites[0]!;
    const { params, cohorts, openYear, closeYear } = site;
    const { l0, k, methaneContentPercent } = params;

    // Timeline: from opening year to 30 years post-closure
    const startYear = cohorts.length > 0 ? Math.min(openYear, cohorts[0]!.year) : openYear;
    const endYear = Math.max(closeYear + 30, startYear + 40);

    let cumulativeWasteMg = 0;
    const wasteByYear = new Map<number, number>();
    for (const c of cohorts) {
      wasteByYear.set(c.year, (wasteByYear.get(c.year) ?? 0) + c.massMg);
      cumulativeWasteMg += c.massMg;
    }

    for (let yr = startYear; yr <= endYear; yr++) {
      let qCh4Year = 0.0; // m^3 CH4 / year

      for (const [cohortYr, massMg] of wasteByYear.entries()) {
        if (yr >= cohortYr) {
          const t = yr - cohortYr;
          // Standard LandGEM equation: Q_i = 2 * k * L0 * M_i * e^(-k * t)
          const qCohort = 2.0 * k * l0 * massMg * Math.exp(-k * t);
          qCh4Year += qCohort;
        }
      }

      const lfgFrac = Math.max(0.1, methaneContentPercent / 100.0);
      const qLfgYear = qCh4Year / lfgFrac;

      // Power potential in MW: ~37.78 MJ/m^3 CH4, 35% electrical efficiency
      // 37.78e6 J/m^3 / 31536000 s/yr * 0.35 ≈ 0.419 W per m^3/yr = 4.19e-7 MW
      const powerMW = qCh4Year * 4.19e-7;

      cumulativeMethane += qCh4Year;
      if (qCh4Year > peakMethane) {
        peakMethane = qCh4Year;
        peakYear = yr;
      }

      annualLfg.push({
        year: yr,
        wasteInPlaceMg: cumulativeWasteMg,
        methaneM3PerYear: qCh4Year,
        lfgM3PerYear: qLfgYear,
        powerPotentialMW: powerMW,
      });
    }
  }

  // Digester calculations
  const digesterResults: DigesterResult[] = [];
  for (const d of digesters) {
    const eff = d.codRemovalEfficiency ?? 0.70;
    const dailyLiquidFlow = d.volumeM3 / Math.max(d.hrtDays, 1.0); // m^3 / day
    // Feed COD in kg/m^3 is identical to g/L
    const dailyCodLoadKg = dailyLiquidFlow * d.feedCodGL;
    const dailyCodDestroyedKg = dailyCodLoadKg * eff;

    // 0.35 m^3 CH4 per kg COD destroyed at 0°C, adjust for digester temp
    const tempKelvin = 273.15 + d.temperatureC;
    const dailyCh4M3 = dailyCodDestroyedKg * 0.35 * (tempKelvin / 273.15);
    const dailyBiogasM3 = dailyCh4M3 / 0.65; // ~65% CH4 in ADM1 digester biogas

    // CHP ratings: ~10 kWh per m^3 CH4
    const totalDailyKwh = dailyCh4M3 * 10.0;
    const electricalPowerKW = (totalDailyKwh * 0.38) / 24.0;
    const thermalPowerKW = (totalDailyKwh * 0.45) / 24.0;

    let vfaRisk: "low" | "moderate" | "severe" = "low";
    if (d.ph < 6.5 || d.ph > 8.3) {
      vfaRisk = "severe";
    } else if (d.ph < 6.8 || d.ph > 8.0) {
      vfaRisk = "moderate";
    }

    digesterResults.push({
      name: d.name,
      dailyBiogasM3,
      dailyMethaneM3: dailyCh4M3,
      electricalPowerKW,
      thermalPowerKW,
      vfaRisk,
    });
  }

  return {
    annualLfg,
    peakMethaneYear: peakYear,
    peakMethaneM3PerYear: peakMethane,
    cumulativeMethaneM3: cumulativeMethane,
    digesters: digesterResults,
  };
}
