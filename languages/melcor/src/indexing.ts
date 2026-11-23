// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/melcor — Declarative UnifiedWorkspace Indexing.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseMelcor } from "./parser/melcor-parser.js";

export const melcorIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".mel") || lower.endsWith(".melcor") || lower.endsWith(".mci")) {
      return true;
    }
    if (!text) return false;
    return /\b(?:MELGEN_INPUT|MELCOR_INPUT|CVH_INPUT|FL_INPUT|COR_INPUT)\b/i.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    try {
      const deck = parseMelcor(ctx.text, ctx.uri);
      ctx.setParsedModel(deck);

      const rootId = ctx.addSymbol(deck.title, "package", null, 0, ctx.text.length, {
        inputPhase: deck.inputPhase,
        tEnd: deck.exec.tEnd,
      });

      for (const [id, cv] of deck.controlVolumes) {
        const start = cv.range?.startOffset ?? 0;
        const end = cv.range?.endOffset ?? start + 20;
        ctx.addSymbol(cv.name, "class", rootId, start, end, {
          cvId: id,
          cvType: cv.cvType,
          volume: cv.volume,
          pressure: cv.pressure,
          temperature: cv.temperature,
        });
      }

      for (const [id, fl] of deck.flowPaths) {
        const start = fl.range?.startOffset ?? 0;
        const end = fl.range?.endOffset ?? start + 20;
        ctx.addSymbol(fl.name, "component", rootId, start, end, {
          flId: id,
          fromCv: fl.fromCv,
          toCv: fl.toCv,
          area: fl.area,
        });
      }

      for (const [id, hs] of deck.heatStructures) {
        const start = hs.range?.startOffset ?? 0;
        const end = hs.range?.endOffset ?? start + 20;
        ctx.addSymbol(hs.name, "struct", rootId, start, end, {
          hsId: id,
          geometry: hs.geometry,
          leftBoundaryCv: hs.leftBoundaryCv,
          rightBoundaryCv: hs.rightBoundaryCv,
        });
      }

      if (deck.core?.present) {
        const start = deck.core.range?.startOffset ?? 0;
        const end = deck.core.range?.endOffset ?? start + 20;
        ctx.addSymbol("COR_Core", "module", rootId, start, end, {
          radialRings: deck.core.radialRings,
          axialLevels: deck.core.axialLevels,
          decayHeatW: deck.core.decayHeatW,
          oxidationEnabled: deck.core.oxidationEnabled,
        });
      }

      for (const [id, cf] of deck.controlFunctions) {
        const start = cf.range?.startOffset ?? 0;
        const end = cf.range?.endOffset ?? start + 20;
        ctx.addSymbol(cf.name, "function", rootId, start, end, {
          cfId: id,
          cfType: cf.cfType,
        });
      }

      for (const [id, tf] of deck.tabularFunctions) {
        const start = tf.range?.startOffset ?? 0;
        const end = tf.range?.endOffset ?? start + 20;
        ctx.addSymbol(tf.name, "function", rootId, start, end, {
          tfId: id,
          pointCount: tf.points.length,
        });
      }
    } catch {
      // Partial index on parse failure
    }
  },
};
