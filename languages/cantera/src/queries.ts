// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cantera — Salsa Incremental Query Hooks & Semantic Linter Descriptors.
 *
 * Implements fine-grained Salsa query hooks (sub-100µs keystroke caching):
 * - canteraDocument: Parsed mechanism AST memoized per SymbolId
 * - lint__canteraStoichiometry: Validates element and charge balance for all reactions
 * - lint__canteraNasa7Ranges: NASA-7 polynomial temperature bounds and midpoint continuity
 * - lint__canteraDuplicateReactions: Detects undeclared duplicate reaction declarations
 * - lint__canteraAll: Aggregated diagnostic suite
 */

import type { LintResult } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { CanteraErrorCode } from "./errors.js";
import { lintCantera } from "./lints/cantera-linter.js";
import { parseCantera } from "./parser/cantera-parser.js";
import type { CanteraMechanism } from "./types.js";

/**
 * Salsa query retrieving or parsing the CanteraMechanism from a symbol entry.
 */
export function canteraDocument(_db: QueryDB, entry: SymbolEntry): CanteraMechanism | null {
  if (!entry) return null;

  if (entry.metadata?.["doc"]) {
    const metaDoc: any = entry.metadata["doc"];
    return metaDoc.mechanism ? (metaDoc.mechanism as CanteraMechanism) : (metaDoc as CanteraMechanism);
  }

  const raw = (entry.metadata?.["rawSource"] as string) || (entry.metadata?.["text"] as string);
  if (raw) {
    const doc = parseCantera(raw);
    return doc.mechanism;
  }

  return null;
}

/**
 * Salsa incremental lint hook: validates element stoichiometry conservation in reactions.
 */
export function lint__canteraStoichiometry(db: QueryDB, entry: SymbolEntry): LintResult[] | null {
  const doc = db.query<CanteraMechanism | null>("canteraDocument", entry.id);
  if (!doc) return null;

  const results: LintResult[] = [];

  for (const rxn of doc.reactions) {
    const elemReactants: Record<string, number> = {};
    const elemProducts: Record<string, number> = {};

    for (const r of rxn.reactants) {
      const sp = doc.species.get(r.species);
      if (!sp) continue;
      for (const [elem, count] of Object.entries(sp.composition)) {
        elemReactants[elem] = (elemReactants[elem] || 0) + count * r.stoichiometry;
      }
    }

    for (const p of rxn.products) {
      const sp = doc.species.get(p.species);
      if (!sp) continue;
      for (const [elem, count] of Object.entries(sp.composition)) {
        elemProducts[elem] = (elemProducts[elem] || 0) + count * p.stoichiometry;
      }
    }

    const allElems = new Set([...Object.keys(elemReactants), ...Object.keys(elemProducts)]);
    for (const elem of allElems) {
      const rc = elemReactants[elem] || 0;
      const pc = elemProducts[elem] || 0;
      if (Math.abs(rc - pc) > 1e-6) {
        results.push({
          code: CanteraErrorCode.ELEMENT_BALANCE_VIOLATION.code,
          message: CanteraErrorCode.ELEMENT_BALANCE_VIOLATION.message(rxn.equation, elem, rc, pc),
          severity: CanteraErrorCode.ELEMENT_BALANCE_VIOLATION.severity,
          startOffset: rxn.range?.startOffset,
          endOffset: rxn.range?.endOffset,
        });
      }
    }
  }

  return results.length > 0 ? results : null;
}

/**
 * Salsa incremental lint hook: checks NASA-7 temperature bounds (Tmin < Tmid < Tmax).
 */
export function lint__canteraNasa7Ranges(db: QueryDB, entry: SymbolEntry): LintResult[] | null {
  const doc = db.query<CanteraMechanism | null>("canteraDocument", entry.id);
  if (!doc) return null;

  const results: LintResult[] = [];

  for (const sp of doc.species.values()) {
    if (!sp.thermo) continue;
    const { Tmin, Tmid, Tmax, range } = sp.thermo;
    if (Tmin >= Tmid || Tmid >= Tmax || Tmin <= 0) {
      results.push({
        code: CanteraErrorCode.INVALID_NASA7_TEMPERATURE_BOUNDS.code,
        message: CanteraErrorCode.INVALID_NASA7_TEMPERATURE_BOUNDS.message(sp.name, Tmin, Tmid, Tmax),
        severity: CanteraErrorCode.INVALID_NASA7_TEMPERATURE_BOUNDS.severity,
        startOffset: range?.startOffset,
        endOffset: range?.endOffset,
      });
    }
  }

  return results.length > 0 ? results : null;
}

/**
 * Salsa incremental lint hook: detects duplicate reaction declarations lacking `duplicate: true`.
 */
export function lint__canteraDuplicateReactions(db: QueryDB, entry: SymbolEntry): LintResult[] | null {
  const doc = db.query<CanteraMechanism | null>("canteraDocument", entry.id);
  if (!doc) return null;

  const results: LintResult[] = [];
  const seenEqs = new Map<string, number>();

  for (const rxn of doc.reactions) {
    if (rxn.duplicate) continue;
    const count = (seenEqs.get(rxn.equation) || 0) + 1;
    seenEqs.set(rxn.equation, count);
    if (count > 1) {
      results.push({
        code: CanteraErrorCode.DUPLICATE_REACTION_DECLARATION.code,
        message: CanteraErrorCode.DUPLICATE_REACTION_DECLARATION.message(rxn.equation),
        severity: CanteraErrorCode.DUPLICATE_REACTION_DECLARATION.severity,
        startOffset: rxn.range?.startOffset,
        endOffset: rxn.range?.endOffset,
      });
    }
  }

  return results.length > 0 ? results : null;
}

/**
 * Salsa incremental lint hook: aggregates all Cantera diagnostics.
 */
export function lint__canteraAll(db: QueryDB, entry: SymbolEntry): LintResult[] | null {
  const doc = db.query<CanteraMechanism | null>("canteraDocument", entry.id);
  if (!doc) return null;

  const items = lintCantera({ format: "yaml", mechanism: doc });
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
 * Query hooks dispatch table registered with WasmQueryEngine for rule `cantera_mechanism`.
 */
export const canteraQueryHooks: Record<string, Record<string, any>> = {
  cantera_mechanism: {
    canteraDocument,
    lint__canteraStoichiometry,
    lint__canteraNasa7Ranges,
    lint__canteraDuplicateReactions,
    lint__canteraAll,
  },
};
