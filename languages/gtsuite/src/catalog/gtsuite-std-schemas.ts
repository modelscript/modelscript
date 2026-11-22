// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * GT-SUITE / GT-POWER cleanroom component archetype IDs matching `assets/gtsuite-std-lib/src/models.ts`.
 */
export const GtSuiteArchetypeId = {
  PIPE_1D: 1, // PipeRound, PipeBend, CatalystBrick
  FLOW_SPLIT: 2, // FlowSplitGeneral
  ORIFICE_FLOW: 3, // OrificeConn, ValveCamConn, ThrottleConn
  ENVIRONMENT_BC: 4, // EndEnvironment
  ENG_CYLINDER: 10, // EngCylinder
  COMB_WIEBE: 11, // EngCylCombWiebe
  HEAT_TR_WOSCHNI: 12, // EngCylHeatTrWoschni
  COMPRESSOR: 20, // Compressor
  TURBINE: 21, // Turbine
  SHAFT_TURBO: 22, // ShaftTurbo
  INJECTOR: 23, // InjectorAFSeq
  HEAT_EXCHANGER: 30, // HeatExchanger
  THERMAL_MASS: 31, // ThermalMass
  BATTERY_THEVENIN: 40, // Battery
  ELECTRIC_MOTOR: 41, // ElectricMotor
  INVERTER: 42, // Inverter
  COOLANT_PUMP: 43, // CoolantPump
  FLUID_PROPS: 50, // FluidAir, FluidGasoline, FluidCoolant
} as const;

export type GtSuiteArchetypeId = (typeof GtSuiteArchetypeId)[keyof typeof GtSuiteArchetypeId];

export type GtSuiteModelCategory = "Flow & Gas Dynamics" | "Engine & Turbomachinery" | "Thermal & Electrification";

export interface GtSuiteModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: GtSuiteModelCategory;
  domain: "fluid" | "mechanical" | "thermal" | "electrical";
  archetypeId: GtSuiteArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<GtSuiteModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Flow & Gas Dynamics": { fill: "#17324d", stroke: "#38bdf8", badge: "FLW" },
  "Engine & Turbomachinery": { fill: "#3b1f1a", stroke: "#fb923c", badge: "ENG" },
  "Thermal & Electrification": { fill: "#163b2f", stroke: "#34d399", badge: "THM" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a GT-SUITE / GT-POWER template.
 */
export function generateGtSuiteBlockSvg(modelType: string, category: GtSuiteModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.slice(0, 11);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 48" width="88" height="48">` +
    `<rect x="2" y="2" width="84" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="34" text-anchor="middle" font-family="monospace" font-size="9" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: GtSuiteModelSpec): DiagramPortSpec[] {
  switch (spec.archetypeId) {
    case GtSuiteArchetypeId.PIPE_1D:
    case GtSuiteArchetypeId.FLOW_SPLIT:
    case GtSuiteArchetypeId.ORIFICE_FLOW:
    case GtSuiteArchetypeId.COOLANT_PUMP:
      return [
        { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "outlet", kind: "fluid", side: "right", dx: 88, dy: 24 },
      ];
    case GtSuiteArchetypeId.ENVIRONMENT_BC:
      return [{ name: "port", kind: "fluid", side: "right", dx: 88, dy: 24 }];
    case GtSuiteArchetypeId.ENG_CYLINDER:
      return [
        { name: "intake", kind: "fluid", side: "left", dx: 0, dy: 14 },
        { name: "exhaust", kind: "fluid", side: "right", dx: 88, dy: 14 },
        { name: "crank", kind: "mechanical", side: "bottom", dx: 44, dy: 48 },
        { name: "thermal", kind: "thermal", side: "top", dx: 44, dy: 0 },
      ];
    case GtSuiteArchetypeId.COMB_WIEBE:
    case GtSuiteArchetypeId.HEAT_TR_WOSCHNI:
      return [
        { name: "theta", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "cylinder", kind: "thermal", side: "right", dx: 88, dy: 24 },
      ];
    case GtSuiteArchetypeId.COMPRESSOR:
    case GtSuiteArchetypeId.TURBINE:
      return [
        { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "outlet", kind: "fluid", side: "right", dx: 88, dy: 24 },
        { name: "shaft", kind: "mechanical", side: "bottom", dx: 44, dy: 48 },
      ];
    case GtSuiteArchetypeId.SHAFT_TURBO:
      return [
        { name: "turbine", kind: "mechanical", side: "left", dx: 0, dy: 24 },
        { name: "compressor", kind: "mechanical", side: "right", dx: 88, dy: 24 },
      ];
    case GtSuiteArchetypeId.INJECTOR:
      return [
        { name: "cmd", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "fuelOut", kind: "fluid", side: "right", dx: 88, dy: 24 },
      ];
    case GtSuiteArchetypeId.HEAT_EXCHANGER:
      return [
        { name: "hotIn", kind: "fluid", side: "left", dx: 0, dy: 16 },
        { name: "hotOut", kind: "fluid", side: "right", dx: 88, dy: 16 },
        { name: "coolant", kind: "thermal", side: "bottom", dx: 44, dy: 48 },
      ];
    case GtSuiteArchetypeId.THERMAL_MASS:
      return [
        { name: "qIn", kind: "thermal", side: "left", dx: 0, dy: 24 },
        { name: "temp", kind: "thermal", side: "right", dx: 88, dy: 24 },
      ];
    case GtSuiteArchetypeId.BATTERY_THEVENIN:
    case GtSuiteArchetypeId.INVERTER:
      return [
        { name: "dcBus", kind: "electrical", side: "left", dx: 0, dy: 24 },
        { name: "out", kind: "electrical", side: "right", dx: 88, dy: 24 },
        { name: "thermal", kind: "thermal", side: "top", dx: 44, dy: 0 },
      ];
    case GtSuiteArchetypeId.ELECTRIC_MOTOR:
      return [
        { name: "acBus", kind: "electrical", side: "left", dx: 0, dy: 24 },
        { name: "shaft", kind: "mechanical", side: "right", dx: 88, dy: 24 },
        { name: "thermal", kind: "thermal", side: "top", dx: 44, dy: 0 },
      ];
    case GtSuiteArchetypeId.FLUID_PROPS:
      return [{ name: "props", kind: "signal", side: "right", dx: 88, dy: 24 }];
  }
}

/**
 * Comprehensive cleanroom catalog of GT-SUITE / GT-POWER standard templates.
 */
export const GTSUITE_MODEL_SPECS: readonly GtSuiteModelSpec[] = [
  // =========================================================================
  // Flow & Gas Dynamics (8 templates)
  // =========================================================================
  {
    modelType: "PipeRound",
    aliases: ["PipeRoundConn", "pipe_round", "pipe"],
    label: "1D Round Gas-Dynamic Pipe",
    category: "Flow & Gas Dynamics",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.PIPE_1D,
    description: "1D compressible circular pipe with Darcy-Weisbach wall friction and convective wall heat transfer.",
    provenance:
      "Heywood, Internal Combustion Engine Fundamentals (2nd ed., Ch. 6); White, Fluid Mechanics (Darcy-Weisbach)",
    params: [
      ["diameter", 0.05, "m", "Internal pipe diameter"],
      ["length", 0.5, "m", "Pipe axial length"],
      ["frictionFactor", 0.02, "1", "Darcy-Weisbach friction factor"],
      ["wallTemp", 350.0, "K", "Pipe wall temperature"],
      ["roughness", 1.5e-5, "m", "Surface roughness height"],
    ],
  },
  {
    modelType: "PipeBend",
    aliases: ["PipeRoundBend", "pipe_bend"],
    label: "1D Curved Pipe Bend",
    category: "Flow & Gas Dynamics",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.PIPE_1D,
    description: "1D circular pipe bend with secondary-flow curvature loss coefficient and wall friction.",
    provenance: "Idelchik, Handbook of Hydraulic Resistance (Bend Losses); Heywood (2nd ed., Ch. 6)",
    params: [
      ["diameter", 0.05, "m", "Internal pipe diameter"],
      ["length", 0.25, "m", "Centerline arc length"],
      ["frictionFactor", 0.025, "1", "Effective Darcy friction factor"],
      ["wallTemp", 350.0, "K", "Pipe wall temperature"],
      ["bendAngleDeg", 90.0, "deg", "Bend deflection angle"],
    ],
  },
  {
    modelType: "FlowSplitGeneral",
    aliases: ["FlowSplit", "plenum", "flow_split"],
    label: "0D Flow Split / Plenum Volume",
    category: "Flow & Gas Dynamics",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.FLOW_SPLIT,
    description:
      "Lumped 0D compressible control volume conserving mass and internal energy across multiple flow ports.",
    provenance: "Heywood, Internal Combustion Engine Fundamentals (2nd ed., Ch. 6 & 14 — Filling-and-Emptying Model)",
    params: [
      ["volume", 0.002, "m3", "Internal plenum volume"],
      ["initPressure", 101325.0, "Pa", "Initial static pressure"],
      ["initTemp", 300.0, "K", "Initial static temperature"],
      ["gamma", 1.4, "1", "Ratio of specific heats cp/cv"],
      ["gasConstant", 287.05, "J/(kg.K)", "Specific gas constant R"],
    ],
  },
  {
    modelType: "OrificeConn",
    aliases: ["Orifice", "orifice_conn", "orifice"],
    label: "Isentropic Compressible Orifice",
    category: "Flow & Gas Dynamics",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.ORIFICE_FLOW,
    description: "Quasi-steady 1D isentropic compressible orifice with subsonic and choked critical flow regimes.",
    provenance: "Heywood, Internal Combustion Engine Fundamentals (2nd ed., Appendix C — Compressible Flow Equations)",
    params: [
      ["diameter", 0.04, "m", "Orifice throat diameter"],
      ["dischargeCoeff", 0.85, "1", "Orifice discharge coefficient Cd"],
      ["gamma", 1.4, "1", "Ratio of specific heats"],
      ["gasConstant", 287.05, "J/(kg.K)", "Specific gas constant R"],
      ["openFraction", 1.0, "1", "Effective open area fraction (0..1)"],
    ],
  },
  {
    modelType: "ValveCamConn",
    aliases: ["ValveCam", "valve_cam", "valve"],
    label: "Cam-Driven Poppet Valve",
    category: "Flow & Gas Dynamics",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.ORIFICE_FLOW,
    description:
      "Cam-actuated intake or exhaust poppet valve with lift-dependent curtain area and discharge coefficient.",
    provenance: "Heywood, Internal Combustion Engine Fundamentals (2nd ed., Section 6.3 — Valve Flow & Curtain Area)",
    params: [
      ["diameter", 0.034, "m", "Valve head diameter"],
      ["dischargeCoeff", 0.7, "1", "Curtain discharge coefficient Cd"],
      ["gamma", 1.4, "1", "Ratio of specific heats"],
      ["gasConstant", 287.05, "J/(kg.K)", "Specific gas constant R"],
      ["openFraction", 0.65, "1", "Instantaneous normalized lift fraction"],
    ],
  },
  {
    modelType: "ThrottleConn",
    aliases: ["Throttle", "throttle_conn", "butterfly_valve"],
    label: "Butterfly Throttle Valve",
    category: "Flow & Gas Dynamics",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.ORIFICE_FLOW,
    description: "Variable-area butterfly throttle body controlling intake manifold mass flow rate.",
    provenance: "Heywood, Internal Combustion Engine Fundamentals (2nd ed., Section 7.2 — Throttle Flow)",
    params: [
      ["diameter", 0.056, "m", "Throttle bore diameter"],
      ["dischargeCoeff", 0.82, "1", "Discharge coefficient Cd"],
      ["gamma", 1.4, "1", "Ratio of specific heats"],
      ["gasConstant", 287.05, "J/(kg.K)", "Specific gas constant R"],
      ["openFraction", 0.5, "1", "Normalized throttle opening fraction (0..1)"],
    ],
  },
  {
    modelType: "EndEnvironment",
    aliases: ["Environment", "end_environment", "ambient"],
    label: "Ambient Pressure/Temperature Boundary",
    category: "Flow & Gas Dynamics",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.ENVIRONMENT_BC,
    description: "Infinite-reservoir ambient stagnation pressure and temperature boundary condition.",
    provenance: "ISO 2533 Standard Atmosphere; Heywood (2nd ed., Ch. 6 — Boundary Conditions)",
    params: [
      ["pressure", 101325.0, "Pa", "Ambient stagnation pressure"],
      ["temperature", 298.15, "K", "Ambient stagnation temperature"],
      ["relativeHumidity", 0.5, "1", "Relative humidity fraction (0..1)"],
    ],
  },
  {
    modelType: "CatalystBrick",
    aliases: ["Catalyst", "catalyst_brick", "aftertreatment"],
    label: "Monolith Catalytic Converter Brick",
    category: "Flow & Gas Dynamics",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.PIPE_1D,
    description: "Honeycomb monolith aftertreatment substrate with laminar channel pressure drop and thermal inertia.",
    provenance: "Koltsakis & Stamatelos, Prog. Energy Combust. Sci. 23(1) (1997) — Monolith Converter Modeling",
    params: [
      ["diameter", 0.11, "m", "Substrate outer diameter"],
      ["length", 0.15, "m", "Monolith axial length"],
      ["frictionFactor", 0.08, "1", "Effective monolith channel friction factor"],
      ["wallTemp", 650.0, "K", "Substrate wall temperature"],
      ["cellDensityCpsi", 400.0, "1/in2", "Channel cell density"],
    ],
  },

  // =========================================================================
  // Engine & Turbomachinery (7 templates)
  // =========================================================================
  {
    modelType: "EngCylinder",
    aliases: ["Cylinder", "eng_cylinder", "cylinder"],
    label: "Internal Combustion Engine Cylinder",
    category: "Engine & Turbomachinery",
    domain: "mechanical",
    archetypeId: GtSuiteArchetypeId.ENG_CYLINDER,
    description: "Single-zone thermodynamic engine cylinder with slider-crank kinematics and first-law energy balance.",
    provenance: "Heywood, Internal Combustion Engine Fundamentals (2nd ed., Ch. 2 & Ch. 14 — Slider-Crank & First Law)",
    params: [
      ["bore", 0.086, "m", "Cylinder bore diameter"],
      ["stroke", 0.086, "m", "Piston stroke length"],
      ["conRodLength", 0.145, "m", "Connecting rod center-to-center length"],
      ["compressionRatio", 10.5, "1", "Geometric compression ratio"],
      ["gamma", 1.35, "1", "Polytropic/isentropic exponent"],
    ],
  },
  {
    modelType: "EngCylCombWiebe",
    aliases: ["Wiebe", "wiebe_combustion", "EngCylCombSIWiebe"],
    label: "Wiebe Function Combustion Model",
    category: "Engine & Turbomachinery",
    domain: "thermal",
    archetypeId: GtSuiteArchetypeId.COMB_WIEBE,
    description:
      "Imposed mass-fraction-burned Wiebe function x_b(theta) = 1 - exp(-a * ((theta - theta0) / dTheta)^(m + 1)).",
    provenance: "I. I. Wiebe (1956); Heywood, Internal Combustion Engine Fundamentals (2nd ed., Eq. 14.33)",
    params: [
      ["anchorAngleDeg", -10.0, "deg", "Start of combustion crank angle theta_0"],
      ["durationDeg", 50.0, "deg", "Combustion burn duration delta_theta"],
      ["wiebeExponentM", 2.0, "1", "Wiebe shape exponent m"],
      ["wiebeEfficiencyA", 5.0, "1", "Wiebe efficiency/completeness factor a"],
    ],
  },
  {
    modelType: "EngCylHeatTrWoschni",
    aliases: ["Woschni", "woschni_ht", "EngCylHeatTrWoschniGT"],
    label: "Woschni Cylinder Heat Transfer",
    category: "Engine & Turbomachinery",
    domain: "thermal",
    archetypeId: GtSuiteArchetypeId.HEAT_TR_WOSCHNI,
    description:
      "Woschni empirical in-cylinder convective heat transfer correlation h_c = 3.26 * B^-0.2 * p^0.8 * T^-0.55 * w^0.8.",
    provenance: "G. Woschni, SAE Paper 670931 (1967); Heywood (2nd ed., Eq. 12.18)",
    params: [
      ["bore", 0.086, "m", "Cylinder bore diameter B"],
      ["stroke", 0.086, "m", "Piston stroke S"],
      ["wallTemp", 450.0, "K", "Effective cylinder wall temperature"],
      ["c1", 2.28, "1", "Gas velocity period coefficient C1"],
      ["multiplier", 1.0, "1", "Heat transfer calibration multiplier"],
    ],
  },
  {
    modelType: "Compressor",
    aliases: ["TurboCompressor", "turbo_compressor", "compressor"],
    label: "Turbocharger Centrifugal Compressor",
    category: "Engine & Turbomachinery",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.COMPRESSOR,
    description:
      "Steady/quasi-steady centrifugal compressor computing isentropic enthalpy rise, outlet temperature, and shaft power.",
    provenance: "Watson & Janota, Turbocharging the Internal Combustion Engine (1982); Heywood (2nd ed., Ch. 6.7)",
    params: [
      ["pressureRatio", 2.0, "1", "Total-to-total pressure ratio p2/p1"],
      ["efficiency", 0.75, "1", "Isentropic compressor efficiency eta_c"],
      ["gamma", 1.4, "1", "Ratio of specific heats"],
      ["cp", 1005.0, "J/(kg.K)", "Constant-pressure specific heat"],
      ["designMassFlow", 0.15, "kg/s", "Nominal reference mass flow rate"],
    ],
  },
  {
    modelType: "Turbine",
    aliases: ["TurboTurbine", "turbo_turbine", "turbine"],
    label: "Turbocharger Radial Turbine",
    category: "Engine & Turbomachinery",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.TURBINE,
    description:
      "Radial exhaust gas turbine computing isentropic enthalpy drop, outlet temperature, and extracted shaft power.",
    provenance: "Watson & Janota, Turbocharging the Internal Combustion Engine (1982); Heywood (2nd ed., Ch. 6.7)",
    params: [
      ["expansionRatio", 2.0, "1", "Total-to-static expansion ratio p1/p2"],
      ["efficiency", 0.72, "1", "Isentropic turbine efficiency eta_t"],
      ["gamma", 1.34, "1", "Exhaust gas ratio of specific heats"],
      ["cp", 1150.0, "J/(kg.K)", "Exhaust gas specific heat cp"],
      ["designMassFlow", 0.15, "kg/s", "Nominal reference mass flow rate"],
    ],
  },
  {
    modelType: "ShaftTurbo",
    aliases: ["TurboShaft", "shaft_turbo", "shaft"],
    label: "Turbocharger Rotor Shaft",
    category: "Engine & Turbomachinery",
    domain: "mechanical",
    archetypeId: GtSuiteArchetypeId.SHAFT_TURBO,
    description:
      "Rotational inertia shaft coupling turbine and compressor torque balance with bearing friction damping.",
    provenance: "Watson & Janota, Turbocharging the Internal Combustion Engine (1982, Ch. 9 — Turbocharger Dynamics)",
    params: [
      ["inertia", 3.5e-5, "kg.m2", "Rotor polar moment of inertia J"],
      ["initSpeedRpm", 80000.0, "rpm", "Initial rotor speed"],
      ["frictionCoeff", 1.0e-5, "N.m.s/rad", "Viscous bearing friction coefficient"],
    ],
  },
  {
    modelType: "InjectorAFSeq",
    aliases: ["Injector", "injector_af_seq", "injector"],
    label: "Sequential Air-Fuel Ratio Injector",
    category: "Engine & Turbomachinery",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.INJECTOR,
    description: "Sequential fuel injector targeting a specified air-fuel ratio with fuel lower heating value release.",
    provenance: "Heywood, Internal Combustion Engine Fundamentals (2nd ed., Ch. 7 — Fuel Metering & Injection)",
    params: [
      ["targetAfr", 14.7, "1", "Target air-fuel mass ratio"],
      ["lhv", 4.4e7, "J/kg", "Fuel lower heating value"],
      ["vaporizedFraction", 0.3, "1", "Fraction of injected fuel vaporized immediately"],
    ],
  },

  // =========================================================================
  // Thermal & Electrification (9 templates)
  // =========================================================================
  {
    modelType: "HeatExchanger",
    aliases: ["Intercooler", "Radiator", "heat_exchanger", "intercooler"],
    label: "Effectiveness-NTU Heat Exchanger",
    category: "Thermal & Electrification",
    domain: "thermal",
    archetypeId: GtSuiteArchetypeId.HEAT_EXCHANGER,
    description: "Effectiveness-NTU heat exchanger / charge-air cooler with fluid temperature drop and pressure loss.",
    provenance: "Incropera & DeWitt, Fundamentals of Heat and Mass Transfer (Ch. 11 — Effectiveness-NTU Method)",
    params: [
      ["effectiveness", 0.8, "1", "Thermal effectiveness epsilon (0..1)"],
      ["coolantTemp", 320.0, "K", "Secondary coolant sink temperature"],
      ["cp", 1005.0, "J/(kg.K)", "Primary fluid specific heat"],
      ["pressureDropCoeff", 5000.0, "Pa/(kg/s)^2", "Quadratic pressure loss coefficient"],
    ],
  },
  {
    modelType: "ThermalMass",
    aliases: ["LumpedThermalMass", "thermal_mass"],
    label: "1st-Order Lumped Thermal Mass",
    category: "Thermal & Electrification",
    domain: "thermal",
    archetypeId: GtSuiteArchetypeId.THERMAL_MASS,
    description: "Lumped-capacitance thermal body solving m * cp * dT/dt = Q_in - hA * (T - T_amb).",
    provenance: "Incropera & DeWitt, Fundamentals of Heat and Mass Transfer (Ch. 5 — Lumped Capacitance Method)",
    params: [
      ["mass", 10.0, "kg", "Thermal body mass m"],
      ["cp", 500.0, "J/(kg.K)", "Specific heat capacity cp"],
      ["initTemp", 300.0, "K", "Initial body temperature"],
      ["ambientConductance", 5.0, "W/K", "Ambient heat loss conductance hA"],
      ["ambientTemp", 300.0, "K", "Ambient reference temperature"],
    ],
  },
  {
    modelType: "Battery",
    aliases: ["BatteryThevenin", "battery_pack", "battery"],
    label: "Thévenin Equivalent-Circuit Battery",
    category: "Thermal & Electrification",
    domain: "electrical",
    archetypeId: GtSuiteArchetypeId.BATTERY_THEVENIN,
    description:
      "First-order Thévenin (R0 + R1||C1) traction battery with Coulomb-counting State of Charge (SoC) dynamics.",
    provenance: "Plett, Battery Management Systems Vol. 1 (2015, Ch. 2 — Equivalent-Circuit Cell Models)",
    params: [
      ["capacityAh", 60.0, "Ah", "Nominal cell/pack charge capacity"],
      ["vNom", 350.0, "V", "Nominal pack open-circuit voltage"],
      ["r0", 0.05, "Ohm", "Ohmic internal series resistance R0"],
      ["r1", 0.02, "Ohm", "RC polarization resistance R1"],
      ["c1", 1000.0, "F", "RC polarization capacitance C1"],
      ["initSoc", 0.8, "1", "Initial state of charge (0..1)"],
    ],
  },
  {
    modelType: "ElectricMotor",
    aliases: ["EMotor", "TractionMotor", "electric_motor"],
    label: "Traction Electric Motor / Generator",
    category: "Thermal & Electrification",
    domain: "electrical",
    archetypeId: GtSuiteArchetypeId.ELECTRIC_MOTOR,
    description:
      "Electromechanical traction motor converting electrical bus power to shaft torque with efficiency loss.",
    provenance: "Ehsani et al., Modern Electric, Hybrid Electric, and Fuel Cell Vehicles (3rd ed., Ch. 7)",
    params: [
      ["maxPowerW", 150000.0, "W", "Peak mechanical power rating"],
      ["efficiency", 0.94, "1", "Nominal electromechanical conversion efficiency"],
      ["baseSpeedRpm", 4500.0, "rpm", "Corner/base speed"],
    ],
  },
  {
    modelType: "Inverter",
    aliases: ["PowerInverter", "DCACInverter", "inverter"],
    label: "DC/AC Traction Power Inverter",
    category: "Thermal & Electrification",
    domain: "electrical",
    archetypeId: GtSuiteArchetypeId.INVERTER,
    description: "Bidirectional DC-to-AC traction inverter with conduction and switching thermal dissipation.",
    provenance: "Mohan, Undeland & Robbins, Power Electronics (3rd ed., Ch. 8 — Three-Phase Inverters)",
    params: [
      ["efficiency", 0.97, "1", "Nominal inverter conversion efficiency"],
      ["vDcNom", 350.0, "V", "Nominal DC link voltage"],
      ["idleLossW", 50.0, "W", "Quiescent switching and gate-drive loss"],
    ],
  },
  {
    modelType: "CoolantPump",
    aliases: ["Pump", "WaterPump", "coolant_pump"],
    label: "Centrifugal Coolant Pump",
    category: "Thermal & Electrification",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.COOLANT_PUMP,
    description:
      "Speed-controlled centrifugal coolant pump modeled via affinity laws for head rise and hydraulic power.",
    provenance: "White, Fluid Mechanics (Ch. 11 — Turbomachinery & Pump Affinity Laws)",
    params: [
      ["refSpeedRpm", 3000.0, "rpm", "Reference pump shaft speed"],
      ["refFlowKgS", 1.5, "kg/s", "Reference mass flow rate at reference speed"],
      ["refDeltaP", 80000.0, "Pa", "Reference pressure rise at reference speed"],
      ["efficiency", 0.7, "1", "Hydraulic efficiency"],
      ["density", 1030.0, "kg/m3", "Coolant liquid density"],
    ],
  },
  {
    modelType: "FluidAir",
    aliases: ["Air", "fluid_air", "IdealGasAir"],
    label: "Ideal-Gas Dry Air Property Object",
    category: "Thermal & Electrification",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.FLUID_PROPS,
    description: "NASA-9 polynomial ideal-gas thermodynamic property definition for dry air.",
    provenance: "NASA Glenn Coefficients for Calculating Thermodynamic Properties (NASA/TP-2002-211556)",
    params: [
      ["gasConstant", 287.05, "J/(kg.K)", "Specific gas constant R"],
      ["cpRef", 1005.0, "J/(kg.K)", "Reference cp at 300 K"],
      ["gammaRef", 1.4, "1", "Reference ratio of specific heats"],
      ["cpSlope", 0.12, "J/(kg.K^2)", "Linearized temperature slope d(cp)/dT"],
    ],
  },
  {
    modelType: "FluidGasoline",
    aliases: ["Gasoline", "Indolene", "fluid_gasoline"],
    label: "Gasoline / Iso-Octane Fuel Properties",
    category: "Thermal & Electrification",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.FLUID_PROPS,
    description: "Thermodynamic and combustion property definition for gasoline (iso-octane surrogate).",
    provenance: "Heywood, Internal Combustion Engine Fundamentals (2nd ed., Appendix D — Fuel Properties); NASA-9",
    params: [
      ["gasConstant", 72.8, "J/(kg.K)", "Vapor specific gas constant"],
      ["cpRef", 2100.0, "J/(kg.K)", "Liquid specific heat capacity"],
      ["gammaRef", 1.05, "1", "Vapor ratio of specific heats"],
      ["lhv", 4.4e7, "J/kg", "Lower heating value"],
    ],
  },
  {
    modelType: "FluidCoolant",
    aliases: ["EGW5050", "WaterGlycol", "fluid_coolant"],
    label: "50/50 Ethylene Glycol-Water Coolant",
    category: "Thermal & Electrification",
    domain: "fluid",
    archetypeId: GtSuiteArchetypeId.FLUID_PROPS,
    description: "Incompressible thermal property definition for 50/50 ethylene glycol-water engine/battery coolant.",
    provenance: "ASHRAE Handbook — Fundamentals (Ch. 31 — Physical Properties of Secondary Coolants)",
    params: [
      ["density", 1030.0, "kg/m3", "Nominal coolant density at 330 K"],
      ["cpRef", 3550.0, "J/(kg.K)", "Specific heat capacity cp"],
      ["gammaRef", 1.0, "1", "Incompressible effective gamma"],
      ["viscosity", 0.0012, "Pa.s", "Dynamic viscosity at 330 K"],
    ],
  },
];

/**
 * Converts `GTSUITE_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildGtSuiteCleanroomSchemas(): CleanroomModelSchema[] {
  return GTSUITE_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `gtsuite:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: spec.domain,
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "gtsuite_template",
      width: 88,
      height: 48,
      svg: generateGtSuiteBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
