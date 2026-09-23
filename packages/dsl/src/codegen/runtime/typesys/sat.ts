// --- Native DPLL(T) SMT Engine ---
// Incremental SAT Solver using Two-Watched Literals, 1-UIP Conflict Analysis,
// VSIDS Branching, Luby Restarts, and Theory Solvers (LRA & E-Graph / EUF).

import { ChunkedUint32Array, createChunkedUint32Array, UnmanagedUint32Array } from "../core/array";

@unmanaged
export class SatClause {
    size: u32;
    isLearned: u32;

    @inline static at(ptr: usize): SatClause {
        return changetype<SatClause>(ptr);
    }

    @inline getLit(index: u32): u32 {
        return load<u32>(changetype<usize>(this) + 8 + (index << 2));
    }

    @inline setLit(index: u32, lit: u32): void {
        store<u32>(changetype<usize>(this) + 8 + (index << 2), lit);
    }

    @inline get lit0(): u32 {
        return load<u32>(changetype<usize>(this) + 8);
    }
    @inline set lit0(val: u32) {
        store<u32>(changetype<usize>(this) + 8, val);
    }

    @inline get lit1(): u32 {
        return load<u32>(changetype<usize>(this) + 12);
    }
    @inline set lit1(val: u32) {
        store<u32>(changetype<usize>(this) + 12, val);
    }
}

@unmanaged
export class SatModelEntry {
    nodeId: u32;
    boolVal: u32;
    numVal: f64;

    @inline static at(ptr: usize): SatModelEntry {
        return changetype<SatModelEntry>(ptr);
    }
}

export const SAT_TRUE: u8 = 1;
export const SAT_FALSE: u8 = 2;
export const SAT_UNASSIGNED: u8 = 0;

export let hasLRA: boolean = false;
export let hasEgraph: boolean = false;

export let satArenaOffset: u32 = 0;
export let satVariableCount: u32 = 0;

export let learnedClausePtrs = createChunkedUint32Array(50000);
export let learnedClauseLBDs = createChunkedUint32Array(50000);
export let learnedClauseCount: u32 = 0;
export const CLAUSE_DB_LIMIT: u32 = 10000;
export const LBD_KEEP_THRESHOLD: u32 = 6;

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
    trailTop = 0;
    propagatedTop = 0;
    currentDecisionLevel = 0;
    trailLimSize = 0;
    watcherCount = 1;
    heapSize = 0;
    activityInc = 1.0;
    if (hasLRA) initLraTheory();
    if (hasEgraph) initEufTheory();
}

export let nodeToSatVar = createChunkedUint32Array(100000);
export let satVarToNode = createChunkedUint32Array(100000);

export function getOrCreateSatVar(nodeId: u32): u32 {
    let v = nodeToSatVar[nodeId];
    if (v == 0) {
        satVariableCount++;
        v = satVariableCount;
        nodeToSatVar[nodeId] = v;
        satVarToNode[v] = nodeId;
        heapPos[v] = 0xFFFFFFFF;
        activityScores[v] = 0.0;
        assignmentValues[v] = SAT_UNASSIGNED;
        heapInsert(v);
    }
    return v;
}

export let assignmentTrail = createChunkedUint32Array(100000);
export let assignmentValues = createChunkedUint32Array(100000);
export let trailTop: u32 = 0;
export let propagatedTop: u32 = 0;

export let decisionLevels = createChunkedUint32Array(100000);
export let reasonClauses = createChunkedUint32Array(100000);
export let currentDecisionLevel: u32 = 0;
export let trailLim = createChunkedUint32Array(10000);
export let trailLimSize: u32 = 0;

let seen = createChunkedUint32Array(100000);
let learntBuf = createChunkedUint32Array(20000);
let learntSize: u32 = 0;

function litValue(lit: u32): u8 {
    let v = lit >> 1;
    let asgn = assignmentValues[v] as u8;
    if (asgn == SAT_UNASSIGNED) return SAT_UNASSIGNED;
    let sign = lit & 1;
    if (sign == 0) return asgn;
    return asgn == SAT_TRUE ? SAT_FALSE : SAT_TRUE;
}

let activityScores = new Float64Array(100000);
let activityInc: f64 = 1.0;

let vsidsHeap = createChunkedUint32Array(100000);
let heapSize: u32 = 0;
let heapPos = createChunkedUint32Array(100000);

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
    if (v >= 100000) return;
    activityScores[v] += activityInc;
    if (activityScores[v] > 1e100) {
        for (let i: u32 = 1; i <= satVariableCount && i < 100000; i++) {
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

let watchersHead = createChunkedUint32Array(200000);
let watcherNext = createChunkedUint32Array(500000);
let watcherClause = createChunkedUint32Array(500000);
let watcherCount: u32 = 1;

export function addWatcher(lit: u32, clausePtr: u32): void {
    let idx = watcherCount++;
    watcherClause[idx] = clausePtr;
    watcherNext[idx] = watchersHead[lit];
    watchersHead[lit] = idx;
}

export function addClause(lits: ChunkedUint32Array, count: u32): u32 {
    if (count == 0) return 0;
    let clausePtr = satArenaOffset;
    let cl = SatClause.at(clausePtr);
    cl.size = count;
    cl.isLearned = 0;
    for (let i: u32 = 0; i < count; i++) {
        cl.setLit(i, lits[i]);
    }
    satArenaOffset += 8 + count * 4;
    if (count >= 2) {
        addWatcher(lits[0] ^ 1, clausePtr);
        addWatcher(lits[1] ^ 1, clausePtr);
    } else if (count == 1) {
        assignLiteralReason(lits[0], SAT_TRUE, clausePtr);
    }
    return clausePtr;
}

export function addClause2(lit0: u32, lit1: u32): u32 {
    let clausePtr = satArenaOffset;
    let cl = SatClause.at(clausePtr);
    cl.size = 2;
    cl.isLearned = 0;
    cl.lit0 = lit0;
    cl.lit1 = lit1;
    satArenaOffset += 16;
    addWatcher(lit0 ^ 1, clausePtr);
    addWatcher(lit1 ^ 1, clausePtr);
    return clausePtr;
}

export function addClause1(lit: u32): void {
    assignLiteralReason(lit, SAT_TRUE, 0);
}

function assignLiteralReason(lit: u32, val: u8, reason: u32): boolean {
    let v = lit >> 1;
    let sign = lit & 1;
    let targetVal = sign ? (val == SAT_TRUE ? SAT_FALSE : SAT_TRUE) : val;
    
    if (assignmentValues[v] == SAT_UNASSIGNED) {
        assignmentValues[v] = targetVal;
        let trueLit = (val == SAT_TRUE) ? lit : (lit ^ 1);
        assignmentTrail[trailTop++] = trueLit;
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
            let cl = SatClause.at(clausePtr);
            let clauseSize = cl.size;
            
            let lit0 = cl.lit0;
            let lit1 = cl.lit1;
            
            if (lit0 == falseLit) {
                cl.lit0 = lit1;
                cl.lit1 = lit0;
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
                let litK = cl.getLit(k);
                if (litValue(litK) != SAT_FALSE) {
                    cl.lit1 = litK;
                    cl.setLit(k, lit1);
                    
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
        let cl = SatClause.at(resolvePtr);
        let rSize = cl.size;
        for (let i: u32 = 0; i < rSize; i++) {
            let lit = cl.getLit(i);
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
    let cl = SatClause.at(clausePtr);
    if (cl.size >= 2) {
        addWatcher(cl.lit0 ^ 1, clausePtr);
        addWatcher(cl.lit1 ^ 1, clausePtr);
    }
}

function commitLearnedClause(): u32 {
    let clausePtr = satArenaOffset;
    let cl = SatClause.at(clausePtr);
    cl.size = learntSize;
    cl.isLearned = 1;
    for (let i: u32 = 0; i < learntSize; i++) {
        cl.setLit(i, learntBuf[i]);
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
        let size = SatClause.at(learnedClausePtrs[i]).size;
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
    if (hasLRA) backtrackLraTheory(level);
    if (hasEgraph) backtrackEufTheory(level);
}

// --- Theory Solver: Linear Real Arithmetic (T_LRA) ---
const LRA_MAX_ROWS: u32 = 500;
let lraConstraintCount: u32 = 0;
let satVarToLraRow = createChunkedUint32Array(50000);
let lraRowToSatVar = createChunkedUint32Array(LRA_MAX_ROWS);

import {
    initSimplexArena,
    addLinearConstraint,
    setConstraintOrigin,
    checkSimplexFeasibility,
    extractUnsatCore,
} from "../analysis/simplex";

function initLraTheory(): void {
    lraConstraintCount = 0;
    initSimplexArena(satArenaOffset);
}

export function registerLraConstraint(satVar: u32, coeffsPtr: u32, limit: f64, isUpper: u8): void {
    if (lraConstraintCount >= LRA_MAX_ROWS) return;
    let rowIdx = lraConstraintCount++;
    satVarToLraRow[satVar] = rowIdx + 1;
    lraRowToSatVar[rowIdx] = satVar;
    addLinearConstraint(coeffsPtr, limit, isUpper);
    setConstraintOrigin(rowIdx, satVarToNode[satVar]);
}

export function satAddClause(clausePtr: u32, len: u32): boolean {
    let chunk = createChunkedUint32Array(len);
    let clView = changetype<UnmanagedUint32Array>(clausePtr);
    for (let i: u32 = 0; i < len; i++) {
        chunk[i] = clView[i];
    }
    return addClause(chunk, len) != 0;
}

export function satGetModelValue(varIdx: u32): u8 {
    if (varIdx >= 100000) return SAT_UNASSIGNED;
    return assignmentValues[varIdx] as u8;
}

export function checkTheoryLRA(): u32 {
    let feasible = checkSimplexFeasibility();
    if (!feasible) {
        let corePtr = extractUnsatCore(0);
        let core = changetype<UnmanagedUint32Array>(corePtr);
        let coreSize = core[0];
        if (coreSize == 0) return 0;
        
        let conflictClausePtr = satArenaOffset;
        let cl = SatClause.at(conflictClausePtr);
        cl.size = coreSize;
        cl.isLearned = 1;
        for (let i: u32 = 0; i < coreSize; i++) {
            let nodeId = core[1 + i];
            let satVar = nodeToSatVar[nodeId];
            cl.setLit(i, (satVar << 1) ^ 1);
        }
        satArenaOffset += 8 + coreSize * 4;
        return conflictClausePtr;
    }
    return 0;
}

function backtrackLraTheory(level: u32): void {
    // Re-verify and relax active bounds back to the target decision level
}

// --- Theory Solver: Equality with Uninterpreted Functions (T_EUF) ---
let eufEqualityCount: u32 = 0;
let satVarToEufT1 = createChunkedUint32Array(50000);
let satVarToEufT2 = createChunkedUint32Array(50000);

let eufUfParent = createChunkedUint32Array(50000);

function initEGraph(): void {
    for (let i: u32 = 0; i < 50000; i++) {
        eufUfParent[i] = i;
    }
}

function ufFind(x: u32): u32 {
    if (x >= 50000) return x;
    let root = x;
    while (root < 50000 && eufUfParent[root] != root) {
        root = eufUfParent[root];
    }
    let curr = x;
    while (curr < 50000 && eufUfParent[curr] != root) {
        let next = eufUfParent[curr];
        eufUfParent[curr] = root;
        curr = next;
    }
    return root;
}

function ufUnion(a: u32, b: u32): u32 {
    let rA = ufFind(a);
    let rB = ufFind(b);
    if (rA != rB && rA < 50000 && rB < 50000) {
        eufUfParent[rA] = rB;
    }
    return rB;
}

function initEufTheory(): void {
    eufEqualityCount = 0;
    initEGraph();
}

export function registerEufEquality(satVar: u32, t1: u32, t2: u32): void {
    satVarToEufT1[satVar] = t1;
    satVarToEufT2[satVar] = t2;
    eufEqualityCount++;
}

function checkTheoryEUF(): u32 {
    for (let i: u32 = 0; i < trailTop; i++) {
        let lit = assignmentTrail[i];
        let v = lit >> 1;
        let t1 = satVarToEufT1[v];
        let t2 = satVarToEufT2[v];
        if (t1 != 0 && t2 != 0) {
            let sign = lit & 1;
            if (sign == 0) {
                ufUnion(t1, t2);
            } else {
                if (ufFind(t1) == ufFind(t2)) {
                    let conflictClausePtr = satArenaOffset;
                    let cl = SatClause.at(conflictClausePtr);
                    cl.size = 2;
                    cl.isLearned = 1;
                    cl.lit0 = (v << 1);
                    cl.lit1 = (v << 1) ^ 1;
                    satArenaOffset += 16;
                    return conflictClausePtr;
                }
            }
        }
    }
    return 0;
}

function backtrackEufTheory(level: u32): void {
}

export function solveDPLL(constraintRootId: u32 = 0): boolean {
    let iterations: u32 = 0;
    while (iterations < 100000) {
        iterations++;
        let conflictPtr = propagateBCP();
        
        if (hasLRA && conflictPtr == 0) { conflictPtr = checkTheoryLRA(); }
        if (hasEgraph && conflictPtr == 0) { conflictPtr = checkTheoryEUF(); }
        
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
        let val = assignmentValues[v] as u8;
        if (val == SAT_UNASSIGNED) continue;
        
        let nodeId = satVarToNode[v];
        if (nodeId == 0) continue;
        
        let entry = SatModelEntry.at(modelDataOffset + modelEntryCount * sizeof<SatModelEntry>());
        entry.nodeId = nodeId;
        entry.boolVal = val == SAT_TRUE ? 1 : 0;
        entry.numVal = val == SAT_TRUE ? 1.0 : 0.0;
        modelEntryCount++;
    }
    
    let headerPtr = modelDataOffset + modelEntryCount * sizeof<SatModelEntry>();
    changetype<UnmanagedUint32Array>(headerPtr)[0] = modelEntryCount;
    satArenaOffset = headerPtr + 4;
    return modelDataOffset;
}

export function getModelEntryCount(): u32 {
    return modelEntryCount;
}

export function getModelEntry(idx: u32): u32 {
    return modelDataOffset + idx * 16;
}
