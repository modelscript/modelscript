// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom ISO 6983 / RS-274 G-code & tooling preset archetype IDs
 * matching `assets/gcode-std-lib/src/models.ts`.
 */
export const GCodeArchetypeId = {
  // Motion G-codes
  G00: 1,
  G01: 2,
  G02: 3,
  G03: 4,
  G04: 5,
  // Canned drilling cycles
  G80: 10,
  G81: 11,
  G82: 12,
  G83: 13,
  // Machine / Spindle / Program M-codes
  M03: 20,
  M04: 21,
  M05: 22,
  M06: 23,
  M08: 24,
  M09: 25,
  M02: 26,
  M30: 27,
  // Standard Endmill & Drill Cutting-Speed Presets
  ENDMILL_CARBIDE_AL: 40,
  ENDMILL_CARBIDE_STEEL: 41,
  ENDMILL_HSS_AL: 42,
  DRILL_CARBIDE_STEEL: 43,
  DRILL_HSS_AL: 44,
  FACEMILL_CARBIDE_CASTIRON: 45,
} as const;

export type GCodeArchetypeId = (typeof GCodeArchetypeId)[keyof typeof GCodeArchetypeId];

export type GCodeCatalogCategory = "Motion Control" | "Canned Cycles" | "Machine Control" | "Cutting Tool Presets";

export interface GCodeCatalogSpec {
  code: string;
  aliases?: string[];
  label: string;
  category: GCodeCatalogCategory;
  archetypeId: GCodeArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<GCodeCatalogCategory, { fill: string; stroke: string; badge: string }> = {
  "Motion Control": { fill: "#1e3a5f", stroke: "#38bdf8", badge: "MOVE" },
  "Canned Cycles": { fill: "#2e2447", stroke: "#c084fc", badge: "CYCL" },
  "Machine Control": { fill: "#4a1d1d", stroke: "#fb923c", badge: "MACH" },
  "Cutting Tool Presets": { fill: "#163b3b", stroke: "#34d399", badge: "TOOL" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a G-code catalog item.
 */
export function generateGCodeBlockSvg(code: string, category: GCodeCatalogCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = code.toUpperCase().slice(0, 12);
  const fontSize = label.length > 8 ? "7.8" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: GCodeCatalogSpec): DiagramPortSpec[] {
  switch (spec.category) {
    case "Motion Control":
    case "Canned Cycles":
      return [
        { name: "pos_in", kind: "kinematic", side: "left", dx: 0, dy: 26 },
        { name: "pos_out", kind: "kinematic", side: "right", dx: 96, dy: 26 },
      ];
    case "Machine Control":
      return [
        { name: "cmd_in", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "state_out", kind: "signal", side: "right", dx: 96, dy: 26 },
      ];
    case "Cutting Tool Presets":
      return [
        { name: "spindle", kind: "mechanical", side: "top", dx: 48, dy: 0 },
        { name: "cut_out", kind: "mechanical", side: "bottom", dx: 48, dy: 52 },
      ];
  }
}

export const GCODE_CATALOG_SPECS: GCodeCatalogSpec[] = [
  // Motion Control (G00–G04)
  {
    code: "G00",
    aliases: ["G0", "RAPID"],
    label: "Rapid Positioning",
    category: "Motion Control",
    archetypeId: GCodeArchetypeId.G00,
    description: "Non-cutting rapid traverse positioning at maximum machine feedrate.",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [
      ["rapidRateMmPerMin", 10000, "mm/min", "Machine rapid traverse rate"],
      ["distanceMm", 100, "mm", "Euclidean rapid traverse distance"],
    ],
  },
  {
    code: "G01",
    aliases: ["G1", "LINEAR"],
    label: "Linear Interpolation",
    category: "Motion Control",
    archetypeId: GCodeArchetypeId.G01,
    description: "Controlled straight-line cutting move at programmed feedrate F.",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [
      ["feedrateMmPerMin", 500, "mm/min", "Programmed cutting feedrate"],
      ["distanceMm", 50, "mm", "Linear cutting path length"],
    ],
  },
  {
    code: "G02",
    aliases: ["G2", "ARC_CW"],
    label: "Circular Interpolation CW",
    category: "Motion Control",
    archetypeId: GCodeArchetypeId.G02,
    description: "Clockwise circular or helical arc interpolation in active plane (G17/G18/G19).",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [
      ["feedrateMmPerMin", 400, "mm/min", "Arc feedrate"],
      ["radiusMm", 25, "mm", "Arc radius"],
      ["sweepAngleDeg", 90, "deg", "Arc angular sweep"],
      ["helicalDeltaZMm", 0, "mm", "Helical axis displacement"],
    ],
  },
  {
    code: "G03",
    aliases: ["G3", "ARC_CCW"],
    label: "Circular Interpolation CCW",
    category: "Motion Control",
    archetypeId: GCodeArchetypeId.G03,
    description: "Counter-clockwise circular or helical arc interpolation in active plane (G17/G18/G19).",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [
      ["feedrateMmPerMin", 400, "mm/min", "Arc feedrate"],
      ["radiusMm", 25, "mm", "Arc radius"],
      ["sweepAngleDeg", 90, "deg", "Arc angular sweep"],
      ["helicalDeltaZMm", 0, "mm", "Helical axis displacement"],
    ],
  },
  {
    code: "G04",
    aliases: ["G4", "DWELL"],
    label: "Programmed Dwell",
    category: "Motion Control",
    archetypeId: GCodeArchetypeId.G04,
    description: "Pauses axis motion for P seconds while maintaining spindle rotation.",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [["dwellSec", 1.0, "s", "Dwell duration in seconds"]],
  },

  // Canned Drilling Cycles (G80–G83)
  {
    code: "G80",
    aliases: ["CANCEL_CYCLE"],
    label: "Cancel Canned Cycle",
    category: "Canned Cycles",
    archetypeId: GCodeArchetypeId.G80,
    description: "Cancels any active modal canned drilling or boring cycle.",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [],
  },
  {
    code: "G81",
    aliases: ["DRILL"],
    label: "Simple Drilling Cycle",
    category: "Canned Cycles",
    archetypeId: GCodeArchetypeId.G81,
    description: "Rapid to R-plane, feed plunge to final Z depth, and rapid retract.",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [
      ["rPlaneMm", 2.0, "mm", "Retract R-plane Z height"],
      ["zDepthMm", -15.0, "mm", "Final hole bottom Z coordinate"],
      ["feedrateMmPerMin", 180, "mm/min", "Plunge feedrate"],
      ["rapidRateMmPerMin", 10000, "mm/min", "Rapid retract rate"],
    ],
  },
  {
    code: "G82",
    aliases: ["SPOT_DRILL", "COUNTERBORE"],
    label: "Spot Drilling / Counterbore Cycle",
    category: "Canned Cycles",
    archetypeId: GCodeArchetypeId.G82,
    description: "Feed plunge to Z depth, dwell P seconds at bottom for chip cleanup, rapid retract.",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [
      ["rPlaneMm", 2.0, "mm", "Retract R-plane Z height"],
      ["zDepthMm", -5.0, "mm", "Final spot Z coordinate"],
      ["feedrateMmPerMin", 150, "mm/min", "Plunge feedrate"],
      ["dwellSec", 0.5, "s", "Bottom dwell duration"],
      ["rapidRateMmPerMin", 10000, "mm/min", "Rapid retract rate"],
    ],
  },
  {
    code: "G83",
    aliases: ["PECK_DRILL"],
    label: "Deep-Hole Peck Drilling Cycle",
    category: "Canned Cycles",
    archetypeId: GCodeArchetypeId.G83,
    description: "Incremental peck drilling by Q depth with full retract to R-plane for chip evacuation.",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [
      ["rPlaneMm", 2.0, "mm", "Retract R-plane Z height"],
      ["zDepthMm", -24.0, "mm", "Final hole bottom Z coordinate"],
      ["peckDepthMm", 4.0, "mm", "Peck increment Q"],
      ["feedrateMmPerMin", 160, "mm/min", "Plunge feedrate"],
      ["rapidRateMmPerMin", 10000, "mm/min", "Rapid retract rate"],
      ["clearanceMm", 0.5, "mm", "Peck re-entry clearance"],
    ],
  },

  // Machine Control M-codes (M02–M30)
  {
    code: "M03",
    aliases: ["M3", "SPINDLE_CW"],
    label: "Spindle On Clockwise",
    category: "Machine Control",
    archetypeId: GCodeArchetypeId.M03,
    description: "Starts spindle clockwise rotation at programmed speed S (RPM).",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [
      ["spindleRpm", 6000, "rpm", "Commanded spindle speed"],
      ["maxPowerW", 7500, "W", "Spindle motor rated power"],
    ],
  },
  {
    code: "M04",
    aliases: ["M4", "SPINDLE_CCW"],
    label: "Spindle On Counter-Clockwise",
    category: "Machine Control",
    archetypeId: GCodeArchetypeId.M04,
    description: "Starts spindle counter-clockwise rotation at programmed speed S (RPM).",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [
      ["spindleRpm", 6000, "rpm", "Commanded spindle speed"],
      ["maxPowerW", 7500, "W", "Spindle motor rated power"],
    ],
  },
  {
    code: "M05",
    aliases: ["M5", "SPINDLE_STOP"],
    label: "Spindle Stop",
    category: "Machine Control",
    archetypeId: GCodeArchetypeId.M05,
    description: "Stops spindle rotation.",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [],
  },
  {
    code: "M06",
    aliases: ["M6", "TOOL_CHANGE"],
    label: "Automatic Tool Change",
    category: "Machine Control",
    archetypeId: GCodeArchetypeId.M06,
    description: "Executes automatic tool changer swap to selected tool T.",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [["toolChangeTimeSec", 4.5, "s", "Chip-to-chip tool change time"]],
  },
  {
    code: "M08",
    aliases: ["M8", "COOLANT_ON"],
    label: "Flood Coolant On",
    category: "Machine Control",
    archetypeId: GCodeArchetypeId.M08,
    description: "Activates flood coolant pump.",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [["flowLpm", 12.0, "L/min", "Flood coolant flow rate"]],
  },
  {
    code: "M09",
    aliases: ["M9", "COOLANT_OFF"],
    label: "Coolant Off",
    category: "Machine Control",
    archetypeId: GCodeArchetypeId.M09,
    description: "Turns off all coolant delivery.",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [],
  },
  {
    code: "M02",
    aliases: ["M2", "PROGRAM_END"],
    label: "End of Program",
    category: "Machine Control",
    archetypeId: GCodeArchetypeId.M02,
    description: "Terminates CNC program execution.",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [],
  },
  {
    code: "M30",
    aliases: ["PROGRAM_END_REWIND"],
    label: "End of Program & Rewind",
    category: "Machine Control",
    archetypeId: GCodeArchetypeId.M30,
    description: "Terminates CNC program, stops spindle/coolant, and rewinds to start.",
    provenance: "ISO 6983-1 / EIA RS-274-D",
    params: [],
  },

  // Standard Endmill & Drill Cutting-Speed Presets (Machinery's Handbook / Sandvik public formulas)
  {
    code: "ENDMILL_CARBIDE_AL",
    aliases: ["CARBIDE_ENDMILL_AL6061"],
    label: "Carbide Endmill — Aluminum 6061",
    category: "Cutting Tool Presets",
    archetypeId: GCodeArchetypeId.ENDMILL_CARBIDE_AL,
    description: "3-flute uncoated carbide endmill cutting-speed & chip-load preset for 6061-T6 aluminum.",
    provenance: "Machinery's Handbook (Public Cutting Data)",
    params: [
      ["diameterMm", 10.0, "mm", "Tool diameter D"],
      ["flutes", 3, "count", "Number of cutting flutes z"],
      ["surfaceSpeedMpm", 300.0, "m/min", "Recommended cutting speed Vc"],
      ["chipLoadMm", 0.06, "mm/tooth", "Feed per tooth fz"],
      ["specificCuttingEnergyNmm2", 700.0, "N/mm^2", "Specific cutting force kc"],
      ["axialDepthMm", 5.0, "mm", "Axial depth of cut ap"],
      ["radialWidthMm", 5.0, "mm", "Radial engagement ae"],
    ],
  },
  {
    code: "ENDMILL_CARBIDE_STEEL",
    aliases: ["CARBIDE_ENDMILL_1018", "CARBIDE_ENDMILL_4140"],
    label: "Carbide Endmill — Mild/Alloy Steel",
    category: "Cutting Tool Presets",
    archetypeId: GCodeArchetypeId.ENDMILL_CARBIDE_STEEL,
    description: "4-flute TiAlN-coated carbide endmill preset for carbon and alloy steel.",
    provenance: "Machinery's Handbook (Public Cutting Data)",
    params: [
      ["diameterMm", 10.0, "mm", "Tool diameter D"],
      ["flutes", 4, "count", "Number of cutting flutes z"],
      ["surfaceSpeedMpm", 120.0, "m/min", "Recommended cutting speed Vc"],
      ["chipLoadMm", 0.04, "mm/tooth", "Feed per tooth fz"],
      ["specificCuttingEnergyNmm2", 2100.0, "N/mm^2", "Specific cutting force kc"],
      ["axialDepthMm", 3.0, "mm", "Axial depth of cut ap"],
      ["radialWidthMm", 4.0, "mm", "Radial engagement ae"],
    ],
  },
  {
    code: "ENDMILL_HSS_AL",
    aliases: ["HSS_ENDMILL_AL"],
    label: "HSS Endmill — Aluminum",
    category: "Cutting Tool Presets",
    archetypeId: GCodeArchetypeId.ENDMILL_HSS_AL,
    description: "2-flute HSS endmill cutting preset for aluminum alloys.",
    provenance: "Machinery's Handbook (Public Cutting Data)",
    params: [
      ["diameterMm", 8.0, "mm", "Tool diameter D"],
      ["flutes", 2, "count", "Number of cutting flutes z"],
      ["surfaceSpeedMpm", 90.0, "m/min", "Recommended cutting speed Vc"],
      ["chipLoadMm", 0.04, "mm/tooth", "Feed per tooth fz"],
      ["specificCuttingEnergyNmm2", 750.0, "N/mm^2", "Specific cutting force kc"],
      ["axialDepthMm", 4.0, "mm", "Axial depth of cut ap"],
      ["radialWidthMm", 4.0, "mm", "Radial engagement ae"],
    ],
  },
  {
    code: "DRILL_CARBIDE_STEEL",
    aliases: ["CARBIDE_DRILL_STEEL"],
    label: "Carbide Twist Drill — Steel",
    category: "Cutting Tool Presets",
    archetypeId: GCodeArchetypeId.DRILL_CARBIDE_STEEL,
    description: "2-flute solid carbide drill preset for carbon/alloy steel.",
    provenance: "Machinery's Handbook (Public Cutting Data)",
    params: [
      ["diameterMm", 6.0, "mm", "Drill diameter D"],
      ["flutes", 2, "count", "Number of flutes"],
      ["surfaceSpeedMpm", 80.0, "m/min", "Recommended cutting speed Vc"],
      ["feedPerRevMm", 0.12, "mm/rev", "Feed per revolution fn"],
      ["specificCuttingEnergyNmm2", 2200.0, "N/mm^2", "Specific cutting force kc"],
    ],
  },
  {
    code: "DRILL_HSS_AL",
    aliases: ["HSS_DRILL_AL"],
    label: "HSS Twist Drill — Aluminum",
    category: "Cutting Tool Presets",
    archetypeId: GCodeArchetypeId.DRILL_HSS_AL,
    description: "2-flute HSS twist drill preset for aluminum alloys.",
    provenance: "Machinery's Handbook (Public Cutting Data)",
    params: [
      ["diameterMm", 6.0, "mm", "Drill diameter D"],
      ["flutes", 2, "count", "Number of flutes"],
      ["surfaceSpeedMpm", 65.0, "m/min", "Recommended cutting speed Vc"],
      ["feedPerRevMm", 0.15, "mm/rev", "Feed per revolution fn"],
      ["specificCuttingEnergyNmm2", 750.0, "N/mm^2", "Specific cutting force kc"],
    ],
  },
  {
    code: "FACEMILL_CARBIDE_CASTIRON",
    aliases: ["CARBIDE_FACEMILL_CI"],
    label: "Carbide Face Mill — Gray Cast Iron",
    category: "Cutting Tool Presets",
    archetypeId: GCodeArchetypeId.FACEMILL_CARBIDE_CASTIRON,
    description: "5-insert indexable carbide face mill preset for gray cast iron.",
    provenance: "Machinery's Handbook (Public Cutting Data)",
    params: [
      ["diameterMm", 50.0, "mm", "Face mill diameter D"],
      ["flutes", 5, "count", "Number of inserts z"],
      ["surfaceSpeedMpm", 180.0, "m/min", "Recommended cutting speed Vc"],
      ["chipLoadMm", 0.12, "mm/tooth", "Feed per tooth fz"],
      ["specificCuttingEnergyNmm2", 1250.0, "N/mm^2", "Specific cutting force kc"],
      ["axialDepthMm", 2.0, "mm", "Axial depth of cut ap"],
      ["radialWidthMm", 35.0, "mm", "Radial engagement ae"],
    ],
  },
];

/**
 * Builds the declarative `CleanroomModelSchema[]` array for `@modelscript/gcode-std-lib`.
 */
export function buildGCodeCleanroomSchemas(): CleanroomModelSchema[] {
  return GCODE_CATALOG_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: unit === "count" ? "integer" : "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `gcode.${spec.code}`,
      name: spec.code,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "manufacturing",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Function",
      width: 96,
      height: 52,
      svg: generateGCodeBlockSvg(spec.code, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "gcodeModelStep",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
