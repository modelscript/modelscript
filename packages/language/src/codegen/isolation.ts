// --- Zero-GC WASM Isolation Engine Generator ---
// Emits AssemblyScript solver functions for all 8 symbolic isolation strategies.

import { LanguageOptions } from "../dsl.js";

export function generateIsolationDomain(grammarDef?: LanguageOptions<any>): string {
  return `
import { allocGen0 } from "./arena";
import {
    Dual, createDual, dualConst, dualVar, dualAdd, dualSub, dualMul, dualDiv, dualSin, dualCos, dualExp, dualLog,
    inverseSinh, inverseCosh, inverseTanh, lambertW0,
    initWarmStartCache, getWarmStartValue, setWarmStartValue, solve1x1Newton, solveHomotopy
} from "./runtime_isolation";

export { initWarmStartCache, getWarmStartValue, setWarmStartValue, solve1x1Newton, solveHomotopy };

// --- All 8 Symbolic Isolation Strategies Engine ---

export const ISOLATION_EXPLICIT: u32 = 1;
export const ISOLATION_LINEAR: u32 = 2;
export const ISOLATION_QUADRATIC: u32 = 3;
export const ISOLATION_HARMONIC: u32 = 4;
export const ISOLATION_LAMBERT_W: u32 = 5;
export const ISOLATION_TREE_PEELING: u32 = 6;
export const ISOLATION_FIXED_POINT: u32 = 7;
export const ISOLATION_GROEBNER: u32 = 8;

export function isolateExplicit(lhsVal: f64, rhsVal: f64): f64 {
    return rhsVal;
}

export function isolateLinear(coeffA: f64, coeffB: f64): f64 {
    if (coeffA == 0.0) return 0.0;
    return -coeffB / coeffA;
}

export function isolateQuadratic(a: f64, b: f64, c: f64): f64 {
    if (a == 0.0) return isolateLinear(b, c);
    let disc = b * b - 4.0 * a * c;
    if (disc < 0.0) return 0.0;
    let sqrtDisc = Math.sqrt(disc);
    return (-b + sqrtDisc) / (2.0 * a);
}

export function isolateHarmonic(a: f64, b: f64, c: f64): f64 {
    let r = Math.sqrt(a * a + b * b);
    if (r == 0.0) return 0.0;
    let alpha = Math.atan2(b, a);
    let ratio = -c / r;
    if (ratio < -1.0 || ratio > 1.0) return 0.0;
    return Math.asin(ratio) - alpha;
}

export function isolateLambertW(a: f64, b: f64, c: f64): f64 {
    if (a == 0.0 || b == 0.0) return 0.0;
    let arg = (-c * b) / a;
    let w = lambertW0(arg);
    return w / b;
}

export function isolateTreePeelTrig(funcOp: u32, val: f64): f64 {
    // 1: sin, 2: cos, 3: tan, 4: sinh, 5: cosh, 6: tanh, 7: exp, 8: log, 9: sqrt
    if (funcOp == 1) return Math.asin(val);
    if (funcOp == 2) return Math.acos(val);
    if (funcOp == 3) return Math.atan(val);
    if (funcOp == 4) return inverseSinh(val);
    if (funcOp == 5) return inverseCosh(val);
    if (funcOp == 6) return inverseTanh(val);
    if (funcOp == 7) return Math.log(val);
    if (funcOp == 8) return Math.exp(val);
    if (funcOp == 9) return val * val;
    return val;
}

export function isolateFixedPoint(linearA: f64, restVal: f64): f64 {
    if (linearA == 0.0) return 0.0;
    return -restVal / linearA;
}

export function isolateGroebnerTriangularized(polyResult: f64): f64 {
    return polyResult;
}
`;
}
