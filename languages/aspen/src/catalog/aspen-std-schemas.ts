// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Aspen Plus / HYSYS cleanroom model archetype IDs matching `assets/aspen-std-lib/src/models.ts`.
 */
export const AspenArchetypeId = {
  // Unit Operations — Separators & Columns
  FLASH2: 1,
  FLASH3: 2,
  RADFRAC: 3,
  DSTWU: 4,
  SEP: 5,

  // Unit Operations — Heat Transfer
  HEATER: 10,
  HEATX: 11,

  // Unit Operations — Mixers & Splitters
  MIXER: 20,
  FSPLIT: 21,

  // Unit Operations — Pressure Changers & Hydraulics
  PUMP: 30,
  COMPR: 31,
  MCOMPR: 32,
  VALVE: 33,
  PIPE: 34,

  // Unit Operations — Chemical Reactors
  RCSTR: 40,
  RPLUG: 41,
  RSTOIC: 42,
  RGIBBS: 43,
  REQUIL: 44,

  // Thermodynamic Property Methods
  EOS_PENG_ROB: 50,
  EOS_SRK: 51,
  ACT_NRTL: 52,
  ACT_UNIQUAC: 53,
  ACT_WILSON: 54,
  THERMO_IDEAL: 55,
  THERMO_STEAM_TA: 56,
  ACT_ELECNRTL: 57,

  // Pure Component Public Databank (NIST Chemistry WebBook)
  PURE_COMPONENT: 60,
} as const;

export type AspenArchetypeId = (typeof AspenArchetypeId)[keyof typeof AspenArchetypeId];

export interface AspenModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category:
    | "Separator"
    | "Column"
    | "Heat Exchanger"
    | "Mixer / Splitter"
    | "Pressure Changer"
    | "Reactor"
    | "Property Method"
    | "Pure Component";
  archetypeId: AspenArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<AspenModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
  Separator: { fill: "#163b4d", stroke: "#38bdf8", badge: "SEP" },
  Column: { fill: "#1e3a5f", stroke: "#60a5fa", badge: "COL" },
  "Heat Exchanger": { fill: "#431c1c", stroke: "#f87171", badge: "HTX" },
  "Mixer / Splitter": { fill: "#1f3a2e", stroke: "#34d399", badge: "MIX" },
  "Pressure Changer": { fill: "#3b234a", stroke: "#c084fc", badge: "PRC" },
  Reactor: { fill: "#422c14", stroke: "#fbbf24", badge: "RXN" },
  "Property Method": { fill: "#1a3636", stroke: "#2dd4bf", badge: "EOS" },
  "Pure Component": { fill: "#282b47", stroke: "#818cf8", badge: "CMP" },
};

/**
 * Generates a deterministic cleanroom parametric SVG icon for an Aspen Plus / HYSYS model.
 */
export function generateAspenBlockSvg(modelType: string, category: AspenModelSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType
    .replace(/^COMP_/, "")
    .toUpperCase()
    .slice(0, 8);
  let glyph = "";
  if (category === "Separator" || category === "Column") {
    glyph = `<rect x="58" y="8" width="14" height="32" rx="7" fill="none" stroke="${c.stroke}" stroke-width="1.3" opacity="0.65"/>`;
  } else if (category === "Heat Exchanger") {
    glyph = `<circle cx="64" cy="24" r="10" fill="none" stroke="${c.stroke}" stroke-width="1.3" opacity="0.65"/><polyline points="56,24 61,19 67,29 72,24" fill="none" stroke="${c.stroke}" stroke-width="1.2"/>`;
  } else if (category === "Pressure Changer") {
    glyph = `<polygon points="56,14 73,19 73,29 56,34" fill="none" stroke="${c.stroke}" stroke-width="1.3" opacity="0.65"/>`;
  } else if (category === "Reactor") {
    glyph = `<rect x="57" y="12" width="16" height="24" rx="3" fill="none" stroke="${c.stroke}" stroke-width="1.3" opacity="0.65"/><line x1="65" y1="8" x2="65" y2="30" stroke="${c.stroke}" stroke-width="1.1"/>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 48" width="80" height="48">` +
    `<rect x="2" y="2" width="76" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    glyph +
    `<text x="36" y="35" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: AspenModelSpec["category"]): DiagramPortSpec[] {
  switch (category) {
    case "Separator":
      return [
        { name: "feed", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "vapor", kind: "fluid", side: "top", dx: 40, dy: 0 },
        { name: "liquid", kind: "fluid", side: "bottom", dx: 40, dy: 48 },
      ];
    case "Column":
      return [
        { name: "feed", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "distillate", kind: "fluid", side: "right", dx: 80, dy: 12 },
        { name: "bottoms", kind: "fluid", side: "right", dx: 80, dy: 36 },
      ];
    case "Heat Exchanger":
      return [
        { name: "hot_in", kind: "fluid", side: "left", dx: 0, dy: 14 },
        { name: "cold_in", kind: "fluid", side: "left", dx: 0, dy: 34 },
        { name: "hot_out", kind: "fluid", side: "right", dx: 80, dy: 14 },
        { name: "cold_out", kind: "fluid", side: "right", dx: 80, dy: 34 },
      ];
    case "Mixer / Splitter":
      return [
        { name: "in1", kind: "fluid", side: "left", dx: 0, dy: 14 },
        { name: "in2", kind: "fluid", side: "left", dx: 0, dy: 34 },
        { name: "out", kind: "fluid", side: "right", dx: 80, dy: 24 },
      ];
    case "Pressure Changer":
      return [
        { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "outlet", kind: "fluid", side: "right", dx: 80, dy: 24 },
        { name: "work", kind: "signal", side: "top", dx: 40, dy: 0 },
      ];
    case "Reactor":
      return [
        { name: "feed", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "product", kind: "fluid", side: "right", dx: 80, dy: 24 },
        { name: "duty", kind: "thermal", side: "bottom", dx: 40, dy: 48 },
      ];
    case "Property Method":
    case "Pure Component":
      return [
        { name: "state_in", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "props_out", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
  }
}

// Default Antoine parameters (NIST WebBook, log10(P_bar) = A - B / (T_K + C)):
// Component 1: Benzene (Tb = 353.24 K), Component 2: Toluene (Tb = 383.78 K)
const DEFAULT_FLASH_PARAMS: AspenModelSpec["params"] = [
  ["T_spec", 368.15, "K", "Flash vessel temperature specification"],
  ["P_spec", 101325.0, "Pa", "Flash vessel pressure specification"],
  ["A1", 4.01814, "1", "Light component Antoine constant A (log10 P_bar)"],
  ["B1", 1203.835, "K", "Light component Antoine constant B"],
  ["C1", -53.226, "K", "Light component Antoine constant C"],
  ["A2", 4.07827, "1", "Heavy component Antoine constant A (log10 P_bar)"],
  ["B2", 1343.943, "K", "Heavy component Antoine constant B"],
  ["C2", -53.773, "K", "Heavy component Antoine constant C"],
  ["dH_vap", 32000.0, "J/mol", "Average molar enthalpy of vaporization"],
  ["Cp_liq", 140.0, "J/(mol*K)", "Average liquid molar heat capacity"],
];

/**
 * Cleanroom catalog of Aspen Plus / HYSYS unit operations, thermodynamic property methods,
 * and NIST Chemistry WebBook pure component databank entries.
 */
export const ASPEN_MODEL_SPECS: AspenModelSpec[] = [
  // ── Unit Operations: Separators & Columns ─────────────────────────────────────────
  {
    modelType: "Flash2",
    aliases: ["FLASH2", "VLE_FLASH", "SEPARATOR"],
    label: "Two-Phase VLE Flash Drum (Flash2)",
    category: "Separator",
    archetypeId: AspenArchetypeId.FLASH2,
    description:
      "Rigorous isothermal/isobaric two-phase vapor-liquid equilibrium flash drum solving the Rachford-Rice equation.",
    provenance:
      "Rachford & Rice (1952) J. Pet. Technol. 4(10); Smith, Van Ness & Abbott, Intro. to Chem. Eng. Thermodynamics (8th ed.)",
    params: DEFAULT_FLASH_PARAMS,
  },
  {
    modelType: "Flash3",
    aliases: ["FLASH3", "VLLE_FLASH", "THREE_PHASE_SEP"],
    label: "Three-Phase VLLE Flash Drum (Flash3)",
    category: "Separator",
    archetypeId: AspenArchetypeId.FLASH3,
    description:
      "Three-phase vapor-liquid-liquid equilibrium separator for immiscible aqueous/organic hydrocarbon mixtures.",
    provenance:
      "Michelsen & Mollerup, Thermodynamic Models: Fundamentals & Computational Aspects (2nd ed.); Smith-Van Ness-Abbott",
    params: [...DEFAULT_FLASH_PARAMS, ["L2_split", 0.15, "1", "Second liquid phase decant fraction"]],
  },
  {
    modelType: "RadFrac",
    aliases: ["RADFRAC", "DISTILLATION", "COLUMN"],
    label: "Rigorous Multistage Distillation Column (RadFrac)",
    category: "Column",
    archetypeId: AspenArchetypeId.RADFRAC,
    description: "Rigorous MESH-equation multistage vapor-liquid fractionation column with condenser and reboiler.",
    provenance:
      "Seader, Henley & Roper, Separation Process Principles (4th ed.); Naphtali & Sandholm (1971) AIChE J. 17(1)",
    params: [
      ["N_stages", 20.0, "1", "Number of equilibrium stages"],
      ["reflux_ratio", 2.0, "1", "Molar reflux ratio L/D"],
      ["D_over_F", 0.5, "1", "Distillate-to-feed molar ratio"],
      ["P_top", 101325.0, "Pa", "Condenser pressure"],
      ["dP_stage", 500.0, "Pa", "Pressure drop per tray"],
      ["alpha_rel", 2.4, "1", "Effective relative volatility"],
    ],
  },
  {
    modelType: "DSTWU",
    aliases: ["DSTWU", "FUG_COLUMN", "SHORTCUT_COL"],
    label: "Winn-Underwood-Gilliland Shortcut Column (DSTWU)",
    category: "Column",
    archetypeId: AspenArchetypeId.DSTWU,
    description:
      "Shortcut distillation design using Fenske minimum stages, Underwood minimum reflux, and Gilliland correlation.",
    provenance:
      "Fenske (1932) Ind. Eng. Chem. 24; Underwood (1948) Chem. Eng. Prog. 44; Gilliland (1940) Ind. Eng. Chem. 32",
    params: [
      ["light_key_rec", 0.99, "1", "Light key fractional recovery in distillate"],
      ["heavy_key_rec", 0.01, "1", "Heavy key fractional recovery in distillate"],
      ["alpha_rel", 2.4, "1", "Geometric mean relative volatility"],
      ["R_over_Rmin", 1.25, "1", "Ratio of actual to minimum reflux ratio"],
      ["P_cond", 101325.0, "Pa", "Condenser operating pressure"],
    ],
  },
  {
    modelType: "Sep",
    aliases: ["SEP", "COMPONENT_SPLITTER"],
    label: "Component Separator (Sep)",
    category: "Separator",
    archetypeId: AspenArchetypeId.SEP,
    description:
      "Ideal component splitter routing specified molar fractions of each component to overhead and bottoms outlets.",
    provenance: "Seader, Henley & Roper, Separation Process Principles (4th ed.)",
    params: [
      ["split_comp1", 0.95, "1", "Overhead split fraction for component 1"],
      ["split_comp2", 0.05, "1", "Overhead split fraction for component 2"],
      ["P_out", 101325.0, "Pa", "Outlet pressure"],
    ],
  },

  // ── Unit Operations: Heat Transfer ────────────────────────────────────────────────
  {
    modelType: "Heater",
    aliases: ["HEATER", "COOLER", "CONDENSER", "REBOILER"],
    label: "Thermal Heater / Cooler (Heater)",
    category: "Heat Exchanger",
    archetypeId: AspenArchetypeId.HEATER,
    description:
      "Single-stream thermal heater or cooler computing required heat duty from inlet/outlet enthalpy change.",
    provenance: "Smith, Van Ness & Abbott, Intro. to Chem. Eng. Thermodynamics (8th ed.)",
    params: [
      ["T_out_spec", 373.15, "K", "Specified outlet temperature"],
      ["dP", 0.0, "Pa", "Pressure drop across heater"],
      ["Cp", 75.3, "J/(mol*K)", "Molar heat capacity at constant pressure"],
    ],
  },
  {
    modelType: "HeatX",
    aliases: ["HEATX", "EXCHANGER", "SHELL_TUBE"],
    label: "Two-Stream Countercurrent Heat Exchanger (HeatX)",
    category: "Heat Exchanger",
    archetypeId: AspenArchetypeId.HEATX,
    description:
      "Countercurrent two-stream shell-and-tube heat exchanger evaluated via exact LMTD / epsilon-NTU heat transfer.",
    provenance: "Incropera, DeWitt, Bergman & Lavine, Fundamentals of Heat and Mass Transfer (7th ed.); Kays & London",
    params: [
      ["UA", 10000.0, "W/K", "Overall heat transfer coefficient times area (U*A)"],
      ["T_cold_in", 300.0, "K", "Cold stream inlet temperature"],
      ["F_cold", 100.0, "mol/s", "Cold stream molar flow rate"],
      ["Cp_hot", 75.3, "J/(mol*K)", "Hot stream molar heat capacity"],
      ["Cp_cold", 75.3, "J/(mol*K)", "Cold stream molar heat capacity"],
      ["dP_hot", 5000.0, "Pa", "Hot side pressure drop"],
      ["dP_cold", 5000.0, "Pa", "Cold side pressure drop"],
    ],
  },

  // ── Unit Operations: Mixers & Splitters ───────────────────────────────────────────
  {
    modelType: "Mixer",
    aliases: ["MIXER", "STREAM_MIXER"],
    label: "Adiabatic Stream Mixer (Mixer)",
    category: "Mixer / Splitter",
    archetypeId: AspenArchetypeId.MIXER,
    description: "Adiabatic material and enthalpy balance mixer combining inlet streams at the minimum inlet pressure.",
    provenance: "Felder, Rousseau & Bullard, Elementary Principles of Chemical Processes (4th ed.)",
    params: [
      ["P_out_spec", 0.0, "Pa", "Outlet pressure override (0 = minimum inlet pressure)"],
      ["T_in2", 300.0, "K", "Secondary inlet stream temperature"],
      ["F_in2", 10.0, "mol/s", "Secondary inlet molar flow rate"],
    ],
  },
  {
    modelType: "FSplit",
    aliases: ["FSPLIT", "FLOW_SPLITTER", "TEE"],
    label: "Stream Flow Splitter (FSplit)",
    category: "Mixer / Splitter",
    archetypeId: AspenArchetypeId.FSPLIT,
    description:
      "Isothermal, isobaric stream splitter dividing a single feed into branch streams of identical composition.",
    provenance: "Felder, Rousseau & Bullard, Elementary Principles of Chemical Processes (4th ed.)",
    params: [
      ["split_frac", 0.5, "1", "Molar split fraction to primary outlet"],
      ["dP", 0.0, "Pa", "Branch pressure drop"],
    ],
  },

  // ── Unit Operations: Pressure Changers & Hydraulics ───────────────────────────────
  {
    modelType: "Pump",
    aliases: ["PUMP", "CENTRIFUGAL_PUMP"],
    label: "Centrifugal Liquid Pump (Pump)",
    category: "Pressure Changer",
    archetypeId: AspenArchetypeId.PUMP,
    description:
      "Incompressible liquid pump computing hydraulic shaft power and frictional discharge temperature rise.",
    provenance: "Perry's Chemical Engineers' Handbook (9th ed.) Sec. 10; Smith, Van Ness & Abbott (8th ed.)",
    params: [
      ["P_out", 500000.0, "Pa", "Discharge pressure specification"],
      ["eta_pump", 0.75, "1", "Hydraulic pump efficiency"],
      ["rho", 998.0, "kg/m^3", "Liquid mass density"],
      ["Mw", 18.015, "kg/kmol", "Liquid molar mass"],
      ["Cp", 75.3, "J/(mol*K)", "Liquid molar heat capacity"],
    ],
  },
  {
    modelType: "Compr",
    aliases: ["COMPR", "COMPRESSOR", "TURBINE", "EXPANDER"],
    label: "Isentropic Compressor / Turbine (Compr)",
    category: "Pressure Changer",
    archetypeId: AspenArchetypeId.COMPR,
    description:
      "Single-stage isentropic/polytropic gas compressor or expander computing discharge temperature and shaft power.",
    provenance:
      "Smith, Van Ness & Abbott, Intro. to Chem. Eng. Thermodynamics (8th ed.) Ch. 7; GPSA Engineering Data Book",
    params: [
      ["P_out", 500000.0, "Pa", "Discharge pressure specification"],
      ["eta_is", 0.78, "1", "Isentropic efficiency"],
      ["gamma", 1.4, "1", "Heat capacity ratio Cp/Cv"],
      ["eta_mech", 0.98, "1", "Mechanical drive efficiency"],
    ],
  },
  {
    modelType: "MCompr",
    aliases: ["MCOMPR", "MULTISTAGE_COMPR"],
    label: "Multistage Intercooled Compressor (MCompr)",
    category: "Pressure Changer",
    archetypeId: AspenArchetypeId.MCOMPR,
    description:
      "Multistage gas compressor with equal stage pressure ratios and interstage cooling back to suction temperature.",
    provenance: "GPSA Engineering Data Book (14th ed.); Smith, Van Ness & Abbott (8th ed.) Ch. 7",
    params: [
      ["P_out", 2000000.0, "Pa", "Final discharge pressure"],
      ["eta_is", 0.78, "1", "Per-stage isentropic efficiency"],
      ["gamma", 1.4, "1", "Heat capacity ratio Cp/Cv"],
      ["eta_mech", 0.98, "1", "Mechanical efficiency"],
      ["n_stages", 3.0, "1", "Number of compression stages"],
    ],
  },
  {
    modelType: "Valve",
    aliases: ["VALVE", "JT_VALVE", "THROTTLE"],
    label: "Adiabatic Throttling Valve (Valve)",
    category: "Pressure Changer",
    archetypeId: AspenArchetypeId.VALVE,
    description:
      "Isenthalpic throttling valve computing Joule-Thomson temperature change across a specified pressure drop.",
    provenance: "Smith, Van Ness & Abbott, Intro. to Chem. Eng. Thermodynamics (8th ed.) Ch. 6",
    params: [
      ["P_out", 101325.0, "Pa", "Outlet pressure specification"],
      ["mu_JT", 2.0e-6, "K/Pa", "Joule-Thomson coefficient (dT/dP)_H"],
    ],
  },
  {
    modelType: "Pipe",
    aliases: ["PIPE", "PIPELINE", "SEGMENT"],
    label: "Fluid Pipeline Segment (Pipe)",
    category: "Pressure Changer",
    archetypeId: AspenArchetypeId.PIPE,
    description: "Darcy-Weisbach frictional pipeline segment computing pressure drop and ambient heat loss.",
    provenance: "Crane Technical Paper No. 410; Perry's Chemical Engineers' Handbook (9th ed.) Sec. 6",
    params: [
      ["length", 100.0, "m", "Pipe length"],
      ["diameter", 0.1, "m", "Internal pipe diameter"],
      ["f_darcy", 0.02, "1", "Darcy friction factor"],
      ["rho", 998.0, "kg/m^3", "Fluid density"],
      ["Mw", 18.015, "kg/kmol", "Fluid molar mass"],
    ],
  },

  // ── Unit Operations: Chemical Reactors ────────────────────────────────────────────
  {
    modelType: "RCSTR",
    aliases: ["RCSTR", "CSTR"],
    label: "Continuous Stirred-Tank Reactor (RCSTR)",
    category: "Reactor",
    archetypeId: AspenArchetypeId.RCSTR,
    description:
      "Isothermal/non-isothermal perfectly mixed CSTR with Arrhenius power-law reaction kinetics and heat duty.",
    provenance:
      "Levenspiel, Chemical Reaction Engineering (3rd ed.) Ch. 5; Fogler, Elements of Chemical Reaction Engineering",
    params: [
      ["volume", 1.0, "m^3", "Liquid/reactor holdup volume"],
      ["k0", 1.0e6, "1/s", "Arrhenius pre-exponential factor"],
      ["Ea", 50000.0, "J/mol", "Activation energy"],
      ["dH_rxn", -50000.0, "J/mol", "Standard enthalpy of reaction"],
      ["c_total", 1000.0, "mol/m^3", "Total molar concentration"],
    ],
  },
  {
    modelType: "RPlug",
    aliases: ["RPLUG", "PFR", "PLUG_FLOW"],
    label: "Plug Flow Tubular Reactor (RPlug)",
    category: "Reactor",
    archetypeId: AspenArchetypeId.RPLUG,
    description:
      "Ideal plug flow tubular reactor computing analytical/integrated Arrhenius conversion along reactor length.",
    provenance:
      "Levenspiel, Chemical Reaction Engineering (3rd ed.) Ch. 5; Fogler, Elements of Chemical Reaction Engineering",
    params: [
      ["volume", 1.0, "m^3", "Tubular reactor volume"],
      ["k0", 1.0e6, "1/s", "Arrhenius pre-exponential factor"],
      ["Ea", 50000.0, "J/mol", "Activation energy"],
      ["dH_rxn", -50000.0, "J/mol", "Standard enthalpy of reaction"],
      ["c_total", 1000.0, "mol/m^3", "Total molar concentration"],
    ],
  },
  {
    modelType: "RStoic",
    aliases: ["RSTOIC", "STOIC_REACTOR"],
    label: "Stoichiometric Reactor (RStoic)",
    category: "Reactor",
    archetypeId: AspenArchetypeId.RSTOIC,
    description:
      "Stoichiometric reactor with user-specified fractional key-component conversion and reaction heat duty.",
    provenance: "Felder, Rousseau & Bullard, Elementary Principles of Chemical Processes (4th ed.)",
    params: [
      ["conversion", 0.85, "1", "Specified fractional conversion of key reactant"],
      ["dH_rxn", -50000.0, "J/mol", "Standard enthalpy of reaction"],
    ],
  },
  {
    modelType: "RGibbs",
    aliases: ["RGIBBS", "GIBBS_REACTOR"],
    label: "Gibbs Free Energy Minimization Reactor (RGibbs)",
    category: "Reactor",
    archetypeId: AspenArchetypeId.RGIBBS,
    description:
      "Chemical and phase equilibrium reactor minimizing total Gibbs free energy via van 't Hoff equilibrium constant.",
    provenance: "Smith, Van Ness & Abbott, Intro. to Chem. Eng. Thermodynamics (8th ed.) Ch. 13",
    params: [
      ["dG0_298", -10000.0, "J/mol", "Standard Gibbs energy of reaction at 298.15 K"],
      ["dH_rxn", -40000.0, "J/mol", "Standard enthalpy of reaction"],
    ],
  },
  {
    modelType: "REquil",
    aliases: ["REQUIL", "EQUIL_REACTOR"],
    label: "Equilibrium Reactor (REquil)",
    category: "Reactor",
    archetypeId: AspenArchetypeId.REQUIL,
    description:
      "Stoichiometric chemical equilibrium reactor solving K_eq(T) = exp(-dG0 / RT) for equilibrium conversion.",
    provenance: "Smith, Van Ness & Abbott, Intro. to Chem. Eng. Thermodynamics (8th ed.) Ch. 13",
    params: [
      ["dG0_298", -8000.0, "J/mol", "Standard Gibbs energy of reaction at 298.15 K"],
      ["dH_rxn", -35000.0, "J/mol", "Standard enthalpy of reaction"],
    ],
  },

  // ── Thermodynamic Property Methods ────────────────────────────────────────────────
  {
    modelType: "PENG_ROB",
    aliases: ["PENG-ROB", "PR", "PENG_ROBINSON"],
    label: "Peng-Robinson Cubic EOS (PENG-ROB)",
    category: "Property Method",
    archetypeId: AspenArchetypeId.EOS_PENG_ROB,
    description:
      "Peng-Robinson (1976) cubic equation of state for hydrocarbon/non-polar VLE, compressibility Z, and fugacity.",
    provenance: "Peng & Robinson (1976) Ind. Eng. Chem. Fundam. 15(1):59-64; Poling, Prausnitz & O'Connell (5th ed.)",
    params: [
      ["Tc", 190.564, "K", "Critical temperature (default: Methane)"],
      ["Pc", 4599200.0, "Pa", "Critical pressure"],
      ["omega", 0.01142, "1", "Pitzer acentric factor"],
      ["k_ij", 0.0, "1", "Binary interaction parameter"],
    ],
  },
  {
    modelType: "SRK",
    aliases: ["SOAVE_REDLICH_KWONG", "RK-SOAVE"],
    label: "Soave-Redlich-Kwong Cubic EOS (SRK)",
    category: "Property Method",
    archetypeId: AspenArchetypeId.EOS_SRK,
    description: "Soave-Redlich-Kwong (1972) cubic equation of state for gas processing and refinery hydrocarbon VLE.",
    provenance: "Soave (1972) Chem. Eng. Sci. 27(6):1197-1203; Poling, Prausnitz & O'Connell (5th ed.)",
    params: [
      ["Tc", 190.564, "K", "Critical temperature"],
      ["Pc", 4599200.0, "Pa", "Critical pressure"],
      ["omega", 0.01142, "1", "Pitzer acentric factor"],
      ["k_ij", 0.0, "1", "Binary interaction parameter"],
    ],
  },
  {
    modelType: "NRTL",
    aliases: ["NRTL-RK", "NRTL-HOC"],
    label: "Non-Random Two-Liquid Activity Model (NRTL)",
    category: "Property Method",
    archetypeId: AspenArchetypeId.ACT_NRTL,
    description:
      "Renon-Prausnitz (1968) local-composition activity coefficient model for strongly non-ideal polar VLE/LLE.",
    provenance: "Renon & Prausnitz (1968) AIChE J. 14(1):135-144; Smith, Van Ness & Abbott (8th ed.)",
    params: [
      ["tau12", 0.5, "1", "Binary interaction parameter tau_12 = g_12 / RT"],
      ["tau21", 1.2, "1", "Binary interaction parameter tau_21 = g_21 / RT"],
      ["alpha12", 0.3, "1", "Non-randomness parameter alpha_12"],
    ],
  },
  {
    modelType: "UNIQUAC",
    aliases: ["UNIQUAC-RK"],
    label: "Universal Quasi-Chemical Activity Model (UNIQUAC)",
    category: "Property Method",
    archetypeId: AspenArchetypeId.ACT_UNIQUAC,
    description: "Abrams-Prausnitz (1975) combinatorial + residual local-composition activity coefficient model.",
    provenance: "Abrams & Prausnitz (1975) AIChE J. 21(1):116-128; Poling, Prausnitz & O'Connell (5th ed.)",
    params: [
      ["tau12", 0.85, "1", "UNIQUAC Boltzmann interaction parameter tau_12"],
      ["tau21", 0.72, "1", "UNIQUAC Boltzmann interaction parameter tau_21"],
      ["r1", 2.11, "1", "Molecular volume parameter r_1"],
      ["q1", 1.97, "1", "Molecular surface area parameter q_1"],
    ],
  },
  {
    modelType: "WILSON",
    aliases: ["WILSON-RK"],
    label: "Wilson Activity Coefficient Model (WILSON)",
    category: "Property Method",
    archetypeId: AspenArchetypeId.ACT_WILSON,
    description:
      "Wilson (1964) local-composition activity coefficient model for miscible polar/alcohol-water mixtures.",
    provenance: "Wilson (1964) J. Am. Chem. Soc. 86(2):127-130; Smith, Van Ness & Abbott (8th ed.)",
    params: [
      ["Lambda12", 0.45, "1", "Wilson binary energy parameter Lambda_12"],
      ["Lambda21", 0.65, "1", "Wilson binary energy parameter Lambda_21"],
    ],
  },
  {
    modelType: "IDEAL",
    aliases: ["IDEAL_GAS", "RAOULT"],
    label: "Ideal Gas & Raoult's Law (IDEAL)",
    category: "Property Method",
    archetypeId: AspenArchetypeId.THERMO_IDEAL,
    description: "Ideal gas law (Z = 1) combined with ideal liquid solution Raoult's Law (gamma = 1, phi = 1).",
    provenance: "Smith, Van Ness & Abbott, Intro. to Chem. Eng. Thermodynamics (8th ed.) Ch. 10",
    params: [["Z_ideal", 1.0, "1", "Ideal gas compressibility factor"]],
  },
  {
    modelType: "STEAM_TA",
    aliases: ["STEAM-TA", "STEAMNBS", "IAPWS-IF97"],
    label: "ASME / IAPWS-IF97 Steam Tables (STEAM-TA)",
    category: "Property Method",
    archetypeId: AspenArchetypeId.THERMO_STEAM_TA,
    description: "Industrial formulation for water and steam saturation pressure, enthalpy, and compressibility.",
    provenance: "IAPWS-IF97 (Wagner et al., 2000) J. Eng. Gas Turbines Power 122(1):150-184",
    params: [
      ["Tc", 647.096, "K", "Water critical temperature (IAPWS-IF97)"],
      ["Pc", 22064000.0, "Pa", "Water critical pressure (IAPWS-IF97)"],
      ["omega", 0.3443, "1", "Water acentric factor"],
    ],
  },
  {
    modelType: "ELECNRTL",
    aliases: ["ENRTL", "ENRTL-RK"],
    label: "Electrolyte NRTL Activity Model (ELECNRTL)",
    category: "Property Method",
    archetypeId: AspenArchetypeId.ACT_ELECNRTL,
    description:
      "Chen-Britt-Boston-Evans electrolyte NRTL model combining Pitzer-Debye-Huckel long-range and NRTL short-range terms.",
    provenance: "Chen, Britt, Boston & Evans (1982) AIChE J. 28(4):588-596; Poling, Prausnitz & O'Connell (5th ed.)",
    params: [
      ["tau12", 0.4, "1", "Short-range NRTL interaction tau_12"],
      ["tau21", 0.9, "1", "Short-range NRTL interaction tau_21"],
      ["alpha12", 0.2, "1", "Electrolyte non-randomness factor"],
      ["ionic_strength", 0.1, "mol/kg", "Solution ionic strength I"],
    ],
  },

  // ── Pure Component Public Databank (NIST Chemistry WebBook) ───────────────────────
  // Params: [Tc(K), Pc(Pa), omega, Mw(kg/kmol), Tb(K), Antoine_A, Antoine_B, Antoine_C] (log10 P_bar = A - B/(T_K + C))
  {
    modelType: "COMP_H2O",
    aliases: ["H2O", "WATER", "7732-18-5"],
    label: "Water (H2O)",
    category: "Pure Component",
    archetypeId: AspenArchetypeId.PURE_COMPONENT,
    description: "Pure component water thermodynamic constants and NIST WebBook Antoine vapor pressure correlation.",
    provenance: "NIST Chemistry WebBook SRD 69 (CAS 7732-18-5); IAPWS-95",
    params: [
      ["Tc", 647.096, "K", "Critical temperature"],
      ["Pc", 22064000.0, "Pa", "Critical pressure"],
      ["omega", 0.3443, "1", "Pitzer acentric factor"],
      ["Mw", 18.01528, "kg/kmol", "Molecular weight"],
      ["Tb", 373.15, "K", "Normal boiling point"],
      ["Antoine_A", 5.20389, "1", "Antoine A (log10 P_bar, 373-647 K)"],
      ["Antoine_B", 1733.926, "K", "Antoine B"],
      ["Antoine_C", -39.485, "K", "Antoine C"],
    ],
  },
  {
    modelType: "COMP_CH4",
    aliases: ["CH4", "METHANE", "74-82-8"],
    label: "Methane (CH4)",
    category: "Pure Component",
    archetypeId: AspenArchetypeId.PURE_COMPONENT,
    description: "Pure component methane critical constants and NIST WebBook Antoine vapor pressure correlation.",
    provenance: "NIST Chemistry WebBook SRD 69 (CAS 74-82-8); Poling, Prausnitz & O'Connell (5th ed.)",
    params: [
      ["Tc", 190.564, "K", "Critical temperature"],
      ["Pc", 4599200.0, "Pa", "Critical pressure"],
      ["omega", 0.01142, "1", "Pitzer acentric factor"],
      ["Mw", 16.0425, "kg/kmol", "Molecular weight"],
      ["Tb", 111.66, "K", "Normal boiling point"],
      ["Antoine_A", 3.9895, "1", "Antoine A (log10 P_bar)"],
      ["Antoine_B", 443.028, "K", "Antoine B"],
      ["Antoine_C", -0.49, "K", "Antoine C"],
    ],
  },
  {
    modelType: "COMP_C2H6",
    aliases: ["C2H6", "ETHANE", "74-84-0"],
    label: "Ethane (C2H6)",
    category: "Pure Component",
    archetypeId: AspenArchetypeId.PURE_COMPONENT,
    description: "Pure component ethane critical constants and NIST WebBook Antoine vapor pressure correlation.",
    provenance: "NIST Chemistry WebBook SRD 69 (CAS 74-84-0); Poling, Prausnitz & O'Connell (5th ed.)",
    params: [
      ["Tc", 305.322, "K", "Critical temperature"],
      ["Pc", 4872200.0, "Pa", "Critical pressure"],
      ["omega", 0.0995, "1", "Pitzer acentric factor"],
      ["Mw", 30.069, "kg/kmol", "Molecular weight"],
      ["Tb", 184.55, "K", "Normal boiling point"],
      ["Antoine_A", 3.95405, "1", "Antoine A (log10 P_bar)"],
      ["Antoine_B", 663.72, "K", "Antoine B"],
      ["Antoine_C", -16.47, "K", "Antoine C"],
    ],
  },
  {
    modelType: "COMP_C3H8",
    aliases: ["C3H8", "PROPANE", "74-98-6"],
    label: "Propane (C3H8)",
    category: "Pure Component",
    archetypeId: AspenArchetypeId.PURE_COMPONENT,
    description: "Pure component propane critical constants and NIST WebBook Antoine vapor pressure correlation.",
    provenance: "NIST Chemistry WebBook SRD 69 (CAS 74-98-6); Poling, Prausnitz & O'Connell (5th ed.)",
    params: [
      ["Tc", 369.825, "K", "Critical temperature"],
      ["Pc", 4248000.0, "Pa", "Critical pressure"],
      ["omega", 0.1522, "1", "Pitzer acentric factor"],
      ["Mw", 44.0956, "kg/kmol", "Molecular weight"],
      ["Tb", 231.08, "K", "Normal boiling point"],
      ["Antoine_A", 4.01158, "1", "Antoine A (log10 P_bar)"],
      ["Antoine_B", 834.26, "K", "Antoine B"],
      ["Antoine_C", -22.763, "K", "Antoine C"],
    ],
  },
  {
    modelType: "COMP_CO2",
    aliases: ["CO2", "CARBON_DIOXIDE", "124-38-9"],
    label: "Carbon Dioxide (CO2)",
    category: "Pure Component",
    archetypeId: AspenArchetypeId.PURE_COMPONENT,
    description: "Pure component carbon dioxide critical constants and NIST WebBook Antoine correlation.",
    provenance: "NIST Chemistry WebBook SRD 69 (CAS 124-38-9); Span & Wagner (1996)",
    params: [
      ["Tc", 304.128, "K", "Critical temperature"],
      ["Pc", 7377300.0, "Pa", "Critical pressure"],
      ["omega", 0.22394, "1", "Pitzer acentric factor"],
      ["Mw", 44.0095, "kg/kmol", "Molecular weight"],
      ["Tb", 194.65, "K", "Normal sublimation point"],
      ["Antoine_A", 6.81228, "1", "Antoine A (log10 P_bar)"],
      ["Antoine_B", 1301.679, "K", "Antoine B"],
      ["Antoine_C", -3.494, "K", "Antoine C"],
    ],
  },
  {
    modelType: "COMP_N2",
    aliases: ["N2", "NITROGEN", "7727-37-9"],
    label: "Nitrogen (N2)",
    category: "Pure Component",
    archetypeId: AspenArchetypeId.PURE_COMPONENT,
    description: "Pure component nitrogen critical constants and NIST WebBook Antoine vapor pressure correlation.",
    provenance: "NIST Chemistry WebBook SRD 69 (CAS 7727-37-9); Span et al. (2000)",
    params: [
      ["Tc", 126.192, "K", "Critical temperature"],
      ["Pc", 3395800.0, "Pa", "Critical pressure"],
      ["omega", 0.0372, "1", "Pitzer acentric factor"],
      ["Mw", 28.0134, "kg/kmol", "Molecular weight"],
      ["Tb", 77.355, "K", "Normal boiling point"],
      ["Antoine_A", 3.7362, "1", "Antoine A (log10 P_bar)"],
      ["Antoine_B", 264.651, "K", "Antoine B"],
      ["Antoine_C", -6.788, "K", "Antoine C"],
    ],
  },
  {
    modelType: "COMP_O2",
    aliases: ["O2", "OXYGEN", "7782-44-7"],
    label: "Oxygen (O2)",
    category: "Pure Component",
    archetypeId: AspenArchetypeId.PURE_COMPONENT,
    description: "Pure component oxygen critical constants and NIST WebBook Antoine vapor pressure correlation.",
    provenance: "NIST Chemistry WebBook SRD 69 (CAS 7782-44-7); Poling, Prausnitz & O'Connell (5th ed.)",
    params: [
      ["Tc", 154.581, "K", "Critical temperature"],
      ["Pc", 5043000.0, "Pa", "Critical pressure"],
      ["omega", 0.0222, "1", "Pitzer acentric factor"],
      ["Mw", 31.9988, "kg/kmol", "Molecular weight"],
      ["Tb", 90.188, "K", "Normal boiling point"],
      ["Antoine_A", 3.9523, "1", "Antoine A (log10 P_bar)"],
      ["Antoine_B", 340.024, "K", "Antoine B"],
      ["Antoine_C", -4.144, "K", "Antoine C"],
    ],
  },
  {
    modelType: "COMP_H2",
    aliases: ["H2", "HYDROGEN", "1333-74-0"],
    label: "Hydrogen (H2)",
    category: "Pure Component",
    archetypeId: AspenArchetypeId.PURE_COMPONENT,
    description: "Pure component hydrogen critical constants and NIST WebBook Antoine vapor pressure correlation.",
    provenance: "NIST Chemistry WebBook SRD 69 (CAS 1333-74-0); Leachman et al. (2009)",
    params: [
      ["Tc", 33.145, "K", "Critical temperature"],
      ["Pc", 1296400.0, "Pa", "Critical pressure"],
      ["omega", -0.219, "1", "Pitzer acentric factor"],
      ["Mw", 2.01588, "kg/kmol", "Molecular weight"],
      ["Tb", 20.271, "K", "Normal boiling point"],
      ["Antoine_A", 3.54314, "1", "Antoine A (log10 P_bar)"],
      ["Antoine_B", 99.395, "K", "Antoine B"],
      ["Antoine_C", 7.726, "K", "Antoine C"],
    ],
  },
  {
    modelType: "COMP_NH3",
    aliases: ["NH3", "AMMONIA", "7664-41-7"],
    label: "Ammonia (NH3)",
    category: "Pure Component",
    archetypeId: AspenArchetypeId.PURE_COMPONENT,
    description: "Pure component ammonia critical constants and NIST WebBook Antoine vapor pressure correlation.",
    provenance: "NIST Chemistry WebBook SRD 69 (CAS 7664-41-7); Poling, Prausnitz & O'Connell (5th ed.)",
    params: [
      ["Tc", 405.4, "K", "Critical temperature"],
      ["Pc", 11333000.0, "Pa", "Critical pressure"],
      ["omega", 0.256, "1", "Pitzer acentric factor"],
      ["Mw", 17.0305, "kg/kmol", "Molecular weight"],
      ["Tb", 239.82, "K", "Normal boiling point"],
      ["Antoine_A", 4.4854, "1", "Antoine A (log10 P_bar)"],
      ["Antoine_B", 926.132, "K", "Antoine B"],
      ["Antoine_C", -32.98, "K", "Antoine C"],
    ],
  },
  {
    modelType: "COMP_MEOH",
    aliases: ["MEOH", "CH3OH", "METHANOL", "67-56-1"],
    label: "Methanol (CH3OH)",
    category: "Pure Component",
    archetypeId: AspenArchetypeId.PURE_COMPONENT,
    description: "Pure component methanol critical constants and NIST WebBook Antoine vapor pressure correlation.",
    provenance: "NIST Chemistry WebBook SRD 69 (CAS 67-56-1); Poling, Prausnitz & O'Connell (5th ed.)",
    params: [
      ["Tc", 512.5, "K", "Critical temperature"],
      ["Pc", 8084000.0, "Pa", "Critical pressure"],
      ["omega", 0.5625, "1", "Pitzer acentric factor"],
      ["Mw", 32.0419, "kg/kmol", "Molecular weight"],
      ["Tb", 337.85, "K", "Normal boiling point"],
      ["Antoine_A", 5.20409, "1", "Antoine A (log10 P_bar)"],
      ["Antoine_B", 1581.341, "K", "Antoine B"],
      ["Antoine_C", -33.5, "K", "Antoine C"],
    ],
  },
  {
    modelType: "COMP_ETOH",
    aliases: ["ETOH", "C2H5OH", "ETHANOL", "64-17-5"],
    label: "Ethanol (C2H5OH)",
    category: "Pure Component",
    archetypeId: AspenArchetypeId.PURE_COMPONENT,
    description: "Pure component ethanol critical constants and NIST WebBook Antoine vapor pressure correlation.",
    provenance: "NIST Chemistry WebBook SRD 69 (CAS 64-17-5); Poling, Prausnitz & O'Connell (5th ed.)",
    params: [
      ["Tc", 513.9, "K", "Critical temperature"],
      ["Pc", 6148000.0, "Pa", "Critical pressure"],
      ["omega", 0.6436, "1", "Pitzer acentric factor"],
      ["Mw", 46.0684, "kg/kmol", "Molecular weight"],
      ["Tb", 351.44, "K", "Normal boiling point"],
      ["Antoine_A", 5.24677, "1", "Antoine A (log10 P_bar)"],
      ["Antoine_B", 1598.673, "K", "Antoine B"],
      ["Antoine_C", -46.424, "K", "Antoine C"],
    ],
  },
  {
    modelType: "COMP_BENZENE",
    aliases: ["BENZENE", "C6H6", "71-43-2"],
    label: "Benzene (C6H6)",
    category: "Pure Component",
    archetypeId: AspenArchetypeId.PURE_COMPONENT,
    description: "Pure component benzene critical constants and NIST WebBook Antoine vapor pressure correlation.",
    provenance: "NIST Chemistry WebBook SRD 69 (CAS 71-43-2); Poling, Prausnitz & O'Connell (5th ed.)",
    params: [
      ["Tc", 562.05, "K", "Critical temperature"],
      ["Pc", 4895000.0, "Pa", "Critical pressure"],
      ["omega", 0.2103, "1", "Pitzer acentric factor"],
      ["Mw", 78.1118, "kg/kmol", "Molecular weight"],
      ["Tb", 353.24, "K", "Normal boiling point"],
      ["Antoine_A", 4.01814, "1", "Antoine A (log10 P_bar)"],
      ["Antoine_B", 1203.835, "K", "Antoine B"],
      ["Antoine_C", -53.226, "K", "Antoine C"],
    ],
  },
];

/**
 * Converts `ASPEN_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildAspenCleanroomSchemas(): CleanroomModelSchema[] {
  return ASPEN_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    const symbolKind =
      spec.category === "Property Method"
        ? "aspen_property_method"
        : spec.category === "Pure Component"
          ? "aspen_pure_component"
          : "aspen_unit_operation";
    return {
      namePath: `aspen:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "process",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind,
      width: 80,
      height: 48,
      svg: generateAspenBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
