// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * BUFR cleanroom meteorological descriptor archetype IDs matching `assets/bufr-std-lib/src/models.ts`.
 */
export const BufrArchetypeId = {
  STATION_ID: 1,
  GEOLOCATION: 2,
  PRESSURE: 10,
  TEMPERATURE: 11,
  DEWPOINT: 12,
  HUMIDITY: 13,
  WIND: 14,
  PRECIPITATION: 15,
  GEOPOTENTIAL: 16,
  SYNOP_SEQ: 30,
  RADIOSONDE_SEQ: 31,
} as const;

export type BufrArchetypeId = (typeof BufrArchetypeId)[keyof typeof BufrArchetypeId];

export type BufrSchemaCategory =
  | "Identification & Location"
  | "Thermodynamics & Moisture"
  | "Pressure & Vertical"
  | "Wind & Precipitation"
  | "WMO Table D Sequences";

export interface BufrDescriptorSchemaSpec {
  descriptor: string;
  name: string;
  aliases?: string[];
  label: string;
  category: BufrSchemaCategory;
  archetypeId: BufrArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<BufrSchemaCategory, { fill: string; stroke: string; badge: string }> = {
  "Identification & Location": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "META" },
  "Thermodynamics & Moisture": { fill: "#4a1d1d", stroke: "#f97316", badge: "THERM" },
  "Pressure & Vertical": { fill: "#2e2447", stroke: "#c084fc", badge: "PRES" },
  "Wind & Precipitation": { fill: "#163b3b", stroke: "#2dd4bf", badge: "WIND" },
  "WMO Table D Sequences": { fill: "#1e3f2f", stroke: "#34d399", badge: "SEQ" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a WMO BUFR descriptor or sequence.
 */
export function generateBufrBlockSvg(descriptor: string, label: string, category: BufrSchemaCategory): string {
  const c = CATEGORY_COLORS[category];
  const shortLabel = label.slice(0, 12);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 56" width="96" height="56">`,
    `<rect x="2" y="2" width="92" height="52" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`,
    `<rect x="6" y="6" width="32" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>`,
    `<text x="22" y="14.5" text-anchor="middle" font-family="monospace" font-size="7.5" font-weight="700" fill="${c.stroke}">${c.badge}</text>`,
    `<text x="48" y="31" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="700" fill="#f8fafc">${descriptor}</text>`,
    `<text x="48" y="45" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#cbd5e1">${shortLabel}</text>`,
    `</svg>`,
  ].join("");
}

export const BUFR_STD_SCHEMA_SPECS: readonly BufrDescriptorSchemaSpec[] = [
  {
    descriptor: "0-01-001",
    name: "WmoBlockStation",
    aliases: ["0-01-001", "0-01-002", "WMO_STATION_ID", "STATION"],
    label: "WMO Station ID",
    category: "Identification & Location",
    archetypeId: BufrArchetypeId.STATION_ID,
    description: "WMO block number (0-01-001, 7 bits) and station number (0-01-002, 10 bits).",
    provenance: "WMO-No. 306 FM 94 BUFR Table B Class 01",
    params: [
      ["block", 72, "Numeric", "WMO block number (0..99)"],
      ["station", 493, "Numeric", "WMO station number (0..999)"],
      ["bitWidth", 17, "bits", "Combined block+station bit width"],
    ],
  },
  {
    descriptor: "0-05-001",
    name: "GeoCoordinates",
    aliases: ["0-05-001", "0-06-001", "LATLON", "3-01-021"],
    label: "Lat / Lon (High Acc)",
    category: "Identification & Location",
    archetypeId: BufrArchetypeId.GEOLOCATION,
    description:
      "High-accuracy latitude (0-05-001, scale 5, ref -9e6, 25 bits) and longitude (0-06-001, scale 5, ref -18e6, 26 bits).",
    provenance: "WMO-No. 306 FM 94 BUFR Table B Classes 05 & 06",
    params: [
      ["latitude", 37.75, "deg", "WGS-84 latitude (-90..90 deg)"],
      ["longitude", -122.22, "deg", "WGS-84 longitude (-180..180 deg)"],
      ["scale", 5, "10^scale", "Decimal scale factor"],
    ],
  },
  {
    descriptor: "0-07-004",
    name: "AtmosphericPressure",
    aliases: ["0-07-004", "0-10-004", "0-10-051", "PRESSURE"],
    label: "Pressure (Pa)",
    category: "Pressure & Vertical",
    archetypeId: BufrArchetypeId.PRESSURE,
    description: "Atmospheric pressure (0-07-004 / 0-10-004, scale -1, ref 0, 14 bits, 10 Pa resolution).",
    provenance: "WMO-No. 306 FM 94 BUFR Table B Classes 07 & 10",
    params: [
      ["pressurePa", 101325, "Pa", "Atmospheric pressure in Pascals"],
      ["scale", -1, "10^scale", "BUFR Table B scale (-1 => 10 Pa step)"],
      ["bitWidth", 14, "bits", "BUFR bit width"],
    ],
  },
  {
    descriptor: "0-10-009",
    name: "GeopotentialHeight",
    aliases: ["0-10-009", "GEOPOTENTIAL", "ALTITUDE"],
    label: "Geopotential Height",
    category: "Pressure & Vertical",
    archetypeId: BufrArchetypeId.GEOPOTENTIAL,
    description: "Geopotential height (0-10-009, scale 0, ref -1000, 17 bits, gpm).",
    provenance: "WMO-No. 306 FM 94 BUFR Table B Class 10",
    params: [
      ["heightGpm", 1500, "gpm", "Geopotential height in geopotential meters"],
      ["referenceValue", -1000, "gpm", "Table B reference offset"],
      ["bitWidth", 17, "bits", "BUFR bit width"],
    ],
  },
  {
    descriptor: "0-12-101",
    name: "DryBulbTemperature",
    aliases: ["0-12-101", "0-12-001", "TEMPERATURE", "T"],
    label: "Dry-Bulb Temp (K)",
    category: "Thermodynamics & Moisture",
    archetypeId: BufrArchetypeId.TEMPERATURE,
    description: "High-accuracy air temperature (0-12-101, scale 2, ref 0, 16 bits, 0.01 K resolution).",
    provenance: "WMO-No. 306 FM 94 BUFR Table B Class 12",
    params: [
      ["temperatureK", 288.15, "K", "Dry-bulb air temperature in Kelvin"],
      ["scale", 2, "10^scale", "BUFR Table B scale (0.01 K)"],
      ["bitWidth", 16, "bits", "BUFR bit width"],
    ],
  },
  {
    descriptor: "0-12-103",
    name: "DewpointTemperature",
    aliases: ["0-12-103", "0-12-003", "DEWPOINT", "TD"],
    label: "Dewpoint Temp (K)",
    category: "Thermodynamics & Moisture",
    archetypeId: BufrArchetypeId.DEWPOINT,
    description: "High-accuracy dewpoint temperature (0-12-103, scale 2, ref 0, 16 bits, 0.01 K resolution).",
    provenance: "WMO-No. 306 FM 94 BUFR Table B Class 12",
    params: [
      ["dewpointK", 281.15, "K", "Dewpoint temperature in Kelvin"],
      ["scale", 2, "10^scale", "BUFR Table B scale (0.01 K)"],
      ["bitWidth", 16, "bits", "BUFR bit width"],
    ],
  },
  {
    descriptor: "0-13-003",
    name: "RelativeHumidity",
    aliases: ["0-13-003", "RH", "HUMIDITY"],
    label: "Relative Humidity",
    category: "Thermodynamics & Moisture",
    archetypeId: BufrArchetypeId.HUMIDITY,
    description: "Relative humidity (0-13-003, scale 0, ref 0, 7 bits, 0..100%).",
    provenance: "WMO-No. 306 FM 94 BUFR Table B Class 13",
    params: [
      ["rhPct", 65, "%", "Relative humidity in percent"],
      ["bitWidth", 7, "bits", "BUFR bit width"],
    ],
  },
  {
    descriptor: "0-11-002",
    name: "WindVector",
    aliases: ["0-11-001", "0-11-002", "WIND"],
    label: "Wind Speed / Dir",
    category: "Wind & Precipitation",
    archetypeId: BufrArchetypeId.WIND,
    description: "Wind direction (0-11-001, 9 bits, deg true) and wind speed (0-11-002, scale 1, 12 bits, m/s).",
    provenance: "WMO-No. 306 FM 94 BUFR Table B Class 11",
    params: [
      ["directionDeg", 270, "deg", "Wind direction (meteorological degrees true)"],
      ["speedMs", 8.5, "m/s", "Wind speed in m/s"],
    ],
  },
  {
    descriptor: "0-13-011",
    name: "TotalPrecipitation",
    aliases: ["0-13-011", "0-13-019", "PRECIP"],
    label: "Precipitation",
    category: "Wind & Precipitation",
    archetypeId: BufrArchetypeId.PRECIPITATION,
    description: "Total precipitation / liquid water equivalent (0-13-011, scale 1, ref -1, 14 bits, kg/m^2).",
    provenance: "WMO-No. 306 FM 94 BUFR Table B Class 13",
    params: [
      ["precipMm", 2.4, "kg/m^2", "Accumulated precipitation (mm water equivalent)"],
      ["scale", 1, "10^scale", "BUFR Table B scale"],
      ["bitWidth", 14, "bits", "BUFR bit width"],
    ],
  },
  {
    descriptor: "3-07-080",
    name: "SynopSurfaceSequence",
    aliases: ["3-07-080", "SYNOP"],
    label: "SYNOP Surface Seq",
    category: "WMO Table D Sequences",
    archetypeId: BufrArchetypeId.SYNOP_SEQ,
    description:
      "WMO Table D SYNOP surface meteorological report sequence (station, date/time, lat/lon/elev, P, T, Td, RH, wind, precip).",
    provenance: "WMO-No. 306 FM 94 BUFR Table D 3-07-080",
    params: [
      ["pressurePa", 101325, "Pa", "Surface pressure"],
      ["temperatureK", 288.15, "K", "Dry-bulb temperature"],
      ["dewpointK", 281.15, "K", "Dewpoint temperature"],
    ],
  },
  {
    descriptor: "3-09-052",
    name: "RadiosondeSoundingSequence",
    aliases: ["3-09-052", "RADIOSONDE", "TEMP", "SOUNDING"],
    label: "Radiosonde 3-09-052",
    category: "WMO Table D Sequences",
    archetypeId: BufrArchetypeId.RADIOSONDE_SEQ,
    description:
      "WMO Table D radiosonde upper-air sounding sequence (3-09-052) with delayed replication (1-01-000, 0-31-002) of pressure/geopotential/T/Td/wind levels.",
    provenance: "WMO-No. 306 FM 94 BUFR Table D 3-09-052",
    params: [
      ["levels", 8, "Numeric", "Number of vertical pressure levels"],
      ["surfacePressurePa", 101325, "Pa", "Surface launch pressure"],
      ["surfaceTempK", 288.15, "K", "Surface dry-bulb temperature"],
    ],
  },
];

export function buildBufrCleanroomSchemas(): CleanroomModelSchema[] {
  return BUFR_STD_SCHEMA_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => {
      const p: CleanroomParameterSchema = {
        key,
        type: "real",
        defaultValue,
      };
      if (unit !== undefined) p.unit = unit;
      if (description !== undefined) p.description = description;
      return p;
    });

    const ports: DiagramPortSpec[] = [
      { name: "in", kind: "signal", side: "left", dx: 0, dy: 28 },
      { name: "out", kind: "signal", side: "right", dx: 96, dy: 28 },
    ];

    return {
      namePath: `BUFR.${spec.name}`,
      name: spec.name,
      aliases: spec.aliases ?? [spec.descriptor],
      label: spec.label,
      category: spec.category,
      domain: "meteorology",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 96,
      height: 56,
      svg: generateBufrBlockSvg(spec.descriptor, spec.label, spec.category),
      ports,
      parameters,
      wasmKernel: "bufr_eval",
      extra: {
        archetypeId: spec.archetypeId,
        descriptor: spec.descriptor,
      },
    };
  });
}
