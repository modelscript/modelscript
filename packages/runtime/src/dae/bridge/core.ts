// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core WebAssembly `DaeBuilder` arena state, lifecycle, snapshots, provenance,
 * and multi-problem typed facets.
 */

import type { QueryDB, SourceLocation } from "../../runtime.js";
import type { FmuInstanceMetadata } from "../../simulation/fmu_subsystem.js";
import type { StringId } from "../../workspace/wasm_string_pool.js";
import { StringInterner, WasmStringPool } from "../../workspace/wasm_string_pool.js";
import {
  BvpFacet,
  DelayFacet,
  JumpFacet,
  OptimizationFacet,
  StochasticFacet,
  UncertaintyFacet,
} from "../facets/index.js";
import type { DaeWasmExports } from "../problem_types.js";
import { daeFinalizationRegistry, getDefaultWasmExports, type WasmRuntimeExports } from "../wasm_loader.js";
import type {
  ArenaStateMachine,
  DaeDiagnostic,
  DaeDiagnosticRange,
  EnumLiteralDescriptor,
  EqKind,
  ForEquationMeta,
  IfEquationMeta,
  WhenEquationMeta,
} from "./types.js";

export class WasmDaeCore {
  /** WebAssembly runtime instance exports. */
  public readonly exports: DaeWasmExports;
  /** Pointer to the underlying `DaeBuilder` instance in WebAssembly linear memory. */
  public ptr = 0;
  /** String interner shared with the WASM arena for zero-copy identifier resolution. */
  readonly interner: StringInterner;

  /** Interned `StringId` of the flattened model or function name. */
  nameId: StringId = 0;
  /** Interned `StringId` of the model or function description string. */
  descriptionId: StringId = 0;

  /** Modelica class restriction keyword (`"model"`, `"function"`, `"record"`, `"block"`, etc.). */
  classKind = "class";
  /** Whether the class or function is declared `impure`. */
  isImpure = false;
  /** Whether the class contains at least one `algorithm` section. */
  hasAlgorithmSection = false;
  /** Whether the class contains at least one `initial algorithm` section. */
  hasInitialAlgorithmSection = false;
  /** Raw `external` function declaration clause text, or `null` if not an external function. */
  externalDecl: string | null = null;
  /** Optional inline JavaScript implementation source for external functions. */
  jsSource?: string | undefined;
  /** Optional external JavaScript module path for external functions. */
  jsPath?: string | undefined;

  /** Expression arena ID for the Mayer optimization objective term, or `-1` if unset. */
  objectiveExprId: number = -1;
  /** Expression arena ID for the Lagrange optimization integrand term, or `-1` if unset. */
  objectiveIntegrandExprId: number = -1;
  /** Expression arena ID for optimization start time, or `-1` if unset. */
  startTimeExprId: number = -1;
  /** Expression arena ID for optimization final time, or `-1` if unset. */
  finalTimeExprId: number = -1;
  /** List of C header/source include directives from external function annotations. */
  externalIncludes: string[] = [];
  /** Metadata for `ExternalObject` instances declared in the model. */
  externalObjects: {
    name: string;
    type?: string | undefined;
    className?: string | undefined;
    constructorName?: string | undefined;
    destructorName?: string | undefined;
  }[] = [];
  /** Raw annotation strings attached to `equation` sections. */
  equationAnnotations: string[] = [];
  /** Raw annotation strings attached to `algorithm` sections. */
  algorithmAnnotations: string[] = [];
  /** Expression arena IDs of zero-crossing event indicators. */
  eventIndicatorExprIds: number[] = [];
  /** Compiler and flattener diagnostics collected during instantiation. */
  diagnostics: DaeDiagnostic[] = [];

  /** No-op hook retained for backwards compatibility with legacy equation grouping passes. */
  groupEquationsForParity(): void {}

  /** Simulation experiment parameters extracted from the `experiment(...)` annotation. */
  experiment: {
    startTime?: number | undefined;
    stopTime?: number | undefined;
    tolerance?: number | undefined;
    interval?: number | undefined;
    numberOfIntervals?: number | undefined;
    algorithm?: string | undefined;
    __modelscript_equidistantOutput?: boolean | undefined;
  } = {};

  /** Set of variable indices hidden from standard output printing (`HideResult` or internal helpers). */
  public hiddenVarIndices = new Set<number>();
  /** Domain-specific extension metadata (WebGPU, audio clock, surrogate, FEA, CFD, MBSE, FMU). */
  public extensionMetadata: {
    webgpu?:
      | { workgroupSize?: number | undefined; precision?: string | undefined; parallelInstances?: number | undefined }
      | undefined;
    audioClock?:
      | { sampleRate?: number | undefined; targetHz?: number | undefined; realtimeFactor?: number | undefined }
      | undefined;
    surrogate?:
      | Map<
          string,
          { architecture?: string | undefined; datasetUri?: string | undefined; errorTolerance?: number | undefined }
        >
      | undefined;
    feaMesh?:
      | {
          cadUri?: string | undefined;
          meshType?: string | undefined;
          material?: string | undefined;
          loadConnector?: string | undefined;
          feedbackDeflection?: string | undefined;
        }[]
      | undefined;
    cfdFlow?:
      | {
          grid?: number[] | undefined;
          dx?: number | undefined;
          turbulenceModel?: string | undefined;
          velocityVariable?: string | undefined;
          dragForceVariable?: string | undefined;
        }[]
      | undefined;
    mbse?:
      { sysml?: unknown[] | undefined; owl?: unknown[] | undefined; telemetry?: unknown[] | undefined } | undefined;
    expandableBuses?: string[] | undefined;
    outputVars?: Set<string> | undefined;
    isOperatorRecord?: boolean | undefined;
    hasOldInstOption?: boolean | undefined;
    overconstrainedGraph?:
      | {
          roots: Set<string>;
          potentialRoots: Map<string, number>;
          branches: { a: string; b: string }[];
          queriedRoots: Set<string>;
        }
      | undefined;
    fmuInstances?: FmuInstanceMetadata[] | undefined;
    [key: string]: unknown;
  } = {};

  /** Statement index ranges (`{ start, count }`) for each `algorithm` section in the class. */
  public _algorithmSections: { start: number; count: number }[] = [];
  /** Statement index ranges (`{ start, count }`) for each `initial algorithm` section in the class. */
  public _initialAlgorithmSections: { start: number; count: number }[] = [];
  /** Map from statement index to original source location for debugging and diagnostics. */
  public stmtLocations = new Map<number, SourceLocation>();
  /** Boundary node metadata for multi-domain / PDE coupling. */
  public boundaryNodes: Record<string, unknown>[] = [];

  /** Optional Salsa QueryDB reference for on-demand symbol/enumeration lookup during evaluation. */
  public db?: QueryDB | undefined;
  /** Function/flattener metadata flags and source ranges attached during instantiation. */
  public wasInlined?: boolean | undefined;
  public isEarlyInline?: boolean | undefined;
  public isNestedMember?: boolean | undefined;
  public wasCalled?: boolean | undefined;
  public isDerivativeFunction?: boolean | undefined;
  public isOperatorRecord?: boolean | undefined;
  public aliasTo?: string | undefined;
  public isExplicitImpure?: boolean | undefined;
  public cstNode?: { text?: string | undefined } | undefined;
  public ignoredEqIndices?: Set<number> | undefined;
  public stmtRanges?: Map<number, DaeDiagnosticRange> | undefined;
  public fnRange?: DaeDiagnosticRange | undefined;
  public externalInclude?: string | undefined;
  public recordVarFieldExprs?: Map<string, Map<string, number>> | undefined;
  public _runtimeArrayEnv?: Map<string, unknown> | undefined;
  public _lastOutputs?: number[] | undefined;
  public _isRealNameCache?: Map<string, boolean> | undefined;

  // Host-side maps for metadata and structured equations
  /** Map from array variable name to its declared dimension sizes. */
  public namedArrayShapes = new Map<string, number[]>();
  /** Map from unsubscripted array base prefix to the list of scalarized element variable indices. */
  public baseArrayIndices = new Map<string, number[]>();
  /** Map from expression ID to tensor shape dimensions. */
  public exprTensorShapes = new Map<number, number[]>();
  /** Map from equation index to preserved array equation shape dimensions. */
  public equationShapes = new Map<number, number[]>();
  /** Map from variable index to overridden/renamed variable name. */
  public _renamedVars = new Map<number, string>();
  /** Reverse lookup map from overridden/renamed variable name to variable index. */
  public _renamedVarsReverse = new Map<string, number>();

  /** Number of arena variables whose array prefixes have been indexed in `baseArrayIndices`. */
  protected _indexedVarCount = 0;

  /** Map from variable index to array dimension sizes (`number[]`). */
  protected varShapes = new Map<number, number[]>();
  /** Map from variable index to array dimension expression IDs (`number[]`). */
  protected varShapeExprs = new Map<number, number[]>();
  /** Map from variable index to attribute map (`attrName -> exprId`). */
  protected varAttrs = new Map<number, Map<string, number>>();
  /** Map from variable index to explicit binding expression ID. */
  protected varExpressions = new Map<number, number>();
  /** Map from variable index to description string. */
  protected varDescriptions = new Map<number, string>();
  /** Map from equation index to description string. */
  protected eqDescriptions = new Map<number, string>();
  /** Map from variable index to CAD/graphical annotation payload. */
  protected varCadAnnotations = new Map<number, string>();
  /** Map from variable index to custom user-defined type or record name. */
  protected varCustomTypes = new Map<number, string>();
  /** Map from enumeration variable index to its ordered list of enumeration literal descriptors. */
  protected varEnumLiterals = new Map<number, EnumLiteralDescriptor[]>();
  /** Map from `When` equation index to its structured {@link WhenEquationMeta}. */
  protected whenMeta = new Map<number, WhenEquationMeta>();
  /** Map from `For` equation index to its structured {@link ForEquationMeta}. */
  protected forMeta = new Map<number, ForEquationMeta>();
  /** Map from `If` equation index to its structured {@link IfEquationMeta}. */
  protected ifMeta = new Map<number, IfEquationMeta>();
  /** List of synchronous state machines compiled into this arena. */
  public stateMachines: ArenaStateMachine[] = [];
  /** Map from equation index to its character offset range in the originating source file. */
  protected eqSourceRanges = new Map<number, { startOffset: number; endOffset: number }>();
  /** Map from equation index to explicit ordering rank for canonical output. */
  protected eqOrders = new Map<number, number>();
  /** Map from variable index to its character offset range in the originating source file. */
  protected varSourceRanges = new Map<number, { startOffset: number; endOffset: number }>();
  /** Dependency map from parameter name to the set of equation indices referencing that parameter. */
  protected paramNameToEqs = new Map<string, Set<number>>();
  /** Host-side override map for equation kinds not natively stored in the WASM column. */
  protected eqKinds = new Map<number, EqKind>();
  /** Set of equation indices marked as eliminated/removed during vector or structural passes. */
  protected removedEquations = new Set<number>();
  /** Map from equation index to its pre-constant-folding right-hand side expression ID. */
  public origEqRhs = new Map<number, number>();
  /** Arena expression IDs of all `ExprKind.Name` nodes, tracked for fast variable renaming. */
  public nameExprIndices: number[] = [];
  /** Cached Block Lower Triangular (BLT) partitioning result for this arena. */
  public cachedBlt?:
    | {
        sortedEquations: number[];
        blocks: { eqIdxs: number[]; vars: number[] }[];
        varCount: number;
        eqCount: number;
      }
    | undefined;
  /** Current homotopy continuation parameter $\lambda \in [0, 1]$ during initialization. */
  public homotopyLambda?: number | undefined;
  /** Indicates whether this arena has undergone destructive in-place simulation transformations. */
  public isMutatedBySim = false;
  /** Backward-compatible accessor for isMutatedBySim. */
  public get _mutatedBySim(): boolean {
    return this.isMutatedBySim;
  }
  public set _mutatedBySim(val: boolean) {
    this.isMutatedBySim = val;
  }

  /** Host-side overrides for statement `data1` column values when mutated after creation. */
  protected stmtData1Overrides = new Map<number, number>();
  /** Host-side overrides for statement `left` column values when mutated after creation. */
  protected stmtLeftOverrides = new Map<number, number>();

  private _optFacet?: OptimizationFacet | undefined;
  private _sdeFacet?: StochasticFacet | undefined;
  private _bvpFacet?: BvpFacet | undefined;
  private _delayFacet?: DelayFacet | undefined;
  private _jumpFacet?: JumpFacet | undefined;
  private _uncFacet?: UncertaintyFacet | undefined;

  /** Stack of host-side metadata snapshots saved by {@link snapshot} and restored by {@link rollback}. */
  private _hostSnapshots: {
    varShapes: Map<number, number[]>;
    varShapeExprs: Map<number, number[]>;
    varAttrs: Map<number, Map<string, number>>;
    varExpressions: Map<number, number>;
    varDescriptions: Map<number, string>;
    eqDescriptions: Map<number, string>;
    eqKinds: Map<number, EqKind>;
    removedEquations: Set<number>;
    origEqRhs: Map<number, number>;
    whenMeta: Map<number, WhenEquationMeta>;
    forMeta: Map<number, ForEquationMeta>;
    ifMeta: Map<number, IfEquationMeta>;
    nameExprIndicesLen: number;
    paramNameToEqs: Map<string, Set<number>>;
    baseArrayIndices: Map<string, number[]>;
  }[] = [];

  /**
   * Saves a checkpoint snapshot of the current WASM arena lengths and host-side maps
   * so speculative additions can be rolled back.
   */
  private varOriginSymbols?: Map<number, number>;
  private eqOriginSymbols?: Map<number, number>;

  /**
   * Creates a new `WasmDaeBridge` (`DAEBuilder`) instance backed by WebAssembly linear memory.
   *
   * @param wasmExportsOrInterner - Optional WASM exports object or existing `StringInterner`.
   * @param nameOrPtr - Model/function name string, or an existing WASM `DaeBuilder` pointer.
   * @param desc - Optional model/function description comment.
   * @param interner - Optional explicit `StringInterner` instance.
   */
  constructor(
    wasmExportsOrInterner?: WasmRuntimeExports | WebAssembly.Exports | StringInterner | string | null,
    nameOrPtr: string | number = "Model",
    desc = "",
    interner?: StringInterner,
  ) {
    if (
      typeof wasmExportsOrInterner === "object" &&
      wasmExportsOrInterner !== null &&
      !("intern" in wasmExportsOrInterner) &&
      ("dae_createBuilder" in wasmExportsOrInterner ||
        (typeof nameOrPtr === "number" && nameOrPtr !== 0 && "dae_getStringPool" in wasmExportsOrInterner))
    ) {
      this.exports = wasmExportsOrInterner as unknown as DaeWasmExports;
      this.ptr =
        typeof nameOrPtr === "number" && nameOrPtr !== 0
          ? nameOrPtr
          : this.exports.dae_createBuilder
            ? this.exports.dae_createBuilder()
            : 0;
      const poolPtr = this.ptr && this.exports.dae_getStringPool ? this.exports.dae_getStringPool(this.ptr) : 0;
      this.interner = interner ?? new WasmStringPool(this.exports, poolPtr);
      this.nameId = this.interner.intern(typeof nameOrPtr === "string" ? nameOrPtr : "Model");
      this.descriptionId = this.interner.intern(desc);
    } else {
      this.exports = getDefaultWasmExports() as unknown as DaeWasmExports;
      this.ptr =
        typeof nameOrPtr === "number" && nameOrPtr !== 0
          ? nameOrPtr
          : this.exports?.dae_createBuilder
            ? this.exports.dae_createBuilder()
            : 0;
      const poolPtr = this.ptr && this.exports?.dae_getStringPool ? this.exports.dae_getStringPool(this.ptr) : 0;
      const candidateInterner =
        wasmExportsOrInterner instanceof WasmStringPool ||
        (typeof wasmExportsOrInterner === "object" &&
          wasmExportsOrInterner !== null &&
          "intern" in wasmExportsOrInterner &&
          typeof (wasmExportsOrInterner as unknown as StringInterner).intern === "function")
          ? (wasmExportsOrInterner as unknown as StringInterner)
          : null;
      this.interner = candidateInterner ?? interner ?? new WasmStringPool(this.exports, poolPtr);
      const nameStr = typeof nameOrPtr === "string" ? nameOrPtr : "Model";
      this.nameId = this.interner.intern(nameStr);
      this.descriptionId = this.interner.intern(desc);
    }

    if (this.ptr && daeFinalizationRegistry) {
      daeFinalizationRegistry.register(this, { exports: this.exports, ptr: this.ptr }, this);
    }

    if (this.ptr && this.interner) {
      this.syncWasmStringPool();
    }
  }

  /**
   * Synchronizes all strings from this arena's `StringInterner` into the underlying
   * WebAssembly linear memory string pool.
   */
  public syncWasmStringPool(): void {
    if (!this.ptr || !this.exports?.dae_getStringPool) return;
    const spPtr = this.exports.dae_getStringPool(this.ptr);
    if (!spPtr) return;
    const syncable = this.interner as StringInterner & {
      syncToWasmPool?: (exports: DaeWasmExports, targetPoolPtr: number) => void;
    };
    if (this.interner && typeof syncable.syncToWasmPool === "function") {
      syncable.syncToWasmPool(this.exports, spPtr);
    }
  }

  /** Resolved name of the flattened model or function. */
  get name(): string {
    return this.interner.resolve(this.nameId) ?? "Model";
  }
  /** Updates the interned name of the flattened model or function. */
  set name(value: string) {
    this.nameId = this.interner.intern(value);
  }

  /** Resolved description comment of the flattened model or function. */
  get description(): string {
    return this.interner.resolve(this.descriptionId) ?? "";
  }
  /** Updates the interned description comment of the flattened model or function. */
  set description(value: string) {
    this.descriptionId = this.interner.intern(value);
  }

  /** Total number of variables declared in the arena. */
  get varCount(): number {
    return this.getVarCount();
  }

  /** Total number of equations in the arena. */
  get eqCount(): number {
    return this.getEqCount();
  }

  /** Total number of expression nodes in the arena. */
  get exprCount(): number {
    return this.getExprCount();
  }

  /** Total number of algorithm statements in the arena. */
  get stmtCount(): number {
    return this.getStmtCount();
  }

  /** Statement index ranges (`{ start, count }`) for each `algorithm` section. */
  get algorithmSections(): { start: number; count: number }[] {
    return this._algorithmSections;
  }

  /** Statement index ranges (`{ start, count }`) for each `initial algorithm` section. */
  get initialAlgorithmSections(): { start: number; count: number }[] {
    return this._initialAlgorithmSections;
  }

  /**
   * Records a contiguous range of statements as an `algorithm` section.
   *
   * @param startIdx - Index of the first statement in the section.
   * @param count - Number of top-level statements in the section.
   */
  addAlgorithmSection(startIdx: number, count: number): void {
    this._algorithmSections.push({ start: startIdx, count });
  }

  /**
   * Records a contiguous range of statements as an `initial algorithm` section.
   *
   * @param startIdx - Index of the first statement in the section.
   * @param count - Number of top-level statements in the section.
   */
  addInitialAlgorithmSection(startIdx: number, count: number): void {
    this._initialAlgorithmSections.push({ start: startIdx, count });
  }

  /**
   * Associates a source file location with an algorithm statement index for debugging and diagnostics.
   *
   * @param stmtIdx - Statement index in the arena.
   * @param location - Source file location.
   */
  setStmtLocation(stmtIdx: number, location: SourceLocation): void {
    this.stmtLocations.set(stmtIdx, location);
  }

  /**
   * Releases the underlying WebAssembly `DaeBuilder` allocation and clears all host-side metadata maps.
   */
  free(): void {
    if (this.ptr) {
      if (daeFinalizationRegistry) {
        daeFinalizationRegistry.unregister(this);
      }
      if (this.exports?.dae_free) {
        try {
          this.exports.dae_free(this.ptr);
        } catch {
          // ignore
        }
      }
      this.ptr = 0;
    }
    this.baseArrayIndices.clear();
    this._indexedVarCount = 0;
    this._renamedVars.clear();
    this._renamedVarsReverse.clear();
    this.namedArrayShapes.clear();
    this.varShapes.clear();
    this.varShapeExprs.clear();
    this.varAttrs.clear();
    this.varExpressions.clear();
    this.varDescriptions.clear();
    this.eqDescriptions.clear();
    this.varCadAnnotations.clear();
    this.varCustomTypes.clear();
    this.varEnumLiterals.clear();
    this.whenMeta.clear();
    this.forMeta.clear();
    this.ifMeta.clear();
    this.stateMachines = [];
    this.eqSourceRanges.clear();
    this.eqOrders.clear();
    this.varSourceRanges.clear();
    this.paramNameToEqs.clear();
    this.origEqRhs.clear();
    this.nameExprIndices = [];
  }

  /** Returns the WASM problem-class bitmask (`PROBLEM_ODE`, `PROBLEM_OPTIMIZATION`, `PROBLEM_SDE`, etc.). */
  get problemFlags(): number {
    return this.exports?.dae_getProblemFlags ? this.exports.dae_getProblemFlags(this.ptr) >>> 0 : 0;
  }

  setProblemFlag(flag: number): void {
    if (this.exports?.dae_setProblemFlag) {
      this.exports.dae_setProblemFlag(this.ptr, flag >>> 0);
    }
  }

  clearProblemFlag(flag: number): void {
    if (this.exports?.dae_clearProblemFlag) {
      this.exports.dae_clearProblemFlag(this.ptr, flag >>> 0);
    }
  }

  hasProblemFlag(flag: number): boolean {
    return (this.problemFlags & flag) !== 0;
  }

  /**
   * Returns the numeric `start` / initial value stored for the variable at `varId`.
   *
   * @param varId - 0-based variable index.
   * @returns Numeric start value.
   */
  getVarStartValue(varId: number): number {
    return this.exports?.dae_getVarStartValue ? this.exports.dae_getVarStartValue(this.ptr, varId) : 0.0;
  }

  /** First-class Optimization / Math Programming / OCP facet backed by WASM linear memory. */
  get optimization(): OptimizationFacet {
    return (this._optFacet ??= new OptimizationFacet(this));
  }

  /** First-class Stochastic Differential Equation (SDE) facet backed by WASM linear memory. */
  get stochastic(): StochasticFacet {
    return (this._sdeFacet ??= new StochasticFacet(this));
  }

  /** First-class Boundary Value Problem (BVP) facet backed by WASM linear memory. */
  get bvp(): BvpFacet {
    return (this._bvpFacet ??= new BvpFacet(this));
  }

  /** First-class Delay / Neutral Delay Differential Equation (DDE/NDDE) facet backed by WASM linear memory. */
  get delays(): DelayFacet {
    return (this._delayFacet ??= new DelayFacet(this));
  }

  /** First-class Jump Process / Stochastic Simulation Algorithm (SSA) facet backed by WASM linear memory. */
  get jumps(): JumpFacet {
    return (this._jumpFacet ??= new JumpFacet(this));
  }

  /** First-class Uncertainty, Reachability & STL Verification facet backed by WASM linear memory. */
  get uncertainty(): UncertaintyFacet {
    return (this._uncFacet ??= new UncertaintyFacet(this));
  }

  /** Attaches a partitioned 32-bit `SymbolId` provenance tag to variable `varId`. */
  setVarOriginSymbol(varId: number, symbolId: number): void {
    if (!this.varOriginSymbols) this.varOriginSymbols = new Map();
    this.varOriginSymbols.set(varId, symbolId >>> 0);
  }

  /** Returns the partitioned 32-bit `SymbolId` provenance tag for `varId`, if recorded. */
  getVarOriginSymbol(varId: number): number | undefined {
    return this.varOriginSymbols?.get(varId);
  }

  /** Attaches a partitioned 32-bit `SymbolId` provenance tag to equation `eqId`. */
  setEqOriginSymbol(eqId: number, symbolId: number): void {
    if (!this.eqOriginSymbols) this.eqOriginSymbols = new Map();
    this.eqOriginSymbols.set(eqId, symbolId >>> 0);
  }

  /** Returns the partitioned 32-bit `SymbolId` provenance tag for `eqId`, if recorded. */
  getEqOriginSymbol(eqId: number): number | undefined {
    return this.eqOriginSymbols?.get(eqId);
  }

  snapshot(): number {
    if (this.exports?.dae_snapshot) this.exports.dae_snapshot(this.ptr);
    const snap = {
      varShapes: new Map(Array.from(this.varShapes.entries(), ([k, v]) => [k, [...v]])),
      varShapeExprs: new Map(Array.from(this.varShapeExprs.entries(), ([k, v]) => [k, [...v]])),
      varAttrs: new Map(Array.from(this.varAttrs.entries(), ([k, v]) => [k, new Map(v)])),
      varExpressions: new Map(this.varExpressions),
      varDescriptions: new Map(this.varDescriptions),
      eqDescriptions: new Map(this.eqDescriptions),
      eqKinds: new Map(this.eqKinds),
      removedEquations: new Set(this.removedEquations),
      origEqRhs: new Map(this.origEqRhs),
      whenMeta: new Map(
        Array.from(this.whenMeta.entries(), ([k, v]) => [
          k,
          {
            ...v,
            equations: [...v.equations],
            bodyEquations: [...v.bodyEquations],
            elseWhenClauses: v.elseWhenClauses.map((ew) => ({ ...ew, bodyEquations: [...ew.bodyEquations] })),
            ...(v.elseEquations ? { elseEquations: [...v.elseEquations] } : {}),
          },
        ]),
      ),
      forMeta: new Map(
        Array.from(this.forMeta.entries(), ([k, v]) => [
          k,
          { ...v, equations: [...v.equations], bodyEquations: [...v.bodyEquations] },
        ]),
      ),
      ifMeta: new Map(
        Array.from(this.ifMeta.entries(), ([k, v]) => [
          k,
          {
            ...v,
            thenEquations: [...v.thenEquations],
            elseIfClauses: v.elseIfClauses.map((ei) => ({ ...ei, bodyEquations: [...ei.bodyEquations] })),
            elseEquations: v.elseEquations ? [...v.elseEquations] : [],
          },
        ]),
      ),
      nameExprIndicesLen: this.nameExprIndices.length,
      paramNameToEqs: new Map(Array.from(this.paramNameToEqs.entries(), ([k, v]) => [k, new Set(v)])),
      baseArrayIndices: new Map(Array.from(this.baseArrayIndices.entries(), ([k, v]) => [k, [...v]])),
    };
    this._hostSnapshots.push(snap);
    return this._hostSnapshots.length - 1;
  }

  /**
   * Rolls back the WASM arena lengths and host-side maps to the most recently saved {@link snapshot}.
   */
  rollback(snapId?: number): void {
    if (this.exports?.dae_rollback) this.exports.dae_rollback(this.ptr);
    let snap = undefined;
    if (snapId !== undefined && snapId >= 0 && snapId < this._hostSnapshots.length) {
      snap = this._hostSnapshots[snapId];
      this._hostSnapshots.length = snapId;
    } else {
      snap = this._hostSnapshots.pop();
    }
    if (snap) {
      this.varShapes = snap.varShapes;
      this.varShapeExprs = snap.varShapeExprs;
      this.varAttrs = snap.varAttrs;
      this.varExpressions = snap.varExpressions;
      this.varDescriptions = snap.varDescriptions;
      this.eqDescriptions = snap.eqDescriptions;
      this.eqKinds = snap.eqKinds;
      this.removedEquations = snap.removedEquations;
      this.origEqRhs = snap.origEqRhs;
      this.whenMeta = snap.whenMeta;
      this.forMeta = snap.forMeta;
      this.ifMeta = snap.ifMeta;
      this.nameExprIndices.length = snap.nameExprIndicesLen;
      this.paramNameToEqs = snap.paramNameToEqs;
      this.baseArrayIndices = snap.baseArrayIndices;
      this._indexedVarCount = this.varCount;
    }
  }

  /**
   * Returns the total number of variables in the WASM arena.
   */
  getVarCount(): number {
    return this.exports?.dae_getVarCount ? this.exports.dae_getVarCount(this.ptr) : 0;
  }

  /**
   * Returns the total number of equations in the WASM arena.
   */
  getEqCount(): number {
    return this.exports?.dae_getEqCount ? this.exports.dae_getEqCount(this.ptr) : 0;
  }

  /**
   * Returns the total number of expression nodes in the WASM arena.
   */
  getExprCount(): number {
    return this.exports?.dae_getExprCount ? this.exports.dae_getExprCount(this.ptr) : 0;
  }

  /**
   * Returns the total number of algorithm statement nodes in the WASM arena.
   */
  getStmtCount(): number {
    return this.exports?.dae_getStmtCount ? this.exports.dae_getStmtCount(this.ptr) : 0;
  }

  /**
   * Estimates the byte footprint of the core struct-of-arrays columns in WASM linear memory.
   */
  estimateMemoryBytes(): number {
    return this.getVarCount() * 32 + this.getEqCount() * 16 + this.getExprCount() * 16 + this.getStmtCount() * 16;
  }
}
