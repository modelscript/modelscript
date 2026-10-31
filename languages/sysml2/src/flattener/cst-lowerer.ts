// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Direct Linear-Memory CST Flattener and Lowerer into DAEBuilder.
 *
 * Compiles SysML v2 / KerML syntax trees directly into `DAEBuilder` integer IDs (ExprId, EqId)
 * without intermediate AST wrapper allocations.
 *
 * Supports:
 *   1. Full expression lowering from GLR CST nodes (relational, arithmetic, boolean, invocations, der()).
 *   2. Class inheritance & specialization (`:>`).
 *   3. Array multiplicities (`part wheels : Wheel[4];`).
 *   4. Conjugated physical ports (`~PortDef`) with flow sign inversion in Kirchhoff balance.
 *   5. Hierarchical component elaboration and parameter overrides.
 */

import { BinOp, Causality, DAEBuilder, EqKind, UnaryOp, VarAttrKind, Variability, VarType } from "@modelscript/runtime";

/**
 * Result produced by lowering a SysML v2 CST into a `DAEBuilder` arena.
 */
export interface LoweredSysml2CstResult {
  /** Populated linear-memory `DAEBuilder` arena containing variables and equations. */
  arena: DAEBuilder;
  /** Resolved top-level component or system definition name. */
  rootName: string;
  /** Flattened parameter variable names. */
  parameters: string[];
  /** Flattened continuous state and algebraic variable names. */
  states: string[];
  /** Derivative expression identifiers (`der(x)`) referenced in equations. */
  derivatives: string[];
  /** Total number of equations emitted into the arena. */
  eqCount: number;
}

/**
 * Configuration options for `SysML2CstFlattener`.
 */
export interface CstFlattenerOptions {
  /** Existing `DAEBuilder` arena to append into; allocates a new arena if omitted. */
  arena?: DAEBuilder | undefined;
  /** Top-level parameter value overrides keyed by attribute name. */
  overrides?: Record<string, number> | undefined;
  /** Explicit root component definition name to elaborate. */
  rootComponentName?: string | undefined;
  /** Raw SysML v2 source text for experiment configuration extraction. */
  sourceText?: string | undefined;
}

/**
 * Metadata extracted from a `port def` declaration, separating across (potential)
 * and through (flow) physical attributes.
 */
export interface PortMeta {
  /** Port definition type name (e.g. `"Pin"`, `"Flange"`). */
  name: string;
  /** Potential (across) attribute names (e.g. `["v"]`), equated across connected ports. */
  potentialAttrs: string[];
  /** Flow (through) attribute names (e.g. `["i"]`), summed to zero at connection junctions. */
  flowAttrs: string[];
}

/**
 * Elaborated port instance inside a flattened component hierarchy.
 */
export interface ActivePortInstance {
  /** Hierarchical dot-prefixed port path (e.g. `"r1.p"`). */
  fullName: string;
  /** Unconjugated base port definition name. */
  portType: string;
  /** True if the port typing uses the conjugation prefix (`~PortDef`), inverting flow sign. */
  isConjugated: boolean;
  /** Potential (across) attributes declared on the port type. */
  potentialAttrs: string[];
  /** Flow (through) attributes declared on the port type. */
  flowAttrs: string[];
}

export interface SysmlCstTree {
  sourceCode?: string | undefined;
  _encoding?: number | undefined;
  mem32?: Uint32Array | undefined;
  facade?:
    | {
        getInputEncoding?(): number;
        syntaxNames?: string[] | undefined;
        exports?:
          | {
              getInputBuffer?(): number;
              lsp_getInputBuffer?(): number;
              getFatPaddingPtr?(rawPad: number): number;
            }
          | undefined;
      }
    | undefined;
}

export type SysmlCstNodeConstructor = new (
  tree: SysmlCstTree,
  ptr: number,
  startOffset: number,
  parent: SysmlCstNode | null | undefined,
  pad: number,
  len: number,
  typeId: number,
  fieldId: number,
) => SysmlCstNode;

export interface SysmlCstNode {
  type: string;
  text: string;
  name?: string | undefined;
  ptr?: number | undefined;
  typeId?: number | undefined;
  _startOffset?: number | undefined;
  _cachedPad?: number | undefined;
  _cachedLen?: number | undefined;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  startPosition?: { row: number; column: number } | undefined;
  endPosition?: { row: number; column: number } | undefined;
  tree?: SysmlCstTree | undefined;
  parent?: SysmlCstNode | null | undefined;
  childCount?: number | undefined;
  children?: SysmlCstNode[] | undefined;
  child?(index: number): SysmlCstNode | null | undefined;
  childForFieldName?(name: string): SysmlCstNode | null | undefined;
  childrenForFieldName?(name: string): SysmlCstNode[];
  hasError?(): boolean;
}

/**
 * Zero-allocation linear-memory CST text extractor from raw `(startOffset, pad, len)` in `Tree`.
 */
function extractLinearNodeText(tree: SysmlCstTree, startOffset: number, pad: number, len: number): string {
  const enc = tree.facade?.getInputEncoding ? tree.facade.getInputEncoding() : (tree._encoding ?? 1);
  const wasmMemory = (tree.facade as { wasmMemory?: WebAssembly.Memory } | undefined)?.wasmMemory;
  if ((enc === 0 || enc === 3 || enc === 4) && tree.facade && wasmMemory) {
    const getInputBuf = tree.facade.exports?.getInputBuffer || tree.facade.exports?.lsp_getInputBuffer;
    if (getInputBuf) {
      const inputBufPtr = getInputBuf();
      const rawBytes = new Uint8Array(wasmMemory.buffer, inputBufPtr + startOffset + pad, len);
      if (enc === 3 || enc === 4) {
        const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
        const cps: number[] = [];
        for (let k = 0; k + 3 < len; k += 4) {
          cps.push(view.getUint32(k, enc === 3));
        }
        return String.fromCodePoint(...cps);
      }
      return typeof TextDecoder !== "undefined"
        ? new TextDecoder("utf-8").decode(rawBytes)
        : String.fromCharCode(...rawBytes);
    }
  }
  if (!tree.sourceCode) return "";
  const s = startOffset + pad;
  const e = startOffset + pad + len;
  if (enc === 3 || enc === 4) {
    return Array.from(tree.sourceCode).slice(s, e).join("");
  }
  return tree.sourceCode.substring(s, e);
}

/**
 * Helper to recursively search for direct visible CST children of a given type.
 * Uses direct WASM `mem32` pointer iteration when available to avoid allocating
 * `SyntaxNode` wrappers for non-matching children.
 */
export function findCstChildren(
  node: SysmlCstNode | null | undefined,
  type: string,
  results: SysmlCstNode[] = [],
): SysmlCstNode[] {
  if (!node) return results;
  if (
    typeof node.ptr === "number" &&
    node.ptr > 0 &&
    node.tree?.mem32 &&
    node.tree?.facade?.syntaxNames &&
    !(node as { _cachedChildren?: unknown })._cachedChildren
  ) {
    const mem32: Uint32Array = node.tree.mem32;
    const syntaxNames: string[] = node.tree.facade.syntaxNames;
    const exports = node.tree.facade.exports;
    const NodeCtor = node.constructor as unknown as SysmlCstNodeConstructor;

    // Linear CST node layout in WASM memory (20 bytes per node):
    //   +0:  typeFlags (bits 0..9 = typeId, bit 14 = isInvisible, bits 22..31 = rawPad)
    //   +4:  envHashPadding (bits 0..22 = byte length, bit 23 = isFatPadding)
    //   +12: firstChildPtr (u32 byte pointer)
    //   +16: nextSiblingPtr (u32 byte pointer)
    const ptrStack: number[] = [];
    const offsetStack: number[] = [];
    let currentChildPtr = mem32[(node.ptr + 12) >>> 2]!;
    let currentOffset = (node._startOffset ?? 0) + (node._cachedPad ?? 0);

    while (true) {
      if (currentChildPtr !== 0) {
        const typeFlags = mem32[currentChildPtr >>> 2]!;
        const typeId = typeFlags & 0x03ff;
        const name = syntaxNames[typeId] || "";
        const envHashPadding = mem32[(currentChildPtr + 4) >>> 2]!;
        const rawPad = typeFlags >>> 22;
        const isFat = (envHashPadding >>> 23) & 1;
        const pad = isFat
          ? mem32[(currentChildPtr + 28) >>> 2] ||
            (exports?.getFatPaddingPtr ? mem32[exports.getFatPaddingPtr(rawPad) >>> 2]! : rawPad)
          : rawPad;
        const len = envHashPadding & 0x007fffff;
        const isInvisible = (typeFlags & (1 << 14)) !== 0;

        const nextChildPtr = mem32[(currentChildPtr + 16) >>> 2]!;
        const nextOffset = currentOffset + pad + len;

        // Transparently descend into hidden/inline grammar rules (prefixed with '_' or marked invisible)
        if (name.startsWith("_") || isInvisible) {
          if (nextChildPtr !== 0) {
            ptrStack.push(nextChildPtr);
            offsetStack.push(nextOffset);
          }
          currentChildPtr = mem32[(currentChildPtr + 12) >>> 2]!;
          currentOffset = currentOffset + pad;
          continue;
        } else if (name === type) {
          results.push(new NodeCtor(node.tree, currentChildPtr, currentOffset, node, pad, len, typeId, -1));
        }

        currentOffset = nextOffset;
        currentChildPtr = nextChildPtr;
      } else {
        if (ptrStack.length === 0) break;
        currentChildPtr = ptrStack.pop()!;
        currentOffset = offsetStack.pop()!;
      }
    }
    return results;
  }

  const count = node.childCount ?? node.children?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const child = node.child ? node.child(i) : node.children?.[i];
    if (!child) continue;
    if (child.type === type) {
      results.push(child);
    }
  }
  return results;
}

/**
 * Helper to recursively search all descendants for nodes of a given type.
 * Uses direct WASM linear-memory `u32` pointer traversal when available so only
 * matching nodes allocate a `SyntaxNode` wrapper.
 */
export function findCstDescendants(
  node: SysmlCstNode | null | undefined,
  type: string,
  results: SysmlCstNode[] = [],
): SysmlCstNode[] {
  if (!node) return results;
  if (typeof node.ptr === "number" && node.ptr > 0 && node.tree?.mem32 && node.tree?.facade?.syntaxNames) {
    if (node.type === type) results.push(node);
    const mem32: Uint32Array = node.tree.mem32;
    const syntaxNames: string[] = node.tree.facade.syntaxNames;
    const exports = node.tree.facade.exports;
    const NodeCtor = node.constructor as unknown as SysmlCstNodeConstructor;

    const ptrStack: number[] = [];
    const offsetStack: number[] = [];
    let currentChildPtr = mem32[(node.ptr + 12) >>> 2]!;
    let currentOffset = (node._startOffset ?? 0) + (node._cachedPad ?? 0);

    while (true) {
      if (currentChildPtr !== 0) {
        const typeFlags = mem32[currentChildPtr >>> 2]!;
        const typeId = typeFlags & 0x03ff;
        const name = syntaxNames[typeId] || "";
        const envHashPadding = mem32[(currentChildPtr + 4) >>> 2]!;
        const rawPad = typeFlags >>> 22;
        const isFat = (envHashPadding >>> 23) & 1;
        const pad = isFat
          ? mem32[(currentChildPtr + 28) >>> 2] ||
            (exports?.getFatPaddingPtr ? mem32[exports.getFatPaddingPtr(rawPad) >>> 2]! : rawPad)
          : rawPad;
        const len = envHashPadding & 0x007fffff;
        const isInvisible = (typeFlags & (1 << 14)) !== 0;

        if (!isInvisible && name === type) {
          results.push(new NodeCtor(node.tree, currentChildPtr, currentOffset, node, pad, len, typeId, -1));
        }

        const nextChildPtr = mem32[(currentChildPtr + 16) >>> 2]!;
        const nextOffset = currentOffset + pad + len;
        const grandChildPtr = mem32[(currentChildPtr + 12) >>> 2]!;

        if (grandChildPtr !== 0) {
          if (nextChildPtr !== 0) {
            ptrStack.push(nextChildPtr);
            offsetStack.push(nextOffset);
          }
          currentChildPtr = grandChildPtr;
          currentOffset = currentOffset + pad;
        } else {
          currentChildPtr = nextChildPtr;
          currentOffset = nextOffset;
        }
      } else {
        if (ptrStack.length === 0) break;
        currentChildPtr = ptrStack.pop()!;
        currentOffset = offsetStack.pop()!;
      }
    }
    return results;
  }

  if (node.type === type) results.push(node);
  const count = node.childCount ?? node.children?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const child = node.child ? node.child(i) : node.children?.[i];
    if (child) findCstDescendants(child, type, results);
  }
  return results;
}

/**
 * Finds the first descendant of a given type using direct WASM linear-memory `u32` pointer traversal.
 */
export function findFirstDescendant(node: SysmlCstNode | null | undefined, type: string): SysmlCstNode | null {
  if (!node) return null;
  if (typeof node.ptr === "number" && node.ptr > 0 && node.tree?.mem32 && node.tree?.facade?.syntaxNames) {
    if (node.type === type) return node;
    const mem32: Uint32Array = node.tree.mem32;
    const syntaxNames: string[] = node.tree.facade.syntaxNames;
    const exports = node.tree.facade.exports;
    const NodeCtor = node.constructor as unknown as SysmlCstNodeConstructor;

    const ptrStack: number[] = [];
    const offsetStack: number[] = [];
    let currentChildPtr = mem32[(node.ptr + 12) >>> 2]!;
    let currentOffset = (node._startOffset ?? 0) + (node._cachedPad ?? 0);

    while (true) {
      if (currentChildPtr !== 0) {
        const typeFlags = mem32[currentChildPtr >>> 2]!;
        const typeId = typeFlags & 0x03ff;
        const name = syntaxNames[typeId] || "";
        const envHashPadding = mem32[(currentChildPtr + 4) >>> 2]!;
        const rawPad = typeFlags >>> 22;
        const isFat = (envHashPadding >>> 23) & 1;
        const pad = isFat
          ? mem32[(currentChildPtr + 28) >>> 2] ||
            (exports?.getFatPaddingPtr ? mem32[exports.getFatPaddingPtr(rawPad) >>> 2]! : rawPad)
          : rawPad;
        const len = envHashPadding & 0x007fffff;
        const isInvisible = (typeFlags & (1 << 14)) !== 0;

        if (!isInvisible && name === type) {
          return new NodeCtor(node.tree, currentChildPtr, currentOffset, node, pad, len, typeId, -1);
        }

        const nextChildPtr = mem32[(currentChildPtr + 16) >>> 2]!;
        const nextOffset = currentOffset + pad + len;
        const grandChildPtr = mem32[(currentChildPtr + 12) >>> 2]!;

        if (grandChildPtr !== 0) {
          if (nextChildPtr !== 0) {
            ptrStack.push(nextChildPtr);
            offsetStack.push(nextOffset);
          }
          currentChildPtr = grandChildPtr;
          currentOffset = currentOffset + pad;
        } else {
          currentChildPtr = nextChildPtr;
          currentOffset = nextOffset;
        }
      } else {
        if (ptrStack.length === 0) break;
        currentChildPtr = ptrStack.pop()!;
        currentOffset = offsetStack.pop()!;
      }
    }
    return null;
  }

  if (node.type === type) return node;
  const count = node.childCount ?? node.children?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const child = node.child ? node.child(i) : node.children?.[i];
    const found = findFirstDescendant(child, type);
    if (found) return found;
  }
  return null;
}

/**
 * Lowers a SysML v2 / KerML CST expression directly from WASM linear memory (`mem32` u32 pointers)
 * into `DAEBuilder` without allocating intermediate `SyntaxNode` wrapper objects.
 */
function lowerLinearWasmCstExpression(
  tree: SysmlCstTree,
  ptr: number,
  startOffset: number,
  pad: number,
  len: number,
  typeId: number,
  arena: DAEBuilder,
  prefix: string,
  localNames?: Set<string>,
): number {
  if (!ptr || !tree.mem32 || !tree.facade?.syntaxNames) return arena.addRealLiteral(0.0);
  const mem32: Uint32Array = tree.mem32;
  const syntaxNames: string[] = tree.facade.syntaxNames;
  const exports = tree.facade.exports;

  // Helper to collect visible direct children as flat (ptr, startOffset, pad, len, typeId) tuples
  const getVisibleChildren = (pPtr: number, pStartOffset: number, pPad: number) => {
    const cPtrs: number[] = [];
    const cOffsets: number[] = [];
    const cPads: number[] = [];
    const cLens: number[] = [];
    const cTypes: number[] = [];

    const ptrStack: number[] = [];
    const offsetStack: number[] = [];
    let curPtr = mem32[(pPtr + 12) >>> 2]!;
    let curOff = pStartOffset + pPad;

    while (true) {
      if (curPtr !== 0) {
        const tf = mem32[curPtr >>> 2]!;
        const tid = tf & 0x03ff;
        const tName = syntaxNames[tid] || "";
        const ehp = mem32[(curPtr + 4) >>> 2]!;
        const rPad = tf >>> 22;
        const isFat = (ehp >>> 23) & 1;
        const cPad = isFat
          ? mem32[(curPtr + 28) >>> 2] ||
            (exports?.getFatPaddingPtr ? mem32[exports.getFatPaddingPtr(rPad) >>> 2]! : rPad)
          : rPad;
        const cLen = ehp & 0x007fffff;
        const isInv = (tf & (1 << 14)) !== 0;

        const nextPtr = mem32[(curPtr + 16) >>> 2]!;
        const nextOff = curOff + cPad + cLen;

        if (tName.startsWith("_") || isInv) {
          if (nextPtr !== 0) {
            ptrStack.push(nextPtr);
            offsetStack.push(nextOff);
          }
          curPtr = mem32[(curPtr + 12) >>> 2]!;
          curOff = curOff + cPad;
          continue;
        } else {
          cPtrs.push(curPtr);
          cOffsets.push(curOff);
          cPads.push(cPad);
          cLens.push(cLen);
          cTypes.push(tid);
        }

        curOff = nextOff;
        curPtr = nextPtr;
      } else {
        if (ptrStack.length === 0) break;
        curPtr = ptrStack.pop()!;
        curOff = offsetStack.pop()!;
      }
    }
    return { cPtrs, cOffsets, cPads, cLens, cTypes };
  };

  // Unwrap wrapper nodes
  let curPtr = ptr;
  let curOff = startOffset;
  let curPad = pad;
  let curLen = len;
  let curTypeId = typeId;
  let type = syntaxNames[curTypeId] || "";

  while (
    type === "OwnedExpression" ||
    type === "SequenceExpression" ||
    type === "ArgumentValue" ||
    type === "ResultExpressionMember" ||
    type === "_Expression" ||
    type === "_BaseExpression"
  ) {
    const kids = getVisibleChildren(curPtr, curOff, curPad);
    if (kids.cPtrs.length > 0 && kids.cPtrs[0] !== curPtr) {
      curPtr = kids.cPtrs[0]!;
      curOff = kids.cOffsets[0]!;
      curPad = kids.cPads[0]!;
      curLen = kids.cLens[0]!;
      curTypeId = kids.cTypes[0]!;
      type = syntaxNames[curTypeId] || "";
    } else {
      break;
    }
  }

  const kids = getVisibleChildren(curPtr, curOff, curPad);
  const count = kids.cPtrs.length;

  // Parenthesized expression: ( expr )
  if (count === 3) {
    const firstText = extractLinearNodeText(tree, kids.cOffsets[0]!, kids.cPads[0]!, kids.cLens[0]!);
    const lastText = extractLinearNodeText(tree, kids.cOffsets[2]!, kids.cPads[2]!, kids.cLens[2]!);
    if (firstText === "(" && lastText === ")") {
      return lowerLinearWasmCstExpression(
        tree,
        kids.cPtrs[1]!,
        kids.cOffsets[1]!,
        kids.cPads[1]!,
        kids.cLens[1]!,
        kids.cTypes[1]!,
        arena,
        prefix,
        localNames,
      );
    }
  }

  // 1. Literals
  if (type === "LiteralReal" || type === "RealValue" || type === "LiteralInteger" || type === "DECIMAL_VALUE") {
    const val = parseFloat(extractLinearNodeText(tree, curOff, curPad, curLen).trim());
    return arena.addRealLiteral(isNaN(val) ? 0.0 : val);
  }
  if (type === "LiteralBoolean") {
    return arena.addBoolLiteral(extractLinearNodeText(tree, curOff, curPad, curLen).trim() === "true");
  }

  // 2. Unary Expression
  if (type === "UnaryExpression" && count >= 2) {
    const opText = extractLinearNodeText(tree, kids.cOffsets[0]!, kids.cPads[0]!, kids.cLens[0]!).trim() || "-";
    const childId = lowerLinearWasmCstExpression(
      tree,
      kids.cPtrs[1]!,
      kids.cOffsets[1]!,
      kids.cPads[1]!,
      kids.cLens[1]!,
      kids.cTypes[1]!,
      arena,
      prefix,
      localNames,
    );
    if (opText === "-") return arena.addUnaryExpr(UnaryOp.Negate, childId);
    if (opText === "!" || opText === "not") return arena.addUnaryExpr(UnaryOp.Not, childId);
    return childId;
  }

  // 3. Additive / Multiplicative / Relational / Equality / And / Or Expressions
  if (
    (type === "AdditiveExpression" ||
      type === "MultiplicativeExpression" ||
      type === "RelationalExpression" ||
      type === "EqualityExpression" ||
      type === "AndExpression" ||
      type === "OrExpression") &&
    count >= 1
  ) {
    let left = lowerLinearWasmCstExpression(
      tree,
      kids.cPtrs[0]!,
      kids.cOffsets[0]!,
      kids.cPads[0]!,
      kids.cLens[0]!,
      kids.cTypes[0]!,
      arena,
      prefix,
      localNames,
    );
    for (let i = 1; i + 1 < count; i += 2) {
      const opText = extractLinearNodeText(tree, kids.cOffsets[i]!, kids.cPads[i]!, kids.cLens[i]!).trim();
      const right = lowerLinearWasmCstExpression(
        tree,
        kids.cPtrs[i + 1]!,
        kids.cOffsets[i + 1]!,
        kids.cPads[i + 1]!,
        kids.cLens[i + 1]!,
        kids.cTypes[i + 1]!,
        arena,
        prefix,
        localNames,
      );
      if (type === "AdditiveExpression") {
        left = arena.addBinaryExpr(opText === "-" ? BinOp.Sub : BinOp.Add, left, right);
      } else if (type === "MultiplicativeExpression") {
        if (opText === "%") left = arena.addCallExpr("mod", [left, right]);
        else left = arena.addBinaryExpr(opText === "/" ? BinOp.Div : BinOp.Mul, left, right);
      } else if (type === "RelationalExpression") {
        let op = BinOp.Lt;
        if (opText === "<=") op = BinOp.Lte;
        else if (opText === ">") op = BinOp.Gt;
        else if (opText === ">=") op = BinOp.Gte;
        left = arena.addBinaryExpr(op, left, right);
      } else if (type === "EqualityExpression") {
        left = arena.addBinaryExpr(opText === "!=" ? BinOp.Neq : BinOp.Eq, left, right);
      } else if (type === "AndExpression") {
        left = arena.addBinaryExpr(BinOp.And, left, right);
      } else {
        left = arena.addBinaryExpr(BinOp.Or, left, right);
      }
    }
    return left;
  }

  // 4. Exponentiation Expression
  if (type === "ExponentiationExpression" && count >= 3) {
    const baseId = lowerLinearWasmCstExpression(
      tree,
      kids.cPtrs[0]!,
      kids.cOffsets[0]!,
      kids.cPads[0]!,
      kids.cLens[0]!,
      kids.cTypes[0]!,
      arena,
      prefix,
      localNames,
    );
    const expId = lowerLinearWasmCstExpression(
      tree,
      kids.cPtrs[2]!,
      kids.cOffsets[2]!,
      kids.cPads[2]!,
      kids.cLens[2]!,
      kids.cTypes[2]!,
      arena,
      prefix,
      localNames,
    );
    return arena.addBinaryExpr(BinOp.Pow, baseId, expId);
  }

  // 5. Measurement Expression
  if (type === "MeasurementExpression" && count >= 1) {
    return lowerLinearWasmCstExpression(
      tree,
      kids.cPtrs[0]!,
      kids.cOffsets[0]!,
      kids.cPads[0]!,
      kids.cLens[0]!,
      kids.cTypes[0]!,
      arena,
      prefix,
      localNames,
    );
  }

  // 6. Feature Reference / Identifier
  if (type === "FeatureReferenceExpression" || type === "Name" || type === "ID" || type === "QualifiedName") {
    let rawName = extractLinearNodeText(tree, curOff, curPad, curLen).trim();
    if (prefix && localNames) {
      const dotIdx = rawName.indexOf(".");
      const root = dotIdx === -1 ? rawName : rawName.slice(0, dotIdx);
      if (localNames.has(root)) {
        rawName = prefix + rawName;
      }
    }
    return arena.addName(arena.interner.intern(rawName));
  }

  return -1;
}

/**
 * Lowers a SysML v2 / KerML CST expression node directly into an integer `ExprId` in `DAEBuilder`.
 */
export function lowerCstExpression(
  node: SysmlCstNode | null | undefined,
  arena: DAEBuilder,
  prefix = "",
  localNames?: Set<string>,
): number {
  if (!node) return arena.addRealLiteral(0.0);

  if (typeof node.ptr === "number" && node.ptr > 0 && node.tree?.mem32 && node.tree?.facade?.syntaxNames) {
    const fastId = lowerLinearWasmCstExpression(
      node.tree,
      node.ptr,
      node._startOffset ?? 0,
      node._cachedPad ?? 0,
      node._cachedLen ?? 0,
      node.typeId ?? node.tree.mem32[node.ptr >>> 2]! & 0x03ff,
      arena,
      prefix,
      localNames,
    );
    if (fastId >= 0) return fastId;
  }

  // Unwrap wrapper nodes
  while (
    node.type === "OwnedExpression" ||
    node.type === "SequenceExpression" ||
    node.type === "ArgumentValue" ||
    node.type === "ResultExpressionMember" ||
    node.type === "_Expression" ||
    node.type === "_BaseExpression"
  ) {
    const inner: SysmlCstNode | null | undefined =
      node.childForFieldName?.("ownedRelatedElement") ||
      ((node.childCount ?? 0) > 0 ? (node.child ? node.child(0) : node.children?.[0]) : null);
    if (inner && inner !== node) {
      node = inner;
    } else {
      break;
    }
  }

  // Handle parenthesized expressions: ( expr )
  const topCount = node.childCount ?? 0;
  if (topCount >= 3) {
    const first = node.child ? node.child(0) : node.children?.[0];
    const last = node.child ? node.child(topCount - 1) : node.children?.[topCount - 1];
    if (first?.text === "(" && last?.text === ")") {
      const inner = node.child ? node.child(1) : node.children?.[1];
      if (inner && topCount === 3) {
        return lowerCstExpression(inner, arena, prefix, localNames);
      }
    }
  }

  const type = node.type;

  // 1. Literals
  if (type === "LiteralReal" || type === "RealValue") {
    const val = parseFloat(node.text.trim());
    return arena.addRealLiteral(isNaN(val) ? 0.0 : val);
  }
  if (type === "LiteralInteger" || type === "DECIMAL_VALUE") {
    const val = parseFloat(node.text.trim());
    return arena.addRealLiteral(isNaN(val) ? 0.0 : val);
  }
  if (type === "LiteralBoolean") {
    return arena.addBoolLiteral(node.text.trim() === "true");
  }

  // 2. Unary Expression: -x, +x, !x, not x
  if (type === "UnaryExpression") {
    const opNode = node.childForFieldName?.("operator") || (node.child ? node.child(0) : node.children?.[0]);
    const operandNode = node.childForFieldName?.("operand") || (node.child ? node.child(1) : node.children?.[1]);
    const opText = opNode?.text?.trim() || "-";
    const childId = lowerCstExpression(operandNode, arena, prefix, localNames);

    if (opText === "-") {
      return arena.addUnaryExpr(UnaryOp.Negate, childId);
    }
    if (opText === "!" || opText === "not") {
      return arena.addUnaryExpr(UnaryOp.Not, childId);
    }
    return childId; // Unary + is a no-op
  }

  // 3. Additive Expression: a + b - c
  if (type === "AdditiveExpression") {
    const count = node.childCount ?? node.children?.length ?? 0;
    let left = lowerCstExpression(node.child ? node.child(0) : node.children?.[0], arena, prefix, localNames);

    for (let i = 1; i < count; i += 2) {
      const opNode = node.child ? node.child(i) : node.children?.[i];
      const rightNode = node.child ? node.child(i + 1) : node.children?.[i + 1];
      if (!rightNode) break;

      const right = lowerCstExpression(rightNode, arena, prefix, localNames);
      const op = opNode?.text?.trim() === "-" ? BinOp.Sub : BinOp.Add;
      left = arena.addBinaryExpr(op, left, right);
    }
    return left;
  }

  // 4. Multiplicative Expression: a * b / c % d
  if (type === "MultiplicativeExpression") {
    const count = node.childCount ?? node.children?.length ?? 0;
    let left = lowerCstExpression(node.child ? node.child(0) : node.children?.[0], arena, prefix, localNames);

    for (let i = 1; i < count; i += 2) {
      const opNode = node.child ? node.child(i) : node.children?.[i];
      const rightNode = node.child ? node.child(i + 1) : node.children?.[i + 1];
      if (!rightNode) break;

      const right = lowerCstExpression(rightNode, arena, prefix, localNames);
      const opText = opNode?.text?.trim();
      if (opText === "%") {
        left = arena.addCallExpr("mod", [left, right]);
      } else {
        const op = opText === "/" ? BinOp.Div : BinOp.Mul;
        left = arena.addBinaryExpr(op, left, right);
      }
    }
    return left;
  }

  // 5. Exponentiation Expression: a ** b or a ^ b
  if (type === "ExponentiationExpression") {
    const baseNode = node.childForFieldName?.("base") || (node.child ? node.child(0) : node.children?.[0]);
    const expNode = node.childForFieldName?.("exponent") || (node.child ? node.child(2) : node.children?.[2]);
    const baseId = lowerCstExpression(baseNode, arena, prefix, localNames);
    const expId = lowerCstExpression(expNode, arena, prefix, localNames);
    return arena.addBinaryExpr(BinOp.Pow, baseId, expId);
  }

  // 6. Relational Expression: a < b, a <= b, a > b, a >= b
  if (type === "RelationalExpression") {
    const count = node.childCount ?? node.children?.length ?? 0;
    let left = lowerCstExpression(node.child ? node.child(0) : node.children?.[0], arena, prefix, localNames);

    for (let i = 1; i < count; i += 2) {
      const opNode = node.child ? node.child(i) : node.children?.[i];
      const rightNode = node.child ? node.child(i + 1) : node.children?.[i + 1];
      if (!rightNode) break;

      const right = lowerCstExpression(rightNode, arena, prefix, localNames);
      const opText = opNode?.text?.trim();
      let op = BinOp.Lt;
      if (opText === "<=") op = BinOp.Lte;
      else if (opText === ">") op = BinOp.Gt;
      else if (opText === ">=") op = BinOp.Gte;

      left = arena.addBinaryExpr(op, left, right);
    }
    return left;
  }

  // 7. Equality Expression: a == b, a != b
  if (type === "EqualityExpression") {
    const count = node.childCount ?? node.children?.length ?? 0;
    let left = lowerCstExpression(node.child ? node.child(0) : node.children?.[0], arena, prefix, localNames);

    for (let i = 1; i < count; i += 2) {
      const opNode = node.child ? node.child(i) : node.children?.[i];
      const rightNode = node.child ? node.child(i + 1) : node.children?.[i + 1];
      if (!rightNode) break;

      const right = lowerCstExpression(rightNode, arena, prefix, localNames);
      const op = opNode?.text?.trim() === "!=" ? BinOp.Neq : BinOp.Eq;
      left = arena.addBinaryExpr(op, left, right);
    }
    return left;
  }

  // 8. Logical And / Or
  if (type === "AndExpression") {
    const count = node.childCount ?? node.children?.length ?? 0;
    let left = lowerCstExpression(node.child ? node.child(0) : node.children?.[0], arena, prefix, localNames);
    for (let i = 1; i < count; i += 2) {
      const rightNode = node.child ? node.child(i + 1) : node.children?.[i + 1];
      if (!rightNode) break;
      const right = lowerCstExpression(rightNode, arena, prefix, localNames);
      left = arena.addBinaryExpr(BinOp.And, left, right);
    }
    return left;
  }
  if (type === "OrExpression") {
    const count = node.childCount ?? node.children?.length ?? 0;
    let left = lowerCstExpression(node.child ? node.child(0) : node.children?.[0], arena, prefix, localNames);
    for (let i = 1; i < count; i += 2) {
      const rightNode = node.child ? node.child(i + 1) : node.children?.[i + 1];
      if (!rightNode) break;
      const right = lowerCstExpression(rightNode, arena, prefix, localNames);
      left = arena.addBinaryExpr(BinOp.Or, left, right);
    }
    return left;
  }

  // 9. Invocation Expression: der(x), sin(x), sqrt(x)
  if (type === "InvocationExpression") {
    const fnNameNode = findFirstDescendant(node, "ID") || node.childForFieldName?.("instantiatedType");
    const fnName = fnNameNode?.text?.trim() || "";

    // Check der(variable)
    if (fnName === "der") {
      const argNode = findFirstDescendant(node, "Argument") || findFirstDescendant(node, "FeatureReferenceExpression");
      let varName = argNode?.text?.trim() || "";
      if (prefix && localNames && localNames.has(varName.split(".")[0]!)) {
        varName = prefix + varName;
      }
      const nameId = arena.interner.intern(varName);
      const nameExprId = arena.addName(nameId);
      return arena.addDerExpr(nameExprId);
    }

    // Elementary math functions (sin, cos, exp, log, sqrt, etc.)
    const argsNodes = findCstDescendants(node, "Argument");
    const argExprIds = argsNodes.map((a) => lowerCstExpression(a, arena, prefix, localNames));
    const fnNameId = arena.interner.intern(fnName);
    return arena.addCallExpr(fnNameId, argExprIds);
  }

  // 10. Measurement Expression: 100.0 [km / h]
  if (type === "MeasurementExpression") {
    const valNode = node.childForFieldName?.("value") || (node.child ? node.child(0) : node.children?.[0]);
    return lowerCstExpression(valNode, arena, prefix, localNames);
  }

  // 11. Feature Reference (Identifier / Variable Name)
  if (type === "FeatureReferenceExpression" || type === "Name" || type === "ID" || type === "QualifiedName") {
    let rawName = node.text.trim();
    if (prefix && localNames) {
      const dotIdx = rawName.indexOf(".");
      const root = dotIdx === -1 ? rawName : rawName.slice(0, dotIdx);
      if (localNames.has(root)) {
        rawName = prefix + rawName;
      }
    }
    const nameId = arena.interner.intern(rawName);
    return arena.addName(nameId);
  }

  // Fallback: If node has a numeric or identifier string text
  const rawText = node.text?.trim() || "";
  const numVal = parseFloat(rawText);
  if (!isNaN(numVal) && isFinite(numVal) && /^[0-9.eE+-]+$/.test(rawText)) {
    return arena.addRealLiteral(numVal);
  }

  // Fallback variable reference
  if (/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(rawText)) {
    let name = rawText;
    if (prefix && localNames) {
      const dotIdx = name.indexOf(".");
      const root = dotIdx === -1 ? name : name.slice(0, dotIdx);
      if (localNames.has(root)) {
        name = prefix + name;
      }
    }
    const nameId = arena.interner.intern(name);
    return arena.addName(nameId);
  }

  return arena.addRealLiteral(0.0);
}

/**
 * Lexical token produced by `tokenizeSysml` for lightweight expression/statement parsing.
 */
export interface SysML2Token {
  /** Token classification (`num`, `ident`, `op`, `paren`, `semi`, or `kw`). */
  type: "num" | "ident" | "op" | "paren" | "semi" | "kw";
  /** Raw token lexeme string. */
  val: string;
}

const SYSML_KEYWORDS = new Set([
  "action",
  "calc",
  "def",
  "in",
  "out",
  "item",
  "attribute",
  "assign",
  "return",
  "if",
  "else",
  "while",
  "loop",
  "true",
  "false",
  "and",
  "or",
  "not",
]);

/**
 * Tokenizes simple SysML v2 calculation expressions and statements without regular expressions.
 */
export function tokenizeSysml(input: string): SysML2Token[] {
  const tokens: SysML2Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i]!;

    // Skip whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }

    // Skip single-line comments //
    if (ch === "/" && i + 1 < len && input[i + 1] === "/") {
      i += 2;
      while (i < len && input[i] !== "\n") i++;
      continue;
    }

    // Skip block comments /* ... */
    if (ch === "/" && i + 1 < len && input[i + 1] === "*") {
      i += 2;
      while (i + 1 < len && !(input[i] === "*" && input[i + 1] === "/")) i++;
      if (i + 1 < len) i += 2;
      continue;
    }

    // Number: \d+(?:\.\d+)?(?:[eE][+-]?\d+)?
    if (ch >= "0" && ch <= "9") {
      const start = i;
      i++;
      let hasDot = false;
      let hasExp = false;
      while (i < len) {
        const c = input[i]!;
        if (c >= "0" && c <= "9") {
          i++;
        } else if (c === "." && !hasDot && !hasExp && i + 1 < len && input[i + 1]! >= "0" && input[i + 1]! <= "9") {
          hasDot = true;
          i++;
        } else if ((c === "e" || c === "E") && !hasExp) {
          hasExp = true;
          i++;
          if (i < len && (input[i] === "+" || input[i] === "-")) {
            i++;
          }
        } else {
          break;
        }
      }
      tokens.push({ type: "num", val: input.slice(start, i) });
      continue;
    }

    // Ident / Keyword: [A-Za-z_][A-Za-z0-9_.]*
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      const start = i;
      i++;
      while (i < len) {
        const c = input[i]!;
        if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === ".") {
          i++;
        } else {
          break;
        }
      }
      const val = input.slice(start, i);
      if (SYSML_KEYWORDS.has(val)) {
        tokens.push({ type: "kw", val });
      } else {
        tokens.push({ type: "ident", val });
      }
      continue;
    }

    // Two-character operators: ==, !=, <=, >=, :=, &&, ||, **
    if (i + 1 < len) {
      const next = input[i + 1]!;
      if (
        (ch === "=" && next === "=") ||
        (ch === "!" && next === "=") ||
        (ch === "<" && next === "=") ||
        (ch === ">" && next === "=") ||
        (ch === ":" && next === "=") ||
        (ch === "&" && next === "&") ||
        (ch === "|" && next === "|") ||
        (ch === "*" && next === "*")
      ) {
        tokens.push({ type: "op", val: ch + next });
        i += 2;
        continue;
      }
    }

    // Single-character punctuation: [();{},]
    if (ch === "(" || ch === ")" || ch === "{" || ch === "}" || ch === ",") {
      tokens.push({ type: "paren", val: ch });
      i++;
      continue;
    }
    if (ch === ";") {
      tokens.push({ type: "semi", val: ch });
      i++;
      continue;
    }

    // Single-character operators: ^, +, -, *, /, %, =, <, >, !, :
    if (
      ch === "^" ||
      ch === "+" ||
      ch === "-" ||
      ch === "*" ||
      ch === "/" ||
      ch === "%" ||
      ch === "=" ||
      ch === "<" ||
      ch === ">" ||
      ch === "!" ||
      ch === ":"
    ) {
      tokens.push({ type: "op", val: ch });
      i++;
      continue;
    }

    // Any other character: skip
    i++;
  }

  return tokens;
}

/**
 * Pratt / recursive-descent expression parser generating linear-memory `DAEBuilder` `ExprId`s directly.
 */
export class SysmlExprParser {
  private pos = 0;

  /**
   * @param tokens - Token stream produced by `tokenizeSysml`.
   * @param arena - Target `DAEBuilder` arena to allocate expression nodes in.
   */
  constructor(
    private tokens: SysML2Token[],
    private arena: DAEBuilder,
  ) {}

  /**
   * Parses the token stream and returns the root `ExprId` in `this.arena`.
   */
  public parse(): number {
    return this.parseLogicalOr();
  }

  private peek(): SysML2Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): SysML2Token {
    return this.tokens[this.pos++]!;
  }

  private matchOp(...ops: string[]): string | null {
    const t = this.peek();
    if (t && (t.type === "op" || (t.type === "kw" && (t.val === "and" || t.val === "or"))) && ops.includes(t.val)) {
      this.pos++;
      return t.val;
    }
    return null;
  }

  private parseLogicalOr(): number {
    let left = this.parseLogicalAnd();
    while (this.matchOp("||", "or")) {
      const right = this.parseLogicalAnd();
      left = this.arena.addBinaryExpr(BinOp.Or, left, right);
    }
    return left;
  }

  private parseLogicalAnd(): number {
    let left = this.parseEquality();
    while (this.matchOp("&&", "and")) {
      const right = this.parseEquality();
      left = this.arena.addBinaryExpr(BinOp.And, left, right);
    }
    return left;
  }

  private parseEquality(): number {
    let left = this.parseRelational();
    let op: string | null;
    while ((op = this.matchOp("==", "!="))) {
      const right = this.parseRelational();
      left = this.arena.addBinaryExpr(op === "==" ? BinOp.Eq : BinOp.Neq, left, right);
    }
    return left;
  }

  private parseRelational(): number {
    let left = this.parseAdditive();
    let op: string | null;
    while ((op = this.matchOp("<", "<=", ">", ">="))) {
      const right = this.parseAdditive();
      const binOp = op === "<" ? BinOp.Lt : op === "<=" ? BinOp.Lte : op === ">" ? BinOp.Gt : BinOp.Gte;
      left = this.arena.addBinaryExpr(binOp, left, right);
    }
    return left;
  }

  private parseAdditive(): number {
    let left = this.parseMultiplicative();
    let op: string | null;
    while ((op = this.matchOp("+", "-"))) {
      const right = this.parseMultiplicative();
      left = this.arena.addBinaryExpr(op === "+" ? BinOp.Add : BinOp.Sub, left, right);
    }
    return left;
  }

  private parseMultiplicative(): number {
    let left = this.parsePower();
    let op: string | null;
    while ((op = this.matchOp("*", "/", "%"))) {
      const right = this.parsePower();
      if (op === "%") {
        left = this.arena.addCallExpr("mod", [left, right]);
      } else {
        left = this.arena.addBinaryExpr(op === "*" ? BinOp.Mul : BinOp.Div, left, right);
      }
    }
    return left;
  }

  private parsePower(): number {
    let left = this.parseUnary();
    while (this.matchOp("^", "**")) {
      const right = this.parseUnary();
      left = this.arena.addBinaryExpr(BinOp.Pow, left, right);
    }
    return left;
  }

  private parseUnary(): number {
    const t = this.peek();
    if (
      t &&
      (t.type === "op" || t.type === "kw") &&
      (t.val === "-" || t.val === "+" || t.val === "!" || t.val === "not")
    ) {
      this.pos++;
      const operand = this.parseUnary();
      if (t.val === "-") {
        return this.arena.addUnaryExpr(UnaryOp.Negate, operand);
      } else if (t.val === "+") {
        return operand;
      } else {
        return this.arena.addUnaryExpr(UnaryOp.Not, operand);
      }
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const t = this.next();
    if (!t) return this.arena.addRealLiteral(0);

    if (t.type === "num") {
      const val = parseFloat(t.val);
      return this.arena.addRealLiteral(val);
    }
    if (t.type === "kw") {
      if (t.val === "true") return this.arena.addBoolLiteral(true);
      if (t.val === "false") return this.arena.addBoolLiteral(false);
    }
    if (t.type === "ident") {
      if (this.peek() && this.peek()!.type === "paren" && this.peek()!.val === "(") {
        this.next(); // consume '('
        const args: number[] = [];
        if (!(this.peek() && this.peek()!.type === "paren" && this.peek()!.val === ")")) {
          while (true) {
            args.push(this.parse());
            if (this.peek() && this.peek()!.val === ",") {
              this.next(); // consume ','
              continue;
            }
            break;
          }
        }
        if (this.peek() && this.peek()!.type === "paren" && this.peek()!.val === ")") {
          this.next(); // consume ')'
        }
        if (t.val === "der" && args.length === 1) {
          return this.arena.addDerExpr(args[0]!);
        }
        return this.arena.addCallExpr(t.val, args);
      }
      const nameId = this.arena.interner.intern(t.val);
      return this.arena.addName(nameId);
    }
    if (t.type === "paren" && t.val === "(") {
      const expr = this.parse();
      if (this.peek() && this.peek()!.val === ")") {
        this.next();
      }
      return expr;
    }

    return this.arena.addRealLiteral(0);
  }
}

/**
 * Lowers an expression string into an arena ExprId.
 */
export function lowerSysmlExpr(exprText: string, arena: DAEBuilder): number {
  const tokens = tokenizeSysml(exprText);
  const parser = new SysmlExprParser(tokens, arena);
  return parser.parse();
}

/**
 * Prefixes local variable and port identifiers in an equation or expression string.
 */
export function prefixSysmlExpression(exprText: string, prefix: string, localNames: Set<string>): string {
  if (!prefix || localNames.size === 0) return exprText;
  const tokens = tokenizeSysml(exprText);
  const result: string[] = [];
  for (const t of tokens) {
    if (t.type === "ident") {
      const root = t.val.split(".")[0]!;
      if (localNames.has(root)) {
        result.push(prefix + t.val);
      } else {
        result.push(t.val);
      }
    } else {
      result.push(t.val);
    }
  }
  return result.join(" ");
}

/**
 * Compiles a parsed SysML v2 CST tree directly into a `DAEBuilder` arena.
 */
export class SysML2CstFlattener {
  private arena: DAEBuilder;
  private portDefs = new Map<string, PortMeta>();
  private compDefs = new Map<string, SysmlCstNode>();
  private activePorts = new Map<string, ActivePortInstance>();
  private connections: { p1: string; p2: string }[] = [];
  private parameters: string[] = [];
  private states: string[] = [];
  private derivatives: string[] = [];
  private overrides: Record<string, number>;
  private rootCompName: string;
  private sourceText?: string | undefined;

  /**
   * @param options - Arena instance, parameter overrides, and target root component configuration.
   */
  constructor(options: CstFlattenerOptions = {}) {
    this.arena = options.arena ?? new DAEBuilder();
    this.overrides = options.overrides ?? {};
    this.rootCompName = options.rootComponentName ?? "";
    this.sourceText = options.sourceText;
  }

  /**
   * Main entry point to flatten a parsed SysML v2 root CST node into the DAE arena.
   *
   * @param rootNode - Root CST node returned by the SysML v2 WASM GLR parser.
   * @returns Lowered DAE arena and variable/equation summary metadata.
   */
  public flatten(rootNode: SysmlCstNode): LoweredSysml2CstResult {
    const initialEqCount = this.arena.eqCount;

    // 0. Extract experiment configs from root text if present
    const cleanSource = this.sourceText || rootNode.text || "";
    const startMatch = /\bstartTime\s*(?::\s*[A-Za-z0-9_:]+\s*)?=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (startMatch) this.arena.experiment.startTime = parseFloat(startMatch[1]!);
    const stopMatch = /\bstopTime\s*(?::\s*[A-Za-z0-9_:]+\s*)?=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (stopMatch) this.arena.experiment.stopTime = parseFloat(stopMatch[1]!);
    const intervalMatch = /\b(?:interval|step)\s*(?::\s*[A-Za-z0-9_:]+\s*)?=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (intervalMatch) this.arena.experiment.interval = parseFloat(intervalMatch[1]!);
    const tolMatch = /\btolerance\s*(?::\s*[A-Za-z0-9_:]+\s*)?=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (tolMatch) this.arena.experiment.tolerance = parseFloat(tolMatch[1]!);

    // 1. Ingest port definitions
    this.collectPortDefinitions(rootNode);

    // 2. Ingest all part/constraint definitions
    this.collectComponentDefinitions(rootNode);

    // 3. Determine root component
    if (!this.rootCompName) {
      this.rootCompName = this.determineRootComponent(rootNode);
    }

    const rootDefNode = this.compDefs.get(this.rootCompName);
    if (rootDefNode) {
      this.elaborateComponent(rootDefNode, "", this.overrides);
    } else {
      this.elaborateComponent(rootNode, "", this.overrides);
    }

    // 4. Resolve global connection topology and Kirchhoff port conservation
    this.processGlobalConnections();

    return {
      arena: this.arena,
      rootName: this.rootCompName,
      parameters: this.parameters,
      states: this.states,
      derivatives: this.derivatives,
      eqCount: this.arena.eqCount - initialEqCount,
    };
  }

  /**
   * Scans the CST for `PortDefinition` nodes and classifies their attributes into
   * potential (across) and `flow` (through) variables.
   */
  private collectPortDefinitions(rootNode: SysmlCstNode | null | undefined): void {
    const portDefNodes = findCstDescendants(rootNode, "PortDefinition");
    for (const pNode of portDefNodes) {
      const nameNode = findFirstDescendant(pNode, "Name") || findFirstDescendant(pNode, "ID");
      const name = nameNode?.text?.trim();
      if (!name) continue;

      const potentialAttrs: string[] = [];
      const flowAttrs: string[] = [];

      const attrNodes = findCstDescendants(pNode, "AttributeUsage");
      for (const an of attrNodes) {
        const attrNameNode = findFirstDescendant(an, "Name") || findFirstDescendant(an, "ID");
        const attrName = attrNameNode?.text?.trim();
        if (!attrName) continue;

        // Check if marked as flow
        const isFlow = an.text.includes("flow");
        if (isFlow) {
          flowAttrs.push(attrName);
        } else {
          potentialAttrs.push(attrName);
        }
      }

      const flowUsageNodes = findCstDescendants(pNode, "FlowUsage");
      for (const fn of flowUsageNodes) {
        const flowNameNode = findFirstDescendant(fn, "Name") || findFirstDescendant(fn, "ID");
        const flowName = flowNameNode?.text?.trim();
        if (flowName) flowAttrs.push(flowName);
      }

      this.portDefs.set(name, {
        name,
        potentialAttrs: potentialAttrs.length > 0 ? potentialAttrs : ["v"],
        flowAttrs: flowAttrs.length > 0 ? flowAttrs : ["i"],
      });
    }

    if (this.portDefs.size === 0) {
      const cleanSource = this.sourceText || rootNode?.text || "";
      const portDefRegex = /\bport\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
      let pdm: RegExpExecArray | null;
      while ((pdm = portDefRegex.exec(cleanSource)) !== null) {
        const portName = pdm[1]!;
        const openBrace = cleanSource.indexOf("{", pdm.index);
        let depth = 1;
        let i = openBrace + 1;
        while (i < cleanSource.length && depth > 0) {
          if (cleanSource[i] === "{") depth++;
          else if (cleanSource[i] === "}") depth--;
          i++;
        }
        const body = cleanSource.slice(openBrace + 1, i - 1);
        const potentialAttrs: string[] = [];
        const flowAttrs: string[] = [];
        const attrLineRegex =
          /\b(?:(in|out|inout)\s+)?(?:(flow)\s+)?attribute\s+(?:item\s+)?(?:(flow)\s+)?([A-Za-z_][A-Za-z0-9_]*)/g;
        let am: RegExpExecArray | null;
        while ((am = attrLineRegex.exec(body)) !== null) {
          const isFlow = Boolean(am[2] || am[3] || /\bflow\b/.test(am[0]));
          const attrName = am[4]!;
          if (isFlow) flowAttrs.push(attrName);
          else potentialAttrs.push(attrName);
        }
        this.portDefs.set(portName, {
          name: portName,
          potentialAttrs: potentialAttrs.length > 0 ? potentialAttrs : ["v"],
          flowAttrs: flowAttrs.length > 0 ? flowAttrs : ["i"],
        });
      }
    }
  }

  /**
   * Indexes all `PartDefinition` and `ConstraintDefinition` CST nodes by declared name.
   */
  private collectComponentDefinitions(rootNode: SysmlCstNode | null | undefined): void {
    const partDefNodes = findCstDescendants(rootNode, "PartDefinition");
    const constraintDefNodes = findCstDescendants(rootNode, "ConstraintDefinition");

    for (const node of [...partDefNodes, ...constraintDefNodes]) {
      const nameNode = findFirstDescendant(node, "Name") || findFirstDescendant(node, "ID");
      const name = nameNode?.text?.trim();
      if (name) {
        this.compDefs.set(name, node);
      }
    }

    const cleanSource = this.sourceText || rootNode?.text || "";
    if (this.compDefs.size === 0 && cleanSource) {
      const compRegex = /\b(part|constraint|model|package)\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
      let cdm: RegExpExecArray | null;
      while ((cdm = compRegex.exec(cleanSource)) !== null) {
        const cName = cdm[2]!;
        const openBrace = cleanSource.indexOf("{", cdm.index);
        let depth = 1;
        let i = openBrace + 1;
        while (i < cleanSource.length && depth > 0) {
          if (cleanSource[i] === "{") depth++;
          else if (cleanSource[i] === "}") depth--;
          i++;
        }
        const fullDefText = cleanSource.slice(cdm.index, i);
        this.compDefs.set(cName, {
          type: cdm[1] === "constraint" ? "ConstraintDefinition" : "PartDefinition",
          text: fullDefText,
          name: cName,
        });
      }
    }
  }

  /**
   * Heuristically selects the top-level system definition by finding a component that is
   * neither instantiated as a child `PartUsage` nor specialized as a superclass (`:>`).
   */
  private determineRootComponent(rootNode?: SysmlCstNode | null): string {
    if (this.compDefs.size === 0) {
      const cleanSource = this.sourceText || rootNode?.text || "";
      const nameMatch = /(?:constraint|part|package|model)\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(cleanSource);
      if (nameMatch) return nameMatch[1]!;
      const nameNode = findFirstDescendant(rootNode, "Name") || findFirstDescendant(rootNode, "ID");
      return nameNode?.text?.trim() || "SysmlModel";
    }
    if (this.compDefs.size === 1) return Array.from(this.compDefs.keys())[0]!;

    // Find component not instantiated as subpart in others
    const instantiatedTypes = new Set<string>();
    const superclasses = new Set<string>();

    for (const compNode of this.compDefs.values()) {
      const partUsages = findCstDescendants(compNode, "PartUsage");
      for (const pu of partUsages) {
        const typeNode = findFirstDescendant(pu, "FeatureTyping");
        const typeName = typeNode?.text?.replace(/^[:\s]+/, "").trim();
        if (typeName) instantiatedTypes.add(typeName);
      }
      const subpartMatch = /\bpart\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/g;
      let sm: RegExpExecArray | null;
      const compText = compNode.text || "";
      while ((sm = subpartMatch.exec(compText)) !== null) {
        instantiatedTypes.add(sm[1]!);
      }

      const subclassificationNodes = findCstDescendants(compNode, "OwnedSubclassification");
      for (const sc of subclassificationNodes) {
        const superName = sc.text.replace(/^[:>\s]+/, "").trim();
        if (superName) superclasses.add(superName);
      }
    }

    // Prefer components that are neither subparts nor superclasses
    for (const name of this.compDefs.keys()) {
      if (!instantiatedTypes.has(name) && !superclasses.has(name)) {
        return name;
      }
    }

    for (const name of this.compDefs.keys()) {
      if (!instantiatedTypes.has(name)) {
        return name;
      }
    }

    return Array.from(this.compDefs.keys())[0]!;
  }

  private extractComponentFullText(sourceText: string, compName: string): string | null {
    const reg = new RegExp(`\\b(?:part|constraint|model|package)\\s+(?:def\\s+)?${compName}\\b[^{]*\\{`, "g");
    const m = reg.exec(sourceText);
    if (!m) return null;
    const openBrace = sourceText.indexOf("{", m.index);
    let depth = 1;
    let i = openBrace + 1;
    while (i < sourceText.length && depth > 0) {
      if (sourceText[i] === "{") depth++;
      else if (sourceText[i] === "}") depth--;
      i++;
    }
    return sourceText.slice(m.index, i);
  }

  private getCompText(compNode: SysmlCstNode): string {
    const compNameNode = findFirstDescendant(compNode, "Name") || findFirstDescendant(compNode, "ID");
    const compName = compNameNode?.text?.trim() || compNode.name;
    if (compName && this.sourceText) {
      const full = this.extractComponentFullText(this.sourceText, compName);
      if (full && full.length > (compNode.text?.length || 0)) {
        return full;
      }
    }
    return compNode.text || "";
  }

  /**
   * Elaborates a component definition: attributes, ports, subparts, inheritance, equations.
   * Uses visitedDefs set to prevent unbounded recursion on circular inheritance cycles.
   */
  private elaborateComponent(
    compNode: SysmlCstNode,
    prefix: string,
    overrides: Record<string, number>,
    visitedDefs = new Set<string>(),
  ): void {
    const compNameNode = findFirstDescendant(compNode, "Name") || findFirstDescendant(compNode, "ID");
    const compName = compNameNode?.text?.trim() || "";
    const visitKey = `${prefix}::${compName}`;
    if (visitedDefs.has(visitKey)) return;
    visitedDefs.add(visitKey);

    const localNames = new Set<string>();

    // Collect all state variables referenced via der(x) in CST equations (zero-regex)
    const derStateNames = new Set<string>();
    const invNodes = findCstDescendants(compNode, "InvocationExpression");
    for (const inv of invNodes) {
      const fnNode = findFirstDescendant(inv, "ID") || inv.childForFieldName?.("instantiatedType");
      if (fnNode?.text?.trim() === "der") {
        const argNode = findFirstDescendant(inv, "Argument") || findFirstDescendant(inv, "FeatureReferenceExpression");
        const argText = argNode?.text?.trim();
        if (argText) {
          const dotIdx = argText.indexOf(".");
          const baseName = dotIdx === -1 ? argText : argText.slice(0, dotIdx);
          derStateNames.add(baseName);
        }
      }
    }
    // Also scan compNode text for der(varName) to cover bare equations when syntax recovery occurs
    const compText = this.getCompText(compNode);
    const derMatchRegex = /\bder\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/g;
    let dm: RegExpExecArray | null;
    while ((dm = derMatchRegex.exec(compText)) !== null) {
      const arg = dm[1]!;
      const dotIdx = arg.indexOf(".");
      const baseName = dotIdx === -1 ? arg : arg.slice(0, dotIdx);
      derStateNames.add(baseName);
    }

    // 1. Process Inheritance (:>)
    const subclassificationNodes = findCstChildren(compNode, "OwnedSubclassification");
    for (const sc of subclassificationNodes) {
      const superName = sc.text.replace(/^[:>\s]+/, "").trim();
      const superDefNode = this.compDefs.get(superName);
      if (superDefNode && superDefNode !== compNode) {
        // Inherit members of superclass first with cycle guard
        this.elaborateComponent(superDefNode, prefix, overrides, visitedDefs);
      }
    }

    // 2. Process Ports
    const portUsages = findCstDescendants(compNode, "PortUsage");
    for (const pu of portUsages) {
      // Don't process ports of nested subparts here
      if (this.isDescendantOfPartUsage(pu, compNode)) continue;

      const nameNode = findFirstDescendant(pu, "Name") || findFirstDescendant(pu, "ID");
      const portName = nameNode?.text?.trim();
      if (!portName) continue;

      localNames.add(portName);
      const portFullName = prefix + portName;

      const typeNode = findFirstDescendant(pu, "FeatureTyping");
      const rawType = typeNode?.text?.replace(/^[:\s]+/, "").trim() || "";
      const isConjugated = pu.text.includes("~") || rawType.startsWith("~");
      const cleanType = rawType.replace(/^~\s*/, "");

      const pDef = this.portDefs.get(cleanType) ?? {
        name: cleanType,
        potentialAttrs: ["v"],
        flowAttrs: ["i"],
      };

      for (const pot of pDef.potentialAttrs) {
        const varName = `${portFullName}.${pot}`;
        this.arena.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      }
      for (const fl of pDef.flowAttrs) {
        const varName = `${portFullName}.${fl}`;
        this.arena.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      }

      this.activePorts.set(portFullName, {
        fullName: portFullName,
        portType: cleanType,
        isConjugated,
        potentialAttrs: pDef.potentialAttrs,
        flowAttrs: pDef.flowAttrs,
      });
    }

    // Fallback port scanning for flattened/recovered CST nodes
    if (portUsages.length === 0) {
      const portInstRegex =
        /\b(?:(in|out)\s+)?port\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:(~\s*)?)([A-Za-z_][A-Za-z0-9_.]*)/g;
      let pm: RegExpExecArray | null;
      while ((pm = portInstRegex.exec(compText)) !== null) {
        const portName = pm[2]!;
        if (localNames.has(portName)) continue;
        localNames.add(portName);
        const portFullName = prefix + portName;

        const isConjugated = Boolean(pm[3]);
        const cleanType = pm[4]!.trim();

        const pDef = this.portDefs.get(cleanType) ?? {
          name: cleanType,
          potentialAttrs: ["v"],
          flowAttrs: ["i"],
        };

        for (const pot of pDef.potentialAttrs) {
          const varName = `${portFullName}.${pot}`;
          this.arena.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        }
        for (const fl of pDef.flowAttrs) {
          const varName = `${portFullName}.${fl}`;
          this.arena.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        }

        this.activePorts.set(portFullName, {
          fullName: portFullName,
          portType: cleanType,
          isConjugated,
          potentialAttrs: pDef.potentialAttrs,
          flowAttrs: pDef.flowAttrs,
        });
      }
    }

    // 3. Process Attributes
    const attrUsages = findCstDescendants(compNode, "AttributeUsage");
    for (const au of attrUsages) {
      if (this.isDescendantOfPartUsage(au, compNode)) continue;
      if (this.isDescendantOfActionOrCalc(au, compNode)) continue;

      const nameNode = findFirstDescendant(au, "Name") || findFirstDescendant(au, "ID");
      const attrName = nameNode?.text?.trim();
      if (!attrName) continue;

      localNames.add(attrName);
      const fullName = prefix + attrName;

      // Extract default value
      const valNode = findFirstDescendant(au, "FeatureValue") || findFirstDescendant(au, "OwnedExpression");
      let defaultVal = 0.0;
      if (valNode) {
        const rawVal = valNode.text.replace(/^[=:\s]+/, "").trim();
        const parsed = parseFloat(rawVal);
        if (!isNaN(parsed) && isFinite(parsed)) defaultVal = parsed;
      }
      if (overrides[attrName] !== undefined) {
        defaultVal = overrides[attrName]!;
      }

      const isInput = au.text.includes("in ");
      const isOutput = au.text.includes("out ");
      const causality = isInput ? Causality.Input : isOutput ? Causality.Output : Causality.Local;

      // Check if state variable: der(attrName) referenced in equations
      const isState = derStateNames.has(attrName);
      const isParam = !isState && (isInput || valNode !== null || overrides[attrName] !== undefined);
      const variability = isParam ? Variability.Parameter : Variability.Continuous;

      if (isParam) {
        this.parameters.push(fullName);
      } else {
        this.states.push(fullName);
      }

      const existingIdx = this.arena.lookupVariable(fullName);
      const varIdx =
        existingIdx !== -1
          ? existingIdx
          : this.arena.addVariable(fullName, VarType.Real, variability, causality, defaultVal);

      if (isState) {
        const startExpr = this.arena.addRealLiteral(defaultVal);
        this.arena.setVarAttrExpr(varIdx, VarAttrKind.Start, startExpr);
        const fixedExpr = this.arena.addBoolLiteral(true);
        this.arena.setVarAttrExpr(varIdx, VarAttrKind.Fixed, fixedExpr);
        this.arena.setVarFixed(varIdx, true);
        this.derivatives.push(`der(${fullName})`);
      }
    }

    // Fallback attribute scanning for flattened/recovered CST nodes
    if (attrUsages.length === 0) {
      let localBody = compText;
      // Strip subpart blocks with { ... } so inline attribute overrides aren't treated as parent attributes
      const subpartBraceRegex = /\bpart\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z_][A-Za-z0-9_]*\s*\{/g;
      let sbm: RegExpExecArray | null;
      while ((sbm = subpartBraceRegex.exec(localBody)) !== null) {
        const openBrace = localBody.indexOf("{", sbm.index);
        let depth = 1;
        let i = openBrace + 1;
        while (i < localBody.length && depth > 0) {
          if (localBody[i] === "{") depth++;
          else if (localBody[i] === "}") depth--;
          i++;
        }
        localBody = localBody.slice(0, sbm.index) + "/* subpart */" + localBody.slice(i);
        subpartBraceRegex.lastIndex = sbm.index + 13;
      }

      // Strip action/calc blocks with { ... } so local action parameters aren't treated as component attributes
      const actionBraceRegex = /\b(?:action|calc)\s+(?:def\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\{/g;
      let abm: RegExpExecArray | null;
      while ((abm = actionBraceRegex.exec(localBody)) !== null) {
        const openBrace = localBody.indexOf("{", abm.index);
        let depth = 1;
        let i = openBrace + 1;
        while (i < localBody.length && depth > 0) {
          if (localBody[i] === "{") depth++;
          else if (localBody[i] === "}") depth--;
          i++;
        }
        localBody = localBody.slice(0, abm.index) + "/* action */" + localBody.slice(i);
        actionBraceRegex.lastIndex = abm.index + 12;
      }

      const attrRegex =
        /\b(?:(in|out)\s+)?attribute\s+(?:item\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z0-9_:]+))?(?:\s*=\s*([^;]+))?/g;
      let am: RegExpExecArray | null;
      while ((am = attrRegex.exec(localBody)) !== null) {
        const isInput = am[1] === "in";
        const isOutput = am[1] === "out";
        const attrName = am[2]!;
        if (localNames.has(attrName)) continue;
        localNames.add(attrName);
        const fullName = prefix + attrName;

        let defaultVal = 0.0;
        const rawVal = am[4]?.trim();
        if (rawVal !== undefined) {
          const parsed = parseFloat(rawVal);
          if (!isNaN(parsed) && isFinite(parsed)) defaultVal = parsed;
        }
        if (overrides[attrName] !== undefined) {
          defaultVal = overrides[attrName]!;
        }

        const causality = isInput ? Causality.Input : isOutput ? Causality.Output : Causality.Local;
        const isState = derStateNames.has(attrName);
        const isParam = !isState && (isInput || rawVal !== undefined || overrides[attrName] !== undefined);
        const variability = isParam ? Variability.Parameter : Variability.Continuous;

        if (isParam) {
          this.parameters.push(fullName);
        } else {
          this.states.push(fullName);
        }

        const existingIdx = this.arena.lookupVariable(fullName);
        const varIdx =
          existingIdx !== -1
            ? existingIdx
            : this.arena.addVariable(fullName, VarType.Real, variability, causality, defaultVal);

        if (isState) {
          const startExpr = this.arena.addRealLiteral(defaultVal);
          this.arena.setVarAttrExpr(varIdx, VarAttrKind.Start, startExpr);
          const fixedExpr = this.arena.addBoolLiteral(true);
          this.arena.setVarAttrExpr(varIdx, VarAttrKind.Fixed, fixedExpr);
          this.arena.setVarFixed(varIdx, true);
          this.derivatives.push(`der(${fullName})`);
        }
      }
    }

    // 4. Process Subparts & Multiplicities
    const partUsages = findCstDescendants(compNode, "PartUsage");
    for (const pu of partUsages) {
      if (this.isDescendantOfPartUsage(pu, compNode)) continue;

      const nameNode = findFirstDescendant(pu, "Name") || findFirstDescendant(pu, "ID");
      const partName = nameNode?.text?.trim();
      if (!partName) continue;

      localNames.add(partName);

      const typeNode = findFirstDescendant(pu, "FeatureTyping");
      const subTypeName = typeNode?.text?.replace(/^[:\s]+/, "").trim() || "";

      // Extract multiplicity: e.g. [4], [1..4], [0..4]
      let multiplicity = 1;
      const multNode = findFirstDescendant(pu, "OwnedMultiplicity") || findFirstDescendant(pu, "MultiplicityRange");
      if (multNode) {
        const numMatch = multNode.text.match(/\[\s*(?:\d+\s*\.\.\s*)?(\d+)\s*\]/);
        if (numMatch) {
          multiplicity = parseInt(numMatch[1]!, 10);
        }
      }

      // Extract subpart overrides if any
      const subOverrides: Record<string, number> = {};
      const subCompDef = this.compDefs.get(subTypeName);

      if (subCompDef) {
        if (multiplicity > 1) {
          // Instantiate array elements: wheels[1], wheels[2], ..., wheels[N]
          for (let i = 1; i <= multiplicity; i++) {
            const subPrefix = `${prefix}${partName}[${i}].`;
            this.elaborateComponent(subCompDef, subPrefix, subOverrides, new Set<string>());
          }
        } else {
          const subPrefix = `${prefix}${partName}.`;
          this.elaborateComponent(subCompDef, subPrefix, subOverrides, new Set<string>());
        }
      }
    }

    // Fallback subpart scanning for flattened/recovered CST nodes
    if (partUsages.length === 0) {
      const subpartRegex =
        /\bpart\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)(?:\[\s*(?:\d+\s*\.\.\s*)?(\d+)\s*\])?(?:\s*\{([^}]*)\})?/g;
      let sm: RegExpExecArray | null;
      while ((sm = subpartRegex.exec(compText)) !== null) {
        const partName = sm[1]!;
        if (localNames.has(partName)) continue;
        localNames.add(partName);

        const subTypeName = sm[2]!;
        const multStr = sm[3];
        const multiplicity = multStr ? parseInt(multStr, 10) : 1;
        const inlineBody = sm[4] || "";

        const subOverrides: Record<string, number> = {};
        const overrideRegex = /\battribute\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([0-9.eE+-]+)/g;
        let om: RegExpExecArray | null;
        while ((om = overrideRegex.exec(inlineBody)) !== null) {
          subOverrides[om[1]!] = parseFloat(om[2]!);
        }

        const subCompDef = this.compDefs.get(subTypeName);
        if (subCompDef) {
          if (multiplicity > 1) {
            for (let i = 1; i <= multiplicity; i++) {
              const subPrefix = `${prefix}${partName}[${i}].`;
              this.elaborateComponent(subCompDef, subPrefix, subOverrides, new Set<string>());
            }
          } else {
            const subPrefix = `${prefix}${partName}.`;
            this.elaborateComponent(subCompDef, subPrefix, subOverrides, new Set<string>());
          }
        }
      }
    }

    // 5. Process Equations & Assert Constraints
    this.elaborateEquations(compNode, prefix, localNames);

    // 5b. Process When Clauses
    this.elaborateWhenClauses(compNode, prefix, localNames);

    // 6. Collect Connections
    this.elaborateConnections(compNode, prefix);
  }

  /**
   * Returns true if `node` is nested inside a child `PartUsage` of `currentComp`
   * (so it isn't double-processed during the parent's traversal).
   */
  private isDescendantOfPartUsage(node: SysmlCstNode, currentComp: SysmlCstNode): boolean {
    let p = node.parent;
    while (p && p !== currentComp) {
      if (p.type === "PartUsage") return true;
      p = p.parent;
    }
    return false;
  }

  private isDescendantOfActionOrCalc(node: SysmlCstNode, currentComp: SysmlCstNode): boolean {
    let p = node.parent;
    while (p && p !== currentComp) {
      if (
        p.type === "ActionDefinition" ||
        p.type === "ActionUsage" ||
        p.type === "CalculationDefinition" ||
        p.type === "CalculationUsage"
      ) {
        return true;
      }
      p = p.parent;
    }
    return false;
  }

  private isDescendantOf(node: SysmlCstNode, ancestor: SysmlCstNode): boolean {
    let p = node.parent;
    while (p) {
      if (p === ancestor) return true;
      p = p.parent;
    }
    return false;
  }

  /**
   * Lowers `AssertConstraintUsage`, `ConstraintUsage`, `ResultExpressionMember`, and bare equations
   * within `compNode` into simple equations (`lhs == rhs`) inside `this.arena`.
   */
  private elaborateEquations(compNode: SysmlCstNode, prefix: string, localNames: Set<string>): void {
    const initialEqCount = this.arena.eqCount;

    // 1. Process official SysML v2 AssertConstraintUsage and ConstraintUsage
    const assertUsages = [
      ...findCstDescendants(compNode, "AssertConstraintUsage"),
      ...findCstDescendants(compNode, "ConstraintUsage"),
    ];
    for (const au of assertUsages) {
      if (this.isDescendantOfPartUsage(au, compNode)) continue;
      if (this.isDescendantOfActionOrCalc(au, compNode)) continue;

      const eqNodes = findCstDescendants(au, "EqualityExpression");
      if (eqNodes.length > 0) {
        for (const eqNode of eqNodes) {
          if ((eqNode.childCount ?? 0) >= 3) {
            const lhsNode = eqNode.child ? eqNode.child(0) : eqNode.children?.[0];
            const rhsNode = eqNode.child ? eqNode.child(2) : eqNode.children?.[2];

            const lhsId = lowerCstExpression(lhsNode, this.arena, prefix, localNames);
            const rhsId = lowerCstExpression(rhsNode, this.arena, prefix, localNames);
            this.arena.addEquation(EqKind.Simple, lhsId, rhsId);
          }
        }
      } else {
        const resultExpr =
          findFirstDescendant(au, "ResultExpressionMember") || findFirstDescendant(au, "OwnedExpression");
        if (resultExpr) {
          const exprId = lowerCstExpression(resultExpr, this.arena, prefix, localNames);
          const trueId = this.arena.addBoolLiteral(true);
          this.arena.addEquation(EqKind.Simple, exprId, trueId);
        }
      }
    }

    // 2. Direct ResultExpressionMember in ConstraintDefinition
    const directResultExprs = findCstDescendants(compNode, "ResultExpressionMember");
    for (const re of directResultExprs) {
      if (this.isDescendantOfPartUsage(re, compNode)) continue;
      if (this.isDescendantOfActionOrCalc(re, compNode)) continue;
      if (assertUsages.some((au) => this.isDescendantOf(re, au) || (au.text && re.text && au.text.includes(re.text))))
        continue;

      const eqNode = findFirstDescendant(re, "EqualityExpression");
      if (eqNode && (eqNode.childCount ?? 0) >= 3) {
        const lhsNode = eqNode.child ? eqNode.child(0) : eqNode.children?.[0];
        const rhsNode = eqNode.child ? eqNode.child(2) : eqNode.children?.[2];

        const lhsId = lowerCstExpression(lhsNode, this.arena, prefix, localNames);
        const rhsId = lowerCstExpression(rhsNode, this.arena, prefix, localNames);
        this.arena.addEquation(EqKind.Simple, lhsId, rhsId);
      } else {
        const exprId = lowerCstExpression(re, this.arena, prefix, localNames);
        const trueId = this.arena.addBoolLiteral(true);
        this.arena.addEquation(EqKind.Simple, exprId, trueId);
      }
    }

    // 3. Fallback / Bare Equations (e.g. in Resistor or physical definitions without assert constraint wrapper)
    const emittedFromCst = this.arena.eqCount - initialEqCount;
    let scrubbedBody = this.getCompText(compNode);

    // Scrub nested subpart braces so child equations aren't duplicated at parent level
    const subpartRegex = /\bpart\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z_][A-Za-z0-9_]*/g;
    let spm: RegExpExecArray | null;
    while ((spm = subpartRegex.exec(scrubbedBody)) !== null) {
      let nextPos = spm.index + spm[0].length;
      while (nextPos < scrubbedBody.length && /\s/.test(scrubbedBody[nextPos]!)) nextPos++;
      if (nextPos < scrubbedBody.length && scrubbedBody[nextPos] === "{") {
        let depth = 1;
        let i = nextPos + 1;
        while (i < scrubbedBody.length && depth > 0) {
          if (scrubbedBody[i] === "{") depth++;
          else if (scrubbedBody[i] === "}") depth--;
          i++;
        }
        scrubbedBody = scrubbedBody.slice(0, spm.index) + "/* subpart */" + scrubbedBody.slice(i);
        subpartRegex.lastIndex = spm.index + 13;
      }
    }

    // Scrub when blocks
    const whenRegex = /\bwhen\b/g;
    let wm: RegExpExecArray | null;
    while ((wm = whenRegex.exec(scrubbedBody)) !== null) {
      const openBrace = scrubbedBody.indexOf("{", wm.index);
      if (openBrace !== -1) {
        let depth = 1;
        let i = openBrace + 1;
        while (i < scrubbedBody.length && depth > 0) {
          if (scrubbedBody[i] === "{") depth++;
          else if (scrubbedBody[i] === "}") depth--;
          i++;
        }
        scrubbedBody = scrubbedBody.slice(0, wm.index) + "/* when */" + scrubbedBody.slice(i);
        whenRegex.lastIndex = wm.index + 10;
      }
    }

    // Scrub nested action/calc blocks so imperative statements are not treated as continuous equations
    const actionBlockRegex = /\b(?:action|calc)\s+(?:def\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\{/g;
    let abm: RegExpExecArray | null;
    while ((abm = actionBlockRegex.exec(scrubbedBody)) !== null) {
      const openBrace = scrubbedBody.indexOf("{", abm.index);
      if (openBrace !== -1) {
        let depth = 1;
        let i = openBrace + 1;
        while (i < scrubbedBody.length && depth > 0) {
          if (scrubbedBody[i] === "{") depth++;
          else if (scrubbedBody[i] === "}") depth--;
          i++;
        }
        scrubbedBody = scrubbedBody.slice(0, abm.index) + "/* action */" + scrubbedBody.slice(i);
        actionBlockRegex.lastIndex = abm.index + 12;
      }
    }

    const statements = scrubbedBody
      .split(";")
      .map((s) => s.replace(/^[\s{}]+/, "").trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      if (
        /^\b(?:(?:in|out|inout|private|protected|public)\s+)?(?:attribute|item|part|port|action|calc|constraint|def|import|package|alias|metadata)\b/.test(
          stmt,
        )
      ) {
        continue;
      }
      if (/^(?:startTime|stopTime|interval|step|tolerance)\s*=/i.test(stmt)) {
        continue;
      }
      if (/^\bconnect\b/.test(stmt)) {
        continue;
      }

      let eqSplitIndex = -1;
      let eqOpLen = 0;

      const dblEqIdx = stmt.indexOf("==");
      if (dblEqIdx !== -1) {
        eqSplitIndex = dblEqIdx;
        eqOpLen = 2;
      } else {
        const singleEqMatch = /(?<![:<>!])=(?!=)/.exec(stmt);
        if (singleEqMatch && singleEqMatch.index !== undefined) {
          eqSplitIndex = singleEqMatch.index;
          eqOpLen = 1;
        }
      }

      if (eqSplitIndex !== -1) {
        let lhsText = stmt.slice(0, eqSplitIndex).trim();
        lhsText = lhsText.replace(/^(?:assert\s+constraint\s*\{?\s*|\{\s*)/, "").trim();
        const rhsText = stmt
          .slice(eqSplitIndex + eqOpLen)
          .trim()
          .replace(/\}$/, "")
          .trim();

        if (lhsText && rhsText) {
          if (emittedFromCst > 0 && assertUsages.length > 0) {
            continue;
          }
          if (emittedFromCst > 0 && directResultExprs.length > 0) {
            const reText = directResultExprs[0]!.text.replace(/;$/, "").trim();
            if (stmt === reText || `${lhsText} == ${rhsText}` === reText) {
              continue;
            }
          }

          const prefixedLhs = prefixSysmlExpression(lhsText, prefix, localNames);
          const prefixedRhs = prefixSysmlExpression(rhsText, prefix, localNames);
          const lhsExprId = lowerSysmlExpr(prefixedLhs, this.arena);
          const rhsExprId = lowerSysmlExpr(prefixedRhs, this.arena);
          this.arena.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
        }
      }
    }
  }

  /**
   * Lowers hybrid continuous-discrete `when` event blocks directly into `DAEBuilder` when equations.
   */
  private elaborateWhenClauses(compNode: SysmlCstNode, prefix: string, localNames: Set<string>): void {
    const compText = this.getCompText(compNode);
    let searchIdx = 0;
    while (searchIdx < compText.length) {
      const match = /\bwhen\b/.exec(compText.slice(searchIdx));
      if (!match) break;
      const whenStart = searchIdx + match.index;
      const openBrace = compText.indexOf("{", whenStart);
      if (openBrace === -1) break;
      const condStr = compText.slice(whenStart + 4, openBrace).trim();
      const rawCond = condStr.startsWith("(") && condStr.endsWith(")") ? condStr.slice(1, -1).trim() : condStr;
      let depth = 1;
      let i = openBrace + 1;
      while (i < compText.length && depth > 0) {
        if (compText[i] === "{") depth++;
        else if (compText[i] === "}") depth--;
        i++;
      }
      const whenBody = compText.slice(openBrace + 1, i - 1);
      searchIdx = i;

      const prefixedCond = prefixSysmlExpression(rawCond, prefix, localNames);
      const condExprId = lowerSysmlExpr(prefixedCond, this.arena);
      const whenIdx = this.arena.addWhenEquation(condExprId);

      const assignRegex = /(?:assign\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*(?::=|=)\s*([^;]+);/g;
      let asm: RegExpExecArray | null;
      while ((asm = assignRegex.exec(whenBody)) !== null) {
        const rawTarget = asm[1]!.trim();
        const rawExpr = asm[2]!.trim();
        const target = prefixSysmlExpression(rawTarget, prefix, localNames);
        const expr = prefixSysmlExpression(rawExpr, prefix, localNames);

        const targetNameId = this.arena.interner.intern(target);
        const targetExprId = this.arena.addName(targetNameId);
        const rhsExprId = lowerSysmlExpr(expr, this.arena);
        this.arena.addWhenBodyEquation(whenIdx, EqKind.Simple, targetExprId, rhsExprId);

        if (!this.states.includes(target) && !this.parameters.includes(target)) {
          this.states.push(target);
        }
      }
    }
  }

  /**
   * Extracts `ConnectionUsage` endpoint pairs (`connect p1 to p2;`) for global Kirchhoff synthesis.
   */
  private elaborateConnections(compNode: SysmlCstNode, prefix: string): void {
    const connUsages = findCstDescendants(compNode, "ConnectionUsage");
    for (const cu of connUsages) {
      if (this.isDescendantOfPartUsage(cu, compNode)) continue;

      // Form: connect p1 to p2; or connect a = b;
      let refNodes = findCstDescendants(cu, "ConnectorEnd");
      if (refNodes.length < 2) {
        refNodes = findCstDescendants(cu, "ConnectorEndMember");
      }
      if (refNodes.length < 2) {
        refNodes = findCstDescendants(cu, "FeatureReferenceExpression");
      }
      if (refNodes.length >= 2) {
        for (let i = 0; i < refNodes.length - 1; i++) {
          const p1Raw = refNodes[i]!.text.trim();
          const p2Raw = refNodes[i + 1]!.text.trim();

          const p1 = prefix + p1Raw;
          const p2 = prefix + p2Raw;

          this.connections.push({ p1, p2 });
        }
      }
    }

    // Also scan compNode text for bare connect statements if any were missed by CST due to parse errors
    const compText = this.getCompText(compNode);
    const connectRegex = /\bconnect\s+([A-Za-z0-9_.]+)\s+to\s+([A-Za-z0-9_.]+)\s*;/g;
    let cm: RegExpExecArray | null;
    while ((cm = connectRegex.exec(compText)) !== null) {
      const p1 = prefix + cm[1]!.trim();
      const p2 = prefix + cm[2]!.trim();
      if (!this.connections.some((c) => c.p1 === p1 && c.p2 === p2)) {
        this.connections.push({ p1, p2 });
      }
    }
  }

  /**
   * Post-processes all connections across the model using a Disjoint Set (Union-Find)
   * to strictly balance Kirchhoff potential equalities and multi-port sum-to-zero flow conservation.
   */
  private processGlobalConnections(): void {
    const unionMap = new Map<string, string>();
    const findRoot = (x: string): string => {
      let curr = x;
      while (unionMap.has(curr)) curr = unionMap.get(curr)!;
      return curr;
    };
    const union = (a: string, b: string) => {
      const ra = findRoot(a);
      const rb = findRoot(b);
      if (ra !== rb) unionMap.set(rb, ra);
    };

    for (const conn of this.connections) {
      const port1 = this.activePorts.get(conn.p1);
      const port2 = this.activePorts.get(conn.p2);

      if (port1 && port2) {
        // 1. Potential attributes equal: p1.v == p2.v
        for (const pot of port1.potentialAttrs) {
          if (port2.potentialAttrs.includes(pot)) {
            const v1Name = this.arena.interner.intern(`${conn.p1}.${pot}`);
            const v2Name = this.arena.interner.intern(`${conn.p2}.${pot}`);
            const v1Expr = this.arena.addName(v1Name);
            const v2Expr = this.arena.addName(v2Name);
            this.arena.addEquation(EqKind.Simple, v1Expr, v2Expr);
          }
        }

        // 2. Group flow terminals into the same junction equivalence class
        for (const fl of port1.flowAttrs) {
          if (port2.flowAttrs.includes(fl)) {
            union(`${conn.p1}.${fl}`, `${conn.p2}.${fl}`);
          }
        }
      } else {
        // Direct scalar variable connection
        const n1 = this.arena.interner.intern(conn.p1);
        const n2 = this.arena.interner.intern(conn.p2);
        const e1 = this.arena.addName(n1);
        const e2 = this.arena.addName(n2);
        this.arena.addEquation(EqKind.Simple, e1, e2);
      }
    }

    // Group flow pins by junction root
    const junctionGroups = new Map<string, string[]>();
    for (const port of this.activePorts.values()) {
      for (const fl of port.flowAttrs) {
        const pinName = `${port.fullName}.${fl}`;
        const root = findRoot(pinName);
        if (!junctionGroups.has(root)) junctionGroups.set(root, []);
        junctionGroups.get(root)!.push(pinName);
      }
    }

    // Emit single Kirchhoff flow sum-to-zero conservation equation per junction (with conjugation sign)
    for (const pins of junctionGroups.values()) {
      if (pins.length >= 2) {
        let sumExpr: number | null = null;
        for (const pinName of pins) {
          const dotIdx = pinName.lastIndexOf(".");
          const portFullName = dotIdx !== -1 ? pinName.slice(0, dotIdx) : pinName;
          const port = this.activePorts.get(portFullName);
          const nameId = this.arena.interner.intern(pinName);
          const exprId = this.arena.addName(nameId);
          const signedExpr = port?.isConjugated ? this.arena.addUnaryExpr(UnaryOp.Negate, exprId) : exprId;

          if (sumExpr === null) {
            sumExpr = signedExpr;
          } else {
            sumExpr = this.arena.addBinaryExpr(BinOp.Add, sumExpr, signedExpr);
          }
        }
        if (sumExpr !== null) {
          const zeroExpr = this.arena.addRealLiteral(0.0);
          this.arena.addEquation(EqKind.Simple, sumExpr, zeroExpr);
        }
      }
    }
  }
}
