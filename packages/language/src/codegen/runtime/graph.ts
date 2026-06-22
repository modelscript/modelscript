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
  ast_setTensorUint8, ast_getTensorUint8,
  ast_setTensorBool, ast_getTensorBool,
  ast_setNodeFlag, ast_clearNodeFlag, ast_hasNodeFlag,
  ast_createList, ast_listLength, ast_bindChildNode, ast_resolveChildNode, ast_bindChildHash, ast_resolveChildByHash,
  ast_removeNode, ast_getChildCount
} from "./arena";
import { getChildByFieldId, getChildrenByFieldId, FieldCursor } from "./engine";
import { FieldId, SyntaxType } from "./parser";
import { lsp_allocDiagnostic } from "./lsp";

// Query Node (24 bytes):
// +0: queryKey (u32) - (queryType << 16) | argId
// +4: revision (u32)
// +8: value (u32)
// +12: firstDependencyEdge (u32)
// +16: firstSubscriberEdge (u32)
// +20: nextHashBucketPtr (u32) - collision resolution

// Edge Node (8 bytes):
// +0: targetQueryNodePtr (u32)
// +4: nextEdgePtr (u32)

export let queryArenaOffset: u32 = 0;
export let queryArenaEnd: u32 = 0;
export let queryHashTableOffset: u32 = 0;
export let fqnHashTableOffset: u32 = 0;
export let dirtyFilesBitsetOffset: u32 = 0;
const HASH_TABLE_CAPACITY = 4096;
const FQN_HASH_TABLE_CAPACITY = 4096;

// Diagnostic Node (16 bytes):
// +0: startByte (u32)
// +4: endByte (u32)
// +8: argPtr (u32) - Pointer to WASM string or extra u32 data
// +12: nextDiagPtr (u32)

export let diagArenaOffset: u32 = 0;
export let diagArenaEnd: u32 = 0;
export let firstDiagnostic: u32 = 0;
export let lastDiagnostic: u32 = 0;

export function initQueryArena(): void {
  // Allocate hash table
  queryHashTableOffset = heap.alloc(HASH_TABLE_CAPACITY * 4) as u32;
  
  // Allocate FQN hash table
  fqnHashTableOffset = heap.alloc(FQN_HASH_TABLE_CAPACITY * 4) as u32;
  
  // Allocate 128-byte dirty files bitset (for up to 1024 file IDs)
  dirtyFilesBitsetOffset = heap.alloc(128) as u32;
  
  resetQueryArena();
}

export function resetQueryArena(): void {
  if (queryHashTableOffset != 0) {
      memory.fill(queryHashTableOffset as usize, 0, HASH_TABLE_CAPACITY * 4);
  }
  if (fqnHashTableOffset != 0) {
      memory.fill(fqnHashTableOffset as usize, 0, FQN_HASH_TABLE_CAPACITY * 4);
  }
  if (dirtyFilesBitsetOffset != 0) {
      memory.fill(dirtyFilesBitsetOffset as usize, 0, 128);
  }
}

export function clearDiagnostics(): void {
  firstDiagnostic = 0;
  lastDiagnostic = 0;
}

export function clearDirtyFilesBitset(): void {
  if (dirtyFilesBitsetOffset == 0) return;
  for (let i = 0; i < 32; i++) {
     store<u32>(dirtyFilesBitsetOffset + i * 4, 0, 0);
  }
}

export function allocDiagnostic(startByte: u32, endByte: u32, argPtr: u32, nextPtr: u32): u32 {
  let ptr = heap.alloc(16) as u32;
  store<u32>(ptr, startByte, 0);
  store<u32>(ptr + 4, endByte, 0);
  store<u32>(ptr + 8, argPtr, 0);
  store<u32>(ptr + 12, nextPtr, 0);
  
  // Link globally
  if (firstDiagnostic == 0) {
    firstDiagnostic = ptr;
  } else {
    store<u32>(lastDiagnostic + 12, ptr, 0);
  }
  lastDiagnostic = ptr;
  
  return ptr;
}

// Removed legacy 1-key functions: hashQueryKey, getQueryNode, allocQueryNode

export function allocEdge(targetPtr: u32, nextPtr: u32): u32 {
  let ptr = heap.alloc(8) as u32;
  store<u32>(ptr, targetPtr, 0);
  store<u32>(ptr + 4, nextPtr, 0);
  return ptr;
}

export function exportSymbol(fqnHash: u32, nodeId: u32): void {
  let idx = fqnHash & (FQN_HASH_TABLE_CAPACITY - 1);
  let ptr = heap.alloc(12) as u32;
  store<u32>(ptr, fqnHash, 0);
  store<u32>(ptr + 4, nodeId, 0);
  
  let head = load<u32>(fqnHashTableOffset + idx * 4, 0);
  store<u32>(ptr + 8, head, 0); // next
  store<u32>(fqnHashTableOffset + idx * 4, ptr, 0);
}

export function resolveFqnSymbol(fqnHash: u32): u32 {
  let idx = fqnHash & (FQN_HASH_TABLE_CAPACITY - 1);
  let ptr = load<u32>(fqnHashTableOffset + idx * 4, 0);
  while (ptr != 0) {
     if (load<u32>(ptr, 0) == fqnHash) return load<u32>(ptr + 4, 0);
     ptr = load<u32>(ptr + 8, 0);
  }
  return 0;
}

export let scopedImportHead: u32 = 0;

export function registerScopedImport(scopeId: u32, moduleHash: u32, visibility: u8 = 0): void {
  // Phase 6B: Added visibility (0=public, 1=private)
  // Allocate 16 bytes to fit u8 properly with alignment, or just 12 and pack. We'll use 16.
  let ptr = heap.alloc(16) as u32;
  store<u32>(ptr, scopeId, 0);
  store<u32>(ptr + 4, moduleHash, 0);
  store<u32>(ptr + 8, scopedImportHead, 0);
  store<u8>(ptr + 12, visibility, 0);
  scopedImportHead = ptr;
}

// =====================================================================
// Section 2: Query Execution & Dependency Tracking (v2 — Full 32-bit Keys)
// =====================================================================

// Query Node Layout (28 bytes):
// +0:  queryType (u32)   — discriminator for the compute function
// +4:  queryArg  (u32)   — full 32-bit argument (node pointer, etc.)
// +8:  revision  (u32)   — last-computed revision
// +12: value     (u32)   — cached result
// +16: firstDep  (u32)   — linked list of dependency edges
// +20: firstSub  (u32)   — linked list of subscriber edges
// +24: nextHash  (u32)   — hash bucket chain

// Combines queryType and queryArg into a hash table index.
// The full (queryType, queryArg) pair is stored in the node for exact matching.
function combineQueryKey(queryType: u32, queryArg: u32): u32 {
   // FNV-1a style mixing of both values
   let h: u32 = 0x811c9dc5;
   h ^= queryType;
   h = (h * 0x01000193) >>> 0;
   h ^= queryArg;
   h = (h * 0x01000193) >>> 0;
   h ^= (queryType >> 16);
   h = (h * 0x01000193) >>> 0;
   h ^= (queryArg >> 16);
   h = (h * 0x01000193) >>> 0;
   return h & (HASH_TABLE_CAPACITY - 1);
}

export function getQueryNode2(queryType: u32, queryArg: u32): u32 {
   let idx = combineQueryKey(queryType, queryArg);
   let ptr = load<u32>(queryHashTableOffset + idx * 4, 0);
   while (ptr != 0) {
      if (load<u32>(ptr, 0) == queryType && load<u32>(ptr + 4, 0) == queryArg) return ptr;
      ptr = load<u32>(ptr + 24, 0); // nextHashBucketPtr
   }
   return 0;
}

export function allocQueryNode2(queryType: u32, queryArg: u32): u32 {
  let ptr = heap.alloc(28) as u32;
  store<u32>(ptr, queryType, 0);
  store<u32>(ptr + 4, queryArg, 0);
  store<u32>(ptr + 8, 0, 0);  // revision
  store<u32>(ptr + 12, 0, 0); // value
  store<u32>(ptr + 16, 0, 0); // firstDependency
  store<u32>(ptr + 20, 0, 0); // firstSubscriber
  store<u32>(ptr + 24, 0, 0); // nextHashBucketPtr
  
  let idx = combineQueryKey(queryType, queryArg);
  let head = load<u32>(queryHashTableOffset + idx * 4, 0);
  store<u32>(ptr + 24, head, 0);
  store<u32>(queryHashTableOffset + idx * 4, ptr, 0);
  
  return ptr;
}

export let globalRevision: u32 = 1;

export function invalidateNode(nodePtr: u32): void {
  if (nodePtr == 0) return;
  
  let currentRev = load<u32>(nodePtr + 8, 0);
  if (currentRev == 0) return; // 0 means already dirty/invalidated
  
  store<u32>(nodePtr + 8, 0, 0); // Mark as dirty
  
  // A PARSE query (queryType == 0) affects the dirty file bitset
  let queryType = load<u32>(nodePtr, 0);
  if (queryType == 0 && dirtyFilesBitsetOffset != 0) {
      let fileId = load<u32>(nodePtr + 4, 0);
      if (fileId < 1024) {
          let wordIdx = fileId >> 5;
          let bitIdx = fileId & 31;
          let ptr = dirtyFilesBitsetOffset + (wordIdx << 2);
          let current = load<u32>(ptr, 0);
          store<u32>(ptr, current | (1 << bitIdx), 0);
      }
  }

  let edgePtr = load<u32>(nodePtr + 20, 0); // firstSubscriberEdge
  while (edgePtr != 0) {
     let targetPtr = load<u32>(edgePtr, 0);
     invalidateNode(targetPtr);
     edgePtr = load<u32>(edgePtr + 4, 0);
  }
}

export function incrementGlobalRevision(): void {
  globalRevision++;
}

// 1024 stack depth max
export const activeQueryStack = new Uint32Array(1024);
export let activeQueryDepth: i32 = 0;

export function addEdgeIfMissing(headPtrOffset: u32, targetPtr: u32): void {
    let head = load<u32>(headPtrOffset, 0);
    let curr = head;
    while (curr != 0) {
        if (load<u32>(curr, 0) == targetPtr) return;
        curr = load<u32>(curr + 4, 0);
    }
    let newEdge = allocEdge(targetPtr, head);
    store<u32>(headPtrOffset, newEdge, 0);
}

export function runQuery(queryType: u32, queryArg: u32): u32 {
   let nodePtr = getQueryNode2(queryType, queryArg);
   if (nodePtr == 0) {
      nodePtr = allocQueryNode2(queryType, queryArg);
   } else {
      let rev = load<u32>(nodePtr + 8, 0);
      if (rev > 0 && rev == globalRevision) return load<u32>(nodePtr + 12, 0);
   }
   
   if (activeQueryDepth > 0) {
      let parentPtr = activeQueryStack[activeQueryDepth - 1];
      if (parentPtr != 0) {
        // Link parent -> dependency (child)
        addEdgeIfMissing(parentPtr + 16, nodePtr);
        
        // Link child -> subscriber (parent)
        addEdgeIfMissing(nodePtr + 20, parentPtr);
      }
   }
   
   // Push nodePtr directly onto stack
   activeQueryStack[activeQueryDepth++] = nodePtr;
   let result: u32 = 0;
   
   if (queryType == 0) { // PARSE
      // For parse, queryArg is fileId. 
      // result = parse();
   }
   __GRAPH_SWITCH_CODE__
   
   activeQueryDepth--;
   store<u32>(nodePtr + 12, result, 0);
   store<u32>(nodePtr + 8, globalRevision, 0);
   
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
  @inline create(type: u16): u32 { return createNode(type); }
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
}

export class HashAPI {
  @inline init(): u32 { return 2166136261; }
  @inline span(currentHash: u32, span: u64): u32 { return ast_hashSpan(span, currentHash); }
  @inline byte(currentHash: u32, byte: u8): u32 { return ast_hashByte(byte, currentHash); }
}

export class AstAPI {
  @inline getChildByFieldId(nodeId: u32, fieldId: i32): u32 { return getChildByFieldId(nodeId, fieldId); }
  @inline getChildrenByFieldId(nodeId: u32, fieldId: i32): FieldCursor { return getChildrenByFieldId(nodeId, fieldId); }

  @inline getType(nodeId: u32): u16 { return getNodeType(nodeId); }
  @inline getFirstChild(nodeId: u32): u32 { return getNodeFirstChild(nodeId); }
  @inline getNextSibling(nodeId: u32): u32 { return getNodeNextSibling(nodeId); }
  @inline getChildCount(nodeId: u32): u32 { return ast_getChildCount(nodeId); }

  @inline getTextSpan(nodeId: u32, absoluteStart: u32 = 0xFFFFFFFF): u64 { return ast_getTextSpan(nodeId, absoluteStart); }
}

// --- Typed DB Wrapper for TypeScript IDE Completion ---
class CodeGraph {
    tensor: TensorAPI;
    hash: HashAPI;
    ast: AstAPI;
    model: ModelAPI;

    constructor() {
      this.tensor = new TensorAPI();
      this.hash = new HashAPI();
      this.ast = new AstAPI();
      this.model = new ModelAPI();
    }

    @inline runQuery(queryType: u32, queryArg: u32): u32 {
        return runQuery(queryType, queryArg);
    }
    @inline diagnostic(targetNode: u32, contextNode: u32 = targetNode): void { /* Handled by TS Macro */ }
}
export const graph = new CodeGraph();

export function packOutline(nameNode: u32, children: boolean): u32 {
    if (nameNode == 0) return 0;
    // nameNode is a 16-byte aligned arena pointer, so lowest 4 bits are always 0.
    // We pack 'children' flag into the lowest bit (bit 0).
    return nameNode | (children ? 1 : 0);
}
