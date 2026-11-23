// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * SCALE cleanroom composition & nuclide decay-chain archetype IDs matching
 * `assets/scale-std-lib/src/models.ts`.
 */
export const ScaleArchetypeId = {
  // Standard Compositions (1..9)
  COMP_UO2: 1,
  COMP_H2O: 2,
  COMP_SS304: 3,
  COMP_ZIRC4: 4,
  COMP_B4C: 5,
  COMP_MOX: 6,

  // Actinide & Fission-Product Decay Chains (10..19)
  NUCLIDE_U235: 10,
  NUCLIDE_U238: 11,
  NUCLIDE_PU239: 12,
  NUCLIDE_XE135: 13,
  NUCLIDE_I135: 14,
  NUCLIDE_CS137: 15,
  NUCLIDE_SR90: 16,
  NUCLIDE_CS135: 17,
} as const;

export type ScaleArchetypeId = (typeof ScaleArchetypeId)[keyof typeof ScaleArchetypeId];

export type ScaleModelCategory = "Standard Composition" | "Actinide Nuclide" | "Fission Product";

export interface ScaleNuclideRecord {
  id: string;
  zaid: number;
  atomicMass: number;
  halfLifeSec: number;
  decayConstant: number;
  /** Thermal neutron absorption cross-section in barns (1 b = 1e-24 cm^2) */
  sigmaAbsorptionBarns: number;
  /** Thermal neutron fission cross-section in barns */
  sigmaFissionBarns: number;
  /** Thermal neutron capture cross-section in barns */
  sigmaCaptureBarns: number;
  /** Average recoverable decay heat per disintegration in MeV */
  decayEnergyMeV: number;
  /** Primary decay daughter nuclide ID (if radioactive) */
  decayDaughter?: string | undefined;
  /** Primary capture product nuclide ID */
  captureProduct?: string | undefined;
  /** Direct thermal fission yield from U-235 */
  u235FissionYield?: number | undefined;
}

const LN2 = Math.LN2;
const BARN_TO_CM2 = 1e-24;
export { BARN_TO_CM2 };

export const SCALE_NUCLIDE_DATA: Readonly<Record<string, ScaleNuclideRecord>> = {
  "U-235": {
    id: "U-235",
    zaid: 92235,
    atomicMass: 235.0439,
    halfLifeSec: 7.038e8 * 365.25 * 86400,
    decayConstant: LN2 / (7.038e8 * 365.25 * 86400),
    sigmaAbsorptionBarns: 683.7,
    sigmaFissionBarns: 585.0,
    sigmaCaptureBarns: 98.7,
    decayEnergyMeV: 4.68,
    captureProduct: "U-236",
  },
  "U-236": {
    id: "U-236",
    zaid: 92236,
    atomicMass: 236.0456,
    halfLifeSec: 2.342e7 * 365.25 * 86400,
    decayConstant: LN2 / (2.342e7 * 365.25 * 86400),
    sigmaAbsorptionBarns: 5.1,
    sigmaFissionBarns: 0.0,
    sigmaCaptureBarns: 5.1,
    decayEnergyMeV: 4.57,
  },
  "U-238": {
    id: "U-238",
    zaid: 92238,
    atomicMass: 238.0508,
    halfLifeSec: 4.468e9 * 365.25 * 86400,
    decayConstant: LN2 / (4.468e9 * 365.25 * 86400),
    sigmaAbsorptionBarns: 2.68,
    sigmaFissionBarns: 0.0,
    sigmaCaptureBarns: 2.68,
    decayEnergyMeV: 4.27,
    captureProduct: "Pu-239",
  },
  "Pu-239": {
    id: "Pu-239",
    zaid: 94239,
    atomicMass: 239.0522,
    halfLifeSec: 2.411e4 * 365.25 * 86400,
    decayConstant: LN2 / (2.411e4 * 365.25 * 86400),
    sigmaAbsorptionBarns: 1017.7,
    sigmaFissionBarns: 747.4,
    sigmaCaptureBarns: 270.3,
    decayEnergyMeV: 5.24,
  },
  "I-135": {
    id: "I-135",
    zaid: 53135,
    atomicMass: 134.9101,
    halfLifeSec: 6.57 * 3600,
    decayConstant: LN2 / (6.57 * 3600),
    sigmaAbsorptionBarns: 0.02,
    sigmaFissionBarns: 0.0,
    sigmaCaptureBarns: 0.02,
    decayEnergyMeV: 1.16,
    decayDaughter: "Xe-135",
    u235FissionYield: 0.0639,
  },
  "Xe-135": {
    id: "Xe-135",
    zaid: 54135,
    atomicMass: 134.9072,
    halfLifeSec: 9.14 * 3600,
    decayConstant: LN2 / (9.14 * 3600),
    sigmaAbsorptionBarns: 2.65e6,
    sigmaFissionBarns: 0.0,
    sigmaCaptureBarns: 2.65e6,
    decayEnergyMeV: 0.56,
    decayDaughter: "Cs-135",
    u235FissionYield: 0.00254,
  },
  "Cs-135": {
    id: "Cs-135",
    zaid: 55135,
    atomicMass: 134.906,
    halfLifeSec: 2.3e6 * 365.25 * 86400,
    decayConstant: LN2 / (2.3e6 * 365.25 * 86400),
    sigmaAbsorptionBarns: 8.7,
    sigmaFissionBarns: 0.0,
    sigmaCaptureBarns: 8.7,
    decayEnergyMeV: 0.067,
  },
  "Cs-137": {
    id: "Cs-137",
    zaid: 55137,
    atomicMass: 136.9071,
    halfLifeSec: 30.17 * 365.25 * 86400,
    decayConstant: LN2 / (30.17 * 365.25 * 86400),
    sigmaAbsorptionBarns: 0.25,
    sigmaFissionBarns: 0.0,
    sigmaCaptureBarns: 0.25,
    decayEnergyMeV: 0.78,
    u235FissionYield: 0.0619,
  },
  "Sr-90": {
    id: "Sr-90",
    zaid: 38090,
    atomicMass: 89.9077,
    halfLifeSec: 28.79 * 365.25 * 86400,
    decayConstant: LN2 / (28.79 * 365.25 * 86400),
    sigmaAbsorptionBarns: 0.015,
    sigmaFissionBarns: 0.0,
    sigmaCaptureBarns: 0.015,
    decayEnergyMeV: 1.13,
    u235FissionYield: 0.0578,
  },
};

export interface ScaleStandardComposition {
  name: string;
  defaultDensity: number;
  defaultTemperature: number;
  molecularWeight: number;
  formula: string;
  description: string;
}

export const SCALE_STANDARD_COMPOSITIONS: Readonly<Record<string, ScaleStandardComposition>> = {
  UO2: {
    name: "UO2",
    defaultDensity: 10.96,
    defaultTemperature: 900.0,
    molecularWeight: 270.03,
    formula: "UO2",
    description: "Uranium dioxide nuclear fuel pellet (theoretical density 10.96 g/cm³).",
  },
  H2O: {
    name: "H2O",
    defaultDensity: 0.9982,
    defaultTemperature: 293.6,
    molecularWeight: 18.015,
    formula: "H2O",
    description: "Light water moderator and coolant.",
  },
  SS304: {
    name: "SS304",
    defaultDensity: 7.94,
    defaultTemperature: 300.0,
    molecularWeight: 55.3,
    formula: "Fe-Cr19-Ni10-Mn2",
    description: "AISI 304 austenitic stainless steel structural alloy.",
  },
  ZIRC4: {
    name: "ZIRC4",
    defaultDensity: 6.56,
    defaultTemperature: 600.0,
    molecularWeight: 91.22,
    formula: "Zr-Sn1.45-Fe0.21-Cr0.1",
    description: "Zircaloy-4 PWR fuel cladding alloy.",
  },
  B4C: {
    name: "B4C",
    defaultDensity: 2.52,
    defaultTemperature: 300.0,
    molecularWeight: 55.255,
    formula: "B4C",
    description: "Boron carbide neutron absorber control rod material.",
  },
  MOX: {
    name: "MOX",
    defaultDensity: 10.45,
    defaultTemperature: 900.0,
    molecularWeight: 270.4,
    formula: "(U,Pu)O2",
    description: "Mixed oxide (UO2/PuO2) reactor fuel.",
  },
};

export interface ScaleModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: ScaleModelCategory;
  archetypeId: ScaleArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<ScaleModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Standard Composition": { fill: "#172554", stroke: "#60a5fa", badge: "MAT" },
  "Actinide Nuclide": { fill: "#450a0a", stroke: "#f87171", badge: "ACT" },
  "Fission Product": { fill: "#3b0764", stroke: "#c084fc", badge: "FP" },
};

export function generateScaleBlockSvg(modelType: string, category: ScaleModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 48" width="88" height="48">` +
    `<rect x="2" y="2" width="84" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="34" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: ScaleModelCategory): DiagramPortSpec[] {
  if (category === "Standard Composition") {
    return [
      { name: "neutronFlux", kind: "neutronics", side: "left", dx: 0, dy: 24 },
      { name: "region", kind: "geometry", side: "right", dx: 88, dy: 24 },
    ];
  }
  return [
    { name: "parent", kind: "decay", side: "left", dx: 0, dy: 24 },
    { name: "daughter", kind: "decay", side: "right", dx: 88, dy: 24 },
  ];
}

export const SCALE_STD_MODEL_SPECS: ScaleModelSpec[] = [
  // Standard Compositions
  {
    modelType: "UO2",
    aliases: ["uo2", "uranium_dioxide"],
    label: "UO2 Fuel",
    category: "Standard Composition",
    archetypeId: ScaleArchetypeId.COMP_UO2,
    description: SCALE_STANDARD_COMPOSITIONS["UO2"]!.description,
    provenance: "ORNL/TM-2005/39 SCALE Standard Composition Library",
    params: [
      ["density", 10.96, "g/cm^3", "Theoretical density of UO2"],
      ["temperature", 900.0, "K", "Nominal fuel operating temperature"],
      ["enrichment", 3.5, "wt%", "U-235 weight-percent enrichment"],
      ["molecularWeight", 270.03, "g/mol", "Molar mass"],
    ],
  },
  {
    modelType: "H2O",
    aliases: ["h2o", "water", "light_water"],
    label: "H2O Moderator",
    category: "Standard Composition",
    archetypeId: ScaleArchetypeId.COMP_H2O,
    description: SCALE_STANDARD_COMPOSITIONS["H2O"]!.description,
    provenance: "ORNL/TM-2005/39 SCALE Standard Composition Library",
    params: [
      ["density", 0.9982, "g/cm^3", "Density at 293.6 K"],
      ["temperature", 293.6, "K", "Reference temperature"],
      ["molecularWeight", 18.015, "g/mol", "Molar mass"],
    ],
  },
  {
    modelType: "SS304",
    aliases: ["ss304", "stainless_steel_304"],
    label: "SS304 Steel",
    category: "Standard Composition",
    archetypeId: ScaleArchetypeId.COMP_SS304,
    description: SCALE_STANDARD_COMPOSITIONS["SS304"]!.description,
    provenance: "ORNL/TM-2005/39 SCALE Standard Composition Library",
    params: [
      ["density", 7.94, "g/cm^3", "Nominal stainless steel density"],
      ["temperature", 300.0, "K", "Reference temperature"],
      ["molecularWeight", 55.3, "g/mol", "Effective molar mass"],
    ],
  },
  {
    modelType: "ZIRC4",
    aliases: ["zirc4", "zircaloy-4", "zircaloy4"],
    label: "Zircaloy-4",
    category: "Standard Composition",
    archetypeId: ScaleArchetypeId.COMP_ZIRC4,
    description: SCALE_STANDARD_COMPOSITIONS["ZIRC4"]!.description,
    provenance: "ORNL/TM-2005/39 SCALE Standard Composition Library",
    params: [
      ["density", 6.56, "g/cm^3", "Cladding density"],
      ["temperature", 600.0, "K", "Nominal cladding temperature"],
      ["molecularWeight", 91.22, "g/mol", "Effective molar mass"],
    ],
  },
  {
    modelType: "B4C",
    aliases: ["b4c", "boron_carbide"],
    label: "B4C Absorber",
    category: "Standard Composition",
    archetypeId: ScaleArchetypeId.COMP_B4C,
    description: SCALE_STANDARD_COMPOSITIONS["B4C"]!.description,
    provenance: "ORNL/TM-2005/39 SCALE Standard Composition Library",
    params: [
      ["density", 2.52, "g/cm^3", "Absorber pellet density"],
      ["temperature", 300.0, "K", "Reference temperature"],
      ["molecularWeight", 55.255, "g/mol", "Molar mass"],
    ],
  },
  {
    modelType: "MOX",
    aliases: ["mox", "mixed_oxide"],
    label: "MOX Fuel",
    category: "Standard Composition",
    archetypeId: ScaleArchetypeId.COMP_MOX,
    description: SCALE_STANDARD_COMPOSITIONS["MOX"]!.description,
    provenance: "ORNL/TM-2005/39 SCALE Standard Composition Library",
    params: [
      ["density", 10.45, "g/cm^3", "Nominal MOX density"],
      ["temperature", 900.0, "K", "Nominal fuel temperature"],
      ["puWeightPercent", 5.0, "wt%", "Plutonium weight fraction"],
      ["molecularWeight", 270.4, "g/mol", "Molar mass"],
    ],
  },

  // Actinides & Fission Products
  {
    modelType: "U-235",
    aliases: ["u235", "u-235", "92235"],
    label: "U-235",
    category: "Actinide Nuclide",
    archetypeId: ScaleArchetypeId.NUCLIDE_U235,
    description: "Fissile uranium-235 actinide nuclide (sigma_f=585 b, sigma_a=683.7 b).",
    provenance: "ENDF/B-VIII.0 / ORIGEN-S Nuclear Data Library",
    params: [
      ["decayConstant", SCALE_NUCLIDE_DATA["U-235"]!.decayConstant, "1/s", "Radioactive decay constant"],
      ["sigmaAbsorption", 683.7, "barns", "Thermal neutron absorption cross-section"],
      ["sigmaFission", 585.0, "barns", "Thermal neutron fission cross-section"],
      ["decayEnergyMeV", 4.68, "MeV", "Recoverable decay energy per disintegration"],
    ],
  },
  {
    modelType: "U-238",
    aliases: ["u238", "u-238", "92238"],
    label: "U-238",
    category: "Actinide Nuclide",
    archetypeId: ScaleArchetypeId.NUCLIDE_U238,
    description: "Fertile uranium-238 actinide nuclide capturing neutrons to breed Pu-239.",
    provenance: "ENDF/B-VIII.0 / ORIGEN-S Nuclear Data Library",
    params: [
      ["decayConstant", SCALE_NUCLIDE_DATA["U-238"]!.decayConstant, "1/s", "Radioactive decay constant"],
      ["sigmaAbsorption", 2.68, "barns", "Thermal neutron capture cross-section"],
      ["sigmaFission", 0.0, "barns", "Thermal fission cross-section"],
      ["decayEnergyMeV", 4.27, "MeV", "Recoverable decay energy per disintegration"],
    ],
  },
  {
    modelType: "Pu-239",
    aliases: ["pu239", "pu-239", "94239"],
    label: "Pu-239",
    category: "Actinide Nuclide",
    archetypeId: ScaleArchetypeId.NUCLIDE_PU239,
    description: "Fissile plutonium-239 bred from U-238 neutron capture (sigma_f=747.4 b).",
    provenance: "ENDF/B-VIII.0 / ORIGEN-S Nuclear Data Library",
    params: [
      ["decayConstant", SCALE_NUCLIDE_DATA["Pu-239"]!.decayConstant, "1/s", "Radioactive decay constant"],
      ["sigmaAbsorption", 1017.7, "barns", "Thermal neutron absorption cross-section"],
      ["sigmaFission", 747.4, "barns", "Thermal neutron fission cross-section"],
      ["decayEnergyMeV", 5.24, "MeV", "Recoverable decay energy per disintegration"],
    ],
  },
  {
    modelType: "I-135",
    aliases: ["i135", "i-135", "53135"],
    label: "I-135",
    category: "Fission Product",
    archetypeId: ScaleArchetypeId.NUCLIDE_I135,
    description: "Iodine-135 fission product precursor to Xe-135 (T1/2 = 6.57 h).",
    provenance: "ENDF/B-VIII.0 / ORIGEN-S Nuclear Data Library",
    params: [
      ["decayConstant", SCALE_NUCLIDE_DATA["I-135"]!.decayConstant, "1/s", "Beta decay constant to Xe-135"],
      ["sigmaAbsorption", 0.02, "barns", "Thermal absorption cross-section"],
      ["u235FissionYield", 0.0639, "-", "Direct thermal fission yield from U-235"],
      ["decayEnergyMeV", 1.16, "MeV", "Recoverable beta/gamma decay energy"],
    ],
  },
  {
    modelType: "Xe-135",
    aliases: ["xe135", "xe-135", "54135"],
    label: "Xe-135",
    category: "Fission Product",
    archetypeId: ScaleArchetypeId.NUCLIDE_XE135,
    description: "Xenon-135 strong thermal neutron poison (T1/2 = 9.14 h, sigma_a = 2.65e6 b).",
    provenance: "ENDF/B-VIII.0 / ORIGEN-S Nuclear Data Library",
    params: [
      ["decayConstant", SCALE_NUCLIDE_DATA["Xe-135"]!.decayConstant, "1/s", "Beta decay constant to Cs-135"],
      ["sigmaAbsorption", 2.65e6, "barns", "Thermal neutron absorption cross-section"],
      ["u235FissionYield", 0.00254, "-", "Direct thermal fission yield from U-235"],
      ["decayEnergyMeV", 0.56, "MeV", "Recoverable beta/gamma decay energy"],
    ],
  },
  {
    modelType: "Cs-137",
    aliases: ["cs137", "cs-137", "55137"],
    label: "Cs-137",
    category: "Fission Product",
    archetypeId: ScaleArchetypeId.NUCLIDE_CS137,
    description: "Cesium-137 long-lived fission product (T1/2 = 30.17 yr).",
    provenance: "ENDF/B-VIII.0 / ORIGEN-S Nuclear Data Library",
    params: [
      ["decayConstant", SCALE_NUCLIDE_DATA["Cs-137"]!.decayConstant, "1/s", "Beta decay constant"],
      ["sigmaAbsorption", 0.25, "barns", "Thermal absorption cross-section"],
      ["u235FissionYield", 0.0619, "-", "Cumulative thermal fission yield from U-235"],
      ["decayEnergyMeV", 0.78, "MeV", "Recoverable decay energy (incl. Ba-137m)"],
    ],
  },
  {
    modelType: "Sr-90",
    aliases: ["sr90", "sr-90", "38090"],
    label: "Sr-90",
    category: "Fission Product",
    archetypeId: ScaleArchetypeId.NUCLIDE_SR90,
    description: "Strontium-90 long-lived fission product (T1/2 = 28.79 yr).",
    provenance: "ENDF/B-VIII.0 / ORIGEN-S Nuclear Data Library",
    params: [
      ["decayConstant", SCALE_NUCLIDE_DATA["Sr-90"]!.decayConstant, "1/s", "Beta decay constant"],
      ["sigmaAbsorption", 0.015, "barns", "Thermal absorption cross-section"],
      ["u235FissionYield", 0.0578, "-", "Cumulative thermal fission yield from U-235"],
      ["decayEnergyMeV", 1.13, "MeV", "Recoverable decay energy (incl. Y-90)"],
    ],
  },
];

/**
 * Normalizes a nuclide string (e.g. "u235", "u-235", "92235", "XE135") to canonical form ("U-235", "Xe-135").
 */
export function normalizeNuclideId(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const zaid = Number.parseInt(trimmed, 10);
    for (const rec of Object.values(SCALE_NUCLIDE_DATA)) {
      if (rec.zaid === zaid) return rec.id;
    }
    return trimmed;
  }
  const m = /^([a-zA-Z]{1,2})-?(\d{1,3}[mM]?)$/.exec(trimmed);
  if (m) {
    const elem = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
    return `${elem}-${m[2]!.toLowerCase()}`;
  }
  return trimmed;
}

export function buildScaleCleanroomSchemas(): CleanroomModelSchema[] {
  return SCALE_STD_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => {
      const p: CleanroomParameterSchema = { key, type: "real", defaultValue };
      if (unit !== undefined) p.unit = unit;
      if (description !== undefined) p.description = description;
      return p;
    });

    return {
      namePath: `SCALE.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "nuclear-criticality",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: spec.category === "Standard Composition" ? "material" : "nuclide",
      width: 88,
      height: 48,
      svg: generateScaleBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: "scaleBatemanStep",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
