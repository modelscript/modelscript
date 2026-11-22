// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * RTDS / RSCAD cleanroom EMT component archetype IDs matching `assets/rtds-std-lib/src/models.ts`.
 */
export const RtdsArchetypeId = {
  SOURCE_3P: 1, // rtds_3p_source
  SOURCE_DC: 2, // rtds_dc_source
  SYNC_MACH: 3, // rtds_sync_mach
  IND_MACH: 4, // rtds_ind_mach
  PMSG_MACH: 5, // rtds_pmsg_mach
  RLC_BRANCH: 10, // rtds_rlc_branch
  BERGERON_LINE: 11, // rtds_bergeron_line
  FD_LINE: 12, // rtds_fd_line
  XFMR_2W: 13, // rtds_2w_xfmr
  XFMR_3W: 14, // rtds_3w_xfmr
  SURGE_ARRESTER: 15, // rtds_surge_arrester
  BREAKER: 16, // rtds_breaker
  FAULT: 17, // rtds_fault
  VSC_2LVL: 20, // rtds_vsc_2lvl
  VSC_3LVL_NPC: 21, // rtds_vsc_3lvl_npc
  MMC_SUBSTEP: 22, // rtds_mmc_substep
  DCDC_BUCK_BOOST: 23, // rtds_dc_dc_buck_boost
  PV_ARRAY: 24, // rtds_pv_array
  BESS_PACK: 25, // rtds_bess_pack
  PI_CTRL: 30, // rtds_pi_ctrl
  LEAD_LAG: 31, // rtds_lead_lag
  PLL_SRF: 32, // rtds_pll_srf
  ABC_DQ0: 33, // rtds_abc_dq0
  DQ0_ABC: 34, // rtds_dq0_abc
  PWM_GEN: 35, // rtds_pwm_gen
  RMS_METER: 36, // rtds_rms_meter
  OC_50_51: 40, // rtds_oc_50_51
  DIST_21: 41, // rtds_dist_21
  DIFF_87: 42, // rtds_diff_87
  FREQ_81: 43, // rtds_freq_81
} as const;

export type RtdsArchetypeId = (typeof RtdsArchetypeId)[keyof typeof RtdsArchetypeId];

export interface RtdsModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category:
    | "Sources & Machines"
    | "Passive & Transmission"
    | "Power Electronics / Substep"
    | "Controls & Transforms"
    | "Protection";
  archetypeId: RtdsArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<RtdsModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
  "Sources & Machines": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "SRC" },
  "Passive & Transmission": { fill: "#1e3f2f", stroke: "#34d399", badge: "NET" },
  "Power Electronics / Substep": { fill: "#163b3b", stroke: "#2dd4bf", badge: "PE" },
  "Controls & Transforms": { fill: "#3b1f47", stroke: "#c084fc", badge: "CTL" },
  Protection: { fill: "#422006", stroke: "#fb923c", badge: "PRO" },
};

/**
 * Generates a deterministic cleanroom parametric SVG block icon for an RTDS / RSCAD Master Library model.
 */
export function generateRtdsBlockSvg(modelType: string, category: RtdsModelSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const shortName = modelType
    .replace(/^rtds_/, "")
    .toUpperCase()
    .slice(0, 10);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 48" width="88" height="48">` +
    `<rect x="2" y="2" width="84" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="24" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="18" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="34" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${shortName}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: RtdsModelSpec["category"]): DiagramPortSpec[] {
  switch (category) {
    case "Sources & Machines":
      return [
        { name: "ctrl", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "abc", kind: "electrical", side: "right", dx: 88, dy: 24 },
      ];
    case "Passive & Transmission":
      return [
        { name: "n1", kind: "electrical", side: "left", dx: 0, dy: 24 },
        { name: "n2", kind: "electrical", side: "right", dx: 88, dy: 24 },
        { name: "ctrl", kind: "signal", side: "top", dx: 44, dy: 0 },
      ];
    case "Power Electronics / Substep":
      return [
        { name: "dc", kind: "electrical", side: "left", dx: 0, dy: 24 },
        { name: "ac", kind: "electrical", side: "right", dx: 88, dy: 24 },
        { name: "gate", kind: "signal", side: "top", dx: 44, dy: 0 },
      ];
    case "Controls & Transforms":
      return [
        { name: "in", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "out", kind: "signal", side: "right", dx: 88, dy: 24 },
      ];
    case "Protection":
      return [
        { name: "meas", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "trip", kind: "signal", side: "right", dx: 88, dy: 24 },
      ];
  }
}

export const RTDS_MODEL_SPECS: RtdsModelSpec[] = [
  // ── 1. Sources & Machines ──────────────────────────────────────────────────
  {
    modelType: "rtds_3p_source",
    aliases: ["source3p", "SRC3", "rtds_sharc_sld_SRC3"],
    label: "Three-Phase AC Voltage Source",
    category: "Sources & Machines",
    archetypeId: RtdsArchetypeId.SOURCE_3P,
    description:
      "Three-phase balanced sinusoidal voltage source behind R-L Thevenin impedance for real-time EMT simulation.",
    provenance: "Dommel (1969) IEEE Trans. PAS-88(4); EMTP Theory Book Ch. 4",
    params: [
      ["vllRms", 230000.0, "V", "Line-to-line RMS voltage"],
      ["freqHz", 60.0, "Hz", "Nominal source frequency"],
      ["phaseDeg", 0.0, "deg", "Phase A initial angle"],
      ["rSrc", 0.5, "ohm", "Series Thevenin resistance"],
      ["lSrc", 0.005, "H", "Series Thevenin inductance"],
    ],
  },
  {
    modelType: "rtds_dc_source",
    aliases: ["dcsource", "DC_SRC", "rtds_sharc_sld_DCSRC"],
    label: "DC Voltage Source",
    category: "Sources & Machines",
    archetypeId: RtdsArchetypeId.SOURCE_DC,
    description: "Ideal or resistive-series DC voltage source for HVDC, BESS, and converter DC-link modeling.",
    provenance: "Dommel (1969) IEEE Trans. PAS-88(4); EMTP Theory Book Ch. 4",
    params: [
      ["vdc", 1000.0, "V", "Nominal DC voltage"],
      ["rSrc", 0.01, "ohm", "Series internal resistance"],
    ],
  },
  {
    modelType: "rtds_sync_mach",
    aliases: ["sync_mach", "SYNCMACH", "rtds_sharc_sld_SM"],
    label: "Synchronous Machine (dq0 EMT)",
    category: "Sources & Machines",
    archetypeId: RtdsArchetypeId.SYNC_MACH,
    description:
      "Cleanroom Park dq0 synchronous generator with swing dynamics and transient emf for real-time EMT studies.",
    provenance: "IEEE Std 1110-2019; Kundur (1994) Power System Stability and Control Ch. 3",
    params: [
      ["sBase", 100e6, "VA", "Rated apparent power"],
      ["vBase", 20000.0, "V", "Rated line-to-line RMS voltage"],
      ["freqHz", 60.0, "Hz", "Nominal frequency"],
      ["h", 4.0, "s", "Inertia constant H"],
      ["d", 1.5, "pu", "Damping coefficient D"],
      ["xdp", 0.3, "pu", "d-axis transient reactance"],
      ["tpdo", 6.5, "s", "d-axis transient open-circuit time constant"],
    ],
  },
  {
    modelType: "rtds_ind_mach",
    aliases: ["ind_mach", "INDMACH", "rtds_sharc_sld_IM"],
    label: "Induction Machine (Squirrel-Cage / Wound)",
    category: "Sources & Machines",
    archetypeId: RtdsArchetypeId.IND_MACH,
    description: "Cleanroom dq0 induction machine model with slip dynamics and electromagnetic torque calculation.",
    provenance: "Krause et al. (2013) Analysis of Electric Machinery and Drive Systems Ch. 4; IEEE Std 112",
    params: [
      ["sBase", 5e6, "VA", "Rated apparent power"],
      ["vBase", 4160.0, "V", "Rated line-to-line RMS voltage"],
      ["freqHz", 60.0, "Hz", "Nominal stator frequency"],
      ["h", 1.2, "s", "Rotor inertia constant H"],
      ["rs", 0.02, "pu", "Stator resistance"],
      ["rr", 0.015, "pu", "Rotor resistance"],
      ["xEq", 0.18, "pu", "Equivalent locked-rotor reactance"],
    ],
  },
  {
    modelType: "rtds_pmsg_mach",
    aliases: ["pmsg", "PMSG", "rtds_sharc_sld_PMSG"],
    label: "Permanent Magnet Synchronous Generator",
    category: "Sources & Machines",
    archetypeId: RtdsArchetypeId.PMSG_MACH,
    description: "Cleanroom dq0 permanent magnet synchronous generator for Type-4 wind and hydro-turbine EMT models.",
    provenance: "Krause et al. (2013) Ch. 6; IEC 61400-27-1 Wind Turbine Electrical Simulation Models",
    params: [
      ["pRated", 3e6, "W", "Rated active power"],
      ["freqHz", 60.0, "Hz", "Nominal electrical frequency"],
      ["psiPm", 1.0, "pu", "Permanent magnet flux linkage"],
      ["ld", 0.35, "pu", "d-axis synchronous inductance"],
      ["lq", 0.35, "pu", "q-axis synchronous inductance"],
      ["h", 3.5, "s", "Shaft inertia constant H"],
    ],
  },

  // ── 2. Passive & Transmission ──────────────────────────────────────────────
  {
    modelType: "rtds_rlc_branch",
    aliases: ["rlc", "RLC", "rtds_sharc_sld_RLC"],
    label: "Dommel Trapezoidal RLC Branch",
    category: "Passive & Transmission",
    archetypeId: RtdsArchetypeId.RLC_BRANCH,
    description:
      "Series R-L-C branch discretized via Dommel trapezoidal companion-circuit conductance and history current source.",
    provenance: "Dommel (1969) IEEE Trans. PAS-88(4) pp. 388-399; EMTP Theory Book Ch. 1",
    params: [
      ["r", 1.0, "ohm", "Series resistance"],
      ["l", 0.01, "H", "Series inductance"],
      ["c", 0.0, "F", "Series capacitance (0 = omitted)"],
    ],
  },
  {
    modelType: "rtds_bergeron_line",
    aliases: ["bergeron", "tline", "rtds_sharc_sld_TLINE"],
    label: "Bergeron Travelling-Wave Line",
    category: "Passive & Transmission",
    archetypeId: RtdsArchetypeId.BERGERON_LINE,
    description:
      "Distributed-parameter constant-frequency Bergeron travelling-wave transmission line with lossless surge impedance and lumped R/4 loss compensation.",
    provenance: "Dommel (1969) IEEE Trans. PAS-88(4) Sec. III; EMTP Theory Book Ch. 4",
    params: [
      ["zc", 300.0, "ohm", "Characteristic surge impedance"],
      ["tau", 500e-6, "s", "One-way wave propagation travel time"],
      ["rTotal", 2.0, "ohm", "Total series line resistance"],
    ],
  },
  {
    modelType: "rtds_fd_line",
    aliases: ["fdline", "FDLINE", "rtds_sharc_sld_FDLINE"],
    label: "Frequency-Dependent Phase-Domain Line",
    category: "Passive & Transmission",
    archetypeId: RtdsArchetypeId.FD_LINE,
    description:
      "Universal Line Model (ULM) / Marti frequency-dependent travelling-wave line with rational damping filter approximation.",
    provenance: "Morched, Gustavsen & Tartibi (1999) IEEE Trans. PWRD-14(3); Marti (1982) IEEE Trans. PAS-101(1)",
    params: [
      ["zc", 280.0, "ohm", "High-frequency surge impedance"],
      ["tau", 400e-6, "s", "Modal propagation travel time"],
      ["rDc", 1.5, "ohm", "DC series resistance"],
      ["alphaDamp", 0.02, "1", "High-frequency attenuation factor"],
    ],
  },
  {
    modelType: "rtds_2w_xfmr",
    aliases: ["xfmr2w", "XFMR2W", "rtds_sharc_sld_XFMR2W"],
    label: "Two-Winding Power Transformer",
    category: "Passive & Transmission",
    archetypeId: RtdsArchetypeId.XFMR_2W,
    description: "Two-winding transformer with turns ratio, leakage R-L companion circuit, and magnetizing branch.",
    provenance: "Dommel (1986) EMTP Theory Book Ch. 6; IEEE Std C57.12.00",
    params: [
      ["turnsRatio", 1.0, "1", "Primary-to-secondary turns ratio N1/N2"],
      ["rLeak", 0.5, "ohm", "Referred winding leakage resistance"],
      ["lLeak", 0.015, "H", "Referred winding leakage inductance"],
      ["lMag", 5.0, "H", "Magnetizing inductance"],
    ],
  },
  {
    modelType: "rtds_3w_xfmr",
    aliases: ["xfmr3w", "XFMR3W", "rtds_sharc_sld_XFMR3W"],
    label: "Three-Winding Power Transformer",
    category: "Passive & Transmission",
    archetypeId: RtdsArchetypeId.XFMR_3W,
    description: "Three-winding star-equivalent transformer with primary, secondary, and tertiary leakage impedances.",
    provenance: "Dommel (1986) EMTP Theory Book Ch. 6; IEEE Std C57.12.00",
    params: [
      ["n12", 1.0, "1", "Primary-to-secondary turns ratio"],
      ["n13", 1.0, "1", "Primary-to-tertiary turns ratio"],
      ["rLeak", 0.6, "ohm", "Equivalent winding leakage resistance"],
      ["lLeak", 0.018, "H", "Equivalent winding leakage inductance"],
    ],
  },
  {
    modelType: "rtds_surge_arrester",
    aliases: ["arrester", "MOV", "rtds_sharc_sld_ARRESTER"],
    label: "ZnO Metal-Oxide Surge Arrester (MOV)",
    category: "Passive & Transmission",
    archetypeId: RtdsArchetypeId.SURGE_ARRESTER,
    description:
      "Nonlinear ZnO surge arrester modeled by exponential V-I characteristic I = I_ref * (|V| / V_ref)^alpha.",
    provenance: "IEEE Working Group 3.4.11 (1992) IEEE Trans. PWRD-7(1); IEC 60099-4",
    params: [
      ["vRef", 250000.0, "V", "Reference clamping voltage"],
      ["iRef", 1000.0, "A", "Reference discharge current"],
      ["alpha", 20.0, "1", "Nonlinear exponent"],
    ],
  },
  {
    modelType: "rtds_breaker",
    aliases: ["breaker", "BRK", "rtds_sharc_sld_BRK"],
    label: "Three-Phase Circuit Breaker",
    category: "Passive & Transmission",
    archetypeId: RtdsArchetypeId.BREAKER,
    description:
      "Controlled circuit breaker switching between low on-resistance and high off-resistance with zero-crossing current interruption.",
    provenance: "Dommel (1969) IEEE Trans. PAS-88(4); IEEE Std C37.04",
    params: [
      ["rOn", 0.001, "ohm", "Closed contact resistance"],
      ["rOff", 1e6, "ohm", "Open contact resistance"],
      ["initClosed", 1.0, "1", "Initial state (1 = closed, 0 = open)"],
    ],
  },
  {
    modelType: "rtds_fault",
    aliases: ["fault", "FLT", "rtds_sharc_sld_FAULT"],
    label: "Controlled Shunt Fault Switch",
    category: "Passive & Transmission",
    archetypeId: RtdsArchetypeId.FAULT,
    description:
      "Timed shunt fault resistance switch for single-line-to-ground, line-to-line, and three-phase fault studies.",
    provenance: "EMTP Theory Book Ch. 4; IEEE Std C37.010",
    params: [
      ["rFault", 0.01, "ohm", "Fault impedance resistance"],
      ["rOff", 1e6, "ohm", "Cleared impedance resistance"],
      ["tOn", 0.1, "s", "Fault inception time"],
      ["tOff", 0.2, "s", "Fault clearing time"],
    ],
  },

  // ── 3. Power Electronics / Substep ─────────────────────────────────────────
  {
    modelType: "rtds_vsc_2lvl",
    aliases: ["vsc2lvl", "VSC2L", "rtds_vsc_2l"],
    label: "Two-Level Voltage Source Converter",
    category: "Power Electronics / Substep",
    archetypeId: RtdsArchetypeId.VSC_2LVL,
    description:
      "Two-level VSC average-value and substep switching companion model with AC L-R filter and DC-link power balance.",
    provenance: "Yazdani & Iravani (2010) Voltage-Sourced Converters in Power Systems Ch. 4; CIGRE TB 604",
    params: [
      ["vdcNom", 1200.0, "V", "Nominal DC-link voltage"],
      ["rFilter", 0.05, "ohm", "AC filter resistance"],
      ["lFilter", 0.002, "H", "AC filter inductance"],
      ["fSw", 5000.0, "Hz", "Carrier switching frequency"],
    ],
  },
  {
    modelType: "rtds_vsc_3lvl_npc",
    aliases: ["vsc3lvl", "NPC3L", "rtds_vsc_3l"],
    label: "Three-Level NPC Converter",
    category: "Power Electronics / Substep",
    archetypeId: RtdsArchetypeId.VSC_3LVL_NPC,
    description:
      "Three-level Neutral-Point-Clamped (NPC) VSC with split DC-link capacitor balance and AC filter companion circuit.",
    provenance: "Nabae, Takahashi & Akagi (1981) IEEE Trans. IA-17(5); Yazdani & Iravani (2010) Ch. 11",
    params: [
      ["vdcNom", 3000.0, "V", "Nominal total DC-link voltage"],
      ["rFilter", 0.04, "ohm", "AC filter resistance"],
      ["lFilter", 0.003, "H", "AC filter inductance"],
      ["cDc", 0.01, "F", "Half-bridge DC-link capacitance"],
    ],
  },
  {
    modelType: "rtds_mmc_substep",
    aliases: ["mmc", "MMC", "rtds_mmc"],
    label: "Modular Multilevel Converter (Substep)",
    category: "Power Electronics / Substep",
    archetypeId: RtdsArchetypeId.MMC_SUBSTEP,
    description:
      "Thevenin-equivalent arm model for half-bridge/full-bridge Modular Multilevel Converter (MMC) HVDC substep simulation.",
    provenance: "Gnanarathna, Gole & Jayasinghe (2011) IEEE Trans. PWRD-26(1); CIGRE TB 604",
    params: [
      ["vdcNom", 640000.0, "V", "Pole-to-pole DC voltage"],
      ["nSubmodules", 400.0, "1", "Submodules per arm"],
      ["rArm", 1.2, "ohm", "Arm equivalent resistance"],
      ["lArm", 0.05, "H", "Arm reactor inductance"],
      ["cSm", 0.01, "F", "Submodule capacitance"],
    ],
  },
  {
    modelType: "rtds_dc_dc_buck_boost",
    aliases: ["buck_boost", "DCDC", "rtds_dcdc"],
    label: "Bidirectional DC-DC Buck/Boost Converter",
    category: "Power Electronics / Substep",
    archetypeId: RtdsArchetypeId.DCDC_BUCK_BOOST,
    description:
      "Average-value bidirectional DC-DC buck/boost converter with inductor current dynamics and duty-ratio control.",
    provenance: "Erickson & Maksimovic (2020) Fundamentals of Power Electronics Ch. 7",
    params: [
      ["vdcHigh", 1000.0, "V", "High-side DC bus voltage"],
      ["lInd", 0.002, "H", "DC inductor inductance"],
      ["rInd", 0.02, "ohm", "DC inductor ESR"],
      ["dutyInit", 0.5, "1", "Initial duty ratio"],
    ],
  },
  {
    modelType: "rtds_pv_array",
    aliases: ["pv_array", "PV", "rtds_pv"],
    label: "Photovoltaic Array (Single-Diode EMT)",
    category: "Power Electronics / Substep",
    archetypeId: RtdsArchetypeId.PV_ARRAY,
    description:
      "Cleanroom single-diode photovoltaic array I-V model parameterized by irradiance, cell temperature, Voc, and Isc.",
    provenance: "Villalva, Gazoli & Filho (2009) IEEE Trans. PE-24(5); IEC 61853",
    params: [
      ["vOc", 850.0, "V", "Open-circuit string voltage at STC"],
      ["iSc", 500.0, "A", "Short-circuit array current at STC"],
      ["irradiance", 1000.0, "W/m2", "Plane-of-array irradiance"],
      ["tempC", 25.0, "degC", "Cell temperature"],
    ],
  },
  {
    modelType: "rtds_bess_pack",
    aliases: ["bess", "BESS", "rtds_bess"],
    label: "Battery Energy Storage Pack (Thevenin)",
    category: "Power Electronics / Substep",
    archetypeId: RtdsArchetypeId.BESS_PACK,
    description:
      "Lithium-ion BESS pack modeled with State-of-Charge (SoC) coulomb counting, open-circuit voltage curve, and internal resistance.",
    provenance: "Tremblay & Dessaint (2009) World Electric Vehicle Journal 3(2); IEEE Std 2030.2",
    params: [
      ["vNom", 1000.0, "V", "Nominal DC pack voltage"],
      ["capAh", 2000.0, "Ah", "Pack capacity in Ampere-hours"],
      ["rInt", 0.015, "ohm", "Pack internal series resistance"],
      ["socInit", 0.5, "1", "Initial State of Charge (0..1)"],
    ],
  },

  // ── 4. Controls & Transforms ───────────────────────────────────────────────
  {
    modelType: "rtds_pi_ctrl",
    aliases: ["pi_ctrl", "PI", "rtds_ctrl_PI"],
    label: "PI Controller with Anti-Windup",
    category: "Controls & Transforms",
    archetypeId: RtdsArchetypeId.PI_CTRL,
    description: "Trapezoidal-discretized Proportional-Integral controller with clamping anti-windup limits.",
    provenance: "Franklin, Powell & Emami-Naeini (2019) Feedback Control of Dynamic Systems Ch. 4",
    params: [
      ["kp", 1.0, "1", "Proportional gain"],
      ["ki", 10.0, "1/s", "Integral gain"],
      ["yMin", -1.0, "1", "Lower output saturation limit"],
      ["yMax", 1.0, "1", "Upper output saturation limit"],
    ],
  },
  {
    modelType: "rtds_lead_lag",
    aliases: ["lead_lag", "LEADLAG", "rtds_ctrl_LL"],
    label: "First-Order Lead-Lag Compensator",
    category: "Controls & Transforms",
    archetypeId: RtdsArchetypeId.LEAD_LAG,
    description: "First-order lead-lag filter K*(1 + s*T1)/(1 + s*T2) discretized via Tustin bilinear transformation.",
    provenance: "IEEE Std 421.5-2016; Franklin et al. (2019) Feedback Control of Dynamic Systems",
    params: [
      ["gain", 1.0, "1", "DC gain K"],
      ["tLead", 0.1, "s", "Lead time constant T1"],
      ["tLag", 0.02, "s", "Lag time constant T2"],
    ],
  },
  {
    modelType: "rtds_pll_srf",
    aliases: ["pll", "SRF_PLL", "rtds_ctrl_PLL"],
    label: "Synchronous Reference Frame PLL",
    category: "Controls & Transforms",
    archetypeId: RtdsArchetypeId.PLL_SRF,
    description:
      "Three-phase Synchronous Reference Frame Phase-Locked Loop (SRF-PLL) tracking grid phase angle and frequency.",
    provenance: "Chung (2000) IEEE Trans. PE-15(3) pp. 431-438; Teodorescu et al. (2011) Grid Converters",
    params: [
      ["freqNom", 60.0, "Hz", "Nominal grid frequency"],
      ["kp", 120.0, "rad/(s*pu)", "PLL loop filter proportional gain"],
      ["ki", 3600.0, "rad/(s^2*pu)", "PLL loop filter integral gain"],
      ["vNom", 1.0, "V", "Nominal peak phase voltage for normalization"],
    ],
  },
  {
    modelType: "rtds_abc_dq0",
    aliases: ["abc_dq0", "PARK", "rtds_ctrl_ABC2DQ0"],
    label: "Park Transform (abc to dq0)",
    category: "Controls & Transforms",
    archetypeId: RtdsArchetypeId.ABC_DQ0,
    description: "Amplitude-invariant three-phase Park transformation from stationary abc frame to rotating dq0 frame.",
    provenance: "Park (1929) Trans. AIEE 48(3) pp. 716-727; IEEE Std 1110-2019",
    params: [["thetaOffset", 0.0, "rad", "Optional reference frame phase offset"]],
  },
  {
    modelType: "rtds_dq0_abc",
    aliases: ["dq0_abc", "INV_PARK", "rtds_ctrl_DQ02ABC"],
    label: "Inverse Park Transform (dq0 to abc)",
    category: "Controls & Transforms",
    archetypeId: RtdsArchetypeId.DQ0_ABC,
    description:
      "Amplitude-invariant inverse Park transformation from rotating dq0 frame back to stationary abc frame.",
    provenance: "Park (1929) Trans. AIEE 48(3) pp. 716-727; IEEE Std 1110-2019",
    params: [["thetaOffset", 0.0, "rad", "Optional reference frame phase offset"]],
  },
  {
    modelType: "rtds_pwm_gen",
    aliases: ["pwm", "PWM", "rtds_ctrl_PWM"],
    label: "Triangular Carrier PWM Generator",
    category: "Controls & Transforms",
    archetypeId: RtdsArchetypeId.PWM_GEN,
    description:
      "Sinusoidal pulse-width modulation (SPWM) comparator comparing reference modulation signal against triangular carrier.",
    provenance: "Holmes & Lipo (2003) Pulse Width Modulation for Power Converters Ch. 3",
    params: [
      ["fCarrier", 2000.0, "Hz", "Triangular carrier frequency"],
      ["vCarrier", 1.0, "1", "Carrier peak amplitude"],
    ],
  },
  {
    modelType: "rtds_rms_meter",
    aliases: ["rms_meter", "RMS", "rtds_meas_RMS"],
    label: "Sliding-Window True RMS Meter",
    category: "Controls & Transforms",
    archetypeId: RtdsArchetypeId.RMS_METER,
    description: "Exponentially smoothed / one-cycle sliding-window true RMS voltage or current measurement meter.",
    provenance: "IEEE Std 1459-2010 Definitions for the Measurement of Electric Power Quantities",
    params: [
      ["freqNom", 60.0, "Hz", "Nominal fundamental frequency"],
      ["tauFilter", 0.016667, "s", "RMS averaging window time constant"],
    ],
  },

  // ── 5. Protection ──────────────────────────────────────────────────────────
  {
    modelType: "rtds_oc_50_51",
    aliases: ["oc_50_51", "RELAY_50_51", "rtds_prot_50_51"],
    label: "Instantaneous & Time Overcurrent Relay (50/51)",
    category: "Protection",
    archetypeId: RtdsArchetypeId.OC_50_51,
    description: "IEEE C37.112 very-inverse time-overcurrent (51) and instantaneous overcurrent (50) protection relay.",
    provenance: "IEEE Std C37.112-2018 Inverse-Time Characteristic Equations for Overcurrent Relays",
    params: [
      ["iPickup", 1.2, "pu", "51 time-overcurrent pickup current"],
      ["tds", 0.5, "1", "Time dial setting (TDS)"],
      ["iInst", 5.0, "pu", "50 instantaneous pickup current"],
      ["curveA", 19.61, "s", "IEEE C37.112 curve constant A (Very Inverse)"],
      ["curveB", 0.491, "s", "IEEE C37.112 curve constant B (Very Inverse)"],
      ["curveP", 2.0, "1", "IEEE C37.112 curve exponent p (Very Inverse)"],
    ],
  },
  {
    modelType: "rtds_dist_21",
    aliases: ["dist_21", "RELAY_21", "rtds_prot_21"],
    label: "Mho Distance Protection Relay (21)",
    category: "Protection",
    archetypeId: RtdsArchetypeId.DIST_21,
    description: "Apparent impedance Zone-1/Zone-2 mho distance relay element comparing |V/I| against reach setting.",
    provenance: "IEEE Std C37.113-2015 Guide for Protective Relay Applications to Transmission Lines",
    params: [
      ["zReach", 10.0, "ohm", "Zone-1 impedance reach magnitude"],
      ["tDelay", 0.02, "s", "Zone-1 operating time delay"],
    ],
  },
  {
    modelType: "rtds_diff_87",
    aliases: ["diff_87", "RELAY_87", "rtds_prot_87"],
    label: "Percentage Differential Relay (87)",
    category: "Protection",
    archetypeId: RtdsArchetypeId.DIFF_87,
    description:
      "Dual-terminal percentage-restrained differential protection relay comparing |I1 + I2| against slope * 0.5*(|I1| + |I2|).",
    provenance: "IEEE Std C37.91-2021 Guide for Protecting Power Transformers",
    params: [
      ["iPickup", 0.3, "pu", "Minimum differential pickup current"],
      ["slope", 0.25, "1", "Restraint characteristic slope"],
      ["tDelay", 0.01, "s", "Operating confirmation delay"],
    ],
  },
  {
    modelType: "rtds_freq_81",
    aliases: ["freq_81", "RELAY_81", "rtds_prot_81"],
    label: "Under/Over Frequency Relay (81U/81O)",
    category: "Protection",
    archetypeId: RtdsArchetypeId.FREQ_81,
    description:
      "Definite-time under-frequency (81U) and over-frequency (81O) protection relay for load shedding and generator tripping.",
    provenance: "IEEE Std C37.106-2003 Guide for Abnormal Frequency Protection; NERC PRC-006",
    params: [
      ["fLow", 59.3, "Hz", "Under-frequency pickup threshold (81U)"],
      ["fHigh", 60.7, "Hz", "Over-frequency pickup threshold (81O)"],
      ["tDelay", 0.1, "s", "Definite-time trip delay"],
    ],
  },
];

/**
 * Converts `RTDS_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildRtdsCleanroomSchemas(): CleanroomModelSchema[] {
  return RTDS_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `rtds:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "electrical",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "rtds_emt_component",
      width: 88,
      height: 48,
      svg: generateRtdsBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
