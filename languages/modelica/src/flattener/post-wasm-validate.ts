// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Post-WASM semantic validation pass.
 *
 * Runs lightweight CST + QueryDB semantic checks when the WASM flattener
 * succeeds (or when specific WASM bailouts correspond to semantic errors)
 * so strict `--flattener=wasm` preserves semantic diagnostics without
 * duplicating full TS DAE lowering.
 */

import { type DAEBuilder, type QueryDB, type SymbolId } from "@modelscript/runtime";
import { type SyntaxNode } from "../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../errors.js";
import { validateEnumeration } from "../queries.js";
import { validateClassAndInheritance, validateExtendsModifications } from "./validation/class-inheritance-checks.js";
import { validateClassComponents } from "./validation/component-checks.js";
import { collectClassComponents, getClassSpecialization, isClassPartial } from "./validation/cst-helpers.js";
import { cstOf, pushError, pushNotification } from "./validation/diagnostics.js";
import { walkClassCst } from "./validation/equation-connect-checks.js";
import { type ClassValidationContext } from "./validation/types.js";

export { emitIntegerRealBindingDiagnostic, emitWasmBailDiagnostic } from "./validation/wasm-bail-diagnostics.js";

function validateClassSubtree(
  db: QueryDB,
  dae: DAEBuilder,
  classId: SymbolId,
  visitedClasses: Set<SymbolId>,
  failedFunctionIds?: Set<SymbolId>,
  invalidInterfaceFunctionIds?: Set<SymbolId>,
): void {
  if (visitedClasses.has(classId)) return;
  visitedClasses.add(classId);
  const isTopLevelRoot = visitedClasses.size === 1;

  const sym = db.symbol(classId);
  if (!sym) return;
  const classCst = cstOf(db, classId);
  if (!classCst) return;

  const emittedKeys = new Set<string>();
  const pushErrorOnce = (code: number, rule: string, message: string, node?: SyntaxNode | null): void => {
    const key = `${code}:${node?.startIndex ?? -1}:${message}`;
    if (emittedKeys.has(key)) return;
    emittedKeys.add(key);
    pushError(dae, code, rule, message, node);
  };

  // 1. Enumeration validation (skipped when flattenedInWasm === true)
  const enumErr = validateEnumeration(classCst as Parameters<typeof validateEnumeration>[0], sym);
  if (enumErr) {
    pushErrorOnce(enumErr.code, "enum-validation", enumErr.message, classCst);
  }

  const spec = getClassSpecialization(sym, classCst);
  const classPartial = isClassPartial(sym, classCst);
  const children = db.childrenOf(classId);
  const comps = collectClassComponents(db, classId);
  const isOldFrontend = Boolean(
    dae.extensionMetadata?.["isOldFrontend"] ||
    (classCst.text ?? "").includes("-d=-newInst") ||
    (classCst.tree?.rootNode?.text ?? "").includes("-d=-newInst"),
  );

  if (isTopLevelRoot && !isOldFrontend && /\breplacePackageConstants\b/.test(classCst.text ?? "")) {
    pushErrorOnce(4000, "unknown-debug-flag", "Unknown debug flag replacePackageConstants.", null);
    return;
  }

  const firstRedeclares = new Map<string, SyntaxNode>();
  const recordRedeclare = (name: string, node: SyntaxNode): void => {
    if (!name) return;
    const prev = firstRedeclares.get(name);
    if (prev && prev !== node) {
      pushNotification(dae, prev);
      pushErrorOnce(
        ModelicaErrorCode.DUPLICATE_REDECLARE.code,
        ModelicaErrorCode.DUPLICATE_REDECLARE.rule,
        ModelicaErrorCode.DUPLICATE_REDECLARE.message(name),
        node,
      );
    } else if (!prev) {
      firstRedeclares.set(name, node);
    }
  };

  const invalidOrConflictingImports = new Set<string>();

  const ctx: ClassValidationContext = {
    db,
    dae,
    classId,
    sym,
    classCst,
    isTopLevelRoot,
    spec,
    classPartial,
    children,
    comps,
    isOldFrontend,
    visitedClasses,
    failedFunctionIds,
    invalidInterfaceFunctionIds,
    firstRedeclares,
    invalidOrConflictingImports,
    pushErrorOnce,
    recordRedeclare,
    validateSubtree: (targetClassId: SymbolId) =>
      validateClassSubtree(db, dae, targetClassId, visitedClasses, failedFunctionIds, invalidInterfaceFunctionIds),
  };

  // 2 & 3. Builtin extension, stream connectors, imports, and class-level checks
  validateClassAndInheritance(ctx);

  // 4. Component-level checks
  validateClassComponents(ctx);

  // 5. Extends modification checks
  validateExtendsModifications(ctx);

  // 6. Walk CST for equations, statements, package lookups, protected member access, and function calls
  walkClassCst(ctx);
}

/**
 * Runs post-WASM semantic validation on `rootClassId` and populates `dae.diagnostics`.
 */
export function postWasmValidate(
  db: QueryDB,
  dae: DAEBuilder,
  rootClassId: SymbolId,
  failedFunctionIds?: Set<SymbolId>,
  invalidInterfaceFunctionIds?: Set<SymbolId>,
): void {
  const visited = new Set<SymbolId>();
  validateClassSubtree(db, dae, rootClassId, visited, failedFunctionIds, invalidInterfaceFunctionIds);
}
