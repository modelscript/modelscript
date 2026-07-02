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
  FLAG_INVISIBLE,
} from "./arena";
import { errorCount, getErrorEnd, getErrorStart } from "./engine";
import { inputLength } from "./parser";
import { UnmanagedUint32Array, ChunkedUint32Array, createChunkedUint32Array } from "./array";

// --- LSP Endpoints ---

let t_lspTraverseStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
let t_lspOffsetStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
let t_lspVisitedNodes: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
let t_lspFindTraverseStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
let t_lspFindOffsetStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);

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

import { debugLog } from "./engine";

/**
 * Allocates an unmanaged diagnostic token into the binary buffer for LSP transfer.
 * Includes logic to merge adjacent or overlapping diagnostics with the same `lintId`.
 * If the buffer capacity is exceeded, it dynamically chunks a larger `t_lspBinaryBuffer`.
 */
let lastDiagStart: u32 = 0xffffffff;
let lastDiagEnd: u32 = 0xffffffff;

export function lsp_allocDiagnostic(start: u32, end: u32, lintId: u32, argPtr: u32): void {
  if (t_lspBinaryBuffer.length >= 1000 * 4) return;
  if (t_lspBinaryBuffer.length > 0 && lintId == 0) {
    let limit: u32 = t_lspBinaryBuffer.length > 40 ? t_lspBinaryBuffer.length - 40 : 0;
    for (let i: i32 = t_lspBinaryBuffer.length - 4; i >= (limit as i32); i -= 4) {
      let lastLintId = t_lspBinaryBuffer[i + 2];
      let lastEnd = t_lspBinaryBuffer[i + 1];
      let lastStart = t_lspBinaryBuffer[i];
      if (start == lastStart && end == lastEnd) return;
    }
  }
  t_lspBinaryBuffer.push(start);
  t_lspBinaryBuffer.push(end);
  t_lspBinaryBuffer.push(lintId);
  t_lspBinaryBuffer.push(argPtr);
}

/**
 * Ensures all LSP buffers are allocated via the heap.
 */
function ensureLspBuffers(): void {
  if (changetype<usize>(t_lspBinaryBuffer) == 0) {
    t_lspBinaryBuffer = createChunkedUint32Array(50000);
    t_lspVisitedNodes = createChunkedUint32Array(50000);
    t_lspTraverseStack = createChunkedUint32Array(50000);
    t_lspOffsetStack = createChunkedUint32Array(50000);
    t_lspFindTraverseStack = createChunkedUint32Array(2048);
    t_lspFindOffsetStack = createChunkedUint32Array(2048);
  } else {
    t_lspBinaryBuffer.clear();
    t_lspVisitedNodes.clear();
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

function lsp_clearVisited(): void {
  for (let i: u32 = 0; i < t_lspVisitedNodes.length; i++) {
    let node = changetype<ASTNode>(t_lspVisitedNodes[i]);
    node.flags &= ~FLAG_LSP_VISITED;
  }
  t_lspVisitedNodes.clear();
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
  // The recovery algorithms (Branch A1, Branch B, Island Mode) all correctly encode their
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
    let node = t_lspTraverseStack[stackTop];
    let offsetStackVal = t_lspOffsetStack[stackTop];
    let start = offsetStackVal & 0x1FFFFFFF;
    let inError = (offsetStackVal >>> 31) == 1;
    let hasErrorSibling = (offsetStackVal & 0x40000000) != 0;

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    // Grow visited buffer if needed
    
    t_lspVisitedNodes.push(node);

    let pad = getNodePadding(node);
    let len = getNodeByteLength(node);
    let nodeStart = start + pad;
    let nodeEnd = nodeStart + len;
    let type = getNodeType(node);
    let isErrorNode = type == 0;
    let firstChild = getNodeFirstChild(node);
    let isLeaf = firstChild == 0;

    let hasInsertedSibling = (offsetStackVal & 0x20000000) != 0;

    if ((flags & FLAG_IS_INSERTED) != 0) {
      // Inserted ghost nodes are zero-width phantoms from error recovery.
      // We always emit a diagnostic for them so the user knows what was expected,
      // and so the JS-side merging logic can combine it with adjacent garbage tokens.
      let dStart = nodeStart;
      let dEnd = nodeStart + 2;
      if (dEnd > inputLength) {
        dEnd = inputLength;
        if (dEnd > 0) dStart = dEnd - 2;
        if (dStart < 0) dStart = 0;
      }
      lsp_allocDiagnostic(dStart, dEnd, type, 0);
    } else if ((inError || isErrorNode) && isLeaf && len > 0) {
      // Garbage token or token inside discarded Island Mode block
      lsp_allocDiagnostic(nodeStart, nodeEnd, 0, 0);
    } else if (hasInsertedSibling && isLeaf && len > 0 && !isErrorNode) {
      // Real token consumed by Branch A1 recovery into a recovered grammar
      // node (e.g., an 'a' token inside a Usage with inserted ghost 'print').
      // This token is structurally invalid and needs a squiggle even though
      // it's not inside an ERROR node.
      lsp_allocDiagnostic(nodeStart, nodeEnd, 0, 0);
    }

    executeLints(type, node, nodeStart, nodeEnd);

    // Recurse into children (for both error and non-error nodes)
    let child = getNodeFirstChild(node);
    if (child != 0) {
      // Count children and check for ERROR / INSERTED siblings in a single pass
      let childCount: u32 = 0;
      let childHasError: boolean = false;
      let childHasInserted: boolean = false;
      let countChild = child;
      let hasInsertedSoFar: boolean = false;
      let afterInsertedMask: u64 = 0;
      
      while (countChild != 0) {
        let cFlags = getNodeFlags(countChild);
        if ((cFlags & FLAG_HAS_ERROR) != 0) childHasError = true;
        if ((cFlags & FLAG_IS_INSERTED) != 0) {
            childHasInserted = true;
            hasInsertedSoFar = true;
        } else if (hasInsertedSoFar && childCount < 64) {
            afterInsertedMask |= (1 as u64) << (childCount as u64);
        }
        childCount++;
        countChild = getNodeNextSibling(countChild);
      }

      // Grow traverse stacks if needed
      

      // Single-pass: push children backwards directly to achieve in-order traversal via LIFO pop
      let currOffset = start + pad; // nodeStart
      let writeIdx = stackTop + childCount - 1;
      let errorFlagBit: u32 = (isErrorNode || inError) ? 0x80000000 : 0;
      let siblingErrorBit: u32 = (childHasError || hasErrorSibling) ? 0x40000000 : 0;
      let currChildIdx = 0;
      
      while (child != 0) {
        let padVal = getNodePadding(child);
        let cLen = padVal + getNodeByteLength(child);
        let comesAfter = (currChildIdx < 64) && ((afterInsertedMask & ((1 as u64) << (currChildIdx as u64))) != 0);
        let insertedBit: u32 = (comesAfter || hasInsertedSibling) ? 0x20000000 : 0;
        
        t_lspTraverseStack[writeIdx] = child;
        t_lspOffsetStack[writeIdx] = currOffset | errorFlagBit | siblingErrorBit | insertedBit;
        writeIdx--;
        currOffset += cLen;
        child = getNodeNextSibling(child);
        currChildIdx++;
      }
      stackTop += childCount;
    }
  }

  lsp_clearVisited();
  flushBinaryBuffer();
  return t_lspBinaryBuffer.length / 4;
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
    let node = t_lspTraverseStack[stackTop];
    let offsetStackVal = t_lspOffsetStack[stackTop];
    let start = offsetStackVal & 0x7FFFFFFF;
    let inError = (offsetStackVal >>> 31) == 1;

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    
    t_lspVisitedNodes.push(node);

    let pad = getNodePadding(node);
    let type = getNodeType(node);
    let isErrorNode = type == 0;

    // Skip semantic token emission for:
    // 1. ERROR nodes (type == 0) — no valid grammar structure
    // 2. Nodes inside error subtrees (inError) — unreliable offsets
    // 3. Nodes with FLAG_HAS_ERROR — contain error recovery artifacts
    // 4. Nodes with any FLAG_IS_INSERTED child — Branch A1 recovery
    //    inserted ghost tokens that shift child positions incorrectly
    let hasError = (flags & FLAG_HAS_ERROR) != 0;
    
    let semOffset: i32 = -1;
    if (!isErrorNode && !inError) {
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

      while (child != 0) {
          let cPad = getNodePadding(child);
          let cType = getNodeType(child);
          let cFlags = getNodeFlags(child);
          let cLen = getNodeByteLength(child);
          // Skip children that don't correspond to grammar symbols:
          // - ERROR nodes (type == 0)
          // - Invisible internal nodes (list boundaries, _START, etc.)
          // - Inserted ghost nodes (zero-length phantoms from recovery)
          let isSkippable = cType == 0
            || (cFlags & FLAG_INVISIBLE) != 0;
          if (!isSkippable) {
            if (childCount == childIdx) {
              targetChild = child;
              childOffset = currOffset + cPad;
              break;
            }
            childCount++;
          }
          currOffset += cPad + cLen;
          child = getNodeNextSibling(child);
        }

        if (targetChild != 0) {
          let cLen = getNodeByteLength(targetChild);
          if (cLen > 0) {
  

            // Clamp offset + length to inputLength to prevent out-of-bounds tokens
            // that would cause Monaco to reject the entire semantic tokens response
            if (childOffset + cLen > inputLength) {
              if (childOffset >= inputLength) continue; // completely out of bounds
              cLen = inputLength - childOffset;
            }
            debugLog(888801, childOffset, cLen, tokenTypeId);
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

      

      let currOffset = start + pad;
      let writeIdx = stackTop + childCount - 1;
      let errorFlagBit: u32 = (isErrorNode || inError) ? 0x80000000 : 0;
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
    let node = t_lspTraverseStack[stackTop];
    let offsetStackVal = t_lspOffsetStack[stackTop];
    let start = offsetStackVal & 0x7FFFFFFF;
    let inError = (offsetStackVal >>> 31) == 1;

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    
    t_lspVisitedNodes.push(node);

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
    let node = t_lspTraverseStack[stackTop];
    let offsetStackVal = t_lspOffsetStack[stackTop];
    let start = offsetStackVal & 0x7FFFFFFF;
    let inError = (offsetStackVal >>> 31) == 1;

    let flags = getNodeFlags(node);
    if ((flags & FLAG_LSP_VISITED) != 0) continue;
    setNodeFlags(node, flags | FLAG_LSP_VISITED);

    
    t_lspVisitedNodes.push(node);

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
               
               t_lspBinaryBuffer.push(tokenStart);
               t_lspBinaryBuffer.push(tokenStart + len);
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
   
   flushBinaryBuffer();
  return t_lspBinaryBuffer.length / 2;
}
