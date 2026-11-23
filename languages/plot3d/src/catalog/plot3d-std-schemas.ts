// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * PLOT3D cleanroom standard library archetype IDs matching `assets/plot3d-std-lib/src/models.ts`.
 */
export const Plot3dArchetypeId = {
  GRID_3D: 1,
  SOLUTION_Q: 2,
  FUNCTION_F: 3,
  ISENTROPIC_NOZZLE: 4,
  FLAT_PLATE_MESH: 5,
} as const;

export type Plot3dArchetypeId = (typeof Plot3dArchetypeId)[keyof typeof Plot3dArchetypeId];

export type Plot3dSchemaCategory = "Structured Grids" | "Flow Solutions" | "CFD Benchmarks";

export interface Plot3dModelSpec {
  name: string;
  aliases?: string[];
  label: string;
  category: Plot3dSchemaCategory;
  archetypeId: Plot3dArchetypeId;
  description: string;
  provenance: string;
  ports: DiagramPortSpec[];
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<Plot3dSchemaCategory, { fill: string; stroke: string; badge: string }> = {
  "Structured Grids": { fill: "#172554", stroke: "#38bdf8", badge: "GRID" },
  "Flow Solutions": { fill: "#1e1b4b", stroke: "#a78bfa", badge: "FLOW" },
  "CFD Benchmarks": { fill: "#14532d", stroke: "#4ade80", badge: "BNCH" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a PLOT3D schema.
 */
export function generatePlot3dBlockSvg(name: string, category: Plot3dSchemaCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = name.slice(0, 12);
  const fontSize = label.length > 9 ? "8.0" : "9.2";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 54" width="96" height="54">` +
    `<rect x="2" y="2" width="92" height="50" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="37" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

const PLOT3D_MODEL_SPECS: Plot3dModelSpec[] = [
  {
    name: "Grid3D",
    aliases: ["XYZ", "PLOT3D_GRID", "StructuredGrid3D"],
    label: "3D Multi-Block Grid (.xyz)",
    category: "Structured Grids",
    archetypeId: Plot3dArchetypeId.GRID_3D,
    description:
      "NASA Ames PLOT3D 3D structured multi-block curvilinear grid (.xyz/.g) in Fortran column-major i-fastest storage.",
    provenance: "NASA TM-101067 / Walatka et al. (1990) PLOT3D User's Manual",
    ports: [
      { name: "mesh_out", kind: "fluid", side: "right", dx: 96, dy: 27 },
      { name: "metrics", kind: "signal", side: "bottom", dx: 48, dy: 54 },
    ],
    params: [
      ["ni", 21, "1", "Number of grid points in I-direction"],
      ["nj", 11, "1", "Number of grid points in J-direction"],
      ["nk", 11, "1", "Number of grid points in K-direction"],
      ["lx", 1.0, "m", "Domain length in X"],
      ["ly", 0.5, "m", "Domain height in Y"],
      ["lz", 0.5, "m", "Domain span in Z"],
    ],
  },
  {
    name: "SolutionQ",
    aliases: ["QFILE", "PLOT3D_Q", "ConservativeSolution"],
    label: "Conservative Solution (.q)",
    category: "Flow Solutions",
    archetypeId: Plot3dArchetypeId.SOLUTION_Q,
    description:
      "NASA Ames PLOT3D conservative CFD solution file (.q) storing FSMACH, ALPHA, RE, TIME and (rho, rhou, rhov, rhow, e).",
    provenance: "NASA TM-101067 / Walatka et al. (1990) PLOT3D User's Manual",
    ports: [
      { name: "mesh_in", kind: "fluid", side: "left", dx: 0, dy: 27 },
      { name: "flow_out", kind: "fluid", side: "right", dx: 96, dy: 27 },
    ],
    params: [
      ["fsmach", 0.8, "1", "Freestream Mach number"],
      ["alpha", 0.0, "deg", "Angle of attack"],
      ["re", 1.0e6, "1", "Freestream Reynolds number"],
      ["time", 0.0, "s", "Simulation time"],
      ["gamma", 1.4, "1", "Ratio of specific heats"],
      ["pRef", 101325.0, "Pa", "Reference static pressure"],
    ],
  },
  {
    name: "FunctionF",
    aliases: ["FFILE", "PLOT3D_F", "FunctionField"],
    label: "Scalar Function File (.f)",
    category: "Flow Solutions",
    archetypeId: Plot3dArchetypeId.FUNCTION_F,
    description: "NASA Ames PLOT3D auxiliary scalar/vector function file (.f) paired with variable names (.nam).",
    provenance: "NASA TM-101067 / Walatka et al. (1990) PLOT3D User's Manual",
    ports: [
      { name: "mesh_in", kind: "fluid", side: "left", dx: 0, dy: 27 },
      { name: "fields_out", kind: "signal", side: "right", dx: 96, dy: 27 },
    ],
    params: [
      ["nVars", 3, "1", "Number of auxiliary function variables"],
      ["ni", 21, "1", "I-dimension"],
      ["nj", 11, "1", "J-dimension"],
      ["nk", 11, "1", "K-dimension"],
    ],
  },
  {
    name: "IsentropicNozzle",
    aliases: ["Nozzle3D", "ConvergingDivergingNozzle"],
    label: "Isentropic C-D Nozzle",
    category: "CFD Benchmarks",
    archetypeId: Plot3dArchetypeId.ISENTROPIC_NOZZLE,
    description:
      "Quasi-1D / 3D structured converging-diverging nozzle benchmark verifying isentropic Mach, total pressure ratio, and mass conservation.",
    provenance: "Anderson (Modern Compressible Flow) / NASA TMR Verification",
    ports: [
      { name: "inlet", kind: "fluid", side: "left", dx: 0, dy: 27 },
      { name: "outlet", kind: "fluid", side: "right", dx: 96, dy: 27 },
    ],
    params: [
      ["length", 1.0, "m", "Nozzle axial length"],
      ["throatArea", 0.1, "m2", "Throat cross-sectional area A*"],
      ["areaRatioMax", 2.2, "1", "Inlet/Exit to throat area ratio"],
      ["p0", 500000.0, "Pa", "Stagnation pressure"],
      ["t0", 300.0, "K", "Stagnation temperature"],
      ["gamma", 1.4, "1", "Ratio of specific heats"],
    ],
  },
  {
    name: "FlatPlateMesh",
    aliases: ["FlatPlate", "BoundaryLayerMesh"],
    label: "Flat Plate Boundary Layer Mesh",
    category: "CFD Benchmarks",
    archetypeId: Plot3dArchetypeId.FLAT_PLATE_MESH,
    description:
      "NASA Turbulence Modeling Resource (TMR) 2D/3D stretched structured flat-plate mesh with wall-normal clustering.",
    provenance: "NASA Langley Turbulence Modeling Resource (TMR) 2DZP Flat Plate",
    ports: [
      { name: "inflow", kind: "fluid", side: "left", dx: 0, dy: 27 },
      { name: "outflow", kind: "fluid", side: "right", dx: 96, dy: 27 },
      { name: "wall", kind: "mechanical", side: "bottom", dx: 48, dy: 54 },
    ],
    params: [
      ["ni", 65, "1", "Streamwise grid nodes"],
      ["nj", 49, "1", "Wall-normal grid nodes"],
      ["nk", 2, "1", "Spanwise grid nodes"],
      ["plateLength", 2.0, "m", "Flat plate length L"],
      ["domainHeight", 1.0, "m", "Farfield height H"],
      ["stretchingRatio", 1.15, "1", "Wall-normal geometric stretching ratio"],
    ],
  },
];

/**
 * Builds the declarative cleanroom `CleanroomModelSchema[]` catalog for `@modelscript/plot3d-std-lib`.
 */
export function buildPlot3dCleanroomSchemas(): CleanroomModelSchema[] {
  return PLOT3D_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `Plot3d.${spec.name}`,
      name: spec.name,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "cfd",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 96,
      height: 54,
      svg: generatePlot3dBlockSvg(spec.name, spec.category),
      ports: spec.ports,
      parameters,
      wasmKernel: "plot3dEvalArchetype",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
