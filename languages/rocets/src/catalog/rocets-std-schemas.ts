// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * ROCETS cleanroom rocket propulsion module archetype IDs matching `assets/rocets-std-lib/src/models.ts`.
 */
export const RocetsArchetypeId = {
  // Turbomachinery
  PUMP: 1,
  TURBINE: 2,
  INDUCER: 3,
  SHAFT: 4,
  GEARBOX: 5,
  // Combustion & Nozzle
  CHAMBER: 10,
  PREBURNER: 11,
  GASGEN: 12,
  NOZZLE: 13,
  INJECTOR: 14,
  IGNITER: 15,
  // Fluid Network & Valves
  PIPE: 20,
  VOLUME: 21,
  VALVE: 22,
  ORIFICE: 23,
  CHECKVALVE: 24,
  REGULATOR: 25,
  SPLIT: 26,
  JOIN: 27,
  HEATX: 28,
  COOLING_JACKET: 29,
  // Tanks & Pressurization
  TANK: 30,
  PRESSURANT: 31,
  ULLAGE: 32,
  // Propellant Property Tables
  FLUID_LOX: 40,
  FLUID_LH2: 41,
  FLUID_RP1: 42,
  FLUID_CH4: 43,
  FLUID_N2O4: 44,
  FLUID_MMH: 45,
} as const;

export type RocetsArchetypeId = (typeof RocetsArchetypeId)[keyof typeof RocetsArchetypeId];

export type RocetsModelCategory =
  | "Turbomachinery"
  | "Combustion & Nozzle"
  | "Fluid Network & Valves"
  | "Tanks & Pressurization"
  | "Propellant Properties";

export interface RocetsModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: RocetsModelCategory;
  archetypeId: RocetsArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<RocetsModelCategory, { fill: string; stroke: string; badge: string }> = {
  Turbomachinery: { fill: "#1e3a5f", stroke: "#60a5fa", badge: "TURB" },
  "Combustion & Nozzle": { fill: "#4a1d1d", stroke: "#f97316", badge: "COMB" },
  "Fluid Network & Valves": { fill: "#163b3b", stroke: "#2dd4bf", badge: "FLUD" },
  "Tanks & Pressurization": { fill: "#2e2447", stroke: "#c084fc", badge: "TANK" },
  "Propellant Properties": { fill: "#1e3f2f", stroke: "#34d399", badge: "PROP" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a ROCETS propulsion module.
 */
export function generateRocetsBlockSvg(modelType: string, category: RocetsModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  const fontSize = label.length > 8 ? "8.2" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: RocetsModelSpec): DiagramPortSpec[] {
  switch (spec.category) {
    case "Turbomachinery":
      if (spec.modelType === "SHAFT" || spec.modelType === "GEARBOX") {
        return [
          { name: "shaft_in", kind: "mechanical", side: "left", dx: 0, dy: 26 },
          { name: "shaft_out", kind: "mechanical", side: "right", dx: 88, dy: 26 },
        ];
      }
      return [
        { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 26 },
        { name: "discharge", kind: "fluid", side: "right", dx: 88, dy: 26 },
        { name: "shaft", kind: "mechanical", side: "bottom", dx: 44, dy: 52 },
      ];
    case "Combustion & Nozzle":
      if (spec.modelType === "NOZZLE") {
        return [
          { name: "chamber_in", kind: "fluid", side: "left", dx: 0, dy: 26 },
          { name: "exhaust_out", kind: "fluid", side: "right", dx: 88, dy: 26 },
          { name: "thrust", kind: "signal", side: "top", dx: 44, dy: 0 },
        ];
      }
      return [
        { name: "ox_in", kind: "fluid", side: "left", dx: 0, dy: 16 },
        { name: "fuel_in", kind: "fluid", side: "left", dx: 0, dy: 36 },
        { name: "gas_out", kind: "fluid", side: "right", dx: 88, dy: 26 },
      ];
    case "Fluid Network & Valves":
      if (spec.modelType === "VALVE" || spec.modelType === "REGULATOR") {
        return [
          { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 26 },
          { name: "outlet", kind: "fluid", side: "right", dx: 88, dy: 26 },
          { name: "cmd", kind: "signal", side: "top", dx: 44, dy: 0 },
        ];
      }
      if (spec.modelType === "SPLIT") {
        return [
          { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 26 },
          { name: "out1", kind: "fluid", side: "right", dx: 88, dy: 16 },
          { name: "out2", kind: "fluid", side: "right", dx: 88, dy: 36 },
        ];
      }
      if (spec.modelType === "JOIN") {
        return [
          { name: "in1", kind: "fluid", side: "left", dx: 0, dy: 16 },
          { name: "in2", kind: "fluid", side: "left", dx: 0, dy: 36 },
          { name: "outlet", kind: "fluid", side: "right", dx: 88, dy: 26 },
        ];
      }
      if (spec.modelType === "HEATX" || spec.modelType === "COOLING_JACKET") {
        return [
          { name: "cool_in", kind: "fluid", side: "left", dx: 0, dy: 26 },
          { name: "cool_out", kind: "fluid", side: "right", dx: 88, dy: 26 },
          { name: "heat_in", kind: "thermal", side: "top", dx: 44, dy: 0 },
        ];
      }
      return [
        { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 26 },
        { name: "outlet", kind: "fluid", side: "right", dx: 88, dy: 26 },
      ];
    case "Tanks & Pressurization":
      return [
        { name: "press_in", kind: "fluid", side: "top", dx: 44, dy: 0 },
        { name: "outlet", kind: "fluid", side: "right", dx: 88, dy: 26 },
      ];
    case "Propellant Properties":
      return [
        { name: "state_in", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "props_out", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
  }
}

export const ROCETS_MODEL_SPECS: RocetsModelSpec[] = [
  // ─── Turbomachinery ──────────────────────────────────────────────────────
  {
    modelType: "PUMP",
    aliases: ["TP_PUMP", "CENTRIFUGAL_PUMP"],
    label: "Centrifugal Propellant Pump",
    category: "Turbomachinery",
    archetypeId: RocetsArchetypeId.PUMP,
    description: "Liquid propellant centrifugal turbopump stage with affinity-law head/torque characteristics.",
    provenance: "Huzel & Huang (AIAA, 1992) Ch. 6; NASA SP-8107 Liquid Rocket Engine Turbopump Inducers & Pumps",
    params: [
      ["designFlow", 50.0, "kg/s", "Design mass flow rate"],
      ["designHead", 1500.0, "m", "Design pump head at rated speed"],
      ["designRpm", 30000.0, "rpm", "Design shaft rotational speed"],
      ["efficiency", 0.78, "1", "Hydraulic efficiency at design point"],
      ["shutoffHeadRatio", 1.25, "1", "Zero-flow shutoff head to design head ratio"],
      ["density", 1141.0, "kg/m3", "Nominal liquid propellant density"],
      ["cp", 1699.0, "J/(kg.K)", "Liquid specific heat capacity"],
    ],
  },
  {
    modelType: "TURBINE",
    aliases: ["TP_TURBINE", "GAS_TURBINE"],
    label: "Drive Gas Turbine",
    category: "Turbomachinery",
    archetypeId: RocetsArchetypeId.TURBINE,
    description: "Axial impulse/reaction drive gas turbine expanding hot gas to power the turbopump shaft.",
    provenance: "Sutton & Biblarz (9th ed.) Ch. 10; NASA SP-8110 Liquid Rocket Engine Turbines",
    params: [
      ["designFlow", 15.0, "kg/s", "Design turbine gas mass flow rate"],
      ["pressureRatio", 1.85, "1", "Design total-to-total pressure ratio"],
      ["efficiency", 0.82, "1", "Isentropic total-to-total efficiency"],
      ["designRpm", 30000.0, "rpm", "Design shaft rotational speed"],
      ["cpGas", 2800.0, "J/(kg.K)", "Drive gas constant-pressure specific heat"],
      ["gamma", 1.32, "1", "Drive gas ratio of specific heats"],
    ],
  },
  {
    modelType: "INDUCER",
    aliases: ["CAV_INDUCER", "BOOST_PUMP"],
    label: "Cavitating Axial Inducer",
    category: "Turbomachinery",
    archetypeId: RocetsArchetypeId.INDUCER,
    description: "Low-NPSH axial-flow inducer boosting inlet pressure upstream of the main impeller.",
    provenance: "NASA SP-8052 Liquid Rocket Engine Turbopump Inducers; Huzel & Huang Ch. 6",
    params: [
      ["designFlow", 50.0, "kg/s", "Design mass flow rate"],
      ["designHead", 180.0, "m", "Design inducer head rise"],
      ["designRpm", 30000.0, "rpm", "Design rotational speed"],
      ["efficiency", 0.68, "1", "Inducer hydraulic efficiency"],
      ["shutoffHeadRatio", 1.35, "1", "Shutoff-to-design head ratio"],
      ["density", 1141.0, "kg/m3", "Nominal propellant density"],
      ["suctionSpecificSpeed", 35000.0, "1", "Design suction specific speed"],
    ],
  },
  {
    modelType: "SHAFT",
    aliases: ["ROTOR", "TP_SHAFT"],
    label: "Turbopump Rotor Shaft",
    category: "Turbomachinery",
    archetypeId: RocetsArchetypeId.SHAFT,
    description: "Common rotating mechanical shaft integrating net turbine-minus-pump torque.",
    provenance: "NASA SP-1252 / ROCETS Turbopump Rotor Dynamics Formulation; Sutton Ch. 10",
    params: [
      ["designRpm", 30000.0, "rpm", "Nominal operating speed"],
      ["inertia", 0.08, "kg.m2", "Polar moment of inertia of rotating assembly"],
      ["frictionTorque", 4.0, "N.m", "Bearing and seal viscous friction torque"],
      ["maxRpm", 45000.0, "rpm", "Maximum allowable overspeed limit"],
    ],
  },
  {
    modelType: "GEARBOX",
    aliases: ["REDUCER", "GEAR_TRAIN"],
    label: "Turbopump Reduction Gearbox",
    category: "Turbomachinery",
    archetypeId: RocetsArchetypeId.GEARBOX,
    description: "Mechanical speed reduction gear train coupling high-speed turbine to low-speed pump.",
    provenance: "Huzel & Huang Ch. 6; NASA SP-8100 Liquid Rocket Engine Turbopump Gears",
    params: [
      ["gearRatio", 2.5, "1", "Input-to-output speed reduction ratio"],
      ["mechEfficiency", 0.97, "1", "Gear mesh mechanical transmission efficiency"],
      ["inertia", 0.02, "kg.m2", "Equivalent output-referred inertia"],
    ],
  },

  // ─── Combustion & Nozzle ─────────────────────────────────────────────────
  {
    modelType: "CHAMBER",
    aliases: ["MCC", "MAIN_CHAMBER", "THRUST_CHAMBER"],
    label: "Main Combustion Chamber",
    category: "Combustion & Nozzle",
    archetypeId: RocetsArchetypeId.CHAMBER,
    description: "Transient rocket combustion chamber with c-star throat choking and ideal-gas pressure dynamics.",
    provenance: "Sutton & Biblarz (9th ed.) Ch. 3 & Ch. 8; NASA SP-1252 ROCETS Chamber Module",
    params: [
      ["throatArea", 0.045, "m2", "Nozzle throat cross-sectional area At"],
      ["cstar", 2320.0, "m/s", "Theoretical characteristic exhaust velocity c*"],
      ["cstarEff", 0.98, "1", "Combustion c* efficiency"],
      ["chamberVolume", 0.06, "m3", "Combustion chamber free volume Vc"],
      ["rGas", 620.0, "J/(kg.K)", "Combustion gas specific gas constant R"],
      ["tComb", 3450.0, "K", "Adiabatic combustion temperature Tc"],
      ["gamma", 1.2, "1", "Combustion gas ratio of specific heats"],
      ["expansionRatio", 35.0, "1", "Nozzle exit-to-throat area ratio Ae/At"],
    ],
  },
  {
    modelType: "PREBURNER",
    aliases: ["PB", "FPPB", "OPPB"],
    label: "Staged-Combustion Preburner",
    category: "Combustion & Nozzle",
    archetypeId: RocetsArchetypeId.PREBURNER,
    description: "High-pressure fuel-rich or oxidizer-rich preburner generating turbine drive gas.",
    provenance: "Huzel & Huang Ch. 4; NASA SP-1252 / SSME Staged-Combustion Preburner Model",
    params: [
      ["throatArea", 0.012, "m2", "Effective turbine-nozzle choke area"],
      ["cstar", 1650.0, "m/s", "Preburner characteristic velocity c*"],
      ["cstarEff", 0.96, "1", "Preburner combustion efficiency"],
      ["chamberVolume", 0.02, "m3", "Preburner combustion volume"],
      ["rGas", 1850.0, "J/(kg.K)", "Fuel-rich drive gas constant R"],
      ["tComb", 980.0, "K", "Preburner outlet gas temperature"],
      ["gamma", 1.34, "1", "Preburner drive gas gamma"],
    ],
  },
  {
    modelType: "GASGEN",
    aliases: ["GAS_GENERATOR", "GG"],
    label: "Open-Cycle Gas Generator",
    category: "Combustion & Nozzle",
    archetypeId: RocetsArchetypeId.GASGEN,
    description: "Open-cycle propellant gas generator supplying low-temperature turbine drive gas.",
    provenance: "Sutton & Biblarz (9th ed.) Ch. 10; Huzel & Huang Ch. 7",
    params: [
      ["throatArea", 0.008, "m2", "Gas generator effective nozzle area"],
      ["cstar", 1420.0, "m/s", "Gas generator characteristic velocity c*"],
      ["cstarEff", 0.95, "1", "Combustion efficiency"],
      ["chamberVolume", 0.015, "m3", "Gas generator volume"],
      ["rGas", 520.0, "J/(kg.K)", "Gas generator exhaust gas constant"],
      ["tComb", 900.0, "K", "Target turbine inlet temperature"],
      ["gamma", 1.28, "1", "Exhaust gas specific heat ratio"],
    ],
  },
  {
    modelType: "NOZZLE",
    aliases: ["CD_NOZZLE", "BELL_NOZZLE"],
    label: "Convergent-Divergent Nozzle",
    category: "Combustion & Nozzle",
    archetypeId: RocetsArchetypeId.NOZZLE,
    description: "Isentropic choked supersonic rocket nozzle computing mdot = Pc*At/c*, Cf, thrust, and Isp.",
    provenance: "Sutton & Biblarz (9th ed.) Ch. 3 Eqs. 3-24 to 3-32; NASA SP-8120 Rocket Engine Nozzles",
    params: [
      ["throatArea", 0.045, "m2", "Nozzle throat area At"],
      ["expansionRatio", 35.0, "1", "Nozzle area expansion ratio Ae/At"],
      ["cstar", 2320.0, "m/s", "Characteristic velocity c*"],
      ["gamma", 1.2, "1", "Exhaust gas specific heat ratio"],
      ["cfEff", 0.98, "1", "Nozzle thrust coefficient efficiency"],
      ["pAmbient", 101325.0, "Pa", "Ambient atmospheric back pressure"],
    ],
  },
  {
    modelType: "INJECTOR",
    aliases: ["INJ", "MAIN_INJECTOR"],
    label: "Propellant Main Injector",
    category: "Combustion & Nozzle",
    archetypeId: RocetsArchetypeId.INJECTOR,
    description: "Coaxial/impinging injector face hydraulic resistance and pressure drop stiffness model.",
    provenance: "NASA SP-8089 Liquid Rocket Engine Injectors; Huzel & Huang Ch. 4",
    params: [
      ["cdA", 0.0018, "m2", "Effective discharge coefficient times orifice area"],
      ["density", 1141.0, "kg/m3", "Injected propellant density"],
      ["stiffnessTarget", 0.15, "1", "Design injector dP/Pc stability margin"],
    ],
  },
  {
    modelType: "IGNITER",
    aliases: ["TORCH_IGNITER", "ASI"],
    label: "Augmented Spark / Torch Igniter",
    category: "Combustion & Nozzle",
    archetypeId: RocetsArchetypeId.IGNITER,
    description: "Hypergolic or torch igniter providing startup thermal power and pilot mass flow.",
    provenance: "NASA SP-8051 Solid/Liquid Rocket Engine Igniters; Sutton Ch. 8",
    params: [
      ["pilotFlow", 0.25, "kg/s", "Nominal igniter pilot mass flow rate"],
      ["thermalPowerW", 2.5e6, "W", "Igniter flame thermal heat release"],
      ["burnDuration", 1.5, "s", "Nominal igniter firing duration"],
    ],
  },

  // ─── Fluid Network & Valves ──────────────────────────────────────────────
  {
    modelType: "PIPE",
    aliases: ["LINE", "DUCT", "FEEDLINE"],
    label: "Propellant Feedline / Pipe",
    category: "Fluid Network & Valves",
    archetypeId: RocetsArchetypeId.PIPE,
    description: "1-D propellant duct with fluid inertance (L/A) and Darcy-Weisbach friction loss.",
    provenance: "NASA SP-1252 ROCETS Fluid Line Module; Streeter & Wylie Fluid Transients",
    params: [
      ["length", 2.0, "m", "Pipe centerline length L"],
      ["diameter", 0.08, "m", "Internal pipe diameter D"],
      ["frictionFactor", 0.02, "1", "Darcy-Weisbach friction factor f"],
      ["density", 1141.0, "kg/m3", "Nominal fluid density"],
      ["kMinor", 0.5, "1", "Minor bend and fitting loss coefficient K"],
    ],
  },
  {
    modelType: "VOLUME",
    aliases: ["PLENUM", "MANIFOLD", "CAVITY"],
    label: "Fluid Capacitance Volume",
    category: "Fluid Network & Valves",
    archetypeId: RocetsArchetypeId.VOLUME,
    description: "Lumped fluid capacitance manifold integrating net mass inflow via bulk modulus.",
    provenance: "NASA SP-1252 ROCETS Volume Node; Huzel & Huang Ch. 10 Fluid Transients",
    params: [
      ["volume", 0.015, "m3", "Internal fluid volume V"],
      ["bulkModulus", 8.0e8, "Pa", "Effective fluid/wall bulk modulus beta"],
      ["density", 1141.0, "kg/m3", "Nominal fluid density"],
      ["initPressure", 1.0e7, "Pa", "Initial steady-state manifold pressure"],
    ],
  },
  {
    modelType: "VALVE",
    aliases: ["CONTROL_VALVE", "MOV", "MFV"],
    label: "Propellant Control Valve",
    category: "Fluid Network & Valves",
    archetypeId: RocetsArchetypeId.VALVE,
    description: "Actuated propellant control valve with first-order stroke lag and CdA/Cv flow law.",
    provenance: "NASA SP-8097 Liquid Rocket Valve Components; ISA-75.01 / Huzel & Huang Ch. 7",
    params: [
      ["cdAMax", 0.002, "m2", "Fully open effective discharge area Cd*A"],
      ["initPosition", 1.0, "1", "Initial normalized valve stroke (0..1)"],
      ["openTime", 0.15, "s", "Actuator first-order stroke time constant"],
      ["density", 1141.0, "kg/m3", "Nominal propellant density"],
      ["cvMax", 140.0, "gpm/psi^0.5", "Equivalent valve flow coefficient Cv"],
    ],
  },
  {
    modelType: "ORIFICE",
    aliases: ["TRIM_ORIFICE", "RESTRICTOR", "VENTURI"],
    label: "Fixed Trim Orifice / Venturi",
    category: "Fluid Network & Valves",
    archetypeId: RocetsArchetypeId.ORIFICE,
    description: "Sharp-edged calibration orifice or cavitating venturi for steady hydraulic balancing.",
    provenance: "NASA SP-1252; Crane Technical Paper 410 / ISO 5167",
    params: [
      ["cdA", 0.0012, "m2", "Effective orifice area Cd*A"],
      ["density", 1141.0, "kg/m3", "Nominal fluid density"],
      ["cavitatingRecovery", 0.85, "1", "Venturi pressure recovery factor"],
    ],
  },
  {
    modelType: "CHECKVALVE",
    aliases: ["CHECK_VALVE", "NRV"],
    label: "Non-Return Check Valve",
    category: "Fluid Network & Valves",
    archetypeId: RocetsArchetypeId.CHECKVALVE,
    description: "One-way propellant check valve with cracking pressure threshold preventing backflow.",
    provenance: "NASA SP-8097 Liquid Rocket Valve Components",
    params: [
      ["cdA", 0.0015, "m2", "Open effective flow area Cd*A"],
      ["crackingPressure", 35000.0, "Pa", "Forward cracking pressure differential"],
      ["density", 1141.0, "kg/m3", "Nominal fluid density"],
    ],
  },
  {
    modelType: "REGULATOR",
    aliases: ["PRESSURE_REGULATOR", "PREG"],
    label: "Dome-Loaded Pressure Regulator",
    category: "Fluid Network & Valves",
    archetypeId: RocetsArchetypeId.REGULATOR,
    description: "Closed-loop pneumatic/hydraulic pressure regulator modulating flow to maintain outlet setpoint.",
    provenance: "NASA SP-8097; Huzel & Huang Ch. 7 Pressurization Control",
    params: [
      ["pSetpoint", 3.5e5, "Pa", "Target regulated outlet pressure"],
      ["cdAMax", 0.0004, "m2", "Maximum regulator orifice area"],
      ["droopGain", 2.0e-5, "1/Pa", "Proportional pressure droop sensitivity"],
      ["density", 4.5, "kg/m3", "Regulated pressurant gas density"],
    ],
  },
  {
    modelType: "SPLIT",
    aliases: ["SPLITTER", "TEE", "JUNCTION"],
    label: "Flow Splitter Manifold",
    category: "Fluid Network & Valves",
    archetypeId: RocetsArchetypeId.SPLIT,
    description: "Hydraulic tee splitting an inlet stream into primary and secondary branches.",
    provenance: "NASA SP-1252 ROCETS Flow Junction Formulation",
    params: [
      ["splitFraction", 0.7, "1", "Mass flow fraction routed to primary outlet"],
      ["kLoss", 0.15, "1", "Branch junction loss coefficient"],
    ],
  },
  {
    modelType: "JOIN",
    aliases: ["MIXER", "COMBINER", "WYE"],
    label: "Flow Mixer / Combiner",
    category: "Fluid Network & Valves",
    archetypeId: RocetsArchetypeId.JOIN,
    description: "Enthalpy-conserving fluid junction combining two incoming propellant or gas streams.",
    provenance: "NASA SP-1252 ROCETS Mixer Node",
    params: [
      ["cpPrimary", 1700.0, "J/(kg.K)", "Primary stream specific heat"],
      ["cpSecondary", 1700.0, "J/(kg.K)", "Secondary stream specific heat"],
      ["kLoss", 0.2, "1", "Mixing pressure loss coefficient"],
    ],
  },
  {
    modelType: "HEATX",
    aliases: ["HEX", "HEAT_EXCHANGER"],
    label: "Propellant Heat Exchanger",
    category: "Fluid Network & Valves",
    archetypeId: RocetsArchetypeId.HEATX,
    description: "Shell-and-tube or helical heat exchanger for autogenous pressurant vaporization.",
    provenance: "Huzel & Huang Ch. 4; Incropera & DeWitt Heat Transfer NTU Formulation",
    params: [
      ["ua", 12000.0, "W/K", "Overall heat transfer conductance U*A"],
      ["tHot", 850.0, "K", "Hot-side boundary gas temperature"],
      ["cpCold", 2400.0, "J/(kg.K)", "Cold-side propellant specific heat"],
      ["dpDesign", 1.5e5, "Pa", "Nominal cold-side friction pressure drop"],
    ],
  },
  {
    modelType: "COOLING_JACKET",
    aliases: ["REGEN_JACKET", "COOLANT_CHANNEL"],
    label: "Regenerative Cooling Jacket",
    category: "Fluid Network & Valves",
    archetypeId: RocetsArchetypeId.COOLING_JACKET,
    description: "Nozzle and combustion chamber regenerative coolant channels absorbing wall heat flux.",
    provenance: "Bartz (1957) Jet Propulsion; Sutton & Biblarz (9th ed.) Ch. 8; Huzel & Huang Ch. 4",
    params: [
      ["surfaceArea", 1.5, "m2", "Heated chamber/nozzle wall surface area"],
      ["heatFlux", 2.5e7, "W/m2", 'Average convective wall heat flux q"'],
      ["cpCoolant", 14300.0, "J/(kg.K)", "Coolant specific heat capacity"],
      ["dpNominal", 1.8e6, "Pa", "Nominal coolant channel pressure drop"],
      ["designFlow", 25.0, "kg/s", "Design coolant mass flow rate"],
    ],
  },

  // ─── Tanks & Pressurization ──────────────────────────────────────────────
  {
    modelType: "TANK",
    aliases: ["PROPELLANT_TANK", "CRYO_TANK"],
    label: "Cryogenic Propellant Tank",
    category: "Tanks & Pressurization",
    archetypeId: RocetsArchetypeId.TANK,
    description: "Propellant storage tank tracking liquid mass depletion and hydrostatic outlet head.",
    provenance: "Sutton & Biblarz (9th ed.) Ch. 6; NASA SP-8080 Liquid Rocket Pressure Vessels",
    params: [
      ["initMass", 50000.0, "kg", "Initial liquid propellant mass"],
      ["ullagePressure", 3.2e5, "Pa", "Nominal tank ullage pressure"],
      ["density", 1141.0, "kg/m3", "Stored liquid propellant density"],
      ["crossArea", 10.0, "m2", "Tank cylindrical cross-sectional area"],
      ["axialAccelG", 1.0, "g", "Vehicle axial acceleration in standard gravities"],
    ],
  },
  {
    modelType: "PRESSURANT",
    aliases: ["COPV", "HE_BOTTLE", "PRESS_BOTTLE"],
    label: "High-Pressure Pressurant Bottle",
    category: "Tanks & Pressurization",
    archetypeId: RocetsArchetypeId.PRESSURANT,
    description: "Composite overwrapped pressure vessel (COPV) helium/nitrogen blowdown storage tank.",
    provenance: "Huzel & Huang Ch. 5 Pressurization Systems; NIST Real-Gas Helium Blowdown",
    params: [
      ["volume", 0.45, "m3", "Pressurant bottle internal volume"],
      ["initPressure", 3.1e7, "Pa", "Initial fill pressure (310 bar)"],
      ["initTemp", 293.0, "K", "Initial gas temperature"],
      ["rGas", 2077.0, "J/(kg.K)", "Pressurant specific gas constant (Helium)"],
      ["gamma", 1.66, "1", "Pressurant ratio of specific heats"],
    ],
  },
  {
    modelType: "ULLAGE",
    aliases: ["ULLAGE_GAS", "GAS_SPACE"],
    label: "Tank Ullage Gas Space",
    category: "Tanks & Pressurization",
    archetypeId: RocetsArchetypeId.ULLAGE,
    description: "Variable-volume tank ullage gas space balancing pressurant inflow against propellant outflow.",
    provenance: "NASA SP-1252; Huzel & Huang Ch. 5 Tank Ullage Thermodynamics",
    params: [
      ["initVolume", 4.0, "m3", "Initial ullage gas volume"],
      ["initPressure", 3.2e5, "Pa", "Initial ullage pressure"],
      ["gasTemp", 220.0, "K", "Mean ullage gas temperature"],
      ["rGas", 2077.0, "J/(kg.K)", "Ullage gas specific gas constant"],
      ["gamma", 1.66, "1", "Ullage gas specific heat ratio"],
      ["propDensity", 1141.0, "kg/m3", "Displaced liquid propellant density"],
    ],
  },

  // ─── Propellant Property Tables ──────────────────────────────────────────
  {
    modelType: "FLUID_LOX",
    aliases: ["LOX", "O2_LIQ"],
    label: "Liquid Oxygen (LOX) Properties",
    category: "Propellant Properties",
    archetypeId: RocetsArchetypeId.FLUID_LOX,
    description: "Subcooled/saturated Liquid Oxygen density and enthalpy table around 90.2 K NBP.",
    provenance: "NIST Chemistry WebBook (SRD 69) / NASA RP-1311 (CEA) Oxygen Properties",
    params: [
      ["tRef", 90.19, "K", "Normal boiling point reference temperature"],
      ["rhoRef", 1141.0, "kg/m3", "Reference liquid density at NBP"],
      ["cp", 1699.0, "J/(kg.K)", "Isobaric specific heat capacity"],
      ["alphaT", 0.0043, "1/K", "Thermal expansion coefficient"],
      ["kappaP", 1.5e-9, "1/Pa", "Isothermal compressibility"],
      ["hRef", -133400.0, "J/kg", "Reference specific enthalpy at NBP"],
    ],
  },
  {
    modelType: "FLUID_LH2",
    aliases: ["LH2", "H2_LIQ"],
    label: "Liquid Hydrogen (LH2) Properties",
    category: "Propellant Properties",
    archetypeId: RocetsArchetypeId.FLUID_LH2,
    description: "Cryogenic para-Hydrogen liquid density and enthalpy table around 20.3 K NBP.",
    provenance: "NIST Chemistry WebBook (SRD 69) / Leachman et al. (2009) Para-Hydrogen EOS",
    params: [
      ["tRef", 20.27, "K", "Normal boiling point reference temperature"],
      ["rhoRef", 70.85, "kg/m3", "Reference liquid density at NBP"],
      ["cp", 9680.0, "J/(kg.K)", "Isobaric specific heat capacity"],
      ["alphaT", 0.0165, "1/K", "Thermal expansion coefficient"],
      ["kappaP", 1.9e-8, "1/Pa", "Isothermal compressibility"],
      ["hRef", -255000.0, "J/kg", "Reference specific enthalpy at NBP"],
    ],
  },
  {
    modelType: "FLUID_RP1",
    aliases: ["RP1", "KEROSENE"],
    label: "RP-1 Rocket Kerosene Properties",
    category: "Propellant Properties",
    archetypeId: RocetsArchetypeId.FLUID_RP1,
    description: "MIL-DTL-25576 RP-1 rocket-grade kerosene density and enthalpy property correlation.",
    provenance: "NIST Technical Note 1640 (Huber et al., 2009) RP-1 Thermophysical Properties",
    params: [
      ["tRef", 293.15, "K", "Standard reference temperature"],
      ["rhoRef", 806.0, "kg/m3", "Reference liquid density at 293.15 K"],
      ["cp", 2010.0, "J/(kg.K)", "Isobaric specific heat capacity"],
      ["alphaT", 0.00092, "1/K", "Thermal expansion coefficient"],
      ["kappaP", 8.5e-10, "1/Pa", "Isothermal compressibility"],
      ["hRef", 0.0, "J/kg", "Reference specific enthalpy at 293.15 K"],
    ],
  },
  {
    modelType: "FLUID_CH4",
    aliases: ["LCH4", "CH4", "METHANE"],
    label: "Liquid Methane (LCH4) Properties",
    category: "Propellant Properties",
    archetypeId: RocetsArchetypeId.FLUID_CH4,
    description: "Cryogenic Liquid Methane density and enthalpy property correlation around 111.7 K NBP.",
    provenance: "NIST Chemistry WebBook (SRD 69) / Setzmann & Wagner (1991) Methane EOS",
    params: [
      ["tRef", 111.67, "K", "Normal boiling point reference temperature"],
      ["rhoRef", 422.4, "kg/m3", "Reference liquid density at NBP"],
      ["cp", 3480.0, "J/(kg.K)", "Isobaric specific heat capacity"],
      ["alphaT", 0.0034, "1/K", "Thermal expansion coefficient"],
      ["kappaP", 1.8e-9, "1/Pa", "Isothermal compressibility"],
      ["hRef", -285000.0, "J/kg", "Reference specific enthalpy at NBP"],
    ],
  },
  {
    modelType: "FLUID_N2O4",
    aliases: ["N2O4", "NTO"],
    label: "Nitrogen Tetroxide (N2O4) Properties",
    category: "Propellant Properties",
    archetypeId: RocetsArchetypeId.FLUID_N2O4,
    description: "Storable hypergolic oxidizer Nitrogen Tetroxide (NTO) density and enthalpy table.",
    provenance: "Sutton & Biblarz (9th ed.) Table 7-1; NASA SP-3004 Storable Propellant Properties",
    params: [
      ["tRef", 293.15, "K", "Standard reference temperature"],
      ["rhoRef", 1447.0, "kg/m3", "Reference liquid density at 293.15 K"],
      ["cp", 1545.0, "J/(kg.K)", "Isobaric specific heat capacity"],
      ["alphaT", 0.0016, "1/K", "Thermal expansion coefficient"],
      ["kappaP", 9.0e-10, "1/Pa", "Isothermal compressibility"],
      ["hRef", 0.0, "J/kg", "Reference specific enthalpy at 293.15 K"],
    ],
  },
  {
    modelType: "FLUID_MMH",
    aliases: ["MMH", "MONOMETHYLHYDRAZINE"],
    label: "Monomethylhydrazine (MMH) Properties",
    category: "Propellant Properties",
    archetypeId: RocetsArchetypeId.FLUID_MMH,
    description: "Storable hypergolic fuel Monomethylhydrazine density and enthalpy property table.",
    provenance: "Sutton & Biblarz (9th ed.) Table 7-1; AIAA G-095 / NASA Storable Propellants",
    params: [
      ["tRef", 293.15, "K", "Standard reference temperature"],
      ["rhoRef", 874.0, "kg/m3", "Reference liquid density at 293.15 K"],
      ["cp", 2930.0, "J/(kg.K)", "Isobaric specific heat capacity"],
      ["alphaT", 0.00105, "1/K", "Thermal expansion coefficient"],
      ["kappaP", 6.5e-10, "1/Pa", "Isothermal compressibility"],
      ["hRef", 0.0, "J/kg", "Reference specific enthalpy at 293.15 K"],
    ],
  },
];

/**
 * Converts `ROCETS_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG block icons and port layouts.
 */
export function buildRocetsCleanroomSchemas(): CleanroomModelSchema[] {
  return ROCETS_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `rocets:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "aerospace",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "rocets_module",
      width: 88,
      height: 52,
      svg: generateRocetsBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
