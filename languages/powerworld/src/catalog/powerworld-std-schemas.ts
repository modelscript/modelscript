// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * PowerWorld cleanroom dynamic model archetype IDs matching `assets/powerworld-std-lib/src/models.ts`.
 */
export const PowerWorldArchetypeId = {
  SYNC_GEN_ROUND: 1, // GENROU, GENTPF, GENTPJ
  SYNC_GEN_SALIENT: 2, // GENSAL
  SYNC_GEN_CLASSICAL: 3, // GENCLS
  EXCITER_STATIC: 10, // EXST1, ESST1A, ESST4B, SEXS
  EXCITER_AC: 11, // ESAC1A, EXAC1
  EXCITER_DC: 12, // ESDC1A, EXDC1
  GOVERNOR_STEAM: 20, // TGOV1, IEESGO, IEEEG1
  GOVERNOR_HYDRO: 21, // HYGOV, PIDGOV
  GOVERNOR_GAS: 22, // GAST, GGOV1
  STABILIZER: 30, // PSS2A, PSS2B, IEEEST, STAB1
  IBR_CONVERTER: 40, // REGCA1, REGCB1, DER_A, WT3G1, WT4G1
  IBR_ELECTRICAL: 41, // REECA1, REECB1, REECC1
  IBR_PLANT_CTRL: 42, // REPCA1
  LOAD_COMPOSITE: 50, // CMPLDW, CLODBL, IEEEL
  LOAD_MOTOR: 51, // CIM5BL
  FACTS_SVC: 60, // SVSMO1
  HVDC: 61, // CDC4T
  RELAY_LIMITER: 70, // LDSHBL, LVSHBL, OEL1, UEL1
} as const;

export type PowerWorldArchetypeId = (typeof PowerWorldArchetypeId)[keyof typeof PowerWorldArchetypeId];

export interface PowerWorldModelSpec {
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
  archetypeId: PowerWorldArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<PowerWorldModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
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
 * Generates a deterministic cleanroom SVG block icon for a PowerWorld `.aux` dynamic model.
 */
export function generatePowerWorldBlockSvg(modelType: string, category: PowerWorldModelSpec["category"]): string {
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

function defaultPortsForCategory(category: PowerWorldModelSpec["category"]): DiagramPortSpec[] {
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

const GEN_ROUND_PARAMS: PowerWorldModelSpec["params"] = [
  ["Tdo", 6.5, "s", "d-axis transient open-circuit time constant"],
  ["Tddo", 0.05, "s", "d-axis subtransient open-circuit time constant"],
  ["Tqo", 0.5, "s", "q-axis transient open-circuit time constant"],
  ["Tqdo", 0.08, "s", "q-axis subtransient open-circuit time constant"],
  ["H", 4.0, "s", "Inertia constant H"],
  ["D", 1.5, "pu", "Speed damping factor D"],
  ["Xd", 1.85, "pu", "d-axis synchronous reactance"],
  ["Xq", 1.75, "pu", "q-axis synchronous reactance"],
  ["Xdp", 0.3, "pu", "d-axis transient reactance"],
  ["Xqp", 0.45, "pu", "q-axis transient reactance"],
  ["Xdpp", 0.2, "pu", "d-axis subtransient reactance"],
  ["Xl", 0.14, "pu", "Stator leakage reactance"],
  ["S10", 0.09, "pu", "Saturation factor at 1.0 pu"],
  ["S12", 0.35, "pu", "Saturation factor at 1.2 pu"],
];

const GEN_SALIENT_PARAMS: PowerWorldModelSpec["params"] = [
  ["Tdo", 5.5, "s", "d-axis transient open-circuit time constant"],
  ["Tddo", 0.05, "s", "d-axis subtransient open-circuit time constant"],
  ["Tqdo", 0.08, "s", "q-axis subtransient open-circuit time constant"],
  ["H", 3.5, "s", "Inertia constant H"],
  ["D", 1.0, "pu", "Damping factor D"],
  ["Xd", 1.2, "pu", "d-axis synchronous reactance"],
  ["Xq", 0.75, "pu", "q-axis synchronous reactance"],
  ["Xdp", 0.32, "pu", "d-axis transient reactance"],
  ["Xdpp", 0.22, "pu", "d-axis subtransient reactance"],
  ["Xl", 0.14, "pu", "Leakage reactance"],
  ["S10", 0.1, "pu", "Saturation factor at 1.0 pu"],
  ["S12", 0.4, "pu", "Saturation factor at 1.2 pu"],
];

const EXCITER_STATIC_PARAMS: PowerWorldModelSpec["params"] = [
  ["Tr", 0.02, "s", "Voltage transducer time constant"],
  ["Vimax", 0.5, "pu", "Voltage error upper limit"],
  ["Vimin", -0.5, "pu", "Voltage error lower limit"],
  ["Tc", 1.0, "s", "Lead time constant"],
  ["Tb", 10.0, "s", "Lag time constant"],
  ["Ka", 200.0, "pu", "Voltage regulator gain"],
  ["Ta", 0.05, "s", "Voltage regulator time constant"],
  ["Vrmax", 5.0, "pu", "Maximum regulator output"],
  ["Vrmin", -4.5, "pu", "Minimum regulator output"],
  ["Kc", 0.05, "pu", "Commutation factor"],
  ["Kf", 0.0, "pu", "Stabilizing feedback gain"],
  ["Tf", 1.0, "s", "Stabilizing feedback time constant"],
];

const EXCITER_AC_PARAMS: PowerWorldModelSpec["params"] = [
  ["Tr", 0.02, "s", "Voltage transducer time constant"],
  ["Tb", 0.0, "s", "Lag time constant"],
  ["Tc", 0.0, "s", "Lead time constant"],
  ["Ka", 400.0, "pu", "Voltage regulator gain"],
  ["Ta", 0.02, "s", "Voltage regulator time constant"],
  ["Vrmax", 6.0, "pu", "Maximum regulator output"],
  ["Vrmin", -5.4, "pu", "Minimum regulator output"],
  ["Te", 0.8, "s", "Exciter time constant"],
  ["Kf", 0.03, "pu", "Stabilizing feedback gain"],
  ["Tf", 1.0, "s", "Stabilizing feedback time constant"],
  ["Kc", 0.2, "pu", "Rectifier loading factor"],
  ["Kd", 0.38, "pu", "Demagnetizing factor"],
  ["Ke", 1.0, "pu", "Exciter constant"],
];

const EXCITER_DC_PARAMS: PowerWorldModelSpec["params"] = [
  ["Tr", 0.02, "s", "Voltage transducer time constant"],
  ["Ka", 100.0, "pu", "Voltage regulator gain"],
  ["Ta", 0.05, "s", "Voltage regulator time constant"],
  ["Tb", 0.0, "s", "Lag time constant"],
  ["Tc", 0.0, "s", "Lead time constant"],
  ["Vrmax", 5.0, "pu", "Maximum regulator output"],
  ["Vrmin", -5.0, "pu", "Minimum regulator output"],
  ["Ke", 1.0, "pu", "Exciter constant"],
  ["Te", 0.5, "s", "Exciter time constant"],
  ["Kf", 0.05, "pu", "Stabilizing feedback gain"],
  ["Tf", 1.0, "s", "Stabilizing feedback time constant"],
];

const GOVERNOR_STEAM_PARAMS: PowerWorldModelSpec["params"] = [
  ["R", 0.05, "pu", "Permanent droop"],
  ["T1", 0.5, "s", "Governor lag time constant"],
  ["Vmax", 1.0, "pu", "Maximum valve position"],
  ["Vmin", 0.0, "pu", "Minimum valve position"],
  ["T2", 1.0, "s", "Turbine lead time constant"],
  ["T3", 5.0, "s", "Turbine reheater lag time constant"],
  ["Dt", 0.0, "pu", "Turbine damping factor"],
];

const GOVERNOR_HYDRO_PARAMS: PowerWorldModelSpec["params"] = [
  ["R", 0.05, "pu", "Permanent droop"],
  ["r", 0.4, "pu", "Temporary droop"],
  ["Tr", 5.0, "s", "Governor time constant"],
  ["Tf", 0.05, "s", "Filter time constant"],
  ["Tg", 0.5, "s", "Servo time constant"],
  ["Velm", 0.2, "pu/s", "Gate velocity limit"],
  ["Gmax", 1.0, "pu", "Maximum gate limit"],
  ["Gmin", 0.0, "pu", "Minimum gate limit"],
  ["Tw", 1.5, "s", "Water starting time"],
  ["At", 1.2, "pu", "Turbine gain"],
  ["Dturb", 0.2, "pu", "Turbine damping"],
  ["qnl", 0.08, "pu", "No-load flow"],
];

const GOVERNOR_GAS_PARAMS: PowerWorldModelSpec["params"] = [
  ["R", 0.05, "pu", "Permanent droop"],
  ["T1", 0.4, "s", "Governor mechanism time constant"],
  ["T2", 0.1, "s", "Turbine power time constant"],
  ["T3", 3.0, "s", "Turbine exhaust temperature time constant"],
  ["At", 1.0, "pu", "Ambient temperature load limit"],
  ["Kt", 2.0, "pu", "Temperature limiter gain"],
  ["Vmax", 1.0, "pu", "Maximum fuel valve position"],
  ["Vmin", 0.0, "pu", "Minimum fuel valve position"],
  ["Dturb", 0.0, "pu", "Turbine damping"],
];

const PSS_PARAMS: PowerWorldModelSpec["params"] = [
  ["Tw1", 10.0, "s", "Washout time constant 1"],
  ["Tw2", 10.0, "s", "Washout time constant 2"],
  ["Ks1", 10.0, "pu", "Stabilizer gain"],
  ["T1", 0.15, "s", "Lead time constant 1"],
  ["T2", 0.03, "s", "Lag time constant 1"],
  ["T3", 0.15, "s", "Lead time constant 2"],
  ["T4", 0.03, "s", "Lag time constant 2"],
  ["Vstmax", 0.1, "pu", "Maximum stabilizer output"],
  ["Vstmin", -0.1, "pu", "Minimum stabilizer output"],
];

const IBR_REGC_PARAMS: PowerWorldModelSpec["params"] = [
  ["Tg", 0.02, "s", "Converter current control time constant"],
  ["Rrpwr", 10.0, "pu/s", "Active current ramp rate limit"],
  ["Brkpt", 0.9, "pu", "Low-voltage active current management breakpoint"],
  ["Zerox", 0.4, "pu", "Low-voltage active current zero crossing"],
  ["Lvpl1", 1.22, "pu", "LVPL gain breakpoint"],
  ["Vtmax", 1.2, "pu", "High-voltage reactive current limit threshold"],
  ["Lvpnt1", 0.8, "pu", "High point of low-voltage active current management"],
  ["Lvpnt0", 0.4, "pu", "Low point of low-voltage active current management"],
  ["Qmin", -1.3, "pu", "Minimum reactive current limit"],
  ["Accel", 0.7, "pu", "Acceleration factor"],
  ["Khv", 0.7, "pu", "Overvoltage compensation gain"],
  ["Iqrmax", 999.0, "pu/s", "Max reactive current ramp rate"],
  ["Iqrmin", -999.0, "pu/s", "Min reactive current ramp rate"],
];

const IBR_REEC_PARAMS: PowerWorldModelSpec["params"] = [
  ["Vdip", 0.9, "pu", "Low-voltage threshold for reactive current injection"],
  ["Vup", 1.1, "pu", "High-voltage threshold for reactive current injection"],
  ["Trv", 0.02, "s", "Voltage filter time constant"],
  ["dbd1", -0.05, "pu", "Voltage error lower deadband"],
  ["dbd2", 0.05, "pu", "Voltage error upper deadband"],
  ["Kqv", 2.0, "pu", "Reactive current injection gain"],
  ["Iqh1", 1.0, "pu", "Max reactive current injection"],
  ["Iql1", -1.0, "pu", "Min reactive current injection"],
  ["Vref0", 1.0, "pu", "Reference voltage"],
  ["Tp", 0.05, "s", "Active power filter time constant"],
  ["Qmax", 0.44, "pu", "Max reactive power limit"],
  ["Qmin", -0.44, "pu", "Min reactive power limit"],
  ["Pmax", 1.0, "pu", "Max active power limit"],
  ["Pmin", 0.0, "pu", "Min active power limit"],
  ["Imax", 1.1, "pu", "Total converter current limit"],
];

const IBR_REPC_PARAMS: PowerWorldModelSpec["params"] = [
  ["Tfltr", 0.02, "s", "Voltage/Q measurement filter time constant"],
  ["Kp", 18.0, "pu", "Reactive power PI proportional gain"],
  ["Ki", 5.0, "pu/s", "Reactive power PI integral gain"],
  ["Tft", 0.0, "s", "Lead time constant"],
  ["Tfv", 0.05, "s", "Lag time constant"],
  ["emax", 0.5, "pu", "Upper error limit"],
  ["emin", -0.5, "pu", "Lower error limit"],
  ["dbd", 0.002, "pu", "Deadband"],
  ["Qmax", 0.44, "pu", "Max Q command"],
  ["Qmin", -0.44, "pu", "Min Q command"],
  ["Kpg", 0.1, "pu", "Active power PI proportional gain"],
  ["Kig", 0.05, "pu/s", "Active power PI integral gain"],
  ["Tp", 0.25, "s", "Active power filter time constant"],
  ["Ddn", 20.0, "pu", "Down-regulation droop gain"],
  ["Dup", 20.0, "pu", "Up-regulation droop gain"],
];

const LOAD_COMPOSITE_PARAMS: PowerWorldModelSpec["params"] = [
  ["Fma", 0.2, "pu", "Motor A (3-phase constant torque) fraction"],
  ["Fmb", 0.2, "pu", "Motor B (3-phase high inertia fan) fraction"],
  ["Fmc", 0.1, "pu", "Motor C (3-phase low inertia pump) fraction"],
  ["Fmd", 0.25, "pu", "Motor D (1-phase A/C compressor) fraction"],
  ["Fel", 0.15, "pu", "Power electronic load fraction"],
  ["Rfdr", 0.04, "pu", "Distribution feeder equivalent resistance"],
  ["Xfdr", 0.04, "pu", "Distribution feeder equivalent reactance"],
  ["Vstall", 0.6, "pu", "Single-phase motor stalling voltage threshold"],
  ["Tstall", 0.033, "s", "Single-phase motor stall time"],
];

const RELAY_UFLS_PARAMS: PowerWorldModelSpec["params"] = [
  ["f1", 59.3, "Hz", "Stage 1 under-frequency pickup"],
  ["t1", 0.2, "s", "Stage 1 time delay"],
  ["frac1", 0.1, "pu", "Stage 1 load shed fraction"],
  ["f2", 59.0, "Hz", "Stage 2 under-frequency pickup"],
  ["t2", 0.2, "s", "Stage 2 time delay"],
  ["frac2", 0.1, "pu", "Stage 2 load shed fraction"],
  ["f3", 58.7, "Hz", "Stage 3 under-frequency pickup"],
  ["t3", 0.2, "s", "Stage 3 time delay"],
  ["frac3", 0.1, "pu", "Stage 3 load shed fraction"],
  ["tb", 0.08, "s", "Breaker opening time"],
];

/**
 * Cleanroom catalog of PowerWorld Simulator `.aux` dynamic models covering
 * IEEE / WECC / NERC standardized synchronous machines, exciters, governors,
 * power system stabilizers, inverter-based resources, composite loads, FACTS/HVDC,
 * and protection relays/limiters.
 */
export const POWERWORLD_MODEL_SPECS: PowerWorldModelSpec[] = [
  // === Synchronous Generators (5) ===
  {
    modelType: "GENROU",
    aliases: ["genrou"],
    label: "Round-Rotor Synchronous Generator (Quadratic Saturation)",
    category: "Generator",
    archetypeId: PowerWorldArchetypeId.SYNC_GEN_ROUND,
    description:
      "IEEE Std 1110 / WECC round-rotor synchronous machine model with d/q subtransient dynamics and quadratic saturation.",
    provenance: "IEEE Std 1110-2002 / WECC GENROU Specification",
    params: GEN_ROUND_PARAMS,
  },
  {
    modelType: "GENSAL",
    aliases: ["gensal"],
    label: "Salient-Pole Synchronous Generator",
    category: "Generator",
    archetypeId: PowerWorldArchetypeId.SYNC_GEN_SALIENT,
    description:
      "Salient-pole hydro synchronous machine model with d-axis transient/subtransient and q-axis subtransient circuits.",
    provenance: "IEEE Std 1110-2002 / WECC GENSAL Specification",
    params: GEN_SALIENT_PARAMS,
  },
  {
    modelType: "GENCLS",
    aliases: ["gencls"],
    label: "Classical Constant-Voltage-Behind-Xd' Generator",
    category: "Generator",
    archetypeId: PowerWorldArchetypeId.SYNC_GEN_CLASSICAL,
    description:
      "Classical 2-state swing equation synchronous machine with constant internal voltage behind transient reactance.",
    provenance: "IEEE Std 1110-2002 Classical Machine Model",
    params: [
      ["H", 3.5, "s", "Inertia constant H"],
      ["D", 1.0, "pu", "Damping factor D"],
    ],
  },
  {
    modelType: "GENTPF",
    aliases: ["gentpf"],
    label: "WECC Round/Salient Generator with Improved Saturation (GENTPF)",
    category: "Generator",
    archetypeId: PowerWorldArchetypeId.SYNC_GEN_ROUND,
    description:
      "WECC synchronous generator model incorporating saturation directly into stator and rotor flux linkages.",
    provenance: "WECC Modeling and Validation Work Group — GENTPF Technical Specification",
    params: GEN_ROUND_PARAMS,
  },
  {
    modelType: "GENTPJ",
    aliases: ["gentpj"],
    label: "WECC Synchronous Generator with Stator-Current-Dependent Saturation (GENTPJ)",
    category: "Generator",
    archetypeId: PowerWorldArchetypeId.SYNC_GEN_ROUND,
    description:
      "WECC GENTPJ synchronous machine with Kis stator current saturation term recommended for NERC MOD-026 validation.",
    provenance: "NERC MOD-026 / WECC GENTPJ Technical Specification",
    params: [...GEN_ROUND_PARAMS, ["Kis", 0.0, "pu", "Stator current saturation coefficient"]],
  },

  // === Exciters / AVRs (8) ===
  {
    modelType: "EXST1",
    aliases: ["exst1"],
    label: "IEEE Type ST1 Static Potential-Source Exciter",
    category: "Exciter",
    archetypeId: PowerWorldArchetypeId.EXCITER_STATIC,
    description:
      "IEEE Std 421.5 Type ST1 static excitation system with lead-lag compensation and rectifier commutation drop.",
    provenance: "IEEE Std 421.5-2016 Type ST1 / EXST1",
    params: EXCITER_STATIC_PARAMS,
  },
  {
    modelType: "ESST1A",
    aliases: ["esst1a"],
    label: "IEEE Type ST1A Potential-Source Controlled-Rectifier Exciter",
    category: "Exciter",
    archetypeId: PowerWorldArchetypeId.EXCITER_STATIC,
    description:
      "IEEE Std 421.5 Type ST1A static excitation system with dual lead-lag blocks and field current limiting.",
    provenance: "IEEE Std 421.5-2016 Type ST1A / ESST1A",
    params: EXCITER_STATIC_PARAMS,
  },
  {
    modelType: "ESST4B",
    aliases: ["esst4b"],
    label: "IEEE Type ST4B Potential/Compound-Source Static Exciter",
    category: "Exciter",
    archetypeId: PowerWorldArchetypeId.EXCITER_STATIC,
    description:
      "IEEE Std 421.5 Type ST4B static exciter with PI inner/outer voltage regulators and compound source impedance.",
    provenance: "IEEE Std 421.5-2016 Type ST4B / ESST4B",
    params: EXCITER_STATIC_PARAMS,
  },
  {
    modelType: "SEXS",
    aliases: ["sexs"],
    label: "Simplified Excitation System (SEXS)",
    category: "Exciter",
    archetypeId: PowerWorldArchetypeId.EXCITER_STATIC,
    description: "Simplified first-order lead-lag excitation system for screening and bulk-system dynamic studies.",
    provenance: "IEEE / WECC Simplified Excitation System (SEXS)",
    params: [
      ["Tr", 0.02, "s", "Voltage transducer time constant"],
      ["TaTb", 0.1, "pu", "Lead/lag ratio Ta/Tb"],
      ["Tb", 10.0, "s", "Lag time constant"],
      ["Tc", 1.0, "s", "Lead time constant"],
      ["Te", 0.05, "s", "Exciter time constant"],
      ["K", 100.0, "pu", "Regulator gain"],
      ["Ta", 0.05, "s", "Regulator time constant"],
      ["Emax", 5.0, "pu", "Maximum field voltage"],
      ["Emin", -4.0, "pu", "Minimum field voltage"],
    ],
  },
  {
    modelType: "ESAC1A",
    aliases: ["esac1a"],
    label: "IEEE Type AC1A Alternator-Rectifier Exciter",
    category: "Exciter",
    archetypeId: PowerWorldArchetypeId.EXCITER_AC,
    description:
      "IEEE Std 421.5 Type AC1A brushless alternator-rectifier excitation system with demagnetizing feedback.",
    provenance: "IEEE Std 421.5-2016 Type AC1A / ESAC1A",
    params: EXCITER_AC_PARAMS,
  },
  {
    modelType: "ESDC1A",
    aliases: ["esdc1a"],
    label: "IEEE Type DC1A DC Commutator Exciter",
    category: "Exciter",
    archetypeId: PowerWorldArchetypeId.EXCITER_DC,
    description: "IEEE Std 421.5 Type DC1A field-controlled DC commutator excitation system with saturation.",
    provenance: "IEEE Std 421.5-2016 Type DC1A / ESDC1A",
    params: EXCITER_DC_PARAMS,
  },
  {
    modelType: "EXAC1",
    aliases: ["exac1"],
    label: "IEEE 1981 Type AC1 Alternator-Rectifier Exciter",
    category: "Exciter",
    archetypeId: PowerWorldArchetypeId.EXCITER_AC,
    description: "IEEE 1981 Type AC1 brushless alternator-rectifier exciter with rectifier regulation and saturation.",
    provenance: "IEEE Committee Report 1981 / IEEE Std 421.5 Type AC1",
    params: EXCITER_AC_PARAMS,
  },
  {
    modelType: "EXDC1",
    aliases: ["exdc1"],
    label: "IEEE 1981 Type DC1 DC Commutator Exciter",
    category: "Exciter",
    archetypeId: PowerWorldArchetypeId.EXCITER_DC,
    description: "IEEE 1981 Type DC1 rotating DC commutator exciter with rate feedback stabilization.",
    provenance: "IEEE Committee Report 1981 / IEEE Std 421.5 Type DC1",
    params: EXCITER_DC_PARAMS,
  },

  // === Governors / Prime Movers (7) ===
  {
    modelType: "TGOV1",
    aliases: ["tgov1"],
    label: "Simple Steam Turbine-Governor (TGOV1)",
    category: "Governor",
    archetypeId: PowerWorldArchetypeId.GOVERNOR_STEAM,
    description:
      "Standard simplified steam turbine-governor with droop, governor lag, and lead-lag reheater representation.",
    provenance: "IEEE PES Turbine-Governor Task Force — TGOV1",
    params: GOVERNOR_STEAM_PARAMS,
  },
  {
    modelType: "HYGOV",
    aliases: ["hygov"],
    label: "Hydro Turbine-Governor (HYGOV)",
    category: "Governor",
    archetypeId: PowerWorldArchetypeId.GOVERNOR_HYDRO,
    description:
      "Nonlinear hydraulic turbine-governor with permanent/temporary droop, gate velocity limits, and water inertia Tw.",
    provenance: "IEEE Working Group 1992 — Hydraulic Turbine and Turbine Control Models (HYGOV)",
    params: GOVERNOR_HYDRO_PARAMS,
  },
  {
    modelType: "GAST",
    aliases: ["gast"],
    label: "Gas Turbine-Governor (GAST)",
    category: "Governor",
    archetypeId: PowerWorldArchetypeId.GOVERNOR_GAS,
    description: "Gas turbine-governor with fuel control lag, combustor delay, and exhaust temperature limiter.",
    provenance: "IEEE PES Dynamic Models for Turbine-Governors — GAST",
    params: GOVERNOR_GAS_PARAMS,
  },
  {
    modelType: "GGOV1",
    aliases: ["ggov1"],
    label: "WECC General Governor / Turbine Model (GGOV1)",
    category: "Governor",
    archetypeId: PowerWorldArchetypeId.GOVERNOR_GAS,
    description:
      "WECC general-purpose PID turbine-governor for gas, combined-cycle, and steam units with load limiter.",
    provenance: "WECC / IEEE PES PES-TR1 — General Governor Model GGOV1",
    params: GOVERNOR_GAS_PARAMS,
  },
  {
    modelType: "IEESGO",
    aliases: ["ieesgo"],
    label: "IEEE Standard Steam Governor (IEESGO)",
    category: "Governor",
    archetypeId: PowerWorldArchetypeId.GOVERNOR_STEAM,
    description: "IEEE 1973 Committee Report standard steam turbine-governor with three-stage time constants.",
    provenance: "IEEE Committee Report 1973 — Dynamic Models for Steam and Hydro Turbines (IEESGO)",
    params: GOVERNOR_STEAM_PARAMS,
  },
  {
    modelType: "IEEEG1",
    aliases: ["ieeeg1"],
    label: "IEEE Type 1 Tandem-Compound Steam Turbine-Governor (IEEEG1)",
    category: "Governor",
    archetypeId: PowerWorldArchetypeId.GOVERNOR_STEAM,
    description:
      "Detailed tandem/cross-compound steam turbine-governor with HP/IP/LP power fractions and valve rate limits.",
    provenance: "IEEE Committee Report 1973 — IEEEG1 Tandem-Compound Steam Model",
    params: [
      ...GOVERNOR_STEAM_PARAMS,
      ["K1", 0.3, "pu", "HP turbine fraction"],
      ["K3", 0.3, "pu", "IP turbine fraction"],
      ["K5", 0.4, "pu", "LP turbine fraction"],
    ],
  },
  {
    modelType: "PIDGOV",
    aliases: ["pidgov"],
    label: "Hydro PID Turbine-Governor (PIDGOV)",
    category: "Governor",
    archetypeId: PowerWorldArchetypeId.GOVERNOR_HYDRO,
    description:
      "PID hydraulic turbine-governor with proportional-integral-derivative gate controller and penstock dynamics.",
    provenance: "IEEE PES-TR1 — Hydraulic PID Governor (PIDGOV)",
    params: GOVERNOR_HYDRO_PARAMS,
  },

  // === Power System Stabilizers (4) ===
  {
    modelType: "PSS2A",
    aliases: ["pss2a"],
    label: "IEEE Type PSS2A Dual-Input Power System Stabilizer",
    category: "Stabilizer",
    archetypeId: PowerWorldArchetypeId.STABILIZER,
    description:
      "IEEE Std 421.5 dual-input (speed + accelerating power) PSS with ramp-tracking filter and lead-lag stages.",
    provenance: "IEEE Std 421.5-2016 Type PSS2A",
    params: PSS_PARAMS,
  },
  {
    modelType: "PSS2B",
    aliases: ["pss2b"],
    label: "IEEE Type PSS2B Dual-Input Power System Stabilizer",
    category: "Stabilizer",
    archetypeId: PowerWorldArchetypeId.STABILIZER,
    description: "IEEE Std 421.5 PSS2B dual-input stabilizer with three lead-lag phase compensation stages.",
    provenance: "IEEE Std 421.5-2016 Type PSS2B",
    params: PSS_PARAMS,
  },
  {
    modelType: "IEEEST",
    aliases: ["ieeest"],
    label: "IEEE Type PSS1A / IEEEST Single-Input Stabilizer",
    category: "Stabilizer",
    archetypeId: PowerWorldArchetypeId.STABILIZER,
    description:
      "IEEE Std 421.5 single-input stabilizing controller with washout, notch filter, and dual lead-lag compensation.",
    provenance: "IEEE Std 421.5-2016 Type PSS1A / IEEEST",
    params: PSS_PARAMS,
  },
  {
    modelType: "STAB1",
    aliases: ["stab1"],
    label: "Speed-Sensitive Power System Stabilizer (STAB1)",
    category: "Stabilizer",
    archetypeId: PowerWorldArchetypeId.STABILIZER,
    description:
      "Classic speed-input power system stabilizer with washout filter and two lead-lag phase-compensation stages.",
    provenance: "IEEE / WECC Speed-Sensitive Stabilizer (STAB1)",
    params: PSS_PARAMS,
  },

  // === Renewables & Inverter-Based Resources (9) ===
  {
    modelType: "REGCA1",
    aliases: ["regca1", "regc_a", "REGC_A"],
    label: "WECC Renewable Energy Generator/Converter Model A (REGCA1)",
    category: "Renewable / IBR",
    archetypeId: PowerWorldArchetypeId.IBR_CONVERTER,
    description:
      "WECC second-generation generic IBR converter interface with LVPL active current management and HV reactive current limiting.",
    provenance: "WECC REMTF / EPRI — Generic Renewable Energy Generator/Converter Model REGC_A",
    params: IBR_REGC_PARAMS,
  },
  {
    modelType: "REGCB1",
    aliases: ["regcb1", "regc_b", "REGC_B"],
    label: "WECC Voltage-Source Converter Model B (REGCB1)",
    category: "Renewable / IBR",
    archetypeId: PowerWorldArchetypeId.IBR_CONVERTER,
    description: "WECC voltage-source IBR converter model for weak-grid / low short-circuit ratio stability studies.",
    provenance: "WECC REMTF / NERC IRPTF — Voltage-Source Converter Model REGC_B",
    params: IBR_REGC_PARAMS,
  },
  {
    modelType: "REECA1",
    aliases: ["reeca1", "reec_a", "REEC_A"],
    label: "WECC Renewable Energy Electrical Control Model A (REECA1)",
    category: "Renewable / IBR",
    archetypeId: PowerWorldArchetypeId.IBR_ELECTRICAL,
    description:
      "WECC generic IBR electrical control for Type-3/Type-4 wind and utility PV with FRT reactive current injection.",
    provenance: "WECC REMTF — Renewable Energy Electrical Control Model REEC_A",
    params: IBR_REEC_PARAMS,
  },
  {
    modelType: "REECB1",
    aliases: ["reecb1", "reec_b", "REEC_B"],
    label: "WECC Large-Scale PV Electrical Control Model B (REECB1)",
    category: "Renewable / IBR",
    archetypeId: PowerWorldArchetypeId.IBR_ELECTRICAL,
    description:
      "WECC generic electrical control tailored for large-scale solar PV inverters with Q/V and PF control modes.",
    provenance: "WECC REMTF — PV Electrical Control Model REEC_B",
    params: IBR_REEC_PARAMS,
  },
  {
    modelType: "REECC1",
    aliases: ["reecc1", "reec_c", "REEC_C"],
    label: "WECC Battery Energy Storage Electrical Control Model C (REECC1)",
    category: "Renewable / IBR",
    archetypeId: PowerWorldArchetypeId.IBR_ELECTRICAL,
    description:
      "WECC generic electrical control for Battery Energy Storage Systems (BESS) with state-of-charge limits and bidirectional P.",
    provenance: "WECC REMTF — BESS Electrical Control Model REEC_C",
    params: [
      ...IBR_REEC_PARAMS,
      ["SOCini", 0.5, "pu", "Initial battery state of charge"],
      ["SOCmax", 0.9, "pu", "Maximum battery state of charge"],
      ["SOCmin", 0.1, "pu", "Minimum battery state of charge"],
    ],
  },
  {
    modelType: "REPCA1",
    aliases: ["repca1", "repc_a", "REPC_A"],
    label: "WECC Renewable Energy Plant Controller Model A (REPCA1)",
    category: "Renewable / IBR",
    archetypeId: PowerWorldArchetypeId.IBR_PLANT_CTRL,
    description:
      "WECC plant-level supervisory voltage/Q and frequency/P droop controller for wind, solar, and BESS plants.",
    provenance: "WECC REMTF — Renewable Energy Plant Controller Model REPC_A",
    params: IBR_REPC_PARAMS,
  },
  {
    modelType: "DER_A",
    aliases: ["der_a", "DERA1", "dera1"],
    label: "WECC / NERC Distributed Energy Resource Aggregate Model (DER_A)",
    category: "Renewable / IBR",
    archetypeId: PowerWorldArchetypeId.IBR_CONVERTER,
    description:
      "WECC/EPRI/NERC aggregate distributed PV/DER model with IEEE 1547-2018 ride-through, momentary cessation, and frequency droop.",
    provenance: "NERC SPIDERWG / WECC / IEEE Std 1547-2018 — DER_A Specification",
    params: IBR_REGC_PARAMS,
  },
  {
    modelType: "WT3G1",
    aliases: ["wt3g1", "wt3g"],
    label: "WECC Type-3 Doubly-Fed Induction Wind Generator (WT3G1)",
    category: "Renewable / IBR",
    archetypeId: PowerWorldArchetypeId.IBR_CONVERTER,
    description: "WECC first-generation Type-3 DFIG wind turbine generator/converter interface.",
    provenance: "WECC Wind Generation Modeling Group — WT3G1 Specification",
    params: IBR_REGC_PARAMS,
  },
  {
    modelType: "WT4G1",
    aliases: ["wt4g1", "wt4g"],
    label: "WECC Type-4 Full-Converter Wind Generator (WT4G1)",
    category: "Renewable / IBR",
    archetypeId: PowerWorldArchetypeId.IBR_CONVERTER,
    description: "WECC first-generation Type-4 full-converter wind turbine generator/converter interface.",
    provenance: "WECC Wind Generation Modeling Group — WT4G1 Specification",
    params: IBR_REGC_PARAMS,
  },

  // === Loads & Motors (4) ===
  {
    modelType: "CMPLDW",
    aliases: ["cmpldw"],
    label: "WECC Composite Load Model (CMPLDW)",
    category: "Load / Motor",
    archetypeId: PowerWorldArchetypeId.LOAD_COMPOSITE,
    description:
      "WECC composite load model representing feeder impedance, 3-phase motors A/B/C, single-phase A/C motor D, electronic, and static ZIP load.",
    provenance: "WECC Load Modeling Task Force / NERC — Composite Load Model (CMPLDW)",
    params: LOAD_COMPOSITE_PARAMS,
  },
  {
    modelType: "CLODBL",
    aliases: ["clodbl", "clod"],
    label: "Complex Load Model (CLODBL)",
    category: "Load / Motor",
    archetypeId: PowerWorldArchetypeId.LOAD_COMPOSITE,
    description:
      "Aggregated complex dynamic load with large/small induction motors, discharge lighting, and constant-power fractions.",
    provenance: "IEEE Task Force on Load Representation — Complex Load Model (CLOD)",
    params: LOAD_COMPOSITE_PARAMS,
  },
  {
    modelType: "CIM5BL",
    aliases: ["cim5bl", "cim5"],
    label: "Fifth-Order Induction Motor Load Model (CIM5BL)",
    category: "Load / Motor",
    archetypeId: PowerWorldArchetypeId.LOAD_MOTOR,
    description:
      "Double-cage induction motor dynamic load model with mechanical load torque exponent and under-voltage tripping.",
    provenance: "IEEE Task Force on Load Representation — Induction Motor Model CIM5",
    params: [
      ["Ra", 0.02, "pu", "Stator resistance"],
      ["Xa", 0.08, "pu", "Stator leakage reactance"],
      ["Xm", 3.0, "pu", "Magnetizing reactance"],
      ["R1", 0.02, "pu", "Rotor resistance"],
      ["H", 0.8, "s", "Motor inertia constant"],
      ["D", 2.0, "pu", "Load torque speed exponent"],
    ],
  },
  {
    modelType: "IEEEL",
    aliases: ["ieeel"],
    label: "IEEE Static Polynomial (ZIP) + Frequency Load Model (IEEEL)",
    category: "Load / Motor",
    archetypeId: PowerWorldArchetypeId.LOAD_COMPOSITE,
    description: "IEEE static polynomial (constant Z, I, P) load model with linear frequency dependence.",
    provenance: "IEEE Task Force on Load Representation 1993 — ZIP Load Model",
    params: [
      ["a1", 0.3, "pu", "Constant-impedance active power fraction"],
      ["a2", 0.3, "pu", "Constant-current active power fraction"],
      ["a3", 0.4, "pu", "Constant-power active power fraction"],
      ["a4", 0.3, "pu", "Constant-impedance reactive power fraction"],
      ["a5", 0.3, "pu", "Constant-current reactive power fraction"],
      ["a6", 0.4, "pu", "Constant-power reactive power fraction"],
      ["a7", 1.0, "pu", "Active power frequency sensitivity"],
      ["a8", -1.0, "pu", "Reactive power frequency sensitivity"],
    ],
  },

  // === FACTS / HVDC / Protection & Limiters (6) ===
  {
    modelType: "SVSMO1",
    aliases: ["svsmo1"],
    label: "WECC Static Var System / SVC Model (SVSMO1)",
    category: "FACTS / HVDC",
    archetypeId: PowerWorldArchetypeId.FACTS_SVC,
    description: "WECC Static Var Compensator (SVC) with voltage regulator, droop slope, and thyristor firing delay.",
    provenance: "IEEE / CIGRE / WECC SVC Modeling Specification (SVSMO1)",
    params: [
      ["Ksvc", 100.0, "pu", "Voltage regulator gain"],
      ["Tsvc", 0.05, "s", "Thyristor/regulator lag time constant"],
      ["Bmax", 1.0, "pu", "Maximum capacitive susceptance"],
      ["Bmin", -1.0, "pu", "Maximum inductive susceptance"],
      ["Xs", 0.03, "pu", "Voltage regulation slope reactance"],
    ],
  },
  {
    modelType: "CDC4T",
    aliases: ["cdc4t"],
    label: "Two-Terminal LCC HVDC Link Model (CDC4T)",
    category: "FACTS / HVDC",
    archetypeId: PowerWorldArchetypeId.HVDC,
    description: "CIGRE / IEEE two-terminal Line-Commutated Converter HVDC link with VDCOL and power modulation.",
    provenance: "IEEE / CIGRE Working Group 14.05 — Two-Terminal HVDC Model (CDC4T)",
    params: [
      ["Kp", 50.0, "pu", "DC current controller gain"],
      ["Tp", 0.04, "s", "DC line / converter time constant"],
      ["Idmax", 1.2, "pu", "Maximum DC current"],
      ["Idmin", 0.1, "pu", "Minimum DC current"],
      ["VdcolV1", 0.4, "pu", "VDCOL lower AC voltage breakpoint"],
      ["VdcolV2", 0.85, "pu", "VDCOL upper AC voltage breakpoint"],
    ],
  },
  {
    modelType: "LDSHBL",
    aliases: ["ldshbl", "lshd1"],
    label: "Under-Frequency Load Shedding Relay (LDSHBL)",
    category: "Protection / Limiter",
    archetypeId: PowerWorldArchetypeId.RELAY_LIMITER,
    description:
      "Three-stage under-frequency load shedding relay with pickup thresholds, time delays, and breaker clearing.",
    provenance: "NERC PRC-006 / WECC UFLS Relay Specification (LDSHBL)",
    params: RELAY_UFLS_PARAMS,
  },
  {
    modelType: "LVSHBL",
    aliases: ["lvshbl", "vtrp"],
    label: "Under-Voltage Load Shedding Relay (LVSHBL)",
    category: "Protection / Limiter",
    archetypeId: PowerWorldArchetypeId.RELAY_LIMITER,
    description: "Under-voltage load shedding relay with definite-time pickup delay and breaker clearing time.",
    provenance: "NERC PRC-010 / WECC UVLS Relay Specification (LVSHBL)",
    params: [
      ["V1", 0.85, "pu", "Under-voltage pickup"],
      ["T1", 0.5, "s", "Time delay"],
      ["Frac1", 0.2, "pu", "Shed fraction"],
      ["Tb", 0.08, "s", "Breaker opening time"],
    ],
  },
  {
    modelType: "OEL1",
    aliases: ["oel1", "OEL2C"],
    label: "IEEE Over-Excitation Limiter (OEL1)",
    category: "Protection / Limiter",
    archetypeId: PowerWorldArchetypeId.RELAY_LIMITER,
    description:
      "IEEE Std 421.5 Over-Excitation Limiter protecting synchronous generator field winding against thermal overload.",
    provenance: "IEEE Std 421.5-2016 Type OEL1",
    params: [
      ["Ifdlim", 2.5, "pu", "Continuous field current limit"],
      ["Ifdmax", 3.5, "pu", "Instantaneous field current ceiling"],
      ["Toel", 10.0, "s", "Thermal time constant"],
    ],
  },
  {
    modelType: "UEL1",
    aliases: ["uel1", "UEL2C"],
    label: "IEEE Under-Excitation Limiter (UEL1)",
    category: "Protection / Limiter",
    archetypeId: PowerWorldArchetypeId.RELAY_LIMITER,
    description:
      "IEEE Std 421.5 Under-Excitation Limiter preventing steady-state stability loss and stator end-core heating.",
    provenance: "IEEE Std 421.5-2016 Type UEL1",
    params: [
      ["Kul", 10.0, "pu", "UEL proportional gain"],
      ["Tul", 0.1, "s", "UEL time constant"],
      ["Qmin", -0.4, "pu", "Minimum reactive power absorption limit"],
    ],
  },
];

/**
 * Converts `POWERWORLD_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildPowerWorldCleanroomSchemas(): CleanroomModelSchema[] {
  return POWERWORLD_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `powerworld:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "electrical",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "powerworld_dynamic_model",
      width: 80,
      height: 48,
      svg: generatePowerWorldBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
