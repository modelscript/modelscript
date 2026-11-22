// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Linear-Memory E-Graph Core (Union-Find + Hash-Consed E-Node Table).
 * Zero-GC integer-ID data structures for `wasm_egraph_simplifier.ts`.
 */

export class WasmEGraph {
  public parent: Int32Array;
  public rank: Uint8Array;
  public classCount: i32;
  public classCap: i32;

  // Flat e-node storage: [op, left, right, eclass] per node (stride 4)
  public nodes: Int32Array;
  public nodeCount: i32;
  public nodeCap: i32;

  // Open-addressing hash-cons table mapping (op, cLeft, cRight) -> nodeId + 1 (0 = empty)
  public hashTable: Int32Array;
  public hashMask: i32;

  constructor(initialCap: i32 = 1024) {
    let cap: i32 = 64;
    while (cap < initialCap) cap <<= 1;
    this.classCap = cap;
    this.classCount = 0;
    this.parent = new Int32Array(cap);
    this.rank = new Uint8Array(cap);

    this.nodeCap = cap;
    this.nodeCount = 0;
    this.nodes = new Int32Array(cap * 4);

    const hSize = cap * 2;
    this.hashTable = new Int32Array(hSize);
    this.hashMask = hSize - 1;
  }

  private growClasses(): void {
    const newCap = this.classCap * 2;
    const newParent = new Int32Array(newCap);
    newParent.set(this.parent);
    const newRank = new Uint8Array(newCap);
    newRank.set(this.rank);
    this.parent = newParent;
    this.rank = newRank;
    this.classCap = newCap;
  }

  private growNodes(): void {
    const newCap = this.nodeCap * 2;
    const newNodes = new Int32Array(newCap * 4);
    newNodes.set(this.nodes);
    this.nodes = newNodes;
    this.nodeCap = newCap;
    this.rehash(newCap * 2);
  }

  @inline
  private hashKey(op: i32, l: i32, r: i32): i32 {
    let h: u32 = <u32>op * 0x9e3779b1;
    h ^= <u32>l * 0x85ebca77;
    h = (h << 13) | (h >> 19);
    h ^= <u32>r * 0xc2b2ae3d;
    h ^= h >> 16;
    return <i32>(h & <u32>this.hashMask);
  }

  private rehash(newSize: i32): void {
    this.hashTable = new Int32Array(newSize);
    this.hashMask = newSize - 1;
    for (let i: i32 = 0; i < this.nodeCount; i++) {
      const base = i * 4;
      const op = this.nodes[base];
      const l = this.nodes[base + 1];
      const r = this.nodes[base + 2];
      let slot = this.hashKey(op, l, r);
      while (this.hashTable[slot] != 0) {
        slot = (slot + 1) & this.hashMask;
      }
      this.hashTable[slot] = i + 1;
    }
  }

  public find(x: i32): i32 {
    let cur = x;
    while (cur >= 0 && cur < this.classCount) {
      const p = this.parent[cur];
      if (p == cur) return cur;
      const gp = this.parent[p];
      this.parent[cur] = gp;
      cur = gp;
    }
    return cur;
  }

  public union(a: i32, b: i32): i32 {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra == rb) return ra;
    if (this.rank[ra] < this.rank[rb]) {
      const tmp = ra;
      ra = rb;
      rb = tmp;
    }
    this.parent[rb] = ra;
    if (this.rank[ra] == this.rank[rb]) {
      this.rank[ra] = this.rank[ra] + 1;
    }
    return ra;
  }

  public addNode(op: i32, left: i32, right: i32): i32 {
    const cl = left >= 0 ? this.find(left) : left;
    const cr = right >= 0 ? this.find(right) : right;

    let slot = this.hashKey(op, cl, cr);
    while (true) {
      const entry = this.hashTable[slot];
      if (entry == 0) break;
      const idx = (entry - 1) * 4;
      if (this.nodes[idx] == op && this.nodes[idx + 1] == cl && this.nodes[idx + 2] == cr) {
        return this.find(this.nodes[idx + 3]);
      }
      slot = (slot + 1) & this.hashMask;
    }

    if (this.classCount >= this.classCap) this.growClasses();
    if (this.nodeCount * 2 >= this.hashMask) this.growNodes();

    const cid = this.classCount++;
    this.parent[cid] = cid;
    this.rank[cid] = 0;

    const nid = this.nodeCount++;
    const base = nid * 4;
    this.nodes[base] = op;
    this.nodes[base + 1] = cl;
    this.nodes[base + 2] = cr;
    this.nodes[base + 3] = cid;

    // Recompute slot in case growNodes rehashed
    slot = this.hashKey(op, cl, cr);
    while (this.hashTable[slot] != 0) {
      slot = (slot + 1) & this.hashMask;
    }
    this.hashTable[slot] = nid + 1;
    return cid;
  }

  /**
   * Restores congruence invariant by canonicalizing all e-nodes and merging congruent classes.
   * Returns total number of merges performed.
   */
  public rebuild(): i32 {
    let totalMerges: i32 = 0;
    while (true) {
      let merges: i32 = 0;
      this.hashTable.fill(0);
      for (let i: i32 = 0; i < this.nodeCount; i++) {
        const base = i * 4;
        const op = this.nodes[base];
        const cl = this.nodes[base + 1] >= 0 ? this.find(this.nodes[base + 1]) : this.nodes[base + 1];
        const cr = this.nodes[base + 2] >= 0 ? this.find(this.nodes[base + 2]) : this.nodes[base + 2];
        const cc = this.find(this.nodes[base + 3]);
        this.nodes[base + 1] = cl;
        this.nodes[base + 2] = cr;
        this.nodes[base + 3] = cc;

        let slot = this.hashKey(op, cl, cr);
        let merged = false;
        while (true) {
          const entry = this.hashTable[slot];
          if (entry == 0) {
            this.hashTable[slot] = i + 1;
            break;
          }
          const oBase = (entry - 1) * 4;
          if (this.nodes[oBase] == op && this.nodes[oBase + 1] == cl && this.nodes[oBase + 2] == cr) {
            const existingClass = this.find(this.nodes[oBase + 3]);
            if (existingClass != cc) {
              this.union(existingClass, cc);
              merges++;
            }
            merged = true;
            break;
          }
          slot = (slot + 1) & this.hashMask;
        }
        if (merged) continue;
      }
      totalMerges += merges;
      if (merges == 0) break;
    }
    return totalMerges;
  }
}

export function egraph_create(initialCap: i32): usize {
  return changetype<usize>(new WasmEGraph(initialCap));
}

export function egraph_addNode(ptr: usize, op: i32, left: i32, right: i32): i32 {
  return changetype<WasmEGraph>(ptr).addNode(op, left, right);
}

export function egraph_find(ptr: usize, id: i32): i32 {
  return changetype<WasmEGraph>(ptr).find(id);
}

export function egraph_union(ptr: usize, a: i32, b: i32): i32 {
  return changetype<WasmEGraph>(ptr).union(a, b);
}

export function egraph_rebuild(ptr: usize): i32 {
  return changetype<WasmEGraph>(ptr).rebuild();
}

export function egraph_classCount(ptr: usize): i32 {
  return changetype<WasmEGraph>(ptr).classCount;
}
