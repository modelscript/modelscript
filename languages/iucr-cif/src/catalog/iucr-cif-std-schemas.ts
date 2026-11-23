// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * IUCr CIF cleanroom archetype IDs matching `assets/iucr-cif-std-lib/src/models.ts`.
 */
export const IucrCifArchetypeId = {
  // Core CIF 1.1 Dictionary Categories
  CELL: 1,
  SYMMETRY: 2,
  ATOM_SITE: 3,
  DIFFRN: 4,
  // Canonical Crystal Structures
  SILICON_FD3M: 10,
  NACL_FM3M: 11,
  ALPHA_QUARTZ: 12,
  FCC_COPPER: 13,
} as const;

export type IucrCifArchetypeId = (typeof IucrCifArchetypeId)[keyof typeof IucrCifArchetypeId];

export type IucrCifSchemaCategory = "CIF Core Dictionary" | "Canonical Crystals";

export interface IucrCifSchemaSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: IucrCifSchemaCategory;
  archetypeId: IucrCifArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

/**
 * Canonical CIF 1.1 crystal structure templates for testing, benchmarking, and interactive presets.
 */
export const CANONICAL_CIF_TEMPLATES: Record<"silicon" | "nacl" | "quartz" | "copper", string> = {
  silicon: `# Silicon (Si) — Diamond Cubic Fd-3m (ICSD / NIST SRM 640)
data_silicon_fd3m
_chemical_formula_sum          'Si'
_cell_length_a                 5.4310(2)
_cell_length_b                 5.4310(2)
_cell_length_c                 5.4310(2)
_cell_angle_alpha              90.0
_cell_angle_beta               90.0
_cell_angle_gamma              90.0
_cell_formula_units_Z          8
_symmetry_space_group_name_H-M 'F d -3 m'
_symmetry_Int_Tables_number    227
_diffrn_radiation_wavelength   1.5406

loop_
_symmetry_equiv_pos_as_xyz
'x, y, z'
'x+1/2, y+1/2, z'
'x+1/2, y, z+1/2'
'x, y+1/2, z+1/2'
'x+1/4, y+1/4, z+1/4'
'x+3/4, y+3/4, z+1/4'
'x+3/4, y+1/4, z+3/4'
'x+1/4, y+3/4, z+3/4'

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_B_iso_or_equiv
Si1 Si 0.0000 0.0000 0.0000 1.000 0.46
`,

  nacl: `# Halite (NaCl) — Rock Salt Fm-3m
data_nacl_fm3m
_chemical_formula_sum          'Na Cl'
_cell_length_a                 5.6402(1)
_cell_length_b                 5.6402(1)
_cell_length_c                 5.6402(1)
_cell_angle_alpha              90.0
_cell_angle_beta               90.0
_cell_angle_gamma              90.0
_cell_formula_units_Z          4
_symmetry_space_group_name_H-M 'F m -3 m'
_symmetry_Int_Tables_number    225
_diffrn_radiation_wavelength   1.5406

loop_
_symmetry_equiv_pos_as_xyz
'x, y, z'
'x+1/2, y+1/2, z'
'x+1/2, y, z+1/2'
'x, y+1/2, z+1/2'

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_B_iso_or_equiv
Na1 Na 0.0000 0.0000 0.0000 1.000 1.50
Cl1 Cl 0.5000 0.5000 0.5000 1.000 1.20
`,

  quartz: `# alpha-Quartz (SiO2) — Trigonal P 3_1 2 1
data_alpha_quartz
_chemical_formula_sum          'O2 Si'
_cell_length_a                 4.9134(1)
_cell_length_b                 4.9134(1)
_cell_length_c                 5.4052(1)
_cell_angle_alpha              90.0
_cell_angle_beta               90.0
_cell_angle_gamma              120.0
_cell_formula_units_Z          3
_symmetry_space_group_name_H-M 'P 31 2 1'
_symmetry_Int_Tables_number    152
_diffrn_radiation_wavelength   1.5406

loop_
_symmetry_equiv_pos_as_xyz
'x, y, z'
'-y, x-y, z+1/3'
'-x+y, -x, z+2/3'
'x-y, -y, -z'
'-x, -x+y, -z+2/3'
'y, x, -z+1/3'

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_B_iso_or_equiv
Si1 Si 0.4697 0.0000 0.0000 1.000 0.50
O1  O  0.4135 0.2669 0.1191 1.000 0.85
`,

  copper: `# Copper (Cu) — Face-Centered Cubic Fm-3m
data_fcc_copper
_chemical_formula_sum          'Cu'
_cell_length_a                 3.6149(1)
_cell_length_b                 3.6149(1)
_cell_length_c                 3.6149(1)
_cell_angle_alpha              90.0
_cell_angle_beta               90.0
_cell_angle_gamma              90.0
_cell_formula_units_Z          4
_symmetry_space_group_name_H-M 'F m -3 m'
_symmetry_Int_Tables_number    225
_diffrn_radiation_wavelength   1.5406

loop_
_symmetry_equiv_pos_as_xyz
'x, y, z'
'x+1/2, y+1/2, z'
'x+1/2, y, z+1/2'
'x, y+1/2, z+1/2'

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
_atom_site_B_iso_or_equiv
Cu1 Cu 0.0000 0.0000 0.0000 1.000 0.55
`,
};

const CATEGORY_COLORS: Record<IucrCifSchemaCategory, { fill: string; stroke: string; badge: string }> = {
  "CIF Core Dictionary": { fill: "#1e293b", stroke: "#38bdf8", badge: "CIF" },
  "Canonical Crystals": { fill: "#1e3a2f", stroke: "#34d399", badge: "XTAL" },
};

export function generateIucrCifBlockSvg(modelType: string, category: IucrCifSchemaCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 11);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 54" width="92" height="54">`,
    `<rect x="2" y="2" width="88" height="50" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`,
    `<polygon points="16,28 24,20 32,28 24,36" fill="none" stroke="${c.stroke}" stroke-width="1.2"/>`,
    `<circle cx="24" cy="28" r="2.5" fill="${c.stroke}"/>`,
    `<text x="58" y="22" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>`,
    `<text x="58" y="36" text-anchor="middle" font-family="monospace" font-size="8.2" font-weight="bold" fill="#f8fafc">${label}</text>`,
    `</svg>`,
  ].join("");
}

function defaultPortsForSpec(spec: IucrCifSchemaSpec): DiagramPortSpec[] {
  if (spec.category === "CIF Core Dictionary") {
    return [
      { name: "in", kind: "signal", side: "left", dx: 0, dy: 27 },
      { name: "out", kind: "signal", side: "right", dx: 92, dy: 27 },
    ];
  }
  return [
    { name: "lattice", kind: "signal", side: "right", dx: 92, dy: 18 },
    { name: "xrd", kind: "signal", side: "right", dx: 92, dy: 36 },
  ];
}

export const IUCR_CIF_SCHEMA_SPECS: IucrCifSchemaSpec[] = [
  // Core CIF Dictionary Categories
  {
    modelType: "_cell",
    aliases: ["CELL", "UNIT_CELL"],
    label: "Unit Cell Category (_cell)",
    category: "CIF Core Dictionary",
    archetypeId: IucrCifArchetypeId.CELL,
    description:
      "IUCr CIF Core Dictionary _cell category defining lattice lengths (a, b, c) and interaxial angles (alpha, beta, gamma).",
    provenance: "IUCr CIF Core Dictionary 2.4.5 (_cell)",
    params: [
      ["a", 5.431, "Å", "_cell_length_a"],
      ["b", 5.431, "Å", "_cell_length_b"],
      ["c", 5.431, "Å", "_cell_length_c"],
      ["alpha", 90.0, "deg", "_cell_angle_alpha"],
      ["beta", 90.0, "deg", "_cell_angle_beta"],
      ["gamma", 90.0, "deg", "_cell_angle_gamma"],
    ],
  },
  {
    modelType: "_symmetry",
    aliases: ["SYMMETRY", "SPACE_GROUP"],
    label: "Space-Group Symmetry Category (_symmetry)",
    category: "CIF Core Dictionary",
    archetypeId: IucrCifArchetypeId.SYMMETRY,
    description:
      "IUCr CIF Core Dictionary _symmetry / _space_group category defining International Tables number and Wyckoff equivalent positions.",
    provenance: "IUCr CIF Core Dictionary 2.4.5 (_symmetry); International Tables Vol. A",
    params: [
      ["itNumber", 227, "1", "_symmetry_Int_Tables_number"],
      ["opCount", 8, "1", "Number of symmetry equivalent positions"],
    ],
  },
  {
    modelType: "_atom_site",
    aliases: ["ATOM_SITE", "ATOMS"],
    label: "Atomic Site Category (_atom_site)",
    category: "CIF Core Dictionary",
    archetypeId: IucrCifArchetypeId.ATOM_SITE,
    description:
      "IUCr CIF Core Dictionary _atom_site category defining fractional coordinates, occupancy, and isotropic displacement parameters.",
    provenance: "IUCr CIF Core Dictionary 2.4.5 (_atom_site)",
    params: [
      ["fractX", 0.0, "1", "_atom_site_fract_x"],
      ["fractY", 0.0, "1", "_atom_site_fract_y"],
      ["fractZ", 0.0, "1", "_atom_site_fract_z"],
      ["occupancy", 1.0, "1", "_atom_site_occupancy"],
      ["bIso", 0.5, "Å²", "_atom_site_B_iso_or_equiv"],
    ],
  },
  {
    modelType: "_diffrn",
    aliases: ["DIFFRN", "XRD"],
    label: "Diffraction Measurement Category (_diffrn)",
    category: "CIF Core Dictionary",
    archetypeId: IucrCifArchetypeId.DIFFRN,
    description:
      "IUCr CIF Core Dictionary _diffrn category defining X-ray radiation wavelength (Cu-Kα 1.5406 Å) and Bragg geometry.",
    provenance: "IUCr CIF Core Dictionary 2.4.5 (_diffrn)",
    params: [
      ["wavelength", 1.5406, "Å", "_diffrn_radiation_wavelength (Cu-Kα1)"],
      ["twoThetaMin", 5.0, "deg", "Minimum diffraction angle 2θ"],
      ["twoThetaMax", 90.0, "deg", "Maximum diffraction angle 2θ"],
    ],
  },

  // Canonical Crystals
  {
    modelType: "SILICON_FD3M",
    aliases: ["SI", "SILICON", "DIAMOND_CUBIC"],
    label: "Silicon (Diamond Cubic Fd-3m)",
    category: "Canonical Crystals",
    archetypeId: IucrCifArchetypeId.SILICON_FD3M,
    description:
      "NIST SRM 640 Silicon diamond cubic crystal (Fd-3m, a = 5.4310 Å, Z = 8, Si-Si = 2.3517 Å, (111) 2θ = 28.44°).",
    provenance: "NIST SRM 640 / International Tables Vol. A #227",
    params: [
      ["a", 5.431, "Å", "Cubic lattice parameter a"],
      ["b", 5.431, "Å", "Cubic lattice parameter b"],
      ["c", 5.431, "Å", "Cubic lattice parameter c"],
      ["alpha", 90.0, "deg", "Cell angle alpha"],
      ["beta", 90.0, "deg", "Cell angle beta"],
      ["gamma", 90.0, "deg", "Cell angle gamma"],
      ["wavelength", 1.5406, "Å", "Cu-Kα1 wavelength"],
    ],
  },
  {
    modelType: "NACL_FM3M",
    aliases: ["NACL", "HALITE", "ROCK_SALT"],
    label: "NaCl Rock Salt (Fm-3m)",
    category: "Canonical Crystals",
    archetypeId: IucrCifArchetypeId.NACL_FM3M,
    description: "Halite (NaCl) cubic rock-salt structure (Fm-3m, a = 5.6402 Å, Z = 4, Na-Cl = 2.8201 Å).",
    provenance: "Wyckoff Crystal Structures / International Tables Vol. A #225",
    params: [
      ["a", 5.6402, "Å", "Cubic lattice parameter a"],
      ["b", 5.6402, "Å", "Cubic lattice parameter b"],
      ["c", 5.6402, "Å", "Cubic lattice parameter c"],
      ["alpha", 90.0, "deg", "Cell angle alpha"],
      ["beta", 90.0, "deg", "Cell angle beta"],
      ["gamma", 90.0, "deg", "Cell angle gamma"],
      ["wavelength", 1.5406, "Å", "Cu-Kα1 wavelength"],
    ],
  },
  {
    modelType: "ALPHA_QUARTZ",
    aliases: ["QUARTZ", "SIO2", "A_QUARTZ"],
    label: "alpha-Quartz (SiO2, P3_1 2 1)",
    category: "Canonical Crystals",
    archetypeId: IucrCifArchetypeId.ALPHA_QUARTZ,
    description: "Low-temperature trigonal alpha-Quartz (SiO2, P3_1 2 1, a = 4.9134 Å, c = 5.4052 Å, γ = 120°, Z = 3).",
    provenance: "Levien, Prewitt & Weidner (1980) Am. Mineral. 65, 920",
    params: [
      ["a", 4.9134, "Å", "Hexagonal/trigonal lattice parameter a"],
      ["b", 4.9134, "Å", "Hexagonal/trigonal lattice parameter b"],
      ["c", 5.4052, "Å", "Hexagonal/trigonal lattice parameter c"],
      ["alpha", 90.0, "deg", "Cell angle alpha"],
      ["beta", 90.0, "deg", "Cell angle beta"],
      ["gamma", 120.0, "deg", "Cell angle gamma"],
      ["wavelength", 1.5406, "Å", "Cu-Kα1 wavelength"],
    ],
  },
  {
    modelType: "FCC_COPPER",
    aliases: ["CU", "COPPER"],
    label: "FCC Copper (Cu, Fm-3m)",
    category: "Canonical Crystals",
    archetypeId: IucrCifArchetypeId.FCC_COPPER,
    description: "Face-centered cubic Copper (Fm-3m, a = 3.6149 Å, Z = 4, Cu-Cu = 2.5561 Å, ρ = 8.93 g/cm³).",
    provenance: "Swanson & Tatge (1953) NBS Circular 539",
    params: [
      ["a", 3.6149, "Å", "Cubic lattice parameter a"],
      ["b", 3.6149, "Å", "Cubic lattice parameter b"],
      ["c", 3.6149, "Å", "Cubic lattice parameter c"],
      ["alpha", 90.0, "deg", "Cell angle alpha"],
      ["beta", 90.0, "deg", "Cell angle beta"],
      ["gamma", 90.0, "deg", "Cell angle gamma"],
      ["wavelength", 1.5406, "Å", "Cu-Kα1 wavelength"],
    ],
  },
];

/**
 * Converts `IUCR_CIF_SCHEMA_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`.
 */
export function buildIucrCifCleanroomSchemas(): CleanroomModelSchema[] {
  return IUCR_CIF_SCHEMA_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `iucr-cif:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "materials",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "cif_schema",
      width: 92,
      height: 54,
      svg: generateIucrCifBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
