// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * gPROMS cleanroom Process Model Library (PML) & property package archetype IDs
 * matching `assets/gproms-std-lib/src/models.ts`.
 */
export const GpromsArchetypeId = {
  REACTOR_CSTR: 1, // PML_CSTR
  REACTOR_PFR: 2, // PML_PFR
  REACTOR_BATCH: 3, // PML_BatchReactor
  SEPARATOR_FLASH: 10, // PML_FlashDrum
  SEPARATOR_DISTILLATION: 11, // PML_DistillationTray
  CRYSTALLIZER: 12, // PML_Crystallizer
  SEPARATOR_MEMBRANE: 13, // PML_MembraneSep
  FUEL_CELL: 14, // PML_FuelCellStack
  HEAT_EXCHANGER: 20, // PML_HeatExchanger
  TANK_BUFFER: 21, // PML_TankBuffer
  CONTROL_VALVE: 22, // PML_ControlValve
  PUMP_COMPRESSOR: 23, // PML_Pump, PML_Compressor
  PIPE_FLOW: 24, // PML_Pipe, PML_Mixer, PML_Splitter
  CONTROL_PID: 30, // PML_PIDController
  SENSOR: 31, // PML_Sensor
  PROPERTY_PKG: 40, // PROP_PengRobinson, PROP_NRTL, PROP_IAPWS_IF97, CAPE_OPEN_ForeignObject
} as const;

export type GpromsArchetypeId = (typeof GpromsArchetypeId)[keyof typeof GpromsArchetypeId];

export interface GpromsModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: "Reactor" | "Separator" | "Flowsheet / Thermal" | "Control" | "Property Package";
  archetypeId: GpromsArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<GpromsModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
  Reactor: { fill: "#3b1d2e", stroke: "#f472b6", badge: "RXN" },
  Separator: { fill: "#1e3a5f", stroke: "#60a5fa", badge: "SEP" },
  "Flowsheet / Thermal": { fill: "#1e3f2f", stroke: "#34d399", badge: "FLW" },
  Control: { fill: "#3f2e18", stroke: "#fbbf24", badge: "CTL" },
  "Property Package": { fill: "#2a2b4a", stroke: "#a78bfa", badge: "PRP" },
};

/**
 * Generates a deterministic cleanroom parametric SVG icon for a gPROMS PML or property package model.
 */
export function generateGpromsBlockSvg(modelType: string, category: GpromsModelSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const shortLabel = modelType.replace(/^(PML_|PROP_|CAPE_OPEN_)/, "").slice(0, 10);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 52" width="92" height="52">` +
    `<rect x="2" y="2" width="88" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="26" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="19" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="46" y="36" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${shortLabel}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: GpromsModelSpec["category"]): DiagramPortSpec[] {
  switch (category) {
    case "Reactor":
      return [
        { name: "feed", kind: "fluid", side: "left", dx: 0, dy: 18 },
        { name: "coolant", kind: "thermal", side: "left", dx: 0, dy: 38 },
        { name: "effluent", kind: "fluid", side: "right", dx: 92, dy: 26 },
      ];
    case "Separator":
      return [
        { name: "feed", kind: "fluid", side: "left", dx: 0, dy: 26 },
        { name: "vapor_top", kind: "fluid", side: "right", dx: 92, dy: 14 },
        { name: "liquid_bot", kind: "fluid", side: "right", dx: 92, dy: 38 },
      ];
    case "Flowsheet / Thermal":
      return [
        { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 26 },
        { name: "outlet", kind: "fluid", side: "right", dx: 92, dy: 26 },
        { name: "ctrl", kind: "signal", side: "top", dx: 46, dy: 0 },
      ];
    case "Control":
      return [
        { name: "pv", kind: "signal", side: "left", dx: 0, dy: 16 },
        { name: "sp", kind: "signal", side: "left", dx: 0, dy: 36 },
        { name: "mv", kind: "signal", side: "right", dx: 92, dy: 26 },
      ];
    case "Property Package":
      return [
        { name: "state_in", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "props_out", kind: "signal", side: "right", dx: 92, dy: 26 },
      ];
  }
}

export const GPROMS_MODEL_SPECS: GpromsModelSpec[] = [
  // =========================================================================
  // Reactors & Separators
  // =========================================================================
  {
    modelType: "PML_CSTR",
    aliases: ["cstr", "CSTR", "PML.CSTR"],
    label: "Continuous Stirred-Tank Reactor (CSTR)",
    category: "Reactor",
    archetypeId: GpromsArchetypeId.REACTOR_CSTR,
    description:
      "Dynamic non-isothermal CSTR with first-order Arrhenius reaction kinetics, cooling jacket heat transfer, and species/energy balances.",
    provenance: "Fogler, Elements of Chemical Reaction Engineering (5th ed., Ch. 4 & 12)",
    params: [
      ["V", 1.0, "m^3", "Liquid holdup volume"],
      ["A", 1.0e5, "1/s", "Arrhenius pre-exponential factor"],
      ["Ea", 45000.0, "J/mol", "Activation energy"],
      ["dHrxn", -50000.0, "J/mol", "Heat of reaction (negative = exothermic)"],
      ["rho", 1000.0, "kg/m^3", "Fluid mass density"],
      ["Cp", 4184.0, "J/(kg.K)", "Specific heat capacity"],
      ["UA", 1500.0, "W/K", "Jacket overall heat transfer conductance"],
    ],
  },
  {
    modelType: "PML_PFR",
    aliases: ["pfr", "PFR", "PlugFlowReactor"],
    label: "Plug Flow Reactor (PFR)",
    category: "Reactor",
    archetypeId: GpromsArchetypeId.REACTOR_PFR,
    description: "Tubular plug-flow reactor with axial residence-time Arrhenius kinetics and wall heat exchange.",
    provenance: "Fogler, Elements of Chemical Reaction Engineering (5th ed., Ch. 2 & 11)",
    params: [
      ["V", 0.5, "m^3", "Tubular reactor volume"],
      ["A", 5.0e4, "1/s", "Arrhenius pre-exponential factor"],
      ["Ea", 42000.0, "J/mol", "Activation energy"],
      ["dHrxn", -40000.0, "J/mol", "Heat of reaction"],
      ["rho", 900.0, "kg/m^3", "Fluid density"],
      ["Cp", 2500.0, "J/(kg.K)", "Heat capacity"],
      ["UA", 800.0, "W/K", "Wall heat transfer conductance"],
    ],
  },
  {
    modelType: "PML_BatchReactor",
    aliases: ["batch_reactor", "BatchReactor"],
    label: "Dynamic Batch Reactor",
    category: "Reactor",
    archetypeId: GpromsArchetypeId.REACTOR_BATCH,
    description: "Closed dynamic batch reactor with Arrhenius conversion kinetics and jacketed temperature control.",
    provenance: "Fogler, Elements of Chemical Reaction Engineering (5th ed., Ch. 3 & 13)",
    params: [
      ["V", 2.0, "m^3", "Batch liquid volume"],
      ["A", 2.0e4, "1/s", "Arrhenius pre-exponential factor"],
      ["Ea", 48000.0, "J/mol", "Activation energy"],
      ["dHrxn", -60000.0, "J/mol", "Heat of reaction"],
      ["rho", 1050.0, "kg/m^3", "Batch density"],
      ["Cp", 3800.0, "J/(kg.K)", "Specific heat capacity"],
      ["UA", 2000.0, "W/K", "Cooling jacket conductance"],
    ],
  },
  {
    modelType: "PML_FlashDrum",
    aliases: ["flash", "FlashDrum", "VLEFlash"],
    label: "Dynamic Vapor-Liquid Flash Drum",
    category: "Separator",
    archetypeId: GpromsArchetypeId.SEPARATOR_FLASH,
    description: "Two-phase vapor-liquid flash separator solving Rachford-Rice equilibrium split with dynamic holdup.",
    provenance: "Seader, Henley & Roper, Separation Process Principles (3rd ed., Ch. 4)",
    params: [
      ["V", 3.0, "m^3", "Drum vessel volume"],
      ["Kval", 2.5, "1", "Light-component equilibrium K-value"],
      ["tau", 20.0, "s", "Vapor-liquid equilibration time constant"],
      ["dHvap", 35000.0, "J/mol", "Latent heat of vaporization"],
    ],
  },
  {
    modelType: "PML_DistillationTray",
    aliases: ["tray", "DistillationTray", "EquilibriumStage"],
    label: "Equilibrium Distillation Tray",
    category: "Separator",
    archetypeId: GpromsArchetypeId.SEPARATOR_DISTILLATION,
    description:
      "Dynamic MESH equilibrium stage with Francis weir hydraulics, relative volatility VLE, and Murphree efficiency.",
    provenance: "Seader, Henley & Roper, Separation Process Principles (3rd ed., Ch. 7 & 10)",
    params: [
      ["alpha", 2.2, "1", "Relative volatility"],
      ["etaM", 0.85, "1", "Murphree vapor tray efficiency"],
      ["Mholdup", 10.0, "mol", "Liquid molar holdup on tray"],
      ["tauHyd", 5.0, "s", "Hydraulic lag time constant"],
    ],
  },
  {
    modelType: "PML_Crystallizer",
    aliases: ["crystallizer", "MSMPR"],
    label: "MSMPR Population-Balance Crystallizer",
    category: "Separator",
    archetypeId: GpromsArchetypeId.CRYSTALLIZER,
    description:
      "Mixed-suspension mixed-product-removal (MSMPR) cooling crystallizer tracking supersaturation and crystal yield.",
    provenance: "Myerson, Handbook of Industrial Crystallization (2nd ed., Ch. 8); Seader-Henley Ch. 17",
    params: [
      ["V", 5.0, "m^3", "Crystallizer slurry volume"],
      ["kG", 1.5e-3, "1/s", "Crystal growth kinetic rate constant"],
      ["CsatRef", 250.0, "mol/m^3", "Reference saturation concentration at 300 K"],
      ["dHsol", 18000.0, "J/mol", "Enthalpy of dissolution"],
    ],
  },
  {
    modelType: "PML_MembraneSep",
    aliases: ["membrane", "MembraneSep"],
    label: "Membrane Separation Module",
    category: "Separator",
    archetypeId: GpromsArchetypeId.SEPARATOR_MEMBRANE,
    description:
      "Cross-flow solution-diffusion membrane separator computing permeate flux from transmembrane pressure and selectivity.",
    provenance: "Seader, Henley & Roper, Separation Process Principles (3rd ed., Ch. 14)",
    params: [
      ["area", 25.0, "m^2", "Active membrane area"],
      ["permeance", 2.0e-8, "m/(s.Pa)", "Component permeance"],
      ["selectivity", 12.0, "1", "Ideal membrane selectivity"],
      ["pPermeate", 101325.0, "Pa", "Permeate-side pressure"],
    ],
  },
  {
    modelType: "PML_FuelCellStack",
    aliases: ["fuel_cell", "PEMFC", "SOFC"],
    label: "Electrochemical Fuel Cell Stack",
    category: "Reactor",
    archetypeId: GpromsArchetypeId.FUEL_CELL,
    description:
      "Dynamic PEM/SOFC fuel cell stack with Nernst open-circuit potential, ohmic resistance, and thermal balance.",
    provenance: "Larminie & Dicks, Fuel Cell Systems Explained (2nd ed., Ch. 3); Fogler Ch. 10",
    params: [
      ["nCells", 50.0, "1", "Number of cells in series"],
      ["E0", 1.229, "V", "Reversible single-cell potential"],
      ["rOhm", 0.002, "Ohm", "Area-specific ohmic resistance per cell"],
      ["thermalCap", 5000.0, "J/K", "Stack lumped thermal capacitance"],
      ["UA", 120.0, "W/K", "Stack cooling conductance"],
    ],
  },

  // =========================================================================
  // Flowsheet & Thermal
  // =========================================================================
  {
    modelType: "PML_HeatExchanger",
    aliases: ["hx", "HeatExchanger", "LMTD_HX"],
    label: "Shell-and-Tube Heat Exchanger (LMTD)",
    category: "Flowsheet / Thermal",
    archetypeId: GpromsArchetypeId.HEAT_EXCHANGER,
    description:
      "Counter-current heat exchanger computing log-mean temperature difference (LMTD) duty and dynamic thermal response.",
    provenance: "Incropera & DeWitt, Fundamentals of Heat and Mass Transfer (7th ed., Ch. 11)",
    params: [
      ["U", 850.0, "W/(m^2.K)", "Overall heat transfer coefficient"],
      ["A", 20.0, "m^2", "Heat transfer surface area"],
      ["mCpHot", 12000.0, "W/K", "Hot-side heat capacity flow rate"],
      ["mCpCold", 15000.0, "W/K", "Cold-side heat capacity flow rate"],
      ["tau", 8.0, "s", "Thermal holdup lag time constant"],
    ],
  },
  {
    modelType: "PML_Pump",
    aliases: ["pump", "CentrifugalPump"],
    label: "Centrifugal Process Pump",
    category: "Flowsheet / Thermal",
    archetypeId: GpromsArchetypeId.PUMP_COMPRESSOR,
    description:
      "Incompressible centrifugal pump with quadratic head-flow curve and hydraulic efficiency power balance.",
    provenance: "Seader-Henley; Perry's Chemical Engineers' Handbook (8th ed., Sec. 10)",
    params: [
      ["dPnom", 300000.0, "Pa", "Nominal shutoff pressure rise"],
      ["kCurve", 5.0e6, "Pa/(m^3/s)^2", "Quadratic head-loss curve slope"],
      ["eta", 0.78, "1", "Hydraulic efficiency"],
      ["tau", 1.5, "s", "Shaft/hydraulic inertia lag"],
    ],
  },
  {
    modelType: "PML_Compressor",
    aliases: ["compressor", "PolytropicCompressor"],
    label: "Polytropic Gas Compressor",
    category: "Flowsheet / Thermal",
    archetypeId: GpromsArchetypeId.PUMP_COMPRESSOR,
    description:
      "Polytropic gas compressor computing discharge pressure, isentropic temperature rise, and compression duty.",
    provenance: "Perry's Chemical Engineers' Handbook (8th ed., Sec. 10); Smith-Van Ness-Abbott Ch. 7",
    params: [
      ["dPnom", 500000.0, "Pa", "Nominal pressure boost"],
      ["kCurve", 2.0e6, "Pa/(m^3/s)^2", "Head-flow slope"],
      ["eta", 0.75, "1", "Polytropic efficiency"],
      ["tau", 2.0, "s", "Rotor/plenum lag"],
    ],
  },
  {
    modelType: "PML_ControlValve",
    aliases: ["valve", "ControlValve", "CvValve"],
    label: "ISA-75.01 Control Valve",
    category: "Flowsheet / Thermal",
    archetypeId: GpromsArchetypeId.CONTROL_VALVE,
    description:
      "Throttling control valve with first-order pneumatic actuator lag and ISA-75.01 Cv square-root flow law.",
    provenance: "ANSI/ISA-75.01.01-2012 Flow Equations for Sizing Control Valves",
    params: [
      ["Cv", 0.002, "m^3/(s.Pa^0.5)", "SI valve flow coefficient"],
      ["tau", 1.0, "s", "Actuator stroke time constant"],
      ["pDown", 101325.0, "Pa", "Downstream backpressure"],
      ["rho", 1000.0, "kg/m^3", "Fluid density"],
    ],
  },
  {
    modelType: "PML_Pipe",
    aliases: ["pipe", "PipeSegment"],
    label: "Darcy-Weisbach Process Pipe",
    category: "Flowsheet / Thermal",
    archetypeId: GpromsArchetypeId.PIPE_FLOW,
    description: "Process piping segment with Darcy-Weisbach frictional pressure drop and plug-flow thermal loss.",
    provenance: "Perry's Chemical Engineers' Handbook (8th ed., Sec. 6 — Fluid Dynamics)",
    params: [
      ["length", 50.0, "m", "Pipe length"],
      ["diameter", 0.1, "m", "Internal pipe diameter"],
      ["fDarcy", 0.02, "1", "Darcy friction factor"],
      ["rho", 1000.0, "kg/m^3", "Fluid density"],
    ],
  },
  {
    modelType: "PML_Mixer",
    aliases: ["mixer", "StreamMixer"],
    label: "Adiabatic Stream Mixer",
    category: "Flowsheet / Thermal",
    archetypeId: GpromsArchetypeId.PIPE_FLOW,
    description: "Multi-stream adiabatic mixer enforcing total mass, component mole, and enthalpy conservation.",
    provenance: "Seader, Henley & Roper, Separation Process Principles (3rd ed., Ch. 2)",
    params: [
      ["length", 1.0, "m", "Mixing manifold length"],
      ["diameter", 0.15, "m", "Manifold diameter"],
      ["fDarcy", 0.015, "1", "Friction factor"],
      ["rho", 1000.0, "kg/m^3", "Mixed stream density"],
    ],
  },
  {
    modelType: "PML_Splitter",
    aliases: ["splitter", "StreamSplitter"],
    label: "Isenthalpic Stream Splitter",
    category: "Flowsheet / Thermal",
    archetypeId: GpromsArchetypeId.PIPE_FLOW,
    description:
      "Flowsheet stream splitter partitioning flow rate by split fraction while preserving intensive composition and temperature.",
    provenance: "Seader, Henley & Roper, Separation Process Principles (3rd ed., Ch. 2)",
    params: [
      ["length", 0.5, "m", "Header length"],
      ["diameter", 0.15, "m", "Header diameter"],
      ["fDarcy", 0.01, "1", "Friction factor"],
      ["rho", 1000.0, "kg/m^3", "Stream density"],
    ],
  },
  {
    modelType: "PML_TankBuffer",
    aliases: ["tank", "BufferTank", "SurgeDrum"],
    label: "Dynamic Buffer / Surge Tank",
    category: "Flowsheet / Thermal",
    archetypeId: GpromsArchetypeId.TANK_BUFFER,
    description:
      "Dynamic liquid surge tank with free-surface level holdup, gravity discharge, and well-mixed composition/temperature lag.",
    provenance: "Seborg, Edgar, Mellichamp & Doyle, Process Dynamics and Control (4th ed., Ch. 2)",
    params: [
      ["area", 2.0, "m^2", "Tank cross-sectional area"],
      ["hMax", 5.0, "m", "Maximum tank height"],
      ["hInit", 2.0, "m", "Initial liquid level"],
      ["kOut", 0.05, "m^2.5/s", "Gravity outlet discharge coefficient"],
    ],
  },

  // =========================================================================
  // Control & Property Packages
  // =========================================================================
  {
    modelType: "PML_PIDController",
    aliases: ["pid", "PID", "PIDController"],
    label: "ISA-Standard PID Controller",
    category: "Control",
    archetypeId: GpromsArchetypeId.CONTROL_PID,
    description:
      "Feedback PID controller with proportional-integral-derivative action, derivative low-pass filter, and output clamping anti-windup.",
    provenance: "Seborg, Edgar, Mellichamp & Doyle, Process Dynamics and Control (4th ed., Ch. 8)",
    params: [
      ["Kc", 2.0, "1", "Controller proportional gain"],
      ["tauI", 10.0, "s", "Integral reset time constant"],
      ["tauD", 0.5, "s", "Derivative time constant"],
      ["uBias", 0.5, "1", "Nominal controller output bias"],
      ["uMin", 0.0, "1", "Minimum controller output"],
      ["uMax", 1.0, "1", "Maximum controller output"],
      ["tauF", 0.2, "s", "Derivative filter time constant"],
    ],
  },
  {
    modelType: "PML_Sensor",
    aliases: ["sensor", "Transmitter"],
    label: "Process Measurement Transmitter",
    category: "Control",
    archetypeId: GpromsArchetypeId.SENSOR,
    description:
      "First-order process transmitter modeling thermocouple, pressure transducer, or analyzer measurement lag.",
    provenance: "Seborg, Edgar, Mellichamp & Doyle, Process Dynamics and Control (4th ed., Ch. 9)",
    params: [
      ["tau", 2.0, "s", "Sensor measurement lag time constant"],
      ["gain", 1.0, "1", "Transmitter calibration gain"],
      ["bias", 0.0, "1", "Zero offset bias"],
    ],
  },
  {
    modelType: "PROP_PengRobinson",
    aliases: ["pr", "PengRobinson", "PR_EOS"],
    label: "Peng-Robinson Cubic EOS",
    category: "Property Package",
    archetypeId: GpromsArchetypeId.PROPERTY_PKG,
    description:
      "Peng-Robinson cubic equation of state computing vapor/liquid compressibility factor Z, fugacity, and enthalpy departure.",
    provenance: "Peng & Robinson, Ind. Eng. Chem. Fundam. 15(1):59-64 (1976)",
    params: [
      ["Tc", 369.83, "K", "Critical temperature (default propane)"],
      ["Pc", 4248000.0, "Pa", "Critical pressure"],
      ["omega", 0.1523, "1", "Acentric factor"],
      ["mw", 0.0441, "kg/mol", "Molar mass"],
    ],
  },
  {
    modelType: "PROP_NRTL",
    aliases: ["nrtl", "NRTL"],
    label: "NRTL Activity Coefficient Model",
    category: "Property Package",
    archetypeId: GpromsArchetypeId.PROPERTY_PKG,
    description:
      "Non-Random Two-Liquid (NRTL) excess Gibbs energy model for non-ideal liquid-phase activity coefficients and VLE/LLE.",
    provenance: "Renon & Prausnitz, AIChE Journal 14(1):135-144 (1968)",
    params: [
      ["Tc", 513.9, "K", "Reference critical temperature"],
      ["Pc", 6148000.0, "Pa", "Reference critical pressure"],
      ["alpha12", 0.3, "1", "Non-randomness parameter alpha_12"],
      ["tau12", 0.85, "1", "Binary interaction energy parameter tau_12"],
    ],
  },
  {
    modelType: "PROP_IAPWS_IF97",
    aliases: ["iapws", "IF97", "SteamTables"],
    label: "IAPWS-IF97 Industrial Water & Steam",
    category: "Property Package",
    archetypeId: GpromsArchetypeId.PROPERTY_PKG,
    description:
      "IAPWS Industrial Formulation 1997 thermodynamic property package for compressed water, steam, and supercritical regions.",
    provenance: "IAPWS-IF97: Wagner et al., J. Eng. Gas Turbines Power 122(1):150-184 (2000)",
    params: [
      ["Tc", 647.096, "K", "Water critical temperature"],
      ["Pc", 22064000.0, "Pa", "Water critical pressure"],
      ["omega", 0.344, "1", "Water acentric factor"],
      ["mw", 0.018015, "kg/mol", "Water molar mass"],
    ],
  },
  {
    modelType: "CAPE_OPEN_ForeignObject",
    aliases: ["cape_open", "ForeignObject", "CAPEOPEN"],
    label: "CAPE-OPEN 1.1 Foreign Object Wrapper",
    category: "Property Package",
    archetypeId: GpromsArchetypeId.PROPERTY_PKG,
    description:
      "Standardized CAPE-OPEN 1.1 / FMI co-simulation bridge for linking external thermodynamic packages or vendor unit operations.",
    provenance: "CO-LaN CAPE-OPEN 1.1 Thermodynamic and Physical Properties / Unit Operation Interface Specification",
    params: [
      ["Tc", 400.0, "K", "Reference temperature scale"],
      ["Pc", 101325.0, "Pa", "Reference pressure scale"],
      ["omega", 0.0, "1", "External property scaling factor"],
      ["mw", 0.029, "kg/mol", "Reference molar mass"],
    ],
  },
];

/**
 * Converts `GPROMS_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildGpromsCleanroomSchemas(): CleanroomModelSchema[] {
  return GPROMS_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `gproms:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "chemical",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "gproms_pml_model",
      width: 92,
      height: 52,
      svg: generateGpromsBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
