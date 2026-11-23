// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * RINEX v2 cleanroom observation-type and WGS-84 constant archetype IDs
 * matching `assets/rinex-std-lib/src/models.ts`.
 */
export const RinexArchetypeId = {
  // RINEX v2 Observation Types
  OBS_C1: 1,
  OBS_P1: 2,
  OBS_P2: 3,
  OBS_L1: 4,
  OBS_L2: 5,
  OBS_D1: 6,
  OBS_S1: 7,
  // GPS WGS-84 / ICD-GPS-200 Physical Constants
  CONST_WGS84_MU: 20,
  CONST_WGS84_OMEGA_E_DOT: 21,
  CONST_SPEED_OF_LIGHT: 22,
  CONST_GPS_F_REL: 23,
} as const;

export type RinexArchetypeId = (typeof RinexArchetypeId)[keyof typeof RinexArchetypeId];

export type RinexSchemaCategory = "Observation Type" | "WGS-84 Constant";

export interface RinexSchemaSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: RinexSchemaCategory;
  archetypeId: RinexArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<RinexSchemaCategory, { fill: string; stroke: string; badge: string }> = {
  "Observation Type": { fill: "#1e3a5f", stroke: "#38bdf8", badge: "OBS" },
  "WGS-84 Constant": { fill: "#1e3f2f", stroke: "#34d399", badge: "WGS84" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a RINEX observation type or WGS-84 constant.
 */
export function generateRinexBlockSvg(modelType: string, category: RinexSchemaCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  const fontSize = label.length > 8 ? "7.8" : "9.5";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="34" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="23" y="15" text-anchor="middle" font-family="monospace" font-size="7" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: RinexSchemaSpec): DiagramPortSpec[] {
  if (spec.category === "Observation Type") {
    return [
      { name: "signal_in", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "observable_out", kind: "signal", side: "right", dx: 88, dy: 26 },
    ];
  }
  return [{ name: "value_out", kind: "signal", side: "right", dx: 88, dy: 26 }];
}

export const RINEX_CLEANROOM_SPECS: RinexSchemaSpec[] = [
  {
    modelType: "C1",
    aliases: ["C1C", "CA_PSEUDORANGE"],
    label: "L1 C/A Code Pseudorange",
    category: "Observation Type",
    archetypeId: RinexArchetypeId.OBS_C1,
    description: "L1 C/A-code pseudorange observable in meters (1575.42 MHz).",
    provenance: "Gurtner et al. (1989) RINEX v2.11",
    params: [
      ["FREQ_HZ", 1575.42e6, "Hz", "GPS L1 carrier frequency"],
      ["WAVELENGTH_M", 0.19029367279836487, "m", "GPS L1 carrier wavelength"],
      ["SIGMA_M", 3.0, "m", "Nominal C/A code noise standard deviation"],
    ],
  },
  {
    modelType: "P1",
    aliases: ["P1W", "L1_P_CODE"],
    label: "L1 P(Y) Code Pseudorange",
    category: "Observation Type",
    archetypeId: RinexArchetypeId.OBS_P1,
    description: "L1 P(Y)-code precision pseudorange observable in meters (1575.42 MHz).",
    provenance: "Gurtner et al. (1989) RINEX v2.11",
    params: [
      ["FREQ_HZ", 1575.42e6, "Hz", "GPS L1 carrier frequency"],
      ["WAVELENGTH_M", 0.19029367279836487, "m", "GPS L1 carrier wavelength"],
      ["SIGMA_M", 0.5, "m", "Nominal P(Y) code noise standard deviation"],
    ],
  },
  {
    modelType: "P2",
    aliases: ["P2W", "L2_P_CODE"],
    label: "L2 P(Y) Code Pseudorange",
    category: "Observation Type",
    archetypeId: RinexArchetypeId.OBS_P2,
    description: "L2 P(Y)-code precision pseudorange observable in meters (1227.60 MHz).",
    provenance: "Gurtner et al. (1989) RINEX v2.11",
    params: [
      ["FREQ_HZ", 1227.6e6, "Hz", "GPS L2 carrier frequency"],
      ["WAVELENGTH_M", 0.24421021342456825, "m", "GPS L2 carrier wavelength"],
      ["SIGMA_M", 0.5, "m", "Nominal L2 P(Y) code noise standard deviation"],
    ],
  },
  {
    modelType: "L1",
    aliases: ["L1C", "CARRIER_L1"],
    label: "L1 Carrier Phase",
    category: "Observation Type",
    archetypeId: RinexArchetypeId.OBS_L1,
    description: "L1 carrier phase observable in full cycles (1575.42 MHz).",
    provenance: "Gurtner et al. (1989) RINEX v2.11",
    params: [
      ["FREQ_HZ", 1575.42e6, "Hz", "GPS L1 carrier frequency"],
      ["WAVELENGTH_M", 0.19029367279836487, "m", "GPS L1 carrier wavelength"],
      ["SIGMA_CYCLES", 0.01, "cycles", "Nominal carrier-phase noise"],
    ],
  },
  {
    modelType: "L2",
    aliases: ["L2W", "CARRIER_L2"],
    label: "L2 Carrier Phase",
    category: "Observation Type",
    archetypeId: RinexArchetypeId.OBS_L2,
    description: "L2 carrier phase observable in full cycles (1227.60 MHz).",
    provenance: "Gurtner et al. (1989) RINEX v2.11",
    params: [
      ["FREQ_HZ", 1227.6e6, "Hz", "GPS L2 carrier frequency"],
      ["WAVELENGTH_M", 0.24421021342456825, "m", "GPS L2 carrier wavelength"],
      ["SIGMA_CYCLES", 0.01, "cycles", "Nominal L2 carrier-phase noise"],
    ],
  },
  {
    modelType: "D1",
    aliases: ["D1C", "DOPPLER_L1"],
    label: "L1 Doppler Frequency",
    category: "Observation Type",
    archetypeId: RinexArchetypeId.OBS_D1,
    description: "L1 Doppler shift observable in Hz (positive for approaching satellite).",
    provenance: "Gurtner et al. (1989) RINEX v2.11",
    params: [
      ["FREQ_HZ", 1575.42e6, "Hz", "GPS L1 carrier frequency"],
      ["SIGMA_HZ", 0.1, "Hz", "Nominal Doppler noise"],
    ],
  },
  {
    modelType: "S1",
    aliases: ["S1C", "SNR_L1"],
    label: "L1 Signal-to-Noise Ratio",
    category: "Observation Type",
    archetypeId: RinexArchetypeId.OBS_S1,
    description: "L1 carrier-to-noise density ratio C/N0 in dB-Hz.",
    provenance: "Gurtner et al. (1989) RINEX v2.11",
    params: [
      ["MIN_DBHZ", 20.0, "dB-Hz", "Minimum tracking threshold"],
      ["NOMINAL_DBHZ", 45.0, "dB-Hz", "Nominal open-sky C/N0"],
    ],
  },
  {
    modelType: "WGS84_MU",
    aliases: ["MU", "GM_EARTH"],
    label: "WGS-84 Gravitational Parameter",
    category: "WGS-84 Constant",
    archetypeId: RinexArchetypeId.CONST_WGS84_MU,
    description: "WGS-84 Earth universal gravitational parameter mu = 3.986005e14 m^3/s^2.",
    provenance: "ICD-GPS-200 Table 20-IV",
    params: [["VALUE", 3.986005e14, "m^3/s^2", "Earth gravitational parameter mu"]],
  },
  {
    modelType: "WGS84_OMEGA_E_DOT",
    aliases: ["OMEGA_E_DOT", "EARTH_ROTATION_RATE"],
    label: "WGS-84 Earth Rotation Rate",
    category: "WGS-84 Constant",
    archetypeId: RinexArchetypeId.CONST_WGS84_OMEGA_E_DOT,
    description: "WGS-84 Earth rotation rate Omega_e_dot = 7.2921151467e-5 rad/s.",
    provenance: "ICD-GPS-200 Table 20-IV",
    params: [["VALUE", 7.2921151467e-5, "rad/s", "Earth angular rotation rate"]],
  },
  {
    modelType: "SPEED_OF_LIGHT",
    aliases: ["C", "C_VACUUM"],
    label: "Speed of Light",
    category: "WGS-84 Constant",
    archetypeId: RinexArchetypeId.CONST_SPEED_OF_LIGHT,
    description: "Exact speed of light in vacuum c = 299792458.0 m/s.",
    provenance: "ICD-GPS-200 / SI 1983",
    params: [["VALUE", 299792458.0, "m/s", "Speed of light in vacuum"]],
  },
  {
    modelType: "GPS_F_REL",
    aliases: ["F_REL", "RELATIVISTIC_CONST"],
    label: "GPS Relativistic Clock Constant",
    category: "WGS-84 Constant",
    archetypeId: RinexArchetypeId.CONST_GPS_F_REL,
    description: "GPS relativistic clock correction constant F = -2*sqrt(mu)/c^2 = -4.442807633e-10 s/m^(1/2).",
    provenance: "ICD-GPS-200 Section 20.3.3.3.3.1",
    params: [["VALUE", -4.442807633e-10, "s/m^(1/2)", "Relativistic clock correction constant F"]],
  },
];

/**
 * Builds `CleanroomModelSchema[]` for `@modelscript/rinex-std-lib`.
 */
export function buildRinexCleanroomSchemas(): CleanroomModelSchema[] {
  return RINEX_CLEANROOM_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real" as const,
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `RINEX.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "aerospace",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: spec.category === "Observation Type" ? "Component" : "Constant",
      width: 88,
      height: 52,
      svg: generateRinexBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "rinexModelEval",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
