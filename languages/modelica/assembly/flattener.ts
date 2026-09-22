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
import { UnmanagedMap64, createMap64, UnmanagedSet64, createSet64 } from "./hashmap";
import { ArenaStringPool } from "./string_pool";
import { SyntaxType, FieldId } from "./types";

export const FLAG_MOD_FINAL: u32 = 0x01;
export const FLAG_MOD_EACH: u32 = 0x02;
export const FLAG_MOD_REDECLARE: u32 = 0x04;
export const FLAG_MOD_REPLACEABLE: u32 = 0x08;

export const SIZEOF_MOD_ENV: u32 = 64;
export const SIZEOF_SCOPE_STACK: u32 = 64;
export const SIZEOF_EXPR_VISITOR: u32 = 64;
export const SIZEOF_FLATTENER: u32 = 256;

function parseIntBytes(src: usize, len: u32): i32 {
  if (len == 0 || src == 0) return 0;
  let text = SourceTextView.at(src, len);
  let charCount = text.charCount;
  let res: i32 = 0;
  for (let i: u32 = 0; i < charCount; i++) {
    let b = text.charAt(i);
    if (b >= 48 && b <= 57) {
      res = res * 10 + ((b - 48) as i32);
    }
  }
  return res;
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
  let intPart: f64 = 0.0;
  while (i < charCount) {
    let b = text.charAt(i);
    if (b >= 48 && b <= 57) {
      intPart = intPart * 10.0 + ((b - 48) as f64);
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
          fracPart = fracPart * 10.0 + ((fb - 48) as f64);
          fracDiv *= 10.0;
          i++;
        } else {
          break;
        }
      }
    }
  }
  let val = sign * (intPart + (fracDiv > 1.0 ? fracPart / fracDiv : 0.0));
  if (i < charCount) {
    let b = text.charAt(i);
    if (b == 101 || b == 69) { // 'e' | 'E'
      i++;
      let expSign: f64 = 1.0;
      if (i < charCount) {
        let eb = text.charAt(i);
        if (eb == 45) {
          expSign = -1.0;
          i++;
        } else if (eb == 43) {
          i++;
        }
      }
      let expVal: f64 = 0.0;
      while (i < charCount) {
        let eb = text.charAt(i);
        if (eb >= 48 && eb <= 57) {
          expVal = expVal * 10.0 + ((eb - 48) as f64);
          i++;
        } else {
          break;
        }
      }
      val *= Math.pow(10.0, expSign * expVal);
    }
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
  if (len >= 2 && load<u8>(bytes + 1) == 0) {
    return pool.internUtf16(bytes, len);
  }
  return pool.intern(bytes, len);
}

@inline
export function locMatches(loc: u64, str: string): boolean {
  return bytesMatch(locBytes(loc), locLen(loc), str);
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
  let tempStart = pool.charOffset;
  for (let i: u32 = 0; i < baseLen; i++) {
    pool.charBuffer.set(tempStart + i, pool.charBuffer.get(baseStart + i));
  }
  let curr = tempStart + baseLen;
  pool.charBuffer.set(curr++, 91); // '['
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
  let tempStart = pool.charOffset;
  for (let i: u32 = 0; i < baseLen; i++) {
    pool.charBuffer.set(tempStart + i, pool.charBuffer.get(baseStart + i));
  }
  let curr = tempStart + baseLen;
  pool.charBuffer.set(curr++, 91); // '['
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
  let tempStart = pool.charOffset;
  for (let i: u32 = 0; i < baseLen; i++) {
    pool.charBuffer.set(tempStart + i, pool.charBuffer.get(baseStart + i));
  }
  let curr = tempStart + baseLen;
  pool.charBuffer.set(curr++, 91); // '['
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
  let count: u32 = 0;
  for (let v: f64 = startVal; stepVal > 0.0 ? (v <= stopVal + 1e-9) : (v >= stopVal - 1e-9); v += stepVal) {
    let elemId = isReal ? dae.addRealLiteral(v) : dae.addIntLiteral(Math.round(v) as i32);
    tempBuffer.push(elemId);
    count++;
    if (count > 10000) {
      tempBuffer.length = elemStart;
      return 0xffffffff;
    }
  }
  let elemCount = tempBuffer.length - elemStart;
  if (elemCount == 0) {
    tempBuffer.length = elemStart;
    return 0xffffffff;
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

function findCompositionLoc(loc: u64, maxDepth: i32 = 30): u64 {
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

function findClassDefinitionLoc(rootLoc: u64, targetNameId: u32, pool: ArenaStringPool, maxDepth: i32 = 30): u64 {
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

function findClassByPtr(rootLoc: u64, targetPtr: u32, maxDepth: i32 = 30): u64 {
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

export var g_lastParsedDim3: u32 = 0;

function parseArrayDimensionsLoc(subscriptsLoc: u64): u64 {
  g_lastParsedDim3 = 0;
  if (locIsNull(subscriptsLoc)) return 0;
  let src = locBytes(subscriptsLoc);
  let len = locLen(subscriptsLoc);
  if (len < 2 || src == 0) return 0;

  let text = SourceTextView.at(src, len);
  let charCount = text.charCount;

  let d1: u32 = 0;
  let d2: u32 = 0;
  let d3: u32 = 0;
  let commaCount: u32 = 0;
  let parenDepth: i32 = 0;
  let currentVal: i32 = 0;
  let hasDigit = false;

  for (let i: u32 = 0; i < charCount; i++) {
    let b = text.charAt(i);
    if (b == 40) { // '('
      parenDepth++;
    } else if (b == 41) { // ')'
      if (parenDepth > 0) parenDepth--;
    } else if (parenDepth == 0) {
      if (b >= 48 && b <= 57) { // '0'..'9'
        currentVal = currentVal * 10 + ((b - 48) as i32);
        hasDigit = true;
      } else if (b == 44) { // ','
        if (hasDigit && currentVal > 0) {
          if (commaCount == 0) d1 = currentVal as u32;
          else if (commaCount == 1) d2 = currentVal as u32;
          else if (commaCount == 2) d3 = currentVal as u32;
        }
        commaCount++;
        currentVal = 0;
        hasDigit = false;
      }
    }
  }
  if (hasDigit && currentVal > 0) {
    if (commaCount == 0) d1 = currentVal as u32;
    else if (commaCount == 1) d2 = currentVal as u32;
    else if (commaCount == 2) d3 = currentVal as u32;
  }
  let totalDims = commaCount + 1;
  if (totalDims > 3) {
    return 0xffffffffffffffff;
  }
  g_lastParsedDim3 = d3;
  return ((d1 as u64) << 32) | (d2 as u64);
}

function parseRangePart(dae: DaeBuilder, pool: ArenaStringPool, text: SourceTextView, startChar: u32, endChar: u32): i32 {
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
  if (startChar >= endChar) return 0;

  let isDigits = true;
  let s = startChar;
  let first = text.charAt(s);
  if (first == 43 || first == 45) s++; // '+' or '-'
  for (let i = s; i < endChar; i++) {
    let b = text.charAt(i);
    if (b < 48 || b > 57) { isDigits = false; break; }
  }
  if (isDigits && s < endChar) {
    let partBytes = text.byteOffset(startChar);
    let partLen = text.byteLength(endChar - startChar);
    return parseIntBytes(partBytes, partLen);
  }

  let partBytes = text.byteOffset(startChar);
  let partLen = text.byteLength(endChar - startChar);
  let nameId = text.isUtf16 ? pool.internUtf16(partBytes, partLen) : pool.intern(partBytes, partLen);
  let vIdx = dae.lookupVariableByName(nameId);
  if (vIdx >= 0) {
    let val = dae.getVarStartValue(vIdx as u32);
    return val as i32;
  }
  return 0;
}

function parseForIndexRange(fiLoc: u64, dae: DaeBuilder, pool: ArenaStringPool, outVals: ChunkedInt32Array): u32 {
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
  if (!inFound) return 0;

  let varNameId: u32 = 0;
  let idDesc = locFindDescendant(fiLoc, SyntaxType.IDENTIFIER);
  if (locIsNull(idDesc)) idDesc = locFindDescendant(fiLoc, SyntaxType.TOKEN_IDENTIFIER_ALT);
  if (locIsNull(idDesc)) idDesc = locFindDescendant(fiLoc, SyntaxType.NAME);
  if (!locIsNull(idDesc)) {
    varNameId = locIntern(pool, idDesc);
  } else {
    let varStart: u32 = 0;
    let varEnd = inPos - 2;
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
    startVal = parseRangePart(dae, pool, text, inPos, colon1);
    stepVal = 1;
    endVal = parseRangePart(dae, pool, text, colon1 + 1, charCount);
  } else if (colonCount >= 2) {
    startVal = parseRangePart(dae, pool, text, inPos, colon1);
    stepVal = parseRangePart(dae, pool, text, colon1 + 1, colon2);
    endVal = parseRangePart(dae, pool, text, colon2 + 1, charCount);
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
    if (t == SyntaxType.CLASS_MODIFICATION) {
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
  if (locType(modLoc) == SyntaxType.CLASS_MODIFICATION) return modLoc;
  return locFindDescendant(modLoc, SyntaxType.CLASS_MODIFICATION);
}

function populateEnvRecursive(env: ModificationEnvironment, modLoc: u64, pool: ArenaStringPool, exprVisitor: WasmExprVisitor): void {
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

      if (!locIsNull(nameCur)) {
        let keyNameId = locIntern(pool, nameCur);
        let exprLoc = locFindDescendant(ch, SyntaxType.MODIFICATION_EXPRESSION);
        if (locIsNull(exprLoc)) exprLoc = locFindDescendant(ch, SyntaxType.EXPRESSION);
        if (!locIsNull(exprLoc)) {
          let valExprId = exprVisitor.visitLoc(exprLoc);
          if (valExprId != 0xffffffff) {
            env.bindPath(pool, keyNameId, valExprId, false, false);
          }
        }
      }
      ch = locNextSibling(ch);
      continue;
    }
    populateEnvRecursive(env, ch, pool, exprVisitor);
    ch = locNextSibling(ch);
  }
}

function populateEnvFromClassModLoc(envPtr: u32, modLoc: u64, pool: ArenaStringPool, exprVisitor: WasmExprVisitor): void {
  if (envPtr == 0 || locIsNull(modLoc)) return;
  let env = changetype<ModificationEnvironment>(envPtr);
  populateEnvRecursive(env, modLoc, pool, exprVisitor);
}

function extractModUnit(modLoc: u64, exprVisitor: WasmExprVisitor): u32 {
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
      if (!locIsNull(nameCur) && locMatches(nameCur, "unit")) {
        let exprLoc = locFindDescendant(ch, SyntaxType.MODIFICATION_EXPRESSION);
        if (locIsNull(exprLoc)) exprLoc = locFindDescendant(ch, SyntaxType.EXPRESSION);
        if (!locIsNull(exprLoc)) {
          let uid = exprVisitor.visitLoc(exprLoc);
          if (uid != 0xffffffff) return uid;
        }
      }
      ch = locNextSibling(ch);
      continue;
    }
    let sub = extractModUnit(ch, exprVisitor);
    if (sub != 0xffffffff) return sub;
    ch = locNextSibling(ch);
  }
  return 0xffffffff;
}

// Backward compatibility wrappers for CstCursor
function findCompositionNode(node: CstCursor): CstCursor {
  return CstCursor.wrap(locPtr(findCompositionLoc(node.toLoc())));
}
function getClassNameId(pool: ArenaStringPool, classNode: CstCursor): u32 {
  return getClassNameIdLoc(pool, classNode.toLoc());
}
function findClassDefinition(root: CstCursor, targetNameId: u32, pool: ArenaStringPool): CstCursor {
  return CstCursor.wrap(locPtr(findClassDefinitionLoc(root.toLoc(), targetNameId, pool)));
}
function parseArrayDimensions(subscriptsNode: CstCursor): u64 {
  return parseArrayDimensionsLoc(subscriptsNode.toLoc());
}
function findBindingExpression(modNode: CstCursor): CstCursor {
  return CstCursor.wrap(locPtr(findBindingExpressionLoc(modNode.toLoc())));
}
function findClassModification(modNode: CstCursor): CstCursor {
  return CstCursor.wrap(locPtr(findClassModificationLoc(modNode.toLoc())));
}
function populateEnvFromClassMod(envPtr: u32, modCur: CstCursor, pool: ArenaStringPool, exprVisitor: WasmExprVisitor): void {
  populateEnvFromClassModLoc(envPtr, modCur.toLoc(), pool, exprVisitor);
}


/**
 * Modification and Parameter Binding Environment in Linear Memory.
 */
@unmanaged
export class ModificationEnvironment {
  keyHashes: ChunkedUint32Array;
  valExprIds: ChunkedUint32Array;
  childEnvPtrs: ChunkedUint32Array;
  redeclareTypeHashes: ChunkedUint32Array;
  flags: ChunkedUint32Array;
  count: u32;
  parentEnvPtr: u32;

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
      if (this.keyHashes.get(i) == keyHash) {
        let existingFlags = this.flags.get(i);
        if ((existingFlags & FLAG_MOD_FINAL) != 0 && !isFinal) {
          return;
        }
        this.valExprIds.set(i, valExprId);
        this.flags.set(i, f | (existingFlags & FLAG_MOD_FINAL));
        return;
      }
    }

    let idx = this.count++;
    this.keyHashes.set(idx, keyHash);
    this.valExprIds.set(idx, valExprId);
    this.childEnvPtrs.set(idx, 0);
    this.redeclareTypeHashes.set(idx, 0);
    this.flags.set(idx, f);
  }

  bindNested(keyHash: u32, childEnvPtr: u32, isFinal: boolean = false, isEach: boolean = false): void {
    let f: u32 = 0;
    if (isFinal) f |= FLAG_MOD_FINAL;
    if (isEach) f |= FLAG_MOD_EACH;

    for (let i: u32 = 0; i < this.count; i++) {
      if (this.keyHashes.get(i) == keyHash) {
        let existingFlags = this.flags.get(i);
        if ((existingFlags & FLAG_MOD_FINAL) != 0 && !isFinal) {
          return;
        }
        this.childEnvPtrs.set(i, childEnvPtr);
        this.flags.set(i, f | (existingFlags & FLAG_MOD_FINAL));
        return;
      }
    }

    let idx = this.count++;
    this.keyHashes.set(idx, keyHash);
    this.valExprIds.set(idx, 0);
    this.childEnvPtrs.set(idx, childEnvPtr);
    this.redeclareTypeHashes.set(idx, 0);
    this.flags.set(idx, f);
  }

  bindRedeclare(keyHash: u32, newTypeHash: u32, valExprId: u32 = 0, isFinal: boolean = false, isEach: boolean = false): void {
    let f: u32 = FLAG_MOD_REDECLARE;
    if (isFinal) f |= FLAG_MOD_FINAL;
    if (isEach) f |= FLAG_MOD_EACH;

    for (let i: u32 = 0; i < this.count; i++) {
      if (this.keyHashes.get(i) == keyHash) {
        let existingFlags = this.flags.get(i);
        if ((existingFlags & FLAG_MOD_FINAL) != 0 && !isFinal) {
          return;
        }
        this.redeclareTypeHashes.set(i, newTypeHash);
        this.valExprIds.set(i, valExprId);
        this.flags.set(i, f | (existingFlags & FLAG_MOD_FINAL));
        return;
      }
    }

    let idx = this.count++;
    this.keyHashes.set(idx, keyHash);
    this.valExprIds.set(idx, valExprId);
    this.childEnvPtrs.set(idx, 0);
    this.redeclareTypeHashes.set(idx, newTypeHash);
    this.flags.set(idx, f);
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
      childPtr = atomicChunkAlloc(SIZEOF_MOD_ENV);
      changetype<ModificationEnvironment>(childPtr).init(changetype<usize>(this) as u32);
      this.bindNested(headId, childPtr, isFinal, isEach);
    }
    changetype<ModificationEnvironment>(childPtr).bindPath(pool, tailId, valExprId, isFinal, isEach);
  }

  bindRedeclarePath(pool: ArenaStringPool, pathId: u32, newTypeHash: u32, valExprId: u32 = 0, isFinal: boolean = false, isEach: boolean = false): void {
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
      childPtr = atomicChunkAlloc(SIZEOF_MOD_ENV);
      changetype<ModificationEnvironment>(childPtr).init(changetype<usize>(this) as u32);
      this.bindNested(headId, childPtr, isFinal, isEach);
    }
    changetype<ModificationEnvironment>(childPtr).bindRedeclarePath(pool, tailId, newTypeHash, valExprId, isFinal, isEach);
  }

  lookup(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      if (this.keyHashes.get(i) == keyHash) {
        return this.valExprIds.get(i);
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookup(keyHash);
    }
    return 0xffffffff;
  }

  lookupNested(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      if (this.keyHashes.get(i) == keyHash) {
        return this.childEnvPtrs.get(i);
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupNested(keyHash);
    }
    return 0;
  }

  lookupRedeclare(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      if (this.keyHashes.get(i) == keyHash) {
        return this.redeclareTypeHashes.get(i);
      }
    }
    if (this.parentEnvPtr != 0) {
      return changetype<ModificationEnvironment>(this.parentEnvPtr).lookupRedeclare(keyHash);
    }
    return 0;
  }

  lookupFlags(keyHash: u32): u32 {
    for (let i: i32 = this.count - 1; i >= 0; i--) {
      if (this.keyHashes.get(i) == keyHash) {
        return this.flags.get(i);
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
      let key = other.keyHashes.get(i);
      let existingFlags = this.lookupFlags(key);
      if ((existingFlags & FLAG_MOD_FINAL) != 0) {
        continue;
      }
      let val = other.valExprIds.get(i);
      let child = other.childEnvPtrs.get(i);
      let redecl = other.redeclareTypeHashes.get(i);
      let f = other.flags.get(i);

      let existingChild = this.lookupNested(key);
      if (existingChild != 0 && child != 0) {
        changetype<ModificationEnvironment>(existingChild).merge(child);
        continue;
      }

      let found = false;
      for (let j: u32 = 0; j < this.count; j++) {
        if (this.keyHashes.get(j) == key) {
          if (val != 0xffffffff && val != 0) this.valExprIds.set(j, val);
          if (child != 0) this.childEnvPtrs.set(j, child);
          if (redecl != 0) this.redeclareTypeHashes.set(j, redecl);
          this.flags.set(j, f | existingFlags);
          found = true;
          break;
        }
      }
      if (!found) {
        let idx = this.count++;
        this.keyHashes.set(idx, key);
        this.valExprIds.set(idx, val);
        this.childEnvPtrs.set(idx, child);
        this.redeclareTypeHashes.set(idx, redecl);
        this.flags.set(idx, f);
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

  @inline get dae(): DaeBuilder {
    return changetype<DaeBuilder>(this.daePtr);
  }

  @inline get loopVars(): UnmanagedMap64 {
    return changetype<UnmanagedMap64>(this.loopVarsPtr);
  }

  @inline get tempBuffer(): ChunkedUint32Array {
    return changetype<ChunkedUint32Array>(this.tempBufferPtr);
  }

  init(dae: DaeBuilder, prefixHash: u32 = 0, envPtr: u32 = 0, scopeStackPtr: u32 = 0): void {
    this.daePtr = changetype<usize>(dae) as u32;
    this.prefixHash = prefixHash;
    this.loopVarsPtr = createMap64(64);
    this.envPtr = envPtr;
    this.scopeStackPtr = scopeStackPtr;
    this.tempBufferPtr = changetype<usize>(createChunkedUint32Array(64)) as u32;
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
      let nameId = this.dae.getExprData1(exprId);
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
          poolMatchesSimple(pool, fnId, "zeros")) {
        return true;
      }
    }
    return false;
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
      let firstElem = this.castToReal(getArrayCtorElement(this.dae, exprId, 0));
      let ctorId = this.dae.addExpression(ExprKind.ArrayCtor, count, firstElem, 0xffffffff);
      for (let i: u32 = 1; i < count; i++) {
        let elem = this.castToReal(getArrayCtorElement(this.dae, exprId, i));
        this.dae.addExpression(ExprKind.Tuple, 0, elem, 0);
      }
      return ctorId;
    }
    if (kind == ExprKind.IfElse) {
      let cond = this.dae.getExprData1(exprId);
      let thenExpr = this.castToReal(this.dae.getExprLeft(exprId));
      let elseExpr = this.castToReal(this.dae.getExprRight(exprId));
      return this.dae.addIfElse(cond, thenExpr, elseExpr);
    }
    return exprId;
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

    // Vector broadcasting: ArrayCtor with ArrayCtor or scalar with ArrayCtor
    if (kLeft == ExprKind.ArrayCtor && kRight == ExprKind.ArrayCtor) {
      let countLeft = this.dae.getExprData1(left);
      let countRight = this.dae.getExprData1(right);
      if (countLeft == countRight && countLeft > 0) {
        let firstElem = this.lowerBinary(baseOp, getArrayCtorElement(this.dae, left, 0), getArrayCtorElement(this.dae, right, 0));
        let ctorId = this.dae.addExpression(ExprKind.ArrayCtor, countLeft, firstElem, 0xffffffff);
        for (let i: u32 = 1; i < countLeft; i++) {
          let elem = this.lowerBinary(baseOp, getArrayCtorElement(this.dae, left, i), getArrayCtorElement(this.dae, right, i));
          this.dae.addExpression(ExprKind.Tuple, 0, elem, 0);
        }
        return ctorId;
      }
    } else if (kLeft == ExprKind.ArrayCtor && kRight != ExprKind.ArrayCtor) {
      let countLeft = this.dae.getExprData1(left);
      if (countLeft > 0) {
        let firstElem = this.lowerBinary(baseOp, getArrayCtorElement(this.dae, left, 0), right);
        let ctorId = this.dae.addExpression(ExprKind.ArrayCtor, countLeft, firstElem, 0xffffffff);
        for (let i: u32 = 1; i < countLeft; i++) {
          let elem = this.lowerBinary(baseOp, getArrayCtorElement(this.dae, left, i), right);
          this.dae.addExpression(ExprKind.Tuple, 0, elem, 0);
        }
        return ctorId;
      }
    } else if (kLeft != ExprKind.ArrayCtor && kRight == ExprKind.ArrayCtor) {
      let countRight = this.dae.getExprData1(right);
      if (countRight > 0) {
        let firstElem = this.lowerBinary(baseOp, left, getArrayCtorElement(this.dae, right, 0));
        let ctorId = this.dae.addExpression(ExprKind.ArrayCtor, countRight, firstElem, 0xffffffff);
        for (let i: u32 = 1; i < countRight; i++) {
          let elem = this.lowerBinary(baseOp, left, getArrayCtorElement(this.dae, right, i));
          this.dae.addExpression(ExprKind.Tuple, 0, elem, 0);
        }
        return ctorId;
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
    if (k == ExprKind.ArrayCtor && op == (UnaryOp.Negate as u16)) {
      let count = this.dae.getExprData1(operand);
      if (count > 0) {
        let firstElem = this.lowerUnary(op, getArrayCtorElement(this.dae, operand, 0));
        let ctorId = this.dae.addExpression(ExprKind.ArrayCtor, count, firstElem, 0xffffffff);
        for (let i: u32 = 1; i < count; i++) {
          let elem = this.lowerUnary(op, getArrayCtorElement(this.dae, operand, i));
          this.dae.addExpression(ExprKind.Tuple, 0, elem, 0);
        }
        return ctorId;
      }
    }
    return this.dae.addExpression(ExprKind.Unary, op as u32, operand);
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
          let rowStart = this.tempBuffer.length;
          this.collectRowElements(ch, this.tempBuffer);
          let rowCount = this.tempBuffer.length - rowStart;
          if (rowCount == 1) {
            let singleEid = this.tempBuffer.get(rowStart);
            if (this.dae.getExprKind(singleEid) == ExprKind.ArrayCtor) {
              let eCount = getArrayCtorCount(this.dae, singleEid);
              let is1D = true;
              if (eCount > 0 && this.dae.getExprKind(getArrayCtorElement(this.dae, singleEid, 0)) == ExprKind.ArrayCtor) {
                is1D = false;
              }
              if (is1D) {
                let hasSemicolon = false;
                let sib = locNextSibling(ch);
                while (!locIsNull(sib)) {
                  if (locMatches(sib, ";")) { hasSemicolon = true; break; }
                  sib = locNextSibling(sib);
                }
                if (!hasSemicolon && rowsAdded == 0) {
                  this.tempBuffer.length = rowStart;
                  for (let i: u32 = 0; i < eCount; i++) {
                    let elem = getArrayCtorElement(this.dae, singleEid, i);
                    let rStart = this.tempBuffer.length;
                    this.tempBuffer.push(elem);
                    let rowCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, rStart, 1);
                    this.tempBuffer.length = rStart;
                    rowOut.push(rowCtorId);
                    rowsAdded++;
                  }
                  ch = locNextSibling(ch);
                  continue;
                }
              }
            }
          }
          if (rowCount > 0) {
            let hasReal = false;
            for (let i: u32 = 0; i < rowCount; i++) {
              if (this.isRealExpr(this.tempBuffer.get(rowStart + i))) {
                hasReal = true;
                break;
              }
            }
            if (hasReal) {
              for (let i: u32 = 0; i < rowCount; i++) {
                let eid = this.tempBuffer.get(rowStart + i);
                if (!this.isRealExpr(eid)) {
                  this.tempBuffer.set(rowStart + i, this.castToReal(eid));
                }
              }
            }
            let rowCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, rowStart, rowCount);
            this.tempBuffer.length = rowStart;
            rowOut.push(rowCtorId);
            rowsAdded++;
          }
        } else if (ct == SyntaxType.EXPRESSION) {
          let eid = this.visitLoc(ch);
          if (eid != 0xffffffff) {
            let pool = this.dae.getStringPool();
            eid = resolveVarToArrayCtor(this.dae, pool, eid, this.tempBuffer);
            if (this.dae.getExprKind(eid) == ExprKind.ArrayCtor) {
              let eCount = getArrayCtorCount(this.dae, eid);
              let is1D = true;
              if (eCount > 0 && this.dae.getExprKind(getArrayCtorElement(this.dae, eid, 0)) == ExprKind.ArrayCtor) {
                is1D = false;
              }
              if (is1D) {
                for (let i: u32 = 0; i < eCount; i++) {
                  let elem = getArrayCtorElement(this.dae, eid, i);
                  let rStart = this.tempBuffer.length;
                  this.tempBuffer.push(elem);
                  let rowCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, rStart, 1);
                  this.tempBuffer.length = rStart;
                  rowOut.push(rowCtorId);
                }
                ch = locNextSibling(ch);
                continue;
              }
            }
            let rowStart = this.tempBuffer.length;
            this.tempBuffer.push(eid);
            let rowCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, rowStart, 1);
            this.tempBuffer.length = rowStart;
            rowOut.push(rowCtorId);
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
            for (let i: u32 = 1; i < leafCount; i++) {
              let elem = this.tempBuffer.get(leafStart + i);
              let kAcc = this.dae.getExprKind(acc);
              let kElem = this.dae.getExprKind(elem);
              if ((kAcc == ExprKind.RealLiteral || kAcc == ExprKind.IntLiteral) &&
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
          if (!this.isRealExpr(acc)) acc = this.castToReal(acc);
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

    // 4. Structural builtins: size, zeros, ones, fill
    if (poolMatchesSimple(pool, fnNameId, "size") && argCount >= 1) {
      let arrId = this.tempBuffer.get(argStart);
      let dim: u32 = 1;
      if (argCount >= 2) {
        let dimArg = this.tempBuffer.get(argStart + 1);
        if (this.dae.getExprKind(dimArg) == ExprKind.IntLiteral) {
          dim = this.dae.getExprData1(dimArg);
        }
      }
      if (this.dae.getExprKind(arrId) == ExprKind.ArrayCtor) {
        if (dim == 1) {
          return this.dae.addIntLiteral(this.dae.getExprData1(arrId) as i32);
        } else if (dim == 2) {
          let firstElem = getArrayCtorElement(this.dae, arrId, 0);
          if (this.dae.getExprKind(firstElem) == ExprKind.ArrayCtor) {
            return this.dae.addIntLiteral(this.dae.getExprData1(firstElem) as i32);
          }
        }
      } else if (this.dae.getExprKind(arrId) == ExprKind.Name) {
        let nameId = this.dae.getExprData1(arrId);
        let vIdx = this.dae.lookupVariableByName(nameId);
        if (vIdx >= 0) {
          let s = this.dae.getVarShapeDim(vIdx as u32, dim - 1);
          if (s > 0) return this.dae.addIntLiteral(s);
        }
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
            let matCtorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, zStart, d1);
            this.tempBuffer.length = zStart;
            return matCtorId;
          }
        }
      }
    }

    if (poolMatchesSimple(pool, fnNameId, "ones") && argCount >= 1) {
      let a0 = this.tempBuffer.get(argStart);
      if (this.dae.getExprKind(a0) == ExprKind.IntLiteral) {
        let d1 = this.dae.getExprData1(a0) as u32;
        if (argCount == 1) {
          let oStart = this.tempBuffer.length;
          let oneLit = this.dae.addIntLiteral(1);
          for (let i: u32 = 0; i < d1; i++) this.tempBuffer.push(oneLit);
          let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, oStart, d1);
          this.tempBuffer.length = oStart;
          return ctorId;
        }
      }
    }

    if (poolMatchesSimple(pool, fnNameId, "fill") && argCount >= 2) {
      let valId = this.tempBuffer.get(argStart);
      let a1 = this.tempBuffer.get(argStart + 1);
      if (this.dae.getExprKind(a1) == ExprKind.IntLiteral) {
        let d1 = this.dae.getExprData1(a1) as u32;
        let fStart = this.tempBuffer.length;
        for (let i: u32 = 0; i < d1; i++) this.tempBuffer.push(valId);
        let ctorId = addArrayCtorFromChunked(this.dae, this.tempBuffer, fStart, d1);
        this.tempBuffer.length = fStart;
        return ctorId;
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
      if (!this.isRealExpr(acc)) acc = this.castToReal(acc);
    } else if (isProd) {
      for (let i: u32 = 1; i < elemCount; i++) {
        acc = this.lowerBinary(BinOp.Mul as u16, acc, this.tempBuffer.get(elemStart + i));
      }
      if (!this.isRealExpr(acc)) acc = this.castToReal(acc);
    } else {
      this.tempBuffer.length = elemStart;
      return 0xffffffff;
    }

    this.tempBuffer.length = elemStart;
    return acc;
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
          t == SyntaxType.TRUE || t == SyntaxType.FALSE || t == SyntaxType.TIME) {
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
        if (this.dae.getExprKind(condId) == ExprKind.BoolLiteral) {
          let condVal = this.dae.getExprData1(condId);
          if (condVal != 0) {
            currElseId = thenId;
          }
          continue;
        }
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
    let callArgsLoc = locFindDescendant(loc, SyntaxType.FUNCTION_CALL_ARGS);
    if (!locIsNull(callArgsLoc)) {
      if (locIsNull(firstCh) || (locType(firstCh) != SyntaxType.DER && !locMatches(firstCh, "der"))) {
        let compRef = locFindDescendant(loc, SyntaxType.COMPONENT_REFERENCE);
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
        this.tempBuffer.length = argStart;
        if (resCall != 0xffffffff) return resCall;
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
      let subLoc = locFindDescendant(loc, SyntaxType.ARRAY_SUBSCRIPTS);
      if (!locIsNull(subLoc)) {
        let baseIdNode = locFirstNonEmptyChild(loc);
        if (locIsNull(baseIdNode)) baseIdNode = loc;
        let baseNameId = locIntern(pool, baseIdNode);
        
        let firstSub = locFindDescendant(subLoc, SyntaxType.SUBSCRIPT);
        if (locIsNull(firstSub)) firstSub = locFirstChild(subLoc);
        
        let subExprLoc1 = locFindDescendant(firstSub, SyntaxType.EXPRESSION);
        if (locIsNull(subExprLoc1)) subExprLoc1 = firstSub;
        let subVal1 = locParseInt(subExprLoc1);
        if (subVal1 <= 0) {
          let sid1 = this.visitLoc(subExprLoc1);
          if (sid1 != 0xffffffff && this.dae.getExprKind(sid1) == ExprKind.IntLiteral) {
            subVal1 = this.dae.getExprData1(sid1) as i32;
          }
        }
        
        let secondSub = locNextNonEmptySibling(firstSub);
        while (!locIsNull(secondSub) && locType(secondSub) != SyntaxType.SUBSCRIPT && !locMatches(secondSub, ",")) {
          let found = locFindDescendant(secondSub, SyntaxType.SUBSCRIPT);
          if (!locIsNull(found)) { secondSub = found; break; }
          secondSub = locNextNonEmptySibling(secondSub);
        }
        if (!locIsNull(secondSub) && locMatches(secondSub, ",")) {
          secondSub = locNextNonEmptySibling(secondSub);
        }
        let subVal2: i32 = 0;
        if (!locIsNull(secondSub)) {
          let subExprLoc2 = locFindDescendant(secondSub, SyntaxType.EXPRESSION);
          if (locIsNull(subExprLoc2)) subExprLoc2 = secondSub;
          subVal2 = locParseInt(subExprLoc2);
          if (subVal2 <= 0) {
            let sid2 = this.visitLoc(subExprLoc2);
            if (sid2 != 0xffffffff && this.dae.getExprKind(sid2) == ExprKind.IntLiteral) {
              subVal2 = this.dae.getExprData1(sid2) as i32;
            }
          }
        }

        let thirdSub = !locIsNull(secondSub) ? locNextNonEmptySibling(secondSub) : 0;
        while (!locIsNull(thirdSub) && locType(thirdSub) != SyntaxType.SUBSCRIPT && !locMatches(thirdSub, ",")) {
          let found = locFindDescendant(thirdSub, SyntaxType.SUBSCRIPT);
          if (!locIsNull(found)) { thirdSub = found; break; }
          thirdSub = locNextNonEmptySibling(thirdSub);
        }
        if (!locIsNull(thirdSub) && locMatches(thirdSub, ",")) {
          thirdSub = locNextNonEmptySibling(thirdSub);
        }
        let subVal3: i32 = 0;
        if (!locIsNull(thirdSub)) {
          let subExprLoc3 = locFindDescendant(thirdSub, SyntaxType.EXPRESSION);
          if (locIsNull(subExprLoc3)) subExprLoc3 = thirdSub;
          subVal3 = locParseInt(subExprLoc3);
          if (subVal3 <= 0) {
            let sid3 = this.visitLoc(subExprLoc3);
            if (sid3 != 0xffffffff && this.dae.getExprKind(sid3) == ExprKind.IntLiteral) {
              subVal3 = this.dae.getExprData1(sid3) as i32;
            }
          }
        }
        
        if (subVal1 > 0 && subVal2 > 0 && subVal3 > 0) {
          let indexedNameId = concatArrayIndex3D(pool, baseNameId, subVal1 as u32, subVal2 as u32, subVal3 as u32);
          return this.dae.addExpression(ExprKind.Name, indexedNameId);
        } else if (subVal1 > 0 && subVal2 > 0) {
          let indexedNameId = concatArrayIndex2D(pool, baseNameId, subVal1 as u32, subVal2 as u32);
          return this.dae.addExpression(ExprKind.Name, indexedNameId);
        } else if (subVal1 > 0 && subVal2 <= 0) {
          let indexedNameId = concatArrayIndex1D(pool, baseNameId, subVal1 as u32);
          return this.dae.addExpression(ExprKind.Name, indexedNameId);
        }
      }

      let nameId = locIntern(pool, loc);
      let loopVal = this.getLoopVar(nameId);
      if (loopVal != 0xffffffff) return loopVal;
      if (this.envPtr != 0) {
        let modExpr = changetype<ModificationEnvironment>(this.envPtr).lookupPath(pool, nameId);
        if (modExpr != 0xffffffff) return modExpr;
      }
      if (this.scopeStackPtr != 0) {
        let modExpr = changetype<ScopeStack>(this.scopeStackPtr).lookup(nameId);
        if (modExpr != 0xffffffff) return modExpr;

        let prefixId = changetype<ScopeStack>(this.scopeStackPtr).currentPrefixPathId;
        if (prefixId != 0) {
          let prefixedId = pool.concatIds(prefixId, nameId);
          if (this.dae.lookupVariableByName(prefixedId) >= 0) {
            return this.dae.addExpression(ExprKind.Name, prefixedId);
          }
        }
      }
      return this.dae.addExpression(ExprKind.Name, nameId);
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
              let expId = expandColonToArrayCtor(this.dae, rangeId, this.tempBuffer);
              return expId != 0xffffffff ? expId : rangeId;
            }
          }
          let rangeId = this.dae.addExpression(ExprKind.Range, left, 0xffffffff, right);
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
        if (this.dae.getExprKind(operand) == ExprKind.Binary && this.dae.getExprData1(operand) == (BinOp.Mul as u32)) {
          let a = this.dae.getExprLeft(operand);
          let b = this.dae.getExprRight(operand);
          let negA = this.lowerUnary(UnaryOp.Negate as u16, a);
          return this.lowerBinary(BinOp.Mul as u16, negA, b);
        }
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
      let argChild = locFindDescendant(loc, SyntaxType.COMPONENT_REFERENCE);
      if (locIsNull(argChild)) argChild = locFindDescendant(loc, SyntaxType.EXPRESSION);
      if (!locIsNull(argChild)) {
        let argExpr = this.visitLoc(argChild);
        if (argExpr != 0xffffffff) {
          return this.dae.addDer(argExpr);
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

/**
 * Modelica & Physical Semantic Flattening Engine in WebAssembly.
 */
@unmanaged
export class ModelicaFlattener {
  daePtr: u32;
  exprVisitorPtr: u32;

  // Connection Graph Tracking: [var1, var2, isFlow, isBoundary] stride = 4
  connectionPairs: ChunkedUint32Array;
  connectionCount: u32;

  // Stream Connections: [h1, mdot1, h2, mdot2] stride = 4
  streamPairs: ChunkedUint32Array;
  streamCount: u32;

  // Union-Find Disjoint Set across connected components
  ufParent: ChunkedUint32Array;
  ufRank: ChunkedUint32Array;

  // Inner/Outer Resolution Map: [nameHash -> varId]
  innerKeys: ChunkedUint32Array;
  innerVars: ChunkedUint32Array;
  innerCount: u32;

  // Connector Cardinality: [varId -> connection count]
  cardinalityMap: ChunkedUint32Array;

  // Lexical Scope Stack
  scopeStackPtr: u32;

  // Root Program/Tree Node Pointer for resolving cross-class references
  rootProgramNodePtr: u32;
  rootProgramLoc: u64;

  // Flattening error flag
  hasError: boolean;
  errorCode: u32;

  @inline setError(code: u32): void {
    this.hasError = true;
    this.errorCode = code;
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
    this.hasError = false;
    this.errorCode = 0;
    let ssPtr = atomicChunkAlloc(SIZEOF_SCOPE_STACK);
    this.scopeStackPtr = ssPtr as u32;
    this.scopeStack.init();

    let evPtr = atomicChunkAlloc(SIZEOF_EXPR_VISITOR);
    this.exprVisitorPtr = evPtr as u32;
    this.exprVisitor.init(dae, 0, 0, this.scopeStackPtr);

    this.connectionPairs = createChunkedUint32Array(1024 * 4);
    this.connectionCount = 0;
    this.streamPairs = createChunkedUint32Array(512 * 4);
    this.streamCount = 0;

    this.innerKeys = createChunkedUint32Array(256);
    this.innerVars = createChunkedUint32Array(256);
    this.innerCount = 0;

    let maxVars = dae.varCount > 2048 ? dae.varCount + 512 : 2048;
    this.ufParent = createChunkedUint32Array(maxVars);
    this.ufRank = createChunkedUint32Array(maxVars);
    this.cardinalityMap = createChunkedUint32Array(maxVars);
    for (let i: u32 = 0; i < maxVars; i++) {
      this.ufParent.set(i, i);
      this.ufRank.set(i, 0);
      this.cardinalityMap.set(i, 0);
    }
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

  getCardinality(varId: u32): u32 {
    if (varId >= this.cardinalityMap.length) return 0;
    return this.cardinalityMap.get(varId);
  }

  ensureUfCapacity(varId: u32): void {
    let currLen = this.ufParent.length;
    if (varId >= currLen) {
      let newLen = varId + 256;
      for (let i = currLen; i < newLen; i++) {
        this.ufParent.set(i, i);
        this.ufRank.set(i, 0);
        this.cardinalityMap.set(i, 0);
      }
    }
  }

  findRoot(v: u32): u32 {
    this.ensureUfCapacity(v);
    let p = this.ufParent.get(v);
    if (p == v) return v;
    let root = this.findRoot(p);
    this.ufParent.set(v, root);
    return root;
  }

  unionSets(v1: u32, v2: u32): void {
    this.ensureUfCapacity(v1);
    this.ensureUfCapacity(v2);
    let r1 = this.findRoot(v1);
    let r2 = this.findRoot(v2);
    if (r1 == r2) return;
    let rank1 = this.ufRank.get(r1);
    let rank2 = this.ufRank.get(r2);
    if (rank1 < rank2) {
      this.ufParent.set(r1, r2);
    } else if (rank1 > rank2) {
      this.ufParent.set(r2, r1);
    } else {
      this.ufParent.set(r2, r1);
      this.ufRank.set(r1, rank1 + 1);
    }
  }

  addConnection(p1VarId: u32, p2VarId: u32, isFlow: boolean, isBoundary: boolean = false): u32 {
    let idx = this.connectionCount++;
    let offset = idx * 4;

    this.connectionPairs.set(offset + 0, p1VarId);
    this.connectionPairs.set(offset + 1, p2VarId);
    this.connectionPairs.set(offset + 2, isFlow ? 1 : 0);
    this.connectionPairs.set(offset + 3, isBoundary ? 1 : 0);

    this.ensureUfCapacity(p1VarId);
    this.ensureUfCapacity(p2VarId);
    this.cardinalityMap.set(p1VarId, this.cardinalityMap.get(p1VarId) + 1);
    this.cardinalityMap.set(p2VarId, this.cardinalityMap.get(p2VarId) + 1);

    this.unionSets(p1VarId, p2VarId);
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
    this.ufParent.set(newVarId, newVarId);
    this.ufRank.set(newVarId, 0);
    return newVarId;
  }

  @inline isVarStream(varIdx: u32): boolean {
    if (varIdx >= this.dae.varCount) return false;
    return (this.dae.getVarData().get(varIdx * VAR_STRIDE + VAR_FLAGS) & FLAG_VAR_STREAM) != 0;
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
      let root = this.findRoot(v);
      let prevHead = head.get(root);
      next.set(v, prevHead);
      head.set(root, v as i32);
      groupSize.set(root, groupSize.get(root) + 1);
    }

    let generatedEqs: u32 = 0;
    let zeroExpr = this.dae.addRealLiteral(0.0);

    for (let r: u32 = 0; r < varCount; r++) {
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
      let offset = i * EQ_STRIDE;
      let kind = this.dae.getEqData().get(offset + EQ_KIND);
      if (kind == (EqKind.Connect as i32)) {
        let lhsExpr = this.dae.getEqData().get(offset + EQ_LHS) as u32;
        let rhsExpr = this.dae.getEqData().get(offset + EQ_RHS) as u32;
        if (lhsExpr < this.dae.exprCount && rhsExpr < this.dae.exprCount) {
          let lhsKind = this.dae.getExprData().get(lhsExpr * EXPR_STRIDE + EXPR_KIND);
          let rhsKind = this.dae.getExprData().get(rhsExpr * EXPR_STRIDE + EXPR_KIND);
          if (lhsKind == (ExprKind.Name as i32) && rhsKind == (ExprKind.Name as i32)) {
            let fromNameId = this.dae.getExprData().get(lhsExpr * EXPR_STRIDE + EXPR_DATA1) as u32;
            let toNameId = this.dae.getExprData().get(rhsExpr * EXPR_STRIDE + EXPR_DATA1) as u32;

            let fromExact = this.dae.lookupVariableByName(fromNameId);
            let toExact = this.dae.lookupVariableByName(toNameId);
            if (fromExact >= 0 && toExact >= 0) {
              this.ensureUfCapacity(fromExact as u32);
              this.ensureUfCapacity(toExact as u32);
              this.unionSets(fromExact as u32, toExact as u32);
              this.cardinalityMap.set(fromExact as u32, this.cardinalityMap.get(fromExact as u32) + 1);
              this.cardinalityMap.set(toExact as u32, this.cardinalityMap.get(toExact as u32) + 1);
            } else {
              for (let v: u32 = 0; v < varCount; v++) {
                let vNameId = this.dae.getVarNameId(v);
                if (pool.hasPrefix(vNameId, fromNameId)) {
                  let suffId = pool.getSuffixAfterPrefix(vNameId, fromNameId);
                  if (suffId != 0) {
                    let targetNameId = pool.concatIds(toNameId, suffId);
                    let toVar = this.dae.lookupVariableByName(targetNameId);
                    if (toVar >= 0) {
                      this.ensureUfCapacity(v);
                      this.ensureUfCapacity(toVar as u32);
                      this.unionSets(v, toVar as u32);
                      this.cardinalityMap.set(v, this.cardinalityMap.get(v) + 1);
                      this.cardinalityMap.set(toVar as u32, this.cardinalityMap.get(toVar as u32) + 1);
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
    if (locIsNull(sectionLoc)) return 0;
    let eqCountBefore = this.dae.eqCount;
    let firstCh = locFirstNonEmptyChild(sectionLoc);
    if (!locIsNull(firstCh) && (locMatches(firstCh, "initial") || locType(firstCh) == 60)) {
      isInitial = true;
    }
    this.lowerEquationsUnderSection(sectionLoc, isInitial);
    return this.dae.eqCount - eqCountBefore;
  }

  lowerEquationsUnderSection(parentLoc: u64, isInitial: boolean): void {
    let ch = locFirstChild(parentLoc);
    while (!locIsNull(ch)) {
      if (this.hasError) return;
      let t = locType(ch);
      if (t == SyntaxType.SIMPLE_EQUATION) {
        this.lowerSimpleEquation(ch, isInitial);
        if (this.hasError) return;
      } else if (t == SyntaxType.CONNECT_EQUATION) {
        this.lowerConnectEquation(ch);
        if (this.hasError) return;
      } else if (t == SyntaxType.WHEN_EQUATION || t == SyntaxType.FOR_EQUATION || t == SyntaxType.IF_EQUATION || t == SyntaxType.FUNCTION_CALL) {
        this.setError(3290);
        return;
      } else if (t != SyntaxType.CLASS_DEFINITION) {
        // Recurse into wrapper nodes
        this.lowerEquationsUnderSection(ch, isInitial);
        if (this.hasError) return;
      }
      ch = locNextSibling(ch);
    }
  }

  lowerSimpleEquation(eqLoc: u64, isInitial: boolean): u32 {
    let lhsLoc: u64 = 0;
    let rhsLoc: u64 = 0;
    let ch = locFirstChild(eqLoc);
    while (!locIsNull(ch)) {
      if (locLen(ch) > 0) {
        if (lhsLoc == 0) {
          lhsLoc = ch;
        } else if (locMatches(ch, "=")) {
          // skip '='
        } else if (rhsLoc == 0) {
          rhsLoc = ch;
        }
      }
      ch = locNextSibling(ch);
    }
    if (locIsNull(lhsLoc) || locIsNull(rhsLoc)) {
      lhsLoc = locChild(eqLoc, 0);
      rhsLoc = locChild(eqLoc, 2);
      if (locIsNull(rhsLoc)) rhsLoc = locChild(eqLoc, 1);
    }
    if (locIsNull(lhsLoc) || locIsNull(rhsLoc)) {
      this.setError(3323);
      return 0;
    }

    let lhsExpr = this.exprVisitor.visitLoc(lhsLoc);
    let rhsExpr = this.exprVisitor.visitLoc(rhsLoc);
    if (lhsExpr == 0xffffffff || rhsExpr == 0xffffffff) {
      this.setError(3330);
      return 0;
    }
    let pool = this.dae.getStringPool();
    lhsExpr = resolveVarToArrayCtor(this.dae, pool, lhsExpr, this.exprVisitor.tempBuffer);
    rhsExpr = resolveVarToArrayCtor(this.dae, pool, rhsExpr, this.exprVisitor.tempBuffer);

    return this.emitExpandedEquation(lhsExpr, rhsExpr, isInitial);
  }

  emitExpandedEquation(lhs: u32, rhs: u32, isInitial: boolean): u32 {
    let lKind = this.dae.getExprKind(lhs);
    let rKind = this.dae.getExprKind(rhs);

    if (lKind == ExprKind.ArrayCtor && rKind == ExprKind.ArrayCtor) {
      let lCount = getArrayCtorCount(this.dae, lhs);
      let rCount = getArrayCtorCount(this.dae, rhs);
      if (lCount != rCount || lCount == 0) {
        this.setError(3348);
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
      this.setError(3363);
      return 0;
    }

    if (lKind == ExprKind.Name) {
      let lNameId = this.dae.getExprData1(lhs);
      if (this.dae.lookupVariableByName(lNameId) == -1) {
        this.setError(3370);
        return 0;
      }
    }
    if (rKind == ExprKind.Name) {
      let rNameId = this.dae.getExprData1(rhs);
      if (this.dae.lookupVariableByName(rNameId) == -1) {
        this.setError(3377);
        return 0;
      }
    }

    let isLhsLit = (lKind == ExprKind.IntLiteral || lKind == ExprKind.RealLiteral || lKind == ExprKind.BoolLiteral);
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

  lowerConnectEquation(eqLoc: u64): u32 {
    let c1 = locFindDescendant(eqLoc, SyntaxType.COMPONENT_REFERENCE);
    if (locIsNull(c1)) c1 = locFindDescendant(eqLoc, SyntaxType.NAME);
    let c2: u64 = 0;
    if (!locIsNull(c1)) {
      let next = locNextSibling(c1);
      while (!locIsNull(next)) {
        if (locType(next) == SyntaxType.COMPONENT_REFERENCE || locType(next) == SyntaxType.NAME) {
          c2 = next;
          break;
        }
        let found = locFindDescendant(next, SyntaxType.COMPONENT_REFERENCE);
        if (!locIsNull(found)) { c2 = found; break; }
        next = locNextSibling(next);
      }
    }
    if (locIsNull(c1) || locIsNull(c2)) return 0;

    let e1 = this.exprVisitor.visitLoc(c1);
    let e2 = this.exprVisitor.visitLoc(c2);
    if (e1 == 0xffffffff || e2 == 0xffffffff) {
      this.setError(3425);
      return 0;
    }

    this.dae.addEquation(EqKind.Connect, e1, e2);
    return 1;
  }

  instantiateClass(classNodePtr: u32, prefixPathId: u32): u32 {
    return this.instantiateClassLoc(locMakeRoot(classNodePtr), prefixPathId);
  }

  instantiateClassLoc(classLoc: u64, prefixPathId: u32): u32 {
    if (locIsNull(classLoc)) return 0;
    let pool = this.dae.getStringPool();
    let compLoc = findCompositionLoc(classLoc);
    if (locIsNull(compLoc)) return 0;

    let varCountBefore = this.dae.varCount;
    this.instantiateCompositionElements(compLoc, prefixPathId, pool);
    return this.dae.varCount - varCountBefore;
  }

  instantiateCompositionElements(parentLoc: u64, prefixPathId: u32, pool: ArenaStringPool): u32 {
    let ch = locFirstChild(parentLoc);
    let count: u32 = 0;
    while (!locIsNull(ch)) {
      if (this.hasError) return 0;
      count += this.instantiateCompositionElement(ch, prefixPathId, pool);
      if (this.hasError) return 0;
      ch = locNextSibling(ch);
    }
    return count;
  }

  instantiateCompositionElement(elementLoc: u64, prefixPathId: u32, pool: ArenaStringPool, maxDepth: i32 = 30): u32 {
    if (locIsNull(elementLoc) || maxDepth <= 0) return 0;
    if (this.hasError) return 0;
    let t = locType(elementLoc);

    if (t == SyntaxType.COMPONENT_CLAUSE || t == SyntaxType.COMPONENT_CLAUSE1) {
      return this.instantiateComponentClause(elementLoc, prefixPathId, pool);
    }

    if (t == SyntaxType.EXTENDS_CLAUSE) {
      return this.instantiateExtendsClause(elementLoc, prefixPathId, pool);
    }

    if (t == SyntaxType.ALGORITHM_SECTION) {
      this.setError(3474);
      return 0;
    }

    if (t != SyntaxType.CLASS_DEFINITION && t != SyntaxType.EQUATION_SECTION) {
      let sub = locFirstChild(elementLoc);
      let count: u32 = 0;
      while (!locIsNull(sub)) {
        count += this.instantiateCompositionElement(sub, prefixPathId, pool, maxDepth - 1);
        if (this.hasError) return 0;
        sub = locNextSibling(sub);
      }
      return count;
    }

    return 0;
  }

  instantiateExtendsClause(extLoc: u64, prefixPathId: u32, pool: ArenaStringPool): u32 {
    let baseNameNode = locFindDescendant(extLoc, SyntaxType.TYPE_SPECIFIER);
    if (locIsNull(baseNameNode)) baseNameNode = locFindDescendant(extLoc, SyntaxType.NAME);
    if (!locIsNull(baseNameNode)) {
      let baseNameId = locIntern(pool, baseNameNode);
      let baseClassLoc = findClassDefinitionLoc(this.rootProgramLoc, baseNameId, pool);
      if (!locIsNull(baseClassLoc)) {
        let extEnvPtr: u32 = 0;
        let extModCur = locFindDescendant(extLoc, SyntaxType.CLASS_MODIFICATION);
        if (!locIsNull(extModCur)) {
          extEnvPtr = flattener_envCreate(this.scopeStack.currentEnvPtr);
          populateEnvFromClassModLoc(extEnvPtr, extModCur, pool, this.exprVisitor);
        }
        this.scopeStack.push(0, extEnvPtr, prefixPathId, 0);
        let added = this.instantiateClassLoc(baseClassLoc, prefixPathId);
        this.scopeStack.pop();
        return added;
      }
    }
    return 0;
  }

  instantiateComponentClause(clauseLoc: u64, prefixPathId: u32, pool: ArenaStringPool): u32 {
    let typePrefixLoc = locFindDescendant(clauseLoc, SyntaxType.TYPE_PREFIX);
    let typeSpecLoc = locFindDescendant(clauseLoc, SyntaxType.TYPE_SPECIFIER);
    let clauseSubscriptsLoc = locFindDescendant(clauseLoc, SyntaxType.ARRAY_SUBSCRIPTS);

    let varType: i32 = VarType.Real;
    let variability: i32 = Variability.Continuous;
    let causality: i32 = Causality.Local;
    let varFlags: i32 = 0;

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

    if (!locIsNull(typeSpecLoc)) {
      let idLoc = locFindDescendant(typeSpecLoc, SyntaxType.IDENTIFIER);
      if (locIsNull(idLoc)) idLoc = locFindDescendant(typeSpecLoc, SyntaxType.TOKEN_IDENTIFIER_ALT);
      if (locIsNull(idLoc)) idLoc = locFindDescendant(typeSpecLoc, SyntaxType.NAME);
      if (locIsNull(idLoc)) idLoc = typeSpecLoc;
      typeNameId = locIntern(pool, idLoc);

      if (locMatches(idLoc, "Real")) {
        varType = VarType.Real;
        isPrimitive = true;
      } else if (locMatches(idLoc, "Integer")) {
        varType = VarType.Integer;
        isPrimitive = true;
      } else if (locMatches(idLoc, "Boolean")) {
        varType = VarType.Boolean;
        isPrimitive = true;
      } else if (locMatches(idLoc, "String")) {
        varType = VarType.String;
        isPrimitive = true;
      } else {
        // Resolve type alias / short class definition (e.g. type Angle = Real(unit="rad"))
        let defLoc = findClassDefinitionLoc(this.rootProgramLoc, typeNameId, pool);
        if (!locIsNull(defLoc)) {
          let shortSpec = locFindDescendant(defLoc, SyntaxType.SHORT_CLASS_SPECIFIER);
          if (!locIsNull(shortSpec)) {
            let baseTypeSpec = locFindDescendant(shortSpec, SyntaxType.TYPE_SPECIFIER);
            if (!locIsNull(baseTypeSpec)) {
              let baseIdLoc = locFindDescendant(baseTypeSpec, SyntaxType.IDENTIFIER);
              if (locIsNull(baseIdLoc)) baseIdLoc = locFindDescendant(baseTypeSpec, SyntaxType.TOKEN_IDENTIFIER_ALT);
              if (locIsNull(baseIdLoc)) baseIdLoc = locFindDescendant(baseTypeSpec, SyntaxType.NAME);
              if (locIsNull(baseIdLoc)) baseIdLoc = baseTypeSpec;
              if (locMatches(baseIdLoc, "Real")) {
                varType = VarType.Real;
                isPrimitive = true;
              } else if (locMatches(baseIdLoc, "Integer")) {
                varType = VarType.Integer;
                isPrimitive = true;
              } else if (locMatches(baseIdLoc, "Boolean")) {
                varType = VarType.Boolean;
                isPrimitive = true;
              } else if (locMatches(baseIdLoc, "String")) {
                varType = VarType.String;
                isPrimitive = true;
              }
            }
            let classModLoc = locFindDescendant(shortSpec, SyntaxType.CLASS_MODIFICATION);
            if (!locIsNull(classModLoc)) {
              let uid = extractModUnit(classModLoc, this.exprVisitor);
              if (uid != 0xffffffff) subtypeUnitId = uid;
            }
          }
        }
      }
    }

    let clauseDims = parseArrayDimensionsLoc(clauseSubscriptsLoc);
    if (clauseDims == 0xffffffffffffffff) {
      this.setError(3570);
      return 0;
    }
    let clauseDim1 = (clauseDims >> 32) as u32;
    let clauseDim2 = (clauseDims & 0xffffffff) as u32;
    let clauseDim3 = g_lastParsedDim3;

    return this.instantiateDeclarationsUnder(clauseLoc, isPrimitive, varType, variability, causality, varFlags, typeNameId, clauseDim1, clauseDim2, clauseDim3, prefixPathId, pool, subtypeUnitId);
  }

  instantiateDeclarationsUnder(parentLoc: u64, isPrimitive: boolean, varType: i32, variability: i32, causality: i32, varFlags: i32, typeNameId: u32, clauseDim1: u32, clauseDim2: u32, clauseDim3: u32, prefixPathId: u32, pool: ArenaStringPool, subtypeUnitId: u32 = 0xffffffff): u32 {
    let ch = locFirstChild(parentLoc);
    let count: u32 = 0;
    while (!locIsNull(ch)) {
      if (this.hasError) return 0;
      let t = locType(ch);
      if (t == SyntaxType.DECLARATION) {
        count += this.instantiateDeclaration(ch, isPrimitive, varType, variability, causality, varFlags, typeNameId, clauseDim1, clauseDim2, clauseDim3, prefixPathId, pool, subtypeUnitId);
        if (this.hasError) return 0;
      } else if (t != SyntaxType.TYPE_SPECIFIER && t != SyntaxType.TYPE_PREFIX) {
        count += this.instantiateDeclarationsUnder(ch, isPrimitive, varType, variability, causality, varFlags, typeNameId, clauseDim1, clauseDim2, clauseDim3, prefixPathId, pool, subtypeUnitId);
        if (this.hasError) return 0;
      }
      ch = locNextSibling(ch);
    }
    return count;
  }

  instantiateDeclaration(declLoc: u64, isPrimitive: boolean, varType: i32, variability: i32, causality: i32, varFlags: i32, typeNameId: u32, clauseDim1: u32, clauseDim2: u32, clauseDim3: u32, prefixPathId: u32, pool: ArenaStringPool, subtypeUnitId: u32 = 0xffffffff): u32 {
    let idLoc = locFirstNonEmptyChild(declLoc);
    if (locIsNull(idLoc)) return 0;
    let innerId = locFindDescendant(idLoc, SyntaxType.IDENTIFIER);
    if (!locIsNull(innerId)) idLoc = innerId;

    let compNameId = locIntern(pool, idLoc);
    let fullVarNameId = prefixPathId != 0 ? pool.concatIds(prefixPathId, compNameId) : compNameId;

    let declSubscripts = locFindDescendant(declLoc, SyntaxType.ARRAY_SUBSCRIPTS);
    let declDims = parseArrayDimensionsLoc(declSubscripts);
    if (declDims == 0xffffffffffffffff) {
      this.setError(3609);
      return 0;
    }
    let dim1 = (declDims >> 32) as u32;
    let dim2 = (declDims & 0xffffffff) as u32;
    let dim3 = g_lastParsedDim3;
    if (dim1 == 0 && clauseDim1 > 0) {
      dim1 = clauseDim1;
      dim2 = clauseDim2;
      dim3 = clauseDim3;
    }

    let modLoc = locFindDescendant(declLoc, SyntaxType.MODIFICATION);
    let valExprId: u32 = 0xffffffff;
    let bExprLoc = findBindingExpressionLoc(modLoc);
    if (!locIsNull(bExprLoc)) {
      valExprId = this.exprVisitor.visitLoc(bExprLoc);
      if (valExprId == 0xffffffff) {
        this.setError(3625);
        return 0;
      }
      if (varType == VarType.Integer && this.exprVisitor.isRealExpr(valExprId)) {
        this.setError(3629);
        return 0;
      }
      if (varType == VarType.Real && !this.exprVisitor.isRealExpr(valExprId)) {
        valExprId = this.exprVisitor.castToReal(valExprId);
      }
    }

    let declModLoc = findClassModificationLoc(modLoc);
    if (!locIsNull(declModLoc)) {
      let declUnitId = extractModUnit(declModLoc, this.exprVisitor);
      if (declUnitId != 0xffffffff) {
        subtypeUnitId = declUnitId;
      }
    }

    if (this.scopeStackPtr != 0) {
      let modOverride = changetype<ScopeStack>(this.scopeStackPtr).lookup(compNameId);
      if (modOverride == 0xffffffff && prefixPathId != 0) {
        modOverride = changetype<ScopeStack>(this.scopeStackPtr).lookupPath(pool, fullVarNameId);
      }
      if (modOverride != 0xffffffff) {
        valExprId = modOverride;
        if (varType == VarType.Integer && this.exprVisitor.isRealExpr(valExprId)) {
          this.setError(3645);
          return 0;
        }
        if (varType == VarType.Real && !this.exprVisitor.isRealExpr(valExprId)) {
          valExprId = this.exprVisitor.castToReal(valExprId);
        }
      }
    }

    // Dimension deduction: if dim1 == 0 (e.g. unsized x[:]) and valExprId is ArrayCtor, infer dim1
    if (dim1 == 0 && valExprId != 0xffffffff && this.dae.getExprKind(valExprId) == ExprKind.ArrayCtor) {
      dim1 = this.dae.getExprData1(valExprId);
    }

    let startVal: f64 = 0.0;
    if (valExprId != 0xffffffff) {
      let ek = this.dae.getExprKind(valExprId);
      if (ek == (ExprKind.RealLiteral as i32)) {
        startVal = this.dae.getExprRealValue(valExprId);
      } else if (ek == (ExprKind.IntLiteral as i32)) {
        startVal = this.dae.getExprData().get(valExprId * EXPR_STRIDE + EXPR_DATA1) as f64;
      }
    }

    let count: u32 = 0;
    if (isPrimitive) {
      if (dim1 > 0 && dim2 == 0 && dim3 == 0) {
        let isArrayCtor = valExprId != 0xffffffff && this.dae.getExprKind(valExprId) == ExprKind.ArrayCtor;
        let ctorCount = isArrayCtor ? getArrayCtorCount(this.dae, valExprId) : 0;
        for (let i: u32 = 1; i <= dim1; i++) {
          let elemNameId = concatArrayIndex1D(pool, fullVarNameId, i);
          let elemExprId = isArrayCtor && (i - 1) < ctorCount
            ? getArrayCtorElement(this.dae, valExprId, i - 1)
            : valExprId;
          let isParamOrConst = variability == (Variability.Parameter as i32) || variability == (Variability.Constant as i32);
          let elemStartVal: f64 = 0.0;
          if (elemExprId != 0xffffffff && isParamOrConst) {
            let ek = this.dae.getExprKind(elemExprId);
            if (ek == (ExprKind.RealLiteral as i32)) {
              elemStartVal = this.dae.getExprRealValue(elemExprId);
            } else if (ek == (ExprKind.IntLiteral as i32)) {
              elemStartVal = this.dae.getExprData().get(elemExprId * EXPR_STRIDE + EXPR_DATA1) as f64;
            }
          }
          let elemVarIdx = this.dae.addVariable(elemNameId, varType, variability, causality, elemStartVal, varFlags);
          if (elemExprId != 0xffffffff && isParamOrConst) {
            this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Start as u32, elemExprId);
          }
          if (subtypeUnitId != 0xffffffff) {
            this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Unit as u32, subtypeUnitId);
          }
          count++;
        }
      } else if (dim1 > 0 && dim2 > 0 && dim3 == 0) {
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
            let isParamOrConst = variability == (Variability.Parameter as i32) || variability == (Variability.Constant as i32);
            let elemStartVal: f64 = 0.0;
            if (elemExprId != 0xffffffff && isParamOrConst) {
              let ek = this.dae.getExprKind(elemExprId);
              if (ek == (ExprKind.RealLiteral as i32)) {
                elemStartVal = this.dae.getExprRealValue(elemExprId);
              } else if (ek == (ExprKind.IntLiteral as i32)) {
                elemStartVal = this.dae.getExprData().get(elemExprId * EXPR_STRIDE + EXPR_DATA1) as f64;
              }
            }
            let elemVarIdx = this.dae.addVariable(elemNameId, varType, variability, causality, elemStartVal, varFlags);
            if (elemExprId != 0xffffffff && isParamOrConst) {
              this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Start as u32, elemExprId);
            }
            if (subtypeUnitId != 0xffffffff) {
              this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Unit as u32, subtypeUnitId);
            }
            count++;
          }
        }
      } else if (dim1 > 0 && dim2 > 0 && dim3 > 0) {
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
              let isParamOrConst = variability == (Variability.Parameter as i32) || variability == (Variability.Constant as i32);
              let elemStartVal: f64 = 0.0;
              if (elemExprId != 0xffffffff && isParamOrConst) {
                let ek = this.dae.getExprKind(elemExprId);
                if (ek == (ExprKind.RealLiteral as i32)) {
                  elemStartVal = this.dae.getExprRealValue(elemExprId);
                } else if (ek == (ExprKind.IntLiteral as i32)) {
                  elemStartVal = this.dae.getExprData().get(elemExprId * EXPR_STRIDE + EXPR_DATA1) as f64;
                }
              }
              let elemVarIdx = this.dae.addVariable(elemNameId, varType, variability, causality, elemStartVal, varFlags);
              if (elemExprId != 0xffffffff && isParamOrConst) {
                this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Start as u32, elemExprId);
              }
              if (subtypeUnitId != 0xffffffff) {
                this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Unit as u32, subtypeUnitId);
              }
              count++;
            }
          }
        }
      } else {
        let isParamOrConst = variability == (Variability.Parameter as i32) || variability == (Variability.Constant as i32);
        let varIdx = this.dae.addVariable(fullVarNameId, varType, variability, causality, isParamOrConst ? startVal : 0.0, varFlags);
        if (valExprId != 0xffffffff && isParamOrConst) {
          this.dae.setVarAttrExpr(varIdx, VarAttrKind.Start as u32, valExprId);
        }
        if (subtypeUnitId != 0xffffffff) {
          this.dae.setVarAttrExpr(varIdx, VarAttrKind.Unit as u32, subtypeUnitId);
        }
        count++;
      }

      if (valExprId != 0xffffffff && variability != (Variability.Parameter as i32) && variability != (Variability.Constant as i32)) {
        let lhsNameExpr = this.dae.addExpression(ExprKind.Name, fullVarNameId);
        let eqKind = dim1 > 0 ? (EqKind.Array as u32) : (EqKind.Simple as u32);
        this.dae.addEquation(eqKind, lhsNameExpr, valExprId);
      }
    } else if (typeNameId != 0) {
      let subClassLoc = findClassDefinitionLoc(this.rootProgramLoc, typeNameId, pool);
      if (!locIsNull(subClassLoc)) {
        let subEnvPtr: u32 = 0;
        let classModLoc = findClassModificationLoc(modLoc);
        if (!locIsNull(classModLoc)) {
          subEnvPtr = flattener_envCreate(this.scopeStack.currentEnvPtr);
          populateEnvFromClassModLoc(subEnvPtr, classModLoc, pool, this.exprVisitor);
        }
        if (dim1 > 0 && dim2 == 0) {
          for (let i: u32 = 1; i <= dim1; i++) {
            let subPrefix = concatArrayIndex1D(pool, fullVarNameId, i);
            this.scopeStack.push(0, subEnvPtr, subPrefix, 0);
            count += this.instantiateClassLoc(subClassLoc, subPrefix);
            this.scopeStack.pop();
          }
        } else {
          this.scopeStack.push(0, subEnvPtr, fullVarNameId, 0);
          count += this.instantiateClassLoc(subClassLoc, fullVarNameId);
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
    if (locIsNull(compLoc)) return 0;

    let eqCountBefore = this.dae.eqCount;
    this.lowerCompositionEquations(compLoc, prefixPathId, pool);
    return this.dae.eqCount - eqCountBefore;
  }

  lowerCompositionEquations(parentLoc: u64, prefixPathId: u32, pool: ArenaStringPool): void {
    let ch = locFirstChild(parentLoc);
    while (!locIsNull(ch)) {
      this.lowerElementEquationsLoc(ch, prefixPathId, pool);
      ch = locNextSibling(ch);
    }
  }

  lowerElementEquationsLoc(elementLoc: u64, prefixPathId: u32, pool: ArenaStringPool, maxDepth: i32 = 30): u32 {
    if (locIsNull(elementLoc) || maxDepth <= 0) return 0;
    if (this.hasError) return 0;
    let ct = locType(elementLoc);

    if (ct == SyntaxType.ALGORITHM_SECTION) {
      this.setError(3792);
      return 0;
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
      let baseNameNode = locFindDescendant(elementLoc, SyntaxType.TYPE_SPECIFIER);
      if (locIsNull(baseNameNode)) baseNameNode = locFindDescendant(elementLoc, SyntaxType.NAME);
      if (!locIsNull(baseNameNode)) {
        let baseNameId = locIntern(pool, baseNameNode);
        let baseClassLoc = findClassDefinitionLoc(this.rootProgramLoc, baseNameId, pool);
        if (!locIsNull(baseClassLoc)) {
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
    let subClassLoc = findClassDefinitionLoc(this.rootProgramLoc, typeNameId, pool);
    if (locIsNull(subClassLoc)) return 0;

    return this.lowerComponentEquationsDeclarations(clauseLoc, subClassLoc, prefixPathId, pool);
  }

  lowerComponentEquationsDeclarations(parentLoc: u64, subClassLoc: u64, prefixPathId: u32, pool: ArenaStringPool): u32 {
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
          count += this.lowerAllClassEquationsLoc(subClassLoc, fullVarNameId);
        }
      } else if (t != SyntaxType.TYPE_SPECIFIER && t != SyntaxType.TYPE_PREFIX) {
        count += this.lowerComponentEquationsDeclarations(ch, subClassLoc, prefixPathId, pool);
      }
      ch = locNextSibling(ch);
    }
    return count;
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

    let varsBefore = this.dae.varCount;

    this.instantiateClassLoc(rootClassLoc, 0);
    if (this.hasError) return 0;
    this.lowerAllClassEquationsLoc(rootClassLoc, 0);
    if (this.hasError) return 0;

    this.expandConnections(false);
    this.finalizeConnections();

    return this.dae.varCount - varsBefore;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C-Style WASM Bridge Exports
// ─────────────────────────────────────────────────────────────────────────────

export function flattener_create(daePtr: u32): u32 {
  let ptr = atomicChunkAlloc(SIZEOF_FLATTENER);
  let flattener = changetype<ModelicaFlattener>(ptr);
  flattener.init(changetype<DaeBuilder>(daePtr));
  return ptr as u32;
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
  let envPtr = atomicChunkAlloc(SIZEOF_MOD_ENV);
  let env = changetype<ModificationEnvironment>(envPtr);
  env.init(parentPtr);
  return envPtr as u32;
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
