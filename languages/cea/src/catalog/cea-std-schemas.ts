// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cea — Cleanroom NASA-7/NASA-9 Thermodynamic Species Schemas.
 *
 * Self-contained single source of truth for the 17 canonical NASA CEA standard-library
 * species with cleanroom SVG icons, elemental stoichiometry, NASA-7 polynomial parameters,
 * and NASA RP-1311 / GRI-Mech 3.0 / NIST-JANAF provenance.
 */

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";
import type { CeaSpeciesData } from "../types.js";

export type CeaSpeciesCategory = "Fuel" | "Oxidizer" | "Combustion Product" | "Radical" | "Inert";

/**
 * Canonical 17 standard-library NASA CEA species.
 */
export const CEA_STD_SPECIES_DATA: readonly CeaSpeciesData[] = [
  {
    name: "H2",
    aliases: ["H2(L)", "LH2", "GH2", "HYDROGEN"],
    formula: { H: 2 },
    molarMassKgMol: 0.00201588,
    phase: "gas",
    hf298KjMol: 0.0,
    liquidHfKjMol: -9.012,
    normalBoilingK: 20.27,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [2.34433112, 7.98052075e-3, -1.9478151e-5, 2.01572094e-8, -7.37611761e-12, -917.935173, 0.683010238],
      high: [3.3372792, -4.94024731e-5, 4.99456778e-7, -1.79566394e-10, 2.00255376e-14, -950.158922, -3.20502331],
    },
    description: "Molecular hydrogen (gas / cryogenic liquid LH2)",
    provenance: "NASA RP-1311 / GRI-Mech 3.0 / NIST-JANAF",
  },
  {
    name: "O2",
    aliases: ["O2(L)", "LOX", "GOX", "OXYGEN"],
    formula: { O: 2 },
    molarMassKgMol: 0.0319988,
    phase: "gas",
    hf298KjMol: 0.0,
    liquidHfKjMol: -12.979,
    normalBoilingK: 90.17,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [3.78245636, -2.99673416e-3, 9.84730201e-6, -9.68129509e-9, 3.24372837e-12, -1063.94356, 3.65767573],
      high: [3.28253784, 1.48308754e-3, -7.57966669e-7, 2.09470555e-10, -2.16717794e-14, -1088.45772, 5.45323129],
    },
    description: "Molecular oxygen (gas / cryogenic liquid LOX)",
    provenance: "NASA RP-1311 / GRI-Mech 3.0 / NIST-JANAF",
  },
  {
    name: "H2O",
    aliases: ["H2O(G)", "WATER", "STEAM"],
    formula: { H: 2, O: 1 },
    molarMassKgMol: 0.01801528,
    phase: "gas",
    hf298KjMol: -241.826,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [4.19864056, -2.0364341e-3, 6.52040211e-6, -5.48797062e-9, 1.77197817e-12, -30293.7267, -0.849032208],
      high: [3.03399249, 2.17691804e-3, -1.64072518e-7, -9.7041987e-11, 1.68200992e-14, -30004.2971, 4.9667701],
    },
    description: "Water vapor (primary H2/O2 and hydrocarbon combustion product)",
    provenance: "NASA RP-1311 / GRI-Mech 3.0 / NIST-JANAF",
  },
  {
    name: "OH",
    aliases: ["HYDROXYL"],
    formula: { O: 1, H: 1 },
    molarMassKgMol: 0.01700734,
    phase: "gas",
    hf298KjMol: 38.987,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [3.99201543, -2.40131752e-3, 4.61793841e-6, -3.88113333e-9, 1.3641147e-12, 3615.08056, -0.103925458],
      high: [3.09288767, 5.48429716e-4, 1.26505228e-7, -8.79461556e-11, 1.17412376e-14, 3858.657, 4.4766961],
    },
    description: "Hydroxyl radical (major high-temperature dissociation species)",
    provenance: "NASA RP-1311 / GRI-Mech 3.0 / NIST-JANAF",
  },
  {
    name: "H",
    aliases: ["ATOMIC_H"],
    formula: { H: 1 },
    molarMassKgMol: 0.00100794,
    phase: "gas",
    hf298KjMol: 217.998,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [2.5, 7.05332819e-13, -1.99591964e-15, 2.30081632e-18, -9.27732332e-22, 25473.6599, -0.446682853],
      high: [2.50000001, -2.30842973e-11, 1.61561948e-14, -4.73515235e-18, 4.98197357e-22, 25473.6599, -0.446682914],
    },
    description: "Atomic hydrogen radical",
    provenance: "NASA RP-1311 / GRI-Mech 3.0 / NIST-JANAF",
  },
  {
    name: "O",
    aliases: ["ATOMIC_O"],
    formula: { O: 1 },
    molarMassKgMol: 0.0159994,
    phase: "gas",
    hf298KjMol: 249.175,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [3.1682671, -3.27931884e-3, 6.64306396e-6, -6.12806624e-9, 2.11265971e-12, 29122.2592, 2.05193346],
      high: [2.56942078, -8.59741137e-5, 4.19484589e-8, -1.00177799e-11, 1.22833691e-15, 29217.5791, 4.78433864],
    },
    description: "Atomic oxygen radical",
    provenance: "NASA RP-1311 / GRI-Mech 3.0 / NIST-JANAF",
  },
  {
    name: "CH4",
    aliases: ["CH4(L)", "LCH4", "METHANE"],
    formula: { C: 1, H: 4 },
    molarMassKgMol: 0.01604246,
    phase: "gas",
    hf298KjMol: -74.873,
    liquidHfKjMol: -89.24,
    normalBoilingK: 111.66,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [5.14987613, -1.36709788e-2, 4.91800599e-5, -4.84743026e-8, 1.66693956e-11, -10246.6476, -4.64130376],
      high: [0.074851495, 1.33909467e-2, -5.73285809e-6, 1.22292535e-9, -1.0181523e-13, -9468.34459, 18.437318],
    },
    description: "Methane (gas / cryogenic liquid LCH4)",
    provenance: "NASA RP-1311 / GRI-Mech 3.0 / NIST-JANAF",
  },
  {
    name: "CO",
    aliases: ["CARBON_MONOXIDE"],
    formula: { C: 1, O: 1 },
    molarMassKgMol: 0.0280101,
    phase: "gas",
    hf298KjMol: -110.527,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [3.57953347, -6.1035368e-4, 1.01681433e-6, 9.07005884e-10, -9.04424499e-13, -14344.086, 3.50840928],
      high: [2.71518561, 2.06252743e-3, -9.98825771e-7, 2.30053008e-10, -2.03647716e-14, -14151.8724, 7.81868772],
    },
    description: "Carbon monoxide",
    provenance: "NASA RP-1311 / GRI-Mech 3.0 / NIST-JANAF",
  },
  {
    name: "CO2",
    aliases: ["CARBON_DIOXIDE"],
    formula: { C: 1, O: 2 },
    molarMassKgMol: 0.0440095,
    phase: "gas",
    hf298KjMol: -393.51,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [2.35677352, 8.98459677e-3, -7.12356269e-6, 2.45919022e-9, -1.43699548e-13, -48371.9697, 9.90105222],
      high: [3.85746029, 4.41437026e-3, -2.21481404e-6, 5.23490188e-10, -4.72084164e-14, -48759.166, 2.27163806],
    },
    description: "Carbon dioxide",
    provenance: "NASA RP-1311 / GRI-Mech 3.0 / NIST-JANAF",
  },
  {
    name: "N2",
    aliases: ["NITROGEN"],
    formula: { N: 2 },
    molarMassKgMol: 0.0280134,
    phase: "gas",
    hf298KjMol: 0.0,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [3.298677, 1.4082404e-3, -3.963222e-6, 5.641515e-9, -2.444854e-12, -1020.8999, 3.950372],
      high: [2.92664, 1.4879768e-3, -5.68476e-7, 1.0097038e-10, -6.753351e-15, -922.7977, 5.980528],
    },
    description: "Molecular nitrogen",
    provenance: "NASA RP-1311 / GRI-Mech 3.0 / NIST-JANAF",
  },
  {
    name: "NO",
    aliases: ["NITRIC_OXIDE"],
    formula: { N: 1, O: 1 },
    molarMassKgMol: 0.0300061,
    phase: "gas",
    hf298KjMol: 90.291,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [4.2184763, -4.638976e-3, 1.1041022e-5, -9.3361354e-9, 2.803577e-12, 9844.623, 2.2808464],
      high: [3.2606056, 1.1911043e-3, -4.2917048e-7, 6.9457669e-11, -4.0336099e-15, 9920.9746, 6.3693027],
    },
    description: "Nitric oxide",
    provenance: "NASA RP-1311 / GRI-Mech 3.0 / NIST-JANAF",
  },
  {
    name: "RP-1",
    aliases: ["RP1", "KEROSENE", "JET-A"],
    formula: { C: 1, H: 1.9423 },
    molarMassKgMol: 0.0139684,
    phase: "condensed",
    hf298KjMol: -24.718,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [3.368, 0, 0, 0, 0, -3977.0, 2.0],
      high: [3.368, 0, 0, 0, 0, -3977.0, 2.0],
    },
    description: "Rocket Propellant-1 (refined kerosene, NASA CEA unit formula C1 H1.9423)",
    provenance: "NASA RP-1311 / McBride & Gordon",
  },
  {
    name: "N2O4",
    aliases: ["N2O4(L)", "NTO", "DINITROGEN_TETROXIDE"],
    formula: { N: 2, O: 4 },
    molarMassKgMol: 0.092011,
    phase: "condensed",
    hf298KjMol: -19.56,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [17.16, 0, 0, 0, 0, -7469.0, -72.0],
      high: [17.16, 0, 0, 0, 0, -7469.0, -72.0],
    },
    description: "Dinitrogen tetroxide storable hypergolic oxidizer (liquid NTO)",
    provenance: "NASA RP-1311 / NIST-JANAF",
  },
  {
    name: "MMH",
    aliases: ["MMH(L)", "CH6N2", "MONOMETHYLHYDRAZINE"],
    formula: { C: 1, H: 6, N: 2 },
    molarMassKgMol: 0.0460717,
    phase: "condensed",
    hf298KjMol: 54.84,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [16.22, 0, 0, 0, 0, 1760.0, -72.0],
      high: [16.22, 0, 0, 0, 0, 1760.0, -72.0],
    },
    description: "Monomethylhydrazine storable hypergolic fuel (CH6N2)",
    provenance: "NASA RP-1311 / NIST-JANAF",
  },
  {
    name: "UDMH",
    aliases: ["UDMH(L)", "C2H8N2", "UNSYMMETRICAL_DIMETHYLHYDRAZINE"],
    formula: { C: 2, H: 8, N: 2 },
    molarMassKgMol: 0.0600983,
    phase: "condensed",
    hf298KjMol: 48.9,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [19.72, 0, 0, 0, 0, 2.0, -88.0],
      high: [19.72, 0, 0, 0, 0, 2.0, -88.0],
    },
    description: "Unsymmetrical dimethylhydrazine storable hypergolic fuel (C2H8N2)",
    provenance: "NASA RP-1311 / NIST-JANAF",
  },
  {
    name: "He",
    aliases: ["HE", "HELIUM"],
    formula: { He: 1 },
    molarMassKgMol: 0.004002602,
    phase: "gas",
    hf298KjMol: 0.0,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [2.5, 0, 0, 0, 0, -745.375, 0.928723974],
      high: [2.5, 0, 0, 0, 0, -745.375, 0.928723974],
    },
    description: "Monatomic helium inert gas",
    provenance: "NASA RP-1311 / NIST-JANAF",
  },
  {
    name: "Ar",
    aliases: ["AR", "ARGON"],
    formula: { Ar: 1 },
    molarMassKgMol: 0.039948,
    phase: "gas",
    hf298KjMol: 0.0,
    nasa7: {
      tLow: 200,
      tMid: 1000,
      tHigh: 6000,
      low: [2.5, 0, 0, 0, 0, -745.375, 4.37967491],
      high: [2.5, 0, 0, 0, 0, -745.375, 4.37967491],
    },
    description: "Monatomic argon inert gas",
    provenance: "NASA RP-1311 / NIST-JANAF",
  },
];

const SPECIES_CATEGORY: Record<string, CeaSpeciesCategory> = {
  H2: "Fuel",
  CH4: "Fuel",
  "RP-1": "Fuel",
  MMH: "Fuel",
  UDMH: "Fuel",
  O2: "Oxidizer",
  N2O4: "Oxidizer",
  H2O: "Combustion Product",
  CO: "Combustion Product",
  CO2: "Combustion Product",
  N2: "Combustion Product",
  NO: "Combustion Product",
  OH: "Radical",
  H: "Radical",
  O: "Radical",
  He: "Inert",
  Ar: "Inert",
};

const CATEGORY_COLORS: Record<CeaSpeciesCategory, { fill: string; stroke: string; badge: string }> = {
  Fuel: { fill: "#4a1d1d", stroke: "#f97316", badge: "FUEL" },
  Oxidizer: { fill: "#1e3a5f", stroke: "#38bdf8", badge: "OXID" },
  "Combustion Product": { fill: "#163b3b", stroke: "#2dd4bf", badge: "PROD" },
  Radical: { fill: "#3b1d4a", stroke: "#c084fc", badge: "RAD" },
  Inert: { fill: "#1e3f2f", stroke: "#34d399", badge: "INRT" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a NASA CEA thermodynamic species.
 */
export function generateCeaSpeciesSvg(speciesName: string, category: CeaSpeciesCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = speciesName.slice(0, 8);
  const fontSize = label.length > 5 ? "8.8" : "10.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpecies(): DiagramPortSpec[] {
  return [
    { name: "molar_in", kind: "fluid", side: "left", dx: 0, dy: 26 },
    { name: "thermo_out", kind: "thermal", side: "right", dx: 88, dy: 26 },
  ];
}

function speciesToParameters(sp: CeaSpeciesData): CleanroomParameterSchema[] {
  const params: CleanroomParameterSchema[] = [
    {
      key: "molarMass",
      type: "real",
      defaultValue: sp.molarMassKgMol * 1000.0,
      unit: "g/mol",
      description: "Molecular weight",
    },
    {
      key: "hf298",
      type: "real",
      defaultValue: sp.hf298KjMol,
      unit: "kJ/mol",
      description: "Standard enthalpy of formation at 298.15 K",
    },
    {
      key: "tLow",
      type: "real",
      defaultValue: sp.nasa7.tLow,
      unit: "K",
      description: "NASA-7 low-temperature lower bound",
    },
    { key: "tMid", type: "real", defaultValue: sp.nasa7.tMid, unit: "K", description: "NASA-7 midpoint temperature" },
    {
      key: "tHigh",
      type: "real",
      defaultValue: sp.nasa7.tHigh,
      unit: "K",
      description: "NASA-7 high-temperature upper bound",
    },
  ];
  for (let i = 0; i < 7; i++) {
    params.push({
      key: `aLow${i + 1}`,
      type: "real",
      defaultValue: sp.nasa7.low[i] ?? 0,
      description: `NASA-7 low-T coefficient a${i + 1}`,
    });
  }
  for (let i = 0; i < 7; i++) {
    params.push({
      key: `aHigh${i + 1}`,
      type: "real",
      defaultValue: sp.nasa7.high[i] ?? 0,
      description: `NASA-7 high-T coefficient a${i + 1}`,
    });
  }
  return params;
}

/**
 * Returns the canonical 17 cleanroom `CleanroomModelSchema` definitions for `@modelscript/cea-std-lib`.
 */
export function buildCeaCleanroomSchemas(): CleanroomModelSchema[] {
  return CEA_STD_SPECIES_DATA.map((sp, index) => {
    const category = SPECIES_CATEGORY[sp.name] ?? "Combustion Product";
    return {
      namePath: `CEA.Species.${sp.name}`,
      name: sp.name,
      aliases: [...sp.aliases],
      label: `${sp.name} (${category})`,
      category,
      domain: "thermochemistry",
      description: sp.description,
      provenance: sp.provenance,
      symbolKind: "Class",
      width: 88,
      height: 52,
      svg: generateCeaSpeciesSvg(sp.name, category),
      ports: defaultPortsForSpecies(),
      parameters: speciesToParameters(sp),
      wasmKernel: "evalSpeciesNasa7",
      extra: {
        speciesIndex: index,
        phase: sp.phase,
        formula: sp.formula,
      },
    };
  });
}
