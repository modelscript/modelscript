// --- Distance-2 Graph Coloring (Curtis-Powell-Reid 1974) ---
// Compresses sparse Jacobian column directional derivatives for Automatic Differentiation

import { UnmanagedUint32Array, UnmanagedInt32Array, UnmanagedUint8Array } from "../core/array";

export let arenaOffset: u32 = 0;

export function colorJacobian(nCols: u32, ccsColPtr: u32, ccsRowIndices: u32, colorsOutPtr: u32): u32 {
    if (nCols == 0) return 0;

    let colPtr = changetype<UnmanagedUint32Array>(ccsColPtr);
    let rowIndices = changetype<UnmanagedUint32Array>(ccsRowIndices);
    let colorsOut = changetype<UnmanagedInt32Array>(colorsOutPtr);

    // Allocate column neighbor conflict flags (nCols * nCols boolean matrix in arena)
    let conflictMatrixPtr = arenaOffset;
    let matrixSize = nCols * nCols;
    arenaOffset += matrixSize;
    memory.fill(conflictMatrixPtr, 0, matrixSize);
    let conflictMatrix = changetype<UnmanagedUint8Array>(conflictMatrixPtr);

    // Build column intersection graph:
    // Two columns conflict if they share a non-zero in the same row.
    // We scan rows by reversing the CCS representation.
    // For each column c1:
    for (let c1: u32 = 0; c1 < nCols; c1++) {
        let start1 = colPtr[c1];
        let end1 = colPtr[c1 + 1];

        for (let c2: u32 = c1 + 1; c2 < nCols; c2++) {
            let start2 = colPtr[c2];
            let end2 = colPtr[c2 + 1];

            // Intersect row indices of c1 and c2
            let p1 = start1;
            let p2 = start2;
            let shareRow = false;

            while (p1 < end1 && p2 < end2) {
                let r1 = rowIndices[p1];
                let r2 = rowIndices[p2];
                if (r1 == r2) {
                    shareRow = true;
                    break;
                } else if (r1 < r2) {
                    p1++;
                } else {
                    p2++;
                }
            }

            if (shareRow) {
                conflictMatrix[c1 * nCols + c2] = 1;
                conflictMatrix[c2 * nCols + c1] = 1;
            }
        }
    }

    // Greedy coloring algorithm
    let numColors: u32 = 0;

    // Initialize color array to -1 (0xFFFFFFFF)
    for (let c: u32 = 0; c < nCols; c++) {
        colorsOut[c] = -1;
    }

    // Allocate a scratch array for used colors (size = nCols bytes)
    let usedColorsPtr = arenaOffset;
    arenaOffset += nCols;
    let usedColors = changetype<UnmanagedUint8Array>(usedColorsPtr);

    for (let col: u32 = 0; col < nCols; col++) {
        memory.fill(usedColorsPtr, 0, nCols);

        // Collect colors used by conflicting neighbor columns
        for (let nbr: u32 = 0; nbr < nCols; nbr++) {
            if (conflictMatrix[col * nCols + nbr] == 1) {
                let nbrColor = colorsOut[nbr];
                if (nbrColor >= 0 && nbrColor < (nCols as i32)) {
                    usedColors[nbrColor] = 1;
                }
            }
        }

        // Find smallest available color index
        let color: u32 = 0;
        while (usedColors[color] == 1) {
            color++;
        }

        colorsOut[col] = color as i32;
        if (color + 1 > numColors) {
            numColors = color + 1;
        }
    }

    return numColors;
}
