import { UnmanagedUint32Array, ChunkedUint32Array, createChunkedUint32Array } from "../core/array";
import {
  atomicChunkAlloc,
  FLAG_LSP_TRAVERSED,
  getNodeByteLength,
  getNodeFirstChild,
  getNodeFlags,
  getNodeNextSibling,
  getNodePadding,
  getNodeType,
  setNodeFlags,
  ast_getTextSpan,
  ast_hashSpan,
  cacheNodeStrings,
  ASTNode,
  FLAG_HAS_ERROR,
  FLAG_INVISIBLE,
  FLAG_IS_TAINED,
  FLAG_IS_INSERTED,
  FLAG_IS_LIST,
  FLAG_EXTRACTED,
  FLAG_IS_SHARED,
  getInputBuffer,
  debugLog,
  registerRoot,
  dropRoot,
  cloneNode,
  getNodeMerkleHash,
  S,
} from "../arena";
import { NODE_TYPE_ERROR, errorCount, t_errorStarts, t_errorEnds, t_errorArg0, t_errorArg1, t_errorArg2, t_errorArg3 } from "./engine";
import { inputLength, inputEncoding } from "../parser";
import { UnmanagedMap64To64, createMap64To64, UnmanagedMap64 } from "../core/hashmap";
import { stub_getDefinition, stub_getBinaryBuffer } from "../indexing/stub";

@inline
export function getEncodingStep(): u32 {
  return inputEncoding == 0 ? 1 : (inputEncoding <= 2 ? 2 : 4);
}

// --- LSP Endpoints ---

let t_lspVisitedNodes: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspVisitedCount: u32 = 0;
let t_lspVisitedCapacity: u32 = 0;

let t_lspTraverseStack: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspOffsetStack: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspParentStack: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspStackCapacity: u32 = 0;

let t_lspFindTraverseStack: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspFindOffsetStack: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspFindStackCapacity: u32 = 0;

export let globalAstRoot: u32 = 0;
export let globalEnclosingClassRoot: u32 = 0;
export let globalEnclosingClassNode: u32 = 0;

let t_nodeOffsetMap: UnmanagedMap64 = changetype<UnmanagedMap64>(0);
let t_nodeOffsetMapAstRoot: u32 = 0;

function ensureNodeOffsetMap(): void {
  if (changetype<usize>(t_nodeOffsetMap) == 0) {
    t_nodeOffsetMap = changetype<UnmanagedMap64>(UnmanagedMap64.create(16384));
  }
}

export function clearNodeOffsetCache(): void {
  if (changetype<usize>(t_nodeOffsetMap) != 0) {
    t_nodeOffsetMap.clear();
  }
  t_nodeOffsetMapAstRoot = 0;
}

// --- Multi-File Document Registry ---
let t_documentRoots: UnmanagedMap64To64 = changetype<UnmanagedMap64To64>(0);

export function lsp_registerDocument(fileId: u32, astRoot: u32): void {
  if (changetype<usize>(t_documentRoots) == 0) {
    t_documentRoots = changetype<UnmanagedMap64To64>(createMap64To64());
  }
  t_documentRoots.set(fileId as u64, astRoot as u64);
  if (globalAstRoot == 0) {
    globalAstRoot = astRoot;
  }
  
  // Cache all leaf node strings into the stringArena for lexical multi-file fallback
  cacheNodeStrings(astRoot, 0);
  registerRoot(astRoot);
  indexDocumentSymbolsForReferences(fileId, astRoot);
  lsp_invalidateCache();
}

export function lsp_unregisterDocument(fileId: u32): void {
  if (changetype<usize>(t_documentRoots) != 0) {
    let oldRoot = t_documentRoots.get(fileId as u64) as u32;
    if (oldRoot != 0) dropRoot(oldRoot);
    t_documentRoots.set(fileId as u64, 0 as u64);
  }
  lsp_invalidateCache();
}

/**
 * Evicts a document's full AST from the Tier 2 arena while preserving Tier 1 stubs.
 */
export function lsp_evictDocumentAst(fileId: u32): void {
  if (changetype<usize>(t_documentRoots) != 0 && fileId != 0) {
    let oldRoot = t_documentRoots.get(fileId as u64) as u32;
    if (oldRoot != 0) {
      dropRoot(oldRoot);
      t_documentRoots.set(fileId as u64, 0 as u64);
    }
  }
  lsp_invalidateCache();
}

export function lsp_clearDocuments(): void {
  t_documentRoots = changetype<UnmanagedMap64To64>(createMap64To64());
  clearNodeOffsetCache();
  t_refIndexTotalTokens = 0;
  lsp_invalidateCache();
}

export function lsp_getDocumentRoot(fileId: u32): u32 {
  if (changetype<usize>(t_documentRoots) == 0) return globalAstRoot;
  let root = t_documentRoots.get(fileId as u64) as u32;
  return root != 0 ? root : globalAstRoot;
}

// --- Binary Serialization ---
let t_lspBinaryBuffer: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
let t_lspFlatBinaryBuffer: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let t_lspFlatBinaryBufferPtr: u32 = 0;
let t_lspFlatBinaryCapacity: u32 = 0;

// --- L3 Caching for Folding Ranges & Document Symbols ---
let t_cachedFoldingRoot: u32 = 0;
let t_cachedFoldingCount: u32 = 0;
let t_cachedFoldingBuffer: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);

let t_cachedSymbolsRoot: u32 = 0;
let t_cachedSymbolsCount: u32 = 0;
let t_cachedSymbolsBuffer: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);

export function lsp_invalidateCache(): void {
  t_cachedFoldingRoot = 0;
  t_cachedFoldingCount = 0;
  t_cachedSymbolsRoot = 0;
  t_cachedSymbolsCount = 0;
}

// --- L5 Inverted Symbol Index for References ---
let t_refIndexNodes: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_refIndexTotalTokens: u32 = 0;
let t_refIndexCapacity: u32 = 0;

function ensureRefIndexBuffer(requiredCapacity: u32): void {
  if (requiredCapacity > t_refIndexCapacity) {
    let newCap: u32 = t_refIndexCapacity == 0 ? 4096 : (t_refIndexCapacity * 2);
    while (newCap < requiredCapacity) newCap *= 2;
    let newPtr = atomicChunkAlloc(newCap * 4);
    if (t_refIndexTotalTokens > 0 && changetype<usize>(t_refIndexNodes) != 0) {
      memory.copy(newPtr, changetype<usize>(t_refIndexNodes), t_refIndexTotalTokens * 4);
    }
    t_refIndexNodes = changetype<UnmanagedUint32Array>(newPtr);
    t_refIndexCapacity = newCap;
  }
}

export function indexDocumentSymbolsForReferences(fileId: u32, rootNode: u32): void {
  if (rootNode == 0) return;
  
  ensureLspBuffers();
  let stackTop: u32 = 0;
  ensureTraverseStack(1);
  t_lspTraverseStack.set(0, rootNode);
  t_lspOffsetStack.set(0, getNodeLeadingPad(rootNode));
  stackTop++;

  while (stackTop > 0) {
    stackTop--;
    let current = t_lspTraverseStack.get(stackTop);
    let offset = t_lspOffsetStack.get(stackTop);

    let child = getNodeFirstChild(current);
    if (child == 0) {
      let len = getNodeByteLength(current);
      if (len > 0) {
        let span = ast_getTextSpan(current, offset);
        let hash = ast_hashSpan(span);
        ensureRefIndexBuffer(t_refIndexTotalTokens + 5);
        let idx = t_refIndexTotalTokens;
        t_refIndexNodes[idx] = fileId;
        t_refIndexNodes[idx + 1] = hash;
        t_refIndexNodes[idx + 2] = offset;
        t_refIndexNodes[idx + 3] = len;
        t_refIndexNodes[idx + 4] = current;
        t_refIndexTotalTokens += 5;
      }
    } else {
      let childCount: u32 = 0;
      let countChild = child;
      while (countChild != 0) {
        childCount++;
        countChild = getNodeNextSibling(countChild);
      }
      ensureTraverseStack(stackTop + childCount);
      let currOffset = offset;
      let currChildIdx: i32 = 0;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let lenVal = getNodeByteLength(child);
        if (currChildIdx > 0) {
          currOffset += padVal;
        }
        let childStart = currOffset;
        let slot = stackTop + (childCount - 1 - currChildIdx);
        t_lspTraverseStack[slot] = child;
        t_lspOffsetStack[slot] = childStart;
        currOffset = childStart + lenVal;
        currChildIdx++;
        child = getNodeNextSibling(child);
      }
      stackTop += childCount;
    }
  }
}

export function lsp_getBinaryBuffer(): u32 {
  if (t_lspFlatBinaryBufferPtr == 0) {
    let newCap: u32 = 50000;
    let newPtr = atomicChunkAlloc(newCap * 4);
    t_lspFlatBinaryBuffer = changetype<UnmanagedUint32Array>(newPtr);
    t_lspFlatBinaryBufferPtr = newPtr as u32;
    t_lspFlatBinaryCapacity = newCap;
  }
  return t_lspFlatBinaryBufferPtr;
}
export function lsp_getBinaryLength(): u32 {
  if (changetype<usize>(t_lspBinaryBuffer) == 0) return 0;
  return t_lspBinaryBuffer.length;
}

/**
 * Allocates an unmanaged diagnostic token into the binary buffer for LSP transfer.
 * Includes logic to merge adjacent or overlapping diagnostics with the same `lintId`.
 * If the buffer capacity is exceeded, it dynamically chunks a larger `t_lspBinaryBuffer`.
 */
export function lsp_allocDiagnostic(start: u32, end: u32, lintId: u32, arg0: u32 = 0, arg1: u32 = 0, arg2: u32 = 0, arg3: u32 = 0): void {
  let bufLen = t_lspBinaryBuffer.length;
  if (bufLen >= 10000 * 7) {
    // LSP2 fix: emit a meta-diagnostic once when limit is reached
    if (bufLen == 10000 * 7) {
      t_lspBinaryBuffer.push(0);
      t_lspBinaryBuffer.push(0);
      t_lspBinaryBuffer.push(0x7ffe); // Meta lint ID: diagnostics truncated
      t_lspBinaryBuffer.push(0);
      t_lspBinaryBuffer.push(0);
      t_lspBinaryBuffer.push(0);
      t_lspBinaryBuffer.push(0);
    }
    return;
  }

  // LSP1 fix: check last 4 entries for deduplication
  let entriesToCheck: u32 = (bufLen / 7) > 4 ? 4 : (bufLen / 7);
  for (let i: u32 = 1; i <= entriesToCheck; i++) {
    let offset = bufLen - i * 7;
    let prevStart = t_lspBinaryBuffer[offset];
    let prevEnd = t_lspBinaryBuffer[offset + 1];
    let prevLintId = t_lspBinaryBuffer[offset + 2];
    if (prevStart == start && prevEnd == end && prevLintId == lintId) return;
  }

  t_lspBinaryBuffer.push(start);
  t_lspBinaryBuffer.push(end);
  t_lspBinaryBuffer.push(lintId);
  t_lspBinaryBuffer.push(arg0);
  t_lspBinaryBuffer.push(arg1);
  t_lspBinaryBuffer.push(arg2);
  t_lspBinaryBuffer.push(arg3);
}

function ensureLspBuffers(): void {
  if (changetype<usize>(t_lspTraverseStack) == 0) {
    t_lspBinaryBuffer = createChunkedUint32Array(50000);
    t_lspStackCapacity = 50000;
    t_lspTraverseStack = changetype<UnmanagedUint32Array>(atomicChunkAlloc(t_lspStackCapacity * 4));
    t_lspOffsetStack = changetype<UnmanagedUint32Array>(atomicChunkAlloc(t_lspStackCapacity * 4));
    t_lspParentStack = changetype<UnmanagedUint32Array>(atomicChunkAlloc(t_lspStackCapacity * 4));

    t_lspVisitedCapacity = 50000;
    t_lspVisitedNodes = changetype<UnmanagedUint32Array>(atomicChunkAlloc(t_lspVisitedCapacity * 4));

    t_lspFindStackCapacity = 50000;
    t_lspFindTraverseStack = changetype<UnmanagedUint32Array>(atomicChunkAlloc(t_lspFindStackCapacity * 4));
    t_lspFindOffsetStack = changetype<UnmanagedUint32Array>(atomicChunkAlloc(t_lspFindStackCapacity * 4));
  } else {
    lsp_clearVisited();
    t_lspBinaryBuffer.clear();
  }
}

function flushBinaryBuffer(): void {
  let len = t_lspBinaryBuffer.length;
  if (len > t_lspFlatBinaryCapacity) {
    let newCap = t_lspFlatBinaryCapacity;
    if (newCap == 0) newCap = 50000;
    while (newCap < len) newCap *= 2;
    let newPtr = atomicChunkAlloc(newCap * 4);
    t_lspFlatBinaryBuffer = changetype<UnmanagedUint32Array>(newPtr);
    t_lspFlatBinaryBufferPtr = newPtr as u32;
    t_lspFlatBinaryCapacity = newCap;
  }
  t_lspBinaryBuffer.copyToFlat(t_lspFlatBinaryBufferPtr as usize);
}


@inline
function pushVisitedNode(node: u32): void {
    if (t_lspVisitedCount >= t_lspVisitedCapacity) {
        let newCap = t_lspVisitedCapacity * 2;
        let newPtr = atomicChunkAlloc(newCap * 4);
        let oldPtr = changetype<usize>(t_lspVisitedNodes);
        if (oldPtr != 0) {
          memory.copy(newPtr, oldPtr, t_lspVisitedCapacity * 4);
        }
        t_lspVisitedNodes = changetype<UnmanagedUint32Array>(newPtr);
        t_lspVisitedCapacity = newCap;
    }
    t_lspVisitedNodes[t_lspVisitedCount] = node;
    t_lspVisitedCount++;
}

@inline
function ensureTraverseStack(required: u32): void {
    if (required > t_lspStackCapacity) {
        let newCap = t_lspStackCapacity * 2;
        while (required > newCap && newCap != 0) newCap *= 2;
        if (newCap == 0) newCap = required;
        let newTraverse = atomicChunkAlloc(newCap * 4);
        let newOffset = atomicChunkAlloc(newCap * 4);
        let newParent = atomicChunkAlloc(newCap * 4);
        let oldTraverse = changetype<usize>(t_lspTraverseStack);
        let oldOffset = changetype<usize>(t_lspOffsetStack);
        let oldParent = changetype<usize>(t_lspParentStack);
        if (t_lspStackCapacity > 0 && oldTraverse != 0) {
           memory.copy(newTraverse, oldTraverse, t_lspStackCapacity * 4);
           memory.copy(newOffset, oldOffset, t_lspStackCapacity * 4);
           if (oldParent != 0) {
             memory.copy(newParent, oldParent, t_lspStackCapacity * 4);
           }
        }
        t_lspTraverseStack = changetype<UnmanagedUint32Array>(newTraverse);
        t_lspOffsetStack = changetype<UnmanagedUint32Array>(newOffset);
        t_lspParentStack = changetype<UnmanagedUint32Array>(newParent);
        t_lspStackCapacity = newCap;
    }
}

@inline
function ensureFindTraverseStack(required: u32): void {
    if (changetype<usize>(t_lspFindTraverseStack) == 0) {
        t_lspFindStackCapacity = 50000;
        t_lspFindTraverseStack = changetype<UnmanagedUint32Array>(atomicChunkAlloc(t_lspFindStackCapacity * 4));
        t_lspFindOffsetStack = changetype<UnmanagedUint32Array>(atomicChunkAlloc(t_lspFindStackCapacity * 4));
    }
    if (required > t_lspFindStackCapacity) {
        let newCap = t_lspFindStackCapacity * 2;
        while (newCap < required) newCap *= 2;
        let newTrav = changetype<UnmanagedUint32Array>(atomicChunkAlloc(newCap * 4));
        let newOff = changetype<UnmanagedUint32Array>(atomicChunkAlloc(newCap * 4));
        for (let i: u32 = 0; i < t_lspFindStackCapacity; i++) {
            newTrav[i] = t_lspFindTraverseStack[i];
            newOff[i] = t_lspFindOffsetStack[i];
        }
        t_lspFindTraverseStack = newTrav;
        t_lspFindOffsetStack = newOff;
        t_lspFindStackCapacity = newCap;
    }
}

let t_lspRefFileIds: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspRefDocRoots: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspRefAllocCap: u32 = 0;

@inline
function ensureRefBuffers(requiredCap: u32): void {
  if (requiredCap > t_lspRefAllocCap) {
    let newCap: u32 = t_lspRefAllocCap == 0 ? 1024 : t_lspRefAllocCap * 2;
    while (newCap < requiredCap) newCap *= 2;
    t_lspRefFileIds = changetype<UnmanagedUint32Array>(atomicChunkAlloc(newCap * 4));
    t_lspRefDocRoots = changetype<UnmanagedUint32Array>(atomicChunkAlloc(newCap * 4));
    t_lspRefAllocCap = newCap;
  }
}

function lsp_clearVisited(): void {
  let ptr = changetype<usize>(t_lspVisitedNodes);
  for (let i: u32 = 0; i < t_lspVisitedCount; i++) {
    let nodePtr = load<u32>(ptr + (i << 2));
    setNodeFlags(nodePtr, getNodeFlags(nodePtr) & ~FLAG_LSP_TRAVERSED);
  }
  t_lspVisitedCount = 0;
}

@inline function packOffsetStack(offset: u32, inError: boolean, hasErrorSibling: boolean, hasInsertedSibling: boolean, inTainted: boolean = false): u32 {
  let val = offset & 0x0FFFFFFF;
  if (inError) val |= 0x80000000;
  if (hasErrorSibling) val |= 0x40000000;
  if (hasInsertedSibling) val |= 0x20000000;
  if (inTainted) val |= 0x10000000;
  return val;
}

@inline function getOffsetFromStack(val: u32): u32 {
  return val & 0x0FFFFFFF;
}

@inline function getInErrorFromStack(val: u32): boolean {
  return (val >>> 31) == 1;
}

@inline function getHasErrorSiblingFromStack(val: u32): boolean {
  return (val & 0x40000000) != 0;
}

@inline function getHasInsertedSiblingFromStack(val: u32): boolean {
  return (val & 0x20000000) != 0;
}

@inline function getInTaintedFromStack(val: u32): boolean {
  return (val & 0x10000000) != 0;
}

/**
 * Extracts and serializes all syntax and grammar diagnostics into a flat `u32` buffer.
 * Traverses the AST looking for injected error nodes and missing ghost nodes.
 * @param astRoot The root node pointer of the parsed tree.
 * @returns The number of `u32` records inside `t_lspBinaryBuffer` (4 u32s per diagnostic).
 */
function lsp_extractDiagnosticsForRoot(astRoot: u32, fileId: u32 = 0, rangeStart: u32 = 0, rangeEnd: u32 = 0): void {
  if (astRoot == 0) return;
  globalAstRoot = astRoot;

  if (rangeEnd == 0) {
    ensureNodeOffsetMap();
    if (t_nodeOffsetMapAstRoot != astRoot) {
      t_nodeOffsetMap.clear();
      t_nodeOffsetMapAstRoot = astRoot;
      lsp_populateNodeOffsetMap(astRoot, 0);
    }
  }

  let prevLen = t_lspBinaryBuffer.length;

  ensureTraverseStack(1);

  let stackTop: u32 = 0;
  lsp_clearVisited();
  t_lspTraverseStack[stackTop] = astRoot;
  t_lspOffsetStack[stackTop] = packOffsetStack(getNodeLeadingPad(astRoot), false, false, false, false);
  stackTop++;

  while (stackTop > 0) {
    if (t_lspBinaryBuffer.length >= 50000 * 7) {
      break;
    }
    stackTop--;
    let node = load<u32>(changetype<usize>(t_lspTraverseStack) + stackTop * 4);
    let offsetStackVal = load<u32>(changetype<usize>(t_lspOffsetStack) + stackTop * 4);
    let start = getOffsetFromStack(offsetStackVal);
    let inError = getInErrorFromStack(offsetStackVal);
    let hasErrorSibling = getHasErrorSiblingFromStack(offsetStackVal);
    let inTainted = getInTaintedFromStack(offsetStackVal);

    if (rangeEnd == 0) {
      t_nodeOffsetMap.set(node as u64, start);
    }

    if (stackTop > 500000) { break; }

    let step: u32 = getEncodingStep();
    let flags = getNodeFlags(node);
    let pad = getNodeLeadingPad(node);
    let len = getNodeByteLength(node);
    let nodeStart = start;
    let nodeEnd = nodeStart + len;
    let type = getNodeType(node);

    // Range bounding pruning: if outside range and has no error flags, skip subtree
    if (rangeEnd > rangeStart && (nodeEnd < rangeStart || nodeStart > rangeEnd)) {
      if ((flags & (FLAG_HAS_ERROR | FLAG_IS_TAINED | FLAG_IS_INSERTED)) == 0) {
        continue;
      }
    }

    let firstChild = getNodeFirstChild(node);
    let isLeaf = firstChild == 0;
    let isMutated = (type & 0x8000) != 0;
    let isErrorNode = type == 0 || inError || (isLeaf && (((flags & FLAG_HAS_ERROR) != 0) || isMutated));

    let hasInsertedSibling = getHasInsertedSiblingFromStack(offsetStackVal);

    let isTainted = (flags & FLAG_IS_TAINED) != 0;
    let hasChildError = false;
    if (!isLeaf) {
      let chk = firstChild;
      while (chk != 0) {
        let chkFlags = getNodeFlags(chk);
        let chkType = getNodeType(chk);
        if (chkType == 0 || ((chkFlags & (FLAG_HAS_ERROR | FLAG_IS_INSERTED)) != 0) || ((chkType & 0x8000) != 0)) {
          hasChildError = true;
          break;
        }
        chk = getNodeNextSibling(chk);
      }
    }
    let isActualError = (type == 0 && !inError) || ((flags & FLAG_IS_INSERTED) != 0) || (isLeaf && (type == 0 || isMutated || ((flags & FLAG_HAS_ERROR) != 0)) && !inError);
    let allocatedDiag = false;

    if (isActualError) {



      let totalInputBytes: u32 = inputLength;
      
      let dStart = nodeStart;
      let dEnd = nodeEnd > nodeStart ? nodeEnd : dStart + step;

      // For ERROR nodes whose first child is a valid (non-error) node,
      // narrow dStart past it. When recovery wraps popped stack nodes into
      // an error, the first child is the valid node that was on the stack
      // before the error. The diagnostic should start after it.
      if (type == 0 && firstChild != 0) {
        let cType = getNodeType(firstChild);
        let cFlags = getNodeFlags(firstChild);
        if (cType != 0 && (cFlags & (FLAG_HAS_ERROR | FLAG_IS_INSERTED)) == 0) {
          let firstChildEnd = nodeStart + getNodePadding(firstChild) + getNodeByteLength(firstChild);
          if (firstChildEnd > dStart && firstChildEnd < dEnd) {
            dStart = firstChildEnd;
          }
        }
      }

      if ((flags & FLAG_IS_INSERTED) == 0 && dEnd > dStart) {
        while (dStart < dEnd) {
          let ch = peekChar(dStart);
          if (ch == 10 || ch == 13 || ch == 32 || ch == 9 || ch == 0) {
            dStart += step;
          } else {
            break;
          }
        }
        while (dEnd > dStart) {
          let ch = peekChar(dEnd - step);
          if (ch == 10 || ch == 13 || ch == 32 || ch == 9 || ch == 0) {
            dEnd -= step;
          } else {
            break;
          }
        }
      }

      if (dEnd <= dStart) {
        if ((flags & FLAG_IS_INSERTED) != 0) {
          if (nodeStart < totalInputBytes) {
            dStart = nodeStart;
            while (dStart < totalInputBytes && (peekChar(dStart) == 32 || peekChar(dStart) == 9 || peekChar(dStart) == 10 || peekChar(dStart) == 13)) {
              dStart += step;
            }
            dEnd = dStart + step <= totalInputBytes ? dStart + step : totalInputBytes;
          } else {
            let scanPos = totalInputBytes;
            while (scanPos > 0) {
              let ch = peekChar(scanPos - step);
              if (ch != 10 && ch != 13 && ch != 32 && ch != 9 && ch != 0) {
                break;
              }
              scanPos -= step;
            }
            if (scanPos == 0) {
              dStart = 0;
              dEnd = totalInputBytes > 0 ? (totalInputBytes < step ? totalInputBytes : step) : 0;
            } else {
              if (scanPos >= step) {
                let prevCh = peekChar(scanPos - step);
                if (prevCh == 10 || prevCh == 13 || prevCh == 32 || prevCh == 9) {
                  dStart = scanPos - step;
                  dEnd = scanPos;
                } else {
                  let tokStart = scanPos - step;
                  while (tokStart > 0) {
                    let c = peekChar(tokStart - step);
                    if (c == 10 || c == 13 || c == 32 || c == 9 || c == 0) break;
                    tokStart -= step;
                  }
                  if (scanPos > tokStart) {
                    dStart = tokStart;
                    dEnd = scanPos;
                  } else {
                    dStart = scanPos - step;
                    dEnd = scanPos;
                  }
                }
              } else {
                dStart = scanPos - step;
                dEnd = scanPos;
              }
            }
          }
        }
      }

      if ((flags & FLAG_IS_INSERTED) != 0) {
        if (dStart < totalInputBytes) {
          let ch = peekChar(dStart);
          if (ch == 32 || ch == 9 || ch == 10 || ch == 13 || ch == 0) {
            let prevNonWs = dStart;
            while (prevNonWs > 0 && (peekChar(prevNonWs - step) == 32 || peekChar(prevNonWs - step) == 9)) {
              prevNonWs -= step;
            }
            if (prevNonWs > 0 && peekChar(prevNonWs - step) != 10 && peekChar(prevNonWs - step) != 13) {
              let prevCh = peekChar(prevNonWs - step);
              let isPunct = prevCh == 59 || prevCh == 44 || prevCh == 40 || prevCh == 41 ||
                            prevCh == 123 || prevCh == 125 || prevCh == 91 || prevCh == 93 ||
                            prevCh == 61 || prevCh == 58;
              if (isPunct) {
                dStart = prevNonWs - step;
                dEnd = prevNonWs;
              } else {
                let tokStart = prevNonWs - step;
                while (tokStart > 0) {
                  let c = peekChar(tokStart - step);
                  if (c == 32 || c == 9 || c == 10 || c == 13 || c == 0 ||
                      c == 59 || c == 44 || c == 40 || c == 41 || c == 123 || c == 125 || c == 91 || c == 93 || c == 61 || c == 58) break;
                  tokStart -= step;
                }
                dStart = tokStart;
                dEnd = prevNonWs;
              }
            }
          }
        }
      }

      if (totalInputBytes > 0 && dEnd > totalInputBytes) {
        dEnd = totalInputBytes;
        if (dEnd > step) dStart = dEnd - step;
        else dStart = 0;
      }
      let tokType = (type != 0 && type <= (MAX_TERMINAL_ID as u16) ? type : 0);
      if (tokType == 0 && firstChild != 0) {
        let chk = firstChild;
        while (chk != 0) {
          let chkType = getNodeType(chk) & 0x7fff;
          let chkLen = getNodeByteLength(chk);
          let chkFlags = getNodeFlags(chk);
          if (chkType <= (MAX_TERMINAL_ID as u16) && chkLen > 0 && (chkFlags & FLAG_INVISIBLE) == 0) {
            tokType = chkType;
            break;
          }
          chk = getNodeNextSibling(chk);
        }
      }
      if ((tokType == 0 || tokType > (MAX_TERMINAL_ID as u16)) && dStart < totalInputBytes) {
        let ch = peekChar(dStart);
        tokType = ch as u16;
      }
      if (dEnd > dStart && totalInputBytes > 0) {
        if (dStart > 0 && dStart < totalInputBytes) {
          let chCurr = peekChar(dStart);
          let chPrev = peekChar(dStart - step);
          let isCurrWord = (chCurr >= 97 && chCurr <= 122) || (chCurr >= 65 && chCurr <= 90) || (chCurr >= 48 && chCurr <= 57) || chCurr == 95;
          let isPrevWord = (chPrev >= 97 && chPrev <= 122) || (chPrev >= 65 && chPrev <= 90) || (chPrev >= 48 && chPrev <= 57) || chPrev == 95;
          if (isCurrWord && isPrevWord) {
            while (dStart > 0) {
              let c = peekChar(dStart - step);
              if (!((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c == 95)) break;
              dStart -= step;
            }
          }
        }
        if (dEnd > 0 && dEnd < totalInputBytes) {
          let chEnd = peekChar(dEnd);
          let chBeforeEnd = peekChar(dEnd - step);
          let isEndWord = (chEnd >= 97 && chEnd <= 122) || (chEnd >= 65 && chEnd <= 90) || (chEnd >= 48 && chEnd <= 57) || chEnd == 95;
          let isBeforeWord = (chBeforeEnd >= 97 && chBeforeEnd <= 122) || (chBeforeEnd >= 65 && chBeforeEnd <= 90) || (chBeforeEnd >= 48 && chBeforeEnd <= 57) || chBeforeEnd == 95;
          if (isEndWord && isBeforeWord) {
            while (dEnd < totalInputBytes) {
              let c = peekChar(dEnd);
              if (!((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c == 95)) break;
              dEnd += step;
            }
          }
        }
      }

      if (dEnd > dStart) {
        if ((flags & FLAG_IS_INSERTED) != 0) {
          lsp_allocDiagnostic(dStart, dEnd, 0, 1, (type & 0x7fff) as u32);
          allocatedDiag = true;
        } else {
          let exp1: u32 = 0;
          let exp2: u32 = 0;
          for (let ei = 0; ei < errorCount; ei++) {
            if (t_errorStarts[ei] <= dEnd && t_errorEnds[ei] >= dStart) {
              if (changetype<u32>(t_errorArg2) != 0 && t_errorArg2[ei] > 0) {
                exp1 = t_errorArg2[ei];
                exp2 = t_errorArg3[ei];
                break;
              }
            }
          }
          lsp_allocDiagnostic(dStart, dEnd, 0, 2, tokType as u32, exp1, exp2);
          allocatedDiag = true;
        }
      } else if (isLeaf && (type == 0 || isMutated || ((flags & FLAG_HAS_ERROR) != 0))) {
        let fallbackStart = nodeStart < totalInputBytes ? nodeStart : (totalInputBytes >= step ? totalInputBytes - step : 0);
        let fallbackEnd = fallbackStart + step <= totalInputBytes ? fallbackStart + step : totalInputBytes;
        if (fallbackEnd > fallbackStart) {
          let exp1: u32 = 0;
          let exp2: u32 = 0;
          for (let ei = 0; ei < errorCount; ei++) {
            if (t_errorStarts[ei] <= fallbackEnd && t_errorEnds[ei] >= fallbackStart) {
              if (changetype<u32>(t_errorArg2) != 0 && t_errorArg2[ei] > 0) {
                exp1 = t_errorArg2[ei];
                exp2 = t_errorArg3[ei];
                break;
              }
            }
          }
          lsp_allocDiagnostic(fallbackStart, fallbackEnd, 0, 2, tokType as u32, exp1, exp2);
          allocatedDiag = true;
        }
      }

    }

    if (rangeEnd == 0 && !isErrorNode && !hasChildError && (flags & FLAG_IS_INSERTED) == 0) {
      executeLints(type, node, nodeStart, nodeEnd);
    }

    // Recurse into children (for both error and non-error nodes)
    let child = getNodeFirstChild(node);
    if (child != 0) {
      let childCount: u32 = 0;
      let countChild = child;
      let failsafe1 = 0;
      while (countChild != 0) {
        if (failsafe1++ > 200000) { break; }
        childCount++;
        countChild = getNodeNextSibling(countChild);
      }

      if (childCount > 0) {
        ensureTraverseStack(stackTop + childCount);
        let currOffset = nodeStart;
        let consumedInParent: u32 = 0;
        let currChildIdx = 0;

        let hasAnyInserted = false;
        let hasAnyError = false;
        let chk = child;
        while (chk != 0) {
          let chkFlags = getNodeFlags(chk);
          let chkType = getNodeType(chk);
          if ((chkFlags & FLAG_IS_INSERTED) != 0) hasAnyInserted = true;
          if (chkType == 0 || ((chkFlags & FLAG_HAS_ERROR) != 0) || ((chkType & 0x8000) != 0)) hasAnyError = true;
          chk = getNodeNextSibling(chk);
        }
        
        let isPureErrorGroup = (type == 0) && allocatedDiag;
        let childInError = inError || isPureErrorGroup;
        let childInTainted = inTainted || isTainted || hasChildError;

        while (child != 0) {
          let padVal = getNodeLeadingPad(child);
          let lenVal = getNodeByteLength(child);
          if (currChildIdx > 0) {
            currOffset += padVal;
          }
          let childStart = currOffset;
          
          let slot = stackTop + (childCount - 1 - currChildIdx);
          t_lspTraverseStack[slot] = child;
          t_lspOffsetStack[slot] = packOffsetStack(childStart, childInError, hasAnyError, hasAnyInserted, childInTainted);
          
          currOffset = childStart + lenVal;
          consumedInParent += lenVal;
          currChildIdx++;
          child = getNodeNextSibling(child);
        }
        stackTop += childCount;
      }
    }
  }

  lsp_clearVisited();
  if (fileId != 0) {
     let currentLen = t_lspBinaryBuffer.length;
     let count = (currentLen - prevLen) / 7;
     for (let c: u32 = 0; c < count; c++) {
        let baseIdx = prevLen + c * 7;
        t_lspBinaryBuffer.set(baseIdx + 3, fileId);
     }
  }
}

/**
 * Traverses the AST to extract diagnostic error locations restricted to a byte range.
 * @param astRoot The root AST node pointer.
 * @param rangeStart The start byte offset of the range.
 * @param rangeEnd The end byte offset of the range.
 * @returns The number of `u32` records inside `t_lspBinaryBuffer` (7 u32s per diagnostic).
 */
export function lsp_getDiagnosticsRange(astRoot: u32, rangeStart: u32, rangeEnd: u32): u32 {
  ensureLspBuffers();
  let extractedCount: u32 = 0;
  if (astRoot != 0) {
    globalAstRoot = astRoot;
    lsp_extractDiagnosticsForRoot(astRoot, 0, rangeStart, rangeEnd);
    extractedCount = t_lspBinaryBuffer.length / 7;
  }
  if (extractedCount == 0 && astRoot == globalAstRoot) {
    for (let i = 0; i < errorCount; i++) {
      let s = t_errorStarts[i];
      let e = t_errorEnds[i];
      if (e > s && (s <= rangeEnd && e >= rangeStart)) {
        let a0 = changetype<u32>(t_errorArg0) != 0 ? t_errorArg0[i] : 0;
        let a1 = changetype<u32>(t_errorArg1) != 0 ? t_errorArg1[i] : 0;
        let a2 = changetype<u32>(t_errorArg2) != 0 ? t_errorArg2[i] : 0;
        let a3 = changetype<u32>(t_errorArg3) != 0 ? t_errorArg3[i] : 0;
        lsp_allocDiagnostic(s, e, 0, a0, a1, a2, a3);
      }
    }
  }
  lsp_clearVisited();
  flushBinaryBuffer();
  return t_lspBinaryBuffer.length / 7;
}

/**
 * Traverses the AST root to extract and serialize diagnostic error locations.
 * Merges adjacent error nodes and writes 7-u32 tuple records into `t_lspBinaryBuffer`.
 * @param astRoot The root AST node pointer.
 * @returns The number of `u32` records inside `t_lspBinaryBuffer` (7 u32s per diagnostic).
 */
export function lsp_getDiagnostics(astRoot: u32): u32 {
  ensureLspBuffers();
  let extractedCount: u32 = 0;
  if (astRoot != 0) {
    globalAstRoot = astRoot;
    lsp_extractDiagnosticsForRoot(astRoot, 0, 0, 0);
    extractedCount = t_lspBinaryBuffer.length / 7;
  }
  if (extractedCount == 0 && astRoot == globalAstRoot) {
    for (let i = 0; i < errorCount; i++) {
      let s = t_errorStarts[i];
      let e = t_errorEnds[i];
      if (e > s) {
        let a0 = changetype<u32>(t_errorArg0) != 0 ? t_errorArg0[i] : 0;
        let a1 = changetype<u32>(t_errorArg1) != 0 ? t_errorArg1[i] : 0;
        let a2 = changetype<u32>(t_errorArg2) != 0 ? t_errorArg2[i] : 0;
        let a3 = changetype<u32>(t_errorArg3) != 0 ? t_errorArg3[i] : 0;
        lsp_allocDiagnostic(s, e, 0, a0, a1, a2, a3);
      }
    }
  }
  lsp_clearVisited();
  flushBinaryBuffer();
  return t_lspBinaryBuffer.length / 7;
}

/**
 * Extracts and serializes Semantic Tokens for syntax highlighting.
 * Operates purely on the unmanaged heap to format tokens strictly ordered by byte offset.
 * Uses static semantic maps (`type_semantics`) embedded by the code generator.
 * @returns The number of semantic token primitives inside `t_lspBinaryBuffer`.
 */
export function lsp_semanticTokens_full(astRoot: u32): u32 {
  ensureLspBuffers();

  if (astRoot == 0) {
    flushBinaryBuffer();
    return 0;
  }
  globalAstRoot = astRoot;

  let stackTop: u32 = 0;
  t_lspTraverseStack[stackTop] = astRoot;
  t_lspOffsetStack[stackTop] = getNodeLeadingPad(astRoot);
  stackTop++;

  while (stackTop > 0) {
    stackTop--;
    let node = load<u32>(changetype<usize>(t_lspTraverseStack) + stackTop * 4);
    let offsetStackVal = load<u32>(changetype<usize>(t_lspOffsetStack) + stackTop * 4);
    let start = getOffsetFromStack(offsetStackVal);
    let inError = getInErrorFromStack(offsetStackVal);

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_TRAVERSED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_TRAVERSED);

    pushVisitedNode(node);

    let pad = getNodePadding(node);
    let len = getNodeByteLength(node);
    let type = getNodeType(node);
    let isErrorNode = type == 0;
    let nodeStart = start;

    let hasError = (flags & FLAG_HAS_ERROR) != 0;
    
    let semOffset: i32 = -1;
    // @ts-ignore
    if (!isErrorNode && (type as i32) <= MAX_SYMBOL_ID) {
      // @ts-ignore
      semOffset = load<i32>(type_semantics + type * 4);
    }
    if (semOffset != -1) {
      let numSemantics = load<i32>(type_semantic_data + semOffset * 4);
      for (let i = 0; i < numSemantics; i++) {
        let childIdx = load<i32>(type_semantic_data + ((semOffset + 1 + i * 3) << 2));
        let tokenTypeId = load<i32>(type_semantic_data + ((semOffset + 1 + i * 3 + 1) << 2));
        let bitmask = load<i32>(type_semantic_data + ((semOffset + 1 + i * 3 + 2) << 2));

        let child = getNodeFirstChild(node);
        let childCount = 0;
        let targetChild: u32 = 0;
        let currOffset = nodeStart;
        let childOffset: u32 = 0;
        let currChildIdx: i32 = 0;

        while (child != 0) {
          let cPad = getNodePadding(child);
          let cType = getNodeType(child);
          let cFlags = getNodeFlags(child);
          let cLen = getNodeByteLength(child);
          let isExtra = cType == NODE_TYPE_ERROR;

          if (currChildIdx > 0) {
            currOffset += cPad;
          }
          let childStart = currOffset;

          if (!isExtra) {
            if (childCount == childIdx) {
              targetChild = child;
              childOffset = childStart;
              break;
            }
            childCount++;
          }
          currOffset = childStart + cLen;
          currChildIdx++;
          child = getNodeNextSibling(child);
        }

        if (targetChild != 0) {
          let targetFlags = getNodeFlags(targetChild);
          if ((targetFlags & FLAG_IS_INSERTED) != 0) continue;
          
          while ((targetFlags & FLAG_INVISIBLE) != 0 && (targetFlags & FLAG_IS_LIST) != 0) {
            let inner = getNodeFirstChild(targetChild);
            if (inner == 0) break;
            targetChild = inner;
            targetFlags = getNodeFlags(targetChild);
          }
          let cLen = getNodeByteLength(targetChild);
          if (cLen > 0) {
            if (childOffset > inputLength) continue;
            if (cLen > inputLength || childOffset + cLen > inputLength || childOffset + cLen < childOffset) {
              cLen = inputLength - childOffset;
            }
            
            let step: u32 = getEncodingStep();
            // LSP4 fix: split multi-line tokens into line-by-line segments instead of truncating/skipping
            let segStart: u32 = childOffset;
            let segLen: u32 = 0;
            let i: u32 = 0;
            while (i < cLen) {
              let c = peekChar(childOffset + i);
              if (c == 10 || c == 13) {
                if (segLen > 0) {
                  t_lspBinaryBuffer.push(segStart);
                  t_lspBinaryBuffer.push(segLen);
                  t_lspBinaryBuffer.push(tokenTypeId);
                  t_lspBinaryBuffer.push(bitmask);
                }
                if (c == 13 && i + step < cLen && peekChar(childOffset + i + step) == 10) {
                  i += step * 2;
                } else {
                  i += step;
                }
                segStart = childOffset + i;
                segLen = 0;
              } else {
                segLen += step;
                i += step;
              }
            }
            if (segLen > 0) {
              t_lspBinaryBuffer.push(segStart);
              t_lspBinaryBuffer.push(segLen);
              t_lspBinaryBuffer.push(tokenTypeId);
              t_lspBinaryBuffer.push(bitmask);
            }
          }
        }
      }
    }

    let child = getNodeFirstChild(node);
    if (child != 0) {
      let childCount: u32 = 0;
      let countChild = child;
      while (countChild != 0) {
        childCount++;
        countChild = getNodeNextSibling(countChild);
      }

      ensureTraverseStack(stackTop + childCount);
      let currOffset = nodeStart;
      let errorFlagBit: u32 = (isErrorNode || inError) ? 0x80000000 : 0;
      let currChildIdx: i32 = 0;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let childByteLen = getNodeByteLength(child);
        if (currChildIdx > 0) {
          currOffset += padVal;
        }
        let childStart = currOffset;
        let slot = stackTop + (childCount - 1 - currChildIdx);
        t_lspTraverseStack[slot] = child;
        t_lspOffsetStack[slot] = childStart | errorFlagBit;
        currOffset = childStart + childByteLen;
        currChildIdx++;
        child = getNodeNextSibling(child);
      }
      stackTop += childCount;
    }
  }

  lsp_clearVisited();
  flushBinaryBuffer();
  sortSemanticTokens(changetype<usize>(t_lspFlatBinaryBuffer), t_lspBinaryBuffer.length / 4);
  return t_lspBinaryBuffer.length / 4;
}

/**
 * Unmanaged view over a 16-byte LSP semantic token record in linear memory.
 */
@unmanaged
export class SemanticTokenRecord {
  startByte: u32;
  length: u32;
  tokenType: u32;
  modifiers: u32;

  @inline static at(flatPtr: usize, index: u32): SemanticTokenRecord {
    return changetype<SemanticTokenRecord>(flatPtr + (((index as usize) << 4)));
  }

  @inline swapWith(other: SemanticTokenRecord): void {
    let t0 = this.startByte;
    let t1 = this.length;
    let t2 = this.tokenType;
    let t3 = this.modifiers;

    this.startByte = other.startByte;
    this.length = other.length;
    this.tokenType = other.tokenType;
    this.modifiers = other.modifiers;

    other.startByte = t0;
    other.length = t1;
    other.tokenType = t2;
    other.modifiers = t3;
  }
}

function sortSemanticTokens(flatPtr: usize, numTokens: u32): void {
  if (numTokens <= 1) return;
  
  let numI32 = numTokens as i32;
  // Build max heap
  for (let i: i32 = (numI32 >> 1) - 1; i >= 0; i--) {
    heapifySemanticTokens(flatPtr, numTokens, i as u32);
  }
  
  // Extract elements from heap one by one
  for (let i = numTokens - 1; i > 0; i--) {
    SemanticTokenRecord.at(flatPtr, 0).swapWith(SemanticTokenRecord.at(flatPtr, i));
    heapifySemanticTokens(flatPtr, i, 0);
  }
}

function heapifySemanticTokens(flatPtr: usize, n: u32, i: u32): void {
  let curr = i;
  while (true) {
    let largest = curr;
    let left = (curr << 1) + 1;
    let right = (curr << 1) + 2;

    if (left < n) {
      let recL = SemanticTokenRecord.at(flatPtr, left);
      let recLargest = SemanticTokenRecord.at(flatPtr, largest);
      if (recL.startByte > recLargest.startByte) largest = left;
    }

    if (right < n) {
      let recR = SemanticTokenRecord.at(flatPtr, right);
      let recLargest = SemanticTokenRecord.at(flatPtr, largest);
      if (recR.startByte > recLargest.startByte) largest = right;
    }

    if (largest != curr) {
      SemanticTokenRecord.at(flatPtr, curr).swapWith(SemanticTokenRecord.at(flatPtr, largest));
      curr = largest;
    } else {
      break;
    }
  }
}

/**
 * Extracts all foldable block ranges from the AST.
 * Filters nodes based on the generated `type_is_folding` boolean map.
 * @returns The number of folding records inside `t_lspBinaryBuffer` (2 u32s per range).
 */
export function lsp_getFoldingRanges(astRoot: u32): u32 {
  ensureLspBuffers();

  if (astRoot == 0) {
    flushBinaryBuffer();
    return 0;
  }

  // L3 fix: Fast return cached folding ranges if astRoot is unchanged
  if (astRoot == t_cachedFoldingRoot && changetype<usize>(t_cachedFoldingBuffer) != 0 && t_cachedFoldingCount > 0) {
    t_lspBinaryBuffer.clear();
    let cLen = t_cachedFoldingBuffer.length;
    for (let i: u32 = 0; i < cLen; i++) {
      t_lspBinaryBuffer.push(t_cachedFoldingBuffer[i]);
    }
    flushBinaryBuffer();
    return t_cachedFoldingCount;
  }

  globalAstRoot = astRoot;

  let stackTop: u32 = 0;
  t_lspTraverseStack[stackTop] = astRoot;
  t_lspOffsetStack[stackTop] = packOffsetStack(getNodeLeadingPad(astRoot), false, false, false);
  stackTop++;

  while (stackTop > 0) {
    stackTop--;
    let node = load<u32>(changetype<usize>(t_lspTraverseStack) + stackTop * 4);
    let offsetStackVal = load<u32>(changetype<usize>(t_lspOffsetStack) + stackTop * 4);
    let start = getOffsetFromStack(offsetStackVal);
    let inError = getInErrorFromStack(offsetStackVal);

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_TRAVERSED) != 0) continue;
    if ((flags & FLAG_IS_TAINED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_TRAVERSED);

    
    pushVisitedNode(node);

    let pad = getNodePadding(node);
    let type = getNodeType(node);
    let isErrorNode = type == 0;

    let nodeStart = start;
    let nodeEnd = nodeStart + getNodeByteLength(node);

    // @ts-ignore
    if (!isErrorNode && (type as i32) <= MAX_SYMBOL_ID) {
      // @ts-ignore
      let isFolding = load<u32>(type_is_folding + (type << 2));
      if (isFolding != 0 && !inError && (flags & FLAG_INVISIBLE) == 0) {

        t_lspBinaryBuffer.push(nodeStart);
        t_lspBinaryBuffer.push(nodeEnd);
      }
    }

    let child = getNodeFirstChild(node);
    if (child != 0) {
      let childCount: u32 = 0;
      let countChild = child;
      while (countChild != 0) {
        childCount++;
        countChild = getNodeNextSibling(countChild);
      }

      

      ensureTraverseStack(stackTop + childCount);
      let currOffset = nodeStart;
      let currChildIdx: i32 = 0;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let lenVal = getNodeByteLength(child);
        if (currChildIdx > 0) {
          currOffset += padVal;
        }
        let childStart = currOffset;
        let slot = stackTop + (childCount - 1 - currChildIdx);
        t_lspTraverseStack[slot] = child;
        t_lspOffsetStack[slot] = packOffsetStack(childStart, isErrorNode || inError, false, false);
        currOffset = childStart + lenVal;
        currChildIdx++;
        child = getNodeNextSibling(child);
      }
      stackTop += childCount;
    }
  }

  lsp_clearVisited();
  flushBinaryBuffer();

  // L3 fix: Cache computed folding ranges
  if (changetype<usize>(t_cachedFoldingBuffer) == 0) {
    t_cachedFoldingBuffer = createChunkedUint32Array(1024);
  } else {
    t_cachedFoldingBuffer.clear();
  }
  let fLen = t_lspBinaryBuffer.length;
  for (let i: u32 = 0; i < fLen; i++) {
    t_cachedFoldingBuffer.push(t_lspBinaryBuffer[i]);
  }
  t_cachedFoldingRoot = astRoot;
  t_cachedFoldingCount = fLen / 2;

  return t_cachedFoldingCount;
}

/**
 * Extracts Document Symbols (Outline view) from the AST.
 * Filters nodes based on the generated `type_is_outline` map.
 * @returns The number of outline records inside `t_lspBinaryBuffer` (4 u32s per symbol).
 */
export function lsp_getDocumentSymbols(astRoot: u32): u32 {
  ensureLspBuffers();

  if (astRoot == 0) {
    flushBinaryBuffer();
    return 0;
  }

  // L3 fix: Fast return cached document symbols if astRoot is unchanged
  if (astRoot == t_cachedSymbolsRoot && changetype<usize>(t_cachedSymbolsBuffer) != 0 && t_cachedSymbolsCount > 0) {
    t_lspBinaryBuffer.clear();
    let cLen = t_cachedSymbolsBuffer.length;
    for (let i: u32 = 0; i < cLen; i++) {
      t_lspBinaryBuffer.push(t_cachedSymbolsBuffer[i]);
    }
    flushBinaryBuffer();
    return t_cachedSymbolsCount;
  }

  globalAstRoot = astRoot;

  let stackTop: u32 = 0;
  t_lspTraverseStack[stackTop] = astRoot;
  t_lspOffsetStack[stackTop] = packOffsetStack(getNodeLeadingPad(astRoot), false, false, false);
  stackTop++;

  while (stackTop > 0) {
    stackTop--;
    let node = load<u32>(changetype<usize>(t_lspTraverseStack) + stackTop * 4);
    let offsetStackVal = load<u32>(changetype<usize>(t_lspOffsetStack) + stackTop * 4);
    let start = getOffsetFromStack(offsetStackVal);
    let inError = getInErrorFromStack(offsetStackVal);

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_TRAVERSED) != 0) continue;
    if ((flags & FLAG_IS_TAINED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_TRAVERSED);

    
    pushVisitedNode(node);

    let pad = getNodePadding(node);
    let type = getNodeType(node);
    let isErrorNode = type == 0;

    let nodeStart = start;
    let nodeEnd = nodeStart + getNodeByteLength(node);

    // @ts-ignore
    if (!isErrorNode && (type as i32) <= MAX_SYMBOL_ID) {
      // @ts-ignore
      let isOutline = load<u32>(type_is_outline + (type << 2));
      if (isOutline != 0 && !inError && (flags & FLAG_INVISIBLE) == 0) {

        t_lspBinaryBuffer.push(nodeStart);
        t_lspBinaryBuffer.push(nodeEnd);
        t_lspBinaryBuffer.push(type);
        t_lspBinaryBuffer.push(node);
      }
    }

    let child = getNodeFirstChild(node);
    if (child != 0) {
      let childCount: u32 = 0;
      let countChild = child;
      while (countChild != 0) {
        childCount++;
        countChild = getNodeNextSibling(countChild);
      }

      

      ensureTraverseStack(stackTop + childCount);
      let currOffset = nodeStart;
      let currChildIdx: i32 = 0;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let lenVal = getNodeByteLength(child);
        if (currChildIdx > 0) {
          currOffset += padVal;
        }
        let childStart = currOffset;
        let slot = stackTop + (childCount - 1 - currChildIdx);
        t_lspTraverseStack[slot] = child;
        t_lspOffsetStack[slot] = packOffsetStack(childStart, isErrorNode || inError, false, false);
        currOffset = childStart + lenVal;
        currChildIdx++;
        child = getNodeNextSibling(child);
      }
      stackTop += childCount;
    }
  }

  lsp_clearVisited();
  flushBinaryBuffer();

  // L3 fix: Cache computed document symbols
  if (changetype<usize>(t_cachedSymbolsBuffer) == 0) {
    t_cachedSymbolsBuffer = createChunkedUint32Array(1024);
  } else {
    t_cachedSymbolsBuffer.clear();
  }
  let sLen = t_lspBinaryBuffer.length;
  for (let i: u32 = 0; i < sLen; i++) {
    t_cachedSymbolsBuffer.push(t_lspBinaryBuffer[i]);
  }
  t_cachedSymbolsRoot = astRoot;
  t_cachedSymbolsCount = sLen / 4;

  return t_cachedSymbolsCount;
}

export let lspLastNodeOffset: u32 = 0;

/**
 * Performs a deep depth-first search to find the most specific terminal or AST node
 * spanning the given `targetOffset`. Favors structurally significant rules over raw tokens
 * if multiple nodes share the exact same boundaries.
 * @param rootNode The starting AST node.
 * @param targetOffset The absolute byte offset the cursor is hovering over.
 * @returns The target node pointer, or 0 if not found.
 */
export function lsp_getNodeAtByteOffset(rootNode: u32, targetOffset: u32): u32 {
  if (rootNode == 0) return 0;
  globalAstRoot = rootNode;
  lspLastNodeOffset = 0;
  
  ensureLspBuffers();
  
  let stackTop: i32 = 0;
  let rootPad = getNodeLeadingPad(rootNode);
  t_lspTraverseStack[0] = rootNode;
  t_lspOffsetStack[0] = rootPad; 
  stackTop = 1;
  
  let bestMatch: u32 = 0;

  while (stackTop > 0) {
    stackTop--;
    let node = t_lspTraverseStack[stackTop];
    let tokenStart = t_lspOffsetStack[stackTop];
    let len = getNodeByteLength(node);
    let tokenEnd = tokenStart + len;
    
    if (targetOffset >= tokenStart && targetOffset <= tokenEnd) {
       let update = false;
       if (bestMatch == 0) {
          update = true;
       } else {
          let bestLen = getNodeByteLength(bestMatch);
          if (len < bestLen) {
             // LSP3 fix: narrower (more specific) span wins
             update = true;
          } else if (len == bestLen) {
             let bestType = getNodeType(bestMatch);
             let nodeType = getNodeType(node);
             if (bestType > (MAX_TERMINAL_ID as u16) && nodeType <= (MAX_TERMINAL_ID as u16)) {
                update = true;
             }
          }
       }
       if (update) {
          bestMatch = node;
          lspLastNodeOffset = tokenStart;
       }
    }
    
    if (targetOffset < tokenStart || targetOffset > tokenEnd) {
       continue;
    }
    
    let child = getNodeFirstChild(node);
    if (child != 0) {
      let childCount: i32 = 0;
      let c = child;
      while (c != 0) { childCount++; c = getNodeNextSibling(c); }

      ensureTraverseStack(stackTop + childCount);
      let currOffset = tokenStart;
      let writeIdx: i32 = stackTop + childCount - 1;
      let isFirstChild = true;
      c = child;
      while (c != 0) {
         let cPad = getNodeLeadingPad(c);
         let cLen = getNodeByteLength(c);
         if (!isFirstChild) {
            currOffset += cPad;
         }
         if (writeIdx >= 0) {
            t_lspTraverseStack[writeIdx] = c;
            t_lspOffsetStack[writeIdx] = currOffset;
            writeIdx--;
         }
         currOffset += cLen;
         isFirstChild = false;
         c = getNodeNextSibling(c);
      }
      stackTop += childCount;
    }
  }
  
  return bestMatch;
}

/**
 * Locates the absolute start byte offset of `targetNode` relative to `rootNode`.
 *
 * CRITICAL DO NOT MODIFY:
 * NEVER call `ensureLspBuffers()` inside `lsp_findNodeOffset`!
 * `ensureLspBuffers()` clears `t_lspBinaryBuffer`. `lsp_findNodeOffset` is invoked during
 * `executeLints` while `lsp_getDiagnostics` is traversing the AST. Calling `ensureLspBuffers()`
 * here wipes all previously collected diagnostics (such as leading syntax error tokens at byte 0).
 * Always use `ensureFindTraverseStack(1)` instead.
 *
 * @returns The absolute `startByte`, or -1 if the target node is disconnected from the root.
 */
export function lsp_getNodeLeadingPad(node: u32): u32 {
  return getNodeLeadingPad(node);
}

@inline function getNodeLeadingPad(node: u32): u32 {
  return getNodePadding(node);
}

export function lsp_populateNodeOffsetMap(rootNode: u32, rootOffset: u32 = 0): void {
   if (rootNode == 0) return;
   ensureFindTraverseStack(1);
   let rootStart = (rootOffset == 0) ? getNodeLeadingPad(rootNode) : rootOffset;

   let stackTop: i32 = 0;
   t_lspFindTraverseStack[0] = rootNode;
   t_lspFindOffsetStack[0] = rootStart;
   t_nodeOffsetMap.set(rootNode as u64, rootStart);
   stackTop++;
   
   let iterations: i32 = 0;
   while (stackTop > 0 && ++iterations < 2000000) {
      stackTop--;
      let current = t_lspFindTraverseStack[stackTop];
      let nodeStart = t_lspFindOffsetStack[stackTop];
      
      t_nodeOffsetMap.set(current as u64, nodeStart);
      
      let child = getNodeFirstChild(current);
      if (child != 0) {
         let childCount: i32 = 0;
         let c = child;
         while (c != 0 && childCount < 5000) { childCount++; c = getNodeNextSibling(c); }
         
         ensureFindTraverseStack(stackTop + childCount);
         
         let currOffset = nodeStart;
         let idx: i32 = 0;
         c = child;
         while (c != 0 && idx < childCount) {
            let cPad = getNodeLeadingPad(c);
            let cLen = getNodeByteLength(c);
            if (idx > 0) {
               currOffset += cPad;
            }
            let childStart = currOffset;
            let slot = stackTop + (childCount - 1 - idx);
            t_lspFindTraverseStack[slot] = c;
            t_lspFindOffsetStack[slot] = childStart;
            currOffset = childStart + cLen;
            idx++;
            c = getNodeNextSibling(c);
         }
         stackTop += childCount;
      }
   }
}

export function lsp_findNodeOffset(rootNode: u32, targetNode: u32, rootOffset: u32): i32 {
   if (rootNode == 0 || targetNode == 0) return -1;
   if (globalAstRoot == 0) globalAstRoot = rootNode;
   let rootStart = (rootOffset == 0) ? getNodeLeadingPad(rootNode) : rootOffset;
   if (rootNode == targetNode) return rootStart as i32;

   ensureNodeOffsetMap();
   if (t_nodeOffsetMapAstRoot != rootNode) {
      t_nodeOffsetMap.clear();
      t_nodeOffsetMapAstRoot = rootNode;
      lsp_populateNodeOffsetMap(rootNode, rootOffset);
   }
   if (t_nodeOffsetMap.has(targetNode as u64)) {
      return t_nodeOffsetMap.get(targetNode as u64) as i32;
   }
   if (rootNode != globalAstRoot && globalAstRoot != 0) {
      return lsp_findNodeOffset(globalAstRoot, targetNode, 0);
   }
   return -1;
}

/**
 * Triggers a `Go to Definition` LSP request.
 * Locates the node under the cursor, queries the graph for its definition across all registered document roots,
 * and serializes [fileId, startByte, endByte] (3-tuple).
 */
export function lsp_getDefinition(rootNode: u32, targetOffset: u32): u32 {
   let node = lsp_getNodeAtByteOffset(rootNode, targetOffset);
   if (node == 0) return 0;
   globalAstRoot = rootNode;
   
   let targetOffsetStart = lspLastNodeOffset;
   let targetSpan = ast_getTextSpan(node, targetOffsetStart);
   let targetHash = ast_hashSpan(targetSpan);
   
   // Fast Tier 1 Stub Resolution
    let stubCount = stub_getDefinition(targetHash, 0);
    if (stubCount >= 3) {
       let stubPtr = stub_getBinaryBuffer();
       let targetFileId = load<u32>(stubPtr + 0);
       let startByte = load<u32>(stubPtr + 4);
       let endByte = load<u32>(stubPtr + 8);
       ensureLspBuffers();
       t_lspBinaryBuffer.push(targetFileId);
       t_lspBinaryBuffer.push(startByte);
       t_lspBinaryBuffer.push(endByte);
       flushBinaryBuffer();
       return 3;
    }
   
   let defNode = lsp_invokeDefinition(node);
   if (defNode == 0) defNode = node;

   let targetFileId: u32 = 0;
   let startOffset: i32 = -1;

   if (changetype<usize>(t_documentRoots) != 0 && t_documentRoots.size > 0) {
      let cap = t_documentRoots.capacity;
      let keysPtr = t_documentRoots.keys;
      let valsPtr = t_documentRoots.values;
      for (let i: u32 = 0; i < cap; i++) {
         let key = load<u64>(keysPtr + (i * 8));
         if (key != 0) {
            let root = load<u64>(valsPtr + (i * 8)) as u32;
             if (root != 0) {
                globalAstRoot = root;
                let offset = lsp_findNodeOffset(root, defNode, 0);
                if (offset >= 0) {
                   targetFileId = key as u32;
                   startOffset = offset;
                   break;
                }
             }
         }
      }
   }

   if (startOffset < 0) {
      startOffset = lsp_findNodeOffset(rootNode, defNode, 0);
      targetFileId = 0;
   }

   if (startOffset < 0) return 0;
   
   let start = startOffset as u32;
   let end = start + getNodeByteLength(defNode);
   
   ensureLspBuffers();
   
   t_lspBinaryBuffer.push(targetFileId);
   t_lspBinaryBuffer.push(start);
   t_lspBinaryBuffer.push(end);
   flushBinaryBuffer();
   return 3;
}

/**
 * Triggers a `Find All References` LSP request.
 * Resolves the definition for the node under the cursor, then scans all registered document roots
 * to find all identifiers with identical text spans that point back to the exact same definition node.
 * Serializes [fileId, startByte, endByte] (3-tuple) per reference.
 */
export function lsp_getReferences(rootNode: u32, targetOffset: u32): u32 {
   let node = lsp_getNodeAtByteOffset(rootNode, targetOffset);
   if (node == 0) return 0;
   globalAstRoot = rootNode;
   
   let targetOffsetStart = lspLastNodeOffset;
   let targetSpan = ast_getTextSpan(node, targetOffsetStart);
   let targetHash = ast_hashSpan(targetSpan);
   let targetLen = (targetSpan & 0xFFFFFFFF) as u32;

   // F12 to get the definition
   let defNode = lsp_invokeDefinition(node);
   if (defNode == 0) defNode = node; // If no definition, assume we are on the definition
   
   ensureLspBuffers();

   // L5 fix: Fast path using inverted symbol index across registered documents
   if (t_refIndexTotalTokens > 0) {
      let totalEntries = t_refIndexTotalTokens / 5;
      for (let i: u32 = 0; i < totalEntries; i++) {
         let base = i * 5;
         let h = t_refIndexNodes[base + 1];
         let l = t_refIndexNodes[base + 3];
         if (h == targetHash && l == targetLen) {
            let nPtr = t_refIndexNodes[base + 4];
            let candidateDef = lsp_invokeDefinition(nPtr);
            if (candidateDef == defNode || candidateDef == 0) {
               t_lspBinaryBuffer.push(t_refIndexNodes[base]);     // fileId
               t_lspBinaryBuffer.push(t_refIndexNodes[base + 2]); // start
               t_lspBinaryBuffer.push(t_refIndexNodes[base + 2] + l); // end
            }
         }
      }
      if (t_lspBinaryBuffer.length > 0) {
         flushBinaryBuffer();
         return t_lspBinaryBuffer.length / 3;
      }
   }

   let numRoots: u32 = 0;
   let allocCap: u32 = 1024;
   if (changetype<usize>(t_documentRoots) != 0 && t_documentRoots.capacity > allocCap) {
      allocCap = t_documentRoots.capacity;
   }
   ensureRefBuffers(allocCap);
   let tempFileIds = t_lspRefFileIds;
   let tempDocRoots = t_lspRefDocRoots;

   if (changetype<usize>(t_documentRoots) != 0 && t_documentRoots.size > 0) {
      let cap = t_documentRoots.capacity;
      let keysPtr = t_documentRoots.keys;
      let valsPtr = t_documentRoots.values;
      for (let i: u32 = 0; i < cap; i++) {
         let key = load<u64>(keysPtr + (i * 8));
         if (key != 0) {
            let root = load<u64>(valsPtr + (i * 8)) as u32;
            if (root != 0) {
               tempFileIds[numRoots] = key as u32;
               tempDocRoots[numRoots] = root;
               numRoots++;
            }
         }
      }
   }

   if (numRoots == 0) {
      tempFileIds[0] = 0;
      tempDocRoots[0] = rootNode;
      numRoots++;
   }

   for (let d: u32 = 0; d < numRoots; d++) {
      let currentFileId = tempFileIds[d];
      let currentRoot = tempDocRoots[d];
      globalAstRoot = currentRoot;

      let stackTop: u32 = 0;
      ensureTraverseStack(1);
      t_lspTraverseStack.set(0, currentRoot);
      t_lspOffsetStack.set(0, 0);
      stackTop++;
      
      while (stackTop > 0) {
         stackTop--;
         let current = t_lspTraverseStack.get(stackTop);
         let offset = t_lspOffsetStack.get(stackTop);
         
         let flags = getNodeFlags(current);
         if ((flags & FLAG_LSP_TRAVERSED) != 0) {
            continue;
         }
         setNodeFlags(current, flags | FLAG_LSP_TRAVERSED);
         pushVisitedNode(current);
         
         let child = getNodeFirstChild(current);
         
         let len = getNodeByteLength(current);
         let pad = getNodePadding(current);
         
         // Candidate filtering by length and string hash
         if (len == targetLen) {
            let tokenStart = offset + pad;
            let span = ast_getTextSpan(current, tokenStart);
            if (ast_hashSpan(span) == targetHash) {
               // Semantic verification with text-matching fallback
               let candidateDef = lsp_invokeDefinition(current);
               if (candidateDef == defNode || candidateDef == 0) {
                  // Confirmed reference!
                  t_lspBinaryBuffer.push(currentFileId);
                  t_lspBinaryBuffer.push(tokenStart);
                  t_lspBinaryBuffer.push(tokenStart + len);
               }
            }
         }
         
         if (child != 0) {
            let childCount = 0;
            let countChild = child;
            while (countChild != 0) {
               childCount++;
               countChild = getNodeNextSibling(countChild);
            }
            ensureTraverseStack(stackTop + childCount);
            let currOffset = offset;
            let c = child;
            let childIdx = 0;
            while (c != 0) {
               let cPad = getNodePadding(c);
               let cLen = cPad + getNodeByteLength(c);
               t_lspTraverseStack.set(stackTop + childCount - 1 - childIdx, c);
               t_lspOffsetStack.set(stackTop + childCount - 1 - childIdx, currOffset);
               childIdx++;
               currOffset += cLen;
               c = getNodeNextSibling(c);
            }
            stackTop += childCount;
         }
      }
   }
   
   flushBinaryBuffer();
   return t_lspBinaryBuffer.length / 3;
}

/**
 * Re-evaluates diagnostics across all registered workspace document roots.
 * Returns the total number of diagnostics stored in the binary buffer (7 elements per diagnostic).
 */
export function lsp_revalidateWorkspace(): u32 {
   ensureLspBuffers();

   if (changetype<usize>(t_documentRoots) != 0 && t_documentRoots.size > 0) {
      let cap = t_documentRoots.capacity;
      let keysPtr = t_documentRoots.keys;
      let valsPtr = t_documentRoots.values;
      for (let i: u32 = 0; i < cap; i++) {
         let key = load<u64>(keysPtr + (i * 8));
         if (key != 0) {
            let root = load<u64>(valsPtr + (i * 8)) as u32;
            if (root != 0) {
               lsp_extractDiagnosticsForRoot(root, key as u32);
            }
         }
      }
   } else if (globalAstRoot != 0) {
      lsp_extractDiagnosticsForRoot(globalAstRoot, 0);
   }

   flushBinaryBuffer();
   return t_lspBinaryBuffer.length / 7;
}

/**
 * Triggers document formatting/unparsing.
 * Returns the number of bytes stored in the binary buffer.
 */
export function lsp_formatDocument(astRoot: u32, preserveFormatting: u32 = 0): u32 {
  ensureLspBuffers();
  let root = astRoot != 0 ? astRoot : globalAstRoot;
  if (root == 0) return 0;

  let span = ast_getTextSpan(root, 0);
  let start = (span >> 32) as u32;
  let len = (span & 0xffffffff) as u32;
  if (len == 0 && inputLength > 0) {
    len = inputLength;
    start = 0;
  }

  let inBuf = getInputBuffer();
  let word: u32 = 0;
  let shift: u32 = 0;
  for (let i: u32 = 0; i < len; i++) {
    let b = load<u8>(inBuf + start + i);
    word |= (b as u32) << shift;
    shift += 8;
    if (shift == 32) {
      t_lspBinaryBuffer.push(word);
      word = 0;
      shift = 0;
    }
  }
  if (shift > 0) {
    t_lspBinaryBuffer.push(word);
  }

  flushBinaryBuffer();
  return len;
}

// ── 2D Diagram & Visual Modeling Endpoints ──────────────────────────────────

const RECORD_KIND_NODE: u32 = 1;
const RECORD_KIND_EDGE: u32 = 2;
const RECORD_KIND_PORT: u32 = 3;

const ACTION_KIND_MOVE: u32 = 1;
const ACTION_KIND_RESIZE: u32 = 2;
const ACTION_KIND_DELETE: u32 = 3;
const ACTION_KIND_CONNECT: u32 = 4;

/**
 * Extracts 2D diagram entities, spatial placement, and connections for the given AST.
 * Encodes packed binary records into t_lspBinaryBuffer.
 * Returns the total number of records emitted.
 */
export function lsp_getDiagramData(astRoot: u32): u32 {
  ensureLspBuffers();
  if (astRoot == 0) {
    flushBinaryBuffer();
    return 0;
  }
  globalAstRoot = astRoot;

  let stackTop: u32 = 0;
  t_lspTraverseStack[stackTop] = astRoot;
  t_lspOffsetStack[stackTop] = packOffsetStack(getNodeLeadingPad(astRoot), false, false, false);
  stackTop++;

  let recordCount: u32 = 0;

  while (stackTop > 0) {
    stackTop--;
    let node = load<u32>(changetype<usize>(t_lspTraverseStack) + stackTop * 4);
    let offsetStackVal = load<u32>(changetype<usize>(t_lspOffsetStack) + stackTop * 4);
    let start = getOffsetFromStack(offsetStackVal);
    let inError = getInErrorFromStack(offsetStackVal);

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_TRAVERSED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_TRAVERSED);
    pushVisitedNode(node);

    let isVisible = (flags & FLAG_INVISIBLE) == 0;
    let pad = getNodePadding(node);
    let type = getNodeType(node);
    let isErrorNode = type == 0;
    let nodeStart = start;
    let nodeLen = getNodeByteLength(node);
    let nodeEnd = nodeStart + nodeLen;

    // Emits Node Record: [kind=1, nodePtr, typeId, startByte, endByte, x, y, width, height, rotation, labelOffset, labelLength, flags] (13 u32s)
    // @ts-ignore
    if (isVisible && !isErrorNode && !inError && (type as i32) <= MAX_SYMBOL_ID) {
      t_lspBinaryBuffer.push(RECORD_KIND_NODE);
      t_lspBinaryBuffer.push(node);
      t_lspBinaryBuffer.push(type);
      t_lspBinaryBuffer.push(nodeStart);
      t_lspBinaryBuffer.push(nodeEnd);
      t_lspBinaryBuffer.push(0); // default x
      t_lspBinaryBuffer.push(0); // default y
      t_lspBinaryBuffer.push(100); // default width
      t_lspBinaryBuffer.push(60); // default height
      t_lspBinaryBuffer.push(0); // default rotation
      t_lspBinaryBuffer.push(nodeStart); // labelOffset
      t_lspBinaryBuffer.push(nodeLen); // labelLength
      t_lspBinaryBuffer.push(flags as u32);
      recordCount++;
    }

    let child = getNodeFirstChild(node);
    if (child != 0) {
      let childCount: u32 = 0;
      let countChild = child;
      while (countChild != 0) {
        childCount++;
        countChild = getNodeNextSibling(countChild);
      }

      ensureTraverseStack(stackTop + childCount);
      let currOffset = nodeStart;
      let currChildIdx: i32 = 0;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let lenVal = getNodeByteLength(child);
        if (currChildIdx > 0) {
          currOffset += padVal;
        }
        let childStart = currOffset;
        let slot = stackTop + (childCount - 1 - currChildIdx);
        t_lspTraverseStack[slot] = child;
        t_lspOffsetStack[slot] = packOffsetStack(childStart, isErrorNode || inError, false, false);
        currOffset = childStart + lenVal;
        currChildIdx++;
        child = getNodeNextSibling(child);
      }
      stackTop += childCount;
    }
  }

  lsp_clearVisited();
  flushBinaryBuffer();
  return recordCount;
}

/**
 * Applies visual diagram edit actions directly to the Arena AST and formats the updated document.
 * @param actionBufferPtr Pointer to packed array of visual actions in WASM memory
 * @param actionCount Number of actions
 * @returns Updated document byte length
 */
export function lsp_applyDiagramEdits(actionBufferPtr: u32, actionCount: u32): u32 {
  ensureLspBuffers();
  if (actionBufferPtr == 0 || actionCount == 0) return lsp_formatDocument(globalAstRoot);

  let offset: u32 = 0;
  for (let i: u32 = 0; i < actionCount; i++) {
    let actionKind = load<u32>(actionBufferPtr + offset);
    offset += 4;

    if (actionKind == ACTION_KIND_MOVE || actionKind == ACTION_KIND_RESIZE) {
      let targetNode = load<u32>(actionBufferPtr + offset);
      offset += 24; // targetNode + newX + newY + newW + newH + newRot

      if (targetNode != 0) {
        let flags = getNodeFlags(targetNode);
        setNodeFlags(targetNode, flags | FLAG_IS_TAINED);
      }
    } else if (actionKind == ACTION_KIND_DELETE) {
      let targetNode = load<u32>(actionBufferPtr + offset);
      offset += 4;
      if (targetNode != 0) {
        let flags = getNodeFlags(targetNode);
        setNodeFlags(targetNode, flags | FLAG_INVISIBLE | FLAG_IS_TAINED);
      }
    } else if (actionKind == ACTION_KIND_CONNECT) {
      offset += 24;
      if (globalAstRoot != 0) {
        let flags = getNodeFlags(globalAstRoot);
        setNodeFlags(globalAstRoot, flags | FLAG_IS_TAINED);
      }
    }
  }

  return lsp_formatDocument(globalAstRoot);
}

/**
 * Generic Completion Context Query.
 * Locates the node around cursorOffset, determines if it is a member/navigation access,
 * and serializes [targetStartByte, targetEndByte, replaceStartByte, replaceEndByte] into t_lspBinaryBuffer.
 * Returns 4 if a target is found, or 0 if top-level / keyword context.
 */
export function lsp_getCompletionContext(rootNode: u32, cursorOffset: u32): u32 {
  if (rootNode == 0) return 0;
  globalAstRoot = rootNode;
  ensureLspBuffers();

  let targetOffset: u32 = (cursorOffset > 0) ? cursorOffset - 1 : 0;

  ensureTraverseStack(2);
  let stackTop: i32 = 0;
  t_lspTraverseStack[0] = rootNode;
  t_lspOffsetStack[0] = 0; 
  t_lspParentStack[0] = 0;
  stackTop = 1;
  
  let bestMatch: u32 = 0;
  let bestParent: u32 = 0;
  let bestStart: u32 = 0;

  while (stackTop > 0) {
    stackTop--;
    let node = t_lspTraverseStack[stackTop];
    let tokenStart = t_lspOffsetStack[stackTop];
    let parent: u32 = t_lspParentStack[stackTop];
    let len = getNodeByteLength(node);
    let tokenEnd = tokenStart + len;
    
    if (targetOffset >= tokenStart && targetOffset <= tokenEnd) {
       let update = true;
       if (bestMatch != 0) {
          let bestLen = getNodeByteLength(bestMatch);
          if (tokenStart == bestStart && len == bestLen) {
             let bestType = getNodeType(bestMatch);
             let nodeType = getNodeType(node);
             if (bestType > (MAX_TERMINAL_ID as u16) && nodeType <= (MAX_TERMINAL_ID as u16)) {
                update = true;
             } else if (bestType <= (MAX_TERMINAL_ID as u16) && nodeType > (MAX_TERMINAL_ID as u16)) {
                update = false;
             }
          }
       }
       if (update) {
          bestMatch = node;
          bestParent = parent;
          bestStart = tokenStart;
       }
    }
    
    if (targetOffset < tokenStart || targetOffset > tokenEnd) {
       continue;
    }
    
    let child = getNodeFirstChild(node);
    if (child != 0) {
      let childCount: i32 = 0;
      let c = child;
      while (c != 0) { childCount++; c = getNodeNextSibling(c); }

      ensureTraverseStack(stackTop + childCount);
      let currOffset = tokenStart;
      let writeIdx: i32 = stackTop + childCount - 1;
      let isFirstChild = true;
      c = child;
      while (c != 0) {
         let cPad = getNodeLeadingPad(c);
         let cLen = getNodeByteLength(c);
         if (!isFirstChild) {
            currOffset += cPad;
         }
         if (writeIdx >= 0) {
            t_lspTraverseStack[writeIdx] = c;
            t_lspOffsetStack[writeIdx] = currOffset;
            t_lspParentStack[writeIdx] = node;
            writeIdx--;
         }
         currOffset += cLen;
         isFirstChild = false;
         c = getNodeNextSibling(c);
      }
      stackTop += childCount;
    }
  }

  if (bestMatch == 0) return 0;

  let nodeType = getNodeType(bestMatch);
  let targetNode: u32 = 0;
  let replaceStart: u32 = cursorOffset;
  let replaceEnd: u32 = cursorOffset;

  // Case 1: Cursor is directly at or after a punctuation terminal
  if (nodeType <= (MAX_TERMINAL_ID as u16)) {
    if (bestParent != 0) {
      let firstChild = getNodeFirstChild(bestParent);
      if (firstChild != 0 && firstChild != bestMatch) {
        let prev: u32 = firstChild;
        let c: u32 = getNodeNextSibling(firstChild);
        while (c != 0 && c != bestMatch) {
          prev = c;
          c = getNodeNextSibling(c);
        }
        if (prev != 0 && prev != bestMatch) {
          targetNode = prev;
          replaceStart = bestStart + getNodeByteLength(bestMatch);
          replaceEnd = cursorOffset;
        }
      }
    }
  } else {
    // Case 2: Cursor is inside an identifier that has an operator sibling to the left
    if (bestParent != 0) {
      let firstChild = getNodeFirstChild(bestParent);
      let prevOp: u32 = 0;
      let prevTarget: u32 = 0;
      let c = firstChild;
      while (c != 0 && c != bestMatch) {
        let cType = getNodeType(c);
        if (cType <= (MAX_TERMINAL_ID as u16)) {
          prevOp = c;
        } else {
          prevTarget = c;
        }
        c = getNodeNextSibling(c);
      }
      if (prevOp != 0 && prevTarget != 0) {
        targetNode = prevTarget;
        replaceStart = bestStart;
        replaceEnd = bestStart + getNodeByteLength(bestMatch);
      }
    }
  }

  if (targetNode == 0) return 0;

  let targetStart = lsp_findNodeOffset(rootNode, targetNode, 0);
  if (targetStart < 0) return 0;
  let targetEnd = (targetStart as u32) + getNodeByteLength(targetNode);

  t_lspBinaryBuffer.push(targetStart as u32);
  t_lspBinaryBuffer.push(targetEnd as u32);
  t_lspBinaryBuffer.push(replaceStart);
  t_lspBinaryBuffer.push(replaceEnd);
  flushBinaryBuffer();

  return 4;
}

// ----------------------------------------------------------------------------
// Tier 4 Item 14: Changed Ranges Computation (Tree Diffing)
// ----------------------------------------------------------------------------

function pushCoalescedChangedRange(start: u32, end: u32): void {
  let len = t_lspBinaryBuffer.length;
  if (len >= 2) {
    let lastStart = t_lspBinaryBuffer[len - 2];
    let lastEnd = t_lspBinaryBuffer[len - 1];
    // If adjacent or overlapping, merge
    if (start <= lastEnd) {
      if (end > lastEnd) {
        t_lspBinaryBuffer[len - 1] = end;
      }
      return;
    }
  }
  t_lspBinaryBuffer.push(start);
  t_lspBinaryBuffer.push(end);
}

/**
 * Compares oldTree and newTree and serializes changed byte ranges into t_lspBinaryBuffer.
 * Each range is a pair of [startByte, endByte].
 * Returns the number of changed ranges.
 */
export function lsp_getChangedRanges(oldTree: u32, newTree: u32): u32 {
  ensureLspBuffers();
  t_lspBinaryBuffer.clear();

  if (oldTree == 0 || newTree == 0) {
    if (newTree != 0) {
      let pad = getNodePadding(newTree);
      let len = getNodeByteLength(newTree);
      t_lspBinaryBuffer.push(pad);
      t_lspBinaryBuffer.push(pad + len);
    }
    flushBinaryBuffer();
    return t_lspBinaryBuffer.length / 2;
  }

  if (oldTree == newTree) {
    flushBinaryBuffer();
    return 0;
  }

  let oldMerkle = getNodeMerkleHash(oldTree);
  let newMerkle = getNodeMerkleHash(newTree);
  if (oldMerkle != 0 && oldMerkle == newMerkle) {
    flushBinaryBuffer();
    return 0;
  }

  let maxStack: u32 = 2048;
  let oStack = changetype<UnmanagedUint32Array>(atomicChunkAlloc(maxStack * 4));
  let nStack = changetype<UnmanagedUint32Array>(atomicChunkAlloc(maxStack * 4));
  let oOffsetStack = changetype<UnmanagedUint32Array>(atomicChunkAlloc(maxStack * 4));
  let nOffsetStack = changetype<UnmanagedUint32Array>(atomicChunkAlloc(maxStack * 4));
  let sp: u32 = 0;

  oStack[0] = oldTree;
  nStack[0] = newTree;
  oOffsetStack[0] = getNodePadding(oldTree);
  nOffsetStack[0] = getNodePadding(newTree);
  sp++;

  while (sp > 0) {
    sp--;
    let oNode = oStack[sp];
    let nNode = nStack[sp];
    let oStart = oOffsetStack[sp];
    let nStart = nOffsetStack[sp];

    if (oNode == nNode) continue;

    let oM = getNodeMerkleHash(oNode);
    let nM = getNodeMerkleHash(nNode);
    if (oM != 0 && oM == nM) continue;

    let oType = getNodeType(oNode);
    let nType = getNodeType(nNode);
    let oLen = getNodeByteLength(oNode);
    let nLen = getNodeByteLength(nNode);

    let oChild = getNodeFirstChild(oNode);
    let nChild = getNodeFirstChild(nNode);

    if (oType != nType || oChild == 0 || nChild == 0) {
      let rStart = nStart < oStart ? nStart : oStart;
      let oEnd = oStart + oLen;
      let nEnd = nStart + nLen;
      let rEnd = nEnd > oEnd ? nEnd : oEnd;
      pushCoalescedChangedRange(rStart, rEnd);
      continue;
    }

    let oChildCount: u32 = 0;
    let oc = oChild;
    while (oc != 0) { oChildCount++; oc = getNodeNextSibling(oc); }

    let nChildCount: u32 = 0;
    let nc = nChild;
    while (nc != 0) { nChildCount++; nc = getNodeNextSibling(nc); }

    if (oChildCount == nChildCount && sp + oChildCount < maxStack) {
      let oOffsets = changetype<UnmanagedUint32Array>(atomicChunkAlloc(oChildCount * 4));
      let nOffsets = changetype<UnmanagedUint32Array>(atomicChunkAlloc(nChildCount * 4));
      let oNodes = changetype<UnmanagedUint32Array>(atomicChunkAlloc(oChildCount * 4));
      let nNodes = changetype<UnmanagedUint32Array>(atomicChunkAlloc(nChildCount * 4));

      let currO = oStart;
      let curChild = oChild;
      for (let i: u32 = 0; i < oChildCount; i++) {
        if (i > 0) currO += getNodePadding(curChild);
        oOffsets[i] = currO;
        oNodes[i] = curChild;
        currO += getNodeByteLength(curChild);
        curChild = getNodeNextSibling(curChild);
      }

      let currN = nStart;
      curChild = nChild;
      for (let i: u32 = 0; i < nChildCount; i++) {
        if (i > 0) currN += getNodePadding(curChild);
        nOffsets[i] = currN;
        nNodes[i] = curChild;
        currN += getNodeByteLength(curChild);
        curChild = getNodeNextSibling(curChild);
      }

      for (let i: i32 = (oChildCount as i32) - 1; i >= 0; i--) {
        let oC = oNodes[i as u32];
        let nC = nNodes[i as u32];
        oStack[sp] = oC;
        nStack[sp] = nC;
        oOffsetStack[sp] = oOffsets[i as u32];
        nOffsetStack[sp] = nOffsets[i as u32];
        sp++;
      }
    } else {
      let rStart = nStart < oStart ? nStart : oStart;
      let oEnd = oStart + oLen;
      let nEnd = nStart + nLen;
      let rEnd = nEnd > oEnd ? nEnd : oEnd;
      pushCoalescedChangedRange(rStart, rEnd);
    }
  }

  flushBinaryBuffer();
  return t_lspBinaryBuffer.length / 2;
}

// ----------------------------------------------------------------------------
// Tier 4 Item 12: Semantic Tokens Delta Protocol
// ----------------------------------------------------------------------------

let t_prevSemanticTokens: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
let t_currentResultId: u32 = 0;

export function lsp_semanticTokens_delta(astRoot: u32, prevResultId: u32): u32 {
  ensureLspBuffers();

  if (prevResultId == 0 || prevResultId != t_currentResultId || changetype<usize>(t_prevSemanticTokens) == 0 || t_prevSemanticTokens.length == 0) {
    t_currentResultId++;
    let numTokens = lsp_semanticTokens_full(astRoot);
    if (changetype<usize>(t_prevSemanticTokens) == 0) {
      t_prevSemanticTokens = createChunkedUint32Array(1024);
    } else {
      t_prevSemanticTokens.clear();
    }
    let totalInts = numTokens * 4;
    let flatPtr = changetype<usize>(t_lspFlatBinaryBuffer);
    for (let i: u32 = 0; i < totalInts; i++) {
      t_prevSemanticTokens.push(load<u32>(flatPtr + (i << 2)));
    }
    return 0; // 0 edits signals client to request full
  }

  let currTokensCount = lsp_semanticTokens_full(astRoot);
  let currTotalInts = currTokensCount * 4;
  let prevTotalInts = t_prevSemanticTokens.length;
  let currFlatPtr = changetype<usize>(t_lspFlatBinaryBuffer);

  let prefixLen: u32 = 0;
  while (prefixLen < prevTotalInts && prefixLen < currTotalInts) {
    let pVal = t_prevSemanticTokens[prefixLen];
    let cVal = load<u32>(currFlatPtr + (prefixLen << 2));
    if (pVal != cVal) break;
    prefixLen++;
  }

  let suffixLen: u32 = 0;
  while (suffixLen < (prevTotalInts - prefixLen) && suffixLen < (currTotalInts - prefixLen)) {
    let pVal = t_prevSemanticTokens[prevTotalInts - 1 - suffixLen];
    let cVal = load<u32>(currFlatPtr + ((currTotalInts - 1 - suffixLen) << 2));
    if (pVal != cVal) break;
    suffixLen++;
  }

  t_lspBinaryBuffer.clear();
  let deleteCount = prevTotalInts - prefixLen - suffixLen;
  let insertCount = currTotalInts - prefixLen - suffixLen;

  if (deleteCount > 0 || insertCount > 0) {
    t_lspBinaryBuffer.push(prefixLen);
    t_lspBinaryBuffer.push(deleteCount);
    t_lspBinaryBuffer.push(insertCount);
    for (let i: u32 = 0; i < insertCount; i++) {
      t_lspBinaryBuffer.push(load<u32>(currFlatPtr + ((prefixLen + i) << 2)));
    }
  }

  t_prevSemanticTokens.clear();
  for (let i: u32 = 0; i < currTotalInts; i++) {
    t_prevSemanticTokens.push(load<u32>(currFlatPtr + (i << 2)));
  }
  t_currentResultId++;

  flushBinaryBuffer();
  return (deleteCount > 0 || insertCount > 0) ? 1 : 0;
}

export function lsp_getSemanticTokensResultId(): u32 {
  return t_currentResultId;
}
