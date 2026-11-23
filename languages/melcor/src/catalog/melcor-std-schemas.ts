// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * MELCOR cleanroom severe-accident package & material archetype IDs matching
 * `assets/melcor-std-lib/src/models.ts`.
 */
export const MelcorArchetypeId = {
  // CVH — Control Volume Hydrodynamics (1..9)
  CVH_VOLUME: 1,
  CVH_TMDP: 2,

  // FL — Flow Paths (10..19)
  FL_PATH: 10,
  FL_VALVE: 11,

  // HS — Heat Structures (20..29)
  HS_SLAB: 20,

  // COR — Core Degradation & Oxidation (30..39)
  COR_CELL: 30,
  COR_OX_UH: 31,
  COR_DECAY_ANS: 32,

  // RN1 — Radionuclide / Aerosol Transport (40..49)
  RN1_AEROSOL: 40,

  // CF / TF — Control & Tabular Functions (50..59)
  CF_FUNC: 50,
  TF_TABLE: 51,

  // MP — Severe-Accident Solid Material Properties (60..69)
  MP_UO2: 60,
  MP_ZIRCALOY4: 61,
  MP_SS304: 62,

  // NCG — Non-Condensable Gases & Steam Properties (70..79)
  NCG_H2: 70,
  NCG_N2: 71,
  NCG_H2O: 72,
} as const;

export type MelcorArchetypeId = (typeof MelcorArchetypeId)[keyof typeof MelcorArchetypeId];

export type MelcorModelCategory =
  | "CVH Control Volume"
  | "FL Flow Path"
  | "HS Heat Structure"
  | "COR Core & Oxidation"
  | "RN1 Radionuclide"
  | "CF/TF Control & Table"
  | "MP Material Property"
  | "NCG Gas Property";

export interface MelcorModelSpec {
  modelType: string;
  pkg: "CVH" | "FL" | "HS" | "COR" | "RN1" | "CF" | "TF" | "MP" | "NCG";
  aliases?: string[];
  label: string;
  category: MelcorModelCategory;
  archetypeId: MelcorArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<MelcorModelCategory, { fill: string; stroke: string; badge: string }> = {
  "CVH Control Volume": { fill: "#172554", stroke: "#60a5fa", badge: "CVH" },
  "FL Flow Path": { fill: "#164e63", stroke: "#22d3ee", badge: "FL" },
  "HS Heat Structure": { fill: "#431407", stroke: "#fb923c", badge: "HS" },
  "COR Core & Oxidation": { fill: "#450a0a", stroke: "#f87171", badge: "COR" },
  "RN1 Radionuclide": { fill: "#3b0764", stroke: "#c084fc", badge: "RN1" },
  "CF/TF Control & Table": { fill: "#14532d", stroke: "#4ade80", badge: "CF" },
  "MP Material Property": { fill: "#3f2e05", stroke: "#facc15", badge: "MP" },
  "NCG Gas Property": { fill: "#1e293b", stroke: "#94a3b8", badge: "NCG" },
};

export function generateMelcorBlockSvg(modelType: string, category: MelcorModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 11);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 48" width="92" height="48">` +
    `<rect x="2" y="2" width="88" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="26" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="19" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="46" y="34" text-anchor="middle" font-family="monospace" font-size="9" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: MelcorModelCategory): DiagramPortSpec[] {
  switch (category) {
    case "CVH Control Volume":
      return [
        { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "outlet", kind: "fluid", side: "right", dx: 92, dy: 24 },
        { name: "heat", kind: "thermal", side: "top", dx: 46, dy: 0 },
      ];
    case "FL Flow Path":
      return [
        { name: "from_cv", kind: "fluid", side: "left", dx: 0, dy: 24 },
        { name: "to_cv", kind: "fluid", side: "right", dx: 92, dy: 24 },
      ];
    case "HS Heat Structure":
      return [
        { name: "left_cv", kind: "thermal", side: "left", dx: 0, dy: 24 },
        { name: "right_cv", kind: "thermal", side: "right", dx: 92, dy: 24 },
      ];
    case "COR Core & Oxidation":
      return [
        { name: "coolant_cv", kind: "fluid", side: "bottom", dx: 46, dy: 48 },
        { name: "h2_out", kind: "fluid", side: "right", dx: 92, dy: 24 },
        { name: "power_in", kind: "signal", side: "top", dx: 46, dy: 0 },
      ];
    default:
      return [
        { name: "in", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "out", kind: "signal", side: "right", dx: 92, dy: 24 },
      ];
  }
}

export const MELCOR_MODEL_SPECS: MelcorModelSpec[] = [
  {
    modelType: "CVH_VOLUME",
    pkg: "CVH",
    aliases: ["CVH", "CV_ID", "CONTROL_VOLUME"],
    label: "CVH Control Volume",
    category: "CVH Control Volume",
    archetypeId: MelcorArchetypeId.CVH_VOLUME,
    description: "Two-phase / non-condensable compressible control volume with mass and internal energy conservation.",
    provenance: "Sandia MELCOR 2.2 Reference Manual (SAND2015-6691), CVH Package",
    params: [
      ["volume", 100.0, "m^3", "Total hydrodynamic volume"],
      ["p0", 1.55e7, "Pa", "Initial pressure"],
      ["t0", 580.0, "K", "Initial temperature"],
      ["rGas", 461.52, "J/(kg*K)", "Effective gas constant"],
      ["cv", 1500.0, "J/(kg*K)", "Isochoric specific heat"],
    ],
  },
  {
    modelType: "CVH_TMDP",
    pkg: "CVH",
    aliases: ["TIME_INDEPENDENT_CV"],
    label: "CVH Time-Independent Volume",
    category: "CVH Control Volume",
    archetypeId: MelcorArchetypeId.CVH_TMDP,
    description: "Constant-state boundary control volume (containment / environment sink).",
    provenance: "Sandia MELCOR 2.2 Reference Manual, CVH Package",
    params: [
      ["pBnd", 101325.0, "Pa", "Boundary pressure"],
      ["tBnd", 300.0, "K", "Boundary temperature"],
    ],
  },
  {
    modelType: "FL_PATH",
    pkg: "FL",
    aliases: ["FL", "FL_ID", "FLOW_PATH"],
    label: "FL Hydrodynamic Flow Path",
    category: "FL Flow Path",
    archetypeId: MelcorArchetypeId.FL_PATH,
    description: "Inter-volume momentum flow path with form loss K and critical/unchoked orifice limit.",
    provenance: "Sandia MELCOR 2.2 Reference Manual, FL Package",
    params: [
      ["area", 0.1, "m^2", "Flow cross-sectional area"],
      ["length", 2.0, "m", "Inertial flow length"],
      ["kFwd", 1.5, "-", "Forward form loss coefficient"],
      ["kRev", 1.5, "-", "Reverse form loss coefficient"],
      ["cd", 0.85, "-", "Discharge coefficient"],
      ["openFrac", 1.0, "-", "Open area fraction"],
    ],
  },
  {
    modelType: "FL_VALVE",
    pkg: "FL",
    aliases: ["FL_VLV", "RUPTURE_DISK"],
    label: "FL Relief Valve / Rupture Disk",
    category: "FL Flow Path",
    archetypeId: MelcorArchetypeId.FL_VALVE,
    description: "Pressure-actuated relief valve or containment rupture disk flow path.",
    provenance: "Sandia MELCOR 2.2 Reference Manual, FL Package",
    params: [
      ["area", 0.05, "m^2", "Valve throat area"],
      ["kFwd", 2.0, "-", "Forward form loss coefficient"],
      ["pSet", 16.2e6, "Pa", "Opening setpoint pressure"],
      ["pFull", 16.7e6, "Pa", "Full-open pressure"],
      ["cd", 0.85, "-", "Discharge coefficient"],
    ],
  },
  {
    modelType: "HS_SLAB",
    pkg: "HS",
    aliases: ["HS", "HS_ID", "HEAT_STRUCTURE"],
    label: "HS 1D Heat Structure",
    category: "HS Heat Structure",
    archetypeId: MelcorArchetypeId.HS_SLAB,
    description: "Lumped/1D heat-conducting structure exchanging convective heat with left and right CVH volumes.",
    provenance: "Sandia MELCOR 2.2 Reference Manual, HS Package",
    params: [
      ["mass", 5000.0, "kg", "Structure mass"],
      ["cp", 500.0, "J/(kg*K)", "Specific heat capacity"],
      ["area", 50.0, "m^2", "Heat transfer surface area"],
      ["htcLeft", 500.0, "W/(m^2*K)", "Left boundary HTC"],
      ["htcRight", 50.0, "W/(m^2*K)", "Right boundary HTC"],
      ["t0", 560.0, "K", "Initial structure temperature"],
    ],
  },
  {
    modelType: "COR_CELL",
    pkg: "COR",
    aliases: ["COR", "COR_RP", "COR_ZDF"],
    label: "COR Core Thermal Cell",
    category: "COR Core & Oxidation",
    archetypeId: MelcorArchetypeId.COR_CELL,
    description: "PWR/BWR core fuel + Zircaloy cladding cell with decay heat and exothermic oxidation coupling.",
    provenance: "Sandia MELCOR 2.2 Reference Manual, COR Package",
    params: [
      ["mass", 80000.0, "kg", "Total core cell mass"],
      ["cp", 350.0, "J/(kg*K)", "Effective core specific heat"],
      ["qDecay", 3.0e7, "W", "Decay heat thermal power"],
      ["t0", 600.0, "K", "Initial core temperature"],
      ["htcCool", 0.0, "W/(m^2*K)", "Coolant heat transfer coefficient"],
      ["areaCool", 1000.0, "m^2", "Cladding surface area"],
    ],
  },
  {
    modelType: "COR_OX_UH",
    pkg: "COR",
    aliases: ["URBANIC_HEIDRICK", "ZR_OXIDATION"],
    label: "COR Urbanic-Heidrick Zr Oxidation",
    category: "COR Core & Oxidation",
    archetypeId: MelcorArchetypeId.COR_OX_UH,
    description: "Parabolic Zircaloy-4/steam oxidation kinetics (Urbanic-Heidrick 1978) with H2 and heat generation.",
    provenance: "Urbanic & Heidrick (1978), J. Nucl. Mater. 75, 251-261; MELCOR COR Package",
    params: [
      ["aLow", 29.6, "kg^2/(m^4*s)", "Low-T (<1853 K) parabolic pre-exponential"],
      ["eLow", 16820.0, "K", "Low-T activation temperature Ea/R"],
      ["aHigh", 87.9, "kg^2/(m^4*s)", "High-T (>=1853 K) parabolic pre-exponential"],
      ["eHigh", 16610.0, "K", "High-T activation temperature Ea/R"],
      ["cladArea", 4500.0, "m^2", "Active Zircaloy cladding surface area"],
      ["deltaH", 6.45e6, "J/kg", "Exothermic heat of Zr oxidation"],
    ],
  },
  {
    modelType: "COR_DECAY_ANS",
    pkg: "COR",
    aliases: ["DCH", "ANS79_DECAY"],
    label: "COR ANS-5.1 Decay Heat",
    category: "COR Core & Oxidation",
    archetypeId: MelcorArchetypeId.COR_DECAY_ANS,
    description: "ANSI/ANS-5.1-1979 fission product decay heat power curve after reactor SCRAM.",
    provenance: "ANSI/ANS-5.1-1979; MELCOR DCH Package",
    params: [
      ["pRated", 3.0e9, "W", "Pre-scram rated thermal power"],
      ["tOp", 3.1536e7, "s", "Prior full-power irradiation duration"],
      ["mult", 1.0, "-", "Decay heat multiplier"],
    ],
  },
  {
    modelType: "RN1_AEROSOL",
    pkg: "RN1",
    aliases: ["RN1", "RN1_CLS", "CORSOR"],
    label: "RN1 Fission Product Aerosol",
    category: "RN1 Radionuclide",
    archetypeId: MelcorArchetypeId.RN1_AEROSOL,
    description:
      "CORSOR-M Arrhenius fission-product release and first-order containment aerosol gravitational settling.",
    provenance: "Sandia MELCOR 2.2 Reference Manual, RN1 Package",
    params: [
      ["mInit", 100.0, "kg", "Initial radionuclide class inventory"],
      ["kRelease", 1.0e-4, "1/s", "Release rate constant"],
      ["kSettle", 5.0e-5, "1/s", "Gravitational settling rate constant"],
    ],
  },
  {
    modelType: "CF_FUNC",
    pkg: "CF",
    aliases: ["CF", "CF_ID", "CONTROL_FUNCTION"],
    label: "CF Control Function",
    category: "CF/TF Control & Table",
    archetypeId: MelcorArchetypeId.CF_FUNC,
    description: "Linear combination / scaling control function y = scale * (a*x1 + b*x2) + add.",
    provenance: "Sandia MELCOR 2.2 Reference Manual, CF Package",
    params: [
      ["scale", 1.0, "-", "Output scale factor"],
      ["add", 0.0, "-", "Additive offset"],
      ["w1", 1.0, "-", "Weight for argument 1"],
      ["w2", 0.0, "-", "Weight for argument 2"],
    ],
  },
  {
    modelType: "TF_TABLE",
    pkg: "TF",
    aliases: ["TF", "TF_ID", "TABULAR_FUNCTION"],
    label: "TF Tabular Function",
    category: "CF/TF Control & Table",
    archetypeId: MelcorArchetypeId.TF_TABLE,
    description: "Piecewise-linear tabular function y(x) = scale * interp(x) + add.",
    provenance: "Sandia MELCOR 2.2 Reference Manual, TF Package",
    params: [
      ["scale", 1.0, "-", "Output scale factor"],
      ["add", 0.0, "-", "Additive offset"],
      ["x0", 0.0, "-", "Table point 0 abscissa"],
      ["y0", 0.0, "-", "Table point 0 ordinate"],
      ["x1", 100.0, "-", "Table point 1 abscissa"],
      ["y1", 1.0, "-", "Table point 1 ordinate"],
    ],
  },
  // Severe-accident solid material properties (MP)
  {
    modelType: "MP_UO2",
    pkg: "MP",
    aliases: ["UO2", "URANIUM_DIOXIDE"],
    label: "MP UO2 Nuclear Fuel",
    category: "MP Material Property",
    archetypeId: MelcorArchetypeId.MP_UO2,
    description: "PWR/BWR sintered UO2 fuel thermophysical properties (MATPRO / MELCOR MP default).",
    provenance: "NUREG/CR-6150 (MATPRO) & Sandia MELCOR MP Package",
    params: [
      ["rho", 10960.0, "kg/m^3", "Theoretical density at 300 K"],
      ["cp", 300.0, "J/(kg*K)", "Nominal specific heat"],
      ["k", 3.6, "W/(m*K)", "Thermal conductivity at 1000 K"],
      ["tMelt", 3113.0, "K", "Melting temperature"],
      ["hFusion", 2.74e5, "J/kg", "Latent heat of fusion"],
    ],
  },
  {
    modelType: "MP_ZIRCALOY4",
    pkg: "MP",
    aliases: ["ZIRCALOY4", "ZIRCALOY-4", "ZR4", "ZR"],
    label: "MP Zircaloy-4 Cladding",
    category: "MP Material Property",
    archetypeId: MelcorArchetypeId.MP_ZIRCALOY4,
    description: "PWR/BWR Zircaloy-4 fuel cladding thermophysical properties.",
    provenance: "NUREG/CR-6150 (MATPRO) & Sandia MELCOR MP Package",
    params: [
      ["rho", 6560.0, "kg/m^3", "Density at 300 K"],
      ["cp", 330.0, "J/(kg*K)", "Specific heat capacity"],
      ["k", 18.0, "W/(m*K)", "Thermal conductivity at 800 K"],
      ["tMelt", 2098.0, "K", "Melting temperature"],
      ["hFusion", 2.25e5, "J/kg", "Latent heat of fusion"],
    ],
  },
  {
    modelType: "MP_SS304",
    pkg: "MP",
    aliases: ["SS304", "STAINLESS_STEEL", "SS"],
    label: "MP Stainless Steel 304",
    category: "MP Material Property",
    archetypeId: MelcorArchetypeId.MP_SS304,
    description: "Reactor vessel & core-support AISI 304 stainless steel properties.",
    provenance: "Sandia MELCOR MP Package Default Material Library",
    params: [
      ["rho", 7930.0, "kg/m^3", "Density"],
      ["cp", 530.0, "J/(kg*K)", "Specific heat capacity"],
      ["k", 21.5, "W/(m*K)", "Thermal conductivity at 800 K"],
      ["tMelt", 1700.0, "K", "Melting temperature"],
      ["hFusion", 2.68e5, "J/kg", "Latent heat of fusion"],
    ],
  },
  // Severe-accident gas properties (NCG / H2O)
  {
    modelType: "NCG_H2",
    pkg: "NCG",
    aliases: ["H2", "HYDROGEN"],
    label: "NCG Hydrogen (H2)",
    category: "NCG Gas Property",
    archetypeId: MelcorArchetypeId.NCG_H2,
    description: "Hydrogen gas properties for cladding oxidation & containment flammability analysis.",
    provenance: "Sandia MELCOR NCG Package",
    params: [
      ["molarMass", 2.01588, "g/mol", "Molecular weight"],
      ["rSpec", 4124.2, "J/(kg*K)", "Specific gas constant"],
      ["cp", 14307.0, "J/(kg*K)", "Isobaric specific heat at 300 K"],
      ["gamma", 1.405, "-", "Heat capacity ratio cp/cv"],
    ],
  },
  {
    modelType: "NCG_N2",
    pkg: "NCG",
    aliases: ["N2", "NITROGEN"],
    label: "NCG Nitrogen (N2)",
    category: "NCG Gas Property",
    archetypeId: MelcorArchetypeId.NCG_N2,
    description: "Nitrogen non-condensable gas properties for BWR inerted containment & PWR accumulators.",
    provenance: "Sandia MELCOR NCG Package",
    params: [
      ["molarMass", 28.0134, "g/mol", "Molecular weight"],
      ["rSpec", 296.8, "J/(kg*K)", "Specific gas constant"],
      ["cp", 1040.0, "J/(kg*K)", "Isobaric specific heat at 300 K"],
      ["gamma", 1.4, "-", "Heat capacity ratio cp/cv"],
    ],
  },
  {
    modelType: "NCG_H2O",
    pkg: "NCG",
    aliases: ["H2O", "STEAM", "WATER"],
    label: "NCG Steam / Water (H2O)",
    category: "NCG Gas Property",
    archetypeId: MelcorArchetypeId.NCG_H2O,
    description: "Water vapor / coolant properties for primary system & containment thermal-hydraulics.",
    provenance: "IAPWS-IF97 & Sandia MELCOR H2O Package",
    params: [
      ["molarMass", 18.01528, "g/mol", "Molecular weight"],
      ["rSpec", 461.52, "J/(kg*K)", "Specific gas constant"],
      ["cp", 2080.0, "J/(kg*K)", "Superheated steam specific heat"],
      ["gamma", 1.33, "-", "Steam heat capacity ratio"],
    ],
  },
];

export function buildMelcorCleanroomSchemas(): CleanroomModelSchema[] {
  return MELCOR_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real" as const,
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `melcor.${spec.pkg}.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "nuclear-severe-accident",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "class",
      width: 92,
      height: 48,
      svg: generateMelcorBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: "melModelEvalDerivatives",
      extra: {
        archetypeId: spec.archetypeId,
        melcorPackage: spec.pkg,
      },
    };
  });
}
