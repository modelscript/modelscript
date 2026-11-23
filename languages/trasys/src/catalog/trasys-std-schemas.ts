// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * TRASYS cleanroom surface primitive & spacecraft thermal coating archetype IDs
 * matching `assets/trasys-std-lib/src/models.ts`.
 */
export const TrasysArchetypeId = {
  // Surface Primitives
  RECTANGLE: 1,
  DISK: 2,
  CYLINDER: 3,
  CONE: 4,
  SPHERE: 5,
  PARABOLOID: 6,
  POLYGON: 7,
  // Spacecraft Thermal Coatings
  WHITE_PAINT_Z93: 20,
  SILVER_TEFLON: 21,
  GOLD_KAPTON: 22,
  SOLAR_CELL: 23,
  BLACK_PAINT: 24,
  OPTICAL_SOLAR_REFLECTOR: 25,
} as const;

export type TrasysArchetypeId = (typeof TrasysArchetypeId)[keyof typeof TrasysArchetypeId];

export type TrasysModelCategory = "Surface Primitives" | "Thermal Coatings";

export interface TrasysModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: TrasysModelCategory;
  archetypeId: TrasysArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<TrasysModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Surface Primitives": { fill: "#1e293b", stroke: "#38bdf8", badge: "SURF" },
  "Thermal Coatings": { fill: "#3b1f2b", stroke: "#fbbf24", badge: "COAT" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a TRASYS primitive or coating.
 */
export function generateTrasysBlockSvg(modelType: string, category: TrasysModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  const fontSize = label.length > 8 ? "7.8" : "9.2";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: TrasysModelSpec): DiagramPortSpec[] {
  if (spec.category === "Surface Primitives") {
    return [
      { name: "rad_in", kind: "thermal", side: "left", dx: 0, dy: 26 },
      { name: "rad_out", kind: "thermal", side: "right", dx: 88, dy: 26 },
      { name: "node", kind: "signal", side: "bottom", dx: 44, dy: 52 },
    ];
  }
  return [{ name: "optical", kind: "signal", side: "right", dx: 88, dy: 26 }];
}

export const TRASYS_MODEL_SPECS: TrasysModelSpec[] = [
  // Surface Primitives
  {
    modelType: "RECTANGLE",
    aliases: ["RECT"],
    label: "Rectangular Surface",
    category: "Surface Primitives",
    archetypeId: TrasysArchetypeId.RECTANGLE,
    description: "Planar rectangular radiative surface primitive (W x H).",
    provenance: "NASA TRASYS II User's Manual (1979)",
    params: [
      ["width", 1.0, "m", "Rectangle width along local X axis"],
      ["height", 1.0, "m", "Rectangle height along local Y axis"],
      ["alpha", 0.5, "-", "Solar absorptance"],
      ["epsilon", 0.85, "-", "IR hemispherical emissivity"],
    ],
  },
  {
    modelType: "DISK",
    aliases: ["DISC", "ANNULUS"],
    label: "Circular Disk Surface",
    category: "Surface Primitives",
    archetypeId: TrasysArchetypeId.DISK,
    description: "Planar circular or annular disk radiative surface primitive.",
    provenance: "NASA TRASYS II User's Manual (1979)",
    params: [
      ["radius", 0.5, "m", "Outer disk radius"],
      ["innerRadius", 0.0, "m", "Inner annulus radius"],
      ["alpha", 0.5, "-", "Solar absorptance"],
      ["epsilon", 0.85, "-", "IR hemispherical emissivity"],
    ],
  },
  {
    modelType: "CYLINDER",
    aliases: ["CYL"],
    label: "Cylindrical Shell",
    category: "Surface Primitives",
    archetypeId: TrasysArchetypeId.CYLINDER,
    description: "Right circular cylindrical lateral radiative surface.",
    provenance: "NASA TRASYS II User's Manual (1979)",
    params: [
      ["radius", 0.5, "m", "Cylinder radius"],
      ["length", 1.0, "m", "Cylinder axial length"],
      ["alpha", 0.5, "-", "Solar absorptance"],
      ["epsilon", 0.85, "-", "IR hemispherical emissivity"],
    ],
  },
  {
    modelType: "CONE",
    aliases: ["FRUSTUM"],
    label: "Conical Frustum Surface",
    category: "Surface Primitives",
    archetypeId: TrasysArchetypeId.CONE,
    description: "Truncated right circular cone / frustum radiative surface.",
    provenance: "NASA TRASYS II User's Manual (1979)",
    params: [
      ["radius", 0.5, "m", "Base radius r1"],
      ["radiusTop", 0.1, "m", "Top radius r2"],
      ["length", 1.0, "m", "Axial height"],
      ["alpha", 0.5, "-", "Solar absorptance"],
      ["epsilon", 0.85, "-", "IR hemispherical emissivity"],
    ],
  },
  {
    modelType: "SPHERE",
    aliases: ["SPH"],
    label: "Spherical Surface",
    category: "Surface Primitives",
    archetypeId: TrasysArchetypeId.SPHERE,
    description: "Spherical radiative surface primitive (area = 4*pi*R^2).",
    provenance: "NASA TRASYS II User's Manual (1979)",
    params: [
      ["radius", 0.5, "m", "Sphere radius"],
      ["alpha", 0.5, "-", "Solar absorptance"],
      ["epsilon", 0.85, "-", "IR hemispherical emissivity"],
    ],
  },
  {
    modelType: "PARABOLOID",
    aliases: ["PARAB", "DISH"],
    label: "Paraboloid Reflector Dish",
    category: "Surface Primitives",
    archetypeId: TrasysArchetypeId.PARABOLOID,
    description: "Paraboloid of revolution antenna/reflector surface z = r^2 / (4f).",
    provenance: "NASA TRASYS II User's Manual (1979)",
    params: [
      ["radius", 1.0, "m", "Aperture radius"],
      ["focalLength", 0.5, "m", "Paraboloid focal length"],
      ["alpha", 0.25, "-", "Solar absorptance"],
      ["epsilon", 0.8, "-", "IR hemispherical emissivity"],
    ],
  },
  {
    modelType: "POLYGON",
    aliases: ["POLY"],
    label: "Planar Polygon Surface",
    category: "Surface Primitives",
    archetypeId: TrasysArchetypeId.POLYGON,
    description: "Arbitrary planar polygon radiative surface defined by 3D vertices.",
    provenance: "NASA TRASYS II User's Manual (1979)",
    params: [
      ["alpha", 0.5, "-", "Solar absorptance"],
      ["epsilon", 0.85, "-", "IR hemispherical emissivity"],
    ],
  },
  // Spacecraft Thermal Coatings (Gilmore, Spacecraft Thermal Control Handbook, Vol. I)
  {
    modelType: "WHITE_PAINT_Z93",
    aliases: ["Z93", "WHITE_PAINT"],
    label: "White Paint Z-93",
    category: "Thermal Coatings",
    archetypeId: TrasysArchetypeId.WHITE_PAINT_Z93,
    description: "IITRI Z-93 zinc oxide / potassium silicate white thermal control paint (low alpha/eps radiator).",
    provenance: "Gilmore, Spacecraft Thermal Control Handbook (2002)",
    params: [
      ["alpha", 0.17, "-", "Beginning-of-life solar absorptance"],
      ["epsilon", 0.92, "-", "Hemispherical IR emissivity"],
    ],
  },
  {
    modelType: "SILVER_TEFLON",
    aliases: ["AG_TEFLON", "FEP_SILVER"],
    label: "Silver Teflon (5 mil FEP)",
    category: "Thermal Coatings",
    archetypeId: TrasysArchetypeId.SILVER_TEFLON,
    description: "Second-surface silvered FEP Teflon thermal control tape for spacecraft radiators.",
    provenance: "Gilmore, Spacecraft Thermal Control Handbook (2002)",
    params: [
      ["alpha", 0.08, "-", "Solar absorptance"],
      ["epsilon", 0.8, "-", "Hemispherical IR emissivity"],
    ],
  },
  {
    modelType: "GOLD_KAPTON",
    aliases: ["KAPTON_GOLD", "MLI_GOLD"],
    label: "Gold Kapton MLI",
    category: "Thermal Coatings",
    archetypeId: TrasysArchetypeId.GOLD_KAPTON,
    description: "Vapor-deposited gold on Kapton low-emissivity multi-layer insulation outer layer.",
    provenance: "Gilmore, Spacecraft Thermal Control Handbook (2002)",
    params: [
      ["alpha", 0.25, "-", "Solar absorptance"],
      ["epsilon", 0.03, "-", "Hemispherical IR emissivity"],
    ],
  },
  {
    modelType: "SOLAR_CELL",
    aliases: ["PV_ARRAY", "SOLAR_ARRAY"],
    label: "Spacecraft Solar Cell",
    category: "Thermal Coatings",
    archetypeId: TrasysArchetypeId.SOLAR_CELL,
    description: "Triple-junction GaAs / Si solar cell array coverglass optical surface.",
    provenance: "Gilmore, Spacecraft Thermal Control Handbook (2002)",
    params: [
      ["alpha", 0.82, "-", "Effective solar absorptance (net of electrical conversion)"],
      ["epsilon", 0.85, "-", "Hemispherical IR emissivity"],
    ],
  },
  {
    modelType: "BLACK_PAINT",
    aliases: ["Z306", "CHEMGLAZE_Z306"],
    label: "Black Paint (Z306)",
    category: "Thermal Coatings",
    archetypeId: TrasysArchetypeId.BLACK_PAINT,
    description: "Aeroglaze / Chemglaze Z306 flat black polyurethane optical baffle & interior coating.",
    provenance: "Gilmore, Spacecraft Thermal Control Handbook (2002)",
    params: [
      ["alpha", 0.96, "-", "Solar absorptance"],
      ["epsilon", 0.9, "-", "Hemispherical IR emissivity"],
    ],
  },
  {
    modelType: "OPTICAL_SOLAR_REFLECTOR",
    aliases: ["OSR", "QUARTZ_MIRROR"],
    label: "Optical Solar Reflector (OSR)",
    category: "Thermal Coatings",
    archetypeId: TrasysArchetypeId.OPTICAL_SOLAR_REFLECTOR,
    description: "Fused silica / silvered quartz second-surface mirror radiator with ultra-low alpha/eps.",
    provenance: "Gilmore, Spacecraft Thermal Control Handbook (2002)",
    params: [
      ["alpha", 0.07, "-", "Solar absorptance"],
      ["epsilon", 0.81, "-", "Hemispherical IR emissivity"],
    ],
  },
];

/**
 * Builds the declarative `CleanroomModelSchema[]` array for `@modelscript/trasys-std-lib`.
 */
export function buildTrasysCleanroomSchemas(): CleanroomModelSchema[] {
  return TRASYS_MODEL_SPECS.map((spec): CleanroomModelSchema => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    const prefix = spec.category === "Surface Primitives" ? "Trasys.Surfaces" : "Trasys.Coatings";
    return {
      namePath: `${prefix}.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "aerospace",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 88,
      height: 52,
      svg: generateTrasysBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "trasysEvalKernel",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
