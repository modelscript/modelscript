// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ran — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes RAN antenna pattern decks (.adf, .nsma, .pat, .msi, .planet) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseNsmaAdf } from "./parser/nsma-parser.js";
import { parsePlanetPat } from "./parser/planet-parser.js";

export const ranIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (
      lower.endsWith(".adf") ||
      lower.endsWith(".nsma") ||
      lower.endsWith(".msi") ||
      lower.endsWith(".planet") ||
      lower.endsWith(".pat")
    ) {
      return true;
    }
    return Boolean(text && (text.includes("REVNUM:") || text.includes("MANUF:") || text.includes("NOFREQ:")));
  },

  indexFile(ctx: DslIndexFileContext): void {
    try {
      const lower = ctx.uri.toLowerCase();
      const isPlanet = lower.endsWith(".pat") || lower.endsWith(".msi") || lower.endsWith(".planet");
      const deck = isPlanet ? parsePlanetPat(ctx.text, ctx.uri) : parseNsmaAdf(ctx.text, ctx.uri);
      ctx.setParsedModel(deck);

      const rootSymId = ctx.addSymbol(
        deck.name,
        "package",
        null,
        0,
        ctx.text.length,
        {
          peakGainDbi: deck.peakGainDbi,
          polarization: deck.polarization,
          downtilt: deck.electricalDowntiltDeg,
        },
        {
          ruleName: "antenna_pattern",
          namePath: deck.name,
          aliases: deck.model && deck.model !== deck.name ? [deck.model] : [],
        },
      );

      if (deck.horizontalCut) {
        ctx.addSymbol(
          "HorizontalCut",
          "property",
          rootSymId,
          0,
          Math.min(50, ctx.text.length),
          {
            points: deck.horizontalCut.points.length,
            beamwidth: deck.horizontalBeamwidthDeg,
          },
          {
            ruleName: "azimuth_cut",
            namePath: "HorizontalCut",
          },
        );
      }

      if (deck.verticalCut) {
        ctx.addSymbol(
          "VerticalCut",
          "property",
          rootSymId,
          0,
          Math.min(50, ctx.text.length),
          {
            points: deck.verticalCut.points.length,
            beamwidth: deck.verticalBeamwidthDeg,
          },
          {
            ruleName: "elevation_cut",
            namePath: "VerticalCut",
          },
        );
      }
    } catch {
      // Ignore parse errors during incremental indexing
    }
  },
};
