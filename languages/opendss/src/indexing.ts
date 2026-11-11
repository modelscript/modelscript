// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseOpenDss } from "./parser/opendss-parser.js";
import type { DssDeck } from "./types.js";

/**
 * Declarative file indexer for EPRI OpenDSS distribution network scripts (.dss).
 */
export function indexOpenDssFile(ctx: DslIndexFileContext): void {
  try {
    const deck = parseOpenDss(ctx.text, ctx.uri);
    ctx.setParsedModel(deck);

    const rootName = deck.circuit?.name ?? "DistributionCircuit";
    const rootId = ctx.addSymbol(rootName, "package", null, 0, ctx.text.length, {
      baseKv: deck.circuit?.baseKv,
      bus1: deck.circuit?.bus1,
    });

    for (const [id, xfmr] of deck.transformers) {
      ctx.addSymbol(id, "class", rootId, 0, 50, {
        buses: xfmr.buses,
        kvs: xfmr.kvs,
      });
    }

    for (const [id, line] of deck.lines) {
      ctx.addSymbol(id, "class", rootId, 0, 50, {
        bus1: line.bus1,
        bus2: line.bus2,
        length: line.length,
      });
    }

    for (const [id, load] of deck.loads) {
      ctx.addSymbol(id, "variable", rootId, 0, 50, {
        bus1: load.bus1,
        kw: load.kw,
        kvar: load.kvar,
      });
    }

    for (const [id, pv] of deck.pvSystems) {
      ctx.addSymbol(id, "field", rootId, 0, 50, {
        bus1: pv.bus1,
        pmpp: pv.pmpp,
      });
    }

    for (const [id, cap] of deck.capacitors) {
      ctx.addSymbol(id, "variable", rootId, 0, 50, {
        bus1: cap.bus1,
        kvar: cap.kvar,
      });
    }
  } catch {
    // Preserve empty symbol table if parsing fails
  }
}

export function getOpenDssDeck(workspace: UnifiedWorkspace, uri: string): DssDeck | undefined {
  return workspace.getParsedModel<DssDeck>(uri);
}
