// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExprKind } from "@modelscript/dsl";
import { type SyntaxNode } from "../../../../src-gen/bindings.js";

import { DAEBuilder, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { ModelicaErrorCode } from "../../../errors.js";
import {
  containsWholeWordOutsideStrings,
  evalDaeExpr,
  extractAsciiIdentifiers,
  hasColonSubscript,
  isArrayLiteral,
  isAsciiDigitsOnly,
  isAsciiIdentifier,
  isDottedIdentifierChain,
  isSignedAsciiNumberText,
  parseArrayLiteralElements,
  parseSizeCallIdentDim,
  splitTopLevel,
  stripArraySubscripts,
  stripLeadingEquals,
  stripTrailingArraySubscripts,
} from "../../expressions/index.js";
import { getElementDiagRange } from "../../support/range-utils.js";
import { getNamedArrayShape, setNamedArrayShape } from "../../support/state.js";
import { type ComponentInstanceData, type ComponentModArgData } from "../../types.js";
import { resolveExtendsBase } from "./modifications.js";
import {
  getCstNode,
  getCstNodeRange,
  getDaeExtMeta,
  modArgDiagRange,
  toDiagnosticRange,
  type ArrayDimRawEntry,
  type ComponentFlattener,
  type ComponentInstanceInfo,
  type ExtendedFlatteningState,
  type InstantiateElementsFn,
  type ModArgData,
  type ParentModData,
  type PhaseAction,
  type PrePassResult,
} from "./types.js";
import { validateClassModifiers } from "./validation.js";
import { getOrCreateWasmEnv } from "./wasm-env.js";

export function runPrePassAndOuterChecks(
  flattener: ComponentFlattener,
  elements: SymbolId[],
  prefix: string,
  dae: DAEBuilder,
  state: ExtendedFlatteningState,
  parentMods?: ParentModData | null,
): PrePassResult {
  // ============================================================================
  // Phase 1: Pre-Pass Metadata Lookup, `inner` Registration & Shape Deduction
  // ============================================================================
  const compInstMap = new Map<SymbolId, ComponentInstanceInfo | undefined>();
  const declaredNames = new Set<string>();
  const oldInstExpandedCompInst = new Map<SymbolId, ComponentInstanceInfo>();
  if (getDaeExtMeta(dae)?.hasOldInstOption) {
    const expandedElements: SymbolId[] = [];
    const collectInheritedCompChain = (
      clsId: SymbolId,
      compName: string,
      visited = new Set<SymbolId>(),
    ): SymbolEntry[] => {
      if (visited.has(clsId)) return [];
      visited.add(clsId);
      const chain: SymbolEntry[] = [];
      for (const ch of flattener.db.childrenOf(clsId)) {
        if (ch.kind === "Extends") {
          const base = resolveExtendsBase(flattener, ch, clsId);
          if (base && base.kind === "Class") {
            chain.push(...collectInheritedCompChain(base.id, compName, visited));
          }
        } else if (ch.kind === "Component" && ch.name === compName) {
          chain.push(ch);
        }
      }
      return chain;
    };
    for (const elemId of elements) {
      const compInst = flattener.db.query<ComponentInstanceInfo>("componentInstance", elemId);
      const elemSym = flattener.db.symbol(elemId);
      if (
        compInst &&
        elemSym?.kind === "Component" &&
        elemSym.parentId != null &&
        (compInst.isRedeclare || flattener.db.query<boolean>("isRedeclare", elemId))
      ) {
        const chain = collectInheritedCompChain(elemSym.parentId, compInst.name);
        const replaceableTargets = chain.filter((c, idx) => {
          if (idx === 0) return true;
          const ci = flattener.db.query<ComponentInstanceInfo>("componentInstance", c.id);
          const isRed = Boolean(ci?.isRedeclare || flattener.db.query<boolean>("isRedeclare", c.id));
          const isRep = Boolean(ci?.isReplaceable || flattener.db.query<boolean>("isReplaceable", c.id));
          return isRed && isRep;
        });
        if (replaceableTargets.length > 1) {
          const leafArgs = compInst.modification?.args || [];
          for (const targetSym of replaceableTargets) {
            const targetCi = flattener.db.query<ComponentInstanceInfo>("componentInstance", targetSym.id);
            if (targetCi) {
              const mergedArgs =
                targetSym.id === elemId
                  ? targetCi.modification?.args || []
                  : [...(targetCi.modification?.args || []), ...leafArgs];
              oldInstExpandedCompInst.set(targetSym.id, {
                ...targetCi,
                isRedeclare: true,
                modification: {
                  ...targetCi.modification,
                  args: mergedArgs,
                },
              });
              expandedElements.push(targetSym.id);
            }
          }
          continue;
        }
      }
      expandedElements.push(elemId);
    }
    elements = expandedElements;
  }
  for (const elemId of elements) {
    const baseCompInst =
      oldInstExpandedCompInst.get(elemId) ?? flattener.db.query<ComponentInstanceInfo>("componentInstance", elemId);
    // MLS §5.4: an `outer` without a matching `inner` gets an implicit top-level `inner` instance of the
    // same type. While that instance is being created the element is treated as `inner`.
    const compInst =
      baseCompInst && flattener.implicitInnerElem === elemId
        ? { ...baseCompInst, isOuter: false, isInner: true }
        : baseCompInst;
    compInstMap.set(elemId, compInst);
    if (compInst?.name && compInst?.typeSpecifier) {
      if (!compInst.typeSpecifier.includes(".") && compInst.name === compInst.typeSpecifier) {
        const elemCst = getCstNode(flattener.db, elemId);
        let clauseNode: SyntaxNode | null = elemCst;
        while (clauseNode && clauseNode.type !== "component_clause") {
          clauseNode = clauseNode.parent;
        }
        const rangeObj = clauseNode
          ? {
              startOffset: clauseNode.startIndex ?? clauseNode.startOffset,
              endOffset: clauseNode.endIndex ?? clauseNode.endOffset,
            }
          : elemCst
            ? {
                startOffset: elemCst.startIndex ?? elemCst.startOffset,
                endOffset: elemCst.endIndex ?? elemCst.endOffset,
              }
            : undefined;
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.SAME_NAME_TYPE_SHADOWING.code,
          message: `Found a component with same name when looking for type ${compInst.typeSpecifier}.`,
          range: rangeObj,
        });
        return {
          aborted: true,
          elements,
          compInstMap,
          basePrefix: "",
          wasmEnv: null,
          wasmFlattener: undefined,
          prevCompClauseRange: state.currentCompClauseRange,
          prevClassId: flattener.currentClassId,
        };
      }
    }

    const sym = flattener.db.symbol(elemId);
    if (sym?.name) {
      if (!compInst?.isOuter || compInst.isInner) {
        declaredNames.add(sym.name);
      }
    }

    // Register `inner` declarations at the current hierarchical prefix so nested `outer`
    // components can resolve upward to their matching `inner` instance path.
    if (compInst?.isInner && compInst?.name) {
      const fullCompName = prefix ? `${prefix}.${compInst.name}` : compInst.name;
      if (!flattener.innerDeclarations.has(prefix)) {
        flattener.innerDeclarations.set(prefix, new Map<string, string>());
      }
      flattener.innerDeclarations.get(prefix)!.set(compInst.name, fullCompName);
      (state.innerComponents ??= new Set<string>()).add(fullCompName);
    }

    // Pre-compute array dimensions for flexible `[:]` declarations bound to array literals
    // so sibling components referencing `size(arr, d)` can resolve dimensions in any order.
    const elemCstForShape = getCstNode(flattener.db, elemId);
    const elemHasColonSubscript = hasColonSubscript(elemCstForShape?.text ?? "", true);
    if (compInst?.name && elemHasColonSubscript && compInst?.modification?.bindingExpression?.text) {
      const fullName = prefix ? `${prefix}.${compInst.name}` : compInst.name;
      const rawText = stripLeadingEquals(compInst.modification.bindingExpression.text.trim());
      if (isArrayLiteral(rawText) && !containsWholeWordOutsideStrings(rawText, "for")) {
        const elems = parseArrayLiteralElements(rawText);
        if (elems.length > 0) {
          if (isArrayLiteral(elems[0]?.trim() ?? "")) {
            const inner = parseArrayLiteralElements(elems[0]!.trim());
            setNamedArrayShape(dae, fullName, [elems.length, inner.length]);
          } else {
            setNamedArrayShape(dae, fullName, [elems.length]);
          }
        }
      } else {
        const signedIdent = rawText.startsWith("+") || rawText.startsWith("-") ? rawText.slice(1).trimStart() : rawText;
        if (isAsciiIdentifier(signedIdent)) {
          const targetFull = prefix ? `${prefix}.${signedIdent}` : signedIdent;
          const refShape = getNamedArrayShape(dae, targetFull) ?? getNamedArrayShape(dae, signedIdent);
          if (refShape && refShape.length > 0) {
            setNamedArrayShape(dae, fullName, [...refShape]);
          }
        }
      }
    }

    if (compInst?.variability === "constant") {
      const mod = compInst.modification;
      if (mod?.bindingExpression) {
        const bindExpr = mod.bindingExpression;
        const targetScopeId = bindExpr.evaluationScopeId ?? elemId ?? flattener.currentRootClassId;
        const scopeSym = targetScopeId ? flattener.db.symbol(targetScopeId) : undefined;
        const bindCst = bindExpr.cstBytes
          ? getCstNodeRange(flattener.db, bindExpr.cstBytes[0], bindExpr.cstBytes[1], scopeSym ?? undefined)
          : null;
        if (bindCst) {
          const lowered = flattener.lowerExpr(bindCst, dae, prefix);
          if (lowered < 0 && dae.diagnostics.some((d) => d.severity === "error")) {
            return {
              aborted: true,
              elements,
              compInstMap,
              basePrefix: "",
              wasmEnv: null,
              wasmFlattener: undefined,
              prevCompClauseRange: state.currentCompClauseRange,
              prevClassId: flattener.currentClassId,
            };
          }
        }
      }
    }
  }

  if (parentMods?.args) {
    for (const arg of parentMods.args) {
      if (arg?.name) {
        declaredNames.add(arg.name);
        if (prefix && arg.value?.text) {
          const fullName = `${prefix}.${arg.name}`;
          const rawText = stripLeadingEquals(arg.value.text.trim());
          if (isArrayLiteral(rawText)) {
            const elems = parseArrayLiteralElements(rawText);
            if (elems.length > 0) {
              if (isArrayLiteral(elems[0]?.trim() ?? "")) {
                const inner = parseArrayLiteralElements(elems[0]!.trim());
                setNamedArrayShape(dae, fullName, [elems.length, inner.length]);
              } else {
                setNamedArrayShape(dae, fullName, [elems.length]);
              }
            }
          } else if (rawText.startsWith("[") && rawText.endsWith("]")) {
            const rows = splitTopLevel(rawText.slice(1, -1), ";");
            if (rows.length > 0) {
              const cols = splitTopLevel(rows[0]!, ",");
              setNamedArrayShape(dae, fullName, [rows.length, cols.length]);
            }
          }
        }
      }
    }
    if (prefix) {
      // General inference for components with `start:size(arr, dim)` default bindings
      // and sibling components dimensioned by `size(...)` or dependent size parameters
      const inferredDimParams = new Map<string, number>();
      for (const elemId of elements) {
        const elemSym = flattener.db.symbol(elemId);
        if (!elemSym || elemSym.kind !== "Component") continue;
        const hasExplicitMod = parentMods.args.some((a) => a.name === elemSym.name);
        if (hasExplicitMod) continue;
        const ci = flattener.db.query<ComponentInstanceInfo | null>("componentInstance", elemId);
        const bText = stripLeadingEquals(
          (ci?.modification?.bindingExpression?.text ?? ci?.modification?.value?.text ?? "").trim(),
        );
        const colonPos = bText.indexOf(":");
        const startPart = colonPos > 0 ? bText.slice(0, colonPos).trim() : "";
        const rangeSizeCall =
          colonPos > 0 && isAsciiDigitsOnly(startPart) ? parseSizeCallIdentDim(bText.slice(colonPos + 1)) : null;
        if (rangeSizeCall) {
          const startIdx = parseInt(startPart, 10);
          const targetArr = rangeSizeCall.target;
          const dimIdx = rangeSizeCall.dim - 1;
          const targetShape = getNamedArrayShape(dae, `${prefix}.${targetArr}`);
          if (targetShape && dimIdx >= 0 && dimIdx < targetShape.length) {
            const len = Math.max(0, targetShape[dimIdx]! - startIdx + 1);
            if (len > 0) {
              setNamedArrayShape(dae, `${prefix}.${elemSym.name}`, [len]);
            }
          }
        }
        const sizeCallMatch = parseSizeCallIdentDim(bText);
        if (sizeCallMatch) {
          const targetArr = sizeCallMatch.target;
          const dimIdx = sizeCallMatch.dim - 1;
          const targetShape = getNamedArrayShape(dae, `${prefix}.${targetArr}`);
          if (targetShape && dimIdx >= 0 && dimIdx < targetShape.length && targetShape[dimIdx]! > 0) {
            inferredDimParams.set(elemSym.name, targetShape[dimIdx]!);
          }
        }
      }
      if (inferredDimParams.size > 0) {
        for (const elemId of elements) {
          const elemSym = flattener.db.symbol(elemId);
          if (!elemSym || elemSym.kind !== "Component") continue;
          const ci = flattener.db.query<ComponentInstanceInfo | null>("componentInstance", elemId);
          const dims = ci?.arrayDimensions;
          if (Array.isArray(dims) && dims.length === 1) {
            const firstDim = dims[0] as number | ArrayDimRawEntry | undefined;
            const dText = String(
              (typeof firstDim === "object" && firstDim !== null ? firstDim.text : undefined) ?? firstDim ?? "",
            ).trim();
            const resolvedLen = inferredDimParams.get(dText);
            if (resolvedLen !== undefined && resolvedLen > 0) {
              setNamedArrayShape(dae, `${prefix}.${elemSym.name}`, [resolvedLen]);
            }
          }
        }
      }
    }
  }
  state.flattener = flattener;
  if (!state.scopeDeclaredNames) {
    state.scopeDeclaredNames = new Map<string, Set<string>>();
  }
  state.scopeDeclaredNames.set(prefix, declaredNames);
  const basePrefix = stripArraySubscripts(prefix);
  if (basePrefix !== prefix) {
    state.scopeDeclaredNames.set(basePrefix, declaredNames);
  }

  const syncWasmEnv = Boolean(flattener.options?.syncWasmEnv);
  const wasmEnv = syncWasmEnv ? getOrCreateWasmEnv(flattener, dae, parentMods) : null;
  const wasmFlattener = syncWasmEnv
    ? (state.wasmFlattener ?? (dae.exports?.flattener_create ? dae.exports.flattener_create(dae.ptr) : 0))
    : 0;
  if (syncWasmEnv) {
    state.wasmFlattener = wasmFlattener;
  }

  if (wasmFlattener && dae.exports?.flattener_scopePush && wasmEnv) {
    const prefixId = prefix ? dae.interner.intern(prefix) : 0;
    dae.exports.flattener_scopePush(wasmFlattener, 0, wasmEnv.envPtr, prefixId, 0);
  }

  const prevCompClauseRange = state.currentCompClauseRange;
  const prevClassId = flattener.currentClassId;
  if (parentMods?.componentClauseRange) {
    state.currentCompClauseRange = parentMods.componentClauseRange;
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
        return {
          aborted: true,
          elements,
          compInstMap,
          basePrefix: "",
          wasmEnv: null,
          wasmFlattener: undefined,
          prevCompClauseRange: state.currentCompClauseRange,
          prevClassId: flattener.currentClassId,
        };
      }
    }
    for (const child of flattener.db.childrenOf(targetClassForOuter)) {
      if (child.kind === "Extends") {
        const base = resolveExtendsBase(flattener, child, targetClassForOuter);
        const extMod = flattener.db.query<ParentModData | null>("extendsModificationParsed", child.id);
        if (extMod?.args && extMod.args.length > 0 && base && base.kind === "Class") {
          if (!validateClassModifiers(flattener, base.id, extMod.args, dae)) {
            return {
              aborted: true,
              elements,
              compInstMap,
              basePrefix: "",
              wasmEnv: null,
              wasmFlattener: undefined,
              prevCompClauseRange: state.currentCompClauseRange,
              prevClassId: flattener.currentClassId,
            };
          }
        }
      }
      if (child.kind === "Class") {
        const childCst = getCstNode(flattener.db, child.id);
        const elemParent = childCst?.parent?.type === "element" ? childCst.parent : childCst?.parent?.parent;
        const isOuterClass = elemParent?.children?.some((ch) => ch.type === "outer" || ch.text === "outer");
        const isInnerClass = elemParent?.children?.some((ch) => ch.type === "inner" || ch.text === "inner");
        if (isOuterClass && !isInnerClass) {
          // 1. Check if outer class itself has a class modification
          let spec = childCst?.children?.find(
            (ch) => ch.type === "class_specifier" || ch.type === "short_class_specifier",
          );
          if (spec?.children?.[0]?.type === "short_class_specifier") spec = spec.children[0];
          const modNode = spec?.children?.find((ch) => ch.type === "class_modification" || ch.type === "modification");
          if (modNode) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.OUTER_MODIFIER.code,
              message: ModelicaErrorCode.OUTER_MODIFIER.message(modNode.text?.trim() ?? "", child.name),
              range: {
                startOffset: spec?.startIndex ?? spec?.startOffset ?? modNode.startIndex,
                endOffset: spec?.endIndex ?? spec?.endOffset ?? modNode.endIndex,
                startPosition: spec?.startPosition ?? modNode.startPosition,
                endPosition: spec?.endPosition ?? modNode.endPosition,
              },
            });
            return {
              aborted: true,
              elements,
              compInstMap,
              basePrefix: "",
              wasmEnv: null,
              wasmFlattener: undefined,
              prevCompClauseRange: state.currentCompClauseRange,
              prevClassId: flattener.currentClassId,
            };
          }

          // 2. Check if parentMods has a modifier or redeclaration targeting this outer class
          const classModArg = parentMods?.args?.find((a) => !a.isBreak && a.name === child.name);
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
              range: modArgDiagRange(classModArg),
            });
            return {
              aborted: true,
              elements,
              compInstMap,
              basePrefix: "",
              wasmEnv: null,
              wasmFlattener: undefined,
              prevCompClauseRange: state.currentCompClauseRange,
              prevClassId: flattener.currentClassId,
            };
          }
        }
      }
    }
  }

  return {
    aborted: false,
    elements,
    compInstMap,
    basePrefix,
    wasmEnv,
    wasmFlattener,
    prevCompClauseRange,
    prevClassId,
  };
}

export function evaluateInnerOuterAndCondition(
  flattener: ComponentFlattener,
  elements: SymbolId[],
  elemId: SymbolId,
  compInst: ComponentInstanceInfo,
  fullCompName: string,
  elemCst: SyntaxNode | null,
  prefix: string,
  dae: DAEBuilder,
  state: ExtendedFlatteningState,
  parentMods: ParentModData | null | undefined,
  recurse: InstantiateElementsFn,
): { action: PhaseAction; isStateOutput: boolean } {
  // ============================================================================
  // Phase 2: `inner`/`outer` Binding & Conditional (`if <cond>`) Pruning
  // ============================================================================
  const isStateOutput = Boolean(compInst.isOuter && compInst.causality === "output");
  if (compInst.isOuter && !compInst.isInner) {
    // Check if component has modification in its own declaration (InnerOuterInvalidMod1)
    if (
      !flattener.isOldFrontend &&
      !dae.extensionMetadata?.["isOldFrontend"] &&
      (compInst.modification?.bindingExpression ||
        (compInst.modification?.args && compInst.modification.args.length > 0))
    ) {
      let declNode: SyntaxNode | null = elemCst;
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
          startOffset: declNode?.startIndex ?? declNode?.startOffset,
          endOffset: declNode?.endIndex ?? declNode?.endOffset,
          startPosition: declNode?.startPosition,
          endPosition: declNode?.endPosition,
        },
      });
      return { action: "return", isStateOutput };
    }

    // Check if parentMods targets this outer component (InnerOuterInvalidMod2 & InnerOuterInvalidMod3)
    const matchingOuterArg = parentMods?.args?.find((a) => !a.isBreak && a.name === compInst.name);
    if (
      !flattener.isOldFrontend &&
      !dae.extensionMetadata?.["isOldFrontend"] &&
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
        range: modArgDiagRange(matchingOuterArg),
      });
      return { action: "return", isStateOutput };
    }

    // Walk upward along the instance prefix chain (`a.b.c` -> `a.b` -> `a` -> `""`)
    // to bind this `outer` reference to the nearest enclosing `inner` declaration.
    let p: string | null = prefix;
    let foundInner = false;
    while (p !== null) {
      const innerMap = flattener.innerDeclarations.get(p);
      if (innerMap && innerMap.has(compInst.name)) {
        foundInner = true;
        const targetInner = innerMap.get(compInst.name)!;
        (state.outerToInner ??= new Map<string, string>()).set(fullCompName, targetInner);
        break;
      }
      p = p.includes(".") ? p.split(".").slice(0, -1).join(".") : p === "" ? null : "";
    }

    if (
      !foundInner &&
      prefix !== "" &&
      flattener.options.omcCompatibility &&
      !flattener.implicitInnerElem &&
      !flattener.db
        .childrenOf(flattener.currentRootClassId)
        .some((c) => c.kind === "Component" && c.name === compInst.name)
    ) {
      // Create the implicit `inner` (e.g. `SysData`) at the top level, then bind this `outer` to it.
      flattener.implicitInnerElem = elemId;
      const savedClassId = flattener.currentClassId;
      try {
        recurse(flattener, [elemId], "", dae, undefined);
      } finally {
        flattener.implicitInnerElem = null;
        flattener.currentClassId = savedClassId;
      }
      if (flattener.innerDeclarations.get("")?.has(compInst.name)) {
        foundInner = true;
        (state.outerToInner ??= new Map<string, string>()).set(fullCompName, compInst.name);
        const targetClassId = flattener.db.query<SymbolId | null>("classInstance", elemId);
        if (targetClassId) {
          flattener.implicitInners.push({ name: compInst.name, classId: targetClassId });
        }
      }
    }

    if (!foundInner) {
      if (prefix === "") {
        let declNode: SyntaxNode | null = elemCst;
        let pNode = elemCst?.parent;
        while (
          pNode &&
          (pNode.type === "component_declaration" || pNode.type === "component_clause" || pNode.type === "element")
        ) {
          declNode = pNode;
          pNode = pNode.parent;
        }
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.TOP_LEVEL_OUTER_ELEMENT.code,
          message: ModelicaErrorCode.TOP_LEVEL_OUTER_ELEMENT.message(compInst.name),
          range: {
            startOffset: declNode?.startIndex ?? declNode?.startOffset,
            endOffset: declNode?.endIndex ?? declNode?.endOffset,
            startPosition: declNode?.startPosition,
            endPosition: declNode?.endPosition,
          },
        });
        return { action: "return", isStateOutput };
      } else {
        // Check if an existing declaration with the same name exists in the root class
        const rootChildren = flattener.currentRootClassId ? flattener.db.childrenOf(flattener.currentRootClassId) : [];
        const existingDecl = rootChildren.find((c) => c.kind === "Component" && c.name === compInst.name);
        if (existingDecl) {
          const existingCst = getCstNode(flattener.db, existingDecl.id);
          let existingElem = existingCst?.parent;
          while (existingElem && existingElem.type !== "element" && existingElem.parent) {
            existingElem = existingElem.parent;
          }
          const isExistingInner = existingElem?.children?.some((ch) => ch.type === "inner" || ch.text === "inner");
          if (!isExistingInner) {
            let declNode: SyntaxNode | null = elemCst;
            let pNode = elemCst?.parent;
            while (
              pNode &&
              (pNode.type === "component_declaration" || pNode.type === "component_clause" || pNode.type === "element")
            ) {
              declNode = pNode;
              pNode = pNode.parent;
            }
            const notifRange = state.currentCompClauseRange ?? parentMods?.componentClauseRange;
            if (notifRange) {
              dae.diagnostics.push({
                severity: "notification",
                code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                message: "From here:",
                range: toDiagnosticRange(notifRange),
              });
            }
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.INNER_NOT_FOUND_EXISTING_DECL.code,
              message: ModelicaErrorCode.INNER_NOT_FOUND_EXISTING_DECL.message(compInst.name),
              range: {
                startOffset: declNode?.startIndex ?? declNode?.startOffset,
                endOffset: declNode?.endIndex ?? declNode?.endOffset,
                startPosition: declNode?.startPosition,
                endPosition: declNode?.endPosition,
              },
            });
            return { action: "return", isStateOutput };
          }
        }
      }
    }

    if (!isStateOutput) {
      return { action: "continue", isStateOutput };
    }
  }
  if (isStateOutput) {
    (state.stateOutputVars ??= new Set<string>()).add(fullCompName);
  }
  if (compInst.isOuter && compInst.isInner) {
    flattener.innerOuterComponents.add(fullCompName);
  }

  const cyclicDiags = flattener.db.query<Array<{ dimIndex: number; exprText: string }> | null>(
    "cyclicDimensionInfo",
    elemId,
  );
  if (cyclicDiags && cyclicDiags.length > 0) {
    const d = cyclicDiags[0]!;
    let clauseNode: SyntaxNode | null = elemCst;
    while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
      clauseNode = clauseNode.parent;
    }
    const rangeNode = clauseNode ?? elemCst;
    dae.diagnostics.push({
      severity: "error",
      code: ModelicaErrorCode.CYCLIC_DIMENSION_DEPENDENCY.code,
      message: ModelicaErrorCode.CYCLIC_DIMENSION_DEPENDENCY.message(String(d.dimIndex + 1), compInst.name, d.exprText),
      range: rangeNode
        ? {
            startOffset: rangeNode.startIndex ?? rangeNode.startOffset,
            endOffset: rangeNode.endIndex ?? rangeNode.endOffset,
            startPosition: rangeNode.startPosition,
            endPosition: rangeNode.endPosition,
          }
        : undefined,
    });
    return { action: "return", isStateOutput };
  }

  // Check conditional component attribute ('if <cond>')
  let conditionAttrNode: SyntaxNode | null = null;
  if (elemCst) {
    const findCondAttr = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
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
    const condExpr = conditionAttrNode.children?.find((c: SyntaxNode) => c.type === "expression");
    if (condExpr) {
      const condText = condExpr.text?.trim() ?? "";
      const condMatches = extractAsciiIdentifiers(condText, true);
      const depNames = condMatches.filter(
        (m: string) => m !== "true" && m !== "false" && m !== "not" && m !== "and" && m !== "or",
      );
      if (depNames.length > 0) {
        const resolvedDeps = depNames.map((d: string) => (prefix && !d.includes(".") ? `${prefix}.${d}` : d));
        flattener.varConditionDeps.set(fullCompName, resolvedDeps);
        if (prefix) {
          flattener.varConditionDeps.set(compInst.name, resolvedDeps);
        }
        if (!dae.extensionMetadata?.["isOldFrontend"]) {
          for (const rDep of resolvedDeps) {
            (state.pendingFinalParamNames ??= new Set<string>()).add(rDep);
          }
        }
      }
      let condVal: boolean | null = null;
      if (condText === "true") condVal = true;
      else if (condText === "false") condVal = false;
      const isNeg = condText.startsWith("not ");
      const varName = isNeg ? condText.substring(4).trim() : condText;
      const extractSimpleArgVal = (modArg?: ModArgData | ComponentModArgData | null): boolean | number | null => {
        if (!modArg?.value) return null;
        const mv = modArg.value;
        if (mv.kind === "literal" && (typeof mv.value === "boolean" || typeof mv.value === "number")) {
          return mv.value;
        }
        const txt = mv.text?.trim();
        if (txt === "true") return true;
        if (txt === "false") return false;
        if (txt && isSignedAsciiNumberText(txt)) return Number(txt);
        return null;
      };
      const evalScalarTextInDaeOrDb = (
        exprText: string,
        scopePrefix: string,
        scopeClassId?: SymbolId,
        depth = 0,
      ): boolean | number | null => {
        if (depth > 8) return null;
        const t = exprText.trim();
        if (t === "true") return true;
        if (t === "false") return false;
        const num = Number(t);
        if (!isNaN(num) && t !== "") return num;
        if (isDottedIdentifierChain(t)) {
          // 1. Check component-level modifications (parentMods.args) first, e.g.
          //    `H_PMOS(useTemperatureDependency=true)` with `extends ConditionalHeatPort(useHeatPort=useTemperatureDependency)`.
          if (!t.includes(".") && parentMods?.args) {
            const modArg = parentMods.args
              .slice()
              .reverse()
              .find((a) => !a.isBreak && a.name === t);
            if (modArg?.value) {
              const directMod = extractSimpleArgVal(modArg);
              if (directMod !== null) return directMod;
              if (modArg.value.text && modArg.value.text.trim() !== t) {
                const chainedMod = evalScalarTextInDaeOrDb(
                  modArg.value.text,
                  modArg.originPrefix ?? scopePrefix,
                  modArg.evaluationScopeId ?? modArg.ownerClassId ?? scopeClassId,
                  depth + 1,
                );
                if (chainedMod !== null) return chainedMod;
              }
            }
          }
          // 2. Check DAE variables under current prefix, scopePrefix, and unqualified name.
          const candidateNames = [
            ...(prefix ? [`${prefix}.${t}`] : []),
            ...(scopePrefix && scopePrefix !== prefix ? [`${scopePrefix}.${t}`] : []),
            t,
          ];
          let refIdx = -1;
          for (const cand of candidateNames) {
            const idx = dae.getVarIdxByName(cand);
            if (idx >= 0) {
              refIdx = idx;
              break;
            }
          }
          if (refIdx >= 0) {
            const refExpr = dae.getVarExpression(refIdx);
            if (refExpr !== undefined && refExpr >= 0) {
              const ev = evalDaeExpr(refExpr, dae);
              if (typeof ev === "boolean" || typeof ev === "number") return ev;
            }
          }
          // Fall back to resolving the symbol from the enclosing class in QueryDB (handles
          // parameters declared after an `extends` clause that passes them into a redeclare mod).
          if (!t.includes(".") && flattener.db) {
            let targetClassId = scopeClassId ?? flattener.currentRootClassId;
            if (scopeClassId === undefined && scopePrefix && flattener.currentRootClassId) {
              let cid: SymbolId | undefined = flattener.currentRootClassId;
              for (const seg of scopePrefix.split(".")) {
                if (cid === undefined) break;
                const segClean = stripTrailingArraySubscripts(seg);
                const els: SymbolId[] = flattener.db.query<SymbolId[]>("instantiate", cid) ?? [];
                const foundId: SymbolId | undefined = els.find(
                  (eid: SymbolId) => flattener.db.symbol(eid)?.name === segClean,
                );
                const nextCls: SymbolId | { id?: SymbolId | null } | null =
                  foundId !== undefined
                    ? flattener.db.query<SymbolId | { id?: SymbolId | null } | null>("classInstance", foundId)
                    : null;
                const nextCid: SymbolId | null | undefined = typeof nextCls === "number" ? nextCls : nextCls?.id;
                if (nextCid === undefined || nextCid === null) {
                  cid = undefined;
                  break;
                }
                cid = nextCid;
              }
              if (cid !== undefined) targetClassId = cid;
            }
            if (targetClassId !== undefined) {
              const scopeEls = flattener.db.query<SymbolId[]>("instantiate", targetClassId) ?? [];
              const compId = scopeEls.find((eid: SymbolId) => flattener.db.symbol(eid)?.name === t);
              if (compId !== undefined) {
                const compData = flattener.db.query<ComponentInstanceData>("componentInstance", compId);
                const bindTxt = compData?.modification?.bindingExpression?.text?.trim();
                if (bindTxt === "true") return true;
                if (bindTxt === "false") return false;
                if (bindTxt && isSignedAsciiNumberText(bindTxt)) return Number(bindTxt);
                const startEntry = compData?.modification?.args
                  ?.slice()
                  .reverse()
                  .find((sa: ComponentModArgData) => !sa.isBreak && sa.name === "start");
                const simpleStart = extractSimpleArgVal(startEntry);
                if (simpleStart !== null) return simpleStart;
              }
            }
          }
        }
        return null;
      };
      const arg: ModArgData | undefined = parentMods?.args
        ?.slice()
        .reverse()
        .find((a) => !a.isBreak && a.name === varName);
      const fallbackParentPrefix = prefix.includes(".") ? prefix.split(".").slice(0, -1).join(".") : "";
      const argOriginPrefix = arg?.originPrefix ?? fallbackParentPrefix;
      if (arg?.value) {
        const direct = extractSimpleArgVal(arg);
        if (typeof direct === "boolean") {
          condVal = isNeg ? !direct : direct;
        } else if (arg.value.text) {
          const resolved = evalScalarTextInDaeOrDb(
            arg.value.text,
            argOriginPrefix,
            arg.evaluationScopeId ?? arg.ownerClassId,
          );
          if (typeof resolved === "boolean") {
            condVal = isNeg ? !resolved : resolved;
          }
        }
      } else if (arg && (arg.nestedArgs || arg.args)) {
        const startArg = (arg.nestedArgs || arg.args)
          ?.slice()
          .reverse()
          .find((na) => !na.isBreak && na.name === "start");
        const directStart = extractSimpleArgVal(startArg);
        if (typeof directStart === "boolean") {
          condVal = isNeg ? !directStart : directStart;
        } else if (startArg?.value?.text) {
          const resolved = evalScalarTextInDaeOrDb(
            startArg.value.text,
            argOriginPrefix,
            arg.evaluationScopeId ?? arg.ownerClassId,
          );
          if (typeof resolved === "boolean") {
            condVal = isNeg ? !resolved : resolved;
          }
        }
      }
      if (condVal === null) {
        const vIdx = dae.getVarIdxByName(prefix ? `${prefix}.${varName}` : varName);
        if (vIdx >= 0) {
          const exprId = dae.getVarExpression(vIdx);
          if (exprId !== undefined && exprId >= 0) {
            if (dae.getExprKind(exprId) === ExprKind.BoolLiteral) {
              const b = dae.getExprData1(exprId) !== 0;
              condVal = isNeg ? !b : b;
            } else {
              const evaluated = evalDaeExpr(exprId, dae);
              if (typeof evaluated === "boolean") {
                condVal = isNeg ? !evaluated : evaluated;
              } else if (typeof evaluated === "number") {
                condVal = isNeg ? evaluated === 0 : evaluated !== 0;
              }
            }
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
        return { action: "return", isStateOutput };
      }
      if (condVal === null) {
        const savedDiagLen = dae.diagnostics.length;
        try {
          let condSubs: Map<string, number | string> | undefined;
          if (parentMods?.args) {
            for (const a of parentMods.args) {
              if (a.isBreak || !a.name) continue;
              const effectiveArg =
                a.value !== undefined
                  ? a
                  : (a.nestedArgs || a.args)
                      ?.slice()
                      .reverse()
                      .find((na) => !na.isBreak && na.name === "start");
              if (!effectiveArg?.value) continue;
              const simpleVal = extractSimpleArgVal(effectiveArg);
              if (typeof simpleVal === "boolean") {
                condSubs ??= new Map();
                condSubs.set(a.name, simpleVal ? "true" : "false");
              } else if (typeof simpleVal === "number") {
                condSubs ??= new Map();
                condSubs.set(a.name, simpleVal);
              } else if (effectiveArg.value.text) {
                const resolved = evalScalarTextInDaeOrDb(
                  effectiveArg.value.text,
                  a.originPrefix ?? fallbackParentPrefix,
                  a.evaluationScopeId ?? a.ownerClassId,
                );
                if (typeof resolved === "boolean") {
                  condSubs ??= new Map();
                  condSubs.set(a.name, resolved ? "true" : "false");
                } else if (typeof resolved === "number") {
                  condSubs ??= new Map();
                  condSubs.set(a.name, resolved);
                }
              }
            }
          }
          const findExprInMod = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
            if (!n || n.type === "class_modification" || n.type === "ClassModification") return null;
            if (n.type === "expression" || n.type === "Expression") return n;
            for (const c of n.children || []) {
              const r = findExprInMod(c);
              if (r) return r;
            }
            return null;
          };
          const findModExpr = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
            if (!n) return null;
            if (n.type === "modification" || n.type === "Modification") {
              return findExprInMod(n);
            }
            for (const c of n.children || []) {
              const r = findModExpr(c);
              if (r) return r;
            }
            return null;
          };
          for (const dep of depNames) {
            if (condSubs?.has(dep)) continue;
            const fullDep = prefix ? `${prefix}.${dep}` : dep;
            if (dae.getVarIdxByName(fullDep) >= 0) continue;
            const siblingId = elements.find((eid) => flattener.db.symbol(eid)?.name === dep);
            if (siblingId !== undefined) {
              const sibCst = flattener.db.cstNode(siblingId) as SyntaxNode | null | undefined;
              const sibBindExpr = findModExpr(sibCst);
              if (sibBindExpr) {
                const sibDiagLen = dae.diagnostics.length;
                const loweredSibId = flattener.lowerExpr(sibBindExpr, dae, prefix, condSubs);
                if (loweredSibId >= 0 && dae.diagnostics.length === sibDiagLen) {
                  const evaluated = evalDaeExpr(loweredSibId, dae);
                  if (typeof evaluated === "boolean") {
                    condSubs ??= new Map();
                    condSubs.set(dep, evaluated ? "true" : "false");
                  } else if (typeof evaluated === "number") {
                    condSubs ??= new Map();
                    condSubs.set(dep, evaluated);
                  }
                }
                dae.diagnostics.length = sibDiagLen;
              } else {
                const sibInst = flattener.db.query<ComponentInstanceData>("componentInstance", siblingId);
                const sibStart = sibInst?.modification?.args
                  ?.slice()
                  .reverse()
                  .find((sa: ComponentModArgData) => !sa.isBreak && sa.name === "start");
                const simpleSibStart = extractSimpleArgVal(sibStart);
                if (typeof simpleSibStart === "boolean") {
                  condSubs ??= new Map();
                  condSubs.set(dep, simpleSibStart ? "true" : "false");
                } else if (typeof simpleSibStart === "number") {
                  condSubs ??= new Map();
                  condSubs.set(dep, simpleSibStart);
                } else if (sibStart?.value?.cstBytes) {
                  const sibCstBytes = sibStart.value.cstBytes;
                  const startNode = getCstNodeRange(
                    flattener.db,
                    sibCstBytes[0],
                    sibCstBytes[1],
                    flattener.db.symbol(siblingId) ?? undefined,
                  );
                  if (startNode) {
                    const sibDiagLen = dae.diagnostics.length;
                    const loweredStartId = flattener.lowerExpr(startNode, dae, prefix, condSubs);
                    if (loweredStartId >= 0 && dae.diagnostics.length === sibDiagLen) {
                      const evaluated = evalDaeExpr(loweredStartId, dae);
                      if (typeof evaluated === "boolean") {
                        condSubs ??= new Map();
                        condSubs.set(dep, evaluated ? "true" : "false");
                      } else if (typeof evaluated === "number") {
                        condSubs ??= new Map();
                        condSubs.set(dep, evaluated);
                      }
                    }
                    dae.diagnostics.length = sibDiagLen;
                  }
                }
              }
            }
          }
          const loweredCondId = flattener.lowerExpr(condExpr, dae, prefix, condSubs);
          if (loweredCondId >= 0 && dae.diagnostics.length === savedDiagLen) {
            const evaluated = evalDaeExpr(loweredCondId, dae);
            if (typeof evaluated === "boolean") {
              condVal = evaluated;
            }
          }
        } catch {
          /* fallback on evaluation error */
        }
        if (condVal === null) {
          dae.diagnostics.length = savedDiagLen;
        }
      }
      if (condVal === null) {
        if (getDaeExtMeta(dae)?.hasOldInstOption && flattener.currentRootClassId) {
          const rootSym = flattener.db.symbol(flattener.currentRootClassId);
          const rootName = rootSym?.name ?? "";
          const otherElem = flattener.db
            .childrenOf(flattener.currentRootClassId)
            ?.find((c) => c.name === condText && c.kind === "Component");
          if (otherElem) {
            const otherCst = getCstNode(flattener.db, otherElem.id);
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
              return { action: "return", isStateOutput };
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
        return { action: "return", isStateOutput };
      }
      if (condVal === false) {
        flattener.disabledComponents.add(fullCompName);
        return { action: "continue", isStateOutput };
      }
    }
  }

  return { action: "proceed", isStateOutput };
}
