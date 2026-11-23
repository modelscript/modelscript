// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * NEC-2 cleanroom antenna archetype IDs matching `assets/nec2-std-lib/src/models.ts`.
 */
export const Nec2ArchetypeId = {
  HALF_WAVE_DIPOLE: 1,
  QUARTER_WAVE_MONOPOLE: 2,
  FOLDED_DIPOLE: 3,
  YAGI_UDA_3EL: 4,
  CIRCULAR_LOOP: 5,
  GROUND_PLANE: 6,
} as const;

export type Nec2ArchetypeId = (typeof Nec2ArchetypeId)[keyof typeof Nec2ArchetypeId];

export type Nec2AntennaCategory = "Dipoles" | "Monopoles" | "Arrays" | "Loops";

export interface Nec2AntennaSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: Nec2AntennaCategory;
  archetypeId: Nec2ArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<Nec2AntennaCategory, { fill: string; stroke: string; badge: string }> = {
  Dipoles: { fill: "#1e3a5f", stroke: "#38bdf8", badge: "DIPL" },
  Monopoles: { fill: "#163b3b", stroke: "#2dd4bf", badge: "MONO" },
  Arrays: { fill: "#4a1d1d", stroke: "#fb923c", badge: "YAGI" },
  Loops: { fill: "#2e2447", stroke: "#c084fc", badge: "LOOP" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for a NEC-2 wire antenna archetype.
 */
export function generateNec2BlockSvg(modelType: string, category: Nec2AntennaCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  const fontSize = label.length > 9 ? "7.4" : "8.6";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 56" width="96" height="56">` +
    `<rect x="2" y="2" width="92" height="52" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.2" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="38" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

const DEFAULT_ANTENNA_PORTS: DiagramPortSpec[] = [
  { name: "rf_feed", kind: "electrical", side: "left", dx: 0, dy: 28 },
  { name: "far_field", kind: "signal", side: "right", dx: 96, dy: 28 },
];

export const NEC2_STD_SPECS: readonly Nec2AntennaSpec[] = [
  {
    modelType: "HALF_WAVE_DIPOLE",
    aliases: ["DIPOLE", "HalfWaveDipole", "LambdaOver2Dipole"],
    label: "Half-Wave Dipole",
    category: "Dipoles",
    archetypeId: Nec2ArchetypeId.HALF_WAVE_DIPOLE,
    description:
      "Center-fed thin half-wave wire dipole (L = λ/2) in free space. Nominal feedpoint impedance Z_in ≈ 73 + j42.5 Ω, peak directivity 2.15 dBi.",
    provenance: "LLNL NEC-2 / Balanis Antenna Theory Ch. 4",
    params: [
      ["FREQ_MHZ", 300.0, "MHz", "Design operating frequency"],
      ["LENGTH_M", 0.5, "m", "Total dipole length (λ/2 at 300 MHz)"],
      ["RADIUS_M", 0.001, "m", "Wire radius"],
      ["SEGMENTS", 21, "1", "Odd number of wire segments"],
      ["Z0_OHM", 50.0, "Ohm", "Reference characteristic impedance"],
    ],
  },
  {
    modelType: "QUARTER_WAVE_MONOPOLE",
    aliases: ["MONOPOLE", "QuarterWaveMonopole", "VerticalMonopole"],
    label: "Quarter-Wave Monopole",
    category: "Monopoles",
    archetypeId: Nec2ArchetypeId.QUARTER_WAVE_MONOPOLE,
    description:
      "Base-fed vertical quarter-wave monopole (L = λ/4) over an infinite PEC ground plane. Nominal feedpoint impedance Z_in ≈ 36.5 + j21.2 Ω, peak directivity 5.16 dBi.",
    provenance: "LLNL NEC-2 / Balanis Antenna Theory Ch. 4 (Image Theory)",
    params: [
      ["FREQ_MHZ", 300.0, "MHz", "Design operating frequency"],
      ["HEIGHT_M", 0.25, "m", "Monopole height above PEC ground (λ/4 at 300 MHz)"],
      ["RADIUS_M", 0.001, "m", "Wire radius"],
      ["SEGMENTS", 11, "1", "Number of vertical wire segments"],
      ["Z0_OHM", 50.0, "Ohm", "Reference characteristic impedance"],
    ],
  },
  {
    modelType: "FOLDED_DIPOLE",
    aliases: ["FoldedDipole", "TWIN_DIPOLE"],
    label: "Folded Dipole",
    category: "Dipoles",
    archetypeId: Nec2ArchetypeId.FOLDED_DIPOLE,
    description:
      "Half-wave folded wire dipole with 4:1 step-up impedance transformation (Z_in ≈ 292 Ω at resonance) and wider impedance bandwidth.",
    provenance: "LLNL NEC-2 / Kraus Antennas Ch. 11",
    params: [
      ["FREQ_MHZ", 300.0, "MHz", "Design operating frequency"],
      ["LENGTH_M", 0.48, "m", "Folded dipole overall length"],
      ["SPACING_M", 0.02, "m", "Center-to-center spacing between parallel conductors"],
      ["RADIUS_M", 0.001, "m", "Wire radius"],
      ["Z0_OHM", 300.0, "Ohm", "Reference balanced feedline impedance"],
    ],
  },
  {
    modelType: "YAGI_UDA_3EL",
    aliases: ["YAGI", "YagiUda3El", "YAGI3"],
    label: "3-Element Yagi-Uda",
    category: "Arrays",
    archetypeId: Nec2ArchetypeId.YAGI_UDA_3EL,
    description:
      "Directional 3-element Yagi-Uda parasitic wire array (reflector, driven dipole, director) delivering ~7–8 dBi forward gain.",
    provenance: "LLNL NEC-2 / Balanis Antenna Theory Ch. 10",
    params: [
      ["FREQ_MHZ", 300.0, "MHz", "Design operating frequency"],
      ["REFLECTOR_M", 0.5, "m", "Reflector element length (~0.50λ)"],
      ["DRIVEN_M", 0.47, "m", "Driven element length (~0.47λ)"],
      ["DIRECTOR_M", 0.44, "m", "Director element length (~0.44λ)"],
      ["SPACING_M", 0.2, "m", "Inter-element boom spacing (~0.20λ)"],
      ["RADIUS_M", 0.002, "m", "Element wire radius"],
    ],
  },
  {
    modelType: "CIRCULAR_LOOP",
    aliases: ["LOOP", "CircularLoop", "FullWaveLoop"],
    label: "Circular Loop",
    category: "Loops",
    archetypeId: Nec2ArchetypeId.CIRCULAR_LOOP,
    description:
      "Full-wave circular wire loop antenna (circumference C ≈ 1.0λ) with ~100–125 Ω feedpoint resistance and ~3.1 dBi broadside directivity.",
    provenance: "LLNL NEC-2 / Balanis Antenna Theory Ch. 5",
    params: [
      ["FREQ_MHZ", 300.0, "MHz", "Design operating frequency"],
      ["LOOP_RADIUS_M", 0.1592, "m", "Loop radius (C = 2πR ≈ 1.0λ at 300 MHz)"],
      ["WIRE_RADIUS_M", 0.001, "m", "Wire radius"],
      ["SEGMENTS", 24, "1", "Number of polygonal loop segments"],
      ["Z0_OHM", 50.0, "Ohm", "Reference characteristic impedance"],
    ],
  },
  {
    modelType: "GROUND_PLANE",
    aliases: ["GroundPlane", "GP_ANTENNA", "DROOPING_RADIALS"],
    label: "Ground Plane Antenna",
    category: "Monopoles",
    archetypeId: Nec2ArchetypeId.GROUND_PLANE,
    description:
      "Quarter-wave vertical radiator with four drooping λ/4 radials (45° droop) providing a natural ~50 Ω match in free space.",
    provenance: "LLNL NEC-2 / ARRL Antenna Book",
    params: [
      ["FREQ_MHZ", 300.0, "MHz", "Design operating frequency"],
      ["RADIATOR_M", 0.24, "m", "Vertical radiator length (~0.24λ)"],
      ["RADIAL_M", 0.25, "m", "Radial length (~0.25λ)"],
      ["DROOP_DEG", 45.0, "deg", "Radial droop angle below horizontal"],
      ["RADIUS_M", 0.001, "m", "Wire radius"],
    ],
  },
];

/**
 * Builds `CleanroomModelSchema[]` for `@modelscript/nec2-std-lib`.
 */
export function buildNec2CleanroomSchemas(): CleanroomModelSchema[] {
  return NEC2_STD_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));

    return {
      namePath: `NEC2.Antennas.${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases ?? [],
      label: spec.label,
      category: spec.category,
      domain: "electromagnetics",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "Class",
      width: 96,
      height: 56,
      svg: generateNec2BlockSvg(spec.modelType, spec.category),
      ports: DEFAULT_ANTENNA_PORTS,
      parameters,
      wasmKernel: "nec2ModelStep",
      extra: { archetypeId: spec.archetypeId },
    };
  });
}

/**
 * Generates a ready-to-solve NEC-2 deck string for any standard antenna archetype.
 */
export function generateNec2ArchetypeDeck(modelType: string, overrides: Record<string, number> = {}): string {
  const key = modelType.trim().toUpperCase();
  const freq = overrides["FREQ_MHZ"] ?? 300.0;
  const radius = overrides["RADIUS_M"] ?? 0.001;

  switch (key) {
    case "QUARTER_WAVE_MONOPOLE":
    case "MONOPOLE": {
      const h = overrides["HEIGHT_M"] ?? 0.25;
      const segs = Math.max(5, Math.trunc(overrides["SEGMENTS"] ?? 11));
      return [
        "CM Quarter-Wave Monopole over PEC Ground",
        "CE",
        `GW 1 ${segs} 0 0 0 0 0 ${h} ${radius}`,
        "GE 1",
        "GN 1",
        `FR 0 1 0 0 ${freq} 0`,
        "EX 0 1 1 0 1.0 0.0",
        "RP 0 19 1 1000 0 0 5 0",
        "EN",
      ].join("\n");
    }
    case "FOLDED_DIPOLE": {
      const l = overrides["LENGTH_M"] ?? 0.48;
      const s = overrides["SPACING_M"] ?? 0.02;
      const hl = l / 2;
      const hs = s / 2;
      return [
        "CM Half-Wave Folded Dipole",
        "CE",
        `GW 1 15 0 ${-hs} ${-hl} 0 ${-hs} ${hl} ${radius}`,
        `GW 2 15 0 ${hs} ${-hl} 0 ${hs} ${hl} ${radius}`,
        `GW 3 2 0 ${-hs} ${hl} 0 ${hs} ${hl} ${radius}`,
        `GW 4 2 0 ${-hs} ${-hl} 0 ${hs} ${-hl} ${radius}`,
        "GE 0",
        `FR 0 1 0 0 ${freq} 0`,
        "EX 0 1 8 0 1.0 0.0",
        "RP 0 37 1 1000 0 0 5 0",
        "EN",
      ].join("\n");
    }
    case "YAGI_UDA_3EL":
    case "YAGI": {
      const rLen = (overrides["REFLECTOR_M"] ?? 0.5) / 2;
      const dLen = (overrides["DRIVEN_M"] ?? 0.47) / 2;
      const dirLen = (overrides["DIRECTOR_M"] ?? 0.44) / 2;
      const sp = overrides["SPACING_M"] ?? 0.2;
      const r = overrides["RADIUS_M"] ?? 0.002;
      return [
        "CM 3-Element Yagi-Uda Directional Array",
        "CE",
        `GW 1 15 ${-sp} ${-rLen} 0 ${-sp} ${rLen} 0 ${r}`,
        `GW 2 15 0 ${-dLen} 0 0 ${dLen} 0 ${r}`,
        `GW 3 15 ${sp} ${-dirLen} 0 ${sp} ${dirLen} 0 ${r}`,
        "GE 0",
        `FR 0 1 0 0 ${freq} 0`,
        "EX 0 2 8 0 1.0 0.0",
        "RP 0 37 1 1000 0 0 5 0",
        "EN",
      ].join("\n");
    }
    case "CIRCULAR_LOOP":
    case "LOOP": {
      const loopR = overrides["LOOP_RADIUS_M"] ?? 0.1592;
      const segs = Math.max(8, Math.trunc(overrides["SEGMENTS"] ?? 24));
      const wireR = overrides["WIRE_RADIUS_M"] ?? 0.001;
      return [
        "CM Full-Wave Circular Loop Antenna",
        "CE",
        `GA 1 ${segs} ${loopR} 0 360 ${wireR}`,
        "GE 0",
        `FR 0 1 0 0 ${freq} 0`,
        "EX 0 1 1 0 1.0 0.0",
        "RP 0 37 1 1000 0 0 5 0",
        "EN",
      ].join("\n");
    }
    case "GROUND_PLANE":
    case "GP_ANTENNA": {
      const rad = overrides["RADIATOR_M"] ?? 0.24;
      const rdl = overrides["RADIAL_M"] ?? 0.25;
      const droop = ((overrides["DROOP_DEG"] ?? 45.0) * Math.PI) / 180;
      const rh = rdl * Math.cos(droop);
      const rz = -rdl * Math.sin(droop);
      return [
        "CM Quarter-Wave Ground Plane Antenna (4 Drooping Radials)",
        "CE",
        `GW 1 9 0 0 0 0 0 ${rad} ${radius}`,
        `GW 2 9 0 0 0 ${rh.toFixed(5)} 0 ${rz.toFixed(5)} ${radius}`,
        `GW 3 9 0 0 0 ${(-rh).toFixed(5)} 0 ${rz.toFixed(5)} ${radius}`,
        `GW 4 9 0 0 0 0 ${rh.toFixed(5)} ${rz.toFixed(5)} ${radius}`,
        `GW 5 9 0 0 0 0 ${(-rh).toFixed(5)} ${rz.toFixed(5)} ${radius}`,
        "GE 0",
        `FR 0 1 0 0 ${freq} 0`,
        "EX 0 1 1 0 1.0 0.0",
        "RP 0 37 1 1000 0 0 5 0",
        "EN",
      ].join("\n");
    }
    case "HALF_WAVE_DIPOLE":
    case "DIPOLE":
    default: {
      const l = overrides["LENGTH_M"] ?? 0.5;
      const hl = l / 2;
      const segs = Math.max(5, Math.trunc(overrides["SEGMENTS"] ?? 21));
      const mid = Math.floor(segs / 2) + 1;
      return [
        "CM Half-Wave Thin Wire Dipole",
        "CE",
        `GW 1 ${segs} 0 0 ${-hl} 0 0 ${hl} ${radius}`,
        "GE 0",
        `FR 0 1 0 0 ${freq} 0`,
        `EX 0 1 ${mid} 0 1.0 0.0`,
        "RP 0 37 1 1000 0 0 5 0",
        "EN",
      ].join("\n");
    }
  }
}
