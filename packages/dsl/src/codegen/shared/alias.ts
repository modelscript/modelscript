// --- Steensgaard Points-To Alias Analysis ---
// Zero-GC Union-Find Disjoint Set data structure in WASM linear memory.

export function generateAliasAnalysis(): string {
  return `
import { allocGen0 } from "./arena";

// --- Steensgaard Disjoint-Set Alias Environment ---

let aliasParentBuf: u32 = 0;
let aliasRankBuf: u32 = 0;
let aliasCapacity: u32 = 0;

export function initAliasEnvironment(maxVars: u32): void {
    if (maxVars == 0) return;
    aliasCapacity = maxVars;
    aliasParentBuf = allocGen0(maxVars * 4);
    aliasRankBuf = allocGen0(maxVars * 4);

    for (let i: u32 = 0; i < maxVars; i++) {
        store<u32>(aliasParentBuf + i * 4, i);
        store<u32>(aliasRankBuf + i * 4, 0);
    }
}

export function findAliasRoot(varId: u32): u32 {
    if (varId >= aliasCapacity || aliasParentBuf == 0) return varId;

    let parent = load<u32>(aliasParentBuf + varId * 4);
    if (parent == varId) return varId;

    // Path compression
    let root = findAliasRoot(parent);
    store<u32>(aliasParentBuf + varId * 4, root);
    return root;
}

export function unifyAlias(var1: u32, var2: u32): void {
    let root1 = findAliasRoot(var1);
    let root2 = findAliasRoot(var2);

    if (root1 == root2) return;

    let rank1 = load<u32>(aliasRankBuf + root1 * 4);
    let rank2 = load<u32>(aliasRankBuf + root2 * 4);

    // Union by rank
    if (rank1 < rank2) {
        store<u32>(aliasParentBuf + root1 * 4, root2);
    } else if (rank1 > rank2) {
        store<u32>(aliasParentBuf + root2 * 4, root1);
    } else {
        store<u32>(aliasParentBuf + root2 * 4, root1);
        store<u32>(aliasRankBuf + root1 * 4, rank1 + 1);
    }
}

export function areAliased(var1: u32, var2: u32): boolean {
    return findAliasRoot(var1) == findAliasRoot(var2);
}
`;
}
