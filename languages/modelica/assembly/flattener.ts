// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable */
// @ts-nocheck
import {
  DaeBuilder,
  VarType,
  Variability,
  Causality,
  EqKind,
  ExprKind,
  BinOp,
  UnaryOp,
  StmtKind,
  VarAttrKind,
  FLAG_VAR_FLOW,
  FLAG_VAR_STREAM,
  FLAG_EQ_STREAM_CONNECT,
  FLAG_EQ_INITIAL,
  EQ_STRIDE,
  EQ_KIND,
  EQ_LHS,
  EQ_RHS,
  EQ_AUX,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  EXPR_LEFT,
  EXPR_RIGHT,
  VAR_STRIDE,
  VAR_NAME,
  VAR_TYPE,
  VAR_FLAGS,
  VarAccessor,
  ExprAccessor,
  EqAccessor,
} from "./dae";
import {
  getNodeFirstChild,
  getNodeNextSibling,
  getNodeType,
  getNodePadding,
  getNodeByteLength,
  getInputBuffer,
  atomicChunkAlloc,
  ASTNode,
  inputEncoding,
} from "./arena";
import { CorrespondenceIndex } from "./correspondence";
import {
  ChunkedUint32Array,
  createChunkedUint32Array,
  ChunkedInt32Array,
  createChunkedInt32Array,
  ChunkedUint8Array,
  createChunkedUint8Array,
  SourceTextView,
} from "./array";
import { UnmanagedMap64, createMap64, UnmanagedSet64, createSet64, UnmanagedMap64To64, createMap64To64 } from "./hashmap";
import { ArenaStringPool } from "./string_pool";
import { SyntaxType, FieldId } from "./types";

export const FLAG_MOD_FINAL: u32 = 0x01;
export const FLAG_MOD_EACH: u32 = 0x02;
export const FLAG_MOD_REDECLARE: u32 = 0x04;
export const FLAG_MOD_REPLACEABLE: u32 = 0x08;
export const FLAG_VAR_REMOVED: i32 = 1 << 6;
export const FLAG_VAR_PROTECTED: i32 = 1 << 7;
export const FLAG_VAR_FINAL: i32 = 1 << 8;
export const FLAG_VAR_VIRTUAL: i32 = 1 << 9;

/**
 * Reasons the WASM flattening kernel bails out of a model. The numeric values are
 * stable identifiers that cross the WASM boundary (`flattener_getErrorCode`) and are
 * mirrored on the host side in `src/flattener/support/wasm-bail-reasons.ts` — keep
 * both lists in sync.
 */
const enum WasmBailReason {
  None = 0,
  WhenOrIfEquation = 3290,
  ForEquationNoIndex = 3291,
  ForEquationRange = 3292,
  ForEquationNoBody = 3293,
  SimpleEquationOperands = 3323,
  SimpleEquationExpr = 3330,
  ArrayEquationSize = 3348,
  ArrayEquationNonCtor = 3363,
  EquationLhsUnresolved = 3370,
  EquationRhsUnresolved = 3377,
  ConnectRefExpr = 3425,
  ClauseDimensions = 3570,
  DeclarationDimensions = 3609,
  BindingExpr = 3625,
  ArrayBindingShape = 3626,
  IntegerRealBinding = 3629,
  IntegerRealModifier = 3645,
  IfExprArraySize = 3760,
  IfExprArrayNesting = 3770,
  IfExprArrayScalarMix = 3775,
  AlgorithmStatementUnsupported = 3800,
  AlgorithmReinit = 3801,
  ForStatementImplicitRange = 3802,
  WhenInInitialEquation = 3810,
  ConnectInWhen = 3811,
  ConnectInDynamicIf = 3812,
  InvalidWhenLhs = 3813,
  WhenConditionNonDiscrete = 3814,
}


function parseIntBytes(src: usize, len: u32): i32 {
  if (len == 0 || src == 0) return 0;
  let text = SourceTextView.at(src, len);
  let charCount = text.charCount;
  let res: i32 = 0;
  let hasDigit = false;
  let i: u32 = 0;
  while (i < charCount && text.charAt(i) == 32) i++;
  let isNeg = false;
  if (i < charCount) {
    let c = text.charAt(i);
    if (c == 45) { isNeg = true; i++; }
    else if (c == 43) { i++; }
  }
  while (i < charCount) {
    let b = text.charAt(i);
    if (b >= 48 && b <= 57) {
      res = res * 10 + ((b - 48) as i32);
      hasDigit = true;
    } else if (b == 32) {
      while (i < charCount && text.charAt(i) == 32) i++;
      if (i < charCount) return 0;
      break;
    } else {
      return 0;
    }
    i++;
  }
  if (!hasDigit) return 0;
  return isNeg ? -res : res;
}

function parseRealBytes(src: usize, len: u32): f64 {
  if (len == 0 || src == 0) return 0.0;
  let text = SourceTextView.at(src, len);
  let charCount = text.charCount;
  let i: u32 = 0;
  let sign: f64 = 1.0;
  let firstChar = text.charAt(0);
  if (firstChar == 45) { // '-'
    sign = -1.0;
    i++;
  } else if (firstChar == 43) { // '+'
    i++;
  }
  let mantissa: u64 = 0;
  let sigDigits: u32 = 0;
  let expAdjust: i32 = 0;
  let intPart: f64 = 0.0;
  while (i < charCount) {
    let b = text.charAt(i);
    if (b >= 48 && b <= 57) {
      let d = b - 48;
      intPart = intPart * 10.0 + (d as f64);
      if (d != 0 || sigDigits > 0) {
        if (sigDigits < 15) {
          mantissa = mantissa * 10 + (d as u64);
          sigDigits++;
        } else {
          expAdjust++;
        }
      }
      i++;
    } else {
      break;
    }
  }
  let fracPart: f64 = 0.0;
  let fracDiv: f64 = 1.0;
  if (i < charCount) {
    let b = text.charAt(i);
    if (b == 46) { // '.'
      i++;
      while (i < charCount) {
        let fb = text.charAt(i);
        if (fb >= 48 && fb <= 57) {
          let d = fb - 48;
          fracPart = fracPart * 10.0 + (d as f64);
          fracDiv *= 10.0;
          if (sigDigits < 15) {
            if (d != 0 || sigDigits > 0) {
              mantissa = mantissa * 10 + (d as u64);
              sigDigits++;
            }
            expAdjust--;
          }
          i++;
        } else {
          break;
        }
      }
    }
  }
  let expSign: i32 = 1;
  let expVal: i32 = 0;
  if (i < charCount) {
    let b = text.charAt(i);
    if (b == 101 || b == 69) { // 'e' | 'E'
      i++;
      if (i < charCount) {
        let eb = text.charAt(i);
        if (eb == 45) {
          expSign = -1;
          i++;
        } else if (eb == 43) {
          i++;
        }
      }
      while (i < charCount) {
        let eb = text.charAt(i);
        if (eb >= 48 && eb <= 57) {
          expVal = expVal * 10 + ((eb - 48) as i32);
          i++;
        } else {
          break;
        }
      }
    }
  }
  if (mantissa == 0) return sign < 0.0 ? -0.0 : 0.0;
  let totalExp: i32 = expSign * expVal + expAdjust;
  if (sigDigits <= 15 && totalExp >= -22 && totalExp <= 22) {
    let m = (mantissa as f64) * sign;
    if (totalExp == 0) return m;
    if (totalExp > 0) return m * Math.pow(10.0, totalExp as f64);
    return m / Math.pow(10.0, (-totalExp) as f64);
  }
  if (sigDigits <= 15 && totalExp > 22 && totalExp <= 308) {
    let slop: i32 = 15 - (sigDigits as i32);
    if (totalExp - slop <= 22) {
      let shift = totalExp - 22;
      let m = (mantissa as f64) * Math.pow(10.0, shift as f64) * sign;
      return m * 1e22;
    }
  }
  let val = sign * (intPart + (fracDiv > 1.0 ? fracPart / fracDiv : 0.0));
  if (expVal != 0) {
    val *= Math.pow(10.0, (expSign * expVal) as f64);
  }
  return val;
}

function bytesHaveDotOrExp(src: usize, len: u32): boolean {
  if (len == 0 || src == 0) return false;
  let text = SourceTextView.at(src, len);
  let charCount = text.charCount;
  for (let i: u32 = 0; i < charCount; i++) {
    let b = text.charAt(i);
    if (b == 46 || b == 101 || b == 69) return true;
  }
  return false;
}

/**
 * 64-bit CST Locator primitives ((offset << 32) | ptr)
 * Packing (offset, ptr) into a single u64 primitive passes by value in registers
 * with zero GC/heap overhead and preserves absolute inputBuffer offsets across the CST.
 */
export type CstLoc = u64;

@inline
export function locMake(ptr: u32, offset: u32): u64 {
  return ((offset as u64) << 32) | (ptr as u64);
}

@inline
export function locPtr(loc: u64): u32 {
  return (loc & 0xffffffff) as u32;
}

@inline
export function locOffset(loc: u64): u32 {
  return (loc >> 32) as u32;
}

@inline
export function locIsNull(loc: u64): boolean {
  return (loc & 0xffffffff) == 0;
}

@inline
export function locPad(loc: u64): u32 {
  let p = locPtr(loc);
  if (p == 0) return 0;
  return getNodePadding(p);
}

@inline
export function locLen(loc: u64): u32 {
  let p = locPtr(loc);
  if (p == 0) return 0;
  return getNodeByteLength(p);
}

@inline
export function locType(loc: u64): u16 {
  let p = locPtr(loc);
  if (p == 0) return 0;
  return getNodeType(p);
}

@inline
export function locBytes(loc: u64): usize {
  let p = locPtr(loc);
  if (p == 0) return 0;
  return getInputBuffer() + (locOffset(loc) as usize);
}

@inline
export function locFirstChild(loc: u64): u64 {
  let p = locPtr(loc);
  if (p == 0) return 0;
  let ch = getNodeFirstChild(p);
  if (ch == 0) return 0;
  return locMake(ch, locOffset(loc));
}

@inline
export function locNextSibling(loc: u64): u64 {
  let p = locPtr(loc);
  if (p == 0) return 0;
  let next = getNodeNextSibling(p);
  if (next == 0) return 0;
  let nextPad = getNodePadding(next);
  let nextOffset = locOffset(loc) + locLen(loc) + nextPad;
  return locMake(next, nextOffset);
}

@inline
export function locMakeRoot(nodePtr: u32): u64 {
  if (nodePtr == 0) return 0;
  return locMake(nodePtr, getNodePadding(nodePtr));
}

@inline
export function locIntern(pool: ArenaStringPool, loc: u64): u32 {
  let p = locPtr(loc);
  if (p == 0) return 0;
  let len = locLen(loc);
  if (len == 0) return 0;
  let bytes = locBytes(loc);
  if (inputEncoding == 1 || inputEncoding == 2) {
    return pool.internUtf16(bytes, len);
  }
  return pool.intern(bytes, len);
}

@inline
export function locMatches(loc: u64, str: string): boolean {
  return bytesMatch(locBytes(loc), locLen(loc), str);
}

@inline
export function locStartsWith(loc: u64, str: string): boolean {
  return bytesStartsWith(locBytes(loc), locLen(loc), str);
}

@inline
export function locParseInt(loc: u64): i32 {
  return parseIntBytes(locBytes(loc), locLen(loc));
}

@inline
export function locParseReal(loc: u64): f64 {
  return parseRealBytes(locBytes(loc), locLen(loc));
}

@inline
export function locHasDotOrExp(loc: u64): boolean {
  return bytesHaveDotOrExp(locBytes(loc), locLen(loc));
}

function modHasEach(modLoc: u64): bool {
  if (locIsNull(modLoc)) return false;
  let ch = locFirstChild(modLoc);
  while (!locIsNull(ch)) {
    if (locMatches(ch, "each")) return true;
    ch = locNextSibling(ch);
  }
  return false;
}

export function locChild(loc: u64, index: u32): u64 {
  let ch = locFirstChild(loc);
  let i: u32 = 0;
  while (!locIsNull(ch)) {
    if (i == index) return ch;
    ch = locNextSibling(ch);
    i++;
  }
  return 0;
}

export function locChildCount(loc: u64): u32 {
  let count: u32 = 0;
  let ch = locFirstChild(loc);
  while (!locIsNull(ch)) {
    count++;
    ch = locNextSibling(ch);
  }
  return count;
}

export function locNonEmptyChildCount(loc: u64): u32 {
  let count: u32 = 0;
  let ch = locFirstChild(loc);
  while (!locIsNull(ch)) {
    if (locLen(ch) > 0) count++;
    ch = locNextSibling(ch);
  }
  return count;
}

export function locFirstNonEmptyChild(loc: u64): u64 {
  let ch = locFirstChild(loc);
  while (!locIsNull(ch)) {
    if (locLen(ch) > 0) return ch;
    ch = locNextSibling(ch);
  }
  return 0;
}

@inline
export function locLastNonEmptyChild(loc: u64): u64 {
  let ch = locFirstChild(loc);
  let last: u64 = 0;
  while (!locIsNull(ch)) {
    if (locLen(ch) > 0) last = ch;
    ch = locNextSibling(ch);
  }
  return last;
}

@inline
export function locNextNonEmptySibling(loc: u64): u64 {
  let next = locNextSibling(loc);
  while (!locIsNull(next)) {
    if (locLen(next) > 0) return next;
    next = locNextSibling(next);
  }
  return 0;
}

export function locFindChild(loc: u64, type: u32): u64 {
  let ch = locFirstChild(loc);
  while (!locIsNull(ch)) {
    if ((locType(ch) as u32) == type) return ch;
    ch = locNextSibling(ch);
  }
  return 0;
}

export function locFindDescendant(loc: u64, type: u32): u64 {
  let ch = locFirstChild(loc);
  while (!locIsNull(ch)) {
    if ((locType(ch) as u32) == type) return ch;
    let found = locFindDescendant(ch, type);
    if (!locIsNull(found)) return found;
    ch = locNextSibling(ch);
  }
  return 0;
}

export function locFindLastDescendant(loc: u64, type: u32): u64 {
  let ch = locFirstChild(loc);
  let last: u64 = 0;
  while (!locIsNull(ch)) {
    if ((locType(ch) as u32) == type) last = ch;
    let found = locFindLastDescendant(ch, type);
    if (!locIsNull(found)) last = found;
    ch = locNextSibling(ch);
  }
  return last;
}

export function locFindMatchingDescendant(loc: u64, str: string): u64 {
  let ch = locFirstChild(loc);
  while (!locIsNull(ch)) {
    if (locMatches(ch, str)) return ch;
    let found = locFindMatchingDescendant(ch, str);
    if (!locIsNull(found)) return found;
    ch = locNextSibling(ch);
  }
  return 0;
}

const CST_NODE_VIEW_SLOTS: u32 = 256;
const CST_NODE_VIEW_MASK: u32 = CST_NODE_VIEW_SLOTS - 1;
let g_cstNodeViewIdx: u32 = 0;
let g_cstNodeViewBuf: usize = 0;

/**
 * High-level zero-cost unmanaged view over a CST node in linear memory.
 * Wraps 64-bit packed loc (offset << 32 | ptr) with type-safe inline getters and navigators.
 */
@unmanaged
export class CstNodeView {
  loc: u64;

  @inline static at(loc: u64): CstNodeView {
    if (g_cstNodeViewBuf == 0) {
      g_cstNodeViewBuf = atomicChunkAlloc(CST_NODE_VIEW_SLOTS * offsetof<CstNodeView>());
    }
    let slot = (g_cstNodeViewIdx++) & CST_NODE_VIEW_MASK;
    let v = changetype<CstNodeView>(g_cstNodeViewBuf + slot * offsetof<CstNodeView>());
    v.loc = loc;
    return v;
  }

  @inline static from(ptr: u32, offset: u32 = 0): CstNodeView {
    return CstNodeView.at(locMake(ptr, offset));
  }

  @inline static fromRoot(nodePtr: u32): CstNodeView {
    return CstNodeView.at(locMakeRoot(nodePtr));
  }

  @inline get ptr(): u32 { return locPtr(this.loc); }
  @inline get offset(): u32 { return locOffset(this.loc); }
  @inline get isNull(): bool { return locIsNull(this.loc); }
  @inline get type(): u16 { return locType(this.loc); }
  @inline get byteLength(): u32 { return locLen(this.loc); }
  @inline get padding(): u32 { return locPad(this.loc); }
  @inline get bytes(): usize { return locBytes(this.loc); }
  @inline get text(): SourceTextView { return SourceTextView.at(this.bytes, this.byteLength); }

  @inline get firstChild(): CstNodeView { return CstNodeView.at(locFirstChild(this.loc)); }
  @inline get nextSibling(): CstNodeView { return CstNodeView.at(locNextSibling(this.loc)); }
  @inline get firstNonEmptyChild(): CstNodeView { return CstNodeView.at(locFirstNonEmptyChild(this.loc)); }
  @inline get lastNonEmptyChild(): CstNodeView { return CstNodeView.at(locLastNonEmptyChild(this.loc)); }
  @inline get nextNonEmptySibling(): CstNodeView { return CstNodeView.at(locNextNonEmptySibling(this.loc)); }

  @inline get firstChildLoc(): u64 { return locFirstChild(this.loc); }
  @inline get nextSiblingLoc(): u64 { return locNextSibling(this.loc); }
  @inline get firstNonEmptyChildLoc(): u64 { return locFirstNonEmptyChild(this.loc); }

  @inline child(index: u32): CstNodeView { return CstNodeView.at(locChild(this.loc, index)); }
  @inline childCount(): u32 { return locChildCount(this.loc); }
  @inline nonEmptyChildCount(): u32 { return locNonEmptyChildCount(this.loc); }

  @inline matches(str: string): bool { return locMatches(this.loc, str); }
  @inline parseInt(): i32 { return locParseInt(this.loc); }
  @inline parseReal(): f64 { return locParseReal(this.loc); }
  @inline hasDotOrExp(): bool { return locHasDotOrExp(this.loc); }

  @inline findChild(type: u32): CstNodeView { return CstNodeView.at(locFindChild(this.loc, type)); }
  @inline findDescendant(type: u32): CstNodeView { return CstNodeView.at(locFindDescendant(this.loc, type)); }
  @inline findChildLoc(type: u32): u64 { return locFindChild(this.loc, type); }
  @inline findDescendantLoc(type: u32): u64 { return locFindDescendant(this.loc, type); }
  @inline intern(pool: ArenaStringPool): u32 { return locIntern(pool, this.loc); }
}

/**
 * CST Node Traversal Cursor in Linear Memory (Compatibility Wrapper).
 */
@unmanaged
export class CstCursor {
  @inline static wrap(ptr: u32): CstCursor {
    return changetype<CstCursor>(ptr);
  }

  @inline get ptr(): u32 {
    return changetype<usize>(this) as u32;
  }

  @inline get isNull(): boolean {
    return changetype<usize>(this) == 0;
  }

  @inline get node(): ASTNode {
    return changetype<ASTNode>(changetype<usize>(this));
  }

  @inline get type(): u16 {
    return this.isNull ? 0 : this.node.type;
  }

  @inline get byteLength(): u32 {
    return this.isNull ? 0 : this.node.byteLength;
  }

  @inline get padding(): u32 {
    return this.isNull ? 0 : getNodePadding(this.ptr);
  }

  @inline get bytes(): usize {
    return this.isNull ? 0 : (getInputBuffer() + getNodePadding(this.ptr));
  }

  @inline toLoc(offset: u32 = 0): u64 {
    return locMake(this.ptr, offset);
  }

  @inline firstChild(): CstCursor {
    return this.isNull ? CstCursor.wrap(0) : CstCursor.wrap(this.node.firstChild);
  }

  @inline nextSibling(): CstCursor {
    return this.isNull ? CstCursor.wrap(0) : CstCursor.wrap(this.node.nextSibling);
  }

  child(index: u32): CstCursor {
    let ch = this.firstChild();
    let i: u32 = 0;
    while (!ch.isNull) {
      if (i == index) return ch;
      ch = ch.nextSibling();
      i++;
    }
    return CstCursor.wrap(0);
  }

  childCount(): u32 {
    let count: u32 = 0;
    let ch = this.firstChild();
    while (!ch.isNull) {
      count++;
      ch = ch.nextSibling();
    }
    return count;
  }

  findChild(type: u16): CstCursor {
    let ch = this.firstChild();
    while (!ch.isNull) {
      if (ch.type == type) return ch;
      ch = ch.nextSibling();
    }
    return CstCursor.wrap(0);
  }

  findDescendant(type: u16): CstCursor {
    let ch = this.firstChild();
    while (!ch.isNull) {
      if (ch.type == type) return ch;
      let found = ch.findDescendant(type);
      if (!found.isNull) return found;
      ch = ch.nextSibling();
    }
    return CstCursor.wrap(0);
  }
}


/**
 * Helper functions for StringPool chunk slicing and path decomposition.
 */
@inline
function hashBytes64Chunked(buf: ChunkedUint8Array, start: u32, len: u32): u64 {
  let h: u64 = 0xcbf29ce484222325;
  for (let i: u32 = 0; i < len; i++) {
    h ^= buf.get(start + i) as u64;
    h = h * 0x100000001b3;
  }
  return h == 0 ? 1 : h;
}

@inline
function chunkSliceEquals(pool: ArenaStringPool, id: u32, startB: u32, len: u32): boolean {
  if (id >= pool.stringCount) return false;
  if (pool.stringLengths.get(id) != len) return false;
  let startA = pool.stringOffsets.get(id);
  for (let i: u32 = 0; i < len; i++) {
    if (pool.charBuffer.get(startA + i) != pool.charBuffer.get(startB + i)) return false;
  }
  return true;
}

@inline
function internPoolSlice(pool: ArenaStringPool, start: u32, len: u32): u32 {
  if (len == 0) return 0;
  let h = hashBytes64Chunked(pool.charBuffer, start, len);
  let map = pool.getStringMap();
  let existingId = map.get(h);
  if (existingId != 0 && chunkSliceEquals(pool, existingId, start, len)) {
    return existingId;
  }
  let tempStart = pool.charOffset;
  for (let i: u32 = 0; i < len; i++) {
    pool.charBuffer.set(tempStart + i, pool.charBuffer.get(start + i));
  }
  pool.charOffset += len;
  let id = pool.stringCount++;
  pool.stringOffsets.set(id, tempStart);
  pool.stringLengths.set(id, len);
  map.set(h, id);
  return id;
}

@inline
function internStaticString(pool: ArenaStringPool, s: string): u32 {
  return pool.internUtf16(changetype<usize>(s), (s.length << 1) as u32);
}

@inline
function findDotInStringPool(pool: ArenaStringPool, strId: u32): i32 {
  if (strId >= pool.stringCount) return -1;
  let len = pool.stringLengths.get(strId);
  let off = pool.stringOffsets.get(strId);
  for (let i: u32 = 0; i < len; i++) {
    if (pool.charBuffer.get(off + i) == 46) { // '.' = ASCII 46
      return i as i32;
    }
  }
  return -1;
}

@inline
function findLastDotInStringPool(pool: ArenaStringPool, strId: u32): i32 {
  if (strId >= pool.stringCount) return -1;
  let len = pool.stringLengths.get(strId);
  let off = pool.stringOffsets.get(strId);
  if (len == 0) return -1;
  for (let i: i32 = (len as i32) - 1; i >= 0; i--) {
    if (pool.charBuffer.get(off + (i as u32)) == 46) {
      return i;
    }
  }
  return -1;
}

@inline
function bytesMatch(ptr: usize, len: u32, str: string): boolean {
  if (ptr == 0) return false;
  let strLen = str.length as u32;
  if (len == strLen * 2) {
    for (let i = 0; i < str.length; i++) {
      if (load<u16>(ptr + (i as usize) * 2) != str.charCodeAt(i)) return false;
    }
    return true;
  }
  if (len == strLen) {
    for (let i = 0; i < str.length; i++) {
      if (load<u8>(ptr + (i as usize)) != (str.charCodeAt(i) as u8)) return false;
    }
    return true;
  }
  return false;
}

@inline
function bytesStartsWith(ptr: usize, len: u32, str: string): boolean {
  if (ptr == 0) return false;
  let strLen = str.length as u32;
  let isUtf16 = (len >= 2 && load<u8>(ptr + 1) == 0);
  if (isUtf16) {
    let charCount = len >> 1;
    let i: u32 = 0;
    while (i < charCount) {
      let ch = load<u16>(ptr + (i as usize) * 2);
      if (ch != 32 && ch != 9 && ch != 10 && ch != 13) break;
      i++;
    }
    if (charCount - i < strLen) return false;
    for (let j = 0; j < str.length; j++) {
      if (load<u16>(ptr + ((i + (j as u32)) as usize) * 2) != str.charCodeAt(j)) return false;
    }
    return true;
  }
  let i: u32 = 0;
  while (i < len) {
    let ch = load<u8>(ptr + (i as usize));
    if (ch != 32 && ch != 9 && ch != 10 && ch != 13) break;
    i++;
  }
  if (len - i < strLen) return false;
  for (let j = 0; j < str.length; j++) {
    if (load<u8>(ptr + ((i + (j as u32)) as usize)) != (str.charCodeAt(j) as u8)) return false;
  }
  return true;
}

@inline
function formatUintDigits(buf: ChunkedUint8Array, offset: u32, val: u32): u32 {
  if (val == 0) {
    buf.set(offset, 48); // '0'
    return 1;
  }
  let temp: u32 = val;
  let len: u32 = 0;
  while (temp > 0) {
    len++;
    temp /= 10;
  }
  let pos = offset + len - 1;
  temp = val;
  while (temp > 0) {
    buf.set(pos, 48 + (temp % 10 as u8));
    temp /= 10;
    pos--;
  }
  return len;
}

function concatArrayIndex1D(pool: ArenaStringPool, baseNameId: u32, idx1: u32): u32 {
  let baseLen = baseNameId < pool.stringCount ? pool.stringLengths.get(baseNameId) : 0;
  let baseStart = baseNameId < pool.stringCount ? pool.stringOffsets.get(baseNameId) : 0;
  let hasTrailingBracket = baseLen > 1 && pool.charBuffer.get(baseStart + baseLen - 1) == 93;
  let copyLen = hasTrailingBracket ? baseLen - 1 : baseLen;
  let tempStart = pool.charOffset;
  for (let i: u32 = 0; i < copyLen; i++) {
    pool.charBuffer.set(tempStart + i, pool.charBuffer.get(baseStart + i));
  }
  let curr = tempStart + copyLen;
  if (hasTrailingBracket) {
    pool.charBuffer.set(curr++, 44); // ','
  } else {
    pool.charBuffer.set(curr++, 91); // '['
  }
  curr += formatUintDigits(pool.charBuffer, curr, idx1);
  pool.charBuffer.set(curr++, 93); // ']'
  let totalLen = curr - tempStart;

  let h = hashBytes64Chunked(pool.charBuffer, tempStart, totalLen);
  let existingId = pool.getStringMap().get(h);
  if (existingId != 0 && chunkSliceEquals(pool, existingId, tempStart, totalLen)) {
    return existingId;
  }
  let id = pool.stringCount++;
  pool.stringOffsets.set(id, tempStart);
  pool.stringLengths.set(id, totalLen);
  pool.charOffset += totalLen;
  pool.getStringMap().set(h, id);
  return id;
}

function concatArrayIndex2D(pool: ArenaStringPool, baseNameId: u32, idx1: u32, idx2: u32): u32 {
  let baseLen = baseNameId < pool.stringCount ? pool.stringLengths.get(baseNameId) : 0;
  let baseStart = baseNameId < pool.stringCount ? pool.stringOffsets.get(baseNameId) : 0;
  let hasTrailingBracket = baseLen > 1 && pool.charBuffer.get(baseStart + baseLen - 1) == 93;
  let copyLen = hasTrailingBracket ? baseLen - 1 : baseLen;
  let tempStart = pool.charOffset;
  for (let i: u32 = 0; i < copyLen; i++) {
    pool.charBuffer.set(tempStart + i, pool.charBuffer.get(baseStart + i));
  }
  let curr = tempStart + copyLen;
  if (hasTrailingBracket) {
    pool.charBuffer.set(curr++, 44); // ','
  } else {
    pool.charBuffer.set(curr++, 91); // '['
  }
  curr += formatUintDigits(pool.charBuffer, curr, idx1);
  pool.charBuffer.set(curr++, 44); // ','
  curr += formatUintDigits(pool.charBuffer, curr, idx2);
  pool.charBuffer.set(curr++, 93); // ']'
  let totalLen = curr - tempStart;

  let h = hashBytes64Chunked(pool.charBuffer, tempStart, totalLen);
  let existingId = pool.getStringMap().get(h);
  if (existingId != 0 && chunkSliceEquals(pool, existingId, tempStart, totalLen)) {
    return existingId;
  }
  let id = pool.stringCount++;
  pool.stringOffsets.set(id, tempStart);
  pool.stringLengths.set(id, totalLen);
  pool.charOffset += totalLen;
  pool.getStringMap().set(h, id);
  return id;
}

function concatArrayIndex3D(pool: ArenaStringPool, baseNameId: u32, idx1: u32, idx2: u32, idx3: u32): u32 {
  let baseLen = baseNameId < pool.stringCount ? pool.stringLengths.get(baseNameId) : 0;
  let baseStart = baseNameId < pool.stringCount ? pool.stringOffsets.get(baseNameId) : 0;
  let hasTrailingBracket = baseLen > 1 && pool.charBuffer.get(baseStart + baseLen - 1) == 93;
  let copyLen = hasTrailingBracket ? baseLen - 1 : baseLen;
  let tempStart = pool.charOffset;
  for (let i: u32 = 0; i < copyLen; i++) {
    pool.charBuffer.set(tempStart + i, pool.charBuffer.get(baseStart + i));
  }
  let curr = tempStart + copyLen;
  if (hasTrailingBracket) {
    pool.charBuffer.set(curr++, 44); // ','
  } else {
    pool.charBuffer.set(curr++, 91); // '['
  }
  curr += formatUintDigits(pool.charBuffer, curr, idx1);
  pool.charBuffer.set(curr++, 44); // ','
  curr += formatUintDigits(pool.charBuffer, curr, idx2);
  pool.charBuffer.set(curr++, 44); // ','
  curr += formatUintDigits(pool.charBuffer, curr, idx3);
  pool.charBuffer.set(curr++, 93); // ']'
  let totalLen = curr - tempStart;

  let h = hashBytes64Chunked(pool.charBuffer, tempStart, totalLen);
  let existingId = pool.getStringMap().get(h);
  if (existingId != 0 && chunkSliceEquals(pool, existingId, tempStart, totalLen)) {
    return existingId;
  }
  let id = pool.stringCount++;
  pool.stringOffsets.set(id, tempStart);
  pool.stringLengths.set(id, totalLen);
  pool.charOffset += totalLen;
  pool.getStringMap().set(h, id);
  return id;
}

@inline
export function getArrayCtorElement(dae: DaeBuilder, ctorId: u32, k: u32): u32 {
  return k == 0 ? dae.getExprLeft(ctorId) : dae.getExprLeft(ctorId + k);
}

@inline
export function getArrayCtorCount(dae: DaeBuilder, ctorId: u32): u32 {
  return dae.getExprData1(ctorId);
}

@inline
export function isRank2ArrayCtor(dae: DaeBuilder, id: u32): bool {
  if (id == 0xffffffff || id >= dae.exprCount) return false;
  if (dae.getExprKind(id) != ExprKind.ArrayCtor) return false;
  let count = dae.getExprData1(id);
  if (count == 0) return false;
  let first = getArrayCtorElement(dae, id, 0);
  return dae.getExprKind(first) == ExprKind.ArrayCtor;
}

@inline
export function isRank1ArrayCtor(dae: DaeBuilder, id: u32): bool {
  if (id == 0xffffffff || id >= dae.exprCount) return false;
  if (dae.getExprKind(id) != ExprKind.ArrayCtor) return false;
  let count = dae.getExprData1(id);
  if (count == 0) return true;
  let first = getArrayCtorElement(dae, id, 0);
  return dae.getExprKind(first) != ExprKind.ArrayCtor;
}

@inline
export function sliceAttrExpr1D(dae: DaeBuilder, attrExprId: u32, index: u32): u32 {
  if (attrExprId == 0xffffffff || attrExprId >= dae.exprCount) return 0xffffffff;
  if (dae.getExprKind(attrExprId) == ExprKind.ArrayCtor) {
    let count = getArrayCtorCount(dae, attrExprId);
    if (index < count) {
      return getArrayCtorElement(dae, attrExprId, index);
    }
  }
  return attrExprId;
}

@inline
export function sliceAttrExpr2D(dae: DaeBuilder, attrExprId: u32, rowIndex: u32, colIndex: u32): u32 {
  if (attrExprId == 0xffffffff || attrExprId >= dae.exprCount) return 0xffffffff;
  if (dae.getExprKind(attrExprId) == ExprKind.ArrayCtor) {
    let rowCount = getArrayCtorCount(dae, attrExprId);
    if (rowIndex < rowCount) {
      let rowExpr = getArrayCtorElement(dae, attrExprId, rowIndex);
      if (rowExpr != 0xffffffff && dae.getExprKind(rowExpr) == ExprKind.ArrayCtor) {
        let colCount = getArrayCtorCount(dae, rowExpr);
        if (colIndex < colCount) {
          return getArrayCtorElement(dae, rowExpr, colIndex);
        }
      }
    }
  }
  return attrExprId;
}

@inline
export function sliceAttrExpr3D(dae: DaeBuilder, attrExprId: u32, i: u32, j: u32, k: u32): u32 {
  if (attrExprId == 0xffffffff || attrExprId >= dae.exprCount) return 0xffffffff;
  if (dae.getExprKind(attrExprId) == ExprKind.ArrayCtor) {
    let d1Count = getArrayCtorCount(dae, attrExprId);
    if (i < d1Count) {
      let d2Expr = getArrayCtorElement(dae, attrExprId, i);
      if (d2Expr != 0xffffffff && dae.getExprKind(d2Expr) == ExprKind.ArrayCtor) {
        let d2Count = getArrayCtorCount(dae, d2Expr);
        if (j < d2Count) {
          let d3Expr = getArrayCtorElement(dae, d2Expr, j);
          if (d3Expr != 0xffffffff && dae.getExprKind(d3Expr) == ExprKind.ArrayCtor) {
            let d3Count = getArrayCtorCount(dae, d3Expr);
            if (k < d3Count) {
              return getArrayCtorElement(dae, d3Expr, k);
            }
          }
        }
      }
    }
  }
  return attrExprId;
}

export function collectAllArrayCtorLeaves(dae: DaeBuilder, ctorId: u32, out: ChunkedUint32Array): void {
  let count = dae.getExprData1(ctorId);
  for (let i: u32 = 0; i < count; i++) {
    let elem = getArrayCtorElement(dae, ctorId, i);
    if (dae.getExprKind(elem) == ExprKind.ArrayCtor) {
      collectAllArrayCtorLeaves(dae, elem, out);
    } else {
      out.push(elem);
    }
  }
}

export function addArrayCtorFromChunked(dae: DaeBuilder, elements: ChunkedUint32Array, startIdx: u32, count: u32): u32 {
  if (count == 0) return dae.addExpression(ExprKind.ArrayCtor, 0, 0xffffffff, 0xffffffff);
  let firstElem = elements.get(startIdx);
  let ctorId = dae.addExpression(ExprKind.ArrayCtor, count, firstElem, 0xffffffff);
  for (let i: u32 = 1; i < count; i++) {
    let elem = elements.get(startIdx + i);
    dae.addExpression(ExprKind.Tuple, 0, elem, 0);
  }
  return ctorId;
}

export function addArrayCtorFromStatic(dae: DaeBuilder, elements: StaticArray<u32>): u32 {
  let count = elements.length;
  if (count == 0) return dae.addExpression(ExprKind.ArrayCtor, 0, 0xffffffff, 0xffffffff);
  let firstElem = unchecked(elements[0]);
  let ctorId = dae.addExpression(ExprKind.ArrayCtor, count as u32, firstElem, 0xffffffff);
  for (let i: i32 = 1; i < count; i++) {
    let elem = unchecked(elements[i]);
    dae.addExpression(ExprKind.Tuple, 0, elem, 0);
  }
  return ctorId;
}

export function expandColonToArrayCtor(dae: DaeBuilder, exprId: u32, tempBuffer: ChunkedUint32Array): u32 {
  if (exprId >= dae.exprCount) return 0xffffffff;
  let kind = dae.getExprKind(exprId);
  if (kind != ExprKind.Range) return 0xffffffff;

  let startId = dae.getExprData1(exprId);
  let stepId = dae.getExprLeft(exprId);
  let stopId = dae.getExprRight(exprId);

  let startVal: f64 = 0.0;
  let kStart = dae.getExprKind(startId);
  if (kStart == ExprKind.IntLiteral) startVal = (dae.getExprData1(startId) as i32) as f64;
  else if (kStart == ExprKind.RealLiteral) startVal = dae.getExprRealValue(startId);
  else return 0xffffffff;

  let stepVal: f64 = 1.0;
  if (stepId != 0xffffffff) {
    let kStep = dae.getExprKind(stepId);
    if (kStep == ExprKind.IntLiteral) stepVal = (dae.getExprData1(stepId) as i32) as f64;
    else if (kStep == ExprKind.RealLiteral) stepVal = dae.getExprRealValue(stepId);
    else return 0xffffffff;
  }

  let stopVal: f64 = 0.0;
  let kStop = dae.getExprKind(stopId);
  if (kStop == ExprKind.IntLiteral) stopVal = (dae.getExprData1(stopId) as i32) as f64;
  else if (kStop == ExprKind.RealLiteral) stopVal = dae.getExprRealValue(stopId);
  else return 0xffffffff;

  if (stepVal == 0.0) return 0xffffffff;

  let isReal = (kStart == ExprKind.RealLiteral) || (kStop == ExprKind.RealLiteral) ||
               (stepId != 0xffffffff && dae.getExprKind(stepId) == ExprKind.RealLiteral) ||
               (Math.floor(startVal) != startVal) || (Math.floor(stepVal) != stepVal) || (Math.floor(stopVal) != stopVal);

  let elemStart = tempBuffer.length;
  if ((stepVal > 0.0 && startVal <= stopVal + 1e-9) || (stepVal < 0.0 && startVal >= stopVal - 1e-9)) {
    let nSteps = Math.floor((stopVal - startVal) / stepVal + 1e-9) as i32;
    if (nSteps >= 0) {
      if (nSteps > 10000) return 0xffffffff;
      for (let k: i32 = 0; k <= nSteps; k++) {
        let elemId: u32;
        if (isReal) {
          let v = startVal + (k as f64) * stepVal;
          elemId = dae.addRealLiteral(v);
        } else {
          let iVal = (startVal as i32) + k * (stepVal as i32);
          elemId = dae.addIntLiteral(iVal);
        }
        tempBuffer.push(elemId);
      }
    }
  }
  let elemCount = tempBuffer.length - elemStart;
  if (elemCount == 0) {
    tempBuffer.length = elemStart;
    return dae.addExpression(ExprKind.ArrayCtor, 0, 0xffffffff, 0xffffffff);
  }
  let ctorId = addArrayCtorFromChunked(dae, tempBuffer, elemStart, elemCount);
  tempBuffer.length = elemStart;
  return ctorId;
}

export function resolveVarToArrayCtor(dae: DaeBuilder, pool: ArenaStringPool, exprId: u32, tempBuffer: ChunkedUint32Array): u32 {
  if (exprId >= dae.exprCount) return exprId;
  let kind = dae.getExprKind(exprId);
  if (kind == ExprKind.Name) {
    let nameId = dae.getExprData1(exprId);
    if (dae.lookupVariableByName(nameId) == -1) {
      let test1 = concatArrayIndex1D(pool, nameId, 1);
      if (dae.lookupVariableByName(test1) >= 0) {
        let count: u32 = 1;
        while (dae.lookupVariableByName(concatArrayIndex1D(pool, nameId, count + 1)) >= 0) {
          count++;
        }
        let bStart = tempBuffer.length;
        for (let i: u32 = 1; i <= count; i++) {
          let elemNameId = concatArrayIndex1D(pool, nameId, i);
          let elemExpr = dae.addExpression(ExprKind.Name, elemNameId);
          tempBuffer.push(elemExpr);
        }
        let ctorId = addArrayCtorFromChunked(dae, tempBuffer, bStart, count);
        tempBuffer.length = bStart;
        return ctorId;
      }

      let test2 = concatArrayIndex2D(pool, nameId, 1, 1);
      if (dae.lookupVariableByName(test2) >= 0) {
        let dim1: u32 = 1;
        while (dae.lookupVariableByName(concatArrayIndex2D(pool, nameId, dim1 + 1, 1)) >= 0) {
          dim1++;
        }
        let dim2: u32 = 1;
        while (dae.lookupVariableByName(concatArrayIndex2D(pool, nameId, 1, dim2 + 1)) >= 0) {
          dim2++;
        }
        let matStart = tempBuffer.length;
        for (let i: u32 = 1; i <= dim1; i++) {
          let rowStart = tempBuffer.length;
          for (let j: u32 = 1; j <= dim2; j++) {
            let elemNameId = concatArrayIndex2D(pool, nameId, i, j);
            let elemExpr = dae.addExpression(ExprKind.Name, elemNameId);
            tempBuffer.push(elemExpr);
          }
          let rowCtorId = addArrayCtorFromChunked(dae, tempBuffer, rowStart, dim2);
          tempBuffer.length = rowStart;
          tempBuffer.push(rowCtorId);
        }
        let ctorId = addArrayCtorFromChunked(dae, tempBuffer, matStart, dim1);
        tempBuffer.length = matStart;
        return ctorId;
      }

      let test3 = concatArrayIndex3D(pool, nameId, 1, 1, 1);
      if (dae.lookupVariableByName(test3) >= 0) {
        let dim1: u32 = 1;
        while (dae.lookupVariableByName(concatArrayIndex3D(pool, nameId, dim1 + 1, 1, 1)) >= 0) {
          dim1++;
        }
        let dim2: u32 = 1;
        while (dae.lookupVariableByName(concatArrayIndex3D(pool, nameId, 1, dim2 + 1, 1)) >= 0) {
          dim2++;
        }
        let dim3: u32 = 1;
        while (dae.lookupVariableByName(concatArrayIndex3D(pool, nameId, 1, 1, dim3 + 1)) >= 0) {
          dim3++;
        }
        let tStart = tempBuffer.length;
        for (let i: u32 = 1; i <= dim1; i++) {
          let mStart = tempBuffer.length;
          for (let j: u32 = 1; j <= dim2; j++) {
            let rStart = tempBuffer.length;
            for (let k: u32 = 1; k <= dim3; k++) {
              let elemNameId = concatArrayIndex3D(pool, nameId, i, j, k);
              let elemExpr = dae.addExpression(ExprKind.Name, elemNameId);
              tempBuffer.push(elemExpr);
            }
            let rCtorId = addArrayCtorFromChunked(dae, tempBuffer, rStart, dim3);
            tempBuffer.length = rStart;
            tempBuffer.push(rCtorId);
          }
          let mCtorId = addArrayCtorFromChunked(dae, tempBuffer, mStart, dim2);
          tempBuffer.length = mStart;
          tempBuffer.push(mCtorId);
        }
        let ctorId = addArrayCtorFromChunked(dae, tempBuffer, tStart, dim1);
        tempBuffer.length = tStart;
        return ctorId;
      }
    }
  } else if (kind == ExprKind.Range) {
    let expId = expandColonToArrayCtor(dae, exprId, tempBuffer);
    if (expId != 0xffffffff) return expId;
  }
  return exprId;
}

export function poolMatchesSimple(pool: ArenaStringPool, id: u32, str: string): boolean {
  if (id >= pool.stringCount) return false;
  let len: u32 = str.length;
  let storedLen = pool.getLength(id);
  let off = pool.getOffset(id);
  let dotIdx = findLastDotInStringPool(pool, id);
  let checkStart = off;
  let checkLen = storedLen;
  if (dotIdx >= 0) {
    checkStart = off + (dotIdx as u32) + 1;
    checkLen = storedLen - (dotIdx as u32) - 1;
  }
  if (checkLen != len) return false;
  for (let i: u32 = 0; i < len; i++) {
    if (pool.charBuffer.get(checkStart + i) != (str.charCodeAt(i) as u8)) return false;
  }
  return true;
}

function findCompositionLoc(loc: u64, maxDepth: i32 = 120): u64 {
  if (locIsNull(loc) || maxDepth <= 0) return 0;
  if (locType(loc) == SyntaxType.COMPOSITION) return loc;

  let ch = locFirstChild(loc);
  while (!locIsNull(ch)) {
    if (locType(ch) == SyntaxType.COMPOSITION) return ch;
    let comp = findCompositionLoc(ch, maxDepth - 1);
    if (!locIsNull(comp)) return comp;
    ch = locNextSibling(ch);
  }
  return 0;
}

function getClassNameIdLoc(pool: ArenaStringPool, classLoc: u64): u32 {
  if (locIsNull(classLoc)) return 0;
  let idLoc = locFindDescendant(classLoc, SyntaxType.IDENTIFIER);
  if (locIsNull(idLoc)) idLoc = locFindDescendant(classLoc, SyntaxType.TOKEN_IDENTIFIER_ALT);
  if (locIsNull(idLoc)) idLoc = locFindDescendant(classLoc, SyntaxType.NAME);
  if (!locIsNull(idLoc)) {
    return locIntern(pool, idLoc);
  }
  return 0;
}

function findClassDefinitionLoc(rootLoc: u64, targetNameId: u32, pool: ArenaStringPool, maxDepth: i32 = 120): u64 {
  if (locIsNull(rootLoc) || targetNameId == 0 || maxDepth <= 0) return 0;
  let ch = locFirstChild(rootLoc);
  while (!locIsNull(ch)) {
    let t = locType(ch);
    if (t == SyntaxType.CLASS_DEFINITION) {
      let nameId = getClassNameIdLoc(pool, ch);
      if (nameId == targetNameId) return ch;
    }
    let found = findClassDefinitionLoc(ch, targetNameId, pool, maxDepth - 1);
    if (!locIsNull(found)) return found;
    ch = locNextSibling(ch);
  }
  return 0;
}

function findComponentDeclInClass(classLoc: u64, compNameId: u32, pool: ArenaStringPool, maxDepth: i32 = 120): u64 {
  if (locIsNull(classLoc) || compNameId == 0 || maxDepth <= 0) return 0;
  let ch = locFirstChild(classLoc);
  while (!locIsNull(ch)) {
    let t = locType(ch);
    if (t == SyntaxType.COMPONENT_CLAUSE || t == SyntaxType.COMPONENT_CLAUSE1) {
      let decl = locFindDescendant(ch, SyntaxType.COMPONENT_DECLARATION);
      while (!locIsNull(decl)) {
        let idLoc = locFindDescendant(decl, SyntaxType.IDENTIFIER);
        if (locIsNull(idLoc)) idLoc = locFindDescendant(decl, SyntaxType.TOKEN_IDENTIFIER_ALT);
        if (!locIsNull(idLoc) && locIntern(pool, idLoc) == compNameId) {
          return decl;
        }
        decl = locNextSibling(decl);
      }
    } else if (t != SyntaxType.CLASS_DEFINITION) {
      let found = findComponentDeclInClass(ch, compNameId, pool, maxDepth - 1);
      if (!locIsNull(found)) return found;
    }
    ch = locNextSibling(ch);
  }
  return 0;
}

function getPathLastPart(pool: ArenaStringPool, id: u32): u32 {
  if (id == 0 || id >= pool.stringCount) return 0;
  let len = pool.stringLengths.get(id);
  let off = pool.stringOffsets.get(id);
  let lastDot: i32 = -1;
  for (let i: i32 = (len as i32) - 1; i >= 0; i--) {
    if (pool.charBuffer.get(off + i) == 46) {
      lastDot = i;
      break;
    }
  }
  if (lastDot < 0) return id;
  return pool.internChunk(off + lastDot + 1, (len as i32) - lastDot - 1);
}

function findClassByPtr(rootLoc: u64, targetPtr: u32, maxDepth: i32 = 120): u64 {
  if (locPtr(rootLoc) == targetPtr) return rootLoc;
  if (maxDepth <= 0) return 0;
  let ch = locFirstChild(rootLoc);
  while (!locIsNull(ch)) {
    if (locPtr(ch) == targetPtr) return ch;
    let found = findClassByPtr(ch, targetPtr, maxDepth - 1);
    if (!locIsNull(found)) return found;
    ch = locNextSibling(ch);
  }
  return 0;
}

function isConnectorClassLoc(classLoc: u64): boolean {
  if (locIsNull(classLoc)) return false;
  let prefixes = locFindChild(classLoc, SyntaxType.CLASS_PREFIXES);
  if (locIsNull(prefixes)) prefixes = locFindDescendant(classLoc, SyntaxType.CLASS_PREFIXES);
  if (!locIsNull(prefixes)) {
    return !locIsNull(locFindDescendant(prefixes, SyntaxType.TOKEN_CONNECTOR));
  }
  return !locIsNull(locFindDescendant(classLoc, SyntaxType.TOKEN_CONNECTOR));
}

function isRecordClassLoc(classLoc: u64): boolean {
  if (locIsNull(classLoc)) return false;
  let prefixes = locFindChild(classLoc, SyntaxType.CLASS_PREFIXES);
  if (locIsNull(prefixes)) prefixes = locFindDescendant(classLoc, SyntaxType.CLASS_PREFIXES);
  if (!locIsNull(prefixes)) {
    return !locIsNull(locFindDescendant(prefixes, SyntaxType.TOKEN_RECORD));
  }
  return !locIsNull(locFindDescendant(classLoc, SyntaxType.TOKEN_RECORD));
}

function isTypeClassLoc(classLoc: u64): boolean {
  if (locIsNull(classLoc)) return false;
  let prefixes = locFindChild(classLoc, SyntaxType.CLASS_PREFIXES);
  if (locIsNull(prefixes)) prefixes = locFindDescendant(classLoc, SyntaxType.CLASS_PREFIXES);
  if (!locIsNull(prefixes)) {
    return !locIsNull(locFindDescendant(prefixes, SyntaxType.TOKEN_TYPE)) || locMatches(prefixes, "type");
  }
  return !locIsNull(locFindDescendant(classLoc, SyntaxType.TOKEN_TYPE)) || locMatches(classLoc, "type");
}

function isExpandableConnectorClassLoc(classLoc: u64, rootLoc: u64 = 0, pool: ArenaStringPool | null = null): boolean {
  if (locIsNull(classLoc)) return false;
  let prefixes = locFindChild(classLoc, SyntaxType.CLASS_PREFIXES);
  if (locIsNull(prefixes)) prefixes = locFindDescendant(classLoc, SyntaxType.CLASS_PREFIXES);
  if (!locIsNull(prefixes)) {
    let exp = locFindDescendant(prefixes, SyntaxType.TOKEN_EXPANDABLE);
    let conn = locFindDescendant(prefixes, SyntaxType.TOKEN_CONNECTOR);
    if (!locIsNull(exp) && locLen(exp) > 0 && !locIsNull(conn) && locLen(conn) > 0) return true;
    if (locMatches(prefixes, "expandable") && (locMatches(prefixes, "connector") || (!locIsNull(conn) && locLen(conn) > 0))) return true;
  }
  let exp = locFindDescendant(classLoc, SyntaxType.TOKEN_EXPANDABLE);
  let conn = locFindDescendant(classLoc, SyntaxType.TOKEN_CONNECTOR);
  if (!locIsNull(exp) && locLen(exp) > 0 && !locIsNull(conn) && locLen(conn) > 0) return true;
  if (locMatches(classLoc, "expandable") && locMatches(classLoc, "connector")) return true;

  if (rootLoc != 0 && pool != null) {
    let compLoc = findCompositionLoc(classLoc);
    if (!locIsNull(compLoc)) {
      let ch = locFirstChild(compLoc);
      while (!locIsNull(ch)) {
        if (locType(ch) == SyntaxType.EXTENDS_CLAUSE) {
          let nameLoc = locFindDescendant(ch, SyntaxType.NAME);
          if (locIsNull(nameLoc)) nameLoc = locFindDescendant(ch, SyntaxType.IDENTIFIER);
          if (!locIsNull(nameLoc)) {
            let baseId = locIntern(pool, nameLoc);
            let baseLoc = findClassDefinitionLoc(rootLoc, baseId, pool);
            if (!locIsNull(baseLoc) && baseLoc != classLoc && isExpandableConnectorClassLoc(baseLoc, rootLoc, pool)) {
              return true;
            }
          }
        }
        ch = locNextSibling(ch);
      }
    }
  }

  return false;
}

function getExprDimensions(dae: DaeBuilder, exprId: u32, pool: ArenaStringPool | null = null): u64 {
  if (exprId >= dae.exprCount) return 0;
  let kind = dae.getExprKind(exprId);
  if (kind == ExprKind.ArrayCtor) {
    let d1 = dae.getExprData1(exprId);
    let d2: u32 = 0;
    let firstElem = d1 > 0 ? getArrayCtorElement(dae, exprId, 0) : dae.getExprLeft(exprId);
    if (firstElem != 0xffffffff && dae.getExprKind(firstElem) == ExprKind.ArrayCtor) {
      d2 = dae.getExprData1(firstElem);
    }
    return ((d1 as u64) << 32) | (d2 as u64);
  }
  if (kind == ExprKind.Unary) {
    return getExprDimensions(dae, dae.getExprLeft(exprId), pool);
  }
  if (kind == ExprKind.Binary) {
    let d = getExprDimensions(dae, dae.getExprLeft(exprId), pool);
    if (d != 0) return d;
    return getExprDimensions(dae, dae.getExprRight(exprId), pool);
  }
  if (kind == ExprKind.Name && pool != null) {
    let nameId = dae.getExprData1(exprId);
    let test2 = concatArrayIndex2D(pool, nameId, 1, 1);
    if (dae.lookupVariableByName(test2) >= 0) {
      let d1: u32 = 1;
      while (dae.lookupVariableByName(concatArrayIndex2D(pool, nameId, d1 + 1, 1)) >= 0) d1++;
      let d2: u32 = 1;
      while (dae.lookupVariableByName(concatArrayIndex2D(pool, nameId, 1, d2 + 1)) >= 0) d2++;
      return ((d1 as u64) << 32) | (d2 as u64);
    }
    let test1 = concatArrayIndex1D(pool, nameId, 1);
    if (dae.lookupVariableByName(test1) >= 0) {
      let d1: u32 = 1;
      while (dae.lookupVariableByName(concatArrayIndex1D(pool, nameId, d1 + 1)) >= 0) d1++;
      return (d1 as u64) << 32;
    }
  }
  return 0;
}

export var g_lastParsedDim3: u32 = 0;
export var g_lastParsedDim4: u32 = 0;
export var g_lastParsedNDims: u32 = 0;
export var g_hasExplicitZeroDim: boolean = false;
export var g_isOmcNewInst: boolean = false;

function parseIntSlice(text: SourceTextView, startChar: u32, endChar: u32): i32 {
  while (startChar < endChar) {
    let b = text.charAt(startChar);
    if (b != 32 && b != 9 && b != 10 && b != 13) break;
    startChar++;
  }
  while (endChar > startChar) {
    let b = text.charAt(endChar - 1);
    if (b != 32 && b != 9 && b != 10 && b != 13) break;
    endChar--;
  }
  if (startChar >= endChar) return -1;
  let val: i32 = 0;
  let hasDigits = false;
  for (let i = startChar; i < endChar; i++) {
    let b = text.charAt(i);
    if (b >= 48 && b <= 57) {
      val = val * 10 + ((b - 48) as i32);
      hasDigits = true;
    } else {
      return -1;
    }
  }
  return hasDigits ? val : -1;
}

function evalDimExpr(dae: DaeBuilder, pool: ArenaStringPool, text: SourceTextView, startChar: u32, endChar: u32, prefixPathId: u32 = 0, scopeStackPtr: usize = 0): i32 {
  while (startChar < endChar) {
    let b = text.charAt(startChar);
    if (b != 32 && b != 9 && b != 10 && b != 13) break;
    startChar++;
  }
  while (endChar > startChar) {
    let b = text.charAt(endChar - 1);
    if (b != 32 && b != 9 && b != 10 && b != 13) break;
    endChar--;
  }
  if (startChar >= endChar) return -1;

  // Strip fully enclosing parentheses: (expr)
  if (text.charAt(startChar) == 40 && text.charAt(endChar - 1) == 41) { // '(' and ')'
    let depth = 0;
    let fullyWrapped = true;
    for (let i = startChar; i < endChar - 1; i++) {
      let b = text.charAt(i);
      if (b == 40) depth++;
      else if (b == 41) {
        depth--;
        if (depth == 0) { fullyWrapped = false; break; }
      }
    }
    if (fullyWrapped) {
      return evalDimExpr(dae, pool, text, startChar + 1, endChar - 1, prefixPathId, scopeStackPtr);
    }
  }

  // Scan for + and - at paren/bracket depth 0 (right-to-left)
  let parenDepth = 0;
  for (let i: i32 = (endChar - 1) as i32; i > (startChar as i32); i--) {
    let b = text.charAt(i as u32);
    if (b == 41 || b == 93) parenDepth++;
    else if (b == 40 || b == 91) { if (parenDepth > 0) parenDepth--; }
    else if (parenDepth == 0) {
      if (b == 43 || b == 45) { // '+' or '-'
        let prevChar = text.charAt((i - 1) as u32);
        if (prevChar != 43 && prevChar != 45 && prevChar != 42 && prevChar != 47 && prevChar != 40 && prevChar != 91) {
          let leftVal = evalDimExpr(dae, pool, text, startChar, i as u32, prefixPathId, scopeStackPtr);
          let rightVal = evalDimExpr(dae, pool, text, (i + 1) as u32, endChar, prefixPathId, scopeStackPtr);
          if (leftVal < 0 || rightVal < 0) return -1;
          return b == 43 ? leftVal + rightVal : leftVal - rightVal;
        }
      }
    }
  }

  // Scan for * and / at paren/bracket depth 0 (right-to-left)
  parenDepth = 0;
  for (let i: i32 = (endChar - 1) as i32; i > (startChar as i32); i--) {
    let b = text.charAt(i as u32);
    if (b == 41 || b == 93) parenDepth++;
    else if (b == 40 || b == 91) { if (parenDepth > 0) parenDepth--; }
    else if (parenDepth == 0) {
      if (b == 42 || b == 47) { // '*' or '/'
        let leftVal = evalDimExpr(dae, pool, text, startChar, i as u32, prefixPathId, scopeStackPtr);
        let rightVal = evalDimExpr(dae, pool, text, (i + 1) as u32, endChar, prefixPathId, scopeStackPtr);
        if (leftVal < 0 || rightVal < 0) return -1;
        return b == 42 ? leftVal * rightVal : (rightVal != 0 ? leftVal / rightVal : -1);
      }
    }
  }

  // Check if pure integer literal (with optional sign)
  let isDigits = true;
  let s = startChar;
  let first = text.charAt(s);
  let isNeg = false;
  if (first == 43) { s++; }
  else if (first == 45) { isNeg = true; s++; }
  for (let i = s; i < endChar; i++) {
    let b = text.charAt(i);
    if (b < 48 || b > 57) { isDigits = false; break; }
  }
  if (isDigits && s < endChar) {
    let partBytes = text.byteOffset(s);
    let partLen = text.byteLength(endChar - s);
    let val = parseIntBytes(partBytes, partLen);
    return isNeg ? -val : val;
  }

  // Look up variable or identifier
  let partBytes = text.byteOffset(startChar);
  let partLen = text.byteLength(endChar - startChar);
  let nameId = text.isUtf16 ? pool.internUtf16(partBytes, partLen) : pool.intern(partBytes, partLen);

  if (scopeStackPtr != 0) {
    let modVal = changetype<ScopeStack>(scopeStackPtr).lookup(nameId);
    if (modVal != 0xffffffff) {
      if (prefixPathId != 0) {
        let pNameId = pool.concatIds(prefixPathId, nameId);
        let pvi = dae.lookupVariableByName(pNameId);
        if (pvi >= 0) {
          let varAcc = VarAccessor.at(dae.getVarData(), pvi as u32);
          if (g_isOmcNewInst && varAcc.variability == Variability.Parameter) varAcc.setFlag(FLAG_VAR_FINAL);
        }
      }
      let vi = dae.lookupVariableByName(nameId);
      if (vi >= 0) {
        let varAcc = VarAccessor.at(dae.getVarData(), vi as u32);
        if (g_isOmcNewInst && varAcc.variability == Variability.Parameter) varAcc.setFlag(FLAG_VAR_FINAL);
      }
      let ek = dae.getExprKind(modVal);
      if (ek == ExprKind.IntLiteral) return dae.getExprData1(modVal) as i32;
      if (ek == ExprKind.RealLiteral) return dae.getExprRealValue(modVal) as i32;
    }
  }

  if (prefixPathId != 0) {
    let prefixedNameId = pool.concatIds(prefixPathId, nameId);
    let pvIdx = dae.lookupVariableByName(prefixedNameId);
    if (pvIdx >= 0) {
      let varAcc = VarAccessor.at(dae.getVarData(), pvIdx as u32);
      if (g_isOmcNewInst && varAcc.variability == Variability.Parameter) varAcc.setFlag(FLAG_VAR_FINAL);
      let val = dae.getVarStartValue(pvIdx as u32);
      return val as i32;
    }
  }

  let vIdx = dae.lookupVariableByName(nameId);
  if (vIdx >= 0) {
    let varAcc = VarAccessor.at(dae.getVarData(), vIdx as u32);
    if (g_isOmcNewInst && varAcc.variability == Variability.Parameter) varAcc.setFlag(FLAG_VAR_FINAL);
    let val = dae.getVarStartValue(vIdx as u32);
    return val as i32;
  }

  return -1;
}

function parseRangePart(dae: DaeBuilder, pool: ArenaStringPool, text: SourceTextView, startChar: u32, endChar: u32, prefixPathId: u32 = 0, scopeStackPtr: usize = 0): i32 {
  return evalDimExpr(dae, pool, text, startChar, endChar, prefixPathId, scopeStackPtr);
}

function isColonSubscript(text: SourceTextView, startChar: u32, endChar: u32): boolean {
  while (startChar < endChar) {
    let b = text.charAt(startChar);
    if (b != 32 && b != 9 && b != 10 && b != 13) break;
    startChar++;
  }
  while (endChar > startChar) {
    let b = text.charAt(endChar - 1);
    if (b != 32 && b != 9 && b != 10 && b != 13) break;
    endChar--;
  }
  return startChar < endChar && startChar + 1 == endChar && text.charAt(startChar) == 58;
}

function parseArrayDimensionsLoc(subscriptsLoc: u64, dae: DaeBuilder | null = null, pool: ArenaStringPool | null = null, prefixPathId: u32 = 0, scopeStackPtr: usize = 0): u64 {
  g_lastParsedDim3 = 0;
  g_lastParsedDim4 = 0;
  g_lastParsedNDims = 0;
  g_hasExplicitZeroDim = false;
  if (locIsNull(subscriptsLoc)) return 0;
  let src = locBytes(subscriptsLoc);
  let len = locLen(subscriptsLoc);
  if (len < 2 || src == 0) return 0;

  let text = SourceTextView.at(src, len);
  let charCount = text.charCount;

  let d1: u32 = 0;
  let d2: u32 = 0;
  let d3: u32 = 0;
  let d4: u32 = 0;
  let commaCount: u32 = 0;
  let parenDepth: i32 = 0;

  let startIdx: u32 = 0;
  let endIdx: u32 = charCount;
  while (startIdx < endIdx && text.charAt(startIdx) != 91) startIdx++; // '['
  if (startIdx < endIdx && text.charAt(startIdx) == 91) startIdx++;
  while (endIdx > startIdx && text.charAt(endIdx - 1) != 93) endIdx--; // ']'
  if (endIdx > startIdx && text.charAt(endIdx - 1) == 93) endIdx--;

  let sliceStart = startIdx;
  for (let i = startIdx; i < endIdx; i++) {
    let b = text.charAt(i);
    if (b == 40 || b == 91) parenDepth++;
    else if (b == 41 || b == 93) { if (parenDepth > 0) parenDepth--; }
    else if (parenDepth == 0 && b == 44) { // ','
      let isColon = isColonSubscript(text, sliceStart, i);
      let val: i32 = 0;
      if (!isColon) {
        if (dae != null && pool != null) {
          val = evalDimExpr(dae, pool, text, sliceStart, i, prefixPathId, scopeStackPtr);
        } else {
          val = parseIntSlice(text, sliceStart, i);
        }
        if (val < 0) return 0xffffffffffffffff;
        if (val == 0) g_hasExplicitZeroDim = true;
      }
      if (commaCount == 0) d1 = val > 0 ? (val as u32) : 0;
      else if (commaCount == 1) d2 = val > 0 ? (val as u32) : 0;
      else if (commaCount == 2) d3 = val > 0 ? (val as u32) : 0;
      else if (commaCount == 3) d4 = val > 0 ? (val as u32) : 0;
      commaCount++;
      sliceStart = i + 1;
    }
  }
  if (sliceStart <= endIdx) {
    let isColon = isColonSubscript(text, sliceStart, endIdx);
    let val: i32 = 0;
    if (!isColon) {
      if (dae != null && pool != null) {
        val = evalDimExpr(dae, pool, text, sliceStart, endIdx, prefixPathId, scopeStackPtr);
      } else {
        val = parseIntSlice(text, sliceStart, endIdx);
      }
      if (val < 0) return 0xffffffffffffffff;
      if (val == 0) g_hasExplicitZeroDim = true;
    }
    if (commaCount == 0) d1 = val > 0 ? (val as u32) : 0;
    else if (commaCount == 1) d2 = val > 0 ? (val as u32) : 0;
    else if (commaCount == 2) d3 = val > 0 ? (val as u32) : 0;
    else if (commaCount == 3) d4 = val > 0 ? (val as u32) : 0;
  }

  let totalDims = commaCount + 1;
  if (totalDims > 4) {
    return 0xffffffffffffffff;
  }
  g_lastParsedDim3 = d3;
  g_lastParsedDim4 = d4;
  g_lastParsedNDims = totalDims;
  return ((d1 as u64) << 32) | (d2 as u64);
}

function parseForIndexRange(fiLoc: u64, dae: DaeBuilder, pool: ArenaStringPool, outVals: ChunkedInt32Array, prefixPathId: u32 = 0, scopeStackPtr: usize = 0): u32 {
  let src = locBytes(fiLoc);
  let len = locLen(fiLoc);
  if (len == 0 || src == 0) return 0;
  let text = SourceTextView.at(src, len);
  let charCount = text.charCount;

  let inPos: u32 = 0;
  let inFound = false;
  for (let i: u32 = 0; i + 1 < charCount; i++) {
    let c1 = text.charAt(i);
    let c2 = text.charAt(i + 1);
    if (c1 == 105 && c2 == 110) { // 'i', 'n'
      let prevIsWord = false;
      if (i > 0) {
        let prev = text.charAt(i - 1);
        if ((prev >= 97 && prev <= 122) || (prev >= 65 && prev <= 90) || (prev >= 48 && prev <= 57) || prev == 95) {
          prevIsWord = true;
        }
      }
      let nextIsWord = false;
      if (i + 2 < charCount) {
        let next = text.charAt(i + 2);
        if ((next >= 97 && next <= 122) || (next >= 65 && next <= 90) || (next >= 48 && next <= 57) || next == 95) {
          nextIsWord = true;
        }
      }
      if (!prevIsWord && !nextIsWord) {
        inPos = i + 2;
        inFound = true;
        break;
      }
    }
  }

  let varNameId: u32 = 0;
  let idDesc = locFindDescendant(fiLoc, SyntaxType.IDENTIFIER);
  if (locIsNull(idDesc)) idDesc = locFindDescendant(fiLoc, SyntaxType.TOKEN_IDENTIFIER_ALT);
  if (locIsNull(idDesc)) idDesc = locFindDescendant(fiLoc, SyntaxType.NAME);
  if (!locIsNull(idDesc)) {
    varNameId = locIntern(pool, idDesc);
  } else {
    let varStart: u32 = 0;
    let varEnd = inFound ? inPos - 2 : charCount;
    while (varStart < varEnd) {
      let b = text.charAt(varStart);
      if (b != 32 && b != 9 && b != 10 && b != 13) break;
      varStart++;
    }
    while (varEnd > varStart) {
      let b = text.charAt(varEnd - 1);
      if (b != 32 && b != 9 && b != 10 && b != 13) break;
      varEnd--;
    }
    let pBytes = text.byteOffset(varStart);
    let pLen = text.byteLength(varEnd - varStart);
    varNameId = text.isUtf16 ? pool.internUtf16(pBytes, pLen) : pool.intern(pBytes, pLen);
  }

  if (!inFound) {
    if (varNameId != 0) {
      outVals.push(varNameId as i32);
      outVals.push(1);
      outVals.push(1);
      outVals.push(0);
      return 2;
    }
    return 0;
  }

  let colon1: u32 = 0;
  let colon2: u32 = 0;
  let colonCount: u32 = 0;
  let parenDepth: i32 = 0;
  for (let i = inPos; i < charCount; i++) {
    let b = text.charAt(i);
    if (b == 40) parenDepth++;
    else if (b == 41) { if (parenDepth > 0) parenDepth--; }
    else if (parenDepth == 0 && b == 58) { // ':'
      if (colonCount == 0) colon1 = i;
      else if (colonCount == 1) colon2 = i;
      colonCount++;
    }
  }
  if (colonCount == 0) return 0;

  let startVal: i32 = 0;
  let stepVal: i32 = 1;
  let endVal: i32 = 0;
  if (colonCount == 1) {
    startVal = parseRangePart(dae, pool, text, inPos, colon1, prefixPathId, scopeStackPtr);
    stepVal = 1;
    endVal = parseRangePart(dae, pool, text, colon1 + 1, charCount, prefixPathId, scopeStackPtr);
  } else if (colonCount >= 2) {
    startVal = parseRangePart(dae, pool, text, inPos, colon1, prefixPathId, scopeStackPtr);
    stepVal = parseRangePart(dae, pool, text, colon1 + 1, colon2, prefixPathId, scopeStackPtr);
    endVal = parseRangePart(dae, pool, text, colon2 + 1, charCount, prefixPathId, scopeStackPtr);
  }

  outVals.push(varNameId as i32);
  outVals.push(startVal);
  outVals.push(stepVal);
  outVals.push(endVal);
  return 1;
}

function findBindingExpressionLoc(modLoc: u64): u64 {
  if (locIsNull(modLoc)) return 0;
  let selfType = locType(modLoc);
  if (
    selfType == SyntaxType.CLASS_MODIFICATION ||
    selfType == SyntaxType.CLASS_OR_INHERITANCE_MODIFICATION ||
    selfType == SyntaxType.ARGUMENT_LIST ||
    selfType == SyntaxType.ARGUMENT
  ) {
    return 0;
  }
  if (selfType == SyntaxType.MODIFICATION_EXPRESSION || selfType == SyntaxType.EXPRESSION || selfType == SyntaxType.PRIMARY) {
    if (selfType == SyntaxType.MODIFICATION_EXPRESSION) {
      let inner = locFirstNonEmptyChild(modLoc);
      if (!locIsNull(inner)) return inner;
    }
    return modLoc;
  }
  let ch = locFirstChild(modLoc);
  while (!locIsNull(ch)) {
    let t = locType(ch);
    if (
      t == SyntaxType.CLASS_MODIFICATION ||
      t == SyntaxType.CLASS_OR_INHERITANCE_MODIFICATION ||
      t == SyntaxType.ARGUMENT_LIST ||
      t == SyntaxType.ARGUMENT
    ) {
      ch = locNextSibling(ch);
      continue;
    }
    if (t == SyntaxType.MODIFICATION_EXPRESSION || t == SyntaxType.EXPRESSION || t == SyntaxType.PRIMARY) {
      if (t == SyntaxType.MODIFICATION_EXPRESSION) {
        let inner = locFirstNonEmptyChild(ch);
        if (!locIsNull(inner)) return inner;
      }
      return ch;
    }
    let found = findBindingExpressionLoc(ch);
    if (!locIsNull(found)) return found;
    ch = locNextSibling(ch);
  }
  return 0;
}

function findClassModificationLoc(modLoc: u64): u64 {
  if (locIsNull(modLoc)) return 0;
  let t = locType(modLoc);
  if (t == SyntaxType.CLASS_MODIFICATION || t == SyntaxType.CLASS_OR_INHERITANCE_MODIFICATION) return modLoc;
  if (t == SyntaxType.EXTENDS_CLAUSE) {
    let extMod = locFindDescendant(modLoc, SyntaxType.CLASS_OR_INHERITANCE_MODIFICATION);
    if (!locIsNull(extMod)) return extMod;
  }
  let res = locFindChild(modLoc, SyntaxType.CLASS_MODIFICATION);
  if (locIsNull(res)) res = locFindChild(modLoc, SyntaxType.CLASS_OR_INHERITANCE_MODIFICATION);
  if (locIsNull(res)) res = locFindDescendant(modLoc, SyntaxType.CLASS_MODIFICATION);
  if (locIsNull(res)) res = locFindDescendant(modLoc, SyntaxType.CLASS_OR_INHERITANCE_MODIFICATION);
  return res;
}


function populateRedeclareLoc(env: ModificationEnvironment, redeclLoc: u64, pool: ArenaStringPool, exprVisitor: WasmExprVisitor, isFinalMod: boolean, isEachMod: boolean, isInherited: boolean): void {
  let ch = locFirstChild(redeclLoc);
  while (!locIsNull(ch)) {
    let ct = locType(ch);
    if (locMatches(ch, "final") || ct == SyntaxType.TOKEN_FINAL) isFinalMod = true;
    else if (locMatches(ch, "each") || ct == SyntaxType.TOKEN_EACH) isEachMod = true;
    ch = locNextSibling(ch);
  }

  // Case 1: redeclare of a component (COMPONENT_CLAUSE1 or COMPONENT_CLAUSE)
  let compClause = locFindChild(redeclLoc, SyntaxType.COMPONENT_CLAUSE1);
  if (locIsNull(compClause)) compClause = locFindDescendant(redeclLoc, SyntaxType.COMPONENT_CLAUSE1);
  if (locIsNull(compClause)) compClause = locFindDescendant(redeclLoc, SyntaxType.COMPONENT_CLAUSE);
  if (!locIsNull(compClause)) {
    let typeSpecLoc = locFindDescendant(compClause, SyntaxType.TYPE_SPECIFIER);
    let declLoc = locFindDescendant(compClause, SyntaxType.DECLARATION);
    if (locIsNull(declLoc)) declLoc = locFindDescendant(compClause, SyntaxType.COMPONENT_DECLARATION1);
    if (locIsNull(declLoc)) declLoc = locFindDescendant(compClause, SyntaxType.COMPONENT_DECLARATION);
    if (!locIsNull(typeSpecLoc) && !locIsNull(declLoc)) {
      let idLoc = locFirstNonEmptyChild(declLoc);
      if (!locIsNull(idLoc)) {
        let innerId = locFindDescendant(idLoc, SyntaxType.IDENTIFIER);
        if (!locIsNull(innerId)) idLoc = innerId;
        let compNameId = locIntern(pool, idLoc);
        let newTypeId = locIntern(pool, typeSpecLoc);
        if (compNameId != 0 && newTypeId != 0) {
          env.bindRedeclarePath(pool, compNameId, newTypeId, 0xffffffff, isFinalMod, isEachMod);
        }
        let modLoc = locFindDescendant(declLoc, SyntaxType.MODIFICATION);
        if (!locIsNull(modLoc)) {
          let exprLoc = findBindingExpressionLoc(modLoc);
          if (!locIsNull(exprLoc)) {
            let valExprId = exprVisitor.visitLoc(exprLoc);
            if (valExprId != 0xffffffff) {
              env.bindPath(pool, compNameId, valExprId, isFinalMod, isEachMod);
            }
          }
          let subModLoc = findClassModificationLoc(modLoc);
          if (!locIsNull(subModLoc)) {
            let childEnvPtr = env.lookupNested(compNameId);
            if (childEnvPtr == 0) {
              let parentChildPtr: u32 = 0;
              if (env.parentEnvPtr != 0) {
                parentChildPtr = changetype<ModificationEnvironment>(env.parentEnvPtr).lookupNested(compNameId);
              }
              childEnvPtr = ModificationEnvironment.create(parentChildPtr);
              env.bindNested(compNameId, childEnvPtr, isFinalMod, isEachMod);
            }
            populateEnvRecursive(changetype<ModificationEnvironment>(childEnvPtr), subModLoc, pool, exprVisitor, isInherited);
          }
        }
      }
    }
    return;
  }

  // Case 2: redeclare of a class/type (SHORT_CLASS_DEFINITION or CLASS_DEFINITION)
  let shortDef = locFindChild(redeclLoc, SyntaxType.SHORT_CLASS_DEFINITION);
  if (locIsNull(shortDef)) shortDef = locFindDescendant(redeclLoc, SyntaxType.SHORT_CLASS_DEFINITION);
  if (locIsNull(shortDef)) shortDef = locFindDescendant(redeclLoc, SyntaxType.CLASS_DEFINITION);
  if (!locIsNull(shortDef)) {
    let specLoc = locFindChild(shortDef, SyntaxType.SHORT_CLASS_SPECIFIER);
    if (locIsNull(specLoc)) specLoc = locFindDescendant(shortDef, SyntaxType.SHORT_CLASS_SPECIFIER);
    if (locIsNull(specLoc)) specLoc = locFindDescendant(shortDef, SyntaxType.CLASS_SPECIFIER);
    if (!locIsNull(specLoc)) {
      let classIdLoc = locFirstNonEmptyChild(specLoc);
      while (!locIsNull(classIdLoc) && locType(classIdLoc) != SyntaxType.IDENTIFIER && locType(classIdLoc) != SyntaxType.TOKEN_IDENTIFIER_ALT) {
        let inner = locFindDescendant(classIdLoc, SyntaxType.IDENTIFIER);
        if (!locIsNull(inner)) {
          classIdLoc = inner;
          break;
        }
        classIdLoc = locNextSibling(classIdLoc);
      }
      let targetSpecLoc = locFindDescendant(specLoc, SyntaxType.TYPE_SPECIFIER);
      if (locIsNull(targetSpecLoc)) targetSpecLoc = locFindDescendant(specLoc, SyntaxType.NAME);
      if (!locIsNull(classIdLoc) && !locIsNull(targetSpecLoc)) {
        let oldClassId = locIntern(pool, classIdLoc);
        let newClassId = locIntern(pool, targetSpecLoc);
        if (oldClassId != 0 && newClassId != 0) {
          env.bindRedeclarePath(pool, oldClassId, newClassId, 0xffffffff, isFinalMod, isEachMod);
        }
        let subModLoc = locFindDescendant(specLoc, SyntaxType.CLASS_MODIFICATION);
        if (!locIsNull(subModLoc) && oldClassId != 0) {
          let childEnvPtr = env.lookupNested(oldClassId);
          if (childEnvPtr == 0) {
            let parentChildPtr: u32 = 0;
            if (env.parentEnvPtr != 0) {
              parentChildPtr = changetype<ModificationEnvironment>(env.parentEnvPtr).lookupNested(oldClassId);
            }
            childEnvPtr = ModificationEnvironment.create(parentChildPtr);
            env.bindNested(oldClassId, childEnvPtr, isFinalMod, isEachMod);
          }
          populateEnvRecursive(changetype<ModificationEnvironment>(childEnvPtr), subModLoc, pool, exprVisitor, isInherited);
        }
      }
    }
  }
}

function populateEnvRecursive(env: ModificationEnvironment, modLoc: u64, pool: ArenaStringPool, exprVisitor: WasmExprVisitor, isInherited: boolean = false): void {
  let ch = locFirstChild(modLoc);
  while (!locIsNull(ch)) {
    let t = locType(ch);
    if (t == SyntaxType.ELEMENT_REDECLARATION || t == SyntaxType.ELEMENT_REPLACEABLE) {
      populateRedeclareLoc(env, ch, pool, exprVisitor, false, false, isInherited);
      ch = locNextSibling(ch);
      continue;
    }
    if (t == SyntaxType.ELEMENT_MODIFICATION || t == SyntaxType.ELEMENT_MODIFICATION_OR_REPLACEABLE) {
      let isFinalMod: boolean = false;
      let isEachMod: boolean = false;
      let redeclChild: u64 = 0;
      let elemModNode: u64 = t == SyntaxType.ELEMENT_MODIFICATION ? ch : 0;
      let mCh = locFirstChild(ch);
      while (!locIsNull(mCh)) {
        let mt = locType(mCh);
        if (locMatches(mCh, "final") || mt == SyntaxType.TOKEN_FINAL) isFinalMod = true;
        else if (locMatches(mCh, "each") || mt == SyntaxType.TOKEN_EACH) isEachMod = true;
        else if (mt == SyntaxType.ELEMENT_REDECLARATION || mt == SyntaxType.ELEMENT_REPLACEABLE) redeclChild = mCh;
        else if (mt == SyntaxType.ELEMENT_MODIFICATION) elemModNode = mCh;
        else {
          let innerRedecl = locFindChild(mCh, SyntaxType.ELEMENT_REPLACEABLE);
          if (locIsNull(innerRedecl)) innerRedecl = locFindChild(mCh, SyntaxType.ELEMENT_REDECLARATION);
          if (!locIsNull(innerRedecl)) redeclChild = innerRedecl;
          if (locIsNull(elemModNode)) {
            let innerEm = locFindChild(mCh, SyntaxType.ELEMENT_MODIFICATION);
            if (!locIsNull(innerEm)) elemModNode = innerEm;
          }
        }
        mCh = locNextSibling(mCh);
      }
      if (!locIsNull(redeclChild)) {
        populateRedeclareLoc(env, redeclChild, pool, exprVisitor, isFinalMod, isEachMod, isInherited);
        ch = locNextSibling(ch);
        continue;
      }
      if (locIsNull(elemModNode)) elemModNode = ch;
      let nameCur: u64 = 0;
      let emCh = locFirstChild(elemModNode);
      while (!locIsNull(emCh)) {
        let emt = locType(emCh);
        if (emt == SyntaxType.MODIFICATION || emt == SyntaxType.DESCRIPTION || emt == SyntaxType.DESCRIPTION_STRING) break;
        if (emt == SyntaxType.NAME || emt == SyntaxType.IDENTIFIER || emt == SyntaxType.TOKEN_IDENTIFIER_ALT) {
          nameCur = emCh;
          break;
        }
        emCh = locNextSibling(emCh);
      }
      if (locIsNull(nameCur)) nameCur = locFindChild(elemModNode, SyntaxType.NAME);
      if (locIsNull(nameCur)) nameCur = locFindDescendant(elemModNode, SyntaxType.IDENTIFIER);
      if (locIsNull(nameCur)) nameCur = locFindDescendant(elemModNode, SyntaxType.TOKEN_IDENTIFIER_ALT);
      if (locIsNull(nameCur)) nameCur = locFindDescendant(elemModNode, SyntaxType.NAME);

      if (!locIsNull(nameCur)) {
        let keyNameId = locIntern(pool, nameCur);
        let overridden = false;
        if (isInherited) {
          if (env.parentEnvPtr != 0) {
            let existing = changetype<ModificationEnvironment>(env.parentEnvPtr).lookupPath(pool, keyNameId);
            if (existing != 0xffffffff) overridden = true;
          } else if (exprVisitor.scopeStackPtr != 0) {
            let existing = changetype<ScopeStack>(exprVisitor.scopeStackPtr).lookupPath(pool, keyNameId);
            if (existing != 0xffffffff) overridden = true;
          }
        }
        let exprLoc = findBindingExpressionLoc(ch);
        if (!locIsNull(exprLoc) && !overridden) {
          let valExprId = exprVisitor.visitLoc(exprLoc);
          if (valExprId != 0xffffffff) {
            env.bindPath(pool, keyNameId, valExprId, isFinalMod, isEachMod);
          }
        }
        let subModLoc = locFindDescendant(ch, SyntaxType.CLASS_MODIFICATION);
        if (!locIsNull(subModLoc)) {
          let childEnvPtr = env.lookupNested(keyNameId);
          if (childEnvPtr == 0) {
            let parentChildPtr: u32 = 0;
            if (env.parentEnvPtr != 0) {
              parentChildPtr = changetype<ModificationEnvironment>(env.parentEnvPtr).lookupNested(keyNameId);
            }
            childEnvPtr = ModificationEnvironment.create(parentChildPtr);
            env.bindNested(keyNameId, childEnvPtr, isFinalMod, isEachMod);
          }
          populateEnvRecursive(changetype<ModificationEnvironment>(childEnvPtr), subModLoc, pool, exprVisitor, isInherited);
        }
      }
      ch = locNextSibling(ch);
      continue;
    }
    populateEnvRecursive(env, ch, pool, exprVisitor, isInherited);
    ch = locNextSibling(ch);
  }
}

function populateEnvFromClassModLoc(envPtr: u32, modLoc: u64, pool: ArenaStringPool, exprVisitor: WasmExprVisitor, isInherited: boolean = false): void {
  if (envPtr == 0 || locIsNull(modLoc)) return;
  let env = changetype<ModificationEnvironment>(envPtr);
  populateEnvRecursive(env, modLoc, pool, exprVisitor, isInherited);
}

function extractModAttr(modLoc: u64, attrName: string, exprVisitor: WasmExprVisitor): u32 {
  if (locIsNull(modLoc)) return 0xffffffff;
  let ch = locFirstChild(modLoc);
  while (!locIsNull(ch)) {
    let t = locType(ch);
    if (t == SyntaxType.CLASS_MODIFICATION) {
      ch = locNextSibling(ch);
      continue;
    }
    if (t == SyntaxType.ELEMENT_MODIFICATION || t == SyntaxType.ELEMENT_MODIFICATION_OR_REPLACEABLE) {
      let nameCur = locFindDescendant(ch, SyntaxType.IDENTIFIER);
      if (locIsNull(nameCur)) nameCur = locFindDescendant(ch, SyntaxType.TOKEN_IDENTIFIER_ALT);
      if (locIsNull(nameCur)) nameCur = locFindDescendant(ch, SyntaxType.NAME);
      if (!locIsNull(nameCur) && locMatches(nameCur, attrName)) {
        let exprLoc = findBindingExpressionLoc(ch);
        if (!locIsNull(exprLoc)) {
          let uid = exprVisitor.visitLoc(exprLoc);
          if (uid != 0xffffffff) return uid;
        }
      }
      ch = locNextSibling(ch);
      continue;
    }
    let sub = extractModAttr(ch, attrName, exprVisitor);
    if (sub != 0xffffffff) return sub;
    ch = locNextSibling(ch);
  }
  return 0xffffffff;
}

function extractModUnit(modLoc: u64, exprVisitor: WasmExprVisitor): u32 {
  return extractModAttr(modLoc, "unit", exprVisitor);
}

function extractModStart(modLoc: u64, exprVisitor: WasmExprVisitor): u32 {
  return extractModAttr(modLoc, "start", exprVisitor);
}

function extractModFixed(modLoc: u64, exprVisitor: WasmExprVisitor): u32 {
  return extractModAttr(modLoc, "fixed", exprVisitor);
}

function extractModMin(modLoc: u64, exprVisitor: WasmExprVisitor): u32 {
  return extractModAttr(modLoc, "min", exprVisitor);
}

function extractModMax(modLoc: u64, exprVisitor: WasmExprVisitor): u32 {
  return extractModAttr(modLoc, "max", exprVisitor);
}

function extractModNominal(modLoc: u64, exprVisitor: WasmExprVisitor): u32 {
  return extractModAttr(modLoc, "nominal", exprVisitor);
}

function extractModDisplayUnit(modLoc: u64, exprVisitor: WasmExprVisitor): u32 {
  return extractModAttr(modLoc, "displayUnit", exprVisitor);
}

function extractModQuantity(modLoc: u64, exprVisitor: WasmExprVisitor): u32 {
  return extractModAttr(modLoc, "quantity", exprVisitor);
}



const MOD_ENTRY_SLOTS: u32 = 256;
const MOD_ENTRY_MASK: u32 = MOD_ENTRY_SLOTS - 1;
let g_modEntryIdx: u32 = 0;
let g_modEntryBuf: usize = 0;

/**
 * Zero-cost unmanaged view over an entry in ModificationEnvironment.
 */
@unmanaged
export class ModEntryView {
  private _env: ModificationEnvironment;
  private _idx: u32;

  @inline static at(env: ModificationEnvironment, idx: u32): ModEntryView {
    if (g_modEntryBuf == 0) {
      g_modEntryBuf = atomicChunkAlloc(MOD_ENTRY_SLOTS * (sizeof<usize>() * 2));
    }
    let slot = (g_modEntryIdx++) & MOD_ENTRY_MASK;
    let a = changetype<ModEntryView>(g_modEntryBuf + slot * (sizeof<usize>() * 2));
    a._env = env;
    a._idx = idx;
    return a;
  }

  @inline get keyHash(): u32 { return this._env.keyHashes.get(this._idx); }
  @inline set keyHash(v: u32) { this._env.keyHashes.set(this._idx, v); }

  @inline get valExprId(): u32 { return this._env.valExprIds.get(this._idx); }
  @inline set valExprId(v: u32) { this._env.valExprIds.set(this._idx, v); }

  @inline get childEnvPtr(): u32 { return this._env.childEnvPtrs.get(this._idx); }
  @inline set childEnvPtr(v: u32) { this._env.childEnvPtrs.set(this._idx, v); }

  @inline get redeclareTypeHash(): u32 { return this._env.redeclareTypeHashes.get(this._idx); }
  @inline set redeclareTypeHash(v: u32) { this._env.redeclareTypeHashes.set(this._idx, v); }

  @inline get flags(): u32 { return this._env.flags.get(this._idx); }
  @inline set flags(v: u32) { this._env.flags.set(this._idx, v); }

  @inline get isFinal(): bool { return (this.flags & FLAG_MOD_FINAL) != 0; }
  @inline get isEach(): bool { return (this.flags & FLAG_MOD_EACH) != 0; }
  @inline get isRedeclare(): bool { return (this.flags & FLAG_MOD_REDECLARE) != 0; }
  @inline get isReplaceable(): bool { return (this.flags & FLAG_MOD_REPLACEABLE) != 0; }
}

/**
 * Modification and Parameter Binding Environment in Linear Memory.
 */
@unmanaged
export class ModificationEnvironment {
  static poolPtrs: usize = 0;
  static poolIdx: u32 = 0;

  keyHashes: ChunkedUint32Array;
  valExprIds: ChunkedUint32Array;
  childEnvPtrs: ChunkedUint32Array;
  redeclareTypeHashes: ChunkedUint32Array;
  flags: ChunkedUint32Array;
  count: u32;
  parentEnvPtr: u32;

  @inline static create(parentPtr: u32 = 0): u32 {
    if (ModificationEnvironment.poolPtrs == 0) {
      ModificationEnvironment.poolPtrs = changetype<usize>(createChunkedUint32Array(256));
    }
    let pool = changetype<ChunkedUint32Array>(ModificationEnvironment.poolPtrs);
    if (ModificationEnvironment.poolIdx < pool.length) {
      let ptr = pool.get(ModificationEnvironment.poolIdx++);
      let env = changetype<ModificationEnvironment>(ptr);
      env.count = 0;
      env.parentEnvPtr = parentPtr;
      return ptr;
    }
    let ptr = atomicChunkAlloc(offsetof<ModificationEnvironment>());
    changetype<ModificationEnvironment>(ptr).init(parentPtr);
    pool.push(ptr);
    ModificationEnvironment.poolIdx = pool.length;
    return ptr;
  }

  @inline getEntry(idx: u32): ModEntryView {
    return ModEntryView.at(this, idx);
  }

  init(parentPtr: u32 = 0): void {
    this.keyHashes = createChunkedUint32Array(256);
    this.valExprIds = createChunkedUint32Array(256);
    this.childEnvPtrs = createChunkedUint32Array(256);
    this.redeclareTypeHashes = createChunkedUint32Array(256);
    this.flags = createChunkedUint32Array(256);
    this.count = 0;
    this.parentEnvPtr = parentPtr;
  }

  bind(keyHash: u32, valExprId: u32, isFinal: boolean = false, isEach: boolean = false): void {
    let f: u32 = 0;
    if (isFinal) f |= FLAG_MOD_FINAL;
    if (isEach) f |= FLAG_MOD_EACH;

    for (let i: u32 = 0; i < this.count; i++) {
      let entry = this.getEntry(i);
      if (entry.keyHash == keyHash) {
        let existingFlags = entry.flags;
        if (entry.isFinal && !isFinal) {
          return;
        }
        entry.valExprId = valExprId;
        entry.flags = f | (existingFlags & (FLAG_MOD_FINAL | FLAG_MOD_REDECLARE | FLAG_MOD_REPLACEABLE));
        return;
      }
    }

    let idx = this.count++;
    let entry = this.getEntry(idx);
    entry.keyHash = keyHash;
    entry.valExprId = valExprId;
    entry.childEnvPtr = 0;
    entry.redeclareTypeHash = 0;
    entry.flags = f;
  }

  bindNested(keyHash: u32, childEnvPtr: u32, isFinal: boolean = false, isEach: boolean = false): void {
    let f: u32 = 0;
    if (isFinal) f |= FLAG_MOD_FINAL;
    if (isEach) f |= FLAG_MOD_EACH;

    for (let i: u32 = 0; i < this.count; i++) {
      let entry = this.getEntry(i);
      if (entry.keyHash == keyHash) {
        let existingFlags = entry.flags;
        if (entry.isFinal && !isFinal) {
          return;
        }
        entry.childEnvPtr = childEnvPtr;
        entry.flags = f | (existingFlags & (FLAG_MOD_FINAL | FLAG_MOD_REDECLARE | FLAG_MOD_REPLACEABLE));
        return;
      }
    }

    let idx = this.count++;
    let entry = this.getEntry(idx);
    entry.keyHash = keyHash;
    entry.valExprId = 0xffffffff;
    entry.childEnvPtr = childEnvPtr;
    entry.redeclareTypeHash = 0;
    entry.flags = f;
  }

  bindRedeclare(keyHash: u32, newTypeHash: u32, valExprId: u32 = 0xffffffff, isFinal: boolean = false, isEach: boolean = false): void {
    let f: u32 = FLAG_MOD_REDECLARE;
    if (isFinal) f |= FLAG_MOD_FINAL;
    if (isEach) f |= FLAG_MOD_EACH;

    for (let i: u32 = 0; i < this.count; i++) {
      let entry = this.getEntry(i);
      if (entry.keyHash == keyHash) {
        let existingFlags = entry.flags;
        if (entry.isFinal && !isFinal) {
          return;
        }
        entry.redeclareTypeHash = newTypeHash;
        entry.valExprId = valExprId;
        entry.flags = f | (existingFlags & FLAG_MOD_FINAL);
        return;
      }
    }

    let idx = this.count++;
    let entry = this.getEntry(idx);
    entry.keyHash = keyHash;
    entry.valExprId = valExprId;
    entry.childEnvPtr = 0;
    entry.redeclareTypeHash = newTypeHash;
    entry.flags = f;
  }

  mergeFrom(other: ModificationEnvironment): void {
    for (let i: u32 = 0; i < other.count; i++) {
      let entry = other.getEntry(i);
      let isFinal = entry.isFinal;
      let isEach = entry.isEach;
      let isRedeclare = entry.isRedeclare;
      let keyHash = entry.keyHash;
      let valExprId = entry.valExprId;
      let childEnvPtr = entry.childEnvPtr;
      let redeclareTypeHash = entry.redeclareTypeHash;
      if (valExprId != 0xffffffff) {
        this.bind(keyHash, valExprId, isFinal, isEach);
      }
      if (childEnvPtr != 0) {
        let existingChildPtr = this.lookupNested(keyHash);
        if (existingChildPtr != 0) {
          changetype<ModificationEnvironment>(existingChildPtr).mergeFrom(changetype<ModificationEnvironment>(childEnvPtr));
        } else {
          this.bindNested(keyHash, childEnvPtr, isFinal, isEach);
        }
      }
      if (isRedeclare) {
        this.bindRedeclare(keyHash, redeclareTypeHash, valExprId, isFinal, isEach);
      }
    }
  }

  bindPath(pool: ArenaStringPool, pathId: u32, valExprId: u32, isFinal: boolean = false, isEach: boolean = false): void {
    let dotIdx = findDotInStringPool(pool, pathId);
    if (dotIdx < 0) {
      this.bind(pathId, valExprId, isFinal, isEach);
      return;
    }

    this.bind(pathId, valExprId, isFinal, isEach);

    let off = pool.getOffset(pathId);
    let len = pool.getLength(pathId);
    let headId = internPoolSlice(pool, off, dotIdx as u32);
    let tailId = internPoolSlice(pool, off + (dotIdx as u32) + 1, (len - (dotIdx as u32) - 1) as u32);

    let headFlags = this.lookupFlags(headId);
    if ((headFlags & FLAG_MOD_FINAL) != 0 && !isFinal) {
      return;
    }

    let childPtr = this.lookupNested(headId);
    if (childPtr == 0) {
      childPtr = ModificationEnvironment.create(changetype<usize>(this) as u32);
      this.bindNested(headId, childPtr, isFinal, isEach);
    }
    changetype<ModificationEnvironment>(childPtr).bindPath(pool, tailId, valExprId, isFinal, isEach);
  }

  bindRedeclarePath(pool: ArenaStringPool, pathId: u32, newTypeHash: u32, valExprId: u32 = 0xffffffff, isFinal: boolean = false, isEach: boolean = false): void {
    let dotIdx = findDotInStringPool(pool, pathId);
    if (dotIdx < 0) {
      this.bindRedeclare(pathId, newTypeHash, valExprId, isFinal, isEach);
      return;
    }

    this.bindRedeclare(pathId, newTypeHash, valExprId, isFinal, isEach);

    let off = pool.getOffset(pathId);
    let len = pool.getLength(pathId);
    let headId = internPoolSlice(pool, off, dotIdx as u32);
    let tailId = internPoolSlice(pool, off + (dotIdx as u32) + 1, (len - (dotIdx as u32) - 1) as u32);

    let childPtr = this.lookupNested(headId);
    if (childPtr == 0) {
      childPtr = ModificationEnvironment.create(changetype<usize>(this) as u32);
      this.bindNested(headId, childPtr, isFinal, isEach);
    }
    changetype<ModificationEnvironment>(childPtr).bindRedeclarePath(pool, tailId, newTypeHash, valExprId, isFinal, isEach);
  }

  lookup(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      let entry = this.getEntry(i as u32);
      if (entry.keyHash == keyHash) {
        if (entry.valExprId != 0xffffffff) {
          return entry.valExprId;
        }
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookup(keyHash);
    }
    return 0xffffffff;
  }

  lookupNested(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      let entry = this.getEntry(i as u32);
      if (entry.keyHash == keyHash) {
        if (entry.childEnvPtr != 0) {
          return entry.childEnvPtr;
        }
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupNested(keyHash);
    }
    return 0;
  }

  lookupRedeclare(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      let entry = this.getEntry(i as u32);
      if (entry.keyHash == keyHash) {
        if (entry.redeclareTypeHash != 0) {
          return entry.redeclareTypeHash;
        }
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupRedeclare(keyHash);
    }
    return 0;
  }

  lookupFlags(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      let entry = this.getEntry(i as u32);
      if (entry.keyHash == keyHash) {
        return entry.flags;
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupFlags(keyHash);
    }
    return 0;
  }

  lookupPath(pool: ArenaStringPool, pathId: u32): u32 {
    let direct = this.lookup(pathId);
    if (direct != 0xffffffff) return direct;

    let dotIdx = findDotInStringPool(pool, pathId);
    if (dotIdx >= 0) {
      let off = pool.getOffset(pathId);
      let len = pool.getLength(pathId);
      let headId = internPoolSlice(pool, off, dotIdx as u32);
      let tailId = internPoolSlice(pool, off + (dotIdx as u32) + 1, (len - (dotIdx as u32) - 1) as u32);

      let childPtr = this.lookupNested(headId);
      if (childPtr != 0) {
        let val = changetype<ModificationEnvironment>(childPtr).lookupPath(pool, tailId);
        if (val != 0xffffffff) return val;
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupPath(pool, pathId);
    }
    return 0xffffffff;
  }

  lookupNestedPath(pool: ArenaStringPool, pathId: u32): u32 {
    let dotIdx = findDotInStringPool(pool, pathId);
    if (dotIdx < 0) {
      return this.lookupNested(pathId);
    }
    let off = pool.getOffset(pathId);
    let len = pool.getLength(pathId);
    let headId = internPoolSlice(pool, off, dotIdx as u32);
    let tailId = internPoolSlice(pool, off + (dotIdx as u32) + 1, (len - (dotIdx as u32) - 1) as u32);

    let childPtr = this.lookupNested(headId);
    if (childPtr != 0) {
      return changetype<ModificationEnvironment>(childPtr).lookupNestedPath(pool, tailId);
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupNestedPath(pool, pathId);
    }
    return 0;
  }

  lookupRedeclarePath(pool: ArenaStringPool, pathId: u32): u32 {
    let direct = this.lookupRedeclare(pathId);
    if (direct != 0) return direct;

    let dotIdx = findDotInStringPool(pool, pathId);
    if (dotIdx >= 0) {
      let off = pool.getOffset(pathId);
      let len = pool.getLength(pathId);
      let headId = internPoolSlice(pool, off, dotIdx as u32);
      let tailId = internPoolSlice(pool, off + (dotIdx as u32) + 1, (len - (dotIdx as u32) - 1) as u32);

      let childPtr = this.lookupNested(headId);
      if (childPtr != 0) {
        let redecl = changetype<ModificationEnvironment>(childPtr).lookupRedeclarePath(pool, tailId);
        if (redecl != 0) return redecl;
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupRedeclarePath(pool, pathId);
    }
    return 0;
  }

  lookupWithEach(baseNameHash: u32, elementKeyHash: u32): u32 {
    let direct = this.lookup(elementKeyHash);
    if (direct != 0xffffffff) return direct;

    let flags = this.lookupFlags(baseNameHash);
    if ((flags & FLAG_MOD_EACH) != 0) {
      return this.lookup(baseNameHash);
    }
    return 0xffffffff;
  }

  lookupNestedWithEach(baseNameHash: u32, elementKeyHash: u32): u32 {
    let direct = this.lookupNested(elementKeyHash);
    if (direct != 0) return direct;

    let flags = this.lookupFlags(baseNameHash);
    if ((flags & FLAG_MOD_EACH) != 0) {
      return this.lookupNested(baseNameHash);
    }
    return 0;
  }

  merge(otherEnvPtr: u32): void {
    if (otherEnvPtr == 0) return;
    let other = changetype<ModificationEnvironment>(otherEnvPtr);
    for (let i: u32 = 0; i < other.count; i++) {
      let otherEntry = other.getEntry(i);
      let key = otherEntry.keyHash;
      let val = otherEntry.valExprId;
      let child = otherEntry.childEnvPtr;
      let redecl = otherEntry.redeclareTypeHash;
      let f = otherEntry.flags;

      let existingFlags = this.lookupFlags(key);
      if ((existingFlags & FLAG_MOD_FINAL) != 0) {
        continue;
      }

      let existingChild = this.lookupNested(key);
      if (existingChild != 0 && child != 0) {
        changetype<ModificationEnvironment>(existingChild).merge(child);
        continue;
      }

      let found = false;
      for (let j: u32 = 0; j < this.count; j++) {
        let entry = this.getEntry(j);
        if (entry.keyHash == key) {
          if (val != 0xffffffff && val != 0) entry.valExprId = val;
          if (child != 0) entry.childEnvPtr = child;
          if (redecl != 0) entry.redeclareTypeHash = redecl;
          entry.flags = f | existingFlags;
          found = true;
          break;
        }
      }
      if (!found) {
        let idx = this.count++;
        let entry = this.getEntry(idx);
        entry.keyHash = key;
        entry.valExprId = val;
        entry.childEnvPtr = child;
        entry.redeclareTypeHash = redecl;
        entry.flags = f;
      }
    }
  }
}

/**
 * Linear-Memory Lexical Scope Stack.
 */
@unmanaged
export class ScopeStack {
  scopeIds: ChunkedUint32Array;
  envPtrs: ChunkedUint32Array;
  prefixPathIds: ChunkedUint32Array;
  flags: ChunkedUint32Array;
  depth: u32;

  @inline static create(): ScopeStack {
    let ptr = atomicChunkAlloc(offsetof<ScopeStack>());
    let obj = changetype<ScopeStack>(ptr);
    obj.init();
    return obj;
  }

  init(): void {
    this.scopeIds = createChunkedUint32Array(64);
    this.envPtrs = createChunkedUint32Array(64);
    this.prefixPathIds = createChunkedUint32Array(64);
    this.flags = createChunkedUint32Array(64);
    this.depth = 0;
  }

  push(scopeId: u32, envPtr: u32, prefixPathId: u32 = 0, flags: u32 = 0): void {
    let idx = this.depth++;
    this.scopeIds.set(idx, scopeId);
    this.envPtrs.set(idx, envPtr);
    this.prefixPathIds.set(idx, prefixPathId);
    this.flags.set(idx, flags);
  }

  pop(): void {
    if (this.depth > 0) {
      this.depth--;
    }
  }

  get currentScopeId(): u32 {
    return this.depth > 0 ? this.scopeIds.get(this.depth - 1) : 0;
  }

  get currentEnvPtr(): u32 {
    return this.depth > 0 ? this.envPtrs.get(this.depth - 1) : 0;
  }

  get currentPrefixPathId(): u32 {
    return this.depth > 0 ? this.prefixPathIds.get(this.depth - 1) : 0;
  }

  lookup(keyHash: u32): u32 {
    for (let i: i32 = this.depth - 1; i >= 0; i--) {
      let envPtr = this.envPtrs.get(i);
      if (envPtr != 0) {
        let val = changetype<ModificationEnvironment>(envPtr).lookup(keyHash);
        if (val != 0xffffffff) return val;
      }
    }
    return 0xffffffff;
  }

  lookupPath(pool: ArenaStringPool, pathId: u32): u32 {
    for (let i: i32 = this.depth - 1; i >= 0; i--) {
      let envPtr = this.envPtrs.get(i);
      if (envPtr != 0) {
        let val = changetype<ModificationEnvironment>(envPtr).lookupPath(pool, pathId);
        if (val != 0xffffffff) return val;
      }
    }
    return 0xffffffff;
  }

  lookupNested(keyHash: u32): u32 {
    for (let i: i32 = this.depth - 1; i >= 0; i--) {
      let envPtr = this.envPtrs.get(i);
      if (envPtr != 0) {
        let child = changetype<ModificationEnvironment>(envPtr).lookupNested(keyHash);
        if (child != 0) return child;
      }
    }
    return 0;
  }

  lookupNestedPath(pool: ArenaStringPool, pathId: u32): u32 {
    for (let i: i32 = this.depth - 1; i >= 0; i--) {
      let envPtr = this.envPtrs.get(i);
      if (envPtr != 0) {
        let child = changetype<ModificationEnvironment>(envPtr).lookupNestedPath(pool, pathId);
        if (child != 0) return child;
      }
    }
    return 0;
  }

  lookupRedeclare(keyHash: u32): u32 {
    for (let i: i32 = this.depth - 1; i >= 0; i--) {
      let envPtr = this.envPtrs.get(i);
      if (envPtr != 0) {
        let redecl = changetype<ModificationEnvironment>(envPtr).lookupRedeclare(keyHash);
        if (redecl != 0) return redecl;
      }
    }
    return 0;
  }

  lookupRedeclarePath(pool: ArenaStringPool, pathId: u32): u32 {
    for (let i: i32 = this.depth - 1; i >= 0; i--) {
      let envPtr = this.envPtrs.get(i);
      if (envPtr != 0) {
        let redecl = changetype<ModificationEnvironment>(envPtr).lookupRedeclarePath(pool, pathId);
        if (redecl != 0) return redecl;
      }
    }
    return 0;
  }

  lookupFlags(keyHash: u32): u32 {
    for (let i: i32 = this.depth - 1; i >= 0; i--) {
      let envPtr = this.envPtrs.get(i);
      if (envPtr != 0) {
        let f = changetype<ModificationEnvironment>(envPtr).lookupFlags(keyHash);
        if (f != 0) return f;
      }
    }
    return 0;
  }
}

/**
 * In-WASM Abstract Syntax Tree Expression Visitor.
 */
@unmanaged
export class WasmExprVisitor {
  daePtr: u32;
  prefixHash: u32;
  loopVarsPtr: usize;
  envPtr: u32;
  scopeStackPtr: u32;
  tempBufferPtr: usize;
  scratchBufferPtr: usize;
  flattenerPtr: u32;
  currentDimEnd: i32;
  subLoc1: u64;
  subLoc2: u64;
  subLoc3: u64;
  // Algorithm-section mode: keep non-constant subscripts symbolic (`x[i]`) rather
  // than constant-folding them to a scalar element name.
  symbolicSubscripts: boolean;
  // Keep `a:b` / `a:s:b` as Range nodes instead of expanding them to array
  // constructors (used for `for`-statement ranges, which OMC prints verbatim).
  keepRanges: boolean;
  stopLocReached: bool;

  @inline get dae(): DaeBuilder {
    return changetype<DaeBuilder>(this.daePtr);
  }

  @inline get loopVars(): UnmanagedMap64 {
    return changetype<UnmanagedMap64>(this.loopVarsPtr);
  }

  @inline get tempBuffer(): ChunkedUint32Array {
    return changetype<ChunkedUint32Array>(this.tempBufferPtr);
  }

  @inline get scratchBuffer(): ChunkedUint32Array {
    return changetype<ChunkedUint32Array>(this.scratchBufferPtr);
  }

  @inline static create(dae: DaeBuilder, prefixHash: u32 = 0, envPtr: u32 = 0, scopeStackPtr: u32 = 0, flattenerPtr: u32 = 0): WasmExprVisitor {
    let ptr = atomicChunkAlloc(offsetof<WasmExprVisitor>());
    let obj = changetype<WasmExprVisitor>(ptr);
    obj.init(dae, prefixHash, envPtr, scopeStackPtr, flattenerPtr);
    return obj;
  }

  init(dae: DaeBuilder, prefixHash: u32 = 0, envPtr: u32 = 0, scopeStackPtr: u32 = 0, flattenerPtr: u32 = 0): void {
    this.daePtr = changetype<usize>(dae) as u32;
    this.prefixHash = prefixHash;
    this.loopVarsPtr = createMap64(64);
    this.envPtr = envPtr;
    this.scopeStackPtr = scopeStackPtr;
    this.tempBufferPtr = changetype<usize>(createChunkedUint32Array(64)) as u32;
    this.scratchBufferPtr = changetype<usize>(createChunkedUint32Array(64)) as u32;
    this.flattenerPtr = flattenerPtr;
    this.currentDimEnd = 0;
    this.subLoc1 = 0;
    this.subLoc2 = 0;
    this.subLoc3 = 0;
    this.symbolicSubscripts = false;
    this.keepRanges = false;
    this.stopLocReached = false;
  }

  reset(dae: DaeBuilder, prefixHash: u32 = 0, envPtr: u32 = 0, scopeStackPtr: u32 = 0, flattenerPtr: u32 = 0): void {
    this.daePtr = changetype<usize>(dae) as u32;
    this.prefixHash = prefixHash;
    if (this.loopVarsPtr != 0) {
      changetype<UnmanagedMap64>(this.loopVarsPtr).clear();
    } else {
      this.loopVarsPtr = createMap64(64);
    }
    this.envPtr = envPtr;
    this.scopeStackPtr = scopeStackPtr;
    if (this.tempBufferPtr != 0) {
      changetype<ChunkedUint32Array>(this.tempBufferPtr).clear();
    } else {
      this.tempBufferPtr = changetype<usize>(createChunkedUint32Array(64)) as u32;
    }
    if (this.scratchBufferPtr != 0) {
      changetype<ChunkedUint32Array>(this.scratchBufferPtr).clear();
    } else {
      this.scratchBufferPtr = changetype<usize>(createChunkedUint32Array(64)) as u32;
    }
    this.flattenerPtr = flattenerPtr;
    this.currentDimEnd = 0;
    this.subLoc1 = 0;
    this.subLoc2 = 0;
    this.subLoc3 = 0;
    this.symbolicSubscripts = false;
    this.keepRanges = false;
    this.stopLocReached = false;
  }

  @inline resolveVarName(nameId: u32): u32 {
    if (this.flattenerPtr != 0) {
      return changetype<ModelicaFlattener>(this.flattenerPtr).resolveOuterToInner(this.dae.getStringPool(), nameId);
    }
    return nameId;
  }

  @inline getArrayShapeDim(nameId: u32, dim: u32): u32 {
    if (this.flattenerPtr != 0) {
      return changetype<ModelicaFlattener>(this.flattenerPtr).getArrayShapeDim(nameId, dim);
    }
    return 0;
  }

  @inline getArrayNDims(nameId: u32): u32 {
    if (this.flattenerPtr != 0) {
      return changetype<ModelicaFlattener>(this.flattenerPtr).getArrayNDims(nameId);
    }
    return 0;
  }

  @inline hasArrayShape(nameId: u32): boolean {
    if (this.flattenerPtr != 0) {
      return changetype<ModelicaFlattener>(this.flattenerPtr).hasArrayShape(nameId);
    }
    return false;
  }

  setLoopVar(nameHash: u32, exprId: u32): void {
    this.loopVars.set(nameHash as u64, (exprId + 1) as u32);
  }

  getLoopVar(nameHash: u32): u32 {
    let v = this.loopVars.get(nameHash as u64);
    if (v != 0) return v - 1;
    return 0xffffffff;
  }

  removeLoopVar(nameHash: u32): void {
    this.loopVars.set(nameHash as u64, 0);
  }

  isRealExpr(exprId: u32): boolean {
    if (exprId >= this.dae.exprCount) return false;
    let kind = this.dae.getExprKind(exprId);
    if (kind == ExprKind.RealLiteral) return true;
    if (kind == ExprKind.Name) {
      let rawNameId = this.dae.getExprData1(exprId);
      let pool = this.dae.getStringPool();
      if (poolMatchesSimple(pool, rawNameId, "time")) return true;
      let nameId = this.resolveVarName(rawNameId);
      if (poolMatchesSimple(pool, nameId, "time")) return true;
      let v = this.dae.lookupVariableByName(nameId);
      if (v >= 0) return this.dae.getVarType(v as u32) == (VarType.Real as i32);
    }
    if (kind == ExprKind.Binary) {
      let op = this.dae.getExprData1(exprId) as u16;
      if (op == (BinOp.Div as u16) || op == (BinOp.ElemDiv as u16) ||
          op == (BinOp.Pow as u16) || op == (BinOp.ElemPow as u16)) return true;
      let left = this.dae.getExprLeft(exprId);
      let right = this.dae.getExprRight(exprId);
      return this.isRealExpr(left) || this.isRealExpr(right);
    }
    if (kind == ExprKind.Unary) {
      return this.isRealExpr(this.dae.getExprLeft(exprId));
    }
    if (kind == ExprKind.ArrayCtor) {
      let count = this.dae.getExprData1(exprId);
      if (count > 0) {
        return this.isRealExpr(getArrayCtorElement(this.dae, exprId, 0));
      }
    }
    if (kind == ExprKind.Subscript) {
      return this.isRealArrayName(this.dae.getExprData1(exprId));
    }
    if (kind == ExprKind.IfElse) {
      return this.isRealExpr(this.dae.getExprLeft(exprId)) || this.isRealExpr(this.dae.getExprRight(exprId));
    }
    if (kind == ExprKind.Call) {
      let fnId = this.dae.getExprData1(exprId);
      let pool = this.dae.getStringPool();
      if (poolMatchesSimple(pool, fnId, "sin") || poolMatchesSimple(pool, fnId, "cos") ||
          poolMatchesSimple(pool, fnId, "tan") || poolMatchesSimple(pool, fnId, "asin") ||
          poolMatchesSimple(pool, fnId, "acos") || poolMatchesSimple(pool, fnId, "atan") ||
          poolMatchesSimple(pool, fnId, "atan2") || poolMatchesSimple(pool, fnId, "sinh") ||
          poolMatchesSimple(pool, fnId, "cosh") || poolMatchesSimple(pool, fnId, "tanh") ||
          poolMatchesSimple(pool, fnId, "exp") || poolMatchesSimple(pool, fnId, "log") ||
          poolMatchesSimple(pool, fnId, "log10") || poolMatchesSimple(pool, fnId, "sqrt") ||
          poolMatchesSimple(pool, fnId, "zeros") || poolMatchesSimple(pool, fnId, "previous") ||
          poolMatchesSimple(pool, fnId, "pre") || poolMatchesSimple(pool, fnId, "hold") ||
          poolMatchesSimple(pool, fnId, "noEvent")) {
        return true;
      }
    }
    return false;
  }

  /** True when `nameExprId` is a Name whose scalar or first array element is Real-typed. */
  isRealArrayName(nameExprId: u32): boolean {
    if (nameExprId >= this.dae.exprCount) return false;
    if (this.dae.getExprKind(nameExprId) != ExprKind.Name) return false;
    let pool = this.dae.getStringPool();
    let nameId = this.resolveVarName(this.dae.getExprData1(nameExprId));
    let v = this.dae.lookupVariableByName(nameId);
    if (v < 0) v = this.dae.lookupVariableByName(concatArrayIndex1D(pool, nameId, 1));
    if (v < 0) v = this.dae.lookupVariableByName(concatArrayIndex2D(pool, nameId, 1, 1));
    if (v < 0) return false;
    return this.dae.getVarType(v as u32) == (VarType.Real as i32);
  }

  /** Subscript expressions that the scalar-element path can evaluate on its own. */
  isConstIndexExpr(exprId: u32): boolean {
    if (exprId >= this.dae.exprCount) return false;
    let k = this.dae.getExprKind(exprId);
    if (k == ExprKind.IntLiteral || k == ExprKind.Colon || k == ExprKind.BoolLiteral || k == ExprKind.EnumLiteral) {
      return true;
    }
    if (k == ExprKind.ArrayCtor) {
      let count = this.dae.getExprData1(exprId);
      for (let i: u32 = 0; i < count; i++) {
        if (!this.isConstIndexExpr(getArrayCtorElement(this.dae, exprId, i))) return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Lowers `base[s1, ..., sn]` to an `ExprKind.Subscript` node when at least one
   * subscript is not a compile-time constant (e.g. a `for`-statement iterator).
   * Only a trailing subscript group is supported (`a.b[i]`, not `a[i].b`).
   * Returns 0xffffffff when the scalar-element path should handle the reference.
   */
  tryLowerSymbolicRef(refLoc: u64, subLoc: u64, pool: ArenaStringPool): u32 {
    if (locOffset(subLoc) + locLen(subLoc) != locOffset(refLoc) + locLen(refLoc)) return 0xffffffff;
    let baseId = this.symbolicRefBaseName(refLoc, subLoc, pool, 0);
    if (baseId == 0 || baseId == 0xffffffff) return 0xffffffff;
    let prefixId = this.scopeStackPtr != 0 ? changetype<ScopeStack>(this.scopeStackPtr).currentPrefixPathId : 0;
    let fullBaseId = prefixId != 0 ? pool.concatIds(prefixId, baseId) : baseId;
    fullBaseId = this.resolveVarName(fullBaseId);
    if (prefixId != 0 && !this.nameExistsAsVarOrArray(fullBaseId)) {
      let unprefixed = this.resolveVarName(baseId);
      if (this.nameExistsAsVarOrArray(unprefixed)) fullBaseId = unprefixed;
    }

    let subStart = this.tempBuffer.length;
    this.collectSymbolicSubscripts(subLoc, fullBaseId, subStart);
    let subCount = this.tempBuffer.length - subStart;
    let symbolic = false;
    for (let i: u32 = 0; i < subCount; i++) {
      let sid = this.tempBuffer.get(subStart + i);
      if (sid == 0xffffffff) {
        this.tempBuffer.length = subStart;
        return 0xffffffff;
      }
      if (!this.isConstIndexExpr(sid)) symbolic = true;
    }
    if (!symbolic || subCount == 0) {
      this.tempBuffer.length = subStart;
      return 0xffffffff;
    }
    let baseExpr = this.dae.addExpression(ExprKind.Name, fullBaseId);
    let first = this.dae.addExpression(ExprKind.Subscript, baseExpr, this.tempBuffer.get(subStart), subCount);
    for (let i: u32 = 1; i < subCount; i++) {
      this.dae.addExpression(ExprKind.Tuple, 0, this.tempBuffer.get(subStart + i), 0);
    }
    this.tempBuffer.length = subStart;
    return first;
  }

  /**
   * Dotted name of `refLoc` excluding its trailing subscript group `targetSubLoc`.
   * Returns 0xffffffff when another (non-trailing) subscript group is present.
   */
  private symbolicRefBaseName(nodeLoc: u64, targetSubLoc: u64, pool: ArenaStringPool, acc: u32): u32 {
    let ch = locFirstChild(nodeLoc);
    while (!locIsNull(ch)) {
      let ct = locType(ch);
      if (ct == SyntaxType.ARRAY_SUBSCRIPTS) {
        if (ch != targetSubLoc && locLen(ch) > 0) return 0xffffffff;
      } else if (ct == SyntaxType.IDENTIFIER || ct == SyntaxType.TOKEN_IDENTIFIER_ALT) {
        let partId = locIntern(pool, ch);
        acc = acc == 0 ? partId : pool.concatIds(acc, partId);
      } else if (locChildCount(ch) > 0) {
        acc = this.symbolicRefBaseName(ch, targetSubLoc, pool, acc);
        if (acc == 0xffffffff) return acc;
      }
      ch = locNextSibling(ch);
    }
    return acc;
  }

  private nameExistsAsVarOrArray(nameId: u32): boolean {
    if (this.dae.lookupVariableByName(nameId) >= 0) return true;
    let pool = this.dae.getStringPool();
    if (this.dae.lookupVariableByName(concatArrayIndex1D(pool, nameId, 1)) >= 0) return true;
    return this.dae.lookupVariableByName(concatArrayIndex2D(pool, nameId, 1, 1)) >= 0;
  }

  private collectSymbolicSubscripts(nodeLoc: u64, baseNameId: u32, subStart: u32): void {
    let ch = locFirstChild(nodeLoc);
    while (!locIsNull(ch)) {
      if (locType(ch) == SyntaxType.SUBSCRIPT) {
        let onlyCh = locFirstNonEmptyChild(ch);
        if (locMatches(ch, ":") || (!locIsNull(onlyCh) && locMatches(onlyCh, ":") && locIsNull(locNextNonEmptySibling(onlyCh)))) {
          this.tempBuffer.push(this.dae.addExpression(ExprKind.Colon, 0, 0xffffffff, 0xffffffff));
        } else {
          let dimIdx = this.tempBuffer.length - subStart + 1;
          let prevEnd = this.currentDimEnd;
          this.currentDimEnd = this.getArrayShapeDim(baseNameId, dimIdx) as i32;
          let sid = this.visitLoc(ch);
          this.currentDimEnd = prevEnd;
          this.tempBuffer.push(sid);
        }
      } else if (locChildCount(ch) > 0) {
        this.collectSymbolicSubscripts(ch, baseNameId, subStart);
      }
      ch = locNextSibling(ch);
    }
  }

  castToReal(exprId: u32): u32 {
    if (exprId >= this.dae.exprCount) return exprId;
    let kind = this.dae.getExprKind(exprId);
    if (kind == ExprKind.IntLiteral) {
      let val = this.dae.getExprData1(exprId) as i32;
      return this.dae.addRealLiteral(val as f64);
    }
    if (kind == ExprKind.ArrayCtor) {
      let count = this.dae.getExprData1(exprId);
      if (count == 0) return exprId;
      let start = this.tempBuffer.length;
      for (let i: u32 = 0; i < count; i++) {
        this.tempBuffer.push(0);
      }
      for (let i: u32 = 0; i < count; i++) {
        this.tempBuffer.set(start + i, this.castToReal(getArrayCtorElement(this.dae, exprId, i)));
      }
      let res = addArrayCtorFromChunked(this.dae, this.tempBuffer, start, count);
      this.tempBuffer.length = start;
      return res;
    }
    if (kind == ExprKind.IfElse) {
      let cond = this.dae.getExprData1(exprId);
      let thenExpr = this.castToReal(this.dae.getExprLeft(exprId));
      let elseExpr = this.castToReal(this.dae.getExprRight(exprId));
      return this.dae.addIfElse(cond, thenExpr, elseExpr);
    }
    return exprId;
  }

  areExprsEqual(id1: u32, id2: u32): boolean {
    if (id1 == id2) return true;
    if (id1 >= this.dae.exprCount || id2 >= this.dae.exprCount) return false;
    let k1 = this.dae.getExprKind(id1);
    let k2 = this.dae.getExprKind(id2);
    if (k1 != k2) {
      if ((k1 == ExprKind.RealLiteral || k1 == ExprKind.IntLiteral) &&
          (k2 == ExprKind.RealLiteral || k2 == ExprKind.IntLiteral)) {
        let v1 = k1 == ExprKind.RealLiteral ? this.dae.getExprRealValue(id1) : ((this.dae.getExprData1(id1) as i32) as f64);
        let v2 = k2 == ExprKind.RealLiteral ? this.dae.getExprRealValue(id2) : ((this.dae.getExprData1(id2) as i32) as f64);
        return v1 == v2;
      }
      return false;
    }
    if (k1 == ExprKind.IntLiteral || k1 == ExprKind.BoolLiteral) {
      return this.dae.getExprData1(id1) == this.dae.getExprData1(id2);
    }
    if (k1 == ExprKind.RealLiteral) {
      return this.dae.getExprRealValue(id1) == this.dae.getExprRealValue(id2);
    }
    if (k1 == ExprKind.Name || k1 == ExprKind.StringLiteral) {
      return this.dae.getExprData1(id1) == this.dae.getExprData1(id2);
    }
    if (k1 == ExprKind.Unary || k1 == ExprKind.Negate || k1 == ExprKind.Der || k1 == ExprKind.Pre) {
      return this.dae.getExprData1(id1) == this.dae.getExprData1(id2) &&
        this.areExprsEqual(this.dae.getExprLeft(id1), this.dae.getExprLeft(id2));
    }
    if (k1 == ExprKind.Binary) {
      let op1 = this.dae.getExprData1(id1);
      let op2 = this.dae.getExprData1(id2);
      if (op1 != op2) return false;
      let l1 = this.dae.getExprLeft(id1);
      let r1 = this.dae.getExprRight(id1);
      let l2 = this.dae.getExprLeft(id2);
      let r2 = this.dae.getExprRight(id2);
      if (this.areExprsEqual(l1, l2) && this.areExprsEqual(r1, r2)) return true;
      if (op1 == (BinOp.Add as u32) || op1 == (BinOp.Mul as u32) ||
          op1 == (BinOp.ElemAdd as u32) || op1 == (BinOp.ElemMul as u32)) {
        return this.areExprsEqual(l1, r2) && this.areExprsEqual(r1, l2);
      }
      return false;
    }
    if (k1 == ExprKind.Call) {
      if (this.dae.getExprData1(id1) != this.dae.getExprData1(id2)) return false;
      let cnt1 = this.dae.getExprRight(id1);
      let cnt2 = this.dae.getExprRight(id2);
      if (cnt1 != cnt2) return false;
      for (let i: u32 = 0; i < cnt1; i++) {
        let a1 = i == 0 ? this.dae.getExprLeft(id1) : this.dae.getExprLeft(id1 + i);
        let a2 = i == 0 ? this.dae.getExprLeft(id2) : this.dae.getExprLeft(id2 + i);
        if (!this.areExprsEqual(a1, a2)) return false;
      }
      return true;
    }
    return false;
  }

  matrixPower(left: u32, powVal: i64): u32 {
    let N = this.dae.getExprData1(left);
    if (N == 0) return left;
    let firstRow = getArrayCtorElement(this.dae, left, 0);
    let M = this.dae.getExprData1(firstRow);
    if (N != M) return 0xffffffff;

    if (powVal == 0) {
      let rowsStart = this.tempBuffer.length;
      for (let i: u32 = 0; i < N; i++) {
        this.tempBuffer.push(0);
      }
      for (let i: u32 = 0; i < N; i++) {
        let colsStart = this.tempBuffer.length;
        for (let j: u32 = 0; j < N; j++) {
          this.tempBuffer.push(this.dae.addRealLiteral(i == j ? 1.0 : 0.0));
        }
        let rowId = addArrayCtorFromChunked(this.dae, this.tempBuffer, colsStart, N);
        this.tempBuffer.length = colsStart;
        this.tempBuffer.set(rowsStart + i, rowId);
      }
      let res = addArrayCtorFromChunked(this.dae, this.tempBuffer, rowsStart, N);
      this.tempBuffer.length = rowsStart;
      return res;
    }
    if (powVal == 1) {
      return left;
    }
    if (powVal == 2) {
      return this.matrixMul(left, left);
    }
    let cur = left;
    for (let p: i64 = 2; p <= powVal; p++) {
      cur = this.matrixMul(cur, left);
    }
    return cur;
  }

  matrixMul(left: u32, right: u32): u32 {
    let N = this.dae.getExprData1(left);
    if (N == 0) return 0xffffffff;
    let firstL = getArrayCtorElement(this.dae, left, 0);
    let K = this.dae.getExprData1(firstL);
    let rRows = this.dae.getExprData1(right);
    if (K != rRows || rRows == 0) return 0xffffffff;
    let firstR = getArrayCtorElement(this.dae, right, 0);
    let M = this.dae.getExprData1(firstR);

    let resRowsStart = this.tempBuffer.length;
    for (let i: u32 = 0; i < N; i++) {
      this.tempBuffer.push(0);
    }
    for (let i: u32 = 0; i < N; i++) {
      let lRowI = getArrayCtorElement(this.dae, left, i);
      let rowColsStart = this.tempBuffer.length;
      for (let j: u32 = 0; j < M; j++) {
        this.tempBuffer.push(0);
      }
      for (let j: u32 = 0; j < M; j++) {
        let sumExpr: u32 = 0xffffffff;
        for (let k: u32 = 0; k < K; k++) {
          let a_ik = getArrayCtorElement(this.dae, lRowI, k);
          let rRowK = getArrayCtorElement(this.dae, right, k);
          let b_kj = getArrayCtorElement(this.dae, rRowK, j);
          let term = this.lowerBinary(BinOp.Mul as u16, a_ik, b_kj);
          if (sumExpr == 0xffffffff) {
            sumExpr = term;
          } else {
            sumExpr = this.lowerBinary(BinOp.Add as u16, sumExpr, term);
          }
        }
        this.tempBuffer.set(rowColsStart + j, sumExpr != 0xffffffff ? sumExpr : this.dae.addRealLiteral(0.0));
      }
      let rowId = addArrayCtorFromChunked(this.dae, this.tempBuffer, rowColsStart, M);
      this.tempBuffer.length = rowColsStart;
      this.tempBuffer.set(resRowsStart + i, rowId);
    }
    let res = addArrayCtorFromChunked(this.dae, this.tempBuffer, resRowsStart, N);
    this.tempBuffer.length = resRowsStart;
    return res;
  }

  matrixVectorMul(left: u32, right: u32): u32 {
    let N = this.dae.getExprData1(left);
    let firstL = getArrayCtorElement(this.dae, left, 0);
    let K = this.dae.getExprData1(firstL);
    let rLen = this.dae.getExprData1(right);
    if (K != rLen || N == 0) return 0xffffffff;

    let resStart = this.tempBuffer.length;
    for (let i: u32 = 0; i < N; i++) {
      this.tempBuffer.push(0);
    }
    for (let i: u32 = 0; i < N; i++) {
      let lRowI = getArrayCtorElement(this.dae, left, i);
      let sumExpr: u32 = 0xffffffff;
      for (let k: u32 = 0; k < K; k++) {
        let a_ik = getArrayCtorElement(this.dae, lRowI, k);
        let b_k = getArrayCtorElement(this.dae, right, k);
        let term = this.lowerBinary(BinOp.Mul as u16, a_ik, b_k);
        if (sumExpr == 0xffffffff) {
          sumExpr = term;
        } else {
          sumExpr = this.lowerBinary(BinOp.Add as u16, sumExpr, term);
        }
      }
      this.tempBuffer.set(resStart + i, sumExpr != 0xffffffff ? sumExpr : this.dae.addRealLiteral(0.0));
    }
    let res = addArrayCtorFromChunked(this.dae, this.tempBuffer, resStart, N);
    this.tempBuffer.length = resStart;
    return res;
  }

  vectorMatrixMul(left: u32, right: u32): u32 {
    let K = this.dae.getExprData1(left);
    let rRows = this.dae.getExprData1(right);
    if (K != rRows || K == 0) return 0xffffffff;
    let firstR = getArrayCtorElement(this.dae, right, 0);
    let M = this.dae.getExprData1(firstR);

    let resStart = this.tempBuffer.length;
    for (let j: u32 = 0; j < M; j++) {
      this.tempBuffer.push(0);
    }
    for (let j: u32 = 0; j < M; j++) {
      let sumExpr: u32 = 0xffffffff;
      for (let k: u32 = 0; k < K; k++) {
        let a_k = getArrayCtorElement(this.dae, left, k);
        let rRowK = getArrayCtorElement(this.dae, right, k);
        let b_kj = getArrayCtorElement(this.dae, rRowK, j);
        let term = this.lowerBinary(BinOp.Mul as u16, a_k, b_kj);
        if (sumExpr == 0xffffffff) {
          sumExpr = term;
        } else {
          sumExpr = this.lowerBinary(BinOp.Add as u16, sumExpr, term);
        }
      }
      this.tempBuffer.set(resStart + j, sumExpr != 0xffffffff ? sumExpr : this.dae.addRealLiteral(0.0));
    }
    let res = addArrayCtorFromChunked(this.dae, this.tempBuffer, resStart, M);
    this.tempBuffer.length = resStart;
    return res;
  }

  vectorDotMul(left: u32, right: u32): u32 {
    let K = this.dae.getExprData1(left);
    let rLen = this.dae.getExprData1(right);
    if (K != rLen || K == 0) return 0xffffffff;

    let sumExpr: u32 = 0xffffffff;
    for (let k: u32 = 0; k < K; k++) {
      let a_k = getArrayCtorElement(this.dae, left, k);
      let b_k = getArrayCtorElement(this.dae, right, k);
      let term = this.lowerBinary(BinOp.Mul as u16, a_k, b_k);
      if (sumExpr == 0xffffffff) {
        sumExpr = term;
      } else {
        sumExpr = this.lowerBinary(BinOp.Add as u16, sumExpr, term);
      }
    }
    return sumExpr != 0xffffffff ? sumExpr : this.dae.addRealLiteral(0.0);
  }

  lowerBinary(op: u16, left: u32, right: u32): u32 {
    let baseOp = op;
    if (op == (BinOp.ElemAdd as u16)) baseOp = BinOp.Add as u16;
    else if (op == (BinOp.ElemSub as u16)) baseOp = BinOp.Sub as u16;
    else if (op == (BinOp.ElemMul as u16)) baseOp = BinOp.Mul as u16;
    else if (op == (BinOp.ElemDiv as u16)) baseOp = BinOp.Div as u16;
    else if (op == (BinOp.ElemPow as u16)) baseOp = BinOp.Pow as u16;

    if (this.dae.getExprKind(left) == ExprKind.Name) {
      left = resolveVarToArrayCtor(this.dae, this.dae.getStringPool(), left, this.tempBuffer);
    }
    if (this.dae.getExprKind(right) == ExprKind.Name) {
      right = resolveVarToArrayCtor(this.dae, this.dae.getStringPool(), right, this.tempBuffer);
    }

    let kLeft = this.dae.getExprKind(left);
    let kRight = this.dae.getExprKind(right);

    if (baseOp == (BinOp.And as u16) || baseOp == (BinOp.Or as u16)) {
      return this.dae.addBinaryExpr(baseOp, left, right);
    }

    // Matrix power: M ^ n (Modelica MLS §7.6)
    if (op == (BinOp.Pow as u16) && isRank2ArrayCtor(this.dae, left)) {
      let powVal: i64 = -1;
      if (kRight == ExprKind.IntLiteral) {
        powVal = <i64>this.dae.getExprData1(right);
      } else if (kRight == ExprKind.RealLiteral) {
        let rv = this.dae.getExprRealValue(right);
        if (rv == Math.floor(rv)) {
          powVal = <i64>rv;
        }
      }
      if (powVal >= 0) {
        return this.matrixPower(left, powVal);
      }
    }

    // Matrix / Vector multiplication: A * B (Modelica MLS §7.6)
    if (op == (BinOp.Mul as u16)) {
      let lIsM = isRank2ArrayCtor(this.dae, left);
      let lIsV = !lIsM && (kLeft == ExprKind.ArrayCtor);
      let rIsM = isRank2ArrayCtor(this.dae, right);
      let rIsV = !rIsM && (kRight == ExprKind.ArrayCtor);

      if (lIsM && rIsM) {
        return this.matrixMul(left, right);
      } else if (lIsM && rIsV) {
        return this.matrixVectorMul(left, right);
      } else if (lIsV && rIsM) {
        return this.vectorMatrixMul(left, right);
      } else if (lIsV && rIsV) {
        return this.vectorDotMul(left, right);
      }
    }

    // Vector broadcasting: ArrayCtor with ArrayCtor or scalar with ArrayCtor
    if (kLeft == ExprKind.ArrayCtor && kRight == ExprKind.ArrayCtor) {
      let countLeft = this.dae.getExprData1(left);
      let countRight = this.dae.getExprData1(right);
      if (countLeft == countRight && countLeft > 0) {
        let start = this.tempBuffer.length;
        for (let i: u32 = 0; i < countLeft; i++) {
          this.tempBuffer.push(0);
        }
        for (let i: u32 = 0; i < countLeft; i++) {
          this.tempBuffer.set(start + i, this.lowerBinary(baseOp, getArrayCtorElement(this.dae, left, i), getArrayCtorElement(this.dae, right, i)));
        }
        let res = addArrayCtorFromChunked(this.dae, this.tempBuffer, start, countLeft);
        this.tempBuffer.length = start;
        return res;
      }
    } else if (kLeft == ExprKind.ArrayCtor && kRight != ExprKind.ArrayCtor) {
      let countLeft = this.dae.getExprData1(left);
      if (countLeft > 0) {
        let start = this.tempBuffer.length;
        for (let i: u32 = 0; i < countLeft; i++) {
          this.tempBuffer.push(0);
        }
        for (let i: u32 = 0; i < countLeft; i++) {
          this.tempBuffer.set(start + i, this.lowerBinary(baseOp, getArrayCtorElement(this.dae, left, i), right));
        }
        let res = addArrayCtorFromChunked(this.dae, this.tempBuffer, start, countLeft);
        this.tempBuffer.length = start;
        return res;
      }
    } else if (kLeft != ExprKind.ArrayCtor && kRight == ExprKind.ArrayCtor) {
      let countRight = this.dae.getExprData1(right);
      if (countRight > 0) {
        let start = this.tempBuffer.length;
        for (let i: u32 = 0; i < countRight; i++) {
          this.tempBuffer.push(0);
        }
        for (let i: u32 = 0; i < countRight; i++) {
          this.tempBuffer.set(start + i, this.lowerBinary(baseOp, left, getArrayCtorElement(this.dae, right, i)));
        }
        let res = addArrayCtorFromChunked(this.dae, this.tempBuffer, start, countRight);
        this.tempBuffer.length = start;
        return res;
      }
    }

    // In Modelica MLS §3.4, division and power are always Real operations!
    if (baseOp == (BinOp.Div as u16) || baseOp == (BinOp.Pow as u16)) {
      if (baseOp == (BinOp.Pow as u16) && kLeft == ExprKind.Binary && (this.dae.getExprData1(left) as u16) == (BinOp.Pow as u16)) {
        return 0xffffffff;
      }
      if (!this.isRealExpr(left)) {
        left = this.castToReal(left);
        kLeft = this.dae.getExprKind(left);
      }
      if (!this.isRealExpr(right)) {
        right = this.castToReal(right);
        kRight = this.dae.getExprKind(right);
      }
    } else {
      // General Integer -> Real promotion
      if (this.isRealExpr(left) && !this.isRealExpr(right)) {
        right = this.castToReal(right);
        kRight = this.dae.getExprKind(right);
      } else if (!this.isRealExpr(left) && this.isRealExpr(right)) {
        left = this.castToReal(left);
        kLeft = this.dae.getExprKind(left);
      }
    }

    // Simplify trigonometric ratios: sin(expr) / cos(expr) -> tan(expr)
    if (baseOp == (BinOp.Div as u16)) {
      if (kLeft == ExprKind.Call && kRight == ExprKind.Call) {
        let leftFnId = this.dae.getExprData1(left);
        let rightFnId = this.dae.getExprData1(right);
        let pool = this.dae.getStringPool();
        if (poolMatchesSimple(pool, leftFnId, "sin") && poolMatchesSimple(pool, rightFnId, "cos")) {
          let leftArg = this.dae.getExprLeft(left);
          let rightArg = this.dae.getExprLeft(right);
          let leftArgCount = this.dae.getExprRight(left);
          let rightArgCount = this.dae.getExprRight(right);
          if (leftArgCount == 1 && rightArgCount == 1 && (leftArg == rightArg || this.areExprsEqual(leftArg, rightArg))) {
            let tanId = internStaticString(pool, "tan");
            return this.dae.addExpression(ExprKind.Call, tanId, leftArg, 1);
          }
        }
      }
    }

    // Constant folding
    if (kLeft == ExprKind.RealLiteral && kRight == ExprKind.RealLiteral) {
      let v1 = this.dae.getExprRealValue(left);
      let v2 = this.dae.getExprRealValue(right);
      if (baseOp == (BinOp.Add as u16)) return this.dae.addRealLiteral(v1 + v2);
      if (baseOp == (BinOp.Sub as u16)) return this.dae.addRealLiteral(v1 - v2);
      if (baseOp == (BinOp.Mul as u16)) return this.dae.addRealLiteral(v1 * v2);
      if (baseOp == (BinOp.Div as u16)) {
        if (v2 != 0.0) return this.dae.addRealLiteral(v1 / v2);
      }
      if (baseOp == (BinOp.Pow as u16)) {
        if (v1 < 0.0 && Math.floor(v2) != v2) return 0xffffffff;
        return this.dae.addRealLiteral(Math.pow(v1, v2));
      }
      if (baseOp == (BinOp.Lt as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, v1 < v2 ? 1 : 0);
      if (baseOp == (BinOp.Lte as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, v1 <= v2 ? 1 : 0);
      if (baseOp == (BinOp.Gt as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, v1 > v2 ? 1 : 0);
      if (baseOp == (BinOp.Gte as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, v1 >= v2 ? 1 : 0);
      if (baseOp == (BinOp.Eq as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, v1 == v2 ? 1 : 0);
      if (baseOp == (BinOp.Neq as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, v1 != v2 ? 1 : 0);
    } else if (kLeft == ExprKind.IntLiteral && kRight == ExprKind.IntLiteral) {
      let v1 = this.dae.getExprData1(left) as i32;
      let v2 = this.dae.getExprData1(right) as i32;
      if (baseOp == (BinOp.Add as u16)) return this.dae.addIntLiteral(v1 + v2);
      if (baseOp == (BinOp.Sub as u16)) return this.dae.addIntLiteral(v1 - v2);
      if (baseOp == (BinOp.Mul as u16)) return this.dae.addIntLiteral(v1 * v2);
      if (baseOp == (BinOp.Div as u16)) {
        if (v2 != 0) return this.dae.addRealLiteral((v1 as f64) / (v2 as f64));
      }
      if (baseOp == (BinOp.Pow as u16)) {
        let f1 = v1 as f64;
        let f2 = v2 as f64;
        if (f1 < 0.0 && Math.floor(f2) != f2) return 0xffffffff;
        return this.dae.addRealLiteral(Math.pow(f1, f2));
      }
      if (baseOp == (BinOp.Lt as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, v1 < v2 ? 1 : 0);
      if (baseOp == (BinOp.Lte as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, v1 <= v2 ? 1 : 0);
      if (baseOp == (BinOp.Gt as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, v1 > v2 ? 1 : 0);
      if (baseOp == (BinOp.Gte as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, v1 >= v2 ? 1 : 0);
      if (baseOp == (BinOp.Eq as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, v1 == v2 ? 1 : 0);
      if (baseOp == (BinOp.Neq as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, v1 != v2 ? 1 : 0);
    } else if (kLeft == ExprKind.BoolLiteral && kRight == ExprKind.BoolLiteral) {
      let v1 = this.dae.getExprData1(left) != 0;
      let v2 = this.dae.getExprData1(right) != 0;
      if (baseOp == (BinOp.And as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, (v1 && v2) ? 1 : 0);
      if (baseOp == (BinOp.Or as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, (v1 || v2) ? 1 : 0);
      if (baseOp == (BinOp.Eq as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, v1 == v2 ? 1 : 0);
      if (baseOp == (BinOp.Neq as u16)) return this.dae.addExpression(ExprKind.BoolLiteral, v1 != v2 ? 1 : 0);
    }

    return this.dae.addBinaryExpr(baseOp, left, right);
  }

  lowerUnary(op: u16, operand: u32): u32 {
    let k = this.dae.getExprKind(operand);
    if (op == (UnaryOp.Negate as u16)) {
      if (k == ExprKind.Negate) {
        return this.dae.getExprLeft(operand);
      }
      if (k == ExprKind.Unary && (this.dae.getExprData1(operand) as u16) == (UnaryOp.Negate as u16)) {
        return this.dae.getExprLeft(operand);
      }
    }
    if (k == ExprKind.RealLiteral && op == (UnaryOp.Negate as u16)) {
      let val = this.dae.getExprRealValue(operand);
      return this.dae.addRealLiteral(-val);
    }
    if (k == ExprKind.IntLiteral && op == (UnaryOp.Negate as u16)) {
      let val = this.dae.getExprData1(operand) as i32;
      return this.dae.addIntLiteral(-val);
    }
    if (k == ExprKind.BoolLiteral && op == (UnaryOp.Not as u16)) {
      let val = this.dae.getExprData1(operand) != 0;
      return this.dae.addExpression(ExprKind.BoolLiteral, val ? 0 : 1);
    }
    if (k == ExprKind.Name) {
      operand = resolveVarToArrayCtor(this.dae, this.dae.getStringPool(), operand, this.tempBuffer);
      k = this.dae.getExprKind(operand);
    }
    if (k == ExprKind.ArrayCtor && op == (UnaryOp.Negate as u16)) {
      let count = this.dae.getExprData1(operand);
      if (count > 0) {
        let start = this.tempBuffer.length;
        for (let i: u32 = 0; i < count; i++) {
          this.tempBuffer.push(0);
        }
        for (let i: u32 = 0; i < count; i++) {
          this.tempBuffer.set(start + i, this.lowerUnary(op, getArrayCtorElement(this.dae, operand, i)));
        }
        let res = addArrayCtorFromChunked(this.dae, this.tempBuffer, start, count);
        this.tempBuffer.length = start;
        return res;
      }
    }
    if (op == (UnaryOp.Negate as u16) && k == ExprKind.Binary) {
      let binOp = this.dae.getExprData1(operand) as u32;
      if (binOp == (BinOp.Mul as u32)) {
        let a = this.dae.getExprLeft(operand);
        let b = this.dae.getExprRight(operand);
        let negA = this.lowerUnary(UnaryOp.Negate as u16, a);
        return this.lowerBinary(BinOp.Mul as u16, negA, b);
      }
      if (binOp == (BinOp.Div as u32)) {
        let a = this.dae.getExprLeft(operand);
        let b = this.dae.getExprRight(operand);
        let negA = this.lowerUnary(UnaryOp.Negate as u16, a);
        return this.lowerBinary(BinOp.Div as u16, negA, b);
      }
    }
    return this.dae.addExpression(ExprKind.Unary, op as u32, operand);
  }

  catArrays(catDim: u32, argsStart: u32, numArrs: u32): u32 {
    let pool = this.dae.getStringPool();
    let arrsStart = this.scratchBuffer.length;
    for (let i: u32 = 0; i < numArrs; i++) {
      let aid = this.tempBuffer.get(argsStart + i);
      aid = resolveVarToArrayCtor(this.dae, pool, aid, this.scratchBuffer);
      this.scratchBuffer.push(aid);
    }
    let resultId = this.catRecursive(catDim, arrsStart, numArrs);
    this.scratchBuffer.length = arrsStart;
    return resultId;
  }

  catRecursive(dim: u32, arrsStart: u32, numArrs: u32): u32 {
    if (numArrs == 0) return 0xffffffff;
    if (numArrs == 1 && dim > 1) {
      return this.scratchBuffer.get(arrsStart);
    }
    if (dim == 1) {
      let resStart = this.tempBuffer.length;
      for (let i: u32 = 0; i < numArrs; i++) {
        let aid = this.scratchBuffer.get(arrsStart + i);
        if (this.dae.getExprKind(aid) == ExprKind.ArrayCtor) {
          let count = this.dae.getExprData1(aid);
          for (let c: u32 = 0; c < count; c++) {
            this.tempBuffer.push(getArrayCtorElement(this.dae, aid, c));
          }
        } else {
          this.tempBuffer.push(aid);
        }
      }
      let totalCount = this.tempBuffer.length - resStart;
      let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, resStart, totalCount);
      this.tempBuffer.length = resStart;
      return ctorId;
    }

    let firstArr = this.scratchBuffer.get(arrsStart);
    if (this.dae.getExprKind(firstArr) != ExprKind.ArrayCtor) return 0xffffffff;
    let outerLen = this.dae.getExprData1(firstArr);
    for (let i: u32 = 1; i < numArrs; i++) {
      let aid = this.scratchBuffer.get(arrsStart + i);
      if (this.dae.getExprKind(aid) != ExprKind.ArrayCtor) return 0xffffffff;
      if (this.dae.getExprData1(aid) != outerLen) return 0xffffffff;
    }

    let resStart = this.tempBuffer.length;
    for (let i: u32 = 0; i < outerLen; i++) {
      let sliceStart = this.scratchBuffer.length;
      for (let a: u32 = 0; a < numArrs; a++) {
        let aid = this.scratchBuffer.get(arrsStart + a);
        let subElem = getArrayCtorElement(this.dae, aid, i);
        this.scratchBuffer.push(subElem);
      }
      let subCtorId = this.catRecursive(dim - 1, sliceStart, numArrs);
      this.scratchBuffer.length = sliceStart;
      if (subCtorId == 0xffffffff) {
        this.tempBuffer.length = resStart;
        return 0xffffffff;
      }
      this.tempBuffer.push(subCtorId);
    }
    let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, resStart, outerLen);
    this.tempBuffer.length = resStart;
    return ctorId;
  }

  collectArrayElements(argLoc: u64, out: ChunkedUint32Array): void {
    let ch = locFirstChild(argLoc);
    while (!locIsNull(ch)) {
      let len = locLen(ch);
      if (len > 0) {
        let ct = locType(ch);
        if (ct == SyntaxType.EXPRESSION) {
          let eid = this.visitLoc(ch);
          if (eid != 0xffffffff) out.push(eid);
        } else if (ct == SyntaxType.ARRAY_ARGUMENTS || ct == SyntaxType.ARRAY_ARGUMENTS_NON_FIRST) {
          this.collectArrayElements(ch, out);
        } else if (locChildCount(ch) > 0) {
          this.collectArrayElements(ch, out);
        }
      }
      ch = locNextSibling(ch);
    }
  }

  collectRowElements(rowLoc: u64, out: ChunkedUint32Array): void {
    let ch = locFirstChild(rowLoc);
    while (!locIsNull(ch)) {
      let len = locLen(ch);
      if (len > 0) {
        let ct = locType(ch);
        if (ct == SyntaxType.EXPRESSION) {
          let eid = this.visitLoc(ch);
          if (eid != 0xffffffff) out.push(eid);
        } else if (locChildCount(ch) > 0 && !locMatches(ch, ",")) {
          this.collectRowElements(ch, out);
        }
      }
      ch = locNextSibling(ch);
    }
  }

  collectMatrixRows(matLoc: u64, rowOut: ChunkedUint32Array): void {
    let matStart = rowOut.length;
    let rowsAdded: u32 = 0;
    let ch = locFirstChild(matLoc);
    while (!locIsNull(ch)) {
      let len = locLen(ch);
      if (len > 0) {
        let ct = locType(ch);
        if (ct == SyntaxType.EXPRESSION_LIST) {
          let itemStart = this.scratchBuffer.length;
          this.collectRowElements(ch, this.scratchBuffer);
          let itemCount = this.scratchBuffer.length - itemStart;

          let pool = this.dae.getStringPool();
          for (let i: u32 = 0; i < itemCount; i++) {
            let itemEid = this.scratchBuffer.get(itemStart + i);
            itemEid = resolveVarToArrayCtor(this.dae, pool, itemEid, this.scratchBuffer);
            this.scratchBuffer.set(itemStart + i, itemEid);
          }

          let maxRows: u32 = 1;
          let any2D: bool = false;
          for (let i: u32 = 0; i < itemCount; i++) {
            let item = this.scratchBuffer.get(itemStart + i);
            if (this.dae.getExprKind(item) == ExprKind.ArrayCtor) {
              let cnt = getArrayCtorCount(this.dae, item);
              if (cnt > 0 && this.dae.getExprKind(getArrayCtorElement(this.dae, item, 0)) == ExprKind.ArrayCtor) {
                any2D = true;
                if (cnt > maxRows) maxRows = cnt;
              }
            }
          }

          if (itemCount == 1 && !any2D) {
            let singleEid = this.scratchBuffer.get(itemStart);
            if (this.dae.getExprKind(singleEid) == ExprKind.ArrayCtor) {
              let eCount = getArrayCtorCount(this.dae, singleEid);
              let hasSemicolon = false;
              let sib = locNextSibling(ch);
              while (!locIsNull(sib)) {
                if (locMatches(sib, ";")) { hasSemicolon = true; break; }
                sib = locNextSibling(sib);
              }
              if (!hasSemicolon && rowsAdded == 0) {
                this.scratchBuffer.length = itemStart;
                for (let i: u32 = 0; i < eCount; i++) {
                  let elem = getArrayCtorElement(this.dae, singleEid, i);
                  let rStart = this.scratchBuffer.length;
                  this.scratchBuffer.push(elem);
                  let rowCtorId = addArrayCtorFromChunked(this.dae, this.scratchBuffer, rStart, 1);
                  this.scratchBuffer.length = rStart;
                  rowOut.push(rowCtorId);
                  rowsAdded++;
                }
                ch = locNextSibling(ch);
                continue;
              } else {
                this.scratchBuffer.length = itemStart;
                rowOut.push(singleEid);
                rowsAdded++;
                ch = locNextSibling(ch);
                continue;
              }
            }
          }

          if (any2D) {
            for (let r: u32 = 0; r < maxRows; r++) {
              let rowElementsStart = this.scratchBuffer.length;
              for (let k: u32 = 0; k < itemCount; k++) {
                let item = this.scratchBuffer.get(itemStart + k);
                if (this.dae.getExprKind(item) == ExprKind.ArrayCtor) {
                  let cnt = getArrayCtorCount(this.dae, item);
                  let isSub2D = cnt > 0 && this.dae.getExprKind(getArrayCtorElement(this.dae, item, 0)) == ExprKind.ArrayCtor;
                  if (isSub2D) {
                    let subRowIdx = r < cnt ? r : (cnt == 1 ? 0 : r);
                    let subRowCtor = getArrayCtorElement(this.dae, item, subRowIdx);
                    let subColCount = getArrayCtorCount(this.dae, subRowCtor);
                    for (let c: u32 = 0; c < subColCount; c++) {
                      let colElem = getArrayCtorElement(this.dae, subRowCtor, c);
                      this.scratchBuffer.push(colElem);
                    }
                  } else {
                    for (let c: u32 = 0; c < cnt; c++) {
                      let colElem = getArrayCtorElement(this.dae, item, c);
                      this.scratchBuffer.push(colElem);
                    }
                  }
                } else {
                  this.scratchBuffer.push(item);
                }
              }
              let rowElemCount = this.scratchBuffer.length - rowElementsStart;
              let hasReal = false;
              for (let c: u32 = 0; c < rowElemCount; c++) {
                if (this.isRealExpr(this.scratchBuffer.get(rowElementsStart + c))) {
                  hasReal = true;
                  break;
                }
              }
              if (hasReal) {
                for (let c: u32 = 0; c < rowElemCount; c++) {
                  let eid = this.scratchBuffer.get(rowElementsStart + c);
                  if (!this.isRealExpr(eid)) {
                    this.scratchBuffer.set(rowElementsStart + c, this.castToReal(eid));
                  }
                }
              }
              let rowCtorId = addArrayCtorFromChunked(this.dae, this.scratchBuffer, rowElementsStart, rowElemCount);
              this.scratchBuffer.length = rowElementsStart;
              rowOut.push(rowCtorId);
              rowsAdded++;
            }
            this.scratchBuffer.length = itemStart;
            ch = locNextSibling(ch);
            continue;
          }

          if (itemCount > 0) {
            let hasReal = false;
            for (let i: u32 = 0; i < itemCount; i++) {
              if (this.isRealExpr(this.scratchBuffer.get(itemStart + i))) {
                hasReal = true;
                break;
              }
            }
            if (hasReal) {
              for (let i: u32 = 0; i < itemCount; i++) {
                let eid = this.scratchBuffer.get(itemStart + i);
                if (!this.isRealExpr(eid)) {
                  this.scratchBuffer.set(itemStart + i, this.castToReal(eid));
                }
              }
            }
            let rowCtorId = addArrayCtorFromChunked(this.dae, this.scratchBuffer, itemStart, itemCount);
            this.scratchBuffer.length = itemStart;
            rowOut.push(rowCtorId);
            rowsAdded++;
          }
        } else if (ct == SyntaxType.EXPRESSION) {
          let eid = this.visitLoc(ch);
          if (eid != 0xffffffff) {
            let pool = this.dae.getStringPool();
            eid = resolveVarToArrayCtor(this.dae, pool, eid, this.scratchBuffer);
            if (this.dae.getExprKind(eid) == ExprKind.ArrayCtor) {
              let eCount = getArrayCtorCount(this.dae, eid);
              let is1D = true;
              if (eCount > 0 && this.dae.getExprKind(getArrayCtorElement(this.dae, eid, 0)) == ExprKind.ArrayCtor) {
                is1D = false;
              }
              if (!is1D) {
                for (let i: u32 = 0; i < eCount; i++) {
                  let rowCtor = getArrayCtorElement(this.dae, eid, i);
                  rowOut.push(rowCtor);
                  rowsAdded++;
                }
                ch = locNextSibling(ch);
                continue;
              }
              if (is1D) {
                for (let i: u32 = 0; i < eCount; i++) {
                  let elem = getArrayCtorElement(this.dae, eid, i);
                  let rStart = this.scratchBuffer.length;
                  this.scratchBuffer.push(elem);
                  let rowCtorId = addArrayCtorFromChunked(this.dae, this.scratchBuffer, rStart, 1);
                  this.scratchBuffer.length = rStart;
                  rowOut.push(rowCtorId);
                  rowsAdded++;
                }
                ch = locNextSibling(ch);
                continue;
              }
            }
            let rowStart = this.scratchBuffer.length;
            this.scratchBuffer.push(eid);
            let rowCtorId = addArrayCtorFromChunked(this.dae, this.scratchBuffer, rowStart, 1);
            this.scratchBuffer.length = rowStart;
            rowOut.push(rowCtorId);
            rowsAdded++;
          }
        } else if (locChildCount(ch) > 0 && !locMatches(ch, ";") && !locMatches(ch, "[") && !locMatches(ch, "]")) {
          this.collectMatrixRows(ch, rowOut);
        }
      }
      ch = locNextSibling(ch);
    }
  }

  collectFunctionArguments(argLoc: u64, out: ChunkedUint32Array): void {
    let ch = locFirstChild(argLoc);
    while (!locIsNull(ch)) {
      let len = locLen(ch);
      if (len > 0) {
        let ct = locType(ch);
        if (ct == SyntaxType.EXPRESSION || ct == SyntaxType.FUNCTION_ARGUMENT) {
          let exprLoc = ct == SyntaxType.EXPRESSION ? ch : locFindChild(ch, SyntaxType.EXPRESSION);
          if (locIsNull(exprLoc)) exprLoc = ch;
          let eid = this.visitLoc(exprLoc);
          if (eid != 0xffffffff) out.push(eid);
        } else if (ct == SyntaxType.FUNCTION_ARGUMENTS || ct == SyntaxType.FUNCTION_ARGUMENTS_NON_FIRST) {
          this.collectFunctionArguments(ch, out);
        } else if (locChildCount(ch) > 0 && !locMatches(ch, "(") && !locMatches(ch, ")") && !locMatches(ch, ",")) {
          this.collectFunctionArguments(ch, out);
        }
      }
      ch = locNextSibling(ch);
    }
  }

  lowerFunctionCall(fnNameId: u32, argStart: u32, argCount: u32): u32 {
    let pool = this.dae.getStringPool();

    // 1. Vectorization if any arg is ArrayCtor and function is scalar vectorizable
    let hasArrayArg = false;
    let arrayLen: u32 = 0;
    for (let i: u32 = 0; i < argCount; i++) {
      let aid = this.tempBuffer.get(argStart + i);
      if (this.dae.getExprKind(aid) == ExprKind.ArrayCtor) {
        hasArrayArg = true;
        let c = this.dae.getExprData1(aid);
        if (arrayLen == 0 || c == arrayLen) arrayLen = c;
      }
    }
    if (hasArrayArg && arrayLen > 0) {
      if (poolMatchesSimple(pool, fnNameId, "sin") || poolMatchesSimple(pool, fnNameId, "cos") ||
          poolMatchesSimple(pool, fnNameId, "tan") || poolMatchesSimple(pool, fnNameId, "asin") ||
          poolMatchesSimple(pool, fnNameId, "acos") || poolMatchesSimple(pool, fnNameId, "atan") ||
          poolMatchesSimple(pool, fnNameId, "atan2") || poolMatchesSimple(pool, fnNameId, "sinh") ||
          poolMatchesSimple(pool, fnNameId, "cosh") || poolMatchesSimple(pool, fnNameId, "tanh") ||
          poolMatchesSimple(pool, fnNameId, "exp") || poolMatchesSimple(pool, fnNameId, "log") ||
          poolMatchesSimple(pool, fnNameId, "log10") || poolMatchesSimple(pool, fnNameId, "sqrt") ||
          poolMatchesSimple(pool, fnNameId, "abs") || poolMatchesSimple(pool, fnNameId, "sign") ||
          poolMatchesSimple(pool, fnNameId, "floor") || poolMatchesSimple(pool, fnNameId, "ceil") ||
          poolMatchesSimple(pool, fnNameId, "div") || poolMatchesSimple(pool, fnNameId, "mod") ||
          poolMatchesSimple(pool, fnNameId, "rem")) {
        let vecStart = this.tempBuffer.length;
        for (let elemIdx: u32 = 0; elemIdx < arrayLen; elemIdx++) {
          let callArgStart = this.tempBuffer.length;
          for (let a: u32 = 0; a < argCount; a++) {
            let aid = this.tempBuffer.get(argStart + a);
            if (this.dae.getExprKind(aid) == ExprKind.ArrayCtor) {
              this.tempBuffer.push(getArrayCtorElement(this.dae, aid, elemIdx));
            } else {
              this.tempBuffer.push(aid);
            }
          }
          let res = this.lowerFunctionCall(fnNameId, callArgStart, argCount);
          this.tempBuffer.length = callArgStart;
          this.tempBuffer.push(res);
        }
        let vecCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, vecStart, arrayLen);
        this.tempBuffer.length = vecStart;
        return vecCtorId;
      }
    }

    // 2. Math & Reduction functions (arity 1)
    if (argCount == 1) {
      let a0 = this.tempBuffer.get(argStart);
      if (this.dae.getExprKind(a0) == ExprKind.ArrayCtor) {
        let isSum = poolMatchesSimple(pool, fnNameId, "sum") || poolMatchesSimple(pool, fnNameId, ".sum");
        let isProd = poolMatchesSimple(pool, fnNameId, "product") || poolMatchesSimple(pool, fnNameId, ".product");
        let isMin = poolMatchesSimple(pool, fnNameId, "min") || poolMatchesSimple(pool, fnNameId, ".min");
        let isMax = poolMatchesSimple(pool, fnNameId, "max") || poolMatchesSimple(pool, fnNameId, ".max");
        if (isSum || isProd || isMin || isMax) {
          let leafStart = this.tempBuffer.length;
          collectAllArrayCtorLeaves(this.dae, a0, this.tempBuffer);
          let leafCount = this.tempBuffer.length - leafStart;
          if (leafCount == 0) {
            this.tempBuffer.length = leafStart;
            if (isSum) return this.dae.addRealLiteral(0.0);
            if (isProd) return this.dae.addRealLiteral(1.0);
            return 0xffffffff;
          }
          let acc = this.tempBuffer.get(leafStart);
          if (isSum) {
            for (let i: u32 = 1; i < leafCount; i++) {
              acc = this.lowerBinary(BinOp.Add as u16, acc, this.tempBuffer.get(leafStart + i));
            }
          } else if (isProd) {
            for (let i: u32 = 1; i < leafCount; i++) {
              acc = this.lowerBinary(BinOp.Mul as u16, acc, this.tempBuffer.get(leafStart + i));
            }
          } else if (isMin || isMax) {
            let kFirst = this.dae.getExprKind(acc);
            if (kFirst != ExprKind.RealLiteral && kFirst != ExprKind.IntLiteral) {
              this.tempBuffer.length = leafStart;
              return 0xffffffff;
            }
            for (let i: u32 = 1; i < leafCount; i++) {
              let elem = this.tempBuffer.get(leafStart + i);
              let kAcc = this.dae.getExprKind(acc);
              let kElem = this.dae.getExprKind(elem);
              if (kAcc == ExprKind.IntLiteral && kElem == ExprKind.IntLiteral) {
                let iAcc = this.dae.getExprData1(acc) as i32;
                let iElem = this.dae.getExprData1(elem) as i32;
                let resInt = isMin ? (iAcc < iElem ? iAcc : iElem) : (iAcc > iElem ? iAcc : iElem);
                acc = this.dae.addIntLiteral(resInt);
              } else if ((kAcc == ExprKind.RealLiteral || kAcc == ExprKind.IntLiteral) &&
                  (kElem == ExprKind.RealLiteral || kElem == ExprKind.IntLiteral)) {
                let vAcc = kAcc == ExprKind.RealLiteral ? this.dae.getExprRealValue(acc) : ((this.dae.getExprData1(acc) as i32) as f64);
                let vElem = kElem == ExprKind.RealLiteral ? this.dae.getExprRealValue(elem) : ((this.dae.getExprData1(elem) as i32) as f64);
                let resVal = isMin ? (vAcc < vElem ? vAcc : vElem) : (vAcc > vElem ? vAcc : vElem);
                acc = this.dae.addRealLiteral(resVal);
              } else {
                this.tempBuffer.length = leafStart;
                return 0xffffffff;
              }
            }
          }
          this.tempBuffer.length = leafStart;
          return acc;
        }
      }

      let k0 = this.dae.getExprKind(a0);
      let isLit = (k0 == ExprKind.RealLiteral || k0 == ExprKind.IntLiteral);
      let v0: f64 = 0.0;
      if (k0 == ExprKind.RealLiteral) v0 = this.dae.getExprRealValue(a0);
      else if (k0 == ExprKind.IntLiteral) v0 = (this.dae.getExprData1(a0) as i32) as f64;

      if (poolMatchesSimple(pool, fnNameId, "sin")) {
        if (isLit) return this.dae.addRealLiteral(Math.sin(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "cos")) {
        if (isLit) return this.dae.addRealLiteral(Math.cos(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "tan")) {
        if (isLit) return this.dae.addRealLiteral(Math.tan(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "asin")) {
        if (isLit) return this.dae.addRealLiteral(Math.asin(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "acos")) {
        if (isLit) return this.dae.addRealLiteral(Math.acos(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "atan")) {
        if (isLit) return this.dae.addRealLiteral(Math.atan(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "sinh")) {
        if (isLit) return this.dae.addRealLiteral(Math.sinh(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "cosh")) {
        if (isLit) return this.dae.addRealLiteral(Math.cosh(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "tanh")) {
        if (isLit) return this.dae.addRealLiteral(Math.tanh(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "exp")) {
        if (isLit) return this.dae.addRealLiteral(Math.exp(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "log")) {
        if (isLit) return this.dae.addRealLiteral(Math.log(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "log10")) {
        if (isLit) return this.dae.addRealLiteral(Math.log10(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "sqrt")) {
        if (isLit) return this.dae.addRealLiteral(Math.sqrt(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "abs")) {
        if (k0 == ExprKind.IntLiteral) {
          let iv = this.dae.getExprData1(a0) as i32;
          return this.dae.addIntLiteral(iv >= 0 ? iv : -iv);
        }
        if (k0 == ExprKind.RealLiteral) return this.dae.addRealLiteral(Math.abs(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "sign")) {
        if (k0 == ExprKind.IntLiteral) {
          let iv = this.dae.getExprData1(a0) as i32;
          return this.dae.addIntLiteral(iv > 0 ? 1 : (iv < 0 ? -1 : 0));
        }
        if (k0 == ExprKind.RealLiteral) return this.dae.addRealLiteral(v0 > 0.0 ? 1.0 : (v0 < 0.0 ? -1.0 : 0.0));
      } else if (poolMatchesSimple(pool, fnNameId, "floor")) {
        if (isLit) return this.dae.addRealLiteral(Math.floor(v0));
      } else if (poolMatchesSimple(pool, fnNameId, "ceil")) {
        if (isLit) return this.dae.addRealLiteral(Math.ceil(v0));
      }
    }

    // 3. Math functions (arity 2)
    if (argCount == 2) {
      let a0 = this.tempBuffer.get(argStart);
      let a1 = this.tempBuffer.get(argStart + 1);
      let k0 = this.dae.getExprKind(a0);
      let k1 = this.dae.getExprKind(a1);

      if (poolMatchesSimple(pool, fnNameId, "atan2")) {
        if ((k0 == ExprKind.RealLiteral || k0 == ExprKind.IntLiteral) &&
            (k1 == ExprKind.RealLiteral || k1 == ExprKind.IntLiteral)) {
          let v0 = k0 == ExprKind.RealLiteral ? this.dae.getExprRealValue(a0) : ((this.dae.getExprData1(a0) as i32) as f64);
          let v1 = k1 == ExprKind.RealLiteral ? this.dae.getExprRealValue(a1) : ((this.dae.getExprData1(a1) as i32) as f64);
          return this.dae.addRealLiteral(Math.atan2(v0, v1));
        }
      } else if (poolMatchesSimple(pool, fnNameId, "div")) {
        if (k0 == ExprKind.IntLiteral && k1 == ExprKind.IntLiteral) {
          let v0 = this.dae.getExprData1(a0) as i32;
          let v1 = this.dae.getExprData1(a1) as i32;
          if (v1 != 0) return this.dae.addIntLiteral(v0 / v1);
        }
      } else if (poolMatchesSimple(pool, fnNameId, "mod")) {
        if (k0 == ExprKind.IntLiteral && k1 == ExprKind.IntLiteral) {
          let v0 = this.dae.getExprData1(a0) as i32;
          let v1 = this.dae.getExprData1(a1) as i32;
          if (v1 != 0) {
            let q = Math.floor((v0 as f64) / (v1 as f64)) as i32;
            return this.dae.addIntLiteral(v0 - q * v1);
          }
        }
      } else if (poolMatchesSimple(pool, fnNameId, "rem")) {
        if (k0 == ExprKind.IntLiteral && k1 == ExprKind.IntLiteral) {
          let v0 = this.dae.getExprData1(a0) as i32;
          let v1 = this.dae.getExprData1(a1) as i32;
          if (v1 != 0) return this.dae.addIntLiteral(v0 % v1);
        }
      }
    }

    // 4. Structural builtins: size, ndims, zeros, ones, fill, identity, linspace, matrix, cross, skew, cat
    if (poolMatchesSimple(pool, fnNameId, "size") && argCount >= 1) {
      let arrId = this.tempBuffer.get(argStart);
      let dim: u32 = 1;
      let hasDimArg = false;
      if (argCount >= 2) {
        let dimArg = this.tempBuffer.get(argStart + 1);
        if (this.dae.getExprKind(dimArg) == ExprKind.IntLiteral) {
          dim = this.dae.getExprData1(dimArg);
          hasDimArg = true;
        }
      }
      if (hasDimArg) {
        if (this.dae.getExprKind(arrId) == ExprKind.ArrayCtor) {
          if (dim == 1) {
            return this.dae.addIntLiteral(this.dae.getExprData1(arrId) as i32);
          } else if (dim == 2) {
            let firstElem = getArrayCtorElement(this.dae, arrId, 0);
            if (this.dae.getExprKind(firstElem) == ExprKind.ArrayCtor) {
              return this.dae.addIntLiteral(this.dae.getExprData1(firstElem) as i32);
            }
          } else if (dim == 3) {
            let firstElem = getArrayCtorElement(this.dae, arrId, 0);
            if (this.dae.getExprKind(firstElem) == ExprKind.ArrayCtor) {
              let subElem = getArrayCtorElement(this.dae, firstElem, 0);
              if (this.dae.getExprKind(subElem) == ExprKind.ArrayCtor) {
                return this.dae.addIntLiteral(this.dae.getExprData1(subElem) as i32);
              }
            }
          }
        } else if (this.dae.getExprKind(arrId) == ExprKind.Name) {
          let nameId = this.resolveVarName(this.dae.getExprData1(arrId));
          if (this.hasArrayShape(nameId)) {
            let n = this.getArrayNDims(nameId);
            if (dim <= n) {
              let s = this.getArrayShapeDim(nameId, dim);
              return this.dae.addIntLiteral(s as i32);
            }
          }
          let s = this.getArrayShapeDim(nameId, dim);
          if (s == 0) {
            let vIdx = this.dae.lookupVariableByName(nameId);
            if (vIdx >= 0) {
              s = this.dae.getVarShapeDim(vIdx as u32, dim - 1) as u32;
            } else {
              let test1 = concatArrayIndex1D(pool, nameId, 1);
              if (this.dae.lookupVariableByName(test1) >= 0) {
                if (dim == 1) {
                  let count: u32 = 1;
                  while (this.dae.lookupVariableByName(concatArrayIndex1D(pool, nameId, count + 1)) >= 0) {
                    count++;
                  }
                  s = count;
                }
              }
            }
          }
          if (s > 0) return this.dae.addIntLiteral(s as i32);
        }
      } else {
        // size(A) without dim returns Integer[:] vector with all dimensions
        let d1: u32 = 0;
        let d2: u32 = 0;
        let d3: u32 = 0;
        if (this.dae.getExprKind(arrId) == ExprKind.ArrayCtor) {
          d1 = this.dae.getExprData1(arrId);
          if (d1 > 0) {
            let e0 = getArrayCtorElement(this.dae, arrId, 0);
            if (this.dae.getExprKind(e0) == ExprKind.ArrayCtor) {
              d2 = this.dae.getExprData1(e0);
              if (d2 > 0) {
                let e00 = getArrayCtorElement(this.dae, e0, 0);
                if (this.dae.getExprKind(e00) == ExprKind.ArrayCtor) {
                  d3 = this.dae.getExprData1(e00);
                }
              }
            }
          }
        } else if (this.dae.getExprKind(arrId) == ExprKind.Name) {
          let nameId = this.resolveVarName(this.dae.getExprData1(arrId));
          d1 = this.getArrayShapeDim(nameId, 1);
          d2 = this.getArrayShapeDim(nameId, 2);
          d3 = this.getArrayShapeDim(nameId, 3);
          if (d1 == 0) {
            let vIdx = this.dae.lookupVariableByName(nameId);
            if (vIdx >= 0) {
              d1 = this.dae.getVarShapeDim(vIdx as u32, 0) as u32;
              d2 = this.dae.getVarShapeDim(vIdx as u32, 1) as u32;
            } else {
              let test1 = concatArrayIndex1D(pool, nameId, 1);
              if (this.dae.lookupVariableByName(test1) >= 0) {
                let count: u32 = 1;
                while (this.dae.lookupVariableByName(concatArrayIndex1D(pool, nameId, count + 1)) >= 0) {
                  count++;
                }
                d1 = count;
              }
            }
          }
        }
        if (d1 > 0) {
          let sStart = this.tempBuffer.length;
          this.tempBuffer.push(this.dae.addIntLiteral(d1 as i32));
          let totalDims: u32 = 1;
          if (d2 > 0) {
            this.tempBuffer.push(this.dae.addIntLiteral(d2 as i32));
            totalDims = 2;
            if (d3 > 0) {
              this.tempBuffer.push(this.dae.addIntLiteral(d3 as i32));
              totalDims = 3;
            }
          }
          let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, sStart, totalDims);
          this.tempBuffer.length = sStart;
          return ctorId;
        }
      }
    }

    if (poolMatchesSimple(pool, fnNameId, "ndims") && argCount == 1) {
      let arrId = this.tempBuffer.get(argStart);
      if (this.dae.getExprKind(arrId) == ExprKind.ArrayCtor) {
        let firstElem = getArrayCtorElement(this.dae, arrId, 0);
        if (this.dae.getExprKind(firstElem) == ExprKind.ArrayCtor) {
          let subElem = getArrayCtorElement(this.dae, firstElem, 0);
          if (this.dae.getExprKind(subElem) == ExprKind.ArrayCtor) {
            return this.dae.addIntLiteral(3);
          }
          return this.dae.addIntLiteral(2);
        }
        return this.dae.addIntLiteral(1);
      } else if (this.dae.getExprKind(arrId) == ExprKind.Name) {
        let nameId = this.resolveVarName(this.dae.getExprData1(arrId));
        let nd = this.getArrayNDims(nameId);
        if (nd > 0) return this.dae.addIntLiteral(nd as i32);
      }
    }

    if (poolMatchesSimple(pool, fnNameId, "zeros") && argCount >= 1) {
      let a0 = this.tempBuffer.get(argStart);
      if (this.dae.getExprKind(a0) == ExprKind.IntLiteral) {
        let d1 = this.dae.getExprData1(a0) as u32;
        if (argCount == 1) {
          let zStart = this.tempBuffer.length;
          let zeroLit = this.dae.addRealLiteral(0.0);
          for (let i: u32 = 0; i < d1; i++) this.tempBuffer.push(zeroLit);
          let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, zStart, d1);
          this.tempBuffer.length = zStart;
          return ctorId;
        } else if (argCount == 2) {
          let a1 = this.tempBuffer.get(argStart + 1);
          if (this.dae.getExprKind(a1) == ExprKind.IntLiteral) {
            let d2 = this.dae.getExprData1(a1) as u32;
            let zStart = this.tempBuffer.length;
            let zeroLit = this.dae.addRealLiteral(0.0);
            for (let j: u32 = 0; j < d2; j++) this.tempBuffer.push(zeroLit);
            let rowCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, zStart, d2);
            this.tempBuffer.length = zStart;
            for (let i: u32 = 0; i < d1; i++) this.tempBuffer.push(rowCtorId);
            let matCtorId = d1 == 0 ? this.dae.addExpression(ExprKind.ArrayCtor, 0, rowCtorId, 0xffffffff) : addArrayCtorFromChunked(this.dae, this.tempBuffer, zStart, d1);
            this.tempBuffer.length = zStart;
            return matCtorId;
          }
        } else if (argCount == 3) {
          let a1 = this.tempBuffer.get(argStart + 1);
          let a2 = this.tempBuffer.get(argStart + 2);
          if (this.dae.getExprKind(a1) == ExprKind.IntLiteral && this.dae.getExprKind(a2) == ExprKind.IntLiteral) {
            let d2 = this.dae.getExprData1(a1) as u32;
            let d3 = this.dae.getExprData1(a2) as u32;
            let zStart = this.tempBuffer.length;
            let zeroLit = this.dae.addRealLiteral(0.0);
            for (let k: u32 = 0; k < d3; k++) this.tempBuffer.push(zeroLit);
            let rowCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, zStart, d3);
            this.tempBuffer.length = zStart;
            for (let j: u32 = 0; j < d2; j++) this.tempBuffer.push(rowCtorId);
            let matCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, zStart, d2);
            this.tempBuffer.length = zStart;
            for (let i: u32 = 0; i < d1; i++) this.tempBuffer.push(matCtorId);
            let cubeCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, zStart, d1);
            this.tempBuffer.length = zStart;
            return cubeCtorId;
          }
        }
      }
    }

    if (poolMatchesSimple(pool, fnNameId, "ones") && argCount >= 1) {
      let a0 = this.tempBuffer.get(argStart);
      if (this.dae.getExprKind(a0) == ExprKind.IntLiteral) {
        let d1 = this.dae.getExprData1(a0) as u32;
        let oneLit = this.dae.addRealLiteral(1.0);
        if (argCount == 1) {
          let oStart = this.tempBuffer.length;
          for (let i: u32 = 0; i < d1; i++) this.tempBuffer.push(oneLit);
          let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, oStart, d1);
          this.tempBuffer.length = oStart;
          return ctorId;
        } else if (argCount == 2) {
          let a1 = this.tempBuffer.get(argStart + 1);
          if (this.dae.getExprKind(a1) == ExprKind.IntLiteral) {
            let d2 = this.dae.getExprData1(a1) as u32;
            let oStart = this.tempBuffer.length;
            for (let j: u32 = 0; j < d2; j++) this.tempBuffer.push(oneLit);
            let rowCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, oStart, d2);
            this.tempBuffer.length = oStart;
            for (let i: u32 = 0; i < d1; i++) this.tempBuffer.push(rowCtorId);
            let matCtorId = d1 == 0 ? this.dae.addExpression(ExprKind.ArrayCtor, 0, rowCtorId, 0xffffffff) : addArrayCtorFromChunked(this.dae, this.tempBuffer, oStart, d1);
            this.tempBuffer.length = oStart;
            return matCtorId;
          }
        }
      }
    }

    if (poolMatchesSimple(pool, fnNameId, "fill") && argCount >= 2) {
      let valId = this.tempBuffer.get(argStart);
      if (this.dae.getExprKind(valId) == ExprKind.Name) {
        valId = resolveVarToArrayCtor(this.dae, pool, valId, this.tempBuffer);
      }
      let a1 = this.tempBuffer.get(argStart + 1);
      if (this.dae.getExprKind(a1) == ExprKind.IntLiteral) {
        let d1 = this.dae.getExprData1(a1) as u32;
        if (argCount == 2) {
          let fStart = this.tempBuffer.length;
          for (let i: u32 = 0; i < d1; i++) this.tempBuffer.push(valId);
          let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, fStart, d1);
          this.tempBuffer.length = fStart;
          return ctorId;
        } else if (argCount == 3) {
          let a2 = this.tempBuffer.get(argStart + 2);
          if (this.dae.getExprKind(a2) == ExprKind.IntLiteral) {
            let d2 = this.dae.getExprData1(a2) as u32;
            let fStart = this.tempBuffer.length;
            for (let j: u32 = 0; j < d2; j++) this.tempBuffer.push(valId);
            let rowCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, fStart, d2);
            this.tempBuffer.length = fStart;
            for (let i: u32 = 0; i < d1; i++) this.tempBuffer.push(rowCtorId);
            let matCtorId = d1 == 0 ? this.dae.addExpression(ExprKind.ArrayCtor, 0, rowCtorId, 0xffffffff) : addArrayCtorFromChunked(this.dae, this.tempBuffer, fStart, d1);
            this.tempBuffer.length = fStart;
            return matCtorId;
          }
        }
      }
    }

    if (poolMatchesSimple(pool, fnNameId, "identity") && argCount == 1) {
      let a0 = this.tempBuffer.get(argStart);
      if (this.dae.getExprKind(a0) == ExprKind.IntLiteral) {
        let n = this.dae.getExprData1(a0) as u32;
        let matStart = this.tempBuffer.length;
        let zeroLit = this.dae.addRealLiteral(0.0);
        let oneLit = this.dae.addRealLiteral(1.0);
        for (let i: u32 = 0; i < n; i++) {
          let rowStart = this.tempBuffer.length;
          for (let j: u32 = 0; j < n; j++) {
            this.tempBuffer.push(i == j ? oneLit : zeroLit);
          }
          let rowCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, rowStart, n);
          this.tempBuffer.length = rowStart;
          this.tempBuffer.push(rowCtorId);
        }
        let matCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, matStart, n);
        this.tempBuffer.length = matStart;
        return matCtorId;
      }
    }

    if (poolMatchesSimple(pool, fnNameId, "linspace") && argCount == 3) {
      let a0 = this.tempBuffer.get(argStart);
      let a1 = this.tempBuffer.get(argStart + 1);
      let a2 = this.tempBuffer.get(argStart + 2);
      let k0 = this.dae.getExprKind(a0);
      let k1 = this.dae.getExprKind(a1);
      let k2 = this.dae.getExprKind(a2);
      if ((k0 == ExprKind.RealLiteral || k0 == ExprKind.IntLiteral) &&
          (k1 == ExprKind.RealLiteral || k1 == ExprKind.IntLiteral) &&
          k2 == ExprKind.IntLiteral) {
        let x1 = k0 == ExprKind.RealLiteral ? this.dae.getExprRealValue(a0) : ((this.dae.getExprData1(a0) as i32) as f64);
        let x2 = k1 == ExprKind.RealLiteral ? this.dae.getExprRealValue(a1) : ((this.dae.getExprData1(a1) as i32) as f64);
        let n = this.dae.getExprData1(a2) as u32;
        if (n == 1) {
          let lStart = this.tempBuffer.length;
          this.tempBuffer.push(this.dae.addRealLiteral(x1));
          let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, lStart, 1);
          this.tempBuffer.length = lStart;
          return ctorId;
        } else if (n > 1) {
          let step = (x2 - x1) / ((n - 1) as f64);
          let lStart = this.tempBuffer.length;
          for (let i: u32 = 0; i < n; i++) {
            let val = x1 + (i as f64) * step;
            this.tempBuffer.push(this.dae.addRealLiteral(val));
          }
          let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, lStart, n);
          this.tempBuffer.length = lStart;
          return ctorId;
        }
      }
    }

    if (poolMatchesSimple(pool, fnNameId, "scalar") && argCount == 1) {
      let a0 = this.tempBuffer.get(argStart);
      let a0Arr = a0;
      if (this.dae.getExprKind(a0Arr) == ExprKind.Name) {
        a0Arr = resolveVarToArrayCtor(this.dae, pool, a0Arr, this.tempBuffer);
      }
      if (this.dae.getExprKind(a0Arr) != ExprKind.ArrayCtor) return 0xffffffff;
      while (this.dae.getExprKind(a0Arr) == ExprKind.ArrayCtor) {
        if (this.dae.getExprData1(a0Arr) != 1) return 0xffffffff;
        a0Arr = getArrayCtorElement(this.dae, a0Arr, 0);
      }
      return a0Arr;
    }

    if (poolMatchesSimple(pool, fnNameId, "vector") && argCount == 1) {
      let a0 = this.tempBuffer.get(argStart);
      let a0Arr = a0;
      if (this.dae.getExprKind(a0Arr) == ExprKind.Name) {
        a0Arr = resolveVarToArrayCtor(this.dae, pool, a0Arr, this.tempBuffer);
      }
      if (this.dae.getExprKind(a0Arr) == ExprKind.ArrayCtor) {
        let count = this.dae.getExprData1(a0Arr);
        if (count > 0) {
          let firstElem = getArrayCtorElement(this.dae, a0Arr, 0);
          if (this.dae.getExprKind(firstElem) != ExprKind.ArrayCtor) {
            return a0Arr;
          }
          if (count == 1) {
            return firstElem;
          }
          if (this.dae.getExprData1(firstElem) == 1) {
            let vecStart = this.tempBuffer.length;
            for (let i: u32 = 0; i < count; i++) {
              let rowId = getArrayCtorElement(this.dae, a0Arr, i);
              if (this.dae.getExprKind(rowId) != ExprKind.ArrayCtor || this.dae.getExprData1(rowId) != 1) {
                this.tempBuffer.length = vecStart;
                return 0xffffffff;
              }
              this.tempBuffer.push(getArrayCtorElement(this.dae, rowId, 0));
            }
            let vecCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, vecStart, count);
            this.tempBuffer.length = vecStart;
            return vecCtorId;
          }
        }
      }
      return 0xffffffff;
    }

    if (poolMatchesSimple(pool, fnNameId, "matrix") && argCount == 1) {
      let a0 = this.tempBuffer.get(argStart);
      let a0Arr = a0;
      if (this.dae.getExprKind(a0Arr) == ExprKind.Name) {
        a0Arr = resolveVarToArrayCtor(this.dae, pool, a0Arr, this.tempBuffer);
      }
      if (this.dae.getExprKind(a0Arr) == ExprKind.ArrayCtor) {
        let count = this.dae.getExprData1(a0Arr);
        if (count > 0) {
          let firstElem = getArrayCtorElement(this.dae, a0Arr, 0);
          if (this.dae.getExprKind(firstElem) == ExprKind.ArrayCtor) {
            let subCount = this.dae.getExprData1(firstElem);
            if (subCount > 0) {
              let subFirst = getArrayCtorElement(this.dae, firstElem, 0);
              if (this.dae.getExprKind(subFirst) == ExprKind.ArrayCtor) {
                if (this.dae.getExprData1(subFirst) == 1) {
                  let matStart = this.tempBuffer.length;
                  for (let i: u32 = 0; i < count; i++) {
                    let rowExpr = getArrayCtorElement(this.dae, a0Arr, i);
                    let rCount = this.dae.getExprData1(rowExpr);
                    let rStart = this.tempBuffer.length;
                    for (let j: u32 = 0; j < rCount; j++) {
                      let cellExpr = getArrayCtorElement(this.dae, rowExpr, j);
                      this.tempBuffer.push(getArrayCtorElement(this.dae, cellExpr, 0));
                    }
                    let rowCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, rStart, rCount);
                    this.tempBuffer.length = rStart;
                    this.tempBuffer.push(rowCtorId);
                  }
                  let matCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, matStart, count);
                  this.tempBuffer.length = matStart;
                  return matCtorId;
                }
                return 0xffffffff;
              }
            }
            return a0Arr;
          }
          let matStart = this.tempBuffer.length;
          for (let i: u32 = 0; i < count; i++) {
            let elem = getArrayCtorElement(this.dae, a0Arr, i);
            let rowStart = this.tempBuffer.length;
            this.tempBuffer.push(elem);
            let rowCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, rowStart, 1);
            this.tempBuffer.length = rowStart;
            this.tempBuffer.push(rowCtorId);
          }
          let matCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, matStart, count);
          this.tempBuffer.length = matStart;
          return matCtorId;
        }
      } else {
        // Scalar to 1x1 matrix {{a0}}
        let rowStart = this.tempBuffer.length;
        this.tempBuffer.push(a0);
        let rowCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, rowStart, 1);
        this.tempBuffer.length = rowStart;
        this.tempBuffer.push(rowCtorId);
        let matCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, rowStart, 1);
        this.tempBuffer.length = rowStart;
        return matCtorId;
      }
    }

    if (poolMatchesSimple(pool, fnNameId, "cross") && argCount == 2) {
      let a0 = this.tempBuffer.get(argStart);
      let a1 = this.tempBuffer.get(argStart + 1);
      if (this.dae.getExprKind(a0) == ExprKind.Name) a0 = resolveVarToArrayCtor(this.dae, pool, a0, this.tempBuffer);
      if (this.dae.getExprKind(a1) == ExprKind.Name) a1 = resolveVarToArrayCtor(this.dae, pool, a1, this.tempBuffer);
      if (this.dae.getExprKind(a0) == ExprKind.ArrayCtor && this.dae.getExprKind(a1) == ExprKind.ArrayCtor) {
        if (this.dae.getExprData1(a0) == 3 && this.dae.getExprData1(a1) == 3) {
          let x0 = getArrayCtorElement(this.dae, a0, 0);
          let x1 = getArrayCtorElement(this.dae, a0, 1);
          let x2 = getArrayCtorElement(this.dae, a0, 2);
          let y0 = getArrayCtorElement(this.dae, a1, 0);
          let y1 = getArrayCtorElement(this.dae, a1, 1);
          let y2 = getArrayCtorElement(this.dae, a1, 2);
          let z0 = this.lowerBinary(BinOp.Sub as u16, this.lowerBinary(BinOp.Mul as u16, x1, y2), this.lowerBinary(BinOp.Mul as u16, x2, y1));
          let z1 = this.lowerBinary(BinOp.Sub as u16, this.lowerBinary(BinOp.Mul as u16, x2, y0), this.lowerBinary(BinOp.Mul as u16, x0, y2));
          let z2 = this.lowerBinary(BinOp.Sub as u16, this.lowerBinary(BinOp.Mul as u16, x0, y1), this.lowerBinary(BinOp.Mul as u16, x1, y0));
          let cStart = this.tempBuffer.length;
          this.tempBuffer.push(z0);
          this.tempBuffer.push(z1);
          this.tempBuffer.push(z2);
          let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, cStart, 3);
          this.tempBuffer.length = cStart;
          return ctorId;
        }
      }
    }

    if (poolMatchesSimple(pool, fnNameId, "skew") && argCount == 1) {
      let a0 = this.tempBuffer.get(argStart);
      if (this.dae.getExprKind(a0) == ExprKind.Name) a0 = resolveVarToArrayCtor(this.dae, pool, a0, this.tempBuffer);
      if (this.dae.getExprKind(a0) == ExprKind.ArrayCtor && this.dae.getExprData1(a0) == 3) {
        let x0 = getArrayCtorElement(this.dae, a0, 0);
        let x1 = getArrayCtorElement(this.dae, a0, 1);
        let x2 = getArrayCtorElement(this.dae, a0, 2);
        let zeroLit = this.dae.addRealLiteral(0.0);
        let negX0 = this.lowerUnary(UnaryOp.Negate as u16, x0);
        let negX1 = this.lowerUnary(UnaryOp.Negate as u16, x1);
        let negX2 = this.lowerUnary(UnaryOp.Negate as u16, x2);
        let r0Start = this.tempBuffer.length;
        this.tempBuffer.push(zeroLit);
        this.tempBuffer.push(negX2);
        this.tempBuffer.push(x1);
        let r0 = addArrayCtorFromChunked(this.dae, this.tempBuffer, r0Start, 3);
        this.tempBuffer.length = r0Start;
        this.tempBuffer.push(x2);
        this.tempBuffer.push(zeroLit);
        this.tempBuffer.push(negX0);
        let r1 = addArrayCtorFromChunked(this.dae, this.tempBuffer, r0Start, 3);
        this.tempBuffer.length = r0Start;
        this.tempBuffer.push(negX1);
        this.tempBuffer.push(x0);
        this.tempBuffer.push(zeroLit);
        let r2 = addArrayCtorFromChunked(this.dae, this.tempBuffer, r0Start, 3);
        this.tempBuffer.length = r0Start;

        let matStart = this.tempBuffer.length;
        this.tempBuffer.push(r0);
        this.tempBuffer.push(r1);
        this.tempBuffer.push(r2);
        let matCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, matStart, 3);
        this.tempBuffer.length = matStart;
        return matCtorId;
      }
    }

    if (poolMatchesSimple(pool, fnNameId, "cat") && argCount >= 2) {
      let a0 = this.tempBuffer.get(argStart);
      if (this.dae.getExprKind(a0) == ExprKind.IntLiteral) {
        let catDim = this.dae.getExprData1(a0);
        let catCtorId = this.catArrays(catDim, argStart + 1, argCount - 1);
        if (catCtorId != 0xffffffff) {
          return catCtorId;
        }
      }
    }

    if (poolMatchesSimple(pool, fnNameId, "array")) {
      let hasReal = false;
      let allNumeric = true;
      for (let i: u32 = 0; i < argCount; i++) {
        let aid = this.tempBuffer.get(argStart + i);
        let k = this.dae.getExprKind(aid);
        if (k == ExprKind.RealLiteral) {
          hasReal = true;
        } else if (k != ExprKind.IntLiteral) {
          allNumeric = false;
        }
      }
      if (hasReal && allNumeric && argCount > 0) {
        let firstIsInt = this.dae.getExprKind(this.tempBuffer.get(argStart)) == ExprKind.IntLiteral;
        let lastIsReal = this.dae.getExprKind(this.tempBuffer.get(argStart + argCount - 1)) == ExprKind.RealLiteral;
        if (firstIsInt && lastIsReal) {
          for (let i: u32 = 0; i < argCount; i++) {
            let aid = this.tempBuffer.get(argStart + i);
            if (this.dae.getExprKind(aid) == ExprKind.IntLiteral) {
              this.tempBuffer.set(argStart + i, this.castToReal(aid));
            }
          }
        }
      }
      return addArrayCtorFromChunked(this.dae, this.tempBuffer, argStart, argCount);
    }

    if (poolMatchesSimple(pool, fnNameId, "noEvent") && argCount == 1) {
      return this.tempBuffer.get(argStart);
    }

    // 5. Fallback: Functions not recognized or not yet supported in WASM (reductions, user functions, etc.)
    return 0xffffffff;
  }

  lowerArrayComprehension(loc: u64, forInd: u64): u32 {
    let pool = this.dae.getStringPool();
    let bodyLoc: u64 = 0;
    let ch = locFirstChild(loc);
    while (!locIsNull(ch)) {
      if (locLen(ch) > 0) {
        if (locMatches(ch, "for") || locType(ch) == SyntaxType.FOR_INDICES) break;
        if (!locMatches(ch, "{")) bodyLoc = ch;
      }
      ch = locNextSibling(ch);
    }
    if (locIsNull(bodyLoc)) return 0xffffffff;

    let rangeInfo = createChunkedInt32Array(16);
    let fi1: u64 = 0;
    let fi2: u64 = 0;
    let fc = locFirstChild(forInd);
    while (!locIsNull(fc)) {
      let t = locType(fc);
      if (t == SyntaxType.FOR_INDEX) {
        if (fi1 == 0) fi1 = fc;
        else if (fi2 == 0) fi2 = fc;
      } else {
        let fsub = locFirstChild(fc);
        while (!locIsNull(fsub)) {
          if (locType(fsub) == SyntaxType.FOR_INDEX) {
            if (fi1 == 0) fi1 = fsub;
            else if (fi2 == 0) fi2 = fsub;
          }
          fsub = locNextSibling(fsub);
        }
      }
      fc = locNextSibling(fc);
    }
    if (locIsNull(fi1)) return 0xffffffff;

    let ok1 = parseForIndexRange(fi1, this.dae, pool, rangeInfo);
    if (ok1 == 0) return 0xffffffff;
    let var1 = rangeInfo.get(0) as u32;
    let s1 = rangeInfo.get(1);
    let st1 = rangeInfo.get(2);
    let e1 = rangeInfo.get(3);

    if (locIsNull(fi2)) {
      // 1D comprehension
      let arrStart = this.tempBuffer.length;
      for (let v1: i32 = s1; st1 > 0 ? v1 <= e1 : v1 >= e1; v1 += st1) {
        let litId = this.dae.addIntLiteral(v1);
        this.setLoopVar(var1, litId);
        let elemId = this.visitLoc(bodyLoc);
        if (elemId == 0xffffffff) {
          this.removeLoopVar(var1);
          this.tempBuffer.length = arrStart;
          return 0xffffffff;
        }
        this.tempBuffer.push(elemId);
      }
      this.removeLoopVar(var1);
      let arrCount = this.tempBuffer.length - arrStart;
      let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, arrStart, arrCount);
      this.tempBuffer.length = arrStart;
      return ctorId;
    } else {
      // 2D comprehension: {expr for i in s1:e1, j in s2:e2}
      let ok2 = parseForIndexRange(fi2, this.dae, pool, rangeInfo);
      if (ok2 == 0) return 0xffffffff;
      let var2 = rangeInfo.get(4) as u32;
      let s2 = rangeInfo.get(5);
      let st2 = rangeInfo.get(6);
      let e2 = rangeInfo.get(7);

      let matStart = this.tempBuffer.length;
      let rowCount: u32 = 0;
      for (let v1: i32 = s1; st1 > 0 ? v1 <= e1 : v1 >= e1; v1 += st1) {
        let lit1 = this.dae.addIntLiteral(v1);
        this.setLoopVar(var1, lit1);
        let rowStart = this.tempBuffer.length;
        for (let v2: i32 = s2; st2 > 0 ? v2 <= e2 : v2 >= e2; v2 += st2) {
          let lit2 = this.dae.addIntLiteral(v2);
          this.setLoopVar(var2, lit2);
          let elemId = this.visitLoc(bodyLoc);
          if (elemId == 0xffffffff) {
            this.removeLoopVar(var1);
            this.removeLoopVar(var2);
            this.tempBuffer.length = matStart;
            return 0xffffffff;
          }
          this.tempBuffer.push(elemId);
        }
        let colCount = this.tempBuffer.length - rowStart;
        let rowCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, rowStart, colCount);
        this.tempBuffer.length = rowStart;
        this.tempBuffer.push(rowCtorId);
        rowCount++;
      }
      this.removeLoopVar(var1);
      this.removeLoopVar(var2);
      let matCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, matStart, rowCount);
      this.tempBuffer.length = matStart;
      return matCtorId;
    }
  }

  lowerReduction(fnNameId: u32, callArgsLoc: u64, forInd: u64): u32 {
    let pool = this.dae.getStringPool();
    let isSum = poolMatchesSimple(pool, fnNameId, "sum") || poolMatchesSimple(pool, fnNameId, ".sum");
    let isProd = poolMatchesSimple(pool, fnNameId, "product") || poolMatchesSimple(pool, fnNameId, ".product");
    let isMin = poolMatchesSimple(pool, fnNameId, "min") || poolMatchesSimple(pool, fnNameId, ".min");
    let isMax = poolMatchesSimple(pool, fnNameId, "max") || poolMatchesSimple(pool, fnNameId, ".max");

    if (!isSum && !isProd && !isMin && !isMax) return 0xffffffff;

    let bodyLoc: u64 = 0;
    let ch = locFirstChild(callArgsLoc);
    while (!locIsNull(ch)) {
      if (locLen(ch) > 0) {
        if (locMatches(ch, "for") || locType(ch) == SyntaxType.FOR_INDICES) break;
        if (!locMatches(ch, "(")) bodyLoc = ch;
      }
      ch = locNextSibling(ch);
    }
    if (locIsNull(bodyLoc)) return 0xffffffff;

    let rangeInfo = createChunkedInt32Array(16);
    let fi1: u64 = 0;
    let fi2: u64 = 0;
    let fc = locFirstChild(forInd);
    while (!locIsNull(fc)) {
      let t = locType(fc);
      if (t == SyntaxType.FOR_INDEX) {
        if (fi1 == 0) fi1 = fc;
        else if (fi2 == 0) fi2 = fc;
      } else {
        let fsub = locFirstChild(fc);
        while (!locIsNull(fsub)) {
          if (locType(fsub) == SyntaxType.FOR_INDEX) {
            if (fi1 == 0) fi1 = fsub;
            else if (fi2 == 0) fi2 = fsub;
          }
          fsub = locNextSibling(fsub);
        }
      }
      fc = locNextSibling(fc);
    }
    if (locIsNull(fi1)) return 0xffffffff;

    let ok1 = parseForIndexRange(fi1, this.dae, pool, rangeInfo);
    if (ok1 == 0) return 0xffffffff;
    let var1 = rangeInfo.get(0) as u32;
    let s1 = rangeInfo.get(1);
    let st1 = rangeInfo.get(2);
    let e1 = rangeInfo.get(3);

    let elemStart = this.tempBuffer.length;

    if (locIsNull(fi2)) {
      // 1D reduction
      for (let v1: i32 = s1; st1 > 0 ? v1 <= e1 : v1 >= e1; v1 += st1) {
        let litId = this.dae.addIntLiteral(v1);
        this.setLoopVar(var1, litId);
        let elemId = this.visitLoc(bodyLoc);
        if (elemId == 0xffffffff) {
          this.removeLoopVar(var1);
          this.tempBuffer.length = elemStart;
          return 0xffffffff;
        }
        this.tempBuffer.push(elemId);
      }
      this.removeLoopVar(var1);
    } else {
      // 2D reduction: e.g. sum((1/(i+j-1)) for i in 1:n, j in 1:n)
      let ok2 = parseForIndexRange(fi2, this.dae, pool, rangeInfo);
      if (ok2 == 0) return 0xffffffff;
      let var2 = rangeInfo.get(4) as u32;
      let s2 = rangeInfo.get(5);
      let st2 = rangeInfo.get(6);
      let e2 = rangeInfo.get(7);

      for (let v1: i32 = s1; st1 > 0 ? v1 <= e1 : v1 >= e1; v1 += st1) {
        let lit1 = this.dae.addIntLiteral(v1);
        this.setLoopVar(var1, lit1);
        for (let v2: i32 = s2; st2 > 0 ? v2 <= e2 : v2 >= e2; v2 += st2) {
          let lit2 = this.dae.addIntLiteral(v2);
          this.setLoopVar(var2, lit2);
          let elemId = this.visitLoc(bodyLoc);
          if (elemId == 0xffffffff) {
            this.removeLoopVar(var1);
            this.removeLoopVar(var2);
            this.tempBuffer.length = elemStart;
            return 0xffffffff;
          }
          this.tempBuffer.push(elemId);
        }
      }
      this.removeLoopVar(var1);
      this.removeLoopVar(var2);
    }

    let elemCount = this.tempBuffer.length - elemStart;
    if (elemCount == 0) {
      if (isSum) return this.dae.addRealLiteral(0.0);
      if (isProd) return this.dae.addRealLiteral(1.0);
      return 0xffffffff;
    }

    let acc = this.tempBuffer.get(elemStart);
    if (isSum) {
      for (let i: u32 = 1; i < elemCount; i++) {
        acc = this.lowerBinary(BinOp.Add as u16, acc, this.tempBuffer.get(elemStart + i));
      }
    } else if (isProd) {
      for (let i: u32 = 1; i < elemCount; i++) {
        acc = this.lowerBinary(BinOp.Mul as u16, acc, this.tempBuffer.get(elemStart + i));
      }
    } else {
      this.tempBuffer.length = elemStart;
      return 0xffffffff;
    }

    this.tempBuffer.length = elemStart;
    return acc;
  }

  private collectSubscripts(nodeLoc: u64, baseNameId: u32 = 0): void {
    if (locIsNull(nodeLoc)) return;
    let ch = locFirstChild(nodeLoc);
    let dimIdx: u32 = 1;
    while (!locIsNull(ch)) {
      if (locType(ch) == SyntaxType.SUBSCRIPT) {
        let dSize: u32 = 0;
        if (baseNameId != 0) {
          dSize = this.getArrayShapeDim(baseNameId, dimIdx);
          if (dSize == 0) {
            let pool = this.dae.getStringPool();
            if (this.dae.lookupVariableByName(concatArrayIndex2D(pool, baseNameId, 1, 1)) >= 0) {
              if (dimIdx == 1) {
                while (this.dae.lookupVariableByName(concatArrayIndex2D(pool, baseNameId, dSize + 1, 1)) >= 0) dSize++;
              } else if (dimIdx == 2) {
                while (this.dae.lookupVariableByName(concatArrayIndex2D(pool, baseNameId, 1, dSize + 1)) >= 0) dSize++;
              }
            } else if (this.dae.lookupVariableByName(concatArrayIndex1D(pool, baseNameId, 1)) >= 0) {
              while (this.dae.lookupVariableByName(concatArrayIndex1D(pool, baseNameId, dSize + 1)) >= 0) dSize++;
            }
          }
        }
        let subVal = this.evalIntSubscript(ch, dSize > 0 ? dSize : 1);
        this.tempBuffer.push(subVal as u32);
        dimIdx++;
      } else {
        this.collectSubscripts(ch, baseNameId);
      }
      ch = locNextSibling(ch);
    }
  }

  private appendComponentRefParts(nodeLoc: u64, pool: ArenaStringPool, currentNameId: u32, stopLoc: u64 = 0): u32 {
    if (locIsNull(nodeLoc) || this.stopLocReached) return currentNameId;
    if (stopLoc != 0 && nodeLoc == stopLoc) {
      this.stopLocReached = true;
      return currentNameId;
    }
    let ct = locType(nodeLoc);

    // 1. Identifier
    if (ct == SyntaxType.IDENTIFIER || ct == SyntaxType.TOKEN_IDENTIFIER_ALT || ct == SyntaxType.NAME) {
      let partId = locIntern(pool, nodeLoc);
      if (currentNameId == 0) {
        return partId;
      } else {
        return pool.concatIds(currentNameId, partId);
      }
    }

    // 2. Array Subscripts
    if (ct == SyntaxType.ARRAY_SUBSCRIPTS) {
      let subStart = this.tempBuffer.length;
      this.collectSubscripts(nodeLoc, currentNameId);
      let subCount = this.tempBuffer.length - subStart;
      let sub1: i32 = subCount >= 1 ? (this.tempBuffer.get(subStart) as i32) : 0;
      let sub2: i32 = subCount >= 2 ? (this.tempBuffer.get(subStart + 1) as i32) : 0;
      let sub3: i32 = subCount >= 3 ? (this.tempBuffer.get(subStart + 2) as i32) : 0;
      this.tempBuffer.length = subStart;

      if (currentNameId != 0) {
        let expectedNDims: u32 = 0;
        let targetId = currentNameId;
        let d1 = this.getArrayShapeDim(targetId, 1);
        if (d1 == 0 && this.scopeStackPtr != 0) {
          let prefixId = changetype<ScopeStack>(this.scopeStackPtr).currentPrefixPathId;
          if (prefixId != 0) {
            let prefixedId = pool.concatIds(prefixId, currentNameId);
            d1 = this.getArrayShapeDim(prefixedId, 1);
            if (d1 > 0) targetId = prefixedId;
          }
        }
        if (d1 > 0) {
          let d2 = this.getArrayShapeDim(targetId, 2);
          let d3 = this.getArrayShapeDim(targetId, 3);
          expectedNDims = d3 > 0 ? 3 : (d2 > 0 ? 2 : 1);
        }
        if (expectedNDims > 0 && (subCount as u32) != expectedNDims) {
          if (this.flattenerPtr != 0) {
            changetype<ModelicaFlattener>(this.flattenerPtr).setErrorAt(WasmBailReason.SimpleEquationExpr, nodeLoc);
          }
          return 0;
        }
        if (subCount >= 3 && sub1 > 0 && sub2 > 0 && sub3 > 0) {
          return concatArrayIndex3D(pool, currentNameId, sub1 as u32, sub2 as u32, sub3 as u32);
        } else if (subCount >= 2 && sub1 > 0 && sub2 > 0) {
          return concatArrayIndex2D(pool, currentNameId, sub1 as u32, sub2 as u32);
        } else if (subCount >= 1 && sub1 > 0) {
          return concatArrayIndex1D(pool, currentNameId, sub1 as u32);
        }
      }
      return currentNameId;
    }

    // 3. Skip punctuation
    if (locMatches(nodeLoc, ".") || locMatches(nodeLoc, ",") || locMatches(nodeLoc, "[") || locMatches(nodeLoc, "]")) {
      return currentNameId;
    }

    // 4. Any intermediate compound node (such as rule 321 or component_reference itself):
    let child = locFirstChild(nodeLoc);
    while (!locIsNull(child)) {
      if (stopLoc != 0 && child == stopLoc) {
        this.stopLocReached = true;
        break;
      }
      currentNameId = this.appendComponentRefParts(child, pool, currentNameId, stopLoc);
      if (this.stopLocReached) break;
      child = locNextSibling(child);
    }
    return currentNameId;
  }

  private collectSubscriptLocs(nodeLoc: u64): void {
    if (locIsNull(nodeLoc)) return;
    let ch = locFirstChild(nodeLoc);
    while (!locIsNull(ch)) {
      if (locType(ch) == SyntaxType.SUBSCRIPT) {
        if (this.subLoc1 == 0) this.subLoc1 = ch;
        else if (this.subLoc2 == 0) this.subLoc2 = ch;
        else if (this.subLoc3 == 0) this.subLoc3 = ch;
      } else if (!locMatches(ch, "[") && !locMatches(ch, "]") && !locMatches(ch, ",")) {
        this.collectSubscriptLocs(ch);
      }
      ch = locNextSibling(ch);
    }
  }

  hasSliceSubscript(subLoc: u64): bool {
    if (locIsNull(subLoc)) return false;
    if (!locIsNull(locFindMatchingDescendant(subLoc, ":"))) return true;
    if (!locIsNull(locFindMatchingDescendant(subLoc, "{"))) return true;
    return false;
  }

  findSliceSubscript(loc: u64): u64 {
    if (locIsNull(loc)) return 0;
    let ch = locFirstChild(loc);
    let found: u64 = 0;
    while (!locIsNull(ch)) {
      if (locType(ch) == SyntaxType.ARRAY_SUBSCRIPTS && this.hasSliceSubscript(ch)) {
        found = ch;
      } else {
        let nested = this.findSliceSubscript(ch);
        if (!locIsNull(nested)) found = nested;
      }
      ch = locNextSibling(ch);
    }
    return found;
  }

  extractBaseRefName(compRefLoc: u64, targetSubLoc: u64, pool: ArenaStringPool): u32 {
    this.stopLocReached = false;
    let baseId = this.appendComponentRefParts(compRefLoc, pool, 0, targetSubLoc);
    this.stopLocReached = false;
    if (baseId == 0) {
      let idLoc = locFindDescendant(compRefLoc, SyntaxType.IDENTIFIER);
      if (!locIsNull(idLoc)) baseId = locIntern(pool, idLoc);
    }
    return baseId;
  }

  evalIntSubscript(nodeLoc: u64, dSize: u32): i32 {
    let prevEnd = this.currentDimEnd;
    this.currentDimEnd = dSize as i32;

    if (locType(nodeLoc) == SyntaxType.SUBSCRIPT) {
      let subExpr = locFindDescendant(nodeLoc, SyntaxType.EXPRESSION);
      if (!locIsNull(subExpr)) nodeLoc = subExpr;
    }

    if (locMatches(nodeLoc, "end") || (locType(nodeLoc) as u32) == 23) {
      this.currentDimEnd = prevEnd;
      return dSize as i32;
    }
    let singleCh = locFirstChild(nodeLoc);
    if (!locIsNull(singleCh) && (locMatches(singleCh, "end") || (locType(singleCh) as u32) == 23) && locIsNull(locNextSibling(singleCh))) {
      this.currentDimEnd = prevEnd;
      return dSize as i32;
    }
    if (!locIsNull(locFindMatchingDescendant(nodeLoc, "end")) && locIsNull(locFindMatchingDescendant(nodeLoc, "+")) && locIsNull(locFindMatchingDescendant(nodeLoc, "-"))) {
      this.currentDimEnd = prevEnd;
      return dSize as i32;
    }

    let p = 0;
    let nt = locType(nodeLoc);
    if (nt == SyntaxType.UNSIGNED_INTEGER || nt == SyntaxType.TOKEN_UNSIGNED_INT_ALT) {
      p = locParseInt(nodeLoc);
    }
    if (p > 0 && locIsNull(locFindMatchingDescendant(nodeLoc, "end")) && locIsNull(locFindMatchingDescendant(nodeLoc, "-")) && locIsNull(locFindMatchingDescendant(nodeLoc, "+"))) {
      this.currentDimEnd = prevEnd;
      return p;
    }

    let eid = this.visitLoc(nodeLoc);
    this.currentDimEnd = prevEnd;
    if (eid != 0xffffffff) {
      let k = this.dae.getExprKind(eid);
      if (k == ExprKind.IntLiteral) return this.dae.getExprData1(eid) as i32;
      if (k == ExprKind.RealLiteral) {
        if (this.flattenerPtr != 0) {
          changetype<ModelicaFlattener>(this.flattenerPtr).setErrorAt(WasmBailReason.SimpleEquationExpr, nodeLoc);
        }
        return -1;
      }
      if (k == ExprKind.BoolLiteral) return this.dae.getExprData1(eid) as i32;
    }
    if (p > 0) return p;
    if (this.flattenerPtr != 0) {
      changetype<ModelicaFlattener>(this.flattenerPtr).setErrorAt(WasmBailReason.SimpleEquationExpr, nodeLoc);
    }
    return -1;
  }

  collectIntSubscriptElements(argLoc: u64, out: ChunkedUint32Array, dSize: u32): void {
    let ch = locFirstChild(argLoc);
    while (!locIsNull(ch)) {
      let len = locLen(ch);
      if (len > 0) {
        let ct = locType(ch);
        if (ct == SyntaxType.EXPRESSION) {
          let val = this.evalIntSubscript(ch, dSize);
          out.push(val as u32);
        } else if (ct == SyntaxType.ARRAY_ARGUMENTS || ct == SyntaxType.ARRAY_ARGUMENTS_NON_FIRST) {
          this.collectIntSubscriptElements(ch, out, dSize);
        } else if (locChildCount(ch) > 0 && !locMatches(ch, "{") && !locMatches(ch, "}") && !locMatches(ch, ",")) {
          this.collectIntSubscriptElements(ch, out, dSize);
        }
      }
      ch = locNextSibling(ch);
    }
  }

  parseSubscriptIndices(subLoc: u64, outBuffer: ChunkedUint32Array, dSize: u32): bool {
    let prevEnd = this.currentDimEnd;
    this.currentDimEnd = dSize as i32;

    // 1. Colon ":" (whole dimension)
    if (locMatches(subLoc, ":")) {
      this.currentDimEnd = prevEnd;
      let limit: u32 = dSize > 0 ? dSize : 1;
      for (let i: u32 = 1; i <= limit; i++) {
        outBuffer.push(i);
      }
      return true;
    }
    let onlyChild = locFirstChild(subLoc);
    if (!locIsNull(onlyChild) && locMatches(onlyChild, ":") && locIsNull(locNextSibling(onlyChild))) {
      this.currentDimEnd = prevEnd;
      let limit: u32 = dSize > 0 ? dSize : 1;
      for (let i: u32 = 1; i <= limit; i++) {
        outBuffer.push(i);
      }
      return true;
    }

    // 2. Array constructor "{ ... }"
    let openBrace = locFindMatchingDescendant(subLoc, "{");
    if (!locIsNull(openBrace) || locMatches(subLoc, "{")) {
      let arrArgs = locFindDescendant(subLoc, SyntaxType.ARRAY_ARGUMENTS);
      if (!locIsNull(arrArgs)) {
        this.collectIntSubscriptElements(arrArgs, outBuffer, dSize);
      } else {
        let exprList = locFindDescendant(subLoc, SyntaxType.EXPRESSION_LIST);
        let startLoc = !locIsNull(exprList) ? exprList : subLoc;
        this.collectIntSubscriptElements(startLoc, outBuffer, dSize);
      }
      this.currentDimEnd = prevEnd;
      return true;
    }

    // 3. Colon range "start:stop" or "start:step:stop"
    let colonLoc = locFindMatchingDescendant(subLoc, ":");
    if (locIsNull(colonLoc)) {
      let cur = locFirstChild(subLoc);
      while (!locIsNull(cur)) {
        if (locMatches(cur, ":")) { colonLoc = cur; break; }
        cur = locNextSibling(cur);
      }
    }

    if (!locIsNull(colonLoc)) {
      let exprNode = locFindDescendant(subLoc, SyntaxType.EXPRESSION);
      if (locIsNull(exprNode)) exprNode = subLoc;

      while (true) {
        let nzCount: u32 = 0;
        let onlyCh: u64 = 0;
        let ch = locFirstChild(exprNode);
        while (!locIsNull(ch)) {
          if (locLen(ch) > 0) {
            nzCount++;
            onlyCh = ch;
          }
          ch = locNextSibling(ch);
        }
        if (nzCount == 1) {
          exprNode = onlyCh;
        } else {
          break;
        }
      }

      let c0: u64 = 0;
      let c1: u64 = 0;
      let c2: u64 = 0;
      let ch = locFirstChild(exprNode);
      while (!locIsNull(ch)) {
        if (locLen(ch) > 0) {
          if (c0 == 0) c0 = ch;
          else if (c1 == 0) c1 = ch;
          else if (c2 == 0) { c2 = ch; break; }
        }
        ch = locNextSibling(ch);
      }

      let startVal: i32 = 1;
      let stepVal: i32 = 1;
      let stopVal: i32 = dSize as i32;

      let opNode = c1;
      while (locChildCount(opNode) > 0) {
        let inner = locFirstNonEmptyChild(opNode);
        if (locIsNull(inner)) break;
        opNode = inner;
      }

      if (!locIsNull(c0) && !locIsNull(c1) && !locIsNull(c2) && locMatches(opNode, ":")) {
        let u0 = c0;
        while (true) {
          let nzCount: u32 = 0;
          let onlyCh: u64 = 0;
          let ch0 = locFirstChild(u0);
          while (!locIsNull(ch0)) {
            if (locLen(ch0) > 0) {
              nzCount++;
              onlyCh = ch0;
            }
            ch0 = locNextSibling(ch0);
          }
          if (nzCount == 1) {
            u0 = onlyCh;
          } else {
            break;
          }
        }

        let subC0: u64 = 0;
        let subC1: u64 = 0;
        let subC2: u64 = 0;
        let ch0 = locFirstChild(u0);
        while (!locIsNull(ch0)) {
          if (locLen(ch0) > 0) {
            if (subC0 == 0) subC0 = ch0;
            else if (subC1 == 0) subC1 = ch0;
            else if (subC2 == 0) { subC2 = ch0; break; }
          }
          ch0 = locNextSibling(ch0);
        }

        let subOpNode = subC1;
        while (locChildCount(subOpNode) > 0) {
          let inner = locFirstNonEmptyChild(subOpNode);
          if (locIsNull(inner)) break;
          subOpNode = inner;
        }

        if (!locIsNull(subC0) && !locIsNull(subC1) && !locIsNull(subC2) && locMatches(subOpNode, ":")) {
          startVal = this.evalIntSubscript(subC0, dSize);
          stepVal = this.evalIntSubscript(subC2, dSize);
          stopVal = this.evalIntSubscript(c2, dSize);
        } else {
          startVal = this.evalIntSubscript(c0, dSize);
          stepVal = 1;
          stopVal = this.evalIntSubscript(c2, dSize);
        }
      }

      this.currentDimEnd = prevEnd;
      if (stepVal > 0) {
        for (let k: i32 = startVal; k <= stopVal; k += stepVal) {
          outBuffer.push(k as u32);
        }
      } else if (stepVal < 0) {
        for (let k: i32 = startVal; k >= stopVal; k += stepVal) {
          outBuffer.push(k as u32);
        }
      }
      return true;
    }

    // 4. Scalar integer
    let val = this.evalIntSubscript(subLoc, dSize);
    this.currentDimEnd = prevEnd;
    outBuffer.push(val as u32);
    return false;
  }

  lowerArraySlice(compRefLoc: u64, subLoc: u64, pool: ArenaStringPool): u32 {
    let baseNameId = this.extractBaseRefName(compRefLoc, subLoc, pool);
    if (baseNameId == 0) return 0xffffffff;

    let prefixId = this.scopeStackPtr != 0 ? changetype<ScopeStack>(this.scopeStackPtr).currentPrefixPathId : 0;
    let fullBaseId = prefixId != 0 ? pool.concatIds(prefixId, baseNameId) : baseNameId;
    fullBaseId = this.resolveVarName(fullBaseId);

    // Determine dimensions of base array
    let d1: u32 = 0;
    let d2: u32 = 0;
    let d3: u32 = 0;
    if (this.flattenerPtr != 0) {
      d1 = this.getArrayShapeDim(fullBaseId, 1);
      d2 = this.getArrayShapeDim(fullBaseId, 2);
      d3 = this.getArrayShapeDim(fullBaseId, 3);
      if (d1 == 0 && prefixId != 0) {
        d1 = this.getArrayShapeDim(baseNameId, 1);
        d2 = this.getArrayShapeDim(baseNameId, 2);
        d3 = this.getArrayShapeDim(baseNameId, 3);
      }
    }
    let constArrayCtor: u32 = 0xffffffff;
    if (d1 == 0) {
      if (this.dae.lookupVariableByName(concatArrayIndex2D(pool, fullBaseId, 1, 1)) >= 0) {
        while (this.dae.lookupVariableByName(concatArrayIndex2D(pool, fullBaseId, d1 + 1, 1)) >= 0) d1++;
        while (this.dae.lookupVariableByName(concatArrayIndex2D(pool, fullBaseId, 1, d2 + 1)) >= 0) d2++;
      } else if (this.dae.lookupVariableByName(concatArrayIndex1D(pool, fullBaseId, 1)) >= 0) {
        while (this.dae.lookupVariableByName(concatArrayIndex1D(pool, fullBaseId, d1 + 1)) >= 0) d1++;
      } else if (this.dae.lookupVariableByName(concatArrayIndex1D(pool, baseNameId, 1)) >= 0) {
        fullBaseId = baseNameId;
        while (this.dae.lookupVariableByName(concatArrayIndex1D(pool, fullBaseId, d1 + 1)) >= 0) d1++;
      } else if (this.flattenerPtr != 0 && pool.hasDot(baseNameId)) {
        let flattener = changetype<ModelicaFlattener>(this.flattenerPtr);
        let pkgId = pool.getParentPrefix(baseNameId);
        let compId = getPathLastPart(pool, baseNameId);
        let pkgLoc: u64 = flattener.findClassLoc(flattener.currentClassLoc, pkgId, pool);
        if (!locIsNull(pkgLoc)) {
          let compDecl = findComponentDeclInClass(pkgLoc, compId, pool);
          if (!locIsNull(compDecl)) {
            let declSub = locFindChild(compDecl, SyntaxType.ARRAY_SUBSCRIPTS);
            if (!locIsNull(declSub)) {
              let dims = parseArrayDimensionsLoc(declSub, this.dae, pool);
              d1 = (dims >> 32) as u32;
            }
            let modLoc = locFindDescendant(compDecl, SyntaxType.MODIFICATION);
            let bExpr = findBindingExpressionLoc(modLoc);
            if (!locIsNull(bExpr)) {
              constArrayCtor = this.visitLoc(bExpr);
              let typeSpecLoc = locFindDescendant(compDecl, SyntaxType.TYPE_SPECIFIER);
              if (locIsNull(typeSpecLoc)) typeSpecLoc = locFindDescendant(pkgLoc, SyntaxType.TYPE_SPECIFIER);
              let isReal = !locIsNull(typeSpecLoc) && locMatches(typeSpecLoc, "Real");
              if (isReal && constArrayCtor != 0xffffffff && !this.isRealExpr(constArrayCtor)) {
                constArrayCtor = this.castToReal(constArrayCtor);
              }
              if (d1 == 0 && constArrayCtor != 0xffffffff && this.dae.getExprKind(constArrayCtor) == ExprKind.ArrayCtor) {
                d1 = getArrayCtorCount(this.dae, constArrayCtor);
              }
            }
          }
        }
      }
    }

    this.subLoc1 = 0;
    this.subLoc2 = 0;
    this.subLoc3 = 0;
    this.collectSubscriptLocs(subLoc);

    if (this.subLoc1 == 0) return 0xffffffff;

    let subCount: u32 = this.subLoc3 != 0 ? 3 : (this.subLoc2 != 0 ? 2 : 1);

    // Parse dim 1
    let dim1Start = this.tempBuffer.length;
    let isSlice1 = this.parseSubscriptIndices(this.subLoc1, this.tempBuffer, d1 > 0 ? d1 : 1);
    let count1 = this.tempBuffer.length - dim1Start;

    // Parse dim 2 (if present)
    let dim2Start = this.tempBuffer.length;
    let isSlice2 = false;
    let count2: u32 = 0;
    if (subCount >= 2 && this.subLoc2 != 0) {
      isSlice2 = this.parseSubscriptIndices(this.subLoc2, this.tempBuffer, d2 > 0 ? d2 : 1);
      count2 = this.tempBuffer.length - dim2Start;
    }

    // Parse dim 3 (if present)
    let dim3Start = this.tempBuffer.length;
    let isSlice3 = false;
    let count3: u32 = 0;
    if (subCount >= 3 && this.subLoc3 != 0) {
      isSlice3 = this.parseSubscriptIndices(this.subLoc3, this.tempBuffer, d3 > 0 ? d3 : 1);
      count3 = this.tempBuffer.length - dim3Start;
    }

    let numSlices: u32 = (isSlice1 ? 1 : 0) + (isSlice2 ? 1 : 0) + (isSlice3 ? 1 : 0);
    if (numSlices == 0) {
      this.tempBuffer.length = dim1Start;
      return 0xffffffff;
    }

    // Case 1: 1D slice output (numSlices == 1)
    if (numSlices == 1) {
      let resStart = this.tempBuffer.length;
      if (isSlice1) {
        let fixedCol = count2 > 0 ? this.tempBuffer.get(dim2Start) : 1;
        let fixedK = count3 > 0 ? this.tempBuffer.get(dim3Start) : 1;
        for (let i: u32 = 0; i < count1; i++) {
          let row = this.tempBuffer.get(dim1Start + i);
          let elemExpr: u32 = 0;
          if (constArrayCtor != 0xffffffff && this.dae.getExprKind(constArrayCtor) == ExprKind.ArrayCtor) {
            let cCount = getArrayCtorCount(this.dae, constArrayCtor);
            if (row >= 1 && (row - 1) < cCount) {
              elemExpr = getArrayCtorElement(this.dae, constArrayCtor, row - 1);
            }
          }
          if (elemExpr == 0) {
            let elemNameId: u32 = 0;
            if (subCount >= 3) elemNameId = concatArrayIndex3D(pool, fullBaseId, row, fixedCol, fixedK);
            else if (subCount >= 2) elemNameId = concatArrayIndex2D(pool, fullBaseId, row, fixedCol);
            else elemNameId = concatArrayIndex1D(pool, fullBaseId, row);
            elemExpr = this.dae.addExpression(ExprKind.Name, elemNameId);
          }
          this.tempBuffer.push(elemExpr);
        }
        let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, resStart, count1);
        this.tempBuffer.length = dim1Start;
        return ctorId;
      } else if (isSlice2) {
        let fixedRow = this.tempBuffer.get(dim1Start);
        let fixedK = count3 > 0 ? this.tempBuffer.get(dim3Start) : 1;
        for (let j: u32 = 0; j < count2; j++) {
          let col = this.tempBuffer.get(dim2Start + j);
          let elemNameId: u32 = 0;
          if (subCount >= 3) elemNameId = concatArrayIndex3D(pool, fullBaseId, fixedRow, col, fixedK);
          else elemNameId = concatArrayIndex2D(pool, fullBaseId, fixedRow, col);
          let elemExpr = this.dae.addExpression(ExprKind.Name, elemNameId);
          this.tempBuffer.push(elemExpr);
        }
        let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, resStart, count2);
        this.tempBuffer.length = dim1Start;
        return ctorId;
      }
    }

    // Case 2: 2D matrix slice output (numSlices == 2)
    if (numSlices == 2 && isSlice1 && isSlice2) {
      let matStart = this.tempBuffer.length;
      for (let i: u32 = 0; i < count1; i++) {
        let row = this.tempBuffer.get(dim1Start + i);
        let rowStart = this.tempBuffer.length;
        for (let j: u32 = 0; j < count2; j++) {
          let col = this.tempBuffer.get(dim2Start + j);
          let elemNameId = concatArrayIndex2D(pool, fullBaseId, row, col);
          let elemExpr = this.dae.addExpression(ExprKind.Name, elemNameId);
          this.tempBuffer.push(elemExpr);
        }
        let rowCtor = addArrayCtorFromChunked(this.dae, this.tempBuffer, rowStart, count2);
        this.tempBuffer.length = rowStart;
        this.tempBuffer.push(rowCtor);
      }
      let matCtor = addArrayCtorFromChunked(this.dae, this.tempBuffer, matStart, count1);
      this.tempBuffer.length = dim1Start;
      return matCtor;
    }

    this.tempBuffer.length = dim1Start;
    return 0xffffffff;
  }

  visitLoc(loc: u64): u32 {
    if (locIsNull(loc)) return 0xffffffff;

    // 1. Unwrap single-child wrapper nodes, ignoring zero-length epsilon nodes
    while (true) {
      let t = locType(loc);
      if (t == SyntaxType.IDENTIFIER || t == SyntaxType.TOKEN_IDENTIFIER_ALT ||
          t == SyntaxType.NAME || t == SyntaxType.COMPONENT_REFERENCE ||
          t == SyntaxType.UNSIGNED_INTEGER || t == SyntaxType.TOKEN_UNSIGNED_INT_ALT ||
          t == SyntaxType.UNSIGNED_REAL || t == SyntaxType.STRING_LITERAL ||
          t == SyntaxType.TRUE || t == SyntaxType.FALSE || t == SyntaxType.TIME ||
          (locType(loc) as u32) == 23 || locMatches(loc, "end")) {
        break;
      }
      let nonZeroCount: u32 = 0;
      let onlyChild: u64 = 0;
      let ch = locFirstChild(loc);
      while (!locIsNull(ch)) {
        if (locLen(ch) > 0) {
          nonZeroCount++;
          onlyChild = ch;
        }
        ch = locNextSibling(ch);
      }
      if (nonZeroCount == 1) {
        loc = onlyChild;
      } else {
        break;
      }
    }

    let t = locType(loc);

    // 2. Standalone colon
    if (locMatches(loc, ":")) {
      return this.dae.addExpression(ExprKind.Colon, 0, 0xffffffff, 0xffffffff);
    }

    // 3. Array & Matrix Constructors
    let firstCh = locFirstNonEmptyChild(loc);
    let lastCh = locLastNonEmptyChild(loc);
    if (!locIsNull(firstCh) && !locIsNull(lastCh)) {
      if (locMatches(firstCh, "{") && locMatches(lastCh, "}")) {
        let forInd = locFindDescendant(loc, SyntaxType.FOR_INDICES);
        if (!locIsNull(forInd)) {
          return this.lowerArrayComprehension(loc, forInd);
        }
        let arrStart = this.tempBuffer.length;
        this.collectArrayElements(loc, this.tempBuffer);
        let arrCount = this.tempBuffer.length - arrStart;
        let hasReal = false;
        for (let i: u32 = 0; i < arrCount; i++) {
          if (this.isRealExpr(this.tempBuffer.get(arrStart + i))) {
            hasReal = true;
            break;
          }
        }
        if (hasReal) {
          for (let i: u32 = 0; i < arrCount; i++) {
            let eid = this.tempBuffer.get(arrStart + i);
            if (!this.isRealExpr(eid)) {
              this.tempBuffer.set(arrStart + i, this.castToReal(eid));
            }
          }
        }
        let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, arrStart, arrCount);
        this.tempBuffer.length = arrStart;
        return ctorId;
      }

      if (locMatches(firstCh, "[") && locMatches(lastCh, "]") && (locType(loc) as u32) != (SyntaxType.ARRAY_SUBSCRIPTS as u32)) {
        let hasSemicolon = false;
        let c = locFirstChild(loc);
        while (!locIsNull(c)) {
          if (locMatches(c, ";")) { hasSemicolon = true; break; }
          c = locNextSibling(c);
        }
        let matStart = this.tempBuffer.length;
        this.collectMatrixRows(loc, this.tempBuffer);
        let rowCount = this.tempBuffer.length - matStart;
        let matCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, matStart, rowCount);
        this.tempBuffer.length = matStart;
        return matCtorId;
      }
    }

    // 4. Parenthesized expression
    let nonZeroCount = locNonEmptyChildCount(loc);
    if (nonZeroCount == 3 && !locIsNull(firstCh) && !locIsNull(lastCh) &&
        locMatches(firstCh, "(") && locMatches(lastCh, ")")) {
      let middle = locNextNonEmptySibling(firstCh);
      if (!locIsNull(middle) && middle != lastCh) {
        return this.visitLoc(middle);
      }
    }

    // 5. If-Else expression: if cond then e1 [elseif cond2 then e2 ...] else e_last
    if (!locIsNull(firstCh) && (locMatches(firstCh, "if") || (locType(firstCh) as u32) == (SyntaxType.TOKEN_IF as u32))) {
      let branchStart = this.tempBuffer.length;
      let curr = locFirstChild(loc);
      let elseExprId: u32 = 0xffffffff;
      while (!locIsNull(curr)) {
        if (locLen(curr) > 0) {
          if (locMatches(curr, "if") || locMatches(curr, "elseif")) {
            let condNode = locNextNonEmptySibling(curr);
            if (!locIsNull(condNode)) {
              let thenTok = locNextNonEmptySibling(condNode);
              if (!locIsNull(thenTok)) {
                let thenNode = locNextNonEmptySibling(thenTok);
                if (!locIsNull(thenNode)) {
                  let condId = this.visitLoc(condNode);
                  let thenId = this.visitLoc(thenNode);
                  this.tempBuffer.push(condId);
                  this.tempBuffer.push(thenId);
                }
              }
            }
          } else if (locMatches(curr, "else")) {
            let elseNode = locNextNonEmptySibling(curr);
            if (!locIsNull(elseNode)) {
              elseExprId = this.visitLoc(elseNode);
            }
            break;
          }
        }
        curr = locNextSibling(curr);
      }
      let branchCount = (this.tempBuffer.length - branchStart) / 2;
      let currElseId = elseExprId;
      for (let b: i32 = (branchCount as i32) - 1; b >= 0; b--) {
        let condId = this.tempBuffer.get(branchStart + (b as u32) * 2);
        let thenId = this.tempBuffer.get(branchStart + (b as u32) * 2 + 1);
        let isEvaluated = false;
        if (this.dae.getExprKind(condId) == ExprKind.BoolLiteral) {
          let condVal = this.dae.getExprData1(condId);
          if (condVal != 0) {
            currElseId = thenId;
          }
          isEvaluated = true;
        } else if (this.flattenerPtr != 0) {
          let flattener = changetype<ModelicaFlattener>(this.flattenerPtr);
          let st = flattener.evalCondExpr(condId);
          if (st == 1) {
            currElseId = thenId;
            isEvaluated = true;
          } else if (st == 0) {
            isEvaluated = true;
          }
        }
        if (isEvaluated) continue;
        if (this.isRealExpr(thenId) && !this.isRealExpr(currElseId)) {
          currElseId = this.castToReal(currElseId);
        } else if (!this.isRealExpr(thenId) && this.isRealExpr(currElseId)) {
          thenId = this.castToReal(thenId);
        }
        currElseId = this.dae.addIfElse(condId, thenId, currElseId);
      }
      this.tempBuffer.length = branchStart;
      return currElseId;
    }

    // 6. Function calls (when FUNCTION_CALL_ARGS is present)
    let callArgsLoc = locFindChild(loc, SyntaxType.FUNCTION_CALL_ARGS);
    if (!locIsNull(callArgsLoc)) {
      if (locIsNull(firstCh) || (locType(firstCh) != SyntaxType.DER && !locMatches(firstCh, "der"))) {
        let compRef = locFindChild(loc, SyntaxType.COMPONENT_REFERENCE);
        if (locIsNull(compRef)) compRef = locFirstNonEmptyChild(loc);
        let pool = this.dae.getStringPool();
        let fnNameId = locIntern(pool, compRef);
        let forInd = locFindDescendant(callArgsLoc, SyntaxType.FOR_INDICES);
        if (!locIsNull(forInd)) {
          let redRes = this.lowerReduction(fnNameId, callArgsLoc, forInd);
          if (redRes != 0xffffffff) return redRes;
        }
        let argStart = this.tempBuffer.length;
        this.collectFunctionArguments(callArgsLoc, this.tempBuffer);
        let argCount = this.tempBuffer.length - argStart;
        let resCall = this.lowerFunctionCall(fnNameId, argStart, argCount);
        if (resCall != 0xffffffff) {
          this.tempBuffer.length = argStart;
          return resCall;
        }
        let callId = this.dae.addExpression(ExprKind.Call, fnNameId, argCount > 0 ? this.tempBuffer.get(argStart) : 0xffffffff, argCount);
        for (let i: u32 = 1; i < argCount; i++) {
          this.dae.addExpression(ExprKind.Tuple, 0, this.tempBuffer.get(argStart + i), 0);
        }
        this.tempBuffer.length = argStart;
        return callId;
      }
    }

    // 7. Numbers
    if (t == SyntaxType.UNSIGNED_INTEGER || t == SyntaxType.TOKEN_UNSIGNED_INT_ALT) {
      let val = locParseInt(loc);
      return this.dae.addIntLiteral(val);
    }
    if (t == SyntaxType.UNSIGNED_REAL) {
      let val = locParseReal(loc);
      return this.dae.addRealLiteral(val);
    }
    if (t == SyntaxType.UNSIGNED_NUMBER) {
      if (locHasDotOrExp(loc)) {
        let val = locParseReal(loc);
        return this.dae.addRealLiteral(val);
      } else {
        let val = locParseInt(loc);
        return this.dae.addIntLiteral(val);
      }
    }

    // 8. Literals & Keywords
    if (t == SyntaxType.TRUE || locMatches(loc, "true")) {
      return this.dae.addExpression(ExprKind.BoolLiteral, 1);
    }
    if (t == SyntaxType.FALSE || locMatches(loc, "false")) {
      return this.dae.addExpression(ExprKind.BoolLiteral, 0);
    }
    if (t == SyntaxType.TIME || locMatches(loc, "time")) {
      let pool = this.dae.getStringPool();
      let timeId = locIntern(pool, loc);
      return this.dae.addExpression(ExprKind.Name, timeId);
    }
    if (((locType(loc) as u32) == 23 || locMatches(loc, "end")) && this.currentDimEnd > 0) {
      return this.dae.addIntLiteral(this.currentDimEnd);
    }
    if (t == SyntaxType.STRING_LITERAL) {
      let pool = this.dae.getStringPool();
      let len = locLen(loc);
      let bytes = locBytes(loc);
      if (len >= 2 && load<u8>(bytes + 1) == 0) {
        if (len >= 4 && load<u16>(bytes) == 34 && load<u16>(bytes + (len as usize) - 2) == 34) {
          let strId = pool.internUtf16(bytes + 2, len - 4);
          return this.dae.addExpression(ExprKind.StringLiteral, strId);
        }
        let strId = pool.internUtf16(bytes, len);
        return this.dae.addExpression(ExprKind.StringLiteral, strId);
      }
      if (len >= 2 && load<u8>(bytes) == 34 && load<u8>(bytes + (len as usize) - 1) == 34) {
        let strId = pool.intern(bytes + 1, len - 2);
        return this.dae.addExpression(ExprKind.StringLiteral, strId);
      }
      let strId = locIntern(pool, loc);
      return this.dae.addExpression(ExprKind.StringLiteral, strId);
    }

    // 9. Identifiers & Component References (with 1D, 2D and 3D subscripts)
    if (t == SyntaxType.IDENTIFIER || t == SyntaxType.TOKEN_IDENTIFIER_ALT || t == SyntaxType.NAME || t == SyntaxType.COMPONENT_REFERENCE) {
      let pool = this.dae.getStringPool();
      let nameId = locIntern(pool, loc);
      let loopVal = this.getLoopVar(nameId);
      if (loopVal != 0xffffffff) return loopVal;
      if (this.flattenerPtr != 0) {
        let flattener = changetype<ModelicaFlattener>(this.flattenerPtr);
        let enumVal = flattener.lookupEnumLiteral(nameId);
        if (enumVal == 0 && this.scopeStackPtr != 0) {
          let prefixId = changetype<ScopeStack>(this.scopeStackPtr).currentPrefixPathId;
          if (prefixId != 0) {
            let prefixedId = pool.concatIds(prefixId, nameId);
            enumVal = flattener.lookupEnumLiteral(prefixedId);
          }
        }
        if (enumVal != 0) {
          let ordinal = (enumVal >> 32) as u32;
          let fullPathId = (enumVal & 0xffffffff) as u32;
          return this.dae.addExpression(ExprKind.EnumLiteral, ordinal, fullPathId);
        }
      }
      if (this.envPtr != 0) {
        let modExpr = changetype<ModificationEnvironment>(this.envPtr).lookupPath(pool, nameId);
        if (modExpr != 0xffffffff) return modExpr;
      }
      if (this.scopeStackPtr != 0) {
        let ss = changetype<ScopeStack>(this.scopeStackPtr);
        let prefixId = ss.currentPrefixPathId;
        if (prefixId != 0) {
          let prefixedId = pool.concatIds(prefixId, nameId);
          prefixedId = this.resolveVarName(prefixedId);
          let varIdx = this.dae.lookupVariableByName(prefixedId);
          if (varIdx >= 0) {
            let varAcc = VarAccessor.at(this.dae.getVarData(), varIdx as u32);
            if (varAcc.variability == Variability.Constant) {
              let bExpr = this.dae.getVarAttrExpr(varIdx as u32, VarAttrKind.Binding as u32);
              if (bExpr != 0 && bExpr != 0xffffffff) {
                let bk = this.dae.getExprKind(bExpr);
                if (bk == ExprKind.RealLiteral || bk == ExprKind.IntLiteral || bk == ExprKind.BoolLiteral) {
                  return bExpr;
                }
              }
              let vt = varAcc.varType;
              if (vt == VarType.Real) return this.dae.addRealLiteral(varAcc.startValue);
              if (vt == VarType.Integer) return this.dae.addIntLiteral(varAcc.startValue as i32);
              if (vt == VarType.Boolean) return this.dae.addExpression(ExprKind.BoolLiteral, varAcc.startValue != 0.0 ? 1 : 0);
              if (vt == VarType.Enumeration) return this.dae.addExpression(ExprKind.EnumLiteral, varAcc.startValue as i32, 0);
            }
            return this.dae.addExpression(ExprKind.Name, prefixedId);
          }
        }

        let modExpr = ss.lookup(nameId);
        if (modExpr != 0xffffffff) {
          if (prefixId == 0 || this.dae.getExprKind(modExpr) != ExprKind.ArrayCtor || (ss.currentEnvPtr != 0 && changetype<ModificationEnvironment>(ss.currentEnvPtr).lookup(nameId) != 0xffffffff)) {
            return modExpr;
          }
        }
      }
      let resolvedSimpleId = this.resolveVarName(nameId);
      let varIdx = this.dae.lookupVariableByName(resolvedSimpleId);
      if (varIdx >= 0) {
        let varAcc = VarAccessor.at(this.dae.getVarData(), varIdx as u32);
        if (varAcc.variability == Variability.Constant) {
          let bExpr = this.dae.getVarAttrExpr(varIdx as u32, VarAttrKind.Binding as u32);
          if (bExpr != 0 && bExpr != 0xffffffff) {
            let bk = this.dae.getExprKind(bExpr);
            if (bk == ExprKind.RealLiteral || bk == ExprKind.IntLiteral || bk == ExprKind.BoolLiteral) {
              return bExpr;
            }
          }
          let vt = varAcc.varType;
          if (vt == VarType.Real) return this.dae.addRealLiteral(varAcc.startValue);
          if (vt == VarType.Integer) return this.dae.addIntLiteral(varAcc.startValue as i32);
          if (vt == VarType.Boolean) return this.dae.addExpression(ExprKind.BoolLiteral, varAcc.startValue != 0.0 ? 1 : 0);
          if (vt == VarType.Enumeration) return this.dae.addExpression(ExprKind.EnumLiteral, varAcc.startValue as i32, 0);
        }
        return this.dae.addExpression(ExprKind.Name, resolvedSimpleId);
      }

      let sliceSubLoc = this.findSliceSubscript(loc);
      if (sliceSubLoc != 0) {
        let sliceExprId = this.lowerArraySlice(loc, sliceSubLoc, pool);
        if (sliceExprId != 0xffffffff) return sliceExprId;
      }

      let subLoc = locFindDescendant(loc, SyntaxType.ARRAY_SUBSCRIPTS);
      if (!locIsNull(subLoc)) {
        if (this.symbolicSubscripts) {
          let symId = this.tryLowerSymbolicRef(loc, subLoc, pool);
          if (symId != 0xffffffff) return symId;
        }
        let resolvedNameId = this.appendComponentRefParts(loc, pool, 0);
        if (resolvedNameId != 0) {
          if (this.scopeStackPtr != 0) {
            let modExpr = changetype<ScopeStack>(this.scopeStackPtr).lookup(resolvedNameId);
            if (modExpr != 0xffffffff) return modExpr;
          }
          let prefixId = this.scopeStackPtr != 0 ? changetype<ScopeStack>(this.scopeStackPtr).currentPrefixPathId : 0;
          let fullBaseId = prefixId != 0 ? pool.concatIds(prefixId, resolvedNameId) : resolvedNameId;
          fullBaseId = this.resolveVarName(fullBaseId);
          return this.dae.addExpression(ExprKind.Name, fullBaseId);
        }
      }

      let prefixId = this.scopeStackPtr != 0 ? changetype<ScopeStack>(this.scopeStackPtr).currentPrefixPathId : 0;
      let fullBaseId = prefixId != 0 ? pool.concatIds(prefixId, nameId) : nameId;
      fullBaseId = this.resolveVarName(fullBaseId);
      return this.dae.addExpression(ExprKind.Name, fullBaseId);
    }

    // 10. Binary expressions (child count == 3)
    if (nonZeroCount == 3) {
      let c0: u64 = 0;
      let c1: u64 = 0;
      let c2: u64 = 0;
      let ch = locFirstChild(loc);
      while (!locIsNull(ch)) {
        if (locLen(ch) > 0) {
          if (c0 == 0) c0 = ch;
          else if (c1 == 0) c1 = ch;
          else if (c2 == 0) { c2 = ch; break; }
        }
        ch = locNextSibling(ch);
      }

      let left = this.visitLoc(c0);
      let right = this.visitLoc(c2);
      if (left != 0xffffffff && right != 0xffffffff) {
        let opNode = c1;
        while (locChildCount(opNode) > 0) {
          let inner = locFirstNonEmptyChild(opNode);
          if (locIsNull(inner)) break;
          opNode = inner;
        }
        let opType = locType(opNode);
        if (opType == SyntaxType.OP_ADD || locMatches(opNode, "+")) return this.lowerBinary(BinOp.Add as u16, left, right);
        if (opType == SyntaxType.OP_SUB || locMatches(opNode, "-")) return this.lowerBinary(BinOp.Sub as u16, left, right);
        if (opType == SyntaxType.OP_MUL || locMatches(opNode, "*")) return this.lowerBinary(BinOp.Mul as u16, left, right);
        if (opType == SyntaxType.OP_DIV || locMatches(opNode, "/")) return this.lowerBinary(BinOp.Div as u16, left, right);
        if (opType == SyntaxType.OP_POW || locMatches(opNode, "^")) return this.lowerBinary(BinOp.Pow as u16, left, right);
        if (locMatches(opNode, ".+")) return this.lowerBinary(BinOp.ElemAdd as u16, left, right);
        if (locMatches(opNode, ".-")) return this.lowerBinary(BinOp.ElemSub as u16, left, right);
        if (locMatches(opNode, ".*")) return this.lowerBinary(BinOp.ElemMul as u16, left, right);
        if (locMatches(opNode, "./")) return this.lowerBinary(BinOp.ElemDiv as u16, left, right);
        if (locMatches(opNode, ".^")) return this.lowerBinary(BinOp.ElemPow as u16, left, right);
        if (locMatches(opNode, ":")) {
          let u0 = c0;
          while (true) {
            let t0 = locType(u0);
            if (t0 == SyntaxType.IDENTIFIER || t0 == SyntaxType.TOKEN_IDENTIFIER_ALT ||
                t0 == SyntaxType.NAME || t0 == SyntaxType.COMPONENT_REFERENCE ||
                t0 == SyntaxType.UNSIGNED_INTEGER || t0 == SyntaxType.TOKEN_UNSIGNED_INT_ALT ||
                t0 == SyntaxType.UNSIGNED_REAL || t0 == SyntaxType.STRING_LITERAL ||
                t0 == SyntaxType.TRUE || t0 == SyntaxType.FALSE || t0 == SyntaxType.TIME) {
              break;
            }
            let nzCount: u32 = 0;
            let onlyCh: u64 = 0;
            let ch0 = locFirstChild(u0);
            while (!locIsNull(ch0)) {
              if (locLen(ch0) > 0) {
                nzCount++;
                onlyCh = ch0;
              }
              ch0 = locNextSibling(ch0);
            }
            if (nzCount == 1) {
              u0 = onlyCh;
            } else {
              break;
            }
          }
          let c0nonZero = locNonEmptyChildCount(u0);
          if (c0nonZero == 3) {
            let u0_0: u64 = 0;
            let u0_1: u64 = 0;
            let u0_2: u64 = 0;
            let ch0 = locFirstChild(u0);
            while (!locIsNull(ch0)) {
              if (locLen(ch0) > 0) {
                if (u0_0 == 0) u0_0 = ch0;
                else if (u0_1 == 0) u0_1 = ch0;
                else if (u0_2 == 0) { u0_2 = ch0; break; }
              }
              ch0 = locNextSibling(ch0);
            }
            let leftOpNode = u0_1;
            while (locChildCount(leftOpNode) > 0) {
              let inner = locFirstNonEmptyChild(leftOpNode);
              if (locIsNull(inner)) break;
              leftOpNode = inner;
            }
            if (!locIsNull(leftOpNode) && locMatches(leftOpNode, ":")) {
              let startId = this.visitLoc(u0_0);
              let stepId = this.visitLoc(u0_2);
              let stopId = right;
              let rangeId = this.dae.addExpression(ExprKind.Range, startId, stepId, stopId);
              if (this.keepRanges) return rangeId;
              let expId = expandColonToArrayCtor(this.dae, rangeId, this.tempBuffer);
              return expId != 0xffffffff ? expId : rangeId;
            }
          }
          let rangeId = this.dae.addExpression(ExprKind.Range, left, 0xffffffff, right);
          if (this.keepRanges) return rangeId;
          let expId = expandColonToArrayCtor(this.dae, rangeId, this.tempBuffer);
          return expId != 0xffffffff ? expId : rangeId;
        }
        if (opType == SyntaxType.OP_LT || locMatches(opNode, "<")) return this.lowerBinary(BinOp.Lt as u16, left, right);
        if (opType == SyntaxType.OP_LE || locMatches(opNode, "<=")) return this.lowerBinary(BinOp.Lte as u16, left, right);
        if (opType == SyntaxType.OP_GT || locMatches(opNode, ">")) return this.lowerBinary(BinOp.Gt as u16, left, right);
        if (opType == SyntaxType.OP_GE || locMatches(opNode, ">=")) return this.lowerBinary(BinOp.Gte as u16, left, right);
        if (opType == SyntaxType.OP_EQ || locMatches(opNode, "==")) return this.lowerBinary(BinOp.Eq as u16, left, right);
        if (opType == SyntaxType.OP_NEQ || locMatches(opNode, "<>")) return this.lowerBinary(BinOp.Neq as u16, left, right);
        if (opType == SyntaxType.OP_AND || locMatches(opNode, "and")) return this.lowerBinary(BinOp.And as u16, left, right);
        if (opType == SyntaxType.OP_OR || locMatches(opNode, "or")) return this.lowerBinary(BinOp.Or as u16, left, right);
      }
    }

    // 11. Unary expressions (child count == 2)
    if (nonZeroCount == 2) {
      let c0: u64 = 0;
      let c1: u64 = 0;
      let ch = locFirstChild(loc);
      while (!locIsNull(ch)) {
        if (locLen(ch) > 0) {
          if (c0 == 0) c0 = ch;
          else if (c1 == 0) { c1 = ch; break; }
        }
        ch = locNextSibling(ch);
      }
      let opNode = c0;
      while (locChildCount(opNode) > 0) {
        let inner = locFirstNonEmptyChild(opNode);
        if (locIsNull(inner)) break;
        opNode = inner;
      }
      let opType = locType(opNode);
      if (opType == SyntaxType.OP_SUB || locMatches(opNode, "-")) {
        let operand = this.visitLoc(c1);
        if (operand == 0xffffffff) return 0xffffffff;
        return this.lowerUnary(UnaryOp.Negate as u16, operand);
      }
      if (opType == SyntaxType.OP_ADD || locMatches(opNode, "+")) {
        return this.visitLoc(c1);
      }
      if (opType == SyntaxType.OP_NOT || locMatches(opNode, "not")) {
        let operand = this.visitLoc(c1);
        if (operand == 0xffffffff) return 0xffffffff;
        return this.lowerUnary(UnaryOp.Not as u16, operand);
      }
    }

    // 12. der(...) call
    let firstChDer = locFirstNonEmptyChild(loc);
    if (!locIsNull(firstChDer) && (locType(firstChDer) == SyntaxType.DER || locMatches(firstChDer, "der"))) {
      let argChild = locFindDescendant(loc, SyntaxType.EXPRESSION);
      if (locIsNull(argChild)) argChild = locFindDescendant(loc, SyntaxType.COMPONENT_REFERENCE);
      if (!locIsNull(argChild)) {
        let argExpr = this.visitLoc(argChild);
        if (argExpr != 0xffffffff) {
          let argKind = this.dae.getExprKind(argExpr);
          if (argKind == ExprKind.Name || argKind == ExprKind.Subscript || argKind == ExprKind.ArrayCtor) {
            return this.dae.addDer(argExpr);
          }
          return 0xffffffff;
        }
      }
    }

    return 0xffffffff;
  }

  visit(nodePtr: u32): u32 {
    if (nodePtr == 0) return 0xffffffff;
    return this.visitLoc(locMake(nodePtr, 0));
  }
}

const CONN_PAIR_SLOTS: u32 = 64;
const CONN_PAIR_MASK: u32 = CONN_PAIR_SLOTS - 1;
let g_connPairIdx: u32 = 0;
let g_connPairBuf: usize = 0;

/**
 * Zero-cost unmanaged view over a connection pair 4-tuple: [var1, var2, isFlow, isBoundary].
 */
@unmanaged
export class ConnectionPairView {
  private _data: ChunkedUint32Array;
  private _offset: u32;

  @inline static at(data: ChunkedUint32Array, pairIndex: u32): ConnectionPairView {
    if (g_connPairBuf == 0) {
      g_connPairBuf = atomicChunkAlloc(CONN_PAIR_SLOTS * (sizeof<usize>() * 2));
    }
    let slot = (g_connPairIdx++) & CONN_PAIR_MASK;
    let a = changetype<ConnectionPairView>(g_connPairBuf + slot * (sizeof<usize>() * 2));
    a._data = data;
    a._offset = pairIndex * 4;
    return a;
  }

  @inline get var1(): u32 { return this._data.get(this._offset + 0); }
  @inline set var1(val: u32) { this._data.set(this._offset + 0, val); }

  @inline get var2(): u32 { return this._data.get(this._offset + 1); }
  @inline set var2(val: u32) { this._data.set(this._offset + 1, val); }

  @inline get isFlow(): bool { return this._data.get(this._offset + 2) != 0; }
  @inline set isFlow(val: bool) { this._data.set(this._offset + 2, val ? 1 : 0); }

  @inline get isBoundary(): bool { return this._data.get(this._offset + 3) != 0; }
  @inline set isBoundary(val: bool) { this._data.set(this._offset + 3, val ? 1 : 0); }

  @inline set(var1: u32, var2: u32, isFlow: bool, isBoundary: bool): void {
    this._data.set(this._offset + 0, var1);
    this._data.set(this._offset + 1, var2);
    this._data.set(this._offset + 2, isFlow ? 1 : 0);
    this._data.set(this._offset + 3, isBoundary ? 1 : 0);
  }
}

/**
 * Encapsulated Union-Find Disjoint Set across connected components with connector cardinality tracking.
 */
@unmanaged
export class DisjointSet {
  parent: ChunkedUint32Array;
  rank: ChunkedUint32Array;
  cardinality: ChunkedUint32Array;
  capacity: u32;

  @inline static create(initialCapacity: u32 = 256): DisjointSet {
    let ptr = atomicChunkAlloc(offsetof<DisjointSet>());
    let ds = changetype<DisjointSet>(ptr);
    ds.init(initialCapacity);
    return ds;
  }

  init(initialCapacity: u32 = 256): void {
    this.capacity = initialCapacity;
    this.parent = createChunkedUint32Array(initialCapacity);
    this.rank = createChunkedUint32Array(initialCapacity);
    this.cardinality = createChunkedUint32Array(initialCapacity);
    for (let i: u32 = 0; i < initialCapacity; i++) {
      this.parent.set(i, i);
      this.rank.set(i, 0);
      this.cardinality.set(i, 0);
    }
  }

  reset(initialCapacity: u32 = 256): void {
    this.capacity = initialCapacity;
    for (let i: u32 = 0; i < initialCapacity; i++) {
      this.parent.set(i, i);
      this.rank.set(i, 0);
      this.cardinality.set(i, 0);
    }
  }

  ensureCapacity(varId: u32): void {
    if (varId >= this.capacity) {
      let newCap = (varId + 1) * 2;
      for (let i = this.capacity; i < newCap; i++) {
        this.parent.set(i, i);
        this.rank.set(i, 0);
        this.cardinality.set(i, 0);
      }
      this.capacity = newCap;
    }
  }

  find(v: u32): u32 {
    this.ensureCapacity(v);
    let p = this.parent.get(v);
    if (p != v) {
      p = this.find(p);
      this.parent.set(v, p);
    }
    return p;
  }

  union(v1: u32, v2: u32): void {
    let r1 = this.find(v1);
    let r2 = this.find(v2);
    if (r1 == r2) return;
    let rk1 = this.rank.get(r1);
    let rk2 = this.rank.get(r2);
    if (rk1 < rk2) {
      this.parent.set(r1, r2);
    } else if (rk1 > rk2) {
      this.parent.set(r2, r1);
    } else {
      this.parent.set(r2, r1);
      this.rank.set(r1, rk1 + 1);
    }
  }

  getCardinality(v: u32): u32 {
    this.ensureCapacity(v);
    return this.cardinality.get(v);
  }

  incrementCardinality(v: u32): void {
    this.ensureCapacity(v);
    this.cardinality.set(v, this.cardinality.get(v) + 1);
  }
}

/**
 * Modelica & Physical Semantic Flattening Engine in WebAssembly.
 */
@unmanaged
export class ModelicaFlattener {
  static poolBuf: usize = 0;
  static poolDepth: i32 = 0;

  daePtr: u32;
  exprVisitorPtr: u32;

  // Connection Graph Tracking: [var1, var2, isFlow, isBoundary] stride = 4
  connectionPairs: ChunkedUint32Array;
  connectionCount: u32;

  // Stream Connections: [h1, mdot1, h2, mdot2] stride = 4
  streamPairs: ChunkedUint32Array;
  streamCount: u32;

  // Encapsulated Union-Find Disjoint Set & Cardinality
  disjointSetPtr: u32;

  @inline get disjointSet(): DisjointSet {
    return changetype<DisjointSet>(this.disjointSetPtr);
  }

  // Backwards compatibility getters
  @inline get ufParent(): ChunkedUint32Array { return this.disjointSet.parent; }
  @inline get ufRank(): ChunkedUint32Array { return this.disjointSet.rank; }
  @inline get cardinalityMap(): ChunkedUint32Array { return this.disjointSet.cardinality; }

  // Inner/Outer Resolution Map: [nameHash -> varId]
  innerKeys: ChunkedUint32Array;
  innerVars: ChunkedUint32Array;
  innerCount: u32;

  // Inner Component Scope Registrations: [scopePrefixId, compNameId, fullPrefixId]
  innerScopePrefixes: ChunkedUint32Array;
  innerNames: ChunkedUint32Array;
  innerFullPaths: ChunkedUint32Array;
  innerRegCount: u32;

  // Outer-to-Inner Mappings: [outerPrefixId, targetInnerPrefixId]
  outerPaths: ChunkedUint32Array;
  targetInnerPaths: ChunkedUint32Array;
  outerMapCount: u32;

  // Expandable Connector Buses
  expandableBuses: ChunkedUint32Array;
  expandableBusCount: u32;
  busParent: ChunkedUint32Array;
  busRefSignalsBusIdx: ChunkedUint32Array;
  busRefSignalsRelId: ChunkedUint32Array;
  busRefSignalCount: u32;
  matchedBusPrefix: u32;
  matchedRelPath: u32;

  // Named Array Shapes: [nameId -> (dim1, dim2, dim3, dim4)]
  arrayNames: ChunkedUint32Array;
  arrayDim1: ChunkedUint32Array;
  arrayDim2: ChunkedUint32Array;
  arrayDim3: ChunkedUint32Array;
  arrayDim4: ChunkedUint32Array;
  arrayNDims: ChunkedUint32Array;
  arrayCount: u32;
  arrayNameIndexPtr: usize;

  // Pending Array Equation Bindings: [lhsExprId, rhsExprId]
  pendingArrayLhs: ChunkedUint32Array;
  pendingArrayRhs: ChunkedUint32Array;
  pendingArrayCount: u32;

  // Connect Equation References
  connectRef1: u64;
  connectRef2: u64;
  connectRefFound: i32;

  // Disabled components (due to 'if <cond>' evaluating to false)
  disabledNames: ChunkedUint32Array;
  disabledCount: u32;
  disabledSetPtr: usize;

  // Lexical Scope Stack
  scopeStackPtr: u32;

  // Root Program/Tree Node Pointer for resolving cross-class references
  rootProgramNodePtr: u32;
  rootProgramLoc: u64;
  currentClassLoc: u64;

  // Subtype attribute modifiers (from short class specifier or primitive extends clause)
  curSubtypeStartId: u32;
  curSubtypeFixedId: u32;
  curSubtypeMinId: u32;
  curSubtypeMaxId: u32;
  curSubtypeNominalId: u32;
  curSubtypeDisplayUnitId: u32;
  curSubtypeQuantityId: u32;

  // Flattening error flag
  hasError: boolean;
  errorCode: u32;
  // Absolute byte range (into the root program's input buffer) of the CST node that
  // triggered the bail-out; 0xffffffff when unknown.
  errorStartByte: u32;
  errorEndByte: u32;
  // Location of the simple equation currently being expanded, used to attribute
  // bail-outs raised from expression-level helpers such as emitExpandedEquation.
  curEqLoc: u64;

  // Algorithm sections emitted into the DAE statement arena: [start, count, isInitial] stride = 3
  algSections: ChunkedUint32Array;
  algSectionCount: u32;
  // Compound when/if equations emitted into DAE:
  whenRecords: ChunkedInt32Array;
  whenRecordCount: u32;
  ifRecords: ChunkedInt32Array;
  ifRecordCount: u32;
  // Stack-disciplined scratch buffers used while walking statements:
  // stmtItems holds CST locs as (lo, hi) u32 pairs, stmtAux holds per-construct records.
  stmtItems: ChunkedUint32Array;
  stmtAux: ChunkedUint32Array;
  scopeResolutionsPtr: usize;
  enumLiteralsPtr: usize;
  isOmcCompatibility: bool;
  savedModEnvPoolIdx: u32;
  isDestroyed: bool;
  scalarOutVal: f64;

  @inline static create(dae: DaeBuilder): ModelicaFlattener {
    if (ModelicaFlattener.poolDepth > 0) {
      ModelicaFlattener.poolDepth--;
      let ptr = load<usize>(ModelicaFlattener.poolBuf + (ModelicaFlattener.poolDepth * sizeof<usize>()));
      let obj = changetype<ModelicaFlattener>(ptr);
      obj.reset(dae);
      return obj;
    }
    let ptr = atomicChunkAlloc(offsetof<ModelicaFlattener>());
    let obj = changetype<ModelicaFlattener>(ptr);
    obj.init(dae);
    return obj;
  }

  @inline setError(code: u32): void {
    this.setErrorAt(code, this.curEqLoc);
  }

  setErrorAt(code: u32, loc: u64): void {
    if (this.hasError) return;
    this.hasError = true;
    this.errorCode = code;
    if (!locIsNull(loc)) {
      this.errorStartByte = locOffset(loc);
      this.errorEndByte = locOffset(loc) + locLen(loc);
    } else {
      this.errorStartByte = 0xffffffff;
      this.errorEndByte = 0xffffffff;
    }
  }

  @inline get rootProgramNode(): CstCursor {
    return CstCursor.wrap(this.rootProgramNodePtr);
  }

  @inline get dae(): DaeBuilder {
    return changetype<DaeBuilder>(this.daePtr);
  }

  @inline get exprVisitor(): WasmExprVisitor {
    return changetype<WasmExprVisitor>(this.exprVisitorPtr);
  }

  @inline get scopeStack(): ScopeStack {
    return changetype<ScopeStack>(this.scopeStackPtr);
  }

  init(dae: DaeBuilder): void {
    this.daePtr = changetype<usize>(dae) as u32;
    this.rootProgramNodePtr = 0;
    this.rootProgramLoc = 0;
    this.currentClassLoc = 0;
    this.hasError = false;
    this.errorCode = 0;
    this.errorStartByte = 0xffffffff;
    this.errorEndByte = 0xffffffff;
    this.curEqLoc = 0;
    this.curSubtypeStartId = 0xffffffff;
    this.curSubtypeFixedId = 0xffffffff;
    this.curSubtypeMinId = 0xffffffff;
    this.curSubtypeMaxId = 0xffffffff;
    this.curSubtypeNominalId = 0xffffffff;
    this.curSubtypeDisplayUnitId = 0xffffffff;
    this.curSubtypeQuantityId = 0xffffffff;
    let ss = ScopeStack.create();
    this.scopeStackPtr = changetype<usize>(ss) as u32;

    let ev = WasmExprVisitor.create(dae, 0, 0, this.scopeStackPtr, changetype<usize>(this) as u32);
    this.exprVisitorPtr = changetype<usize>(ev) as u32;

    this.connectionPairs = createChunkedUint32Array(1024 * 4);
    this.connectionCount = 0;
    this.streamPairs = createChunkedUint32Array(512 * 4);
    this.streamCount = 0;

    this.innerKeys = createChunkedUint32Array(256);
    this.innerVars = createChunkedUint32Array(256);
    this.innerCount = 0;

    this.innerScopePrefixes = createChunkedUint32Array(256);
    this.innerNames = createChunkedUint32Array(256);
    this.innerFullPaths = createChunkedUint32Array(256);
    this.innerRegCount = 0;

    this.outerPaths = createChunkedUint32Array(256);
    this.targetInnerPaths = createChunkedUint32Array(256);
    this.outerMapCount = 0;

    this.expandableBuses = createChunkedUint32Array(64);
    this.expandableBusCount = 0;
    this.busParent = createChunkedUint32Array(64);
    this.busRefSignalsBusIdx = createChunkedUint32Array(512);
    this.busRefSignalsRelId = createChunkedUint32Array(512);
    this.busRefSignalCount = 0;
    this.matchedBusPrefix = 0;
    this.matchedRelPath = 0;

    let maxVars = dae.varCount > 2048 ? dae.varCount + 512 : 2048;
    let ds = DisjointSet.create(maxVars);
    this.disjointSetPtr = changetype<usize>(ds) as u32;

    this.arrayNames = createChunkedUint32Array(256);
    this.arrayDim1 = createChunkedUint32Array(256);
    this.arrayDim2 = createChunkedUint32Array(256);
    this.arrayDim3 = createChunkedUint32Array(256);
    this.arrayDim4 = createChunkedUint32Array(256);
    this.arrayNDims = createChunkedUint32Array(256);
    this.arrayCount = 0;
    this.arrayNameIndexPtr = changetype<usize>(createMap64(256));

    this.pendingArrayLhs = createChunkedUint32Array(256);
    this.pendingArrayRhs = createChunkedUint32Array(256);
    this.pendingArrayCount = 0;

    this.disabledNames = createChunkedUint32Array(256);
    this.disabledCount = 0;
    this.disabledSetPtr = changetype<usize>(createSet64());

    this.algSections = createChunkedUint32Array(16 * 3);
    this.algSectionCount = 0;
    this.whenRecords = createChunkedInt32Array(256);
    this.whenRecordCount = 0;
    this.ifRecords = createChunkedInt32Array(256);
    this.ifRecordCount = 0;
    this.stmtItems = createChunkedUint32Array(256);
    this.stmtAux = createChunkedUint32Array(64);
    this.scopeResolutionsPtr = changetype<usize>(createMap64To64());
    this.enumLiteralsPtr = changetype<usize>(createMap64To64());
    this.isOmcCompatibility = false;
    this.savedModEnvPoolIdx = ModificationEnvironment.poolIdx;
    this.isDestroyed = false;
    g_isOmcNewInst = false;
  }

  reset(dae: DaeBuilder): void {
    this.daePtr = changetype<usize>(dae) as u32;
    this.rootProgramNodePtr = 0;
    this.rootProgramLoc = 0;
    this.currentClassLoc = 0;
    this.hasError = false;
    this.errorCode = 0;
    this.errorStartByte = 0xffffffff;
    this.errorEndByte = 0xffffffff;
    this.curEqLoc = 0;
    this.curSubtypeStartId = 0xffffffff;
    this.curSubtypeFixedId = 0xffffffff;
    this.curSubtypeMinId = 0xffffffff;
    this.curSubtypeMaxId = 0xffffffff;
    this.curSubtypeNominalId = 0xffffffff;
    this.curSubtypeDisplayUnitId = 0xffffffff;
    this.curSubtypeQuantityId = 0xffffffff;

    if (this.scopeStackPtr != 0) {
      changetype<ScopeStack>(this.scopeStackPtr).depth = 0;
    } else {
      this.scopeStackPtr = changetype<usize>(ScopeStack.create()) as u32;
    }

    if (this.exprVisitorPtr != 0) {
      changetype<WasmExprVisitor>(this.exprVisitorPtr).reset(dae, 0, 0, this.scopeStackPtr, changetype<usize>(this) as u32);
    } else {
      let ev = WasmExprVisitor.create(dae, 0, 0, this.scopeStackPtr, changetype<usize>(this) as u32);
      this.exprVisitorPtr = changetype<usize>(ev) as u32;
    }

    this.connectionCount = 0;
    this.streamCount = 0;
    this.innerCount = 0;
    this.innerRegCount = 0;
    this.outerMapCount = 0;
    this.expandableBusCount = 0;
    this.busRefSignalCount = 0;
    this.matchedBusPrefix = 0;
    this.matchedRelPath = 0;

    let maxVars = dae.varCount > 2048 ? dae.varCount + 512 : 2048;
    if (this.disjointSetPtr != 0) {
      changetype<DisjointSet>(this.disjointSetPtr).reset(maxVars);
    } else {
      this.disjointSetPtr = changetype<usize>(DisjointSet.create(maxVars)) as u32;
    }

    this.arrayCount = 0;
    if (this.arrayNameIndexPtr != 0) {
      changetype<UnmanagedMap64>(this.arrayNameIndexPtr).clear();
    } else {
      this.arrayNameIndexPtr = changetype<usize>(createMap64(256));
    }

    this.pendingArrayCount = 0;
    this.connectRef1 = 0;
    this.connectRef2 = 0;
    this.connectRefFound = 0;

    this.disabledCount = 0;
    if (this.disabledSetPtr != 0) {
      changetype<UnmanagedSet64>(this.disabledSetPtr).clear();
    } else {
      this.disabledSetPtr = changetype<usize>(createSet64());
    }

    this.algSections.clear();
    this.algSectionCount = 0;
    this.whenRecords.clear();
    this.whenRecordCount = 0;
    this.ifRecords.clear();
    this.ifRecordCount = 0;
    this.stmtItems.clear();
    this.stmtAux.clear();

    if (this.scopeResolutionsPtr != 0) {
      changetype<UnmanagedMap64To64>(this.scopeResolutionsPtr).clear();
    } else {
      this.scopeResolutionsPtr = changetype<usize>(createMap64To64());
    }
    if (this.enumLiteralsPtr != 0) {
      changetype<UnmanagedMap64To64>(this.enumLiteralsPtr).clear();
    } else {
      this.enumLiteralsPtr = changetype<usize>(createMap64To64());
    }

    this.isOmcCompatibility = false;
    this.savedModEnvPoolIdx = ModificationEnvironment.poolIdx;
    this.isDestroyed = false;
    g_isOmcNewInst = false;
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.clearScopeResolutions();
    this.clearEnumLiterals();
    if (this.arrayNameIndexPtr != 0) {
      changetype<UnmanagedMap64>(this.arrayNameIndexPtr).clear();
    }
    if (this.disabledSetPtr != 0) {
      changetype<UnmanagedSet64>(this.disabledSetPtr).clear();
    }
    if (this.scopeStackPtr != 0) {
      changetype<ScopeStack>(this.scopeStackPtr).depth = 0;
    }
    if (this.savedModEnvPoolIdx <= ModificationEnvironment.poolIdx) {
      ModificationEnvironment.poolIdx = this.savedModEnvPoolIdx;
    }
    if (ModelicaFlattener.poolBuf == 0) {
      ModelicaFlattener.poolBuf = atomicChunkAlloc(8 * sizeof<usize>());
    }
    if (ModelicaFlattener.poolDepth < 8) {
      store<usize>(ModelicaFlattener.poolBuf + (ModelicaFlattener.poolDepth * sizeof<usize>()), changetype<usize>(this));
      ModelicaFlattener.poolDepth++;
    }
  }

  registerScopeResolution(scopeClassNodePtr: u32, nameId: u32, targetClassNodePtr: u32, targetOffset: u32): void {
    if (this.scopeResolutionsPtr == 0 || nameId == 0 || targetClassNodePtr == 0) return;
    let map = changetype<UnmanagedMap64To64>(this.scopeResolutionsPtr);
    let key: u64 = ((scopeClassNodePtr as u64) << 32) | (nameId as u64);
    let val: u64 = targetOffset != 0 ? locMake(targetClassNodePtr, targetOffset) : (targetClassNodePtr as u64);
    map.set(key, val);
  }

  clearScopeResolutions(): void {
    if (this.scopeResolutionsPtr != 0) {
      changetype<UnmanagedMap64To64>(this.scopeResolutionsPtr).clear();
    }
  }

  registerEnumLiteral(nameId: u32, ordinal: u32, fullPathId: u32): void {
    if (this.enumLiteralsPtr == 0 || nameId == 0) return;
    let map = changetype<UnmanagedMap64To64>(this.enumLiteralsPtr);
    let val: u64 = ((ordinal as u64) << 32) | (fullPathId as u64);
    map.set(nameId as u64, val);
  }

  clearEnumLiterals(): void {
    if (this.enumLiteralsPtr != 0) {
      changetype<UnmanagedMap64To64>(this.enumLiteralsPtr).clear();
    }
  }

  lookupEnumLiteral(nameId: u32): u64 {
    if (this.enumLiteralsPtr == 0 || nameId == 0) return 0;
    let map = changetype<UnmanagedMap64To64>(this.enumLiteralsPtr);
    if (map.has(nameId as u64)) {
      return map.get(nameId as u64);
    }
    return 0;
  }

  resolveScopeClass(scopeClassLoc: u64, nameId: u32): u64 {
    if (this.scopeResolutionsPtr == 0 || nameId == 0) return 0;
    let map = changetype<UnmanagedMap64To64>(this.scopeResolutionsPtr);
    let scopePtr = locPtr(scopeClassLoc);
    let targetLoc: u64 = 0;
    if (scopePtr != 0) {
      let key: u64 = ((scopePtr as u64) << 32) | (nameId as u64);
      if (map.has(key)) {
        targetLoc = map.get(key);
      }
    }
    if (targetLoc == 0 && map.has(nameId as u64)) {
      targetLoc = map.get(nameId as u64);
    }
    if (targetLoc != 0) {
      if (locOffset(targetLoc) != 0) return targetLoc;
      let targetPtr = locPtr(targetLoc);
      if (!locIsNull(this.rootProgramLoc)) {
        let found = findClassByPtr(this.rootProgramLoc, targetPtr);
        if (!locIsNull(found)) return found;
      }
      return locMakeRoot(targetPtr);
    }
    return 0;
  }

  findClassLoc(scopeLoc: u64, targetNameId: u32, pool: ArenaStringPool): u64 {
    if (this.scopeStackPtr != 0) {
      let ss = changetype<ScopeStack>(this.scopeStackPtr);
      let redeclId = ss.lookupRedeclare(targetNameId);
      if (redeclId == 0) redeclId = ss.lookupRedeclarePath(pool, targetNameId);
      if (redeclId != 0 && redeclId != targetNameId) {
        targetNameId = redeclId;
      }
    }
    let resolved = this.resolveScopeClass(scopeLoc, targetNameId);
    if (!locIsNull(resolved)) return resolved;
    if (!locIsNull(scopeLoc)) {
      resolved = findClassDefinitionLoc(scopeLoc, targetNameId, pool);
      if (!locIsNull(resolved)) return resolved;
    }
    if (!locIsNull(this.rootProgramLoc) && scopeLoc != this.rootProgramLoc) {
      resolved = findClassDefinitionLoc(this.rootProgramLoc, targetNameId, pool);
      if (!locIsNull(resolved)) return resolved;
    }
    return 0;
  }

  registerArrayShape(nameId: u32, d1: u32, d2: u32 = 0, d3: u32 = 0, nDims: u32 = 0, d4: u32 = 0): void {
    if (nameId == 0) return;
    if (nDims == 0) {
      if (d4 > 0) nDims = 4;
      else if (d3 > 0) nDims = 3;
      else if (d2 > 0) nDims = 2;
      else if (d1 > 0) nDims = 1;
      else return;
    }
    if (this.arrayNameIndexPtr != 0) {
      let map = changetype<UnmanagedMap64>(this.arrayNameIndexPtr);
      let existing = map.get(nameId as u64);
      if (existing != 0) {
        let i = existing - 1;
        this.arrayDim1.set(i, d1);
        this.arrayDim2.set(i, d2);
        this.arrayDim3.set(i, d3);
        this.arrayDim4.set(i, d4);
        this.arrayNDims.set(i, nDims);
        return;
      }
      let idx = this.arrayCount++;
      this.arrayNames.set(idx, nameId);
      this.arrayDim1.set(idx, d1);
      this.arrayDim2.set(idx, d2);
      this.arrayDim3.set(idx, d3);
      this.arrayDim4.set(idx, d4);
      this.arrayNDims.set(idx, nDims);
      map.set(nameId as u64, idx + 1);
      return;
    }
    for (let i: u32 = 0; i < this.arrayCount; i++) {
      if (this.arrayNames.get(i) == nameId) {
        this.arrayDim1.set(i, d1);
        this.arrayDim2.set(i, d2);
        this.arrayDim3.set(i, d3);
        this.arrayDim4.set(i, d4);
        this.arrayNDims.set(i, nDims);
        return;
      }
    }
    let idx = this.arrayCount++;
    this.arrayNames.set(idx, nameId);
    this.arrayDim1.set(idx, d1);
    this.arrayDim2.set(idx, d2);
    this.arrayDim3.set(idx, d3);
    this.arrayDim4.set(idx, d4);
    this.arrayNDims.set(idx, nDims);
  }

  hasArrayShape(nameId: u32): boolean {
    if (nameId == 0 || this.arrayCount == 0) return false;
    if (this.arrayNameIndexPtr != 0) {
      return changetype<UnmanagedMap64>(this.arrayNameIndexPtr).get(nameId as u64) != 0;
    }
    for (let i: u32 = 0; i < this.arrayCount; i++) {
      if (this.arrayNames.get(i) == nameId) {
        return true;
      }
    }
    return false;
  }

  getArrayShapeDim(nameId: u32, dim: u32): u32 {
    if (nameId == 0 || this.arrayCount == 0) return 0;
    if (this.arrayNameIndexPtr != 0) {
      let existing = changetype<UnmanagedMap64>(this.arrayNameIndexPtr).get(nameId as u64);
      if (existing == 0) return 0;
      let i = existing - 1;
      let n = this.arrayNDims.get(i);
      if (dim > n) return 0;
      if (dim == 1) return this.arrayDim1.get(i);
      if (dim == 2) return this.arrayDim2.get(i);
      if (dim == 3) return this.arrayDim3.get(i);
      if (dim == 4) return this.arrayDim4.get(i);
      return 0;
    }
    for (let i: u32 = 0; i < this.arrayCount; i++) {
      if (this.arrayNames.get(i) == nameId) {
        let n = this.arrayNDims.get(i);
        if (dim > n) return 0;
        if (dim == 1) return this.arrayDim1.get(i);
        if (dim == 2) return this.arrayDim2.get(i);
        if (dim == 3) return this.arrayDim3.get(i);
        if (dim == 4) return this.arrayDim4.get(i);
        return 0;
      }
    }
    return 0;
  }

  getArrayNDims(nameId: u32): u32 {
    if (nameId == 0 || this.arrayCount == 0) return 0;
    if (this.arrayNameIndexPtr != 0) {
      let existing = changetype<UnmanagedMap64>(this.arrayNameIndexPtr).get(nameId as u64);
      if (existing == 0) return 0;
      return this.arrayNDims.get(existing - 1);
    }
    for (let i: u32 = 0; i < this.arrayCount; i++) {
      if (this.arrayNames.get(i) == nameId) {
        return this.arrayNDims.get(i);
      }
    }
    return 0;
  }

  registerInner(nameHash: u32, varId: u32): void {
    let idx = this.innerCount++;
    this.innerKeys.set(idx, nameHash);
    this.innerVars.set(idx, varId);
  }

  resolveOuter(nameHash: u32): u32 {
    for (let i: i32 = this.innerCount - 1; i >= 0; i--) {
      if (this.innerKeys.get(i) == nameHash) {
        return this.innerVars.get(i);
      }
    }
    return 0xffffffff;
  }

  registerInnerDeclaration(scopePrefixId: u32, compNameId: u32, fullPrefixId: u32): void {
    let idx = this.innerRegCount++;
    this.innerScopePrefixes.set(idx, scopePrefixId);
    this.innerNames.set(idx, compNameId);
    this.innerFullPaths.set(idx, fullPrefixId);
  }

  registerOuterMapping(outerPrefixId: u32, targetInnerPrefixId: u32): void {
    let idx = this.outerMapCount++;
    this.outerPaths.set(idx, outerPrefixId);
    this.targetInnerPaths.set(idx, targetInnerPrefixId);
  }

  removeOuterMapping(outerPrefixId: u32): void {
    for (let i: u32 = 0; i < this.outerMapCount; i++) {
      if (this.outerPaths.get(i) == outerPrefixId) {
        for (let j: u32 = i; j < this.outerMapCount - 1; j++) {
          this.outerPaths.set(j, this.outerPaths.get(j + 1));
          this.targetInnerPaths.set(j, this.targetInnerPaths.get(j + 1));
        }
        this.outerMapCount--;
        return;
      }
    }
  }

  findMatchingInner(pool: ArenaStringPool, currentPrefixId: u32, compNameId: u32): u32 {
    let searchPrefixId = pool.getParentPrefix(currentPrefixId);
    while (true) {
      for (let i: i32 = this.innerRegCount - 1; i >= 0; i--) {
        if (this.innerNames.get(i) == compNameId && this.innerScopePrefixes.get(i) == searchPrefixId) {
          return this.innerFullPaths.get(i);
        }
      }
      if (searchPrefixId == 0) break;
      searchPrefixId = pool.getParentPrefix(searchPrefixId);
    }
    return 0xffffffff;
  }

  resolveOuterToInner(pool: ArenaStringPool, id: u32): u32 {
    if (id == 0 || this.outerMapCount == 0) return id;
    for (let i: u32 = 0; i < this.outerMapCount; i++) {
      let outPfx = this.outerPaths.get(i);
      let inPfx = this.targetInnerPaths.get(i);
      if (id == outPfx) {
        return inPfx;
      }
      if (pool.hasPrefix(id, outPfx)) {
        let suffix = pool.getSuffixAfterPrefix(id, outPfx);
        return inPfx != 0 ? pool.concatIds(inPfx, suffix) : suffix;
      }
    }
    return id;
  }

  markComponentDisabled(nameId: u32): void {
    if (nameId == 0) return;
    let idx = this.disabledCount++;
    this.disabledNames.set(idx, nameId);
    if (this.disabledSetPtr != 0) {
      changetype<UnmanagedSet64>(this.disabledSetPtr).add(nameId as u64);
    }
  }

  isComponentDisabled(nameId: u32, pool: ArenaStringPool): boolean {
    if (this.disabledCount == 0 || nameId == 0) return false;
    if (this.disabledSetPtr != 0 && changetype<UnmanagedSet64>(this.disabledSetPtr).has(nameId as u64)) {
      return true;
    }
    for (let i: u32 = 0; i < this.disabledCount; i++) {
      let disId = this.disabledNames.get(i);
      if (nameId == disId) return true;
      let len = pool.stringLengths.get(nameId);
      let prefLen = pool.stringLengths.get(disId);
      if (len > prefLen) {
        let off = pool.stringOffsets.get(nameId);
        let prefOff = pool.stringOffsets.get(disId);
        let match = true;
        for (let j: u32 = 0; j < prefLen; j++) {
          if (pool.charBuffer.get(off + j) != pool.charBuffer.get(prefOff + j)) {
            match = false;
            break;
          }
        }
        if (match) {
          let nextChar = pool.charBuffer.get(off + prefLen);
          if (nextChar == 46 || nextChar == 91) return true; // '.' or '['
        }
      }
    }
    return false;
  }

  evalConditionLoc(condLoc: u64): i32 {
    if (locIsNull(condLoc)) return 1;
    let exprLoc = locFindDescendant(condLoc, SyntaxType.EXPRESSION);
    if (locIsNull(exprLoc)) {
      let ch = locFirstChild(condLoc);
      while (!locIsNull(ch)) {
        if (!locMatches(ch, "if") && locLen(ch) > 0) {
          exprLoc = ch;
          break;
        }
        ch = locNextSibling(ch);
      }
    }
    if (locIsNull(exprLoc)) return 1;
    let exprId = this.exprVisitor.visitLoc(exprLoc);
    if (exprId == 0xffffffff) return -1;
    return this.evalBoolExpr(exprId);
  }

  evalNumExpr(exprId: u32): f64 {
    if (exprId == 0xffffffff) return NaN;
    let kind = this.dae.getExprKind(exprId);
    if (kind == ExprKind.RealLiteral) return this.dae.getExprRealValue(exprId);
    if (kind == ExprKind.IntLiteral) return this.dae.getExprData1(exprId) as f64;
    if (kind == ExprKind.BoolLiteral) return this.dae.getExprData1(exprId) != 0 ? 1.0 : 0.0;
    if (kind == ExprKind.Unary) {
      let op = this.dae.getExprData1(exprId) as u16;
      let left = this.dae.getExprLeft(exprId);
      let val = this.evalNumExpr(left);
      if (isNaN(val)) return NaN;
      if (op == (UnaryOp.Negate as u16)) return -val;
    }
    if (kind == ExprKind.Binary) {
      let op = this.dae.getExprData1(exprId) as u16;
      let left = this.dae.getExprLeft(exprId);
      let right = this.dae.getExprRight(exprId);
      let v1 = this.evalNumExpr(left);
      let v2 = this.evalNumExpr(right);
      if (isNaN(v1) || isNaN(v2)) return NaN;
      if (op == (BinOp.Add as u16)) return v1 + v2;
      if (op == (BinOp.Sub as u16)) return v1 - v2;
      if (op == (BinOp.Mul as u16)) return v1 * v2;
      if (op == (BinOp.Div as u16)) return v2 != 0.0 ? v1 / v2 : NaN;
    }
    if (kind == ExprKind.Name) {
      let nameId = this.dae.getExprData1(exprId) as u32;
      let pool = this.dae.getStringPool();
      if (this.scopeStackPtr != 0) {
        let modOverride = changetype<ScopeStack>(this.scopeStackPtr).lookup(nameId);
        if (modOverride != 0xffffffff && modOverride != exprId) {
          let val = this.evalNumExpr(modOverride);
          if (!isNaN(val)) return val;
        }
      }
      let varIdx = this.dae.lookupVariableByName(nameId);
      if (varIdx < 0 && this.scopeStackPtr != 0) {
        let prefixId = changetype<ScopeStack>(this.scopeStackPtr).currentPrefixPathId;
        if (prefixId != 0) {
          let prefixedId = pool.concatIds(prefixId, nameId);
          varIdx = this.dae.lookupVariableByName(prefixedId);
        }
      }
      if (varIdx >= 0) {
        let bExpr = this.dae.getVarAttrExpr(varIdx, VarAttrKind.Binding as u32);
        if (bExpr != 0xffffffff && bExpr != exprId) {
          let val = this.evalNumExpr(bExpr);
          if (!isNaN(val)) return val;
        }
        return this.dae.getVarStartValue(varIdx);
      }
    }
    return NaN;
  }

  evalBoolExpr(exprId: u32): i32 {
    if (exprId == 0xffffffff) return -1;
    let kind = this.dae.getExprKind(exprId);
    if (kind == ExprKind.BoolLiteral) {
      return this.dae.getExprData1(exprId) != 0 ? 1 : 0;
    }
    if (kind == ExprKind.IntLiteral) {
      return this.dae.getExprData1(exprId) != 0 ? 1 : 0;
    }
    if (kind == ExprKind.RealLiteral) {
      return this.dae.getExprRealValue(exprId) != 0.0 ? 1 : 0;
    }
    if (kind == ExprKind.Unary) {
      let op = this.dae.getExprData1(exprId) as u16;
      let left = this.dae.getExprLeft(exprId);
      let val = this.evalBoolExpr(left);
      if (val == -1) return -1;
      if (op == (UnaryOp.Not as u16)) {
        return val == 0 ? 1 : 0;
      }
    }
    if (kind == ExprKind.Binary) {
      let op = this.dae.getExprData1(exprId) as u16;
      let left = this.dae.getExprLeft(exprId);
      let right = this.dae.getExprRight(exprId);
      if (op == (BinOp.And as u16)) {
        let v1 = this.evalBoolExpr(left);
        let v2 = this.evalBoolExpr(right);
        if (v1 == 0 || v2 == 0) return 0;
        if (v1 == 1 && v2 == 1) return 1;
        return -1;
      }
      if (op == (BinOp.Or as u16)) {
        let v1 = this.evalBoolExpr(left);
        let v2 = this.evalBoolExpr(right);
        if (v1 == 1 || v2 == 1) return 1;
        if (v1 == 0 && v2 == 0) return 0;
        return -1;
      }
      let n1 = this.evalNumExpr(left);
      let n2 = this.evalNumExpr(right);
      if (!isNaN(n1) && !isNaN(n2)) {
        if (op == (BinOp.Eq as u16)) return n1 == n2 ? 1 : 0;
        if (op == (BinOp.Neq as u16)) return n1 != n2 ? 1 : 0;
        if (op == (BinOp.Lt as u16)) return n1 < n2 ? 1 : 0;
        if (op == (BinOp.Lte as u16)) return n1 <= n2 ? 1 : 0;
        if (op == (BinOp.Gt as u16)) return n1 > n2 ? 1 : 0;
        if (op == (BinOp.Gte as u16)) return n1 >= n2 ? 1 : 0;
      }
      let b1 = this.evalBoolExpr(left);
      let b2 = this.evalBoolExpr(right);
      if (b1 != -1 && b2 != -1) {
        if (op == (BinOp.Eq as u16)) return b1 == b2 ? 1 : 0;
        if (op == (BinOp.Neq as u16)) return b1 != b2 ? 1 : 0;
      }
    }
    if (kind == ExprKind.Name) {
      let nameId = this.dae.getExprData1(exprId) as u32;
      let pool = this.dae.getStringPool();
      if (this.scopeStackPtr != 0) {
        let modOverride = changetype<ScopeStack>(this.scopeStackPtr).lookup(nameId);
        if (modOverride != 0xffffffff && modOverride != exprId) {
          let b = this.evalBoolExpr(modOverride);
          if (b != -1) return b;
        }
      }
      let varIdx = this.dae.lookupVariableByName(nameId);
      if (varIdx < 0 && this.scopeStackPtr != 0) {
        let prefixId = changetype<ScopeStack>(this.scopeStackPtr).currentPrefixPathId;
        if (prefixId != 0) {
          let prefixedId = pool.concatIds(prefixId, nameId);
          varIdx = this.dae.lookupVariableByName(prefixedId);
        }
      }
      if (varIdx >= 0) {
        let bExpr = this.dae.getVarAttrExpr(varIdx, VarAttrKind.Binding as u32);
        if (bExpr != 0xffffffff && bExpr != exprId) {
          let b = this.evalBoolExpr(bExpr);
          if (b != -1) return b;
        }
        let sExpr = this.dae.getVarAttrExpr(varIdx, VarAttrKind.Start as u32);
        if (sExpr != 0xffffffff && sExpr != exprId) {
          let b = this.evalBoolExpr(sExpr);
          if (b != -1) return b;
        }
        let vt = this.dae.getVarType(varIdx);
        if (vt == VarType.Boolean) {
          return this.dae.getVarStartValue(varIdx) != 0.0 ? 1 : 0;
        }
      }
    }
    return -1;
  }

  preScanInnerDeclarations(parentLoc: u64, prefixPathId: u32, pool: ArenaStringPool, isInner: boolean = false, maxDepth: i32 = 120): void {
    if (locIsNull(parentLoc) || maxDepth <= 0) return;
    let t = locType(parentLoc);
    if (t == SyntaxType.COMPONENT_CLAUSE || t == SyntaxType.COMPONENT_CLAUSE1) {
      let isClauseInner = isInner;
      if (!isClauseInner) {
        let tp = locFindDescendant(parentLoc, SyntaxType.TYPE_PREFIX);
        if (!locIsNull(tp) && (locMatches(tp, "inner") || !locIsNull(locFindDescendant(tp, SyntaxType.TOKEN_INNER)))) {
          isClauseInner = true;
        }
      }
      if (isClauseInner) {
        this.registerInnersFromClause(parentLoc, prefixPathId, pool);
      }
      return;
    }
    if (t == SyntaxType.CLASS_DEFINITION || t == SyntaxType.EQUATION_SECTION || t == SyntaxType.ALGORITHM_SECTION) {
      return;
    }
    let ch = locFirstChild(parentLoc);
    let curInner = isInner;
    while (!locIsNull(ch)) {
      let st = locType(ch);
      if (locMatches(ch, "inner") || (st == SyntaxType.TOKEN_INNER && locLen(ch) > 0)) {
        curInner = true;
      } else {
        this.preScanInnerDeclarations(ch, prefixPathId, pool, curInner, maxDepth - 1);
      }
      ch = locNextSibling(ch);
    }
  }

  registerInnersFromClause(clauseLoc: u64, prefixPathId: u32, pool: ArenaStringPool): void {
    let ch = locFirstChild(clauseLoc);
    while (!locIsNull(ch)) {
      let t = locType(ch);
      if (t == SyntaxType.DECLARATION) {
        let idLoc = locFirstNonEmptyChild(ch);
        if (!locIsNull(idLoc)) {
          let innerId = locFindDescendant(idLoc, SyntaxType.IDENTIFIER);
          if (!locIsNull(innerId)) idLoc = innerId;
          let compNameId = locIntern(pool, idLoc);
          let fullVarNameId = prefixPathId != 0 ? pool.concatIds(prefixPathId, compNameId) : compNameId;
          this.registerInnerDeclaration(prefixPathId, compNameId, fullVarNameId);
        }
      } else if (t != SyntaxType.TYPE_SPECIFIER && t != SyntaxType.TYPE_PREFIX) {
        this.registerInnersUnder(ch, prefixPathId, pool);
      }
      ch = locNextSibling(ch);
    }
  }

  registerInnersUnder(parentLoc: u64, prefixPathId: u32, pool: ArenaStringPool): void {
    let ch = locFirstChild(parentLoc);
    while (!locIsNull(ch)) {
      let t = locType(ch);
      if (t == SyntaxType.DECLARATION) {
        let idLoc = locFirstNonEmptyChild(ch);
        if (!locIsNull(idLoc)) {
          let innerId = locFindDescendant(idLoc, SyntaxType.IDENTIFIER);
          if (!locIsNull(innerId)) idLoc = innerId;
          let compNameId = locIntern(pool, idLoc);
          let fullVarNameId = prefixPathId != 0 ? pool.concatIds(prefixPathId, compNameId) : compNameId;
          this.registerInnerDeclaration(prefixPathId, compNameId, fullVarNameId);
        }
      } else if (t != SyntaxType.TYPE_SPECIFIER && t != SyntaxType.TYPE_PREFIX) {
        this.registerInnersUnder(ch, prefixPathId, pool);
      }
      ch = locNextSibling(ch);
    }
  }

  registerExpandableBus(busPrefixId: u32): void {
    for (let i: u32 = 0; i < this.expandableBusCount; i++) {
      if (this.expandableBuses.get(i) == busPrefixId) return;
    }
    let idx = this.expandableBusCount++;
    this.expandableBuses.set(idx, busPrefixId);
    this.busParent.set(idx, idx);
  }

  isInsideExpandableBus(prefixId: u32, pool: ArenaStringPool): boolean {
    if (this.expandableBusCount == 0) return false;
    for (let i: u32 = 0; i < this.expandableBusCount; i++) {
      let b = this.expandableBuses.get(i);
      if (b == 0) return true;
      if (prefixId == b || pool.hasPrefix(prefixId, b)) return true;
    }
    return false;
  }

  matchBus(nameId: u32, pool: ArenaStringPool): boolean {
    if (this.expandableBusCount == 0 || nameId == 0) return false;
    let found = false;
    let bestBus: u32 = 0;
    let bestRel: u32 = 0;
    let maxPrefLen: u32 = 0;

    for (let i: u32 = 0; i < this.expandableBusCount; i++) {
      let b = this.expandableBuses.get(i);
      if (b == 0) {
        if (!found) {
          found = true;
          bestBus = 0;
          bestRel = nameId;
          maxPrefLen = 0;
        }
      } else if (nameId == b) {
        let bLen = pool.getLength(b);
        if (!found || bLen > maxPrefLen) {
          found = true;
          bestBus = b;
          bestRel = 0;
          maxPrefLen = bLen;
        }
      } else if (pool.hasPrefix(nameId, b)) {
        let bLen = pool.getLength(b);
        if (!found || bLen > maxPrefLen) {
          found = true;
          bestBus = b;
          bestRel = pool.getSuffixAfterPrefix(nameId, b);
          maxPrefLen = bLen;
        }
      }
    }

    if (found) {
      this.matchedBusPrefix = bestBus;
      this.matchedRelPath = bestRel;
      return true;
    }
    return false;
  }

  markBusSignalReferenced(busIdx: u32, relId: u32): void {
    if (relId == 0) return;
    for (let i: u32 = 0; i < this.busRefSignalCount; i++) {
      if (this.busRefSignalsBusIdx.get(i) == busIdx && this.busRefSignalsRelId.get(i) == relId) {
        return;
      }
    }
    let idx = this.busRefSignalCount++;
    this.busRefSignalsBusIdx.set(idx, busIdx);
    this.busRefSignalsRelId.set(idx, relId);
  }

  markSignalReferencedByName(nameId: u32, pool: ArenaStringPool): void {
    if (nameId == 0 || this.expandableBusCount == 0) return;
    for (let b: u32 = 0; b < this.expandableBusCount; b++) {
      let busPrefix = this.expandableBuses.get(b);
      if (busPrefix == 0) {
        this.markBusSignalReferenced(b, nameId);
      } else if (nameId == busPrefix) {
        // Direct reference to bus itself
      } else if (pool.hasPrefix(nameId, busPrefix)) {
        let rel = pool.getSuffixAfterPrefix(nameId, busPrefix);
        this.markBusSignalReferenced(b, rel);
      }
    }
  }

  recordExprReferencedNames(exprId: u32, pool: ArenaStringPool): void {
    if (exprId == 0xffffffff || exprId >= this.dae.exprCount) return;
    let ek = this.dae.getExprKind(exprId);
    if (ek == ExprKind.Name) {
      let nameId = this.dae.getExprData().get(exprId * EXPR_STRIDE + EXPR_DATA1) as u32;
      this.markSignalReferencedByName(nameId, pool);
    } else if (ek == ExprKind.Binary) {
      this.recordExprReferencedNames(this.dae.getExprLeft(exprId), pool);
      this.recordExprReferencedNames(this.dae.getExprRight(exprId), pool);
    } else if (ek == ExprKind.Unary || ek == ExprKind.Negate || ek == ExprKind.Der || ek == ExprKind.Pre) {
      this.recordExprReferencedNames(this.dae.getExprLeft(exprId), pool);
    } else if (ek == ExprKind.Call || ek == ExprKind.Tuple) {
      let argCount = this.dae.getExprRight(exprId);
      for (let a: u32 = 0; a < argCount; a++) {
        let argExprId = a == 0 ? this.dae.getExprLeft(exprId) : this.dae.getExprLeft(exprId + a);
        this.recordExprReferencedNames(argExprId, pool);
      }
    } else if (ek == ExprKind.IfElse) {
      this.recordExprReferencedNames(this.dae.getExprLeft(exprId), pool);
      this.recordExprReferencedNames(this.dae.getExprRight(exprId), pool);
      let elseExpr = this.dae.getExprData().get(exprId * EXPR_STRIDE + EXPR_DATA1) as u32;
      this.recordExprReferencedNames(elseExpr, pool);
    } else if (ek == ExprKind.ArrayCtor) {
      let count = getArrayCtorCount(this.dae, exprId);
      for (let i: u32 = 0; i < count; i++) {
        this.recordExprReferencedNames(getArrayCtorElement(this.dae, exprId, i), pool);
      }
    } else if (ek == ExprKind.Subscript) {
      let baseId = this.dae.getExprData().get(exprId * EXPR_STRIDE + EXPR_DATA1) as u32;
      this.recordExprReferencedNames(baseId, pool);
      let subCount = this.dae.getExprRight(exprId);
      for (let s: u32 = 0; s < subCount; s++) {
        let subExprId = s == 0 ? this.dae.getExprLeft(exprId) : this.dae.getExprLeft(exprId + s);
        this.recordExprReferencedNames(subExprId, pool);
      }
    } else if (ek == ExprKind.Range) {
      let startExpr = this.dae.getExprData().get(exprId * EXPR_STRIDE + EXPR_DATA1) as u32;
      this.recordExprReferencedNames(startExpr, pool);
      this.recordExprReferencedNames(this.dae.getExprLeft(exprId), pool);
      let stepExpr = this.dae.getExprRight(exprId);
      if (stepExpr != 0xffffffff) {
        this.recordExprReferencedNames(stepExpr, pool);
      }
    }
  }

  findBus(b: u32): u32 {
    let p = this.busParent.get(b);
    if (p != b) {
      p = this.findBus(p);
      this.busParent.set(b, p);
    }
    return p;
  }

  unionBuses(b1: u32, b2: u32): void {
    let r1 = this.findBus(b1);
    let r2 = this.findBus(b2);
    if (r1 != r2) {
      this.busParent.set(r1, r2);
    }
  }

  findBusIndex(prefixId: u32): i32 {
    for (let i: u32 = 0; i < this.expandableBusCount; i++) {
      if (this.expandableBuses.get(i) == prefixId) return i as i32;
    }
    return -1;
  }

  hasArrayPrefix(id: u32, baseId: u32, pool: ArenaStringPool): boolean {
    let len = pool.getLength(id);
    let baseLen = pool.getLength(baseId);
    if (len <= baseLen) return false;
    let off = pool.getOffset(id);
    let baseOff = pool.getOffset(baseId);
    for (let i: u32 = 0; i < baseLen; i++) {
      if (pool.charBuffer.get(off + i) != pool.charBuffer.get(baseOff + i)) return false;
    }
    return pool.charBuffer.get(off + baseLen) == 91; // '['
  }

  isBusSignalReferenced(busIdx: u32, relId: u32, pool: ArenaStringPool): boolean {
    for (let i: u32 = 0; i < this.busRefSignalCount; i++) {
      if (this.busRefSignalsBusIdx.get(i) == busIdx) {
        let sId = this.busRefSignalsRelId.get(i);
        if (sId == relId) return true;
        if (pool.hasPrefix(sId, relId) || pool.hasPrefix(relId, sId)) return true;
        if (this.hasArrayPrefix(sId, relId, pool) || this.hasArrayPrefix(relId, sId, pool)) return true;
      }
    }
    return false;
  }

  augmentDynamicSignal(busPrefixId: u32, relPathId: u32, otherEndpointNameId: u32, pool: ArenaStringPool): void {
    let targetNameId = busPrefixId != 0 ? pool.concatIds(busPrefixId, relPathId) : relPathId;
    if (this.dae.lookupVariableByName(targetNameId) >= 0) return;

    let otherIdx = this.dae.lookupVariableByName(otherEndpointNameId);
    if (otherIdx >= 0) {
      let varType = this.dae.getVarType(otherIdx);
      let isFlow = this.dae.isVarFlow(otherIdx);
      let flags = FLAG_VAR_VIRTUAL;
      if (isFlow) flags |= FLAG_VAR_FLOW;
      this.dae.addVariable(targetNameId, varType, Variability.Continuous, Causality.Local, 0.0, flags);
      this.markSignalReferencedByName(targetNameId, pool);
      return;
    }

    // Check composite otherEndpoint (e.g. connector with sub-variables)
    let matchedAny = false;
    let totalVars = this.dae.varCount;
    for (let v: u32 = 0; v < totalVars; v++) {
      if (this.dae.isVarRemoved(v)) continue;
      let vNameId = this.dae.getVarNameId(v);
      if (pool.hasPrefix(vNameId, otherEndpointNameId)) {
        matchedAny = true;
        let subRel = pool.getSuffixAfterPrefix(vNameId, otherEndpointNameId);
        let subTargetId = pool.concatIds(targetNameId, subRel);
        if (this.dae.lookupVariableByName(subTargetId) < 0) {
          let varType = this.dae.getVarType(v);
          let isFlow = this.dae.isVarFlow(v);
          let flags = FLAG_VAR_VIRTUAL;
          if (isFlow) flags |= FLAG_VAR_FLOW;
          this.dae.addVariable(subTargetId, varType, Variability.Continuous, Causality.Local, 0.0, flags);
          this.markSignalReferencedByName(subTargetId, pool);
        }
      }
    }

    if (!matchedAny) {
      let flags = FLAG_VAR_VIRTUAL;
      this.dae.addVariable(targetNameId, VarType.Real, Variability.Continuous, Causality.Local, 0.0, flags);
      this.markSignalReferencedByName(targetNameId, pool);
    }
  }

  poolSignalsBetweenBuses(srcBusIdx: u32, dstBusIdx: u32, pool: ArenaStringPool): void {
    let srcPrefix = this.expandableBuses.get(srcBusIdx);
    let dstPrefix = this.expandableBuses.get(dstBusIdx);

    let totalRef = this.busRefSignalCount;
    for (let i: u32 = 0; i < totalRef; i++) {
      if (this.busRefSignalsBusIdx.get(i) == srcBusIdx) {
        let relId = this.busRefSignalsRelId.get(i);
        this.markBusSignalReferenced(dstBusIdx, relId);

        let targetNameId = dstPrefix != 0 ? pool.concatIds(dstPrefix, relId) : relId;
        this.markSignalReferencedByName(targetNameId, pool);

        if (this.dae.lookupVariableByName(targetNameId) < 0) {
          let srcNameId = srcPrefix != 0 ? pool.concatIds(srcPrefix, relId) : relId;
          let srcIdx = this.dae.lookupVariableByName(srcNameId);
          let varType = srcIdx >= 0 ? this.dae.getVarType(srcIdx) : VarType.Real;
          let isFlow = srcIdx >= 0 ? this.dae.isVarFlow(srcIdx) : false;
          let flags = FLAG_VAR_VIRTUAL;
          if (isFlow) flags |= FLAG_VAR_FLOW;
          this.dae.addVariable(targetNameId, varType, Variability.Continuous, Causality.Local, 0.0, flags);
        }
      }
    }
  }

  processExpandableConnectors(): void {
    if (this.expandableBusCount == 0) return;
    let pool = this.dae.getStringPool();

    for (let i: u32 = 0; i < this.expandableBusCount; i++) {
      this.busParent.set(i, i);
    }

    let totalEqs = this.dae.eqCount;
    for (let i: u32 = 0; i < totalEqs; i++) {
      let ek = this.dae.getEqData().get(i * EQ_STRIDE + EQ_KIND);
      let lhs = this.dae.getEqData().get(i * EQ_STRIDE + EQ_LHS) as u32;
      let rhs = this.dae.getEqData().get(i * EQ_STRIDE + EQ_RHS) as u32;

      if (ek == EqKind.Connect) {
        let lhsNameId: u32 = 0;
        let rhsNameId: u32 = 0;
        if (lhs != 0xffffffff && this.dae.getExprKind(lhs) == ExprKind.Name) {
          lhsNameId = this.dae.getExprData().get(lhs * EXPR_STRIDE + EXPR_DATA1) as u32;
        }
        if (rhs != 0xffffffff && this.dae.getExprKind(rhs) == ExprKind.Name) {
          rhsNameId = this.dae.getExprData().get(rhs * EXPR_STRIDE + EXPR_DATA1) as u32;
        }

        let matchL = this.matchBus(lhsNameId, pool);
        let busL = this.matchedBusPrefix;
        let relL = this.matchedRelPath;

        let matchR = this.matchBus(rhsNameId, pool);
        let busR = this.matchedBusPrefix;
        let relR = this.matchedRelPath;

        if (matchL && relL == 0 && matchR && relR == 0) {
          let idxL = this.findBusIndex(busL);
          let idxR = this.findBusIndex(busR);
          if (idxL >= 0 && idxR >= 0) {
            this.unionBuses(idxL as u32, idxR as u32);

            for (let b: u32 = 0; b < this.expandableBusCount; b++) {
              let bPfx = this.expandableBuses.get(b);
              if (busL != 0 && pool.hasPrefix(bPfx, busL)) {
                let subRel = pool.getSuffixAfterPrefix(bPfx, busL);
                let paired = busR != 0 ? pool.concatIds(busR, subRel) : subRel;
                let pairedIdx = this.findBusIndex(paired);
                if (pairedIdx >= 0) {
                  this.unionBuses(b, pairedIdx as u32);
                }
              } else if (busR != 0 && pool.hasPrefix(bPfx, busR)) {
                let subRel = pool.getSuffixAfterPrefix(bPfx, busR);
                let paired = busL != 0 ? pool.concatIds(busL, subRel) : subRel;
                let pairedIdx = this.findBusIndex(paired);
                if (pairedIdx >= 0) {
                  this.unionBuses(b, pairedIdx as u32);
                }
              }
            }
          }
        } else {
          if (matchL && relL != 0) {
            this.markSignalReferencedByName(lhsNameId, pool);
            this.augmentDynamicSignal(busL, relL, rhsNameId, pool);
          }
          if (matchR && relR != 0) {
            this.markSignalReferencedByName(rhsNameId, pool);
            this.augmentDynamicSignal(busR, relR, lhsNameId, pool);
          }
        }
      } else {
        this.recordExprReferencedNames(lhs, pool);
        this.recordExprReferencedNames(rhs, pool);
      }
    }

    for (let v: u32 = 0; v < this.dae.varCount; v++) {
      if (this.dae.isVarRemoved(v)) continue;
      let bExpr = this.dae.getVarAttrExpr(v, VarAttrKind.Binding as u32);
      if (bExpr != 0xffffffff) {
        this.recordExprReferencedNames(bExpr, pool);
      }
    }

    for (let s: u32 = 0; s < this.dae.stmtCount; s++) {
      let sk = this.dae.getStmtData().get(s * 4) as u32;
      let d1 = this.dae.getStmtData().get(s * 4 + 1) as u32;
      let sLeft = this.dae.getStmtData().get(s * 4 + 2) as u32;
      if (sk == (StmtKind.Assignment as u32)) {
        this.recordExprReferencedNames(d1, pool);
        this.recordExprReferencedNames(sLeft, pool);
      } else if (sk == (StmtKind.For as u32) || sk == (StmtKind.ComplexAssignment as u32)) {
        this.recordExprReferencedNames(sLeft, pool);
      } else if (
        sk == (StmtKind.While as u32) ||
        sk == (StmtKind.If as u32) ||
        sk == (StmtKind.When as u32) ||
        sk == (StmtKind.ProcedureCall as u32) ||
        sk == (StmtKind.Block as u32)
      ) {
        if (d1 != 0xffffffff) {
          this.recordExprReferencedNames(d1, pool);
        }
      }
    }

    let wPos: u32 = 0;
    for (let w: u32 = 0; w < this.whenRecordCount && wPos < this.whenRecords.length; w++) {
      wPos++; // whenEqIdx
      let condId = this.whenRecords.get(wPos++) as u32;
      this.recordExprReferencedNames(condId, pool);
      let bodyCount = this.whenRecords.get(wPos++) as u32;
      for (let b: u32 = 0; b < bodyCount; b++) {
        wPos++; // kind
        let bLhs = this.whenRecords.get(wPos++) as u32;
        let bRhs = this.whenRecords.get(wPos++) as u32;
        this.recordExprReferencedNames(bLhs, pool);
        this.recordExprReferencedNames(bRhs, pool);
      }
      let ewCount = this.whenRecords.get(wPos++) as u32;
      for (let ew: u32 = 0; ew < ewCount; ew++) {
        let ewCond = this.whenRecords.get(wPos++) as u32;
        this.recordExprReferencedNames(ewCond, pool);
        let ewBodyCount = this.whenRecords.get(wPos++) as u32;
        for (let b: u32 = 0; b < ewBodyCount; b++) {
          wPos++; // kind
          let bLhs = this.whenRecords.get(wPos++) as u32;
          let bRhs = this.whenRecords.get(wPos++) as u32;
          this.recordExprReferencedNames(bLhs, pool);
          this.recordExprReferencedNames(bRhs, pool);
        }
      }
    }

    let iPos: u32 = 0;
    for (let ir: u32 = 0; ir < this.ifRecordCount && iPos < this.ifRecords.length; ir++) {
      iPos++; // ifEqIdx
      let condId = this.ifRecords.get(iPos++) as u32;
      this.recordExprReferencedNames(condId, pool);
      let thenCount = this.ifRecords.get(iPos++) as u32;
      for (let b: u32 = 0; b < thenCount; b++) {
        iPos++; // kind
        let bLhs = this.ifRecords.get(iPos++) as u32;
        let bRhs = this.ifRecords.get(iPos++) as u32;
        this.recordExprReferencedNames(bLhs, pool);
        this.recordExprReferencedNames(bRhs, pool);
      }
      let eiCount = this.ifRecords.get(iPos++) as u32;
      for (let ei: u32 = 0; ei < eiCount; ei++) {
        let eiCond = this.ifRecords.get(iPos++) as u32;
        this.recordExprReferencedNames(eiCond, pool);
        let eiBodyCount = this.ifRecords.get(iPos++) as u32;
        for (let b: u32 = 0; b < eiBodyCount; b++) {
          iPos++; // kind
          let bLhs = this.ifRecords.get(iPos++) as u32;
          let bRhs = this.ifRecords.get(iPos++) as u32;
          this.recordExprReferencedNames(bLhs, pool);
          this.recordExprReferencedNames(bRhs, pool);
        }
      }
      let elseCount = this.ifRecords.get(iPos++) as u32;
      for (let b: u32 = 0; b < elseCount; b++) {
        iPos++; // kind
        let bLhs = this.ifRecords.get(iPos++) as u32;
        let bRhs = this.ifRecords.get(iPos++) as u32;
        this.recordExprReferencedNames(bLhs, pool);
        this.recordExprReferencedNames(bRhs, pool);
      }
    }

    for (let b1: u32 = 0; b1 < this.expandableBusCount; b1++) {
      let r1 = this.findBus(b1);
      for (let b2: u32 = b1 + 1; b2 < this.expandableBusCount; b2++) {
        let r2 = this.findBus(b2);
        if (r1 == r2) {
          this.poolSignalsBetweenBuses(b1, b2, pool);
          this.poolSignalsBetweenBuses(b2, b1, pool);
        }
      }
    }

    for (let b: u32 = 0; b < this.expandableBusCount; b++) {
      let busPrefix = this.expandableBuses.get(b);
      let totalVars = this.dae.varCount;
      for (let v: u32 = 0; v < totalVars; v++) {
        if (this.dae.isVarRemoved(v)) continue;
        let vNameId = this.dae.getVarNameId(v);

        let relId: u32 = 0;
        let isOnBus = false;
        if (busPrefix == 0) {
          isOnBus = true;
          relId = vNameId;
        } else if (pool.hasPrefix(vNameId, busPrefix)) {
          isOnBus = true;
          relId = pool.getSuffixAfterPrefix(vNameId, busPrefix);
        }

        if (isOnBus && relId != 0) {
          if (!this.isBusSignalReferenced(b, relId, pool)) {
            let vFlagsOffset = v * VAR_STRIDE + VAR_FLAGS;
            let flags = this.dae.getVarData().get(vFlagsOffset);
            this.dae.getVarData().set(vFlagsOffset, flags | FLAG_VAR_REMOVED);
          }
        }
      }
    }
  }

  @inline getCardinality(varId: u32): u32 {
    return this.disjointSet.getCardinality(varId);
  }

  @inline ensureUfCapacity(varId: u32): void {
    this.disjointSet.ensureCapacity(varId);
  }

  @inline findRoot(v: u32): u32 {
    return this.disjointSet.find(v);
  }

  @inline unionSets(v1: u32, v2: u32): void {
    this.disjointSet.union(v1, v2);
  }

  addConnection(p1VarId: u32, p2VarId: u32, isFlow: boolean, isBoundary: boolean = false): u32 {
    let idx = this.connectionCount++;
    ConnectionPairView.at(this.connectionPairs, idx).set(p1VarId, p2VarId, isFlow, isBoundary);

    this.disjointSet.incrementCardinality(p1VarId);
    this.disjointSet.incrementCardinality(p2VarId);

    this.disjointSet.union(p1VarId, p2VarId);
    return idx;
  }

  addStreamConnection(h1VarId: u32, mdot1VarId: u32, h2VarId: u32, mdot2VarId: u32): u32 {
    let idx = this.streamCount++;
    let offset = idx * 4;

    this.streamPairs.set(offset + 0, h1VarId);
    this.streamPairs.set(offset + 1, mdot1VarId);
    this.streamPairs.set(offset + 2, h2VarId);
    this.streamPairs.set(offset + 3, mdot2VarId);

    let eh1 = this.dae.addExpression(ExprKind.Name, h1VarId);
    let eh2 = this.dae.addExpression(ExprKind.Name, h2VarId);
    let emdot1 = this.dae.addExpression(ExprKind.Name, mdot1VarId);
    let zeroReal = this.dae.addRealLiteral(0.0);

    let cond1 = this.dae.addExpression(ExprKind.Binary, BinOp.Gt as u32, emdot1, zeroReal);
    let ifExpr1 = this.dae.addExpression(ExprKind.IfElse, cond1, eh2, eh1);
    this.dae.addEquation(EqKind.Simple, eh1, ifExpr1, FLAG_EQ_STREAM_CONNECT as u32);

    return idx;
  }

  flattenArrayComponent(baseNameHash: u32, dim1: u32, dim2: u32 = 0, varType: u16 = VarType.Real, variability: u16 = Variability.Continuous, causality: u16 = Causality.Local, startVal: f64 = 0.0): u32 {
    let count: u32 = 0;
    if (dim2 == 0) {
      for (let i: u32 = 1; i <= dim1; i++) {
        let elemNameHash = (baseNameHash * 31 + i) as u32;
        this.dae.addVariable(elemNameHash, varType, variability, causality, startVal);
        count++;
      }
    } else {
      for (let i: u32 = 1; i <= dim1; i++) {
        for (let j: u32 = 1; j <= dim2; j++) {
          let elemNameHash = ((baseNameHash * 31 + i) * 31 + j) as u32;
          this.dae.addVariable(elemNameHash, varType, variability, causality, startVal);
          count++;
        }
      }
    }
    return count;
  }

  connectPorts(port1VarId: u32, port2VarId: u32, memberCount: u32, isBoundary: boolean = false): u32 {
    let connected: u32 = 0;
    for (let m: u32 = 0; m < memberCount; m++) {
      let v1 = port1VarId + m;
      let v2 = port2VarId + m;
      let isFlow: boolean = this.dae.isVarFlow(v1);
      this.addConnection(v1, v2, isFlow, isBoundary);
      connected++;
    }
    return connected;
  }

  expandConnector(busVarId: u32, memberNameHash: u32, varType: u32 = 0): u32 {
    let newVarId = this.dae.addVariable(memberNameHash, varType as u16, Variability.Continuous, Causality.Local, 0.0);
    this.ensureUfCapacity(newVarId);
    return newVarId;
  }

  @inline isVarStream(varIdx: u32): boolean {
    if (varIdx >= this.dae.varCount) return false;
    return VarAccessor.at(this.dae.getVarData(), varIdx).isStream;
  }

  /**
   * Finalizes all connection graphs, emitting zero-sum Kirchhoff equations for flow variable sets
   * and potential equality equations.
   */
  finalizeConnections(): u32 {
    let varCount = this.dae.varCount;
    if (varCount == 0) return 0;

    let head = createChunkedInt32Array(varCount);
    let next = createChunkedInt32Array(varCount);
    let groupSize = createChunkedUint32Array(varCount);
    for (let i: u32 = 0; i < varCount; i++) {
      head.set(i, -1);
      next.set(i, -1);
      groupSize.set(i, 0);
    }

    for (let v: u32 = 0; v < varCount; v++) {
      if (this.dae.isVarRemoved(v)) continue;
      let root = this.findRoot(v);
      let prevHead = head.get(root);
      next.set(v, prevHead);
      head.set(root, v as i32);
      groupSize.set(root, groupSize.get(root) + 1);
    }

    let generatedEqs: u32 = 0;
    let zeroExpr = this.dae.addRealLiteral(0.0);

    for (let r: u32 = 0; r < varCount; r++) {
      if (this.dae.isVarRemoved(r)) continue;
      let size = groupSize.get(r);
      if (size == 0) continue;

      let isStream = this.isVarStream(r);
      let isFlow = this.dae.isVarFlow(r) && !isStream;

      if (isFlow) {
        if (size == 1) {
          let vIdx = head.get(r) as u32;
          let vExpr = this.dae.addExpression(ExprKind.Name, this.dae.getVarNameId(vIdx));
          this.dae.addEquation(EqKind.Simple, vExpr, zeroExpr);
          generatedEqs++;
        } else {
          let sumExpr: u32 = 0;
          let count: u32 = 0;
          let curr = head.get(r);
          while (curr >= 0) {
            let vIdx = curr as u32;
            let vExpr = this.dae.addExpression(ExprKind.Name, this.dae.getVarNameId(vIdx));
            if (count == 0) {
              sumExpr = vExpr;
            } else {
              sumExpr = this.dae.addBinaryExpr(BinOp.Add as u16, sumExpr, vExpr);
            }
            count++;
            curr = next.get(vIdx);
          }
          this.dae.addEquation(EqKind.Simple, sumExpr, zeroExpr);
          generatedEqs++;
        }
      } else if (!isStream) {
        if (size > 1) {
          let rootVar = r;
          let rootExpr = this.dae.addExpression(ExprKind.Name, this.dae.getVarNameId(rootVar));
          let curr = head.get(r);
          while (curr >= 0) {
            let vIdx = curr as u32;
            if (vIdx != rootVar) {
              let vExpr = this.dae.addExpression(ExprKind.Name, this.dae.getVarNameId(vIdx));
              this.dae.addEquation(EqKind.Simple, rootExpr, vExpr);
              generatedEqs++;
            }
            curr = next.get(vIdx);
          }
        }
      }
    }

    return generatedEqs;
  }

  /**
   * Expands connect() equations from the DAE into potential equalities and flow balances.
   */
  expandConnections(omcCompatibility: boolean = false): u32 {
    let pool = this.dae.getStringPool();
    let initialEqCount = this.dae.eqCount;
    let varCount = this.dae.varCount;

    for (let i: u32 = 0; i < initialEqCount; i++) {
      let eq = EqAccessor.at(this.dae.getEqData(), i);
      if (eq.isConnect) {
        let lhsExpr = eq.lhs;
        let rhsExpr = eq.rhs;
        if (lhsExpr < this.dae.exprCount && rhsExpr < this.dae.exprCount) {
          let lhs = ExprAccessor.at(this.dae.getExprData(), lhsExpr);
          let rhs = ExprAccessor.at(this.dae.getExprData(), rhsExpr);
          if (lhs.isName && rhs.isName) {
            let fromNameId = lhs.varId;
            let toNameId = rhs.varId;

            let fromExact = this.dae.lookupVariableByName(fromNameId);
            let toExact = this.dae.lookupVariableByName(toNameId);
            if (fromExact >= 0 && toExact >= 0) {
              if (!this.dae.isVarRemoved(fromExact as u32) && !this.dae.isVarRemoved(toExact as u32)) {
                this.ensureUfCapacity(fromExact as u32);
                this.ensureUfCapacity(toExact as u32);
                this.unionSets(fromExact as u32, toExact as u32);
                this.disjointSet.incrementCardinality(fromExact as u32);
                this.disjointSet.incrementCardinality(toExact as u32);
              }
            } else {
              for (let v: u32 = 0; v < varCount; v++) {
                if (this.dae.isVarRemoved(v)) continue;
                let vNameId = this.dae.getVarNameId(v);
                if (pool.hasPrefix(vNameId, fromNameId)) {
                  let suffId = pool.getSuffixAfterPrefix(vNameId, fromNameId);
                  if (suffId != 0) {
                    let targetNameId = pool.concatIds(toNameId, suffId);
                    let toVar = this.dae.lookupVariableByName(targetNameId);
                    if (toVar >= 0 && !this.dae.isVarRemoved(toVar as u32)) {
                      this.ensureUfCapacity(v);
                      this.ensureUfCapacity(toVar as u32);
                      this.unionSets(v, toVar as u32);
                      this.disjointSet.incrementCardinality(v);
                      this.disjointSet.incrementCardinality(toVar as u32);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    return this.finalizeConnections();
  }

  /**
   * Flattens an equation section (simple, connect, initial equations) in linear memory.
   */
  flattenEquationSection(sectionNodePtr: u32, isInitial: boolean = false): u32 {
    return this.lowerEquationSectionLoc(locMakeRoot(sectionNodePtr), isInitial);
  }

  flattenInitialEquationSection(sectionNodePtr: u32): u32 {
    return this.lowerEquationSectionLoc(locMakeRoot(sectionNodePtr), true);
  }

  lowerEquationSectionLoc(sectionLoc: u64, isInitial: boolean): u32 {
    let sec = CstNodeView.at(sectionLoc);
    if (sec.isNull) return 0;
    let eqCountBefore = this.dae.eqCount;
    let firstChLoc = sec.firstNonEmptyChildLoc;
    if (!locIsNull(firstChLoc)) {
      let firstCh = CstNodeView.at(firstChLoc);
      if (firstCh.matches("initial") || firstCh.type == 60) {
        isInitial = true;
      }
    }
    this.lowerEquationsUnderSection(sectionLoc, isInitial);
    return this.dae.eqCount - eqCountBefore;
  }

  lowerEquationsUnderSection(parentLoc: u64, isInitial: boolean): void {
    let parent = CstNodeView.at(parentLoc);
    let chLoc = parent.firstChildLoc;
    while (!locIsNull(chLoc)) {
      if (this.hasError) return;
      this.lowerEquationNode(chLoc, isInitial);
      if (this.hasError) return;
      chLoc = locNextSibling(chLoc);
    }
  }

  lowerEquationNode(nodeLoc: u64, isInitial: boolean): u32 {
    if (locIsNull(nodeLoc)) return 0;
    if (locMatches(nodeLoc, ";")) return 0;
    let ch = CstNodeView.at(nodeLoc);
    let t = ch.type;
    if (t == SyntaxType.SIMPLE_EQUATION) {
      return this.lowerSimpleEquation(nodeLoc, isInitial);
    } else if (t == SyntaxType.CONNECT_EQUATION) {
      return this.lowerConnectEquation(nodeLoc);
    } else if (t == SyntaxType.FUNCTION_CALL) {
      if (
        !locIsNull(locFindMatchingDescendant(nodeLoc, "initialState")) ||
        !locIsNull(locFindMatchingDescendant(nodeLoc, "transition"))
      ) {
        this.setErrorAt(WasmBailReason.WhenOrIfEquation, nodeLoc);
        return 0;
      }
      let callExpr = this.exprVisitor.visitLoc(nodeLoc);
      if (callExpr != 0xffffffff) {
        let eqKind = isInitial ? EqKind.InitialFunctionCall : EqKind.FunctionCall;
        this.dae.addEquation(eqKind as u32, callExpr, 0xffffffff);
        return 1;
      }
      return 0;
    } else if (t == SyntaxType.FOR_EQUATION) {
      return this.lowerForEquation(nodeLoc, isInitial);
    } else if (t == SyntaxType.WHEN_EQUATION) {
      return this.lowerWhenEquation(nodeLoc, isInitial);
    } else if (t == SyntaxType.IF_EQUATION) {
      return this.lowerIfEquation(nodeLoc, isInitial);
    } else if (t != SyntaxType.CLASS_DEFINITION) {
      let count: u32 = 0;
      let sub = ch.firstChildLoc;
      while (!locIsNull(sub)) {
        if (!locMatches(sub, ";") && locLen(sub) > 0) {
          count += this.lowerEquationNode(sub, isInitial);
          if (this.hasError) return 0;
        }
        sub = locNextSibling(sub);
      }
      return count;
    }
    return 0;
  }

  private searchImplicitArrayDim(nodeLoc: u64, iterVarNameId: u32, prefixPathId: u32): u32 {
    if (locIsNull(nodeLoc)) return 0;
    let pool = this.dae.getStringPool();
    let t = locType(nodeLoc);
    if (t == SyntaxType.COMPONENT_REFERENCE) {
      let arrSubLoc = locFindDescendant(nodeLoc, SyntaxType.ARRAY_SUBSCRIPTS);
      if (!locIsNull(arrSubLoc)) {
        let baseNameId: u32 = 0;
        let baseIdLoc = locFindDescendant(nodeLoc, SyntaxType.IDENTIFIER);
        if (locIsNull(baseIdLoc)) baseIdLoc = locFindDescendant(nodeLoc, SyntaxType.TOKEN_IDENTIFIER_ALT);
        if (locIsNull(baseIdLoc)) baseIdLoc = locFindDescendant(nodeLoc, SyntaxType.NAME);
        if (!locIsNull(baseIdLoc)) {
          baseNameId = locIntern(pool, baseIdLoc);
        }
        if (baseNameId != 0) {
          let sCh = locFirstChild(arrSubLoc);
          let dimIdx: u32 = 1;
          while (!locIsNull(sCh)) {
            if (locType(sCh) == SyntaxType.SUBSCRIPT) {
              let idLoc = locFindDescendant(sCh, SyntaxType.IDENTIFIER);
              if (locIsNull(idLoc)) idLoc = locFindDescendant(sCh, SyntaxType.TOKEN_IDENTIFIER_ALT);
              if (locIsNull(idLoc)) idLoc = locFindDescendant(sCh, SyntaxType.NAME);
              if (!locIsNull(idLoc)) {
                let subId = locIntern(pool, idLoc);
                if (subId == iterVarNameId) {
                  let fullNameId = baseNameId;
                  if (prefixPathId != 0) {
                    fullNameId = pool.concatIds(prefixPathId, baseNameId);
                  }
                  let dSize = this.getArrayShapeDim(fullNameId, dimIdx);
                  if (dSize == 0) dSize = this.getArrayShapeDim(baseNameId, dimIdx);
                  if (dSize == 0) {
                    if (this.dae.lookupVariableByName(concatArrayIndex2D(pool, fullNameId, 1, 1)) >= 0) {
                      if (dimIdx == 1) {
                        while (this.dae.lookupVariableByName(concatArrayIndex2D(pool, fullNameId, dSize + 1, 1)) >= 0) dSize++;
                      } else if (dimIdx == 2) {
                        while (this.dae.lookupVariableByName(concatArrayIndex2D(pool, fullNameId, 1, dSize + 1)) >= 0) dSize++;
                      }
                    } else if (this.dae.lookupVariableByName(concatArrayIndex1D(pool, fullNameId, 1)) >= 0) {
                      while (this.dae.lookupVariableByName(concatArrayIndex1D(pool, fullNameId, dSize + 1)) >= 0) dSize++;
                    }
                    if (dSize == 0 && prefixPathId != 0) {
                      if (this.dae.lookupVariableByName(concatArrayIndex2D(pool, baseNameId, 1, 1)) >= 0) {
                        if (dimIdx == 1) {
                          while (this.dae.lookupVariableByName(concatArrayIndex2D(pool, baseNameId, dSize + 1, 1)) >= 0) dSize++;
                        } else if (dimIdx == 2) {
                          while (this.dae.lookupVariableByName(concatArrayIndex2D(pool, baseNameId, 1, dSize + 1)) >= 0) dSize++;
                        }
                      } else if (this.dae.lookupVariableByName(concatArrayIndex1D(pool, baseNameId, 1)) >= 0) {
                        while (this.dae.lookupVariableByName(concatArrayIndex1D(pool, baseNameId, dSize + 1)) >= 0) dSize++;
                      }
                    }
                  }
                  if (dSize > 0) return dSize;
                }
              }
              dimIdx++;
            }
            sCh = locNextSibling(sCh);
          }
        }
      }
    }

    let sub = locFirstChild(nodeLoc);
    while (!locIsNull(sub)) {
      let d = this.searchImplicitArrayDim(sub, iterVarNameId, prefixPathId);
      if (d > 0) return d;
      sub = locNextSibling(sub);
    }
    return 0;
  }

  private findImplicitArrayDim(loopLoc: u64, iterVarNameId: u32, prefixPathId: u32): u32 {
    let bodyCh = locNextSibling(loopLoc);
    while (!locIsNull(bodyCh)) {
      if (locMatches(bodyCh, "end") || locMatches(bodyCh, "end for")) break;
      if (!locMatches(bodyCh, ";") && locLen(bodyCh) > 0) {
        let dim = this.searchImplicitArrayDim(bodyCh, iterVarNameId, prefixPathId);
        if (dim > 0) return dim;
      }
      bodyCh = locNextSibling(bodyCh);
    }
    return 0;
  }

  lowerForEquation(forLoc: u64, isInitial: boolean): u32 {
    let fiLoc = locFindDescendant(forLoc, SyntaxType.FOR_INDEX);
    if (locIsNull(fiLoc)) fiLoc = locFindDescendant(forLoc, SyntaxType.FOR_INDICES);
    if (locIsNull(fiLoc)) {
      this.setErrorAt(WasmBailReason.ForEquationNoIndex, forLoc);
      return 0;
    }
    let nextFi = locNextSibling(fiLoc);
    while (!locIsNull(nextFi)) {
      if (locType(nextFi) == SyntaxType.FOR_INDEX || locMatches(nextFi, ",")) {
        this.setErrorAt(WasmBailReason.ForEquationRange, forLoc);
        return 0;
      }
      nextFi = locNextSibling(nextFi);
    }

    let pool = this.dae.getStringPool();
    let prefixPathId = this.scopeStackPtr != 0 ? changetype<ScopeStack>(this.scopeStackPtr).currentPrefixPathId : 0;
    let tempRange = createChunkedInt32Array(8);
    let ok = parseForIndexRange(fiLoc, this.dae, pool, tempRange, prefixPathId, this.scopeStackPtr);
    if (ok == 0) {
      this.setErrorAt(WasmBailReason.ForEquationRange, fiLoc);
      return 0;
    }

    let varNameId = tempRange.get(0) as u32;
    let startVal = tempRange.get(1);
    let stepVal = tempRange.get(2);
    let endVal = tempRange.get(3);
    if (stepVal == 0) stepVal = 1;

    let loopLoc: u64 = 0;
    let ch = locFirstChild(forLoc);
    while (!locIsNull(ch)) {
      if (locMatches(ch, "loop")) {
        loopLoc = ch;
        break;
      }
      ch = locNextSibling(ch);
    }
    if (locIsNull(loopLoc)) {
      this.setErrorAt(WasmBailReason.ForEquationNoBody, forLoc);
      return 0;
    }

    if (ok == 2) {
      let inferredDim = this.findImplicitArrayDim(loopLoc, varNameId, prefixPathId);
      if (inferredDim > 0) {
        endVal = inferredDim as i32;
      } else {
        this.setErrorAt(WasmBailReason.ForEquationRange, fiLoc);
        return 0;
      }
    }

    let count: u32 = 0;
    for (let v: i32 = startVal; stepVal > 0 ? v <= endVal : v >= endVal; v += stepVal) {
      let litId = this.dae.addIntLiteral(v);
      this.exprVisitor.setLoopVar(varNameId, litId);

      let bodyCh = locNextSibling(loopLoc);
      while (!locIsNull(bodyCh)) {
        if (locMatches(bodyCh, "end") || locMatches(bodyCh, "end for")) break;
        if (!locMatches(bodyCh, ";") && locLen(bodyCh) > 0) {
          count += this.lowerEquationNode(bodyCh, isInitial);
          if (this.hasError) {
            this.exprVisitor.removeLoopVar(varNameId);
            return 0;
          }
        }
        bodyCh = locNextSibling(bodyCh);
      }
    }

    this.exprVisitor.removeLoopVar(varNameId);
    return count;
  }

  lowerSimpleEquation(eqLoc: u64, isInitial: boolean): u32 {
    let eq = CstNodeView.at(eqLoc);
    let lhsLoc: u64 = 0;
    let rhsLoc: u64 = 0;
    let chLoc = eq.firstChildLoc;
    while (!locIsNull(chLoc)) {
      let ch = CstNodeView.at(chLoc);
      if (ch.byteLength > 0) {
        if (lhsLoc == 0) {
          lhsLoc = chLoc;
        } else if (ch.matches("=")) {
          // skip '='
        } else if (rhsLoc == 0) {
          rhsLoc = chLoc;
        }
      }
      chLoc = locNextSibling(chLoc);
    }
    if (locIsNull(lhsLoc) || locIsNull(rhsLoc)) {
      lhsLoc = eq.child(0).loc;
      rhsLoc = eq.child(2).loc;
      if (locIsNull(rhsLoc)) rhsLoc = eq.child(1).loc;
    }
    if (locIsNull(lhsLoc) || locIsNull(rhsLoc)) {
      this.setErrorAt(WasmBailReason.SimpleEquationOperands, eqLoc);
      return 0;
    }

    let lhsExpr = this.exprVisitor.visitLoc(lhsLoc);
    let rhsExpr = this.exprVisitor.visitLoc(rhsLoc);
    if (lhsExpr == 0xffffffff || rhsExpr == 0xffffffff) {
      this.setErrorAt(WasmBailReason.SimpleEquationExpr, eqLoc);
      return 0;
    }
    let pool = this.dae.getStringPool();
    lhsExpr = resolveVarToArrayCtor(this.dae, pool, lhsExpr, this.exprVisitor.tempBuffer);
    rhsExpr = resolveVarToArrayCtor(this.dae, pool, rhsExpr, this.exprVisitor.tempBuffer);

    let prevEqLoc = this.curEqLoc;
    this.curEqLoc = eqLoc;
    let emitted = this.emitExpandedEquation(lhsExpr, rhsExpr, isInitial);
    this.curEqLoc = prevEqLoc;
    return emitted;
  }

  emitExpandedEquation(lhs: u32, rhs: u32, isInitial: boolean): u32 {
    let exprData = this.dae.getExprData();
    let lExpr = ExprAccessor.at(exprData, lhs);
    let rExpr = ExprAccessor.at(exprData, rhs);
    let lKind = lExpr.kind;
    let rKind = rExpr.kind;

    if (rKind == ExprKind.IfElse || lKind == ExprKind.IfElse) {
      let ifExpr = rKind == ExprKind.IfElse ? rhs : lhs;
      let pool = this.dae.getStringPool();
      let thenExpr = resolveVarToArrayCtor(this.dae, pool, this.dae.getExprLeft(ifExpr), this.exprVisitor.tempBuffer);
      let elseExpr = resolveVarToArrayCtor(this.dae, pool, this.dae.getExprRight(ifExpr), this.exprVisitor.tempBuffer);
      let tKind = this.dae.getExprKind(thenExpr);
      let eKind = this.dae.getExprKind(elseExpr);
      if (tKind == ExprKind.ArrayCtor && eKind == ExprKind.ArrayCtor) {
        let tCount = getArrayCtorCount(this.dae, thenExpr);
        let eCount = getArrayCtorCount(this.dae, elseExpr);
        if (tCount != eCount) {
          this.setError(WasmBailReason.IfExprArraySize);
          return 0;
        }
        if (tCount > 0) {
          let tFirst = getArrayCtorElement(this.dae, thenExpr, 0);
          let eFirst = getArrayCtorElement(this.dae, elseExpr, 0);
          let tFirstKind = this.dae.getExprKind(tFirst);
          let eFirstKind = this.dae.getExprKind(eFirst);
          if ((tFirstKind == ExprKind.ArrayCtor && eFirstKind != ExprKind.ArrayCtor) ||
              (tFirstKind != ExprKind.ArrayCtor && eFirstKind == ExprKind.ArrayCtor)) {
            this.setError(WasmBailReason.IfExprArrayNesting);
            return 0;
          }
        }
      } else if (tKind == ExprKind.ArrayCtor || eKind == ExprKind.ArrayCtor) {
        this.setError(WasmBailReason.IfExprArrayScalarMix);
        return 0;
      }
    }

    if (lKind == ExprKind.ArrayCtor && rKind == ExprKind.ArrayCtor) {
      let lCount = getArrayCtorCount(this.dae, lhs);
      let rCount = getArrayCtorCount(this.dae, rhs);
      if (lCount != rCount || lCount == 0) {
        this.setError(WasmBailReason.ArrayEquationSize);
        return 0;
      }
      let total: u32 = 0;
      for (let i: u32 = 0; i < lCount; i++) {
        let lElem = getArrayCtorElement(this.dae, lhs, i);
        let rElem = getArrayCtorElement(this.dae, rhs, i);
        let count = this.emitExpandedEquation(lElem, rElem, isInitial);
        if (this.hasError) return 0;
        total += count;
      }
      return total;
    }

    if (lKind == ExprKind.ArrayCtor || rKind == ExprKind.ArrayCtor) {
      this.setError(WasmBailReason.ArrayEquationNonCtor);
      return 0;
    }

    let pool = this.dae.getStringPool();
    if (lKind == ExprKind.Name) {
      let lNameId = this.resolveOuterToInner(pool, lExpr.data1);
      if (lNameId != lExpr.data1) {
        lhs = this.dae.addExpression(ExprKind.Name, lNameId);
        lExpr = ExprAccessor.at(this.dae.getExprData(), lhs);
      }
      if (this.dae.lookupVariableByName(lNameId) == -1 && !pool.isTime(lNameId) && !this.isInsideExpandableBus(lNameId, pool)) {
        this.setError(WasmBailReason.EquationLhsUnresolved);
        return 0;
      }
    }
    if (rKind == ExprKind.Name) {
      let rNameId = this.resolveOuterToInner(pool, rExpr.data1);
      if (rNameId != rExpr.data1) {
        rhs = this.dae.addExpression(ExprKind.Name, rNameId);
        rExpr = ExprAccessor.at(this.dae.getExprData(), rhs);
      }
      if (this.dae.lookupVariableByName(rNameId) == -1 && !pool.isTime(rNameId) && !this.isInsideExpandableBus(rNameId, pool)) {
        this.setError(WasmBailReason.EquationRhsUnresolved);
        return 0;
      }
    }

    let isLhsLit = (lKind == ExprKind.IntLiteral || lKind == ExprKind.RealLiteral || lKind == ExprKind.BoolLiteral || lKind == ExprKind.EnumLiteral);
    let isRhsVar = (rKind == ExprKind.Name);
    if (isLhsLit && isRhsVar) {
      let tmp = lhs;
      lhs = rhs;
      rhs = tmp;
      let tmpKind = lKind;
      lKind = rKind;
      rKind = tmpKind;
    }

    if (this.exprVisitor.isRealExpr(lhs) && !this.exprVisitor.isRealExpr(rhs)) {
      rhs = this.exprVisitor.castToReal(rhs);
    } else if (!this.exprVisitor.isRealExpr(lhs) && this.exprVisitor.isRealExpr(rhs)) {
      lhs = this.exprVisitor.castToReal(lhs);
    }

    let eqKind = isInitial ? EqKind.InitialSimple : EqKind.Simple;
    this.dae.addEquation(eqKind, lhs, rhs, isInitial ? (FLAG_EQ_INITIAL as u32) : 0);
    return 1;
  }

  evalConstScalar(exprId: u32, depth: i32 = 0): bool {
    if (exprId >= this.dae.exprCount || depth > 30) return false;
    let k = this.dae.getExprKind(exprId);
    if (k == ExprKind.RealLiteral) {
      this.scalarOutVal = this.dae.getExprRealValue(exprId);
      return true;
    }
    if (k == ExprKind.IntLiteral) {
      this.scalarOutVal = (this.dae.getExprData1(exprId) as i32) as f64;
      return true;
    }
    if (k == ExprKind.BoolLiteral) {
      this.scalarOutVal = this.dae.getExprData1(exprId) != 0 ? 1.0 : 0.0;
      return true;
    }
    if (k == ExprKind.EnumLiteral) {
      this.scalarOutVal = (this.dae.getExprData1(exprId) as i32) as f64;
      return true;
    }
    if (k == ExprKind.Name) {
      let nameId = this.dae.getExprData1(exprId);
      let resolvedNameId = this.exprVisitor.resolveVarName(nameId);
      let varIdx = this.dae.lookupVariableByName(resolvedNameId);
      if (varIdx < 0) varIdx = this.dae.lookupVariableByName(nameId);
      if (varIdx >= 0) {
        let varAcc = VarAccessor.at(this.dae.getVarData(), varIdx as u32);
        let vVar = varAcc.variability;
        if (vVar == Variability.Constant || vVar == Variability.Parameter) {
          if (this.isOmcCompatibility && vVar == Variability.Parameter) {
            varAcc.setFlag(FLAG_VAR_FINAL);
          }
          let bExpr = this.dae.getVarAttrExpr(varIdx as u32, VarAttrKind.Binding as u32);
          if (bExpr != 0 && bExpr != 0xffffffff && bExpr != exprId) {
            if (this.evalConstScalar(bExpr, depth + 1)) return true;
          }
          let vt = varAcc.varType;
          if (vt == VarType.Real || vt == VarType.Integer || vt == VarType.Boolean || vt == VarType.Enumeration) {
            this.scalarOutVal = varAcc.startValue;
            return true;
          }
        }
      }
      return false;
    }
    if (k == ExprKind.Negate) {
      if (this.evalConstScalar(this.dae.getExprLeft(exprId), depth + 1)) {
        this.scalarOutVal = -this.scalarOutVal;
        return true;
      }
      return false;
    }
    if (k == ExprKind.Unary) {
      let op = this.dae.getExprData1(exprId);
      if (op == UnaryOp.Negate) {
        if (this.evalConstScalar(this.dae.getExprLeft(exprId), depth + 1)) {
          this.scalarOutVal = -this.scalarOutVal;
          return true;
        }
      }
      return false;
    }
    if (k == ExprKind.Binary) {
      let op = this.dae.getExprData1(exprId);
      if (!this.evalConstScalar(this.dae.getExprLeft(exprId), depth + 1)) return false;
      let lVal = this.scalarOutVal;
      if (!this.evalConstScalar(this.dae.getExprRight(exprId), depth + 1)) return false;
      let rVal = this.scalarOutVal;
      if (op == BinOp.Add) { this.scalarOutVal = lVal + rVal; return true; }
      if (op == BinOp.Sub) { this.scalarOutVal = lVal - rVal; return true; }
      if (op == BinOp.Mul) { this.scalarOutVal = lVal * rVal; return true; }
      if (op == BinOp.Div) {
        if (rVal != 0.0) { this.scalarOutVal = lVal / rVal; return true; }
        return false;
      }
      if (op == BinOp.Pow) { this.scalarOutVal = Math.pow(lVal, rVal); return true; }
      return false;
    }
    return false;
  }

  evalCondExpr(exprId: u32, depth: i32 = 0): i32 {
    if (exprId >= this.dae.exprCount || depth > 30) return 2;
    let k = this.dae.getExprKind(exprId);
    if (k == ExprKind.BoolLiteral) {
      return this.dae.getExprData1(exprId) != 0 ? 1 : 0;
    }
    if (k == ExprKind.Name) {
      let nameId = this.dae.getExprData1(exprId);
      let resolvedNameId = this.exprVisitor.resolveVarName(nameId);
      let varIdx = this.dae.lookupVariableByName(resolvedNameId);
      if (varIdx < 0) varIdx = this.dae.lookupVariableByName(nameId);
      if (varIdx >= 0) {
        let varAcc = VarAccessor.at(this.dae.getVarData(), varIdx as u32);
        let vVar = varAcc.variability;
        if (vVar == Variability.Constant || vVar == Variability.Parameter) {
          if (this.isOmcCompatibility && vVar == Variability.Parameter) {
            varAcc.setFlag(FLAG_VAR_FINAL);
          }
          let bExpr = this.dae.getVarAttrExpr(varIdx as u32, VarAttrKind.Binding as u32);
          if (bExpr != 0 && bExpr != 0xffffffff && bExpr != exprId) {
            let res = this.evalCondExpr(bExpr, depth + 1);
            if (res != 2) return res;
          }
          let vt = varAcc.varType;
          if (vt == VarType.Boolean) {
            return varAcc.startValue != 0.0 ? 1 : 0;
          }
        }
      }
      return 2;
    }
    if (k == ExprKind.Unary) {
      let op = this.dae.getExprData1(exprId);
      if (op == UnaryOp.Not) {
        let sub = this.evalCondExpr(this.dae.getExprLeft(exprId), depth + 1);
        if (sub == 0) return 1;
        if (sub == 1) return 0;
        return 2;
      }
    }
    if (k == ExprKind.Binary) {
      let op = this.dae.getExprData1(exprId);
      let left = this.dae.getExprLeft(exprId);
      let right = this.dae.getExprRight(exprId);
      if (op == BinOp.And) {
        let l = this.evalCondExpr(left, depth + 1);
        let r = this.evalCondExpr(right, depth + 1);
        if (l == 0 || r == 0) return 0;
        if (l == 1 && r == 1) return 1;
        return 2;
      }
      if (op == BinOp.Or) {
        let l = this.evalCondExpr(left, depth + 1);
        let r = this.evalCondExpr(right, depth + 1);
        if (l == 1 || r == 1) return 1;
        if (l == 0 && r == 0) return 0;
        return 2;
      }
      if (this.evalConstScalar(left, depth + 1)) {
        let lVal = this.scalarOutVal;
        if (this.evalConstScalar(right, depth + 1)) {
          let rVal = this.scalarOutVal;
          let diff = lVal - rVal;
          if (op == BinOp.Eq) return Math.abs(diff) < 1e-12 ? 1 : 0;
          if (op == BinOp.Neq) return Math.abs(diff) >= 1e-12 ? 1 : 0;
          if (op == BinOp.Lt) return lVal < rVal ? 1 : 0;
          if (op == BinOp.Lte) return lVal <= rVal ? 1 : 0;
          if (op == BinOp.Gt) return lVal > rVal ? 1 : 0;
          if (op == BinOp.Gte) return lVal >= rVal ? 1 : 0;
        }
      }
      return 2;
    }
    return 2;
  }

  isEqAtom(t: u16): boolean {
    return t == SyntaxType.SOME_EQUATION || t == SyntaxType.EQUATION_OR_PROCEDURE ||
      t == SyntaxType.SIMPLE_EQUATION || t == SyntaxType.CONNECT_EQUATION ||
      t == SyntaxType.FUNCTION_CALL || t == SyntaxType.EXPRESSION ||
      t == SyntaxType.IF_EQUATION || t == SyntaxType.FOR_EQUATION ||
      t == SyntaxType.WHEN_EQUATION || t == SyntaxType.DESCRIPTION;
  }

  collectEqItems(nodeLoc: u64): void {
    let ch = locFirstChild(nodeLoc);
    while (!locIsNull(ch)) {
      if (locLen(ch) > 0) {
        if (this.isEqAtom(locType(ch)) || locChildCount(ch) == 0) {
          this.stmtItems.push((ch & 0xffffffff) as u32);
          this.stmtItems.push((ch >> 32) as u32);
        } else {
          this.collectEqItems(ch);
        }
      }
      ch = locNextSibling(ch);
    }
  }

  lowerInlineEquation(eqLoc: u64, out: ChunkedInt32Array, isWhen: boolean): boolean {
    if (locIsNull(eqLoc) || locMatches(eqLoc, ";") || locLen(eqLoc) == 0 || locType(eqLoc) == SyntaxType.DESCRIPTION) return true;
    let t = locType(eqLoc);
    if (t == SyntaxType.SIMPLE_EQUATION) {
      let eq = CstNodeView.at(eqLoc);
      let lhsLoc: u64 = 0;
      let rhsLoc: u64 = 0;
      let chLoc = eq.firstChildLoc;
      while (!locIsNull(chLoc)) {
        let ch = CstNodeView.at(chLoc);
        if (ch.byteLength > 0) {
          if (lhsLoc == 0) {
            lhsLoc = chLoc;
          } else if (ch.matches("=")) {
            // skip '='
          } else if (rhsLoc == 0) {
            rhsLoc = chLoc;
          }
        }
        chLoc = locNextSibling(chLoc);
      }
      if (locIsNull(lhsLoc) || locIsNull(rhsLoc)) {
        lhsLoc = eq.child(0).loc;
        rhsLoc = eq.child(2).loc;
        if (locIsNull(rhsLoc)) rhsLoc = eq.child(1).loc;
      }
      if (locIsNull(lhsLoc) || locIsNull(rhsLoc)) {
        this.setErrorAt(WasmBailReason.SimpleEquationOperands, eqLoc);
        return false;
      }
      let lhsId = this.exprVisitor.visitLoc(lhsLoc);
      let rhsId = this.exprVisitor.visitLoc(rhsLoc);
      if (lhsId == 0xffffffff || rhsId == 0xffffffff) {
        this.setErrorAt(WasmBailReason.SimpleEquationExpr, eqLoc);
        return false;
      }
      let pool = this.dae.getStringPool();
      lhsId = resolveVarToArrayCtor(this.dae, pool, lhsId, this.exprVisitor.tempBuffer);
      rhsId = resolveVarToArrayCtor(this.dae, pool, rhsId, this.exprVisitor.tempBuffer);
      if (isWhen) {
        let lhsKind = this.dae.getExprKind(lhsId);
        if (lhsKind == ExprKind.Binary || lhsKind == ExprKind.RealLiteral ||
            lhsKind == ExprKind.IntLiteral || lhsKind == ExprKind.Unary) {
          this.setErrorAt(WasmBailReason.InvalidWhenLhs, lhsLoc);
          return false;
        }
      }
      if (this.exprVisitor.isRealExpr(lhsId) && !this.exprVisitor.isRealExpr(rhsId)) {
        rhsId = this.exprVisitor.castToReal(rhsId);
      } else if (!this.exprVisitor.isRealExpr(lhsId) && this.exprVisitor.isRealExpr(rhsId)) {
        lhsId = this.exprVisitor.castToReal(lhsId);
      }
      out.push(EqKind.Simple as i32);
      out.push(lhsId as i32);
      out.push(rhsId as i32);
      return true;
    }
    if (t == SyntaxType.FUNCTION_CALL) {
      let callExpr = this.exprVisitor.visitLoc(eqLoc);
      if (callExpr == 0xffffffff) {
        this.setErrorAt(WasmBailReason.SimpleEquationExpr, eqLoc);
        return false;
      }
      out.push(EqKind.FunctionCall as i32);
      out.push(callExpr as i32);
      out.push(0xffffffff);
      return true;
    }
    if (t != SyntaxType.CLASS_DEFINITION && locChildCount(eqLoc) > 0) {
      let ch = locFirstChild(eqLoc);
      while (!locIsNull(ch)) {
        if (!locMatches(ch, ";") && locLen(ch) > 0 && locType(ch) != SyntaxType.DESCRIPTION) {
          if (!this.lowerInlineEquation(ch, out, isWhen)) return false;
        }
        ch = locNextSibling(ch);
      }
      return true;
    }
    return false;
  }

  lowerIfEquation(ifLoc: u64, isInitial: boolean): u32 {
    let start = this.stmtItems.length;
    this.collectEqItems(ifLoc);
    let end = this.stmtItems.length;
    let auxStart = this.stmtAux.length;
    this.collectStmtBranches(start, end, "if", "elseif", "end if");
    let auxEnd = this.stmtAux.length;

    let numBranches = (auxEnd - auxStart) / 4;
    if (numBranches == 0) {
      this.stmtAux.length = auxStart;
      this.stmtItems.length = start;
      this.setErrorAt(WasmBailReason.WhenOrIfEquation, ifLoc);
      return 0;
    }

    // Static parameter branch evaluation
    let isDynamic = false;
    let chosenBranch: i32 = -1;

    for (let b = auxStart; b < auxEnd; b += 4) {
      let condIdx = this.stmtAux.get(b);
      if (condIdx != 0xffffffff) {
        let condLoc = this.stmtItemAt(condIdx);
        let condId = this.exprVisitor.visitLoc(condLoc);
        if (condId == 0xffffffff) {
          isDynamic = true;
          break;
        }
        let st = this.evalCondExpr(condId);
        if (st == 2) {
          isDynamic = true;
          break;
        } else if (st == 1) {
          chosenBranch = (b - auxStart) / 4;
          break;
        }
      } else {
        chosenBranch = (b - auxStart) / 4;
        break;
      }
    }

    if (!isDynamic && chosenBranch >= 0) {
      let b = auxStart + (chosenBranch as u32) * 4;
      let bodyFrom = this.stmtAux.get(b + 1);
      let bodyTo = this.stmtAux.get(b + 2);
      let locs = new Array<u64>();
      for (let i = bodyFrom; i < bodyTo; i += 2) {
        let it = this.stmtItemAt(i);
        if (!locMatches(it, ";") && locLen(it) > 0 && locType(it) != SyntaxType.DESCRIPTION) {
          locs.push(it);
        }
      }
      this.stmtAux.length = auxStart;
      this.stmtItems.length = start;
      let count: u32 = 0;
      for (let i: i32 = 0; i < locs.length; i++) {
        count += this.lowerEquationNode(locs[i], isInitial);
        if (this.hasError) break;
      }
      return this.hasError ? 0 : count;
    }

    // Dynamic if-equation: check for connect()
    for (let b = auxStart; b < auxEnd; b += 4) {
      let bodyFrom = this.stmtAux.get(b + 1);
      let bodyTo = this.stmtAux.get(b + 2);
      for (let i = bodyFrom; i < bodyTo; i += 2) {
        let it = this.stmtItemAt(i);
        if (!locMatches(it, ";") && locLen(it) > 0 && locType(it) != SyntaxType.DESCRIPTION) {
          if (!locIsNull(locFindDescendant(it, SyntaxType.CONNECT_EQUATION))) {
            this.stmtAux.length = auxStart;
            this.stmtItems.length = start;
            this.setErrorAt(WasmBailReason.ConnectInDynamicIf, it);
            return 0;
          }
        }
      }
    }

    let firstCondIdx = this.stmtAux.get(auxStart);
    if (firstCondIdx == 0xffffffff) {
      this.stmtAux.length = auxStart;
      this.stmtItems.length = start;
      this.setErrorAt(WasmBailReason.WhenOrIfEquation, ifLoc);
      return 0;
    }
    let firstCondLoc = this.stmtItemAt(firstCondIdx);
    let firstCondId = this.exprVisitor.visitLoc(firstCondLoc);
    if (firstCondId == 0xffffffff) {
      this.stmtAux.length = auxStart;
      this.stmtItems.length = start;
      this.setErrorAt(WasmBailReason.WhenOrIfEquation, firstCondLoc);
      return 0;
    }

    let ifEqIdx = this.dae.addEquation(EqKind.If as i32, firstCondId, 0);

    let tempEqs = createChunkedInt32Array(32);
    this.ifRecords.push(ifEqIdx as i32);
    this.ifRecords.push(firstCondId as i32);

    let thenFrom = this.stmtAux.get(auxStart + 1);
    let thenTo = this.stmtAux.get(auxStart + 2);
    tempEqs.length = 0;
    for (let i = thenFrom; i < thenTo; i += 2) {
      let eqLoc = this.stmtItemAt(i);
      if (!locMatches(eqLoc, ";") && locLen(eqLoc) > 0 && locType(eqLoc) != SyntaxType.DESCRIPTION) {
        if (!this.lowerInlineEquation(eqLoc, tempEqs, false)) {
          this.stmtAux.length = auxStart;
          this.stmtItems.length = start;
          if (!this.hasError) this.setErrorAt(WasmBailReason.WhenOrIfEquation, eqLoc);
          return 0;
        }
      }
    }
    this.ifRecords.push((tempEqs.length / 3) as i32);
    for (let i: u32 = 0; i < tempEqs.length; i++) {
      this.ifRecords.push(tempEqs.get(i));
    }

    let elseIfBranchCount: i32 = 0;
    for (let b = auxStart + 4; b < auxEnd; b += 4) {
      let condIdx = this.stmtAux.get(b);
      if (condIdx != 0xffffffff) elseIfBranchCount++;
    }
    this.ifRecords.push(elseIfBranchCount);

    for (let b = auxStart + 4; b < auxEnd; b += 4) {
      let condIdx = this.stmtAux.get(b);
      if (condIdx != 0xffffffff) {
        let condLoc = this.stmtItemAt(condIdx);
        let elseCondId = this.exprVisitor.visitLoc(condLoc);
        if (elseCondId == 0xffffffff) {
          this.stmtAux.length = auxStart;
          this.stmtItems.length = start;
          this.setErrorAt(WasmBailReason.WhenOrIfEquation, condLoc);
          return 0;
        }
        let bFrom = this.stmtAux.get(b + 1);
        let bTo = this.stmtAux.get(b + 2);
        tempEqs.length = 0;
        for (let i = bFrom; i < bTo; i += 2) {
          let eqLoc = this.stmtItemAt(i);
          if (!locMatches(eqLoc, ";") && locLen(eqLoc) > 0 && locType(eqLoc) != SyntaxType.DESCRIPTION) {
            if (!this.lowerInlineEquation(eqLoc, tempEqs, false)) {
              this.stmtAux.length = auxStart;
              this.stmtItems.length = start;
              if (!this.hasError) this.setErrorAt(WasmBailReason.WhenOrIfEquation, eqLoc);
              return 0;
            }
          }
        }
        this.ifRecords.push(elseCondId as i32);
        this.ifRecords.push((tempEqs.length / 3) as i32);
        for (let i: u32 = 0; i < tempEqs.length; i++) {
          this.ifRecords.push(tempEqs.get(i));
        }
      }
    }

    let hasElse = false;
    for (let b = auxStart + 4; b < auxEnd; b += 4) {
      let condIdx = this.stmtAux.get(b);
      if (condIdx == 0xffffffff) {
        hasElse = true;
        let bFrom = this.stmtAux.get(b + 1);
        let bTo = this.stmtAux.get(b + 2);
        tempEqs.length = 0;
        for (let i = bFrom; i < bTo; i += 2) {
          let eqLoc = this.stmtItemAt(i);
          if (!locMatches(eqLoc, ";") && locLen(eqLoc) > 0 && locType(eqLoc) != SyntaxType.DESCRIPTION) {
            if (!this.lowerInlineEquation(eqLoc, tempEqs, false)) {
              this.stmtAux.length = auxStart;
              this.stmtItems.length = start;
              if (!this.hasError) this.setErrorAt(WasmBailReason.WhenOrIfEquation, eqLoc);
              return 0;
            }
          }
        }
        this.ifRecords.push((tempEqs.length / 3) as i32);
        for (let i: u32 = 0; i < tempEqs.length; i++) {
          this.ifRecords.push(tempEqs.get(i));
        }
        break;
      }
    }
    if (!hasElse) {
      this.ifRecords.push(0);
    }

    this.ifRecordCount++;
    this.stmtAux.length = auxStart;
    this.stmtItems.length = start;
    return 1;
  }

  lowerWhenEquation(whenLoc: u64, isInitial: boolean): u32 {
    if (isInitial) {
      this.setErrorAt(WasmBailReason.WhenInInitialEquation, whenLoc);
      return 0;
    }

    let start = this.stmtItems.length;
    this.collectEqItems(whenLoc);
    let end = this.stmtItems.length;
    let auxStart = this.stmtAux.length;
    this.collectStmtBranches(start, end, "when", "elsewhen", "end when");
    let auxEnd = this.stmtAux.length;

    let numBranches = (auxEnd - auxStart) / 4;
    if (numBranches == 0) {
      this.stmtAux.length = auxStart;
      this.stmtItems.length = start;
      this.setErrorAt(WasmBailReason.WhenOrIfEquation, whenLoc);
      return 0;
    }

    // Check conditions for noEvent and connect()
    for (let b = auxStart; b < auxEnd; b += 4) {
      let condIdx = this.stmtAux.get(b);
      if (condIdx != 0xffffffff) {
        let condLoc = this.stmtItemAt(condIdx);
        if (
          !locIsNull(locFindMatchingDescendant(condLoc, "noEvent")) ||
          !locIsNull(locFindMatchingDescendant(condLoc, "Clock"))
        ) {
          this.stmtAux.length = auxStart;
          this.stmtItems.length = start;
          this.setErrorAt(WasmBailReason.WhenConditionNonDiscrete, condLoc);
          return 0;
        }
      }
      let bFrom = this.stmtAux.get(b + 1);
      let bTo = this.stmtAux.get(b + 2);
      for (let i = bFrom; i < bTo; i += 2) {
        let eqLoc = this.stmtItemAt(i);
        if (!locMatches(eqLoc, ";") && locLen(eqLoc) > 0 && locType(eqLoc) != SyntaxType.DESCRIPTION) {
          if (!locIsNull(locFindDescendant(eqLoc, SyntaxType.CONNECT_EQUATION))) {
            this.stmtAux.length = auxStart;
            this.stmtItems.length = start;
            this.setErrorAt(WasmBailReason.ConnectInWhen, eqLoc);
            return 0;
          }
        }
      }
    }

    let firstCondIdx = this.stmtAux.get(auxStart);
    if (firstCondIdx == 0xffffffff) {
      this.stmtAux.length = auxStart;
      this.stmtItems.length = start;
      this.setErrorAt(WasmBailReason.WhenOrIfEquation, whenLoc);
      return 0;
    }
    let firstCondLoc = this.stmtItemAt(firstCondIdx);
    let firstCondId = this.exprVisitor.visitLoc(firstCondLoc);
    if (firstCondId == 0xffffffff) {
      this.stmtAux.length = auxStart;
      this.stmtItems.length = start;
      this.setErrorAt(WasmBailReason.WhenOrIfEquation, firstCondLoc);
      return 0;
    }

    let whenEqIdx = this.dae.addEquation(EqKind.When as i32, firstCondId, 0);

    let tempEqs = createChunkedInt32Array(32);
    this.whenRecords.push(whenEqIdx as i32);
    this.whenRecords.push(firstCondId as i32);

    let thenFrom = this.stmtAux.get(auxStart + 1);
    let thenTo = this.stmtAux.get(auxStart + 2);
    tempEqs.length = 0;
    for (let i = thenFrom; i < thenTo; i += 2) {
      let eqLoc = this.stmtItemAt(i);
      if (!locMatches(eqLoc, ";") && locLen(eqLoc) > 0 && locType(eqLoc) != SyntaxType.DESCRIPTION) {
        if (!this.lowerInlineEquation(eqLoc, tempEqs, true)) {
          this.stmtAux.length = auxStart;
          this.stmtItems.length = start;
          if (!this.hasError) this.setErrorAt(WasmBailReason.WhenOrIfEquation, eqLoc);
          return 0;
        }
      }
    }
    this.whenRecords.push((tempEqs.length / 3) as i32);
    for (let i: u32 = 0; i < tempEqs.length; i++) {
      this.whenRecords.push(tempEqs.get(i));
    }

    // Elsewhen branches
    this.whenRecords.push((numBranches - 1) as i32);
    for (let b = auxStart + 4; b < auxEnd; b += 4) {
      let condIdx = this.stmtAux.get(b);
      let condLoc = condIdx != 0xffffffff ? this.stmtItemAt(condIdx) : 0;
      let elseCondId = condLoc != 0 ? this.exprVisitor.visitLoc(condLoc) : 0xffffffff;
      if (elseCondId == 0xffffffff) {
        this.stmtAux.length = auxStart;
        this.stmtItems.length = start;
        this.setErrorAt(WasmBailReason.WhenOrIfEquation, condLoc);
        return 0;
      }
      let bFrom = this.stmtAux.get(b + 1);
      let bTo = this.stmtAux.get(b + 2);
      tempEqs.length = 0;
      for (let i = bFrom; i < bTo; i += 2) {
        let eqLoc = this.stmtItemAt(i);
        if (!locMatches(eqLoc, ";") && locLen(eqLoc) > 0 && locType(eqLoc) != SyntaxType.DESCRIPTION) {
          if (!this.lowerInlineEquation(eqLoc, tempEqs, true)) {
            this.stmtAux.length = auxStart;
            this.stmtItems.length = start;
            if (!this.hasError) this.setErrorAt(WasmBailReason.WhenOrIfEquation, eqLoc);
            return 0;
          }
        }
      }
      this.whenRecords.push(elseCondId as i32);
      this.whenRecords.push((tempEqs.length / 3) as i32);
      for (let i: u32 = 0; i < tempEqs.length; i++) {
        this.whenRecords.push(tempEqs.get(i));
      }
    }

    this.whenRecordCount++;
    this.stmtAux.length = auxStart;
    this.stmtItems.length = start;
    return 1;
  }

  collectConnectRefs(loc: u64): void {
    let ch = locFirstChild(loc);
    while (!locIsNull(ch)) {
      if (locLen(ch) > 0) {
        let t = locType(ch);
        if (t == SyntaxType.COMPONENT_REFERENCE) {
          if (this.connectRefFound == 0) {
            this.connectRef1 = ch;
            this.connectRefFound = 1;
          } else if (this.connectRefFound == 1) {
            this.connectRef2 = ch;
            this.connectRefFound = 2;
            return;
          }
        } else if ((t == SyntaxType.NAME || t == SyntaxType.IDENTIFIER || t == SyntaxType.TOKEN_IDENTIFIER_ALT) && !locMatches(ch, "connect")) {
          if (this.connectRefFound == 0) {
            this.connectRef1 = ch;
            this.connectRefFound = 1;
          } else if (this.connectRefFound == 1) {
            this.connectRef2 = ch;
            this.connectRefFound = 2;
            return;
          }
        } else if (locChildCount(ch) > 0 && !locMatches(ch, "connect") && !locMatches(ch, "(") && !locMatches(ch, ")") && !locMatches(ch, ",") && !locMatches(ch, ";")) {
          this.collectConnectRefs(ch);
          if (this.connectRefFound >= 2) return;
        }
      }
      ch = locNextSibling(ch);
    }
  }

  lowerConnectEquation(eqLoc: u64): u32 {
    this.connectRef1 = 0;
    this.connectRef2 = 0;
    this.connectRefFound = 0;
    this.collectConnectRefs(eqLoc);
    if (this.connectRefFound < 2) return 0;
    let c1 = this.connectRef1;
    let c2 = this.connectRef2;

    let pool = this.dae.getStringPool();
    let prefixId = this.scopeStackPtr != 0 ? changetype<ScopeStack>(this.scopeStackPtr).currentPrefixPathId : 0;
    let raw1 = locIntern(pool, c1);
    let raw2 = locIntern(pool, c2);
    let full1 = prefixId != 0 ? pool.concatIds(prefixId, raw1) : raw1;
    let full2 = prefixId != 0 ? pool.concatIds(prefixId, raw2) : raw2;
    if (this.isComponentDisabled(full1, pool) || this.isComponentDisabled(raw1, pool) ||
        this.isComponentDisabled(full2, pool) || this.isComponentDisabled(raw2, pool)) {
      return 0;
    }

    let e1 = this.exprVisitor.visitLoc(c1);
    let e2 = this.exprVisitor.visitLoc(c2);
    if (e1 == 0xffffffff || e2 == 0xffffffff) {
      this.setErrorAt(WasmBailReason.ConnectRefExpr, eqLoc);
      return 0;
    }

    let isC1Outside = false;
    let isC2Outside = false;
    if (prefixId != 0) {
      isC1Outside = !pool.hasDot(raw1);
      isC2Outside = !pool.hasDot(raw2);
    }
    let connFlags: u32 = (isC1Outside ? 1 : 0) | (isC2Outside ? 2 : 0);

    this.dae.addEquation(EqKind.Connect, e1, e2, connFlags);
    return 1;
  }

  instantiateClass(classNodePtr: u32, prefixPathId: u32, isTopLevelInterface: boolean = false, parentCausality: i32 = 0): u32 {
    return this.instantiateClassLoc(locMakeRoot(classNodePtr), prefixPathId, isTopLevelInterface, parentCausality);
  }

  instantiateClassLoc(classLoc: u64, prefixPathId: u32, isTopLevelInterface: boolean = false, parentCausality: i32 = 0, isBaseProtected: boolean = false): u32 {
    if (locIsNull(classLoc)) return 0;
    let pool = this.dae.getStringPool();
    let prevClassLoc = this.currentClassLoc;
    this.currentClassLoc = classLoc;

    let compLoc = findCompositionLoc(classLoc);
    if (locIsNull(compLoc)) {
      let shortSpec = this.findShortClassSpecifier(classLoc);
      if (!locIsNull(shortSpec)) {
        let baseTypeSpec = locFindDescendant(shortSpec, SyntaxType.TYPE_SPECIFIER);
        if (!locIsNull(baseTypeSpec)) {
          let targetId = locIntern(pool, baseTypeSpec);
          let targetClassLoc: u64 = this.findClassLoc(this.currentClassLoc, targetId, pool);
          if (locIsNull(targetClassLoc)) {
            let baseIdLoc = locFindLastDescendant(baseTypeSpec, SyntaxType.IDENTIFIER);
            if (locIsNull(baseIdLoc)) baseIdLoc = locFindLastDescendant(baseTypeSpec, SyntaxType.TOKEN_IDENTIFIER_ALT);
            if (locIsNull(baseIdLoc)) baseIdLoc = locFindLastDescendant(baseTypeSpec, SyntaxType.NAME);
            if (!locIsNull(baseIdLoc)) {
              targetId = locIntern(pool, baseIdLoc);
              targetClassLoc = this.findClassLoc(this.currentClassLoc, targetId, pool);
            }
          }
          if (!locIsNull(targetClassLoc) && targetClassLoc != classLoc) {
            let shortEnvPtr: u32 = 0;
            let shortMod = locFindDescendant(shortSpec, SyntaxType.CLASS_MODIFICATION);
            if (locIsNull(shortMod)) shortMod = locFindDescendant(shortSpec, SyntaxType.CLASS_OR_INHERITANCE_MODIFICATION);
            if (!locIsNull(shortMod)) {
              shortEnvPtr = flattener_envCreate(this.scopeStack.currentEnvPtr);
              populateEnvFromClassModLoc(shortEnvPtr, shortMod, pool, this.exprVisitor, true);
            }
            this.scopeStack.push(0, shortEnvPtr, prefixPathId, 0);
            let added = this.instantiateClassLoc(targetClassLoc, prefixPathId, isTopLevelInterface, parentCausality, isBaseProtected);
            this.scopeStack.pop();
            this.currentClassLoc = prevClassLoc;
            return added;
          }
        }
      }

      this.currentClassLoc = prevClassLoc;
      return 0;
    }

    let varCountBefore = this.dae.varCount;
    this.instantiateCompositionElements(compLoc, prefixPathId, pool, isTopLevelInterface, parentCausality, isBaseProtected);
    this.currentClassLoc = prevClassLoc;
    return this.dae.varCount - varCountBefore;
  }


  hasLateArrayOrExtendsDependency(parentLoc: u64, maxDepth: i32 = 8): boolean {
    if (locIsNull(parentLoc) || maxDepth <= 0) return false;
    let seenNonParam = false;
    let seenNonParamNeedsParam = false;
    let ch = locFirstChild(parentLoc);
    while (!locIsNull(ch)) {
      let t = locType(ch);
      if (t == SyntaxType.COMPONENT_CLAUSE || t == SyntaxType.COMPONENT_CLAUSE1) {
        let isParam = this.isComponentClauseParamOrConst(ch);
        if (!isParam) {
          seenNonParam = true;
          if (!locIsNull(locFindDescendant(ch, SyntaxType.ARRAY_SUBSCRIPTS)) ||
              !locIsNull(locFindDescendant(ch, SyntaxType.CONDITION_ATTRIBUTE))) {
            seenNonParamNeedsParam = true;
          }
        } else if (seenNonParamNeedsParam) {
          return true;
        }
      } else if (t == SyntaxType.EXTENDS_CLAUSE) {
        if (seenNonParam) return true;
      } else if (t != SyntaxType.CLASS_DEFINITION && t != SyntaxType.EQUATION_SECTION && t != SyntaxType.ALGORITHM_SECTION) {
        if (this.hasLateArrayOrExtendsDependency(ch, maxDepth - 1)) return true;
      }
      ch = locNextSibling(ch);
    }
    return false;
  }

  instantiateCompositionElements(parentLoc: u64, prefixPathId: u32, pool: ArenaStringPool, isTopLevelInterface: boolean = false, parentCausality: i32 = 0, isBaseProtected: boolean = false): u32 {
    let count: u32 = 0;
    this.preScanInnerDeclarations(parentLoc, prefixPathId, pool);
    if (!this.hasLateArrayOrExtendsDependency(parentLoc)) {
      return this.instantiateCompositionElementsPass(parentLoc, prefixPathId, pool, isTopLevelInterface, parentCausality, isBaseProtected, 0);
    }
    // Pass 1: Parameters, Constants, and Extends clauses
    count += this.instantiateCompositionElementsPass(parentLoc, prefixPathId, pool, isTopLevelInterface, parentCausality, isBaseProtected, 1);
    if (this.hasError) return 0;
    // Pass 2: Non-parameters (Variables and Sub-components)
    count += this.instantiateCompositionElementsPass(parentLoc, prefixPathId, pool, isTopLevelInterface, parentCausality, isBaseProtected, 2);
    return count;
  }

  instantiateCompositionElementsPass(parentLoc: u64, prefixPathId: u32, pool: ArenaStringPool, isTopLevelInterface: boolean = false, parentCausality: i32 = 0, isBaseProtected: boolean = false, pass: i32 = 0): u32 {
    let parent = CstNodeView.at(parentLoc);
    let chLoc = parent.firstChildLoc;
    let count: u32 = 0;
    let isSectionProtected: boolean = isBaseProtected;
    while (!locIsNull(chLoc)) {
      if (this.hasError) return 0;
      let t = locType(chLoc);
      if (t == SyntaxType.TOKEN_PROTECTED || locMatches(chLoc, "protected")) {
        isSectionProtected = true;
      } else if (t == SyntaxType.TOKEN_PUBLIC || locMatches(chLoc, "public")) {
        isSectionProtected = isBaseProtected;
      } else {
        count += this.instantiateCompositionElement(chLoc, prefixPathId, pool, isTopLevelInterface, parentCausality, isSectionProtected, false, false, false, 30, pass);
      }
      if (this.hasError) return 0;
      chLoc = locNextSibling(chLoc);
    }
    return count;
  }

  instantiateCompositionElement(elementLoc: u64, prefixPathId: u32, pool: ArenaStringPool, isTopLevelInterface: boolean = false, parentCausality: i32 = 0, isSectionProtected: boolean = false, isFinal: boolean = false, isInner: boolean = false, isOuter: boolean = false, maxDepth: i32 = 120, pass: i32 = 0): u32 {
    let el = CstNodeView.at(elementLoc);
    if (el.isNull || maxDepth <= 0) return 0;
    if (this.hasError) return 0;
    let t = el.type;

    if (t == SyntaxType.TOKEN_PROTECTED || locMatches(elementLoc, "protected")) {
      return 0;
    }
    if (t == SyntaxType.TOKEN_PUBLIC || locMatches(elementLoc, "public")) {
      return 0;
    }

    if (t == SyntaxType.COMPONENT_CLAUSE || t == SyntaxType.COMPONENT_CLAUSE1) {
      let isParam = this.isComponentClauseParamOrConst(elementLoc);
      if (pass == 1 && !isParam) return 0;
      if (pass == 2 && isParam) return 0;
      return this.instantiateComponentClause(elementLoc, prefixPathId, pool, isTopLevelInterface, parentCausality, isSectionProtected, isFinal, isInner, isOuter);
    }

    if (t == SyntaxType.EXTENDS_CLAUSE) {
      if (pass == 2) return 0; // extends clauses instantiated in pass 1
      return this.instantiateExtendsClause(elementLoc, prefixPathId, pool, isTopLevelInterface, parentCausality, isSectionProtected);
    }

    if (t == SyntaxType.ALGORITHM_SECTION) {
      // Statements are lowered together with equations (lowerElementEquationsLoc).
      return 0;
    }

    if (t != SyntaxType.CLASS_DEFINITION && t != SyntaxType.EQUATION_SECTION) {
      let subLoc = el.firstChildLoc;
      let count: u32 = 0;
      let curProtected: boolean = isSectionProtected;
      let curFinal: boolean = isFinal;
      let curInner: boolean = isInner;
      let curOuter: boolean = isOuter;
      while (!locIsNull(subLoc)) {
        let st = locType(subLoc);
        if (st == SyntaxType.TOKEN_PROTECTED || locMatches(subLoc, "protected")) {
          curProtected = true;
        } else if (st == SyntaxType.TOKEN_PUBLIC || locMatches(subLoc, "public")) {
          curProtected = false;
        } else if (locMatches(subLoc, "final")) {
          curFinal = true;
        } else if (locMatches(subLoc, "inner") || (st == SyntaxType.TOKEN_INNER && locLen(subLoc) > 0)) {
          curInner = true;
        } else if (locMatches(subLoc, "outer") || (st == SyntaxType.TOKEN_OUTER && locLen(subLoc) > 0)) {
          curOuter = true;
        } else {
          count += this.instantiateCompositionElement(subLoc, prefixPathId, pool, isTopLevelInterface, parentCausality, curProtected, curFinal, curInner, curOuter, maxDepth - 1, pass);
        }
        if (this.hasError) return 0;
        subLoc = locNextSibling(subLoc);
      }
      return count;
    }

    return 0;
  }

  isComponentClauseParamOrConst(clauseLoc: u64): boolean {
    let typePrefixLoc = locFindDescendant(clauseLoc, SyntaxType.TYPE_PREFIX);
    if (locIsNull(typePrefixLoc)) return false;
    let ch = locFirstChild(typePrefixLoc);
    while (!locIsNull(ch)) {
      let t = locType(ch);
      if (t == SyntaxType.TOKEN_PARAMETER || locMatches(ch, "parameter") ||
          t == SyntaxType.TOKEN_CONSTANT || locMatches(ch, "constant")) {
        return true;
      }
      ch = locNextSibling(ch);
    }
    return false;
  }

  instantiateExtendsClause(extLoc: u64, prefixPathId: u32, pool: ArenaStringPool, isTopLevelInterface: boolean = false, parentCausality: i32 = 0, isSectionProtected: boolean = false): u32 {
    let ext = CstNodeView.at(extLoc);
    let baseNameNode = locFindChild(extLoc, SyntaxType.TYPE_SPECIFIER);
    if (locIsNull(baseNameNode)) baseNameNode = locFindChild(extLoc, SyntaxType.NAME);
    if (locIsNull(baseNameNode)) baseNameNode = ext.findDescendantLoc(SyntaxType.TYPE_SPECIFIER);
    if (locIsNull(baseNameNode)) baseNameNode = ext.findDescendantLoc(SyntaxType.NAME);
    if (!locIsNull(baseNameNode)) {
      let baseNameId = locIntern(pool, baseNameNode);
      let baseClassLoc: u64 = this.findClassLoc(this.currentClassLoc, baseNameId, pool);
      if (!locIsNull(baseClassLoc)) {
        let extEnvPtr: u32 = 0;
        let extModCur = findClassModificationLoc(extLoc);
        if (!locIsNull(extModCur)) {
          extEnvPtr = flattener_envCreate(this.scopeStack.currentEnvPtr);
          populateEnvFromClassModLoc(extEnvPtr, extModCur, pool, this.exprVisitor, true);
        }

        this.scopeStack.push(0, extEnvPtr, prefixPathId, 0);
        let added = this.instantiateClassLoc(baseClassLoc, prefixPathId, isTopLevelInterface, parentCausality, isSectionProtected);
        this.scopeStack.pop();
        return added;
      }
    }
    return 0;
  }

  findClauseSubscripts(clauseLoc: u64, maxDepth: i32 = 6): u64 {
    if (locIsNull(clauseLoc) || maxDepth <= 0) return 0;
    let curr = locFirstChild(clauseLoc);
    while (!locIsNull(curr)) {
      let t = locType(curr);
      if (t == SyntaxType.COMPONENT_LIST) {
        return 0;
      }
      if (t == SyntaxType.ARRAY_SUBSCRIPTS) {
        return curr;
      }
      let found = this.findClauseSubscripts(curr, maxDepth - 1);
      if (!locIsNull(found)) return found;
      curr = locNextSibling(curr);
    }
    return 0;
  }

  findDeclarationSubscripts(declLoc: u64): u64 {
    if (locIsNull(declLoc)) return 0;
    let ch = locFirstChild(declLoc);
    while (!locIsNull(ch)) {
      let t = locType(ch);
      if (t == SyntaxType.MODIFICATION || t == SyntaxType.MODIFICATION_EXPRESSION || t == SyntaxType._MODIFICATION_) {
        return 0;
      }
      if (t == SyntaxType.ARRAY_SUBSCRIPTS && locLen(ch) > 0) {
        return ch;
      }
      if (t == SyntaxType._ARRAY_SUBSCRIPTS_ && locLen(ch) > 0) {
        let sub = locFindChild(ch, SyntaxType.ARRAY_SUBSCRIPTS);
        return !locIsNull(sub) ? sub : ch;
      }
      ch = locNextSibling(ch);
    }
    return 0;
  }

  findShortClassSpecifier(specLoc: u64, maxDepth: i32 = 4): u64 {
    if (locIsNull(specLoc) || maxDepth <= 0) return 0;
    let curr = locFirstChild(specLoc);
    while (!locIsNull(curr)) {
      let t = locType(curr);
      if (t == SyntaxType.SHORT_CLASS_SPECIFIER) {
        return curr;
      }
      if (t == SyntaxType.LONG_CLASS_SPECIFIER || t == SyntaxType.COMPOSITION) {
        return 0;
      }
      let found = this.findShortClassSpecifier(curr, maxDepth - 1);
      if (!locIsNull(found)) return found;
      curr = locNextSibling(curr);
    }
    return 0;
  }

  instantiateComponentClause(clauseLoc: u64, prefixPathId: u32, pool: ArenaStringPool, isTopLevelInterface: boolean = false, parentCausality: i32 = 0, isSectionProtected: boolean = false, isFinal: boolean = false, isInner: boolean = false, isOuter: boolean = false): u32 {
    let typePrefixLoc = locFindDescendant(clauseLoc, SyntaxType.TYPE_PREFIX);
    let typeSpecLoc = locFindDescendant(clauseLoc, SyntaxType.TYPE_SPECIFIER);
    let clauseSubscriptsLoc = this.findClauseSubscripts(clauseLoc);

    let varType: i32 = VarType.Real;
    let variability: i32 = Variability.Continuous;
    let causality: i32 = Causality.Local;
    let varFlags: i32 = 0;
    if (isSectionProtected) {
      varFlags |= FLAG_VAR_PROTECTED;
      isTopLevelInterface = false;
    }
    if (isFinal) {
      varFlags |= FLAG_VAR_FINAL;
    }

    if (!locIsNull(typePrefixLoc)) {
      let tpChild = locFirstChild(typePrefixLoc);
      while (!locIsNull(tpChild)) {
        let t = locType(tpChild);
        if (t == SyntaxType.TOKEN_PARAMETER || locMatches(tpChild, "parameter")) {
          variability = Variability.Parameter;
        } else if (t == SyntaxType.TOKEN_CONSTANT || locMatches(tpChild, "constant")) {
          variability = Variability.Constant;
        } else if (t == SyntaxType.TOKEN_DISCRETE || locMatches(tpChild, "discrete")) {
          variability = Variability.Discrete;
        } else if (t == SyntaxType.TOKEN_INPUT || locMatches(tpChild, "input")) {
          causality = Causality.Input;
        } else if (t == SyntaxType.TOKEN_OUTPUT || locMatches(tpChild, "output")) {
          causality = Causality.Output;
        } else if (t == SyntaxType.TOKEN_FLOW || locMatches(tpChild, "flow")) {
          varFlags |= FLAG_VAR_FLOW;
        } else if (t == SyntaxType.TOKEN_STREAM || locMatches(tpChild, "stream")) {
          varFlags |= FLAG_VAR_STREAM;
        }
        tpChild = locNextSibling(tpChild);
      }
    }

    let typeNameId: u32 = 0;
    let isPrimitive: boolean = false;
    let subtypeUnitId: u32 = 0xffffffff;
    let subtypeStartId: u32 = 0xffffffff;
    let subtypeFixedId: u32 = 0xffffffff;
    let subtypeMinId: u32 = 0xffffffff;
    let subtypeMaxId: u32 = 0xffffffff;
    let subtypeNominalId: u32 = 0xffffffff;
    let subtypeDisplayUnitId: u32 = 0xffffffff;
    let subtypeQuantityId: u32 = 0xffffffff;
    let aliasDim1: u32 = 0;
    let aliasDim2: u32 = 0;
    let aliasDim3: u32 = 0;

    if (!locIsNull(typeSpecLoc)) {
      let idLoc = locFindLastDescendant(typeSpecLoc, SyntaxType.IDENTIFIER);
      if (locIsNull(idLoc)) idLoc = locFindLastDescendant(typeSpecLoc, SyntaxType.TOKEN_IDENTIFIER_ALT);
      if (locIsNull(idLoc)) idLoc = locFindLastDescendant(typeSpecLoc, SyntaxType.NAME);
      if (locIsNull(idLoc)) idLoc = typeSpecLoc;
      typeNameId = locIntern(pool, idLoc);

      let hasDefinedClass = false;
      if (locMatches(idLoc, "TypeReal") || locMatches(idLoc, "TypeInteger") || locMatches(idLoc, "TypeBoolean") || locMatches(idLoc, "TypeString")) {
        hasDefinedClass = !locIsNull(this.findClassLoc(this.currentClassLoc, typeNameId, pool));
      }
      if (!hasDefinedClass && (locMatches(idLoc, "Real") || locMatches(idLoc, "TypeReal"))) {
        varType = VarType.Real;
        isPrimitive = true;
      } else if (!hasDefinedClass && (locMatches(idLoc, "Integer") || locMatches(idLoc, "TypeInteger"))) {
        varType = VarType.Integer;
        isPrimitive = true;
      } else if (!hasDefinedClass && (locMatches(idLoc, "Boolean") || locMatches(idLoc, "TypeBoolean"))) {
        varType = VarType.Boolean;
        isPrimitive = true;
      } else if (!hasDefinedClass && (locMatches(idLoc, "String") || locMatches(idLoc, "TypeString"))) {
        varType = VarType.String;
        isPrimitive = true;
      } else if (locMatches(idLoc, "enumeration") || locMatches(typeSpecLoc, "enumeration") || !locIsNull(locFindDescendant(typeSpecLoc, SyntaxType.ENUM_LIST))) {
        varType = VarType.Enumeration;
        isPrimitive = true;
      } else {
        // Resolve type alias / short class definition (e.g. type Angle = Real(unit="rad"), type Color = Modelica.Icons.TypeInteger[3])
        let fullTypeId = locIntern(pool, typeSpecLoc);
        let defLoc: u64 = this.findClassLoc(this.currentClassLoc, fullTypeId, pool);
        if (locIsNull(defLoc)) {
          defLoc = this.findClassLoc(this.currentClassLoc, typeNameId, pool);
        }
        let firstIdLoc = locFindDescendant(typeSpecLoc, SyntaxType.IDENTIFIER);
        if (locIsNull(defLoc) && !locIsNull(firstIdLoc)) {
          let firstId = locIntern(pool, firstIdLoc);
          if (firstId != typeNameId && firstId != fullTypeId) {
            defLoc = this.findClassLoc(this.currentClassLoc, firstId, pool);
          }
        }
        let curDefLoc: u64 = defLoc;
        let resolveDepth: i32 = 6;
        while (!locIsNull(curDefLoc) && !isPrimitive && resolveDepth > 0) {
          resolveDepth--;
          let classSpecLoc = locFindChild(curDefLoc, SyntaxType.CLASS_SPECIFIER);
          if (locIsNull(classSpecLoc)) classSpecLoc = curDefLoc;
          let shortSpec = this.findShortClassSpecifier(classSpecLoc);
          if (locIsNull(shortSpec)) {
            // Check if curDefLoc is a TYPE or CLASS definition with extends clause to a primitive
            let extClause = locFindDescendant(curDefLoc, SyntaxType.EXTENDS_CLAUSE);
            if (!locIsNull(extClause)) {
              let extNameLoc = locFindDescendant(extClause, SyntaxType.NAME);
              if (locIsNull(extNameLoc)) extNameLoc = locFindDescendant(extClause, SyntaxType.IDENTIFIER);
              if (!locIsNull(extNameLoc)) {
                let isPrimitiveExt = locMatches(extNameLoc, "Real") ||
                  locMatches(extNameLoc, "Integer") ||
                  locMatches(extNameLoc, "Boolean") ||
                  locMatches(extNameLoc, "String");
                if (isPrimitiveExt) {
                  isPrimitive = true;
                  if (locMatches(extNameLoc, "Real")) varType = VarType.Real;
                  else if (locMatches(extNameLoc, "Integer")) varType = VarType.Integer;
                  else if (locMatches(extNameLoc, "Boolean")) varType = VarType.Boolean;
                  else if (locMatches(extNameLoc, "String")) varType = VarType.String;
                }
                let extModLoc = locFindDescendant(extClause, SyntaxType.CLASS_MODIFICATION);
                if (locIsNull(extModLoc)) extModLoc = locFindDescendant(extClause, SyntaxType.CLASS_OR_INHERITANCE_MODIFICATION);
                if (!locIsNull(extModLoc)) {
                  let qid = extractModQuantity(extModLoc, this.exprVisitor);
                  if (qid != 0xffffffff && subtypeQuantityId == 0xffffffff) subtypeQuantityId = qid;
                  let uid = extractModUnit(extModLoc, this.exprVisitor);
                  if (uid != 0xffffffff && subtypeUnitId == 0xffffffff) subtypeUnitId = uid;
                  let sid = extractModStart(extModLoc, this.exprVisitor);
                  if (sid != 0xffffffff && subtypeStartId == 0xffffffff) subtypeStartId = sid;
                  let fid = extractModFixed(extModLoc, this.exprVisitor);
                  if (fid != 0xffffffff && subtypeFixedId == 0xffffffff) subtypeFixedId = fid;
                  let minId = extractModMin(extModLoc, this.exprVisitor);
                  if (minId != 0xffffffff && subtypeMinId == 0xffffffff) subtypeMinId = minId;
                  let maxId = extractModMax(extModLoc, this.exprVisitor);
                  if (maxId != 0xffffffff && subtypeMaxId == 0xffffffff) subtypeMaxId = maxId;
                  let nomId = extractModNominal(extModLoc, this.exprVisitor);
                  if (nomId != 0xffffffff && subtypeNominalId == 0xffffffff) subtypeNominalId = nomId;
                  let duId = extractModDisplayUnit(extModLoc, this.exprVisitor);
                  if (duId != 0xffffffff && subtypeDisplayUnitId == 0xffffffff) subtypeDisplayUnitId = duId;
                }
                if (!isPrimitiveExt && isTypeClassLoc(curDefLoc)) {
                  // Follow extends alias chain (e.g. type MyReal2 extends MyReal)
                  let nextExtId = locIntern(pool, extNameLoc);
                  curDefLoc = this.findClassLoc(this.currentClassLoc, nextExtId, pool);
                  continue;
                }
                if (isPrimitive) {
                  break;
                }
              }
            }
            if (!isPrimitive) {
              if (locMatches(idLoc, "TypeReal")) { varType = VarType.Real; isPrimitive = true; }
              else if (locMatches(idLoc, "TypeInteger")) { varType = VarType.Integer; isPrimitive = true; }
              else if (locMatches(idLoc, "TypeBoolean")) { varType = VarType.Boolean; isPrimitive = true; }
              else if (locMatches(idLoc, "TypeString")) { varType = VarType.String; isPrimitive = true; }
            }
            break;
          }
          let baseTypeSpec = locFindDescendant(shortSpec, SyntaxType.TYPE_SPECIFIER);
          if (!locIsNull(baseTypeSpec)) {
            let baseIdLoc = locFindLastDescendant(baseTypeSpec, SyntaxType.IDENTIFIER);
            if (locIsNull(baseIdLoc)) baseIdLoc = locFindLastDescendant(baseTypeSpec, SyntaxType.TOKEN_IDENTIFIER_ALT);
            if (locIsNull(baseIdLoc)) baseIdLoc = locFindLastDescendant(baseTypeSpec, SyntaxType.NAME);
            if (locIsNull(baseIdLoc)) baseIdLoc = baseTypeSpec;
            if (locMatches(baseIdLoc, "Real") ||
                locMatches(baseIdLoc, "TypeReal") ||
                locStartsWith(baseTypeSpec, "SI.") ||
                locStartsWith(baseTypeSpec, "Modelica.Units.SI.") ||
                locStartsWith(baseTypeSpec, "Modelica.SIunits.") ||
                locStartsWith(baseTypeSpec, "NonSI.") ||
                locStartsWith(baseTypeSpec, "Modelica.Units.NonSI.")) {
              varType = VarType.Real;
              isPrimitive = true;
            } else if (locMatches(baseIdLoc, "Integer") || locMatches(baseIdLoc, "TypeInteger")) {
              varType = VarType.Integer;
              isPrimitive = true;
            } else if (locMatches(baseIdLoc, "Boolean") || locMatches(baseIdLoc, "TypeBoolean")) {
              varType = VarType.Boolean;
              isPrimitive = true;
            } else if (locMatches(baseIdLoc, "String") || locMatches(baseIdLoc, "TypeString")) {
              varType = VarType.String;
              isPrimitive = true;
            } else {
              // Follow alias chain
              let nextTargetId = locIntern(pool, baseTypeSpec);
              let nextDefLoc = this.findClassLoc(curDefLoc, nextTargetId, pool);
              if (locIsNull(nextDefLoc)) {
                let baseId = locIntern(pool, baseIdLoc);
                nextDefLoc = this.findClassLoc(curDefLoc, baseId, pool);
              }
              curDefLoc = nextDefLoc;
            }

          } else if (locMatches(shortSpec, "enumeration") || !locIsNull(locFindDescendant(shortSpec, SyntaxType.ENUM_LIST))) {
            varType = VarType.Enumeration;
            isPrimitive = true;
            break;
          } else {
            break;
          }
          let shortSubLoc = locFindDescendant(shortSpec, SyntaxType.ARRAY_SUBSCRIPTS);
          if (!locIsNull(shortSubLoc)) {
            let shortDims = parseArrayDimensionsLoc(shortSubLoc, this.dae, pool, prefixPathId, this.scopeStackPtr);
            if (shortDims != 0xffffffffffffffff && shortDims != 0) {
              let sd1 = (shortDims >> 32) as u32;
              let sd2 = (shortDims & 0xffffffff) as u32;
              let sd3 = g_lastParsedDim3;
              if (sd1 > 0) {
                if (aliasDim1 == 0) {
                  aliasDim1 = sd1;
                  aliasDim2 = sd2;
                  aliasDim3 = sd3;
                } else if (aliasDim2 == 0) {
                  aliasDim2 = sd1;
                  if (sd2 > 0) aliasDim3 = sd2;
                } else if (aliasDim3 == 0) {
                  aliasDim3 = sd1;
                }
              }
            }
          }
          let classModLoc = locFindDescendant(shortSpec, SyntaxType.CLASS_MODIFICATION);
          if (!locIsNull(classModLoc)) {
            let qid = extractModQuantity(classModLoc, this.exprVisitor);
            if (qid != 0xffffffff && subtypeQuantityId == 0xffffffff) subtypeQuantityId = qid;
            let uid = extractModUnit(classModLoc, this.exprVisitor);
            if (uid != 0xffffffff && subtypeUnitId == 0xffffffff) subtypeUnitId = uid;
            let sid = extractModStart(classModLoc, this.exprVisitor);
            if (sid != 0xffffffff && subtypeStartId == 0xffffffff) subtypeStartId = sid;
            let fid = extractModFixed(classModLoc, this.exprVisitor);
            if (fid != 0xffffffff && subtypeFixedId == 0xffffffff) subtypeFixedId = fid;
            let minId = extractModMin(classModLoc, this.exprVisitor);
            if (minId != 0xffffffff && subtypeMinId == 0xffffffff) subtypeMinId = minId;
            let maxId = extractModMax(classModLoc, this.exprVisitor);
            if (maxId != 0xffffffff && subtypeMaxId == 0xffffffff) subtypeMaxId = maxId;
            let nomId = extractModNominal(classModLoc, this.exprVisitor);
            if (nomId != 0xffffffff && subtypeNominalId == 0xffffffff) subtypeNominalId = nomId;
            let duId = extractModDisplayUnit(classModLoc, this.exprVisitor);
            if (duId != 0xffffffff && subtypeDisplayUnitId == 0xffffffff) subtypeDisplayUnitId = duId;
          }
          let basePrefixLoc = locFindDescendant(shortSpec, SyntaxType.BASE_PREFIX);
          if (!locIsNull(basePrefixLoc)) {
            let bpChild = locFirstChild(basePrefixLoc);
            while (!locIsNull(bpChild)) {
              let t = locType(bpChild);
              if (t == SyntaxType.TOKEN_PARAMETER || locMatches(bpChild, "parameter")) {
                variability = Variability.Parameter;
              } else if (t == SyntaxType.TOKEN_CONSTANT || locMatches(bpChild, "constant")) {
                variability = Variability.Constant;
              } else if (t == SyntaxType.TOKEN_DISCRETE || locMatches(bpChild, "discrete")) {
                variability = Variability.Discrete;
              } else if (t == SyntaxType.TOKEN_INPUT || locMatches(bpChild, "input")) {
                if (causality == (Causality.Local as i32)) causality = Causality.Input;
              } else if (t == SyntaxType.TOKEN_OUTPUT || locMatches(bpChild, "output")) {
                if (causality == (Causality.Local as i32)) causality = Causality.Output;
              } else if (t == SyntaxType.TOKEN_FLOW || locMatches(bpChild, "flow")) {
                varFlags |= FLAG_VAR_FLOW;
              } else if (t == SyntaxType.TOKEN_STREAM || locMatches(bpChild, "stream")) {
                varFlags |= FLAG_VAR_STREAM;
              }
              bpChild = locNextSibling(bpChild);
            }
            if (locMatches(basePrefixLoc, "parameter")) {
              variability = Variability.Parameter;
            } else if (locMatches(basePrefixLoc, "constant")) {
              variability = Variability.Constant;
            } else if (locMatches(basePrefixLoc, "discrete")) {
              variability = Variability.Discrete;
            } else if (locMatches(basePrefixLoc, "input")) {
              if (causality == (Causality.Local as i32)) causality = Causality.Input;
            } else if (locMatches(basePrefixLoc, "output")) {
              if (causality == (Causality.Local as i32)) causality = Causality.Output;
            } else if (locMatches(basePrefixLoc, "flow")) {
              varFlags |= FLAG_VAR_FLOW;
            } else if (locMatches(basePrefixLoc, "stream")) {
              varFlags |= FLAG_VAR_STREAM;
            }
          }
        }
        if (!isPrimitive) {
          if (locStartsWith(typeSpecLoc, "SI.") ||
              locStartsWith(typeSpecLoc, "Modelica.Units.SI.") ||
              locStartsWith(typeSpecLoc, "Modelica.SIunits.") ||
              locStartsWith(typeSpecLoc, "NonSI.") ||
              locStartsWith(typeSpecLoc, "Modelica.Units.NonSI.")) {
            varType = VarType.Real;
            isPrimitive = true;
          }
        }
        let hasOwnMod = false;
        let defShortSpec = this.findShortClassSpecifier(defLoc);
        if (!locIsNull(defShortSpec)) {
          hasOwnMod = !locIsNull(locFindDescendant(defShortSpec, SyntaxType.CLASS_MODIFICATION)) ||
                      !locIsNull(locFindDescendant(defShortSpec, SyntaxType.CLASS_OR_INHERITANCE_MODIFICATION));
        } else {
          hasOwnMod = !locIsNull(locFindDescendant(defLoc, SyntaxType.CLASS_MODIFICATION)) ||
                      !locIsNull(locFindDescendant(defLoc, SyntaxType.CLASS_OR_INHERITANCE_MODIFICATION));
        }
        if (!isPrimitive && !locIsNull(curDefLoc) && curDefLoc != defLoc && !hasOwnMod) {
          let resolvedTargetId = getClassNameIdLoc(pool, curDefLoc);
          if (resolvedTargetId != 0) typeNameId = resolvedTargetId;
        }
      }
    }

    let clauseDims = parseArrayDimensionsLoc(clauseSubscriptsLoc, this.dae, pool, prefixPathId, this.scopeStackPtr);
    let clauseHasExplicitZero = g_hasExplicitZeroDim;
    let clauseNDims = g_lastParsedNDims;
    if (clauseDims == 0xffffffffffffffff) {
      this.setErrorAt(WasmBailReason.ClauseDimensions, clauseLoc);
      return 0;
    }
    let clauseDim1 = (clauseDims >> 32) as u32;
    let clauseDim2 = (clauseDims & 0xffffffff) as u32;
    let clauseDim3 = g_lastParsedDim3;
    let clauseDim4 = g_lastParsedDim4;

    if (clauseDim1 == 0 && aliasDim1 > 0) {
      clauseDim1 = aliasDim1;
      clauseDim2 = aliasDim2;
      clauseDim3 = aliasDim3;
    } else if (clauseDim1 > 0 && aliasDim1 > 0) {
      if (clauseDim2 == 0) {
        clauseDim2 = aliasDim1;
        if (aliasDim2 > 0) {
          clauseDim3 = aliasDim2;
          if (aliasDim3 > 0) clauseDim4 = aliasDim3;
        }
      } else if (clauseDim3 == 0) {
        clauseDim3 = aliasDim1;
        if (aliasDim2 > 0) clauseDim4 = aliasDim2;
      } else if (clauseDim4 == 0) {
        clauseDim4 = aliasDim1;
      }
    }

    let prevSubtypeStartId = this.curSubtypeStartId;
    let prevSubtypeFixedId = this.curSubtypeFixedId;
    let prevSubtypeMinId = this.curSubtypeMinId;
    let prevSubtypeMaxId = this.curSubtypeMaxId;
    let prevSubtypeNominalId = this.curSubtypeNominalId;
    let prevSubtypeDisplayUnitId = this.curSubtypeDisplayUnitId;
    let prevSubtypeQuantityId = this.curSubtypeQuantityId;

    this.curSubtypeStartId = subtypeStartId;
    this.curSubtypeFixedId = subtypeFixedId;
    this.curSubtypeMinId = subtypeMinId;
    this.curSubtypeMaxId = subtypeMaxId;
    this.curSubtypeNominalId = subtypeNominalId;
    this.curSubtypeDisplayUnitId = subtypeDisplayUnitId;
    this.curSubtypeQuantityId = subtypeQuantityId;

    let res = this.instantiateDeclarationsUnder(clauseLoc, isPrimitive, varType, variability, causality, varFlags, typeNameId, clauseDim1, clauseDim2, clauseDim3, prefixPathId, pool, isTopLevelInterface, parentCausality, subtypeUnitId, clauseHasExplicitZero, isInner, isOuter, clauseNDims, clauseDim4);

    this.curSubtypeStartId = prevSubtypeStartId;
    this.curSubtypeFixedId = prevSubtypeFixedId;
    this.curSubtypeMinId = prevSubtypeMinId;
    this.curSubtypeMaxId = prevSubtypeMaxId;
    this.curSubtypeNominalId = prevSubtypeNominalId;
    this.curSubtypeDisplayUnitId = prevSubtypeDisplayUnitId;
    this.curSubtypeQuantityId = prevSubtypeQuantityId;

    return res;
  }

  instantiateDeclarationsUnder(parentLoc: u64, isPrimitive: boolean, varType: i32, variability: i32, causality: i32, varFlags: i32, typeNameId: u32, clauseDim1: u32, clauseDim2: u32, clauseDim3: u32, prefixPathId: u32, pool: ArenaStringPool, isTopLevelInterface: boolean = false, parentCausality: i32 = 0, subtypeUnitId: u32 = 0xffffffff, clauseHasExplicitZero: boolean = false, isInner: boolean = false, isOuter: boolean = false, clauseNDims: u32 = 0, clauseDim4: u32 = 0): u32 {
    let ch = locFirstChild(parentLoc);
    let count: u32 = 0;
    while (!locIsNull(ch)) {
      if (this.hasError) return 0;
      let t = locType(ch);
      if (t == SyntaxType.COMPONENT_DECLARATION) {
        let condLoc = locFindChild(ch, SyntaxType.CONDITION_ATTRIBUTE);
        if (locIsNull(condLoc)) condLoc = locFindDescendant(ch, SyntaxType.CONDITION_ATTRIBUTE);
        let declLoc = locFindChild(ch, SyntaxType.DECLARATION);
        if (locIsNull(declLoc)) declLoc = locFindDescendant(ch, SyntaxType.DECLARATION);

        if (!locIsNull(condLoc)) {
          let condVal = this.evalConditionLoc(condLoc);
          if (condVal == 0) {
            if (!locIsNull(declLoc)) {
              let idLoc = locFirstNonEmptyChild(declLoc);
              if (!locIsNull(idLoc)) {
                let innerId = locFindDescendant(idLoc, SyntaxType.IDENTIFIER);
                if (!locIsNull(innerId)) idLoc = innerId;
                let compNameId = locIntern(pool, idLoc);
                let fullVarNameId = prefixPathId != 0 ? pool.concatIds(prefixPathId, compNameId) : compNameId;
                this.markComponentDisabled(fullVarNameId);
                if (prefixPathId != 0) this.markComponentDisabled(compNameId);
              }
            }
            ch = locNextSibling(ch);
            continue;
          }
        }

        let declDescId: u32 = 0xffffffff;
        let descLoc = locFindChild(ch, SyntaxType.DESCRIPTION);
        if (locIsNull(descLoc)) descLoc = locFindDescendant(ch, SyntaxType.DESCRIPTION);
        if (!locIsNull(descLoc)) {
          let strLoc = locFindDescendant(descLoc, SyntaxType.STRING_LITERAL);
          if (!locIsNull(strLoc)) {
            declDescId = this.exprVisitor.visitLoc(strLoc);
          }
        }

        if (!locIsNull(declLoc)) {
          count += this.instantiateDeclaration(declLoc, isPrimitive, varType, variability, causality, varFlags, typeNameId, clauseDim1, clauseDim2, clauseDim3, prefixPathId, pool, isTopLevelInterface, parentCausality, subtypeUnitId, clauseHasExplicitZero, isInner, isOuter, declDescId, clauseNDims, clauseDim4);
          if (this.hasError) return 0;
        }
      } else if (t == SyntaxType.DECLARATION) {
        count += this.instantiateDeclaration(ch, isPrimitive, varType, variability, causality, varFlags, typeNameId, clauseDim1, clauseDim2, clauseDim3, prefixPathId, pool, isTopLevelInterface, parentCausality, subtypeUnitId, clauseHasExplicitZero, isInner, isOuter, 0xffffffff, clauseNDims, clauseDim4);
        if (this.hasError) return 0;
      } else if (t != SyntaxType.TYPE_SPECIFIER && t != SyntaxType.TYPE_PREFIX && t != SyntaxType.CONDITION_ATTRIBUTE && t != SyntaxType.DESCRIPTION) {
        count += this.instantiateDeclarationsUnder(ch, isPrimitive, varType, variability, causality, varFlags, typeNameId, clauseDim1, clauseDim2, clauseDim3, prefixPathId, pool, isTopLevelInterface, parentCausality, subtypeUnitId, clauseHasExplicitZero, isInner, isOuter, clauseNDims, clauseDim4);
        if (this.hasError) return 0;
      }
      ch = locNextSibling(ch);
    }
    return count;
  }

  instantiateDeclaration(declLoc: u64, isPrimitive: boolean, varType: i32, variability: i32, causality: i32, varFlags: i32, typeNameId: u32, clauseDim1: u32, clauseDim2: u32, clauseDim3: u32, prefixPathId: u32, pool: ArenaStringPool, isTopLevelInterface: boolean = false, parentCausality: i32 = 0, subtypeUnitId: u32 = 0xffffffff, clauseHasExplicitZero: boolean = false, isInner: boolean = false, isOuter: boolean = false, declDescId: u32 = 0xffffffff, clauseNDims: u32 = 0, clauseDim4: u32 = 0): u32 {
    let idLoc = locFirstNonEmptyChild(declLoc);
    if (locIsNull(idLoc)) return 0;
    let innerId = locFindDescendant(idLoc, SyntaxType.IDENTIFIER);
    if (!locIsNull(innerId)) idLoc = innerId;

    let compNameId = locIntern(pool, idLoc);
    let fullVarNameId = prefixPathId != 0 ? pool.concatIds(prefixPathId, compNameId) : compNameId;

    // Resolve component-level or type-level redeclare from enclosing modification environments
    if (!isPrimitive && this.scopeStackPtr != 0) {
      let ss = changetype<ScopeStack>(this.scopeStackPtr);
      let redeclCompTypeId = ss.lookupRedeclare(compNameId);
      if (redeclCompTypeId == 0 && prefixPathId != 0) {
        redeclCompTypeId = ss.lookupRedeclarePath(pool, fullVarNameId);
      }
      if (redeclCompTypeId != 0) {
        typeNameId = redeclCompTypeId;
      } else if (typeNameId != 0) {
        let redeclClassId = ss.lookupRedeclare(typeNameId);
        if (redeclClassId == 0) redeclClassId = ss.lookupRedeclarePath(pool, typeNameId);
        if (redeclClassId != 0) {
          typeNameId = redeclClassId;
        }
      }
    }

    if (declDescId == 0xffffffff) {
      let descLoc = locFindChild(declLoc, SyntaxType.DESCRIPTION);
      if (locIsNull(descLoc)) descLoc = locFindDescendant(declLoc, SyntaxType.DESCRIPTION);
      if (!locIsNull(descLoc)) {
        let strLoc = locFindDescendant(descLoc, SyntaxType.STRING_LITERAL);
        if (!locIsNull(strLoc)) {
          declDescId = this.exprVisitor.visitLoc(strLoc);
        }
      }
    }

    let isSimultaneousInnerOuter = isInner && isOuter;
    if (isInner && !isOuter) {
      this.registerInnerDeclaration(prefixPathId, compNameId, fullVarNameId);
    }

    if (isOuter) {
      let targetInner = this.findMatchingInner(pool, prefixPathId, compNameId);
      if (targetInner != 0xffffffff) {
        this.registerOuterMapping(fullVarNameId, targetInner);
        if (!isInner) {
          return 0;
        }
      } else if (!isInner) {
        return 0;
      }
    }

    let declSubscripts = this.findDeclarationSubscripts(declLoc);
    let declDims = parseArrayDimensionsLoc(declSubscripts, this.dae, pool, prefixPathId, this.scopeStackPtr);
    let declHasExplicitZero = g_hasExplicitZeroDim;
    let declNDims = g_lastParsedNDims;
    if (declDims == 0xffffffffffffffff) {
      this.setErrorAt(WasmBailReason.DeclarationDimensions, declLoc);
      return 0;
    }
    let dim1 = (declDims >> 32) as u32;
    let dim2 = (declDims & 0xffffffff) as u32;
    let dim3 = g_lastParsedDim3;
    let dim4 = g_lastParsedDim4;
    if (dim1 == 0 && clauseDim1 > 0) {
      dim1 = clauseDim1;
      dim2 = clauseDim2;
      dim3 = clauseDim3;
      dim4 = clauseDim4;
    } else if (dim1 > 0 && clauseDim1 > 0) {
      if (dim2 == 0) {
        dim2 = clauseDim1;
        if (clauseDim2 > 0) {
          dim3 = clauseDim2;
          if (clauseDim3 > 0) dim4 = clauseDim3;
        }
      } else if (dim3 == 0) {
        dim3 = clauseDim1;
        if (clauseDim2 > 0) dim4 = clauseDim2;
      } else if (dim4 == 0) {
        dim4 = clauseDim1;
      }
    }

    if (dim1 > 0) {
      this.registerArrayShape(fullVarNameId, dim1, dim2, dim3, 0, dim4);
      if (prefixPathId != 0) {
        this.registerArrayShape(compNameId, dim1, dim2, dim3, 0, dim4);
      }
    }

    let modLoc = locFindDescendant(declLoc, SyntaxType.MODIFICATION);
    let valExprId: u32 = 0xffffffff;
    let bExprLoc = findBindingExpressionLoc(modLoc);
    if (!locIsNull(bExprLoc)) {
      valExprId = this.exprVisitor.visitLoc(bExprLoc);
      if (valExprId == 0xffffffff) {
        this.setErrorAt(WasmBailReason.BindingExpr, bExprLoc);
        return 0;
      }
      if (varType == VarType.Integer && this.exprVisitor.isRealExpr(valExprId)) {
        this.setErrorAt(WasmBailReason.IntegerRealBinding, bExprLoc);
        return 0;
      }
      if (varType == VarType.Real && !this.exprVisitor.isRealExpr(valExprId)) {
        valExprId = this.exprVisitor.castToReal(valExprId);
      }
    }

    if (isSimultaneousInnerOuter) {
      this.removeOuterMapping(fullVarNameId);
      this.registerInnerDeclaration(prefixPathId, compNameId, fullVarNameId);
    }

    let declModLoc = findClassModificationLoc(modLoc);
    let declStartId: u32 = 0xffffffff;
    let declFixedId: u32 = 0xffffffff;
    let declMinId: u32 = 0xffffffff;
    let declMaxId: u32 = 0xffffffff;
    let declNominalId: u32 = 0xffffffff;
    let declDisplayUnitId: u32 = 0xffffffff;
    let declQuantityId: u32 = 0xffffffff;
    if (!locIsNull(declModLoc)) {
      let declUnitId = extractModUnit(declModLoc, this.exprVisitor);
      if (declUnitId != 0xffffffff) {
        subtypeUnitId = declUnitId;
      }
      let dq = extractModQuantity(declModLoc, this.exprVisitor);
      if (dq != 0xffffffff) {
        declQuantityId = dq;
      }
      declStartId = extractModStart(declModLoc, this.exprVisitor);
      declFixedId = extractModFixed(declModLoc, this.exprVisitor);
      declMinId = extractModMin(declModLoc, this.exprVisitor);
      declMaxId = extractModMax(declModLoc, this.exprVisitor);
      declNominalId = extractModNominal(declModLoc, this.exprVisitor);
      declDisplayUnitId = extractModDisplayUnit(declModLoc, this.exprVisitor);
    }

    if (declQuantityId == 0xffffffff) declQuantityId = this.curSubtypeQuantityId;
    if (declStartId == 0xffffffff) declStartId = this.curSubtypeStartId;
    if (declFixedId == 0xffffffff) declFixedId = this.curSubtypeFixedId;
    if (declMinId == 0xffffffff) declMinId = this.curSubtypeMinId;
    if (declMaxId == 0xffffffff) declMaxId = this.curSubtypeMaxId;
    if (declNominalId == 0xffffffff) declNominalId = this.curSubtypeNominalId;
    if (declDisplayUnitId == 0xffffffff) declDisplayUnitId = this.curSubtypeDisplayUnitId;

    let hasEnvEachMod = false;
    if (this.scopeStackPtr != 0) {
      let modFlags = changetype<ScopeStack>(this.scopeStackPtr).lookupFlags(compNameId);
      if ((modFlags & FLAG_MOD_FINAL) != 0) {
        varFlags |= FLAG_VAR_FINAL;
      }
      if ((modFlags & FLAG_MOD_EACH) != 0) {
        hasEnvEachMod = true;
      }

      let childEnv = changetype<ScopeStack>(this.scopeStackPtr).lookupNested(compNameId);
      if (childEnv != 0) {
        let childEnvObj = changetype<ModificationEnvironment>(childEnv);
        let quantKey = internStaticString(pool, "quantity");
        let overrideQuant = childEnvObj.lookup(quantKey);
        if (overrideQuant != 0xffffffff) declQuantityId = overrideQuant;
        let unitKey = internStaticString(pool, "unit");
        let overrideUnit = childEnvObj.lookup(unitKey);
        if (overrideUnit != 0xffffffff) subtypeUnitId = overrideUnit;
        let startKey = internStaticString(pool, "start");
        let overrideStart = childEnvObj.lookup(startKey);
        if (overrideStart != 0xffffffff) declStartId = overrideStart;
        let fixedKey = internStaticString(pool, "fixed");
        let overrideFixed = childEnvObj.lookup(fixedKey);
        if (overrideFixed != 0xffffffff) declFixedId = overrideFixed;
        let minKey = internStaticString(pool, "min");
        let overrideMin = childEnvObj.lookup(minKey);
        if (overrideMin != 0xffffffff) declMinId = overrideMin;
        let maxKey = internStaticString(pool, "max");
        let overrideMax = childEnvObj.lookup(maxKey);
        if (overrideMax != 0xffffffff) declMaxId = overrideMax;
        let nomKey = internStaticString(pool, "nominal");
        let overrideNom = childEnvObj.lookup(nomKey);
        if (overrideNom != 0xffffffff) declNominalId = overrideNom;
        let duKey = internStaticString(pool, "displayUnit");
        let overrideDu = childEnvObj.lookup(duKey);
        if (overrideDu != 0xffffffff) declDisplayUnitId = overrideDu;
      }

      let modOverride = changetype<ScopeStack>(this.scopeStackPtr).lookup(compNameId);
      if (modOverride == 0xffffffff && prefixPathId != 0) {
        modOverride = changetype<ScopeStack>(this.scopeStackPtr).lookupPath(pool, fullVarNameId);
      }
      if (modOverride != 0xffffffff) {
        valExprId = modOverride;
        if (varType == VarType.Integer && this.exprVisitor.isRealExpr(valExprId)) {
          this.setErrorAt(WasmBailReason.IntegerRealModifier, declLoc);
          return 0;
        }
        if (varType == VarType.Real && !this.exprVisitor.isRealExpr(valExprId)) {
          valExprId = this.exprVisitor.castToReal(valExprId);
        }
      }
    }

    if (varType == VarType.Real) {
      if (declStartId != 0xffffffff && !this.exprVisitor.isRealExpr(declStartId)) {
        declStartId = this.exprVisitor.castToReal(declStartId);
      }
      if (declMinId != 0xffffffff && !this.exprVisitor.isRealExpr(declMinId)) {
        declMinId = this.exprVisitor.castToReal(declMinId);
      }
      if (declMaxId != 0xffffffff && !this.exprVisitor.isRealExpr(declMaxId)) {
        declMaxId = this.exprVisitor.castToReal(declMaxId);
      }
      if (declNominalId != 0xffffffff && !this.exprVisitor.isRealExpr(declNominalId)) {
        declNominalId = this.exprVisitor.castToReal(declNominalId);
      }
    }

    let hasSubscripts = declNDims > 0 || clauseNDims > 0 || !locIsNull(declSubscripts) || clauseDim1 > 0 || declHasExplicitZero || clauseHasExplicitZero;
    let isExplicitZero = declHasExplicitZero || clauseHasExplicitZero;
    let isArrayCtor = valExprId != 0xffffffff && this.dae.getExprKind(valExprId) == ExprKind.ArrayCtor;
    let ctorCount: u32 = isArrayCtor ? getArrayCtorCount(this.dae, valExprId) : 0;

    if (hasSubscripts) {
      if ((dim1 == 0 || dim2 == 0) && valExprId != 0xffffffff) {
        let inferred = getExprDimensions(this.dae, valExprId, pool);
        let infD1 = (inferred >> 32) as u32;
        let infD2 = (inferred & 0xffffffff) as u32;
        if (dim1 == 0 && (infD1 > 0 || isArrayCtor)) dim1 = infD1;
        if (dim2 == 0 && (infD2 > 0 || (isArrayCtor && ctorCount > 0))) dim2 = infD2;
      }
      let nDims: u32 = 0;
      if (dim4 > 0) {
        nDims = 4;
      } else if (dim3 > 0) {
        nDims = 3;
      } else if (dim2 > 0 || clauseDim2 > 0) {
        nDims = 2;
      } else if (declNDims > 0) {
        nDims = declNDims;
      } else if (clauseNDims > 0) {
        nDims = clauseNDims;
      } else if (!locIsNull(declSubscripts)) {
        let commaLoc = locFindMatchingDescendant(declSubscripts, ",");
        nDims = !locIsNull(commaLoc) ? 2 : 1;
      } else {
        nDims = 1;
      }
      this.registerArrayShape(fullVarNameId, dim1, dim2, dim3, nDims, dim4);
      if (prefixPathId != 0) {
        this.registerArrayShape(compNameId, dim1, dim2, dim3, nDims, dim4);
      }

      let totalElements: u32 = dim1;
      if (nDims == 2) totalElements = dim1 * dim2;
      else if (nDims == 3) totalElements = dim1 * dim2 * dim3;
      else if (nDims == 4) totalElements = dim1 * dim2 * dim3 * dim4;

      if (isExplicitZero || totalElements == 0) {
        return 0;
      }
      if (dim1 == 0) {
        dim1 = 1;
      }
    } else if (dim1 > 0) {
      this.registerArrayShape(fullVarNameId, dim1, dim2, dim3, 0, dim4);
      if (prefixPathId != 0) {
        this.registerArrayShape(compNameId, dim1, dim2, dim3, 0, dim4);
      }
    }

    // Scalar variable with ArrayCtor binding is invalid
    if (!hasSubscripts && isArrayCtor) {
      this.setErrorAt(WasmBailReason.ArrayBindingShape, declLoc);
      return 0;
    }

    // Array variable with mismatched ArrayCtor length
    if (hasSubscripts && dim1 > 0 && isArrayCtor && ctorCount != dim1) {
      this.setErrorAt(WasmBailReason.ArrayBindingShape, declLoc);
      return 0;
    }

    // Array variable with incompatible element types
    if (isArrayCtor && ctorCount > 0) {
      let firstElemId = getArrayCtorElement(this.dae, valExprId, 0);
      if (firstElemId != 0xffffffff) {
        let firstKind = this.dae.getExprKind(firstElemId);
        if (varType == VarType.Real || varType == VarType.Integer || varType == VarType.Enumeration) {
          if (firstKind == ExprKind.StringLiteral) {
            this.setErrorAt(WasmBailReason.ArrayBindingShape, declLoc);
            return 0;
          }
        }
      }
    }

    // Array variable with scalar literal modification without each
    if (hasSubscripts && dim1 > 0 && valExprId != 0xffffffff && !isArrayCtor) {
      let ek = this.dae.getExprKind(valExprId);
      let isScalarLiteral = ek == ExprKind.RealLiteral || ek == ExprKind.IntLiteral || ek == ExprKind.BoolLiteral || ek == ExprKind.StringLiteral;
      if (isScalarLiteral && !modHasEach(modLoc) && !hasEnvEachMod) {
        this.setErrorAt(WasmBailReason.ArrayBindingShape, declLoc);
        return 0;
      }
    }

    let startVal: f64 = 0.0;
    if (declStartId != 0xffffffff) {
      let expr = ExprAccessor.at(this.dae.getExprData(), declStartId);
      if (expr.kind == ExprKind.RealLiteral) {
        startVal = expr.realValue;
      } else if (expr.kind == ExprKind.IntLiteral) {
        startVal = expr.intValue as f64;
      } else if (expr.kind == ExprKind.BoolLiteral) {
        startVal = expr.intValue != 0 ? 1.0 : 0.0;
      }
    } else if (valExprId != 0xffffffff) {
      let expr = ExprAccessor.at(this.dae.getExprData(), valExprId);
      if (expr.kind == ExprKind.RealLiteral) {
        startVal = expr.realValue;
      } else if (expr.kind == ExprKind.IntLiteral) {
        startVal = expr.intValue as f64;
      } else if (expr.kind == ExprKind.BoolLiteral) {
        startVal = expr.intValue != 0 ? 1.0 : 0.0;
      }
    }

    let count: u32 = 0;
    if (causality == (Causality.Local as i32) && parentCausality != (Causality.Local as i32)) {
      causality = parentCausality;
    }
    let isParamOrConst = variability == (Variability.Parameter as i32) || variability == (Variability.Constant as i32);
    let isEachArrayMod = modHasEach(modLoc) || hasEnvEachMod;
    let setElemBinding = isParamOrConst || isEachArrayMod;
    let effectiveCausality = causality;
    if (prefixPathId != 0 && !isTopLevelInterface) {
      effectiveCausality = Causality.Local;
    } else if (effectiveCausality == (Causality.Input as i32) && valExprId != 0xffffffff && !isParamOrConst) {
      effectiveCausality = Causality.Local;
    }

    if (isPrimitive) {
      if (dim1 > 0 && dim2 == 0 && dim3 == 0 && dim4 == 0) {
        let isArrayCtor = valExprId != 0xffffffff && this.dae.getExprKind(valExprId) == ExprKind.ArrayCtor;
        let ctorCount = isArrayCtor ? getArrayCtorCount(this.dae, valExprId) : 0;
        for (let i: u32 = 1; i <= dim1; i++) {
          let elemNameId = concatArrayIndex1D(pool, fullVarNameId, i);
          let elemExprId = isArrayCtor && (i - 1) < ctorCount
            ? getArrayCtorElement(this.dae, valExprId, i - 1)
            : valExprId;
          let elemStartId = sliceAttrExpr1D(this.dae, declStartId, i - 1);
          let elemFixedId = sliceAttrExpr1D(this.dae, declFixedId, i - 1);
          let elemMinId = sliceAttrExpr1D(this.dae, declMinId, i - 1);
          let elemMaxId = sliceAttrExpr1D(this.dae, declMaxId, i - 1);
          let elemNominalId = sliceAttrExpr1D(this.dae, declNominalId, i - 1);
          let elemDisplayUnitId = sliceAttrExpr1D(this.dae, declDisplayUnitId, i - 1);
          let elemQuantityId = sliceAttrExpr1D(this.dae, declQuantityId, i - 1);

          let isParamOrConst = variability == (Variability.Parameter as i32) || variability == (Variability.Constant as i32);
          let elemStartVal: f64 = 0.0;
          if (elemStartId != 0xffffffff) {
            let ek = this.dae.getExprKind(elemStartId);
            if (ek == (ExprKind.RealLiteral as i32)) {
              elemStartVal = this.dae.getExprRealValue(elemStartId);
            } else if (ek == (ExprKind.IntLiteral as i32)) {
              elemStartVal = this.dae.getExprData().get(elemStartId * EXPR_STRIDE + EXPR_DATA1) as f64;
            }
          } else if (elemExprId != 0xffffffff && isParamOrConst) {
            let ek = this.dae.getExprKind(elemExprId);
            if (ek == (ExprKind.RealLiteral as i32)) {
              elemStartVal = this.dae.getExprRealValue(elemExprId);
            } else if (ek == (ExprKind.IntLiteral as i32)) {
              elemStartVal = this.dae.getExprData().get(elemExprId * EXPR_STRIDE + EXPR_DATA1) as f64;
            }
          }
          let elemVarIdx = this.dae.addVariable(elemNameId, varType, variability, effectiveCausality, elemStartVal, varFlags);
          if (elemExprId != 0xffffffff && setElemBinding) {
            this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Binding as u32, elemExprId);
          }
          if (elemStartId != 0xffffffff) {
            this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Start as u32, elemStartId);
          } else if (elemExprId != 0xffffffff && isParamOrConst) {
            this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Start as u32, elemExprId);
          }
          if (elemFixedId != 0xffffffff) {
            this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Fixed as u32, elemFixedId);
          }
          if (elemMinId != 0xffffffff) {
            this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Min as u32, elemMinId);
          }
          if (elemMaxId != 0xffffffff) {
            this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Max as u32, elemMaxId);
          }
          if (elemNominalId != 0xffffffff) {
            this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Nominal as u32, elemNominalId);
          }
          if (elemDisplayUnitId != 0xffffffff) {
            this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.DisplayUnit as u32, elemDisplayUnitId);
          }
          if (subtypeUnitId != 0xffffffff) {
            this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Unit as u32, subtypeUnitId);
          }
          if (elemQuantityId != 0xffffffff) {
            this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Quantity as u32, elemQuantityId);
          }
          if (declDescId != 0xffffffff) {
            this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Description as u32, declDescId);
          }
          count++;
        }
      } else if (dim1 > 0 && dim2 > 0 && dim3 == 0 && dim4 == 0) {
        let isArrayCtor = valExprId != 0xffffffff && this.dae.getExprKind(valExprId) == ExprKind.ArrayCtor;
        let rowCount = isArrayCtor ? getArrayCtorCount(this.dae, valExprId) : 0;
        for (let i: u32 = 1; i <= dim1; i++) {
          let rowExprId = isArrayCtor && (i - 1) < rowCount
            ? getArrayCtorElement(this.dae, valExprId, i - 1)
            : valExprId;
          let isRowCtor = rowExprId != 0xffffffff && this.dae.getExprKind(rowExprId) == ExprKind.ArrayCtor;
          let colCount = isRowCtor ? getArrayCtorCount(this.dae, rowExprId) : 0;
          for (let j: u32 = 1; j <= dim2; j++) {
            let elemNameId = concatArrayIndex2D(pool, fullVarNameId, i, j);
            let elemExprId = isRowCtor && (j - 1) < colCount
              ? getArrayCtorElement(this.dae, rowExprId, j - 1)
              : rowExprId;
            let elemStartId = sliceAttrExpr2D(this.dae, declStartId, i - 1, j - 1);
            let elemFixedId = sliceAttrExpr2D(this.dae, declFixedId, i - 1, j - 1);
            let elemMinId = sliceAttrExpr2D(this.dae, declMinId, i - 1, j - 1);
            let elemMaxId = sliceAttrExpr2D(this.dae, declMaxId, i - 1, j - 1);
            let elemNominalId = sliceAttrExpr2D(this.dae, declNominalId, i - 1, j - 1);
            let elemDisplayUnitId = sliceAttrExpr2D(this.dae, declDisplayUnitId, i - 1, j - 1);
            let elemQuantityId = sliceAttrExpr2D(this.dae, declQuantityId, i - 1, j - 1);

            let isParamOrConst = variability == (Variability.Parameter as i32) || variability == (Variability.Constant as i32);
            let elemStartVal: f64 = 0.0;
            if (elemStartId != 0xffffffff) {
              let ek = this.dae.getExprKind(elemStartId);
              if (ek == (ExprKind.RealLiteral as i32)) {
                elemStartVal = this.dae.getExprRealValue(elemStartId);
              } else if (ek == (ExprKind.IntLiteral as i32)) {
                elemStartVal = this.dae.getExprData().get(elemStartId * EXPR_STRIDE + EXPR_DATA1) as f64;
              }
            } else if (elemExprId != 0xffffffff && isParamOrConst) {
              let ek = this.dae.getExprKind(elemExprId);
              if (ek == (ExprKind.RealLiteral as i32)) {
                elemStartVal = this.dae.getExprRealValue(elemExprId);
              } else if (ek == (ExprKind.IntLiteral as i32)) {
                elemStartVal = this.dae.getExprData().get(elemExprId * EXPR_STRIDE + EXPR_DATA1) as f64;
              }
            }
            let elemVarIdx = this.dae.addVariable(elemNameId, varType, variability, effectiveCausality, elemStartVal, varFlags);
            if (elemExprId != 0xffffffff && setElemBinding) {
              this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Binding as u32, elemExprId);
            }
            if (elemStartId != 0xffffffff) {
              this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Start as u32, elemStartId);
            } else if (elemExprId != 0xffffffff && isParamOrConst) {
              this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Start as u32, elemExprId);
            }
            if (elemFixedId != 0xffffffff) {
              this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Fixed as u32, elemFixedId);
            }
            if (elemMinId != 0xffffffff) {
              this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Min as u32, elemMinId);
            }
            if (elemMaxId != 0xffffffff) {
              this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Max as u32, elemMaxId);
            }
            if (elemNominalId != 0xffffffff) {
              this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Nominal as u32, elemNominalId);
            }
            if (elemDisplayUnitId != 0xffffffff) {
              this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.DisplayUnit as u32, elemDisplayUnitId);
            }
            if (subtypeUnitId != 0xffffffff) {
              this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Unit as u32, subtypeUnitId);
            }
            if (elemQuantityId != 0xffffffff) {
              this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Quantity as u32, elemQuantityId);
            }
            if (declDescId != 0xffffffff) {
              this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Description as u32, declDescId);
            }
            count++;
          }
        }
      } else if (dim1 > 0 && dim2 > 0 && dim3 > 0 && dim4 == 0) {
        let isArrayCtor = valExprId != 0xffffffff && this.dae.getExprKind(valExprId) == ExprKind.ArrayCtor;
        let d1Count = isArrayCtor ? getArrayCtorCount(this.dae, valExprId) : 0;
        for (let i: u32 = 1; i <= dim1; i++) {
          let m2ExprId = isArrayCtor && (i - 1) < d1Count
            ? getArrayCtorElement(this.dae, valExprId, i - 1)
            : valExprId;
          let isM2Ctor = m2ExprId != 0xffffffff && this.dae.getExprKind(m2ExprId) == ExprKind.ArrayCtor;
          let d2Count = isM2Ctor ? getArrayCtorCount(this.dae, m2ExprId) : 0;
          for (let j: u32 = 1; j <= dim2; j++) {
            let rowExprId = isM2Ctor && (j - 1) < d2Count
              ? getArrayCtorElement(this.dae, m2ExprId, j - 1)
              : m2ExprId;
            let isRowCtor = rowExprId != 0xffffffff && this.dae.getExprKind(rowExprId) == ExprKind.ArrayCtor;
            let d3Count = isRowCtor ? getArrayCtorCount(this.dae, rowExprId) : 0;
            for (let k: u32 = 1; k <= dim3; k++) {
              let elemNameId = concatArrayIndex3D(pool, fullVarNameId, i, j, k);
              let elemExprId = isRowCtor && (k - 1) < d3Count
                ? getArrayCtorElement(this.dae, rowExprId, k - 1)
                : rowExprId;
              let elemStartId = sliceAttrExpr3D(this.dae, declStartId, i - 1, j - 1, k - 1);
              let elemFixedId = sliceAttrExpr3D(this.dae, declFixedId, i - 1, j - 1, k - 1);
              let elemMinId = sliceAttrExpr3D(this.dae, declMinId, i - 1, j - 1, k - 1);
              let elemMaxId = sliceAttrExpr3D(this.dae, declMaxId, i - 1, j - 1, k - 1);
              let elemNominalId = sliceAttrExpr3D(this.dae, declNominalId, i - 1, j - 1, k - 1);
              let elemDisplayUnitId = sliceAttrExpr3D(this.dae, declDisplayUnitId, i - 1, j - 1, k - 1);
              let elemQuantityId = sliceAttrExpr3D(this.dae, declQuantityId, i - 1, j - 1, k - 1);

              let isParamOrConst = variability == (Variability.Parameter as i32) || variability == (Variability.Constant as i32);
              let elemStartVal: f64 = 0.0;
              if (elemStartId != 0xffffffff) {
                let ek = this.dae.getExprKind(elemStartId);
                if (ek == (ExprKind.RealLiteral as i32)) {
                  elemStartVal = this.dae.getExprRealValue(elemStartId);
                } else if (ek == (ExprKind.IntLiteral as i32)) {
                  elemStartVal = this.dae.getExprData().get(elemStartId * EXPR_STRIDE + EXPR_DATA1) as f64;
                }
              } else if (elemExprId != 0xffffffff && isParamOrConst) {
                let ek = this.dae.getExprKind(elemExprId);
                if (ek == (ExprKind.RealLiteral as i32)) {
                  elemStartVal = this.dae.getExprRealValue(elemExprId);
                } else if (ek == (ExprKind.IntLiteral as i32)) {
                  elemStartVal = this.dae.getExprData().get(elemExprId * EXPR_STRIDE + EXPR_DATA1) as f64;
                }
              }
              let elemVarIdx = this.dae.addVariable(elemNameId, varType, variability, effectiveCausality, elemStartVal, varFlags);
              if (elemExprId != 0xffffffff && setElemBinding) {
                this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Binding as u32, elemExprId);
              }
              if (elemStartId != 0xffffffff) {
                this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Start as u32, elemStartId);
              } else if (elemExprId != 0xffffffff && isParamOrConst) {
                this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Start as u32, elemExprId);
              }
              if (elemFixedId != 0xffffffff) {
                this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Fixed as u32, elemFixedId);
              }
              if (elemMinId != 0xffffffff) {
                this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Min as u32, elemMinId);
              }
              if (elemMaxId != 0xffffffff) {
                this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Max as u32, elemMaxId);
              }
              if (elemNominalId != 0xffffffff) {
                this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Nominal as u32, elemNominalId);
              }
              if (elemDisplayUnitId != 0xffffffff) {
                this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.DisplayUnit as u32, elemDisplayUnitId);
              }
              if (subtypeUnitId != 0xffffffff) {
                this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Unit as u32, subtypeUnitId);
              }
              if (elemQuantityId != 0xffffffff) {
                this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Quantity as u32, elemQuantityId);
              }
              if (declDescId != 0xffffffff) {
                this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Description as u32, declDescId);
              }
              count++;
            }
          }
        }
      } else if (dim1 > 0 && dim2 > 0 && dim3 > 0 && dim4 > 0) {
        let isArrayCtor = valExprId != 0xffffffff && this.dae.getExprKind(valExprId) == ExprKind.ArrayCtor;
        let d1Count = isArrayCtor ? getArrayCtorCount(this.dae, valExprId) : 0;
        for (let i: u32 = 1; i <= dim1; i++) {
          let m2ExprId = isArrayCtor && (i - 1) < d1Count
            ? getArrayCtorElement(this.dae, valExprId, i - 1)
            : valExprId;
          let isM2Ctor = m2ExprId != 0xffffffff && this.dae.getExprKind(m2ExprId) == ExprKind.ArrayCtor;
          let d2Count = isM2Ctor ? getArrayCtorCount(this.dae, m2ExprId) : 0;
          for (let j: u32 = 1; j <= dim2; j++) {
            let m3ExprId = isM2Ctor && (j - 1) < d2Count
              ? getArrayCtorElement(this.dae, m2ExprId, j - 1)
              : m2ExprId;
            let isM3Ctor = m3ExprId != 0xffffffff && this.dae.getExprKind(m3ExprId) == ExprKind.ArrayCtor;
            let d3Count = isM3Ctor ? getArrayCtorCount(this.dae, m3ExprId) : 0;
            for (let k: u32 = 1; k <= dim3; k++) {
              let prefix3DId = concatArrayIndex3D(pool, fullVarNameId, i, j, k);
              let rowExprId = isM3Ctor && (k - 1) < d3Count
                ? getArrayCtorElement(this.dae, m3ExprId, k - 1)
                : m3ExprId;
              let isRowCtor = rowExprId != 0xffffffff && this.dae.getExprKind(rowExprId) == ExprKind.ArrayCtor;
              let d4Count = isRowCtor ? getArrayCtorCount(this.dae, rowExprId) : 0;
              for (let l: u32 = 1; l <= dim4; l++) {
                let elemNameId = concatArrayIndex1D(pool, prefix3DId, l);
                let elemExprId = isRowCtor && (l - 1) < d4Count
                  ? getArrayCtorElement(this.dae, rowExprId, l - 1)
                  : rowExprId;
                let elemStartId = sliceAttrExpr1D(this.dae, sliceAttrExpr3D(this.dae, declStartId, i - 1, j - 1, k - 1), l - 1);
                let elemFixedId = sliceAttrExpr1D(this.dae, sliceAttrExpr3D(this.dae, declFixedId, i - 1, j - 1, k - 1), l - 1);
                let elemMinId = sliceAttrExpr1D(this.dae, sliceAttrExpr3D(this.dae, declMinId, i - 1, j - 1, k - 1), l - 1);
                let elemMaxId = sliceAttrExpr1D(this.dae, sliceAttrExpr3D(this.dae, declMaxId, i - 1, j - 1, k - 1), l - 1);
                let elemNominalId = sliceAttrExpr1D(this.dae, sliceAttrExpr3D(this.dae, declNominalId, i - 1, j - 1, k - 1), l - 1);
                let elemDisplayUnitId = sliceAttrExpr1D(this.dae, sliceAttrExpr3D(this.dae, declDisplayUnitId, i - 1, j - 1, k - 1), l - 1);
                let elemQuantityId = sliceAttrExpr1D(this.dae, sliceAttrExpr3D(this.dae, declQuantityId, i - 1, j - 1, k - 1), l - 1);

                let isParamOrConst = variability == (Variability.Parameter as i32) || variability == (Variability.Constant as i32);
                let elemStartVal: f64 = 0.0;
                if (elemStartId != 0xffffffff) {
                  let ek = this.dae.getExprKind(elemStartId);
                  if (ek == (ExprKind.RealLiteral as i32)) {
                    elemStartVal = this.dae.getExprRealValue(elemStartId);
                  } else if (ek == (ExprKind.IntLiteral as i32)) {
                    elemStartVal = this.dae.getExprData().get(elemStartId * EXPR_STRIDE + EXPR_DATA1) as f64;
                  }
                } else if (elemExprId != 0xffffffff && isParamOrConst) {
                  let ek = this.dae.getExprKind(elemExprId);
                  if (ek == (ExprKind.RealLiteral as i32)) {
                    elemStartVal = this.dae.getExprRealValue(elemExprId);
                  } else if (ek == (ExprKind.IntLiteral as i32)) {
                    elemStartVal = this.dae.getExprData().get(elemExprId * EXPR_STRIDE + EXPR_DATA1) as f64;
                  }
                }
                let elemVarIdx = this.dae.addVariable(elemNameId, varType, variability, effectiveCausality, elemStartVal, varFlags);
                if (elemExprId != 0xffffffff && setElemBinding) {
                  this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Binding as u32, elemExprId);
                }
                if (elemStartId != 0xffffffff) {
                  this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Start as u32, elemStartId);
                } else if (elemExprId != 0xffffffff && isParamOrConst) {
                  this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Start as u32, elemExprId);
                }
                if (elemFixedId != 0xffffffff) {
                  this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Fixed as u32, elemFixedId);
                }
                if (elemMinId != 0xffffffff) {
                  this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Min as u32, elemMinId);
                }
                if (elemMaxId != 0xffffffff) {
                  this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Max as u32, elemMaxId);
                }
                if (elemNominalId != 0xffffffff) {
                  this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Nominal as u32, elemNominalId);
                }
                if (elemDisplayUnitId != 0xffffffff) {
                  this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.DisplayUnit as u32, elemDisplayUnitId);
                }
                if (subtypeUnitId != 0xffffffff) {
                  this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Unit as u32, subtypeUnitId);
                }
                if (elemQuantityId != 0xffffffff) {
                  this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Quantity as u32, elemQuantityId);
                }
                if (declDescId != 0xffffffff) {
                  this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Description as u32, declDescId);
                }
                count++;
              }
            }
          }
        }
      } else {
        let isParamOrConst = variability == (Variability.Parameter as i32) || variability == (Variability.Constant as i32);
        let varIdx = this.dae.addVariable(fullVarNameId, varType, variability, effectiveCausality, (isParamOrConst || declStartId != 0xffffffff) ? startVal : 0.0, varFlags);
        if (valExprId != 0xffffffff) {
          this.dae.setVarAttrExpr(varIdx, VarAttrKind.Binding as u32, valExprId);
        }
        if (declStartId != 0xffffffff) {
          this.dae.setVarAttrExpr(varIdx, VarAttrKind.Start as u32, declStartId);
        } else if (valExprId != 0xffffffff && isParamOrConst) {
          this.dae.setVarAttrExpr(varIdx, VarAttrKind.Start as u32, valExprId);
        }
        if (declFixedId != 0xffffffff) {
          this.dae.setVarAttrExpr(varIdx, VarAttrKind.Fixed as u32, declFixedId);
        }
        if (declMinId != 0xffffffff) {
          this.dae.setVarAttrExpr(varIdx, VarAttrKind.Min as u32, declMinId);
        }
        if (declMaxId != 0xffffffff) {
          this.dae.setVarAttrExpr(varIdx, VarAttrKind.Max as u32, declMaxId);
        }
        if (declNominalId != 0xffffffff) {
          this.dae.setVarAttrExpr(varIdx, VarAttrKind.Nominal as u32, declNominalId);
        }
        if (declDisplayUnitId != 0xffffffff) {
          this.dae.setVarAttrExpr(varIdx, VarAttrKind.DisplayUnit as u32, declDisplayUnitId);
        }
        if (subtypeUnitId != 0xffffffff) {
          this.dae.setVarAttrExpr(varIdx, VarAttrKind.Unit as u32, subtypeUnitId);
        }
        if (declQuantityId != 0xffffffff) {
          this.dae.setVarAttrExpr(varIdx, VarAttrKind.Quantity as u32, declQuantityId);
        }
        if (declDescId != 0xffffffff) {
          this.dae.setVarAttrExpr(varIdx, VarAttrKind.Description as u32, declDescId);
        }
        count++;
      }

      if (dim1 > 0 && valExprId != 0xffffffff && !setElemBinding) {
        let lhsNameExpr = this.dae.addExpression(ExprKind.Name, fullVarNameId);
        let pIdx = this.pendingArrayCount++;
        this.pendingArrayLhs.set(pIdx, lhsNameExpr);
        this.pendingArrayRhs.set(pIdx, valExprId);
      }
    } else if (typeNameId != 0) {
      let subClassLoc: u64 = this.findClassLoc(this.currentClassLoc, typeNameId, pool);
      if (!locIsNull(subClassLoc)) {
        let isConn = isConnectorClassLoc(subClassLoc);
        let isRec = isRecordClassLoc(subClassLoc);
        let isExpandable = isExpandableConnectorClassLoc(subClassLoc, this.rootProgramLoc, pool);
        if (isExpandable) {
          if (dim1 > 0 && dim2 == 0) {
            for (let i: u32 = 1; i <= dim1; i++) {
              let subPrefix = concatArrayIndex1D(pool, fullVarNameId, i);
              this.registerExpandableBus(subPrefix);
            }
          } else {
            this.registerExpandableBus(fullVarNameId);
          }
        }
        let nextIsTopLevelInterface = false;
        let nextParentCausality = Causality.Local;
        if (prefixPathId == 0) {
          if (isConn) {
            nextIsTopLevelInterface = true;
          } else if (isRec && causality != (Causality.Local as i32)) {
            nextIsTopLevelInterface = true;
            nextParentCausality = causality;
          }
        } else if (isTopLevelInterface) {
          if (isConn) {
            nextIsTopLevelInterface = true;
          } else if (isRec && parentCausality != (Causality.Local as i32)) {
            nextIsTopLevelInterface = true;
            nextParentCausality = parentCausality;
          }
        }

        if (valExprId != 0xffffffff) {
          this.setErrorAt(WasmBailReason.BindingExpr, declLoc);
          return 0;
        }
        let subEnvPtr: u32 = 0;
        let classModLoc = findClassModificationLoc(modLoc);
        if (!locIsNull(classModLoc)) {
          subEnvPtr = flattener_envCreate(this.scopeStack.currentEnvPtr);
          populateEnvFromClassModLoc(subEnvPtr, classModLoc, pool, this.exprVisitor);
        }
        if (this.scopeStackPtr != 0) {
          let typeEnv = changetype<ScopeStack>(this.scopeStackPtr).lookupNested(typeNameId);
          if (typeEnv == 0) {
            typeEnv = changetype<ScopeStack>(this.scopeStackPtr).lookupNestedPath(pool, typeNameId);
          }
          if (typeEnv != 0) {
            if (subEnvPtr == 0) {
              subEnvPtr = flattener_envCreate(this.scopeStack.currentEnvPtr);
            }
            changetype<ModificationEnvironment>(subEnvPtr).mergeFrom(changetype<ModificationEnvironment>(typeEnv));
          }
          let outerChildEnv = changetype<ScopeStack>(this.scopeStackPtr).lookupNested(compNameId);
          if (outerChildEnv == 0 && prefixPathId != 0) {
            outerChildEnv = changetype<ScopeStack>(this.scopeStackPtr).lookupNestedPath(pool, fullVarNameId);
          }
          if (outerChildEnv != 0) {
            if (subEnvPtr == 0) {
              subEnvPtr = flattener_envCreate(this.scopeStack.currentEnvPtr);
            }
            changetype<ModificationEnvironment>(subEnvPtr).mergeFrom(changetype<ModificationEnvironment>(outerChildEnv));
          }
        }
        let isCompProtected = (varFlags & FLAG_VAR_PROTECTED) != 0;
        if (dim1 > 0) {
          this.registerArrayShape(fullVarNameId, dim1, dim2, dim3, 0, dim4);
          if (prefixPathId != 0) {
            this.registerArrayShape(compNameId, dim1, dim2, dim3, 0, dim4);
          }
        }
        if (dim1 > 0 && dim2 == 0) {
          for (let i: u32 = 1; i <= dim1; i++) {
            let subPrefix = concatArrayIndex1D(pool, fullVarNameId, i);
            let elemEnvPtr = subEnvPtr;
            if (subEnvPtr != 0) {
              let subEnvObj = changetype<ModificationEnvironment>(subEnvPtr);
              let hasArrayCtorMod = false;
              for (let m: u32 = 0; m < subEnvObj.count; m++) {
                let entry = subEnvObj.getEntry(m);
                let valExprId = entry.valExprId;
                if (!entry.isEach && valExprId != 0xffffffff && valExprId != 0) {
                  if (this.dae.getExprKind(valExprId) == ExprKind.ArrayCtor) {
                    hasArrayCtorMod = true;
                    break;
                  }
                }
              }
              if (hasArrayCtorMod) {
                elemEnvPtr = flattener_envCreate(this.scopeStack.currentEnvPtr);
                let elemEnvObj = changetype<ModificationEnvironment>(elemEnvPtr);
                for (let m: u32 = 0; m < subEnvObj.count; m++) {
                  let entry = subEnvObj.getEntry(m);
                  let eKeyHash = entry.keyHash;
                  let eValExprId = entry.valExprId;
                  let eChildEnvPtr = entry.childEnvPtr;
                  let eIsFinal = entry.isFinal;
                  let eIsEach = entry.isEach;
                  if (!eIsEach && eValExprId != 0xffffffff && eValExprId != 0 && this.dae.getExprKind(eValExprId) == ExprKind.ArrayCtor) {
                    let ctorCount = getArrayCtorCount(this.dae, eValExprId);
                    if (i <= ctorCount) {
                      let slicedExprId = getArrayCtorElement(this.dae, eValExprId, i - 1);
                      elemEnvObj.bind(eKeyHash, slicedExprId, eIsFinal, false);
                    }
                  } else {
                    if (eValExprId != 0xffffffff && eValExprId != 0) {
                      elemEnvObj.bind(eKeyHash, eValExprId, eIsFinal, eIsEach);
                    }
                    if (eChildEnvPtr != 0) {
                      elemEnvObj.bindNested(eKeyHash, eChildEnvPtr, eIsFinal, eIsEach);
                    }
                  }
                }
              }
            }
            this.scopeStack.push(0, elemEnvPtr, subPrefix, 0);
            count += this.instantiateClassLoc(subClassLoc, subPrefix, nextIsTopLevelInterface, nextParentCausality, isCompProtected);
            this.scopeStack.pop();
          }
        } else if (dim1 > 0 && dim2 > 0) {
          this.setErrorAt(WasmBailReason.DeclarationDimensions, declLoc);
          return 0;
        } else {
          this.scopeStack.push(0, subEnvPtr, fullVarNameId, 0);
          count += this.instantiateClassLoc(subClassLoc, fullVarNameId, nextIsTopLevelInterface, nextParentCausality, isCompProtected);
          this.scopeStack.pop();
        }
      }
    }

    return count;
  }

  lowerAllClassEquations(classNodePtr: u32, prefixPathId: u32): u32 {
    return this.lowerAllClassEquationsLoc(locMakeRoot(classNodePtr), prefixPathId);
  }

  lowerAllClassEquationsLoc(classLoc: u64, prefixPathId: u32): u32 {
    if (locIsNull(classLoc)) return 0;
    let pool = this.dae.getStringPool();
    let compLoc = findCompositionLoc(classLoc);
    if (locIsNull(compLoc)) {
      let shortSpec = this.findShortClassSpecifier(classLoc);
      if (!locIsNull(shortSpec)) {
        let baseNameNode = locFindDescendant(shortSpec, SyntaxType.TYPE_SPECIFIER);
        if (locIsNull(baseNameNode)) baseNameNode = locFindDescendant(shortSpec, SyntaxType.NAME);
        if (!locIsNull(baseNameNode)) {
          let baseNameId = locIntern(pool, baseNameNode);
          let targetClassLoc = this.findClassLoc(classLoc, baseNameId, pool);
          if (!locIsNull(targetClassLoc) && targetClassLoc != classLoc) {
            let shortModLoc = findClassModificationLoc(shortSpec);
            if (!locIsNull(shortModLoc)) {
              let shortEnvPtr = flattener_envCreate(this.scopeStack.currentEnvPtr);
              populateEnvFromClassModLoc(shortEnvPtr, shortModLoc, pool, this.exprVisitor, true);
              this.scopeStack.push(0, shortEnvPtr, prefixPathId, 0);
              let eqRes = this.lowerAllClassEquationsLoc(targetClassLoc, prefixPathId);
              this.scopeStack.pop();
              return eqRes;
            }
            return this.lowerAllClassEquationsLoc(targetClassLoc, prefixPathId);
          }
        }
      }
      return 0;
    }

    let prevClassLoc = this.currentClassLoc;
    this.currentClassLoc = classLoc;
    let eqCountBefore = this.dae.eqCount;
    this.lowerCompositionEquations(compLoc, prefixPathId, pool);
    this.currentClassLoc = prevClassLoc;
    return this.dae.eqCount - eqCountBefore;
  }

  lowerCompositionEquations(parentLoc: u64, prefixPathId: u32, pool: ArenaStringPool): void {
    // Pass 1: Equation and algorithm sections (matching OpenModelica composition equation priority)
    let ch = locFirstChild(parentLoc);
    while (!locIsNull(ch)) {
      let ct = locType(ch);
      if (ct == SyntaxType.EQUATION_SECTION || ct == SyntaxType.ALGORITHM_SECTION) {
        this.lowerElementEquationsLoc(ch, prefixPathId, pool);
      }
      ch = locNextSibling(ch);
    }
    // Pass 2: Other elements (sub-components, extends clauses, etc.)
    ch = locFirstChild(parentLoc);
    while (!locIsNull(ch)) {
      let ct = locType(ch);
      if (ct != SyntaxType.EQUATION_SECTION && ct != SyntaxType.ALGORITHM_SECTION) {
        this.lowerElementEquationsLoc(ch, prefixPathId, pool);
      }
      ch = locNextSibling(ch);
    }
  }

  lowerElementEquationsLoc(elementLoc: u64, prefixPathId: u32, pool: ArenaStringPool, maxDepth: i32 = 120): u32 {
    if (locIsNull(elementLoc) || maxDepth <= 0) return 0;
    if (this.hasError) return 0;
    let ct = locType(elementLoc);

    if (ct == SyntaxType.ALGORITHM_SECTION) {
      return this.lowerAlgorithmSectionLoc(elementLoc, prefixPathId);
    }

    if (ct == SyntaxType.EQUATION_SECTION) {
      let isInit: boolean = false;
      let firstCh = locFirstNonEmptyChild(elementLoc);
      if (!locIsNull(firstCh) && (locMatches(firstCh, "initial") || locType(firstCh) == 60)) {
        isInit = true;
      }
      this.scopeStack.push(0, 0, prefixPathId, 0);
      let res = this.lowerEquationSectionLoc(elementLoc, isInit);
      this.scopeStack.pop();
      return res;
    }

    if (ct == SyntaxType.EXTENDS_CLAUSE) {
      let baseNameNode = locFindChild(elementLoc, SyntaxType.TYPE_SPECIFIER);
      if (locIsNull(baseNameNode)) baseNameNode = locFindChild(elementLoc, SyntaxType.NAME);
      if (locIsNull(baseNameNode)) baseNameNode = locFindDescendant(elementLoc, SyntaxType.TYPE_SPECIFIER);
      if (locIsNull(baseNameNode)) baseNameNode = locFindDescendant(elementLoc, SyntaxType.NAME);
      if (!locIsNull(baseNameNode)) {
        let baseNameId = locIntern(pool, baseNameNode);
        let baseClassLoc: u64 = this.findClassLoc(this.currentClassLoc, baseNameId, pool);
        if (!locIsNull(baseClassLoc)) {
          let extModLoc = findClassModificationLoc(elementLoc);
          let extEnvPtr: u32 = 0;
          if (!locIsNull(extModLoc)) {
            extEnvPtr = flattener_envCreate(this.scopeStack.currentEnvPtr);
            populateEnvFromClassModLoc(extEnvPtr, extModLoc, pool, this.exprVisitor, true);
          }
          if (extEnvPtr != 0) {
            this.scopeStack.push(0, extEnvPtr, prefixPathId, 0);
            let eqRes = this.lowerAllClassEquationsLoc(baseClassLoc, prefixPathId);
            this.scopeStack.pop();
            return eqRes;
          }
          return this.lowerAllClassEquationsLoc(baseClassLoc, prefixPathId);
        }
      }
      return 0;
    }

    if (ct == SyntaxType.COMPONENT_CLAUSE || ct == SyntaxType.COMPONENT_CLAUSE1) {
      return this.lowerComponentEquationsLoc(elementLoc, prefixPathId, pool);
    }

    if (ct != SyntaxType.CLASS_DEFINITION) {
      let sub = locFirstChild(elementLoc);
      let isOuter = false;
      while (!locIsNull(sub)) {
        let st = locType(sub);
        if (locMatches(sub, "outer") || (st == SyntaxType.TOKEN_OUTER && locLen(sub) > 0)) {
          isOuter = true;
          break;
        }
        sub = locNextSibling(sub);
      }
      if (isOuter) {
        return 0;
      }
      sub = locFirstChild(elementLoc);
      let count: u32 = 0;
      while (!locIsNull(sub)) {
        count += this.lowerElementEquationsLoc(sub, prefixPathId, pool, maxDepth - 1);
        sub = locNextSibling(sub);
      }
      return count;
    }

    return 0;
  }

  lowerComponentEquationsLoc(clauseLoc: u64, prefixPathId: u32, pool: ArenaStringPool): u32 {
    let typeSpecLoc = locFindDescendant(clauseLoc, SyntaxType.TYPE_SPECIFIER);
    if (locIsNull(typeSpecLoc)) return 0;

    if (locMatches(typeSpecLoc, "Real") ||
        locMatches(typeSpecLoc, "Integer") ||
        locMatches(typeSpecLoc, "Boolean") ||
        locMatches(typeSpecLoc, "String")) {
      return 0;
    }

    let typeNameId = locIntern(pool, typeSpecLoc);
    let subClassLoc: u64 = this.findClassLoc(this.currentClassLoc, typeNameId, pool);

    return this.lowerComponentEquationsDeclarations(clauseLoc, subClassLoc, prefixPathId, pool, typeNameId);
  }

  lowerComponentEquationsDeclarations(parentLoc: u64, subClassLoc: u64, prefixPathId: u32, pool: ArenaStringPool, clauseTypeNameId: u32 = 0): u32 {
    let ch = locFirstChild(parentLoc);
    let count: u32 = 0;
    while (!locIsNull(ch)) {
      let t = locType(ch);
      if (t == SyntaxType.DECLARATION) {
        let idLoc = locFirstNonEmptyChild(ch);
        if (!locIsNull(idLoc)) {
          let innerId = locFindDescendant(idLoc, SyntaxType.IDENTIFIER);
          if (!locIsNull(innerId)) idLoc = innerId;
          let compNameId = locIntern(pool, idLoc);
          let fullVarNameId = prefixPathId != 0 ? pool.concatIds(prefixPathId, compNameId) : compNameId;

          if (this.isComponentDisabled(fullVarNameId, pool) || (prefixPathId != 0 && this.isComponentDisabled(compNameId, pool))) {
            ch = locNextSibling(ch);
            continue;
          }

          let effectiveTypeNameId = clauseTypeNameId;
          let effectiveSubClassLoc = subClassLoc;
          if (this.scopeStackPtr != 0) {
            let ss = changetype<ScopeStack>(this.scopeStackPtr);
            let redeclCompTypeId = ss.lookupRedeclare(compNameId);
            if (redeclCompTypeId == 0 && prefixPathId != 0) {
              redeclCompTypeId = ss.lookupRedeclarePath(pool, fullVarNameId);
            }
            if (redeclCompTypeId != 0) {
              effectiveTypeNameId = redeclCompTypeId;
              effectiveSubClassLoc = this.findClassLoc(this.currentClassLoc, effectiveTypeNameId, pool);
            } else if (effectiveTypeNameId != 0) {
              let redeclClassId = ss.lookupRedeclare(effectiveTypeNameId);
              if (redeclClassId == 0) redeclClassId = ss.lookupRedeclarePath(pool, effectiveTypeNameId);
              if (redeclClassId != 0) {
                effectiveTypeNameId = redeclClassId;
                effectiveSubClassLoc = this.findClassLoc(this.currentClassLoc, effectiveTypeNameId, pool);
              }
            }
          }

          if (locIsNull(effectiveSubClassLoc)) {
            ch = locNextSibling(ch);
            continue;
          }

          let modLoc = locFindDescendant(ch, SyntaxType.MODIFICATION);
          let subEnvPtr: u32 = 0;
          let classModLoc = findClassModificationLoc(modLoc);
          if (!locIsNull(classModLoc)) {
            subEnvPtr = flattener_envCreate(this.scopeStack.currentEnvPtr);
            populateEnvFromClassModLoc(subEnvPtr, classModLoc, pool, this.exprVisitor);
          }
          if (this.scopeStackPtr != 0) {
            let ss = changetype<ScopeStack>(this.scopeStackPtr);
            if (effectiveTypeNameId != 0) {
              let typeEnv = ss.lookupNested(effectiveTypeNameId);
              if (typeEnv == 0) typeEnv = ss.lookupNestedPath(pool, effectiveTypeNameId);
              if (typeEnv != 0) {
                if (subEnvPtr == 0) subEnvPtr = flattener_envCreate(this.scopeStack.currentEnvPtr);
                changetype<ModificationEnvironment>(subEnvPtr).mergeFrom(changetype<ModificationEnvironment>(typeEnv));
              }
            }
            let outerChildEnv = ss.lookupNested(compNameId);
            if (outerChildEnv == 0 && prefixPathId != 0) {
              outerChildEnv = ss.lookupNestedPath(pool, fullVarNameId);
            }
            if (outerChildEnv != 0) {
              if (subEnvPtr == 0) subEnvPtr = flattener_envCreate(this.scopeStack.currentEnvPtr);
              changetype<ModificationEnvironment>(subEnvPtr).mergeFrom(changetype<ModificationEnvironment>(outerChildEnv));
            }
          }

          let declSubscriptsLoc = this.findDeclarationSubscripts(ch);
          let declDims = parseArrayDimensionsLoc(declSubscriptsLoc, this.dae, pool, prefixPathId, this.scopeStackPtr);
          let dim1: u32 = 0;
          if (declDims != 0xffffffffffffffff && declDims != 0) {
            dim1 = (declDims >> 32) as u32;
          }
          if (dim1 == 0) {
            let clauseSubscriptsLoc = locFindDescendant(parentLoc, SyntaxType.ARRAY_SUBSCRIPTS);
            let clauseDims = parseArrayDimensionsLoc(clauseSubscriptsLoc, this.dae, pool, prefixPathId, this.scopeStackPtr);
            if (clauseDims != 0xffffffffffffffff && clauseDims != 0) {
              dim1 = (clauseDims >> 32) as u32;
            }
          }
          if (dim1 > 0) {
            this.registerArrayShape(fullVarNameId, dim1);
            if (prefixPathId != 0) {
              this.registerArrayShape(compNameId, dim1);
            }
            for (let i: u32 = 1; i <= dim1; i++) {
              let subPrefix = concatArrayIndex1D(pool, fullVarNameId, i);
              this.scopeStack.push(0, subEnvPtr, subPrefix, 0);
              count += this.lowerAllClassEquationsLoc(effectiveSubClassLoc, subPrefix);
              this.scopeStack.pop();
            }
          } else {
            this.scopeStack.push(0, subEnvPtr, fullVarNameId, 0);
            count += this.lowerAllClassEquationsLoc(effectiveSubClassLoc, fullVarNameId);
            this.scopeStack.pop();
          }
        }
      } else if (t != SyntaxType.TYPE_SPECIFIER && t != SyntaxType.TYPE_PREFIX) {
        count += this.lowerComponentEquationsDeclarations(ch, subClassLoc, prefixPathId, pool, clauseTypeNameId);
      }
      ch = locNextSibling(ch);
    }
    return count;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Algorithm sections
  //
  // Statements are written to the DAE statement arena in pre-order; compound
  // statements carry the number of their direct children (see wasm_dae_printer).
  // Every lower*Stmt method returns the number of top-level statements emitted,
  // which can be 0 (e.g. `assert(true, ...)`) or > 1 (statically selected `if`).
  // ───────────────────────────────────────────────────────────────────────────

  lowerAlgorithmSectionLoc(sectionLoc: u64, prefixPathId: u32): u32 {
    if (this.hasError) return 0;
    let isInit = false;
    let firstCh = locFirstNonEmptyChild(sectionLoc);
    if (!locIsNull(firstCh) && locMatches(firstCh, "initial")) isInit = true;

    let ev = this.exprVisitor;
    let prevSymbolic = ev.symbolicSubscripts;
    ev.symbolicSubscripts = true;
    this.scopeStack.push(0, 0, prefixPathId, 0);

    let secStart = this.dae.stmtCount;
    let start = this.stmtItems.length;
    this.collectStmtItems(sectionLoc);
    let end = this.stmtItems.length;
    for (let i = start; i < end; i += 2) {
      let it = this.stmtItemAt(i);
      if (locType(it) == SyntaxType.STATEMENT) {
        this.lowerStatementLoc(it);
        if (this.hasError) break;
      }
    }
    this.stmtItems.length = start;

    this.scopeStack.pop();
    ev.symbolicSubscripts = prevSymbolic;
    if (this.hasError) return 0;

    this.algSections.push(secStart);
    this.algSections.push(this.dae.stmtCount - secStart);
    this.algSections.push(isInit ? 1 : 0);
    this.algSectionCount++;
    return 0;
  }

  @inline stmtItemAt(i: u32): u64 {
    return (this.stmtItems.get(i) as u64) | ((this.stmtItems.get(i + 1) as u64) << 32);
  }

  /** CST node types that the statement walker treats as opaque items. */
  isStmtAtom(t: u16): boolean {
    return t == SyntaxType.STATEMENT || t == SyntaxType.EXPRESSION || t == SyntaxType.FOR_INDICES ||
      t == SyntaxType.FOR_INDEX || t == SyntaxType.COMPONENT_REFERENCE || t == SyntaxType.FUNCTION_CALL ||
      t == SyntaxType.OUTPUT_EXPRESSION_LIST || t == SyntaxType.ASSIGNMENT_STATEMENT ||
      t == SyntaxType.IF_STATEMENT || t == SyntaxType.FOR_STATEMENT || t == SyntaxType.WHILE_STATEMENT ||
      t == SyntaxType.WHEN_STATEMENT || t == SyntaxType.DESCRIPTION || t == SyntaxType.ANNOTATION_CLAUSE ||
      t == SyntaxType.IDENTIFIER;
  }

  /**
   * Pushes the meaningful children of `nodeLoc` onto `stmtItems`, looking through
   * hidden grammar nodes (repeat/seq/choice wrappers). Zero-length nodes are skipped.
   */
  collectStmtItems(nodeLoc: u64): void {
    let ch = locFirstChild(nodeLoc);
    while (!locIsNull(ch)) {
      if (locLen(ch) > 0) {
        if (this.isStmtAtom(locType(ch)) || locChildCount(ch) == 0) {
          this.stmtItems.push((ch & 0xffffffff) as u32);
          this.stmtItems.push((ch >> 32) as u32);
        } else {
          this.collectStmtItems(ch);
        }
      }
      ch = locNextSibling(ch);
    }
  }

  lowerStatementLoc(loc: u64): u32 {
    if (this.hasError || locIsNull(loc)) return 0;
    let t = locType(loc);
    if (t == SyntaxType.STATEMENT) {
      let start = this.stmtItems.length;
      this.collectStmtItems(loc);
      let end = this.stmtItems.length;
      let oelLoc: u64 = 0;
      let callLoc: u64 = 0;
      for (let i = start; i < end; i += 2) {
        let it = this.stmtItemAt(i);
        let tt = locType(it);
        if (tt == SyntaxType.OUTPUT_EXPRESSION_LIST) oelLoc = it;
        else if (tt == SyntaxType.FUNCTION_CALL) callLoc = it;
      }
      let count: u32 = 0;
      if (oelLoc != 0 && callLoc != 0) {
        count = this.lowerTupleAssignmentStmt(loc, oelLoc, callLoc);
      } else {
        for (let i = start; i < end; i += 2) {
          let it = this.stmtItemAt(i);
          let tt = locType(it);
          if (tt == SyntaxType.DESCRIPTION || tt == SyntaxType.ANNOTATION_CLAUSE || locMatches(it, ";")) continue;
          count += this.lowerStatementLoc(it);
          if (this.hasError) break;
        }
      }
      this.stmtItems.length = start;
      return count;
    }
    if (t == SyntaxType.ASSIGNMENT_STATEMENT) return this.lowerAssignmentStmt(loc);
    if (t == SyntaxType.FUNCTION_CALL) return this.lowerCallStmt(loc);
    if (t == SyntaxType.IF_STATEMENT) return this.lowerIfStmt(loc);
    if (t == SyntaxType.FOR_STATEMENT) return this.lowerForStmt(loc);
    if (t == SyntaxType.WHILE_STATEMENT) return this.lowerWhileStmt(loc);
    if (t == SyntaxType.WHEN_STATEMENT) return this.lowerWhenStmt(loc);
    if (locMatches(loc, "break")) {
      this.dae.addStatement(StmtKind.Break as i32, 0);
      return 1;
    }
    if (locMatches(loc, "return")) {
      this.dae.addStatement(StmtKind.Return as i32, 0);
      return 1;
    }
    this.setErrorAt(WasmBailReason.AlgorithmStatementUnsupported, loc);
    return 0;
  }

  /** Lowers every STATEMENT item in stmtItems[from, to) and returns the emitted count. */
  lowerStmtItemRange(from: u32, to: u32): u32 {
    let count: u32 = 0;
    for (let i = from; i < to; i += 2) {
      let it = this.stmtItemAt(i);
      if (locType(it) == SyntaxType.STATEMENT) {
        count += this.lowerStatementLoc(it);
        if (this.hasError) return 0;
      }
    }
    return count;
  }

  @inline patchStmt(stmtIdx: u32, field: u32, value: u32): void {
    this.dae.getStmtData().set(stmtIdx * 4 + field, value as i32);
  }

  /** Returns the variable index of an assignment target expression, or -1. */
  stmtTargetVar(targetId: u32): i32 {
    if (targetId >= this.dae.exprCount) return -1;
    let k = this.dae.getExprKind(targetId);
    let nameExpr = targetId;
    if (k == ExprKind.Subscript) nameExpr = this.dae.getExprData1(targetId);
    if (nameExpr >= this.dae.exprCount || this.dae.getExprKind(nameExpr) != ExprKind.Name) return -1;
    let pool = this.dae.getStringPool();
    let nameId = this.exprVisitor.resolveVarName(this.dae.getExprData1(nameExpr));
    let v = this.dae.lookupVariableByName(nameId);
    if (v < 0) v = this.dae.lookupVariableByName(concatArrayIndex1D(pool, nameId, 1));
    if (v < 0) v = this.dae.lookupVariableByName(concatArrayIndex2D(pool, nameId, 1, 1));
    return v;
  }

  /** True when assigning to the target would produce an assignment diagnostic in the TS path. */
  isNonAssignableTarget(targetId: u32): boolean {
    let v = this.stmtTargetVar(targetId);
    if (v < 0) return false;
    let vari = VarAccessor.at(this.dae.getVarData(), v as u32).variability;
    return vari == Variability.Parameter || vari == Variability.Constant;
  }

  lowerAssignmentStmt(loc: u64): u32 {
    let start = this.stmtItems.length;
    this.collectStmtItems(loc);
    let end = this.stmtItems.length;
    let targetLoc: u64 = 0;
    let valueLoc: u64 = 0;
    let isDer = false;
    let seenAssign = false;
    for (let i = start; i < end; i += 2) {
      let it = this.stmtItemAt(i);
      let tt = locType(it);
      if (locMatches(it, "der")) isDer = true;
      else if (locMatches(it, ":=")) seenAssign = true;
      else if (!seenAssign && tt == SyntaxType.COMPONENT_REFERENCE) targetLoc = it;
      else if (seenAssign && valueLoc == 0) valueLoc = it;
    }
    this.stmtItems.length = start;
    if (isDer || targetLoc == 0 || valueLoc == 0) {
      this.setErrorAt(WasmBailReason.AlgorithmStatementUnsupported, loc);
      return 0;
    }
    let ev = this.exprVisitor;
    let pool = this.dae.getStringPool();
    // Assignment to a for-loop iterator is a diagnostic in the TS path.
    let baseLoc = locFindDescendant(targetLoc, SyntaxType.IDENTIFIER);
    if (!locIsNull(baseLoc) && ev.getLoopVar(locIntern(pool, baseLoc)) != 0xffffffff) {
      this.setErrorAt(WasmBailReason.AlgorithmStatementUnsupported, loc);
      return 0;
    }
    let targetId = ev.visitLoc(targetLoc);
    let valId = ev.visitLoc(valueLoc);
    if (targetId == 0xffffffff || valId == 0xffffffff || this.isNonAssignableTarget(targetId)) {
      this.setErrorAt(WasmBailReason.AlgorithmStatementUnsupported, loc);
      return 0;
    }
    let targetIsReal = ev.isRealExpr(targetId) || ev.isRealArrayName(targetId);
    let v = this.stmtTargetVar(targetId);
    if (v >= 0 && this.dae.getVarType(v as u32) == (VarType.Integer as i32) && ev.isRealExpr(valId)) {
      // Integer := Real is a type error reported by the TS path.
      this.setErrorAt(WasmBailReason.AlgorithmStatementUnsupported, loc);
      return 0;
    }
    if (targetIsReal && !ev.isRealExpr(valId)) valId = this.algCastToReal(valId);
    this.dae.addStatement(StmtKind.Assignment as i32, targetId, valId);
    return 1;
  }

  /** Mirrors the TS `castToRealExpr` for scalar statement values. */
  algCastToReal(valId: u32): u32 {
    if (valId >= this.dae.exprCount) return valId;
    let ev = this.exprVisitor;
    let k = this.dae.getExprKind(valId);
    if (k == ExprKind.IntLiteral || k == ExprKind.ArrayCtor || k == ExprKind.IfElse) return ev.castToReal(valId);
    if (k == ExprKind.Negate) {
      let operand = this.dae.getExprLeft(valId);
      if (operand < this.dae.exprCount && this.dae.getExprKind(operand) == ExprKind.IntLiteral) {
        return this.dae.addExpression(ExprKind.Negate, 0, ev.castToReal(operand));
      }
    }
    if (this.isScalarIntExpr(valId)) {
      let castId = internStaticString(this.dae.getStringPool(), "/*Real*/");
      return this.dae.addExpression(ExprKind.Call, castId, valId, 1);
    }
    return valId;
  }

  isScalarIntExpr(id: u32): boolean {
    if (id >= this.dae.exprCount) return false;
    let k = this.dae.getExprKind(id);
    if (k == ExprKind.IntLiteral) return true;
    if (k == ExprKind.Name) {
      let nameId = this.dae.getExprData1(id);
      if (this.exprVisitor.getLoopVar(nameId) != 0xffffffff) return true;
      let v = this.dae.lookupVariableByName(this.exprVisitor.resolveVarName(nameId));
      return v >= 0 && this.dae.getVarType(v as u32) == (VarType.Integer as i32);
    }
    if (k == ExprKind.Subscript) {
      let count = this.dae.getExprRight(id);
      for (let i: u32 = 0; i < count; i++) {
        let sub = i == 0 ? this.dae.getExprLeft(id) : this.dae.getExprLeft(id + i);
        if (!this.isScalarIntExpr(sub)) return false;
      }
      let v = this.stmtTargetVar(id);
      return v >= 0 && this.dae.getVarType(v as u32) == (VarType.Integer as i32);
    }
    if (k == ExprKind.Binary) {
      let op = this.dae.getExprData1(id) as u16;
      if (op != (BinOp.Add as u16) && op != (BinOp.Sub as u16) && op != (BinOp.Mul as u16)) return false;
      return this.isScalarIntExpr(this.dae.getExprLeft(id)) && this.isScalarIntExpr(this.dae.getExprRight(id));
    }
    if (k == ExprKind.Negate || k == ExprKind.Unary) {
      return this.isScalarIntExpr(this.dae.getExprLeft(id));
    }
    return false;
  }

  lowerCallStmt(loc: u64): u32 {
    let pool = this.dae.getStringPool();
    let nameLoc = locFindChild(loc, SyntaxType.COMPONENT_REFERENCE);
    if (locIsNull(nameLoc)) nameLoc = locFindDescendant(loc, SyntaxType.COMPONENT_REFERENCE);
    if (!locIsNull(nameLoc) && locMatches(nameLoc, "reinit")) {
      this.setErrorAt(WasmBailReason.AlgorithmReinit, loc);
      return 0;
    }
    let callId = this.exprVisitor.visitLoc(loc);
    if (callId == 0xffffffff || callId >= this.dae.exprCount || this.dae.getExprKind(callId) != ExprKind.Call) {
      this.setErrorAt(WasmBailReason.AlgorithmStatementUnsupported, loc);
      return 0;
    }
    if (poolMatchesSimple(pool, this.dae.getExprData1(callId), "assert")) {
      let firstArg = this.dae.getExprLeft(callId);
      if (firstArg < this.dae.exprCount && this.dae.getExprKind(firstArg) == ExprKind.BoolLiteral &&
          this.dae.getExprData1(firstArg) == 1) {
        return 0;
      }
    }
    this.dae.addStatement(StmtKind.ProcedureCall as i32, callId);
    return 1;
  }

  lowerTupleAssignmentStmt(stmtLoc: u64, oelLoc: u64, callLoc: u64): u32 {
    let ev = this.exprVisitor;
    let start = this.stmtItems.length;
    this.collectStmtItems(oelLoc);
    let end = this.stmtItems.length;
    // Targets are recorded as (lo, hi) loc pairs in stmtAux; 0/0 marks an empty slot.
    let auxStart = this.stmtAux.length;
    let cur: u64 = 0;
    for (let i = start; i < end; i += 2) {
      let it = this.stmtItemAt(i);
      if (locMatches(it, ",")) {
        this.stmtAux.push((cur & 0xffffffff) as u32);
        this.stmtAux.push((cur >> 32) as u32);
        cur = 0;
      } else if (locType(it) == SyntaxType.EXPRESSION || locType(it) == SyntaxType.COMPONENT_REFERENCE) {
        cur = it;
      }
    }
    this.stmtAux.push((cur & 0xffffffff) as u32);
    this.stmtAux.push((cur >> 32) as u32);
    this.stmtItems.length = start;
    let auxEnd = this.stmtAux.length;
    let n = (auxEnd - auxStart) / 2;

    let callId = ev.visitLoc(callLoc);
    if (callId == 0xffffffff) {
      this.stmtAux.length = auxStart;
      this.setErrorAt(WasmBailReason.AlgorithmStatementUnsupported, stmtLoc);
      return 0;
    }
    // Lower targets first so non-assignable ones can bail before anything is emitted.
    for (let i = auxStart; i < auxEnd; i += 2) {
      let tLoc = (this.stmtAux.get(i) as u64) | ((this.stmtAux.get(i + 1) as u64) << 32);
      let tid: u32 = 0xffffffff;
      if (tLoc != 0) {
        tid = ev.visitLoc(tLoc);
        if (tid == 0xffffffff || this.isNonAssignableTarget(tid)) {
          this.stmtAux.length = auxStart;
          this.setErrorAt(WasmBailReason.AlgorithmStatementUnsupported, stmtLoc);
          return 0;
        }
      }
      this.stmtAux.set(i, tid);
    }
    this.dae.addStatement(StmtKind.ComplexAssignment as i32, n, callId);
    for (let i = auxStart; i < auxEnd; i += 2) {
      this.dae.addStatement(StmtKind.Assignment as i32, this.stmtAux.get(i));
    }
    this.stmtAux.length = auxStart;
    return 1;
  }

  /**
   * Splits an if/when statement into branches. For each branch, pushes
   * [condItemIdx | 0xffffffff for else, bodyFrom, bodyTo, condExpr] onto stmtAux.
   */
  collectStmtBranches(start: u32, end: u32, openKw: string, elseIfKw: string, endKw: string): void {
    let inCond = false;
    let cur: i32 = -1;
    for (let i = start; i < end; i += 2) {
      let it = this.stmtItemAt(i);
      if (locMatches(it, openKw) || locMatches(it, elseIfKw)) {
        if (cur >= 0) this.stmtAux.set((cur as u32) + 2, i);
        cur = this.stmtAux.length as i32;
        this.stmtAux.push(0xffffffff);
        this.stmtAux.push(i + 2);
        this.stmtAux.push(end);
        this.stmtAux.push(0xffffffff);
        inCond = true;
      } else if (locMatches(it, "else")) {
        if (cur >= 0) this.stmtAux.set((cur as u32) + 2, i);
        cur = this.stmtAux.length as i32;
        this.stmtAux.push(0xffffffff);
        this.stmtAux.push(i + 2);
        this.stmtAux.push(end);
        this.stmtAux.push(0xffffffff);
        inCond = false;
      } else if (locMatches(it, "then")) {
        if (cur >= 0) this.stmtAux.set((cur as u32) + 1, i + 2);
        inCond = false;
      } else if (locMatches(it, endKw) || locMatches(it, "end")) {
        if (cur >= 0) this.stmtAux.set((cur as u32) + 2, i);
        return;
      } else if (inCond && cur >= 0 && locType(it) == SyntaxType.EXPRESSION) {
        this.stmtAux.set(cur as u32, i);
      }
    }
  }

  lowerIfStmt(loc: u64): u32 {
    let ev = this.exprVisitor;
    let start = this.stmtItems.length;
    this.collectStmtItems(loc);
    let end = this.stmtItems.length;
    let auxStart = this.stmtAux.length;
    this.collectStmtBranches(start, end, "if", "elseif", "end if");
    let auxEnd = this.stmtAux.length;

    // Lower all conditions up front; 0/1 = statically false/true, 2 = dynamic.
    for (let b = auxStart; b < auxEnd; b += 4) {
      let condIdx = this.stmtAux.get(b);
      if (condIdx == 0xffffffff) continue;
      let condId = ev.visitLoc(this.stmtItemAt(condIdx));
      if (condId == 0xffffffff) {
        this.setErrorAt(WasmBailReason.AlgorithmStatementUnsupported, this.stmtItemAt(condIdx));
        this.stmtAux.length = auxStart;
        this.stmtItems.length = start;
        return 0;
      }
      this.stmtAux.set(b + 3, condId);
    }

    let count: u32 = 0;
    let root: u32 = 0xffffffff;
    for (let b = auxStart; b < auxEnd; b += 4) {
      if (this.stmtCondState(b) != 0) {
        root = b;
        break;
      }
    }
    if (root != 0xffffffff) {
      let rootState = this.stmtCondState(root);
      if (rootState != 2) {
        // Statically true condition or unconditional else: inline the branch body.
        count = this.lowerStmtItemRange(this.stmtAux.get(root + 1), this.stmtAux.get(root + 2));
      } else {
        let header = this.dae.addStatement(StmtKind.If as i32, this.stmtAux.get(root + 3), 0, 0);
        let thenCount = this.lowerStmtItemRange(this.stmtAux.get(root + 1), this.stmtAux.get(root + 2));
        let active: u32 = 0;
        for (let b = root + 4; b < auxEnd && !this.hasError; b += 4) {
          let st = this.stmtCondState(b);
          if (st == 0) continue;
          let blk = this.dae.addStatement(StmtKind.Block as i32, st == 2 ? this.stmtAux.get(b + 3) : 0xffffffff, 0);
          let n = this.lowerStmtItemRange(this.stmtAux.get(b + 1), this.stmtAux.get(b + 2));
          this.patchStmt(blk, 2, n);
          active++;
          if (st != 2) break;
        }
        this.patchStmt(header, 2, thenCount);
        this.patchStmt(header, 3, active);
        count = 1;
      }
    }
    this.stmtAux.length = auxStart;
    this.stmtItems.length = start;
    return this.hasError ? 0 : count;
  }

  /** Branch condition state for an if-branch record: 0 = false, 1 = true/else, 2 = dynamic. */
  stmtCondState(b: u32): u32 {
    if (this.stmtAux.get(b) == 0xffffffff) return 1;
    let condId = this.stmtAux.get(b + 3);
    if (condId < this.dae.exprCount && this.dae.getExprKind(condId) == ExprKind.BoolLiteral) {
      return this.dae.getExprData1(condId) != 0 ? 1 : 0;
    }
    return 2;
  }

  lowerWhileStmt(loc: u64): u32 {
    let start = this.stmtItems.length;
    this.collectStmtItems(loc);
    let end = this.stmtItems.length;
    let condLoc: u64 = 0;
    let bodyFrom: u32 = end;
    let bodyTo: u32 = end;
    for (let i = start; i < end; i += 2) {
      let it = this.stmtItemAt(i);
      if (locMatches(it, "loop")) bodyFrom = i + 2;
      else if (locMatches(it, "end while") || locMatches(it, "end")) { bodyTo = i; break; }
      else if (condLoc == 0 && locType(it) == SyntaxType.EXPRESSION) condLoc = it;
    }
    let condId: u32 = condLoc != 0 ? this.exprVisitor.visitLoc(condLoc) : 0xffffffff;
    if (condId == 0xffffffff) {
      this.stmtItems.length = start;
      this.setErrorAt(WasmBailReason.AlgorithmStatementUnsupported, loc);
      return 0;
    }
    let header = this.dae.addStatement(StmtKind.While as i32, condId, 0);
    let n = this.lowerStmtItemRange(bodyFrom, bodyTo);
    this.patchStmt(header, 2, n);
    this.stmtItems.length = start;
    return this.hasError ? 0 : 1;
  }

  lowerForStmt(loc: u64): u32 {
    let ev = this.exprVisitor;
    let pool = this.dae.getStringPool();
    let start = this.stmtItems.length;
    this.collectStmtItems(loc);
    let end = this.stmtItems.length;
    let indicesLoc: u64 = 0;
    let bodyFrom: u32 = end;
    let bodyTo: u32 = end;
    for (let i = start; i < end; i += 2) {
      let it = this.stmtItemAt(i);
      if (locType(it) == SyntaxType.FOR_INDICES && indicesLoc == 0) indicesLoc = it;
      else if (locMatches(it, "loop")) bodyFrom = i + 2;
      else if (locMatches(it, "end for") || locMatches(it, "end")) { bodyTo = i; break; }
    }
    if (indicesLoc == 0) {
      this.stmtItems.length = start;
      this.setErrorAt(WasmBailReason.AlgorithmStatementUnsupported, loc);
      return 0;
    }

    let idxStart = this.stmtItems.length;
    this.collectStmtItems(indicesLoc);
    let idxEnd = this.stmtItems.length;
    // Per index: [headerStmt, iterNameId, previousBinding] on stmtAux.
    let auxStart = this.stmtAux.length;
    let ok = true;
    for (let i = idxStart; i < idxEnd; i += 2) {
      let fi = this.stmtItemAt(i);
      if (locType(fi) != SyntaxType.FOR_INDEX) continue;
      let idLoc = locFindDescendant(fi, SyntaxType.IDENTIFIER);
      let rangeLoc = locFindChild(fi, SyntaxType.EXPRESSION);
      if (locIsNull(rangeLoc)) rangeLoc = locFindDescendant(fi, SyntaxType.EXPRESSION);
      if (locIsNull(idLoc) || locIsNull(rangeLoc)) {
        this.setErrorAt(WasmBailReason.ForStatementImplicitRange, fi);
        ok = false;
        break;
      }
      let nameId = locIntern(pool, idLoc);
      let prevKeep = ev.keepRanges;
      ev.keepRanges = true;
      let rangeId = ev.visitLoc(rangeLoc);
      ev.keepRanges = prevKeep;
      if (rangeId == 0xffffffff) {
        this.setErrorAt(WasmBailReason.AlgorithmStatementUnsupported, rangeLoc);
        ok = false;
        break;
      }
      let header = this.dae.addStatement(StmtKind.For as i32, nameId, rangeId, 1);
      this.stmtAux.push(header);
      this.stmtAux.push(nameId);
      this.stmtAux.push(ev.getLoopVar(nameId));
      ev.setLoopVar(nameId, this.dae.addExpression(ExprKind.Name, nameId));
    }
    let auxEnd = this.stmtAux.length;
    if (ok && auxEnd > auxStart) {
      let n = this.lowerStmtItemRange(bodyFrom, bodyTo);
      this.patchStmt(this.stmtAux.get(auxEnd - 3), 3, n);
    }
    // Restore iterator bindings innermost-first.
    let b = auxEnd;
    while (b > auxStart) {
      b -= 3;
      let nameId = this.stmtAux.get(b + 1);
      let prev = this.stmtAux.get(b + 2);
      if (prev == 0xffffffff) ev.removeLoopVar(nameId);
      else ev.setLoopVar(nameId, prev);
    }
    this.stmtAux.length = auxStart;
    this.stmtItems.length = start;
    if (!ok && !this.hasError) this.setErrorAt(WasmBailReason.AlgorithmStatementUnsupported, loc);
    return this.hasError || auxEnd == auxStart ? 0 : 1;
  }

  /** Interned target names of the direct assignment statements in stmtItems[from, to), pushed onto stmtAux. */
  collectWhenTargets(from: u32, to: u32): void {
    let pool = this.dae.getStringPool();
    for (let i = from; i < to; i += 2) {
      let it = this.stmtItemAt(i);
      if (locType(it) != SyntaxType.STATEMENT) continue;
      let asg = locFindDescendant(it, SyntaxType.ASSIGNMENT_STATEMENT);
      let nested = locFindDescendant(it, SyntaxType.IF_STATEMENT);
      if (locIsNull(nested)) nested = locFindDescendant(it, SyntaxType.FOR_STATEMENT);
      if (locIsNull(nested)) nested = locFindDescendant(it, SyntaxType.WHILE_STATEMENT);
      if (locIsNull(nested)) nested = locFindDescendant(it, SyntaxType.WHEN_STATEMENT);
      if (locIsNull(asg) || !locIsNull(nested)) continue;
      let tgt = locFindDescendant(asg, SyntaxType.COMPONENT_REFERENCE);
      if (locIsNull(tgt)) continue;
      let id = locIntern(pool, tgt);
      let dup = false;
      for (let k = this.stmtAux.length; k > 0; k--) {
        if (this.stmtAux.get(k - 1) == 0xffffffff) break;
        if (this.stmtAux.get(k - 1) == id) { dup = true; break; }
      }
      if (!dup) this.stmtAux.push(id);
    }
  }

  /** True when every elsewhen branch assigns the same set of variables as the when branch. */
  whenTargetsMatch(auxStart: u32, auxEnd: u32): boolean {
    let setsStart = this.stmtAux.length;
    // Then-branch targets, delimited by a 0xffffffff sentinel.
    this.stmtAux.push(0xffffffff);
    let thenFrom = this.stmtAux.length;
    this.collectWhenTargets(this.stmtAux.get(auxStart + 1), this.stmtAux.get(auxStart + 2));
    let thenTo = this.stmtAux.length;
    let match = true;
    for (let b = auxStart + 4; b < auxEnd && match; b += 4) {
      this.stmtAux.push(0xffffffff);
      let ewFrom = this.stmtAux.length;
      this.collectWhenTargets(this.stmtAux.get(b + 1), this.stmtAux.get(b + 2));
      let ewTo = this.stmtAux.length;
      if (ewTo - ewFrom != thenTo - thenFrom) match = false;
      for (let i = thenFrom; i < thenTo && match; i++) {
        let found = false;
        for (let j = ewFrom; j < ewTo; j++) {
          if (this.stmtAux.get(j) == this.stmtAux.get(i)) { found = true; break; }
        }
        if (!found) match = false;
      }
      this.stmtAux.length = ewFrom - 1;
    }
    this.stmtAux.length = setsStart;
    return match;
  }

  lowerWhenStmt(loc: u64): u32 {
    let ev = this.exprVisitor;
    let start = this.stmtItems.length;
    this.collectStmtItems(loc);
    let end = this.stmtItems.length;
    let auxStart = this.stmtAux.length;
    this.collectStmtBranches(start, end, "when", "elsewhen", "end when");
    let auxEnd = this.stmtAux.length;
    let bail = auxEnd == auxStart;

    for (let b = auxStart; b < auxEnd && !bail; b += 4) {
      let condIdx = this.stmtAux.get(b);
      if (condIdx == 0xffffffff) { bail = true; break; }
      let condLoc = this.stmtItemAt(condIdx);
      // Non-discrete / clocked conditions are diagnostics in the TS path.
      if (!locIsNull(locFindMatchingDescendant(condLoc, "noEvent")) ||
          !locIsNull(locFindMatchingDescendant(condLoc, "Clock"))) { bail = true; break; }
      let condId = ev.visitLoc(condLoc);
      if (condId == 0xffffffff) { bail = true; break; }
      this.stmtAux.set(b + 3, condId);
    }
    if (!bail && auxEnd - auxStart > 4 && !this.whenTargetsMatch(auxStart, auxEnd)) bail = true;
    if (bail) {
      this.stmtAux.length = auxStart;
      this.stmtItems.length = start;
      this.setErrorAt(WasmBailReason.AlgorithmStatementUnsupported, loc);
      return 0;
    }

    let header = this.dae.addStatement(StmtKind.When as i32, this.stmtAux.get(auxStart + 3), 0, (auxEnd - auxStart) / 4 - 1);
    let thenCount = this.lowerStmtItemRange(this.stmtAux.get(auxStart + 1), this.stmtAux.get(auxStart + 2));
    this.patchStmt(header, 2, thenCount);
    for (let b = auxStart + 4; b < auxEnd && !this.hasError; b += 4) {
      let blk = this.dae.addStatement(StmtKind.Block as i32, this.stmtAux.get(b + 3), 0);
      let n = this.lowerStmtItemRange(this.stmtAux.get(b + 1), this.stmtAux.get(b + 2));
      this.patchStmt(blk, 2, n);
    }
    this.stmtAux.length = auxStart;
    this.stmtItems.length = start;
    return this.hasError ? 0 : 1;
  }

  flatten(rootClassNodePtr: u32, programRootNodePtr: u32): u32 {
    if (rootClassNodePtr == 0) return 0;

    let rootProgramLoc: u64 = 0;
    let rootClassLoc: u64 = 0;

    if (programRootNodePtr != 0) {
      rootProgramLoc = locMakeRoot(programRootNodePtr);
      if (programRootNodePtr == rootClassNodePtr) {
        rootClassLoc = rootProgramLoc;
      } else {
        rootClassLoc = findClassByPtr(rootProgramLoc, rootClassNodePtr);
        if (locIsNull(rootClassLoc)) {
          let pool = this.dae.getStringPool();
          let targetNameId = getClassNameIdLoc(pool, locMakeRoot(rootClassNodePtr));
          if (targetNameId != 0) {
            rootClassLoc = findClassDefinitionLoc(rootProgramLoc, targetNameId, pool);
          }
        }
        if (locIsNull(rootClassLoc)) {
          rootClassLoc = locMakeRoot(rootClassNodePtr);
        }
      }
    } else {
      rootClassLoc = locMakeRoot(rootClassNodePtr);
      rootProgramLoc = rootClassLoc;
    }

    this.rootProgramNodePtr = locPtr(rootProgramLoc);
    this.rootProgramLoc = rootProgramLoc;

    this.expandableBusCount = 0;
    this.busRefSignalCount = 0;
    this.pendingArrayCount = 0;
    this.algSections.length = 0;
    this.algSectionCount = 0;
    this.whenRecords.length = 0;
    this.whenRecordCount = 0;
    this.ifRecords.length = 0;
    this.ifRecordCount = 0;

    let pool = this.dae.getStringPool();
    let varsBefore = this.dae.varCount;
    let isConn = isConnectorClassLoc(rootClassLoc);
    let isExpandableRoot = isExpandableConnectorClassLoc(rootClassLoc, rootProgramLoc, pool);
    if (isExpandableRoot) {
      this.registerExpandableBus(0);
    }
    this.instantiateClassLoc(rootClassLoc, 0, isConn, Causality.Local);
    if (this.hasError) return 0;

    for (let p: u32 = 0; p < this.pendingArrayCount; p++) {
      this.dae.addEquation(EqKind.Array as u32, this.pendingArrayLhs.get(p), this.pendingArrayRhs.get(p));
    }
    this.pendingArrayCount = 0;

    this.lowerAllClassEquationsLoc(rootClassLoc, 0);
    if (this.hasError) return 0;

    // Resolve any cardinality(c) variable bindings after all connect() equations have been collected
    let totalVars = this.dae.varCount;
    let totalEqs = this.dae.eqCount;
    for (let v: u32 = varsBefore; v < totalVars; v++) {
      let bExpr = this.dae.getVarAttrExpr(v, VarAttrKind.Binding as u32);
      if (bExpr != 0 && bExpr != 0xffffffff && bExpr < this.dae.exprCount && this.dae.getExprKind(bExpr) == ExprKind.Call) {
        let fnId = this.dae.getExprData1(bExpr);
        if (poolMatchesSimple(pool, fnId, "cardinality")) {
          let argExpr = this.dae.getExprLeft(bExpr);
          if (argExpr != 0xffffffff && argExpr < this.dae.exprCount && this.dae.getExprKind(argExpr) == ExprKind.Name) {
            let targetNameId = this.dae.getExprData1(argExpr);
            let connCount: i32 = 0;
            for (let e: u32 = 0; e < totalEqs; e++) {
              let eq = EqAccessor.at(this.dae.getEqData(), e);
              if (eq.isConnect) {
                let lhsId = eq.lhs;
                let rhsId = eq.rhs;
                if (lhsId < this.dae.exprCount && this.dae.getExprKind(lhsId) == ExprKind.Name && this.dae.getExprData1(lhsId) == targetNameId) {
                  connCount++;
                } else if (rhsId < this.dae.exprCount && this.dae.getExprKind(rhsId) == ExprKind.Name && this.dae.getExprData1(rhsId) == targetNameId) {
                  connCount++;
                }
              }
            }
            let litId = this.dae.addIntLiteral(connCount);
            this.dae.setVarAttrExpr(v, VarAttrKind.Binding as u32, litId);
            this.dae.setVarAttrExpr(v, VarAttrKind.Start as u32, litId);
            VarAccessor.at(this.dae.getVarData(), v).startValue = connCount as f64;
          }
        }
      }
    }

    if (this.expandableBusCount > 0) {
      this.processExpandableConnectors();
    }

    return this.dae.varCount - varsBefore;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// C-Style WASM Bridge Exports
// ─────────────────────────────────────────────────────────────────────────────

export function flattener_create(daePtr: u32): u32 {
  let flattener = ModelicaFlattener.create(changetype<DaeBuilder>(daePtr));
  return changetype<usize>(flattener) as u32;
}

export function flattener_destroy(flattenerPtr: u32): void {
  if (flattenerPtr != 0) {
    changetype<ModelicaFlattener>(flattenerPtr).destroy();
  }
}

export function flattener_flattenEquationSection(flattenerPtr: u32, sectionNodePtr: u32, isInitial: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).flattenEquationSection(sectionNodePtr, isInitial == 1);
}

export function flattener_flattenInitialEquationSection(flattenerPtr: u32, sectionNodePtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).flattenInitialEquationSection(sectionNodePtr);
}

export function flattener_lowerExpr(flattenerPtr: u32, exprNodePtr: u32): u32 {
  if (flattenerPtr == 0) return 0xffffffff;
  return changetype<ModelicaFlattener>(flattenerPtr).exprVisitor.visit(exprNodePtr);
}

export function flattener_lowerExprLoc(flattenerPtr: u32, exprLoc: u64): u32 {
  if (flattenerPtr == 0) return 0xffffffff;
  return changetype<ModelicaFlattener>(flattenerPtr).exprVisitor.visitLoc(exprLoc);
}

export function flattener_addConnection(flattenerPtr: u32, p1VarId: u32, p2VarId: u32, isFlow: u32, isBoundary: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).addConnection(p1VarId, p2VarId, isFlow == 1, isBoundary == 1);
}

export function flattener_addStreamConnection(flattenerPtr: u32, h1VarId: u32, mdot1VarId: u32, h2VarId: u32, mdot2VarId: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).addStreamConnection(h1VarId, mdot1VarId, h2VarId, mdot2VarId);
}

export function flattener_connectPorts(flattenerPtr: u32, port1VarId: u32, port2VarId: u32, memberCount: u32, isBoundary: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).connectPorts(port1VarId, port2VarId, memberCount, isBoundary == 1);
}

export function flattener_finalizeConnections(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).finalizeConnections();
}

export function flattener_expandConnections(flattenerPtr: u32, omcCompatibility: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).expandConnections(omcCompatibility == 1);
}

export function flattener_findRoot(flattenerPtr: u32, varId: u32): u32 {
  if (flattenerPtr == 0) return varId;
  return changetype<ModelicaFlattener>(flattenerPtr).findRoot(varId);
}

export function flattener_unionSets(flattenerPtr: u32, v1: u32, v2: u32): void {
  if (flattenerPtr != 0) {
    changetype<ModelicaFlattener>(flattenerPtr).unionSets(v1, v2);
  }
}

export function flattener_getCardinality(flattenerPtr: u32, varId: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).getCardinality(varId);
}

export function flattener_expandConnector(flattenerPtr: u32, busVarId: u32, memberNameHash: u32, varType: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).expandConnector(busVarId, memberNameHash, varType);
}

export function flattener_flattenArrayComponent(flattenerPtr: u32, baseNameHash: u32, dim1: u32, dim2: u32, varType: u32, variability: u32, causality: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).flattenArrayComponent(baseNameHash, dim1, dim2, varType as u16, variability as u16, causality as u16);
}

export function flattener_registerInner(flattenerPtr: u32, nameHash: u32, varId: u32): void {
  if (flattenerPtr != 0) {
    changetype<ModelicaFlattener>(flattenerPtr).registerInner(nameHash, varId);
  }
}

export function flattener_resolveOuter(flattenerPtr: u32, nameHash: u32): u32 {
  if (flattenerPtr == 0) return 0xffffffff;
  return changetype<ModelicaFlattener>(flattenerPtr).resolveOuter(nameHash);
}

export function flattener_envCreate(parentPtr: u32): u32 {
  return ModificationEnvironment.create(parentPtr);
}

export function flattener_envBind(envPtr: u32, keyHash: u32, valExprId: u32, isFinal: u32, isEach: u32): void {
  if (envPtr != 0) {
    changetype<ModificationEnvironment>(envPtr).bind(keyHash, valExprId, isFinal == 1, isEach == 1);
  }
}

export function flattener_envBindNested(envPtr: u32, keyHash: u32, childEnvPtr: u32, isFinal: u32, isEach: u32): void {
  if (envPtr != 0) {
    changetype<ModificationEnvironment>(envPtr).bindNested(keyHash, childEnvPtr, isFinal == 1, isEach == 1);
  }
}

export function flattener_envBindRedeclare(envPtr: u32, keyHash: u32, newTypeHash: u32, valExprId: u32, isFinal: u32, isEach: u32): void {
  if (envPtr != 0) {
    changetype<ModificationEnvironment>(envPtr).bindRedeclare(keyHash, newTypeHash, valExprId, isFinal == 1, isEach == 1);
  }
}

export function flattener_envBindPath(flattenerPtr: u32, envPtr: u32, pathId: u32, valExprId: u32, isFinal: u32, isEach: u32): void {
  if (flattenerPtr != 0 && envPtr != 0) {
    let flattener = changetype<ModelicaFlattener>(flattenerPtr);
    let pool = flattener.dae.getStringPool();
    changetype<ModificationEnvironment>(envPtr).bindPath(pool, pathId, valExprId, isFinal == 1, isEach == 1);
  }
}

export function flattener_envBindRedeclarePath(flattenerPtr: u32, envPtr: u32, pathId: u32, newTypeHash: u32, valExprId: u32, isFinal: u32, isEach: u32): void {
  if (flattenerPtr != 0 && envPtr != 0) {
    let flattener = changetype<ModelicaFlattener>(flattenerPtr);
    let pool = flattener.dae.getStringPool();
    changetype<ModificationEnvironment>(envPtr).bindRedeclarePath(pool, pathId, newTypeHash, valExprId, isFinal == 1, isEach == 1);
  }
}

export function flattener_envLookup(envPtr: u32, keyHash: u32): u32 {
  if (envPtr == 0) return 0xffffffff;
  return changetype<ModificationEnvironment>(envPtr).lookup(keyHash);
}

export function flattener_envLookupNested(envPtr: u32, keyHash: u32): u32 {
  if (envPtr == 0) return 0;
  return changetype<ModificationEnvironment>(envPtr).lookupNested(keyHash);
}

export function flattener_envLookupRedeclare(envPtr: u32, keyHash: u32): u32 {
  if (envPtr == 0) return 0;
  return changetype<ModificationEnvironment>(envPtr).lookupRedeclare(keyHash);
}

export function flattener_envLookupFlags(envPtr: u32, keyHash: u32): u32 {
  if (envPtr == 0) return 0;
  return changetype<ModificationEnvironment>(envPtr).lookupFlags(keyHash);
}

export function flattener_envLookupPath(flattenerPtr: u32, envPtr: u32, pathId: u32): u32 {
  if (flattenerPtr == 0 || envPtr == 0) return 0xffffffff;
  let flattener = changetype<ModelicaFlattener>(flattenerPtr);
  let pool = flattener.dae.getStringPool();
  return changetype<ModificationEnvironment>(envPtr).lookupPath(pool, pathId);
}

export function flattener_envLookupNestedPath(flattenerPtr: u32, envPtr: u32, pathId: u32): u32 {
  if (flattenerPtr == 0 || envPtr == 0) return 0;
  let flattener = changetype<ModelicaFlattener>(flattenerPtr);
  let pool = flattener.dae.getStringPool();
  return changetype<ModificationEnvironment>(envPtr).lookupNestedPath(pool, pathId);
}

export function flattener_envLookupRedeclarePath(flattenerPtr: u32, envPtr: u32, pathId: u32): u32 {
  if (flattenerPtr == 0 || envPtr == 0) return 0;
  let flattener = changetype<ModelicaFlattener>(flattenerPtr);
  let pool = flattener.dae.getStringPool();
  return changetype<ModificationEnvironment>(envPtr).lookupRedeclarePath(pool, pathId);
}

export function flattener_envLookupWithEach(envPtr: u32, baseNameHash: u32, elementKeyHash: u32): u32 {
  if (envPtr == 0) return 0xffffffff;
  return changetype<ModificationEnvironment>(envPtr).lookupWithEach(baseNameHash, elementKeyHash);
}

export function flattener_envLookupNestedWithEach(envPtr: u32, baseNameHash: u32, elementKeyHash: u32): u32 {
  if (envPtr == 0) return 0;
  return changetype<ModificationEnvironment>(envPtr).lookupNestedWithEach(baseNameHash, elementKeyHash);
}

export function flattener_envMerge(targetEnvPtr: u32, otherEnvPtr: u32): void {
  if (targetEnvPtr != 0 && otherEnvPtr != 0) {
    changetype<ModificationEnvironment>(targetEnvPtr).merge(otherEnvPtr);
  }
}

export function flattener_scopePush(flattenerPtr: u32, scopeId: u32, envPtr: u32, prefixPathId: u32, flags: u32): void {
  if (flattenerPtr != 0) {
    changetype<ModelicaFlattener>(flattenerPtr).scopeStack.push(scopeId, envPtr, prefixPathId, flags);
  }
}

export function flattener_scopePop(flattenerPtr: u32): void {
  if (flattenerPtr != 0) {
    changetype<ModelicaFlattener>(flattenerPtr).scopeStack.pop();
  }
}

export function flattener_scopeCurrentScope(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).scopeStack.currentScopeId;
}

export function flattener_scopeCurrentEnv(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).scopeStack.currentEnvPtr;
}

export function flattener_scopeCurrentPrefix(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).scopeStack.currentPrefixPathId;
}

export function flattener_scopeLookup(flattenerPtr: u32, keyHash: u32): u32 {
  if (flattenerPtr == 0) return 0xffffffff;
  return changetype<ModelicaFlattener>(flattenerPtr).scopeStack.lookup(keyHash);
}

export function flattener_scopeLookupNested(flattenerPtr: u32, keyHash: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).scopeStack.lookupNested(keyHash);
}

export function flattener_scopeLookupRedeclare(flattenerPtr: u32, keyHash: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).scopeStack.lookupRedeclare(keyHash);
}

export function flattener_scopeLookupFlags(flattenerPtr: u32, keyHash: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).scopeStack.lookupFlags(keyHash);
}

export function flattener_instantiateClass(flattenerPtr: u32, classNodePtr: u32, prefixPathId: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).instantiateClass(classNodePtr, prefixPathId);
}

export function flattener_lowerAllClassEquations(flattenerPtr: u32, classNodePtr: u32, prefixPathId: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).lowerAllClassEquations(classNodePtr, prefixPathId);
}

export function flattener_flatten(flattenerPtr: u32, rootClassNodePtr: u32, programRootNodePtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).flatten(rootClassNodePtr, programRootNodePtr);
}

export function flattener_getErrorCode(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).errorCode;
}

/** Start byte of the CST node that triggered the bail-out (0xffffffff if unknown). */
export function flattener_getErrorStartByte(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0xffffffff;
  return changetype<ModelicaFlattener>(flattenerPtr).errorStartByte;
}

/** End byte of the CST node that triggered the bail-out (0xffffffff if unknown). */
export function flattener_getErrorEndByte(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0xffffffff;
  return changetype<ModelicaFlattener>(flattenerPtr).errorEndByte;
}

export function flattener_getAlgorithmSectionCount(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).algSectionCount;
}

export function flattener_getAlgorithmSectionStart(flattenerPtr: u32, index: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).algSections.get(index * 3);
}

export function flattener_getAlgorithmSectionLength(flattenerPtr: u32, index: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).algSections.get(index * 3 + 1);
}

export function flattener_getAlgorithmSectionIsInitial(flattenerPtr: u32, index: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).algSections.get(index * 3 + 2);
}

export function flattener_getExpandableBusCount(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).expandableBusCount;
}

export function flattener_getExpandableBus(flattenerPtr: u32, index: u32): u32 {
  if (flattenerPtr == 0) return 0;
  let flattener = changetype<ModelicaFlattener>(flattenerPtr);
  if (index >= flattener.expandableBusCount) return 0;
  return flattener.expandableBuses.get(index);
}

export function flattener_getDisabledCount(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).disabledCount;
}

export function flattener_getWhenRecordCount(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).whenRecordCount;
}

export function flattener_getWhenRecordLength(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).whenRecords.length;
}

export function flattener_getWhenRecordData(flattenerPtr: u32, idx: u32): i32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).whenRecords.get(idx);
}

export function flattener_getIfRecordCount(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).ifRecordCount;
}

export function flattener_getIfRecordLength(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).ifRecords.length;
}

export function flattener_getIfRecordData(flattenerPtr: u32, idx: u32): i32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).ifRecords.get(idx);
}

export function flattener_registerScopeResolution(flattenerPtr: u32, scopeClassNodePtr: u32, nameId: u32, targetClassNodePtr: u32, targetOffset: u32): void {
  if (flattenerPtr == 0) return;
  changetype<ModelicaFlattener>(flattenerPtr).registerScopeResolution(scopeClassNodePtr, nameId, targetClassNodePtr, targetOffset);
}

export function flattener_clearScopeResolutions(flattenerPtr: u32): void {
  if (flattenerPtr == 0) return;
  changetype<ModelicaFlattener>(flattenerPtr).clearScopeResolutions();
}

export function flattener_registerEnumLiteral(flattenerPtr: u32, nameId: u32, ordinal: u32, fullPathId: u32): void {
  if (flattenerPtr == 0) return;
  changetype<ModelicaFlattener>(flattenerPtr).registerEnumLiteral(nameId, ordinal, fullPathId);
}

export function flattener_clearEnumLiterals(flattenerPtr: u32): void {
  if (flattenerPtr == 0) return;
  changetype<ModelicaFlattener>(flattenerPtr).clearEnumLiterals();
}

export function flattener_setOmcCompatibility(flattenerPtr: u32, omc: u32): void {
  if (flattenerPtr == 0) return;
  changetype<ModelicaFlattener>(flattenerPtr).isOmcCompatibility = (omc != 0);
  g_isOmcNewInst = (omc == 2);
}

export function flattener_getArrayCount(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).arrayCount;
}

export function flattener_getArrayName(flattenerPtr: u32, idx: u32): u32 {
  if (flattenerPtr == 0) return 0;
  let f = changetype<ModelicaFlattener>(flattenerPtr);
  if (idx >= f.arrayCount) return 0;
  return f.arrayNames.get(idx);
}

export function flattener_getArrayDim1(flattenerPtr: u32, idx: u32): u32 {
  if (flattenerPtr == 0) return 0;
  let f = changetype<ModelicaFlattener>(flattenerPtr);
  if (idx >= f.arrayCount) return 0;
  return f.arrayDim1.get(idx);
}

export function flattener_getArrayDim2(flattenerPtr: u32, idx: u32): u32 {
  if (flattenerPtr == 0) return 0;
  let f = changetype<ModelicaFlattener>(flattenerPtr);
  if (idx >= f.arrayCount) return 0;
  return f.arrayDim2.get(idx);
}

export function flattener_getArrayDim3(flattenerPtr: u32, idx: u32): u32 {
  if (flattenerPtr == 0) return 0;
  let f = changetype<ModelicaFlattener>(flattenerPtr);
  if (idx >= f.arrayCount) return 0;
  return f.arrayDim3.get(idx);
}

export function flattener_getArrayDim4(flattenerPtr: u32, idx: u32): u32 {
  if (flattenerPtr == 0) return 0;
  let f = changetype<ModelicaFlattener>(flattenerPtr);
  if (idx >= f.arrayCount) return 0;
  return f.arrayDim4.get(idx);
}

export function flattener_getArrayDim(flattenerPtr: u32, idx: u32, dim: u32): u32 {
  if (flattenerPtr == 0) return 0;
  let f = changetype<ModelicaFlattener>(flattenerPtr);
  if (idx >= f.arrayCount) return 0;
  if (dim == 1) return f.arrayDim1.get(idx);
  if (dim == 2) return f.arrayDim2.get(idx);
  if (dim == 3) return f.arrayDim3.get(idx);
  if (dim == 4) return f.arrayDim4.get(idx);
  return 0;
}

export function flattener_getArrayNDims(flattenerPtr: u32, idx: u32): u32 {
  if (flattenerPtr == 0) return 0;
  let f = changetype<ModelicaFlattener>(flattenerPtr);
  if (idx >= f.arrayCount) return 0;
  return f.arrayNDims.get(idx);
}

export function flattener_getInnerRegCount(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).innerRegCount;
}

export function flattener_getOuterMapCount(flattenerPtr: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).outerMapCount;
}

export function flattener_getOuterPath(flattenerPtr: u32, idx: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).outerPaths.get(idx);
}

export function flattener_getTargetInnerPath(flattenerPtr: u32, idx: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).targetInnerPaths.get(idx);
}

export function flattener_getInnerName(flattenerPtr: u32, idx: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).innerNames.get(idx);
}

export function flattener_getInnerScope(flattenerPtr: u32, idx: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).innerScopePrefixes.get(idx);
}

export function flattener_getInnerFullPath(flattenerPtr: u32, idx: u32): u32 {
  if (flattenerPtr == 0) return 0;
  return changetype<ModelicaFlattener>(flattenerPtr).innerFullPaths.get(idx);
}



