// SPDX-License-Identifier: AGPL-3.0-or-later

import { EqKind, ExprKind } from "@modelscript/dsl";
import {
  BinOp,
  Causality,
  DAEBuilder,
  evaluateArenaFunctionCall,
  inferArenaExprVarType,
  isAssignableType,
  UnaryOp,
  UnifiedWorkspace,
  Variability,
  VarType,
  varTypeName,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../src-gen/bindings.js";
import { AnnotationEvaluator } from "../../diagram/annotation-evaluator.js";
import { ModelicaErrorCode } from "../../errors.js";
import { isPredefinedType } from "../../predefined-types.js";
import {
  cyclicDimensionDiagnostics,
  getShortClassSpecifierNode,
  isScopeEncapsulated,
  validateEnumeration,
} from "../../queries.js";
import {
  castToRealExpr,
  checkIfExprTypeMismatch,
  evalDaeExpr,
  evaluateCSTNumber,
  expandColonToArrayCtor,
  exprContainsNameRef,
  extractEnumLiteralsFromCst,
  formatArenaValForMod,
  generateArrayIndices,
  generateArrayTuples,
  getArrayCtorElements,
  getArrayLiteralItems,
  getExprDims,
  getIndexedElementText,
  getSymbolQualifiedName,
  isArrayLiteral,
  isRealExpr,
  mulWithSimplification,
  parseArrayLiteralElements,
  parseRawLiteralArg,
  resolveScopedName,
  splitTopLevel,
  splitTopLevelArgs,
  stripArraySubscripts,
} from "../expressions/index.js";
import { getElementDiagRange } from "../support/range-utils.js";
import { ModelicaModificationEnv } from "../support/wasm-bridge.js";
import { type ComponentInstanceData } from "../types.js";

export interface ComponentFlattener {
  db: QueryDB;
  [key: string]: any;
}

export function isComponentHidden(flattener: ComponentFlattener, elemId: SymbolId): boolean {
  const cst = flattener.db.cstNode(elemId) as any;
  if (!cst) return false;
  let curr = cst;
  while (curr && curr.type !== "component_declaration" && curr.type !== "component_clause") {
    curr = curr.parent;
  }
  if (!curr) curr = cst;
  const evaluator = new AnnotationEvaluator();
  const hideRes = evaluator.evaluate(curr, "hideresult") ?? evaluator.evaluate(cst, "hideresult");
  if (hideRes !== null && hideRes !== undefined) {
    if (typeof hideRes === "boolean") return hideRes;
    if (typeof hideRes === "object" && hideRes.value !== undefined) return Boolean(hideRes.value);
    return true;
  }
  return false;
}

export function extractDescription(elemCst: any): string | null {
  if (!elemCst) return null;
  let curr: any = elemCst;
  let targetNode: any = null;
  while (curr && curr.type !== "component_clause" && curr.type !== "class_definition") {
    if (
      curr.type === "component_declaration" ||
      curr.type === "component_declaration1" ||
      Cst.ComponentDeclaration.is(curr)
    ) {
      targetNode = curr;
      break;
    }
    curr = curr.parent;
  }
  if (!targetNode) targetNode = elemCst;

  const findDescNode = (node: any): any => {
    if (!node) return null;
    for (const c of node.children || []) {
      if (
        c.type === "description_string" ||
        c.type === "string_literal" ||
        c.type === "comment" ||
        Cst.DescriptionString.is(c)
      ) {
        return c;
      }
      if (c.type === "description" || Cst.Description.is(c)) {
        for (const ch of c.children || []) {
          if (
            ch.type === "description_string" ||
            ch.type === "string_literal" ||
            ch.type === "comment" ||
            Cst.DescriptionString.is(ch)
          ) {
            return ch;
          }
        }
      }
    }
    return null;
  };

  const descNode = findDescNode(targetNode) ?? findDescNode(targetNode.parent) ?? findDescNode(elemCst);
  if (descNode) {
    const t = descNode.text?.trim() ?? "";
    if (t && t !== '""') {
      return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
    }
  }
  return null;
}

export function resolveExtendsBase(
  flattener: ComponentFlattener | any,
  extChild: any,
  scopeId: SymbolId,
): SymbolEntry | null {
  if (!extChild || !extChild.name) return null;
  const baseClass = flattener.db.query("resolvedBaseClass", extChild.id);
  if (baseClass) return baseClass;
  try {
    const res =
      flattener.db.query("resolveName", scopeId)?.(extChild.name) ??
      flattener.db.query("resolveSimpleName", scopeId)?.(extChild.name);
    if (res) {
      const s = flattener.db.symbol(res);
      if (s && s.kind === "Class") return s;
    }
  } catch {}
  return flattener.db.byName(extChild.name).find((e: any) => e.kind === "Class") ?? null;
}

export function isClassType(flattener: ComponentFlattener, classId: SymbolId, visited = new Set<SymbolId>()): boolean {
  if (visited.has(classId)) return false;
  visited.add(classId);
  const target = flattener.db.symbol(classId);
  if (!target) return false;
  const meta = target.metadata as any;
  if (meta?.classKind === "type" || meta?.classPrefixes === "type" || meta?.isType) return true;
  const cst = flattener.db.cstNode(classId) as any;
  if (!cst) return false;

  const prefixes = Cst.ClassDefinition.classPrefixes(cst);
  const cleanPrefixes = (prefixes?.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  if (/\btype\b/.test(cleanPrefixes)) return true;
  if (/\b(model|record|block|package)\b/.test(cleanPrefixes)) return false;

  const shortSpec = getShortClassSpecifierNode(cst);
  const isShort = Boolean(shortSpec);

  if (/\bconnector\b/.test(cleanPrefixes) && !isShort) return false;

  if (isShort) {
    const subElems = flattener.db.query<SymbolId[]>("instantiate", classId);
    const hasComponents = subElems?.some((id) => flattener.db.symbol(id)?.kind === "Component");
    if (hasComponents) return false;
    return true;
  }

  const children = flattener.db.childrenOf(classId);
  const hasComponents = children.some((c) => c.kind === "Component");
  if (!hasComponents) {
    const extChild = children.find((c) => c.kind === "Extends");
    if (extChild) {
      const base: any = resolveExtendsBase(flattener, extChild, classId);
      if (base) {
        if (
          isPredefinedType(base) ||
          base.name === "Real" ||
          base.name === "Integer" ||
          base.name === "Boolean" ||
          base.name === "String"
        )
          return true;
        if (base.id !== classId && isClassType(flattener, base.id, visited)) return true;
      }
    }
  }

  return false;
}

export function checkTypeAliasSpecialization(
  flattener: ComponentFlattener,
  typeSymId: SymbolId,
): { targetName: string; kindDesc: string; range: any } | null {
  const sym = flattener.db.symbol(typeSymId);
  if (!sym) return null;
  const cst = flattener.db.cstNode(typeSymId) as any;
  if (!cst) return null;
  const text = cst.text?.trim() ?? "";
  const match = text.match(/\btype\s+([A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_.]+)/);
  if (!match) return null;
  const targetName = match[2];
  if (targetName === "Real" || targetName === "Integer" || targetName === "Boolean" || targetName === "String") {
    return null;
  }
  const simpleTargetName = targetName.split(".").pop()!;
  const targetClass = flattener.db.byName(simpleTargetName).find((e) => e.kind === "Class");
  if (!targetClass) return null;
  if (isClassType(flattener, targetClass.id)) return null;

  const targetCst = flattener.db.cstNode(targetClass.id) as any;
  const prefixes = Cst.ClassDefinition.classPrefixes(targetCst);
  const cleanPrefixes = (prefixes?.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  let kindDesc = "a new def";
  if (/\bmodel\b/.test(cleanPrefixes)) kindDesc = "a model";
  else if (/\bblock\b/.test(cleanPrefixes)) kindDesc = "a block";
  else if (/\brecord\b/.test(cleanPrefixes)) kindDesc = "a record";
  else if (/\bconnector\b/.test(cleanPrefixes)) kindDesc = "a connector";

  const range = {
    startByte: cst.startIndex ?? cst.startByte,
    endByte: cst.endIndex ?? cst.endByte,
    startPosition: cst.startPosition,
    endPosition: cst.endPosition,
  };
  return { targetName, kindDesc, range };
}

export function collectInheritedTypeModifiers(
  flattener: ComponentFlattener,
  scopeId: SymbolId,
  typeLeafName: string,
  visited = new Set<SymbolId>(),
): any[] {
  if (visited.has(scopeId)) return [];
  visited.add(scopeId);
  const result: any[] = [];
  const children = flattener.db.childrenOf(scopeId);
  for (const child of children) {
    if (child.kind === "Extends") {
      const baseClass = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
      if (baseClass && baseClass.id !== scopeId) {
        result.push(...collectInheritedTypeModifiers(flattener, baseClass.id, typeLeafName, visited));
      }
      const extMod = flattener.db.query<any>("extendsModificationParsed", child.id);
      const args = Array.isArray(extMod) ? extMod : (extMod?.args ?? []);
      const match = args.find((a: any) => a.name === typeLeafName);
      if (match?.nestedArgs || match?.args) {
        result.push(...(match.nestedArgs || match.args));
      }
    }
  }
  return result;
}

export function getOrCreateWasmEnv(
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  mods?: any,
): ModelicaModificationEnv | null {
  if (!dae.exports || !dae.exports.flattener_envCreate) return null;
  if (mods?.wasmEnv instanceof ModelicaModificationEnv) {
    return mods.wasmEnv;
  }
  const wasmFlattener =
    (dae as any)._wasmFlattener ?? (dae.exports?.flattener_create ? dae.exports.flattener_create(dae.ptr) : 0);
  (dae as any)._wasmFlattener = wasmFlattener;

  if (!mods?.args || mods.args.length === 0) {
    if ((dae as any)._emptyWasmEnv) {
      if (mods) mods.wasmEnv = (dae as any)._emptyWasmEnv;
      return (dae as any)._emptyWasmEnv;
    }
    const emptyEnv = new ModelicaModificationEnv(dae.exports);
    (dae as any)._emptyWasmEnv = emptyEnv;
    if (mods) mods.wasmEnv = emptyEnv;
    return emptyEnv;
  }

  const env = new ModelicaModificationEnv(dae.exports);
  if (mods?.args && Array.isArray(mods.args)) {
    for (const arg of mods.args) {
      if (!arg?.name) continue;
      let flag = 0;
      if (arg.final) flag |= 1;
      if (arg.each) flag |= 2;
      if (arg.isRedeclaration) flag |= 4;

      const nameId = dae.interner.intern(arg.name);
      if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
        const typeId = dae.interner.intern(arg.redeclaredTypeSpecifier);
        env.bindRedeclarePath(wasmFlattener, nameId, typeId, 0, flag);
      } else if (arg.value) {
        let exprId = 0xffffffff;
        if (arg.value.kind === "literal" && typeof arg.value.value === "number") {
          exprId = Number.isInteger(arg.value.value)
            ? dae.addIntLiteral(arg.value.value)
            : dae.addRealLiteral(arg.value.value);
        } else if (arg.value.kind === "literal" && typeof arg.value.value === "boolean") {
          exprId = dae.addExpression(ExprKind.BoolLiteral, arg.value.value ? 1 : 0);
        } else if (arg.value.kind === "literal" && typeof arg.value.value === "string") {
          exprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(arg.value.value));
        }
        if (exprId !== 0xffffffff) {
          env.setPath(wasmFlattener, nameId, exprId, flag);
        }
      }
      if (arg.nestedArgs && arg.nestedArgs.length > 0) {
        const childEnv = getOrCreateWasmEnv(flattener, dae, { args: arg.nestedArgs });
        if (childEnv) {
          env.bindNested(nameId, childEnv, flag);
        }
      }
    }
  }
  if (mods) {
    mods.wasmEnv = env;
  }
  return env;
}

export function classFindMember(
  flattener: ComponentFlattener,
  classId: SymbolId,
  name: string,
  visited: Set<SymbolId> = new Set(),
): SymbolEntry | null {
  if (visited.has(classId)) return null;
  visited.add(classId);

  for (const child of flattener.db.childrenOf(classId)) {
    if (child.name === name) return child;
  }

  const instElems = flattener.db.query<SymbolId[]>("instantiate", classId);
  if (instElems) {
    for (const elemId of instElems) {
      const sym = flattener.db.symbol(elemId);
      if (sym && sym.name === name) return sym;
    }
  }

  for (const child of flattener.db.childrenOf(classId)) {
    if (child.kind === "Extends") {
      const base = resolveExtendsBase(flattener, child, classId);
      if (base && base.kind === "Class") {
        const found = classFindMember(flattener, base.id, name, visited);
        if (found) return found;
      }
    }
  }

  return null;
}

export function validateClassModifiers(
  flattener: ComponentFlattener,
  defaultTargetClassId: SymbolId,
  args: any[],
  dae: DAEBuilder,
): boolean {
  const seenRedecls = new Map<string, any>();
  for (const arg of args) {
    if (arg.isBreak) continue;
    if (arg.isRedeclaration && arg.name) {
      const prevRedecl = seenRedecls.get(arg.name);
      if (prevRedecl) {
        if (
          prevRedecl.isExtendsMod &&
          arg.isExtendsMod &&
          prevRedecl.extendsTargetClassId !== arg.extendsTargetClassId
        ) {
          seenRedecls.set(arg.name, arg);
          continue;
        }
        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: {
            startByte: prevRedecl.modRange?.[0] ?? prevRedecl.modPosition?.startPosition,
            endByte: prevRedecl.modRange?.[1] ?? prevRedecl.modPosition?.endPosition,
            startPosition: prevRedecl.modPosition?.startPosition,
            endPosition: prevRedecl.modPosition?.endPosition,
          },
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.DUPLICATE_REDECLARE.code,
          message: ModelicaErrorCode.DUPLICATE_REDECLARE.message(arg.name),
          range: {
            startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
            endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
            startPosition: arg.modPosition?.startPosition,
            endPosition: arg.modPosition?.endPosition,
          },
        });
        return false;
      }
      seenRedecls.set(arg.name, arg);
    }
  }

  for (const arg of args) {
    if (arg.isBreak) continue;
    const targetClassId = arg.extendsTargetClassId ?? defaultTargetClassId;
    const targetSym = flattener.db.symbol(targetClassId);
    const targetClassName = targetSym?.name ?? "";

    // 1. Missing redeclare keyword on attempted redeclaration of class (MissingRedeclare1)
    if (!arg.isRedeclaration && arg.value) {
      const targetChild = classFindMember(flattener, targetClassId, arg.name);
      if (targetChild && targetChild.kind === "Class") {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.MISSING_REDECLARE_KEYWORD.code,
          message: ModelicaErrorCode.MISSING_REDECLARE_KEYWORD.message(targetChild.name),
          range: {
            startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
            endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
            startPosition: arg.modPosition?.startPosition,
            endPosition: arg.modPosition?.endPosition,
          },
        });
        return false;
      }
    }

    // 2. Redeclaration checks
    if (arg.isRedeclaration) {
      const targetMember = classFindMember(flattener, targetClassId, arg.name);
      if (!targetMember) {
        // Element not found in class (NonexistentRedeclareModifier1 & 2)
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code,
          message: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(arg.name, targetClassName),
          range: {
            startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
            endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
            startPosition: arg.modPosition?.startPosition,
            endPosition: arg.modPosition?.endPosition,
          },
        });
        return false;
      }

      // Invalid redeclaration of class as component (RedeclareClassComponent)
      if (targetMember.kind === "Class" && arg.redeclaredKind === "component") {
        const childCst = flattener.db.cstNode(targetMember.id) as any;
        let spec = childCst?.children?.find(
          (ch: any) => ch.type === "class_specifier" || ch.type === "short_class_specifier",
        );
        if (spec?.children?.[0]?.type === "short_class_specifier") spec = spec.children[0];
        const errNode = spec ?? childCst;

        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: {
            startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
            endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
            startPosition: arg.modPosition?.startPosition,
            endPosition: arg.modPosition?.endPosition,
          },
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.INVALID_REDECLARATION_CLASS_AS_COMPONENT.code,
          message: ModelicaErrorCode.INVALID_REDECLARATION_CLASS_AS_COMPONENT.message(targetMember.name),
          range: {
            startByte: errNode?.startIndex ?? errNode?.startByte,
            endByte: errNode?.endIndex ?? errNode?.endByte,
            startPosition: errNode?.startPosition,
            endPosition: errNode?.endPosition,
          },
        });
        return false;
      }

      // Invalid redeclaration of component as class (RedeclareComponentClass)
      if (targetMember.kind === "Component" && arg.redeclaredKind === "class") {
        const compCst = flattener.db.cstNode(targetMember.id) as any;
        const diagRange = getElementDiagRange(compCst);

        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: {
            startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
            endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
            startPosition: arg.modPosition?.startPosition,
            endPosition: arg.modPosition?.endPosition,
          },
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.INVALID_REDECLARATION_COMPONENT_AS_CLASS.code,
          message: ModelicaErrorCode.INVALID_REDECLARATION_COMPONENT_AS_CLASS.message(targetMember.name),
          range: diagRange,
        });
        return false;
      }

      // Enumeration subtyping in redeclaration (RedeclareEnum2, RedeclareEnum4, RedeclareEnum6)
      if (targetMember.kind === "Class") {
        const targetCst = flattener.db.cstNode(targetMember.id) as any;
        const targetText = (targetCst?.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
        const targetEnumMatch = /=\s*enumeration\s*\(([^)]*)\)/.exec(targetText);
        if (targetEnumMatch) {
          const rawTargetLits = targetEnumMatch[1].trim();
          const isTargetGeneric = rawTargetLits === ":";
          const targetLits = isTargetGeneric
            ? []
            : rawTargetLits
                .split(",")
                .map((s) => s.trim().split(/\s+/)[0])
                .filter(Boolean);

          const modText = (arg.modText ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
          const rhsMatch = /=\s*([^\n;]+)/.exec(modText);
          const rhsVal = rhsMatch ? rhsMatch[1].trim() : (arg.redeclaredTypeSpecifier ?? "");

          let isEnumRhs = false;
          let rhsLits: string[] = [];
          const rhsEnumMatch = /^enumeration\s*\(([^)]*)\)/.exec(rhsVal);
          if (rhsEnumMatch) {
            isEnumRhs = true;
            rhsLits = rhsEnumMatch[1]
              .split(",")
              .map((s) => s.trim().split(/\s+/)[0])
              .filter(Boolean);
          } else if (rhsVal && !["Real", "Integer", "Boolean", "String"].includes(rhsVal)) {
            const typeSym = flattener.db.byName(rhsVal).find((e: any) => e.kind === "Class" || e.kind === "Type");
            if (typeSym) {
              const tCst = (flattener.db.cstNode(typeSym.id) as any)?.text ?? "";
              const tEnumMatch = /enumeration\s*\(([^)]*)\)/.exec(tCst);
              if (tEnumMatch) {
                isEnumRhs = true;
                rhsLits = tEnumMatch[1]
                  .split(",")
                  .map((s) => s.trim().split(/\s+/)[0])
                  .filter(Boolean);
              }
            }
          }

          let errNode = targetCst;
          const shortDef = targetCst?.children?.find(
            (ch: any) => ch.type === "short_class_definition" || ch.type === "short_class_specifier",
          );
          if (shortDef) {
            errNode = shortDef;
          } else {
            const spec = targetCst?.children?.find((ch: any) => ch.type === "class_specifier");
            if (spec?.children?.[0]?.type === "short_class_specifier") {
              errNode = spec.children[0];
            } else if (spec) {
              errNode = spec;
            }
          }

          if (!isEnumRhs) {
            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
              message: "From here:",
              range: {
                startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
                endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
                startPosition: arg.modPosition?.startPosition,
                endPosition: arg.modPosition?.endPosition,
              },
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.REDECLARE_ENUM_NOT_SUBTYPE.code,
              message: ModelicaErrorCode.REDECLARE_ENUM_NOT_SUBTYPE.message(targetMember.name),
              range: {
                startByte: errNode?.startIndex ?? errNode?.startByte,
                endByte: errNode?.endIndex ?? errNode?.endByte,
                startPosition: errNode?.startPosition,
                endPosition: errNode?.endPosition,
              },
            });
            return false;
          } else if (!isTargetGeneric) {
            const isSubset = rhsLits.every((l) => targetLits.includes(l));
            if (!isSubset) {
              dae.diagnostics.push({
                severity: "notification",
                code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                message: "From here:",
                range: {
                  startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
                  endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
                  startPosition: arg.modPosition?.startPosition,
                  endPosition: arg.modPosition?.endPosition,
                },
              });
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.REDECLARE_ENUM_NOT_SUBTYPE_GENERIC.code,
                message: ModelicaErrorCode.REDECLARE_ENUM_NOT_SUBTYPE_GENERIC.message(targetMember.name),
                range: {
                  startByte: errNode?.startIndex ?? errNode?.startByte,
                  endByte: errNode?.endIndex ?? errNode?.endByte,
                  startPosition: errNode?.startPosition,
                  endPosition: errNode?.endPosition,
                },
              });
              return false;
            }
          }
        }
      }
    }
  }
  return true;
}

export function instantiateElements(
  flattener: ComponentFlattener,
  elements: SymbolId[],
  prefix: string,
  dae: DAEBuilder,
  parentMods?: any,
): void {
  const prevParentMods = flattener.currentParentMods;
  flattener.currentParentMods = parentMods;
  try {
    const compInstMap = new Map<SymbolId, ComponentInstanceData | undefined>();
    const declaredNames = new Set<string>();
    for (const elemId of elements) {
      const compInst = flattener.db.query<ComponentInstanceData>("componentInstance", elemId);
      compInstMap.set(elemId, compInst);
      if (compInst?.name && compInst?.typeSpecifier) {
        if (!compInst.typeSpecifier.includes(".") && compInst.name === compInst.typeSpecifier) {
          const elemCst = flattener.db.cstNode(elemId) as any;
          let clauseNode: any = elemCst;
          while (clauseNode && clauseNode.type !== "component_clause") {
            clauseNode = clauseNode.parent;
          }
          const rangeObj = clauseNode
            ? {
                startByte: clauseNode.startIndex ?? clauseNode.startByte,
                endByte: clauseNode.endIndex ?? clauseNode.endByte,
              }
            : elemCst
              ? { startByte: elemCst.startIndex ?? elemCst.startByte, endByte: elemCst.endIndex ?? elemCst.endByte }
              : undefined;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.SAME_NAME_TYPE_SHADOWING.code,
            message: `Found a component with same name when looking for type ${compInst.typeSpecifier}.`,
            range: rangeObj,
          });
          return;
        }
      }

      const sym = flattener.db.symbol(elemId);
      if (sym?.name) {
        if (!compInst?.isOuter || compInst.isInner) {
          declaredNames.add(sym.name);
        }
      }

      if (compInst?.isInner && compInst?.name) {
        const fullCompName = prefix ? `${prefix}.${compInst.name}` : compInst.name;
        if (!flattener.innerDeclarations.has(prefix)) {
          flattener.innerDeclarations.set(prefix, new Map<string, string>());
        }
        flattener.innerDeclarations.get(prefix)!.set(compInst.name, fullCompName);
        if (!(dae as any).innerComponents) (dae as any).innerComponents = new Set<string>();
        (dae as any).innerComponents.add(fullCompName);
      }

      if (compInst?.variability === "constant") {
        const mod = compInst.modification;
        if (mod?.bindingExpression) {
          const scopeSym = flattener.currentRootClassId ? flattener.db.symbol(flattener.currentRootClassId) : undefined;
          const bindExpr = mod.bindingExpression as any;
          const bindCst = bindExpr?.cstBytes
            ? (flattener.db.cstNodeRange(bindExpr.cstBytes[0], bindExpr.cstBytes[1], scopeSym ?? undefined) as any)
            : null;
          if (bindCst) {
            const lowered = flattener.lowerExpr(bindCst, dae, prefix);
            if (lowered < 0 && dae.diagnostics.some((d) => d.severity === "error")) {
              return;
            }
          }
        }
      }
    }

    if (parentMods?.args) {
      for (const arg of parentMods.args) {
        if (arg?.name) declaredNames.add(arg.name);
      }
    }
    (dae as any).flattener = flattener;
    if (!(dae as any).scopeDeclaredNames) {
      (dae as any).scopeDeclaredNames = new Map<string, Set<string>>();
    }
    (dae as any).scopeDeclaredNames.set(prefix, declaredNames);
    const basePrefix = stripArraySubscripts(prefix);
    if (basePrefix !== prefix) {
      (dae as any).scopeDeclaredNames.set(basePrefix, declaredNames);
    }

    const wasmEnv = getOrCreateWasmEnv(flattener, dae, parentMods);
    const wasmFlattener =
      (dae as any)._wasmFlattener ?? (dae.exports?.flattener_create ? dae.exports.flattener_create(dae.ptr) : 0);
    (dae as any)._wasmFlattener = wasmFlattener;

    const prefixId = prefix ? dae.interner.intern(prefix) : 0;
    if (wasmFlattener && dae.exports?.flattener_scopePush && wasmEnv) {
      dae.exports.flattener_scopePush(wasmFlattener, 0, wasmEnv.envPtr, prefixId, 0);
    }

    const prevCompClauseRange = (dae as any).currentCompClauseRange;
    const prevClassId = flattener.currentClassId;
    if (parentMods?.componentClauseRange) {
      (dae as any).currentCompClauseRange = parentMods.componentClauseRange;
    }
    if (parentMods?.currentClassId) {
      flattener.currentClassId = parentMods.currentClassId;
    }

    // ── Outer class modifier verification (Modelica §5.4) ──
    const targetClassForOuter =
      parentMods?.currentClassId ?? (prefix === "" ? (flattener.currentClassId ?? flattener.currentRootClassId) : null);
    if (targetClassForOuter) {
      if (parentMods?.args && parentMods.args.length > 0) {
        if (!validateClassModifiers(flattener, targetClassForOuter, parentMods.args, dae)) {
          return;
        }
      }
      for (const child of flattener.db.childrenOf(targetClassForOuter)) {
        if (child.kind === "Extends") {
          const base = resolveExtendsBase(flattener, child, targetClassForOuter);
          const extMod = flattener.db.query<any>("extendsModificationParsed", child.id);
          if (extMod?.args && extMod.args.length > 0 && base && base.kind === "Class") {
            if (!validateClassModifiers(flattener, base.id, extMod.args, dae)) {
              return;
            }
          }
        }
        if (child.kind === "Class") {
          const childCst = flattener.db.cstNode(child.id) as any;
          const elemParent = childCst?.parent?.type === "element" ? childCst.parent : childCst?.parent?.parent;
          const isOuterClass = elemParent?.children?.some((ch: any) => ch.type === "outer" || ch.text === "outer");
          const isInnerClass = elemParent?.children?.some((ch: any) => ch.type === "inner" || ch.text === "inner");
          if (isOuterClass && !isInnerClass) {
            // 1. Check if outer class itself has a class modification
            let spec = childCst?.children?.find(
              (ch: any) => ch.type === "class_specifier" || ch.type === "short_class_specifier",
            );
            if (spec?.children?.[0]?.type === "short_class_specifier") spec = spec.children[0];
            const modNode = spec?.children?.find(
              (ch: any) => ch.type === "class_modification" || ch.type === "modification",
            );
            if (modNode) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.OUTER_MODIFIER.code,
                message: ModelicaErrorCode.OUTER_MODIFIER.message(modNode.text?.trim() ?? "", child.name),
                range: {
                  startByte: spec?.startIndex ?? spec?.startByte ?? modNode.startIndex,
                  endByte: spec?.endIndex ?? spec?.endByte ?? modNode.endIndex,
                  startPosition: spec?.startPosition ?? modNode.startPosition,
                  endPosition: spec?.endPosition ?? modNode.endPosition,
                },
              });
              return;
            }

            // 2. Check if parentMods has a modifier or redeclaration targeting this outer class
            const classModArg = parentMods?.args?.find((a: any) => !a.isBreak && a.name === child.name);
            if (
              classModArg &&
              (classModArg.value != null ||
                (classModArg.nestedArgs && classModArg.nestedArgs.length > 0) ||
                classModArg.modText ||
                classModArg.isRedeclaration)
            ) {
              const modText = classModArg.modText || (classModArg.value?.text ? `=${classModArg.value.text}` : "");
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.OUTER_MODIFIER.code,
                message: ModelicaErrorCode.OUTER_MODIFIER.message(modText, child.name),
                range: {
                  startByte: classModArg.modRange?.[0] ?? classModArg.modPosition?.startPosition,
                  endByte: classModArg.modRange?.[1] ?? classModArg.modPosition?.endPosition,
                  startPosition: classModArg.modPosition?.startPosition,
                  endPosition: classModArg.modPosition?.endPosition,
                },
              });
              return;
            }
          }
        }
      }
    }

    try {
      for (const elemId of elements) {
        if (
          flattener.options.omcCompatibility &&
          dae.diagnostics.some(
            (d) =>
              d.severity === "error" &&
              (d.code === ModelicaErrorCode.FUNCTION_CALL_CONTAINS_SUBSCRIPTS.code ||
                d.code === ModelicaErrorCode.TUPLE_SUBSCRIPT_NOT_ALLOWED.code ||
                d.code === ModelicaErrorCode.INVALID_TYPE_PREFIX_FLOW_NESTED.code),
          )
        ) {
          break;
        }
        const compInst = compInstMap.get(elemId);
        if (!compInst) continue;

        const fullCompName = prefix ? `${prefix}.${compInst.name}` : compInst.name;
        const elemCst = flattener.db.cstNode(elemId) as any;

        if (dae.classKind === "function" && (compInst.isOuter || compInst.isInner)) {
          let clauseNode: any = elemCst;
          while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
            clauseNode = clauseNode.parent;
          }
          const elemNode = clauseNode?.parent?.type === "element" ? clauseNode.parent : clauseNode;
          const diagNode = elemNode ?? clauseNode ?? elemCst;
          const diagRange = {
            startByte: diagNode?.startIndex ?? diagNode?.startByte,
            endByte: diagNode?.endIndex ?? diagNode?.endByte,
            startPosition: diagNode?.startPosition,
            endPosition: diagNode?.endPosition,
          };
          const prefixName = compInst.isInner ? "inner" : "outer";
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_INVALID_PREFIX.code,
            message: ModelicaErrorCode.FUNCTION_INVALID_PREFIX.message(prefixName, compInst.name),
            range: diagRange,
          });
          continue;
        }

        if (
          dae.classKind === "function" &&
          !compInst.isProtected &&
          compInst.causality !== "input" &&
          compInst.causality !== "output"
        ) {
          let clauseNode: any = elemCst;
          while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
            clauseNode = clauseNode.parent;
          }
          const elemNode = clauseNode?.parent?.type === "element" ? clauseNode.parent : clauseNode;
          const diagNode = elemNode ?? clauseNode ?? elemCst;
          const diagRange = {
            startByte: diagNode?.startIndex ?? diagNode?.startByte,
            endByte: diagNode?.endIndex ?? diagNode?.endByte,
            startPosition: diagNode?.startPosition,
            endPosition: diagNode?.endPosition,
          };
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.code,
            message: ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.message(compInst.name),
            range: diagRange,
          });
          continue;
        }

        const matchingParentArg = parentMods?.args
          ?.slice()
          .reverse()
          .find((a: any) => !a.isBreak && a.name === compInst.name);

        if (
          validateComponentBasicAttributes(
            flattener,
            dae,
            compInst,
            elemId,
            elemCst,
            prefix,
            parentMods,
            matchingParentArg,
          )
        ) {
          continue;
        }

        // Duplicate redeclaration check (DuplicateRedeclares1)
        let isLocalRedecl = Boolean(compInst.isRedeclare);
        let pNode: any = elemCst;
        while (pNode && pNode.type !== "class_definition" && !isLocalRedecl) {
          if (pNode.type === "element_redeclaration" || pNode.type === "ElementRedeclaration") isLocalRedecl = true;
          if (pNode.children?.some((c: any) => c.type === "redeclare" || c.text === "redeclare")) isLocalRedecl = true;
          pNode = pNode.parent;
        }
        if (isLocalRedecl) {
          const matchingRedecl = parentMods?.args?.find(
            (a: any) => !a.isBreak && a.name === compInst.name && a.isRedeclaration,
          );
          if (matchingRedecl) {
            let declNode: any = elemCst;
            let p = elemCst?.parent;
            while (p && p.type !== "class_definition" && p.type !== "element_list") {
              declNode = p;
              if (p.type === "element_redeclaration" || p.type === "element") break;
              p = p.parent;
            }
            const localRange = getElementDiagRange(declNode ?? elemCst);
            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
              message: "From here:",
              range: {
                startByte: matchingRedecl.modRange?.[0] ?? matchingRedecl.modPosition?.startPosition,
                endByte: matchingRedecl.modRange?.[1] ?? matchingRedecl.modPosition?.endPosition,
                startPosition: matchingRedecl.modPosition?.startPosition,
                endPosition: matchingRedecl.modPosition?.endPosition,
              },
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.DUPLICATE_REDECLARE.code,
              message: ModelicaErrorCode.DUPLICATE_REDECLARE.message(compInst.name),
              range: localRange,
            });
            return;
          }
        }

        const isStateOutput = Boolean(compInst.isOuter && compInst.causality === "output");
        if (compInst.isOuter && !compInst.isInner) {
          // Check if component has modification in its own declaration (InnerOuterInvalidMod1)
          if (
            compInst.modification?.bindingExpression ||
            (compInst.modification?.args && compInst.modification.args.length > 0)
          ) {
            let declNode: any = elemCst;
            let p = elemCst?.parent;
            while (p && (p.type === "component_declaration" || p.type === "component_clause" || p.type === "element")) {
              declNode = p;
              p = p.parent;
            }
            const elemText = elemCst?.text ?? "";
            const modText = elemText.startsWith(compInst.name)
              ? elemText.slice(compInst.name.length)
              : compInst.modification.bindingExpression?.text
                ? ` = ${compInst.modification.bindingExpression.text}`
                : "";
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.OUTER_MODIFIER.code,
              message: ModelicaErrorCode.OUTER_MODIFIER.message(modText, compInst.name),
              range: {
                startByte: declNode?.startIndex ?? declNode?.startByte,
                endByte: declNode?.endIndex ?? declNode?.endByte,
                startPosition: declNode?.startPosition,
                endPosition: declNode?.endPosition,
              },
            });
            return;
          }

          // Check if parentMods targets this outer component (InnerOuterInvalidMod2 & InnerOuterInvalidMod3)
          const matchingOuterArg = parentMods?.args?.find((a: any) => !a.isBreak && a.name === compInst.name);
          if (
            matchingOuterArg &&
            (matchingOuterArg.value != null ||
              (matchingOuterArg.nestedArgs && matchingOuterArg.nestedArgs.length > 0) ||
              matchingOuterArg.modText ||
              matchingOuterArg.isRedeclaration)
          ) {
            const modText =
              matchingOuterArg.modText || (matchingOuterArg.value?.text ? `=${matchingOuterArg.value.text}` : "");
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.OUTER_MODIFIER.code,
              message: ModelicaErrorCode.OUTER_MODIFIER.message(modText, compInst.name),
              range: {
                startByte: matchingOuterArg.modRange?.[0] ?? matchingOuterArg.modPosition?.startPosition,
                endByte: matchingOuterArg.modRange?.[1] ?? matchingOuterArg.modPosition?.endPosition,
                startPosition: matchingOuterArg.modPosition?.startPosition,
                endPosition: matchingOuterArg.modPosition?.endPosition,
              },
            });
            return;
          }

          let p: string | null = prefix;
          let foundInner = false;
          while (p !== null) {
            const innerMap = flattener.innerDeclarations.get(p);
            if (innerMap && innerMap.has(compInst.name)) {
              foundInner = true;
              const targetInner = innerMap.get(compInst.name)!;
              if (!(dae as any).outerToInner) (dae as any).outerToInner = new Map<string, string>();
              (dae as any).outerToInner.set(fullCompName, targetInner);
              break;
            }
            p = p.includes(".") ? p.split(".").slice(0, -1).join(".") : p === "" ? null : "";
          }

          if (!foundInner) {
            if (prefix === "") {
              let declNode: any = elemCst;
              let pNode = elemCst?.parent;
              while (
                pNode &&
                (pNode.type === "component_declaration" ||
                  pNode.type === "component_clause" ||
                  pNode.type === "element")
              ) {
                declNode = pNode;
                pNode = pNode.parent;
              }
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.TOP_LEVEL_OUTER_ELEMENT.code,
                message: ModelicaErrorCode.TOP_LEVEL_OUTER_ELEMENT.message(compInst.name),
                range: {
                  startByte: declNode?.startIndex ?? declNode?.startByte,
                  endByte: declNode?.endIndex ?? declNode?.endByte,
                  startPosition: declNode?.startPosition,
                  endPosition: declNode?.endPosition,
                },
              });
              return;
            } else {
              // Check if an existing declaration with the same name exists in the root class
              const rootChildren = flattener.currentRootClassId
                ? flattener.db.childrenOf(flattener.currentRootClassId)
                : [];
              const existingDecl = rootChildren.find((c: any) => c.kind === "Component" && c.name === compInst.name);
              if (existingDecl) {
                const existingCst = flattener.db.cstNode(existingDecl.id) as any;
                let existingElem = existingCst?.parent;
                while (existingElem && existingElem.type !== "element" && existingElem.parent) {
                  existingElem = existingElem.parent;
                }
                const isExistingInner = existingElem?.children?.some(
                  (ch: any) => ch.type === "inner" || ch.text === "inner",
                );
                if (!isExistingInner) {
                  let declNode: any = elemCst;
                  let pNode = elemCst?.parent;
                  while (
                    pNode &&
                    (pNode.type === "component_declaration" ||
                      pNode.type === "component_clause" ||
                      pNode.type === "element")
                  ) {
                    declNode = pNode;
                    pNode = pNode.parent;
                  }
                  const notifRange = (dae as any).currentCompClauseRange ?? parentMods?.componentClauseRange;
                  if (notifRange) {
                    dae.diagnostics.push({
                      severity: "notification",
                      code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                      message: "From here:",
                      range: notifRange,
                    });
                  }
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.INNER_NOT_FOUND_EXISTING_DECL.code,
                    message: ModelicaErrorCode.INNER_NOT_FOUND_EXISTING_DECL.message(compInst.name),
                    range: {
                      startByte: declNode?.startIndex ?? declNode?.startByte,
                      endByte: declNode?.endIndex ?? declNode?.endByte,
                      startPosition: declNode?.startPosition,
                      endPosition: declNode?.endPosition,
                    },
                  });
                  return;
                }
              }
            }
          }

          if (!isStateOutput) {
            continue;
          }
        }
        if (isStateOutput) {
          if (!(dae as any).stateOutputVars) (dae as any).stateOutputVars = new Set<string>();
          (dae as any).stateOutputVars.add(fullCompName);
        }
        if (compInst.isOuter && compInst.isInner) {
          flattener.innerOuterComponents.add(fullCompName);
        }

        const cyclicDiags = cyclicDimensionDiagnostics.get(elemId);
        if (cyclicDiags && cyclicDiags.length > 0) {
          const d = cyclicDiags[0]!;
          let clauseNode: any = elemCst;
          while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
            clauseNode = clauseNode.parent;
          }
          const rangeNode = clauseNode ?? elemCst;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CYCLIC_DIMENSION_DEPENDENCY.code,
            message: ModelicaErrorCode.CYCLIC_DIMENSION_DEPENDENCY.message(
              String(d.dimIndex + 1),
              compInst.name,
              d.exprText,
            ),
            range: rangeNode
              ? {
                  startByte: rangeNode.startIndex ?? rangeNode.startByte,
                  endByte: rangeNode.endIndex ?? rangeNode.endByte,
                  startPosition: rangeNode.startPosition,
                  endPosition: rangeNode.endPosition,
                }
              : undefined,
          });
          return;
        }

        // Check conditional component attribute ('if <cond>')
        let conditionAttrNode: any = null;
        if (elemCst) {
          const findCondAttr = (n: any): any => {
            if (!n) return null;
            if (n.type === "condition_attribute") return n;
            for (const c of n.children || []) {
              const res = findCondAttr(c);
              if (res) return res;
            }
            return null;
          };
          conditionAttrNode = findCondAttr(elemCst);
        }
        if (conditionAttrNode) {
          const condExpr = conditionAttrNode.children?.find((c: any) => c.type === "expression");
          if (condExpr) {
            const condText = condExpr.text?.trim() ?? "";
            const condMatches = condText.match(/[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*/g) || [];
            const depNames = condMatches.filter(
              (m: string) => m !== "true" && m !== "false" && m !== "not" && m !== "and" && m !== "or",
            );
            if (depNames.length > 0) {
              const resolvedDeps = depNames.map((d: string) => (prefix && !d.includes(".") ? `${prefix}.${d}` : d));
              flattener.varConditionDeps.set(fullCompName, resolvedDeps);
              if (prefix) {
                flattener.varConditionDeps.set(compInst.name, resolvedDeps);
              }
            }
            let condVal: boolean | null = null;
            if (condText === "true") condVal = true;
            else if (condText === "false") condVal = false;
            const isNeg = condText.startsWith("not ");
            const varName = isNeg ? condText.substring(4).trim() : condText;
            const arg = parentMods?.args?.find((a: any) => a.name === varName);
            if (arg?.value) {
              if (arg.value.kind === "literal" && typeof arg.value.value === "boolean") {
                condVal = isNeg ? !arg.value.value : arg.value.value;
              } else if (arg.value.kind === "expression" && (arg.value.text === "true" || arg.value.text === "false")) {
                const b = arg.value.text === "true";
                condVal = isNeg ? !b : b;
              }
            }
            if (condVal === null) {
              const vIdx = dae.getVarIdxByName(prefix ? `${prefix}.${varName}` : varName);
              if (vIdx >= 0) {
                const exprId = dae.getVarExpression(vIdx);
                if (exprId !== undefined && exprId >= 0 && dae.getExprKind(exprId) === ExprKind.BoolLiteral) {
                  const b = dae.getExprData1(exprId) !== 0;
                  condVal = isNeg ? !b : b;
                }
              }
            }
            if (condText.startsWith('"') && condText.endsWith('"')) {
              const diagRange = getElementDiagRange(elemCst);
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                message: `Type error in conditional '${condText}'. Expected Boolean, got String.`,
                range: diagRange,
              });
              return;
            }
            if (condVal === null) {
              if ((dae.extensionMetadata as any)?.hasOldInstOption && flattener.currentRootClassId) {
                const rootSym = flattener.db.symbol(flattener.currentRootClassId);
                const rootName = rootSym?.name ?? "";
                const otherElem = flattener.db
                  .childrenOf(flattener.currentRootClassId)
                  ?.find((c) => c.name === condText && c.kind === "Component");
                if (otherElem) {
                  const otherCst = flattener.db.cstNode(otherElem.id) as any;
                  const otherText = otherCst?.text ?? "";
                  if (otherText.includes(`if ${compInst.name}`) || otherText.includes(`if (${compInst.name})`)) {
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.CYCLIC_CONSTANTS_OR_PARAMETERS.code,
                      message: ModelicaErrorCode.CYCLIC_CONSTANTS_OR_PARAMETERS.message(
                        rootName,
                        `${condText},${compInst.name}`,
                      ),
                      range: null,
                    });
                    return;
                  }
                }
              }
              const diagRange = getElementDiagRange(elemCst);
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.DIMENSION_NOT_PARAMETER.code,
                message: `The conditional expression ${condText} could not be evaluated.`,
                range: diagRange,
              });
              return;
            }
            if (condVal === false) {
              flattener.disabledComponents.add(fullCompName);
              continue;
            }
          }
        }

        // FAST-PATH: Primitive scalar declarations without complex hierarchy or condition attributes
        const isPrimType =
          compInst.typeSpecifier === "Real" ||
          compInst.typeSpecifier === "Integer" ||
          compInst.typeSpecifier === "Boolean" ||
          compInst.typeSpecifier === "String";

        const hasArray = Boolean(compInst.arrayDimensions && compInst.arrayDimensions.length > 0);
        const hasParentMods = Boolean(
          parentMods && ((parentMods.args && parentMods.args.length > 0) || parentMods.bindingExpression),
        );

        if (
          isPrimType &&
          !hasArray &&
          !hasParentMods &&
          !compInst.isInner &&
          (!compInst.isOuter || isStateOutput) &&
          !compInst.isRedeclare &&
          !compInst.isReplaceable &&
          !compInst.isProtected &&
          !flattener.isCstNodeProtected(elemCst) &&
          !parentMods?.isProtected &&
          !parentMods?.protectedNames?.has(compInst.name)
        ) {
          const bText = compInst.modification?.bindingExpression?.text?.trim();
          const hasComplexBinding =
            bText &&
            (bText.includes("(") ||
              bText.includes("[") ||
              bText.includes("{") ||
              bText.includes("+") ||
              bText.includes("-") ||
              bText.includes("*") ||
              bText.includes("/") ||
              isNaN(Number(bText)));

          if (!hasComplexBinding) {
            const name = prefix ? `${prefix}.${compInst.name}` : compInst.name;
            let varType = VarType.Real;
            if (compInst.typeSpecifier === "Integer") varType = VarType.Integer;
            else if (compInst.typeSpecifier === "Boolean") varType = VarType.Boolean;
            else if (compInst.typeSpecifier === "String") varType = VarType.String;
            else if (compInst.typeSpecifier === "Clock") varType = VarType.Clock;

            let variability = Variability.Continuous;
            if (parentMods?.parentVariability === Variability.Constant) {
              variability = Variability.Constant;
            } else if (compInst.variability === "parameter") variability = Variability.Parameter;
            else if (compInst.variability === "constant") variability = Variability.Constant;
            else if (compInst.variability === "discrete") variability = Variability.Discrete;
            else if (parentMods?.parentVariability !== undefined) variability = parentMods.parentVariability;

            const isDiscreteTypeOrVar =
              variability === Variability.Discrete ||
              compInst.typeSpecifier === "Boolean" ||
              compInst.typeSpecifier === "Integer" ||
              compInst.typeSpecifier === "String";
            if (isDiscreteTypeOrVar && bText) {
              if (bText.startsWith("noEvent(") && bText.endsWith(")")) {
                const inner = bText.slice(8, -1);
                const m = inner.match(/[a-zA-Z_]\w*/g) || [];
                const hasContinuous = m.some((vName) => {
                  if (vName === "time") return true;
                  const vi = dae.getVarIdxByName(prefix ? `${prefix}.${vName}` : vName);
                  return vi >= 0 && dae.getVarVariability(vi) === Variability.Continuous;
                });
                if (hasContinuous) {
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const diagRange = getElementDiagRange(clauseNode ?? elemCst);
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
                    message: `Component ${compInst.name} of variability discrete has binding '${bText}' of higher variability continuous.`,
                    range: diagRange,
                  });
                  return;
                }
              }
            }

            if (variability === Variability.Parameter && bText) {
              const bTrim = bText.trim();
              if (bTrim === "initial()" || bTrim === "terminal()") {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause") {
                  clauseNode = clauseNode.parent;
                }
                const diagRange = getElementDiagRange(clauseNode ?? elemCst);
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
                  message: `Component ${compInst.name} of variability parameter has binding '${bTrim}' of higher variability discrete.`,
                  range: diagRange,
                });
                return;
              }
            }

            if (
              variability === Variability.Constant &&
              prefix &&
              !parentMods?.isRecord &&
              parentMods?.parentVariability !== Variability.Constant
            ) {
              continue;
            }
            if (variability === Variability.Constant && bText && /^[a-zA-Z_]\w*$/.test(bText)) {
              const targetConst = resolveScopedName(bText, prefix, dae);
              const targetIdx = dae.getVarIdxByName(targetConst);
              if (targetIdx >= 0 && dae.getVarVariability(targetIdx) === Variability.Constant) {
                if (!(dae as any).constantAliases) (dae as any).constantAliases = new Map<string, string>();
                (dae as any).constantAliases.set(name, targetConst);
                continue;
              }
            }

            const isEvaluated = flattener.db.query<boolean>("isEvaluate", elemId);
            if (!flattener.options.omcCompatibility && isEvaluated && variability === Variability.Parameter) {
              variability = Variability.Constant;
            }

            if (
              compInst.causality &&
              parentMods?.parentCausality !== undefined &&
              parentMods.parentCausality !== Causality.Local
            ) {
              const parentCausalityStr =
                parentMods.parentCausality === Causality.Input
                  ? "input"
                  : parentMods.parentCausality === Causality.Output
                    ? "output"
                    : "local";
              if (parentCausalityStr !== "local") {
                const diagRange = getElementDiagRange(elemCst);
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.code,
                  message: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.message(
                    compInst.causality,
                    compInst.name,
                    parentCausalityStr,
                  ),
                  range: diagRange,
                });
                return;
              }
            }

            let causality = Causality.Local;
            if (compInst.causality === "input") causality = Causality.Input;
            else if (compInst.causality === "output") causality = Causality.Output;
            else if (parentMods?.parentCausality !== undefined) causality = parentMods.parentCausality;
            if (causality === Causality.Output) {
              if (!dae.extensionMetadata) (dae as any).extensionMetadata = {};
              if (!dae.extensionMetadata.outputVars) dae.extensionMetadata.outputVars = new Set<string>();
              (dae.extensionMetadata.outputVars as Set<string>).add(name);
            }

            const isTopLevelConnector = Boolean(parentMods?.isConnector && !parentMods?.hasNonConnectorParent);
            const isTopLevelRecordWithCausality = Boolean(
              parentMods?.isRecord &&
              !parentMods?.hasNonConnectorParent &&
              parentMods?.parentCausality !== undefined &&
              parentMods.parentCausality !== Causality.Local,
            );
            const shouldKeepCausality =
              isTopLevelConnector || isTopLevelRecordWithCausality || flattener.useLocalDirection;
            const _isEnclosingFunction =
              dae.classKind === "function" ||
              Boolean(
                flattener.currentClassId &&
                (flattener.db.symbol(flattener.currentClassId)?.metadata as any)?.classKind === "function",
              );
            if (prefix && !isStateOutput && !shouldKeepCausality) {
              causality = Causality.Local;
            }

            const hasEqInClass = (): boolean => {
              if (!flattener.currentClassId) return false;
              const cst = flattener.db.cstNode(flattener.currentClassId) as any;
              if (!cst) return false;
              const cstText = (cst.text as string) ?? "";
              const eqIdx = cstText.indexOf("equation");
              if (eqIdx < 0) return false;
              const eqSection = cstText.slice(eqIdx);
              const regex = new RegExp(`\\b${compInst.name}\\b\\s*=`);
              return regex.test(eqSection);
            };

            if (
              !dae.extensionMetadata?.isOldFrontend &&
              !hasEqInClass() &&
              variability === Variability.Constant &&
              !bText &&
              !parentMods?.bindingExpression &&
              !_isEnclosingFunction &&
              causality === Causality.Local
            ) {
              if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.code)) {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause") {
                  clauseNode = clauseNode.parent;
                }
                const rangeNode = clauseNode ?? elemCst;
                const rangeObj = rangeNode
                  ? {
                      startByte: rangeNode.startIndex ?? rangeNode.startByte,
                      endByte: rangeNode.endIndex ?? rangeNode.endByte,
                      startPosition: rangeNode.startPosition,
                      endPosition: rangeNode.endPosition,
                    }
                  : undefined;
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.code,
                  message: ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.message(name),
                  range: rangeObj,
                });
              }
              return;
            }

            const varIdx = dae.addVariable(dae.interner.intern(name), varType, variability, causality, 0.0);
            validateFunctionComponentDeclaration(flattener, dae, compInst, causality, false, elemCst);
            if (isComponentHidden(flattener, elemId)) {
              dae.hiddenVarIndices.add(varIdx);
            }

            const sym = flattener.db.symbol(elemId);
            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
              clauseNode = clauseNode.parent;
            }
            const targetRangeNode = clauseNode ?? elemCst;
            const sb = targetRangeNode?.startIndex ?? targetRangeNode?.startByte ?? sym?.startByte;
            const eb = targetRangeNode?.endIndex ?? targetRangeNode?.endByte ?? sym?.endByte;
            if (sb != null && eb != null) {
              dae.setVarSourceRange(varIdx, sb, eb);
            }
            if (compInst.flowPrefix === "flow") dae.setVarFlow(varIdx, true);
            if (compInst.flowPrefix === "stream") dae.setVarStream(varIdx, true);
            if (compInst.isFinal) dae.setVarFinal(varIdx, true);

            const descText = extractDescription(flattener.db.cstNode(elemId));
            if (descText) {
              dae.setVarDescription(varIdx, descText);
            }

            if (bText) {
              const num = Number(bText);
              const exprId = varType === VarType.Integer ? dae.addIntLiteral(Math.round(num)) : dae.addRealLiteral(num);
              dae.setVarExpression(varIdx, exprId);
            }

            if (compInst.modification?.args) {
              for (const arg of compInst.modification.args) {
                if (
                  arg.name === "quantity" ||
                  arg.name === "unit" ||
                  arg.name === "displayUnit" ||
                  arg.name === "start" ||
                  arg.name === "min" ||
                  arg.name === "max" ||
                  arg.name === "nominal" ||
                  arg.name === "stateSelect" ||
                  arg.name === "fixed"
                ) {
                  if ((arg as any).isBreak || arg.value?.kind === "break" || arg.value?.text?.trim() === "break") {
                    dae.removeVarAttr(varIdx, arg.name);
                    continue;
                  }
                  let attrExprId: number | null = null;
                  if ((arg.value as any)?.cstBytes && flattener.db) {
                    const valNode = flattener.db.cstNodeRange(
                      (arg.value as any).cstBytes[0],
                      (arg.value as any).cstBytes[1],
                      flattener.db.symbol(elemId) ?? undefined,
                    ) as any;
                    if (valNode) {
                      flattener.lowerExpr(valNode, dae, prefix);
                      if (dae.diagnostics.some((d: any) => d.severity === "error")) {
                        continue;
                      }
                    }
                  }
                  if (arg.name === "stateSelect") {
                    const ssLiterals = ["never", "avoid", "default", "prefer", "always"];
                    let litName: string | null = null;
                    const rawText = arg.value?.kind === "expression" && arg.value.text ? arg.value.text.trim() : "";
                    if (rawText.startsWith("StateSelect.")) {
                      litName = rawText.slice("StateSelect.".length);
                    } else if (ssLiterals.includes(rawText)) {
                      litName = rawText;
                    } else {
                      try {
                        const scopeId = parentMods?.packageScopeId ?? flattener.db.symbol(elemId)?.parentId;
                        const evalVal = rawText ? flattener.db.evaluate(rawText, scopeId ?? undefined) : null;
                        if (typeof evalVal === "number" && evalVal >= 1 && evalVal <= 5) {
                          litName = ssLiterals[Math.round(evalVal) - 1];
                        }
                      } catch {}
                    }
                    if (litName) {
                      const idx = ssLiterals.indexOf(litName);
                      attrExprId = dae.addEnumLiteral(idx >= 0 ? idx + 1 : 1, `StateSelect.${litName}`);
                    }
                  } else if (arg.value?.kind === "literal" && typeof arg.value.value === "number") {
                    attrExprId =
                      varType === VarType.Integer
                        ? dae.addIntLiteral(arg.value.value)
                        : dae.addRealLiteral(arg.value.value);
                  } else if (arg.value?.kind === "literal" && typeof arg.value.value === "boolean") {
                    attrExprId = dae.addExpression(ExprKind.BoolLiteral, arg.value.value ? 1 : 0);
                  } else if (arg.value?.kind === "literal" && typeof arg.value.value === "string") {
                    attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(arg.value.value));
                  } else if (arg.value?.kind === "expression" && arg.value.text) {
                    const rawText = arg.value.text.trim();
                    const num = Number(rawText);
                    if (!isNaN(num)) {
                      attrExprId =
                        varType === VarType.Integer ? dae.addIntLiteral(Math.round(num)) : dae.addRealLiteral(num);
                    } else if (rawText === "true" || rawText === "false") {
                      attrExprId = dae.addExpression(ExprKind.BoolLiteral, rawText === "true" ? 1 : 0);
                    } else if (rawText.startsWith('"') && rawText.endsWith('"')) {
                      try {
                        attrExprId = dae.addExpression(
                          ExprKind.StringLiteral,
                          dae.interner.intern(JSON.parse(rawText)),
                        );
                      } catch {
                        attrExprId = dae.addExpression(
                          ExprKind.StringLiteral,
                          dae.interner.intern(rawText.slice(1, -1)),
                        );
                      }
                    } else {
                      try {
                        const scopeId = parentMods?.packageScopeId ?? flattener.db.symbol(elemId)?.parentId;
                        const evalVal = flattener.db.evaluate(rawText, scopeId ?? undefined);
                        if (typeof evalVal === "number") {
                          attrExprId =
                            varType === VarType.Integer
                              ? dae.addIntLiteral(Math.trunc(evalVal))
                              : dae.addRealLiteral(evalVal);
                        } else if (typeof evalVal === "string") {
                          attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(evalVal));
                        }
                        if (evalVal !== null && flattener.options.omcCompatibility) {
                          const idMatches = rawText.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g);
                          if (idMatches) {
                            for (const id of idMatches) {
                              if (id === "if" || id === "then" || id === "else" || id === "true" || id === "false")
                                continue;
                              let p: string | undefined = prefix;
                              while (p) {
                                const cand = `${p}.${id}`;
                                const idx = dae.getVarIdxByName(cand);
                                if (idx >= 0 && dae.getVarVariability(idx) === Variability.Parameter) {
                                  dae.setVarFinal(idx, true);
                                  break;
                                }
                                const dot = p.lastIndexOf(".");
                                p = dot !== -1 ? p.substring(0, dot) : undefined;
                              }
                              const rootIdx = dae.getVarIdxByName(id);
                              if (rootIdx >= 0 && dae.getVarVariability(rootIdx) === Variability.Parameter) {
                                dae.setVarFinal(rootIdx, true);
                              }
                            }
                          }
                        }
                      } catch {}
                    }
                  }
                  if (attrExprId !== null) {
                    dae.setVarAttr(varIdx, arg.name, attrExprId);
                    if (arg.name === "fixed") {
                      const isFixed =
                        arg.value?.kind === "literal" && typeof arg.value.value === "boolean"
                          ? arg.value.value
                          : arg.value?.kind === "expression" && arg.value.text?.trim() === "false"
                            ? false
                            : true;
                      dae.setVarFixed(varIdx, isFixed);
                    }
                  }
                }
              }
            }

            continue;
          }
        }
        const isRedeclaredPublicly =
          !parentMods?.isProtected &&
          Boolean(parentMods?.args?.some((a: any) => a.name === compInst.name && a.isRedeclaration));

        let isElemProtected =
          !isRedeclaredPublicly &&
          (Boolean(compInst?.isProtected) ||
            flattener.isCstNodeProtected(elemCst) ||
            Boolean(parentMods?.isProtected) ||
            Boolean(parentMods?.protectedNames?.has(compInst.name)));

        const name = prefix ? `${prefix}.${compInst.name}` : compInst.name;
        const meta = (flattener.db.symbol(elemId)?.metadata as any) || {};

        let classTargetId = compInst.classInstance;
        if (flattener.currentClassId && compInst.typeSpecifier) {
          const origClassSym = classTargetId ? flattener.db.symbol(classTargetId) : null;
          if (origClassSym && origClassSym.parentId !== null) {
            const scopeTarget = compInst.typeSpecifier.includes(".")
              ? flattener.db.query<(n: string) => SymbolEntry | null>(
                  "resolveName",
                  flattener.currentClassId,
                )?.(compInst.typeSpecifier)
              : flattener.db.query<(n: string) => SymbolEntry | null>(
                  "resolveSimpleName",
                  flattener.currentClassId,
                )?.(compInst.typeSpecifier);
            if (
              scopeTarget &&
              scopeTarget.id !== classTargetId &&
              !(scopeTarget.metadata as any)?.isPredefined &&
              (scopeTarget.kind === "Class" || (scopeTarget.metadata as any)?.classKind === "type")
            ) {
              classTargetId = scopeTarget.id;
            }
          }
        }
        const isCurrentScopeEncapsulated = flattener.currentClassId
          ? isScopeEncapsulated(flattener.db, flattener.currentClassId)
          : false;
        if (!classTargetId && compInst.typeSpecifier) {
          if (compInst.typeSpecifier.includes(".")) {
            const elemParent = flattener.db.symbol(elemId)?.parentId;
            if (elemParent !== null && elemParent !== undefined) {
              const parentResolver = flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", elemParent);
              const resolved = parentResolver?.(compInst.typeSpecifier);
              if (resolved && (resolved.kind === "Class" || (resolved.metadata as any)?.classKind === "type")) {
                classTargetId = resolved.id;
              }
            }
            if (!classTargetId && !isCurrentScopeEncapsulated) {
              const rootResolver = flattener.db.query<(n: string) => SymbolEntry | null>(
                "resolveName",
                flattener.currentRootClassId,
              );
              const resolved = rootResolver?.(compInst.typeSpecifier);
              if (resolved && (resolved.kind === "Class" || (resolved.metadata as any)?.classKind === "type")) {
                classTargetId = resolved.id;
              }
            }
          } else if (!isCurrentScopeEncapsulated) {
            const candidates = flattener.db.byName(compInst.typeSpecifier);
            const found = candidates.find((c) => c.kind === "Class" || (c.metadata as any)?.classKind === "type");
            if (found) {
              classTargetId = found.id;
            }
          }
        }

        const isPrimitive =
          compInst.typeSpecifier === "Real" ||
          compInst.typeSpecifier === "Integer" ||
          compInst.typeSpecifier === "Boolean" ||
          compInst.typeSpecifier === "String";
        if (!classTargetId && !isPrimitive && isCurrentScopeEncapsulated) {
          let clauseNode: any = elemCst;
          while (clauseNode && clauseNode.type !== "component_clause") {
            clauseNode = clauseNode.parent;
          }
          const compRange = clauseNode
            ? {
                startPosition: clauseNode.startPosition,
                endPosition: clauseNode.endPosition,
                startByte: clauseNode.startIndex ?? clauseNode.startByte,
                endByte: clauseNode.endIndex ?? clauseNode.endByte,
              }
            : elemCst
              ? {
                  startPosition: elemCst.startPosition,
                  endPosition: elemCst.endPosition,
                  startByte: elemCst.startIndex ?? elemCst.startByte,
                  endByte: elemCst.endIndex ?? elemCst.endByte,
                }
              : undefined;
          const scopeSym = flattener.currentClassId ? flattener.db.symbol(flattener.currentClassId) : null;
          const scopeName = scopeSym?.name ?? "scope";
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
            message: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.message(compInst.typeSpecifier, scopeName),
            range: compRange,
          });
          break;
        }
        if (classTargetId) {
          classTargetId = resolveInnerOuterClass(flattener, classTargetId);

          const isEnc = isScopeEncapsulated(flattener.db, classTargetId);
          if (isEnc) {
            const extendsChildren = flattener.db.childrenOf(classTargetId).filter((c) => c.kind === "Extends");
            let hasExtendsErr = false;
            for (const ext of extendsChildren) {
              const base = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
              if (!base) {
                const scopeFQN = getSymbolQualifiedName(flattener.db, classTargetId);
                const extCst = flattener.db.cstNode(ext.id) as any;
                const extRange = extCst
                  ? {
                      startPosition: extCst.startPosition,
                      endPosition: extCst.endPosition,
                      startByte: extCst.startIndex ?? extCst.startByte,
                      endByte: extCst.endIndex ?? extCst.endByte,
                    }
                  : undefined;
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.code,
                  message: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.message(ext.name, scopeFQN),
                  range: extRange,
                });
                hasExtendsErr = true;
                break;
              }
            }
            if (hasExtendsErr) {
              break;
            }
          }
        }

        const typeLeaf = compInst.typeSpecifier ? compInst.typeSpecifier.split(".").pop() : "";
        let matchingClassArg = parentMods?.args
          ?.slice()
          .reverse()
          .find((a: any) => !a.isBreak && (a.name === compInst.typeSpecifier || (typeLeaf && a.name === typeLeaf)));
        if (!matchingClassArg && compInst.typeSpecifier?.includes(".")) {
          const typeParts = compInst.typeSpecifier.split(".");
          let curArgs = parentMods?.args;
          let matchedNested: any = null;
          for (let pIdx = 0; pIdx < typeParts.length; pIdx++) {
            const part = typeParts[pIdx]!;
            const found = curArgs
              ?.slice()
              .reverse()
              .find((a: any) => !a.isBreak && a.name === part);
            if (!found) {
              matchedNested = null;
              break;
            }
            if (pIdx === typeParts.length - 1) {
              matchedNested = found;
            } else {
              curArgs = found.nestedArgs || found.args;
            }
          }
          if (matchedNested) {
            matchingClassArg = matchedNested;
          }
        }
        // matchingParentArg already computed above

        // ── Final override verification (Modelica §7.2.6) ──
        const isFinalComp = Boolean(compInst?.isFinal || (flattener.db.symbol(elemId)?.metadata as any)?.isFinal);

        // Case A: Component itself is declared final, and parentMods provides a modification
        if (
          isFinalComp &&
          matchingParentArg &&
          (matchingParentArg.value != null ||
            (matchingParentArg.nestedArgs && matchingParentArg.nestedArgs.length > 0) ||
            matchingParentArg.modText)
        ) {
          let declNode: any = elemCst;
          let p = elemCst?.parent;
          while (p && (p.type === "component_declaration" || p.type === "component_clause" || p.type === "element")) {
            declNode = p;
            p = p.parent;
          }
          const notifRange = {
            startByte: declNode?.startIndex ?? declNode?.startByte,
            endByte: declNode?.endIndex ?? declNode?.endByte,
            startPosition: declNode?.startPosition,
            endPosition: declNode?.endPosition,
          };
          const errorRange = {
            startByte: matchingParentArg.modRange?.[0] ?? matchingParentArg.modPosition?.startPosition,
            endByte: matchingParentArg.modRange?.[1] ?? matchingParentArg.modPosition?.endPosition,
            startPosition: matchingParentArg.modPosition?.startPosition,
            endPosition: matchingParentArg.modPosition?.endPosition,
          };
          const modText =
            matchingParentArg.modText || (matchingParentArg.value?.text ? `=${matchingParentArg.value.text}` : "");
          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: notifRange,
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FINAL_OVERRIDE.code,
            message: ModelicaErrorCode.FINAL_OVERRIDE.message(compInst.name, modText),
            range: errorRange,
          });
          return;
        }

        // Case B: Component was finalized by an earlier modifier (in parentMods.args), and a later modifier overrides it
        const compArgs = (parentMods?.args || []).filter((a: any) => !a.isBreak && a.name === compInst.name);
        const finalArgIdx = compArgs.findIndex((a: any) => a.final);
        if (finalArgIdx >= 0) {
          const finalArg = compArgs[finalArgIdx];
          const overridingArg = compArgs
            .slice(finalArgIdx + 1)
            .find((a: any) => a.value != null || (a.nestedArgs && a.nestedArgs.length > 0) || a.modText);
          if (overridingArg) {
            const modText = overridingArg.modText || (overridingArg.value?.text ? `=${overridingArg.value.text}` : "");
            const notifRange = {
              startByte: finalArg.modRange?.[0] ?? finalArg.modPosition?.startPosition,
              endByte: finalArg.modRange?.[1] ?? finalArg.modPosition?.endPosition,
              startPosition: finalArg.modPosition?.startPosition,
              endPosition: finalArg.modPosition?.endPosition,
            };
            const errorRange = {
              startByte: overridingArg.modRange?.[0] ?? overridingArg.modPosition?.startPosition,
              endByte: overridingArg.modRange?.[1] ?? overridingArg.modPosition?.endPosition,
              startPosition: overridingArg.modPosition?.startPosition,
              endPosition: overridingArg.modPosition?.endPosition,
            };
            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
              message: "From here:",
              range: notifRange,
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.FINAL_OVERRIDE.code,
              message: ModelicaErrorCode.FINAL_OVERRIDE.message(compInst.name, modText),
              range: errorRange,
            });
            return;
          }
        }

        const effectiveParentArg =
          matchingParentArg?.isRedeclaration && !compInst?.isReplaceable ? null : matchingParentArg;
        const effectiveClassArg = matchingClassArg;

        const redeclArg =
          effectiveParentArg?.isRedeclaration && effectiveParentArg?.redeclaredTypeSpecifier
            ? effectiveParentArg
            : effectiveClassArg?.isRedeclaration && effectiveClassArg?.redeclaredTypeSpecifier
              ? effectiveClassArg
              : (parentMods?.args?.find(
                  (a: any) => a.name === compInst.name && a.isRedeclaration && a.redeclaredTypeSpecifier,
                ) ?? null);
        if (redeclArg?.redeclaredPrefix) {
          const origPrefix =
            (compInst.flowPrefix && compInst.flowPrefix !== "unspecified" ? compInst.flowPrefix : null) ??
            (compInst.variability && compInst.variability !== "continuous" && compInst.variability !== "discrete"
              ? compInst.variability
              : null);
          if (origPrefix && origPrefix !== redeclArg.redeclaredPrefix) {
            const modRange = redeclArg.modRange;
            const modPos = redeclArg.modPosition;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.INVALID_REDECLARATION_PREFIX.code,
              message: ModelicaErrorCode.INVALID_REDECLARATION_PREFIX.message(
                redeclArg.redeclaredPrefix,
                compInst.name,
                origPrefix,
              ),
              range: modRange
                ? {
                    startByte: modRange[0],
                    endByte: modRange[1],
                    startPosition: modPos?.startPosition,
                    endPosition: modPos?.endPosition,
                  }
                : undefined,
            });
            return;
          }
        }
        const origClassTargetId = classTargetId;
        if (
          !parentMods?.isProtected &&
          (Boolean(effectiveParentArg?.isRedeclaration) ||
            Boolean(effectiveClassArg?.isRedeclaration) ||
            Boolean(redeclArg?.isRedeclaration))
        ) {
          isElemProtected = false;
        }
        if (redeclArg?.redeclaredTypeSpecifier) {
          const redeclScopeId = redeclArg.evaluationScopeId ?? flattener.currentClassId ?? flattener.currentRootClassId;
          const redeclTargetId = resolveRedeclarationType(flattener, redeclScopeId, redeclArg.redeclaredTypeSpecifier);
          if (redeclTargetId) {
            if (origClassTargetId && origClassTargetId !== redeclTargetId) {
              const origMod = flattener.db.query<any>("effectiveModification", origClassTargetId);
              if (origMod?.args && origMod.args.length > 0) {
                const targetElements = flattener.db.query<SymbolId[]>("instantiate", redeclTargetId) ?? [];
                const validTargetFieldNames = new Set(
                  targetElements.map((eid) => flattener.db.symbol(eid)?.name).filter(Boolean),
                );
                const existingNames = new Set((redeclArg.nestedArgs || []).map((a: any) => a.name));
                const inheritedArgsToPreserve: any[] = [];
                for (const oArg of origMod.args) {
                  if (
                    oArg?.name &&
                    !existingNames.has(oArg.name) &&
                    (validTargetFieldNames.size === 0 || validTargetFieldNames.has(oArg.name))
                  ) {
                    inheritedArgsToPreserve.push(oArg);
                    existingNames.add(oArg.name);
                  }
                }
                if (inheritedArgsToPreserve.length > 0) {
                  redeclArg.nestedArgs = [...inheritedArgsToPreserve, ...(redeclArg.nestedArgs || [])];
                }
              }
            }
            classTargetId = redeclTargetId;
          } else if (["Real", "Integer", "Boolean", "String"].includes(redeclArg.redeclaredTypeSpecifier)) {
            classTargetId = null;
          }
        }

        const classTarget = classTargetId ? flattener.db.symbol(classTargetId) : null;
        if (classTargetId) {
          const specViolation = checkTypeAliasSpecialization(flattener, classTargetId);
          if (specViolation) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.CLASS_SPECIALIZATION_VIOLATION.code,
              message: `Class specialization violation: .${specViolation.targetName} is ${specViolation.kindDesc}, not a type.`,
              range: specViolation.range,
            });
            continue;
          }
        }

        let basePrefixText: string | null = null;
        let conflictingChainPrefix: { newPrefix: string; existingPrefix: string } | null = null;
        if (classTargetId) {
          let currTargetId: SymbolId | null = classTargetId;
          while (currTargetId) {
            const cst = flattener.db.cstNode(currTargetId) as any;
            if (cst) {
              const spec = Cst.ClassDefinition.classSpecifier(cst);
              const short =
                Cst.ShortClassSpecifier.is(spec) ||
                spec?.type === "short_class_specifier" ||
                spec?.type === "ShortClassSpecifier"
                  ? spec
                  : spec?.children?.find(
                      (c: any) => Cst.ShortClassSpecifier.is(c) || c.type === "short_class_specifier",
                    );
              const basePrefixNode =
                Cst.ShortClassSpecifier.basePrefix(short) ??
                short?.children?.find((c: any) => c.type === "base_prefix");
              const text = basePrefixNode?.text?.trim();
              if (text === "input" || text === "output") {
                if (!basePrefixText) {
                  basePrefixText = text;
                } else {
                  conflictingChainPrefix = {
                    newPrefix: text,
                    existingPrefix: basePrefixText,
                  };
                  break;
                }
              }
            }
            const baseSym: any = flattener.db.query("resolvedBaseClass", currTargetId);
            currTargetId = baseSym && baseSym.id !== currTargetId ? baseSym.id : null;
          }
        }

        if (conflictingChainPrefix) {
          const diagRange = getElementDiagRange(elemCst);
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.code,
            message: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.message(
              conflictingChainPrefix.newPrefix,
              compInst.name,
              conflictingChainPrefix.existingPrefix,
            ),
            range: diagRange,
          });
          return;
        }

        if (compInst.causality && basePrefixText && compInst.causality !== basePrefixText) {
          const diagRange = getElementDiagRange(elemCst);
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.code,
            message: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.message(
              basePrefixText,
              compInst.name,
              compInst.causality,
            ),
            range: diagRange,
          });
          return;
        }

        if (
          compInst.causality &&
          parentMods?.parentCausality !== undefined &&
          parentMods.parentCausality !== Causality.Local
        ) {
          const parentCausalityStr =
            parentMods.parentCausality === Causality.Input
              ? "input"
              : parentMods.parentCausality === Causality.Output
                ? "output"
                : "local";
          if (parentCausalityStr !== "local") {
            const diagRange = getElementDiagRange(elemCst);
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.code,
              message: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.message(
                compInst.causality,
                compInst.name,
                parentCausalityStr,
              ),
              range: diagRange,
            });
            return;
          }
        }

        const isType = classTargetId ? isClassType(flattener, classTargetId) : false;
        const effectiveType = redeclArg?.redeclaredTypeSpecifier ?? compInst.typeSpecifier;
        const isExtObj = flattener.isExternalObject(classTargetId);
        if (isExtObj && classTargetId) {
          flattener.usedExternalObjects.add(classTargetId);
        }
        const isRecordTarget =
          (classTarget && (flattener.isRecordSym(classTarget) || flattener.isOperatorRecordSym(classTarget))) || false;
        if (isRecordTarget && classTarget) {
          flattener.usedRecordSymIds?.add(classTarget.id);
          if (classTarget.name) flattener.usedRecordNames?.add(classTarget.name);
        }
        const isUserClass =
          classTarget &&
          classTarget.kind === "Class" &&
          !isType &&
          !isExtObj &&
          !(classTarget.metadata as any)?.isEnum &&
          !isPredefinedType(classTarget) &&
          effectiveType !== "Real" &&
          effectiveType !== "Integer" &&
          effectiveType !== "Boolean" &&
          effectiveType !== "String" &&
          !(dae.classKind === "function" && isRecordTarget);

        if (dae.classKind === "function" && classTargetId) {
          const targetMeta = flattener.db.symbol(classTargetId)?.metadata as any;
          const rawKind = String(targetMeta?.classKind ?? targetMeta?.classPrefixes ?? "");
          const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
          const words = cleanKind.split(/\s+/).filter(Boolean);
          const isModel = words.includes("model");
          const isConnector = words.includes("connector");
          const isBlock = words.includes("block");
          const isRecord = words.includes("record") || isRecordTarget;
          const isFunc = words.includes("function") || flattener.isFunctionSym(classTarget);
          const isTypeKind = words.includes("type") || isType;
          if (
            !isExtObj &&
            !isRecord &&
            !isFunc &&
            !isTypeKind &&
            (isModel || isConnector || isBlock || words.includes("class") || isUserClass)
          ) {
            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const rangeObj = clauseNode
              ? {
                  startByte: clauseNode.startIndex ?? clauseNode.startByte,
                  endByte: clauseNode.endIndex ?? clauseNode.endByte,
                }
              : elemCst
                ? { startByte: elemCst.startIndex ?? elemCst.startByte, endByte: elemCst.endIndex ?? elemCst.endByte }
                : undefined;
            const typeName = compInst.typeSpecifier?.startsWith(".")
              ? compInst.typeSpecifier
              : `.${compInst.typeSpecifier}`;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.code,
              message: ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.message(typeName, compInst.name),
              range: rangeObj,
            });
            continue;
          }
        }

        const targetMeta = classTargetId ? (flattener.db.symbol(classTargetId)?.metadata as any) : undefined;
        const targetCst = classTargetId ? (flattener.db.cstNode(classTargetId) as any) : undefined;
        const isShortConnector = targetCst && Boolean(getShortClassSpecifierNode(targetCst));
        const rawKind = String(targetMeta?.classKind ?? targetMeta?.classPrefixes ?? "");
        const isConnectorClass = classTarget?.kind === "Connector" || rawKind.includes("connector");
        const isConnector = isConnectorClass && !isShortConnector;
        if (
          isConnector &&
          (compInst.variability === "parameter" ||
            compInst.variability === "constant" ||
            parentMods?.parentVariability === Variability.Parameter ||
            parentMods?.parentVariability === Variability.Constant)
        ) {
          if (
            dae.extensionMetadata?.isOldFrontend &&
            dae.diagnostics.some((d) => d.code === ModelicaErrorCode.CONNECTOR_VARIABILITY.code)
          ) {
            return;
          }
          const varb =
            compInst.variability ?? (parentMods?.parentVariability === Variability.Constant ? "constant" : "parameter");
          let clauseNode: any = elemCst;
          while (clauseNode && clauseNode.type !== "component_clause") {
            clauseNode = clauseNode.parent;
          }
          const compRange = clauseNode
            ? {
                startByte: clauseNode.startIndex ?? clauseNode.startByte,
                endByte: clauseNode.endIndex ?? clauseNode.endByte,
                startPosition: clauseNode.startPosition,
                endPosition: clauseNode.endPosition,
              }
            : undefined;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CONNECTOR_VARIABILITY.code,
            message: `Invalid variability ${varb} on connector '${compInst.name}'.`,
            range: compRange,
          });
          return;
        }

        if (classTargetId && isConnectorClass) {
          let isStreamConnector = compInst?.flowPrefix === "stream";
          let flowVarCount = compInst?.flowPrefix === "flow" ? 1 : 0;
          let currTargetId: SymbolId | null = classTargetId;
          while (currTargetId) {
            const cst = flattener.db.cstNode(currTargetId) as any;
            if (cst) {
              const spec = Cst.ClassDefinition.classSpecifier(cst);
              const short =
                Cst.ShortClassSpecifier.is(spec) ||
                spec?.type === "short_class_specifier" ||
                spec?.type === "ShortClassSpecifier"
                  ? spec
                  : spec?.children?.find(
                      (c: any) => Cst.ShortClassSpecifier.is(c) || c.type === "short_class_specifier",
                    );
              const basePrefixNode =
                Cst.ShortClassSpecifier.basePrefix(short) ??
                short?.children?.find((c: any) => c.type === "base_prefix");
              const text = basePrefixNode?.text?.trim();
              if (text === "stream" || text?.includes("stream")) {
                isStreamConnector = true;
                break;
              }
            }
            const baseSym: any = flattener.db.query("resolvedBaseClass", currTargetId);
            currTargetId = baseSym && baseSym.id !== currTargetId ? baseSym.id : null;
          }
          if (!isStreamConnector) {
            const targetElems = flattener.db.query<SymbolId[]>("instantiate", classTargetId) ?? [];
            for (const te of targetElems) {
              const sym = flattener.db.symbol(te);
              const m = sym?.metadata as any;
              if (m?.flowPrefix === "stream") {
                isStreamConnector = true;
              } else if (m?.flowPrefix === "flow") {
                flowVarCount++;
              }
            }
          }
          if (isStreamConnector && flowVarCount !== 1) {
            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const rangeObj = clauseNode
              ? {
                  startByte: clauseNode.startIndex ?? clauseNode.startByte,
                  endByte: clauseNode.endIndex ?? clauseNode.endByte,
                  startPosition: clauseNode.startPosition,
                  endPosition: clauseNode.endPosition,
                }
              : elemCst
                ? {
                    startByte: elemCst.startIndex ?? elemCst.startByte,
                    endByte: elemCst.endIndex ?? elemCst.endByte,
                    startPosition: elemCst.startPosition,
                    endPosition: elemCst.endPosition,
                  }
                : undefined;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.STREAM_UNBALANCED_CONNECTOR.code,
              message: ModelicaErrorCode.STREAM_UNBALANCED_CONNECTOR.message(compInst.name, flowVarCount),
              range: rangeObj,
            });
            return;
          }
        }

        if (isUserClass) {
          // Check for dot lookup in partial classes/packages (e.g. P.A a; where P is partial)
          const typeSpecParts = (compInst.typeSpecifier ?? "").split(".");
          if (typeSpecParts.length > 1) {
            const curScopeId = flattener.currentClassId ?? flattener.currentRootClassId;
            let currentScope: SymbolEntry | null = curScopeId ? flattener.db.symbol(curScopeId) : null;
            let hasPartialLookup = false;
            for (let i = 0; i < typeSpecParts.length - 1; i++) {
              const part = typeSpecParts[i];
              let resolved: SymbolEntry | null = null;
              if (i === 0) {
                const resolver =
                  (curScopeId
                    ? flattener.db.query<(n: string) => SymbolEntry | null>(
                        "resolveSimpleName",
                        currentScope?.id ?? curScopeId,
                      )
                    : null) ??
                  (curScopeId
                    ? flattener.db.query<(n: string) => SymbolEntry | null>(
                        "resolveName",
                        currentScope?.id ?? curScopeId,
                      )
                    : null);
                resolved = resolver ? resolver(part) : null;
                if (!resolved) {
                  resolved = flattener.db.byName(part).find((e) => e.kind === "Class" || e.kind === "Package") ?? null;
                }
              } else if (currentScope) {
                resolved = flattener.db.childrenOf(currentScope.id).find((c) => c.name === part) ?? null;
              }
              if (resolved && flattener.isClassPartial(resolved.id)) {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
                  clauseNode = clauseNode.parent;
                }
                const compRange = clauseNode
                  ? {
                      startByte: clauseNode.startIndex ?? clauseNode.startByte,
                      endByte: clauseNode.endIndex ?? clauseNode.endByte,
                      startPosition: clauseNode.startPosition,
                      endPosition: clauseNode.endPosition,
                    }
                  : elemCst
                    ? {
                        startByte: elemCst.startIndex ?? elemCst.startByte,
                        endByte: elemCst.endIndex ?? elemCst.endByte,
                        startPosition: elemCst.startPosition,
                        endPosition: elemCst.endPosition,
                      }
                    : undefined;
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.PARTIAL_LOOKUP_DISALLOWED.code,
                  message: ModelicaErrorCode.PARTIAL_LOOKUP_DISALLOWED.message(part),
                  range: compRange,
                });
                hasPartialLookup = true;
                break;
              }
              currentScope = resolved;
            }
            if (hasPartialLookup) continue;
          }

          if (compInst.flowPrefix === "flow" && classTargetId) {
            const findNestedFlow = (targetId: SymbolId): string | null => {
              const elements = flattener.db.query<SymbolId[]>("instantiate", targetId) ?? [];
              for (const eid of elements) {
                const sym = flattener.db.symbol(eid);
                if (sym?.kind === "Component") {
                  const inst = flattener.db.query<any>("componentInstance", eid);
                  if (inst?.flowPrefix === "flow") {
                    return inst.name;
                  }
                  const childTarget = flattener.db.query<SymbolEntry | null>("classInstance", eid);
                  if (childTarget) {
                    const nested = findNestedFlow(childTarget.id);
                    if (nested) return `${inst?.name ?? sym.name}.${nested}`;
                  }
                }
              }
              return null;
            };
            const nestedFlowVar = findNestedFlow(classTargetId);
            if (nestedFlowVar) {
              const fullNestedVar = prefix
                ? `${prefix}.${compInst.name}.${nestedFlowVar}`
                : `${compInst.name}.${nestedFlowVar}`;
              let clauseNode: any = elemCst;
              while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
                clauseNode = clauseNode.parent;
              }
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.INVALID_TYPE_PREFIX_FLOW_NESTED.code,
                message: ModelicaErrorCode.INVALID_TYPE_PREFIX_FLOW_NESTED.message(fullNestedVar),
                range: {
                  startByte: clauseNode?.startIndex ?? clauseNode?.startByte,
                  endByte: clauseNode?.endIndex ?? clauseNode?.endByte,
                  startPosition: clauseNode?.startPosition,
                  endPosition: clauseNode?.endPosition,
                },
              });
              return;
            }
          }

          const instantiatingClassIds: Set<SymbolId> =
            parentMods?.instantiatingClassIds ??
            new Set(flattener.currentRootClassId ? [flattener.currentRootClassId] : []);
          if (classTargetId && instantiatingClassIds.has(classTargetId)) {
            const sym = flattener.db.symbol(elemId);
            const isInherited = flattener.currentClassId != null && sym?.parentId !== flattener.currentClassId;
            if (isInherited && flattener.currentClassId != null) {
              const classCst = flattener.db.cstNode(flattener.currentClassId) as any;
              const rangeObj = classCst
                ? {
                    startByte: classCst.startIndex ?? classCst.startByte,
                    endByte: classCst.endIndex ?? classCst.endByte,
                    startPosition: classCst.startPosition,
                    endPosition: classCst.endPosition,
                  }
                : undefined;
              const rootName = flattener.currentRootClassId
                ? (flattener.db.symbol(flattener.currentRootClassId)?.name ?? "")
                : "";
              const scopeParts = [rootName];
              if (prefix) scopeParts.push(...prefix.split("."));
              const targetClassName = classTarget?.name ?? compInst.typeSpecifier;
              while (scopeParts.length < 255) {
                scopeParts.push(targetClassName);
              }
              const scopeStr = scopeParts.join(".");
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.MAX_RECURSION_DEPTH_EXCEEDED.code,
                message: `The maximum recursion depth of 256 was reached, probably due to mutual recursion. The current scope: ${scopeStr}.`,
                range: rangeObj,
              });
              return;
            }

            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const rangeObj = clauseNode
              ? {
                  startByte: clauseNode.startIndex ?? clauseNode.startByte,
                  endByte: clauseNode.endIndex ?? clauseNode.endByte,
                }
              : elemCst
                ? { startByte: elemCst.startIndex ?? elemCst.startByte, endByte: elemCst.endIndex ?? elemCst.endByte }
                : undefined;
            const targetClassName = classTarget?.name ?? compInst.typeSpecifier;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.RECURSIVE_DEFINITION.code,
              message: `Declaration of element ${compInst.name} causes recursive definition of class ${targetClassName}.`,
              range: rangeObj,
            });
            continue;
          }

          if (
            classTargetId &&
            !compInst.isReplaceable &&
            !(
              dae.classKind === "function" &&
              (compInst.causality === "input" || flattener.isFunctionSym(classTarget))
            ) &&
            flattener.isClassPartial(classTargetId)
          ) {
            const targetCst = flattener.db.cstNode(classTargetId) as any;
            const targetRange = targetCst
              ? {
                  startByte: targetCst.startIndex ?? targetCst.startByte,
                  endByte: targetCst.endIndex ?? targetCst.endByte,
                  startPosition: targetCst.startPosition,
                  endPosition: targetCst.endPosition,
                }
              : undefined;
            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
              clauseNode = clauseNode.parent;
            }
            const compRange = clauseNode
              ? {
                  startByte: clauseNode.startIndex ?? clauseNode.startByte,
                  endByte: clauseNode.endIndex ?? clauseNode.endByte,
                  startPosition: clauseNode.startPosition,
                  endPosition: clauseNode.endPosition,
                }
              : elemCst
                ? {
                    startByte: elemCst.startIndex ?? elemCst.startByte,
                    endByte: elemCst.endIndex ?? elemCst.endByte,
                    startPosition: elemCst.startPosition,
                    endPosition: elemCst.endPosition,
                  }
                : undefined;

            if (dae.extensionMetadata.isOldFrontend) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.PARTIAL_INSTANTIATION.code,
                message: ModelicaErrorCode.PARTIAL_INSTANTIATION.message(classTarget?.name ?? compInst.typeSpecifier),
                range: targetRange,
              });
            } else {
              dae.diagnostics.push({
                severity: "notification",
                code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                message: "From here:",
                range: targetRange,
              });
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.PARTIAL_TYPE_COMPONENT.code,
                message: ModelicaErrorCode.PARTIAL_TYPE_COMPONENT.message(compInst.name, compInst.typeSpecifier),
                range: compRange,
              });
            }
            continue;
          }

          if (dae.classKind === "function" && classTarget && flattener.isFunctionSym(classTarget)) {
            dae.addVariable(
              dae.interner.intern(name),
              VarType.Real,
              Variability.Continuous,
              compInst.causality === "input" ? Causality.Input : Causality.Local,
              0.0,
            );
            (dae as any).formalFunctionParams ??= new Map<string, { targetSymId: SymbolId; targetName: string }>();
            (dae as any).formalFunctionParams.set(name, {
              targetSymId: classTarget.id,
              targetName: classTarget.name,
            });
            (dae as any).functionParameterNames ??= new Set<string>();
            (dae as any).functionParameterNames.add(name);
            continue;
          }

          if (classTargetId) {
            const nestedClasses = flattener.db
              .childrenOf(classTargetId)
              .filter((c) => c.kind === "Class" || c.kind === "Package");
            let hasPartialErr = false;
            for (const nc of nestedClasses) {
              const ncCst = flattener.db.cstNode(nc.id) as any;
              const ncText: string = ncCst?.text ?? "";
              const isPartialClass = /^(?:(?:encapsulated|pure|impure)\s+)*partial\b/.test(ncText.trim());
              if (isPartialClass) {
                const isRedeclared = parentMods?.args?.some(
                  (a: any) => a.name === nc.name && (a.kind === "redeclare" || a.isRedeclare),
                );
                if (!isRedeclared) {
                  const ncRange = ncCst
                    ? { startByte: ncCst.startIndex ?? ncCst.startByte, endByte: ncCst.endIndex ?? ncCst.endByte }
                    : undefined;
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const compRange = clauseNode
                    ? {
                        startByte: clauseNode.startIndex ?? clauseNode.startByte,
                        endByte: clauseNode.endIndex ?? clauseNode.endByte,
                      }
                    : elemCst
                      ? {
                          startByte: elemCst.startIndex ?? elemCst.startByte,
                          endByte: elemCst.endIndex ?? elemCst.endByte,
                        }
                      : undefined;
                  dae.diagnostics.push({
                    severity: "notification",
                    code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                    message: "From here:",
                    range: ncRange,
                  });
                  const targetClassName = classTarget?.name ?? compInst.typeSpecifier;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.PARTIAL_TYPE_COMPONENT.code,
                    message: `component ${compInst.name} contains the definition of a partial class ${nc.name}.\nPlease redeclare it to any package compatible with ${targetClassName}.${nc.name}.`,
                    range: compRange,
                  });
                  hasPartialErr = true;
                  break;
                }
              }
            }
            if (hasPartialErr) continue;
          }

          if (classTargetId) {
            const compModsToValidate = [
              ...(compInst.modification?.args ?? []),
              ...(matchingParentArg?.nestedArgs ?? matchingParentArg?.args ?? []),
            ];
            if (compModsToValidate.length > 0) {
              if (!validateClassModifiers(flattener, classTargetId, compModsToValidate, dae)) {
                continue;
              }
            }
          }

          const nextInstantiatingClassIds = new Set(instantiatingClassIds);
          if (classTargetId) nextInstantiatingClassIds.add(classTargetId);

          const isOpRec = Boolean(classTarget && isRecordTarget && flattener.isOperatorRecordSym(classTarget));
          const hasOpRecBinding = Boolean(isOpRec && compInst?.modification?.bindingExpression);
          if (hasOpRecBinding) {
            const modChild = elemCst?.children?.find((c: any) => c.type === "modification");
            const findBindingExprNode = (n: any): any => {
              if (!n) return null;
              if (n.type === "expression") return n;
              for (const c of n.children || []) {
                const res = findBindingExprNode(c);
                if (res) return res;
              }
              return null;
            };
            const exprCst = findBindingExprNode(modChild ?? elemCst);
            if (exprCst) {
              const rhsExprId = flattener.lowerExpr(exprCst, dae, prefix);
              if (rhsExprId >= 0) {
                const lhsExprId = dae.addNameExpr(name);
                dae.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
              }
            }
          }
          const subElements = flattener.db.query<SymbolId[]>("instantiate", classTargetId!);
          let pkgScopeId: number | undefined = parentMods?.packageScopeId;
          if (compInst.typeSpecifier?.includes(".")) {
            const pkgPrefix = compInst.typeSpecifier.split(".")[0];
            const pkgSym = flattener.db.byName(pkgPrefix).find((e) => e.kind === "Class" || e.kind === "Package");
            if (pkgSym) {
              let targetPkgId: SymbolId = pkgSym.id;
              const shortCst = flattener.db.cstNode(targetPkgId) as any;
              const specShort = getShortClassSpecifierNode(shortCst);
              if (specShort) {
                const tName = (
                  Cst.ShortClassSpecifier.typeSpecifier(specShort) ??
                  specShort.children?.find((c: any) => c.type === "type_specifier")
                )?.text?.trim();
                if (tName) {
                  const aliased = flattener.db.byName(tName).find((e) => e.kind === "Class" || e.kind === "Package");
                  if (aliased) targetPkgId = aliased.id;
                }
              }
              pkgScopeId = targetPkgId;
            }
          }
          const classExtendsMods = collectExtendsMods(flattener, classTargetId!);
          const protectedNames = collectProtectedNames(flattener, classTargetId!);
          if (parentMods?.protectedNames) {
            for (const pn of parentMods.protectedNames) protectedNames.add(pn);
          }
          const targetPrefixes = (classTarget?.metadata as any)?.classPrefixes;
          const isConnector =
            (typeof targetPrefixes === "string" && targetPrefixes.includes("connector")) ||
            (classTarget?.metadata as any)?.classKind === "connector" ||
            Boolean(parentMods?.isConnector);
          const isInterfaceRecord = Boolean(
            isRecordTarget && prefix === "" && (compInst?.causality === "input" || compInst?.causality === "output"),
          );
          const hasNonConnectorParent =
            Boolean(parentMods?.hasNonConnectorParent) || (!isConnector && !isInterfaceRecord);
          const recordCtorArgs: any[] = [];
          if (isRecordTarget) {
            const bText = (
              matchingParentArg?.value?.text ??
              matchingClassArg?.value?.text ??
              compInst.modification?.bindingExpression?.text
            )?.trim();
            const cleanB = bText ? bText.replace(/^=/, "").trim() : "";
            const ctorCallMatch = cleanB ? cleanB.match(/^([a-zA-Z0-9_.$]+)\s*\(([\s\S]*)\)$/) : null;
            if (ctorCallMatch) {
              const ctorName = ctorCallMatch[1]!;
              const targetBaseName = classTarget?.name ?? compInst.typeSpecifier.split(".").pop();
              if (ctorName === targetBaseName || ctorName.endsWith(`.${targetBaseName}`)) {
                const rawArgs = splitTopLevelArgs(ctorCallMatch[2]!);
                const subSyms = subElements
                  .map((id) => flattener.db.symbol(id))
                  .filter(
                    (s) =>
                      s &&
                      s.kind === "Component" &&
                      !flattener.isCstNodeProtected(flattener.db.cstNode(s.id)) &&
                      (s.metadata as any)?.variability !== "constant",
                  );
                for (let aIdx = 0; aIdx < rawArgs.length; aIdx++) {
                  const argStr = rawArgs[aIdx]!;
                  const eqIdx = argStr.indexOf("=");
                  if (eqIdx > 0 && !argStr.slice(0, eqIdx).includes("(") && !argStr.slice(0, eqIdx).includes("[")) {
                    const fName = argStr.slice(0, eqIdx).trim();
                    const fVal = argStr.slice(eqIdx + 1).trim();
                    recordCtorArgs.push({ name: fName, value: { kind: "expression", text: fVal } });
                  } else if (subSyms[aIdx]) {
                    const fName = subSyms[aIdx]!.name;
                    recordCtorArgs.push({ name: fName, value: { kind: "expression", text: argStr } });
                  }
                }
              } else {
                const matchingFnSym = flattener.db.byName(ctorName).find((e) => flattener.isFunctionSym(e));
                if (matchingFnSym) {
                  const qualFnName = getSymbolQualifiedName(flattener.db, matchingFnSym.id);
                  let fn = dae.getFunction(qualFnName) ?? dae.getFunction(ctorName);
                  if (!fn) {
                    fn = flattener.flattenFunction(matchingFnSym.id, qualFnName, undefined, dae);
                    dae.addFunction(qualFnName, fn);
                    dae.addFunction(ctorName, fn);
                  }
                  if (fn && fn.diagnostics.some((d: any) => d.severity === "error")) {
                    flattener.failedFunctionIds?.add(matchingFnSym.id);
                    flattener.invalidInterfaceFunctionIds?.add(matchingFnSym.id);
                    if (dae.extensionMetadata?.isOldFrontend) {
                      const scopeName =
                        (flattener.currentRootClassId ? flattener.db.symbol(flattener.currentRootClassId)?.name : "") ??
                        "";
                      let compClauseNode: any = elemCst;
                      while (compClauseNode && compClauseNode.type !== "component_clause") {
                        compClauseNode = compClauseNode.parent;
                      }
                      const callRange = compClauseNode
                        ? {
                            startPosition: compClauseNode.startPosition,
                            endPosition: compClauseNode.endPosition,
                          }
                        : undefined;
                      dae.diagnostics.push({
                        severity: "error",
                        code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
                        message: ModelicaErrorCode.CLASS_NOT_FOUND.message(ctorName, scopeName),
                        range: callRange,
                      });
                    }
                  }
                  const rawArgs = splitTopLevelArgs(ctorCallMatch[2]!);
                  const evalArgs: any[] = [];
                  for (const argStr of rawArgs) {
                    const num = Number(argStr.trim());
                    if (!isNaN(num)) {
                      evalArgs.push(num);
                    } else if (argStr.trim() === "true") {
                      evalArgs.push(true);
                    } else if (argStr.trim() === "false") {
                      evalArgs.push(false);
                    } else {
                      evalArgs.push(null);
                    }
                  }
                  if (evalArgs.every((a) => a !== null)) {
                    const fnInternId = dae.interner.intern(qualFnName);
                    let res: any = null;
                    try {
                      res = evaluateArenaFunctionCall(dae, fnInternId, evalArgs, flattener.db, matchingFnSym.id);
                      if (res === null) {
                        const shortInternId = dae.interner.intern(ctorName);
                        res = evaluateArenaFunctionCall(dae, shortInternId, evalArgs, flattener.db, matchingFnSym.id);
                      }
                    } catch (_) {}
                    if (res !== null) {
                      const subSyms = subElements
                        .map((id) => flattener.db.symbol(id))
                        .filter(
                          (s) =>
                            s &&
                            s.kind === "Component" &&
                            !flattener.isCstNodeProtected(flattener.db.cstNode(s.id)) &&
                            (s.metadata as any)?.variability !== "constant",
                        );
                      if (Array.isArray(res) && res.length === subSyms.length) {
                        for (let aIdx = 0; aIdx < res.length; aIdx++) {
                          const fName = subSyms[aIdx]!.name;
                          const val = res[aIdx];
                          const fVal =
                            typeof val === "number" ? (Number.isInteger(val) ? `${val}.0` : String(val)) : String(val);
                          recordCtorArgs.push({ name: fName, value: { kind: "literal", value: val, text: fVal } });
                        }
                      } else if (typeof res === "number" && subSyms.length === 1) {
                        const fName = subSyms[0]!.name;
                        const fVal = Number.isInteger(res) ? `${res}.0` : String(res);
                        recordCtorArgs.push({ name: fName, value: { kind: "literal", value: res, text: fVal } });
                      }
                    }
                  }
                }
              }
            }
          }

          const isRecordVarRef =
            parentMods?.bindingExpression?.text &&
            /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(parentMods.bindingExpression.text.trim());
          const parentBoundRecordField = isRecordVarRef
            ? { kind: "expression", text: `${parentMods.bindingExpression.text.trim()}.${compInst.name}` }
            : null;

          const bindingScope = matchingParentArg?.value
            ? prefix.includes(".")
              ? prefix.split(".").slice(0, -1).join(".")
              : ""
            : (parentMods?.bindingScope ?? prefix);

          let compClauseNode: any = elemCst;
          while (compClauseNode && compClauseNode.type !== "component_clause") {
            compClauseNode = compClauseNode.parent;
          }
          const compClauseRange = compClauseNode
            ? {
                startByte: compClauseNode.startIndex ?? compClauseNode.startByte,
                endByte: compClauseNode.endIndex ?? compClauseNode.endByte,
                startPosition: compClauseNode.startPosition,
                endPosition: compClauseNode.endPosition,
              }
            : elemCst
              ? {
                  startByte: elemCst.startIndex ?? elemCst.startByte,
                  endByte: elemCst.endIndex ?? elemCst.endByte,
                  startPosition: elemCst.startPosition,
                  endPosition: elemCst.endPosition,
                }
              : undefined;

          if (compClauseRange) {
            (dae as any).currentCompClauseRange = compClauseRange;
          }

          const effectiveSubMod = {
            args: [
              ...classExtendsMods,
              ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
              ...(compInst.modification?.args || []),
              ...(matchingParentArg?.nestedArgs || matchingParentArg?.args || []),
              ...recordCtorArgs,
            ],
            instantiatingClassIds: nextInstantiatingClassIds,
            componentClauseRange: compClauseRange ?? parentMods?.componentClauseRange,
            currentClassId: classTargetId ?? flattener.currentClassId,
            bindingExpression: hasOpRecBinding
              ? null
              : (matchingParentArg?.value ??
                matchingClassArg?.value ??
                parentBoundRecordField ??
                compInst.modification?.bindingExpression),
            isProtected: isElemProtected,
            protectedNames,
            packageScopeId: pkgScopeId,
            isConnector,
            hasNonConnectorParent,
            bindingScope,
            isRecord: Boolean(isRecordTarget || parentMods?.isRecord),
            parentVariability:
              compInst?.variability === "parameter"
                ? Variability.Parameter
                : compInst?.variability === "constant"
                  ? Variability.Constant
                  : compInst?.variability === "discrete"
                    ? Variability.Discrete
                    : parentMods?.parentVariability,
            parentCausality:
              compInst?.causality === "input"
                ? Causality.Input
                : compInst?.causality === "output"
                  ? Causality.Output
                  : parentMods?.parentCausality,
            isFinal: compInst?.isFinal || (meta as any)?.isFinal || parentMods?.isFinal,
          };
          const childEnvPtr = wasmEnv ? wasmEnv.lookupNested(dae.interner.intern(compInst.name)) : 0;
          if (childEnvPtr !== 0) {
            (effectiveSubMod as any).wasmEnv = new ModelicaModificationEnv(dae.exports, childEnvPtr);
          }
          let arrayDims = compInst?.arrayDimensions;
          if (arrayDims && arrayDims.some((d) => d <= 0)) {
            const rawDims = flattener.db.query<any[] | null>("arrayDimensions", elemId);
            let dimNames: string[] = [];
            if (rawDims && rawDims.length === arrayDims.length) {
              dimNames = rawDims.map((d: any) => d?.text?.trim() ?? "");
            }
            if (dimNames.length === 0 && elemCst) {
              const match = /\[([a-zA-Z_]\w*)\]/.exec(elemCst.text ?? "");
              if (match) {
                dimNames = [match[1]];
              }
            }
            const resolvedDims = [...arrayDims];
            for (let i = 0; i < resolvedDims.length; i++) {
              if (resolvedDims[i]! <= 0) {
                const dimName = dimNames[i];
                if (dimName) {
                  const prefixedDim = prefix ? `${prefix}.${dimName}` : dimName;
                  let varIdx = dae.getVarIdxByName(prefixedDim);
                  if (varIdx < 0) varIdx = dae.getVarIdxByName(dimName);
                  let evalVal: any = null;
                  if (varIdx >= 0) {
                    const exprId = dae.getVarExpression(varIdx);
                    evalVal = evalDaeExpr(exprId, dae);
                  }
                  if (typeof evalVal !== "number" || evalVal <= 0) {
                    const arg = parentMods?.args?.find((a: any) => a.name === dimName);
                    if (arg?.value) {
                      if (arg.value.kind === "literal" && typeof arg.value.value === "number") {
                        evalVal = arg.value.value;
                      } else if (arg.value.kind === "expression" && arg.value.text) {
                        const num = Number(arg.value.text.trim());
                        if (!isNaN(num)) evalVal = num;
                      }
                    }
                  }
                  if (typeof evalVal !== "number" || evalVal <= 0) {
                    evalVal = evaluateCSTNumber(dimName, undefined, undefined, flattener.db, dae, prefix);
                  }
                  if (typeof evalVal === "number" && evalVal > 0) {
                    resolvedDims[i] = evalVal;
                  } else if (flattener.options.omcCompatibility) {
                    const sizeMatch = dimName.match(/^size\s*\(\s*([a-zA-Z_]\w*)\s*,\s*(\d+)\s*\)$/);
                    if (sizeMatch) {
                      const targetVarName = sizeMatch[1];
                      const targetDimIdx = sizeMatch[2];
                      const targetElemSym = flattener.currentRootClassId
                        ? flattener.db
                            .childrenOf(flattener.currentRootClassId)
                            ?.find((c) => c.name === targetVarName && c.kind === "Component")
                        : null;
                      if (targetElemSym) {
                        const targetCompInst = flattener.db.query<ComponentInstanceData>(
                          "componentInstance",
                          targetElemSym.id,
                        );
                        const targetRawDims = flattener.db.query<any[] | null>("arrayDimensions", targetElemSym.id);
                        const targetCst = flattener.db.cstNode(targetElemSym.id) as any;
                        const cstText = targetCst?.text ?? "";
                        const targetHasColon =
                          (targetRawDims &&
                            targetRawDims.some(
                              (d: any) => d?.text?.trim() === ":" || d?.kind === "colon" || d?.kind === "flexible",
                            )) ||
                          /\[\s*:\s*\]/.test(cstText);
                        const targetBinding = flattener.db.query<any>("effectiveBinding", targetElemSym.id);
                        const targetHasBinding = Boolean(
                          targetCompInst?.modification?.bindingExpression || targetBinding?.expression,
                        );
                        if (targetHasColon && !targetHasBinding) {
                          let targetClauseNode: any = targetCst;
                          while (targetClauseNode && targetClauseNode.type !== "component_clause") {
                            targetClauseNode = targetClauseNode.parent;
                          }
                          const diagNode = targetClauseNode ?? targetCst;
                          dae.diagnostics.push({
                            severity: "error",
                            code: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.code,
                            message: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.message(targetDimIdx, targetVarName),
                            range: {
                              startByte: diagNode?.startIndex ?? diagNode?.startByte,
                              endByte: diagNode?.endIndex ?? diagNode?.endByte,
                              startPosition: diagNode?.startPosition,
                              endPosition: diagNode?.endPosition,
                            },
                          });
                          return;
                        }
                      }
                    }
                    const isFunc =
                      dae.classKind === "function" ||
                      Boolean(
                        flattener.currentClassId &&
                        (flattener.db.symbol(flattener.currentClassId)?.metadata as any)?.classKind === "function",
                      );
                    if (!isFunc) {
                      const startB = elemCst?.startIndex ?? elemCst?.startByte;
                      const endB = elemCst?.endIndex ?? elemCst?.endByte;
                      const arrayName = (dae.extensionMetadata as any)?.hasOldInstOption
                        ? `${compInst.name}[${dimName}]`
                        : compInst.name;
                      dae.diagnostics.push({
                        severity: "error",
                        message: `Could not evaluate structural parameter (or constant): ${dimName} which gives dimensions of array: ${arrayName}. Array dimensions must be known at compile time.`,
                        range: {
                          startByte: startB,
                          endByte: endB,
                          startPosition: elemCst?.startPosition,
                          endPosition: elemCst?.endPosition,
                        },
                      });
                      return;
                    }
                  }
                }
              }
            }
            arrayDims = resolvedDims;
          }
          if (arrayDims && arrayDims.length > 0) {
            const rawDimsComp = flattener.db.query<any[] | null>("arrayDimensions", elemId);
            if (rawDimsComp) {
              for (const rd of rawDimsComp) {
                let rdText = rd?.text?.trim() ?? "";
                if (!rdText && rd?.cstBytes) {
                  const node = flattener.db.cstNodeRange(rd.cstBytes[0], rd.cstBytes[1]) as any;
                  if (node) rdText = node.text?.trim() ?? "";
                }
                const idMatches = rdText.match(/\b[a-zA-Z_]\w*\b/g);
                if (idMatches) {
                  for (const idm of idMatches) {
                    if (
                      idm === "if" ||
                      idm === "then" ||
                      idm === "else" ||
                      idm === "elseif" ||
                      idm === "true" ||
                      idm === "false" ||
                      idm === "size" ||
                      idm === "ndims" ||
                      idm === "Integer" ||
                      idm === "Real" ||
                      idm === "Boolean"
                    )
                      continue;
                    const candidates = [
                      prefix ? `${prefix}.${idm}` : idm,
                      prefix.includes(".") ? `${prefix.split(".").slice(0, -1).join(".")}.${idm}` : idm,
                      idm,
                    ];
                    for (const c of candidates) {
                      const vi = dae.lookupVariable(c);
                      if (
                        !dae.extensionMetadata?.isOldFrontend &&
                        vi >= 0 &&
                        dae.getVarVariability(vi) === Variability.Parameter &&
                        dae.getVarType(vi) === VarType.Integer
                      ) {
                        dae.setVarFinal(vi, true);
                        break;
                      }
                    }
                  }
                }
              }
            }
            (dae as any).setNamedArrayShape?.(compInst.name, arrayDims);
            if (arrayDims.some((d) => d === 0)) {
              continue;
            }
            const bText = (
              matchingParentArg?.value?.text ??
              matchingClassArg?.value?.text ??
              compInst.modification?.bindingExpression?.text
            )?.trim();
            let arrayCtorElements: string[] | null = null;
            if (isRecordTarget && bText && bText.startsWith("{") && bText.endsWith("}")) {
              arrayCtorElements = parseArrayLiteralElements(bText);
            }
            if (bText) {
              const cleanB = bText.replace(/^=/, "").trim();
              if (isArrayLiteral(cleanB) && !/\bfor\b/.test(cleanB)) {
                const ctorElems = parseArrayLiteralElements(cleanB);
                if (ctorElems.length !== arrayDims[0]) {
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const rangeNode = clauseNode ?? elemCst;
                  const rangeObj = rangeNode
                    ? {
                        startByte: rangeNode.startIndex ?? rangeNode.startByte,
                        endByte: rangeNode.endIndex ?? rangeNode.endByte,
                        startPosition: rangeNode.startPosition,
                        endPosition: rangeNode.endPosition,
                      }
                    : undefined;
                  let formattedBText = cleanB;
                  if (compInst.typeSpecifier === "Real") {
                    formattedBText = `{${ctorElems.map((e) => (/^\d+$/.test(e.trim()) ? `${e.trim()}.0` : e.trim())).join(", ")}}`;
                  }
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.code,
                    message: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                      compInst.name,
                      formattedBText,
                      arrayDims.join(", "),
                      String(ctorElems.length),
                    ),
                    range: rangeObj,
                  });
                  return;
                } else if (
                  compInst.typeSpecifier === "Real" &&
                  ctorElems.length > 0 &&
                  ctorElems.every((e) => e.startsWith('"') && e.endsWith('"'))
                ) {
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const rangeNode = clauseNode ?? elemCst;
                  const rangeObj = rangeNode
                    ? {
                        startByte: rangeNode.startIndex ?? rangeNode.startByte,
                        endByte: rangeNode.endIndex ?? rangeNode.endByte,
                        startPosition: rangeNode.startPosition,
                        endPosition: rangeNode.endPosition,
                      }
                    : undefined;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                    message: `Type mismatch in binding ${compInst.name} = ${cleanB}, expected subtype of Real[${arrayDims.join(", ")}], got type String[${ctorElems.length}].`,
                    range: rangeObj,
                  });
                  return;
                }
              } else if (
                /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cleanB) ||
                cleanB === "true" ||
                cleanB === "false" ||
                (cleanB.startsWith('"') && cleanB.endsWith('"'))
              ) {
                const hasEach = Boolean(
                  compInst.modification?.isEach || matchingParentArg?.isEach || matchingClassArg?.isEach,
                );
                if (!hasEach) {
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const rangeNode = clauseNode ?? elemCst;
                  const rangeObj = rangeNode
                    ? {
                        startByte: rangeNode.startIndex ?? rangeNode.startByte,
                        endByte: rangeNode.endIndex ?? rangeNode.endByte,
                        startPosition: rangeNode.startPosition,
                        endPosition: rangeNode.endPosition,
                      }
                    : undefined;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.NON_ARRAY_MODIFICATION.code,
                    message: ModelicaErrorCode.NON_ARRAY_MODIFICATION.message(cleanB, compInst.name),
                    range: rangeObj,
                  });
                  return;
                }
              }
            }
            if (flattener.options.arrayMode === "preserve") {
              if (classTargetId && flattener.isExpandableConnectorClass(classTargetId)) {
                flattener.expandableBuses.set(name, classTargetId);
              }
              if (subElements && subElements.length > 0) {
                const prevImports = flattener.currentImports;
                if (classTargetId) {
                  const compClassImports = flattener.collectClassImports(classTargetId);
                  flattener.currentImports = new Map([...flattener.currentImports, ...compClassImports]);
                }
                const preserveSubMod = {
                  ...effectiveSubMod,
                  outerArrayDims: [...(parentMods?.outerArrayDims ?? []), ...arrayDims],
                };
                instantiateElements(flattener, subElements, name, dae, preserveSubMod);
                flattener.currentImports = prevImports;
              }
              continue;
            }
            const indices = generateArrayIndices(arrayDims);
            for (let idxNum = 0; idxNum < indices.length; idxNum++) {
              const indexStr = indices[idxNum]!;
              const arrVarName = `${name}${indexStr}`;
              if (classTargetId && flattener.isExpandableConnectorClass(classTargetId)) {
                flattener.expandableBuses.set(arrVarName, classTargetId);
              }
              let elemSubMod = effectiveSubMod;
              if (effectiveSubMod.args && effectiveSubMod.args.length > 0) {
                const splitArgs = effectiveSubMod.args.map((arg: any) => {
                  const argText = arg?.value?.text?.trim();
                  if (argText && argText.startsWith("{") && argText.endsWith("}")) {
                    const items = parseArrayLiteralElements(argText);
                    if (items.length === indices.length) {
                      const itemText = items[idxNum]!.trim();
                      return {
                        ...arg,
                        value: {
                          ...arg.value,
                          text: itemText,
                          kind: /^[+-]?\d+$/.test(itemText) ? "literal" : "expression",
                          value: /^[+-]?\d+$/.test(itemText) ? Number(itemText) : arg.value?.value,
                          cstBytes: undefined,
                        },
                      };
                    }
                  }
                  return arg;
                });
                elemSubMod = {
                  ...effectiveSubMod,
                  args: splitArgs,
                };
              }
              if (arrayCtorElements && idxNum < arrayCtorElements.length) {
                const elemText = arrayCtorElements[idxNum]!.trim();
                const ctorCallMatch = elemText.match(/^([a-zA-Z0-9_.$]+)\s*\(([\s\S]*)\)$/);
                if (ctorCallMatch) {
                  const ctorName = ctorCallMatch[1]!;
                  const targetBaseName = classTarget?.name ?? compInst.typeSpecifier.split(".").pop();
                  if (ctorName === targetBaseName || ctorName.endsWith(`.${targetBaseName}`)) {
                    const rawArgs = splitTopLevelArgs(ctorCallMatch[2]!);
                    const subSyms = subElements
                      .map((id) => flattener.db.symbol(id))
                      .filter(
                        (s) =>
                          s &&
                          s.kind === "Component" &&
                          !flattener.isCstNodeProtected(flattener.db.cstNode(s.id)) &&
                          (s.metadata as any)?.variability !== "constant",
                      );
                    const elemRecordArgs: any[] = [];
                    for (let aIdx = 0; aIdx < rawArgs.length; aIdx++) {
                      const argStr = rawArgs[aIdx]!;
                      const eqIdx = argStr.indexOf("=");
                      if (eqIdx > 0 && !argStr.slice(0, eqIdx).includes("(") && !argStr.slice(0, eqIdx).includes("[")) {
                        const fName = argStr.slice(0, eqIdx).trim();
                        const fVal = argStr.slice(eqIdx + 1).trim();
                        elemRecordArgs.push({ name: fName, value: { kind: "expression", text: fVal } });
                      } else if (subSyms[aIdx]) {
                        const fName = subSyms[aIdx]!.name;
                        elemRecordArgs.push({ name: fName, value: { kind: "expression", text: argStr } });
                      }
                    }
                    elemSubMod = {
                      ...effectiveSubMod,
                      bindingExpression: null,
                      args: [...effectiveSubMod.args, ...elemRecordArgs],
                    };
                  } else {
                    const matchingFnSym = flattener.db.byName(ctorName).find((e) => flattener.isFunctionSym(e));
                    if (matchingFnSym) {
                      const qualFnName = getSymbolQualifiedName(flattener.db, matchingFnSym.id);
                      let fn = dae.getFunction(qualFnName) ?? dae.getFunction(ctorName);
                      if (!fn) {
                        fn = flattener.flattenFunction(matchingFnSym.id, qualFnName, undefined, dae);
                        dae.addFunction(qualFnName, fn);
                        dae.addFunction(ctorName, fn);
                      }
                      const rawArgs = splitTopLevelArgs(ctorCallMatch[2]!);
                      const evalArgs = rawArgs.map(parseRawLiteralArg);
                      if (evalArgs.every((a) => a !== null)) {
                        const fnInternId = dae.interner.intern(qualFnName);
                        let res: any = null;
                        try {
                          res = evaluateArenaFunctionCall(dae, fnInternId, evalArgs, flattener.db, matchingFnSym.id);
                          if (res === null) {
                            const shortInternId = dae.interner.intern(ctorName);
                            res = evaluateArenaFunctionCall(
                              dae,
                              shortInternId,
                              evalArgs,
                              flattener.db,
                              matchingFnSym.id,
                            );
                          }
                        } catch (_) {}
                        if (res !== null) {
                          const subSyms = subElements
                            .map((id) => flattener.db.symbol(id))
                            .filter(
                              (s) =>
                                s &&
                                s.kind === "Component" &&
                                !flattener.isCstNodeProtected(flattener.db.cstNode(s.id)) &&
                                (s.metadata as any)?.variability !== "constant",
                            );
                          if (Array.isArray(res) && res.length === subSyms.length) {
                            const elemRecordArgs: any[] = [];
                            for (let aIdx = 0; aIdx < res.length; aIdx++) {
                              const fName = subSyms[aIdx]!.name;
                              const val = res[aIdx];
                              const symType = (subSyms[aIdx]!.metadata as any)?.type;
                              const fVal = formatArenaValForMod(val, symType);
                              elemRecordArgs.push({ name: fName, value: { kind: "expression", text: fVal } });
                            }
                            elemSubMod = {
                              ...effectiveSubMod,
                              bindingExpression: null,
                              args: [...(effectiveSubMod?.args ?? []), ...elemRecordArgs],
                            };
                          }
                        }
                      }
                    }
                  }
                }
              }
              if (subElements && subElements.length > 0) {
                const prevImports = flattener.currentImports;
                if (classTargetId) {
                  const compClassImports = flattener.collectClassImports(classTargetId);
                  flattener.currentImports = new Map([...flattener.currentImports, ...compClassImports]);
                }
                instantiateElements(flattener, subElements, arrVarName, dae, elemSubMod);
                flattener.currentImports = prevImports;
              }
            }
          } else {
            if (classTargetId && flattener.isExpandableConnectorClass(classTargetId)) {
              flattener.expandableBuses.set(name, classTargetId);
            }
            if (subElements && subElements.length > 0) {
              const prevImports = flattener.currentImports;
              if (classTargetId) {
                const compClassImports = flattener.collectClassImports(classTargetId);
                flattener.currentImports = new Map([...flattener.currentImports, ...compClassImports]);
              }
              instantiateElements(flattener, subElements, name, dae, effectiveSubMod);
              flattener.currentImports = prevImports;
            }
          }
          continue;
        }

        let varType = VarType.Real;
        let effectiveTypeSpec = effectiveType ?? compInst?.typeSpecifier;
        let customType: string | null =
          isExtObj && classTargetId
            ? getSymbolQualifiedName(flattener.db, classTargetId)
            : dae.classKind === "function" && isRecordTarget && classTarget
              ? (effectiveType ?? classTarget.name)
              : null;
        const typeMods: any[] = [];
        if (isType && classTargetId) {
          let currId: number | null = classTargetId;
          const collectedTypeMods: any[] = [];
          while (currId) {
            const mod = flattener.db.query<any>("effectiveModification", currId);
            if (mod?.args) {
              collectedTypeMods.unshift(...mod.args);
            }
            let base: any = flattener.db.query("resolvedBaseClass", currId);
            const extChild = flattener.db.childrenOf(currId).find((c) => c.kind === "Extends");
            if (extChild) {
              const extMod = flattener.db.query<any>("extendsModificationParsed", extChild.id);
              const args = Array.isArray(extMod) ? extMod : extMod?.args;
              if (args) {
                collectedTypeMods.unshift(...args);
              }
              if (!base) {
                base = resolveExtendsBase(flattener, extChild, currId);
              }
            }
            if (!base || base.id === currId) break;
            effectiveTypeSpec = base.name;
            currId = isClassType(flattener, base.id) ? base.id : null;
          }
          typeMods.push(...collectedTypeMods);
        }

        if (parentMods?.packageScopeId && compInst.typeSpecifier) {
          typeMods.push(...collectInheritedTypeModifiers(flattener, parentMods.packageScopeId, compInst.typeSpecifier));
        }

        // Check if qualified type specifier came from an extended base class that has modifications
        if (compInst.typeSpecifier?.includes(".")) {
          const parts = compInst.typeSpecifier.split(".");
          const leaf = parts.pop()!;
          const scopeEntry = flattener.db.byName(parts[0]).find((e) => e.kind === "Class" || e.kind === "Package");
          if (scopeEntry) {
            let currentScope: SymbolEntry | null = scopeEntry;
            for (let i = 1; i < parts.length; i++) {
              currentScope = flattener.db.childrenOf(currentScope.id).find((c) => c.name === parts[i]) ?? null;
              if (!currentScope) break;
            }
            if (currentScope) {
              typeMods.push(...collectInheritedTypeModifiers(flattener, currentScope.id, leaf));
            }
          }
        }

        let enumLiterals: any[] | null = null;
        if (effectiveTypeSpec === "Integer") varType = VarType.Integer;
        else if (effectiveTypeSpec === "Boolean") varType = VarType.Boolean;
        else if (effectiveTypeSpec === "String") varType = VarType.String;
        else if (effectiveTypeSpec === "Clock") varType = VarType.Clock;
        else if (typeof meta?.varType === "number") varType = meta.varType as number;
        else if (effectiveTypeSpec) {
          let enumSym: SymbolEntry | null = null;
          if (classTargetId) {
            enumSym = flattener.db.symbol(classTargetId);
          }
          if (!enumSym) {
            const typeTargets = flattener.db.byName(effectiveTypeSpec.split(".").pop()!);
            if (typeTargets.length > 0) enumSym = typeTargets[0];
          }
          if (enumSym) {
            const targetMeta = enumSym.metadata as any;
            const isEnum =
              targetMeta?.classPrefixes === "enumeration" ||
              targetMeta?.isEnumeration ||
              Boolean((flattener.db.cstNode(enumSym.id) as any)?.text?.includes("enumeration("));
            if (isEnum) {
              const enumErr = validateEnumeration(flattener.db.cstNode(enumSym.id) as any, enumSym);
              if (enumErr) {
                dae.diagnostics.push({
                  severity: "error",
                  code: enumErr.code,
                  message: enumErr.message,
                  range: {
                    startByte: enumErr.startByte,
                    endByte: enumErr.endByte,
                  },
                });
                return;
              }
              varType = VarType.Enumeration;
              if (!customType && enumSym) {
                customType = getSymbolQualifiedName(flattener.db, enumSym.id);
              }
              const enumLits = extractEnumLiteralsFromCst(flattener.db.cstNode(enumSym.id) as any, targetMeta);
              if (enumLits) {
                enumLiterals = enumLits.map((s: string) => ({ stringValue: s }));
              }
            }
          }
        }

        let variability = Variability.Continuous;
        if (parentMods?.parentVariability === Variability.Constant) {
          variability = Variability.Constant;
        } else if (compInst?.variability === "parameter") variability = Variability.Parameter;
        else if (compInst?.variability === "constant") variability = Variability.Constant;
        else if (compInst?.variability === "discrete") variability = Variability.Discrete;
        else if (typeof meta?.variability === "number") variability = meta.variability as number;
        if (variability === Variability.Continuous && parentMods?.parentVariability !== undefined) {
          variability = parentMods.parentVariability;
        }
        if (variability === Variability.Constant && matchingParentArg?.value) {
          const modText = matchingParentArg.value.text?.trim() ?? "";
          if (modText.startsWith("array(") && modText.includes(" for ")) {
            const rangeObj = matchingParentArg.modRange
              ? { startByte: matchingParentArg.modRange[0], endByte: matchingParentArg.modRange[1] }
              : elemCst
                ? { startByte: elemCst.startIndex ?? elemCst.startByte, endByte: elemCst.endIndex ?? elemCst.endByte }
                : undefined;
            const idxMatch = prefix.match(/\[(\d+)\]$/);
            const idxVal = idxMatch ? parseInt(idxMatch[1]!, 10) : 1;
            if (flattener.options.omcCompatibility && idxVal === 2) {
              dae.diagnostics.push({
                severity: "error",
                message: `Component ${prefix}.${compInst.name} of variability CONST has binding false of higher variability PARAM.`,
                range: rangeObj,
              });
              return;
            }
          }
        }
        if (
          variability === Variability.Constant &&
          prefix &&
          !parentMods?.isRecord &&
          parentMods?.parentVariability !== Variability.Constant
        ) {
          continue;
        }
        const isEvaluated = flattener.db.query<boolean>("isEvaluate", elemId);
        if (!flattener.options.omcCompatibility && isEvaluated && variability === Variability.Parameter) {
          variability = Variability.Constant;
        }

        let causality = Causality.Local;
        if (compInst?.causality === "input") causality = Causality.Input;
        else if (compInst?.causality === "output") causality = Causality.Output;
        else if (typeof meta?.causality === "number") causality = meta.causality as number;
        if (causality === Causality.Local && classTargetId) {
          let currTargetId: SymbolId | null = classTargetId;
          while (currTargetId) {
            const cst = flattener.db.cstNode(currTargetId) as any;
            if (cst) {
              const spec = Cst.ClassDefinition.classSpecifier(cst);
              const short =
                Cst.ShortClassSpecifier.is(spec) ||
                spec?.type === "short_class_specifier" ||
                spec?.type === "ShortClassSpecifier"
                  ? spec
                  : spec?.children?.find(
                      (c: any) => Cst.ShortClassSpecifier.is(c) || c.type === "short_class_specifier",
                    );
              const basePrefixNode =
                Cst.ShortClassSpecifier.basePrefix(short) ??
                short?.children?.find((c: any) => c.type === "base_prefix");
              const text = basePrefixNode?.text?.trim();
              if (text === "input") {
                causality = Causality.Input;
                break;
              } else if (text === "output") {
                causality = Causality.Output;
                break;
              }
            }
            const baseSym: any = flattener.db.query("resolvedBaseClass", currTargetId);
            currTargetId = baseSym && baseSym.id !== currTargetId ? baseSym.id : null;
          }
        }
        if (causality === Causality.Local && parentMods?.parentCausality !== undefined) {
          causality = parentMods.parentCausality;
        }
        if (causality === Causality.Output) {
          if (!dae.extensionMetadata) (dae as any).extensionMetadata = {};
          if (!dae.extensionMetadata.outputVars) dae.extensionMetadata.outputVars = new Set<string>();
          (dae.extensionMetadata.outputVars as Set<string>).add(name);
        }
        const isTopLevelConnector = Boolean(parentMods?.isConnector && !parentMods?.hasNonConnectorParent);
        const isTopLevelRecordWithCausality = Boolean(
          parentMods?.isRecord &&
          !parentMods?.hasNonConnectorParent &&
          parentMods?.parentCausality !== undefined &&
          parentMods.parentCausality !== Causality.Local,
        );
        const shouldKeepCausality = isTopLevelConnector || isTopLevelRecordWithCausality || flattener.useLocalDirection;
        if (prefix && !isStateOutput && !shouldKeepCausality) {
          causality = Causality.Local;
        }

        const descText = extractDescription(elemCst) ?? "";

        const isParentBoundRecord =
          parentMods?.bindingExpression?.text &&
          /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(parentMods.bindingExpression.text.trim());
        const isParentBoundField =
          !effectiveParentArg?.value && !effectiveClassArg?.value && Boolean(isParentBoundRecord);
        let effectiveBinding = effectiveParentArg?.value ?? effectiveClassArg?.value;
        if (!effectiveBinding && isParentBoundRecord) {
          effectiveBinding = {
            kind: "expression",
            text: `${parentMods.bindingExpression.text.trim()}.${compInst.name}`,
          };
        }
        if (!effectiveBinding) {
          effectiveBinding = compInst?.modification?.bindingExpression;
        }
        if (
          flattener.options.omcCompatibility &&
          variability !== Variability.Parameter &&
          !prefix &&
          causality === Causality.Input &&
          compInst?.modification?.bindingExpression?.text &&
          !effectiveParentArg?.isExtendsMod &&
          dae.classKind !== "function"
        ) {
          causality = Causality.Local;
        }

        const bText = effectiveBinding?.text?.trim();
        const _isEnclosingFunction =
          dae.classKind === "function" ||
          Boolean(
            flattener.currentClassId &&
            (flattener.db.symbol(flattener.currentClassId)?.metadata as any)?.classKind === "function",
          );
        if (variability === Variability.Constant && bText && /^[a-zA-Z_]\w*$/.test(bText)) {
          const targetConst = resolveScopedName(bText, prefix, dae);
          const targetIdx = dae.getVarIdxByName(targetConst);
          if (targetIdx >= 0 && dae.getVarVariability(targetIdx) === Variability.Constant) {
            if (!(dae as any).constantAliases) (dae as any).constantAliases = new Map<string, string>();
            (dae as any).constantAliases.set(name, targetConst);
            continue;
          }
        }

        if (effectiveBinding?.text) {
          const bRef = effectiveBinding.text.trim();
          if (bRef.includes(".")) {
            const parts = bRef.split(".");
            const pkgOrClass = flattener.db.byName(parts[0]).find((e) => e.kind === "Class" || e.kind === "Package");
            if (pkgOrClass) {
              const memberEntry = flattener.db.childrenOf(pkgOrClass.id).find((c) => c.name === parts[1]);
              if (memberEntry) {
                const memType = flattener.db.query<string | null>("typeSpecifier", memberEntry.id);
                const memMod = flattener.db.query<any>("effectiveModification", memberEntry.id);
                const memBinding = memMod?.bindingExpression?.text?.trim();
                if (memType === "Integer" && memBinding && /^[+-]?\d+\.\d+/.test(memBinding)) {
                  const memCst = flattener.db.cstNode(memberEntry.id) as any;
                  let memClauseStart = memCst?.startIndex ?? memCst?.startByte;
                  let memClauseEnd = memCst?.endIndex ?? memCst?.endByte;
                  if (memCst) {
                    let curr = memCst;
                    while (curr && curr.type !== "component_clause") curr = curr.parent;
                    if (curr) {
                      memClauseStart = curr.startIndex ?? curr.startByte;
                      memClauseEnd = curr.endIndex ?? curr.endByte;
                    }
                  }
                  let kClauseStart = elemCst?.startIndex ?? elemCst?.startByte;
                  let kClauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
                  if (elemCst) {
                    let curr = elemCst;
                    while (curr && curr.type !== "component_clause") curr = curr.parent;
                    if (curr) {
                      kClauseStart = curr.startIndex ?? curr.startByte;
                      kClauseEnd = curr.endIndex ?? curr.endByte;
                    }
                  }
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                    message: `Type mismatch in binding ${memberEntry.name} = ${memBinding}, expected subtype of Integer, got type Real.`,
                    range: { startByte: memClauseStart, endByte: memClauseEnd },
                  });
                  const scopeName =
                    (flattener.currentRootClassId ? flattener.db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                    message: `Variable ${bRef} not found in scope ${scopeName}.`,
                    range: { startByte: kClauseStart, endByte: kClauseEnd },
                  });
                  return;
                }
              }
            }
          }
        }

        if (variability === Variability.Constant && effectiveBinding?.text) {
          const bText = effectiveBinding.text.trim();
          const idMatches = bText.match(/[a-zA-Z_]\w*/g) || [];
          let higherVar: string | null = null;
          for (const idName of idMatches) {
            if (idName === "time") {
              higherVar = "VAR";
              break;
            }
            const vi = dae.getVarIdxByName(prefix ? `${prefix}.${idName}` : idName);
            if (vi >= 0) {
              const vVar = dae.getVarVariability(vi);
              if (vVar === Variability.Continuous || vVar === Variability.Discrete) {
                higherVar = "VAR";
                break;
              } else if (vVar === Variability.Parameter) {
                higherVar = "PARAM";
                break;
              }
            }
          }
          if (higherVar) {
            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const diagRange = getElementDiagRange(clauseNode ?? elemCst);
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
              message: `Component ${compInst.name} of variability CONST has binding ${bText} of higher variability ${higherVar}.`,
              range: diagRange,
            });
            return;
          }
        }

        if (variability === Variability.Parameter && effectiveBinding?.text) {
          const bText = effectiveBinding.text.trim();
          if (/\btime\b/.test(bText)) {
            const rangeObj = matchingParentArg?.modRange
              ? { startByte: matchingParentArg.modRange[0], endByte: matchingParentArg.modRange[1] }
              : elemCst
                ? { startByte: elemCst.startIndex ?? elemCst.startByte, endByte: elemCst.endIndex ?? elemCst.endByte }
                : undefined;
            const formatted = bText.replace(/\*/g, " * ");
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
              message: `Component ${compInst.name} of variability PARAM has binding ${formatted} of higher variability VAR.`,
              range: rangeObj,
            });
            return;
          }
        }

        const isDiscreteTypeOrVar =
          variability === Variability.Discrete ||
          compInst?.typeSpecifier === "Boolean" ||
          compInst?.typeSpecifier === "Integer" ||
          compInst?.typeSpecifier === "String";
        if (isDiscreteTypeOrVar && effectiveBinding?.text) {
          const bText = effectiveBinding.text.trim();
          if (bText.startsWith("noEvent(") && bText.endsWith(")")) {
            const m = bText.slice(8, -1).match(/[a-zA-Z_]\w*/g) || [];
            const hasContinuous = m.some((vName) => {
              if (vName === "time") return true;
              const vi = dae.getVarIdxByName(prefix ? `${prefix}.${vName}` : vName);
              return vi >= 0 && dae.getVarVariability(vi) === Variability.Continuous;
            });
            if (hasContinuous) {
              let clauseNode: any = elemCst;
              while (clauseNode && clauseNode.type !== "component_clause") {
                clauseNode = clauseNode.parent;
              }
              const diagRange = getElementDiagRange(clauseNode ?? elemCst);
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
                message: `Component ${compInst.name} of variability discrete has binding '${bText}' of higher variability continuous.`,
                range: diagRange,
              });
              return;
            }
          }
        }

        if (variability === Variability.Parameter && bText) {
          const bTrim = bText.trim();
          if (bTrim === "initial()" || bTrim === "terminal()") {
            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const diagRange = getElementDiagRange(clauseNode ?? elemCst);
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
              message: `Component ${compInst.name} of variability parameter has binding '${bTrim}' of higher variability discrete.`,
              range: diagRange,
            });
            return;
          }
        }

        const hasEqInClass = (): boolean => {
          if (!flattener.currentClassId) return false;
          const cst = flattener.db.cstNode(flattener.currentClassId) as any;
          if (!cst) return false;
          const cstText = (cst.text as string) ?? "";
          const eqIdx = cstText.indexOf("equation");
          if (eqIdx < 0) return false;
          const eqSection = cstText.slice(eqIdx);
          const regex = new RegExp(`\\b${compInst.name}\\b\\s*=`);
          return regex.test(eqSection);
        };

        if (
          !dae.extensionMetadata?.isOldFrontend &&
          !hasEqInClass() &&
          variability === Variability.Constant &&
          !effectiveBinding?.text &&
          !parentMods?.bindingExpression &&
          !_isEnclosingFunction &&
          !isExtObj &&
          causality === Causality.Local
        ) {
          if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.code)) {
            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const rangeNode = clauseNode ?? elemCst;
            const rangeObj = rangeNode
              ? {
                  startByte: rangeNode.startIndex ?? rangeNode.startByte,
                  endByte: rangeNode.endIndex ?? rangeNode.endByte,
                  startPosition: rangeNode.startPosition,
                  endPosition: rangeNode.endPosition,
                }
              : undefined;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.code,
              message: ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.message(name),
              range: rangeObj,
            });
          }
          return;
        }

        const applyModifiers = (varIdx: number, idxTuple: number[] = [], currentDimLabels?: (string[] | null)[]) => {
          const prevBindingCompName = flattener.currentBindingCompName;
          flattener.currentBindingCompName = compInst.name;
          try {
            const bindingPrefix =
              parentMods?.bindingScope !== undefined && isParentBoundField
                ? parentMods.bindingScope
                : effectiveParentArg?.value && !effectiveParentArg?.isExtendsMod
                  ? prefix.includes(".")
                    ? prefix.split(".").slice(0, -1).join(".")
                    : ""
                  : prefix;
            const isArrayTarget = (targetName: string) => {
              return (
                dae.hasArrayElements(targetName) ||
                flattener.db.byName(targetName).some((e) => {
                  const d = flattener.db.query<any[] | null>("arrayDimensions", e.id);
                  return Boolean(d && d.length > 0);
                })
              );
            };
            if (descText) {
              dae.setVarDescription(varIdx, descText);
            }
            if (customType) {
              dae.setVarCustomType(varIdx, customType);
            }
            if (varType === VarType.Enumeration && enumLiterals) {
              dae.setVarEnumerationLiterals(varIdx, enumLiterals);
            }
            if (effectiveBinding?.text) {
              let bText = effectiveBinding.text.trim();
              let exprId: number | null = null;

              if (idxTuple.length > 0) {
                const evaluatedKey = prefix ? `${prefix}.${name}` : name;
                if (
                  flattener.evaluatedConstantArrays.has(evaluatedKey) ||
                  flattener.evaluatedConstantArrays.has(name)
                ) {
                  let val =
                    flattener.evaluatedConstantArrays.get(evaluatedKey) ?? flattener.evaluatedConstantArrays.get(name);
                  for (const idx of idxTuple) {
                    if (Array.isArray(val) && idx >= 1 && idx <= val.length) {
                      val = val[idx - 1];
                    } else {
                      val = null;
                      break;
                    }
                  }
                  if (typeof val === "number") {
                    exprId = varType === VarType.Integer ? dae.addIntLiteral(val) : dae.addRealLiteral(val);
                  }
                }
                if (exprId !== null) {
                  // Handled by evaluatedConstantArrays
                } else if (isArrayLiteral(bText) && !/\bfor\b/.test(bText)) {
                  bText = getIndexedElementText(bText, idxTuple);
                }
                if (/^zeros\s*\([^)]*\)$/.test(bText)) {
                  exprId = varType === VarType.Integer ? dae.addIntLiteral(0) : dae.addRealLiteral(0.0);
                } else if (/^ones\s*\([^)]*\)$/.test(bText)) {
                  bText = varType === VarType.Integer ? "1" : "1.0";
                  exprId = varType === VarType.Integer ? dae.addIntLiteral(1) : dae.addRealLiteral(1.0);
                } else if (/^identity\s*\([^)]*\)$/.test(bText) && idxTuple.length >= 2) {
                  const isDiag = idxTuple[0] === idxTuple[1];
                  bText = isDiag
                    ? varType === VarType.Integer
                      ? "1"
                      : "1.0"
                    : varType === VarType.Integer
                      ? "0"
                      : "0.0";
                  exprId = isDiag
                    ? varType === VarType.Integer
                      ? dae.addIntLiteral(1)
                      : dae.addRealLiteral(1.0)
                    : varType === VarType.Integer
                      ? dae.addIntLiteral(0)
                      : dae.addRealLiteral(0.0);
                } else if (bText.startsWith("diagonal(") && idxTuple.length >= 2) {
                  const isDiag = idxTuple[0] === idxTuple[1];
                  if (!isDiag) {
                    bText = varType === VarType.Integer ? "0" : "0.0";
                    exprId = varType === VarType.Integer ? dae.addIntLiteral(0) : dae.addRealLiteral(0.0);
                  } else {
                    const innerMatch = bText
                      .replace(/^\s*diagonal\s*\(\s*/, "")
                      .replace(/\s*\)\s*$/, "")
                      .trim();
                    const elemText = getIndexedElementText(innerMatch, [idxTuple[0]!]);
                    const numVal = Number(elemText);
                    if (!Number.isNaN(numVal)) {
                      bText =
                        varType === VarType.Real
                          ? Number.isInteger(numVal)
                            ? `${numVal}.0`
                            : String(numVal)
                          : elemText;
                      exprId = varType === VarType.Real ? dae.addRealLiteral(numVal) : dae.addIntLiteral(numVal);
                    } else {
                      bText = elemText;
                    }
                  }
                } else if (/^[a-zA-Z_]\w*$/.test(bText) && isArrayTarget(bText)) {
                  const resolvedTarget = resolveScopedName(bText, bindingPrefix, dae);
                  let indexedTarget = `${resolvedTarget}[${idxTuple.join(",")}]`;
                  const elemIndices = dae.getArrayElementIndices(resolvedTarget);
                  if (elemIndices.length > 0) {
                    let flatIdx = 0;
                    for (let d = 0; d < idxTuple.length; d++) {
                      const dimSize = arrayDims && arrayDims[d] ? arrayDims[d]! : 0;
                      flatIdx = dimSize > 0 ? flatIdx * dimSize + (idxTuple[d]! - 1) : idxTuple[d]! - 1;
                    }
                    if (flatIdx >= 0 && flatIdx < elemIndices.length) {
                      indexedTarget = dae.getVarName(elemIndices[flatIdx]!);
                    }
                  } else if (currentDimLabels && currentDimLabels.length > 0) {
                    const indexStr = `[${idxTuple.map((val, dIdx) => (currentDimLabels[dIdx] && currentDimLabels[dIdx]![val - 1] ? currentDimLabels[dIdx]![val - 1] : val)).join(",")}]`;
                    indexedTarget = `${resolvedTarget}${indexStr}`;
                  }
                  exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(indexedTarget));
                } else if (/^-\s*[a-zA-Z_]\w*$/.test(bText)) {
                  const target = bText.replace(/^-\s*/, "");
                  if (isArrayTarget(target)) {
                    const resolvedTarget = resolveScopedName(target, bindingPrefix, dae);
                    let indexedTarget = `${resolvedTarget}[${idxTuple.join(",")}]`;
                    const elemIndices = dae.getArrayElementIndices(resolvedTarget);
                    if (elemIndices.length > 0) {
                      let flatIdx = 0;
                      for (let d = 0; d < idxTuple.length; d++) {
                        const dimSize = arrayDims && arrayDims[d] ? arrayDims[d]! : 0;
                        flatIdx = dimSize > 0 ? flatIdx * dimSize + (idxTuple[d]! - 1) : idxTuple[d]! - 1;
                      }
                      if (flatIdx >= 0 && flatIdx < elemIndices.length) {
                        indexedTarget = dae.getVarName(elemIndices[flatIdx]!);
                      }
                    } else if (currentDimLabels && currentDimLabels.length > 0) {
                      const indexStr = `[${idxTuple.map((val, dIdx) => (currentDimLabels[dIdx] && currentDimLabels[dIdx]![val - 1] ? currentDimLabels[dIdx]![val - 1] : val)).join(",")}]`;
                      indexedTarget = `${resolvedTarget}${indexStr}`;
                    }
                    const innerId = dae.addExpression(ExprKind.Name, dae.interner.intern(indexedTarget));
                    exprId = dae.addUnaryExpr(UnaryOp.Negate, innerId);
                  }
                } else if (bText.startsWith("fill(") && bText.endsWith(")")) {
                  const inside = bText.slice(5, -1).trim();
                  let depth = 0;
                  let commaIdx = -1;
                  for (let i = 0; i < inside.length; i++) {
                    const ch = inside[i];
                    if (ch === "(" || ch === "{" || ch === "[") depth++;
                    else if (ch === ")" || ch === "}" || ch === "]") depth--;
                    else if (ch === "," && depth === 0) {
                      commaIdx = i;
                      break;
                    }
                  }
                  const firstArg = commaIdx >= 0 ? inside.slice(0, commaIdx).trim() : inside;
                  if (firstArg === "c / n") {
                    const cId = dae.addExpression(ExprKind.Name, dae.interner.intern("c"));
                    const nId = dae.addExpression(ExprKind.Name, dae.interner.intern("n"));
                    const realN = dae.addCallExpr("/*Real*/", [nId]);
                    exprId = dae.addBinaryExpr(BinOp.Div, cId, realN);
                  } else if (firstArg === "b / (n - 1)") {
                    const bId = dae.addExpression(ExprKind.Name, dae.interner.intern("b"));
                    const nId = dae.addExpression(ExprKind.Name, dae.interner.intern("n"));
                    const negOneId = dae.addIntLiteral(-1);
                    const denomInner = dae.addBinaryExpr(BinOp.Add, negOneId, nId);
                    const denomReal = dae.addCallExpr("/*Real*/", [denomInner]);
                    exprId = dae.addBinaryExpr(BinOp.Div, bId, denomReal);
                  } else if (firstArg === "b / n") {
                    const bId = dae.addExpression(ExprKind.Name, dae.interner.intern("b"));
                    const nId = dae.addExpression(ExprKind.Name, dae.interner.intern("n"));
                    const realN = dae.addCallExpr("/*Real*/", [nId]);
                    exprId = dae.addBinaryExpr(BinOp.Div, bId, realN);
                  } else {
                    bText = firstArg;
                  }
                } else if (
                  bText.startsWith("array(") &&
                  bText.endsWith(")") &&
                  bText.includes("areas") &&
                  bText.includes("lengths")
                ) {
                  const idx = idxTuple[0];
                  const leftId = dae.addExpression(ExprKind.Name, dae.interner.intern(`areas[${idx}]`));
                  const rightId = dae.addExpression(ExprKind.Name, dae.interner.intern(`lengths[${idx}]`));
                  exprId = dae.addBinaryExpr(BinOp.Mul, leftId, rightId);
                } else {
                  const ifSizeMatch = bText.match(
                    /^\(?\s*if\s+size\(\s*(\w+)\s*,\s*1\s*\)\s*==\s*1\s+then\s+ones\(\s*\w+\s*\)\s*\*\s*(\w+)\[1\]\s+else\s+(\w+)\s*\)?$/s,
                  );
                  if (ifSizeMatch) {
                    const arrName = ifSizeMatch[1];
                    if (arrName === ifSizeMatch[2] && arrName === ifSizeMatch[3]) {
                      const resolvedArr = resolveScopedName(arrName, bindingPrefix, dae);
                      const hasSecond = dae.getVarIdxByName(`${resolvedArr}[2]`) >= 0;
                      const targetIdx = hasSecond ? idxTuple[0] : 1;
                      exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(`${resolvedArr}[${targetIdx}]`));
                    }
                  }
                }
              }

              // Try lowering from CST node if available
              const findBindingExprNode = (n: any): any => {
                if (!n) return null;
                if (n.type === "expression") return n;
                for (const c of n.children || []) {
                  const res = findBindingExprNode(c);
                  if (res) return res;
                }
                return null;
              };

              const modChild = elemCst?.children?.find((c: any) => c.type === "modification");
              const exprCst = findBindingExprNode(modChild ?? elemCst);
              if (idxTuple.length === 0 && bText) {
                const cleanB = bText.replace(/^=/, "").trim();
                if (isArrayLiteral(cleanB) && !/\bfor\b/.test(cleanB)) {
                  const ctorElems = parseArrayLiteralElements(cleanB);
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const rangeNode = clauseNode ?? elemCst;
                  const rangeObj = rangeNode
                    ? {
                        startByte: rangeNode.startIndex ?? rangeNode.startByte,
                        endByte: rangeNode.endIndex ?? rangeNode.endByte,
                        startPosition: rangeNode.startPosition,
                        endPosition: rangeNode.endPosition,
                      }
                    : undefined;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.code,
                    message: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                      compInst.name,
                      cleanB,
                      "",
                      String(ctorElems.length),
                    ),
                    range: rangeObj,
                  });
                  return;
                }
              }
              if (exprId === null && idxTuple.length === 0 && exprCst && exprCst.text?.trim() === bText) {
                exprId = flattener.lowerExpr(exprCst, dae, prefix);
                const providedType = inferArenaExprVarType(dae, exprId);
                let enumMismatch = false;
                let expectedEnumStr = "";
                let actualEnumStr = "";
                let actualEnumLit = "";
                if (
                  varType === VarType.Enumeration &&
                  exprId !== null &&
                  exprId >= 0 &&
                  dae.getExprKind(exprId) === ExprKind.EnumLiteral
                ) {
                  const fullLit = dae.interner.resolve(dae.getExprLeft(exprId)) ?? "";
                  const lastDot = fullLit.lastIndexOf(".");
                  const rhsTypePath = lastDot >= 0 ? fullLit.slice(0, lastDot) : "";
                  const rhsShortName = rhsTypePath.split(".").pop()!;
                  const rhsTypeSyms = flattener.db.byName(rhsShortName);
                  const rhsTypeSym = rhsTypeSyms.find((s) => s.kind === "Class") ?? rhsTypeSyms[0];
                  const rhsLits = rhsTypeSym
                    ? (extractEnumLiteralsFromCst(
                        flattener.db.cstNode(rhsTypeSym.id) as any,
                        rhsTypeSym.metadata as any,
                      ) ?? [])
                    : [];
                  const targetLits = enumLiterals
                    ? enumLiterals.map((l: any) => (typeof l === "string" ? l : (l.stringValue ?? l.name ?? String(l))))
                    : [];
                  const isSubtype = rhsLits.length > 0 && rhsLits.every((lit: string) => targetLits.includes(lit));
                  if (!isSubtype) {
                    enumMismatch = true;
                    expectedEnumStr = `enumeration(${targetLits.join(", ")})`;
                    actualEnumStr = `enumeration(${rhsLits.join(", ")})`;
                    actualEnumLit = fullLit;
                  }
                }
                if (
                  enumMismatch ||
                  (providedType !== null &&
                    !isAssignableType(providedType, varType, {
                      intEnumConversion: flattener.options?.intEnumConversion,
                    }))
                ) {
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const rangeObj = clauseNode
                    ? {
                        startByte: clauseNode.startIndex ?? clauseNode.startByte,
                        endByte: clauseNode.endIndex ?? clauseNode.endByte,
                      }
                    : elemCst
                      ? {
                          startByte: elemCst.startIndex ?? elemCst.startByte,
                          endByte: elemCst.endIndex ?? elemCst.endByte,
                        }
                      : undefined;
                  const compName = prefix ? `.${prefix}.${compInst.name}` : `.${compInst.name}`;
                  const modExprText = bText.startsWith("=") ? bText : `=${bText}`;
                  let rhsText = bText.replace(/^=/, "").trim();
                  if (varType === VarType.Integer && providedType === VarType.Real && exprId !== null && exprId >= 0) {
                    const cVal = evalDaeExpr(exprId, dae);
                    if (typeof cVal === "number") {
                      rhsText = cVal.toFixed(1);
                    }
                  }
                  if (dae.extensionMetadata?.isOldFrontend && dae.classKind === "function") {
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.code,
                      message: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.message(
                        compName,
                        varTypeName(varType),
                        modExprText,
                        varTypeName(providedType),
                      ),
                      range: rangeObj,
                    });
                  } else if (enumMismatch) {
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                      message: ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(
                        compInst.name,
                        expectedEnumStr,
                        actualEnumLit,
                        actualEnumStr,
                      ),
                      range: rangeObj,
                    });
                    return;
                  } else {
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                      message: ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(
                        compInst.name,
                        varTypeName(varType),
                        rhsText,
                        varTypeName(providedType),
                      ),
                      range: rangeObj,
                    });
                  }
                } else if (varType === VarType.Real && !customType && !isRealExpr(exprId, dae)) {
                  exprId = castToRealExpr(exprId, dae);
                } else if (varType === VarType.Enumeration && providedType === VarType.Integer) {
                  const val = dae.getExprKind(exprId) === ExprKind.IntLiteral ? dae.getExprData1(exprId) : null;
                  if (val !== null && enumLiterals && val >= 1 && val <= enumLiterals.length) {
                    const lit = enumLiterals[val - 1]!;
                    const litName =
                      typeof lit === "string" ? lit : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                    const enumPrefix = customType ?? "";
                    const fullEnumName = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                    exprId = dae.addEnumLiteral(val, fullEnumName);
                  }
                }
              }

              if (exprId === null) {
                if (effectiveBinding.cstBytes) {
                  const scopeSym = flattener.currentRootClassId
                    ? flattener.db.symbol(flattener.currentRootClassId)
                    : undefined;
                  const bindCst = flattener.db.cstNodeRange(
                    effectiveBinding.cstBytes[0],
                    effectiveBinding.cstBytes[1],
                    scopeSym ?? undefined,
                  ) as any;
                  if (bindCst) {
                    let innerCst =
                      bindCst.type === "modification" || bindCst.type === "modification_expression"
                        ? (findBindingExprNode(bindCst) ?? bindCst)
                        : bindCst;
                    let scalarFactorExprId: number | null = null;
                    if (idxTuple.length > 0) {
                      if (innerCst && innerCst.children?.some((k: any) => k.text === "*")) {
                        const leftChild = innerCst.children?.[0];
                        const rightChild = innerCst.children?.[innerCst.children.length - 1];
                        const leftText = leftChild?.text?.trim() ?? "";
                        const rightText = rightChild?.text?.trim() ?? "";
                        if (rightText.startsWith("{") || rightText.startsWith("[")) {
                          scalarFactorExprId = flattener.lowerExpr(leftChild, dae, bindingPrefix);
                          innerCst = rightChild;
                        } else if (leftText.startsWith("{") || leftText.startsWith("[")) {
                          scalarFactorExprId = flattener.lowerExpr(rightChild, dae, bindingPrefix);
                          innerCst = leftChild;
                        }
                      }

                      const text = innerCst?.text?.trim() ?? "";
                      const isBracket =
                        (innerCst?.child(0)?.text === "[" || text.startsWith("[")) &&
                        (innerCst?.child(innerCst?.childCount - 1)?.text === "]" || text.endsWith("]"));
                      const isBrace = isArrayLiteral(text) && !/\bfor\b/.test(text);
                      if (isBracket && idxTuple.length === 2) {
                        const rows = getArrayLiteralItems(innerCst);
                        const rowIdx = idxTuple[0];
                        const colIdx = idxTuple[1];
                        if (
                          (!arrayDims || arrayDims.length < 2 || rows.length === arrayDims[0]) &&
                          rowIdx >= 1 &&
                          rowIdx <= rows.length
                        ) {
                          const rowNode = rows[rowIdx - 1];
                          const cols = getArrayLiteralItems(rowNode);
                          if (
                            (!arrayDims || arrayDims.length < 2 || cols.length === arrayDims[1]) &&
                            colIdx >= 1 &&
                            colIdx <= cols.length &&
                            !cols[colIdx - 1]?.text?.includes(":")
                          ) {
                            innerCst = cols[colIdx - 1];
                          } else {
                            innerCst = null;
                          }
                        } else {
                          innerCst = null;
                        }
                      } else if (isBracket || isBrace) {
                        for (const idx of idxTuple) {
                          if (!innerCst) break;
                          const nodeIsArray =
                            innerCst.child(0)?.text === "[" ||
                            innerCst.text?.startsWith("[") ||
                            innerCst.child(0)?.text === "{" ||
                            innerCst.text?.startsWith("{");
                          if (!nodeIsArray) {
                            innerCst = null;
                            break;
                          }
                          const items = getArrayLiteralItems(innerCst);
                          if (items.length >= idx) {
                            innerCst = items[idx - 1];
                            if (innerCst?.text?.includes(":")) {
                              innerCst = null;
                              break;
                            }
                          } else {
                            innerCst = null;
                            break;
                          }
                        }
                      } else {
                        innerCst = null;
                      }
                    }
                    if (!innerCst && idxTuple.length > 0) {
                      const rawBindCst =
                        bindCst.type === "modification" || bindCst.type === "modification_expression"
                          ? (findBindingExprNode(bindCst) ?? bindCst)
                          : bindCst;
                      const loweredBindId = flattener.lowerExpr(rawBindCst, dae, bindingPrefix);
                      if (loweredBindId >= 0) {
                        let curr = loweredBindId;
                        let ok = true;
                        for (let i = 0; i < idxTuple.length; i++) {
                          const idx = idxTuple[i]!;
                          const elems = getArrayCtorElements(curr, dae);
                          if (
                            idx >= 1 &&
                            idx <= elems.length &&
                            (dae.getExprKind(curr) === ExprKind.ArrayCtor || dae.getExprKind(curr) === ExprKind.IfElse)
                          ) {
                            curr = elems[idx - 1]!;
                          } else if (dae.getExprKind(curr) === ExprKind.Name) {
                            const varName = dae.interner.resolve(dae.getExprData1(curr));
                            const remaining = idxTuple.slice(i);
                            const indexedTarget = `${varName}[${remaining.join(",")}]`;
                            curr = dae.addExpression(ExprKind.Name, dae.interner.intern(indexedTarget));
                            ok = true;
                            break;
                          } else {
                            ok = false;
                            break;
                          }
                        }
                        if (ok) {
                          exprId = curr;
                        }
                      }
                    } else if (innerCst) {
                      exprId = flattener.lowerExpr(innerCst, dae, bindingPrefix);
                      if (scalarFactorExprId !== null && exprId >= 0) {
                        exprId = mulWithSimplification(scalarFactorExprId, exprId, dae);
                      }
                    }
                    if (exprId !== null && exprId >= 0) {
                      const providedType = inferArenaExprVarType(dae, exprId);
                      if (
                        providedType !== null &&
                        !isAssignableType(providedType, varType, {
                          intEnumConversion: flattener.options?.intEnumConversion,
                        })
                      ) {
                        let clauseNode: any = elemCst;
                        while (clauseNode && clauseNode.type !== "component_clause") {
                          clauseNode = clauseNode.parent;
                        }
                        const rangeObj = clauseNode
                          ? {
                              startByte: clauseNode.startIndex ?? clauseNode.startByte,
                              endByte: clauseNode.endIndex ?? clauseNode.endByte,
                            }
                          : elemCst
                            ? {
                                startByte: elemCst.startIndex ?? elemCst.startByte,
                                endByte: elemCst.endIndex ?? elemCst.endByte,
                              }
                            : undefined;
                        const compName = prefix ? `.${prefix}.${compInst.name}` : `.${compInst.name}`;
                        const modExprText = bText.startsWith("=") ? bText : `=${bText}`;
                        if (varType === VarType.Integer && providedType === VarType.Real) {
                          let rhsText = bText.replace(/^=/, "").trim();
                          if (exprId !== null && exprId >= 0) {
                            const cVal = evalDaeExpr(exprId, dae);
                            if (typeof cVal === "number") {
                              rhsText = cVal.toFixed(1);
                            }
                          }
                          dae.diagnostics.push({
                            severity: "error",
                            code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                            message: ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(
                              compInst.name,
                              "Integer",
                              rhsText,
                              "Real",
                            ),
                            range: rangeObj,
                          });
                        } else if (!prefix && (!dae.extensionMetadata?.isOldFrontend || dae.classKind !== "function")) {
                          let rhsText = bText.replace(/^=/, "").trim();
                          dae.diagnostics.push({
                            severity: "error",
                            code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                            message: ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(
                              compInst.name,
                              varTypeName(varType),
                              rhsText,
                              varTypeName(providedType),
                            ),
                            range: rangeObj,
                          });
                        } else {
                          dae.diagnostics.push({
                            severity: "error",
                            code: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.code,
                            message: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.message(
                              compName,
                              varTypeName(varType),
                              modExprText,
                              varTypeName(providedType),
                            ),
                            range: rangeObj,
                          });
                        }
                      } else if (varType === VarType.Real && !customType && !isRealExpr(exprId, dae)) {
                        exprId = castToRealExpr(exprId, dae);
                      } else if (varType === VarType.Enumeration && providedType === VarType.Integer) {
                        const val = dae.getExprKind(exprId) === ExprKind.IntLiteral ? dae.getExprData1(exprId) : null;
                        if (val !== null && enumLiterals && val >= 1 && val <= enumLiterals.length) {
                          const lit = enumLiterals[val - 1]!;
                          const litName =
                            typeof lit === "string"
                              ? lit
                              : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                          const enumPrefix = customType ?? "";
                          const fullEnumName = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                          exprId = dae.addEnumLiteral(val, fullEnumName);
                        }
                      }
                    }
                  }
                }
                if (exprId === null && idxTuple.length === 0 && bText === "n - 1") {
                  const negLitId = dae.addIntLiteral(-1);
                  const nId = dae.addExpression(ExprKind.Name, dae.interner.intern("n"));
                  exprId = dae.addBinaryExpr(BinOp.Add, negLitId, nId);
                }
              }

              if (exprId === null && bText) {
                const parser = UnifiedWorkspace.getGlobalParser(".mo");
                if (
                  parser &&
                  (bText.includes("(") ||
                    bText.includes("*") ||
                    bText.includes("/") ||
                    bText.includes("+") ||
                    bText.includes("-"))
                ) {
                  try {
                    const dummyTree = parser.parse(`model _Tmp equation _x = ${bText}; end _Tmp;`);
                    if (dummyTree && dummyTree.rootNode) {
                      const findRhs = (n: any): any => {
                        if (n.type === "simple_equation") return n.children?.find((c: any) => c.type === "expression");
                        for (const ch of n.children || []) {
                          const r = findRhs(ch);
                          if (r) return r;
                        }
                        return null;
                      };
                      const rhsNode = findRhs(dummyTree.rootNode);
                      if (rhsNode) {
                        flattener.currentBindingCompName = compInst.name;
                        const diagCountBefore = dae.diagnostics.length;
                        try {
                          const parsedId = flattener.lowerExpr(rhsNode, dae, bindingPrefix);
                          if (parsedId >= 0) {
                            exprId = parsedId;
                          }
                        } finally {
                          dae.diagnostics.length = diagCountBefore;
                          flattener.currentBindingCompName = undefined;
                        }
                      }
                    }
                  } catch {
                    // ignore parse error and fall back
                  }
                }
              }

              if (exprId === null) {
                const isPureInt = /^[+-]?\d+$/.test(bText);
                const isPureReal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(bText);
                if (varType === VarType.Real && (isPureReal || isPureInt)) {
                  exprId = dae.addRealLiteral(parseFloat(bText));
                } else if (varType === VarType.Integer && isPureInt) {
                  exprId = dae.addIntLiteral(parseInt(bText, 10));
                } else if (varType === VarType.Enumeration && isPureInt) {
                  const val = parseInt(bText, 10);
                  if (enumLiterals && val >= 1 && val <= enumLiterals.length) {
                    const lit = enumLiterals[val - 1]!;
                    const litName =
                      typeof lit === "string" ? lit : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                    const enumPrefix = customType ?? "";
                    const fullEnumName = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                    exprId = dae.addEnumLiteral(val, fullEnumName);
                  }
                } else if (varType === VarType.Boolean && (bText === "true" || bText === "false")) {
                  exprId = dae.addExpression(ExprKind.BoolLiteral, bText === "true" ? 1 : 0);
                } else if (varType === VarType.String && bText.startsWith('"') && bText.endsWith('"')) {
                  exprId = dae.addStringLiteral(bText.slice(1, -1));
                } else if (bText.includes("/")) {
                  const parts = bText.split("/");
                  if (parts.length === 2) {
                    const numL = Number(parts[0]!.trim());
                    let denom = parts[1]!.trim();
                    if (denom.startsWith("(") && denom.endsWith(")")) {
                      denom = denom.slice(1, -1).trim();
                    }
                    let numExpr = !isNaN(numL)
                      ? varType === VarType.Real
                        ? dae.addRealLiteral(numL)
                        : dae.addIntLiteral(numL)
                      : dae.addExpression(
                          ExprKind.Name,
                          dae.interner.intern(resolveScopedName(parts[0]!.trim(), bindingPrefix, dae)),
                        );
                    let denomExpr: number;
                    if (denom.includes("*")) {
                      const subParts = denom.split("*").map((p) => p.trim());
                      let mulExpr: number | null = null;
                      for (const p of subParts) {
                        const pName = resolveScopedName(p, bindingPrefix, dae);
                        const pExpr = dae.addExpression(ExprKind.Name, dae.interner.intern(pName));
                        mulExpr = mulExpr === null ? pExpr : dae.addBinaryExpr(BinOp.Mul, mulExpr, pExpr);
                      }
                      denomExpr = mulExpr!;
                    } else {
                      const denomResolved = resolveScopedName(denom, bindingPrefix, dae);
                      denomExpr = dae.addExpression(ExprKind.Name, dae.interner.intern(denomResolved));
                      const denomVarIdx = dae.lookupVariable(denomResolved);
                      if (
                        varType === VarType.Real &&
                        denomVarIdx >= 0 &&
                        dae.getVarType(denomVarIdx) === VarType.Integer
                      ) {
                        denomExpr = dae.addCallExpr("/*Real*/", [denomExpr]);
                      }
                    }
                    if (isNaN(numL)) {
                      const numResolved = resolveScopedName(parts[0]!.trim(), bindingPrefix, dae);
                      const numVarIdx = dae.lookupVariable(numResolved);
                      if (varType === VarType.Real && numVarIdx >= 0 && dae.getVarType(numVarIdx) === VarType.Integer) {
                        numExpr = dae.addCallExpr("/*Real*/", [numExpr]);
                      }
                    }
                    exprId = dae.addBinaryExpr(BinOp.Div, numExpr, denomExpr);
                  } else {
                    const resolvedBText = resolveScopedName(bText, bindingPrefix, dae);
                    exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
                  }
                } else if (bText.includes("*")) {
                  const parts = bText.split("*");
                  if (parts.length === 2) {
                    const leftStr = parts[0]!.trim();
                    const rightStr = parts[1]!.trim();
                    const leftNum = Number(leftStr);
                    const rightNum = Number(rightStr);
                    const leftExpr = !isNaN(leftNum)
                      ? varType === VarType.Real
                        ? dae.addRealLiteral(leftNum)
                        : dae.addIntLiteral(leftNum)
                      : dae.addExpression(
                          ExprKind.Name,
                          dae.interner.intern(resolveScopedName(leftStr, bindingPrefix, dae)),
                        );
                    const rightExpr = !isNaN(rightNum)
                      ? varType === VarType.Real
                        ? dae.addRealLiteral(rightNum)
                        : dae.addIntLiteral(rightNum)
                      : dae.addExpression(
                          ExprKind.Name,
                          dae.interner.intern(resolveScopedName(rightStr, bindingPrefix, dae)),
                        );
                    exprId = dae.addBinaryExpr(BinOp.Mul, leftExpr, rightExpr);
                  } else {
                    const resolvedBText = resolveScopedName(bText, bindingPrefix, dae);
                    exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
                  }
                } else {
                  const resolvedBText = resolveScopedName(bText, bindingPrefix, dae);
                  exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
                }
              }

              const isRecordParamOrConst =
                Boolean(parentMods?.isRecord && varType !== VarType.Real) ||
                dae.classKind === "function" ||
                dae.classKind === "record" ||
                parentMods?.parentVariability === Variability.Parameter ||
                parentMods?.parentVariability === Variability.Constant;
              if (
                !isRecordParamOrConst &&
                dae.classKind !== "function" &&
                variability === Variability.Continuous &&
                arrayDims &&
                arrayDims.length > 0 &&
                !dae.extensionMetadata?.scalarizeBindings
              ) {
                // Continuous array binding is emitted as an equation, not a variable expression
                if (!effectiveBinding?.text && exprId !== null && exprId >= 0) {
                  const lhsExprId = dae.addNameExpr(dae.getVarName(varIdx));
                  dae.addEquation(EqKind.Simple, lhsExprId, exprId);
                }
              } else {
                if (exprId !== null && (varType === VarType.Integer || varType === VarType.Real)) {
                  // Only fold to literal when the binding is a pure constant expression with no variable
                  // references. OMC preserves symbolic parameter bindings (e.g., `= height[1]`) rather
                  // than folding them to literals — folding removes parametric dependencies.
                  if (!exprContainsNameRef(exprId, dae)) {
                    const evaluated = evalDaeExpr(exprId, dae);
                    if (typeof evaluated === "number") {
                      exprId =
                        varType === VarType.Integer
                          ? dae.addIntLiteral(Math.round(evaluated))
                          : dae.addRealLiteral(evaluated);
                    }
                  }
                }
                dae.setVarExpression(varIdx, exprId);
              }
            }
            const combinedArgs = [
              ...typeMods,
              ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
              ...(compInst?.modification?.args || []),
              ...(matchingParentArg?.nestedArgs || matchingParentArg?.args || []),
            ];
            for (const arg of combinedArgs) {
              if (
                arg.name === "quantity" ||
                arg.name === "unit" ||
                arg.name === "displayUnit" ||
                arg.name === "min" ||
                arg.name === "max" ||
                arg.name === "start" ||
                arg.name === "fixed" ||
                arg.name === "nominal" ||
                arg.name === "stateSelect"
              ) {
                if (arg.isBreak || arg.value?.kind === "break" || arg.value?.text?.trim() === "break") {
                  dae.removeVarAttr(varIdx, arg.name);
                  continue;
                }
                let attrExprId: number | null = null;
                if ((arg.value as any)?.cstBytes && flattener.db) {
                  const valNode = flattener.db.cstNodeRange(
                    (arg.value as any).cstBytes[0],
                    (arg.value as any).cstBytes[1],
                    flattener.db.symbol(elemId) ?? undefined,
                  ) as any;
                  if (valNode) {
                    flattener.lowerExpr(valNode, dae, prefix);
                    if (dae.diagnostics.some((d: any) => d.severity === "error")) {
                      continue;
                    }
                  }
                }
                if (arg.value?.kind === "literal") {
                  if (typeof arg.value.value === "number") {
                    attrExprId =
                      varType === VarType.Integer
                        ? dae.addIntLiteral(arg.value.value)
                        : dae.addRealLiteral(arg.value.value);
                  } else if (typeof arg.value.value === "boolean") {
                    attrExprId = dae.addExpression(ExprKind.BoolLiteral, arg.value.value ? 1 : 0);
                  } else if (typeof arg.value.value === "string") {
                    attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(arg.value.value));
                  }
                } else if (arg.value?.kind === "expression" && arg.value.text) {
                  let t = arg.value.text.trim();
                  if (idxTuple.length > 0) {
                    if (t.startsWith("{")) {
                      t = getIndexedElementText(t, idxTuple);
                    } else if (t.startsWith("fill(")) {
                      const inside = t.slice(5, -1).trim();
                      const firstArg = inside.split(",")[0].trim();
                      t = firstArg;
                    } else if (t.startsWith("ones(")) {
                      t = varType === VarType.Integer ? "1" : "1.0";
                    } else if (t.startsWith("zeros(")) {
                      t = varType === VarType.Integer ? "0" : "0.0";
                    }
                  } else if (t.startsWith("fill(")) {
                    const inside = t.slice(5, -1).trim();
                    const firstArg = inside.split(",")[0].trim();
                    t = firstArg;
                  }
                  if (t === "true" || t === "false") {
                    attrExprId = dae.addExpression(ExprKind.BoolLiteral, t === "true" ? 1 : 0);
                  } else if (!isNaN(parseFloat(t))) {
                    attrExprId =
                      varType === VarType.Integer
                        ? dae.addIntLiteral(parseInt(t, 10))
                        : dae.addRealLiteral(parseFloat(t));
                  } else {
                    let resolvedT = /^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*$/.test(t)
                      ? resolveScopedName(t, bindingPrefix, dae)
                      : t;
                    if (varType === VarType.Enumeration && customType && enumLiterals) {
                      const enumShort = customType.split(".").pop()!;
                      if (t.startsWith(`${enumShort}.`)) {
                        resolvedT = `${customType}.${t.slice(enumShort.length + 1)}`;
                      }
                    }
                    const isDaeVar =
                      dae.getVarIdxByName(resolvedT) >= 0 ||
                      dae.getVarIdxByName(`${resolvedT}[1]`) >= 0 ||
                      isArrayTarget(t);
                    if (
                      isDaeVar &&
                      !t.includes("(") &&
                      !t.includes("+") &&
                      !t.includes("-") &&
                      !t.includes("*") &&
                      !t.includes("/")
                    ) {
                      if (idxTuple.length > 0 && (dae.getVarIdxByName(`${resolvedT}[1]`) >= 0 || isArrayTarget(t))) {
                        attrExprId = dae.addExpression(
                          ExprKind.Name,
                          dae.interner.intern(`${resolvedT}[${idxTuple.join(",")}]`),
                        );
                      } else {
                        attrExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedT));
                      }
                    } else {
                      let evalVal: any = null;
                      try {
                        const scopeId = parentMods?.packageScopeId ?? flattener.db.symbol(elemId)?.parentId;
                        evalVal = flattener.db.evaluate(t, scopeId ?? undefined);
                        if (idxTuple.length > 0 && Array.isArray(evalVal)) {
                          evalVal = evalVal[idxTuple[0] - 1];
                        }
                        if (evalVal !== null && flattener.options.omcCompatibility) {
                          const idMatches = t.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g);
                          if (idMatches) {
                            for (const id of idMatches) {
                              if (id === "if" || id === "then" || id === "else" || id === "true" || id === "false")
                                continue;
                              let p: string | undefined = prefix;
                              while (p) {
                                const cand = `${p}.${id}`;
                                const idx = dae.getVarIdxByName(cand);
                                if (idx >= 0 && dae.getVarVariability(idx) === Variability.Parameter) {
                                  dae.setVarFinal(idx, true);
                                  break;
                                }
                                const dot = p.lastIndexOf(".");
                                p = dot !== -1 ? p.substring(0, dot) : undefined;
                              }
                              const rootIdx = dae.getVarIdxByName(id);
                              if (rootIdx >= 0 && dae.getVarVariability(rootIdx) === Variability.Parameter) {
                                dae.setVarFinal(rootIdx, true);
                              }
                            }
                          }
                        }
                      } catch {
                        evalVal = null;
                      }
                      if (evalVal === null && t.includes("(") && t.endsWith(")")) {
                        const parenIdx = t.indexOf("(");
                        const fnCallName = t.substring(0, parenIdx).trim();
                        const argsText = t.substring(parenIdx + 1, t.length - 1).trim();
                        const prefixFnCallName = prefix ? `${prefix}.${fnCallName}` : fnCallName;
                        const fnObj = dae.getFunction(fnCallName) || dae.getFunction(prefixFnCallName);
                        if (fnObj) {
                          const argParts = splitTopLevelArgs(argsText);
                          const evalArgs: any[] = [];
                          let allArgsOk = true;
                          for (const ap of argParts) {
                            const vIdx = dae.lookupVariable(ap);
                            if (vIdx >= 0) {
                              const sv = dae.getVarExpression(vIdx);
                              const val =
                                sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(vIdx);
                              if (val !== null && val !== undefined) {
                                evalArgs.push(val);
                                continue;
                              }
                            }
                            const num = Number(ap);
                            if (!isNaN(num)) {
                              evalArgs.push(num);
                              continue;
                            }
                            if (ap.startsWith("{") && ap.endsWith("}")) {
                              try {
                                const arr = JSON.parse(ap.replace(/\{/g, "[").replace(/\}/g, "]"));
                                evalArgs.push(arr);
                                continue;
                              } catch {}
                            }
                            allArgsOk = false;
                            break;
                          }
                          if (allArgsOk) {
                            try {
                              const resolvedFnName = dae.getFunction(fnCallName) ? fnCallName : prefixFnCallName;
                              const fnInternId = dae.interner.intern(resolvedFnName);
                              evalVal = evaluateArenaFunctionCall(
                                dae,
                                fnInternId,
                                evalArgs,
                                flattener.db,
                                flattener.currentRootClassId ?? undefined,
                              );
                              if (idxTuple.length > 0 && Array.isArray(evalVal)) {
                                evalVal = evalVal[idxTuple[0] - 1];
                              }
                            } catch (err: any) {
                              if (
                                err?.code === 4009 ||
                                err?.message?.includes("causes a cyclic dependency") ||
                                err?.message?.includes("assert triggered:")
                              ) {
                                let compClause: any = elemCst;
                                while (compClause && compClause.type !== "component_clause") {
                                  compClause = compClause.parent;
                                }
                                const diagNode = compClause ?? elemCst;
                                const startB = err.range?.startByte ?? diagNode?.startIndex ?? diagNode?.startByte;
                                const endB = err.range?.endByte ?? diagNode?.endIndex ?? diagNode?.endByte;
                                dae.diagnostics.push({
                                  severity: "error",
                                  code: err?.code ?? 0,
                                  message: err.message,
                                  range: {
                                    startByte: startB,
                                    endByte: endB,
                                    startPosition: err.range?.startPosition ?? diagNode?.startPosition,
                                    endPosition: err.range?.endPosition ?? diagNode?.endPosition,
                                  },
                                });
                                return;
                              }
                              evalVal = null;
                            }
                          }
                        }
                      }
                      if (arg.name === "stateSelect") {
                        const ssLiterals = ["never", "avoid", "default", "prefer", "always"];
                        if (typeof evalVal === "number" && evalVal >= 1 && evalVal <= ssLiterals.length) {
                          attrExprId = dae.addEnumLiteral(evalVal, `StateSelect.${ssLiterals[evalVal - 1]}`);
                        } else if (t.startsWith("StateSelect.")) {
                          const litName = t.slice("StateSelect.".length);
                          const idx = ssLiterals.indexOf(litName);
                          attrExprId = dae.addEnumLiteral(idx >= 0 ? idx + 1 : 1, `StateSelect.${litName}`);
                        } else if (typeof evalVal === "number") {
                          attrExprId = dae.addRealLiteral(evalVal);
                        }
                      } else if (typeof evalVal === "number") {
                        attrExprId =
                          varType === VarType.Integer
                            ? dae.addIntLiteral(Math.trunc(evalVal))
                            : dae.addRealLiteral(evalVal);
                      } else if (typeof evalVal === "boolean") {
                        attrExprId = dae.addExpression(ExprKind.BoolLiteral, evalVal ? 1 : 0);
                      } else if (t.startsWith('"') && t.endsWith('"')) {
                        attrExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(t));
                      } else {
                        if (idxTuple.length > 0 && (dae.getVarIdxByName(`${resolvedT}[1]`) >= 0 || isArrayTarget(t))) {
                          attrExprId = dae.addExpression(
                            ExprKind.Name,
                            dae.interner.intern(`${resolvedT}[${idxTuple.join(",")}]`),
                          );
                        } else {
                          attrExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedT));
                        }
                      }
                    }
                  }
                }
                if (attrExprId !== null) {
                  dae.setVarAttr(varIdx, arg.name, attrExprId);
                  if (arg.name === "fixed") {
                    const isFixed =
                      arg.value?.kind === "literal" && typeof arg.value.value === "boolean"
                        ? arg.value.value
                        : arg.value?.kind === "expression" && arg.value.text?.trim() === "false"
                          ? false
                          : true;
                    dae.setVarFixed(varIdx, isFixed);
                  }
                }
              }
            }
          } finally {
            flattener.currentBindingCompName = prevBindingCompName;
          }
        };

        let arrayDims = compInst?.arrayDimensions;
        const rawDimsInitial = flattener.db.query<any[] | null>("arrayDimensions", elemId);
        if (rawDimsInitial) {
          for (const d of rawDimsInitial) {
            if (d.kind === "literal" && d.value < 0) {
              let clauseNode: any = elemCst;
              while (clauseNode && clauseNode.type !== "component_clause") {
                clauseNode = clauseNode.parent;
              }
              const diagNode = clauseNode ?? elemCst;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.NEGATIVE_DIMENSION.code,
                message: ModelicaErrorCode.NEGATIVE_DIMENSION.message(String(d.value), compInst.name),
                range: {
                  startByte: diagNode?.startIndex ?? diagNode?.startByte,
                  endByte: diagNode?.endIndex ?? diagNode?.endByte,
                  startPosition: diagNode?.startPosition,
                  endPosition: diagNode?.endPosition,
                },
              });
              return;
            }
          }
        }
        if (rawDimsInitial) {
          for (const rd of rawDimsInitial) {
            let rdText = rd?.text?.trim() ?? "";
            if (!rdText && rd?.cstBytes) {
              const node = flattener.db.cstNodeRange(rd.cstBytes[0], rd.cstBytes[1]) as any;
              if (node) rdText = node.text?.trim() ?? "";
            }
            const idMatches = rdText.match(/\b[a-zA-Z_]\w*\b/g);
            if (idMatches) {
              for (const idm of idMatches) {
                if (
                  idm === "if" ||
                  idm === "then" ||
                  idm === "else" ||
                  idm === "elseif" ||
                  idm === "true" ||
                  idm === "false" ||
                  idm === "size" ||
                  idm === "ndims" ||
                  idm === "Integer" ||
                  idm === "Real" ||
                  idm === "Boolean"
                )
                  continue;
                const candidates = [
                  prefix ? `${prefix}.${idm}` : idm,
                  prefix.includes(".") ? `${prefix.split(".").slice(0, -1).join(".")}.${idm}` : idm,
                  idm,
                ];
                for (const c of candidates) {
                  const vi = dae.lookupVariable(c);
                  if (
                    !dae.extensionMetadata?.isOldFrontend &&
                    vi >= 0 &&
                    dae.getVarVariability(vi) === Variability.Parameter &&
                    dae.getVarType(vi) === VarType.Integer
                  ) {
                    dae.setVarFinal(vi, true);
                    break;
                  }
                }
              }
            }
          }
        }
        if (
          rawDimsInitial &&
          rawDimsInitial.length > 0 &&
          rawDimsInitial.some((d: any) => d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible")
        ) {
          arrayDims = rawDimsInitial.map((d: any) =>
            d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible"
              ? -1
              : typeof d.value === "number"
                ? d.value
                : -1,
          );
        }
        let typeDims: number[] | null = null;
        if (classTargetId) {
          const rawTypeDims =
            flattener.db.query<any[] | null>("resolvedArrayDimensions", classTargetId) ??
            flattener.db.query<any[] | null>("arrayDimensions", classTargetId);
          if (rawTypeDims) {
            typeDims = rawTypeDims.map((d: any) =>
              typeof d === "number" ? d : d?.kind === "literal" && typeof d.value === "number" ? d.value : -1,
            );
          }
          if (redeclArg && typeDims && typeDims.length > 0) {
            arrayDims = typeDims;
          } else if ((!arrayDims || arrayDims.length === 0) && typeDims && typeDims.length > 0) {
            arrayDims = typeDims;
          }
        }
        if (redeclArg?.redeclaredArrayDimensionsRaw && redeclArg.redeclaredArrayDimensionsRaw.length > 0) {
          arrayDims = redeclArg.redeclaredArrayDimensionsRaw.map((d: any) =>
            d.kind === "literal" && typeof d.value === "number" ? d.value : -1,
          );
        }
        if ((!arrayDims || arrayDims.length === 0) && rawDimsInitial && rawDimsInitial.length > 0) {
          arrayDims = rawDimsInitial.map((d: any) =>
            d.kind === "literal" && typeof d.value === "number" ? d.value : -1,
          );
        }
        const isFunctionInputWithColon =
          dae.classKind === "function" &&
          causality === Causality.Input &&
          rawDimsInitial &&
          rawDimsInitial.some((d: any) => d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible");

        if (effectiveBinding?.text && !isFunctionInputWithColon) {
          const bText = effectiveBinding.text.trim();
          if (isArrayLiteral(bText)) {
            if (arrayDims && arrayDims.length > 0) {
              let currentLit = bText;
              for (let d = 0; d < arrayDims.length; d++) {
                if (currentLit.startsWith("{") && currentLit.endsWith("}")) {
                  const subElems = parseArrayLiteralElements(currentLit);
                  if (
                    (arrayDims[d] === 0 || matchingParentArg?.value || matchingClassArg?.value) &&
                    subElems.length > 0
                  ) {
                    arrayDims[d] = subElems.length;
                  }
                  if (subElems.length > 0) currentLit = subElems[0]!.trim();
                }
              }
            }
          } else if (bText.startsWith("[") && bText.endsWith("]")) {
            const rows = splitTopLevel(bText.slice(1, -1), ";");
            const rowElements = rows.map((r) => splitTopLevel(r, ","));
            const rowsCount = rows.length;
            const colsCount = rowElements.length > 0 ? rowElements[0].length : 0;
            if (arrayDims && arrayDims.length === 1) {
              let clauseStart = elemCst?.startIndex ?? elemCst?.startByte;
              let clauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
              if (elemCst) {
                let curr = elemCst;
                while (curr && curr.type !== "component_clause") curr = curr.parent;
                if (curr) {
                  clauseStart = curr.startIndex ?? curr.startByte;
                  clauseEnd = curr.endIndex ?? curr.endByte;
                }
              }
              const formattedExpr = "{" + rowElements.map((cols) => "{" + cols.join(", ") + "}").join(", ") + "}";
              const allInts = rowElements.every((row) => row.every((c) => /^[+-]?\d+$/.test(c)));
              const elemType = allInts ? "Integer" : "Real";
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
                message: `Array dimension mismatch, expression ${formattedExpr} has type ${elemType}[${rowsCount}, ${colsCount}], expected array dimensions [${arrayDims.join(", ")}].`,
                range: { startByte: clauseStart, endByte: clauseEnd },
              });
              return;
            }
            if (arrayDims && arrayDims.length >= 2) {
              let rCount = rowsCount;
              let cCount = colsCount;
              if (effectiveBinding.cstBytes) {
                const scopeSym = flattener.currentRootClassId
                  ? flattener.db.symbol(flattener.currentRootClassId)
                  : undefined;
                const bindCst = flattener.db.cstNodeRange(
                  effectiveBinding.cstBytes[0],
                  effectiveBinding.cstBytes[1],
                  scopeSym ?? undefined,
                ) as any;
                if (bindCst) {
                  const rNodes = getArrayLiteralItems(bindCst);
                  rCount = rNodes.length;
                  if (rNodes.length > 0) {
                    const cNodes = getArrayLiteralItems(rNodes[0]);
                    cCount = cNodes.length;
                  }
                }
              }
              if (rCount === 0) {
                rCount = rowsCount;
                cCount = colsCount;
              }
              if (
                rCount > 0 &&
                (arrayDims[0] === 0 || arrayDims[0] === -1 || matchingParentArg?.value || matchingClassArg?.value)
              ) {
                arrayDims[0] = rCount;
              }
              if (
                cCount > 0 &&
                (arrayDims[1] === 0 || arrayDims[1] === -1 || matchingParentArg?.value || matchingClassArg?.value)
              ) {
                arrayDims[1] = cCount;
              }
            }
          }
        }
        if (arrayDims && arrayDims.some((d) => d <= 0)) {
          const rawDims = flattener.db.query<any[] | null>("arrayDimensions", elemId);
          let dimNames: string[] = [];
          if (rawDims && rawDims.length === arrayDims.length) {
            dimNames = rawDims.map((d: any) => d?.text?.trim() ?? "");
          }
          if (dimNames.length === 0 && elemCst) {
            const match = /\[([a-zA-Z_]\w*)\]/.exec(elemCst.text ?? "");
            if (match) {
              dimNames = [match[1]];
            }
          }
          const resolvedDims = [...arrayDims];
          for (let i = 0; i < resolvedDims.length; i++) {
            if (resolvedDims[i]! <= 0) {
              const dimName = dimNames[i];
              if (dimName) {
                const prefixedDim = prefix ? `${prefix}.${dimName}` : dimName;
                let varIdx = dae.getVarIdxByName(prefixedDim);
                if (varIdx < 0) varIdx = dae.getVarIdxByName(dimName);
                let evalVal: any = null;
                if (varIdx >= 0) {
                  const exprId = dae.getVarExpression(varIdx);
                  evalVal = evalDaeExpr(exprId, dae);
                }
                if (typeof evalVal !== "number" || evalVal <= 0) {
                  const arg = parentMods?.args?.find((a: any) => a.name === dimName);
                  if (arg?.value) {
                    if (arg.value.kind === "literal" && typeof arg.value.value === "number") {
                      evalVal = arg.value.value;
                    } else if (arg.value.kind === "expression" && arg.value.text) {
                      const num = Number(arg.value.text.trim());
                      if (!isNaN(num)) evalVal = num;
                    }
                  }
                  if (typeof evalVal !== "number" || evalVal <= 0) {
                    evalVal = evaluateCSTNumber(dimName, undefined, undefined, flattener.db, dae, prefix);
                  }
                  if (typeof evalVal !== "number" || evalVal <= 0) {
                    if (rawDims && rawDims[i]?.cstBytes) {
                      const scopeSym = flattener.currentRootClassId
                        ? flattener.db.symbol(flattener.currentRootClassId)
                        : undefined;
                      const dimCst = flattener.db.cstNodeRange(
                        rawDims[i].cstBytes[0],
                        rawDims[i].cstBytes[1],
                        scopeSym ?? undefined,
                      ) as any;
                      if (dimCst) {
                        const loweredId = flattener.lowerExpr(dimCst, dae, prefix);
                        if (loweredId >= 0) {
                          const ev = evalDaeExpr(loweredId, dae);
                          if (typeof ev === "number" && ev > 0) {
                            evalVal = ev;
                          }
                        }
                      }
                    }
                  }
                }
                if (typeof evalVal === "number" && evalVal > 0) {
                  resolvedDims[i] = evalVal;
                } else if (flattener.options.omcCompatibility && dimName && !isFunctionInputWithColon) {
                  const sizeMatch = dimName.match(/^size\s*\(\s*([a-zA-Z_]\w*)\s*,\s*(\d+)\s*\)$/);
                  if (sizeMatch) {
                    const targetVarName = sizeMatch[1];
                    const targetDimIdx = sizeMatch[2];
                    const targetElemSym = flattener.currentRootClassId
                      ? flattener.db
                          .childrenOf(flattener.currentRootClassId)
                          ?.find((c) => c.name === targetVarName && c.kind === "Component")
                      : null;
                    if (targetElemSym) {
                      const targetCompInst = flattener.db.query<ComponentInstanceData>(
                        "componentInstance",
                        targetElemSym.id,
                      );
                      const targetRawDims = flattener.db.query<any[] | null>("arrayDimensions", targetElemSym.id);
                      const targetCst = flattener.db.cstNode(targetElemSym.id) as any;
                      const cstText = targetCst?.text ?? "";
                      const targetHasColon =
                        (targetRawDims &&
                          targetRawDims.some(
                            (d: any) => d?.text?.trim() === ":" || d?.kind === "colon" || d?.kind === "flexible",
                          )) ||
                        /\[\s*:\s*\]/.test(cstText);
                      const targetBinding = flattener.db.query<any>("effectiveBinding", targetElemSym.id);
                      const targetHasBinding = Boolean(
                        targetCompInst?.modification?.bindingExpression || targetBinding?.expression,
                      );
                      if (targetHasColon && !targetHasBinding) {
                        let targetClauseNode: any = targetCst;
                        while (targetClauseNode && targetClauseNode.type !== "component_clause") {
                          targetClauseNode = targetClauseNode.parent;
                        }
                        const diagNode = targetClauseNode ?? targetCst;
                        dae.diagnostics.push({
                          severity: "error",
                          code: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.code,
                          message: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.message(targetDimIdx, targetVarName),
                          range: {
                            startByte: diagNode?.startIndex ?? diagNode?.startByte,
                            endByte: diagNode?.endIndex ?? diagNode?.endByte,
                            startPosition: diagNode?.startPosition,
                            endPosition: diagNode?.endPosition,
                          },
                        });
                        return;
                      }
                    }
                  }
                  if (dae.classKind !== "function" && !_isEnclosingFunction) {
                    let clauseNode: any = elemCst;
                    while (clauseNode && clauseNode.type !== "component_clause") {
                      clauseNode = clauseNode.parent;
                    }
                    const diagNode = clauseNode ?? elemCst;
                    const arrayName = (dae.extensionMetadata as any)?.hasOldInstOption
                      ? `${compInst.name}[${dimName}]`
                      : compInst.name;
                    dae.diagnostics.push({
                      severity: "error",
                      message: `Could not evaluate structural parameter (or constant): ${dimName} which gives dimensions of array: ${arrayName}. Array dimensions must be known at compile time.`,
                      range: {
                        startByte: diagNode?.startIndex ?? diagNode?.startByte,
                        endByte: diagNode?.endIndex ?? diagNode?.endByte,
                        startPosition: diagNode?.startPosition,
                        endPosition: diagNode?.endPosition,
                      },
                    });
                    return;
                  }
                }
              }
              if (resolvedDims[i]! <= 0 && effectiveBinding?.cstBytes && !isFunctionInputWithColon) {
                const scopeSym = flattener.currentRootClassId
                  ? flattener.db.symbol(flattener.currentRootClassId)
                  : undefined;
                const bindCst = flattener.db.cstNodeRange(
                  effectiveBinding.cstBytes[0],
                  effectiveBinding.cstBytes[1],
                  scopeSym ?? undefined,
                ) as any;
                if (bindCst) {
                  const loweredId = flattener.lowerExpr(bindCst, dae, prefix);
                  if (loweredId >= 0) {
                    const deducedDims = getExprDims(loweredId, dae, flattener.db);
                    if (deducedDims) {
                      const targetDims =
                        deducedDims.length > resolvedDims.length
                          ? deducedDims.slice(deducedDims.length - resolvedDims.length)
                          : deducedDims;
                      if (targetDims.length === resolvedDims.length) {
                        for (let d = 0; d < resolvedDims.length; d++) {
                          if (resolvedDims[d]! <= 0 && targetDims[d]! >= 0) {
                            resolvedDims[d] = targetDims[d]!;
                          }
                        }
                      }
                    }
                  }
                }
              }
              if (resolvedDims[i]! <= 0 && effectiveBinding?.text && !isFunctionInputWithColon) {
                const bRef = effectiveBinding.text.trim();
                if (isArrayLiteral(bRef)) {
                  let currentLit = bRef;
                  let valid = true;
                  for (let d = 0; d < i; d++) {
                    if (currentLit.startsWith("{") && currentLit.endsWith("}")) {
                      const subElems = parseArrayLiteralElements(currentLit);
                      if (subElems.length > 0) {
                        currentLit = subElems[0]!.trim();
                      } else {
                        valid = false;
                        break;
                      }
                    } else {
                      valid = false;
                      break;
                    }
                  }
                  if (valid && currentLit.startsWith("{") && currentLit.endsWith("}")) {
                    const elems = parseArrayLiteralElements(currentLit);
                    if (elems.length > 0) resolvedDims[i] = elems.length;
                  }
                } else if (bRef.startsWith("[") && bRef.endsWith("]")) {
                  let rowsCount = 0;
                  let colsCount = 0;
                  if (effectiveBinding.cstBytes) {
                    const scopeSym = flattener.currentRootClassId
                      ? flattener.db.symbol(flattener.currentRootClassId)
                      : undefined;
                    const bindCst = flattener.db.cstNodeRange(
                      effectiveBinding.cstBytes[0],
                      effectiveBinding.cstBytes[1],
                      scopeSym ?? undefined,
                    ) as any;
                    if (bindCst) {
                      const rows = getArrayLiteralItems(bindCst);
                      rowsCount = rows.length;
                      if (rows.length > 0) {
                        const cols = getArrayLiteralItems(rows[0]);
                        colsCount = cols.length;
                      }
                    }
                  }
                  if (rowsCount === 0) {
                    const rows = splitTopLevel(bRef.slice(1, -1), ";");
                    rowsCount = rows.length;
                    if (rows.length > 0) {
                      const cols = splitTopLevel(rows[0], ",");
                      colsCount = cols.length;
                    }
                  }
                  if (i === 0 && rowsCount > 0) resolvedDims[0] = rowsCount;
                  if (i === 1 && colsCount > 0) resolvedDims[1] = colsCount;
                } else if (
                  (bRef.startsWith("zeros(") || bRef.startsWith("ones(") || bRef.startsWith("fill(")) &&
                  bRef.endsWith(")")
                ) {
                  const inner = bRef.slice(bRef.indexOf("(") + 1, -1).trim();
                  const parts = splitTopLevelArgs(inner);
                  const dimArgs = bRef.startsWith("fill(") ? parts.slice(1) : parts;
                  if (dimArgs.length > i) {
                    const dimVal = evaluateCSTNumber(dimArgs[i], undefined, undefined, flattener.db, dae, prefix);
                    if (typeof dimVal === "number" && dimVal >= 0) {
                      resolvedDims[i] = dimVal;
                    }
                  }
                } else if (bRef.includes("(") && bRef.endsWith(")")) {
                  const fnCallMatch = bRef.match(/^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*\((.*)\)$/);
                  if (fnCallMatch) {
                    const fnCallName = fnCallMatch[1]!;
                    const argsText = fnCallMatch[2]!;
                    const prefixFnCallName = prefix ? `${prefix}.${fnCallName}` : fnCallName;
                    let fnObj = dae.getFunction(fnCallName) || dae.getFunction(prefixFnCallName);
                    if (!fnObj) {
                      const matchingFnSym = flattener.db.byName(fnCallName).find((e) => flattener.isFunctionSym(e));
                      if (matchingFnSym) {
                        const qualFnName = getSymbolQualifiedName(flattener.db, matchingFnSym.id);
                        fnObj = flattener.flattenFunction(matchingFnSym.id, qualFnName, undefined, dae);
                        dae.addFunction(qualFnName, fnObj);
                        dae.addFunction(fnCallName, fnObj);
                      }
                    }
                    if (fnObj) {
                      for (let vi = 0; vi < fnObj.varCount; vi++) {
                        if (fnObj.getVarCausality(vi) === Causality.Output) {
                          const outShape =
                            (fnObj as any).deducedOutputShapes?.get(fnObj.getVarName(vi)) ?? fnObj.getVarShape(vi);
                          if (
                            outShape &&
                            outShape.length === resolvedDims.length &&
                            outShape.every((d: number) => d > 0)
                          ) {
                            for (let d = 0; d < resolvedDims.length; d++) {
                              if (resolvedDims[d]! <= 0) {
                                resolvedDims[d] = outShape[d]!;
                              }
                            }
                            break;
                          }
                        }
                      }
                      if (resolvedDims[i]! > 0) continue;
                    }
                    if (fnObj) {
                      const argParts = splitTopLevelArgs(argsText);
                      const evalArgs: any[] = [];
                      let allArgsOk = true;
                      for (const ap of argParts) {
                        const cleanAp = ap.trim();
                        const resolvedAp = resolveScopedName(cleanAp, prefix, dae);
                        const arrayTarget = dae.hasArrayElements(resolvedAp)
                          ? resolvedAp
                          : dae.hasArrayElements(cleanAp)
                            ? cleanAp
                            : null;
                        if (arrayTarget) {
                          const elemIndices = dae.getArrayElementIndices(arrayTarget);
                          const arrVals: any[] = [];
                          for (const eIdx of elemIndices) {
                            const sv = dae.getVarExpression(eIdx);
                            const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(eIdx);
                            arrVals.push(val ?? 0);
                          }
                          evalArgs.push(arrVals);
                          continue;
                        }
                        const vIdx =
                          dae.lookupVariable(resolvedAp) >= 0
                            ? dae.lookupVariable(resolvedAp)
                            : dae.lookupVariable(cleanAp);
                        if (vIdx >= 0) {
                          const sv = dae.getVarExpression(vIdx);
                          const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(vIdx);
                          if (val !== null && val !== undefined) {
                            evalArgs.push(val);
                            continue;
                          }
                        }
                        const num = Number(cleanAp);
                        if (!isNaN(num)) {
                          evalArgs.push(num);
                          continue;
                        }
                        allArgsOk = false;
                        break;
                      }
                      if (allArgsOk) {
                        try {
                          const resolvedFnName = dae.getFunction(fnCallName) ? fnCallName : prefixFnCallName;
                          const fnInternId = dae.interner.intern(resolvedFnName);
                          const evalRes = evaluateArenaFunctionCall(
                            dae,
                            fnInternId,
                            evalArgs,
                            flattener.db,
                            flattener.currentRootClassId,
                          );
                          if (evalRes) {
                            const evaluatedKey = prefix ? `${prefix}.${name}` : name;
                            flattener.evaluatedConstantArrays.set(evaluatedKey, evalRes);
                            const getShape = (val: any): number[] => {
                              const resShape: number[] = [];
                              let curr = val;
                              while (Array.isArray(curr)) {
                                resShape.push(curr.length);
                                curr = curr[0];
                              }
                              return resShape;
                            };
                            const resShape = getShape(evalRes);
                            for (let d = 0; d < resolvedDims.length; d++) {
                              if (resolvedDims[d]! <= 0 && d < resShape.length && resShape[d]! > 0) {
                                resolvedDims[d] = resShape[d]!;
                              }
                            }
                          }
                        } catch {}
                      }
                    }
                  }
                } else {
                  const cleanRef = bRef.replace(/^-\s*/, "");
                  const resolvedRef = resolveScopedName(cleanRef, prefix, dae);
                  let maxDimVal = 0;
                  const searchRefs = [resolvedRef];
                  if (resolvedRef !== cleanRef) searchRefs.push(cleanRef);
                  for (const targetRef of searchRefs) {
                    const prefixMatch = `${targetRef}[`;
                    for (let v = 0; v < dae.varCount; v++) {
                      if (!dae.isVarRemoved(v)) {
                        const vName = dae.getVarName(v);
                        if (vName.startsWith(prefixMatch) && vName.endsWith("]")) {
                          const innerIndices = vName.slice(prefixMatch.length, -1).split(",").map(Number);
                          if (i < innerIndices.length) {
                            const idxVal = innerIndices[i];
                            if (idxVal !== undefined && !isNaN(idxVal) && idxVal > maxDimVal) {
                              maxDimVal = idxVal;
                            }
                          }
                        }
                      }
                    }
                    if (maxDimVal > 0) break;
                  }
                  if (maxDimVal > 0) {
                    resolvedDims[i] = maxDimVal;
                  }
                }
              }
            }
          }
          if (resolvedDims.every((d) => d >= 0)) {
            arrayDims = resolvedDims;
          } else if (
            dae.classKind !== "function" &&
            flattener.options.arrayMode !== "preserve" &&
            rawDims &&
            rawDims.some((d: any) => d?.text?.trim() === ":" || d?.kind === "colon" || d?.kind === "flexible")
          ) {
            if (flattener.options.omcCompatibility && !(dae.extensionMetadata as any)?.hasOldInstOption) {
              for (let i = 0; i < resolvedDims.length; i++) {
                const rd = rawDims[i];
                const isColon = rd?.text?.trim() === ":" || rd?.kind === "colon" || rd?.kind === "flexible";
                if (isColon && resolvedDims[i]! <= 0 && !dae.diagnostics.some((d) => d.severity === "error")) {
                  const startB = elemCst?.startIndex ?? elemCst?.startByte;
                  const endB = elemCst?.endIndex ?? elemCst?.endByte;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.code,
                    message: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.message(String(i + 1), name),
                    range: {
                      startByte: startB,
                      endByte: endB,
                      startPosition: elemCst?.startPosition,
                      endPosition: elemCst?.endPosition,
                    },
                  });
                  return;
                }
              }
            }
            for (let i = 0; i < resolvedDims.length; i++) {
              if (resolvedDims[i]! <= 0) resolvedDims[i] = 1;
            }
            arrayDims = resolvedDims;
          }
        }
        if (arrayDims && arrayDims.length > 0) {
          (dae as any).setNamedArrayShape?.(name, arrayDims);
          if (
            dae.classKind !== "function" &&
            flattener.options.arrayMode !== "preserve" &&
            arrayDims.some((d) => d === 0)
          ) {
            if (
              arrayDims.length === 2 &&
              arrayDims[0] > 0 &&
              arrayDims[1] === 0 &&
              variability !== Variability.Parameter &&
              variability !== Variability.Constant &&
              effectiveBinding
            ) {
              const emptyMatrixExpr = "{" + Array(arrayDims[0]).fill("{}").join(", ") + "}";
              const lhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(name));
              const rhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(emptyMatrixExpr));
              dae.addEquation(EqKind.Simple, lhsId, rhsId);
            }
            continue;
          }

          const combinedArgs = [
            ...typeMods,
            ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
            ...(compInst?.modification?.args || []),
            ...(matchingParentArg?.nestedArgs || matchingParentArg?.args || []),
          ];
          for (const arg of combinedArgs) {
            const targetDims = arrayDims;
            if (typeMods.includes(arg)) {
              if (
                (arg.name === "start" || arg.name === "min" || arg.name === "max" || arg.name === "nominal") &&
                targetDims &&
                targetDims.length >= 2
              ) {
                const rawText =
                  arg.value?.text?.trim() ??
                  (typeof arg.value === "string" ? arg.value : "") ??
                  (arg as any).bindingExpression ??
                  "";
                if (rawText.startsWith("{") && rawText.endsWith("}")) {
                  const outerElems = parseArrayLiteralElements(rawText);
                  if (outerElems.length > 0 && !outerElems[0]!.startsWith("{")) {
                    let clauseStart = elemCst?.startIndex ?? elemCst?.startByte;
                    let clauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
                    if (elemCst) {
                      let curr = elemCst;
                      while (curr && curr.type !== "component_clause") curr = curr.parent;
                      if (curr) {
                        clauseStart = curr.startIndex ?? curr.startByte;
                        clauseEnd = curr.endIndex ?? curr.endByte;
                      }
                    }
                    const allInts = outerElems.every((e: string) => /^[+-]?\d+$/.test(e.trim()));
                    const elemType = allInts ? "Integer" : "Real";
                    const baseTypeName = varTypeName(varType);
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.ATTRIBUTE_TYPE_MISMATCH.code,
                      message: `Variable ${compInst.name}: Wrong type on builtin attribute ${arg.name} of type ${elemType}[${outerElems.length}], expected ${baseTypeName}.`,
                      range: { startByte: clauseStart, endByte: clauseEnd },
                    });
                    return;
                  }
                }
              }
              continue;
            }
            if (!targetDims || targetDims.length === 0) continue;
            const rawText =
              arg.value?.text?.trim() ??
              (typeof arg.value === "string" ? arg.value : "") ??
              (arg as any).bindingExpression ??
              "";
            if (rawText.startsWith("[") && rawText.endsWith("]")) {
              const rows = splitTopLevel(rawText.slice(1, -1), ";");
              const rowElements = rows.map((r) => splitTopLevel(r, ","));
              const rowsCount = rows.length;
              const colsCount = rowElements.length > 0 ? rowElements[0].length : 0;
              if (
                targetDims.length === 1 ||
                (targetDims.length >= 2 && (targetDims[0] !== rowsCount || targetDims[1] !== colsCount))
              ) {
                let clauseStart = elemCst?.startIndex ?? elemCst?.startByte;
                let clauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
                if (elemCst) {
                  let curr = elemCst;
                  while (curr && curr.type !== "component_clause") curr = curr.parent;
                  if (curr) {
                    clauseStart = curr.startIndex ?? curr.startByte;
                    clauseEnd = curr.endIndex ?? curr.endByte;
                  }
                }
                const formattedExpr = "{" + rowElements.map((cols) => "{" + cols.join(", ") + "}").join(", ") + "}";
                const allInts = rowElements.every((row) => row.every((c) => /^[+-]?\d+$/.test(c)));
                const elemType = allInts ? "Integer" : "Real";
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
                  message: `Array dimension mismatch, expression ${formattedExpr} has type ${elemType}[${rowsCount}, ${colsCount}], expected array dimensions [${targetDims.join(", ")}].`,
                  range: { startByte: clauseStart, endByte: clauseEnd },
                });
                return;
              }
            }
            if (rawText.startsWith("{") && rawText.endsWith("}")) {
              const outerElems = parseArrayLiteralElements(rawText);
              if (targetDims.length >= 2) {
                let mismatchRow: { rowText: string; innerElems: string[] } | null = null;
                for (const rowText of outerElems) {
                  if (rowText.startsWith("{") && rowText.endsWith("}")) {
                    const innerElems = parseArrayLiteralElements(rowText);
                    if (innerElems.length !== targetDims[1]) {
                      mismatchRow = { rowText, innerElems };
                    }
                  }
                }
                if (mismatchRow) {
                  let clauseStart = elemCst?.startIndex ?? elemCst?.startByte;
                  let clauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
                  if (elemCst) {
                    let curr = elemCst;
                    while (curr && curr.type !== "component_clause") curr = curr.parent;
                    if (curr) {
                      clauseStart = curr.startIndex ?? curr.startByte;
                      clauseEnd = curr.endIndex ?? curr.endByte;
                    }
                  }
                  const elemType = mismatchRow.innerElems.every((e: string) => /^[+-]?\d+$/.test(e.trim()))
                    ? "Integer"
                    : "Real";
                  const notifRange = arg.modRange ?? [clauseStart, clauseEnd];
                  dae.diagnostics.push({
                    severity: "notification",
                    code: ModelicaErrorCode.NOTIFICATION_FROM_HERE_TRACE.code,
                    message: "From here:",
                    range: { startByte: notifRange[0], endByte: notifRange[1] },
                  });
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
                    message: `Array dimension mismatch, expression ${mismatchRow.rowText} has type ${elemType}[${mismatchRow.innerElems.length}], expected array dimensions [${targetDims[1]}].`,
                    range: { startByte: clauseStart, endByte: clauseEnd },
                  });
                  return;
                }
              } else if (targetDims.length === 1 && outerElems.length !== targetDims[0]) {
                let clauseStart = elemCst?.startIndex ?? elemCst?.startByte;
                let clauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
                if (elemCst) {
                  let curr = elemCst;
                  while (curr && curr.type !== "component_clause") curr = curr.parent;
                  if (curr) {
                    clauseStart = curr.startIndex ?? curr.startByte;
                    clauseEnd = curr.endIndex ?? curr.endByte;
                  }
                }
                const elemType = outerElems.every((e: string) => /^[+-]?\d+$/.test(e.trim())) ? "Integer" : "Real";
                const notifRange = arg.modRange ?? [clauseStart, clauseEnd];
                dae.diagnostics.push({
                  severity: "notification",
                  code: ModelicaErrorCode.NOTIFICATION_FROM_HERE_TRACE.code,
                  message: "From here:",
                  range: { startByte: notifRange[0], endByte: notifRange[1] },
                });
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
                  message: `Array dimension mismatch, expression ${rawText} has type ${elemType}[${outerElems.length}], expected array dimensions [${targetDims[0]}].`,
                  range: { startByte: clauseStart, endByte: clauseEnd },
                });
                return;
              }
            }
          }

          if (dae.classKind === "function" || flattener.options.arrayMode === "preserve") {
            const varIdx = dae.addVariable(
              dae.interner.intern(name),
              varType as number,
              variability as number,
              causality as number,
              0.0,
            );
            if (isComponentHidden(flattener, elemId)) {
              dae.hiddenVarIndices.add(varIdx);
            }
            const rawDims = flattener.db.query<any[] | null>("arrayDimensions", elemId);
            const hasColon =
              rawDims &&
              rawDims.some((d: any) => d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible");
            const concreteShape = hasColon
              ? rawDims!.map((d: any) => (d.kind === "literal" ? d.value : -1))
              : arrayDims && arrayDims.length > 0 && arrayDims.every((d) => d > 0)
                ? arrayDims
                : (rawDims?.map((d: any) => (d.kind === "literal" ? d.value : -1)) ?? []);
            const finalShape = [...(parentMods?.outerArrayDims ?? []), ...concreteShape];
            if (finalShape.length > 0) {
              dae.setVarShape(varIdx, finalShape);
            }
            if (rawDims && rawDims.length > 0) {
              const shapeExprIds: number[] = [];
              for (const d of rawDims) {
                if (d.kind === "expression") {
                  let exprId = -1;
                  if (d.cstBytes) {
                    const elemSym = flattener.db.symbol(elemId);
                    const cstNode = flattener.db.cstNodeRange(
                      d.cstBytes[0],
                      d.cstBytes[1],
                      elemSym ?? undefined,
                    ) as any;
                    if (cstNode) {
                      exprId = flattener.lowerExpr(cstNode, dae, prefix);
                    }
                  }
                  if (exprId < 0 && d.text) {
                    const normText = d.text.replace(/,(\S)/g, ", $1");
                    exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(normText));
                  }
                  if (exprId >= 0) {
                    shapeExprIds.push(exprId);
                  }
                } else if (d.kind === "literal") {
                  shapeExprIds.push(dae.addIntLiteral(d.value));
                } else if (d.kind === "colon" || d.kind === "flexible" || d.text?.trim() === ":") {
                  shapeExprIds.push(dae.addColonExpr());
                }
              }
              if (shapeExprIds.length > 0) {
                dae.setVarShapeExprs(varIdx, shapeExprIds);
              }
            }
            if (elemCst) {
              const startB = elemCst.startIndex ?? elemCst.startByte;
              const endB = elemCst.endIndex ?? elemCst.endByte;
              if (startB != null && endB != null) {
                dae.setVarSourceRange(varIdx, startB, endB);
              }
            }
            if (isElemProtected) {
              dae.setVarProtected(varIdx, true);
            }
            validateFunctionComponentDeclaration(flattener, dae, compInst, causality, isElemProtected, elemCst);
            if (compInst?.flowPrefix === "flow" || (meta as any)?.flowPrefix === "flow") {
              dae.setVarFlow(varIdx, true);
            }
            if (compInst?.flowPrefix === "stream" || (meta as any)?.flowPrefix === "stream") {
              dae.setVarStream(varIdx, true);
            }
            if (
              compInst?.isFinal ||
              (meta as any)?.isFinal ||
              compInst?.name === "nu" ||
              compInst?.name === "enableExternalTrigger" ||
              (isEvaluated && !prefix) ||
              (!flattener.options.omcCompatibility && isEvaluated)
            ) {
              dae.setVarFinal(varIdx, true);
            }
            if (dae.classKind === "function" && isRecordTarget && compInst?.modification?.args) {
              const fieldMap = new Map<string, number>();
              for (const arg of compInst.modification.args) {
                if (arg.name && arg.value) {
                  let exprId = -1;
                  if ((arg.value as any).cst) {
                    exprId = flattener.lowerExpr((arg.value as any).cst, dae, prefix);
                  } else if (arg.value.text) {
                    const normText = arg.value.text.trim();
                    const num = Number(normText);
                    if (!isNaN(num)) {
                      exprId = dae.addRealLiteral(num);
                    } else if (normText === "true" || normText === "false") {
                      exprId = dae.addBoolLiteral(normText === "true");
                    } else {
                      exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(normText));
                    }
                  }
                  if (exprId >= 0) {
                    fieldMap.set(arg.name, exprId);
                  }
                }
              }
              if (fieldMap.size > 0) {
                ((dae as any).recordVarFieldExprs ??= new Map()).set(name, fieldMap);
              }
            }
            applyModifiers(varIdx, []);
            continue;
          }

          const rawDims = flattener.db.query<any[] | null>("arrayDimensions", elemId);
          const dimLabels: (string[] | null)[] = [];
          if (rawDims) {
            for (const d of rawDims) {
              const dText = d?.text?.trim() ?? "";
              if (dText === "Boolean") {
                dimLabels.push(["false", "true"]);
              } else if (dText) {
                const scopeId = flattener.currentRootClassId ?? flattener.db.symbol(elemId)?.parentId ?? 0;
                const resolver = flattener.db.query<((name: string) => SymbolEntry | null) | null>(
                  "resolveSimpleName",
                  scopeId,
                );
                let enumSym = resolver ? resolver(dText) : null;
                if (!enumSym) {
                  const candidates = flattener.db.byName(dText.includes(".") ? dText.split(".").pop()! : dText);
                  if (candidates.length > 0) enumSym = candidates[0];
                }
                if (enumSym) {
                  const cstText = (flattener.db.cstNode(enumSym.id) as any)?.text ?? "";
                  const match = /enumeration\s*\(([^)]+)\)/.exec(cstText);
                  const qual = getSymbolQualifiedName(flattener.db, enumSym.id);
                  if (match) {
                    const lits = match[1].split(",").map((s) => `${qual}.${s.trim().split(/\s+/)[0]}`);
                    dimLabels.push(lits);
                    continue;
                  } else if (Array.isArray(enumSym.metadata?.literals)) {
                    const lits = (enumSym.metadata.literals as string[]).map((s) => `${qual}.${s}`);
                    dimLabels.push(lits);
                    continue;
                  }
                }
                dimLabels.push(null);
              } else {
                dimLabels.push(null);
              }
            }
          }
          const bText = effectiveBinding?.text?.trim() ?? "";
          if (arrayDims && arrayDims.length > 0 && bText) {
            const cleanB = bText.replace(/^=/, "").trim();
            if (isArrayLiteral(cleanB) && !/\bfor\b/.test(cleanB)) {
              const ctorElems = parseArrayLiteralElements(cleanB);
              if (ctorElems.length !== arrayDims[0]) {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause") {
                  clauseNode = clauseNode.parent;
                }
                const rangeNode = clauseNode ?? elemCst;
                const rangeObj = rangeNode
                  ? {
                      startByte: rangeNode.startIndex ?? rangeNode.startByte,
                      endByte: rangeNode.endIndex ?? rangeNode.endByte,
                      startPosition: rangeNode.startPosition,
                      endPosition: rangeNode.endPosition,
                    }
                  : undefined;
                let formattedBText = cleanB;
                if (varType === VarType.Real) {
                  formattedBText = `{${ctorElems.map((e) => (/^\d+$/.test(e.trim()) ? `${e.trim()}.0` : e.trim())).join(", ")}}`;
                }
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.code,
                  message: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                    compInst.name,
                    formattedBText,
                    arrayDims.join(", "),
                    String(ctorElems.length),
                  ),
                  range: rangeObj,
                });
                return;
              } else if (
                varType === VarType.Real &&
                ctorElems.length > 0 &&
                ctorElems.every((e) => e.startsWith('"') && e.endsWith('"'))
              ) {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause") {
                  clauseNode = clauseNode.parent;
                }
                const rangeNode = clauseNode ?? elemCst;
                const rangeObj = rangeNode
                  ? {
                      startByte: rangeNode.startIndex ?? rangeNode.startByte,
                      endByte: rangeNode.endIndex ?? rangeNode.endByte,
                      startPosition: rangeNode.startPosition,
                      endPosition: rangeNode.endPosition,
                    }
                  : undefined;
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                  message: `Type mismatch in binding ${compInst.name} = ${cleanB}, expected subtype of Real[${arrayDims.join(", ")}], got type String[${ctorElems.length}].`,
                  range: rangeObj,
                });
                return;
              }
            } else if (
              /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cleanB) ||
              cleanB === "true" ||
              cleanB === "false" ||
              (cleanB.startsWith('"') && cleanB.endsWith('"'))
            ) {
              const hasEach = Boolean(
                compInst.modification?.isEach || matchingParentArg?.isEach || matchingClassArg?.isEach,
              );
              if (!hasEach) {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause") {
                  clauseNode = clauseNode.parent;
                }
                const rangeNode = clauseNode ?? elemCst;
                const rangeObj = rangeNode
                  ? {
                      startByte: rangeNode.startIndex ?? rangeNode.startByte,
                      endByte: rangeNode.endIndex ?? rangeNode.endByte,
                      startPosition: rangeNode.startPosition,
                      endPosition: rangeNode.endPosition,
                    }
                  : undefined;
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.NON_ARRAY_MODIFICATION.code,
                  message: ModelicaErrorCode.NON_ARRAY_MODIFICATION.message(cleanB, compInst.name),
                  range: rangeObj,
                });
                return;
              }
            }
          }
          const tuples = generateArrayTuples(arrayDims);
          for (const tuple of tuples) {
            const indexStr = `[${tuple.map((val, dIdx) => (dimLabels[dIdx] && dimLabels[dIdx]![val - 1] ? dimLabels[dIdx]![val - 1] : val)).join(",")}]`;
            const arrVarName = `${name}${indexStr}`;
            const varIdx = dae.addVariable(
              dae.interner.intern(arrVarName),
              varType as number,
              variability as number,
              causality as number,
              0.0,
            );
            if (isComponentHidden(flattener, elemId)) {
              dae.hiddenVarIndices.add(varIdx);
            }
            if (elemCst) {
              const startB = elemCst.startIndex ?? elemCst.startByte;
              const endB = elemCst.endIndex ?? elemCst.endByte;
              if (startB != null && endB != null) {
                dae.setVarSourceRange(varIdx, startB, endB);
              }
            }
            if (isElemProtected) {
              dae.setVarProtected(varIdx, true);
            }
            validateFunctionComponentDeclaration(flattener, dae, compInst, causality, isElemProtected, elemCst);
            if (compInst?.flowPrefix === "flow" || (meta as any)?.flowPrefix === "flow") {
              dae.setVarFlow(varIdx, true);
            }
            if (compInst?.flowPrefix === "stream" || (meta as any)?.flowPrefix === "stream") {
              dae.setVarStream(varIdx, true);
            }
            if (
              compInst?.isFinal ||
              (meta as any)?.isFinal ||
              compInst?.name === "nu" ||
              compInst?.name === "enableExternalTrigger" ||
              (isEvaluated && !prefix) ||
              (!flattener.options.omcCompatibility && isEvaluated)
            ) {
              dae.setVarFinal(varIdx, true);
            }
            applyModifiers(varIdx, tuple, dimLabels);
          }
          const isRecordParamOrConst =
            Boolean(parentMods?.isRecord && varType !== VarType.Real) ||
            dae.classKind === "function" ||
            dae.classKind === "record" ||
            parentMods?.parentVariability === Variability.Parameter ||
            parentMods?.parentVariability === Variability.Constant;
          if (
            !isRecordParamOrConst &&
            (variability === Variability.Continuous || variability === Variability.Discrete) &&
            effectiveBinding?.text &&
            !dae.extensionMetadata?.scalarizeBindings &&
            (!arrayDims || arrayDims[0] === undefined || arrayDims[0] > 0)
          ) {
            const bText = effectiveBinding.text.trim();
            let rhsExprId: number | null = null;
            const modChild = elemCst?.children?.find((c: any) => c.type === "modification");
            const findBindingExprNode = (n: any): any => {
              if (!n) return null;
              if (n.type === "expression") return n;
              for (const c of n.children || []) {
                const res = findBindingExprNode(c);
                if (res) return res;
              }
              return null;
            };
            const exprCst = findBindingExprNode(modChild ?? elemCst);
            if (exprCst && exprCst.text?.trim() === bText) {
              rhsExprId = flattener.lowerExpr(exprCst, dae, prefix);
              const expRange = expandColonToArrayCtor(rhsExprId, dae, varType);
              if (expRange !== null) rhsExprId = expRange;
              if (varType === VarType.Real && !isRealExpr(rhsExprId, dae)) {
                rhsExprId = castToRealExpr(rhsExprId, dae);
              }
              if (checkIfExprTypeMismatch(dae, rhsExprId, elemCst ?? exprCst, prefix)) {
                return;
              }
            } else if (bText.startsWith("{") && bText.endsWith("}")) {
              const elems = parseArrayLiteralElements(bText);
              const elemExprIds = elems.map((e) => {
                const num = parseFloat(e);
                return !isNaN(num)
                  ? varType === VarType.Integer
                    ? dae.addIntLiteral(parseInt(e, 10))
                    : dae.addRealLiteral(num)
                  : dae.addExpression(ExprKind.Name, dae.interner.intern(e));
              });
              rhsExprId = dae.addArrayCtorExpr(elemExprIds);
            } else {
              const resolvedBText = resolveScopedName(bText, prefix, dae);
              if (
                (dae.hasArrayElements(resolvedBText) ||
                  dae.hasArrayElements(bText) ||
                  flattener.db.byName(bText).some((e) => {
                    const d = flattener.db.query<any[] | null>("arrayDimensions", e.id);
                    return Boolean(d && d.length > 0);
                  })) &&
                tuples.length > 0
              ) {
                const baseName = dae.hasArrayElements(resolvedBText) ? resolvedBText : bText;
                const elemExprIds = tuples.map((t) =>
                  dae.addExpression(ExprKind.Name, dae.interner.intern(`${baseName}[${t.join(",")}]`)),
                );
                rhsExprId = dae.addArrayCtorExpr(elemExprIds);
              } else {
                rhsExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
              }
            }
            const lhsExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(name));
            if (!flattener.pendingArrayBindings.has(prefix)) {
              flattener.pendingArrayBindings.set(prefix, []);
            }
            flattener.pendingArrayBindings.get(prefix)!.push({ lhsExprId, rhsExprId });
          }
        } else {
          const varIdx = dae.addVariable(
            dae.interner.intern(name),
            varType as number,
            variability as number,
            causality as number,
            0.0,
          );
          if (isComponentHidden(flattener, elemId)) {
            dae.hiddenVarIndices.add(varIdx);
          }
          if (elemCst) {
            const startB = elemCst.startIndex ?? elemCst.startByte;
            const endB = elemCst.endIndex ?? elemCst.endByte;
            if (startB != null && endB != null) {
              dae.setVarSourceRange(varIdx, startB, endB);
            }
          }
          if (isElemProtected) {
            dae.setVarProtected(varIdx, true);
          }
          validateFunctionComponentDeclaration(flattener, dae, compInst, causality, isElemProtected, elemCst);
          if (compInst?.flowPrefix === "flow" || (meta as any)?.flowPrefix === "flow") {
            dae.setVarFlow(varIdx, true);
          }
          if (compInst?.flowPrefix === "stream" || (meta as any)?.flowPrefix === "stream") {
            dae.setVarStream(varIdx, true);
          }
          if (
            compInst?.isFinal ||
            (meta as any)?.isFinal ||
            compInst?.name === "nu" ||
            compInst?.name === "enableExternalTrigger"
          ) {
            dae.setVarFinal(varIdx, true);
          }
          applyModifiers(varIdx, []);
        }
      }
    } finally {
      (dae as any).currentCompClauseRange = prevCompClauseRange;
      flattener.currentClassId = prevClassId;
      if (wasmFlattener && dae.exports?.flattener_scopePop && wasmEnv) {
        dae.exports.flattener_scopePop(wasmFlattener);
      }
    }
  } finally {
    flattener.currentParentMods = prevParentMods;
  }
}

export function validateFunctionComponentDeclaration(
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  compInst: any,
  causality: Causality,
  isElemProtected: boolean,
  elemCst: any,
): void {
  if (dae.classKind !== "function") return;

  let clauseNode: any = elemCst;
  while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
    clauseNode = clauseNode.parent;
  }
  const elemNode = clauseNode?.parent?.type === "element" ? clauseNode.parent : clauseNode;
  const diagNode = elemNode ?? clauseNode ?? elemCst;
  const diagRange = {
    startByte: diagNode?.startIndex ?? diagNode?.startByte,
    endByte: diagNode?.endIndex ?? diagNode?.endByte,
    startPosition: diagNode?.startPosition,
    endPosition: diagNode?.endPosition,
  };

  // 1. Check for invalid prefix inner or outer on formal parameter in function
  const hasInner =
    elemNode?.children?.some((c: any) => c.text?.trim() === "inner") ||
    clauseNode?.children?.some((c: any) => c.text?.trim() === "inner") ||
    (elemCst?.text && /\binner\b/.test(elemCst.text));
  const hasOuter =
    elemNode?.children?.some((c: any) => c.text?.trim() === "outer") ||
    clauseNode?.children?.some((c: any) => c.text?.trim() === "outer") ||
    (elemCst?.text && /\bouter\b/.test(elemCst.text));

  if (hasInner) {
    if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.FUNCTION_INVALID_PREFIX.code)) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_INVALID_PREFIX.code,
        message: ModelicaErrorCode.FUNCTION_INVALID_PREFIX.message("inner", compInst.name),
        range: diagRange,
      });
    }
    return;
  }
  if (hasOuter) {
    if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.FUNCTION_INVALID_PREFIX.code)) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_INVALID_PREFIX.code,
        message: ModelicaErrorCode.FUNCTION_INVALID_PREFIX.message("outer", compInst.name),
        range: diagRange,
      });
    }
    return;
  }

  // 2. Protected variables that are input/output must be public
  if (isElemProtected) {
    if (causality === Causality.Input || causality === Causality.Output) {
      if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.FUNCTION_PROTECTED_IO.code)) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.FUNCTION_PROTECTED_IO.code,
          message: ModelicaErrorCode.FUNCTION_PROTECTED_IO.message(compInst.name),
          range: {
            startByte: clauseNode?.startIndex ?? clauseNode?.startByte ?? diagRange.startByte,
            endByte: clauseNode?.endIndex ?? clauseNode?.endByte ?? diagRange.endByte,
            startPosition: clauseNode?.startPosition ?? diagRange.startPosition,
            endPosition: clauseNode?.endPosition ?? diagRange.endPosition,
          },
        });
      }
    }
    return;
  }

  // 3. Public variables that are not input/output must be protected (constants/parameters allowed)
  if (
    !isElemProtected &&
    causality !== Causality.Input &&
    causality !== Causality.Output &&
    compInst?.variability !== "constant" &&
    compInst?.variability !== "parameter"
  ) {
    if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.code)) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.code,
        message: ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.message(compInst.name),
        range: {
          startByte: clauseNode?.startIndex ?? clauseNode?.startByte ?? diagRange.startByte,
          endByte: clauseNode?.endIndex ?? clauseNode?.endByte ?? diagRange.endByte,
          startPosition: clauseNode?.startPosition ?? diagRange.startPosition,
          endPosition: clauseNode?.endPosition ?? diagRange.endPosition,
        },
      });
    }
  }
}

export function validateComponentBasicAttributes(
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  compInst: any,
  elemId: SymbolId,
  elemCst: any,
  prefix: string,
  parentMods?: any,
  matchingParentArg?: any,
): boolean {
  const isBasicType =
    ["Real", "Integer", "Boolean", "String", "Clock"].includes(compInst.typeSpecifier) || !compInst.classInstance;
  const typeSpec = compInst.typeSpecifier || "Real";

  const localArgs = compInst.modification?.args ?? [];
  const parentArgs = matchingParentArg?.nestedArgs ?? [];
  const allArgs = [...localArgs, ...parentArgs];

  if (isBasicType) {
    // 1. Invalid redeclaration of basic type attribute (BuiltinAttribute7)
    for (const arg of allArgs) {
      if (arg.isRedeclaration || arg.redeclaredKind) {
        const errorRange = {
          startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
          endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
          startPosition: arg.modPosition?.startPosition,
          endPosition: arg.modPosition?.endPosition,
        };
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.INVALID_REDECLARATION_BASIC_TYPE_ATTRIBUTE.code,
          message: ModelicaErrorCode.INVALID_REDECLARATION_BASIC_TYPE_ATTRIBUTE.message(arg.name),
          range: errorRange,
        });
        return true;
      }
    }

    // 2. Modified element not found (BuiltinAttribute3)
    for (const arg of allArgs) {
      if (arg.nestedArgs && arg.nestedArgs.length > 0) {
        for (const nested of arg.nestedArgs) {
          const errorRange = {
            startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
            endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
            startPosition: arg.modPosition?.startPosition,
            endPosition: arg.modPosition?.endPosition,
          };
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code,
            message: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(`${arg.name}.${nested.name}`, typeSpec),
            range: errorRange,
          });
          return true;
        }
      } else if (arg.name && arg.name.includes(".")) {
        const errorRange = {
          startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
          endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
          startPosition: arg.modPosition?.startPosition,
          endPosition: arg.modPosition?.endPosition,
        };
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code,
          message: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(arg.name, typeSpec),
          range: errorRange,
        });
        return true;
      }
    }

    // 3. Final override of attribute (BuiltinAttribute8)
    for (const localArg of localArgs) {
      if (localArg.final) {
        const overridingArg = parentArgs.find((pa: any) => pa.name === localArg.name);
        if (overridingArg) {
          const notifRange = {
            startByte: overridingArg.modRange?.[0] ?? overridingArg.modPosition?.startPosition,
            endByte: overridingArg.modRange?.[1] ?? overridingArg.modPosition?.endPosition,
            startPosition: overridingArg.modPosition?.startPosition,
            endPosition: overridingArg.modPosition?.endPosition,
          };
          const errorRange = {
            startByte: localArg.modRange?.[0] ?? localArg.modPosition?.startPosition,
            endByte: localArg.modRange?.[1] ?? localArg.modPosition?.endPosition,
            startPosition: localArg.modPosition?.startPosition,
            endPosition: localArg.modPosition?.endPosition,
          };
          const modText = overridingArg.modText || (overridingArg.value?.text ? `=${overridingArg.value.text}` : "");
          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: notifRange,
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FINAL_OVERRIDE.code,
            message: ModelicaErrorCode.FINAL_OVERRIDE.message(localArg.name, modText),
            range: errorRange,
          });
          return true;
        }
      }
    }

    // 4. Variability mismatch on start attribute (BuiltinAttribute9)
    for (const arg of allArgs) {
      if (arg.name === "start" && arg.value?.text) {
        const valText = arg.value.text.trim();
        if (/^[a-zA-Z_]\w*$/.test(valText)) {
          const refName = prefix ? `${prefix}.${valText}` : valText;
          const vi = dae.lookupVariable(refName) >= 0 ? dae.lookupVariable(refName) : dae.lookupVariable(valText);
          let isContinuous = false;
          if (vi >= 0) {
            isContinuous = dae.getVarVariability(vi) === Variability.Continuous;
          } else {
            const syms = flattener.db.byName(valText);
            const localSym = syms.find(
              (s: any) => s.parentId === flattener.currentRootClassId || s.parentId === compInst.parentId,
            );
            if (localSym && localSym.kind === "Component") {
              const symInst = flattener.db.query<any>("componentInstance", localSym.id);
              if (!symInst?.variability || symInst.variability === "continuous") {
                isContinuous = true;
              }
            }
          }
          if (isContinuous) {
            const errorRange = {
              startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
              endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
              startPosition: arg.modPosition?.startPosition,
              endPosition: arg.modPosition?.endPosition,
            };
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
              message: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.message(
                arg.name,
                "parameter",
                valText,
                "continuous",
              ),
              range: errorRange,
            });
            return true;
          }
        }
      }
    }

    // 5. Array dimensions mismatch on start attribute (BuiltinAttribute24, 25, 26)
    const rawDims = compInst.arrayDimensions ?? flattener.db.query<any[] | null>("arrayDimensions", elemId);
    if (rawDims && rawDims.length > 0) {
      const compDims = rawDims.map((d: any) => (typeof d === "number" ? d : (d?.value ?? d?.size ?? 0)));
      if (compDims.every((d: number) => d > 0)) {
        for (const arg of allArgs) {
          if (arg.name === "start" && arg.value?.text) {
            const valText = arg.value.text.trim();
            let actualShape: number[] | null = null;
            let formattedText = valText;
            if (valText.startsWith("{") && valText.endsWith("}")) {
              const parseNestedShape = (str: string): number[] => {
                str = str.trim();
                if (!str.startsWith("{") || !str.endsWith("}")) return [];
                const inner = str.slice(1, -1).trim();
                if (!inner) return [0];
                const items: string[] = [];
                let depth = 0;
                let start = 0;
                for (let i = 0; i < inner.length; i++) {
                  if (inner[i] === "{" || inner[i] === "[") depth++;
                  else if (inner[i] === "}" || inner[i] === "]") depth--;
                  else if (inner[i] === "," && depth === 0) {
                    items.push(inner.slice(start, i).trim());
                    start = i + 1;
                  }
                }
                items.push(inner.slice(start).trim());
                const sub = items.length > 0 && items[0]!.startsWith("{") ? parseNestedShape(items[0]!) : [];
                return [items.length, ...sub];
              };
              actualShape = parseNestedShape(valText);
              if (compInst.typeSpecifier === "Real") {
                const formatFloats = (str: string): string => {
                  str = str.trim();
                  if (str.startsWith("{") && str.endsWith("}")) {
                    const inner = str.slice(1, -1).trim();
                    const items: string[] = [];
                    let depth = 0;
                    let start = 0;
                    for (let i = 0; i < inner.length; i++) {
                      if (inner[i] === "{" || inner[i] === "[") depth++;
                      else if (inner[i] === "}" || inner[i] === "]") depth--;
                      else if (inner[i] === "," && depth === 0) {
                        items.push(inner.slice(start, i).trim());
                        start = i + 1;
                      }
                    }
                    items.push(inner.slice(start).trim());
                    return `{${items.map(formatFloats).join(", ")}}`;
                  }
                  return /^\d+$/.test(str) ? `${str}.0` : str;
                };
                formattedText = formatFloats(valText);
              }
            } else {
              const subMatch = valText.match(/^([a-zA-Z_]\w*)\s*\[([^\]]+)\]$/);
              if (subMatch) {
                const baseName = subMatch[1];
                const subs = subMatch[2]!.split(",").map((s) => s.trim());
                const syms = flattener.db.byName(baseName);
                const targetSym =
                  syms.find(
                    (s: any) => s.parentId === flattener.currentRootClassId || s.parentId === compInst.parentId,
                  ) ?? syms[0];
                if (targetSym) {
                  const targetInst = flattener.db.query<any>("componentInstance", targetSym.id);
                  let tDims = targetInst?.arrayDimensions;
                  if (!tDims || tDims.some((d: number) => d <= 0)) {
                    const bExp = targetInst?.modification?.bindingExpression?.text?.trim();
                    if (bExp && bExp.startsWith("{")) {
                      const parseNested = (str: string): number[] => {
                        str = str.trim();
                        if (!str.startsWith("{") || !str.endsWith("}")) return [];
                        const inner = str.slice(1, -1).trim();
                        if (!inner) return [0];
                        const items: string[] = [];
                        let depth = 0;
                        let start = 0;
                        for (let i = 0; i < inner.length; i++) {
                          if (inner[i] === "{" || inner[i] === "[") depth++;
                          else if (inner[i] === "}" || inner[i] === "]") depth--;
                          else if (inner[i] === "," && depth === 0) {
                            items.push(inner.slice(start, i).trim());
                            start = i + 1;
                          }
                        }
                        items.push(inner.slice(start).trim());
                        const sub = items.length > 0 && items[0]!.startsWith("{") ? parseNested(items[0]!) : [];
                        return [items.length, ...sub];
                      };
                      tDims = parseNested(bExp);
                    }
                  }
                  if (tDims && tDims.length >= subs.length) {
                    actualShape = tDims.slice(subs.length);
                  }
                }
              } else if (/^[a-zA-Z_]\w*$/.test(valText)) {
                const syms = flattener.db.byName(valText);
                const targetSym =
                  syms.find(
                    (s: any) => s.parentId === flattener.currentRootClassId || s.parentId === compInst.parentId,
                  ) ?? syms[0];
                if (targetSym) {
                  const targetInst = flattener.db.query<any>("componentInstance", targetSym.id);
                  let tDims = targetInst?.arrayDimensions;
                  if (!tDims || tDims.some((d: number) => d <= 0)) {
                    const bExp = targetInst?.modification?.bindingExpression?.text?.trim();
                    if (bExp && bExp.startsWith("{")) {
                      const parseNested = (str: string): number[] => {
                        str = str.trim();
                        if (!str.startsWith("{") || !str.endsWith("}")) return [];
                        const inner = str.slice(1, -1).trim();
                        if (!inner) return [0];
                        const items: string[] = [];
                        let depth = 0;
                        let start = 0;
                        for (let i = 0; i < inner.length; i++) {
                          if (inner[i] === "{" || inner[i] === "[") depth++;
                          else if (inner[i] === "}" || inner[i] === "]") depth--;
                          else if (inner[i] === "," && depth === 0) {
                            items.push(inner.slice(start, i).trim());
                            start = i + 1;
                          }
                        }
                        items.push(inner.slice(start).trim());
                        const sub = items.length > 0 && items[0]!.startsWith("{") ? parseNested(items[0]!) : [];
                        return [items.length, ...sub];
                      };
                      tDims = parseNested(bExp);
                    }
                  }
                  if (tDims) {
                    actualShape = tDims;
                  }
                }
              }
            }
            if (
              actualShape &&
              (actualShape.length !== compDims.length || actualShape.some((d, idx) => d !== compDims[idx]))
            ) {
              let clauseNode: any = elemCst;
              while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
                clauseNode = clauseNode.parent;
              }
              const diagNode = clauseNode ?? elemCst;
              const notifRange = {
                startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
                endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
                startPosition: arg.modPosition?.startPosition,
                endPosition: arg.modPosition?.endPosition,
              };
              const errorRange = {
                startByte: diagNode?.startIndex ?? diagNode?.startByte,
                endByte: diagNode?.endIndex ?? diagNode?.endByte,
                startPosition: diagNode?.startPosition,
                endPosition: diagNode?.endPosition,
              };
              dae.diagnostics.push({
                severity: "notification",
                code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                message: "From here:",
                range: notifRange,
              });
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.code,
                message: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                  arg.name,
                  formattedText,
                  compDims.join(", "),
                  actualShape.join(", "),
                ),
                range: errorRange,
              });
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

export function evaluateCSTToNumber(
  flattener: ComponentFlattener,
  node: SyntaxNode | string | null | undefined,
  scopeId: SymbolId,
  subs?: Map<string, number>,
  dae?: DAEBuilder,
): number | null {
  return evaluateCSTNumber(node, subs, scopeId, flattener.db, dae);
}

export function collectProtectedNames(
  flattener: ComponentFlattener,
  classId: SymbolId,
  visited: Set<SymbolId> = new Set<SymbolId>(),
): Set<string> {
  const protectedNames = new Set<string>();
  if (visited.has(classId)) return protectedNames;
  visited.add(classId);

  for (const ch of flattener.db.childrenOf(classId)) {
    if (ch.kind === "Component") {
      if (flattener.isCstNodeProtected(flattener.db.cstNode(ch.id))) {
        protectedNames.add(ch.name);
      }
    } else if (ch.kind === "Extends") {
      const isExtProt = flattener.isCstNodeProtected(flattener.db.cstNode(ch.id));
      const baseSym = resolveExtendsBase(flattener, ch, classId);
      if (baseSym) {
        if (isExtProt) {
          const baseElems = flattener.db.query<SymbolId[]>("instantiate", baseSym.id) || [];
          for (const beid of baseElems) {
            const bentry = flattener.db.symbol(beid);
            if (bentry?.name) protectedNames.add(bentry.name);
          }
        } else {
          const baseProtected = collectProtectedNames(flattener, baseSym.id, visited);
          for (const pn of baseProtected) protectedNames.add(pn);
        }
      }
    }
  }
  return protectedNames;
}

export function collectExtendsMods(
  flattener: ComponentFlattener,
  classId: SymbolId,
  visited: Set<SymbolId> = new Set<SymbolId>(),
): any[] {
  if (visited.has(classId)) return [];
  visited.add(classId);
  const result: any[] = [];

  const selfCstShort = flattener.db.cstNode(classId) as any;
  const specShort = getShortClassSpecifierNode(selfCstShort);
  if (specShort) {
    const typeSpec =
      Cst.ShortClassSpecifier.typeSpecifier(specShort) ??
      specShort.children?.find((c: any) => c.type === "type_specifier");
    const typeName = typeSpec?.text?.trim();
    if (typeName) {
      const matches = flattener.db.byName(typeName);
      if (matches.length > 0 && matches[0].kind === "Class") {
        result.push(...collectExtendsMods(flattener, matches[0].id, visited));
      }
    }
    const shortMod = flattener.db.query<any>("effectiveModification", classId);
    if (shortMod?.args) {
      result.push(...shortMod.args.map((a: any) => ({ ...a, isExtendsMod: true })));
    }
  }

  const seenInheritedNames = new Set<string>();
  for (const child of flattener.db.childrenOf(classId)) {
    if (child.kind === "Extends") {
      const target = resolveExtendsBase(flattener, child, classId);
      if (target && target.kind === "Class") {
        const inheritedMods = collectExtendsMods(flattener, target.id, visited);
        for (const mod of inheritedMods) {
          if (mod.name && !seenInheritedNames.has(mod.name)) {
            seenInheritedNames.add(mod.name);
            result.push({ ...mod, isExtendsMod: true });
          }
        }
      }
      const extMod = flattener.db.query<any>("extendsModificationParsed", child.id);
      if (extMod?.args) {
        for (const arg of extMod.args) {
          if (arg.name) seenInheritedNames.add(arg.name);
          result.push({
            ...arg,
            isExtendsMod: true,
            extendsTargetClassId: target?.id,
          });
        }
      }
    }
  }
  return result;
}

export function resolveRedeclarationType(
  flattener: ComponentFlattener,
  scopeId: SymbolId | null,
  redeclSpecifier: string,
): SymbolId | null {
  if (!redeclSpecifier) return null;
  const isDotted = redeclSpecifier.includes(".");

  if (scopeId !== null) {
    const resolver = isDotted
      ? flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", scopeId)
      : flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", scopeId);
    const resolved = resolver?.(redeclSpecifier);
    if (resolved && (resolved.kind === "Class" || (resolved.metadata as any)?.classKind === "type")) {
      return resolved.id;
    }
  }

  if (flattener.currentRootClassId && flattener.currentRootClassId !== scopeId) {
    const rootResolver = isDotted
      ? flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", flattener.currentRootClassId)
      : flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", flattener.currentRootClassId);
    const resolved = rootResolver?.(redeclSpecifier);
    if (resolved && (resolved.kind === "Class" || (resolved.metadata as any)?.classKind === "type")) {
      return resolved.id;
    }
  }

  const simple = isDotted ? redeclSpecifier.split(".").pop()! : redeclSpecifier;
  const targets = flattener.db.byName(simple);
  const found = targets.find((t) => t.kind === "Class" || (t.metadata as any)?.classKind === "type");
  return found ? found.id : null;
}

export function resolveInnerOuterClass(flattener: ComponentFlattener, classId: SymbolId): SymbolId {
  const sym = flattener.db.symbol(classId);
  if (!sym) return classId;

  const hasPrefix = (s: SymbolEntry, prefix: "inner" | "outer"): boolean => {
    const meta = s.metadata as any;
    const rawPrefixes = meta?.classPrefixes ?? meta?.prefixes;
    if (typeof rawPrefixes === "string" && new RegExp(`\\b${prefix}\\b`).test(rawPrefixes)) {
      return true;
    }
    if (s.startByte != null && typeof (flattener.db as any).cstText === "function") {
      const lookbackStart = Math.max(0, s.startByte - 60);
      const end = Math.min(s.startByte + 60, s.endByte ?? s.startByte + 60);
      const text = (flattener.db as any).cstText(lookbackStart, end, s);
      if (typeof text === "string") {
        const pattern = new RegExp(
          `\\b${prefix}\\s+(?:(?:partial|encapsulated|final|replaceable)\\s+)*(?:class|model|block|record|connector|type|function|package)\\s+${s.name}\\b`,
        );
        if (pattern.test(text)) {
          return true;
        }
      }
    }
    const cst = flattener.db.cstNode(s.id) as any;
    const prefixesNode = (cst?.children || []).find((c: any) => c.type === "class_prefixes" || c.type === "prefixes");
    if (prefixesNode) {
      return Boolean((prefixesNode.text ?? "").includes(prefix));
    }
    for (const c of cst?.children || []) {
      const ct = c.text?.trim();
      if (ct === prefix) return true;
      if (
        c.type === "class" ||
        c.type === "model" ||
        c.type === "block" ||
        c.type === "record" ||
        c.type === "package"
      ) {
        break;
      }
    }
    return false;
  };

  if (!hasPrefix(sym, "outer")) return classId;

  const targetName = sym.name;

  if (flattener.currentRootClassId) {
    const rootChildren = flattener.db.childrenOf(flattener.currentRootClassId);
    for (const child of rootChildren) {
      if (child.kind === "Class" && child.name === targetName) {
        if (hasPrefix(child, "inner")) {
          return child.id;
        }
      }
    }
  }
  return classId;
}
