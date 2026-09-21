export function generateSimplex(grammarDef?: any): string {
  const maxVars = grammarDef?.semantics?.reasoner?.smt?.maxSimplexVars || 200;
  return `// --- Native LRA Simplex Tableau (Phase 3) ---
// High-performance linear constraint solver using flat arrays

const SIMPLEX_MAX_VARS: u32 = ${maxVars};
const SIMPLEX_MAX_ROWS: u32 = ${maxVars};

let simplexArenaOffset: u32 = 0;
let tableauData = new Float64Array(${maxVars * maxVars});
let basicVars = new Uint32Array(SIMPLEX_MAX_ROWS);
let nonBasicVars = new Uint32Array(SIMPLEX_MAX_VARS);
let boundsLo = new Float64Array(SIMPLEX_MAX_VARS * 2);  // indexed by slot, not var ID
let boundsHi = new Float64Array(SIMPLEX_MAX_VARS * 2);
let nonBasicValues = new Float64Array(SIMPLEX_MAX_VARS);
let basicValues = new Float64Array(SIMPLEX_MAX_ROWS);
let numRows: u32 = 0;
let numCols: u32 = 0;

// Constraint origin tracking (for unsat core extraction)
let constraintNodeIds = new Uint32Array(SIMPLEX_MAX_ROWS);

export function initSimplexArena(startOffset: u32): void {
    simplexArenaOffset = startOffset;
    numRows = 0;
    numCols = 0;
    for (let i: u32 = 0; i < SIMPLEX_MAX_VARS; i++) {
        nonBasicValues[i] = 0.0;
        constraintNodeIds[i] = 0;
    }
    for (let i: u32 = 0; i < SIMPLEX_MAX_ROWS; i++) {
        basicValues[i] = 0.0;
    }
    for (let i: u32 = 0; i < SIMPLEX_MAX_VARS * 2; i++) {
        boundsLo[i] = -1e100;
        boundsHi[i] = 1e100;
    }
}

export function addLinearConstraint(coeffsPtr: u32, limit: f64, isUpper: u8): boolean {
    let MAX_COLS: u32 = SIMPLEX_MAX_VARS;
    if (numRows >= SIMPLEX_MAX_ROWS) return false;
    
    let rowIdx = numRows++;
    
    // Introduce slack variable for the inequality
    let slackVar = numCols + numRows;
    basicVars[rowIdx] = slackVar;
    boundsLo[slackVar] = isUpper ? -1e100 : limit;
    boundsHi[slackVar] = isUpper ? limit : 1e100;
    
    // Load constraint coefficients from the Arena into the tableau
    for (let c: u32 = 0; c < numCols; c++) {
        tableauData[rowIdx * MAX_COLS + c] = load<f64>(coeffsPtr + c * 8);
    }
    
    // Compute the initial basic variable value (dot product of row * nonBasicValues)
    let val: f64 = 0.0;
    for (let c: u32 = 0; c < numCols; c++) {
        val += tableauData[rowIdx * MAX_COLS + c] * nonBasicValues[c];
    }
    basicValues[rowIdx] = val;
    
    return true;
}

// Track which AST node generated each constraint (for unsat core extraction)
export function setConstraintOrigin(rowIdx: u32, nodeId: u32): void {
    if (rowIdx < SIMPLEX_MAX_ROWS) constraintNodeIds[rowIdx] = nodeId;
}

export function pivotSimplex(enterCol: u32, leaveRow: u32): void {
    let MAX_COLS: u32 = SIMPLEX_MAX_VARS;
    let pivotIdx = leaveRow * MAX_COLS + enterCol;
    let pivotVal = tableauData[pivotIdx];
    
    tableauData[pivotIdx] = 1.0 / pivotVal;
    
    for (let c: u32 = 0; c < numCols; c++) {
        if (c != enterCol) {
            tableauData[leaveRow * MAX_COLS + c] /= pivotVal;
        }
    }
    
    for (let r: u32 = 0; r < numRows; r++) {
        if (r != leaveRow) {
            let multIdx = r * MAX_COLS + enterCol;
            let mult = tableauData[multIdx];
            tableauData[multIdx] = -mult / pivotVal;
            
            for (let c: u32 = 0; c < numCols; c++) {
                if (c != enterCol) {
                    tableauData[r * MAX_COLS + c] -= mult * tableauData[leaveRow * MAX_COLS + c];
                }
            }
        }
    }
    
    // Swap basic and non-basic variables (Bland's Rule tracking)
    let temp = basicVars[leaveRow];
    basicVars[leaveRow] = nonBasicVars[enterCol];
    nonBasicVars[enterCol] = temp;
}

export function checkSimplexFeasibility(): boolean {
    let MAX_COLS: u32 = SIMPLEX_MAX_VARS;
    let iterations = 0;
    
    // Phase 1 Simplex loop: resolve bounds violations on basic variables
    while (iterations < 1000) {
        iterations++;
        
        let leaveRow: u32 = 0xFFFFFFFF;
        let violation: f64 = 0.0;
        
        for (let r: u32 = 0; r < numRows; r++) {
            let bVar = basicVars[r];
            let val: f64 = 0.0;
            for (let c: u32 = 0; c < numCols; c++) {
                val += tableauData[r * MAX_COLS + c] * nonBasicValues[c];
            }
            basicValues[r] = val;
            
            if (val < boundsLo[bVar]) {
                leaveRow = r;
                violation = boundsLo[bVar] - val;
                break;
            }
            if (val > boundsHi[bVar]) {
                leaveRow = r;
                violation = boundsHi[bVar] - val;
                break;
            }
        }
        
        if (leaveRow == 0xFFFFFFFF) return true; // All basic vars within bounds → Feasible
        
        let enterCol: u32 = 0xFFFFFFFF;
        for (let c: u32 = 0; c < numCols; c++) {
            let coeff = tableauData[leaveRow * MAX_COLS + c];
            if ((violation > 0 && coeff > 0) || (violation < 0 && coeff < 0)) {
                let nbVar = nonBasicVars[c];
                if (violation > 0 && nonBasicValues[c] < boundsHi[nbVar]) {
                    enterCol = c;
                    break;
                }
                if (violation < 0 && nonBasicValues[c] > boundsLo[nbVar]) {
                    enterCol = c;
                    break;
                }
            }
        }
        
        if (enterCol == 0xFFFFFFFF) {
            extractUnsatCore(leaveRow);
            return false;
        }
        
        pivotSimplex(enterCol, leaveRow);
    }
    return true;
}

export function extractUnsatCore(rowIdx: u32): u32 {
    let MAX_COLS: u32 = SIMPLEX_MAX_VARS;
    let corePtr = simplexArenaOffset;
    let coreSize: u32 = 0;
    
    if (constraintNodeIds[rowIdx] != 0) {
        store<u32>(corePtr + 4 + coreSize * 4, constraintNodeIds[rowIdx]);
        coreSize++;
    }
    
    for (let c: u32 = 0; c < numCols; c++) {
        let coeff = tableauData[rowIdx * MAX_COLS + c];
        if (coeff != 0.0) {
            for (let r: u32 = 0; r < numRows; r++) {
                if (r != rowIdx && tableauData[r * MAX_COLS + c] != 0.0 && constraintNodeIds[r] != 0) {
                    let dup = false;
                    for (let j: u32 = 0; j < coreSize; j++) {
                        if (load<u32>(corePtr + 4 + j * 4) == constraintNodeIds[r]) { dup = true; break; }
                    }
                    if (!dup) {
                        store<u32>(corePtr + 4 + coreSize * 4, constraintNodeIds[r]);
                        coreSize++;
                    }
                }
            }
        }
    }
    
    store<u32>(corePtr, coreSize);
    simplexArenaOffset += 4 + coreSize * 4;
    
    return corePtr;
}
`;
}
