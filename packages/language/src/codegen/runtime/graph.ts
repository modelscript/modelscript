// True CodeGraph Incremental Database and LSP Bridge
// Pure Arena Implementation (Zero-GC, Integer-based)
import { 
  getNodeType, getNodeFirstChild, getNodeNextSibling, 
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
  ast_setNodeFlag, ast_clearNodeFlag, ast_hasNodeFlag
} from "./arena";
import { UnmanagedUint32Array } from "./array";
import { globalAstRoot, lsp_findNodeOffset } from "./lsp";
import { getChildByFieldId, getChildrenByFieldId, getAncestors, getDescendants, getPathTokens, getSemanticChildren } from "./engine";
import { FieldCursor, AncestorCursor, DescendantCursor, SemanticCursor } from "./engine";
import { FieldId, SyntaxType } from "./parser";
import { lsp_allocDiagnostic } from "./lsp";
import { UnmanagedSet64, UnmanagedMap64, createSet64, createMap64 } from "./hashmap";

@external("host", "runHostQuery")
export declare function host_runHostQuery(queryId: u32, arg1: u32, arg2: u32, arg3: u32): u32;

@unmanaged
export class QueryNode {
  queryType: u32;             // +0
  arg1: u32;                  // +4
  arg2: u32;                  // +8
  arg3: u32;                  // +12
  revision: u32;              // +16
  value: u32;                 // +20
  firstDependencyEdge: u32;   // +24
  firstSubscriberEdge: u32;   // +28
  nextHashBucketPtr: u32;     // +32
}

@unmanaged
export class EdgeNode {
  targetPtr: u32;             // +0
  nextEdgePtr: u32;           // +4
}

@unmanaged
export class FqnSymbol {
  hash: u32;                  // +0
  nodeId: u32;                // +4
  next: u32;                  // +8
}

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

// Diagnostic Node (16 bytes):
// +0: startByte (u32)
// +4: endByte (u32)
// +8: argPtr (u32) - Pointer to WASM string or extra u32 data
// +12: nextDiagPtr (u32)

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
  // Allocate hash table
  queryHashTableOffset = changetype<UnmanagedUint32Array>(heap.alloc(HASH_TABLE_CAPACITY * 4));
  
  // Allocate FQN hash table
  fqnHashTableOffset = changetype<UnmanagedUint32Array>(heap.alloc(FQN_HASH_TABLE_CAPACITY * 4));
  
  // Allocate 128-byte dirty files bitset (for up to 1024 file IDs)
  dirtyFilesBitsetOffset = changetype<UnmanagedUint32Array>(heap.alloc(128));
  
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

// Removed legacy 1-key functions: hashQueryKey, getQueryNode, allocQueryNode

/**
 * Allocates an 8-byte edge node to link query dependencies.
 * @param targetPtr Pointer to the target query node.
 * @param nextPtr Pointer to the next edge in the linked list.
 */
export function allocEdge(targetPtr: u32, nextPtr: u32): u32 {
  let ptr = heap.alloc(8) as u32;
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
  let ptr = heap.alloc(12) as u32;
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
  // Phase 6B: Added visibility (0=public, 1=private)
  // Allocate 16 bytes to fit u8 properly with alignment, or just 12 and pack. We'll use 16.
  let ptr = heap.alloc(16) as u32;
  let imp = changetype<ScopedImport>(ptr);
  imp.scopeId = scopeId;
  imp.moduleHash = moduleHash;
  imp.next = scopedImportHead;
  imp.visibility = visibility;
  scopedImportHead = ptr;
}

// =====================================================================
// Section 2: Query Execution & Dependency Tracking (v2 — Full 32-bit Keys)
// =====================================================================

// Query Node Layout (36 bytes):
// +0:  queryType (u32)   — discriminator for the compute function
// +4:  arg1      (u32)   — primary argument (e.g. node pointer)
// +8:  arg2      (u32)   — optional argument 2
// +12: arg3      (u32)   — optional argument 3
// +16: revision  (u32)   — last-computed revision
// +20: value     (u32)   — cached result
// +24: firstDep  (u32)   — linked list of dependency edges
// +28: firstSub  (u32)   — linked list of subscriber edges
// +32: nextHash  (u32)   — hash bucket chain

// Combines queryType and arguments into a hash table index.
/**
 * Combines a query type and three arbitrary 32-bit arguments into a single 32-bit hash.
 * Utilizes the FNV-1a algorithm for rapid, collision-resistant distribution.
 */
function combineQueryKey(queryType: u32, arg1: u32, arg2: u32, arg3: u32): u32 {
   let h: u32 = 0x811c9dc5;
   h ^= queryType;
   h = (h * 0x01000193) >>> 0;
   h ^= arg1;
   h = (h * 0x01000193) >>> 0;
   h ^= arg2;
   h = (h * 0x01000193) >>> 0;
   h ^= arg3;
   h = (h * 0x01000193) >>> 0;
   return h & (HASH_TABLE_CAPACITY - 1);
}

/**
 * Looks up an existing query node in the incremental database.
 * If found, it indicates that the query has been evaluated previously.
 * @returns The query node pointer, or 0 if not found.
 */
export function getQueryNode2(queryType: u32, arg1: u32, arg2: u32, arg3: u32): u32 {
   let idx = combineQueryKey(queryType, arg1, arg2, arg3);
   let ptr = queryHashTableOffset[idx];
   while (ptr != 0) {
      let node = changetype<QueryNode>(ptr);
      if (node.queryType == queryType && 
          node.arg1 == arg1 && 
          node.arg2 == arg2 && 
          node.arg3 == arg3) return ptr;
      ptr = node.nextHashBucketPtr;
   }
   return 0;
}

/**
 * Allocates a new 36-byte query node from linear memory and inserts it into the
 * open-addressing hash table. This node will track its execution state, cached value,
 * and dependency edges for future incremental runs.
 */
export function allocQueryNode2(queryType: u32, arg1: u32, arg2: u32, arg3: u32): u32 {
  let ptr = heap.alloc(36) as u32;
  let node = changetype<QueryNode>(ptr);
  node.queryType = queryType;
  node.arg1 = arg1;
  node.arg2 = arg2;
  node.arg3 = arg3;
  node.revision = 0;
  node.value = 0;
  node.firstDependencyEdge = 0;
  node.firstSubscriberEdge = 0;
  
  let idx = combineQueryKey(queryType, arg1, arg2, arg3);
  node.nextHashBucketPtr = queryHashTableOffset[idx];
  queryHashTableOffset[idx] = ptr;
  
  return ptr;
}

export let globalRevision: u32 = 1;

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

export function incrementGlobalRevision(): void {
  globalRevision++;
}

// 1024 stack depth max
export const activeQueryStack = new Uint32Array(1024);
export let activeQueryDepth: i32 = 0;

/**
 * Ensures a directed edge is established between two query nodes.
 * Walks the edge list to prevent duplicate edges from being allocated.
 * @param headPtrOffset The offset of the linked list head within the query node.
 * @param targetPtr The target node to link to.
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
export function runQuery(queryType: u32, arg1: u32, arg2: u32 = 0, arg3: u32 = 0): u32 {
   let nodePtr = getQueryNode2(queryType, arg1, arg2, arg3);
   if (nodePtr == 0) {
      nodePtr = allocQueryNode2(queryType, arg1, arg2, arg3);
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


export class TensorAPI {
  @inline create(type: u32, rank: u32, elementCount: u32): u32 { return ast_createTensor(type, rank, elementCount); }
  @inline setShape(handle: u32, dimIndex: u32, size: u32): void { ast_setTensorShape(handle, dimIndex, size); }
  @inline getShape(handle: u32, dimIndex: u32): u32 { return ast_getTensorShape(handle, dimIndex); }

  @inline setFloat(handle: u32, flatIndex: u32, val: f64): void { ast_setTensorFloat(handle, flatIndex, val); }
  @inline getFloat(handle: u32, flatIndex: u32): f64 { return ast_getTensorFloat(handle, flatIndex); }
  @inline setFloat32(handle: u32, flatIndex: u32, val: f32): void { ast_setTensorFloat32(handle, flatIndex, val); }
  @inline getFloat32(handle: u32, flatIndex: u32): f32 { return ast_getTensorFloat32(handle, flatIndex); }
  @inline setFloat16Raw(handle: u32, flatIndex: u32, val: u16): void { ast_setTensorFloat16Raw(handle, flatIndex, val); }
  @inline getFloat16Raw(handle: u32, flatIndex: u32): u16 { return ast_getTensorFloat16Raw(handle, flatIndex); }
  
  @inline setInt(handle: u32, flatIndex: u32, val: i32): void { ast_setTensorInt(handle, flatIndex, val); }
  @inline getInt(handle: u32, flatIndex: u32): i32 { return ast_getTensorInt(handle, flatIndex); }
  @inline setUint32(handle: u32, flatIndex: u32, val: u32): void { ast_setTensorUint32(handle, flatIndex, val); }
  @inline getUint32(handle: u32, flatIndex: u32): u32 { return ast_getTensorUint32(handle, flatIndex); }
  @inline setInt64(handle: u32, flatIndex: u32, val: i64): void { ast_setTensorInt64(handle, flatIndex, val); }
  @inline getInt64(handle: u32, flatIndex: u32): i64 { return ast_getTensorInt64(handle, flatIndex); }
  @inline setUint64(handle: u32, flatIndex: u32, val: u64): void { ast_setTensorUint64(handle, flatIndex, val); }
  @inline getUint64(handle: u32, flatIndex: u32): u64 { return ast_getTensorUint64(handle, flatIndex); }
  @inline setInt16(handle: u32, flatIndex: u32, val: i16): void { ast_setTensorInt16(handle, flatIndex, val); }
  @inline getInt16(handle: u32, flatIndex: u32): i16 { return ast_getTensorInt16(handle, flatIndex); }
  @inline setUint16(handle: u32, flatIndex: u32, val: u16): void { ast_setTensorUint16(handle, flatIndex, val); }
  @inline getUint16(handle: u32, flatIndex: u32): u16 { return ast_getTensorUint16(handle, flatIndex); }
  @inline setInt8(handle: u32, flatIndex: u32, val: i8): void { ast_setTensorInt8(handle, flatIndex, val); }
  @inline getInt8(handle: u32, flatIndex: u32): i8 { return ast_getTensorInt8(handle, flatIndex); }
  @inline setUint8(handle: u32, flatIndex: u32, val: u8): void { ast_setTensorUint8(handle, flatIndex, val); }
  @inline getUint8(handle: u32, flatIndex: u32): u8 { return ast_getTensorUint8(handle, flatIndex); }
  
  @inline setBool(handle: u32, flatIndex: u32, val: boolean): void { ast_setTensorBool(handle, flatIndex, val); }
  @inline getBool(handle: u32, flatIndex: u32): boolean { return ast_getTensorBool(handle, flatIndex); }
}

export class ModelAPI {
  @inline create(type: u16): u32 { return ast_createNode(type); }
  @inline clone(nodeId: u32, deep: boolean): u32 { return cloneNode(nodeId, deep); }
  @inline compute(nodeId: u32, attrName: u32): u32 { return runQuery(attrName, nodeId); }

  @inline getProperty<T>(nodeId: u32, propId: u32): T { return 0 as T; } // Stubbed until Arena layout finalized
  @inline setProperty<T>(nodeId: u32, propId: u32, value: T): void { } // Stubbed until Arena layout finalized
  
  @inline bind(parentId: u32, nameNodeId: u32, childId: u32): void { ast_bindChildNode(parentId, nameNodeId, childId); }
  @inline resolve(parentId: u32, nameNodeId: u32): u32 { return ast_resolveChildNode(parentId, nameNodeId); }
  @inline bindHash(parentId: u32, hash: u32, childId: u32): void { ast_bindChildHash(parentId, hash, childId); }
  @inline resolveHash(parentId: u32, hash: u32): u32 { return ast_resolveChildByHash(parentId, hash); }

  @inline setFlag(nodeId: u32, flag: u32): void { ast_setNodeFlag(nodeId, flag); }
  @inline clearFlag(nodeId: u32, flag: u32): void { ast_clearNodeFlag(nodeId, flag); }
  @inline hasFlag(nodeId: u32, flag: u32): boolean { return ast_hasNodeFlag(nodeId, flag); }

  @inline getType(nodeId: u32): u16 { return getNodeType(nodeId); }
  @inline getFirstChild(nodeId: u32): u32 { return getNodeFirstChild(nodeId); }
  @inline getNextSibling(nodeId: u32): u32 { return getNodeNextSibling(nodeId); }
  @inline getChildCount(nodeId: u32): u32 { return ast_getChildCount(nodeId); }

  @inline appendChild(parentId: u32, childId: u32): void { ast_appendChild(parentId, childId); }
  @inline insertSibling(targetId: u32, siblingId: u32): void { ast_insertSibling(targetId, siblingId); }
  @inline setFirstChild(parentId: u32, childId: u32): void { setFirstChild(parentId, childId); }
  @inline setNextSibling(nodeId: u32, siblingId: u32): void { setNextSibling(nodeId, siblingId); }
  @inline replaceChild(parentId: u32, oldChildId: u32, newChildId: u32): void { replaceNode(parentId, oldChildId, newChildId); }
  @inline removeChild(parentId: u32, childId: u32): void { ast_removeNode(parentId, childId); }
  @inline getSemanticChildren(nodeId: u32): SemanticCursor { return getSemanticChildren(nodeId); }
}

export class HashAPI {
  @inline init(): u32 { return 2166136261; }
  @inline span(currentHash: u32, span: u64): u32 { return ast_hashSpan(span, currentHash); }
  @inline byte(currentHash: u32, byte: u8): u32 { return ast_hashByte(byte, currentHash); }
  @inline span64(span: u64): u64 {
      let len = (span & 0xFFFFFFFF) as u32;
      let offset = (span >> 32) as u32;
      let buffer = getInputBuffer();
      // Simple cyrb53-like 64-bit hash
      let h1: u64 = 0xdeadbeef ^ (len as u64);
      let h2: u64 = 0x41c6ce57 ^ (len as u64);
      for (let i: u32 = 0; i < len; i++) {
          let c = load<u8>(buffer + offset + i) as u64;
          h1 = Math.imul((h1 ^ c) as i32, 2654435761) as u64;
          h2 = Math.imul((h2 ^ c) as i32, 1597334677) as u64;
      }
      return (h1 << 32) | h2;
  }
}

export class AstAPI {
  @inline textEqualsNode(nodeA: u32, nodeB: u32): boolean {
      if (nodeA == nodeB) return true;
      let lenA = getNodeByteLength(nodeA);
      let lenB = getNodeByteLength(nodeB);
      if (lenA != lenB) return false;
      let offsetA = lsp_findNodeOffset(globalAstRoot, nodeA);
      let offsetB = lsp_findNodeOffset(globalAstRoot, nodeB);
      let buffer = getInputBuffer();
      for (let i: u32 = 0; i < lenA; i++) {
          if (load<u8>(buffer + offsetA + i) != load<u8>(buffer + offsetB + i)) {
              return false;
          }
      }
      return true;
  }

  @inline getChildByFieldId(nodeId: u32, fieldId: i32): u32 { return getChildByFieldId(nodeId, fieldId); }
  @inline getChildrenByFieldId(nodeId: u32, fieldId: i32): FieldCursor { return getChildrenByFieldId(nodeId, fieldId); }
  @inline getAncestors(nodeId: u32, filterType: u16 = 0xFFFF): AncestorCursor { return getAncestors(nodeId, filterType, globalAstRoot); }
  @inline getDescendants(nodeId: u32, filterType: u16 = 0xFFFF): DescendantCursor { return getDescendants(nodeId, filterType); }
  @inline getPathTokens(nodeId: u32): DescendantCursor { return getPathTokens(nodeId); }


  @inline getType(nodeId: u32): u16 { return getNodeType(nodeId); }
  @inline getFirstChild(nodeId: u32): u32 { return getNodeFirstChild(nodeId); }
  @inline getNextSibling(nodeId: u32): u32 { return getNodeNextSibling(nodeId); }
  @inline getChildCount(nodeId: u32): u32 { return ast_getChildCount(nodeId); }

  @inline getRootNode(): u32 { return globalAstRoot; }
  @inline getTextSpan(nodeId: u32, absoluteStart: u32 = 0xFFFFFFFF): u64 { 
    if (absoluteStart == 0xFFFFFFFF) {
        let offset = lsp_findNodeOffset(globalAstRoot, nodeId);
        if (offset >= 0) absoluteStart = offset as u32;
    }
    return ast_getTextSpan(nodeId, absoluteStart); 
  }
  @inline hashSpan(span: u64): u32 { return ast_hashSpan(span); }
}

export class SetAPI {
  @inline create(): u32 { return createSet64(); }
  @inline add(setId: u32, hash: u64): void { changetype<UnmanagedSet64>(setId).add(hash); }
  @inline has(setId: u32, hash: u64): boolean { return changetype<UnmanagedSet64>(setId).has(hash); }
  @inline release(setId: u32): void { changetype<UnmanagedSet64>(setId).release(); }
}

export class MapAPI {
  @inline create(): u32 { return createMap64(); }
  @inline set(mapId: u32, hash: u64, valueId: u32): void { changetype<UnmanagedMap64>(mapId).set(hash, valueId); }
  @inline get(mapId: u32, hash: u64): u32 { return changetype<UnmanagedMap64>(mapId).get(hash); }
  @inline release(mapId: u32): void { changetype<UnmanagedMap64>(mapId).release(); }
}

// --- Typed DB Wrapper for TypeScript IDE Completion ---
class CodeGraph {
    tensor: TensorAPI;
    hash: HashAPI;
    ast: AstAPI;
    model: ModelAPI;
    set: SetAPI;
    map: MapAPI;

    constructor() {
      this.tensor = new TensorAPI();
      this.hash = new HashAPI();
      this.ast = new AstAPI();
      this.model = new ModelAPI();
      this.set = new SetAPI();
      this.map = new MapAPI();
    }

    @inline runQuery(queryType: u32, queryArg: u32): u32 {
        return runQuery(queryType, queryArg);
    }
    
    @inline runHostQuery(queryId: u32, arg1: u32 = 0, arg2: u32 = 0, arg3: u32 = 0): u32 {
        return host_runHostQuery(queryId, arg1, arg2, arg3);
    }
    @inline diagnostic(targetNode: u32, contextNode: u32 = targetNode): void { /* Handled by TS Macro */ }
}
export const graph = new CodeGraph();

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
