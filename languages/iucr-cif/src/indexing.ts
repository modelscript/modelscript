// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `@modelscript/iucr-cif` — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes IUCr CIF / STAR 1.1 crystal structures (`.cif`, `.mcif`, `.star`) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { extractCrystalStructure, parseIucrCif } from "./parser/cif-parser.js";

export const iucrCifIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".cif") || lower.endsWith(".mcif") || lower.endsWith(".star")) {
      return true;
    }
    if (!text) return false;
    return /^\s*data_[A-Za-z0-9_-]+/im.test(text) && /_cell_length_a|_atom_site_fract_x/i.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseIucrCif(ctx.text);
    ctx.setParsedModel(doc);

    for (const block of doc.blocks) {
      const blockRootId = ctx.addSymbol(
        `data_${block.name}`,
        "Package",
        null,
        block.startOffset,
        block.endOffset,
        {
          blockName: block.name,
          tagCount: block.tagEntries.length,
          loopCount: block.loops.length,
        },
        {
          ruleName: "DataBlock",
          namePath: "name",
          aliases: [block.name],
        },
      );

      const structure = extractCrystalStructure(block);
      if (structure) {
        for (const atom of structure.asymmetricAtoms) {
          ctx.addSymbol(
            `${atom.label} [${atom.symbol}]`,
            "Class",
            blockRootId,
            block.startOffset,
            block.endOffset,
            {
              label: atom.label,
              symbol: atom.symbol,
              fractX: atom.fractX,
              fractY: atom.fractY,
              fractZ: atom.fractZ,
              occupancy: atom.occupancy,
            },
            {
              ruleName: "AtomSite",
              namePath: "label",
              aliases: [atom.label],
            },
          );
        }
      }
    }
  },
};
