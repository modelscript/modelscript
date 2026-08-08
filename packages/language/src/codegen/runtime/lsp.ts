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
  getInputBuffer,
  debugLog,
  registerRoot,
  dropRoot,
} from "./arena";
import { NODE_TYPE_ERROR, errorCount, t_errorStarts, t_errorEnds } from "./engine";
import { inputLength } from "./parser";
import { UnmanagedUint32Array, ChunkedUint32Array, createChunkedUint32Array } from "./array";
import { UnmanagedMap64To64, createMap64To64 } from "./hashmap";

@inline
function getEncodingStep(): u32 {
  return inputEncoding == 0 ? 1 : (inputEncoding <= 2 ? 2 : 4);
}

// --- LSP Endpoints ---

let t_lspVisitedNodes: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspVisitedCount: u32 = 0;
let t_lspVisitedCapacity: u32 = 0;

let t_lspTraverseStack: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspOffsetStack: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspStackCapacity: u32 = 0;

let t_lspFindTraverseStack: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspFindOffsetStack: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspFindStackCapacity: u32 = 0;

export let globalAstRoot: u32 = 0;

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
}

export function lsp_unregisterDocument(fileId: u32): void {
  if (changetype<usize>(t_documentRoots) != 0) {
    let oldRoot = t_documentRoots.get(fileId as u64) as u32;
    if (oldRoot != 0) dropRoot(oldRoot);
    t_documentRoots.set(fileId as u64, 0 as u64);
  }
}

export function lsp_clearDocuments(): void {
  t_documentRoots = changetype<UnmanagedMap64To64>(createMap64To64());
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

export function lsp_getBinaryBuffer(): u32 {
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
  if (t_lspBinaryBuffer.length >= 10000 * 7) return;

  debugLog(555, start, end, lintId);

  debugLog(888, start, end, lintId);
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
    t_lspTraverseStack = changetype<UnmanagedUint32Array>(heap.alloc(t_lspStackCapacity * 4));
    t_lspOffsetStack = changetype<UnmanagedUint32Array>(heap.alloc(t_lspStackCapacity * 4));

    t_lspVisitedCapacity = 50000;
    t_lspVisitedNodes = changetype<UnmanagedUint32Array>(heap.alloc(t_lspVisitedCapacity * 4));

    t_lspFindStackCapacity = 2048;
    t_lspFindTraverseStack = changetype<UnmanagedUint32Array>(heap.alloc(t_lspFindStackCapacity * 4));
    t_lspFindOffsetStack = changetype<UnmanagedUint32Array>(heap.alloc(t_lspFindStackCapacity * 4));
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
    let oldPtr = changetype<usize>(t_lspFlatBinaryBuffer);
    let newPtr = heap.alloc(newCap * 4);
    if (oldPtr != 0) heap.free(oldPtr);
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
        let newPtr = heap.alloc(newCap * 4);
        let oldPtr = changetype<usize>(t_lspVisitedNodes);
        if (oldPtr != 0) {
          memory.copy(newPtr, oldPtr, t_lspVisitedCapacity * 4);
          heap.free(oldPtr);
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
        let newTraverse = heap.alloc(newCap * 4);
        let newOffset = heap.alloc(newCap * 4);
        let oldTraverse = changetype<usize>(t_lspTraverseStack);
        let oldOffset = changetype<usize>(t_lspOffsetStack);
        if (t_lspStackCapacity > 0 && oldTraverse != 0) {
           memory.copy(newTraverse, oldTraverse, t_lspStackCapacity * 4);
           memory.copy(newOffset, oldOffset, t_lspStackCapacity * 4);
           heap.free(oldTraverse);
           heap.free(oldOffset);
        }
        t_lspTraverseStack = changetype<UnmanagedUint32Array>(newTraverse);
        t_lspOffsetStack = changetype<UnmanagedUint32Array>(newOffset);
        t_lspStackCapacity = newCap;
    }
}

@inline
function ensureFindTraverseStack(required: u32): void {
    if (required > t_lspFindStackCapacity) {
        let newCap = t_lspFindStackCapacity * 2;
        while (required > newCap && newCap != 0) newCap *= 2;
        if (newCap == 0) newCap = required;
        let newTraverse = heap.alloc(newCap * 4);
        let newOffset = heap.alloc(newCap * 4);
        let oldTraverse = changetype<usize>(t_lspFindTraverseStack);
        let oldOffset = changetype<usize>(t_lspFindOffsetStack);
        if (t_lspFindStackCapacity > 0 && oldTraverse != 0) {
           memory.copy(newTraverse, oldTraverse, t_lspFindStackCapacity * 4);
           memory.copy(newOffset, oldOffset, t_lspFindStackCapacity * 4);
           heap.free(oldTraverse);
           heap.free(oldOffset);
        }
        t_lspFindTraverseStack = changetype<UnmanagedUint32Array>(newTraverse);
        t_lspFindOffsetStack = changetype<UnmanagedUint32Array>(newOffset);
        t_lspFindStackCapacity = newCap;
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
function lsp_extractDiagnosticsForRoot(astRoot: u32, fileId: u32 = 0): void {
  if (astRoot == 0) return;
  globalAstRoot = astRoot;

  let prevLen = t_lspBinaryBuffer.length;
  ensureTraverseStack(1);

  let stackTop: u32 = 0;
  lsp_clearVisited();
  t_lspTraverseStack[stackTop] = astRoot;
  t_lspOffsetStack[stackTop] = 0;
  stackTop++;

  while (stackTop > 0) {
    if (t_lspBinaryBuffer.length >= 1000 * 7) {
      break;
    }
    stackTop--;
    let node = load<u32>(changetype<usize>(t_lspTraverseStack) + stackTop * 4);
    let offsetStackVal = load<u32>(changetype<usize>(t_lspOffsetStack) + stackTop * 4);
    let start = getOffsetFromStack(offsetStackVal);
    let inError = getInErrorFromStack(offsetStackVal);
    let hasErrorSibling = getHasErrorSiblingFromStack(offsetStackVal);
    let inTainted = getInTaintedFromStack(offsetStackVal);

    if (stackTop > 10000) { break; }

    let step: u32 = getEncodingStep();
    let flags = getNodeFlags(node);
    let pad = getNodePadding(node);
    let len = getNodeByteLength(node);
    let nodeStart = start + pad;
    let nodeEnd = nodeStart + len;
    let type = getNodeType(node);

    debugLog(777, type, nodeStart, nodeEnd);

    let isErrorNode = type == 0 || (type & 0x8000) != 0;
    let firstChild = getNodeFirstChild(node);
    let isLeaf = firstChild == 0;

    let hasInsertedSibling = getHasInsertedSiblingFromStack(offsetStackVal);

    let isTainted = (flags & FLAG_IS_TAINED) != 0;
    let hasErrorFlag = (flags & (FLAG_HAS_ERROR | FLAG_IS_INSERTED)) != 0 || isErrorNode;

    if (hasErrorFlag && isLeaf) {
      let totalInputBytes: u32 = inputLength * step;
      let dStart = nodeStart;
      let dEnd = nodeEnd > nodeStart ? nodeEnd : dStart + step;

      if (nodeStart > 0 && (flags & FLAG_IS_INSERTED) != 0) {
        let scanPos = nodeStart;
        while (scanPos >= step) {
          let c = peekChar(scanPos - step);
          if (c == 10 || c == 13) break;
          let isWS = (c == 32 || c == 9 || c == 0);
          if (!isWS) break;
          scanPos -= step;
        }

        if (scanPos >= step) {
          let cPrev = peekChar(scanPos - step);
          if (cPrev != 10 && cPrev != 13 && cPrev != 32 && cPrev != 9 && cPrev != 0) {
            let wordEnd = scanPos;
            let wordStart = scanPos - step;
            while (wordStart >= step) {
              let c = peekChar(wordStart - step);
              if (c == 10 || c == 13 || c == 32 || c == 9 || c == 0) break;
              wordStart -= step;
            }
            if (wordEnd > wordStart) {
              dStart = wordStart;
              dEnd = wordEnd;
            }
          }
        }
      }

      if (totalInputBytes > 0 && dEnd > totalInputBytes) {
        dEnd = totalInputBytes;
        if (dEnd > step) dStart = dEnd - step;
        else dStart = 0;
      }
      if (dEnd > dStart) {
        lsp_allocDiagnostic(dStart, dEnd, type);
      }
    } else {
      if (isErrorNode) {
        let totalInputBytes: u32 = inputLength * step;
        let actualStart = nodeStart;
        let actualEnd = nodeEnd > nodeStart ? nodeEnd : nodeStart + step;
        if (actualEnd <= actualStart && firstChild != 0) {
          let childLen = getNodeByteLength(firstChild);
          if (childLen > 0) {
            actualEnd = actualStart + getNodePadding(firstChild) + childLen;
          }
        }
        if (actualEnd <= actualStart) {
          let scanOffset: u32 = 0;
          while (actualStart + scanOffset < totalInputBytes) {
            let c = peekChar(actualStart + scanOffset);
            if (c == 32 || c == 9 || c == 10 || c == 13 || c == 0) break;
            scanOffset += step;
          }
          actualEnd = actualStart + (scanOffset > 0 ? scanOffset : step);
        }
        if (totalInputBytes > 0 && actualEnd > totalInputBytes) {
          actualEnd = totalInputBytes;
        }
        if (actualEnd < actualStart) {
          actualEnd = actualStart;
        }

        // Snap actualStart backward to beginning of word if it landed mid-identifier
        if (actualStart < totalInputBytes) {
          let currChar = peekChar(actualStart);
          let isAlnum = (currChar >= 97 && currChar <= 122) || (currChar >= 65 && currChar <= 90) || (currChar >= 48 && currChar <= 57) || currChar == 95;
          if (isAlnum) {
            while (actualStart >= step) {
              let prevChar = peekChar(actualStart - step);
              let isPrevAlnum = (prevChar >= 97 && prevChar <= 122) || (prevChar >= 65 && prevChar <= 90) || (prevChar >= 48 && prevChar <= 57) || prevChar == 95;
              if (!isPrevAlnum) break;
              actualStart -= step;
            }
          }
        }

        // Snap actualEnd forward to end of word if it landed mid-identifier
        if (actualEnd < totalInputBytes && actualEnd > 0) {
          let prevChar = peekChar(actualEnd - step);
          let isPrevAlnum = (prevChar >= 97 && prevChar <= 122) || (prevChar >= 65 && prevChar <= 90) || (prevChar >= 48 && prevChar <= 57) || prevChar == 95;
          if (isPrevAlnum) {
            while (actualEnd < totalInputBytes) {
              let nextChar = peekChar(actualEnd);
              let isNextAlnum = (nextChar >= 97 && nextChar <= 122) || (nextChar >= 65 && nextChar <= 90) || (nextChar >= 48 && nextChar <= 57) || nextChar == 95;
              if (!isNextAlnum) break;
              actualEnd += step;
            }
          }
        }

        // Clamp actualEnd to never cross newline boundary
        let scanPos = actualStart;
        while (scanPos < actualEnd && scanPos < totalInputBytes) {
          let c = peekChar(scanPos);
          if (c == 10 || c == 13) {
            actualEnd = scanPos;
            break;
          }
          scanPos += step;
        }

        if (actualEnd > actualStart) {
          lsp_allocDiagnostic(actualStart, actualEnd, 0);
        }
      } else {
        executeLints(type, node, nodeStart, nodeEnd);
      }

    // Recurse into children (for both error and non-error nodes)
    let child = getNodeFirstChild(node);
    if (child != 0) {
      let childCount: u32 = 0;
      let countChild = child;
      let failsafe1 = 0;
      while (countChild != 0) {
        if (failsafe1++ > 10000) { break; }
        childCount++;
        countChild = getNodeNextSibling(countChild);
      }

      if (childCount > 0) {
        ensureTraverseStack(stackTop + childCount);
        let currOffset = start;
        let currChildIdx = 0;
        let lastRealOffset = start;
        
        while (child != 0) {
          let padVal = getNodePadding(child);
          let cLen = padVal + getNodeByteLength(child);
          let cFlags = getNodeFlags(child);
          let cType = getNodeType(child);
          let isInserted = (cFlags & FLAG_IS_INSERTED) != 0;
          
          let childStart = isInserted ? lastRealOffset : currOffset;
          
          if (cType != 0 && getNodeByteLength(child) > 0) {
            lastRealOffset = currOffset + padVal + getNodeByteLength(child);
          }
          
          let slot = stackTop + (childCount - 1 - currChildIdx);
          t_lspTraverseStack[slot] = child;
          t_lspOffsetStack[slot] = childStart;
          
          currOffset += cLen;
          currChildIdx++;
          child = getNodeNextSibling(child);
        }
        stackTop += childCount;
      }
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
 * Traverses the AST root to extract and serialize diagnostic error locations.
 * Merges adjacent error nodes and writes 7-u32 tuple records into `t_lspBinaryBuffer`.
 * @param astRoot The root AST node pointer.
 * @returns The number of `u32` records inside `t_lspBinaryBuffer` (7 u32s per diagnostic).
 */
export function lsp_getDiagnostics(astRoot: u32): u32 {
  ensureLspBuffers();
  if (astRoot != 0) {
    lsp_extractDiagnosticsForRoot(astRoot, 0);
  }
  for (let i: i32 = 0; i < errorCount; i++) {
    let s = t_errorStarts[i];
    let e = t_errorEnds[i];
    if (e > s) {
      lsp_allocDiagnostic(s, e, 0);
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
  t_lspOffsetStack[stackTop] = 0;
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
    let nodeStart = start + pad;

    let hasError = (flags & FLAG_HAS_ERROR) != 0;
    
    let semOffset: i32 = -1;
    // @ts-ignore
    if (!isErrorNode && !hasError && (type as i32) <= MAX_SYMBOL_ID) {
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
        let currOffset = start + pad;
        let childOffset: u32 = 0;
        let isFirstChild = true;

      while (child != 0) {
          let cPad = getNodePadding(child);
          let cType = getNodeType(child);
          let cFlags = getNodeFlags(child);
          let cLen = getNodeByteLength(child);
          let isExtra = cType == NODE_TYPE_ERROR;
          
          let effectivePad = isFirstChild ? 0 : cPad;

          if (!isExtra) {
            if (childCount == childIdx) {
              targetChild = child;
              childOffset = currOffset + effectivePad;
              break;
            }
            childCount++;
          }
          currOffset += effectivePad + cLen;
          isFirstChild = false;
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
            
            let maxLen = cLen;
            let step: u32 = getEncodingStep();
            for (let i: u32 = 0; i < cLen; i += step) {
               let c = peekChar(childOffset + i);
               if (c == 10 || c == 13) {
                  maxLen = i;
                  break;
               }
            }
            cLen = maxLen;
            if (cLen == 0) continue;

            let tokenModifiers = 0;
            t_lspBinaryBuffer.push(childOffset);
            t_lspBinaryBuffer.push(cLen);
            t_lspBinaryBuffer.push(tokenTypeId);
            t_lspBinaryBuffer.push(bitmask);
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
      let currOffset = start;
      let writeIdx = stackTop + childCount - 1;
      let errorFlagBit: u32 = (isErrorNode || inError) ? 0x80000000 : 0;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let childByteLen = getNodeByteLength(child);
        let cLen = padVal + childByteLen;
        t_lspTraverseStack[writeIdx] = child;
        t_lspOffsetStack[writeIdx] = currOffset | errorFlagBit;
        writeIdx--;
        currOffset += cLen;
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

function sortSemanticTokens(flatPtr: usize, numTokens: u32): void {
  if (numTokens <= 1) return;
  
  let numI32 = numTokens as i32;
  // Build max heap
  for (let i: i32 = (numI32 >> 1) - 1; i >= 0; i--) {
    heapifySemanticTokens(flatPtr, numTokens, i as u32);
  }
  
  // Extract elements from heap one by one
  for (let i = numTokens - 1; i > 0; i--) {
    swapSemanticTokens(flatPtr, 0, i);
    heapifySemanticTokens(flatPtr, i, 0);
  }
}

function heapifySemanticTokens(flatPtr: usize, n: u32, i: u32): void {
  let largest = i;
  let left = (i << 1) + 1;
  let right = (i << 1) + 2;

  if (left < n) {
    let keyL = load<u32>(flatPtr + (left << 4));
    let keyLargest = load<u32>(flatPtr + (largest << 4));
    if (keyL > keyLargest) largest = left;
  }

  if (right < n) {
    let keyR = load<u32>(flatPtr + (right << 4));
    let keyLargest = load<u32>(flatPtr + (largest << 4));
    if (keyR > keyLargest) largest = right;
  }

  if (largest != i) {
    swapSemanticTokens(flatPtr, i, largest);
    heapifySemanticTokens(flatPtr, n, largest);
  }
}

@inline
function swapSemanticTokens(flatPtr: usize, a: u32, b: u32): void {
  let a16 = a << 4;
  let b16 = b << 4;
  
  let temp0 = load<u32>(flatPtr + a16);
  let temp1 = load<u32>(flatPtr + a16 + 4);
  let temp2 = load<u32>(flatPtr + a16 + 8);
  let temp3 = load<u32>(flatPtr + a16 + 12);

  store<u32>(flatPtr + a16, load<u32>(flatPtr + b16));
  store<u32>(flatPtr + a16 + 4, load<u32>(flatPtr + b16 + 4));
  store<u32>(flatPtr + a16 + 8, load<u32>(flatPtr + b16 + 8));
  store<u32>(flatPtr + a16 + 12, load<u32>(flatPtr + b16 + 12));

  store<u32>(flatPtr + b16, temp0);
  store<u32>(flatPtr + b16 + 4, temp1);
  store<u32>(flatPtr + b16 + 8, temp2);
  store<u32>(flatPtr + b16 + 12, temp3);
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
  globalAstRoot = astRoot;

  let stackTop: u32 = 0;
  t_lspTraverseStack[stackTop] = astRoot;
  t_lspOffsetStack[stackTop] = 0;
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

    let nodeStart = start + pad;
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
      let currOffset = start;
      let writeIdx = stackTop + childCount - 1;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let cLen = padVal + getNodeByteLength(child);
        t_lspTraverseStack[writeIdx] = child;
        t_lspOffsetStack[writeIdx] = packOffsetStack(currOffset, isErrorNode || inError, false, false);
        writeIdx--;
        currOffset += cLen;
        child = getNodeNextSibling(child);
      }
      stackTop += childCount;
    }
  }

  lsp_clearVisited();
  flushBinaryBuffer();
  return t_lspBinaryBuffer.length / 2;
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
  globalAstRoot = astRoot;

  let stackTop: u32 = 0;
  t_lspTraverseStack[stackTop] = astRoot;
  t_lspOffsetStack[stackTop] = 0;
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

    let nodeStart = start + pad;
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
      let currOffset = start;
      let writeIdx = stackTop + childCount - 1;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let cLen = padVal + getNodeByteLength(child);
        t_lspTraverseStack[writeIdx] = child;
        t_lspOffsetStack[writeIdx] = packOffsetStack(currOffset, isErrorNode || inError, false, false);
        writeIdx--;
        currOffset += cLen;
        child = getNodeNextSibling(child);
      }
      stackTop += childCount;
    }
  }

  lsp_clearVisited();
  flushBinaryBuffer();
  return t_lspBinaryBuffer.length / 4;
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
  
  let stackTop = 0;
  t_lspTraverseStack[0] = rootNode;
  t_lspOffsetStack[0] = 0; 
  stackTop = 1;
  
  let bestMatch: u32 = 0;

  while (stackTop > 0) {
    stackTop--;
    let node = t_lspTraverseStack[stackTop];
    let start = t_lspOffsetStack[stackTop];
    
    let pad = getNodePadding(node);
    let len = getNodeByteLength(node);
    
    let tokenStart = start + pad;
    let tokenEnd = tokenStart + len;
    
    if (targetOffset >= tokenStart && targetOffset <= tokenEnd) {
       let update = true;
       if (bestMatch != 0) {
          let bestLen = getNodeByteLength(bestMatch);
          if (tokenStart == lspLastNodeOffset && len == bestLen) {
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
          lspLastNodeOffset = tokenStart;
       }
    }
    
    let fullEnd = start + pad + len;
    if (targetOffset < start || targetOffset > fullEnd) {
       continue;
    }
    
    let child = getNodeFirstChild(node);
    if (child != 0) {
      let currOffset: u32 = start;
      while (child != 0) {
          let cPad = getNodePadding(child);
          let cLen = getNodeByteLength(child);
          let cFullEnd: u32 = currOffset + cPad + cLen;
          if (targetOffset >= currOffset && targetOffset <= cFullEnd) {
             ensureTraverseStack(stackTop + 1);
             t_lspTraverseStack[stackTop] = child;
             t_lspOffsetStack[stackTop] = currOffset;
             stackTop++;
             break; 
          }
          currOffset = cFullEnd;
          child = getNodeNextSibling(child);
       }
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
export function lsp_findNodeOffset(rootNode: u32, targetNode: u32, rootOffset: u32 = 0): i32 {
   ensureFindTraverseStack(1);
   if (rootNode == targetNode) return rootOffset as i32;
   
   let step: u32 = getEncodingStep();
   let stackTop: u32 = 0;
   t_lspFindTraverseStack[0] = rootNode;
   t_lspFindOffsetStack[0] = rootOffset;
   stackTop++;
   
   while (stackTop > 0) {
      stackTop--;
      let current = t_lspFindTraverseStack[stackTop];
      let offset = t_lspFindOffsetStack[stackTop];
      
      let pad = getNodePadding(current) * step;
      let tokenStart = offset + pad;
      
      if (current == targetNode) {
         return tokenStart as i32;
      }
      
      let child = getNodeFirstChild(current);
      if (child != 0) {
         let childCount = 0;
         let c = child;
         while (c != 0) { childCount++; c = getNodeNextSibling(c); }
         
         ensureFindTraverseStack(stackTop + childCount);
         
         let currOffset = offset + pad;
         let writeIdx = stackTop + childCount - 1;
         c = child;
         while (c != 0) {
            let cPad = getNodePadding(c) * step;
            let cLen = cPad + (getNodeByteLength(c) * step);
            t_lspFindTraverseStack[writeIdx] = c;
            t_lspFindOffsetStack[writeIdx] = currOffset;
            writeIdx--;
            currOffset += cLen;
            c = getNodeNextSibling(c);
         }
         stackTop += childCount;
      }
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
                let offset = lsp_findNodeOffset(root, defNode);
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
      startOffset = lsp_findNodeOffset(rootNode, defNode);
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
   let numRoots: u32 = 0;
   // we will just reuse t_lspFindTraverseStack for fileIds and t_lspFindOffsetStack for docRoots since they are not used simultaneously in this function until AFTER.
   // Wait, we DO use lsp_invokeDefinition which uses t_lspFindTraverseStack!
   // So we cannot reuse them. We will use a static unmanaged buffer or just array allocation if we do it manually.
   let allocCap: u32 = 1024;
   if (changetype<usize>(t_documentRoots) != 0 && t_documentRoots.capacity > allocCap) {
      allocCap = t_documentRoots.capacity;
   }
   let tempFileIds = changetype<UnmanagedUint32Array>(heap.alloc(allocCap * 4));
   let tempDocRoots = changetype<UnmanagedUint32Array>(heap.alloc(allocCap * 4));

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

  let span = ast_getTextSpan(root);
  let start = (span >> 32) as u32;
  let len = (span & 0xffffffff) as u32;

  let inBuf = getInputBuffer();
  for (let i: u32 = 0; i < len; i++) {
    let b = load<u8>(inBuf + start + i);
    t_lspBinaryBuffer.push(b as u32);
  }

  flushBinaryBuffer();
  return t_lspBinaryBuffer.length;
}
