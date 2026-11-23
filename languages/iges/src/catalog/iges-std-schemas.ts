// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * IGES 5.3 cleanroom entity & unit preset archetype IDs matching `assets/iges-std-lib/src/models.ts`.
 */
export const IgesArchetypeId = {
  CIRCULAR_ARC: 100,
  COMPOSITE_CURVE: 102,
  CONIC_ARC: 104,
  COPIOUS_DATA: 106,
  PLANE: 108,
  LINE: 110,
  POINT: 116,
  SURFACE_OF_REVOLUTION: 120,
  TABULATED_CYLINDER: 122,
  TRANSFORMATION_MATRIX: 124,
  RATIONAL_BSPLINE_CURVE: 126,
  RATIONAL_BSPLINE_SURFACE: 128,
  CURVE_ON_PARAMETRIC_SURFACE: 142,
  TRIMMED_PARAMETRIC_SURFACE: 144,
  MANIFOLD_SOLID_BREP: 186,
  UNIT_INCH: 1001,
  UNIT_MILLIMETER: 1002,
  UNIT_FOOT: 1004,
  UNIT_METER: 1006,
  UNIT_MICRON: 1009,
  UNIT_CENTIMETER: 1010,
} as const;

export type IgesArchetypeId = (typeof IgesArchetypeId)[keyof typeof IgesArchetypeId];

export type IgesModelCategory = "Curves & Points" | "Surfaces" | "Topology & B-Rep" | "Transforms" | "Unit Presets";

export interface IgesSchemaSpec {
  modelType: string;
  aliases: string[];
  label: string;
  category: IgesModelCategory;
  archetypeId: IgesArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<IgesModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Curves & Points": { fill: "#1e3a5f", stroke: "#38bdf8", badge: "CURV" },
  Surfaces: { fill: "#163b3b", stroke: "#2dd4bf", badge: "SURF" },
  "Topology & B-Rep": { fill: "#2e2447", stroke: "#c084fc", badge: "BREP" },
  Transforms: { fill: "#3f2e1e", stroke: "#fbbf24", badge: "XFRM" },
  "Unit Presets": { fill: "#1e3f2f", stroke: "#34d399", badge: "UNIT" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an IGES 5.3 entity or unit schema.
 */
export function generateIgesBlockSvg(modelType: string, category: IgesModelCategory): string {
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

function defaultPortsForCategory(category: IgesModelCategory): DiagramPortSpec[] {
  switch (category) {
    case "Transforms":
      return [
        { name: "local_in", kind: "geometry", side: "left", dx: 0, dy: 26 },
        { name: "world_out", kind: "geometry", side: "right", dx: 92, dy: 26 },
      ];
    case "Unit Presets":
      return [
        { name: "model_val", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "si_meters", kind: "signal", side: "right", dx: 92, dy: 26 },
      ];
    default:
      return [
        { name: "transform", kind: "geometry", side: "left", dx: 0, dy: 26 },
        { name: "geom_out", kind: "geometry", side: "right", dx: 92, dy: 26 },
      ];
  }
}

export const IGES_STD_SPECS: readonly IgesSchemaSpec[] = [
  {
    modelType: "TYPE_100",
    aliases: ["100", "CircularArc", "CIRCULAR_ARC"],
    label: "Type 100 — Circular Arc",
    category: "Curves & Points",
    archetypeId: IgesArchetypeId.CIRCULAR_ARC,
    description: "Planar circular arc or full circle defined by ZT, center (X1,Y1), start (X2,Y2), and end (X3,Y3).",
    provenance: "IGES 5.3 §4.3 (ANSI Y14.26M)",
    params: [
      ["zt", 0.0, "m", "Parallel Z-plane displacement"],
      ["cx", 0.0, "m", "Center X"],
      ["cy", 0.0, "m", "Center Y"],
      ["sx", 1.0, "m", "Start point X"],
      ["sy", 0.0, "m", "Start point Y"],
      ["ex", 1.0, "m", "End point X"],
      ["ey", 0.0, "m", "End point Y"],
    ],
  },
  {
    modelType: "TYPE_102",
    aliases: ["102", "CompositeCurve", "COMPOSITE_CURVE"],
    label: "Type 102 — Composite Curve",
    category: "Curves & Points",
    archetypeId: IgesArchetypeId.COMPOSITE_CURVE,
    description: "Ordered list of connected constituent curve entities forming a continuous composite curve.",
    provenance: "IGES 5.3 §4.4 (ANSI Y14.26M)",
    params: [["n", 2, "1", "Number of constituent curve pointers"]],
  },
  {
    modelType: "TYPE_104",
    aliases: ["104", "ConicArc", "CONIC_ARC"],
    label: "Type 104 — Conic Arc",
    category: "Curves & Points",
    archetypeId: IgesArchetypeId.CONIC_ARC,
    description: "General planar conic section A*x^2 + B*x*y + C*y^2 + D*x + E*y + F = 0.",
    provenance: "IGES 5.3 §4.5 (ANSI Y14.26M)",
    params: [
      ["A", 1.0, "1", "Quadratic X^2 coefficient"],
      ["B", 0.0, "1", "Cross XY coefficient"],
      ["C", 1.0, "1", "Quadratic Y^2 coefficient"],
      ["D", 0.0, "1", "Linear X coefficient"],
      ["E", 0.0, "1", "Linear Y coefficient"],
      ["F", -1.0, "1", "Constant term"],
    ],
  },
  {
    modelType: "TYPE_106",
    aliases: ["106", "CopiousData", "COPIOUS_DATA"],
    label: "Type 106 — Copious Data",
    category: "Curves & Points",
    archetypeId: IgesArchetypeId.COPIOUS_DATA,
    description: "Point clouds, 2D/3D polylines, and sextuple curve-with-vector sequences.",
    provenance: "IGES 5.3 §4.6 (ANSI Y14.26M)",
    params: [
      ["ip", 2, "1", "Interpretation flag (1=2D, 2=3D, 3=6D)"],
      ["n", 2, "1", "Number of n-tuples"],
    ],
  },
  {
    modelType: "TYPE_108",
    aliases: ["108", "Plane", "PLANE"],
    label: "Type 108 — Plane",
    category: "Surfaces",
    archetypeId: IgesArchetypeId.PLANE,
    description: "Unbounded or bounded plane A*x + B*y + C*z = D.",
    provenance: "IGES 5.3 §4.7 (ANSI Y14.26M)",
    params: [
      ["A", 0.0, "1", "Plane normal X"],
      ["B", 0.0, "1", "Plane normal Y"],
      ["C", 1.0, "1", "Plane normal Z"],
      ["D", 0.0, "m", "Plane offset"],
    ],
  },
  {
    modelType: "TYPE_110",
    aliases: ["110", "Line", "LINE"],
    label: "Type 110 — Line",
    category: "Curves & Points",
    archetypeId: IgesArchetypeId.LINE,
    description: "3D straight line segment from (X1,Y1,Z1) to (X2,Y2,Z2).",
    provenance: "IGES 5.3 §4.8 (ANSI Y14.26M)",
    params: [
      ["x1", 0.0, "m", "Start X"],
      ["y1", 0.0, "m", "Start Y"],
      ["z1", 0.0, "m", "Start Z"],
      ["x2", 1.0, "m", "End X"],
      ["y2", 0.0, "m", "End Y"],
      ["z2", 0.0, "m", "End Z"],
    ],
  },
  {
    modelType: "TYPE_116",
    aliases: ["116", "Point", "POINT"],
    label: "Type 116 — Point",
    category: "Curves & Points",
    archetypeId: IgesArchetypeId.POINT,
    description: "3D Cartesian point (X, Y, Z) with optional display symbol pointer.",
    provenance: "IGES 5.3 §4.11 (ANSI Y14.26M)",
    params: [
      ["x", 0.0, "m", "X coordinate"],
      ["y", 0.0, "m", "Y coordinate"],
      ["z", 0.0, "m", "Z coordinate"],
    ],
  },
  {
    modelType: "TYPE_120",
    aliases: ["120", "SurfaceOfRevolution", "SURFACE_OF_REVOLUTION"],
    label: "Type 120 — Surface of Revolution",
    category: "Surfaces",
    archetypeId: IgesArchetypeId.SURFACE_OF_REVOLUTION,
    description: "Surface generated by rotating a generatrix curve about a line axis.",
    provenance: "IGES 5.3 §4.13 (ANSI Y14.26M)",
    params: [
      ["sa", 0.0, "rad", "Start angle"],
      ["ta", 6.283185307179586, "rad", "Terminate angle"],
    ],
  },
  {
    modelType: "TYPE_122",
    aliases: ["122", "TabulatedCylinder", "TABULATED_CYLINDER"],
    label: "Type 122 — Tabulated Cylinder",
    category: "Surfaces",
    archetypeId: IgesArchetypeId.TABULATED_CYLINDER,
    description: "Ruled surface formed by sweeping a directrix curve along a constant translation vector.",
    provenance: "IGES 5.3 §4.14 (ANSI Y14.26M)",
    params: [
      ["lx", 0.0, "m", "Generatrix end X"],
      ["ly", 0.0, "m", "Generatrix end Y"],
      ["lz", 1.0, "m", "Generatrix end Z"],
    ],
  },
  {
    modelType: "TYPE_124",
    aliases: ["124", "TransformationMatrix", "TRANSFORMATION_MATRIX"],
    label: "Type 124 — Transformation Matrix",
    category: "Transforms",
    archetypeId: IgesArchetypeId.TRANSFORMATION_MATRIX,
    description: "3x4 rigid/affine coordinate transformation matrix [R | T].",
    provenance: "IGES 5.3 §4.15 (ANSI Y14.26M)",
    params: [
      ["r11", 1.0, "1", "R11"],
      ["r12", 0.0, "1", "R12"],
      ["r13", 0.0, "1", "R13"],
      ["t1", 0.0, "m", "Translation X"],
      ["r21", 0.0, "1", "R21"],
      ["r22", 1.0, "1", "R22"],
      ["r23", 0.0, "1", "R23"],
      ["t2", 0.0, "m", "Translation Y"],
      ["r31", 0.0, "1", "R31"],
      ["r32", 0.0, "1", "R32"],
      ["r33", 1.0, "1", "R33"],
      ["t3", 0.0, "m", "Translation Z"],
    ],
  },
  {
    modelType: "TYPE_126",
    aliases: ["126", "NurbsCurve", "RATIONAL_BSPLINE_CURVE"],
    label: "Type 126 — Rational B-Spline Curve (NURBS)",
    category: "Curves & Points",
    archetypeId: IgesArchetypeId.RATIONAL_BSPLINE_CURVE,
    description: "Non-Uniform Rational B-Spline (NURBS) curve with degree M, K+1 control points, knots, and weights.",
    provenance: "IGES 5.3 §4.23 (ANSI Y14.26M)",
    params: [
      ["k", 2, "1", "Upper control point index (K)"],
      ["m", 2, "1", "Spline degree (M)"],
      ["v0", 0.0, "1", "Start parameter"],
      ["v1", 1.0, "1", "End parameter"],
    ],
  },
  {
    modelType: "TYPE_128",
    aliases: ["128", "NurbsSurface", "RATIONAL_BSPLINE_SURFACE"],
    label: "Type 128 — Rational B-Spline Surface (NURBS)",
    category: "Surfaces",
    archetypeId: IgesArchetypeId.RATIONAL_BSPLINE_SURFACE,
    description: "Tensor-product NURBS surface with degrees (M1, M2) and (K1+1)x(K2+1) control net.",
    provenance: "IGES 5.3 §4.24 (ANSI Y14.26M)",
    params: [
      ["k1", 1, "1", "U upper index"],
      ["k2", 1, "1", "V upper index"],
      ["m1", 1, "1", "U degree"],
      ["m2", 1, "1", "V degree"],
    ],
  },
  {
    modelType: "TYPE_142",
    aliases: ["142", "CurveOnParametricSurface", "CURVE_ON_PARAMETRIC_SURFACE"],
    label: "Type 142 — Curve on Parametric Surface",
    category: "Surfaces",
    archetypeId: IgesArchetypeId.CURVE_ON_PARAMETRIC_SURFACE,
    description: "Associates a parametric UV curve and 3D model-space curve with a host surface.",
    provenance: "IGES 5.3 §4.32 (ANSI Y14.26M)",
    params: [["crtn", 0, "1", "Creation way flag"]],
  },
  {
    modelType: "TYPE_144",
    aliases: ["144", "TrimmedParametricSurface", "TRIMMED_PARAMETRIC_SURFACE"],
    label: "Type 144 — Trimmed Parametric Surface",
    category: "Surfaces",
    archetypeId: IgesArchetypeId.TRIMMED_PARAMETRIC_SURFACE,
    description: "Surface bounded by an outer boundary curve (Type 142) and zero or more inner hole loops.",
    provenance: "IGES 5.3 §4.34 (ANSI Y14.26M)",
    params: [["n1", 1, "1", "Outer boundary flag"]],
  },
  {
    modelType: "TYPE_186",
    aliases: ["186", "ManifoldSolidBRep", "MANIFOLD_SOLID_BREP"],
    label: "Type 186 — Manifold Solid B-Rep Object",
    category: "Topology & B-Rep",
    archetypeId: IgesArchetypeId.MANIFOLD_SOLID_BREP,
    description: "Watertight 3D solid defined by an outer closed shell (Type 514) and optional void shells.",
    provenance: "IGES 5.3 §4.48 (ANSI Y14.26M)",
    params: [["voids", 0, "1", "Number of void shells"]],
  },
  // Unit conversion presets
  {
    modelType: "UNIT_INCH",
    aliases: ["IN", "INCH", "FLAG_1"],
    label: "IGES Unit 1 — Inch (0.0254 m)",
    category: "Unit Presets",
    archetypeId: IgesArchetypeId.UNIT_INCH,
    description: "IGES Global unit flag 1: international inch (0.0254 m).",
    provenance: "IGES 5.3 §2.2.4.2",
    params: [["metersPerUnit", 0.0254, "m/in", "SI meters per inch"]],
  },
  {
    modelType: "UNIT_MM",
    aliases: ["MM", "MILLIMETER", "FLAG_2"],
    label: "IGES Unit 2 — Millimeter (0.001 m)",
    category: "Unit Presets",
    archetypeId: IgesArchetypeId.UNIT_MILLIMETER,
    description: "IGES Global unit flag 2: millimeter (0.001 m).",
    provenance: "IGES 5.3 §2.2.4.2",
    params: [["metersPerUnit", 0.001, "m/mm", "SI meters per millimeter"]],
  },
  {
    modelType: "UNIT_FOOT",
    aliases: ["FT", "FOOT", "FLAG_4"],
    label: "IGES Unit 4 — Foot (0.3048 m)",
    category: "Unit Presets",
    archetypeId: IgesArchetypeId.UNIT_FOOT,
    description: "IGES Global unit flag 4: international foot (0.3048 m).",
    provenance: "IGES 5.3 §2.2.4.2",
    params: [["metersPerUnit", 0.3048, "m/ft", "SI meters per foot"]],
  },
  {
    modelType: "UNIT_METER",
    aliases: ["M", "METER", "FLAG_6"],
    label: "IGES Unit 6 — Meter (1.0 m)",
    category: "Unit Presets",
    archetypeId: IgesArchetypeId.UNIT_METER,
    description: "IGES Global unit flag 6: SI meter (1.0 m).",
    provenance: "IGES 5.3 §2.2.4.2",
    params: [["metersPerUnit", 1.0, "m/m", "SI meters per meter"]],
  },
  {
    modelType: "UNIT_MICRON",
    aliases: ["UM", "MICRON", "FLAG_9"],
    label: "IGES Unit 9 — Micron (1e-6 m)",
    category: "Unit Presets",
    archetypeId: IgesArchetypeId.UNIT_MICRON,
    description: "IGES Global unit flag 9: micrometer (1e-6 m).",
    provenance: "IGES 5.3 §2.2.4.2",
    params: [["metersPerUnit", 1e-6, "m/um", "SI meters per micron"]],
  },
  {
    modelType: "UNIT_CM",
    aliases: ["CM", "CENTIMETER", "FLAG_10"],
    label: "IGES Unit 10 — Centimeter (0.01 m)",
    category: "Unit Presets",
    archetypeId: IgesArchetypeId.UNIT_CENTIMETER,
    description: "IGES Global unit flag 10: centimeter (0.01 m).",
    provenance: "IGES 5.3 §2.2.4.2",
    params: [["metersPerUnit", 0.01, "m/cm", "SI meters per centimeter"]],
  },
];

/**
 * Builds the declarative cleanroom schemas for `@modelscript/iges-std-lib`.
 */
export function buildIgesCleanroomSchemas(): CleanroomModelSchema[] {
  return IGES_STD_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      label: key,
      type: unit === "1" ? "integer" : "real",
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `iges.std.${spec.modelType}`,
      name: spec.modelType,
      aliases: [...spec.aliases],
      label: spec.label,
      category: spec.category,
      domain: "cad",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 92,
      height: 52,
      svg: generateIgesBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: "igesEvalKernel",
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
