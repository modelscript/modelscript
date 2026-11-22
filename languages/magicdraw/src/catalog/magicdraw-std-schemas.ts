// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * MagicDraw / Cameo Systems Modeler cleanroom standard library archetype IDs
 * matching `assets/magicdraw-std-lib/src/models.ts`.
 */
export const MagicDrawArchetypeId = {
  SI_UNIT_CONVERSION: 1, // SI_* ValueTypes, QUDV_Unit, QUDV_QuantityKind, MD_ValueType
  ROLLUP_AGGREGATION: 2, // CST_RollupPattern, MD_Block, MD_PartProperty, MD_ReferenceProperty, MD_Customization_for_SysML
  CONSTRAINT_EVALUATOR: 3, // CST_ConstraintEvaluator, MD_ConstraintBlock
  REQUIREMENT_VERIFICATION: 4, // MD_Requirement, MD_ExtendedRequirement, MD_TestCase
  PORT_INTERFACE_PASS: 5, // MD_FlowPort, MD_ProxyPort, MD_FullPort, MD_InterfaceBlock, UML_Standard_Profile
  SIMULATION_CONFIG: 6, // CST_SimulationConfig, CST_TimeSeriesChart, CST_MonteCarloConfig
} as const;

export type MagicDrawArchetypeId = (typeof MagicDrawArchetypeId)[keyof typeof MagicDrawArchetypeId];

export interface MagicDrawModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: "MD Customization" | "SI / QUDV ValueType" | "Cameo Simulation Toolkit";
  archetypeId: MagicDrawArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<MagicDrawModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
  "MD Customization": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "SYS" },
  "SI / QUDV ValueType": { fill: "#163b3b", stroke: "#2dd4bf", badge: "QUDV" },
  "Cameo Simulation Toolkit": { fill: "#3b1f47", stroke: "#c084fc", badge: "CST" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a MagicDraw / Cameo standard library element.
 */
export function generateMagicDrawBlockSvg(modelType: string, category: MagicDrawModelSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const shortLabel = modelType.replace(/^(MD_|SI_|QUDV_|CST_|UML_)/, "").slice(0, 12);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="32" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="22" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${shortLabel}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: MagicDrawModelSpec["category"]): DiagramPortSpec[] {
  switch (category) {
    case "MD Customization":
      return [
        { name: "in", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "out", kind: "signal", side: "right", dx: 96, dy: 26 },
      ];
    case "SI / QUDV ValueType":
      return [
        { name: "raw", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "si", kind: "signal", side: "right", dx: 96, dy: 26 },
      ];
    case "Cameo Simulation Toolkit":
      return [
        { name: "lhs", kind: "signal", side: "left", dx: 0, dy: 16 },
        { name: "rhs", kind: "signal", side: "left", dx: 0, dy: 36 },
        { name: "result", kind: "signal", side: "right", dx: 96, dy: 26 },
      ];
  }
}

const ROLLUP_PARAMS: MagicDrawModelSpec["params"] = [
  ["ownValue", 0.0, "", "Self contribution to rollup aggregation (mass, power, or cost)"],
  ["contingencyMarginPct", 0.0, "%", "Design contingency margin percentage"],
  ["multiplier", 1.0, "", "Multiplicity scaling factor"],
  ["budgetLimit", 0.0, "", "Optional upper budget limit (0 = unlimited)"],
];

const CONSTRAINT_PARAMS: MagicDrawModelSpec["params"] = [
  ["tolerance", 1e-6, "", "Absolute tolerance for residual satisfaction |lhs - rhs| <= tol"],
  ["mode", 0.0, "", "Comparison mode (0: |lhs-rhs|<=tol, 1: lhs<=rhs+tol, 2: lhs>=rhs-tol)"],
  ["scale", 1.0, "", "Residual normalization scale"],
];

const REQUIREMENT_PARAMS: MagicDrawModelSpec["params"] = [
  ["targetLimit", 100.0, "", "Required threshold value for verification"],
  ["comparisonOp", 0.0, "", "Comparison operator (0: actual<=limit, 1: actual>=limit, 2: equality)"],
  ["tolerance", 1e-6, "", "Numerical verification tolerance"],
  ["minMarginPct", 0.0, "%", "Minimum required verification margin percentage"],
];

const PORT_PARAMS: MagicDrawModelSpec["params"] = [
  ["gain", 1.0, "", "Signal/flow pass-through gain"],
  ["conjugated", 0.0, "", "Conjugated port flag (0: normal, 1: conjugated)"],
];

const SIM_CONFIG_PARAMS: MagicDrawModelSpec["params"] = [
  ["startTime", 0.0, "s", "Simulation start time"],
  ["stopTime", 10.0, "s", "Simulation stop time"],
  ["stepSize", 0.01, "s", "Fixed time-step increment"],
  ["sampleCount", 100.0, "", "Sample count for time-series or Monte Carlo runs"],
];

function siUnitParams(
  factor: number,
  offset: number,
  dimL: number,
  dimM: number,
  dimT: number,
  dimI: number,
  dimTheta: number,
  unitSymbol: string,
): MagicDrawModelSpec["params"] {
  return [
    ["factor", factor, unitSymbol, "Linear conversion factor a in y = a*x + b to SI coherent unit"],
    ["offset", offset, unitSymbol, "Affine conversion offset b in y = a*x + b"],
    ["dimL", dimL, "", "ISO 80000 length dimension exponent (L)"],
    ["dimM", dimM, "", "ISO 80000 mass dimension exponent (M)"],
    ["dimT", dimT, "", "ISO 80000 time dimension exponent (T)"],
    ["dimI", dimI, "", "ISO 80000 electric current dimension exponent (I)"],
    ["dimTheta", dimTheta, "", "ISO 80000 thermodynamic temperature dimension exponent (Theta)"],
  ];
}

/**
 * Cleanroom catalog of MagicDraw / Cameo Systems Modeler profile stereotypes,
 * OMG SysML 1.6 / QUDV / SI ValueTypes, and Cameo Simulation Toolkit execution blocks.
 */
export const MAGICDRAW_MODEL_SPECS: readonly MagicDrawModelSpec[] = [
  // === MD Customization & Stereotypes (13) ===
  {
    modelType: "MD_Customization_for_SysML",
    aliases: ["MD Customization for SysML", "MD_Customization", "SysMLCustomization"],
    label: "MD Customization for SysML Profile",
    category: "MD Customization",
    archetypeId: MagicDrawArchetypeId.ROLLUP_AGGREGATION,
    description:
      "Cleanroom representation of the MagicDraw / Cameo SysML customization profile defining PartProperty, ReferenceProperty, and ValueProperty stereotypes.",
    provenance: "OMG SysML 1.6 (formal/2019-11-01) / OMG UML 2.5.1 Profile Extension Mechanism",
    params: ROLLUP_PARAMS,
  },
  {
    modelType: "MD_Block",
    aliases: ["Block", "sysml:Block"],
    label: "SysML Block",
    category: "MD Customization",
    archetypeId: MagicDrawArchetypeId.ROLLUP_AGGREGATION,
    description:
      "Modular structural unit in SysML representing hardware, software, physical, or logical system entities.",
    provenance: "OMG SysML 1.6 Specification, Section 8.3.2.3 (Block)",
    params: ROLLUP_PARAMS,
  },
  {
    modelType: "MD_ConstraintBlock",
    aliases: ["ConstraintBlock", "sysml:ConstraintBlock"],
    label: "SysML ConstraintBlock",
    category: "MD Customization",
    archetypeId: MagicDrawArchetypeId.CONSTRAINT_EVALUATOR,
    description:
      "Reusable parametric mathematical constraint block binding constraint parameters via equality or inequality residuals.",
    provenance: "OMG SysML 1.6 Specification, Section 10.3.2.1 (ConstraintBlock)",
    params: CONSTRAINT_PARAMS,
  },
  {
    modelType: "MD_FlowPort",
    aliases: ["FlowPort", "sysml:FlowPort"],
    label: "SysML FlowPort",
    category: "MD Customization",
    archetypeId: MagicDrawArchetypeId.PORT_INTERFACE_PASS,
    description: "Interaction point specifying input/output flow of matter, energy, or data across block boundaries.",
    provenance: "OMG SysML 1.6 Specification, Annex C.3.2.2 (Deprecated FlowPort Compatibility)",
    params: PORT_PARAMS,
  },
  {
    modelType: "MD_ProxyPort",
    aliases: ["ProxyPort", "sysml:ProxyPort"],
    label: "SysML ProxyPort",
    category: "MD Customization",
    archetypeId: MagicDrawArchetypeId.PORT_INTERFACE_PASS,
    description: "Port exposing features of the owning block or its internal parts typed by an InterfaceBlock.",
    provenance: "OMG SysML 1.6 Specification, Section 9.3.2.12 (ProxyPort)",
    params: PORT_PARAMS,
  },
  {
    modelType: "MD_FullPort",
    aliases: ["FullPort", "sysml:FullPort"],
    label: "SysML FullPort",
    category: "MD Customization",
    archetypeId: MagicDrawArchetypeId.PORT_INTERFACE_PASS,
    description:
      "Port representing a distinct physical or behavioral boundary component with its own internal structure.",
    provenance: "OMG SysML 1.6 Specification, Section 9.3.2.8 (FullPort)",
    params: PORT_PARAMS,
  },
  {
    modelType: "MD_InterfaceBlock",
    aliases: ["InterfaceBlock", "sysml:InterfaceBlock"],
    label: "SysML InterfaceBlock",
    category: "MD Customization",
    archetypeId: MagicDrawArchetypeId.PORT_INTERFACE_PASS,
    description: "Block without internal behaviors defining flow properties and operations exposed on ProxyPorts.",
    provenance: "OMG SysML 1.6 Specification, Section 9.3.2.9 (InterfaceBlock)",
    params: PORT_PARAMS,
  },
  {
    modelType: "MD_ValueType",
    aliases: ["ValueType", "sysml:ValueType"],
    label: "SysML ValueType",
    category: "MD Customization",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description: "Quantifiable DataType associating a physical Unit and QuantityKind with value properties.",
    provenance: "OMG SysML 1.6 Specification, Section 8.3.2.15 (ValueType)",
    params: siUnitParams(1.0, 0.0, 0, 0, 0, 0, 0, ""),
  },
  {
    modelType: "MD_Requirement",
    aliases: ["Requirement", "sysml:Requirement"],
    label: "SysML Requirement",
    category: "MD Customization",
    archetypeId: MagicDrawArchetypeId.REQUIREMENT_VERIFICATION,
    description:
      "Textual and quantitative capability or condition that a system must satisfy, with automated margin verification.",
    provenance: "OMG SysML 1.6 Specification, Section 16.3.2.4 (Requirement)",
    params: REQUIREMENT_PARAMS,
  },
  {
    modelType: "MD_ExtendedRequirement",
    aliases: ["ExtendedRequirement", "sysml:ExtendedRequirement"],
    label: "SysML ExtendedRequirement",
    category: "MD Customization",
    archetypeId: MagicDrawArchetypeId.REQUIREMENT_VERIFICATION,
    description: "Non-normative SysML requirement stereotype adding risk, source, and verificationMethod attributes.",
    provenance: "OMG SysML 1.6 Specification, Annex E.8 (Non-normative Requirement Extensions)",
    params: REQUIREMENT_PARAMS,
  },
  {
    modelType: "MD_TestCase",
    aliases: ["TestCase", "sysml:TestCase"],
    label: "SysML TestCase",
    category: "MD Customization",
    archetypeId: MagicDrawArchetypeId.REQUIREMENT_VERIFICATION,
    description:
      "Verification behavior evaluating whether a system satisfies one or more Requirements with pass/fail verdict.",
    provenance: "OMG SysML 1.6 Specification, Section 16.3.2.7 (TestCase)",
    params: REQUIREMENT_PARAMS,
  },
  {
    modelType: "MD_PartProperty",
    aliases: ["PartProperty", "partProperty"],
    label: "MD PartProperty Stereotype",
    category: "MD Customization",
    archetypeId: MagicDrawArchetypeId.ROLLUP_AGGREGATION,
    description:
      "Composite structural property typed by a Block representing an owned subsystem part participating in rollups.",
    provenance: "OMG SysML 1.6 Section 8.3.2.3 / OMG UML 2.5.1 Composite Aggregation",
    params: ROLLUP_PARAMS,
  },
  {
    modelType: "MD_ReferenceProperty",
    aliases: ["ReferenceProperty", "referenceProperty"],
    label: "MD ReferenceProperty Stereotype",
    category: "MD Customization",
    archetypeId: MagicDrawArchetypeId.ROLLUP_AGGREGATION,
    description: "Non-composite reference property linking a Block to an external peer or shared resource.",
    provenance: "OMG SysML 1.6 Section 8.3.2.3 / OMG UML 2.5.1 Shared/None Aggregation",
    params: ROLLUP_PARAMS,
  },

  // === SI / QUDV ValueType Library (14) ===
  {
    modelType: "SI_Meter",
    aliases: ["m", "meter", "metre", "SI::metre"],
    label: "SI Meter (m)",
    category: "SI / QUDV ValueType",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description: "SI base unit of length (L^1) with linear scaling y = a*x + b to coherent meters.",
    provenance: "SI Brochure 9th Ed. (BIPM 2019) / ISO 80000-3 / OMG SysML 1.6 Annex E.5 QUDV",
    params: siUnitParams(1.0, 0.0, 1, 0, 0, 0, 0, "m"),
  },
  {
    modelType: "SI_Kilogram",
    aliases: ["kg", "kilogram", "SI::kilogram"],
    label: "SI Kilogram (kg)",
    category: "SI / QUDV ValueType",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description: "SI base unit of mass (M^1) with linear scaling to coherent kilograms.",
    provenance: "SI Brochure 9th Ed. (BIPM 2019) / ISO 80000-4 / OMG SysML 1.6 Annex E.5 QUDV",
    params: siUnitParams(1.0, 0.0, 0, 1, 0, 0, 0, "kg"),
  },
  {
    modelType: "SI_Second",
    aliases: ["s", "second", "SI::second"],
    label: "SI Second (s)",
    category: "SI / QUDV ValueType",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description: "SI base unit of time duration (T^1) with linear scaling to coherent seconds.",
    provenance: "SI Brochure 9th Ed. (BIPM 2019) / ISO 80000-3 / OMG SysML 1.6 Annex E.5 QUDV",
    params: siUnitParams(1.0, 0.0, 0, 0, 1, 0, 0, "s"),
  },
  {
    modelType: "SI_Ampere",
    aliases: ["A", "ampere", "SI::ampere"],
    label: "SI Ampere (A)",
    category: "SI / QUDV ValueType",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description: "SI base unit of electric current (I^1) with linear scaling to coherent amperes.",
    provenance: "SI Brochure 9th Ed. (BIPM 2019) / ISO 80000-6 / OMG SysML 1.6 Annex E.5 QUDV",
    params: siUnitParams(1.0, 0.0, 0, 0, 0, 1, 0, "A"),
  },
  {
    modelType: "SI_Kelvin",
    aliases: ["K", "kelvin", "SI::kelvin"],
    label: "SI Kelvin (K)",
    category: "SI / QUDV ValueType",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description:
      "SI base unit of thermodynamic temperature (Theta^1) supporting affine offset conversions (e.g. Celsius + 273.15).",
    provenance: "SI Brochure 9th Ed. (BIPM 2019) / ISO 80000-5 / OMG SysML 1.6 Annex E.5 QUDV",
    params: siUnitParams(1.0, 0.0, 0, 0, 0, 0, 1, "K"),
  },
  {
    modelType: "SI_Newton",
    aliases: ["N", "newton", "SI::newton"],
    label: "SI Newton (N)",
    category: "SI / QUDV ValueType",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description: "SI coherent derived unit of force (kg*m/s^2, L^1 M^1 T^-2).",
    provenance: "SI Brochure 9th Ed. (BIPM 2019) / ISO 80000-4 / OMG SysML 1.6 Annex E.5 QUDV",
    params: siUnitParams(1.0, 0.0, 1, 1, -2, 0, 0, "N"),
  },
  {
    modelType: "SI_Pascal",
    aliases: ["Pa", "pascal", "SI::pascal"],
    label: "SI Pascal (Pa)",
    category: "SI / QUDV ValueType",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description: "SI coherent derived unit of pressure and mechanical stress (N/m^2, L^-1 M^1 T^-2).",
    provenance: "SI Brochure 9th Ed. (BIPM 2019) / ISO 80000-4 / OMG SysML 1.6 Annex E.5 QUDV",
    params: siUnitParams(1.0, 0.0, -1, 1, -2, 0, 0, "Pa"),
  },
  {
    modelType: "SI_Joule",
    aliases: ["J", "joule", "SI::joule"],
    label: "SI Joule (J)",
    category: "SI / QUDV ValueType",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description: "SI coherent derived unit of energy, work, and heat (N*m, L^2 M^1 T^-2).",
    provenance: "SI Brochure 9th Ed. (BIPM 2019) / ISO 80000-4 / OMG SysML 1.6 Annex E.5 QUDV",
    params: siUnitParams(1.0, 0.0, 2, 1, -2, 0, 0, "J"),
  },
  {
    modelType: "SI_Watt",
    aliases: ["W", "watt", "SI::watt"],
    label: "SI Watt (W)",
    category: "SI / QUDV ValueType",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description: "SI coherent derived unit of power and radiant flux (J/s, L^2 M^1 T^-3).",
    provenance: "SI Brochure 9th Ed. (BIPM 2019) / ISO 80000-4 / OMG SysML 1.6 Annex E.5 QUDV",
    params: siUnitParams(1.0, 0.0, 2, 1, -3, 0, 0, "W"),
  },
  {
    modelType: "SI_Volt",
    aliases: ["V", "volt", "SI::volt"],
    label: "SI Volt (V)",
    category: "SI / QUDV ValueType",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description: "SI coherent derived unit of electric potential difference (W/A, L^2 M^1 T^-3 I^-1).",
    provenance: "SI Brochure 9th Ed. (BIPM 2019) / ISO 80000-6 / OMG SysML 1.6 Annex E.5 QUDV",
    params: siUnitParams(1.0, 0.0, 2, 1, -3, -1, 0, "V"),
  },
  {
    modelType: "SI_Ohm",
    aliases: ["ohm", "Ohm", "SI::ohm"],
    label: "SI Ohm (Ω)",
    category: "SI / QUDV ValueType",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description: "SI coherent derived unit of electrical resistance (V/A, L^2 M^1 T^-3 I^-2).",
    provenance: "SI Brochure 9th Ed. (BIPM 2019) / ISO 80000-6 / OMG SysML 1.6 Annex E.5 QUDV",
    params: siUnitParams(1.0, 0.0, 2, 1, -3, -2, 0, "Ohm"),
  },
  {
    modelType: "SI_Hertz",
    aliases: ["Hz", "hertz", "SI::hertz"],
    label: "SI Hertz (Hz)",
    category: "SI / QUDV ValueType",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description: "SI coherent derived unit of frequency (1/s, T^-1).",
    provenance: "SI Brochure 9th Ed. (BIPM 2019) / ISO 80000-3 / OMG SysML 1.6 Annex E.5 QUDV",
    params: siUnitParams(1.0, 0.0, 0, 0, -1, 0, 0, "Hz"),
  },
  {
    modelType: "QUDV_Unit",
    aliases: ["Unit", "QUDV::Unit", "AffineConversionUnit", "LinearConversionUnit"],
    label: "QUDV Conversion Unit",
    category: "SI / QUDV ValueType",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description:
      "OMG SysML QUDV Unit supporting affine/linear dimensional conversion y = factor*x + offset to a reference unit.",
    provenance: "OMG SysML 1.6 Specification, Annex E.5 (QUDV — Quantities, Units, Dimensions, Values)",
    params: siUnitParams(1.0, 0.0, 0, 0, 0, 0, 0, ""),
  },
  {
    modelType: "QUDV_QuantityKind",
    aliases: ["QuantityKind", "QUDV::QuantityKind"],
    label: "QUDV QuantityKind",
    category: "SI / QUDV ValueType",
    archetypeId: MagicDrawArchetypeId.SI_UNIT_CONVERSION,
    description: "OMG SysML QUDV QuantityKind capturing ISO 80000 dimensional exponents (L, M, T, I, Theta).",
    provenance: "OMG SysML 1.6 Specification, Annex E.5 (QUDV) / ISO 80000-1",
    params: siUnitParams(1.0, 0.0, 0, 0, 0, 0, 0, ""),
  },

  // === Cameo Simulation Toolkit & Execution Stereotypes (6) ===
  {
    modelType: "CST_SimulationConfig",
    aliases: ["SimulationConfig", "CST::SimulationConfig"],
    label: "Cameo Simulation Configuration",
    category: "Cameo Simulation Toolkit",
    archetypeId: MagicDrawArchetypeId.SIMULATION_CONFIG,
    description:
      "Execution configuration defining simulation time window, fixed step size, and target execution block.",
    provenance: "OMG fUML 1.5 / OMG SysML 1.6 / Cameo Simulation Toolkit Public Execution Semantics",
    params: SIM_CONFIG_PARAMS,
  },
  {
    modelType: "CST_TimeSeriesChart",
    aliases: ["TimeSeriesChart", "CST::TimeSeriesChart"],
    label: "Cameo TimeSeriesChart Recorder",
    category: "Cameo Simulation Toolkit",
    archetypeId: MagicDrawArchetypeId.SIMULATION_CONFIG,
    description:
      "Runtime telemetry recorder tracking running mean, min/max bounds, and sample count over simulation time.",
    provenance: "OMG SysML 1.6 Parametric Simulation / Cameo Simulation Toolkit Telemetry Pattern",
    params: SIM_CONFIG_PARAMS,
  },
  {
    modelType: "CST_ConstraintEvaluator",
    aliases: ["ConstraintEvaluator", "CST::ConstraintEvaluator"],
    label: "Cameo Parametric Constraint Evaluator",
    category: "Cameo Simulation Toolkit",
    archetypeId: MagicDrawArchetypeId.CONSTRAINT_EVALUATOR,
    description:
      "Evaluates parametric constraint residuals |lhs - rhs| <= tol and reports pass/fail satisfaction status.",
    provenance: "OMG SysML 1.6 Section 10 (Constraint Blocks) / Parametric Solver Semantics",
    params: CONSTRAINT_PARAMS,
  },
  {
    modelType: "CST_RollupPattern",
    aliases: ["RollupPattern", "MassRollup", "PowerRollup", "CostRollup", "CST::RollupPattern"],
    label: "Cameo Mass / Power / Cost Rollup Pattern",
    category: "Cameo Simulation Toolkit",
    archetypeId: MagicDrawArchetypeId.ROLLUP_AGGREGATION,
    description:
      "Hierarchical bottom-up aggregation pattern summing own value and child part contributions with contingency margin.",
    provenance: "OMG SysML 1.6 Section 10 / INCOSE Systems Engineering Handbook Rollup Pattern",
    params: ROLLUP_PARAMS,
  },
  {
    modelType: "CST_MonteCarloConfig",
    aliases: ["MonteCarloConfig", "CST::MonteCarloConfig"],
    label: "Cameo Monte Carlo Analysis Configuration",
    category: "Cameo Simulation Toolkit",
    archetypeId: MagicDrawArchetypeId.SIMULATION_CONFIG,
    description: "Stochastic parameter sweep configuration aggregating sample statistics across N Monte Carlo trials.",
    provenance: "OMG SysML 1.6 Parametric Trade Studies / ISO/IEC Guide 98-3 (GUM Supplement 1)",
    params: SIM_CONFIG_PARAMS,
  },
  {
    modelType: "UML_Standard_Profile",
    aliases: ["StandardProfile", "UML::StandardProfile"],
    label: "OMG UML 2.5.1 Standard Profile",
    category: "Cameo Simulation Toolkit",
    archetypeId: MagicDrawArchetypeId.PORT_INTERFACE_PASS,
    description:
      "Standard OMG UML 2.5.1 stereotypes («Refine», «Trace», «Derive», «Create», «Destroy», «Instantiate», «Specification»).",
    provenance: "OMG UML 2.5.1 Specification, Section 22 (Standard Profile)",
    params: PORT_PARAMS,
  },
];

/**
 * Converts `MAGICDRAW_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildMagicDrawCleanroomSchemas(): CleanroomModelSchema[] {
  return MAGICDRAW_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `magicdraw:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "systems",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "magicdraw_std_element",
      width: 96,
      height: 52,
      svg: generateMagicDrawBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
