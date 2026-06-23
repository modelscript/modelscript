// @ts-nocheck

import {
  atomicChunkAlloc,
  FLAG_LSP_VISITED,
  getNodeByteLength,
  getNodeFirstChild,
  getNodeFlags,
  getNodeNextSibling,
  getNodePadding,
  getNodeType,
  setNodeFlags,
  ast_getTextSpan,
  ast_hashSpan,
} from "./arena";
import { errorCount, getErrorEnd, getErrorStart } from "./engine";
import { inputLength } from "./parser";

// --- LSP Endpoints ---

let t_lspTraverseStack: u32 = 0;
let t_lspOffsetStack: u32 = 0;
let t_lspVisitedNodes: u32 = 0;
let lspVisitedCount: u32 = 0;
let t_lspFindTraverseStack: u32 = 0;
let t_lspFindOffsetStack: u32 = 0;
let lspFindTraverseCapacity: u32 = 0;
let lspTraverseCapacity: u32 = 50000;

export let globalAstRoot: u32 = 0;
let lspVisitedCapacity: u32 = 50000;

// --- Binary Serialization ---
let t_lspBinaryBuffer: u32 = 0;
let lspBinaryLength: u32 = 0;
let lspBinaryCapacity: u32 = 50000; // Initial capacity, grows dynamically

export function lsp_getBinaryBuffer(): u32 {
  return t_lspBinaryBuffer;
}
export function lsp_getBinaryLength(): u32 {
  return lspBinaryLength;
}

import { debugLog } from "./engine";

/**
 * Allocates an unmanaged diagnostic token into the binary buffer for LSP transfer.
 * Includes logic to merge adjacent or overlapping diagnostics with the same `lintId`.
 * If the buffer capacity is exceeded, it dynamically chunks a larger `t_lspBinaryBuffer`.
 */
export function lsp_allocDiagnostic(start: u32, end: u32, lintId: u32, argPtr: u32): void {
  debugLog(start, end, lintId, argPtr);
  if (lspBinaryLength > 0 && lintId == 0) {
    let lastLintId = load<u32>(t_lspBinaryBuffer + (lspBinaryLength - 1) * 4);
    if (lastLintId == 0) {
      let lastEnd = load<u32>(t_lspBinaryBuffer + (lspBinaryLength - 2) * 4);
      let lastStart = load<u32>(t_lspBinaryBuffer + (lspBinaryLength - 3) * 4);
      // Merge if adjacent or overlapping
      if (start <= lastEnd) {
        if (end > lastEnd) {
          store<u32>(t_lspBinaryBuffer + (lspBinaryLength - 2) * 4, end);
        }
        if (start < lastStart) {
          store<u32>(t_lspBinaryBuffer + (lspBinaryLength - 3) * 4, start);
        }
        return;
      }
    }
  }
  if (lspBinaryLength + 4 > lspBinaryCapacity) {
    // Grow the binary buffer dynamically instead of silently dropping diagnostics
    let newCapacity = lspBinaryCapacity * 2;
    let newBuffer = atomicChunkAlloc(newCapacity * 4);
    memory.copy(newBuffer, t_lspBinaryBuffer, lspBinaryLength * 4);
    t_lspBinaryBuffer = newBuffer;
    lspBinaryCapacity = newCapacity;
  }
  store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, start);
  store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, end);
  store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, lintId);
  store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, argPtr);
}

/**
 * Clears the `FLAG_LSP_VISITED` bit on all AST nodes that were touched during the current traversal.
 * Essential for resetting cycle-detection state before the next incremental parse or LSP query.
 */
function lsp_clearVisited(): void {
  for (let i: u32 = 0; i < lspVisitedCount; i++) {
    let node = load<u32>(t_lspVisitedNodes + i * 4);
    let val = load<u32>(node, 0);
    if (((val >> 10) & FLAG_LSP_VISITED) != 0) {
      store<u32>(node, val & ~((<u32>FLAG_LSP_VISITED) << 10), 0);
    }
  }
  lspVisitedCount = 0;
}

/**
 * Grows the traverse and offset stacks to at least `required` capacity.
 * Copies existing data from [0, stackTop) into the new buffers.
 */
function growTraverseStacks(required: u32, stackTop: u32): void {
  let newCapacity = lspTraverseCapacity;
  while (newCapacity < required) newCapacity *= 2;
  let newTraverse = atomicChunkAlloc(newCapacity * 4);
  let newOffset = atomicChunkAlloc(newCapacity * 4);
  if (stackTop > 0) {
    memory.copy(newTraverse, t_lspTraverseStack, stackTop * 4);
    memory.copy(newOffset, t_lspOffsetStack, stackTop * 4);
  }
  t_lspTraverseStack = newTraverse;
  t_lspOffsetStack = newOffset;
  lspTraverseCapacity = newCapacity;
}

/**
 * Grows the visited nodes buffer to at least `required` capacity.
 * Copies existing data from [0, lspVisitedCount) into the new buffer.
 */
function growVisitedBuffer(required: u32): void {
  let newCapacity = lspVisitedCapacity;
  while (newCapacity < required) newCapacity *= 2;
  let newBuffer = atomicChunkAlloc(newCapacity * 4);
  if (lspVisitedCount > 0) {
    memory.copy(newBuffer, t_lspVisitedNodes, lspVisitedCount * 4);
  }
  t_lspVisitedNodes = newBuffer;
  lspVisitedCapacity = newCapacity;
}

/**
 * Extracts and serializes all syntax and grammar diagnostics into a flat `u32` buffer.
 * Traverses the AST looking for injected error nodes and missing ghost nodes.
 * @param astRoot The root node pointer of the parsed tree.
 * @returns The number of `u32` records inside `t_lspBinaryBuffer` (4 u32s per diagnostic).
 */
export function lsp_getDiagnostics(astRoot: u32): u32 {
  if (t_lspBinaryBuffer == 0) {
    t_lspBinaryBuffer = atomicChunkAlloc(lspBinaryCapacity * 4);
    t_lspTraverseStack = atomicChunkAlloc(lspTraverseCapacity * 4);
    t_lspOffsetStack = atomicChunkAlloc(lspTraverseCapacity * 4);
    t_lspVisitedNodes = atomicChunkAlloc(lspVisitedCapacity * 4);
  }

  lspBinaryLength = 0;
  lspVisitedCount = 0;

  // 1. Add all engine-level syntax errors (from parse failures)
  for (let i: i32 = 0; i < errorCount; i++) {
    lsp_allocDiagnostic(getErrorStart(i), getErrorEnd(i), 0, 0);
  }

  if (astRoot == 0) return lspBinaryLength / 4;

  globalAstRoot = astRoot;

  let stackTop: u32 = 0;
  store<u32>(t_lspTraverseStack + stackTop * 4, astRoot);
  store<u32>(t_lspOffsetStack + stackTop * 4, 0);
  stackTop++;

  while (stackTop > 0) {
    stackTop--;
    let node = load<u32>(t_lspTraverseStack + stackTop * 4);
    let start = load<u32>(t_lspOffsetStack + stackTop * 4);

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    // Grow visited buffer if needed
    if (lspVisitedCount >= lspVisitedCapacity) {
      growVisitedBuffer(lspVisitedCount + 1);
    }
    store<u32>(t_lspVisitedNodes + lspVisitedCount++ * 4, node);

    let pad = getNodePadding(node);
    let len = getNodeByteLength(node);
    let nodeStart = start + pad;
    let nodeEnd = nodeStart + len;
    let type = getNodeType(node);

    let isErrorNode = type == 0;
    let firstChild = getNodeFirstChild(node);

    // Emit diagnostics only for LEAF error nodes.
    // Non-leaf ERROR nodes are structural wrappers (e.g., the root that wraps
    // accepted content + trailing errors). Their error ranges are already
    // reported through engine-level reportError() calls.
    if (isErrorNode && firstChild == 0 && len > 0) {
      lsp_allocDiagnostic(nodeStart, nodeEnd, 0, 0);
    } else if (firstChild == 0 && len == 0 && type <= MAX_TERMINAL_ID) {
      // Missing terminal (ghost node inserted by error recovery)
      lsp_allocDiagnostic(nodeStart, nodeStart, type, 0);
    }

    executeLints(type, node, nodeStart, nodeEnd);

    // Recurse into children (for both error and non-error nodes)
    let child = getNodeFirstChild(node);
    if (child != 0) {
      // Count children first to check capacity
      let childCount: u32 = 0;
      let countChild = child;
      while (countChild != 0) {
        childCount++;
        countChild = getNodeNextSibling(countChild);
      }

      // Grow traverse stacks if needed
      if (stackTop + childCount > lspTraverseCapacity) {
        growTraverseStacks(stackTop + childCount, stackTop);
      }

      // Single-pass: push children backwards directly to achieve in-order traversal via LIFO pop
      let currOffset = start;
      let writeIdx = stackTop + childCount - 1;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let cLen = padVal + getNodeByteLength(child);
        store<u32>(t_lspTraverseStack + writeIdx * 4, child);
        store<u32>(t_lspOffsetStack + writeIdx * 4, currOffset);
        writeIdx--;
        currOffset += cLen;
        child = getNodeNextSibling(child);
      }
      stackTop += childCount;
    }
  }

  lsp_clearVisited();
  return lspBinaryLength / 4;
}

/**
 * Extracts and serializes Semantic Tokens for syntax highlighting.
 * Operates purely on the unmanaged heap to format tokens strictly ordered by byte offset.
 * Uses static semantic maps (`type_semantics`) embedded by the code generator.
 * @returns The number of semantic token primitives inside `t_lspBinaryBuffer`.
 */
export function lsp_semanticTokens_full(astRoot: u32): u32 {
  if (t_lspBinaryBuffer == 0) {
    t_lspBinaryBuffer = atomicChunkAlloc(lspBinaryCapacity * 4);
    t_lspTraverseStack = atomicChunkAlloc(lspTraverseCapacity * 4);
    t_lspOffsetStack = atomicChunkAlloc(lspTraverseCapacity * 4);
    t_lspVisitedNodes = atomicChunkAlloc(lspVisitedCapacity * 4);
  }

  lspBinaryLength = 0;
  lspVisitedCount = 0;

  if (astRoot == 0) return 0;
  globalAstRoot = astRoot;

  let stackTop: u32 = 0;
  store<u32>(t_lspTraverseStack + stackTop * 4, astRoot);
  store<u32>(t_lspOffsetStack + stackTop * 4, 0);
  stackTop++;

  while (stackTop > 0) {
    stackTop--;
    let node = load<u32>(t_lspTraverseStack + stackTop * 4);
    let start = load<u32>(t_lspOffsetStack + stackTop * 4);

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    if (lspVisitedCount >= lspVisitedCapacity) {
      growVisitedBuffer(lspVisitedCount + 1);
    }
    store<u32>(t_lspVisitedNodes + lspVisitedCount++ * 4, node);

    let pad = getNodePadding(node);
    let type = getNodeType(node);

    let semOffset = load<i32>(type_semantics + type * 4);
    if (semOffset != -1) {
      let numSemantics = load<i32>(type_semantic_data + semOffset * 4);
      for (let i = 0; i < numSemantics; i++) {
        let childIdx = load<i32>(type_semantic_data + (semOffset + 1 + i * 3) * 4);
        let tokenTypeId = load<i32>(type_semantic_data + (semOffset + 1 + i * 3 + 1) * 4);
        let bitmask = load<i32>(type_semantic_data + (semOffset + 1 + i * 3 + 2) * 4);

        let child = getNodeFirstChild(node);
        let childCount = 0;
        let targetChild: u32 = 0;
        let currOffset = start;
        let childOffset = 0;

        while (child != 0) {
          let cPad = getNodePadding(child);
          if (childCount == childIdx) {
            targetChild = child;
            childOffset = currOffset + cPad;
            break;
          }
          currOffset += cPad + getNodeByteLength(child);
          childCount++;
          child = getNodeNextSibling(child);
        }

        if (targetChild != 0) {
          if (lspBinaryLength + 4 > lspBinaryCapacity) {
            let newCapacity = lspBinaryCapacity * 2;
            let newBuffer = atomicChunkAlloc(newCapacity * 4);
            memory.copy(newBuffer, t_lspBinaryBuffer, lspBinaryLength * 4);
            t_lspBinaryBuffer = newBuffer;
            lspBinaryCapacity = newCapacity;
          }
          store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, childOffset);
          store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, getNodeByteLength(targetChild));
          store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, tokenTypeId);
          store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, bitmask);
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

      if (stackTop + childCount > lspTraverseCapacity) {
        growTraverseStacks(stackTop + childCount, stackTop);
      }

      let currOffset = start;
      let writeIdx = stackTop + childCount - 1;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let cLen = padVal + getNodeByteLength(child);
        store<u32>(t_lspTraverseStack + writeIdx * 4, child);
        store<u32>(t_lspOffsetStack + writeIdx * 4, currOffset);
        writeIdx--;
        currOffset += cLen;
        child = getNodeNextSibling(child);
      }
      stackTop += childCount;
    }
  }

  lsp_clearVisited();
  return lspBinaryLength / 4;
}

/**
 * Extracts all foldable block ranges from the AST.
 * Filters nodes based on the generated `type_is_folding` boolean map.
 * @returns The number of folding records inside `t_lspBinaryBuffer` (2 u32s per range).
 */
export function lsp_getFoldingRanges(astRoot: u32): u32 {
  if (t_lspBinaryBuffer == 0) {
    t_lspBinaryBuffer = atomicChunkAlloc(lspBinaryCapacity * 4);
    t_lspTraverseStack = atomicChunkAlloc(lspTraverseCapacity * 4);
    t_lspOffsetStack = atomicChunkAlloc(lspTraverseCapacity * 4);
    t_lspVisitedNodes = atomicChunkAlloc(lspVisitedCapacity * 4);
  }

  lspBinaryLength = 0;
  lspVisitedCount = 0;

  if (astRoot == 0) return 0;
  globalAstRoot = astRoot;

  let stackTop: u32 = 0;
  store<u32>(t_lspTraverseStack + stackTop * 4, astRoot);
  store<u32>(t_lspOffsetStack + stackTop * 4, 0);
  stackTop++;

  while (stackTop > 0) {
    stackTop--;
    let node = load<u32>(t_lspTraverseStack + stackTop * 4);
    let start = load<u32>(t_lspOffsetStack + stackTop * 4);

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    if (lspVisitedCount >= lspVisitedCapacity) {
      growVisitedBuffer(lspVisitedCount + 1);
    }
    store<u32>(t_lspVisitedNodes + lspVisitedCount++ * 4, node);

    let pad = getNodePadding(node);
    let type = getNodeType(node);
    let nodeStart = start + pad;
    let nodeEnd = nodeStart + getNodeByteLength(node);

    let isFolding = load<u32>(type_is_folding + type * 4);
    if (isFolding != 0) {
      if (lspBinaryLength + 2 > lspBinaryCapacity) {
        let newCapacity = lspBinaryCapacity * 2;
        let newBuffer = atomicChunkAlloc(newCapacity * 4);
        memory.copy(newBuffer, t_lspBinaryBuffer, lspBinaryLength * 4);
        t_lspBinaryBuffer = newBuffer;
        lspBinaryCapacity = newCapacity;
      }
      store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, nodeStart);
      store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, nodeEnd);
    }

    let child = getNodeFirstChild(node);
    if (child != 0) {
      let childCount: u32 = 0;
      let countChild = child;
      while (countChild != 0) {
        childCount++;
        countChild = getNodeNextSibling(countChild);
      }

      if (stackTop + childCount > lspTraverseCapacity) {
        growTraverseStacks(stackTop + childCount, stackTop);
      }

      let currOffset = start;
      let writeIdx = stackTop + childCount - 1;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let cLen = padVal + getNodeByteLength(child);
        store<u32>(t_lspTraverseStack + writeIdx * 4, child);
        store<u32>(t_lspOffsetStack + writeIdx * 4, currOffset);
        writeIdx--;
        currOffset += cLen;
        child = getNodeNextSibling(child);
      }
      stackTop += childCount;
    }
  }

  lsp_clearVisited();
  return lspBinaryLength / 2;
}

/**
 * Extracts Document Symbols (Outline view) from the AST.
 * Filters nodes based on the generated `type_is_outline` map.
 * @returns The number of outline records inside `t_lspBinaryBuffer` (4 u32s per symbol).
 */
export function lsp_getDocumentSymbols(astRoot: u32): u32 {
  if (t_lspBinaryBuffer == 0) {
    t_lspBinaryBuffer = atomicChunkAlloc(lspBinaryCapacity * 4);
    t_lspTraverseStack = atomicChunkAlloc(lspTraverseCapacity * 4);
    t_lspOffsetStack = atomicChunkAlloc(lspTraverseCapacity * 4);
    t_lspVisitedNodes = atomicChunkAlloc(lspVisitedCapacity * 4);
  }

  lspBinaryLength = 0;
  lspVisitedCount = 0;

  if (astRoot == 0) return 0;
  globalAstRoot = astRoot;

  let stackTop: u32 = 0;
  store<u32>(t_lspTraverseStack + stackTop * 4, astRoot);
  store<u32>(t_lspOffsetStack + stackTop * 4, 0);
  stackTop++;

  while (stackTop > 0) {
    stackTop--;
    let node = load<u32>(t_lspTraverseStack + stackTop * 4);
    let start = load<u32>(t_lspOffsetStack + stackTop * 4);

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    if (lspVisitedCount >= lspVisitedCapacity) {
      growVisitedBuffer(lspVisitedCount + 1);
    }
    store<u32>(t_lspVisitedNodes + lspVisitedCount++ * 4, node);

    let pad = getNodePadding(node);
    let type = getNodeType(node);
    let nodeStart = start + pad;
    let nodeEnd = nodeStart + getNodeByteLength(node);

    let isOutline = load<u32>(type_is_outline + type * 4);
    if (isOutline != 0) {
      if (lspBinaryLength + 4 > lspBinaryCapacity) {
        let newCapacity = lspBinaryCapacity * 2;
        let newBuffer = atomicChunkAlloc(newCapacity * 4);
        memory.copy(newBuffer, t_lspBinaryBuffer, lspBinaryLength * 4);
        t_lspBinaryBuffer = newBuffer;
        lspBinaryCapacity = newCapacity;
      }
      store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, nodeStart);
      store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, nodeEnd);
      store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, type);
      store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, node);
    }

    let child = getNodeFirstChild(node);
    if (child != 0) {
      let childCount: u32 = 0;
      let countChild = child;
      while (countChild != 0) {
        childCount++;
        countChild = getNodeNextSibling(countChild);
      }

      if (stackTop + childCount > lspTraverseCapacity) {
        growTraverseStacks(stackTop + childCount, stackTop);
      }

      let currOffset = start;
      let writeIdx = stackTop + childCount - 1;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let cLen = padVal + getNodeByteLength(child);
        store<u32>(t_lspTraverseStack + writeIdx * 4, child);
        store<u32>(t_lspOffsetStack + writeIdx * 4, currOffset);
        writeIdx--;
        currOffset += cLen;
        child = getNodeNextSibling(child);
      }
      stackTop += childCount;
    }
  }

  lsp_clearVisited();
  return lspBinaryLength / 4;
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
  
  if (t_lspTraverseStack == 0) {
    t_lspTraverseStack = atomicChunkAlloc(lspTraverseCapacity * 4);
    t_lspOffsetStack = atomicChunkAlloc(lspTraverseCapacity * 4);
  }
  
  let stackTop = 0;
  store<u32>(t_lspTraverseStack, rootNode);
  store<u32>(t_lspOffsetStack, 0); 
  stackTop = 1;
  
  let bestMatch: u32 = 0;

  while (stackTop > 0) {
    stackTop--;
    let node = load<u32>(t_lspTraverseStack + stackTop * 4);
    let start = load<u32>(t_lspOffsetStack + stackTop * 4);
    
    let pad = getNodePadding(node);
    let len = getNodeByteLength(node);
    
    let tokenStart = start + pad;
    let tokenEnd = tokenStart + len;
    debugLog(999200, node, tokenStart, tokenEnd);
    
    if (targetOffset >= tokenStart && targetOffset <= tokenEnd) {
       let update = true;
       if (bestMatch != 0) {
          let bestLen = getNodeByteLength(bestMatch);
          if (tokenStart == lspLastNodeOffset && len == bestLen) {
             let bestType = getNodeType(bestMatch);
             let nodeType = getNodeType(node);
             if (bestType > __MAX_TERMINAL_ID__ && nodeType <= __MAX_TERMINAL_ID__) {
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
       let currOffset = start;
       while (child != 0) {
          let cPad = getNodePadding(child);
          let cLen = getNodeByteLength(child);
          let cFullEnd = currOffset + cPad + cLen;
          if (targetOffset >= currOffset && targetOffset <= cFullEnd) {
             store<u32>(t_lspTraverseStack + stackTop * 4, child);
             store<u32>(t_lspOffsetStack + stackTop * 4, currOffset);
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
   if (rootNode == targetNode) return 0;
   
   if (lspFindTraverseCapacity == 0) {
      lspFindTraverseCapacity = 2048;
      t_lspFindTraverseStack = atomicChunkAlloc(lspFindTraverseCapacity * 4);
      t_lspFindOffsetStack = atomicChunkAlloc(lspFindTraverseCapacity * 4);
   }
   
   let stackTop: u32 = 0;
   store<u32>(t_lspFindTraverseStack, rootNode);
   store<u32>(t_lspFindOffsetStack, 0);
   stackTop++;
   
   while (stackTop > 0) {
      stackTop--;
      let current = load<u32>(t_lspFindTraverseStack + stackTop * 4);
      let offset = load<u32>(t_lspFindOffsetStack + stackTop * 4);
      
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
         
         if (stackTop + childCount >= lspFindTraverseCapacity) {
            lspFindTraverseCapacity *= 2;
            let oldTrav = t_lspFindTraverseStack;
            let oldOff = t_lspFindOffsetStack;
            t_lspFindTraverseStack = atomicChunkAlloc(lspFindTraverseCapacity * 4);
            t_lspFindOffsetStack = atomicChunkAlloc(lspFindTraverseCapacity * 4);
            memory.copy(t_lspFindTraverseStack as usize, oldTrav as usize, (stackTop * 4) as usize);
            memory.copy(t_lspFindOffsetStack as usize, oldOff as usize, (stackTop * 4) as usize);
         }
         
         // Push in reverse
         let writeIdx = stackTop + childCount - 1;
         c = child;
         while (c != 0) {
            store<u32>(t_lspFindTraverseStack + writeIdx * 4, c);
            store<u32>(t_lspFindOffsetStack + writeIdx * 4, currOffset);
            writeIdx--;
            currOffset += getNodePadding(c) + getNodeByteLength(c);
            c = getNodeNextSibling(c);
         }
         stackTop += childCount;
      }
   }
   return -1;
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
   
   lspBinaryLength = 0;
   if (lspBinaryCapacity < 2) {
      lspBinaryCapacity = 256;
      t_lspBinaryBuffer = atomicChunkAlloc(lspBinaryCapacity * 4);
   }
   
   store<u32>(t_lspBinaryBuffer, start as u32);
   store<u32>(t_lspBinaryBuffer + 4, end as u32);
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
   
   lspBinaryLength = 0;
   if (lspBinaryCapacity < 256) {
      lspBinaryCapacity = 256;
      t_lspBinaryBuffer = atomicChunkAlloc(lspBinaryCapacity * 4);
   }
   
   if (lspTraverseCapacity == 0) {
      lspTraverseCapacity = 2048;
      t_lspTraverseStack = atomicChunkAlloc(lspTraverseCapacity * 4);
      t_lspOffsetStack = atomicChunkAlloc(lspTraverseCapacity * 4);
   }
   
   let stackTop: u32 = 0;
   store<u32>(t_lspTraverseStack, rootNode);
   store<u32>(t_lspOffsetStack, 0);
   stackTop++;
   
   while (stackTop > 0) {
      stackTop--;
      let current = load<u32>(t_lspTraverseStack + stackTop * 4);
      let offset = load<u32>(t_lspOffsetStack + stackTop * 4);
      
      let child = getNodeFirstChild(current);
      
      let len = getNodeByteLength(current);
      // Candidate filtering by length and string hash
      if (len == targetLen) {
         let pad = getNodePadding(current);
         let tokenStart = offset + pad;
         let span = ast_getTextSpan(current, tokenStart);
         if (ast_hashSpan(span) == targetHash) {
            // Semantic verification
            let candidateDef = lsp_invokeDefinition(current);
            if (candidateDef == defNode) {
               // Confirmed reference!
               if (lspBinaryLength + 1 >= lspBinaryCapacity) {
                  lspBinaryCapacity *= 2;
                  let oldBuffer = t_lspBinaryBuffer;
                  t_lspBinaryBuffer = atomicChunkAlloc(lspBinaryCapacity * 4);
                  memory.copy(t_lspBinaryBuffer as usize, oldBuffer as usize, (lspBinaryLength * 4) as usize);
               }
               store<u32>(t_lspBinaryBuffer + lspBinaryLength * 4, tokenStart);
               lspBinaryLength++;
               store<u32>(t_lspBinaryBuffer + lspBinaryLength * 4, tokenStart + len);
               lspBinaryLength++;
            }
         }
      }
      
      if (child == 0) {
         // Leaf node, nothing more to push
      } else {
         let currOffset = offset;
         // Push children in reverse order so they are processed left-to-right
         // We can do this with a secondary loop or just traverse, order doesn't matter for references
         while (child != 0) {
            if (stackTop >= lspTraverseCapacity) {
               lspTraverseCapacity *= 2;
               let oldTrav = t_lspTraverseStack;
               let oldOff = t_lspOffsetStack;
               t_lspTraverseStack = atomicChunkAlloc(lspTraverseCapacity * 4);
               t_lspOffsetStack = atomicChunkAlloc(lspTraverseCapacity * 4);
               memory.copy(t_lspTraverseStack as usize, oldTrav as usize, (stackTop * 4) as usize);
               memory.copy(t_lspOffsetStack as usize, oldOff as usize, (stackTop * 4) as usize);
            }
            store<u32>(t_lspTraverseStack + stackTop * 4, child);
            store<u32>(t_lspOffsetStack + stackTop * 4, currOffset);
            stackTop++;
            
            currOffset += getNodePadding(child) + getNodeByteLength(child);
            child = getNodeNextSibling(child);
         }
      }
   }
   
   return lspBinaryLength / 2;
}
