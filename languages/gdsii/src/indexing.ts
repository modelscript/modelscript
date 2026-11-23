// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gdsii — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes GDSII GDT/ASCII stream files (`.gdt`, `.gds.txt`, `.gdsii`) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseGdsiiAscii } from "./parser/gdt-parser.js";

export const gdsiiIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".gdt") || lower.endsWith(".gdsii") || lower.endsWith(".gds.txt")) {
      return true;
    }
    if (!text) return false;
    return /\bBGNLIB\b/i.test(text) && /\bLIBNAME\b/i.test(text) && /\bENDLIB\b/i.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const library = parseGdsiiAscii(ctx.text);
    ctx.setParsedModel(library);

    // Library root symbol (Kind "Package")
    const libRootId = ctx.addSymbol(
      library.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        version: library.version,
        dbUnitInMeters: library.units.dbUnitInMeters,
        structureCount: library.structures.length,
      },
      {
        ruleName: "Library",
        namePath: "name",
      },
    );

    // Structure / Cell symbols (Kind "Class")
    for (const struct of library.structures) {
      ctx.addSymbol(
        struct.name,
        "Class",
        libRootId,
        struct.startOffset ?? 0,
        struct.endOffset ?? ctx.text.length,
        {
          elementCount: struct.elements.length,
        },
        {
          ruleName: "Structure",
          namePath: "name",
        },
      );
    }
  },
};
