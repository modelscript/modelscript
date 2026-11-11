// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmtran — Salsa Incremental Query Hooks & Semantic Linter Descriptors.
 *
 * Implements fine-grained Salsa query hooks (sub-5ms keystroke caching):
 * - nmtranDocument: Parsed AST memoized per SymbolId
 * - lint__nmtranProblemBlock: Mandatory $PROBLEM record (M9401)
 * - lint__nmtranThetaBoundValidity: Parameter lower/init/upper bounds (M9402)
 * - lint__nmtranGeneralAdvanDes: General ODE $DES block requirement (M9403)
 * - lint__nmtranAll: Aggregated diagnostic suite
 */

import type { LintResult } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { NmtranErrorCode } from "./errors.js";
import { lintNmtran } from "./lints/nmtran-linter.js";
import { parseNmtran } from "./parser/nmtran-parser.js";
import type { NmtranDocument } from "./types.js";

const GENERAL_ODE_ADVANS = new Set(["ADVAN6", "ADVAN8", "ADVAN9", "ADVAN13", "ADVAN14", "ADVAN15"]);

/**
 * Salsa query retrieving or parsing the NmtranDocument from a control stream symbol.
 */
export function nmtranDocument(_db: QueryDB, entry: SymbolEntry): NmtranDocument | null {
  if (!entry) return null;

  if (entry.metadata?.["doc"]) {
    return entry.metadata["doc"] as NmtranDocument;
  }

  const raw = (entry.metadata?.["rawSource"] as string) || (entry.metadata?.["text"] as string);
  if (raw) {
    return parseNmtran(raw, entry.name);
  }

  return null;
}

/**
 * Salsa incremental lint hook: validates presence of $PROBLEM block.
 */
export function lint__nmtranProblemBlock(db: QueryDB, entry: SymbolEntry): LintResult | null {
  const doc = db.query<NmtranDocument | null>("nmtranDocument", entry.id);
  if (!doc) return null;

  if (!doc.controlStream.problem) {
    return {
      code: NmtranErrorCode.MISSING_PROBLEM_RECORD.code,
      message: NmtranErrorCode.MISSING_PROBLEM_RECORD.message(),
      severity: NmtranErrorCode.MISSING_PROBLEM_RECORD.severity,
      startOffset: doc.controlStream.range?.startOffset,
      endOffset: doc.controlStream.range?.endOffset,
    };
  }
  return null;
}

/**
 * Salsa incremental lint hook: validates THETA parameter bounds (lower <= init <= upper).
 */
export function lint__nmtranThetaBoundValidity(db: QueryDB, entry: SymbolEntry): LintResult[] | null {
  const doc = db.query<NmtranDocument | null>("nmtranDocument", entry.id);
  if (!doc) return null;

  const results: LintResult[] = [];
  for (const th of doc.controlStream.thetas) {
    const hasLowerViolation = th.lower !== undefined && th.init < th.lower;
    const hasUpperViolation = th.upper !== undefined && th.init > th.upper;
    const hasBoundsInversion = th.lower !== undefined && th.upper !== undefined && th.lower > th.upper;

    if (hasLowerViolation || hasUpperViolation || hasBoundsInversion) {
      results.push({
        code: NmtranErrorCode.THETA_BOUNDS_VIOLATION.code,
        message: NmtranErrorCode.THETA_BOUNDS_VIOLATION.message(
          th.index,
          th.lower ?? -Infinity,
          th.init,
          th.upper ?? Infinity,
        ),
        severity: NmtranErrorCode.THETA_BOUNDS_VIOLATION.severity,
        startOffset: th.range?.startOffset,
        endOffset: th.range?.endOffset,
      });
    }
  }

  return results.length > 0 ? results : null;
}

/**
 * Salsa incremental lint hook: validates that general ODE ADVANS have a $DES block.
 */
export function lint__nmtranGeneralAdvanDes(db: QueryDB, entry: SymbolEntry): LintResult | null {
  const doc = db.query<NmtranDocument | null>("nmtranDocument", entry.id);
  if (!doc) return null;

  const advan = (doc.controlStream.subroutines?.advan || "").toUpperCase();
  if (GENERAL_ODE_ADVANS.has(advan) && !doc.controlStream.hasDesBlock) {
    return {
      code: NmtranErrorCode.MISSING_DES_BLOCK_FOR_GENERAL_ADVAN.code,
      message: NmtranErrorCode.MISSING_DES_BLOCK_FOR_GENERAL_ADVAN.message(advan),
      severity: NmtranErrorCode.MISSING_DES_BLOCK_FOR_GENERAL_ADVAN.severity,
      startOffset: doc.controlStream.range?.startOffset,
      endOffset: doc.controlStream.range?.endOffset,
    };
  }
  return null;
}

/**
 * Salsa incremental lint hook: runs all NMTRAN linter checks.
 */
export function lint__nmtranAll(db: QueryDB, entry: SymbolEntry): LintResult[] | null {
  const doc = db.query<NmtranDocument | null>("nmtranDocument", entry.id);
  if (!doc) return null;

  const items = lintNmtran(doc);
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
 * Query hooks dispatch table registered with WasmQueryEngine for rule `nmtran_model`.
 */
export const nmtranQueryHooks: Record<string, Record<string, any>> = {
  nmtran_model: {
    nmtranDocument,
    lint__nmtranProblemBlock,
    lint__nmtranThetaBoundValidity,
    lint__nmtranGeneralAdvanDes,
    lint__nmtranAll,
  },
};
