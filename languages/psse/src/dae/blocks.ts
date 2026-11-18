// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Zero-allocation control-block and physical-primitive library over `@modelscript/runtime`
 * `DAEBuilder` integer expression IDs (`ExprId`).
 *
 * Every helper supports:
 *   1. Automatic degenerate time-constant collapsing (`T <= 1e-6` -> algebraic equation)
 *      so BLT / IDA never sees singular `0 * der(x)` rows.
 *   2. Exact piecewise `IfElse` limiters (`smoothLimits: false`, default) for IDA/CVODE
 *      root-finding, or C-infinity smooth epsilon-clamping (`smoothLimits: true`) for
 *      continuous Jacobian / small-signal modal eigenvalue analysis.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";

export interface DaeBlockContext {
  dae: DAEBuilder;
  smoothLimits: boolean;
}

export function addReal(dae: DAEBuilder, v: number): number {
  return dae.addRealLiteral(Number.isFinite(v) ? v : 0.0);
}

export function add(dae: DAEBuilder, a: number, b: number): number {
  return dae.addBinaryExpr(BinOp.Add, a, b);
}

export function sub(dae: DAEBuilder, a: number, b: number): number {
  return dae.addBinaryExpr(BinOp.Sub, a, b);
}

export function mul(dae: DAEBuilder, a: number, b: number): number {
  return dae.addBinaryExpr(BinOp.Mul, a, b);
}

export function div(dae: DAEBuilder, a: number, b: number): number {
  return dae.addBinaryExpr(BinOp.Div, a, b);
}

export function sumExprs(dae: DAEBuilder, terms: number[]): number {
  if (terms.length === 0) return dae.addRealLiteral(0.0);
  let acc = terms[0]!;
  for (let i = 1; i < terms.length; i++) {
    acc = dae.addBinaryExpr(BinOp.Add, acc, terms[i]!);
  }
  return acc;
}

export function emitSmoothMax(dae: DAEBuilder, a: number, b: number, eps = 1e-4): number {
  const diff = sub(dae, a, b);
  const diff2 = mul(dae, diff, diff);
  const eps2 = addReal(dae, eps * eps);
  const rad = dae.addCallExpr("sqrt", [add(dae, diff2, eps2)]);
  return mul(dae, addReal(dae, 0.5), add(dae, add(dae, a, b), rad));
}

export function emitSmoothMin(dae: DAEBuilder, a: number, b: number, eps = 1e-4): number {
  const diff = sub(dae, a, b);
  const diff2 = mul(dae, diff, diff);
  const eps2 = addReal(dae, eps * eps);
  const rad = dae.addCallExpr("sqrt", [add(dae, diff2, eps2)]);
  return mul(dae, addReal(dae, 0.5), sub(dae, add(dae, a, b), rad));
}

export function emitMax(ctx: DaeBlockContext, a: number, b: number): number {
  const { dae, smoothLimits } = ctx;
  if (smoothLimits) return emitSmoothMax(dae, a, b);
  return dae.addCallExpr("max", [a, b]);
}

export function emitMin(ctx: DaeBlockContext, a: number, b: number): number {
  const { dae, smoothLimits } = ctx;
  if (smoothLimits) return emitSmoothMin(dae, a, b);
  return dae.addCallExpr("min", [a, b]);
}

export function emitClamp(ctx: DaeBlockContext, x: number, lo: number, hi: number): number {
  return emitMin(ctx, emitMax(ctx, x, lo), hi);
}

export function emitDeadband(ctx: DaeBlockContext, x: number, loDb: number, hiDb: number): number {
  const { dae, smoothLimits } = ctx;
  const zero = addReal(dae, 0.0);
  if (smoothLimits) {
    // Soft deadband: max(0, x - hiDb) + min(0, x - loDb) using smooth max/min
    const pos = emitSmoothMax(dae, zero, sub(dae, x, hiDb), 1e-4);
    const neg = emitSmoothMin(dae, zero, sub(dae, x, loDb), 1e-4);
    return add(dae, pos, neg);
  }
  const gtHi = dae.addBinaryExpr(BinOp.Gt, x, hiDb);
  const ltLo = dae.addBinaryExpr(BinOp.Lt, x, loDb);
  return dae.addIfElseExpr(gtHi, sub(dae, x, hiDb), dae.addIfElseExpr(ltLo, sub(dae, x, loDb), zero));
}

/**
 * First-order lag `T * der(x) = K * u - x`, collapsing to `x = K * u` when `tNumeric <= 1e-6`.
 * Returns the `ExprId` of `x`.
 */
export function emitFirstOrderLag(
  ctx: DaeBlockContext,
  varName: string,
  uExpr: number,
  kExpr: number,
  tExpr: number,
  tNumeric: number,
  x0: number,
): number {
  const { dae } = ctx;
  dae.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, x0);
  const xExpr = dae.addNameExpr(varName);
  const ku = mul(dae, kExpr, uExpr);

  if (!Number.isFinite(tNumeric) || tNumeric <= 1e-6) {
    dae.addEquation(EqKind.Simple, xExpr, ku);
    return xExpr;
  }

  const lhs = mul(dae, tExpr, dae.addDerExpr(dae.addNameExpr(varName)));
  const rhs = sub(dae, ku, xExpr);
  dae.addEquation(EqKind.Simple, lhs, rhs);
  return xExpr;
}

/**
 * Windup lag `T * der(x) = K * u - x`, clamped externally at output `y = clamp(x, min, max)`.
 * Returns `[xExpr, yExpr]`.
 */
export function emitWindupLag(
  ctx: DaeBlockContext,
  varName: string,
  uExpr: number,
  kExpr: number,
  tExpr: number,
  tNumeric: number,
  minExpr: number,
  maxExpr: number,
  x0: number,
): [number, number] {
  const xExpr = emitFirstOrderLag(ctx, varName, uExpr, kExpr, tExpr, tNumeric, x0);
  const yExpr = emitClamp(ctx, xExpr, minExpr, maxExpr);
  return [xExpr, yExpr];
}

/**
 * IEEE Std 421.5 Annex E non-windup lag limiter:
 * Clamps state `x` within `[min, max]` and prevents windup when saturated.
 * Returns the `ExprId` of `x`.
 */
export function emitNonWindupLag(
  ctx: DaeBlockContext,
  varName: string,
  uExpr: number,
  kExpr: number,
  tExpr: number,
  tNumeric: number,
  minExpr: number,
  maxExpr: number,
  x0: number,
): number {
  const { dae, smoothLimits } = ctx;
  dae.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, x0);
  const xExpr = dae.addNameExpr(varName);
  const ku = mul(dae, kExpr, uExpr);

  if (!Number.isFinite(tNumeric) || tNumeric <= 1e-6) {
    dae.addEquation(EqKind.Simple, xExpr, emitClamp(ctx, ku, minExpr, maxExpr));
    return xExpr;
  }

  const derX = dae.addDerExpr(dae.addNameExpr(varName));
  const rawNum = sub(dae, ku, xExpr);
  if (smoothLimits) {
    // Smooth restoring pullback outside [min, max] for continuous small-signal Jacobian
    const clampedTarget = emitClamp(ctx, ku, minExpr, maxExpr);
    dae.addEquation(EqKind.Simple, mul(dae, tExpr, derX), sub(dae, clampedTarget, xExpr));
    return xExpr;
  }

  const zero = addReal(dae, 0.0);
  const atHi = dae.addBinaryExpr(
    BinOp.And,
    dae.addBinaryExpr(BinOp.Gte, xExpr, maxExpr),
    dae.addBinaryExpr(BinOp.Gt, rawNum, zero),
  );
  const atLo = dae.addBinaryExpr(
    BinOp.And,
    dae.addBinaryExpr(BinOp.Lte, xExpr, minExpr),
    dae.addBinaryExpr(BinOp.Lt, rawNum, zero),
  );
  const blocked = dae.addBinaryExpr(BinOp.Or, atHi, atLo);
  const effNum = dae.addIfElseExpr(blocked, zero, rawNum);
  dae.addEquation(EqKind.Simple, mul(dae, tExpr, derX), effNum);
  return xExpr;
}

/**
 * Non-windup pure integrator `T * der(x) = f_nw(x, u, min, max)`.
 */
export function emitNonWindupIntegrator(
  ctx: DaeBlockContext,
  varName: string,
  uExpr: number,
  tExpr: number,
  tNumeric: number,
  minExpr: number,
  maxExpr: number,
  x0: number,
): number {
  const { dae, smoothLimits } = ctx;
  dae.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, x0);
  const xExpr = dae.addNameExpr(varName);
  const derX = dae.addDerExpr(dae.addNameExpr(varName));
  const zero = addReal(dae, 0.0);

  if (!Number.isFinite(tNumeric) || Math.abs(tNumeric) <= 1e-9) {
    dae.addEquation(EqKind.Simple, derX, zero);
    return xExpr;
  }

  if (smoothLimits) {
    const softRestore = sub(dae, emitClamp(ctx, xExpr, minExpr, maxExpr), xExpr);
    dae.addEquation(EqKind.Simple, mul(dae, tExpr, derX), add(dae, uExpr, mul(dae, addReal(dae, 50.0), softRestore)));
    return xExpr;
  }

  const atHi = dae.addBinaryExpr(
    BinOp.And,
    dae.addBinaryExpr(BinOp.Gte, xExpr, maxExpr),
    dae.addBinaryExpr(BinOp.Gt, uExpr, zero),
  );
  const atLo = dae.addBinaryExpr(
    BinOp.And,
    dae.addBinaryExpr(BinOp.Lte, xExpr, minExpr),
    dae.addBinaryExpr(BinOp.Lt, uExpr, zero),
  );
  const effIn = dae.addIfElseExpr(dae.addBinaryExpr(BinOp.Or, atHi, atLo), zero, uExpr);
  dae.addEquation(EqKind.Simple, mul(dae, tExpr, derX), effIn);
  return xExpr;
}

/**
 * Lead-lag compensator `(1 + s*Tc) / (1 + s*Tb)` realized as:
 *   `Tb * der(x) = u - x`
 *   `y = (Tc / Tb) * u + (1 - Tc / Tb) * x`
 * Collapses algebraically to `y = u` if `tbNumeric <= 1e-6`.
 * Returns `[xExpr_or_uExpr, yExpr]`.
 */
export function emitLeadLag(
  ctx: DaeBlockContext,
  stateName: string,
  uExpr: number,
  tcExpr: number,
  tbExpr: number,
  tbNumeric: number,
  u0: number,
): number {
  const { dae } = ctx;
  if (!Number.isFinite(tbNumeric) || tbNumeric <= 1e-6) {
    return uExpr;
  }
  dae.addVariable(stateName, VarType.Real, Variability.Continuous, Causality.Local, u0);
  const xExpr = dae.addNameExpr(stateName);
  dae.addEquation(EqKind.Simple, mul(dae, tbExpr, dae.addDerExpr(dae.addNameExpr(stateName))), sub(dae, uExpr, xExpr));

  const ratio = div(dae, tcExpr, tbExpr);
  const oneMinusRatio = sub(dae, addReal(dae, 1.0), ratio);
  return add(dae, mul(dae, ratio, uExpr), mul(dae, oneMinusRatio, xExpr));
}

/**
 * Washout high-pass filter `s * K * Tw / (1 + s * Tw)`:
 *   `Tw * der(xw) = K * u - xw`,  `y = K * u - xw`.
 * Collapses to `0` if `twNumeric <= 1e-6`.
 */
export function emitWashout(
  ctx: DaeBlockContext,
  stateName: string,
  uExpr: number,
  kExpr: number,
  twExpr: number,
  twNumeric: number,
  u0: number,
  kNumeric: number,
): number {
  const { dae } = ctx;
  if (!Number.isFinite(twNumeric) || twNumeric <= 1e-6) {
    return addReal(dae, 0.0);
  }
  dae.addVariable(stateName, VarType.Real, Variability.Continuous, Causality.Local, kNumeric * u0);
  const xwExpr = dae.addNameExpr(stateName);
  const ku = mul(dae, kExpr, uExpr);
  const diff = sub(dae, ku, xwExpr);
  dae.addEquation(EqKind.Simple, mul(dae, twExpr, dae.addDerExpr(dae.addNameExpr(stateName))), diff);
  return diff;
}

/**
 * Rate- and position-limited lag `T * der(x) = clamp((u - x) / T, rMin, rMax) * T` (for valve / gate servos).
 */
export function emitRateLimitedLag(
  ctx: DaeBlockContext,
  varName: string,
  uExpr: number,
  tExpr: number,
  tNumeric: number,
  rMinExpr: number,
  rMaxExpr: number,
  yMinExpr: number,
  yMaxExpr: number,
  x0: number,
): number {
  const { dae, smoothLimits } = ctx;
  const tEffNum = Math.max(1e-4, Number.isFinite(tNumeric) ? tNumeric : 0.1);
  const tEffExpr = tNumeric > 1e-4 ? tExpr : addReal(dae, tEffNum);
  dae.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, x0);
  const xExpr = dae.addNameExpr(varName);
  const derX = dae.addDerExpr(dae.addNameExpr(varName));

  const rawRate = div(dae, sub(dae, uExpr, xExpr), tEffExpr);
  const limitedRate = emitClamp(ctx, rawRate, rMinExpr, rMaxExpr);

  if (smoothLimits) {
    dae.addEquation(EqKind.Simple, derX, limitedRate);
    return emitClamp(ctx, xExpr, yMinExpr, yMaxExpr);
  }

  const zero = addReal(dae, 0.0);
  const atHi = dae.addBinaryExpr(
    BinOp.And,
    dae.addBinaryExpr(BinOp.Gte, xExpr, yMaxExpr),
    dae.addBinaryExpr(BinOp.Gt, limitedRate, zero),
  );
  const atLo = dae.addBinaryExpr(
    BinOp.And,
    dae.addBinaryExpr(BinOp.Lte, xExpr, yMinExpr),
    dae.addBinaryExpr(BinOp.Lt, limitedRate, zero),
  );
  const finalRate = dae.addIfElseExpr(dae.addBinaryExpr(BinOp.Or, atHi, atLo), zero, limitedRate);
  dae.addEquation(EqKind.Simple, derX, finalRate);
  return xExpr;
}

/**
 * Solves quadratic saturation parameters `(A, B)` for `S_E(E) = B * max(0, E - A)^2 / E`
 * passing through `(e1, se1)` and `(e2, se2)`.
 */
export function computeQuadraticSatCoeffs(
  e1: number,
  se1: number,
  e2: number,
  se2: number,
): { a: number; b: number } | null {
  if (!(e1 > 0 && e2 > e1 && se1 > 0 && se2 > 0)) return null;
  const prod1 = e1 * se1;
  const prod2 = e2 * se2;
  if (prod2 <= prod1) {
    // Degenerate or near-linear: place knee at 0.8 * e1
    const a = 0.8 * e1;
    const b = prod2 / Math.pow(e2 - a, 2);
    return { a, b };
  }
  const r = Math.sqrt(prod1 / prod2);
  const a = (e1 - r * e2) / (1.0 - r);
  const denom = Math.pow(e2 - a, 2);
  if (denom <= 1e-12) return null;
  const b = prod2 / denom;
  return { a, b };
}

export function evalQuadraticSat(e: number, coeffs: { a: number; b: number } | null): number {
  if (!coeffs || e <= coeffs.a || e <= 1e-6) return 0.0;
  const d = e - coeffs.a;
  return (coeffs.b * d * d) / e;
}

/**
 * Emits symbolic quadratic magnetic saturation `S_E(E) = B * max(0, E - A)^2 / max(0.1, E)`
 * into `DAEBuilder`.
 */
export function emitSaturationCurve(
  ctx: DaeBlockContext,
  eExpr: number,
  e1: number,
  se1: number,
  e2: number,
  se2: number,
): number {
  const { dae } = ctx;
  const coeffs = computeQuadraticSatCoeffs(e1, se1, e2, se2);
  if (!coeffs) return addReal(dae, 0.0);
  const aExpr = addReal(dae, coeffs.a);
  const bExpr = addReal(dae, coeffs.b);
  const excess = emitMax(ctx, addReal(dae, 0.0), sub(dae, eExpr, aExpr));
  const eSafe = emitMax(ctx, addReal(dae, 0.1), eExpr);
  return div(dae, mul(dae, bExpr, mul(dae, excess, excess)), eSafe);
}

/**
 * Emits symbolic exponential magnetic saturation `S_E(E) = A * exp(B * E)`
 * calibrated from `(E1, SE1)` and `(E2, SE2)` for `GENROE` / `GENSAE`.
 */
export function emitExponentialSatCurve(
  ctx: DaeBlockContext,
  eExpr: number,
  e1: number,
  se1: number,
  e2: number,
  se2: number,
): number {
  const { dae } = ctx;
  if (se1 <= 1e-9 || se2 <= 1e-9 || e2 <= e1 + 1e-6 || se2 <= se1) {
    return emitSaturationCurve(ctx, eExpr, e1, se1, e2, se2);
  }
  const bExp = Math.log(se2 / se1) / (e2 - e1);
  const aExp = se1 / Math.exp(bExp * e1);
  const arg = emitClamp(ctx, mul(dae, addReal(dae, bExp), eExpr), addReal(dae, -20.0), addReal(dae, 20.0));
  return mul(dae, addReal(dae, aExp), dae.addCallExpr("exp", [arg]));
}
