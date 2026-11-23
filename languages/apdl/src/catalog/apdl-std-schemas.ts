// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * APDL cleanroom standard library archetype IDs matching `assets/apdl-std-lib/src/models.ts`.
 */
export const ApdlArchetypeId = {
  LINK180: 1,
  BEAM188: 2,
  PLANE182: 3,
  SHELL181: 4,
  SOLID185: 5,
  MASS21: 6,
  COMBIN14: 7,
} as const;

export type ApdlArchetypeId = (typeof ApdlArchetypeId)[keyof typeof ApdlArchetypeId];

export interface ApdlElementSpec {
  elementType: string;
  aliases?: string[] | undefined;
  label: string;
  category: "1D Truss / Beam" | "2D Plane / Shell" | "3D Solid" | "Discrete Mass / Spring";
  archetypeId: ApdlArchetypeId;
  description: string;
  provenance: string;
  dofs: string[];
  nodeCount: number;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<ApdlElementSpec["category"], { fill: string; stroke: string; badge: string }> = {
  "1D Truss / Beam": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "1D" },
  "2D Plane / Shell": { fill: "#163b3b", stroke: "#2dd4bf", badge: "2D" },
  "3D Solid": { fill: "#2a2b4a", stroke: "#818cf8", badge: "3D" },
  "Discrete Mass / Spring": { fill: "#422006", stroke: "#fb923c", badge: "0D" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an APDL element type.
 */
export function generateApdlBlockSvg(elementType: string, category: ApdlElementSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const label = elementType.slice(0, 10);

  let glyph = "";
  if (category === "1D Truss / Beam") {
    glyph =
      `<line x1="52" y1="14" x2="72" y2="14" stroke="${c.stroke}" stroke-width="2.0"/>` +
      `<circle cx="52" cy="14" r="2.2" fill="${c.stroke}"/>` +
      `<circle cx="72" cy="14" r="2.2" fill="${c.stroke}"/>`;
  } else if (category === "2D Plane / Shell") {
    glyph = `<polygon points="54,8 72,10 70,21 52,19" fill="none" stroke="${c.stroke}" stroke-width="1.3"/>`;
  } else if (category === "3D Solid") {
    glyph =
      `<polygon points="54,10 66,10 66,21 54,21" fill="none" stroke="${c.stroke}" stroke-width="1.2"/>` +
      `<polyline points="54,10 59,6 71,6 71,17 66,21" fill="none" stroke="${c.stroke}" stroke-width="1.1"/>` +
      `<line x1="66" y1="10" x2="71" y2="6" stroke="${c.stroke}" stroke-width="1.1"/>`;
  } else {
    glyph = `<polyline points="52,14 56,14 58,9 61,19 64,9 67,19 69,14 73,14" fill="none" stroke="${c.stroke}" stroke-width="1.3"/>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 48" width="80" height="48">` +
    `<rect x="2" y="2" width="76" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="22" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="17" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    glyph +
    `<text x="40" y="36" text-anchor="middle" font-family="monospace" font-size="9" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForElement(spec: ApdlElementSpec): DiagramPortSpec[] {
  if (spec.elementType === "MASS21") {
    return [
      { name: "node_i", kind: "mechanical", side: "left", dx: 0, dy: 24 },
      { name: "inertia", kind: "signal", side: "right", dx: 80, dy: 24 },
    ];
  }
  return [
    { name: "node_i", kind: "mechanical", side: "left", dx: 0, dy: 16 },
    { name: "node_j", kind: "mechanical", side: "right", dx: 80, dy: 16 },
    { name: "material", kind: "signal", side: "left", dx: 0, dy: 34 },
  ];
}

export const APDL_ELEMENT_SPECS: readonly ApdlElementSpec[] = [
  {
    elementType: "LINK180",
    aliases: ["LINK8", "TRUSS", "SPAR"],
    label: "LINK180 3D Spar / Truss",
    category: "1D Truss / Beam",
    archetypeId: ApdlArchetypeId.LINK180,
    description:
      "3D 2-node uniaxial tension-compression spar (truss) element with 3 translational DOFs (UX, UY, UZ) per node and axial stiffness EA/L.",
    provenance: "Cleanroom direct-stiffness formulation (Cook, Malkus & Plesha)",
    dofs: ["UX", "UY", "UZ"],
    nodeCount: 2,
    params: [
      ["EX", 2.1e11, "Pa", "Young's modulus"],
      ["A", 1e-4, "m^2", "Cross-sectional area"],
      ["L", 1.0, "m", "Element length"],
      ["DENS", 7850.0, "kg/m^3", "Mass density"],
    ],
  },
  {
    elementType: "BEAM188",
    aliases: ["BEAM3", "BEAM4", "BEAM189", "BEAM"],
    label: "BEAM188 3D 2-Node Beam",
    category: "1D Truss / Beam",
    archetypeId: ApdlArchetypeId.BEAM188,
    description:
      "3D 2-node Euler-Bernoulli / Timoshenko beam element with 6 DOFs per node (UX, UY, UZ, ROTX, ROTY, ROTZ), supporting axial, torsional, and biaxial bending.",
    provenance: "Cleanroom Euler-Bernoulli beam formulation (Przemieniecki / Bathe)",
    dofs: ["UX", "UY", "UZ", "ROTX", "ROTY", "ROTZ"],
    nodeCount: 2,
    params: [
      ["EX", 2.1e11, "Pa", "Young's modulus"],
      ["PRXY", 0.3, "-", "Poisson's ratio"],
      ["A", 1e-3, "m^2", "Cross-sectional area"],
      ["IZZ", 8.3333333333e-8, "m^4", "Second moment of area about Z"],
      ["IYY", 8.3333333333e-8, "m^4", "Second moment of area about Y"],
      ["J", 1.406e-7, "m^4", "Torsional constant"],
      ["L", 1.0, "m", "Element length"],
      ["DENS", 7850.0, "kg/m^3", "Mass density"],
    ],
  },
  {
    elementType: "PLANE182",
    aliases: ["PLANE42", "QUAD4", "PLANE_STRESS"],
    label: "PLANE182 2D 4-Node Solid",
    category: "2D Plane / Shell",
    archetypeId: ApdlArchetypeId.PLANE182,
    description:
      "2D 4-node isoparametric structural solid element (plane stress, plane strain, or axisymmetric) with 2 DOFs per node (UX, UY).",
    provenance: "Cleanroom 2D isoparametric elasticity (Zienkiewicz & Taylor)",
    dofs: ["UX", "UY"],
    nodeCount: 4,
    params: [
      ["EX", 2.1e11, "Pa", "Young's modulus"],
      ["PRXY", 0.3, "-", "Poisson's ratio"],
      ["THICK", 0.01, "m", "Element thickness"],
      ["DENS", 7850.0, "kg/m^3", "Mass density"],
    ],
  },
  {
    elementType: "SHELL181",
    aliases: ["SHELL63", "SHELL4", "SHELL"],
    label: "SHELL181 4-Node Shell",
    category: "2D Plane / Shell",
    archetypeId: ApdlArchetypeId.SHELL181,
    description:
      "4-node Mindlin-Reissner structural shell element with 6 DOFs per node (UX, UY, UZ, ROTX, ROTY, ROTZ) for thin to moderately thick shell structures.",
    provenance: "Cleanroom Kirchhoff / Mindlin-Reissner plate & shell mechanics (Hughes)",
    dofs: ["UX", "UY", "UZ", "ROTX", "ROTY", "ROTZ"],
    nodeCount: 4,
    params: [
      ["EX", 2.1e11, "Pa", "Young's modulus"],
      ["PRXY", 0.3, "-", "Poisson's ratio"],
      ["THICK", 0.005, "m", "Shell thickness"],
      ["DENS", 7850.0, "kg/m^3", "Mass density"],
    ],
  },
  {
    elementType: "SOLID185",
    aliases: ["SOLID45", "HEX8", "BRICK8"],
    label: "SOLID185 3D 8-Node Solid",
    category: "3D Solid",
    archetypeId: ApdlArchetypeId.SOLID185,
    description:
      "3D 8-node hexahedral structural solid element with 3 translational DOFs per node (UX, UY, UZ) and full 3D isotropic constitutive elasticity.",
    provenance: "Cleanroom 3D continuum elasticity (Bathe)",
    dofs: ["UX", "UY", "UZ"],
    nodeCount: 8,
    params: [
      ["EX", 2.1e11, "Pa", "Young's modulus"],
      ["PRXY", 0.3, "-", "Poisson's ratio"],
      ["DENS", 7850.0, "kg/m^3", "Mass density"],
    ],
  },
  {
    elementType: "MASS21",
    aliases: ["POINT_MASS", "LUMPED_MASS"],
    label: "MASS21 Structural Mass",
    category: "Discrete Mass / Spring",
    archetypeId: ApdlArchetypeId.MASS21,
    description:
      "Single-node point mass element with up to 6 DOFs (UX, UY, UZ, ROTX, ROTY, ROTZ), supporting translational mass and rotary inertia.",
    provenance: "Cleanroom rigid-body point inertia",
    dofs: ["UX", "UY", "UZ", "ROTX", "ROTY", "ROTZ"],
    nodeCount: 1,
    params: [
      ["MASS", 1.0, "kg", "Translational lumped mass"],
      ["IXX", 0.0, "kg*m^2", "Rotary inertia about X"],
      ["IYY", 0.0, "kg*m^2", "Rotary inertia about Y"],
      ["IZZ", 0.0, "kg*m^2", "Rotary inertia about Z"],
    ],
  },
  {
    elementType: "COMBIN14",
    aliases: ["SPRING", "SPRING_DAMPER"],
    label: "COMBIN14 Spring-Damper",
    category: "Discrete Mass / Spring",
    archetypeId: ApdlArchetypeId.COMBIN14,
    description:
      "2-node longitudinal or torsional spring-damper element with stiffness K and viscous damping coefficient C.",
    provenance: "Cleanroom Kelvin-Voigt spring-damper mechanics",
    dofs: ["UX", "UY", "UZ"],
    nodeCount: 2,
    params: [
      ["K", 1e5, "N/m", "Spring stiffness"],
      ["CV1", 10.0, "N*s/m", "Linear viscous damping coefficient"],
    ],
  },
];

/**
 * Builds the declarative cleanroom `CleanroomModelSchema[]` array for `@modelscript/apdl-std-lib`.
 */
export function buildApdlCleanroomSchemas(): CleanroomModelSchema[] {
  return APDL_ELEMENT_SPECS.map((spec): CleanroomModelSchema => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `APDL.Elements.${spec.elementType}`,
      name: spec.elementType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "structural",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "element_type",
      width: 80,
      height: 48,
      svg: generateApdlBlockSvg(spec.elementType, spec.category),
      ports: defaultPortsForElement(spec),
      parameters,
      wasmKernel: "evalElement",
      extra: {
        archetypeId: spec.archetypeId,
        dofs: spec.dofs,
        nodeCount: spec.nodeCount,
      },
    };
  });
}
