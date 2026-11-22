// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * SEL cleanroom protection element, TCC curve, and SELogic archetype IDs
 * matching `assets/sel-std-lib/src/models.ts`.
 */
export const SelArchetypeId = {
  TCC_CURVE: 1, // SEL_U1_MI..SEL_U5_STI, SEL_C1_SI..SEL_C5_STI, EL_51P, EL_51G
  INST_OVERCURRENT: 10, // EL_50P, EL_50G
  DISTANCE_MHO: 20, // EL_21P_MHO
  DISTANCE_QUAD: 21, // EL_21G_QUAD
  DIRECTIONAL_OC: 30, // EL_67P, EL_67Q
  DIFFERENTIAL_87: 40, // EL_87L, EL_87T
  RECLOSER_79: 50, // EL_79_RECLOSE
  FREQUENCY_81: 60, // EL_81O_U
  VOLTAGE_27_59: 61, // EL_27_59
  BREAKER_FAILURE_50BF: 62, // EL_50BF
  SELOGIC_TIMER: 70, // SV_TIMER
  SELOGIC_LATCH: 71, // LT_LATCH
  SELOGIC_MATH: 72, // PMV_MATH
  WORD_BIT: 73, // WORD_BIT_52A, WORD_BIT_TRIP
} as const;

export type SelArchetypeId = (typeof SelArchetypeId)[keyof typeof SelArchetypeId];

export type SelElementCategory = "Time-Overcurrent Curve" | "Protection Element" | "SELogic & Timer";

export interface SelElementSpec {
  elementType: string;
  aliases?: string[];
  label: string;
  category: SelElementCategory;
  archetypeId: SelArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<SelElementCategory, { fill: string; stroke: string; badge: string }> = {
  "Time-Overcurrent Curve": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "TCC" },
  "Protection Element": { fill: "#422006", stroke: "#fb923c", badge: "PRO" },
  "SELogic & Timer": { fill: "#1e3f2f", stroke: "#34d399", badge: "LOG" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an SEL protection element,
 * TCC curve, or SELogic control block.
 */
export function generateSelBlockSvg(elementType: string, category: SelElementCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = elementType.toUpperCase().slice(0, 10);
  const glyph =
    category === "Time-Overcurrent Curve"
      ? `<path d="M54 8 Q56 20 72 22" fill="none" stroke="${c.stroke}" stroke-width="1.4"/>`
      : category === "Protection Element"
        ? `<circle cx="64" cy="14" r="6" fill="none" stroke="${c.stroke}" stroke-width="1.4"/>`
        : `<polyline points="54,18 60,18 60,10 68,10 68,18 74,18" fill="none" stroke="${c.stroke}" stroke-width="1.4"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 48" width="84" height="48">` +
    `<rect x="2" y="2" width="80" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    glyph +
    `<text x="42" y="36" text-anchor="middle" font-family="monospace" font-size="9.2" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: SelElementCategory): DiagramPortSpec[] {
  switch (category) {
    case "Time-Overcurrent Curve":
      return [
        { name: "iMag", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "pickup", kind: "signal", side: "right", dx: 84, dy: 14 },
        { name: "trip", kind: "signal", side: "right", dx: 84, dy: 34 },
      ];
    case "Protection Element":
      return [
        { name: "ct", kind: "electrical", side: "left", dx: 0, dy: 14 },
        { name: "pt", kind: "electrical", side: "left", dx: 0, dy: 34 },
        { name: "pickup", kind: "signal", side: "right", dx: 84, dy: 14 },
        { name: "trip", kind: "signal", side: "right", dx: 84, dy: 34 },
      ];
    case "SELogic & Timer":
      return [
        { name: "in", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "rst", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "out", kind: "signal", side: "right", dx: 84, dy: 24 },
      ];
  }
}

function makeTccParams(a: number, b: number, p: number, tr: number): SelElementSpec["params"] {
  return [
    ["pickup", 1.0, "A", "Time-overcurrent pickup current (secondary A or pu)"],
    ["timeDial", 1.0, "TD", "Time-dial / time-multiplier setting"],
    ["A", a, "s", "Inverse-time numerator constant A (or k)"],
    ["B", b, "s", "Definite-time asymptote constant B"],
    ["p", p, "", "Inverse-time exponent p (or alpha)"],
    ["tr", tr, "s", "Electromechanical reset time constant tr (0 = instant reset)"],
  ];
}

export const SEL_ELEMENT_SPECS: SelElementSpec[] = [
  // ─── IEEE C37.112 US Time-Overcurrent Curves (U1–U5) ───────────────────────
  {
    elementType: "SEL_U1_MI",
    aliases: ["U1", "IEEE_MI", "C37.112_MI"],
    label: "U1 Moderately Inverse TCC",
    category: "Time-Overcurrent Curve",
    archetypeId: SelArchetypeId.TCC_CURVE,
    description: "IEEE C37.112 Moderately Inverse time-overcurrent characteristic curve (U1).",
    provenance: "IEEE Std C37.112-1996 / C37.112-2018 Table 1 — Moderately Inverse (U1)",
    params: makeTccParams(0.0515, 0.114, 0.02, 4.85),
  },
  {
    elementType: "SEL_U2_I",
    aliases: ["U2", "IEEE_I", "CO8"],
    label: "U2 Inverse TCC",
    category: "Time-Overcurrent Curve",
    archetypeId: SelArchetypeId.TCC_CURVE,
    description: "IEEE C37.112 / US Inverse time-overcurrent characteristic curve (U2).",
    provenance: "IEEE Std C37.112-1996 / IEEE C37.2 Device 51 — US Inverse (U2)",
    params: makeTccParams(5.95, 0.18, 2.0, 5.95),
  },
  {
    elementType: "SEL_U3_VI",
    aliases: ["U3", "IEEE_VI", "C37.112_VI"],
    label: "U3 Very Inverse TCC",
    category: "Time-Overcurrent Curve",
    archetypeId: SelArchetypeId.TCC_CURVE,
    description: "IEEE C37.112 Very Inverse time-overcurrent characteristic curve (U3).",
    provenance: "IEEE Std C37.112-1996 / C37.112-2018 Table 1 — Very Inverse (U3)",
    params: makeTccParams(19.61, 0.491, 2.0, 21.6),
  },
  {
    elementType: "SEL_U4_EI",
    aliases: ["U4", "IEEE_EI", "C37.112_EI"],
    label: "U4 Extremely Inverse TCC",
    category: "Time-Overcurrent Curve",
    archetypeId: SelArchetypeId.TCC_CURVE,
    description: "IEEE C37.112 Extremely Inverse time-overcurrent characteristic curve (U4).",
    provenance: "IEEE Std C37.112-1996 / C37.112-2018 Table 1 — Extremely Inverse (U4)",
    params: makeTccParams(28.2, 0.1217, 2.0, 29.1),
  },
  {
    elementType: "SEL_U5_STI",
    aliases: ["U5", "IEEE_STI"],
    label: "U5 Short-Time Inverse TCC",
    category: "Time-Overcurrent Curve",
    archetypeId: SelArchetypeId.TCC_CURVE,
    description: "IEEE C37.112 Short-Time Inverse time-overcurrent characteristic curve (U5).",
    provenance: "IEEE Std C37.112-1996 / IEEE C37.2 Device 51 — Short-Time Inverse (U5)",
    params: makeTccParams(0.02394, 0.01694, 0.02, 2.261),
  },

  // ─── IEC 60255-151 Time-Overcurrent Curves (C1–C5) ─────────────────────────
  {
    elementType: "SEL_C1_SI",
    aliases: ["C1", "IEC_SI", "IEC_60255_SI"],
    label: "C1 IEC Standard Inverse TCC",
    category: "Time-Overcurrent Curve",
    archetypeId: SelArchetypeId.TCC_CURVE,
    description: "IEC 60255-151 Standard Inverse time-overcurrent characteristic curve (C1).",
    provenance: "IEC 60255-151:2009 / IEC 60255-3 — Standard Inverse (C1, k=0.14, alpha=0.02)",
    params: makeTccParams(0.14, 0.0, 0.02, 13.5),
  },
  {
    elementType: "SEL_C2_VI",
    aliases: ["C2", "IEC_VI", "IEC_60255_VI"],
    label: "C2 IEC Very Inverse TCC",
    category: "Time-Overcurrent Curve",
    archetypeId: SelArchetypeId.TCC_CURVE,
    description: "IEC 60255-151 Very Inverse time-overcurrent characteristic curve (C2).",
    provenance: "IEC 60255-151:2009 / IEC 60255-3 — Very Inverse (C2, k=13.5, alpha=1.0)",
    params: makeTccParams(13.5, 0.0, 1.0, 47.3),
  },
  {
    elementType: "SEL_C3_EI",
    aliases: ["C3", "IEC_EI", "IEC_60255_EI"],
    label: "C3 IEC Extremely Inverse TCC",
    category: "Time-Overcurrent Curve",
    archetypeId: SelArchetypeId.TCC_CURVE,
    description: "IEC 60255-151 Extremely Inverse time-overcurrent characteristic curve (C3).",
    provenance: "IEC 60255-151:2009 / IEC 60255-3 — Extremely Inverse (C3, k=80.0, alpha=2.0)",
    params: makeTccParams(80.0, 0.0, 2.0, 80.0),
  },
  {
    elementType: "SEL_C4_LTI",
    aliases: ["C4", "IEC_LTI", "IEC_60255_LTI"],
    label: "C4 IEC Long-Time Inverse TCC",
    category: "Time-Overcurrent Curve",
    archetypeId: SelArchetypeId.TCC_CURVE,
    description: "IEC 60255-151 Long-Time Inverse time-overcurrent characteristic curve (C4).",
    provenance: "IEC 60255-151:2009 / IEC 60255-3 — Long-Time Inverse (C4, k=120.0, alpha=1.0)",
    params: makeTccParams(120.0, 0.0, 1.0, 120.0),
  },
  {
    elementType: "SEL_C5_STI",
    aliases: ["C5", "IEC_STI", "IEC_60255_STI"],
    label: "C5 IEC Short-Time Inverse TCC",
    category: "Time-Overcurrent Curve",
    archetypeId: SelArchetypeId.TCC_CURVE,
    description: "IEC 60255-151 Short-Time Inverse time-overcurrent characteristic curve (C5).",
    provenance: "IEC 60255-151:2009 / IEC 60255-3 — Short-Time Inverse (C5, k=0.05, alpha=0.04)",
    params: makeTccParams(0.05, 0.0, 0.04, 4.85),
  },

  // ─── IEEE C37.2 Protection Elements ────────────────────────────────────────
  {
    elementType: "EL_50P",
    aliases: ["50P", "50P1P", "50P2P"],
    label: "50P Instantaneous Phase OC",
    category: "Protection Element",
    archetypeId: SelArchetypeId.INST_OVERCURRENT,
    description: "Instantaneous / definite-time phase overcurrent element with hysteresis dropout.",
    provenance: "IEEE Std C37.2-2022 Device 50P — Instantaneous Phase Overcurrent Relay",
    params: [
      ["pickup", 10.0, "A", "50P phase instantaneous pickup current"],
      ["delaySec", 0.0, "s", "Definite-time delay"],
      ["dropoutRatio", 0.95, "pu", "Dropout-to-pickup hysteresis ratio"],
    ],
  },
  {
    elementType: "EL_50G",
    aliases: ["50G", "50G1P", "50N"],
    label: "50G Instantaneous Ground OC",
    category: "Protection Element",
    archetypeId: SelArchetypeId.INST_OVERCURRENT,
    description: "Instantaneous / definite-time residual ground overcurrent element.",
    provenance: "IEEE Std C37.2-2022 Device 50G/50N — Instantaneous Ground Overcurrent Relay",
    params: [
      ["pickup", 4.0, "A", "50G ground instantaneous pickup current"],
      ["delaySec", 0.0, "s", "Definite-time delay"],
      ["dropoutRatio", 0.95, "pu", "Dropout-to-pickup hysteresis ratio"],
    ],
  },
  {
    elementType: "EL_51P",
    aliases: ["51P", "51P1P"],
    label: "51P Phase Time-Overcurrent",
    category: "Protection Element",
    archetypeId: SelArchetypeId.TCC_CURVE,
    description: "Phase inverse-time overcurrent protection element (default IEEE U3 Very Inverse).",
    provenance: "IEEE Std C37.2-2022 Device 51P & IEEE Std C37.112-2018",
    params: makeTccParams(19.61, 0.491, 2.0, 21.6),
  },
  {
    elementType: "EL_51G",
    aliases: ["51G", "51G1P", "51N"],
    label: "51G Ground Time-Overcurrent",
    category: "Protection Element",
    archetypeId: SelArchetypeId.TCC_CURVE,
    description: "Ground / residual inverse-time overcurrent protection element (default IEEE U3 Very Inverse).",
    provenance: "IEEE Std C37.2-2022 Device 51G/51N & IEEE Std C37.112-2018",
    params: makeTccParams(19.61, 0.491, 2.0, 21.6),
  },
  {
    elementType: "EL_21P_MHO",
    aliases: ["21P", "Z1P", "Z2P", "Z3P", "MHO"],
    label: "21P Phase Mho Distance",
    category: "Protection Element",
    archetypeId: SelArchetypeId.DISTANCE_MHO,
    description: "Phase-to-phase circular mho distance protection zone passing through the R-X origin.",
    provenance: "IEEE Std C37.2-2022 Device 21P & IEEE Std C37.113-2015 — Mho Distance Relay",
    params: [
      ["reachOhm", 5.0, "Ohm", "Zone mho diameter reach Zr (secondary Ohms)"],
      ["mtaDeg", 75.0, "deg", "Line positive-sequence maximum torque angle"],
      ["delaySec", 0.0, "s", "Zone definite-time trip delay"],
    ],
  },
  {
    elementType: "EL_21G_QUAD",
    aliases: ["21G", "Z1G", "Z2G", "QUAD"],
    label: "21G Ground Quadrilateral Distance",
    category: "Protection Element",
    archetypeId: SelArchetypeId.DISTANCE_QUAD,
    description: "Phase-to-ground quadrilateral distance zone with independent reactive and resistive blinders.",
    provenance: "IEEE Std C37.2-2022 Device 21G & IEEE Std C37.113-2015 — Quadrilateral Distance Relay",
    params: [
      ["xReachOhm", 5.0, "Ohm", "Reactive reach X1 (secondary Ohms)"],
      ["rReachOhm", 3.0, "Ohm", "Resistive blinder reach R1 (secondary Ohms)"],
      ["mtaDeg", 75.0, "deg", "Line impedance angle"],
      ["delaySec", 0.0, "s", "Zone definite-time trip delay"],
    ],
  },
  {
    elementType: "EL_67P",
    aliases: ["67P", "67P1"],
    label: "67P Directional Phase OC",
    category: "Protection Element",
    archetypeId: SelArchetypeId.DIRECTIONAL_OC,
    description: "Torque-controlled directional phase overcurrent element with characteristic MTA.",
    provenance: "IEEE Std C37.2-2022 Device 67P — AC Directional Phase Overcurrent Relay",
    params: [
      ["pickup", 6.0, "A", "Directional overcurrent pickup current"],
      ["mtaDeg", 60.0, "deg", "Maximum torque angle (V-I polarizing angle)"],
      ["delaySec", 0.0, "s", "Definite-time operating delay"],
    ],
  },
  {
    elementType: "EL_67Q",
    aliases: ["67Q", "32Q", "67Q1"],
    label: "67Q Neg-Seq Directional OC",
    category: "Protection Element",
    archetypeId: SelArchetypeId.DIRECTIONAL_OC,
    description: "Negative-sequence directional overcurrent element for unbalanced fault discrimination.",
    provenance: "IEEE Std C37.2-2022 Device 67Q & IEEE Std C37.113-2015 — Negative-Sequence Directional",
    params: [
      ["pickup", 1.5, "A", "3I2 negative-sequence current pickup"],
      ["mtaDeg", 75.0, "deg", "Negative-sequence impedance MTA"],
      ["delaySec", 0.0, "s", "Definite-time operating delay"],
    ],
  },
  {
    elementType: "EL_87L",
    aliases: ["87L", "87LP"],
    label: "87L Line Current Differential",
    category: "Protection Element",
    archetypeId: SelArchetypeId.DIFFERENTIAL_87,
    description: "Dual-slope percentage current differential protection for transmission lines.",
    provenance: "IEEE Std C37.2-2022 Device 87L & IEEE Std C37.243-2015 — Line Differential",
    params: [
      ["pickup", 0.3, "pu", "Minimum differential operate pickup O87P"],
      ["slope1Pct", 25.0, "%", "Slope 1 percentage restraint"],
      ["slope2Pct", 60.0, "%", "Slope 2 high-current percentage restraint"],
      ["irBreak", 2.0, "pu", "Restraint current breakpoint"],
      ["harm2BlockPct", 0.0, "%", "Second-harmonic blocking threshold (0 = disabled)"],
    ],
  },
  {
    elementType: "EL_87T",
    aliases: ["87T", "87R"],
    label: "87T Transformer Differential",
    category: "Protection Element",
    archetypeId: SelArchetypeId.DIFFERENTIAL_87,
    description: "Dual-slope transformer percentage differential element with 2nd-harmonic inrush restraint.",
    provenance: "IEEE Std C37.2-2022 Device 87T & IEEE Std C37.91-2021 — Transformer Differential",
    params: [
      ["pickup", 0.3, "pu", "Minimum differential operate pickup O87P"],
      ["slope1Pct", 25.0, "%", "Slope 1 percentage restraint"],
      ["slope2Pct", 65.0, "%", "Slope 2 percentage restraint"],
      ["irBreak", 2.5, "pu", "Restraint current breakpoint"],
      ["harm2BlockPct", 15.0, "%", "Second-harmonic inrush blocking threshold"],
    ],
  },
  {
    elementType: "EL_79_RECLOSE",
    aliases: ["79", "79OI1", "RECLOSE"],
    label: "79 Automatic Reclosing",
    category: "Protection Element",
    archetypeId: SelArchetypeId.RECLOSER_79,
    description: "Multi-shot automatic AC reclosing relay with open-interval, reset, and lockout states.",
    provenance: "IEEE Std C37.2-2022 Device 79 & IEEE Std C37.104-2022 — Automatic Reclosing",
    params: [
      ["openIntervalSec", 1.0, "s", "Dead-time open interval before reclose command"],
      ["resetTimeSec", 15.0, "s", "Reclaim / reset time after successful reclose"],
      ["maxShots", 3.0, "", "Maximum reclose attempts before lockout"],
    ],
  },
  {
    elementType: "EL_81O_U",
    aliases: ["81", "81O", "81U", "81D1P"],
    label: "81O/81U Frequency Element",
    category: "Protection Element",
    archetypeId: SelArchetypeId.FREQUENCY_81,
    description: "Underfrequency (81U) and overfrequency (81O) definite-time protection element.",
    provenance: "IEEE Std C37.2-2022 Device 81 & IEEE Std C37.106-2003 — Frequency Protection",
    params: [
      ["pickupHz", 59.5, "Hz", "Frequency pickup threshold"],
      ["delaySec", 0.1, "s", "Definite-time operating delay"],
      ["mode", -1.0, "", "Operating mode (-1 = underfrequency 81U, +1 = overfrequency 81O)"],
    ],
  },
  {
    elementType: "EL_27_59",
    aliases: ["27", "59", "27P", "59P"],
    label: "27/59 Voltage Element",
    category: "Protection Element",
    archetypeId: SelArchetypeId.VOLTAGE_27_59,
    description: "Undervoltage (27) and overvoltage (59) definite-time protection element.",
    provenance: "IEEE Std C37.2-2022 Devices 27 & 59 — Undervoltage / Overvoltage Relay",
    params: [
      ["pickupV", 0.85, "pu", "Voltage pickup threshold (pu or secondary V)"],
      ["delaySec", 0.2, "s", "Definite-time operating delay"],
      ["mode", -1.0, "", "Operating mode (-1 = undervoltage 27, +1 = overvoltage 59)"],
    ],
  },
  {
    elementType: "EL_50BF",
    aliases: ["50BF", "BF", "62BF"],
    label: "50BF Breaker Failure",
    category: "Protection Element",
    archetypeId: SelArchetypeId.BREAKER_FAILURE_50BF,
    description: "Breaker failure protection with current detector, retrip timer, and backup trip timer.",
    provenance: "IEEE Std C37.2-2022 Device 50BF & IEEE Std C37.119-2016 — Breaker Failure",
    params: [
      ["currentPickup", 0.5, "A", "50BF phase current fault detector pickup"],
      ["retripDelaySec", 0.05, "s", "Retrip output time delay"],
      ["bfDelaySec", 0.15, "s", "Backup breaker-failure trip time delay"],
    ],
  },

  // ─── SELogic Control Equations, Timers & Relay Word Bits ───────────────────
  {
    elementType: "SV_TIMER",
    aliases: ["SV1", "SV1T", "SVnT", "SELOGIC_TIMER"],
    label: "SV SELogic Pickup/Dropout Timer",
    category: "SELogic & Timer",
    archetypeId: SelArchetypeId.SELOGIC_TIMER,
    description: "Programmable SELogic variable timer with independent pickup (SVnPU) and dropout (SVnDO) delays.",
    provenance: "IEC 61131-3 TON/TOF & IEEE Std C37.2 Device 62 — Time-Delay Logic Timer",
    params: [
      ["pickupDelaySec", 0.1, "s", "Pickup delay SVnPU (seconds)"],
      ["dropoutDelaySec", 0.05, "s", "Dropout delay SVnDO (seconds)"],
    ],
  },
  {
    elementType: "LT_LATCH",
    aliases: ["LT1", "LTn", "SET_RST"],
    label: "LT SELogic Set/Reset Latch",
    category: "SELogic & Timer",
    archetypeId: SelArchetypeId.SELOGIC_LATCH,
    description: "Non-volatile SELogic bistable set/reset latch bit (SETn / RSTn).",
    provenance: "IEC 61131-3 SR/RS Bistable Function Block & IEEE C37.2 Device 86",
    params: [["setDominant", 0.0, "", "Priority mode (0 = reset-dominant RS, 1 = set-dominant SR)"]],
  },
  {
    elementType: "PMV_MATH",
    aliases: ["PMV01", "PMVn", "MATH"],
    label: "PMV Protection Math Variable",
    category: "SELogic & Timer",
    archetypeId: SelArchetypeId.SELOGIC_MATH,
    description: "Analog protection math variable computing linear scaled quantities and comparator output.",
    provenance: "IEC 61131-3 Analog Arithmetic & Comparator Block",
    params: [
      ["gain", 1.0, "", "Primary analog input scale factor"],
      ["offset", 0.0, "", "Secondary analog offset / bias multiplier"],
      ["threshold", 1.0, "", "Comparator assertion threshold"],
    ],
  },
  {
    elementType: "WORD_BIT_52A",
    aliases: ["52A", "IN101", "BRK_52A"],
    label: "52a Breaker Status Word Bit",
    category: "SELogic & Timer",
    archetypeId: SelArchetypeId.WORD_BIT,
    description: "Circuit breaker auxiliary contact 52a status bit (asserted when breaker is closed).",
    provenance: "IEEE Std C37.2-2022 Device 52a — AC Circuit Breaker Auxiliary Contact",
    params: [["invert", 0.0, "", "Contact polarity (0 = 52a normally open, 1 = 52b normally closed)"]],
  },
  {
    elementType: "WORD_BIT_TRIP",
    aliases: ["TRIP", "TR", "OUT101"],
    label: "TRIP Output Word Bit",
    category: "SELogic & Timer",
    archetypeId: SelArchetypeId.WORD_BIT,
    description: "Primary relay trip output word bit driving breaker trip coil contact OUT101.",
    provenance: "IEEE Std C37.2-2022 Device 94 — Tripping Output Relay",
    params: [["invert", 0.0, "", "Output contact polarity (0 = normally open, 1 = inverted)"]],
  },
];

/**
 * Converts `SEL_ELEMENT_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildSelCleanroomSchemas(): CleanroomModelSchema[] {
  return SEL_ELEMENT_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `sel:${spec.elementType}`,
      name: spec.elementType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "electrical",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "sel_protection_element",
      width: 84,
      height: 48,
      svg: generateSelBlockSvg(spec.elementType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.elementType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
