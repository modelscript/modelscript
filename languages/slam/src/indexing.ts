// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/slam — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes SLAM II simulation decks (.slam, .slm, .inp, .dat) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseSlamDeck } from "./parser/slam-parser.js";

export const slamIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".slam") || lower.endsWith(".slm")) {
      return true;
    }
    if (!text) return false;
    return (
      /^\s*GEN\s*,/im.test(text) &&
      (/\bNETWORK\b/i.test(text) || /\bCONTINUOUS\b/i.test(text) || /\bLIMITS\b/i.test(text))
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const model = parseSlamDeck(ctx.text);
    ctx.setParsedModel(model);

    const rootId = ctx.addSymbol(
      model.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        analyst: model.gen?.analyst,
        project: model.gen?.project,
      },
      {
        ruleName: "model",
        namePath: "name",
      },
    );

    // Index network nodes (resources, gates, labeled nodes, detectors)
    for (const node of model.nodes) {
      const displayName = node.label
        ? `${node.label} [${node.type}]`
        : node.resourceName && node.type === "RESOURCE"
          ? `${node.resourceName} [RESOURCE]`
          : node.gateName && node.type === "GATE"
            ? `${node.gateName} [GATE]`
            : `${node.id} [${node.type}]`;

      const aliases: string[] = [node.id];
      if (node.label) aliases.push(node.label);
      if (node.resourceName && node.type === "RESOURCE") aliases.push(node.resourceName);
      if (node.gateName && node.type === "GATE") aliases.push(node.gateName);

      ctx.addSymbol(
        displayName,
        "Class",
        rootId,
        node.span.startOffset,
        node.span.endOffset,
        {
          nodeType: node.type,
          label: node.label,
          resourceName: node.resourceName,
          gateName: node.gateName,
        },
        {
          ruleName: "node",
          namePath: "name",
          aliases,
        },
      );
    }

    // Index continuous state equations
    for (const eq of model.stateEquations) {
      const stateName = `${eq.lhsKind}(${eq.index})`;
      ctx.addSymbol(
        stateName,
        "Variable",
        rootId,
        eq.span.startOffset,
        eq.span.endOffset,
        {
          lhsKind: eq.lhsKind,
          index: eq.index,
        },
        {
          ruleName: "stateEquation",
          namePath: "name",
        },
      );
    }
  },
};
