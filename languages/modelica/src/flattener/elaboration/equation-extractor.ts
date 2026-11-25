// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, EqKind, type QueryDB, type SymbolId } from "@modelscript/runtime";
import { Cst } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";
import type { ModelicaFlattener } from "../class-flattener.js";
import { lowerAlgorithmSection } from "./equations/algorithm-section.js";
import { extractComponentSubEquations, extractShortClassAndExtendsEquations } from "./equations/component-recursion.js";
import { expandConnectorRef, lowerConnectEquation } from "./equations/connect-eq.js";
import { isCstNode } from "./equations/cst-helpers.js";
import { lowerForEquation } from "./equations/for-eq.js";
import { emitFunctionCallEquation, isStaticTrueAssert } from "./equations/function-call-eq.js";
import { lowerIfEquation } from "./equations/if-eq.js";
import { lowerSimpleEquation } from "./equations/simple-eq.js";
import type { BreakContext, EquationCstNode, EquationParentMods, EquationWalkContext } from "./equations/types.js";
import { lowerWhenEquation } from "./equations/when-eq.js";

export { emitFunctionCallEquation, expandConnectorRef, isStaticTrueAssert };

/**
 * Recursively extracts and lowers all equations, connect clauses, `for`/`if`/`when` equation
 * blocks, and `algorithm` / `initial algorithm` sections for class `classId` and its
 * sub-components and `extends` base classes into `dae`.
 *
 * Extraction phases:
 * 1. Flush any deferred whole-array binding equations (`pendingArrayBindings`) for `prefix`.
 * 2. Recurse into composite sub-components (resolving redeclarations, package aliases, and arrays).
 * 3. Collect and cache CST equation/algorithm sections belonging directly to `classId` and lower
 *    each section under the active parent modification and import scope.
 * 4. Recurse into short-class base definitions and `extends` clauses, propagating `break`
 *    modifications (`brokenComponents`, `brokenConnections`) and detecting inheritance cycles.
 *
 * @param flattener - Active `ModelicaFlattener` instance.
 * @param classId - `SymbolId` of the class whose equations are being extracted.
 * @param prefix - Current hierarchical component instance prefix (empty string at root).
 * @param dae - Target `DAEBuilder` arena.
 * @param breakContext - Inherited `break` exclusions for components and `connect()` clauses.
 * @param parentMods - Merged modification environment propagated from enclosing instances/extends.
 * @param visitedClasses - Cycle-detection set of `SymbolId`s along the current recursion chain.
 */
export function extractClassEquations(
  flattener: ModelicaFlattener,
  classId: SymbolId,
  prefix: string,
  dae: DAEBuilder,
  breakContext?: BreakContext,
  parentMods?: EquationParentMods,
  visitedClasses?: Set<SymbolId>,
): void {
  const db: QueryDB = flattener.db;
  const curBreakContext: BreakContext = breakContext ?? {
    brokenComponents: new Set<string>(),
    brokenConnections: new Set<string>(),
  };
  const curVisited = visitedClasses ? new Set(visitedClasses) : new Set<SymbolId>();
  if (curVisited.has(classId)) {
    return;
  }
  curVisited.add(classId);

  // Phase 1: Flush any deferred array variable binding equations queued during component instantiation.
  const classEntry = db.symbol(classId);
  if (flattener.pendingArrayBindings.has(prefix)) {
    const pending = flattener.pendingArrayBindings.get(prefix)!;
    for (const item of pending) {
      dae.addEquation(EqKind.Array, item.lhsExprId, item.rhsExprId);
    }
    flattener.pendingArrayBindings.delete(prefix);
  }

  const selfRawKind = String(classEntry?.metadata?.["classKind"] ?? classEntry?.metadata?.["classPrefixes"] ?? "");
  if (
    flattener.pendingArrayBindings.size === 0 &&
    (selfRawKind === "type" || selfRawKind === "record" || selfRawKind === "package" || selfRawKind === "connector")
  ) {
    return;
  }

  // Phase 2: Recurse into composite sub-components of `classId` to extract their internal equations.
  const children = extractComponentSubEquations(
    flattener,
    db,
    classId,
    prefix,
    dae,
    curBreakContext,
    parentMods,
    curVisited,
    extractClassEquations,
  );

  if (selfRawKind === "type" || selfRawKind === "record" || selfRawKind === "package" || selfRawKind === "connector") {
    return;
  }

  // Phase 3: Collect and cache equation/algorithm CST sections directly belonging to `classId`
  // (stopping at nested `class_definition` boundaries) and walk them in canonical order.
  let cst = db.cstNode(classId) as EquationCstNode | null;
  while (
    cst &&
    cst.type !== "class_definition" &&
    cst.type !== "ClassDefinition" &&
    (cst.type === "element" || cst.type === "element_replaceable" || cst.type === "element_redeclaration")
  ) {
    const childCls = cst.children?.find(
      (c) =>
        c.type === "class_definition" ||
        c.type === "ClassDefinition" ||
        c.type === "element_replaceable" ||
        c.type === "element_redeclaration",
    );
    if (childCls) cst = childCls as EquationCstNode;
    else break;
  }
  if (cst) {
    let eqAlgSections = cst._cachedEqAlgSections;
    if (!eqAlgSections) {
      eqAlgSections = [];
      const collectSections = (n: EquationCstNode | null | undefined) => {
        if (!n) return;
        const nt = n.type;
        if (
          (n !== cst && nt === "class_definition") ||
          nt === "extends_clause" ||
          nt === "inheritance_modification" ||
          nt === "component_clause" ||
          nt === "component_clause1" ||
          nt === "component_declaration" ||
          nt === "annotation" ||
          nt === "Annotation" ||
          nt === "element_list" ||
          nt === "element" ||
          nt === "import_clause" ||
          nt === "external_clause" ||
          nt === "description" ||
          nt === "description_string" ||
          nt === "comment" ||
          nt === "class_prefixes"
        ) {
          return;
        }
        if (
          nt === "equation_section" ||
          nt === "initial_equation_section" ||
          nt === "algorithm_section" ||
          nt === "initial_algorithm_section" ||
          nt === "some_equation" ||
          nt === "simple_equation" ||
          nt === "connect_equation" ||
          nt === "for_equation" ||
          nt === "if_equation" ||
          nt === "when_equation" ||
          nt === "function_call"
        ) {
          eqAlgSections!.push(n);
          return;
        }
        if (nt === "composition") {
          const eqSecs: EquationCstNode[] = [];
          const otherKids: EquationCstNode[] = [];
          for (const kid of (n.children || []) as EquationCstNode[]) {
            if (kid.type === "equation_section") eqSecs.push(kid);
            else otherKids.push(kid);
          }
          for (let i = eqSecs.length - 1; i >= 0; i--) {
            eqAlgSections!.push(eqSecs[i]!);
          }
          for (const o of otherKids) collectSections(o);
          return;
        }
        for (const kid of (n.children || []) as EquationCstNode[]) {
          if (kid.type !== "class_definition") collectSections(kid);
        }
      };
      collectSections(cst);
      cst._cachedEqAlgSections = eqAlgSections;
    }
    if (eqAlgSections.length > 0) {
      const prevParentMods = flattener.currentParentMods;
      const prevClassId = flattener.currentClassId;
      const prevImports = flattener.currentImports;
      flattener.currentParentMods = parentMods ?? null;
      flattener.currentClassId = classId;
      if (typeof flattener.collectClassImports === "function") {
        const classImports = flattener.collectClassImports(classId);
        if (classImports && classImports.size > 0) {
          flattener.currentImports = new Map([...flattener.currentImports, ...classImports]);
        }
      }
      try {
        const walk = (
          node: EquationCstNode | null | undefined,
          substitutions?: Map<string, number | string>,
          isInitial?: boolean,
        ): void => {
          if (!node) return;

          const nt = node.type;
          if (
            (node !== cst && nt === "class_definition") ||
            nt === "extends_clause" ||
            nt === "inheritance_modification" ||
            nt === "component_clause" ||
            nt === "component_clause1" ||
            nt === "component_declaration" ||
            nt === "annotation" ||
            nt === "Annotation" ||
            nt === "element_list" ||
            nt === "element" ||
            nt === "import_clause" ||
            nt === "external_clause" ||
            nt === "description" ||
            nt === "description_string" ||
            nt === "comment" ||
            nt === "class_prefixes"
          ) {
            return;
          }

          if (isCstNode(Cst.ForEquation, node)) {
            lowerForEquation(walkCtx, node, substitutions, isInitial);
            return;
          }

          if (isCstNode(Cst.IfEquation, node) || nt === "if_equation") {
            lowerIfEquation(walkCtx, node, substitutions, isInitial);
            return;
          }

          if (nt === "simple_equation") {
            lowerSimpleEquation(walkCtx, node, substitutions, isInitial);
            return;
          }

          if (nt === "function_call") {
            emitFunctionCallEquation(flattener, node, dae, prefix, substitutions, isInitial, -1);
            return;
          }

          if (nt === "connect_equation") {
            lowerConnectEquation(walkCtx, node, substitutions, isInitial);
            return;
          }

          if (isCstNode(Cst.WhenEquation, node) || nt === "when_equation") {
            lowerWhenEquation(walkCtx, node, substitutions, isInitial);
            return;
          }

          if (nt === "algorithm_section") {
            lowerAlgorithmSection(walkCtx, node, substitutions, isInitial);
            return;
          }

          if (nt === "equation_section") {
            const isInit =
              isInitial ||
              (node.text?.trim()?.startsWith("initial") ?? false) ||
              (node.children || []).some(
                (c) => c.text?.trim() === "initial" || c.type === '"initial"' || c.type === "initial",
              );
            for (const kid of (node.children || []) as EquationCstNode[]) {
              if (
                dae.extensionMetadata?.["isOldFrontend"] &&
                dae.diagnostics.some((d) => d.code === ModelicaErrorCode.EQUATION_TYPE_MISMATCH.code)
              ) {
                break;
              }
              if (dae.diagnostics.some((d) => d.message.includes("Function argument delayTime"))) {
                break;
              }
              walk(kid, substitutions, isInit);
            }
            return;
          }

          if (nt === "composition") {
            const eqSections: EquationCstNode[] = [];
            const otherChildren: EquationCstNode[] = [];
            for (const kid of (node.children || []) as EquationCstNode[]) {
              if (kid.type === "equation_section") {
                eqSections.push(kid);
              } else {
                otherChildren.push(kid);
              }
            }
            for (const eqSec of eqSections.slice().reverse()) {
              walk(eqSec, substitutions, isInitial);
            }
            for (const other of otherChildren) {
              walk(other, substitutions, isInitial);
            }
            return;
          }

          for (const kid of (node.children || []) as EquationCstNode[]) {
            if (kid.type !== "class_definition") {
              walk(kid, substitutions, isInitial);
            }
          }
        };
        const walkCtx: EquationWalkContext = {
          flattener,
          db,
          classId,
          classEntry,
          prefix,
          dae,
          curBreakContext,
          parentMods,
          cst: cst!,
          walk,
        };
        for (const sec of eqAlgSections) {
          walk(sec);
        }
      } finally {
        flattener.currentParentMods = prevParentMods;
        flattener.currentClassId = prevClassId;
        flattener.currentImports = prevImports;
      }
    }
  }

  // Phase 4: Short-class base definitions and `extends` clauses.
  extractShortClassAndExtendsEquations(
    flattener,
    db,
    classId,
    prefix,
    dae,
    curBreakContext,
    parentMods,
    curVisited,
    cst,
    children,
    extractClassEquations,
  );
}
