// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";
import type { Arinc429Encoding } from "../types.js";

/**
 * ARINC 429 cleanroom equipment label archetype IDs matching `assets/arinc429-std-lib/src/models.ts`.
 */
export const Arinc429ArchetypeId = {
  // Air Data Computer (ADC — Equipment ID 006 / 038)
  ADC_ALTITUDE_203: 1,
  ADC_MACH_205: 2,
  ADC_AIRSPEED_206: 3,
  ADC_TAT_211: 4,
  // Inertial Reference System (IRS — Equipment ID 004 / 032)
  IRS_LATITUDE_310: 10,
  IRS_LONGITUDE_311: 11,
  IRS_HEADING_314: 12,
  IRS_PITCH_324: 13,
  IRS_ROLL_325: 14,
  // Low-Range Radio Altimeter (LRRA — Equipment ID 007)
  LRRA_RADIO_ALT_164: 20,
} as const;

export type Arinc429ArchetypeId = (typeof Arinc429ArchetypeId)[keyof typeof Arinc429ArchetypeId];

export type Arinc429EquipmentCategory = "Air Data Computer" | "Inertial Reference System" | "Radio Altimeter";

export interface Arinc429StandardLabelSpec {
  modelType: string;
  labelOctal: string;
  labelValue: number;
  name: string;
  aliases?: string[];
  equipment: string;
  category: Arinc429EquipmentCategory;
  archetypeId: Arinc429ArchetypeId;
  encoding: Arinc429Encoding;
  range: number;
  resolution: number;
  units: string;
  defaultRateHz: number;
  description: string;
  provenance: string;
}

const CATEGORY_COLORS: Record<Arinc429EquipmentCategory, { fill: string; stroke: string; badge: string }> = {
  "Air Data Computer": { fill: "#172554", stroke: "#38bdf8", badge: "ADC" },
  "Inertial Reference System": { fill: "#1e1b4b", stroke: "#a78bfa", badge: "IRS" },
  "Radio Altimeter": { fill: "#14332a", stroke: "#34d399", badge: "LRRA" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an ARINC 429 equipment label.
 */
export function generateArinc429BlockSvg(
  labelOctal: string,
  name: string,
  category: Arinc429EquipmentCategory,
): string {
  const c = CATEGORY_COLORS[category];
  const shortName = name.toUpperCase().slice(0, 10);
  const fontSize = shortName.length > 8 ? "7.8" : "9.0";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 54" width="96" height="54">` +
    `<rect x="2" y="2" width="92" height="50" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="32" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="22" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="72" y="15" text-anchor="middle" font-family="monospace" font-size="8.0" font-weight="bold" fill="#fde68a">L${labelOctal}</text>` +
    `<text x="48" y="38" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${shortName}</text>` +
    `</svg>`
  );
}

/**
 * Standard ARINC 429 Part 1 commercial avionics equipment label definitions.
 */
export const ARINC429_STANDARD_LABELS: readonly Arinc429StandardLabelSpec[] = [
  {
    modelType: "ADC_ALTITUDE_203",
    labelOctal: "203",
    labelValue: 0o203,
    name: "ALTITUDE",
    aliases: ["203", "PRESSURE_ALTITUDE", "BARO_ALT"],
    equipment: "ADC",
    category: "Air Data Computer",
    archetypeId: Arinc429ArchetypeId.ADC_ALTITUDE_203,
    encoding: "BNR",
    range: 131072,
    resolution: 0.5,
    units: "ft",
    defaultRateHz: 20,
    description:
      "Pressure Altitude (1013.25 hPa standard datum) transmitted by Air Data Computer (ARINC 429 Label 203).",
    provenance: "ARINC Specification 429P1-18 Attachment 2 — Air Data Computer Label 203",
  },
  {
    modelType: "ADC_MACH_205",
    labelOctal: "205",
    labelValue: 0o205,
    name: "MACH",
    aliases: ["205", "MACH_NUMBER"],
    equipment: "ADC",
    category: "Air Data Computer",
    archetypeId: Arinc429ArchetypeId.ADC_MACH_205,
    encoding: "BNR",
    range: 4.096,
    resolution: 0.000015625,
    units: "Mach",
    defaultRateHz: 20,
    description: "Mach Number transmitted by Air Data Computer (ARINC 429 Label 205, BNR 18-bit).",
    provenance: "ARINC Specification 429P1-18 Attachment 2 — Air Data Computer Label 205",
  },
  {
    modelType: "ADC_AIRSPEED_206",
    labelOctal: "206",
    labelValue: 0o206,
    name: "AIRSPEED",
    aliases: ["206", "CAS", "COMPUTED_AIRSPEED"],
    equipment: "ADC",
    category: "Air Data Computer",
    archetypeId: Arinc429ArchetypeId.ADC_AIRSPEED_206,
    encoding: "BNR",
    range: 1024,
    resolution: 0.00390625,
    units: "kt",
    defaultRateHz: 20,
    description: "Computed Airspeed (CAS) in knots transmitted by Air Data Computer (ARINC 429 Label 206).",
    provenance: "ARINC Specification 429P1-18 Attachment 2 — Air Data Computer Label 206",
  },
  {
    modelType: "ADC_TAT_211",
    labelOctal: "211",
    labelValue: 0o211,
    name: "TOTAL_AIR_TEMP",
    aliases: ["211", "TAT"],
    equipment: "ADC",
    category: "Air Data Computer",
    archetypeId: Arinc429ArchetypeId.ADC_TAT_211,
    encoding: "BNR",
    range: 512,
    resolution: 0.001953125,
    units: "degC",
    defaultRateHz: 4,
    description:
      "Total Air Temperature (TAT) in degrees Celsius transmitted by Air Data Computer (ARINC 429 Label 211).",
    provenance: "ARINC Specification 429P1-18 Attachment 2 — Air Data Computer Label 211",
  },
  {
    modelType: "IRS_LATITUDE_310",
    labelOctal: "310",
    labelValue: 0o310,
    name: "LATITUDE",
    aliases: ["310", "PPOS_LAT"],
    equipment: "IRS",
    category: "Inertial Reference System",
    archetypeId: Arinc429ArchetypeId.IRS_LATITUDE_310,
    encoding: "BNR",
    range: 180,
    resolution: 180 / 262144,
    units: "deg",
    defaultRateHz: 10,
    description: "Present Position Latitude (+/-180 deg, North positive) from Inertial Reference System (Label 310).",
    provenance: "ARINC Specification 429P1-18 Attachment 2 — IRS Label 310",
  },
  {
    modelType: "IRS_LONGITUDE_311",
    labelOctal: "311",
    labelValue: 0o311,
    name: "LONGITUDE",
    aliases: ["311", "PPOS_LON"],
    equipment: "IRS",
    category: "Inertial Reference System",
    archetypeId: Arinc429ArchetypeId.IRS_LONGITUDE_311,
    encoding: "BNR",
    range: 180,
    resolution: 180 / 262144,
    units: "deg",
    defaultRateHz: 10,
    description: "Present Position Longitude (+/-180 deg, East positive) from Inertial Reference System (Label 311).",
    provenance: "ARINC Specification 429P1-18 Attachment 2 — IRS Label 311",
  },
  {
    modelType: "IRS_HEADING_314",
    labelOctal: "314",
    labelValue: 0o314,
    name: "HEADING",
    aliases: ["314", "TRUE_HEADING"],
    equipment: "IRS",
    category: "Inertial Reference System",
    archetypeId: Arinc429ArchetypeId.IRS_HEADING_314,
    encoding: "BNR",
    range: 180,
    resolution: 180 / 262144,
    units: "deg",
    defaultRateHz: 25,
    description: "True Heading (+/-180 deg) from Inertial Reference System (ARINC 429 Label 314).",
    provenance: "ARINC Specification 429P1-18 Attachment 2 — IRS Label 314",
  },
  {
    modelType: "IRS_PITCH_324",
    labelOctal: "324",
    labelValue: 0o324,
    name: "PITCH",
    aliases: ["324", "PITCH_ANGLE"],
    equipment: "IRS",
    category: "Inertial Reference System",
    archetypeId: Arinc429ArchetypeId.IRS_PITCH_324,
    encoding: "BNR",
    range: 180,
    resolution: 180 / 262144,
    units: "deg",
    defaultRateHz: 50,
    description: "Pitch Angle (+/-180 deg, nose-up positive) from Inertial Reference System (ARINC 429 Label 324).",
    provenance: "ARINC Specification 429P1-18 Attachment 2 — IRS Label 324",
  },
  {
    modelType: "IRS_ROLL_325",
    labelOctal: "325",
    labelValue: 0o325,
    name: "ROLL",
    aliases: ["325", "ROLL_ANGLE"],
    equipment: "IRS",
    category: "Inertial Reference System",
    archetypeId: Arinc429ArchetypeId.IRS_ROLL_325,
    encoding: "BNR",
    range: 180,
    resolution: 180 / 262144,
    units: "deg",
    defaultRateHz: 50,
    description:
      "Roll Angle (+/-180 deg, right-wing-down positive) from Inertial Reference System (ARINC 429 Label 325).",
    provenance: "ARINC Specification 429P1-18 Attachment 2 — IRS Label 325",
  },
  {
    modelType: "LRRA_RADIO_ALT_164",
    labelOctal: "164",
    labelValue: 0o164,
    name: "RADIO_ALTITUDE",
    aliases: ["164", "RADIO_HEIGHT", "LRRA"],
    equipment: "LRRA",
    category: "Radio Altimeter",
    archetypeId: Arinc429ArchetypeId.LRRA_RADIO_ALT_164,
    encoding: "BNR",
    range: 8192,
    resolution: 0.03125,
    units: "ft",
    defaultRateHz: 20,
    description: "Radio Height Above Ground Level (AGL) from Low-Range Radio Altimeter (ARINC 429 Label 164).",
    provenance: "ARINC Specification 429P1-18 Attachment 2 — Radio Altimeter Label 164",
  },
];

export const STANDARD_LABEL_BY_OCTAL: ReadonlyMap<string, Arinc429StandardLabelSpec> = new Map(
  ARINC429_STANDARD_LABELS.map((s) => [s.labelOctal, s]),
);

export function lookupStandardArinc429Label(labelOctal: string): Arinc429StandardLabelSpec | undefined {
  return STANDARD_LABEL_BY_OCTAL.get(labelOctal.padStart(3, "0"));
}

function portsForArinc429Label(): DiagramPortSpec[] {
  return [
    { name: "sensor_in", kind: "signal", side: "left", dx: 0, dy: 27 },
    { name: "a429_tx", kind: "bus", side: "right", dx: 96, dy: 27 },
  ];
}

/**
 * Converts `ARINC429_STANDARD_LABELS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`.
 */
export function buildArinc429CleanroomSchemas(): CleanroomModelSchema[] {
  return ARINC429_STANDARD_LABELS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = [
      {
        key: "labelValue",
        type: "real",
        defaultValue: spec.labelValue,
        unit: "oct",
        description: `Octal label ${spec.labelOctal}`,
      },
      {
        key: "range",
        type: "real",
        defaultValue: spec.range,
        unit: spec.units,
        description: "Full-scale engineering range",
      },
      {
        key: "resolution",
        type: "real",
        defaultValue: spec.resolution,
        unit: spec.units,
        description: "LSB engineering resolution",
      },
      { key: "rateHz", type: "real", defaultValue: spec.defaultRateHz, unit: "Hz", description: "Nominal update rate" },
    ];
    return {
      namePath: `arinc429:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: `${spec.equipment} Label ${spec.labelOctal} (${spec.name})`,
      category: spec.category,
      domain: "aerospace",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "arinc429_label",
      width: 96,
      height: 54,
      svg: generateArinc429BlockSvg(spec.labelOctal, spec.name, spec.category),
      ports: portsForArinc429Label(),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
        labelOctal: spec.labelOctal,
        encoding: spec.encoding,
        equipment: spec.equipment,
        units: spec.units,
      },
    };
  });
}
