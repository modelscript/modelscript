// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sinda — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes NASA SINDA / SINDA-FLUINT thermal network decks (.sin, .sinda, .sdo, .inp, .dat)
 * into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseSindaDeck } from "./parser/deck-parser.js";

export const sindaIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".sin") || lower.endsWith(".sinda") || lower.endsWith(".sdo")) {
      return true;
    }
    if (!text) return false;
    return /^\s*HEADER\s+(?:OPTIONS|NODE|CONDUCTOR|CONSTANTS|SOURCE|EXECUTION)\b/im.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const model = parseSindaDeck(ctx.text);
    ctx.setParsedModel(model);

    const rootId = ctx.addSymbol(
      model.title,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        nodeCount: model.nodes.size,
        conductorCount: model.conductors.size,
      },
      {
        ruleName: "SindaDeck",
        namePath: "title",
      },
    );

    for (const node of model.nodes.values()) {
      ctx.addSymbol(
        `N${node.id} [${node.kind}]`,
        "Component",
        rootId,
        node.startOffset ?? 0,
        node.endOffset ?? 0,
        {
          nodeId: node.id,
          kind: node.kind,
          initialTemp: node.initialTemp,
          capacitance: node.capacitance,
          submodel: node.submodel,
        },
        {
          ruleName: "NodeRecord",
          namePath: `N${node.id}`,
          aliases: [String(node.id), `T_${node.id}`],
        },
      );
    }

    for (const cond of model.conductors.values()) {
      ctx.addSymbol(
        `G${cond.id} [${cond.kind}]`,
        "Component",
        rootId,
        cond.startOffset ?? 0,
        cond.endOffset ?? 0,
        {
          conductorId: cond.id,
          kind: cond.kind,
          nodeI: cond.nodeI,
          nodeJ: cond.nodeJ,
          conductance: cond.conductance,
        },
        {
          ruleName: "ConductorRecord",
          namePath: `G${cond.id}`,
          aliases: [String(cond.id)],
        },
      );
    }
  },
};
