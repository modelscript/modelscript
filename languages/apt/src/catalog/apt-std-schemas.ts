// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * APT cleanroom archetype IDs matching `assets/apt-std-lib/src/models.ts`.
 */
export const AptArchetypeId = {
  // Analytic Geometry Definitions
  POINT: 1,
  LINE: 2,
  CIRCLE: 3,
  PLANE: 4,
  PATERN: 5,
  // Postprocessor & Machining Setup
  CUTTER: 10,
  SPINDL: 11,
  FEDRAT: 12,
  // Motion Commands
  FROM: 20,
  GOTO: 21,
  GODLTA: 22,
  GO: 23,
  GOLFT: 24,
  GORGT: 25,
  GOFWD: 26,
  GOBACK: 27,
} as const;

export type AptArchetypeId = (typeof AptArchetypeId)[keyof typeof AptArchetypeId];

export type AptModelCategory = "Analytic Geometry" | "Machining Setup" | "Continuous Motion";

export interface AptModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: AptModelCategory;
  archetypeId: AptArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<AptModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Analytic Geometry": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "GEOM" },
  "Machining Setup": { fill: "#2e2447", stroke: "#c084fc", badge: "POST" },
  "Continuous Motion": { fill: "#163b3b", stroke: "#2dd4bf", badge: "MOVE" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an APT entity or command.
 */
export function generateAptBlockSvg(modelType: string, category: AptModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  const fontSize = label.length > 7 ? "8.5" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: AptModelCategory): DiagramPortSpec[] {
  switch (category) {
    case "Analytic Geometry":
      return [
        { name: "ref_in", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "geom_out", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    case "Machining Setup":
      return [
        { name: "state_in", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "state_out", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    case "Continuous Motion":
      return [
        { name: "cl_in", kind: "mechanical", side: "left", dx: 0, dy: 26 },
        { name: "surface", kind: "signal", side: "top", dx: 44, dy: 0 },
        { name: "cl_out", kind: "mechanical", side: "right", dx: 88, dy: 26 },
      ];
  }
}

export const APT_STD_MODEL_SPECS: readonly AptModelSpec[] = [
  // Analytic Geometry Definitions
  {
    modelType: "POINT",
    aliases: ["PT"],
    label: "APT Point Definition",
    category: "Analytic Geometry",
    archetypeId: AptArchetypeId.POINT,
    description:
      "Defines a 2D/3D canonical point by Cartesian coordinates, line/circle intersection, or circle center.",
    provenance: "MIT APT III / ISO 4342 Section 6.1",
    params: [
      ["X", 0.0, "mm", "X coordinate"],
      ["Y", 0.0, "mm", "Y coordinate"],
      ["Z", 0.0, "mm", "Z coordinate"],
    ],
  },
  {
    modelType: "LINE",
    aliases: ["LN"],
    label: "APT Line Definition",
    category: "Analytic Geometry",
    archetypeId: AptArchetypeId.LINE,
    description:
      "Defines an infinite canonical 2D line through two points, at an angle, parallel, perpendicular, or tangent to a circle.",
    provenance: "MIT APT III / ISO 4342 Section 6.2",
    params: [
      ["X1", 0.0, "mm", "Start point X"],
      ["Y1", 0.0, "mm", "Start point Y"],
      ["X2", 10.0, "mm", "End point X"],
      ["Y2", 0.0, "mm", "End point Y"],
    ],
  },
  {
    modelType: "CIRCLE",
    aliases: ["CIR"],
    label: "APT Circle Definition",
    category: "Analytic Geometry",
    archetypeId: AptArchetypeId.CIRCLE,
    description:
      "Defines a canonical circle by center and radius, tangency to a line, or fillet tangency between two lines.",
    provenance: "MIT APT III / ISO 4342 Section 6.3",
    params: [
      ["CX", 0.0, "mm", "Center X coordinate"],
      ["CY", 0.0, "mm", "Center Y coordinate"],
      ["CZ", 0.0, "mm", "Center Z coordinate"],
      ["RADIUS", 1.0, "mm", "Circle radius"],
    ],
  },
  {
    modelType: "PLANE",
    aliases: ["PL"],
    label: "APT Plane Definition",
    category: "Analytic Geometry",
    archetypeId: AptArchetypeId.PLANE,
    description: "Defines a 3D canonical plane (a*x + b*y + c*z = d) by coefficients or three non-collinear points.",
    provenance: "MIT APT III / ISO 4342 Section 6.4",
    params: [
      ["A", 0.0, "1", "Normal X component"],
      ["B", 0.0, "1", "Normal Y component"],
      ["C", 1.0, "1", "Normal Z component"],
      ["D", 0.0, "mm", "Signed plane offset from origin"],
    ],
  },
  {
    modelType: "PATERN",
    aliases: ["PATTERN"],
    label: "APT Point Pattern Definition",
    category: "Analytic Geometry",
    archetypeId: AptArchetypeId.PATERN,
    description: "Defines a linear or circular bolt-hole pattern of points for drilling or point-to-point cycles.",
    provenance: "ISO 4342 Section 6.10",
    params: [
      ["COUNT", 4.0, "1", "Number of points in pattern"],
      ["SPACING", 10.0, "mm", "Linear spacing or angular step"],
    ],
  },

  // Postprocessor & Machining Setup
  {
    modelType: "CUTTER",
    aliases: ["TOOL"],
    label: "APT Cutter Geometry",
    category: "Machining Setup",
    archetypeId: AptArchetypeId.CUTTER,
    description: "Defines the cylindrical or toroidal milling cutter diameter and optional corner radius.",
    provenance: "MIT APT III / ISO 4342 Section 7.1",
    params: [
      ["DIAMETER", 0.5, "in", "Cutter diameter"],
      ["CORNER_RADIUS", 0.0, "in", "Corner fillet radius"],
    ],
  },
  {
    modelType: "SPINDL",
    aliases: ["SPINDLE"],
    label: "APT Spindle Control",
    category: "Machining Setup",
    archetypeId: AptArchetypeId.SPINDL,
    description: "Sets spindle rotational speed in RPM and rotation direction (CLW / CCLW / OFF).",
    provenance: "ISO 4342 Section 9.2",
    params: [
      ["RPM", 1500.0, "rpm", "Spindle rotational speed"],
      ["DIR", 1.0, "1", "Rotation direction (+1 CLW, -1 CCLW, 0 OFF)"],
    ],
  },
  {
    modelType: "FEDRAT",
    aliases: ["FEED"],
    label: "APT Feed Rate Control",
    category: "Machining Setup",
    archetypeId: AptArchetypeId.FEDRAT,
    description: "Sets linear cutting feed rate in program units per minute (IPM or mm/min).",
    provenance: "ISO 4342 Section 9.1",
    params: [["FEED", 10.0, "in/min", "Programmed cutting feed rate"]],
  },

  // Motion Commands
  {
    modelType: "FROM",
    aliases: ["START"],
    label: "APT Initial Tool Position",
    category: "Continuous Motion",
    archetypeId: AptArchetypeId.FROM,
    description: "Establishes the initial reference position of the cutter center in machine coordinates.",
    provenance: "MIT APT III / ISO 4342 Section 7.2",
    params: [
      ["X", 0.0, "mm", "Initial X position"],
      ["Y", 0.0, "mm", "Initial Y position"],
      ["Z", 0.0, "mm", "Initial Z position"],
    ],
  },
  {
    modelType: "GOTO",
    aliases: ["PTP"],
    label: "APT Point-to-Point Move",
    category: "Continuous Motion",
    archetypeId: AptArchetypeId.GOTO,
    description: "Moves the cutter center directly in a straight line to a target point or pattern.",
    provenance: "MIT APT III / ISO 4342 Section 7.3",
    params: [
      ["X", 0.0, "mm", "Target X position"],
      ["Y", 0.0, "mm", "Target Y position"],
      ["Z", 0.0, "mm", "Target Z position"],
    ],
  },
  {
    modelType: "GODLTA",
    aliases: ["DELTA"],
    label: "APT Incremental Move",
    category: "Continuous Motion",
    archetypeId: AptArchetypeId.GODLTA,
    description: "Moves the cutter center incrementally by (dX, dY, dZ) relative to the current position.",
    provenance: "MIT APT III / ISO 4342 Section 7.3",
    params: [
      ["DX", 0.0, "mm", "Incremental dX"],
      ["DY", 0.0, "mm", "Incremental dY"],
      ["DZ", 0.0, "mm", "Incremental dZ"],
    ],
  },
  {
    modelType: "GO",
    aliases: ["STARTUP"],
    label: "APT Continuous-Path Startup",
    category: "Continuous Motion",
    archetypeId: AptArchetypeId.GO,
    description: "Brings the cutter into contact (TO / ON / PAST) with drive, part, and optional check surfaces.",
    provenance: "MIT APT III / ISO 4342 Section 7.4",
    params: [["OFFSET_SIGN", -1.0, "1", "Surface relation (-1 TO, 0 ON, +1 PAST)"]],
  },
  {
    modelType: "GOLFT",
    aliases: ["GOLEFT"],
    label: "APT Turn Left Along Drive Surface",
    category: "Continuous Motion",
    archetypeId: AptArchetypeId.GOLFT,
    description: "Turns left onto the specified drive surface and travels until the check surface condition is met.",
    provenance: "MIT APT III / ISO 4342 Section 7.5",
    params: [["TURN_SIGN", 1.0, "1", "Left turn indicator (+1)"]],
  },
  {
    modelType: "GORGT",
    aliases: ["GORIGHT"],
    label: "APT Turn Right Along Drive Surface",
    category: "Continuous Motion",
    archetypeId: AptArchetypeId.GORGT,
    description: "Turns right onto the specified drive surface and travels until the check surface condition is met.",
    provenance: "MIT APT III / ISO 4342 Section 7.5",
    params: [["TURN_SIGN", -1.0, "1", "Right turn indicator (-1)"]],
  },
  {
    modelType: "GOFWD",
    aliases: ["GOFORWARD"],
    label: "APT Continue Forward Along Drive Surface",
    category: "Continuous Motion",
    archetypeId: AptArchetypeId.GOFWD,
    description: "Continues forward tangentially onto a new drive surface (e.g., tangent fillet arc or line).",
    provenance: "MIT APT III / ISO 4342 Section 7.5",
    params: [["TURN_SIGN", 0.0, "1", "Forward tangent indicator (0)"]],
  },
  {
    modelType: "GOBACK",
    aliases: ["GOREV"],
    label: "APT Reverse Along Drive Surface",
    category: "Continuous Motion",
    archetypeId: AptArchetypeId.GOBACK,
    description: "Reverses direction onto the specified drive surface until the check surface condition is met.",
    provenance: "MIT APT III / ISO 4342 Section 7.5",
    params: [["TURN_SIGN", -2.0, "1", "Reverse indicator"]],
  },
];

/**
 * Builds the declarative cleanroom schema array consumed by `cleanroomSchemasToLibraryPayloads`.
 */
export function buildAptCleanroomSchemas(): CleanroomModelSchema[] {
  return APT_STD_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `APT.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "manufacturing",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: spec.category === "Analytic Geometry" ? "Class" : "Function",
      width: 88,
      height: 52,
      svg: generateAptBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: "aptEvalKernel",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
