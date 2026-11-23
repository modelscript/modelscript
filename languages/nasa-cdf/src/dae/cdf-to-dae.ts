// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — Zero-GC Linear DAE Arena Lowering for Space-Physics Telemetry Balance.
 *
 * Lowers magnetometer and solar-wind plasma telemetry from a `CdfDocument` directly into
 * ModelScript's linear-memory `DAEBuilder` arena (`varCount === eqCount`):
 *
 * - Magnetic field magnitude squared: `B_sq = Bx^2 + By^2 + Bz^2`
 * - Magnetic field magnitude:         `B_mag = sqrt(B_sq)`
 * - Magnetic pressure (SI, nT->T):    `P_mag = (B_sq * 1e-18) / (2 * mu0)`
 * - Thermal plasma pressure:          `P_th = n_p * kB * T_p`
 * - Plasma beta:                      `beta_plasma = P_th / P_mag`
 * - Low-pass filtered field ODE:      `der(B_filt) = (B_mag - B_filt) / tau_relax`
 * - Cumulative magnetic fluence ODE:  `der(B_fluence) = B_mag`
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { analyzeNasaCdfTelemetry, K_BOLTZMANN, MU_0 } from "../solver/statistics.js";
import type { CdfDocument } from "../types.js";

export interface NasaCdfDaeOptions {
  /** Override model name in DAEBuilder. */
  modelName?: string | undefined;
  /** Default proton density in m^-3 (default: 5e6 m^-3 = 5 cm^-3). */
  protonDensityM3?: number | undefined;
  /** Default proton temperature in Kelvin (default: 1e5 K). */
  protonTempK?: number | undefined;
  /** Magnetometer filter relaxation time constant in seconds (default: 2.0 s). */
  tauRelaxSec?: number | undefined;
}

/**
 * Lowers a `CdfDocument` into a balanced `DAEBuilder` linear-memory arena (`varCount === eqCount`).
 */
export function lowerNasaCdfToDae(doc: CdfDocument, options: NasaCdfDaeOptions = {}): DAEBuilder {
  const interner = new StringInterner();
  const rawName = options.modelName ?? doc.header.fileName.replace(/\.[^.]+$/, "") ?? "NASA_CDF_Telemetry";
  const name = rawName.replace(/[^a-zA-Z0-9_]/g, "_") || "NASA_CDF_Telemetry";
  const arena = new DAEBuilder(interner, name);

  function addVar(varName: string, variability: Variability, initVal: number): number {
    arena.addVariable(varName, VarType.Real, variability, Causality.Local, initVal);
    const id = interner.intern(varName);
    return arena.addExpression(ExprKind.Name, id);
  }

  const summary = analyzeNasaCdfTelemetry(doc);

  // Extract nominal Bx, By, Bz (in nT) from telemetry channels or fallback to typical solar wind (3, 4, 0 nT)
  const bxChan = summary.channels.find((c) => /_x$|^B_?X$/i.test(c.name));
  const byChan = summary.channels.find((c) => /_y$|^B_?Y$/i.test(c.name));
  const bzChan = summary.channels.find((c) => /_z$|^B_?Z$/i.test(c.name));
  const npChan = summary.channels.find((c) => /N_?P|DENS/i.test(c.name));
  const tpChan = summary.channels.find((c) => /T_?P|TEMP/i.test(c.name));

  const bx0 = bxChan && Number.isFinite(bxChan.mean) ? bxChan.mean : 3.0;
  const by0 = byChan && Number.isFinite(byChan.mean) ? byChan.mean : 4.0;
  const bz0 = bzChan && Number.isFinite(bzChan.mean) ? bzChan.mean : 0.0;
  const nP0 =
    options.protonDensityM3 ?? (npChan && Number.isFinite(npChan.mean) && npChan.mean > 0 ? npChan.mean * 1e6 : 5.0e6);
  const tP0 = options.protonTempK ?? (tpChan && Number.isFinite(tpChan.mean) && tpChan.mean > 0 ? tpChan.mean : 1.0e5);
  const tauRelax = Math.max(1e-3, options.tauRelaxSec ?? 2.0);

  // 1. Parameters (each paired with a defining equation for varCount === eqCount)
  const bxExpr = addVar(`${name}_Bx_nT`, Variability.Parameter, bx0);
  arena.addEquation(EqKind.Simple, bxExpr, arena.addRealLiteral(bx0));

  const byExpr = addVar(`${name}_By_nT`, Variability.Parameter, by0);
  arena.addEquation(EqKind.Simple, byExpr, arena.addRealLiteral(by0));

  const bzExpr = addVar(`${name}_Bz_nT`, Variability.Parameter, bz0);
  arena.addEquation(EqKind.Simple, bzExpr, arena.addRealLiteral(bz0));

  const npExpr = addVar(`${name}_n_p_m3`, Variability.Parameter, nP0);
  arena.addEquation(EqKind.Simple, npExpr, arena.addRealLiteral(nP0));

  const tpExpr = addVar(`${name}_T_p_K`, Variability.Parameter, tP0);
  arena.addEquation(EqKind.Simple, tpExpr, arena.addRealLiteral(tP0));

  const tauExpr = addVar(`${name}_tau_relax`, Variability.Parameter, tauRelax);
  arena.addEquation(EqKind.Simple, tauExpr, arena.addRealLiteral(tauRelax));

  // 2. Algebraic magnetic field & plasma balance equations
  const bSq0 = bx0 * bx0 + by0 * by0 + bz0 * bz0;
  const bMag0 = Math.sqrt(Math.max(1e-12, bSq0));
  const pMag0 = (bSq0 * 1e-18) / (2.0 * MU_0);
  const pTh0 = nP0 * K_BOLTZMANN * tP0;
  const beta0 = pMag0 > 0 ? pTh0 / pMag0 : 1.0;

  // B_sq = Bx*Bx + By*By + Bz*Bz
  const bSqExpr = addVar(`${name}_B_sq_nT2`, Variability.Continuous, bSq0);
  const bx2 = arena.addBinaryExpr(BinOp.Mul, bxExpr, bxExpr);
  const by2 = arena.addBinaryExpr(BinOp.Mul, byExpr, byExpr);
  const bz2 = arena.addBinaryExpr(BinOp.Mul, bzExpr, bzExpr);
  arena.addEquation(
    EqKind.Simple,
    bSqExpr,
    arena.addBinaryExpr(BinOp.Add, arena.addBinaryExpr(BinOp.Add, bx2, by2), bz2),
  );

  // B_mag = sqrt(B_sq)
  const bMagExpr = addVar(`${name}_B_mag_nT`, Variability.Continuous, bMag0);
  const sqrtCall = arena.addCallExpr("sqrt", [bSqExpr]);
  arena.addEquation(EqKind.Simple, bMagExpr, sqrtCall);

  // P_mag = B_sq * (1e-18 / (2 * mu0))
  const pMagExpr = addVar(`${name}_P_mag_Pa`, Variability.Continuous, pMag0);
  arena.addEquation(
    EqKind.Simple,
    pMagExpr,
    arena.addBinaryExpr(BinOp.Mul, bSqExpr, arena.addRealLiteral(1e-18 / (2.0 * MU_0))),
  );

  // P_th = n_p * kB * T_p
  const pThExpr = addVar(`${name}_P_th_Pa`, Variability.Continuous, pTh0);
  arena.addEquation(
    EqKind.Simple,
    pThExpr,
    arena.addBinaryExpr(BinOp.Mul, arena.addBinaryExpr(BinOp.Mul, npExpr, arena.addRealLiteral(K_BOLTZMANN)), tpExpr),
  );

  // beta_plasma = P_th / P_mag
  const betaExpr = addVar(`${name}_beta_plasma`, Variability.Continuous, beta0);
  arena.addEquation(EqKind.Simple, betaExpr, arena.addBinaryExpr(BinOp.Div, pThExpr, pMagExpr));

  // 3. Differential telemetry state equations
  // der(B_filt) = (B_mag - B_filt) / tau_relax
  const bFiltExpr = addVar(`${name}_B_filt_nT`, Variability.Continuous, bMag0);
  arena.addEquation(
    EqKind.Simple,
    arena.addDer(bFiltExpr),
    arena.addBinaryExpr(BinOp.Div, arena.addBinaryExpr(BinOp.Sub, bMagExpr, bFiltExpr), tauExpr),
  );

  // der(B_fluence) = B_mag
  const bFluenceExpr = addVar(`${name}_B_fluence_nTs`, Variability.Continuous, 0.0);
  arena.addEquation(EqKind.Simple, arena.addDer(bFluenceExpr), bMagExpr);

  return arena;
}
