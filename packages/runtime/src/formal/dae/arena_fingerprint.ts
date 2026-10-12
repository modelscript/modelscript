// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Structural fingerprints of DAE arena content.
 *
 * Fingerprints are *content-based* (names and literal values, never arena indices), so two
 * independently flattened arenas of the same model produce the same fingerprint. They are used
 * as cache keys for verification results: a cache hit means the verification input is identical.
 *
 * Soundness: an expression/variable kind that is not understood contributes a unique nonce, so it
 * can never produce a (false) cache hit.
 */

import { DAEBuilder, ExprKind } from "../../dae/wasm_dae.js";

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

let nonce = 0;

/** 2×32-bit FNV-1a style accumulator rendered as a string-friendly pair. */
class Hasher {
  private h1 = 0x811c9dc5;
  private h2 = 0x01000193 ^ 0xdeadbeef;

  str(s: string): void {
    this.num(s.length);
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }

  num(x: number): void {
    f64[0] = x;
    this.byte(u32[0]! & 0xff);
    this.byte((u32[0]! >>> 8) & 0xff);
    this.byte((u32[0]! >>> 16) & 0xff);
    this.byte((u32[0]! >>> 24) & 0xff);
    this.byte(u32[1]! & 0xff);
    this.byte((u32[1]! >>> 8) & 0xff);
    this.byte((u32[1]! >>> 16) & 0xff);
    this.byte((u32[1]! >>> 24) & 0xff);
  }

  sub(h: string): void {
    this.str(h);
  }

  private byte(b: number): void {
    this.h1 = Math.imul(this.h1 ^ b, 0x01000193) >>> 0;
    this.h2 = Math.imul(this.h2 ^ (b + 0x9e), 0x85ebca6b) >>> 0;
    this.h2 = (this.h2 ^ (this.h2 >>> 13)) >>> 0;
  }

  digest(): string {
    return `${this.h1.toString(16)}-${this.h2.toString(16)}`;
  }
}

/** Content hash of an expression tree (memoised per call). */
export function exprFingerprint(arena: DAEBuilder, exprId: number, memo: Map<number, string> = new Map()): string {
  if (exprId < 0) return "∅";
  const hit = memo.get(exprId);
  if (hit !== undefined) return hit;
  const h = new Hasher();
  const kind = arena.getExprKind(exprId);
  h.num(kind);
  switch (kind) {
    case ExprKind.RealLiteral:
      h.num(arena.getExprRealValue(exprId));
      break;
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
      h.num(arena.getExprData1(exprId));
      break;
    case ExprKind.Name:
      h.str(arena.interner.resolve(arena.getExprData1(exprId)) ?? "?");
      break;
    case ExprKind.Binary:
      h.num(arena.getExprData1(exprId));
      h.sub(exprFingerprint(arena, arena.getExprLeft(exprId), memo));
      h.sub(exprFingerprint(arena, arena.getExprRight(exprId), memo));
      break;
    case ExprKind.Unary:
    case ExprKind.Negate:
      h.num(arena.getExprData1(exprId));
      h.sub(exprFingerprint(arena, arena.getExprLeft(exprId), memo));
      break;
    case ExprKind.Call: {
      h.str(arena.interner.resolve(arena.getExprData1(exprId)) ?? "?");
      const argc = arena.getExprRight(exprId);
      h.num(argc);
      for (let k = 0; k < argc; k++) h.sub(exprFingerprint(arena, arena.getExprLeft(exprId + k), memo));
      break;
    }
    case ExprKind.IfElse:
      h.sub(exprFingerprint(arena, arena.getExprData1(exprId), memo));
      h.sub(exprFingerprint(arena, arena.getExprLeft(exprId), memo));
      h.sub(exprFingerprint(arena, arena.getExprRight(exprId), memo));
      break;
    case ExprKind.Der:
      h.sub(exprFingerprint(arena, arena.getExprData1(exprId), memo));
      break;
    default:
      // Unknown structure: never share a cache entry.
      h.num(++nonce);
      h.num(Math.random());
  }
  const d = h.digest();
  memo.set(exprId, d);
  return d;
}

/** Content fingerprint of the whole DAE (variables, attributes and equations, in order). */
export function arenaFingerprint(arena: DAEBuilder): string {
  const h = new Hasher();
  const memo = new Map<number, string>();
  h.num(arena.varCount);
  for (let i = 0; i < arena.varCount; i++) {
    h.str(arena.getVarName(i) ?? "");
    h.num(arena.getVarType(i));
    h.num(arena.getVarVariability(i));
    h.num(arena.getVarCausality(i));
    h.num(arena.getVarStartValue(i));
    for (const attr of ["min", "max"]) {
      const e = arena.getVarAttrExprId(i, attr);
      h.sub(e === undefined ? "-" : exprFingerprint(arena, e, memo));
    }
  }
  h.num(arena.eqCount);
  for (let e = 0; e < arena.eqCount; e++) {
    h.num(arena.getEqKind(e));
    h.sub(exprFingerprint(arena, arena.getEqLhs(e), memo));
    h.sub(exprFingerprint(arena, arena.getEqRhs(e), memo));
  }
  return h.digest();
}

/** Content fingerprint of one BLT block's equations (independent of equation/variable indices). */
export function blockFingerprint(arena: DAEBuilder, eqIdxs: number[], vars: number[]): string {
  const h = new Hasher();
  const memo = new Map<number, string>();
  h.num(vars.length);
  for (const v of vars) {
    h.str(arena.getVarName(v) ?? "");
    h.num(arena.getVarVariability(v));
    for (const attr of ["min", "max"]) {
      const e = arena.getVarAttrExprId(v, attr);
      h.sub(e === undefined ? "-" : exprFingerprint(arena, e, memo));
    }
  }
  for (const e of eqIdxs) {
    h.num(arena.getEqKind(e));
    h.sub(exprFingerprint(arena, arena.getEqLhs(e), memo));
    h.sub(exprFingerprint(arena, arena.getEqRhs(e), memo));
  }
  return h.digest();
}
