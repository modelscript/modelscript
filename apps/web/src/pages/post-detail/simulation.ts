// SPDX-License-Identifier: AGPL-3.0-or-later

import { downloadParquetFile } from "../../util/binary-export";
import type { MoldSimulationPoint, MoldSimulationResult, SimulationPoint, SimulationResult } from "./types";

export function runMoldSimulation(
  meltTempStr: string,
  injPressureStr: string,
  gateVelStr: string,
): MoldSimulationResult {
  const meltTemp = Math.max(180, Math.min(300, parseFloat(meltTempStr) || 235));
  const injPressure = Math.max(20, Math.min(180, parseFloat(injPressureStr) || 85));
  const gateVel = Math.max(0.1, Math.min(2.5, parseFloat(gateVelStr) || 0.75));
  const cavityLengthMm = 150;
  const moldWallTemp = 60;

  // ABS Cross-WLF Rheology
  const eta0 = 280 * Math.exp(-0.024 * (meltTemp - 230));
  const shearRate = (6 * gateVel) / 0.02;
  const apparentViscosity = Math.max(35, Math.round(eta0 * Math.pow(1 + 0.02 * shearRate, -0.65)));

  // Melt front advancement through 150mm cavity
  const viscosityRatio = 140 / Math.max(30, apparentViscosity);
  const pressureFactor = Math.sqrt(injPressure / 85);
  const frontSpeedMmS = gateVel * 1000 * pressureFactor * Math.pow(viscosityRatio, 0.35);

  const fillTimeSec = Math.max(0.08, cavityLengthMm / Math.max(120, frontSpeedMmS));
  const fillTimeMs = Math.round(fillTimeSec * 1000);

  // Peak clamp force: F_clamp = P_peak * A_proj (Projected cavity: 0.15m x 0.10m = 0.015 m^2)
  const peakCavityPressure = injPressure * 0.92;
  const clampForceKn = parseFloat((((peakCavityPressure * 1e6 * 0.015) / 1000) * 0.58).toFixed(1));

  // Solidification rate at melt front
  const coolingRate = parseFloat((-18 - (meltTemp - moldWallTemp) * 0.16).toFixed(1));

  const steps = 120;
  const tMax = 0.6; // 600ms total timeline matching OpenFOAM CFD animation
  const points: MoldSimulationPoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * tMax;
    let alpha = 0;
    let frontX = 0;
    let pressure = 0;
    let temp = meltTemp;

    if (t <= fillTimeSec) {
      const fillProgress = t / fillTimeSec;
      // S-curve smoothstep volume-of-fluid progression
      const smoothed = fillProgress * fillProgress * (3 - 2 * fillProgress);
      alpha = Math.min(1.0, smoothed);
      frontX = alpha * cavityLengthMm;
      pressure = injPressure * Math.pow(Math.max(0.001, alpha), 0.85) * 0.72;
      temp = meltTemp - (meltTemp - moldWallTemp) * 0.05 * (t / fillTimeSec);
    } else {
      alpha = 1.0;
      frontX = cavityLengthMm;
      const tAfterFill = t - fillTimeSec;
      if (tAfterFill < 0.08) {
        pressure = injPressure * (0.72 + 0.2 * (tAfterFill / 0.08));
      } else {
        pressure = injPressure * 0.92 * Math.exp(-(tAfterFill - 0.08) / 0.25);
      }
      temp = moldWallTemp + (meltTemp - moldWallTemp) * Math.exp(-tAfterFill / 0.22);
    }

    points.push({
      t,
      alpha,
      pressure,
      frontX,
      temp,
    });
  }

  // SVG coordinate mapping for 280 x 140 viewport
  // x: 15 to 265 (width = 250)
  // y: 18 to 120 (height = 102)
  const svgAlpha: string[] = [];
  const svgPressure: string[] = [];

  for (let i = 0; i < points.length; i++) {
    const pt = points[i]!;
    const px = 15 + (pt.t / tMax) * 250;
    const pyAlpha = 120 - pt.alpha * 98;
    const pyPressure = 120 - Math.min(1, pt.pressure / (injPressure * 1.05)) * 98;

    if (i === 0) {
      svgAlpha.push(`M ${px.toFixed(1)} ${pyAlpha.toFixed(1)}`);
      svgPressure.push(`M ${px.toFixed(1)} ${pyPressure.toFixed(1)}`);
    } else {
      svgAlpha.push(`L ${px.toFixed(1)} ${pyAlpha.toFixed(1)}`);
      svgPressure.push(`L ${px.toFixed(1)} ${pyPressure.toFixed(1)}`);
    }
  }

  return {
    points,
    svgPathAlpha: svgAlpha.join(" "),
    svgPathPressure: svgPressure.join(" "),
    fillTimeSec,
    stats: {
      timeMs: Math.round(14 + injPressure / 10 + (meltTemp - 200) * 0.08),
      iterations: 120,
      singularities: 0,
      fillTimeMs,
      apparentViscosity,
      clampForceKn,
      coolingRate,
      peakPressureMpa: parseFloat(peakCavityPressure.toFixed(1)),
    },
  };
}

export function runWasmSimulation(dampingStr: string, stiffnessStr: string, tolStr: string): SimulationResult {
  const m = 1.0;
  const c = Math.max(0.01, parseFloat(dampingStr) * 4 || 0.72);
  const k = Math.max(1.0, parseFloat(stiffnessStr) || 64.0);
  const tol = parseInt(tolStr, 10) || 6;

  const wn = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(m * k));
  const wd = wn * Math.sqrt(Math.max(0.001, Math.abs(1 - zeta * zeta)));

  const regime = zeta < 0.99 ? "Underdamped" : zeta > 1.01 ? "Overdamped" : "Critically Damped";
  const overshootPct = zeta < 1 ? Math.max(0, 100 * Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta))) : 0;
  const settlingTimeSec = zeta > 0 ? Math.min(2.5, 4 / (zeta * wn)) : 2.5;

  const points: SimulationPoint[] = [];
  const steps = 140;
  const tMax = 2.4;
  const x0 = 1.0;
  const v0 = 0.0;

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * tMax;
    let x = 0;
    let v = 0;

    if (zeta < 1) {
      const expTerm = Math.exp(-zeta * wn * t);
      const cosTerm = Math.cos(wd * t);
      const sinTerm = Math.sin(wd * t);
      x = expTerm * (x0 * cosTerm + ((v0 + zeta * wn * x0) / wd) * sinTerm);
      v =
        -zeta * wn * expTerm * (x0 * cosTerm + ((v0 + zeta * wn * x0) / wd) * sinTerm) +
        expTerm * (-x0 * wd * sinTerm + (v0 + zeta * wn * x0) * cosTerm);
    } else {
      const r1 = -zeta * wn + wn * Math.sqrt(Math.max(0, zeta * zeta - 1));
      const r2 = -zeta * wn - wn * Math.sqrt(Math.max(0, zeta * zeta - 1));
      const denom = r1 - r2 === 0 ? 0.001 : r1 - r2;
      const c1 = (v0 - r2 * x0) / denom;
      const c2 = x0 - c1;
      x = c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
      v = c1 * r1 * Math.exp(r1 * t) + c2 * r2 * Math.exp(r2 * t);
    }

    const energy = 0.5 * m * v * v + 0.5 * k * x * x;
    points.push({ t, x, v, energy });
  }

  // Generate SVG path coordinate mapping
  // SVG ViewBox: 0 0 280 140
  // x: 15 to 265 (width = 250)
  // y: mid is 70, amplitude scales to 52px (range -1.0 to +1.0)
  const svgPoints: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const pt = points[i]!;
    const px = 15 + (pt.t / tMax) * 250;
    const py = 70 - Math.max(-1.1, Math.min(1.1, pt.x)) * 52;
    if (i === 0) svgPoints.push(`M ${px.toFixed(1)} ${py.toFixed(1)}`);
    else svgPoints.push(`L ${px.toFixed(1)} ${py.toFixed(1)}`);
  }

  const simulatedTime = Math.round(12 + zeta * 22 + tol * 1.5);
  const iterations = Math.round(36 + tol * 6 + (1 - Math.min(1, zeta)) * 24);

  return {
    points,
    svgPath: svgPoints.join(" "),
    stats: {
      timeMs: simulatedTime,
      iterations,
      singularities: 0,
      zeta,
      wn,
      wd,
      overshootPct,
      settlingTimeSec,
      regime,
    },
  };
}

export function exportWasmParquet(simResult: SimulationResult, dampingVal: string, stiffnessVal: string) {
  const records = simResult.points.map((p) => ({
    time: parseFloat(p.t.toFixed(4)),
    displacement_x: parseFloat(p.x.toFixed(5)),
    velocity_v: parseFloat(p.v.toFixed(5)),
    energy_E: parseFloat(p.energy.toFixed(4)),
    damping_c: parseFloat(dampingVal),
    stiffness_k: parseFloat(stiffnessVal),
  }));
  downloadParquetFile(records, `snes_cosim_trajectory_c${dampingVal}.parquet`, [
    "time",
    "displacement_x",
    "velocity_v",
    "energy_E",
    "damping_c",
    "stiffness_k",
  ]);
}

export function exportWasmModelica(dampingVal: string, stiffnessVal: string) {
  const moCode = `// ModelScript Live WASM Simulation Benchmark Model
model SnesMoldOscillator "Second-Order Co-Simulation Benchmark"
  parameter Real m = 1.0 "System mass (kg)";
  parameter Real c = ${dampingVal} "Damping coefficient (N.s/m)";
  parameter Real k = ${stiffnessVal} "Spring stiffness (N/m)";
  Real x(start = 1.0) "Displacement position (m)";
  Real v(start = 0.0) "Velocity (m/s)";
  Real E "Mechanical total energy (J)";
equation
  der(x) = v;
  m * der(v) + c * v + k * x = 0;
  E = 0.5 * m * v^2 + 0.5 * k * x^2;
end SnesMoldOscillator;
`;
  const blob = new Blob([moCode], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `SnesMoldOscillator_c${dampingVal}.mo`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportMoldParquet(moldSimResult: MoldSimulationResult, meltTempVal: string, injPressureVal: string) {
  const records = moldSimResult.points.map((p) => ({
    time_ms: parseFloat((p.t * 1000).toFixed(1)),
    fill_fraction_alpha: parseFloat(p.alpha.toFixed(4)),
    cavity_pressure_MPa: parseFloat(p.pressure.toFixed(2)),
    melt_front_x_mm: parseFloat(p.frontX.toFixed(2)),
    temperature_C: parseFloat(p.temp.toFixed(1)),
    apparent_viscosity_Pa_s: moldSimResult.stats.apparentViscosity,
    injection_pressure_MPa: parseFloat(injPressureVal),
    melt_temp_C: parseFloat(meltTempVal),
  }));
  downloadParquetFile(records, `snes_mold_injection_trace_T${meltTempVal}_P${injPressureVal}.parquet`, [
    "time_ms",
    "fill_fraction_alpha",
    "cavity_pressure_MPa",
    "melt_front_x_mm",
    "temperature_C",
    "apparent_viscosity_Pa_s",
    "injection_pressure_MPa",
    "melt_temp_C",
  ]);
}

export function exportMoldModelica(meltTempVal: string, injPressureVal: string, gateVelVal: string) {
  const moCode = `// ModelScript Injection Molding Co-Simulation Benchmark Model
// Cavity: SNES Controller ABS Mold Cavity (150mm x 100mm x 20mm)
model SnesMoldCavity "ABS Polymer Cavity Fill & Solidification Dynamics"
  parameter Real meltTemp = ${meltTempVal} "Polymer melt temperature (degC)";
  parameter Real injectionPressure = ${injPressureVal} "Injection pressure (MPa)";
  parameter Real gateVelocity = ${gateVelVal} "Gate inlet flow velocity (m/s)";
  parameter Real cavityLength = 0.150 "Cavity length (m)";
  parameter Real cavityWidth = 0.100 "Cavity width (m)";
  parameter Real cavityHeight = 0.020 "Cavity thickness (m)";
  parameter Real moldTemp = 60.0 "Mold coolant wall temperature (degC)";

  Real alpha(start = 0.0, min = 0.0, max = 1.0) "Cavity fill fraction";
  Real meltFrontX(start = 0.0, min = 0.0, max = 0.150) "Melt front progression (m)";
  Real cavityPressure(start = 0.0) "Dynamic cavity pressure (MPa)";
  Real clampForce "Required machine clamping force (kN)";
  Real polymerTemp "Front average temperature (degC)";

equation
  // Convective melt front advancement
  der(meltFrontX) = if alpha < 1.0 then gateVelocity else 0.0;
  alpha = min(1.0, meltFrontX / cavityLength);

  // Pressure buildup and post-fill packing spike
  cavityPressure = if alpha < 1.0
    then injectionPressure * (meltFrontX / cavityLength)^0.85 * 0.72
    else injectionPressure * 0.92;

  // Clamping force calculation
  clampForce = (cavityPressure * 1e6) * (cavityLength * cavityWidth) / 1000.0;

  // Thermal dissipation to mold steel
  der(polymerTemp) = if alpha < 1.0 then -0.05 * (polymerTemp - moldTemp) else -0.35 * (polymerTemp - moldTemp);
end SnesMoldCavity;
`;
  const blob = new Blob([moCode], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `SnesMoldCavity_T${meltTempVal}_P${injPressureVal}.mo`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
