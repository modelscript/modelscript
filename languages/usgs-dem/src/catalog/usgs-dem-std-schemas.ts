// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * USGS DEM cleanroom archetype IDs matching `assets/usgs-dem-std-lib/src/models.ts`.
 */
export const UsgsDemArchetypeId = {
  // Datums & Coordinate Reference Systems
  UTM_NAD27: 1,
  UTM_NAD83: 2,
  GEOGRAPHIC_ARCSEC: 3,
  STATE_PLANE_NAD27: 4,
  ALBERS_EQUAL_AREA: 5,
  // Canonical Synthetic Terrain Benchmarks
  GAUSSIAN_HILL: 10,
  INCLINED_PLANE: 11,
  V_VALLEY: 12,
  SADDLE_PASS: 13,
  // Hydrologic / Geomorphometric Operators
  HORN_GRADIENT: 20,
  D8_WATERSHED: 21,
  MANNING_KINEMATIC_WAVE: 22,
} as const;

export type UsgsDemArchetypeId = (typeof UsgsDemArchetypeId)[keyof typeof UsgsDemArchetypeId];

export type UsgsDemModelCategory = "Datums & Projections" | "Synthetic Terrain" | "Topographic Operators";

export interface UsgsDemModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: UsgsDemModelCategory;
  archetypeId: UsgsDemArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<UsgsDemModelCategory, { fill: string; stroke: string; badge: string }> = {
  "Datums & Projections": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "CRS" },
  "Synthetic Terrain": { fill: "#1e3f2f", stroke: "#34d399", badge: "DEM" },
  "Topographic Operators": { fill: "#3b2a1a", stroke: "#f59e0b", badge: "TOPO" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a USGS DEM schema.
 */
export function generateUsgsDemBlockSvg(modelType: string, category: UsgsDemModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  const fontSize = label.length > 9 ? "7.8" : "9.0";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 54" width="96" height="54">`,
    `<rect x="2" y="2" width="92" height="50" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/>`,
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>`,
    `<text x="21" y="14.5" text-anchor="middle" font-family="monospace" font-size="7" font-weight="700" fill="${c.stroke}">${c.badge}</text>`,
    `<path d="M58 18 L66 10 L73 16 L80 8 L88 18 Z" fill="${c.stroke}" fill-opacity="0.35" stroke="${c.stroke}" stroke-width="1"/>`,
    `<text x="48" y="38" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="600" fill="#f1f5f9">${label}</text>`,
    `</svg>`,
  ].join("");
}

export const USGS_DEM_STD_SPECS: readonly UsgsDemModelSpec[] = [
  {
    modelType: "UTM_NAD27",
    aliases: ["UTM27", "EPSG:26713"],
    label: "UTM NAD27 (Clarke 1866)",
    category: "Datums & Projections",
    archetypeId: UsgsDemArchetypeId.UTM_NAD27,
    description:
      "Universal Transverse Mercator projection on North American Datum of 1927 (Clarke 1866 ellipsoid, USGS ground reference code 1, horizontal datum 1).",
    provenance: "USGS Data Users Guide 5 (1987) / Clarke 1866",
    params: [
      ["groundRefSystem", 1, "code", "USGS ground planimetric reference system (1=UTM)"],
      ["zone", 13, "zone", "UTM zone number (1..60 North, -60..-1 South)"],
      ["planimetricUnits", 2, "code", "Planimetric units (2=meters)"],
      ["elevationUnits", 2, "code", "Elevation units (2=meters)"],
      ["semiMajorAxis", 6378206.4, "m", "Clarke 1866 equatorial radius a"],
      ["invFlattening", 294.9786982, "1", "Clarke 1866 inverse flattening 1/f"],
    ],
  },
  {
    modelType: "UTM_NAD83",
    aliases: ["UTM83", "EPSG:26913"],
    label: "UTM NAD83 (GRS 80)",
    category: "Datums & Projections",
    archetypeId: UsgsDemArchetypeId.UTM_NAD83,
    description:
      "Universal Transverse Mercator projection on North American Datum of 1983 (GRS 80 ellipsoid, USGS ground reference code 1, horizontal datum 4).",
    provenance: "USGS Data Users Guide 5 / GRS 80",
    params: [
      ["groundRefSystem", 1, "code", "USGS ground planimetric reference system (1=UTM)"],
      ["zone", 13, "zone", "UTM zone number (1..60 North, -60..-1 South)"],
      ["planimetricUnits", 2, "code", "Planimetric units (2=meters)"],
      ["elevationUnits", 2, "code", "Elevation units (2=meters)"],
      ["semiMajorAxis", 6378137.0, "m", "GRS 80 equatorial radius a"],
      ["invFlattening", 298.257222101, "1", "GRS 80 inverse flattening 1/f"],
    ],
  },
  {
    modelType: "GEOGRAPHIC_ARCSEC",
    aliases: ["GEOGRAPHIC", "ARCSEC", "1DEG_DEM"],
    label: "Geographic (Arc-Seconds)",
    category: "Datums & Projections",
    archetypeId: UsgsDemArchetypeId.GEOGRAPHIC_ARCSEC,
    description:
      "Geographic latitude/longitude grid in arc-seconds (USGS 1-degree / 3-arc-second DMA/USGS DEM, ground reference code 0, planimetric unit code 3).",
    provenance: "USGS 1-Degree DEM Specification (3-arc-second)",
    params: [
      ["groundRefSystem", 0, "code", "USGS ground planimetric reference system (0=Geographic)"],
      ["zone", 0, "code", "Zone code (0 for Geographic)"],
      ["planimetricUnits", 3, "code", "Planimetric units (3=arc-seconds)"],
      ["elevationUnits", 2, "code", "Elevation units (2=meters)"],
      ["dxArcSec", 3.0, "arcsec", "East-West angular spacing"],
      ["dyArcSec", 3.0, "arcsec", "North-South angular spacing"],
    ],
  },
  {
    modelType: "STATE_PLANE_NAD27",
    aliases: ["SPCS27", "STATE_PLANE"],
    label: "State Plane NAD27",
    category: "Datums & Projections",
    archetypeId: UsgsDemArchetypeId.STATE_PLANE_NAD27,
    description: "State Plane Coordinate System (USGS ground reference code 2, feet or meters planimetric units).",
    provenance: "USGS Data Users Guide 5 / SPCS",
    params: [
      ["groundRefSystem", 2, "code", "USGS ground planimetric reference system (2=State Plane)"],
      ["zone", 502, "fips", "State Plane FIPS zone code"],
      ["planimetricUnits", 1, "code", "Planimetric units (1=feet)"],
      ["elevationUnits", 1, "code", "Elevation units (1=feet)"],
    ],
  },
  {
    modelType: "ALBERS_EQUAL_AREA",
    aliases: ["ALBERS"],
    label: "Albers Equal-Area Conic",
    category: "Datums & Projections",
    archetypeId: UsgsDemArchetypeId.ALBERS_EQUAL_AREA,
    description: "Albers Equal-Area Conic projection (USGS ground reference code 3).",
    provenance: "USGS Map Projections Bulletin 1532 (Snyder 1987)",
    params: [
      ["groundRefSystem", 3, "code", "USGS ground planimetric reference system (3=Albers)"],
      ["planimetricUnits", 2, "code", "Planimetric units (2=meters)"],
      ["elevationUnits", 2, "code", "Elevation units (2=meters)"],
      ["stdParallel1", 29.5, "deg", "First standard parallel"],
      ["stdParallel2", 45.5, "deg", "Second standard parallel"],
    ],
  },
  {
    modelType: "GAUSSIAN_HILL",
    aliases: ["GAUSSIAN", "BELL_HILL"],
    label: "Gaussian Hill Benchmark",
    category: "Synthetic Terrain",
    archetypeId: UsgsDemArchetypeId.GAUSSIAN_HILL,
    description:
      "Canonical smooth Gaussian hill z(x,y) = z0 + H * exp(-((x-xc)^2 + (y-yc)^2) / (2*sigma^2)) with analytical peak, volume, and hypsometric integral.",
    provenance: "Cleanroom Geomorphometry Verification Benchmark",
    params: [
      ["baseElevation", 1000.0, "m", "Base datum elevation z0"],
      ["amplitude", 500.0, "m", "Peak height H above base"],
      ["sigma", 150.0, "m", "Gaussian standard deviation sigma"],
      ["dx", 30.0, "m", "Grid spacing dx"],
      ["dy", 30.0, "m", "Grid spacing dy"],
    ],
  },
  {
    modelType: "INCLINED_PLANE",
    aliases: ["RAMP", "PLANAR_SLOPE"],
    label: "Inclined Plane Benchmark",
    category: "Synthetic Terrain",
    archetypeId: UsgsDemArchetypeId.INCLINED_PLANE,
    description:
      "Canonical linear ramp z(x,y) = z0 + a*x + b*y with exact constant slope atan(sqrt(a^2+b^2)) and constant compass aspect.",
    provenance: "Horn (1981) Analytical Slope/Aspect Verification Benchmark",
    params: [
      ["baseElevation", 100.0, "m", "Origin elevation z0"],
      ["gradX", -0.1, "m/m", "East-West slope dz/dx"],
      ["gradY", -0.05, "m/m", "North-South slope dz/dy"],
      ["dx", 30.0, "m", "Grid spacing dx"],
      ["dy", 30.0, "m", "Grid spacing dy"],
    ],
  },
  {
    modelType: "V_VALLEY",
    aliases: ["VALLEY", "CANYON"],
    label: "V-Shaped Valley Benchmark",
    category: "Synthetic Terrain",
    archetypeId: UsgsDemArchetypeId.V_VALLEY,
    description:
      "Canonical V-shaped fluvial valley z(x,y) = z0 + s_side*|x - xc| + s_channel*y converging overland flow into a central thalweg.",
    provenance: "O'Callaghan & Mark (1984) D8 Drainage Network Benchmark",
    params: [
      ["baseElevation", 200.0, "m", "Outlet thalweg elevation z0"],
      ["sideSlope", 0.2, "m/m", "Lateral hillslope gradient"],
      ["channelSlope", 0.04, "m/m", "Longitudinal thalweg gradient"],
      ["dx", 30.0, "m", "Grid spacing dx"],
      ["dy", 30.0, "m", "Grid spacing dy"],
    ],
  },
  {
    modelType: "HORN_GRADIENT",
    aliases: ["SLOPE_ASPECT"],
    label: "Horn 3x3 Slope & Aspect",
    category: "Topographic Operators",
    archetypeId: UsgsDemArchetypeId.HORN_GRADIENT,
    description: "Horn (1981) weighted 3x3 finite-difference surface gradient, slope angle, and compass aspect.",
    provenance: "Horn, B.K.P. (1981), Proc. IEEE 69(1):14-47",
    params: [
      ["dx", 30.0, "m", "Grid spacing dx"],
      ["dy", 30.0, "m", "Grid spacing dy"],
    ],
  },
  {
    modelType: "D8_WATERSHED",
    aliases: ["D8_FLOW"],
    label: "D8 Steepest-Descent Flow",
    category: "Topographic Operators",
    archetypeId: UsgsDemArchetypeId.D8_WATERSHED,
    description: "Eight-direction steepest-descent flow direction and topological upstream accumulation.",
    provenance: "Jenson & Domingue (1988), PE&RS 54(11):1593-1600",
    params: [
      ["dx", 30.0, "m", "Grid spacing dx"],
      ["dy", 30.0, "m", "Grid spacing dy"],
    ],
  },
  {
    modelType: "MANNING_KINEMATIC_WAVE",
    aliases: ["KINEMATIC_RUNOFF"],
    label: "Manning Kinematic-Wave Runoff",
    category: "Topographic Operators",
    archetypeId: UsgsDemArchetypeId.MANNING_KINEMATIC_WAVE,
    description: "Overland sheet-flow kinematic-wave continuity and Manning discharge equation.",
    provenance: "Woolhiser & Liggett (1967) / Chow, Maidment & Mays",
    params: [
      ["manningN", 0.035, "s/m^(1/3)", "Manning roughness coefficient"],
      ["slope", 0.05, "m/m", "Overland slope S0"],
      ["flowLength", 300.0, "m", "Overland flow plane length"],
    ],
  },
];

/**
 * Build declarative `CleanroomModelSchema[]` entries for `@modelscript/usgs-dem-std-lib`.
 */
export function buildUsgsDemCleanroomSchemas(): CleanroomModelSchema[] {
  return USGS_DEM_STD_SPECS.map((spec): CleanroomModelSchema => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real" as const,
      defaultValue,
      unit,
      description,
    }));

    const ports: DiagramPortSpec[] = [
      { name: "dem_in", kind: "signal", side: "left", dx: 0, dy: 27 },
      { name: "dem_out", kind: "signal", side: "right", dx: 96, dy: 27 },
    ];

    return {
      namePath: `USGS.DEM.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "geospatial",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 96,
      height: 54,
      svg: generateUsgsDemBlockSvg(spec.modelType, spec.category),
      ports,
      parameters,
      wasmKernel: "usgsDemEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
