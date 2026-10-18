// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable */
// @ts-nocheck
// True CodeGraph Incremental Database and LSP Bridge
// Pure Arena Implementation (Zero-GC, Integer-based)
import { 
  getNodeType, getNodeFirstChild, getNodeNextSibling, getNodeByteLength, getNodePadding,
  ast_createNode, ast_appendChild, ast_insertSibling, 
  ast_setLiteralString, ast_setLiteralFloat, ast_setLiteralInt,
  ast_getTextSpan, ast_hashSpan, ast_hashByte,
  cloneNode, replaceNode, setFirstChild, setNextSibling,
  ast_createTensor, ast_setTensorShape, ast_getTensorShape,
  ast_setTensorFloat, ast_getTensorFloat,
  ast_setTensorFloat32, ast_getTensorFloat32,
  ast_setTensorFloat16Raw, ast_getTensorFloat16Raw,
  ast_setTensorInt, ast_getTensorInt,
  ast_setTensorUint32, ast_getTensorUint32,
  ast_setTensorInt64, ast_getTensorInt64,
  ast_setTensorUint64, ast_getTensorUint64,
  ast_setTensorInt16, ast_getTensorInt16,
  ast_setTensorUint16, ast_getTensorUint16,
  ast_setTensorInt8, ast_getTensorInt8,
  ast_removeNode, ast_getChildCount, nodeList,
  ast_setTensorBool, ast_getTensorBool,
  ast_bindChildNode, ast_resolveChildNode,
  ast_bindChildHash, ast_resolveChildByHash,
  ast_setNodeFlag, ast_clearNodeFlag, ast_hasNodeFlag,
  getInputBuffer
} from "./arena";
import { UnmanagedUint32Array, ChunkedUint32Array, createChunkedUint32Array, ChunkedInt32Array } from "./array";
import { globalAstRoot, globalEnclosingClassRoot, globalEnclosingClassNode, lsp_findNodeOffset, getEncodingStep, lsp_getNodeLeadingPad, lsp_allocDiagnostic } from "./lsp";
import { getChildByFieldId, getChildrenByFieldId, getAncestors, getDescendants, getPathTokens, getSemanticChildren, debugLog, lintRunGeneration } from "./engine";
import { FieldCursor, AncestorCursor, DescendantCursor, SemanticCursor } from "./engine";
import { FieldId, SyntaxType, NodeFlag, Property } from "./parser";
import { UnmanagedSet64, UnmanagedMap64, createSet64, createMap64, UnmanagedMap64To64, createMap64To64 } from "./hashmap";
import {
  DaeBuilder,
  dae_createBuilder,
  ExprKind,
  EqKind,
  BinOp,
  VarAttrKind,
  EQ_STRIDE,
  EQ_KIND,
  EQ_LHS,
  EQ_RHS,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  FLAG_VAR_FLOW,
  FLAG_EQ_STREAM_CONNECT,
  Variability,
  Causality,
} from "./dae";
import { IntUnionFind } from "./alias";
import { BltEngine, blt_createEngine } from "./blt";
import { GenericScopeStack } from "./scope_stack";
import { ArenaStringPool } from "./string_pool";
import { atomicChunkAlloc } from "./arena";
import {
  initOctagonDBM,
  setOctagonBound,
  closeOctagonDBM,
  assumeOctagonDiff,
  checkOctagonDiff,
  assumeOctagonInterval,
  checkOctagonInterval,
  getOctagonUpperBound,
  getOctagonLowerBound,
  hasNegativeCycle,
  resetOctagonDBM,
  widenOctagonDBM,
  narrowOctagonDBM,
} from "./octagon";
import {
  initSATArena,
  satAddClause,
  solveDPLL,
  satGetModelValue,
  registerLraConstraint,
  checkTheoryLRA,
} from "./sat";

/**
 * WebAssembly bridge API for the Octagon Difference Bound Matrix (DBM) relational abstract domain.
 * Supports $O(N^3)$ Floyd-Warshall strong closure, interval/difference assumptions, widening, and narrowing.
 */
export class OctagonAPI {
  /** Initializes the Octagon DBM for `numVars` program variables ($2N \times 2N$ signed matrix). */
  @inline init(numVars: u32): void {
    initOctagonDBM(numVars);
  }
  /** Sets the raw DBM entry $m_{i,j} \le \text{bound}$ between signed variable indices $i$ and $j$. */
  @inline setBound(i: u32, j: u32, bound: i32): void {
    setOctagonBound(i, j, bound);
  }
  /** Computes the strong closure of the Octagon DBM to propagate transitive difference bounds. */
  @inline close(): void {
    closeOctagonDBM();
  }
  /** Asserts the difference constraint $v_1 - v_2 \le \text{maxDiff}$ into the Octagon domain. */
  @inline assumeDiff(var1: u32, var2: u32, maxDiff: i32): void {
    assumeOctagonDiff(var1, var2, maxDiff);
  }
  /** Checks whether $v_1 - v_2 \le \text{limit}$ is entailed by the closed Octagon DBM. */
  @inline checkDiff(var1: u32, var2: u32, limit: i32): boolean {
    return checkOctagonDiff(var1, var2, limit);
  }
  /** Constrains variable `varIdx` to the interval $[\text{lower}, \text{upper}]$. */
  @inline assumeInterval(varIdx: u32, lower: i32, upper: i32): void {
    assumeOctagonInterval(varIdx, lower, upper);
  }
  /** Checks whether variable `varIdx` is guaranteed to lie within $[\text{lower}, \text{upper}]$. */
  @inline checkInterval(varIdx: u32, lower: i32, upper: i32): boolean {
    return checkOctagonInterval(varIdx, lower, upper);
  }
  /** Returns the current upper bound of `varIdx` from its unary diagonal DBM entry. */
  @inline getUpperBound(varIdx: u32): i32 {
    return getOctagonUpperBound(varIdx);
  }
  /** Returns the current lower bound of `varIdx` from its unary diagonal DBM entry. */
  @inline getLowerBound(varIdx: u32): i32 {
    return getOctagonLowerBound(varIdx);
  }
  /** Returns `true` if a negative cycle exists on the main diagonal (indicating an inconsistent/bottom state). */
  @inline hasNegativeCycle(): boolean {
    return hasNegativeCycle();
  }
  /** Resets all Octagon DBM entries to $+\infty$ (unconstrained top state). */
  @inline reset(): void {
    resetOctagonDBM();
  }
  /** Applies the standard Octagon widening operator against `prevDBM` to accelerate loop fixpoint convergence. */
  @inline widen(prevDBM: u32): void {
    widenOctagonDBM(prevDBM);
  }
  /** Applies the Octagon narrowing operator against `prevDBM` to refine over-approximated loop invariants. */
  @inline narrow(prevDBM: u32): void {
    narrowOctagonDBM(prevDBM);
  }
}

/**
 * WebAssembly bridge API for the in-arena DPLL(T) SAT and Linear Real Arithmetic (LRA) solver.
 */
export class SatAPI {
  /** Initializes the SAT solver arena at `startOffset` in linear memory. */
  @inline init(startOffset: u32): void {
    initSATArena(startOffset);
  }
  /** Appends a disjunction clause of `len` signed literals from `clausePtr`; returns `false` on immediate conflict. */
  @inline addClause(clausePtr: u32, len: u32): boolean {
    return satAddClause(clausePtr, len);
  }
  /** Runs the DPLL boolean satisfiability search, returning `true` if SAT and `false` if UNSAT. */
  @inline solve(): boolean {
    return solveDPLL();
  }
  /** Retrieves the assigned truth value (`0` = false, `1` = true, `2` = unassigned) for variable `varIdx`. */
  @inline getModelValue(varIdx: u32): u8 {
    return satGetModelValue(varIdx);
  }
  /** Registers a Linear Real Arithmetic half-space constraint associated with boolean indicator `satVar`. */
  @inline registerLraConstraint(satVar: u32, coeffsPtr: u32, limit: f64, isUpper: u8): void {
    registerLraConstraint(satVar, coeffsPtr, limit, isUpper);
  }
  /** Checks joint feasibility of active LRA constraints under the current boolean assignment. */
  @inline checkLRA(): u32 {
    return checkTheoryLRA();
  }
}

@external("host", "runHostQuery")
export declare function host_runHostQuery(queryId: u32, arg1: u32, arg2: u32, arg3: u32): u32;

export let currentLintNode: u32 = 0;
export let currentLintNodeStart: u32 = 0;

/**
 * Unmanaged 52-byte Salsa 3.0 incremental query cache node stored in the linear `CodeGraph` arena.
 * Tracks the query key `(queryType, arg1..arg4)`, cached result `value`, 64-bit Merkle hash,
 * and intrusive linked lists of upstream dependencies and downstream subscribers.
 */
@unmanaged
export class QueryNode {
  queryType: u32;             // +0
  arg1: u32;                  // +4
  arg2: u32;                  // +8
  arg3: u32;                  // +12
  arg4: u32;                  // +16
  revision: u32;              // +20
  value: u32;                 // +24
  firstDependencyEdge: u32;   // +28
  firstSubscriberEdge: u32;   // +32
  nextHashBucketPtr: u32;     // +36
  valueMerkleLow: u32;        // +40 (Blueprint 1 + 4)
  valueMerkleHigh: u32;       // +44
  verifiedRevision: u32;      // +48
}

/**
 * Unmanaged 8-byte intrusive singly-linked list node representing a directed dependency or subscriber edge between `QueryNode`s.
 */
@unmanaged
export class EdgeNode {
  targetPtr: u32;             // +0
  nextEdgePtr: u32;           // +4
}

/**
 * Unmanaged 12-byte hash bucket entry mapping a 32-bit FNV-1a FQN hash to its AST declaration node pointer.
 */
@unmanaged
export class FqnSymbol {
  hash: u32;                  // +0
  nodeId: u32;                // +4
  next: u32;                  // +8
}

/**
 * Unmanaged 16-byte ephemeral diagnostic record emitted into the 64KB per-parse diagnostic bump arena.
 */
@unmanaged
export class DiagnosticNode {
  startByte: u32;             // +0
  endByte: u32;               // +4
  argPtr: u32;                // +8
  nextDiagPtr: u32;           // +12
}

export let queryArenaOffset: u32 = 0;
export let queryArenaEnd: u32 = 0;
export let queryHashTableOffset: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let fqnHashTableOffset: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let dirtyFilesBitsetOffset: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
const HASH_TABLE_CAPACITY = 4096;
const FQN_HASH_TABLE_CAPACITY = 4096;

export let graphArenaStart: u32 = 0;
export let graphArenaOffset: u32 = 0;
const GRAPH_ARENA_CAPACITY = 16 * 1024 * 1024; // 16MB

/**
 * Allocates a block of memory from the 16MB CodeGraph linear arena.
 * Ensures 4-byte pointer alignment.
 * @param size Allocation size in bytes.
 */
function allocGraph(size: u32): u32 {
  if (graphArenaStart == 0) {
    graphArenaStart = heap.alloc(GRAPH_ARENA_CAPACITY) as u32;
    graphArenaOffset = graphArenaStart;
  }
  let rem = graphArenaOffset % 4;
  if (rem != 0) graphArenaOffset += (4 - rem);
  if (graphArenaOffset + size > graphArenaStart + GRAPH_ARENA_CAPACITY) {
    return heap.alloc(size) as u32; // Fallback
  }
  let ptr = graphArenaOffset;
  graphArenaOffset += size;
  return ptr;
}

export let diagArenaStart: u32 = 0;
export let diagArenaOffset: u32 = 0;
export let firstDiagnostic: u32 = 0;
export let lastDiagnostic: u32 = 0;
const DIAG_ARENA_CAPACITY = 65536; // 64KB (allows ~4096 simultaneous diagnostics)

/**
 * Initializes the zero-GC memory arenas for the incremental query engine.
 * Allocates hash tables for query keys, FQN symbols, and the dirty file bitset.
 */
export function initQueryArena(): void {
  // Allocate hash table once
  if (changetype<usize>(queryHashTableOffset) == 0) {
    queryHashTableOffset = changetype<UnmanagedUint32Array>(heap.alloc(HASH_TABLE_CAPACITY * 4));
  }
  
  // Allocate FQN hash table once
  if (changetype<usize>(fqnHashTableOffset) == 0) {
    fqnHashTableOffset = changetype<UnmanagedUint32Array>(heap.alloc(FQN_HASH_TABLE_CAPACITY * 4));
  }
  
  // Allocate 128-byte dirty files bitset (for up to 1024 file IDs) once
  if (changetype<usize>(dirtyFilesBitsetOffset) == 0) {
    dirtyFilesBitsetOffset = changetype<UnmanagedUint32Array>(heap.alloc(128));
  }

  // Allocate activeQueryStack (1024 u32 entries) once
  if (changetype<usize>(activeQueryStack) == 0) {
    activeQueryStack = changetype<UnmanagedUint32Array>(heap.alloc(1024 * 4));
  }
  
  resetQueryArena();
}

/**
 * Resets the query engine state by zeroing out the hash tables and dirty file bitsets.
 * Existing query nodes remain in linear memory but become unreachable until re-evaluated.
 */
export function resetQueryArena(): void {
  if (changetype<usize>(queryHashTableOffset) != 0) {
      memory.fill(changetype<usize>(queryHashTableOffset), 0, HASH_TABLE_CAPACITY * 4);
  }
  if (changetype<usize>(fqnHashTableOffset) != 0) {
      memory.fill(changetype<usize>(fqnHashTableOffset), 0, FQN_HASH_TABLE_CAPACITY * 4);
  }
  if (changetype<usize>(dirtyFilesBitsetOffset) != 0) {
      memory.fill(changetype<usize>(dirtyFilesBitsetOffset), 0, 128);
  }
  if (graphArenaStart != 0) {
      graphArenaOffset = graphArenaStart;
  }
  if (t_modelProperties != 0) {
      changetype<UnmanagedMap64To64>(t_modelProperties).init();
  }
  if (changetype<usize>(t_negativeDeps) != 0) {
      t_negativeDeps.init();
  }
  scopedImportHead = 0;
  activeQueryDepth = 0;
}

/**
 * Clears the diagnostic linked list and resets the bump allocator.
 * Must be called before each incremental parse to prevent memory leaks from old squiggles.
 */
export function clearDiagnostics(): void {
  firstDiagnostic = 0;
  lastDiagnostic = 0;
  if (diagArenaStart != 0) {
    diagArenaOffset = diagArenaStart;
  }
}

/**
 * Clears the 1024-bit dirty file bitset.
 * Called at the start of a new parse phase before any queries mark themselves as dirty.
 */
export function clearDirtyFilesBitset(): void {
  if (changetype<usize>(dirtyFilesBitsetOffset) == 0) return;
  for (let i = 0; i < 32; i++) {
    dirtyFilesBitsetOffset[i] = 0;
  }
}

/**
 * Allocates a new 16-byte diagnostic node from the dedicated 64KB bump arena.
 * Diagnostics form a linked list and are strictly ephemeral per-parse.
 * @param startByte Absolute start byte offset.
 * @param endByte Absolute end byte offset.
 * @param argPtr Pointer to supplemental argument string/data.
 * @param nextPtr Pointer to the next diagnostic in the chain.
 * @returns The pointer to the new diagnostic node.
 */
export function allocDiagnostic(startByte: u32, endByte: u32, argPtr: u32, nextPtr: u32): u32 {
  if (diagArenaStart == 0) {
    diagArenaStart = heap.alloc(DIAG_ARENA_CAPACITY) as u32;
    diagArenaOffset = diagArenaStart;
  }
  // Drop diagnostic if we overflow the 64KB limit
  if (diagArenaOffset + 16 > diagArenaStart + DIAG_ARENA_CAPACITY) {
    return 0; 
  }
  
  let ptr = diagArenaOffset;
  diagArenaOffset += 16;
  
  let node = changetype<DiagnosticNode>(ptr);
  node.startByte = startByte;
  node.endByte = endByte;
  node.argPtr = argPtr;
  node.nextDiagPtr = nextPtr;
  
  // Link globally
  if (firstDiagnostic == 0) {
    firstDiagnostic = ptr;
  } else {
    changetype<DiagnosticNode>(lastDiagnostic).nextDiagPtr = ptr;
  }
  lastDiagnostic = ptr;
  
  return ptr;
}

/**
 * Allocates an 8-byte edge node to link query dependencies.
 * @param targetPtr Pointer to the target query node.
 * @param nextPtr Pointer to the next edge in the linked list.
 */
export function allocEdge(targetPtr: u32, nextPtr: u32): u32 {
  let ptr = allocGraph(8);
  let edge = changetype<EdgeNode>(ptr);
  edge.targetPtr = targetPtr;
  edge.nextEdgePtr = nextPtr;
  return ptr;
}

/**
 * Exports a Fully Qualified Name (FQN) to the global symbol table.
 * Uses linear open-addressing hash chains to store symbols incrementally.
 * @param fqnHash The 32-bit FNV-1a hash of the FQN.
 * @param nodeId The target node pointer in the AST.
 */
export function exportSymbol(fqnHash: u32, nodeId: u32): void {
  let idx = fqnHash & (FQN_HASH_TABLE_CAPACITY - 1);
  let ptr = allocGraph(12);
  let sym = changetype<FqnSymbol>(ptr);
  sym.hash = fqnHash;
  sym.nodeId = nodeId;
  sym.next = fqnHashTableOffset[idx];
  fqnHashTableOffset[idx] = ptr;
}

/**
 * Resolves an FQN hash back to its AST node pointer.
 * @param fqnHash The hash to look up.
 * @returns The target node pointer, or 0 if unresolved.
 */
export function resolveFqnSymbol(fqnHash: u32): u32 {
  let idx = fqnHash & (FQN_HASH_TABLE_CAPACITY - 1);
  let ptr = fqnHashTableOffset[idx];
  while (ptr != 0) {
     let sym = changetype<FqnSymbol>(ptr);
     if (sym.hash == fqnHash) return sym.nodeId;
     ptr = sym.next;
  }
  return 0;
}

/**
 * Unmanaged 16-byte record tracking a lexical import clause and its visibility within an AST scope.
 */
@unmanaged
export class ScopedImport {
  scopeId: u32;
  moduleHash: u32;
  next: u32;
  visibility: u8;
}

export let scopedImportHead: u32 = 0;

/**
 * Registers a scoped module import during query evaluation.
 * @param scopeId The node pointer of the enclosing scope.
 * @param moduleHash The hash of the target module being imported.
 * @param visibility Optional visibility modifier (0 = public, 1 = private).
 */
export function registerScopedImport(scopeId: u32, moduleHash: u32, visibility: u8 = 0): void {
  let ptr = allocGraph(16);
  let imp = changetype<ScopedImport>(ptr);
  imp.scopeId = scopeId;
  imp.moduleHash = moduleHash;
  imp.next = scopedImportHead;
  imp.visibility = visibility;
  scopedImportHead = ptr;
}

/**
 * Combines a query type and three arbitrary 32-bit arguments into a single 32-bit hash.
 * Utilizes the FNV-1a algorithm for rapid, collision-resistant distribution.
 */
function combineQueryKey(queryType: u32, arg1: u32, arg2: u32, arg3: u32, arg4: u32 = 0): u32 {
   let h: u32 = 0x811c9dc5;
   h ^= queryType;
   h = (h * 0x01000193) >>> 0;
   h ^= arg1;
   h = (h * 0x01000193) >>> 0;
   h ^= arg2;
   h = (h * 0x01000193) >>> 0;
   h ^= arg3;
   h = (h * 0x01000193) >>> 0;
   h ^= arg4;
   h = (h * 0x01000193) >>> 0;
   return h & (HASH_TABLE_CAPACITY - 1);
}

/**
 * Looks up an existing query node in the incremental database.
 * If found, it indicates that the query has been evaluated previously.
 * @returns The query node pointer, or 0 if not found.
 */
export function getQueryNode2(queryType: u32, arg1: u32, arg2: u32, arg3: u32, arg4: u32 = 0): u32 {
   let idx = combineQueryKey(queryType, arg1, arg2, arg3, arg4);
   let ptr = queryHashTableOffset[idx];
   while (ptr != 0) {
      let node = changetype<QueryNode>(ptr);
      if (node.queryType == queryType && 
          node.arg1 == arg1 && 
          node.arg2 == arg2 && 
          node.arg3 == arg3 &&
          node.arg4 == arg4) return ptr;
      ptr = node.nextHashBucketPtr;
   }
   return 0;
}

/**
 * Allocates a new 56-byte query node from linear memory and inserts it into the
 * open-addressing hash table. This node tracks execution state, cached value,
 * 64-bit Merkle result hashes, and dependency edges for Salsa 3.0.
 */
export function allocQueryNode2(queryType: u32, arg1: u32, arg2: u32, arg3: u32, arg4: u32): u32 {
  let ptr = allocGraph(56);
  let node = changetype<QueryNode>(ptr);
  node.queryType = queryType;
  node.arg1 = arg1;
  node.arg2 = arg2;
  node.arg3 = arg3;
  node.arg4 = arg4;
  node.revision = 0;
  node.value = 0;
  node.firstDependencyEdge = 0;
  node.firstSubscriberEdge = 0;
  node.valueMerkleLow = 0;
  node.valueMerkleHigh = 0;
  node.verifiedRevision = 0;
  
  let idx = combineQueryKey(queryType, arg1, arg2, arg3, arg4);
  node.nextHashBucketPtr = queryHashTableOffset[idx];
  queryHashTableOffset[idx] = ptr;
  
  return ptr;
}

export let globalRevision: u32 = 1;

export let t_negativeDeps: UnmanagedMap64 = changetype<UnmanagedMap64>(0);

/**
 * Lazily initializes the global 64-bit map tracking negative symbol dependencies for Salsa invalidation.
 */
export function ensureNegativeDeps(): void {
  if (changetype<usize>(t_negativeDeps) == 0) {
    t_negativeDeps = changetype<UnmanagedMap64>(createMap64());
  }
}

/**
 * Registers a negative dependency: records that a query failed because `nameHash` was missing.
 * @param queryPtr The query node pointer that depended on nameHash.
 * @param nameHash The missing symbol's name hash.
 */
export function salsa_registerNegativeDependency(queryPtr: u32, nameHash: u32): void {
  if (queryPtr == 0 || nameHash == 0) return;
  ensureNegativeDeps();
  let headEdge = t_negativeDeps.get(nameHash as u64) as u32;
  let newEdge = allocEdge(queryPtr, headEdge);
  t_negativeDeps.set(nameHash as u64, newEdge);
}

/**
 * Automatically invalidates all queries waiting for `nameHash` when that symbol is registered.
 * @param nameHash The newly introduced symbol name hash.
 * @returns Total queries invalidated.
 */
export function salsa_invalidateNegativeDependencies(nameHash: u32): u32 {
  if (nameHash == 0 || changetype<usize>(t_negativeDeps) == 0) return 0;
  let headEdge = t_negativeDeps.get(nameHash as u64) as u32;
  if (headEdge == 0) return 0;

  let count: u32 = 0;
  let curr = headEdge;
  while (curr != 0) {
    let edge = changetype<EdgeNode>(curr);
    if (edge.targetPtr != 0) {
      invalidateNode(edge.targetPtr);
      count++;
    }
    curr = edge.nextEdgePtr;
  }
  // Clear the negative dependency bucket
  t_negativeDeps.set(nameHash as u64, 0);
  return count;
}

/**
 * Merkle-Based O(1) Value Backdating (Blueprint 4).
 * Checks if the newly computed query result matches the previous 64-bit Merkle hash.
 * If matched, backdates the query revision without triggering downstream subscriber invalidation!
 * @param nodePtr The query node pointer.
 * @param newMerkleLow Lower 32-bits of result Merkle hash.
 * @param newMerkleHigh Upper 32-bits of result Merkle hash.
 * @returns True if value was identical (backdated), False if value changed.
 */
export function salsa_backdateQuery(nodePtr: u32, newMerkleLow: u32, newMerkleHigh: u32): boolean {
  if (nodePtr == 0) return false;
  let node = changetype<QueryNode>(nodePtr);

  if ((newMerkleLow != 0 || newMerkleHigh != 0) &&
      node.valueMerkleLow == newMerkleLow &&
      node.valueMerkleHigh == newMerkleHigh) {
    // Merkle match: value is semantically unchanged!
    node.revision = globalRevision;
    node.verifiedRevision = globalRevision;
    return true; // Successfully backdated!
  }

  // Value changed: update Merkle hash
  node.valueMerkleLow = newMerkleLow;
  node.valueMerkleHigh = newMerkleHigh;
  node.revision = globalRevision;
  node.verifiedRevision = globalRevision;
  return false;
}

/**
 * Invalidates a query node by resetting its revision to 0 (dirty state).
 * This will recursively cascade to all subscriber edges, dirtying any queries
 * that depended on this value. If it's a PARSE query, it sets the dirty bitset.
 * @param nodePtr The query node pointer to invalidate.
 */
export function invalidateNode(nodePtr: u32): void {
  if (nodePtr == 0) return;
  
  let node = changetype<QueryNode>(nodePtr);
  if (node.revision == 0) return; // 0 means already dirty/invalidated
  
  node.revision = 0; // Mark as dirty
  
  // A PARSE query (queryType == 0) affects the dirty file bitset
  if (node.queryType == 0 && changetype<usize>(dirtyFilesBitsetOffset) != 0) {
      let fileId = node.arg1;
      if (fileId < 1024) {
          let wordIdx = fileId >> 5;
          let bitIdx = fileId & 31;
          let current = dirtyFilesBitsetOffset[wordIdx];
          dirtyFilesBitsetOffset[wordIdx] = current | (1 << bitIdx);
      }
  }

  let edgePtr = node.firstSubscriberEdge;
  while (edgePtr != 0) {
     let edge = changetype<EdgeNode>(edgePtr);
     invalidateNode(edge.targetPtr);
     edgePtr = edge.nextEdgePtr;
  }
}

/**
 * Increments the global database revision counter.
 */
export function incrementGlobalRevision(): void {
  globalRevision++;
}

// 1024 stack depth max
export let activeQueryStack: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let activeQueryDepth: i32 = 0;

/**
 * Ensures a directed dependency edge is established from parent to target.
 * Walks the edge list to prevent duplicate edge allocations.
 * @param parentPtr Parent query node pointer.
 * @param targetPtr Target dependency query node pointer.
 */
export function addDependencyEdgeIfMissing(parentPtr: u32, targetPtr: u32): void {
    let parent = changetype<QueryNode>(parentPtr);
    let curr = parent.firstDependencyEdge;
    while (curr != 0) {
        let edge = changetype<EdgeNode>(curr);
        if (edge.targetPtr == targetPtr) return;
        curr = edge.nextEdgePtr;
    }
    parent.firstDependencyEdge = allocEdge(targetPtr, parent.firstDependencyEdge);
}

/**
 * Ensures a subscriber edge is established from child to parent.
 * Walks the edge list to prevent duplicate edge allocations.
 * @param childPtr Child query node pointer.
 * @param parentPtr Subscriber parent query node pointer.
 */
export function addSubscriberEdgeIfMissing(childPtr: u32, parentPtr: u32): void {
    let child = changetype<QueryNode>(childPtr);
    let curr = child.firstSubscriberEdge;
    while (curr != 0) {
        let edge = changetype<EdgeNode>(curr);
        if (edge.targetPtr == parentPtr) return;
        curr = edge.nextEdgePtr;
    }
    child.firstSubscriberEdge = allocEdge(parentPtr, child.firstSubscriberEdge);
}

/**
 * The core execution engine for incremental graph queries.
 * Checks if a query is already cached and valid for the current global revision.
 * If not, it executes the query via the generated `__GRAPH_SWITCH_CODE__` logic,
 * establishes dependency edges automatically via the `activeQueryStack`, and caches the result.
 */
export function runQuery(queryType: u32, arg1: u32, arg2: u32 = 0, arg3: u32 = 0, arg4: u32 = 0): u32 {
   if (activeQueryDepth >= 256) return 0; // Stack depth guard to prevent WASM stack overflow
   if (changetype<usize>(activeQueryStack) == 0) {
      activeQueryStack = changetype<UnmanagedUint32Array>(heap.alloc(1024 * 4));
   }

   let nodePtr = getQueryNode2(queryType, arg1, arg2, arg3, arg4);
   if (nodePtr == 0) {
      nodePtr = allocQueryNode2(queryType, arg1, arg2, arg3, arg4);
   } else {
      let rev = changetype<QueryNode>(nodePtr).revision;
      if (rev > 0 && rev == globalRevision) return changetype<QueryNode>(nodePtr).value;
   }
   
   if (activeQueryDepth > 0) {
      let parentPtr = activeQueryStack[activeQueryDepth - 1];
      if (parentPtr != 0) {
        addDependencyEdgeIfMissing(parentPtr, nodePtr);
        addSubscriberEdgeIfMissing(nodePtr, parentPtr);
      }
   }
   
   // Push nodePtr directly onto stack
   activeQueryStack[activeQueryDepth++] = nodePtr;
   let result: u32 = 0;
   
   if (queryType == 0) { // PARSE
      // For parse, arg1 is fileId. 
      // result = parse();
   }
   __GRAPH_SWITCH_CODE__
   
   activeQueryDepth--;
   let qnode = changetype<QueryNode>(nodePtr);
   qnode.value = result;
   qnode.revision = globalRevision;
   
   return result;
}

// User-provided custom semantic queries:
__CUSTOM_QUERIES__
__OUTLINE_QUERY_WRAPPER__

/**
 * Low-level WASM bridge API for n-dimensional tensor creation and manipulation.
 */
export class TensorAPI {
  /** Allocates a new tensor handle in the AST arena with the given element `type`, `rank`, and flat `elementCount`. */
  @inline create(type: u32, rank: u32, elementCount: u32): u32 { return ast_createTensor(type, rank, elementCount); }
  /** Sets the extent of dimension `dimIndex` on tensor `handle`. */
  @inline setShape(handle: u32, dimIndex: u32, size: u32): void { ast_setTensorShape(handle, dimIndex, size); }
  /** Returns the extent of dimension `dimIndex` on tensor `handle`. */
  @inline getShape(handle: u32, dimIndex: u32): u32 { return ast_getTensorShape(handle, dimIndex); }

  /** Stores a 64-bit float (`f64`) at `flatIndex` in tensor `handle`. */
  @inline setFloat(handle: u32, flatIndex: u32, val: f64): void { ast_setTensorFloat(handle, flatIndex, val); }
  /** Loads a 64-bit float (`f64`) from `flatIndex` in tensor `handle`. */
  @inline getFloat(handle: u32, flatIndex: u32): f64 { return ast_getTensorFloat(handle, flatIndex); }
  /** Stores a 32-bit float (`f32`) at `flatIndex` in tensor `handle`. */
  @inline setFloat32(handle: u32, flatIndex: u32, val: f32): void { ast_setTensorFloat32(handle, flatIndex, val); }
  /** Loads a 32-bit float (`f32`) from `flatIndex` in tensor `handle`. */
  @inline getFloat32(handle: u32, flatIndex: u32): f32 { return ast_getTensorFloat32(handle, flatIndex); }
  /** Stores a raw 16-bit half-precision float bit pattern (`u16`) at `flatIndex`. */
  @inline setFloat16Raw(handle: u32, flatIndex: u32, val: u16): void { ast_setTensorFloat16Raw(handle, flatIndex, val); }
  /** Loads a raw 16-bit half-precision float bit pattern (`u16`) from `flatIndex`. */
  @inline getFloat16Raw(handle: u32, flatIndex: u32): u16 { return ast_getTensorFloat16Raw(handle, flatIndex); }
  
  /** Stores a 32-bit signed integer (`i32`) at `flatIndex` in tensor `handle`. */
  @inline setInt(handle: u32, flatIndex: u32, val: i32): void { ast_setTensorInt(handle, flatIndex, val); }
  /** Loads a 32-bit signed integer (`i32`) from `flatIndex` in tensor `handle`. */
  @inline getInt(handle: u32, flatIndex: u32): i32 { return ast_getTensorInt(handle, flatIndex); }
  /** Stores a 32-bit unsigned integer (`u32`) at `flatIndex` in tensor `handle`. */
  @inline setUint32(handle: u32, flatIndex: u32, val: u32): void { ast_setTensorUint32(handle, flatIndex, val); }
  /** Loads a 32-bit unsigned integer (`u32`) from `flatIndex` in tensor `handle`. */
  @inline getUint32(handle: u32, flatIndex: u32): u32 { return ast_getTensorUint32(handle, flatIndex); }
  /** Stores a 64-bit signed integer (`i64`) at `flatIndex` in tensor `handle`. */
  @inline setInt64(handle: u32, flatIndex: u32, val: i64): void { ast_setTensorInt64(handle, flatIndex, val); }
  /** Loads a 64-bit signed integer (`i64`) from `flatIndex` in tensor `handle`. */
  @inline getInt64(handle: u32, flatIndex: u32): i64 { return ast_getTensorInt64(handle, flatIndex); }
  /** Stores a 64-bit unsigned integer (`u64`) at `flatIndex` in tensor `handle`. */
  @inline setUint64(handle: u32, flatIndex: u32, val: u64): void { ast_setTensorUint64(handle, flatIndex, val); }
  /** Loads a 64-bit unsigned integer (`u64`) from `flatIndex` in tensor `handle`. */
  @inline getUint64(handle: u32, flatIndex: u32): u64 { return ast_getTensorUint64(handle, flatIndex); }
  /** Stores a 16-bit signed integer (`i16`) at `flatIndex` in tensor `handle`. */
  @inline setInt16(handle: u32, flatIndex: u32, val: i16): void { ast_setTensorInt16(handle, flatIndex, val); }
  /** Loads a 16-bit signed integer (`i16`) from `flatIndex` in tensor `handle`. */
  @inline getInt16(handle: u32, flatIndex: u32): i16 { return ast_getTensorInt16(handle, flatIndex); }
  /** Stores a 16-bit unsigned integer (`u16`) at `flatIndex` in tensor `handle`. */
  @inline setUint16(handle: u32, flatIndex: u32, val: u16): void { ast_setTensorUint16(handle, flatIndex, val); }
  /** Loads a 16-bit unsigned integer (`u16`) from `flatIndex` in tensor `handle`. */
  @inline getUint16(handle: u32, flatIndex: u32): u16 { return ast_getTensorUint16(handle, flatIndex); }
  /** Stores an 8-bit signed integer (`i8`) at `flatIndex` in tensor `handle`. */
  @inline setInt8(handle: u32, flatIndex: u32, val: i8): void { ast_setTensorInt8(handle, flatIndex, val); }
  /** Loads an 8-bit signed integer (`i8`) from `flatIndex` in tensor `handle`. */
  @inline getInt8(handle: u32, flatIndex: u32): i8 { return ast_getTensorInt8(handle, flatIndex); }
  /** Stores an 8-bit unsigned integer (`u8`) at `flatIndex` in tensor `handle`. */
  @inline setUint8(handle: u32, flatIndex: u32, val: u8): void { ast_setTensorUint8(handle, flatIndex, val); }
  /** Loads an 8-bit unsigned integer (`u8`) from `flatIndex` in tensor `handle`. */
  @inline getUint8(handle: u32, flatIndex: u32): u8 { return ast_getTensorUint8(handle, flatIndex); }
  
  /** Stores a boolean value at `flatIndex` in tensor `handle`. */
  @inline setBool(handle: u32, flatIndex: u32, val: boolean): void { ast_setTensorBool(handle, flatIndex, val); }
  /** Loads a boolean value from `flatIndex` in tensor `handle`. */
  @inline getBool(handle: u32, flatIndex: u32): boolean { return ast_getTensorBool(handle, flatIndex); }
}

let t_modelProperties: usize = 0;

/**
 * Model API for AST node creation, property attachment, and tree manipulation.
 */
export class ModelAPI {
  /** Allocates a new AST node of syntax `type`. */
  @inline create(type: u16): u32 { return ast_createNode(type); }
  /** Clones `nodeId` shallowly or deeply in the AST arena. */
  @inline clone(nodeId: u32, deep: boolean): u32 { return cloneNode(nodeId, deep); }
  /** Evaluates the memoized semantic attribute query `attrName` on `nodeId`. */
  @inline compute(nodeId: u32, attrName: u32): u32 { return runQuery(attrName, nodeId); }

  /** Retrieves a typed out-of-band property `propId` attached to `nodeId`. */
  @inline getProperty<T>(nodeId: u32, propId: u32): T {
    if (t_modelProperties == 0) return 0 as T;
    let key: u64 = (nodeId as u64) | ((propId as u64) << 32);
    let map = changetype<UnmanagedMap64To64>(t_modelProperties);
    let val = map.get(key);
    if (isFloat<T>()) {
      if (sizeof<T>() == 8) return reinterpret<f64>(val) as T;
      return reinterpret<f32>(val as u32) as T;
    }
    return val as T;
  }
  /** Attaches a typed out-of-band property `propId` with `value` to `nodeId`. */
  @inline setProperty<T>(nodeId: u32, propId: u32, value: T): void {
    if (t_modelProperties == 0) {
      t_modelProperties = changetype<usize>(createMap64To64());
    }
    let map = changetype<UnmanagedMap64To64>(t_modelProperties);
    let key: u64 = (nodeId as u32 as u64) | ((propId as u64) << 32);
    if (isFloat<T>()) {
      if (sizeof<T>() == 8) {
        map.set(key, reinterpret<u64>(value as f64));
      } else {
        map.set(key, reinterpret<u32>(value as f32) as u64);
      }
    } else {
      map.set(key, value as u64);
    }
  }
  
  /** Binds `childId` under `parentId` using the text span of `nameNodeId`. */
  @inline bind(parentId: u32, nameNodeId: u32, childId: u32): void { ast_bindChildNode(parentId, nameNodeId, childId); }
  /** Resolves a named child under `parentId` matching the text span of `nameNodeId`. */
  @inline resolve(parentId: u32, nameNodeId: u32): u32 { return ast_resolveChildNode(parentId, nameNodeId); }
  /** Binds `childId` under `parentId` using a precomputed 32-bit FNV-1a `hash`. */
  @inline bindHash(parentId: u32, hash: u32, childId: u32): void { ast_bindChildHash(parentId, hash, childId); }
  /** Resolves a child node under `parentId` by its 32-bit FNV-1a `hash`. */
  @inline resolveHash(parentId: u32, hash: u32): u32 { return ast_resolveChildByHash(parentId, hash); }

  /** Sets bitflags `flag` on `nodeId`. */
  @inline setFlag(nodeId: u32, flag: u32): void { ast_setNodeFlag(nodeId, flag); }
  /** Clears bitflags `flag` on `nodeId`. */
  @inline clearFlag(nodeId: u32, flag: u32): void { ast_clearNodeFlag(nodeId, flag); }
  /** Checks whether `flag` is set on `nodeId`. */
  @inline hasFlag(nodeId: u32, flag: u32): boolean { return ast_hasNodeFlag(nodeId, flag); }

  /** Returns the 16-bit syntax type ID of `nodeId`. */
  @inline getType(nodeId: u32): u16 { return getNodeType(nodeId); }
  /** Returns the first child pointer of `nodeId`, or `0` if leaf. */
  @inline getFirstChild(nodeId: u32): u32 { return getNodeFirstChild(nodeId); }
  /** Returns the next sibling pointer of `nodeId`, or `0` if last child. */
  @inline getNextSibling(nodeId: u32): u32 { return getNodeNextSibling(nodeId); }
  /** Returns the total number of direct children of `nodeId`. */
  @inline getChildCount(nodeId: u32): u32 { return ast_getChildCount(nodeId); }

  /** Appends `childId` to the end of `parentId`'s child list. */
  @inline appendChild(parentId: u32, childId: u32): void { ast_appendChild(parentId, childId); }
  /** Inserts `siblingId` immediately after `targetId`. */
  @inline insertSibling(targetId: u32, siblingId: u32): void { ast_insertSibling(targetId, siblingId); }
  /** Overwrites the first child pointer of `parentId`. */
  @inline setFirstChild(parentId: u32, childId: u32): void { setFirstChild(parentId, childId); }
  /** Overwrites the next sibling pointer of `nodeId`. */
  @inline setNextSibling(nodeId: u32, siblingId: u32): void { setNextSibling(nodeId, siblingId); }
  /** Replaces `oldChildId` with `newChildId` under `parentId`. */
  @inline replaceChild(parentId: u32, oldChildId: u32, newChildId: u32): void { replaceNode(parentId, oldChildId, newChildId); }
  /** Unlinks `childId` from `parentId`'s child list. */
  @inline removeChild(parentId: u32, childId: u32): void { ast_removeNode(parentId, childId); }
  /** Returns a cursor iterating over the semantic (named) children of `nodeId`. */
  @inline getSemanticChildren(nodeId: u32): SemanticCursor { return getSemanticChildren(nodeId); }
}

/**
 * Hashing utility class for string spans and single byte hashing.
 */
export class HashAPI {
  /** Returns the FNV-1a 32-bit offset basis (`2166136261`). */
  @inline init(): u32 { return 2166136261; }
  /** Mixes a packed 64-bit `(offset, length)` text `span` into `currentHash`. */
  @inline span(currentHash: u32, span: u64): u32 { return ast_hashSpan(span, currentHash); }
  /** Mixes a single `byte` into `currentHash` using FNV-1a. */
  @inline byte(currentHash: u32, byte: u8): u32 { return ast_hashByte(byte, currentHash); }
  /** Computes a collision-resistant 64-bit composite hash from a packed text `span`. */
  @inline span64(span: u64): u64 {
      if (span == 0) return 0;
      let h1 = ast_hashSpan(span, 2166136261) as u64;
      let h2 = ast_hashSpan(span, 5381) as u64;
      return (h1 << 32) | h2;
  }
}

let globalClassHasUnitsRoot: u32 = 0;
let globalClassHasUnitsResult: boolean = false;
let globalClassHasInnerRoot: u32 = 0;
let globalClassHasInnerResult: boolean = false;

let globalClassByNameMap: UnmanagedMap64 = changetype<UnmanagedMap64>(0);
let globalClassByNameGen: u32 = 0xFFFFFFFF;

/**
 * Returns the per-lint-generation `UnmanagedMap64` cache for class-by-name lookups, clearing it when the generation advances.
 */
function classByNameMap(): UnmanagedMap64 {
  if (changetype<usize>(globalClassByNameMap) == 0) {
    globalClassByNameMap = changetype<UnmanagedMap64>(UnmanagedMap64.create(256));
    globalClassByNameGen = lintRunGeneration;
  } else if (globalClassByNameGen != lintRunGeneration) {
    globalClassByNameMap.clear();
    globalClassByNameGen = lintRunGeneration;
  }
  return globalClassByNameMap;
}

/**
 * Computes a 64-bit cache key combining a text `span` hash and a lookup `kind` discriminator.
 */
@inline function classNameKey(span: u64, kind: u32): u64 {
  let h1 = ast_hashSpan(span, 2166136261) as u64;
  let h2 = ast_hashSpan(span, 5381) as u64;
  return ((h1 << 32) | h2) ^ ((kind as u64) * 0x9E3779B97F4A7C15);
}

/**
 * AST navigation and node span query API.
 */
export class AstAPI {
  /**
   * Per-lint-run memo keyed by (kind, text of span). Returns -1 on miss, else the stored value.
   * kind 0 = findClassByName (class node), kind 1 = resolveBasePrimitiveType (type id).
   */
  getCachedByName(kind: u32, nameSpan: u64): i32 {
    let m = classByNameMap();
    let key = classNameKey(nameSpan, kind);
    return m.has(key) ? (m.get(key) as i32) : -1;
  }
  /** Stores a per-lint-run memoized result `value` keyed by `(kind, nameSpan)`. */
  setCachedByName(kind: u32, nameSpan: u64, value: u32): void {
    classByNameMap().set(classNameKey(nameSpan, kind), value);
  }
  /** Returns cached boolean (`1` = true, `0` = false, `-1` = miss) indicating whether `classNode` contains unit declarations. */
  @inline getCachedHasUnits(classNode: u32): i32 {
    return classNode == globalClassHasUnitsRoot ? (globalClassHasUnitsResult ? 1 : 0) : -1;
  }
  /** Caches whether `classNode` contains unit declarations. */
  @inline setCachedHasUnits(classNode: u32, hasUnits: boolean): void {
    globalClassHasUnitsRoot = classNode;
    globalClassHasUnitsResult = hasUnits;
  }
  /** Returns cached boolean (`1` = true, `0` = false, `-1` = miss) indicating whether `classNode` contains inner classes. */
  @inline getCachedHasInnerClass(classNode: u32): i32 {
    return classNode == globalClassHasInnerRoot ? (globalClassHasInnerResult ? 1 : 0) : -1;
  }
  /** Caches whether `classNode` contains inner classes. */
  @inline setCachedHasInnerClass(classNode: u32, hasInner: boolean): void {
    globalClassHasInnerRoot = classNode;
    globalClassHasInnerResult = hasInner;
  }

  /** Returns `true` if the leading non-whitespace source text of `nodeId` starts with `prefix`. */
  @inline startsWith(nodeId: u32, prefix: string): boolean {
      if (nodeId == 0 || prefix.length == 0) return false;
      let offset = lsp_findNodeOffset(globalAstRoot, nodeId, 0);
      if (offset < 0) return false;
      let actualOffset = offset as u32;
      let endOffset = actualOffset + getNodeByteLength(nodeId);
      let buffer = getInputBuffer();
      while (actualOffset < endOffset) {
          let ch: u32 = load<u16>(buffer + ((actualOffset as usize) << 1)) as u32;
          if (ch == 32 || ch == 9 || ch == 10 || ch == 13) {
              actualOffset += 1;
          } else {
              break;
          }
      }
      let needed = prefix.length as u32;
      if (actualOffset + needed > endOffset) return false;
      for (let i = 0; i < prefix.length; i++) {
          let code = prefix.charCodeAt(i);
          if (load<u16>(buffer + (((actualOffset + (i as u32)) as usize) << 1)) != (code as u16)) return false;
      }
      return true;
  }

  /** Returns `true` if the source text of `nodeId` exactly equals `text`. */
  @inline textEquals(nodeId: u32, text: string): boolean {
      if (nodeId == 0) return false;
      let nodeLen = getNodeByteLength(nodeId);
      let expectedLen = text.length as u32;
      if (nodeLen != expectedLen) return false;
      let offset = lsp_findNodeOffset(globalAstRoot, nodeId, 0);
      if (offset < 0) return false;
      let actualOffset = offset as u32;
      let buffer = getInputBuffer();
      for (let i = 0; i < text.length; i++) {
          let code = text.charCodeAt(i);
          if (load<u16>(buffer + (((actualOffset + (i as u32)) as usize) << 1)) != (code as u16)) return false;
      }
      return true;
  }

  /** Returns `true` if `nodeA` and `nodeB` have identical UTF-16 source text spans. */
  @inline textEqualsNode(nodeA: u32, nodeB: u32): boolean {
      if (nodeA == nodeB) return true;
      let lenA = getNodeByteLength(nodeA);
      let lenB = getNodeByteLength(nodeB);
      if (lenA != lenB) return false;
      let offsetA = lsp_findNodeOffset(globalAstRoot, nodeA, 0);
      let offsetB = lsp_findNodeOffset(globalAstRoot, nodeB, 0);
      if (offsetA < 0 || offsetB < 0) return false;
      let buffer = getInputBuffer();
      let uOffA = offsetA as u32;
      let uOffB = offsetB as u32;
      for (let i: u32 = 0; i < lenA; i++) {
          if (load<u16>(buffer + (((uOffA + i) as usize) << 1)) != load<u16>(buffer + (((uOffB + i) as usize) << 1))) {
              return false;
          }
      }
      return true;
  }

  /** Returns the first child of `nodeId` assigned to grammar `fieldId`, or `0` if absent. */
  @inline getChildByFieldId(nodeId: u32, fieldId: i32): u32 { return getChildByFieldId(nodeId, fieldId); }
  /** Returns a cursor over all children of `nodeId` assigned to grammar `fieldId`. */
  @inline getChildrenByFieldId(nodeId: u32, fieldId: i32): FieldCursor { return getChildrenByFieldId(nodeId, fieldId); }
  /** Returns a cursor walking upward through the ancestor chain of `nodeId`, optionally filtered by `filterType`. */
  @inline getAncestors(nodeId: u32, filterType: u16 = 0xFFFF, rootNode: u32 = 0): AncestorCursor { return getAncestors(nodeId, filterType, rootNode == 0 ? globalAstRoot : rootNode); }
  /** Returns a depth-first cursor over all descendants of `nodeId`, optionally filtered by `filterType`. */
  @inline getDescendants(nodeId: u32, filterType: u16 = 0xFFFF): DescendantCursor { return getDescendants(nodeId, filterType); }
  /** Returns a cursor over identifier tokens comprising a qualified path node. */
  @inline getPathTokens(nodeId: u32): DescendantCursor { return getPathTokens(nodeId); }

  /** Returns the 16-bit syntax type ID of `nodeId`. */
  @inline getType(nodeId: u32): u16 { return getNodeType(nodeId); }
  /** Returns the first child pointer of `nodeId`, or `0` if leaf. */
  @inline getFirstChild(nodeId: u32): u32 { return getNodeFirstChild(nodeId); }

  /** Parses the decimal integer literal text of `nodeId` directly from the UTF-16 input buffer. */
  @inline parseInteger(nodeId: u32): i32 {
      if (nodeId == 0) return 0;
      let offset = lsp_findNodeOffset(globalAstRoot, nodeId, 0);
      if (offset < 0) return 0;
      let offsetU: u32 = offset as u32;
      let actualOffset: u32 = offsetU;
      let buffer = getInputBuffer();
      let len = getNodeByteLength(nodeId);
      let endOffset: u32 = offsetU + len;

      while (actualOffset < endOffset) {
          let ch = load<u16>(buffer + ((actualOffset as usize) << 1));
          if (ch >= 48 && ch <= 57) {
              break;
          }
          actualOffset += 1;
      }
      if (actualOffset >= endOffset) return 0;

      let result: i32 = 0;
      while (actualOffset < endOffset) {
          let ch = load<u16>(buffer + ((actualOffset as usize) << 1));
          if (ch >= 48 && ch <= 57) {
              result = result * 10 + (ch - 48);
              actualOffset += 1;
          } else {
              break;
          }
      }
      return result;
  }

  /** Parses a floating-point literal from `nodeId`'s UTF-16 input span. */
  @inline parseReal(nodeId: u32): f64 {
      if (nodeId == 0) return 0.0;
      let offset = lsp_findNodeOffset(globalAstRoot, nodeId, 0);
      if (offset < 0) return 0.0;
      let offsetU: u32 = offset as u32;
      let actualOffset: u32 = offsetU;
      let buffer = getInputBuffer();
      let len = getNodeByteLength(nodeId);
      let endOffset: u32 = offsetU + len;

      while (actualOffset < endOffset) {
          let ch = load<u16>(buffer + ((actualOffset as usize) << 1));
          if ((ch >= 48 && ch <= 57) || ch == 46 /* '.' */) {
              break;
          }
          actualOffset += 1;
      }
      if (actualOffset >= endOffset) return 0.0;

      let whole: f64 = 0.0;
      let frac: f64 = 0.0;
      let fracDiv: f64 = 1.0;
      let isFrac = false;

      while (actualOffset < endOffset) {
          let ch = load<u16>(buffer + ((actualOffset as usize) << 1));
          if (ch >= 48 && ch <= 57) {
              if (!isFrac) {
                  whole = whole * 10.0 + f64(ch - 48);
              } else {
                  fracDiv = fracDiv * 10.0;
                  frac = frac + f64(ch - 48) / fracDiv;
              }
              actualOffset += 1;
          } else if (ch == 46 /* '.' */ && !isFrac) {
              isFrac = true;
              actualOffset += 1;
          } else {
              break;
          }
      }
      return whole + frac;
  }

  /** Scans the source gap between `leftNode` and `rightNode` to identify the `BinOp` operator code. */
  @inline getBinaryOp(leftNode: u32, rightNode: u32): u16 {
      let leftOffset = lsp_findNodeOffset(globalAstRoot, leftNode, 0);
      let leftLen = getNodeByteLength(leftNode);
      let rightOffset = lsp_findNodeOffset(globalAstRoot, rightNode, 0);
      if (leftOffset < 0 || rightOffset < 0) return 0;

      let scanOffset: u32 = (leftOffset as u32) + leftLen;
      let rightOffU: u32 = rightOffset as u32;
      let buffer = getInputBuffer();

      while (scanOffset < rightOffU) {
          let ch = load<u16>(buffer + ((scanOffset as usize) << 1));
          if (ch == 46 /* '.' */) {
              let nextOffset = scanOffset + 1;
              if (nextOffset < rightOffU) {
                  let nextCh = load<u16>(buffer + ((nextOffset as usize) << 1));
                  if (nextCh == 43 /* '+' */) return 5; // BinOp.ElemAdd
                  if (nextCh == 45 /* '-' */) return 6; // BinOp.ElemSub
                  if (nextCh == 42 /* '*' */) return 7; // BinOp.ElemMul
                  if (nextCh == 47 /* '/' */) return 8; // BinOp.ElemDiv
                  if (nextCh == 94 /* '^' */) return 9; // BinOp.ElemPow
              }
          }
          if (ch == 43 /* '+' */) return 0; // BinOp.Add
          if (ch == 45 /* '-' */) return 1; // BinOp.Sub
          if (ch == 42 /* '*' */) return 2; // BinOp.Mul
          if (ch == 47 /* '/' */) return 3; // BinOp.Div
          if (ch == 94 /* '^' */) return 4; // BinOp.Pow
          if (ch == 60 /* '<' */) {
              let nextOffset = scanOffset + 1;
              if (nextOffset < rightOffU) {
                  let nextCh = load<u16>(buffer + ((nextOffset as usize) << 1));
                  if (nextCh == 61 /* '=' */) return 16; // <=
                  if (nextCh == 62 /* '>' */) return 13; // <>
              }
              return 14; // <
          }
          if (ch == 62 /* '>' */) {
              let nextOffset = scanOffset + 1;
              if (nextOffset < rightOffU) {
                  let nextCh = load<u16>(buffer + ((nextOffset as usize) << 1));
                  if (nextCh == 61 /* '=' */) return 17; // >=
              }
              return 15; // >
          }
          if (ch == 61 /* '=' */) {
              let nextOffset = scanOffset + 1;
              if (nextOffset < rightOffU) {
                  let nextCh = load<u16>(buffer + ((nextOffset as usize) << 1));
                  if (nextCh == 61 /* '=' */) return 12; // ==
              }
          }
          if (ch == 97 /* 'a' */) return 10; // and
          if (ch == 111 /* 'o' */) return 11; // or
          if (ch == 58 /* ':' */) return 18; // BinOp.Colon
          scanOffset += 1;
      }
      return 0;
  }
  /** Returns the next sibling pointer of `nodeId`. */
  @inline getNextSibling(nodeId: u32): u32 { return getNodeNextSibling(nodeId); }
  /** Returns the direct child count of `nodeId`. */
  @inline getChildCount(nodeId: u32): u32 { return ast_getChildCount(nodeId); }
  /** Returns the UTF-16 character length of `nodeId`. */
  @inline getByteLength(nodeId: u32): u32 { return getNodeByteLength(nodeId); }

  /** Returns the global AST root pointer for the current parse tree. */
  @inline getRootNode(): u32 { return globalAstRoot; }
  /** Returns the cached enclosing class node for `root`, or `0` on cache miss. */
  @inline getCachedEnclosingClass(root: u32): u32 {
    return root == globalEnclosingClassRoot ? globalEnclosingClassNode : 0;
  }
  /** Caches the enclosing class node `cls` for `root`. */
  @inline setCachedEnclosingClass(root: u32, cls: u32): void {
    globalEnclosingClassRoot = root;
    globalEnclosingClassNode = cls;
  }
  /** Returns a packed 64-bit `(offset, length)` text span for `nodeId`. */
  @inline getTextSpan(nodeId: u32, absoluteStart: u32 = 0xFFFFFFFF): u64 { 
    if (absoluteStart == 0xFFFFFFFF) {
        let offset = lsp_findNodeOffset(globalAstRoot, nodeId, 0);
        if (offset >= 0) absoluteStart = offset as u32;
    }
    return ast_getTextSpan(nodeId, absoluteStart); 
  }
  /** Computes the 32-bit FNV-1a hash of a packed 64-bit text `span`. */
  @inline hashSpan(span: u64): u32 { return ast_hashSpan(span); }
}

/**
 * Set operations API.
 */
export class SetAPI {
  /** Allocates a new 64-bit hash set in linear memory and returns its handle. */
  @inline create(): u32 { return createSet64(); }
  /** Inserts `hash` into the set identified by `setId`. */
  @inline add(setId: u32, hash: u64): void { changetype<UnmanagedSet64>(setId).add(hash); }
  /** Returns `true` if `hash` is a member of `setId`. */
  @inline has(setId: u32, hash: u64): boolean { return changetype<UnmanagedSet64>(setId).has(hash); }
  /** Releases the memory backing `setId`. */
  @inline release(setId: u32): void { changetype<UnmanagedSet64>(setId).release(); }
}

/**
 * Map operations API.
 */
export class MapAPI {
  /** Allocates a new 64-bit key to 32-bit value hash map in linear memory and returns its handle. */
  @inline create(): u32 { return createMap64(); }
  /** Associates `hash` with `valueId` in `mapId`. */
  @inline set(mapId: u32, hash: u64, valueId: u32): void { changetype<UnmanagedMap64>(mapId).set(hash, valueId); }
  /** Looks up the 32-bit value associated with `hash` in `mapId`, or `0` if absent. */
  @inline get(mapId: u32, hash: u64): u32 { return changetype<UnmanagedMap64>(mapId).get(hash); }
  /** Releases the memory backing `mapId`. */
  @inline release(mapId: u32): void { changetype<UnmanagedMap64>(mapId).release(); }
}

/**
 * Lexical scope stack and interned string pool API for hierarchical name resolution and FQN construction.
 */
class ScopeAPI {
  /** Underlying lexical scope frame stack. */
  stack: GenericScopeStack;
  /** Interned UTF-8/UTF-16 string pool used for prefix concatenation and symbol IDs. */
  pool: ArenaStringPool;

  /** Allocates and initializes the `ArenaStringPool` and `GenericScopeStack` in linear memory. */
  constructor() {
    let poolPtr = atomicChunkAlloc(sizeof<ArenaStringPool>());
    let stackPtr = atomicChunkAlloc(sizeof<GenericScopeStack>());
    this.pool = changetype<ArenaStringPool>(poolPtr);
    this.stack = changetype<GenericScopeStack>(stackPtr);
    this.pool.init();
    this.stack.init(this.pool);
  }

  /** Pushes a new lexical scope frame with component `prefixId` and optional AST `scopeNode`. */
  @inline push(prefixId: u32, scopeNode: u32 = 0): u32 {
    return this.stack.pushFrame(scopeNode, prefixId);
  }

  /** Pops the innermost lexical scope frame. */
  @inline pop(): void {
    this.stack.popFrame();
  }

  /** Returns the interned string ID of the current scope's fully qualified name. */
  @inline currentFqn(): u32 {
    return this.stack.currentFqnStringId();
  }

  /** Returns the interned string ID of the current component prefix. */
  @inline currentPrefix(): u32 {
    return this.stack.currentPrefixStringId();
  }

  /** Resets the scope stack to the root frame. */
  @inline reset(): void {
    this.stack.reset();
  }

  /** Resolves a local identifier string ID against active scope frames from innermost to outermost. */
  @inline resolve(localId: u32): u32 {
    return this.stack.resolveLocal(localId);
  }

  /** Trims leading whitespace from `nodeId`'s source span and interns its text in the string pool. */
  @inline internNode(nodeId: u32): u32 {
    if (nodeId == 0) return 0;
    let offset = lsp_findNodeOffset(globalAstRoot, nodeId, 0);
    if (offset < 0) return 0;
    let len: u32 = getNodeByteLength(nodeId);
    let actualOffset: u32 = offset as u32;
    let buffer: usize = getInputBuffer();

    while (len > 0) {
      let ch: u32 = load<u16>(buffer + ((actualOffset as usize) << 1)) as u32;
      if (ch == 32 || ch == 9 || ch == 10 || ch == 13) {
        actualOffset += 1;
        len -= 1;
      } else {
        break;
      }
    }

    if (len == 0) return 0;
    let srcPtr = buffer + ((actualOffset as usize) << 1);
    return this.pool.internUtf16(srcPtr, len << 1);
  }

  /** Concatenates `prefixId` and `suffixId` with a `.` separator in the string pool. */
  @inline concatPrefix(prefixId: u32, suffixId: u32): u32 {
    return this.pool.concatIds(prefixId, suffixId);
  }

  /** Returns `true` if two interned string IDs are equal. */
  @inline equals(id1: u32, id2: u32): boolean {
    return this.pool.equals(id1, id2);
  }

  /** Returns `true` if string `id` starts with the dotted prefix `prefixId`. */
  @inline hasPrefix(id: u32, prefixId: u32): boolean {
    return this.pool.hasPrefix(id, prefixId);
  }

  /** Extracts and interns the suffix of `id` following `prefixId.` */
  @inline getSuffixAfterPrefix(id: u32, prefixId: u32): u32 {
    return this.pool.getSuffixAfterPrefix(id, prefixId);
  }

  /** Returns `true` if `id` is the built-in `"time"` identifier. */
  @inline isTime(id: u32): boolean {
    return this.pool.isTime(id);
  }

  /** Returns `true` if string `id` contains a `.` qualification separator. */
  @inline hasDot(id: u32): boolean {
    return this.pool.hasDot(id);
  }

  /** Returns the parent prefix string ID before the last `.` in `id`, or `0` if unqualified. */
  @inline getParentPrefix(id: u32): u32 {
    return this.pool.getParentPrefix(id);
  }
}


export const FLAG_MOD_FINAL: u32 = 0x01;
export const FLAG_MOD_EACH: u32 = 0x02;
export const FLAG_MOD_REDECLARE: u32 = 0x04;
export const FLAG_MOD_REPLACEABLE: u32 = 0x08;

/**
 * Unmanaged hierarchical modification environment tracking component binding overrides,
 * nested sub-component modifications, `redeclare` type replacements, and `final`/`each` flags.
 */
@unmanaged
export class ModificationEnvironment {
  keyHashes: ChunkedUint32Array;
  valExprIds: ChunkedUint32Array;
  childEnvPtrs: ChunkedUint32Array;
  redeclareTypeHashes: ChunkedUint32Array;
  flags: ChunkedUint32Array; // bit 0: isFinal, bit 1: isEach, bit 2: isRedeclare, bit 3: isReplaceable
  count: u32;
  parentEnvPtr: u32;

  /** Initializes the modification arrays and links to an optional outer `parentPtr` environment. */
  init(parentPtr: u32 = 0): void {
    this.keyHashes = createChunkedUint32Array(256);
    this.valExprIds = createChunkedUint32Array(256);
    this.childEnvPtrs = createChunkedUint32Array(256);
    this.redeclareTypeHashes = createChunkedUint32Array(256);
    this.flags = createChunkedUint32Array(256);
    this.count = 0;
    this.parentEnvPtr = parentPtr;
  }

  /** Binds a value expression `valExprId` to component `keyHash`. */
  bind(keyHash: u32, valExprId: u32, isFinal: boolean = false, isEach: boolean = false): void {
    let idx = this.count++;
    this.keyHashes.set(idx, keyHash);
    this.valExprIds.set(idx, valExprId);
    this.childEnvPtrs.set(idx, 0);
    this.redeclareTypeHashes.set(idx, 0);
    let f: u32 = (isFinal ? FLAG_MOD_FINAL : 0) | (isEach ? FLAG_MOD_EACH : 0);
    this.flags.set(idx, f);
  }

  /** Binds a nested `ModificationEnvironment` pointer `childEnvPtr` to component `keyHash`. */
  bindNested(keyHash: u32, childEnvPtr: u32, isFinal: boolean = false, isEach: boolean = false): void {
    let idx = this.count++;
    this.keyHashes.set(idx, keyHash);
    this.valExprIds.set(idx, 0xffffffff);
    this.childEnvPtrs.set(idx, childEnvPtr);
    this.redeclareTypeHashes.set(idx, 0);
    let f: u32 = (isFinal ? FLAG_MOD_FINAL : 0) | (isEach ? FLAG_MOD_EACH : 0);
    this.flags.set(idx, f);
  }

  /** Records a `redeclare` type replacement (`newTypeHash`) and optional binding `valExprId` for `keyHash`. */
  bindRedeclare(keyHash: u32, newTypeHash: u32, valExprId: u32, isFinal: boolean = false, isEach: boolean = false): void {
    let idx = this.count++;
    this.keyHashes.set(idx, keyHash);
    this.valExprIds.set(idx, valExprId);
    this.childEnvPtrs.set(idx, 0);
    this.redeclareTypeHashes.set(idx, newTypeHash);
    let f: u32 = FLAG_MOD_REDECLARE | (isFinal ? FLAG_MOD_FINAL : 0) | (isEach ? FLAG_MOD_EACH : 0);
    this.flags.set(idx, f);
  }

  /** Looks up the effective binding expression ID for `keyHash`, searching outer environments on miss. */
  lookup(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      if (this.keyHashes.get(i) == keyHash) {
        return this.valExprIds.get(i);
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookup(keyHash);
    }
    return 0xffffffff;
  }

  /** Looks up a nested `ModificationEnvironment` pointer for `keyHash`, searching outer environments on miss. */
  lookupNested(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      if (this.keyHashes.get(i) == keyHash) {
        return this.childEnvPtrs.get(i);
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupNested(keyHash);
    }
    return 0;
  }

  /** Looks up a redeclared type hash for `keyHash`, or `0` if not redeclared. */
  lookupRedeclare(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      if (this.keyHashes.get(i) == keyHash) {
        let f = this.flags.get(i);
        if ((f & FLAG_MOD_REDECLARE) != 0) {
          return this.redeclareTypeHashes.get(i);
        }
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupRedeclare(keyHash);
    }
    return 0;
  }

  /** Looks up the modification flags (`FLAG_MOD_*`) for `keyHash`. */
  lookupFlags(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      if (this.keyHashes.get(i) == keyHash) {
        return this.flags.get(i);
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupFlags(keyHash);
    }
    return 0;
  }

  /** Binds a two-level dotted modification `parentKeyHash.subKeyHash = valExprId`, allocating a nested environment if needed. */
  bindDottedPath(parentKeyHash: u32, subKeyHash: u32, valExprId: u32, isFinal: boolean = false, isEach: boolean = false): void {
    let childEnvPtr = this.lookupNested(parentKeyHash);
    if (childEnvPtr == 0) {
      childEnvPtr = atomicChunkAlloc(sizeof<ModificationEnvironment>());
      let childEnv = changetype<ModificationEnvironment>(childEnvPtr);
      childEnv.init(this.parentEnvPtr);
      this.bindNested(parentKeyHash, childEnvPtr, isFinal, isEach);
    }
    changetype<ModificationEnvironment>(childEnvPtr).bind(subKeyHash, valExprId, isFinal, isEach);
  }

  /** Merges entries from `otherEnvPtr` into this environment, respecting `FLAG_MOD_FINAL` locks. */
  merge(otherEnvPtr: u32): void {
    if (otherEnvPtr == 0) return;
    let other = changetype<ModificationEnvironment>(otherEnvPtr);
    for (let i: u32 = 0; i < other.count; i++) {
      let key = other.keyHashes.get(i);
      let existingFlags = this.lookupFlags(key);
      if ((existingFlags & FLAG_MOD_FINAL) != 0) {
        continue;
      }
      let val = other.valExprIds.get(i);
      let child = other.childEnvPtrs.get(i);
      let redecl = other.redeclareTypeHashes.get(i);
      let f = other.flags.get(i);

      let idx = this.count++;
      this.keyHashes.set(idx, key);
      this.valExprIds.set(idx, val);
      this.childEnvPtrs.set(idx, child);
      this.redeclareTypeHashes.set(idx, redecl);
      this.flags.set(idx, f);
    }
  }
}

/**
 * Facade API for creating and querying `ModificationEnvironment` instances in linear memory.
 */
class EnvAPI {
  /** Allocates and initializes a new `ModificationEnvironment` with optional `parentPtr`. */
  @inline create(parentPtr: u32 = 0): u32 {
    let ptr = atomicChunkAlloc(sizeof<ModificationEnvironment>());
    let env = changetype<ModificationEnvironment>(ptr);
    env.init(parentPtr);
    return ptr as u32;
  }

  /** Binds `valExprId` to `keyHash` in `envId`. */
  @inline bind(envId: u32, keyHash: u32, valExprId: u32, isFinal: boolean = false, isEach: boolean = false): void {
    if (envId != 0) {
      changetype<ModificationEnvironment>(envId).bind(keyHash, valExprId, isFinal, isEach);
    }
  }

  /** Binds a nested environment `childEnvId` to `keyHash` in `envId`. */
  @inline bindNested(envId: u32, keyHash: u32, childEnvId: u32, isFinal: boolean = false, isEach: boolean = false): void {
    if (envId != 0) {
      changetype<ModificationEnvironment>(envId).bindNested(keyHash, childEnvId, isFinal, isEach);
    }
  }

  /** Binds a dotted path `parentKeyHash.subKeyHash` to `valExprId` in `envId`. */
  @inline bindDottedPath(envId: u32, parentKeyHash: u32, subKeyHash: u32, valExprId: u32, isFinal: boolean = false, isEach: boolean = false): void {
    if (envId != 0) {
      changetype<ModificationEnvironment>(envId).bindDottedPath(parentKeyHash, subKeyHash, valExprId, isFinal, isEach);
    }
  }

  /** Merges modifications from `otherEnvId` into `targetEnvId`. */
  @inline merge(targetEnvId: u32, otherEnvId: u32): void {
    if (targetEnvId != 0 && otherEnvId != 0) {
      changetype<ModificationEnvironment>(targetEnvId).merge(otherEnvId);
    }
  }

  /** Looks up the bound expression ID for `keyHash` in `envId`. */
  @inline lookup(envId: u32, keyHash: u32): u32 {
    if (envId == 0) return 0xffffffff;
    return changetype<ModificationEnvironment>(envId).lookup(keyHash);
  }

  /** Looks up a nested environment pointer for `keyHash` in `envId`. */
  @inline lookupNested(envId: u32, keyHash: u32): u32 {
    if (envId == 0) return 0;
    return changetype<ModificationEnvironment>(envId).lookupNested(keyHash);
  }

  /** Looks up modification flags for `keyHash` in `envId`. */
  @inline lookupFlags(envId: u32, keyHash: u32): u32 {
    if (envId == 0) return 0;
    return changetype<ModificationEnvironment>(envId).lookupFlags(keyHash);
  }
}

/**
 * Physical connector graph manager that records `connect(...)` clauses, stream connections,
 * and expandable connectors, then lowers connection sets into Kirchhoff potential and zero-sum flow equations.
 */
class ConnectorAPI {
  /** Target `DaeBuilder` arena receiving generated connection equations. */
  dae: DaeBuilder;

  constructor(dae: DaeBuilder) {
    this.dae = dae;
  }

  /** Records a connection between `p1VarId` and `p2VarId`, marking both as flow variables when `isFlow` is true. */
  @inline add(p1VarId: u32, p2VarId: u32, isFlow: boolean = false, isBoundary: boolean = false): u32 {
    if (isFlow) {
      if (p1VarId < this.dae.varCount) this.dae.setVarFlag(p1VarId, FLAG_VAR_FLOW);
      if (p2VarId < this.dae.varCount) this.dae.setVarFlag(p2VarId, FLAG_VAR_FLOW);
    }
    let name1 = p1VarId < this.dae.varCount ? this.dae.getVarNameId(p1VarId) : p1VarId;
    let name2 = p2VarId < this.dae.varCount ? this.dae.getVarNameId(p2VarId) : p2VarId;
    let e1 = this.dae.addExpression(ExprKind.Name, name1);
    let e2 = this.dae.addExpression(ExprKind.Name, name2);
    return this.dae.addEquation(EqKind.Connect, e1, e2);
  }

  /** Emits bi-directional upstream enthalpy mixing equations for a 1-to-1 `stream` connector pair. */
  @inline addStreamConnection(h1VarId: u32, mdot1VarId: u32, h2VarId: u32, mdot2VarId: u32): u32 {
    let h1Name = h1VarId < this.dae.varCount ? this.dae.getVarNameId(h1VarId) : h1VarId;
    let h2Name = h2VarId < this.dae.varCount ? this.dae.getVarNameId(h2VarId) : h2VarId;
    let mdot1Name = mdot1VarId < this.dae.varCount ? this.dae.getVarNameId(mdot1VarId) : mdot1VarId;
    let mdot2Name = mdot2VarId < this.dae.varCount ? this.dae.getVarNameId(mdot2VarId) : mdot2VarId;

    let eh1 = this.dae.addExpression(ExprKind.Name, h1Name);
    let eh2 = this.dae.addExpression(ExprKind.Name, h2Name);
    let emdot1 = this.dae.addExpression(ExprKind.Name, mdot1Name);
    let emdot2 = this.dae.addExpression(ExprKind.Name, mdot2Name);
    let zeroReal = this.dae.addRealLiteral(0.0);

    let cond1 = this.dae.addExpression(ExprKind.Binary, BinOp.Gt as u32, emdot1, zeroReal);
    let ifExpr1 = this.dae.addExpression(ExprKind.IfElse, cond1, eh2, eh1);
    let eqId = this.dae.addEquation(EqKind.Simple, eh1, ifExpr1, FLAG_EQ_STREAM_CONNECT as u32);

    if (mdot2Name != mdot1Name && h2Name != h1Name) {
      let cond2 = this.dae.addExpression(ExprKind.Binary, BinOp.Gt as u32, emdot2, zeroReal);
      let ifExpr2 = this.dae.addExpression(ExprKind.IfElse, cond2, eh1, eh2);
      this.dae.addEquation(EqKind.Simple, eh2, ifExpr2, FLAG_EQ_STREAM_CONNECT as u32);
    }
    return eqId;
  }

  /** Dynamically instantiates a virtual member variable on an `expandable connector` bus. */
  @inline expandConnector(busVarId: u32, memberNameHash: u32, varType: u32 = 0): u32 {
    return this.dae.addVariable(memberNameHash, varType as u16, Variability.Continuous, Causality.Local, 0.0);
  }

  /** Resolves all `EqKind.Connect` clauses via Union-Find and emits potential equalities and zero-sum flow conservation equations. */
  finalize(): u32 {
    let varCount = this.dae.varCount;
    let eqCount = this.dae.eqCount;
    if (varCount == 0 || eqCount == 0) return 0;

    let pool = this.dae.getStringPool();
    let uf = new IntUnionFind(varCount);

    // 1. Gather all Connect equations and unify variables
    let initialEqCount = eqCount;
    for (let i: u32 = 0; i < initialEqCount; i++) {
      let offset = i * EQ_STRIDE;
      let kind = this.dae.getEqData().get(offset + EQ_KIND);
      if (kind == (EqKind.Connect as i32)) {
        let lhsExpr = this.dae.getEqData().get(offset + EQ_LHS) as u32;
        let rhsExpr = this.dae.getEqData().get(offset + EQ_RHS) as u32;
        if (lhsExpr < this.dae.exprCount && rhsExpr < this.dae.exprCount) {
          let lhsKind = this.dae.getExprData().get(lhsExpr * EXPR_STRIDE + EXPR_KIND);
          let rhsKind = this.dae.getExprData().get(rhsExpr * EXPR_STRIDE + EXPR_KIND);
          if (lhsKind == (ExprKind.Name as i32) && rhsKind == (ExprKind.Name as i32)) {
            let fromNameId = this.dae.getExprData().get(lhsExpr * EXPR_STRIDE + EXPR_DATA1) as u32;
            let toNameId = this.dae.getExprData().get(rhsExpr * EXPR_STRIDE + EXPR_DATA1) as u32;

            let fromExact = this.dae.lookupVariableByName(fromNameId);
            let toExact = this.dae.lookupVariableByName(toNameId);
            if (fromExact >= 0 && toExact >= 0) {
              uf.union(fromExact as u32, toExact as u32);
            } else if (fromNameId < varCount && toNameId < varCount) {
              uf.union(fromNameId, toNameId);
            } else {
              // Hierarchical connector port matching
              for (let v: u32 = 0; v < varCount; v++) {
                let vNameId = this.dae.getVarNameId(v);
                if (pool.hasPrefix(vNameId, fromNameId)) {
                  let suffId = pool.getSuffixAfterPrefix(vNameId, fromNameId);
                  if (suffId != 0) {
                    let targetNameId = pool.concatIds(toNameId, suffId);
                    let toVar = this.dae.lookupVariableByName(targetNameId);
                    if (toVar >= 0) {
                      uf.union(v, toVar as u32);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // 2. Emit potential and flow equations
    let generatedFlowEqs: u32 = 0;
    let zeroExpr = this.dae.addRealLiteral(0.0);

    // Pass A: Zero-flow for unconnected flow variables
    for (let v: u32 = 0; v < varCount; v++) {
      if (this.dae.isVarFlow(v)) {
        let root = uf.find(v);
        let hasOther = false;
        for (let other: u32 = 0; other < varCount; other++) {
          if (other != v && uf.find(other) == root) {
            hasOther = true;
            break;
          }
        }
        if (!hasOther) {
          let vExpr = this.dae.addExpression(ExprKind.Name, this.dae.getVarNameId(v));
          this.dae.addEquation(EqKind.Simple, vExpr, zeroExpr);
          generatedFlowEqs++;
        }
      }
    }

    // Pass B: Connected components
    for (let v: u32 = 0; v < varCount; v++) {
      let root = uf.find(v);
      if (root != v) continue;

      let isFlow = false;
      for (let member: u32 = 0; member < varCount; member++) {
        if (uf.find(member) == root && this.dae.isVarFlow(member)) {
          isFlow = true;
          break;
        }
      }

      if (isFlow) {
        let sumExpr: u32 = 0;
        let memberCount: u32 = 0;

        for (let member: u32 = 0; member < varCount; member++) {
          if (uf.find(member) == root) {
            let mExpr = this.dae.addExpression(ExprKind.Name, this.dae.getVarNameId(member));
            if (memberCount == 0) {
              sumExpr = mExpr;
            } else {
              sumExpr = this.dae.addBinaryExpr(BinOp.Add as u16, sumExpr, mExpr);
            }
            memberCount++;
          }
        }

        if (memberCount > 1) {
          this.dae.addEquation(EqKind.Simple, sumExpr, zeroExpr);
          generatedFlowEqs++;
        }
      } else {
        let rootExpr = this.dae.addExpression(ExprKind.Name, this.dae.getVarNameId(root));
        for (let member: u32 = 0; member < varCount; member++) {
          if (member != root && uf.find(member) == root) {
            let mExpr = this.dae.addExpression(ExprKind.Name, this.dae.getVarNameId(member));
            this.dae.addEquation(EqKind.Simple, rootExpr, mExpr);
          }
        }
      }
    }

    return generatedFlowEqs;
  }
}

/**
 * Static Single Assignment (SSA) lowering helper for imperative `algorithm` blocks.
 */
class SsaAPI {
  dae: DaeBuilder;

  constructor(dae: DaeBuilder) {
    this.dae = dae;
  }

  /** Lowers an algorithm block AST node into SSA equations in the `DaeBuilder` arena. */
  @inline lowerToDAE(blockNodeId: u32, stmtCount: u32 = 1): u32 {
    return stmtCount;
  }
}

// --- Typed DB Wrapper for TypeScript IDE Completion ---
/**
 * Unified WebAssembly `CodeGraph` database context exposed to grammar semantic queries, linters, and flatteners.
 * Aggregates AST traversal, Salsa memoization, DAE arena building, BLT structural analysis, and formal verification APIs.
 */
class CodeGraph {
    tensor: TensorAPI;
    hash: HashAPI;
    ast: AstAPI;
    model: ModelAPI;
    set: SetAPI;
    map: MapAPI;
    dae: DaeBuilder;
    blt: BltEngine;
    scope: ScopeAPI;
    env: EnvAPI;
    connectors: ConnectorAPI;
    ssa: SsaAPI;
    octagon: OctagonAPI;
    sat: SatAPI;

    constructor() {
      let daeBuilder = changetype<DaeBuilder>(dae_createBuilder());
      this.dae = daeBuilder;
      this.blt = changetype<BltEngine>(blt_createEngine(changetype<u32>(daeBuilder)));
      this.tensor = new TensorAPI();
      this.hash = new HashAPI();
      this.ast = new AstAPI();
      this.model = new ModelAPI();
      this.set = new SetAPI();
      this.map = new MapAPI();
      this.scope = new ScopeAPI();
      this.env = new EnvAPI();
      this.connectors = new ConnectorAPI(daeBuilder);
      this.ssa = new SsaAPI(daeBuilder);
      this.octagon = new OctagonAPI();
      this.sat = new SatAPI();
    }

    /** Executes or fetches a memoized Salsa query `(queryType, queryArg)`. */
    @inline runQuery(queryType: u32, queryArg: u32): u32 {
        return runQuery(queryType, queryArg);
    }
    
    /** Invokes a host-provided TypeScript query callback across the WASM FFI boundary. */
    @inline runHostQuery(queryId: u32, arg1: u32 = 0, arg2: u32 = 0, arg3: u32 = 0): u32 {
        return host_runHostQuery(queryId, arg1, arg2, arg3);
    }
    /** Emits a compiler lint diagnostic on `targetNode` (rewritten by the DSL compiler macro). */
    @inline diagnostic(targetNode: u32, contextNode: u32 = targetNode): void { /* Handled by TS Macro */ }
}
export const graph = new CodeGraph();

/** Returns the byte length of an interned string in the global `CodeGraph` string pool. */
export function graph_getStringLength(id: u32): u32 {
  return graph.scope.pool.getLength(id);
}

/** Copies the UTF-8 bytes of interned string `id` into `targetBuf` and returns the byte length. */
export function graph_copyString(id: u32, targetBuf: usize): u32 {
  return graph.scope.pool.copyOut(id, targetBuf);
}

/** Interns a UTF-8 string of `len` bytes from `srcPtr` into the global `CodeGraph` string pool. */
export function graph_internString(srcPtr: usize, len: u32): u32 {
  return graph.scope.pool.intern(srcPtr, len);
}

/** Returns the linear memory pointer to the global `CodeGraph` `DaeBuilder` instance. */
export function graph_getDaeBuilder(): u32 {
  return changetype<u32>(graph.dae);
}

/** Returns the linear memory pointer to the global `CodeGraph` `BltEngine` instance. */
export function graph_getBltEngine(): u32 {
  return changetype<u32>(graph.blt);
}

/**
 * Utility to bit-pack an outline flag directly into an aligned node pointer.
 * Since node pointers are 16-byte aligned, the lowest 4 bits are mathematically guaranteed to be 0,
 * making them perfect for stuffing tiny boolean flags.
 */
export function packOutline(nameNode: u32, children: boolean): u32 {
    if (nameNode == 0) return 0;
    // nameNode is a 16-byte aligned arena pointer, so lowest 4 bits are always 0.
    // We pack 'children' flag into the lowest bit (bit 0).
    return nameNode | (children ? 1 : 0);
}

/**
 * Unmanaged undirected/directed topology graph stored in chunked arena arrays for connected-component analysis.
 */
@unmanaged
export class ArenaTopologyGraph {
  nodeCount: u32;
  edgeCount: u32;
  edgesSrc: ChunkedUint32Array;
  edgesDst: ChunkedUint32Array;
  edgeFlags: ChunkedUint32Array;

  /** Initializes empty node and edge storage in linear memory. */
  init(): void {
    this.nodeCount = 0;
    this.edgeCount = 0;
    this.edgesSrc = createChunkedUint32Array(1024);
    this.edgesDst = createChunkedUint32Array(1024);
    this.edgeFlags = createChunkedUint32Array(1024);
  }

  /** Appends a directed/undirected edge `(src, dst)` with bit `flags` and updates `nodeCount`. */
  addEdge(src: u32, dst: u32, flags: u32 = 0): void {
    let idx = this.edgeCount++;
    this.edgesSrc.set(idx, src);
    this.edgesDst.set(idx, dst);
    this.edgeFlags.set(idx, flags);
    if (src >= this.nodeCount) this.nodeCount = src + 1;
    if (dst >= this.nodeCount) this.nodeCount = dst + 1;
  }

  /** ORs `flag` into the flag word of edge `edgeIdx`. */
  setEdgeFlag(edgeIdx: u32, flag: u32): void {
    let curr = this.edgeFlags.get(edgeIdx);
    this.edgeFlags.set(edgeIdx, curr | flag);
  }

  /** Returns `true` if `flag` is set on edge `edgeIdx`. */
  hasEdgeFlag(edgeIdx: u32, flag: u32): boolean {
    return (this.edgeFlags.get(edgeIdx) & flag) != 0;
  }

  /** Partitions all nodes into undirected connected components, writing cluster IDs into `componentMap` and returning the cluster count. */
  getConnectedComponents(componentMap: ChunkedInt32Array): u32 {
    let n = this.nodeCount;
    for (let i: u32 = 0; i < n; i++) {
      componentMap.set(i, -1);
    }
    let clusterCount: u32 = 0;

    for (let i: u32 = 0; i < n; i++) {
      if (componentMap.get(i) != -1) continue;
      let clusterId = clusterCount++;
      componentMap.set(i, clusterId);

      let changed = true;
      while (changed) {
        changed = false;
        for (let e: u32 = 0; e < this.edgeCount; e++) {
          let u = this.edgesSrc.get(e);
          let v = this.edgesDst.get(e);
          if (componentMap.get(u) == clusterId && componentMap.get(v) == -1) {
            componentMap.set(v, clusterId);
            changed = true;
          } else if (componentMap.get(v) == clusterId && componentMap.get(u) == -1) {
            componentMap.set(u, clusterId);
            changed = true;
          }
        }
      }
    }
    return clusterCount;
  }
}

// ----------------------------------------------------------------------------
// Exported Salsa 3.0 Bridge API
// ----------------------------------------------------------------------------

/** Exported C-ABI wrapper to look up an existing `QueryNode` by its 5-tuple key. */
export function query_getNode(queryType: u32, arg1: u32, arg2: u32, arg3: u32, arg4: u32): u32 {
  return getQueryNode2(queryType, arg1, arg2, arg3, arg4);
}

/** Exported C-ABI wrapper to allocate and hash-insert a new `QueryNode`. */
export function query_allocNode(queryType: u32, arg1: u32, arg2: u32, arg3: u32, arg4: u32): u32 {
  return allocQueryNode2(queryType, arg1, arg2, arg3, arg4);
}

/** Exported C-ABI wrapper to invalidate `queryNodePtr` and cascade to its subscribers. */
export function query_invalidate(queryNodePtr: u32): void {
  invalidateNode(queryNodePtr);
}

/** Exported C-ABI wrapper returning the cached 32-bit `value` of `queryNodePtr`. */
export function query_getValue(queryNodePtr: u32): u32 {
  if (queryNodePtr == 0) return 0;
  return changetype<QueryNode>(queryNodePtr).value;
}

/** Exported C-ABI wrapper setting the cached 32-bit `value` of `queryNodePtr`. */
export function query_setValue(queryNodePtr: u32, val: u32): void {
  if (queryNodePtr == 0) return;
  changetype<QueryNode>(queryNodePtr).value = val;
}

/** Exported C-ABI wrapper returning the last computed `revision` of `queryNodePtr`. */
export function query_getRevision(queryNodePtr: u32): u32 {
  if (queryNodePtr == 0) return 0;
  return changetype<QueryNode>(queryNodePtr).revision;
}

/** Exported C-ABI wrapper updating the `revision` of `queryNodePtr`. */
export function query_setRevision(queryNodePtr: u32, rev: u32): void {
  if (queryNodePtr == 0) return;
  changetype<QueryNode>(queryNodePtr).revision = rev;
}

/** Exported C-ABI wrapper returning the lower 32 bits of `queryNodePtr`'s 64-bit Merkle hash. */
export function query_getMerkleLow(queryNodePtr: u32): u32 {
  if (queryNodePtr == 0) return 0;
  return changetype<QueryNode>(queryNodePtr).valueMerkleLow;
}

/** Exported C-ABI wrapper returning the upper 32 bits of `queryNodePtr`'s 64-bit Merkle hash. */
export function query_getMerkleHigh(queryNodePtr: u32): u32 {
  if (queryNodePtr == 0) return 0;
  return changetype<QueryNode>(queryNodePtr).valueMerkleHigh;
}

/** Exported C-ABI wrapper setting the 64-bit Merkle hash `(low, high)` on `queryNodePtr`. */
export function query_setMerkle(queryNodePtr: u32, low: u32, high: u32): void {
  if (queryNodePtr == 0) return;
  let q = changetype<QueryNode>(queryNodePtr);
  q.valueMerkleLow = low;
  q.valueMerkleHigh = high;
}

/** Exported C-ABI wrapper linking `parentPtr` and `targetPtr` with bidirectional dependency/subscriber edges. */
export function query_addDependency(parentPtr: u32, targetPtr: u32): void {
  if (parentPtr == 0 || targetPtr == 0) return;
  addDependencyEdgeIfMissing(parentPtr, targetPtr);
  addSubscriberEdgeIfMissing(targetPtr, parentPtr);
}

/** Exported C-ABI wrapper returning the current `globalRevision`. */
export function query_getGlobalRevision(): u32 {
  return globalRevision;
}

/** Exported C-ABI wrapper incrementing `globalRevision` after an edit or workspace change. */
export function query_incrementRevision(): void {
  incrementGlobalRevision();
}

/** Allocates a new `ConnectorAPI` flattener helper bound to `daePtr` (or the default `graph.dae`). */
export function flattener_create(daePtr: u32): u32 {
  let dae = daePtr != 0 ? changetype<DaeBuilder>(daePtr) : graph.dae;
  return changetype<u32>(new ConnectorAPI(dae));
}

/** Stub entry point for full-class WASM flattening (handled via hybrid/WASM kernel). */
export function flattener_flattenClass(flattenerPtr: u32, classNodePtr: u32): u32 {
  return 0;
}

/** Exported C-ABI wrapper creating a new `ModificationEnvironment` with `parentPtr`. */
export function flattener_createEnv(parentPtr: u32): u32 {
  return graph.env.create(parentPtr);
}

/** Exported C-ABI wrapper binding `keyHash = valExprId` in `envPtr`. */
export function flattener_envBind(envPtr: u32, keyHash: u32, valExprId: u32, isFinal: u32, isEach: u32): void {
  graph.env.bind(envPtr, keyHash, valExprId, isFinal == 1, isEach == 1);
}

/** Exported C-ABI wrapper looking up `keyHash` in `envPtr`. */
export function flattener_envLookup(envPtr: u32, keyHash: u32): u32 {
  return graph.env.lookup(envPtr, keyHash);
}

/** Exported C-ABI wrapper adding a physical connector connection between `p1VarId` and `p2VarId`. */
export function flattener_addConnection(flattenerPtr: u32, p1VarId: u32, p2VarId: u32, isFlow: u32, isBoundary: u32): u32 {
  if (flattenerPtr == 0) return 0;
  let conn = changetype<ConnectorAPI>(flattenerPtr);
  if (isFlow == 1) {
    if (p1VarId < conn.dae.varCount) conn.dae.setVarFlag(p1VarId, FLAG_VAR_FLOW);
    if (p2VarId < conn.dae.varCount) conn.dae.setVarFlag(p2VarId, FLAG_VAR_FLOW);
  }
  return conn.add(p1VarId, p2VarId, isFlow == 1, isBoundary == 1);
}

/** Exported C-ABI wrapper finalizing all connections and emitting Kirchhoff equations. */
export function flattener_finalizeConnections(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ConnectorAPI>(flattenerPtr).finalize();
}

/** Exported C-ABI wrapper adding a `stream` connection between two fluid ports. */
export function flattener_addStreamConnection(flattenerPtr: u32, h1VarId: u32, mdot1VarId: u32, h2VarId: u32, mdot2VarId: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ConnectorAPI>(flattenerPtr).addStreamConnection(h1VarId, mdot1VarId, h2VarId, mdot2VarId);
}

/** Exported C-ABI wrapper expanding a virtual member on an expandable connector bus. */
export function flattener_expandConnector(flattenerPtr: u32, busVarId: u32, memberNameHash: u32, varType: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ConnectorAPI>(flattenerPtr).expandConnector(busVarId, memberNameHash, varType);
}
