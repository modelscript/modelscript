// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom archetype IDs matching `assets/segy-std-lib/src/models.ts`.
 */
export const SegyArchetypeId = {
  // Binary Reel Header Fields
  JOB_ID: 1,
  SAMPLE_INTERVAL_US: 2,
  SAMPLE_FORMAT_CODE: 3,
  SAMPLES_PER_TRACE: 4,
  MEASUREMENT_SYSTEM: 5,
  // Trace Header Fields
  INLINE_3D: 10,
  CROSSLINE_3D: 11,
  CDP: 12,
  OFFSET_M: 13,
  TRACE_SEQ_LINE: 14,
  // Standard Seismic Wavelets
  WAVELET_RICKER: 20,
  WAVELET_ORMSBY: 21,
  WAVELET_KLAUDER: 22,
} as const;

export type SegyArchetypeId = (typeof SegyArchetypeId)[keyof typeof SegyArchetypeId];

export type SegySchemaCategory = "Binary Reel Header" | "Trace Header" | "Seismic Wavelets";

export interface SegyStdSpec {
  name: string;
  aliases?: string[];
  label: string;
  category: SegySchemaCategory;
  archetypeId: SegyArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<SegySchemaCategory, { fill: string; stroke: string; badge: string }> = {
  "Binary Reel Header": { fill: "#1e3a5f", stroke: "#38bdf8", badge: "BINH" },
  "Trace Header": { fill: "#2e2447", stroke: "#c084fc", badge: "TRCH" },
  "Seismic Wavelets": { fill: "#163b3b", stroke: "#2dd4bf", badge: "WAVE" },
};

/**
 * Generates a deterministic cleanroom parametric SVG icon for a SEG-Y standard schema.
 */
export function generateSegyBlockSvg(name: string, category: SegySchemaCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = name.toUpperCase().slice(0, 11);
  const fontSize = label.length > 9 ? "7.8" : "9.2";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 52" width="96" height="52">` +
    `<rect x="2" y="2" width="92" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="30" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="21" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="36" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForSpec(spec: SegyStdSpec): DiagramPortSpec[] {
  if (spec.category === "Seismic Wavelets") {
    return [
      { name: "time_s", kind: "signal", side: "left", dx: 0, dy: 26 },
      { name: "amplitude", kind: "signal", side: "right", dx: 96, dy: 26 },
    ];
  }
  return [
    { name: "stream_in", kind: "signal", side: "left", dx: 0, dy: 26 },
    { name: "field_out", kind: "signal", side: "right", dx: 96, dy: 26 },
  ];
}

export const SEGY_STD_SPECS: readonly SegyStdSpec[] = [
  // Binary Reel Header Fields
  {
    name: "JobID",
    aliases: ["JOB_ID", "JOBID"],
    label: "Job Identification Number",
    category: "Binary Reel Header",
    archetypeId: SegyArchetypeId.JOB_ID,
    description: "SEG-Y 400-byte binary reel header bytes 3201–3204 (int32): Job identification number.",
    provenance: "SEG-Y Rev 0 (1975) / Rev 1 (2002) Section 3.3 Bytes 3201–3204",
    params: [
      ["byteOffset", 3201, "bytes", "1-based byte offset in SEG-Y stream"],
      ["byteLength", 4, "bytes", "Field width (int32 big-endian)"],
      ["defaultValue", 1, "", "Default Job ID"],
    ],
  },
  {
    name: "SampleIntervalUs",
    aliases: ["DT", "SAMPLE_INTERVAL", "HNS_DT"],
    label: "Sample Interval (µs)",
    category: "Binary Reel Header",
    archetypeId: SegyArchetypeId.SAMPLE_INTERVAL_US,
    description: "SEG-Y binary reel header bytes 3217–3218 (uint16): Sample interval Δt in microseconds.",
    provenance: "SEG-Y Rev 0 (1975) / Rev 1 (2002) Section 3.3 Bytes 3217–3218",
    params: [
      ["byteOffset", 3217, "bytes", "1-based byte offset in SEG-Y stream"],
      ["byteLength", 2, "bytes", "Field width (uint16 big-endian)"],
      ["defaultValue", 2000, "us", "Nominal sample interval (2 ms = 2000 µs)"],
    ],
  },
  {
    name: "SampleFormatCode",
    aliases: ["FORMAT", "SAMPLE_FORMAT"],
    label: "Data Sample Format Code",
    category: "Binary Reel Header",
    archetypeId: SegyArchetypeId.SAMPLE_FORMAT_CODE,
    description:
      "SEG-Y binary reel header bytes 3225–3226 (int16): 1=IBM float32, 2=int32, 3=int16, 5=IEEE float32, 8=int8.",
    provenance: "SEG-Y Rev 0 (1975) / Rev 1 (2002) Section 3.3 Bytes 3225–3226",
    params: [
      ["byteOffset", 3225, "bytes", "1-based byte offset in SEG-Y stream"],
      ["byteLength", 2, "bytes", "Field width (int16 big-endian)"],
      ["defaultValue", 1, "", "Default format code (1 = IBM System/360 float32)"],
    ],
  },
  {
    name: "SamplesPerTrace",
    aliases: ["NS", "HNS"],
    label: "Samples Per Data Trace",
    category: "Binary Reel Header",
    archetypeId: SegyArchetypeId.SAMPLES_PER_TRACE,
    description: "SEG-Y binary reel header bytes 3221–3222 (uint16): Number of samples per data trace.",
    provenance: "SEG-Y Rev 0 (1975) / Rev 1 (2002) Section 3.3 Bytes 3221–3222",
    params: [
      ["byteOffset", 3221, "bytes", "1-based byte offset in SEG-Y stream"],
      ["byteLength", 2, "bytes", "Field width (uint16 big-endian)"],
      ["defaultValue", 512, "samples", "Default number of samples per trace"],
    ],
  },
  {
    name: "MeasurementSystem",
    aliases: ["MEAS_SYS", "UNITS"],
    label: "Measurement System",
    category: "Binary Reel Header",
    archetypeId: SegyArchetypeId.MEASUREMENT_SYSTEM,
    description: "SEG-Y binary reel header bytes 3255–3256 (int16): 1 = Meters, 2 = Feet.",
    provenance: "SEG-Y Rev 0 (1975) / Rev 1 (2002) Section 3.3 Bytes 3255–3256",
    params: [
      ["byteOffset", 3255, "bytes", "1-based byte offset in SEG-Y stream"],
      ["byteLength", 2, "bytes", "Field width (int16 big-endian)"],
      ["defaultValue", 1, "", "1 = Meters, 2 = Feet"],
    ],
  },

  // Trace Header Fields
  {
    name: "Inline3D",
    aliases: ["INLINE", "IL"],
    label: "3D Poststack Inline Number",
    category: "Trace Header",
    archetypeId: SegyArchetypeId.INLINE_3D,
    description: "SEG-Y Rev 1 trace header bytes 189–192 (int32): 3D poststack inline number.",
    provenance: "SEG-Y Rev 1 (2002) Section 3.5 Bytes 189–192",
    params: [
      ["byteOffset", 189, "bytes", "1-based byte offset within 240-byte trace header"],
      ["byteLength", 4, "bytes", "Field width (int32 big-endian)"],
      ["defaultValue", 1, "", "Default inline number"],
    ],
  },
  {
    name: "Crossline3D",
    aliases: ["CROSSLINE", "XL", "XLINE"],
    label: "3D Poststack Crossline Number",
    category: "Trace Header",
    archetypeId: SegyArchetypeId.CROSSLINE_3D,
    description: "SEG-Y Rev 1 trace header bytes 193–196 (int32): 3D poststack crossline number.",
    provenance: "SEG-Y Rev 1 (2002) Section 3.5 Bytes 193–196",
    params: [
      ["byteOffset", 193, "bytes", "1-based byte offset within 240-byte trace header"],
      ["byteLength", 4, "bytes", "Field width (int32 big-endian)"],
      ["defaultValue", 1, "", "Default crossline number"],
    ],
  },
  {
    name: "CDP",
    aliases: ["ENSEMBLE", "CMP"],
    label: "Ensemble / CDP Number",
    category: "Trace Header",
    archetypeId: SegyArchetypeId.CDP,
    description: "SEG-Y trace header bytes 21–24 (int32): Ensemble (CDP / CMP) number.",
    provenance: "SEG-Y Rev 0 (1975) / Rev 1 (2002) Section 3.5 Bytes 21–24",
    params: [
      ["byteOffset", 21, "bytes", "1-based byte offset within 240-byte trace header"],
      ["byteLength", 4, "bytes", "Field width (int32 big-endian)"],
      ["defaultValue", 1, "", "Default CDP number"],
    ],
  },
  {
    name: "OffsetM",
    aliases: ["OFFSET", "SOURCE_RECEIVER_OFFSET"],
    label: "Source-Receiver Offset (m)",
    category: "Trace Header",
    archetypeId: SegyArchetypeId.OFFSET_M,
    description:
      "SEG-Y trace header bytes 37–40 (int32): Distance from center of source point to center of receiver group.",
    provenance: "SEG-Y Rev 0 (1975) / Rev 1 (2002) Section 3.5 Bytes 37–40",
    params: [
      ["byteOffset", 37, "bytes", "1-based byte offset within 240-byte trace header"],
      ["byteLength", 4, "bytes", "Field width (int32 big-endian)"],
      ["defaultValue", 0, "m", "Default source-receiver offset"],
    ],
  },
  {
    name: "TraceSeqLine",
    aliases: ["TRACL", "TRACE_SEQ"],
    label: "Trace Sequence Number Within Line",
    category: "Trace Header",
    archetypeId: SegyArchetypeId.TRACE_SEQ_LINE,
    description: "SEG-Y trace header bytes 1–4 (int32): Trace sequence number within line.",
    provenance: "SEG-Y Rev 0 (1975) / Rev 1 (2002) Section 3.5 Bytes 1–4",
    params: [
      ["byteOffset", 1, "bytes", "1-based byte offset within 240-byte trace header"],
      ["byteLength", 4, "bytes", "Field width (int32 big-endian)"],
      ["defaultValue", 1, "", "Default starting trace sequence number"],
    ],
  },

  // Standard Seismic Wavelets
  {
    name: "Ricker",
    aliases: ["RICKER_WAVELET", "MEXICAN_HAT"],
    label: "Ricker Zero-Phase Wavelet",
    category: "Seismic Wavelets",
    archetypeId: SegyArchetypeId.WAVELET_RICKER,
    description: "Zero-phase Ricker wavelet w(t) = (1 - 2*pi^2*f0^2*t^2) * exp(-pi^2*f0^2*t^2).",
    provenance: "Ricker (1953), Geophysics 18(1), 10–40",
    params: [
      ["f0Hz", 30.0, "Hz", "Dominant peak frequency"],
      ["dtSec", 0.002, "s", "Sample interval"],
      ["delaySec", 0.0, "s", "Zero-phase center delay"],
    ],
  },
  {
    name: "Ormsby",
    aliases: ["ORMSBY_WAVELET", "TRAPEZOIDAL_WAVELET"],
    label: "Ormsby Trapezoidal Wavelet",
    category: "Seismic Wavelets",
    archetypeId: SegyArchetypeId.WAVELET_ORMSBY,
    description: "Zero-phase Ormsby trapezoidal bandpass wavelet defined by corner frequencies f1 < f2 < f3 < f4.",
    provenance: "Ryan (1994), CSEG Recorder — Ricker, Ormsby, Klauder, Butterworth",
    params: [
      ["f1Hz", 5.0, "Hz", "Low-cut frequency"],
      ["f2Hz", 10.0, "Hz", "Low-pass frequency"],
      ["f3Hz", 40.0, "Hz", "High-pass frequency"],
      ["f4Hz", 55.0, "Hz", "High-cut frequency"],
    ],
  },
  {
    name: "Klauder",
    aliases: ["KLAUDER_WAVELET", "VIBROSEIS_WAVELET"],
    label: "Klauder Vibroseis Wavelet",
    category: "Seismic Wavelets",
    archetypeId: SegyArchetypeId.WAVELET_KLAUDER,
    description: "Zero-phase autocorrelation of a linear FM Vibroseis sweep from fLow to fHigh over duration T.",
    provenance: "Klauder et al. (1960), Bell System Technical Journal 39(4), 745–808",
    params: [
      ["fLowHz", 10.0, "Hz", "Sweep start frequency"],
      ["fHighHz", 60.0, "Hz", "Sweep end frequency"],
      ["sweepLenSec", 8.0, "s", "Vibroseis sweep length"],
    ],
  },
];

/**
 * Builds declarative `CleanroomModelSchema[]` for `@modelscript/segy-std-lib`.
 */
export function buildSegyCleanroomSchemas(): CleanroomModelSchema[] {
  return SEGY_STD_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `SEGY.${spec.name}`,
      name: spec.name,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "geophysics",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 96,
      height: 52,
      svg: generateSegyBlockSvg(spec.name, spec.category),
      ports: defaultPortsForSpec(spec),
      parameters,
      wasmKernel: "evalSegyKernel",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}
