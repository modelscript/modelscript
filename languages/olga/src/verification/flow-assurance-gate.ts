// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Flow Assurance Gate Automation Engine.
 *
 * Provides headless and automated Flow Assurance Gate verification for CI/CD pipelines:
 * - Topside slug catcher peak liquid surge vs capacity envelope
 * - Continuous subsea hydrate subcooling margin and CSMHYD plugging risk
 * - Wax deposition layer accumulation
 * - De Waard / NORSOK M-506 sweet CO2 corrosion rate and ASME B31G integrity
 * - MAOP overpressure screening
 * - Minimum turndown velocity against liquid dropout
 * - Generates GitHub Actions-compatible markdown step summaries ($GITHUB_STEP_SUMMARY)
 */

import { evaluateCorrosionIntegrity } from "../solver/corrosion.js";
import { simulateDriftFlux } from "../solver/drift-flux-dae.js";
import { calculateHydrateKinetics } from "../solver/hydrate-kinetics.js";
import { computeHydrateEquilibriumTemp } from "../solver/zuber-findlay.js";
import type { OlgaModel, OlgaSimulationResult } from "../types.js";

export interface FlowAssuranceGateOptions {
  /** Maximum allowable topside liquid surge volume [m³] (default: 85.0 m³). */
  maxSurgeM3?: number | undefined;
  /** Minimum required hydrate avoidance temperature margin [K] (default: 3.0 K). */
  minHydrateMarginK?: number | undefined;
  /** Maximum allowable wax deposit thickness [mm] (default: 2.0 mm). */
  maxWaxThicknessMm?: number | undefined;
  /** Maximum allowable internal sweet CO2 corrosion rate [mm/year] (default: 0.10 mm/year). */
  maxCorrosionRateMmPerYear?: number | undefined;
  /** Maximum Allowable Operating Pressure limit in bar [bar] (default: 250 bar). */
  maxPressureBar?: number | undefined;
  /** Minimum gas turndown velocity [m/s] (default: 0.5 m/s). */
  minGasVelocity?: number | undefined;
  /** Gas phase CO2 mole fraction for corrosion assessment (default: 0.03 = 3%). */
  co2MoleFraction?: number | undefined;
  /** Wax appearance temperature / cloud point [K] (default: 295.15 K = 22°C). */
  cloudPointTempK?: number | undefined;
  /** Transient simulation duration in seconds (default: 60 s or model duration). */
  durationSeconds?: number | undefined;
}

export interface GateMetricCheck {
  name: string;
  observed: number;
  threshold: number;
  unit: string;
  operator: "<=" | ">=";
  passed: boolean;
  criticalLocationM?: number | undefined;
  notes?: string | undefined;
}

export interface FlowAssuranceGateResult {
  passed: boolean;
  modelTitle: string;
  checks: {
    slugSurge: GateMetricCheck;
    hydrateMargin: GateMetricCheck;
    waxThickness: GateMetricCheck;
    corrosionRate: GateMetricCheck;
    maop: GateMetricCheck;
    turndownVelocity: GateMetricCheck;
  };
  details: {
    peakPressureBar: number;
    arrivalTemperatureC: number;
    peakSurgeM3: number;
    hydratePluggingRisk: number;
    corrosionIntegrityMaintained: boolean;
    deratedMaopBar: number;
  };
  summary: string;
  markdownReport: string;
}

/**
 * Parses user-provided metric strings like "85m3", "2mm", "0.1mm/yr" into numeric values.
 */
export function parseGateMetric(val: string | number | undefined, defaultVal: number): number {
  if (val === undefined || val === null) return defaultVal;
  if (typeof val === "number") return val;
  const match = val
    .toString()
    .trim()
    .match(/^[-+]?[0-9]*\.?[0-9]+/);
  if (match) {
    const parsed = parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : defaultVal;
  }
  return defaultVal;
}

/**
 * Runs a rigorous multi-physics Flow Assurance Gate evaluation.
 */
export function evaluateFlowAssuranceGate(
  model: OlgaModel,
  options: FlowAssuranceGateOptions = {},
): FlowAssuranceGateResult {
  const maxSurge = options.maxSurgeM3 ?? 85.0;
  const minHydrateMargin = options.minHydrateMarginK ?? 3.0;
  const maxWaxMm = options.maxWaxThicknessMm ?? 2.0;
  const maxCorrosion = options.maxCorrosionRateMmPerYear ?? 0.1;
  const maxPressureBar = options.maxPressureBar ?? 250.0;
  const minGasVel = options.minGasVelocity ?? 0.5;
  const co2Frac = options.co2MoleFraction ?? 0.03;
  const wat = options.cloudPointTempK ?? 295.15;

  const duration = options.durationSeconds ?? Math.min(model.endTime - model.startTime, 120);

  // 1. Run transient multiphase drift-flux simulation
  const simResult: OlgaSimulationResult = simulateDriftFlux(model, {
    durationSeconds: duration,
    timeStepSeconds: model.maxDt,
  });

  // 2. Extract hydrodynamic extrema along the flowline
  let minMarginObserved = Infinity;
  let hydrateCriticalLoc = 0;
  let peakPressurePa = 0;
  let minGasVelObserved = Infinity;
  let maxWaxObservedMm = 0;
  let maxHydratePluggingRisk = 0;

  const totalLength = model.flowpaths[0]?.pipes.reduce((acc, p) => acc + p.length, 0) ?? 5000;
  const dPipe = model.flowpaths[0]?.pipes[0]?.diameter ?? 0.254;

  for (const snapshot of simResult.profiles) {
    const n = snapshot.x.length;
    for (let i = 0; i < n; i++) {
      const p = snapshot.pressure[i]!;
      const t = snapshot.temperature[i]!;
      const ug = snapshot.gasVelocity[i]!;
      const ul = snapshot.liquidVelocity[i]!;
      const holdup = snapshot.liquidHoldup[i]!;
      const loc = snapshot.x[i]!;

      // Hydrate subcooling
      const tHyd = computeHydrateEquilibriumTemp(p);
      const margin = t - tHyd;
      if (margin < minMarginObserved) {
        minMarginObserved = margin;
        hydrateCriticalLoc = loc;
      }

      // Check hydrate slurry kinetics & plugging index
      const vm = holdup * ul + (1.0 - holdup) * ug;
      const kinetics = calculateHydrateKinetics({
        pressurePa: p,
        temperatureK: t,
        waterVolumeFraction: holdup * 0.4, // Assume 40% watercut in liquid
        mixtureVelocity: vm,
        pipeDiameter: dPipe,
        timeStepSeconds: 1.0,
      });
      if (kinetics.pluggingRiskIndex > maxHydratePluggingRisk) {
        maxHydratePluggingRisk = kinetics.pluggingRiskIndex;
      }

      // Pressure peak
      if (p > peakPressurePa) {
        peakPressurePa = p;
      }

      // Gas velocity
      if (ug < minGasVelObserved && ug > 0) {
        minGasVelObserved = ug;
      }

      // Wax deposition approximation: if T < WAT, calculate thickness
      if (t < wat) {
        const subcoolWax = wat - t;
        // ~ 0.05 mm deposit per 10 K subcooling per 24 hours
        const waxThicknessMm = Math.min(maxWaxMm * 1.5, (subcoolWax / 10.0) * 0.25);
        if (waxThicknessMm > maxWaxObservedMm) {
          maxWaxObservedMm = waxThicknessMm;
        }
      }
    }
  }

  if (!Number.isFinite(minGasVelObserved)) minGasVelObserved = 1.0;
  if (!Number.isFinite(minMarginObserved)) minMarginObserved = 5.0;

  // 3. Peak liquid surge
  const peakSurge = simResult.trends.peakLiquidSurgeVolume;

  // 4. Sweet CO2 Corrosion analysis at inlet / severe condition
  const inletP = simResult.trends.inletPressure[0] ?? 120e5;
  const inletT = simResult.profiles[0]?.temperature[0] ?? 335.15;
  const inletV = Math.abs(simResult.profiles[0]?.liquidVelocity[0] ?? 2.0);

  const corrosionResult = evaluateCorrosionIntegrity({
    operatingPressurePa: inletP,
    operatingTemperatureK: inletT,
    co2MoleFraction: co2Frac,
    pH: 5.2,
    mixtureVelocity: inletV,
    pipeDiameterM: dPipe,
    nominalWallThicknessMm: 19.1,
    corrosionAllowanceMm: 3.0,
    designServiceLifeYears: 25,
    inhibitorEfficiencyPercent: 95.0, // Standard 95% continuous inhibition
  });

  const effectiveCorrosionRate = corrosionResult.effectiveCorrosionRateMmPerYear;

  // 5. Evaluate pass / fail for each gate metric
  const surgePassed = peakSurge <= maxSurge;
  const hydratePassed = minMarginObserved >= minHydrateMargin;
  const waxPassed = maxWaxObservedMm <= maxWaxMm;
  const corrosionPassed = effectiveCorrosionRate <= maxCorrosion;
  const maopPassed = peakPressurePa / 1e5 <= maxPressureBar;
  const turndownPassed = minGasVelObserved >= minGasVel;

  const overallPassed = surgePassed && hydratePassed && waxPassed && corrosionPassed && maopPassed && turndownPassed;

  const checks = {
    slugSurge: {
      name: "Topside Slug Catcher Surge",
      observed: peakSurge,
      threshold: maxSurge,
      unit: "m³",
      operator: "<=" as const,
      passed: surgePassed,
      criticalLocationM: totalLength,
      notes: surgePassed ? "Within catcher volume" : "Surge exceeds capacity limit",
    },
    hydrateMargin: {
      name: "Hydrate Avoidance Margin",
      observed: minMarginObserved,
      threshold: minHydrateMargin,
      unit: "K",
      operator: ">=" as const,
      passed: hydratePassed,
      criticalLocationM: hydrateCriticalLoc,
      notes: hydratePassed ? "Safe operating margin" : "Inside hydrate formation zone",
    },
    waxThickness: {
      name: "Wax Deposit Thickness",
      observed: maxWaxObservedMm,
      threshold: maxWaxMm,
      unit: "mm",
      operator: "<=" as const,
      passed: waxPassed,
      notes: waxPassed ? "Acceptable wax deposit" : "Excessive wax build-up",
    },
    corrosionRate: {
      name: "Sweet CO₂ Corrosion Rate",
      observed: effectiveCorrosionRate,
      threshold: maxCorrosion,
      unit: "mm/year",
      operator: "<=" as const,
      passed: corrosionPassed,
      notes: corrosionResult.recommendation,
    },
    maop: {
      name: "MAOP Overpressure Limit",
      observed: peakPressurePa / 1e5,
      threshold: maxPressureBar,
      unit: "bar",
      operator: "<=" as const,
      passed: maopPassed,
      notes: maopPassed ? "Pressure within rating" : "Overpressure detected",
    },
    turndownVelocity: {
      name: "Turndown Gas Velocity",
      observed: minGasVelObserved,
      threshold: minGasVel,
      unit: "m/s",
      operator: ">=" as const,
      passed: turndownPassed,
      notes: turndownPassed ? "Adequate liquid sweep" : "Liquid dropout risk",
    },
  };

  const lastTrendIdx = simResult.trends.arrivalPressure.length - 1;
  const arrivalT = (simResult.trends.arrivalTemperature[lastTrendIdx] ?? 293.15) - 273.15;

  const summary = overallPassed
    ? `✔ FLOW ASSURANCE GATE PASSED for '${model.title}': All 6 criteria satisfied.`
    : `✖ FLOW ASSURANCE GATE FAILED for '${model.title}': Violations detected.`;

  // 6. Generate GitHub Actions Markdown Summary Report
  const badge = overallPassed
    ? "![Gate: PASSED](https://img.shields.io/badge/Flow_Assurance_Gate-PASSED-brightgreen?style=for-the-badge&logo=checkmarx)"
    : "![Gate: FAILED](https://img.shields.io/badge/Flow_Assurance_Gate-FAILED-red?style=for-the-badge&logo=x)";

  const markdownReport = `# Flow Assurance Safety Gate Report: ${model.title}

${badge}

> **Automated Gate Execution:** ${new Date().toISOString()}  
> **Target System:** \`${model.title}\` (${(totalLength / 1000).toFixed(2)} km Flowline, D=${(dPipe * 1000).toFixed(0)} mm)  
> **Gate Status:** **${overallPassed ? "PASSED (APPROVED FOR OPERATION)" : "FAILED (BLOCKED — REMEDIATION REQUIRED)"}**

---

### Flow Assurance Safety Matrix

| Safety & Operability Metric | Observed Value | Threshold Limit | Compliance Status |
| :--- | :--- | :--- | :---: |
| **Topside Slug Catcher Surge** | \`${peakSurge.toFixed(2)} m³\` | \`≤ ${maxSurge.toFixed(1)} m³\` | ${surgePassed ? "✅ PASS" : "❌ **FAIL**"} |
| **Hydrate Avoidance Subcooling Margin** | \`${minMarginObserved.toFixed(1)} K\` | \`≥ ${minHydrateMargin.toFixed(1)} K\` | ${hydratePassed ? "✅ PASS" : "❌ **FAIL**"} |
| **Wax Deposit Thickness** | \`${maxWaxObservedMm.toFixed(2)} mm\` | \`≤ ${maxWaxMm.toFixed(2)} mm\` | ${waxPassed ? "✅ PASS" : "❌ **FAIL**"} |
| **Sweet CO₂ Corrosion Rate** | \`${effectiveCorrosionRate.toFixed(3)} mm/yr\` | \`≤ ${maxCorrosion.toFixed(3)} mm/yr\` | ${corrosionPassed ? "✅ PASS" : "❌ **FAIL**"} |
| **Maximum Operating Pressure (MAOP)** | \`${(peakPressurePa / 1e5).toFixed(1)} bar\` | \`≤ ${maxPressureBar.toFixed(1)} bar\` | ${maopPassed ? "✅ PASS" : "❌ **FAIL**"} |
| **Turndown Minimum Gas Velocity** | \`${minGasVelObserved.toFixed(2)} m/s\` | \`≥ ${minGasVel.toFixed(2)} m/s\` | ${turndownPassed ? "✅ PASS" : "❌ **FAIL**"} |

---

### Hydrodynamic & Chemical Details

- **Peak Arrival Pressure:** \`${((simResult.trends.arrivalPressure[lastTrendIdx] ?? 0) / 1e5).toFixed(1)} bar\`
- **Topside Arrival Temperature:** \`${arrivalT.toFixed(1)} °C\`
- **CSMHYD Hydrate Slurry Plugging Risk:** \`${(maxHydratePluggingRisk * 100).toFixed(1)}%\`
- **ASME B31G 25-Year Derated MAOP:** \`${corrosionResult.deratedMaopBar.toFixed(1)} bar\` (Structural Integrity: ${corrosionResult.isIntegrityMaintained ? "**Maintained**" : "**Compromised**"})
- **Corrosion Allowance Consumption:** \`${corrosionResult.allowanceConsumptionPercent.toFixed(1)}%\` over 25 years

---
*Generated by ModelScript Flow Assurance CI/CD Engine.*
`;

  return {
    passed: overallPassed,
    modelTitle: model.title,
    checks,
    details: {
      peakPressureBar: peakPressurePa / 1e5,
      arrivalTemperatureC: arrivalT,
      peakSurgeM3: peakSurge,
      hydratePluggingRisk: maxHydratePluggingRisk,
      corrosionIntegrityMaintained: corrosionResult.isIntegrityMaintained,
      deratedMaopBar: corrosionResult.deratedMaopBar,
    },
    summary,
    markdownReport,
  };
}
