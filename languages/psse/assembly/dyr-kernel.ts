// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  SCHEMA_CATEGORIES,
  SCHEMA_HASH_MASK,
  SCHEMA_HASH_SLOTS,
  SCHEMA_HEADER_KINDS,
  SCHEMA_NAME_BYTES,
  SCHEMA_NAME_LENS,
  SCHEMA_NAME_OFFSETS,
} from "./model-table.gen";

// Record token classes stored during single-pass scan before flattening into CSR/SoA columns
const TOK_NUM: u8 = 1;
const TOK_QUOTED: u8 = 2;
const TOK_IDENT: u8 = 3;

// HeaderKind codes matching scripts/sync-dyr-schemas.ts
const HDR_MACHINE: u8 = 0;
const HDR_BUS: u8 = 1;
const HDR_LOAD: u8 = 2;
const HDR_SUBSYSTEM: u8 = 3;
const HDR_BRANCH: u8 = 4;
const HDR_XFMR2W: u8 = 5;
const HDR_DC2T: u8 = 6;
const HDR_VSCDC: u8 = 7;
const HDR_FACTS: u8 = 8;
const HDR_USRMDL: u8 = 9;

// Linear memory bump allocator starting after static data (__heap_base)
let inputBase: usize = 0;
let inputCap: i32 = 0;
let workBase: usize = 0;

// Output SoA column pointers & counts
let outRecCount: i32 = 0;
let outParamCount: i32 = 0;

let ptrSchemaIds: usize = 0;    // u16[nRec]
let ptrCategories: usize = 0;   // u8[nRec]
let ptrHeaderKinds: usize = 0;  // u8[nRec]
let ptrBus: usize = 0;          // i32[nRec]
let ptrBus2: usize = 0;         // i32[nRec]
let ptrModelOff: usize = 0;     // u32[nRec]
let ptrModelLen: usize = 0;     // u16[nRec]
let ptrIdOff: usize = 0;        // u32[nRec]
let ptrIdLen: usize = 0;        // u16[nRec]
let ptrParamRowOff: usize = 0;  // u32[nRec + 1]
let ptrParamVals: usize = 0;    // f64[nParam]
let ptrParamIsInt: usize = 0;   // u8[nParam]
let ptrSpanStart: usize = 0;    // u32[nRec]
let ptrSpanEnd: usize = 0;      // u32[nRec]
let ptrSpanLine: usize = 0;     // u32[nRec]
let ptrUsrMeta: usize = 0;      // i32[nRec * 6] (ic, it, ni, nc, ns, nv; -1 if not USRMDL)

@inline
function align8(v: usize): usize {
  return (v + 7) & ~(<usize>7);
}

function ensureMemoryEnd(neededBytes: usize): void {
  const curBytes = (<usize>memory.size()) << 16;
  if (neededBytes <= curBytes) return;
  const delta = neededBytes - curBytes;
  const pages = <i32>((delta + 65535) >> 16);
  memory.grow(pages);
}

export function dyr_allocInput(byteLen: i32): usize {
  const heapStart = align8(__heap_base + 1024);
  if (inputBase == 0) inputBase = heapStart;
  const alignedCap = <i32>align8(<usize>(byteLen + 64));
  if (alignedCap > inputCap) {
    inputCap = alignedCap;
  }
  const needed = inputBase + <usize>inputCap;
  ensureMemoryEnd(needed);
  workBase = align8(needed);
  return inputBase;
}

export function dyr_getRecordCount(): i32 {
  return outRecCount;
}
export function dyr_getTotalParams(): i32 {
  return outParamCount;
}
export function dyr_getSchemaIdsPtr(): usize {
  return ptrSchemaIds;
}
export function dyr_getCategoriesPtr(): usize {
  return ptrCategories;
}
export function dyr_getHeaderKindsPtr(): usize {
  return ptrHeaderKinds;
}
export function dyr_getBusPtr(): usize {
  return ptrBus;
}
export function dyr_getBus2Ptr(): usize {
  return ptrBus2;
}
export function dyr_getModelOffPtr(): usize {
  return ptrModelOff;
}
export function dyr_getModelLenPtr(): usize {
  return ptrModelLen;
}
export function dyr_getIdOffPtr(): usize {
  return ptrIdOff;
}
export function dyr_getIdLenPtr(): usize {
  return ptrIdLen;
}
export function dyr_getParamRowOffPtr(): usize {
  return ptrParamRowOff;
}
export function dyr_getParamValuesPtr(): usize {
  return ptrParamVals;
}
export function dyr_getParamIsIntPtr(): usize {
  return ptrParamIsInt;
}
export function dyr_getSpanStartPtr(): usize {
  return ptrSpanStart;
}
export function dyr_getSpanEndPtr(): usize {
  return ptrSpanEnd;
}
export function dyr_getSpanLinePtr(): usize {
  return ptrSpanLine;
}
export function dyr_getUsrMetaPtr(): usize {
  return ptrUsrMeta;
}

@inline
function toUpperAscii(c: u8): u8 {
  return c >= 97 && c <= 122 ? <u8>(c - 32) : c;
}

function lookupModelSchema(ptr: usize, len: i32): u16 {
  if (len <= 0 || len > 32) return 0;
  let h: u32 = 0x811c9dc5;
  for (let i: i32 = 0; i < len; i++) {
    const c = toUpperAscii(load<u8>(ptr + <usize>i));
    h ^= <u32>c;
    h *= 0x01000193;
  }
  let slot = h & SCHEMA_HASH_MASK;
  while (true) {
    const schemaId = unchecked(SCHEMA_HASH_SLOTS[<i32>slot]);
    if (schemaId == 0) return 0;
    const targetLen = <i32>unchecked(SCHEMA_NAME_LENS[<i32>schemaId]);
    if (targetLen == len) {
      const off = <i32>unchecked(SCHEMA_NAME_OFFSETS[<i32>schemaId]);
      let eq = true;
      for (let i: i32 = 0; i < len; i++) {
        if (toUpperAscii(load<u8>(ptr + <usize>i)) != unchecked(SCHEMA_NAME_BYTES[off + i])) {
          eq = false;
          break;
        }
      }
      if (eq) return schemaId;
    }
    slot = (slot + 1) & SCHEMA_HASH_MASK;
  }
}

function equalsAsciiUpper(ptr: usize, len: i32, c0: u8, c1: u8, c2: u8, c3: u8, c4: u8, c5: u8): bool {
  if (len != 6) return false;
  return (
    toUpperAscii(load<u8>(ptr + 0)) == c0 &&
    toUpperAscii(load<u8>(ptr + 1)) == c1 &&
    toUpperAscii(load<u8>(ptr + 2)) == c2 &&
    toUpperAscii(load<u8>(ptr + 3)) == c3 &&
    toUpperAscii(load<u8>(ptr + 4)) == c4 &&
    toUpperAscii(load<u8>(ptr + 5)) == c5
  );
}

function isUsrMdlToken(ptr: usize, len: i32): bool {
  // "USRMDL"
  return equalsAsciiUpper(ptr, len, 85, 83, 82, 77, 68, 76);
}

function pow10f64(exp: i32): f64 {
  if (exp == 0) return 1.0;
  let e = exp < 0 ? -exp : exp;
  let base: f64 = 10.0;
  let res: f64 = 1.0;
  while (e > 0) {
    if ((e & 1) != 0) res *= base;
    base *= base;
    e >>= 1;
  }
  return exp < 0 ? 1.0 / res : res;
}

let lastParseIsInt: u8 = 0;

function parseNumberFast(ptr: usize, len: i32): f64 {
  lastParseIsInt = 0;
  if (len <= 0) return NaN;
  let i: i32 = 0;
  let neg = false;
  const first = load<u8>(ptr);
  if (first == 45 /* '-' */) {
    neg = true;
    i = 1;
  } else if (first == 43 /* '+' */) {
    i = 1;
  }
  if (i >= len) return NaN;

  let mantissa: f64 = 0.0;
  let digits: i32 = 0;
  let sawDot = false;
  let sawExp = false;
  let fracScale: i32 = 0;

  while (i < len) {
    const ch = load<u8>(ptr + <usize>i);
    if (ch >= 48 && ch <= 57) {
      mantissa = mantissa * 10.0 + <f64>(ch - 48);
      digits++;
      if (sawDot) fracScale--;
      i++;
    } else if (ch == 46 /* '.' */ && !sawDot) {
      sawDot = true;
      i++;
    } else if (ch == 101 || ch == 69 || ch == 100 || ch == 68 /* e E d D */) {
      sawExp = true;
      i++;
      break;
    } else {
      return NaN;
    }
  }

  if (digits == 0) return NaN;

  let expVal: i32 = 0;
  if (sawExp) {
    if (i >= len) return NaN;
    let expNeg = false;
    const ec = load<u8>(ptr + <usize>i);
    if (ec == 45) {
      expNeg = true;
      i++;
    } else if (ec == 43) {
      i++;
    }
    if (i >= len) return NaN;
    let eDigits = 0;
    while (i < len) {
      const ch = load<u8>(ptr + <usize>i);
      if (ch >= 48 && ch <= 57) {
        if (expVal < 1000) expVal = expVal * 10 + <i32>(ch - 48);
        eDigits++;
        i++;
      } else {
        return NaN;
      }
    }
    if (eDigits == 0) return NaN;
    if (expNeg) expVal = -expVal;
  }

  lastParseIsInt = !sawDot && !sawExp ? 1 : 0;
  const totalExp = fracScale + expVal;
  let val = totalExp == 0 ? mantissa : mantissa * pow10f64(totalExp);
  return neg ? -val : val;
}

@inline
function isWs(c: u8): bool {
  return c == 32 || c == 9 || c == 13;
}

@inline
function isDelim(c: u8): bool {
  return c == 32 || c == 9 || c == 13 || c == 10 || c == 44 /* ',' */ || c == 47 /* '/' */;
}

function classifyPrefixCategory(ptr: usize, len: i32): u8 {
  if (len < 2) return 8;
  const c0 = toUpperAscii(load<u8>(ptr));
  const c1 = toUpperAscii(load<u8>(ptr + 1));
  const c2 = len >= 3 ? toUpperAscii(load<u8>(ptr + 2)) : 0;
  if ((c0 == 71 && c1 == 69 && c2 == 78) || (c0 == 82 && c1 == 69 && c2 == 71)) return 0; // GEN / REG
  if (
    (c0 == 69 && c1 == 88) ||
    (c0 == 69 && c1 == 83) ||
    (c0 == 73 && c1 == 69 && c2 == 69) ||
    (c0 == 83 && c1 == 69 && c2 == 88) ||
    (c0 == 83 && c1 == 67 && c2 == 82) ||
    (c0 == 82 && c1 == 69 && c2 == 69)
  ) {
    return 1; // exciter / REEC
  }
  if (
    (c0 == 84 && c1 == 71) ||
    (c0 == 72 && c1 == 89) ||
    (c0 == 71 && c1 == 65) ||
    (c0 == 71 && c1 == 71) ||
    (c0 == 87 && c1 == 80) ||
    (c0 == 80 && c1 == 73 && c2 == 68) ||
    (c0 == 67 && c1 == 67 && c2 == 71) ||
    (c0 == 68 && c1 == 69 && c2 == 71) ||
    (c0 == 87 && c1 == 83) ||
    (c0 == 82 && c1 == 69 && c2 == 80) ||
    (c0 == 87 && c1 == 84)
  ) {
    return 2; // governor / REPC / WT
  }
  if ((c0 == 80 && c1 == 83 && c2 == 83) || (c0 == 83 && c1 == 84 && c2 == 65)) return 3; // PSS / STAB
  if (
    (c0 == 67 && c1 == 77 && c2 == 80) ||
    (c0 == 67 && c1 == 77 && c2 == 76) ||
    (c0 == 67 && c1 == 76 && c2 == 79) ||
    (c0 == 67 && c1 == 73 && c2 == 77) ||
    (c0 == 73 && c1 == 69 && c2 == 69 && len >= 4 && toUpperAscii(load<u8>(ptr + 3)) == 76) ||
    (c0 == 76 && c1 == 68 && c2 == 70)
  ) {
    return 4; // load
  }
  if ((c0 == 83 && c1 == 86 && c2 == 83) || (c0 == 67 && c1 == 83 && c2 == 84)) return 5; // facts
  if ((c0 == 67 && c1 == 68 && c2 == 67) || (c0 == 86 && c1 == 83 && c2 == 67)) return 6; // hvdc
  if (
    (c0 == 76 && c1 == 68 && c2 == 83) ||
    (c0 == 76 && c1 == 86 && c2 == 83) ||
    (c0 == 68 && c1 == 73 && c2 == 83) ||
    (c0 == 70 && c1 == 82 && c2 == 81) ||
    (c0 == 86 && c1 == 84 && c2 == 71) ||
    (c0 == 66 && c1 == 85 && c2 == 83)
  ) {
    return 7; // relay / measurement
  }
  return 8;
}

/**
 * Single-pass linear-memory `.dyr` parser.
 *
 * Scans UTF-8 bytes in `[inputBase, inputBase + byteLen)`, frames multi-line slash-terminated
 * records, hashes model names against `SCHEMA_HASH_SLOTS`, parses Fortran/IEEE floats,
 * and populates contiguous SoA buffers in linear memory.
 */
export function dyr_parse(byteLen: i32): i32 {
  outRecCount = 0;
  outParamCount = 0;
  if (byteLen <= 0 || inputBase == 0) return 0;

  // Scratch token buffer layout in workBase:
  // Each token is 20 bytes: off:u32 (0), len:u16 (4), kind:u8 (6), isInt:u8 (7), line:u32 (8), val:f64 (12)
  // Estimate upper bound on tokens <= byteLen / 2 + 16, records <= byteLen / 6 + 16
  const maxTokEst = (byteLen >> 1) + 32;
  const maxRecEst = (byteLen >> 2) + 32;
  const tokBuf = workBase;
  const tokStride: usize = 20;
  const recBoundStart = align8(tokBuf + <usize>maxTokEst * tokStride);
  // Each preliminary record boundary: firstTok:u32 (0), tokCount:u32 (4), spanStart:u32 (8), spanEnd:u32 (12), spanLine:u32 (16) -> 20 bytes
  const recBoundStride: usize = 20;
  const outArenaBase = align8(recBoundStart + <usize>maxRecEst * recBoundStride);
  ensureMemoryEnd(outArenaBase + 65536);

  const src = inputBase;
  let pos: i32 = 0;
  let lineNum: i32 = 1;
  let tokCount: i32 = 0;
  let recCount: i32 = 0;

  let curRecFirstTok: i32 = 0;
  let curRecTokCount: i32 = 0;
  let curRecStartByte: i32 = 0;
  let curRecStartLine: i32 = 1;
  let curLineHadSlash = false;

  let curStartLineUnused = 0;
  if (curStartLineUnused > 0) curStartLineUnused = 0;

  while (pos < byteLen) {
    // Process one physical line at a time so single-line records without '/' can flush cleanly
    const lineStartPos = pos;
    let lineTokStart = tokCount;
    curLineHadSlash = false;

    while (pos < byteLen) {
      const ch = load<u8>(src + <usize>pos);
      if (ch == 10 /* '\n' */) {
        pos++;
        break;
      }
      if (isWs(ch) || ch == 44 /* ',' */) {
        pos++;
        continue;
      }
      // Line comments: // or @! (or standalone line starting with /? No, / terminates record!)
      if (ch == 47 /* '/' */) {
        if (pos + 1 < byteLen && load<u8>(src + <usize>(pos + 1)) == 47 /* '//' */) {
          // '//' comment to end of line
          pos += 2;
          while (pos < byteLen && load<u8>(src + <usize>pos) != 10) pos++;
          continue;
        }
        // '/' record terminator! Advance to EOL (ignore comment after '/')
        curLineHadSlash = true;
        pos++;
        while (pos < byteLen && load<u8>(src + <usize>pos) != 10) pos++;
        if (pos < byteLen && load<u8>(src + <usize>pos) == 10) {
          // include '/' in spanEnd (not trailing comment or newline? actually end at '/')
          pos++;
        }
        break;
      }
      if (ch == 64 /* '@' */ && pos + 1 < byteLen && load<u8>(src + <usize>(pos + 1)) == 33 /* '!' */) {
        pos += 2;
        while (pos < byteLen && load<u8>(src + <usize>pos) != 10) pos++;
        continue;
      }

      // Quoted string token ('...' or "...")
      if (ch == 39 || ch == 34) {
        const quote = ch;
        const tokStart = pos + 1;
        pos++;
        while (pos < byteLen) {
          const qc = load<u8>(src + <usize>pos);
          if (qc == quote) {
            if (pos + 1 < byteLen && load<u8>(src + <usize>(pos + 1)) == quote) {
              pos += 2;
              continue;
            }
            break;
          }
          if (qc == 10) break;
          pos++;
        }
        // Trim inner whitespace
        let tStart = tokStart;
        let tEnd = pos;
        while (tStart < tEnd && isWs(load<u8>(src + <usize>tStart))) tStart++;
        while (tEnd > tStart && isWs(load<u8>(src + <usize>(tEnd - 1)))) tEnd--;
        if (pos < byteLen && load<u8>(src + <usize>pos) == quote) pos++;

        const tOff = tokBuf + <usize>tokCount * tokStride;
        store<u32>(tOff + 0, <u32>tStart);
        store<u16>(tOff + 4, <u16>(tEnd - tStart));
        store<u8>(tOff + 6, TOK_QUOTED);
        store<u8>(tOff + 7, 0);
        store<u32>(tOff + 8, <u32>lineNum);
        store<f64>(tOff + 12, NaN);
        tokCount++;
        continue;
      }

      // Unquoted token (Number or Identifier)
      const tokStart = pos;
      while (pos < byteLen && !isDelim(load<u8>(src + <usize>pos))) {
        pos++;
      }
      const tokLen = pos - tokStart;
      const numVal = parseNumberFast(src + <usize>tokStart, tokLen);
      const isNum = !isNaN(numVal);
      const tOff = tokBuf + <usize>tokCount * tokStride;
      store<u32>(tOff + 0, <u32>tokStart);
      store<u16>(tOff + 4, <u16>tokLen);
      store<u8>(tOff + 6, isNum ? TOK_NUM : TOK_IDENT);
      store<u8>(tOff + 7, isNum ? lastParseIsInt : 0);
      store<u32>(tOff + 8, <u32>lineNum);
      store<f64>(tOff + 12, numVal);
      tokCount++;
    }

    const lineTokCount = tokCount - lineTokStart;
    const spanLineEndPos = pos > lineStartPos && load<u8>(src + <usize>(pos - 1)) == 10 ? pos - 1 : pos;

    if (lineTokCount > 0) {
      // Check if this physical line starts a new record when previous record had no '/'
      if (curRecTokCount > 0) {
        const l0Off = tokBuf + <usize>lineTokStart * tokStride;
        const l0Kind = load<u8>(l0Off + 6);
        const l0Int = load<u8>(l0Off + 7);
        const l0Val = load<f64>(l0Off + 12);
        let startsNew = false;
        if (lineTokCount >= 2) {
          const l1Off = tokBuf + <usize>(lineTokStart + 1) * tokStride;
          const l1Kind = load<u8>(l1Off + 6);
          if (l0Kind == TOK_NUM && l0Int == 1 && l0Val > 0.0 && l1Kind == TOK_QUOTED) {
            startsNew = true;
          } else if (l0Kind == TOK_QUOTED && l1Kind == TOK_QUOTED) {
            startsNew = true;
          } else if (lineTokCount >= 4) {
            const l3Off = tokBuf + <usize>(lineTokStart + 3) * tokStride;
            if (l0Kind == TOK_NUM && l0Int == 1 && load<u8>(l3Off + 6) == TOK_QUOTED) {
              startsNew = true;
            }
          }
        }
        if (startsNew) {
          // Flush prior record before starting this new one
          const rOff = recBoundStart + <usize>recCount * recBoundStride;
          store<u32>(rOff + 0, <u32>curRecFirstTok);
          store<u32>(rOff + 4, <u32>curRecTokCount);
          store<u32>(rOff + 8, <u32>curRecStartByte);
          store<u32>(rOff + 12, <u32>lineStartPos);
          store<u32>(rOff + 16, <u32>curRecStartLine);
          recCount++;
          curRecTokCount = 0;
        }
      }

      if (curRecTokCount == 0) {
        curRecFirstTok = lineTokStart;
        curRecStartByte = lineStartPos;
        curRecStartLine = lineNum;
      }
      curRecTokCount += lineTokCount;
    }

    if (curLineHadSlash && curRecTokCount > 0) {
      const rOff = recBoundStart + <usize>recCount * recBoundStride;
      store<u32>(rOff + 0, <u32>curRecFirstTok);
      store<u32>(rOff + 4, <u32>curRecTokCount);
      store<u32>(rOff + 8, <u32>curRecStartByte);
      store<u32>(rOff + 12, <u32>spanLineEndPos);
      store<u32>(rOff + 16, <u32>curRecStartLine);
      recCount++;
      curRecTokCount = 0;
    }

    lineNum++;
  }

  if (curRecTokCount > 0) {
    const rOff = recBoundStart + <usize>recCount * recBoundStride;
    store<u32>(rOff + 0, <u32>curRecFirstTok);
    store<u32>(rOff + 4, <u32>curRecTokCount);
    store<u32>(rOff + 8, <u32>curRecStartByte);
    store<u32>(rOff + 12, <u32>byteLen);
    store<u32>(rOff + 16, <u32>curRecStartLine);
    recCount++;
  }

  // Now allocate final contiguous SoA columns at outArenaBase
  const maxTotalParams = tokCount;
  let cursor = outArenaBase;
  ptrSchemaIds = cursor; cursor = align8(cursor + <usize>(recCount + 1) * 2);
  ptrCategories = cursor; cursor = align8(cursor + <usize>(recCount + 1));
  ptrHeaderKinds = cursor; cursor = align8(cursor + <usize>(recCount + 1));
  ptrBus = cursor; cursor = align8(cursor + <usize>(recCount + 1) * 4);
  ptrBus2 = cursor; cursor = align8(cursor + <usize>(recCount + 1) * 4);
  ptrModelOff = cursor; cursor = align8(cursor + <usize>(recCount + 1) * 4);
  ptrModelLen = cursor; cursor = align8(cursor + <usize>(recCount + 1) * 2);
  ptrIdOff = cursor; cursor = align8(cursor + <usize>(recCount + 1) * 4);
  ptrIdLen = cursor; cursor = align8(cursor + <usize>(recCount + 1) * 2);
  ptrParamRowOff = cursor; cursor = align8(cursor + <usize>(recCount + 2) * 4);
  ptrSpanStart = cursor; cursor = align8(cursor + <usize>(recCount + 1) * 4);
  ptrSpanEnd = cursor; cursor = align8(cursor + <usize>(recCount + 1) * 4);
  ptrSpanLine = cursor; cursor = align8(cursor + <usize>(recCount + 1) * 4);
  ptrUsrMeta = cursor; cursor = align8(cursor + <usize>(recCount + 1) * 24);
  ptrParamVals = cursor; cursor = align8(cursor + <usize>(maxTotalParams + 1) * 8);
  ptrParamIsInt = cursor; cursor = align8(cursor + <usize>(maxTotalParams + 1));
  ensureMemoryEnd(cursor);

  let finalRecs: i32 = 0;
  let finalParams: i32 = 0;

  for (let r: i32 = 0; r < recCount; r++) {
    const rOff = recBoundStart + <usize>r * recBoundStride;
    const fTok = <i32>load<u32>(rOff + 0);
    const nTok = <i32>load<u32>(rOff + 4);
    if (nTok < 2) continue;

    const t0Off = tokBuf + <usize>fTok * tokStride;
    const t0Kind = load<u8>(t0Off + 6);
    const t0Ptr = src + <usize>load<u32>(t0Off + 0);
    const t0Len = <i32>load<u16>(t0Off + 4);
    const t0Val = load<f64>(t0Off + 12);

    // Skip section / file terminators ('0' or 'Q')
    if (t0Kind == TOK_NUM && t0Val == 0.0) continue;
    if (t0Kind == TOK_IDENT && t0Len == 1 && toUpperAscii(load<u8>(t0Ptr)) == 81 /* 'Q' */) continue;

    let ibus: i32 = 0;
    let jbus: i32 = 0;
    let modelOff: u32 = 0;
    let modelLen: u16 = 0;
    let idOff: u32 = 0;
    let idLen: u16 = 0;
    let paramStartIdx: i32 = 0;
    let schemaId: u16 = 0;
    let category: u8 = 8;
    let headerKind: u8 = HDR_MACHINE;
    let usrIc: i32 = -1;
    let usrIt: i32 = -1;
    let usrNi: i32 = -1;
    let usrNc: i32 = -1;
    let usrNs: i32 = -1;
    let usrNv: i32 = -1;

    const t1Off = tokBuf + <usize>(fTok + 1) * tokStride;
    const t1Kind = load<u8>(t1Off + 6);
    const t1OffVal = load<u32>(t1Off + 0);
    const t1LenVal = load<u16>(t1Off + 4);

    if (t0Kind == TOK_QUOTED) {
      // Quoted device name header: 'DCNAME' 'MODEL' [params...]
      if (nTok < 2) continue;
      idOff = load<u32>(t0Off + 0);
      idLen = load<u16>(t0Off + 4);
      modelOff = t1OffVal;
      modelLen = t1LenVal;
      schemaId = lookupModelSchema(src + <usize>modelOff, <i32>modelLen);
      paramStartIdx = 2;
      if (schemaId > 0) {
        category = unchecked(SCHEMA_CATEGORIES[<i32>schemaId]);
        headerKind = unchecked(SCHEMA_HEADER_KINDS[<i32>schemaId]);
      } else {
        category = classifyPrefixCategory(src + <usize>modelOff, <i32>modelLen);
        headerKind = HDR_DC2T;
      }
    } else if (t0Kind == TOK_NUM && t1Kind == TOK_QUOTED) {
      // Standard IBUS 'MODEL' ...
      ibus = <i32>t0Val;
      if (ibus <= 0) continue;
      const mPtr = src + <usize>t1OffVal;
      const mLen = <i32>t1LenVal;

      if (isUsrMdlToken(mPtr, mLen) && nTok >= 4) {
        // IBUS 'USRMDL' ID 'MODEL' IC IT NI NC NS NV ...
        const t2Off = tokBuf + <usize>(fTok + 2) * tokStride;
        const t3Off = tokBuf + <usize>(fTok + 3) * tokStride;
        idOff = load<u32>(t2Off + 0);
        idLen = load<u16>(t2Off + 4);
        modelOff = load<u32>(t3Off + 0);
        modelLen = load<u16>(t3Off + 4);
        headerKind = HDR_USRMDL;
        schemaId = lookupModelSchema(src + <usize>modelOff, <i32>modelLen);
        category = schemaId > 0 ? unchecked(SCHEMA_CATEGORIES[<i32>schemaId]) : classifyPrefixCategory(src + <usize>modelOff, <i32>modelLen);

        if (nTok >= 10) {
          usrIc = <i32>load<f64>(tokBuf + <usize>(fTok + 4) * tokStride + 12);
          usrIt = <i32>load<f64>(tokBuf + <usize>(fTok + 5) * tokStride + 12);
          usrNi = <i32>load<f64>(tokBuf + <usize>(fTok + 6) * tokStride + 12);
          usrNc = <i32>load<f64>(tokBuf + <usize>(fTok + 7) * tokStride + 12);
          usrNs = <i32>load<f64>(tokBuf + <usize>(fTok + 8) * tokStride + 12);
          usrNv = <i32>load<f64>(tokBuf + <usize>(fTok + 9) * tokStride + 12);
          paramStartIdx = 10;
        } else {
          paramStartIdx = 4;
        }
      } else {
        modelOff = t1OffVal;
        modelLen = t1LenVal;
        schemaId = lookupModelSchema(mPtr, mLen);
        if (schemaId > 0) {
          category = unchecked(SCHEMA_CATEGORIES[<i32>schemaId]);
          headerKind = unchecked(SCHEMA_HEADER_KINDS[<i32>schemaId]);
        } else {
          category = classifyPrefixCategory(mPtr, mLen);
          headerKind = HDR_MACHINE;
        }
        if (headerKind == HDR_BUS) {
          idOff = 0;
          idLen = 0;
          paramStartIdx = 2;
        } else {
          if (nTok < 3) continue;
          const t2Off = tokBuf + <usize>(fTok + 2) * tokStride;
          idOff = load<u32>(t2Off + 0);
          idLen = load<u16>(t2Off + 4);
          paramStartIdx = 3;
        }
      }
    } else if (nTok >= 4) {
      // Check branch header: IBUS JBUS CKT 'MODEL' ...
      const t2Off = tokBuf + <usize>(fTok + 2) * tokStride;
      const t3Off = tokBuf + <usize>(fTok + 3) * tokStride;
      if (t0Kind == TOK_NUM && t1Kind == TOK_NUM && load<u8>(t3Off + 6) == TOK_QUOTED) {
        ibus = <i32>t0Val;
        jbus = <i32>load<f64>(t1Off + 12);
        idOff = load<u32>(t2Off + 0);
        idLen = load<u16>(t2Off + 4);
        modelOff = load<u32>(t3Off + 0);
        modelLen = load<u16>(t3Off + 4);
        schemaId = lookupModelSchema(src + <usize>modelOff, <i32>modelLen);
        category = schemaId > 0 ? unchecked(SCHEMA_CATEGORIES[<i32>schemaId]) : classifyPrefixCategory(src + <usize>modelOff, <i32>modelLen);
        headerKind = HDR_BRANCH;
        paramStartIdx = 4;
      } else {
        continue;
      }
    } else {
      continue;
    }

    // Emit record metadata
    store<u16>(ptrSchemaIds + <usize>finalRecs * 2, schemaId);
    store<u8>(ptrCategories + <usize>finalRecs, category);
    store<u8>(ptrHeaderKinds + <usize>finalRecs, headerKind);
    store<i32>(ptrBus + <usize>finalRecs * 4, ibus);
    store<i32>(ptrBus2 + <usize>finalRecs * 4, jbus);
    store<u32>(ptrModelOff + <usize>finalRecs * 4, modelOff);
    store<u16>(ptrModelLen + <usize>finalRecs * 2, modelLen);
    store<u32>(ptrIdOff + <usize>finalRecs * 4, idOff);
    store<u16>(ptrIdLen + <usize>finalRecs * 2, idLen);
    store<u32>(ptrParamRowOff + <usize>finalRecs * 4, <u32>finalParams);
    store<u32>(ptrSpanStart + <usize>finalRecs * 4, load<u32>(rOff + 8));
    store<u32>(ptrSpanEnd + <usize>finalRecs * 4, load<u32>(rOff + 12));
    store<u32>(ptrSpanLine + <usize>finalRecs * 4, load<u32>(rOff + 16));

    const umOff = ptrUsrMeta + <usize>finalRecs * 24;
    store<i32>(umOff + 0, usrIc);
    store<i32>(umOff + 4, usrIt);
    store<i32>(umOff + 8, usrNi);
    store<i32>(umOff + 12, usrNc);
    store<i32>(umOff + 16, usrNs);
    store<i32>(umOff + 20, usrNv);

    for (let k = paramStartIdx; k < nTok; k++) {
      const tkOff = tokBuf + <usize>(fTok + k) * tokStride;
      const tkKind = load<u8>(tkOff + 6);
      const tkIsInt = load<u8>(tkOff + 7);
      const tkVal = load<f64>(tkOff + 12);
      if (tkKind == TOK_NUM) {
        store<f64>(ptrParamVals + <usize>finalParams * 8, tkVal);
        store<u8>(ptrParamIsInt + <usize>finalParams, tkIsInt);
        finalParams++;
      } else {
        // String ICON (e.g. REPC_A circuit ID '1') -> pack <=4 ASCII chars as negative encoded tag or NaN fallback
        store<f64>(ptrParamVals + <usize>finalParams * 8, NaN);
        // Store token offset into high bits or let TS read string ICON if NaN; better: pack up to 4 bytes into f64 payload?
        // Actually store NaN and keep token offset/len? Simpler: for string ICONs, pack 24-bit offset in isInt=2!
        store<u8>(ptrParamIsInt + <usize>finalParams, 2);
        // Store byte offset and length in upper/lower 32 bits of f64 raw u64!
        const sOff = <u64>load<u32>(tkOff + 0);
        const sLen = <u64>load<u16>(tkOff + 4);
        store<u64>(ptrParamVals + <usize>finalParams * 8, (sOff << 16) | sLen);
        finalParams++;
      }
    }

    finalRecs++;
  }

  store<u32>(ptrParamRowOff + <usize>finalRecs * 4, <u32>finalParams);
  outRecCount = finalRecs;
  outParamCount = finalParams;
  return finalRecs;
}
