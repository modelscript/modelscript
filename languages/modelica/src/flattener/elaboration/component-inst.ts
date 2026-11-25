// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, Variability, VarType, type SymbolId } from "@modelscript/runtime";
import { type SyntaxNode } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";
import { getElementDiagRange } from "../support/range-utils.js";
import { type ParentModsLike } from "../types.js";
import { elaborateCompositeClass } from "./components/composite-inst.js";
import { runFastPathAndResolveComponentType } from "./components/fast-path-and-prep.js";
import { evaluateInnerOuterAndCondition, runPrePassAndOuterChecks } from "./components/prepass-and-conditional.js";
import { elaboratePrimitiveAndArray } from "./components/primitive-emission.js";
import {
  asExtDae,
  getCstNode,
  getExtState,
  modArgDiagRange,
  type ComponentFlattener,
  type ParentModData,
} from "./components/types.js";
import { validateComponentBasicAttributes } from "./components/validation.js";

export {
  evaluateCSTToNumber,
  extractDescription,
  findBindingExprFromCst,
  isComponentHidden,
} from "./components/cst-helpers.js";
export {
  classFindMember,
  collectExtendsMods,
  collectInheritedTypeModifiers,
  collectProtectedNames,
  isClassType,
  resolveExtendsBase,
} from "./components/modifications.js";
export {
  checkTypeAliasSpecialization,
  resolveInnerOuterClass,
  resolveRedeclarationType,
} from "./components/redeclare-and-alias.js";
export type { ComponentFlattener } from "./components/types.js";
export {
  validateClassModifiers,
  validateComponentBasicAttributes,
  validateFunctionComponentDeclaration,
} from "./components/validation.js";
export { getOrCreateWasmEnv } from "./components/wasm-env.js";

/**
 * Instantiates a list of component elements belonging to a Modelica class into the target
 * `DAEBuilder` arena under the given hierarchical `prefix`.
 *
 * Execution proceeds in six sequential phases:
 * 1. **Pre-pass metadata & `inner` registration** — populates `compInstMap`, checks duplicate
 *    names, registers `inner` components, pre-deduces array shapes, and initializes the
 *    per-scope WASM modification environment.
 * 2. **`inner`/`outer` binding & conditional pruning** — resolves `outer` references against
 *    enclosing `inner` instances, auto-instantiates implicit top-level `inner` components, and
 *    evaluates conditional `if <cond>` attributes to prune disabled components.
 * 3. **Fast-path scalar instantiation & type preparation** — directly emits unmodified scalar
 *    primitives (`Real`, `Integer`, `Boolean`, `String`) without full class/modifier overhead,
 *    then resolves redeclarations, class targets, and `final` override rules.
 * 4. **Composite class elaboration** — merges inherited/parent/redeclaration modifiers and
 *    recursively calls `instantiateElements` for scalar or multi-dimensional composite arrays.
 * 5. **Primitive, `type` alias & enumeration resolution** — walks short `type` alias chains,
 *    resolves variability/causality/enum literals, evaluates bindings, and lowers attributes.
 * 6. **Scalarized DAE variable emission** — expands multi-dimensional primitive arrays into
 *    1-based cartesian elements (`arr[i,j]`) or emits scalar DAE variables with modifiers.
 *
 * @param flattener - Active component flattener context.
 * @param elements - Component `SymbolId`s to instantiate in declaration order.
 * @param prefix - Dotted hierarchical prefix of the enclosing instance (empty at top level).
 * @param dae - Target `DAEBuilder` arena.
 * @param parentMods - Optional parent modification bundle propagated from the enclosing instance.
 */
export function instantiateElements(
  flattener: ComponentFlattener,
  elements: SymbolId[],
  prefix: string,
  dae: DAEBuilder,
  parentMods?: ParentModData | null,
): void {
  const prevParentMods = flattener.currentParentMods;
  flattener.currentParentMods = parentMods as ParentModsLike | null | undefined;
  const state = getExtState(dae, flattener);
  const extDae = asExtDae(dae);
  if (parentMods?.args && Array.isArray(parentMods.args)) {
    const pendingVals: Map<string, number | boolean> = (extDae.pendingModValues ??= new Map());
    const pendingExprs: Map<string, string> = (extDae.pendingModExprs ??= new Map());
    for (const arg of parentMods.args) {
      if (!arg || arg.isBreak || !arg.name) continue;
      const valObj = arg.value ?? arg.bindingExpression;
      if (!valObj) continue;
      const fullKey = prefix ? `${prefix}.${arg.name}` : arg.name;
      if (valObj.kind === "literal" && (typeof valObj.value === "number" || typeof valObj.value === "boolean")) {
        pendingVals.set(fullKey, valObj.value);
        pendingExprs.delete(fullKey);
      } else if (typeof valObj.text === "string") {
        const t = valObj.text.trim();
        if (t === "true" || t === "false") {
          pendingVals.set(fullKey, t === "true");
          pendingExprs.delete(fullKey);
        } else if (t !== "" && !isNaN(Number(t))) {
          pendingVals.set(fullKey, Number(t));
          pendingExprs.delete(fullKey);
        } else if (t !== "") {
          pendingExprs.set(fullKey, t);
        }
      }
    }
  }
  try {
    // Phase 1: Pre-Pass Metadata Lookup, `inner` Registration, Shape Deduction & Outer Checks
    const prePass = runPrePassAndOuterChecks(flattener, elements, prefix, dae, state, parentMods);
    if (prePass.aborted) {
      return;
    }
    const {
      elements: activeElements,
      compInstMap,
      basePrefix,
      wasmEnv,
      wasmFlattener,
      prevCompClauseRange,
      prevClassId,
    } = prePass;

    try {
      for (const elemId of activeElements) {
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
        const elemCst = getCstNode(flattener.db, elemId);

        if (dae.classKind === "function" && (compInst.isOuter || compInst.isInner)) {
          let clauseNode: SyntaxNode | null = elemCst;
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
          !dae.extensionMetadata?.["isOldFrontend"] &&
          !flattener.options?.isOldFrontend &&
          !compInst.isProtected &&
          compInst.causality !== "input" &&
          compInst.causality !== "output" &&
          compInst.variability !== "constant" &&
          compInst.variability !== "parameter"
        ) {
          let clauseNode: SyntaxNode | null = elemCst;
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
          .find((a) => !a.isBreak && a.name === compInst.name);

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
        let pNode: SyntaxNode | null = elemCst;
        while (pNode && pNode.type !== "class_definition" && !isLocalRedecl) {
          if (pNode.type === "element_redeclaration" || pNode.type === "ElementRedeclaration") isLocalRedecl = true;
          if (pNode.children?.some((c) => c.type === "redeclare" || c.text === "redeclare")) isLocalRedecl = true;
          pNode = pNode.parent;
        }
        if (isLocalRedecl) {
          const matchingRedecl = parentMods?.args?.find(
            (a) => !a.isBreak && a.name === compInst.name && a.isRedeclaration,
          );
          if (matchingRedecl) {
            let declNode: SyntaxNode | null = elemCst;
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
              range: modArgDiagRange(matchingRedecl),
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

        // Phase 2: `inner`/`outer` Binding & Conditional (`if <cond>`) Pruning
        const phase2 = evaluateInnerOuterAndCondition(
          flattener,
          activeElements,
          elemId,
          compInst,
          fullCompName,
          elemCst,
          prefix,
          dae,
          state,
          parentMods,
          instantiateElements,
        );
        if (phase2.action === "return") return;
        if (phase2.action === "continue") continue;
        const { isStateOutput } = phase2;

        // Phase 3: Fast-Path Scalar Instantiation & Type/Redeclare/Final Preparation
        const phase3 = runFastPathAndResolveComponentType(
          flattener,
          elemId,
          compInst,
          elemCst,
          prefix,
          dae,
          extDae,
          state,
          parentMods,
          matchingParentArg,
          isStateOutput,
        );
        if (phase3.action === "return") return;
        if (phase3.action === "break") break;
        if (phase3.action !== "proceed") continue;
        const { ctx } = phase3;

        // Phase 4: Recursive Composite Class Elaboration & Modifier Merging
        if (ctx.isUserClass) {
          const phase4Action = elaborateCompositeClass(
            flattener,
            elemId,
            compInst,
            fullCompName,
            elemCst,
            prefix,
            dae,
            state,
            parentMods,
            wasmEnv,
            matchingParentArg,
            ctx,
            instantiateElements,
          );
          if (phase4Action === "return") return;
          if (phase4Action === "break") break;
          continue;
        }

        // Phase 5 & Phase 6: Primitive, `type` Alias, Enumeration & Array Emission
        const phase5Action = elaboratePrimitiveAndArray(
          flattener,
          activeElements,
          elemId,
          compInst,
          fullCompName,
          elemCst,
          prefix,
          basePrefix,
          dae,
          extDae,
          state,
          parentMods,
          matchingParentArg,
          isStateOutput,
          ctx,
        );
        if (phase5Action === "return") return;
      }
      if (!dae.extensionMetadata?.["isOldFrontend"] && dae.classKind !== "function" && state.pendingFinalParamNames) {
        for (const c of state.pendingFinalParamNames) {
          const vi = dae.lookupVariable(c);
          if (
            vi >= 0 &&
            dae.getVarVariability(vi) === Variability.Parameter &&
            (dae.getVarType(vi) === VarType.Integer || dae.getVarType(vi) === VarType.Boolean)
          ) {
            dae.setVarFinal(vi, true);
          }
        }
      }
    } finally {
      state.currentCompClauseRange = prevCompClauseRange;
      flattener.currentClassId = prevClassId;
      if (wasmFlattener && dae.exports?.flattener_scopePop && wasmEnv) {
        dae.exports.flattener_scopePop(wasmFlattener);
      }
    }
  } finally {
    flattener.currentParentMods = prevParentMods;
  }
}
