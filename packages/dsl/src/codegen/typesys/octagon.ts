// --- Native Octagon Abstract Domain Generator ---
// Generates zero-GC WASM AssemblyScript Difference Bound Matrix (DBM) routines.
// Operates on +/- x_i +/- x_j <= c linear memory constraints using Floyd-Warshall closure.

export function generateOctagonDomain(): string {
  return `
import { allocGen0 } from "./arena";

// --- Octagon Difference Bound Matrix (DBM) Engine ---
// Layout: For N variables, DBM is an 2N x 2N matrix of 32-bit signed integers.
// Variables are mapped to positive (+x_i -> 2i) and negative (-x_i -> 2i+1) literals.

let octagonDBM: u32 = 0;
let octagonNumVars: u32 = 0;
const OCTAGON_INF: i32 = 0x3FFFFFFF;

export function initOctagonDBM(numVars: u32): void {
    if (numVars == 0) return;
    octagonNumVars = numVars;
    let dim = numVars * 2;
    octagonDBM = allocGen0(dim * dim * 4);

    for (let i: u32 = 0; i < dim; i++) {
        for (let j: u32 = 0; j < dim; j++) {
            let val: i32 = (i == j) ? 0 : OCTAGON_INF;
            store<i32>(octagonDBM + (i * dim + j) * 4, val);
        }
    }
}

export function setOctagonBound(i: u32, j: u32, bound: i32): void {
    if (octagonDBM == 0 || octagonNumVars == 0) return;
    let dim = octagonNumVars * 2;
    if (i >= dim || j >= dim) return;
    
    let current = load<i32>(octagonDBM + (i * dim + j) * 4);
    if (bound < current) {
        store<i32>(octagonDBM + (i * dim + j) * 4, bound);
    }
}

// Incremental Floyd-Warshall Shortest Path Closure (O(N^3))
export function closeOctagonDBM(): void {
    if (octagonDBM == 0 || octagonNumVars == 0) return;
    let dim = octagonNumVars * 2;

    for (let k: u32 = 0; k < dim; k++) {
        for (let i: u32 = 0; i < dim; i++) {
            for (let j: u32 = 0; j < dim; j++) {
                let ik = load<i32>(octagonDBM + (i * dim + k) * 4);
                let kj = load<i32>(octagonDBM + (k * dim + j) * 4);
                if (ik != OCTAGON_INF && kj != OCTAGON_INF) {
                    let newBound = ik + kj;
                    let current = load<i32>(octagonDBM + (i * dim + j) * 4);
                    if (newBound < current) {
                        store<i32>(octagonDBM + (i * dim + j) * 4, newBound);
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

    let bound = load<i32>(octagonDBM + (p1 * dim + p2) * 4);
    return bound <= limit;
}

// Widening Operator (nabla) for loop bounds convergence
export function widenOctagonDBM(prevDBM: u32): void {
    if (octagonDBM == 0 || prevDBM == 0 || octagonNumVars == 0) return;
    let dim = octagonNumVars * 2;

    for (let i: u32 = 0; i < dim; i++) {
        for (let j: u32 = 0; j < dim; j++) {
            let prevVal = load<i32>(prevDBM + (i * dim + j) * 4);
            let currVal = load<i32>(octagonDBM + (i * dim + j) * 4);
            if (currVal > prevVal) {
                store<i32>(octagonDBM + (i * dim + j) * 4, OCTAGON_INF);
            }
        }
    }
}

// Narrowing Operator (delta) for loop bounds refinement
export function narrowOctagonDBM(prevDBM: u32): void {
    if (octagonDBM == 0 || prevDBM == 0 || octagonNumVars == 0) return;
    let dim = octagonNumVars * 2;

    for (let i: u32 = 0; i < dim; i++) {
        for (let j: u32 = 0; j < dim; j++) {
            let prevVal = load<i32>(prevDBM + (i * dim + j) * 4);
            let currVal = load<i32>(octagonDBM + (i * dim + j) * 4);
            // If it was widened to infinity but now we have a finite bound, restore to the stable previous/finite bound.
            if (prevVal == OCTAGON_INF && currVal != OCTAGON_INF) {
                store<i32>(octagonDBM + (i * dim + j) * 4, currVal);
            } else if (prevVal != OCTAGON_INF) {
                // Keep the previous finite bound to prevent infinite refinement loops
                store<i32>(octagonDBM + (i * dim + j) * 4, prevVal);
            }
        }
    }
}
`;
}
