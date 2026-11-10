// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Linear-Memory DAE Arena Lowering for SEL Relay Protection & SELogic Equations.
 *
 * Compiles relay settings, pickup thresholds, and logic gates directly into ModelScript's
 * zero-GC DAEBuilder arena for hardware-in-the-loop protection co-simulation.
 */

import { Causality, DAEBuilder, EqKind, ExprKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import type { SELRelaySettings, SettingsGroup } from "../types.js";

export interface SelDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

/**
 * Lowers SEL relay settings into a DAEBuilder linear-memory arena.
 */
export function lowerSELToDae(settings: SELRelaySettings, options?: SelDaeOptions): DAEBuilder {
  const rawName = options?.modelName ?? settings.relayId ?? "SEL_Relay";
  const modelName = rawName.replace(/[^a-zA-Z0-9_]/g, "_");
  const interner = new StringInterner();
  const dae = options?.builder ?? new DAEBuilder(interner, modelName);

  const group: SettingsGroup = settings.groups.get(settings.activeGroup) ??
    settings.groups.values().next().value ?? { groupId: 1, equations: {} };

  // 1. Time variable
  dae.addVariable("time", VarType.Real, Variability.Continuous, Causality.Input, 0.0);

  // 2. Analog Input Channels (Phase currents, voltages, frequency, fault impedance)
  const analogInputs = [
    { name: "i_phase", initial: 0.0 },
    { name: "i_ground", initial: 0.0 },
    { name: "v_phase", initial: 120.0 },
    { name: "freq", initial: settings.frequencyHz },
    { name: "z_fault", initial: 999.0 },
  ];

  for (const sig of analogInputs) {
    dae.addVariable(sig.name, VarType.Real, Variability.Continuous, Causality.Input, sig.initial);
    const vId = interner.intern(sig.name);
    const vExpr = dae.addExpression(ExprKind.Name, vId);
    const initLit = dae.addRealLiteral(sig.initial);
    dae.addEquation(EqKind.Simple, vExpr, initLit);
  }

  // 3. Digital Hardware Inputs (IN101..IN108)
  for (let i = 1; i <= 8; i++) {
    const inName = `in10${i}`;
    dae.addVariable(inName, VarType.Integer, Variability.Discrete, Causality.Input, 0);
    const vId = interner.intern(inName);
    const vExpr = dae.addExpression(ExprKind.Name, vId);
    const initLit = dae.addIntLiteral(0);
    dae.addEquation(EqKind.Simple, vExpr, initLit);
  }

  // 4. Relay Parameters (CT/PT ratios, Pickup thresholds, Reach)
  dae.addVariable("ct_ratio_phase", VarType.Real, Variability.Parameter, Causality.Local, settings.ratios.ctRatioPhase);
  dae.addVariable("pt_ratio_phase", VarType.Real, Variability.Parameter, Causality.Local, settings.ratios.ptRatioPhase);

  const po = group.phaseOvercurrent;
  if (po?.inst50P1P !== undefined) {
    dae.addVariable("pickup_50p1p", VarType.Real, Variability.Parameter, Causality.Local, po.inst50P1P);
  }
  if (po?.time51P1P !== undefined) {
    dae.addVariable("pickup_51p1p", VarType.Real, Variability.Parameter, Causality.Local, po.time51P1P);
  }
  if (po?.timeDial51P1TD !== undefined) {
    dae.addVariable("time_dial_51p1td", VarType.Real, Variability.Parameter, Causality.Local, po.timeDial51P1TD);
  }

  const dist = group.distance;
  if (dist?.zone1Reach !== undefined) {
    dae.addVariable("reach_z1p", VarType.Real, Variability.Parameter, Causality.Local, dist.zone1Reach);
  }
  if (dist?.zone2Reach !== undefined) {
    dae.addVariable("reach_z2p", VarType.Real, Variability.Parameter, Causality.Local, dist.zone2Reach);
  }

  // 5. Output Contact Relays & SELogic Targets (TRIP, CLOSE, OUT101..108, SV01..16)
  const digitalOutputs = ["trip", "close"];
  for (let i = 1; i <= 8; i++) {
    digitalOutputs.push(`out10${i}`);
  }
  for (let i = 1; i <= 4; i++) {
    digitalOutputs.push(`sv0${i}`);
  }

  for (const outName of digitalOutputs) {
    dae.addVariable(outName, VarType.Integer, Variability.Discrete, Causality.Output, 0);
    const vId = interner.intern(outName);
    const vExpr = dae.addExpression(ExprKind.Name, vId);
    const initLit = dae.addIntLiteral(0);
    dae.addEquation(EqKind.Simple, vExpr, initLit);
  }

  return dae;
}
