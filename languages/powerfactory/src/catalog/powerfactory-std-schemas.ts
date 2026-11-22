// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * Cleanroom DIgSILENT PowerFactory Global Library & DSL model archetype IDs
 * matching `assets/powerfactory-std-lib/src/models.ts`.
 */
export const PowerFactoryArchetypeId = {
  EQUIP_LINE_OHL: 1,
  EQUIP_LINE_CABLE: 2,
  EQUIP_TRANSFORMER_2W: 3,
  EQUIP_TRANSFORMER_3W: 4,
  EQUIP_SYNC_MACHINE: 10,
  EQUIP_ASYNC_MOTOR: 11,
  EQUIP_STATIC_LOAD: 12,
  EQUIP_STATIC_GEN: 13,
  DSL_EXCITER_STATIC: 20,
  DSL_EXCITER_AC: 21,
  DSL_EXCITER_DC: 22,
  DSL_GOVERNOR_STEAM: 30,
  DSL_GOVERNOR_HYDRO: 31,
  DSL_GOVERNOR_GAS: 32,
  DSL_STABILIZER: 40,
  DSL_IBR_CONVERTER: 50,
  DSL_IBR_ELECTRICAL: 51,
  DSL_IBR_PLANT_CTRL: 52,
  DSL_FACTS_SVC: 60,
  RELAY_TOC_IEC: 70,
  RELAY_TOC_IEEE: 71,
  RELAY_DISTANCE_21: 72,
  RELAY_DIFF_87: 73,
  RELAY_UFLS_81: 74,
} as const;

export type PowerFactoryArchetypeId = (typeof PowerFactoryArchetypeId)[keyof typeof PowerFactoryArchetypeId];

export type PowerFactoryCategory =
  | "Transmission Line / Cable"
  | "Transformer"
  | "Rotating Machine"
  | "Static Load / IBR"
  | "Exciter (DSL)"
  | "Governor (DSL)"
  | "Stabilizer (DSL)"
  | "Renewable / FACTS (DSL)"
  | "Protection Relay";

export interface PowerFactoryModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: PowerFactoryCategory;
  archetypeId: PowerFactoryArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<PowerFactoryCategory, { fill: string; stroke: string; badge: string }> = {
  "Transmission Line / Cable": { fill: "#172554", stroke: "#38bdf8", badge: "LNE" },
  Transformer: { fill: "#1e1b4b", stroke: "#818cf8", badge: "TRF" },
  "Rotating Machine": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "SYM" },
  "Static Load / IBR": { fill: "#163b3b", stroke: "#2dd4bf", badge: "GEN" },
  "Exciter (DSL)": { fill: "#3b1f47", stroke: "#c084fc", badge: "VCO" },
  "Governor (DSL)": { fill: "#1e3f2f", stroke: "#34d399", badge: "GOV" },
  "Stabilizer (DSL)": { fill: "#3f2e18", stroke: "#fbbf24", badge: "PSS" },
  "Renewable / FACTS (DSL)": { fill: "#134e4a", stroke: "#5eead4", badge: "DSL" },
  "Protection Relay": { fill: "#451a03", stroke: "#fb923c", badge: "REL" },
};

/**
 * Generates a deterministic cleanroom SVG icon for a PowerFactory Global Library or DSL model.
 */
export function generatePowerFactoryBlockSvg(modelType: string, category: PowerFactoryCategory): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType
    .replace(/^(TypLne_|TypTr2_|TypTr3_|TypSym_|TypAsmo_|TypLod_|TypGenstat_|vco_|gov_|pss_|wecc_|svc_|rel_)/, "")
    .slice(0, 10);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 48" width="88" height="48">` +
    `<rect x="2" y="2" width="84" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="34" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: PowerFactoryCategory): DiagramPortSpec[] {
  switch (category) {
    case "Transmission Line / Cable":
      return [
        { name: "bus1", kind: "electrical", side: "left", dx: 0, dy: 24 },
        { name: "bus2", kind: "electrical", side: "right", dx: 88, dy: 24 },
      ];
    case "Transformer":
      return [
        { name: "hv", kind: "electrical", side: "left", dx: 0, dy: 24 },
        { name: "lv", kind: "electrical", side: "right", dx: 88, dy: 24 },
      ];
    case "Rotating Machine":
      return [
        { name: "ve", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "pt", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "bus", kind: "electrical", side: "right", dx: 88, dy: 24 },
      ];
    case "Static Load / IBR":
      return [
        { name: "ctrl", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "bus", kind: "electrical", side: "right", dx: 88, dy: 24 },
      ];
    case "Exciter (DSL)":
      return [
        { name: "ut", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "upss", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "ve", kind: "signal", side: "right", dx: 88, dy: 24 },
      ];
    case "Governor (DSL)":
      return [
        { name: "speed", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "pt", kind: "signal", side: "right", dx: 88, dy: 24 },
      ];
    case "Stabilizer (DSL)":
      return [
        { name: "speed", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "upss", kind: "signal", side: "right", dx: 88, dy: 24 },
      ];
    case "Renewable / FACTS (DSL)":
      return [
        { name: "pref", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "qref", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "bus", kind: "electrical", side: "right", dx: 88, dy: 24 },
      ];
    case "Protection Relay":
      return [
        { name: "ct_vt", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "trip", kind: "signal", side: "right", dx: 88, dy: 24 },
      ];
  }
}

const SYNC_THERMAL_PARAMS: PowerFactoryModelSpec["params"] = [
  ["snom", 250.0, "MVA", "Rated apparent power"],
  ["unom", 15.75, "kV", "Rated terminal voltage"],
  ["h", 4.5, "s", "Inertia time constant H"],
  ["d", 1.5, "pu", "Speed damping coefficient"],
  ["xd", 1.9, "pu", "d-axis synchronous reactance"],
  ["xq", 1.8, "pu", "q-axis synchronous reactance"],
  ["xdp", 0.28, "pu", "d-axis transient reactance"],
  ["xdpp", 0.2, "pu", "d-axis subtransient reactance"],
  ["tdp0", 6.5, "s", "d-axis transient open-circuit time constant"],
  ["tdpp0", 0.04, "s", "d-axis subtransient open-circuit time constant"],
  ["xl", 0.14, "pu", "Stator leakage reactance"],
];

const SYNC_HYDRO_PARAMS: PowerFactoryModelSpec["params"] = [
  ["snom", 120.0, "MVA", "Rated apparent power"],
  ["unom", 13.8, "kV", "Rated terminal voltage"],
  ["h", 3.2, "s", "Inertia time constant H"],
  ["d", 1.0, "pu", "Speed damping coefficient"],
  ["xd", 1.15, "pu", "d-axis synchronous reactance"],
  ["xq", 0.72, "pu", "q-axis synchronous reactance"],
  ["xdp", 0.32, "pu", "d-axis transient reactance"],
  ["xdpp", 0.22, "pu", "d-axis subtransient reactance"],
  ["tdp0", 5.5, "s", "d-axis transient open-circuit time constant"],
  ["tdpp0", 0.05, "s", "d-axis subtransient open-circuit time constant"],
  ["xl", 0.15, "pu", "Stator leakage reactance"],
];

const EXCITER_STATIC_PARAMS: PowerFactoryModelSpec["params"] = [
  ["tr", 0.02, "s", "Measurement filter time constant"],
  ["vimax", 0.5, "pu", "Voltage error upper limit"],
  ["vimin", -0.5, "pu", "Voltage error lower limit"],
  ["tc", 1.0, "s", "Lead time constant"],
  ["tb", 10.0, "s", "Lag time constant"],
  ["ka", 200.0, "pu", "Voltage regulator gain"],
  ["ta", 0.05, "s", "Voltage regulator time constant"],
  ["vrmax", 5.0, "pu", "Maximum regulator output"],
  ["vrmin", -4.5, "pu", "Minimum regulator output"],
  ["kc", 0.05, "pu", "Rectifier commutation factor"],
  ["kf", 0.0, "pu", "Rate feedback gain"],
  ["tf", 1.0, "s", "Rate feedback time constant"],
];

const EXCITER_ROTATING_PARAMS: PowerFactoryModelSpec["params"] = [
  ["tr", 0.02, "s", "Measurement filter time constant"],
  ["vimax", 0.5, "pu", "Voltage error upper limit"],
  ["vimin", -0.5, "pu", "Voltage error lower limit"],
  ["te", 0.8, "s", "Exciter field time constant"],
  ["ke", 1.0, "pu", "Exciter constant related to self-excited field"],
  ["ka", 150.0, "pu", "Voltage regulator gain"],
  ["ta", 0.06, "s", "Voltage regulator time constant"],
  ["vrmax", 5.2, "pu", "Maximum regulator output"],
  ["vrmin", -4.0, "pu", "Minimum regulator output"],
  ["kf", 0.03, "pu", "Stabilizing feedback gain"],
  ["tf", 1.0, "s", "Stabilizing feedback time constant"],
];

const GOVERNOR_STEAM_PARAMS: PowerFactoryModelSpec["params"] = [
  ["r", 0.05, "pu", "Permanent speed droop"],
  ["t1", 0.5, "s", "Governor lag time constant"],
  ["vmax", 1.0, "pu", "Maximum valve position"],
  ["vmin", 0.0, "pu", "Minimum valve position"],
  ["t2", 1.0, "s", "Turbine lead time constant"],
  ["t3", 5.0, "s", "Reheater lag time constant"],
  ["dt", 0.0, "pu", "Turbine damping factor"],
];

const GOVERNOR_HYDRO_PARAMS: PowerFactoryModelSpec["params"] = [
  ["r", 0.05, "pu", "Permanent droop"],
  ["t1", 0.5, "s", "Servo time constant"],
  ["gmax", 1.0, "pu", "Maximum gate opening"],
  ["gmin", 0.0, "pu", "Minimum gate opening"],
  ["rt", 0.4, "pu", "Temporary droop"],
  ["tw", 1.5, "s", "Water starting time"],
  ["tr", 5.0, "s", "Dashpot time constant"],
  ["at", 1.2, "pu", "Turbine gain"],
  ["dturb", 0.2, "pu", "Turbine damping"],
  ["qnl", 0.08, "pu", "No-load flow"],
];

const PSS_PARAMS: PowerFactoryModelSpec["params"] = [
  ["tw1", 10.0, "s", "Washout time constant 1"],
  ["tw2", 10.0, "s", "Washout time constant 2"],
  ["ks1", 10.0, "pu", "Stabilizer gain"],
  ["t1", 0.15, "s", "Lead time constant 1"],
  ["t2", 0.03, "s", "Lag time constant 1"],
  ["t3", 0.15, "s", "Lead time constant 2"],
  ["t4", 0.03, "s", "Lag time constant 2"],
  ["vstmax", 0.1, "pu", "Maximum stabilizer output"],
  ["vstmin", -0.1, "pu", "Minimum stabilizer output"],
];

const IBR_REGC_PARAMS: PowerFactoryModelSpec["params"] = [
  ["tg", 0.02, "s", "Converter current control time constant"],
  ["rrpwr", 10.0, "pu/s", "Active current ramp rate limit"],
  ["brkpt", 0.9, "pu", "Low-voltage active current breakpoint"],
  ["zerox", 0.4, "pu", "Low-voltage active current zero crossing"],
  ["lvpl1", 1.22, "pu", "LVPL gain breakpoint"],
  ["kqv", 2.0, "pu", "Reactive current voltage support gain"],
  ["vtmax", 1.2, "pu", "High-voltage reactive current limit threshold"],
  ["qmin", -1.3, "pu", "Minimum reactive current limit"],
  ["imax", 1.1, "pu", "Maximum converter current limit"],
];

/**
 * Comprehensive cleanroom DIgSILENT PowerFactory Global Library & DSL model catalog.
 * All parameter defaults and mathematical formulations originate from public IEC, IEEE,
 * CIGRE, and WECC technical standards.
 */
export const POWERFACTORY_MODEL_SPECS: PowerFactoryModelSpec[] = [
  // =========================================================================
  // 1. Equipment Types (TypLne, TypTr2, TypTr3, TypSym, TypAsmo, TypLod, TypGenstat)
  // =========================================================================
  {
    modelType: "TypLne_OHL_110kV",
    aliases: ["OHL_110kV", "TypLne.OHL110"],
    label: "110 kV Overhead Line (ACSR 240/40)",
    category: "Transmission Line / Cable",
    archetypeId: PowerFactoryArchetypeId.EQUIP_LINE_OHL,
    description: "Standard 110 kV single-circuit ACSR 240/40 overhead transmission line type.",
    provenance: "IEC 60909-2 / CIGRE TB 272 Overhead Line Reference Data",
    params: [
      ["uline", 110.0, "kV", "Rated line voltage"],
      ["inom", 0.645, "kA", "Rated thermal current"],
      ["r1", 0.12, "Ohm/km", "Positive-sequence resistance"],
      ["x1", 0.4, "Ohm/km", "Positive-sequence reactance"],
      ["b1", 2.8, "uS/km", "Positive-sequence susceptance"],
      ["r0", 0.27, "Ohm/km", "Zero-sequence resistance"],
      ["x0", 1.25, "Ohm/km", "Zero-sequence reactance"],
      ["b0", 1.7, "uS/km", "Zero-sequence susceptance"],
    ],
  },
  {
    modelType: "TypLne_OHL_220kV",
    aliases: ["OHL_220kV", "TypLne.OHL220"],
    label: "220 kV Overhead Line (ACSR 2x265/35)",
    category: "Transmission Line / Cable",
    archetypeId: PowerFactoryArchetypeId.EQUIP_LINE_OHL,
    description: "Standard 220 kV twin-bundle ACSR overhead transmission line type.",
    provenance: "IEC 60909-2 / CIGRE TB 272 Overhead Line Reference Data",
    params: [
      ["uline", 220.0, "kV", "Rated line voltage"],
      ["inom", 1.36, "kA", "Rated thermal current"],
      ["r1", 0.055, "Ohm/km", "Positive-sequence resistance"],
      ["x1", 0.31, "Ohm/km", "Positive-sequence reactance"],
      ["b1", 3.6, "uS/km", "Positive-sequence susceptance"],
      ["r0", 0.2, "Ohm/km", "Zero-sequence resistance"],
      ["x0", 1.05, "Ohm/km", "Zero-sequence reactance"],
      ["b0", 2.1, "uS/km", "Zero-sequence susceptance"],
    ],
  },
  {
    modelType: "TypLne_OHL_400kV",
    aliases: ["OHL_400kV", "TypLne.OHL400"],
    label: "400 kV Overhead Line (ACSR 4x265/35)",
    category: "Transmission Line / Cable",
    archetypeId: PowerFactoryArchetypeId.EQUIP_LINE_OHL,
    description: "Standard 400 kV quad-bundle ACSR EHV overhead transmission line type.",
    provenance: "IEC 60909-2 / ENTSO-E & CIGRE EHV Benchmark Line Data",
    params: [
      ["uline", 400.0, "kV", "Rated line voltage"],
      ["inom", 2.72, "kA", "Rated thermal current"],
      ["r1", 0.028, "Ohm/km", "Positive-sequence resistance"],
      ["x1", 0.26, "Ohm/km", "Positive-sequence reactance"],
      ["b1", 4.3, "uS/km", "Positive-sequence susceptance"],
      ["r0", 0.16, "Ohm/km", "Zero-sequence resistance"],
      ["x0", 0.92, "Ohm/km", "Zero-sequence reactance"],
      ["b0", 2.5, "uS/km", "Zero-sequence susceptance"],
    ],
  },
  {
    modelType: "TypLne_Cable_20kV",
    aliases: ["Cable_20kV", "NA2XS2Y_20kV"],
    label: "20 kV XLPE Underground Cable (185 mm2 Al)",
    category: "Transmission Line / Cable",
    archetypeId: PowerFactoryArchetypeId.EQUIP_LINE_CABLE,
    description: "Standard 20 kV medium-voltage XLPE single-core trefoil cable type.",
    provenance: "IEC 60502-2 / CIGRE TB 575 MV Distribution Benchmark",
    params: [
      ["uline", 20.0, "kV", "Rated cable voltage"],
      ["inom", 0.355, "kA", "Rated thermal current"],
      ["r1", 0.164, "Ohm/km", "Positive-sequence resistance"],
      ["x1", 0.112, "Ohm/km", "Positive-sequence reactance"],
      ["b1", 88.0, "uS/km", "Positive-sequence susceptance"],
      ["r0", 0.65, "Ohm/km", "Zero-sequence resistance"],
      ["x0", 0.35, "Ohm/km", "Zero-sequence reactance"],
      ["b0", 88.0, "uS/km", "Zero-sequence susceptance"],
    ],
  },
  {
    modelType: "TypLne_Cable_110kV",
    aliases: ["Cable_110kV", "XLPE_110kV"],
    label: "110 kV XLPE Underground Cable (630 mm2 Cu)",
    category: "Transmission Line / Cable",
    archetypeId: PowerFactoryArchetypeId.EQUIP_LINE_CABLE,
    description: "Standard 110 kV high-voltage XLPE underground cable type.",
    provenance: "IEC 60840 / CIGRE TB 490 HV Cable Reference Data",
    params: [
      ["uline", 110.0, "kV", "Rated cable voltage"],
      ["inom", 0.82, "kA", "Rated thermal current"],
      ["r1", 0.036, "Ohm/km", "Positive-sequence resistance"],
      ["x1", 0.125, "Ohm/km", "Positive-sequence reactance"],
      ["b1", 72.0, "uS/km", "Positive-sequence susceptance"],
      ["r0", 0.14, "Ohm/km", "Zero-sequence resistance"],
      ["x0", 0.32, "Ohm/km", "Zero-sequence reactance"],
      ["b0", 72.0, "uS/km", "Zero-sequence susceptance"],
    ],
  },
  {
    modelType: "TypTr2_110_20kV",
    aliases: ["Tr2_110_20kV", "TypTr2.110_20"],
    label: "2-Winding Transformer 110/20 kV (40 MVA)",
    category: "Transformer",
    archetypeId: PowerFactoryArchetypeId.EQUIP_TRANSFORMER_2W,
    description: "Standard 110/20 kV YNd11 substation two-winding power transformer.",
    provenance: "IEC 60076-1 / CIGRE TB 575 MV Substation Transformer",
    params: [
      ["strn", 40.0, "MVA", "Rated apparent power"],
      ["utrn_h", 110.0, "kV", "Rated HV voltage"],
      ["utrn_l", 20.0, "kV", "Rated LV voltage"],
      ["ukrr", 12.0, "%", "Short-circuit impedance voltage"],
      ["pkr", 160.0, "kW", "Load (copper) losses at rated current"],
      ["pfe", 25.0, "kW", "No-load (iron) losses"],
      ["i0", 0.3, "%", "No-load current"],
    ],
  },
  {
    modelType: "TypTr2_220_110kV",
    aliases: ["Tr2_220_110kV", "TypTr2.220_110"],
    label: "2-Winding Transformer 220/110 kV (150 MVA)",
    category: "Transformer",
    archetypeId: PowerFactoryArchetypeId.EQUIP_TRANSFORMER_2W,
    description: "Standard 220/110 kV YNy0 transmission intertie autotransformer.",
    provenance: "IEC 60076-1 / IEC 60909-2 Transmission Transformer Data",
    params: [
      ["strn", 150.0, "MVA", "Rated apparent power"],
      ["utrn_h", 220.0, "kV", "Rated HV voltage"],
      ["utrn_l", 110.0, "kV", "Rated LV voltage"],
      ["ukrr", 12.5, "%", "Short-circuit impedance voltage"],
      ["pkr", 420.0, "kW", "Load (copper) losses at rated current"],
      ["pfe", 65.0, "kW", "No-load (iron) losses"],
      ["i0", 0.25, "%", "No-load current"],
    ],
  },
  {
    modelType: "TypTr2_400_220kV",
    aliases: ["Tr2_400_220kV", "TypTr2.400_220"],
    label: "2-Winding Transformer 400/220 kV (300 MVA)",
    category: "Transformer",
    archetypeId: PowerFactoryArchetypeId.EQUIP_TRANSFORMER_2W,
    description: "Standard 400/220 kV EHV transmission bulk power transformer.",
    provenance: "IEC 60076-1 / ENTSO-E & CIGRE EHV Transformer Reference",
    params: [
      ["strn", 300.0, "MVA", "Rated apparent power"],
      ["utrn_h", 400.0, "kV", "Rated HV voltage"],
      ["utrn_l", 220.0, "kV", "Rated LV voltage"],
      ["ukrr", 14.0, "%", "Short-circuit impedance voltage"],
      ["pkr", 750.0, "kW", "Load (copper) losses at rated current"],
      ["pfe", 110.0, "kW", "No-load (iron) losses"],
      ["i0", 0.2, "%", "No-load current"],
    ],
  },
  {
    modelType: "TypTr3_3W",
    aliases: ["Tr3_3W", "TypTr3.400_110_30"],
    label: "3-Winding Transformer 400/110/30 kV (300 MVA)",
    category: "Transformer",
    archetypeId: PowerFactoryArchetypeId.EQUIP_TRANSFORMER_3W,
    description: "Standard YNy0d11 three-winding transmission transformer with tertiary delta winding.",
    provenance: "IEC 60076-1 / IEC 60909-0 Three-Winding Equivalent Circuit",
    params: [
      ["strn_h", 300.0, "MVA", "HV winding rated power"],
      ["strn_m", 300.0, "MVA", "MV winding rated power"],
      ["strn_l", 100.0, "MVA", "LV tertiary winding rated power"],
      ["utrn_h", 400.0, "kV", "Rated HV voltage"],
      ["utrn_m", 110.0, "kV", "Rated MV voltage"],
      ["utrn_l", 30.0, "kV", "Rated LV voltage"],
      ["uk_hm", 13.5, "%", "HV-MV short-circuit voltage"],
      ["uk_ml", 9.0, "%", "MV-LV short-circuit voltage"],
      ["uk_hl", 16.0, "%", "HV-LV short-circuit voltage"],
    ],
  },
  {
    modelType: "TypSym_Thermal",
    aliases: ["Sym_Thermal", "TypSym.RoundRotor"],
    label: "Thermal Synchronous Generator (Round Rotor)",
    category: "Rotating Machine",
    archetypeId: PowerFactoryArchetypeId.EQUIP_SYNC_MACHINE,
    description: "Round-rotor synchronous turbogenerator type per IEEE Std 1110.",
    provenance: "IEEE Std 1110-2019 / IEC 60034-4 Round-Rotor Synchronous Machine",
    params: SYNC_THERMAL_PARAMS,
  },
  {
    modelType: "TypSym_Hydro",
    aliases: ["Sym_Hydro", "TypSym.SalientPole"],
    label: "Hydro Synchronous Generator (Salient Pole)",
    category: "Rotating Machine",
    archetypeId: PowerFactoryArchetypeId.EQUIP_SYNC_MACHINE,
    description: "Salient-pole hydro synchronous generator type per IEEE Std 1110.",
    provenance: "IEEE Std 1110-2019 / IEC 60034-4 Salient-Pole Synchronous Machine",
    params: SYNC_HYDRO_PARAMS,
  },
  {
    modelType: "TypAsmo_IndMotor",
    aliases: ["Asmo_IndMotor", "TypAsmo.Cage"],
    label: "Squirrel-Cage Induction Motor",
    category: "Rotating Machine",
    archetypeId: PowerFactoryArchetypeId.EQUIP_ASYNC_MOTOR,
    description: "Three-phase squirrel-cage asynchronous motor with slip dynamics.",
    provenance: "IEC 60034-1 / IEEE Std 112 Induction Machine Equivalent Circuit",
    params: [
      ["pmech", 1.0, "MW", "Rated mechanical shaft power"],
      ["unom", 6.6, "kV", "Rated terminal voltage"],
      ["h", 0.8, "s", "Motor inertia constant H"],
      ["rs", 0.015, "pu", "Stator resistance"],
      ["xs", 0.12, "pu", "Stator leakage reactance"],
      ["xm", 3.2, "pu", "Magnetizing reactance"],
      ["rr", 0.018, "pu", "Rotor resistance"],
      ["xr", 0.14, "pu", "Rotor leakage reactance"],
    ],
  },
  {
    modelType: "TypLod_ZIP",
    aliases: ["Lod_ZIP", "TypLod.Composite"],
    label: "Static ZIP Voltage/Frequency Load",
    category: "Static Load / IBR",
    archetypeId: PowerFactoryArchetypeId.EQUIP_STATIC_LOAD,
    description: "Polynomial constant-impedance (Z), constant-current (I), constant-power (P) load type.",
    provenance: "IEEE Task Force on Load Representation (1993) / CIGRE TB 566",
    params: [
      ["aP", 0.3, "pu", "Constant-impedance active power share"],
      ["bP", 0.3, "pu", "Constant-current active power share"],
      ["cP", 0.4, "pu", "Constant-power active power share"],
      ["aQ", 0.4, "pu", "Constant-impedance reactive power share"],
      ["bQ", 0.3, "pu", "Constant-current reactive power share"],
      ["cQ", 0.3, "pu", "Constant-power reactive power share"],
      ["kpf", 1.0, "pu", "Active power frequency sensitivity"],
      ["kqf", -1.0, "pu", "Reactive power frequency sensitivity"],
    ],
  },
  {
    modelType: "TypGenstat_PV",
    aliases: ["Genstat_PV", "PV_Inverter"],
    label: "Static Generator — Utility-Scale Solar PV",
    category: "Static Load / IBR",
    archetypeId: PowerFactoryArchetypeId.EQUIP_STATIC_GEN,
    description: "Grid-following solar PV inverter static generator with LVRT reactive current support.",
    provenance: "IEEE Std 2800-2022 / WECC Generic PV Plant Model",
    params: IBR_REGC_PARAMS,
  },
  {
    modelType: "TypGenstat_BESS",
    aliases: ["Genstat_BESS", "BESS_Inverter"],
    label: "Static Generator — Battery Energy Storage (BESS)",
    category: "Static Load / IBR",
    archetypeId: PowerFactoryArchetypeId.EQUIP_STATIC_GEN,
    description: "Bidirectional battery energy storage inverter with fast frequency/voltage support.",
    provenance: "IEEE Std 2800-2022 / WECC REEC_C Energy Storage Specification",
    params: [
      ["tg", 0.015, "s", "Inverter current loop time constant"],
      ["rrpwr", 20.0, "pu/s", "Active power ramp rate limit"],
      ["brkpt", 0.9, "pu", "LVPL breakpoint voltage"],
      ["zerox", 0.3, "pu", "LVPL zero-crossing voltage"],
      ["lvpl1", 1.25, "pu", "LVPL gain breakpoint"],
      ["kqv", 2.5, "pu", "Reactive current support gain"],
      ["soc0", 0.5, "pu", "Initial state of charge"],
      ["pmax", 1.0, "pu", "Max discharge active power"],
      ["pmin", -1.0, "pu", "Max charge active power"],
    ],
  },
  {
    modelType: "TypGenstat_Wind",
    aliases: ["Genstat_Wind", "Type4_Wind"],
    label: "Static Generator — Type-4 Full-Converter Wind",
    category: "Static Load / IBR",
    archetypeId: PowerFactoryArchetypeId.EQUIP_STATIC_GEN,
    description: "Full-converter (Type-4) wind turbine generator per IEC 61400-27-1.",
    provenance: "IEC 61400-27-1:2020 Type 4A/4B Wind Turbine Generic Model",
    params: IBR_REGC_PARAMS,
  },

  // =========================================================================
  // 2. IEEE/IEC DSL Dynamic Frames & Controllers
  // =========================================================================
  {
    modelType: "vco_IEEET1",
    aliases: ["IEEET1", "avr_IEEET1"],
    label: "IEEE Type 1 DC Commutator Exciter",
    category: "Exciter (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_EXCITER_DC,
    description: "1968 IEEE Type 1 continuously acting DC commutator excitation system.",
    provenance: "IEEE Std 421.5-2016 Type DC1A / 1968 IEEE Type 1",
    params: EXCITER_ROTATING_PARAMS,
  },
  {
    modelType: "vco_ST1A",
    aliases: ["ST1A", "ESST1A", "avr_ST1A"],
    label: "IEEE ST1A Potential-Source Static Exciter",
    category: "Exciter (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_EXCITER_STATIC,
    description: "IEEE Std 421.5 Type ST1A potential-source controlled-rectifier static excitation system.",
    provenance: "IEEE Std 421.5-2016 Type ST1A",
    params: EXCITER_STATIC_PARAMS,
  },
  {
    modelType: "vco_ST4B",
    aliases: ["ST4B", "ESST4B", "avr_ST4B"],
    label: "IEEE ST4B Dual-PI Static Exciter",
    category: "Exciter (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_EXCITER_STATIC,
    description: "IEEE Std 421.5 Type ST4B potential/compound-source static exciter with PI inner/outer loops.",
    provenance: "IEEE Std 421.5-2016 Type ST4B",
    params: EXCITER_STATIC_PARAMS,
  },
  {
    modelType: "vco_EXAC1",
    aliases: ["EXAC1", "AC1A", "avr_EXAC1"],
    label: "IEEE AC1A Brushless Alternator Exciter",
    category: "Exciter (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_EXCITER_AC,
    description: "IEEE Std 421.5 Type AC1A alternator-rectifier excitation system with non-controlled rectifiers.",
    provenance: "IEEE Std 421.5-2016 Type AC1A",
    params: EXCITER_ROTATING_PARAMS,
  },
  {
    modelType: "vco_EXDC1",
    aliases: ["EXDC1", "DC1A", "avr_EXDC1"],
    label: "IEEE DC1A DC Commutator Exciter",
    category: "Exciter (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_EXCITER_DC,
    description: "IEEE Std 421.5 Type DC1A DC commutator exciter with field-controlled voltage regulator.",
    provenance: "IEEE Std 421.5-2016 Type DC1A",
    params: EXCITER_ROTATING_PARAMS,
  },
  {
    modelType: "vco_SEXS",
    aliases: ["SEXS", "avr_SEXS"],
    label: "Simplified Excitation System (SEXS)",
    category: "Exciter (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_EXCITER_STATIC,
    description: "Simplified generic excitation system with transient gain reduction and first-order lag.",
    provenance: "IEEE / WECC Simplified Excitation System (SEXS)",
    params: EXCITER_STATIC_PARAMS,
  },
  {
    modelType: "gov_TGOV1",
    aliases: ["TGOV1", "pcu_TGOV1"],
    label: "Steam Turbine-Governor (TGOV1)",
    category: "Governor (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_GOVERNOR_STEAM,
    description: "Simplified steam turbine-governor with droop, valve lag, and reheater lead-lag.",
    provenance: "IEEE PES / WECC TGOV1 Steam Turbine-Governor Model",
    params: GOVERNOR_STEAM_PARAMS,
  },
  {
    modelType: "gov_HYGOV",
    aliases: ["HYGOV", "pcu_HYGOV"],
    label: "Hydro Turbine-Governor (HYGOV)",
    category: "Governor (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_GOVERNOR_HYDRO,
    description: "Nonlinear hydro turbine and governor with penstock water starting time and temporary droop.",
    provenance: "IEEE Working Group on Prime Mover & Energy Supply (1992) HYGOV",
    params: GOVERNOR_HYDRO_PARAMS,
  },
  {
    modelType: "gov_GGOV1",
    aliases: ["GGOV1", "pcu_GGOV1"],
    label: "General-Purpose Gas/Thermal Governor (GGOV1)",
    category: "Governor (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_GOVERNOR_GAS,
    description: "WECC/IEEE general-purpose turbine-governor for combustion turbines and combined-cycle units.",
    provenance: "IEEE PES-TR1 / WECC GGOV1 Turbine-Governor Model",
    params: GOVERNOR_STEAM_PARAMS,
  },
  {
    modelType: "gov_IEESGO",
    aliases: ["IEESGO", "pcu_IEESGO"],
    label: "IEEE Standard Steam Governor (IEESGO)",
    category: "Governor (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_GOVERNOR_STEAM,
    description: "IEEE 1973 standard speed-governing and steam turbine reheat model.",
    provenance: "IEEE Committee Report (1973) Dynamic Models for Steam & Hydro Turbines",
    params: GOVERNOR_STEAM_PARAMS,
  },
  {
    modelType: "pss_PSS2A",
    aliases: ["PSS2A", "IEEE_PSS2A"],
    label: "IEEE PSS2A Dual-Input Power System Stabilizer",
    category: "Stabilizer (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_STABILIZER,
    description: "Dual-input (rotor speed & electrical power) ramp-tracking power system stabilizer.",
    provenance: "IEEE Std 421.5-2016 Type PSS2A",
    params: PSS_PARAMS,
  },
  {
    modelType: "pss_PSS2B",
    aliases: ["PSS2B", "IEEE_PSS2B"],
    label: "IEEE PSS2B Dual-Input Power System Stabilizer",
    category: "Stabilizer (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_STABILIZER,
    description: "Enhanced dual-input power system stabilizer with third lead-lag compensation stage.",
    provenance: "IEEE Std 421.5-2016 Type PSS2B",
    params: PSS_PARAMS,
  },
  {
    modelType: "pss_IEEEST",
    aliases: ["IEEEST", "PSS1A", "IEEE_ST"],
    label: "IEEE Type PSS1A / IEEEST Stabilizer",
    category: "Stabilizer (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_STABILIZER,
    description: "Single-input power system stabilizer with washout filter and two lead-lag blocks.",
    provenance: "IEEE Std 421.5-2016 Type PSS1A / IEEEST",
    params: PSS_PARAMS,
  },
  {
    modelType: "wecc_REGC_A",
    aliases: ["REGC_A", "regc_a"],
    label: "WECC REGC_A Renewable Energy Generator/Converter",
    category: "Renewable / FACTS (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_IBR_CONVERTER,
    description:
      "WECC generic renewable generator/converter interface with LVPL and high-voltage reactive current limit.",
    provenance: "WECC Second-Generation Generic Renewable Energy Model REGC_A",
    params: IBR_REGC_PARAMS,
  },
  {
    modelType: "wecc_REEC_A",
    aliases: ["REEC_A", "reec_a"],
    label: "WECC REEC_A Renewable Electrical Control",
    category: "Renewable / FACTS (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_IBR_ELECTRICAL,
    description: "WECC generic renewable electrical control for local P/Q and dynamic voltage support.",
    provenance: "WECC Second-Generation Generic Renewable Energy Model REEC_A",
    params: IBR_REGC_PARAMS,
  },
  {
    modelType: "wecc_REPC_A",
    aliases: ["REPC_A", "repc_a"],
    label: "WECC REPC_A Renewable Plant Controller",
    category: "Renewable / FACTS (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_IBR_PLANT_CTRL,
    description: "WECC generic plant-level volt/var and primary frequency droop controller.",
    provenance: "WECC Second-Generation Generic Renewable Energy Model REPC_A",
    params: IBR_REGC_PARAMS,
  },
  {
    modelType: "wecc_DER_A",
    aliases: ["DER_A", "der_a"],
    label: "WECC DER_A Distributed Energy Resource Aggregate",
    category: "Renewable / FACTS (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_IBR_CONVERTER,
    description: "Aggregate distributed energy resource model with IEEE 1547-2018 ride-through and droop.",
    provenance: "WECC / NERC DER_A Aggregate Model & IEEE Std 1547-2018",
    params: IBR_REGC_PARAMS,
  },
  {
    modelType: "svc_IEEE",
    aliases: ["SVC_IEEE", "SVSMO1"],
    label: "IEEE Static Var Compensator (SVC)",
    category: "Renewable / FACTS (DSL)",
    archetypeId: PowerFactoryArchetypeId.DSL_FACTS_SVC,
    description: "Shunt thyristor-controlled reactor / switched capacitor voltage regulator.",
    provenance: "IEEE Special Stability Controls Working Group (1994) / CIGRE TB 144",
    params: [
      ["ksvc", 100.0, "pu", "SVC voltage regulator gain"],
      ["tsvc", 0.05, "s", "SVC regulator lag time constant"],
      ["bmax", 1.0, "pu", "Maximum capacitive susceptance"],
      ["bmin", -1.0, "pu", "Minimum inductive susceptance"],
      ["xslope", 0.03, "pu", "Voltage droop slope"],
    ],
  },

  // =========================================================================
  // 3. Protection Relays (TOC IEC/IEEE, Distance 21, Differential 87, UFLS 81)
  // =========================================================================
  {
    modelType: "rel_TOC_IEC",
    aliases: ["TOC_IEC", "RelToc_IEC", "ANSI_51_IEC"],
    label: "IEC 60255 Inverse-Time Overcurrent Relay (51)",
    category: "Protection Relay",
    archetypeId: PowerFactoryArchetypeId.RELAY_TOC_IEC,
    description: "IEC 60255-151 inverse-time overcurrent relay supporting SI, VI, EI, and LTI curves.",
    provenance: "IEC 60255-151:2009 Functional Requirements for Over/Under Current Protection",
    params: [
      ["ipickup", 1.2, "pu", "Pickup current threshold"],
      ["tms", 0.2, "s", "Time Multiplier Setting (TMS)"],
      ["curveType", 0.0, "", "IEC curve selector (0=SI, 1=VI, 2=EI, 3=LTI)"],
      ["tbreaker", 0.06, "s", "Circuit breaker clearing time"],
    ],
  },
  {
    modelType: "rel_TOC_IEEE",
    aliases: ["TOC_IEEE", "RelToc_IEEE", "ANSI_51_IEEE"],
    label: "IEEE C37.112 Inverse-Time Overcurrent Relay (51)",
    category: "Protection Relay",
    archetypeId: PowerFactoryArchetypeId.RELAY_TOC_IEEE,
    description: "IEEE Std C37.112 inverse-time overcurrent relay supporting MI, VI, and EI curves.",
    provenance: "IEEE Std C37.112-2018 Inverse-Time Characteristic Equations for Overcurrent Relays",
    params: [
      ["ipickup", 1.2, "pu", "Pickup current threshold"],
      ["td", 1.0, "", "Time Dial (TD)"],
      ["curveType", 10.0, "", "IEEE curve selector (10=MI, 11=VI, 12=EI)"],
      ["tbreaker", 0.06, "s", "Circuit breaker clearing time"],
    ],
  },
  {
    modelType: "rel_DIST_21",
    aliases: ["DIST_21", "RelDis_21", "ANSI_21"],
    label: "Mho / Quadrilateral Distance Relay (ANSI 21)",
    category: "Protection Relay",
    archetypeId: PowerFactoryArchetypeId.RELAY_DISTANCE_21,
    description: "Multi-zone transmission line distance protection relay (Zone 1/2/3 impedance reach).",
    provenance: "IEEE Std C37.113-2015 Guide for Protective Relay Applications to Transmission Lines",
    params: [
      ["z1", 0.8, "pu", "Zone 1 impedance reach"],
      ["t1", 0.02, "s", "Zone 1 trip delay"],
      ["z2", 1.2, "pu", "Zone 2 impedance reach"],
      ["t2", 0.35, "s", "Zone 2 trip delay"],
      ["z3", 1.5, "pu", "Zone 3 impedance reach"],
      ["t3", 0.8, "s", "Zone 3 trip delay"],
    ],
  },
  {
    modelType: "rel_DIFF_87",
    aliases: ["DIFF_87", "RelDiff_87", "ANSI_87"],
    label: "Percentage-Restrained Differential Relay (ANSI 87)",
    category: "Protection Relay",
    archetypeId: PowerFactoryArchetypeId.RELAY_DIFF_87,
    description: "Dual-slope percentage-restrained differential protection for transformers and generators.",
    provenance: "IEEE Std C37.91-2021 Guide for Protecting Power Transformers",
    params: [
      ["idiffMin", 0.25, "pu", "Minimum differential pickup current"],
      ["slope1", 0.25, "pu", "First restraint slope"],
      ["slope2", 0.6, "pu", "Second restraint slope"],
      ["tTrip", 0.025, "s", "Differential operating time"],
    ],
  },
  {
    modelType: "rel_UFLS_81",
    aliases: ["UFLS_81", "RelFmeas_81", "ANSI_81"],
    label: "Under-Frequency Load Shedding Relay (ANSI 81U)",
    category: "Protection Relay",
    archetypeId: PowerFactoryArchetypeId.RELAY_UFLS_81,
    description: "Multi-stage under-frequency load shedding relay per NERC PRC-006 / ENTSO-E LFDD.",
    provenance: "NERC PRC-006-5 / ENTSO-E System Defence Plan (LFDD)",
    params: [
      ["f1", 49.0, "Hz", "Stage 1 under-frequency threshold (50 Hz base)"],
      ["t1", 0.2, "s", "Stage 1 intentional time delay"],
      ["frac1", 0.15, "pu", "Stage 1 load shed fraction"],
      ["tbreaker", 0.08, "s", "Breaker opening time"],
    ],
  },
];

/**
 * Converts `POWERFACTORY_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildPowerFactoryCleanroomSchemas(): CleanroomModelSchema[] {
  return POWERFACTORY_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `powerfactory:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "electrical",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "powerfactory_library_model",
      width: 88,
      height: 48,
      svg: generatePowerFactoryBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
