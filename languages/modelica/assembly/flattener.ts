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
} from "./array";
import { UnmanagedMap64, createMap64, UnmanagedSet64, createSet64 } from "./hashmap";
import { ArenaStringPool } from "./string_pool";

export const FLAG_MOD_FINAL: u32 = 0x01;
export const FLAG_MOD_EACH: u32 = 0x02;
export const FLAG_MOD_REDECLARE: u32 = 0x04;
export const FLAG_MOD_REPLACEABLE: u32 = 0x08;

export const SIZEOF_MOD_ENV: usize = 64;
export const SIZEOF_SCOPE_STACK: usize = 64;
export const SIZEOF_EXPR_VISITOR: usize = 64;
export const SIZEOF_FLATTENER: usize = 128;

export namespace SyntaxType {
  export const CLASS_DEFINITION: u16 = 106;
  export const CLASS_PREFIXES: u16 = 107;
  export const CLASS_SPECIFIER: u16 = 108;
  export const LONG_CLASS_SPECIFIER: u16 = 109;
  export const SHORT_CLASS_SPECIFIER: u16 = 110;
  export const COMPOSITION: u16 = 115;
  export const ELEMENT_LIST: u16 = 119;
  export const ELEMENT: u16 = 120;
  export const EXTENDS_CLAUSE: u16 = 123;
  export const COMPONENT_CLAUSE: u16 = 128;
  export const TYPE_PREFIX: u16 = 129;
  export const COMPONENT_LIST: u16 = 130;
  export const COMPONENT_DECLARATION: u16 = 131;
  export const DECLARATION: u16 = 133;
  export const MODIFICATION: u16 = 134;
  export const MODIFICATION_EXPRESSION: u16 = 135;
  export const CLASS_MODIFICATION: u16 = 136;
  export const ARGUMENT_LIST: u16 = 137;
  export const ARGUMENT: u16 = 138;
  export const ELEMENT_MODIFICATION_OR_REPLACEABLE: u16 = 139;
  export const ELEMENT_MODIFICATION: u16 = 140;
  export const ELEMENT_REDECLARATION: u16 = 141;
  export const COMPONENT_CLAUSE1: u16 = 143;
  export const COMPONENT_DECLARATION1: u16 = 144;
  export const EQUATION_SECTION: u16 = 146;
  export const ALGORITHM_SECTION: u16 = 147;
  export const SOME_EQUATION: u16 = 148;
  export const EQUATION_OR_PROCEDURE: u16 = 149;
  export const SIMPLE_EQUATION: u16 = 150;
  export const CONNECT_EQUATION: u16 = 164;
  export const EXPRESSION: u16 = 165;
  export const PRIMARY: u16 = 166;
  export const UNSIGNED_NUMBER: u16 = 167;
  export const TYPE_SPECIFIER: u16 = 168;
  export const NAME: u16 = 169;
  export const COMPONENT_REFERENCE: u16 = 170;
  export const ARRAY_SUBSCRIPTS: u16 = 183;
  export const SUBSCRIPT: u16 = 184;
  export const TOKEN_FINAL: u16 = 10;
  export const TOKEN_INPUT: u16 = 36;
  export const TOKEN_OUTPUT: u16 = 37;
  export const TOKEN_FLOW: u16 = 38;
  export const TOKEN_STREAM: u16 = 39;
  export const TOKEN_PUBLIC: u16 = 40;
  export const TOKEN_PROTECTED: u16 = 41;
  export const TOKEN_DISCRETE: u16 = 55;
  export const TOKEN_PARAMETER: u16 = 56;
  export const TOKEN_CONSTANT: u16 = 57;
  export const DER: u16 = 34;
  export const CONNECT: u16 = 74;
  export const OP_OR: u16 = 75;
  export const OP_AND: u16 = 76;
  export const OP_NOT: u16 = 77;
  export const OP_LT: u16 = 78;
  export const OP_LE: u16 = 79;
  export const OP_GT: u16 = 80;
  export const OP_GE: u16 = 81;
  export const OP_EQ: u16 = 82;
  export const OP_NEQ: u16 = 83;
  export const OP_ADD: u16 = 84;
  export const OP_SUB: u16 = 85;
  export const OP_DIV: u16 = 88;
  export const OP_POW: u16 = 90;
  export const OP_MUL: u16 = 50;
  export const FALSE: u16 = 93;
  export const TRUE: u16 = 94;
  export const TIME: u16 = 95;
  export const IDENTIFIER: u16 = 99;
  export const STRING_LITERAL: u16 = 100;
  export const UNSIGNED_INTEGER: u16 = 101;
  export const UNSIGNED_REAL: u16 = 102;
  export const TOKEN_IDENTIFIER_ALT: u16 = 327;
  export const TOKEN_UNSIGNED_INT_ALT: u16 = 329;
}

export namespace FieldId {
  export const LHS: u16 = 24;
  export const RHS: u16 = 25;
}

function parseIntBytes(src: usize, len: u32): i32 {
  if (len == 0 || src == 0) return 0;
  let isUtf16 = (len >= 2 && load<u8>(src + 1) == 0);
  let charCount = isUtf16 ? (len >> 1) : len;
  let res: i32 = 0;
  for (let i: u32 = 0; i < charCount; i++) {
    let b = isUtf16 ? load<u16>(src + (i as usize) * 2) : (load<u8>(src + i) as u16);
    if (b >= 48 && b <= 57) {
      res = res * 10 + ((b - 48) as i32);
    }
  }
  return res;
}

function parseRealBytes(src: usize, len: u32): f64 {
  if (len == 0 || src == 0) return 0.0;
  let isUtf16 = (len >= 2 && load<u8>(src + 1) == 0);
  let charCount = isUtf16 ? (len >> 1) : len;
  let i: u32 = 0;
  let sign: f64 = 1.0;
  let firstChar = isUtf16 ? load<u16>(src) : (load<u8>(src) as u16);
  if (firstChar == 45) { // '-'
    sign = -1.0;
    i++;
  } else if (firstChar == 43) { // '+'
    i++;
  }
  let intPart: f64 = 0.0;
  while (i < charCount) {
    let b = isUtf16 ? load<u16>(src + (i as usize) * 2) : (load<u8>(src + i) as u16);
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
    let b = isUtf16 ? load<u16>(src + (i as usize) * 2) : (load<u8>(src + i) as u16);
    if (b == 46) { // '.'
      i++;
      while (i < charCount) {
        let fb = isUtf16 ? load<u16>(src + (i as usize) * 2) : (load<u8>(src + i) as u16);
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
    let b = isUtf16 ? load<u16>(src + (i as usize) * 2) : (load<u8>(src + i) as u16);
    if (b == 101 || b == 69) { // 'e' | 'E'
      i++;
      let expSign: f64 = 1.0;
      if (i < charCount) {
        let eb = isUtf16 ? load<u16>(src + (i as usize) * 2) : (load<u8>(src + i) as u16);
        if (eb == 45) {
          expSign = -1.0;
          i++;
        } else if (eb == 43) {
          i++;
        }
      }
      let expVal: f64 = 0.0;
      while (i < charCount) {
        let eb = isUtf16 ? load<u16>(src + (i as usize) * 2) : (load<u8>(src + i) as u16);
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
  let isUtf16 = (len >= 2 && load<u8>(src + 1) == 0);
  let charCount = isUtf16 ? (len >> 1) : len;
  for (let i: u32 = 0; i < charCount; i++) {
    let b = isUtf16 ? load<u16>(src + (i as usize) * 2) : (load<u8>(src + i) as u16);
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

export function locFindChild(loc: u64, type: u16): u64 {
  let ch = locFirstChild(loc);
  while (!locIsNull(ch)) {
    if (locType(ch) == type) return ch;
    ch = locNextSibling(ch);
  }
  return 0;
}

export function locFindDescendant(loc: u64, type: u16): u64 {
  let ch = locFirstChild(loc);
  while (!locIsNull(ch)) {
    if (locType(ch) == type) return ch;
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

function parseArrayDimensionsLoc(subscriptsLoc: u64): u64 {
  if (locIsNull(subscriptsLoc)) return 0;
  let d1: u32 = 0;
  let d2: u32 = 0;
  let subCount: u32 = 0;

  let ch = locFirstChild(subscriptsLoc);
  while (!locIsNull(ch)) {
    let t = locType(ch);
    if (t == SyntaxType.SUBSCRIPT || t == SyntaxType.EXPRESSION || t == SyntaxType.PRIMARY ||
        t == SyntaxType.UNSIGNED_NUMBER || t == SyntaxType.UNSIGNED_INTEGER || t == SyntaxType.TOKEN_UNSIGNED_INT_ALT) {
      let target = ch;
      let inner = locFindDescendant(target, SyntaxType.UNSIGNED_INTEGER);
      if (!locIsNull(inner)) target = inner;
      let dimVal = locParseInt(target);
      if (dimVal > 0) {
        if (subCount == 0) d1 = dimVal as u32;
        else if (subCount == 1) d2 = dimVal as u32;
        subCount++;
      }
    }
    ch = locNextSibling(ch);
  }
  return ((d1 as u64) << 32) | (d2 as u64);
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

function populateEnvFromClassModLoc(envPtr: u32, modLoc: u64, pool: ArenaStringPool, exprVisitor: WasmExprVisitor): void {
  if (envPtr == 0 || locIsNull(modLoc)) return;
  let env = changetype<ModificationEnvironment>(envPtr);

  let argList = locFindChild(modLoc, SyntaxType.ARGUMENT_LIST);
  let parentLoc = locIsNull(argList) ? modLoc : argList;
  let argCur = locFirstChild(parentLoc);

  while (!locIsNull(argCur)) {
    let elemMod = argCur;
    if (locType(elemMod) == SyntaxType.ARGUMENT) {
      let first = locFirstNonEmptyChild(elemMod);
      if (!locIsNull(first)) elemMod = first;
    }
    let emType = locType(elemMod);
    if (emType == SyntaxType.ELEMENT_MODIFICATION || emType == SyntaxType.ELEMENT_MODIFICATION_OR_REPLACEABLE) {
      let nameCur = locFindDescendant(elemMod, SyntaxType.IDENTIFIER);
      if (locIsNull(nameCur)) nameCur = locFindDescendant(elemMod, SyntaxType.TOKEN_IDENTIFIER_ALT);
      if (locIsNull(nameCur)) nameCur = locFindDescendant(elemMod, SyntaxType.NAME);

      if (!locIsNull(nameCur)) {
        let keyNameId = locIntern(pool, nameCur);
        let exprLoc = locFindDescendant(elemMod, SyntaxType.MODIFICATION_EXPRESSION);
        if (locIsNull(exprLoc)) exprLoc = locFindDescendant(elemMod, SyntaxType.EXPRESSION);
        if (!locIsNull(exprLoc)) {
          let valExprId = exprVisitor.visitLoc(exprLoc);
          if (valExprId != 0xffffffff) {
            env.bindPath(pool, keyNameId, valExprId, false, false);
          }
        }
      }
    }
    argCur = locNextSibling(argCur);
  }
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

  @inline get dae(): DaeBuilder {
    return changetype<DaeBuilder>(this.daePtr);
  }

  @inline get loopVars(): UnmanagedMap64 {
    return changetype<UnmanagedMap64>(this.loopVarsPtr);
  }

  init(dae: DaeBuilder, prefixHash: u32 = 0, envPtr: u32 = 0, scopeStackPtr: u32 = 0): void {
    this.daePtr = changetype<usize>(dae) as u32;
    this.prefixHash = prefixHash;
    this.loopVarsPtr = createMap64(64);
    this.envPtr = envPtr;
    this.scopeStackPtr = scopeStackPtr;
  }

  setLoopVar(nameHash: u32, exprId: u32): void {
    this.loopVars.set(nameHash as u64, exprId as u64);
  }

  getLoopVar(nameHash: u32): u32 {
    if (this.loopVars.has(nameHash as u64)) {
      return this.loopVars.get(nameHash as u64) as u32;
    }
    return 0xffffffff;
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
      let left = this.dae.getExprLeft(exprId);
      let right = this.dae.getExprRight(exprId);
      return this.isRealExpr(left) || this.isRealExpr(right);
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
    return exprId;
  }

  lowerBinary(op: u16, left: u32, right: u32): u32 {
    let kLeft = this.dae.getExprKind(left);
    let kRight = this.dae.getExprKind(right);

    // Integer -> Real promotion
    if (this.isRealExpr(left) && !this.isRealExpr(right)) {
      right = this.castToReal(right);
      kRight = this.dae.getExprKind(right);
    } else if (!this.isRealExpr(left) && this.isRealExpr(right)) {
      left = this.castToReal(left);
      kLeft = this.dae.getExprKind(left);
    }

    // Constant folding
    if (kLeft == ExprKind.RealLiteral && kRight == ExprKind.RealLiteral) {
      let v1 = this.dae.getExprRealValue(left);
      let v2 = this.dae.getExprRealValue(right);
      if (op == (BinOp.Add as u16)) return this.dae.addRealLiteral(v1 + v2);
      if (op == (BinOp.Sub as u16)) return this.dae.addRealLiteral(v1 - v2);
      if (op == (BinOp.Mul as u16)) return this.dae.addRealLiteral(v1 * v2);
      if (op == (BinOp.Div as u16)) {
        if (v2 != 0.0) return this.dae.addRealLiteral(v1 / v2);
      }
    } else if (kLeft == ExprKind.IntLiteral && kRight == ExprKind.IntLiteral) {
      let v1 = this.dae.getExprData1(left) as i32;
      let v2 = this.dae.getExprData1(right) as i32;
      if (op == (BinOp.Add as u16)) return this.dae.addIntLiteral(v1 + v2);
      if (op == (BinOp.Sub as u16)) return this.dae.addIntLiteral(v1 - v2);
      if (op == (BinOp.Mul as u16)) return this.dae.addIntLiteral(v1 * v2);
      if (op == (BinOp.Div as u16)) {
        if (v2 != 0) return this.dae.addIntLiteral(v1 / v2);
      }
    }

    return this.dae.addBinaryExpr(op, left, right);
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
    return this.dae.addExpression(ExprKind.Unary, op as u32, operand);
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

    // 2. Numbers
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

    // 3. Literals & Keywords
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
      let strId = locIntern(pool, loc);
      return this.dae.addExpression(ExprKind.StringLiteral, strId);
    }

    // 4. Identifiers & Component References
    if (t == SyntaxType.IDENTIFIER || t == SyntaxType.TOKEN_IDENTIFIER_ALT || t == SyntaxType.NAME || t == SyntaxType.COMPONENT_REFERENCE) {
      let pool = this.dae.getStringPool();
      let subLoc = locFindDescendant(loc, SyntaxType.ARRAY_SUBSCRIPTS);
      if (!locIsNull(subLoc)) {
        let baseIdNode = locFirstNonEmptyChild(loc);
        if (locIsNull(baseIdNode)) baseIdNode = loc;
        let baseNameId = locIntern(pool, baseIdNode);
        let firstSub = locFindDescendant(subLoc, SyntaxType.SUBSCRIPT);
        if (locIsNull(firstSub)) firstSub = locFirstChild(subLoc);
        let subExprLoc = locFindDescendant(firstSub, SyntaxType.EXPRESSION);
        if (locIsNull(subExprLoc)) subExprLoc = firstSub;
        let subVal = locParseInt(subExprLoc);
        if (subVal > 0) {
          let indexedNameId = concatArrayIndex1D(pool, baseNameId, subVal as u32);
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

    // 5. Binary expressions (child count == 3)
    let nonZeroCount = locNonEmptyChildCount(loc);
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
        if (opType == SyntaxType.OP_LT || locMatches(opNode, "<")) return this.dae.addBinaryExpr(BinOp.Lt as u16, left, right);
        if (opType == SyntaxType.OP_LE || locMatches(opNode, "<=")) return this.dae.addBinaryExpr(BinOp.Lte as u16, left, right);
        if (opType == SyntaxType.OP_GT || locMatches(opNode, ">")) return this.dae.addBinaryExpr(BinOp.Gt as u16, left, right);
        if (opType == SyntaxType.OP_GE || locMatches(opNode, ">=")) return this.dae.addBinaryExpr(BinOp.Gte as u16, left, right);
        if (opType == SyntaxType.OP_EQ || locMatches(opNode, "==")) return this.dae.addBinaryExpr(BinOp.Eq as u16, left, right);
        if (opType == SyntaxType.OP_NEQ || locMatches(opNode, "<>")) return this.dae.addBinaryExpr(BinOp.Neq as u16, left, right);
        if (opType == SyntaxType.OP_AND || locMatches(opNode, "and")) return this.dae.addBinaryExpr(BinOp.And as u16, left, right);
        if (opType == SyntaxType.OP_OR || locMatches(opNode, "or")) return this.dae.addBinaryExpr(BinOp.Or as u16, left, right);
      }
    }

    // 6. Unary expressions (child count == 2)
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
        return this.dae.addExpression(ExprKind.Unary, UnaryOp.Not as u32, operand);
      }
    }

    // 7. der(...) call
    let firstCh = locFirstNonEmptyChild(loc);
    if (!locIsNull(firstCh) && (locType(firstCh) == SyntaxType.DER || locMatches(firstCh, "der"))) {
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
      let t = locType(ch);
      if (t == SyntaxType.SIMPLE_EQUATION) {
        this.lowerSimpleEquation(ch, isInitial);
      } else if (t == SyntaxType.CONNECT_EQUATION) {
        this.lowerConnectEquation(ch);
      } else if (t != SyntaxType.CLASS_DEFINITION) {
        // Recurse into wrapper nodes
        this.lowerEquationsUnderSection(ch, isInitial);
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
    if (locIsNull(lhsLoc) || locIsNull(rhsLoc)) return 0;

    let lhsExpr = this.exprVisitor.visitLoc(lhsLoc);
    let rhsExpr = this.exprVisitor.visitLoc(rhsLoc);
    if (lhsExpr == 0xffffffff || rhsExpr == 0xffffffff) return 0;

    if (this.exprVisitor.isRealExpr(lhsExpr) && !this.exprVisitor.isRealExpr(rhsExpr)) {
      rhsExpr = this.exprVisitor.castToReal(rhsExpr);
    } else if (!this.exprVisitor.isRealExpr(lhsExpr) && this.exprVisitor.isRealExpr(rhsExpr)) {
      lhsExpr = this.exprVisitor.castToReal(lhsExpr);
    }

    let eqKind = isInitial ? EqKind.InitialSimple : EqKind.Simple;
    this.dae.addEquation(eqKind, lhsExpr, rhsExpr, isInitial ? (FLAG_EQ_INITIAL as u32) : 0);
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
    if (e1 == 0xffffffff || e2 == 0xffffffff) return 0;

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
      count += this.instantiateCompositionElement(ch, prefixPathId, pool);
      ch = locNextSibling(ch);
    }
    return count;
  }

  instantiateCompositionElement(elementLoc: u64, prefixPathId: u32, pool: ArenaStringPool, maxDepth: i32 = 30): u32 {
    if (locIsNull(elementLoc) || maxDepth <= 0) return 0;
    let t = locType(elementLoc);

    if (t == SyntaxType.COMPONENT_CLAUSE || t == SyntaxType.COMPONENT_CLAUSE1) {
      return this.instantiateComponentClause(elementLoc, prefixPathId, pool);
    }

    if (t == SyntaxType.EXTENDS_CLAUSE) {
      return this.instantiateExtendsClause(elementLoc, prefixPathId, pool);
    }

    if (t != SyntaxType.CLASS_DEFINITION && t != SyntaxType.EQUATION_SECTION && t != SyntaxType.ALGORITHM_SECTION) {
      let sub = locFirstChild(elementLoc);
      let count: u32 = 0;
      while (!locIsNull(sub)) {
        count += this.instantiateCompositionElement(sub, prefixPathId, pool, maxDepth - 1);
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

    if (!locIsNull(typeSpecLoc)) {
      typeNameId = locIntern(pool, typeSpecLoc);

      if (locMatches(typeSpecLoc, "Real")) {
        varType = VarType.Real;
        isPrimitive = true;
      } else if (locMatches(typeSpecLoc, "Integer")) {
        varType = VarType.Integer;
        isPrimitive = true;
      } else if (locMatches(typeSpecLoc, "Boolean")) {
        varType = VarType.Boolean;
        isPrimitive = true;
      } else if (locMatches(typeSpecLoc, "String")) {
        varType = VarType.String;
        isPrimitive = true;
      }
    }

    let clauseDims = parseArrayDimensionsLoc(clauseSubscriptsLoc);
    let clauseDim1 = (clauseDims >> 32) as u32;
    let clauseDim2 = (clauseDims & 0xffffffff) as u32;

    return this.instantiateDeclarationsUnder(clauseLoc, isPrimitive, varType, variability, causality, varFlags, typeNameId, clauseDim1, clauseDim2, prefixPathId, pool);
  }

  instantiateDeclarationsUnder(parentLoc: u64, isPrimitive: boolean, varType: i32, variability: i32, causality: i32, varFlags: i32, typeNameId: u32, clauseDim1: u32, clauseDim2: u32, prefixPathId: u32, pool: ArenaStringPool): u32 {
    let ch = locFirstChild(parentLoc);
    let count: u32 = 0;
    while (!locIsNull(ch)) {
      let t = locType(ch);
      if (t == SyntaxType.DECLARATION) {
        count += this.instantiateDeclaration(ch, isPrimitive, varType, variability, causality, varFlags, typeNameId, clauseDim1, clauseDim2, prefixPathId, pool);
      } else if (t != SyntaxType.TYPE_SPECIFIER && t != SyntaxType.TYPE_PREFIX) {
        count += this.instantiateDeclarationsUnder(ch, isPrimitive, varType, variability, causality, varFlags, typeNameId, clauseDim1, clauseDim2, prefixPathId, pool);
      }
      ch = locNextSibling(ch);
    }
    return count;
  }

  instantiateDeclaration(declLoc: u64, isPrimitive: boolean, varType: i32, variability: i32, causality: i32, varFlags: i32, typeNameId: u32, clauseDim1: u32, clauseDim2: u32, prefixPathId: u32, pool: ArenaStringPool): u32 {
    let idLoc = locFirstNonEmptyChild(declLoc);
    if (locIsNull(idLoc)) return 0;
    let innerId = locFindDescendant(idLoc, SyntaxType.IDENTIFIER);
    if (!locIsNull(innerId)) idLoc = innerId;

    let compNameId = locIntern(pool, idLoc);
    let fullVarNameId = prefixPathId != 0 ? pool.concatIds(prefixPathId, compNameId) : compNameId;

    let declSubscripts = locFindDescendant(declLoc, SyntaxType.ARRAY_SUBSCRIPTS);
    let declDims = parseArrayDimensionsLoc(declSubscripts);
    let dim1 = (declDims >> 32) as u32;
    let dim2 = (declDims & 0xffffffff) as u32;
    if (dim1 == 0 && clauseDim1 > 0) {
      dim1 = clauseDim1;
      dim2 = clauseDim2;
    }

    let modLoc = locFindDescendant(declLoc, SyntaxType.MODIFICATION);
    let valExprId: u32 = 0xffffffff;
    let bExprLoc = findBindingExpressionLoc(modLoc);
    if (!locIsNull(bExprLoc)) {
      valExprId = this.exprVisitor.visitLoc(bExprLoc);
      if (varType == VarType.Real && valExprId != 0xffffffff && !this.exprVisitor.isRealExpr(valExprId)) {
        valExprId = this.exprVisitor.castToReal(valExprId);
      }
    }

    if (this.scopeStackPtr != 0) {
      let modOverride = changetype<ScopeStack>(this.scopeStackPtr).lookup(compNameId);
      if (modOverride == 0xffffffff && prefixPathId != 0) {
        modOverride = changetype<ScopeStack>(this.scopeStackPtr).lookupPath(pool, fullVarNameId);
      }
      if (modOverride != 0xffffffff) {
        valExprId = modOverride;
      }
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
      if (dim1 > 0 && dim2 == 0) {
        for (let i: u32 = 1; i <= dim1; i++) {
          let elemNameId = concatArrayIndex1D(pool, fullVarNameId, i);
          let elemVarIdx = this.dae.addVariable(elemNameId, varType, variability, causality, startVal, varFlags);
          if (valExprId != 0xffffffff) {
            this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Start as u32, valExprId);
          }
          count++;
        }
      } else if (dim1 > 0 && dim2 > 0) {
        for (let i: u32 = 1; i <= dim1; i++) {
          for (let j: u32 = 1; j <= dim2; j++) {
            let elemNameId = concatArrayIndex2D(pool, fullVarNameId, i, j);
            let elemVarIdx = this.dae.addVariable(elemNameId, varType, variability, causality, startVal, varFlags);
            if (valExprId != 0xffffffff) {
              this.dae.setVarAttrExpr(elemVarIdx, VarAttrKind.Start as u32, valExprId);
            }
            count++;
          }
        }
      } else {
        let varIdx = this.dae.addVariable(fullVarNameId, varType, variability, causality, startVal, varFlags);
        if (valExprId != 0xffffffff) {
          this.dae.setVarAttrExpr(varIdx, VarAttrKind.Start as u32, valExprId);
        }
        count++;
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
    let ct = locType(elementLoc);

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
        let pool = this.dae.getStringPool();
        let targetNameId = getClassNameIdLoc(pool, locMakeRoot(rootClassNodePtr));
        if (targetNameId != 0) {
          rootClassLoc = findClassDefinitionLoc(rootProgramLoc, targetNameId, pool);
        }
        if (locIsNull(rootClassLoc)) {
          rootClassLoc = findClassByPtr(rootProgramLoc, rootClassNodePtr);
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
    this.lowerAllClassEquationsLoc(rootClassLoc, 0);

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
