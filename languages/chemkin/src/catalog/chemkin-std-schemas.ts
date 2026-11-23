// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";
import type { Nasa7Coeffs, Nasa7ThermoRecord } from "../types.js";

/**
 * Cleanroom IUPAC standard atomic weights [g/mol] for common CHEMKIN elements.
 */
export const CHEMKIN_ELEMENT_ATOMIC_WEIGHTS: Record<string, number> = {
  H: 1.00794,
  HE: 4.002602,
  C: 12.0107,
  N: 14.0067,
  O: 15.9994,
  F: 18.9984032,
  NE: 20.1797,
  NA: 22.989769,
  SI: 28.0855,
  P: 30.973762,
  S: 32.065,
  CL: 35.453,
  AR: 39.948,
  K: 39.0983,
  FE: 55.845,
};

/**
 * CHEMKIN cleanroom standard library archetype IDs matching `assets/chemkin-std-lib/src/models.ts`.
 */
export const ChemkinArchetypeId = {
  SPECIES_H2: 1,
  SPECIES_O2: 2,
  SPECIES_H2O: 3,
  SPECIES_OH: 4,
  SPECIES_H: 5,
  SPECIES_O: 6,
  SPECIES_HO2: 7,
  SPECIES_H2O2: 8,
  SPECIES_CH4: 9,
  SPECIES_CO: 10,
  SPECIES_CO2: 11,
  SPECIES_N2: 12,
  REACTION_ARRHENIUS: 20,
  REACTION_TROE: 21,
} as const;

export type ChemkinArchetypeId = (typeof ChemkinArchetypeId)[keyof typeof ChemkinArchetypeId];

export interface ChemkinStdSpeciesSpec {
  species: string;
  label: string;
  archetypeId: ChemkinArchetypeId;
  category: "Fuel" | "Oxidizer" | "Product" | "Radical" | "Inert";
  description: string;
  provenance: string;
  thermo: Nasa7ThermoRecord;
}

/**
 * Cleanroom NASA-7 14-coefficient thermodynamic database (public NASA Glenn / Burcat /
 * McBride-Gordon-Reno SP-3027 polynomials) for the H2/O2/CH4 combustion system.
 */
export const CHEMKIN_STD_SPECIES: ChemkinStdSpeciesSpec[] = [
  {
    species: "H2",
    label: "Molecular Hydrogen (H2)",
    archetypeId: ChemkinArchetypeId.SPECIES_H2,
    category: "Fuel",
    description: "Diatomic hydrogen fuel gas; NASA-7 14-coefficient ideal gas polynomial.",
    provenance: "NASA Glenn / McBride-Gordon-Reno SP-3027",
    thermo: {
      species: "H2",
      phase: "G",
      composition: { H: 2 },
      tLow: 200.0,
      tMid: 1000.0,
      tHigh: 3500.0,
      highCoeffs: [
        3.3372792, -4.94024731e-5, 4.99456778e-7, -1.79566394e-10, 2.00255376e-14, -9.50158922e2, -3.20502331,
      ],
      lowCoeffs: [
        2.34433112, 7.98052075e-3, -1.9478151e-5, 2.01572094e-8, -7.37611761e-12, -9.17935173e2, 6.83010238e-1,
      ],
    },
  },
  {
    species: "O2",
    label: "Molecular Oxygen (O2)",
    archetypeId: ChemkinArchetypeId.SPECIES_O2,
    category: "Oxidizer",
    description: "Diatomic oxygen oxidizer gas; NASA-7 14-coefficient ideal gas polynomial.",
    provenance: "NASA Glenn / McBride-Gordon-Reno SP-3027",
    thermo: {
      species: "O2",
      phase: "G",
      composition: { O: 2 },
      tLow: 200.0,
      tMid: 1000.0,
      tHigh: 3500.0,
      highCoeffs: [
        3.28253784, 1.48308754e-3, -7.57966669e-7, 2.09470555e-10, -2.16717794e-14, -1.08845772e3, 5.45323129,
      ],
      lowCoeffs: [3.78245636, -2.99673416e-3, 9.84730201e-6, -9.68129509e-9, 3.24372837e-12, -1.06394356e3, 3.65767573],
    },
  },
  {
    species: "H2O",
    label: "Water Vapor (H2O)",
    archetypeId: ChemkinArchetypeId.SPECIES_H2O,
    category: "Product",
    description: "Steam / water vapor combustion product; NASA-7 14-coefficient ideal gas polynomial.",
    provenance: "NASA Glenn / McBride-Gordon-Reno SP-3027",
    thermo: {
      species: "H2O",
      phase: "G",
      composition: { H: 2, O: 1 },
      tLow: 200.0,
      tMid: 1000.0,
      tHigh: 3500.0,
      highCoeffs: [3.03399249, 2.17691804e-3, -1.64072518e-7, -9.7041987e-11, 1.68200992e-14, -3.00042971e4, 4.9667701],
      lowCoeffs: [
        4.19864056, -2.0364341e-3, 6.52040211e-6, -5.48797062e-9, 1.77197817e-12, -3.02937267e4, -8.49032208e-1,
      ],
    },
  },
  {
    species: "OH",
    label: "Hydroxyl Radical (OH)",
    archetypeId: ChemkinArchetypeId.SPECIES_OH,
    category: "Radical",
    description: "Hydroxyl chain-branching radical; NASA-7 14-coefficient ideal gas polynomial.",
    provenance: "NASA Glenn / McBride-Gordon-Reno SP-3027",
    thermo: {
      species: "OH",
      phase: "G",
      composition: { O: 1, H: 1 },
      tLow: 200.0,
      tMid: 1000.0,
      tHigh: 3500.0,
      highCoeffs: [3.09288767, 5.48429716e-4, 1.26505228e-7, -8.79461556e-11, 1.17412376e-14, 3.858657e3, 4.4766961],
      lowCoeffs: [
        3.99201543, -2.40131752e-3, 4.61793841e-6, -3.88113333e-9, 1.3641147e-12, 3.61508056e3, -1.03925458e-1,
      ],
    },
  },
  {
    species: "H",
    label: "Atomic Hydrogen (H)",
    archetypeId: ChemkinArchetypeId.SPECIES_H,
    category: "Radical",
    description: "Monatomic hydrogen radical; NASA-7 14-coefficient ideal gas polynomial.",
    provenance: "NASA Glenn / McBride-Gordon-Reno SP-3027",
    thermo: {
      species: "H",
      phase: "G",
      composition: { H: 1 },
      tLow: 200.0,
      tMid: 1000.0,
      tHigh: 3500.0,
      highCoeffs: [2.5, 7.05332819e-13, -1.99591964e-15, 2.30081632e-18, -9.27732332e-22, 2.54736599e4, -4.46682853e-1],
      lowCoeffs: [2.5, 7.05332819e-13, -1.99591964e-15, 2.30081632e-18, -9.27732332e-22, 2.54736599e4, -4.46682853e-1],
    },
  },
  {
    species: "O",
    label: "Atomic Oxygen (O)",
    archetypeId: ChemkinArchetypeId.SPECIES_O,
    category: "Radical",
    description: "Monatomic oxygen radical; NASA-7 14-coefficient ideal gas polynomial.",
    provenance: "NASA Glenn / McBride-Gordon-Reno SP-3027",
    thermo: {
      species: "O",
      phase: "G",
      composition: { O: 1 },
      tLow: 200.0,
      tMid: 1000.0,
      tHigh: 3500.0,
      highCoeffs: [
        2.56942078, -8.59741137e-5, 4.19484589e-8, -1.00177799e-11, 1.22833691e-15, 2.92175791e4, 4.78433864,
      ],
      lowCoeffs: [3.1682671, -3.27931884e-3, 6.64306396e-6, -6.12806624e-9, 2.11265971e-12, 2.91222592e4, 2.05193346],
    },
  },
  {
    species: "HO2",
    label: "Hydroperoxyl Radical (HO2)",
    archetypeId: ChemkinArchetypeId.SPECIES_HO2,
    category: "Radical",
    description: "Hydroperoxyl intermediate radical; NASA-7 14-coefficient ideal gas polynomial.",
    provenance: "NASA Glenn / McBride-Gordon-Reno SP-3027",
    thermo: {
      species: "HO2",
      phase: "G",
      composition: { H: 1, O: 2 },
      tLow: 200.0,
      tMid: 1000.0,
      tHigh: 3500.0,
      highCoeffs: [4.0172109, 2.21982017e-3, -5.77501838e-7, 7.13771705e-11, -3.68688512e-15, 1.11856713e2, 3.78510215],
      lowCoeffs: [4.30179801, -4.74912051e-3, 2.11582891e-5, -2.42763894e-8, 9.29225124e-12, 2.9480804e2, 3.71666245],
    },
  },
  {
    species: "H2O2",
    label: "Hydrogen Peroxide (H2O2)",
    archetypeId: ChemkinArchetypeId.SPECIES_H2O2,
    category: "Radical",
    description: "Hydrogen peroxide ignition intermediate; NASA-7 14-coefficient ideal gas polynomial.",
    provenance: "NASA Glenn / McBride-Gordon-Reno SP-3027",
    thermo: {
      species: "H2O2",
      phase: "G",
      composition: { H: 2, O: 2 },
      tLow: 200.0,
      tMid: 1000.0,
      tHigh: 3500.0,
      highCoeffs: [
        4.16500285, 4.90831694e-3, -1.90139225e-6, 3.71185986e-10, -2.87908305e-14, -1.78617877e4, 2.91615662,
      ],
      lowCoeffs: [4.27611269, -5.42822417e-4, 1.67335701e-5, -2.15770813e-8, 8.62454363e-12, -1.77025821e4, 3.43505074],
    },
  },
  {
    species: "CH4",
    label: "Methane (CH4)",
    archetypeId: ChemkinArchetypeId.SPECIES_CH4,
    category: "Fuel",
    description: "Methane hydrocarbon fuel gas; NASA-7 14-coefficient ideal gas polynomial.",
    provenance: "NASA Glenn / McBride-Gordon-Reno SP-3027",
    thermo: {
      species: "CH4",
      phase: "G",
      composition: { C: 1, H: 4 },
      tLow: 200.0,
      tMid: 1000.0,
      tHigh: 3500.0,
      highCoeffs: [
        7.4851495e-2, 1.33909467e-2, -5.73285809e-6, 1.22292535e-9, -1.0181523e-13, -9.46834459e3, 1.8437318e1,
      ],
      lowCoeffs: [
        5.14987613, -1.36709788e-2, 4.91800599e-5, -4.84743026e-8, 1.66693956e-11, -1.02466476e4, -4.64130376,
      ],
    },
  },
  {
    species: "CO",
    label: "Carbon Monoxide (CO)",
    archetypeId: ChemkinArchetypeId.SPECIES_CO,
    category: "Product",
    description: "Carbon monoxide intermediate / product; NASA-7 14-coefficient ideal gas polynomial.",
    provenance: "NASA Glenn / McBride-Gordon-Reno SP-3027",
    thermo: {
      species: "CO",
      phase: "G",
      composition: { C: 1, O: 1 },
      tLow: 200.0,
      tMid: 1000.0,
      tHigh: 3500.0,
      highCoeffs: [
        2.71518561, 2.06252743e-3, -9.98825771e-7, 2.30053008e-10, -2.03647716e-14, -1.41518724e4, 7.81868772,
      ],
      lowCoeffs: [3.57953347, -6.1035368e-4, 1.01681433e-6, 9.07005884e-10, -9.04424499e-13, -1.4344086e4, 3.50840928],
    },
  },
  {
    species: "CO2",
    label: "Carbon Dioxide (CO2)",
    archetypeId: ChemkinArchetypeId.SPECIES_CO2,
    category: "Product",
    description: "Carbon dioxide complete combustion product; NASA-7 14-coefficient ideal gas polynomial.",
    provenance: "NASA Glenn / McBride-Gordon-Reno SP-3027",
    thermo: {
      species: "CO2",
      phase: "G",
      composition: { C: 1, O: 2 },
      tLow: 200.0,
      tMid: 1000.0,
      tHigh: 3500.0,
      highCoeffs: [
        3.85746029, 4.41437026e-3, -2.21481404e-6, 5.23490188e-10, -4.72084164e-14, -4.8759166e4, 2.27163806,
      ],
      lowCoeffs: [2.35677352, 8.98459677e-3, -7.12356269e-6, 2.45919022e-9, -1.43699548e-13, -4.83719697e4, 9.90105222],
    },
  },
  {
    species: "N2",
    label: "Molecular Nitrogen (N2)",
    archetypeId: ChemkinArchetypeId.SPECIES_N2,
    category: "Inert",
    description: "Diatomic nitrogen bath/diluent gas; NASA-7 14-coefficient ideal gas polynomial.",
    provenance: "NASA Glenn / McBride-Gordon-Reno SP-3027",
    thermo: {
      species: "N2",
      phase: "G",
      composition: { N: 2 },
      tLow: 200.0,
      tMid: 1000.0,
      tHigh: 3500.0,
      highCoeffs: [2.92664, 1.4879768e-3, -5.6847608e-7, 1.0097038e-10, -6.753351e-15, -9.227977e2, 5.980528],
      lowCoeffs: [3.298677, 1.4082404e-3, -3.963222e-6, 5.641515e-9, -2.444854e-12, -1.0208999e3, 3.950372],
    },
  },
];

const CATEGORY_COLORS: Record<ChemkinStdSpeciesSpec["category"], { fill: string; stroke: string; badge: string }> = {
  Fuel: { fill: "#3b1d1d", stroke: "#f97316", badge: "FUEL" },
  Oxidizer: { fill: "#1e3a5f", stroke: "#38bdf8", badge: "OXID" },
  Product: { fill: "#1e3f2f", stroke: "#34d399", badge: "PROD" },
  Radical: { fill: "#3b1f47", stroke: "#e879f9", badge: "RAD" },
  Inert: { fill: "#27272a", stroke: "#a1a1aa", badge: "INRT" },
};

export function generateChemkinSpeciesSvg(species: string, category: ChemkinStdSpeciesSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="11" font-weight="bold" fill="#f8fafc">${species}</text>` +
    `</svg>`
  );
}

export function getStdThermoRecord(speciesName: string): Nasa7ThermoRecord | undefined {
  const upper = speciesName.trim().toUpperCase();
  const found = CHEMKIN_STD_SPECIES.find((s) => s.species.toUpperCase() === upper);
  return found?.thermo;
}

export function getElementAtomicWeight(symbol: string, customWeights?: Record<string, number>): number | undefined {
  const upper = symbol.trim().toUpperCase();
  if (customWeights && customWeights[upper] !== undefined) {
    return customWeights[upper];
  }
  return CHEMKIN_ELEMENT_ATOMIC_WEIGHTS[upper];
}

export function computeMolecularWeightGPerMol(
  composition: Record<string, number>,
  customWeights?: Record<string, number>,
): number {
  let mw = 0;
  for (const [el, count] of Object.entries(composition)) {
    const aw = getElementAtomicWeight(el, customWeights) ?? 0;
    mw += aw * count;
  }
  return mw;
}

function nasa7Params(coeffs: Nasa7Coeffs, prefix: string): CleanroomParameterSchema[] {
  return coeffs.map((val, idx) => ({
    key: `${prefix}_a${idx + 1}`,
    type: "real" as const,
    defaultValue: val,
    unit: "1",
    description: `NASA-7 ${prefix}-temperature coefficient a${idx + 1}`,
  }));
}

/**
 * Builds the declarative `CleanroomModelSchema[]` catalog for `@modelscript/chemkin-std-lib`.
 */
export function buildChemkinCleanroomSchemas(): CleanroomModelSchema[] {
  const defaultPorts: DiagramPortSpec[] = [
    { name: "molar_flux", kind: "fluid", side: "left", dx: 0, dy: 26 },
    { name: "thermo_out", kind: "signal", side: "right", dx: 88, dy: 26 },
  ];

  return CHEMKIN_STD_SPECIES.map((spec) => {
    const mw = computeMolecularWeightGPerMol(spec.thermo.composition);
    const parameters: CleanroomParameterSchema[] = [
      { key: "molecularWeight", type: "real", defaultValue: mw, unit: "g/mol", description: "Molar mass" },
      {
        key: "tLow",
        type: "real",
        defaultValue: spec.thermo.tLow,
        unit: "K",
        description: "NASA-7 lower temperature bound",
      },
      {
        key: "tMid",
        type: "real",
        defaultValue: spec.thermo.tMid,
        unit: "K",
        description: "NASA-7 midpoint temperature",
      },
      {
        key: "tHigh",
        type: "real",
        defaultValue: spec.thermo.tHigh,
        unit: "K",
        description: "NASA-7 upper temperature bound",
      },
      ...nasa7Params(spec.thermo.highCoeffs, "high"),
      ...nasa7Params(spec.thermo.lowCoeffs, "low"),
    ];

    return {
      namePath: `Chemkin.Thermo.${spec.species}`,
      name: spec.species,
      aliases: [spec.species.toLowerCase()],
      label: spec.label,
      category: spec.category,
      domain: "chemistry",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "class",
      width: 88,
      height: 52,
      svg: generateChemkinSpeciesSvg(spec.species, spec.category),
      ports: defaultPorts,
      parameters,
      wasmKernel: "chemkinEvalNasa7",
      extra: {
        archetypeId: spec.archetypeId,
        composition: spec.thermo.composition,
        phase: spec.thermo.phase,
      },
    };
  });
}
