// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * SPICE cleanroom device & behavioral primitive archetype IDs matching
 * `assets/spice-std-lib/src/models.ts`.
 */
export const SpiceArchetypeId = {
  DIODE_SHOCKLEY: 1, // D_1N4148, D_1N4007, D_1N5819_SCHOTTKY, D_BZX84C5V1_ZENER
  BJT_NPN: 10, // Q_2N2222_NPN, Q_2N3904_NPN, Q_BC547_NPN
  BJT_PNP: 11, // Q_2N3906_PNP
  MOSFET_NMOS: 20, // M_2N7002_NMOS, M_IRF540_NMOS
  MOSFET_PMOS: 21, // M_BS250_PMOS
  JFET_NJF: 22, // J_2N5457_JFET
  DIGITAL_GATE: 30, // A_AND, A_OR, A_XOR
  SCHMITT_TRIGGER: 31, // A_SCHMITT
  SEQUENTIAL_LOGIC: 32, // A_DFLOP, A_SRFLOP
  ANALOG_OTA: 40, // A_OTA
  MODULATOR_FM_AM: 41, // A_MODULATE
  BEHAVIORAL_VSRC: 50, // B_VSRC
  BEHAVIORAL_ISRC: 51, // B_ISRC
  SWITCH_VCTRL: 60, // S_VSWITCH
  SWITCH_ICTRL: 61, // W_CSWITCH
  OPAMP_SINGLE_POLE: 70, // OPAMP_UNIVERSAL, OPAMP_LM741, OPAMP_TL072
  REGULATOR_LINEAR: 80, // REG_LM7805
} as const;

export type SpiceArchetypeId = (typeof SpiceArchetypeId)[keyof typeof SpiceArchetypeId];

export type SpiceModelCategory =
  | "Diode"
  | "BJT"
  | "MOSFET / JFET"
  | "Digital / Mixed-Signal"
  | "Behavioral / Switch"
  | "Op-Amp / Regulator";

export interface SpiceModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: SpiceModelCategory;
  archetypeId: SpiceArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<SpiceModelCategory, { fill: string; stroke: string; badge: string }> = {
  Diode: { fill: "#1e3a5f", stroke: "#60a5fa", badge: "DIO" },
  BJT: { fill: "#3b1f47", stroke: "#c084fc", badge: "BJT" },
  "MOSFET / JFET": { fill: "#1e3f2f", stroke: "#34d399", badge: "FET" },
  "Digital / Mixed-Signal": { fill: "#3f2e18", stroke: "#fbbf24", badge: "DIG" },
  "Behavioral / Switch": { fill: "#163b3b", stroke: "#2dd4bf", badge: "BEH" },
  "Op-Amp / Regulator": { fill: "#3b2323", stroke: "#f87171", badge: "AMP" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a SPICE standard library model.
 */
export function generateSpiceBlockSvg(modelType: string, category: SpiceModelCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  let glyph = "";
  if (category === "Diode") {
    glyph = `<polygon points="56,9 66,14 56,19" fill="${c.stroke}"/><line x1="67" y1="9" x2="67" y2="19" stroke="${c.stroke}" stroke-width="1.6"/>`;
  } else if (category === "BJT" || category === "MOSFET / JFET") {
    glyph = `<line x1="58" y1="8" x2="58" y2="20" stroke="${c.stroke}" stroke-width="1.6"/><line x1="58" y1="11" x2="67" y2="8" stroke="${c.stroke}" stroke-width="1.4"/><line x1="58" y1="17" x2="67" y2="20" stroke="${c.stroke}" stroke-width="1.4"/>`;
  } else if (category === "Op-Amp / Regulator") {
    glyph = `<polygon points="55,8 69,14 55,20" fill="none" stroke="${c.stroke}" stroke-width="1.5"/>`;
  } else if (category === "Behavioral / Switch") {
    glyph = `<line x1="54" y1="16" x2="65" y2="9" stroke="${c.stroke}" stroke-width="1.6"/><circle cx="54" cy="16" r="1.5" fill="${c.stroke}"/><circle cx="67" cy="16" r="1.5" fill="${c.stroke}"/>`;
  } else {
    glyph = `<path d="M54,18 L59,18 L62,10 L68,10" fill="none" stroke="${c.stroke}" stroke-width="1.5"/>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 48" width="80" height="48">` +
    `<rect x="2" y="2" width="76" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    glyph +
    `<text x="40" y="36" text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: SpiceModelCategory): DiagramPortSpec[] {
  switch (category) {
    case "Diode":
      return [
        { name: "anode", kind: "electrical", side: "left", dx: 0, dy: 24 },
        { name: "cathode", kind: "electrical", side: "right", dx: 80, dy: 24 },
      ];
    case "BJT":
      return [
        { name: "base", kind: "electrical", side: "left", dx: 0, dy: 24 },
        { name: "collector", kind: "electrical", side: "top", dx: 40, dy: 0 },
        { name: "emitter", kind: "electrical", side: "bottom", dx: 40, dy: 48 },
      ];
    case "MOSFET / JFET":
      return [
        { name: "gate", kind: "electrical", side: "left", dx: 0, dy: 24 },
        { name: "drain", kind: "electrical", side: "top", dx: 40, dy: 0 },
        { name: "source", kind: "electrical", side: "bottom", dx: 40, dy: 48 },
      ];
    case "Digital / Mixed-Signal":
      return [
        { name: "in1", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "in2", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "out", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "Behavioral / Switch":
      return [
        { name: "ctrl_p", kind: "electrical", side: "left", dx: 0, dy: 14 },
        { name: "ctrl_n", kind: "electrical", side: "left", dx: 0, dy: 34 },
        { name: "p", kind: "electrical", side: "right", dx: 80, dy: 14 },
        { name: "n", kind: "electrical", side: "right", dx: 80, dy: 34 },
      ];
    case "Op-Amp / Regulator":
      return [
        { name: "inp", kind: "electrical", side: "left", dx: 0, dy: 14 },
        { name: "inn", kind: "electrical", side: "left", dx: 0, dy: 34 },
        { name: "out", kind: "electrical", side: "right", dx: 80, dy: 24 },
      ];
  }
}

/**
 * Cleanroom catalog of LTspice / PSpice / HSPICE standard discrete semiconductors
 * and behavioral primitives derived from public physics models (Shockley, Ebers-Moll,
 * Gummel-Poon, Shichman-Hodges, BSIM, and Sedra-Smith).
 */
export const SPICE_MODEL_SPECS: readonly SpiceModelSpec[] = [
  // === Standard Discrete Semiconductors: Diodes ===
  {
    modelType: "D_1N4148",
    aliases: ["1N4148", "D1N4148"],
    label: "1N4148 Fast Switching Silicon Signal Diode",
    category: "Diode",
    archetypeId: SpiceArchetypeId.DIODE_SHOCKLEY,
    description: "Small-signal high-speed silicon switching diode modeled via the Shockley p-n junction equation.",
    provenance: "Shockley (1949) p-n Junction Theory / JEDEC 1N4148 Public Datasheet Parameters",
    params: [
      ["IS", 2.52e-9, "A", "Saturation current"],
      ["N", 1.752, "", "Emission coefficient (ideality factor)"],
      ["RS", 0.568, "Ohm", "Ohmic series resistance"],
      ["BV", 100.0, "V", "Reverse breakdown voltage"],
      ["IBV", 1.0e-4, "A", "Current at breakdown voltage"],
      ["CJO", 4.0e-12, "F", "Zero-bias junction capacitance"],
    ],
  },
  {
    modelType: "D_1N4007",
    aliases: ["1N4007", "D1N4007"],
    label: "1N4007 1000V 1A General-Purpose Rectifier Diode",
    category: "Diode",
    archetypeId: SpiceArchetypeId.DIODE_SHOCKLEY,
    description: "High-voltage silicon power rectifier diode with 1000V reverse breakdown rating.",
    provenance: "Shockley (1949) p-n Junction Theory / JEDEC 1N4007 Public Datasheet Parameters",
    params: [
      ["IS", 7.02e-9, "A", "Saturation current"],
      ["N", 1.77, "", "Emission coefficient"],
      ["RS", 0.034, "Ohm", "Ohmic series resistance"],
      ["BV", 1000.0, "V", "Reverse breakdown voltage"],
      ["IBV", 5.0e-6, "A", "Current at breakdown voltage"],
      ["CJO", 1.5e-11, "F", "Zero-bias junction capacitance"],
    ],
  },
  {
    modelType: "D_1N5819_SCHOTTKY",
    aliases: ["1N5819", "D1N5819"],
    label: "1N5819 40V 1A Schottky Barrier Rectifier Diode",
    category: "Diode",
    archetypeId: SpiceArchetypeId.DIODE_SHOCKLEY,
    description: "Low forward-drop metal-semiconductor Schottky barrier diode for switching power supplies.",
    provenance: "Shockley Thermionic Emission / Sze Semiconductor Physics (JEDEC 1N5819)",
    params: [
      ["IS", 3.17e-5, "A", "Schottky saturation current"],
      ["N", 1.05, "", "Emission coefficient"],
      ["RS", 0.08, "Ohm", "Series resistance"],
      ["BV", 40.0, "V", "Reverse breakdown voltage"],
      ["IBV", 1.0e-3, "A", "Current at breakdown voltage"],
      ["CJO", 1.1e-10, "F", "Zero-bias junction capacitance"],
    ],
  },
  {
    modelType: "D_BZX84C5V1_ZENER",
    aliases: ["BZX84C5V1", "BZX84C5V1L", "ZENER_5V1"],
    label: "BZX84C5V1 5.1V Zener Voltage Reference Diode",
    category: "Diode",
    archetypeId: SpiceArchetypeId.DIODE_SHOCKLEY,
    description: "5.1V Zener voltage regulator diode with sharp reverse avalanche/Zener breakdown knee.",
    provenance: "Shockley / Zener Breakdown Model (Sedra & Smith Microelectronic Circuits, BZX84C5V1)",
    params: [
      ["IS", 1.0e-12, "A", "Saturation current"],
      ["N", 1.0, "", "Emission coefficient"],
      ["RS", 0.5, "Ohm", "Dynamic series resistance"],
      ["BV", 5.1, "V", "Nominal Zener breakdown voltage"],
      ["IBV", 5.0e-3, "A", "Zener test current at BV"],
      ["CJO", 1.8e-10, "F", "Zero-bias junction capacitance"],
    ],
  },

  // === Standard Discrete Semiconductors: BJTs ===
  {
    modelType: "Q_2N2222_NPN",
    aliases: ["2N2222", "2N2222A", "PN2222"],
    label: "2N2222 General-Purpose NPN Silicon BJT",
    category: "BJT",
    archetypeId: SpiceArchetypeId.BJT_NPN,
    description:
      "Classic general-purpose NPN bipolar junction transistor modeled with Ebers-Moll / Gummel-Poon physics.",
    provenance: "Ebers-Moll (1954) & Gummel-Poon (1970) BJT Equations / JEDEC 2N2222 Public Parameters",
    params: [
      ["IS", 1.434e-14, "A", "Transport saturation current"],
      ["BF", 255.9, "", "Ideal maximum forward beta"],
      ["BR", 6.092, "", "Ideal maximum reverse beta"],
      ["NF", 1.0, "", "Forward current emission coefficient"],
      ["VAF", 74.03, "V", "Forward Early voltage"],
      ["RB", 10.0, "Ohm", "Zero-bias base resistance"],
      ["VAR", 100.0, "V", "Reverse Early voltage"],
      ["IKF", 0.2, "A", "Forward high-level injection knee current"],
      ["CJE", 2.5e-11, "F", "Zero-bias B-E depletion capacitance"],
      ["VJE", 0.75, "V", "B-E junction built-in potential"],
      ["MJE", 0.33, "", "B-E junction grading coefficient"],
      ["CJC", 8.0e-12, "F", "Zero-bias B-C depletion capacitance"],
      ["VJC", 0.75, "V", "B-C junction built-in potential"],
      ["MJC", 0.33, "", "B-C junction grading coefficient"],
      ["NR", 1.0, "", "Reverse current emission coefficient"],
    ],
  },
  {
    modelType: "Q_2N3904_NPN",
    aliases: ["2N3904", "MMBT3904"],
    label: "2N3904 Small-Signal NPN Silicon BJT",
    category: "BJT",
    archetypeId: SpiceArchetypeId.BJT_NPN,
    description: "Ubiquitous small-signal NPN switching and amplification transistor.",
    provenance: "Ebers-Moll (1954) & Gummel-Poon (1970) BJT Equations / JEDEC 2N3904 Public Parameters",
    params: [
      ["IS", 6.734e-15, "A", "Transport saturation current"],
      ["BF", 416.4, "", "Ideal maximum forward beta"],
      ["BR", 0.7371, "", "Ideal maximum reverse beta"],
      ["NF", 1.0, "", "Forward current emission coefficient"],
      ["VAF", 74.03, "V", "Forward Early voltage"],
      ["RB", 10.0, "Ohm", "Zero-bias base resistance"],
      ["VAR", 100.0, "V", "Reverse Early voltage"],
      ["IKF", 0.2, "A", "Forward high-level injection knee current"],
      ["CJE", 2.5e-11, "F", "Zero-bias B-E depletion capacitance"],
      ["VJE", 0.75, "V", "B-E junction built-in potential"],
      ["MJE", 0.33, "", "B-E junction grading coefficient"],
      ["CJC", 8.0e-12, "F", "Zero-bias B-C depletion capacitance"],
      ["VJC", 0.75, "V", "B-C junction built-in potential"],
      ["MJC", 0.33, "", "B-C junction grading coefficient"],
      ["NR", 1.0, "", "Reverse current emission coefficient"],
    ],
  },
  {
    modelType: "Q_2N3906_PNP",
    aliases: ["2N3906", "MMBT3906"],
    label: "2N3906 Small-Signal PNP Silicon BJT",
    category: "BJT",
    archetypeId: SpiceArchetypeId.BJT_PNP,
    description: "Complementary PNP small-signal silicon transistor paired with 2N3904.",
    provenance: "Ebers-Moll (1954) & Gummel-Poon (1970) BJT Equations / JEDEC 2N3906 Public Parameters",
    params: [
      ["IS", 1.41e-15, "A", "Transport saturation current"],
      ["BF", 180.7, "", "Ideal maximum forward beta"],
      ["BR", 4.977, "", "Ideal maximum reverse beta"],
      ["NF", 1.0, "", "Forward current emission coefficient"],
      ["VAF", 18.7, "V", "Forward Early voltage"],
      ["RB", 10.0, "Ohm", "Zero-bias base resistance"],
      ["VAR", 100.0, "V", "Reverse Early voltage"],
      ["IKF", 0.1, "A", "Forward high-level injection knee current"],
      ["CJE", 1.0e-11, "F", "Zero-bias B-E depletion capacitance"],
      ["VJE", 0.75, "V", "B-E junction built-in potential"],
      ["MJE", 0.33, "", "B-E junction grading coefficient"],
      ["CJC", 4.0e-12, "F", "Zero-bias B-C depletion capacitance"],
      ["VJC", 0.75, "V", "B-C junction built-in potential"],
      ["MJC", 0.33, "", "B-C junction grading coefficient"],
      ["NR", 1.0, "", "Reverse current emission coefficient"],
    ],
  },
  {
    modelType: "Q_BC547_NPN",
    aliases: ["BC547", "BC547B", "BC547C"],
    label: "BC547 Low-Noise Audio/General NPN BJT",
    category: "BJT",
    archetypeId: SpiceArchetypeId.BJT_NPN,
    description: "High-gain European standard small-signal NPN transistor for audio and instrumentation.",
    provenance: "Ebers-Moll (1954) & Gummel-Poon (1970) BJT Equations / Pro Electron BC547 Public Parameters",
    params: [
      ["IS", 2.39e-14, "A", "Transport saturation current"],
      ["BF", 294.3, "", "Ideal maximum forward beta"],
      ["BR", 7.94, "", "Ideal maximum reverse beta"],
      ["NF", 1.0, "", "Forward current emission coefficient"],
      ["VAF", 63.2, "V", "Forward Early voltage"],
      ["RB", 10.0, "Ohm", "Zero-bias base resistance"],
      ["VAR", 100.0, "V", "Reverse Early voltage"],
      ["IKF", 0.15, "A", "Forward high-level injection knee current"],
      ["CJE", 1.2e-11, "F", "Zero-bias B-E depletion capacitance"],
      ["VJE", 0.75, "V", "B-E junction built-in potential"],
      ["MJE", 0.33, "", "B-E junction grading coefficient"],
      ["CJC", 4.5e-12, "F", "Zero-bias B-C depletion capacitance"],
      ["VJC", 0.75, "V", "B-C junction built-in potential"],
      ["MJC", 0.33, "", "B-C junction grading coefficient"],
      ["NR", 1.0, "", "Reverse current emission coefficient"],
    ],
  },

  // === Standard Discrete Semiconductors: MOSFETs & JFETs ===
  {
    modelType: "M_2N7002_NMOS",
    aliases: ["2N7002", "2N7000"],
    label: "2N7002 60V Small-Signal N-Channel Enhancement MOSFET",
    category: "MOSFET / JFET",
    archetypeId: SpiceArchetypeId.MOSFET_NMOS,
    description: "Logic-level N-channel enhancement MOSFET modeled with BSIM short-channel physics.",
    provenance: "Shichman-Hodges (1968) MOSFET Level-1 / BSIM Foundation (JEDEC 2N7002)",
    params: [
      ["VTO", 2.1, "V", "Zero-bias threshold voltage"],
      ["KP", 0.32, "A/V^2", "Intrinsic transconductance parameter"],
      ["W", 1.0, "m", "Effective normalized channel width"],
      ["L", 1.0, "m", "Effective normalized channel length"],
      ["LAMBDA", 0.02, "1/V", "Channel-length modulation parameter"],
      ["GAMMA", 0.37, "V^0.5", "Bulk threshold parameter"],
      ["NSUB", 1.5, "", "Subthreshold swing ideality factor n"],
      ["ETA0", 0.05, "V/V", "DIBL threshold voltage shift coefficient"],
      ["ESAT", 1.0e6, "V/m", "Velocity saturation critical electric field"],
      ["PHI", 0.7, "V", "Surface potential 2*phi_F"],
    ],
  },
  {
    modelType: "M_IRF540_NMOS",
    aliases: ["IRF540", "IRF540N"],
    label: "IRF540 100V 28A Power N-Channel MOSFET",
    category: "MOSFET / JFET",
    archetypeId: SpiceArchetypeId.MOSFET_NMOS,
    description: "High-current vertical power N-channel MOSFET for DC-DC converters and motor drives.",
    provenance: "Shichman-Hodges (1968) MOSFET Level-1 / Sedra & Smith Power MOSFET Model (IRF540)",
    params: [
      ["VTO", 3.5, "V", "Zero-bias threshold voltage"],
      ["KP", 4.5, "A/V^2", "Effective power transconductance parameter"],
      ["W", 1.0, "m", "Effective normalized channel width"],
      ["L", 1.0, "m", "Effective normalized channel length"],
      ["LAMBDA", 0.01, "1/V", "Channel-length modulation parameter"],
      ["GAMMA", 0.4, "V^0.5", "Bulk threshold parameter"],
      ["NSUB", 1.5, "", "Subthreshold swing ideality factor n"],
      ["ETA0", 0.05, "V/V", "DIBL threshold voltage shift coefficient"],
      ["ESAT", 1.0e6, "V/m", "Velocity saturation critical electric field"],
      ["PHI", 0.7, "V", "Surface potential 2*phi_F"],
    ],
  },
  {
    modelType: "M_BS250_PMOS",
    aliases: ["BS250", "BS250P"],
    label: "BS250 -45V Small-Signal P-Channel Enhancement MOSFET",
    category: "MOSFET / JFET",
    archetypeId: SpiceArchetypeId.MOSFET_PMOS,
    description: "P-channel enhancement-mode MOSFET for high-side switching and complementary CMOS stages.",
    provenance: "Shichman-Hodges (1968) MOSFET Level-1 / BSIM Foundation (Pro Electron BS250)",
    params: [
      ["VTO", -3.0, "V", "Zero-bias threshold voltage (negative for PMOS)"],
      ["KP", 0.25, "A/V^2", "Intrinsic transconductance parameter"],
      ["W", 1.0, "m", "Effective normalized channel width"],
      ["L", 1.0, "m", "Effective normalized channel length"],
      ["LAMBDA", 0.025, "1/V", "Channel-length modulation parameter"],
      ["GAMMA", 0.35, "V^0.5", "Bulk threshold parameter"],
      ["NSUB", 1.5, "", "Subthreshold swing ideality factor n"],
      ["ETA0", 0.05, "V/V", "DIBL threshold voltage shift coefficient"],
      ["ESAT", 1.0e6, "V/m", "Velocity saturation critical electric field"],
      ["PHI", 0.7, "V", "Surface potential 2*phi_F"],
    ],
  },
  {
    modelType: "J_2N5457_JFET",
    aliases: ["2N5457", "J2N5457"],
    label: "2N5457 General-Purpose N-Channel JFET",
    category: "MOSFET / JFET",
    archetypeId: SpiceArchetypeId.JFET_NJF,
    description: "Depletion-mode N-channel junction field-effect transistor for high-impedance analog amplifiers.",
    provenance: "Shichman-Hodges (1968) JFET Quadratic Model / JEDEC 2N5457 Public Parameters",
    params: [
      ["VTO", -1.6, "V", "Pinch-off threshold voltage"],
      ["BETA", 1.125e-3, "A/V^2", "Transconductance parameter"],
      ["LAMBDA", 2.3e-3, "1/V", "Channel-length modulation parameter"],
      ["IS", 1.0e-14, "A", "Gate junction saturation current"],
    ],
  },

  // === LTspice / PSpice Digital & Mixed-Signal A-Devices ===
  {
    modelType: "A_AND",
    aliases: ["AND", "AND2"],
    label: "Behavioral Digital AND Gate (A-Device)",
    category: "Digital / Mixed-Signal",
    archetypeId: SpiceArchetypeId.DIGITAL_GATE,
    description: "Cleanroom behavioral 2-input logical AND gate with configurable logic threshold and output rails.",
    provenance: "IEEE Std 91 / SPICE3 & Mixed-Signal Behavioral Logic Specification",
    params: [
      ["GATE_TYPE", 0.0, "", "Gate function selector (0=AND, 1=OR, 2=XOR)"],
      ["REF", 0.5, "V", "Input logic switching threshold"],
      ["VHIGH", 1.0, "V", "Logic high output voltage"],
      ["VLOW", 0.0, "V", "Logic low output voltage"],
    ],
  },
  {
    modelType: "A_OR",
    aliases: ["OR", "OR2"],
    label: "Behavioral Digital OR Gate (A-Device)",
    category: "Digital / Mixed-Signal",
    archetypeId: SpiceArchetypeId.DIGITAL_GATE,
    description: "Cleanroom behavioral 2-input logical OR gate with configurable logic threshold and output rails.",
    provenance: "IEEE Std 91 / SPICE3 & Mixed-Signal Behavioral Logic Specification",
    params: [
      ["GATE_TYPE", 1.0, "", "Gate function selector (0=AND, 1=OR, 2=XOR)"],
      ["REF", 0.5, "V", "Input logic switching threshold"],
      ["VHIGH", 1.0, "V", "Logic high output voltage"],
      ["VLOW", 0.0, "V", "Logic low output voltage"],
    ],
  },
  {
    modelType: "A_XOR",
    aliases: ["XOR", "XOR2"],
    label: "Behavioral Digital XOR Gate (A-Device)",
    category: "Digital / Mixed-Signal",
    archetypeId: SpiceArchetypeId.DIGITAL_GATE,
    description: "Cleanroom behavioral 2-input logical exclusive-OR gate for phase detectors and digital logic.",
    provenance: "IEEE Std 91 / SPICE3 & Mixed-Signal Behavioral Logic Specification",
    params: [
      ["GATE_TYPE", 2.0, "", "Gate function selector (0=AND, 1=OR, 2=XOR)"],
      ["REF", 0.5, "V", "Input logic switching threshold"],
      ["VHIGH", 1.0, "V", "Logic high output voltage"],
      ["VLOW", 0.0, "V", "Logic low output voltage"],
    ],
  },
  {
    modelType: "A_SCHMITT",
    aliases: ["SCHMITT", "SCHMITT_BUF"],
    label: "Schmitt Trigger Buffer with Hysteresis (A-Device)",
    category: "Digital / Mixed-Signal",
    archetypeId: SpiceArchetypeId.SCHMITT_TRIGGER,
    description: "Comparator/buffer with symmetric threshold Vt ± Vh hysteresis to reject input noise.",
    provenance: "Schmitt (1938) Thermionic Trigger / Sedra & Smith Bistable Comparator Model",
    params: [
      ["VT", 0.5, "V", "Center switching threshold"],
      ["VH", 0.2, "V", "Hysteresis half-width (trip points at VT +/- VH)"],
      ["VHIGH", 1.0, "V", "Logic high output voltage"],
      ["VLOW", 0.0, "V", "Logic low output voltage"],
    ],
  },
  {
    modelType: "A_DFLOP",
    aliases: ["DFLOP", "DFF"],
    label: "Rising-Edge D Flip-Flop (A-Device)",
    category: "Digital / Mixed-Signal",
    archetypeId: SpiceArchetypeId.SEQUENTIAL_LOGIC,
    description: "Positive-edge-triggered D flip-flop latching input D on rising CLK crossings above REF.",
    provenance: "IEEE Std 91 / Digital Sequential Logic Specification",
    params: [
      ["LOGIC_TYPE", 0.0, "", "Sequential type (0=DFLOP, 1=SRFLOP)"],
      ["REF", 0.5, "V", "Clock and data logic threshold"],
      ["VHIGH", 1.0, "V", "Logic high output voltage"],
      ["VLOW", 0.0, "V", "Logic low output voltage"],
    ],
  },
  {
    modelType: "A_SRFLOP",
    aliases: ["SRFLOP", "SR_LATCH"],
    label: "Set-Reset Flip-Flop Latch (A-Device)",
    category: "Digital / Mixed-Signal",
    archetypeId: SpiceArchetypeId.SEQUENTIAL_LOGIC,
    description: "Behavioral Set-Reset latch for PWM controllers and mixed-signal state machines.",
    provenance: "IEEE Std 91 / Digital Sequential Logic Specification",
    params: [
      ["LOGIC_TYPE", 1.0, "", "Sequential type (0=DFLOP, 1=SRFLOP)"],
      ["REF", 0.5, "V", "Set/Reset logic threshold"],
      ["VHIGH", 1.0, "V", "Logic high output voltage"],
      ["VLOW", 0.0, "V", "Logic low output voltage"],
    ],
  },
  {
    modelType: "A_OTA",
    aliases: ["OTA"],
    label: "Operational Transconductance Amplifier (A-Device)",
    category: "Digital / Mixed-Signal",
    archetypeId: SpiceArchetypeId.ANALOG_OTA,
    description: "Hyperbolic-tangent saturated differential voltage-to-current transconductance amplifier.",
    provenance: "Sedra & Smith Microelectronic Circuits / Standard gm-C OTA Formulation",
    params: [
      ["G", 1.0e-3, "S", "Small-signal transconductance"],
      ["IOUT_MAX", 1.0e-3, "A", "Maximum output sink/source current"],
      ["ROUT", 1.0e6, "Ohm", "Output resistance"],
    ],
  },
  {
    modelType: "A_MODULATE",
    aliases: ["MODULATE", "VCO"],
    label: "Voltage-Controlled AM/FM Oscillator Modulator (A-Device)",
    category: "Digital / Mixed-Signal",
    archetypeId: SpiceArchetypeId.MODULATOR_FM_AM,
    description:
      "Phase-continuous voltage-controlled oscillator with linear FM frequency interpolation and AM scaling.",
    provenance: "Proakis & Salehi Communication Systems / Continuous-Phase VCO Formulation",
    params: [
      ["MARK", 1.0e6, "Hz", "Frequency when FM input = 1 V"],
      ["SPACE", 1.0e3, "Hz", "Frequency when FM input = 0 V"],
      ["VAMP", 1.0, "V", "Default carrier amplitude when AM input is unconnected"],
    ],
  },

  // === Behavioral Sources & Switches ===
  {
    modelType: "B_VSRC",
    aliases: ["BV", "B_VOLTAGE"],
    label: "Arbitrary Behavioral Voltage Source (B-Device)",
    category: "Behavioral / Switch",
    archetypeId: SpiceArchetypeId.BEHAVIORAL_VSRC,
    description: "SPICE3 / PSpice / LTspice behavioral controlled voltage source with gain, offset, and clamping.",
    provenance: "UC Berkeley SPICE3F5 Arbitrary Dependent Source (B-Element) Specification",
    params: [
      ["GAIN", 1.0, "V/V", "Linear voltage gain"],
      ["OFFSET", 0.0, "V", "DC offset voltage"],
      ["VMAX", 1.0e6, "V", "Upper output clamp"],
      ["VMIN", -1.0e6, "V", "Lower output clamp"],
    ],
  },
  {
    modelType: "B_ISRC",
    aliases: ["BI", "B_CURRENT"],
    label: "Arbitrary Behavioral Current Source (B-Device)",
    category: "Behavioral / Switch",
    archetypeId: SpiceArchetypeId.BEHAVIORAL_ISRC,
    description: "SPICE3 / PSpice / LTspice behavioral controlled current source with transconductance and clamping.",
    provenance: "UC Berkeley SPICE3F5 Arbitrary Dependent Source (B-Element) Specification",
    params: [
      ["GAIN", 1.0, "A/V", "Linear transconductance gain"],
      ["OFFSET", 0.0, "A", "DC offset current"],
      ["IMAX", 1.0e6, "A", "Upper current clamp"],
      ["IMIN", -1.0e6, "A", "Lower current clamp"],
    ],
  },
  {
    modelType: "S_VSWITCH",
    aliases: ["VSWITCH", "SW"],
    label: "Smooth Voltage-Controlled Switch (S-Device)",
    category: "Behavioral / Switch",
    archetypeId: SpiceArchetypeId.SWITCH_VCTRL,
    description:
      "Continuously differentiable tanh-smoothed voltage-controlled switch transitioning between Ron and Roff.",
    provenance: "UC Berkeley SPICE3F5 Switch Model (SW) with C-infinity Hyperbolic-Tangent Smoothing",
    params: [
      ["RON", 1.0, "Ohm", "Closed (on-state) resistance"],
      ["ROFF", 1.0e6, "Ohm", "Open (off-state) resistance"],
      ["VT", 0.5, "V", "Control threshold voltage"],
      ["VH", 0.1, "V", "Smooth transition half-width"],
    ],
  },
  {
    modelType: "W_CSWITCH",
    aliases: ["CSWITCH", "CSW"],
    label: "Smooth Current-Controlled Switch (W-Device)",
    category: "Behavioral / Switch",
    archetypeId: SpiceArchetypeId.SWITCH_ICTRL,
    description:
      "Continuously differentiable tanh-smoothed current-controlled switch transitioning between Ron and Roff.",
    provenance: "UC Berkeley SPICE3F5 Current-Controlled Switch Model (CSW)",
    params: [
      ["RON", 1.0, "Ohm", "Closed (on-state) resistance"],
      ["ROFF", 1.0e6, "Ohm", "Open (off-state) resistance"],
      ["IT", 0.01, "A", "Control threshold current"],
      ["IH", 0.002, "A", "Smooth transition half-width"],
    ],
  },

  // === Op-Amps & Linear Regulators ===
  {
    modelType: "OPAMP_UNIVERSAL",
    aliases: ["UniversalOpamp2", "OPAMP"],
    label: "Universal Single-Pole Behavioral Op-Amp",
    category: "Op-Amp / Regulator",
    archetypeId: SpiceArchetypeId.OPAMP_SINGLE_POLE,
    description:
      "Single-pole dominant-frequency operational amplifier with finite DC gain, GBW, slew rate, and supply rail clamping.",
    provenance: "Sedra & Smith Microelectronic Circuits / Boyle (1974) Op-Amp Macromodel",
    params: [
      ["AVOL", 1.0e6, "V/V", "Open-loop DC voltage gain"],
      ["GBW", 10.0e6, "Hz", "Gain-bandwidth product"],
      ["SLEW", 10.0e6, "V/s", "Output slew-rate limit"],
      ["VRAIL_P", 15.0, "V", "Positive output saturation rail"],
      ["VRAIL_N", -15.0, "V", "Negative output saturation rail"],
      ["ROUT", 50.0, "Ohm", "Open-loop output resistance"],
    ],
  },
  {
    modelType: "OPAMP_LM741",
    aliases: ["LM741", "uA741"],
    label: "LM741 General-Purpose Bipolar Op-Amp Macromodel",
    category: "Op-Amp / Regulator",
    archetypeId: SpiceArchetypeId.OPAMP_SINGLE_POLE,
    description: "Classic internally compensated bipolar operational amplifier (1 MHz GBW, 0.5 V/us slew rate).",
    provenance: "Boyle et al. (1974) IEEE JSSC Op-Amp Macromodel / Public uA741/LM741 Parameters",
    params: [
      ["AVOL", 2.0e5, "V/V", "Open-loop DC voltage gain"],
      ["GBW", 1.0e6, "Hz", "Gain-bandwidth product"],
      ["SLEW", 0.5e6, "V/s", "Output slew-rate limit"],
      ["VRAIL_P", 13.5, "V", "Positive output saturation rail (+/-15V supply)"],
      ["VRAIL_N", -13.5, "V", "Negative output saturation rail (+/-15V supply)"],
      ["ROUT", 75.0, "Ohm", "Open-loop output resistance"],
    ],
  },
  {
    modelType: "OPAMP_TL072",
    aliases: ["TL072", "TL071", "TL074"],
    label: "TL072 Low-Noise JFET-Input Op-Amp Macromodel",
    category: "Op-Amp / Regulator",
    archetypeId: SpiceArchetypeId.OPAMP_SINGLE_POLE,
    description: "High-slew-rate JFET-input operational amplifier (3 MHz GBW, 13 V/us slew rate).",
    provenance: "Boyle et al. (1974) IEEE JSSC Op-Amp Macromodel / Public TL072 Parameters",
    params: [
      ["AVOL", 2.0e5, "V/V", "Open-loop DC voltage gain"],
      ["GBW", 3.0e6, "Hz", "Gain-bandwidth product"],
      ["SLEW", 13.0e6, "V/s", "Output slew-rate limit"],
      ["VRAIL_P", 13.5, "V", "Positive output saturation rail"],
      ["VRAIL_N", -13.5, "V", "Negative output saturation rail"],
      ["ROUT", 125.0, "Ohm", "Open-loop output resistance"],
    ],
  },
  {
    modelType: "REG_LM7805",
    aliases: ["LM7805", "7805"],
    label: "LM7805 +5V 1.5A Linear Voltage Regulator",
    category: "Op-Amp / Regulator",
    archetypeId: SpiceArchetypeId.REGULATOR_LINEAR,
    description: "Three-terminal fixed +5V linear series voltage regulator with dropout and load regulation.",
    provenance: "Sedra & Smith Linear Series Regulator Model / Public 7805 Specification",
    params: [
      ["VOUT_NOM", 5.0, "V", "Nominal regulated output voltage"],
      ["VDROPOUT", 2.0, "V", "Minimum input-to-output dropout voltage"],
      ["IMAX", 1.5, "A", "Current limit ceiling"],
      ["ROUT", 0.05, "Ohm", "Closed-loop output impedance"],
    ],
  },
];

/**
 * Converts `SPICE_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildSpiceCleanroomSchemas(): CleanroomModelSchema[] {
  return SPICE_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `spice:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "electrical",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "spice_device_model",
      width: 80,
      height: 48,
      svg: generateSpiceBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
