// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/smiles — Salsa Incremental Query Hooks & Semantic Linter Descriptors.
 *
 * Implements fine-grained Salsa query hooks (sub-100µs keystroke caching):
 * - smilesDocument: Parsed molecular graph AST memoized per SymbolId
 * - lint__smilesValence: Atom valence limits (e.g. 5-valent neutral carbon)
 * - lint__smilesAromaticity: Unclosed rings, branch parentheses, and ring bond orders
 * - lint__smilesAll: Aggregated diagnostic suite
 */

import type { LintResult } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { SmilesErrorCode } from "./errors.js";
import { lintSmiles } from "./lints/smiles-linter.js";
import { parseSmilesDocument, PERIODIC_TABLE } from "./parser/smiles-parser.js";
import type { SmilesDocument } from "./types.js";

const MAX_VALENCE_MAP = new Map<string, number>(PERIODIC_TABLE.map((e) => [e.symbol, e.maxValence]));

/**
 * Salsa query retrieving or parsing the SmilesDocument from a symbol entry.
 */
export function smilesDocument(_db: QueryDB, entry: SymbolEntry): SmilesDocument | null {
  if (!entry) return null;

  if (entry.metadata?.["doc"]) {
    return entry.metadata["doc"] as SmilesDocument;
  }

  const raw = (entry.metadata?.["rawSource"] as string) || (entry.metadata?.["text"] as string);
  if (raw) {
    return parseSmilesDocument(raw);
  }

  return null;
}

/**
 * Salsa incremental lint hook: validates atom valence limits across all molecules in document.
 */
export function lint__smilesValence(db: QueryDB, entry: SymbolEntry): LintResult[] | null {
  const doc = db.query<SmilesDocument | null>("smilesDocument", entry.id);
  if (!doc) return null;

  const results: LintResult[] = [];

  for (const mol of doc.molecules) {
    for (const atom of mol.atoms) {
      const maxValence = MAX_VALENCE_MAP.get(atom.element);
      if (maxValence === undefined) continue;

      let explicitBondSum = 0;
      for (const b of mol.bonds) {
        if (b.source === atom.index || b.target === atom.index) {
          explicitBondSum += b.order;
        }
      }
      const totalValence = explicitBondSum + (atom.explicitHydrogens ?? 0);

      // Charge adjustments for neutral valence bounds
      const allowedMax = maxValence + Math.abs(atom.formalCharge ?? 0);
      if (totalValence > allowedMax) {
        results.push({
          code: SmilesErrorCode.VALENCE_EXCEEDED.code,
          message: SmilesErrorCode.VALENCE_EXCEEDED.message(
            atom.element,
            atom.index,
            mol.name || mol.id,
            totalValence,
            allowedMax,
          ),
          severity: SmilesErrorCode.VALENCE_EXCEEDED.severity,
          startOffset: atom.range ? atom.range.startOffset : mol.range?.startOffset,
          endOffset: atom.range ? atom.range.endOffset : mol.range?.endOffset,
        });
      }
    }
  }

  return results.length > 0 ? results : null;
}

/**
 * Salsa incremental lint hook: validates unclosed rings, branch parentheses, and ring bond consistency.
 */
export function lint__smilesAromaticity(db: QueryDB, entry: SymbolEntry): LintResult[] | null {
  const doc = db.query<SmilesDocument | null>("smilesDocument", entry.id);
  if (!doc) return null;

  const results: LintResult[] = [];

  for (const mol of doc.molecules) {
    if (mol.unclosedRings && mol.unclosedRings.length > 0) {
      for (const ur of mol.unclosedRings) {
        results.push({
          code: SmilesErrorCode.UNCLOSED_RING_DIGIT.code,
          message: SmilesErrorCode.UNCLOSED_RING_DIGIT.message(ur.ringId, mol.name || mol.id),
          severity: SmilesErrorCode.UNCLOSED_RING_DIGIT.severity,
          startOffset: mol.range?.startOffset,
          endOffset: mol.range?.endOffset,
        });
      }
    }

    if (mol.unbalancedParentheses && mol.unbalancedParentheses.length > 0) {
      for (const _up of mol.unbalancedParentheses) {
        results.push({
          code: SmilesErrorCode.UNBALANCED_BRANCH_PARENTHESIS.code,
          message: SmilesErrorCode.UNBALANCED_BRANCH_PARENTHESIS.message(mol.name || mol.id),
          severity: SmilesErrorCode.UNBALANCED_BRANCH_PARENTHESIS.severity,
          startOffset: mol.range?.startOffset,
          endOffset: mol.range?.endOffset,
        });
      }
    }

    if (mol.conflictingRingBonds && mol.conflictingRingBonds.length > 0) {
      for (const cr of mol.conflictingRingBonds) {
        results.push({
          code: SmilesErrorCode.CONFLICTING_RING_BOND_ORDER.code,
          message: SmilesErrorCode.CONFLICTING_RING_BOND_ORDER.message(cr.ringId, mol.name || mol.id),
          severity: SmilesErrorCode.CONFLICTING_RING_BOND_ORDER.severity,
          startOffset: mol.range?.startOffset,
          endOffset: mol.range?.endOffset,
        });
      }
    }
  }

  return results.length > 0 ? results : null;
}

/**
 * Salsa incremental lint hook: aggregates all SMILES diagnostics.
 */
export function lint__smilesAll(db: QueryDB, entry: SymbolEntry): LintResult[] | null {
  const doc = db.query<SmilesDocument | null>("smilesDocument", entry.id);
  if (!doc) return null;

  const items = lintSmiles(doc);
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
 * Query hooks dispatch table registered with WasmQueryEngine for rule `smiles_molecule`.
 */
export const smilesQueryHooks: Record<string, Record<string, any>> = {
  smiles_molecule: {
    smilesDocument,
    lint__smilesValence,
    lint__smilesAromaticity,
    lint__smilesAll,
  },
};
