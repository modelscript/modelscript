// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * NONMEM / PREDPP cleanroom pharmacometric archetype IDs matching `assets/nmtran-std-lib/src/models.ts`.
 */
export const NmtranArchetypeId = {
  ADVAN1: 1, // 1-compartment linear IV
  ADVAN2: 2, // 1-compartment linear with first-order absorption (Bateman)
  ADVAN3: 3, // 2-compartment linear IV (biexponential)
  ADVAN4: 4, // 2-compartment linear with first-order absorption (triexponential)
  ADVAN5: 5, // General linear model (closed-form matrix exponential)
  ADVAN6: 6, // General nonlinear model (non-stiff RK / DVERK)
  ADVAN7: 7, // General linear model with real eigenvalues
  ADVAN8: 8, // General nonlinear model (stiff Gear / DGEAR)
  ADVAN9: 9, // General nonlinear model (stiff DAE / LSODI)
  ADVAN10: 10, // 1-compartment Michaelis-Menten saturable elimination
  ADVAN11: 11, // 3-compartment linear IV (triexponential)
  ADVAN12: 12, // 3-compartment linear with first-order absorption (tetraexponential)
  ADVAN13: 13, // General nonlinear model (automatic stiff/non-stiff LSODA)
  TRANS1: 21, // Native micro-rate parameterization (K, K12, K21, K13, K31, KA)
  TRANS2: 22, // 1-compartment clearance/volume (CL, V)
  TRANS3: 23, // 2-compartment clearance/steady-state volume (CL, V, Q, VSS)
  TRANS4: 24, // 2/3-compartment clearance/volumes (CL, V1/V2, Q/Q2/Q3, V2/V3/V4)
  TRANS5: 25, // 2-compartment macro-constants (AOB, ALPHA, BETA)
  TRANS6: 26, // 2/3-compartment hybrid rate constants (ALPHA, BETA, GAMMA, K21, K31)
  PRED_EMAX: 31, // Direct Hill / Sigmoidal Emax pharmacodynamic model
  PRED_INDIRECT_RESP: 32, // Indirect response turnover PK/PD model (Dayneka & Jusko)
  PRED_TMDD: 33, // Target-Mediated Drug Disposition (Mager & Jusko)
  ERROR_PROP: 41, // Proportional residual unexplained variability (RUV)
  ERROR_ADD: 42, // Additive residual unexplained variability (RUV)
  ERROR_COMB: 43, // Combined additive + proportional residual error
} as const;

export type NmtranArchetypeId = (typeof NmtranArchetypeId)[keyof typeof NmtranArchetypeId];

export interface NmtranModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: "Compartmental ADVAN" | "General ODE ADVAN" | "Parameterization TRANS" | "PK/PD Model" | "Residual Error";
  archetypeId: NmtranArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<NmtranModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
  "Compartmental ADVAN": { fill: "#172e4d", stroke: "#38bdf8", badge: "ADV" },
  "General ODE ADVAN": { fill: "#23224a", stroke: "#818cf8", badge: "ODE" },
  "Parameterization TRANS": { fill: "#361e47", stroke: "#c084fc", badge: "TRN" },
  "PK/PD Model": { fill: "#143b2f", stroke: "#34d399", badge: "PD" },
  "Residual Error": { fill: "#42270f", stroke: "#fbbf24", badge: "ERR" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an NMTRAN / PREDPP subroutine or PK/PD block.
 */
export function generateNmtranBlockSvg(modelType: string, category: NmtranModelSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType
    .toUpperCase()
    .replace(/^PRED_|^ERROR_/, "")
    .slice(0, 9);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 48" width="80" height="48">` +
    `<rect x="2" y="2" width="76" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="40" y="34" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: NmtranModelSpec["category"]): DiagramPortSpec[] {
  switch (category) {
    case "Compartmental ADVAN":
    case "General ODE ADVAN":
      return [
        { name: "dose", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "theta", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "conc", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "Parameterization TRANS":
      return [
        { name: "theta", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "rates", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "PK/PD Model":
      return [
        { name: "conc", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "effect", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "Residual Error":
      return [
        { name: "ipred", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "eps", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "dv", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
  }
}

export const NMTRAN_MODEL_SPECS: NmtranModelSpec[] = [
  // === Compartmental ADVAN Subroutines (ADVAN1-ADVAN4, ADVAN10-ADVAN12) ===
  {
    modelType: "ADVAN1",
    aliases: ["advan1", "one_cpt_iv", "1cpt_iv"],
    label: "1-Compartment Linear IV Model (ADVAN1)",
    category: "Compartmental ADVAN",
    archetypeId: NmtranArchetypeId.ADVAN1,
    description:
      "Closed-form one-compartment linear pharmacokinetic model for IV bolus or zero-order infusion: C(t) = (F1*D/V)*exp(-k*t).",
    provenance:
      "Gibaldi & Perrier, Pharmacokinetics (2nd ed., Ch. 1); Rowland & Tozer (4th ed., Ch. 3); FDA PopPK Guidance",
    params: [
      ["CL", 5.0, "L/h", "Total systemic clearance"],
      ["V", 50.0, "L", "Central compartment volume of distribution"],
      ["F1", 1.0, "1", "Bioavailability fraction for compartment 1"],
    ],
  },
  {
    modelType: "ADVAN2",
    aliases: ["advan2", "one_cpt_oral", "1cpt_oral", "bateman"],
    label: "1-Compartment First-Order Oral Model (ADVAN2)",
    category: "Compartmental ADVAN",
    archetypeId: NmtranArchetypeId.ADVAN2,
    description:
      "Closed-form one-compartment linear PK model with first-order depot absorption (Bateman equation): C(t) = (F1*D*ka/(V*(ka-k)))*(exp(-k*t) - exp(-ka*t)).",
    provenance:
      "Gibaldi & Perrier, Pharmacokinetics (2nd ed., Ch. 1); Rowland & Tozer (4th ed., Ch. 7); Gabrielsson & Weiner (5th ed.)",
    params: [
      ["CL", 5.0, "L/h", "Apparent systemic clearance (CL/F)"],
      ["V", 50.0, "L", "Apparent central volume of distribution (V/F)"],
      ["KA", 1.2, "1/h", "First-order absorption rate constant"],
      ["F1", 1.0, "1", "Bioavailability fraction for depot compartment"],
      ["ALAG1", 0.0, "h", "Absorption lag time"],
    ],
  },
  {
    modelType: "ADVAN3",
    aliases: ["advan3", "two_cpt_iv", "2cpt_iv"],
    label: "2-Compartment Linear IV Model (ADVAN3)",
    category: "Compartmental ADVAN",
    archetypeId: NmtranArchetypeId.ADVAN3,
    description:
      "Closed-form two-compartment mammillary linear PK model for IV administration with biexponential disposition (alpha, beta).",
    provenance:
      "Gibaldi & Perrier, Pharmacokinetics (2nd ed., Ch. 2); Rowland & Tozer (4th ed., Ch. 19); Gabrielsson & Weiner (5th ed.)",
    params: [
      ["CL", 5.0, "L/h", "Systemic clearance from central compartment"],
      ["V1", 20.0, "L", "Central compartment volume of distribution"],
      ["Q", 10.0, "L/h", "Inter-compartmental distributional clearance"],
      ["V2", 40.0, "L", "Peripheral compartment volume of distribution"],
      ["F1", 1.0, "1", "Bioavailability fraction"],
    ],
  },
  {
    modelType: "ADVAN4",
    aliases: ["advan4", "two_cpt_oral", "2cpt_oral"],
    label: "2-Compartment First-Order Oral Model (ADVAN4)",
    category: "Compartmental ADVAN",
    archetypeId: NmtranArchetypeId.ADVAN4,
    description:
      "Closed-form two-compartment linear PK model with first-order depot absorption (triexponential central concentration profile).",
    provenance:
      "Gibaldi & Perrier, Pharmacokinetics (2nd ed., Ch. 2); Gabrielsson & Weiner, PK/PD Data Analysis (5th ed., PK05)",
    params: [
      ["CL", 5.0, "L/h", "Apparent systemic clearance"],
      ["V2", 20.0, "L", "Apparent central compartment volume"],
      ["Q", 10.0, "L/h", "Apparent inter-compartmental clearance"],
      ["V3", 40.0, "L", "Apparent peripheral compartment volume"],
      ["KA", 1.2, "1/h", "First-order absorption rate constant"],
      ["F1", 1.0, "1", "Depot bioavailability fraction"],
      ["ALAG1", 0.0, "h", "Absorption lag time"],
    ],
  },
  {
    modelType: "ADVAN10",
    aliases: ["advan10", "michaelis_menten", "mm_1cpt"],
    label: "1-Compartment Michaelis-Menten Model (ADVAN10)",
    category: "Compartmental ADVAN",
    archetypeId: NmtranArchetypeId.ADVAN10,
    description:
      "One-compartment nonlinear PK model with saturable Michaelis-Menten elimination: dA/dt = -Vmax * C / (Km + C), solved via Heun RK2.",
    provenance:
      "Gibaldi & Perrier, Pharmacokinetics (2nd ed., Ch. 7); Rowland & Tozer (4th ed., Ch. 17); Gabrielsson & Weiner (PK15)",
    params: [
      ["VM", 50.0, "mg/h", "Maximum elimination rate (Vmax)"],
      ["KM", 10.0, "mg/L", "Michaelis constant (concentration at half Vmax)"],
      ["V", 20.0, "L", "Central volume of distribution"],
      ["F1", 1.0, "1", "Bioavailability fraction"],
    ],
  },
  {
    modelType: "ADVAN11",
    aliases: ["advan11", "three_cpt_iv", "3cpt_iv"],
    label: "3-Compartment Linear IV Model (ADVAN11)",
    category: "Compartmental ADVAN",
    archetypeId: NmtranArchetypeId.ADVAN11,
    description:
      "Closed-form three-compartment mammillary linear PK model for IV administration with exact cubic triexponential disposition.",
    provenance: "Gibaldi & Perrier, Pharmacokinetics (2nd ed., Ch. 2); Rowland & Tozer (4th ed.); FDA PopPK Guidance",
    params: [
      ["CL", 5.0, "L/h", "Systemic clearance"],
      ["V1", 15.0, "L", "Central compartment volume"],
      ["Q2", 10.0, "L/h", "Shallow peripheral inter-compartmental clearance"],
      ["V2", 30.0, "L", "Shallow peripheral compartment volume"],
      ["Q3", 2.0, "L/h", "Deep peripheral inter-compartmental clearance"],
      ["V3", 80.0, "L", "Deep peripheral compartment volume"],
      ["F1", 1.0, "1", "Bioavailability fraction"],
    ],
  },
  {
    modelType: "ADVAN12",
    aliases: ["advan12", "three_cpt_oral", "3cpt_oral"],
    label: "3-Compartment First-Order Oral Model (ADVAN12)",
    category: "Compartmental ADVAN",
    archetypeId: NmtranArchetypeId.ADVAN12,
    description:
      "Closed-form three-compartment mammillary linear PK model with first-order depot absorption (tetraexponential disposition).",
    provenance:
      "Gibaldi & Perrier, Pharmacokinetics (2nd ed., Ch. 2); Gabrielsson & Weiner, PK/PD Data Analysis (5th ed.)",
    params: [
      ["CL", 5.0, "L/h", "Apparent systemic clearance"],
      ["V2", 15.0, "L", "Apparent central compartment volume"],
      ["Q3", 10.0, "L/h", "Apparent shallow peripheral clearance"],
      ["V3", 30.0, "L", "Apparent shallow peripheral volume"],
      ["Q4", 2.0, "L/h", "Apparent deep peripheral clearance"],
      ["V4", 80.0, "L", "Apparent deep peripheral volume"],
      ["KA", 1.2, "1/h", "First-order absorption rate constant"],
      ["F1", 1.0, "1", "Depot bioavailability fraction"],
      ["ALAG1", 0.0, "h", "Absorption lag time"],
    ],
  },

  // === General Linear & Nonlinear ODE ADVAN Subroutines (ADVAN5-ADVAN9, ADVAN13) ===
  {
    modelType: "ADVAN5",
    aliases: ["advan5", "general_linear"],
    label: "General Linear Compartmental Model (ADVAN5)",
    category: "General ODE ADVAN",
    archetypeId: NmtranArchetypeId.ADVAN5,
    description:
      "General linear compartmental system specified via $MODEL and micro-rate constants Kij, evaluated via matrix-exponential / RK solver.",
    provenance: "Gibaldi & Perrier (2nd ed., Appendix B); Beal & Sheiner PREDPP General Linear Model Specification",
    params: [
      ["K10", 0.1, "1/h", "Elimination rate constant from central compartment"],
      ["K12", 0.5, "1/h", "Transfer rate constant from compartment 1 to 2"],
      ["K21", 0.25, "1/h", "Transfer rate constant from compartment 2 to 1"],
      ["V1", 20.0, "L", "Central compartment scaling volume"],
    ],
  },
  {
    modelType: "ADVAN6",
    aliases: ["advan6", "general_nonlinear_dverk", "dverk"],
    label: "General Nonlinear ODE Model — Non-Stiff (ADVAN6)",
    category: "General ODE ADVAN",
    archetypeId: NmtranArchetypeId.ADVAN6,
    description:
      "General nonlinear ODE solver for non-stiff $DES systems (Runge-Kutta / DVERK class integration with TOL control).",
    provenance: "Hull et al. (DVERK Runge-Kutta); Gabrielsson & Weiner (5th ed.); FDA PopPK Guidance",
    params: [
      ["K10", 0.1, "1/h", "Linear elimination rate constant"],
      ["K12", 0.5, "1/h", "Transfer rate constant 1 -> 2"],
      ["K21", 0.25, "1/h", "Transfer rate constant 2 -> 1"],
      ["V1", 20.0, "L", "Central volume"],
      ["TOL", 6.0, "digits", "Relative integration tolerance (10^-TOL)"],
    ],
  },
  {
    modelType: "ADVAN7",
    aliases: ["advan7", "general_linear_real"],
    label: "General Linear Model — Real Eigenvalues (ADVAN7)",
    category: "General ODE ADVAN",
    archetypeId: NmtranArchetypeId.ADVAN7,
    description:
      "General linear compartmental model optimized for real-eigenvalue mammillary/catenary systems with zero oscillatory modes.",
    provenance: "Gibaldi & Perrier (2nd ed.); Beal & Sheiner PREDPP General Linear Real-Eigenvalue Specification",
    params: [
      ["K10", 0.1, "1/h", "Elimination rate constant"],
      ["K12", 0.5, "1/h", "Transfer rate constant 1 -> 2"],
      ["K21", 0.25, "1/h", "Transfer rate constant 2 -> 1"],
      ["V1", 20.0, "L", "Central volume"],
    ],
  },
  {
    modelType: "ADVAN8",
    aliases: ["advan8", "general_nonlinear_stiff", "dgear"],
    label: "General Nonlinear ODE Model — Stiff (ADVAN8)",
    category: "General ODE ADVAN",
    archetypeId: NmtranArchetypeId.ADVAN8,
    description:
      "General nonlinear stiff ODE solver (Gear BDF / DGEAR class) for multi-timescale $DES PK/PD and receptor-binding dynamics.",
    provenance: "Gear (1971) Numerical Initial Value Problems in ODEs; Gabrielsson & Weiner (5th ed.)",
    params: [
      ["K10", 0.1, "1/h", "Elimination rate constant"],
      ["K12", 0.5, "1/h", "Transfer rate constant 1 -> 2"],
      ["K21", 0.25, "1/h", "Transfer rate constant 2 -> 1"],
      ["V1", 20.0, "L", "Central volume"],
      ["TOL", 6.0, "digits", "Relative integration tolerance (10^-TOL)"],
    ],
  },
  {
    modelType: "ADVAN9",
    aliases: ["advan9", "general_dae_lsodi", "lsodi"],
    label: "General Nonlinear DAE/ODE Model — LSODI (ADVAN9)",
    category: "General ODE ADVAN",
    archetypeId: NmtranArchetypeId.ADVAN9,
    description:
      "General nonlinear differential-algebraic equation (DAE) and stiff ODE solver (Hindmarsh LSODI / equilibrium $AES support).",
    provenance: "Hindmarsh (1983) ODEPACK LSODI; FDA PopPK Guidance",
    params: [
      ["K10", 0.1, "1/h", "Elimination rate constant"],
      ["K12", 0.5, "1/h", "Transfer rate constant 1 -> 2"],
      ["K21", 0.25, "1/h", "Transfer rate constant 2 -> 1"],
      ["V1", 20.0, "L", "Central volume"],
      ["TOL", 6.0, "digits", "Relative integration tolerance (10^-TOL)"],
    ],
  },
  {
    modelType: "ADVAN13",
    aliases: ["advan13", "lsoda", "general_nonlinear_lsoda"],
    label: "General Nonlinear ODE Model — LSODA (ADVAN13)",
    category: "General ODE ADVAN",
    archetypeId: NmtranArchetypeId.ADVAN13,
    description:
      "General nonlinear ODE solver with automatic Adams/BDF stiffness switching (Petzold LSODA) for arbitrary $DES PK/PD systems.",
    provenance:
      "Petzold (1983) Automatic Selection of Methods for Solving Stiff and Nonstiff ODEs (LSODA); FDA PopPK Guidance",
    params: [
      ["K10", 0.1, "1/h", "Elimination rate constant"],
      ["K12", 0.5, "1/h", "Transfer rate constant 1 -> 2"],
      ["K21", 0.25, "1/h", "Transfer rate constant 2 -> 1"],
      ["V1", 20.0, "L", "Central volume"],
      ["TOL", 6.0, "digits", "Relative integration tolerance (10^-TOL)"],
    ],
  },

  // === Parameterization Translators (TRANS1-TRANS6) ===
  {
    modelType: "TRANS1",
    aliases: ["trans1", "micro_rates"],
    label: "Micro-Rate Constant Translator (TRANS1)",
    category: "Parameterization TRANS",
    archetypeId: NmtranArchetypeId.TRANS1,
    description:
      "Identity parameterization passing native micro-rate constants (K, K12, K21, K13, K31, KA) directly to ADVAN subroutines.",
    provenance: "Gibaldi & Perrier (2nd ed., Ch. 2); Beal & Sheiner PREDPP TRANS1 Specification",
    params: [
      ["K", 0.1, "1/h", "Elimination rate constant"],
      ["K12", 0.5, "1/h", "Central-to-peripheral rate constant"],
      ["K21", 0.25, "1/h", "Peripheral-to-central rate constant"],
    ],
  },
  {
    modelType: "TRANS2",
    aliases: ["trans2", "cl_v"],
    label: "1-Compartment CL/V Translator (TRANS2)",
    category: "Parameterization TRANS",
    archetypeId: NmtranArchetypeId.TRANS2,
    description:
      "Translates physiological clearance and volume (CL, V) into 1-compartment elimination micro-rate K = CL / V (for ADVAN1/ADVAN2).",
    provenance: "Rowland & Tozer (4th ed., Ch. 3); FDA PopPK Guidance; Beal & Sheiner PREDPP TRANS2",
    params: [
      ["CL", 5.0, "L/h", "Systemic clearance"],
      ["V", 50.0, "L", "Volume of distribution"],
    ],
  },
  {
    modelType: "TRANS3",
    aliases: ["trans3", "cl_v_q_vss"],
    label: "2-Compartment CL/V/Q/VSS Translator (TRANS3)",
    category: "Parameterization TRANS",
    archetypeId: NmtranArchetypeId.TRANS3,
    description:
      "Translates (CL, V, Q, VSS) into 2-compartment micro-rates: K = CL/V, K12 = Q/V, K21 = Q/(VSS - V) (for ADVAN3/ADVAN4).",
    provenance: "Gibaldi & Perrier (2nd ed., Ch. 2); Rowland & Tozer (4th ed., Ch. 19); PREDPP TRANS3",
    params: [
      ["CL", 5.0, "L/h", "Systemic clearance"],
      ["V", 20.0, "L", "Central volume of distribution"],
      ["Q", 10.0, "L/h", "Inter-compartmental clearance"],
      ["VSS", 60.0, "L", "Volume of distribution at steady state (V1 + V2)"],
    ],
  },
  {
    modelType: "TRANS4",
    aliases: ["trans4", "cl_v1_q_v2"],
    label: "2/3-Compartment CL/V/Q Translator (TRANS4)",
    category: "Parameterization TRANS",
    archetypeId: NmtranArchetypeId.TRANS4,
    description:
      "Translates physiological clearances and compartment volumes (CL, V1, Q, V2, [Q3, V3]) into micro-rates for ADVAN3/4/11/12.",
    provenance: "Rowland & Tozer (4th ed., Ch. 19); Gabrielsson & Weiner (5th ed.); FDA PopPK Guidance",
    params: [
      ["CL", 5.0, "L/h", "Systemic clearance"],
      ["V1", 20.0, "L", "Central volume of distribution"],
      ["Q", 10.0, "L/h", "Inter-compartmental clearance"],
      ["V2", 40.0, "L", "Peripheral volume of distribution"],
    ],
  },
  {
    modelType: "TRANS5",
    aliases: ["trans5", "aob_alpha_beta"],
    label: "2-Compartment AOB/ALPHA/BETA Translator (TRANS5)",
    category: "Parameterization TRANS",
    archetypeId: NmtranArchetypeId.TRANS5,
    description:
      "Translates biexponential macro-constants (AOB = A/B, ALPHA, BETA) into 2-compartment micro-rates K21, K, K12.",
    provenance: "Gibaldi & Perrier, Pharmacokinetics (2nd ed., Ch. 2); PREDPP TRANS5 Specification",
    params: [
      ["AOB", 1.5, "1", "Ratio of macro-coefficients A/B"],
      ["ALPHA", 0.8, "1/h", "Fast distribution hybrid rate constant"],
      ["BETA", 0.08, "1/h", "Terminal elimination hybrid rate constant"],
    ],
  },
  {
    modelType: "TRANS6",
    aliases: ["trans6", "alpha_beta_k21"],
    label: "2/3-Compartment Hybrid Rate Translator (TRANS6)",
    category: "Parameterization TRANS",
    archetypeId: NmtranArchetypeId.TRANS6,
    description:
      "Translates hybrid rate constants (ALPHA, BETA, K21, [GAMMA, K31]) into compartmental micro-rates K = (ALPHA*BETA)/K21 and K12.",
    provenance: "Gibaldi & Perrier, Pharmacokinetics (2nd ed., Ch. 2); PREDPP TRANS6 Specification",
    params: [
      ["ALPHA", 0.8, "1/h", "Fast hybrid rate constant"],
      ["BETA", 0.08, "1/h", "Slow hybrid rate constant"],
      ["K21", 0.25, "1/h", "Peripheral-to-central rate constant"],
    ],
  },

  // === PK/PD Models & Residual Error Blocks ===
  {
    modelType: "PRED_EMAX",
    aliases: ["pred_emax", "emax", "hill_emax", "sigmoidal_emax"],
    label: "Direct Hill / Sigmoidal Emax PD Model",
    category: "PK/PD Model",
    archetypeId: NmtranArchetypeId.PRED_EMAX,
    description:
      "Direct concentration-effect sigmoidal Emax (Hill) pharmacodynamic model: E = E0 + Emax * C^gamma / (EC50^gamma + C^gamma).",
    provenance:
      "Gabrielsson & Weiner, PK/PD Data Analysis (5th ed., PD01/PD03); Rowland & Tozer (4th ed., Ch. 21); FDA PopPK Guidance",
    params: [
      ["E0", 0.0, "units", "Baseline pharmacodynamic effect"],
      ["EMAX", 100.0, "units", "Maximum drug-induced effect"],
      ["EC50", 10.0, "mg/L", "Concentration producing 50% of Emax"],
      ["GAMMA", 1.0, "1", "Hill sigmoidicity exponent"],
    ],
  },
  {
    modelType: "PRED_INDIRECT_RESP",
    aliases: ["pred_indirect_resp", "indirect_response", "idr_type1", "jusko_idr"],
    label: "Indirect Response Turnover PK/PD Model",
    category: "PK/PD Model",
    archetypeId: NmtranArchetypeId.PRED_INDIRECT_RESP,
    description:
      "Indirect pharmacodynamic response turnover model (Type I inhibition of Kin): dR/dt = Kin * (1 - Imax*C^g/(IC50^g + C^g)) - Kout*R.",
    provenance:
      "Dayneka, Garg & Jusko (1993) J. Pharmacokinet. Biopharm. 21(4):457-478; Gabrielsson & Weiner (5th ed., PD22)",
    params: [
      ["KIN", 10.0, "units/h", "Zero-order response production rate constant"],
      ["KOUT", 0.5, "1/h", "First-order response dissipation rate constant"],
      ["IMAX", 0.9, "1", "Maximum fractional inhibition (0..1)"],
      ["IC50", 10.0, "mg/L", "Concentration producing 50% of Imax"],
      ["GAMMA", 1.0, "1", "Hill exponent"],
    ],
  },
  {
    modelType: "PRED_TMDD",
    aliases: ["pred_tmdd", "tmdd", "tmdd_qss"],
    label: "Target-Mediated Drug Disposition (TMDD)",
    category: "PK/PD Model",
    archetypeId: NmtranArchetypeId.PRED_TMDD,
    description:
      "Quasi-steady-state (QSS) Target-Mediated Drug Disposition model for biologics/mAbs combining linear clearance and saturable receptor internalization.",
    provenance: "Mager & Jusko (2001) J. Pharmacokinet. Pharmacodyn. 28(6):507-532; Gibiansky et al. (2008) QSS TMDD",
    params: [
      ["CL", 0.3, "L/h", "Linear non-specific clearance"],
      ["V", 3.0, "L", "Central volume of distribution"],
      ["R0", 10.0, "mg/L", "Baseline target receptor concentration"],
      ["KINT", 0.1, "1/h", "Drug-receptor complex internalization rate"],
      ["KSS", 1.0, "mg/L", "Quasi-steady-state dissociation constant (KD + KINT/KON)"],
    ],
  },
  {
    modelType: "ERROR_PROP",
    aliases: ["error_prop", "proportional_error", "ruv_prop"],
    label: "Proportional Residual Error Model",
    category: "Residual Error",
    archetypeId: NmtranArchetypeId.ERROR_PROP,
    description:
      "Proportional (constant CV) residual unexplained variability block for $ERROR: Y = IPRED * (1 + EPS(1)).",
    provenance: "FDA Population Pharmacokinetics Guidance for Industry (2022); Gabrielsson & Weiner (5th ed.)",
    params: [["SIGMA_PROP", 0.1, "CV", "Proportional residual error standard deviation (CV)"]],
  },
  {
    modelType: "ERROR_ADD",
    aliases: ["error_add", "additive_error", "ruv_add"],
    label: "Additive Residual Error Model",
    category: "Residual Error",
    archetypeId: NmtranArchetypeId.ERROR_ADD,
    description: "Additive (homoscedastic) residual unexplained variability block for $ERROR: Y = IPRED + EPS(1).",
    provenance: "FDA Population Pharmacokinetics Guidance for Industry (2022); Gabrielsson & Weiner (5th ed.)",
    params: [["SIGMA_ADD", 0.5, "mg/L", "Additive residual error standard deviation"]],
  },
  {
    modelType: "ERROR_COMB",
    aliases: ["error_comb", "combined_error", "ruv_comb"],
    label: "Combined Additive + Proportional Error Model",
    category: "Residual Error",
    archetypeId: NmtranArchetypeId.ERROR_COMB,
    description:
      "Combined proportional and additive residual error block for $ERROR: Y = IPRED * (1 + EPS(1)) + EPS(2).",
    provenance: "FDA Population Pharmacokinetics Guidance for Industry (2022); Gabrielsson & Weiner (5th ed.)",
    params: [
      ["SIGMA_PROP", 0.1, "CV", "Proportional residual error standard deviation"],
      ["SIGMA_ADD", 0.5, "mg/L", "Additive residual error standard deviation"],
    ],
  },
];

/**
 * Converts `NMTRAN_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildNmtranCleanroomSchemas(): CleanroomModelSchema[] {
  return NMTRAN_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `nmtran:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "pharmacometrics",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "nmtran_subroutine",
      width: 80,
      height: 48,
      svg: generateNmtranBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
