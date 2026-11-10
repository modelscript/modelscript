// SPDX-License-Identifier: AGPL-3.0-or-later

export interface WasteCohort {
  year: number;
  massMg: number; // Metric tons (Mg) of waste accepted in year
  line?: number | undefined;
}

export interface LandgemParameters {
  l0: number; // Potential methane generation capacity (m^3/Mg)
  k: number;  // Methane generation rate constant (1/year)
  nmocPpmv: number; // NMOC concentration (ppmv as hexane)
  methaneContentPercent: number; // Typically 50%
}

export interface LandfillSite {
  name: string;
  openYear: number;
  closeYear: number;
  params: LandgemParameters;
  cohorts: WasteCohort[];
  line?: number | undefined;
}

export interface DigesterParameters {
  name: string;
  volumeM3: number;       // Reactor liquid volume (m^3)
  temperatureC: number;   // Digestion temperature (deg C)
  hrtDays: number;        // Hydraulic retention time (days)
  feedCodGL: number;      // Feed chemical oxygen demand (g COD / L)
  ph: number;             // Operating pH
  codRemovalEfficiency?: number | undefined; // Fraction removed (0.0 - 1.0, default 0.70)
  line?: number | undefined;
}

export interface LandgemModel {
  sites: LandfillSite[];
  digesters: DigesterParameters[];
}

export interface AnnualLfgResult {
  year: number;
  wasteInPlaceMg: number;
  methaneM3PerYear: number;
  lfgM3PerYear: number;
  powerPotentialMW: number;
}

export interface DigesterResult {
  name: string;
  dailyBiogasM3: number;
  dailyMethaneM3: number;
  electricalPowerKW: number;
  thermalPowerKW: number;
  vfaRisk: "low" | "moderate" | "severe";
}

export interface BiogasSimulationSummary {
  annualLfg: AnnualLfgResult[];
  peakMethaneYear: number;
  peakMethaneM3PerYear: number;
  cumulativeMethaneM3: number;
  digesters: DigesterResult[];
}
