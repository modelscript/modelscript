// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseWorkspaceIndex, type SymbolIndex } from "@modelscript/runtime";
import { parseOpenDss } from "./parser/opendss-parser.js";
import type { DssDeck } from "./types.js";

export type OpenDssDocumentLoader = () =>
  | string
  | { sourceText?: string | undefined; text?: string | undefined }
  | null
  | undefined;

/**
 * Multi-file workspace indexer for EPRI OpenDSS distribution network scripts (.dss).
 */
export class OpenDssWorkspaceIndex extends BaseWorkspaceIndex<DssDeck> {
  public readonly languageName = "opendss";

  public override indexFile(uri: string, text: string): SymbolIndex {
    const { addSymbol, symbols, byName, childrenOf } = this.createIndexContext(uri);

    try {
      const deck = parseOpenDss(text, uri);
      this.fileDecks.set(uri, deck);

      // Root Circuit Symbol
      const rootName = deck.circuit?.name ?? "DistributionCircuit";
      const rootId = addSymbol(rootName, "package", null, 0, text.length, {
        baseKv: deck.circuit?.baseKv,
        bus1: deck.circuit?.bus1,
      });

      // Index Transformers
      for (const [id, xfmr] of deck.transformers) {
        addSymbol(id, "class", rootId, 0, 50, {
          buses: xfmr.buses,
          kvs: xfmr.kvs,
        });
      }

      // Index Lines
      for (const [id, line] of deck.lines) {
        addSymbol(id, "class", rootId, 0, 50, {
          bus1: line.bus1,
          bus2: line.bus2,
          length: line.length,
        });
      }

      // Index Loads
      for (const [id, load] of deck.loads) {
        addSymbol(id, "variable", rootId, 0, 50, {
          bus1: load.bus1,
          kw: load.kw,
          kvar: load.kvar,
        });
      }

      // Index PV Systems
      for (const [id, pv] of deck.pvSystems) {
        addSymbol(id, "field", rootId, 0, 50, {
          bus1: pv.bus1,
          pmpp: pv.pmpp,
        });
      }

      // Index Capacitors
      for (const [id, cap] of deck.capacitors) {
        addSymbol(id, "variable", rootId, 0, 50, {
          bus1: cap.bus1,
          kvar: cap.kvar,
        });
      }
    } catch {
      // If parsing fails, preserve empty symbol table
    }

    return { symbols, byName, childrenOf };
  }
}
