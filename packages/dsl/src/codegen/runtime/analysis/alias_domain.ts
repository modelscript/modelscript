// --- Steensgaard Points-To Alias Analysis ---
// Zero-GC Union-Find Disjoint Set data structure in WASM linear memory.

import { allocGen0 } from "../arena";
import { UnmanagedUint32Array } from "../core/array";

// --- Steensgaard Disjoint-Set Alias Environment ---

let aliasParents: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let aliasRanks: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let aliasCapacity: u32 = 0;

export function initAliasEnvironment(maxVars: u32): void {
    if (maxVars == 0) return;
    aliasCapacity = maxVars;
    aliasParents = changetype<UnmanagedUint32Array>(allocGen0(maxVars * 4));
    aliasRanks = changetype<UnmanagedUint32Array>(allocGen0(maxVars * 4));

    for (let i: u32 = 0; i < maxVars; i++) {
        aliasParents[i] = i;
        aliasRanks[i] = 0;
    }
}

export function findAliasRoot(varId: u32): u32 {
    if (varId >= aliasCapacity || aliasParents == changetype<UnmanagedUint32Array>(0)) return varId;

    let parent = aliasParents[varId];
    if (parent == varId) return varId;

    // Path compression
    let root = findAliasRoot(parent);
    aliasParents[varId] = root;
    return root;
}

export function unifyAlias(var1: u32, var2: u32): void {
    let root1 = findAliasRoot(var1);
    let root2 = findAliasRoot(var2);

    if (root1 == root2) return;

    let rank1 = aliasRanks[root1];
    let rank2 = aliasRanks[root2];

    // Union by rank
    if (rank1 < rank2) {
        aliasParents[root1] = root2;
    } else if (rank1 > rank2) {
        aliasParents[root2] = root1;
    } else {
        aliasParents[root2] = root1;
        aliasRanks[root1] = rank1 + 1;
    }
}

export function areAliased(var1: u32, var2: u32): boolean {
    return findAliasRoot(var1) == findAliasRoot(var2);
}
