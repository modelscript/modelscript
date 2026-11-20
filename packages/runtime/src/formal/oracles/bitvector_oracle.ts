// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Fixed-Width Bit-Vector Theory Oracle (T_BV).
 *
 * Implements Nelson-Oppen-integrated decision procedure for fixed-width bit-vectors
 * of arbitrary width (up to 128+ bits using BigInt) with UndoTrail backtracking:
 *   - Exact BigInt unsigned intervals [minVal, maxVal] in [0, 2^w - 1]
 *   - Known-zeros / known-ones bitmasks (zeroMask, oneMask) with bidirectional interval tightening
 *   - Modular wraparound arithmetic (bvAdd, bvSub, bvMul, bvNeg)
 *   - Bitwise operations (bvAnd, bvOr, bvXor, bvNot, bvShl, bvLshr)
 *   - Unsigned and signed comparisons (bvUlt, bvUle, bvSlt, bvSle)
 *   - Cross-theory equality, interval bound, and disequality propagation
 */

import type {
  ConflictClause,
  SharedDisequality,
  SharedEquality,
  TheoryLiteral,
  TheoryOracle,
} from "../theory_coordinator.js";
import { hasSharedEqualityWithLiteral, retainSharedEqualitiesWithoutLiteral } from "./retraction_utils.js";
import { UndoTrail } from "./undo_trail.js";

const DEFAULT_BIT_WIDTH = 32;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

interface BvDomain {
  readonly width: number;
  readonly widthExplicit: boolean;
  readonly widthLitId: number | undefined;
  readonly minVal: bigint;
  readonly maxVal: bigint;
  readonly zeroMask: bigint;
  readonly oneMask: bigint;
  readonly justs: readonly number[];
}

type BvBinOp = "bvAdd" | "bvSub" | "bvMul" | "bvAnd" | "bvOr" | "bvXor" | "bvShl" | "bvLshr";
type BvUnaryOp = "bvNot" | "bvNeg";
type BvCmpOp = "bvUlt" | "bvUle" | "bvSlt" | "bvSle";

interface BvBinConstraint {
  op: BvBinOp;
  result: string;
  lhs: string;
  rhs: string;
  width?: number | undefined;
  litId: number;
}

interface BvUnaryConstraint {
  op: BvUnaryOp;
  result: string;
  src: string;
  width?: number | undefined;
  litId: number;
}

interface BvCmpConstraint {
  op: BvCmpOp;
  lhs: string;
  rhs: string;
  width?: number | undefined;
  litId: number;
}

interface BvRelConstraint {
  a: string;
  b: string;
  justs: number[];
  fromShared: boolean;
}

interface BvConflictRecord {
  explanation: string;
  entities: string[];
  justs: number[];
}

const BV_PREDICATES = new Set([
  "bvDeclare",
  "bvConst",
  "bvEq",
  "bvNeq",
  "equal",
  "notEqual",
  "bvAdd",
  "bvSub",
  "bvMul",
  "bvAnd",
  "bvOr",
  "bvXor",
  "bvShl",
  "bvLshr",
  "bvNot",
  "bvNeg",
  "bvUlt",
  "bvUle",
  "bvSlt",
  "bvSle",
]);

function fullMask(width: number): bigint {
  return (1n << BigInt(width)) - 1n;
}

function modulus(width: number): bigint {
  return 1n << BigInt(width);
}

function signBit(width: number): bigint {
  return 1n << BigInt(width - 1);
}

function toSigned(u: bigint, width: number): bigint {
  const sb = signBit(width);
  return u >= sb ? u - modulus(width) : u;
}

function parseBvValue(raw: unknown, width: number): bigint {
  const mod = modulus(width);
  let val: bigint;
  if (typeof raw === "bigint") {
    val = raw;
  } else if (typeof raw === "number") {
    val = BigInt(Math.trunc(raw));
  } else if (typeof raw === "string") {
    val = BigInt(raw.trim());
  } else {
    val = 0n;
  }
  return ((val % mod) + mod) % mod;
}

function mergeJusts(a: readonly number[], b: readonly number[]): number[] {
  if (b.length === 0) return a.slice();
  if (a.length === 0) return b.slice();
  const set = new Set<number>(a);
  for (const id of b) set.add(id);
  return Array.from(set);
}

function bitLength(v: bigint): number {
  if (v <= 0n) return 0;
  return v.toString(2).length;
}

/**
 * Computes the smallest unsigned integer >= lo (within [0, 2^w - 1]) matching (zeroMask, oneMask),
 * or null if no such integer exists.
 */
function nextMatchingAtLeast(lo: bigint, zeroMask: bigint, oneMask: bigint, width: number): bigint | null {
  const mask = fullMask(width);
  if (lo > mask) return null;
  let val = lo < 0n ? 0n : lo;

  for (let b = width - 1; b >= 0; b--) {
    const bit = 1n << BigInt(b);
    const isOne = (val & bit) !== 0n;
    const mustOne = (oneMask & bit) !== 0n;
    const mustZero = (zeroMask & bit) !== 0n;

    if (mustOne && !isOne) {
      const lowerMask = bit - 1n;
      val = (val & ~lowerMask) | bit | (oneMask & lowerMask);
      return val <= mask ? val : null;
    }
    if (mustZero && isOne) {
      // Find lowest bit c > b that is currently 0 in val and not forced 0
      let carryBit = -1;
      for (let c = b + 1; c < width; c++) {
        const cBit = 1n << BigInt(c);
        if ((val & cBit) === 0n && (zeroMask & cBit) === 0n) {
          carryBit = c;
          break;
        }
      }
      if (carryBit === -1) return null;
      const cBit = 1n << BigInt(carryBit);
      const lowerMask = cBit - 1n;
      val = (val & ~lowerMask) | cBit | (oneMask & lowerMask);
      return val <= mask ? val : null;
    }
  }
  return val <= mask ? val : null;
}

/**
 * Computes the largest unsigned integer <= hi (within [0, 2^w - 1]) matching (zeroMask, oneMask),
 * or null if no such integer exists.
 */
function prevMatchingAtMost(hi: bigint, zeroMask: bigint, oneMask: bigint, width: number): bigint | null {
  const mask = fullMask(width);
  if (hi < 0n) return null;
  let val = hi > mask ? mask : hi;

  for (let b = width - 1; b >= 0; b--) {
    const bit = 1n << BigInt(b);
    const isOne = (val & bit) !== 0n;
    const mustOne = (oneMask & bit) !== 0n;
    const mustZero = (zeroMask & bit) !== 0n;

    if (mustZero && isOne) {
      const lowerMask = bit - 1n;
      val = (val & ~bit & ~lowerMask) | (~zeroMask & lowerMask);
      return val >= 0n ? val : null;
    }
    if (mustOne && !isOne) {
      // Find lowest bit c > b that is currently 1 in val and not forced 1
      let borrowBit = -1;
      for (let c = b + 1; c < width; c++) {
        const cBit = 1n << BigInt(c);
        if ((val & cBit) !== 0n && (oneMask & cBit) === 0n) {
          borrowBit = c;
          break;
        }
      }
      if (borrowBit === -1) return null;
      const cBit = 1n << BigInt(borrowBit);
      const lowerMask = cBit - 1n;
      val = (val & ~cBit & ~lowerMask) | (~zeroMask & lowerMask);
      return val >= 0n ? val : null;
    }
  }
  return val >= 0n ? val : null;
}

/**
 * Computes modular inverse of odd `a` modulo 2^w using Newton-Hensel lifting.
 */
function modInversePow2(a: bigint, width: number): bigint {
  const mask = fullMask(width);
  let inv = 1n;
  for (let i = 0; i < width; i++) {
    inv = (inv * (2n - a * inv)) & mask;
  }
  return inv;
}

function countTrailingZeros(zeroMask: bigint, width: number): number {
  let count = 0;
  for (let b = 0; b < width; b++) {
    if ((zeroMask & (1n << BigInt(b))) !== 0n) count++;
    else break;
  }
  return count;
}

export class BitVectorTheoryOracle implements TheoryOracle {
  public readonly name = "BitVectorTheoryOracle";
  public readonly domain = "custom" as const;

  private domains = new Map<string, BvDomain>();
  private binConstraints: BvBinConstraint[] = [];
  private unaryConstraints: BvUnaryConstraint[] = [];
  private cmpConstraints: BvCmpConstraint[] = [];
  private eqConstraints: BvRelConstraint[] = [];
  private neqConstraints: BvRelConstraint[] = [];
  private pendingConflict: BvConflictRecord | null = null;

  private assertedLiterals = new Map<number, TheoryLiteral>();
  private sharedEqualities: SharedEquality[] = [];
  private sharedDisequalities: SharedDisequality[] = [];
  private propagatedEqualities = new Set<string>();
  private propagatedBounds = new Set<string>();
  private propagatedDisequalities = new Set<string>();
  private trail = new UndoTrail();

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.domains.clear();
    this.binConstraints = [];
    this.unaryConstraints = [];
    this.cmpConstraints = [];
    this.eqConstraints = [];
    this.neqConstraints = [];
    this.pendingConflict = null;
    this.assertedLiterals.clear();
    this.sharedEqualities = [];
    this.sharedDisequalities = [];
    this.propagatedEqualities.clear();
    this.propagatedBounds.clear();
    this.propagatedDisequalities.clear();
    this.trail.reset();
  }

  public pushLevel(): void {
    this.trail.pushLevel();
  }

  public popLevel(): void {
    this.trail.popLevel();
  }

  private recordConflict(explanation: string, entities: string[], justs: readonly number[]): void {
    if (this.pendingConflict !== null) return;
    const prev = this.pendingConflict;
    this.trail.record(() => {
      this.pendingConflict = prev;
    });
    this.pendingConflict = {
      explanation,
      entities,
      justs: Array.from(new Set(justs)),
    };
  }

  private ensureVar(varName: string, width?: number, explicit = false, litId?: number): BvDomain {
    const existing = this.domains.get(varName);
    if (!existing) {
      const w = width ?? DEFAULT_BIT_WIDTH;
      const dom: BvDomain = {
        width: w,
        widthExplicit: explicit,
        widthLitId: explicit ? litId : undefined,
        minVal: 0n,
        maxVal: fullMask(w),
        zeroMask: 0n,
        oneMask: 0n,
        justs: litId !== undefined ? [litId] : [],
      };
      this.trail.mapSet(this.domains, varName, dom);
      return dom;
    }

    if (explicit && width !== undefined) {
      if (existing.widthExplicit && existing.width !== width) {
        const justs = [...existing.justs];
        if (existing.widthLitId !== undefined) justs.push(existing.widthLitId);
        if (litId !== undefined) justs.push(litId);
        this.recordConflict(
          `Bit-Vector Width Mismatch: '${varName}' declared with width ${existing.width} and ${width}.`,
          [varName],
          justs,
        );
        return existing;
      }
      if (!existing.widthExplicit && existing.width !== width) {
        const mask = fullMask(width);
        const nextMax = existing.maxVal > mask ? mask : existing.maxVal;
        const next: BvDomain = {
          width,
          widthExplicit: true,
          widthLitId: litId,
          minVal: existing.minVal,
          maxVal: nextMax,
          zeroMask: existing.zeroMask & mask,
          oneMask: existing.oneMask & mask,
          justs: litId !== undefined ? mergeJusts(existing.justs, [litId]) : existing.justs,
        };
        this.trail.mapSet(this.domains, varName, next);
        return next;
      }
      if (!existing.widthExplicit && existing.width === width) {
        const next: BvDomain = {
          ...existing,
          widthExplicit: true,
          widthLitId: litId,
          justs: litId !== undefined ? mergeJusts(existing.justs, [litId]) : existing.justs,
        };
        this.trail.mapSet(this.domains, varName, next);
        return next;
      }
    }

    return existing;
  }

  /**
   * Tightens a variable's domain with new unsigned bounds and known-bit masks.
   * Returns true if the domain strictly shrank.
   */
  private tighten(
    varName: string,
    newMin: bigint,
    newMax: bigint,
    addZeroMask: bigint,
    addOneMask: bigint,
    justs: readonly number[],
  ): boolean {
    const dom = this.ensureVar(varName);
    const mask = fullMask(dom.width);

    let lo = newMin > dom.minVal ? newMin : dom.minVal;
    let hi = newMax < dom.maxVal ? newMax : dom.maxVal;
    let zMask = (dom.zeroMask | addZeroMask) & mask;
    let oMask = (dom.oneMask | addOneMask) & mask;

    const combinedJusts = mergeJusts(dom.justs, justs);

    if ((zMask & oMask) !== 0n) {
      this.recordConflict(
        `Bit-Vector Bitmask Conflict on '${varName}': contradictory known-zero (0x${zMask.toString(16)}) and known-one (0x${oMask.toString(16)}) bits.`,
        [varName],
        combinedJusts,
      );
      return false;
    }

    if (lo > hi) {
      this.recordConflict(
        `Bit-Vector Interval Conflict on '${varName}': empty unsigned interval [${lo}, ${hi}].`,
        [varName],
        combinedJusts,
      );
      return false;
    }

    // Tighten interval endpoints to match known-bit masks
    const matchedLo = nextMatchingAtLeast(lo, zMask, oMask, dom.width);
    const matchedHi = prevMatchingAtMost(hi, zMask, oMask, dom.width);
    if (matchedLo === null || matchedHi === null || matchedLo > matchedHi) {
      this.recordConflict(
        `Bit-Vector Domain Conflict on '${varName}': no value in [${lo}, ${hi}] satisfies bitmasks.`,
        [varName],
        combinedJusts,
      );
      return false;
    }
    lo = matchedLo;
    hi = matchedHi;

    // Tighten known-bit masks from shared MSB prefix of [lo, hi]
    if (lo === hi) {
      oMask |= lo & mask;
      zMask |= ~lo & mask;
    } else {
      const diff = lo ^ hi;
      const diffLen = bitLength(diff);
      if (diffLen < dom.width) {
        const lowerVarying = (1n << BigInt(diffLen)) - 1n;
        const prefixMask = mask & ~lowerVarying;
        oMask |= lo & prefixMask;
        zMask |= ~lo & prefixMask;
      }
    }

    if ((zMask & oMask) !== 0n) {
      this.recordConflict(
        `Bit-Vector Bitmask Conflict on '${varName}': contradictory bitmasks after interval tightening.`,
        [varName],
        combinedJusts,
      );
      return false;
    }

    const changed = lo !== dom.minVal || hi !== dom.maxVal || zMask !== dom.zeroMask || oMask !== dom.oneMask;
    if (changed) {
      this.trail.mapSet(this.domains, varName, {
        ...dom,
        minVal: lo,
        maxVal: hi,
        zeroMask: zMask,
        oneMask: oMask,
        justs: combinedJusts,
      });
    }
    return changed;
  }

  private resolveOpWidth(vars: string[], explicitWidth: number | undefined, litId: number): number {
    if (explicitWidth !== undefined) {
      for (const v of vars) {
        this.ensureVar(v, explicitWidth, true, litId);
      }
      return explicitWidth;
    }
    let foundWidth: number | undefined;
    let foundVar: string | undefined;
    for (const v of vars) {
      const dom = this.domains.get(v);
      if (dom?.widthExplicit) {
        if (foundWidth === undefined) {
          foundWidth = dom.width;
          foundVar = v;
        } else if (foundWidth !== dom.width) {
          const prevDom = this.domains.get(foundVar!)!;
          this.recordConflict(
            `Bit-Vector Width Mismatch between '${foundVar}' (${foundWidth}-bit) and '${v}' (${dom.width}-bit).`,
            [foundVar!, v],
            mergeJusts(mergeJusts(prevDom.justs, dom.justs), [litId]),
          );
          return foundWidth;
        }
      }
    }
    const w = foundWidth ?? DEFAULT_BIT_WIDTH;
    for (const v of vars) {
      this.ensureVar(v, w, foundWidth !== undefined, litId);
    }
    return w;
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    if (!BV_PREDICATES.has(lit.predicate)) {
      return false;
    }
    this.trail.mapSet(this.assertedLiterals, lit.id, lit);
    const { predicate, args, isNegated } = lit;

    switch (predicate) {
      case "bvDeclare": {
        if (args.length < 2) return false;
        const varName = String(args[0]);
        const width = Math.max(1, Math.trunc(Number(args[1])));
        this.ensureVar(varName, width, true, lit.id);
        break;
      }
      case "bvConst": {
        if (args.length < 2) return false;
        const varName = String(args[0]);
        const explicitWidth = args[2] !== undefined ? Math.max(1, Math.trunc(Number(args[2]))) : undefined;
        const dom = this.ensureVar(varName, explicitWidth, explicitWidth !== undefined, lit.id);
        const val = parseBvValue(args[1], dom.width);
        const mask = fullMask(dom.width);
        this.tighten(varName, val, val, ~val & mask, val & mask, [lit.id]);
        break;
      }
      case "bvEq":
      case "equal": {
        if (args.length < 2) return false;
        const a = String(args[0]);
        const b = String(args[1]);
        this.ensureVar(a);
        this.ensureVar(b);
        if (isNegated) {
          this.trail.arrayPush(this.neqConstraints, { a, b, justs: [lit.id], fromShared: false });
        } else {
          this.trail.arrayPush(this.eqConstraints, { a, b, justs: [lit.id], fromShared: false });
        }
        break;
      }
      case "bvNeq":
      case "notEqual": {
        if (args.length < 2) return false;
        const a = String(args[0]);
        const b = String(args[1]);
        this.ensureVar(a);
        this.ensureVar(b);
        if (isNegated) {
          this.trail.arrayPush(this.eqConstraints, { a, b, justs: [lit.id], fromShared: false });
        } else {
          this.trail.arrayPush(this.neqConstraints, { a, b, justs: [lit.id], fromShared: false });
        }
        break;
      }
      case "bvAdd":
      case "bvSub":
      case "bvMul":
      case "bvAnd":
      case "bvOr":
      case "bvXor":
      case "bvShl":
      case "bvLshr": {
        if (args.length < 3) return false;
        const result = String(args[0]);
        const lhs = String(args[1]);
        const rhs = String(args[2]);
        const width = args[3] !== undefined ? Math.max(1, Math.trunc(Number(args[3]))) : undefined;
        this.resolveOpWidth([result, lhs, rhs], width, lit.id);
        this.trail.arrayPush(this.binConstraints, {
          op: predicate,
          result,
          lhs,
          rhs,
          width,
          litId: lit.id,
        });
        break;
      }
      case "bvNot":
      case "bvNeg": {
        if (args.length < 2) return false;
        const result = String(args[0]);
        const src = String(args[1]);
        const width = args[2] !== undefined ? Math.max(1, Math.trunc(Number(args[2]))) : undefined;
        this.resolveOpWidth([result, src], width, lit.id);
        this.trail.arrayPush(this.unaryConstraints, {
          op: predicate,
          result,
          src,
          width,
          litId: lit.id,
        });
        break;
      }
      case "bvUlt":
      case "bvUle":
      case "bvSlt":
      case "bvSle": {
        if (args.length < 2) return false;
        let lhs = String(args[0]);
        let rhs = String(args[1]);
        const width = args[2] !== undefined ? Math.max(1, Math.trunc(Number(args[2]))) : undefined;
        let op: BvCmpOp = predicate;
        if (isNegated) {
          // !(a < b) <=> b <= a, !(a <= b) <=> b < a
          const tmp = lhs;
          lhs = rhs;
          rhs = tmp;
          if (op === "bvUlt") op = "bvUle";
          else if (op === "bvUle") op = "bvUlt";
          else if (op === "bvSlt") op = "bvSle";
          else op = "bvSlt";
        }
        this.resolveOpWidth([lhs, rhs], width, lit.id);
        this.trail.arrayPush(this.cmpConstraints, {
          op,
          lhs,
          rhs,
          width,
          litId: lit.id,
        });
        break;
      }
    }

    return true;
  }

  public retractLiteral(litId: number): void {
    const hasAsserted = this.assertedLiterals.has(litId);
    const hasSharedEq = hasSharedEqualityWithLiteral(this.sharedEqualities, litId);
    const hasSharedDiseq = this.sharedDisequalities.some((d) => (d.justifications ?? []).includes(litId));
    if (!hasAsserted && !hasSharedEq && !hasSharedDiseq) return;

    this.assertedLiterals.delete(litId);
    const savedTrail = this.trail;
    const remaining = Array.from(this.assertedLiterals.values());
    const savedSharedEq = retainSharedEqualitiesWithoutLiteral(this.sharedEqualities, litId);
    const savedSharedDiseq = this.sharedDisequalities.filter((d) => !(d.justifications ?? []).includes(litId));

    this.reset();
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
    for (const eq of savedSharedEq) {
      this.onSharedEquality(eq);
    }
    for (const diseq of savedSharedDiseq) {
      this.onSharedDisequality(diseq);
    }
    this.trail = savedTrail;
  }

  private propagateModAdd(target: string, a: BvDomain, b: BvDomain, w: number, justs: number[]): boolean {
    const mod = modulus(w);
    const mask = fullMask(w);
    const sumLo = a.minVal + b.minVal;
    const sumHi = a.maxVal + b.maxVal;

    let lo = 0n;
    let hi = mask;
    if (sumHi < mod) {
      lo = sumLo;
      hi = sumHi;
    } else if (sumLo >= mod) {
      lo = sumLo - mod;
      hi = sumHi - mod;
    }

    // LSB parity propagation
    let zMask = 0n;
    let oMask = 0n;
    const a0Known = ((a.zeroMask | a.oneMask) & 1n) !== 0n;
    const b0Known = ((b.zeroMask | b.oneMask) & 1n) !== 0n;
    if (a0Known && b0Known) {
      const a0 = a.oneMask & 1n;
      const b0 = b.oneMask & 1n;
      if ((a0 ^ b0) === 1n) oMask |= 1n;
      else zMask |= 1n;
    }

    if (a.minVal === a.maxVal && b.minVal === b.maxVal) {
      const exact = (a.minVal + b.minVal) & mask;
      lo = exact;
      hi = exact;
      oMask |= exact;
      zMask |= ~exact & mask;
    }

    return this.tighten(target, lo, hi, zMask, oMask, justs);
  }

  private propagateModSub(target: string, a: BvDomain, b: BvDomain, w: number, justs: number[]): boolean {
    const mod = modulus(w);
    const mask = fullMask(w);
    const diffLo = a.minVal - b.maxVal;
    const diffHi = a.maxVal - b.minVal;

    let lo = 0n;
    let hi = mask;
    if (diffLo >= 0n) {
      lo = diffLo;
      hi = diffHi;
    } else if (diffHi < 0n) {
      lo = diffLo + mod;
      hi = diffHi + mod;
    }

    let zMask = 0n;
    let oMask = 0n;
    if (a.minVal === a.maxVal && b.minVal === b.maxVal) {
      const exact = (a.minVal - b.minVal + mod) & mask;
      lo = exact;
      hi = exact;
      oMask |= exact;
      zMask |= ~exact & mask;
    }

    return this.tighten(target, lo, hi, zMask, oMask, justs);
  }

  private propagateBinary(c: BvBinConstraint): boolean {
    const rDom = this.domains.get(c.result);
    const aDom = this.domains.get(c.lhs);
    const bDom = this.domains.get(c.rhs);
    if (!rDom || !aDom || !bDom) return false;
    const w = rDom.width;
    const mask = fullMask(w);
    const mod = modulus(w);
    const jAll = mergeJusts(mergeJusts(rDom.justs, aDom.justs), mergeJusts(bDom.justs, [c.litId]));
    let changed = false;

    switch (c.op) {
      case "bvAdd": {
        if (this.propagateModAdd(c.result, aDom, bDom, w, jAll)) changed = true;
        if (this.pendingConflict) return false;
        const r2 = this.domains.get(c.result)!;
        const b2 = this.domains.get(c.rhs)!;
        if (this.propagateModSub(c.lhs, r2, b2, w, jAll)) changed = true;
        if (this.pendingConflict) return false;
        const a2 = this.domains.get(c.lhs)!;
        if (this.propagateModSub(c.rhs, r2, a2, w, jAll)) changed = true;
        break;
      }
      case "bvSub": {
        if (this.propagateModSub(c.result, aDom, bDom, w, jAll)) changed = true;
        if (this.pendingConflict) return false;
        const r2 = this.domains.get(c.result)!;
        const b2 = this.domains.get(c.rhs)!;
        if (this.propagateModAdd(c.lhs, r2, b2, w, jAll)) changed = true;
        if (this.pendingConflict) return false;
        const a2 = this.domains.get(c.lhs)!;
        if (this.propagateModSub(c.rhs, a2, r2, w, jAll)) changed = true;
        break;
      }
      case "bvMul": {
        const prodLo = aDom.minVal * bDom.minVal;
        const prodHi = aDom.maxVal * bDom.maxVal;
        const tz = Math.min(w, countTrailingZeros(aDom.zeroMask, w) + countTrailingZeros(bDom.zeroMask, w));
        const tzMask = tz > 0 ? ((1n << BigInt(tz)) - 1n) & mask : 0n;

        if (aDom.minVal === aDom.maxVal && bDom.minVal === bDom.maxVal) {
          const exact = (aDom.minVal * bDom.minVal) & mask;
          if (this.tighten(c.result, exact, exact, ~exact & mask, exact, jAll)) changed = true;
        } else if (prodHi < mod) {
          if (this.tighten(c.result, prodLo, prodHi, tzMask, 0n, jAll)) changed = true;
        } else if (tzMask !== 0n) {
          if (this.tighten(c.result, 0n, mask, tzMask, 0n, jAll)) changed = true;
        }

        if (this.pendingConflict) return false;
        const r2 = this.domains.get(c.result)!;
        // Exact backward inverse when one factor is odd constant and result is constant
        if (r2.minVal === r2.maxVal && aDom.minVal === aDom.maxVal && (aDom.minVal & 1n) === 1n) {
          const inv = modInversePow2(aDom.minVal, w);
          const exactB = (r2.minVal * inv) & mask;
          if (this.tighten(c.rhs, exactB, exactB, ~exactB & mask, exactB, jAll)) changed = true;
        }
        if (r2.minVal === r2.maxVal && bDom.minVal === bDom.maxVal && (bDom.minVal & 1n) === 1n) {
          const inv = modInversePow2(bDom.minVal, w);
          const exactA = (r2.minVal * inv) & mask;
          if (this.tighten(c.lhs, exactA, exactA, ~exactA & mask, exactA, jAll)) changed = true;
        }
        break;
      }
      case "bvAnd": {
        const fZero = aDom.zeroMask | bDom.zeroMask;
        const fOne = aDom.oneMask & bDom.oneMask;
        const fMax = aDom.maxVal < bDom.maxVal ? aDom.maxVal : bDom.maxVal;
        if (aDom.minVal === aDom.maxVal && bDom.minVal === bDom.maxVal) {
          const exact = aDom.minVal & bDom.minVal;
          if (this.tighten(c.result, exact, exact, ~exact & mask, exact, jAll)) changed = true;
        } else {
          if (this.tighten(c.result, fOne, fMax, fZero, fOne, jAll)) changed = true;
        }
        if (this.pendingConflict) return false;
        const r2 = this.domains.get(c.result)!;
        if (this.tighten(c.lhs, 0n, mask, r2.zeroMask & bDom.oneMask, r2.oneMask, jAll)) changed = true;
        if (this.pendingConflict) return false;
        if (this.tighten(c.rhs, 0n, mask, r2.zeroMask & aDom.oneMask, r2.oneMask, jAll)) changed = true;
        break;
      }
      case "bvOr": {
        const fOne = aDom.oneMask | bDom.oneMask;
        const fZero = aDom.zeroMask & bDom.zeroMask;
        const fMin = aDom.minVal > bDom.minVal ? aDom.minVal : bDom.minVal;
        const sumHi = aDom.maxVal + bDom.maxVal;
        const fMax = sumHi < mask ? sumHi : mask;
        if (aDom.minVal === aDom.maxVal && bDom.minVal === bDom.maxVal) {
          const exact = aDom.minVal | bDom.minVal;
          if (this.tighten(c.result, exact, exact, ~exact & mask, exact, jAll)) changed = true;
        } else {
          if (this.tighten(c.result, fMin, fMax, fZero, fOne, jAll)) changed = true;
        }
        if (this.pendingConflict) return false;
        const r2 = this.domains.get(c.result)!;
        if (this.tighten(c.lhs, 0n, r2.maxVal, r2.zeroMask, r2.oneMask & bDom.zeroMask, jAll)) changed = true;
        if (this.pendingConflict) return false;
        if (this.tighten(c.rhs, 0n, r2.maxVal, r2.zeroMask, r2.oneMask & aDom.zeroMask, jAll)) changed = true;
        break;
      }
      case "bvXor": {
        const fOne = (aDom.oneMask & bDom.zeroMask) | (aDom.zeroMask & bDom.oneMask);
        const fZero = (aDom.oneMask & bDom.oneMask) | (aDom.zeroMask & bDom.zeroMask);
        if (aDom.minVal === aDom.maxVal && bDom.minVal === bDom.maxVal) {
          const exact = aDom.minVal ^ bDom.minVal;
          if (this.tighten(c.result, exact, exact, ~exact & mask, exact, jAll)) changed = true;
        } else {
          if (this.tighten(c.result, 0n, mask, fZero, fOne, jAll)) changed = true;
        }
        if (this.pendingConflict) return false;
        const r2 = this.domains.get(c.result)!;
        // a = res ^ b
        const aOne = (r2.oneMask & bDom.zeroMask) | (r2.zeroMask & bDom.oneMask);
        const aZero = (r2.oneMask & bDom.oneMask) | (r2.zeroMask & bDom.zeroMask);
        if (this.tighten(c.lhs, 0n, mask, aZero, aOne, jAll)) changed = true;
        if (this.pendingConflict) return false;
        // b = res ^ a
        const a2 = this.domains.get(c.lhs)!;
        const bOne = (r2.oneMask & a2.zeroMask) | (r2.zeroMask & a2.oneMask);
        const bZero = (r2.oneMask & a2.oneMask) | (r2.zeroMask & a2.zeroMask);
        if (this.tighten(c.rhs, 0n, mask, bZero, bOne, jAll)) changed = true;
        break;
      }
      case "bvShl": {
        const bw = BigInt(w);
        if (bDom.minVal >= bw) {
          if (this.tighten(c.result, 0n, 0n, mask, 0n, jAll)) changed = true;
        } else if (bDom.minVal === bDom.maxVal) {
          const s = bDom.minVal;
          const lowZeros = s > 0n ? ((1n << s) - 1n) & mask : 0n;
          const fOne = (aDom.oneMask << s) & mask;
          const fZero = ((aDom.zeroMask << s) | lowZeros) & mask;
          if (aDom.minVal === aDom.maxVal) {
            const exact = (aDom.minVal << s) & mask;
            if (this.tighten(c.result, exact, exact, ~exact & mask, exact, jAll)) changed = true;
          } else {
            const maxShifted = aDom.maxVal << s;
            const lo = maxShifted <= mask ? aDom.minVal << s : 0n;
            const hi = maxShifted <= mask ? maxShifted : mask;
            if (this.tighten(c.result, lo, hi, fZero, fOne, jAll)) changed = true;
          }
          if (!this.pendingConflict) {
            const r2 = this.domains.get(c.result)!;
            const backOne = r2.oneMask >> s;
            const backZero = r2.zeroMask >> s;
            if (this.tighten(c.lhs, 0n, mask, backZero, backOne, jAll)) changed = true;
          }
        } else if (bDom.minVal > 0n) {
          const lowZeros = ((1n << bDom.minVal) - 1n) & mask;
          if (this.tighten(c.result, 0n, mask, lowZeros, 0n, jAll)) changed = true;
        }
        break;
      }
      case "bvLshr": {
        const bw = BigInt(w);
        if (bDom.minVal >= bw) {
          if (this.tighten(c.result, 0n, 0n, mask, 0n, jAll)) changed = true;
        } else if (bDom.minVal === bDom.maxVal) {
          const s = bDom.minVal;
          const hiZeros = mask ^ (mask >> s);
          const fOne = aDom.oneMask >> s;
          const fZero = ((aDom.zeroMask >> s) | hiZeros) & mask;
          const lo = aDom.minVal >> s;
          const hi = aDom.maxVal >> s;
          if (this.tighten(c.result, lo, hi, fZero, fOne, jAll)) changed = true;
          if (!this.pendingConflict) {
            const r2 = this.domains.get(c.result)!;
            const backOne = (r2.oneMask << s) & mask;
            const backZero = (r2.zeroMask << s) & mask;
            const backLo = r2.minVal << s;
            const backHi = ((r2.maxVal << s) | ((1n << s) - 1n)) & mask;
            if (this.tighten(c.lhs, backLo, backHi, backZero, backOne, jAll)) changed = true;
          }
        } else {
          const hi = aDom.maxVal >> bDom.minVal;
          const lo = bDom.maxVal >= bw ? 0n : aDom.minVal >> bDom.maxVal;
          if (this.tighten(c.result, lo, hi, 0n, 0n, jAll)) changed = true;
        }
        break;
      }
    }

    return changed;
  }

  private propagateUnary(c: BvUnaryConstraint): boolean {
    const rDom = this.domains.get(c.result);
    const sDom = this.domains.get(c.src);
    if (!rDom || !sDom) return false;
    const w = rDom.width;
    const mask = fullMask(w);
    const mod = modulus(w);
    const jAll = mergeJusts(mergeJusts(rDom.justs, sDom.justs), [c.litId]);
    let changed = false;

    if (c.op === "bvNot") {
      if (this.tighten(c.result, mask - sDom.maxVal, mask - sDom.minVal, sDom.oneMask, sDom.zeroMask, jAll)) {
        changed = true;
      }
      if (this.pendingConflict) return false;
      const r2 = this.domains.get(c.result)!;
      if (this.tighten(c.src, mask - r2.maxVal, mask - r2.minVal, r2.oneMask, r2.zeroMask, jAll)) {
        changed = true;
      }
    } else {
      // bvNeg: res = (-src) mod 2^w
      if (sDom.minVal === sDom.maxVal) {
        const exact = (mod - sDom.minVal) & mask;
        if (this.tighten(c.result, exact, exact, ~exact & mask, exact, jAll)) changed = true;
      } else if (sDom.minVal >= 1n) {
        if (this.tighten(c.result, mod - sDom.maxVal, mod - sDom.minVal, 0n, 0n, jAll)) changed = true;
      }
      if (this.pendingConflict) return false;
      const r2 = this.domains.get(c.result)!;
      if (r2.minVal === r2.maxVal) {
        const exact = (mod - r2.minVal) & mask;
        if (this.tighten(c.src, exact, exact, ~exact & mask, exact, jAll)) changed = true;
      } else if (r2.minVal >= 1n) {
        if (this.tighten(c.src, mod - r2.maxVal, mod - r2.minVal, 0n, 0n, jAll)) changed = true;
      }
    }

    return changed;
  }

  private propagateCmp(c: BvCmpConstraint): boolean {
    const aDom = this.domains.get(c.lhs);
    const bDom = this.domains.get(c.rhs);
    if (!aDom || !bDom) return false;
    const w = aDom.width;
    const mask = fullMask(w);
    const sb = signBit(w);
    const jAll = mergeJusts(mergeJusts(aDom.justs, bDom.justs), [c.litId]);
    let changed = false;

    switch (c.op) {
      case "bvUlt": {
        if (bDom.maxVal === 0n || aDom.minVal === mask) {
          this.recordConflict(
            `Bit-Vector Unsigned Comparison Conflict: '${c.lhs} <u ${c.rhs}' is unsatisfiable.`,
            [c.lhs, c.rhs],
            jAll,
          );
          return false;
        }
        if (this.tighten(c.lhs, 0n, bDom.maxVal - 1n, 0n, 0n, jAll)) changed = true;
        if (this.pendingConflict) return false;
        const a2 = this.domains.get(c.lhs)!;
        if (this.tighten(c.rhs, a2.minVal + 1n, mask, 0n, 0n, jAll)) changed = true;
        break;
      }
      case "bvUle": {
        if (this.tighten(c.lhs, 0n, bDom.maxVal, 0n, 0n, jAll)) changed = true;
        if (this.pendingConflict) return false;
        const a2 = this.domains.get(c.lhs)!;
        if (this.tighten(c.rhs, a2.minVal, mask, 0n, 0n, jAll)) changed = true;
        break;
      }
      case "bvSlt":
      case "bvSle": {
        const strict = c.op === "bvSlt";
        const delta = strict ? 1n : 0n;

        // Exact check if both are fixed constants
        if (aDom.minVal === aDom.maxVal && bDom.minVal === bDom.maxVal) {
          const sa = toSigned(aDom.minVal, w);
          const sbVal = toSigned(bDom.minVal, w);
          const ok = strict ? sa < sbVal : sa <= sbVal;
          if (!ok) {
            this.recordConflict(
              `Bit-Vector Signed Comparison Conflict: ${sa} ${strict ? "<s" : "<=s"} ${sbVal} is false.`,
              [c.lhs, c.rhs],
              jAll,
            );
          }
          return false;
        }

        const aNonNeg = aDom.maxVal < sb;
        const aNeg = aDom.minVal >= sb;
        const bNonNeg = bDom.maxVal < sb;
        const bNeg = bDom.minVal >= sb;

        if (aNonNeg && bNeg) {
          this.recordConflict(
            `Bit-Vector Signed Comparison Conflict: non-negative '${c.lhs}' cannot be ${strict ? "<s" : "<=s"} negative '${c.rhs}'.`,
            [c.lhs, c.rhs],
            jAll,
          );
          return false;
        }

        if (aNonNeg) {
          // b must also be non-negative and b >= a + delta
          if (this.tighten(c.rhs, aDom.minVal + delta, sb - 1n, sb, 0n, jAll)) changed = true;
          if (this.pendingConflict) return false;
          const b2 = this.domains.get(c.rhs)!;
          if (b2.maxVal < delta) {
            this.recordConflict(
              `Bit-Vector Signed Comparison Conflict: '${c.lhs} <s ${c.rhs}' is unsatisfiable.`,
              [c.lhs, c.rhs],
              jAll,
            );
            return false;
          }
          if (this.tighten(c.lhs, 0n, b2.maxVal - delta, sb, 0n, jAll)) changed = true;
        } else if (bNeg) {
          // a must also be negative and a <= b - delta (in unsigned encoding [sb, mask], signed order == unsigned order!)
          if (bDom.maxVal < sb + delta) {
            this.recordConflict(
              `Bit-Vector Signed Comparison Conflict: '${c.lhs} <s ${c.rhs}' is unsatisfiable.`,
              [c.lhs, c.rhs],
              jAll,
            );
            return false;
          }
          if (this.tighten(c.lhs, sb, bDom.maxVal - delta, 0n, sb, jAll)) changed = true;
          if (this.pendingConflict) return false;
          const a2 = this.domains.get(c.lhs)!;
          if (a2.minVal + delta > mask) {
            this.recordConflict(
              `Bit-Vector Signed Comparison Conflict: '${c.lhs} <s ${c.rhs}' is unsatisfiable.`,
              [c.lhs, c.rhs],
              jAll,
            );
            return false;
          }
          if (this.tighten(c.rhs, a2.minVal + delta, mask, 0n, sb, jAll)) changed = true;
        } else if (aNeg && bNonNeg) {
          // Always satisfied (any negative < any non-negative)
        }
        break;
      }
    }

    return changed;
  }

  private saturate(): void {
    if (this.pendingConflict) return;
    let changed = true;
    let iterations = 0;
    const maxIterations = 128;

    while (changed && iterations < maxIterations && !this.pendingConflict) {
      changed = false;
      iterations++;

      // 1. Equalities: intersect domains and masks bidirectionally
      for (const eq of this.eqConstraints) {
        const dA = this.domains.get(eq.a);
        const dB = this.domains.get(eq.b);
        if (!dA || !dB) continue;
        if (dA.widthExplicit && dB.widthExplicit && dA.width !== dB.width) {
          this.recordConflict(
            `Bit-Vector Width Mismatch in equality '${eq.a} == ${eq.b}': ${dA.width}-bit vs ${dB.width}-bit.`,
            [eq.a, eq.b],
            mergeJusts(mergeJusts(dA.justs, dB.justs), eq.justs),
          );
          return;
        }
        const j = mergeJusts(mergeJusts(dA.justs, dB.justs), eq.justs);
        if (this.tighten(eq.a, dB.minVal, dB.maxVal, dB.zeroMask, dB.oneMask, j)) changed = true;
        if (this.pendingConflict) return;
        const dA2 = this.domains.get(eq.a)!;
        if (this.tighten(eq.b, dA2.minVal, dA2.maxVal, dA2.zeroMask, dA2.oneMask, j)) changed = true;
        if (this.pendingConflict) return;
      }

      // 2. Disequalities: exclude endpoint if one side is a fixed constant
      for (const neq of this.neqConstraints) {
        const dA = this.domains.get(neq.a);
        const dB = this.domains.get(neq.b);
        if (!dA || !dB) continue;
        const j = mergeJusts(mergeJusts(dA.justs, dB.justs), neq.justs);
        if (neq.a === neq.b) {
          this.recordConflict(`Bit-Vector Disequality Conflict: '${neq.a} != ${neq.a}' is unsatisfiable.`, [neq.a], j);
          return;
        }
        if (dA.minVal === dA.maxVal && dB.minVal === dB.maxVal && dA.minVal === dB.minVal) {
          this.recordConflict(
            `Bit-Vector Disequality Conflict: '${neq.a}' and '${neq.b}' are both fixed to ${dA.minVal}, contradicting '${neq.a} != ${neq.b}'.`,
            [neq.a, neq.b],
            j,
          );
          return;
        }
        if (dB.minVal === dB.maxVal) {
          const c = dB.minVal;
          if (dA.minVal === c) {
            if (this.tighten(neq.a, c + 1n, dA.maxVal, 0n, 0n, j)) changed = true;
          } else if (dA.maxVal === c) {
            if (this.tighten(neq.a, dA.minVal, c - 1n, 0n, 0n, j)) changed = true;
          }
          if (this.pendingConflict) return;
        }
        if (dA.minVal === dA.maxVal) {
          const c = dA.minVal;
          const dB2 = this.domains.get(neq.b)!;
          if (dB2.minVal === c) {
            if (this.tighten(neq.b, c + 1n, dB2.maxVal, 0n, 0n, j)) changed = true;
          } else if (dB2.maxVal === c) {
            if (this.tighten(neq.b, dB2.minVal, c - 1n, 0n, 0n, j)) changed = true;
          }
          if (this.pendingConflict) return;
        }
      }

      // 3. Unary ops
      for (const u of this.unaryConstraints) {
        if (this.propagateUnary(u)) changed = true;
        if (this.pendingConflict) return;
      }

      // 4. Binary ops
      for (const b of this.binConstraints) {
        if (this.propagateBinary(b)) changed = true;
        if (this.pendingConflict) return;
      }

      // 5. Comparisons
      for (const cmp of this.cmpConstraints) {
        if (this.propagateCmp(cmp)) changed = true;
        if (this.pendingConflict) return;
      }
    }
  }

  private buildConflictLiterals(justIds: readonly number[], entities: string[]): TheoryLiteral[] {
    const result: TheoryLiteral[] = [];
    const seen = new Set<number>();
    for (const id of justIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const lit = this.assertedLiterals.get(id);
      if (lit) result.push(lit);
      else result.push({ id, predicate: "crossTheoryAntecedent", args: entities });
    }
    return result;
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    this.saturate();

    if (this.pendingConflict) {
      const c = this.pendingConflict;
      return {
        isSat: false,
        conflict: {
          literals: this.buildConflictLiterals(c.justs, c.entities),
          explanation: c.explanation,
          culpritEntities: c.entities,
          theoryName: this.name,
        },
      };
    }

    // Check explicit eq vs neq contradiction via transitive equality closure
    if (this.eqConstraints.length > 0 && this.neqConstraints.length > 0) {
      const uf = new Map<string, string>();
      const findLocal = (x: string): string => {
        let curr = x;
        while (uf.has(curr) && uf.get(curr) !== curr) curr = uf.get(curr)!;
        return curr;
      };
      for (const eq of this.eqConstraints) {
        const ra = findLocal(eq.a);
        const rb = findLocal(eq.b);
        if (ra !== rb) uf.set(ra, rb);
      }
      for (const neq of this.neqConstraints) {
        if (findLocal(neq.a) === findLocal(neq.b)) {
          const allJusts = new Set<number>(neq.justs);
          for (const eq of this.eqConstraints) {
            if (findLocal(eq.a) === findLocal(neq.a)) {
              for (const id of eq.justs) allJusts.add(id);
            }
          }
          return {
            isSat: false,
            conflict: {
              literals: this.buildConflictLiterals(Array.from(allJusts), [neq.a, neq.b]),
              explanation: `Bit-Vector Equality/Disequality Conflict: '${neq.a}' and '${neq.b}' are asserted both equal and disequal.`,
              culpritEntities: [neq.a, neq.b],
              theoryName: this.name,
            },
          };
        }
      }
    }

    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    this.saturate();
    if (this.pendingConflict) return [];

    const equalities: SharedEquality[] = [];

    // 1. Propagate point-value equalities (a == b when both fixed to same BigInt)
    const fixedByVal = new Map<string, Array<{ v: string; justs: readonly number[] }>>();
    for (const [v, dom] of this.domains.entries()) {
      if (dom.minVal === dom.maxVal) {
        const valKey = dom.minVal.toString();
        let list = fixedByVal.get(valKey);
        if (!list) {
          list = [];
          fixedByVal.set(valKey, list);
        }
        list.push({ v, justs: dom.justs });
      }
    }
    for (const group of fixedByVal.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length - 1; i++) {
        const a = group[i]!;
        const b = group[i + 1]!;
        const key = a.v < b.v ? `${a.v}==${b.v}` : `${b.v}==${a.v}`;
        if (this.propagatedEqualities.has(key)) continue;
        this.trail.setAdd(this.propagatedEqualities, key);
        const justs = mergeJusts(a.justs, b.justs);
        equalities.push({
          varA: a.v,
          varB: b.v,
          domain: "discrete",
          explanation: `Bit-vector point-value equality ${a.v} == ${b.v}`,
          sourceOracle: this.name,
          justifications: justs,
          justification: justs,
        });
      }
    }

    // 2. Propagate explicit bvEq pairs
    for (const eq of this.eqConstraints) {
      if (eq.fromShared) continue;
      const key = eq.a < eq.b ? `${eq.a}==${eq.b}` : `${eq.b}==${eq.a}`;
      if (this.propagatedEqualities.has(key)) continue;
      this.trail.setAdd(this.propagatedEqualities, key);
      equalities.push({
        varA: eq.a,
        varB: eq.b,
        domain: "discrete",
        explanation: `Bit-vector equality ${eq.a} == ${eq.b}`,
        sourceOracle: this.name,
        justifications: eq.justs,
        justification: eq.justs,
      });
    }

    // 3. Propagate interval bounds [Number(lo), Number(hi)] when within safe integer range
    for (const [v, dom] of this.domains.entries()) {
      if (
        dom.minVal >= MIN_SAFE_BIGINT &&
        dom.minVal <= MAX_SAFE_BIGINT &&
        dom.maxVal >= MIN_SAFE_BIGINT &&
        dom.maxVal <= MAX_SAFE_BIGINT
      ) {
        const loNum = Number(dom.minVal);
        const hiNum = Number(dom.maxVal);
        const bKey = `${v}:[${loNum},${hiNum}]`;
        if (this.propagatedBounds.has(bKey)) continue;
        this.trail.setAdd(this.propagatedBounds, bKey);
        const justs = dom.justs.slice();
        equalities.push({
          varA: v,
          varB: v,
          domain: "interval",
          bounds: [loNum, hiNum],
          explanation: `Bit-vector unsigned interval ${v} in [${loNum}, ${hiNum}]`,
          sourceOracle: this.name,
          justifications: justs,
          justification: justs,
        });
      }
    }

    return equalities;
  }

  public propagateDisequalities(): SharedDisequality[] {
    this.saturate();
    if (this.pendingConflict) return [];

    const result: SharedDisequality[] = [];

    // 1. Explicit bvNeq
    for (const neq of this.neqConstraints) {
      if (neq.fromShared) continue;
      const key = neq.a < neq.b ? `${neq.a}!=${neq.b}` : `${neq.b}!=${neq.a}`;
      if (this.propagatedDisequalities.has(key)) continue;
      this.trail.setAdd(this.propagatedDisequalities, key);
      result.push({
        varA: neq.a,
        varB: neq.b,
        explanation: `Bit-vector disequality ${neq.a} != ${neq.b}`,
        sourceOracle: this.name,
        justifications: neq.justs,
      });
    }

    // 2. Disjoint unsigned intervals or incompatible known bitmasks
    const entries = Array.from(this.domains.entries());
    for (let i = 0; i < entries.length; i++) {
      const [vA, dA] = entries[i]!;
      for (let j = i + 1; j < entries.length; j++) {
        const [vB, dB] = entries[j]!;
        const disjointInterval = dA.maxVal < dB.minVal || dB.maxVal < dA.minVal;
        const disjointBits = (dA.oneMask & dB.zeroMask) !== 0n || (dA.zeroMask & dB.oneMask) !== 0n;
        if (!disjointInterval && !disjointBits) continue;

        const key = vA < vB ? `${vA}!=${vB}` : `${vB}!=${vA}`;
        if (this.propagatedDisequalities.has(key)) continue;
        this.trail.setAdd(this.propagatedDisequalities, key);
        result.push({
          varA: vA,
          varB: vB,
          explanation: `Bit-vector disjoint domains for '${vA}' ([${dA.minVal}, ${dA.maxVal}]) and '${vB}' ([${dB.minVal}, ${dB.maxVal}])`,
          sourceOracle: this.name,
          justifications: mergeJusts(dA.justs, dB.justs),
        });
      }
    }

    return result;
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.trail.arrayPush(this.sharedEqualities, eq);
    const justs = eq.justifications ?? eq.justification ?? [];

    if (eq.varA !== eq.varB) {
      if (this.domains.has(eq.varA) || this.domains.has(eq.varB)) {
        const domA = this.domains.get(eq.varA);
        const domB = this.domains.get(eq.varB);
        const w = domA?.width ?? domB?.width ?? DEFAULT_BIT_WIDTH;
        this.ensureVar(eq.varA, w, false);
        this.ensureVar(eq.varB, w, false);
        this.trail.arrayPush(this.eqConstraints, {
          a: eq.varA,
          b: eq.varB,
          justs: Array.from(new Set(justs)),
          fromShared: true,
        });
      }
    }

    if (eq.bounds && this.domains.has(eq.varA)) {
      const dom = this.domains.get(eq.varA)!;
      const mask = fullMask(dom.width);
      const [rawLo, rawHi] = eq.bounds;
      if (Number.isFinite(rawHi) && rawHi < 0) {
        this.recordConflict(
          `Bit-Vector Bound Conflict on '${eq.varA}': incoming upper bound ${rawHi} < 0.`,
          [eq.varA],
          mergeJusts(dom.justs, justs),
        );
        return;
      }
      const loBig = Number.isFinite(rawLo) ? BigInt(Math.max(0, Math.ceil(rawLo))) : 0n;
      const hiBig = Number.isFinite(rawHi) ? BigInt(Math.floor(rawHi)) : mask;
      const clampedHi = hiBig > mask ? mask : hiBig;
      if (loBig > clampedHi) {
        this.recordConflict(
          `Bit-Vector Bound Conflict on '${eq.varA}': incoming interval [${rawLo}, ${rawHi}] is empty for ${dom.width}-bit unsigned value.`,
          [eq.varA],
          mergeJusts(dom.justs, justs),
        );
        return;
      }
      this.tighten(eq.varA, loBig, clampedHi, 0n, 0n, justs);
    }
  }

  public onSharedDisequality(diseq: SharedDisequality): void {
    this.trail.arrayPush(this.sharedDisequalities, diseq);
    if (this.domains.has(diseq.varA) || this.domains.has(diseq.varB)) {
      this.ensureVar(diseq.varA);
      this.ensureVar(diseq.varB);
      this.trail.arrayPush(this.neqConstraints, {
        a: diseq.varA,
        b: diseq.varB,
        justs: Array.from(new Set(diseq.justifications ?? [])),
        fromShared: true,
      });
    }
  }

  public getModel(): Record<string, bigint> {
    this.saturate();
    const model: Record<string, bigint> = {};
    for (const [v, dom] of this.domains.entries()) {
      model[v] = dom.minVal;
    }
    return model;
  }
}
