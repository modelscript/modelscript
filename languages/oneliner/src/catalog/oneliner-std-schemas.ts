// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * ASPEN OneLiner cleanroom protection & sequence equipment archetype IDs
 * matching `assets/oneliner-std-lib/src/models.ts`.
 */
export const OneLinerArchetypeId = {
  OVERCURRENT_INVERSE: 1, // OC_IEEE_MI, OC_IEEE_VI, OC_IEEE_EI, OC_IEC_*, OC_US_*
  OVERCURRENT_INST: 2, // OC_INST_50
  DISTANCE_MHO: 10, // DIST_MHO_Z1, DIST_MHO_Z2
  DISTANCE_QUAD: 11, // DIST_QUAD_Z1, DIST_QUAD_Z2
  DIFFERENTIAL_87: 20, // DIFF_87L, DIFF_87T, DIFF_87B
  DIRECTIONAL_67: 30, // DIR_67P, DIR_67G
  RECLOSER_79: 31, // RECLOSER_79
  FUSE_LINK: 32, // FUSE_K_LINK, FUSE_T_LINK
  BREAKER_52: 33, // BREAKER_52
  SEQ_LINE: 40, // LINE_138kV_ACSR, LINE_230kV_ACSR, LINE_500kV_BUNDLE
  SEQ_TRANSFORMER: 41, // XFMR_YND1, XFMR_YY_AUTO
} as const;

export type OneLinerArchetypeId = (typeof OneLinerArchetypeId)[keyof typeof OneLinerArchetypeId];

export interface OneLinerModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: "Overcurrent Relay" | "Distance & Differential" | "Directional / Recloser / Fuse" | "Sequence Equipment";
  archetypeId: OneLinerArchetypeId;
  ansiCode?: string;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<OneLinerModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
  "Overcurrent Relay": { fill: "#3b1d1d", stroke: "#f87171", badge: "50/51" },
  "Distance & Differential": { fill: "#1e2f4d", stroke: "#60a5fa", badge: "21/87" },
  "Directional / Recloser / Fuse": { fill: "#3f2e18", stroke: "#fbbf24", badge: "67/79" },
  "Sequence Equipment": { fill: "#163b3b", stroke: "#2dd4bf", badge: "SEQ" },
};

/**
 * Generates a deterministic cleanroom parametric SVG icon for an ASPEN OneLiner
 * protection relay or sequence network equipment model.
 */
export function generateOneLinerBlockSvg(
  modelType: string,
  category: OneLinerModelSpec["category"],
  ansiCode?: string,
): string {
  const c = CATEGORY_COLORS[category];
  const badge = (ansiCode ?? c.badge).slice(0, 6);
  const label = modelType.toUpperCase().slice(0, 12);

  if (category === "Overcurrent Relay" || category === "Directional / Recloser / Fuse") {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
      `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
      `<circle cx="18" cy="17" r="9" fill="none" stroke="${c.stroke}" stroke-width="1.5"/>` +
      `<text x="18" y="20" text-anchor="middle" font-family="monospace" font-size="7" font-weight="bold" fill="${c.stroke}">${badge}</text>` +
      `<path d="M 33 23 Q 42 10 66 10" fill="none" stroke="${c.stroke}" stroke-width="1.3" stroke-opacity="0.8"/>` +
      `<text x="44" y="40" text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
      `</svg>`
    );
  }

  if (category === "Distance & Differential") {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
      `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
      `<rect x="6" y="6" width="26" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
      `<text x="19" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${badge}</text>` +
      `<circle cx="64" cy="16" r="8" fill="none" stroke="${c.stroke}" stroke-width="1.3" stroke-dasharray="2 1"/>` +
      `<line x1="56" y1="24" x2="72" y2="8" stroke="${c.stroke}" stroke-width="1.2"/>` +
      `<text x="44" y="40" text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
      `</svg>`
    );
  }

  // Sequence Equipment
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 52" width="88" height="52">` +
    `<rect x="2" y="2" width="84" height="48" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${badge}</text>` +
    `<path d="M 38 15 L 44 15 Q 47 9 50 15 Q 53 9 56 15 Q 59 9 62 15 L 68 15" fill="none" stroke="${c.stroke}" stroke-width="1.4"/>` +
    `<text x="44" y="40" text-anchor="middle" font-family="monospace" font-size="8.2" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: OneLinerModelSpec["category"]): DiagramPortSpec[] {
  switch (category) {
    case "Overcurrent Relay":
      return [
        { name: "ct_in", kind: "signal", side: "left", dx: 0, dy: 26 },
        { name: "trip", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    case "Distance & Differential":
      return [
        { name: "ct_in", kind: "signal", side: "left", dx: 0, dy: 16 },
        { name: "pt_in", kind: "signal", side: "left", dx: 0, dy: 36 },
        { name: "trip", kind: "signal", side: "right", dx: 88, dy: 26 },
      ];
    case "Directional / Recloser / Fuse":
      return [
        { name: "line_in", kind: "electrical", side: "left", dx: 0, dy: 26 },
        { name: "line_out", kind: "electrical", side: "right", dx: 88, dy: 26 },
        { name: "trip", kind: "signal", side: "bottom", dx: 44, dy: 52 },
      ];
    case "Sequence Equipment":
      return [
        { name: "bus1", kind: "electrical", side: "left", dx: 0, dy: 26 },
        { name: "bus2", kind: "electrical", side: "right", dx: 88, dy: 26 },
      ];
  }
}

export const ONELINER_MODEL_SPECS: OneLinerModelSpec[] = [
  // =========================================================================
  // 1. Overcurrent Relays (IEEE C37.112 / IEC 60255-151 / ANSI 50/51)
  // =========================================================================
  {
    modelType: "OC_IEEE_MI",
    aliases: ["IEEE_Moderately_Inverse", "U1", "IEEE_MI", "51_IEEE_MI"],
    label: "IEEE Moderately Inverse Time-Overcurrent Relay (51)",
    category: "Overcurrent Relay",
    archetypeId: OneLinerArchetypeId.OVERCURRENT_INVERSE,
    ansiCode: "51",
    description:
      "IEEE C37.112 Moderately Inverse time-overcurrent relay characteristic: t = TD * (0.0515 / (M^0.02 - 1) + 0.1140).",
    provenance: "IEEE Std C37.112-2018 Table 1 (Moderately Inverse); Blackburn, Protective Relaying 4th Ed.",
    params: [
      ["pickupA", 600.0, "A", "Primary pickup current"],
      ["timeDial", 1.0, "TD", "Time dial setting"],
      ["A", 0.0515, "", "IEEE C37.112 curve constant A"],
      ["B", 0.114, "s", "IEEE C37.112 curve constant B"],
      ["p", 0.02, "", "IEEE C37.112 curve exponent p"],
      ["ctRatio", 240.0, "", "Current transformer ratio (e.g. 1200:5)"],
      ["instMult", 0.0, "pu", "Instantaneous 50 high-set multiple (0 = disabled)"],
    ],
  },
  {
    modelType: "OC_IEEE_VI",
    aliases: ["IEEE_Very_Inverse", "U2", "IEEE_VI", "51_IEEE_VI"],
    label: "IEEE Very Inverse Time-Overcurrent Relay (51)",
    category: "Overcurrent Relay",
    archetypeId: OneLinerArchetypeId.OVERCURRENT_INVERSE,
    ansiCode: "51",
    description:
      "IEEE C37.112 Very Inverse time-overcurrent relay characteristic: t = TD * (19.61 / (M^2 - 1) + 0.491).",
    provenance: "IEEE Std C37.112-2018 Table 1 (Very Inverse); Blackburn, Protective Relaying 4th Ed.",
    params: [
      ["pickupA", 600.0, "A", "Primary pickup current"],
      ["timeDial", 1.0, "TD", "Time dial setting"],
      ["A", 19.61, "", "IEEE C37.112 curve constant A"],
      ["B", 0.491, "s", "IEEE C37.112 curve constant B"],
      ["p", 2.0, "", "IEEE C37.112 curve exponent p"],
      ["ctRatio", 240.0, "", "Current transformer ratio"],
      ["instMult", 0.0, "pu", "Instantaneous 50 high-set multiple (0 = disabled)"],
    ],
  },
  {
    modelType: "OC_IEEE_EI",
    aliases: ["IEEE_Extremely_Inverse", "U3", "IEEE_EI", "51_IEEE_EI"],
    label: "IEEE Extremely Inverse Time-Overcurrent Relay (51)",
    category: "Overcurrent Relay",
    archetypeId: OneLinerArchetypeId.OVERCURRENT_INVERSE,
    ansiCode: "51",
    description:
      "IEEE C37.112 Extremely Inverse time-overcurrent relay characteristic: t = TD * (28.2 / (M^2 - 1) + 0.1217).",
    provenance: "IEEE Std C37.112-2018 Table 1 (Extremely Inverse); Blackburn, Protective Relaying 4th Ed.",
    params: [
      ["pickupA", 600.0, "A", "Primary pickup current"],
      ["timeDial", 1.0, "TD", "Time dial setting"],
      ["A", 28.2, "", "IEEE C37.112 curve constant A"],
      ["B", 0.1217, "s", "IEEE C37.112 curve constant B"],
      ["p", 2.0, "", "IEEE C37.112 curve exponent p"],
      ["ctRatio", 240.0, "", "Current transformer ratio"],
      ["instMult", 0.0, "pu", "Instantaneous 50 high-set multiple (0 = disabled)"],
    ],
  },
  {
    modelType: "OC_IEC_SI",
    aliases: ["IEC_Standard_Inverse", "IEC_Normal_Inverse", "C1", "51_IEC_SI"],
    label: "IEC Standard Inverse Time-Overcurrent Relay (51)",
    category: "Overcurrent Relay",
    archetypeId: OneLinerArchetypeId.OVERCURRENT_INVERSE,
    ansiCode: "51",
    description: "IEC 60255-151 Standard Inverse time-overcurrent characteristic: t = TMS * (0.14 / (M^0.02 - 1)).",
    provenance: "IEC 60255-151:2009 Table 1 (Standard Inverse Curve A)",
    params: [
      ["pickupA", 600.0, "A", "Primary pickup current"],
      ["timeDial", 0.5, "TMS", "Time multiplier setting"],
      ["A", 0.14, "", "IEC 60255-151 constant k"],
      ["B", 0.0, "s", "IEC 60255-151 additive constant c"],
      ["p", 0.02, "", "IEC 60255-151 exponent alpha"],
      ["ctRatio", 240.0, "", "Current transformer ratio"],
      ["instMult", 0.0, "pu", "Instantaneous 50 high-set multiple (0 = disabled)"],
    ],
  },
  {
    modelType: "OC_IEC_VI",
    aliases: ["IEC_Very_Inverse", "C2", "51_IEC_VI"],
    label: "IEC Very Inverse Time-Overcurrent Relay (51)",
    category: "Overcurrent Relay",
    archetypeId: OneLinerArchetypeId.OVERCURRENT_INVERSE,
    ansiCode: "51",
    description: "IEC 60255-151 Very Inverse time-overcurrent characteristic: t = TMS * (13.5 / (M - 1)).",
    provenance: "IEC 60255-151:2009 Table 1 (Very Inverse Curve B)",
    params: [
      ["pickupA", 600.0, "A", "Primary pickup current"],
      ["timeDial", 0.5, "TMS", "Time multiplier setting"],
      ["A", 13.5, "", "IEC 60255-151 constant k"],
      ["B", 0.0, "s", "IEC 60255-151 additive constant c"],
      ["p", 1.0, "", "IEC 60255-151 exponent alpha"],
      ["ctRatio", 240.0, "", "Current transformer ratio"],
      ["instMult", 0.0, "pu", "Instantaneous 50 high-set multiple (0 = disabled)"],
    ],
  },
  {
    modelType: "OC_IEC_EI",
    aliases: ["IEC_Extremely_Inverse", "C3", "51_IEC_EI"],
    label: "IEC Extremely Inverse Time-Overcurrent Relay (51)",
    category: "Overcurrent Relay",
    archetypeId: OneLinerArchetypeId.OVERCURRENT_INVERSE,
    ansiCode: "51",
    description: "IEC 60255-151 Extremely Inverse time-overcurrent characteristic: t = TMS * (80.0 / (M^2 - 1)).",
    provenance: "IEC 60255-151:2009 Table 1 (Extremely Inverse Curve C)",
    params: [
      ["pickupA", 600.0, "A", "Primary pickup current"],
      ["timeDial", 0.5, "TMS", "Time multiplier setting"],
      ["A", 80.0, "", "IEC 60255-151 constant k"],
      ["B", 0.0, "s", "IEC 60255-151 additive constant c"],
      ["p", 2.0, "", "IEC 60255-151 exponent alpha"],
      ["ctRatio", 240.0, "", "Current transformer ratio"],
      ["instMult", 0.0, "pu", "Instantaneous 50 high-set multiple (0 = disabled)"],
    ],
  },
  {
    modelType: "OC_IEC_LTI",
    aliases: ["IEC_Long_Time_Inverse", "C4", "51_IEC_LTI"],
    label: "IEC Long-Time Inverse Overcurrent Relay (51)",
    category: "Overcurrent Relay",
    archetypeId: OneLinerArchetypeId.OVERCURRENT_INVERSE,
    ansiCode: "51",
    description: "IEC 60255-151 Long-Time Inverse characteristic: t = TMS * (120.0 / (M - 1)).",
    provenance: "IEC 60255-151:2009 Table 1 (Long-Time Inverse)",
    params: [
      ["pickupA", 600.0, "A", "Primary pickup current"],
      ["timeDial", 0.5, "TMS", "Time multiplier setting"],
      ["A", 120.0, "", "IEC 60255-151 constant k"],
      ["B", 0.0, "s", "IEC 60255-151 additive constant c"],
      ["p", 1.0, "", "IEC 60255-151 exponent alpha"],
      ["ctRatio", 240.0, "", "Current transformer ratio"],
      ["instMult", 0.0, "pu", "Instantaneous 50 high-set multiple (0 = disabled)"],
    ],
  },
  {
    modelType: "OC_US_CO8",
    aliases: ["US_CO8", "CO8", "CO-8"],
    label: "US CO-8 Inverse Time-Overcurrent Relay (51)",
    category: "Overcurrent Relay",
    archetypeId: OneLinerArchetypeId.OVERCURRENT_INVERSE,
    ansiCode: "51",
    description:
      "Classical electromechanical CO-8 inverse overcurrent curve analytical fit per IEEE C37.112 / Blackburn.",
    provenance: "IEEE Std C37.112-2018 Annex A; Blackburn, Protective Relaying 4th Ed. Ch. 5",
    params: [
      ["pickupA", 600.0, "A", "Primary pickup current"],
      ["timeDial", 1.0, "TD", "Time dial setting"],
      ["A", 5.95, "", "CO-8 analytical constant A"],
      ["B", 0.18, "s", "CO-8 analytical constant B"],
      ["p", 2.0, "", "CO-8 analytical exponent p"],
      ["ctRatio", 240.0, "", "Current transformer ratio"],
      ["instMult", 0.0, "pu", "Instantaneous 50 high-set multiple (0 = disabled)"],
    ],
  },
  {
    modelType: "OC_US_IAC53",
    aliases: ["US_IAC53", "IAC53", "IAC-53"],
    label: "US IAC53 Very Inverse Time-Overcurrent Relay (51)",
    category: "Overcurrent Relay",
    archetypeId: OneLinerArchetypeId.OVERCURRENT_INVERSE,
    ansiCode: "51",
    description:
      "Classical electromechanical IAC53 very-inverse overcurrent curve analytical fit per IEEE C37.112 / Blackburn.",
    provenance: "IEEE Std C37.112-2018 Annex A; Blackburn, Protective Relaying 4th Ed. Ch. 5",
    params: [
      ["pickupA", 600.0, "A", "Primary pickup current"],
      ["timeDial", 1.0, "TD", "Time dial setting"],
      ["A", 3.922, "", "IAC53 analytical constant A"],
      ["B", 0.0982, "s", "IAC53 analytical constant B"],
      ["p", 2.0, "", "IAC53 analytical exponent p"],
      ["ctRatio", 240.0, "", "Current transformer ratio"],
      ["instMult", 0.0, "pu", "Instantaneous 50 high-set multiple (0 = disabled)"],
    ],
  },
  {
    modelType: "OC_INST_50",
    aliases: ["ANSI_50", "50P", "50G", "INST50"],
    label: "Instantaneous Overcurrent Relay (50)",
    category: "Overcurrent Relay",
    archetypeId: OneLinerArchetypeId.OVERCURRENT_INST,
    ansiCode: "50",
    description: "ANSI 50 definite-time / instantaneous high-set overcurrent relay tripping when I_fault >= I_pickup.",
    provenance: "IEEE Std C37.2-2022 Device 50; IEEE Std C37.112-2018",
    params: [
      ["pickupA", 4000.0, "A", "Instantaneous primary pickup current"],
      ["ctRatio", 240.0, "", "Current transformer ratio"],
      ["delaySec", 0.0167, "s", "Definite operating time (1 cycle at 60 Hz)"],
    ],
  },

  // =========================================================================
  // 2. Distance & Differential Relays (ANSI 21 / 87)
  // =========================================================================
  {
    modelType: "DIST_MHO_Z1",
    aliases: ["21_MHO_Z1", "MHO_Z1", "Z1_MHO"],
    label: "Zone 1 Mho Distance Relay (21)",
    category: "Distance & Differential",
    archetypeId: OneLinerArchetypeId.DISTANCE_MHO,
    ansiCode: "21",
    description:
      "ANSI 21 Zone 1 self-polarized mho circle distance element (80-85% line reach, instantaneous): |Z - Zr/2| <= |Zr|/2.",
    provenance: "IEEE Std C37.113-2015 Guide for Protective Relay Applications to Transmission Lines",
    params: [
      ["reachOhms", 12.0, "Ohm", "Zone 1 mho circle diameter |Zr| (primary Ohms)"],
      ["mtaDeg", 78.0, "deg", "Relay maximum torque angle (MTA)"],
      ["delaySec", 0.02, "s", "Zone 1 operating time"],
      ["ctr", 240.0, "", "Current transformer ratio"],
      ["ptr", 1200.0, "", "Voltage transformer ratio"],
    ],
  },
  {
    modelType: "DIST_MHO_Z2",
    aliases: ["21_MHO_Z2", "MHO_Z2", "Z2_MHO"],
    label: "Zone 2 Mho Distance Relay (21)",
    category: "Distance & Differential",
    archetypeId: OneLinerArchetypeId.DISTANCE_MHO,
    ansiCode: "21",
    description:
      "ANSI 21 Zone 2 time-delayed mho circle distance element (120% line reach) for remote bus backup protection.",
    provenance: "IEEE Std C37.113-2015 Section 5.1; Blackburn, Protective Relaying 4th Ed. Ch. 12",
    params: [
      ["reachOhms", 18.0, "Ohm", "Zone 2 mho circle diameter |Zr| (primary Ohms)"],
      ["mtaDeg", 78.0, "deg", "Relay maximum torque angle (MTA)"],
      ["delaySec", 0.35, "s", "Zone 2 coordinating time delay"],
      ["ctr", 240.0, "", "Current transformer ratio"],
      ["ptr", 1200.0, "", "Voltage transformer ratio"],
    ],
  },
  {
    modelType: "DIST_QUAD_Z1",
    aliases: ["21_QUAD_Z1", "QUAD_Z1", "Z1_QUAD"],
    label: "Zone 1 Quadrilateral Distance Relay (21)",
    category: "Distance & Differential",
    archetypeId: OneLinerArchetypeId.DISTANCE_QUAD,
    ansiCode: "21",
    description:
      "ANSI 21 Zone 1 quadrilateral distance element with independent reactive (X) reach and resistive (R) blinder for high-resistance fault coverage.",
    provenance: "IEEE Std C37.113-2015 Section 5.1.3; IEC 60255-121",
    params: [
      ["xReachOhms", 12.0, "Ohm", "Zone 1 reactive reach Xr (Ohms)"],
      ["rReachOhms", 8.0, "Ohm", "Zone 1 resistive blinder reach Rr (Ohms)"],
      ["mtaDeg", 78.0, "deg", "Directional line impedance angle"],
      ["delaySec", 0.02, "s", "Zone 1 operating time"],
    ],
  },
  {
    modelType: "DIST_QUAD_Z2",
    aliases: ["21_QUAD_Z2", "QUAD_Z2", "Z2_QUAD"],
    label: "Zone 2 Quadrilateral Distance Relay (21)",
    category: "Distance & Differential",
    archetypeId: OneLinerArchetypeId.DISTANCE_QUAD,
    ansiCode: "21",
    description:
      "ANSI 21 Zone 2 time-delayed quadrilateral distance element with independent reactive and resistive blinders.",
    provenance: "IEEE Std C37.113-2015 Section 5.1.3; IEC 60255-121",
    params: [
      ["xReachOhms", 18.0, "Ohm", "Zone 2 reactive reach Xr (Ohms)"],
      ["rReachOhms", 12.0, "Ohm", "Zone 2 resistive blinder reach Rr (Ohms)"],
      ["mtaDeg", 78.0, "deg", "Directional line impedance angle"],
      ["delaySec", 0.35, "s", "Zone 2 coordinating time delay"],
    ],
  },
  {
    modelType: "DIFF_87L",
    aliases: ["87L", "LINE_DIFF"],
    label: "Line Current Differential Relay (87L)",
    category: "Distance & Differential",
    archetypeId: OneLinerArchetypeId.DIFFERENTIAL_87,
    ansiCode: "87L",
    description:
      "ANSI 87L dual-slope percentage-restraint current differential relay for pilot transmission line protection.",
    provenance: "IEEE Std C37.113-2015 Section 6.3; IEEE Std C37.243",
    params: [
      ["iPickupPu", 0.25, "pu", "Minimum differential pickup current"],
      ["slope1Pct", 25.0, "%", "Percentage restraint slope 1"],
      ["slope2Pct", 60.0, "%", "High-current percentage restraint slope 2"],
      ["breakpointPu", 2.0, "pu", "Slope 1 to slope 2 restraint breakpoint"],
      ["delaySec", 0.02, "s", "Operating time including channel latency"],
      ["harm2BlockPct", 0.0, "%", "2nd-harmonic restraint block (0 = disabled)"],
    ],
  },
  {
    modelType: "DIFF_87T",
    aliases: ["87T", "XFMR_DIFF"],
    label: "Transformer Percentage Differential Relay (87T)",
    category: "Distance & Differential",
    archetypeId: OneLinerArchetypeId.DIFFERENTIAL_87,
    ansiCode: "87T",
    description:
      "ANSI 87T dual-slope percentage-restraint transformer differential relay with 2nd-harmonic magnetizing inrush blocking.",
    provenance: "IEEE Std C37.91-2021 Guide for Protecting Power Transformers; Blackburn Ch. 8",
    params: [
      ["iPickupPu", 0.3, "pu", "Minimum differential pickup current"],
      ["slope1Pct", 25.0, "%", "Percentage restraint slope 1"],
      ["slope2Pct", 50.0, "%", "Percentage restraint slope 2"],
      ["breakpointPu", 2.0, "pu", "Slope breakpoint restraint current"],
      ["delaySec", 0.025, "s", "Operating time"],
      ["harm2BlockPct", 15.0, "%", "2nd-harmonic inrush blocking threshold"],
    ],
  },
  {
    modelType: "DIFF_87B",
    aliases: ["87B", "BUS_DIFF"],
    label: "Busbar Percentage Differential Relay (87B)",
    category: "Distance & Differential",
    archetypeId: OneLinerArchetypeId.DIFFERENTIAL_87,
    ansiCode: "87B",
    description:
      "ANSI 87B low-impedance percentage-restraint busbar differential relay with high external-fault security.",
    provenance: "IEEE Std C37.234-2021 Guide for Protective Relay Applications to Power System Buses",
    params: [
      ["iPickupPu", 0.4, "pu", "Minimum differential pickup current"],
      ["slope1Pct", 30.0, "%", "Percentage restraint slope 1"],
      ["slope2Pct", 70.0, "%", "High-current percentage restraint slope 2"],
      ["breakpointPu", 2.5, "pu", "Slope breakpoint restraint current"],
      ["delaySec", 0.018, "s", "High-speed bus differential operating time"],
      ["harm2BlockPct", 0.0, "%", "2nd-harmonic restraint block (0 = disabled)"],
    ],
  },

  // =========================================================================
  // 3. Directional, Recloser & Fuse (ANSI 67 / 79 / 52 / IEEE C37.41)
  // =========================================================================
  {
    modelType: "DIR_67P",
    aliases: ["67P", "67_PHASE"],
    label: "Phase Directional Overcurrent Relay (67P)",
    category: "Directional / Recloser / Fuse",
    archetypeId: OneLinerArchetypeId.DIRECTIONAL_67,
    ansiCode: "67P",
    description:
      "ANSI 67P quadrature-polarized phase directional overcurrent relay combining torque-angle supervision with IEEE Very Inverse timing.",
    provenance: "IEEE Std C37.113-2015; Blackburn, Protective Relaying 4th Ed. Ch. 5 & Ch. 11",
    params: [
      ["pickupA", 500.0, "A", "Primary phase pickup current"],
      ["timeDial", 1.0, "TD", "Time dial setting"],
      ["mtaDeg", -45.0, "deg", "Maximum torque angle (current relative to polarizing voltage)"],
      ["halfAngleDeg", 85.0, "deg", "Forward directional half-angle"],
      ["A", 19.61, "", "IEEE Very Inverse constant A"],
      ["B", 0.491, "s", "IEEE Very Inverse constant B"],
      ["p", 2.0, "", "IEEE Very Inverse exponent p"],
    ],
  },
  {
    modelType: "DIR_67G",
    aliases: ["67G", "67N", "67_GROUND"],
    label: "Ground Directional Overcurrent Relay (67G)",
    category: "Directional / Recloser / Fuse",
    archetypeId: OneLinerArchetypeId.DIRECTIONAL_67,
    ansiCode: "67G",
    description:
      "ANSI 67G zero/negative-sequence polarized ground directional overcurrent relay with IEEE Moderately Inverse timing.",
    provenance: "IEEE Std C37.113-2015; Blackburn, Protective Relaying 4th Ed. Ch. 11",
    params: [
      ["pickupA", 200.0, "A", "Primary ground (3I0) pickup current"],
      ["timeDial", 1.0, "TD", "Time dial setting"],
      ["mtaDeg", -60.0, "deg", "Maximum torque angle (-60 deg lag for zero-seq inductive network)"],
      ["halfAngleDeg", 85.0, "deg", "Forward directional half-angle"],
      ["A", 0.0515, "", "IEEE Moderately Inverse constant A"],
      ["B", 0.114, "s", "IEEE Moderately Inverse constant B"],
      ["p", 0.02, "", "IEEE Moderately Inverse exponent p"],
    ],
  },
  {
    modelType: "RECLOSER_79",
    aliases: ["79", "AUTO_RECLOSER"],
    label: "Automatic Circuit Recloser (79)",
    category: "Directional / Recloser / Fuse",
    archetypeId: OneLinerArchetypeId.RECLOSER_79,
    ansiCode: "79",
    description:
      "ANSI 79 automatic recloser controller with configurable fast trip, dead-time intervals, and lockout shot count.",
    provenance: "IEEE Std C37.60 / IEC 62271-111; IEEE Std C37.104 Guide for Automatic Reclosing",
    params: [
      ["pickupA", 400.0, "A", "Minimum trip pickup current"],
      ["fastDelaySec", 0.05, "s", "Fast curve clearing time"],
      ["recloseDead1Sec", 2.0, "s", "First open reclose dead time"],
      ["recloseDead2Sec", 5.0, "s", "Second open reclose dead time"],
      ["maxShots", 4.0, "", "Total operations to lockout"],
    ],
  },
  {
    modelType: "FUSE_K_LINK",
    aliases: ["K_LINK", "FUSE_K", "ANSI_K"],
    label: "IEEE Fast K-Link Expulsion Fuse",
    category: "Directional / Recloser / Fuse",
    archetypeId: OneLinerArchetypeId.FUSE_LINK,
    ansiCode: "FUSE-K",
    description:
      "ANSI/IEEE C37.41 fast K-link expulsion fuse minimum-melting / total-clearing inverse-time model (speed ratio 6-8).",
    provenance: "IEEE Std C37.41 / ANSI C37.42 Distribution Fuse Links (Type K)",
    params: [
      ["ratedA", 100.0, "A", "Nominal fuse link current rating"],
      ["kCoeff", 18.0, "s", "Fast K-link inverse-time melting constant"],
      ["pExp", 2.0, "", "Thermal I^2*t melting exponent"],
      ["minMeltMult", 2.0, "pu", "Minimum melting current multiple of rating"],
    ],
  },
  {
    modelType: "FUSE_T_LINK",
    aliases: ["T_LINK", "FUSE_T", "ANSI_T"],
    label: "IEEE Slow T-Link Expulsion Fuse",
    category: "Directional / Recloser / Fuse",
    archetypeId: OneLinerArchetypeId.FUSE_LINK,
    ansiCode: "FUSE-T",
    description:
      "ANSI/IEEE C37.41 slow T-link expulsion fuse minimum-melting / total-clearing inverse-time model (speed ratio 10-13).",
    provenance: "IEEE Std C37.41 / ANSI C37.42 Distribution Fuse Links (Type T)",
    params: [
      ["ratedA", 100.0, "A", "Nominal fuse link current rating"],
      ["kCoeff", 42.0, "s", "Slow T-link inverse-time melting constant"],
      ["pExp", 2.0, "", "Thermal I^2*t melting exponent"],
      ["minMeltMult", 2.0, "pu", "Minimum melting current multiple of rating"],
    ],
  },
  {
    modelType: "BREAKER_52",
    aliases: ["52", "CB_52", "CIRCUIT_BREAKER"],
    label: "High-Voltage AC Circuit Breaker (52)",
    category: "Directional / Recloser / Fuse",
    archetypeId: OneLinerArchetypeId.BREAKER_52,
    ansiCode: "52",
    description:
      "ANSI 52 AC high-voltage circuit breaker interrupting duty ratio and total clearing time model per IEEE C37.010.",
    provenance: "IEEE Std C37.010-2016 Application Guide for AC High-Voltage Circuit Breakers",
    params: [
      ["ratedKv", 138.0, "kV", "Rated maximum line-to-line voltage"],
      ["interruptingKa", 40.0, "kA", "Rated symmetrical short-circuit interrupting current"],
      ["clearTimeCycles", 3.0, "cyc", "Rated interrupting time in cycles"],
      ["freqHz", 60.0, "Hz", "System nominal frequency"],
    ],
  },

  // =========================================================================
  // 4. Standard Sequence Line & Transformer Types
  // =========================================================================
  {
    modelType: "LINE_138kV_ACSR",
    aliases: ["138kV_DRAKE", "ACSR_795_138kV"],
    label: "138 kV ACSR 795 kcmil Drake Transmission Line",
    category: "Sequence Equipment",
    archetypeId: OneLinerArchetypeId.SEQ_LINE,
    ansiCode: "L138",
    description:
      "Standard 138 kV single-circuit overhead transmission line (795 kcmil ACSR Drake, 60 Hz) positive and zero-sequence impedances per mile.",
    provenance: "EPRI Transmission Line Reference Book (345 kV and Above); Glover-Sarma-Overbye Power System Analysis",
    params: [
      ["r1OhmPerMi", 0.1288, "Ohm/mi", "Positive-sequence resistance per mile"],
      ["x1OhmPerMi", 0.788, "Ohm/mi", "Positive-sequence reactance per mile"],
      ["r0OhmPerMi", 0.415, "Ohm/mi", "Zero-sequence resistance per mile (Carson earth return)"],
      ["x0OhmPerMi", 2.32, "Ohm/mi", "Zero-sequence reactance per mile"],
      ["b1uSPerMi", 5.38, "uS/mi", "Positive-sequence shunt susceptance per mile"],
      ["b0uSPerMi", 3.25, "uS/mi", "Zero-sequence shunt susceptance per mile"],
      ["ampacityA", 900.0, "A", "Continuous thermal ampacity"],
    ],
  },
  {
    modelType: "LINE_230kV_ACSR",
    aliases: ["230kV_BITTERN", "ACSR_1272_230kV"],
    label: "230 kV ACSR 1272 kcmil Bittern Transmission Line",
    category: "Sequence Equipment",
    archetypeId: OneLinerArchetypeId.SEQ_LINE,
    ansiCode: "L230",
    description:
      "Standard 230 kV single-circuit overhead transmission line (1272 kcmil ACSR Bittern, 60 Hz) positive and zero-sequence impedances per mile.",
    provenance: "EPRI Transmission Line Reference Book; Westinghouse Transmission & Distribution Reference Book",
    params: [
      ["r1OhmPerMi", 0.0825, "Ohm/mi", "Positive-sequence resistance per mile"],
      ["x1OhmPerMi", 0.765, "Ohm/mi", "Positive-sequence reactance per mile"],
      ["r0OhmPerMi", 0.368, "Ohm/mi", "Zero-sequence resistance per mile"],
      ["x0OhmPerMi", 2.28, "Ohm/mi", "Zero-sequence reactance per mile"],
      ["b1uSPerMi", 5.56, "uS/mi", "Positive-sequence shunt susceptance per mile"],
      ["b0uSPerMi", 3.42, "uS/mi", "Zero-sequence shunt susceptance per mile"],
      ["ampacityA", 1200.0, "A", "Continuous thermal ampacity"],
    ],
  },
  {
    modelType: "LINE_500kV_BUNDLE",
    aliases: ["500kV_CARDINAL", "ACSR_3x954_500kV"],
    label: "500 kV 3-Bundle ACSR 954 kcmil Cardinal Transmission Line",
    category: "Sequence Equipment",
    archetypeId: OneLinerArchetypeId.SEQ_LINE,
    ansiCode: "L500",
    description:
      "Standard 500 kV 3-conductor bundle overhead EHV transmission line (3x954 kcmil ACSR Cardinal, 60 Hz) sequence parameters per mile.",
    provenance: "EPRI AC Transmission Line Reference Book — 200 kV and Above (3rd Ed.)",
    params: [
      ["r1OhmPerMi", 0.036, "Ohm/mi", "Positive-sequence resistance per mile"],
      ["x1OhmPerMi", 0.592, "Ohm/mi", "Positive-sequence reactance per mile"],
      ["r0OhmPerMi", 0.31, "Ohm/mi", "Zero-sequence resistance per mile"],
      ["x0OhmPerMi", 1.85, "Ohm/mi", "Zero-sequence reactance per mile"],
      ["b1uSPerMi", 7.18, "uS/mi", "Positive-sequence shunt susceptance per mile"],
      ["b0uSPerMi", 4.35, "uS/mi", "Zero-sequence shunt susceptance per mile"],
      ["ampacityA", 3000.0, "A", "Continuous thermal ampacity"],
    ],
  },
  {
    modelType: "XFMR_YND1",
    aliases: ["YNd1", "WYE_DELTA_XFMR"],
    label: "Wye-Grounded / Delta-Lagging (YNd1) Power Transformer",
    category: "Sequence Equipment",
    archetypeId: OneLinerArchetypeId.SEQ_TRANSFORMER,
    ansiCode: "YNd1",
    description:
      "Two-winding grounded-wye / delta (YNd1, -30 deg phase shift) power transformer sequence impedance model blocking zero-sequence transfer across the delta winding.",
    provenance: "IEEE Std C57.12.00; Blackburn, Symmetrical Components for Power Systems Engineering",
    params: [
      ["mvaRating", 100.0, "MVA", "Base transformer MVA rating"],
      ["hvKv", 230.0, "kV", "High-voltage wye-grounded winding nominal voltage"],
      ["lvKv", 138.0, "kV", "Low-voltage delta winding nominal voltage"],
      ["r1Pu", 0.004, "pu", "Positive-sequence resistance on transformer base"],
      ["x1Pu", 0.1, "pu", "Positive-sequence leakage reactance on transformer base"],
      ["r0Pu", 0.004, "pu", "Zero-sequence resistance (HV wye-grounded to delta circulating path)"],
      ["x0Pu", 0.095, "pu", "Zero-sequence leakage reactance on transformer base"],
      ["phaseShiftDeg", -30.0, "deg", "ANSI/IEC YNd1 LV phase shift relative to HV"],
    ],
  },
  {
    modelType: "XFMR_YY_AUTO",
    aliases: ["YNa0d1", "AUTO_XFMR", "YY_AUTO"],
    label: "Wye-Grounded Autotransformer with Delta Tertiary (YNa0d1)",
    category: "Sequence Equipment",
    archetypeId: OneLinerArchetypeId.SEQ_TRANSFORMER,
    ansiCode: "AUTO",
    description:
      "Three-winding grounded-wye autotransformer with buried delta tertiary providing a low-impedance zero-sequence shunt path.",
    provenance: "IEEE Std C57.12.00; IEEE Std C37.91; Blackburn, Symmetrical Components",
    params: [
      ["mvaRating", 300.0, "MVA", "Base autotransformer MVA rating"],
      ["hvKv", 500.0, "kV", "High-voltage series winding nominal voltage"],
      ["lvKv", 230.0, "kV", "Low-voltage common winding nominal voltage"],
      ["r1Pu", 0.0025, "pu", "Positive-sequence HV-LV resistance on base"],
      ["x1Pu", 0.085, "pu", "Positive-sequence HV-LV leakage reactance on base"],
      ["r0Pu", 0.003, "pu", "Zero-sequence equivalent resistance"],
      ["x0Pu", 0.072, "pu", "Zero-sequence equivalent reactance (with delta tertiary)"],
      ["x3TertPu", 0.25, "pu", "Buried delta tertiary zero-sequence reactance"],
    ],
  },
];

/**
 * Converts `ONELINER_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildOneLinerCleanroomSchemas(): CleanroomModelSchema[] {
  return ONELINER_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `oneliner:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "electrical",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "oneliner_protection_model",
      width: 88,
      height: 52,
      svg: generateOneLinerBlockSvg(spec.modelType, spec.category, spec.ansiCode),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
        ansiCode: spec.ansiCode,
      },
    };
  });
}
