// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmodl — Salsa Incremental Query Hooks & Semantic Linter Descriptors.
 *
 * Implements fine-grained Salsa query hooks (sub-5ms keystroke caching):
 * - nmodlDocument: Parsed AST memoized per SymbolId
 * - lint__nmodlNeuronBlock: Mandatory NEURON interface block
 * - lint__nmodlSuffixDeclaration: Density mechanism SUFFIX definition
 * - lint__nmodlBreakpointBlock: State integration BREAKPOINT block
 * - lint__nmodlDerivativeEvolution: Evolution equation check for all states
 * - lint__nmodlAll: Aggregated diagnostic suite
 */

import type { LintResult } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { NmodlErrorCode } from "./errors.js";
import { lintNmodl } from "./lints/nmodl-linter.js";
import { parseNmodl } from "./parser/nmodl-parser.js";
import type { NmodlDocument } from "./types.js";

/**
 * Salsa query retrieving or parsing the NmodlDocument from a mechanism symbol.
 */
export function nmodlDocument(_db: QueryDB, entry: SymbolEntry): NmodlDocument | null {
  if (!entry) return null;

  if (entry.metadata?.["doc"]) {
    return entry.metadata["doc"] as NmodlDocument;
  }

  const raw = (entry.metadata?.["rawSource"] as string) || (entry.metadata?.["text"] as string);
  if (raw) {
    return parseNmodl(raw);
  }

  return null;
}

/**
 * Salsa incremental lint hook: validates presence of NEURON block.
 */
export function lint__nmodlNeuronBlock(db: QueryDB, entry: SymbolEntry): LintResult | null {
  const doc = db.query<NmodlDocument | null>("nmodlDocument", entry.id);
  if (!doc) return null;

  if (!/\bNEURON\s*\{/i.test(doc.raw)) {
    return {
      code: NmodlErrorCode.MISSING_NEURON_BLOCK.code,
      message: NmodlErrorCode.MISSING_NEURON_BLOCK.message(),
      severity: NmodlErrorCode.MISSING_NEURON_BLOCK.severity,
      startOffset: doc.model.range?.startOffset,
      endOffset: doc.model.range?.endOffset,
    };
  }
  return null;
}

/**
 * Salsa incremental lint hook: validates SUFFIX declaration.
 */
export function lint__nmodlSuffixDeclaration(db: QueryDB, entry: SymbolEntry): LintResult | null {
  const doc = db.query<NmodlDocument | null>("nmodlDocument", entry.id);
  if (!doc) return null;

  if (/\bNEURON\s*\{/i.test(doc.raw) && (!doc.model.suffix || doc.model.suffix === "channel")) {
    if (!/\bSUFFIX\s+[a-zA-Z0-9_]+/i.test(doc.raw)) {
      return {
        code: NmodlErrorCode.MISSING_SUFFIX_DECLARATION.code,
        message: NmodlErrorCode.MISSING_SUFFIX_DECLARATION.message(),
        severity: NmodlErrorCode.MISSING_SUFFIX_DECLARATION.severity,
        startOffset: doc.model.range?.startOffset,
        endOffset: doc.model.range?.endOffset,
      };
    }
  }
  return null;
}

/**
 * Salsa incremental lint hook: validates presence of BREAKPOINT block.
 */
export function lint__nmodlBreakpointBlock(db: QueryDB, entry: SymbolEntry): LintResult | null {
  const doc = db.query<NmodlDocument | null>("nmodlDocument", entry.id);
  if (!doc) return null;

  if (!/\bBREAKPOINT\s*\{/i.test(doc.raw)) {
    return {
      code: NmodlErrorCode.MISSING_BREAKPOINT_BLOCK.code,
      message: NmodlErrorCode.MISSING_BREAKPOINT_BLOCK.message(),
      severity: NmodlErrorCode.MISSING_BREAKPOINT_BLOCK.severity,
      startOffset: doc.model.range?.startOffset,
      endOffset: doc.model.range?.endOffset,
    };
  }
  return null;
}

/**
 * Salsa incremental lint hook: validates derivative evolution equations for all states.
 */
export function lint__nmodlDerivativeEvolution(db: QueryDB, entry: SymbolEntry): LintResult[] | null {
  const doc = db.query<NmodlDocument | null>("nmodlDocument", entry.id);
  if (!doc) return null;

  const derivStateNames = new Set<string>();
  for (const eq of doc.model.derivativeEquations) {
    if (eq.stateName) derivStateNames.add(eq.stateName.toLowerCase());
  }

  const results: LintResult[] = [];
  for (const st of doc.model.states) {
    if (!derivStateNames.has(st.name.toLowerCase())) {
      results.push({
        code: NmodlErrorCode.MISSING_DERIVATIVE_EVOLUTION.code,
        message: NmodlErrorCode.MISSING_DERIVATIVE_EVOLUTION.message(st.name),
        severity: NmodlErrorCode.MISSING_DERIVATIVE_EVOLUTION.severity,
        startOffset: st.range?.startOffset,
        endOffset: st.range?.endOffset,
      });
    }
  }

  return results.length > 0 ? results : null;
}

/**
 * Salsa incremental lint hook: runs all NMODL linter checks.
 */
export function lint__nmodlAll(db: QueryDB, entry: SymbolEntry): LintResult[] | null {
  const doc = db.query<NmodlDocument | null>("nmodlDocument", entry.id);
  if (!doc) return null;

  const items = lintNmodl(doc);
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
 * Query hooks dispatch table registered with WasmQueryEngine for rule `nmodl_channel`.
 */
export const nmodlQueryHooks: Record<string, Record<string, any>> = {
  nmodl_channel: {
    nmodlDocument,
    lint__nmodlNeuronBlock,
    lint__nmodlSuffixDeclaration,
    lint__nmodlBreakpointBlock,
    lint__nmodlDerivativeEvolution,
    lint__nmodlAll,
  },
};
