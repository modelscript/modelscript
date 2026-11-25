// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Query Flattener (TypeScript Host Bridge).
 *
 * Coordinates host-side Salsa QueryDB / SymbolIndex data with the high-performance
 * native WebAssembly Semantic Flattening Kernel (`assembly/flattener.ts`).
 */

import type { TopologyGraph } from "@modelscript/diagram";
import { ExprKind } from "@modelscript/dsl";
import {
  type Causality,
  DAEBuilder,
  EqKind,
  type QueryDB,
  StmtKind,
  type SymbolEntry,
  type SymbolId,
  type SymbolIndex,
  Variability,
} from "@modelscript/runtime";
import type { SyntaxNode } from "../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../errors.js";
import { tryInlineForeignComponentInModelica } from "../interop.js";
import { validateEnumeration } from "../queries.js";
import {
  collectClassImports,
  hasOperatorRecords,
  isClassPartial,
  isExternalObject,
  isOperatorRecordSym,
  isRecordSym,
  markConditionalParametersFinal,
  validateClassSpecializationRestrictions,
  validateOperatorRecords,
} from "./class/annotations-and-extensions.js";
import { flattenFromTopology, runConnectionsAndFinalize } from "./class/connections-and-streams.js";
import { runPostInstantiationPasses, scalarizeOrPreserveArrays } from "./class/post-flatten-passes.js";
import { runPreFlattenValidation } from "./class/pre-flatten-checks.js";
import { runRecordCallFoldingPass } from "./class/record-fold-pass.js";
import type {
  CstNodeLike,
  DaeDiagnosticWithOrigin,
  DaeWithExtras,
  FlatteningStateWithWasm,
  FlattenOptionsExtended,
  QueryDBWithCaches,
  ResolvedFlattenOptions,
  SymbolMetaLike,
  WasmDiffStats,
} from "./class/types.js";
import {
  classHasConnect,
  classHasRedeclare,
  classHasUnsupportedWasmFeatures,
  getUnsupportedWasmReasons,
} from "./class/wasm-feature-checks.js";
import { tryFlattenWithWasmKernel } from "./class/wasm-kernel-bridge.js";
import {
  checkBalance,
  checkCyclicConstantsAndParameters,
  checkCyclicFunctionComponents,
  checkTypeAliasSpecialization,
  classFindMember,
  collectExprVarNames,
  collectExtendsMods,
  collectInheritedTypeModifiers,
  collectProtectedNames,
  emitFunctionCallEquation,
  evaluateCSTToNumber,
  extractClassEquations,
  extractDescription,
  findComponentDeclarationAt,
  findEquationNodeAt,
  flattenFunction,
  generateExternalObjectFunctions,
  generateFunctions,
  generateOperatorFunctions,
  generateRecordConstructorFor,
  generateRecordConstructors,
  getOrCreateWasmEnv,
  instantiateElements,
  isClassType,
  isComponentHidden,
  isCstNodeProtected,
  isExpandableConnectorClass,
  isFunctionSym,
  isInsideExpandableBus,
  isStaticTrueAssert,
  patchIncremental,
  resolveInnerOuterClass,
  resolveRedeclarationType,
  validateClassModifiers,
  validateComponentBasicAttributes,
  validateFunctionComponentDeclaration,
} from "./elaboration/index.js";
import { lowerCSTExpression, tokenizeCommentStrippedWords } from "./expressions/index.js";
import { postWasmValidate } from "./post-wasm-validate.js";
import { extractCompilerOptions } from "./support/compiler-options.js";
import { extractAndRegisterFmuMetadata, findDirectAnnotationClause } from "./support/fmu-lowering.js";
import { getElementDiagRange } from "./support/range-utils.js";
import { getFlatteningState } from "./support/state.js";
import type { ModelicaModificationEnv } from "./support/wasm-bridge.js";
import type { FlattenerBackend, FlattenOptions, ParentModsLike } from "./types.js";

export class ModelicaFlattener {
  bodySnapshot: DAEBuilder | null = null;
  public db: QueryDB;
  public options: ResolvedFlattenOptions;
  public explicitArrayMode?: "scalarize" | "preserve" | undefined;
  public currentRootClassId: SymbolId = 0;
  public currentClassId: SymbolId = 0;

  public get isOldFrontend(): boolean {
    return Boolean(this.options.isOldFrontend);
  }

  /**
   * Attempts to inline a foreign-domain component (e.g. SPICE, Verilog-A) supporting
   * `InteropTrait.LowerableDAE` directly into `dae` under `prefix`.
   */
  public tryInlineForeignComponent(
    symbolId: SymbolId,
    dae: DAEBuilder,
    prefix: string,
    parameterOverrides?: ReadonlyMap<string, number>,
  ) {
    const symbolIndex = (this.db as unknown as { index?: SymbolIndex }).index;
    return tryInlineForeignComponentInModelica(symbolId, dae, prefix, parameterOverrides, symbolIndex);
  }

  public innerOuterComponents = new Set<string>();
  public innerDeclarations = new Map<string, Map<string, string>>();
  public disabledComponents = new Set<string>();
  public usedExternalObjects = new Set<SymbolId>();
  public usedRecordSymIds = new Set<SymbolId>();
  public usedRecordNames = new Set<string>();
  public implicitInners: { name: string; classId: SymbolId }[] = [];
  /** Element currently being instantiated as an implicit top-level `inner` (MLS §5.4), or null. */
  public implicitInnerElem: SymbolId | null = null;
  public fmuComponents = new Map<string, SymbolId>();
  public failedFunctionIds = new Set<SymbolId>();
  public invalidInterfaceFunctionIds = new Set<SymbolId>();
  public calledFunctionSymIds = new Set<SymbolId>();
  public activeLoopVars = new Set<string>();
  private loopVarCounts = new Map<string, number>();

  public state: FlatteningStateWithWasm = {
    innerOuterComponents: this.innerOuterComponents,
    activeLoopVars: this.activeLoopVars,
    stmtRanges: new Map(),
    deducedOutputShapes: new Map(),
    isRealNameCache: new Map(),
  };

  public pushLoopVar(name: string): void {
    const cnt = this.loopVarCounts.get(name) ?? 0;
    this.loopVarCounts.set(name, cnt + 1);
    this.activeLoopVars.add(name);
  }

  public popLoopVar(name: string): void {
    const cnt = this.loopVarCounts.get(name) ?? 0;
    if (cnt <= 1) {
      this.loopVarCounts.delete(name);
      this.activeLoopVars.delete(name);
    } else {
      this.loopVarCounts.set(name, cnt - 1);
    }
  }

  public usedOperatorFunctions = new Map<string, SymbolId>();
  public currentFlatteningFunctionId: SymbolId | null = null;
  public activeFlatteningFunctionIds = new Set<SymbolId>();
  public currentFunctionEnclosingScope: SymbolId | null = null;
  public pendingArrayBindings = new Map<string, { lhsExprId: number; rhsExprId: number }[]>();
  currentImports = new Map<string, string>();
  public expandableBuses = new Map<string, SymbolId>();
  public evaluatedConstantArrays = new Map<string, unknown>();
  public varConditionDeps = new Map<string, string[]>();
  public currentParentMods?: ParentModsLike | null | undefined;
  public currentBindingCompName?: string | undefined;
  public currentRootDae?: DAEBuilder | null | undefined;
  public instantiatedRecordComponents?: Map<string, Set<string>> | undefined;
  public _flattenedFunctionCache?: Map<string, DAEBuilder> | undefined;
  public _recordCtorCache?: Map<string, DAEBuilder> | undefined;
  private _wasmDiffStats?: WasmDiffStats | null | undefined;
  public enumTypeMap = new Map<string, string[]>();
  private nodeProtectionCache = new WeakMap<object, boolean>();
  public useLocalDirection = false;

  private _fileSymbolsCache = new Map<string, SymbolEntry[]>();
  private _hasOperatorRecordsCache = new Map<SymbolId, boolean>();
  private _classImportsCache = new Map<SymbolId, Map<string, string>>();
  private _redeclareCache = new Map<SymbolId, boolean>();
  private _unsupportedWasmCache = new Map<SymbolId, boolean>();

  public getFileSymbols(resourceId?: string): SymbolEntry[] {
    const cacheKey = resourceId ?? "__all__";
    const cached = this._fileSymbolsCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const result: SymbolEntry[] = [];
    const roots = (this.db.childrenOf(null) ?? []).filter((s) => !resourceId || s.resourceId === resourceId);
    const queue = [...roots];
    while (queue.length > 0) {
      const sym = queue.pop()!;
      result.push(sym);
      const children = this.db.childrenOf(sym.id) ?? [];
      for (const child of children) {
        if (!resourceId || child.resourceId === resourceId) {
          queue.push(child);
        }
      }
    }
    this._fileSymbolsCache.set(cacheKey, result);
    return result;
  }

  public isComponentHidden(elemId: SymbolId): boolean {
    return isComponentHidden(this, elemId);
  }

  public extractDescription(elemCst: CstNodeLike | null | undefined): string | null {
    return extractDescription(elemCst);
  }

  isComponentDisabled(name: string): boolean {
    if (this.disabledComponents.has(name)) return true;
    for (const dis of this.disabledComponents) {
      if (name.startsWith(dis + ".")) return true;
    }
    return false;
  }

  isExternalObject(classId: SymbolId | null | undefined, visited = new Set<SymbolId>()): boolean {
    return isExternalObject(this.db, classId, visited);
  }

  isOperatorRecordSym(sym: SymbolEntry | null | undefined): boolean {
    return isOperatorRecordSym(this.db, sym);
  }

  isClassPartial(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    return isClassPartial(this.db, classId, visited);
  }

  hasOperatorRecords(rootClassId?: SymbolId | null): boolean {
    return hasOperatorRecords(this, this._hasOperatorRecordsCache, rootClassId);
  }

  validateOperatorRecords(dae: DAEBuilder, rootClassId: SymbolId): void {
    validateOperatorRecords(this, dae, rootClassId);
  }

  isRecordSym(sym: SymbolEntry | null | undefined): boolean {
    return isRecordSym(this.db, sym);
  }

  isExpandableConnectorClass(classId: SymbolId): boolean {
    return isExpandableConnectorClass(this.db, classId);
  }

  validateClassSpecializationRestrictions(dae: DAEBuilder, rootClassId: SymbolId): void {
    validateClassSpecializationRestrictions(this.db, dae, rootClassId);
  }

  collectClassImports(classId: SymbolId, visited: Set<SymbolId> = new Set<SymbolId>()): Map<string, string> {
    return collectClassImports(this.db, this._classImportsCache, classId, visited);
  }

  public lowerExpr(
    node: SyntaxNode | null | undefined,
    dae: DAEBuilder,
    prefix = "",
    substitutions?: Map<string, number | string>,
    tupleContext?: boolean,
    isAssignmentLhs?: boolean,
  ): number {
    return lowerCSTExpression(node, dae, {
      prefix,
      substitutions,
      imports: this.currentImports,
      db: this.db,
      flattener: this,
      tupleContext,
      isAssignmentLhs,
    });
  }

  public isStaticTrueAssert(callId: number, dae: DAEBuilder): boolean {
    return isStaticTrueAssert(callId, dae);
  }

  public emitFunctionCallEquation(
    node: SyntaxNode | null | undefined,
    dae: DAEBuilder,
    prefix: string,
    substitutions?: Map<string, number | string>,
    isInitial = false,
    whenIdx = -1,
  ): void {
    emitFunctionCallEquation(this, node, dae, prefix, substitutions, isInitial, whenIdx);
  }

  public collectExprVarNames(exprId: number, dae: DAEBuilder, names: Set<string>, visited = new Set<number>()): void {
    collectExprVarNames(exprId, dae, names, visited);
  }

  private checkCyclicConstantsAndParameters(dae: DAEBuilder, rootClassId: SymbolId): void {
    checkCyclicConstantsAndParameters(dae, rootClassId, this.db, this.options, this.varConditionDeps);
  }

  public checkCyclicFunctionComponents(fn: DAEBuilder, fnSymId: SymbolId): void {
    checkCyclicFunctionComponents(fn, fnSymId, this.db);
  }

  constructor(db: QueryDB, options?: FlattenOptions) {
    this.db = db;
    const dbExt = db as QueryDBWithCaches;
    if (!dbExt._fileSymbolsCache) dbExt._fileSymbolsCache = new Map<string, SymbolEntry[]>();
    if (!dbExt._hasOperatorRecordsCache) dbExt._hasOperatorRecordsCache = new Map<SymbolId, boolean>();
    if (!dbExt._classImportsCache) dbExt._classImportsCache = new Map<SymbolId, Map<string, string>>();
    if (!dbExt._redeclareCache) dbExt._redeclareCache = new Map<SymbolId, boolean>();
    if (!dbExt._unsupportedWasmCache) dbExt._unsupportedWasmCache = new Map<SymbolId, boolean>();
    this._fileSymbolsCache = dbExt._fileSymbolsCache;
    this._hasOperatorRecordsCache = dbExt._hasOperatorRecordsCache;
    this._classImportsCache = dbExt._classImportsCache;
    this._redeclareCache = dbExt._redeclareCache;
    this._unsupportedWasmCache = dbExt._unsupportedWasmCache;
    const omcCompatibility = options?.omcCompatibility ?? false;
    const optsExt = options as FlattenOptionsExtended | undefined;
    const backend: FlattenerBackend =
      options?.backend ?? optsExt?.flattenerBackend ?? (options?.useWasmKernel ? "wasm" : "hybrid");
    this.explicitArrayMode = options?.arrayMode;
    this.options = {
      backend,
      arrayMode: options?.arrayMode ?? (omcCompatibility ? "scalarize" : "preserve"),
      functionInlining: options?.functionInlining ?? false,
      omcCompatibility,
      eliminateAliases: options?.eliminateAliases ?? false,
      useWasmKernel:
        backend === "wasm" || backend === "hybrid" || backend === "diff" || Boolean(options?.useWasmKernel),
      scalarizeBindings: options?.scalarizeBindings ?? false,
      scalarizeMinMax: options?.scalarizeMinMax ?? false,
      flowThreshold: options?.flowThreshold,
      intEnumConversion: Boolean(options?.intEnumConversion),
      isOldFrontend: options?.isOldFrontend ?? false,
    };
  }

  flatten(rootClassId: SymbolId, cachedArena?: DAEBuilder | null, options?: FlattenOptions): DAEBuilder {
    if (options) {
      const optBackend = options.backend ?? (options as FlattenOptionsExtended).flattenerBackend;
      if (optBackend !== undefined) {
        this.options.backend = optBackend;
        this.options.useWasmKernel = optBackend === "wasm" || optBackend === "hybrid" || optBackend === "diff";
      } else if (options.useWasmKernel !== undefined) {
        this.options.useWasmKernel = options.useWasmKernel;
        this.options.backend = options.useWasmKernel ? "wasm" : "ts";
      }
      if (options.arrayMode !== undefined) {
        this.explicitArrayMode = options.arrayMode;
        this.options.arrayMode = options.arrayMode;
      }
      if (options.functionInlining !== undefined) this.options.functionInlining = options.functionInlining;
      if (options.omcCompatibility !== undefined) {
        this.options.omcCompatibility = options.omcCompatibility;
        if (options.arrayMode === undefined && options.omcCompatibility) {
          this.options.arrayMode = "scalarize";
        }
        if (options.eliminateAliases === undefined) {
          this.options.eliminateAliases = false;
        }
      }
      if (options.eliminateAliases !== undefined) this.options.eliminateAliases = options.eliminateAliases;
      if (options.scalarizeBindings !== undefined) this.options.scalarizeBindings = options.scalarizeBindings;
      if (options.isOldFrontend !== undefined) this.options.isOldFrontend = options.isOldFrontend;
    }

    const dae = this.flattenClass(rootClassId, cachedArena);
    if (
      !dae.diagnostics.some((d) => d.severity === "error") &&
      !dae.extensionMetadata?.["isOldFrontend"] &&
      dae.classKind !== "function" &&
      dae.classKind !== "package" &&
      !this.isClassPartial(rootClassId)
    ) {
      const assignedLhsNames = new Set<string>();
      const recordAssignedLhs = (exprId: number): void => {
        if (exprId < 0 || exprId === 0xffffffff) return;
        const ek = dae.getExprKind(exprId);
        if (ek === ExprKind.Name) {
          const lhsName = dae.interner.resolve(dae.getExprData1(exprId));
          if (lhsName) assignedLhsNames.add(lhsName);
        } else if (ek === ExprKind.Tuple) {
          const tCount = dae.getExprData1(exprId);
          for (let ti = 0; ti < tCount; ti++) {
            const subId = dae.getExprLeft(exprId + ti);
            if (subId >= 0 && subId !== 0xffffffff && dae.getExprKind(subId) === ExprKind.Name) {
              const lhsName = dae.interner.resolve(dae.getExprData1(subId));
              if (lhsName) assignedLhsNames.add(lhsName);
            }
          }
        }
      };
      for (let e = 0; e < dae.eqCount; e++) {
        const eqKind = dae.getEqKind(e);
        if (eqKind === EqKind.Simple || eqKind === EqKind.InitialSimple || eqKind === EqKind.Array) {
          recordAssignedLhs(dae.getEqLhs(e));
        }
      }
      for (let s = 0; s < dae.stmtCount; s++) {
        if (dae.getStmtKind(s) === StmtKind.Assignment) {
          recordAssignedLhs(dae.getStmtData1(s));
        }
      }
      const isCoveredByEquationLhs = (vName: string): boolean => {
        if (assignedLhsNames.has(vName)) return true;
        let cur = vName;
        while (cur.length > 0) {
          if (cur.endsWith("]")) {
            const lb = cur.lastIndexOf("[");
            if (lb > 0 && assignedLhsNames.has(cur.slice(0, lb))) return true;
          }
          const dotIdx = cur.lastIndexOf(".");
          if (dotIdx <= 0) break;
          cur = cur.slice(0, dotIdx);
          if (assignedLhsNames.has(cur)) return true;
        }
        return false;
      };
      const resolveNestedParamCstRange = (rootId: SymbolId, vName: string) => {
        const segs = vName.split(".").map((s) => {
          const lb = s.indexOf("[");
          return lb > 0 ? s.slice(0, lb) : s;
        });
        let curClassId: SymbolId | null = rootId;
        let lastSym: SymbolEntry | undefined;
        for (const seg of segs) {
          if (!curClassId) return undefined;
          let found: SymbolEntry | undefined = this.db
            .childrenOf(curClassId)
            .find((c) => c.name === seg && c.kind === "Component");
          if (!found) {
            const all: SymbolEntry[] = this.db.query<SymbolEntry[]>("allElements", curClassId) ?? [];
            found = all.find((c: SymbolEntry) => c.name === seg && c.kind === "Component");
          }
          if (!found) return undefined;
          lastSym = found;
          const nextCid: SymbolId | null = this.db.query<SymbolId | null>("classInstance", found.id);
          curClassId = nextCid;
        }
        if (lastSym) {
          const cst = this.db.cstNode(lastSym.id);
          if (cst) return getElementDiagRange(cst);
        }
        return undefined;
      };
      for (let i = 0; i < dae.varCount; i++) {
        if (!dae.isVarRemoved(i) && dae.getVarVariability(i) === Variability.Parameter) {
          const exprId = dae.getVarExpression(i);
          const startAttr = dae.getVarAttr(i, "start");
          const hasBindingOrStart =
            (exprId !== undefined && exprId >= 0 && exprId !== 0xffffffff) ||
            (startAttr !== undefined && startAttr >= 0 && startAttr !== 0xffffffff);
          const fixedAttr = dae.getVarAttr(i, "fixed");
          const isFixedFalse =
            fixedAttr !== undefined &&
            fixedAttr >= 0 &&
            dae.getExprKind(fixedAttr) === ExprKind.BoolLiteral &&
            dae.getExprData1(fixedAttr) === 0;
          if (!hasBindingOrStart && !isFixedFalse) {
            const vName = dae.getVarName(i);
            if (isCoveredByEquationLhs(vName)) continue;
            let range = dae.getVarSourceRange(i);
            const sym = this.db.childrenOf(rootClassId).find((c) => c.name === vName);
            if (sym) {
              const cst = this.db.cstNode(sym.id);
              if (cst) range = getElementDiagRange(cst);
            } else if (!range && vName.includes(".")) {
              range = resolveNestedParamCstRange(rootClassId, vName);
            }
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.PARTIAL_TYPE_COMPONENT.code,
              message: `Parameter ${vName} has neither value nor start value, and is fixed during initialization (fixed=true).`,
              range,
            });
            break;
          }
        }
      }
    }
    const daeWithClone = dae as DaeWithExtras;
    this.bodySnapshot = typeof daeWithClone.clone === "function" ? daeWithClone.clone() : dae;
    return dae;
  }

  public classHasRedeclare(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    return classHasRedeclare(this.db, this._redeclareCache, classId, visited);
  }

  public classHasConnect(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    return classHasConnect(this.db, classId, visited);
  }

  public classHasUnsupportedWasmFeatures(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    return classHasUnsupportedWasmFeatures(this, this._unsupportedWasmCache, classId, visited);
  }

  public getUnsupportedWasmReasons(classId?: SymbolId | null, visited = new Set<SymbolId>()): string[] {
    return getUnsupportedWasmReasons(this, classId, visited);
  }

  flattenClass(rootClassId: SymbolId, cachedArena?: DAEBuilder | null): DAEBuilder {
    this.currentRootClassId = rootClassId;
    this.currentClassId = rootClassId;
    this.innerOuterComponents.clear();
    this.innerDeclarations.clear();
    this.disabledComponents.clear();
    this.usedExternalObjects.clear();
    this.usedRecordSymIds.clear();
    this.usedRecordNames.clear();
    this.implicitInners = [];
    this.failedFunctionIds.clear();
    this.invalidInterfaceFunctionIds.clear();
    this.calledFunctionSymIds.clear();
    this.activeLoopVars.clear();
    this.loopVarCounts.clear();
    this.pendingArrayBindings.clear();
    this.usedOperatorFunctions.clear();
    this.expandableBuses.clear();
    this.evaluatedConstantArrays.clear();
    this.varConditionDeps.clear();
    this.activeFlatteningFunctionIds.clear();
    this._flattenedFunctionCache?.clear();
    this.currentFlatteningFunctionId = null;
    this.currentFunctionEnclosingScope = null;
    this.currentParentMods = undefined;
    this.bodySnapshot = null;
    this.currentImports = this.collectClassImports(rootClassId);

    const rootSym = this.db.symbol(rootClassId);
    const rootName = rootSym?.name ?? "Model";
    const classCst = this.db.cstNode(rootClassId) as CstNodeLike | null;
    const wasmExports = (classCst?.tree?.facade?.exports ?? classCst?.facade?.exports) as
      ConstructorParameters<typeof DAEBuilder>[0] | undefined;
    let dae = cachedArena ?? new DAEBuilder(wasmExports, rootName, "");
    this.state = getFlatteningState(dae, this);
    this.currentRootDae = dae;
    this.state.innerOuterComponents = this.innerOuterComponents;
    this.state.activeLoopVars = this.activeLoopVars;
    this.state.db = this.db;
    this.state.flattener = this;
    this.state.currentClassId = rootClassId;
    this.state.isRealNameCache?.clear();
    this.state.varPrefixSet?.clear();
    this.state.varPrefixCount = 0;
    this.fmuComponents.clear();

    const rootMeta = rootSym?.metadata as SymbolMetaLike | undefined;
    const rawKind = rootMeta?.classKind ?? rootMeta?.classPrefixes ?? "model";
    let specKind: string | null = null;
    if (typeof rawKind === "string") {
      const words = tokenizeCommentStrippedWords(rawKind);
      if (words.includes("package")) specKind = "package";
      else if (words.includes("function")) specKind = "function";
      else if (words.includes("type")) specKind = "type";
      else if (words.includes("operator") && !words.includes("record")) specKind = "operator";
    }
    dae.classKind = specKind ?? rawKind;

    const rootSymForOldInst = this.db.symbol(rootClassId);
    const compilerOpts = extractCompilerOptions(classCst, this.options, this.db, rootSymForOldInst);
    const isOldInst = compilerOpts.isOldFrontend;
    dae.extensionMetadata["isOldFrontend"] = isOldInst;
    dae.extensionMetadata["scalarizeBindings"] = compilerOpts.scalarizeBindings;
    dae.extensionMetadata["scalarizeMinMax"] = compilerOpts.scalarizeMinMax;
    dae.extensionMetadata["isGen"] = compilerOpts.isGen;
    dae.extensionMetadata["ignoreReplaceable"] = compilerOpts.ignoreReplaceable;
    dae.extensionMetadata["omcCompatibility"] = Boolean(this.options.omcCompatibility);
    dae.extensionMetadata["hasOldInstOption"] = compilerOpts.hasOldInstAnnotation;

    // Pre-flattening structural validation checks
    if (
      runPreFlattenValidation({
        ctx: this,
        rootClassId,
        dae,
        classCst,
        rootSym,
        rootName,
        specKind,
        isOldInst,
        checkTypeAliasSpec: (typeSymId) => this.checkTypeAliasSpecialization(typeSymId),
      })
    ) {
      return dae;
    }

    this.evaluatedConstantArrays.clear();
    if (this.options.omcCompatibility) {
      this.generateFunctions(rootClassId, dae);
    }

    // Native WASM flattening kernel (with optional diff-mode probe & TS fallback)
    const wasmResult = tryFlattenWithWasmKernel({
      ctx: this,
      rootClassId,
      dae,
      cachedArena,
      classCst,
      wasmExports,
      rootName,
      specKind,
      rawKind,
      isOldInst,
    });
    dae = wasmResult.dae;
    const flattenedInWasm = wasmResult.flattenedInWasm;
    const wasmBail = wasmResult.wasmBail;
    this._wasmDiffStats = wasmResult.wasmDiffStats;
    if (wasmResult.earlyReturn) {
      return dae;
    }

    // Validate rootClassId and its inner classes if they are enumerations (EnumInvalidLiteral)
    {
      const enumRootSym = this.db.symbol(rootClassId);
      const rootEnumErr = validateEnumeration(
        this.db.cstNode(rootClassId) as Parameters<typeof validateEnumeration>[0],
        enumRootSym,
      );
      if (rootEnumErr) {
        dae.diagnostics.push({
          severity: "error",
          code: rootEnumErr.code,
          message: rootEnumErr.message,
          range: {
            startOffset: rootEnumErr.startOffset,
            endOffset: rootEnumErr.endOffset,
          },
        });
        return dae;
      }
      const childClasses = this.db.childrenOf(rootClassId).filter((c) => c.kind === "Class");
      for (const cc of childClasses) {
        const ccEnumErr = validateEnumeration(this.db.cstNode(cc.id) as Parameters<typeof validateEnumeration>[0], cc);
        if (ccEnumErr) {
          dae.diagnostics.push({
            severity: "error",
            code: ccEnumErr.code,
            message: ccEnumErr.message,
            range: {
              startOffset: ccEnumErr.startOffset,
              endOffset: ccEnumErr.endOffset,
            },
          });
          return dae;
        }
      }
    }

    let layer2EqStartIdx = dae.eqCount;
    if (!flattenedInWasm) {
      this.currentRootClassId = rootClassId;
      // 1. Layer 1: Component instantiation
      const elements = this.db.query<SymbolId[]>("instantiate", rootClassId);

      if (elements) {
        const rootExtendsMods = this.collectExtendsMods(rootClassId);
        const rootProtectedNames = this.collectProtectedNames(rootClassId);
        const rootInstantiating = new Set<SymbolId>();
        if (rootClassId) rootInstantiating.add(rootClassId);

        this.instantiateElements(elements, "", dae, {
          args: rootExtendsMods,
          protectedNames: rootProtectedNames,
          instantiatingClassIds: rootInstantiating,
        });
      }
      const hasFatalInstantiationError = dae.diagnostics.some((d) => {
        if (d.severity !== "error") return false;
        if ((d as DaeDiagnosticWithOrigin).fromFunction) return false;
        if (
          d.code === ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.code ||
          d.code === ModelicaErrorCode.FUNCTION_PROTECTED_IO.code ||
          (this.failedFunctionIds.size > 0 && d.message.includes("for function component")) ||
          (this.failedFunctionIds.size > 0 && d.message.includes("Invalid protected variable")) ||
          (this.failedFunctionIds.size > 0 && d.message.includes("in modifier of component"))
        ) {
          return false;
        }
        return true;
      });
      if (this.options.omcCompatibility && hasFatalInstantiationError) {
        return dae;
      }

      // 2. Layer 2: Direct CST Equation extraction
      layer2EqStartIdx = dae.eqCount;
      this.extractClassEquations(rootClassId, "", dae);
      if (this.implicitInners.length > 0) {
        for (const inner of this.implicitInners) {
          this.extractClassEquations(inner.classId, inner.name, dae);
        }
      }
      if (this.pendingArrayBindings.size > 0) {
        for (const items of this.pendingArrayBindings.values()) {
          for (const item of items) {
            dae.addEquation(EqKind.Array, item.lhsExprId, item.rhsExprId);
          }
        }
        this.pendingArrayBindings.clear();
      }
      for (const fn of dae.functions.values()) {
        const fnExt = fn as DaeWithExtras;
        const fnSym = fnExt.symId;
        if (fnSym && this.calledFunctionSymIds.has(fnSym)) {
          fnExt.wasCalled = true;
        }
      }
    }

    const isOldFrontend = compilerOpts.isOldFrontend;
    dae.extensionMetadata["isOldFrontend"] = isOldFrontend;
    const isGen = compilerOpts.isGen;
    dae.extensionMetadata["isGen"] = isGen;

    this.checkCyclicConstantsAndParameters(dae, rootClassId);

    // 2.4–2.5 Post-instantiation passes, constant folding, and post-fold simplifications
    const postInstResult = runPostInstantiationPasses({
      ctx: this,
      rootClassId,
      dae,
      rootSym,
      flattenedInWasm,
      layer2EqStartIdx,
      isOldFrontend,
    });

    // Fold constant/parameter record & record-array call equations across a fixpoint loop
    runRecordCallFoldingPass(
      this,
      rootClassId,
      dae,
      flattenedInWasm,
      isOldFrontend,
      postInstResult.evalAllParams,
      postInstResult.preFoldNonArrayRhs,
    );

    // Scalarize or preserve array variables & bindings
    const scalarizeResult = scalarizeOrPreserveArrays(this, rootClassId, dae, flattenedInWasm);
    dae = scalarizeResult.dae;
    const shouldScalarize = scalarizeResult.shouldScalarize;

    if (!isOldFrontend) {
      this.markConditionalParametersFinal(dae, rootClassId);
    }
    if (flattenedInWasm) {
      this.checkCyclicConstantsAndParameters(dae, rootClassId);
      postWasmValidate(this.db, dae, rootClassId, this.failedFunctionIds, this.invalidInterfaceFunctionIds);
    }

    // 2.6–4. Expandable connectors, physical connector balancing, alias elimination & finalization
    return runConnectionsAndFinalize(
      this,
      dae,
      rootClassId,
      classCst,
      flattenedInWasm,
      isOldFrontend,
      shouldScalarize,
      compilerOpts.flowThreshold,
      wasmBail,
      {
        generateOmcFunctions: () => {
          this.generateRecordConstructors(rootClassId, dae);
          this.generateOperatorFunctions(dae);
          this.generateExternalObjectFunctions(dae, rootClassId);
        },
        consumeWasmDiffStats: () => {
          const stats = this._wasmDiffStats;
          this._wasmDiffStats = undefined;
          return stats;
        },
      },
    );
  }

  private markConditionalParametersFinal(dae: DAEBuilder, rootClassId: SymbolId): void {
    markConditionalParametersFinal(this.db, dae, rootClassId);
  }

  patch(
    rootClassId: SymbolId,
    dae: DAEBuilder,
    dirtyRanges: { startOffset: number; endOffset: number }[],
    delta?: number,
  ): boolean {
    this.currentRootClassId = rootClassId;
    return patchIncremental(this, rootClassId, dae, dirtyRanges, delta);
  }

  public findEquationNodeAt(
    root: Parameters<typeof findEquationNodeAt>[0],
    start: number,
    end: number,
  ): ReturnType<typeof findEquationNodeAt> {
    return findEquationNodeAt(root, start, end);
  }

  public findComponentDeclarationAt(
    root: Parameters<typeof findComponentDeclarationAt>[0],
    start: number,
    end: number,
  ): ReturnType<typeof findComponentDeclarationAt> {
    return findComponentDeclarationAt(root, start, end);
  }

  public isCstNodeProtected(node: Parameters<typeof isCstNodeProtected>[0]): boolean {
    return isCstNodeProtected(node, this.nodeProtectionCache as Parameters<typeof isCstNodeProtected>[1]);
  }

  public generateRecordConstructorFor(
    sym: SymbolEntry,
    dae: DAEBuilder,
    rootClassId?: SymbolId,
    overrideFnName?: string,
    overrideResType?: string,
  ): DAEBuilder | null {
    return generateRecordConstructorFor(this, sym, dae, rootClassId, overrideFnName, overrideResType);
  }

  public generateRecordConstructors(rootClassId: SymbolId, dae: DAEBuilder): void {
    generateRecordConstructors(this, rootClassId, dae);
  }

  public isFunctionSym(sym: SymbolEntry | null | undefined): boolean {
    return isFunctionSym(this.db, sym);
  }

  public isInsideExpandableBus(prefix: string): boolean {
    return isInsideExpandableBus(this.expandableBuses, prefix);
  }

  public flattenFunction(
    fnSymId: SymbolId,
    fnName: string,
    modifiers?: unknown[],
    parentDae?: DAEBuilder,
    enclosingScopeId?: SymbolId,
  ): DAEBuilder {
    return flattenFunction(
      this,
      fnSymId,
      fnName,
      modifiers as Parameters<typeof flattenFunction>[3],
      parentDae,
      enclosingScopeId,
    );
  }

  private generateOperatorFunctions(dae: DAEBuilder): void {
    generateOperatorFunctions(this, dae);
  }

  private generateFunctions(rootClassId: SymbolId, dae: DAEBuilder): void {
    generateFunctions(this, rootClassId, dae);
  }

  private generateExternalObjectFunctions(dae: DAEBuilder, rootClassId?: SymbolId): void {
    generateExternalObjectFunctions(this, dae, rootClassId);
  }

  flattenFromTopology(graph: TopologyGraph): DAEBuilder {
    return flattenFromTopology(this, graph);
  }

  /**
   * Checks model equation/variable balance and pushes an M4004 diagnostic if unbalanced.
   * Should be called after all equation lowering is complete.
   */
  checkBalance(dae: DAEBuilder, rootClassId?: SymbolId): void {
    extractAndRegisterFmuMetadata(this, dae, rootClassId ?? this.currentRootClassId);
    checkBalance(dae, this.db, rootClassId ?? this.currentRootClassId);
  }

  public isFmuClass(classId: SymbolId): boolean {
    const cst = this.db.cstNode(classId) as Parameters<typeof findDirectAnnotationClause>[0];
    if (!cst) return false;
    const ann = findDirectAnnotationClause(cst);
    if (!ann) return false;
    const text = typeof ann.text === "string" ? ann.text : "";
    return text.includes("__ModelScript_fmuPath") || text.includes("__modelscript_fmupath");
  }

  public isClassType(classId: SymbolId, visited = new Set<SymbolId>()): boolean {
    return isClassType(this, classId, visited);
  }

  private checkTypeAliasSpecialization(typeSymId: SymbolId): ReturnType<typeof checkTypeAliasSpecialization> {
    return checkTypeAliasSpecialization(this, typeSymId);
  }

  public collectInheritedTypeModifiers(
    scopeId: SymbolId,
    typeLeafName: string,
    visited = new Set<SymbolId>(),
  ): ReturnType<typeof collectInheritedTypeModifiers> {
    return collectInheritedTypeModifiers(this, scopeId, typeLeafName, visited);
  }

  public getOrCreateWasmEnv(
    dae: DAEBuilder,
    mods?: Parameters<typeof getOrCreateWasmEnv>[2],
  ): ModelicaModificationEnv | null {
    return getOrCreateWasmEnv(this, dae, mods);
  }

  public classFindMember(classId: SymbolId, name: string, visited: Set<SymbolId> = new Set()): SymbolEntry | null {
    return classFindMember(this, classId, name, visited);
  }

  public validateClassModifiers(
    defaultTargetClassId: SymbolId,
    args: Parameters<typeof validateClassModifiers>[2],
    dae: DAEBuilder,
  ): boolean {
    return validateClassModifiers(this, defaultTargetClassId, args, dae);
  }

  public instantiateElements(
    elements: SymbolId[],
    prefix: string,
    dae: DAEBuilder,
    parentMods?: Parameters<typeof instantiateElements>[4],
  ): void {
    instantiateElements(this, elements, prefix, dae, parentMods);
  }

  public validateFunctionComponentDeclaration(
    dae: DAEBuilder,
    compInst: Parameters<typeof validateFunctionComponentDeclaration>[2],
    causality: Causality,
    isElemProtected: boolean,
    elemCst: Parameters<typeof validateFunctionComponentDeclaration>[5],
  ): void {
    validateFunctionComponentDeclaration(this, dae, compInst, causality, isElemProtected, elemCst);
  }

  public validateComponentBasicAttributes(
    dae: DAEBuilder,
    compInst: Parameters<typeof validateComponentBasicAttributes>[2],
    elemId: SymbolId,
    elemCst: Parameters<typeof validateComponentBasicAttributes>[4],
    prefix: string,
    parentMods?: Parameters<typeof validateComponentBasicAttributes>[6],
    matchingParentArg?: Parameters<typeof validateComponentBasicAttributes>[7],
  ): boolean {
    return validateComponentBasicAttributes(
      this,
      dae,
      compInst,
      elemId,
      elemCst,
      prefix,
      parentMods,
      matchingParentArg,
    );
  }

  public evaluateCSTToNumber(
    node: SyntaxNode | string | null | undefined,
    scopeId: SymbolId,
    subs?: Map<string, number>,
    dae?: DAEBuilder,
  ): number | null {
    return evaluateCSTToNumber(this, node, scopeId, subs, dae);
  }

  private collectProtectedNames(classId: SymbolId, visited: Set<SymbolId> = new Set<SymbolId>()): Set<string> {
    return collectProtectedNames(this, classId, visited);
  }

  private collectExtendsMods(
    classId: SymbolId,
    visited: Set<SymbolId> = new Set<SymbolId>(),
  ): ReturnType<typeof collectExtendsMods> {
    return collectExtendsMods(this, classId, visited);
  }

  public resolveRedeclarationType(scopeId: SymbolId | null, redeclSpecifier: string): SymbolId | null {
    return resolveRedeclarationType(this, scopeId, redeclSpecifier);
  }

  public resolveInnerOuterClass(classId: SymbolId): SymbolId {
    return resolveInnerOuterClass(this, classId);
  }

  public extractClassEquations(
    classId: SymbolId,
    prefix: string,
    dae: DAEBuilder,
    breakContext?: {
      brokenComponents: Set<string>;
      brokenConnections: Set<string>;
    },
    parentMods?: Parameters<typeof extractClassEquations>[5],
    visitedClasses?: Set<SymbolId>,
  ): void {
    extractClassEquations(this, classId, prefix, dae, breakContext, parentMods, visitedClasses);
  }
}

export { ModelicaFlattener as ArenaQueryFlattener };
