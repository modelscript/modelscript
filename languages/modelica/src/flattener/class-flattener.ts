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
  hasArrayEquations,
  type QueryDB,
  scalarizeArena,
  type SymbolEntry,
  type SymbolId,
  Variability,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../src-gen/bindings.js";
import { ModelicaPortBalancer } from "../connections.js";
import { AnnotationEvaluator } from "../diagram/annotation-evaluator.js";
import { ModelicaErrorCode } from "../errors.js";
import { getShortClassSpecifierNode, isScopeEncapsulated, validateEnumeration } from "../queries.js";

export * from "./index.js";

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
  escapeRegExp,
  evaluateCSTToNumber,
  expandConnectorRef,
  extractClassEquations,
  extractCompilerOptions,
  extractDescription,
  extractStateMachines,
  findComponentDeclarationAt,
  findEquationNodeAt,
  type FlattenerBackend,
  flattenFunction,
  type FlatteningState,
  type FlattenOptions,
  generateExternalObjectFunctions,
  generateFunctions,
  generateOperatorFunctions,
  generateRecordConstructorFor,
  generateRecordConstructors,
  getElementDiagRange,
  getFlatteningState,
  getOrCreateWasmEnv,
  getSymbolQualifiedName,
  instantiateElements,
  isClassType,
  isComponentHidden,
  isCstNodeProtected,
  isExpandableConnectorClass,
  isFunctionSym,
  isInsideExpandableBus,
  isStaticTrueAssert,
  lowerCSTExpression,
  ModelicaModificationEnv,
  patchIncremental,
  processExpandableConnectors,
  propagateImpureFunctions,
  resolveInnerOuterClass,
  resolveRedeclarationType,
  stripComments,
  validateClassModifiers,
  validateComponentBasicAttributes,
  validateFunctionComponentDeclaration,
} from "./index.js";

export class ModelicaFlattener {
  bodySnapshot: DAEBuilder | null = null;
  public db: QueryDB;
  private options: Required<FlattenOptions>;
  private currentRootClassId: SymbolId = 0;
  public currentClassId: SymbolId = 0;

  private getElementDiagRange(target: any): any {
    return getElementDiagRange(target);
  }
  private innerOuterComponents = new Set<string>();
  private innerDeclarations = new Map<string, Map<string, string>>();
  private disabledComponents = new Set<string>();
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
  public currentBindingCompName?: string;
  private nodeProtectionCache = new WeakMap<any, boolean>();
  public useLocalDirection = false;

  private getFileSymbols(resourceId: string): any[] {
    const result: any[] = [];
    const roots = (this.db.childrenOf(null) ?? []).filter((s: any) => s.resourceId === resourceId);
    const queue = [...roots];
    while (queue.length > 0) {
      const sym = queue.pop()!;
      result.push(sym);
      const children = this.db.childrenOf(sym.id) ?? [];
      for (const child of children) {
        if (child.resourceId === resourceId) {
          queue.push(child);
        }
      }
    }
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

  private isComponentHidden(elemId: SymbolId): boolean {
    return isComponentHidden(this, elemId);
  }

  private extractDescription(elemCst: any): string | null {
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
    const meta = (sym.metadata as any) || {};
    const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
    const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
    if (/\boperator\s+record\b/.test(cleanKind)) return true;
    const cst = this.db.cstNode(sym.id) as any;
    if (cst) {
      const text = (cst.text?.trim() ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
      if (/^(?:(?:encapsulated|partial)\s+)*operator\s+record\b/.test(text)) return true;
    }
    return false;
  }

  isClassPartial(classId?: SymbolId | null): boolean {
    if (!classId || classId < 0) return false;
    const sym = this.db.symbol(classId);
    if (!sym || (sym.kind !== "Class" && sym.kind !== "Package" && sym.kind !== "Function")) return false;
    const meta = (sym.metadata as any) || {};
    const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
    const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
    if (/\bpartial\b/.test(cleanKind)) return true;
    const cst = this.db.cstNode(classId) as any;
    if (cst) {
      const pfxNode = Cst.ClassDefinition.classPrefixes(cst);
      const text = (pfxNode?.text ?? cst.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
      if (/\bpartial\b/.test(text.slice(0, 100)) || /^(?:(?:encapsulated|pure|impure)\s+)*partial\b/.test(text)) {
        return true;
      }
    }
    const isShortClassDef = cst && Boolean(getShortClassSpecifierNode(cst));
    if (isShortClassDef) {
      const baseSym: any = this.db.query("resolvedBaseClass", classId);
      if (baseSym && baseSym.id !== classId) {
        return this.isClassPartial(baseSym.id);
      }
    }
    return false;
  }

  private _hasOperatorRecordsCache = new Map<SymbolId, boolean>();

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
    const res = (this.db.allEntries?.() ?? []).some((s: any) => s.kind === "Class" && this.isOperatorRecordSym(s));
    this._hasOperatorRecordsCache.set(rootClassId, res);
    return res;
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
      const recStart = recCst?.startIndex ?? recCst?.startByte;
      const recEnd = recCst?.endIndex ?? recCst?.endByte;
      const recRange = recStart != null && recEnd != null ? { startByte: recStart, endByte: recEnd } : undefined;

      const children = this.db.childrenOf(rec.id);
      for (const child of children) {
        if (child.kind !== "Class") continue;
        const childMeta = (child.metadata as Record<string, unknown>) || {};
        const childPrefix = String(childMeta?.classPrefixes ?? childMeta?.classKind ?? "");
        const childCst = this.db.cstNode(child.id) as any;
        const childText = childCst?.text?.trim() ?? "";

        const isOperator =
          childPrefix.includes("operator") ||
          child.name.startsWith("'") ||
          childText.startsWith("operator") ||
          /^(?:(?:encapsulated|partial)\s+)*operator\b/.test(childText);

        if (!isOperator) continue;

        const recMeta = (rec.metadata as Record<string, unknown>) || {};
        const recPrefix = String(recMeta?.classPrefixes ?? recMeta?.classKind ?? "");
        const cleanChildPrefix = childPrefix.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
        const cleanChildText = childText.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
        const cleanRecPrefix = recPrefix.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
        const isEncapsulated =
          /(?<!non-)\bencapsulated\b/.test(cleanRecPrefix) ||
          /(?<!non-)\bencapsulated\b/.test(cleanChildPrefix) ||
          /(?<!non-)\bencapsulated\b/.test(cleanChildText) ||
          this.db.childrenOf(child.id).some((c) => {
            if (c.kind !== "Class") return false;
            const meta = (c.metadata as any) || {};
            const pfx = String(meta.classPrefixes ?? meta.classKind ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
            return /(?<!non-)\bencapsulated\b/.test(pfx);
          });

        if (!isOldFrontend && !isEncapsulated) {
          const cStart = childCst?.startIndex ?? childCst?.startByte;
          const cEnd = childCst?.endIndex ?? childCst?.endByte;
          const cRange = cStart != null && cEnd != null ? { startByte: cStart, endByte: cEnd } : undefined;
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
    const meta = (sym.metadata as any) || {};
    const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
    const cleanKind = stripComments(rawKind).trim();
    const words = cleanKind.split(/\s+/).filter(Boolean);
    if (words.includes("record")) return true;
    const cst = this.db.cstNode(sym.id) as any;
    if (cst) {
      const pfx = Cst.ClassDefinition.classPrefixes(cst);
      if (pfx) {
        const pfxWords = stripComments(pfx.text ?? "")
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        if (pfxWords.includes("record")) return true;
      }
      const text = (cst.text?.trim() ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
      if (/^(?:(?:encapsulated|partial)\s+)*record\b/.test(text)) return true;
    }
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
      const rawKind = String(clsSym?.metadata?.classKind ?? clsSym?.metadata?.classPrefixes ?? "");
      const cleanKind =
        rawKind
          .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ")
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
      if (cleanKind === "type" || cleanKind === "record" || cleanKind === "connector" || cleanKind === "package") {
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
                startByte: targetNode.startIndex ?? targetNode.startByte,
                endByte: targetNode.endIndex ?? targetNode.endByte,
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
                startByte: targetNode.startIndex ?? targetNode.startByte,
                endByte: targetNode.endIndex ?? targetNode.endByte,
                startPosition: targetNode.startPosition,
                endPosition: targetNode.endPosition,
              },
            });
          }
        }
      }

      // 2. Protected sections in type, record, connector
      const isOldFrontend = Boolean(dae.extensionMetadata?.isOldFrontend);
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
                  startByte: child.startIndex ?? child.startByte,
                  endByte: firstElem.endIndex ?? firstElem.endByte,
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
                startByte: targetNode.startIndex ?? targetNode.startByte,
                endByte: targetNode.endIndex ?? targetNode.endByte,
                startPosition: targetNode.startPosition,
                endPosition: targetNode.endPosition,
              },
            });
          }
        }
      }

      // 3. Variable in package must be constant
      if (cleanKind === "package" && !dae.extensionMetadata?.isOldFrontend) {
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
                  startByte: targetNode.startIndex ?? targetNode.startByte,
                  endByte: targetNode.endIndex ?? targetNode.endByte,
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

  collectClassImports(classId: SymbolId, visited: Set<SymbolId> = new Set<SymbolId>()): Map<string, string> {
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

    // 2. Base class imports (via Extends)
    const extendsChildren = this.db.childrenOf(classId).filter((c) => c.kind === "Extends");
    for (const ext of extendsChildren) {
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

    // 3. Own imports from index
    for (const child of this.db.childrenOf(classId)) {
      if (child.kind === "Import") {
        const meta = child.metadata as Record<string, unknown>;
        let importKind = meta?.importKind as string | undefined;
        let pkgName = (meta?.packageName ?? child.name) as string;
        let aliasName = meta?.shortName as string | undefined;

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

    return result;
  }

  private lowerExpr(
    node: SyntaxNode | null | undefined,
    dae: DAEBuilder,
    prefix = "",
    substitutions?: Map<string, number | string>,
    tupleContext?: boolean,
    isAssignmentLhs?: boolean,
  ): number {
    return lowerCSTExpression(
      node,
      dae,
      prefix,
      substitutions,
      this.currentImports,
      this.db,
      this,
      tupleContext,
      false,
      isAssignmentLhs,
    );
  }

  private isStaticTrueAssert(callId: number, dae: DAEBuilder): boolean {
    return isStaticTrueAssert(callId, dae);
  }

  private emitFunctionCallEquation(
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

  private collectExprVarNames(exprId: number, dae: DAEBuilder, names: Set<string>, visited = new Set<number>()): void {
    collectExprVarNames(exprId, dae, names, visited);
  }

  private checkCyclicConstantsAndParameters(dae: DAEBuilder, rootClassId: SymbolId): void {
    checkCyclicConstantsAndParameters(dae, rootClassId, this.db, this.options, this.varConditionDeps);
  }

  private checkCyclicFunctionComponents(fn: DAEBuilder, fnSymId: SymbolId): void {
    checkCyclicFunctionComponents(fn, fnSymId, this.db);
  }

  constructor(db: QueryDB, options?: FlattenOptions) {
    this.db = db;
    const omcCompatibility = options?.omcCompatibility ?? false;
    let backend: FlattenerBackend =
      options?.backend ?? (options as any)?.flattenerBackend ?? (options?.useWasmKernel ? "wasm" : "hybrid");
    this.options = {
      backend,
      arrayMode: options?.arrayMode ?? (omcCompatibility ? "scalarize" : "preserve"),
      functionInlining: options?.functionInlining ?? false,
      omcCompatibility,
      eliminateAliases: options?.eliminateAliases ?? !omcCompatibility,
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
      if (options.arrayMode !== undefined) this.options.arrayMode = options.arrayMode;
      if (options.functionInlining !== undefined) this.options.functionInlining = options.functionInlining;
      if (options.omcCompatibility !== undefined) {
        this.options.omcCompatibility = options.omcCompatibility;
        if (options.arrayMode === undefined && options.omcCompatibility) {
          this.options.arrayMode = "scalarize";
        }
        if (options.eliminateAliases === undefined) {
          this.options.eliminateAliases = !options.omcCompatibility;
        }
      }
      if (options.eliminateAliases !== undefined) this.options.eliminateAliases = options.eliminateAliases;
      if (options.scalarizeBindings !== undefined) this.options.scalarizeBindings = options.scalarizeBindings;
      if (options.isOldFrontend !== undefined) (this.options as any).isOldFrontend = options.isOldFrontend;
    }

    const dae = this.flattenClass(rootClassId, cachedArena);
    if (
      !dae.diagnostics.some((d) => d.severity === "error") &&
      !dae.extensionMetadata?.isOldFrontend &&
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

  private classHasRedeclare(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    if (!classId || visited.has(classId)) return false;
    visited.add(classId);

    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (this.db.query<boolean>("isRedeclare", child.id)) {
        return true;
      }
      if (this.db.query<boolean>("isReplaceable", child.id)) {
        return true;
      }
      if (child.kind === "Extends") {
        const extendsModParsedRaw = this.db.query<any>("extendsModificationParsed", child.id);
        const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
          ? extendsModParsedRaw
          : (extendsModParsedRaw?.args ?? []);
        for (const arg of extendsModParsed) {
          if (arg.isRedeclaration || arg.redeclaredTypeSpecifier) return true;
        }
        const baseClass =
          this.db.query<any>("resolvedBaseClass", child.id) ??
          (classId
            ? (this.db.query<any>("resolveName", classId)?.(child.name) ??
              this.db.query<any>("resolveSimpleName", classId)?.(child.name))
            : null) ??
          this.db.byName(child.name)?.[0];
        if (baseClass && this.classHasRedeclare(baseClass.id, visited)) return true;
      }
      if (child.kind === "Component") {
        const compInst = this.db.query<any>("componentInstance", child.id);
        if (compInst?.isReplaceable) return true;
        if (compInst?.modification?.args) {
          for (const arg of compInst.modification.args) {
            if (arg.isRedeclaration || arg.redeclaredTypeSpecifier) return true;
          }
        }
      }
    }
    return false;
  }

  private classHasConnect(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
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

    // 1. Partial / Expandable / Protected checks via AST & QueryDB
    if (this.isClassPartial(classId)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    if (this.isExpandableConnectorClass(classId)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    if (this.collectProtectedNames(classId).size > 0) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }

    const sym = this.db.symbol(classId);
    let rawText = "";
    if (sym && sym.startByte != null && sym.endByte != null) {
      if (typeof (this.db as any).cstText === "function") {
        rawText = (this.db as any).cstText(sym.startByte, sym.endByte, sym) ?? "";
      }
      if (!rawText && sym.resourceId) {
        const s = (this.db as any).source?.(sym.resourceId);
        if (typeof s === "string") {
          rawText = s.slice(sym.startByte, sym.endByte);
        }
      }
    }
    if (!rawText) {
      const cst = this.db.cstNode(classId) as any;
      rawText = cst?.text ?? "";
    }

    // Strip comments from class text to avoid spurious keyword matches
    const text = stripComments(rawText);

    if (/\b(inner|outer|expandable|each|import|protected|partial|final)\b/.test(text)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    if (/\b(?:type|connector)\s+[a-zA-Z_]\w*\s*=/.test(text)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    if (/\[\s*:\s*\]/.test(text)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    if (/\b[a-zA-Z_]\w*\s*\[\s*(?!\d+\s*\])[^\]]+\]/.test(text)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    if (/\[\s*\d+\s*\]\s*\(/.test(text)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    if (/\b(?:Real|Integer|Boolean|String)\s+[a-zA-Z_]\w*\s*\[\s*\d+\s*,\s*\d+\s*\]/.test(text)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    if (/"[^"\r\n]*"\s*;/.test(text)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    if (
      /(?:^|[;\n\r])\s*(?:(?:final|protected|input|output|flow|stream|discrete)\s+)*(?!parameter\b|constant\b)(?:(?:Real|Integer|Boolean|String)|[a-zA-Z_]\w*)\s+[a-zA-Z_]\w*\s*=[^;]+;/m.test(
        text,
      )
    ) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    if (/\b(?:nominal|min|max|displayUnit|quantity|stateSelect)\s*[(=]/i.test(text)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    if (/\barray\s*\(\s*\{/.test(text)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    if (/\sif\s+[a-zA-Z0-9_.]+\s*;/m.test(text)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }

    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (child.kind === "Import") {
        this._unsupportedWasmCache.set(classId, true);
        return true;
      }
      if (child.kind === "Extends") {
        const baseClass =
          this.db.query<any>("resolvedBaseClass", child.id) ??
          (classId
            ? (this.db.query<any>("resolveName", classId)?.(child.name) ??
              this.db.query<any>("resolveSimpleName", classId)?.(child.name))
            : null) ??
          this.db.byName(child.name)?.[0];
        if (baseClass && this.classHasUnsupportedWasmFeatures(baseClass.id, visited)) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
      }
      if (child.kind === "Class" || child.kind === "Model" || child.kind === "Block" || child.kind === "Connector") {
        this._unsupportedWasmCache.set(classId, true);
        return true;
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
        if (compInst?.causality && targetClass) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
        if (targetClass && this.classHasUnsupportedWasmFeatures(targetClass.id, visited)) {
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
    if (sym?.resourceId) {
      const allSyms = typeof (this.db as any).allEntries === "function" ? (this.db as any).allEntries() : [];
      const topSymbols = (allSyms as SymbolEntry[]).filter(
        (s: any) => s.resourceId === sym.resourceId && (s.parentId === null || s.parentId === 0),
      );
      const topNames = new Set<string>();
      for (const s of topSymbols) {
        if (s.name === "Clock" || topNames.has(s.name)) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
        topNames.add(s.name);
      }
    }

    this._unsupportedWasmCache.set(classId, false);
    return false;
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
    (dae as any).innerOuterComponents = this.innerOuterComponents;
    (dae as any).activeLoopVars = this.activeLoopVars;
    (dae as any).db = this.db;
    (dae as any).flattener = this;
    (dae as any).currentClassId = rootClassId;
    (dae as any)._isRealNameCache?.clear();
    (dae as any)._varPrefixSet?.clear();
    (dae as any)._varPrefixCount = 0;
    const rawKind = (rootSym?.metadata as any)?.classKind ?? (rootSym?.metadata as any)?.classPrefixes ?? "model";
    let specKind: string | null = null;
    if (typeof rawKind === "string") {
      const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
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
    dae.extensionMetadata.isOldFrontend = isOldInst;
    dae.extensionMetadata.scalarizeBindings = compilerOpts.scalarizeBindings;
    dae.extensionMetadata.scalarizeMinMax = compilerOpts.scalarizeMinMax;
    dae.extensionMetadata.isGen = compilerOpts.isGen;
    (dae.extensionMetadata as any).hasOldInstOption = compilerOpts.hasOldInstAnnotation;
    // Check for non-instantiable class specializations (package, function, etc.)
    const classCstForCheck = classCst as SyntaxNode | null;
    const ownOldInstText: string = classCst?.text ?? "";
    const optIdx = ownOldInstText.lastIndexOf("-d=-newInst");
    const optIsNested = optIdx >= 0 && /\bend\s+[A-Za-z_]\w*\s*;[\s\S]*\bend\s/.test(ownOldInstText.slice(optIdx));
    const allowOldInstSpec = isOldInst && !(specKind === "package" && optIsNested);
    if (specKind && !((specKind === "function" || specKind === "package") && allowOldInstSpec)) {
      let startPos = classCstForCheck?.startPosition;
      let startB = classCstForCheck?.startIndex ?? (classCstForCheck as any)?.startByte ?? 0;
      const pfxNode = classCstForCheck ? Cst.ClassDefinition.classPrefixes(classCstForCheck) : null;
      if (pfxNode?.children) {
        for (const child of pfxNode.children) {
          if (child.type !== "comment" && child.type !== "description") {
            startPos = child.startPosition ?? startPos;
            startB = child.startIndex ?? (child as any).startByte ?? startB;
            break;
          }
        }
      }
      const range = classCstForCheck
        ? {
            startByte: startB,
            endByte: classCstForCheck.endIndex ?? (classCstForCheck as any).endByte ?? 0,
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
      let startB = classCstForCheck?.startIndex ?? (classCstForCheck as any)?.startByte ?? 0;
      const pfxNode = classCstForCheck ? Cst.ClassDefinition.classPrefixes(classCstForCheck) : null;
      if (pfxNode?.children) {
        for (const child of pfxNode.children) {
          if (child.type !== "comment" && child.type !== "description") {
            startPos = child.startPosition ?? startPos;
            startB = child.startIndex ?? (child as any).startByte ?? startB;
            break;
          }
        }
      }
      const range = classCstForCheck
        ? {
            startByte: startB,
            endByte: classCstForCheck.endIndex ?? (classCstForCheck as any).endByte ?? 0,
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
      const ext = extendsClauses[extIdx];
      const extCst = this.db.cstNode(ext.id) as any;
      const extRange = extCst
        ? { startByte: extCst.startIndex ?? extCst.startByte, endByte: extCst.endIndex ?? extCst.endByte }
        : undefined;

      const parts = ext.name.split(".");
      let currentScope: SymbolEntry | null = this.db.symbol(rootClassId);
      const isEncapsulatedRoot = isScopeEncapsulated(this.db, rootClassId);
      const resolvedChain: { name: string; symbol: SymbolEntry | null }[] = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
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
                startByte: targetCst.startIndex ?? targetCst.startByte,
                endByte: targetCst.endIndex ?? targetCst.endByte,
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
        const item = resolvedChain[i];
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
                  startByte: targetRepNode.startIndex ?? targetRepNode.startByte,
                  endByte: targetRepNode.endIndex ?? targetRepNode.endByte,
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
        const prevExt = extendsClauses[j];
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
            ? { startByte: innerCst.startIndex ?? innerCst.startByte, endByte: innerCst.endIndex ?? innerCst.endByte }
            : undefined;
          const prevExtCst = this.db.cstNode(m.prevExt.id) as any;
          const prevExtRange = prevExtCst
            ? {
                startByte: prevExtCst.startIndex ?? prevExtCst.startByte,
                endByte: prevExtCst.endIndex ?? prevExtCst.endByte,
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
    for (const child of this.db.childrenOf(rootClassId)) {
      if (child.kind === "Class") {
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
            const cleanPrefixes = (prefixes?.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
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
              const r = startIdx >= 0 ? { startByte: startIdx, endByte: startIdx + redeclMatch[0].length } : undefined;
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
      const allSyms = typeof (this.db as any).allEntries === "function" ? (this.db as any).allEntries() : [];
      const topLevelSymbols = (allSyms as SymbolEntry[]).filter(
        (s: any) =>
          s.resourceId === rootSym.resourceId &&
          (s.parentId === null || s.parentId === 0) &&
          (s.kind === "Class" || s.kind === "Component"),
      );

      const seenTop = new Map<string, SymbolEntry>();
      for (const s of topLevelSymbols) {
        // Built-in type check for top-level classes (Clock2.mo)
        if (s.name === "Clock") {
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
            message: ModelicaErrorCode.DUPLICATE_ELEMENT.message("Clock"),
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
          if (dae.extensionMetadata?.isOldFrontend && elem.kind === "Component" && prevElem.kind === "Component") {
            const getClause = (node: any) => {
              let curr = node;
              while (curr && curr.type !== "component_clause") curr = curr.parent;
              return curr ?? node;
            };
            const prevCl = getClause(prevCst);
            const currCl = getClause(currCst);
            let prevText = prevCl?.text?.trim() ?? "";
            const currText = currCl?.text?.trim() ?? "";
            prevText = prevText.replace(/^([a-zA-Z_]\w*)\[([^\]]+)\]\s+([a-zA-Z_]\w*)/, "$1 $3[$2]");
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
            startByte: clauseNode.startIndex ?? clauseNode.startByte,
            endByte: clauseNode.endIndex ?? clauseNode.endByte,
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
                const sByte = (extCst.startIndex ?? extCst.startByte ?? 0) + m.index;
                const eByte = sByte + m[0].length;
                redeclRange = { startByte: sByte, endByte: eByte };
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

    // Check for duplicate elements due to inherited elements
    for (const ext of extendsClauses) {
      const baseClass =
        this.db.query<SymbolEntry | null>("resolvedBaseClass", ext.id) ??
        (rootClassId
          ? (this.db.query<any>("resolveName", rootClassId)?.(ext.name) ??
            this.db.query<any>("resolveSimpleName", rootClassId)?.(ext.name))
          : null) ??
        this.db.byName(ext.name)[0];
      if (baseClass) {
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
              startByte: extCst?.startIndex ?? extCst?.startByte,
              endByte: extCst?.endIndex ?? extCst?.endByte,
              startPosition: extCst?.startPosition,
              endPosition: extCst?.endPosition,
            },
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.EXTENDS_OTHER_BASE_CLASS.code,
            message: ModelicaErrorCode.EXTENDS_OTHER_BASE_CLASS.message(ext.name),
            range: {
              startByte: conflictCst?.startIndex ?? conflictCst?.startByte,
              endByte: conflictCst?.endIndex ?? conflictCst?.endByte,
              startPosition: conflictCst?.startPosition,
              endPosition: conflictCst?.endPosition,
            },
          });
          return dae;
        }

        const extendsModParsedRaw = this.db.query<any>("extendsModificationParsed", ext.id);
        const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
          ? extendsModParsedRaw
          : (extendsModParsedRaw?.args ?? []);
        const brokenNames = new Set<string>();
        for (const arg of extendsModParsed) {
          if ((arg.isBreak || arg.value?.kind === "break") && !arg.name.startsWith("break_connect:")) {
            brokenNames.add(arg.name);
          }
        }
        const baseElements = this.db.query<SymbolId[]>("instantiate", baseClass.id) || [];
        for (const baseElemId of baseElements) {
          const baseElem = this.db.symbol(baseElemId);
          if (!baseElem || baseElem.kind !== "Component") continue;
          if (brokenNames.has(baseElem.name)) continue;
          const matchingLocal = localComps.find((c) => c.name === baseElem.name);
          if (matchingLocal) {
            const isRedecl = this.db.query<boolean>("isRedeclare", matchingLocal.id);
            if (!isRedecl) {
              const localCst = this.db.cstNode(matchingLocal.id) as any;
              const baseCst = this.db.cstNode(baseElem.id) as any;
              const extCst = this.db.cstNode(ext.id) as any;

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
              const localClause = getClause(localCst);
              const baseClause = getClause(baseCst);

              const localRange = localClause
                ? {
                    startByte: localClause.startIndex ?? localClause.startByte,
                    endByte: localClause.endIndex ?? localClause.endByte,
                  }
                : {
                    startByte: localCst?.startIndex ?? localCst?.startByte ?? 0,
                    endByte: localCst?.endIndex ?? localCst?.endByte ?? 0,
                  };
              const baseRange = baseClause
                ? {
                    startByte: baseClause.startIndex ?? baseClause.startByte,
                    endByte: baseClause.endIndex ?? baseClause.endByte,
                  }
                : {
                    startByte: baseCst?.startIndex ?? baseCst?.startByte ?? 0,
                    endByte: baseCst?.endIndex ?? baseCst?.endByte ?? 0,
                  };

              const extStart = extCst?.startIndex ?? extCst?.startByte ?? 0;

              let localText = (localClause?.text ?? localCst?.text ?? "").trim().replace(/;$/, "");
              let baseText = (baseClause?.text ?? baseCst?.text ?? "").trim().replace(/;$/, "");

              baseText = baseText.replace(/\bReal\b/g, ".Real");

              let firstRange = localRange;
              let secondRange = baseRange;
              let firstText = localText;
              let secondText = baseText;

              if (localRange.startByte > extStart) {
                firstRange = baseRange;
                secondRange = localRange;
                firstText = baseText;
                secondText = localText;
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
              return dae;
            }
          }
        }
      }
    }

    this.evaluatedConstantArrays.clear();
    if (this.options.omcCompatibility) {
      this.generateFunctions(rootClassId, dae);
    }

    let flattenedInWasm = false;
    const classNodePtr = classCst?.ptr ?? classCst?.id;
    const rootProgramPtr =
      classCst?.tree?.rootPtr ?? classCst?.tree?.rootNode?.ptr ?? (this.db as any)?.rootNode?.ptr ?? 0;
    const hasWasmFlattener = typeof dae.exports?.flattener_flatten === "function";
    const isStrictWasm = this.options.backend === "wasm";
    const isDiffMode = this.options.backend === "diff";
    const allowWasm =
      this.options.backend === "wasm" ||
      ((this.options.backend === "hybrid" || !this.options.backend) &&
        Boolean(this.options.useWasmKernel) &&
        !this.useLocalDirection &&
        !this.classHasRedeclare(rootClassId) &&
        !this.classHasConnect(rootClassId) &&
        !this.classHasUnsupportedWasmFeatures(rootClassId));

    let wasmDiffStats: { varCount: number; eqCount: number; error?: string } | null = null;
    if (isDiffMode && hasWasmFlattener && classNodePtr) {
      let testDae: DAEBuilder | null = null;
      let wf = 0;
      try {
        testDae = new DAEBuilder(wasmExports, rootName, "");
        wf = testDae.exports.flattener_create ? testDae.exports.flattener_create(testDae.ptr) : 0;
        if (wf) {
          const vc = testDae.exports.flattener_flatten(wf, classNodePtr, rootProgramPtr);
          wasmDiffStats = { varCount: vc, eqCount: testDae.eqCount };
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
      try {
        const wasmFlattener = dae.exports.flattener_create(dae.ptr);
        if (wasmFlattener) {
          const varCount = dae.exports.flattener_flatten(wasmFlattener, classNodePtr, rootProgramPtr);
          if (typeof dae.exports.flattener_getErrorCode === "function") {
            (dae as any).wasmErrorCode = dae.exports.flattener_getErrorCode(wasmFlattener);
          }
          // In hybrid mode, if WASM flattener set a non-zero error code, fall back to TS
          const wasmErrorCode = (dae as any).wasmErrorCode ?? 0;
          if (varCount > 0 && (wasmErrorCode === 0 || isStrictWasm)) {
            flattenedInWasm = true;
            this.recordWasmSourceRanges(dae, rootClassId);
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
          }
        }
      } catch {
        flattenedInWasm = false;
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
          return dae;
        }
        const savedDesc = dae.description;
        const savedDiags = dae.diagnostics;
        const savedExtMeta = dae.extensionMetadata;
        dae.free?.();
        dae = new DAEBuilder(wasmExports, rootName, "");
        dae.description = savedDesc;
        dae.diagnostics = savedDiags;
        dae.extensionMetadata = savedExtMeta;
        (this as any).currentRootDae = dae;
        (dae as any).innerOuterComponents = this.innerOuterComponents;
        (dae as any).activeLoopVars = this.activeLoopVars;
        (dae as any).db = this.db;
        (dae as any).flattener = this;
        (dae as any).currentClassId = rootClassId;
        dae.classKind = specKind ?? rawKind;
        this.state = getFlatteningState(dae, this);
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
            startByte: rootEnumErr.startByte,
            endByte: rootEnumErr.endByte,
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
              startByte: ccEnumErr.startByte,
              endByte: ccEnumErr.endByte,
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

    this.checkCyclicConstantsAndParameters(dae, rootClassId);

    const isOldFrontend = compilerOpts.isOldFrontend;
    dae.extensionMetadata.isOldFrontend = isOldFrontend;
    const isGen = compilerOpts.isGen;
    dae.extensionMetadata.isGen = isGen;

    // 2.5 Fold constants on initial DAE so parameters, dimensions, and expressions are resolved
    foldArenaConstants(dae, this.db, rootClassId, this.options.omcCompatibility);

    const hasArrayConnect = (builder: DAEBuilder) => {
      for (let i = 0; i < builder.eqCount; i++) {
        if (builder.getEqKind(i) === EqKind.Connect) {
          const l = builder.getEqLhs(i);
          const r = builder.getEqRhs(i);
          if (builder.getExprKind(l) !== ExprKind.Name || builder.getExprKind(r) !== ExprKind.Name) return true;
          const lName = builder.interner.resolve(builder.getExprData1(l));
          const rName = builder.interner.resolve(builder.getExprData1(r));
          if (builder.hasArrayElements(lName) || builder.hasArrayElements(rName)) return true;
        }
      }
      return false;
    };

    const shouldScalarize =
      this.options.arrayMode === "scalarize" ||
      (this.options.arrayMode !== "preserve" &&
        (this.options.omcCompatibility || hasArrayEquations(dae) || hasArrayConnect(dae)));

    dae.extensionMetadata.expandableBuses = Array.from(this.expandableBuses.keys());

    if (shouldScalarize) {
      dae = scalarizeArena(dae);
      (this as any).currentRootDae = dae;
    }

    // 2.6 Expandable connector dynamic augmentation, cross-bus pooling, and variable pruning
    this.processExpandableConnectors(rootClassId, dae);

    // 3. Layer 3: Physical connector expansion & flow balance
    let flowThreshold = compilerOpts.flowThreshold;
    ModelicaPortBalancer.expandConnections(dae, {
      omcCompatibility: this.options.omcCompatibility,
      isOldFrontend,
      flowThreshold,
    });

    // 4. Constant folding and alias elimination
    foldArenaConstants(dae, this.db, rootClassId, this.options.omcCompatibility);

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
        | { varCount: number; eqCount: number; error?: string }
        | undefined;
      if (wasmDiff) {
        delete (this as any)._wasmDiffStats;
        (targetDae as any).diffReport = wasmDiff;
        if (process.env.DEBUG_DIFF === "1") {
          if (wasmDiff.error) {
            console.warn(`[DiffFlattener] WASM flattener failed: ${wasmDiff.error}`);
          } else {
            const varMatch = wasmDiff.varCount === targetDae.varCount;
            const eqMatch = wasmDiff.eqCount === targetDae.eqCount;
            console.log(
              `[DiffFlattener] ${varMatch && eqMatch ? "PARITY MATCH" : "PARITY MISMATCH"}: vars (WASM=${wasmDiff.varCount}, TS=${targetDae.varCount}), eqs (WASM=${wasmDiff.eqCount}, TS=${targetDae.eqCount})`,
            );
          }
        }
      }
    };

    this.extractStateMachines(dae);
    dae.groupEquationsForParity();
    this.checkBalance(dae, rootClassId);

    attachDiffReport(dae);
    (dae as any)._isRealNameCache?.clear();
    (dae as any)._varPrefixSet?.clear();
    (dae as any)._varPrefixCount = 0;
    return dae;
  }

  private recordWasmSourceRanges(dae: DAEBuilder, classId: SymbolId): void {
    const cst = this.db.cstNode(classId) as any;
    if (!cst) return;

    let eqIdx = 0;
    const walkEqs = (node: any): void => {
      if (!node) return;
      if (
        node.type === "extends_clause" ||
        node.type === "component_clause" ||
        node.type === "component_clause1" ||
        node.type === "component_declaration"
      ) {
        return;
      }

      if (node.type === "simple_equation" || node.type === "connect_equation" || node.type === "function_call") {
        const sB = node.startIndex ?? node.startByte;
        const eB = node.endIndex ?? node.endByte;
        if (sB != null && eB != null && eqIdx < dae.getEqCount()) {
          dae.setEqSourceRange(eqIdx, sB, eB);
          eqIdx++;
        }
        return;
      }

      for (const child of node.children || []) {
        walkEqs(child);
      }
    };
    walkEqs(cst);

    const walkVars = (node: any): void => {
      if (!node) return;
      if (node.type === "declaration" || node.type === "component_declaration1") {
        const idChild = (node.children || []).find((c: any) => c.type === "identifier");
        const name = idChild ? idChild.text?.trim() : node.text?.trim()?.split(/\s|=|\[|\(/)[0];
        if (name) {
          let varIdx = dae.getVarIdxByName(name);
          if (varIdx < 0) {
            varIdx = dae.getVarIdxByName(`${name}[1]`);
          }
          const sB = node.startIndex ?? node.startByte;
          const eB = node.endIndex ?? node.endByte;
          if (varIdx >= 0 && sB != null && eB != null) {
            dae.setVarSourceRange(varIdx, sB, eB);
            const arrayIndices = dae.getArrayElementIndices(name);
            for (const idx of arrayIndices) {
              dae.setVarSourceRange(idx, sB, eB);
            }
          }
        }
      }
      for (const child of node.children || []) {
        walkVars(child);
      }
    };
    walkVars(cst);
  }

  patch(
    rootClassId: SymbolId,
    dae: DAEBuilder,
    dirtyRanges: { startByte: number; endByte: number }[],
    delta?: number,
  ): boolean {
    this.currentRootClassId = rootClassId;
    return patchIncremental(this, rootClassId, dae, dirtyRanges, delta);
  }

  private findEquationNodeAt(root: any, start: number, end: number): any {
    return findEquationNodeAt(root, start, end);
  }

  private findComponentDeclarationAt(root: any, start: number, end: number): any {
    return findComponentDeclarationAt(root, start, end);
  }

  private isCstNodeProtected(node: any): boolean {
    return isCstNodeProtected(node, this.nodeProtectionCache as any);
  }

  public generateRecordConstructorFor(sym: any, dae: DAEBuilder, rootClassId?: SymbolId): DAEBuilder | null {
    return generateRecordConstructorFor(this, sym, dae, rootClassId);
  }

  private generateRecordConstructors(rootClassId: SymbolId, dae: DAEBuilder): void {
    generateRecordConstructors(this, rootClassId, dae);
  }

  private isFunctionSym(sym: any): boolean {
    return isFunctionSym(this.db, sym);
  }

  private isInsideExpandableBus(prefix: string): boolean {
    return isInsideExpandableBus(this.expandableBuses, prefix);
  }

  private processExpandableConnectors(rootClassId: SymbolId, dae: DAEBuilder): void {
    processExpandableConnectors(rootClassId, dae, this.db, this.expandableBuses);
  }

  private flattenFunction(
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

    ModelicaPortBalancer.expandConnections(dae, { omcCompatibility: this.options.omcCompatibility });

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

  private collectInheritedTypeModifiers(scopeId: SymbolId, typeLeafName: string, visited = new Set<SymbolId>()): any[] {
    return collectInheritedTypeModifiers(this, scopeId, typeLeafName, visited);
  }

  private getOrCreateWasmEnv(dae: DAEBuilder, mods?: any): ModelicaModificationEnv | null {
    return getOrCreateWasmEnv(this, dae, mods);
  }

  private classFindMember(classId: SymbolId, name: string, visited: Set<SymbolId> = new Set()): SymbolEntry | null {
    return classFindMember(this, classId, name, visited);
  }

  private validateClassModifiers(defaultTargetClassId: SymbolId, args: any[], dae: DAEBuilder): boolean {
    return validateClassModifiers(this, defaultTargetClassId, args, dae);
  }

  private instantiateElements(elements: SymbolId[], prefix: string, dae: DAEBuilder, parentMods?: any): void {
    instantiateElements(this, elements, prefix, dae, parentMods);
  }

  private validateFunctionComponentDeclaration(
    dae: DAEBuilder,
    compInst: any,
    causality: Causality,
    isElemProtected: boolean,
    elemCst: any,
  ): void {
    validateFunctionComponentDeclaration(this, dae, compInst, causality, isElemProtected, elemCst);
  }

  private validateComponentBasicAttributes(
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

  private evaluateCSTToNumber(
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

  private resolveRedeclarationType(scopeId: SymbolId | null, redeclSpecifier: string): SymbolId | null {
    return resolveRedeclarationType(this, scopeId, redeclSpecifier);
  }

  private resolveInnerOuterClass(classId: SymbolId): SymbolId {
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
