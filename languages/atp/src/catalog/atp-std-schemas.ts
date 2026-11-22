// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CleanroomModelSchema, CleanroomParameterSchema, DiagramPortSpec } from "@modelscript/runtime";

/**
 * EMTP-ATP / ATPDraw cleanroom model archetype IDs matching `assets/atp-std-lib/src/models.ts`.
 */
export const AtpArchetypeId = {
  // Linear & Distributed Branches
  BRANCH_RLC_00: 1,
  LINE_PI_01: 2,
  LINE_BERGERON_M1: 3,
  LINE_JMARTI_FD: 4,
  LINE_SEMLYEN_FD: 5,
  XFMR_SATURABLE: 6,
  XFMR_BCTRAN: 7,

  // Nonlinear & Switching
  NONLIN_IND_98: 10,
  NONLIN_HYST_96: 11,
  MOV_ARRESTER_92: 12,
  SWITCH_TIME_00: 13,
  SWITCH_STAT_04: 14,
  SWITCH_DIODE_11: 15,
  SWITCH_THYRISTOR_11: 16,
  SWITCH_TACS_13: 17,

  // Sources & Machines
  SRC_AC_14: 20,
  SRC_IMPULSE_15: 21,
  SRC_DC_11: 22,
  MACH_SYNC_59: 23,
  MACH_UNIVERSAL_19: 24,

  // TACS & MODELS Control Blocks
  TACS_TF_S: 30,
  TACS_INTEGRATOR: 31,
  TACS_LIMITER: 32,
  TACS_DELAY: 33,
  TACS_LOGIC: 34,
  MODELS_USER: 35,
} as const;

export type AtpArchetypeId = (typeof AtpArchetypeId)[keyof typeof AtpArchetypeId];

export interface AtpModelSpec {
  modelType: string;
  aliases?: string[];
  label: string;
  category: "Linear & Distributed Branch" | "Nonlinear & Switching" | "Source & Machine" | "TACS & MODELS Control";
  archetypeId: AtpArchetypeId;
  description: string;
  provenance: string;
  params: Array<[key: string, defaultValue: number, unit?: string, description?: string]>;
}

const CATEGORY_COLORS: Record<AtpModelSpec["category"], { fill: string; stroke: string; badge: string }> = {
  "Linear & Distributed Branch": { fill: "#1e3a5f", stroke: "#60a5fa", badge: "BRN" },
  "Nonlinear & Switching": { fill: "#422006", stroke: "#fb923c", badge: "NLIN" },
  "Source & Machine": { fill: "#1e3f2f", stroke: "#34d399", badge: "SRC" },
  "TACS & MODELS Control": { fill: "#3b1f47", stroke: "#c084fc", badge: "TACS" },
};

/**
 * Generates a deterministic cleanroom SVG block icon for an EMTP-ATP / ATPDraw component.
 */
export function generateAtpBlockSvg(modelType: string, category: AtpModelSpec["category"]): string {
  const c = CATEGORY_COLORS[category];
  const label = modelType.toUpperCase().slice(0, 10);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 48" width="88" height="48">` +
    `<rect x="2" y="2" width="84" height="44" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>` +
    `<rect x="6" y="6" width="28" height="12" rx="3" fill="${c.stroke}" fill-opacity="0.22"/>` +
    `<text x="20" y="15" text-anchor="middle" font-family="monospace" font-size="7.5" fill="${c.stroke}">${c.badge}</text>` +
    `<text x="44" y="34" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="bold" fill="#f8fafc">${label}</text>` +
    `</svg>`
  );
}

function defaultPortsForCategory(category: AtpModelSpec["category"], archetypeId: AtpArchetypeId): DiagramPortSpec[] {
  if (category === "TACS & MODELS Control") {
    return [
      { name: "in", kind: "signal", side: "left", dx: 0, dy: 24 },
      { name: "out", kind: "signal", side: "right", dx: 88, dy: 24 },
    ];
  }
  if (category === "Source & Machine") {
    if (archetypeId === AtpArchetypeId.MACH_SYNC_59 || archetypeId === AtpArchetypeId.MACH_UNIVERSAL_19) {
      return [
        { name: "ctrl", kind: "signal", side: "left", dx: 0, dy: 24 },
        { name: "bus", kind: "electrical", side: "right", dx: 88, dy: 24 },
      ];
    }
    return [
      { name: "gnd", kind: "electrical", side: "left", dx: 0, dy: 24 },
      { name: "bus", kind: "electrical", side: "right", dx: 88, dy: 24 },
    ];
  }
  if (archetypeId === AtpArchetypeId.SWITCH_TACS_13 || archetypeId === AtpArchetypeId.SWITCH_THYRISTOR_11) {
    return [
      { name: "node1", kind: "electrical", side: "left", dx: 0, dy: 24 },
      { name: "node2", kind: "electrical", side: "right", dx: 88, dy: 24 },
      { name: "gate", kind: "signal", side: "top", dx: 44, dy: 0 },
    ];
  }
  return [
    { name: "node1", kind: "electrical", side: "left", dx: 0, dy: 24 },
    { name: "node2", kind: "electrical", side: "right", dx: 88, dy: 24 },
  ];
}

export const ATP_MODEL_SPECS: AtpModelSpec[] = [
  // =========================================================================
  // 1. Linear & Distributed Branches
  // =========================================================================
  {
    modelType: "BRANCH_RLC_00",
    aliases: ["RLC", "BRANCH00", "TYPE00", "RLC_SERIES"],
    label: "Lumped Series RLC Branch (Type 00)",
    category: "Linear & Distributed Branch",
    archetypeId: AtpArchetypeId.BRANCH_RLC_00,
    description:
      "Lumped series resistance, inductance, and capacitance branch discretized with Dommel trapezoidal companion conductance and history current source.",
    provenance: "Dommel, H.W., EMTP Theory Book (1986), Ch. 1–2; IEEE Trans. PAS-88 (1969)",
    params: [
      ["rOhms", 1.0, "Ohm", "Series resistance R"],
      ["lMh", 10.0, "mH", "Series inductance L"],
      ["cUf", 0.0, "uF", "Series capacitance C (0 = omitted)"],
    ],
  },
  {
    modelType: "LINE_PI_01",
    aliases: ["PI", "LINE_PI", "TYPE01", "TYPE02", "TYPE03"],
    label: "Nominal Pi-Equivalent Line (Type 01/02/03)",
    category: "Linear & Distributed Branch",
    archetypeId: AtpArchetypeId.LINE_PI_01,
    description:
      "Coupled or single-phase nominal Pi-section transmission line with lumped series RL and half-shunt capacitances at both terminals.",
    provenance: "Dommel, H.W., EMTP Theory Book (1986), Ch. 4 (Pi-Equivalents)",
    params: [
      ["rOhms", 2.5, "Ohm", "Total series resistance R"],
      ["lMh", 25.0, "mH", "Total series inductance L"],
      ["cUf", 1.2, "uF", "Total shunt capacitance C (split C/2 per end)"],
    ],
  },
  {
    modelType: "LINE_BERGERON_M1",
    aliases: ["BERGERON", "LINE_M1", "TYPE_M1", "CLARK_LINE"],
    label: "Bergeron Distributed Line (Type -1/-2/-3)",
    category: "Linear & Distributed Branch",
    archetypeId: AtpArchetypeId.LINE_BERGERON_M1,
    description:
      "Constant-parameter travelling-wave distributed transmission line using Bergeron method of characteristics with ring delay buffer and lumped series loss.",
    provenance: "Dommel, H.W., EMTP Theory Book (1986), Ch. 4; IEEE Trans. PAS-88(4), pp. 388–399 (1969)",
    params: [
      ["zcOhms", 400.0, "Ohm", "Surge (characteristic) impedance Zc"],
      ["tauSec", 0.0005, "s", "One-way travelling-wave propagation delay tau"],
      ["rTotalOhms", 0.0, "Ohm", "Total series resistance lumped at ends and midpoint"],
    ],
  },
  {
    modelType: "LINE_JMARTI_FD",
    aliases: ["JMARTI", "J_MARTI", "FD_LINE", "LINE_FD"],
    label: "J. Marti Frequency-Dependent Line",
    category: "Linear & Distributed Branch",
    archetypeId: AtpArchetypeId.LINE_JMARTI_FD,
    description:
      "Frequency-dependent transmission line model approximating propagation function and characteristic impedance with rational weighting functions.",
    provenance: "Marti, J.R., IEEE Trans. PAS-101(1), pp. 147–157 (1982); Dommel EMTP Theory Book Ch. 4",
    params: [
      ["zcOhms", 380.0, "Ohm", "High-frequency asymptotic surge impedance Zc"],
      ["tauSec", 0.0005, "s", "Modal propagation delay tau"],
      ["rDcOhms", 1.5, "Ohm", "DC series resistance"],
      ["tauAttenSec", 0.00005, "s", "High-frequency attenuation filter time constant"],
    ],
  },
  {
    modelType: "LINE_SEMLYEN_FD",
    aliases: ["SEMLYEN", "SEMLYEN_LINE"],
    label: "Semlyen Frequency-Dependent Line",
    category: "Linear & Distributed Branch",
    archetypeId: AtpArchetypeId.LINE_SEMLYEN_FD,
    description:
      "Recursive convolution frequency-dependent transmission line model using two-exponential step response fitting.",
    provenance: "Semlyen, A. & Dabuleanu, A., IEEE Trans. PAS-94(2), pp. 561–571 (1975)",
    params: [
      ["zcOhms", 385.0, "Ohm", "Asymptotic surge impedance Zc"],
      ["tauSec", 0.0005, "s", "Modal propagation delay tau"],
      ["rDcOhms", 1.8, "Ohm", "DC series resistance"],
      ["tauAttenSec", 0.00004, "s", "Recursive convolution attenuation time constant"],
    ],
  },
  {
    modelType: "XFMR_SATURABLE",
    aliases: ["TRANSFORMER", "SAT_XFMR", "XFMR_SAT"],
    label: "Saturable Transformer Component",
    category: "Linear & Distributed Branch",
    archetypeId: AtpArchetypeId.XFMR_SATURABLE,
    description:
      "Single- or multi-winding saturable power transformer with winding leakage impedance, turns ratio, and nonlinear magnetizing branch.",
    provenance: "Dommel, H.W., EMTP Theory Book (1986), Ch. 6 (Transformers)",
    params: [
      ["turnsRatio", 1.0, "pu", "Primary-to-secondary turns ratio N1/N2"],
      ["rLeakOhms", 0.5, "Ohm", "Equivalent winding leakage resistance"],
      ["lLeakMh", 15.0, "mH", "Equivalent winding leakage inductance"],
      ["lMagH", 50.0, "H", "Unsaturated magnetizing inductance"],
      ["fluxKneeWb", 2.0, "Wb", "Core saturation knee flux linkage"],
    ],
  },
  {
    modelType: "XFMR_BCTRAN",
    aliases: ["BCTRAN", "XFMR_MATRIX"],
    label: "BCTRAN Matrix Transformer",
    category: "Linear & Distributed Branch",
    archetypeId: AtpArchetypeId.XFMR_BCTRAN,
    description:
      "Multi-winding linear/externally-saturable transformer represented by coupled [R] and [L] branch matrices derived from short-circuit and open-circuit tests.",
    provenance: "Brandwajn, V., Dommel, H.W., & Dommel, I.I., IEEE Trans. PAS-101(6), pp. 1331–1339 (1982)",
    params: [
      ["turnsRatio", 1.0, "pu", "Primary-to-secondary voltage ratio V1/V2"],
      ["rLeakOhms", 0.4, "Ohm", "Short-circuit test resistance"],
      ["lLeakMh", 12.0, "mH", "Short-circuit test inductance"],
      ["lMagH", 80.0, "H", "Excitation branch inductance"],
      ["fluxKneeWb", 2.5, "Wb", "External core saturation knee flux"],
    ],
  },

  // =========================================================================
  // 2. Nonlinear & Switching
  // =========================================================================
  {
    modelType: "NONLIN_IND_98",
    aliases: ["TYPE98", "IND_98", "SAT_IND", "NONLIN98"],
    label: "Pseudo-Nonlinear Saturable Inductor (Type 98)",
    category: "Nonlinear & Switching",
    archetypeId: AtpArchetypeId.NONLIN_IND_98,
    description:
      "Piecewise-linear saturable inductance branch (Type 98) integrating terminal voltage to magnetic flux linkage with unsaturated and saturated slopes.",
    provenance: "Dommel, H.W., EMTP Theory Book (1986), Ch. 7 (Nonlinear Elements); ATP Rule Book Sec. 4.E",
    params: [
      ["lUnsatH", 1.0, "H", "Unsaturated inductance slope dLambda/di"],
      ["lSatH", 0.05, "H", "Saturated air-core inductance slope"],
      ["fluxKneeWb", 1.0, "Wb", "Saturation knee flux linkage"],
    ],
  },
  {
    modelType: "NONLIN_HYST_96",
    aliases: ["TYPE96", "HYST_96", "HYSTERESIS", "NONLIN96"],
    label: "Hysteretic Saturable Inductor (Type 96)",
    category: "Nonlinear & Switching",
    archetypeId: AtpArchetypeId.NONLIN_HYST_96,
    description:
      "Nonlinear hysteretic iron-core inductor (Type 96) with residual flux linkage and coercive current offset for transformer inrush and ferroresonance studies.",
    provenance:
      "Frame, J.G., Mohan, N., & Liu, T.H., IEEE Trans. PAS-101(6), pp. 1403–1412 (1982); EMTP Theory Book Ch. 7",
    params: [
      ["lUnsatH", 1.2, "H", "Unsaturated inductance slope"],
      ["lSatH", 0.04, "H", "Saturated inductance slope"],
      ["fluxKneeWb", 1.0, "Wb", "Saturation knee flux linkage"],
      ["fluxResWb", 0.25, "Wb", "Initial residual flux linkage"],
      ["iCoerciveA", 0.5, "A", "Coercive magnetizing current half-width"],
    ],
  },
  {
    modelType: "MOV_ARRESTER_92",
    aliases: ["TYPE92", "MOV", "ZNO", "ARRESTER", "SURGE_ARRESTER"],
    label: "ZnO MOV Surge Arrester (Type 92)",
    category: "Nonlinear & Switching",
    archetypeId: AtpArchetypeId.MOV_ARRESTER_92,
    description:
      "Zinc-oxide metal-oxide varistor (MOV) surge arrester with exponential voltage-current characteristic I = Iref * (V / Vref)^q and cumulative energy tracking.",
    provenance:
      "IEEE Std C62.11; IEEE Working Group 3.4.11, Trans. PWRD-7(1), pp. 302–309 (1992); EMTP Theory Book Ch. 7",
    params: [
      ["vRefV", 100000.0, "V", "Reference clamping voltage Vref"],
      ["iRefA", 1000.0, "A", "Reference discharge current Iref"],
      ["qExp", 25.0, "1", "Nonlinearity exponent q"],
      ["rLeakOhms", 1.0e9, "Ohm", "Parallel leakage resistance"],
    ],
  },
  {
    modelType: "SWITCH_TIME_00",
    aliases: ["SW_TIME", "SWITCH", "BREAKER", "TYPE00_SW"],
    label: "Time-Controlled Switch (Circuit Breaker)",
    category: "Nonlinear & Switching",
    archetypeId: AtpArchetypeId.SWITCH_TIME_00,
    description:
      "Idealized time-controlled switch closing at tClose and opening at the first current zero-crossing (or |i| <= iMargin) after tOpen.",
    provenance: "Dommel, H.W., EMTP Theory Book (1986), Ch. 1.7 (Switches); ATP Rule Book Sec. 6.A",
    params: [
      ["tCloseSec", 0.0, "s", "Closing time"],
      ["tOpenSec", 1.0e6, "s", "Opening command time"],
      ["iMarginA", 0.0, "A", "Current-chopping margin for opening"],
      ["rOnOhms", 1.0e-4, "Ohm", "Closed-state on-resistance"],
    ],
  },
  {
    modelType: "SWITCH_STAT_04",
    aliases: ["SW_STAT", "STAT_SWITCH", "TYPE04_SW"],
    label: "Statistical / Systematic Switch (Type 04)",
    category: "Nonlinear & Switching",
    archetypeId: AtpArchetypeId.SWITCH_STAT_04,
    description:
      "Statistical or systematic switching-overvoltage circuit breaker with configurable mean closing time and standard deviation offset.",
    provenance: "CIGRE TB 39 (Guidelines for Representation of Network Elements, 1990); ATP Rule Book Sec. 6.B",
    params: [
      ["tMeanSec", 0.01, "s", "Mean closing time"],
      ["tOpenSec", 1.0e6, "s", "Opening time"],
      ["tSigmaSec", 0.001, "s", "Closing time scatter / offset"],
      ["rOnOhms", 1.0e-4, "Ohm", "Closed-state on-resistance"],
    ],
  },
  {
    modelType: "SWITCH_DIODE_11",
    aliases: ["DIODE", "TYPE11_DIODE", "VALVE_DIODE"],
    label: "Power Diode Valve Switch (Type 11)",
    category: "Nonlinear & Switching",
    archetypeId: AtpArchetypeId.SWITCH_DIODE_11,
    description:
      "Uncontrolled power semiconductor diode valve conducting on forward voltage above threshold and turning off at zero current.",
    provenance: "Dommel, H.W., EMTP Theory Book (1986), Ch. 7 (Power Electronics); ATP Rule Book Sec. 6.C",
    params: [
      ["vOnV", 0.7, "V", "Forward conduction threshold voltage"],
      ["rOnOhms", 1.0e-3, "Ohm", "Forward conducting resistance"],
      ["rOffOhms", 1.0e8, "Ohm", "Reverse blocking resistance"],
    ],
  },
  {
    modelType: "SWITCH_THYRISTOR_11",
    aliases: ["THYRISTOR", "SCR", "TYPE11_SCR", "VALVE_THYRISTOR"],
    label: "Controlled Thyristor Valve Switch (Type 11)",
    category: "Nonlinear & Switching",
    archetypeId: AtpArchetypeId.SWITCH_THYRISTOR_11,
    description:
      "Gate-triggered SCR/thyristor valve that latches into conduction when forward-biased with a TACS firing pulse and commutates off at zero current.",
    provenance: "Dommel, H.W., EMTP Theory Book (1986), Ch. 7; CIGRE HVDC Benchmark Model",
    params: [
      ["vOnV", 1.2, "V", "Forward latching voltage threshold"],
      ["rOnOhms", 1.0e-3, "Ohm", "On-state conducting resistance"],
      ["rOffOhms", 1.0e8, "Ohm", "Off-state blocking resistance"],
      ["iHoldA", 0.05, "A", "Holding current threshold"],
    ],
  },
  {
    modelType: "SWITCH_TACS_13",
    aliases: ["SW_TACS", "TYPE13", "TYPE13_SW", "TACS_SWITCH"],
    label: "TACS-Controlled Switch (Type 13)",
    category: "Nonlinear & Switching",
    archetypeId: AtpArchetypeId.SWITCH_TACS_13,
    description:
      "Idealized switch whose open/closed state is driven directly by a TACS or MODELS control signal (closed when ctrlIn > 0.5).",
    provenance: "ATP Rule Book Sec. 6.D (Type 13 TACS-Controlled Switch); EMTP Theory Book Ch. 10",
    params: [
      ["rOnOhms", 1.0e-4, "Ohm", "Closed-state on-resistance"],
      ["rOffOhms", 1.0e9, "Ohm", "Open-state off-resistance"],
      ["threshold", 0.5, "1", "Control signal closing threshold"],
    ],
  },

  // =========================================================================
  // 3. Sources & Machines
  // =========================================================================
  {
    modelType: "SRC_AC_14",
    aliases: ["TYPE14", "AC_SOURCE", "COS_SOURCE"],
    label: "Cosinusoidal AC Source (Type 14)",
    category: "Source & Machine",
    archetypeId: AtpArchetypeId.SRC_AC_14,
    description:
      "Steady-state or switched sinusoidal AC voltage/current source v(t) = A * cos(2*pi*f*t + phi) with optional start and stop times.",
    provenance: "Dommel, H.W., EMTP Theory Book (1986), Ch. 1.6; ATP Rule Book Sec. 7.D (Type 14)",
    params: [
      ["amplitude", 169705.6, "V", "Peak amplitude A (e.g. 120 kV RMS * sqrt(2))"],
      ["frequencyHz", 60.0, "Hz", "Fundamental frequency f"],
      ["phaseDeg", 0.0, "deg", "Initial cosine phase angle phi"],
      ["tStartSec", -1.0, "s", "Source turn-on time (<0 = steady-state)"],
      ["tStopSec", 1.0e6, "s", "Source turn-off time"],
      ["rIntOhms", 1.0e-3, "Ohm", "Internal Norton source resistance"],
    ],
  },
  {
    modelType: "SRC_IMPULSE_15",
    aliases: ["TYPE15", "IMPULSE", "LIGHTNING", "SURGE_SOURCE"],
    label: "Double-Exponential Surge Impulse (Type 15)",
    category: "Source & Machine",
    archetypeId: AtpArchetypeId.SRC_IMPULSE_15,
    description:
      "Double-exponential lightning or switching impulse source v(t) = V0 * (exp(-alpha*(t-t0)) - exp(-beta*(t-t0))) (default IEC 60060 1.2/50 us waveform).",
    provenance: "IEC 60060-1 (High-Voltage Test Techniques); IEEE Std 4; ATP Rule Book Sec. 7.E (Type 15)",
    params: [
      ["v0V", 1037000.0, "V", "Peak scale factor V0 (~1 MV crest for 1.2/50 us)"],
      ["alphaPerSec", 14659.0, "1/s", "Tail decay constant alpha"],
      ["betaPerSec", 2468900.0, "1/s", "Front rise constant beta"],
      ["t0Sec", 0.0, "s", "Impulse inception time t0"],
      ["rIntOhms", 1.0e-3, "Ohm", "Internal source resistance"],
    ],
  },
  {
    modelType: "SRC_DC_11",
    aliases: ["TYPE11", "DC_SOURCE", "STEP_SOURCE"],
    label: "Step / Ramp DC Source (Type 11)",
    category: "Source & Machine",
    archetypeId: AtpArchetypeId.SRC_DC_11,
    description:
      "Step or linear-ramp DC voltage/current source transitioning from 0 to Vdc over optional rise time tRamp starting at t0.",
    provenance: "ATP Rule Book Sec. 7.A (Type 11 Step/DC Source); Dommel EMTP Theory Book Ch. 1",
    params: [
      ["amplitudeV", 1000.0, "V", "Steady DC amplitude"],
      ["t0Sec", 0.0, "s", "Step inception time t0"],
      ["tRampSec", 0.0, "s", "Linear ramp rise time (0 = ideal step)"],
      ["tStopSec", 1.0e6, "s", "Turn-off time"],
      ["rIntOhms", 1.0e-3, "Ohm", "Internal source resistance"],
    ],
  },
  {
    modelType: "MACH_SYNC_59",
    aliases: ["TYPE59", "SM59", "SYNC_MACHINE", "GEN_59"],
    label: "Synchronous Machine (Type 59)",
    category: "Source & Machine",
    archetypeId: AtpArchetypeId.MACH_SYNC_59,
    description:
      "Three-phase electromagnetic transient synchronous machine (Type 59) with Park dq0 electromechanical swing dynamics and subtransient reactance interface.",
    provenance: "Brandwajn, V., IEEE Trans. PAS-96(2), pp. 342–349 (1977); Dommel EMTP Theory Book Ch. 8",
    params: [
      ["vRatedV", 20000.0, "V", "Rated RMS terminal voltage"],
      ["freqHz", 60.0, "Hz", "Synchronous electrical frequency"],
      ["hSec", 4.0, "s", "Inertia constant H"],
      ["xdppOhms", 0.2, "Ohm", "Subtransient reactance Xd''"],
      ["pMechW", 1.0e6, "W", "Mechanical shaft power input"],
    ],
  },
  {
    modelType: "MACH_UNIVERSAL_19",
    aliases: ["TYPE19", "UM19", "UNIVERSAL_MACHINE", "INDUCTION_MOTOR"],
    label: "Universal Machine (Type 19)",
    category: "Source & Machine",
    archetypeId: AtpArchetypeId.MACH_UNIVERSAL_19,
    description:
      "EMTP Universal Machine (UM Type 19) supporting induction, synchronous, and DC machine electromechanical transients with slip-dependent torque.",
    provenance: "Lauw, H.K. & Meyer, W.S., IEEE Trans. PAS-101(6), pp. 1342–1351 (1982); EMTP Theory Book Ch. 9",
    params: [
      ["vRatedV", 4160.0, "V", "Rated RMS voltage"],
      ["freqHz", 60.0, "Hz", "Stator frequency"],
      ["hSec", 1.5, "s", "Rotor inertia constant H"],
      ["rRotorOhms", 0.15, "Ohm", "Effective rotor resistance"],
      ["tLoadNm", 500.0, "N.m", "Mechanical load torque"],
    ],
  },

  // =========================================================================
  // 4. TACS & MODELS Control Blocks
  // =========================================================================
  {
    modelType: "TACS_TF_S",
    aliases: ["TACS_TF", "LAPLACE", "LEAD_LAG", "TACS_FILTER"],
    label: "TACS s-Domain Transfer Function",
    category: "TACS & MODELS Control",
    archetypeId: AtpArchetypeId.TACS_TF_S,
    description:
      "TACS Laplace s-domain lead-lag / first-order transfer function G(s) = K * (1 + T1*s) / (1 + T2*s) discretized via trapezoidal (Tustin) integration.",
    provenance: "Dube, L. & Dommel, H.W., IEEE PICA Conf., pp. 266–271 (1977); EMTP Theory Book Ch. 10 (TACS)",
    params: [
      ["gainK", 1.0, "1", "DC gain K"],
      ["t1Sec", 0.0, "s", "Lead time constant T1"],
      ["t2Sec", 0.01, "s", "Lag time constant T2"],
      ["yMin", -1.0e9, "1", "Lower output saturation limit"],
      ["yMax", 1.0e9, "1", "Upper output saturation limit"],
    ],
  },
  {
    modelType: "TACS_INTEGRATOR",
    aliases: ["TACS_INT", "INTEGRATOR", "TACS_58"],
    label: "TACS Trapezoidal Integrator",
    category: "TACS & MODELS Control",
    archetypeId: AtpArchetypeId.TACS_INTEGRATOR,
    description:
      "TACS continuous-time trapezoidal integrator y(t) = y0 + K * integral(u(t) dt) with anti-windup output clamping.",
    provenance: "Dommel, H.W., EMTP Theory Book (1986), Ch. 10 (TACS Supplemental Control Systems)",
    params: [
      ["gainK", 1.0, "1/s", "Integrator gain K"],
      ["y0", 0.0, "1", "Initial output state y(0)"],
      ["yMin", -1.0e9, "1", "Lower anti-windup limit"],
      ["yMax", 1.0e9, "1", "Upper anti-windup limit"],
    ],
  },
  {
    modelType: "TACS_LIMITER",
    aliases: ["TACS_LIM", "LIMITER", "CLAMP"],
    label: "TACS Static / Dynamic Limiter",
    category: "TACS & MODELS Control",
    archetypeId: AtpArchetypeId.TACS_LIMITER,
    description: "TACS algebraic gain and hard amplitude limiter clamping K*u between lower and upper bounds.",
    provenance: "ATP Rule Book Sec. 1.B (TACS Supplemental Devices); EMTP Theory Book Ch. 10",
    params: [
      ["gainK", 1.0, "1", "Input scale factor"],
      ["yMin", -1.0, "1", "Minimum output clamp"],
      ["yMax", 1.0, "1", "Maximum output clamp"],
    ],
  },
  {
    modelType: "TACS_DELAY",
    aliases: ["TACS_DLY", "DELAY_53", "TRANSPORT_DELAY"],
    label: "TACS Transport Time Delay (Device 53)",
    category: "TACS & MODELS Control",
    archetypeId: AtpArchetypeId.TACS_DELAY,
    description: "TACS Device 53 fixed transport delay outputting u(t - tau) using a ring buffer in linear memory.",
    provenance: "ATP Rule Book Sec. 1.C (TACS Device 53 Transport Delay); EMTP Theory Book Ch. 10",
    params: [
      ["delaySec", 0.001, "s", "Transport delay time tau"],
      ["initOut", 0.0, "1", "Initial delayed output value for t < tau"],
    ],
  },
  {
    modelType: "TACS_LOGIC",
    aliases: ["TACS_LOG", "COMPARATOR", "TACS_GATE"],
    label: "TACS Logical / Comparator Block",
    category: "TACS & MODELS Control",
    archetypeId: AtpArchetypeId.TACS_LOGIC,
    description:
      "TACS relational comparator and logical gate outputting hiVal when ctrlIn >= threshold (or inverted when invert > 0.5).",
    provenance: "ATP Rule Book Sec. 1.A (TACS Fortran & Logical Expressions); EMTP Theory Book Ch. 10",
    params: [
      ["threshold", 0.0, "1", "Switching threshold"],
      ["hiVal", 1.0, "1", "Logical high output value"],
      ["loVal", 0.0, "1", "Logical low output value"],
      ["invert", 0.0, "1", "Invert logic output if > 0.5"],
    ],
  },
  {
    modelType: "MODELS_USER",
    aliases: ["MODELS", "USER_MODEL", "FOREIGN_MODEL"],
    label: "MODELS Procedural Control Block",
    category: "TACS & MODELS Control",
    archetypeId: AtpArchetypeId.MODELS_USER,
    description:
      "ATP MODELS procedural control language block implementing cleanroom proportional-integral control or external FMU co-simulation coupling.",
    provenance: "Dube, L., MODELS in ATP: Language Manual (1996); CIGRE WG 33.02",
    params: [
      ["kp", 1.0, "1", "Proportional gain Kp"],
      ["ki", 0.0, "1/s", "Integral gain Ki"],
      ["yMin", -1.0e9, "1", "Lower output limit"],
      ["yMax", 1.0e9, "1", "Upper output limit"],
    ],
  },
];

/**
 * Converts `ATP_MODEL_SPECS` into shared `@modelscript/runtime` `CleanroomModelSchema[]`
 * with cleanroom parametric SVG icons and port layouts.
 */
export function buildAtpCleanroomSchemas(): CleanroomModelSchema[] {
  return ATP_MODEL_SPECS.map((spec) => {
    const parameters: CleanroomParameterSchema[] = spec.params.map(([key, defaultValue, unit, description]) => ({
      key,
      type: "real",
      defaultValue,
      unit,
      description,
    }));
    return {
      namePath: `atp:${spec.modelType}`,
      name: spec.modelType,
      aliases: spec.aliases,
      label: spec.label,
      category: spec.category,
      domain: "electrical",
      description: spec.description,
      provenance: spec.provenance,
      symbolKind: "atp_component_model",
      width: 88,
      height: 48,
      svg: generateAtpBlockSvg(spec.modelType, spec.category),
      ports: defaultPortsForCategory(spec.category, spec.archetypeId),
      parameters,
      wasmKernel: spec.modelType,
      extra: {
        archetypeId: spec.archetypeId,
      },
    };
  });
}
