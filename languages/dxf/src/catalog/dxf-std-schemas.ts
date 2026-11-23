// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * DXF cleanroom entity archetype IDs matching `assets/dxf-std-lib/src/models.ts`.
 */
export const DxfArchetypeId = {
  LINE: 1,
  ARC: 2,
  CIRCLE: 3,
  LWPOLYLINE: 4,
  SPLINE: 5,
  ELLIPSE: 6,
  FACE3D: 7,
  INSERT: 8,
} as const;

export type DxfArchetypeId = (typeof DxfArchetypeId)[keyof typeof DxfArchetypeId];

export type DxfEntityCategory = "2D Primitives" | "Curves & Profiles" | "3D Surface" | "Blocks & Hierarchy";

export interface DxfEntitySpec {
  entityType: string;
  aliases?: string[] | undefined;
  label: string;
  category: DxfEntityCategory;
  archetypeId: DxfArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

/** Standard AutoCAD Color Index (ACI) definitions. */
export interface AciColorPreset {
  aci: number;
  name: string;
  hex: string;
  rgb: [number, number, number];
}

export const ACI_COLORS: readonly AciColorPreset[] = [
  { aci: 1, name: "Red", hex: "#ef4444", rgb: [239, 68, 68] },
  { aci: 2, name: "Yellow", hex: "#eab308", rgb: [234, 179, 8] },
  { aci: 3, name: "Green", hex: "#22c55e", rgb: [34, 197, 94] },
  { aci: 4, name: "Cyan", hex: "#06b6d4", rgb: [6, 182, 212] },
  { aci: 5, name: "Blue", hex: "#3b82f6", rgb: [59, 130, 246] },
  { aci: 6, name: "Magenta", hex: "#d946ef", rgb: [217, 70, 239] },
  { aci: 7, name: "White", hex: "#e2e8f0", rgb: [226, 232, 240] },
  { aci: 8, name: "DarkGray", hex: "#64748b", rgb: [100, 116, 139] },
  { aci: 9, name: "LightGray", hex: "#94a3b8", rgb: [148, 163, 184] },
  { aci: 30, name: "Orange", hex: "#f97316", rgb: [249, 115, 22] },
];

export interface DxfLayerPreset {
  name: string;
  aci: number;
  lineType: string;
  description: string;
}

/** Standard mechanical/architectural CAD layer presets. */
export const DXF_LAYER_PRESETS: readonly DxfLayerPreset[] = [
  { name: "0", aci: 7, lineType: "CONTINUOUS", description: "Default universal DXF layer" },
  { name: "OUTLINE", aci: 7, lineType: "CONTINUOUS", description: "Primary part contour & visible edges" },
  { name: "HIDDEN", aci: 4, lineType: "DASHED", description: "Hidden / occluded edges" },
  { name: "CENTER", aci: 1, lineType: "CENTER", description: "Centerlines & bolt circles" },
  { name: "DIM", aci: 3, lineType: "CONTINUOUS", description: "Dimensions, callouts, and GD&T annotations" },
  { name: "CUT", aci: 2, lineType: "CONTINUOUS", description: "Laser/CNC profile cut path" },
  { name: "MESH", aci: 5, lineType: "CONTINUOUS", description: "3DFACE surface tessellation mesh" },
  { name: "BLOCKS", aci: 6, lineType: "CONTINUOUS", description: "Reusable block instances & fasteners" },
];

const CATEGORY_COLORS: Record<DxfEntityCategory, { fill: string; stroke: string; badge: string }> = {
  "2D Primitives": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "2D" },
  "Curves & Profiles": { fill: "#163b3b", stroke: "#2dd4bf", badge: "CURV" },
  "3D Surface": { fill: "#4a1d1d", stroke: "#f97316", badge: "3D" },
  "Blocks & Hierarchy": { fill: "#2e2447", stroke: "#c084fc", badge: "BLK" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a DXF entity schema.
 */
export function generateDxfEntitySvg(entityType: string, category: DxfEntityCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = entityType.toUpperCase().slice(0, 10);
  const fontSize = label.length > 8 ? "8.0" : "9.5";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">`,
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="2"/>`,
    `<text x="8" y="15" font-family="monospace" font-size="7" fill="${c.stroke}">${c.badge}</text>`,
    `<text x="44" y="34" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>`,
    `</svg>`,
  ].join("");
}

export const DXF_ENTITY_SPECS: readonly DxfEntitySpec[] = [
  {
    entityType: "LINE",
    aliases: ["SEG", "SEGMENT"],
    label: "Line Segment",
    category: "2D Primitives",
    archetypeId: DxfArchetypeId.LINE,
    description: "Straight 2D/3D line segment defined by start (10,20,30) and end (11,21,31) coordinates.",
    provenance: "Autodesk DXF Reference (1982–2024)",
    params: [
      ["x1", 0, "mm", "Start X coordinate (code 10)"],
      ["y1", 0, "mm", "Start Y coordinate (code 20)"],
      ["x2", 10, "mm", "End X coordinate (code 11)"],
      ["y2", 0, "mm", "End Y coordinate (code 21)"],
    ],
  },
  {
    entityType: "ARC",
    aliases: ["CIRCULAR_ARC"],
    label: "Circular Arc",
    category: "2D Primitives",
    archetypeId: DxfArchetypeId.ARC,
    description:
      "Counter-clockwise circular arc defined by center (10,20), radius (40), start angle (50), and end angle (51).",
    provenance: "Autodesk DXF Reference (1982–2024)",
    params: [
      ["cx", 0, "mm", "Center X coordinate (code 10)"],
      ["cy", 0, "mm", "Center Y coordinate (code 20)"],
      ["radius", 10, "mm", "Arc radius (code 40)"],
      ["startAngle", 0, "deg", "Start angle in degrees (code 50)"],
      ["endAngle", 90, "deg", "End angle in degrees (code 51)"],
    ],
  },
  {
    entityType: "CIRCLE",
    aliases: ["HOLE", "BORE"],
    label: "Circle",
    category: "2D Primitives",
    archetypeId: DxfArchetypeId.CIRCLE,
    description: "Full circle defined by center (10,20,30) and radius (40).",
    provenance: "Autodesk DXF Reference (1982–2024)",
    params: [
      ["cx", 0, "mm", "Center X coordinate (code 10)"],
      ["cy", 0, "mm", "Center Y coordinate (code 20)"],
      ["radius", 5, "mm", "Circle radius (code 40)"],
    ],
  },
  {
    entityType: "LWPOLYLINE",
    aliases: ["POLYLINE", "PROFILE"],
    label: "Lightweight Polyline",
    category: "Curves & Profiles",
    archetypeId: DxfArchetypeId.LWPOLYLINE,
    description: "2D polyline of connected straight and bulged circular arc segments with optional closed flag (70).",
    provenance: "Autodesk DXF Reference (R14–2024)",
    params: [
      ["closed", 1, "flag", "Closed polyline flag (code 70 bit 1)"],
      ["elevation", 0, "mm", "Z elevation (code 38)"],
      ["bulge", 0, "ratio", "Segment bulge tan(theta/4) (code 42)"],
    ],
  },
  {
    entityType: "SPLINE",
    aliases: ["NURBS", "BSPLINE"],
    label: "NURBS / B-Spline",
    category: "Curves & Profiles",
    archetypeId: DxfArchetypeId.SPLINE,
    description: "Parametric B-spline / NURBS curve with degree (71), knot vector (40), and control points (10,20,30).",
    provenance: "Autodesk DXF Reference (R13–2024)",
    params: [
      ["degree", 3, "order", "Spline polynomial degree (code 71)"],
      ["closed", 0, "flag", "Closed spline flag (code 70 bit 1)"],
    ],
  },
  {
    entityType: "ELLIPSE",
    aliases: ["OVAL"],
    label: "Ellipse",
    category: "Curves & Profiles",
    archetypeId: DxfArchetypeId.ELLIPSE,
    description:
      "Ellipse defined by center (10,20,30), major axis endpoint (11,21,31), minor/major ratio (40), and parameter range (41,42).",
    provenance: "Autodesk DXF Reference (R13–2024)",
    params: [
      ["majorRadius", 10, "mm", "Semi-major axis length"],
      ["ratio", 0.5, "ratio", "Minor-to-major axis ratio (code 40)"],
      ["startParam", 0, "rad", "Start parameter (code 41)"],
      ["endParam", 6.283185307179586, "rad", "End parameter (code 42)"],
    ],
  },
  {
    entityType: "3DFACE",
    aliases: ["FACE", "TRIANGLE", "QUAD"],
    label: "3D Face",
    category: "3D Surface",
    archetypeId: DxfArchetypeId.FACE3D,
    description: "3- or 4-vertex planar 3D surface face used for faceted mesh representation.",
    provenance: "Autodesk DXF Reference (1982–2024)",
    params: [["invisibleEdgeFlags", 0, "bitmask", "Invisible edge bitmask (code 70)"]],
  },
  {
    entityType: "INSERT",
    aliases: ["BLOCK_REF", "INSTANCE"],
    label: "Block Insert",
    category: "Blocks & Hierarchy",
    archetypeId: DxfArchetypeId.INSERT,
    description: "Hierarchical block reference applying translation (10,20,30), scale (41,42,43), and Z-rotation (50).",
    provenance: "Autodesk DXF Reference (1982–2024)",
    params: [
      ["scaleX", 1, "ratio", "X scale factor (code 41)"],
      ["scaleY", 1, "ratio", "Y scale factor (code 42)"],
      ["scaleZ", 1, "ratio", "Z scale factor (code 43)"],
      ["rotation", 0, "deg", "CCW rotation angle in degrees (code 50)"],
    ],
  },
];

/**
 * Materializes declarative `CleanroomModelSchema[]` entries for all standard DXF entity schemas.
 */
export function buildDxfCleanroomSchemas(): CleanroomModelSchema[] {
  return DXF_ENTITY_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      label: key,
      type: unit === "flag" || unit === "order" || unit === "bitmask" ? "integer" : "real",
      defaultValue,
      unit,
      description,
    }));
    const ports: DiagramPortSpec[] = [
      { name: "geom_in", kind: "mechanical", side: "left", dx: 0, dy: 26 },
      { name: "geom_out", kind: "mechanical", side: "right", dx: 88, dy: 26 },
    ];
    return {
      namePath: `DXF.${spec.entityType}`,
      name: spec.entityType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "cad",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Entity",
      width: 88,
      height: 52,
      svg: generateDxfEntitySvg(spec.entityType, spec.category),
      ports,
      parameters,
      wasmKernel: `dxf_${spec.entityType.toLowerCase()}`,
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
