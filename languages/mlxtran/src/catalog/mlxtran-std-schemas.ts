// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Monolix Mlxtran cleanroom pharmacometrics model archetype IDs matching
 * `assets/mlxtran-std-lib/src/models.ts`.
 */
export const MlxtranArchetypeId = {
  // Structural PK Library
  BOLUS_1CPT: 1, // bolus_1cpt_VCl
  BOLUS_2CPT: 2, // bolus_2cpt_VClQVp
  BOLUS_3CPT: 3, // bolus_3cpt_VClQ2V2Q3V3
  INFUSION_1CPT: 4, // infusion_1cpt_VCl
  ORAL1_1CPT: 5, // oral1_1cpt_kaVCl
  ORAL1_2CPT: 6, // oral1_2cpt_kaVClQVp
  ORAL1_1CPT_TLAG: 7, // oral1_1cpt_TlagkaVCl
  ORAL0_1CPT: 8, // oral0_1cpt_Tk0VCl
  MICHAELIS_MENTEN: 9, // michaelis_menten_1cpt

  // PK Macros
  MACRO_PKMODEL: 20, // pkmodel
  MACRO_DEPOT: 21, // depot
  MACRO_COMPARTMENT: 22, // compartment
  MACRO_ABSORPTION: 23, // absorption
  MACRO_ELIMINATION: 24, // elimination
  MACRO_PERIPHERAL: 25, // peripheral
  MACRO_TRANSFER: 26, // transfer
  MACRO_EFFECT: 27, // effect

  // PD, TMDD & Tumor Growth Library
  PD_EMAX_DIRECT: 30, // pd_emax_direct
  PD_SIGMOID_EMAX: 31, // pd_sigmoid_emax
  PD_INDIRECT_INH: 32, // pd_indirect_inh_prod
  PD_INDIRECT_STIM: 33, // pd_indirect_stim_loss
  TMDD_QSS: 34, // tmdd_qss
  TGI_SIMEONI: 35, // tgi_simeoni
  TGI_EXPONENTIAL: 36, // tgi_exponential
} as const;

export type MlxtranArchetypeId = (typeof MlxtranArchetypeId)[keyof typeof MlxtranArchetypeId];

export type MlxtranModelCategory = "Structural PK" | "PK Macro" | "Pharmacodynamics" | "TMDD" | "Tumor Growth";

export interface MlxtranModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: MlxtranModelCategory;
  archetypeId: MlxtranArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<MlxtranModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Structural PK": { fill: "#172554", stroke: "#60a5fa", badge: "PK" },
  "PK Macro": { fill: "#134e4a", stroke: "#2dd4bf", badge: "MAC" },
  Pharmacodynamics: { fill: "#3b0764", stroke: "#c084fc", badge: "PD" },
  TMDD: { fill: "#4c1d95", stroke: "#a78bfa", badge: "TMD" },
  "Tumor Growth": { fill: "#450a0a", stroke: "#f87171", badge: "TGI" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an Mlxtran pharmacometrics model.
 */
export function generateMlxtranBlockSvg(modelType: string, category: MlxtranModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.replace(/_/g, " ").slice(0, 12);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 48" width="96" height="48">` +
    `<rect x="2" y="2" width="92" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="26" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="19" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="34" text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: MlxtranModelCategory): DiagramPortSpec[] {
  switch (category) {
    case "Structural PK":
      return [
        { name: "dose", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "Cc", kind: "signal", side: "right", dx: 96, dy: 24 },
      ];
    case "PK Macro":
      return [
        { name: "in", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "out", kind: "fluid", side: "right", dx: 96, dy: 24 },
      ];
    case "Pharmacodynamics":
      return [
        { name: "Cc", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "E", kind: "signal", side: "right", dx: 96, dy: 24 },
      ];
    case "TMDD":
      return [
        { name: "dose", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "Cfree", kind: "signal", side: "right", dx: 96, dy: 14 },
        { name: "Rtot", kind: "signal", side: "right", dx: 96, dy: 34 },
      ];
    case "Tumor Growth":
      return [
        { name: "Cc", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "W", kind: "signal", side: "right", dx: 96, dy: 24 },
      ];
  }
}

export const MLXTRAN_MODEL_SPECS: MlxtranModelSpec[] = [
  // =========================================================================
  // 1. Structural PK Library
  // =========================================================================
  {
    modelType: "bolus_1cpt_VCl",
    aliases: ["bolus_1cpt_Vk", "iv_1cpt_VCl", "pk_1cpt_bolus"],
    label: "1-Compartment IV Bolus (V, Cl)",
    category: "Structural PK",
    archetypeId: MlxtranArchetypeId.BOLUS_1CPT,
    description:
      "Linear one-compartment intravenous bolus pharmacokinetic model parameterized by central volume V and clearance Cl: Cc(t) = (D/V) * exp(-(Cl/V)*t).",
    provenance:
      "Gibaldi & Perrier (1982) Pharmacokinetics, 2nd Ed., Ch. 1; Lavielle (2014) Mixed Effects Models for the Population Approach",
    params: [
      ["V", 10.0, "L", "Central volume of distribution"],
      ["Cl", 1.0, "L/h", "Systemic clearance"],
    ],
  },
  {
    modelType: "bolus_2cpt_VClQVp",
    aliases: ["bolus_2cpt_Vk12k21", "iv_2cpt_VClQVp", "pk_2cpt_bolus"],
    label: "2-Compartment IV Bolus (V, Cl, Q, Vp)",
    category: "Structural PK",
    archetypeId: MlxtranArchetypeId.BOLUS_2CPT,
    description:
      "Linear two-compartment mammillary IV bolus model with analytical bi-exponential disposition Cc(t) = D*(A*exp(-alpha*t) + B*exp(-beta*t)).",
    provenance:
      "Gibaldi & Perrier (1982) Pharmacokinetics, 2nd Ed., Ch. 2; Lavielle (2014) Mixed Effects Models for the Population Approach",
    params: [
      ["V", 10.0, "L", "Central compartment volume"],
      ["Cl", 1.0, "L/h", "Elimination clearance"],
      ["Q", 2.0, "L/h", "Inter-compartmental clearance"],
      ["Vp", 20.0, "L", "Peripheral compartment volume"],
    ],
  },
  {
    modelType: "bolus_3cpt_VClQ2V2Q3V3",
    aliases: ["bolus_3cpt", "iv_3cpt"],
    label: "3-Compartment IV Bolus (V, Cl, Q2, V2, Q3, V3)",
    category: "Structural PK",
    archetypeId: MlxtranArchetypeId.BOLUS_3CPT,
    description:
      "Linear three-compartment mammillary IV bolus model with fast and slow peripheral distribution compartments.",
    provenance:
      "Gibaldi & Perrier (1982) Pharmacokinetics, 2nd Ed., Ch. 2; Gabrielsson & Weiner (2016) PK/PD Data Analysis",
    params: [
      ["V", 10.0, "L", "Central compartment volume"],
      ["Cl", 1.0, "L/h", "Elimination clearance"],
      ["Q2", 2.0, "L/h", "Shallow peripheral inter-compartmental clearance"],
      ["V2", 20.0, "L", "Shallow peripheral compartment volume"],
      ["Q3", 0.5, "L/h", "Deep peripheral inter-compartmental clearance"],
      ["V3", 50.0, "L", "Deep peripheral compartment volume"],
    ],
  },
  {
    modelType: "infusion_1cpt_VCl",
    aliases: ["infusion_1cpt_Vk", "iv_infusion_1cpt"],
    label: "1-Compartment IV Infusion (V, Cl)",
    category: "Structural PK",
    archetypeId: MlxtranArchetypeId.INFUSION_1CPT,
    description:
      "Linear one-compartment constant-rate intravenous infusion model over duration Tinf followed by first-order mono-exponential decay.",
    provenance:
      "Gibaldi & Perrier (1982) Pharmacokinetics, 2nd Ed., Ch. 1; Gabrielsson & Weiner (2016) PK/PD Data Analysis",
    params: [
      ["V", 10.0, "L", "Central volume of distribution"],
      ["Cl", 1.0, "L/h", "Systemic clearance"],
    ],
  },
  {
    modelType: "oral1_1cpt_kaVCl",
    aliases: ["oral1_1cpt_kaVk", "oral_1cpt_kaVCl", "bateman_1cpt"],
    label: "1-Compartment First-Order Oral (ka, V, Cl)",
    category: "Structural PK",
    archetypeId: MlxtranArchetypeId.ORAL1_1CPT,
    description:
      "One-compartment oral absorption model with first-order absorption rate ka and analytical Bateman concentration profile.",
    provenance:
      "Gibaldi & Perrier (1982) Pharmacokinetics, 2nd Ed., Ch. 1; Lavielle (2014) Mixed Effects Models for the Population Approach",
    params: [
      ["ka", 1.0, "1/h", "First-order absorption rate constant"],
      ["V", 10.0, "L", "Apparent central volume of distribution (V/F)"],
      ["Cl", 1.0, "L/h", "Apparent clearance (Cl/F)"],
      ["F", 1.0, "1", "Oral bioavailability fraction"],
    ],
  },
  {
    modelType: "oral1_2cpt_kaVClQVp",
    aliases: ["oral1_2cpt_kaVk12k21", "oral_2cpt"],
    label: "2-Compartment First-Order Oral (ka, V, Cl, Q, Vp)",
    category: "Structural PK",
    archetypeId: MlxtranArchetypeId.ORAL1_2CPT,
    description:
      "Two-compartment oral absorption model with first-order absorption ka and analytical tri-exponential disposition.",
    provenance:
      "Gibaldi & Perrier (1982) Pharmacokinetics, 2nd Ed., Ch. 2; Lavielle (2014) Mixed Effects Models for the Population Approach",
    params: [
      ["ka", 1.0, "1/h", "First-order absorption rate constant"],
      ["V", 10.0, "L", "Central compartment volume"],
      ["Cl", 1.0, "L/h", "Elimination clearance"],
      ["Q", 2.0, "L/h", "Inter-compartmental clearance"],
      ["Vp", 20.0, "L", "Peripheral compartment volume"],
      ["F", 1.0, "1", "Oral bioavailability fraction"],
    ],
  },
  {
    modelType: "oral1_1cpt_TlagkaVCl",
    aliases: ["oral1_1cpt_TlagkaVk", "oral_1cpt_tlag"],
    label: "1-Compartment First-Order Oral with Lag Time (Tlag, ka, V, Cl)",
    category: "Structural PK",
    archetypeId: MlxtranArchetypeId.ORAL1_1CPT_TLAG,
    description:
      "One-compartment first-order oral absorption model with absorption lag time Tlag prior to Bateman onset.",
    provenance:
      "Gibaldi & Perrier (1982) Pharmacokinetics, 2nd Ed., Ch. 1; Lavielle (2014) Mixed Effects Models for the Population Approach",
    params: [
      ["Tlag", 0.5, "h", "Absorption lag time"],
      ["ka", 1.0, "1/h", "First-order absorption rate constant"],
      ["V", 10.0, "L", "Central volume of distribution"],
      ["Cl", 1.0, "L/h", "Systemic clearance"],
      ["F", 1.0, "1", "Oral bioavailability fraction"],
    ],
  },
  {
    modelType: "oral0_1cpt_Tk0VCl",
    aliases: ["oral0_1cpt_Tk0Vk", "oral_zero_order_1cpt"],
    label: "1-Compartment Zero-Order Oral (Tk0, V, Cl)",
    category: "Structural PK",
    archetypeId: MlxtranArchetypeId.ORAL0_1CPT,
    description:
      "One-compartment oral model with constant zero-order absorption over duration Tk0 followed by first-order elimination.",
    provenance:
      "Gibaldi & Perrier (1982) Pharmacokinetics, 2nd Ed., Ch. 1; Gabrielsson & Weiner (2016) PK/PD Data Analysis",
    params: [
      ["Tk0", 2.0, "h", "Zero-order absorption duration"],
      ["V", 10.0, "L", "Central volume of distribution"],
      ["Cl", 1.0, "L/h", "Systemic clearance"],
      ["F", 1.0, "1", "Oral bioavailability fraction"],
    ],
  },
  {
    modelType: "michaelis_menten_1cpt",
    aliases: ["bolus_1cpt_VVmKm", "mm_1cpt", "nonlinear_pk_1cpt"],
    label: "1-Compartment Michaelis-Menten Elimination (V, Vm, Km)",
    category: "Structural PK",
    archetypeId: MlxtranArchetypeId.MICHAELIS_MENTEN,
    description:
      "One-compartment nonlinear pharmacokinetic model with saturable Michaelis-Menten elimination dC/dt = -(Vm*C)/(V*(Km + C)).",
    provenance:
      "Gibaldi & Perrier (1982) Pharmacokinetics, 2nd Ed., Ch. 7; Gabrielsson & Weiner (2016) PK/PD Data Analysis",
    params: [
      ["V", 10.0, "L", "Central volume of distribution"],
      ["Vm", 10.0, "mg/h", "Maximum elimination rate"],
      ["Km", 5.0, "mg/L", "Michaelis constant (concentration at half-maximal elimination)"],
    ],
  },

  // =========================================================================
  // 2. PK Macros
  // =========================================================================
  {
    modelType: "pkmodel",
    aliases: ["PKMODEL"],
    label: "PK Macro: pkmodel()",
    category: "PK Macro",
    archetypeId: MlxtranArchetypeId.MACRO_PKMODEL,
    description:
      "High-level Mlxtran PK macro declaring a compartmental pharmacokinetic model from canonical parameters (V, Cl, ka, Q, Vp).",
    provenance: "Lavielle (2014) Mixed Effects Models for the Population Approach — Mlxtran PK Macro Semantics",
    params: [
      ["V", 10.0, "L", "Central compartment volume"],
      ["Cl", 1.0, "L/h", "Systemic clearance"],
      ["ka", 0.0, "1/h", "Optional first-order absorption rate (0 for IV bolus)"],
    ],
  },
  {
    modelType: "depot",
    aliases: ["DEPOT"],
    label: "PK Macro: depot()",
    category: "PK Macro",
    archetypeId: MlxtranArchetypeId.MACRO_DEPOT,
    description:
      "Mlxtran dosing depot macro routing administered doses to a target compartment with bioavailability p, lag time Tlag, and rate ka.",
    provenance: "Lavielle (2014) Mixed Effects Models for the Population Approach — Mlxtran PK Macro Semantics",
    params: [
      ["ka", 1.0, "1/h", "First-order release rate from depot"],
      ["p", 1.0, "1", "Bioavailability fraction"],
      ["Tlag", 0.0, "h", "Absorption lag time"],
    ],
  },
  {
    modelType: "compartment",
    aliases: ["COMPARTMENT", "cmt"],
    label: "PK Macro: compartment()",
    category: "PK Macro",
    archetypeId: MlxtranArchetypeId.MACRO_COMPARTMENT,
    description:
      "Mlxtran compartment declaration macro defining amount state, distribution volume V, and concentration variable.",
    provenance: "Lavielle (2014) Mixed Effects Models for the Population Approach — Mlxtran PK Macro Semantics",
    params: [
      ["V", 10.0, "L", "Compartment volume"],
      ["k", 0.1, "1/h", "Default first-order exit rate constant"],
    ],
  },
  {
    modelType: "absorption",
    aliases: ["ABSORPTION"],
    label: "PK Macro: absorption()",
    category: "PK Macro",
    archetypeId: MlxtranArchetypeId.MACRO_ABSORPTION,
    description:
      "Mlxtran absorption macro implementing first-order (ka) or zero-order (Tk0) drug input into a central compartment.",
    provenance: "Lavielle (2014) Mixed Effects Models for the Population Approach — Mlxtran PK Macro Semantics",
    params: [
      ["ka", 1.0, "1/h", "First-order absorption rate constant"],
      ["p", 1.0, "1", "Bioavailability fraction"],
      ["Tlag", 0.0, "h", "Absorption lag time"],
    ],
  },
  {
    modelType: "elimination",
    aliases: ["ELIMINATION"],
    label: "PK Macro: elimination()",
    category: "PK Macro",
    archetypeId: MlxtranArchetypeId.MACRO_ELIMINATION,
    description:
      "Mlxtran elimination macro specifying linear (k = Cl/V) or saturable (Vm, Km) drug clearance from a compartment.",
    provenance: "Lavielle (2014) Mixed Effects Models for the Population Approach — Mlxtran PK Macro Semantics",
    params: [
      ["k", 0.1, "1/h", "Linear elimination rate constant"],
      ["Vm", 0.0, "mg/h", "Optional Michaelis-Menten Vmax (0 for linear)"],
      ["Km", 1.0, "mg/L", "Optional Michaelis-Menten Km"],
    ],
  },
  {
    modelType: "peripheral",
    aliases: ["PERIPHERAL"],
    label: "PK Macro: peripheral()",
    category: "PK Macro",
    archetypeId: MlxtranArchetypeId.MACRO_PERIPHERAL,
    description:
      "Mlxtran peripheral distribution macro coupling a central compartment to a peripheral compartment via micro-constants k12 and k21.",
    provenance: "Lavielle (2014) Mixed Effects Models for the Population Approach — Mlxtran PK Macro Semantics",
    params: [
      ["k12", 0.2, "1/h", "Central-to-peripheral distribution rate constant"],
      ["k21", 0.1, "1/h", "Peripheral-to-central return rate constant"],
    ],
  },
  {
    modelType: "transfer",
    aliases: ["TRANSFER"],
    label: "PK Macro: transfer()",
    category: "PK Macro",
    archetypeId: MlxtranArchetypeId.MACRO_TRANSFER,
    description: "Mlxtran unidirectional first-order inter-compartmental mass transfer macro with rate constant kt.",
    provenance: "Lavielle (2014) Mixed Effects Models for the Population Approach — Mlxtran PK Macro Semantics",
    params: [["kt", 0.25, "1/h", "First-order inter-compartmental transfer rate constant"]],
  },
  {
    modelType: "effect",
    aliases: ["EFFECT", "effect_cpt"],
    label: "PK Macro: effect()",
    category: "PK Macro",
    archetypeId: MlxtranArchetypeId.MACRO_EFFECT,
    description:
      "Mlxtran biophase effect-compartment macro describing hysteresis equilibration dCe/dt = ke0 * (Cc - Ce).",
    provenance: "Sheiner et al. (1979) Clin. Pharmacol. Ther.; Gabrielsson & Weiner (2016) PK/PD Data Analysis",
    params: [["ke0", 0.5, "1/h", "Effect-site equilibration rate constant"]],
  },

  // =========================================================================
  // 3. PD, TMDD & Tumor Growth Library
  // =========================================================================
  {
    modelType: "pd_emax_direct",
    aliases: ["emax_direct", "direct_emax"],
    label: "Direct Emax Pharmacodynamic Model",
    category: "Pharmacodynamics",
    archetypeId: MlxtranArchetypeId.PD_EMAX_DIRECT,
    description: "Hyperbolic direct-link Emax pharmacodynamic response model E(C) = E0 + (Emax * C) / (EC50 + C).",
    provenance: "Gabrielsson & Weiner (2016) Pharmacokinetic and Pharmacodynamic Data Analysis, 5th Ed., Ch. 3",
    params: [
      ["E0", 0.0, "1", "Baseline pharmacodynamic effect"],
      ["Emax", 100.0, "1", "Maximum drug-induced effect"],
      ["EC50", 5.0, "mg/L", "Concentration producing 50% of Emax"],
    ],
  },
  {
    modelType: "pd_sigmoid_emax",
    aliases: ["sigmoid_emax", "hill_emax", "pd_hill"],
    label: "Sigmoid Hill Emax Pharmacodynamic Model",
    category: "Pharmacodynamics",
    archetypeId: MlxtranArchetypeId.PD_SIGMOID_EMAX,
    description:
      "Sigmoid Hill direct-link Emax pharmacodynamic model E(C) = E0 + (Emax * C^gamma) / (EC50^gamma + C^gamma).",
    provenance:
      "Hill (1910); Gabrielsson & Weiner (2016) Pharmacokinetic and Pharmacodynamic Data Analysis, 5th Ed., Ch. 3",
    params: [
      ["E0", 0.0, "1", "Baseline pharmacodynamic effect"],
      ["Emax", 100.0, "1", "Maximum drug-induced effect"],
      ["EC50", 5.0, "mg/L", "Concentration producing 50% of Emax"],
      ["gamma", 2.0, "1", "Hill sigmoidicity exponent"],
    ],
  },
  {
    modelType: "pd_indirect_inh_prod",
    aliases: ["idr1", "indirect_type1", "turnover_inh_kin"],
    label: "Indirect Response Model (Inhibition of Production)",
    category: "Pharmacodynamics",
    archetypeId: MlxtranArchetypeId.PD_INDIRECT_INH,
    description:
      "Dayneka Type I indirect response turnover ODE inhibiting zero-order production: dR/dt = kin*(1 - Imax*C/(IC50+C)) - kout*R.",
    provenance:
      "Dayneka et al. (1993) J. Pharmacokinet. Biopharm. 21:457-478; Gabrielsson & Weiner (2016) PK/PD Data Analysis",
    params: [
      ["kin", 10.0, "1/h", "Zero-order production rate constant"],
      ["kout", 0.2, "1/h", "First-order dissipation rate constant"],
      ["Imax", 0.8, "1", "Maximum fractional inhibition (0..1)"],
      ["IC50", 5.0, "mg/L", "Concentration producing 50% of Imax"],
    ],
  },
  {
    modelType: "pd_indirect_stim_loss",
    aliases: ["idr4", "indirect_type4", "turnover_stim_kout"],
    label: "Indirect Response Model (Stimulation of Loss)",
    category: "Pharmacodynamics",
    archetypeId: MlxtranArchetypeId.PD_INDIRECT_STIM,
    description:
      "Dayneka Type IV indirect response turnover ODE stimulating first-order loss: dR/dt = kin - kout*(1 + Smax*C/(SC50+C))*R.",
    provenance:
      "Dayneka et al. (1993) J. Pharmacokinet. Biopharm. 21:457-478; Gabrielsson & Weiner (2016) PK/PD Data Analysis",
    params: [
      ["kin", 10.0, "1/h", "Zero-order production rate constant"],
      ["kout", 0.2, "1/h", "First-order dissipation rate constant"],
      ["Smax", 2.0, "1", "Maximum fractional stimulation of loss"],
      ["SC50", 5.0, "mg/L", "Concentration producing 50% of Smax"],
    ],
  },
  {
    modelType: "tmdd_qss",
    aliases: ["tmdd_quasi_steady_state", "tmdd_qe", "mager_tmdd_qss"],
    label: "TMDD Quasi-Steady-State (QSS) Approximation",
    category: "TMDD",
    archetypeId: MlxtranArchetypeId.TMDD_QSS,
    description:
      "Target-Mediated Drug Disposition quasi-steady-state model coupling free drug, free target, and internalized drug-target complex via Kss.",
    provenance:
      "Mager & Krzyzanski (2005) Pharm. Res. 22:1589-1596; Gibiansky et al. (2008) J. Pharmacokinet. Pharmacodyn. 35:573-591",
    params: [
      ["kel", 0.05, "1/d", "Linear free-drug elimination rate constant"],
      ["kint", 0.2, "1/d", "Drug-target complex internalization rate constant"],
      ["ksyn", 1.0, "nM/d", "Zero-order target synthesis rate"],
      ["kdeg", 0.1, "1/d", "First-order free-target degradation rate"],
      ["Kss", 1.0, "nM", "Quasi-steady-state dissociation constant (Kd + kint/kon)"],
      ["V", 3.0, "L", "Central distribution volume"],
    ],
  },
  {
    modelType: "tgi_simeoni",
    aliases: ["simeoni_tgi", "tumor_simeoni"],
    label: "Simeoni Tumor Growth Inhibition (TGI) Model",
    category: "Tumor Growth",
    archetypeId: MlxtranArchetypeId.TGI_SIMEONI,
    description:
      "Simeoni 4-compartment tumor growth inhibition model with exponential-to-linear unperturbed growth and 3 damaged-cell transit compartments.",
    provenance: "Simeoni et al. (2004) Cancer Res. 64(3):1094-1101",
    params: [
      ["lambda0", 0.15, "1/d", "Exponential tumor growth rate constant"],
      ["lambda1", 0.5, "g/d", "Linear tumor growth rate constant"],
      ["k1", 0.5, "1/d", "Damaged-cell transit rate constant"],
      ["k2", 0.1, "L/(mg*d)", "Drug antitumor potency constant"],
      ["w0", 0.1, "g", "Initial tumor weight at t = 0"],
      ["psi", 20.0, "1", "Sharpness exponent switching exponential to linear growth"],
    ],
  },
  {
    modelType: "tgi_exponential",
    aliases: ["tumor_exponential", "tgi_exp"],
    label: "Exponential Tumor Growth & Log-Kill Model",
    category: "Tumor Growth",
    archetypeId: MlxtranArchetypeId.TGI_EXPONENTIAL,
    description:
      "First-order exponential tumor growth with linear concentration-driven cell kill: dW/dt = (kg - kd * C) * W.",
    provenance: "Gabrielsson & Weiner (2016) PK/PD Data Analysis; Simeoni et al. (2004) Cancer Res. 64(3):1094-1101",
    params: [
      ["kg", 0.1, "1/d", "Exponential tumor growth rate constant"],
      ["kd", 0.05, "L/(mg*d)", "Drug-induced cell kill rate constant"],
      ["w0", 0.1, "g", "Initial tumor weight at t = 0"],
    ],
  },
];

/**
 * Converts `MLXTRAN_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildMlxtranCleanroomSchemas(): CleanroomModelSchema[] {
  return MLXTRAN_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `mlxtran:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "pharmacometrics",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "mlxtran_model",
      width: 96,
      height: 48,
      svg: generateMlxtranBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
