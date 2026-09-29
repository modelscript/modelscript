// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Native Octagon Abstract Domain Engine for WebAssembly.
 *
 * Implements a zero-GC Difference Bound Matrix (DBM) abstract domain supporting
 * relational linear invariants of the form (+- x_i +- x_j <= c).
 *
 * Academic Citations:
 *   - Miné, A. (2001). "A new numerical abstract domain based on difference-bound matrices."
 *     In The 2nd SBMF, ENTCS, Elsevier.
 *   - Miné, A. (2006). "The octagon abstract domain." Higher-Order and Symbolic Computation,
 *     19(1), pp. 31–100. DOI: 10.1007/s10990-006-8609-1.
 *   - Floyd, R. W. (1962). "Algorithm 97: Shortest path." Communications of the ACM, 5(6), p. 345.
 *     (All-Pairs Shortest Path Closure)
 *
 * ModelScript Architectural Rationale:
 *   Static verification and type inference of physical languages (Modelica algorithms, SysML v2
 *   actions) require discovering relational bounds between variables (e.g. buffer bounds, clock
 *   delays x_i - x_j <= dt, loop counters). Classical Interval analysis cannot capture variable
 *   dependencies, while general convex Polyhedra analysis exhibits exponential O(2^N) complexity.
 *   The Octagon abstract domain represents relational constraints in O(N^2) memory and computes
 *   strong closures in O(N^3) time, striking the optimal balance for interactive compile-time checks.
 *
 * Modifications:
 *   - Implemented in AssemblyScript compiling to WebAssembly linear memory with zero GC allocations.
 *   - Maps N variables to a 2N x 2N Difference Bound Matrix (DBM) using (+x_i -> 2i, -x_i -> 2i+1).
 *   - In-place incremental Floyd-Warshall shortest-path transitive closure.
 *   - Directly extracts single-variable interval projections and satisfies Nelson-Oppen bound queries.
 */

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
