export function generateJacobianColoring(): string {
  return `// --- Distance-2 Graph Coloring (Curtis-Powell-Reid 1974) ---
// Compresses sparse Jacobian column directional derivatives for Automatic Differentiation

export function colorJacobian(nCols: u32, ccsColPtr: u32, ccsRowIndices: u32, colorsOutPtr: u32): u32 {
    if (nCols == 0) return 0;

    // Allocate column neighbor conflict flags (nCols * nCols boolean matrix in arena)
    let conflictMatrixPtr = arenaOffset;
    let matrixSize = nCols * nCols;
    arenaOffset += matrixSize;
    memory.fill(conflictMatrixPtr, 0, matrixSize);

    // Build column intersection graph:
    // Two columns conflict if they share a non-zero in the same row.
    // We scan rows by reversing the CCS representation.
    // For each column c1:
    for (let c1: u32 = 0; c1 < nCols; c1++) {
        let start1 = load<u32>(ccsColPtr + c1 * 4);
        let end1 = load<u32>(ccsColPtr + (c1 + 1) * 4);

        for (let c2: u32 = c1 + 1; c2 < nCols; c2++) {
            let start2 = load<u32>(ccsColPtr + c2 * 4);
            let end2 = load<u32>(ccsColPtr + (c2 + 1) * 4);

            // Intersect row indices of c1 and c2
            let p1 = start1;
            let p2 = start2;
            let shareRow = false;

            while (p1 < end1 && p2 < end2) {
                let r1 = load<u32>(ccsRowIndices + p1 * 4);
                let r2 = load<u32>(ccsRowIndices + p2 * 4);
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
                store<u8>(conflictMatrixPtr + c1 * nCols + c2, 1);
                store<u8>(conflictMatrixPtr + c2 * nCols + c1, 1);
            }
        }
    }

    // Greedy coloring algorithm
    let numColors: u32 = 0;
    
    // Initialize color array to -1 (0xFFFFFFFF)
    for (let c: u32 = 0; c < nCols; c++) {
        store<i32>(colorsOutPtr + c * 4, -1);
    }

    // Allocate a scratch array for used colors (size = nCols bytes)
    let usedColorsPtr = arenaOffset;
    arenaOffset += nCols;

    for (let col: u32 = 0; col < nCols; col++) {
        memory.fill(usedColorsPtr, 0, nCols);

        // Collect colors used by conflicting neighbor columns
        for (let nbr: u32 = 0; nbr < nCols; nbr++) {
            if (load<u8>(conflictMatrixPtr + col * nCols + nbr) == 1) {
                let nbrColor = load<i32>(colorsOutPtr + nbr * 4);
                if (nbrColor >= 0 && nbrColor < (nCols as i32)) {
                    store<u8>(usedColorsPtr + nbrColor, 1);
                }
            }
        }

        // Find smallest available color index
        let color: u32 = 0;
        while (load<u8>(usedColorsPtr + color) == 1) {
            color++;
        }

        store<i32>(colorsOutPtr + col * 4, color as i32);
        if (color + 1 > numColors) {
            numColors = color + 1;
        }
    }

    return numColors;
}
`;
}
