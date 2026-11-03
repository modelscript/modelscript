// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PsseDyrCase, PsseDyrCategory, PsseDyrRecord, SourceSpan } from "../types.js";

/**
 * Schema metadata for standard IEEE / PSS/E dynamic models in `.dyr` files.
 */
export interface DyrModelSchema {
  model: string;
  category: PsseDyrCategory;
  title: string;
  description: string;
  params: Array<{ name: string; unit: string; description: string }>;
}

export const DYR_MODEL_SCHEMAS: Record<string, DyrModelSchema> = {
  GENCLS: {
    model: "GENCLS",
    category: "generator",
    title: "Classical Constant-Flux Synchronous Generator Model",
    description: "Second-order classical swing equation generator model (constant voltage behind transient reactance).",
    params: [
      { name: "H", unit: "MW·s/MVA", description: "Inertia constant H (0.0 = infinite bus)" },
      { name: "D", unit: "p.u.", description: "Speed damping factor D" },
    ],
  },
  GENROU: {
    model: "GENROU",
    category: "generator",
    title: "Round-Rotor Synchronous Generator Model (Subtransient)",
    description: "Sixth-order solid-rotor synchronous machine model with d/q-axis transient and subtransient dynamics.",
    params: [
      { name: "Td0p", unit: "s", description: "d-axis transient open-circuit time constant T'd0" },
      { name: "Td0pp", unit: "s", description: "d-axis subtransient open-circuit time constant T''d0" },
      { name: "Tq0p", unit: "s", description: "q-axis transient open-circuit time constant T'q0" },
      { name: "Tq0pp", unit: "s", description: "q-axis subtransient open-circuit time constant T''q0" },
      { name: "H", unit: "MW·s/MVA", description: "Inertia constant H" },
      { name: "D", unit: "p.u.", description: "Speed damping coefficient D" },
      { name: "Xd", unit: "p.u.", description: "d-axis synchronous reactance Xd" },
      { name: "Xq", unit: "p.u.", description: "q-axis synchronous reactance Xq" },
      { name: "Xdp", unit: "p.u.", description: "d-axis transient reactance X'd" },
      { name: "Xqp", unit: "p.u.", description: "q-axis transient reactance X'q" },
      { name: "Xdpp", unit: "p.u.", description: "Subtransient reactance X''d = X''q" },
      { name: "Xl", unit: "p.u.", description: "Stator leakage reactance Xl" },
      { name: "S10", unit: "p.u.", description: "Saturation factor S(1.0)" },
      { name: "S12", unit: "p.u.", description: "Saturation factor S(1.2)" },
    ],
  },
  GENSAL: {
    model: "GENSAL",
    category: "generator",
    title: "Salient-Pole Synchronous Generator Model (Subtransient)",
    description: "Fifth-order salient-pole hydro/low-speed synchronous generator model.",
    params: [
      { name: "Td0p", unit: "s", description: "d-axis transient open-circuit time constant T'd0" },
      { name: "Td0pp", unit: "s", description: "d-axis subtransient open-circuit time constant T''d0" },
      { name: "Tq0pp", unit: "s", description: "q-axis subtransient open-circuit time constant T''q0" },
      { name: "H", unit: "MW·s/MVA", description: "Inertia constant H" },
      { name: "D", unit: "p.u.", description: "Speed damping coefficient D" },
      { name: "Xd", unit: "p.u.", description: "d-axis synchronous reactance Xd" },
      { name: "Xq", unit: "p.u.", description: "q-axis synchronous reactance Xq" },
      { name: "Xdp", unit: "p.u.", description: "d-axis transient reactance X'd" },
      { name: "Xdpp", unit: "p.u.", description: "Subtransient reactance X''d = X''q" },
      { name: "Xl", unit: "p.u.", description: "Stator leakage reactance Xl" },
      { name: "S10", unit: "p.u.", description: "Saturation factor S(1.0)" },
      { name: "S12", unit: "p.u.", description: "Saturation factor S(1.2)" },
    ],
  },
  EXST1: {
    model: "EXST1",
    category: "exciter",
    title: "IEEE Type ST1A Potential-Source Controlled-Rectifier Exciter",
    description: "Static excitation system with lead-lag compensation and voltage regulator limits.",
    params: [
      { name: "TR", unit: "s", description: "Voltage transducer filter time constant TR" },
      { name: "VIMAX", unit: "p.u.", description: "Maximum voltage error input limit VIMAX" },
      { name: "VIMIN", unit: "p.u.", description: "Minimum voltage error input limit VIMIN" },
      { name: "TC", unit: "s", description: "Lead time constant TC" },
      { name: "TB", unit: "s", description: "Lag time constant TB" },
      { name: "KA", unit: "p.u.", description: "Voltage regulator gain KA" },
      { name: "TA", unit: "s", description: "Voltage regulator time constant TA" },
      { name: "VRMAX", unit: "p.u.", description: "Maximum regulator output VRMAX" },
      { name: "VRMIN", unit: "p.u.", description: "Minimum regulator output VRMIN" },
      { name: "KC", unit: "p.u.", description: "Rectifier loading factor KC" },
      { name: "KF", unit: "p.u.", description: "Rate feedback gain KF" },
      { name: "TF", unit: "s", description: "Rate feedback time constant TF" },
    ],
  },
  IEEET1: {
    model: "IEEET1",
    category: "exciter",
    title: "IEEE 1968 Type 1 DC Commutator Excitation System",
    description: "Continuously acting regulator and DC generator exciter with saturation and rate feedback.",
    params: [
      { name: "TR", unit: "s", description: "Transducer filter time constant TR" },
      { name: "KA", unit: "p.u.", description: "Regulator gain KA" },
      { name: "TA", unit: "s", description: "Regulator amplifier time constant TA" },
      { name: "VRMAX", unit: "p.u.", description: "Maximum regulator output VRMAX" },
      { name: "VRMIN", unit: "p.u.", description: "Minimum regulator output VRMIN" },
      { name: "KE", unit: "p.u.", description: "Exciter constant KE" },
      { name: "TE", unit: "s", description: "Exciter time constant TE" },
      { name: "KF", unit: "p.u.", description: "Stabilizer feedback gain KF" },
      { name: "TF", unit: "s", description: "Stabilizer feedback time constant TF" },
    ],
  },
  SEXS: {
    model: "SEXS",
    category: "exciter",
    title: "Simplified Excitation System Model",
    description: "General simplified excitation system with lead-lag and first-order gain block.",
    params: [
      { name: "TATB", unit: "ratio", description: "Lead-lag ratio TA/TB" },
      { name: "TB", unit: "s", description: "Lag time constant TB" },
      { name: "K", unit: "p.u.", description: "Exciter gain K" },
      { name: "TE", unit: "s", description: "Exciter time constant TE" },
      { name: "EMIN", unit: "p.u.", description: "Minimum field voltage output EMIN" },
      { name: "EMAX", unit: "p.u.", description: "Maximum field voltage output EMAX" },
    ],
  },
  TGOV1: {
    model: "TGOV1",
    category: "governor",
    title: "Steam Turbine-Governor Model with Reheat",
    description: "Speed governor droop, main steam control valve, and reheat time constants.",
    params: [
      { name: "R", unit: "p.u.", description: "Permanent droop R (speed regulation)" },
      { name: "T1", unit: "s", description: "Steam bowl / valve time constant T1" },
      { name: "VMAX", unit: "p.u.", description: "Maximum valve position limit VMAX" },
      { name: "VMIN", unit: "p.u.", description: "Minimum valve position limit VMIN" },
      { name: "T2", unit: "s", description: "Reheat lead time constant T2" },
      { name: "T3", unit: "s", description: "Reheater time constant T3" },
      { name: "DT", unit: "p.u.", description: "Turbine damping coefficient DT" },
    ],
  },
  HYGOV: {
    model: "HYGOV",
    category: "governor",
    title: "Hydro Turbine-Governor Model",
    description: "Hydraulic turbine and penstock water-hammer model with temporary & permanent droop.",
    params: [
      { name: "R", unit: "p.u.", description: "Permanent droop R" },
      { name: "r", unit: "p.u.", description: "Temporary droop r" },
      { name: "Tr", unit: "s", description: "Governor reset time constant Tr" },
      { name: "Tf", unit: "s", description: "Filter time constant Tf" },
      { name: "Tg", unit: "s", description: "Servo time constant Tg" },
      { name: "VELM", unit: "p.u./s", description: "Gate velocity limit VELM" },
      { name: "GMAX", unit: "p.u.", description: "Maximum gate limit GMAX" },
      { name: "GMIN", unit: "p.u.", description: "Minimum gate limit GMIN" },
      { name: "TW", unit: "s", description: "Water starting time constant TW" },
      { name: "At", unit: "p.u.", description: "Turbine gain At" },
      { name: "Dturb", unit: "p.u.", description: "Turbine damping factor Dturb" },
      { name: "qnl", unit: "p.u.", description: "No-load water flow qnl" },
    ],
  },
  IEEEST: {
    model: "IEEEST",
    category: "stabilizer",
    title: "IEEE Power System Stabilizer (PSS)",
    description: "Washout filter and dual lead-lag phase compensation power system stabilizer.",
    params: [
      { name: "A1", unit: "s", description: "High-frequency filter constant A1" },
      { name: "A2", unit: "s²", description: "High-frequency filter constant A2" },
      { name: "T1", unit: "s", description: "First lead time constant T1" },
      { name: "T2", unit: "s", description: "First lag time constant T2" },
      { name: "T3", unit: "s", description: "Second lead time constant T3" },
      { name: "T4", unit: "s", description: "Second lag time constant T4" },
      { name: "T5", unit: "s", description: "Washout numerator time constant T5" },
      { name: "T6", unit: "s", description: "Washout denominator time constant T6" },
      { name: "KS", unit: "p.u.", description: "Stabilizer gain KS" },
      { name: "LSMAX", unit: "p.u.", description: "Maximum stabilizer output LSMAX" },
      { name: "LSMIN", unit: "p.u.", description: "Minimum stabilizer output LSMIN" },
    ],
  },
  REGC_A: {
    model: "REGC_A",
    category: "generator",
    title: "WECC Renewable Energy Generator / Converter Model (2nd Gen IBR)",
    description:
      "Grid-following inverter-based resource (Wind/Solar/BESS) current-source converter interface with LVRT/HVRT current management.",
    params: [
      { name: "Tg", unit: "s", description: "Converter current regulator lag time constant Tg" },
      { name: "Rrpwr", unit: "p.u./s", description: "Active current recovery ramp rate limit after fault Rrpwr" },
      { name: "Brkpt", unit: "p.u.", description: "LVPL breakpoint voltage Brkpt" },
      { name: "Zerox", unit: "p.u.", description: "LVPL zero crossing voltage Zerox" },
      { name: "Lvpl1", unit: "p.u.", description: "LVPL breakpoint current limit Lvpl1" },
      { name: "Vtmax", unit: "p.u.", description: "High-voltage reactive current clamp threshold Vtmax" },
      { name: "Lvpnt0", unit: "p.u.", description: "Low-voltage active current management threshold Lvpnt0" },
      { name: "Lvpnt1", unit: "p.u.", description: "Low-voltage active current breakpoint Lvpnt1" },
      { name: "Iolim", unit: "p.u.", description: "Minimum reactive current limit Iolim" },
      { name: "Tfltr", unit: "s", description: "Terminal voltage filter time constant Tfltr" },
      { name: "Khv", unit: "p.u.", description: "Overvoltage compensation gain Khv" },
      { name: "Iqrmax", unit: "p.u./s", description: "Reactive current up-ramp rate limit Iqrmax" },
      { name: "Iqrmin", unit: "p.u./s", description: "Reactive current down-ramp rate limit Iqrmin" },
      { name: "Accel", unit: "factor", description: "Filter acceleration factor Accel" },
    ],
  },
  REEC_A: {
    model: "REEC_A",
    category: "exciter",
    title: "WECC Renewable Energy Electrical Control Model (2nd Gen IBR)",
    description:
      "Local voltage/reactive power control, fault ride-through reactive current injection, and active power current command calculation.",
    params: [
      { name: "Vdip", unit: "p.u.", description: "Voltage dip threshold for fault ride-through logic Vdip" },
      { name: "Vup", unit: "p.u.", description: "Voltage swell threshold for fault ride-through logic Vup" },
      { name: "Trv", unit: "s", description: "Voltage filter time constant Trv" },
      { name: "dbd1", unit: "p.u.", description: "Lower voltage deadband for reactive current injection dbd1" },
      { name: "dbd2", unit: "p.u.", description: "Upper voltage deadband for reactive current injection dbd2" },
      { name: "Kqv", unit: "p.u.", description: "Reactive current injection gain during voltage dip/swell Kqv" },
      { name: "Iqh1", unit: "p.u.", description: "Maximum reactive current injection limit Iqh1" },
      { name: "Iql1", unit: "p.u.", description: "Minimum reactive current absorption limit Iql1" },
      { name: "Vref0", unit: "p.u.", description: "Reference voltage setpoint Vref0" },
      { name: "Iqfrz", unit: "p.u.", description: "Frozen reactive current post-fault Iqfrz" },
      { name: "Thld", unit: "s", description: "Post-fault hold time Thld" },
      { name: "Thld2", unit: "s", description: "Active current hold time Thld2" },
      { name: "Tp", unit: "s", description: "Active power filter time constant Tp" },
      { name: "Qmax", unit: "p.u.", description: "Maximum reactive power limit Qmax" },
      { name: "Qmin", unit: "p.u.", description: "Minimum reactive power limit Qmin" },
      { name: "Vmax", unit: "p.u.", description: "Maximum voltage regulator limit Vmax" },
      { name: "Vmin", unit: "p.u.", description: "Minimum voltage regulator limit Vmin" },
      { name: "Kqp", unit: "p.u.", description: "Reactive power regulator proportional gain Kqp" },
      { name: "Kqi", unit: "p.u./s", description: "Reactive power regulator integral gain Kqi" },
      { name: "Kvp", unit: "p.u.", description: "Voltage regulator proportional gain Kvp" },
      { name: "Kvi", unit: "p.u./s", description: "Voltage regulator integral gain Kvi" },
      { name: "Tiq", unit: "s", description: "Reactive current command time constant Tiq" },
      { name: "dPmax", unit: "p.u./s", description: "Maximum active power ramp-up rate dPmax" },
      { name: "dPmin", unit: "p.u./s", description: "Maximum active power ramp-down rate dPmin" },
      { name: "Pmax", unit: "p.u.", description: "Maximum active power limit Pmax" },
      { name: "Pmin", unit: "p.u.", description: "Minimum active power limit Pmin" },
      { name: "Imax", unit: "p.u.", description: "Maximum total converter current limit Imax" },
      { name: "Tpord", unit: "s", description: "Power order lag time constant Tpord" },
    ],
  },
  REPC_A: {
    model: "REPC_A",
    category: "governor",
    title: "WECC Renewable Energy Plant Controller Model",
    description: "Plant-level POI voltage/Q regulation and frequency/droop active power control.",
    params: [
      { name: "Tfltr", unit: "s", description: "Voltage/reactive power transducer filter time constant Tfltr" },
      { name: "Kp", unit: "p.u.", description: "Plant reactive/voltage controller proportional gain Kp" },
      { name: "Ki", unit: "p.u./s", description: "Plant reactive/voltage controller integral gain Ki" },
      { name: "Tft", unit: "s", description: "Plant controller lead time constant Tft" },
      { name: "Tfv", unit: "s", description: "Plant controller lag time constant Tfv" },
      { name: "Vfrz", unit: "p.u.", description: "Voltage threshold below which plant Q control freezes Vfrz" },
      { name: "Rc", unit: "p.u.", description: "Line drop compensation resistance Rc" },
      { name: "Xc", unit: "p.u.", description: "Line drop compensation reactance Xc" },
      { name: "Kc", unit: "p.u.", description: "Reactive current compensation droop gain Kc" },
      { name: "emax", unit: "p.u.", description: "Upper error limit emax" },
      { name: "emin", unit: "p.u.", description: "Lower error limit emin" },
      { name: "dbd", unit: "p.u.", description: "Reactive/voltage error deadband dbd" },
      { name: "Qmax", unit: "p.u.", description: "Maximum plant reactive command Qmax" },
      { name: "Qmin", unit: "p.u.", description: "Minimum plant reactive command Qmin" },
      { name: "Kpg", unit: "p.u.", description: "Plant active power PI proportional gain Kpg" },
      { name: "Kig", unit: "p.u./s", description: "Plant active power PI integral gain Kig" },
      { name: "Tp", unit: "s", description: "Active power measurement filter time constant Tp" },
      { name: "fdbd1", unit: "p.u.", description: "Under-frequency droop deadband fdbd1" },
      { name: "fdbd2", unit: "p.u.", description: "Over-frequency droop deadband fdbd2" },
      { name: "femax", unit: "p.u.", description: "Maximum frequency error limit femax" },
      { name: "femin", unit: "p.u.", description: "Minimum frequency error limit femin" },
      { name: "Pmax", unit: "p.u.", description: "Maximum plant active power order Pmax" },
      { name: "Pmin", unit: "p.u.", description: "Minimum plant active power order Pmin" },
      { name: "Tg", unit: "s", description: "Plant active power output lag time constant Tg" },
      { name: "Ddn", unit: "p.u.", description: "Over-frequency downward regulation droop gain Ddn" },
      { name: "Dup", unit: "p.u.", description: "Under-frequency upward regulation droop gain Dup" },
    ],
  },
  WTGT_A: {
    model: "WTGT_A",
    category: "governor",
    title: "WECC Wind Turbine Two-Mass Drive-Train Model",
    description: "Two-mass turbine and generator shaft torsional drive-train model for wind turbine generators.",
    params: [
      { name: "Ht", unit: "MW·s/MVA", description: "Turbine rotor inertia constant Ht" },
      { name: "Hg", unit: "MW·s/MVA", description: "Generator rotor inertia constant Hg" },
      { name: "Dshaft", unit: "p.u.", description: "Shaft torsional damping coefficient Dshaft" },
      { name: "Kshaft", unit: "p.u./rad", description: "Shaft torsional spring stiffness Kshaft" },
    ],
  },
  IEEEG1: {
    model: "IEEEG1",
    category: "governor",
    title: "IEEE 1981 Type 1 Steam Turbine-Governor Model",
    description: "Four-stage Tandem-Compound or Cross-Compound steam turbine and speed-governing system.",
    params: [
      { name: "K", unit: "p.u.", description: "Governor gain K (1 / droop R)" },
      { name: "T1", unit: "s", description: "Governor lag time constant T1" },
      { name: "T2", unit: "s", description: "Governor lead time constant T2" },
      { name: "T3", unit: "s", description: "Servo-valve time constant T3" },
      { name: "UO", unit: "p.u./s", description: "Maximum valve opening velocity UO" },
      { name: "UC", unit: "p.u./s", description: "Maximum valve closing velocity UC" },
      { name: "PMAX", unit: "p.u.", description: "Maximum valve opening limit PMAX" },
      { name: "PMIN", unit: "p.u.", description: "Minimum valve opening limit PMIN" },
      { name: "T4", unit: "s", description: "Steam inlet / bowl time constant T4" },
      { name: "K1", unit: "fraction", description: "High-pressure turbine power fraction K1" },
      { name: "K2", unit: "fraction", description: "LP1 power fraction K2" },
      { name: "T5", unit: "s", description: "First reheater time constant T5" },
      { name: "K3", unit: "fraction", description: "Intermediate-pressure turbine power fraction K3" },
      { name: "K4", unit: "fraction", description: "LP2 power fraction K4" },
    ],
  },
  GGOV1: {
    model: "GGOV1",
    category: "governor",
    title: "General Electric Gas Turbine-Governor Model (GGOV1)",
    description: "General-purpose gas turbine speed, acceleration, and temperature/load-limit governor model.",
    params: [
      { name: "R", unit: "p.u.", description: "Permanent speed droop R" },
      { name: "Tpelec", unit: "s", description: "Electrical power transducer time constant Tpelec" },
      { name: "maxerr", unit: "p.u.", description: "Maximum speed error limit maxerr" },
      { name: "minerr", unit: "p.u.", description: "Minimum speed error limit minerr" },
      { name: "Kpgov", unit: "p.u.", description: "Governor proportional gain Kpgov" },
      { name: "Kigov", unit: "p.u./s", description: "Governor integral gain Kigov" },
      { name: "Kdgov", unit: "p.u.·s", description: "Governor derivative gain Kdgov" },
      { name: "Tdgov", unit: "s", description: "Governor derivative filter time constant Tdgov" },
      { name: "vmax", unit: "p.u.", description: "Maximum fuel valve stroke vmax" },
      { name: "vmin", unit: "p.u.", description: "Minimum fuel valve stroke vmin" },
      { name: "Tact", unit: "s", description: "Fuel actuator time constant Tact" },
      { name: "Kturb", unit: "p.u.", description: "Turbine gain Kturb" },
      { name: "wfnl", unit: "p.u.", description: "No-load fuel flow wfnl" },
      { name: "Tb", unit: "s", description: "Turbine lag time constant Tb" },
      { name: "Tc", unit: "s", description: "Turbine lead time constant Tc" },
    ],
  },
  ESDC1A: {
    model: "ESDC1A",
    category: "exciter",
    title: "IEEE Type DC1A DC Commutator Excitation System",
    description: "Field-controlled DC commutator exciter with continuously acting voltage regulator.",
    params: [
      { name: "TR", unit: "s", description: "Voltage transducer time constant TR" },
      { name: "KA", unit: "p.u.", description: "Voltage regulator gain KA" },
      { name: "TA", unit: "s", description: "Voltage regulator time constant TA" },
      { name: "TB", unit: "s", description: "Lead-lag denominator time constant TB" },
      { name: "TC", unit: "s", description: "Lead-lag numerator time constant TC" },
      { name: "VRMAX", unit: "p.u.", description: "Maximum regulator output VRMAX" },
      { name: "VRMIN", unit: "p.u.", description: "Minimum regulator output VRMIN" },
      { name: "KE", unit: "p.u.", description: "Exciter constant KE" },
      { name: "TE", unit: "s", description: "Exciter time constant TE" },
      { name: "KF", unit: "p.u.", description: "Excitation control stabilizer gain KF" },
      { name: "TF1", unit: "s", description: "Excitation control stabilizer time constant TF1" },
    ],
  },
  PSS2A: {
    model: "PSS2A",
    category: "stabilizer",
    title: "IEEE Dual-Input Power System Stabilizer (PSS2A/2B)",
    description: "Dual-input (speed/frequency and electrical power) integral-of-accelerating-power stabilizer.",
    params: [
      { name: "Tw1", unit: "s", description: "First washout time constant on input 1 Tw1" },
      { name: "Tw2", unit: "s", description: "Second washout time constant on input 1 Tw2" },
      { name: "T6", unit: "s", description: "Transducer lag time constant on input 1 T6" },
      { name: "Tw3", unit: "s", description: "First washout time constant on input 2 Tw3" },
      { name: "Tw4", unit: "s", description: "Second washout time constant on input 2 Tw4" },
      { name: "T7", unit: "s", description: "Transducer lag time constant on input 2 T7" },
      { name: "Ks2", unit: "p.u.", description: "Gain on electrical power input Ks2" },
      { name: "Ks3", unit: "p.u.", description: "Signal matching gain Ks3" },
      { name: "T8", unit: "s", description: "Ramp-tracking filter lead time constant T8" },
      { name: "T9", unit: "s", description: "Ramp-tracking filter lag time constant T9" },
      { name: "Ks1", unit: "p.u.", description: "Main stabilizer gain Ks1" },
      { name: "T1", unit: "s", description: "First phase-lead time constant T1" },
      { name: "T2", unit: "s", description: "First phase-lag time constant T2" },
      { name: "T3", unit: "s", description: "Second phase-lead time constant T3" },
      { name: "T4", unit: "s", description: "Second phase-lag time constant T4" },
      { name: "Vstmax", unit: "p.u.", description: "Maximum stabilizer output limit Vstmax" },
      { name: "Vstmin", unit: "p.u.", description: "Minimum stabilizer output limit Vstmin" },
    ],
  },
};

function classifyDyrModel(modelName: string): PsseDyrCategory {
  const upper = modelName.toUpperCase();
  const schema = DYR_MODEL_SCHEMAS[upper];
  if (schema) return schema.category;
  if (upper.startsWith("GEN") || upper.startsWith("REG")) return "generator";
  if (
    upper.startsWith("EX") ||
    upper.startsWith("REEC") ||
    upper.startsWith("IEEE") ||
    upper.startsWith("ES") ||
    upper.startsWith("SEXS")
  ) {
    return "exciter";
  }
  if (
    upper.startsWith("TG") ||
    upper.startsWith("HY") ||
    upper.startsWith("GG") ||
    upper.startsWith("GAST") ||
    upper.startsWith("REPC") ||
    upper.startsWith("WTG")
  ) {
    return "governor";
  }
  if (upper.startsWith("PSS") || upper.startsWith("STAB")) return "stabilizer";
  return "user";
}

function tokenizeDyrRecord(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === quoteChar) {
        inQuotes = false;
        tokens.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      if (current.trim().length > 0) {
        tokens.push(current.trim());
        current = "";
      }
      inQuotes = true;
      quoteChar = ch;
      continue;
    }

    if (ch === "," || ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      if (current.trim().length > 0) {
        tokens.push(current.trim());
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.trim().length > 0) {
    tokens.push(current.trim());
  }
  return tokens;
}

/**
 * Checks whether a document string looks like a PSS/E `.dyr` dynamic model file
 * rather than a `.raw` power-flow file.
 */
export function isLikelyDyrContent(source: string): boolean {
  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("@!") || line.startsWith("/*")) continue;
    // A .dyr record starts with an integer bus number followed by a quoted model name like 'GENROU' or 'REGC_A'
    if (/^\d+(?:,\s*|\s+)'(?:GEN|EX|TG|HY|IEEE|SEXS|PSS|USR|REG|REE|REP|WTG|GGOV|ESDC)/i.test(line)) {
      return true;
    }
    return false;
  }
  return false;
}

/**
 * Parses a PSS/E `.dyr` Dynamic Data file into structured dynamic equipment records.
 * Supports multi-line records terminated by `/` as well as single-line records.
 */
export function parseDyr(source: string): PsseDyrCase {
  const records: PsseDyrRecord[] = [];
  const generatorsByBusId = new Map<string, PsseDyrRecord>();
  const excitersByBusId = new Map<string, PsseDyrRecord>();
  const governorsByBusId = new Map<string, PsseDyrRecord>();
  const stabilizersByBusId = new Map<string, PsseDyrRecord>();

  const lines = source.split(/\r?\n/);
  let currentBuffer = "";
  let recordStartOffset = 0;
  let recordStartLine = 1;
  let currentOffset = 0;

  const flushRecord = (rawChunk: string, startOffset: number, endOffset: number, lineNum: number) => {
    const cleaned = rawChunk.trim();
    if (!cleaned || /^0(?:\s|$|,)/.test(cleaned) || /^Q\b/i.test(cleaned)) return;

    const tokens = tokenizeDyrRecord(cleaned);
    if (tokens.length < 3) return;

    const ibus = Number.parseInt(tokens[0] ?? "0", 10);
    if (!Number.isFinite(ibus) || ibus <= 0) return;

    // Handle USRMDL vs standard `IBUS 'MODEL' ID CON(1)...`
    let model = (tokens[1] ?? "").toUpperCase();
    let id = tokens[2] ?? "1";
    let conStartIdx = 3;

    if (model === "USRMDL" && tokens.length >= 4) {
      id = tokens[2] ?? "1";
      model = (tokens[3] ?? "USRMDL").toUpperCase();
      // Skip IC, IT, NI, NC, NS, NV integers if present before CONs
      conStartIdx = Math.min(tokens.length, 10);
    }

    const con: number[] = [];
    for (let k = conStartIdx; k < tokens.length; k++) {
      const val = Number.parseFloat(tokens[k]!);
      if (Number.isFinite(val)) {
        con.push(val);
      }
    }

    const category = classifyDyrModel(model);
    const schema = DYR_MODEL_SCHEMAS[model];
    const namedParams: Record<string, number> = {};
    if (schema) {
      for (let idx = 0; idx < schema.params.length && idx < con.length; idx++) {
        const paramMeta = schema.params[idx]!;
        namedParams[paramMeta.name] = con[idx]!;
      }
    }

    const span: SourceSpan = {
      startOffset,
      endOffset,
      line: lineNum,
      column: 1,
    };

    const rec: PsseDyrRecord = {
      ibus,
      model,
      id: id.trim() || "1",
      category,
      con,
      namedParams,
      span,
    };

    records.push(rec);
    const key = `${ibus}_${rec.id}`;
    if (category === "generator") {
      generatorsByBusId.set(key, rec);
      if (!generatorsByBusId.has(String(ibus))) {
        generatorsByBusId.set(String(ibus), rec);
      }
    } else if (category === "exciter") {
      excitersByBusId.set(key, rec);
      if (!excitersByBusId.has(String(ibus))) {
        excitersByBusId.set(String(ibus), rec);
      }
    } else if (category === "governor") {
      governorsByBusId.set(key, rec);
      if (!governorsByBusId.has(String(ibus))) {
        governorsByBusId.set(String(ibus), rec);
      }
    } else if (category === "stabilizer") {
      stabilizersByBusId.set(key, rec);
      if (!stabilizersByBusId.has(String(ibus))) {
        stabilizersByBusId.set(String(ibus), rec);
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const lineNum = i + 1;
    const lineStart = currentOffset;
    const lineEnd = currentOffset + rawLine.length;
    currentOffset = lineEnd + 1;

    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@!") || trimmed.startsWith("/*")) {
      continue;
    }

    if (currentBuffer.length === 0) {
      recordStartOffset = lineStart;
      recordStartLine = lineNum;
    }

    // Find slash terminator outside of quotes
    let slashIdx = -1;
    let inQuotes = false;
    let qChar = "";
    for (let c = 0; c < rawLine.length; c++) {
      const ch = rawLine[c]!;
      if (inQuotes) {
        if (ch === qChar) inQuotes = false;
      } else if (ch === "'" || ch === '"') {
        inQuotes = true;
        qChar = ch;
      } else if (ch === "/") {
        slashIdx = c;
        break;
      }
    }

    if (slashIdx >= 0) {
      currentBuffer += " " + rawLine.slice(0, slashIdx);
      flushRecord(currentBuffer, recordStartOffset, lineStart + slashIdx + 1, recordStartLine);
      currentBuffer = "";
    } else {
      // Check if the next non-empty line starts a new record (single-line .dyr without trailing '/')
      currentBuffer += " " + rawLine;
      const nextLine = lines[i + 1]?.trim() ?? "";
      if (!nextLine || /^\d+(?:,\s*|\s+)'/.test(nextLine)) {
        flushRecord(currentBuffer, recordStartOffset, lineEnd, recordStartLine);
        currentBuffer = "";
      }
    }
  }

  if (currentBuffer.trim().length > 0) {
    flushRecord(currentBuffer, recordStartOffset, currentOffset, recordStartLine);
  }

  return {
    records,
    generatorsByBusId,
    excitersByBusId,
    governorsByBusId,
    stabilizersByBusId,
  };
}

/**
 * Serializes a `PsseDyrCase` back to canonical PSS/E `.dyr` text format.
 */
export function writeDyr(dyr: PsseDyrCase): string {
  const lines: string[] = [];
  for (const rec of dyr.records) {
    const paddedModel = `'${rec.model.padEnd(6, " ")}'`;
    const conStr = rec.con.map((v) => Number(v.toPrecision(6)).toString()).join(" ");
    lines.push(`${rec.ibus} ${paddedModel} ${rec.id} ${conStr} /`);
  }
  return lines.join("\n") + "\n";
}
