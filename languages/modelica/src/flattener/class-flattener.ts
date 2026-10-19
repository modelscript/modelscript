// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Query Flattener (TypeScript Host Bridge).
 *
 * Coordinates host-side Salsa QueryDB / SymbolIndex data with the high-performance
 * native WebAssembly Semantic Flattening Kernel (`assembly/flattener.ts`).
 */

import type { TopologyGraph } from "@modelscript/diagram";
import { EqKind, ExprKind } from "@modelscript/dsl";
import {
  Causality,
  DAEBuilder,
  eliminateArenaAliases,
  foldArenaConstants,
  type QueryDB,
  scalarizeArena,
  type SymbolEntry,
  type SymbolId,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../src-gen/bindings.js";
import { ModelicaPortBalancer } from "../connections.js";
import { AnnotationEvaluator } from "../diagram/annotation-evaluator.js";
import { ModelicaErrorCode } from "../errors.js";
import { getShortClassSpecifierNode, isScopeEncapsulated, validateEnumeration } from "../queries.js";

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
  expandConnectorRef,
  extractClassEquations,
  extractDescription,
  extractStateMachines,
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
  processExpandableConnectors,
  propagateImpureFunctions,
  resolveInnerOuterClass,
  resolveRedeclarationType,
  validateClassModifiers,
  validateComponentBasicAttributes,
  validateFunctionComponentDeclaration,
} from "./elaboration/index.js";
import {
  escapeRegExp,
  extractEnumLiteralsFromCst,
  getSymbolQualifiedName,
  lowerCSTExpression,
  stripComments,
  stripCommentsAndStrings,
} from "./expressions/index.js";
import { extractCompilerOptions } from "./support/compiler-options.js";
import { getElementDiagRange } from "./support/range-utils.js";
import { type FlatteningState, getFlatteningState } from "./support/state.js";
import {
  describeWasmBail,
  inputEncodingUnitSize,
  type WasmBailInfo,
  WasmBailReason,
} from "./support/wasm-bail-reasons.js";
import { ModelicaModificationEnv } from "./support/wasm-bridge.js";
import type { FlattenerBackend, FlattenOptions } from "./types.js";

export class ModelicaFlattener {
  bodySnapshot: DAEBuilder | null = null;
  public db: QueryDB;
  public options: Omit<Required<FlattenOptions>, "flowThreshold"> & { flowThreshold?: number | undefined };
  public explicitArrayMode?: "scalarize" | "preserve" | undefined;
  public currentRootClassId: SymbolId = 0;
  public currentClassId: SymbolId = 0;

  public get isOldFrontend(): boolean {
    return Boolean(this.options.isOldFrontend);
  }

  private getElementDiagRange(target: any): any {
    return getElementDiagRange(target);
  }
  public innerOuterComponents = new Set<string>();
  public innerDeclarations = new Map<string, Map<string, string>>();
  public disabledComponents = new Set<string>();
  public usedExternalObjects = new Set<SymbolId>();
  public usedRecordSymIds = new Set<SymbolId>();
  public usedRecordNames = new Set<string>();
  public failedFunctionIds = new Set<SymbolId>();
  public invalidInterfaceFunctionIds = new Set<SymbolId>();
  public calledFunctionSymIds = new Set<SymbolId>();
  public activeLoopVars = new Set<string>();
  private loopVarCounts = new Map<string, number>();

  public state: FlatteningState = {
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
  private pendingArrayBindings = new Map<string, { lhsExprId: number; rhsExprId: number }[]>();
  currentImports = new Map<string, string>();
  public expandableBuses = new Map<string, SymbolId>();
  public evaluatedConstantArrays = new Map<string, any>();
  public varConditionDeps = new Map<string, string[]>();
  public currentParentMods?: any;
  public currentBindingCompName?: string | undefined;
  public enumTypeMap = new Map<string, string[]>();
  private nodeProtectionCache = new WeakMap<any, boolean>();
  public useLocalDirection = false;

  private _fileSymbolsCache = new Map<string, any[]>();

  private getFileSymbols(resourceId?: string): any[] {
    const cacheKey = resourceId ?? "__all__";
    const cached = this._fileSymbolsCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const result: any[] = [];
    const roots = (this.db.childrenOf(null) ?? []).filter((s: any) => !resourceId || s.resourceId === resourceId);
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

  private extractClassAnnotations(dae: DAEBuilder, classId: SymbolId): void {
    const cst = this.db.cstNode(classId) as any;
    if (!cst) return;

    const evaluator = new AnnotationEvaluator(this.db as any);

    // 1. Experiment annotation (Modelica 3.7 / MCP-0036)
    const exp = evaluator.evaluate(cst, "experiment");
    if (exp) {
      if (exp.StartTime !== undefined || exp.startTime !== undefined) {
        dae.experiment.startTime = Number(exp.StartTime ?? exp.startTime);
      }
      if (exp.StopTime !== undefined || exp.stopTime !== undefined) {
        dae.experiment.stopTime = Number(exp.StopTime ?? exp.stopTime);
      }
      if (exp.Tolerance !== undefined || exp.tolerance !== undefined) {
        dae.experiment.tolerance = Number(exp.Tolerance ?? exp.tolerance);
      }
      if (exp.Interval !== undefined || exp.interval !== undefined) {
        dae.experiment.interval = Number(exp.Interval ?? exp.interval);
      }
      if (exp.NumberOfIntervals !== undefined || exp.numberOfIntervals !== undefined) {
        dae.experiment.numberOfIntervals = Number(exp.NumberOfIntervals ?? exp.numberOfIntervals);
      }
      if (exp.Algorithm !== undefined || exp.algorithm !== undefined) {
        dae.experiment.algorithm = String(exp.Algorithm ?? exp.algorithm);
      }
      if (exp.EquidistantOutput !== undefined || exp.equidistantOutput !== undefined) {
        dae.experiment.__modelscript_equidistantOutput = Boolean(exp.EquidistantOutput ?? exp.equidistantOutput);
      }
    }

    // 2. WebGPU
    const gpu = evaluator.evaluate(cst, "webgpu");
    if (gpu) {
      dae.extensionMetadata.webgpu = {
        workgroupSize: gpu.workgroupSize ? Number(gpu.workgroupSize) : undefined,
        precision: gpu.precision ? String(gpu.precision) : undefined,
        parallelInstances: gpu.parallelInstances ? Number(gpu.parallelInstances) : undefined,
      };
    }

    // 3. AudioClock
    const audio = evaluator.evaluate(cst, "audioclock");
    if (audio) {
      dae.extensionMetadata.audioClock = {
        sampleRate: audio.sampleRate ? Number(audio.sampleRate) : undefined,
        targetHz: audio.targetHz ? Number(audio.targetHz) : undefined,
        realtimeFactor: audio.realtimeFactor ? Number(audio.realtimeFactor) : undefined,
      };
    }

    // 4. SDE
    const sde = evaluator.evaluate(cst, "sde");
    if (sde) {
      dae.extensionMetadata.sde = {
        method: sde.method ? String(sde.method) : undefined,
        ensemblePaths: sde.ensemblePaths ? Number(sde.ensemblePaths) : undefined,
        seed: sde.seed ? Number(sde.seed) : undefined,
      };
    }

    // 5. BVP
    const bvp = evaluator.evaluate(cst, "bvp");
    if (bvp) {
      dae.extensionMetadata.bvp = {
        boundaryConditions: Array.isArray(bvp.boundaryConditions) ? bvp.boundaryConditions.map(String) : undefined,
        method: bvp.method ? String(bvp.method) : undefined,
        intervals: bvp.intervals ? Number(bvp.intervals) : undefined,
      };
    }

    // 6. Surrogate
    const surrogate = evaluator.evaluate(cst, "surrogate");
    if (surrogate) {
      if (!dae.extensionMetadata.surrogate) dae.extensionMetadata.surrogate = new Map();
      dae.extensionMetadata.surrogate.set("model", {
        architecture: surrogate.architecture ? String(surrogate.architecture) : undefined,
        datasetUri: surrogate.datasetUri ? String(surrogate.datasetUri) : undefined,
        errorTolerance: surrogate.errorTolerance ? Number(surrogate.errorTolerance) : undefined,
      });
    }

    // 7. FEAMesh
    const fea = evaluator.evaluate(cst, "feamesh");
    if (fea) {
      if (!dae.extensionMetadata.feaMesh) dae.extensionMetadata.feaMesh = [];
      dae.extensionMetadata.feaMesh.push({
        cadUri: fea.cadUri ? String(fea.cadUri) : undefined,
        meshType: fea.meshType ? String(fea.meshType) : undefined,
        material: fea.material ? String(fea.material) : undefined,
        loadConnector: fea.loadConnector ? String(fea.loadConnector) : undefined,
        feedbackDeflection: fea.feedbackDeflection ? String(fea.feedbackDeflection) : undefined,
      });
    }

    // 8. CFDFlow
    const cfd = evaluator.evaluate(cst, "cfdflow");
    if (cfd) {
      if (!dae.extensionMetadata.cfdFlow) dae.extensionMetadata.cfdFlow = [];
      dae.extensionMetadata.cfdFlow.push({
        grid: Array.isArray(cfd.grid) ? cfd.grid.map(Number) : undefined,
        dx: cfd.dx ? Number(cfd.dx) : undefined,
        turbulenceModel: cfd.turbulenceModel ? String(cfd.turbulenceModel) : undefined,
        velocityVariable: cfd.velocityVariable ? String(cfd.velocityVariable) : undefined,
        dragForceVariable: cfd.dragForceVariable ? String(cfd.dragForceVariable) : undefined,
      });
    }

    // 9. MBSE / IoT (SysML, OWL, Telemetry)
    const sysml = evaluator.evaluate(cst, "sysml");
    const owl = evaluator.evaluate(cst, "owl");
    const telemetry = evaluator.evaluate(cst, "telemetry");
    if (sysml || owl || telemetry) {
      if (!dae.extensionMetadata.mbse) dae.extensionMetadata.mbse = {};
      if (sysml) {
        if (!dae.extensionMetadata.mbse.sysml) dae.extensionMetadata.mbse.sysml = [];
        dae.extensionMetadata.mbse.sysml.push(sysml);
      }
      if (owl) {
        if (!dae.extensionMetadata.mbse.owl) dae.extensionMetadata.mbse.owl = [];
        dae.extensionMetadata.mbse.owl.push(owl);
      }
      if (telemetry) {
        if (!dae.extensionMetadata.mbse.telemetry) dae.extensionMetadata.mbse.telemetry = [];
        dae.extensionMetadata.mbse.telemetry.push(telemetry);
      }
    }
  }

  public isComponentHidden(elemId: SymbolId): boolean {
    return isComponentHidden(this, elemId);
  }

  public extractDescription(elemCst: any): string | null {
    return extractDescription(elemCst);
  }

  isComponentDisabled(name: string): boolean {
    if (this.disabledComponents.has(name)) return true;
    for (const dis of this.disabledComponents) {
      if (name.startsWith(`${dis}.`) || name.startsWith(`${dis}[`)) return true;
    }
    return false;
  }

  isExternalObject(classId: SymbolId | null | undefined, visited = new Set<SymbolId>()): boolean {
    if (!classId || visited.has(classId)) return false;
    visited.add(classId);
    const sym = this.db.symbol(classId);
    if (!sym) return false;
    if (sym.name === "ExternalObject") return true;

    const extendsChildren = this.db.childrenOf(classId).filter((c) => c.kind === "Extends");
    for (const ext of extendsChildren) {
      if (ext.name === "ExternalObject" || ext.name.endsWith(".ExternalObject")) return true;
      const base = this.db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
      const scoped =
        this.db.query<any>("resolveName", classId)?.(ext.name) ??
        this.db.query<any>("resolveSimpleName", classId)?.(ext.name);
      const target = base ?? scoped ?? this.db.byName(ext.name).find((e) => e.kind === "Class");
      if (target && this.isExternalObject(target.id, visited)) {
        return true;
      }
    }
    return false;
  }

  isOperatorRecordSym(sym: any): boolean {
    if (!sym || sym.id < 0 || (sym.metadata as any)?.isPredefined) return false;
    if ((sym as any)._isOperatorRecord !== undefined) return (sym as any)._isOperatorRecord;
    const meta = (sym.metadata as any) || {};
    const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
    const cleanKind = rawKind.replace(/\/\/[^\r\n]*|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, " ").trim();
    if (/\boperator\s+record\b/.test(cleanKind)) {
      (sym as any)._isOperatorRecord = true;
      return true;
    }
    if (cleanKind.length > 0 && !/\b(?:operator|record)\b/.test(cleanKind)) {
      (sym as any)._isOperatorRecord = false;
      return false;
    }
    const cst = this.db.cstNode(sym.id) as any;
    if (cst) {
      const text = (cst.text?.trim() ?? "").replace(/\/\/[^\r\n]*|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, " ").trim();
      if (/^(?:(?:encapsulated|partial)\s+)*operator\s+record\b/.test(text)) {
        (sym as any)._isOperatorRecord = true;
        return true;
      }
    }
    (sym as any)._isOperatorRecord = false;
    return false;
  }

  isClassPartial(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    if (!classId || classId < 0 || visited.has(classId)) return false;
    visited.add(classId);
    const sym = this.db.symbol(classId);
    if (!sym || (sym.kind !== "Class" && sym.kind !== "Package" && sym.kind !== "Function")) return false;
    const meta = (sym.metadata as any) || {};
    const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
    const cleanKind = rawKind.replace(/\/\/[^\r\n]*|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, " ").trim();
    if (/\bpartial\b/.test(cleanKind)) return true;
    const cst = this.db.cstNode(classId) as any;
    if (cst) {
      const pfxNode = Cst.ClassDefinition.classPrefixes(cst);
      const text = (pfxNode?.text ?? cst.text ?? "")
        .replace(/\/\/[^\r\n]*|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, " ")
        .trim();
      if (/\bpartial\b/.test(text.slice(0, 100)) || /^(?:(?:encapsulated|pure|impure)\s+)*partial\b/.test(text)) {
        return true;
      }
      const shortSpec = getShortClassSpecifierNode(cst);
      if (shortSpec && !(this.options as any)?.isOldFrontend) {
        const typeSpecNode = shortSpec.children?.find((c: any) => c.type === "type_specifier" || c.type === "name");
        const typeName: string = typeSpecNode?.text?.trim();
        if (typeName) {
          const resolved =
            this.db.query<(n: string) => any>("resolveName", classId)?.(typeName) ??
            this.db.query<(n: string) => any>("resolveSimpleName", classId)?.(typeName) ??
            this.db.byName(typeName)?.[0];
          if (resolved?.id) {
            return this.isClassPartial(resolved.id, visited);
          }
        }
      }
    }
    return false;
  }

  private _hasOperatorRecordsCache = new Map<SymbolId, boolean>();
  private _globalHasOperatorRecords?: boolean | undefined;

  hasOperatorRecords(rootClassId?: SymbolId | null): boolean {
    if (!rootClassId) return true;
    const cached = this._hasOperatorRecordsCache.get(rootClassId);
    if (cached !== undefined) return cached;
    const rootSym = this.db.symbol(rootClassId);
    if (rootSym?.resourceId) {
      const fileSyms = this.getFileSymbols(rootSym.resourceId);
      if (fileSyms.some((s: any) => s.kind === "Class" && this.isOperatorRecordSym(s))) {
        this._hasOperatorRecordsCache.set(rootClassId, true);
        return true;
      }
    }
    if (this._globalHasOperatorRecords === undefined) {
      const dbAny = this.db as any;
      if (dbAny._globalHasOperatorRecords !== undefined) {
        this._globalHasOperatorRecords = dbAny._globalHasOperatorRecords;
      } else {
        this._globalHasOperatorRecords = (this.db.allEntries?.() ?? []).some(
          (s: any) => s.kind === "Class" && this.isOperatorRecordSym(s),
        );
        dbAny._globalHasOperatorRecords = this._globalHasOperatorRecords;
      }
    }
    this._hasOperatorRecordsCache.set(rootClassId, this._globalHasOperatorRecords!);
    return this._globalHasOperatorRecords!;
  }

  validateOperatorRecords(dae: DAEBuilder, rootClassId: SymbolId): void {
    const rootSym = this.db.symbol(rootClassId);
    if (!rootSym || !rootSym.resourceId) return;
    const rootCst = this.db.cstNode(rootClassId) as any;
    const isOldFrontend = extractCompilerOptions(rootCst, this.options, this.db, rootSym).isOldFrontend;

    const candidates = this.getFileSymbols(rootSym.resourceId).filter(
      (s: any) => s.kind === "Class" && this.isOperatorRecordSym(s),
    );

    for (const rec of candidates) {
      const recCst = this.db.cstNode(rec.id) as any;
      const recStart = recCst?.startIndex ?? recCst?.startOffset;
      const recEnd = recCst?.endIndex ?? recCst?.endOffset;
      const recRange = recStart != null && recEnd != null ? { startOffset: recStart, endOffset: recEnd } : undefined;

      const children = this.db.childrenOf(rec.id);
      for (const child of children) {
        if (child.kind !== "Class") continue;
        const childMeta = (child.metadata as Record<string, unknown>) || {};
        const childPrefix = String(childMeta?.["classPrefixes"] ?? childMeta?.["classKind"] ?? "");
        const childCst = this.db.cstNode(child.id) as any;
        const childText = childCst?.text?.trim() ?? "";

        const isOperator =
          childPrefix.includes("operator") ||
          child.name.startsWith("'") ||
          childText.startsWith("operator") ||
          /^(?:(?:encapsulated|partial)\s+)*operator\b/.test(childText);

        if (!isOperator) continue;

        const recMeta = (rec.metadata as Record<string, unknown>) || {};
        const recPrefix = String(recMeta?.["classPrefixes"] ?? recMeta?.["classKind"] ?? "");
        const cleanChildPrefix = childPrefix.replace(/\/\/[^\r\n]*|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, "");
        const cleanChildText = childText.replace(/\/\/[^\r\n]*|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, "");
        const cleanRecPrefix = recPrefix.replace(/\/\/[^\r\n]*|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, "");
        const isEncapsulated =
          /(?<!non-)\bencapsulated\b/.test(cleanRecPrefix) ||
          /(?<!non-)\bencapsulated\b/.test(cleanChildPrefix) ||
          /(?<!non-)\bencapsulated\b/.test(cleanChildText) ||
          this.db.childrenOf(child.id).some((c) => {
            if (c.kind !== "Class") return false;
            const meta = (c.metadata as any) || {};
            const pfx = String(meta.classPrefixes ?? meta.classKind ?? "").replace(
              /\/\/[^\r\n]*|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g,
              "",
            );
            return /(?<!non-)\bencapsulated\b/.test(pfx);
          });

        if (!isOldFrontend && !isEncapsulated) {
          const cStart = childCst?.startIndex ?? childCst?.startOffset;
          const cEnd = childCst?.endIndex ?? childCst?.endOffset;
          const cRange = cStart != null && cEnd != null ? { startOffset: cStart, endOffset: cEnd } : undefined;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.NON_ENCAPSULATED_OPERATOR.code,
            message: `Operator ${rec.name}.'${child.name.replace(/^'|'$/g, "")}' is not encapsulated.`,
            range: cRange,
          });
        }

        const isCtor = child.name === "'constructor'" || child.name === "constructor";
        if (isCtor) {
          const funcs =
            childPrefix.includes("operator function") || childText.startsWith("operator function")
              ? [child]
              : this.db.childrenOf(child.id).filter((c) => c.kind === "Class");

          for (const fn of funcs) {
            const comps = this.db.childrenOf(fn.id).filter((c) => c.kind === "Component");
            const outputs: SymbolEntry[] = [];
            for (const c of comps) {
              const causality = this.db.query<string | null>("causality", c.id);
              if (causality === "output") outputs.push(c);
            }

            if (outputs.length !== 1) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.OPERATOR_CONSTRUCTOR_INVALID_OUTPUT_COUNT.code,
                message: `Operator ${rec.name}.'constructor' must have exactly one output.`,
                range: recRange,
              });
            } else {
              const out = outputs[0]!;
              const outType = this.db.query<string | null>("typeSpecifier", out.id);
              const cleanType = outType?.replace(/^\./, "") ?? "";
              if (cleanType !== rec.name) {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.OPERATOR_CONSTRUCTOR_INVALID_OUTPUT_TYPE.code,
                  message: `Output '${out.name}' in operator ${rec.name}.'constructor' must be of type ${rec.name}, got type ${outType ?? "unknown"}.`,
                  range: recRange,
                });
              }
            }
          }
        }
      }
    }
  }

  isRecordSym(sym: any): boolean {
    if (!sym || sym.id < 0 || (sym.metadata as any)?.isPredefined) return false;
    if ((sym as any)._isRecord !== undefined) return (sym as any)._isRecord;
    const meta = (sym.metadata as any) || {};
    const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
    const cleanKind = stripComments(rawKind).trim();
    const words = cleanKind.split(/\s+/).filter(Boolean);
    if (words.includes("record")) {
      (sym as any)._isRecord = true;
      return true;
    }
    if (words.length > 0 && !words.includes("record")) {
      (sym as any)._isRecord = false;
      return false;
    }
    const cst = this.db.cstNode(sym.id) as any;
    if (cst) {
      const pfx = Cst.ClassDefinition.classPrefixes(cst);
      if (pfx) {
        const pfxWords = stripComments(pfx.text ?? "")
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        if (pfxWords.includes("record")) {
          (sym as any)._isRecord = true;
          return true;
        }
      }
      const text = (cst.text?.trim() ?? "").replace(/\/\/[^\r\n]*|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, " ").trim();
      if (/^(?:(?:encapsulated|partial)\s+)*record\b/.test(text)) {
        (sym as any)._isRecord = true;
        return true;
      }
    }
    (sym as any)._isRecord = false;
    return false;
  }

  isExpandableConnectorClass(classId: SymbolId): boolean {
    return isExpandableConnectorClass(this.db, classId);
  }

  validateClassSpecializationRestrictions(dae: DAEBuilder, rootClassId: SymbolId): void {
    const rootSym = this.db.symbol(rootClassId);
    if (!rootSym) return;

    const collectClasses = (parentId: SymbolId | null): SymbolEntry[] => {
      const result: SymbolEntry[] = [];
      const children = this.db.childrenOf(parentId) ?? [];
      for (const s of children) {
        if (!rootSym.resourceId || s.resourceId === rootSym.resourceId) {
          if (s.kind === "Class" || s.kind === "Package") {
            result.push(s);
            result.push(...collectClasses(s.id));
          }
        }
      }
      return result;
    };
    const fileClasses = collectClasses(null);

    for (const cls of fileClasses) {
      const clsSym = cls;
      const rawKind = String(clsSym?.metadata?.["classKind"] ?? clsSym?.metadata?.["classPrefixes"] ?? "");
      const cleanKind =
        rawKind
          .replace(/\/\/[^\r\n]*|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, " ")
          .trim()
          .split(/\s+/)
          .pop() ?? "";
      const cst = this.db.cstNode(cls.id) as any;
      if (!cst) continue;

      const findComposition = (node: any): any => {
        if (!node) return null;
        if (node.type === "composition") return node;
        for (const child of node.children || []) {
          const res = findComposition(child);
          if (res) return res;
        }
        return null;
      };

      const compNode = findComposition(cst);
      if (!compNode) continue;

      // 1. Equations and Algorithms in type, record, connector, package
      if (
        cleanKind === "type" ||
        cleanKind === "record" ||
        cleanKind === "connector" ||
        (cleanKind === "package" && !(dae.extensionMetadata?.["isOldFrontend"] && cls.id !== rootClassId))
      ) {
        for (const child of compNode.children || []) {
          if (child.type === "equation_section") {
            let targetNode = child;
            for (const ch of child.children || []) {
              if (ch.type === "some_equation" || ch.type === "simple_equation") {
                targetNode = ch;
                break;
              }
            }
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.RESTRICTION_VIOLATION.code,
              message: ModelicaErrorCode.RESTRICTION_VIOLATION.message("Equations", cleanKind),
              range: {
                startOffset: targetNode.startIndex ?? targetNode.startOffset,
                endOffset: targetNode.endIndex ?? targetNode.endOffset,
                startPosition: targetNode.startPosition,
                endPosition: targetNode.endPosition,
              },
            });
          } else if (child.type === "algorithm_section") {
            let targetNode = child;
            for (const ch of child.children || []) {
              if (ch.type === "statement" || ch.type === "assignment_statement") {
                targetNode = ch;
                break;
              }
            }
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.RESTRICTION_VIOLATION.code,
              message: ModelicaErrorCode.RESTRICTION_VIOLATION.message("Algorithm sections", cleanKind),
              range: {
                startOffset: targetNode.startIndex ?? targetNode.startOffset,
                endOffset: targetNode.endIndex ?? targetNode.endOffset,
                startPosition: targetNode.startPosition,
                endPosition: targetNode.endPosition,
              },
            });
          }
        }
      }

      // 2. Protected sections in type, record, connector
      const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
      if (cleanKind === "type" || (!isOldFrontend && cleanKind === "record") || cleanKind === "connector") {
        for (let i = 0; i < (compNode.children || []).length; i++) {
          const child = compNode.children[i];
          if (child.text?.trim() === "protected" || child.type === '"protected"') {
            const nextChild = compNode.children[i + 1];
            let targetNode = child;
            if (nextChild && nextChild.children && nextChild.children.length > 0) {
              const firstElem = nextChild.children[0];
              if (cleanKind === "record" || cleanKind === "connector") {
                targetNode = firstElem;
              } else if (cleanKind === "type") {
                targetNode = {
                  startOffset: child.startIndex ?? child.startOffset,
                  endOffset: firstElem.endIndex ?? firstElem.endOffset,
                  startPosition: child.startPosition,
                  endPosition: firstElem.endPosition,
                };
              }
            }
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.PROTECTED_IN_CONNECTOR.code,
              message: `Protected sections are not allowed in ${cleanKind}.`,
              range: {
                startOffset: targetNode.startIndex ?? targetNode.startOffset,
                endOffset: targetNode.endIndex ?? targetNode.endOffset,
                startPosition: targetNode.startPosition,
                endPosition: targetNode.endPosition,
              },
            });
          }
        }
      }

      // 3. Variable in package must be constant
      if (cleanKind === "package" && !dae.extensionMetadata?.["isOldFrontend"]) {
        const children = this.db.childrenOf(cls.id);
        for (const child of children) {
          if (child.kind === "Component") {
            const rawVar = (child.metadata as any)?.variability;
            const variability = this.db.query<any>("variability", child.id);
            const isConst = rawVar === "constant" || variability === "constant" || variability === Variability.Constant;
            if (!isConst) {
              const compCst = this.db.cstNode(child.id) as any;
              let clauseNode = compCst;
              while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
                clauseNode = clauseNode.parent;
              }
              const targetNode = clauseNode ?? compCst;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
                message: ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.message(child.name, cls.name),
                range: {
                  startOffset: targetNode.startIndex ?? targetNode.startOffset,
                  endOffset: targetNode.endIndex ?? targetNode.endOffset,
                  startPosition: targetNode.startPosition,
                  endPosition: targetNode.endPosition,
                },
              });
            }
          }
        }
      }
    }
  }

  private _classImportsCache = new Map<SymbolId, Map<string, string>>();

  collectClassImports(classId: SymbolId, visited: Set<SymbolId> = new Set<SymbolId>()): Map<string, string> {
    const cached = this._classImportsCache.get(classId);
    if (cached !== undefined) return new Map(cached);
    const result = new Map<string, string>();
    if (visited.has(classId)) return result;
    visited.add(classId);

    // 1. Parent scope imports
    const sym = this.db.symbol(classId);
    if (sym && sym.parentId !== null) {
      const parentImports = this.collectClassImports(sym.parentId, visited);
      for (const [k, v] of parentImports) {
        result.set(k, v);
      }
    }

    // 2. Base class imports (via Extends) & 3. Own imports from index
    const children = this.db.childrenOf(classId);
    for (const ext of children) {
      if (ext.kind !== "Extends") continue;
      const base = this.db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
      const scoped =
        this.db.query<any>("resolveName", classId)?.(ext.name) ??
        this.db.query<any>("resolveSimpleName", classId)?.(ext.name);
      const target = base ?? scoped ?? this.db.byName(ext.name).find((e) => e.kind === "Class");
      if (target) {
        const baseImports = this.collectClassImports(target.id, visited);
        for (const [k, v] of baseImports) {
          result.set(k, v);
        }
      }
    }

    for (const child of children) {
      if (child.kind === "Import") {
        const meta = child.metadata as Record<string, unknown>;
        let importKind = meta?.["importKind"] as string | undefined;
        let pkgName = (meta?.["packageName"] ?? child.name) as string;
        let aliasName = meta?.["shortName"] as string | undefined;

        // For WASM GLR parser import_clause nodes, inspect the CST
        if (importKind === undefined && (child.ruleName === "import_clause" || child.ruleName === "ImportClause")) {
          const importCst = this.db.cstNode(child.id) as any;
          if (importCst) {
            const aliasNode = Cst.ImportClause.alias(importCst);
            const importListNode = Cst.ImportClause.importList(importCst);
            const cstText: string = importCst.text ?? "";

            if (aliasNode) {
              aliasName = aliasNode.text;
              importKind = "simple";
            } else if (importListNode) {
              importKind = "compound";
            } else if (/\.\s*\*/.test(cstText)) {
              importKind = "unqualified";
            } else {
              importKind = "simple";
            }
          } else {
            importKind = "simple";
          }
        }
        if (!importKind) importKind = "simple";

        if (importKind === "simple") {
          const shortName = aliasName ?? pkgName.split(".").pop() ?? pkgName;
          result.set(shortName, pkgName);
        } else if (importKind === "unqualified") {
          // For unqualified imports, we need to resolve the package and add all children
          const pkgEntry = this.db
            .byName(pkgName.split(".")[0] ?? "")
            .find((e) => e.kind === "Package" || e.kind === "Class");
          if (pkgEntry) {
            const resolvedPkg = this.db.query<(n: string) => { id: number } | null>("resolveName", pkgEntry.id);
            const target = pkgName.includes(".") ? resolvedPkg?.(pkgName.slice(pkgName.indexOf(".") + 1)) : pkgEntry;
            if (target) {
              for (const pkgChild of this.db.childrenOf(target.id)) {
                if (pkgChild.kind !== "Reference" && pkgChild.kind !== "Import") {
                  result.set(pkgChild.name, `${pkgName}.${pkgChild.name}`);
                }
              }
            }
          }
        }
      }
    }

    this._classImportsCache.set(classId, new Map(result));
    return result;
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
  private extractStateMachines(dae: DAEBuilder): void {
    extractStateMachines(dae, this.options);
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
    const dbAny = db as any;
    if (!dbAny._fileSymbolsCache) dbAny._fileSymbolsCache = new Map<string, any[]>();
    if (!dbAny._hasOperatorRecordsCache) dbAny._hasOperatorRecordsCache = new Map<SymbolId, boolean>();
    if (!dbAny._classImportsCache) dbAny._classImportsCache = new Map<SymbolId, Map<string, string>>();
    if (!dbAny._redeclareCache) dbAny._redeclareCache = new Map<SymbolId, boolean>();
    if (!dbAny._unsupportedWasmCache) dbAny._unsupportedWasmCache = new Map<SymbolId, boolean>();
    this._fileSymbolsCache = dbAny._fileSymbolsCache;
    this._hasOperatorRecordsCache = dbAny._hasOperatorRecordsCache;
    this._classImportsCache = dbAny._classImportsCache;
    this._redeclareCache = dbAny._redeclareCache;
    this._unsupportedWasmCache = dbAny._unsupportedWasmCache;
    const omcCompatibility = options?.omcCompatibility ?? false;
    let backend: FlattenerBackend =
      options?.backend ?? (options as any)?.flattenerBackend ?? (options?.useWasmKernel ? "wasm" : "hybrid");
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
      const optBackend = options.backend ?? (options as any).flattenerBackend;
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
      if (options.isOldFrontend !== undefined) (this.options as any).isOldFrontend = options.isOldFrontend;
    }

    const dae = this.flattenClass(rootClassId, cachedArena);
    if (
      !dae.diagnostics.some((d) => d.severity === "error") &&
      !dae.extensionMetadata?.["isOldFrontend"] &&
      dae.classKind !== "function" &&
      dae.classKind !== "package" &&
      !this.isClassPartial(rootClassId)
    ) {
      for (let i = 0; i < dae.varCount; i++) {
        if (!dae.isVarRemoved(i) && dae.getVarVariability(i) === Variability.Parameter) {
          const exprId = dae.getVarExpression(i);
          const hasBindingOrStart = exprId !== undefined && exprId >= 0 && exprId !== 0xffffffff;
          const fixedAttr = dae.getVarAttr(i, "fixed");
          const isFixedFalse =
            fixedAttr !== undefined &&
            fixedAttr >= 0 &&
            dae.getExprKind(fixedAttr) === ExprKind.BoolLiteral &&
            dae.getExprData1(fixedAttr) === 0;
          if (!hasBindingOrStart && !isFixedFalse) {
            const vName = dae.getVarName(i);
            let range = dae.getVarSourceRange(i);
            const sym = this.db.childrenOf(rootClassId).find((c) => c.name === vName);
            if (sym) {
              const cst = this.db.cstNode(sym.id);
              if (cst) range = getElementDiagRange(cst);
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
    this.bodySnapshot = dae;
    return dae;
  }

  private _redeclareCache = new Map<SymbolId, boolean>();

  private classHasRedeclare(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    if (!classId || visited.has(classId)) return false;
    const cached = this._redeclareCache.get(classId);
    if (cached !== undefined) return cached;
    visited.add(classId);

    const cacheAndReturn = (val: boolean): boolean => {
      this._redeclareCache.set(classId, val);
      return val;
    };

    const shortMod = this.db.query<any>("effectiveModification", classId);
    if (shortMod?.args) {
      for (const arg of shortMod.args) {
        if (arg.isRedeclaration || arg.redeclaredTypeSpecifier || arg.isReplaceable) return cacheAndReturn(true);
      }
      if (shortMod.args.length > 0) {
        const sym = this.db.symbol(classId);
        const cstText = (this.db.cstNode(classId) as any)?.text ?? "";
        if (
          sym?.kind === "Package" ||
          (sym?.metadata as any)?.classKind === "package" ||
          /^\s*(?:(?:encapsulated|partial|replaceable)\s+)*package\b/.test(cstText)
        ) {
          return cacheAndReturn(true);
        }
      }
    }

    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (this.db.query<boolean>("isRedeclare", child.id)) {
        return cacheAndReturn(true);
      }
      if (this.db.query<boolean>("isReplaceable", child.id)) {
        return cacheAndReturn(true);
      }
      if (child.kind === "Extends") {
        const extendsModParsedRaw = this.db.query<any>("extendsModificationParsed", child.id);
        const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
          ? extendsModParsedRaw
          : (extendsModParsedRaw?.args ?? []);
        for (const arg of extendsModParsed) {
          if (arg.isRedeclaration || arg.redeclaredTypeSpecifier) return cacheAndReturn(true);
        }
        const baseClass =
          this.db.query<any>("resolvedBaseClass", child.id) ??
          (classId
            ? (this.db.query<any>("resolveName", classId)?.(child.name) ??
              this.db.query<any>("resolveSimpleName", classId)?.(child.name))
            : null) ??
          this.db.byName(child.name)?.[0];
        if (baseClass && this.classHasRedeclare(baseClass.id, visited)) return cacheAndReturn(true);
      }
      if (child.kind === "Class" || child.kind === "Package") {
        if (this.classHasRedeclare(child.id, visited)) return cacheAndReturn(true);
      }
      if (child.kind === "Component") {
        const compInst = this.db.query<any>("componentInstance", child.id);
        if (compInst?.isReplaceable) return cacheAndReturn(true);
        if (compInst?.modification?.args) {
          for (const arg of compInst.modification.args) {
            if (arg.isRedeclaration || arg.redeclaredTypeSpecifier) return cacheAndReturn(true);
          }
        }
        const compClassId = this.db.query<SymbolId | null>("classInstance", child.id);
        if (compClassId && this.classHasRedeclare(compClassId, visited)) return cacheAndReturn(true);
      }
    }

    const cst = this.db.cstNode(classId) as any;
    if (cst?.text) {
      const matches = (cst.text as string).match(/\b([a-zA-Z_]\w*)\.[a-zA-Z_]\w*/g);
      if (matches) {
        const sym = this.db.symbol(classId);
        const seenPrefixes = new Set<string>();
        for (const m of matches) {
          const prefixName = m.split(".")[0]!;
          if (prefixName === "Modelica" || seenPrefixes.has(prefixName)) continue;
          seenPrefixes.add(prefixName);
          const prefixSym = this.db.byName(prefixName).find((e) => e.kind === "Class" || e.kind === "Package");
          if (
            prefixSym &&
            prefixSym.id !== classId &&
            (!sym?.resourceId || prefixSym.resourceId === sym.resourceId) &&
            this.classHasRedeclare(prefixSym.id, visited)
          ) {
            return cacheAndReturn(true);
          }
        }
      }
    }
    return cacheAndReturn(false);
  }

  public classHasConnect(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    if (!classId || visited.has(classId)) return false;
    visited.add(classId);

    const cst = this.db.cstNode(classId) as any;
    if (cst?.text?.includes("connect(")) return true;

    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (child.kind === "Extends") {
        const baseClass =
          this.db.query<any>("resolvedBaseClass", child.id) ??
          (classId
            ? (this.db.query<any>("resolveName", classId)?.(child.name) ??
              this.db.query<any>("resolveSimpleName", classId)?.(child.name))
            : null) ??
          this.db.byName(child.name)?.[0];
        if (baseClass && this.classHasConnect(baseClass.id, visited)) return true;
      }
    }
    return false;
  }

  private _unsupportedWasmCache = new Map<SymbolId, boolean>();

  private classHasUnsupportedWasmFeatures(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    if (!classId || visited.has(classId)) return false;
    const cached = this._unsupportedWasmCache.get(classId);
    if (cached !== undefined) return cached;
    visited.add(classId);

    const sym = this.db.symbol(classId);
    if (this.options.intEnumConversion || (sym && (sym.kind === "Record" || this.isRecordSym(sym)))) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    let rawText = "";
    if (sym && sym.startOffset != null && sym.endOffset != null) {
      if (typeof (this.db as any).cstText === "function") {
        rawText = (this.db as any).cstText(sym.startOffset, sym.endOffset, sym) ?? "";
      }
      if (!rawText && sym.resourceId) {
        const s = (this.db as any).source?.(sym.resourceId);
        if (typeof s === "string") {
          rawText = s.slice(sym.startOffset, sym.endOffset);
        }
      }
    }
    if (!rawText) {
      const cst = this.db.cstNode(classId) as any;
      rawText = cst?.text ?? "";
    }

    // Strip comments and strings from class text to avoid spurious keyword matches
    const text = stripCommentsAndStrings(rawText);

    if (
      /\b(?:class|model|block|package)\s+[a-zA-Z_]\w*\s*=\s*/.test(text) ||
      /\bconnector\s+[a-zA-Z_]\w*\s*=\s*(?!(?:(?:input|output|flow|parameter)\s+)?\.?(?:[a-zA-Z_]\w*\.)*[a-zA-Z_]\w*(?:\[[^\]]*\])?\b)[a-zA-Z_]/.test(
        text,
      ) ||
      /\btype\s+[a-zA-Z_]\w*\s*=\s*(?!enumeration\b|(?:(?:input|output|flow|parameter)\s+)?\.?(?:[a-zA-Z_]\w*\.)*[a-zA-Z_]\w*(?:\[[^\]]*\])?\b)[a-zA-Z_]/.test(
        text,
      )
    ) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    if (
      /\benum\s+[a-zA-Z_]\w*\s*[(=;]/.test(text) ||
      /\bStateSelect\s*\[/.test(text) ||
      /\bConnections\s*\./.test(text) ||
      /\bequalityConstraint\b/.test(text) ||
      /\[\s*:\s*\]\s*=/.test(text) ||
      /\bfill\s*\([^,]+,\s*\d+\.\d+/.test(text) ||
      /\bexternal\s+"FORTRAN 77"/i.test(text) ||
      /\b(?:homotopy|semiLinear|outerProduct|identity|diagonal)\s*\(/.test(text) ||
      /(?:=|\()\s*\.[a-zA-Z_]\w*/.test(text) ||
      (sym?.parentId != null && /\bconstant\s+/.test(text))
    ) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }

    if (/\bfor\s+[a-zA-Z_]\w*\s+in\b/.test(text)) {
      const cst = this.db.cstNode(classId) as any;
      if (cst) {
        const forEqs: any[] = [];
        const findForEqs = (n: any) => {
          if (!n) return;
          if (n.type === "for_equation" || n.type === "ForEquation") {
            forEqs.push(n);
            return;
          }
          for (const c of n.children || []) findForEqs(c);
        };
        findForEqs(cst);
        for (const fe of forEqs) {
          const fi = fe.children?.find(
            (c: any) =>
              c.type === "for_indices" || c.type === "ForIndices" || c.type === "for_index" || c.type === "ForIndex",
          );
          if (fi) {
            const expr =
              fi.children?.find((c: any) => c.type === "expression" || c.type === "Expression") ??
              fi.children
                ?.find((c: any) => c.type === "for_index" || c.type === "ForIndex")
                ?.children?.find((c: any) => c.type === "expression" || c.type === "Expression");
            if (expr) {
              const exprText = expr.text?.trim() ?? "";
              const idMatches = exprText.match(/[a-zA-Z_]\w*/g);
              if (idMatches) {
                for (const idName of idMatches) {
                  const compSym = this.db.byName(idName)?.find((s) => s.parentId === classId && s.kind === "Component");
                  if (compSym) {
                    const ci = this.db.query<any>("componentInstance", compSym.id);
                    if (ci && ci.variability !== "parameter" && ci.variability !== "constant") {
                      this._unsupportedWasmCache.set(classId, true);
                      return true;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    const children = this.db.childrenOf(classId);
    const localCompNames = new Set(children.filter((c) => c.kind === "Component").map((c) => c.name));
    if (localCompNames.size > 0) {
      for (const compName of localCompNames) {
        if (new RegExp(`\\b${escapeRegExp(compName)}\\.[a-zA-Z_]\\w*\\s*\\(`).test(text)) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
      }
    }
    for (const child of children) {
      if (child.kind === "Extends") {
        const baseClass =
          this.db.query<any>("resolvedBaseClass", child.id) ??
          (classId
            ? (this.db.query<any>("resolveName", classId)?.(child.name) ??
              this.db.query<any>("resolveSimpleName", classId)?.(child.name))
            : null) ??
          this.db.byName(child.name)?.[0] ??
          (child.name.includes(".") ? this.db.byName(child.name.split(".").pop()!)?.[0] : undefined);
        if (baseClass) {
          const extModRaw = this.db.query<any>("extendsModificationParsed", child.id);
          const extModArgs: any[] = Array.isArray(extModRaw) ? extModRaw : (extModRaw?.args ?? []);
          if (extModArgs.length > 0) {
            const baseChildren = this.db.childrenOf(baseClass.id) || [];
            for (const mArg of extModArgs) {
              if (
                mArg?.name &&
                baseChildren.some((bc) => bc.name === mArg.name && (bc.kind === "Class" || bc.kind === "Package"))
              ) {
                this._unsupportedWasmCache.set(classId, true);
                return true;
              }
              const valTxt = String(mArg?.value?.text ?? mArg?.bindingExpression ?? "").trim();
              if (valTxt && localCompNames.has(valTxt)) {
                this._unsupportedWasmCache.set(classId, true);
                return true;
              }
            }
          }
          if (localCompNames.size > 0) {
            const baseElems = this.db.query<SymbolId[]>("instantiate", baseClass.id) || [];
            for (const eid of baseElems) {
              const eSym = this.db.symbol(eid);
              if (eSym && eSym.kind === "Component" && localCompNames.has(eSym.name)) {
                this._unsupportedWasmCache.set(classId, true);
                return true;
              }
            }
          }
          if (this.classHasUnsupportedWasmFeatures(baseClass.id, visited)) {
            this._unsupportedWasmCache.set(classId, true);
            return true;
          }
        }
      }
      if (child.kind === "Record" || this.isRecordSym(child)) {
        this._unsupportedWasmCache.set(classId, true);
        return true;
      }
      if (child.kind === "Class" || child.kind === "Model" || child.kind === "Block" || child.kind === "Connector") {
        if (this.classHasUnsupportedWasmFeatures(child.id, visited)) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
      }
      if (child.kind === "Component") {
        const childCst = this.db.cstNode(child.id) as any;
        if (childCst?.text && /\bif\s+/.test(childCst.text) && !/\bthen\b/.test(childCst.text)) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
        const compInst = this.db.query<any>("componentInstance", child.id);
        const rawSpec = String(compInst?.typeSpecifier ?? compInst?.typeName ?? "").trim();
        if (rawSpec.includes(".")) {
          const specParts = rawSpec.split(".");
          const leafSpec = specParts[specParts.length - 1]!;
          if (specParts.slice(0, -1).includes(leafSpec)) {
            this._unsupportedWasmCache.set(classId, true);
            return true;
          }
        }
        const targetClassId =
          this.db.query<SymbolId | null>("classInstance", child.id) ??
          compInst?.classInstance ??
          compInst?.classTargetId;
        const targetClass = targetClassId
          ? this.db.symbol(targetClassId)
          : ((classId && compInst?.typeSpecifier
              ? (this.db.query<any>("resolveName", classId)?.(compInst.typeSpecifier) ??
                this.db.query<any>("resolveSimpleName", classId)?.(compInst.typeSpecifier))
              : null) ??
            this.db.byName(rawSpec)?.[0] ??
            (rawSpec.includes(".") ? this.db.byName(rawSpec.split(".").pop()!)?.[0] : undefined));
        if (
          !targetClassId &&
          rawSpec &&
          rawSpec !== "Real" &&
          rawSpec !== "Integer" &&
          rawSpec !== "Boolean" &&
          rawSpec !== "String" &&
          rawSpec !== "Clock" &&
          rawSpec !== "StateSelect" &&
          rawSpec !== "ExternalObject" &&
          rawSpec !== "AssertionLevel" &&
          !rawSpec.startsWith("enumeration") &&
          !rawSpec.startsWith("SI.") &&
          !rawSpec.startsWith("Modelica.SIunits.") &&
          !rawSpec.startsWith("Modelica.Units.SI.")
        ) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
        const isTypeTarget =
          targetClass &&
          (targetClass.kind === "Type" || String(targetClass.metadata?.classKind ?? "").toLowerCase() === "type");
        if (targetClass && !isTypeTarget && localCompNames.size > 0) {
          const targetCst = this.db.cstNode(targetClass.id) as any;
          const targetText = targetCst?.text ? stripCommentsAndStrings(targetCst.text) : "";
          if (targetText && !/\bouter\b/.test(targetText)) {
            for (const ln of localCompNames) {
              if (new RegExp(`=[^;]*\\b${escapeRegExp(ln)}\\b`).test(targetText)) {
                this._unsupportedWasmCache.set(classId, true);
                return true;
              }
            }
          }
        }
        if (
          targetClass &&
          !isTypeTarget &&
          (targetClass.kind === "Record" ||
            this.isRecordSym(targetClass) ||
            this.classHasUnsupportedWasmFeatures(targetClass.id, visited))
        ) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
      }
    }

    const seenNames = new Set<string>();
    for (const child of children) {
      if (child.name && (child.kind === "Component" || child.kind === "Class")) {
        if (seenNames.has(child.name)) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
        seenNames.add(child.name);
      }
    }
    {
      const src = (sym?.resourceId ? (this.db as any).source?.(sym.resourceId) : undefined) || text;
      if (
        typeof src === "string" &&
        (/\bexternal\s+"builtin"/.test(src) || /\bderivative\s*(?:\([^)]*\))?\s*=/.test(src))
      ) {
        this._unsupportedWasmCache.set(classId, true);
        return true;
      }
      const rootChildren = this.db.childrenOf(null) ?? [];
      const topSymbols = rootChildren.filter((s: any) => !sym?.resourceId || s.resourceId === sym.resourceId);
      const topNames = new Set<string>();
      for (const s of topSymbols) {
        if (s.name === "Clock" || topNames.has(s.name)) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
        topNames.add(s.name);
        if (s.kind === "Function" || s.kind === "Class" || s.kind === "Package") {
          let fnText = "";
          if (s.startOffset != null && s.endOffset != null && typeof (this.db as any).cstText === "function") {
            fnText = (this.db as any).cstText(s.startOffset, s.endOffset, s) ?? "";
          }
          if (!fnText) {
            fnText = (this.db.cstNode(s.id) as any)?.text ?? "";
          }
          if (/\bexternal\s+"builtin"/.test(fnText) || /\bderivative\s*(?:\([^)]*\))?\s*=/.test(fnText)) {
            this._unsupportedWasmCache.set(classId, true);
            return true;
          }
        }
      }
    }

    this._unsupportedWasmCache.set(classId, false);
    return false;
  }

  public getUnsupportedWasmReasons(classId?: SymbolId | null, visited = new Set<SymbolId>()): string[] {
    const reasons: string[] = [];
    if (!classId || visited.has(classId)) return reasons;
    visited.add(classId);

    const sym = this.db.symbol(classId);
    let rawText = "";
    if (sym && sym.startOffset != null && sym.endOffset != null) {
      if (typeof (this.db as any).cstText === "function") {
        rawText = (this.db as any).cstText(sym.startOffset, sym.endOffset, sym) ?? "";
      }
      if (!rawText && sym.resourceId) {
        const s = (this.db as any).source?.(sym.resourceId);
        if (typeof s === "string") {
          rawText = s.slice(sym.startOffset, sym.endOffset);
        }
      }
    }
    if (!rawText) {
      const cst = this.db.cstNode(classId) as any;
      rawText = cst?.text ?? "";
    }

    const text = stripCommentsAndStrings(rawText);

    if (
      /\bconnector\s+[a-zA-Z_]\w*\s*=\s*(?!(?:(?:input|output|flow|parameter)\s+)?\.?(?:[a-zA-Z_]\w*\.)*[a-zA-Z_]\w*(?:\[[^\]]*\])?\b)[a-zA-Z_]/.test(
        text,
      ) ||
      /\btype\s+[a-zA-Z_]\w*\s*=\s*(?!enumeration\b|(?:(?:input|output|flow|parameter)\s+)?\.?(?:[a-zA-Z_]\w*\.)*[a-zA-Z_]\w*(?:\[[^\]]*\])?\b)[a-zA-Z_]/.test(
        text,
      )
    ) {
      reasons.push("type-or-connector-alias");
    }
    if (/\benum\s+[a-zA-Z_]\w*\s*[(=;]/.test(text)) {
      reasons.push("enumeration");
    }
    if (/\bConnections\s*\./.test(text) || /\bequalityConstraint\b/.test(text)) {
      reasons.push("overconstrained-connections");
    }

    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (child.kind === "Extends") {
        const baseClass =
          this.db.query<any>("resolvedBaseClass", child.id) ??
          (classId
            ? (this.db.query<any>("resolveName", classId)?.(child.name) ??
              this.db.query<any>("resolveSimpleName", classId)?.(child.name))
            : null) ??
          this.db.byName(child.name)?.[0];
        if (baseClass) {
          const subReasons = this.getUnsupportedWasmReasons(baseClass.id, visited);
          if (subReasons.length > 0) {
            reasons.push(`extends:${baseClass.name}(${subReasons[0]})`);
          }
        }
      }
      if (child.kind === "Class" || child.kind === "Model" || child.kind === "Block" || child.kind === "Connector") {
        const subReasons = this.getUnsupportedWasmReasons(child.id, visited);
        if (subReasons.length > 0) {
          reasons.push(`nested-class:${child.name}(${subReasons[0]})`);
        }
      }
      if (child.kind === "Component") {
        const compInst = this.db.query<any>("componentInstance", child.id);
        const targetClassId = compInst?.classInstance ?? compInst?.classTargetId;
        const targetClass = targetClassId
          ? this.db.symbol(targetClassId)
          : ((classId && compInst?.typeSpecifier
              ? (this.db.query<any>("resolveName", classId)?.(compInst.typeSpecifier) ??
                this.db.query<any>("resolveSimpleName", classId)?.(compInst.typeSpecifier))
              : null) ?? this.db.byName(compInst?.typeSpecifier ?? compInst?.typeName ?? "")?.[0]);
        const isTypeTarget =
          targetClass &&
          (targetClass.kind === "Type" || String(targetClass.metadata?.classKind ?? "").toLowerCase() === "type");
        if (targetClass && !isTypeTarget) {
          const subReasons = this.getUnsupportedWasmReasons(targetClass.id, visited);
          if (subReasons.length > 0) {
            reasons.push(`child-component:${child.name}(${subReasons[0]})`);
          }
        }
      }
    }

    const seenNames = new Set<string>();
    for (const child of children) {
      if (child.name && (child.kind === "Component" || child.kind === "Class")) {
        if (seenNames.has(child.name)) {
          reasons.push(`duplicate-name:${child.name}`);
          break;
        }
        seenNames.add(child.name);
      }
    }
    if (sym?.resourceId) {
      const allSyms = typeof (this.db as any).allEntries === "function" ? (this.db as any).allEntries() : [];
      const topSymbols = (allSyms as SymbolEntry[]).filter(
        (s: any) => s.resourceId === sym.resourceId && (s.parentId === null || s.parentId === 0),
      );
      const topNames = new Set<string>();
      for (const s of topSymbols) {
        if (s.name === "Clock" || topNames.has(s.name)) {
          reasons.push("top-clock-or-duplicate");
          break;
        }
        topNames.add(s.name);
      }
    }

    return reasons;
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
    this.currentFlatteningFunctionId = null;
    this.currentFunctionEnclosingScope = null;
    this.currentParentMods = undefined;
    this.bodySnapshot = null;
    this.currentImports = this.collectClassImports(rootClassId);
    const rootSym = this.db.symbol(rootClassId);
    const rootName = rootSym?.name ?? "Model";
    const classCst = this.db.cstNode(rootClassId) as any;
    const wasmExports = classCst?.tree?.facade?.exports ?? classCst?.facade?.exports;
    let dae = cachedArena ?? new DAEBuilder(wasmExports, rootName, "");
    this.state = getFlatteningState(dae, this);
    (this as any).currentRootDae = dae;
    this.state.innerOuterComponents = this.innerOuterComponents;
    this.state.activeLoopVars = this.activeLoopVars;
    this.state.db = this.db;
    this.state.flattener = this;
    this.state.currentClassId = rootClassId;
    this.state.isRealNameCache?.clear();
    this.state.varPrefixSet?.clear();
    this.state.varPrefixCount = 0;
    const rawKind = (rootSym?.metadata as any)?.classKind ?? (rootSym?.metadata as any)?.classPrefixes ?? "model";
    let specKind: string | null = null;
    if (typeof rawKind === "string") {
      const cleanKind = rawKind.replace(/\/\/[^\r\n]*|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, " ").trim();
      const words = cleanKind.split(/\s+/).filter(Boolean);
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
    (dae.extensionMetadata as any).hasOldInstOption = compilerOpts.hasOldInstAnnotation;
    // Check for non-instantiable class specializations (package, function, etc.)
    const classCstForCheck = classCst as SyntaxNode | null;
    const ownOldInstText: string = classCst?.text ?? "";
    const optIdx = ownOldInstText.lastIndexOf("-d=-newInst");
    const optIsNested = optIdx >= 0 && /\bend\s+[A-Za-z_]\w*\s*;[\s\S]*\bend\s/.test(ownOldInstText.slice(optIdx));
    const hasExtendsInPkg =
      specKind === "package" && optIdx < 0 && this.db.childrenOf(rootClassId).some((c) => c.kind === "Extends");
    const allowOldInstSpec = isOldInst && !(specKind === "package" && (optIsNested || hasExtendsInPkg));
    if (specKind && !((specKind === "function" || specKind === "package") && allowOldInstSpec)) {
      let startPos = classCstForCheck?.startPosition;
      let startB = classCstForCheck?.startIndex ?? (classCstForCheck as any)?.startOffset ?? 0;
      const pfxNode = classCstForCheck ? Cst.ClassDefinition.classPrefixes(classCstForCheck) : null;
      if (pfxNode?.children) {
        for (const child of pfxNode.children) {
          if (child.type !== "comment" && child.type !== "description") {
            startPos = child.startPosition ?? startPos;
            startB = child.startIndex ?? (child as any).startOffset ?? startB;
            break;
          }
        }
      }
      const range = classCstForCheck
        ? {
            startOffset: startB,
            endOffset: classCstForCheck.endIndex ?? (classCstForCheck as any).endOffset ?? 0,
            startPosition: startPos,
            endPosition: classCstForCheck.endPosition,
          }
        : undefined;
      const msg =
        specKind === "type"
          ? `In class .${rootName}, class specialization 'type' can only be derived from predefined types.`
          : `Cannot instantiate ${rootName} due to class specialization ${specKind}.`;
      dae.diagnostics.push({
        severity: "error",
        message: msg,
        range: specKind === "type" ? undefined : range,
      });
      return dae;
    }

    // Check for partial root class
    const isPartialRoot =
      this.isClassPartial(rootClassId) ||
      Boolean(
        classCstForCheck?.text && /^(?:(?:encapsulated|pure|impure)\s+)*partial\b/.test(classCstForCheck.text.trim()),
      );
    if (isPartialRoot) {
      let startPos = classCstForCheck?.startPosition;
      let startB = classCstForCheck?.startIndex ?? (classCstForCheck as any)?.startOffset ?? 0;
      const pfxNode = classCstForCheck ? Cst.ClassDefinition.classPrefixes(classCstForCheck) : null;
      if (pfxNode?.children) {
        for (const child of pfxNode.children) {
          if (child.type !== "comment" && child.type !== "description") {
            startPos = child.startPosition ?? startPos;
            startB = child.startIndex ?? (child as any).startOffset ?? startB;
            break;
          }
        }
      }
      const range = classCstForCheck
        ? {
            startOffset: startB,
            endOffset: classCstForCheck.endIndex ?? (classCstForCheck as any).endOffset ?? 0,
            startPosition: startPos,
            endPosition: classCstForCheck.endPosition,
          }
        : undefined;
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.PARTIAL_INSTANTIATION.code,
        message: ModelicaErrorCode.PARTIAL_INSTANTIATION.message(rootName),
        range,
      });
      return dae;
    }

    this.validateOperatorRecords(dae, rootClassId);
    this.validateClassSpecializationRestrictions(dae, rootClassId);
    this.extractClassAnnotations(dae, rootClassId);

    this.expandableBuses.clear();
    let useLocalDirection = Boolean(
      (this.options as any)?.useLocalDirection ||
      classCst?.text?.includes("--useLocalDirection") ||
      classCst?.tree?.rootNode?.text?.includes("--useLocalDirection") ||
      (this.db.cstNode(rootClassId) as any)?.text?.includes("--useLocalDirection"),
    );
    if (!useLocalDirection && rootSymForOldInst?.resourceId) {
      const src = (this.db as any).source?.(rootSymForOldInst.resourceId);
      if (typeof src === "string" && src.includes("--useLocalDirection")) {
        useLocalDirection = true;
      }
    }
    this.useLocalDirection = useLocalDirection;
    if (classCst) {
      const findDesc = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
        if (!n) return null;
        if (Cst.LongClassSpecifier.is(n)) return Cst.LongClassSpecifier.description(n);
        if (Cst.ShortClassSpecifier.is(n)) return Cst.ShortClassSpecifier.description(n);
        if (Cst.ClassDefinition.is(n)) {
          const spec = Cst.ClassDefinition.classSpecifier(n);
          const d = findDesc(spec);
          if (d) return d;
        }
        for (const child of n.children) {
          if (Cst.LongClassSpecifier.is(child)) return Cst.LongClassSpecifier.description(child);
          if (Cst.ShortClassSpecifier.is(child)) return Cst.ShortClassSpecifier.description(child);
        }
        return null;
      };
      const descNode = findDesc(classCst);
      if (descNode) {
        let descText = descNode.text?.trim() ?? "";
        if (descText.startsWith('"') && descText.endsWith('"')) {
          descText = descText.slice(1, -1);
          if (descText) dae.description = descText;
        }
      }
    }

    // Validate extends clauses (illegal components in path, replaceable base classes, inherited extends cycles)
    const extendsClauses = this.db.childrenOf(rootClassId).filter((c) => c.kind === "Extends");
    for (let extIdx = 0; extIdx < extendsClauses.length; extIdx++) {
      const ext = extendsClauses[extIdx]!;
      const extCst = this.db.cstNode(ext.id) as any;
      const extRange = extCst
        ? { startOffset: extCst.startIndex ?? extCst.startOffset, endOffset: extCst.endIndex ?? extCst.endOffset }
        : undefined;

      const parts = ext.name.split(".");
      let currentScope: SymbolEntry | null = this.db.symbol(rootClassId) ?? null;
      const isEncapsulatedRoot = isScopeEncapsulated(this.db, rootClassId);
      const resolvedChain: { name: string; symbol: SymbolEntry | null }[] = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        let resolved: SymbolEntry | null = null;
        if (i === 0) {
          const resolver =
            this.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", currentScope?.id ?? rootClassId) ??
            this.db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope?.id ?? rootClassId);
          resolved = resolver ? resolver(part) : null;
          if (!resolved && !isEncapsulatedRoot) {
            resolved = this.db.byName(part).find((e) => e.kind === "Class" || e.kind === "Component") ?? null;
          }
        } else {
          if (currentScope) {
            resolved = this.db.childrenOf(currentScope.id).find((c) => c.name === part) ?? null;
          }
        }
        resolvedChain.push({ name: part, symbol: resolved });
        currentScope = resolved;
      }

      if (!currentScope && isEncapsulatedRoot) {
        const scopeFQN = getSymbolQualifiedName(this.db, rootClassId);
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.code,
          message: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.message(ext.name, scopeFQN),
          range: extRange,
        });
        return dae;
      }

      // Check 1: Part of base class name is a component instead of a class
      for (const item of resolvedChain) {
        if (item.symbol && item.symbol.kind === "Component") {
          const compCst = this.db.cstNode(item.symbol.id) as any;
          let clauseCst = compCst;
          while (clauseCst && clauseCst.type !== "component_clause" && clauseCst.parent) {
            clauseCst = clauseCst.parent;
          }
          const targetCst = clauseCst && clauseCst.type === "component_clause" ? clauseCst : compCst;
          const compRange = targetCst
            ? {
                startOffset: targetCst.startIndex ?? targetCst.startOffset,
                endOffset: targetCst.endIndex ?? targetCst.endOffset,
              }
            : undefined;
          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: compRange,
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.PARTIAL_BASE_CLASS.code,
            message: `Part ${item.name} of base class name ${ext.name} is not a class.`,
            range: extRange,
          });
          return dae;
        }
      }

      // Check 1b: Part of base class name is partial, name lookup is not allowed in partial classes
      for (let i = 0; i < parts.length - 1; i++) {
        const item = resolvedChain[i];
        if (item?.symbol && this.isClassPartial(item.symbol.id)) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.PARTIAL_LOOKUP_DISALLOWED.code,
            message: ModelicaErrorCode.PARTIAL_LOOKUP_DISALLOWED.message(item.name),
            range: extRange,
          });
          return dae;
        }
      }

      // Check 2: Replaceable base class or segment
      for (let i = 0; i < resolvedChain.length; i++) {
        const item = resolvedChain[i]!;
        if (item.symbol) {
          const isRep = this.db.query<boolean>("isReplaceable", item.symbol.id);
          if (isRep) {
            const repCst = this.db.cstNode(item.symbol.id) as any;
            let repParent = repCst;
            while (repParent && repParent.type !== "element") {
              if (repParent.type === "composition") break;
              repParent = repParent.parent;
            }
            const targetRepNode = repParent ?? repCst;
            const repRange = targetRepNode
              ? {
                  startOffset: targetRepNode.startIndex ?? targetRepNode.startOffset,
                  endOffset: targetRepNode.endIndex ?? targetRepNode.endOffset,
                }
              : undefined;

            const annotatedPath =
              parts.length === 1 ? parts[0] : parts.map((p, idx) => (idx === i ? `<${p}>` : p)).join(".");

            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
              message: "From here:",
              range: repRange,
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.REPLACEABLE_BASE_CLASS.code,
              message: `Class '${item.name}' in 'extends ${annotatedPath}' is replaceable, the base class name must be transitively non-replaceable.`,
              range: extRange,
            });
            return dae;
          }
        }
      }

      // Check 3: Base class name depends on inherited elements from prior extends clauses
      const firstPart = parts[0];
      const priorMatches: { prevExt: SymbolEntry; prevBase: SymbolEntry; innerClass: SymbolEntry }[] = [];
      for (let j = 0; j < extIdx; j++) {
        const prevExt = extendsClauses[j]!;
        const prevBase =
          this.db.query<SymbolEntry | null>("resolvedBaseClass", prevExt.id) ??
          this.db.byName(prevExt.name).find((e) => e.kind === "Class");
        if (prevBase) {
          const innerClass = this.db.childrenOf(prevBase.id).find((c) => c.kind === "Class" && c.name === firstPart);
          if (innerClass) {
            priorMatches.push({ prevExt, prevBase, innerClass });
          }
        }
      }
      if (priorMatches.length > 0) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.BASE_CLASS_AMBIGUOUS.code,
          message: `The base class name ${firstPart} was found in one or more base classes:`,
          range: extRange,
        });
        for (const m of priorMatches) {
          const innerCst = this.db.cstNode(m.innerClass.id) as any;
          const innerRange = innerCst
            ? {
                startOffset: innerCst.startIndex ?? innerCst.startOffset,
                endOffset: innerCst.endIndex ?? innerCst.endOffset,
              }
            : undefined;
          const prevExtCst = this.db.cstNode(m.prevExt.id) as any;
          const prevExtRange = prevExtCst
            ? {
                startOffset: prevExtCst.startIndex ?? prevExtCst.startOffset,
                endOffset: prevExtCst.endIndex ?? prevExtCst.endOffset,
              }
            : undefined;

          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: innerRange,
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.BASE_CLASS_FOUND_IN.code,
            message: `${firstPart} was found in base class ${m.prevBase.name}.`,
            range: prevExtRange,
          });
        }
        return dae;
      }
    }

    // Check 4: Class specialization violation for short class specifiers and redeclarations
    const checkedClassSyms = new Set<SymbolId>();
    for (const child of this.db.childrenOf(rootClassId)) {
      if (child.kind === "Class") {
        checkedClassSyms.add(child.id);
        const violation = this.checkTypeAliasSpecialization(child.id);
        if (violation) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CLASS_SPECIALIZATION_VIOLATION.code,
            message: `Class specialization violation: .${violation.targetName} is ${violation.kindDesc}, not a type.`,
            range: violation.range,
          });
          return dae;
        }
      }
    }
    if (rootSym?.resourceId) {
      const fileSyms = this.getFileSymbols(rootSym.resourceId);
      for (const s of fileSyms) {
        if (s.kind === "Class" && !checkedClassSyms.has(s.id)) {
          const violation = this.checkTypeAliasSpecialization(s.id);
          if (violation) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.CLASS_SPECIALIZATION_VIOLATION.code,
              message: `Class specialization violation: .${violation.targetName} is ${violation.kindDesc}, not a type.`,
              range: violation.range,
            });
            return dae;
          }
        }
      }
    }
    const rootModForSpec = this.db.query<any>("effectiveModification", rootClassId);
    if (rootModForSpec?.args) {
      for (const arg of rootModForSpec.args) {
        if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
          const targetClass = this.db
            .byName(arg.redeclaredTypeSpecifier.split(".").pop()!)
            .find((e) => e.kind === "Class");
          if (targetClass && !this.isClassType(targetClass.id)) {
            const targetCst = this.db.cstNode(targetClass.id) as any;
            const prefixes = Cst.ClassDefinition.classPrefixes(targetCst);
            const cleanPrefixes = (prefixes?.text ?? "").replace(/\/\/[^\r\n]*|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, "");
            let kindDesc = "a new def";
            if (/\bmodel\b/.test(cleanPrefixes)) kindDesc = "a model";
            else if (/\bblock\b/.test(cleanPrefixes)) kindDesc = "a block";
            else if (/\brecord\b/.test(cleanPrefixes)) kindDesc = "a record";
            else if (/\bconnector\b/.test(cleanPrefixes)) kindDesc = "a connector";

            const rootCst = this.db.cstNode(rootClassId) as any;
            const rootCstText = rootCst?.text ?? "";
            const redeclMatch = rootCstText.match(
              new RegExp(
                `redeclare\\s+type\\s+${escapeRegExp(arg.name)}\\s*=\\s*${escapeRegExp(arg.redeclaredTypeSpecifier)}`,
              ),
            );
            if (redeclMatch) {
              const startIdx = rootCstText.indexOf(redeclMatch[0]);
              const r =
                startIdx >= 0 ? { startOffset: startIdx, endOffset: startIdx + redeclMatch[0].length } : undefined;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.CLASS_SPECIALIZATION_VIOLATION.code,
                message: `Class specialization violation: .${arg.redeclaredTypeSpecifier} is ${kindDesc}, not a type.`,
                range: r,
              });
              return dae;
            }
          }
        }
      }
    }

    // 1. Check for duplicate top-level symbols in the same file (DoubleClassDeclaration1, ErrorMultipleClasses, Clock2)
    if (rootSym?.resourceId) {
      const topLevelSymbols = (this.db.childrenOf(null) ?? []).filter(
        (s: any) => s.resourceId === rootSym.resourceId && (s.kind === "Class" || s.kind === "Component"),
      );

      const seenTop = new Map<string, SymbolEntry>();
      for (const s of topLevelSymbols) {
        // Built-in type check for top-level classes
        if (
          s.name === "Clock" ||
          s.name === "Real" ||
          s.name === "Integer" ||
          s.name === "Boolean" ||
          s.name === "String"
        ) {
          const currCst = this.db.cstNode(s.id) as any;
          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: undefined,
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.DUPLICATE_ELEMENT.code,
            message: ModelicaErrorCode.DUPLICATE_ELEMENT.message(s.name),
            range: this.getElementDiagRange(currCst),
          });
          return dae;
        }

        const prev = seenTop.get(s.name);
        if (prev) {
          const prevCst = this.db.cstNode(prev.id) as any;
          const currCst = this.db.cstNode(s.id) as any;
          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: this.getElementDiagRange(prevCst),
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.DUPLICATE_ELEMENT.code,
            message: ModelicaErrorCode.DUPLICATE_ELEMENT.message(s.name),
            range: this.getElementDiagRange(currCst),
          });
          return dae;
        }
        seenTop.set(s.name, s);
      }
    }

    // 2. Check for duplicate local elements in rootClassId or any nested class (DuplicateElements1..4, DoubleClassDeclaration2, DoubleFuncDeclaration)
    const checkDuplicateScopeElements = (classId: SymbolId): boolean => {
      const localElems = this.db.childrenOf(classId).filter((c) => c.kind === "Component" || c.kind === "Class");
      const seenLocal = new Map<string, SymbolEntry>();
      for (const elem of localElems) {
        const prevElem = seenLocal.get(elem.name);
        if (prevElem) {
          const prevCst = this.db.cstNode(prevElem.id) as any;
          const currCst = this.db.cstNode(elem.id) as any;
          const isRedecl = (node: any) => {
            let curr = node;
            while (curr && curr.type !== "class_definition") {
              if (
                curr.type === "element" &&
                (curr.text?.trim().startsWith("redeclare") || curr.text?.includes("redeclare "))
              )
                return true;
              curr = curr.parent;
            }
            return false;
          };
          if (isRedecl(currCst) || isRedecl(prevCst)) {
            continue;
          }

          const prevRange = this.getElementDiagRange(prevCst);
          const currRange = this.getElementDiagRange(currCst);

          let notifRange = prevRange;
          let errorRange = currRange;
          // In OMC, if one is Class and one is Component, the Class is reported as the original (notification)
          if (elem.kind === "Component" && prevElem.kind === "Class") {
            notifRange = prevRange;
            errorRange = currRange;
          } else if (elem.kind === "Class" && prevElem.kind === "Component") {
            notifRange = currRange;
            errorRange = prevRange;
          }
          if (dae.extensionMetadata?.["isOldFrontend"] && elem.kind === "Component" && prevElem.kind === "Component") {
            const getClause = (node: any) => {
              let curr = node;
              while (curr && curr.type !== "component_clause") curr = curr.parent;
              return curr ?? node;
            };
            const prevCl = getClause(prevCst);
            const currCl = getClause(currCst);
            let prevText = (prevCl?.text?.trim() ?? "").replace(/;$/, "");
            const currText = (currCl?.text?.trim() ?? "").replace(/;$/, "");
            prevText = prevText.replace(/^([a-zA-Z_]\w*)\[([^\]]+)\]\s+([a-zA-Z_]\w*)/, "$1 $3[$2]");
            const classImports = this.collectClassImports(classId);
            const resolveImportText = (txt: string) => {
              let res = txt;
              for (const [alias, target] of classImports) {
                res = res.replace(new RegExp(`\\b${escapeRegExp(alias)}\\.`, "g"), `${target}.`);
              }
              return res;
            };
            const resolvedPrev = resolveImportText(prevText);
            const resolvedCurr = resolveImportText(currText);
            if (resolvedPrev === resolvedCurr) {
              const fmtPrev = /^(?:Real|Integer|Boolean|String)\b/.test(resolvedPrev)
                ? resolvedPrev
                : `.${resolvedPrev}`;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.DUPLICATE_ELEMENT.code,
                message: `Duplicate elements:\n ${fmtPrev}.`,
                range: this.getElementDiagRange(prevCl),
              });
              return true;
            }
            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
              message: "From here:",
              range: this.getElementDiagRange(currCl),
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.DUPLICATE_INHERITED_ELEMENT_NOT_IDENTICAL.code,
              message: `Duplicate elements (due to inherited elements) not identical:\n  first element is:  ${currText}\n  second element is: ${prevText}`,
              range: this.getElementDiagRange(prevCl),
            });
            return true;
          }

          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: notifRange,
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.DUPLICATE_ELEMENT.code,
            message: ModelicaErrorCode.DUPLICATE_ELEMENT.message(elem.name),
            range: errorRange,
          });
          return true;
        }
        seenLocal.set(elem.name, elem);
      }

      for (const elem of localElems) {
        if (elem.kind === "Class") {
          if (checkDuplicateScopeElements(elem.id)) return true;
        }
      }
      return false;
    };

    if (checkDuplicateScopeElements(rootClassId)) {
      return dae;
    }

    const localComps = this.db.childrenOf(rootClassId).filter((c) => c.kind === "Component");
    for (const comp of localComps) {
      const compCst = this.db.cstNode(comp.id) as any;
      let clauseNode: any = compCst;
      while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.type !== "class_definition") {
        clauseNode = clauseNode.parent;
      }
      if (clauseNode && clauseNode.type === "component_clause") {
        const typeSpecNode = clauseNode.children?.find((c: any) => c.type === "type_specifier");
        const typeSpec = typeSpecNode?.text?.trim();
        if (typeSpec && !typeSpec.includes(".") && comp.name === typeSpec) {
          const rangeObj = {
            startOffset: clauseNode.startIndex ?? clauseNode.startOffset,
            endOffset: clauseNode.endIndex ?? clauseNode.endOffset,
            startPosition: clauseNode.startPosition,
            endPosition: clauseNode.endPosition,
          };
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.SAME_NAME_TYPE_SHADOWING.code,
            message: `Found a component with same name when looking for type ${typeSpec}.`,
            range: rangeObj,
          });
          return dae;
        }
      }
    }

    for (const ext of extendsClauses) {
      const extCst = this.db.cstNode(ext.id) as any;
      const extendsModParsedRaw = this.db.query<any>("extendsModificationParsed", ext.id);
      const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
        ? extendsModParsedRaw
        : (extendsModParsedRaw?.args ?? []);
      for (const arg of extendsModParsed) {
        if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
          if (!arg.redeclaredTypeSpecifier.includes(".") && arg.name === arg.redeclaredTypeSpecifier) {
            let redeclRange: any = undefined;
            if (extCst) {
              const extText = extCst.text ?? "";
              const m = extText.match(
                new RegExp(`redeclare\\s+${escapeRegExp(arg.name)}\\s+${escapeRegExp(arg.name)}`),
              );
              if (m && m.index != null) {
                const sByte = (extCst.startIndex ?? extCst.startOffset ?? 0) + m.index;
                const eByte = sByte + m[0].length;
                redeclRange = { startOffset: sByte, endOffset: eByte };
              }
            }
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.SAME_NAME_TYPE_SHADOWING.code,
              message: `Found a component with same name when looking for type ${arg.redeclaredTypeSpecifier}.`,
              range: redeclRange,
            });
            return dae;
          }
        }
      }
    }

    // Check for duplicate elements due to inherited elements and invalid break on record components
    const checkInheritedAndBreakErrors = (targetClassId: SymbolId): boolean => {
      const targetChildren = this.db.childrenOf(targetClassId);
      const targetExtends = targetChildren.filter((c) => c.kind === "Extends");
      const targetLocalComps = targetChildren.filter((c) => c.kind === "Component");
      const targetImports = this.collectClassImports(targetClassId);
      const isOldFE = Boolean(this.options.isOldFrontend || dae.extensionMetadata?.["isOldFrontend"]);
      const seenInheritedComps = new Map<
        string,
        { elem: SymbolEntry; clause: any; range: { startOffset: number; endOffset: number }; modText: string | null }
      >();

      const getClause = (node: any) => {
        let curr = node;
        while (curr && curr.type !== "component_clause") curr = curr.parent;
        if (curr && curr.parent && curr.parent.type === "element") {
          const parentText = curr.parent.text?.trim() ?? "";
          if (parentText.startsWith("final")) {
            return curr.parent;
          }
        }
        return curr;
      };

      const toRange = (clause: any, fallbackCst: any) =>
        clause
          ? {
              startOffset: clause.startIndex ?? clause.startOffset,
              endOffset: clause.endIndex ?? clause.endOffset,
            }
          : {
              startOffset: fallbackCst?.startIndex ?? fallbackCst?.startOffset ?? 0,
              endOffset: fallbackCst?.endIndex ?? fallbackCst?.endOffset ?? 0,
            };

      const formatArrayDimBeforeName = (txt: string) =>
        txt.replace(/^([a-zA-Z_.][\w.]*)\s+([a-zA-Z_]\w*)(\[[^\]]+\])/, "$1$3 $2");

      for (const ext of targetExtends) {
        const baseClass =
          this.db.query<SymbolEntry | null>("resolvedBaseClass", ext.id) ??
          (targetClassId
            ? (this.db.query<any>("resolveName", targetClassId)?.(ext.name) ??
              this.db.query<any>("resolveSimpleName", targetClassId)?.(ext.name))
            : null) ??
          this.db.byName(ext.name)[0];
        if (!baseClass) continue;

        if (targetClassId === rootClassId) {
          const innerConflict = this.db
            .childrenOf(baseClass.id)
            .find((c) => c.name === ext.name && (c.kind === "Class" || c.kind === "Package"));
          if (innerConflict) {
            const extCst = this.db.cstNode(ext.id) as any;
            const conflictCst = this.db.cstNode(innerConflict.id) as any;
            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
              message: "From here:",
              range: {
                startOffset: extCst?.startIndex ?? extCst?.startOffset,
                endOffset: extCst?.endIndex ?? extCst?.endOffset,
                startPosition: extCst?.startPosition,
                endPosition: extCst?.endPosition,
              },
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.EXTENDS_OTHER_BASE_CLASS.code,
              message: ModelicaErrorCode.EXTENDS_OTHER_BASE_CLASS.message(ext.name),
              range: {
                startOffset: conflictCst?.startIndex ?? conflictCst?.startOffset,
                endOffset: conflictCst?.endIndex ?? conflictCst?.endOffset,
                startPosition: conflictCst?.startPosition,
                endPosition: conflictCst?.endPosition,
              },
            });
            return true;
          }
        }

        const extendsModParsedRaw = this.db.query<any>("extendsModificationParsed", ext.id);
        const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
          ? extendsModParsedRaw
          : (extendsModParsedRaw?.args ?? []);
        const baseElements = this.db.query<SymbolId[]>("instantiate", baseClass.id) || [];
        const brokenNames = new Set<string>();
        const extCst = this.db.cstNode(ext.id) as any;

        for (const arg of extendsModParsed) {
          if ((arg.isBreak || arg.value?.kind === "break") && !arg.name.startsWith("break_connect:")) {
            brokenNames.add(arg.name);
            for (const baseElemId of baseElements) {
              const baseElem = this.db.symbol(baseElemId);
              if (baseElem && baseElem.kind === "Component" && baseElem.name === arg.name) {
                const compClassId = this.db.query<SymbolId | null>("classInstance", baseElem.id);
                const compClassSym = compClassId ? this.db.symbol(compClassId) : null;
                if (compClassSym && (compClassSym.kind === "Record" || this.isRecordSym(compClassSym))) {
                  const baseCst = this.db.cstNode(baseElem.id) as any;
                  const baseClause = getClause(baseCst);
                  const baseRange = toRange(baseClause, baseCst);
                  const notifRange = arg.nameRange
                    ? { startOffset: arg.nameRange[0], endOffset: arg.nameRange[1] }
                    : toRange(null, extCst);
                  dae.diagnostics.push({
                    severity: "notification",
                    code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                    message: "From here:",
                    range: notifRange,
                  });
                  dae.diagnostics.push({
                    severity: "error",
                    code: 4099,
                    message: `Invalid use of break on component '${arg.name}', component must be a model, block, or connector.`,
                    range: baseRange,
                  });
                  return true;
                }
              }
            }
          }
        }

        for (const baseElemId of baseElements) {
          const baseElem = this.db.symbol(baseElemId);
          if (!baseElem || baseElem.kind !== "Component") continue;
          if (brokenNames.has(baseElem.name)) continue;

          const baseCst = this.db.cstNode(baseElem.id) as any;
          const baseClause = getClause(baseCst);
          const baseRange = toRange(baseClause, baseCst);

          const extModArg = extendsModParsed.find(
            (a) => !a.isBreak && a.name === baseElem.name && (a.value?.text || a.bindingExpression),
          );
          const currModVal: string | null = extModArg
            ? String(extModArg.value?.text ?? extModArg.bindingExpression).trim()
            : null;

          const prevInh = seenInheritedComps.get(baseElem.name);
          if (prevInh && prevInh.elem.id !== baseElem.id) {
            if ((prevInh.modText !== null) !== (currModVal !== null)) {
              const prevRaw = formatArrayDimBeforeName((prevInh.clause?.text ?? "").trim().replace(/;$/, ""));
              const currRaw = formatArrayDimBeforeName(
                (baseClause?.text ?? baseCst?.text ?? "").trim().replace(/;$/, ""),
              );
              const applyModBinding = (raw: string, modVal: string | null) => {
                if (!modVal) return raw;
                if (raw.includes("=")) {
                  return raw.replace(/=\s*[^;]+$/, `= ${modVal}`);
                }
                return `${raw} = ${modVal}`;
              };
              const firstText = applyModBinding(prevRaw, prevInh.modText);
              const secondText = applyModBinding(currRaw, currModVal);
              if (firstText !== secondText) {
                dae.diagnostics.push({
                  severity: "notification",
                  code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                  message: "From here:",
                  range: prevInh.range,
                });
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.DUPLICATE_INHERITED_ELEMENT_NOT_IDENTICAL.code,
                  message: `Duplicate elements (due to inherited elements) not identical:\n  first element is:  ${firstText}\n  second element is: ${secondText}`,
                  range: baseRange,
                });
                return true;
              }
            }
          }
          seenInheritedComps.set(baseElem.name, {
            elem: baseElem,
            clause: baseClause ?? baseCst,
            range: baseRange,
            modText: currModVal,
          });

          const matchingLocal = targetLocalComps.find((c) => c.name === baseElem.name);
          if (matchingLocal) {
            const isRedecl = this.db.query<boolean>("isRedeclare", matchingLocal.id);
            if (!isRedecl) {
              const localCst = this.db.cstNode(matchingLocal.id) as any;
              const localClause = getClause(localCst);
              const localRange = toRange(localClause, localCst);
              const extStart = extCst?.startIndex ?? extCst?.startOffset ?? 0;

              const localText = (localClause?.text ?? localCst?.text ?? "").trim().replace(/;$/, "");
              const baseText = (baseClause?.text ?? baseCst?.text ?? "").trim().replace(/;$/, "");

              let resolvedLocalText = localText;
              let usedImportAlias = false;
              for (const [alias, target] of targetImports) {
                const re = new RegExp(`\\b${escapeRegExp(alias)}\\.`, "g");
                if (re.test(resolvedLocalText)) {
                  usedImportAlias = true;
                  resolvedLocalText = resolvedLocalText.replace(re, `${target}.`);
                }
              }

              const normDecl = (s: string) =>
                s
                  .replace(/\s+if\s+true\b/g, "")
                  .replace(/\(\s*([a-zA-Z_]\w*)\s*=\s*/g, "($1 = ")
                  .replace(/\s+/g, " ")
                  .trim();

              if (normDecl(resolvedLocalText) === normDecl(baseText)) {
                continue;
              }

              let firstRange = localRange;
              let secondRange = baseRange;
              let firstText = localText;
              let secondText = baseText;

              if (isOldFE) {
                let localDisp = resolvedLocalText.replace(/\(\s*([a-zA-Z_]\w*)\s*=\s*/g, "($1 = ");
                if (usedImportAlias && !localDisp.startsWith(".")) {
                  localDisp = `.${localDisp}`;
                }
                let baseDisp = baseText
                  .replace(/\(\s*([a-zA-Z_]\w*)\s*=\s*/g, "($1 = ")
                  .replace(/\b(Real|Integer|Boolean|String)\b/g, ".$1");
                if (/^[a-zA-Z_]\w*\.[a-zA-Z_]\w*/.test(baseDisp)) {
                  baseDisp = `.${baseDisp}`;
                }
                firstText = localDisp;
                secondText = baseDisp;
              } else {
                if (localRange.startOffset > extStart) {
                  firstRange = baseRange;
                  secondRange = localRange;
                  firstText = baseText;
                  secondText = localText;
                }
              }

              dae.diagnostics.push({
                severity: "notification",
                code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                message: "From here:",
                range: firstRange,
              });
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.DUPLICATE_INHERITED_ELEMENT_NOT_IDENTICAL.code,
                message: `Duplicate elements (due to inherited elements) not identical:\n  first element is:  ${firstText}\n  second element is: ${secondText}`,
                range: secondRange,
              });
              return true;
            }
          }
        }
      }

      for (const comp of targetLocalComps) {
        const compClassId = this.db.query<SymbolId | null>("classInstance", comp.id);
        const compInst = this.db.query<any>("componentInstance", comp.id);
        const modArgs: any[] = compInst?.modification?.args ?? [];
        if (compClassId && modArgs.length > 0) {
          for (const arg of modArgs) {
            if (arg.isBreak || !arg.name) continue;
            const nestedArgs: any[] = arg.nestedArgs ?? arg.args ?? [];
            if (nestedArgs.length === 0) continue;
            const member = classFindMember(this, compClassId, arg.name);
            if (
              member &&
              (member.kind === "Class" || member.kind === "Package") &&
              !this.db.query<boolean>("isReplaceable", member.id)
            ) {
              const memberCst = this.db.cstNode(member.id) as any;
              const isPkg =
                member.kind === "Package" ||
                String((member.metadata as any)?.classKind ?? "").toLowerCase() === "package" ||
                /\bpackage\b/.test(memberCst?.text ?? "");
              if (isPkg) {
                for (const nestedArg of nestedArgs) {
                  if (!nestedArg?.name) continue;
                  const nestedMember = classFindMember(this, member.id, nestedArg.name);
                  if (nestedMember && nestedMember.kind === "Component") {
                    const compCst = this.db.cstNode(comp.id) as any;
                    const compClause = getClause(compCst);
                    const compRange = toRange(compClause, compCst);
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
                      message: `Found component '${nestedArg.name}' in composite name '${comp.name}.${arg.name}.${nestedArg.name}', expected class.`,
                      range: compRange,
                    });
                    return true;
                  }
                }
              }
            }
          }
        }
      }
      return false;
    };

    if (checkInheritedAndBreakErrors(rootClassId)) {
      return dae;
    }
    for (const comp of localComps) {
      const compClassId = this.db.query<SymbolId | null>("classInstance", comp.id);
      if (compClassId && checkInheritedAndBreakErrors(compClassId)) {
        return dae;
      }
    }

    this.evaluatedConstantArrays.clear();
    if (this.options.omcCompatibility) {
      this.generateFunctions(rootClassId, dae);
    }

    let flattenedInWasm = false;
    let wasmBail: WasmBailInfo | null = null;
    const classNodePtr = classCst?.ptr ?? classCst?.id;
    const rootProgramPtr =
      classCst?.tree?.rootPtr ?? classCst?.tree?.rootNode?.ptr ?? (this.db as any)?.rootNode?.ptr ?? 0;
    const hasWasmFlattener = typeof dae.exports?.flattener_flatten === "function";
    const isStrictWasm = this.options.backend === "wasm";
    const isDiffMode = this.options.backend === "diff";
    const allowWasm =
      this.explicitArrayMode !== "preserve" &&
      (this.options.backend === "wasm" ||
        ((this.options.backend === "hybrid" || !this.options.backend) &&
          !this.options.omcCompatibility &&
          Boolean(this.options.useWasmKernel) &&
          !this.useLocalDirection &&
          !this.classHasRedeclare(rootClassId) &&
          !this.classHasUnsupportedWasmFeatures(rootClassId)));

    let wasmDiffStats: {
      varCount: number;
      eqCount: number;
      bail?: WasmBailInfo | undefined;
      error?: string | undefined;
    } | null = null;
    if (isDiffMode && hasWasmFlattener && classNodePtr) {
      let testDae: DAEBuilder | null = null;
      let wf = 0;
      try {
        testDae = new DAEBuilder(wasmExports, rootName, "");
        wf = testDae.exports.flattener_create ? testDae.exports.flattener_create(testDae.ptr) : 0;
        if (wf) {
          if (
            this.options.omcCompatibility &&
            typeof (testDae.exports as any)?.flattener_setOmcCompatibility === "function"
          ) {
            (testDae.exports as any).flattener_setOmcCompatibility(wf, isOldInst ? 1 : 2);
          }
          this.populateWasmScopeResolutions(wf, rootClassId, testDae);
          const vc = testDae.exports.flattener_flatten(wf, classNodePtr, rootProgramPtr);
          const errCode =
            typeof testDae.exports.flattener_getErrorCode === "function"
              ? testDae.exports.flattener_getErrorCode(wf)
              : 0;
          const ex = testDae.exports as any;
          const diffBail =
            errCode !== 0
              ? describeWasmBail(
                  errCode,
                  typeof ex.flattener_getErrorStartByte === "function" ? ex.flattener_getErrorStartByte(wf) : undefined,
                  typeof ex.flattener_getErrorEndByte === "function" ? ex.flattener_getErrorEndByte(wf) : undefined,
                  "ts-fallback",
                  typeof ex.lsp_isCharOffsetKernel === "function" && ex.lsp_isCharOffsetKernel()
                    ? 1
                    : inputEncodingUnitSize(
                        typeof ex.lsp_getInputEncoding === "function" ? ex.lsp_getInputEncoding() : undefined,
                      ),
                )
              : undefined;
          wasmDiffStats = { varCount: vc, eqCount: testDae.eqCount, bail: diffBail };
        }
      } catch (err: any) {
        wasmDiffStats = { varCount: 0, eqCount: 0, error: err?.message ?? String(err) };
      } finally {
        if (wf && (testDae?.exports as any)?.flattener_destroy) {
          try {
            (testDae!.exports as any).flattener_destroy(wf);
          } catch {
            // ignore
          }
        }
        if (testDae) {
          testDae.free?.();
        }
      }
      (this as any)._wasmDiffStats = wasmDiffStats;
    }

    if (!cachedArena && hasWasmFlattener && classNodePtr && allowWasm) {
      let wasmFlattener = 0;
      try {
        wasmFlattener = dae.exports.flattener_create(dae.ptr);
        if (wasmFlattener) {
          if (
            this.options.omcCompatibility &&
            typeof (dae.exports as any)?.flattener_setOmcCompatibility === "function"
          ) {
            (dae.exports as any).flattener_setOmcCompatibility(wasmFlattener, isOldInst ? 1 : 2);
          }
          this.populateWasmScopeResolutions(wasmFlattener, rootClassId, dae);
          const varCount = dae.exports.flattener_flatten(wasmFlattener, classNodePtr, rootProgramPtr);
          const wasmErrorCode =
            typeof dae.exports.flattener_getErrorCode === "function"
              ? dae.exports.flattener_getErrorCode(wasmFlattener)
              : 0;
          this.state.wasmErrorCode = wasmErrorCode;
          // In hybrid mode, if WASM flattener set a non-zero error code, fall back to TS
          const disabledCount =
            typeof (dae.exports as any)?.flattener_getDisabledCount === "function"
              ? (dae.exports as any).flattener_getDisabledCount(wasmFlattener)
              : 0;
          if (wasmErrorCode !== 0) {
            const ex = dae.exports as any;
            wasmBail = describeWasmBail(
              wasmErrorCode,
              typeof ex.flattener_getErrorStartByte === "function"
                ? ex.flattener_getErrorStartByte(wasmFlattener)
                : undefined,
              typeof ex.flattener_getErrorEndByte === "function"
                ? ex.flattener_getErrorEndByte(wasmFlattener)
                : undefined,
              isStrictWasm ? "strict-partial" : "ts-fallback",
              typeof ex.lsp_isCharOffsetKernel === "function" && ex.lsp_isCharOffsetKernel()
                ? 1
                : inputEncodingUnitSize(
                    typeof ex.lsp_getInputEncoding === "function" ? ex.lsp_getInputEncoding() : undefined,
                  ),
            );
          }
          const algSectionCount: number =
            typeof (dae.exports as any).flattener_getAlgorithmSectionCount === "function"
              ? (dae.exports as any).flattener_getAlgorithmSectionCount(wasmFlattener)
              : 0;
          const hybridAlgorithmGate =
            !isStrictWasm &&
            wasmErrorCode === 0 &&
            algSectionCount > 0 &&
            Boolean((this.options as any)?.allowNonStandardModelica?.length);
          if (hybridAlgorithmGate) {
            wasmBail = describeWasmBail(WasmBailReason.HybridAlgorithmGate, undefined, undefined, "ts-fallback");
          }
          const whenRecCount: number =
            typeof (dae.exports as any).flattener_getWhenRecordCount === "function"
              ? (dae.exports as any).flattener_getWhenRecordCount(wasmFlattener)
              : 0;
          const ifRecCount: number =
            typeof (dae.exports as any).flattener_getIfRecordCount === "function"
              ? (dae.exports as any).flattener_getIfRecordCount(wasmFlattener)
              : 0;
          if ((varCount > 0 || disabledCount > 0 || isStrictWasm) && wasmErrorCode === 0 && !hybridAlgorithmGate) {
            flattenedInWasm = true;
            this.recordWasmSourceRanges(dae, rootClassId);
            if (dae.functions.size > 0 && typeof (dae.exports as any).dae_setExprData1 === "function") {
              const origExprCount = dae.exprCount;
              for (let eIdx = 0; eIdx < origExprCount; eIdx++) {
                if (dae.getExprKind(eIdx) === ExprKind.Call) {
                  const rawCallName = dae.interner.resolve(dae.getExprData1(eIdx));
                  const fnDae = rawCallName ? dae.functions.get(rawCallName) : undefined;
                  if (fnDae) {
                    (fnDae as any).wasCalled = true;
                    let targetFnCallName =
                      fnDae.externalDecl && fnDae.externalDecl.includes('"builtin"') ? rawCallName : fnDae.name;
                    if (isOldInst && fnDae.externalDecl) {
                      const builtinMatch = fnDae.externalDecl.match(/=\s*(sin|cos)\s*\(\s*[^)\s]/);
                      if (builtinMatch) {
                        targetFnCallName = builtinMatch[1]!;
                      }
                    }
                    if (targetFnCallName && targetFnCallName !== rawCallName) {
                      const newId = dae.interner.intern(targetFnCallName);
                      (dae.exports as any).dae_setExprData1(dae.ptr, eIdx, newId);
                    }
                    if (typeof (dae.exports as any).flattener_setExprLeft === "function") {
                      const inputVarIndices: number[] = [];
                      for (let v = 0; v < fnDae.varCount; v++) {
                        if (fnDae.getVarCausality(v) === Causality.Input) {
                          inputVarIndices.push(v);
                        }
                      }
                      const argCount = dae.getExprRight(eIdx);
                      const limit = Math.min(argCount, inputVarIndices.length);
                      for (let argIdx = 0; argIdx < limit; argIdx++) {
                        const slotId = argIdx === 0 ? eIdx : eIdx + argIdx;
                        const argExprId = dae.getExprLeft(slotId);
                        if (argExprId === 0xffffffff || argExprId >= dae.exprCount) continue;
                        const formalVarIdx = inputVarIndices[argIdx]!;
                        const formalType = fnDae.getVarType(formalVarIdx);
                        const formalShape = fnDae.getVarShape(formalVarIdx);
                        if (
                          formalType === VarType.Real &&
                          !fnDae.getVarCustomType(formalVarIdx) &&
                          dae.getExprKind(argExprId) === ExprKind.IntLiteral
                        ) {
                          const realLitId = dae.addRealLiteral(dae.getExprData1(argExprId));
                          (dae.exports as any).flattener_setExprLeft(dae.ptr, slotId, realLitId);
                        } else if ((formalShape?.length ?? 0) === 1 && dae.getExprKind(argExprId) === ExprKind.Name) {
                          const argName = dae.interner.resolve(dae.getExprData1(argExprId));
                          if (
                            argName &&
                            dae.getVarIdxByName(argName) < 0 &&
                            dae.getVarIdxByName(`${argName}[1]`) >= 0
                          ) {
                            const elemIds: number[] = [];
                            for (let k = 1; dae.getVarIdxByName(`${argName}[${k}]`) >= 0; k++) {
                              elemIds.push(dae.addNameExpr(`${argName}[${k}]`));
                            }
                            if (elemIds.length > 0) {
                              const arrCtorId = dae.addArrayCtorExpr(elemIds);
                              (dae.exports as any).flattener_setExprLeft(dae.ptr, slotId, arrCtorId);
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            const exAlg = dae.exports as any;
            if (typeof exAlg.flattener_getAlgorithmSectionCount === "function") {
              const secCount: number = exAlg.flattener_getAlgorithmSectionCount(wasmFlattener);
              for (let s = 0; s < secCount; s++) {
                const section = {
                  start: exAlg.flattener_getAlgorithmSectionStart(wasmFlattener, s) as number,
                  count: exAlg.flattener_getAlgorithmSectionLength(wasmFlattener, s) as number,
                };
                if (exAlg.flattener_getAlgorithmSectionIsInitial(wasmFlattener, s)) {
                  dae.initialAlgorithmSections.push(section);
                } else {
                  dae.algorithmSections.push(section);
                }
              }
              if (secCount > 0) dae.hasAlgorithmSection = true;
            }
            if (typeof (dae.exports as any).flattener_getWhenRecordCount === "function" && whenRecCount > 0) {
              const exWhen = dae.exports as any;
              let offset = 0;
              for (let w = 0; w < whenRecCount; w++) {
                const whenEqIdx = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                const condExprId = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                const mainEqCount = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                const bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
                const equations: { kind: EqKind; lhs: number; rhs: number }[] = [];
                for (let k = 0; k < mainEqCount; k++) {
                  const kind = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++) as EqKind;
                  const lhs = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                  const rhs = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                  bodyEquations.push({ kind, lhsExprId: lhs, rhsExprId: rhs });
                  equations.push({ kind, lhs, rhs });
                }
                const elseWhenBranchCount = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                const elseWhenClauses: {
                  conditionExprId: number;
                  bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[];
                  equations: { kind: EqKind; lhs: number; rhs: number }[];
                }[] = [];
                for (let b = 0; b < elseWhenBranchCount; b++) {
                  const elseCondId = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                  const bEqCount = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                  const bBodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
                  const bEquations: { kind: EqKind; lhs: number; rhs: number }[] = [];
                  for (let k = 0; k < bEqCount; k++) {
                    const kind = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++) as EqKind;
                    const lhs = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                    const rhs = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                    bBodyEquations.push({ kind, lhsExprId: lhs, rhsExprId: rhs });
                    bEquations.push({ kind, lhs, rhs });
                  }
                  elseWhenClauses.push({
                    conditionExprId: elseCondId,
                    bodyEquations: bBodyEquations,
                    equations: bEquations,
                  });
                }
                dae.setWhenEquationMeta(whenEqIdx, {
                  conditionExprId: condExprId,
                  bodyEquations,
                  equations,
                  elseWhenClauses,
                  elseEquations: [],
                });
              }
            }
            if (typeof (dae.exports as any).flattener_getIfRecordCount === "function" && ifRecCount > 0) {
              const exIf = dae.exports as any;
              let offset = 0;
              for (let f = 0; f < ifRecCount; f++) {
                const ifEqIdx = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                const condExprId = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                const thenEqCount = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                const thenEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
                for (let k = 0; k < thenEqCount; k++) {
                  const kind = exIf.flattener_getIfRecordData(wasmFlattener, offset++) as EqKind;
                  const lhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                  const rhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                  thenEquations.push({ kind, lhsExprId: lhs, rhsExprId: rhs });
                }
                const elseIfBranchCount = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                const elseIfClauses: {
                  conditionExprId: number;
                  bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[];
                  equations: { kind: EqKind; lhs: number; rhs: number }[];
                }[] = [];
                for (let b = 0; b < elseIfBranchCount; b++) {
                  const elseCondId = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                  const bEqCount = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                  const bBodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
                  const bEquations: { kind: EqKind; lhs: number; rhs: number }[] = [];
                  for (let k = 0; k < bEqCount; k++) {
                    const kind = exIf.flattener_getIfRecordData(wasmFlattener, offset++) as EqKind;
                    const lhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                    const rhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                    bBodyEquations.push({ kind, lhsExprId: lhs, rhsExprId: rhs });
                    bEquations.push({ kind, lhs, rhs });
                  }
                  elseIfClauses.push({
                    conditionExprId: elseCondId,
                    bodyEquations: bBodyEquations,
                    equations: bEquations,
                  });
                }
                const elseEqCount = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                const elseEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
                for (let k = 0; k < elseEqCount; k++) {
                  const kind = exIf.flattener_getIfRecordData(wasmFlattener, offset++) as EqKind;
                  const lhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                  const rhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                  elseEquations.push({ kind, lhsExprId: lhs, rhsExprId: rhs });
                }
                dae.setIfEquationMeta(ifEqIdx, {
                  conditionExprId: condExprId,
                  thenEquations,
                  elseIfClauses,
                  elseEquations: elseEquations.length > 0 ? elseEquations : undefined,
                });
              }
            }
            for (let i = 0; i < dae.eqCount; i++) {
              const rhsId = dae.getEqRhs(i);
              dae.setOrigEqRhs(i, rhsId);
              if (rhsId >= 0) {
                const names = dae.collectExprVarNames(rhsId);
                for (const name of names) {
                  dae.registerParamEquationDep(name, i);
                }
              }
              const lhsId = dae.getEqLhs(i);
              if (lhsId >= 0) {
                const names = dae.collectExprVarNames(lhsId);
                for (const name of names) {
                  dae.registerParamEquationDep(name, i);
                }
              }
            }
            if (typeof (dae.exports as any)?.flattener_getExpandableBusCount === "function") {
              const busCount = (dae.exports as any).flattener_getExpandableBusCount(wasmFlattener);
              const busPrefixes: string[] = [];
              for (let b = 0; b < busCount; b++) {
                const id = (dae.exports as any).flattener_getExpandableBus(wasmFlattener, b);
                const busName = id === 0 ? "" : (dae.interner.resolve(id) ?? "");
                busPrefixes.push(busName);
                this.expandableBuses.set(busName, 0 as any);
              }
              dae.extensionMetadata.expandableBuses = busPrefixes;
            }
            if (typeof (dae.exports as any)?.flattener_getArrayCount === "function") {
              const exArr = dae.exports as any;
              const aCount = exArr.flattener_getArrayCount(wasmFlattener);
              for (let a = 0; a < aCount; a++) {
                const nameId = exArr.flattener_getArrayName(wasmFlattener, a);
                const name = dae.interner.resolve(nameId);
                if (name) {
                  const nDims = exArr.flattener_getArrayNDims(wasmFlattener, a);
                  const d1 = exArr.flattener_getArrayDim1(wasmFlattener, a);
                  const d2 = exArr.flattener_getArrayDim2(wasmFlattener, a);
                  const d3 = exArr.flattener_getArrayDim3(wasmFlattener, a);
                  const d4 =
                    typeof exArr.flattener_getArrayDim4 === "function"
                      ? exArr.flattener_getArrayDim4(wasmFlattener, a)
                      : 0;
                  const shape: number[] = [];
                  if (nDims >= 1) shape.push(d1);
                  if (nDims >= 2) shape.push(d2);
                  if (nDims >= 3) shape.push(d3);
                  if (nDims >= 4) shape.push(d4);
                  dae.setNamedArrayShape(name, shape);
                }
              }
            }
            const exIO = dae.exports as any;
            if (typeof exIO.flattener_getInnerCount === "function") {
              const innerCount = exIO.flattener_getInnerCount(wasmFlattener);
              const innerSet: Set<string> = (this.state.innerComponents ??= new Set<string>());
              for (let idx = 0; idx < innerCount; idx++) {
                const fullPathId = exIO.flattener_getInnerFullPath(wasmFlattener, idx);
                const fullPath = dae.interner.resolve(fullPathId);
                if (fullPath) {
                  innerSet.add(fullPath);
                  this.innerOuterComponents.add(fullPath);
                }
              }
            }
            if (typeof exIO.flattener_getOuterMapCount === "function") {
              const outerCount = exIO.flattener_getOuterMapCount(wasmFlattener);
              const outerMap: Map<string, string> = (this.state.outerToInner ??= new Map<string, string>());
              const innerSet: Set<string> = (this.state.innerComponents ??= new Set<string>());
              for (let idx = 0; idx < outerCount; idx++) {
                const outerId = exIO.flattener_getOuterPath(wasmFlattener, idx);
                const targetId = exIO.flattener_getTargetInnerPath(wasmFlattener, idx);
                const outerPath = dae.interner.resolve(outerId);
                const targetPath = dae.interner.resolve(targetId);
                if (outerPath && targetPath) {
                  outerMap.set(outerPath, targetPath);
                  innerSet.add(targetPath);
                  this.innerOuterComponents.add(outerPath);
                  this.innerOuterComponents.add(targetPath);
                }
              }
            }
            const totalVars = dae.varCount;
            for (let v = 0; v < totalVars; v++) {
              if ((dae.getVarFlags(v) & (1 << 9)) !== 0) {
                dae.setVarDescription(v, "virtual variable in expandable connector");
              }
            }
          }
        }
      } catch {
        flattenedInWasm = false;
        wasmBail ??= describeWasmBail(
          WasmBailReason.KernelTrap,
          undefined,
          undefined,
          isStrictWasm ? "strict-partial" : "ts-fallback",
        );
      } finally {
        if (wasmFlattener && typeof (dae.exports as any)?.flattener_destroy === "function") {
          try {
            (dae.exports as any).flattener_destroy(wasmFlattener);
          } catch {
            // ignore
          }
        }
      }
      if (!flattenedInWasm) {
        if (isStrictWasm) {
          dae.diagnostics.push({
            code: ModelicaErrorCode.WASM_FLATTENER_UNSUPPORTED.code,
            rule: "wasm-flattener-unsupported",
            severity: "error",
            message: `[ModelicaFlattener] Model '${rootName}' could not be flattened using strict WASM backend.`,
            range: null,
          });
          if (wasmBail) this.state.wasmBail = wasmBail;
          return dae;
        }
        const savedDesc = dae.description;
        const savedDiags = dae.diagnostics;
        const savedExtMeta = dae.extensionMetadata;
        const savedExperiment = dae.experiment;
        const savedFunctions = dae.functions;
        dae.free?.();
        dae = new DAEBuilder(wasmExports, rootName, "");
        dae.description = savedDesc;
        dae.diagnostics = savedDiags;
        dae.extensionMetadata = savedExtMeta;
        dae.experiment = savedExperiment;
        dae.functions = savedFunctions;
        (this as any).currentRootDae = dae;
        this.state = getFlatteningState(dae, this);
        this.state.innerOuterComponents = this.innerOuterComponents;
        this.state.activeLoopVars = this.activeLoopVars;
        this.state.db = this.db;
        this.state.flattener = this;
        this.state.currentClassId = rootClassId;
        this.currentClassId = rootClassId;
        dae.classKind = specKind ?? rawKind;
      }
    }

    if (!flattenedInWasm) {
      // Validate rootClassId itself if it is an enumeration
      const rootSym = this.db.symbol(rootClassId);
      const rootEnumErr = validateEnumeration(this.db.cstNode(rootClassId) as any, rootSym);
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
      // Validate inner classes of rootClassId in declaration order
      const childClasses = this.db.childrenOf(rootClassId).filter((c) => c.kind === "Class");
      for (const cc of childClasses) {
        const ccEnumErr = validateEnumeration(this.db.cstNode(cc.id) as any, cc);
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
        if ((d as any).fromFunction) return false;
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
      this.extractClassEquations(rootClassId, "", dae);
      if (this.pendingArrayBindings.size > 0) {
        for (const items of this.pendingArrayBindings.values()) {
          for (const item of items) {
            dae.addEquation(EqKind.Array, item.lhsExprId, item.rhsExprId);
          }
        }
        this.pendingArrayBindings.clear();
      }
      for (const fn of dae.functions.values()) {
        const fnSym = (fn as any).symId;
        if (fnSym && this.calledFunctionSymIds.has(fnSym)) {
          (fn as any).wasCalled = true;
        }
      }
    }

    const isOldFrontend = compilerOpts.isOldFrontend;
    dae.extensionMetadata["isOldFrontend"] = isOldFrontend;
    const isGen = compilerOpts.isGen;
    dae.extensionMetadata["isGen"] = isGen;

    this.checkCyclicConstantsAndParameters(dae, rootClassId);

    const expandArrayConnectEquations = (builder: DAEBuilder) => {
      const origEqCount = builder.eqCount;
      for (let i = 0; i < origEqCount; i++) {
        if (builder.getEqKind(i) === EqKind.Connect) {
          const l = builder.getEqLhs(i);
          const r = builder.getEqRhs(i);
          const flags = builder.getEqAux(i);
          if (builder.getExprKind(l) === ExprKind.Name && builder.getExprKind(r) === ExprKind.Name) {
            const lName = builder.interner.resolve(builder.getExprData1(l));
            const rName = builder.interner.resolve(builder.getExprData1(r));
            if (lName && rName) {
              const lExp = this.expandConnectorRef(lName, builder);
              const rExp = this.expandConnectorRef(rName, builder);
              if (lExp.length > 1 && lExp.length === rExp.length) {
                const l0 = builder.addName(builder.interner.intern(lExp[0]!));
                const r0 = builder.addName(builder.interner.intern(rExp[0]!));
                builder.setEqLhs(i, l0);
                builder.setEqRhs(i, r0);
                for (let k = 1; k < lExp.length; k++) {
                  const lk = builder.addName(builder.interner.intern(lExp[k]!));
                  const rk = builder.addName(builder.interner.intern(rExp[k]!));
                  builder.addEquation(EqKind.Connect, lk, rk, flags);
                }
              }
            }
          }
        }
      }
    };

    expandArrayConnectEquations(dae);

    for (let vIdx = 0; vIdx < dae.varCount; vIdx++) {
      let exprId = dae.getVarExpression(vIdx);
      if (exprId === undefined || exprId < 0 || exprId === 0xffffffff) continue;
      let innerId = exprId;
      if (
        dae.getExprKind(innerId) === ExprKind.Call &&
        dae.interner.resolve(dae.getExprData1(innerId)) === "/*Real*/"
      ) {
        innerId = dae.getExprLeft(innerId);
      }
      if (innerId >= 0) {
        let refName = "";
        if (dae.getExprKind(innerId) === ExprKind.Name) {
          refName = dae.interner.resolve(dae.getExprData1(innerId)) || "";
        } else {
          const vName = dae.getVarName(vIdx);
          if (!vName.includes(".")) {
            const vEntry =
              this.db.childrenOf(rootClassId).find((s) => s.kind === "Component" && s.name === vName) ??
              (rootSym?.resourceId
                ? this.getFileSymbols(rootSym.resourceId).find((s) => s.kind === "Component" && s.name === vName)
                : undefined);
            if (vEntry) {
              const compInst = this.db.query<any>("componentInstance", vEntry.id);
              const rawVal = compInst?.modification?.value?.text?.trim();
              if (rawVal && rawVal.includes(".")) refName = rawVal;
            }
          }
        }
        if (refName && refName.includes(".")) {
          const parts = refName.split(".");
          if (parts.length >= 3) {
            const pkgName = parts[0]!;
            const bIdx1 = parts[1]!.indexOf("[");
            const compName = bIdx1 >= 0 ? parts[1]!.slice(0, bIdx1) : parts[1]!;
            const pkgSym = this.db.byName(pkgName).find((e) => e.kind === "Package" || e.kind === "Class");
            const compSym = pkgSym
              ? this.db.childrenOf(pkgSym.id).find((c) => c.kind === "Component" && c.name === compName)
              : null;
            if (compSym) {
              const compInst = this.db.query<any>("componentInstance", compSym.id);
              const bIdx2 = parts[2]!.indexOf("[");
              const firstField = bIdx2 >= 0 ? parts[2]!.slice(0, bIdx2) : parts[2]!;
              const arg = compInst?.modification?.args?.find((a: any) => a.name === firstField);
              let valText: string | undefined = arg?.value?.text?.trim();
              for (let pIdx = 3; pIdx < parts.length && valText; pIdx++) {
                const bIdxSub = parts[pIdx]!.indexOf("[");
                const subField = bIdxSub >= 0 ? parts[pIdx]!.slice(0, bIdxSub) : parts[pIdx]!;
                const m = new RegExp(`\\b${subField}\\s*=\\s*([^,)]+)`).exec(valText);
                valText = m ? m[1]!.trim() : undefined;
              }
              if (valText !== undefined) {
                const num = Number(valText);
                if (!Number.isNaN(num)) {
                  const vType = dae.getVarType(vIdx);
                  const newExprId =
                    vType === VarType.Integer ? dae.addIntLiteral(Math.round(num)) : dae.addRealLiteral(num);
                  dae.setVarExpression(vIdx, newExprId);
                }
              }
            }
          }
        }
      }
    }

    // 2.5 Fold constants on initial DAE so parameters, dimensions, and expressions are resolved
    foldArenaConstants(dae, this.db, rootClassId, this.options.omcCompatibility);

    const shouldScalarize = this.options.arrayMode === "scalarize";

    dae.extensionMetadata.expandableBuses = Array.from(this.expandableBuses.keys());

    if (shouldScalarize) {
      dae = scalarizeArena(dae);
      this.state = getFlatteningState(dae, this);
      this.state.db = this.db;
      this.state.flattener = this;
      this.state.currentClassId = rootClassId;
      this.state.innerOuterComponents = this.innerOuterComponents;
      this.state.activeLoopVars = this.activeLoopVars;
      (this as any).currentRootDae = dae;
    }

    if (!isOldFrontend) {
      this.markConditionalParametersFinal(dae, rootClassId);
    }

    const varCountBeforeConnections = dae.varCount;
    const eqCountBeforeConnections = dae.eqCount;
    const exprCountBeforeConnections = dae.exprCount;

    // 2.6 Expandable connector dynamic augmentation, cross-bus pooling, and variable pruning
    if (!flattenedInWasm) {
      this.processExpandableConnectors(rootClassId, dae);
    }

    // 3. Layer 3: Physical connector expansion & flow balance
    let flowThreshold = compilerOpts.flowThreshold;
    ModelicaPortBalancer.expandConnections(dae, {
      omcCompatibility: this.options.omcCompatibility,
      useWasmKernel: this.options.useWasmKernel,
      isOldFrontend,
      flowThreshold,
    });

    // 4. Constant folding and alias elimination
    if (
      shouldScalarize ||
      this.expandableBuses.size > 0 ||
      dae.varCount !== varCountBeforeConnections ||
      dae.eqCount !== eqCountBeforeConnections ||
      dae.exprCount !== exprCountBeforeConnections
    ) {
      foldArenaConstants(dae, this.db, rootClassId, this.options.omcCompatibility);
    }

    if (this.options.eliminateAliases) {
      eliminateArenaAliases(dae);
    }

    if (this.options.omcCompatibility) {
      this.generateRecordConstructors(rootClassId, dae);
      this.generateOperatorFunctions(dae);
      this.generateExternalObjectFunctions(dae);
      this.propagateImpureFunctions(dae);
    }

    const attachDiffReport = (targetDae: DAEBuilder) => {
      const wasmDiff = (this as any)._wasmDiffStats as
        | { varCount: number; eqCount: number; bail?: WasmBailInfo | undefined; error?: string | undefined }
        | undefined;
      if (wasmDiff) {
        delete (this as any)._wasmDiffStats;
        (targetDae as any).diffReport = wasmDiff;
        if (process.env["DEBUG_DIFF"] === "1") {
          if (wasmDiff.error) {
            console.warn(`[DiffFlattener] WASM flattener failed: ${wasmDiff.error}`);
          } else {
            const varMatch = wasmDiff.varCount === targetDae.varCount;
            const eqMatch = wasmDiff.eqCount === targetDae.eqCount;
            const bailSuffix = wasmDiff.bail ? ` [bail=${wasmDiff.bail.reason}(${wasmDiff.bail.code})]` : "";
            console.log(
              `[DiffFlattener] ${varMatch && eqMatch && !wasmDiff.bail ? "PARITY MATCH" : "PARITY MISMATCH"}: vars (WASM=${wasmDiff.varCount}, TS=${targetDae.varCount}), eqs (WASM=${wasmDiff.eqCount}, TS=${targetDae.eqCount})${bailSuffix}`,
            );
          }
        }
      }
    };

    this.extractStateMachines(dae);
    dae.groupEquationsForParity();
    this.checkBalance(dae, rootClassId);
    if (classCst?.text?.includes("showAnnotations") || classCst?.tree?.rootNode?.text?.includes("showAnnotations")) {
      this.populateShowAnnotations(dae, rootClassId);
    }

    attachDiffReport(dae);
    if (wasmBail) {
      // Structured metadata only: a diagnostic here would perturb tests whose
      // expected output is driven by linter diagnostics.
      this.state.wasmBail = wasmBail;
    }
    this.state.isRealNameCache?.clear();
    this.state.varPrefixSet?.clear();
    this.state.varPrefixCount = 0;
    return dae;
  }

  private populateShowAnnotations(dae: DAEBuilder, rootClassId: SymbolId): void {
    const normAnnInner = (raw: string): string => {
      let s = raw.trim();
      if (s.startsWith("annotation")) s = s.slice("annotation".length).trim();
      if (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1).trim();
      let out = "";
      let inStr = false;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i]!;
        if (ch === '"' && (i === 0 || s[i - 1] !== "\\")) inStr = !inStr;
        if (!inStr && ch === "=") {
          const prev = s[i - 1] ?? "";
          const next = s[i + 1] ?? "";
          if (prev !== "=" && prev !== "<" && prev !== ">" && prev !== ":" && next !== "=") {
            out = out.trimEnd() + " = ";
            while (i + 1 < s.length && s[i + 1] === " ") i++;
            continue;
          }
        }
        out += ch;
      }
      return out.trim();
    };

    const collectBodyAnnotations = (
      cstNode: any,
      eqAnns: string[],
      algAnns: string[],
      inAlg = false,
      isRoot = true,
    ): void => {
      if (!cstNode) return;
      if (!isRoot && cstNode.type === "class_definition") return;
      if (
        cstNode.type === "component_clause" ||
        cstNode.type === "component_declaration" ||
        cstNode.type === "extends_clause"
      ) {
        return;
      }
      if (cstNode.type === "annotation_clause") {
        const inner = normAnnInner(cstNode.text ?? "");
        if (inner) {
          if (inAlg) algAnns.push(inner);
          else eqAnns.push(inner);
        }
        return;
      }
      const nextInAlg = inAlg || cstNode.type === "algorithm_section";
      for (const child of cstNode.children || []) {
        collectBodyAnnotations(child, eqAnns, algAnns, nextInAlg, false);
      }
    };

    const findCompAnnText = (compCst: any): string | null => {
      if (!compCst) return null;
      const walk = (n: any): string | null => {
        if (!n) return null;
        if (n.type === "annotation_clause") return normAnnInner(n.text ?? "");
        for (const c of n.children || []) {
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(compCst);
    };

    for (const fn of new Set(dae.functions.values())) {
      const fnSymId = (fn as any).symId ?? this.db.byName(fn.name.split(".").pop()!)?.[0]?.id;
      const fnCst = fnSymId ? (this.db.cstNode(fnSymId) as any) : null;
      if (!fnCst) continue;
      collectBodyAnnotations(fnCst, fn.equationAnnotations, fn.algorithmAnnotations);
      if (fn.algorithmSections.length > 0 && fn.equationAnnotations.length > 0 && fn.eqCount === 0) {
        fn.algorithmAnnotations.push(...fn.equationAnnotations);
        fn.equationAnnotations.length = 0;
      }
      const fnComps = fnSymId ? this.db.childrenOf(fnSymId).filter((c) => c.kind === "Component") : [];
      for (let i = 0; i < fn.varCount; i++) {
        const vName = fn.getVarName(i);
        const comp = fnComps.find((c) => c.name === vName);
        if (comp) {
          const ann = findCompAnnText(this.db.cstNode(comp.id));
          if (ann) fn.setVarCadAnnotation(i, `(${ann})`);
        }
      }
    }

    const rootCst = this.db.cstNode(rootClassId) as any;
    if (rootCst) {
      collectBodyAnnotations(rootCst, dae.equationAnnotations, dae.algorithmAnnotations);
    }

    const findClassComp = (cid: SymbolId, name: string): SymbolEntry | null => {
      const inst = this.db.query<SymbolId[]>("instantiate", cid) ?? [];
      for (const id of inst) {
        const s = this.db.symbol(id);
        if (s && s.kind === "Component" && s.name === name) return s;
      }
      return this.db.childrenOf(cid).find((s) => s.kind === "Component" && s.name === name) ?? null;
    };

    for (let i = 0; i < dae.varCount; i++) {
      const vName = dae.getVarName(i);
      const parts = vName.split(".");
      let currCid: SymbolId | null = rootClassId;
      let effectiveAnn: string | null = null;
      for (let p = 0; p < parts.length && currCid; p++) {
        const bIdxSeg = parts[p]!.indexOf("[");
        const seg = bIdxSeg >= 0 ? parts[p]!.slice(0, bIdxSeg) : parts[p]!;
        const comp = findClassComp(currCid, seg);
        if (!comp) break;
        const ann = findCompAnnText(this.db.cstNode(comp.id));
        if (ann) {
          const hideMatch = ann.match(/^HideResult\s*=\s*(.+)$/);
          if (hideMatch) {
            let rhs = hideMatch[1]!.trim();
            if (rhs !== "true" && rhs !== "false") {
              const pIdx = dae.getVarIdxByName(rhs);
              if (pIdx >= 0) {
                const exprId = dae.getVarExpression(pIdx);
                if (exprId !== undefined && exprId >= 0 && dae.getExprKind(exprId) === ExprKind.BoolLiteral) {
                  rhs = dae.getExprData1(exprId) !== 0 ? "true" : "false";
                }
              }
            }
            effectiveAnn = `HideResult = ${rhs}`;
          } else if (p === parts.length - 1) {
            effectiveAnn = ann;
          }
        }
        currCid = this.db.query<SymbolId | null>("classInstance", comp.id) ?? null;
      }
      if (effectiveAnn) {
        dae.setVarCadAnnotation(i, `(${effectiveAnn})`);
      }
    }
  }

  private markConditionalParametersFinal(dae: DAEBuilder, rootClassId: SymbolId): void {
    const condParamsByClassId = new Map<SymbolId, Set<string>>();
    const condParamsByClassName = new Map<string, Set<string>>();
    const baseClassesOf = new Map<SymbolId, SymbolId[]>();
    const visitedClasses = new Set<SymbolId>();
    const classQueue: SymbolId[] = [rootClassId];

    const extractDirectCondLeaves = (cCst: any): string[] => {
      if (!cCst) return [];
      const rawCText: string = cCst.text ?? "";
      if (!rawCText.includes("if ")) return [];
      const leaves: string[] = [];
      const collectFromText = (txt: string): void => {
        if (!txt.includes("if ")) return;
        const clean = stripCommentsAndStrings(txt);
        for (const m of clean.matchAll(/\bif\s+([^;]+);?/g)) {
          const condExpr = m[1] ?? "";
          if (/\bthen\b/.test(condExpr)) continue;
          const ids = condExpr.match(/[a-zA-Z_]\w*/g) || [];
          for (const id of ids) {
            if (id !== "true" && id !== "false" && id !== "not" && id !== "and" && id !== "or") {
              leaves.push(id);
            }
          }
        }
      };
      if (Array.isArray(cCst.children) && cCst.children.length > 0) {
        const walkOwnDecls = (node: any): void => {
          if (!node) return;
          if (node !== cCst && node.type === "class_definition") return;
          if (node.type === "equation_section" || node.type === "algorithm_section") return;
          if (node.type === "condition_attribute") {
            const clean = stripCommentsAndStrings(node.text ?? "");
            const ids = clean.replace(/^\s*if\b/, "").match(/[a-zA-Z_]\w*/g) || [];
            for (const id of ids) {
              if (id !== "true" && id !== "false" && id !== "not" && id !== "and" && id !== "or") {
                leaves.push(id);
              }
            }
            return;
          }
          if (
            node.type === "component_clause" ||
            node.type === "component_clause1" ||
            node.type === "component_declaration" ||
            node.type === "component_declaration1"
          ) {
            collectFromText(node.text ?? "");
            return;
          }
          for (const ch of node.children || []) {
            walkOwnDecls(ch);
          }
        };
        walkOwnDecls(cCst);
      } else {
        collectFromText(rawCText);
      }
      return leaves;
    };

    while (classQueue.length > 0) {
      const cid = classQueue.pop()!;
      if (visitedClasses.has(cid)) continue;
      visitedClasses.add(cid);
      const cSym = this.db.symbol(cid) as any;
      let cachedInfo = cSym?._cachedCondParamInfo as
        | { leaves: string[]; baseClassIds: SymbolId[]; childClassIds: SymbolId[] }
        | undefined;
      if (!cachedInfo || !Array.isArray(cachedInfo.baseClassIds)) {
        const leaves = extractDirectCondLeaves(this.db.cstNode(cid) as any);
        const baseClassIds: SymbolId[] = [];
        const childClassIds: SymbolId[] = [];
        for (const ch of this.db.childrenOf(cid)) {
          if (ch.kind === "Extends") {
            const baseSym =
              this.db.query<any>("resolvedBaseClass", ch.id) ??
              this.db.query<any>("extendsTarget", ch.id) ??
              this.db.byName(ch.name)?.[0];
            if (baseSym?.id) {
              baseClassIds.push(baseSym.id);
              childClassIds.push(baseSym.id);
            }
          } else if (ch.kind === "Component") {
            const targetSym = this.db.query<any>("classInstance", ch.id) ?? this.db.query<any>("resolvedType", ch.id);
            const ci = this.db.query<any>("componentInstance", ch.id);
            const tid =
              typeof targetSym === "number"
                ? targetSym
                : (targetSym?.id ??
                  (ci?.typeSpecifier ? this.db.byName(ci.typeSpecifier.split(".").pop()!)?.[0]?.id : undefined));
            if (tid) childClassIds.push(tid);
          }
        }
        cachedInfo = { leaves, baseClassIds, childClassIds };
        if (cSym) cSym._cachedCondParamInfo = cachedInfo;
      }
      condParamsByClassId.set(cid, new Set(cachedInfo.leaves));
      baseClassesOf.set(cid, cachedInfo.baseClassIds);
      for (const tid of cachedInfo.childClassIds) {
        if (!visitedClasses.has(tid)) classQueue.push(tid);
      }
    }

    // Propagate conditional parameter leaves from base classes along Extends edges
    let changed = true;
    while (changed) {
      changed = false;
      for (const [cid, bases] of baseClassesOf) {
        const targetSet = condParamsByClassId.get(cid);
        if (!targetSet) continue;
        for (const bid of bases) {
          const baseSet = condParamsByClassId.get(bid);
          if (!baseSet) continue;
          for (const leaf of baseSet) {
            if (!targetSet.has(leaf)) {
              targetSet.add(leaf);
              changed = true;
            }
          }
        }
      }
    }

    let hasAnyCondParams = false;
    for (const [cid, set] of condParamsByClassId) {
      if (set.size > 0) {
        hasAnyCondParams = true;
        const sym = this.db.symbol(cid);
        if (sym?.name) {
          let byNameSet = condParamsByClassName.get(sym.name);
          if (!byNameSet) {
            byNameSet = new Set();
            condParamsByClassName.set(sym.name, byNameSet);
          }
          for (const leaf of set) byNameSet.add(leaf);
        }
      }
    }
    if (!hasAnyCondParams) return;

    const findComponentTargetClass = (
      ownerCid: SymbolId,
      compName: string,
    ): { cid: SymbolId | null; typeName: string | null } => {
      const seen = new Set<SymbolId>();
      const queue: SymbolId[] = [ownerCid];
      while (queue.length > 0) {
        const cur = queue.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const ch of this.db.childrenOf(cur)) {
          if (ch.kind === "Component" && ch.name === compName) {
            const targetSym = this.db.query<any>("classInstance", ch.id) ?? this.db.query<any>("resolvedType", ch.id);
            const ci = this.db.query<any>("componentInstance", ch.id);
            const typeName = ci?.typeSpecifier ? String(ci.typeSpecifier).split(".").pop()! : null;
            const tid =
              typeof targetSym === "number"
                ? targetSym
                : (targetSym?.id ?? (typeName ? this.db.byName(typeName)?.[0]?.id : undefined) ?? null);
            return { cid: tid, typeName };
          }
          if (ch.kind === "Extends") {
            const baseSym =
              this.db.query<any>("resolvedBaseClass", ch.id) ??
              this.db.query<any>("extendsTarget", ch.id) ??
              this.db.byName(ch.name)?.[0];
            if (baseSym?.id && !seen.has(baseSym.id)) {
              queue.push(baseSym.id);
            }
          }
        }
      }
      return { cid: null, typeName: null };
    };

    const rootSet = condParamsByClassId.get(rootClassId);
    for (let i = 0; i < dae.varCount; i++) {
      if (dae.getVarVariability(i) !== Variability.Parameter) continue;
      const vName = dae.getVarName(i);
      const cleanName = vName.replace(/\[[^\][]*\]/g, "");
      const parts = cleanName.split(".");
      const leaf = parts[parts.length - 1]!.split("[")[0]!;
      if (parts.length === 1) {
        if (rootSet?.has(leaf)) {
          dae.setVarFinal(i, true);
        }
      } else {
        let currCid: SymbolId | null = rootClassId;
        let lastTypeName: string | null = null;
        for (let p = 0; p < parts.length - 1; p++) {
          const bIdxSeg = parts[p]!.indexOf("[");
          const seg = bIdxSeg >= 0 ? parts[p]!.slice(0, bIdxSeg) : parts[p]!;
          if (currCid != null) {
            const resolved = findComponentTargetClass(currCid, seg);
            currCid = resolved.cid;
            lastTypeName = resolved.typeName;
          } else {
            currCid = null;
            lastTypeName = null;
            break;
          }
        }
        if (currCid != null) {
          if (condParamsByClassId.get(currCid)?.has(leaf)) {
            dae.setVarFinal(i, true);
          }
        } else if (lastTypeName != null) {
          if (condParamsByClassName.get(lastTypeName)?.has(leaf)) {
            dae.setVarFinal(i, true);
          }
        }
      }
    }
  }

  private recordWasmSourceRanges(dae: DAEBuilder, classId: SymbolId): void {
    const cst = this.db.cstNode(classId) as any;
    if (!cst) return;

    const topEqNodes: any[] = [];
    const bodyForEqNodes: any[] = [];
    let hasCompoundEq = false;
    const walkEqs = (node: any, insideCompound = false): void => {
      if (!node) return;
      if (
        (node !== cst && node.type === "class_definition") ||
        node.type === "extends_clause" ||
        node.type === "component_clause" ||
        node.type === "component_clause1" ||
        node.type === "component_declaration" ||
        node.type === "algorithm_section"
      ) {
        return;
      }

      if (node.type === "for_equation" || node.type === "if_equation" || node.type === "when_equation") {
        hasCompoundEq = true;
        for (const child of node.children || []) {
          walkEqs(child, true);
        }
        return;
      }

      if (node.type === "simple_equation" || node.type === "connect_equation" || node.type === "function_call") {
        if (insideCompound) {
          bodyForEqNodes.push(node);
        } else {
          topEqNodes.push(node);
        }
        return;
      }

      for (const child of node.children || []) {
        walkEqs(child, insideCompound);
      }
    };
    walkEqs(cst, false);

    const applyEqNodeMeta = (eqIdx: number, node: any): void => {
      const sB = node.startIndex ?? node.startOffset;
      const eB = node.endIndex ?? node.endOffset;
      if (sB != null && eB != null && eqIdx >= 0 && eqIdx < dae.getEqCount()) {
        dae.setEqSourceRange(eqIdx, sB, eB);
        for (const c of node.children || []) {
          if (c.type === "description" || c.type === "description_string" || c.type === "string_literal") {
            const t = c.text?.trim();
            if (t) dae.setEqDescription(eqIdx, t);
            break;
          }
        }
      }
    };

    const totalEqs = dae.getEqCount();
    if (!hasCompoundEq && topEqNodes.length > 0 && topEqNodes.length <= totalEqs) {
      // Root class equations are emitted after inherited/subcomponent equations in WASM flattening
      const offset = totalEqs - topEqNodes.length;
      for (let i = 0; i < topEqNodes.length; i++) {
        applyEqNodeMeta(offset + i, topEqNodes[i]);
      }
    } else if (hasCompoundEq && topEqNodes.length === 0 && bodyForEqNodes.length === 1 && totalEqs > 0) {
      // Single unrolled loop/branch body equation: propagate its source range and description
      for (let i = 0; i < totalEqs; i++) {
        applyEqNodeMeta(i, bodyForEqNodes[0]);
      }
    }

    // Pre-resolve all variable names so interner lookup succeeds in getVarIdxByName
    const varCount = dae.varCount;
    for (let i = 0; i < varCount; i++) {
      dae.getVarName(i);
    }

    const walkVars = (node: any): void => {
      if (!node) return;
      if (node !== cst && node.type === "class_definition") return;
      if (
        node.type === "component_declaration" ||
        node.type === "component_declaration1" ||
        node.type === "declaration"
      ) {
        const declNodes: any[] =
          node.type === "component_declaration" || node.type === "component_declaration1"
            ? (node.children || []).filter((c: any) => c.type === "declaration")
            : [node];
        if (declNodes.length === 0) declNodes.push(node);

        let typeSpecNode: any = null;
        let pNode = node;
        while (pNode && pNode.type !== "composition") {
          typeSpecNode = (pNode.children || []).find((c: any) => c.type === "type_specifier" || c.type === "name");
          if (typeSpecNode) break;
          pNode = pNode.parent;
        }
        const rawTypeName = typeSpecNode?.text?.trim();
        const leafTypeName = rawTypeName ? rawTypeName.split(".").pop() : undefined;

        for (const declNode of declNodes) {
          const idChild = (declNode.children || []).find((c: any) => c.type === "identifier");
          const name = idChild ? idChild.text?.trim() : declNode.text?.trim()?.split(/\s|=|\[|\(/)[0];
          if (name) {
            let varIdx = dae.getVarIdxByName(name);
            if (varIdx < 0) {
              varIdx = dae.getVarIdxByName(`${name}[1]`);
            }
            const sB = declNode.startIndex ?? declNode.startOffset;
            const eB = declNode.endIndex ?? declNode.endOffset;
            if (varIdx >= 0 && sB != null && eB != null) {
              dae.setVarSourceRange(varIdx, sB, eB);
              const arrayIndices = dae.getArrayElementIndices(name);
              for (const idx of arrayIndices) {
                dae.setVarSourceRange(idx, sB, eB);
              }
            }
            const desc = extractDescription(node);
            if (desc && varIdx >= 0) {
              dae.setVarDescription(varIdx, desc);
              const arrayIndices = dae.getArrayElementIndices(name);
              for (const idx of arrayIndices) {
                dae.setVarDescription(idx, desc);
              }
            }
            let p = node.parent;
            while (p && p.type !== "element" && p.type !== "composition") {
              p = p.parent;
            }
            if (p && p.type === "element" && /\bfinal\b/.test((p.text ?? "").split("(")[0] ?? "")) {
              if (varIdx >= 0) {
                dae.setVarFinal(varIdx, true);
              }
              const arrayIndices = dae.getArrayElementIndices(name);
              for (const idx of arrayIndices) {
                dae.setVarFinal(idx, true);
              }
              for (let i = 0; i < dae.varCount; i++) {
                const vName = dae.getVarName(i);
                if (vName === name || vName.startsWith(`${name}.`) || vName.startsWith(`${name}[`)) {
                  dae.setVarFinal(i, true);
                }
              }
            }
            if (varIdx >= 0) {
              const rawText = declNode.text ?? node.text ?? "";
              const qMatch = rawText.match(/\bquantity\s*=\s*("([^"\\]|\\.)*")/);
              if (qMatch) {
                try {
                  const qStr = JSON.parse(qMatch[1]);
                  const qId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(qStr));
                  dae.setVarAttr(varIdx, "quantity", qId);
                  const arrayIndices = dae.getArrayElementIndices(name);
                  for (const idx of arrayIndices) {
                    dae.setVarAttr(idx, "quantity", qId);
                  }
                } catch {}
              }
              const ssMatch = rawText.match(/\bstateSelect\s*=\s*(?:StateSelect\.)?([a-zA-Z]+)/);
              if (ssMatch) {
                const ssLiterals = ["never", "avoid", "default", "prefer", "always"];
                const ssIdx = ssLiterals.indexOf(ssMatch[1]);
                if (ssIdx >= 0) {
                  const enumExprId = dae.addEnumLiteral(ssIdx + 1, `StateSelect.${ssMatch[1]}`);
                  dae.setVarAttr(varIdx, "stateSelect", enumExprId);
                  const arrayIndices = dae.getArrayElementIndices(name);
                  for (const idx of arrayIndices) {
                    dae.setVarAttr(idx, "stateSelect", enumExprId);
                  }
                }
              }

              const isEnumVar =
                dae.getVarType(varIdx) === VarType.Enumeration ||
                (rawTypeName && this.enumTypeMap.has(rawTypeName)) ||
                (leafTypeName && this.enumTypeMap.has(leafTypeName));
              if (isEnumVar) {
                const lits =
                  (rawTypeName ? this.enumTypeMap.get(rawTypeName) : undefined) ??
                  (leafTypeName ? this.enumTypeMap.get(leafTypeName) : undefined);
                if (lits && lits.length > 0) {
                  const formatted = lits.map((s: string) => ({ stringValue: s }));
                  dae.setVarEnumerationLiterals(varIdx, formatted);
                  const arrayIndices = dae.getArrayElementIndices(name);
                  for (const idx of arrayIndices) {
                    dae.setVarEnumerationLiterals(idx, formatted);
                  }
                }
              }
            }
          }
        }
        if (node.type === "component_declaration" || node.type === "component_declaration1") {
          return;
        }
      }
      for (const child of node.children || []) {
        walkVars(child);
      }
    };
    walkVars(cst);

    if (!dae.extensionMetadata?.["isOldFrontend"]) {
      this.markConditionalParametersFinal(dae, classId);
    }

    for (let i = 0; i < dae.varCount; i++) {
      if (dae.getVarType(i) === VarType.Enumeration) {
        const existing = dae.getVarEnumerationLiterals(i);
        if (!existing || existing.length === 0) {
          const varName = dae.getVarName(i);
          const leafComp = varName.split(".").pop()!.split("[")[0]!;
          const compSyms = this.db.byName(leafComp).filter((s) => s.kind === "Component");
          for (const cs of compSyms) {
            const compInst = this.db.query<any>("componentInstance", cs.id);
            const typeSpec = compInst?.typeSpecifier;
            if (typeSpec) {
              const lits = this.enumTypeMap.get(typeSpec) ?? this.enumTypeMap.get(typeSpec.split(".").pop()!);
              if (lits && lits.length > 0) {
                const formatted = lits.map((s: string) => ({ stringValue: s }));
                dae.setVarEnumerationLiterals(i, formatted);
                break;
              }
            }
          }
        }
      }
    }
  }

  private populateWasmScopeResolutions(wasmFlattener: number, rootClassId: SymbolId, dae: DAEBuilder): void {
    if (typeof (dae.exports as any)?.flattener_registerScopeResolution !== "function") return;
    const register = (dae.exports as any).flattener_registerScopeResolution;
    const registerEnum = (dae.exports as any)?.flattener_registerEnumLiteral;
    const isCharOffset =
      typeof (dae.exports as any)?.lsp_isCharOffsetKernel === "function" &&
      Boolean((dae.exports as any).lsp_isCharOffsetKernel());
    const encoding =
      typeof (dae.exports as any)?.lsp_getInputEncoding === "function"
        ? (dae.exports as any).lsp_getInputEncoding()
        : undefined;
    const unitSize = isCharOffset ? 1 : inputEncodingUnitSize(encoding);
    const visited = new Set<SymbolId>();
    const queue: SymbolId[] = [rootClassId];
    this.enumTypeMap.clear();

    while (queue.length > 0) {
      const classId = queue.pop()!;
      if (visited.has(classId)) continue;
      visited.add(classId);

      const classEntry = this.db.symbol(classId);
      const classCst = this.db.cstNode(classId) as any;
      const scopePtr: number = classCst?.ptr ?? 0;

      // Check if this class definition is an enumeration
      const isEnum = (classEntry?.metadata as any)?.isEnumeration || Boolean(classCst?.text?.includes("enumeration("));
      if (isEnum && classEntry) {
        const lits = extractEnumLiteralsFromCst(classCst, classEntry.metadata);
        if (lits && lits.length > 0) {
          const qName = getSymbolQualifiedName(this.db, classId);
          this.enumTypeMap.set(classEntry.name, lits);
          if (qName) {
            this.enumTypeMap.set(qName, lits);
            const qParts = qName.split(".");
            for (let pIdx = 1; pIdx < qParts.length; pIdx++) {
              this.enumTypeMap.set(qParts.slice(pIdx).join("."), lits);
            }
          }

          if (typeof registerEnum === "function") {
            for (let i = 0; i < lits.length; i++) {
              const lit = lits[i];
              const ordinal = i + 1;
              const fullPath = qName ? `${qName}.${lit}` : `${classEntry.name}.${lit}`;
              const fullPathId = dae.interner.intern(fullPath);
              const shortRefId = dae.interner.intern(`${classEntry.name}.${lit}`);
              registerEnum(wasmFlattener, shortRefId, ordinal, fullPathId);
              if (qName) {
                const qRefId = dae.interner.intern(`${qName}.${lit}`);
                registerEnum(wasmFlattener, qRefId, ordinal, fullPathId);
                const qParts = qName.split(".");
                for (let pIdx = 1; pIdx < qParts.length; pIdx++) {
                  const suffix = qParts.slice(pIdx).join(".");
                  const sRefId = dae.interner.intern(`${suffix}.${lit}`);
                  registerEnum(wasmFlattener, sRefId, ordinal, fullPathId);
                }
              }
            }
          }
        }
      }

      // Check if this class definition is a short class specifier (e.g. model E = B.C(x=6))
      const findShortSpec = (node: any): any => {
        if (!node) return null;
        if (node.type === "short_class_specifier") return node;
        for (const ch of node.children || []) {
          const found = findShortSpec(ch);
          if (found) return found;
        }
        return null;
      };
      const shortSpecNode = findShortSpec(classCst);
      if (shortSpecNode) {
        const typeSpecNode = shortSpecNode.children?.find((c: any) => c.type === "type_specifier" || c.type === "name");
        const typeName: string = typeSpecNode?.text?.trim();
        if (typeName) {
          const resolved =
            this.db.query<(n: string) => any>("resolveName", classId)?.(typeName) ??
            this.db.query<(n: string) => any>("resolveSimpleName", classId)?.(typeName);
          if (resolved && resolved.id) {
            const targetCst = this.db.cstNode(resolved.id) as any;
            if (targetCst?.ptr) {
              const nameId = dae.interner.intern(typeName);
              const targetOffset =
                targetCst._startOffset !== undefined
                  ? targetCst._startOffset + (targetCst._cachedPad ?? 0)
                  : (targetCst.startIndex ?? targetCst.startOffset ?? (resolved as any)?.startOffset ?? 0) * unitSize;
              register(wasmFlattener, scopePtr, nameId, targetCst.ptr, targetOffset);
            }
            queue.push(resolved.id);
          }
        }
      }

      // Collect imports for this class and register with WASM flattener
      const classImports = this.collectClassImports(classId);
      for (const [shortName, fullPkg] of classImports) {
        const resolved =
          this.db.query<(n: string) => any>("resolveName", classId)?.(fullPkg) ??
          this.db.query<(n: string) => any>("resolveSimpleName", classId)?.(fullPkg) ??
          this.db.byName(fullPkg.split(".").pop() ?? "").find((e) => e.kind === "Class" || e.kind === "Package");
        if (resolved && resolved.id) {
          const targetCst = this.db.cstNode(resolved.id) as any;
          if (targetCst?.ptr) {
            const nameId = dae.interner.intern(shortName);
            const targetOffset =
              targetCst._startOffset !== undefined
                ? targetCst._startOffset + (targetCst._cachedPad ?? 0)
                : (targetCst.startIndex ?? targetCst.startOffset ?? (resolved as any)?.startOffset ?? 0) * unitSize;
            register(wasmFlattener, scopePtr, nameId, targetCst.ptr, targetOffset);
            register(wasmFlattener, 0, nameId, targetCst.ptr, targetOffset);
          }
          queue.push(resolved.id);
        }
      }

      const children = this.db.childrenOf(classId);

      for (const child of children) {
        if (child.kind === "Extends") {
          const extCst = this.db.cstNode(child.id) as any;
          const typeSpecNode = extCst?.children?.find((c: any) => c.type === "type_specifier" || c.type === "name");
          const extName: string = typeSpecNode?.text?.trim() ?? child.name;
          if (extName) {
            const resolved =
              this.db.query<(n: string) => any>("resolveName", classId)?.(extName) ??
              this.db.query<(n: string) => any>("resolveSimpleName", classId)?.(extName) ??
              this.db.query<any>("resolvedBaseClass", classId);
            if (resolved && resolved.id) {
              const targetCst = this.db.cstNode(resolved.id) as any;
              if (targetCst?.ptr) {
                const nameId = dae.interner.intern(extName);
                const targetOffset =
                  targetCst._startOffset !== undefined
                    ? targetCst._startOffset + (targetCst._cachedPad ?? 0)
                    : (targetCst.startIndex ?? targetCst.startOffset ?? resolved.startOffset ?? 0) * unitSize;
                register(wasmFlattener, scopePtr, nameId, targetCst.ptr, targetOffset);
                register(wasmFlattener, 0, nameId, targetCst.ptr, targetOffset);
              }
              queue.push(resolved.id);
            }
          }
        } else if (child.kind === "Component") {
          const compInst = this.db.query<any>("componentInstance", child.id);
          const typeSpec: string | undefined = compInst?.typeSpecifier;
          if (
            typeSpec &&
            typeSpec !== "Real" &&
            typeSpec !== "Integer" &&
            typeSpec !== "Boolean" &&
            typeSpec !== "String"
          ) {
            let targetId = compInst.classInstance;
            if (!targetId) {
              const resolved =
                this.db.query<(n: string) => any>("resolveName", classId)?.(typeSpec) ??
                this.db.query<(n: string) => any>("resolveSimpleName", classId)?.(typeSpec);
              if (resolved) targetId = resolved.id;
            }
            if (targetId) {
              const targetCst = this.db.cstNode(targetId) as any;
              if (targetCst?.ptr) {
                const nameId = dae.interner.intern(typeSpec);
                const targetOffset =
                  targetCst._startOffset !== undefined
                    ? targetCst._startOffset + (targetCst._cachedPad ?? 0)
                    : (targetCst.startIndex ??
                        targetCst.startOffset ??
                        (this.db.symbol(targetId) as any)?.startOffset ??
                        0) * unitSize;
                register(wasmFlattener, scopePtr, nameId, targetCst.ptr, targetOffset);
                register(wasmFlattener, 0, nameId, targetCst.ptr, targetOffset);
              }
              queue.push(targetId);
            }
          }
        } else if (child.kind === "Class") {
          queue.push(child.id);
          const childCst = this.db.cstNode(child.id) as any;
          const isChildEnum =
            (child.metadata as any)?.isEnumeration || Boolean(childCst?.text?.includes("enumeration("));
          if (isChildEnum) {
            const lits = extractEnumLiteralsFromCst(childCst, child.metadata);
            if (lits && lits.length > 0) {
              const qName = getSymbolQualifiedName(this.db, child.id);
              this.enumTypeMap.set(child.name, lits);
              if (qName) {
                this.enumTypeMap.set(qName, lits);
                const qParts = qName.split(".");
                for (let pIdx = 1; pIdx < qParts.length; pIdx++) {
                  this.enumTypeMap.set(qParts.slice(pIdx).join("."), lits);
                }
              }

              if (typeof registerEnum === "function") {
                for (let i = 0; i < lits.length; i++) {
                  const lit = lits[i];
                  const ordinal = i + 1;
                  const fullPath = qName ? `${qName}.${lit}` : `${child.name}.${lit}`;
                  const fullPathId = dae.interner.intern(fullPath);
                  const shortRefId = dae.interner.intern(`${child.name}.${lit}`);
                  registerEnum(wasmFlattener, shortRefId, ordinal, fullPathId);
                  if (qName) {
                    const qRefId = dae.interner.intern(`${qName}.${lit}`);
                    registerEnum(wasmFlattener, qRefId, ordinal, fullPathId);
                    const qParts = qName.split(".");
                    for (let pIdx = 1; pIdx < qParts.length; pIdx++) {
                      const suffix = qParts.slice(pIdx).join(".");
                      const sRefId = dae.interner.intern(`${suffix}.${lit}`);
                      registerEnum(wasmFlattener, sRefId, ordinal, fullPathId);
                    }
                  }
                }
              }
            }
          }
          const aliasTarget = (child.metadata as any)?.aliasTarget ?? (child.metadata as any)?.baseClass;
          if (aliasTarget) {
            const resolved =
              this.db.query<(n: string) => any>("resolveName", classId)?.(aliasTarget) ??
              this.db.query<(n: string) => any>("resolveSimpleName", classId)?.(aliasTarget);
            if (resolved) {
              const targetCst = this.db.cstNode(resolved.id) as any;
              if (targetCst?.ptr) {
                const nameId = dae.interner.intern(child.name);
                const targetOffset =
                  targetCst._startOffset !== undefined
                    ? targetCst._startOffset + (targetCst._cachedPad ?? 0)
                    : (targetCst.startIndex ?? targetCst.startOffset ?? (resolved as any)?.startOffset ?? 0) * unitSize;
                register(wasmFlattener, scopePtr, nameId, targetCst.ptr, targetOffset);
                register(wasmFlattener, 0, nameId, targetCst.ptr, targetOffset);
              }
              queue.push(resolved.id);
            }
          }
        }
      }
    }
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

  public findEquationNodeAt(root: any, start: number, end: number): any {
    return findEquationNodeAt(root, start, end);
  }

  public findComponentDeclarationAt(root: any, start: number, end: number): any {
    return findComponentDeclarationAt(root, start, end);
  }

  public isCstNodeProtected(node: any): boolean {
    return isCstNodeProtected(node, this.nodeProtectionCache as any);
  }

  public generateRecordConstructorFor(
    sym: any,
    dae: DAEBuilder,
    rootClassId?: SymbolId,
    overrideFnName?: string,
    overrideResType?: string,
  ): DAEBuilder | null {
    return generateRecordConstructorFor(this, sym, dae, rootClassId, overrideFnName, overrideResType);
  }

  private generateRecordConstructors(rootClassId: SymbolId, dae: DAEBuilder): void {
    generateRecordConstructors(this, rootClassId, dae);
  }

  public isFunctionSym(sym: any): boolean {
    return isFunctionSym(this.db, sym);
  }

  public isInsideExpandableBus(prefix: string): boolean {
    return isInsideExpandableBus(this.expandableBuses, prefix);
  }

  private processExpandableConnectors(rootClassId: SymbolId, dae: DAEBuilder): void {
    processExpandableConnectors(rootClassId, dae, this.db, this.expandableBuses);
  }

  public flattenFunction(
    fnSymId: SymbolId,
    fnName: string,
    modifiers?: any[],
    parentDae?: DAEBuilder,
    enclosingScopeId?: SymbolId,
  ): DAEBuilder {
    return flattenFunction(this, fnSymId, fnName, modifiers, parentDae, enclosingScopeId);
  }

  private generateOperatorFunctions(dae: DAEBuilder): void {
    generateOperatorFunctions(this, dae);
  }

  private generateFunctions(rootClassId: SymbolId, dae: DAEBuilder): void {
    generateFunctions(this, rootClassId, dae);
  }

  private generateExternalObjectFunctions(dae: DAEBuilder): void {
    generateExternalObjectFunctions(this, dae);
  }

  private propagateImpureFunctions(dae: DAEBuilder): void {
    propagateImpureFunctions(dae);
  }

  flattenFromTopology(graph: TopologyGraph): DAEBuilder {
    const dae = new DAEBuilder(undefined, "HybridSystem", "");

    for (const rootId of graph.rootIds) {
      const node = graph.nodes.get(rootId);
      if (node?.targetClassId) {
        const elements = this.db.query<SymbolId[]>("instantiate", node.targetClassId);
        if (elements) {
          this.instantiateElements(elements, node.path, dae);
        }
      }
    }

    for (const edge of graph.edges) {
      const srcNode = graph.nodes.get(edge.sourceId);
      const tgtNode = graph.nodes.get(edge.targetId);
      if (srcNode && tgtNode) {
        const lhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(srcNode.path));
        const rhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(tgtNode.path));
        dae.addEquation(EqKind.Connect, lhsId, rhsId);
      }
    }

    ModelicaPortBalancer.expandConnections(dae, {
      omcCompatibility: this.options.omcCompatibility,
      useWasmKernel: this.options.useWasmKernel,
    });

    if (this.options.eliminateAliases) {
      eliminateArenaAliases(dae);
    }

    this.checkBalance(dae);

    return dae;
  }

  /**
   * Checks model equation/variable balance and pushes an M4004 diagnostic if unbalanced.
   * Should be called after all equation lowering is complete.
   */
  checkBalance(dae: DAEBuilder, rootClassId?: SymbolId): void {
    checkBalance(dae, this.db, rootClassId ?? this.currentRootClassId);
  }

  private isClassType(classId: SymbolId, visited = new Set<SymbolId>()): boolean {
    return isClassType(this, classId, visited);
  }

  private checkTypeAliasSpecialization(
    typeSymId: SymbolId,
  ): { targetName: string; kindDesc: string; range: any } | null {
    return checkTypeAliasSpecialization(this, typeSymId);
  }

  public collectInheritedTypeModifiers(scopeId: SymbolId, typeLeafName: string, visited = new Set<SymbolId>()): any[] {
    return collectInheritedTypeModifiers(this, scopeId, typeLeafName, visited);
  }

  public getOrCreateWasmEnv(dae: DAEBuilder, mods?: any): ModelicaModificationEnv | null {
    return getOrCreateWasmEnv(this, dae, mods);
  }

  public classFindMember(classId: SymbolId, name: string, visited: Set<SymbolId> = new Set()): SymbolEntry | null {
    return classFindMember(this, classId, name, visited);
  }

  public validateClassModifiers(defaultTargetClassId: SymbolId, args: any[], dae: DAEBuilder): boolean {
    return validateClassModifiers(this, defaultTargetClassId, args, dae);
  }

  private instantiateElements(elements: SymbolId[], prefix: string, dae: DAEBuilder, parentMods?: any): void {
    instantiateElements(this, elements, prefix, dae, parentMods);
  }

  public validateFunctionComponentDeclaration(
    dae: DAEBuilder,
    compInst: any,
    causality: Causality,
    isElemProtected: boolean,
    elemCst: any,
  ): void {
    validateFunctionComponentDeclaration(this, dae, compInst, causality, isElemProtected, elemCst);
  }

  public validateComponentBasicAttributes(
    dae: DAEBuilder,
    compInst: any,
    elemId: SymbolId,
    elemCst: any,
    prefix: string,
    parentMods?: any,
    matchingParentArg?: any,
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

  private collectExtendsMods(classId: SymbolId, visited: Set<SymbolId> = new Set<SymbolId>()): any[] {
    return collectExtendsMods(this, classId, visited);
  }

  public resolveRedeclarationType(scopeId: SymbolId | null, redeclSpecifier: string): SymbolId | null {
    return resolveRedeclarationType(this, scopeId, redeclSpecifier);
  }

  public resolveInnerOuterClass(classId: SymbolId): SymbolId {
    return resolveInnerOuterClass(this, classId);
  }

  private extractClassEquations(
    classId: SymbolId,
    prefix: string,
    dae: DAEBuilder,
    breakContext?: {
      brokenComponents: Set<string>;
      brokenConnections: Set<string>;
    },
    parentMods?: any,
    visitedClasses?: Set<SymbolId>,
  ): void {
    extractClassEquations(this, classId, prefix, dae, breakContext, parentMods, visitedClasses);
  }

  private expandConnectorRef(refStr: string, dae: DAEBuilder): string[] {
    return expandConnectorRef(refStr, dae);
  }
}

export { ModelicaFlattener as ArenaQueryFlattener };
