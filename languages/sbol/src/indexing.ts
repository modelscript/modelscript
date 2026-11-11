// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbol — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes Synthetic Biology Open Language documents (.sbol, .ttl) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseSbol } from "./parser/sbol-parser.js";

export const sbolIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".sbol")) return true;
    return Boolean(
      text &&
      (text.includes("sbol:") ||
        text.includes("xmlns:sbol") ||
        text.includes("/sbols/") ||
        text.includes("/sbolns/") ||
        text.includes("<sbol:")),
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    try {
      const doc = parseSbol(ctx.text, ctx.uri);
      ctx.setParsedModel(doc);

      const rootId = ctx.addSymbol(
        "SbolDocument",
        "package",
        null,
        0,
        ctx.text.length,
        {
          namespace: doc.namespace,
          componentCount: doc.components.length,
          sequenceCount: doc.sequences.length,
          interactionCount: doc.interactions.length,
        },
        {
          ruleName: "sbol_symbol",
          namePath: "SbolDocument",
        },
      );

      for (const comp of doc.components) {
        const start = comp.range?.startOffset ?? 0;
        const end = comp.range?.endOffset ?? 50;
        const compId = ctx.addSymbol(
          comp.displayId,
          "class",
          rootId,
          start,
          end,
          {
            name: comp.name,
            roles: comp.roles,
            types: comp.types,
            sequences: comp.sequences,
          },
          {
            ruleName: "sbol_symbol",
            namePath: comp.displayId,
          },
        );

        for (const sub of comp.subComponents) {
          ctx.addSymbol(
            sub.displayId,
            "property",
            compId,
            sub.range?.startOffset ?? start,
            sub.range?.endOffset ?? end,
            {
              instanceOf: sub.instanceOf,
              roles: sub.roles,
            },
            {
              ruleName: "sbol_symbol",
              namePath: sub.displayId,
            },
          );
        }

        for (const feat of comp.features) {
          ctx.addSymbol(
            feat.displayId,
            "field",
            compId,
            feat.range?.startOffset ?? start,
            feat.range?.endOffset ?? end,
            {
              roles: feat.roles,
              start: feat.start,
              end: feat.end,
            },
            {
              ruleName: "sbol_symbol",
              namePath: feat.displayId,
            },
          );
        }
      }

      for (const seq of doc.sequences) {
        const start = seq.range?.startOffset ?? 0;
        const end = seq.range?.endOffset ?? 50;
        ctx.addSymbol(
          seq.displayId,
          "constant",
          rootId,
          start,
          end,
          {
            length: seq.elements.length,
            encoding: seq.encoding,
          },
          {
            ruleName: "sbol_symbol",
            namePath: seq.displayId,
          },
        );
      }

      for (const inter of doc.interactions) {
        const start = inter.range?.startOffset ?? 0;
        const end = inter.range?.endOffset ?? 50;
        ctx.addSymbol(
          inter.displayId,
          "function",
          rootId,
          start,
          end,
          {
            type: inter.type,
            participants: inter.participants.map((p) => p.participant),
            parameters: inter.parameters,
          },
          {
            ruleName: "sbol_symbol",
            namePath: inter.displayId,
          },
        );
      }
    } catch {
      // Return partial symbol map if parsing failed
    }
  },
};
