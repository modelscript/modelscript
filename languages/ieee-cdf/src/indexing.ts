// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ieee-cdf — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes IEEE Common Data Format (1973) and BPA IPF (1970s) power-flow decks into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseIeeeCdf } from "./parser/ieee-cdf-parser.js";

export const ieeeCdfIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".cdf") || lower.endsWith(".ieee") || lower.endsWith(".bpa") || lower.endsWith(".ipf")) {
      return true;
    }
    if (!text) return false;
    return (
      /^\s*BUS\s+DATA\s+FOLLOWS/im.test(text) ||
      /^\s*BRANCH\s+DATA\s+FOLLOWS/im.test(text) ||
      /^\s*\(POWERFLOW/im.test(text)
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const network = parseIeeeCdf(ctx.text);
    ctx.setParsedModel(network);

    const rootName = network.title.caseId || "IEEE_CDF_Network";
    const rootId = ctx.addSymbol(
      rootName,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        format: network.format,
        mvaBase: network.title.mvaBase,
        busCount: network.buses.length,
        branchCount: network.branches.length,
      },
      {
        ruleName: "network",
        namePath: "name",
      },
    );

    for (const bus of network.buses) {
      const label = `Bus_${bus.busNumber} (${bus.name})`;
      ctx.addSymbol(
        label,
        "Class",
        rootId,
        bus.startOffset ?? 0,
        bus.endOffset ?? 0,
        {
          busNumber: bus.busNumber,
          busType: bus.type,
          baseKv: bus.baseKv,
        },
        {
          ruleName: "bus",
          namePath: "name",
          aliases: [String(bus.busNumber), bus.name],
        },
      );
    }

    for (const br of network.branches) {
      const label = `Branch_${br.fromBus}_${br.toBus}_${br.circuit}`;
      ctx.addSymbol(
        label,
        "Component",
        rootId,
        br.startOffset ?? 0,
        br.endOffset ?? 0,
        {
          fromBus: br.fromBus,
          toBus: br.toBus,
          circuit: br.circuit,
          branchType: br.type,
        },
        {
          ruleName: "branch",
          namePath: "name",
        },
      );
    }
  },
};
