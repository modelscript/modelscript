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
  FLAG_IS_INSERTED,
  FLAG_HAS_ERROR,
} from "./arena";
import { errorCount, getErrorEnd, getErrorStart } from "./engine";
import { inputLength } from "./parser";
import { UnmanagedUint32Array } from "./array";

// --- LSP Endpoints ---

let t_lspTraverseStack: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspOffsetStack: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspVisitedNodes: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let lspVisitedCount: u32 = 0;
let t_lspFindTraverseStack: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_lspFindOffsetStack: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let lspFindTraverseCapacity: u32 = 0;
let lspTraverseCapacity: u32 = 50000;

export let globalAstRoot: u32 = 0;
let lspVisitedCapacity: u32 = 50000;

// --- Binary Serialization ---
let t_lspBinaryBuffer: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let lspBinaryLength: u32 = 0;
let lspBinaryCapacity: u32 = 50000; // Initial capacity, grows dynamically

export function lsp_getBinaryBuffer(): u32 {
  return changetype<u32>(t_lspBinaryBuffer);
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
let lastDiagStart: u32 = 0xffffffff;
let lastDiagEnd: u32 = 0xffffffff;

export function lsp_allocDiagnostic(start: u32, end: u32, lintId: u32, argPtr: u32): void {
  // Cap at 250 diagnostics (4 u32s per diagnostic) to prevent Editor UI freezes
  if (lspBinaryLength >= 1000) return;

  if (lspBinaryLength > 0 && lintId == 0) {
    let limit: u32 = lspBinaryLength > 40 ? lspBinaryLength - 40 : 0;
    // Iterate backwards by 4 elements (1 diagnostic)
    for (let i: i32 = lspBinaryLength - 4; i >= (limit as i32); i -= 4) {
      let lastLintId = t_lspBinaryBuffer[i + 2];
      let lastEnd = t_lspBinaryBuffer[i + 1];
      let lastStart = t_lspBinaryBuffer[i];
      
      // Prevent multiple diagnostics (like missing terminals) from piling up at the exact same character offset
      if (start == lastStart && end == lastEnd) {
        return; // Skip duplicate/overlapping diagnostic at the exact same spot
      }
      
      if (lastLintId == 0 && lintId == 0) {
        // Disabled merging of adjacent syntax errors to allow per-token diagnostic squiggles
        // as requested by the user.
      }
    }
  }
  if (lspBinaryLength + 4 > lspBinaryCapacity) {
    // Grow the binary buffer dynamically instead of silently dropping diagnostics
    let newCapacity = lspBinaryCapacity * 2;
    let newBuffer = heap.alloc(newCapacity * 4);
    memory.copy(newBuffer, changetype<usize>(t_lspBinaryBuffer), lspBinaryLength * 4);
    if (changetype<usize>(t_lspBinaryBuffer) != 0) {
      heap.free(changetype<usize>(t_lspBinaryBuffer));
    }
    t_lspBinaryBuffer = changetype<UnmanagedUint32Array>(newBuffer);
    lspBinaryCapacity = newCapacity;
  }
  t_lspBinaryBuffer[lspBinaryLength++] = start;
  t_lspBinaryBuffer[lspBinaryLength++] = end;
  t_lspBinaryBuffer[lspBinaryLength++] = lintId;
  t_lspBinaryBuffer[lspBinaryLength++] = argPtr;
}

/**
 * Ensures all LSP buffers are allocated via the heap.
 */
function ensureLspBuffers(): void {
  if (changetype<usize>(t_lspBinaryBuffer) == 0) {
    t_lspBinaryBuffer = changetype<UnmanagedUint32Array>(heap.alloc(lspBinaryCapacity * 4));
    t_lspVisitedNodes = changetype<UnmanagedUint32Array>(heap.alloc(lspVisitedCapacity * 4));
  }
  if (changetype<usize>(t_lspTraverseStack) == 0) {
    t_lspTraverseStack = changetype<UnmanagedUint32Array>(heap.alloc(lspTraverseCapacity * 4));
    t_lspOffsetStack = changetype<UnmanagedUint32Array>(heap.alloc(lspTraverseCapacity * 4));
  }
}

/**
 * Clears the `FLAG_LSP_VISITED` bit on all AST nodes that were touched during the current traversal.
 * Essential for resetting cycle-detection state before the next incremental parse or LSP query.
 */
function lsp_clearVisited(): void {
  for (let i: u32 = 0; i < lspVisitedCount; i++) {
    let node = changetype<ASTNode>(t_lspVisitedNodes[i]);
    node.flags &= ~FLAG_LSP_VISITED;
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
  let newTraverse = heap.alloc(newCapacity * 4);
  let newOffset = heap.alloc(newCapacity * 4);
  if (stackTop > 0) {
    memory.copy(newTraverse, changetype<usize>(t_lspTraverseStack), stackTop * 4);
    memory.copy(newOffset, changetype<usize>(t_lspOffsetStack), stackTop * 4);
  }
  if (changetype<usize>(t_lspTraverseStack) != 0) {
    heap.free(changetype<usize>(t_lspTraverseStack));
    heap.free(changetype<usize>(t_lspOffsetStack));
  }
  t_lspTraverseStack = changetype<UnmanagedUint32Array>(newTraverse);
  t_lspOffsetStack = changetype<UnmanagedUint32Array>(newOffset);
  lspTraverseCapacity = newCapacity;
}

/**
 * Grows the visited nodes buffer to at least `required` capacity.
 * Copies existing data from [0, lspVisitedCount) into the new buffer.
 */
function growVisitedBuffer(required: u32): void {
  let newCapacity = lspVisitedCapacity;
  while (newCapacity < required) newCapacity *= 2;
  let newBuffer = heap.alloc(newCapacity * 4);
  if (lspVisitedCount > 0) {
    memory.copy(newBuffer, changetype<usize>(t_lspVisitedNodes), lspVisitedCount * 4);
  }
  if (changetype<usize>(t_lspVisitedNodes) != 0) {
    heap.free(changetype<usize>(t_lspVisitedNodes));
  }
  t_lspVisitedNodes = changetype<UnmanagedUint32Array>(newBuffer);
  lspVisitedCapacity = newCapacity;
}

/**
 * Extracts and serializes all syntax and grammar diagnostics into a flat `u32` buffer.
 * Traverses the AST looking for injected error nodes and missing ghost nodes.
 * @param astRoot The root node pointer of the parsed tree.
 * @returns The number of `u32` records inside `t_lspBinaryBuffer` (4 u32s per diagnostic).
 */
export function lsp_getDiagnostics(astRoot: u32): u32 {
  ensureLspBuffers();

  lspBinaryLength = 0;
  lspVisitedCount = 0;
  lastDiagStart = 0xffffffff;
  lastDiagEnd = 0xffffffff;

  // Note: Engine-level syntax errors (from errorCount/errorQueue) are no longer iterated here.
  // The recovery algorithms (Branch A1, Branch B, Island Mode) all correctly encode their
  // errors into the AST (as NODE_TYPE_ERROR or zero-length inserted tokens).
  // Relying solely on the AST traversal prevents duplicate diagnostic reporting.

  if (astRoot == 0) return lspBinaryLength / 4;

  globalAstRoot = astRoot;

  let stackTop: u32 = 0;
  t_lspTraverseStack[stackTop] = astRoot;
  t_lspOffsetStack[stackTop] = 0;
  stackTop++;

  while (stackTop > 0) {
    if (lspBinaryLength >= 1000) {
      break;
    }
    stackTop--;
    let node = t_lspTraverseStack[stackTop];
    let offsetStackVal = t_lspOffsetStack[stackTop];
    let start = offsetStackVal & 0x7FFFFFFF;
    let inError = (offsetStackVal >>> 31) == 1;

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    // Grow visited buffer if needed
    if (lspVisitedCount >= lspVisitedCapacity) {
      growVisitedBuffer(lspVisitedCount + 1);
    }
    t_lspVisitedNodes[lspVisitedCount++] = node;

    let pad = getNodePadding(node);
    let len = getNodeByteLength(node);
    let nodeStart = start + pad;
    let nodeEnd = nodeStart + len;
    let type = getNodeType(node);
    let isErrorNode = type == 0;
    let firstChild = getNodeFirstChild(node);
    let isLeaf = firstChild == 0;

    if ((flags & FLAG_IS_INSERTED) != 0) {
      let dStart = nodeStart;
      let dEnd = nodeStart + 2;
      if (dEnd > inputLength) {
        dEnd = inputLength;
        if (dEnd > 0) dStart = dEnd - 2;
        if (dStart < 0) dStart = 0;
      }
      lsp_allocDiagnostic(dStart, dEnd, type, 0);
    } else if (inError && isLeaf && len > 0) {
      // Garbage token or token inside discarded Island Mode block
      lsp_allocDiagnostic(nodeStart, nodeEnd, 0, 0);
    }

    executeLints(type, node, nodeStart, nodeEnd);

    // Recurse into children — but skip clean subtrees entirely.
    // If this node is NOT an error node AND does NOT have FLAG_HAS_ERROR
    // AND is not inside an error context AND has no FLAG_IS_INSERTED,
    // then none of its descendants can produce diagnostics, so we can
    // skip the entire subtree. This reduces traversal from O(tree_size)
    // to O(error_subtrees) for large files with localized errors.
    let shouldRecurse = isErrorNode || inError
      || (flags & FLAG_HAS_ERROR) != 0
      || (flags & FLAG_IS_INSERTED) != 0;

    let child = getNodeFirstChild(node);
    if (child != 0 && shouldRecurse) {
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
      let currOffset = start + pad; // nodeStart
      let writeIdx = stackTop + childCount - 1;
      let errorFlagBit = (isErrorNode || inError) ? 0x80000000 : 0;
      
      while (child != 0) {
        let padVal = getNodePadding(child);
        let cLen = padVal + getNodeByteLength(child);
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
  return lspBinaryLength / 4;
}

/**
 * Extracts and serializes Semantic Tokens for syntax highlighting.
 * Operates purely on the unmanaged heap to format tokens strictly ordered by byte offset.
 * Uses static semantic maps (`type_semantics`) embedded by the code generator.
 * @returns The number of semantic token primitives inside `t_lspBinaryBuffer`.
 */
export function lsp_semanticTokens_full(astRoot: u32): u32 {
  ensureLspBuffers();

  lspBinaryLength = 0;
  lspVisitedCount = 0;

  if (astRoot == 0) return 0;
  globalAstRoot = astRoot;

  let stackTop: u32 = 0;
  t_lspTraverseStack[stackTop] = astRoot;
  t_lspOffsetStack[stackTop] = 0;
  stackTop++;

  while (stackTop > 0) {
    stackTop--;
    let node = t_lspTraverseStack[stackTop];
    let offsetStackVal = t_lspOffsetStack[stackTop];
    let start = offsetStackVal & 0x7FFFFFFF;
    let inError = (offsetStackVal >>> 31) == 1;

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    if (lspVisitedCount >= lspVisitedCapacity) {
      growVisitedBuffer(lspVisitedCount + 1);
    }
    t_lspVisitedNodes[lspVisitedCount++] = node;

    let pad = getNodePadding(node);
    let type = getNodeType(node);
    let isErrorNode = type == 0;

    let semOffset = load<i32>(type_semantics + type * 4);
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
        let childOffset = 0;

      while (child != 0) {
          let cPad = getNodePadding(child);
          if (getNodeType(child) != 0 /* NODE_TYPE_ERROR */) {
            if (childCount == childIdx) {
              targetChild = child;
              childOffset = currOffset + cPad;
              break;
            }
            childCount++;
          }
          currOffset += cPad + getNodeByteLength(child);
          child = getNodeNextSibling(child);
        }

        if (targetChild != 0) {
          let cLen = getNodeByteLength(targetChild);
          if (cLen > 0) {
            if (lspBinaryLength + 4 > lspBinaryCapacity) {
              let newCapacity = lspBinaryCapacity * 2;
              let newBuffer = heap.alloc(newCapacity * 4);
              memory.copy(newBuffer, changetype<usize>(t_lspBinaryBuffer), lspBinaryLength * 4);
              if (changetype<usize>(t_lspBinaryBuffer) != 0) {
                heap.free(changetype<usize>(t_lspBinaryBuffer));
              }
              t_lspBinaryBuffer = changetype<UnmanagedUint32Array>(newBuffer);
              lspBinaryCapacity = newCapacity;
            }

            t_lspBinaryBuffer[lspBinaryLength++] = childOffset;
            t_lspBinaryBuffer[lspBinaryLength++] = cLen;
            t_lspBinaryBuffer[lspBinaryLength++] = tokenTypeId;
            t_lspBinaryBuffer[lspBinaryLength++] = bitmask;
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

      if (stackTop + childCount > lspTraverseCapacity) {
        growTraverseStacks(stackTop + childCount, stackTop);
      }

      let currOffset = start + pad;
      let writeIdx = stackTop + childCount - 1;
      let errorFlagBit = (isErrorNode || inError) ? 0x80000000 : 0;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let cLen = padVal + getNodeByteLength(child);
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
  return lspBinaryLength / 4;
}

/**
 * Extracts all foldable block ranges from the AST.
 * Filters nodes based on the generated `type_is_folding` boolean map.
 * @returns The number of folding records inside `t_lspBinaryBuffer` (2 u32s per range).
 */
export function lsp_getFoldingRanges(astRoot: u32): u32 {
  ensureLspBuffers();

  lspBinaryLength = 0;
  lspVisitedCount = 0;

  if (astRoot == 0) return 0;
  globalAstRoot = astRoot;

  let stackTop: u32 = 0;
  t_lspTraverseStack[stackTop] = astRoot;
  t_lspOffsetStack[stackTop] = 0;
  stackTop++;

  while (stackTop > 0) {
    stackTop--;
    let node = t_lspTraverseStack[stackTop];
    let offsetStackVal = t_lspOffsetStack[stackTop];
    let start = offsetStackVal & 0x7FFFFFFF;
    let inError = (offsetStackVal >>> 31) == 1;

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    if (lspVisitedCount >= lspVisitedCapacity) {
      growVisitedBuffer(lspVisitedCount + 1);
    }
    t_lspVisitedNodes[lspVisitedCount++] = node;

    let pad = getNodePadding(node);
    let type = getNodeType(node);
    let isErrorNode = type == 0;

    let nodeStart = start + pad;
    let nodeEnd = nodeStart + getNodeByteLength(node);

    let isFolding = load<u32>(type_is_folding + (type << 2));
    if (isFolding != 0 && !inError) {
      if (lspBinaryLength + 2 > lspBinaryCapacity) {
        let newCapacity = lspBinaryCapacity * 2;
        let newBuffer = heap.alloc(newCapacity * 4);
        memory.copy(newBuffer, changetype<usize>(t_lspBinaryBuffer), lspBinaryLength * 4);
        if (changetype<usize>(t_lspBinaryBuffer) != 0) {
          heap.free(changetype<usize>(t_lspBinaryBuffer));
        }
        t_lspBinaryBuffer = changetype<UnmanagedUint32Array>(newBuffer);
        lspBinaryCapacity = newCapacity;
      }
      t_lspBinaryBuffer[lspBinaryLength++] = nodeStart;
      t_lspBinaryBuffer[lspBinaryLength++] = nodeEnd;
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

      let currOffset = start + pad;
      let writeIdx = stackTop + childCount - 1;
      let errorFlagBit = (isErrorNode || inError) ? 0x80000000 : 0;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let cLen = padVal + getNodeByteLength(child);
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
  return lspBinaryLength / 2;
}

/**
 * Extracts Document Symbols (Outline view) from the AST.
 * Filters nodes based on the generated `type_is_outline` map.
 * @returns The number of outline records inside `t_lspBinaryBuffer` (4 u32s per symbol).
 */
export function lsp_getDocumentSymbols(astRoot: u32): u32 {
  ensureLspBuffers();

  lspBinaryLength = 0;
  lspVisitedCount = 0;

  if (astRoot == 0) return 0;
  globalAstRoot = astRoot;

  let stackTop: u32 = 0;
  t_lspTraverseStack[stackTop] = astRoot;
  t_lspOffsetStack[stackTop] = 0;
  stackTop++;

  while (stackTop > 0) {
    stackTop--;
    let node = t_lspTraverseStack[stackTop];
    let offsetStackVal = t_lspOffsetStack[stackTop];
    let start = offsetStackVal & 0x7FFFFFFF;
    let inError = (offsetStackVal >>> 31) == 1;

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    if (lspVisitedCount >= lspVisitedCapacity) {
      growVisitedBuffer(lspVisitedCount + 1);
    }
    t_lspVisitedNodes[lspVisitedCount++] = node;

    let pad = getNodePadding(node);
    let type = getNodeType(node);
    let isErrorNode = type == 0;

    let nodeStart = start + pad;
    let nodeEnd = nodeStart + getNodeByteLength(node);

    let isOutline = load<u32>(type_is_outline + (type << 2));
    if (isOutline != 0 && !inError) {
      if (lspBinaryLength + 4 > lspBinaryCapacity) {
        let newCapacity = lspBinaryCapacity * 2;
        let newBuffer = heap.alloc(newCapacity * 4);
        memory.copy(newBuffer, changetype<usize>(t_lspBinaryBuffer), lspBinaryLength * 4);
        if (changetype<usize>(t_lspBinaryBuffer) != 0) {
          heap.free(changetype<usize>(t_lspBinaryBuffer));
        }
        t_lspBinaryBuffer = changetype<UnmanagedUint32Array>(newBuffer);
        lspBinaryCapacity = newCapacity;
      }
      t_lspBinaryBuffer[lspBinaryLength++] = nodeStart;
      t_lspBinaryBuffer[lspBinaryLength++] = nodeEnd;
      t_lspBinaryBuffer[lspBinaryLength++] = type;
      t_lspBinaryBuffer[lspBinaryLength++] = node;
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

      let currOffset = start + pad;
      let writeIdx = stackTop + childCount - 1;
      let errorFlagBit = (isErrorNode || inError) ? 0x80000000 : 0;
      while (child != 0) {
        let padVal = getNodePadding(child);
        let cLen = padVal + getNodeByteLength(child);
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
    debugLog(999200, node, tokenStart, tokenEnd);
    
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
   if (rootNode == targetNode) return 0;
   
   if (lspFindTraverseCapacity == 0) {
      lspFindTraverseCapacity = 2048;
      t_lspFindTraverseStack = changetype<UnmanagedUint32Array>(heap.alloc(lspFindTraverseCapacity * 4));
      t_lspFindOffsetStack = changetype<UnmanagedUint32Array>(heap.alloc(lspFindTraverseCapacity * 4));
   }
   
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
         let isFirst_c = true;
      while (c != 0) { childCount++; c = getNodeNextSibling(c);
        isFirst_c = false; }
         
         if (stackTop + childCount >= lspFindTraverseCapacity) {
            lspFindTraverseCapacity *= 2;
            let oldTrav = t_lspFindTraverseStack;
            let oldOff = t_lspFindOffsetStack;
            t_lspFindTraverseStack = changetype<UnmanagedUint32Array>(heap.alloc(lspFindTraverseCapacity * 4));
            t_lspFindOffsetStack = changetype<UnmanagedUint32Array>(heap.alloc(lspFindTraverseCapacity * 4));
            memory.copy(changetype<usize>(t_lspFindTraverseStack), changetype<usize>(oldTrav), stackTop * 4);
            memory.copy(changetype<usize>(t_lspFindOffsetStack), changetype<usize>(oldOff), stackTop * 4);
            if (changetype<usize>(oldTrav) != 0) {
               heap.free(changetype<usize>(oldTrav));
               heap.free(changetype<usize>(oldOff));
            }
         }
         
         // Push in reverse
         currOffset = offset;
         let writeIdx = stackTop + childCount - 1;
         c = child;
         isFirst_c = true;
         while (c != 0) {
            let cPad = getNodePadding(c);
            let cLen = cPad + getNodeByteLength(c);
            t_lspFindTraverseStack[writeIdx] = c;
            if (isFirst_c) {
               t_lspFindOffsetStack[writeIdx] = offset;
               isFirst_c = false;
            } else {
               t_lspFindOffsetStack[writeIdx] = currOffset;
            }
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
   ensureLspBuffers();
   
   t_lspBinaryBuffer[0] = start as u32;
   t_lspBinaryBuffer[1] = end as u32;
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
                  let oldBuffer = changetype<usize>(t_lspBinaryBuffer);
                  t_lspBinaryBuffer = changetype<UnmanagedUint32Array>(heap.alloc(lspBinaryCapacity * 4));
                  memory.copy(changetype<usize>(t_lspBinaryBuffer), oldBuffer as usize, (lspBinaryLength * 4) as usize);
                  if (oldBuffer != 0) {
                     heap.free(oldBuffer);
                  }
               }
               t_lspBinaryBuffer[lspBinaryLength] = tokenStart;
               lspBinaryLength++;
               t_lspBinaryBuffer[lspBinaryLength] = tokenStart + len;
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
               t_lspTraverseStack = changetype<UnmanagedUint32Array>(heap.alloc(lspTraverseCapacity * 4));
               t_lspOffsetStack = changetype<UnmanagedUint32Array>(heap.alloc(lspTraverseCapacity * 4));
               memory.copy(changetype<usize>(t_lspTraverseStack), changetype<usize>(oldTrav), stackTop * 4);
               memory.copy(changetype<usize>(t_lspOffsetStack), changetype<usize>(oldOff), stackTop * 4);
               if (changetype<usize>(oldTrav) != 0) {
                 heap.free(changetype<usize>(oldTrav));
                 heap.free(changetype<usize>(oldOff));
               }
            }
            let cPad = getNodePadding(child);
            let cLen = cPad + getNodeByteLength(child);
            t_lspTraverseStack[stackTop] = child;
            t_lspOffsetStack[stackTop] = (child == getNodeFirstChild(current)) ? offset : currOffset;
            stackTop++;
            
            currOffset += cLen;
            child = getNodeNextSibling(child);
         }
      }
   }
   
   return lspBinaryLength / 2;
}
