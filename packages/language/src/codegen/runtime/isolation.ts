// --- Zero-GC WASM Isolation Runtime & Solvers ---
// Provides dual-number AD, warm-start vector caching, 1x1 Newton solvers, and Homotopy continuation.

import { allocGen0 } from "./arena";

// --- Dual Numbers for Forward-Mode AD in CPU Registers ---
export class Dual {
    val: f64;
    der: f64;
}

export function createDual(val: f64, der: f64): Dual {
    let d: Dual;
    d.val = val;
    d.der = der;
    return d;
}

export function dualConst(val: f64): Dual {
    return createDual(val, 0.0);
}

export function dualVar(val: f64): Dual {
    return createDual(val, 1.0);
}

export function dualAdd(a: Dual, b: Dual): Dual {
    return createDual(a.val + b.val, a.der + b.der);
}

export function dualSub(a: Dual, b: Dual): Dual {
    return createDual(a.val - b.val, a.der - b.der);
}

export function dualMul(a: Dual, b: Dual): Dual {
    return createDual(a.val * b.val, a.val * b.der + a.der * b.val);
}

export function dualDiv(a: Dual, b: Dual): Dual {
    let invB = 1.0 / b.val;
    return createDual(a.val * invB, (a.der * b.val - a.val * b.der) * (invB * invB));
}

export function dualSin(a: Dual): Dual {
    return createDual(Math.sin(a.val), Math.cos(a.val) * a.der);
}

export function dualCos(a: Dual): Dual {
    return createDual(Math.cos(a.val), -Math.sin(a.val) * a.der);
}

export function dualExp(a: Dual): Dual {
    let e = Math.exp(a.val);
    return createDual(e, e * a.der);
}

export function dualLog(a: Dual): Dual {
    return createDual(Math.log(a.val), a.der / a.val);
}

// --- Elementary Math Inverse Helpers ---
export function inverseSinh(v: f64): f64 {
    // sinh⁻¹(v) = log(v + sqrt(v² + 1))
    return Math.log(v + Math.sqrt(v * v + 1.0));
}

export function inverseCosh(v: f64): f64 {
    // cosh⁻¹(v) = log(v + sqrt(v² - 1)) for v >= 1.0
    if (v < 1.0) return 0.0;
    return Math.log(v + Math.sqrt(v * v - 1.0));
}

export function inverseTanh(v: f64): f64 {
    // tanh⁻¹(v) = 0.5 * log((1 + v) / (1 - v)) for -1.0 < v < 1.0
    if (v <= -1.0 || v >= 1.0) return 0.0;
    return 0.5 * Math.log((1.0 + v) / (1.0 - v));
}

export function lambertW0(x: f64): f64 {
    // Lambert W0 branch expansion for small/moderate x
    if (x < -0.36787944117144233) return 0.0;
    let w: f64 = x < 1.0 ? 0.0 : Math.log(x);
    for (let i = 0; i < 10; i++) {
        let ew = Math.exp(w);
        let wEw = w * ew;
        let res = wEw - x;
        if (Math.abs(res) < 1e-12) break;
        let num = res;
        let den = ew * (w + 1.0) - ((w + 2.0) * res) / (2.0 * w + 2.0);
        w -= num / den;
    }
    return w;
}

// --- Warm-Start State Vector Cache ---
let warmStartBuf: u32 = 0;
let warmStartCap: u32 = 0;

export function initWarmStartCache(capacity: u32): void {
    if (capacity > warmStartCap) {
        warmStartCap = capacity;
        warmStartBuf = allocGen0(capacity * 8);
    }
}

export function getWarmStartValue(varIdx: u32): f64 {
    if (warmStartBuf == 0 || varIdx >= warmStartCap) return 0.0;
    return load<f64>(warmStartBuf + varIdx * 8);
}

export function setWarmStartValue(varIdx: u32, val: f64): void {
    if (warmStartBuf == 0 || varIdx >= warmStartCap) return;
    store<f64>(warmStartBuf + varIdx * 8, val);
}

// --- Inline 1x1 Stack Newton-Raphson Solver ---
// Operates with zero heap allocations on WASM execution stack
export function solve1x1Newton(
    varIdx: u32,
    evalFunc: (x: f64) => Dual,
    targetRhs: f64,
    maxIter: u32 = 20,
    tol: f64 = 1e-10
): f64 {
    let x: f64 = getWarmStartValue(varIdx);
    if (x == 0.0) x = 1.0;

    let iter: u32 = 0;
    let converged = false;

    while (iter < maxIter) {
        iter++;
        let d = evalFunc(x);
        let res = d.val - targetRhs;

        if (Math.abs(res) < tol) {
            converged = true;
            break;
        }

        let der = d.der;
        if (Math.abs(der) < 1e-14) {
            der = der >= 0 ? 1e-6 : -1e-6;
        }

        let step = res / der;
        
        // Armijo Line Search Backtracking
        let alpha: f64 = 1.0;
        let xNew = x - step;
        let dNew = evalFunc(xNew);
        let resNew = Math.abs(dNew.val - targetRhs);

        while (resNew >= Math.abs(res) && alpha > 0.0625) {
            alpha *= 0.5;
            xNew = x - alpha * step;
            dNew = evalFunc(xNew);
            resNew = Math.abs(dNew.val - targetRhs);
        }

        x = xNew;
    }

    if (converged) {
        setWarmStartValue(varIdx, x);
    }
    return x;
}

// --- Adaptive Homotopy Continuation Solver ---
// Solves H(x, lambda) = lambda * F(x) + (1 - lambda) * (x - x0) = 0
export function solveHomotopy(
    varIdx: u32,
    evalFunc: (x: f64) => Dual,
    targetRhs: f64,
    x0: f64 = 0.0
): f64 {
    let x: f64 = x0;
    let lambda: f64 = 0.0;
    let dLambda: f64 = 0.2;

    while (lambda < 1.0) {
        let nextLambda = lambda + dLambda;
        if (nextLambda > 1.0) nextLambda = 1.0;

        let iter: u32 = 0;
        let stepConverged = false;

        while (iter < 15) {
            iter++;
            let d = evalFunc(x);
            let fVal = d.val - targetRhs;
            let hVal = nextLambda * fVal + (1.0 - nextLambda) * (x - x0);
            
            if (Math.abs(hVal) < 1e-8) {
                stepConverged = true;
                break;
            }

            let hDer = nextLambda * d.der + (1.0 - nextLambda);
            if (Math.abs(hDer) < 1e-12) hDer = 1e-6;

            x -= hVal / hDer;
        }

        if (stepConverged) {
            lambda = nextLambda;
            if (dLambda < 0.2) dLambda *= 1.5;
        } else {
            // Reduce step size and retry
            dLambda *= 0.5;
            if (dLambda < 0.001) break; // Failed
        }
    }

    setWarmStartValue(varIdx, x);
    return x;
}
