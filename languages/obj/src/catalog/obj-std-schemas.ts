// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/obj — Cleanroom Wavefront OBJ Primitives & Engineering MTL Material Schemas.
 */

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom archetype IDs matching `assets/obj-std-lib/src/models.ts`.
 */
export const ObjArchetypeId = {
  // Geometric Primitives
  UNIT_CUBE: 1,
  TETRAHEDRON: 2,
  OCTAHEDRON: 3,
  CYLINDER: 4,
  UV_SPHERE: 5,
  TORUS: 6,
  QUAD_PLANE: 7,
  PYRAMID: 8,
  // Engineering MTL Materials
  MTL_ALUMINUM: 101,
  MTL_STEEL: 102,
  MTL_COPPER: 103,
  MTL_GLASS: 104,
  MTL_MATTE_WHITE: 105,
} as const;

export type ObjArchetypeId = (typeof ObjArchetypeId)[keyof typeof ObjArchetypeId];

export type ObjSchemaCategory = "Geometry Primitives" | "Engineering Materials";

export interface ObjSchemaSpec {
  modelType: string;
  aliases: string[];
  label: string;
  category: ObjSchemaCategory;
  archetypeId: ObjArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<ObjSchemaCategory, { fill: string; stroke: string; badge: string }> = {
  "Geometry Primitives": { fill: "#1e3a5f", stroke: "#38bdf8", badge: "MESH" },
  "Engineering Materials": { fill: "#2e2447", stroke: "#c084fc", badge: "MTL" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an OBJ primitive or MTL material schema.
 */
export function generateObjBlockSvg(modelType: string, category: ObjSchemaCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 11);
  const fontSize = label.length > 9 ? "7.8" : "9.2";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 52" width="92" height="52">` +
    `<rect x="2" y="2" width="88" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="46" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: ObjSchemaCategory): DiagramPortSpec[] {
  if (category === "Engineering Materials") {
    return [
      { name: "surface_in", kind: "material", side: "left", dx: 0, dy: 26 },
      { name: "shaded_out", kind: "material", side: "right", dx: 92, dy: 26 },
    ];
  }
  return [
    { name: "material_in", kind: "material", side: "left", dx: 0, dy: 26 },
    { name: "mesh_out", kind: "geometry", side: "right", dx: 92, dy: 26 },
  ];
}

export const OBJ_STANDARD_SPECS: ObjSchemaSpec[] = [
  // ── Geometry Primitives ──────────────────────────────────────────────────
  {
    modelType: "UnitCube",
    aliases: ["Cube", "Box", "OBJ_CUBE"],
    label: "Unit Cube (6 Quads / 12 Triangles)",
    category: "Geometry Primitives",
    archetypeId: ObjArchetypeId.UNIT_CUBE,
    description:
      "Watertight 1x1x1 axis-aligned cube with 8 vertices, 6 quad faces (12 triangles), area A=6, volume V=1, χ=2.",
    provenance: "Wavefront Technologies OBJ Specification (1980s)",
    params: [
      ["sizeX", 1.0, "m", "Cube width along X"],
      ["sizeY", 1.0, "m", "Cube height along Y"],
      ["sizeZ", 1.0, "m", "Cube depth along Z"],
    ],
  },
  {
    modelType: "Tetrahedron",
    aliases: ["Tet", "OBJ_TETRAHEDRON"],
    label: "Regular Tetrahedron (4 Triangles)",
    category: "Geometry Primitives",
    archetypeId: ObjArchetypeId.TETRAHEDRON,
    description: "Closed regular tetrahedron with 4 vertices, 4 triangular faces, 6 edges, χ=2.",
    provenance: "Wavefront Technologies OBJ Specification (1980s)",
    params: [["edgeLength", 1.0, "m", "Tetrahedron edge length"]],
  },
  {
    modelType: "Octahedron",
    aliases: ["Oct", "OBJ_OCTAHEDRON"],
    label: "Regular Octahedron (8 Triangles)",
    category: "Geometry Primitives",
    archetypeId: ObjArchetypeId.OCTAHEDRON,
    description: "Closed regular octahedron with 6 vertices, 8 triangular faces, 12 edges, χ=2.",
    provenance: "Wavefront Technologies OBJ Specification (1980s)",
    params: [["radius", 1.0, "m", "Vertex circumradius"]],
  },
  {
    modelType: "Cylinder",
    aliases: ["Cyl", "OBJ_CYLINDER"],
    label: "Faceted Cylinder",
    category: "Geometry Primitives",
    archetypeId: ObjArchetypeId.CYLINDER,
    description: "Closed faceted cylinder with configurable radius, height, and radial segments.",
    provenance: "Wavefront Technologies OBJ Specification (1980s)",
    params: [
      ["radius", 0.5, "m", "Cylinder radius"],
      ["height", 1.0, "m", "Cylinder height"],
      ["segments", 24, "1", "Radial tessellation segments"],
    ],
  },
  {
    modelType: "UVSphere",
    aliases: ["Sphere", "OBJ_SPHERE"],
    label: "UV Sphere",
    category: "Geometry Primitives",
    archetypeId: ObjArchetypeId.UV_SPHERE,
    description: "Closed latitude-longitude UV sphere mesh with smooth vertex normals.",
    provenance: "Wavefront Technologies OBJ Specification (1980s)",
    params: [
      ["radius", 0.5, "m", "Sphere radius"],
      ["rings", 12, "1", "Latitude rings"],
      ["sectors", 24, "1", "Longitude sectors"],
    ],
  },
  {
    modelType: "Torus",
    aliases: ["Ring", "OBJ_TORUS"],
    label: "Torus (Genus-1, χ=0)",
    category: "Geometry Primitives",
    archetypeId: ObjArchetypeId.TORUS,
    description: "Closed genus-1 torus mesh with Euler characteristic χ=0.",
    provenance: "Wavefront Technologies OBJ Specification (1980s)",
    params: [
      ["majorRadius", 1.0, "m", "Major ring radius"],
      ["minorRadius", 0.25, "m", "Tube minor radius"],
      ["majorSegments", 24, "1", "Major ring segments"],
      ["minorSegments", 12, "1", "Minor tube segments"],
    ],
  },
  {
    modelType: "QuadPlane",
    aliases: ["Plane", "Quad", "OBJ_PLANE"],
    label: "Planar Quad Patch",
    category: "Geometry Primitives",
    archetypeId: ObjArchetypeId.QUAD_PLANE,
    description: "Single planar quad face with UV texture coordinates and upward normal.",
    provenance: "Wavefront Technologies OBJ Specification (1980s)",
    params: [
      ["width", 1.0, "m", "Plane width"],
      ["depth", 1.0, "m", "Plane depth"],
    ],
  },
  {
    modelType: "Pyramid",
    aliases: ["SquarePyramid", "OBJ_PYRAMID"],
    label: "Square-Base Pyramid",
    category: "Geometry Primitives",
    archetypeId: ObjArchetypeId.PYRAMID,
    description: "Closed square-base pyramid with 5 vertices, 1 quad base + 4 triangular sides (6 triangles).",
    provenance: "Wavefront Technologies OBJ Specification (1980s)",
    params: [
      ["baseWidth", 1.0, "m", "Square base width"],
      ["height", 1.0, "m", "Pyramid apex height"],
    ],
  },

  // ── Engineering MTL Materials ────────────────────────────────────────────
  {
    modelType: "Aluminum",
    aliases: ["MTL_Aluminum", "Al6061"],
    label: "Brushed Aluminum (MTL)",
    category: "Engineering Materials",
    archetypeId: ObjArchetypeId.MTL_ALUMINUM,
    description:
      "Engineering brushed aluminum alloy (Al 6061-T6) with metallic specular reflection (illum 2, ρ = 2700 kg/m³).",
    provenance: "Wavefront MTL Engineering Material Library",
    params: [
      ["Kd_r", 0.77, "1", "Diffuse red"],
      ["Kd_g", 0.79, "1", "Diffuse green"],
      ["Kd_b", 0.82, "1", "Diffuse blue"],
      ["Ks_r", 0.91, "1", "Specular red"],
      ["Ks_g", 0.92, "1", "Specular green"],
      ["Ks_b", 0.92, "1", "Specular blue"],
      ["Ns", 250.0, "1", "Specular exponent"],
      ["d", 1.0, "1", "Dissolve (opacity)"],
      ["Ni", 1.44, "1", "Optical density"],
      ["illum", 2, "1", "Illumination model"],
      ["density", 2700.0, "kg/m3", "Mass density"],
    ],
  },
  {
    modelType: "Steel",
    aliases: ["MTL_Steel", "StainlessSteel", "AISI304"],
    label: "Stainless Steel (MTL)",
    category: "Engineering Materials",
    archetypeId: ObjArchetypeId.MTL_STEEL,
    description: "Engineering stainless steel (AISI 304) with crisp metallic highlight (illum 2, ρ = 7850 kg/m³).",
    provenance: "Wavefront MTL Engineering Material Library",
    params: [
      ["Kd_r", 0.54, "1", "Diffuse red"],
      ["Kd_g", 0.56, "1", "Diffuse green"],
      ["Kd_b", 0.59, "1", "Diffuse blue"],
      ["Ks_r", 0.8, "1", "Specular red"],
      ["Ks_g", 0.8, "1", "Specular green"],
      ["Ks_b", 0.82, "1", "Specular blue"],
      ["Ns", 320.0, "1", "Specular exponent"],
      ["d", 1.0, "1", "Dissolve (opacity)"],
      ["Ni", 2.5, "1", "Optical density"],
      ["illum", 2, "1", "Illumination model"],
      ["density", 7850.0, "kg/m3", "Mass density"],
    ],
  },
  {
    modelType: "Copper",
    aliases: ["MTL_Copper", "Cu"],
    label: "Polished Copper (MTL)",
    category: "Engineering Materials",
    archetypeId: ObjArchetypeId.MTL_COPPER,
    description: "Engineering electrolytic copper with warm reddish-orange specular sheen (illum 2, ρ = 8960 kg/m³).",
    provenance: "Wavefront MTL Engineering Material Library",
    params: [
      ["Kd_r", 0.85, "1", "Diffuse red"],
      ["Kd_g", 0.45, "1", "Diffuse green"],
      ["Kd_b", 0.3, "1", "Diffuse blue"],
      ["Ks_r", 0.95, "1", "Specular red"],
      ["Ks_g", 0.64, "1", "Specular green"],
      ["Ks_b", 0.54, "1", "Specular blue"],
      ["Ns", 200.0, "1", "Specular exponent"],
      ["d", 1.0, "1", "Dissolve (opacity)"],
      ["Ni", 1.1, "1", "Optical density"],
      ["illum", 2, "1", "Illumination model"],
      ["density", 8960.0, "kg/m3", "Mass density"],
    ],
  },
  {
    modelType: "Glass",
    aliases: ["MTL_Glass", "BorosilicateGlass"],
    label: "Clear Optical Glass (MTL)",
    category: "Engineering Materials",
    archetypeId: ObjArchetypeId.MTL_GLASS,
    description:
      "Transparent borosilicate glass with Fresnel refraction (Ni = 1.52, d = 0.25, illum 4, ρ = 2230 kg/m³).",
    provenance: "Wavefront MTL Engineering Material Library",
    params: [
      ["Kd_r", 0.88, "1", "Diffuse red"],
      ["Kd_g", 0.95, "1", "Diffuse green"],
      ["Kd_b", 0.98, "1", "Diffuse blue"],
      ["Ks_r", 0.95, "1", "Specular red"],
      ["Ks_g", 0.95, "1", "Specular green"],
      ["Ks_b", 0.95, "1", "Specular blue"],
      ["Ns", 600.0, "1", "Specular exponent"],
      ["d", 0.25, "1", "Dissolve (opacity)"],
      ["Ni", 1.52, "1", "Optical density (IOR)"],
      ["illum", 4, "1", "Illumination model (glass transparency)"],
      ["density", 2230.0, "kg/m3", "Mass density"],
    ],
  },
  {
    modelType: "MatteWhite",
    aliases: ["MTL_MatteWhite", "Matte_White", "LambertianWhite"],
    label: "Matte White Plaster (MTL)",
    category: "Engineering Materials",
    archetypeId: ObjArchetypeId.MTL_MATTE_WHITE,
    description: "Diffuse Lambertian matte white reference coating (illum 1, zero specular gloss, ρ = 1200 kg/m³).",
    provenance: "Wavefront MTL Engineering Material Library",
    params: [
      ["Kd_r", 0.92, "1", "Diffuse red"],
      ["Kd_g", 0.92, "1", "Diffuse green"],
      ["Kd_b", 0.9, "1", "Diffuse blue"],
      ["Ks_r", 0.05, "1", "Specular red"],
      ["Ks_g", 0.05, "1", "Specular green"],
      ["Ks_b", 0.05, "1", "Specular blue"],
      ["Ns", 10.0, "1", "Specular exponent"],
      ["d", 1.0, "1", "Dissolve (opacity)"],
      ["Ni", 1.0, "1", "Optical density"],
      ["illum", 1, "1", "Illumination model (diffuse only)"],
      ["density", 1200.0, "kg/m3", "Mass density"],
    ],
  },
];

/**
 * Generates a ready-to-use Wavefront MTL library string containing all 5 standard engineering materials.
 */
export function generateStandardEngineeringMtl(): string {
  return [
    "# Standard Engineering Wavefront MTL Library (@modelscript/obj)",
    "",
    "newmtl Aluminum",
    "Ka 0.20 0.21 0.22",
    "Kd 0.77 0.79 0.82",
    "Ks 0.91 0.92 0.92",
    "Ns 250.0",
    "d 1.0",
    "Ni 1.44",
    "illum 2",
    "",
    "newmtl Steel",
    "Ka 0.14 0.15 0.16",
    "Kd 0.54 0.56 0.59",
    "Ks 0.80 0.80 0.82",
    "Ns 320.0",
    "d 1.0",
    "Ni 2.50",
    "illum 2",
    "",
    "newmtl Copper",
    "Ka 0.22 0.11 0.07",
    "Kd 0.85 0.45 0.30",
    "Ks 0.95 0.64 0.54",
    "Ns 200.0",
    "d 1.0",
    "Ni 1.10",
    "illum 2",
    "",
    "newmtl Glass",
    "Ka 0.10 0.12 0.14",
    "Kd 0.88 0.95 0.98",
    "Ks 0.95 0.95 0.95",
    "Ns 600.0",
    "d 0.25",
    "Ni 1.52",
    "illum 4",
    "",
    "newmtl MatteWhite",
    "Ka 0.20 0.20 0.20",
    "Kd 0.92 0.92 0.90",
    "Ks 0.05 0.05 0.05",
    "Ns 10.0",
    "d 1.0",
    "Ni 1.00",
    "illum 1",
    "",
  ].join("\n");
}

/**
 * Build declarative `CleanroomModelSchema[]` entries for `@modelscript/obj-std-lib`.
 */
export function buildObjCleanroomSchemas(): CleanroomModelSchema[] {
  return OBJ_STANDARD_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      label: key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `ObjStd.${spec.category.replace(/[^A-Za-z0-9]/g, "")}.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "cad",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: spec.category === "Engineering Materials" ? "material" : "mesh",
      width: 92,
      height: 52,
      svg: generateObjBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: "objEvalKernel",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
