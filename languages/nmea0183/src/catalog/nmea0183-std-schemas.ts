// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom NMEA 0183 sentence archetype IDs matching `assets/nmea0183-std-lib/src/models.ts`.
 */
export const Nmea0183ArchetypeId = {
  GGA: 1,
  RMC: 2,
  GSA: 3,
  GSV: 4,
  VTG: 5,
  HDG: 6,
  DBT: 7,
  MWV: 8,
} as const;

export type Nmea0183ArchetypeId = (typeof Nmea0183ArchetypeId)[keyof typeof Nmea0183ArchetypeId];

export type Nmea0183SentenceCategory =
  "GNSS Position & Fix" | "GNSS Constellation & DOP" | "Navigation & Kinematics" | "Marine Sensors";

export interface Nmea0183SentenceSpec {
  formatter: string;
  aliases?: string[];
  label: string;
  category: Nmea0183SentenceCategory;
  archetypeId: Nmea0183ArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<Nmea0183SentenceCategory, { fill: string; stroke: string; badge: string }> = {
  "GNSS Position & Fix": { fill: "#132a46", stroke: "#38bdf8", badge: "GNSS" },
  "GNSS Constellation & DOP": { fill: "#281e47", stroke: "#a78bfa", badge: "SAT" },
  "Navigation & Kinematics": { fill: "#14382c", stroke: "#34d399", badge: "NAV" },
  "Marine Sensors": { fill: "#3c2614", stroke: "#fbbf24", badge: "SENS" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an NMEA 0183 sentence schema.
 */
export function generateNmea0183BlockSvg(formatter: string, category: Nmea0183SentenceCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = `$--${formatter.toUpperCase().slice(0, 3)}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="36" text-anchor="middle" font-family="monospace" font-size="10.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: Nmea0183SentenceSpec): DiagramPortSpec[] {
  switch (spec.category) {
    case "GNSS Position & Fix":
      return [
        { name: "nmea_in", kind: "telemetry", side: "left", dx: 0, dy: 26 },
        { name: "pos_out", kind: "geodetic", side: "right", dx: 88, dy: 16 },
        { name: "quality_out", kind: "signal", side: "right", dx: 88, dy: 36 },
      ];
    case "GNSS Constellation & DOP":
      return [
        { name: "nmea_in", kind: "telemetry", side: "left", dx: 0, dy: 26 },
        { name: "sat_out", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    case "Navigation & Kinematics":
      return [
        { name: "nmea_in", kind: "telemetry", side: "left", dx: 0, dy: 26 },
        { name: "vel_out", kind: "kinematics", side: "right", dx: 88, dy: 26 },
      ];
    case "Marine Sensors":
      return [
        { name: "sensor_in", kind: "telemetry", side: "left", dx: 0, dy: 26 },
        { name: "meas_out", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
  }
}

export const NMEA0183_SENTENCE_SPECS: readonly Nmea0183SentenceSpec[] = [
  {
    formatter: "GGA",
    aliases: ["GPGGA", "GNGGA", "GLGGA", "GAGGA"],
    label: "Global Positioning System Fix Data (GGA)",
    category: "GNSS Position & Fix",
    archetypeId: Nmea0183ArchetypeId.GGA,
    description: "Time, 3D WGS-84 position, fix quality indicator, satellite count, HDOP, and orthometric altitude.",
    provenance: "NMEA 0183 v4.11 Standard Sentence",
    params: [
      ["FIX_QUALITY", 1, "enum", "0=Invalid, 1=GPS, 2=DGPS, 4=RTK Fixed, 5=Float RTK"],
      ["HDOP_MAX", 5.0, "1", "Horizontal dilution of precision warning threshold"],
      ["ALTITUDE_M", 0.0, "m", "Default antenna altitude above mean sea level"],
      ["GEOID_SEP_M", 0.0, "m", "Geoidal separation above WGS-84 ellipsoid"],
    ],
  },
  {
    formatter: "RMC",
    aliases: ["GPRMC", "GNRMC", "GLRMC", "GARMC"],
    label: "Recommended Minimum Specific GNSS Data (RMC)",
    category: "GNSS Position & Fix",
    archetypeId: Nmea0183ArchetypeId.RMC,
    description:
      "UTC time/date, active/void status, latitude/longitude, speed over ground (knots), course over ground, and magnetic variation.",
    provenance: "NMEA 0183 v4.11 Standard Sentence",
    params: [
      ["SOG_KNOTS", 0.0, "kn", "Speed over ground in knots"],
      ["COG_DEG", 0.0, "deg", "Course over ground (true north)"],
      ["MAG_VAR_DEG", 0.0, "deg", "Magnetic variation (east positive)"],
    ],
  },
  {
    formatter: "GSA",
    aliases: ["GPGSA", "GNGSA", "GLGSA", "GAGSA"],
    label: "GNSS DOP and Active Satellites (GSA)",
    category: "GNSS Constellation & DOP",
    archetypeId: Nmea0183ArchetypeId.GSA,
    description: "Operating mode, fix dimension (1=none, 2=2D, 3=3D), up to 12 active PRNs, and PDOP/HDOP/VDOP.",
    provenance: "NMEA 0183 v4.11 Standard Sentence",
    params: [
      ["FIX_TYPE", 3, "enum", "1=No Fix, 2=2D Fix, 3=3D Fix"],
      ["PDOP", 1.5, "1", "Position dilution of precision"],
      ["HDOP", 1.0, "1", "Horizontal dilution of precision"],
      ["VDOP", 1.1, "1", "Vertical dilution of precision"],
    ],
  },
  {
    formatter: "GSV",
    aliases: ["GPGSV", "GLGSV", "GAGSV", "GNGSV"],
    label: "GNSS Satellites in View (GSV)",
    category: "GNSS Constellation & DOP",
    archetypeId: Nmea0183ArchetypeId.GSV,
    description:
      "Multi-sentence constellation visibility table with PRN, elevation (0–90 deg), azimuth (0–360 deg), and SNR (dB-Hz).",
    provenance: "NMEA 0183 v4.11 Standard Sentence",
    params: [
      ["SATS_IN_VIEW", 8, "1", "Total satellites currently in view"],
      ["MIN_ELEV_DEG", 5.0, "deg", "Elevation mask angle"],
      ["MIN_SNR_DBHZ", 20.0, "dB-Hz", "Minimum carrier-to-noise ratio"],
    ],
  },
  {
    formatter: "VTG",
    aliases: ["GPVTG", "GNVTG", "GLVTG", "GAVTG"],
    label: "Course Over Ground and Ground Speed (VTG)",
    category: "Navigation & Kinematics",
    archetypeId: Nmea0183ArchetypeId.VTG,
    description: "True and magnetic track made good along with ground speed in knots and km/h.",
    provenance: "NMEA 0183 v4.11 Standard Sentence",
    params: [
      ["COURSE_TRUE_DEG", 0.0, "deg", "True course over ground"],
      ["COURSE_MAG_DEG", 0.0, "deg", "Magnetic course over ground"],
      ["SPEED_KNOTS", 0.0, "kn", "Ground speed in knots"],
      ["SPEED_KMH", 0.0, "km/h", "Ground speed in km/h"],
    ],
  },
  {
    formatter: "HDG",
    aliases: ["HCHDG", "IIHDG", "HEHDG"],
    label: "Heading, Deviation and Variation (HDG)",
    category: "Navigation & Kinematics",
    archetypeId: Nmea0183ArchetypeId.HDG,
    description:
      "Magnetic sensor heading, magnetic compass deviation, and local magnetic variation for true heading calculation.",
    provenance: "NMEA 0183 v4.11 Standard Sentence",
    params: [
      ["HEADING_MAG_DEG", 0.0, "deg", "Magnetic sensor heading"],
      ["DEVIATION_DEG", 0.0, "deg", "Compass deviation (east positive)"],
      ["VARIATION_DEG", 0.0, "deg", "Magnetic variation (east positive)"],
    ],
  },
  {
    formatter: "DBT",
    aliases: ["SDDBT", "IIDBT"],
    label: "Depth Below Transducer (DBT)",
    category: "Marine Sensors",
    archetypeId: Nmea0183ArchetypeId.DBT,
    description: "Acoustic echosounder water depth below transducer reported in feet, meters, and fathoms.",
    provenance: "NMEA 0183 v4.11 Standard Sentence",
    params: [
      ["DEPTH_METERS", 10.0, "m", "Water depth below transducer in meters"],
      ["DRAFT_OFFSET_M", 0.0, "m", "Transducer draft offset below waterline"],
    ],
  },
  {
    formatter: "MWV",
    aliases: ["WIMWV", "IIMWV"],
    label: "Wind Speed and Angle (MWV)",
    category: "Marine Sensors",
    archetypeId: Nmea0183ArchetypeId.MWV,
    description: "Apparent (relative) or true wind angle and speed measured by marine anemometer.",
    provenance: "NMEA 0183 v4.11 Standard Sentence",
    params: [
      ["WIND_ANGLE_DEG", 0.0, "deg", "Wind angle (0–360 deg)"],
      ["WIND_SPEED_MPS", 0.0, "m/s", "Wind speed in meters per second"],
      ["IS_TRUE_WIND", 0, "bool", "0=Relative (R), 1=True (T)"],
    ],
  },
];

/**
 * Builds `CleanroomModelSchema[]` for all standard NMEA 0183 sentences.
 */
export function buildNmea0183CleanroomSchemas(): CleanroomModelSchema[] {
  return NMEA0183_SENTENCE_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real" as const,
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `nmea0183.std.${spec.formatter}`,
      name: spec.formatter,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "marine-navigation",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 88,
      height: 52,
      svg: generateNmea0183BlockSvg(spec.formatter, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "nmea0183ModelStep",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
