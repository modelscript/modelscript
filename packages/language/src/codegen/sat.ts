import { LanguageOptions } from "../dsl.js";

export function generateSAT(grammarDef: LanguageOptions, normalized: any): string {
  const reasonerExt = (grammarDef.semantics?.reasoner as any)?.extensions || {};
  const hasRecursiveFn = reasonerExt.recursiveUnroll
    ? (normalized.symToInt?.has(reasonerExt.recursiveUnroll) ?? false)
    : false;
  const hasProveInductive = reasonerExt.inductiveProof
    ? (normalized.symToInt?.has(reasonerExt.inductiveProof) ?? false)
    : false;
  const hasEgraph = !!(grammarDef as any).optimization?.egraph;
  const hasLRA = !!(grammarDef.semantics?.reasoner as any)?.smt?.theories?.includes("LRA");

  return `
// --- Native DPLL(T) Boolean Engine (Phase 1) ---
// Incremental SAT Solver using Two-Watched Literals and Salsa caching.

export const SAT_TRUE: u8 = 1;
export const SAT_FALSE: u8 = 2;
export const SAT_UNASSIGNED: u8 = 0;

let satArenaOffset: u32 = 0;
let satVariableCount: u32 = 0;

let learnedClausePtrs = new ChunkedUint32Array(50000);
let learnedClauseLBDs = new ChunkedUint32Array(50000);
let learnedClauseCount: u32 = 0;
const CLAUSE_DB_LIMIT: u32 = 10000;
const LBD_KEEP_THRESHOLD: u32 = 6;

let lubyIndex: u32 = 1;
let conflictsUntilRestart: u32 = 100;
let conflictsSinceRestart: u32 = 0;
const RESTART_BASE: u32 = 100;

function lubySequence(i: u32): u32 {
    let k: u32 = 1;
    let seq: u32 = 1;
    while (true) {
        if (i == (1 << k) - 1) return seq;
        if (i >= (1 << (k - 1))) {
            i -= (1 << (k - 1));
            k = 1;
            seq = 1;
        } else {
            k++;
            seq <<= 1;
        }
        if (k > 30) return 1;
    }
}

export function initSATArena(startOffset: u32): void {
    satArenaOffset = startOffset;
    satVariableCount = 0;
    learnedClauseCount = 0;
    lubyIndex = 1;
    conflictsUntilRestart = RESTART_BASE;
    conflictsSinceRestart = 0;
}

let nodeToSatVar = new ChunkedUint32Array(100000);
let satVarToNode = new ChunkedUint32Array(100000);

export function getOrCreateSatVar(nodeId: u32): u32 {
    let v = nodeToSatVar[nodeId];
    if (v == 0) {
        satVariableCount++;
        v = satVariableCount;
        nodeToSatVar[nodeId] = v;
        satVarToNode[v] = nodeId;
        heapPos[v] = 0xFFFFFFFF;
        heapInsert(v);
    }
    return v;
}

let assignmentTrail = new ChunkedUint32Array(100000);
let assignmentValues = new Uint8Array(100000);
let trailTop: u32 = 0;
let propagatedTop: u32 = 0;

let decisionLevels = new ChunkedUint32Array(100000);
let reasonClauses = new ChunkedUint32Array(100000);
let currentDecisionLevel: u32 = 0;
let trailLim = new ChunkedUint32Array(10000);
let trailLimSize: u32 = 0;

let seen = new Uint8Array(100000);
let learntBuf = new ChunkedUint32Array(1000);
let learntSize: u32 = 0;

function litValue(lit: u32): u8 {
    let v = lit >> 1;
    let asgn = assignmentValues[v];
    if (asgn == SAT_UNASSIGNED) return SAT_UNASSIGNED;
    let sign = lit & 1;
    if (sign == 0) return asgn;
    return asgn == SAT_TRUE ? SAT_FALSE : SAT_TRUE;
}

let activityScores = new Float64Array(100000);
let activityInc: f64 = 1.0;

let vsidsHeap = new ChunkedUint32Array(100000);
let heapSize: u32 = 0;
let heapPos = new ChunkedUint32Array(100000);

function heapParent(i: u32): u32 { return (i - 1) >> 1; }
function heapLeft(i: u32): u32 { return 2 * i + 1; }
function heapRight(i: u32): u32 { return 2 * i + 2; }

function heapSwap(a: u32, b: u32): void {
    let va = vsidsHeap[a];
    let vb = vsidsHeap[b];
    vsidsHeap[a] = vb;
    vsidsHeap[b] = va;
    heapPos[va] = b;
    heapPos[vb] = a;
}

function heapSiftUp(i: u32): void {
    while (i > 0) {
        let p = heapParent(i);
        if (activityScores[vsidsHeap[i]] > activityScores[vsidsHeap[p]]) {
            heapSwap(i, p);
            i = p;
        } else break;
    }
}

function heapSiftDown(i: u32): void {
    while (true) {
        let best = i;
        let l = heapLeft(i);
        let r = heapRight(i);
        if (l < heapSize && activityScores[vsidsHeap[l]] > activityScores[vsidsHeap[best]]) best = l;
        if (r < heapSize && activityScores[vsidsHeap[r]] > activityScores[vsidsHeap[best]]) best = r;
        if (best == i) break;
        heapSwap(i, best);
        i = best;
    }
}

function heapInsert(v: u32): void {
    if (heapPos[v] != 0xFFFFFFFF) return;
    let pos = heapSize++;
    vsidsHeap[pos] = v;
    heapPos[v] = pos;
    heapSiftUp(pos);
}

function heapRemoveTop(): u32 {
    if (heapSize == 0) return 0;
    let top = vsidsHeap[0];
    heapSize--;
    if (heapSize > 0) {
        vsidsHeap[0] = vsidsHeap[heapSize];
        heapPos[vsidsHeap[0]] = 0;
        heapSiftDown(0);
    }
    heapPos[top] = 0xFFFFFFFF;
    return top;
}

function bumpActivity(v: u32): void {
    activityScores[v] += activityInc;
    if (activityScores[v] > 1e100) {
        for (let i: u32 = 1; i <= satVariableCount; i++) {
            activityScores[i] *= 1e-100;
        }
        activityInc *= 1e-100;
    }
    if (heapPos[v] != 0xFFFFFFFF) {
        heapSiftUp(heapPos[v]);
    }
}

function decayActivity(): void {
    activityInc /= 0.95;
}

function decideNextBranch(): u32 {
    while (heapSize > 0) {
        let bestVar = heapRemoveTop();
        if (bestVar > 0 && assignmentValues[bestVar] == SAT_UNASSIGNED) {
            return (bestVar << 1);
        }
    }
    return 0;
}

let watchersHead = new ChunkedUint32Array(200000);
let watcherNext = new ChunkedUint32Array(500000);
let watcherClause = new ChunkedUint32Array(500000);
let watcherCount: u32 = 1;

export function addWatcher(lit: u32, clausePtr: u32): void {
    let idx = watcherCount++;
    watcherClause[idx] = clausePtr;
    watcherNext[idx] = watchersHead[lit];
    watchersHead[lit] = idx;
}

function assignLiteralReason(lit: u32, val: u8, reason: u32): boolean {
    let v = lit >> 1;
    let sign = lit & 1;
    let targetVal = sign ? (val == SAT_TRUE ? SAT_FALSE : SAT_TRUE) : val;
    
    if (assignmentValues[v] == SAT_UNASSIGNED) {
        assignmentValues[v] = targetVal;
        assignmentTrail[trailTop++] = lit;
        decisionLevels[v] = currentDecisionLevel;
        reasonClauses[v] = reason;
        
        return true;
    } else if (assignmentValues[v] != targetVal) {
        return false;
    }
    return true;
}

export function assignLiteral(lit: u32, val: u8): boolean {
    return assignLiteralReason(lit, val, 0);
}

export function propagateBCP(): u32 {
    while (propagatedTop < trailTop) {
        let pLit = assignmentTrail[propagatedTop++];
        let falseLit = pLit ^ 1;
        
        let prevIdx: u32 = 0;
        let currIdx = watchersHead[falseLit];
        
        while (currIdx != 0) {
            let clausePtr = watcherClause[currIdx];
            let nextIdx = watcherNext[currIdx];
            let clauseSize = load<u32>(clausePtr);
            
            let lit0 = load<u32>(clausePtr + 8);
            let lit1 = load<u32>(clausePtr + 12);
            
            if (lit0 == falseLit) {
                store<u32>(clausePtr + 8, lit1);
                store<u32>(clausePtr + 12, lit0);
                lit0 = lit1;
                lit1 = falseLit;
            }
            
            if (litValue(lit0) == SAT_TRUE) {
                prevIdx = currIdx;
                currIdx = nextIdx;
                continue;
            }
            
            let foundReplacement: boolean = false;
            for (let k: u32 = 2; k < clauseSize; k++) {
                let litK = load<u32>(clausePtr + 8 + k * 4);
                if (litValue(litK) != SAT_FALSE) {
                    store<u32>(clausePtr + 12, litK);
                    store<u32>(clausePtr + 8 + k * 4, lit1);
                    
                    if (prevIdx == 0) {
                        watchersHead[falseLit] = nextIdx;
                    } else {
                        watcherNext[prevIdx] = nextIdx;
                    }
                    addWatcher(litK ^ 1, clausePtr);
                    
                    foundReplacement = true;
                    break;
                }
            }
            
            if (foundReplacement) {
                currIdx = nextIdx;
                continue;
            }
            
            if (litValue(lit0) == SAT_FALSE) {
                return clausePtr;
            }
            
            if (!assignLiteralReason(lit0, SAT_TRUE, clausePtr)) {
                return clausePtr;
            }
            
            prevIdx = currIdx;
            currIdx = nextIdx;
        }
    }
    return 0;
}

export function analyzeConflict(conflictClausePtr: u32): u32 {
    learntSize = 0;
    let pathCount: u32 = 0;
    let btLevel: u32 = 0;
    
    let resolvePtr = conflictClausePtr;
    let trailIdx: i32 = trailTop as i32 - 1;
    let p: u32 = 0xFFFFFFFF;
    
    while (true) {
        let rSize = load<u32>(resolvePtr);
        for (let i: u32 = 0; i < rSize; i++) {
            let lit = load<u32>(resolvePtr + 8 + i * 4);
            let v = lit >> 1;
            
            if (seen[v] != 0) continue;
            if (v == 0) continue;
            
            seen[v] = 1;
            bumpActivity(v);
            
            if (decisionLevels[v] == currentDecisionLevel) {
                pathCount++;
            } else if (decisionLevels[v] > 0) {
                learntBuf[learntSize++] = lit;
                if (decisionLevels[v] > btLevel) btLevel = decisionLevels[v];
            }
        }
        
        while (trailIdx >= 0) {
            let tLit = assignmentTrail[trailIdx as u32];
            let tVar = tLit >> 1;
            trailIdx--;
            if (seen[tVar] != 0) {
                p = tLit;
                pathCount--;
                break;
            }
        }
        
        if (pathCount == 0) break;
        
        let pVar = p >> 1;
        resolvePtr = reasonClauses[pVar];
        if (resolvePtr == 0) break;
    }
    
    for (let i: u32 = learntSize; i > 0; i--) {
        learntBuf[i] = learntBuf[i - 1];
    }
    learntBuf[0] = p ^ 1;
    learntSize++;
    
    for (let i: u32 = 0; i < learntSize; i++) {
        seen[learntBuf[i] >> 1] = 0;
    }
    for (let i: u32 = 0; i < trailTop; i++) {
        seen[assignmentTrail[i] >> 1] = 0;
    }
    
    decayActivity();
    if (learntSize == 1) btLevel = 0;
    return btLevel;
}

export function addLearnedClause(clausePtr: u32): void {
    let size = load<u32>(clausePtr);
    if (size >= 2) {
        let lit0 = load<u32>(clausePtr + 8);
        let lit1 = load<u32>(clausePtr + 12);
        addWatcher(lit0 ^ 1, clausePtr);
        addWatcher(lit1 ^ 1, clausePtr);
    }
}

function commitLearnedClause(): u32 {
    let clausePtr = satArenaOffset;
    store<u32>(clausePtr, learntSize);
    store<u32>(clausePtr + 4, 1);
    for (let i: u32 = 0; i < learntSize; i++) {
        store<u32>(clausePtr + 8 + i * 4, learntBuf[i]);
    }
    satArenaOffset += 8 + learntSize * 4;
    
    let lbd = computeLBD();
    if (learnedClauseCount < 50000) {
        learnedClausePtrs[learnedClauseCount] = clausePtr;
        learnedClauseLBDs[learnedClauseCount] = lbd;
        learnedClauseCount++;
    }
    return clausePtr;
}

function computeLBD(): u32 {
    let lbd: u32 = 0;
    for (let i: u32 = 0; i < learntSize; i++) {
        let v = learntBuf[i] >> 1;
        let dl = decisionLevels[v];
        if (dl < 100000 && seen[dl] == 0) {
            seen[dl] = 1;
            lbd++;
        }
    }
    for (let i: u32 = 0; i < learntSize; i++) {
        let v = learntBuf[i] >> 1;
        seen[decisionLevels[v]] = 0;
    }
    return lbd;
}

function reduceLearnedClauses(): void {
    if (learnedClauseCount <= CLAUSE_DB_LIMIT) return;
    let writeIdx: u32 = 0;
    for (let i: u32 = 0; i < learnedClauseCount; i++) {
        let lbd = learnedClauseLBDs[i];
        let size = load<u32>(learnedClausePtrs[i]);
        if (lbd <= LBD_KEEP_THRESHOLD || size <= 2) {
            learnedClausePtrs[writeIdx] = learnedClausePtrs[i];
            learnedClauseLBDs[writeIdx] = lbd;
            writeIdx++;
        }
    }
    learnedClauseCount = writeIdx;
}

function backtrackTo(level: u32): void {
    while (trailTop > 0) {
        let lit = assignmentTrail[trailTop - 1];
        let v = lit >> 1;
        if (decisionLevels[v] <= level) break;
        
        assignmentValues[v] = SAT_UNASSIGNED;
        reasonClauses[v] = 0;
        trailTop--;
        heapInsert(v);
    }
    propagatedTop = trailTop;
    currentDecisionLevel = level;
    trailLimSize = level;
}

export function solveDPLL(constraintRootId: u32): boolean {
    let iterations: u32 = 0;
    while (iterations < 100000) {
        iterations++;
        let conflictPtr = propagateBCP();
        
        if (conflictPtr != 0) {
            conflictsSinceRestart++;
            if (currentDecisionLevel == 0) return false;
            
            let btLevel = analyzeConflict(conflictPtr);
            backtrackTo(btLevel);
            let learnedPtr = commitLearnedClause();
            addLearnedClause(learnedPtr);
            assignLiteralReason(learntBuf[0], SAT_TRUE, learnedPtr);
            
            if (learnedClauseCount > CLAUSE_DB_LIMIT) reduceLearnedClauses();
            
            if (conflictsSinceRestart >= conflictsUntilRestart) {
                backtrackTo(0);
                conflictsSinceRestart = 0;
                conflictsUntilRestart = lubySequence(lubyIndex) * RESTART_BASE;
                lubyIndex++;
            }
            continue;
        }
        
        let nextLit = decideNextBranch();
        if (nextLit == 0) return true;
        
        currentDecisionLevel++;
        trailLim[trailLimSize++] = trailTop;
        assignLiteralReason(nextLit, SAT_TRUE, 0);
    }
    return true;
}

let modelDataOffset: u32 = 0;
let modelEntryCount: u32 = 0;

export function extractModel(): u32 {
    modelDataOffset = satArenaOffset;
    modelEntryCount = 0;
    
    for (let v: u32 = 1; v <= satVariableCount; v++) {
        let val = assignmentValues[v];
        if (val == SAT_UNASSIGNED) continue;
        
        let nodeId = satVarToNode[v];
        if (nodeId == 0) continue;
        
        let entryPtr = modelDataOffset + modelEntryCount * 16;
        store<u32>(entryPtr, nodeId);
        store<u32>(entryPtr + 4, val == SAT_TRUE ? 1 : 0);
        store<f64>(entryPtr + 8, val == SAT_TRUE ? 1.0 : 0.0);
        modelEntryCount++;
    }
    
    let headerPtr = modelDataOffset + modelEntryCount * 16;
    store<u32>(headerPtr, modelEntryCount);
    satArenaOffset = headerPtr + 4;
    return modelDataOffset;
}

export function getModelEntryCount(): u32 {
    return modelEntryCount;
}

export function getModelEntry(idx: u32): u32 {
    return modelDataOffset + idx * 16;
}
`;
}
