// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * PSLF cleanroom dynamic model archetype IDs matching `assets/pslf-std-lib/src/models.ts`.
 */
export const PslfArchetypeId = {
  SYNC_GEN_ROUND: 1, // genrou, gentpf, gentpj
  SYNC_GEN_SALIENT: 2, // gensal
  SYNC_GEN_CLASSICAL: 3, // gencls, gencce
  EXCITER_STATIC: 10, // exst1, exst2, exst4b, esst1a, esst4b, sexs
  EXCITER_AC: 11, // exac1, exac2, exac8b, esac1a, exbas
  EXCITER_DC: 12, // exdc1, exdc2, esdc1a
  GOVERNOR_STEAM: 20, // tgov1, ieesgo, wsieg1, ccbt1
  GOVERNOR_HYDRO: 21, // hygov, pidgov
  GOVERNOR_GAS: 22, // gast, gast2a, ggov1, degov1
  STABILIZER: 30, // pss2a, pss2b, pss3b, ieeest, stab1, pss1a
  IBR_CONVERTER: 40, // regc_a, regc_b, wt1g, wt2g, wt3g, wt4g, gewtg, pvd1, der_a
  IBR_ELECTRICAL: 41, // reec_a, reec_b, reec_c, reec_d, wt3e, wt4e, geex
  IBR_PLANT_CTRL: 42, // repc_a, repc_b, wt3p, wt3t, gegt
  LOAD_COMPOSITE: 50, // cmpldw, cmpld, clod, ieeel, lmod
  LOAD_MOTOR: 51, // motorw, motor1
  FACTS_SVC: 60, // svsmo1, svsmo2, svsmo3, epcmod
  HVDC: 61, // cdc4t, cdc6t, hvdc1, vscdc
  RELAY_LIMITER: 70, // lshd1, ufreq, vtrp, zlin1, oel1, uel1
} as const;

export type PslfArchetypeId = (typeof PslfArchetypeId)[keyof typeof PslfArchetypeId];

export interface PslfModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category:
    | "Generator"
    | "Exciter"
    | "Governor"
    | "Stabilizer"
    | "Renewable / IBR"
    | "Load / Motor"
    | "FACTS / HVDC"
    | "Protection / Limiter";
  archetypeId: PslfArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<PslfModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
  Generator: { fill: "#1e3a5f", stroke: "#60a5fa", badge: "GEN" },
  Exciter: { fill: "#3b1f47", stroke: "#c084fc", badge: "EXC" },
  Governor: { fill: "#1e3f2f", stroke: "#34d399", badge: "GOV" },
  Stabilizer: { fill: "#3f2e18", stroke: "#fbbf24", badge: "PSS" },
  "Renewable / IBR": { fill: "#163b3b", stroke: "#2dd4bf", badge: "IBR" },
  "Load / Motor": { fill: "#3b2323", stroke: "#f87171", badge: "LOD" },
  "FACTS / HVDC": { fill: "#2a2b4a", stroke: "#818cf8", badge: "FAC" },
  "Protection / Limiter": { fill: "#422006", stroke: "#fb923c", badge: "PRO" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for a PSLF dynamic model.
 */
export function generatePslfBlockSvg(modelType: string, category: PslfModelSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 8);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 48" width="80" height="48">` +
    `<rect x="2" y="2" width="76" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="40" y="34" text-anchor="middle" font-family="monospace" font-size="10" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: PslfModelSpec["category"]): DiagramPortSpec[] {
  switch (category) {
    case "Generator":
      return [
        { name: "efd", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "pmech", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "bus", kind: "electrical", side: "right", dx: 80, dy: 24 },
      ];
    case "Exciter":
      return [
        { name: "eterm", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "vs", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "efd", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "Governor":
      return [
        { name: "dw", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "pmech", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "Stabilizer":
      return [
        { name: "dw", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "vs", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
    case "Renewable / IBR":
      return [
        { name: "pref", kind: "signal", side: "left", dx: 0, dy: 14 },
        { name: "qref", kind: "signal", side: "left", dx: 0, dy: 34 },
        { name: "bus", kind: "electrical", side: "right", dx: 80, dy: 24 },
      ];
    case "Load / Motor":
    case "FACTS / HVDC":
      return [
        { name: "bus", kind: "electrical", side: "left", dx: 0, dy: 24 },
        { name: "ctrl", kind: "signal", side: "top", dx: 40, dy: 0 },
      ];
    case "Protection / Limiter":
      return [
        { name: "meas", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "trip", kind: "signal", side: "right", dx: 80, dy: 24 },
      ];
  }
}

const GEN_ROUND_PARAMS: PslfModelSpec["params"] = [
  ["tpdo", 6.5, "s", "d-axis transient open-circuit time constant"],
  ["tppdo", 0.05, "s", "d-axis subtransient open-circuit time constant"],
  ["tpqo", 0.5, "s", "q-axis transient open-circuit time constant"],
  ["tppqo", 0.08, "s", "q-axis subtransient open-circuit time constant"],
  ["h", 4.0, "s", "Inertia constant H"],
  ["d", 1.5, "pu", "Speed damping factor D"],
  ["ld", 1.85, "pu", "d-axis synchronous reactance"],
  ["lq", 1.75, "pu", "q-axis synchronous reactance"],
  ["lpd", 0.3, "pu", "d-axis transient reactance"],
  ["lpq", 0.45, "pu", "q-axis transient reactance"],
  ["lppd", 0.2, "pu", "d-axis subtransient reactance"],
  ["ll", 0.14, "pu", "Stator leakage reactance"],
  ["s1", 0.09, "pu", "Saturation factor at 1.0 pu"],
  ["s12", 0.35, "pu", "Saturation factor at 1.2 pu"],
];

const GEN_SALIENT_PARAMS: PslfModelSpec["params"] = [
  ["tpdo", 5.5, "s", "d-axis transient open-circuit time constant"],
  ["tppdo", 0.05, "s", "d-axis subtransient open-circuit time constant"],
  ["tppqo", 0.08, "s", "q-axis subtransient open-circuit time constant"],
  ["h", 3.5, "s", "Inertia constant H"],
  ["d", 1.0, "pu", "Damping factor D"],
  ["ld", 1.2, "pu", "d-axis synchronous reactance"],
  ["lq", 0.75, "pu", "q-axis synchronous reactance"],
  ["lpd", 0.32, "pu", "d-axis transient reactance"],
  ["lppd", 0.22, "pu", "d-axis subtransient reactance"],
  ["ll", 0.14, "pu", "Leakage reactance"],
  ["s1", 0.1, "pu", "Saturation factor at 1.0 pu"],
  ["s12", 0.4, "pu", "Saturation factor at 1.2 pu"],
];

const EXCITER_STATIC_PARAMS: PslfModelSpec["params"] = [
  ["tr", 0.02, "s", "Voltage transducer time constant"],
  ["vimax", 0.5, "pu", "Voltage error upper limit"],
  ["vimin", -0.5, "pu", "Voltage error lower limit"],
  ["tc", 1.0, "s", "Lead time constant"],
  ["tb", 10.0, "s", "Lag time constant"],
  ["ka", 200.0, "pu", "Voltage regulator gain"],
  ["ta", 0.05, "s", "Voltage regulator time constant"],
  ["vrmax", 5.0, "pu", "Maximum regulator output"],
  ["vrmin", -4.5, "pu", "Minimum regulator output"],
  ["kc", 0.05, "pu", "Commutation factor"],
  ["kf", 0.0, "pu", "Stabilizing feedback gain"],
  ["tf", 1.0, "s", "Stabilizing feedback time constant"],
];

const GOVERNOR_STEAM_PARAMS: PslfModelSpec["params"] = [
  ["r", 0.05, "pu", "Permanent droop"],
  ["t1", 0.5, "s", "Governor lag time constant"],
  ["vmax", 1.0, "pu", "Maximum valve position"],
  ["vmin", 0.0, "pu", "Minimum valve position"],
  ["t2", 1.0, "s", "Turbine lead time constant"],
  ["t3", 5.0, "s", "Turbine reheater lag time constant"],
  ["dt", 0.0, "pu", "Turbine damping factor"],
];

const GOVERNOR_HYDRO_PARAMS: PslfModelSpec["params"] = [
  ["r", 0.05, "pu", "Permanent droop"],
  ["rt", 0.4, "pu", "Temporary droop"],
  ["tr", 5.0, "s", "Governor time constant"],
  ["tf", 0.05, "s", "Filter time constant"],
  ["tg", 0.5, "s", "Servo time constant"],
  ["velm", 0.2, "pu/s", "Gate velocity limit"],
  ["gmax", 1.0, "pu", "Maximum gate limit"],
  ["gmin", 0.0, "pu", "Minimum gate limit"],
  ["tw", 1.5, "s", "Water starting time"],
  ["at", 1.2, "pu", "Turbine gain"],
  ["dturb", 0.2, "pu", "Turbine damping"],
  ["qnl", 0.08, "pu", "No-load flow"],
];

const PSS_PARAMS: PslfModelSpec["params"] = [
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

const IBR_REGC_PARAMS: PslfModelSpec["params"] = [
  ["tg", 0.02, "s", "Converter current control time constant"],
  ["rrpwr", 10.0, "pu/s", "Active current ramp rate limit"],
  ["brkpt", 0.9, "pu", "Low-voltage active current management breakpoint"],
  ["zerox", 0.4, "pu", "Low-voltage active current zero crossing"],
  ["lvpl1", 1.22, "pu", "LVPL gain breakpoint"],
  ["vtmax", 1.2, "pu", "High-voltage reactive current limit threshold"],
  ["lvpnt1", 0.8, "pu", "High point of low-voltage active current management"],
  ["lvpnt0", 0.4, "pu", "Low point of low-voltage active current management"],
  ["qmin", -1.3, "pu", "Minimum reactive current limit"],
  ["accel", 0.7, "pu", "Acceleration factor"],
  ["khv", 0.7, "pu", "Overvoltage compensation gain"],
  ["iqrmax", 999.0, "pu/s", "Max reactive current ramp rate"],
  ["iqrmin", -999.0, "pu/s", "Min reactive current ramp rate"],
];

const IBR_REEC_PARAMS: PslfModelSpec["params"] = [
  ["vdip", 0.9, "pu", "Low-voltage threshold for reactive current injection"],
  ["vup", 1.1, "pu", "High-voltage threshold for reactive current injection"],
  ["trv", 0.02, "s", "Voltage filter time constant"],
  ["dbd1", -0.05, "pu", "Voltage error lower deadband"],
  ["dbd2", 0.05, "pu", "Voltage error upper deadband"],
  ["kqv", 2.0, "pu", "Reactive current injection gain"],
  ["iqh1", 1.0, "pu", "Max reactive current injection"],
  ["iql1", -1.0, "pu", "Min reactive current injection"],
  ["vref0", 1.0, "pu", "Reference voltage"],
  ["tp", 0.05, "s", "Active power filter time constant"],
  ["qmax", 0.44, "pu", "Max reactive power limit"],
  ["qmin", -0.44, "pu", "Min reactive power limit"],
  ["pmax", 1.0, "pu", "Max active power limit"],
  ["pmin", 0.0, "pu", "Min active power limit"],
  ["imax", 1.1, "pu", "Total converter current limit"],
];

const IBR_REPC_PARAMS: PslfModelSpec["params"] = [
  ["tfltr", 0.02, "s", "Voltage/Q measurement filter time constant"],
  ["kp", 18.0, "pu", "Reactive power PI proportional gain"],
  ["ki", 5.0, "pu/s", "Reactive power PI integral gain"],
  ["tft", 0.0, "s", "Lead time constant"],
  ["tfv", 0.05, "s", "Lag time constant"],
  ["emax", 0.5, "pu", "Upper error limit"],
  ["emin", -0.5, "pu", "Lower error limit"],
  ["dbd", 0.002, "pu", "Deadband"],
  ["qmax", 0.44, "pu", "Max Q command"],
  ["qmin", -0.44, "pu", "Min Q command"],
  ["kpg", 0.1, "pu", "Active power PI proportional gain"],
  ["kig", 0.05, "pu/s", "Active power PI integral gain"],
  ["tp", 0.25, "s", "Active power filter time constant"],
  ["fdbd1", -0.0006, "pu", "Lower frequency deadband"],
  ["fdbd2", 0.0006, "pu", "Upper frequency deadband"],
  ["ddn", 20.0, "pu", "Down-regulation droop gain"],
  ["dup", 0.0, "pu", "Up-regulation droop gain"],
];

const LOAD_COMP_PARAMS: PslfModelSpec["params"] = [
  ["fmA", 0.15, "pu", "Motor A (3-phase compressor) fraction"],
  ["fmB", 0.15, "pu", "Motor B (high-inertia fan) fraction"],
  ["fmC", 0.1, "pu", "Motor C (low-inertia pump) fraction"],
  ["fmD", 0.2, "pu", "Motor D (1-phase A/C) fraction"],
  ["fel", 0.15, "pu", "Power electronic load fraction"],
  ["pfel", 0.98, "pu", "Electronic load power factor"],
  ["vd1", 0.7, "pu", "Electronic load linear drop start voltage"],
  ["vd2", 0.5, "pu", "Electronic load zero-power voltage"],
  ["p1e", 2.0, "", "Static active load exponent 1"],
  ["q1e", 2.0, "", "Static reactive load exponent 1"],
];

const SVC_PARAMS: PslfModelSpec["params"] = [
  ["ksvc", 100.0, "pu", "SVC voltage regulator gain"],
  ["tsvc", 0.05, "s", "SVC regulator time constant"],
  ["bmax", 1.0, "pu", "Maximum capacitive susceptance"],
  ["bmin", -1.0, "pu", "Maximum inductive susceptance"],
  ["xs", 0.03, "pu", "Slope reactance"],
];

const RELAY_PARAMS: PslfModelSpec["params"] = [
  ["f1", 59.3, "Hz", "Stage 1 under-frequency pickup"],
  ["t1", 0.2, "s", "Stage 1 time delay"],
  ["frac1", 0.1, "pu", "Stage 1 load shed fraction"],
  ["f2", 58.9, "Hz", "Stage 2 under-frequency pickup"],
  ["t2", 0.2, "s", "Stage 2 time delay"],
  ["frac2", 0.15, "pu", "Stage 2 load shed fraction"],
  ["tb", 0.08, "s", "Breaker opening time"],
];

/**
 * Cleanroom catalog of GE PSLF / WECC standard dynamic models derived from published
 * IEEE, WECC, and NERC standard specifications.
 */
export const PSLF_MODEL_SPECS: readonly PslfModelSpec[] = [
  // === Synchronous Generators ===
  {
    modelType: "genrou",
    aliases: ["GENROU"],
    label: "Round-Rotor Synchronous Generator (Quadratic Sat.)",
    category: "Generator",
    archetypeId: PslfArchetypeId.SYNC_GEN_ROUND,
    description: "6th-order round-rotor synchronous machine with d/q subtransient dynamics and quadratic saturation.",
    provenance: "IEEE Std 1110 / WECC Dynamic Modeling Specifications (GENROU)",
    params: GEN_ROUND_PARAMS,
  },
  {
    modelType: "gentpf",
    aliases: ["GENTPF"],
    label: "Synchronous Generator (Scaled Saturation / Field Flux)",
    category: "Generator",
    archetypeId: PslfArchetypeId.SYNC_GEN_ROUND,
    description: "Round-rotor or salient-pole synchronous machine with saturation applied to reactances (WECC GENTPF).",
    provenance: "WECC Modeling and Validation Work Group (GENTPF/GENTPJ)",
    params: GEN_ROUND_PARAMS,
  },
  {
    modelType: "gentpj",
    aliases: ["GENTPJ"],
    label: "Synchronous Generator (Current-Compensated Saturation)",
    category: "Generator",
    archetypeId: PslfArchetypeId.SYNC_GEN_ROUND,
    description: "WECC standard synchronous machine with stator-current-compensated saturation (GENTPJ).",
    provenance: "WECC Modeling and Validation Work Group (GENTPJ Specification)",
    params: GEN_ROUND_PARAMS,
  },
  {
    modelType: "gensal",
    aliases: ["GENSAL"],
    label: "Salient-Pole Synchronous Generator",
    category: "Generator",
    archetypeId: PslfArchetypeId.SYNC_GEN_SALIENT,
    description: "5th-order salient-pole hydro synchronous generator model.",
    provenance: "IEEE Std 1110 / WECC Dynamic Modeling Specifications (GENSAL)",
    params: GEN_SALIENT_PARAMS,
  },
  {
    modelType: "gencls",
    aliases: ["GENCLS"],
    label: "Classical Constant-Voltage-Behind-Xd' Generator",
    category: "Generator",
    archetypeId: PslfArchetypeId.SYNC_GEN_CLASSICAL,
    description: "2nd-order swing-equation classical generator model.",
    provenance: "IEEE Std 1110 / Kundur Power System Stability (Classical Model)",
    params: [
      ["h", 3.5, "s", "Inertia constant H"],
      ["d", 1.0, "pu", "Damping factor D"],
    ],
  },
  {
    modelType: "gencce",
    aliases: ["GENCCE"],
    label: "Classical Generator with Constant EMF",
    category: "Generator",
    archetypeId: PslfArchetypeId.SYNC_GEN_CLASSICAL,
    description: "Classical generator swing-equation model with constant internal EMF.",
    provenance: "WECC Dynamic Modeling Specifications",
    params: [
      ["h", 3.5, "s", "Inertia constant H"],
      ["d", 1.0, "pu", "Damping factor D"],
    ],
  },

  // === Exciters (IEEE 421.5) ===
  {
    modelType: "exst1",
    aliases: ["EXST1", "esst1a", "ESST1A"],
    label: "IEEE Type ST1A Potential-Source Static Exciter",
    category: "Exciter",
    archetypeId: PslfArchetypeId.EXCITER_STATIC,
    description: "Potential-source controlled-rectifier static excitation system with lead-lag compensation.",
    provenance: "IEEE Std 421.5-2016 Type ST1A",
    params: EXCITER_STATIC_PARAMS,
  },
  {
    modelType: "exst2",
    aliases: ["EXST2", "esst2a"],
    label: "IEEE Type ST2A Compound-Source Static Exciter",
    category: "Exciter",
    archetypeId: PslfArchetypeId.EXCITER_STATIC,
    description: "Compound-source static excitation system with voltage and current compounding.",
    provenance: "IEEE Std 421.5-2016 Type ST2A",
    params: EXCITER_STATIC_PARAMS,
  },
  {
    modelType: "exst4b",
    aliases: ["EXST4B", "esst4b", "ESST4B"],
    label: "IEEE Type ST4B Potential/Compound-Source Static Exciter",
    category: "Exciter",
    archetypeId: PslfArchetypeId.EXCITER_STATIC,
    description: "Dual-PI static excitation system with inner current/voltage regulation loop.",
    provenance: "IEEE Std 421.5-2016 Type ST4B",
    params: EXCITER_STATIC_PARAMS,
  },
  {
    modelType: "sexs",
    aliases: ["SEXS"],
    label: "Simplified Excitation System",
    category: "Exciter",
    archetypeId: PslfArchetypeId.EXCITER_STATIC,
    description: "Reduced-order lead-lag excitation system for screening studies.",
    provenance: "IEEE / WECC Simplified Exciter Specification (SEXS)",
    params: [
      ["ta_tb", 0.1, "pu", "Lead/lag ratio Ta/Tb"],
      ["tb", 10.0, "s", "Lag time constant"],
      ["k", 100.0, "pu", "Exciter gain"],
      ["te", 0.05, "s", "Exciter time constant"],
      ["emin", -5.0, "pu", "Minimum field voltage"],
      ["emax", 5.0, "pu", "Maximum field voltage"],
    ],
  },
  {
    modelType: "exac1",
    aliases: ["EXAC1", "esac1a", "ESAC1A"],
    label: "IEEE Type AC1A Alternator-Rectifier Exciter",
    category: "Exciter",
    archetypeId: PslfArchetypeId.EXCITER_AC,
    description: "Field-controlled alternator-rectifier excitation system with non-controlled rectifiers.",
    provenance: "IEEE Std 421.5-2016 Type AC1A",
    params: EXCITER_STATIC_PARAMS,
  },
  {
    modelType: "exac2",
    aliases: ["EXAC2", "esac2a"],
    label: "IEEE Type AC2A High-Initial-Response AC Exciter",
    category: "Exciter",
    archetypeId: PslfArchetypeId.EXCITER_AC,
    description: "High-initial-response field-controlled alternator-rectifier exciter.",
    provenance: "IEEE Std 421.5-2016 Type AC2A",
    params: EXCITER_STATIC_PARAMS,
  },
  {
    modelType: "exac8b",
    aliases: ["EXAC8B", "esac8b"],
    label: "IEEE Type AC8B PID Brushless Exciter",
    category: "Exciter",
    archetypeId: PslfArchetypeId.EXCITER_AC,
    description: "Digital PID voltage regulator driving a brushless alternator-rectifier exciter.",
    provenance: "IEEE Std 421.5-2016 Type AC8B",
    params: EXCITER_STATIC_PARAMS,
  },
  {
    modelType: "exbas",
    aliases: ["EXBAS"],
    label: "WECC Brushless/AC Exciter",
    category: "Exciter",
    archetypeId: PslfArchetypeId.EXCITER_AC,
    description: "WECC generalized brushless AC exciter model.",
    provenance: "WECC Dynamic Modeling Specifications (EXBAS)",
    params: EXCITER_STATIC_PARAMS,
  },
  {
    modelType: "exdc1",
    aliases: ["EXDC1", "esdc1a", "ESDC1A"],
    label: "IEEE Type DC1A Commutator Exciter",
    category: "Exciter",
    archetypeId: PslfArchetypeId.EXCITER_DC,
    description: "DC commutator exciter with continuously acting voltage regulator.",
    provenance: "IEEE Std 421.5-2016 Type DC1A",
    params: EXCITER_STATIC_PARAMS,
  },
  {
    modelType: "exdc2",
    aliases: ["EXDC2", "esdc2a"],
    label: "IEEE Type DC2A Bus-Fed DC Exciter",
    category: "Exciter",
    archetypeId: PslfArchetypeId.EXCITER_DC,
    description: "DC commutator exciter with terminal-voltage-scaled regulator limits.",
    provenance: "IEEE Std 421.5-2016 Type DC2A",
    params: EXCITER_STATIC_PARAMS,
  },

  // === Governors & Prime Movers ===
  {
    modelType: "tgov1",
    aliases: ["TGOV1"],
    label: "Steam Turbine-Governor (Simple Reheat)",
    category: "Governor",
    archetypeId: PslfArchetypeId.GOVERNOR_STEAM,
    description: "Simplified steam turbine-governor with droop, valve lag, and reheat lead-lag.",
    provenance: "IEEE PES Turbine-Governor Task Force (TGOV1)",
    params: GOVERNOR_STEAM_PARAMS,
  },
  {
    modelType: "ieesgo",
    aliases: ["IEESGO"],
    label: "IEEE Standard Steam Governor",
    category: "Governor",
    archetypeId: PslfArchetypeId.GOVERNOR_STEAM,
    description: "IEEE 1973 standard speed-governing and steam turbine model.",
    provenance: "IEEE Committee Report 1973 (IEESGO)",
    params: GOVERNOR_STEAM_PARAMS,
  },
  {
    modelType: "wsieg1",
    aliases: ["WSIEG1", "ieeeg1"],
    label: "WECC Steam Turbine-Governor (IEEEG1)",
    category: "Governor",
    archetypeId: PslfArchetypeId.GOVERNOR_STEAM,
    description: "Multi-stage steam turbine-governor with HP/IP/LP fractions and valve rate limits.",
    provenance: "IEEE PES Dynamic Models for Turbine-Governors (IEEEG1)",
    params: GOVERNOR_STEAM_PARAMS,
  },
  {
    modelType: "hygov",
    aliases: ["HYGOV"],
    label: "Hydro Turbine-Governor",
    category: "Governor",
    archetypeId: PslfArchetypeId.GOVERNOR_HYDRO,
    description: "Hydro turbine-governor with temporary droop, gate servo, and inelastic water column.",
    provenance: "IEEE Working Group 1992 Hydraulic Turbine Models (HYGOV)",
    params: GOVERNOR_HYDRO_PARAMS,
  },
  {
    modelType: "pidgov",
    aliases: ["PIDGOV"],
    label: "PID Hydro Turbine-Governor",
    category: "Governor",
    archetypeId: PslfArchetypeId.GOVERNOR_HYDRO,
    description: "PID-controlled hydraulic turbine-governor with water starting time Tw.",
    provenance: "IEEE Working Group 1992 Hydraulic Turbine Models (PIDGOV)",
    params: GOVERNOR_HYDRO_PARAMS,
  },
  {
    modelType: "gast",
    aliases: ["GAST"],
    label: "Gas Turbine-Governor",
    category: "Governor",
    archetypeId: PslfArchetypeId.GOVERNOR_GAS,
    description: "Single-shaft gas turbine-governor with exhaust temperature load limiter.",
    provenance: "IEEE PES Dynamic Models for Turbine-Governors (GAST)",
    params: GOVERNOR_STEAM_PARAMS,
  },
  {
    modelType: "ggov1",
    aliases: ["GGOV1"],
    label: "WECC General Purpose Turbine-Governor",
    category: "Governor",
    archetypeId: PslfArchetypeId.GOVERNOR_GAS,
    description:
      "General-purpose thermal/gas/combined-cycle governor with PID, load limiter, and acceleration control.",
    provenance: "WECC / IEEE PES PES-TR1 (GGOV1 Specification)",
    params: GOVERNOR_STEAM_PARAMS,
  },
  {
    modelType: "degov1",
    aliases: ["DEGOV1"],
    label: "Woodward Diesel Engine Governor",
    category: "Governor",
    archetypeId: PslfArchetypeId.GOVERNOR_GAS,
    description: "Diesel engine electric control box, actuator, and combustion delay model.",
    provenance: "IEEE PES Dynamic Models for Turbine-Governors (DEGOV1)",
    params: GOVERNOR_STEAM_PARAMS,
  },

  // === Power System Stabilizers (IEEE 421.5) ===
  {
    modelType: "pss2a",
    aliases: ["PSS2A"],
    label: "IEEE Type PSS2A Dual-Input Stabilizer",
    category: "Stabilizer",
    archetypeId: PslfArchetypeId.STABILIZER,
    description: "Dual-input (speed + accelerating power) IEEE PSS2A stabilizer with washout and lead-lag.",
    provenance: "IEEE Std 421.5-2016 Type PSS2A",
    params: PSS_PARAMS,
  },
  {
    modelType: "pss2b",
    aliases: ["PSS2B"],
    label: "IEEE Type PSS2B Dual-Input Stabilizer (3 Lead-Lag)",
    category: "Stabilizer",
    archetypeId: PslfArchetypeId.STABILIZER,
    description: "Enhanced dual-input IEEE PSS2B stabilizer with three lead-lag stages.",
    provenance: "IEEE Std 421.5-2016 Type PSS2B",
    params: PSS_PARAMS,
  },
  {
    modelType: "pss3b",
    aliases: ["PSS3B"],
    label: "IEEE Type PSS3B Dual-Input Stabilizer",
    category: "Stabilizer",
    archetypeId: PslfArchetypeId.STABILIZER,
    description: "Dual-input IEEE PSS3B stabilizer using electrical power and shaft speed.",
    provenance: "IEEE Std 421.5-2016 Type PSS3B",
    params: PSS_PARAMS,
  },
  {
    modelType: "ieeest",
    aliases: ["IEEEST"],
    label: "IEEE Single-Input Power System Stabilizer",
    category: "Stabilizer",
    archetypeId: PslfArchetypeId.STABILIZER,
    description: "Single-input IEEE stabilizer with notch filter, washout, and dual lead-lag.",
    provenance: "IEEE Std 421.5 Type PSS1A / IEEEST",
    params: PSS_PARAMS,
  },
  {
    modelType: "stab1",
    aliases: ["STAB1"],
    label: "Speed-Sensitive Power System Stabilizer",
    category: "Stabilizer",
    archetypeId: PslfArchetypeId.STABILIZER,
    description: "Classical speed-input washout + lead-lag stabilizer.",
    provenance: "WECC Dynamic Modeling Specifications (STAB1)",
    params: PSS_PARAMS,
  },

  // === WECC 2nd-Generation Renewables & IBRs ===
  {
    modelType: "regc_a",
    aliases: ["REGC_A", "regca1"],
    label: "WECC Renewable Energy Generator/Converter Model A",
    category: "Renewable / IBR",
    archetypeId: PslfArchetypeId.IBR_CONVERTER,
    description: "High-bandwidth current-injection inverter interface with LVPL and HV reactive current management.",
    provenance: "WECC Second Generation Wind & PV Generic Models (REGC_A)",
    params: IBR_REGC_PARAMS,
  },
  {
    modelType: "regc_b",
    aliases: ["REGC_B", "regcb1"],
    label: "WECC Renewable Energy Generator/Converter Model B",
    category: "Renewable / IBR",
    archetypeId: PslfArchetypeId.IBR_CONVERTER,
    description: "Voltage-source inverter interface suitable for weak-grid / low-SCR interconnects.",
    provenance: "WECC Renewable Energy Modeling Task Force (REGC_B)",
    params: IBR_REGC_PARAMS,
  },
  {
    modelType: "reec_a",
    aliases: ["REEC_A", "reeca1"],
    label: "WECC Renewable Energy Electrical Control Model A",
    category: "Renewable / IBR",
    archetypeId: PslfArchetypeId.IBR_ELECTRICAL,
    description: "Local active/reactive current control, voltage ride-through injection, and current priority limiter.",
    provenance: "WECC Second Generation Generic Models (REEC_A)",
    params: IBR_REEC_PARAMS,
  },
  {
    modelType: "reec_b",
    aliases: ["REEC_B", "reecb1"],
    label: "WECC PV Electrical Control Model B",
    category: "Renewable / IBR",
    archetypeId: PslfArchetypeId.IBR_ELECTRICAL,
    description: "Utility-scale solar PV local electrical controller.",
    provenance: "WECC Solar PV Generic Models (REEC_B)",
    params: IBR_REEC_PARAMS,
  },
  {
    modelType: "reec_c",
    aliases: ["REEC_C", "reecc1"],
    label: "WECC Battery Energy Storage Electrical Control Model C",
    category: "Renewable / IBR",
    archetypeId: PslfArchetypeId.IBR_ELECTRICAL,
    description: "BESS electrical controller with State-of-Charge (SoC) charge/discharge limits.",
    provenance: "WECC Battery Energy Storage Generic Models (REEC_C)",
    params: IBR_REEC_PARAMS,
  },
  {
    modelType: "reec_d",
    aliases: ["REEC_D", "reecd1"],
    label: "WECC Unified Electrical Control Model D",
    category: "Renewable / IBR",
    archetypeId: PslfArchetypeId.IBR_ELECTRICAL,
    description: "Unified next-generation electrical controller for wind, PV, and BESS.",
    provenance: "WECC Renewable Energy Modeling Task Force (REEC_D)",
    params: IBR_REEC_PARAMS,
  },
  {
    modelType: "repc_a",
    aliases: ["REPC_A", "repca1"],
    label: "WECC Renewable Energy Plant Controller A",
    category: "Renewable / IBR",
    archetypeId: PslfArchetypeId.IBR_PLANT_CTRL,
    description: "Plant-level voltage/reactive power and frequency-droop active power controller.",
    provenance: "WECC Second Generation Generic Models (REPC_A)",
    params: IBR_REPC_PARAMS,
  },
  {
    modelType: "repc_b",
    aliases: ["REPC_B"],
    label: "WECC Multi-Unit Renewable Plant Controller B",
    category: "Renewable / IBR",
    archetypeId: PslfArchetypeId.IBR_PLANT_CTRL,
    description: "Multi-inverter plant-level voltage and frequency controller.",
    provenance: "WECC Renewable Energy Modeling Task Force (REPC_B)",
    params: IBR_REPC_PARAMS,
  },
  {
    modelType: "der_a",
    aliases: ["DER_A", "dera1"],
    label: "WECC/NERC Distributed Energy Resource Model A",
    category: "Renewable / IBR",
    archetypeId: PslfArchetypeId.IBR_CONVERTER,
    description: "Aggregate distributed energy resource (IEEE 1547-2018) with partial tripping & momentary cessation.",
    provenance: "NERC Reliability Guideline / EPRI-WECC DER_A Specification",
    params: IBR_REGC_PARAMS,
  },
  {
    modelType: "pvd1",
    aliases: ["PVD1"],
    label: "WECC Distributed PV Model",
    category: "Renewable / IBR",
    archetypeId: PslfArchetypeId.IBR_CONVERTER,
    description: "Legacy distributed PV inverter aggregate model.",
    provenance: "WECC Solar PV Modeling Guide (PVD1)",
    params: IBR_REGC_PARAMS,
  },
  {
    modelType: "wt3g",
    aliases: ["WT3G", "wt3g1", "wt3g2"],
    label: "WECC Type 3 DFIG Wind Generator",
    category: "Renewable / IBR",
    archetypeId: PslfArchetypeId.IBR_CONVERTER,
    description: "Doubly-fed induction generator (Type 3) wind turbine converter interface.",
    provenance: "WECC Wind Power Plant Dynamic Modeling Guide (WT3G)",
    params: IBR_REGC_PARAMS,
  },
  {
    modelType: "wt4g",
    aliases: ["WT4G", "wt4g1", "wt4g2"],
    label: "WECC Type 4 Full-Converter Wind Generator",
    category: "Renewable / IBR",
    archetypeId: PslfArchetypeId.IBR_CONVERTER,
    description: "Full-converter (Type 4) wind turbine generator interface.",
    provenance: "WECC Wind Power Plant Dynamic Modeling Guide (WT4G)",
    params: IBR_REGC_PARAMS,
  },

  // === Composite & Dynamic Loads ===
  {
    modelType: "cmpldw",
    aliases: ["CMPLDW", "cmpldwg"],
    label: "WECC Composite Load Model (Motors A/B/C/D + Electronic + ZIP)",
    category: "Load / Motor",
    archetypeId: PslfArchetypeId.LOAD_COMPOSITE,
    description:
      "WECC composite load model representing substation feeder, 3-phase motors A/B/C, 1-phase A/C motor D, electronic, and static ZIP load.",
    provenance: "WECC Load Modeling Task Force (CMPLDW Specification)",
    params: LOAD_COMP_PARAMS,
  },
  {
    modelType: "clod",
    aliases: ["CLOD", "clodbl"],
    label: "Complex Composite Load Model",
    category: "Load / Motor",
    archetypeId: PslfArchetypeId.LOAD_COMPOSITE,
    description: "Aggregate large/small induction motor + discharge lighting + transformer saturation load.",
    provenance: "IEEE Task Force on Load Representation (CLOD)",
    params: LOAD_COMP_PARAMS,
  },
  {
    modelType: "ieeel",
    aliases: ["IEEEL", "ieeel1"],
    label: "IEEE Static ZIP + Frequency-Dependent Load",
    category: "Load / Motor",
    archetypeId: PslfArchetypeId.LOAD_COMPOSITE,
    description: "Polynomial ZIP voltage-dependent and linear frequency-dependent static load.",
    provenance: "IEEE Task Force on Load Representation for Dynamic Performance",
    params: LOAD_COMP_PARAMS,
  },
  {
    modelType: "motorw",
    aliases: ["MOTORW", "cim5bl", "cim6bl"],
    label: "WECC 3-Phase Induction Motor Model",
    category: "Load / Motor",
    archetypeId: PslfArchetypeId.LOAD_MOTOR,
    description: "Dynamic 3-phase induction motor with rotor flux dynamics and speed-dependent load torque.",
    provenance: "WECC Load Modeling Task Force (MOTORW / CIM5)",
    params: [
      ["ls", 3.0, "pu", "Synchronous reactance"],
      ["lp", 0.16, "pu", "Transient reactance"],
      ["ra", 0.04, "pu", "Stator resistance"],
      ["tpo", 0.1, "s", "Rotor open-circuit time constant"],
      ["h", 0.5, "s", "Motor inertia constant"],
      ["etrq", 2.0, "", "Load torque speed exponent"],
    ],
  },

  // === FACTS & HVDC ===
  {
    modelType: "svsmo1",
    aliases: ["SVSMO1", "svsmo2", "svsmo3"],
    label: "WECC Static Var Compensator (SVC)",
    category: "FACTS / HVDC",
    archetypeId: PslfArchetypeId.FACTS_SVC,
    description: "Voltage-regulating Static Var Compensator / STATCOM susceptance controller.",
    provenance: "WECC / CIGRE SVC Dynamic Modeling Guidelines (SVSMO1)",
    params: SVC_PARAMS,
  },
  {
    modelType: "cdc4t",
    aliases: ["CDC4T", "cdc6t", "hvdc1"],
    label: "Two-Terminal LCC HVDC Link",
    category: "FACTS / HVDC",
    archetypeId: PslfArchetypeId.HVDC,
    description: "Line-commutated converter two-terminal HVDC link with VDCOL current order limiter.",
    provenance: "CIGRE / WECC HVDC Dynamic Modeling Guidelines (CDC4T)",
    params: [
      ["pdc0", 1.0, "pu", "Scheduled DC power"],
      ["tdc", 0.05, "s", "DC current regulator time constant"],
      ["vdcol_v1", 0.4, "pu", "VDCOL lower AC voltage breakpoint"],
      ["vdcol_v2", 0.85, "pu", "VDCOL upper AC voltage breakpoint"],
    ],
  },

  // === Protection Relays & Limiters ===
  {
    modelType: "lshd1",
    aliases: ["LSHD1", "ldshbl", "ufreq"],
    label: "Under-Frequency Load Shedding Relay (UFLS)",
    category: "Protection / Limiter",
    archetypeId: PslfArchetypeId.RELAY_LIMITER,
    description: "Multi-stage under-frequency load shedding relay with pickup, time delay, and breaker clearing.",
    provenance: "NERC PRC-006 / WECC UFLS Relay Specification",
    params: RELAY_PARAMS,
  },
  {
    modelType: "vtrp",
    aliases: ["VTRP", "lvshbl"],
    label: "Under-Voltage Load Shedding / Trip Relay (UVLS)",
    category: "Protection / Limiter",
    archetypeId: PslfArchetypeId.RELAY_LIMITER,
    description: "Under-voltage trip/shedding relay with inverse/definite time delay.",
    provenance: "NERC PRC-010 / WECC UVLS Relay Specification",
    params: [
      ["v1", 0.85, "pu", "Under-voltage pickup"],
      ["t1", 0.5, "s", "Time delay"],
      ["frac1", 0.2, "pu", "Shed fraction"],
      ["tb", 0.08, "s", "Breaker opening time"],
    ],
  },
  {
    modelType: "oel1",
    aliases: ["OEL1", "oel2c"],
    label: "Over-Excitation Limiter (OEL)",
    category: "Protection / Limiter",
    archetypeId: PslfArchetypeId.RELAY_LIMITER,
    description: "IEEE Std 421.5 Over-Excitation Limiter protecting synchronous generator field winding.",
    provenance: "IEEE Std 421.5-2016 Type OEL1",
    params: [
      ["ifdlim", 2.5, "pu", "Continuous field current limit"],
      ["ifdmax", 3.5, "pu", "Instantaneous field current ceiling"],
      ["toel", 10.0, "s", "Thermal time constant"],
    ],
  },
  {
    modelType: "uel1",
    aliases: ["UEL1", "uel2c"],
    label: "Under-Excitation Limiter (UEL)",
    category: "Protection / Limiter",
    archetypeId: PslfArchetypeId.RELAY_LIMITER,
    description: "IEEE Std 421.5 Under-Excitation Limiter preventing steady-state stability loss.",
    provenance: "IEEE Std 421.5-2016 Type UEL1",
    params: [
      ["kul", 10.0, "pu", "UEL proportional gain"],
      ["tul", 0.1, "s", "UEL time constant"],
      ["qmin", -0.4, "pu", "Minimum reactive power absorption limit"],
    ],
  },
];

/**
 * Converts `PSLF_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildPslfCleanroomSchemas(): CleanroomModelSchema[] {
  return PSLF_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `pslf:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "electrical",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "pslf_dynamic_model",
      width: 80,
      height: 48,
      svg: generatePslfBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
