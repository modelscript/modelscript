// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/doe2 — Cleanroom ASHRAE / DOE-2 Standard Library Schemas.
 *
 * Defines declarative schemas for standard DOE-2 materials, glazing systems,
 * and HVAC system archetypes with cleanroom SVG block icons and ASHRAE provenance.
 */

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

export const Doe2ArchetypeId = {
  // Materials (1..19)
  MAT_CONCRETE: 1,
  MAT_INSUL_R19: 2,
  MAT_GYPSUM: 3,
  MAT_BRICK: 4,
  MAT_WOOD_FRAME: 5,
  MAT_ROOF_MEMBRANE: 6,
  // Glazing (20..29)
  GLZ_DOUBLE_LOWE: 20,
  GLZ_SINGLE_CLEAR: 21,
  GLZ_DOUBLE_CLEAR: 22,
  // HVAC Systems (30..39)
  SYS_PSZ: 30,
  SYS_VAVS: 31,
  SYS_PIU: 32,
  SYS_FC: 33,
  SYS_PTAC: 34,
} as const;

export type Doe2ArchetypeId = (typeof Doe2ArchetypeId)[keyof typeof Doe2ArchetypeId];

export type Doe2StdCategory = "Envelope Material" | "Glazing System" | "HVAC System";

export interface Doe2StdModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: Doe2StdCategory;
  archetypeId: Doe2ArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<Doe2StdCategory, { fill: string; stroke: string; badge: string }> = {
  "Envelope Material": { fill: "#2c241b", stroke: "#f59e0b", badge: "MAT" },
  "Glazing System": { fill: "#173042", stroke: "#38bdf8", badge: "GLZ" },
  "HVAC System": { fill: "#1a382e", stroke: "#34d399", badge: "HVAC" },
};

export function generateDoe2BlockSvg(modelType: string, category: Doe2StdCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  const fontSize = label.length > 9 ? "7.6" : "9.0";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: Doe2StdCategory): DiagramPortSpec[] {
  switch (category) {
    case "Envelope Material":
      return [
        { name: "outside", kind: "thermal", side: "left", dx: 0, dy: 26 },
        { name: "inside", kind: "thermal", side: "right", dx: 96, dy: 26 },
      ];
    case "Glazing System":
      return [
        { name: "exterior", kind: "thermal", side: "left", dx: 0, dy: 16 },
        { name: "solar_in", kind: "signal", side: "left", dx: 0, dy: 36 },
        { name: "interior", kind: "thermal", side: "right", dx: 96, dy: 26 },
      ];
    case "HVAC System":
      return [
        { name: "return_air", kind: "fluid", side: "left", dx: 0, dy: 26 },
        { name: "supply_air", kind: "fluid", side: "right", dx: 96, dy: 26 },
        { name: "electric_in", kind: "electrical", side: "bottom", dx: 48, dy: 52 },
      ];
  }
}

export const DOE2_STD_MODEL_SPECS: readonly Doe2StdModelSpec[] = [
  // ─── ASHRAE / DOE-2 Materials (SI canonical parameters) ───────────────────
  {
    modelType: "MAT-CONCRETE",
    aliases: ["CC03", "CONCRETE-8IN", "HW-CONCRETE"],
    label: "Heavyweight Concrete (200 mm)",
    category: "Envelope Material",
    archetypeId: Doe2ArchetypeId.MAT_CONCRETE,
    description: "200 mm (8 in) heavyweight poured concrete structural wall/slab layer.",
    provenance: "ASHRAE Handbook — Fundamentals Ch. 26 / DOE-2.1E BDL Library (CC03)",
    params: [
      ["thickness", 0.2032, "m", "Layer thickness (8 in = 0.2032 m)"],
      ["conductivity", 1.7296, "W/(m*K)", "Thermal conductivity (1.0 Btu/hr-ft-F)"],
      ["density", 2242.6, "kg/m^3", "Dry bulk density (140 lb/ft^3)"],
      ["specificHeat", 837.4, "J/(kg*K)", "Specific heat capacity (0.20 Btu/lb-F)"],
    ],
  },
  {
    modelType: "MAT-INSUL-R19",
    aliases: ["IN05", "FIBERGLASS-R19", "BATT-R19"],
    label: "Fiberglass Batt Insulation (R-19)",
    category: "Envelope Material",
    archetypeId: Doe2ArchetypeId.MAT_INSUL_R19,
    description: "152 mm (6 in) fiberglass batt cavity insulation with nominal R-19 IP (3.346 m^2-K/W).",
    provenance: "ASHRAE Handbook — Fundamentals Ch. 26 / DOE-2.1E BDL Library (IN05)",
    params: [
      ["thickness", 0.1524, "m", "Layer thickness (6 in = 0.1524 m)"],
      ["conductivity", 0.0455, "W/(m*K)", "Thermal conductivity"],
      ["density", 12.0, "kg/m^3", "Bulk density"],
      ["specificHeat", 837.4, "J/(kg*K)", "Specific heat capacity"],
      ["resistance", 3.3461, "m^2*K/W", "Nominal R-19 IP thermal resistance"],
    ],
  },
  {
    modelType: "MAT-GYPSUM",
    aliases: ["GP01", "GYPSUM-BOARD", "DRYWALL"],
    label: "Gypsum Board (12.7 mm)",
    category: "Envelope Material",
    archetypeId: Doe2ArchetypeId.MAT_GYPSUM,
    description: "12.7 mm (0.5 in) interior gypsum wallboard finish layer.",
    provenance: "ASHRAE Handbook — Fundamentals Ch. 26 / DOE-2.1E BDL Library (GP01)",
    params: [
      ["thickness", 0.0127, "m", "Layer thickness (0.5 in = 0.0127 m)"],
      ["conductivity", 0.16, "W/(m*K)", "Thermal conductivity (0.0926 Btu/hr-ft-F)"],
      ["density", 800.9, "kg/m^3", "Bulk density (50 lb/ft^3)"],
      ["specificHeat", 1088.6, "J/(kg*K)", "Specific heat capacity (0.26 Btu/lb-F)"],
    ],
  },
  {
    modelType: "MAT-BRICK",
    aliases: ["BK01", "FACE-BRICK", "MASONRY-BRICK"],
    label: "Face Brick Veneer (100 mm)",
    category: "Envelope Material",
    archetypeId: Doe2ArchetypeId.MAT_BRICK,
    description: "101.6 mm (4 in) exterior clay face brick masonry veneer.",
    provenance: "ASHRAE Handbook — Fundamentals Ch. 26 / DOE-2.1E BDL Library (BK01)",
    params: [
      ["thickness", 0.1016, "m", "Layer thickness (4 in = 0.1016 m)"],
      ["conductivity", 1.311, "W/(m*K)", "Thermal conductivity (0.757 Btu/hr-ft-F)"],
      ["density", 2082.4, "kg/m^3", "Bulk density (130 lb/ft^3)"],
      ["specificHeat", 921.1, "J/(kg*K)", "Specific heat capacity (0.22 Btu/lb-F)"],
    ],
  },
  {
    modelType: "MAT-WOOD-FRAME",
    aliases: ["WD01", "SOFTWOOD", "PLYWOOD"],
    label: "Softwood Sheathing (19 mm)",
    category: "Envelope Material",
    archetypeId: Doe2ArchetypeId.MAT_WOOD_FRAME,
    description: "19 mm (0.75 in) structural plywood / softwood sheathing.",
    provenance: "ASHRAE Handbook — Fundamentals Ch. 26 / DOE-2.1E BDL Library (WD01)",
    params: [
      ["thickness", 0.01905, "m", "Layer thickness (0.75 in)"],
      ["conductivity", 0.1154, "W/(m*K)", "Thermal conductivity"],
      ["density", 544.6, "kg/m^3", "Bulk density (34 lb/ft^3)"],
      ["specificHeat", 1214.2, "J/(kg*K)", "Specific heat capacity"],
    ],
  },
  {
    modelType: "MAT-ROOF-MEMBRANE",
    aliases: ["BR01", "BUILT-UP-ROOF", "EPDM"],
    label: "Built-Up Roof Membrane (9.5 mm)",
    category: "Envelope Material",
    archetypeId: Doe2ArchetypeId.MAT_ROOF_MEMBRANE,
    description: "9.5 mm (0.375 in) built-up asphalt/gravel roof waterproofing membrane.",
    provenance: "ASHRAE Handbook — Fundamentals Ch. 26 / DOE-2.1E BDL Library (BR01)",
    params: [
      ["thickness", 0.0095, "m", "Layer thickness (3/8 in)"],
      ["conductivity", 0.1627, "W/(m*K)", "Thermal conductivity"],
      ["density", 1121.3, "kg/m^3", "Bulk density (70 lb/ft^3)"],
      ["specificHeat", 1465.4, "J/(kg*K)", "Specific heat capacity"],
    ],
  },

  // ─── Glazing Systems ──────────────────────────────────────────────────────
  {
    modelType: "GLZ-DOUBLE-LOWE",
    aliases: ["DOUBLE-LOWE", "LOWE-ARGON", "2600"],
    label: "Double Pane Low-E Argon Glazing",
    category: "Glazing System",
    archetypeId: Doe2ArchetypeId.GLZ_DOUBLE_LOWE,
    description: "Double-pane insulated glazing unit with low-emissivity coating (e=0.1) and argon fill.",
    provenance: "ASHRAE Handbook — Fundamentals Ch. 15 / LBNL WINDOW & DOE-2 Glazing Library",
    params: [
      ["uValue", 1.65, "W/(m^2*K)", "Center-of-glass U-factor (0.29 Btu/hr-ft^2-F)"],
      ["shgc", 0.42, "1", "Solar Heat Gain Coefficient"],
      ["shadingCoeff", 0.483, "1", "DOE-2 Shading Coefficient (SC = SHGC / 0.87)"],
      ["visibleTransmittance", 0.68, "1", "Visible light transmittance"],
    ],
  },
  {
    modelType: "GLZ-SINGLE-CLEAR",
    aliases: ["SINGLE-CLEAR", "1000"],
    label: "Single Pane Clear Glass (6 mm)",
    category: "Glazing System",
    archetypeId: Doe2ArchetypeId.GLZ_SINGLE_CLEAR,
    description: "Single-pane 6 mm clear monolithic glass.",
    provenance: "ASHRAE Handbook — Fundamentals Ch. 15 / DOE-2 Glazing Library",
    params: [
      ["uValue", 5.8, "W/(m^2*K)", "Center-of-glass U-factor"],
      ["shgc", 0.81, "1", "Solar Heat Gain Coefficient"],
      ["shadingCoeff", 0.931, "1", "DOE-2 Shading Coefficient"],
      ["visibleTransmittance", 0.88, "1", "Visible light transmittance"],
    ],
  },
  {
    modelType: "GLZ-DOUBLE-CLEAR",
    aliases: ["DOUBLE-CLEAR", "2000"],
    label: "Double Pane Clear Air Glazing",
    category: "Glazing System",
    archetypeId: Doe2ArchetypeId.GLZ_DOUBLE_CLEAR,
    description: "Double-pane 6 mm clear glass with 12.7 mm air gap.",
    provenance: "ASHRAE Handbook — Fundamentals Ch. 15 / DOE-2 Glazing Library",
    params: [
      ["uValue", 2.78, "W/(m^2*K)", "Center-of-glass U-factor"],
      ["shgc", 0.7, "1", "Solar Heat Gain Coefficient"],
      ["shadingCoeff", 0.805, "1", "DOE-2 Shading Coefficient"],
      ["visibleTransmittance", 0.78, "1", "Visible light transmittance"],
    ],
  },

  // ─── DOE-2 HVAC System Types ──────────────────────────────────────────────
  {
    modelType: "PSZ",
    aliases: ["PACKAGED-SINGLE-ZONE", "RTU"],
    label: "Packaged Single Zone (PSZ)",
    category: "HVAC System",
    archetypeId: Doe2ArchetypeId.SYS_PSZ,
    description: "DOE-2 PSZ constant-volume packaged DX rooftop unit with gas furnace or electric heat.",
    provenance: "LBNL DOE-2.1E Reference Manual — SYSTEMS PSZ / ASHRAE 90.1 System 3",
    params: [
      ["coolingCop", 3.2, "W/W", "Rated DX cooling COP (EIR = 0.3125)"],
      ["heatingEff", 0.82, "1", "Gas furnace thermal efficiency"],
      ["fanPowerRatio", 0.07, "W/W", "Supply fan power per unit thermal capacity"],
      ["minPartLoad", 0.25, "1", "Minimum part-load ratio before cycling"],
    ],
  },
  {
    modelType: "VAVS",
    aliases: ["VAV", "VAV-REHEAT"],
    label: "Variable Air Volume w/ Reheat (VAVS)",
    category: "HVAC System",
    archetypeId: Doe2ArchetypeId.SYS_VAVS,
    description: "DOE-2 VAVS central air handler with VFD supply fan and zone reheat coils.",
    provenance: "LBNL DOE-2.1E Reference Manual — SYSTEMS VAVS / ASHRAE 90.1 System 7",
    params: [
      ["coolingCop", 3.6, "W/W", "Chilled-water / DX cooling COP"],
      ["heatingEff", 0.85, "1", "Central boiler / reheat thermal efficiency"],
      ["fanPowerRatio", 0.08, "W/W", "VFD supply fan design power ratio (cubic unloading)"],
      ["minPartLoad", 0.3, "1", "Minimum VAV box damper airflow fraction"],
    ],
  },
  {
    modelType: "PIU",
    aliases: ["POWERED-INDUCTION-UNIT", "FAN-POWERED-VAV"],
    label: "Powered Induction Unit (PIU)",
    category: "HVAC System",
    archetypeId: Doe2ArchetypeId.SYS_PIU,
    description: "DOE-2 PIU series/parallel fan-powered VAV terminal unit with plenum return mixing.",
    provenance: "LBNL DOE-2.1E Reference Manual — SYSTEMS PIU / ASHRAE 90.1 System 6",
    params: [
      ["coolingCop", 3.3, "W/W", "Primary air cooling COP"],
      ["heatingEff", 0.85, "1", "Terminal reheat efficiency"],
      ["fanPowerRatio", 0.1, "W/W", "Primary + terminal fan design power ratio"],
      ["minPartLoad", 0.3, "1", "Minimum primary airflow fraction"],
    ],
  },
  {
    modelType: "FC",
    aliases: ["FAN-COIL", "FOUR-PIPE-FCU"],
    label: "Four-Pipe Fan Coil (FC)",
    category: "HVAC System",
    archetypeId: Doe2ArchetypeId.SYS_FC,
    description: "DOE-2 FC four-pipe hydronic fan coil unit with dedicated outdoor air ventilation.",
    provenance: "LBNL DOE-2.1E Reference Manual — SYSTEMS FC / ASHRAE Systems Handbook",
    params: [
      ["coolingCop", 3.8, "W/W", "Chilled-water plant effective COP"],
      ["heatingEff", 0.88, "1", "Hot-water boiler thermal efficiency"],
      ["fanPowerRatio", 0.05, "W/W", "Low-static local fan coil power ratio"],
      ["minPartLoad", 0.2, "1", "Minimum hydronic valve modulation"],
    ],
  },
  {
    modelType: "PTAC",
    aliases: ["PACKAGED-TERMINAL-AC"],
    label: "Packaged Terminal Air Conditioner (PTAC)",
    category: "HVAC System",
    archetypeId: Doe2ArchetypeId.SYS_PTAC,
    description: "DOE-2 PTAC through-the-wall packaged terminal DX cooling and electric/hydronic heating unit.",
    provenance: "LBNL DOE-2.1E Reference Manual — SYSTEMS PTAC / ASHRAE 90.1 System 1",
    params: [
      ["coolingCop", 2.9, "W/W", "Rated PTAC cooling COP"],
      ["heatingEff", 0.8, "1", "Heating efficiency (electric or hydronic)"],
      ["fanPowerRatio", 0.06, "W/W", "Unit supply fan power ratio"],
      ["minPartLoad", 0.2, "1", "Minimum cycling part-load ratio"],
    ],
  },
];

/**
 * Builds declarative `CleanroomModelSchema[]` for `@modelscript/doe2-std-lib`.
 */
export function buildDoe2CleanroomSchemas(): CleanroomModelSchema[] {
  return DOE2_STD_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `DOE2.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "building-energy",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "component",
      width: 96,
      height: 52,
      svg: generateDoe2BlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: "doe2ModelEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
