// SPDX-License-Identifier: AGPL-3.0-or-later

import { Causality, DAEBuilder, Variability, type SymbolId } from "@modelscript/runtime";
import { type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import {
  getSymbolQualifiedName,
  isAsciiDigitsOnly,
  isAsciiIdentifier,
  isSignedAsciiIntText,
  parseArrayLiteralElements,
  parseIdentSubscriptText,
  stripComments,
} from "../../expressions/index.js";
import { getElementDiagRange } from "../../support/range-utils.js";
import { type FlattenerCstNode, type ParentModsLike } from "../../types.js";
import { extractEnumSpecifier, extractEnumSpecifierFromText, findInstNameForArg } from "./cst-helpers.js";
import { classFindMember } from "./modifications.js";
import {
  getCstNode,
  getDaeExtMeta,
  modArgDiagRange,
  type ArrayDimRawEntry,
  type ComponentFlattener,
  type ComponentInstanceInfo,
  type ModArgData,
  type ParentModData,
} from "./types.js";

/**
 * Validates class-level modification and `redeclare` arguments against `defaultTargetClassId`.
 *
 * Checks for:
 * 1. Duplicate `redeclare` clauses targeting the same element in the same modification scope.
 * 2. Missing `redeclare` keyword when attempting to modify a nested class definition (`= ...`).
 * 3. Non-existent target elements in `redeclare` clauses.
 * 4. Kind mismatches (`redeclare` of a class as a component or vice versa).
 * 5. Enumeration subtyping constraints when redeclaring replaceable `enumeration(:)` or concrete enum types.
 *
 * @param flattener - Active component flattener context.
 * @param defaultTargetClassId - Target class symbol ID being modified.
 * @param args - List of parsed modification/redeclaration arguments.
 * @param dae - Target `DAEBuilder` to record any validation diagnostics.
 * @returns `true` if all class modifiers are valid; `false` if a fatal diagnostic was emitted.
 */
export function validateClassModifiers(
  flattener: ComponentFlattener,
  defaultTargetClassId: SymbolId,
  args: readonly ModArgData[],
  dae: DAEBuilder,
): boolean {
  const seenRedecls = new Map<string, ModArgData>();
  for (const arg of args) {
    if (arg.isBreak) continue;
    if (arg.isRedeclaration && arg.name) {
      const prevRedecl = seenRedecls.get(arg.name);
      if (prevRedecl) {
        if (
          (prevRedecl.isExtendsMod &&
            arg.isExtendsMod &&
            prevRedecl.extendsTargetClassId !== arg.extendsTargetClassId) ||
          Boolean(prevRedecl.isExtendsMod) !== Boolean(arg.isExtendsMod) ||
          (prevRedecl.evaluationScopeId !== undefined &&
            arg.evaluationScopeId !== undefined &&
            prevRedecl.evaluationScopeId !== arg.evaluationScopeId)
        ) {
          seenRedecls.set(arg.name, arg);
          continue;
        }
        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: modArgDiagRange(prevRedecl),
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.DUPLICATE_REDECLARE.code,
          message: ModelicaErrorCode.DUPLICATE_REDECLARE.message(arg.name),
          range: modArgDiagRange(arg),
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
          range: modArgDiagRange(arg),
        });
        return false;
      }
    }

    // 2. Redeclaration checks
    if (arg.isRedeclaration) {
      if (!arg.name) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.PARSE_ERROR.code,
          message: "Internal error Unknown redeclare in NFSCodeFlattenImports.flattenRedeclare",
        });
        return false;
      }
      const targetMember = classFindMember(flattener, targetClassId, arg.name);
      if (!targetMember) {
        // Element not found in class (NonexistentRedeclareModifier1 & 2)
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code,
          message: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(arg.name, targetClassName),
          range: modArgDiagRange(arg),
        });
        return false;
      }

      // Invalid redeclaration of class as component (RedeclareClassComponent)
      if (targetMember.kind === "Class" && arg.redeclaredKind === "component") {
        const childCst = getCstNode(flattener.db, targetMember.id);
        let spec = childCst?.children?.find(
          (ch) => ch.type === "class_specifier" || ch.type === "short_class_specifier",
        );
        if (spec?.children?.[0]?.type === "short_class_specifier") spec = spec.children[0];
        const errNode = spec ?? childCst;

        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: modArgDiagRange(arg),
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.INVALID_REDECLARATION_CLASS_AS_COMPONENT.code,
          message: ModelicaErrorCode.INVALID_REDECLARATION_CLASS_AS_COMPONENT.message(targetMember.name),
          range: {
            startOffset: errNode?.startIndex ?? errNode?.startOffset,
            endOffset: errNode?.endIndex ?? errNode?.endOffset,
            startPosition: errNode?.startPosition,
            endPosition: errNode?.endPosition,
          },
        });
        return false;
      }

      // Invalid redeclaration of component as class (RedeclareComponentClass)
      if (targetMember.kind === "Component" && arg.redeclaredKind === "class") {
        const compCst = getCstNode(flattener.db, targetMember.id);
        const diagRange = getElementDiagRange(compCst);

        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: modArgDiagRange(arg),
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
        const targetCst = getCstNode(flattener.db, targetMember.id);
        const targetEnum = extractEnumSpecifier(targetCst, true);
        if (targetEnum) {
          const isTargetGeneric = targetEnum.isGeneric;
          const targetLits = targetEnum.literals;

          const modText = stripComments(arg.modText ?? "");
          const eqPos = modText.indexOf("=");
          let rhsAfterEq = "";
          if (eqPos >= 0) {
            let endPos = eqPos + 1;
            while (endPos < modText.length && modText[endPos] !== "\n" && modText[endPos] !== ";") endPos++;
            rhsAfterEq = modText.slice(eqPos + 1, endPos).trim();
          }
          const rhsVal = rhsAfterEq || (arg.redeclaredTypeSpecifier ?? "");

          let isEnumRhs = false;
          let rhsLits: string[] = [];
          const rhsEnum = extractEnumSpecifierFromText(rhsVal, false, true);
          if (rhsEnum) {
            isEnumRhs = true;
            rhsLits = rhsEnum.literals;
          } else if (rhsVal && !["Real", "Integer", "Boolean", "String"].includes(rhsVal)) {
            const typeSym = flattener.db.byName(rhsVal).find((e) => e.kind === "Class" || e.kind === "Type");
            if (typeSym) {
              const tCst = getCstNode(flattener.db, typeSym.id);
              const tEnum = extractEnumSpecifier(tCst, false);
              if (tEnum) {
                isEnumRhs = true;
                rhsLits = tEnum.literals;
              }
            }
          }

          let errNode = targetCst;
          const shortDef = targetCst?.children?.find(
            (ch) => ch.type === "short_class_definition" || ch.type === "short_class_specifier",
          );
          if (shortDef) {
            errNode = shortDef;
          } else {
            const spec = targetCst?.children?.find((ch) => ch.type === "class_specifier");
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
              range: modArgDiagRange(arg),
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.REDECLARE_ENUM_NOT_SUBTYPE.code,
              message: ModelicaErrorCode.REDECLARE_ENUM_NOT_SUBTYPE.message(targetMember.name),
              range: {
                startOffset: errNode?.startIndex ?? errNode?.startOffset,
                endOffset: errNode?.endIndex ?? errNode?.endOffset,
                startPosition: errNode?.startPosition,
                endPosition: errNode?.endPosition,
              },
            });
            return false;
          } else if (!isTargetGeneric) {
            const isSubset = rhsLits.every((l) => targetLits.includes(l));
            if (!isSubset) {
              if (dae.extensionMetadata?.["isOldFrontend"]) {
                const missingLit = targetLits.find((l) => !rhsLits.includes(l!)) ?? targetLits[0];
                const missingRef = `${targetMember.name}.${missingLit}`;
                const targetClassCst = getCstNode(flattener.db, targetClassId);
                const findEq = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
                  if (!n) return null;
                  if (n.type === "simple_equation" && n.text?.includes(missingRef)) return n;
                  for (const ch of n.children || []) {
                    const found = findEq(ch);
                    if (found) return found;
                  }
                  return null;
                };
                const eqNode = findEq(targetClassCst) ?? errNode;
                const lhsText = eqNode?.child?.(0)?.text?.trim() ?? eqNode?.children?.[0]?.text?.trim();
                const classFqn = getSymbolQualifiedName(flattener.db, targetClassId) ?? targetClassName;
                const compClauseNode =
                  arg.cstNode?.parent?.parent?.parent ??
                  (flattener.currentClassId ? getCstNode(flattener.db, flattener.currentClassId) : null);
                let instName = "tt";
                if (compClauseNode?.text && arg.modText) {
                  const foundInst = findInstNameForArg(compClauseNode, arg.name);
                  if (foundInst) instName = foundInst;
                }
                const scopeName = `${classFqn}$${instName}`;
                const eqRange = {
                  startOffset: eqNode?.startIndex ?? eqNode?.startOffset,
                  endOffset: eqNode?.endIndex ?? eqNode?.endOffset,
                  startPosition: eqNode?.startPosition,
                  endPosition: eqNode?.endPosition,
                };
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                  message: ModelicaErrorCode.VARIABLE_NOT_FOUND.message(missingRef, scopeName),
                  range: eqRange,
                });
                if (lhsText && lhsText !== missingRef) {
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                    message: ModelicaErrorCode.VARIABLE_NOT_FOUND.message(lhsText, scopeName),
                    range: eqRange,
                  });
                }
                return false;
              }
              dae.diagnostics.push({
                severity: "notification",
                code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                message: "From here:",
                range: modArgDiagRange(arg),
              });
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.REDECLARE_ENUM_NOT_SUBTYPE_GENERIC.code,
                message: ModelicaErrorCode.REDECLARE_ENUM_NOT_SUBTYPE_GENERIC.message(targetMember.name),
                range: {
                  startOffset: errNode?.startIndex ?? errNode?.startOffset,
                  endOffset: errNode?.endIndex ?? errNode?.endOffset,
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

/**
 * Validates Modelica §12.2 restrictions on component declarations inside a `function`:
 * 1. Formal parameters and local variables cannot carry `inner` or `outer` prefixes.
 * 2. Formal `input` and `output` parameters cannot be declared inside a `protected` section.
 * 3. Non-input/non-output local variables (other than `constant` or `parameter`) must be `protected`.
 *
 * @param flattener - Active component flattener context.
 * @param dae - Target function `DAEBuilder` to record any validation diagnostics.
 * @param compInst - Component instance metadata from Salsa.
 * @param causality - Resolved component causality (`Input`, `Output`, or `Local`).
 * @param isElemProtected - Whether the component is declared in a `protected` section.
 * @param elemCst - CST node of the component declaration.
 */
export function validateFunctionComponentDeclaration(
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  compInst: ComponentInstanceInfo,
  causality: Causality,
  isElemProtected: boolean,
  elemCst: SyntaxNode | FlattenerCstNode | null | undefined,
): void {
  if (dae.classKind !== "function") return;

  let clauseNode: SyntaxNode | FlattenerCstNode | null | undefined = elemCst;
  while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
    clauseNode = clauseNode.parent;
  }
  const elemNode = clauseNode?.parent?.type === "element" ? clauseNode.parent : clauseNode;
  const diagNode = elemNode ?? clauseNode ?? elemCst;
  const diagRange = {
    startOffset: diagNode?.startIndex ?? diagNode?.startOffset,
    endOffset: diagNode?.endIndex ?? diagNode?.endOffset,
    startPosition: diagNode?.startPosition,
    endPosition: diagNode?.endPosition,
  };

  // 1. Check for invalid prefix inner or outer on formal parameter in function
  const hasInner =
    Boolean(compInst?.isInner) ||
    elemNode?.children?.some((c) => c.text?.trim() === "inner") ||
    clauseNode?.children?.some((c) => c.text?.trim() === "inner");
  const hasOuter =
    Boolean(compInst?.isOuter) ||
    elemNode?.children?.some((c) => c.text?.trim() === "outer") ||
    clauseNode?.children?.some((c) => c.text?.trim() === "outer");

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
            startOffset: clauseNode?.startIndex ?? clauseNode?.startOffset ?? diagRange.startOffset,
            endOffset: clauseNode?.endIndex ?? clauseNode?.endOffset ?? diagRange.endOffset,
            startPosition: clauseNode?.startPosition ?? diagRange.startPosition,
            endPosition: clauseNode?.endPosition ?? diagRange.endPosition,
          },
        });
      }
    }
    return;
  }

  // 3. Public variables that are not input/output must be protected (constants/parameters allowed)
  const hasOldInstOption = Boolean(
    dae.extensionMetadata?.["isOldFrontend"] ||
    flattener.options?.isOldFrontend ||
    getDaeExtMeta(dae)?.hasOldInstOption ||
    getDaeExtMeta(flattener.currentRootDae)?.hasOldInstOption,
  );
  if (
    !hasOldInstOption &&
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
          startOffset: clauseNode?.startIndex ?? clauseNode?.startOffset ?? diagRange.startOffset,
          endOffset: clauseNode?.endIndex ?? clauseNode?.endOffset ?? diagRange.endOffset,
          startPosition: clauseNode?.startPosition ?? diagRange.startPosition,
          endPosition: clauseNode?.endPosition ?? diagRange.endPosition,
        },
      });
    }
  }
}

/**
 * Validates built-in attribute modifications (`start`, `min`, `max`, `nominal`, `unit`, `fixed`, etc.)
 * on primitive/basic type components:
 * 1. Rejects `redeclare` clauses targeting built-in type attributes.
 * 2. Rejects nested sub-attribute modifications (`x(start(min = 0))`) on scalar attributes.
 * 3. Rejects outer overrides of attributes marked `final`.
 * 4. Rejects continuous-time (`VAR`) bindings on parameter-variability attributes (`start`, `min`, `max`, `nominal`).
 * 5. Checks array dimension compatibility on `start` attribute bindings.
 *
 * @param flattener - Active component flattener context.
 * @param dae - Target `DAEBuilder` to record any validation diagnostics.
 * @param compInst - Component instance metadata from Salsa.
 * @param elemId - Symbol ID of the component declaration.
 * @param elemCst - CST node of the component declaration.
 * @param prefix - Hierarchical instance prefix.
 * @param parentMods - Outer modification environment.
 * @param matchingParentArg - Specific outer modification argument targeting this component.
 * @returns `true` if a validation error was emitted (aborting elaboration of this component); `false` otherwise.
 */
export function validateComponentBasicAttributes(
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  compInst: ComponentInstanceInfo,
  elemId: SymbolId,
  elemCst: SyntaxNode | FlattenerCstNode | null | undefined,
  prefix: string,
  _parentMods?: ParentModData | ParentModsLike | null,
  matchingParentArg?: ModArgData | null,
): boolean {
  const isBasicType =
    compInst.typeSpecifier !== null &&
    ["Real", "Integer", "Boolean", "String", "Clock", ".Real", ".Integer", ".Boolean", ".String"].includes(
      compInst.typeSpecifier,
    );
  const typeSpec = compInst.typeSpecifier || "Real";

  const localArgs = compInst.modification?.args ?? [];
  const parentArgs = matchingParentArg?.nestedArgs ?? [];
  const allArgs: ModArgData[] = [...localArgs, ...parentArgs];

  if (isBasicType) {
    // 1. Invalid redeclaration of basic type attribute (BuiltinAttribute7)
    for (const arg of allArgs) {
      if (arg.isRedeclaration || arg.redeclaredKind) {
        const errorRange = modArgDiagRange(arg);
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
          const errorRange = modArgDiagRange(arg);
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code,
            message: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(`${arg.name}.${nested.name}`, typeSpec),
            range: errorRange,
          });
          return true;
        }
      } else if (arg.name && arg.name.includes(".")) {
        const errorRange = modArgDiagRange(arg);
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
        const overridingArg = parentArgs.find((pa) => pa.name === localArg.name);
        if (overridingArg) {
          const notifRange = modArgDiagRange(overridingArg);
          const errorRange = modArgDiagRange(localArg);
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

    // 4. Variability mismatch on start/min/max/nominal attributes (BuiltinAttribute9, ScopeDeclaration2)
    for (const arg of allArgs) {
      if (
        (arg.name === "start" || arg.name === "min" || arg.name === "max" || arg.name === "nominal") &&
        arg.value?.text
      ) {
        const valText = arg.value.text.trim();
        if (isAsciiIdentifier(valText)) {
          const refName = prefix ? `${prefix}.${valText}` : valText;
          const elemParentId = flattener.db.symbol(elemId)?.parentId ?? compInst.parentId;
          const syms = flattener.db.byName(valText);
          const localInParent = syms.find((s) => s.parentId === elemParentId && s.kind === "Component");
          let isContinuous = false;
          let boundRef = valText;
          if (localInParent) {
            const symInst = flattener.db.query<ComponentInstanceInfo | null>("componentInstance", localInParent.id);
            if (!symInst?.variability || symInst.variability === "continuous") {
              isContinuous = true;
              if (prefix) boundRef = refName;
            }
          } else {
            const vi = dae.lookupVariable(refName) >= 0 ? dae.lookupVariable(refName) : dae.lookupVariable(valText);
            if (vi >= 0) {
              isContinuous = dae.getVarVariability(vi) === Variability.Continuous;
              if (dae.lookupVariable(refName) >= 0) boundRef = refName;
            } else {
              const rootSym = syms.find((s) => s.parentId === flattener.currentRootClassId && s.kind === "Component");
              if (rootSym) {
                const symInst = flattener.db.query<ComponentInstanceInfo | null>("componentInstance", rootSym.id);
                if (!symInst?.variability || symInst.variability === "continuous") {
                  isContinuous = true;
                }
              }
            }
          }
          if (isContinuous) {
            if (dae.extensionMetadata?.["isOldFrontend"]) {
              let clauseNode: SyntaxNode | FlattenerCstNode | null | undefined = elemCst;
              while (clauseNode && clauseNode.type !== "component_clause") {
                clauseNode = clauseNode.parent;
              }
              const fullVarName = prefix ? `${prefix}.${compInst.name}` : compInst.name;
              const clauseRange = clauseNode
                ? {
                    startOffset: clauseNode.startIndex ?? clauseNode.startOffset,
                    endOffset: clauseNode.endIndex ?? clauseNode.endOffset,
                    startPosition: clauseNode.startPosition,
                    endPosition: clauseNode.endPosition,
                  }
                : modArgDiagRange(arg);
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
                message: `Variable ${fullVarName}: Component ${arg.name} of variability PARAM has binding ${boundRef} of higher variability VAR.`,
                range: clauseRange,
              });
              return true;
            }
            const errorRange = modArgDiagRange(arg);
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
    const rawDims: (number | ArrayDimRawEntry)[] | null | undefined =
      compInst.arrayDimensions ?? flattener.db.query<ArrayDimRawEntry[] | null>("arrayDimensions", elemId);
    if (rawDims && rawDims.length > 0) {
      const compDims = rawDims.map((d) => (typeof d === "number" ? d : (d?.value ?? d?.size ?? 0)));
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
                  return isAsciiDigitsOnly(str) ? `${str}.0` : str;
                };
                formattedText = formatFloats(valText);
              }
            } else {
              const subParsed = parseIdentSubscriptText(valText);
              if (subParsed) {
                const baseName = subParsed.base;
                const subs = subParsed.subscript.split(",").map((s: string) => s.trim());
                const syms = flattener.db.byName(baseName);
                const targetSym =
                  syms.find((s) => s.parentId === flattener.currentRootClassId || s.parentId === compInst.parentId) ??
                  syms[0];
                if (targetSym) {
                  const targetInst = flattener.db.query<ComponentInstanceInfo | null>(
                    "componentInstance",
                    targetSym.id,
                  );
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
                    const remainingDims: number[] = [];
                    for (let sIdx = 0; sIdx < subs.length; sIdx++) {
                      if (subs[sIdx]!.includes(":")) {
                        let sliceDim = tDims[sIdx]!;
                        const parts = subs[sIdx]!.split(":");
                        if (parts.length === 2) {
                          const startVal = parseInt(parts[0]!.trim(), 10);
                          const endVal = parseInt(parts[1]!.trim(), 10);
                          if (!isNaN(startVal) && !isNaN(endVal)) {
                            sliceDim = endVal - startVal + 1;
                          }
                        }
                        remainingDims.push(sliceDim);
                      }
                    }
                    for (let sIdx = subs.length; sIdx < tDims.length; sIdx++) {
                      remainingDims.push(tDims[sIdx]!);
                    }
                    actualShape = remainingDims;
                  }
                }
              } else if (isAsciiIdentifier(valText)) {
                const syms = flattener.db.byName(valText);
                const targetSym =
                  syms.find((s) => s.parentId === flattener.currentRootClassId || s.parentId === compInst.parentId) ??
                  syms[0];
                if (targetSym) {
                  const targetInst = flattener.db.query<ComponentInstanceInfo | null>(
                    "componentInstance",
                    targetSym.id,
                  );
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
              let clauseNode: SyntaxNode | FlattenerCstNode | null | undefined = elemCst;
              while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
                clauseNode = clauseNode.parent;
              }
              const diagNode = clauseNode ?? elemCst;
              const notifRange = modArgDiagRange(arg);
              const errorRange = {
                startOffset: diagNode?.startIndex ?? diagNode?.startOffset,
                endOffset: diagNode?.endIndex ?? diagNode?.endOffset,
                startPosition: diagNode?.startPosition,
                endPosition: diagNode?.endPosition,
              };
              dae.diagnostics.push({
                severity: "notification",
                code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                message: "From here:",
                range: notifRange,
              });
              const isOldFrontend = Boolean(
                dae.extensionMetadata?.["isOldFrontend"] || flattener.options.isOldFrontend,
              );
              let errorMessage: string;
              let errorCode: number = ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.code;
              if (isOldFrontend && valText.startsWith("{") && valText.endsWith("}")) {
                const outerElems = parseArrayLiteralElements(valText);
                if (compDims.length >= 2) {
                  let mismatchRow: { rowText: string; innerElems: string[] } | null = null;
                  for (const rowText of outerElems) {
                    if (rowText.startsWith("{") && rowText.endsWith("}")) {
                      const innerElems = parseArrayLiteralElements(rowText);
                      if (innerElems.length !== compDims[1]) {
                        mismatchRow = { rowText, innerElems };
                      }
                    }
                  }
                  if (mismatchRow) {
                    const elemType = mismatchRow.innerElems.every((e: string) => isSignedAsciiIntText(e.trim()))
                      ? "Integer"
                      : "Real";
                    errorCode = ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code;
                    errorMessage = `Array dimension mismatch, expression ${mismatchRow.rowText} has type ${elemType}[${mismatchRow.innerElems.length}], expected array dimensions [${compDims[1]}].`;
                  } else {
                    errorMessage = ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                      arg.name,
                      formattedText,
                      compDims.join(", "),
                      actualShape.join(", "),
                    );
                  }
                } else if (compDims.length === 1 && outerElems.length !== compDims[0]) {
                  const elemType = outerElems.every((e: string) => isSignedAsciiIntText(e.trim())) ? "Integer" : "Real";
                  errorCode = ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code;
                  errorMessage = `Array dimension mismatch, expression ${valText} has type ${elemType}[${outerElems.length}], expected array dimensions [${compDims[0]}].`;
                } else {
                  errorMessage = ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                    arg.name,
                    formattedText,
                    compDims.join(", "),
                    actualShape.join(", "),
                  );
                }
              } else {
                errorMessage = ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                  arg.name,
                  formattedText,
                  compDims.join(", "),
                  actualShape.join(", "),
                );
              }
              dae.diagnostics.push({
                severity: "error",
                code: errorCode,
                message: errorMessage,
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
