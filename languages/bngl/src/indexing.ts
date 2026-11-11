// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseBngl, serializeComplexPattern } from "./parser/bngl-parser.js";
import type { BnglDocument } from "./types.js";

/**
 * Declarative file indexer for BioNetGen rule-based modeling documents (.bngl).
 */
export function indexBnglDocument(ctx: DslIndexFileContext): void {
  try {
    const doc = parseBngl(ctx.text, ctx.uri);
    ctx.setParsedModel<BnglDocument>(doc);
    const m = doc.model;

    const modStart = m.range?.startOffset ?? 0;
    const modEnd = m.range?.endOffset ?? ctx.text.length;
    const modSymId = ctx.addSymbol(
      m.id || "BioNetGenModel",
      "package",
      null,
      modStart,
      modEnd,
      {
        moleculeTypeCount: m.moleculeTypes.size,
        seedSpeciesCount: m.seedSpecies.length,
        ruleCount: m.reactionRules.size,
      },
      { ruleName: "bngl_symbol" },
    );

    for (const [pId, param] of m.parameters) {
      ctx.addSymbol(
        pId,
        "constant",
        modSymId,
        param.range?.startOffset ?? modStart,
        param.range?.endOffset ?? modEnd,
        {
          value: param.value,
          expression: param.expression,
        },
        { ruleName: "bngl_symbol" },
      );
    }

    for (const [cId, comp] of m.compartments) {
      ctx.addSymbol(
        cId,
        "struct",
        modSymId,
        comp.range?.startOffset ?? modStart,
        comp.range?.endOffset ?? modEnd,
        {
          dimensions: comp.dimensions,
          size: comp.size,
          parent: comp.parent,
        },
        { ruleName: "bngl_symbol" },
      );
    }

    for (const [mName, mt] of m.moleculeTypes) {
      ctx.addSymbol(
        mName,
        "class",
        modSymId,
        mt.range?.startOffset ?? modStart,
        mt.range?.endOffset ?? modEnd,
        {
          sites: mt.sites.map((s) => s.name),
        },
        { ruleName: "bngl_symbol" },
      );
    }

    for (const sp of m.seedSpecies) {
      const patStr = sp.pattern.raw ?? serializeComplexPattern(sp.pattern);
      ctx.addSymbol(
        patStr,
        "variable",
        modSymId,
        sp.range?.startOffset ?? modStart,
        sp.range?.endOffset ?? modEnd,
        {
          id: sp.id,
          initialConcentration: sp.initialConcentration,
        },
        { ruleName: "bngl_symbol" },
      );
    }

    for (const [oName, obs] of m.observables) {
      ctx.addSymbol(
        oName,
        "property",
        modSymId,
        obs.range?.startOffset ?? modStart,
        obs.range?.endOffset ?? modEnd,
        {
          type: obs.type,
          patterns: obs.patterns.length,
        },
        { ruleName: "bngl_symbol" },
      );
    }

    for (const [rId, rule] of m.reactionRules) {
      ctx.addSymbol(
        rId,
        "function",
        modSymId,
        rule.range?.startOffset ?? modStart,
        rule.range?.endOffset ?? modEnd,
        {
          reversible: rule.reversible,
          forwardRate: rule.forwardRate,
          reverseRate: rule.reverseRate,
        },
        { ruleName: "bngl_symbol" },
      );
    }
  } catch {
    // Return partial symbol map if parsing failed
  }
}

/**
 * Retrieves the parsed `BnglDocument` stored in `UnifiedWorkspace` for `uri`.
 */
export function getBnglDocument(workspace: UnifiedWorkspace, uri: string): BnglDocument | undefined {
  return workspace.getParsedModel<BnglDocument>(uri);
}
