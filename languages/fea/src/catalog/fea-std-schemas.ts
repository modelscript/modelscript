// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * FEA cleanroom standard library archetype IDs matching `assets/fea-std-lib/src/models.ts`.
 */
export const FeaArchetypeId = {
  // Structural Elements
  SOLID_TET: 1, // C3D4_TET4, C3D10_TET10, CTETRA_NASTRAN
  SOLID_HEX: 2, // C3D8R_HEX8, C3D20R_HEX20, CHEXA_NASTRAN
  SHELL_ELEM: 3, // S4R_SHELL, CQUAD4_NASTRAN, CTRIA3_NASTRAN
  BEAM_ELEM: 4, // B31_BEAM, CBEAM_NASTRAN
  MPC_CONSTRAINT: 5, // RBE2_RIGID, RBE3_INTERP

  // Constitutive Material Cards
  MAT_ISOTROPIC: 10, // MAT1_ISOTROPIC, ABQ_ELASTIC
  MAT_ORTHOTROPIC: 11, // MAT8_ORTHOTROPIC
  MAT_ANISOTROPIC: 12, // MAT9_ANISOTROPIC
  MAT_PLASTIC_J2: 20, // ABQ_PLASTIC_J2
  MAT_HYPER_NEO_HOOKE: 30, // ABQ_HYPERELASTIC_NEO_HOOKE
  MAT_HYPER_MOONEY_RIVLIN: 31, // ABQ_HYPERELASTIC_MOONEY_RIVLIN
  MAT_CREEP_NORTON: 40, // ABQ_CREEP_NORTON
  MAT_DENSITY: 50, // ABQ_DENSITY
  MAT_EXPANSION: 51, // ABQ_EXPANSION

  // Section & Laminate Cards
  SEC_LAMINATE: 60, // PCOMP_LAMINATE
  SEC_SHELL: 61, // PSHELL_SECTION
  SEC_SOLID: 62, // PSOLID_SECTION
} as const;

export type FeaArchetypeId = (typeof FeaArchetypeId)[keyof typeof FeaArchetypeId];

export interface FeaCardSpec {
  cardType: string;
  aliases?: string[];
  label: string;
  category:
    | "Solid Element"
    | "Shell / Beam Element"
    | "Constraint / MPC"
    | "Elastic Material"
    | "Plasticity / Creep"
    | "Hyperelastic Material"
    | "Thermal / Physical"
    | "Section / Laminate";
  archetypeId: FeaArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<FeaCardSpec["category"], { fill: string; stroke: string; badge: string }> = {
  "Solid Element": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "SOL" },
  "Shell / Beam Element": { fill: "#163b3b", stroke: "#2dd4bf", badge: "SHL" },
  "Constraint / MPC": { fill: "#422006", stroke: "#fb923c", badge: "MPC" },
  "Elastic Material": { fill: "#1e3f2f", stroke: "#34d399", badge: "ELA" },
  "Plasticity / Creep": { fill: "#3b2323", stroke: "#f87171", badge: "PLS" },
  "Hyperelastic Material": { fill: "#3b1f47", stroke: "#c084fc", badge: "HYP" },
  "Thermal / Physical": { fill: "#3f2e18", stroke: "#fbbf24", badge: "PHY" },
  "Section / Laminate": { fill: "#2a2b4a", stroke: "#818cf8", badge: "SEC" },
};

/**
 * Generates a deterministic cleanroom parametric SVG icon for an FEA element, material, or section card.
 */
export function generateFeaBlockSvg(cardType: string, category: FeaCardSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const label = cardType
    .replace(/^ABQ_/, "")
    .replace(/_NASTRAN$/, "")
    .slice(0, 10);

  let glyph = "";
  if (category === "Solid Element") {
    glyph =
      `<polygon points="56,8 70,12 70,22 56,18" fill="none" stroke="${c.stroke}" stroke-width="1.2"/>` +
      `<polyline points="56,8 63,5 70,12" fill="none" stroke="${c.stroke}" stroke-width="1.1"/>`;
  } else if (category === "Shell / Beam Element") {
    glyph = `<polygon points="55,10 71,8 69,20 53,22" fill="none" stroke="${c.stroke}" stroke-width="1.2"/>`;
  } else if (category === "Constraint / MPC") {
    glyph =
      `<circle cx="63" cy="14" r="2.2" fill="${c.stroke}"/>` +
      `<line x1="55" y1="8" x2="63" y2="14" stroke="${c.stroke}" stroke-width="1.1"/>` +
      `<line x1="71" y1="8" x2="63" y2="14" stroke="${c.stroke}" stroke-width="1.1"/>` +
      `<line x1="63" y1="14" x2="63" y2="22" stroke="${c.stroke}" stroke-width="1.1"/>`;
  } else if (category === "Section / Laminate") {
    glyph =
      `<line x1="54" y1="10" x2="72" y2="10" stroke="${c.stroke}" stroke-width="1.3"/>` +
      `<line x1="54" y1="14" x2="72" y2="14" stroke="${c.stroke}" stroke-width="1.3"/>` +
      `<line x1="54" y1="18" x2="72" y2="18" stroke="${c.stroke}" stroke-width="1.3"/>`;
  } else {
    glyph = `<polyline points="54,20 60,12 66,11 72,9" fill="none" stroke="${c.stroke}" stroke-width="1.3"/>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 48" width="80" height="48">` +
    `<rect x="2" y="2" width="76" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    glyph +
    `<text x="40" y="36" text-anchor="middle" font-family="monospace" font-size="9" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: FeaCardSpec["category"]): DiagramPortSpec[] {
  switch (category) {
    case "Solid Element":
    case "Shell / Beam Element":
      return [
        { name: "nodes", kind: "mechanical", side: "left", dx: 0, dy: 16 },
        { name: "section", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "stiffness", kind: "mechanical", side: "right", dx: 80, dy: 24 },
      ];
    case "Constraint / MPC":
      return [
        { name: "master", kind: "mechanical", side: "left", dx: 0, dy: 24 },
        { name: "slaves", kind: "mechanical", side: "right", dx: 80, dy: 24 },
      ];
    case "Elastic Material":
    case "Plasticity / Creep":
    case "Hyperelastic Material":
      return [
        { name: "strain", kind: "signal", side: "left", dx: 0, dy: 16 },
        { name: "temp", kind: "thermal", side: "left", dx: 0, dy: 34 },
        { name: "stress", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "Thermal / Physical":
      return [
        { name: "temp", kind: "thermal", side: "left", dx: 0, dy: 24 },
        { name: "prop", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "Section / Laminate":
      return [
        { name: "material", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "element", kind: "mechanical", side: "right", dx: 80, dy: 24 },
      ];
  }
}

/**
 * Cleanroom Abaqus (`.inp`) & NASTRAN (`.bdf`) structural element, section, and constitutive material cards.
 */
export const FEA_CARD_SPECS: readonly FeaCardSpec[] = [
  // =========================================================================
  // Structural Elements (13)
  // =========================================================================
  {
    cardType: "C3D4_TET4",
    aliases: ["C3D4", "TET4"],
    label: "4-Node Linear Tetrahedron (C3D4)",
    category: "Solid Element",
    archetypeId: FeaArchetypeId.SOLID_TET,
    description: "4-node constant-strain 3D linear tetrahedral continuum element with 3 translational DOFs per node.",
    provenance: "Zienkiewicz & Taylor, The Finite Element Method Vol. 1 (7th Ed.), Ch. 6",
    params: [
      ["nodes", 4, "count", "Number of element nodes"],
      ["gaussPoints", 1, "count", "Volume Gauss quadrature points"],
      ["dofsPerNode", 3, "count", "Translational DOFs per node"],
      ["E", 210e9, "Pa", "Reference Young's modulus"],
      ["nu", 0.3, "1", "Reference Poisson's ratio"],
    ],
  },
  {
    cardType: "C3D10_TET10",
    aliases: ["C3D10", "C3D10M", "TET10"],
    label: "10-Node Quadratic Tetrahedron (C3D10)",
    category: "Solid Element",
    archetypeId: FeaArchetypeId.SOLID_TET,
    description: "10-node isoparametric quadratic tetrahedral continuum element with 4-point Gauss quadrature.",
    provenance: "Zienkiewicz & Taylor, The Finite Element Method Vol. 1 (7th Ed.), Ch. 6 & Ch. 8",
    params: [
      ["nodes", 10, "count", "Number of element nodes"],
      ["gaussPoints", 4, "count", "Volume Gauss quadrature points"],
      ["dofsPerNode", 3, "count", "Translational DOFs per node"],
      ["E", 210e9, "Pa", "Reference Young's modulus"],
      ["nu", 0.3, "1", "Reference Poisson's ratio"],
    ],
  },
  {
    cardType: "C3D8R_HEX8",
    aliases: ["C3D8R", "C3D8", "C3D8I", "HEX8"],
    label: "8-Node Reduced-Integration Brick (C3D8R)",
    category: "Solid Element",
    archetypeId: FeaArchetypeId.SOLID_HEX,
    description: "8-node trilinear hexahedral solid element with reduced 1-point integration and hourglass control.",
    provenance: "Bathe, Finite Element Procedures (2nd Ed.), Ch. 5; Flanagan & Belytschko (1981)",
    params: [
      ["nodes", 8, "count", "Number of element nodes"],
      ["gaussPoints", 1, "count", "Reduced Gauss quadrature points"],
      ["dofsPerNode", 3, "count", "Translational DOFs per node"],
      ["E", 210e9, "Pa", "Reference Young's modulus"],
      ["nu", 0.3, "1", "Reference Poisson's ratio"],
      ["hourglassStiffness", 0.005, "1", "Hourglass stabilization factor"],
    ],
  },
  {
    cardType: "C3D20R_HEX20",
    aliases: ["C3D20R", "C3D20", "HEX20"],
    label: "20-Node Quadratic Brick (C3D20R)",
    category: "Solid Element",
    archetypeId: FeaArchetypeId.SOLID_HEX,
    description: "20-node serendipity quadratic hexahedral continuum element with 2x2x2 reduced Gauss integration.",
    provenance: "Bathe, Finite Element Procedures (2nd Ed.), Ch. 5; Zienkiewicz & Taylor Vol. 1, Ch. 8",
    params: [
      ["nodes", 20, "count", "Number of element nodes"],
      ["gaussPoints", 8, "count", "2x2x2 reduced Gauss quadrature points"],
      ["dofsPerNode", 3, "count", "Translational DOFs per node"],
      ["E", 210e9, "Pa", "Reference Young's modulus"],
      ["nu", 0.3, "1", "Reference Poisson's ratio"],
    ],
  },
  {
    cardType: "S4R_SHELL",
    aliases: ["S4R", "S4", "S3", "S3R"],
    label: "4-Node Finite-Strain Shell (S4R)",
    category: "Shell / Beam Element",
    archetypeId: FeaArchetypeId.SHELL_ELEM,
    description:
      "4-node Mindlin-Reissner doubly-curved shell element with reduced integration and finite membrane strains.",
    provenance: "Bathe, Finite Element Procedures (2nd Ed.), Ch. 5.4; Hughes, The Finite Element Method, Ch. 6",
    params: [
      ["nodes", 4, "count", "Number of element nodes"],
      ["thickness", 0.01, "m", "Shell thickness"],
      ["E", 210e9, "Pa", "Reference Young's modulus"],
      ["nu", 0.3, "1", "Reference Poisson's ratio"],
      ["shearFactor", 0.8333333333, "1", "Transverse shear correction factor (5/6)"],
    ],
  },
  {
    cardType: "B31_BEAM",
    aliases: ["B31", "B32", "B31H"],
    label: "2-Node Timoshenko 3D Beam (B31)",
    category: "Shell / Beam Element",
    archetypeId: FeaArchetypeId.BEAM_ELEM,
    description: "2-node linear 3D Timoshenko beam element accounting for transverse shear deformation.",
    provenance: "Bathe, Finite Element Procedures (2nd Ed.), Ch. 5.4; Zienkiewicz & Taylor Vol. 2, Ch. 13",
    params: [
      ["area", 1e-3, "m2", "Cross-sectional area A"],
      ["Iyy", 8.33e-8, "m4", "Second moment of area about local y-axis"],
      ["Izz", 8.33e-8, "m4", "Second moment of area about local z-axis"],
      ["J", 1.41e-7, "m4", "Torsional constant J"],
      ["E", 210e9, "Pa", "Young's modulus"],
      ["nu", 0.3, "1", "Poisson's ratio"],
      ["length", 1.0, "m", "Reference element length"],
    ],
  },
  {
    cardType: "CQUAD4_NASTRAN",
    aliases: ["CQUAD4", "CQUAD8", "CQUADR"],
    label: "NASTRAN 4-Node Quad Shell (CQUAD4)",
    category: "Shell / Beam Element",
    archetypeId: FeaArchetypeId.SHELL_ELEM,
    description:
      "NASTRAN 4-node isoparametric quadrilateral plate/shell element with coupled membrane and bending stiffness.",
    provenance: "Zienkiewicz & Taylor, The Finite Element Method Vol. 2 (7th Ed.), Ch. 14; MacNeal (1978)",
    params: [
      ["nodes", 4, "count", "Number of element nodes"],
      ["thickness", 0.01, "m", "Plate/shell thickness"],
      ["E", 210e9, "Pa", "Reference Young's modulus"],
      ["nu", 0.3, "1", "Reference Poisson's ratio"],
      ["shearFactor", 0.8333333333, "1", "Transverse shear correction factor (5/6)"],
    ],
  },
  {
    cardType: "CTRIA3_NASTRAN",
    aliases: ["CTRIA3", "CTRIA6", "CTRIAR"],
    label: "NASTRAN 3-Node Triangular Shell (CTRIA3)",
    category: "Shell / Beam Element",
    archetypeId: FeaArchetypeId.SHELL_ELEM,
    description: "NASTRAN 3-node triangular plate/shell element for arbitrary mesh transitions and curved surfaces.",
    provenance: "Zienkiewicz & Taylor, The Finite Element Method Vol. 2 (7th Ed.), Ch. 14",
    params: [
      ["nodes", 3, "count", "Number of element nodes"],
      ["thickness", 0.01, "m", "Plate/shell thickness"],
      ["E", 210e9, "Pa", "Reference Young's modulus"],
      ["nu", 0.3, "1", "Reference Poisson's ratio"],
      ["shearFactor", 0.8333333333, "1", "Transverse shear correction factor (5/6)"],
    ],
  },
  {
    cardType: "CHEXA_NASTRAN",
    aliases: ["CHEXA", "CPENTA"],
    label: "NASTRAN 8/20-Node Hexahedron (CHEXA)",
    category: "Solid Element",
    archetypeId: FeaArchetypeId.SOLID_HEX,
    description:
      "NASTRAN six-sided isoparametric solid hexahedral element supporting 8 corner and up to 12 midside nodes.",
    provenance: "Bathe, Finite Element Procedures (2nd Ed.), Ch. 5; Zienkiewicz & Taylor Vol. 1, Ch. 8",
    params: [
      ["nodes", 8, "count", "Number of active nodes (8 or 20)"],
      ["gaussPoints", 8, "count", "Gauss quadrature points"],
      ["dofsPerNode", 3, "count", "Translational DOFs per node"],
      ["E", 210e9, "Pa", "Reference Young's modulus"],
      ["nu", 0.3, "1", "Reference Poisson's ratio"],
    ],
  },
  {
    cardType: "CTETRA_NASTRAN",
    aliases: ["CTETRA"],
    label: "NASTRAN 4/10-Node Tetrahedron (CTETRA)",
    category: "Solid Element",
    archetypeId: FeaArchetypeId.SOLID_TET,
    description:
      "NASTRAN four-sided solid tetrahedral element supporting 4-node linear or 10-node quadratic formulations.",
    provenance: "Zienkiewicz & Taylor, The Finite Element Method Vol. 1 (7th Ed.), Ch. 6",
    params: [
      ["nodes", 10, "count", "Number of active nodes (4 or 10)"],
      ["gaussPoints", 4, "count", "Gauss quadrature points"],
      ["dofsPerNode", 3, "count", "Translational DOFs per node"],
      ["E", 210e9, "Pa", "Reference Young's modulus"],
      ["nu", 0.3, "1", "Reference Poisson's ratio"],
    ],
  },
  {
    cardType: "CBEAM_NASTRAN",
    aliases: ["CBEAM", "CBAR"],
    label: "NASTRAN 3D Tapered Beam (CBEAM)",
    category: "Shell / Beam Element",
    archetypeId: FeaArchetypeId.BEAM_ELEM,
    description: "NASTRAN 2-node 3D Timoshenko/Euler-Bernoulli beam element with shear center offset and warping.",
    provenance:
      "Bathe, Finite Element Procedures (2nd Ed.), Ch. 5.4; Przemieniecki, Theory of Matrix Structural Analysis",
    params: [
      ["area", 1e-3, "m2", "Cross-sectional area A"],
      ["I1", 8.33e-8, "m4", "Area moment of inertia in plane 1"],
      ["I2", 8.33e-8, "m4", "Area moment of inertia in plane 2"],
      ["J", 1.41e-7, "m4", "Torsional constant J"],
      ["E", 210e9, "Pa", "Young's modulus"],
      ["nu", 0.3, "1", "Poisson's ratio"],
      ["length", 1.0, "m", "Reference beam length"],
    ],
  },
  {
    cardType: "RBE2_RIGID",
    aliases: ["RBE2", "KINEMATIC_COUPLING"],
    label: "Rigid Body Kinematic Constraint (RBE2)",
    category: "Constraint / MPC",
    archetypeId: FeaArchetypeId.MPC_CONSTRAINT,
    description:
      "Rigid multi-point constraint coupling dependent slave DOFs kinematically to a single independent master node.",
    provenance: "Bathe, Finite Element Procedures (2nd Ed.), Ch. 4.2.2 (Lagrange Multiplier / Penalty MPCs)",
    params: [
      ["constrainedDofs", 6, "count", "Number of constrained DOFs (123456)"],
      ["slaveCount", 4, "count", "Number of dependent slave nodes"],
      ["penaltyStiffness", 1e14, "N/m", "Penalty stiffness multiplier"],
    ],
  },
  {
    cardType: "RBE3_INTERP",
    aliases: ["RBE3", "DISTRIBUTING_COUPLING"],
    label: "Weighted Interpolation Constraint (RBE3)",
    category: "Constraint / MPC",
    archetypeId: FeaArchetypeId.MPC_CONSTRAINT,
    description:
      "Distributing interpolation constraint relating a dependent reference node motion to weighted independent nodes without adding artificial stiffness.",
    provenance: "Zienkiewicz & Taylor, The Finite Element Method Vol. 1 (7th Ed.), Ch. 11 (Weighted MPCs)",
    params: [
      ["constrainedDofs", 6, "count", "Number of interpolated DOFs"],
      ["weightSum", 1.0, "1", "Normalized sum of nodal distribution weights"],
      ["referenceRadius", 0.1, "m", "Characteristic cloud radius"],
    ],
  },

  // =========================================================================
  // Constitutive Material & Section Cards (13)
  // =========================================================================
  {
    cardType: "MAT1_ISOTROPIC",
    aliases: ["MAT1"],
    label: "NASTRAN Isotropic Elastic Material (MAT1)",
    category: "Elastic Material",
    archetypeId: FeaArchetypeId.MAT_ISOTROPIC,
    description:
      "3D linear isotropic Hooke's law constitutive card parameterized by Young's modulus E, Poisson's ratio nu, and Lamé constants.",
    provenance: "Zienkiewicz & Taylor, The Finite Element Method Vol. 1 (7th Ed.), Ch. 2; Bathe Ch. 4",
    params: [
      ["E", 210e9, "Pa", "Young's modulus E"],
      ["nu", 0.3, "1", "Poisson's ratio nu"],
      ["G", 80.769230769e9, "Pa", "Shear modulus G = E / (2*(1+nu))"],
      ["rho", 7850.0, "kg/m3", "Mass density"],
      ["alpha", 1.2e-5, "1/K", "Thermal expansion coefficient"],
    ],
  },
  {
    cardType: "MAT8_ORTHOTROPIC",
    aliases: ["MAT8"],
    label: "NASTRAN Shell Orthotropic Material (MAT8)",
    category: "Elastic Material",
    archetypeId: FeaArchetypeId.MAT_ORTHOTROPIC,
    description: "2D plane-stress orthotropic constitutive law for composite laminae with reduced stiffness matrix Q.",
    provenance: "Jones, Mechanics of Composite Materials (2nd Ed.), Ch. 2 (Plane Stress Orthotropic Lamina)",
    params: [
      ["E1", 140e9, "Pa", "Longitudinal Young's modulus E1"],
      ["E2", 10e9, "Pa", "Transverse Young's modulus E2"],
      ["nu12", 0.3, "1", "Major Poisson's ratio nu12"],
      ["G12", 5e9, "Pa", "In-plane shear modulus G12"],
      ["G1Z", 5e9, "Pa", "Transverse shear modulus G1Z"],
      ["G2Z", 3e9, "Pa", "Transverse shear modulus G2Z"],
      ["rho", 1600.0, "kg/m3", "Mass density"],
    ],
  },
  {
    cardType: "MAT9_ANISOTROPIC",
    aliases: ["MAT9"],
    label: "NASTRAN 3D Anisotropic Material (MAT9)",
    category: "Elastic Material",
    archetypeId: FeaArchetypeId.MAT_ANISOTROPIC,
    description: "General symmetric 6x6 3D anisotropic linear elastic constitutive stiffness matrix.",
    provenance: "Jones, Mechanics of Composite Materials (2nd Ed.), Ch. 2; Bathe Ch. 4.2",
    params: [
      ["G11", 160e9, "Pa", "Stiffness entry C11"],
      ["G12", 60e9, "Pa", "Stiffness entry C12"],
      ["G13", 60e9, "Pa", "Stiffness entry C13"],
      ["G22", 160e9, "Pa", "Stiffness entry C22"],
      ["G23", 60e9, "Pa", "Stiffness entry C23"],
      ["G33", 160e9, "Pa", "Stiffness entry C33"],
      ["G44", 50e9, "Pa", "Shear stiffness C44"],
      ["G55", 50e9, "Pa", "Shear stiffness C55"],
      ["G66", 50e9, "Pa", "Shear stiffness C66"],
    ],
  },
  {
    cardType: "ABQ_ELASTIC",
    aliases: ["*ELASTIC", "ELASTIC"],
    label: "Abaqus Linear Elastic (*ELASTIC)",
    category: "Elastic Material",
    archetypeId: FeaArchetypeId.MAT_ISOTROPIC,
    description: "Abaqus isotropic linear elastic constitutive card evaluating 3D Cauchy stress and Lamé parameters.",
    provenance: "Bathe, Finite Element Procedures (2nd Ed.), Ch. 4; Zienkiewicz & Taylor Vol. 1, Ch. 2",
    params: [
      ["E", 210e9, "Pa", "Young's modulus E"],
      ["nu", 0.3, "1", "Poisson's ratio nu"],
    ],
  },
  {
    cardType: "ABQ_PLASTIC_J2",
    aliases: ["*PLASTIC", "PLASTIC", "MATS1"],
    label: "Abaqus J2 von Mises Plasticity (*PLASTIC)",
    category: "Plasticity / Creep",
    archetypeId: FeaArchetypeId.MAT_PLASTIC_J2,
    description:
      "Rate-independent J2 von Mises elastoplasticity with linear isotropic hardening and radial-return stress integration.",
    provenance: "Simo & Hughes, Computational Inelasticity (1998), Ch. 3 (J2 Radial Return Mapping Algorithm)",
    params: [
      ["E", 210e9, "Pa", "Young's modulus E"],
      ["nu", 0.3, "1", "Poisson's ratio nu"],
      ["sigmaY0", 250e6, "Pa", "Initial uniaxial yield stress sigma_y0"],
      ["H", 2e9, "Pa", "Linear isotropic hardening modulus H"],
    ],
  },
  {
    cardType: "ABQ_HYPERELASTIC_NEO_HOOKE",
    aliases: ["*HYPERELASTIC, NEO HOOKE", "NEO_HOOKE", "MATHP_NH"],
    label: "Neo-Hookean Hyperelastic (*HYPERELASTIC)",
    category: "Hyperelastic Material",
    archetypeId: FeaArchetypeId.MAT_HYPER_NEO_HOOKE,
    description:
      "Nearly-incompressible Neo-Hookean hyperelastic strain energy potential W = C10*(I1 - 3) + (1/D1)*(J - 1)^2.",
    provenance: "Holzapfel, Nonlinear Solid Mechanics (2000), Ch. 6.5 (Neo-Hookean Hyperelasticity)",
    params: [
      ["C10", 0.5e6, "Pa", "Neo-Hookean shear parameter C10 = mu0 / 2"],
      ["D1", 1e-8, "1/Pa", "Incompressibility parameter D1 = 2 / K0"],
    ],
  },
  {
    cardType: "ABQ_HYPERELASTIC_MOONEY_RIVLIN",
    aliases: ["*HYPERELASTIC, MOONEY-RIVLIN", "MOONEY_RIVLIN", "MATHP_MR"],
    label: "Mooney-Rivlin Hyperelastic (*HYPERELASTIC)",
    category: "Hyperelastic Material",
    archetypeId: FeaArchetypeId.MAT_HYPER_MOONEY_RIVLIN,
    description: "Two-parameter Mooney-Rivlin hyperelastic strain energy potential W = C10*(I1 - 3) + C01*(I2 - 3).",
    provenance: "Holzapfel, Nonlinear Solid Mechanics (2000), Ch. 6.5 (Mooney-Rivlin Model)",
    params: [
      ["C10", 0.4e6, "Pa", "First invariant coefficient C10"],
      ["C01", 0.1e6, "Pa", "Second invariant coefficient C01"],
      ["D1", 1e-8, "1/Pa", "Incompressibility parameter D1 = 2 / K0"],
    ],
  },
  {
    cardType: "ABQ_CREEP_NORTON",
    aliases: ["*CREEP", "CREEP", "NORTON"],
    label: "Norton Power-Law Creep (*CREEP)",
    category: "Plasticity / Creep",
    archetypeId: FeaArchetypeId.MAT_CREEP_NORTON,
    description: "Secondary steady-state Norton power-law creep constitutive equation d(eps_c)/dt = A * sigma_eq^n.",
    provenance: "Simo & Hughes, Computational Inelasticity (1998), Ch. 2; Boyle & Spence, Stress Analysis for Creep",
    params: [
      ["A", 1e-36, "Pa^-n/s", "Norton creep pre-exponential multiplier A"],
      ["n", 4.0, "1", "Norton stress exponent n"],
      ["m", 0.0, "1", "Time-hardening exponent m"],
      ["E", 200e9, "Pa", "Reference elastic modulus E"],
      ["nu", 0.3, "1", "Reference Poisson's ratio nu"],
    ],
  },
  {
    cardType: "ABQ_DENSITY",
    aliases: ["*DENSITY", "DENSITY"],
    label: "Abaqus Mass Density (*DENSITY)",
    category: "Thermal / Physical",
    archetypeId: FeaArchetypeId.MAT_DENSITY,
    description:
      "Mass density specification for consistent and lumped mass matrix assembly in modal and dynamic analyses.",
    provenance: "Bathe, Finite Element Procedures (2nd Ed.), Ch. 4.2.1 (Mass Matrix Formulation)",
    params: [["rho", 7850.0, "kg/m3", "Mass density rho"]],
  },
  {
    cardType: "ABQ_EXPANSION",
    aliases: ["*EXPANSION", "EXPANSION"],
    label: "Abaqus Thermal Expansion (*EXPANSION)",
    category: "Thermal / Physical",
    archetypeId: FeaArchetypeId.MAT_EXPANSION,
    description:
      "Isotropic secant thermal expansion coefficient generating thermal strain eps_th = alpha * (T - T_ref).",
    provenance: "Zienkiewicz & Taylor, The Finite Element Method Vol. 1 (7th Ed.), Ch. 2.2 (Initial Thermal Strains)",
    params: [
      ["alpha", 1.2e-5, "1/K", "Coefficient of thermal expansion alpha"],
      ["tRef", 20.0, "C", "Reference zero-thermal-strain temperature T_ref"],
    ],
  },
  {
    cardType: "PCOMP_LAMINATE",
    aliases: ["PCOMP", "PCOMPG", "*SHELL SECTION, COMPOSITE"],
    label: "Composite Laminate Property (PCOMP)",
    category: "Section / Laminate",
    archetypeId: FeaArchetypeId.SEC_LAMINATE,
    description:
      "Classical Laminate Theory (CLT) multi-ply composite shell section computing transformed stiffness Q_bar and extensional [A] matrix.",
    provenance: "Jones, Mechanics of Composite Materials (2nd Ed.), Ch. 4 (Classical Lamination Theory)",
    params: [
      ["E1", 140e9, "Pa", "Ply longitudinal modulus E1"],
      ["E2", 10e9, "Pa", "Ply transverse modulus E2"],
      ["nu12", 0.3, "1", "Ply major Poisson's ratio nu12"],
      ["G12", 5e9, "Pa", "Ply in-plane shear modulus G12"],
      ["plyThickness", 0.000125, "m", "Individual ply thickness t_k"],
      ["plyAngleDeg", 0.0, "deg", "Ply fiber orientation angle theta"],
      ["numPlies", 8, "count", "Total number of plies in laminate"],
    ],
  },
  {
    cardType: "PSHELL_SECTION",
    aliases: ["PSHELL", "*SHELL SECTION"],
    label: "Shell Section Property (PSHELL)",
    category: "Section / Laminate",
    archetypeId: FeaArchetypeId.SEC_SHELL,
    description:
      "Homogeneous plate/shell section property defining membrane thickness t and flexural rigidity D = E*t^3 / (12*(1-nu^2)).",
    provenance: "Zienkiewicz & Taylor, The Finite Element Method Vol. 2 (7th Ed.), Ch. 13 (Plate Bending)",
    params: [
      ["thickness", 0.01, "m", "Shell thickness t"],
      ["E", 210e9, "Pa", "Reference elastic modulus E"],
      ["nu", 0.3, "1", "Reference Poisson's ratio nu"],
      ["bendingRatio", 1.0, "1", "Bending stiffness inertia ratio 12I/t^3"],
      ["shearRatio", 0.8333333333, "1", "Transverse shear thickness ratio ts/t"],
    ],
  },
  {
    cardType: "PSOLID_SECTION",
    aliases: ["PSOLID", "*SOLID SECTION"],
    label: "Solid Continuum Section (PSOLID)",
    category: "Section / Laminate",
    archetypeId: FeaArchetypeId.SEC_SOLID,
    description:
      "3D solid continuum section property binding solid elements to a constitutive material and integration scheme.",
    provenance: "Bathe, Finite Element Procedures (2nd Ed.), Ch. 5 (Isoparametric Solid Elements)",
    params: [
      ["E", 210e9, "Pa", "Reference elastic modulus E"],
      ["nu", 0.3, "1", "Reference Poisson's ratio nu"],
      ["integrationOrder", 2, "count", "Gauss integration order per axis"],
    ],
  },
];

/**
 * Converts `FEA_CARD_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildFeaCleanroomSchemas(): CleanroomModelSchema[] {
  return FEA_CARD_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `fea:${spec.cardType}`,
      name: spec.cardType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "structural",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "fea_std_card",
      width: 80,
      height: 48,
      svg: generateFeaBlockSvg(spec.cardType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.cardType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
