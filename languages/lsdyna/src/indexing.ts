// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lsdyna — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes LS-DYNA / DYNA3D explicit dynamics keyword decks (.k, .key, .dyn) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseLsDynaDeck } from "./parser/deck-parser.js";

export const lsdynaIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".k") || lower.endsWith(".key") || lower.endsWith(".dyn")) {
      return true;
    }
    if (!text) return false;
    return (
      /^\s*\*KEYWORD\b/im.test(text) || (/^\s*\*PART\b/im.test(text) && /^\s*\*CONTROL_TERMINATION\b/im.test(text))
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const deck = parseLsDynaDeck(ctx.text);
    ctx.setParsedModel(deck);

    // Deck root symbol
    const rootId = ctx.addSymbol(
      deck.title || "LsDynaDeck",
      "Package",
      null,
      0,
      ctx.text.length,
      {
        nodeCount: deck.nodes.size,
        elementCount: deck.elements.size,
        partCount: deck.parts.size,
      },
      {
        ruleName: "Deck",
        namePath: "title",
      },
    );

    // Parts
    for (const part of deck.parts.values()) {
      ctx.addSymbol(
        `PART_${part.pid}`,
        "Class",
        rootId,
        part.loc?.startOffset ?? 0,
        part.loc?.endOffset ?? 0,
        {
          pid: part.pid,
          secid: part.secid,
          mid: part.mid,
          title: part.title,
        },
        {
          ruleName: "PartCard",
          namePath: "pid",
          aliases: part.title ? [part.title] : [],
        },
      );
    }

    // Materials
    for (const mat of deck.materials.values()) {
      ctx.addSymbol(
        `MAT_${mat.mid}`,
        "Class",
        rootId,
        mat.loc?.startOffset ?? 0,
        mat.loc?.endOffset ?? 0,
        {
          mid: mat.mid,
          type: mat.type,
          ro: mat.ro,
          e: mat.e,
          pr: mat.pr,
        },
        {
          ruleName: "MaterialCard",
          namePath: "mid",
        },
      );
    }

    // Sections
    for (const sec of deck.sections.values()) {
      ctx.addSymbol(
        `SECTION_${sec.secid}`,
        "Class",
        rootId,
        sec.loc?.startOffset ?? 0,
        sec.loc?.endOffset ?? 0,
        {
          secid: sec.secid,
          kind: sec.kind,
          elform: sec.elform,
        },
        {
          ruleName: "SectionCard",
          namePath: "secid",
        },
      );
    }
  },
};
