import { LanguageOptions } from "../dsl.js";

export function generateBlt(grammarDef?: LanguageOptions): string {
  return `// --- Bipartite Graph Matching & BLT Sorting (Phase 7) ---
// Hopcroft-Karp maximum bipartite matching & Tarjan's SCC algorithm for BLT form

let bltArenaOffset: u32 = 0;
let numEqs: u32 = 0;
let numVars: u32 = 0;

let incidenceMatrixOffset: u32 = 0;

let pairUOffset: u32 = 0;
let pairVOffset: u32 = 0;
let distOffset: u32 = 0;

export function initBlt(e: u32, v: u32): void {
    numEqs = e;
    numVars = v;
    bltArenaOffset = arenaOffset;
    
    incidenceMatrixOffset = bltArenaOffset;
    bltArenaOffset += (numEqs * numVars); 
    
    pairUOffset = bltArenaOffset;
    bltArenaOffset += (numEqs + 1) * 4;
    
    pairVOffset = bltArenaOffset;
    bltArenaOffset += (numVars + 1) * 4;
    
    distOffset = bltArenaOffset;
    bltArenaOffset += (numEqs + 1) * 4;
    
    arenaOffset = bltArenaOffset;
}

export function addEdge(eqId: u32, varId: u32, weight: u8 = 0): void {
    if (eqId >= numEqs || varId >= numVars) return;
    store<u8>(incidenceMatrixOffset + (eqId * numVars) + varId, weight + 1);
}

export function hasEdge(eqId: u32, varId: u32): boolean {
    return load<u8>(incidenceMatrixOffset + (eqId * numVars) + varId) > 0;
}

export function getEdgeWeight(eqId: u32, varId: u32): u8 {
    let val = load<u8>(incidenceMatrixOffset + (eqId * numVars) + varId);
    return val > 0 ? (val - 1) : 0;
}

function hkBfs(): boolean {
    let head: u32 = 0;
    let tail: u32 = 0;
    let queueOffset = bltArenaOffset;
    
    for (let u: u32 = 1; u <= numEqs; u++) {
        if (load<u32>(pairUOffset + u * 4) == 0) {
            store<u32>(distOffset + u * 4, 0);
            store<u32>(queueOffset + tail * 4, u);
            tail++;
        } else {
            store<u32>(distOffset + u * 4, 0xFFFFFFFF);
        }
    }
    
    store<u32>(distOffset, 0xFFFFFFFF);
    
    while (head < tail) {
        let u = load<u32>(queueOffset + head * 4);
        head++;
        
        if (load<u32>(distOffset + u * 4) < load<u32>(distOffset)) {
            for (let v: u32 = 1; v <= numVars; v++) {
                if (hasEdge(u - 1, v - 1)) {
                    let pairV = load<u32>(pairVOffset + v * 4);
                    if (load<u32>(distOffset + pairV * 4) == 0xFFFFFFFF) {
                        store<u32>(distOffset + pairV * 4, load<u32>(distOffset + u * 4) + 1);
                        store<u32>(queueOffset + tail * 4, pairV);
                        tail++;
                    }
                }
            }
        }
    }
    return load<u32>(distOffset) != 0xFFFFFFFF;
}

function hkDfs(u: u32): boolean {
    if (u != 0) {
        for (let v: u32 = 1; v <= numVars; v++) {
            if (hasEdge(u - 1, v - 1)) {
                let pairV = load<u32>(pairVOffset + v * 4);
                if (load<u32>(distOffset + pairV * 4) == load<u32>(distOffset + u * 4) + 1) {
                    if (hkDfs(pairV)) {
                        store<u32>(pairVOffset + v * 4, u);
                        store<u32>(pairUOffset + u * 4, v);
                        return true;
                    }
                }
            }
        }
        store<u32>(distOffset + u * 4, 0xFFFFFFFF);
        return false;
    }
    return true;
}

export function runHopcroftKarp(): u32 {
    for (let i: u32 = 0; i <= numEqs; i++) store<u32>(pairUOffset + i * 4, 0);
    for (let i: u32 = 0; i <= numVars; i++) store<u32>(pairVOffset + i * 4, 0);
    
    let matching: u32 = 0;
    while (hkBfs()) {
        for (let u: u32 = 1; u <= numEqs; u++) {
            if (load<u32>(pairUOffset + u * 4) == 0) {
                if (hkDfs(u)) matching++;
            }
        }
    }
    return matching;
}

let bltBlocksOffset: u32 = 0;
let bltBlockPtr: u32 = 0;

let dfnOffset: u32 = 0;
let lowOffset: u32 = 0;
let inStackOffset: u32 = 0;
let tarjanStackOffset: u32 = 0;
let tarjanStackPtr: u32 = 0;
let tarjanTimer: u32 = 1;
let sccCount: u32 = 0;

export function runTarjanScc(): u32 {
    let tarjanArena = bltArenaOffset + (numEqs * 4);
    dfnOffset = tarjanArena; tarjanArena += (numEqs + 1) * 4;
    lowOffset = tarjanArena; tarjanArena += (numEqs + 1) * 4;
    inStackOffset = tarjanArena; tarjanArena += (numEqs + 1);
    tarjanStackOffset = tarjanArena; tarjanArena += (numEqs + 1) * 4;
    
    bltBlocksOffset = tarjanArena; 
    tarjanArena += (numEqs + 1) * 20;
    bltBlockPtr = 0;
    
    for (let i: u32 = 1; i <= numEqs; i++) {
        store<u32>(dfnOffset + i * 4, 0);
        store<u8>(inStackOffset + i, 0);
    }
    
    tarjanStackPtr = 0;
    tarjanTimer = 1;
    sccCount = 0;
    
    for (let i: u32 = 1; i <= numEqs; i++) {
        if (load<u32>(dfnOffset + i * 4) == 0) {
            tarjanDfs(i);
        }
    }
    return sccCount;
}

function tarjanDfs(u: u32): void {
    store<u32>(dfnOffset + u * 4, tarjanTimer);
    store<u32>(lowOffset + u * 4, tarjanTimer);
    tarjanTimer++;
    
    store<u32>(tarjanStackOffset + tarjanStackPtr * 4, u);
    tarjanStackPtr++;
    store<u8>(inStackOffset + u, 1);
    
    let matchedVar = load<u32>(pairUOffset + u * 4);
    if (matchedVar != 0) {
        for (let nextEq: u32 = 1; nextEq <= numEqs; nextEq++) {
            if (nextEq != u && hasEdge(nextEq - 1, matchedVar - 1)) {
                let dfnNext = load<u32>(dfnOffset + nextEq * 4);
                if (dfnNext == 0) {
                    tarjanDfs(nextEq);
                    let lowU = load<u32>(lowOffset + u * 4);
                    let lowV = load<u32>(lowOffset + nextEq * 4);
                    if (lowV < lowU) store<u32>(lowOffset + u * 4, lowV);
                } else if (load<u8>(inStackOffset + nextEq) == 1) {
                    let lowU = load<u32>(lowOffset + u * 4);
                    if (dfnNext < lowU) store<u32>(lowOffset + u * 4, dfnNext);
                }
            }
        }
    }
    
    let dfnU = load<u32>(dfnOffset + u * 4);
    let lowU = load<u32>(lowOffset + u * 4);
    
    if (dfnU == lowU) {
        sccCount++;
        let blockStruct = bltBlocksOffset + bltBlockPtr * 20;
        bltBlockPtr++;
        
        let sccSize: u32 = 0;
        while (true) {
            tarjanStackPtr--;
            let v = load<u32>(tarjanStackOffset + tarjanStackPtr * 4);
            store<u8>(inStackOffset + v, 0);
            sccSize++;
            if (v == u) break;
        }
        store<u32>(blockStruct + 4, sccSize);
    }
}
`;
}
