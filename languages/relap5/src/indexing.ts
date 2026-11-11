// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/relap5 — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes US NRC RELAP5-3D decks (.i, .inp, .r5) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseRelap5 } from "./parser/relap5-parser.js";

export const relap5Indexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".r5") || lower.endsWith(".i") || lower.endsWith(".relap5.inp")) {
      return true;
    }
    if (!text) return false;
    return (
      /^\s*=\s*\S+/m.test(text) ||
      /^\s*(?:0000)?100\b/m.test(text) ||
      /^\s*(?:0000)?101\s+(?:new|restart)\b/im.test(text)
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    try {
      const deck = parseRelap5(ctx.text, ctx.uri);
      ctx.setParsedModel(deck);

      // Root Plant Model symbol
      const rootId = ctx.addSymbol(deck.title, "package", null, 0, ctx.text.length, {
        problemType: deck.problemType,
        executionType: deck.executionType,
      });

      // Index Volumes
      for (const [id, vol] of deck.volumes) {
        const start = vol.range?.startOffset ?? 0;
        const end = vol.range?.endOffset ?? 50;
        ctx.addSymbol(vol.name, "class", rootId, start, end, {
          componentId: id,
          type: vol.type,
          pressure: vol.initialPressure,
          temperature: vol.initialTemperature,
        });
      }

      // Index Junctions
      for (const [id, junc] of deck.junctions) {
        const start = junc.range?.startOffset ?? 0;
        const end = junc.range?.endOffset ?? 50;
        ctx.addSymbol(`Junc_${id}`, "component", rootId, start, end, {
          junctionId: id,
          fromVolume: junc.fromVolume,
          toVolume: junc.toVolume,
        });
      }

      // Index Heat Structures
      for (const [id, hs] of deck.heatStructures) {
        const start = hs.range?.startOffset ?? 0;
        const end = hs.range?.endOffset ?? 50;
        ctx.addSymbol(`HeatStructure_${id}`, "struct", rootId, start, end, {
          meshPoints: hs.meshPoints,
          k: hs.thermalConductivity,
        });
      }

      // Index Reactor Kinetics
      if (deck.kinetics) {
        const start = deck.kinetics.range?.startOffset ?? 0;
        const end = deck.kinetics.range?.endOffset ?? 50;
        ctx.addSymbol("ReactorPointKinetics", "module", rootId, start, end, {
          initialPower: deck.kinetics.initialPower,
          promptGenerationTime: deck.kinetics.promptGenerationTime,
          delayedGroups: deck.kinetics.delayedGroups.length,
        });
      }

      // Index Trips
      for (const [id, trip] of deck.trips) {
        const start = trip.range?.startOffset ?? 0;
        const end = trip.range?.endOffset ?? 50;
        ctx.addSymbol(`Trip_${id}`, "event", rootId, start, end, {
          isLogical: trip.isLogical,
          variable: trip.variableName,
          setpoint: trip.setpoint,
        });
      }
    } catch {
      // Return partial symbol map if parsing failed
    }
  },
};
