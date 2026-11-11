// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbml — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes Systems Biology Markup Language documents (.sbml, .xml) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseSbml } from "./parser/sbml-parser.js";

export const sbmlIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".sbml") || lower.endsWith(".sbml.xml")) return true;
    return Boolean(text && text.includes("<sbml"));
  },

  indexFile(ctx: DslIndexFileContext): void {
    try {
      const doc = parseSbml(ctx.text, ctx.uri);
      ctx.setParsedModel(doc);
      const m = doc.model;

      // Root Model symbol
      const rootName = m.id || "SbmlModel";
      const rootId = ctx.addSymbol(
        rootName,
        "package",
        null,
        0,
        ctx.text.length,
        {
          name: m.name,
          level: doc.level,
          version: doc.version,
          speciesCount: m.species.size,
          reactionCount: m.reactions.size,
        },
        {
          ruleName: "sbml_symbol",
          namePath: rootName,
        },
      );

      // Index Compartments
      for (const [id, c] of m.compartments) {
        const start = c.range?.startOffset ?? 0;
        const end = c.range?.endOffset ?? 50;
        ctx.addSymbol(
          id,
          "struct",
          rootId,
          start,
          end,
          {
            name: c.name,
            size: c.size,
            spatialDimensions: c.spatialDimensions,
          },
          {
            ruleName: "sbml_symbol",
            namePath: id,
          },
        );
      }

      // Index Species
      for (const [id, s] of m.species) {
        const start = s.range?.startOffset ?? 0;
        const end = s.range?.endOffset ?? 50;
        ctx.addSymbol(
          id,
          "variable",
          rootId,
          start,
          end,
          {
            name: s.name,
            compartment: s.compartment,
            initialAmount: s.initialAmount,
            initialConcentration: s.initialConcentration,
            constant: s.constant,
          },
          {
            ruleName: "sbml_symbol",
            namePath: id,
          },
        );
      }

      // Index Parameters
      for (const [id, p] of m.parameters) {
        const start = p.range?.startOffset ?? 0;
        const end = p.range?.endOffset ?? 50;
        ctx.addSymbol(
          id,
          "constant",
          rootId,
          start,
          end,
          {
            value: p.value,
            units: p.units,
          },
          {
            ruleName: "sbml_symbol",
            namePath: id,
          },
        );
      }

      // Index Reactions
      for (const [id, r] of m.reactions) {
        const start = r.range?.startOffset ?? 0;
        const end = r.range?.endOffset ?? 50;
        ctx.addSymbol(
          id,
          "function",
          rootId,
          start,
          end,
          {
            reversible: r.reversible,
            reactants: r.reactants.map((ref) => ref.species),
            products: r.products.map((ref) => ref.species),
            formula: r.kineticLaw?.formula,
          },
          {
            ruleName: "sbml_symbol",
            namePath: id,
          },
        );
      }
    } catch {
      // Return partial symbol map if parsing failed
    }
  },
};
