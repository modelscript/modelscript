// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseAntimony } from "./parser/antimony-parser.js";
import type { AntimonyDocument, AntimonyModule } from "./types.js";

/**
 * Declarative per-file indexer for Antimony reaction network documents (`.ant`).
 */
export function indexAntimonyDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  try {
    const doc = parseAntimony(text, uri);
    ctx.setParsedModel<AntimonyDocument>(doc);

    for (const [fnId, fn] of doc.functions) {
      const start = fn.range?.startOffset ?? 0;
      const end = fn.range?.endOffset ?? text.length;
      ctx.addSymbol(
        fnId,
        "function",
        null,
        start,
        end,
        {
          arguments: fn.arguments,
          body: fn.body,
        },
        { ruleName: "antimony_symbol" },
      );
    }

    const modulesToIndex: AntimonyModule[] = doc.modules.size > 0 ? Array.from(doc.modules.values()) : [doc.mainModule];

    for (const mod of modulesToIndex) {
      const modStart = mod.range?.startOffset ?? 0;
      const modEnd = mod.range?.endOffset ?? text.length;
      const modSymId = ctx.addSymbol(
        mod.id || "AntimonyModule",
        "package",
        null,
        modStart,
        modEnd,
        {
          name: mod.name,
          speciesCount: mod.species.size,
          reactionCount: mod.reactions.size,
        },
        { ruleName: "antimony_symbol" },
      );

      for (const [cId, comp] of mod.compartments) {
        ctx.addSymbol(
          cId,
          "struct",
          modSymId,
          comp.range?.startOffset ?? modStart,
          comp.range?.endOffset ?? modEnd,
          {
            name: comp.name,
            size: comp.size,
            constant: comp.constant,
          },
          { ruleName: "antimony_symbol" },
        );
      }

      for (const [sId, sp] of mod.species) {
        ctx.addSymbol(
          sId,
          "variable",
          modSymId,
          sp.range?.startOffset ?? modStart,
          sp.range?.endOffset ?? modEnd,
          {
            name: sp.name,
            compartment: sp.compartment,
            initialConcentration: sp.initialConcentration,
            boundaryCondition: sp.boundaryCondition,
            constant: sp.constant,
          },
          { ruleName: "antimony_symbol" },
        );
      }

      for (const [pId, param] of mod.parameters) {
        ctx.addSymbol(
          pId,
          "constant",
          modSymId,
          param.range?.startOffset ?? modStart,
          param.range?.endOffset ?? modEnd,
          {
            name: param.name,
            value: param.value,
            constant: param.constant,
          },
          { ruleName: "antimony_symbol" },
        );
      }

      for (const [rId, rxn] of mod.reactions) {
        ctx.addSymbol(
          rId,
          "function",
          modSymId,
          rxn.range?.startOffset ?? modStart,
          rxn.range?.endOffset ?? modEnd,
          {
            name: rxn.name,
            reversible: rxn.reversible,
            reactants: rxn.reactants.map((r) => r.species),
            products: rxn.products.map((p) => p.species),
            rateLaw: rxn.rateLaw,
          },
          { ruleName: "antimony_symbol" },
        );
      }

      for (const ev of mod.events) {
        ctx.addSymbol(
          ev.id,
          "event",
          modSymId,
          ev.range?.startOffset ?? modStart,
          ev.range?.endOffset ?? modEnd,
          {
            trigger: ev.trigger,
            assignments: ev.assignments.length,
          },
          { ruleName: "antimony_symbol" },
        );
      }
    }
  } catch {
    // Return partial symbol map if parsing failed
  }
}

/**
 * Retrieves a parsed `AntimonyDocument` from `UnifiedWorkspace` for `uri`.
 */
export function getAntimonyDocument(workspace: UnifiedWorkspace, uri: string): AntimonyDocument | undefined {
  return workspace.getParsedModel<AntimonyDocument>(uri);
}
