// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Easy5 cleanroom component archetype IDs matching `assets/easy5-std-lib/src/models.ts`.
 */
export const Easy5ArchetypeId = {
  // GP — General Purpose
  GP_INTEGRATOR: 1, // IN
  GP_LAG: 2, // LA
  GP_LEAD_LAG: 3, // LL
  GP_GAIN: 4, // GN
  GP_SUMMER: 5, // SJ
  GP_MULTIPLY: 6, // MU
  GP_DIVIDE: 7, // DI
  GP_TRANSFER_FN: 8, // TF
  GP_PID: 9, // PI
  GP_SWITCH: 10, // SW
  GP_LIMITER: 11, // LI
  GP_DEADBAND: 12, // DZ
  GP_TABLE: 13, // TB
  GP_ANALYTIC_FN: 14, // AF
  GP_FUNC_GEN: 15, // FG
  GP_STEP: 16, // ST
  GP_SINE: 17, // SI

  // HC — Thermal Hydraulic
  HC_ORIFICE: 20, // OR
  HC_PIPE: 21, // PI_HC
  HC_ACCUMULATOR: 22, // AC
  HC_PUMP: 23, // PM
  HC_VALVE: 24, // VA
  HC_CHECK_VALVE: 25, // CV
  HC_RELIEF_VALVE: 26, // RV
  HC_CAVITY: 27, // CP

  // GD — Gas Dynamics
  GD_VOLUME: 30, // VO
  GD_ORIFICE: 31, // OR_GD
  GD_VALVE: 32, // VA_GD
  GD_CHAMBER: 33, // CH
  GD_NOZZLE: 34, // NO
  GD_HEAT_EXCHANGER: 35, // HE

  // EC — Electric Systems
  EC_RESISTOR: 40, // RS
  EC_CAPACITOR: 41, // CA
  EC_INDUCTOR: 42, // IN_EC
  EC_VOLTAGE_SOURCE: 43, // VS
  EC_DC_MOTOR: 44, // DC_M
  EC_INDUCTION_MOTOR: 45, // IN_M
  EC_INVERTER: 46, // IV

  // AE — Aerospace
  AE_ATMOSPHERE: 50, // AT
  AE_RIGID_BODY: 51, // RB
  AE_AERODYNAMICS: 52, // AR
  AE_ENGINE: 53, // EN
  AE_ACTUATOR: 54, // AC_AE

  // VC — Multiphase / Vapor Cycle
  VC_EVAPORATOR: 60, // EV
  VC_CONDENSER: 61, // CO
  VC_TXV: 62, // TX
  VC_COMPRESSOR: 63, // CP_VC
} as const;

export type Easy5ArchetypeId = (typeof Easy5ArchetypeId)[keyof typeof Easy5ArchetypeId];

export type Easy5LibraryCode = "gp" | "hc" | "gd" | "ec" | "ae" | "vc";

export type Easy5Category =
  | "General Purpose"
  | "Thermal Hydraulic"
  | "Gas Dynamics"
  | "Electric Systems"
  | "Aerospace"
  | "Multiphase";

export interface Easy5ModelSpec {
  modelType: string;
  library: Easy5LibraryCode;
  aliases?: string[];
  label: string;
  category: Easy5Category;
  domain: string;
  archetypeId: Easy5ArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const LIBRARY_COLORS: Record<Easy5LibraryCode, { fill: string; stroke: string; badge: string }> = {
  gp: { fill: "#1e3a5f", stroke: "#60a5fa", badge: "GP" },
  hc: { fill: "#163b3b", stroke: "#2dd4bf", badge: "HC" },
  gd: { fill: "#2a2b4a", stroke: "#818cf8", badge: "GD" },
  ec: { fill: "#3f2e18", stroke: "#fbbf24", badge: "EC" },
  ae: { fill: "#3b1f47", stroke: "#c084fc", badge: "AE" },
  vc: { fill: "#1e3f2f", stroke: "#34d399", badge: "VC" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an Easy5 component.
 */
export function generateEasy5BlockSvg(modelType: string, library: Easy5LibraryCode): string {
  const c = LIBRARY_COLORS[library];
  const label = modelType.toUpperCase().slice(0, 7);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 48" width="80" height="48">` +
    `<rect x="2" y="2" width="76" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="22" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="17" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="40" y="34" text-anchor="middle" font-family="monospace" font-size="10.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForLibrary(library: Easy5LibraryCode): DiagramPortSpec[] {
  switch (library) {
    case "gp":
      return [
        { name: "IN", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "OUT", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "hc":
      return [
        { name: "P_IN", kind: "fluid", side: "left", dx: 0, dy: 16 },
        { name: "CMD", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "Q_OUT", kind: "fluid", side: "right", dx: 80, dy: 24 },
      ];
    case "gd":
      return [
        { name: "P_UP", kind: "fluid", side: "left", dx: 0, dy: 16 },
        { name: "T_UP", kind: "thermal", side: "left", dx: 0, dy: 34 },
        { name: "MDOT", kind: "fluid", side: "right", dx: 80, dy: 24 },
      ];
    case "ec":
      return [
        { name: "V_IN", kind: "electrical", side: "left", dx: 0, dy: 16 },
        { name: "LOAD", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "I_OUT", kind: "electrical", side: "right", dx: 80, dy: 24 },
      ];
    case "ae":
      return [
        { name: "IN", kind: "signal", side: "left", dx: 0, dy: 16 },
        { name: "CTRL", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "OUT", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "vc":
      return [
        { name: "M_IN", kind: "fluid", side: "left", dx: 0, dy: 16 },
        { name: "Q_EXT", kind: "thermal", side: "left", dx: 0, dy: 34 },
        { name: "H_OUT", kind: "thermal", side: "right", dx: 80, dy: 24 },
      ];
  }
}

export const EASY5_MODEL_SPECS: Easy5ModelSpec[] = [
  // ===========================================================================
  // GP — General Purpose Library (17 models)
  // ===========================================================================
  {
    modelType: "IN",
    library: "gp",
    aliases: ["GP/IN", "gp:in", "integrator"],
    label: "Integrator",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_INTEGRATOR,
    description:
      "Continuous-time integrator with gain, initial state S0, and saturation bounds [LL, UL]: dx/dt = GAIN * u.",
    provenance: "Ogata, Modern Control Engineering, 5th ed., Ch. 2 (Linear Continuous Integrator)",
    params: [
      ["GAIN", 1.0, "1/s", "Integration gain"],
      ["S0", 0.0, "", "Initial state"],
      ["UL", 1e9, "", "Upper state limit"],
      ["LL", -1e9, "", "Lower state limit"],
    ],
  },
  {
    modelType: "LA",
    library: "gp",
    aliases: ["GP/LA", "gp:la", "lag"],
    label: "First-Order Lag",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_LAG,
    description: "First-order low-pass lag filter: H(s) = GAIN / (1 + TAU * s).",
    provenance: "Franklin, Powell & Emami-Naeini, Feedback Control of Dynamic Systems, 8th ed., Ch. 3",
    params: [
      ["GAIN", 1.0, "", "Steady-state DC gain"],
      ["TAU", 1.0, "s", "Lag time constant"],
      ["S0", 0.0, "", "Initial state"],
    ],
  },
  {
    modelType: "LL",
    library: "gp",
    aliases: ["GP/LL", "gp:ll", "leadlag"],
    label: "Lead-Lag Compensator",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_LEAD_LAG,
    description: "First-order lead-lag compensator: H(s) = GAIN * (1 + TAU1 * s) / (1 + TAU2 * s).",
    provenance: "Ogata, Modern Control Engineering, 5th ed., Ch. 6 (Lead-Lag Compensation)",
    params: [
      ["GAIN", 1.0, "", "DC gain"],
      ["TAU1", 0.5, "s", "Lead time constant"],
      ["TAU2", 1.0, "s", "Lag time constant"],
      ["S0", 0.0, "", "Initial state"],
    ],
  },
  {
    modelType: "GN",
    library: "gp",
    aliases: ["GP/GN", "GA", "GP/GA", "gain"],
    label: "Scalar Gain",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_GAIN,
    description: "Multiplies input signal by scalar gain K with optional bias B: y = K * u + B.",
    provenance: "Ogata, Modern Control Engineering, 5th ed., Ch. 2 (Proportional Block)",
    params: [
      ["K", 1.0, "", "Proportional gain"],
      ["BIAS", 0.0, "", "Additive output bias"],
    ],
  },
  {
    modelType: "SJ",
    library: "gp",
    aliases: ["GP/SJ", "summer", "sum"],
    label: "Summing Junction",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_SUMMER,
    description: "Weighted algebraic summation of up to 4 inputs: y = sum(K_i * u_i).",
    provenance: "Franklin, Powell & Emami-Naeini, Feedback Control of Dynamic Systems, Ch. 3",
    params: [
      ["K1", 1.0, "", "Weight for input 1"],
      ["K2", 1.0, "", "Weight for input 2"],
      ["K3", 0.0, "", "Weight for input 3"],
      ["K4", 0.0, "", "Weight for input 4"],
    ],
  },
  {
    modelType: "MU",
    library: "gp",
    aliases: ["GP/MU", "multiply", "product"],
    label: "Multiplier",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_MULTIPLY,
    description: "Computes scaled product of two input signals: y = K * u0 * u1.",
    provenance: "Standard Signal-Flow Algebra (IEC 61131-3 / Block Diagram Calculus)",
    params: [["K", 1.0, "", "Scale factor"]],
  },
  {
    modelType: "DI",
    library: "gp",
    aliases: ["GP/DI", "divide"],
    label: "Divider",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_DIVIDE,
    description: "Protected quotient of two signals: y = K * u0 / u1 with denominator floor EPS.",
    provenance: "Standard Signal-Flow Algebra (Protected Division)",
    params: [
      ["K", 1.0, "", "Scale factor"],
      ["EPS", 1e-9, "", "Minimum denominator magnitude"],
    ],
  },
  {
    modelType: "TF",
    library: "gp",
    aliases: ["GP/TF", "transfer_function"],
    label: "Second-Order Transfer Function",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_TRANSFER_FN,
    description: "Standard second-order rational transfer function: H(s) = K * wn^2 / (s^2 + 2*zeta*wn*s + wn^2).",
    provenance: "Ogata, Modern Control Engineering, 5th ed., Ch. 5 (Second-Order Systems)",
    params: [
      ["K", 1.0, "", "DC gain"],
      ["WN", 10.0, "rad/s", "Natural frequency"],
      ["ZETA", 0.707, "", "Damping ratio"],
      ["X0", 0.0, "", "Initial output state"],
    ],
  },
  {
    modelType: "PI",
    library: "gp",
    aliases: ["GP/PI", "pid"],
    label: "PID Controller",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_PID,
    description: "Proportional-Integral-Derivative controller with filtered derivative and anti-windup limits.",
    provenance: "Åström & Hägglund, Advanced PID Control, ISA, 2006, Ch. 3",
    params: [
      ["KP", 1.0, "", "Proportional gain"],
      ["KI", 0.5, "1/s", "Integral gain"],
      ["KD", 0.0, "s", "Derivative gain"],
      ["TF", 0.05, "s", "Derivative filter time constant"],
      ["UL", 1e6, "", "Upper output limit"],
      ["LL", -1e6, "", "Lower output limit"],
    ],
  },
  {
    modelType: "SW",
    library: "gp",
    aliases: ["GP/SW", "switch"],
    label: "Signal Switch",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_SWITCH,
    description: "Routes u0 when control signal u2 >= THRESHOLD, otherwise routes u1.",
    provenance: "Standard Hybrid Signal Routing (IEEE / IEC Control Block Algebra)",
    params: [["THRESHOLD", 0.0, "", "Switching threshold"]],
  },
  {
    modelType: "LI",
    library: "gp",
    aliases: ["GP/LI", "LM", "GP/LM", "limiter", "saturation"],
    label: "Hard Limiter",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_LIMITER,
    description: "Clamps input signal within [LL, UL]: y = clamp(u0, LL, UL).",
    provenance: "Slotine & Li, Applied Nonlinear Control, Prentice-Hall, 1991, Ch. 1",
    params: [
      ["UL", 1.0, "", "Upper saturation limit"],
      ["LL", -1.0, "", "Lower saturation limit"],
    ],
  },
  {
    modelType: "DZ",
    library: "gp",
    aliases: ["GP/DZ", "deadband", "deadzone"],
    label: "Deadband",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_DEADBAND,
    description: "Suppresses output to zero inside [DBN, DBP] with linear unity slope outside.",
    provenance: "Slotine & Li, Applied Nonlinear Control, Prentice-Hall, 1991, Ch. 1",
    params: [
      ["DBP", 0.1, "", "Positive deadband threshold"],
      ["DBN", -0.1, "", "Negative deadband threshold"],
      ["SLOPE", 1.0, "", "Slope outside deadband"],
    ],
  },
  {
    modelType: "TB",
    library: "gp",
    aliases: ["GP/TB", "FN", "GP/FN", "table"],
    label: "1D Table Lookup",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_TABLE,
    description: "Piecewise-linear 1D interpolation lookup table over breakpoint pairs (X0..X3, Y0..Y3).",
    provenance: "Press et al., Numerical Recipes, 3rd ed., Ch. 3 (Piecewise Linear Interpolation)",
    params: [
      ["X0", 0.0, "", "Breakpoint 0 abscissa"],
      ["X1", 1.0, "", "Breakpoint 1 abscissa"],
      ["Y0", 0.0, "", "Breakpoint 0 ordinate"],
      ["Y1", 1.0, "", "Breakpoint 1 ordinate"],
    ],
  },
  {
    modelType: "AF",
    library: "gp",
    aliases: ["GP/AF", "analytic"],
    label: "Analytic Function",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_ANALYTIC_FN,
    description: "Evaluates polynomial/power analytic expression: y = C0 + C1*u + C2*u^2 + C3*u^3.",
    provenance: "Abramowitz & Stegun, Handbook of Mathematical Functions, NBS, 1964",
    params: [
      ["C0", 0.0, "", "Constant term"],
      ["C1", 1.0, "", "Linear coefficient"],
      ["C2", 0.0, "", "Quadratic coefficient"],
      ["C3", 0.0, "", "Cubic coefficient"],
    ],
  },
  {
    modelType: "FG",
    library: "gp",
    aliases: ["GP/FG", "ramp"],
    label: "Function Generator (Ramp/Pulse)",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_FUNC_GEN,
    description: "Generates time-varying ramp signal starting at T0 with slope SLOPE clamped to MAX_VAL.",
    provenance: "Ogata, Modern Control Engineering, 5th ed., Ch. 5 (Standard Test Signals)",
    params: [
      ["T0", 0.0, "s", "Ramp start time"],
      ["SLOPE", 1.0, "1/s", "Ramp slope"],
      ["BIAS", 0.0, "", "Initial offset"],
      ["MAX_VAL", 1e9, "", "Upper clamp"],
    ],
  },
  {
    modelType: "ST",
    library: "gp",
    aliases: ["GP/ST", "step"],
    label: "Step Source",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_STEP,
    description: "Heaviside step source transitioning from V0 to V1 at t = T_STEP.",
    provenance: "Ogata, Modern Control Engineering, 5th ed., Ch. 5 (Unit Step Excitation)",
    params: [
      ["T_STEP", 0.0, "s", "Step time"],
      ["V0", 0.0, "", "Initial value"],
      ["V1", 1.0, "", "Final value"],
    ],
  },
  {
    modelType: "SI",
    library: "gp",
    aliases: ["GP/SI", "sine"],
    label: "Sinusoidal Source",
    category: "General Purpose",
    domain: "control",
    archetypeId: Easy5ArchetypeId.GP_SINE,
    description: "Harmonic excitation generator: y(t) = BIAS + AMP * sin(OMEGA * t + PHASE).",
    provenance: "Ogata, Modern Control Engineering, 5th ed., Ch. 7 (Frequency Response Excitation)",
    params: [
      ["AMP", 1.0, "", "Amplitude"],
      ["OMEGA", 6.283185307, "rad/s", "Angular frequency"],
      ["PHASE", 0.0, "rad", "Phase offset"],
      ["BIAS", 0.0, "", "DC bias"],
    ],
  },

  // ===========================================================================
  // HC — Thermal Hydraulic Library (8 models)
  // ===========================================================================
  {
    modelType: "OR",
    library: "hc",
    aliases: ["HC/OR", "hc:or", "hydraulic_orifice"],
    label: "Hydraulic Orifice",
    category: "Thermal Hydraulic",
    domain: "hydraulic",
    archetypeId: Easy5ArchetypeId.HC_ORIFICE,
    description: "Sharp-edged turbulent orifice: Q = Cd * A * sign(dP) * sqrt(2 * |dP| / rho).",
    provenance: "Merritt, Hydraulic Control Systems, Wiley, 1967, Eq. (3-5) (Turbulent Orifice Flow)",
    params: [
      ["CD", 0.61, "", "Discharge coefficient"],
      ["AREA", 1e-4, "m^2", "Orifice flow area"],
      ["RHO", 850.0, "kg/m^3", "Hydraulic fluid density"],
      ["DP_LIN", 1e3, "Pa", "Laminar-turbulent regularization threshold"],
    ],
  },
  {
    modelType: "PI_HC",
    library: "hc",
    aliases: ["HC/PI", "HC/PI_HC", "hydraulic_pipe"],
    label: "Hydraulic Pipe (Lumped Inertance & Resistance)",
    category: "Thermal Hydraulic",
    domain: "hydraulic",
    archetypeId: Easy5ArchetypeId.HC_PIPE,
    description: "Lumped fluid inertance and Darcy-Weisbach friction line: L_f * dQ/dt = (P_in - P_out) - R_f * Q.",
    provenance: "Merritt, Hydraulic Control Systems, Wiley, 1967, Ch. 5 (Transmission Line Dynamics)",
    params: [
      ["LENGTH", 2.0, "m", "Pipe length"],
      ["DIAM", 0.02, "m", "Internal pipe diameter"],
      ["RHO", 850.0, "kg/m^3", "Fluid density"],
      ["RF", 1e7, "Pa*s/m^3", "Linearized hydraulic resistance"],
    ],
  },
  {
    modelType: "AC",
    library: "hc",
    aliases: ["HC/AC", "accumulator"],
    label: "Gas-Charged Hydraulic Accumulator",
    category: "Thermal Hydraulic",
    domain: "hydraulic",
    archetypeId: Easy5ArchetypeId.HC_ACCUMULATOR,
    description: "Polytropic gas-charged hydraulic accumulator: dP/dt = (beta / V0) * (Q_in - Q_out).",
    provenance: "Merritt, Hydraulic Control Systems, Wiley, 1967, Ch. 2 (Fluid Compressibility & Accumulators)",
    params: [
      ["V0", 0.005, "m^3", "Nominal fluid/gas volume"],
      ["BETA", 1.4e9, "Pa", "Effective bulk modulus"],
      ["P0", 1e7, "Pa", "Initial precharge pressure"],
      ["GAMMA", 1.4, "", "Polytropic gas exponent"],
    ],
  },
  {
    modelType: "PM",
    library: "hc",
    aliases: ["HC/PM", "pump"],
    label: "Positive-Displacement Hydraulic Pump",
    category: "Thermal Hydraulic",
    domain: "hydraulic",
    archetypeId: Easy5ArchetypeId.HC_PUMP,
    description: "Fixed-displacement pump with volumetric leakage slip: Q = D * omega - C_leak * dP.",
    provenance: "Merritt, Hydraulic Control Systems, Wiley, 1967, Ch. 4 (Pump Flow Continuity)",
    params: [
      ["DISP", 5e-6, "m^3/rad", "Volumetric displacement per radian"],
      ["CLEAK", 1e-12, "m^3/(s*Pa)", "Internal leakage conductance"],
      ["ETA_M", 0.92, "", "Mechanical efficiency"],
    ],
  },
  {
    modelType: "VA",
    library: "hc",
    aliases: ["HC/VA", "control_valve"],
    label: "Proportional Control Valve",
    category: "Thermal Hydraulic",
    domain: "hydraulic",
    archetypeId: Easy5ArchetypeId.HC_VALVE,
    description:
      "Variable-area proportional spool valve governed by turbulent orifice flow scaled by opening x in [0, 1].",
    provenance: "Merritt, Hydraulic Control Systems, Wiley, 1967, Ch. 4 (Spool Valve Flow Equation)",
    params: [
      ["CD", 0.62, "", "Discharge coefficient"],
      ["AREA_MAX", 2e-4, "m^2", "Maximum orifice area at full stroke"],
      ["RHO", 850.0, "kg/m^3", "Fluid density"],
      ["TAU_V", 0.02, "s", "Spool actuation lag time constant"],
    ],
  },
  {
    modelType: "CV",
    library: "hc",
    aliases: ["HC/CV", "check_valve"],
    label: "Hydraulic Check Valve",
    category: "Thermal Hydraulic",
    domain: "hydraulic",
    archetypeId: Easy5ArchetypeId.HC_CHECK_VALVE,
    description: "Unidirectional spring-loaded check valve opening above cracking pressure P_CRACK.",
    provenance: "Watton, Fluid Power Systems, Prentice-Hall, 1989, Ch. 3 (Check Valve Dynamics)",
    params: [
      ["CD", 0.65, "", "Discharge coefficient"],
      ["AREA", 1.5e-4, "m^2", "Fully open flow area"],
      ["RHO", 850.0, "kg/m^3", "Fluid density"],
      ["P_CRACK", 5e4, "Pa", "Cracking pressure differential"],
    ],
  },
  {
    modelType: "RV",
    library: "hc",
    aliases: ["HC/RV", "relief_valve"],
    label: "Pressure Relief Valve",
    category: "Thermal Hydraulic",
    domain: "hydraulic",
    archetypeId: Easy5ArchetypeId.HC_RELIEF_VALVE,
    description: "Direct-acting pressure relief valve discharging excess flow when P_in - P_out > P_SET.",
    provenance: "Merritt, Hydraulic Control Systems, Wiley, 1967, Ch. 9 (Relief Valve Stability)",
    params: [
      ["P_SET", 2e7, "Pa", "Relief cracking pressure"],
      ["P_FULL", 2.2e7, "Pa", "Full-open pressure"],
      ["CD", 0.65, "", "Discharge coefficient"],
      ["AREA_MAX", 2e-4, "m^2", "Maximum relief area"],
      ["RHO", 850.0, "kg/m^3", "Fluid density"],
    ],
  },
  {
    modelType: "CP",
    library: "hc",
    aliases: ["HC/CP", "hydraulic_cavity", "chamber_hc"],
    label: "Compressible Hydraulic Cavity",
    category: "Thermal Hydraulic",
    domain: "hydraulic",
    archetypeId: Easy5ArchetypeId.HC_CAVITY,
    description:
      "Lumped hydraulic control volume integrating pressure via continuity: dP/dt = (BETA / VOL) * (Q_in - Q_out).",
    provenance: "Merritt, Hydraulic Control Systems, Wiley, 1967, Eq. (2-14) (Continuity in Control Volume)",
    params: [
      ["VOL", 0.002, "m^3", "Control volume"],
      ["BETA", 1.4e9, "Pa", "Fluid bulk modulus"],
      ["P0", 1e6, "Pa", "Initial pressure"],
    ],
  },

  // ===========================================================================
  // GD — Gas Dynamics Library (6 models)
  // ===========================================================================
  {
    modelType: "VO",
    library: "gd",
    aliases: ["GD/VO", "gas_volume"],
    label: "Compressible Gas Volume",
    category: "Gas Dynamics",
    domain: "pneumatic",
    archetypeId: Easy5ArchetypeId.GD_VOLUME,
    description:
      "Ideal-gas control volume integrating pressure and temperature from net mass flow: dP/dt = (gamma*R*T/V) * (mDot_in - mDot_out).",
    provenance: "Shapiro, The Dynamics and Thermodynamics of Compressible Fluid Flow, Vol. 1, Wiley, 1953",
    params: [
      ["VOL", 0.05, "m^3", "Volume"],
      ["R_GAS", 287.05, "J/(kg*K)", "Specific gas constant"],
      ["GAMMA", 1.4, "", "Specific heat ratio"],
      ["P0", 101325.0, "Pa", "Initial pressure"],
      ["T0", 293.15, "K", "Initial gas temperature"],
    ],
  },
  {
    modelType: "OR_GD",
    library: "gd",
    aliases: ["GD/OR", "GD/OR_GD", "gas_orifice"],
    label: "Compressible Gas Orifice",
    category: "Gas Dynamics",
    domain: "pneumatic",
    archetypeId: Easy5ArchetypeId.GD_ORIFICE,
    description: "Isentropic compressible orifice flow with automatic choked/subsonic regime switching.",
    provenance: "Shapiro, Compressible Fluid Flow, Vol. 1, Ch. 4 (Isentropic Orifice Mass Flow)",
    params: [
      ["CD", 0.85, "", "Discharge coefficient"],
      ["AREA", 1e-4, "m^2", "Throat area"],
      ["GAMMA", 1.4, "", "Specific heat ratio"],
      ["R_GAS", 287.05, "J/(kg*K)", "Specific gas constant"],
      ["T_UP", 300.0, "K", "Default upstream stagnation temperature"],
    ],
  },
  {
    modelType: "VA_GD",
    library: "gd",
    aliases: ["GD/VA", "GD/VA_GD", "gas_valve"],
    label: "Compressible Gas Control Valve",
    category: "Gas Dynamics",
    domain: "pneumatic",
    archetypeId: Easy5ArchetypeId.GD_VALVE,
    description:
      "Modulated pneumatic/gas valve combining compressible choked/subsonic flow with normalized command opening.",
    provenance: "ISO 6358 / Shapiro, Compressible Fluid Flow, Vol. 1, Ch. 4",
    params: [
      ["CD", 0.82, "", "Discharge coefficient"],
      ["AREA_MAX", 2e-4, "m^2", "Maximum valve throat area"],
      ["GAMMA", 1.4, "", "Specific heat ratio"],
      ["R_GAS", 287.05, "J/(kg*K)", "Specific gas constant"],
      ["T_UP", 300.0, "K", "Default upstream temperature"],
    ],
  },
  {
    modelType: "CH",
    library: "gd",
    aliases: ["GD/CH", "gas_chamber"],
    label: "Thermal-Pneumatic Chamber",
    category: "Gas Dynamics",
    domain: "pneumatic",
    archetypeId: Easy5ArchetypeId.GD_CHAMBER,
    description: "Variable-energy ideal gas chamber with convective wall heat transfer and pressure integration.",
    provenance: "Anderson, Modern Compressible Flow, 3rd ed., McGraw-Hill, 2003, Ch. 2",
    params: [
      ["VOL", 0.1, "m^3", "Chamber volume"],
      ["R_GAS", 287.05, "J/(kg*K)", "Specific gas constant"],
      ["GAMMA", 1.4, "", "Specific heat ratio"],
      ["P0", 200000.0, "Pa", "Initial pressure"],
      ["T0", 300.0, "K", "Initial temperature"],
      ["TAU_TH", 5.0, "s", "Wall thermal relaxation time constant"],
    ],
  },
  {
    modelType: "NO",
    library: "gd",
    aliases: ["GD/NO", "nozzle"],
    label: "Converging-Diverging Nozzle",
    category: "Gas Dynamics",
    domain: "pneumatic",
    archetypeId: Easy5ArchetypeId.GD_NOZZLE,
    description: "Isentropic converging-diverging nozzle computing choked/subsonic mass flow and exit Mach estimate.",
    provenance: "Anderson, Modern Compressible Flow, 3rd ed., Ch. 5 (Quasi-One-Dimensional Nozzle Flow)",
    params: [
      ["CD", 0.96, "", "Nozzle discharge coefficient"],
      ["A_THROAT", 5e-4, "m^2", "Throat area"],
      ["GAMMA", 1.4, "", "Specific heat ratio"],
      ["R_GAS", 287.05, "J/(kg*K)", "Specific gas constant"],
      ["T_UP", 600.0, "K", "Default stagnation temperature"],
    ],
  },
  {
    modelType: "HE",
    library: "gd",
    aliases: ["GD/HE", "heat_exchanger"],
    label: "Gas Heat Exchanger",
    category: "Gas Dynamics",
    domain: "thermal",
    archetypeId: Easy5ArchetypeId.GD_HEAT_EXCHANGER,
    description: "Lumped effectiveness-NTU first-order thermal heat exchanger: tau * dT_out/dt = T_eq - T_out.",
    provenance: "Incropera & DeWitt, Fundamentals of Heat and Mass Transfer, 7th ed., Ch. 11 (Effectiveness-NTU)",
    params: [
      ["EPSILON", 0.75, "", "Thermal effectiveness"],
      ["TAU", 2.0, "s", "Thermal inertia time constant"],
      ["T0", 300.0, "K", "Initial outlet temperature"],
    ],
  },

  // ===========================================================================
  // EC — Electric Systems Library (7 models)
  // ===========================================================================
  {
    modelType: "RS",
    library: "ec",
    aliases: ["EC/RS", "resistor"],
    label: "Linear Resistor",
    category: "Electric Systems",
    domain: "electrical",
    archetypeId: Easy5ArchetypeId.EC_RESISTOR,
    description: "Ohm's law resistive branch: I = (V_pos - V_neg) / R, P = I^2 * R.",
    provenance: "Alexander & Sadiku, Fundamentals of Electric Circuits, 6th ed., Ch. 2",
    params: [["R", 10.0, "Ohm", "Resistance"]],
  },
  {
    modelType: "CA",
    library: "ec",
    aliases: ["EC/CA", "capacitor"],
    label: "Linear Capacitor",
    category: "Electric Systems",
    domain: "electrical",
    archetypeId: Easy5ArchetypeId.EC_CAPACITOR,
    description: "Dynamic capacitor voltage integration: C * dV/dt = I_in - V / R_leak.",
    provenance: "Alexander & Sadiku, Fundamentals of Electric Circuits, 6th ed., Ch. 6",
    params: [
      ["C", 1e-3, "F", "Capacitance"],
      ["V0", 0.0, "V", "Initial capacitor voltage"],
      ["R_LEAK", 1e9, "Ohm", "Parallel leakage resistance"],
    ],
  },
  {
    modelType: "IN_EC",
    library: "ec",
    aliases: ["EC/IN", "EC/IN_EC", "inductor"],
    label: "Linear Inductor",
    category: "Electric Systems",
    domain: "electrical",
    archetypeId: Easy5ArchetypeId.EC_INDUCTOR,
    description: "Dynamic inductor current integration with winding resistance: L * dI/dt = V_in - R * I.",
    provenance: "Alexander & Sadiku, Fundamentals of Electric Circuits, 6th ed., Ch. 6",
    params: [
      ["L", 0.01, "H", "Inductance"],
      ["R", 0.1, "Ohm", "Series winding resistance"],
      ["I0", 0.0, "A", "Initial inductor current"],
    ],
  },
  {
    modelType: "VS",
    library: "ec",
    aliases: ["EC/VS", "voltage_source"],
    label: "Controlled Voltage Source",
    category: "Electric Systems",
    domain: "electrical",
    archetypeId: Easy5ArchetypeId.EC_VOLTAGE_SOURCE,
    description: "DC/AC controlled voltage source with internal series impedance R_s.",
    provenance: "Alexander & Sadiku, Fundamentals of Electric Circuits, 6th ed., Ch. 4",
    params: [
      ["V_NOM", 28.0, "V", "Nominal source voltage"],
      ["R_S", 0.05, "Ohm", "Internal source resistance"],
      ["AMP_AC", 0.0, "V", "Optional AC ripple amplitude"],
      ["OMEGA", 376.991118, "rad/s", "AC angular frequency"],
    ],
  },
  {
    modelType: "DC_M",
    library: "ec",
    aliases: ["EC/DC_M", "dc_motor"],
    label: "Permanent-Magnet DC Motor",
    category: "Electric Systems",
    domain: "electrical",
    archetypeId: Easy5ArchetypeId.EC_DC_MOTOR,
    description: "Coupled armature-rotor DC machine: L*di/dt = V - R*i - Ke*w; J*dw/dt = Kt*i - B*w - T_load.",
    provenance: "Krause, Wasynczuk & Sudhoff, Analysis of Electric Machinery and Drive Systems, 3rd ed., Ch. 2",
    params: [
      ["R_A", 1.0, "Ohm", "Armature resistance"],
      ["L_A", 0.01, "H", "Armature inductance"],
      ["K_T", 0.1, "N*m/A", "Torque constant"],
      ["K_E", 0.1, "V*s/rad", "Back-EMF constant"],
      ["J", 0.002, "kg*m^2", "Rotor inertia"],
      ["B", 0.001, "N*m*s/rad", "Viscous friction"],
    ],
  },
  {
    modelType: "IN_M",
    library: "ec",
    aliases: ["EC/IN_M", "induction_motor"],
    label: "Three-Phase Induction Motor",
    category: "Electric Systems",
    domain: "electrical",
    archetypeId: Easy5ArchetypeId.EC_INDUCTION_MOTOR,
    description: "Equivalent-circuit slip-torque induction machine with mechanical rotor inertia dynamics.",
    provenance: "Krause, Wasynczuk & Sudhoff, Analysis of Electric Machinery and Drive Systems, 3rd ed., Ch. 6",
    params: [
      ["OMEGA_SYNC", 188.495559, "rad/s", "Synchronous angular speed"],
      ["T_MAX", 50.0, "N*m", "Breakdown torque at rated voltage"],
      ["S_MAX", 0.15, "", "Slip at breakdown torque"],
      ["J", 0.05, "kg*m^2", "Rotor inertia"],
      ["B", 0.01, "N*m*s/rad", "Viscous damping"],
    ],
  },
  {
    modelType: "IV",
    library: "ec",
    aliases: ["EC/IV", "inverter"],
    label: "Power Electronic Inverter",
    category: "Electric Systems",
    domain: "electrical",
    archetypeId: Easy5ArchetypeId.EC_INVERTER,
    description: "Averaged PWM inverter bridge with first-order switching filter and efficiency loss.",
    provenance: "Mohan, Undeland & Robbins, Power Electronics, 3rd ed., Wiley, 2003, Ch. 8",
    params: [
      ["ETA", 0.96, "", "Conversion efficiency"],
      ["TAU", 0.002, "s", "Output filter time constant"],
      ["V_MAX", 600.0, "V", "Maximum AC output voltage"],
    ],
  },

  // ===========================================================================
  // AE — Aerospace Library (5 models)
  // ===========================================================================
  {
    modelType: "AT",
    library: "ae",
    aliases: ["AE/AT", "ae:at", "atmosphere", "isa"],
    label: "US Standard Atmosphere (ISA 1976)",
    category: "Aerospace",
    domain: "aerospace",
    archetypeId: Easy5ArchetypeId.AE_ATMOSPHERE,
    description:
      "Computes ISA 1976 / ISO 2533 air density (rho), static pressure (P), temperature (T), and speed of sound (a) from geometric altitude h (m).",
    provenance: "U.S. Standard Atmosphere, 1976 (NOAA/NASA/USAF) & ISO 2533:1975",
    params: [
      ["T0", 288.15, "K", "Sea-level standard temperature"],
      ["P0", 101325.0, "Pa", "Sea-level standard pressure"],
      ["LAPSE", 0.0065, "K/m", "Tropospheric temperature lapse rate"],
      ["DELTA_T", 0.0, "K", "Non-standard ISA temperature offset"],
    ],
  },
  {
    modelType: "RB",
    library: "ae",
    aliases: ["AE/RB", "rigid_body"],
    label: "Rigid Body Translational/Rotational Dynamics",
    category: "Aerospace",
    domain: "aerospace",
    archetypeId: Easy5ArchetypeId.AE_RIGID_BODY,
    description: "Newton-Euler rigid body point-mass & pitch-axis dynamics: m*dv/dt = F - c*v, I*dq/dt = M.",
    provenance: "Stevens & Lewis, Aircraft Control and Simulation, 3rd ed., Wiley, 2015, Ch. 1",
    params: [
      ["MASS", 1000.0, "kg", "Vehicle mass"],
      ["IYY", 2500.0, "kg*m^2", "Pitch moment of inertia"],
      ["V0", 0.0, "m/s", "Initial velocity"],
      ["X0", 0.0, "m", "Initial position"],
    ],
  },
  {
    modelType: "AR",
    library: "ae",
    aliases: ["AE/AR", "aerodynamics"],
    label: "Aerodynamic Forces & Moments",
    category: "Aerospace",
    domain: "aerospace",
    archetypeId: Easy5ArchetypeId.AE_AERODYNAMICS,
    description:
      "Computes dynamic pressure q = 0.5*rho*V^2, lift L = q*S*(CL0 + CLa*alpha), and parabolic drag D = q*S*(CD0 + K*CL^2).",
    provenance: "Stevens & Lewis, Aircraft Control and Simulation, 3rd ed., Ch. 2 (Aerodynamic Coefficients)",
    params: [
      ["S_REF", 16.2, "m^2", "Reference wing area"],
      ["CL0", 0.25, "", "Zero-alpha lift coefficient"],
      ["CL_ALPHA", 5.2, "1/rad", "Lift curve slope"],
      ["CD0", 0.025, "", "Zero-lift drag coefficient"],
      ["K_IND", 0.045, "", "Induced drag factor"],
    ],
  },
  {
    modelType: "EN",
    library: "ae",
    aliases: ["AE/EN", "engine", "propulsion"],
    label: "Turbine / Propulsion Engine",
    category: "Aerospace",
    domain: "aerospace",
    archetypeId: Easy5ArchetypeId.AE_ENGINE,
    description:
      "First-order spool thrust lag with altitude density lapse: tau * dT/dt = T_max*(rho/rho0)*throttle - T.",
    provenance: "Mattingly, Elements of Propulsion: Gas Turbines and Rockets, AIAA, 2006, Ch. 4",
    params: [
      ["T_MAX", 50000.0, "N", "Sea-level static maximum thrust"],
      ["TAU_E", 0.8, "s", "Spool acceleration time constant"],
      ["SFC", 2e-5, "kg/(N*s)", "Thrust specific fuel consumption"],
      ["T_INIT", 0.0, "N", "Initial thrust"],
    ],
  },
  {
    modelType: "AC_AE",
    library: "ae",
    aliases: ["AE/AC", "AE/AC_AE", "flight_actuator"],
    label: "Flight Control Surface Actuator",
    category: "Aerospace",
    domain: "aerospace",
    archetypeId: Easy5ArchetypeId.AE_ACTUATOR,
    description: "Rate- and position-limited first-order electro-hydraulic flight control servo actuator.",
    provenance: "Stevens & Lewis, Aircraft Control and Simulation, 3rd ed., Ch. 4 (Actuator Models)",
    params: [
      ["TAU", 0.05, "s", "Actuator servo time constant"],
      ["RATE_LIM", 1.0, "rad/s", "Maximum deflection rate limit"],
      ["POS_MAX", 0.45, "rad", "Maximum positive deflection"],
      ["POS_MIN", -0.45, "rad", "Maximum negative deflection"],
    ],
  },

  // ===========================================================================
  // VC — Multiphase / Vapor Cycle Library (4 models)
  // ===========================================================================
  {
    modelType: "EV",
    library: "vc",
    aliases: ["VC/EV", "evaporator"],
    label: "Two-Phase Evaporator",
    category: "Multiphase",
    domain: "thermal",
    archetypeId: Easy5ArchetypeId.VC_EVAPORATOR,
    description: "Lumped vapor-compression evaporator enthalpy & temperature dynamics with convective heat load.",
    provenance: "ASHRAE Handbook — Refrigeration, Ch. 2 (Vapor-Compression Cycle Evaporator)",
    params: [
      ["UA", 450.0, "W/K", "Overall heat transfer conductance"],
      ["TAU", 4.0, "s", "Thermal capacitance time constant"],
      ["T_SAT", 275.0, "K", "Nominal saturation temperature"],
      ["H_FG", 200000.0, "J/kg", "Latent heat of vaporization"],
    ],
  },
  {
    modelType: "CO",
    library: "vc",
    aliases: ["VC/CO", "condenser"],
    label: "Two-Phase Condenser",
    category: "Multiphase",
    domain: "thermal",
    archetypeId: Easy5ArchetypeId.VC_CONDENSER,
    description: "Lumped vapor-compression condenser rejecting heat to ambient sink via first-order thermal dynamics.",
    provenance: "ASHRAE Handbook — Refrigeration, Ch. 2 (Vapor-Compression Cycle Condenser)",
    params: [
      ["UA", 550.0, "W/K", "Overall heat transfer conductance"],
      ["TAU", 5.0, "s", "Thermal capacitance time constant"],
      ["T_AMB", 308.15, "K", "Ambient sink temperature"],
      ["T0", 318.15, "K", "Initial condenser temperature"],
    ],
  },
  {
    modelType: "TX",
    library: "vc",
    aliases: ["VC/TX", "txv", "expansion_valve"],
    label: "Thermostatic Expansion Valve (TXV)",
    category: "Multiphase",
    domain: "thermal",
    archetypeId: Easy5ArchetypeId.VC_TXV,
    description: "Superheat-modulated expansion valve metering two-phase refrigerant mass flow across pressure drop.",
    provenance: "ASHRAE Handbook — Refrigeration, Ch. 11 (Thermostatic Expansion Valve Flow)",
    params: [
      ["CD", 0.65, "", "Valve discharge coefficient"],
      ["AREA_MAX", 2e-5, "m^2", "Maximum throat area"],
      ["RHO_L", 1150.0, "kg/m^3", "Liquid refrigerant density"],
      ["SH_SET", 5.0, "K", "Superheat setpoint"],
      ["K_SH", 0.1, "1/K", "Superheat proportional gain"],
    ],
  },
  {
    modelType: "CP_VC",
    library: "vc",
    aliases: ["VC/CP", "VC/CP_VC", "compressor"],
    label: "Vapor-Cycle Compressor",
    category: "Multiphase",
    domain: "thermal",
    archetypeId: Easy5ArchetypeId.VC_COMPRESSOR,
    description:
      "Polytropic vapor-cycle compressor computing refrigerant mass flow, discharge temperature, and shaft power.",
    provenance: "ASHRAE Handbook — Fundamentals, Ch. 2 (Isentropic/Polytropic Compression)",
    params: [
      ["DISP", 3e-5, "m^3/rev", "Swept displacement volume"],
      ["ETA_VOL", 0.85, "", "Volumetric efficiency"],
      ["ETA_IS", 0.78, "", "Isentropic efficiency"],
      ["GAMMA", 1.18, "", "Refrigerant vapor specific heat ratio"],
      ["CP_V", 900.0, "J/(kg*K)", "Vapor specific heat"],
    ],
  },
];

/**
 * Converts `EASY5_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildEasy5CleanroomSchemas(): CleanroomModelSchema[] {
  return EASY5_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `easy5:${spec.library}/${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: spec.domain,
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "easy5_component",
      width: 80,
      height: 48,
      svg: generateEasy5BlockSvg(spec.modelType, spec.library),
      ports: defaultPortsForLibrary(spec.library),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        library: spec.library,
        archetypeId: spec.archetypeId,
      },
    };
  });
}
