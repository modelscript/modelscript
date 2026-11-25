// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExprKind } from "@modelscript/dsl";

import {
  BinOp,
  Causality,
  DAEBuilder,
  Variability,
  VarType,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import { isPredefinedType } from "../../../predefined-types.js";
import {
  getShortClassSpecifierNode,
  isScopeEncapsulated,
  isSymbolEncapsulated,
  resolveQualified,
  type ScopeData,
} from "../../../queries.js";
import {
  extractAsciiIdentifiers,
  getSymbolQualifiedName,
  hasEquationAssignmentForNameCst,
  isAsciiIdentifier,
  isDottedIdentifierChain,
  isSignedAsciiNumberText,
  parseBinaryIdentSubtraction,
  resolveScopedName,
  stripLeadingEquals,
  tokenizeCommentStrippedWords,
} from "../../expressions/index.js";
import { getElementDiagRange } from "../../support/range-utils.js";
import { extractDescription, hasDotStarSuffix, hasReplaceablePrefixText, isComponentHidden } from "./cst-helpers.js";
import { isClassType, resolveExtendsBase } from "./modifications.js";
import {
  checkTypeAliasSpecialization,
  resolveInnerOuterClass,
  resolveRedeclarationType,
} from "./redeclare-and-alias.js";
import {
  getCstNode,
  getCstNodeRange,
  getSymMeta,
  modArgDiagRange,
  type ComponentFlattener,
  type ComponentInstanceInfo,
  type DaeExtensionMetadataLike,
  type ExtendedDaeBuilder,
  type ExtendedFlatteningState,
  type ModArgData,
  type ParentModData,
  type ResolvedComponentContext,
} from "./types.js";
import { validateFunctionComponentDeclaration } from "./validation.js";

export type Phase3Result =
  { action: "continue" | "break" | "return" } | { action: "proceed"; ctx: ResolvedComponentContext };

export function runFastPathAndResolveComponentType(
  flattener: ComponentFlattener,
  elemId: SymbolId,
  compInst: ComponentInstanceInfo,
  elemCst: SyntaxNode | null,
  prefix: string,
  dae: DAEBuilder,
  extDae: ExtendedDaeBuilder,
  state: ExtendedFlatteningState,
  parentMods: ParentModData | null | undefined,
  matchingParentArg: ModArgData | undefined,
  isStateOutput: boolean,
): Phase3Result {
  // ============================================================================
  // Phase 3: Fast-Path Scalar Instantiation (Primitive Un-Modified Scalars)
  // ============================================================================
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
          const m = extractAsciiIdentifiers(inner);
          const hasContinuous = m.some((vName) => {
            if (vName === "time") return true;
            const vi = dae.getVarIdxByName(prefix ? `${prefix}.${vName}` : vName);
            return vi >= 0 && dae.getVarVariability(vi) === Variability.Continuous;
          });
          if (hasContinuous) {
            let clauseNode: SyntaxNode | null = elemCst;
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
            return { action: "return" };
          }
        }
      }

      if (variability === Variability.Parameter && bText) {
        const bTrim = bText.trim();
        if (bTrim === "initial()" || bTrim === "terminal()") {
          let clauseNode: SyntaxNode | null = elemCst;
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
          return { action: "return" };
        }
      }

      const elemParentId = flattener.db.symbol(elemId)?.parentId;
      const elemParentSym = elemParentId != null ? flattener.db.symbol(elemParentId) : null;
      const elemParentMeta = getSymMeta(elemParentSym);
      const isElemParentPackage =
        elemParentSym?.kind === "Package" ||
        String(elemParentMeta.classKind ?? elemParentMeta.classPrefixes ?? "").includes("package");
      if (
        variability === Variability.Constant &&
        prefix &&
        !parentMods?.isRecord &&
        parentMods?.parentVariability !== Variability.Constant &&
        flattener.currentClassId &&
        elemParentId !== flattener.currentClassId &&
        (isElemParentPackage || Boolean(dae.extensionMetadata?.["isOldFrontend"]))
      ) {
        return { action: "continue" };
      }
      // Allow constants inside components to be instantiated in DAE
      if (
        variability === Variability.Constant &&
        (prefix || elemParentId !== flattener.currentRootClassId) &&
        bText &&
        isAsciiIdentifier(bText)
      ) {
        const targetConst = resolveScopedName(bText, prefix, dae);
        const targetIdx =
          dae.getVarIdxByName(targetConst) >= 0
            ? dae.getVarIdxByName(targetConst)
            : dae.getVarIdxByName(`${targetConst}[1]`) >= 0
              ? dae.getVarIdxByName(`${targetConst}[1]`)
              : dae.getVarIdxByName(`${targetConst}[1,1]`);
        if (targetIdx >= 0 && dae.getVarVariability(targetIdx) === Variability.Constant) {
          (state.constantAliases ??= new Map<string, string>()).set(name, targetConst);
          return { action: "continue" };
        }
      }

      // Structural parameter evaluation (`annotation(Evaluate = true)`):
      // In non-OMC compatibility mode, promote `Evaluate = true` parameters to `Constant`
      // so downstream constant folding and alias elimination inline their values.
      const isEvaluated = flattener.db.query<boolean>("isEvaluate", elemId);
      if (!flattener.options.omcCompatibility && isEvaluated && variability === Variability.Parameter) {
        variability = Variability.Constant;
      } else if (
        isEvaluated &&
        variability === Variability.Parameter &&
        !dae.extensionMetadata?.["isOldFrontend"] &&
        !flattener.isOldFrontend
      ) {
        (state.evaluatedParams ??= new Set<string>()).add(name);
        const extMeta = (dae.extensionMetadata ??= {});
        ((extMeta["evaluatedParams"] ??= new Set<string>()) as Set<string>).add(name);
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
          return { action: "return" };
        }
      }

      let causality = Causality.Local;
      if (compInst.causality === "input") causality = Causality.Input;
      else if (compInst.causality === "output") causality = Causality.Output;
      else if (parentMods?.parentCausality !== undefined) causality = parentMods.parentCausality;
      if (causality === Causality.Output) {
        const extMeta = (dae.extensionMetadata ??= {}) as DaeExtensionMetadataLike;
        if (!extMeta.outputVars) extMeta.outputVars = new Set<string>();
        extMeta.outputVars.add(name);
      }

      const isTopLevelConnector = Boolean(parentMods?.isConnector && !parentMods?.hasNonConnectorParent);
      const isTopLevelRecordWithCausality = Boolean(
        parentMods?.isRecord &&
        !parentMods?.hasNonConnectorParent &&
        parentMods?.parentCausality !== undefined &&
        parentMods.parentCausality !== Causality.Local,
      );
      const shouldKeepCausality = isTopLevelConnector || isTopLevelRecordWithCausality || flattener.useLocalDirection;
      const _isEnclosingFunction =
        dae.classKind === "function" ||
        Boolean(
          flattener.currentClassId &&
          getSymMeta(flattener.db.symbol(flattener.currentClassId)).classKind === "function",
        );
      if (prefix && !isStateOutput && !shouldKeepCausality) {
        causality = Causality.Local;
      }

      const hasEqInClass = (): boolean => {
        if (!flattener.currentClassId) return false;
        const cst = getCstNode(flattener.db, flattener.currentClassId);
        return hasEquationAssignmentForNameCst(cst, compInst.name);
      };

      if (
        !dae.extensionMetadata?.["isOldFrontend"] &&
        !hasEqInClass() &&
        variability === Variability.Constant &&
        !bText &&
        !parentMods?.bindingExpression &&
        !_isEnclosingFunction &&
        causality === Causality.Local
      ) {
        if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.code)) {
          let clauseNode: SyntaxNode | null = elemCst;
          while (clauseNode && clauseNode.type !== "component_clause") {
            clauseNode = clauseNode.parent;
          }
          const rangeNode = clauseNode ?? elemCst;
          const rangeObj = rangeNode
            ? {
                startOffset: rangeNode.startIndex ?? rangeNode.startOffset,
                endOffset: rangeNode.endIndex ?? rangeNode.endOffset,
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
        return { action: "return" };
      }

      const varIdx = dae.addVariable(dae.interner.intern(name), varType, variability, causality, 0.0);
      if (parentMods?.outerArrayDims && parentMods.outerArrayDims.length > 0) {
        dae.setVarShape(varIdx, parentMods.outerArrayDims);
        dae.setVarShapeExprs(
          varIdx,
          parentMods.outerArrayDims.map((od: number) => dae.addIntLiteral(od)),
        );
      }
      validateFunctionComponentDeclaration(flattener, dae, compInst, causality, false, elemCst);
      if (isComponentHidden(flattener, elemId)) {
        dae.hiddenVarIndices.add(varIdx);
      }

      const sym = flattener.db.symbol(elemId);
      let clauseNode: SyntaxNode | null = elemCst;
      while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
        clauseNode = clauseNode.parent;
      }
      const targetRangeNode = clauseNode ?? elemCst;
      const sb = targetRangeNode?.startIndex ?? targetRangeNode?.startOffset ?? sym?.startOffset;
      const eb = targetRangeNode?.endIndex ?? targetRangeNode?.endOffset ?? sym?.endOffset;
      if (sb != null && eb != null) {
        dae.setVarSourceRange(varIdx, sb, eb);
      }
      if (
        compInst.flowPrefix === "flow" ||
        getSymMeta(sym).flowPrefix === "flow" ||
        parentMods?.parentFlowPrefix === "flow"
      ) {
        dae.setVarFlow(varIdx, true);
      }
      if (
        compInst.flowPrefix === "stream" ||
        getSymMeta(sym).flowPrefix === "stream" ||
        parentMods?.parentFlowPrefix === "stream"
      ) {
        dae.setVarStream(varIdx, true);
      }
      if (compInst.isFinal) dae.setVarFinal(varIdx, true);

      const descText = extractDescription(getCstNode(flattener.db, elemId));
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
            if (arg.isBreak || arg.value?.kind === "break" || arg.value?.text?.trim() === "break") {
              dae.removeVarAttr(varIdx, arg.name);
              continue;
            }
            let attrExprId: number | null = null;
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
                    litName = ssLiterals[Math.round(evalVal) - 1]!;
                  }
                } catch {
                  /* fallback on evaluation error */
                }
              }
              if (litName) {
                const idx = ssLiterals.indexOf(litName);
                attrExprId = dae.addEnumLiteral(idx >= 0 ? idx + 1 : 1, `StateSelect.${litName}`);
              } else if (rawText.includes("[")) {
                let attrCst: SyntaxNode | null = arg.value?.cstBytes
                  ? getCstNodeRange(flattener.db, arg.value.cstBytes[0], arg.value.cstBytes[1], sym ?? undefined)
                  : null;
                if (!attrCst && elemCst) {
                  const findCref = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
                    if (!n) return null;
                    if ((n.type === "component_reference" || n.type === "expression") && n.text?.trim() === rawText) {
                      return n;
                    }
                    for (const c of n.children || []) {
                      const f = findCref(c);
                      if (f) return f;
                    }
                    return null;
                  };
                  attrCst = findCref(elemCst);
                }
                if (attrCst) {
                  attrExprId = flattener.lowerExpr(attrCst, dae, prefix);
                }
              }
            } else if (arg.value?.kind === "literal" && typeof arg.value.value === "number") {
              attrExprId =
                varType === VarType.Integer ? dae.addIntLiteral(arg.value.value) : dae.addRealLiteral(arg.value.value);
            } else if (arg.value?.kind === "literal" && typeof arg.value.value === "boolean") {
              attrExprId = dae.addExpression(ExprKind.BoolLiteral, arg.value.value ? 1 : 0);
            } else if (arg.value?.kind === "literal" && typeof arg.value.value === "string") {
              attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(arg.value.value));
            } else if (arg.value?.kind === "expression" && arg.value.text) {
              const rawText = arg.value.text.trim();
              const num = Number(rawText);
              if (!isNaN(num)) {
                attrExprId = varType === VarType.Integer ? dae.addIntLiteral(Math.round(num)) : dae.addRealLiteral(num);
              } else if (rawText === "true" || rawText === "false") {
                attrExprId = dae.addExpression(ExprKind.BoolLiteral, rawText === "true" ? 1 : 0);
              } else if (rawText.startsWith('"') && rawText.endsWith('"')) {
                try {
                  attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(JSON.parse(rawText)));
                } catch {
                  attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(rawText.slice(1, -1)));
                }
              } else {
                let resolvedT = isDottedIdentifierChain(rawText) ? resolveScopedName(rawText, prefix, dae) : rawText;
                let isDaeVar =
                  arg.name === "start" &&
                  (dae.getVarIdxByName(resolvedT) >= 0 || dae.getVarIdxByName(`${resolvedT}[1]`) >= 0);
                if (!isDaeVar && arg.name === "start" && prefix && isAsciiIdentifier(rawText)) {
                  const siblingComp =
                    (elemParentId
                      ? flattener.db.childrenOf(elemParentId)?.some((c) => c.kind === "Component" && c.name === rawText)
                      : false) ||
                    (flattener.currentClassId
                      ? flattener.db
                          .childrenOf(flattener.currentClassId)
                          ?.some((c) => c.kind === "Component" && c.name === rawText)
                      : false);
                  if (siblingComp) {
                    resolvedT = `${prefix}.${rawText}`;
                    isDaeVar = true;
                  }
                }
                if (
                  isDaeVar &&
                  !rawText.includes("(") &&
                  !rawText.includes("+") &&
                  !rawText.includes("-") &&
                  !rawText.includes("*") &&
                  !rawText.includes("/")
                ) {
                  attrExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedT));
                } else {
                  const subParts =
                    dae.extensionMetadata?.["isOldFrontend"] && arg.name === "start"
                      ? parseBinaryIdentSubtraction(rawText)
                      : null;
                  if (subParts) {
                    const p1 = resolveScopedName(subParts[0], prefix, dae, state.innerOuterComponents);
                    const p2 = resolveScopedName(subParts[1], prefix, dae, state.innerOuterComponents);
                    attrExprId = dae.addBinaryExpr(
                      BinOp.Sub,
                      dae.addExpression(ExprKind.Name, dae.interner.intern(p1)),
                      dae.addExpression(ExprKind.Name, dae.interner.intern(p2)),
                    );
                  }
                  if (attrExprId === null) {
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
                        const idMatches = extractAsciiIdentifiers(rawText);
                        if (idMatches.length > 0) {
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
                      /* fallback on evaluation error */
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
      }

      return { action: "continue" };
    }
  }
  const isRedeclaredPublicly =
    !parentMods?.isProtected && Boolean(parentMods?.args?.some((a) => a.name === compInst.name && a.isRedeclaration));

  let isElemProtected =
    !isRedeclaredPublicly &&
    (Boolean(compInst?.isProtected) ||
      flattener.isCstNodeProtected(elemCst) ||
      Boolean(parentMods?.isProtected) ||
      Boolean(parentMods?.protectedNames?.has(compInst.name)));

  const name = prefix ? `${prefix}.${compInst.name}` : compInst.name;
  const elemSym = flattener.db.symbol(elemId);
  const meta = getSymMeta(elemSym);

  let classTargetId = compInst.classInstance;
  let origClassTargetId = classTargetId;
  let redeclPkgId: SymbolId | null = null;
  let redeclPkgPrefix: string | null = null;
  if (compInst.typeSpecifier?.includes(".")) {
    const typeParts = compInst.typeSpecifier.split(".");
    const pkgPrefix = typeParts[0]!;
    let pkgRedeclArg = parentMods?.args
      ?.slice()
      .reverse()
      .find((a) => !a.isBreak && a.name === pkgPrefix && (a.isRedeclaration || a.redeclaredTypeSpecifier));
    const visitedRedeclNames = new Set<string>([pkgPrefix]);
    while (
      pkgRedeclArg?.redeclaredTypeSpecifier &&
      !pkgRedeclArg.redeclaredTypeSpecifier.includes(".") &&
      !visitedRedeclNames.has(pkgRedeclArg.redeclaredTypeSpecifier)
    ) {
      visitedRedeclNames.add(pkgRedeclArg.redeclaredTypeSpecifier);
      const nextArg = parentMods?.args
        ?.slice()
        .reverse()
        .find(
          (a) =>
            !a.isBreak &&
            a.name === pkgRedeclArg?.redeclaredTypeSpecifier &&
            (a.isRedeclaration || a.redeclaredTypeSpecifier),
        );
      if (nextArg) pkgRedeclArg = nextArg;
      else break;
    }
    if (pkgRedeclArg?.redeclaredTypeSpecifier) {
      let targetPkgId = resolveRedeclarationType(
        flattener,
        pkgRedeclArg.evaluationScopeId ?? flattener.currentClassId,
        pkgRedeclArg.redeclaredTypeSpecifier,
      );
      if (targetPkgId) {
        const visitedAliases = new Set<SymbolId>();
        while (targetPkgId && !visitedAliases.has(targetPkgId)) {
          visitedAliases.add(targetPkgId);
          if (!getShortClassSpecifierNode(getCstNode(flattener.db, targetPkgId))) break;
          const basePkg: SymbolEntry | null = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", targetPkgId);
          if (basePkg) targetPkgId = basePkg.id;
          else break;
        }
        redeclPkgId = targetPkgId;
        redeclPkgPrefix = pkgPrefix;
        (state.packageRedeclares ??= new Set<string>()).add(pkgPrefix);
        const memberName = typeParts.slice(1).join(".");
        const memberTarget =
          flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", targetPkgId)?.(memberName) ??
          flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", targetPkgId)?.(memberName);
        if (memberTarget && (memberTarget.kind === "Class" || getSymMeta(memberTarget).classKind === "type")) {
          classTargetId = memberTarget.id;
        }
      }
    }
  }
  const elemParent = elemSym?.parentId ?? flattener.currentClassId;
  const isCurrentScopeEncapsulated = elemParent ? isScopeEncapsulated(flattener.db, elemParent) : false;
  const isElemParentEncapsulated = elemParent
    ? Boolean(
        flattener.db.query<ScopeData | null>("scopeData", flattener.db.baseOf(elemParent) ?? elemParent)
          ?.isEncapsulated,
      )
    : false;
  if (
    !redeclPkgId &&
    !isElemParentEncapsulated &&
    parentMods?.packageScopeId &&
    compInst.typeSpecifier &&
    !compInst.typeSpecifier.includes(".")
  ) {
    const origParent = classTargetId ? flattener.db.symbol(classTargetId)?.parentId : null;
    if (!classTargetId || (origParent && flattener.isClassPartial(origParent))) {
      const pkgMember =
        flattener.db.query<(n: string) => SymbolEntry | null>(
          "resolveSimpleName",
          parentMods.packageScopeId,
        )?.(compInst.typeSpecifier) ??
        flattener.db.query<(n: string) => SymbolEntry | null>(
          "resolveName",
          parentMods.packageScopeId,
        )?.(compInst.typeSpecifier);
      if (pkgMember && (pkgMember.kind === "Class" || getSymMeta(pkgMember).classKind === "type")) {
        classTargetId = pkgMember.id;
      }
    }
  }
  if (
    !redeclPkgId &&
    !isElemParentEncapsulated &&
    flattener.currentClassId &&
    compInst.typeSpecifier &&
    flattener.currentClassId !== elemSym?.parentId
  ) {
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
        !getSymMeta(scopeTarget).isPredefined &&
        (scopeTarget.kind === "Class" || getSymMeta(scopeTarget).classKind === "type")
      ) {
        classTargetId = scopeTarget.id;
      }
    }
  }
  if (!classTargetId && compInst.typeSpecifier) {
    if (compInst.typeSpecifier.includes(".")) {
      if (elemParent !== null && elemParent !== undefined) {
        const parentResolver = flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", elemParent);
        const resolved = parentResolver?.(compInst.typeSpecifier);
        if (resolved && (resolved.kind === "Class" || getSymMeta(resolved).classKind === "type")) {
          classTargetId = resolved.id;
        }
      }
    } else {
      if (elemParent !== null && elemParent !== undefined) {
        const parentResolver = flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", elemParent);
        const resolved = parentResolver?.(compInst.typeSpecifier);
        if (resolved && (resolved.kind === "Class" || getSymMeta(resolved).classKind === "type")) {
          classTargetId = resolved.id;
        }
      }
      if (!classTargetId && !isCurrentScopeEncapsulated) {
        const candidates = flattener.db.byName(compInst.typeSpecifier);
        const found = candidates.find(
          (c) =>
            (c.parentId === null || getSymMeta(c).isPredefined) &&
            (c.kind === "Class" || getSymMeta(c).classKind === "type"),
        );
        if (found) {
          classTargetId = found.id;
        }
      }
    }
  }

  const isPrimitive =
    compInst.typeSpecifier === "Real" ||
    compInst.typeSpecifier === "Integer" ||
    compInst.typeSpecifier === "Boolean" ||
    compInst.typeSpecifier === "String" ||
    compInst.typeSpecifier === "Clock" ||
    compInst.typeSpecifier === "StateSelect" ||
    compInst.typeSpecifier === "ExternalObject" ||
    compInst.typeSpecifier === "AssertionLevel" ||
    Boolean(compInst.typeSpecifier?.startsWith("enumeration"));
  const hasPendingRedecl = Boolean(
    parentMods?.args?.some(
      (a) =>
        a.isRedeclaration &&
        (a.name === compInst.name ||
          a.name === compInst.typeSpecifier ||
          (compInst.typeSpecifier && a.name === compInst.typeSpecifier.split(".").pop())),
    ),
  );
  if (!classTargetId && !isPrimitive && !hasPendingRedecl && compInst.typeSpecifier) {
    let clauseNode: SyntaxNode | null = elemCst;
    while (clauseNode && clauseNode.type !== "component_clause") {
      clauseNode = clauseNode.parent;
    }
    const compRange = clauseNode
      ? {
          startPosition: clauseNode.startPosition,
          endPosition: clauseNode.endPosition,
          startOffset: clauseNode.startIndex ?? clauseNode.startOffset,
          endOffset: clauseNode.endIndex ?? clauseNode.endOffset,
        }
      : elemCst
        ? {
            startPosition: elemCst.startPosition,
            endPosition: elemCst.endPosition,
            startOffset: elemCst.startIndex ?? elemCst.startOffset,
            endOffset: elemCst.endIndex ?? elemCst.endOffset,
          }
        : undefined;
    const declClassId = elemSym?.parentId ?? flattener.currentClassId;
    if (compInst.typeSpecifier.includes(".") && declClassId) {
      const parts = compInst.typeSpecifier.split(".");
      let curSym =
        flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", declClassId)?.(parts[0]!) ?? null;
      let importedSegment: string | null = null;
      for (let i = 1; i < parts.length && curSym; i++) {
        const part = parts[i]!;
        const nextMember = flattener.db.query<
          (n: string, enc?: boolean, skip?: boolean, mem?: boolean) => SymbolEntry | null
        >("resolveSimpleName", curSym.id)?.(part, false, false, true);
        if (!nextMember) {
          const curScope = flattener.db.query<ScopeData | null>(
            "scopeData",
            flattener.db.baseOf(curSym.id) ?? curSym.id,
          );
          const isImportedInCur =
            Boolean(curScope?.qualifiedImports?.[part]) ||
            Boolean(curScope?.compoundImports?.some((ci) => ci.names.includes(part))) ||
            Boolean(
              curScope?.unqualifiedImportPkgs?.some((pkg) => {
                const pkgSym = resolveQualified(flattener.db, pkg, true);
                return pkgSym ? flattener.db.childrenOf(pkgSym.id).some((c) => c.name === part) : false;
              }),
            );
          if (isImportedInCur) {
            importedSegment = part;
          }
          break;
        }
        curSym = nextMember;
      }
      if (importedSegment && !flattener.isOldFrontend && !dae.extensionMetadata?.["isOldFrontend"]) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
          message: `Found imported name '${importedSegment}' while looking up composite name '${compInst.typeSpecifier}'.`,
          range: compRange,
        });
        return { action: "break" };
      }
    }
    const firstPart = compInst.typeSpecifier.split(".")[0]!;
    if (declClassId) {
      const importChildren = flattener.db.childrenOf(declClassId).filter((c) => c.kind === "Import");
      const matchingQualImports: { sym: SymbolEntry; pkgName: string; shortName: string }[] = [];
      const matchingUnqualImports: SymbolEntry[] = [];
      for (const imp of importChildren) {
        const impMeta = imp.metadata as Record<string, unknown>;
        const impCst = getCstNode(flattener.db, imp.id);
        const impText: string = impCst?.text ?? "";
        const aliasNode = impCst ? Cst.ImportClause.alias(impCst) : null;
        const importListNode = impCst ? Cst.ImportClause.importList(impCst) : null;
        const pkgName = String(impMeta?.["packageName"] ?? imp.name ?? "");
        if (hasDotStarSuffix(impText) || impMeta?.["importKind"] === "unqualified") {
          const pkgSym = resolveQualified(flattener.db, pkgName, true);
          if (
            pkgSym &&
            flattener.db.childrenOf(pkgSym.id).some((c) => c.name === firstPart && c.kind !== "Reference")
          ) {
            matchingUnqualImports.push(imp);
          }
        } else if (!importListNode && impMeta?.["importKind"] !== "compound") {
          const shortName = String(aliasNode?.text ?? impMeta?.["shortName"] ?? pkgName.split(".").pop() ?? pkgName);
          if (shortName === firstPart) {
            matchingQualImports.push({ sym: imp, pkgName, shortName });
          }
        }
      }
      const getImpRange = (sym: SymbolEntry) => {
        const n = getCstNode(flattener.db, sym.id);
        return n
          ? {
              startPosition: n.startPosition,
              endPosition: n.endPosition,
              startOffset: n.startIndex ?? n.startOffset,
              endOffset: n.endIndex ?? n.endOffset,
            }
          : undefined;
      };
      if (matchingQualImports.length > 1) {
        const firstImp = matchingQualImports[0]!.sym;
        const secondImp = matchingQualImports[1]!.sym;
        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: getImpRange(firstImp),
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
          message: `Qualified import name ${firstPart} already exists in this scope.`,
          range: getImpRange(secondImp),
        });
      } else if (matchingQualImports.length === 1) {
        const impInfo = matchingQualImports[0]!;
        const resolvedImp = resolveQualified(flattener.db, impInfo.pkgName, true);
        if (!resolvedImp) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
            message: `Import ${impInfo.pkgName} not found in scope <top>.`,
            range: getImpRange(impInfo.sym),
          });
        }
      } else if (matchingUnqualImports.length > 1) {
        const firstImp = matchingUnqualImports[0]!;
        const secondImp = matchingUnqualImports[1]!;
        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: getImpRange(firstImp),
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
          message: `${firstPart} found in several unqualified import statements.`,
          range: getImpRange(secondImp),
        });
      }
    }
    const scopeSym = declClassId ? flattener.db.symbol(declClassId) : null;
    const scopeName =
      scopeSym && isSymbolEncapsulated(flattener.db, scopeSym)
        ? scopeSym.name
        : declClassId
          ? getSymbolQualifiedName(flattener.db, declClassId)
          : (scopeSym?.name ?? "scope");
    dae.diagnostics.push({
      severity: "error",
      code: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
      message: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.message(compInst.typeSpecifier, scopeName),
      range: compRange,
    });
    return { action: "break" };
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
          const extCst = getCstNode(flattener.db, ext.id);
          const extRange = extCst
            ? {
                startPosition: extCst.startPosition,
                endPosition: extCst.endPosition,
                startOffset: extCst.startIndex ?? extCst.startOffset,
                endOffset: extCst.endIndex ?? extCst.endOffset,
              }
            : undefined;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.code,
            message: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.message(ext.name, scopeFQN),
            range: extRange,
          });
          hasExtendsErr = true;
          return { action: "break" };
        }
      }
      if (hasExtendsErr) {
        return { action: "break" };
      }
    }
  }

  const typeLeaf = compInst.typeSpecifier ? compInst.typeSpecifier.split(".").pop() : "";
  let matchingClassArg = parentMods?.args
    ?.slice()
    .reverse()
    .find((a) => !a.isBreak && (a.name === compInst.typeSpecifier || (typeLeaf && a.name === typeLeaf)));
  if (!matchingClassArg && compInst.typeSpecifier?.includes(".")) {
    const typeParts = compInst.typeSpecifier.split(".");
    let curArgs: readonly ModArgData[] | undefined = parentMods?.args;
    let matchedNested: ModArgData | null = null;
    for (let pIdx = 0; pIdx < typeParts.length; pIdx++) {
      const part = typeParts[pIdx]!;
      const found = curArgs
        ?.slice()
        .reverse()
        .find((a) => !a.isBreak && a.name === part);
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
  const isFinalComp = Boolean(compInst?.isFinal || getSymMeta(flattener.db.symbol(elemId)).isFinal);

  // Case A: Component itself is declared final, and parentMods provides a modification
  if (
    isFinalComp &&
    matchingParentArg &&
    !matchingParentArg.isRedeclaration &&
    !matchingParentArg.isRecordCtorDefault &&
    (matchingParentArg.value != null ||
      (matchingParentArg.nestedArgs && matchingParentArg.nestedArgs.length > 0) ||
      matchingParentArg.modText)
  ) {
    let declNode: SyntaxNode | null = elemCst;
    let p = elemCst?.parent;
    while (p && (p.type === "component_declaration" || p.type === "component_clause" || p.type === "element")) {
      declNode = p;
      p = p.parent;
    }
    const notifRange = {
      startOffset: declNode?.startIndex ?? declNode?.startOffset,
      endOffset: declNode?.endIndex ?? declNode?.endOffset,
      startPosition: declNode?.startPosition,
      endPosition: declNode?.endPosition,
    };
    const errorRange = modArgDiagRange(matchingParentArg);
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
    return { action: "return" };
  }

  // Case B: Component was finalized by an earlier modifier (in parentMods.args), and a later modifier overrides it
  const compArgs = (parentMods?.args || []).filter((a) => !a.isBreak && a.name === compInst.name);
  const finalArgIdx = compArgs.findIndex((a) => a.final);
  if (finalArgIdx >= 0) {
    const finalArg = compArgs[finalArgIdx]!;
    const overridingArg = compArgs
      .slice(finalArgIdx + 1)
      .find((a) => a.value != null || (a.nestedArgs && a.nestedArgs.length > 0) || a.modText);
    if (overridingArg) {
      const modText = overridingArg.modText || (overridingArg.value?.text ? `=${overridingArg.value.text}` : "");
      const notifRange = modArgDiagRange(finalArg);
      const errorRange = modArgDiagRange(overridingArg);
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
      return { action: "return" };
    }
  }

  const effectiveParentArg =
    matchingParentArg?.isRedeclaration && !compInst?.isReplaceable && !dae.extensionMetadata?.["ignoreReplaceable"]
      ? null
      : matchingParentArg;
  const effectiveClassArg = matchingClassArg;

  const redeclArg =
    effectiveParentArg?.isRedeclaration && effectiveParentArg?.redeclaredTypeSpecifier
      ? effectiveParentArg
      : effectiveClassArg?.isRedeclaration && effectiveClassArg?.redeclaredTypeSpecifier
        ? effectiveClassArg
        : (parentMods?.args?.find((a) => a.name === compInst.name && a.isRedeclaration && a.redeclaredTypeSpecifier) ??
          null);
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
              startOffset: modRange[0],
              endOffset: modRange[1],
              startPosition: modPos?.startPosition,
              endPosition: modPos?.endPosition,
            }
          : undefined,
      });
      return { action: "return" };
    }
  }
  origClassTargetId ??= classTargetId;
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
      if (origClassTargetId && flattener.db.query<boolean>("isRedeclare", origClassTargetId)) {
        const origSym = flattener.db.symbol(origClassTargetId);
        const origOwnerId =
          origSym?.parentId != null && flattener.db.symbol(origSym.parentId)?.kind === "Extends"
            ? flattener.db.symbol(origSym.parentId)!.parentId
            : origSym?.parentId;
        if (origOwnerId) {
          const findBaseOrigClass = (clsId: SymbolId, visited = new Set<SymbolId>()): SymbolId | null => {
            if (visited.has(clsId)) return null;
            visited.add(clsId);
            for (const ch of flattener.db.childrenOf(clsId)) {
              if (
                ch.kind === "Class" &&
                ch.name === origSym!.name &&
                !flattener.db.query<boolean>("isRedeclare", ch.id)
              ) {
                return ch.id;
              }
            }
            for (const ch of flattener.db.childrenOf(clsId)) {
              if (ch.kind === "Extends") {
                const bSym = resolveExtendsBase(flattener, ch, clsId);
                if (bSym) {
                  const found = findBaseOrigClass(bSym.id, visited);
                  if (found) return found;
                }
              }
            }
            return null;
          };
          const baseOrigId = findBaseOrigClass(origOwnerId);
          if (baseOrigId) origClassTargetId = baseOrigId;
        }
      }
      const origCst = origClassTargetId ? getCstNode(flattener.db, origClassTargetId) : null;
      const origParentType = origCst?.parent?.type ?? "";
      const isOrigReplaceableClass = Boolean(
        origClassTargetId &&
        (flattener.db.query<boolean>("isReplaceable", origClassTargetId) ||
          origParentType === "element_replaceable" ||
          ((origParentType === "element" ||
            origParentType === "element_redeclaration" ||
            origParentType === "argument") &&
            hasReplaceablePrefixText(origCst?.parent?.text ?? "")) ||
          hasReplaceablePrefixText(origCst?.text ?? "")),
      );
      if (origClassTargetId && origClassTargetId !== redeclTargetId && isOrigReplaceableClass) {
        const origMod = flattener.db.query<ParentModData | null>("effectiveModification", origClassTargetId);
        if (origMod?.args && origMod.args.length > 0) {
          const targetElements = flattener.db.query<SymbolId[]>("instantiate", redeclTargetId) ?? [];
          const validTargetFieldNames = new Set(
            targetElements.map((eid) => flattener.db.symbol(eid)?.name).filter(Boolean),
          );
          const existingNames = new Set((redeclArg.nestedArgs || []).map((a) => a.name));
          const inheritedArgsToPreserve: ModArgData[] = [];
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
      return { action: "continue" };
    }
  }

  let basePrefixText: string | null = null;
  let conflictingChainPrefix: { newPrefix: string; existingPrefix: string } | null = null;
  if (classTargetId) {
    let currTargetId: SymbolId | null = classTargetId;
    const visitedTargetIds = new Set<SymbolId>();
    while (currTargetId && !visitedTargetIds.has(currTargetId)) {
      visitedTargetIds.add(currTargetId);
      const cst = getCstNode(flattener.db, currTargetId);
      const baseSym: SymbolEntry | null = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", currTargetId);
      if (cst) {
        const short = getShortClassSpecifierNode(cst);
        if (short) {
          const shortTypeSpec =
            Cst.ShortClassSpecifier.typeSpecifier(short) ??
            short?.children?.find((c) => c.type === "type_specifier" || c.type === "TypeSpecifier");
          const shortTypeName = shortTypeSpec?.text?.trim() ?? "";
          const isShortPrim =
            shortTypeName === "Real" ||
            shortTypeName === "Integer" ||
            shortTypeName === "Boolean" ||
            shortTypeName === "String" ||
            shortTypeName === "Clock" ||
            shortTypeName === "StateSelect" ||
            shortTypeName === "ExternalObject" ||
            shortTypeName === "AssertionLevel";
          if (shortTypeName && !isShortPrim && !baseSym) {
            const currSym = flattener.db.symbol(currTargetId);
            const topResolved =
              currSym?.parentId == null
                ? (resolveQualified(flattener.db, shortTypeName, true) ??
                  flattener.db.byName(shortTypeName).find((c) => c.parentId === null && c.id !== currTargetId))
                : null;
            if (!topResolved) {
              const scopeFQN = currSym?.parentId
                ? getSymbolQualifiedName(flattener.db, currSym.parentId)
                : "<global scope>";
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.code,
                message: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.message(shortTypeName, scopeFQN),
                range: {
                  startPosition: cst.startPosition,
                  endPosition: cst.endPosition,
                  startOffset: cst.startIndex ?? cst.startOffset,
                  endOffset: cst.endIndex ?? cst.endOffset,
                },
              });
              return { action: "return" };
            }
          }
          const shortArrSub =
            Cst.ShortClassSpecifier.arraySubscripts(short) ??
            short?.children?.find((c) => c.type === "array_subscripts" || c.type === "ArraySubscripts");
          const shortMod =
            Cst.ShortClassSpecifier.classModification(short) ??
            short?.children?.find((c) => c.type === "class_modification" || c.type === "ClassModification");
          if (shortArrSub && shortMod) {
            const effShortMod = flattener.db.query<ParentModData | null>("effectiveModification", currTargetId);
            if (effShortMod?.args) {
              for (const arg of effShortMod.args) {
                const rawVal = arg.value?.text ?? arg.value ?? arg.modification?.bindingExpression;
                if (!arg.each && !arg.isEach && rawVal) {
                  const bVal = stripLeadingEquals(String(rawVal));
                  if (
                    isSignedAsciiNumberText(bVal) ||
                    bVal === "true" ||
                    bVal === "false" ||
                    (bVal.startsWith('"') && bVal.endsWith('"'))
                  ) {
                    const diagRange = getElementDiagRange(elemCst);
                    dae.diagnostics.push({
                      severity: "notification",
                      code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                      message: "From here:",
                      range: {
                        startPosition: shortMod.startPosition,
                        endPosition: shortMod.endPosition,
                        startOffset: shortMod.startIndex ?? shortMod.startOffset,
                        endOffset: shortMod.endIndex ?? shortMod.endOffset,
                      },
                    });
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.NON_ARRAY_MODIFICATION.code,
                      message: ModelicaErrorCode.NON_ARRAY_MODIFICATION.message(bVal, arg.name),
                      range: diagRange,
                    });
                    return { action: "return" };
                  }
                }
              }
            }
          }
        }
        const basePrefixNode =
          (short ? Cst.ShortClassSpecifier.basePrefix(short) : null) ??
          short?.children?.find((c) => c.type === "base_prefix");
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
    return { action: "return" };
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
    return { action: "return" };
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
      return { action: "return" };
    }
  }

  const isType = classTargetId ? isClassType(flattener, classTargetId) : false;
  const effectiveType = redeclArg?.redeclaredTypeSpecifier ?? compInst.typeSpecifier;
  const isExtObj = flattener.isExternalObject(classTargetId);
  if (isExtObj && classTargetId) {
    flattener.usedExternalObjects.add(classTargetId);
  }
  const compSpecPkgPrefix =
    redeclPkgId && redeclPkgPrefix
      ? (() => {
          const ownerClsId = parentMods?.currentClassId ?? parentMods?.ownerClassId ?? flattener.currentClassId;
          const ownerQual = ownerClsId ? getSymbolQualifiedName(flattener.db, ownerClsId) : "";
          if (!ownerQual) return undefined;
          if (!prefix) return `${ownerQual}.${redeclPkgPrefix}`;
          if (dae.extensionMetadata?.["isOldFrontend"]) {
            return `${ownerQual}$${prefix.replaceAll(".", "$")}.${redeclPkgPrefix}`;
          }
          const rootQual = flattener.currentRootClassId
            ? getSymbolQualifiedName(flattener.db, flattener.currentRootClassId)
            : ownerQual;
          return `${rootQual}.${prefix}.${redeclPkgPrefix}`;
        })()
      : (parentMods?.specializedPkgPrefix ?? extDae.specializedPrefix);
  const isRecordTarget =
    (classTarget && (flattener.isRecordSym(classTarget) || flattener.isOperatorRecordSym(classTarget))) || false;
  if (isRecordTarget && classTarget) {
    if (
      effectiveClassArg?.isRedeclaration &&
      effectiveClassArg.name &&
      origClassTargetId &&
      origClassTargetId !== classTarget.id
    ) {
      const redeclCtorName = `${dae.name ? `${dae.name}.` : ""}${prefix ? `${prefix}.` : ""}${effectiveClassArg.name}`;
      flattener.generateRecordConstructorFor?.(
        classTarget,
        dae,
        flattener.currentRootClassId,
        redeclCtorName,
        effectiveClassArg.name,
      );
    } else if (compSpecPkgPrefix && classTarget.parentId && flattener.isClassPartial(classTarget.parentId)) {
      flattener.generateRecordConstructorFor?.(
        classTarget,
        dae,
        flattener.currentRootClassId,
        `${compSpecPkgPrefix}.${classTarget.name}`,
        classTarget.name,
      );
    } else {
      flattener.usedRecordSymIds?.add(classTarget.id);
      if (classTarget.name) flattener.usedRecordNames?.add(classTarget.name);
    }
    const hasArgs = Boolean(
      (compInst?.modification?.args && compInst.modification.args.length > 0) ||
      (parentMods?.args &&
        parentMods.args.some((a) => a.name === compInst.name && (a.modification?.args?.length ?? 0) > 0)),
    );
    if (hasArgs && compInst.name && dae.classKind !== "function") {
      if (!flattener.instantiatedRecordComponents) {
        flattener.instantiatedRecordComponents = new Map<string, Set<string>>();
      }
      const qTarget = getSymbolQualifiedName(flattener.db, classTarget.id) || classTarget.name;
      let s = flattener.instantiatedRecordComponents.get(qTarget);
      if (!s) {
        s = new Set<string>();
        flattener.instantiatedRecordComponents.set(qTarget, s);
      }
      s.add(compInst.name);
      if (classTarget.name && classTarget.name !== qTarget) {
        let s2 = flattener.instantiatedRecordComponents.get(classTarget.name);
        if (!s2) {
          s2 = new Set<string>();
          flattener.instantiatedRecordComponents.set(classTarget.name, s2);
        }
        s2.add(compInst.name);
      }
    }
  }
  const isUserClass =
    classTarget &&
    classTarget.kind === "Class" &&
    !isType &&
    !isExtObj &&
    !getSymMeta(classTarget).isEnum &&
    !isPredefinedType(classTarget) &&
    effectiveType !== "Real" &&
    effectiveType !== "Integer" &&
    effectiveType !== "Boolean" &&
    effectiveType !== "String" &&
    !(dae.classKind === "function" && isRecordTarget);

  if (dae.classKind === "function" && classTargetId) {
    const targetMeta = getSymMeta(flattener.db.symbol(classTargetId));
    const rawKind = String(targetMeta.classKind ?? targetMeta.classPrefixes ?? "");
    const words = tokenizeCommentStrippedWords(rawKind);
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
      const isOldFe = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
      const typeName =
        isOldFe && compInst.typeSpecifier && !compInst.typeSpecifier.startsWith(".")
          ? `.${compInst.typeSpecifier}`
          : (compInst.typeSpecifier ?? "");
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.code,
        message: ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.message(typeName, compInst.name),
        range: rangeObj,
      });
      return { action: "continue" };
    }
  }

  const targetMeta = classTargetId ? getSymMeta(flattener.db.symbol(classTargetId)) : undefined;
  const targetCst = classTargetId ? getCstNode(flattener.db, classTargetId) : undefined;
  const isShortConnector = targetCst && Boolean(getShortClassSpecifierNode(targetCst));
  const rawKind = String(targetMeta?.classKind ?? targetMeta?.classPrefixes ?? "");
  const isConnectorClass = classTarget?.kind === "Connector" || rawKind.includes("connector");
  const isConnector = isConnectorClass && !isShortConnector;
  if (
    isConnector &&
    !dae.extensionMetadata?.["isOldFrontend"] &&
    (compInst.variability === "parameter" ||
      compInst.variability === "constant" ||
      parentMods?.parentVariability === Variability.Parameter ||
      parentMods?.parentVariability === Variability.Constant)
  ) {
    if (
      dae.extensionMetadata?.["isOldFrontend"] &&
      dae.diagnostics.some((d) => d.code === ModelicaErrorCode.CONNECTOR_VARIABILITY.code)
    ) {
      return { action: "return" };
    }
    const varb =
      compInst.variability ?? (parentMods?.parentVariability === Variability.Constant ? "constant" : "parameter");
    let clauseNode: SyntaxNode | null = elemCst;
    while (clauseNode && clauseNode.type !== "component_clause") {
      clauseNode = clauseNode.parent;
    }
    const compRange = clauseNode
      ? {
          startOffset: clauseNode.startIndex ?? clauseNode.startOffset,
          endOffset: clauseNode.endIndex ?? clauseNode.endOffset,
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
    return { action: "return" };
  }

  if (classTargetId && isConnectorClass) {
    let isStreamConnector = compInst?.flowPrefix === "stream";
    let flowVarCount = compInst?.flowPrefix === "flow" ? 1 : 0;
    let currTargetId: SymbolId | null = classTargetId;
    const visitedTargetIds = new Set<SymbolId>();
    while (currTargetId) {
      if (visitedTargetIds.has(currTargetId)) break;
      visitedTargetIds.add(currTargetId);
      const cst = getCstNode(flattener.db, currTargetId);
      if (cst) {
        const spec = Cst.ClassDefinition.classSpecifier(cst);
        const short =
          spec &&
          (Cst.ShortClassSpecifier.is(spec) ||
            spec.type === "short_class_specifier" ||
            spec.type === "ShortClassSpecifier")
            ? spec
            : spec?.children?.find((c) => Cst.ShortClassSpecifier.is(c) || c.type === "short_class_specifier");
        const basePrefixNode =
          (short ? Cst.ShortClassSpecifier.basePrefix(short) : null) ??
          short?.children?.find((c) => c.type === "base_prefix");
        const text = basePrefixNode?.text?.trim();
        if (text === "stream" || text?.includes("stream")) {
          isStreamConnector = true;
          break;
        }
      }
      const baseSym: SymbolEntry | null = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", currTargetId);
      currTargetId = baseSym && baseSym.id !== currTargetId ? baseSym.id : null;
    }
    if (!isStreamConnector) {
      const targetElems = flattener.db.query<SymbolId[]>("instantiate", classTargetId) ?? [];
      for (const te of targetElems) {
        const sym = flattener.db.symbol(te);
        const m = getSymMeta(sym);
        if (m.flowPrefix === "stream") {
          isStreamConnector = true;
        } else if (m.flowPrefix === "flow") {
          flowVarCount++;
        }
      }
    }
    if (isStreamConnector && flowVarCount !== 1) {
      let clauseNode: SyntaxNode | null = elemCst;
      while (clauseNode && clauseNode.type !== "component_clause") {
        clauseNode = clauseNode.parent;
      }
      const rangeObj = clauseNode
        ? {
            startOffset: clauseNode.startIndex ?? clauseNode.startOffset,
            endOffset: clauseNode.endIndex ?? clauseNode.endOffset,
            startPosition: clauseNode.startPosition,
            endPosition: clauseNode.endPosition,
          }
        : elemCst
          ? {
              startOffset: elemCst.startIndex ?? elemCst.startOffset,
              endOffset: elemCst.endIndex ?? elemCst.endOffset,
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
      return { action: "return" };
    }
  }

  return {
    action: "proceed",
    ctx: {
      isElemProtected,
      name,
      elemSym,
      meta,
      classTargetId,
      redeclPkgId,
      redeclPkgPrefix,
      elemParent,
      matchingClassArg,
      effectiveParentArg,
      effectiveClassArg,
      redeclArg,
      classTarget,
      isType,
      effectiveType,
      isExtObj,
      compSpecPkgPrefix,
      isRecordTarget,
      isUserClass: Boolean(isUserClass),
      targetMeta,
      targetCst,
      isConnector,
    },
  };
}
