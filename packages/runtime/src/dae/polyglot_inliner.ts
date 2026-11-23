// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Cross-Language DAE Inlining & Unboxed Polyglot FFI (GraalVM Cross-Boundary Compilation pattern).
 *
 * 1. `PolyglotDaeInliner`: Lowers foreign-domain components (e.g. SPICE subcircuits, Verilog-A
 *    blocks, Simulink subsystems) supporting `InteropTrait.LowerableDAE` directly into a host
 *    `DAEBuilder` linear-memory arena and emits cross-boundary conservation/signal equations so
 *    alias elimination, index reduction, and BLT tearing optimize globally across language boundaries.
 * 2. `UnboxedExternalFunctionRegistry`: Provides a zero-allocation unboxed `f64` linear-memory
 *    calling convention for opaque external functions (C/Fortran/WASM/FMU) inside integrator loops.
 */

import {
  InteropTrait,
  type LoweredPortBinding,
  type LowerToDaeResult,
  type SymbolInteropRegistry,
} from "../interop/symbol_interop.js";
import { getSymbolDomain, type SymbolId, type SymbolIndex } from "../runtime.js";
import { BinOp, type DAEBuilder, EqKind } from "./wasm_dae.js";

/**
 * Tracks the exact origin `SymbolId` (carrying its 8-bit `LanguageDomainId`) for every
 * variable and equation emitted into a `DAEBuilder` arena, enabling cross-language causal traces.
 */
export class DaeOriginMap {
  private readonly varOrigin = new Map<number, SymbolId>();
  private readonly eqOrigin = new Map<number, SymbolId>();

  public recordVarRange(startVar: number, endVar: number, originSymbolId: SymbolId): void {
    for (let v = startVar; v < endVar; v++) {
      this.varOrigin.set(v, originSymbolId);
    }
  }

  public recordEqRange(startEq: number, endEq: number, originSymbolId: SymbolId): void {
    for (let e = startEq; e < endEq; e++) {
      this.eqOrigin.set(e, originSymbolId);
    }
  }

  public setVarOrigin(varId: number, originSymbolId: SymbolId): void {
    this.varOrigin.set(varId, originSymbolId);
  }

  public setEqOrigin(eqId: number, originSymbolId: SymbolId): void {
    this.eqOrigin.set(eqId, originSymbolId);
  }

  public getVarOrigin(varId: number): SymbolId | undefined {
    return this.varOrigin.get(varId);
  }

  public getEqOrigin(eqId: number): SymbolId | undefined {
    return this.eqOrigin.get(eqId);
  }
}

export interface InlinedComponentHandle {
  readonly symbolId: SymbolId;
  readonly domainId: number;
  readonly prefix: string;
  readonly varRange: readonly [start: number, end: number];
  readonly eqRange: readonly [start: number, end: number];
  readonly portsByName: ReadonlyMap<string, LoweredPortBinding>;
}

/**
 * Coordinates compile-time cross-language DAE inlining into a single shared `DAEBuilder`.
 */
export class PolyglotDaeInliner {
  public readonly originMap: DaeOriginMap;

  constructor(
    private readonly interopRegistry: SymbolInteropRegistry,
    originMap?: DaeOriginMap,
  ) {
    this.originMap = originMap ?? new DaeOriginMap();
  }

  /**
   * Returns `true` if `symbolId`'s language domain advertises `InteropTrait.LowerableDAE`.
   */
  public canInline(symbolId: SymbolId, index?: SymbolIndex): boolean {
    const lib = this.interopRegistry.getForSymbol(symbolId);
    if (!lib || !lib.lowerToDAE) return false;
    return (lib.getTraits(symbolId, index) & InteropTrait.LowerableDAE) !== 0;
  }

  /**
   * Lowers a foreign-domain symbol directly into `dae` under `prefix` and records
   * `originSymbolId` provenance for every emitted variable and equation.
   */
  public inlineComponent(
    symbolId: SymbolId,
    dae: DAEBuilder,
    prefix: string,
    parameterOverrides?: ReadonlyMap<string, number>,
    index?: SymbolIndex,
  ): InlinedComponentHandle {
    const lib = this.interopRegistry.getForSymbol(symbolId);
    if (!lib || !lib.lowerToDAE) {
      throw new Error(
        `Symbol 0x${symbolId.toString(16)} (domain ${getSymbolDomain(symbolId)}) does not implement LowerableDAE.`,
      );
    }

    const startVar = dae.getVarCount();
    const startEq = dae.getEqCount();
    const result: LowerToDaeResult = lib.lowerToDAE(symbolId, dae, prefix, parameterOverrides, index);
    const endVar = dae.getVarCount();
    const endEq = dae.getEqCount();

    this.originMap.recordVarRange(startVar, endVar, symbolId);
    this.originMap.recordEqRange(startEq, endEq, symbolId);
    if (typeof dae.setVarOriginSymbol === "function") {
      for (let v = startVar; v < endVar; v++) dae.setVarOriginSymbol(v, symbolId);
    }
    if (typeof dae.setEqOriginSymbol === "function") {
      for (let e = startEq; e < endEq; e++) dae.setEqOriginSymbol(e, symbolId);
    }

    const portsByName = new Map<string, LoweredPortBinding>();
    for (const p of result.ports) {
      portsByName.set(p.portName, p);
    }

    return {
      symbolId,
      domainId: lib.domainId,
      prefix: result.prefix,
      varRange: [startVar, endVar] as const,
      eqRange: [startEq, endEq] as const,
      portsByName,
    };
  }

  /**
   * Emits cross-boundary conservation (`v_a = v_b`, `i_a + i_b = 0`) or causal signal
   * (`sig_a = sig_b`) equations directly into `dae`, returning the newly created equation IDs.
   */
  public bindPorts(
    dae: DAEBuilder,
    portA: LoweredPortBinding,
    portB: LoweredPortBinding,
    originSymbolId?: SymbolId,
  ): number[] {
    const eqIds: number[] = [];

    const refVar = (varIdx: number): number => dae.addName(dae.getVarNameId(varIdx));

    // Acausal across/potential equality: v_a = v_b
    if (portA.potentialVarId !== undefined && portB.potentialVarId !== undefined) {
      const lhs = refVar(portA.potentialVarId);
      const rhs = refVar(portB.potentialVarId);
      const eqId = dae.addEquation(EqKind.Simple, lhs, rhs);
      eqIds.push(eqId);
    }

    // Acausal through/flow conservation: i_a + i_b = 0.0
    if (portA.flowVarId !== undefined && portB.flowVarId !== undefined) {
      const flowSum = dae.addBinaryExpr(BinOp.Add, refVar(portA.flowVarId), refVar(portB.flowVarId));
      const zero = dae.addRealLiteral(0.0);
      const eqId = dae.addEquation(EqKind.Simple, flowSum, zero);
      eqIds.push(eqId);
    }

    // Causal signal equality: sig_a = sig_b
    if (portA.signalVarId !== undefined && portB.signalVarId !== undefined) {
      const lhs = refVar(portA.signalVarId);
      const rhs = refVar(portB.signalVarId);
      const eqId = dae.addEquation(EqKind.Simple, lhs, rhs);
      eqIds.push(eqId);
    }

    if (originSymbolId !== undefined) {
      for (const eqId of eqIds) {
        this.originMap.setEqOrigin(eqId, originSymbolId);
        if (typeof dae.setEqOriginSymbol === "function") {
          dae.setEqOriginSymbol(eqId, originSymbolId);
        }
      }
    }

    return eqIds;
  }

  /**
   * Emits N-way acausal junction equations (`N >= 2`) for a shared physical node where
   * multiple ports meet (e.g. a 3-way electrical tee `r1.n`, `c1.p`, `r2.p`):
   *   - `N - 1` across/potential equalities: `v_0 = v_1`, ..., `v_0 = v_{N-1}`
   *   - `1` N-way through/flow conservation (KCL) equation: `i_0 + i_1 + ... + i_{N-1} = 0.0`
   *   - `N - 1` causal fan-out equalities for signal ports (`sig_0 = sig_k`)
   */
  public bindPortJunction(dae: DAEBuilder, ports: readonly LoweredPortBinding[], originSymbolId?: SymbolId): number[] {
    if (ports.length < 2) return [];
    if (ports.length === 2) {
      return this.bindPorts(dae, ports[0]!, ports[1]!, originSymbolId);
    }

    const eqIds: number[] = [];
    const refVar = (varIdx: number): number => dae.addName(dae.getVarNameId(varIdx));

    // 1. N - 1 potential equalities against anchor port
    const potentialPorts = ports.filter((p) => p.potentialVarId !== undefined);
    if (potentialPorts.length >= 2) {
      const anchor = potentialPorts[0]!;
      for (let k = 1; k < potentialPorts.length; k++) {
        const eqId = dae.addEquation(
          EqKind.Simple,
          refVar(anchor.potentialVarId!),
          refVar(potentialPorts[k]!.potentialVarId!),
        );
        eqIds.push(eqId);
      }
    }

    // 2. Single N-way KCL flow conservation equation: i_0 + i_1 + ... + i_{N-1} = 0.0
    const flowPorts = ports.filter((p) => p.flowVarId !== undefined);
    if (flowPorts.length >= 2) {
      let sumExpr = refVar(flowPorts[0]!.flowVarId!);
      for (let k = 1; k < flowPorts.length; k++) {
        sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, refVar(flowPorts[k]!.flowVarId!));
      }
      const eqId = dae.addEquation(EqKind.Simple, sumExpr, dae.addRealLiteral(0.0));
      eqIds.push(eqId);
    }

    // 3. N - 1 causal signal fan-out equalities
    const signalPorts = ports.filter((p) => p.signalVarId !== undefined);
    if (signalPorts.length >= 2) {
      const anchor = signalPorts[0]!;
      for (let k = 1; k < signalPorts.length; k++) {
        const eqId = dae.addEquation(EqKind.Simple, refVar(anchor.signalVarId!), refVar(signalPorts[k]!.signalVarId!));
        eqIds.push(eqId);
      }
    }

    if (originSymbolId !== undefined) {
      for (const eqId of eqIds) {
        this.originMap.setEqOrigin(eqId, originSymbolId);
        if (typeof dae.setEqOriginSymbol === "function") {
          dae.setEqOriginSymbol(eqId, originSymbolId);
        }
      }
    }

    return eqIds;
  }
}

/**
 * Unboxed external function signature operating directly on pre-allocated `Float64Array`
 * linear-memory slices (zero per-call heap allocations in numerical integrator loops).
 * Returns `0` on success, non-zero error code on failure.
 */
export type UnboxedExternalFn = (
  memory: Float64Array,
  argsOffset: number,
  argCount: number,
  outOffset: number,
  outCount: number,
) => number;

/**
 * Registry of unboxed polyglot external functions sharing a single reusable `Float64Array`
 * scratch arena so numerical integrators invoke foreign C/WASM/FMU routines without JS boxing.
 */
export class UnboxedExternalFunctionRegistry {
  private readonly fnByName = new Map<string, number>();
  private readonly fns: UnboxedExternalFn[] = [];
  private readonly scratch: Float64Array;

  constructor(scratchDoubles = 1024) {
    this.scratch = new Float64Array(scratchDoubles);
  }

  /** Registers an unboxed external function and returns its compact integer `funcId`. */
  public register(name: string, fn: UnboxedExternalFn): number {
    const existing = this.fnByName.get(name);
    if (existing !== undefined) {
      this.fns[existing] = fn;
      return existing;
    }
    const id = this.fns.length;
    this.fns.push(fn);
    this.fnByName.set(name, id);
    return id;
  }

  public getId(name: string): number {
    return this.fnByName.get(name) ?? -1;
  }

  /**
   * Invokes `funcId` directly over an external linear-memory `Float64Array` view with zero allocations.
   */
  public invokeInPlace(
    funcId: number,
    memory: Float64Array,
    argsOffset: number,
    argCount: number,
    outOffset: number,
    outCount: number,
  ): number {
    const fn = this.fns[funcId];
    if (!fn) return -1;
    return fn(memory, argsOffset, argCount, outOffset, outCount);
  }

  /**
   * Convenience scalar invocation using the pre-allocated scratch buffer (still zero heap allocations).
   */
  public invokeScalar1(funcId: number, arg0: number): number {
    const fn = this.fns[funcId];
    if (!fn) return Number.NaN;
    this.scratch[0] = arg0;
    const status = fn(this.scratch, 0, 1, 1, 1);
    return status === 0 ? this.scratch[1]! : Number.NaN;
  }

  /**
   * Convenience 2-argument scalar invocation using the pre-allocated scratch buffer.
   */
  public invokeScalar2(funcId: number, arg0: number, arg1: number): number {
    const fn = this.fns[funcId];
    if (!fn) return Number.NaN;
    this.scratch[0] = arg0;
    this.scratch[1] = arg1;
    const status = fn(this.scratch, 0, 2, 2, 1);
    return status === 0 ? this.scratch[2]! : Number.NaN;
  }

  /**
   * Invokes `funcId` with an arbitrary number of scalar arguments using the pre-allocated
   * scratch buffer (zero heap allocations).
   */
  public invokeScalarN(funcId: number, args: readonly number[]): number {
    const fn = this.fns[funcId];
    if (!fn) return Number.NaN;
    const n = args.length;
    if (n + 1 > this.scratch.length) return Number.NaN;
    for (let i = 0; i < n; i++) {
      this.scratch[i] = args[i]!;
    }
    const status = fn(this.scratch, 0, n, n, 1);
    return status === 0 ? this.scratch[n]! : Number.NaN;
  }
}

/** Global default unboxed external function registry consulted by `WasmEvaluator` for zero-GC FFI calls. */
export const defaultUnboxedExternalFunctions = new UnboxedExternalFunctionRegistry();
