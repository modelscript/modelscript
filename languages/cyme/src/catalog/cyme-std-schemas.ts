// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Eaton CYME cleanroom distribution equipment archetype IDs matching `assets/cyme-std-lib/src/models.ts`.
 */
export const CymeArchetypeId = {
  OVERHEAD_CONDUCTOR: 1, // OH_ACSR_336_LINNET, OH_ACSR_477_HAWK, OH_ACSR_1_0_RAVEN, OH_AAAC_394_CANTON
  UNDERGROUND_CABLE: 2, // UG_XLPE_500MCM_15kV, UG_XLPE_1000MCM_25kV, UG_EPR_4_0_15kV
  TRANSFORMER: 10, // XFMR_3P_DYN1_1500kVA, XFMR_3P_YY_10MVA, XFMR_1P_POLE_50kVA
  VOLTAGE_REGULATOR: 11, // REG_3P_STEP_32, REG_1P_STEP_32
  FUSE_LINK: 20, // FUSE_K_65A, FUSE_T_100A
  OVERCURRENT_IEEE: 21, // RELAY_OC_IEEE_VI, RECLOSER_3P_HYD
  OVERCURRENT_IEC: 22, // RELAY_OC_IEC_SI
  SWITCHGEAR: 23, // BREAKER_DIST_15kV, SWITCH_LOADBREAK
  SHUNT_CAPACITOR: 30, // CAP_BANK_3P_1200kVAR
  ZIP_LOAD: 31, // LOAD_ZIP_DIST, EV_CHARGER_L3
  DER_IEEE1547: 40, // DER_PV_IEEE1547, DER_BESS_IEEE1547, DER_WIND_DIST
} as const;

export type CymeArchetypeId = (typeof CymeArchetypeId)[keyof typeof CymeArchetypeId];

export interface CymeModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: "Conductors & Cables" | "Transformers & Regulators" | "Protection & Switching" | "Shunts, Loads & DER";
  archetypeId: CymeArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<CymeModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
  "Conductors & Cables": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "LINE" },
  "Transformers & Regulators": { fill: "#3b1f47", stroke: "#c084fc", badge: "XFMR" },
  "Protection & Switching": { fill: "#422006", stroke: "#fb923c", badge: "PROT" },
  "Shunts, Loads & DER": { fill: "#163b3b", stroke: "#2dd4bf", badge: "DER" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an Eaton CYME distribution equipment model.
 */
export function generateCymeBlockSvg(modelType: string, category: CymeModelSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 12);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 48" width="96" height="48">` +
    `<rect x="2" y="2" width="92" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="48" y="34" text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: CymeModelSpec["category"]): DiagramPortSpec[] {
  switch (category) {
    case "Conductors & Cables":
      return [
        { name: "from", kind: "electrical", side: "left", dx: 0, dy: 24 },
        { name: "to", kind: "electrical", side: "right", dx: 96, dy: 24 },
      ];
    case "Transformers & Regulators":
      return [
        { name: "primary", kind: "electrical", side: "left", dx: 0, dy: 24 },
        { name: "secondary", kind: "electrical", side: "right", dx: 96, dy: 24 },
        { name: "tap", kind: "signal", side: "top", dx: 48, dy: 0 },
      ];
    case "Protection & Switching":
      return [
        { name: "line", kind: "electrical", side: "left", dx: 0, dy: 24 },
        { name: "load", kind: "electrical", side: "right", dx: 96, dy: 24 },
        { name: "trip", kind: "signal", side: "top", dx: 48, dy: 0 },
      ];
    case "Shunts, Loads & DER":
      return [
        { name: "bus", kind: "electrical", side: "left", dx: 0, dy: 24 },
        { name: "ctrl", kind: "signal", side: "top", dx: 48, dy: 0 },
      ];
  }
}

/**
 * Cleanroom Eaton CYME distribution equipment database schemas (25 models across 4 categories).
 */
export const CYME_MODEL_SPECS: CymeModelSpec[] = [
  // === 1. Conductors & Cables ===
  {
    modelType: "OH_ACSR_336_LINNET",
    aliases: ["336_ACSR", "LINNET", "OH_336_LINNET"],
    label: "336.4 kcmil 26/7 ACSR Overhead Conductor (Linnet)",
    category: "Conductors & Cables",
    archetypeId: CymeArchetypeId.OVERHEAD_CONDUCTOR,
    description:
      "Overhead 336.4 kcmil 26/7 ACSR Linnet distribution feeder conductor modeled with Carson's positive and zero-sequence impedance equations.",
    provenance: "Kersting, Distribution System Modeling and Analysis (4th ed., Appendix A) / ASTM B232",
    params: [
      ["rAcOhmPerKm", 0.1901, "Ohm/km", "AC resistance at 50 C"],
      ["gmrMm", 7.437, "mm", "Geometric Mean Radius (GMR)"],
      ["gmdMm", 1200.0, "mm", "Equivalent 3-phase Geometric Mean Distance (GMD)"],
      ["ampacityA", 530.0, "A", "Continuous thermal ampacity rating"],
      ["c1NfPerKm", 10.9, "nF/km", "Positive-sequence shunt capacitance"],
      ["kVNom", 12.47, "kV", "Nominal distribution line-to-line voltage"],
    ],
  },
  {
    modelType: "OH_ACSR_477_HAWK",
    aliases: ["477_ACSR", "HAWK", "OH_477_HAWK"],
    label: "477 kcmil 26/7 ACSR Overhead Conductor (Hawk)",
    category: "Conductors & Cables",
    archetypeId: CymeArchetypeId.OVERHEAD_CONDUCTOR,
    description:
      "Heavy trunk feeder 477 kcmil 26/7 ACSR Hawk overhead conductor with Carson earth-return sequence impedance.",
    provenance: "Kersting, Distribution System Modeling and Analysis (4th ed., Appendix A) / ASTM B232",
    params: [
      ["rAcOhmPerKm", 0.1342, "Ohm/km", "AC resistance at 50 C"],
      ["gmrMm", 8.839, "mm", "Geometric Mean Radius (GMR)"],
      ["gmdMm", 1250.0, "mm", "Equivalent 3-phase Geometric Mean Distance (GMD)"],
      ["ampacityA", 670.0, "A", "Continuous thermal ampacity rating"],
      ["c1NfPerKm", 11.4, "nF/km", "Positive-sequence shunt capacitance"],
      ["kVNom", 12.47, "kV", "Nominal distribution line-to-line voltage"],
    ],
  },
  {
    modelType: "OH_ACSR_1_0_RAVEN",
    aliases: ["1/0_ACSR", "RAVEN", "OH_1_0_RAVEN"],
    label: "1/0 AWG 6/1 ACSR Overhead Conductor (Raven)",
    category: "Conductors & Cables",
    archetypeId: CymeArchetypeId.OVERHEAD_CONDUCTOR,
    description: "Distribution lateral 1/0 AWG 6/1 ACSR Raven overhead conductor modeled with Carson's equations.",
    provenance: "Kersting, Distribution System Modeling and Analysis (4th ed., Appendix A) / ASTM B232",
    params: [
      ["rAcOhmPerKm", 0.6959, "Ohm/km", "AC resistance at 50 C"],
      ["gmrMm", 1.359, "mm", "Geometric Mean Radius (GMR)"],
      ["gmdMm", 1100.0, "mm", "Equivalent 3-phase Geometric Mean Distance (GMD)"],
      ["ampacityA", 230.0, "A", "Continuous thermal ampacity rating"],
      ["c1NfPerKm", 9.6, "nF/km", "Positive-sequence shunt capacitance"],
      ["kVNom", 12.47, "kV", "Nominal distribution line-to-line voltage"],
    ],
  },
  {
    modelType: "OH_AAAC_394_CANTON",
    aliases: ["394_AAAC", "CANTON", "OH_394_CANTON"],
    label: "394.5 kcmil 19-Strand AAAC Overhead Conductor (Canton)",
    category: "Conductors & Cables",
    archetypeId: CymeArchetypeId.OVERHEAD_CONDUCTOR,
    description:
      "All-Aluminum Alloy 6201-T81 394.5 kcmil Canton overhead feeder conductor for corrosion-resistant distribution corridors.",
    provenance: "Kersting, Distribution System Modeling and Analysis (4th ed., Ch. 4) / ASTM B399",
    params: [
      ["rAcOhmPerKm", 0.1865, "Ohm/km", "AC resistance at 50 C"],
      ["gmrMm", 7.163, "mm", "Geometric Mean Radius (GMR)"],
      ["gmdMm", 1200.0, "mm", "Equivalent 3-phase Geometric Mean Distance (GMD)"],
      ["ampacityA", 545.0, "A", "Continuous thermal ampacity rating"],
      ["c1NfPerKm", 10.8, "nF/km", "Positive-sequence shunt capacitance"],
      ["kVNom", 12.47, "kV", "Nominal distribution line-to-line voltage"],
    ],
  },
  {
    modelType: "UG_XLPE_500MCM_15kV",
    aliases: ["500MCM_XLPE_15KV", "UG_500_15KV"],
    label: "500 kcmil Al 15 kV XLPE Concentric-Neutral Underground Cable",
    category: "Conductors & Cables",
    archetypeId: CymeArchetypeId.UNDERGROUND_CABLE,
    description:
      "15 kV class 500 kcmil Aluminum XLPE insulated underground feeder cable with concentric neutral return.",
    provenance: "Kersting, Distribution System Modeling and Analysis (4th ed., Ch. 4) / ICEA S-94-649",
    params: [
      ["rAcOhmPerKm", 0.141, "Ohm/km", "AC conductor resistance at 90 C"],
      ["gmrMm", 8.05, "mm", "Conductor Geometric Mean Radius (GMR)"],
      ["gmdMm", 150.0, "mm", "Equivalent trefoil/duct spacing GMD"],
      ["ampacityA", 385.0, "A", "Underground duct bank ampacity"],
      ["c1NfPerKm", 310.0, "nF/km", "Cable insulation shunt capacitance"],
      ["kVNom", 15.0, "kV", "Cable voltage class"],
    ],
  },
  {
    modelType: "UG_XLPE_1000MCM_25kV",
    aliases: ["1000MCM_XLPE_25KV", "UG_1000_25KV"],
    label: "1000 kcmil Cu 25 kV XLPE Concentric-Neutral Underground Cable",
    category: "Conductors & Cables",
    archetypeId: CymeArchetypeId.UNDERGROUND_CABLE,
    description: "25 kV class 1000 kcmil Copper XLPE insulated heavy underground substation exit cable.",
    provenance: "Kersting, Distribution System Modeling and Analysis (4th ed., Ch. 4) / ICEA S-94-649",
    params: [
      ["rAcOhmPerKm", 0.0485, "Ohm/km", "AC conductor resistance at 90 C"],
      ["gmrMm", 11.4, "mm", "Conductor Geometric Mean Radius (GMR)"],
      ["gmdMm", 180.0, "mm", "Equivalent duct spacing GMD"],
      ["ampacityA", 650.0, "A", "Underground duct bank ampacity"],
      ["c1NfPerKm", 340.0, "nF/km", "Cable insulation shunt capacitance"],
      ["kVNom", 25.0, "kV", "Cable voltage class"],
    ],
  },
  {
    modelType: "UG_EPR_4_0_15kV",
    aliases: ["4/0_EPR_15KV", "UG_4_0_EPR"],
    label: "4/0 AWG Al 15 kV EPR Underground Distribution Cable",
    category: "Conductors & Cables",
    archetypeId: CymeArchetypeId.UNDERGROUND_CABLE,
    description:
      "15 kV class 4/0 AWG Aluminum Ethylene Propylene Rubber (EPR) underground residential distribution cable.",
    provenance: "Kersting, Distribution System Modeling and Analysis (4th ed., Ch. 4) / AEIC CS8",
    params: [
      ["rAcOhmPerKm", 0.331, "Ohm/km", "AC conductor resistance at 90 C"],
      ["gmrMm", 5.23, "mm", "Conductor Geometric Mean Radius (GMR)"],
      ["gmdMm", 130.0, "mm", "Equivalent direct-buried spacing GMD"],
      ["ampacityA", 230.0, "A", "Direct-buried ampacity"],
      ["c1NfPerKm", 245.0, "nF/km", "Cable insulation shunt capacitance"],
      ["kVNom", 15.0, "kV", "Cable voltage class"],
    ],
  },

  // === 2. Transformers & Voltage Regulators ===
  {
    modelType: "XFMR_3P_DYN1_1500kVA",
    aliases: ["DYN1_1500KVA", "PADMOUNT_1500KVA"],
    label: "1500 kVA 3-Phase Delta-Wye (Dyn1) Pad-Mount Transformer",
    category: "Transformers & Regulators",
    archetypeId: CymeArchetypeId.TRANSFORMER,
    description: "Three-phase 12.47 kV / 0.48 kV 1500 kVA Dyn1 commercial pad-mount distribution transformer.",
    provenance: "IEEE Std C57.12.34 / Kersting, Distribution System Modeling and Analysis (Ch. 8)",
    params: [
      ["ratingKva", 1500.0, "kVA", "Nominal 3-phase apparent power rating"],
      ["vPriKv", 12.47, "kV", "Primary line-to-line voltage"],
      ["vSecKv", 0.48, "kV", "Secondary line-to-line voltage"],
      ["zPct", 5.75, "%", "Short-circuit impedance percentage"],
      ["xrRatio", 6.5, "ratio", "X/R impedance ratio"],
      ["noLoadLossKw", 2.4, "kW", "Core / no-load excitation loss"],
      ["tapPu", 1.0, "pu", "Off-circuit tap ratio"],
    ],
  },
  {
    modelType: "XFMR_3P_YY_10MVA",
    aliases: ["SUB_10MVA", "YY_10MVA"],
    label: "10 MVA 3-Phase Grounded Wye-Wye Substation Transformer",
    category: "Transformers & Regulators",
    archetypeId: CymeArchetypeId.TRANSFORMER,
    description: "Three-phase 69 kV / 12.47 kV 10 MVA Yg-Yg distribution substation power transformer.",
    provenance: "IEEE Std C57.12.00 / Kersting, Distribution System Modeling and Analysis (Ch. 8)",
    params: [
      ["ratingKva", 10000.0, "kVA", "Nominal 3-phase ONAN rating"],
      ["vPriKv", 69.0, "kV", "Primary sub-transmission voltage"],
      ["vSecKv", 12.47, "kV", "Secondary distribution voltage"],
      ["zPct", 7.5, "%", "Short-circuit impedance percentage"],
      ["xrRatio", 12.0, "ratio", "X/R impedance ratio"],
      ["noLoadLossKw", 11.5, "kW", "Core / no-load loss"],
      ["tapPu", 1.0, "pu", "Nominal tap ratio"],
    ],
  },
  {
    modelType: "XFMR_1P_POLE_50kVA",
    aliases: ["POLE_50KVA", "1P_50KVA"],
    label: "50 kVA Single-Phase Center-Tapped Pole-Mount Transformer",
    category: "Transformers & Regulators",
    archetypeId: CymeArchetypeId.TRANSFORMER,
    description: "Single-phase 7.2 kV / 120-240 V 50 kVA overhead pole-mounted residential service transformer.",
    provenance: "IEEE Std C57.12.20 / Kersting, Distribution System Modeling and Analysis (Ch. 8)",
    params: [
      ["ratingKva", 50.0, "kVA", "Nominal single-phase rating"],
      ["vPriKv", 7.2, "kV", "Primary line-to-neutral voltage"],
      ["vSecKv", 0.24, "kV", "Secondary 240 V split-phase voltage"],
      ["zPct", 2.4, "%", "Short-circuit impedance percentage"],
      ["xrRatio", 1.8, "ratio", "X/R impedance ratio"],
      ["noLoadLossKw", 0.14, "kW", "Core / no-load loss"],
      ["tapPu", 1.0, "pu", "Nominal tap ratio"],
    ],
  },
  {
    modelType: "REG_3P_STEP_32",
    aliases: ["3P_REG_32", "STEP_REG_3P"],
    label: "3-Phase 32-Step Voltage Regulator (+/-10% Range)",
    category: "Transformers & Regulators",
    archetypeId: CymeArchetypeId.VOLTAGE_REGULATOR,
    description:
      "Ganged 3-phase 32-step (+/-16 steps at 0.625%/step) distribution feeder step voltage regulator with Line Drop Compensation.",
    provenance: "IEEE Std C57.15 / Kersting, Distribution System Modeling and Analysis (Ch. 7)",
    params: [
      ["vSetPu", 1.025, "pu", "Voltage regulation setpoint (123 V on 120 V base)"],
      ["bandwidthPu", 0.01667, "pu", "Regulator deadband width (2 V on 120 V base)"],
      ["stepSizePu", 0.00625, "pu", "Per-tap voltage change (5/8%)"],
      ["maxSteps", 16.0, "steps", "Maximum raise/lower tap steps"],
      ["rLdcPu", 0.02, "pu", "Line drop compensator R setting"],
      ["xLdcPu", 0.04, "pu", "Line drop compensator X setting"],
      ["ratingKva", 5000.0, "kVA", "Through-power rating"],
    ],
  },
  {
    modelType: "REG_1P_STEP_32",
    aliases: ["1P_REG_32", "STEP_REG_1P"],
    label: "1-Phase 32-Step Voltage Regulator (+/-10% Range)",
    category: "Transformers & Regulators",
    archetypeId: CymeArchetypeId.VOLTAGE_REGULATOR,
    description: "Single-phase 32-step (+/-16 steps at 0.625%/step) pole-mounted distribution voltage regulator.",
    provenance: "IEEE Std C57.15 / Kersting, Distribution System Modeling and Analysis (Ch. 7)",
    params: [
      ["vSetPu", 1.025, "pu", "Voltage regulation setpoint"],
      ["bandwidthPu", 0.01667, "pu", "Regulator deadband width"],
      ["stepSizePu", 0.00625, "pu", "Per-tap voltage change (5/8%)"],
      ["maxSteps", 16.0, "steps", "Maximum raise/lower tap steps"],
      ["rLdcPu", 0.015, "pu", "Line drop compensator R setting"],
      ["xLdcPu", 0.03, "pu", "Line drop compensator X setting"],
      ["ratingKva", 167.0, "kVA", "Single-phase regulator rating"],
    ],
  },

  // === 3. Protection & Switching ===
  {
    modelType: "FUSE_K_65A",
    aliases: ["65K", "FUSE_65K"],
    label: "65A Type-K (Fast) Expulsion Fuse Link",
    category: "Protection & Switching",
    archetypeId: CymeArchetypeId.FUSE_LINK,
    description:
      "ANSI/IEEE C37.42 65A Type-K fast-speed distribution cutout fuse link with I^2*t minimum melting curve.",
    provenance: "IEEE Std C37.41 / ANSI C37.42 Fuse Link Time-Current Characteristics",
    params: [
      ["ratedAmps", 65.0, "A", "Continuous current rating"],
      ["i2tMelt", 18500.0, "A^2*s", "Minimum melting I^2*t constant"],
      ["minMeltMult", 2.0, "pu", "Minimum melting pickup multiple"],
      ["clearFactor", 1.35, "ratio", "Total clearing to minimum melting ratio"],
      ["kVNom", 15.0, "kV", "Maximum design voltage"],
    ],
  },
  {
    modelType: "FUSE_T_100A",
    aliases: ["100T", "FUSE_100T"],
    label: "100A Type-T (Slow) Expulsion Fuse Link",
    category: "Protection & Switching",
    archetypeId: CymeArchetypeId.FUSE_LINK,
    description:
      "ANSI/IEEE C37.42 100A Type-T slow-speed distribution lateral fuse link with high I^2*t thermal withstand.",
    provenance: "IEEE Std C37.41 / ANSI C37.42 Fuse Link Time-Current Characteristics",
    params: [
      ["ratedAmps", 100.0, "A", "Continuous current rating"],
      ["i2tMelt", 115000.0, "A^2*s", "Minimum melting I^2*t constant"],
      ["minMeltMult", 2.0, "pu", "Minimum melting pickup multiple"],
      ["clearFactor", 1.4, "ratio", "Total clearing to minimum melting ratio"],
      ["kVNom", 15.0, "kV", "Maximum design voltage"],
    ],
  },
  {
    modelType: "RECLOSER_3P_HYD",
    aliases: ["RECLOSER_HYD", "HYD_RECLOSER"],
    label: "3-Phase Hydraulic Automatic Circuit Recloser",
    category: "Protection & Switching",
    archetypeId: CymeArchetypeId.OVERCURRENT_IEEE,
    description:
      "Three-phase distribution pole-mounted hydraulic recloser with IEEE C37.112 fast/delayed inverse overcurrent curves.",
    provenance: "IEEE Std C37.60 / IEEE Std C37.112-2018",
    params: [
      ["pickupAmps", 280.0, "A", "Minimum trip current"],
      ["timeDial", 0.5, "s", "Time dial multiplier"],
      ["curveA", 0.0515, "s", "IEEE Moderately Inverse constant A"],
      ["curveB", 0.114, "s", "IEEE Moderately Inverse constant B"],
      ["curveP", 0.02, "exp", "IEEE Moderately Inverse exponent p"],
      ["instMult", 12.0, "pu", "Fast trip / instantaneous multiple"],
      ["instTimeSec", 0.03, "s", "Fast clearing time"],
    ],
  },
  {
    modelType: "RELAY_OC_IEEE_VI",
    aliases: ["IEEE_VI", "51_IEEE_VI", "C37_112_VI"],
    label: "IEEE C37.112 Very Inverse Overcurrent Relay (51)",
    category: "Protection & Switching",
    archetypeId: CymeArchetypeId.OVERCURRENT_IEEE,
    description: "IEEE Std C37.112-2018 Very Inverse (U3) time-overcurrent protective relay (A=19.61, B=0.491, p=2.0).",
    provenance: "IEEE Std C37.112-2018 Table 1 (Very Inverse Curve)",
    params: [
      ["pickupAmps", 400.0, "A", "Phase overcurrent pickup current (Ip)"],
      ["timeDial", 1.0, "TD", "Time Dial setting (TD)"],
      ["curveA", 19.61, "s", "IEEE C37.112 Very Inverse constant A"],
      ["curveB", 0.491, "s", "IEEE C37.112 Very Inverse constant B"],
      ["curveP", 2.0, "exp", "IEEE C37.112 Very Inverse exponent p"],
      ["instMult", 10.0, "pu", "Instantaneous 50 element pickup multiple"],
      ["instTimeSec", 0.02, "s", "Instantaneous operating time"],
    ],
  },
  {
    modelType: "RELAY_OC_IEC_SI",
    aliases: ["IEC_SI", "51_IEC_SI", "IEC_60255_SI"],
    label: "IEC 60255-151 Standard Inverse Overcurrent Relay",
    category: "Protection & Switching",
    archetypeId: CymeArchetypeId.OVERCURRENT_IEC,
    description: "IEC 60255-151 Standard Inverse (Class A) time-overcurrent relay (k=0.14, alpha=0.02).",
    provenance: "IEC 60255-151:2009 Table 1 (Standard Inverse Curve)",
    params: [
      ["pickupAmps", 400.0, "A", "Phase overcurrent pickup current (Is)"],
      ["tms", 0.5, "TMS", "Time Multiplier Setting (TMS)"],
      ["curveK", 0.14, "s", "IEC 60255 Standard Inverse constant k"],
      ["curveAlpha", 0.02, "exp", "IEC 60255 Standard Inverse exponent alpha"],
      ["instMult", 10.0, "pu", "Instantaneous element pickup multiple"],
      ["instTimeSec", 0.02, "s", "Instantaneous operating time"],
    ],
  },
  {
    modelType: "BREAKER_DIST_15kV",
    aliases: ["CB_15KV", "BREAKER_15KV"],
    label: "15 kV Substation Feeder Vacuum Circuit Breaker",
    category: "Protection & Switching",
    archetypeId: CymeArchetypeId.SWITCHGEAR,
    description: "15 kV class 1200 A, 25 kA interrupting rating substation distribution feeder vacuum circuit breaker.",
    provenance: "IEEE Std C37.06 / IEEE Std C37.04",
    params: [
      ["ratedAmps", 1200.0, "A", "Continuous current rating"],
      ["interruptingKa", 25.0, "kA", "Symmetrical short-circuit interrupting rating"],
      ["rClosedOhm", 0.0005, "Ohm", "Closed contact resistance"],
      ["clearTimeSec", 0.05, "s", "3-cycle breaker interrupting time"],
      ["kVNom", 15.0, "kV", "Rated maximum voltage"],
    ],
  },
  {
    modelType: "SWITCH_LOADBREAK",
    aliases: ["LBS_600A", "LOADBREAK_SW"],
    label: "600A 15 kV Gang-Operated Load-Break Switch",
    category: "Protection & Switching",
    archetypeId: CymeArchetypeId.SWITCHGEAR,
    description: "Three-phase 600 A gang-operated distribution sectionalizing load-break switch.",
    provenance: "IEEE Std C37.74 / ANSI C37.30",
    params: [
      ["ratedAmps", 600.0, "A", "Continuous load-break current rating"],
      ["interruptingKa", 0.6, "kA", "Load-interruption rating"],
      ["rClosedOhm", 0.001, "Ohm", "Closed blade contact resistance"],
      ["clearTimeSec", 0.1, "s", "Manual/motorized opening time"],
      ["kVNom", 15.0, "kV", "Rated maximum voltage"],
    ],
  },

  // === 4. Shunts, Loads & DER ===
  {
    modelType: "CAP_BANK_3P_1200kVAR",
    aliases: ["CAP_1200KVAR", "SHUNT_CAP_1200"],
    label: "1200 kVAR 3-Phase Switched Shunt Capacitor Bank",
    category: "Shunts, Loads & DER",
    archetypeId: CymeArchetypeId.SHUNT_CAPACITOR,
    description:
      "Three-phase 12.47 kV 1200 kVAR pole-mounted distribution shunt capacitor bank for power factor and voltage support.",
    provenance: "IEEE Std 18 / Kersting, Distribution System Modeling and Analysis (Ch. 9)",
    params: [
      ["qNomKvar", 1200.0, "kVAR", "Nominal 3-phase reactive power at rated voltage"],
      ["vNomKv", 12.47, "kV", "Nominal line-to-line voltage"],
      ["steps", 1.0, "steps", "Number of switched capacitor steps"],
    ],
  },
  {
    modelType: "LOAD_ZIP_DIST",
    aliases: ["ZIP_LOAD", "DIST_LOAD_ZIP"],
    label: "Composite ZIP Distribution Feeder Load",
    category: "Shunts, Loads & DER",
    archetypeId: CymeArchetypeId.ZIP_LOAD,
    description:
      "Voltage-dependent composite polynomial (Constant-Z, Constant-I, Constant-P) distribution feeder load model.",
    provenance: "IEEE Task Force on Load Representation (1993) / Kersting (Ch. 9)",
    params: [
      ["pNomKw", 500.0, "kW", "Nominal active power at 1.0 pu voltage"],
      ["qNomKvar", 200.0, "kVAR", "Nominal reactive power at 1.0 pu voltage"],
      ["zp", 0.3, "pu", "Active power constant-impedance fraction"],
      ["ip", 0.3, "pu", "Active power constant-current fraction"],
      ["pp", 0.4, "pu", "Active power constant-power fraction"],
      ["zq", 0.5, "pu", "Reactive power constant-impedance fraction"],
      ["iq", 0.2, "pu", "Reactive power constant-current fraction"],
      ["pq", 0.3, "pu", "Reactive power constant-power fraction"],
    ],
  },
  {
    modelType: "DER_PV_IEEE1547",
    aliases: ["PV_IEEE1547", "SMART_INVERTER_PV"],
    label: "IEEE 1547-2018 Category B Solar PV Smart Inverter",
    category: "Shunts, Loads & DER",
    archetypeId: CymeArchetypeId.DER_IEEE1547,
    description:
      "Grid-following photovoltaic smart inverter implementing IEEE Std 1547-2018 Category B Volt-VAR and Volt-Watt autonomous voltage regulation.",
    provenance: "IEEE Std 1547-2018 Category B (Tables 8 & 10, Volt-VAR & Volt-Watt)",
    params: [
      ["sRatedKva", 500.0, "kVA", "Inverter apparent power rating"],
      ["v1Pu", 0.92, "pu", "Volt-VAR V1 breakpoint (max capacitive injection)"],
      ["v2Pu", 0.98, "pu", "Volt-VAR V2 lower deadband breakpoint"],
      ["v3Pu", 1.02, "pu", "Volt-VAR V3 upper deadband breakpoint"],
      ["v4Pu", 1.08, "pu", "Volt-VAR V4 breakpoint (max inductive absorption)"],
      ["qMaxPu", 0.44, "pu", "Category B maximum reactive injection (+Q)"],
      ["qMinAbsPu", 0.44, "pu", "Category B maximum reactive absorption (|-Q|)"],
      ["vw1Pu", 1.06, "pu", "Volt-Watt curtailment start voltage"],
      ["vw2Pu", 1.1, "pu", "Volt-Watt full curtailment voltage"],
      ["pMinPu", 0.2, "pu", "Minimum active power floor at V >= vw2"],
    ],
  },
  {
    modelType: "DER_BESS_IEEE1547",
    aliases: ["BESS_IEEE1547", "BATTERY_DER"],
    label: "IEEE 1547-2018 Category B Battery Energy Storage (BESS)",
    category: "Shunts, Loads & DER",
    archetypeId: CymeArchetypeId.DER_IEEE1547,
    description:
      "Four-quadrant distribution battery energy storage inverter with IEEE 1547-2018 Category B Volt-VAR and Volt-Watt curves.",
    provenance: "IEEE Std 1547-2018 Category B (Tables 8 & 10)",
    params: [
      ["sRatedKva", 1000.0, "kVA", "BESS inverter apparent power rating"],
      ["v1Pu", 0.92, "pu", "Volt-VAR V1 breakpoint"],
      ["v2Pu", 0.98, "pu", "Volt-VAR V2 lower deadband breakpoint"],
      ["v3Pu", 1.02, "pu", "Volt-VAR V3 upper deadband breakpoint"],
      ["v4Pu", 1.08, "pu", "Volt-VAR V4 breakpoint"],
      ["qMaxPu", 0.44, "pu", "Maximum reactive injection (+Q)"],
      ["qMinAbsPu", 0.44, "pu", "Maximum reactive absorption (|-Q|)"],
      ["vw1Pu", 1.06, "pu", "Volt-Watt curtailment start voltage"],
      ["vw2Pu", 1.1, "pu", "Volt-Watt zero-export voltage"],
      ["pMinPu", 0.0, "pu", "Minimum active power output at V >= vw2"],
    ],
  },
  {
    modelType: "DER_WIND_DIST",
    aliases: ["WIND_IEEE1547", "DIST_WIND"],
    label: "IEEE 1547-2018 Distributed Wind Turbine Generator",
    category: "Shunts, Loads & DER",
    archetypeId: CymeArchetypeId.DER_IEEE1547,
    description:
      "Type-4 full-converter distributed wind generator with IEEE 1547-2018 Category B Volt-VAR / Volt-Watt support.",
    provenance: "IEEE Std 1547-2018 Category B / IEC 61400-27-1",
    params: [
      ["sRatedKva", 1500.0, "kVA", "Wind converter apparent power rating"],
      ["v1Pu", 0.92, "pu", "Volt-VAR V1 breakpoint"],
      ["v2Pu", 0.98, "pu", "Volt-VAR V2 lower deadband breakpoint"],
      ["v3Pu", 1.02, "pu", "Volt-VAR V3 upper deadband breakpoint"],
      ["v4Pu", 1.08, "pu", "Volt-VAR V4 breakpoint"],
      ["qMaxPu", 0.44, "pu", "Maximum reactive injection (+Q)"],
      ["qMinAbsPu", 0.44, "pu", "Maximum reactive absorption (|-Q|)"],
      ["vw1Pu", 1.06, "pu", "Volt-Watt curtailment start voltage"],
      ["vw2Pu", 1.1, "pu", "Volt-Watt curtailment end voltage"],
      ["pMinPu", 0.2, "pu", "Minimum active power floor"],
    ],
  },
  {
    modelType: "EV_CHARGER_L3",
    aliases: ["DCFC_L3", "EV_DCFC"],
    label: "Level-3 DC Fast Charger (Constant-Power Rectifier Load)",
    category: "Shunts, Loads & DER",
    archetypeId: CymeArchetypeId.ZIP_LOAD,
    description: "350 kW three-phase Level-3 EV DC Fast Charger modeled as high-power-factor constant-power ZIP load.",
    provenance: "SAE J1772 / IEEE Std 1547-2018 / EPRI EV Grid Integration Guidelines",
    params: [
      ["pNomKw", 350.0, "kW", "Rated DC fast charging active power"],
      ["qNomKvar", 35.0, "kVAR", "Nominal reactive power at 0.995 pf"],
      ["zp", 0.0, "pu", "Constant-impedance active fraction"],
      ["ip", 0.05, "pu", "Constant-current active fraction"],
      ["pp", 0.95, "pu", "Constant-power active fraction"],
      ["zq", 0.0, "pu", "Constant-impedance reactive fraction"],
      ["iq", 0.1, "pu", "Constant-current reactive fraction"],
      ["pq", 0.9, "pu", "Constant-power reactive fraction"],
    ],
  },
];

/**
 * Converts `CYME_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildCymeCleanroomSchemas(): CleanroomModelSchema[] {
  return CYME_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `cyme:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "electrical",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "cyme_equipment_model",
      width: 96,
      height: 48,
      svg: generateCymeBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
