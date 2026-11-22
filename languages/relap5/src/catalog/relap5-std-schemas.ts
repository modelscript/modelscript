// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * RELAP5 cleanroom thermal-hydraulics & reactor kinetics archetype IDs matching
 * `assets/relap5-std-lib/src/models.ts`.
 */
export const Relap5ArchetypeId = {
  // Hydrodynamic Volumes (1..9)
  HYDRO_VOLUME: 1, // SNGLVOL, PIPE, ANNULUS, BRANCH
  HYDRO_TMDPVOL: 2, // TMDPVOL
  HYDRO_ACCUM: 3, // ACCUM
  HYDRO_PRIZER: 4, // PRIZER
  HYDRO_SEPARATOR: 5, // SEPARATOR

  // Hydrodynamic Junctions & Valves (10..19)
  JUNCTION_ORIFICE: 10, // SNGLJUN, TMDPJUN
  VALVE_TRIP: 11, // VALVE_TRIP
  VALVE_MOTOR: 12, // VALVE_MOTOR
  VALVE_CHECK: 13, // VALVE_CHECK
  VALVE_RELIEF: 14, // VALVE_RELIEF

  // Turbomachinery (20..29)
  PUMP_CENTRIFUGAL: 20, // PUMP
  TURBINE_STAGE: 21, // TURBINE

  // Heat Structures (30..39)
  HTSTR_FUEL_ROD: 30, // HTSTR_FUEL_ROD
  HTSTR_SG_TUBE: 31, // HTSTR_SG_TUBE

  // Heat Transfer & Boiling / CHF Correlations (40..49)
  CORR_DITTUS_BOELTER: 40, // CORR_DITTUS_BOELTER
  CORR_CHEN_BOILING: 41, // CORR_CHEN_BOILING
  CORR_ZUBER_CHF: 42, // CORR_ZUBER_CHF
  CORR_GROENEVELD_CHF: 43, // CORR_GROENEVELD_CHF

  // Reactor Kinetics & Fluid Property Tables (50..59)
  POINT_KINETICS_6G: 50, // POINT_KINETICS_6G
  DECAY_HEAT_ANS79: 51, // DECAY_HEAT_ANS79
  STEAM_IAPWS_IF97: 52, // STEAM_IAPWS_IF97
} as const;

export type Relap5ArchetypeId = (typeof Relap5ArchetypeId)[keyof typeof Relap5ArchetypeId];

export type Relap5ModelCategory =
  | "Hydrodynamic Volume"
  | "Hydrodynamic Junction"
  | "Turbomachinery / Valve"
  | "Heat Structure"
  | "Boiling / CHF Correlation"
  | "Reactor Kinetics"
  | "Fluid Properties";

export interface Relap5ModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: Relap5ModelCategory;
  archetypeId: Relap5ArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<Relap5ModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Hydrodynamic Volume": { fill: "#172554", stroke: "#60a5fa", badge: "VOL" },
  "Hydrodynamic Junction": { fill: "#164e63", stroke: "#22d3ee", badge: "JUN" },
  "Turbomachinery / Valve": { fill: "#1e3a2f", stroke: "#34d399", badge: "VLV" },
  "Heat Structure": { fill: "#431407", stroke: "#fb923c", badge: "HTS" },
  "Boiling / CHF Correlation": { fill: "#4c1d95", stroke: "#c084fc", badge: "COR" },
  "Reactor Kinetics": { fill: "#450a0a", stroke: "#f87171", badge: "PKE" },
  "Fluid Properties": { fill: "#1e293b", stroke: "#94a3b8", badge: "STM" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a RELAP5 thermal-hydraulic or kinetics component.
 */
export function generateRelap5BlockSvg(modelType: string, category: Relap5ModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType
    .toUpperCase()
    .replace(/^CORR_|^HTSTR_|^VALVE_/, "")
    .slice(0, 10);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 48" width="88" height="48">` +
    `<rect x="2" y="2" width="84" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="34" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: Relap5ModelCategory): DiagramPortSpec[] {
  switch (category) {
    case "Hydrodynamic Volume":
      return [
        { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "outlet", kind: "fluid", side: "right", dx: 88, dy: 24 },
        { name: "heat", kind: "thermal", side: "top", dx: 44, dy: 0 },
      ];
    case "Hydrodynamic Junction":
      return [
        { name: "from_vol", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "to_vol", kind: "fluid", side: "right", dx: 88, dy: 24 },
      ];
    case "Turbomachinery / Valve":
      return [
        { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "outlet", kind: "fluid", side: "right", dx: 88, dy: 24 },
        { name: "ctrl", kind: "signal", side: "top", dx: 44, dy: 0 },
      ];
    case "Heat Structure":
      return [
        { name: "left_bound", kind: "thermal", side: "left", dx: 0, dy: 24 },
        { name: "right_bound", kind: "thermal", side: "right", dx: 88, dy: 24 },
        { name: "q_gen", kind: "signal", side: "top", dx: 44, dy: 0 },
      ];
    case "Boiling / CHF Correlation":
      return [
        { name: "fluid_state", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "htc_chf", kind: "signal", side: "right", dx: 88, dy: 24 },
      ];
    case "Reactor Kinetics":
      return [
        { name: "reactivity", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "power", kind: "signal", side: "right", dx: 88, dy: 24 },
      ];
    case "Fluid Properties":
      return [
        { name: "pressure", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "t_sat", kind: "signal", side: "right", dx: 88, dy: 24 },
      ];
  }
}

const VOLUME_BASE_PARAMS: Relap5ModelSpec["params"] = [
  ["flowArea", 0.5, "m^2", "Cross-sectional flow area"],
  ["length", 2.0, "m", "Volume hydrodynamic length"],
  ["volume", 1.0, "m^3", "Control volume fluid capacity"],
  ["elevationChange", 0.0, "m", "Vertical elevation change dz"],
  ["roughness", 1.5e-5, "m", "Wall absolute surface roughness"],
  ["hydraulicDiameter", 0.8, "m", "Hydraulic diameter Dh"],
  ["initialPressure", 15.5e6, "Pa", "Initial pressure P0"],
  ["initialTemperature", 573.15, "K", "Initial fluid temperature T0"],
];

const JUNCTION_BASE_PARAMS: Relap5ModelSpec["params"] = [
  ["flowArea", 0.1, "m^2", "Junction throat flow area"],
  ["forwardLoss", 0.5, "-", "Forward form loss coefficient K_f"],
  ["reverseLoss", 1.0, "-", "Reverse form loss coefficient K_r"],
  ["dischargeCoeff", 0.85, "-", "Orifice / valve discharge coefficient Cd"],
  ["gamma", 1.3, "-", "Isentropic expansion exponent for choked flow"],
  ["rhoRef", 720.0, "kg/m^3", "Reference upstream fluid density"],
];

export const RELAP5_MODEL_SPECS: Relap5ModelSpec[] = [
  // =========================================================================
  // 1. Hydrodynamic Volumes & Junctions (16 components)
  // =========================================================================
  {
    modelType: "SNGLVOL",
    aliases: ["snglvol", "snglv", "single_volume"],
    label: "Single Volume (SNGLVOL)",
    category: "Hydrodynamic Volume",
    archetypeId: Relap5ArchetypeId.HYDRO_VOLUME,
    description: "Single thermal-hydraulic control volume with two-phase phasic mass and energy balance.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.1",
    params: VOLUME_BASE_PARAMS,
  },
  {
    modelType: "TMDPVOL",
    aliases: ["tmdpvol", "time_dependent_volume"],
    label: "Time-Dependent Volume (TMDPVOL)",
    category: "Hydrodynamic Volume",
    archetypeId: Relap5ArchetypeId.HYDRO_TMDPVOL,
    description:
      "Boundary-condition hydrodynamic volume prescribing time-dependent pressure, temperature, and quality.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.2",
    params: [
      ["boundaryPressure", 15.5e6, "Pa", "Prescribed boundary pressure"],
      ["boundaryTemperature", 565.0, "K", "Prescribed boundary temperature"],
      ["boundaryQuality", 0.0, "-", "Prescribed static steam quality"],
    ],
  },
  {
    modelType: "PIPE",
    aliases: ["pipe", "multi_volume_pipe"],
    label: "Pipe Component (PIPE)",
    category: "Hydrodynamic Volume",
    archetypeId: Relap5ArchetypeId.HYDRO_VOLUME,
    description: "One-dimensional multi-node hydrodynamic pipe with Darcy-Weisbach wall friction and elevation head.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.3; Todreas & Kazimi Ch. 9",
    params: [...VOLUME_BASE_PARAMS, ["nodeCount", 10, "-", "Number of axial hydrodynamic volumes"]],
  },
  {
    modelType: "ANNULUS",
    aliases: ["annulus", "downcomer"],
    label: "Annulus Component (ANNULUS)",
    category: "Hydrodynamic Volume",
    archetypeId: Relap5ArchetypeId.HYDRO_VOLUME,
    description:
      "Annular flow channel specialized for reactor vessel downcomer counter-current flooding and entrainment.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.4",
    params: [
      ...VOLUME_BASE_PARAMS,
      ["innerDiameter", 3.4, "m", "Inner core barrel outer diameter"],
      ["outerDiameter", 4.0, "m", "Reactor vessel inner diameter"],
    ],
  },
  {
    modelType: "BRANCH",
    aliases: ["branch", "plenum"],
    label: "Branch Component (BRANCH)",
    category: "Hydrodynamic Volume",
    archetypeId: Relap5ArchetypeId.HYDRO_VOLUME,
    description: "Single hydrodynamic volume with up to nine attached junctions for plena, tees, and headers.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.5",
    params: [...VOLUME_BASE_PARAMS, ["junctionCount", 3, "-", "Number of connected branch junctions"]],
  },
  {
    modelType: "SNGLJUN",
    aliases: ["sngljun", "snglj", "single_junction"],
    label: "Single Junction (SNGLJUN)",
    category: "Hydrodynamic Junction",
    archetypeId: Relap5ArchetypeId.JUNCTION_ORIFICE,
    description:
      "Single momentum junction connecting two hydrodynamic volumes with form losses and homogeneous choked flow.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.6",
    params: JUNCTION_BASE_PARAMS,
  },
  {
    modelType: "TMDPJUN",
    aliases: ["tmdpjun", "tmdpj", "time_dependent_junction"],
    label: "Time-Dependent Junction (TMDPJUN)",
    category: "Hydrodynamic Junction",
    archetypeId: Relap5ArchetypeId.JUNCTION_ORIFICE,
    description: "Boundary-condition junction prescribing phasic mass flow rate or velocity as a function of time.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.7",
    params: [...JUNCTION_BASE_PARAMS, ["prescribedMassFlow", 4500.0, "kg/s", "Prescribed boundary mass flow rate"]],
  },
  {
    modelType: "PUMP",
    aliases: ["pump", "rcp"],
    label: "Centrifugal Pump (PUMP)",
    category: "Turbomachinery / Valve",
    archetypeId: Relap5ArchetypeId.PUMP_CENTRIFUGAL,
    description: "Single- and two-phase centrifugal coolant pump with homologous head and torque curves.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.9",
    params: [
      ["ratedHead", 85.0, "m", "Rated pump head H_R"],
      ["ratedFlow", 5.5, "m^3/s", "Rated volumetric flow Q_R"],
      ["ratedSpeed", 124.0, "rad/s", "Rated angular speed omega_R"],
      ["momentOfInertia", 5200.0, "kg*m^2", "Pump-motor flywheel inertia I"],
      ["rhoRef", 730.0, "kg/m^3", "Reference coolant density"],
      ["efficiency", 0.85, "-", "Hydraulic efficiency"],
    ],
  },
  {
    modelType: "VALVE_TRIP",
    aliases: ["valve_trip", "tripvlv", "trpv"],
    label: "Trip Valve (VALVE_TRIP)",
    category: "Turbomachinery / Valve",
    archetypeId: Relap5ArchetypeId.VALVE_TRIP,
    description: "Abruptly opening or closing trip-actuated isolation valve with homogeneous choked flow limit.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.8.1",
    params: [...JUNCTION_BASE_PARAMS, ["stemPosition", 1.0, "-", "Normalized valve open fraction (0=closed, 1=open)"]],
  },
  {
    modelType: "VALVE_MOTOR",
    aliases: ["valve_motor", "mtrvlv", "mov"],
    label: "Motor-Operated Valve (VALVE_MOTOR)",
    category: "Turbomachinery / Valve",
    archetypeId: Relap5ArchetypeId.VALVE_MOTOR,
    description: "Rate-limited motor-operated valve with linear stroke time and choked orifice flow.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.8.3",
    params: [
      ...JUNCTION_BASE_PARAMS,
      ["stemPosition", 1.0, "-", "Initial normalized stem position"],
      ["strokeRate", 0.1, "1/s", "Maximum stem opening/closing rate"],
    ],
  },
  {
    modelType: "VALVE_CHECK",
    aliases: ["valve_check", "chkvlv"],
    label: "Check Valve (VALVE_CHECK)",
    category: "Turbomachinery / Valve",
    archetypeId: Relap5ArchetypeId.VALVE_CHECK,
    description: "Static/dynamic swing check valve permitting forward flow and blocking reverse backflow.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.8.2",
    params: [...JUNCTION_BASE_PARAMS, ["crackingDp", 5000.0, "Pa", "Minimum forward differential pressure to open"]],
  },
  {
    modelType: "VALVE_RELIEF",
    aliases: ["valve_relief", "srvvlv", "porv"],
    label: "Safety / Relief Valve (VALVE_RELIEF)",
    category: "Turbomachinery / Valve",
    archetypeId: Relap5ArchetypeId.VALVE_RELIEF,
    description:
      "Spring-loaded safety or power-operated relief valve opening above setpoint pressure with choked discharge.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.8.5",
    params: [
      ...JUNCTION_BASE_PARAMS,
      ["setPressure", 16.2e6, "Pa", "Opening setpoint pressure"],
      ["fullOpenPressure", 16.7e6, "Pa", "Full-lift overpressure"],
    ],
  },
  {
    modelType: "TURBINE",
    aliases: ["turbine", "steam_turbine"],
    label: "Steam Turbine Stage (TURBINE)",
    category: "Turbomachinery / Valve",
    archetypeId: Relap5ArchetypeId.TURBINE_STAGE,
    description: "Impulse/reaction steam turbine stage computing isentropic enthalpy drop and mechanical shaft power.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.12",
    params: [
      ["efficiency", 0.86, "-", "Stage isentropic efficiency"],
      ["ratedMassFlow", 1500.0, "kg/s", "Design steam mass flow rate"],
      ["deltaHIsentropic", 3.2e5, "J/kg", "Nominal isentropic enthalpy drop"],
      ["reactionFraction", 0.5, "-", "Stage reaction fraction"],
    ],
  },
  {
    modelType: "SEPARATOR",
    aliases: ["separator", "separatr"],
    label: "Steam-Water Separator (SEPARATOR)",
    category: "Hydrodynamic Volume",
    archetypeId: Relap5ArchetypeId.HYDRO_SEPARATOR,
    description:
      "Mechanistic steam-water separator partitioning two-phase inlet mixture into dry steam and saturated liquid return.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.10",
    params: [
      ["volume", 12.0, "m^3", "Separator volume"],
      ["carryOverLimit", 0.0025, "-", "Maximum liquid carryover quality fraction"],
      ["carryUnderLimit", 0.01, "-", "Maximum vapor carryunder void fraction"],
    ],
  },
  {
    modelType: "ACCUM",
    aliases: ["accum", "accumulator"],
    label: "ECCS Accumulator (ACCUM)",
    category: "Hydrodynamic Volume",
    archetypeId: Relap5ArchetypeId.HYDRO_ACCUM,
    description: "Nitrogen-pressurized passive emergency core cooling accumulator with polytropic gas expansion.",
    provenance: "US NRC NUREG/CR-5535 Vol. I (RELAP5/MOD3.3 Code Manual), Section 3.13",
    params: [
      ["totalVolume", 42.0, "m^3", "Total tank volume"],
      ["liquidVolume0", 28.0, "m^3", "Initial borated water volume"],
      ["initialPressure", 4.2e6, "Pa", "Initial nitrogen cover-gas pressure"],
      ["polytropicExponent", 1.4, "-", "Nitrogen expansion exponent n"],
      ["surgeLineArea", 0.05, "m^2", "Injection surge line flow area"],
    ],
  },
  {
    modelType: "PRIZER",
    aliases: ["prizer", "pressurizer"],
    label: "PWR Pressurizer (PRIZER)",
    category: "Hydrodynamic Volume",
    archetypeId: Relap5ArchetypeId.HYDRO_PRIZER,
    description:
      "Two-region non-equilibrium PWR pressurizer with proportional heaters, spray condensation, and surge line.",
    provenance: "US NRC NUREG/CR-5535 Vol. I; Todreas & Kazimi, Nuclear Systems I, Ch. 5",
    params: [
      ["totalVolume", 51.0, "m^3", "Total pressurizer volume"],
      ["liquidVolume0", 30.0, "m^3", "Initial saturated liquid volume"],
      ["initialPressure", 15.5e6, "Pa", "Nominal primary system pressure"],
      ["heaterPowerMax", 1.8e6, "W", "Maximum electrical heater capacity"],
      ["sprayFlowMax", 50.0, "kg/s", "Maximum cold-leg spray flow rate"],
    ],
  },

  // =========================================================================
  // 2. Heat Structures & Boiling / CHF Correlations (6 components)
  // =========================================================================
  {
    modelType: "HTSTR_FUEL_ROD",
    aliases: ["htstr_fuel_rod", "fuel_rod", "htstr_fuel"],
    label: "Nuclear Fuel Rod Heat Structure (HTSTR_FUEL_ROD)",
    category: "Heat Structure",
    archetypeId: Relap5ArchetypeId.HTSTR_FUEL_ROD,
    description: "Cylindrical UO2 pellet, helium gap, and Zircaloy cladding radial heat conduction structure.",
    provenance: "US NRC NUREG/CR-5535 Vol. I, Section 4.1; Todreas & Kazimi, Nuclear Systems I, Ch. 8",
    params: [
      ["pelletRadius", 0.0041, "m", "UO2 fuel pellet outer radius"],
      ["cladOuterRadius", 0.00475, "m", "Cladding outer radius"],
      ["activeLength", 3.66, "m", "Active heated core length"],
      ["thermalCapacity", 2.5e3, "J/K", "Lumped rod thermal capacitance"],
      ["gapConductance", 5678.0, "W/(m^2*K)", "Pellet-to-clad gap heat transfer coefficient"],
      ["surfaceArea", 0.109, "m^2", "Outer cladding heat transfer surface area"],
    ],
  },
  {
    modelType: "HTSTR_SG_TUBE",
    aliases: ["htstr_sg_tube", "sg_tube", "htstr_sg"],
    label: "Steam Generator U-Tube Heat Structure (HTSTR_SG_TUBE)",
    category: "Heat Structure",
    archetypeId: Relap5ArchetypeId.HTSTR_SG_TUBE,
    description:
      "Inconel-690/600 steam generator U-tube wall conducting heat from primary RCS to secondary boiling side.",
    provenance: "US NRC NUREG/CR-5535 Vol. I, Section 4.1; Todreas & Kazimi, Nuclear Systems I, Ch. 8",
    params: [
      ["innerRadius", 0.0084, "m", "Tube inner radius"],
      ["outerRadius", 0.0095, "m", "Tube outer radius"],
      ["tubeLength", 18.0, "m", "Average U-tube length"],
      ["thermalCapacity", 1.8e3, "J/K", "Lumped tube wall thermal capacitance"],
      ["wallConductivity", 18.5, "W/(m*K)", "Alloy 690 thermal conductivity"],
      ["surfaceArea", 1.07, "m^2", "Outer heat transfer surface area per tube"],
    ],
  },
  {
    modelType: "CORR_DITTUS_BOELTER",
    aliases: ["corr_dittus_boelter", "dittus_boelter"],
    label: "Dittus-Boelter Convection Correlation (CORR_DITTUS_BOELTER)",
    category: "Boiling / CHF Correlation",
    archetypeId: Relap5ArchetypeId.CORR_DITTUS_BOELTER,
    description:
      "Turbulent single-phase forced convection correlation Nu = 0.023 * Re^0.8 * Pr^0.4 (heating) or Pr^0.3 (cooling).",
    provenance:
      "Dittus & Boelter (1930); Winterton (1998), Int. J. Heat Mass Transfer 41, 809-810; NUREG/CR-5535 Vol. IV",
    params: [
      ["coefficient", 0.023, "-", "Leading Nusselt correlation coefficient"],
      ["reExponent", 0.8, "-", "Reynolds number exponent"],
      ["prExponent", 0.4, "-", "Prandtl number exponent (0.4 heating, 0.3 cooling)"],
    ],
  },
  {
    modelType: "CORR_CHEN_BOILING",
    aliases: ["corr_chen_boiling", "chen_boiling"],
    label: "Chen Saturated Boiling Correlation (CORR_CHEN_BOILING)",
    category: "Boiling / CHF Correlation",
    archetypeId: Relap5ArchetypeId.CORR_CHEN_BOILING,
    description:
      "Superposition of macroscopic forced convection (F * h_mac) and suppressed microscopic nucleate boiling (S * h_mic).",
    provenance: "Chen, J. C. (1966), Ind. Eng. Chem. Process Des. Dev. 5(3), 322-329; US NRC NUREG/CR-5535 Vol. IV",
    params: [
      ["reynoldsFactorF", 2.35, "-", "Two-phase Reynolds enhancement factor F"],
      ["suppressionFactorS", 0.5, "-", "Nucleate boiling suppression factor S"],
      ["forsterZuberHmic", 1.5e4, "W/(m^2*K)", "Microscopic nucleate boiling base HTC"],
      ["wallSuperheat", 10.0, "K", "Wall superheat Tw - Tsat"],
    ],
  },
  {
    modelType: "CORR_ZUBER_CHF",
    aliases: ["corr_zuber_chf", "zuber_chf"],
    label: "Zuber Pool-Boiling CHF Correlation (CORR_ZUBER_CHF)",
    category: "Boiling / CHF Correlation",
    archetypeId: Relap5ArchetypeId.CORR_ZUBER_CHF,
    description:
      "Hydrodynamic Taylor/Helmholtz instability pool-boiling critical heat flux q''_CHF = 0.131 * h_fg * rho_g^0.5 * [sigma * g * (rho_f - rho_g)]^0.25.",
    provenance: "Zuber, N. (1959), Hydrodynamic Aspects of Boiling Heat Transfer, AECU-4439; Todreas & Kazimi Ch. 13",
    params: [
      ["zuberConst", 0.131, "-", "Zuber hydrodynamic constant (pi/24 ~ 0.131)"],
      ["hfg", 2.257e6, "J/kg", "Latent heat of vaporization h_fg"],
      ["rhoLiquid", 958.4, "kg/m^3", "Saturated liquid density rho_f"],
      ["rhoVapor", 0.598, "kg/m^3", "Saturated vapor density rho_g"],
      ["surfaceTension", 0.0589, "N/m", "Liquid-vapor surface tension sigma"],
      ["gravity", 9.80665, "m/s^2", "Gravitational acceleration g"],
    ],
  },
  {
    modelType: "CORR_GROENEVELD_CHF",
    aliases: ["corr_groeneveld_chf", "groeneveld_chf"],
    label: "Groeneveld CHF Look-Up Correlation (CORR_GROENEVELD_CHF)",
    category: "Boiling / CHF Correlation",
    archetypeId: Relap5ArchetypeId.CORR_GROENEVELD_CHF,
    description:
      "AECL-UO Groeneveld critical heat flux correlation with diameter correction (8 mm reference tube) for PWR/BWR channels.",
    provenance: "Groeneveld, D. C. et al. (2007), Nuclear Engineering and Design 237, 1909-1922; NUREG/CR-5535 Vol. IV",
    params: [
      ["qChfRef", 2.5e6, "W/m^2", "Reference 8 mm tube CHF at nominal P, G, x"],
      ["refDiameter", 0.008, "m", "Look-up table reference tube diameter (8 mm)"],
      ["diameterExponent", 0.5, "-", "Tube diameter scaling exponent (D_ref/D)^n"],
      ["qualitySlope", 1.8, "-", "Local equilibrium quality sensitivity factor"],
    ],
  },

  // =========================================================================
  // 3. Reactor Kinetics & Fluid Property Tables (3 components)
  // =========================================================================
  {
    modelType: "POINT_KINETICS_6G",
    aliases: ["point_kinetics_6g", "pke6g", "point_kinetics"],
    label: "6-Group Point Reactor Kinetics (POINT_KINETICS_6G)",
    category: "Reactor Kinetics",
    archetypeId: Relap5ArchetypeId.POINT_KINETICS_6G,
    description:
      "Six-delayed-neutron-precursor-group point reactor kinetics equations integrated via 2nd-order Heun RK2.",
    provenance:
      "US NRC NUREG/CR-5535 Vol. I, Section 6.1; Keepin (1965) U-235 thermal fission delayed neutron constants",
    params: [
      ["promptGenTime", 2.0e-5, "s", "Prompt neutron generation time Lambda"],
      ["initialPower", 3.0e9, "W", "Initial steady-state thermal power P0"],
      ["beta1", 0.000215, "-", "Group 1 delayed neutron fraction"],
      ["beta2", 0.001424, "-", "Group 2 delayed neutron fraction"],
      ["beta3", 0.001274, "-", "Group 3 delayed neutron fraction"],
      ["beta4", 0.002568, "-", "Group 4 delayed neutron fraction"],
      ["beta5", 0.000748, "-", "Group 5 delayed neutron fraction"],
      ["beta6", 0.000273, "-", "Group 6 delayed neutron fraction"],
      ["lambda1", 0.0124, "1/s", "Group 1 precursor decay constant"],
      ["lambda2", 0.0305, "1/s", "Group 2 precursor decay constant"],
      ["lambda3", 0.111, "1/s", "Group 3 precursor decay constant"],
      ["lambda4", 0.301, "1/s", "Group 4 precursor decay constant"],
      ["lambda5", 1.14, "1/s", "Group 5 precursor decay constant"],
      ["lambda6", 3.01, "1/s", "Group 6 precursor decay constant"],
    ],
  },
  {
    modelType: "DECAY_HEAT_ANS79",
    aliases: ["decay_heat_ans79", "ans79", "decay_heat"],
    label: "ANS-5.1-1979 Decay Heat Model (DECAY_HEAT_ANS79)",
    category: "Reactor Kinetics",
    archetypeId: Relap5ArchetypeId.DECAY_HEAT_ANS79,
    description:
      "Fission product decay heat power fraction P_d(t)/P_0 after reactor shutdown for U-235 thermal fission.",
    provenance:
      "ANSI/ANS-5.1-1979 (Decay Heat Power in Light Water Reactors); US NRC NUREG/CR-5535 Vol. I, Section 6.2",
    params: [
      ["initialPower", 3.0e9, "W", "Pre-shutdown steady operating thermal power P0"],
      ["operatingTime", 3.1536e7, "s", "Prior full-power irradiation duration T_op (default 1 yr)"],
      ["actinideMultiplier", 1.0, "-", "Optional U-239/Np-239 actinide & uncertainty multiplier"],
    ],
  },
  {
    modelType: "STEAM_IAPWS_IF97",
    aliases: ["steam_iapws_if97", "iapws_if97", "steam_table"],
    label: "IAPWS-IF97 Water/Steam Saturation Table (STEAM_IAPWS_IF97)",
    category: "Fluid Properties",
    archetypeId: Relap5ArchetypeId.STEAM_IAPWS_IF97,
    description: "Exact IAPWS-IF97 Region 4 backward saturation temperature T_sat(P) over 611.213 Pa to 22.064 MPa.",
    provenance: "IAPWS-IF97 (Wagner et al., J. Eng. Gas Turbines Power 122, 150-182, 2000), Region 4 Eq. (31)",
    params: [
      ["minPressure", 611.213, "Pa", "Triple-point lower pressure bound"],
      ["maxPressure", 22.064e6, "Pa", "Critical-point upper pressure bound"],
    ],
  },
];

/**
 * Converts `RELAP5_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildRelap5CleanroomSchemas(): CleanroomModelSchema[] {
  return RELAP5_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `relap5:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "thermal-hydraulics",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "relap5_component_model",
      width: 88,
      height: 48,
      svg: generateRelap5BlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
