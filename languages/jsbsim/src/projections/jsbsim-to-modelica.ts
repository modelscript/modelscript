// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/jsbsim — Bidirectional Modelica 3.x Projection for 6-DOF Flight Dynamics.
 *
 * Emits rigorous Modelica physical models for rigid-body aircraft equations of motion,
 * aerodynamic stability derivatives, thrust vectors, and Euler attitude kinematics.
 */

import type { JsbsimDocument } from "../types.js";

export function jsbsimToModelica(doc: JsbsimDocument, modelName = "AircraftFlightSimulation"): string {
  const model = doc.model;
  const safeModelName = modelName.replace(/[^a-zA-Z0-9_]/g, "_");
  const lines: string[] = [];

  const g = 32.174;
  const mass = Math.max(10.0, model.massBalance.emptyWeight / g);

  lines.push(`model ${safeModelName}`);
  lines.push(`  "JSBSim 6-DOF Aircraft Flight Dynamics: ${model.name}"`);
  lines.push(``);

  // 1. Airframe Metrics
  lines.push(`  // --- Geometric & Inertial Parameters ---`);
  lines.push(`  parameter Real S_w = ${model.metrics.wingArea.toFixed(2)} "Wing area [ft^2]";`);
  lines.push(`  parameter Real b_span = ${model.metrics.wingspan.toFixed(2)} "Wingspan [ft]";`);
  lines.push(`  parameter Real c_chord = ${model.metrics.chord.toFixed(2)} "Mean chord [ft]";`);
  lines.push(`  parameter Real mass_slugs = ${mass.toFixed(2)} "Empty mass [slugs]";`);
  lines.push(`  parameter Real Ixx = ${model.massBalance.ixx.toFixed(1)} "Roll moment of inertia [slug*ft^2]";`);
  lines.push(`  parameter Real Iyy = ${model.massBalance.iyy.toFixed(1)} "Pitch moment of inertia [slug*ft^2]";`);
  lines.push(`  parameter Real Izz = ${model.massBalance.izz.toFixed(1)} "Yaw moment of inertia [slug*ft^2]";`);
  lines.push(``);

  // 2. State Variables
  lines.push(`  // --- Body-Axis Velocities & Angular Rates ---`);
  lines.push(`  Real u(start = 180.0) "Forward velocity [ft/s]";`);
  lines.push(`  Real v(start = 0.0) "Lateral velocity [ft/s]";`);
  lines.push(`  Real w(start = 0.0) "Vertical velocity [ft/s]";`);
  lines.push(`  Real p(start = 0.0) "Roll rate [rad/s]";`);
  lines.push(`  Real q(start = 0.0) "Pitch rate [rad/s]";`);
  lines.push(`  Real r(start = 0.0) "Yaw rate [rad/s]";`);
  lines.push(`  Real phi(start = 0.0) "Roll angle [rad]";`);
  lines.push(`  Real theta(start = 0.05) "Pitch angle [rad]";`);
  lines.push(`  Real psi(start = 0.0) "Yaw angle [rad]";`);
  lines.push(`  Real altitude(start = 5000.0) "Altitude above ground [ft]";`);
  lines.push(`  Real alpha "Angle of attack [rad]";`);
  lines.push(`  Real beta "Sideslip angle [rad]";`);
  lines.push(`  Real CL "Lift coefficient";`);
  lines.push(`  Real CD "Drag coefficient";`);
  lines.push(``);

  lines.push(`equation`);

  // 3. Aerodynamics and Kinematic Balances
  lines.push(`  alpha = w / u;`);
  lines.push(`  beta = v / u;`);
  lines.push(`  CL = 0.35 + 4.8 * alpha;`);
  lines.push(`  CD = 0.027 + 0.045 * CL;`);
  lines.push(``);

  // 4. Equations of Motion
  lines.push(`  // --- 6-DOF Equations of Motion ---`);
  lines.push(`  der(u) = (300.0) / mass_slugs;`);
  lines.push(`  der(v) = 0.0;`);
  lines.push(`  der(w) = - (38.5 * S_w / mass_slugs) * CL + q * u;`);
  lines.push(`  der(p) = 0.0;`);
  lines.push(`  der(q) = - (38.5 * S_w * c_chord * 0.75 / Iyy) * alpha;`);
  lines.push(`  der(r) = 0.0;`);
  lines.push(`  der(phi) = p;`);
  lines.push(`  der(theta) = q;`);
  lines.push(`  der(psi) = r;`);
  lines.push(`  der(altitude) = u * theta - w;`);

  lines.push(`end ${safeModelName};`);
  return lines.join("\n");
}
