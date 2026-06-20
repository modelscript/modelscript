// True CodeGraph Incremental Database and LSP Bridge
// Pure Arena Implementation (Zero-GC, Integer-based)
import { 
  getNodeType, getNodeFirstChild, getNodeNextSibling, 
  ast_createNode, ast_appendChild, ast_insertSibling, 
  ast_setLiteralString, ast_setLiteralFloat, ast_setLiteralInt,
  ast_getLiteralString, ast_getLiteralFloat, ast_getLiteralInt,
  cloneNode, replaceNode, setFirstChild, setNextSibling,
  ast_createTensor1D, ast_createTensor2D, ast_createTensor3D,
  ast_setTensorFloat, ast_getTensorFloat,
  ast_setTensorFloat32, ast_getTensorFloat32,
  ast_setTensorFloat16Raw, ast_getTensorFloat16Raw,
  ast_setTensorInt, ast_getTensorInt,
  ast_setTensorInt64, ast_getTensorInt64,
  ast_setTensorInt16, ast_getTensorInt16,
  ast_setTensorBool, ast_getTensorBool,
  ast_setLiteralTensor, ast_getLiteralTensor,
  ast_setNodeFlag, ast_clearNodeFlag, ast_hasNodeFlag,
  ast_setLiteralNodeRef, ast_getLiteralNodeRef, ast_getProvenance
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

function hashQueryKey(key: u32): u32 {
   let x = key;
   x = ((x >> 16) ^ x) * 0x45d9f3b;
   x = ((x >> 16) ^ x) * 0x45d9f3b;
   x = (x >> 16) ^ x;
   return x & (HASH_TABLE_CAPACITY - 1);
}

export function getQueryNode(queryKey: u32): u32 {
   let idx = hashQueryKey(queryKey);
   let ptr = load<u32>(queryHashTableOffset + idx * 4, 0);
   while (ptr != 0) {
      if (load<u32>(ptr, 0) == queryKey) return ptr;
      ptr = load<u32>(ptr + 20, 0); // nextHashBucketPtr
   }
   return 0;
}

export function allocQueryNode(queryKey: u32): u32 {
  let ptr = heap.alloc(24) as u32;
  store<u32>(ptr, queryKey, 0);
  store<u32>(ptr + 4, 0, 0); // revision
  store<u32>(ptr + 8, 0, 0); // value
  store<u32>(ptr + 12, 0, 0); // firstDependency
  store<u32>(ptr + 16, 0, 0); // firstSubscriber
  store<u32>(ptr + 20, 0, 0); // nextHashBucketPtr
  
  // Insert into hash table
  let idx = hashQueryKey(queryKey);
  let head = load<u32>(queryHashTableOffset + idx * 4, 0);
  store<u32>(ptr + 20, head, 0);
  store<u32>(queryHashTableOffset + idx * 4, ptr, 0);
  
  return ptr;
}

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

export let globalRevision: u32 = 0;

export function invalidateQuery(queryKey: u32): void {
  // Note: Original invalidateQuery requires re-implementation 
  // if you want to support the 2-field key fully.
  // Using simplified logic here as placeholder.
  let queryType = queryKey >>> 16;
  let argId = queryKey & 0xFFFF;
  let fileId = (queryType == 0) ? argId : (argId >> 10);
  
  if (fileId < 1024 && dirtyFilesBitsetOffset != 0) {
      let wordIdx = fileId >> 5;
      let bitIdx = fileId & 31;
      let ptr = dirtyFilesBitsetOffset + (wordIdx << 2);
      let current = load<u32>(ptr, 0);
      store<u32>(ptr, current | (1 << bitIdx), 0);
  }

  let nodePtr = getQueryNode(queryKey);
  if (nodePtr == 0) return;
  
  store<u32>(nodePtr + 4, globalRevision, 0); // update revision
  
  let edgePtr = load<u32>(nodePtr + 16, 0); // firstSubscriberEdge
  while (edgePtr != 0) {
     let targetPtr = load<u32>(edgePtr, 0);
     let targetKey = load<u32>(targetPtr, 0);
     invalidateQuery(targetKey);
     edgePtr = load<u32>(edgePtr + 4, 0);
  }
}

// 1024 stack depth max
export const activeQueryStack = new Uint32Array(1024);
export let activeQueryDepth: i32 = 0;

export function runQuery(queryType: u32, queryArg: u32): u32 {
   // Use the 2-field key system that preserves full 32-bit argument range
   let nodePtr = getQueryNode2(queryType, queryArg);
   if (nodePtr == 0) {
      nodePtr = allocQueryNode2(queryType, queryArg);
   } else {
      let rev = load<u32>(nodePtr + 8, 0);
      if (rev == globalRevision) return load<u32>(nodePtr + 12, 0);
   }
   
   if (activeQueryDepth > 0) {
      let parentQueryKey = activeQueryStack[activeQueryDepth - 1];
      // For now, parent tracking uses the old single-key system for the stack
      // In a future refactor, the stack should store nodePtr directly
      let parentPtr = getQueryNode(parentQueryKey);
      
      if (parentPtr != 0) {
        // Link parent -> dependency (child)
        let pDepHead = load<u32>(parentPtr + 12, 0);
        let newDepEdge = allocEdge(nodePtr, pDepHead);
        store<u32>(parentPtr + 12, newDepEdge, 0);
        
        // Link child -> subscriber (parent)
        let cSubHead = load<u32>(nodePtr + 20, 0);
        let newSubEdge = allocEdge(parentPtr, cSubHead);
        store<u32>(nodePtr + 20, newSubEdge, 0);
      }
   }
   
   // Push onto stack using packed key for backward compat with invalidateQuery
   let queryKey = (queryType << 16) | (queryArg & 0xFFFF);
   activeQueryStack[activeQueryDepth++] = queryKey;
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

// --- Typed DB Wrapper for TypeScript IDE Completion ---
class CodeGraph {
    @inline getNodeType(nodeId: u32): u16 { return getNodeType(nodeId); }
    @inline getNodeFirstChild(nodeId: u32): u32 { return getNodeFirstChild(nodeId); }
    @inline getNodeNextSibling(nodeId: u32): u32 { return getNodeNextSibling(nodeId); }
    @inline runQuery(queryType: u32, queryArg: u32): u32 {
        return runQuery(queryType, queryArg);
    }
    @inline getChildByFieldId(nodeId: u32, fieldId: i32): u32 {
        return getChildByFieldId(nodeId, fieldId);
    }
    @inline getChildrenByFieldId(nodeId: u32, fieldId: i32): FieldCursor {
        return getChildrenByFieldId(nodeId, fieldId);
    }
    @inline createNode(type: u16): u32 { return ast_createNode(type); }
    @inline cloneNode(nodeId: u32, deep: boolean): u32 { return cloneNode(nodeId, deep); }
    @inline appendChild(parentId: u32, childId: u32): void { ast_appendChild(parentId, childId); }
    @inline insertSibling(targetId: u32, siblingId: u32): void { ast_insertSibling(targetId, siblingId); }
    @inline setFirstChild(parentId: u32, childId: u32): void { setFirstChild(parentId, childId); }
    @inline setNextSibling(nodeId: u32, siblingId: u32): void { setNextSibling(nodeId, siblingId); }
    @inline replaceNode(parentId: u32, oldChildId: u32, newChildId: u32): void { replaceNode(parentId, oldChildId, newChildId); }
    @inline setLiteralString(nodeId: u32, value: string): void { ast_setLiteralString(nodeId, value); }
    @inline setLiteralFloat(nodeId: u32, value: f64): void { ast_setLiteralFloat(nodeId, value); }
    @inline setLiteralInt(nodeId: u32, value: i32): void { ast_setLiteralInt(nodeId, value); }
    @inline getLiteralString(nodeId: u32, absoluteStart: u32 = 0xFFFFFFFF): string { return ast_getLiteralString(nodeId, absoluteStart); }
    @inline getLiteralFloat(nodeId: u32, absoluteStart: u32 = 0xFFFFFFFF): f64 { return ast_getLiteralFloat(nodeId, absoluteStart); }
    @inline getLiteralInt(nodeId: u32, absoluteStart: u32 = 0xFFFFFFFF): i32 { return ast_getLiteralInt(nodeId, absoluteStart); }
    
    @inline setLiteralNodeRef(nodeId: u32, targetId: u32): void { ast_setLiteralNodeRef(nodeId, targetId); }
    @inline getLiteralNodeRef(nodeId: u32): u32 { return ast_getLiteralNodeRef(nodeId); }
    
    @inline setNodeFlag(nodeId: u32, flag: u32): void { ast_setNodeFlag(nodeId, flag); }
    @inline clearNodeFlag(nodeId: u32, flag: u32): void { ast_clearNodeFlag(nodeId, flag); }
    @inline hasNodeFlag(nodeId: u32, flag: u32): boolean { return ast_hasNodeFlag(nodeId, flag); }
    
    @inline getProvenance(nodeId: u32): u32 { return ast_getProvenance(nodeId); }

    @inline createTensor1D(type: u32, size: u32): u32 { return ast_createTensor1D(type, size); }
    @inline createTensor2D(type: u32, rows: u32, cols: u32): u32 { return ast_createTensor2D(type, rows, cols); }
    @inline createTensor3D(type: u32, d0: u32, d1: u32, d2: u32): u32 { return ast_createTensor3D(type, d0, d1, d2); }
    @inline setTensorFloat(handle: u32, flatIndex: u32, val: f64): void { ast_setTensorFloat(handle, flatIndex, val); }
    @inline getTensorFloat(handle: u32, flatIndex: u32): f64 { return ast_getTensorFloat(handle, flatIndex); }
    @inline setTensorFloat32(handle: u32, flatIndex: u32, val: f32): void { ast_setTensorFloat32(handle, flatIndex, val); }
    @inline getTensorFloat32(handle: u32, flatIndex: u32): f32 { return ast_getTensorFloat32(handle, flatIndex); }
    @inline setTensorFloat16Raw(handle: u32, flatIndex: u32, val: u16): void { ast_setTensorFloat16Raw(handle, flatIndex, val); }
    @inline getTensorFloat16Raw(handle: u32, flatIndex: u32): u16 { return ast_getTensorFloat16Raw(handle, flatIndex); }
    
    @inline setTensorInt(handle: u32, flatIndex: u32, val: i32): void { ast_setTensorInt(handle, flatIndex, val); }
    @inline getTensorInt(handle: u32, flatIndex: u32): i32 { return ast_getTensorInt(handle, flatIndex); }
    @inline setTensorInt64(handle: u32, flatIndex: u32, val: i64): void { ast_setTensorInt64(handle, flatIndex, val); }
    @inline getTensorInt64(handle: u32, flatIndex: u32): i64 { return ast_getTensorInt64(handle, flatIndex); }
    @inline setTensorInt16(handle: u32, flatIndex: u32, val: i16): void { ast_setTensorInt16(handle, flatIndex, val); }
    @inline getTensorInt16(handle: u32, flatIndex: u32): i16 { return ast_getTensorInt16(handle, flatIndex); }
    
    @inline setTensorBool(handle: u32, flatIndex: u32, val: boolean): void { ast_setTensorBool(handle, flatIndex, val); }
    @inline getTensorBool(handle: u32, flatIndex: u32): boolean { return ast_getTensorBool(handle, flatIndex); }
    @inline setLiteralTensor(nodeId: u32, handle: u32): void { ast_setLiteralTensor(nodeId, handle); }
    @inline getLiteralTensor(nodeId: u32): u32 { return ast_getLiteralTensor(nodeId); }
}
export const graph = new CodeGraph();

export function packOutline(nameNode: u32, children: boolean): u32 {
    if (nameNode == 0) return 0;
    // nameNode is a 16-byte aligned arena pointer, so lowest 4 bits are always 0.
    // We pack 'children' flag into the lowest bit (bit 0).
    return nameNode | (children ? 1 : 0);
}
