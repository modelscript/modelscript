// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseWorkspaceIndex, type SymbolEntry, type SymbolIndex } from "@modelscript/runtime";
import { parseRelap5 } from "./parser/relap5-parser.js";
import type { Relap5Deck } from "./types.js";

export type Relap5DocumentLoader = () =>
  | string
  | { sourceText?: string | undefined; text?: string | undefined }
  | null
  | undefined;

/**
 * Multi-file workspace indexer for US NRC RELAP5-3D decks (.i, .inp, .r5).
 */
export class Relap5WorkspaceIndex extends BaseWorkspaceIndex<Relap5Deck> {
  public readonly languageName = "relap5";

  public indexFile(uri: string, text: string): SymbolIndex {
    const { addSymbol } = this.createIndexContext(uri);

    try {
      const deck = parseRelap5(text, uri);
      this.fileDecks.set(uri, deck);

      // Root Plant Model symbol
      const rootId = addSymbol(deck.title, "package", null, 0, text.length, {
        problemType: deck.problemType,
        executionType: deck.executionType,
      });

      // Index Volumes
      for (const [id, vol] of deck.volumes) {
        const start = vol.range?.startOffset ?? 0;
        const end = vol.range?.endOffset ?? 50;
        addSymbol(vol.name, "class", rootId, start, end, {
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
        addSymbol(`Junc_${id}`, "component", rootId, start, end, {
          junctionId: id,
          fromVolume: junc.fromVolume,
          toVolume: junc.toVolume,
        });
      }

      // Index Heat Structures
      for (const [id, hs] of deck.heatStructures) {
        const start = hs.range?.startOffset ?? 0;
        const end = hs.range?.endOffset ?? 50;
        addSymbol(`HeatStructure_${id}`, "struct", rootId, start, end, {
          meshPoints: hs.meshPoints,
          k: hs.thermalConductivity,
        });
      }

      // Index Reactor Kinetics
      if (deck.kinetics) {
        const start = deck.kinetics.range?.startOffset ?? 0;
        const end = deck.kinetics.range?.endOffset ?? 50;
        addSymbol("ReactorPointKinetics", "module", rootId, start, end, {
          initialPower: deck.kinetics.initialPower,
          promptGenerationTime: deck.kinetics.promptGenerationTime,
          delayedGroups: deck.kinetics.delayedGroups.length,
        });
      }

      // Index Trips
      for (const [id, trip] of deck.trips) {
        const start = trip.range?.startOffset ?? 0;
        const end = trip.range?.endOffset ?? 50;
        addSymbol(`Trip_${id}`, "event", rootId, start, end, {
          isLogical: trip.isLogical,
          variable: trip.variableName,
          setpoint: trip.setpoint,
        });
      }
    } catch {
      // Return partial symbol map if parsing failed
    }

    return this.getFileIndex(uri) ?? { symbols: new Map(), byName: new Map(), childrenOf: new Map() };
  }

  public getSymbols(uri: string): SymbolEntry[] {
    const idx = this.fileIndices.get(uri);
    return idx ? Array.from(idx.symbols.values()) : [];
  }

  public findDefinition(name: string): SymbolEntry | undefined {
    for (const idx of this.fileIndices.values()) {
      const ids = idx.byName.get(name);
      if (ids && ids.length > 0 && ids[0] !== undefined) {
        const sym = idx.symbols.get(ids[0]);
        if (sym) return sym;
      }
    }
    return undefined;
  }

  public findReferences(name: string): SymbolEntry[] {
    const refs: SymbolEntry[] = [];
    for (const idx of this.fileIndices.values()) {
      const ids = idx.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const sym = idx.symbols.get(id);
          if (sym) refs.push(sym);
        }
      }
    }
    return refs;
  }
}
