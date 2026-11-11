// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseCantera } from "./parser/cantera-parser.js";
import type { CanteraDocument } from "./types.js";

/**
 * Predicate to disambiguate Cantera chemical kinetics files (.yaml, .yml, .cti) from other YAML formats.
 */
export function canIndexCantera(uri: string, text?: string): boolean {
  const lower = uri.split(/[?#]/)[0]!.toLowerCase();
  if (lower.endsWith(".cti")) return true;
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    if (!text) return true;
    return /^\s*(?:phases|species|reactions|units|generator)\s*:/m.test(text) || text.includes("ideal_gas(");
  }
  return false;
}

/**
 * Declarative file indexer for Cantera Chemical Kinetics Mechanism documents (.yaml, .cti).
 */
export function indexCanteraDocument(ctx: DslIndexFileContext): void {
  try {
    const doc = parseCantera(ctx.text, ctx.uri);
    ctx.setParsedModel<CanteraDocument>(doc);
    const m = doc.mechanism;

    const rootId = ctx.addSymbol(
      m.name || "CanteraMechanism",
      "package",
      null,
      0,
      ctx.text.length,
      {
        format: doc.format,
        description: m.description,
        phaseCount: m.phases.size,
        speciesCount: m.species.size,
        reactionCount: m.reactions.length,
      },
      { ruleName: "cantera_symbol" },
    );

    // Index Phases
    for (const [name, p] of m.phases) {
      const start = p.range?.startOffset ?? 0;
      const end = p.range?.endOffset ?? 50;
      ctx.addSymbol(
        name,
        "struct",
        rootId,
        start,
        end,
        {
          thermo: p.thermo,
          kinetics: p.kinetics,
          elements: p.elements,
          species: p.species,
        },
        { ruleName: "cantera_symbol" },
      );
    }

    // Index Species
    for (const [name, s] of m.species) {
      const start = s.range?.startOffset ?? 0;
      const end = s.range?.endOffset ?? 50;
      ctx.addSymbol(
        name,
        "variable",
        rootId,
        start,
        end,
        {
          composition: s.composition,
          charge: s.charge,
          hasThermo: s.thermo !== undefined,
        },
        { ruleName: "cantera_symbol" },
      );
    }

    // Index Reactions
    for (const rxn of m.reactions) {
      const start = rxn.range?.startOffset ?? 0;
      const end = rxn.range?.endOffset ?? 50;
      ctx.addSymbol(
        rxn.id,
        "function",
        rootId,
        start,
        end,
        {
          equation: rxn.equation,
          type: rxn.type,
          reversible: rxn.reversible,
          rateConstant: rxn.rateConstant,
        },
        { ruleName: "cantera_symbol" },
      );
    }
  } catch {
    // Return partial symbol map if parsing failed
  }
}

/**
 * Retrieves the parsed `CanteraDocument` stored in `UnifiedWorkspace` for `uri`.
 */
export function getCanteraDocument(workspace: UnifiedWorkspace, uri: string): CanteraDocument | undefined {
  return workspace.getParsedModel<CanteraDocument>(uri);
}
