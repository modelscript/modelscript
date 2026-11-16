// SPDX-License-Identifier: AGPL-3.0-or-later

import { ic, p, type DyrModelSchema } from "../types.js";

const CMPLDW_PARAMS = [
  p("MVA", "MVA", "Load substation base MVA (<0 = fraction of bus load)", 1.0, -10, 10000),
  p("Rfdr", "p.u.", "Equivalent distribution feeder resistance Rfdr", 0.04, 0.0, 1.0),
  p("Xfdr", "p.u.", "Equivalent distribution feeder reactance Xfdr", 0.04, 0.0, 1.0),
  p("Fb", "fraction", "Fraction of feeder impedance before shunt capacitor", 1.0, 0.0, 1.0),
  p("Fma", "fraction", "Motor A (3-ph constant-torque commercial A/C) load fraction", 0.25, 0.0, 1.0),
  p("Fmb", "fraction", "Motor B (3-ph high-inertia fan/pump) load fraction", 0.2, 0.0, 1.0),
  p("Fmc", "fraction", "Motor C (3-ph low-inertia pump) load fraction", 0.15, 0.0, 1.0),
  p("Fmd", "fraction", "Motor D (1-ph residential A/C compressor with stall) fraction", 0.2, 0.0, 1.0),
  p("Fel", "fraction", "Power electronic constant-P/Q load fraction Fel", 0.1, 0.0, 1.0),
  p("Vstall", "p.u.", "Motor D single-phase compressor stall threshold voltage", 0.6, 0.1, 0.95),
  p("Tstall", "s", "Motor D stall delay time Tstall", 0.033, 0.005, 5.0),
  p("Rstall", "p.u.", "Motor D stalled rotor resistance Rstall", 0.12, 0.01, 2.0),
  p("Xstall", "p.u.", "Motor D stalled rotor reactance Xstall", 0.12, 0.01, 2.0),
  p("Xxf", "p.u.", "Substation transformer reactance Xxf", 0.08, 0.0, 0.5),
  p("Tfixhs", "s", "High-side transformer LTC delay", 30.0, 0.0, 300),
  p("Tfixls", "s", "Low-side transformer LTC delay", 5.0, 0.0, 300),
];

const CLOD_PARAMS = [
  p("PctLargeMotor", "%", "Percentage of large induction motors", 25.0, 0.0, 100),
  p("PctSmallMotor", "%", "Percentage of small induction motors", 25.0, 0.0, 100),
  p("PctTransformer", "%", "Percentage of transformer exciting current", 5.0, 0.0, 100),
  p("PctLighting", "%", "Percentage of discharge lighting", 10.0, 0.0, 100),
  p("PctConstP", "%", "Percentage of constant-power load", 20.0, 0.0, 100),
  p("Kp", "exponent", "Remaining active load voltage exponent Kp", 1.5, 0.0, 4.0),
  p("Rbranch", "p.u.", "Substation feeder resistance Rbranch", 0.01, 0.0, 0.5),
  p("Xbranch", "p.u.", "Substation feeder reactance Xbranch", 0.05, 0.0, 0.5),
];

const CIM5_PARAMS = [
  p("Ra", "p.u.", "Stator armature resistance Ra", 0.01, 0.0, 0.5),
  p("Xa", "p.u.", "Stator leakage reactance Xa", 0.1, 0.0, 1.0),
  p("Xm", "p.u.", "Magnetizing reactance Xm", 3.0, 0.2, 15.0),
  p("R1", "p.u.", "Rotor cage 1 resistance R1", 0.015, 0.001, 1.0),
  p("X1", "p.u.", "Rotor cage 1 leakage reactance X1", 0.12, 0.0, 2.0),
  p("R2", "p.u.", "Rotor cage 2 resistance R2", 0.05, 0.0, 2.0),
  p("X2", "p.u.", "Rotor cage 2 leakage reactance X2", 0.1, 0.0, 2.0),
  p("H", "MW·s/MVA", "Motor + mechanical load inertia constant H", 1.2, 0.02, 50.0),
  p("D", "exponent", "Load torque speed exponent D", 2.0, 0.0, 4.0),
];

const IEEL_PARAMS = [
  p("a1", "fraction", "Active load constant-impedance fraction a1", 0.3, -2, 2),
  p("a2", "fraction", "Active load constant-current fraction a2", 0.3, -2, 2),
  p("a3", "fraction", "Active load constant-power fraction a3", 0.4, -2, 2),
  p("a4", "fraction", "Reactive load constant-impedance fraction a4", 0.5, -2, 2),
  p("a5", "fraction", "Reactive load constant-current fraction a5", 0.2, -2, 2),
  p("a6", "fraction", "Reactive load constant-power fraction a6", 0.3, -2, 2),
  p("a7", "p.u./p.u.", "Active load frequency sensitivity factor a7", 1.0, -5, 10),
  p("a8", "p.u./p.u.", "Reactive load frequency sensitivity factor a8", -1.0, -5, 10),
];

function subsystemLoadVariants(
  baseName: string,
  titlePrefix: string,
  description: string,
  subCategory: "load_static" | "load_motor" | "load_composite",
  params: DyrModelSchema["params"],
  states: readonly string[],
  daeArchetype: DyrModelSchema["daeArchetype"],
  icons?: DyrModelSchema["icons"],
): Record<string, DyrModelSchema> {
  const out: Record<string, DyrModelSchema> = {};
  const scopes: Array<[string, "load" | "subsystem", string]> = [
    [`${baseName}BL`, "load", "Bus"],
    [`${baseName}AL`, "subsystem", "Area"],
    [`${baseName}ZL`, "subsystem", "Zone"],
    [`${baseName}OW`, "subsystem", "Owner"],
  ];
  for (const [suffixModel, hdrKind, scopeLabel] of scopes) {
    out[suffixModel] = {
      model: suffixModel,
      category: "load",
      subCategory,
      headerKind: hdrKind,
      title: `${titlePrefix} (${scopeLabel}-Level)`,
      standardRef: "IEEE Task Force on Load Representation / WECC Load Modeling",
      description: `${description} Applied at ${scopeLabel.toLowerCase()} level.`,
      icons,
      params,
      states,
      daeArchetype,
    };
  }
  return out;
}

export const LOAD_SCHEMAS: Record<string, DyrModelSchema> = {
  CMPLDW: {
    model: "CMPLDW",
    aliases: ["CMLDBLU1", "CMLDBLU2", "CMLDBLDGU2"],
    category: "load",
    subCategory: "load_composite",
    headerKind: "load",
    title: "WECC Composite Load Model (CMPLDW / CMLD) with Motor A–D & FIDVR",
    standardRef: "WECC Composite Load Model Specification",
    description:
      "Substation transformer, feeder impedance, 3-phase motors A/B/C, 1-phase A/C compressor motor D (stall), electronic load, and static ZIP.",
    icons: [ic("it", "int", "Substation LTC / feeder configuration index", 1)],
    params: CMPLDW_PARAMS,
    states: ["s_mA", "s_mB", "s_mC", "stall_mD", "v_low_r", "v_low_i"],
    daeArchetype: "load_composite_cmpldw",
  },
  ...subsystemLoadVariants(
    "CMLD",
    "WECC Composite Load Subsystem Model",
    "Aggregate WECC composite load (feeder + 3-phase motors A/B/C + 1-phase stall motor D + static ZIP).",
    "load_composite",
    CMPLDW_PARAMS,
    ["s_mA", "s_mB", "s_mC", "stall_mD"],
    "load_composite_cmpldw",
    [ic("it", "int", "Configuration index", 1)],
  ),
  CLOD: {
    model: "CLOD",
    category: "load",
    subCategory: "load_composite",
    headerKind: "load",
    title: "Complex Aggregate Load Model (CLOD)",
    standardRef: "IEEE Load Representation Task Force",
    description:
      "Aggregate substation load comprising large/small induction motors, transformer excitation, and discharge lighting.",
    params: CLOD_PARAMS,
    states: ["s_lg", "s_sm"],
    daeArchetype: "load_complex_clod",
  },
  ...subsystemLoadVariants(
    "CLOD",
    "Complex Aggregate Load Model",
    "Aggregate substation load comprising large/small induction motors, transformer excitation, and discharge lighting.",
    "load_composite",
    CLOD_PARAMS,
    ["s_lg", "s_sm"],
    "load_complex_clod",
  ),
  CIM5: {
    model: "CIM5",
    category: "load",
    subCategory: "load_motor",
    headerKind: "load",
    title: "Fifth-Order Double-Cage Induction Motor Load Model (CIM5)",
    standardRef: "IEEE Load Representation Task Force / Kundur Ch. 7",
    description: "Dynamic 5th-order squirrel-cage or double-cage induction motor load model.",
    icons: [ic("it", "flag", "Motor base selection flag (0=bus load, 1=specified MVA)", 0, [0, 1])],
    params: CIM5_PARAMS,
    states: ["Edp", "Eqp", "Edpp", "Eqpp", "slip"],
    daeArchetype: "load_ind_motor",
  },
  ...subsystemLoadVariants(
    "CIM5",
    "Fifth-Order Double-Cage Induction Motor Load",
    "Dynamic 5th-order induction motor load model.",
    "load_motor",
    CIM5_PARAMS,
    ["Edp", "Eqp", "slip"],
    "load_ind_motor",
    [ic("it", "flag", "Motor base flag", 0, [0, 1])],
  ),
  ...subsystemLoadVariants(
    "CIM6",
    "Sixth-Order Double-Cage Induction Motor Load",
    "Dynamic double-cage induction motor load model with contactor under-voltage dropout and reclosing.",
    "load_motor",
    [
      ...CIM5_PARAMS,
      p("Vtrip", "p.u.", "Contactor trip voltage Vtrip", 0.5, 0.0, 1.0),
      p("Ttrip", "s", "Contactor trip delay", 0.05, 0.0, 5.0),
    ],
    ["Edp", "Eqp", "Edpp", "Eqpp", "slip"],
    "load_ind_motor",
    [ic("it", "flag", "Motor base flag", 0, [0, 1])],
  ),
  ...subsystemLoadVariants(
    "CIMW",
    "Wound-Rotor Induction Motor Load",
    "Dynamic wound-rotor induction motor load model with variable rotor resistance.",
    "load_motor",
    CIM5_PARAMS,
    ["Edp", "Eqp", "slip"],
    "load_ind_motor",
  ),
  IEEEL: {
    model: "IEEEL",
    category: "load",
    subCategory: "load_static",
    headerKind: "load",
    title: "IEEE Polynomial & Frequency-Dependent Static Load Model",
    standardRef: "IEEE Std Load Model (ZIP + Frequency)",
    description: "Voltage-polynomial (ZIP) and frequency-sensitivity dynamic load representation.",
    params: IEEL_PARAMS,
    states: [],
    daeArchetype: "load_static_zipf",
  },
  ...subsystemLoadVariants(
    "IEEL",
    "IEEE Polynomial & Frequency Static Load",
    "Voltage-polynomial (ZIP) and frequency-sensitivity dynamic load representation.",
    "load_static",
    IEEL_PARAMS,
    [],
    "load_static_zipf",
  ),
  ...subsystemLoadVariants(
    "LDFR",
    "Exponential Voltage & Frequency Load Model",
    "Exponential voltage (V^alpha, V^beta) and linear frequency-dependent static load model.",
    "load_static",
    [
      p("Kp", "exponent", "Active power voltage exponent", 1.0, 0.0, 4.0),
      p("Kq", "exponent", "Reactive power voltage exponent", 2.0, 0.0, 4.0),
      p("npf", "p.u.", "Active power frequency sensitivity", 1.0, -5, 10),
      p("nqf", "p.u.", "Reactive power frequency sensitivity", -1.0, -5, 10),
    ],
    [],
    "load_static_zipf",
  ),
  LD1PAC: {
    model: "LD1PAC",
    aliases: ["LD1PACU1"],
    category: "load",
    subCategory: "load_motor",
    headerKind: "load",
    title: "Single-Phase Residential Air-Conditioner Stall Model (LD1PAC)",
    standardRef: "WECC FIDVR Single-Phase A/C Load Specification",
    description:
      "Single-phase compressor load modeling normal running impedance vs locked-rotor stall and thermal protection.",
    icons: [ic("it", "flag", "Stall/restart mode flag", 0, [0, 1, 2])],
    params: [
      p("Vstall", "p.u.", "Compressor stall voltage threshold Vstall", 0.6, 0.1, 0.95),
      p("Tstall", "s", "Compressor stall delay Tstall", 0.033, 0.005, 5.0),
      p("Rstall", "p.u.", "Stalled rotor resistance Rstall", 0.12, 0.01, 2.0),
      p("Xstall", "p.u.", "Stalled rotor reactance Xstall", 0.12, 0.01, 2.0),
      p("Vrst", "p.u.", "Restart recovery voltage Vrst", 0.9, 0.5, 1.2),
      p("Tth", "s", "Thermal overload trip time constant Tth", 10.0, 0.1, 120),
    ],
    states: ["stallState", "thetaTherm"],
    daeArchetype: "load_1ph_stall",
  },
};
