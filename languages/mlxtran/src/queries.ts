// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mlxtran — Salsa Incremental Query Hooks & Semantic Linter Descriptors.
 *
 * Implements fine-grained Salsa query hooks (sub-5ms keystroke caching):
 * - mlxtranDocument: Parsed AST memoized per SymbolId
 * - lint__mlxtranLongitudinal: Header validation
 * - lint__mlxtranParameterBounds: Non-negative physiological bound checking
 * - lint__mlxtranDuplicateEquations: Structural uniqueness of equations
 * - lint__mlxtranAll: Aggregated diagnostic suite
 */

import type { LintResult } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { MlxtranErrorCode } from "./errors.js";
import { lintMlxtran } from "./lints/mlxtran-linter.js";
import { parseMlxtran } from "./parser/mlxtran-parser.js";
import type { MlxtranDocument } from "./types.js";

/**
 * Salsa query retrieving or parsing the MlxtranDocument from a model symbol.
 */
export function mlxtranDocument(_db: QueryDB, entry: SymbolEntry): MlxtranDocument | null {
  if (!entry) return null;

  if (entry.metadata?.["doc"]) {
    return entry.metadata["doc"] as MlxtranDocument;
  }

  const raw = (entry.metadata?.["rawSource"] as string) || (entry.metadata?.["text"] as string);
  if (raw) {
    return parseMlxtran(raw);
  }

  return null;
}

/**
 * Salsa incremental lint hook: validates presence of [LONGITUDINAL] section.
 */
export function lint__mlxtranLongitudinal(db: QueryDB, entry: SymbolEntry): LintResult | null {
  const doc = db.query<MlxtranDocument | null>("mlxtranDocument", entry.id);
  if (!doc) return null;

  if (!/\[LONGITUDINAL\]/i.test(doc.raw)) {
    return {
      code: MlxtranErrorCode.MISSING_LONGITUDINAL_BLOCK.code,
      message: MlxtranErrorCode.MISSING_LONGITUDINAL_BLOCK.message(),
      severity: MlxtranErrorCode.MISSING_LONGITUDINAL_BLOCK.severity,
      startOffset: doc.model.range?.startOffset,
      endOffset: doc.model.range?.endOffset,
    };
  }
  return null;
}

/**
 * Salsa incremental lint hook: checks physiological parameter bounds and initial conditions.
 */
export function lint__mlxtranParameterBounds(db: QueryDB, entry: SymbolEntry): LintResult[] | null {
  const doc = db.query<MlxtranDocument | null>("mlxtranDocument", entry.id);
  if (!doc) return null;

  const results: LintResult[] = [];
  for (const inp of doc.model.inputs) {
    if (inp.min !== undefined && inp.min < 0) {
      results.push({
        code: MlxtranErrorCode.NEGATIVE_PARAMETER_BOUND.code,
        message: MlxtranErrorCode.NEGATIVE_PARAMETER_BOUND.message(inp.name, inp.min),
        severity: MlxtranErrorCode.NEGATIVE_PARAMETER_BOUND.severity,
        startOffset: inp.range?.startOffset,
        endOffset: inp.range?.endOffset,
      });
    }
    if (inp.init !== undefined && inp.init <= 0) {
      results.push({
        code: MlxtranErrorCode.NEGATIVE_PARAMETER_BOUND.code,
        message: MlxtranErrorCode.NEGATIVE_PARAMETER_BOUND.message(inp.name, inp.init),
        severity: MlxtranErrorCode.NEGATIVE_PARAMETER_BOUND.severity,
        startOffset: inp.range?.startOffset,
        endOffset: inp.range?.endOffset,
      });
    }
  }

  return results.length > 0 ? results : null;
}

/**
 * Salsa incremental lint hook: detects duplicate equation definitions.
 */
export function lint__mlxtranDuplicateEquations(db: QueryDB, entry: SymbolEntry): LintResult[] | null {
  const doc = db.query<MlxtranDocument | null>("mlxtranDocument", entry.id);
  if (!doc) return null;

  const results: LintResult[] = [];
  const seenLhs = new Set<string>();

  for (const eq of doc.model.equations) {
    if (seenLhs.has(eq.lhs)) {
      results.push({
        code: MlxtranErrorCode.DUPLICATE_EQUATION_DEFINITION.code,
        message: MlxtranErrorCode.DUPLICATE_EQUATION_DEFINITION.message(eq.lhs),
        severity: MlxtranErrorCode.DUPLICATE_EQUATION_DEFINITION.severity,
        startOffset: eq.range?.startOffset,
        endOffset: eq.range?.endOffset,
      });
    }
    seenLhs.add(eq.lhs);
  }

  return results.length > 0 ? results : null;
}

/**
 * Salsa incremental lint hook: runs all MLXTRAN linter checks.
 */
export function lint__mlxtranAll(db: QueryDB, entry: SymbolEntry): LintResult[] | null {
  const doc = db.query<MlxtranDocument | null>("mlxtranDocument", entry.id);
  if (!doc) return null;

  const items = lintMlxtran(doc);
  if (items.length === 0) return null;

  return items.map((item) => ({
    code: item.code,
    message: item.message,
    severity: item.severity,
    startOffset: item.range?.startOffset,
    endOffset: item.range?.endOffset,
  }));
}

/**
 * Query hooks dispatch table registered with WasmQueryEngine for rule `mlxtran_model`.
 */
export const mlxtranQueryHooks: Record<string, Record<string, any>> = {
  mlxtran_model: {
    mlxtranDocument,
    lint__mlxtranLongitudinal,
    lint__mlxtranParameterBounds,
    lint__mlxtranDuplicateEquations,
    lint__mlxtranAll,
  },
};
