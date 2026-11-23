// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseChemkin } from "./parser/chemkin-parser.js";
import type { ChemkinDocument } from "./types.js";

/**
 * Predicate to disambiguate CHEMKIN decks (.inp, .ck, .therm) from other .inp formats.
 */
export function canIndexChemkin(uri: string, text?: string): boolean {
  const lower = uri.split(/[?#]/)[0]!.toLowerCase();
  if (lower.endsWith(".ck") || lower.endsWith(".therm")) return true;
  if (lower.endsWith(".inp")) {
    if (!text) return true;
    return /^\s*(?:ELEMENTS|ELEM|SPECIES|SPEC|THERMO|THER|REACTIONS|REAC)\b/im.test(text);
  }
  return false;
}

/**
 * Declarative file indexer for CHEMKIN gas-phase & surface kinetics decks.
 */
export function indexChemkinDocument(ctx: DslIndexFileContext): void {
  try {
    const doc = parseChemkin(ctx.text, ctx.uri);
    ctx.setParsedModel<ChemkinDocument>(doc);
    const m = doc.mechanism;

    const rootId = ctx.addSymbol(
      m.name || "ChemkinMechanism",
      "package",
      null,
      0,
      ctx.text.length,
      {
        elementCount: m.elements.size,
        speciesCount: m.species.size,
        thermoCount: m.thermo.size,
        reactionCount: m.reactions.length,
        energyUnits: m.energyUnits,
        quantityUnits: m.quantityUnits,
      },
      { ruleName: "chemkin_symbol" },
    );

    for (const [name, el] of m.elements) {
      ctx.addSymbol(
        name,
        "constant",
        rootId,
        el.range?.startOffset ?? 0,
        el.range?.endOffset ?? 0,
        { atomicWeight: el.atomicWeight },
        { ruleName: "chemkin_element" },
      );
    }

    for (const [name, sp] of m.species) {
      const th = m.thermo.get(name);
      ctx.addSymbol(
        name,
        "variable",
        rootId,
        sp.range?.startOffset ?? 0,
        sp.range?.endOffset ?? 0,
        {
          hasThermo: th !== undefined,
          composition: th?.composition,
          phase: th?.phase,
        },
        { ruleName: "chemkin_species" },
      );
    }

    for (const rxn of m.reactions) {
      ctx.addSymbol(
        rxn.id,
        "function",
        rootId,
        rxn.range?.startOffset ?? 0,
        rxn.range?.endOffset ?? 0,
        {
          equation: rxn.equation,
          reversible: rxn.reversible,
          thirdBody: rxn.thirdBody,
          falloff: rxn.falloff,
          rate: rxn.rate,
        },
        { ruleName: "chemkin_reaction" },
      );
    }
  } catch {
    // Allow partial indexing on malformed decks
  }
}

export function getChemkinDocument(workspace: UnifiedWorkspace, uri: string): ChemkinDocument | undefined {
  return workspace.getParsedModel<ChemkinDocument>(uri);
}

export const chemkinIndexing: LanguageIndexingConfig = {
  canIndex: canIndexChemkin,
  indexFile: indexChemkinDocument,
};
