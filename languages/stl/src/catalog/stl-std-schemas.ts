// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";
import type { StlFacet, StlMeshDocument, Vec3 } from "../types.js";

/**
 * STL cleanroom analytical primitive archetype IDs matching `assets/stl-std-lib/src/models.ts`.
 */
export const StlArchetypeId = {
  UNIT_CUBE: 1,
  REGULAR_TETRAHEDRON: 2,
  OCTAHEDRON: 3,
  CYLINDER: 4,
  SPHERE_ICOSAHEDRON: 5,
} as const;

export type StlArchetypeId = (typeof StlArchetypeId)[keyof typeof StlArchetypeId];

export type StlModelCategory = "Polyhedra" | "Revolved Solids" | "Geodesic Meshes";

export interface StlPrimitiveSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: StlModelCategory;
  archetypeId: StlArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<StlModelCategory, { fill: string; stroke: string; badge: string }> = {
  Polyhedra: { fill: "#1e3a5f", stroke: "#38bdf8", badge: "POLY" },
  "Revolved Solids": { fill: "#163b3b", stroke: "#2dd4bf", badge: "REV" },
  "Geodesic Meshes": { fill: "#2e2447", stroke: "#c084fc", badge: "GEO" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an STL primitive.
 */
export function generateStlBlockSvg(modelType: string, category: StlModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  const fontSize = label.length > 8 ? "8.0" : "9.2";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

export const STL_PRIMITIVE_SPECS: readonly StlPrimitiveSpec[] = [
  {
    modelType: "UNIT_CUBE",
    aliases: ["cube", "box", "hexahedron"],
    label: "Unit Cube",
    category: "Polyhedra",
    archetypeId: StlArchetypeId.UNIT_CUBE,
    description:
      "Watertight 12-triangle axis-aligned cube [0, a]^3 with exact volume a^3, surface area 6a^2, and Euler chi = 2.",
    provenance: "3D Systems Stereolithography Specification (1987) / Platonic Solid Reference",
    params: [
      ["side", 1.0, "m", "Cube edge length"],
      ["density", 1.0, "kg/m^3", "Uniform material density"],
    ],
  },
  {
    modelType: "REGULAR_TETRAHEDRON",
    aliases: ["tetrahedron", "tet", "simplex"],
    label: "Tetrahedron",
    category: "Polyhedra",
    archetypeId: StlArchetypeId.REGULAR_TETRAHEDRON,
    description: "Watertight 4-triangle canonical tetrahedron with exact volume a^3 / 6 and Euler chi = 2.",
    provenance: "3D Systems Stereolithography Specification (1987) / Standard 3-Simplex",
    params: [
      ["scale", 1.0, "m", "Edge scale factor"],
      ["density", 1.0, "kg/m^3", "Uniform material density"],
    ],
  },
  {
    modelType: "OCTAHEDRON",
    aliases: ["regular_octahedron", "oct"],
    label: "Regular Octahedron",
    category: "Polyhedra",
    archetypeId: StlArchetypeId.OCTAHEDRON,
    description:
      "Watertight 8-triangle regular octahedron inscribed in radius R with exact volume (4/3) R^3 and Euler chi = 2.",
    provenance: "Platonic Solid Analytical Reference",
    params: [
      ["radius", 1.0, "m", "Vertex circumradius R"],
      ["density", 1.0, "kg/m^3", "Uniform material density"],
    ],
  },
  {
    modelType: "CYLINDER",
    aliases: ["cyl", "prism"],
    label: "Cylinder",
    category: "Revolved Solids",
    archetypeId: StlArchetypeId.CYLINDER,
    description: "Watertight tessellated right circular cylinder of radius R and height H along Z with Euler chi = 2.",
    provenance: "Analytical Solid Mechanics & CAD Tessellation Reference",
    params: [
      ["radius", 1.0, "m", "Cylinder radius"],
      ["height", 2.0, "m", "Cylinder height"],
      ["segments", 24, "1", "Circumferential facet segments"],
      ["density", 1.0, "kg/m^3", "Uniform material density"],
    ],
  },
  {
    modelType: "SPHERE_ICOSAHEDRON",
    aliases: ["icosphere", "sphere", "icosahedron"],
    label: "Icosphere",
    category: "Geodesic Meshes",
    archetypeId: StlArchetypeId.SPHERE_ICOSAHEDRON,
    description:
      "Watertight geodesic sphere built by subdividing a regular icosahedron of radius R with Euler chi = 2.",
    provenance: "Platonic Icosahedron & Geodesic Subdivision Reference",
    params: [
      ["radius", 1.0, "m", "Sphere radius"],
      ["subdivisions", 1, "1", "Geodesic subdivision level"],
      ["density", 1.0, "kg/m^3", "Uniform material density"],
    ],
  },
];

function defaultPorts(): DiagramPortSpec[] {
  return [
    { name: "mesh_out", kind: "mechanical", side: "right", dx: 88, dy: 26 },
    { name: "frame_in", kind: "mechanical", side: "left", dx: 0, dy: 26 },
  ];
}

/**
 * Builds cleanroom `CleanroomModelSchema[]` for `@modelscript/stl-std-lib`.
 */
export function buildStlCleanroomSchemas(): CleanroomModelSchema[] {
  return STL_PRIMITIVE_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `STL.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "cad",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 88,
      height: 52,
      svg: generateStlBlockSvg(spec.modelType, spec.category),
      ports: defaultPorts(),
      parameters,
      wasmKernel: "stlModelEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

// ── Analytical Watertight STL Primitive Builders ─────────────────────────

function makeFacet(v0: Vec3, v1: Vec3, v2: Vec3): StlFacet {
  const e1x = v1[0] - v0[0];
  const e1y = v1[1] - v0[1];
  const e1z = v1[2] - v0[2];
  const e2x = v2[0] - v0[0];
  const e2y = v2[1] - v0[1];
  const e2z = v2[2] - v0[2];
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz) || 1;
  return {
    normal: [nx / len, ny / len, nz / len],
    vertices: [v0, v1, v2],
  };
}

function wrapSolid(name: string, facets: StlFacet[]): StlMeshDocument {
  return {
    format: "ascii",
    header: name,
    solids: [{ name, closed: true, facets }],
    facets,
    errors: [],
  };
}

/**
 * Generates an exact watertight unit cube `[0, side]^3` (12 triangles, V = side^3, A = 6*side^2, chi = 2).
 */
export function buildUnitCubeStl(side = 1.0, name = "unit_cube"): StlMeshDocument {
  const s = side;
  const p000: Vec3 = [0, 0, 0];
  const p100: Vec3 = [s, 0, 0];
  const p110: Vec3 = [s, s, 0];
  const p010: Vec3 = [0, s, 0];
  const p001: Vec3 = [0, 0, s];
  const p101: Vec3 = [s, 0, s];
  const p111: Vec3 = [s, s, s];
  const p011: Vec3 = [0, s, s];

  const facets: StlFacet[] = [
    // -Z bottom
    makeFacet(p000, p010, p110),
    makeFacet(p000, p110, p100),
    // +Z top
    makeFacet(p001, p101, p111),
    makeFacet(p001, p111, p011),
    // -Y front
    makeFacet(p000, p100, p101),
    makeFacet(p000, p101, p001),
    // +Y back
    makeFacet(p010, p011, p111),
    makeFacet(p010, p111, p110),
    // -X left
    makeFacet(p000, p001, p011),
    makeFacet(p000, p011, p010),
    // +X right
    makeFacet(p100, p110, p111),
    makeFacet(p100, p111, p101),
  ];

  return wrapSolid(name, facets);
}

/**
 * Generates an exact watertight canonical 3-simplex tetrahedron with vertices
 * `(0,0,0), (s,0,0), (0,s,0), (0,0,s)` having exact volume `s^3 / 6` and Euler `chi = 2`.
 */
export function buildTetrahedronStl(scale = 1.0, name = "tetrahedron"): StlMeshDocument {
  const s = scale;
  const v0: Vec3 = [0, 0, 0];
  const vx: Vec3 = [s, 0, 0];
  const vy: Vec3 = [0, s, 0];
  const vz: Vec3 = [0, 0, s];

  const facets: StlFacet[] = [
    makeFacet(v0, vy, vx), // -Z face
    makeFacet(v0, vx, vz), // -Y face
    makeFacet(v0, vz, vy), // -X face
    makeFacet(vx, vy, vz), // +X+Y+Z slanted face
  ];

  return wrapSolid(name, facets);
}

/**
 * Generates a watertight regular octahedron with circumradius `radius` (8 triangles, V = 4/3 * R^3, chi = 2).
 */
export function buildOctahedronStl(radius = 1.0, name = "octahedron"): StlMeshDocument {
  const r = radius;
  const px: Vec3 = [r, 0, 0];
  const nx: Vec3 = [-r, 0, 0];
  const py: Vec3 = [0, r, 0];
  const ny: Vec3 = [0, -r, 0];
  const pz: Vec3 = [0, 0, r];
  const nz: Vec3 = [0, 0, -r];

  const facets: StlFacet[] = [
    makeFacet(px, py, pz),
    makeFacet(py, nx, pz),
    makeFacet(nx, ny, pz),
    makeFacet(ny, px, pz),
    makeFacet(py, px, nz),
    makeFacet(nx, py, nz),
    makeFacet(ny, nx, nz),
    makeFacet(px, ny, nz),
  ];

  return wrapSolid(name, facets);
}

/**
 * Generates a watertight tessellated cylinder along Z in `[0, height]` with `segments` sides.
 */
export function buildCylinderStl(radius = 1.0, height = 2.0, segments = 24, name = "cylinder"): StlMeshDocument {
  const n = Math.max(3, Math.floor(segments));
  const facets: StlFacet[] = [];
  const cBot: Vec3 = [0, 0, 0];
  const cTop: Vec3 = [0, 0, height];

  const botRing: Vec3[] = [];
  const topRing: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const theta = (2 * Math.PI * i) / n;
    const x = radius * Math.cos(theta);
    const y = radius * Math.sin(theta);
    botRing.push([x, y, 0]);
    topRing.push([x, y, height]);
  }

  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const b0 = botRing[i]!;
    const b1 = botRing[next]!;
    const t0 = topRing[i]!;
    const t1 = topRing[next]!;

    // Bottom cap (-Z)
    facets.push(makeFacet(cBot, b1, b0));
    // Top cap (+Z)
    facets.push(makeFacet(cTop, t0, t1));
    // Side quad (2 triangles)
    facets.push(makeFacet(b0, b1, t1));
    facets.push(makeFacet(b0, t1, t0));
  }

  return wrapSolid(name, facets);
}

/**
 * Generates a watertight icosahedron / subdivided geodesic sphere of circumradius `radius`.
 */
export function buildIcosphereStl(radius = 1.0, subdivisions = 0, name = "icosphere"): StlMeshDocument {
  const phi = (1 + Math.sqrt(5)) / 2;
  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [(v[0] / l) * radius, (v[1] / l) * radius, (v[2] / l) * radius];
  };

  let verts: Vec3[] = [
    norm([-1, phi, 0]),
    norm([1, phi, 0]),
    norm([-1, -phi, 0]),
    norm([1, -phi, 0]),
    norm([0, -1, phi]),
    norm([0, 1, phi]),
    norm([0, -1, -phi]),
    norm([0, 1, -phi]),
    norm([phi, 0, -1]),
    norm([phi, 0, 1]),
    norm([-phi, 0, -1]),
    norm([-phi, 0, 1]),
  ];

  let tris: [number, number, number][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  const subCount = Math.max(0, Math.min(3, Math.floor(subdivisions)));
  for (let s = 0; s < subCount; s++) {
    const midCache = new Map<string, number>();
    const getMid = (a: number, b: number): number => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const cached = midCache.get(key);
      if (cached !== undefined) return cached;
      const va = verts[a]!;
      const vb = verts[b]!;
      const mid = norm([0.5 * (va[0] + vb[0]), 0.5 * (va[1] + vb[1]), 0.5 * (va[2] + vb[2])]);
      const idx = verts.length;
      verts.push(mid);
      midCache.set(key, idx);
      return idx;
    };

    const nextTris: [number, number, number][] = [];
    for (const [a, b, c] of tris) {
      const ab = getMid(a, b);
      const bc = getMid(b, c);
      const ca = getMid(c, a);
      nextTris.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    tris = nextTris;
  }

  const facets: StlFacet[] = tris.map(([a, b, c]) => makeFacet(verts[a]!, verts[b]!, verts[c]!));
  return wrapSolid(name, facets);
}
