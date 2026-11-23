// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scale — Declarative UnifiedWorkspace Indexing.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseScale } from "./parser/scale-parser.js";

export const scaleIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".scale") || lower.endsWith(".scl") || lower.endsWith(".keno") || lower.endsWith(".origen")) {
      return true;
    }
    if (!text) return false;
    return /^\s*=(?:csas[56]|csas2[56]|origen|t-depl|t[56]-depl|triton|keno-v[ai])\b/im.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    try {
      const deck = parseScale(ctx.text, ctx.uri);
      ctx.setParsedModel(deck);

      const rootId = ctx.addSymbol(deck.title, "package", null, 0, ctx.text.length, {
        sequence: deck.sequence,
        sequenceType: deck.sequenceType,
        crossSectionLib: deck.crossSectionLib,
      });

      for (const comp of deck.compositions) {
        const start = comp.range?.startOffset ?? 0;
        const end = comp.range?.endOffset ?? start + 20;
        ctx.addSymbol(`Mix_${comp.mixtureId}_${comp.materialName}`, "material", rootId, start, end, {
          mixtureId: comp.mixtureId,
          materialName: comp.materialName,
          density: comp.density,
          temperature: comp.temperature,
          enrichment: comp.enrichment,
        });
      }

      for (const unit of deck.units.values()) {
        const start = unit.range?.startOffset ?? 0;
        const end = unit.range?.endOffset ?? start + 20;
        ctx.addSymbol(unit.isGlobal ? `GlobalUnit_${unit.id}` : `Unit_${unit.id}`, "class", rootId, start, end, {
          unitId: unit.id,
          isGlobal: unit.isGlobal,
          bodyCount: unit.bodies.length,
          mediaCount: unit.media.length,
        });
      }

      for (const arr of deck.arrays.values()) {
        const start = arr.range?.startOffset ?? 0;
        const end = arr.range?.endOffset ?? start + 20;
        ctx.addSymbol(`Array_${arr.id}`, "struct", rootId, start, end, {
          arrayId: arr.id,
          nux: arr.nux,
          nuy: arr.nuy,
          nuz: arr.nuz,
        });
      }

      for (const oc of deck.origenCases) {
        ctx.addSymbol(`OrigenCase_${oc.id}`, "module", rootId, 0, ctx.text.length, {
          caseId: oc.id,
          nuclideCount: oc.nuclides.length,
          timeSteps: oc.time?.values.length ?? 0,
        });
      }
    } catch {
      // Partial index on parse failure
    }
  },
};
