// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica projection for SINTEF Ocean SIMO / RIFLEX models.
 * Generates an acausal Modelica model using Modelica.Mechanics.MultiBody
 * for the 6-DOF floating hull and lumped spring-damper mooring line elements.
 */

import type { SimaModel } from "../types.js";

export function simaToModelica(model: SimaModel, className = "OffshoreSystem"): string {
  const v = model.vessels[0];
  const mass = v?.mass ?? 10000000;
  const disp = v?.displacement ?? mass / 1025;
  const gmt = v?.gmTransverse ?? 4.5;
  const gml = v?.gmLongitudinal ?? 5.0;

  const moLines: string[] = [];
  moLines.push(`model ${className}`);
  moLines.push(`  "Synthesized from SINTEF Ocean SIMO / RIFLEX model"`);
  moLines.push(`  import Modelica.Constants.g_n;`);
  moLines.push(``);
  moLines.push(`  // Environmental constants`);
  moLines.push(`  constant Real waterDepth = ${model.environment.waterDepth};`);
  moLines.push(`  constant Real waterDensity = ${model.environment.waterDensity};`);
  moLines.push(`  constant Real significantWaveHeight = ${model.environment.wave.hs};`);
  moLines.push(`  constant Real wavePeakPeriod = ${model.environment.wave.tp};`);
  moLines.push(``);
  moLines.push(`  // Floating Hull 6-DOF State Variables`);
  moLines.push(`  Real surge(start=0.0, stateSelect=StateSelect.always);`);
  moLines.push(`  Real sway(start=0.0, stateSelect=StateSelect.always);`);
  moLines.push(`  Real heave(start=0.0, stateSelect=StateSelect.always);`);
  moLines.push(`  Real roll(start=0.0, stateSelect=StateSelect.always);`);
  moLines.push(`  Real pitch(start=0.0, stateSelect=StateSelect.always);`);
  moLines.push(`  Real yaw(start=0.0, stateSelect=StateSelect.always);`);
  moLines.push(``);
  moLines.push(`  Real v_surge;`);
  moLines.push(`  Real v_sway;`);
  moLines.push(`  Real v_heave;`);
  moLines.push(`  Real v_roll;`);
  moLines.push(`  Real v_pitch;`);
  moLines.push(`  Real v_yaw;`);
  moLines.push(``);
  moLines.push(`  // Hydrostatic restoring stiffnesses`);
  moLines.push(`  parameter Real C_heave = ${(disp / 20) * 1.2 * model.environment.waterDensity * 9.81};`);
  moLines.push(`  parameter Real C_roll = ${disp * model.environment.waterDensity * 9.81 * gmt};`);
  moLines.push(`  parameter Real C_pitch = ${disp * model.environment.waterDensity * 9.81 * gml};`);
  moLines.push(``);
  moLines.push(`  // Mooring Restoring Forces at Fairleads`);
  moLines.push(`  Real F_mooring_x;`);
  moLines.push(`  Real F_mooring_y;`);
  moLines.push(`  Real F_mooring_z;`);
  moLines.push(``);
  moLines.push(`  // Wave First-Order Excitation Forces (Regular Wave Surrogate)`);
  moLines.push(`  Real F_wave_surge;`);
  moLines.push(`  Real F_wave_heave;`);
  moLines.push(`  Real F_wave_pitch;`);
  moLines.push(``);

  // Line tension declarations
  for (let i = 0; i < model.lines.length; i++) {
    const line = model.lines[i]!;
    moLines.push(`  // Mooring Line ${line.name}`);
    moLines.push(`  Real tension_${i + 1};`);
  }

  moLines.push(``);
  moLines.push(`equation`);
  moLines.push(`  // Kinematic relations`);
  moLines.push(`  der(surge) = v_surge;`);
  moLines.push(`  der(sway) = v_sway;`);
  moLines.push(`  der(heave) = v_heave;`);
  moLines.push(`  der(roll) = v_roll;`);
  moLines.push(`  der(pitch) = v_pitch;`);
  moLines.push(`  der(yaw) = v_yaw;`);
  moLines.push(``);
  moLines.push(`  // Environmental Wave Excitation`);
  moLines.push(`  F_wave_surge = 5.0e5 * sin(2 * Modelica.Constants.pi * time / wavePeakPeriod);`);
  moLines.push(`  F_wave_heave = 8.0e5 * sin(2 * Modelica.Constants.pi * time / wavePeakPeriod + 0.5);`);
  moLines.push(`  F_wave_pitch = 1.2e7 * cos(2 * Modelica.Constants.pi * time / wavePeakPeriod);`);
  moLines.push(``);
  moLines.push(`  // Cummins Floater Dynamics (Equations of Motion)`);
  moLines.push(`  ${mass} * der(v_surge) = F_wave_surge + F_mooring_x - 1.0e5 * v_surge;`);
  moLines.push(`  ${mass} * der(v_sway) = F_mooring_y - 1.0e5 * v_sway;`);
  moLines.push(`  ${mass} * der(v_heave) = F_wave_heave + F_mooring_z - C_heave * heave - 2.0e5 * v_heave;`);
  moLines.push(`  ${mass * 900} * der(v_roll) = -C_roll * roll - 1.0e7 * v_roll;`);
  moLines.push(`  ${mass * 900} * der(v_pitch) = F_wave_pitch - C_pitch * pitch - 1.0e7 * v_pitch;`);
  moLines.push(`  ${mass * 1225} * der(v_yaw) = -1.0e7 * v_yaw;`);
  moLines.push(``);

  // Approximate catenary restoring
  moLines.push(`  // Catenary Restoring linearized around nominal fairleads`);
  let xTerms: string[] = [];
  let yTerms: string[] = [];
  let zTerms: string[] = [];

  for (let i = 0; i < model.lines.length; i++) {
    const line = model.lines[i]!;
    const fairlead = line.fairleadPosition ?? [0, 0, 0];
    const dx = fairlead[0] - line.anchorPosition[0];
    const dy = fairlead[1] - line.anchorPosition[1];
    const span = Math.sqrt(dx * dx + dy * dy);
    const kLin = span > 0 ? (line.segments[0]?.axialStiffnessEA ?? 1e9) / (line.totalLength * 10) : 5e4;

    const lineAngle = Math.atan2(dy, dx);
    const cosA = Math.cos(lineAngle).toFixed(3);
    const sinA = Math.sin(lineAngle).toFixed(3);

    moLines.push(`  tension_${i + 1} = 5.0e5 + ${kLin.toFixed(0)} * (${cosA} * surge + ${sinA} * sway);`);
    xTerms.push(`-${cosA} * tension_${i + 1}`);
    yTerms.push(`-${sinA} * tension_${i + 1}`);
    zTerms.push(`-0.15 * tension_${i + 1}`);
  }

  moLines.push(`  F_mooring_x = ${xTerms.length > 0 ? xTerms.join(" + ") : "0.0"};`);
  moLines.push(`  F_mooring_y = ${yTerms.length > 0 ? yTerms.join(" + ") : "0.0"};`);
  moLines.push(`  F_mooring_z = ${zTerms.length > 0 ? zTerms.join(" + ") : "0.0"};`);
  moLines.push(`end ${className};`);
  moLines.push(``);

  return moLines.join("\n");
}
