// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects a USAF Digital DATCOM case and solved 6-DOF linearized stability derivatives
 * into an executable Modelica flight-dynamics model.
 */

import { solveDatcomCase, type SolveDatcomOptions } from "../solver/aero-solver.js";
import type { DatcomCase } from "../types.js";

function sanitizeIdent(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return "DatcomFlightModel";
  return /^[0-9]/.test(cleaned) ? `M_${cleaned}` : cleaned;
}

/**
 * Generates a Modelica 6-DOF linearized longitudinal & lateral flight-dynamics model from a Digital DATCOM case.
 */
export function datcomToModelica(c: DatcomCase, options?: SolveDatcomOptions): string {
  const aero = solveDatcomCase(c, options);
  const modelName = sanitizeIdent(c.caseId || "DatcomFlightModel");
  const lon = aero.longitudinalModes;
  const lat = aero.lateralModes;
  const kInduced = 1.0 / (Math.PI * aero.oswaldEfficiency * aero.aspectRatio);

  return [
    `model ${modelName} "USAF Digital DATCOM 6-DOF linearized flight dynamics (M=${aero.mach.toFixed(2)})"`,
    `  parameter Real g = 9.80665 "Gravitational acceleration (m/s^2)";`,
    `  parameter Real V0 = ${aero.airspeedMS.toFixed(4)} "Trim airspeed (m/s)";`,
    `  parameter Real S_ref = ${aero.SrefM2.toFixed(4)} "Reference wing area (m^2)";`,
    `  parameter Real c_bar = ${aero.cbarM.toFixed(4)} "Mean aerodynamic chord (m)";`,
    `  parameter Real b_ref = ${aero.brefM.toFixed(4)} "Reference wingspan (m)";`,
    `  parameter Real mass = ${aero.massKg.toFixed(2)} "Aircraft mass (kg)";`,
    `  parameter Real CL0 = ${aero.CL0.toFixed(6)} "Zero-AoA lift coefficient";`,
    `  parameter Real CL_alpha = ${aero.CLalphaPerRad.toFixed(6)} "Lift-curve slope (1/rad)";`,
    `  parameter Real CD0 = ${aero.CD0.toFixed(6)} "Zero-lift parasitic drag coefficient";`,
    `  parameter Real k_induced = ${kInduced.toFixed(6)} "Induced drag factor 1/(pi*e*AR)";`,
    `  parameter Real Cm0 = ${aero.Cm0.toFixed(6)} "Zero-AoA pitching moment coefficient";`,
    `  parameter Real Cm_alpha = ${aero.CmalphaPerRad.toFixed(6)} "Pitching moment slope (1/rad)";`,
    `  parameter Real Cmq = ${aero.Cmq.toFixed(6)} "Pitch damping derivative";`,
    `  parameter Real Clp = ${aero.Clp.toFixed(6)} "Roll damping derivative";`,
    `  parameter Real Cnr = ${aero.Cnr.toFixed(6)} "Yaw damping derivative";`,
    `  parameter Real Xu = ${lon.Xu.toFixed(6)};`,
    `  parameter Real Xw = ${lon.Xw.toFixed(6)};`,
    `  parameter Real Zu = ${lon.Zu.toFixed(6)};`,
    `  parameter Real Zw = ${lon.Zw.toFixed(6)};`,
    `  parameter Real Mu = ${lon.Mu.toFixed(6)};`,
    `  parameter Real Mw = ${lon.Mw.toFixed(6)};`,
    `  parameter Real Mq = ${lon.Mq.toFixed(6)};`,
    `  parameter Real Yv = ${lat.Yv.toFixed(6)};`,
    `  parameter Real Lv = ${lat.Lv.toFixed(6)};`,
    `  parameter Real Lp = ${lat.Lp.toFixed(6)};`,
    `  parameter Real Lr = ${lat.Lr.toFixed(6)};`,
    `  parameter Real Nv = ${lat.Nv.toFixed(6)};`,
    `  parameter Real Np = ${lat.Np.toFixed(6)};`,
    `  parameter Real Nr = ${lat.Nr.toFixed(6)};`,
    ``,
    `  Real u(start = 0.0) "Axial velocity perturbation (m/s)";`,
    `  Real w(start = 0.0) "Vertical velocity perturbation (m/s)";`,
    `  Real q(start = 0.0) "Pitch rate (rad/s)";`,
    `  Real theta(start = 0.0) "Pitch attitude perturbation (rad)";`,
    `  Real v(start = 0.0) "Lateral velocity perturbation (m/s)";`,
    `  Real p(start = 0.0) "Roll rate (rad/s)";`,
    `  Real r(start = 0.0) "Yaw rate (rad/s)";`,
    `  Real phi(start = 0.0) "Bank angle perturbation (rad)";`,
    `  Real alpha "Angle of attack perturbation (rad)";`,
    `  Real CL "Lift coefficient";`,
    `  Real CD "Drag coefficient";`,
    `  Real Cm "Pitching moment coefficient";`,
    `equation`,
    `  // Longitudinal linearized state-space dynamics`,
    `  der(u) = Xu * u + Xw * w - g * theta;`,
    `  der(w) = Zu * u + Zw * w + V0 * q;`,
    `  der(q) = Mu * u + Mw * w + Mq * q;`,
    `  der(theta) = q;`,
    `  // Lateral-directional linearized state-space dynamics`,
    `  der(v) = Yv * v - V0 * r + g * phi;`,
    `  der(p) = Lv * v + Lp * p + Lr * r;`,
    `  der(r) = Nv * v + Np * p + Nr * r;`,
    `  der(phi) = p;`,
    `  // Aerodynamic coefficients`,
    `  alpha = w / V0;`,
    `  CL = CL0 + CL_alpha * alpha;`,
    `  CD = CD0 + k_induced * CL * CL;`,
    `  Cm = Cm0 + Cm_alpha * alpha;`,
    `end ${modelName};`,
    ``,
  ].join("\n");
}
