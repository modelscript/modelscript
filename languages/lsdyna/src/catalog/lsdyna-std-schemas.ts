// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * LS-DYNA cleanroom constitutive & section archetype IDs matching `assets/lsdyna-std-lib/src/models.ts`.
 */
export const LsDynaArchetypeId = {
  MAT_001: 1,
  MAT_003: 3,
  MAT_020: 20,
  MAT_024: 24,
  SECTION_SOLID: 101,
  SECTION_SHELL: 102,
  SECTION_BEAM: 103,
} as const;

export type LsDynaArchetypeId = (typeof LsDynaArchetypeId)[keyof typeof LsDynaArchetypeId];

export type LsDynaSchemaCategory = "Material" | "Section";

export interface LsDynaModelSpec {
  modelType: string;
  aliases: string[];
  label: string;
  category: LsDynaSchemaCategory;
  archetypeId: LsDynaArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<LsDynaSchemaCategory, { fill: string; stroke: string; badge: string }> = {
  Material: { fill: "#1e3a5f", stroke: "#60a5fa", badge: "MAT" },
  Section: { fill: "#2e2447", stroke: "#c084fc", badge: "SEC" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an LS-DYNA material or section card.
 */
export function generateLsDynaBlockSvg(modelType: string, category: LsDynaSchemaCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  const fontSize = label.length > 9 ? "7.8" : "9.2";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: LsDynaSchemaCategory): DiagramPortSpec[] {
  if (category === "Material") {
    return [
      { name: "strain_in", kind: "mechanical", side: "left", dx: 0, dy: 26 },
      { name: "stress_out", kind: "mechanical", side: "right", dx: 96, dy: 26 },
    ];
  }
  return [
    { name: "nodes_in", kind: "mechanical", side: "left", dx: 0, dy: 26 },
    { name: "part_out", kind: "mechanical", side: "right", dx: 96, dy: 26 },
  ];
}

export const LSDYNA_MODEL_SPECS: LsDynaModelSpec[] = [
  {
    modelType: "MAT_001",
    aliases: ["MAT_ELASTIC", "ELASTIC", "MAT1"],
    label: "MAT_001 (Isotropic Elastic)",
    category: "Material",
    archetypeId: LsDynaArchetypeId.MAT_001,
    description: "Isotropic linear elastic constitutive model (Hallquist DYNA3D/LS-DYNA MAT_001).",
    provenance: "Hallquist (1976-1988) DYNA3D / LS-DYNA Theory Manual §MAT_001",
    params: [
      ["ro", 7850.0, "kg/m3", "Mass density"],
      ["e", 2.1e11, "Pa", "Young's modulus"],
      ["pr", 0.3, "1", "Poisson's ratio"],
    ],
  },
  {
    modelType: "MAT_003",
    aliases: ["MAT_PLASTIC_KINEMATIC", "PLASTIC_KINEMATIC", "MAT3"],
    label: "MAT_003 (Plastic Kinematic)",
    category: "Material",
    archetypeId: LsDynaArchetypeId.MAT_003,
    description:
      "Isotropic and kinematic hardening plasticity with optional Cowper-Symonds strain-rate effects (MAT_003).",
    provenance: "Hallquist (1976-1988) DYNA3D / LS-DYNA Theory Manual §MAT_003",
    params: [
      ["ro", 7850.0, "kg/m3", "Mass density"],
      ["e", 2.1e11, "Pa", "Young's modulus"],
      ["pr", 0.3, "1", "Poisson's ratio"],
      ["sigy", 2.5e8, "Pa", "Initial yield stress"],
      ["etan", 2.1e9, "Pa", "Tangent modulus"],
      ["beta", 1.0, "1", "Hardening parameter (0=kinematic, 1=isotropic)"],
      ["fs", 0.25, "1", "Failure strain for eroding elements"],
    ],
  },
  {
    modelType: "MAT_020",
    aliases: ["MAT_RIGID", "RIGID", "MAT20"],
    label: "MAT_020 (Rigid Body)",
    category: "Material",
    archetypeId: LsDynaArchetypeId.MAT_020,
    description: "Rigid body material with inertial properties and optional center-of-mass constraints (MAT_020).",
    provenance: "Hallquist (1976-1988) DYNA3D / LS-DYNA Theory Manual §MAT_020",
    params: [
      ["ro", 7850.0, "kg/m3", "Mass density"],
      ["e", 2.1e11, "Pa", "Contact stiffness Young's modulus"],
      ["pr", 0.3, "1", "Contact Poisson's ratio"],
      ["cmo", 0.0, "1", "Center of mass constraint option"],
      ["con1", 0.0, "1", "Translational constraint code"],
      ["con2", 0.0, "1", "Rotational constraint code"],
    ],
  },
  {
    modelType: "MAT_024",
    aliases: ["MAT_PIECEWISE_LINEAR_PLASTICITY", "PIECEWISE_LINEAR_PLASTICITY", "MAT24"],
    label: "MAT_024 (Piecewise Linear Plasticity)",
    category: "Material",
    archetypeId: LsDynaArchetypeId.MAT_024,
    description:
      "Elasto-plastic material with arbitrary stress-strain hardening curve and strain-rate dependency (MAT_024).",
    provenance: "Hallquist (1976-1988) DYNA3D / LS-DYNA Theory Manual §MAT_024",
    params: [
      ["ro", 7850.0, "kg/m3", "Mass density"],
      ["e", 2.1e11, "Pa", "Young's modulus"],
      ["pr", 0.3, "1", "Poisson's ratio"],
      ["sigy", 3.0e8, "Pa", "Yield stress"],
      ["etan", 1.5e9, "Pa", "Tangent modulus"],
      ["fail", 0.3, "1", "Failure plastic strain"],
    ],
  },
  {
    modelType: "SECTION_SOLID",
    aliases: ["SOLID"],
    label: "SECTION_SOLID",
    category: "Section",
    archetypeId: LsDynaArchetypeId.SECTION_SOLID,
    description: "3D solid continuum element formulation (default ELFORM=1 constant stress solid).",
    provenance: "Hallquist (1976-1988) DYNA3D / LS-DYNA Keyword Manual §SECTION_SOLID",
    params: [["elform", 1.0, "1", "Element formulation (1=constant stress, 2=fully integrated)"]],
  },
  {
    modelType: "SECTION_SHELL",
    aliases: ["SHELL"],
    label: "SECTION_SHELL",
    category: "Section",
    archetypeId: LsDynaArchetypeId.SECTION_SHELL,
    description:
      "Shell element formulation (default ELFORM=2 Belytschko-Tsay shell) with thickness and integration points.",
    provenance: "Belytschko & Tsay (1984) / LS-DYNA Keyword Manual §SECTION_SHELL",
    params: [
      ["elform", 2.0, "1", "Element formulation (2=Belytschko-Tsay, 16=fully integrated)"],
      ["shrf", 0.8333333, "1", "Shear correction factor (5/6)"],
      ["nip", 2.0, "1", "Number of through-thickness integration points"],
      ["thickness", 0.005, "m", "Shell thickness"],
    ],
  },
  {
    modelType: "SECTION_BEAM",
    aliases: ["BEAM", "TRUSS"],
    label: "SECTION_BEAM",
    category: "Section",
    archetypeId: LsDynaArchetypeId.SECTION_BEAM,
    description: "1D beam/truss element formulation (ELFORM=1 Hughes-Liu, ELFORM=3 truss) with cross-sectional area.",
    provenance: "Hughes & Liu (1981) / LS-DYNA Keyword Manual §SECTION_BEAM",
    params: [
      ["elform", 3.0, "1", "Element formulation (1=Hughes-Liu beam, 3=truss)"],
      ["shrf", 1.0, "1", "Shear factor"],
      ["area", 0.001, "m2", "Cross-sectional area"],
    ],
  },
];

/**
 * Builds `CleanroomModelSchema[]` for `@modelscript/lsdyna-std-lib`.
 */
export function buildLsDynaCleanroomSchemas(): CleanroomModelSchema[] {
  return LSDYNA_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `lsdyna.${spec.category.toLowerCase()}.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "structural",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 96,
      height: 52,
      svg: generateLsDynaBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: "lsdynaConstitutiveEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
