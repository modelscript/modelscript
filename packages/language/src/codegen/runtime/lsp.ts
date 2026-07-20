import {
  atomicChunkAlloc,
  FLAG_LSP_VISITED,
  getNodeByteLength,
  getNodeFirstChild,
  getNodeFlags,
  getNodeNextSibling,
  getNodePadding,
  getNodeType,
  nodeHasError,
  setNodeFlags,
  ast_getTextSpan,
  ast_hashSpan,
  ASTNode,
  FLAG_HAS_ERROR,
  FLAG_INVISIBLE,
  FLAG_IS_TAINED,
  FLAG_IS_INSERTED,
  getInputBuffer,
} from "./arena";
import { errorCount, getErrorEnd, getErrorStart, NODE_TYPE_ERROR } from "./engine";
import { inputLength } from "./parser";
import { UnmanagedUint32Array, ChunkedUint32Array, createChunkedUint32Array } from "./array";

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

// --- Binary Serialization ---
let t_lspBinaryBuffer: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
let t_lspFlatBinaryBuffer: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspFlatBinaryCapacity: u32 = 0;

export function lsp_getBinaryBuffer(): u32 {
  return changetype<u32>(t_lspFlatBinaryBuffer);
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
let lastDiagStart: u32 = 0xffffffff;
let lastDiagEnd: u32 = 0xffffffff;

export function lsp_allocDiagnostic(start: u32, end: u32, lintId: u32, arg0: u32 = 0, arg1: u32 = 0, arg2: u32 = 0, arg3: u32 = 0): void {
  if (t_lspBinaryBuffer.length >= 1000 * 7) return;
  // Duplicate diagnostic filtering is now performed in O(N log N) on the JS side
  // via Set/Sort to prevent WASM thread blocking.
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
    t_lspBinaryBuffer.clear();
    t_lspVisitedCount = 0;
  }
}

function flushBinaryBuffer(): void {
  let len = t_lspBinaryBuffer.length;
  if (len > t_lspFlatBinaryCapacity) {
    let newCap = t_lspFlatBinaryCapacity;
    if (newCap == 0) newCap = 50000;
    while (newCap < len) newCap *= 2;
    if (changetype<usize>(t_lspFlatBinaryBuffer) != 0) {
      heap.free(changetype<usize>(t_lspFlatBinaryBuffer));
    }
    t_lspFlatBinaryBuffer = changetype<UnmanagedUint32Array>(heap.alloc(newCap * 4));
    t_lspFlatBinaryCapacity = newCap;
  }
  t_lspBinaryBuffer.copyToFlat(changetype<usize>(t_lspFlatBinaryBuffer));
}


@inline
function pushVisitedNode(node: u32): void {
    if (t_lspVisitedCount >= t_lspVisitedCapacity) {
        let newCap = t_lspVisitedCapacity * 2;
        let newPtr = heap.alloc(newCap * 4);
        memory.copy(newPtr, changetype<usize>(t_lspVisitedNodes), t_lspVisitedCapacity * 4);
        heap.free(changetype<usize>(t_lspVisitedNodes));
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
        while (required > newCap) newCap *= 2;
        let newTraverse = heap.alloc(newCap * 4);
        let newOffset = heap.alloc(newCap * 4);
        memory.copy(newTraverse, changetype<usize>(t_lspTraverseStack), t_lspStackCapacity * 4);
        memory.copy(newOffset, changetype<usize>(t_lspOffsetStack), t_lspStackCapacity * 4);
        heap.free(changetype<usize>(t_lspTraverseStack));
        heap.free(changetype<usize>(t_lspOffsetStack));
        t_lspTraverseStack = changetype<UnmanagedUint32Array>(newTraverse);
        t_lspOffsetStack = changetype<UnmanagedUint32Array>(newOffset);
        t_lspStackCapacity = newCap;
    }
}

function lsp_clearVisited(): void {
  for (let i: u32 = 0; i < t_lspVisitedCount; i++) {
    let node = changetype<ASTNode>(load<u32>(changetype<usize>(t_lspVisitedNodes) + i * 4));
    node.flags &= ~FLAG_LSP_VISITED;
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
export function lsp_getDiagnostics(astRoot: u32): u32 {
  ensureLspBuffers();

  // Note: Engine-level syntax errors (from errorCount/errorQueue) are no longer iterated here.
  // The recovery algorithms (Deletion Recovery, Insertion Recovery, Island Mode) all correctly encode their
  // errors into the AST (as NODE_TYPE_ERROR or zero-length inserted tokens).
  // Relying solely on the AST traversal prevents duplicate diagnostic reporting.

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
    if (t_lspBinaryBuffer.length >= 1000 * 4) {
      break;
    }
    stackTop--;
    let node = load<u32>(changetype<usize>(t_lspTraverseStack) + stackTop * 4);
    let offsetStackVal = load<u32>(changetype<usize>(t_lspOffsetStack) + stackTop * 4);
    let start = getOffsetFromStack(offsetStackVal);
    let inError = getInErrorFromStack(offsetStackVal);
    let hasErrorSibling = getHasErrorSiblingFromStack(offsetStackVal);
    let inTainted = getInTaintedFromStack(offsetStackVal);

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    pushVisitedNode(node);

    let pad = getNodePadding(node);
    let len = getNodeByteLength(node);
    let nodeStart = start + pad;
    let nodeEnd = nodeStart + len;
    let type = getNodeType(node);
    let isErrorNode = type == 0;
    let firstChild = getNodeFirstChild(node);
    let isLeaf = firstChild == 0;

    let hasInsertedSibling = getHasInsertedSiblingFromStack(offsetStackVal);

    let isTainted = (flags & FLAG_IS_TAINED) != 0;

    if ((flags & FLAG_IS_INSERTED) != 0) {
      // Inserted ghost nodes are zero-width phantoms from error recovery.
      // We always emit a diagnostic for them so the user knows what was expected,
      // and so the JS-side merging logic can combine it with adjacent garbage tokens.
      if (!isTainted && !inTainted) {
        let dStart = nodeStart;
        
        // If the inserted token lands on whitespace (e.g. \n), the editor may push the squiggle 
        // to the next line. We scan backwards to anchor the diagnostic on the previous visible character.
        if (dStart > 0) {
          let scan = dStart;
          let step: u32 = inputEncoding == 0 ? 1 : 2;
          while (scan >= step) {
            scan -= step;
            let ch = peekChar(scan);
            if (ch != 32 && ch != 9 && ch != 10 && ch != 13) {
              dStart = scan;
              break;
            }
          }
        }
        
        let dEnd = dStart + (inputEncoding == 0 ? 1 : 2); 
        if (dEnd > inputLength) {
          dEnd = inputLength;
          if (dEnd > 0) dStart = dEnd - (inputEncoding == 0 ? 1 : 2);
          if (dStart < 0) dStart = 0;
        }
        lsp_allocDiagnostic(dStart, dEnd, type);
      }
    } else if (inError || isErrorNode || (isLeaf && (flags & FLAG_HAS_ERROR) != 0)) {
      if (pad > 0 && !isTainted && !inTainted) {
        let inputPtr = getInputBuffer();
        let inGarbage = false;
        let hasFoundGarbage = false;
        let garbageStart: u32 = 0;
        let i: u32 = 0;
        while (i < pad) {
          let c = load<u16>(inputPtr + start + i);
          
          if (c == 10 && hasFoundGarbage) {
            if (inGarbage) {
              lsp_allocDiagnostic(garbageStart, start + i, 0);
              inGarbage = false;
            }
            break;
          }
          
          let cNext: u16 = (i + 2 < pad) ? load<u16>(inputPtr + start + i + 2) : 0;
          
          if (c == 47 && cNext == 47) { // "//"
            if (inGarbage) { lsp_allocDiagnostic(garbageStart, start + i, 0); inGarbage = false; }
            while (i < pad && load<u16>(inputPtr + start + i) != 10) i += 2;
            continue;
          } else if (c == 47 && cNext == 42) { // "/*"
            if (inGarbage) { lsp_allocDiagnostic(garbageStart, start + i, 0); inGarbage = false; }
            i += 4;
            while (i < pad) {
               if (load<u16>(inputPtr + start + i) == 42 && i + 2 < pad && load<u16>(inputPtr + start + i + 2) == 47) {
                  i += 4; break;
               }
               i += 2;
            }
            continue;
          }
          
          let isWs = (c == 32 || c == 9 || c == 10 || c == 13);
          if (!isWs && !inGarbage) {
            inGarbage = true;
            hasFoundGarbage = true;
            garbageStart = start + i;
          } else if (isWs && inGarbage) {
            inGarbage = false;
            lsp_allocDiagnostic(garbageStart, start + i, 0);
          }
          i += 2;
        }
        if (inGarbage) {
          lsp_allocDiagnostic(garbageStart, start + pad, 0);
        }
      }

      if (isLeaf && len > 0 && !isTainted && !inTainted) {
        // Check if token is entirely whitespace
        let allWhitespace = true;
        let inputPtr = getInputBuffer();
        for (let i: u32 = 0; i < len; i += 2) {
          let c = load<u16>(inputPtr + nodeStart + i);
          if (c != 32 && c != 9 && c != 10 && c != 13) {
            allWhitespace = false;
            break;
          }
        }
        
        // Garbage token or token inside discarded Island Mode block
        if (!allWhitespace) {
          lsp_allocDiagnostic(nodeStart, nodeEnd, 0);
        }
      }
    } else if (hasInsertedSibling && isLeaf && len > 0 && !isErrorNode && !isTainted && !inTainted) {
      // Real token consumed by Deletion Recovery into a recovered grammar
      // node (e.g., an 'a' token inside a Usage with inserted ghost 'print').
      // This token is structurally invalid and needs a squiggle even though
      // it's not inside an ERROR node.
      lsp_allocDiagnostic(nodeStart, nodeEnd, 0);
    }

    if (!isTainted && !inTainted) {
      executeLints(type, node, nodeStart, nodeEnd);
    }

    // Recurse into children (for both error and non-error nodes)
    let child = getNodeFirstChild(node);
    if (child != 0) {
      // Count children and check for ERROR / INSERTED siblings in a single pass
      let childCount: u32 = 0;
      let childHasError: boolean = false;
      let countChild = child;
      while (countChild != 0) {
        let cFlags = getNodeFlags(countChild);
        let cType = getNodeType(countChild);
        
        if ((cFlags & FLAG_HAS_ERROR) != 0 || cType == 0) {
            childHasError = true;
        }
        
        childCount++;
        countChild = getNodeNextSibling(countChild);
      }

      ensureTraverseStack(stackTop + childCount);
      // Single-pass: push children backwards directly to achieve in-order traversal via LIFO pop
      let isParentZeroWidth = (getNodeByteLength(node) == 0);
      let currOffset = isParentZeroWidth ? start : (start + pad); // nodeStart
      let writeIdx = stackTop + childCount - 1;
      let currChildIdx = 0;
      let lastRealOffset = isParentZeroWidth ? start : (start + pad);
      
      while (child != 0) {
        let padVal = getNodePadding(child);
        let cLen = padVal + getNodeByteLength(child);
        let cFlags = getNodeFlags(child);
        let cType = getNodeType(child);
        let isInserted = (cFlags & FLAG_IS_INSERTED) != 0 || (getNodeByteLength(child) == 0);
        
        let childStart = isInserted ? lastRealOffset : currOffset;
        
        let comesAfter = false;
        if (cType != 0 && getNodeByteLength(child) > 0) {
          let lookahead = getNodeNextSibling(child);
          while (lookahead != 0) {
            let lFlags = getNodeFlags(lookahead);
            let lType = getNodeType(lookahead);
            if ((lFlags & FLAG_IS_INSERTED) != 0) {
              comesAfter = true;
              break;
            }
            if (lType != 0 && getNodeByteLength(lookahead) > 0) {
              break;
            }
            lookahead = getNodeNextSibling(lookahead);
          }
        }
        
        let passInsertedSibling = comesAfter || (hasInsertedSibling && currChildIdx == 0);
        
         t_lspTraverseStack[writeIdx] = child;
        let nextInError = (isErrorNode || inError);
        let nextInTainted = isTainted || inTainted;
        t_lspOffsetStack[writeIdx] = packOffsetStack(childStart, nextInError, childHasError || hasErrorSibling, passInsertedSibling, nextInTainted);
        writeIdx--;
        currOffset += cLen;
        if (!isInserted) {
          lastRealOffset = currOffset;
        }
        child = getNodeNextSibling(child);
        currChildIdx++;
      }
      stackTop += childCount;
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


  if (astRoot == 0) return 0;
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
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    if ((flags & FLAG_IS_TAINED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    
    pushVisitedNode(node);

    let pad = getNodePadding(node);
    let len = getNodeByteLength(node);
    let type = getNodeType(node);
    let isErrorNode = type == 0;
    let nodeStart = start + pad;

    // Skip semantic token emission for:
    // 1. ERROR nodes (type == 0) — no valid grammar structure
    // 2. Nodes inside error subtrees (inError) — unreliable offsets
    // 3. Nodes with FLAG_HAS_ERROR — contain error recovery artifacts
    // 4. Nodes with any FLAG_IS_INSERTED child — Deletion Recovery
    //    inserted ghost tokens that shift child positions incorrectly
    let hasError = (flags & FLAG_HAS_ERROR) != 0;
    
    let semOffset: i32 = -1;
    if (!isErrorNode) {
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
          // Skip error nodes and tainted nodes from the child index count.
          // Error nodes pulled in by isPureErrorNode recovery reductions are
          // not grammar-compiled children, so counting them corrupts childIdx.
          // Tainted nodes are synthetic zero-width recovery phantoms.
          let isExtra = (cFlags & FLAG_IS_TAINED) != 0 || cType == NODE_TYPE_ERROR;
          
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
          let cLen = getNodeByteLength(targetChild);
          if (cLen > 0) {
  

            // Clamp offset + length to inputLength to prevent out-of-bounds tokens
            // that would cause Monaco to reject the entire semantic tokens response
            if (childOffset > inputLength) continue;
            if (cLen > inputLength || childOffset + cLen > inputLength || childOffset + cLen < childOffset) {
              cLen = inputLength - childOffset;
            }
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
      let currOffset = start + pad;
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
  return t_lspBinaryBuffer.length / 4;
}

/**
 * Extracts all foldable block ranges from the AST.
 * Filters nodes based on the generated `type_is_folding` boolean map.
 * @returns The number of folding records inside `t_lspBinaryBuffer` (2 u32s per range).
 */
export function lsp_getFoldingRanges(astRoot: u32): u32 {
  ensureLspBuffers();


  if (astRoot == 0) return 0;
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
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    if ((flags & FLAG_IS_TAINED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    
    pushVisitedNode(node);

    let pad = getNodePadding(node);
    let type = getNodeType(node);
    let isErrorNode = type == 0;

    let nodeStart = start + pad;
    let nodeEnd = nodeStart + getNodeByteLength(node);

    let isFolding = load<u32>(type_is_folding + (type << 2));
    if (isFolding != 0 && !inError) {

      t_lspBinaryBuffer.push(nodeStart);
      t_lspBinaryBuffer.push(nodeEnd);
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
      let currOffset = start + pad;
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


  if (astRoot == 0) return 0;
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
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    if ((flags & FLAG_IS_TAINED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    
    pushVisitedNode(node);

    let pad = getNodePadding(node);
    let type = getNodeType(node);
    let isErrorNode = type == 0;

    let nodeStart = start + pad;
    let nodeEnd = nodeStart + getNodeByteLength(node);

    let isOutline = load<u32>(type_is_outline + (type << 2));
    if (isOutline != 0 && !inError) {

      t_lspBinaryBuffer.push(nodeStart);
      t_lspBinaryBuffer.push(nodeEnd);
      t_lspBinaryBuffer.push(type);
      t_lspBinaryBuffer.push(node);
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
      let currOffset = start + pad;
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
       ensureTraverseStack(stackTop + 1);
      let currOffset = start + pad;
      while (child != 0) {
          let cPad = getNodePadding(child);
          let cLen = getNodeByteLength(child);
          let cFullEnd = currOffset + cPad + cLen;
          if (targetOffset >= currOffset && targetOffset <= cFullEnd) {
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
 * Performs a brute-force traversal to calculate the absolute byte offset of a target node
 * by accumulating the padding and lengths of all preceding sibling chains.
 * @returns The absolute `startByte`, or -1 if the target node is disconnected from the root.
 */
export function lsp_findNodeOffset(rootNode: u32, targetNode: u32): i32 {
   ensureLspBuffers();
   if (rootNode == targetNode) return 0;
   
   let stackTop: u32 = 0;
   t_lspFindTraverseStack[0] = rootNode;
   t_lspFindOffsetStack[0] = 0;
   stackTop++;
   
   while (stackTop > 0) {
      stackTop--;
      let current = t_lspFindTraverseStack[stackTop];
      let offset = t_lspFindOffsetStack[stackTop];
      
      let pad = getNodePadding(current);
      let tokenStart = offset + pad;
      
      if (current == targetNode) {
         return tokenStart as i32;
      }
      
      let child = getNodeFirstChild(current);
      if (child != 0) {
         let currOffset = offset;
         // Push children in reverse order so they are popped left-to-right
         let childCount = 0;
         let c = child;
      while (c != 0) { childCount++; c = getNodeNextSibling(c); }
         
         // Push in reverse
         currOffset = offset + pad;
         let writeIdx = stackTop + childCount - 1;
         c = child;
         while (c != 0) {
            let cPad = getNodePadding(c);
            let cLen = cPad + getNodeByteLength(c);
            t_lspFindTraverseStack[writeIdx] = c;
            t_lspFindOffsetStack[writeIdx] = currOffset;
            writeIdx--;
            currOffset += cLen;
            c = getNodeNextSibling(c);
         }
         stackTop += childCount;
      }
   }
   return 12345;
}

/**
 * Triggers a `Go to Definition` LSP request.
 * Locates the node under the cursor, queries the graph for its definition,
 * and serializes the target's start and end byte offsets.
 */
export function lsp_getDefinition(rootNode: u32, targetOffset: u32): u32 {
   let node = lsp_getNodeAtByteOffset(rootNode, targetOffset);
   if (node == 0) return 0;
   globalAstRoot = rootNode;
   
   let defNode = lsp_invokeDefinition(node);
   if (defNode == 0) return 0;
   
   let startOffset = lsp_findNodeOffset(rootNode, defNode);
   if (startOffset < 0) return 0;
   
   let start = startOffset as u32;
   let end = start + getNodeByteLength(defNode);
   
   ensureLspBuffers();
   
   t_lspBinaryBuffer.push(start as u32);
   t_lspBinaryBuffer.push(end as u32);
   flushBinaryBuffer();
   return 2;
}

/**
 * Triggers a `Find All References` LSP request.
 * Resolves the definition for the node under the cursor, then scans the entire AST
 * to find all identifiers with identical text spans that point back to the exact same definition node.
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
   
   let stackTop: u32 = 0;
   t_lspTraverseStack[0] = rootNode;
   t_lspOffsetStack[0] = 0;
   stackTop++;
   
   while (stackTop > 0) {
      stackTop--;
      let current = t_lspTraverseStack[stackTop];
      let offset = t_lspOffsetStack[stackTop];
      
      let child = getNodeFirstChild(current);
      
      let len = getNodeByteLength(current);
      let pad = getNodePadding(current);
      
      // Candidate filtering by length and string hash
      if (len == targetLen) {
         let tokenStart = offset + pad;
         let span = ast_getTextSpan(current, tokenStart);
         if (ast_hashSpan(span) == targetHash) {
            // Semantic verification
            let candidateDef = lsp_invokeDefinition(current);
            if (candidateDef == defNode) {
               // Confirmed reference!
               
               t_lspBinaryBuffer.push(tokenStart);
               t_lspBinaryBuffer.push(tokenStart + len);
            }
         }
      }
      
      if (child == 0) {
         // Leaf node, nothing more to push
      } else {
         let currOffset = offset + pad;
         // Push children in reverse order so they are processed left-to-right
         // We can do this with a secondary loop or just traverse, order doesn't matter for references
         while (child != 0) {
            let cPad = getNodePadding(child);
            let cLen = cPad + getNodeByteLength(child);
            ensureTraverseStack(stackTop + 1);
            t_lspTraverseStack[stackTop] = child;
            t_lspOffsetStack[stackTop] = currOffset;
            stackTop++;
            
            currOffset += cLen;
            child = getNodeNextSibling(child);
         }
      }
   }
   
   flushBinaryBuffer();
  return t_lspBinaryBuffer.length / 2;
}
