// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * LBNL TOUGH2 / TOUGH3 cleanroom archetype IDs matching `assets/tough-std-lib/src/models.ts`.
 */
export const ToughArchetypeId = {
  // Equation-of-State (EOS) Modules
  EOS1_WATER: 1,
  EOS2_WATER_CO2: 2,
  EOS3_WATER_AIR: 3,
  EOS4_VAPOR_LOWERING: 4,
  EOS5_WATER_H2: 5,
  EOS7_BRINE: 7,
  EOS7C_CH4_CO2: 8,
  EOS9_RICHARDS: 9,
  ECO2N_CO2_BRINE: 10,
  EWASG_SALT_GAS: 11,
  TMVOC_VOC: 12,

  // Relative Permeability Models (IRP)
  IRP1_LINEAR: 101,
  IRP3_COREY: 103,
  IRP4_GRANT: 104,
  IRP7_VANGENUCHTEN: 107,
  IRP8_VERMA: 108,
  IRP11_STONE: 111,

  // Capillary Pressure Models (ICP)
  ICP1_LINEAR: 201,
  ICP3_PICKENS: 203,
  ICP4_TRUST: 204,
  ICP7_VANGENUCHTEN: 207,
  ICP8_LEVERETT: 208,
} as const;

export type ToughArchetypeId = (typeof ToughArchetypeId)[keyof typeof ToughArchetypeId];

export interface ToughModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: "EOS Module" | "Relative Permeability" | "Capillary Pressure";
  archetypeId: ToughArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<ToughModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
  "EOS Module": { fill: "#1e3a5f", stroke: "#38bdf8", badge: "EOS" },
  "Relative Permeability": { fill: "#1e3f2f", stroke: "#34d399", badge: "IRP" },
  "Capillary Pressure": { fill: "#3b234a", stroke: "#c084fc", badge: "ICP" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a TOUGH2/TOUGH3 EOS or constitutive model.
 */
export function generateToughBlockSvg(modelType: string, category: ToughModelSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 8);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 48" width="80" height="48">` +
    `<rect x="2" y="2" width="76" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="40" y="34" text-anchor="middle" font-family="monospace" font-size="10" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: ToughModelSpec["category"]): DiagramPortSpec[] {
  switch (category) {
    case "EOS Module":
      return [
        { name: "pressure", kind: "fluid", side: "left", dx: 0, dy: 14 },
        { name: "temperature", kind: "thermal", side: "left", dx: 0, dy: 34 },
        { name: "state_out", kind: "fluid", side: "right", dx: 80, dy: 24 },
      ];
    case "Relative Permeability":
      return [
        { name: "sl", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "krl", kind: "signal", side: "right", dx: 80, dy: 14 },
        { name: "krg", kind: "signal", side: "right", dx: 80, dy: 34 },
      ];
    case "Capillary Pressure":
      return [
        { name: "sl", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "pcap", kind: "fluid", side: "right", dx: 80, dy: 24 },
      ];
  }
}

export const TOUGH_MODEL_SPECS: ToughModelSpec[] = [
  // ── Equation-of-State (EOS) Modules ──────────────────────────────────────────
  {
    modelType: "eos1",
    aliases: ["EOS1", "EOS1_WATER", "eos1_water", "water"],
    label: "EOS1: Pure Water / Steam (IAPWS-IF97)",
    category: "EOS Module",
    archetypeId: ToughArchetypeId.EOS1_WATER,
    description:
      "Non-isothermal single-component water and steam equation-of-state module for geothermal and hydrothermal reservoirs using IAPWS-IF97 thermodynamic formulations.",
    provenance: "Pruess, Oldenburg & Moridis (1999) LBNL-43134 TOUGH2 User's Guide; IAPWS-IF97 (Wagner et al. 2000)",
    params: [
      ["pRef", 101325.0, "Pa", "Reference pressure"],
      ["tRef", 25.0, "degC", "Reference temperature"],
      ["compressibility", 4.5e-10, "1/Pa", "Liquid water isothermal compressibility"],
      ["cpWater", 4184.0, "J/(kg*K)", "Reference liquid water specific heat"],
    ],
  },
  {
    modelType: "eos2",
    aliases: ["EOS2", "EOS2_WATER_CO2", "eos2_water_co2", "water_co2"],
    label: "EOS2: Water + CO2 Non-Isothermal",
    category: "EOS Module",
    archetypeId: ToughArchetypeId.EOS2_WATER_CO2,
    description:
      "Two-component water and CO2 equation-of-state module for geothermal reservoirs with non-condensible CO2 gas, accounting for CO2 dissolution and real-gas enthalpy.",
    provenance:
      "Pruess (1991) LBL-29400; Pruess et al. (1999) LBNL-43134; Span & Wagner (1996) J. Phys. Chem. Ref. Data 25",
    params: [
      ["henryCO2", 1.65e8, "Pa", "Henry's constant for CO2 in water at reference T"],
      ["molarMassCO2", 0.04401, "kg/mol", "Molar mass of CO2"],
      ["tCritCO2", 304.1282, "K", "Critical temperature of CO2 (Span-Wagner)"],
      ["pCritCO2", 7.3773e6, "Pa", "Critical pressure of CO2 (Span-Wagner)"],
    ],
  },
  {
    modelType: "eos3",
    aliases: ["EOS3", "EOS3_WATER_AIR", "eos3_water_air", "water_air"],
    label: "EOS3: Water + Air Vadose / Saturated",
    category: "EOS Module",
    archetypeId: ToughArchetypeId.EOS3_WATER_AIR,
    description:
      "Two-phase non-isothermal water and air equation-of-state module for vadose zone hydrology, nuclear waste isolation, and unsaturated porous media.",
    provenance: "Pruess (1991) LBL-29400; Pruess, Oldenburg & Moridis (1999) LBNL-43134; IAPWS-IF97",
    params: [
      ["henryAir", 1.0e10, "Pa", "Henry's constant for air dissolution in water"],
      ["molarMassAir", 0.02896, "kg/mol", "Molar mass of dry air"],
      ["diffVapor", 2.13e-5, "m^2/s", "Binary vapor-air diffusion coefficient at 0 degC"],
    ],
  },
  {
    modelType: "eos4",
    aliases: ["EOS4", "EOS4_VAPOR_LOWERING", "eos4_vapor_lowering"],
    label: "EOS4: Water + Air with Vapor Pressure Lowering",
    category: "EOS Module",
    archetypeId: ToughArchetypeId.EOS4_VAPOR_LOWERING,
    description:
      "Water and air EOS incorporating Kelvin's equation for capillary vapor pressure lowering in strongly desiccated porous media.",
    provenance: "Pruess (1991) LBL-29400; Pruess et al. (1999) LBNL-43134; Edlefsen & Anderson (1943) Hilgardia 15",
    params: [
      ["henryAir", 1.0e10, "Pa", "Henry's constant for air in water"],
      ["molarMassWater", 0.018015, "kg/mol", "Molar mass of H2O for Kelvin equation"],
      ["pCapScale", 1.0, "1", "Vapor pressure lowering scaling factor"],
    ],
  },
  {
    modelType: "eos5",
    aliases: ["EOS5", "EOS5_WATER_H2", "eos5_water_h2", "water_h2"],
    label: "EOS5: Water + Hydrogen Gas",
    category: "EOS Module",
    archetypeId: ToughArchetypeId.EOS5_WATER_H2,
    description:
      "Two-phase water and hydrogen equation-of-state module for underground hydrogen storage (UHS) and radioactive waste repository corrosion gas migration.",
    provenance: "Pruess (1991) LBL-29400; Pruess, Oldenburg & Moridis (1999) LBNL-43134; IAPWS-IF97",
    params: [
      ["henryH2", 6.8e9, "Pa", "Henry's constant for H2 in water"],
      ["molarMassH2", 0.002016, "kg/mol", "Molar mass of H2"],
      ["diffH2", 6.1e-5, "m^2/s", "Binary H2-vapor diffusion coefficient"],
    ],
  },
  {
    modelType: "eos7",
    aliases: ["EOS7", "EOS7_BRINE", "eos7_brine", "brine"],
    label: "EOS7: Water + Brine + Air",
    category: "EOS Module",
    archetypeId: ToughArchetypeId.EOS7_BRINE,
    description:
      "Three-component water, brine (NaCl), and air equation-of-state module with salinity-dependent aqueous density and viscosity.",
    provenance: "Pruess (1991) LBL-29400; Pruess et al. (1999) LBNL-43134; Herbert et al. (1988) Water Resour. Res. 24",
    params: [
      ["rhoBrineRef", 1185.1, "kg/m^3", "Reference saturated brine density at 25 degC"],
      ["maxSalinity", 0.265, "kg/kg", "Halite saturation mass fraction"],
      ["henryAir", 1.0e10, "Pa", "Henry's constant for air in brine"],
    ],
  },
  {
    modelType: "eos7c",
    aliases: ["EOS7C", "EOS7C_CH4_CO2", "eos7c_ch4_co2"],
    label: "EOS7C: Water + Brine + CH4 + CO2",
    category: "EOS Module",
    archetypeId: ToughArchetypeId.EOS7C_CH4_CO2,
    description:
      "Multicomponent EOS for methane, carbon dioxide, water, and brine mixtures in enhanced gas recovery (CSEGR) and subsurface carbon storage.",
    provenance: "Oldenburg, Moridis, Spycher & Pruess (2004) LBNL-56589 EOS7C; Span & Wagner (1996)",
    params: [
      ["molarMassCH4", 0.01604, "kg/mol", "Molar mass of CH4"],
      ["molarMassCO2", 0.04401, "kg/mol", "Molar mass of CO2"],
      ["henryCH4", 4.1e9, "Pa", "Henry's constant for CH4 in water"],
      ["henryCO2", 1.65e8, "Pa", "Henry's constant for CO2 in water"],
    ],
  },
  {
    modelType: "eos9",
    aliases: ["EOS9", "EOS9_RICHARDS", "eos9_richards", "richards"],
    label: "EOS9: Richards Equation (Saturated / Unsaturated)",
    category: "EOS Module",
    archetypeId: ToughArchetypeId.EOS9_RICHARDS,
    description:
      "Single-phase variably saturated isothermal water flow solver using Richards' equation with passive constant-pressure gas phase and Van Genuchten-Mualem hydraulic conductivity.",
    provenance: "Pruess, Oldenburg & Moridis (1999) LBNL-43134 EOS9; Richards (1931) Physics 1; van Genuchten (1980)",
    params: [
      ["permeability", 1.0e-12, "m^2", "Intrinsic rock permeability k"],
      ["vgLambda", 0.457, "1", "Van Genuchten m (= 1 - 1/n)"],
      ["slr", 0.15, "1", "Residual liquid saturation"],
      ["sls", 1.0, "1", "Saturated liquid saturation"],
      ["vgAlpha", 1.0e-4, "1/Pa", "Van Genuchten inverse air-entry pressure 1/P0"],
    ],
  },
  {
    modelType: "eco2n",
    aliases: ["ECO2N", "ECO2N_CO2_BRINE", "eco2n_co2_brine", "eco2n_v2"],
    label: "ECO2N: Supercritical CO2 + Brine + Halite",
    category: "EOS Module",
    archetypeId: ToughArchetypeId.ECO2N_CO2_BRINE,
    description:
      "Thermodynamic fluid property module for geological sequestration of supercritical CO2 in deep saline aquifers with mutual H2O-CO2 solubility and halite salting-out.",
    provenance:
      "Pruess (2005) LBNL-57952 ECO2N; Spycher & Pruess (2005) Geochim. Cosmochim. Acta 69; Span & Wagner (1996)",
    params: [
      ["salinityRef", 0.05, "kg/kg", "Reference NaCl brine mass fraction"],
      ["tCritCO2", 304.1282, "K", "Critical temperature of CO2 (Span-Wagner)"],
      ["pCritCO2", 7.3773e6, "Pa", "Critical pressure of CO2 (Span-Wagner)"],
      ["saltingOutCoeff", 0.12, "kg/mol", "Setschenow salting-out coefficient for CO2 in NaCl brine"],
    ],
  },
  {
    modelType: "ewasg",
    aliases: ["EWASG", "EWASG_SALT_GAS", "ewasg_salt_gas"],
    label: "EWASG: Water + NaCl + Non-Condensible Gas",
    category: "EOS Module",
    archetypeId: ToughArchetypeId.EWASG_SALT_GAS,
    description:
      "Geothermal EOS for water, NaCl salt (including solid halite precipitation and porosity-permeability feedback), and non-condensible gas (CO2/CH4/N2).",
    provenance: "Battistelli, Calore & Pruess (1997) Geothermics 26; Pruess et al. (1999) LBNL-43134",
    params: [
      ["haliteDensity", 2165.0, "kg/m^3", "Solid halite crystal density"],
      ["salinitySat", 0.265, "kg/kg", "Halite solubility limit mass fraction"],
      ["permReductionExp", 3.0, "1", "Porosity-permeability reduction exponent"],
    ],
  },
  {
    modelType: "tmvoc",
    aliases: ["TMVOC", "TMVOC_VOC", "tmvoc_voc"],
    label: "TMVOC: Three-Phase Water + Air + VOCs",
    category: "EOS Module",
    archetypeId: ToughArchetypeId.TMVOC_VOC,
    description:
      "Three-phase non-isothermal multicomponent EOS for volatile organic compound (NAPL) contamination and thermal remediation in heterogeneous porous media.",
    provenance: "Pruess & Battistelli (2002) LBNL-49375 TMVOC User's Guide; Pruess et al. (1999) LBNL-43134",
    params: [
      ["rhoNapl", 870.0, "kg/m^3", "Reference NAPL / VOC liquid density"],
      ["molarMassVoc", 0.09214, "kg/mol", "Reference VOC molar mass (toluene)"],
      ["vaporPressureVoc", 3800.0, "Pa", "VOC saturation vapor pressure at 25 degC"],
    ],
  },

  // ── Relative Permeability Models (IRP) ───────────────────────────────────────
  {
    modelType: "irp1",
    aliases: ["IRP1", "IRP1_LINEAR", "irp1_linear", "linear_rp"],
    label: "IRP=1: Linear Relative Permeability",
    category: "Relative Permeability",
    archetypeId: ToughArchetypeId.IRP1_LINEAR,
    description: "Piecewise linear liquid and gas relative permeability functions over specified saturation intervals.",
    provenance: "Pruess (1991) LBL-29400; Pruess, Oldenburg & Moridis (1999) LBNL-43134 Table 10 (IRP=1)",
    params: [
      ["rp1", 0.0, "1", "Liquid saturation where k_rl = 0"],
      ["rp2", 0.0, "1", "Gas saturation where k_rg = 0"],
      ["rp3", 1.0, "1", "Liquid saturation where k_rl = 1"],
      ["rp4", 1.0, "1", "Gas saturation where k_rg = 1"],
    ],
  },
  {
    modelType: "irp3",
    aliases: ["IRP3", "IRP3_COREY", "irp3_corey", "corey"],
    label: "IRP=3: Corey (1954) Relative Permeability",
    category: "Relative Permeability",
    archetypeId: ToughArchetypeId.IRP3_COREY,
    description:
      "Classic Corey (1954) power-law two-phase relative permeability formulation: k_rl = S_hat^4, k_rg = (1 - S_hat)^2 * (1 - S_hat^2).",
    provenance: "Corey (1954) Producers Monthly 19(1):38-41; Pruess et al. (1999) LBNL-43134 Table 10 (IRP=3)",
    params: [
      ["slr", 0.3, "1", "RP(1): Residual liquid saturation S_lr"],
      ["sgr", 0.05, "1", "RP(2): Residual gas saturation S_gr"],
    ],
  },
  {
    modelType: "irp4",
    aliases: ["IRP4", "IRP4_GRANT", "irp4_grant", "grant"],
    label: "IRP=4: Grant (1977) Geothermal Relative Permeability",
    category: "Relative Permeability",
    archetypeId: ToughArchetypeId.IRP4_GRANT,
    description:
      "Grant's (1977) fractured geothermal steam-water relative permeability curve where k_rl follows Corey and k_rg = 1 - k_rl.",
    provenance: "Grant (1977) Geothermics 6(1-2):9-29; Pruess et al. (1999) LBNL-43134 Table 10 (IRP=4)",
    params: [
      ["slr", 0.3, "1", "RP(1): Residual liquid saturation S_lr"],
      ["sgr", 0.05, "1", "RP(2): Residual gas saturation S_gr"],
    ],
  },
  {
    modelType: "irp7",
    aliases: ["IRP7", "IRP7_VANGENUCHTEN", "irp7_vangenuchten", "vangenuchten_rp", "mualem"],
    label: "IRP=7: Van Genuchten-Mualem Relative Permeability",
    category: "Relative Permeability",
    archetypeId: ToughArchetypeId.IRP7_VANGENUCHTEN,
    description:
      "Van Genuchten-Mualem (1980) closed-form unsaturated liquid relative permeability with optional Corey gas permeability when S_gr > 0.",
    provenance:
      "van Genuchten (1980) Soil Sci. Soc. Am. J. 44:892-898; Mualem (1976); Pruess et al. (1999) LBNL-43134 (IRP=7)",
    params: [
      ["lambda", 0.457, "1", "RP(1): Shape parameter m = 1 - 1/n"],
      ["slr", 0.15, "1", "RP(2): Residual liquid saturation S_lr"],
      ["sls", 1.0, "1", "RP(3): Saturated liquid saturation S_ls"],
      ["sgr", 0.05, "1", "RP(4): Residual gas saturation S_gr"],
    ],
  },
  {
    modelType: "irp8",
    aliases: ["IRP8", "IRP8_VERMA", "irp8_verma", "verma"],
    label: "IRP=8: Verma (1985) Steam-Water Relative Permeability",
    category: "Relative Permeability",
    archetypeId: ToughArchetypeId.IRP8_VERMA,
    description:
      "Verma et al. (1985) polynomial steam-water relative permeability correlation derived from two-phase geothermal core flood experiments.",
    provenance: "Verma, Pruess, Tsang & Witherspoon (1985) LBL-19148; Pruess et al. (1999) LBNL-43134 Table 10 (IRP=8)",
    params: [
      ["slr", 0.2, "1", "RP(1): Residual liquid saturation S_lr"],
      ["sgr", 0.05, "1", "RP(2): Residual gas saturation S_gr"],
      ["a", 1.259, "1", "RP(3): Gas polynomial linear coefficient A"],
      ["b", -1.7615, "1", "RP(4): Gas polynomial quadratic coefficient B"],
      ["c", 0.5089, "1", "RP(5): Gas polynomial cubic coefficient C"],
    ],
  },
  {
    modelType: "irp11",
    aliases: ["IRP11", "IRP11_STONE", "irp11_stone", "stone"],
    label: "IRP=11: Stone (1970) Three-Phase Relative Permeability",
    category: "Relative Permeability",
    archetypeId: ToughArchetypeId.IRP11_STONE,
    description:
      "Modified Stone (1970) first three-phase relative permeability model for aqueous, gas, and NAPL/oil phases.",
    provenance: "Stone (1970) J. Pet. Technol. 22:214-218; Pruess et al. (1999) LBNL-43134 (IRP=11)",
    params: [
      ["slr", 0.2, "1", "RP(1): Residual water saturation S_lr"],
      ["sgr", 0.05, "1", "RP(2): Residual gas saturation S_gr"],
      ["snr", 0.1, "1", "RP(3): Residual NAPL saturation S_nr"],
      ["nExp", 3.0, "1", "RP(4): Power-law exponent n"],
    ],
  },

  // ── Capillary Pressure Models (ICP) ──────────────────────────────────────────
  {
    modelType: "icp1",
    aliases: ["ICP1", "ICP1_LINEAR", "icp1_linear", "linear_cp"],
    label: "ICP=1: Linear Capillary Pressure",
    category: "Capillary Pressure",
    archetypeId: ToughArchetypeId.ICP1_LINEAR,
    description: "Piecewise linear capillary pressure ramp from -CP(1) at S_l <= CP(2) to 0 at S_l >= CP(3).",
    provenance: "Pruess (1991) LBL-29400; Pruess, Oldenburg & Moridis (1999) LBNL-43134 Table 11 (ICP=1)",
    params: [
      ["pMax", 1.0e5, "Pa", "CP(1): Maximum capillary pressure magnitude"],
      ["slMin", 0.1, "1", "CP(2): Lower saturation cutoff"],
      ["slMax", 1.0, "1", "CP(3): Upper saturation cutoff"],
    ],
  },
  {
    modelType: "icp3",
    aliases: ["ICP3", "ICP3_PICKENS", "icp3_pickens", "pickens"],
    label: "ICP=3: Pickens (1979) Capillary Pressure",
    category: "Capillary Pressure",
    archetypeId: ToughArchetypeId.ICP3_PICKENS,
    description: "Pickens et al. (1979) logarithmic soil-water retention capillary pressure function.",
    provenance:
      "Pickens, Gillham & Cameron (1979) Water Resour. Res. 15; Pruess et al. (1999) LBNL-43134 Table 11 (ICP=3)",
    params: [
      ["p0", 5.0e4, "Pa", "CP(1): Capillary pressure scale P0"],
      ["slr", 0.1, "1", "CP(2): Residual liquid saturation S_lr"],
      ["sl0", 1.0, "1", "CP(3): Maximum liquid saturation S_l0"],
      ["xExp", 1.5, "1", "CP(4): Shape exponent x"],
    ],
  },
  {
    modelType: "icp4",
    aliases: ["ICP4", "ICP4_TRUST", "icp4_trust", "trust"],
    label: "ICP=4: TRUST / Narasimhan (1978) Capillary Pressure",
    category: "Capillary Pressure",
    archetypeId: ToughArchetypeId.ICP4_TRUST,
    description:
      "Narasimhan et al. (1978) TRUST power-law soil moisture characteristic curve with air-entry pressure P_e.",
    provenance:
      "Narasimhan, Witherspoon & Edwards (1978) Water Resour. Res. 14; Pruess et al. (1999) LBNL-43134 (ICP=4)",
    params: [
      ["p0", 1.0e4, "Pa", "CP(1): Capillary pressure scale P0"],
      ["slr", 0.1, "1", "CP(2): Residual liquid saturation S_lr"],
      ["eta", 2.0, "1", "CP(3): Power-law exponent eta"],
      ["pe", 1.0e3, "Pa", "CP(4): Air-entry pressure P_e"],
    ],
  },
  {
    modelType: "icp7",
    aliases: ["ICP7", "ICP7_VANGENUCHTEN", "icp7_vangenuchten", "vangenuchten_cp"],
    label: "ICP=7: Van Genuchten (1980) Capillary Pressure",
    category: "Capillary Pressure",
    archetypeId: ToughArchetypeId.ICP7_VANGENUCHTEN,
    description:
      "Van Genuchten (1980) closed-form capillary pressure retention curve: P_cap = -(1/alpha) * [(S*)^(-1/m) - 1]^(1-m), bounded by -P_max.",
    provenance:
      "van Genuchten (1980) Soil Sci. Soc. Am. J. 44:892-898; Pruess, Oldenburg & Moridis (1999) LBNL-43134 Table 11 (ICP=7)",
    params: [
      ["lambda", 0.457, "1", "CP(1): Shape parameter m = 1 - 1/n"],
      ["slr", 0.15, "1", "CP(2): Residual liquid saturation S_lr"],
      ["alpha", 1.0e-4, "1/Pa", "CP(3): Inverse air-entry pressure 1/P0"],
      ["pMax", 1.0e7, "Pa", "CP(4): Maximum capillary pressure magnitude"],
      ["sls", 1.0, "1", "CP(5): Saturated liquid saturation S_ls"],
    ],
  },
  {
    modelType: "icp8",
    aliases: ["ICP8", "ICP8_LEVERETT", "icp8_leverett", "leverett"],
    label: "ICP=8: Leverett (1941) J-Function Capillary Pressure",
    category: "Capillary Pressure",
    archetypeId: ToughArchetypeId.ICP8_LEVERETT,
    description:
      "Leverett (1941) dimensionless J-function scaling capillary pressure by interfacial tension and sqrt(phi / k).",
    provenance: "Leverett (1941) Trans. AIME 142:152-169; Pruess et al. (1999) LBNL-43134 (ICP=8)",
    params: [
      ["sigma", 0.072, "N/m", "CP(1): Surface / interfacial tension sigma"],
      ["porosity", 0.2, "1", "CP(2): Rock porosity phi"],
      ["permeability", 1.0e-13, "m^2", "CP(3): Intrinsic permeability k"],
      ["slr", 0.15, "1", "CP(4): Residual liquid saturation S_lr"],
    ],
  },
];

/**
 * Converts `TOUGH_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildToughCleanroomSchemas(): CleanroomModelSchema[] {
  return TOUGH_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `tough:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "subsurface",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "tough_constitutive_model",
      width: 80,
      height: 48,
      svg: generateToughBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
