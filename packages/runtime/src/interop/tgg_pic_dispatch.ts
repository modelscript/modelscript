// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview TypeScript Host & Parity Wrapper for the WASM TGG Polymorphic Inline Cache (PIC).
 *
 * Mirrors GraalVM/Truffle's monomorphic -> 4-way polymorphic -> megamorphic dispatch hierarchy.
 * Uses compiled AssemblyScript `pic_*` exports in linear memory when hydrated, with exact
 * TypeScript parity fallback and optional `diff` verification mode.
 */

import { getDefaultWasmExports } from "../dae/wasm_dae.js";

export interface WasmPicExports {
  pic_packKey?: (sourceDomainId: number, sourceKindTag: number, targetDomainId: number) => number;
  pic_create?: (initialMegaCapacity?: number) => number;
  pic_destroy?: (ptr: number) => void;
  pic_register?: (ptr: number, key: number, ruleId: number) => void;
  pic_lookup?: (ptr: number, key: number) => number;
  pic_getMonoHits?: (ptr: number) => number;
  pic_getPolyHits?: (ptr: number) => number;
  pic_getMegaHits?: (ptr: number) => number;
  pic_getMisses?: (ptr: number) => number;
}

export interface PicStats {
  monoHits: number;
  polyHits: number;
  megaHits: number;
  misses: number;
  usedWasm: boolean;
}

export type PicDispatchMode = "auto" | "ts" | "diff";

/**
 * Deterministic 16-bit FNV-1a hash of a symbol/CST kind string (e.g. `"class_definition"`),
 * avoiding collision with `0xffff` reserved for empty slots.
 */
export function hashKindTag16(kind: string): number {
  let h = 0x811c9dc5;
  const norm = kind.trim().toLowerCase();
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const tag = ((h >>> 16) ^ (h & 0xffff)) & 0xffff;
  return tag === 0xffff ? 0xfffe : tag;
}

/**
 * Packs `(sourceDomainId: u8, sourceKindTag: u16, targetDomainId: u8)` into a single `u32`.
 */
export function packTggDispatchKey(sourceDomainId: number, sourceKindTag: number, targetDomainId: number): number {
  return (((sourceDomainId & 0xff) << 24) | ((sourceKindTag & 0xffff) << 8) | (targetDomainId & 0xff)) >>> 0;
}

const POLY_SLOTS = 4;

/**
 * Polymorphic Inline Cache dispatcher for cross-language TGG rules and type-map projections.
 */
export class TggPicDispatcher<TRule = unknown> {
  private readonly mode: PicDispatchMode;
  private readonly wasmExports: WasmPicExports | null;
  private wasmPtr = 0;

  // Rule payload table indexed by compact integer ruleId
  private readonly rules: TRule[] = [];

  // Exact TS 3-tier PIC state (used in "ts", fallback, and "diff" verification mode)
  private monoKey = -1;
  private monoVal = -1;
  private readonly polyKeys = new Int32Array(POLY_SLOTS).fill(-1);
  private readonly polyVals = new Int32Array(POLY_SLOTS).fill(-1);
  private polyCount = 0;
  private readonly megaTable = new Map<number, number>();
  private monoHits = 0;
  private polyHits = 0;
  private megaHits = 0;
  private misses = 0;

  constructor(options?: { initialCapacity?: number; mode?: PicDispatchMode; exportsOverride?: WasmPicExports | null }) {
    this.mode = options?.mode ?? "auto";
    const exp =
      options?.exportsOverride !== undefined
        ? options.exportsOverride
        : ((getDefaultWasmExports() as WasmPicExports | null) ?? null);
    const hasWasm = Boolean(
      exp &&
      typeof exp.pic_create === "function" &&
      typeof exp.pic_register === "function" &&
      typeof exp.pic_lookup === "function",
    );
    this.wasmExports = hasWasm ? exp : null;
    if (this.wasmExports && this.mode !== "ts") {
      this.wasmPtr = this.wasmExports.pic_create!(options?.initialCapacity ?? 64);
    }
  }

  public isWasmActive(): boolean {
    return this.wasmPtr !== 0 && this.wasmExports !== null && this.mode !== "ts";
  }

  /**
   * Registers a rule for `(sourceDomainId, sourceKind, targetDomainId)` and returns its integer `ruleId`.
   */
  public register(sourceDomainId: number, sourceKind: string | number, targetDomainId: number, rule: TRule): number {
    const kindTag = typeof sourceKind === "number" ? sourceKind & 0xffff : hashKindTag16(sourceKind);
    const key = packTggDispatchKey(sourceDomainId, kindTag, targetDomainId);
    const ruleId = this.rules.length;
    this.rules.push(rule);

    // Update TS PIC
    if (this.monoKey === key) this.monoVal = ruleId;
    for (let i = 0; i < this.polyCount; i++) {
      if (this.polyKeys[i] === key) this.polyVals[i] = ruleId;
    }
    this.megaTable.set(key, ruleId);

    // Update WASM PIC
    if (this.isWasmActive()) {
      this.wasmExports!.pic_register!(this.wasmPtr, key, ruleId);
    }
    return ruleId;
  }

  /**
   * Resolves the integer `ruleId` for `(sourceDomainId, sourceKind, targetDomainId)`, or `-1` on miss.
   */
  public lookupRuleId(sourceDomainId: number, sourceKind: string | number, targetDomainId: number): number {
    const kindTag = typeof sourceKind === "number" ? sourceKind & 0xffff : hashKindTag16(sourceKind);
    const key = packTggDispatchKey(sourceDomainId, kindTag, targetDomainId);

    if (this.mode === "diff" && this.isWasmActive()) {
      const wasmRes = this.wasmExports!.pic_lookup!(this.wasmPtr, key);
      const tsRes = this.lookupTs(key);
      if (wasmRes !== tsRes) {
        throw new Error(`TggPicDispatcher diff mismatch for key=0x${key.toString(16)}: wasm=${wasmRes}, ts=${tsRes}`);
      }
      return wasmRes;
    }

    if (this.isWasmActive()) {
      return this.wasmExports!.pic_lookup!(this.wasmPtr, key);
    }
    return this.lookupTs(key);
  }

  /**
   * Resolves the registered rule payload directly, or `undefined` on miss.
   */
  public lookup(sourceDomainId: number, sourceKind: string | number, targetDomainId: number): TRule | undefined {
    const id = this.lookupRuleId(sourceDomainId, sourceKind, targetDomainId);
    return id >= 0 ? this.rules[id] : undefined;
  }

  private lookupTs(key: number): number {
    if (this.monoKey === key) {
      this.monoHits++;
      return this.monoVal;
    }

    for (let i = 0; i < this.polyCount; i++) {
      if (this.polyKeys[i] === key) {
        const val = this.polyVals[i]!;
        this.polyHits++;
        this.monoKey = key;
        this.monoVal = val;
        return val;
      }
    }

    const found = this.megaTable.get(key);
    if (found !== undefined) {
      this.megaHits++;
      this.monoKey = key;
      this.monoVal = found;
      if (this.polyCount < POLY_SLOTS) {
        this.polyKeys[this.polyCount] = key;
        this.polyVals[this.polyCount] = found;
        this.polyCount++;
      } else {
        for (let j = 0; j < POLY_SLOTS - 1; j++) {
          this.polyKeys[j] = this.polyKeys[j + 1]!;
          this.polyVals[j] = this.polyVals[j + 1]!;
        }
        this.polyKeys[POLY_SLOTS - 1] = key;
        this.polyVals[POLY_SLOTS - 1] = found;
      }
      return found;
    }

    this.misses++;
    return -1;
  }

  public getStats(): PicStats {
    if (this.isWasmActive() && this.mode !== "ts") {
      const exp = this.wasmExports!;
      return {
        monoHits: exp.pic_getMonoHits ? exp.pic_getMonoHits(this.wasmPtr) : 0,
        polyHits: exp.pic_getPolyHits ? exp.pic_getPolyHits(this.wasmPtr) : 0,
        megaHits: exp.pic_getMegaHits ? exp.pic_getMegaHits(this.wasmPtr) : 0,
        misses: exp.pic_getMisses ? exp.pic_getMisses(this.wasmPtr) : 0,
        usedWasm: true,
      };
    }
    return {
      monoHits: this.monoHits,
      polyHits: this.polyHits,
      megaHits: this.megaHits,
      misses: this.misses,
      usedWasm: false,
    };
  }

  public dispose(): void {
    if (this.wasmPtr !== 0 && this.wasmExports?.pic_destroy) {
      this.wasmExports.pic_destroy(this.wasmPtr);
      this.wasmPtr = 0;
    }
  }
}

export enum TggBytecodeOp {
  Halt = 0,
  MatchTrait = 1,
  CopyParam = 2,
  MapPortConjugated = 3,
  LinkCorr = 4,
}

export interface TggBytecodeSpec {
  requiredTraits?: number;
  copyParams?: readonly string[];
  mapPorts?: readonly string[];
  relationId?: number;
}

export interface TggBytecodeResult {
  matched: boolean;
  copiedParams: number;
  mappedPorts: number;
  linked: boolean;
}

/**
 * Compiles a declarative TGG rule action specification into a compact flat `Uint32Array`
 * bytecode buffer (`[opcode, operand]` pairs) suitable for zero-GC linear-memory execution.
 */
export function compileTggRuleBytecode(spec: TggBytecodeSpec): Uint32Array {
  const words: number[] = [];
  if (spec.requiredTraits) {
    words.push(TggBytecodeOp.MatchTrait, spec.requiredTraits >>> 0);
  }
  for (const p of spec.copyParams ?? []) {
    words.push(TggBytecodeOp.CopyParam, hashKindTag16(p));
  }
  for (const port of spec.mapPorts ?? []) {
    words.push(TggBytecodeOp.MapPortConjugated, hashKindTag16(port));
  }
  if (spec.relationId !== undefined) {
    words.push(TggBytecodeOp.LinkCorr, spec.relationId >>> 0);
  }
  words.push(TggBytecodeOp.Halt, 0);
  return new Uint32Array(words);
}

/**
 * Executes a compiled `Uint32Array` TGG bytecode buffer against a symbol's `InteropTrait` bitmask.
 */
export function executeTggBytecode(bytecode: Uint32Array, srcTraits: number): TggBytecodeResult {
  let copiedParams = 0;
  let mappedPorts = 0;
  let linked = false;

  for (let i = 0; i + 1 < bytecode.length; i += 2) {
    const op = bytecode[i]!;
    const operand = bytecode[i + 1]!;
    if (op === TggBytecodeOp.Halt) break;
    if (op === TggBytecodeOp.MatchTrait) {
      if ((srcTraits & operand) !== operand) {
        return { matched: false, copiedParams: 0, mappedPorts: 0, linked: false };
      }
    } else if (op === TggBytecodeOp.CopyParam) {
      copiedParams++;
    } else if (op === TggBytecodeOp.MapPortConjugated) {
      mappedPorts++;
    } else if (op === TggBytecodeOp.LinkCorr) {
      linked = true;
    }
  }

  return { matched: true, copiedParams, mappedPorts, linked };
}
