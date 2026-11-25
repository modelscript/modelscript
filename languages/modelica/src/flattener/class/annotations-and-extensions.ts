// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Class annotations, metadata queries, specialization validation, import collection,
 * showAnnotations formatting, and conditional parameter finalization.
 */

import { ExprKind } from "@modelscript/dsl";
import { type DAEBuilder, type QueryDB, type SymbolEntry, type SymbolId, Variability } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../src-gen/bindings.js";
import { BUILTIN_FUNCTIONS, BUILTIN_VARIABLES } from "../../builtins.js";
import { AnnotationEvaluator } from "../../diagram/annotation-evaluator.js";
import { ModelicaErrorCode } from "../../errors.js";
import { getShortClassSpecifierNode } from "../../queries.js";
import {
  SCALAR_VECTORIZABLE_FUNCTIONS,
  stripArraySubscripts,
  stripCommentsAndStrings,
  stripLeadingDot,
  stripOuterSingleQuotes,
  tokenizeCommentStrippedWords,
} from "../expressions/index.js";
import { extractCompilerOptions } from "../support/compiler-options.js";
import {
  cstHasUnqualifiedImportWildcard,
  hasClassPrefixWordCst,
  hasOperatorRecordPrefixCst,
} from "./cst-token-helpers.js";
import type {
  ClassFlattenerContext,
  ComponentInstanceQueryData,
  CstNodeLike,
  DaeWithExtras,
  NameResolverFn,
  QueryDBWithCaches,
  SymbolEntryWithCaches,
  SymbolMetaLike,
} from "./types.js";

export function extractClassAnnotations(db: QueryDB, dae: DAEBuilder, classId: SymbolId): void {
  const cst = db.cstNode(classId) as CstNodeLike | null;
  if (!cst) return;

  const evaluator = new AnnotationEvaluator(db);

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
    dae.extensionMetadata["sde"] = {
      method: sde.method ? String(sde.method) : undefined,
      ensemblePaths: sde.ensemblePaths ? Number(sde.ensemblePaths) : undefined,
      seed: sde.seed ? Number(sde.seed) : undefined,
    };
  }

  // 5. BVP
  const bvp = evaluator.evaluate(cst, "bvp");
  if (bvp) {
    dae.extensionMetadata["bvp"] = {
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

export function isExternalObject(
  db: QueryDB,
  classId: SymbolId | null | undefined,
  visited = new Set<SymbolId>(),
): boolean {
  if (!classId || visited.has(classId)) return false;
  visited.add(classId);
  const sym = db.symbol(classId);
  if (!sym) return false;
  if (sym.name === "ExternalObject") return true;

  const extendsChildren = db.childrenOf(classId).filter((c) => c.kind === "Extends");
  for (const ext of extendsChildren) {
    if (ext.name === "ExternalObject" || ext.name.endsWith(".ExternalObject")) return true;
    const base = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
    const scoped =
      db.query<NameResolverFn | null>("resolveName", classId)?.(ext.name) ??
      db.query<NameResolverFn | null>("resolveSimpleName", classId)?.(ext.name);
    const target = base ?? scoped ?? db.byName(ext.name).find((e) => e.kind === "Class");
    if (target && isExternalObject(db, target.id, visited)) {
      return true;
    }
  }
  return false;
}

export function isOperatorRecordSym(db: QueryDB, sym: SymbolEntry | null | undefined): boolean {
  const meta = (sym?.metadata ?? {}) as SymbolMetaLike;
  if (!sym || sym.id < 0 || meta.isPredefined) return false;
  const cachedSym = sym as SymbolEntryWithCaches;
  if (cachedSym._isOperatorRecord !== undefined) return cachedSym._isOperatorRecord;
  const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
  const kindWords = tokenizeCommentStrippedWords(rawKind);
  if (kindWords.some((w, idx) => w === "operator" && kindWords[idx + 1] === "record")) {
    cachedSym._isOperatorRecord = true;
    return true;
  }
  if (kindWords.length > 0 && !kindWords.includes("operator") && !kindWords.includes("record")) {
    cachedSym._isOperatorRecord = false;
    return false;
  }
  const cst = db.cstNode(sym.id) as CstNodeLike | null;
  if (cst) {
    if (hasOperatorRecordPrefixCst(cst)) {
      cachedSym._isOperatorRecord = true;
      return true;
    }
  }
  cachedSym._isOperatorRecord = false;
  return false;
}

export function isClassPartial(
  db: QueryDB,
  classId?: SymbolId | null,
  visited = new Set<SymbolId>(),
  isOldFrontend = false,
): boolean {
  if (!classId || classId < 0 || visited.has(classId)) return false;
  visited.add(classId);
  const sym = db.symbol(classId);
  if (!sym || (sym.kind !== "Class" && sym.kind !== "Package" && sym.kind !== "Function")) return false;
  const meta = (sym.metadata ?? {}) as SymbolMetaLike;
  const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
  if (tokenizeCommentStrippedWords(rawKind).includes("partial")) return true;
  const cst = db.cstNode(classId) as CstNodeLike | null;
  if (cst) {
    if (hasClassPrefixWordCst(cst, "partial")) return true;
    const shortSpec = getShortClassSpecifierNode(
      cst as Parameters<typeof getShortClassSpecifierNode>[0],
    ) as CstNodeLike | null;
    if (shortSpec && !isOldFrontend) {
      const typeSpecNode = shortSpec.children?.find((c) => c.type === "type_specifier" || c.type === "name");
      const typeName = typeSpecNode?.text?.trim();
      if (typeName) {
        const resolved =
          db.query<NameResolverFn | null>("resolveName", classId)?.(typeName) ??
          db.query<NameResolverFn | null>("resolveSimpleName", classId)?.(typeName) ??
          db.byName(typeName)?.[0];
        if (resolved?.id) {
          return isClassPartial(db, resolved.id, visited, isOldFrontend);
        }
      }
    }
  }
  return false;
}

export function hasOperatorRecords(
  ctx: ClassFlattenerContext,
  cache: Map<SymbolId, boolean>,
  rootClassId?: SymbolId | null,
): boolean {
  if (!rootClassId) return true;
  const cached = cache.get(rootClassId);
  if (cached !== undefined) return cached;
  const rootSym = ctx.db.symbol(rootClassId);
  if (rootSym?.resourceId) {
    const fileSyms = ctx.getFileSymbols(rootSym.resourceId);
    if (fileSyms.some((s) => s.kind === "Class" && isOperatorRecordSym(ctx.db, s))) {
      cache.set(rootClassId, true);
      return true;
    }
  }
  const dbCached = ctx.db as QueryDBWithCaches;
  if (dbCached._globalHasOperatorRecords === undefined) {
    dbCached._globalHasOperatorRecords = (dbCached.allEntries?.() ?? []).some(
      (s) => s.kind === "Class" && isOperatorRecordSym(ctx.db, s),
    );
  }
  const hasGlobal = Boolean(dbCached._globalHasOperatorRecords);
  cache.set(rootClassId, hasGlobal);
  return hasGlobal;
}

export function validateOperatorRecords(ctx: ClassFlattenerContext, dae: DAEBuilder, rootClassId: SymbolId): void {
  const rootSym = ctx.db.symbol(rootClassId);
  if (!rootSym || !rootSym.resourceId) return;
  const rootCst = ctx.db.cstNode(rootClassId) as CstNodeLike | null;
  const isOldFrontend = extractCompilerOptions(rootCst, ctx.options, ctx.db, rootSym).isOldFrontend;

  const candidates = ctx
    .getFileSymbols(rootSym.resourceId)
    .filter((s) => s.kind === "Class" && isOperatorRecordSym(ctx.db, s));

  for (const rec of candidates) {
    const recCst = ctx.db.cstNode(rec.id) as CstNodeLike | null;
    const recStart = recCst?.startIndex ?? recCst?.startOffset;
    const recEnd = recCst?.endIndex ?? recCst?.endOffset;
    const recRange = recStart != null && recEnd != null ? { startOffset: recStart, endOffset: recEnd } : undefined;

    const children = ctx.db.childrenOf(rec.id);
    for (const child of children) {
      if (child.kind !== "Class") continue;
      const childMeta = (child.metadata as Record<string, unknown>) || {};
      const childPrefix = String(childMeta?.["classPrefixes"] ?? childMeta?.["classKind"] ?? "");
      const childCst = ctx.db.cstNode(child.id) as CstNodeLike | null;
      const childText = childCst?.text?.trim() ?? "";

      const isOperator =
        childPrefix.includes("operator") ||
        child.name.startsWith("'") ||
        childText.startsWith("operator") ||
        hasClassPrefixWordCst(childCst, "operator");

      if (!isOperator) continue;

      const recMeta = (rec.metadata as Record<string, unknown>) || {};
      const recPrefix = String(recMeta?.["classPrefixes"] ?? recMeta?.["classKind"] ?? "");
      const checkEncapsulated = (s: string) => {
        const words = tokenizeCommentStrippedWords(s);
        return words.includes("encapsulated") && !words.includes("non-encapsulated");
      };
      const isEncapsulated =
        checkEncapsulated(recPrefix) ||
        checkEncapsulated(childPrefix) ||
        hasClassPrefixWordCst(childCst, "encapsulated") ||
        ctx.db.childrenOf(child.id).some((c) => {
          if (c.kind !== "Class") return false;
          const meta = (c.metadata ?? {}) as SymbolMetaLike;
          const pfx = String(meta.classPrefixes ?? meta.classKind ?? "");
          return checkEncapsulated(pfx);
        });

      if (!isOldFrontend && !isEncapsulated) {
        const cStart = childCst?.startIndex ?? childCst?.startOffset;
        const cEnd = childCst?.endIndex ?? childCst?.endOffset;
        const cRange = cStart != null && cEnd != null ? { startOffset: cStart, endOffset: cEnd } : undefined;
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.NON_ENCAPSULATED_OPERATOR.code,
          message: `Operator ${rec.name}.'${stripOuterSingleQuotes(child.name)}' is not encapsulated.`,
          range: cRange,
        });
      }

      const isCtor = child.name === "'constructor'" || child.name === "constructor";
      if (isCtor) {
        const funcs =
          childPrefix.includes("operator function") || childText.startsWith("operator function")
            ? [child]
            : ctx.db.childrenOf(child.id).filter((c) => c.kind === "Class");

        for (const fn of funcs) {
          const comps = ctx.db.childrenOf(fn.id).filter((c) => c.kind === "Component");
          const outputs: SymbolEntry[] = [];
          for (const c of comps) {
            const causality = ctx.db.query<string | null>("causality", c.id);
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
            const outType = ctx.db.query<string | null>("typeSpecifier", out.id);
            const cleanType = stripLeadingDot(outType ?? "");
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

export function isRecordSym(db: QueryDB, sym: SymbolEntry | null | undefined): boolean {
  const meta = (sym?.metadata ?? {}) as SymbolMetaLike;
  if (!sym || sym.id < 0 || meta.isPredefined) return false;
  const cachedSym = sym as SymbolEntryWithCaches;
  if (cachedSym._isRecord !== undefined) return cachedSym._isRecord;
  const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
  const words = tokenizeCommentStrippedWords(rawKind);
  if (words.includes("record")) {
    cachedSym._isRecord = true;
    return true;
  }
  if (words.length > 0 && !words.includes("record")) {
    cachedSym._isRecord = false;
    return false;
  }
  const cst = db.cstNode(sym.id) as SyntaxNode | null;
  if (cst) {
    const pfx = Cst.ClassDefinition.classPrefixes(cst);
    if (pfx) {
      const pfxWords = tokenizeCommentStrippedWords(pfx.text ?? "");
      if (pfxWords.includes("record")) {
        cachedSym._isRecord = true;
        return true;
      }
    }
    if (hasClassPrefixWordCst(cst, "record")) {
      cachedSym._isRecord = true;
      return true;
    }
  }
  cachedSym._isRecord = false;
  return false;
}

export function validateClassSpecializationRestrictions(db: QueryDB, dae: DAEBuilder, rootClassId: SymbolId): void {
  const rootSym = db.symbol(rootClassId);
  if (!rootSym) return;

  const collectClasses = (parentId: SymbolId | null): SymbolEntry[] => {
    const result: SymbolEntry[] = [];
    const children = db.childrenOf(parentId) ?? [];
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
    const cleanKind = tokenizeCommentStrippedWords(rawKind).pop() ?? "";
    const cst = db.cstNode(cls.id) as CstNodeLike | null;
    if (!cst) continue;

    const findComposition = (node: CstNodeLike | null | undefined): CstNodeLike | null => {
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
              startOffset: targetNode.startIndex ?? targetNode.startOffset ?? 0,
              endOffset: targetNode.endIndex ?? targetNode.endOffset ?? 0,
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
              startOffset: targetNode.startIndex ?? targetNode.startOffset ?? 0,
              endOffset: targetNode.endIndex ?? targetNode.endOffset ?? 0,
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
      const compChildren = compNode.children || [];
      for (let i = 0; i < compChildren.length; i++) {
        const child = compChildren[i]!;
        if (child.text?.trim() === "protected" || child.type === '"protected"') {
          const nextChild = compChildren[i + 1];
          let targetNode: CstNodeLike = child;
          if (nextChild && nextChild.children && nextChild.children.length > 0) {
            const firstElem = nextChild.children[0]!;
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
              startOffset: targetNode.startIndex ?? targetNode.startOffset ?? 0,
              endOffset: targetNode.endIndex ?? targetNode.endOffset ?? 0,
              startPosition: targetNode.startPosition,
              endPosition: targetNode.endPosition,
            },
          });
        }
      }
    }

    // 3. Variable in package must be constant
    if (cleanKind === "package" && !dae.extensionMetadata?.["isOldFrontend"]) {
      const children = db.childrenOf(cls.id);
      for (const child of children) {
        if (child.kind === "Component") {
          const rawVar = (child.metadata as SymbolMetaLike | undefined)?.variability;
          const variability = db.query<string | Variability | null>("variability", child.id);
          const isConst = rawVar === "constant" || variability === "constant" || variability === Variability.Constant;
          if (!isConst) {
            const compCst = db.cstNode(child.id) as CstNodeLike | null;
            let clauseNode = compCst;
            while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
              clauseNode = clauseNode.parent;
            }
            const targetNode = clauseNode ?? compCst;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
              message: ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.message(child.name, cls.name),
              range: targetNode
                ? {
                    startOffset: targetNode.startIndex ?? targetNode.startOffset ?? 0,
                    endOffset: targetNode.endIndex ?? targetNode.endOffset ?? 0,
                    startPosition: targetNode.startPosition,
                    endPosition: targetNode.endPosition,
                  }
                : undefined,
            });
          }
        }
      }
    }
  }
}

export function collectClassImports(
  db: QueryDB,
  cache: Map<SymbolId, Map<string, string>>,
  classId: SymbolId,
  visited: Set<SymbolId> = new Set<SymbolId>(),
): Map<string, string> {
  const cached = cache.get(classId);
  if (cached !== undefined) return new Map(cached);
  const result = new Map<string, string>();
  if (visited.has(classId)) return result;
  visited.add(classId);

  // 1. Parent scope imports
  const sym = db.symbol(classId);
  if (sym && sym.parentId !== null) {
    const parentImports = collectClassImports(db, cache, sym.parentId, visited);
    for (const [k, v] of parentImports) {
      result.set(k, v);
    }
  }

  // 2. Base class imports (via Extends) & 3. Own imports from index
  const children = db.childrenOf(classId);
  for (const ext of children) {
    if (ext.kind !== "Extends") continue;
    const base = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
    const scoped =
      db.query<NameResolverFn | null>("resolveName", classId)?.(ext.name) ??
      db.query<NameResolverFn | null>("resolveSimpleName", classId)?.(ext.name);
    const target = base ?? scoped ?? db.byName(ext.name).find((e) => e.kind === "Class");
    if (target) {
      const baseImports = collectClassImports(db, cache, target.id, visited);
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
        const importCst = db.cstNode(child.id) as SyntaxNode | null;
        if (importCst) {
          const aliasNode = Cst.ImportClause.alias(importCst);
          const importListNode = Cst.ImportClause.importList(importCst);
          if (aliasNode) {
            aliasName = aliasNode.text;
            importKind = "simple";
          } else if (importListNode) {
            importKind = "compound";
          } else if (cstHasUnqualifiedImportWildcard(importCst)) {
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
        const pkgEntry = db.byName(pkgName.split(".")[0] ?? "").find((e) => e.kind === "Package" || e.kind === "Class");
        if (pkgEntry) {
          const resolvedPkg = db.query<(n: string) => { id: number } | null>("resolveName", pkgEntry.id);
          const target = pkgName.includes(".") ? resolvedPkg?.(pkgName.slice(pkgName.indexOf(".") + 1)) : pkgEntry;
          if (target) {
            for (const pkgChild of db.childrenOf(target.id)) {
              if (pkgChild.kind !== "Reference" && pkgChild.kind !== "Import") {
                // MLS §13.2.1.1: An imported name cannot hide a built-in operator or type keyword.
                if (
                  BUILTIN_FUNCTIONS.has(pkgChild.name) ||
                  BUILTIN_VARIABLES.has(pkgChild.name) ||
                  SCALAR_VECTORIZABLE_FUNCTIONS.has(pkgChild.name) ||
                  pkgChild.name === "Real" ||
                  pkgChild.name === "Integer" ||
                  pkgChild.name === "Boolean" ||
                  pkgChild.name === "String"
                ) {
                  continue;
                }
                result.set(pkgChild.name, `${pkgName}.${pkgChild.name}`);
              }
            }
          }
        }
      }
    }
  }

  cache.set(classId, new Map(result));
  return result;
}

export function populateShowAnnotations(db: QueryDB, dae: DAEBuilder, rootClassId: SymbolId): void {
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
    cstNode: CstNodeLike | null | undefined,
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

  const findCompAnnText = (compCst: CstNodeLike | null | undefined): string | null => {
    if (!compCst) return null;
    const walk = (n: CstNodeLike | null | undefined): string | null => {
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
    const fnSymId = (fn as DaeWithExtras).symId ?? db.byName(fn.name.split(".").pop()!)?.[0]?.id;
    const fnCst = fnSymId ? (db.cstNode(fnSymId) as CstNodeLike | null) : null;
    if (!fnCst) continue;
    collectBodyAnnotations(fnCst, fn.equationAnnotations, fn.algorithmAnnotations);
    if (fn.algorithmSections.length > 0 && fn.equationAnnotations.length > 0 && fn.eqCount === 0) {
      fn.algorithmAnnotations.push(...fn.equationAnnotations);
      fn.equationAnnotations.length = 0;
    }
    const fnComps = fnSymId ? db.childrenOf(fnSymId).filter((c) => c.kind === "Component") : [];
    for (let i = 0; i < fn.varCount; i++) {
      const vName = fn.getVarName(i);
      const comp = fnComps.find((c) => c.name === vName);
      if (comp) {
        const ann = findCompAnnText(db.cstNode(comp.id) as CstNodeLike | null);
        if (ann) fn.setVarCadAnnotation(i, `(${ann})`);
      }
    }
  }

  const rootCst = db.cstNode(rootClassId) as CstNodeLike | null;
  if (rootCst) {
    collectBodyAnnotations(rootCst, dae.equationAnnotations, dae.algorithmAnnotations);
  }

  const findClassComp = (cid: SymbolId, name: string): SymbolEntry | null => {
    const inst = db.query<SymbolId[]>("instantiate", cid) ?? [];
    for (const id of inst) {
      const s = db.symbol(id);
      if (s && s.kind === "Component" && s.name === name) return s;
    }
    return db.childrenOf(cid).find((s) => s.kind === "Component" && s.name === name) ?? null;
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
      const ann = findCompAnnText(db.cstNode(comp.id) as CstNodeLike | null);
      if (ann) {
        const afterHide = ann.startsWith("HideResult") ? ann.slice("HideResult".length).trimStart() : "";
        const hideRhs = afterHide.startsWith("=") ? afterHide.slice(1).trim() : "";
        if (hideRhs && !hideRhs.includes("\n") && !hideRhs.includes("\r")) {
          let rhs = hideRhs;
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
      currCid = db.query<SymbolId | null>("classInstance", comp.id) ?? null;
    }
    if (effectiveAnn) {
      dae.setVarCadAnnotation(i, `(${effectiveAnn})`);
    }
  }
}

export function markConditionalParametersFinal(db: QueryDB, dae: DAEBuilder, rootClassId: SymbolId): void {
  const condParamsByClassId = new Map<SymbolId, Set<string>>();
  const condParamsByClassName = new Map<string, Set<string>>();
  const baseClassesOf = new Map<SymbolId, SymbolId[]>();
  const visitedClasses = new Set<SymbolId>();
  const classQueue: SymbolId[] = [rootClassId];

  const extractDirectCondLeaves = (cCst: CstNodeLike | null | undefined): string[] => {
    if (!cCst) return [];
    const rawCText: string = cCst.text ?? "";
    if (!rawCText.includes("if ")) return [];
    const leaves: string[] = [];
    const IGNORED_KEYWORDS = new Set(["if", "true", "false", "not", "and", "or", "then", "else"]);

    const isIdentToken = (tok: string): boolean => {
      if (!tok || IGNORED_KEYWORDS.has(tok)) return false;
      const c0 = tok.charCodeAt(0);
      const isStart = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95;
      if (!isStart) return false;
      for (let i = 1; i < tok.length; i++) {
        const code = tok.charCodeAt(i);
        const ok =
          (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95;
        if (!ok) return false;
      }
      return true;
    };

    const collectCondNodeIdentifiers = (condNode: CstNodeLike | null | undefined): void => {
      if (!condNode) return;
      if (condNode.type === "comment" || condNode.type === "string_comment" || condNode.type === "annotation") {
        return;
      }
      if (condNode.type === "identifier" || condNode.type === "IDENT") {
        const id = (condNode.text ?? "").trim();
        if (isIdentToken(id)) leaves.push(id);
        return;
      }
      if (Array.isArray(condNode.children) && condNode.children.length > 0) {
        for (const ch of condNode.children) {
          collectCondNodeIdentifiers(ch);
        }
        return;
      }
      const leafTxt = stripCommentsAndStrings(condNode.text ?? "").trim();
      if (isIdentToken(leafTxt)) {
        leaves.push(leafTxt);
      }
    };

    if (Array.isArray(cCst.children) && cCst.children.length > 0) {
      const walkOwnDecls = (node: CstNodeLike | null | undefined): void => {
        if (!node) return;
        if (node !== cCst && (node.type === "class_definition" || node.type === "ClassDefinition")) return;
        if (
          node.type === "equation_section" ||
          node.type === "algorithm_section" ||
          node.type === "modification" ||
          node.type === "comment" ||
          node.type === "string_comment" ||
          node.type === "annotation"
        ) {
          return;
        }
        if (node.type === "condition_attribute" || node.type === "ConditionAttribute") {
          collectCondNodeIdentifiers(node);
          return;
        }
        // Handle flat token children inside component_declaration if `condition_attribute` is unboxed
        if (
          (node.type === "component_declaration" || node.type === "component_declaration1") &&
          Array.isArray(node.children)
        ) {
          const hasExplicitCondChild = node.children.some(
            (ch: CstNodeLike | null | undefined) =>
              ch?.type === "condition_attribute" || ch?.type === "ConditionAttribute",
          );
          if (!hasExplicitCondChild) {
            let afterIf = false;
            for (const ch of node.children) {
              if (!ch) continue;
              if (ch.type === "comment" || ch.type === "string_comment" || ch.type === "annotation") break;
              if (!afterIf && (ch.type === "if" || ch.text?.trim() === "if")) {
                afterIf = true;
                continue;
              }
              if (afterIf) {
                collectCondNodeIdentifiers(ch);
              }
            }
            if (afterIf) return;
          }
        }
        for (const ch of node.children || []) {
          walkOwnDecls(ch);
        }
      };
      walkOwnDecls(cCst);
    }
    return leaves;
  };

  while (classQueue.length > 0) {
    const cid = classQueue.pop()!;
    if (visitedClasses.has(cid)) continue;
    visitedClasses.add(cid);
    const cSym = db.symbol(cid) as SymbolEntryWithCaches | null | undefined;
    let cachedInfo = cSym?._cachedCondParamInfo;
    if (!cachedInfo || !Array.isArray(cachedInfo.baseClassIds)) {
      const leaves = extractDirectCondLeaves(db.cstNode(cid) as CstNodeLike | null);
      const baseClassIds: SymbolId[] = [];
      const childClassIds: SymbolId[] = [];
      for (const ch of db.childrenOf(cid)) {
        if (ch.kind === "Extends") {
          const baseSym =
            db.query<SymbolEntry | null>("resolvedBaseClass", ch.id) ??
            db.query<SymbolEntry | null>("extendsTarget", ch.id) ??
            db.byName(ch.name)?.[0];
          if (baseSym?.id) {
            baseClassIds.push(baseSym.id);
            childClassIds.push(baseSym.id);
          }
        } else if (ch.kind === "Component") {
          const targetSym =
            db.query<SymbolId | SymbolEntry | null>("classInstance", ch.id) ??
            db.query<SymbolId | SymbolEntry | null>("resolvedType", ch.id);
          const ci = db.query<ComponentInstanceQueryData | null>("componentInstance", ch.id);
          const tid =
            typeof targetSym === "number"
              ? targetSym
              : (targetSym?.id ??
                (ci?.typeSpecifier ? db.byName(ci.typeSpecifier.split(".").pop()!)?.[0]?.id : undefined));
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
      const sym = db.symbol(cid);
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
      for (const ch of db.childrenOf(cur)) {
        if (ch.kind === "Component" && ch.name === compName) {
          const targetSym =
            db.query<SymbolId | SymbolEntry | null>("classInstance", ch.id) ??
            db.query<SymbolId | SymbolEntry | null>("resolvedType", ch.id);
          const ci = db.query<ComponentInstanceQueryData | null>("componentInstance", ch.id);
          const typeName = ci?.typeSpecifier ? String(ci.typeSpecifier).split(".").pop()! : null;
          const tid =
            typeof targetSym === "number"
              ? targetSym
              : (targetSym?.id ?? (typeName ? db.byName(typeName)?.[0]?.id : undefined) ?? null);
          return { cid: tid, typeName };
        }
        if (ch.kind === "Extends") {
          const baseSym =
            db.query<SymbolEntry | null>("resolvedBaseClass", ch.id) ??
            db.query<SymbolEntry | null>("extendsTarget", ch.id) ??
            db.byName(ch.name)?.[0];
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
    const cleanName = stripArraySubscripts(vName);
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
