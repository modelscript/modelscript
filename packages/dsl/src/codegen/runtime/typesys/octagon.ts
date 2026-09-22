// --- Native Octagon Abstract Domain Generator ---
// Generates zero-GC WASM AssemblyScript Difference Bound Matrix (DBM) routines.
// Operates on +/- x_i +/- x_j <= c linear memory constraints using Floyd-Warshall closure.

import { allocGen0 } from "../arena";
import { DenseInt32MatrixView } from "../core/array";

// --- Octagon Difference Bound Matrix (DBM) Engine ---
// Layout: For N variables, DBM is an 2N x 2N matrix of 32-bit signed integers.
// Variables are mapped to positive (+x_i -> 2i) and negative (-x_i -> 2i+1) literals.

let octagonDBM: u32 = 0;
let octagonNumVars: u32 = 0;
export const OCTAGON_INF: i32 = 0x3FFFFFFF;

@inline
function getDBM(): DenseInt32MatrixView {
    let dim = octagonNumVars * 2;
    return DenseInt32MatrixView.at(octagonDBM, dim, dim);
}

export function initOctagonDBM(numVars: u32): void {
    if (numVars == 0) return;
    octagonNumVars = numVars;
    let dim = numVars * 2;
    octagonDBM = allocGen0(dim * dim * 4);
    let dbm = getDBM();

    for (let i: u32 = 0; i < dim; i++) {
        for (let j: u32 = 0; j < dim; j++) {
            dbm.set(i, j, (i == j) ? 0 : OCTAGON_INF);
        }
    }
}

export function setOctagonBound(i: u32, j: u32, bound: i32): void {
    if (octagonDBM == 0 || octagonNumVars == 0) return;
    let dim = octagonNumVars * 2;
    if (i >= dim || j >= dim) return;
    
    let dbm = getDBM();
    let current = dbm.get(i, j);
    if (bound < current) {
        dbm.set(i, j, bound);
    }
}

// Incremental Floyd-Warshall Shortest Path Closure (O(N^3))
export function closeOctagonDBM(): void {
    if (octagonDBM == 0 || octagonNumVars == 0) return;
    let dim = octagonNumVars * 2;
    let dbm = getDBM();

    for (let k: u32 = 0; k < dim; k++) {
        for (let i: u32 = 0; i < dim; i++) {
            for (let j: u32 = 0; j < dim; j++) {
                let ik = dbm.get(i, k);
                let kj = dbm.get(k, j);
                if (ik != OCTAGON_INF && kj != OCTAGON_INF) {
                    let newBound = ik + kj;
                    let current = dbm.get(i, j);
                    if (newBound < current) {
                        dbm.set(i, j, newBound);
                    }
                }
            }
        }
    }
}

// Assume constraint: var1 - var2 <= maxDiff
export function assumeOctagonDiff(var1: u32, var2: u32, maxDiff: i32): void {
    let p1 = var1 * 2;
    let p2 = var2 * 2;
    setOctagonBound(p1, p2, maxDiff);
    setOctagonBound(p2 + 1, p1 + 1, maxDiff);
    closeOctagonDBM();
}

// Check constraint: var1 - var2 <= limit
export function checkOctagonDiff(var1: u32, var2: u32, limit: i32): boolean {
    if (octagonDBM == 0 || octagonNumVars == 0) return true;
    let dim = octagonNumVars * 2;
    let p1 = var1 * 2;
    let p2 = var2 * 2;
    if (p1 >= dim || p2 >= dim) return true;

    let dbm = getDBM();
    return dbm.get(p1, p2) <= limit;
}

// Assume unary interval constraint: lower <= varIdx <= upper
export function assumeOctagonInterval(varIdx: u32, lower: i32, upper: i32): void {
    if (octagonDBM == 0 || octagonNumVars == 0) return;
    let p = varIdx * 2;
    if (upper < OCTAGON_INF / 2) {
        setOctagonBound(p, p + 1, upper * 2);
    }
    if (lower > -OCTAGON_INF / 2) {
        setOctagonBound(p + 1, p, -lower * 2);
    }
    closeOctagonDBM();
}

// Check unary interval constraint: lower <= varIdx <= upper
export function checkOctagonInterval(varIdx: u32, lower: i32, upper: i32): boolean {
    if (octagonDBM == 0 || octagonNumVars == 0) return true;
    let p = varIdx * 2;
    let dim = octagonNumVars * 2;
    if (p + 1 >= dim) return true;

    let dbm = getDBM();
    if (upper < OCTAGON_INF / 2) {
        let uBound = dbm.get(p, p + 1);
        if (uBound > upper * 2) return false;
    }
    if (lower > -OCTAGON_INF / 2) {
        let lBound = dbm.get(p + 1, p);
        if (lBound > -lower * 2) return false;
    }
    return true;
}

// Get current upper bound for variable
export function getOctagonUpperBound(varIdx: u32): i32 {
    if (octagonDBM == 0 || octagonNumVars == 0) return OCTAGON_INF;
    let p = varIdx * 2;
    let dim = octagonNumVars * 2;
    if (p + 1 >= dim) return OCTAGON_INF;
    let dbm = getDBM();
    let raw = dbm.get(p, p + 1);
    if (raw >= OCTAGON_INF) return OCTAGON_INF;
    return raw / 2;
}

// Get current lower bound for variable
export function getOctagonLowerBound(varIdx: u32): i32 {
    if (octagonDBM == 0 || octagonNumVars == 0) return -OCTAGON_INF;
    let p = varIdx * 2;
    let dim = octagonNumVars * 2;
    if (p + 1 >= dim) return -OCTAGON_INF;
    let dbm = getDBM();
    let raw = dbm.get(p + 1, p);
    if (raw >= OCTAGON_INF) return -OCTAGON_INF;
    return -raw / 2;
}

// Detect if any diagonal entry is negative (indicates inconsistent/contradictory constraints)
export function hasNegativeCycle(): boolean {
    if (octagonDBM == 0 || octagonNumVars == 0) return false;
    let dbm = getDBM();
    let dim = octagonNumVars * 2;
    for (let i: u32 = 0; i < dim; i++) {
        if (dbm.get(i, i) < 0) return true;
    }
    return false;
}

// Reset DBM to initial unconstrained state
export function resetOctagonDBM(): void {
    if (octagonDBM == 0 || octagonNumVars == 0) return;
    let dim = octagonNumVars * 2;
    let dbm = getDBM();
    for (let i: u32 = 0; i < dim; i++) {
        for (let j: u32 = 0; j < dim; j++) {
            dbm.set(i, j, (i == j) ? 0 : OCTAGON_INF);
        }
    }
}

// Widening Operator (nabla) for loop bounds convergence
export function widenOctagonDBM(prevDBM: u32): void {
    if (octagonDBM == 0 || prevDBM == 0 || octagonNumVars == 0) return;
    let dim = octagonNumVars * 2;
    let curr = getDBM();
    let prev = DenseInt32MatrixView.at(prevDBM, dim, dim);

    for (let i: u32 = 0; i < dim; i++) {
        for (let j: u32 = 0; j < dim; j++) {
            let prevVal = prev.get(i, j);
            let currVal = curr.get(i, j);
            if (currVal > prevVal) {
                curr.set(i, j, OCTAGON_INF);
            }
        }
    }
}

// Narrowing Operator (delta) for loop bounds refinement
export function narrowOctagonDBM(prevDBM: u32): void {
    if (octagonDBM == 0 || prevDBM == 0 || octagonNumVars == 0) return;
    let dim = octagonNumVars * 2;
    let curr = getDBM();
    let prev = DenseInt32MatrixView.at(prevDBM, dim, dim);

    for (let i: u32 = 0; i < dim; i++) {
        for (let j: u32 = 0; j < dim; j++) {
            let prevVal = prev.get(i, j);
            let currVal = curr.get(i, j);
            // If it was widened to infinity but now we have a finite bound, restore to the stable previous/finite bound.
            if (prevVal == OCTAGON_INF && currVal != OCTAGON_INF) {
                curr.set(i, j, currVal);
            } else if (prevVal != OCTAGON_INF) {
                // Keep the previous finite bound to prevent infinite refinement loops
                curr.set(i, j, prevVal);
            }
        }
    }
}
