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
  GENTPJ: {
    model: "GENTPJ",
    category: "generator",
    title: "WECC Salient/Round-Rotor Synchronous Generator with Kis Saturation (GENTPJ)",
    description: "Sixth-order synchronous machine model with current-compensated saturation factor Kis.",
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
      { name: "Xdpp", unit: "p.u.", description: "d-axis subtransient reactance X''d" },
      { name: "Xqpp", unit: "p.u.", description: "q-axis subtransient reactance X''q" },
      { name: "Xl", unit: "p.u.", description: "Stator leakage reactance Xl" },
      { name: "S10", unit: "p.u.", description: "Saturation factor S(1.0)" },
      { name: "S12", unit: "p.u.", description: "Saturation factor S(1.2)" },
      { name: "Kis", unit: "p.u.", description: "Stator current saturation compensation factor Kis" },
    ],
  },
  GENSAE: {
    model: "GENSAE",
    category: "generator",
    title: "Salient-Pole Generator with Exponential Saturation",
    description: "Fifth-order salient-pole synchronous machine with exponential magnetic saturation.",
    params: [
      { name: "Td0p", unit: "s", description: "d-axis transient open-circuit time constant T'd0" },
      { name: "Td0pp", unit: "s", description: "d-axis subtransient open-circuit time constant T''d0" },
      { name: "Tq0pp", unit: "s", description: "q-axis subtransient open-circuit time constant T''q0" },
      { name: "H", unit: "MW·s/MVA", description: "Inertia constant H" },
      { name: "D", unit: "p.u.", description: "Speed damping coefficient D" },
      { name: "Xd", unit: "p.u.", description: "d-axis synchronous reactance Xd" },
      { name: "Xq", unit: "p.u.", description: "q-axis synchronous reactance Xq" },
      { name: "Xdp", unit: "p.u.", description: "d-axis transient reactance X'd" },
      { name: "Xdpp", unit: "p.u.", description: "Subtransient reactance X''d" },
      { name: "Xl", unit: "p.u.", description: "Stator leakage reactance Xl" },
    ],
  },
  REGC_B: {
    model: "REGC_B",
    category: "generator",
    title: "WECC Renewable Energy Generator/Converter Model B",
    description: "High-bandwidth voltage/current-controlled renewable inverter generator interface.",
    params: [
      { name: "Tg", unit: "s", description: "Converter time constant Tg" },
      { name: "Rrpwr", unit: "p.u./s", description: "Active current recovery ramp limit Rrpwr" },
      { name: "Brkpt", unit: "p.u.", description: "LVPL breakpoint voltage Brkpt" },
      { name: "Zerox", unit: "p.u.", description: "LVPL zero crossing voltage Zerox" },
      { name: "Lvpl1", unit: "p.u.", description: "LVPL current gain Lvpl1" },
      { name: "Vtmax", unit: "p.u.", description: "High-voltage limit Vtmax" },
      { name: "Lvpnt0", unit: "p.u.", description: "Low-voltage threshold 0 Lvpnt0" },
      { name: "Lvpnt1", unit: "p.u.", description: "Low-voltage threshold 1 Lvpnt1" },
      { name: "Iolim", unit: "p.u.", description: "Reactive current limit Iolim" },
      { name: "Tfltr", unit: "s", description: "Voltage filter time constant Tfltr" },
    ],
  },
  REGC_C: {
    model: "REGC_C",
    category: "generator",
    title: "WECC Grid-Forming / Inner-Loop Renewable Converter Model C",
    description: "Grid-forming and inner-current-loop renewable inverter generator model.",
    params: [
      { name: "Tg", unit: "s", description: "Converter time constant Tg" },
      { name: "Kppll", unit: "rad/s", description: "PLL proportional gain Kppll" },
      { name: "Kipll", unit: "rad/s²", description: "PLL integral gain Kipll" },
      { name: "Imax", unit: "p.u.", description: "Converter maximum current limit Imax" },
    ],
  },
  WTGARA: {
    model: "WTGARA",
    category: "generator",
    title: "WECC Wind Turbine Aerodynamic Model",
    description: "Blade pitch angle and wind speed aerodynamic torque conversion model.",
    params: [
      { name: "Ka", unit: "p.u./deg", description: "Aerodynamic pitch sensitivity factor Ka" },
      { name: "Theta0", unit: "deg", description: "Initial blade pitch angle Theta0" },
    ],
  },
  ESAC1A: {
    model: "ESAC1A",
    category: "exciter",
    title: "IEEE Type AC1A Alternator-Rectifier Excitation System",
    description: "Brushless alternator-rectifier excitation system with non-controlled rectifiers.",
    params: [
      { name: "TR", unit: "s", description: "Transducer filter time constant TR" },
      { name: "TB", unit: "s", description: "Regulator lag time constant TB" },
      { name: "TC", unit: "s", description: "Regulator lead time constant TC" },
      { name: "KA", unit: "p.u.", description: "Regulator gain KA" },
      { name: "TA", unit: "s", description: "Regulator time constant TA" },
      { name: "VRMAX", unit: "p.u.", description: "Maximum regulator output VRMAX" },
      { name: "VRMIN", unit: "p.u.", description: "Minimum regulator output VRMIN" },
      { name: "TE", unit: "s", description: "Exciter time constant TE" },
      { name: "KF", unit: "p.u.", description: "Rate feedback gain KF" },
      { name: "TF", unit: "s", description: "Rate feedback time constant TF" },
    ],
  },
  ESAC4A: {
    model: "ESAC4A",
    category: "exciter",
    title: "IEEE Type AC4A Alternator-Supplied Controlled-Rectifier Exciter",
    description: "High-initial-response alternator-supplied thyristor excitation system.",
    params: [
      { name: "TR", unit: "s", description: "Voltage transducer time constant TR" },
      { name: "VIMAX", unit: "p.u.", description: "Maximum error input VIMAX" },
      { name: "VIMIN", unit: "p.u.", description: "Minimum error input VIMIN" },
      { name: "TC", unit: "s", description: "Lead time constant TC" },
      { name: "TB", unit: "s", description: "Lag time constant TB" },
      { name: "KA", unit: "p.u.", description: "Regulator gain KA" },
      { name: "TA", unit: "s", description: "Regulator time constant TA" },
      { name: "VRMAX", unit: "p.u.", description: "Maximum regulator output VRMAX" },
      { name: "VRMIN", unit: "p.u.", description: "Minimum regulator output VRMIN" },
      { name: "KC", unit: "p.u.", description: "Rectifier loading factor KC" },
    ],
  },
  ESST1A: {
    model: "ESST1A",
    category: "exciter",
    title: "IEEE Type ST1A Potential-Source Controlled-Rectifier Exciter",
    description: "IEEE Std 421.5 ST1A static excitation system with UEL/OEL inputs and transient gain reduction.",
    params: [
      { name: "TR", unit: "s", description: "Voltage sensing time constant TR" },
      { name: "VIMAX", unit: "p.u.", description: "Maximum voltage error limit VIMAX" },
      { name: "VIMIN", unit: "p.u.", description: "Minimum voltage error limit VIMIN" },
      { name: "TC", unit: "s", description: "Lead time constant TC" },
      { name: "TB", unit: "s", description: "Lag time constant TB" },
      { name: "TC1", unit: "s", description: "Second lead time constant TC1" },
      { name: "TB1", unit: "s", description: "Second lag time constant TB1" },
      { name: "KA", unit: "p.u.", description: "Voltage regulator gain KA" },
      { name: "TA", unit: "s", description: "Voltage regulator time constant TA" },
      { name: "VAMAX", unit: "p.u.", description: "Maximum amplifier internal output VAMAX" },
      { name: "VAMIN", unit: "p.u.", description: "Minimum amplifier internal output VAMIN" },
      { name: "VRMAX", unit: "p.u.", description: "Maximum exciter ceiling voltage VRMAX" },
      { name: "VRMIN", unit: "p.u.", description: "Minimum exciter ceiling voltage VRMIN" },
      { name: "KC", unit: "p.u.", description: "Rectifier commutation factor KC" },
      { name: "KF", unit: "p.u.", description: "Rate feedback gain KF" },
      { name: "TF", unit: "s", description: "Rate feedback time constant TF" },
    ],
  },
  ESST4B: {
    model: "ESST4B",
    category: "exciter",
    title: "IEEE Type ST4B Potential- or Compound-Source Controlled-Rectifier Exciter",
    description: "Proportional-integral (PI) outer voltage loop and inner field-voltage regulator static exciter.",
    params: [
      { name: "TR", unit: "s", description: "Transducer filter time constant TR" },
      { name: "KPR", unit: "p.u.", description: "Voltage regulator proportional gain KPR" },
      { name: "KIR", unit: "p.u./s", description: "Voltage regulator integral gain KIR" },
      { name: "VRMAX", unit: "p.u.", description: "Maximum regulator output VRMAX" },
      { name: "VRMIN", unit: "p.u.", description: "Minimum regulator output VRMIN" },
      { name: "TA", unit: "s", description: "Thyristor bridge firing delay time constant TA" },
      { name: "KPM", unit: "p.u.", description: "Inner loop proportional gain KPM" },
      { name: "KIM", unit: "p.u./s", description: "Inner loop integral gain KIM" },
      { name: "VMMAX", unit: "p.u.", description: "Maximum inner loop output VMMAX" },
      { name: "VMMIN", unit: "p.u.", description: "Minimum inner loop output VMMIN" },
      { name: "KG", unit: "p.u.", description: "Feedback gain KG" },
      { name: "KP", unit: "p.u.", description: "Potential circuit gain coefficient KP" },
      { name: "KI", unit: "p.u.", description: "Potential circuit current coefficient KI" },
      { name: "VBMAX", unit: "p.u.", description: "Maximum available exciter voltage VBMAX" },
      { name: "KC", unit: "p.u.", description: "Rectifier loading factor KC" },
      { name: "XL", unit: "p.u.", description: "Reactance associated with potential source XL" },
      { name: "THETAP", unit: "deg", description: "Rectifier firing phase angle THETAP" },
    ],
  },
  EXAC1: {
    model: "EXAC1",
    category: "exciter",
    title: "IEEE Type AC1 Alternator-Rectifier Excitation System",
    description: "Brushless excitation system with rotating diode bridge and demagnetizing factor KD.",
    params: [
      { name: "TR", unit: "s", description: "Filter time constant TR" },
      { name: "TB", unit: "s", description: "Lag time constant TB" },
      { name: "TC", unit: "s", description: "Lead time constant TC" },
      { name: "KA", unit: "p.u.", description: "Regulator gain KA" },
      { name: "TA", unit: "s", description: "Regulator time constant TA" },
      { name: "VRMAX", unit: "p.u.", description: "Maximum regulator output VRMAX" },
      { name: "VRMIN", unit: "p.u.", description: "Minimum regulator output VRMIN" },
      { name: "TE", unit: "s", description: "Exciter time constant TE" },
      { name: "KF", unit: "p.u.", description: "Rate feedback gain KF" },
      { name: "TF", unit: "s", description: "Rate feedback time constant TF" },
    ],
  },
  EXAC2: {
    model: "EXAC2",
    category: "exciter",
    title: "IEEE Type AC2 High-Initial-Response Brushless Exciter",
    description: "Alternator-rectifier exciter with field current feedback loop.",
    params: [
      { name: "TR", unit: "s", description: "Transducer filter time constant TR" },
      { name: "TB", unit: "s", description: "Lag time constant TB" },
      { name: "TC", unit: "s", description: "Lead time constant TC" },
      { name: "KA", unit: "p.u.", description: "Amplifier gain KA" },
      { name: "TA", unit: "s", description: "Amplifier time constant TA" },
      { name: "VAMAX", unit: "p.u.", description: "Maximum amplifier output VAMAX" },
      { name: "VAMIN", unit: "p.u.", description: "Minimum amplifier output VAMIN" },
      { name: "KB", unit: "p.u.", description: "Second stage regulator gain KB" },
      { name: "VRMAX", unit: "p.u.", description: "Maximum field regulator output VRMAX" },
      { name: "VRMIN", unit: "p.u.", description: "Minimum field regulator output VRMIN" },
      { name: "TE", unit: "s", description: "Exciter field time constant TE" },
    ],
  },
  SCRX: {
    model: "SCRX",
    category: "exciter",
    title: "Bus- or Solid-Fed SCR Static Exciter Model",
    description: "High-gain thyristor bus-fed or compound-fed static exciter with negative field current capability.",
    params: [
      { name: "TATB", unit: "ratio", description: "Lead/lag ratio TA/TB" },
      { name: "TB", unit: "s", description: "Lag time constant TB" },
      { name: "K", unit: "p.u.", description: "Exciter regulator gain K" },
      { name: "TE", unit: "s", description: "Thyristor bridge time constant TE" },
      { name: "EMIN", unit: "p.u.", description: "Minimum field voltage EMIN" },
      { name: "EMAX", unit: "p.u.", description: "Maximum field voltage EMAX" },
      { name: "CSWITCH", unit: "flag", description: "Power source switch (0=bus-fed, 1=independent)" },
      { name: "RCFD", unit: "ratio", description: "Crowbar/field discharge resistance ratio r_c/r_fd" },
    ],
  },
  IEEEX1: {
    model: "IEEEX1",
    category: "exciter",
    title: "IEEE Type 1 Excitation System with Saturation",
    description: "Standard DC commutator exciter with regulator limits and stabilizing feedback.",
    params: [
      { name: "TR", unit: "s", description: "Filter time constant TR" },
      { name: "KA", unit: "p.u.", description: "Regulator gain KA" },
      { name: "TA", unit: "s", description: "Regulator time constant TA" },
      { name: "TB", unit: "s", description: "Lag time constant TB" },
      { name: "TC", unit: "s", description: "Lead time constant TC" },
      { name: "VRMAX", unit: "p.u.", description: "Maximum regulator output VRMAX" },
      { name: "VRMIN", unit: "p.u.", description: "Minimum regulator output VRMIN" },
      { name: "KE", unit: "p.u.", description: "Exciter constant KE" },
      { name: "TE", unit: "s", description: "Exciter time constant TE" },
    ],
  },
  REEC_B: {
    model: "REEC_B",
    category: "exciter",
    title: "WECC Renewable Energy Electrical Control Model B (Solar PV / BESS)",
    description:
      "Electrical control model for utility-scale solar PV and battery storage without fault current freezing.",
    params: [
      { name: "Vdip", unit: "p.u.", description: "Low-voltage dip threshold Vdip" },
      { name: "Vup", unit: "p.u.", description: "High-voltage swell threshold Vup" },
      { name: "Trv", unit: "s", description: "Voltage filter time constant Trv" },
      { name: "dbd1", unit: "p.u.", description: "Lower deadband dbd1" },
      { name: "dbd2", unit: "p.u.", description: "Upper deadband dbd2" },
      { name: "Kqv", unit: "p.u.", description: "Reactive current injection gain Kqv" },
      { name: "Iqh1", unit: "p.u.", description: "Max reactive current injection Iqh1" },
      { name: "Iql1", unit: "p.u.", description: "Min reactive current injection Iql1" },
      { name: "Vref0", unit: "p.u.", description: "Voltage reference Vref0" },
      { name: "Tp", unit: "s", description: "Active power filter time constant Tp" },
      { name: "Qmax", unit: "p.u.", description: "Max reactive power Qmax" },
      { name: "Qmin", unit: "p.u.", description: "Min reactive power Qmin" },
      { name: "Vmax", unit: "p.u.", description: "Max voltage limit Vmax" },
      { name: "Vmin", unit: "p.u.", description: "Min voltage limit Vmin" },
      { name: "Kqp", unit: "p.u.", description: "Reactive power proportional gain Kqp" },
      { name: "Kqi", unit: "p.u./s", description: "Reactive power integral gain Kqi" },
      { name: "Kvp", unit: "p.u.", description: "Voltage regulator proportional gain Kvp" },
      { name: "Kvi", unit: "p.u./s", description: "Voltage regulator integral gain Kvi" },
      { name: "Tiq", unit: "s", description: "Reactive current time constant Tiq" },
      { name: "dPmax", unit: "p.u./s", description: "Max active power ramp rate dPmax" },
      { name: "dPmin", unit: "p.u./s", description: "Min active power ramp rate dPmin" },
      { name: "Pmax", unit: "p.u.", description: "Max active power Pmax" },
      { name: "Pmin", unit: "p.u.", description: "Min active power Pmin" },
      { name: "Imax", unit: "p.u.", description: "Max total converter current Imax" },
      { name: "Tpord", unit: "s", description: "Power order lag time constant Tpord" },
    ],
  },
  REEC_C: {
    model: "REEC_C",
    category: "exciter",
    title: "WECC Battery Energy Storage Electrical Control Model (REEC_C)",
    description: "Four-quadrant BESS electrical control model with state-of-charge (SOC) limits.",
    params: [
      { name: "Vdip", unit: "p.u.", description: "Voltage dip threshold Vdip" },
      { name: "Vup", unit: "p.u.", description: "Voltage swell threshold Vup" },
      { name: "Trv", unit: "s", description: "Voltage transducer time constant Trv" },
      { name: "Kqv", unit: "p.u.", description: "Reactive fault current gain Kqv" },
      { name: "SOCini", unit: "p.u.", description: "Initial battery State of Charge SOCini" },
      { name: "SOCmax", unit: "p.u.", description: "Maximum battery State of Charge SOCmax" },
      { name: "SOCmin", unit: "p.u.", description: "Minimum battery State of Charge SOCmin" },
      { name: "Teng", unit: "s", description: "Battery storage energy capacity time constant Teng" },
    ],
  },
  GAST: {
    model: "GAST",
    category: "governor",
    title: "Gas Turbine-Governor Model (GAST)",
    description:
      "Single-shaft industrial gas turbine governor with fuel valve, combustor lag, and exhaust temperature limit.",
    params: [
      { name: "R", unit: "p.u.", description: "Permanent speed droop R" },
      { name: "T1", unit: "s", description: "Fuel valve positioner time constant T1" },
      { name: "T2", unit: "s", description: "Combustion chamber / turbine volume time constant T2" },
      { name: "T3", unit: "s", description: "Exhaust temperature load-limit radiation shield time constant T3" },
      { name: "AT", unit: "p.u.", description: "Ambient temperature load limit AT" },
      { name: "KT", unit: "p.u.", description: "Temperature control loop gain KT" },
      { name: "VMAX", unit: "p.u.", description: "Maximum turbine power limit VMAX" },
      { name: "VMIN", unit: "p.u.", description: "Minimum fuel valve opening VMIN" },
      { name: "Dturb", unit: "p.u.", description: "Turbine rotor damping factor Dturb" },
    ],
  },
  WPID: {
    model: "WPID",
    category: "governor",
    title: "Woodward PID Hydro Turbine-Governor Model",
    description: "PID electronic hydro governor with gate servomotor and penstock water-hammer dynamics.",
    params: [
      { name: "Tw", unit: "s", description: "Water starting time constant Tw" },
      { name: "Tr", unit: "s", description: "Speed transducer time constant Tr" },
      { name: "Kp", unit: "p.u.", description: "PID proportional gain Kp" },
      { name: "Ki", unit: "p.u./s", description: "PID integral gain Ki" },
      { name: "Kd", unit: "p.u.·s", description: "PID derivative gain Kd" },
      { name: "Ta", unit: "s", description: "Pilot servomotor time constant Ta" },
      { name: "Tb", unit: "s", description: "Gate servomotor time constant Tb" },
      { name: "Rperm", unit: "p.u.", description: "Permanent speed droop Rperm" },
      { name: "Velmax", unit: "p.u./s", description: "Maximum gate opening rate Velmax" },
      { name: "Gmax", unit: "p.u.", description: "Maximum gate position Gmax" },
      { name: "Gmin", unit: "p.u.", description: "Minimum gate position Gmin" },
      { name: "D", unit: "p.u.", description: "Turbine damping factor D" },
    ],
  },
  PIDGOV: {
    model: "PIDGOV",
    category: "governor",
    title: "WECC Hydro PID Turbine-Governor Model",
    description: "Three-term PID hydro governor with nonlinear turbine gate-power lookup curve.",
    params: [
      { name: "Tr", unit: "s", description: "Speed detector time constant Tr" },
      { name: "Rperm", unit: "p.u.", description: "Permanent droop Rperm" },
      { name: "Kp", unit: "p.u.", description: "Proportional gain Kp" },
      { name: "Ki", unit: "p.u./s", description: "Integral gain Ki" },
      { name: "Kd", unit: "p.u.·s", description: "Derivative gain Kd" },
      { name: "Ta", unit: "s", description: "Gate servo time constant Ta" },
      { name: "Gmax", unit: "p.u.", description: "Max gate opening Gmax" },
      { name: "Gmin", unit: "p.u.", description: "Min gate opening Gmin" },
      { name: "Tw", unit: "s", description: "Water inertia time constant Tw" },
    ],
  },
  CCGOV1: {
    model: "CCGOV1",
    category: "governor",
    title: "Combined-Cycle Gas & Steam Turbine-Governor Model",
    description: "Combined-cycle single-shaft or multi-shaft gas turbine and HRSG steam turbine governor.",
    params: [
      { name: "R", unit: "p.u.", description: "Speed regulation droop R" },
      { name: "Tpelec", unit: "s", description: "Electrical power filter time constant Tpelec" },
      { name: "Kpgov", unit: "p.u.", description: "Gas governor proportional gain Kpgov" },
      { name: "Kigov", unit: "p.u./s", description: "Gas governor integral gain Kigov" },
      { name: "Tact", unit: "s", description: "Fuel valve actuator time constant Tact" },
      { name: "Kturb", unit: "p.u.", description: "Gas turbine gain Kturb" },
      { name: "Tb", unit: "s", description: "Gas turbine lag time constant Tb" },
      { name: "Twh", unit: "s", description: "Waste-heat boiler / HRSG steam time constant Twh" },
    ],
  },
  DEGOV1: {
    model: "DEGOV1",
    category: "governor",
    title: "Woodward Diesel Engine Speed Governor Model",
    description: "Electronic diesel generator speed governor with actuator lead-lag and combustion delay.",
    params: [
      { name: "T1", unit: "s", description: "Actuator time constant T1" },
      { name: "T2", unit: "s", description: "Actuator time constant T2" },
      { name: "T3", unit: "s", description: "Actuator time constant T3" },
      { name: "K", unit: "p.u.", description: "Actuator gain K" },
      { name: "T4", unit: "s", description: "Electric control box lead time constant T4" },
      { name: "T5", unit: "s", description: "Electric control box lag time constant T5" },
      { name: "T6", unit: "s", description: "Derivative time constant T6" },
      { name: "TD", unit: "s", description: "Engine cylinder firing transport delay TD" },
      { name: "TMAX", unit: "p.u.", description: "Maximum torque limit TMAX" },
      { name: "TMIN", unit: "p.u.", description: "Minimum torque limit TMIN" },
      { name: "R", unit: "p.u.", description: "Permanent droop R" },
    ],
  },
  HYGOVM: {
    model: "HYGOVM",
    category: "governor",
    title: "Modified WECC Hydro Turbine-Governor Model",
    description: "Hydro turbine governor with nonlinear penstock head loss and surge tank effects.",
    params: [
      { name: "R", unit: "p.u.", description: "Permanent droop R" },
      { name: "r", unit: "p.u.", description: "Temporary droop r" },
      { name: "Tr", unit: "s", description: "Dashpot time constant Tr" },
      { name: "Tg", unit: "s", description: "Gate servo time constant Tg" },
      { name: "TW", unit: "s", description: "Water starting time constant TW" },
    ],
  },
  WSIEG1: {
    model: "WSIEG1",
    category: "governor",
    title: "WECC Steam Turbine-Governor Model",
    description: "WECC tandem/cross-compound steam turbine-governor with fast valving capability.",
    params: [
      { name: "K", unit: "p.u.", description: "Governor gain K (1/R)" },
      { name: "T1", unit: "s", description: "Lag time constant T1" },
      { name: "T2", unit: "s", description: "Lead time constant T2" },
      { name: "T3", unit: "s", description: "Valve servo time constant T3" },
      { name: "PMAX", unit: "p.u.", description: "Max power limit PMAX" },
      { name: "PMIN", unit: "p.u.", description: "Min power limit PMIN" },
      { name: "T4", unit: "s", description: "Steam chest time constant T4" },
    ],
  },
  REPC_B: {
    model: "REPC_B",
    category: "governor",
    title: "WECC Renewable Energy Plant Controller Model B",
    description: "Multi-unit plant-level voltage, reactive power, and frequency controller for large IBR plants.",
    params: [
      { name: "Tfltr", unit: "s", description: "Measurement filter time constant Tfltr" },
      { name: "Kp", unit: "p.u.", description: "Reactive/voltage proportional gain Kp" },
      { name: "Ki", unit: "p.u./s", description: "Reactive/voltage integral gain Ki" },
      { name: "Kpg", unit: "p.u.", description: "Active power proportional gain Kpg" },
      { name: "Kig", unit: "p.u./s", description: "Active power integral gain Kig" },
      { name: "Ddn", unit: "p.u.", description: "Over-frequency droop gain Ddn" },
      { name: "Dup", unit: "p.u.", description: "Under-frequency droop gain Dup" },
    ],
  },
  WTDTA1: {
    model: "WTDTA1",
    category: "governor",
    title: "WECC Generic Wind Turbine Two-Mass Drive-Train Model (WTDTA1)",
    description: "Two-mass turbine/generator torsional shaft model for Type 3 and Type 4 wind turbines.",
    params: [
      { name: "H", unit: "MW·s/MVA", description: "Total drive-train inertia constant H" },
      { name: "DAMP", unit: "p.u.", description: "Generator damping coefficient DAMP" },
      { name: "Htfrac", unit: "fraction", description: "Turbine inertia fraction Htfrac = Ht / H" },
      { name: "Freq1", unit: "Hz", description: "First shaft torsional mode natural frequency Freq1" },
      { name: "Dshaft", unit: "p.u.", description: "Shaft mutual torsional damping Dshaft" },
    ],
  },
  WTTQA1: {
    model: "WTTQA1",
    category: "governor",
    title: "WECC Wind Turbine Torque/Speed Control Model",
    description: "Wind turbine rotor speed and active power torque reference controller.",
    params: [
      { name: "Kpp", unit: "p.u.", description: "Torque PI proportional gain Kpp" },
      { name: "Kip", unit: "p.u./s", description: "Torque PI integral gain Kip" },
      { name: "Tp", unit: "s", description: "Power measurement filter time constant Tp" },
      { name: "Twref", unit: "s", description: "Speed reference filter time constant Twref" },
    ],
  },
  WTPTA1: {
    model: "WTPTA1",
    category: "governor",
    title: "WECC Wind Turbine Pitch Angle Control Model",
    description: "Blade pitch servo and PI controller limiting rotor overspeed during faults and high wind.",
    params: [
      { name: "Kiw", unit: "deg/s", description: "Pitch speed controller integral gain Kiw" },
      { name: "Kpw", unit: "deg", description: "Pitch speed controller proportional gain Kpw" },
      { name: "Kic", unit: "deg/s", description: "Pitch power compensation integral gain Kic" },
      { name: "Kpc", unit: "deg", description: "Pitch power compensation proportional gain Kpc" },
      { name: "Tpi", unit: "s", description: "Blade pitch actuator time constant Tpi" },
    ],
  },
  PSS2B: {
    model: "PSS2B",
    category: "stabilizer",
    title: "IEEE Std 421.5 Dual-Input Power System Stabilizer (PSS2B)",
    description: "Extended dual-input accelerating-power stabilizer with three lead-lag stages.",
    params: [
      { name: "Tw1", unit: "s", description: "First washout time constant Tw1" },
      { name: "Tw2", unit: "s", description: "Second washout time constant Tw2" },
      { name: "T6", unit: "s", description: "Input 1 lag time constant T6" },
      { name: "Tw3", unit: "s", description: "Input 2 washout time constant Tw3" },
      { name: "Tw4", unit: "s", description: "Input 2 second washout time constant Tw4" },
      { name: "T7", unit: "s", description: "Input 2 lag time constant T7" },
      { name: "Ks2", unit: "p.u.", description: "Power input gain Ks2" },
      { name: "Ks3", unit: "p.u.", description: "Signal matching gain Ks3" },
      { name: "T8", unit: "s", description: "Ramp-tracking lead time constant T8" },
      { name: "T9", unit: "s", description: "Ramp-tracking lag time constant T9" },
      { name: "Ks1", unit: "p.u.", description: "Main stabilizer gain Ks1" },
      { name: "T1", unit: "s", description: "Stage 1 lead time constant T1" },
      { name: "T2", unit: "s", description: "Stage 1 lag time constant T2" },
      { name: "T3", unit: "s", description: "Stage 2 lead time constant T3" },
      { name: "T4", unit: "s", description: "Stage 2 lag time constant T4" },
      { name: "T10", unit: "s", description: "Stage 3 lead time constant T10" },
      { name: "T11", unit: "s", description: "Stage 3 lag time constant T11" },
      { name: "Vstmax", unit: "p.u.", description: "Maximum stabilizer output Vstmax" },
      { name: "Vstmin", unit: "p.u.", description: "Minimum stabilizer output Vstmin" },
    ],
  },
  PSS4B: {
    model: "PSS4B",
    category: "stabilizer",
    title: "IEEE Multi-Band Power System Stabilizer (MB-PSS / PSS4B)",
    description: "Three-band (low, intermediate, and high frequency) differential-filter power system stabilizer.",
    params: [
      { name: "KL", unit: "p.u.", description: "Low-frequency band gain KL (0.05–0.2 Hz inter-area modes)" },
      { name: "FL", unit: "Hz", description: "Low-frequency band center frequency FL" },
      { name: "KI", unit: "p.u.", description: "Intermediate-frequency band gain KI (0.2–0.8 Hz local modes)" },
      { name: "FI", unit: "Hz", description: "Intermediate-frequency band center frequency FI" },
      { name: "KH", unit: "p.u.", description: "High-frequency band gain KH (0.8–4.0 Hz intra-plant modes)" },
      { name: "FH", unit: "Hz", description: "High-frequency band center frequency FH" },
      { name: "Vstmax", unit: "p.u.", description: "Maximum total output limit Vstmax" },
      { name: "Vstmin", unit: "p.u.", description: "Minimum total output limit Vstmin" },
    ],
  },
  STAB2A: {
    model: "STAB2A",
    category: "stabilizer",
    title: "ASEA / ABB Power-Sensitive Stabilizer",
    description: "Electrical power-input washout and phase-lag power system stabilizer.",
    params: [
      { name: "K2", unit: "p.u.", description: "Washout gain K2" },
      { name: "T2", unit: "s", description: "Washout time constant T2" },
      { name: "K3", unit: "p.u.", description: "Phase compensation gain K3" },
      { name: "T3", unit: "s", description: "Phase lag time constant T3" },
      { name: "T4", unit: "s", description: "High-frequency filter time constant T4" },
      { name: "T5", unit: "s", description: "Filter lag time constant T5" },
      { name: "HLIM", unit: "p.u.", description: "Stabilizer output limit HLIM" },
    ],
  },
  CMPLDW: {
    model: "CMPLDW",
    category: "load",
    title: "WECC Composite Load Model (CMPLDW) with FIDVR & Motor Stall",
    description:
      "Substation transformer, feeder equivalent impedance, 3-phase induction motors A/B/C, 1-phase A/C compressor motor D (with voltage stall protection), power electronic load, and static ZIP load.",
    params: [
      { name: "MVA", unit: "MVA", description: "Load substation base MVA (<0 = fraction of bus load)" },
      { name: "Rfdr", unit: "p.u.", description: "Equivalent distribution feeder resistance Rfdr" },
      { name: "Xfdr", unit: "p.u.", description: "Equivalent distribution feeder reactance Xfdr" },
      { name: "Fb", unit: "fraction", description: "Fraction of feeder impedance before shunt capacitor Fb" },
      { name: "Fma", unit: "fraction", description: "Motor A (3-ph constant-torque commercial A/C) load fraction" },
      { name: "Fmb", unit: "fraction", description: "Motor B (3-ph high-inertia fan/pump) load fraction" },
      { name: "Fmc", unit: "fraction", description: "Motor C (3-ph low-inertia pump) load fraction" },
      { name: "Fmd", unit: "fraction", description: "Motor D (1-ph residential A/C compressor with stall) fraction" },
      { name: "Fel", unit: "fraction", description: "Power electronic constant-P/Q load fraction Fel" },
      { name: "Vstall", unit: "p.u.", description: "Motor D single-phase compressor stall threshold voltage Vstall" },
      { name: "Tstall", unit: "s", description: "Motor D stall delay time Tstall (typically 0.033 s)" },
      { name: "Rstall", unit: "p.u.", description: "Motor D stalled rotor resistance Rstall" },
      { name: "Xstall", unit: "p.u.", description: "Motor D stalled rotor reactance Xstall" },
    ],
  },
  CLOD: {
    model: "CLOD",
    category: "load",
    title: "Complex Load Model (Large/Small Motors, Discharge Lighting, & KP)",
    description:
      "Aggregate substation dynamic load model comprising large/small induction motors, transformer excitation, and discharge lighting.",
    params: [
      { name: "PctLargeMotor", unit: "%", description: "Percentage of large induction motors" },
      { name: "PctSmallMotor", unit: "%", description: "Percentage of small induction motors" },
      { name: "PctTransformer", unit: "%", description: "Percentage of transformer exciting current" },
      { name: "PctLighting", unit: "%", description: "Percentage of discharge lighting" },
      { name: "PctConstP", unit: "%", description: "Percentage of constant-power load" },
      { name: "Kp", unit: "exponent", description: "Remaining active load voltage exponent Kp" },
      { name: "Rbranch", unit: "p.u.", description: "Substation feeder resistance Rbranch" },
      { name: "Xbranch", unit: "p.u.", description: "Substation feeder reactance Xbranch" },
    ],
  },
  CIM5: {
    model: "CIM5",
    category: "load",
    title: "Fifth-Order Double-Cage Induction Motor Load Model (CIM5)",
    description: "Dynamic 5th-order squirrel-cage or double-cage industrial induction motor load model.",
    params: [
      { name: "Ra", unit: "p.u.", description: "Stator armature resistance Ra" },
      { name: "Xa", unit: "p.u.", description: "Stator leakage reactance Xa" },
      { name: "Xm", unit: "p.u.", description: "Magnetizing reactance Xm" },
      { name: "R1", unit: "p.u.", description: "Rotor cage 1 resistance R1" },
      { name: "X1", unit: "p.u.", description: "Rotor cage 1 leakage reactance X1" },
      { name: "R2", unit: "p.u.", description: "Rotor cage 2 resistance R2" },
      { name: "X2", unit: "p.u.", description: "Rotor cage 2 leakage reactance X2" },
      { name: "H", unit: "MW·s/MVA", description: "Motor + mechanical load inertia constant H" },
      { name: "D", unit: "exponent", description: "Load torque speed exponent D (T_m = T_0 * omega^D)" },
    ],
  },
  IEEEL: {
    model: "IEEEL",
    category: "load",
    title: "IEEE Polynomial & Frequency-Dependent Static Load Model",
    description: "Voltage-polynomial (ZIP) and frequency-sensitivity dynamic load representation.",
    params: [
      { name: "a1", unit: "fraction", description: "Active load constant-impedance fraction a1" },
      { name: "a2", unit: "fraction", description: "Active load constant-current fraction a2" },
      { name: "a3", unit: "fraction", description: "Active load constant-power fraction a3" },
      { name: "a4", unit: "fraction", description: "Reactive load constant-impedance fraction a4" },
      { name: "a5", unit: "fraction", description: "Reactive load constant-current fraction a5" },
      { name: "a6", unit: "fraction", description: "Reactive load constant-power fraction a6" },
      { name: "a7", unit: "p.u./p.u.", description: "Active load frequency sensitivity factor a7" },
      { name: "a8", unit: "p.u./p.u.", description: "Reactive load frequency sensitivity factor a8" },
    ],
  },
  SVSMO1: {
    model: "SVSMO1",
    category: "facts",
    title: "WECC Static Var Compensator (SVC) Model 1",
    description: "Thyristor-Controlled Reactor (TCR) and Thyristor-Switched Capacitor (TSC) continuous SVC model.",
    params: [
      { name: "Tr", unit: "s", description: "Voltage transducer time constant Tr" },
      { name: "K", unit: "p.u.", description: "Voltage regulator proportional gain K" },
      { name: "T1", unit: "s", description: "Lead time constant T1" },
      { name: "T2", unit: "s", description: "Lag time constant T2" },
      { name: "T3", unit: "s", description: "Thyristor firing delay time constant T3" },
      { name: "Bmax", unit: "p.u.", description: "Maximum capacitive susceptance limit Bmax" },
      { name: "Bmin", unit: "p.u.", description: "Minimum inductive susceptance limit Bmin" },
      { name: "Xsl", unit: "p.u.", description: "SVC V-I droop slope Xsl" },
    ],
  },
  SVSMO3: {
    model: "SVSMO3",
    category: "facts",
    title: "WECC Static Synchronous Compensator (STATCOM) Model (SVSMO3)",
    description: "Voltage-source converter STATCOM dynamic reactive current controller.",
    params: [
      { name: "Tr", unit: "s", description: "Voltage measurement filter time constant Tr" },
      { name: "Kp", unit: "p.u.", description: "Voltage regulator proportional gain Kp" },
      { name: "Ki", unit: "p.u./s", description: "Voltage regulator integral gain Ki" },
      { name: "Imax", unit: "p.u.", description: "Maximum capacitive current limit Imax" },
      { name: "Imin", unit: "p.u.", description: "Maximum inductive current limit Imin" },
      { name: "Xsl", unit: "p.u.", description: "STATCOM droop slope Xsl" },
    ],
  },
  CSTCNT: {
    model: "CSTCNT",
    category: "facts",
    title: " Controlled Series Capacitor / TCSC Dynamic Model",
    description: "Thyristor-Controlled Series Capacitor (TCSC) power oscillation damping and reactance controller.",
    params: [
      { name: "Tr", unit: "s", description: "Transducer time constant Tr" },
      { name: "Kp", unit: "p.u.", description: "Controller proportional gain Kp" },
      { name: "Ki", unit: "p.u./s", description: "Controller integral gain Ki" },
      { name: "Bmax", unit: "p.u.", description: "Maximum series reactance boost limit Bmax" },
      { name: "Bmin", unit: "p.u.", description: "Minimum series reactance limit Bmin" },
    ],
  },
  CDC4T: {
    model: "CDC4T",
    category: "hvdc",
    title: "Two-Terminal LCC HVDC Line Dynamic Model with VDCOL (CDC4T)",
    description:
      "Line-commutated converter (LCC) two-terminal HVDC link with Voltage-Dependent Current Order Limiter (VDCOL).",
    params: [
      { name: "AlfaDy", unit: "deg", description: "Minimum dynamic rectifier firing angle AlfaDy" },
      { name: "GamDy", unit: "deg", description: "Minimum dynamic inverter extinction angle GamDy" },
      { name: "Tvdc", unit: "s", description: "DC voltage transducer time constant Tvdc" },
      { name: "Tidc", unit: "s", description: "DC current transducer time constant Tidc" },
      { name: "Vblock", unit: "p.u.", description: "AC voltage blocking threshold Vblock" },
      { name: "VdcolV1", unit: "kV", description: "VDCOL lower voltage knee VdcolV1" },
      { name: "VdcolI1", unit: "p.u.", description: "VDCOL minimum current order VdcolI1" },
      { name: "VdcolV2", unit: "kV", description: "VDCOL upper voltage knee VdcolV2" },
      { name: "VdcolI2", unit: "p.u.", description: "VDCOL nominal current order VdcolI2" },
    ],
  },
  VSC_DC: {
    model: "VSC_DC",
    category: "hvdc",
    title: "Voltage Source Converter (VSC) HVDC Dynamic Link Model",
    description: "Point-to-point VSC-HVDC link with independent P/Vdc and Q/Vac control at rectifier and inverter.",
    params: [
      { name: "Tp", unit: "s", description: "Active power order filter time constant Tp" },
      { name: "Tq", unit: "s", description: "Reactive power / AC voltage regulator time constant Tq" },
      { name: "Kvac", unit: "p.u.", description: "AC voltage droop gain Kvac" },
      { name: "Imax", unit: "p.u.", description: "Maximum converter current rating Imax" },
    ],
  },
};

function classifyDyrModel(modelName: string): PsseDyrCategory {
  const upper = modelName.toUpperCase();
  const schema = DYR_MODEL_SCHEMAS[upper];
  if (schema) return schema.category;
  if (upper.startsWith("GEN") || upper.startsWith("REG") || upper.startsWith("WTGAR")) return "generator";
  if (
    upper.startsWith("EX") ||
    upper.startsWith("REEC") ||
    upper.startsWith("IEEE") ||
    upper.startsWith("ES") ||
    upper.startsWith("SEXS") ||
    upper.startsWith("SCRX")
  ) {
    return "exciter";
  }
  if (
    upper.startsWith("TG") ||
    upper.startsWith("HY") ||
    upper.startsWith("GG") ||
    upper.startsWith("GAST") ||
    upper.startsWith("WPID") ||
    upper.startsWith("PIDG") ||
    upper.startsWith("CCGO") ||
    upper.startsWith("DEGO") ||
    upper.startsWith("WSIE") ||
    upper.startsWith("REPC") ||
    upper.startsWith("WT")
  ) {
    return "governor";
  }
  if (upper.startsWith("PSS") || upper.startsWith("STAB")) return "stabilizer";
  if (upper.startsWith("CMPL") || upper.startsWith("CLOD") || upper.startsWith("CIM") || upper.startsWith("LDFR")) {
    return "load";
  }
  if (upper.startsWith("SVS") || upper.startsWith("CSTC") || upper.startsWith("STAT")) {
    return "facts";
  }
  if (upper.startsWith("CDC") || upper.startsWith("VSC")) {
    return "hvdc";
  }
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
    // A .dyr record starts with an integer bus number followed by a quoted model name like 'GENROU' or 'CMPLDW'
    if (
      /^\d+(?:,\s*|\s+)'(?:GEN|EX|TG|HY|IEEE|SEXS|SCRX|PSS|STAB|USR|REG|REE|REP|WT|GGOV|GAST|WPID|PIDG|CCGO|DEGO|WSIE|ES|CMPL|CLOD|CIM|SVS|CST|CDC|VSC)/i.test(
        line,
      )
    ) {
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
  const loadsByBusId = new Map<string, PsseDyrRecord>();
  const factsByBusId = new Map<string, PsseDyrRecord>();

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
    } else if (category === "load") {
      loadsByBusId.set(key, rec);
      if (!loadsByBusId.has(String(ibus))) {
        loadsByBusId.set(String(ibus), rec);
      }
    } else if (category === "facts" || category === "hvdc") {
      factsByBusId.set(key, rec);
      if (!factsByBusId.has(String(ibus))) {
        factsByBusId.set(String(ibus), rec);
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
    loadsByBusId,
    factsByBusId,
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
