// SPDX-License-Identifier: AGPL-3.0-or-later

import { Causality, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { DaeArchetypeId } from "../../schema/index.js";
import type { PsseDyrRecord } from "../../types.js";
import {
  add,
  addReal,
  div,
  emitClamp,
  emitFirstOrderLag,
  emitLeadLag,
  emitWashout,
  mul,
  sub,
  type DaeBlockContext,
} from "../blocks.js";
import type { GeneratorSteadyInit } from "../init-steady-state.js";

/**
 * Lowers single-input (`IEEEST`/`STAB1`), dual-input accelerating-power (`PSS2A`/`PSS2B`/`PSS3B`),
 * and multi-band (`PSS4B`) stabilizers into `DAEBuilder`, returning `Vs_${genKey}` expression ID.
 */
export function lowerStabilizerUnitToDae(
  ctx: DaeBlockContext,
  genInit: GeneratorSteadyInit,
  dyrPss: PsseDyrRecord,
  archetype: DaeArchetypeId,
  omega0: number,
  omegaExpr: number,
  peExpr: number,
): number {
  const { dae } = ctx;
  const gId = genInit.genKey;
  const np = dyrPss.namedParams;
  const dwPu = div(dae, sub(dae, omegaExpr, addReal(dae, omega0)), addReal(dae, omega0));
  const pePu0 = genInit.pgMw / genInit.mbase;
  const pePu = div(dae, peExpr, addReal(dae, genInit.mbase));

  dae.addVariable(`Vs_pss_${gId}`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const vsOutExpr = dae.addNameExpr(`Vs_pss_${gId}`);

  if (archetype === "pss_dual_ramptrack") {
    const tw1 = Math.max(0.0, np["Tw1"] ?? 5.0);
    const tw2 = Math.max(0.0, np["Tw2"] ?? 5.0);
    const tw3 = Math.max(0.0, np["Tw3"] ?? 5.0);
    const t6 = Math.max(0.0, np["T6"] ?? 0.0);
    const t7 = Math.max(0.0, np["T7"] ?? 5.0);
    const ks2 = np["Ks2"] ?? 0.5;
    const ks3 = np["Ks3"] ?? 1.0;
    const t8 = Math.max(0.0, np["T8"] ?? 0.5);
    const t9 = Math.max(0.0, np["T9"] ?? 0.1);
    const ks1 = np["Ks1"] ?? np["KS"] ?? np["K"] ?? 10.0;
    const t1 = Math.max(0.0, np["T1"] ?? 0.25);
    const t2 = Math.max(0.0, np["T2"] ?? 0.04);
    const t3 = Math.max(0.0, np["T3"] ?? 0.15);
    const t4 = Math.max(0.0, np["T4"] ?? 0.03);
    const t10 = Math.max(0.0, np["T10"] ?? 0.0);
    const t11 = Math.max(0.0, np["T11"] ?? 0.0);
    const vstMax = Math.max(0.0, np["Vstmax"] ?? np["HLIM"] ?? 0.1);
    const vstMin = Math.min(0.0, np["Vstmin"] ?? -vstMax);

    // Signal 1 (speed) washouts + transducer
    const u1f = emitFirstOrderLag(ctx, `xu1_pss_${gId}`, dwPu, addReal(dae, 1.0), addReal(dae, t6), t6, 0.0);
    const w1 = emitWashout(ctx, `xw1_pss_${gId}`, u1f, addReal(dae, 1.0), addReal(dae, tw1), tw1, 0.0, 1.0);
    const w2 =
      tw2 > 1e-6 ? emitWashout(ctx, `xw2_pss_${gId}`, w1, addReal(dae, 1.0), addReal(dae, tw2), tw2, 0.0, 1.0) : w1;

    // Signal 2 (electrical power) washout + transducer -> electrical power integral proxy
    const w3 = emitWashout(ctx, `xw3_pss_${gId}`, pePu, addReal(dae, ks2), addReal(dae, tw3), tw3, pePu0, ks2);
    const pEq = emitFirstOrderLag(ctx, `xp2_pss_${gId}`, w3, addReal(dae, 1.0), addReal(dae, t7), t7, 0.0);

    // Ramp-tracking filter + 3 lead-lag stages
    const sigSum = add(dae, w2, mul(dae, addReal(dae, ks3), pEq));
    const rtf = emitLeadLag(ctx, `xrtf_pss_${gId}`, sigSum, addReal(dae, t8), addReal(dae, t9), t9, 0.0);
    const scaled = mul(dae, addReal(dae, ks1), rtf);
    const ll1 = emitLeadLag(ctx, `xll1_pss_${gId}`, scaled, addReal(dae, t1), addReal(dae, t2), t2, 0.0);
    const ll2 = emitLeadLag(ctx, `xll2_pss_${gId}`, ll1, addReal(dae, t3), addReal(dae, t4), t4, 0.0);
    const ll3 = emitLeadLag(ctx, `xll3_pss_${gId}`, ll2, addReal(dae, t10), addReal(dae, t11), t11, 0.0);

    dae.addEquation(EqKind.Simple, vsOutExpr, emitClamp(ctx, ll3, addReal(dae, vstMin), addReal(dae, vstMax)));
    return vsOutExpr;
  }

  if (archetype === "pss_multiband_4b") {
    const kl = np["KL"] ?? 5.0;
    const fl = Math.max(0.01, np["FL"] ?? 0.08);
    const ki = np["KI"] ?? 15.0;
    const fi = Math.max(0.05, np["FI"] ?? 0.65);
    const kh = np["KH"] ?? 25.0;
    const fh = Math.max(0.1, np["FH"] ?? 2.0);
    const vstMax = Math.max(0.0, np["Vstmax"] ?? 0.15);
    const vstMin = Math.min(0.0, np["Vstmin"] ?? -vstMax);

    const bandSignal = (band: string, k: number, fCenter: number): number => {
      const tLow = 1.0 / (2.0 * Math.PI * fCenter * 1.2);
      const tHigh = 1.0 / (2.0 * Math.PI * fCenter * 0.8);
      const b1 = emitFirstOrderLag(
        ctx,
        `x_${band}1_pss_${gId}`,
        dwPu,
        addReal(dae, 1.0),
        addReal(dae, tLow),
        tLow,
        0.0,
      );
      const b2 = emitFirstOrderLag(
        ctx,
        `x_${band}2_pss_${gId}`,
        dwPu,
        addReal(dae, 1.0),
        addReal(dae, tHigh),
        tHigh,
        0.0,
      );
      return mul(dae, addReal(dae, k), sub(dae, b1, b2));
    };

    const ySum = add(dae, add(dae, bandSignal("L", kl, fl), bandSignal("I", ki, fi)), bandSignal("H", kh, fh));
    dae.addEquation(EqKind.Simple, vsOutExpr, emitClamp(ctx, ySum, addReal(dae, vstMin), addReal(dae, vstMax)));
    return vsOutExpr;
  }

  // Single-input IEEE PSS1A / IEEEST / STAB1 / STAB2A
  const ks = np["KS"] ?? np["K"] ?? np["K2"] ?? 10.0;
  const tw = Math.max(0.05, np["T5"] ?? np["T6"] ?? np["T"] ?? np["T2"] ?? 5.0);
  const t1 = Math.max(0.0, np["T1"] ?? 0.25);
  const t2 = Math.max(0.0, np["T2"] ?? 0.04);
  const t3 = Math.max(0.0, np["T3"] ?? 0.25);
  const t4 = Math.max(0.0, np["T4"] ?? 0.04);
  const lsMax = Math.max(0.0, np["LSMAX"] ?? np["HLIM"] ?? 0.1);
  const lsMin = Math.min(0.0, np["LSMIN"] ?? -lsMax);

  const wOut = emitWashout(ctx, `xw_pss_${gId}`, dwPu, addReal(dae, ks), addReal(dae, tw), tw, 0.0, ks);
  const ll1 = emitLeadLag(ctx, `xll1_pss_${gId}`, wOut, addReal(dae, t1), addReal(dae, t2), t2, 0.0);
  const ll2 = emitLeadLag(ctx, `xll2_pss_${gId}`, ll1, addReal(dae, t3), addReal(dae, t4), t4, 0.0);
  dae.addEquation(EqKind.Simple, vsOutExpr, emitClamp(ctx, ll2, addReal(dae, lsMin), addReal(dae, lsMax)));
  return vsOutExpr;
}
