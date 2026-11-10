// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for EPA LandGEM Solid Waste & Anaerobic Co-Digestion CHP (Benchmark 42).
 *
 * Evaluates:
 * 1. Municipal solid waste decay cohorts via EPA LandGEM first-order kinetics:
 *    Q_CH4 = \sum 2 * k * L0 * M_i * e^(-k * (t - t_i))
 * 2. Landfill Gas (LFG) peak methane year, peak rate (m^3/yr), and electric generation potential (MW).
 * 3. ADM1 anaerobic digester co-digestion: daily COD destruction, biogas yield, and CHP outputs (kW).
 * 4. DAE arena lowering into square linear memory DAEBuilder arena.
 */

import assert from "node:assert/strict";
import {
  parseLandgem,
  solveBiogas,
  lowerLandgemToDae,
  type LandgemModel,
  type BiogasSimulationSummary,
} from "../src/index.js";

export const REGIONAL_LANDGEM_BENCHMARK = `
# Regional Solid Waste & Anaerobic Co-Digestion CHP Facility
SITE "MetroRegionalLandfill"
  OPEN 2005
  CLOSE 2035
  L0 100.0  # m^3/Mg methane generation potential
  K 0.04    # 1/yr conventional decay rate
  NMOC 600  # ppmv NMOC concentration
  METHANE_PERCENT 50.0

WASTE_ACCEPTANCE
  2005 120000
  2006 130000
  2007 145000
  2008 160000
  2009 175000
  2010 190000

DIGESTER "CentralCoDigestionCHP"
  VOLUME 5000.0
  TEMPERATURE 37.0
  HRT 20.0
  FEED_COD 50.0
  PH 7.4
`;

export interface LandgemBenchmarkMetrics {
  siteName: string;
  digesterName: string;
  wasteCohortsCount: number;
  peakMethaneYear: number;
  peakMethaneM3PerYear: number;
  cumulativeMethaneM3: number;
  powerPotentialMW: number;
  digesterDailyBiogasM3: number;
  digesterElectricPowerKW: number;
  digesterThermalPowerKW: number;
  vfaRisk: "low" | "moderate" | "severe";
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
}

export function runLandgemBenchmark(src = REGIONAL_LANDGEM_BENCHMARK): LandgemBenchmarkMetrics {
  const model: LandgemModel = parseLandgem(src);
  assert.equal(model.sites.length, 1);
  assert.equal(model.digesters.length, 1);

  const site = model.sites[0]!;
  const dig = model.digesters[0]!;

  const summary: BiogasSimulationSummary = solveBiogas(model);
  assert.ok(summary.annualLfg.length > 0);
  assert.ok(summary.peakMethaneM3PerYear > 0);
  assert.ok(summary.cumulativeMethaneM3 > 0);
  assert.equal(summary.digesters.length, 1);

  const digRes = summary.digesters[0]!;
  const peakLfg = summary.annualLfg.find((r) => r.year === summary.peakMethaneYear);
  const powerPotentialMW = peakLfg?.powerPotentialMW ?? (summary.peakMethaneM3PerYear * 4.19e-7);

  const arena = lowerLandgemToDae(model);
  const daeVarCount = arena.variables().length;
  const daeEqCount = arena.equations().length;

  return {
    siteName: site.name,
    digesterName: dig.name,
    wasteCohortsCount: site.cohorts.length,
    peakMethaneYear: summary.peakMethaneYear,
    peakMethaneM3PerYear: summary.peakMethaneM3PerYear,
    cumulativeMethaneM3: summary.cumulativeMethaneM3,
    powerPotentialMW,
    digesterDailyBiogasM3: digRes.dailyBiogasM3,
    digesterElectricPowerKW: digRes.electricalPowerKW,
    digesterThermalPowerKW: digRes.thermalPowerKW,
    vfaRisk: digRes.vfaRisk,
    daeVarCount,
    daeEqCount,
    isSquare: daeVarCount === daeEqCount,
  };
}
