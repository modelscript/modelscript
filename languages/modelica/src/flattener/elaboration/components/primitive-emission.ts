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
  Variability,
  VarType,
  varTypeName,
  type DaeDiagnosticRange,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import { validateEnumeration } from "../../../queries.js";
import {
  castToRealExpr,
  containsWholeWordOutsideStrings,
  copyExprBetweenDaes,
  countWordOccurrencesOutsideStrings,
  evalDaeExpr,
  evaluateCSTNumber,
  exprContainsNameRef,
  extractAsciiIdentifiers,
  extractEnumLiteralsFromCst,
  getArrayCtorElements,
  getArrayLiteralItems,
  getBaseEnumSymbol,
  getExprDims,
  getIndexedElementText,
  getSymbolEnumLiterals,
  getSymbolQualifiedName,
  hasEquationAssignmentForNameCst,
  isArrayLiteral,
  isAsciiDigitsOnly,
  isAsciiIdentContinue,
  isAsciiIdentifier,
  isDottedComponentRefWithSubscripts,
  isDottedIdentifierChain,
  isEnumClassDefCst,
  isRealExpr,
  isSignedAsciiIntText,
  isSignedAsciiNumberText,
  lookupDbConstant,
  mulWithSimplification,
  parseArrayLiteralElements,
  parseBinaryIdentSubtraction,
  parseNamedCallArgsFromText,
  replaceWordOutsideStrings,
  resolveScopedName,
  splitTopLevelArgs,
  startsWithSignedDecimalFloat,
  stripLeadingEquals,
  stripLeadingMinusWs,
} from "../../expressions/index.js";
import { getElementDiagRange } from "../../support/range-utils.js";
import { getNamedArrayShape } from "../../support/state.js";
import { type ComponentInstanceData } from "../../types.js";
import { resolveArrayDimsAndEmit } from "./array-and-dims.js";
import {
  evaluateComprehensionRangeValues,
  extractDescription,
  extractReplaceablePackagePrefix,
  findBindingExprFromCst,
  findFirstExpressionCst,
  isComponentHidden,
  lowerStandaloneExpression,
  parseArrayComprehension,
  parseModelicaArrayArg,
  tryScalarizeIfSizeBindingCst,
} from "./cst-helpers.js";
import { collectInheritedTypeModifiers, isClassType, resolveExtendsBase } from "./modifications.js";
import {
  asExtDae,
  getCstNode,
  getCstNodeRange,
  getEnumLiteralName,
  getSymMeta,
  type ArenaEvalArg,
  type ArrayDimRawEntry,
  type ComponentFlattener,
  type ComponentInstanceInfo,
  type DaeExtensionMetadataLike,
  type EnumLiteralEntry,
  type ExtendedDaeBuilder,
  type ExtendedFlatteningState,
  type ModArgData,
  type ModValueData,
  type ParentModData,
  type ResolvedComponentContext,
  type ResolveNameFn,
  type ResolveSimpleNameFn,
} from "./types.js";
import { validateFunctionComponentDeclaration } from "./validation.js";

export function elaboratePrimitiveAndArray(
  flattener: ComponentFlattener,
  elements: SymbolId[],
  elemId: SymbolId,
  compInst: ComponentInstanceInfo,
  fullCompName: string,
  elemCst: SyntaxNode | null,
  prefix: string,
  basePrefix: string,
  dae: DAEBuilder,
  extDae: ExtendedDaeBuilder,
  state: ExtendedFlatteningState,
  parentMods: ParentModData | null | undefined,
  matchingParentArg: ModArgData | undefined,
  isStateOutput: boolean,
  ctx: ResolvedComponentContext,
): "continue" | "return" {
  const {
    isElemProtected,
    name,
    meta,
    classTargetId,
    redeclPkgId,
    redeclPkgPrefix,
    matchingClassArg,
    effectiveParentArg,
    effectiveClassArg,
    redeclArg,
    classTarget,
    isType,
    effectiveType,
    isExtObj,
    isRecordTarget,
  } = ctx;
  let varType = VarType.Real;
  let effectiveTypeSpec = effectiveType ?? compInst?.typeSpecifier;
  const buildFunctionParamCustomType = (): string | null => {
    if (dae.classKind !== "function" || !classTarget || !flattener.isFunctionSym(classTarget)) return null;
    const instIds = flattener.db.query<SymbolId[]>("instantiate", classTarget.id);
    const chs =
      instIds && instIds.length > 0
        ? instIds.map((id) => flattener.db.symbol(id)).filter((s): s is SymbolEntry => Boolean(s))
        : flattener.db.childrenOf(classTarget.id) || [];
    const inParts: string[] = [];
    const outParts: string[] = [];
    for (const ch of chs) {
      if (ch.kind === "Component") {
        const ci = flattener.db.query<ComponentInstanceData>("componentInstance", ch.id);
        const t = ci?.typeSpecifier ?? "Real";
        if (ci?.causality === "input") {
          inParts.push(`#${t} ${ch.name}`);
        } else if (ci?.causality === "output") {
          outParts.push(`#${t}`);
        }
      }
    }
    const outStr = outParts.length === 0 ? "()" : outParts.join(", ");
    return `${compInst.name}<function>(${inParts.join(", ")}) => ${outStr}`;
  };
  let customType: string | null =
    isExtObj && classTargetId
      ? getSymbolQualifiedName(flattener.db, classTargetId)
      : dae.classKind === "function" && isRecordTarget && classTarget
        ? extDae.specializedPrefix &&
          extDae.enclosingScopeId &&
          (classTarget.parentId === extDae.enclosingScopeId ||
            flattener.db.query<(n: string) => SymbolEntry | null>(
              "resolveName",
              extDae.enclosingScopeId,
            )?.(classTarget.name)?.id === classTarget.id)
          ? `${extDae.specializedPrefix}.${classTarget.name}`
          : dae.extensionMetadata?.["isOldFrontend"] && classTarget.parentId
            ? getSymbolQualifiedName(flattener.db, classTarget.id) || (effectiveType ?? classTarget.name)
            : (effectiveType ?? classTarget.name)
        : buildFunctionParamCustomType();
  // ============================================================================
  // Phase 5: Primitive, `type` Alias & Enumeration Resolution
  // ============================================================================
  const typeMods: ModArgData[] = [];
  // Walk short `type` alias chains (`type T1 = T2(min=0); type T2 = Real(unit="V")`)
  // from base to derived so derived type modifiers override base type attributes.
  if (isType && classTargetId) {
    let currId: number | null = classTargetId;
    const collectedTypeMods: ModArgData[] = [];
    while (currId) {
      const mod = flattener.db.query<ParentModData | null>("effectiveModification", currId);
      if (mod?.args) {
        collectedTypeMods.unshift(...mod.args);
      }
      let base: SymbolEntry | null = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", currId);
      const extChild = flattener.db.childrenOf(currId).find((c) => c.kind === "Extends");
      if (extChild) {
        const extMod = flattener.db.query<ParentModData | ModArgData[] | null>(
          "extendsModificationParsed",
          extChild.id,
        );
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
    const scopeEntry = flattener.db.byName(parts[0]!).find((e) => e.kind === "Class" || e.kind === "Package");
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

  // Resolve primitive `VarType` or enumeration type metadata (`VarType.Enumeration` + `enumLiterals`)
  let enumLiterals: EnumLiteralEntry[] | null = null;
  if (effectiveTypeSpec === "Integer") varType = VarType.Integer;
  else if (effectiveTypeSpec === "Boolean") varType = VarType.Boolean;
  else if (effectiveTypeSpec === "String") varType = VarType.String;
  else if (effectiveTypeSpec === "Clock") varType = VarType.Clock;
  else if (typeof meta.varType === "number") varType = meta.varType;
  else if (effectiveTypeSpec) {
    let enumSym: SymbolEntry | null = null;
    if (classTargetId) {
      enumSym = flattener.db.symbol(classTargetId) ?? null;
    }
    if (!enumSym) {
      const scopeId = (flattener.db.symbol(elemId)?.parentId ?? flattener.currentClassId) as number | undefined;
      enumSym =
        (scopeId != null
          ? (flattener.db.query<ResolveNameFn | undefined>("resolveName", scopeId)?.(effectiveTypeSpec) ??
            flattener.db.query<ResolveSimpleNameFn | undefined>("resolveSimpleName", scopeId)?.(effectiveTypeSpec))
          : null) ?? null;
    }
    if (!enumSym) {
      const typeTargets = flattener.db.byName(effectiveTypeSpec.split(".").pop()!);
      if (typeTargets.length > 0) enumSym = typeTargets[0]!;
    }
    if (enumSym) {
      const baseEnumSym = getBaseEnumSymbol(flattener.db, enumSym) ?? enumSym;
      const targetMeta = getSymMeta(baseEnumSym);
      const baseEnumCst = getCstNode(flattener.db, baseEnumSym.id);
      const isEnum =
        targetMeta.classPrefixes === "enumeration" || targetMeta.isEnumeration || isEnumClassDefCst(baseEnumCst);
      if (isEnum) {
        const enumErr = validateEnumeration(baseEnumCst, baseEnumSym);
        if (enumErr) {
          dae.diagnostics.push({
            severity: "error",
            code: enumErr.code,
            message: enumErr.message,
            range: {
              startOffset: enumErr.startOffset,
              endOffset: enumErr.endOffset,
            },
          });
          return "return";
        }
        varType = VarType.Enumeration;
        if (!customType && baseEnumSym) {
          customType = getSymbolQualifiedName(flattener.db, baseEnumSym.id);
        }
        const enumLits =
          extractEnumLiteralsFromCst(baseEnumCst, targetMeta) ?? getSymbolEnumLiterals(flattener.db, baseEnumSym);
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
  else if (typeof meta.variability === "number") variability = meta.variability;
  if (variability === Variability.Continuous && parentMods?.parentVariability !== undefined) {
    variability = parentMods.parentVariability;
  }
  if (variability === Variability.Constant && matchingParentArg?.value) {
    const modText = (matchingParentArg.value.origArrayCompText ?? matchingParentArg.value.text)?.trim() ?? "";
    if (modText.startsWith("array(") && modText.includes(" for ")) {
      const rangeObj = matchingParentArg.modRange
        ? { startOffset: matchingParentArg.modRange[0], endOffset: matchingParentArg.modRange[1] }
        : elemCst
          ? {
              startOffset: elemCst.startIndex ?? elemCst.startOffset,
              endOffset: elemCst.endIndex ?? elemCst.endOffset,
            }
          : undefined;
      const lastBracket = prefix.endsWith("]") ? prefix.lastIndexOf("[") : -1;
      const idxDigits = lastBracket >= 0 ? prefix.slice(lastBracket + 1, -1) : "";
      const idxVal = idxDigits && isAsciiDigitsOnly(idxDigits) ? parseInt(idxDigits, 10) : 1;
      if (flattener.options.omcCompatibility && idxVal === 2) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
          message: `Component ${prefix}.${compInst.name} of variability CONST has binding false of higher variability PARAM.`,
          range: rangeObj,
        });
        return "return";
      }
    }
  }
  // Allow constants inside components to be instantiated in DAE
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

  let causality = Causality.Local;
  if (compInst?.causality === "input") causality = Causality.Input;
  else if (compInst?.causality === "output") causality = Causality.Output;
  else if (typeof meta.causality === "number") causality = meta.causality;
  if (causality === Causality.Local && classTargetId) {
    let currTargetId: SymbolId | null = classTargetId;
    while (currTargetId) {
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
        if (text === "input") {
          causality = Causality.Input;
          break;
        } else if (text === "output") {
          causality = Causality.Output;
          break;
        }
      }
      const baseSym: SymbolEntry | null = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", currTargetId);
      currTargetId = baseSym && baseSym.id !== currTargetId ? baseSym.id : null;
    }
  }
  if (causality === Causality.Local && parentMods?.parentCausality !== undefined) {
    causality = parentMods.parentCausality;
  }
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
  if (prefix && !isStateOutput && !shouldKeepCausality) {
    causality = Causality.Local;
  }

  const descText = extractDescription(elemCst) ?? "";

  const isParentBoundRecord =
    parentMods?.bindingExpression?.text &&
    isDottedComponentRefWithSubscripts(parentMods.bindingExpression.text.trim(), true);
  const isParentBoundField =
    (!effectiveParentArg?.value || Boolean(effectiveParentArg?.isExtendsMod)) &&
    !effectiveClassArg?.value &&
    Boolean(isParentBoundRecord);
  let effectiveBinding =
    isParentBoundRecord && effectiveParentArg?.isExtendsMod && !effectiveClassArg?.value
      ? undefined
      : (effectiveParentArg?.value ?? effectiveClassArg?.value);
  if (!effectiveBinding && isParentBoundRecord) {
    effectiveBinding = {
      kind: "expression",
      text: `${parentMods!.bindingExpression!.text!.trim()}.${compInst.name}`,
    };
  }
  if (!effectiveBinding && !parentMods?.suppressDefaultBindings) {
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
      flattener.currentClassId && getSymMeta(flattener.db.symbol(flattener.currentClassId)).classKind === "function",
    );
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
    isElemParentPackage
  ) {
    return "continue";
  }
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
      return "continue";
    }
  }

  if (effectiveBinding?.text) {
    const bRef = effectiveBinding.text.trim();
    if (bRef.includes(".")) {
      const parts = bRef.split(".");
      const pkgOrClass = flattener.db.byName(parts[0]!).find((e) => e.kind === "Class" || e.kind === "Package");
      if (pkgOrClass) {
        const memberEntry = flattener.db.childrenOf(pkgOrClass.id).find((c) => c.name === parts[1]);
        if (memberEntry) {
          const memType = flattener.db.query<string | null>("typeSpecifier", memberEntry.id);
          const memMod = flattener.db.query<ParentModData | null>("effectiveModification", memberEntry.id);
          const memBinding = memMod?.bindingExpression?.text?.trim();
          if (memType === "Integer" && memBinding && startsWithSignedDecimalFloat(memBinding)) {
            const memCst = getCstNode(flattener.db, memberEntry.id);
            let memClauseStart = memCst?.startIndex ?? memCst?.startOffset;
            let memClauseEnd = memCst?.endIndex ?? memCst?.endOffset;
            if (memCst) {
              let curr: SyntaxNode | null = memCst;
              while (curr && curr.type !== "component_clause") curr = curr.parent;
              if (curr) {
                memClauseStart = curr.startIndex ?? curr.startOffset;
                memClauseEnd = curr.endIndex ?? curr.endOffset;
              }
            }
            let kClauseStart = elemCst?.startIndex ?? elemCst?.startOffset;
            let kClauseEnd = elemCst?.endIndex ?? elemCst?.endOffset;
            if (elemCst) {
              let curr: SyntaxNode | null = elemCst;
              while (curr && curr.type !== "component_clause") curr = curr.parent;
              if (curr) {
                kClauseStart = curr.startIndex ?? curr.startOffset;
                kClauseEnd = curr.endIndex ?? curr.endOffset;
              }
            }
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
              message: `Type mismatch in binding ${memberEntry.name} = ${memBinding}, expected subtype of Integer, got type Real.`,
              range: { startOffset: memClauseStart, endOffset: memClauseEnd },
            });
            const scopeName =
              (flattener.currentRootClassId ? flattener.db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
              message: `Variable ${bRef} not found in scope ${scopeName}.`,
              range: { startOffset: kClauseStart, endOffset: kClauseEnd },
            });
            return "return";
          }
        }
      }
    }
  }

  if (variability === Variability.Constant && effectiveBinding?.text) {
    const bText = effectiveBinding.text.trim();
    const idMatches = extractAsciiIdentifiers(bText);
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
      let clauseNode: SyntaxNode | null = elemCst;
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
      return "return";
    }
  }

  if (variability === Variability.Parameter && effectiveBinding?.text) {
    const bText = effectiveBinding.text.trim();
    if (containsWholeWordOutsideStrings(bText, "time")) {
      const rangeObj = matchingParentArg?.modRange
        ? { startOffset: matchingParentArg.modRange[0], endOffset: matchingParentArg.modRange[1] }
        : elemCst
          ? {
              startOffset: elemCst.startIndex ?? elemCst.startOffset,
              endOffset: elemCst.endIndex ?? elemCst.endOffset,
            }
          : undefined;
      const formatted = bText.replaceAll("*", " * ");
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
        message: `Component ${compInst.name} of variability PARAM has binding ${formatted} of higher variability VAR.`,
        range: rangeObj,
      });
      return "return";
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
      const m = extractAsciiIdentifiers(bText.slice(8, -1));
      const hasContinuous = m.some((vName: string) => {
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
        return "return";
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
      return "return";
    }
  }

  const hasEqInClass = (): boolean => {
    if (!flattener.currentClassId) return false;
    const cst = getCstNode(flattener.db, flattener.currentClassId);
    if (!cst) return false;
    return hasEquationAssignmentForNameCst(cst, compInst.name);
  };

  if (
    !dae.extensionMetadata?.["isOldFrontend"] &&
    !hasEqInClass() &&
    variability === Variability.Constant &&
    !effectiveBinding?.text &&
    !parentMods?.bindingExpression &&
    !_isEnclosingFunction &&
    !isExtObj &&
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
    return "return";
  }

  /**
   * Lowers the effective binding expression (`= ...`) and applies built-in variable attributes
   * (`quantity`, `unit`, `displayUnit`, `min`, `max`, `start`, `fixed`, `nominal`, `stateSelect`)
   * to `varIdx`, slicing array-valued bindings and attributes by `idxTuple` when scalarizing arrays.
   */
  const arrayDimsRef: { current: number[] | null | undefined } = { current: undefined };
  const applyModifiers = (varIdx: number, idxTuple: number[] = [], currentDimLabels?: (string[] | null)[]) => {
    const arrayDims = arrayDimsRef.current;
    const prevBindingCompName = flattener.currentBindingCompName;
    flattener.currentBindingCompName = compInst.name;
    try {
      const bindingPrefix =
        parentMods?.bindingScope !== undefined && isParentBoundField
          ? parentMods.bindingScope
          : effectiveParentArg?.value && (!effectiveParentArg?.isExtendsMod || effectiveParentArg?.isFromParentExtends)
            ? prefix.includes(".")
              ? prefix.split(".").slice(0, -1).join(".")
              : ""
            : prefix;
      const isArrayTarget = (targetName: string) => {
        return (
          dae.hasArrayElements(targetName) ||
          flattener.db.byName(targetName).some((e) => {
            if (flattener.options.omcCompatibility && flattener.db.query("variability", e.id) === "constant") {
              return false;
            }
            const d = flattener.db.query<ArrayDimRawEntry[] | null>("arrayDimensions", e.id);
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
      if (
        dae.classKind === "function" &&
        Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
        isRecordTarget &&
        classTarget &&
        !effectiveBinding?.text &&
        compInst?.modification?.args &&
        compInst.modification.args.length > 0 &&
        flattener.generateRecordConstructorFor
      ) {
        const ctorFn = flattener.generateRecordConstructorFor(classTarget, dae, flattener.currentRootClassId);
        if (ctorFn) {
          const modMap = new Map<string, ModValueData>();
          for (const mArg of compInst.modification.args) {
            if (mArg.name && mArg.value?.text) {
              modMap.set(mArg.name, mArg.value);
            }
          }
          const callArgIds: number[] = [];
          const boundEnv = new Map<string, number>();
          for (let vi = 0; vi < ctorFn.varCount; vi++) {
            if (ctorFn.getVarCausality(vi) === Causality.Input) {
              const fName = ctorFn.getVarName(vi);
              const fType = ctorFn.getVarType(vi);
              let argExprId = -1;
              if (modMap.has(fName)) {
                const modVal = modMap.get(fName)!;
                const modText = stripLeadingEquals(modVal.text ?? "");
                const num = Number(modText);
                if (!isNaN(num) && modText !== "") {
                  argExprId = fType === VarType.Integer ? dae.addIntLiteral(num) : dae.addRealLiteral(num);
                } else if (isAsciiIdentifier(modText)) {
                  argExprId = dae.addNameExpr(prefix ? `${prefix}.${modText}` : modText);
                } else if (modVal.cstBytes && flattener.lowerExpr) {
                  const scopeSym = elemId ? flattener.db.symbol(elemId) : undefined;
                  const modCst = getCstNodeRange(
                    flattener.db,
                    modVal.cstBytes[0],
                    modVal.cstBytes[1],
                    scopeSym ?? undefined,
                  );
                  if (modCst) {
                    const exprCst = findBindingExprFromCst(modCst);
                    argExprId = flattener.lowerExpr(exprCst, dae, prefix);
                    if (fType === VarType.Real && !isRealExpr(argExprId, dae)) {
                      argExprId = castToRealExpr(argExprId, dae);
                    }
                  }
                }
              } else {
                const defExpr = ctorFn.getVarExpression(vi);
                if (defExpr !== undefined && defExpr >= 0) {
                  argExprId = copyExprBetweenDaes(ctorFn, defExpr, dae, boundEnv);
                }
              }
              if (argExprId >= 0) {
                boundEnv.set(fName, argExprId);
                callArgIds.push(argExprId);
              }
            }
          }
          const ctorCallName = ctorFn.name || classTarget.name;
          const callExprId = dae.addCallExpr(ctorCallName, callArgIds);
          dae.setVarExpression(varIdx, callExprId);
        }
      }
      if (effectiveBinding?.text) {
        let bText = effectiveBinding.text.trim();
        let exprId: number | null = null;

        if (idxTuple.length > 0) {
          const evaluatedKey = prefix ? `${prefix}.${name}` : name;
          if (flattener.evaluatedConstantArrays.has(evaluatedKey) || flattener.evaluatedConstantArrays.has(name)) {
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
          } else if (isArrayLiteral(bText) && !containsWholeWordOutsideStrings(bText, "for")) {
            bText = getIndexedElementText(bText, idxTuple);
          }
          const parsedBuiltinCall = parseNamedCallArgsFromText(bText);
          const builtinCallee =
            parsedBuiltinCall && !parsedBuiltinCall.argsText.includes(")") ? parsedBuiltinCall.callee : "";
          if (builtinCallee === "zeros") {
            exprId = varType === VarType.Integer ? dae.addIntLiteral(0) : dae.addRealLiteral(0.0);
          } else if (builtinCallee === "ones") {
            bText = varType === VarType.Integer ? "1" : "1.0";
            exprId = varType === VarType.Integer ? dae.addIntLiteral(1) : dae.addRealLiteral(1.0);
          } else if (builtinCallee === "identity" && idxTuple.length >= 2) {
            const isDiag = idxTuple[0] === idxTuple[1];
            bText = isDiag ? (varType === VarType.Integer ? "1" : "1.0") : varType === VarType.Integer ? "0" : "0.0";
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
              let innerMatch = bText.slice(bText.indexOf("(") + 1);
              if (innerMatch.endsWith(")")) innerMatch = innerMatch.slice(0, -1);
              innerMatch = innerMatch.trim();
              const elemText = getIndexedElementText(innerMatch, [idxTuple[0]!]);
              const numVal = Number(elemText);
              if (!Number.isNaN(numVal)) {
                bText =
                  varType === VarType.Real ? (Number.isInteger(numVal) ? `${numVal}.0` : String(numVal)) : elemText;
                exprId = varType === VarType.Real ? dae.addRealLiteral(numVal) : dae.addIntLiteral(numVal);
              } else {
                bText = elemText;
              }
            }
          } else if (isAsciiIdentifier(bText) && isArrayTarget(bText)) {
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
          } else if (bText.startsWith("-") && isAsciiIdentifier(stripLeadingMinusWs(bText))) {
            const target = stripLeadingMinusWs(bText);
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
            if (dae.extensionMetadata?.["isOldFrontend"]) {
              const loweredFirstArg = lowerStandaloneExpression(
                flattener,
                firstArg,
                dae,
                bindingPrefix,
                compInst.name,
                varType,
              );
              if (loweredFirstArg !== null) {
                exprId = loweredFirstArg;
              } else {
                bText = firstArg;
              }
            } else {
              bText = firstArg;
            }
          } else if (bText.startsWith("array(") && bText.endsWith(")") && idxTuple.length > 0) {
            const compMatch = parseArrayComprehension(bText);
            if (compMatch) {
              const bodyStr = compMatch.body;
              const iterVar = compMatch.iter;
              const rangeExpr = compMatch.range;
              const rangeVals = evaluateComprehensionRangeValues(
                rangeExpr,
                flattener,
                dae,
                bindingPrefix,
                flattener.currentClassId ?? undefined,
              );
              const iterVal =
                rangeVals && idxTuple[0]! - 1 < rangeVals.length ? rangeVals[idxTuple[0]! - 1]! : String(idxTuple[0]);
              bText = replaceWordOutsideStrings(bodyStr, iterVar, iterVal, false);
            }
          } else {
            const modChildForIf = elemCst?.children?.find((c) => c.type === "modification");
            const rawExprCstForIf = findFirstExpressionCst(modChildForIf ?? elemCst);
            const scalarizedIfId = tryScalarizeIfSizeBindingCst(rawExprCstForIf, bText, idxTuple, bindingPrefix, dae);
            if (scalarizedIfId !== null) {
              exprId = scalarizedIfId;
            }
          }
        }

        // Try lowering from CST node if available
        const findBindingExprNode = findBindingExprFromCst;

        const modChild = elemCst?.children?.find((c) => c.type === "modification");
        const exprCst = findBindingExprNode(modChild ?? elemCst);
        const varShapeAtIdx = dae.getVarShape(varIdx);
        const isPreservedArrayVar = (arrayDims && arrayDims.length > 0) || (varShapeAtIdx && varShapeAtIdx.length > 0);
        if (idxTuple.length === 0 && !isPreservedArrayVar && bText) {
          const cleanB = stripLeadingEquals(bText);
          if (isArrayLiteral(cleanB) && !containsWholeWordOutsideStrings(cleanB, "for")) {
            const ctorElems = parseArrayLiteralElements(cleanB);
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
          const prevClassId = flattener.currentClassId;
          const elemOwnerId =
            effectiveBinding?.evaluationScopeId ?? flattener.db.symbol(elemId)?.parentId ?? flattener.currentClassId;
          if (elemOwnerId) flattener.currentClassId = elemOwnerId;
          try {
            exprId = flattener.lowerExpr(exprCst, dae, prefix);
          } finally {
            flattener.currentClassId = prevClassId;
          }
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
            const litShortName = lastDot >= 0 ? fullLit.slice(lastDot + 1) : fullLit;

            let rhsTypeSym: SymbolEntry | null | undefined = null;
            if (rhsTypePath) {
              const evalScope = elemOwnerId ?? flattener.currentClassId;
              const resolveName = evalScope
                ? (flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", evalScope) ??
                  flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", evalScope))
                : null;
              if (resolveName) {
                rhsTypeSym = resolveName(rhsTypePath);
              }
              if (!rhsTypeSym) {
                const fqnCandidates = flattener.db
                  .byName(rhsTypePath)
                  .filter((s) => s.kind === "Class" || s.kind === "Type");
                if (fqnCandidates.length > 0) rhsTypeSym = fqnCandidates[0];
              }
              if (!rhsTypeSym) {
                const rhsShortName = rhsTypePath.split(".").pop()!;
                const rhsTypeSyms = flattener.db
                  .byName(rhsShortName)
                  .filter((s) => s.kind === "Class" || s.kind === "Type");
                rhsTypeSym = rhsTypeSyms.find((s) => s.kind === "Class") ?? rhsTypeSyms[0];
              }
            }
            const baseRhsSym = rhsTypeSym ? (getBaseEnumSymbol(flattener.db, rhsTypeSym) ?? rhsTypeSym) : null;
            const rhsLits = baseRhsSym
              ? (extractEnumLiteralsFromCst(getCstNode(flattener.db, baseRhsSym.id), getSymMeta(baseRhsSym)) ?? [])
              : [];
            const targetLits = enumLiterals ? enumLiterals.map(getEnumLiteralName) : [];
            const isSubtype =
              (rhsLits.length > 0 && rhsLits.every((lit: string) => targetLits.includes(lit))) ||
              (rhsLits.length === 0 && targetLits.includes(litShortName));
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
            const compName = prefix ? `.${prefix}.${compInst.name}` : `.${compInst.name}`;
            const modExprText = bText.startsWith("=") ? bText : `=${bText}`;
            let rhsText = stripLeadingEquals(bText);
            if (varType === VarType.Integer && providedType === VarType.Real && exprId !== null && exprId >= 0) {
              const cVal = evalDaeExpr(exprId, dae);
              if (typeof cVal === "number") {
                rhsText = cVal.toFixed(1);
              }
            }
            if (dae.extensionMetadata?.["isOldFrontend"] && dae.classKind === "function") {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.code,
                message: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.message(
                  compName,
                  varTypeName(varType),
                  modExprText,
                  varTypeName(providedType ?? VarType.Real),
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
                  varTypeName(providedType ?? VarType.Real),
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
              const litName = getEnumLiteralName(lit);
              const enumPrefix = customType ?? "";
              const fullEnumName = enumPrefix ? `${enumPrefix}.${litName}` : litName;
              exprId = dae.addEnumLiteral(val, fullEnumName);
            }
          }
        }

        if (exprId === null) {
          const trimmedBindingText = effectiveBinding.text.trim();
          const parsedArrayCall = parseNamedCallArgsFromText(trimmedBindingText);
          const isArrayCompBinding =
            parsedArrayCall?.callee === "array" &&
            parsedArrayCall.argsText.trim().length > 0 &&
            containsWholeWordOutsideStrings(parsedArrayCall.argsText, "for");
          if (effectiveBinding.cstBytes && !isArrayCompBinding) {
            const targetScopeId =
              effectiveBinding?.evaluationScopeId ??
              effectiveParentArg?.evaluationScopeId ??
              effectiveClassArg?.evaluationScopeId ??
              elemId ??
              flattener.currentClassId ??
              flattener.currentRootClassId;
            const scopeSym = targetScopeId ? flattener.db.symbol(targetScopeId) : undefined;
            const scopeClassId =
              scopeSym?.kind === "Class" ? targetScopeId : (scopeSym?.parentId ?? flattener.currentClassId);
            const bindCst = getCstNodeRange(
              flattener.db,
              effectiveBinding.cstBytes[0],
              effectiveBinding.cstBytes[1],
              scopeSym ?? undefined,
            );
            if (bindCst) {
              const prevClassId = flattener.currentClassId;
              if (scopeClassId) flattener.currentClassId = scopeClassId;
              try {
                let innerCst = findBindingExprFromCst(bindCst);
                let scalarFactorExprId: number | null = null;
                if (idxTuple.length > 0) {
                  if (innerCst && innerCst.children?.some((k) => k.text === "*")) {
                    const leftChild = innerCst.children?.[0];
                    const rightChild = innerCst.children?.[innerCst.children.length - 1];
                    const leftText = leftChild?.text?.trim() ?? "";
                    const rightText = rightChild?.text?.trim() ?? "";
                    if (rightText.startsWith("{") || rightText.startsWith("[")) {
                      scalarFactorExprId = flattener.lowerExpr(leftChild, dae, bindingPrefix);
                      innerCst = rightChild ?? null;
                    } else if (leftText.startsWith("{") || leftText.startsWith("[")) {
                      scalarFactorExprId = flattener.lowerExpr(rightChild, dae, bindingPrefix);
                      innerCst = leftChild ?? null;
                    }
                  }

                  const text = innerCst?.text?.trim() ?? "";
                  const innerCount = innerCst?.childCount ?? innerCst?.children?.length ?? 0;
                  const isBracket =
                    (innerCst?.child?.(0)?.text === "[" || text.startsWith("[")) &&
                    ((innerCount > 0 && innerCst?.child?.(innerCount - 1)?.text === "]") || text.endsWith("]"));
                  const isBrace = isArrayLiteral(text) && !containsWholeWordOutsideStrings(text, "for");
                  if (isBracket && idxTuple.length === 2) {
                    const rows = getArrayLiteralItems(innerCst);
                    const rowIdx = idxTuple[0]!;
                    const colIdx = idxTuple[1]!;
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
                        innerCst = cols[colIdx - 1] ?? null;
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
                        innerCst.child?.(0)?.text === "[" ||
                        innerCst.text?.startsWith("[") ||
                        innerCst.child?.(0)?.text === "{" ||
                        innerCst.text?.startsWith("{");
                      if (!nodeIsArray) {
                        innerCst = null;
                        break;
                      }
                      const items = getArrayLiteralItems(innerCst);
                      if (items.length >= idx) {
                        innerCst = items[idx - 1] ?? null;
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
                  const rawBindCst = findBindingExprFromCst(bindCst);
                  const loweredBindId = flattener.lowerExpr(rawBindCst, dae, bindingPrefix);
                  if (loweredBindId >= 0) {
                    const isConstOrFinalParamTree = (id: number): boolean => {
                      const k = dae.getExprKind(id);
                      if (k === ExprKind.RealLiteral || k === ExprKind.IntLiteral || k === ExprKind.BoolLiteral) {
                        return true;
                      }
                      if (k === ExprKind.Negate || k === ExprKind.Unary) {
                        return isConstOrFinalParamTree(dae.getExprLeft(id));
                      }
                      if (k === ExprKind.Binary) {
                        return (
                          isConstOrFinalParamTree(dae.getExprLeft(id)) && isConstOrFinalParamTree(dae.getExprRight(id))
                        );
                      }
                      if (k === ExprKind.Name) {
                        const vName = dae.interner.resolve(dae.getExprData1(id)) ?? "";
                        const vIdx = dae.lookupVariable(vName);
                        if (vIdx >= 0) {
                          const vVar = dae.getVarVariability(vIdx);
                          return (
                            vVar === Variability.Constant || (vVar === Variability.Parameter && dae.isVarFinal(vIdx))
                          );
                        }
                      }
                      return false;
                    };
                    const inlineArrayCtorLiterals = (id: number): number => {
                      if (dae.getExprKind(id) === ExprKind.ArrayCtor) {
                        const elems = getArrayCtorElements(id, dae);
                        return dae.addArrayCtorExpr(elems.map(inlineArrayCtorLiterals));
                      }
                      if (dae.getExprKind(id) === ExprKind.Name) {
                        const vName = dae.interner.resolve(dae.getExprData1(id)) ?? "";
                        const vIdx = dae.lookupVariable(vName);
                        if (vIdx >= 0) {
                          const vExpr = dae.getVarExpression(vIdx);
                          if (
                            vExpr !== undefined &&
                            vExpr >= 0 &&
                            (dae.getExprKind(vExpr) === ExprKind.RealLiteral ||
                              dae.getExprKind(vExpr) === ExprKind.IntLiteral ||
                              dae.getExprKind(vExpr) === ExprKind.Negate)
                          ) {
                            return vExpr;
                          }
                        }
                      }
                      if (isConstOrFinalParamTree(id)) {
                        const val = evalDaeExpr(id, dae);
                        if (typeof val === "number" && Number.isFinite(val)) {
                          return dae.addRealLiteral(val);
                        }
                      }
                      return id;
                    };
                    const prepareCallForScalarization = (callExprId: number): number => {
                      const fnNameId = dae.getExprData1(callExprId);
                      let callFnName = dae.interner.resolve(fnNameId) ?? "";
                      const argCount = dae.getExprRight(callExprId);
                      const firstArg = dae.getExprLeft(callExprId);
                      let fnObj = dae.getFunction(callFnName);
                      const shortFnName = callFnName.includes(".") ? callFnName.split(".").pop()! : callFnName;
                      const matchingFnSym = flattener.db.byName(shortFnName).find((e) => flattener["isFunctionSym"](e));
                      if (matchingFnSym) {
                        const qualFnName = getSymbolQualifiedName(flattener.db, matchingFnSym.id);
                        if (!callFnName.includes(".") && qualFnName.includes(".")) {
                          callFnName = qualFnName;
                        }
                        if (!fnObj) {
                          fnObj =
                            dae.getFunction(qualFnName) ??
                            flattener.flattenFunction(matchingFnSym.id, qualFnName, undefined, dae);
                          dae.addFunction(qualFnName, fnObj);
                        }
                        asExtDae(fnObj).wasCalled = true;
                        flattener.calledFunctionSymIds?.add(matchingFnSym.id);
                      }
                      const newArgs: number[] = [];
                      for (let aIdx = 0; aIdx < argCount; aIdx++) {
                        const aId = aIdx === 0 ? firstArg : dae.getExprLeft(callExprId + aIdx);
                        if (dae.getExprKind(aId) === ExprKind.ArrayCtor) {
                          newArgs.push(inlineArrayCtorLiterals(aId));
                          continue;
                        }
                        if (dae.getExprKind(aId) === ExprKind.Name) {
                          const aName = dae.interner.resolve(dae.getExprData1(aId)) ?? "";
                          if (dae.hasArrayElements(aName)) {
                            const aShape = getNamedArrayShape(dae, aName);
                            const elemIndices = dae.getArrayElementIndices(aName);
                            if (
                              elemIndices.length > 0 &&
                              elemIndices.every((eIdx) => (dae.getVarExpression(eIdx) ?? -1) >= 0)
                            ) {
                              const buildNested = (indices: number[], shape: number[]): number => {
                                if (shape.length <= 1) {
                                  return dae.addArrayCtorExpr(indices.map((eIdx) => dae.getVarExpression(eIdx) ?? -1));
                                }
                                const subLen = shape.slice(1).reduce((acc, d) => acc * d, 1);
                                const rowIds: number[] = [];
                                for (let r = 0; r < shape[0]!; r++) {
                                  rowIds.push(buildNested(indices.slice(r * subLen, (r + 1) * subLen), shape.slice(1)));
                                }
                                return dae.addArrayCtorExpr(rowIds);
                              };
                              newArgs.push(
                                buildNested(elemIndices, aShape && aShape.length > 0 ? aShape : [elemIndices.length]),
                              );
                              continue;
                            }
                          }
                          const vIdx = dae.lookupVariable(aName);
                          if (
                            vIdx >= 0 &&
                            (dae.getVarVariability(vIdx) === Variability.Constant ||
                              (dae.getVarVariability(vIdx) === Variability.Parameter &&
                                (dae.isVarFinal(vIdx) || dae.getVarType(vIdx) === VarType.Integer)))
                          ) {
                            const vExpr = dae.getVarExpression(vIdx);
                            if (vExpr !== undefined && vExpr >= 0) {
                              newArgs.push(vExpr);
                              continue;
                            }
                          }
                        }
                        newArgs.push(aId);
                      }
                      return dae.addCallExpr(callFnName, newArgs);
                    };
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
                      } else if (dae.getExprKind(curr) === ExprKind.Call) {
                        const rebuiltCall = prepareCallForScalarization(curr);
                        const remaining = idxTuple.slice(i);
                        curr = dae.addSubscriptExpr(
                          rebuiltCall,
                          remaining.map((r) => dae.addIntLiteral(r)),
                        );
                        ok = true;
                        break;
                      } else if (dae.getExprKind(curr) === ExprKind.Binary) {
                        const remaining = idxTuple.slice(i);
                        const scalarizeVecExpr = (eId: number, rem: number[]): number | null => {
                          const ek = dae.getExprKind(eId);
                          const eDims = getExprDims(eId, dae, flattener.db, flattener);
                          if (!eDims || eDims.length === 0) {
                            if (ek === ExprKind.Binary) {
                              const op = dae.getExprData1(eId);
                              const lId = dae.getExprLeft(eId);
                              const rId = dae.getExprRight(eId);
                              const lDims = getExprDims(lId, dae, flattener.db, flattener);
                              const rDims = getExprDims(rId, dae, flattener.db, flattener);
                              if ((lDims && lDims.length > 0) || (rDims && rDims.length > 0)) {
                                const sl = lDims && lDims.length > 0 ? scalarizeVecExpr(lId, rem) : lId;
                                const sr = rDims && rDims.length > 0 ? scalarizeVecExpr(rId, rem) : rId;
                                if (sl !== null && sr !== null) return dae.addBinaryExpr(op, sl, sr);
                              }
                            }
                            return eId;
                          }
                          if (ek === ExprKind.ArrayCtor || ek === ExprKind.IfElse) {
                            let sub = eId;
                            for (const rIdx of rem) {
                              const subElems = getArrayCtorElements(sub, dae);
                              if (rIdx >= 1 && rIdx <= subElems.length) {
                                sub = subElems[rIdx - 1]!;
                              } else {
                                return null;
                              }
                            }
                            return sub;
                          }
                          if (ek === ExprKind.Name) {
                            const vName = dae.interner.resolve(dae.getExprData1(eId));
                            return dae.addExpression(ExprKind.Name, dae.interner.intern(`${vName}[${rem.join(",")}]`));
                          }
                          if (ek === ExprKind.Call) {
                            const callVal = evalDaeExpr(eId, dae);
                            if (Array.isArray(callVal)) {
                              let cur: unknown = callVal;
                              for (const r of rem) {
                                cur = Array.isArray(cur) ? cur[r - 1] : undefined;
                              }
                              if (typeof cur === "number" && Number.isFinite(cur)) {
                                return dae.addRealLiteral(cur);
                              }
                            }
                            const rebuiltCall = prepareCallForScalarization(eId);
                            return dae.addSubscriptExpr(
                              rebuiltCall,
                              rem.map((r) => dae.addIntLiteral(r)),
                            );
                          }
                          if (ek === ExprKind.Binary) {
                            const op = dae.getExprData1(eId);
                            const lId = dae.getExprLeft(eId);
                            const rId = dae.getExprRight(eId);
                            const lDims = getExprDims(lId, dae, flattener.db, flattener);
                            const rDims = getExprDims(rId, dae, flattener.db, flattener);
                            const sl = lDims && lDims.length > 0 ? scalarizeVecExpr(lId, rem) : lId;
                            const sr = rDims && rDims.length > 0 ? scalarizeVecExpr(rId, rem) : rId;
                            if (sl !== null && sr !== null) {
                              if (op === BinOp.Mul) return mulWithSimplification(sl, sr, dae);
                              if (op === BinOp.Add) {
                                const isLitZero = (id: number) =>
                                  (dae.getExprKind(id) === ExprKind.RealLiteral && dae.getExprRealValue(id) === 0) ||
                                  (dae.getExprKind(id) === ExprKind.IntLiteral && dae.getExprData1(id) === 0);
                                if (isLitZero(sl)) return sr;
                                if (isLitZero(sr)) return sl;
                              }
                              return dae.addBinaryExpr(op, sl, sr);
                            }
                          }
                          if (ek === ExprKind.Negate || ek === ExprKind.Unary) {
                            const sChild = scalarizeVecExpr(dae.getExprLeft(eId), rem);
                            if (sChild !== null) {
                              return ek === ExprKind.Negate
                                ? dae.addNegateExpr(sChild)
                                : dae.addUnaryExpr(dae.getExprData1(eId), sChild);
                            }
                          }
                          return null;
                        };
                        const sRes = scalarizeVecExpr(curr, remaining);
                        if (sRes !== null) {
                          curr = sRes;
                          ok = true;
                        } else {
                          ok = false;
                        }
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
              } finally {
                flattener.currentClassId = prevClassId;
              }
              if (exprId !== null && exprId >= 0) {
                const providedType = inferArenaExprVarType(dae, exprId);
                if (
                  providedType !== null &&
                  !isAssignableType(providedType, varType, {
                    intEnumConversion: flattener.options?.intEnumConversion,
                  })
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
                  const compName = prefix ? `.${prefix}.${compInst.name}` : `.${compInst.name}`;
                  const modExprText = bText.startsWith("=") ? bText : `=${bText}`;
                  if (varType === VarType.Integer && providedType === VarType.Real) {
                    let rhsText = stripLeadingEquals(bText);
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
                  } else if (!prefix && (!dae.extensionMetadata?.["isOldFrontend"] || dae.classKind !== "function")) {
                    let rhsText = stripLeadingEquals(bText);
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
                    const litName = getEnumLiteralName(lit);
                    const enumPrefix = customType ?? "";
                    const fullEnumName = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                    exprId = dae.addEnumLiteral(val, fullEnumName);
                  }
                }
              }
            }
          }
        }

        if (
          exprId === null &&
          bText &&
          (bText.includes("(") ||
            bText.includes("*") ||
            bText.includes("/") ||
            bText.includes("+") ||
            bText.includes("-"))
        ) {
          const prevClassId = flattener.currentClassId;
          const prevEvalImports = flattener.currentImports;
          const evalScopeId =
            effectiveParentArg?.evaluationScopeId ??
            effectiveClassArg?.evaluationScopeId ??
            flattener.db.symbol(elemId)?.parentId ??
            flattener.currentClassId;
          if (evalScopeId) {
            flattener.currentClassId = evalScopeId;
            const ownerImports = flattener["collectClassImports"]?.(evalScopeId);
            if (ownerImports) {
              flattener.currentImports = new Map([...flattener.currentImports, ...ownerImports]);
            }
          }
          try {
            exprId = lowerStandaloneExpression(flattener, bText, dae, bindingPrefix, compInst.name, varType);
          } finally {
            flattener.currentClassId = prevClassId;
            flattener.currentImports = prevEvalImports;
          }
        }

        if (exprId === null) {
          const isPureInt = isSignedAsciiIntText(bText);
          const isPureReal = isSignedAsciiNumberText(bText);
          if (varType === VarType.Real && (isPureReal || isPureInt)) {
            exprId = dae.addRealLiteral(parseFloat(bText));
          } else if (varType === VarType.Integer && isPureInt) {
            exprId = dae.addIntLiteral(parseInt(bText, 10));
          } else if (varType === VarType.Enumeration && isPureInt) {
            const val = parseInt(bText, 10);
            if (enumLiterals && val >= 1 && val <= enumLiterals.length) {
              const lit = enumLiterals[val - 1]!;
              const litName = getEnumLiteralName(lit);
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
                const subParts = denom.split("*").map((p: string) => p.trim());
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
                if (varType === VarType.Real && denomVarIdx >= 0 && dae.getVarType(denomVarIdx) === VarType.Integer) {
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
                : dae.addExpression(ExprKind.Name, dae.interner.intern(resolveScopedName(leftStr, bindingPrefix, dae)));
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
            if (
              idxTuple.length > 0 &&
              (dae.getVarIdxByName(`${resolvedBText}[${idxTuple.join(",")}]`) >= 0 ||
                dae.hasArrayElements(resolvedBText) ||
                isArrayTarget(bText))
            ) {
              exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(`${resolvedBText}[${idxTuple.join(",")}]`));
            } else {
              exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
            }
          }
        }

        const isRecordParamOrConst =
          Boolean(
            parentMods?.isRecord &&
            (varType !== VarType.Real || isParentBoundField || effectiveParentArg?.isRecordCtorArg),
          ) ||
          dae.classKind === "function" ||
          dae.classKind === "record" ||
          parentMods?.parentVariability === Variability.Parameter ||
          parentMods?.parentVariability === Variability.Constant;
        if (
          !isRecordParamOrConst &&
          dae.classKind !== "function" &&
          dae.classKind !== "record" &&
          (variability === Variability.Continuous || variability === Variability.Discrete) &&
          arrayDims &&
          arrayDims.length > 0 &&
          !dae.extensionMetadata?.["scalarizeBindings"]
        ) {
          // Continuous array binding is emitted as an equation, not a variable expression
          if (
            (flattener.options.arrayMode === "preserve" || !effectiveBinding?.text) &&
            exprId !== null &&
            exprId >= 0
          ) {
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
          if (exprId !== null) dae.setVarExpression(varIdx, exprId);
          if (
            !flattener.options.omcCompatibility &&
            !isRecordParamOrConst &&
            dae.classKind !== "function" &&
            dae.classKind !== "record" &&
            (variability === Variability.Continuous || variability === Variability.Discrete) &&
            exprId !== null &&
            exprId >= 0 &&
            exprContainsNameRef(exprId, dae)
          ) {
            const lhsExprId = dae.addNameExpr(dae.getVarName(varIdx));
            dae.addEquation(EqKind.Simple, lhsExprId, exprId);
            const extMeta = (dae.extensionMetadata ??= {});
            const emittedSet = (extMeta["emittedBindingEqVars"] ??= new Set<number>()) as Set<number>;
            emittedSet.add(varIdx);
          }
        }
      }
      // Merge attribute modifiers in precedence order (type alias -> class mod -> component mod -> parent mod)
      // so later modifiers override earlier defaults on `varIdx`.
      const combinedArgs: ModArgData[] = [
        ...typeMods,
        ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
        ...(compInst?.modification?.args || []),
        ...(parentMods?.args
          ?.filter((a) => !a.isBreak && a.name === compInst.name)
          .flatMap((a) =>
            (a.nestedArgs || a.args || []).map((na) => ({
              ...na,
              fromParentMod: !a.isExtendsMod || Boolean(a.isFromParentExtends),
              originPrefix: na.originPrefix ?? a.originPrefix,
              ownerClassId: na.ownerClassId ?? a.ownerClassId ?? parentMods?.ownerClassId,
            })),
          ) || []),
      ];
      flattener.currentBindingCompName = undefined;
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
          if (arg.value?.kind === "literal") {
            if (typeof arg.value.value === "number") {
              attrExprId =
                varType === VarType.Integer ? dae.addIntLiteral(arg.value.value) : dae.addRealLiteral(arg.value.value);
            } else if (typeof arg.value.value === "boolean") {
              attrExprId = dae.addExpression(ExprKind.BoolLiteral, arg.value.value ? 1 : 0);
            } else if (typeof arg.value.value === "string") {
              attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(arg.value.value));
            }
          } else if (arg.value?.kind === "expression" && arg.value.text) {
            let t = arg.value.text.trim();
            // Slice array-valued attribute expressions (`{...}`, `fill(...)`, `ones(...)`, `zeros(...)`)
            // by the current scalarized element's `idxTuple`.
            if (idxTuple.length > 0) {
              if (t.startsWith("{")) {
                t = getIndexedElementText(t, idxTuple);
              } else if (t.startsWith("fill(")) {
                const inside = t.slice(5, -1).trim();
                const firstArg = inside.split(",")[0]!.trim();
                t = firstArg;
              } else if (t.startsWith("ones(")) {
                t = varType === VarType.Integer ? "1" : "1.0";
              } else if (t.startsWith("zeros(")) {
                t = varType === VarType.Integer ? "0" : "0.0";
              }
            } else if (t.startsWith("fill(")) {
              const inside = t.slice(5, -1).trim();
              const firstArg = inside.split(",")[0]!.trim();
              t = firstArg;
            } else if (t.startsWith("ones(")) {
              t = varType === VarType.Integer ? "1" : "1.0";
            } else if (t.startsWith("zeros(")) {
              t = varType === VarType.Integer ? "0" : "0.0";
            }
            if (t === "true" || t === "false") {
              attrExprId = dae.addExpression(ExprKind.BoolLiteral, t === "true" ? 1 : 0);
            } else if (!isNaN(parseFloat(t))) {
              attrExprId =
                varType === VarType.Integer ? dae.addIntLiteral(parseInt(t, 10)) : dae.addRealLiteral(parseFloat(t));
            } else {
              const effAttrPrefix = arg.fromParentMod
                ? (arg.originPrefix ?? (prefix.includes(".") ? prefix.split(".").slice(0, -1).join(".") : ""))
                : bindingPrefix;
              let resolvedT = isDottedIdentifierChain(t) ? resolveScopedName(t, effAttrPrefix, dae) : t;
              // Qualify enumeration literal names in attributes (`start = Enum.lit` or `lit`)
              if (varType === VarType.Enumeration && customType && enumLiterals) {
                const enumShort = customType.split(".").pop()!;
                if (t.startsWith(`${enumShort}.`)) {
                  resolvedT = `${customType}.${t.slice(enumShort.length + 1)}`;
                } else if (enumLiterals.some((el) => getEnumLiteralName(el) === t)) {
                  resolvedT = `${customType}.${t}`;
                } else if (t.includes(".")) {
                  const litSuffix = t.split(".").pop()!;
                  if (enumLiterals.some((el) => getEnumLiteralName(el) === litSuffix)) {
                    resolvedT = `${customType}.${litSuffix}`;
                  }
                }
              }
              let isDaeVar =
                dae.getVarIdxByName(resolvedT) >= 0 || dae.getVarIdxByName(`${resolvedT}[1]`) >= 0 || isArrayTarget(t);
              if (isDaeVar && flattener.options.omcCompatibility) {
                const directIdx = dae.getVarIdxByName(resolvedT);
                const arrIdx = dae.getVarIdxByName(`${resolvedT}[1]`);
                if (
                  (directIdx >= 0 && dae.getVarVariability(directIdx) === Variability.Constant) ||
                  (arrIdx >= 0 && dae.getVarVariability(arrIdx) === Variability.Constant)
                ) {
                  isDaeVar = false;
                }
              }
              const elemParentId =
                flattener.db.symbol(elemId)?.parentId || flattener.currentClassId || flattener.currentRootClassId;
              if (!isDaeVar && effAttrPrefix && isAsciiIdentifier(t) && elemParentId) {
                const isNonConstComp = (c: SymbolEntry) =>
                  c.kind === "Component" &&
                  c.name === t &&
                  !(flattener.options.omcCompatibility && flattener.db.query("variability", c.id) === "constant");
                const candClassIds = [
                  elemParentId,
                  flattener.currentClassId,
                  parentMods?.currentClassId,
                  parentMods?.ownerClassId,
                  arg.ownerClassId,
                ].filter((id): id is SymbolId => id != null);
                const siblingComp = candClassIds.some(
                  (clsId) =>
                    flattener.db.childrenOf(clsId)?.some(isNonConstComp) ||
                    flattener.db.query<SymbolId[]>("instantiate", clsId)?.some((sid) => {
                      const s = flattener.db.symbol(sid);
                      return s ? isNonConstComp(s) : false;
                    }),
                );
                if (siblingComp) {
                  resolvedT = `${effAttrPrefix}.${t}`;
                  isDaeVar = true;
                }
              }
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
                const subParts =
                  dae.extensionMetadata?.["isOldFrontend"] && arg.name === "start"
                    ? parseBinaryIdentSubtraction(t)
                    : null;
                if (subParts) {
                  const p1 = resolveScopedName(subParts[0], effAttrPrefix, dae, state.innerOuterComponents);
                  const p2 = resolveScopedName(subParts[1], effAttrPrefix, dae, state.innerOuterComponents);
                  attrExprId = dae.addBinaryExpr(
                    BinOp.Sub,
                    dae.addExpression(ExprKind.Name, dae.interner.intern(p1)),
                    dae.addExpression(ExprKind.Name, dae.interner.intern(p2)),
                  );
                }
                let evalVal: unknown = null;
                const isIfPrefix = t.startsWith("if") && (t.length === 2 || !isAsciiIdentContinue(t.charCodeAt(2)));
                const isArrayCallPrefix = t.startsWith("array") && t.slice(5).trimStart().startsWith("(");
                const shouldSkipPreEval =
                  (flattener.options.omcCompatibility &&
                    isIfPrefix &&
                    (t.includes("flowDirection") || t.includes("allowFlowReversal")) &&
                    arg.name !== "stateSelect" &&
                    arg.name !== "fixed") ||
                  (Boolean(dae.extensionMetadata?.["isOldFrontend"]) && arg.name === "start" && isArrayCallPrefix);
                if (attrExprId === null && !shouldSkipPreEval) {
                  try {
                    const pkgScopeId = redeclPkgId ?? parentMods?.packageScopeId;
                    const elemParentSymId = flattener.db.symbol(elemId)?.parentId;
                    const scopeId = pkgScopeId ?? elemParentSymId;
                    const attrPkgPrefix = pkgScopeId
                      ? extractReplaceablePackagePrefix(t, flattener, dae, redeclPkgPrefix, parentMods, elemParentSymId)
                      : null;
                    const evalT = pkgScopeId && attrPkgPrefix ? t.slice(attrPkgPrefix.length + 1) : t;
                    const refsDaeParamInRel =
                      (evalT.includes("==") || evalT.includes("<>")) &&
                      (() => {
                        const ids = extractAsciiIdentifiers(evalT);
                        if (ids.length === 0) return false;
                        for (const id of ids) {
                          if (
                            id === "if" ||
                            id === "then" ||
                            id === "else" ||
                            id === "true" ||
                            id === "false" ||
                            id === "and" ||
                            id === "or" ||
                            id === "not"
                          )
                            continue;
                          for (const startPfx of [effAttrPrefix, prefix]) {
                            let p: string | undefined = startPfx;
                            while (p !== undefined) {
                              const cand = p ? `${p}.${id}` : id;
                              const vIdx = dae.getVarIdxByName(cand);
                              if (vIdx >= 0 && dae.getVarVariability(vIdx) !== Variability.Constant) {
                                return true;
                              }
                              const dot = p.lastIndexOf(".");
                              p = dot !== -1 ? p.slice(0, dot) : p !== "" ? "" : undefined;
                            }
                          }
                        }
                        return false;
                      })();
                    if (!refsDaeParamInRel) {
                      evalVal = flattener.db.evaluate(evalT, scopeId ?? undefined);
                      if (evalVal === null && evalT !== t) {
                        evalVal = flattener.db.evaluate(t, scopeId ?? undefined);
                      }
                    }
                    if (evalVal === null) {
                      const encPkgId =
                        pkgScopeId ??
                        (elemParentSymId ? flattener.db.symbol(elemParentSymId)?.parentId : undefined) ??
                        scopeId;
                      const dbConst =
                        (encPkgId ? lookupDbConstant(evalT, flattener.db, encPkgId) : null) ??
                        (scopeId && scopeId !== encPkgId ? lookupDbConstant(evalT, flattener.db, scopeId) : null);
                      if (dbConst !== null && dbConst.value !== undefined) {
                        evalVal = dbConst.value;
                      }
                    }
                    if (evalVal === null) {
                      evalVal = evaluateCSTNumber(evalT, undefined, scopeId ?? undefined, flattener.db, dae);
                    }
                    if (evalVal === null && evalT !== t) {
                      evalVal = evaluateCSTNumber(t, undefined, scopeId ?? undefined, flattener.db, dae);
                    }
                    if (idxTuple.length > 0 && Array.isArray(evalVal)) {
                      evalVal = evalVal[idxTuple[0]! - 1];
                    }
                    if (
                      evalVal !== null &&
                      flattener.options.omcCompatibility &&
                      !dae.extensionMetadata?.["isOldFrontend"]
                    ) {
                      const idMatches = extractAsciiIdentifiers(t);
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
                    evalVal = null;
                  }
                }
                if (evalVal === null && !shouldSkipPreEval && t.includes("(") && t.endsWith(")")) {
                  const parenIdx = t.indexOf("(");
                  const fnCallName = t.substring(0, parenIdx).trim();
                  const argsText = t.substring(parenIdx + 1, t.length - 1).trim();
                  const prefixFnCallName = prefix ? `${prefix}.${fnCallName}` : fnCallName;
                  const fnObj = dae.getFunction(fnCallName) || dae.getFunction(prefixFnCallName);
                  if (fnObj) {
                    const extFnObj = asExtDae(fnObj);
                    extFnObj.wasCalled = true;
                    if (extFnObj.symId) flattener.calledFunctionSymIds?.add(extFnObj.symId);
                    const argParts = splitTopLevelArgs(argsText);
                    const evalArgs: ArenaEvalArg[] = [];
                    let allArgsOk = true;
                    for (const ap of argParts) {
                      const vIdx = dae.lookupVariable(ap);
                      if (vIdx >= 0) {
                        const sv = dae.getVarExpression(vIdx);
                        const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(vIdx);
                        if (val !== null && val !== undefined) {
                          evalArgs.push(val as ArenaEvalArg);
                          continue;
                        }
                      }
                      const num = Number(ap);
                      if (!isNaN(num)) {
                        evalArgs.push(num);
                        continue;
                      }
                      if (ap.startsWith("{") && ap.endsWith("}")) {
                        const parsedArr = parseModelicaArrayArg(
                          ap,
                          dae,
                          flattener,
                          effAttrPrefix,
                          flattener.currentClassId ?? undefined,
                        );
                        if (parsedArr != null) {
                          evalArgs.push(parsedArr);
                          continue;
                        }
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
                          evalVal = evalVal[idxTuple[0]! - 1];
                        }
                      } catch (err: unknown) {
                        const diagErr = err as {
                          code?: number;
                          message?: string;
                          range?: DaeDiagnosticRange;
                        } | null;
                        if (
                          diagErr?.code === 4009 ||
                          diagErr?.message?.includes("causes a cyclic dependency") ||
                          diagErr?.message?.includes("assert triggered:") ||
                          diagErr?.message?.includes("limit (--eval")
                        ) {
                          let compClause: SyntaxNode | null = elemCst;
                          while (compClause && compClause.type !== "component_clause") {
                            compClause = compClause.parent;
                          }
                          const diagNode = compClause ?? elemCst;
                          const startB = diagErr.range?.startOffset ?? diagNode?.startIndex ?? diagNode?.startOffset;
                          const endB = diagErr.range?.endOffset ?? diagNode?.endIndex ?? diagNode?.endOffset;
                          dae.diagnostics.push({
                            severity: "error",
                            code: diagErr?.code ?? 0,
                            message: diagErr.message ?? "",
                            range: {
                              startOffset: startB,
                              endOffset: endB,
                              startPosition: diagErr.range?.startPosition ?? diagNode?.startPosition,
                              endPosition: diagErr.range?.endPosition ?? diagNode?.endPosition,
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
                  } else {
                    const targetSym = flattener.db.symbol(elemId);
                    const evalScopeSymId = arg.value?.evaluationScopeId ?? arg.evaluationScopeId ?? arg.ownerClassId;
                    // Resolve the CST range against the symbol that DEFINED the modifier (its
                    // resource), not the element it modifies: they may live in different files.
                    const docUri = evalScopeSymId ? flattener.db.symbol(evalScopeSymId) : undefined;
                    let attrCst = arg.value?.cstBytes
                      ? getCstNodeRange(flattener.db, arg.value.cstBytes[0], arg.value.cstBytes[1], docUri ?? targetSym)
                      : null;
                    if (!attrCst && elemCst) {
                      const findCref = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
                        if (!n) return null;
                        if ((n.type === "component_reference" || n.type === "expression") && n.text?.trim() === t) {
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
                      const prevClassIdAttr = flattener.currentClassId;
                      const prevParentModsAttr = flattener.currentParentMods;
                      const candScopeId = arg.ownerClassId ?? evalScopeSymId;
                      if (arg.fromParentMod && candScopeId != null) {
                        const candCls = flattener.db.symbol(candScopeId);
                        if (candCls) {
                          flattener.currentClassId =
                            candCls.kind === "Class" || candCls.kind === "Package"
                              ? candCls.id
                              : (candCls.parentId ?? flattener.currentClassId);
                          if (flattener.currentClassId !== prevClassIdAttr && prevParentModsAttr) {
                            flattener.currentParentMods = {
                              ...prevParentModsAttr,
                              currentClassId: flattener.currentClassId,
                            };
                          }
                        }
                      }
                      try {
                        attrExprId = flattener.lowerExpr(attrCst, dae, effAttrPrefix);
                      } finally {
                        flattener.currentClassId = prevClassIdAttr;
                        flattener.currentParentMods = prevParentModsAttr;
                      }
                    }
                  }
                } else if (typeof evalVal === "number") {
                  attrExprId =
                    varType === VarType.Integer ? dae.addIntLiteral(Math.trunc(evalVal)) : dae.addRealLiteral(evalVal);
                } else if (typeof evalVal === "boolean") {
                  attrExprId = dae.addExpression(ExprKind.BoolLiteral, evalVal ? 1 : 0);
                } else if (
                  typeof evalVal === "string" &&
                  (varType === VarType.String ||
                    arg.name === "quantity" ||
                    arg.name === "unit" ||
                    arg.name === "displayUnit")
                ) {
                  attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(evalVal));
                } else if (t.startsWith('"') && t.endsWith('"')) {
                  attrExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(t));
                } else if (attrExprId === null) {
                  const isSimpleIdent = isDottedIdentifierChain(t);
                  if (!isSimpleIdent && arg.value?.cstBytes) {
                    const targetSym = flattener.db.symbol(elemId);
                    const evalScopeSymId = arg.value?.evaluationScopeId ?? arg.evaluationScopeId ?? arg.ownerClassId;
                    // Resolve the CST range against the symbol that DEFINED the modifier (its
                    // resource), not the element it modifies: they may live in different files.
                    const docUri = evalScopeSymId ? flattener.db.symbol(evalScopeSymId) : undefined;
                    const attrCst = getCstNodeRange(
                      flattener.db,
                      arg.value.cstBytes[0],
                      arg.value.cstBytes[1],
                      docUri ?? targetSym,
                    );
                    if (attrCst) {
                      const prevNoArrayExpand = flattener["noArrayExpand"];
                      const prevClassIdAttr = flattener.currentClassId;
                      const prevParentModsAttr = flattener.currentParentMods;
                      flattener["noArrayExpand"] = true;
                      const candScopeId = arg.ownerClassId ?? evalScopeSymId;
                      if (arg.fromParentMod && candScopeId != null) {
                        const candCls = flattener.db.symbol(candScopeId);
                        if (candCls) {
                          flattener.currentClassId =
                            candCls.kind === "Class" || candCls.kind === "Package"
                              ? candCls.id
                              : (candCls.parentId ?? flattener.currentClassId);
                          if (flattener.currentClassId !== prevClassIdAttr && prevParentModsAttr) {
                            flattener.currentParentMods = {
                              ...prevParentModsAttr,
                              currentClassId: flattener.currentClassId,
                            };
                          }
                        }
                      }
                      let loweredId: number;
                      try {
                        loweredId = flattener.lowerExpr(attrCst, dae, effAttrPrefix);
                      } finally {
                        flattener["noArrayExpand"] = prevNoArrayExpand;
                        flattener.currentClassId = prevClassIdAttr;
                        flattener.currentParentMods = prevParentModsAttr;
                      }
                      if (loweredId >= 0) {
                        if (
                          varType === VarType.Real &&
                          (arg.name === "start" || arg.name === "min" || arg.name === "max" || arg.name === "nominal")
                        ) {
                          loweredId = castToRealExpr(loweredId, dae);
                        }
                        if (idxTuple.length > 0) {
                          let slicedElemId: number | null = loweredId;
                          for (const idxVal of idxTuple) {
                            if (slicedElemId !== null && dae.getExprKind(slicedElemId) === ExprKind.ArrayCtor) {
                              const ctorElems = getArrayCtorElements(slicedElemId, dae);
                              slicedElemId = idxVal >= 1 && idxVal <= ctorElems.length ? ctorElems[idxVal - 1]! : null;
                            } else {
                              slicedElemId = null;
                              break;
                            }
                          }
                          if (slicedElemId !== null && slicedElemId >= 0) {
                            attrExprId = slicedElemId;
                          } else {
                            attrExprId = dae.addSubscriptExpr(
                              loweredId,
                              idxTuple.map((idxVal) => dae.addIntLiteral(idxVal)),
                            );
                          }
                        } else {
                          attrExprId = loweredId;
                        }
                      }
                    }
                  }
                  if (attrExprId === null) {
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
      if (parentMods?.forceFixedFalse) {
        dae.setVarAttr(varIdx, "fixed", dae.addExpression(ExprKind.BoolLiteral, 0));
        dae.setVarFixed(varIdx, false);
      }
    } finally {
      flattener.currentBindingCompName = prevBindingCompName;
    }
  };

  const arrayAction = resolveArrayDimsAndEmit({
    flattener,
    elements,
    elemId,
    arrayDimsRef,
    compInst,
    fullCompName,
    elemCst,
    prefix,
    basePrefix,
    dae,
    state,
    parentMods,
    matchingParentArg,
    ctx,
    varType,
    customType,
    typeMods,
    enumLiterals,
    variability,
    isEvaluated,
    causality,
    isParentBoundField,
    effectiveBinding,
    bText: bText ?? "",
    _isEnclosingFunction,
    applyModifiers,
  });
  if (arrayAction === "return") return "return";
  if (arrayAction === "continue" || arrayAction === "handled") return "continue";
  {
    const varIdx = dae.addVariable(
      dae.interner.intern(name),
      varType as number,
      variability as number,
      causality as number,
      0.0,
    );
    if (parentMods?.outerArrayDims && parentMods.outerArrayDims.length > 0) {
      dae.setVarShape(varIdx, parentMods.outerArrayDims);
      dae.setVarShapeExprs(
        varIdx,
        parentMods.outerArrayDims.map((od: number) => dae.addIntLiteral(od)),
      );
    }
    if (isComponentHidden(flattener, elemId)) {
      dae.hiddenVarIndices.add(varIdx);
    }
    if (elemCst) {
      const startB = elemCst.startIndex ?? elemCst.startOffset;
      const endB = elemCst.endIndex ?? elemCst.endOffset;
      if (startB != null && endB != null) {
        dae.setVarSourceRange(varIdx, startB, endB);
      }
    }
    if (isElemProtected) {
      dae.setVarProtected(varIdx, true);
    }
    validateFunctionComponentDeclaration(flattener, dae, compInst, causality, isElemProtected, elemCst);
    if (compInst?.flowPrefix === "flow" || meta.flowPrefix === "flow" || parentMods?.parentFlowPrefix === "flow") {
      dae.setVarFlow(varIdx, true);
    }
    if (
      compInst?.flowPrefix === "stream" ||
      meta.flowPrefix === "stream" ||
      parentMods?.parentFlowPrefix === "stream"
    ) {
      dae.setVarStream(varIdx, true);
    }
    if (
      compInst?.isFinal ||
      meta.isFinal ||
      (parentMods?.isFinal && parentMods?.isRecord) ||
      (!dae.extensionMetadata?.["isOldFrontend"] &&
        (parentMods?.isFinal ||
          matchingParentArg?.final ||
          matchingClassArg?.final ||
          redeclArg?.final ||
          (isEvaluated && varType === VarType.Enumeration)))
    ) {
      dae.setVarFinal(varIdx, true);
    }
    applyModifiers(varIdx, []);
    const rootClassId = flattener.currentRootClassId ?? flattener.currentClassId;
    const rawConstBindText = stripLeadingEquals(String(effectiveBinding?.text ?? ""));
    const isNumericLiteralConst = effectiveBinding?.kind === "literal" || isSignedAsciiNumberText(rawConstBindText);
    if (
      dae.extensionMetadata?.["isOldFrontend"] &&
      variability === Variability.Constant &&
      prefix &&
      !parentMods?.isRecord &&
      parentMods?.parentVariability !== Variability.Constant &&
      isNumericLiteralConst &&
      rootClassId != null
    ) {
      const clsCst = flattener.db.cstNode(rootClassId) as { text?: string } | undefined;
      const fullName = `${prefix}.${compInst.name}`;
      const isUsedInOwner = containsWholeWordOutsideStrings(String(clsCst?.text ?? ""), fullName);
      const declaringClassId = flattener.db.symbol(elemId)?.parentId;
      const declCst =
        declaringClassId != null ? (flattener.db.cstNode(declaringClassId) as { text?: string } | undefined) : null;
      const isUsedInDecl = countWordOccurrencesOutsideStrings(String(declCst?.text ?? ""), compInst.name) > 1;
      if (!isUsedInOwner && !isUsedInDecl) {
        dae.removeVariable(varIdx);
      }
    }
  }
  return "continue";
}
