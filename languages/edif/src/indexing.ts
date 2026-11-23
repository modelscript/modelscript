// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `@modelscript/edif` — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes EDIF 2.0.0 netlist files (`.edf`, `.edif`, `.edn`) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseEdif } from "./parser/edif-parser.js";

export const edifIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".edf") || lower.endsWith(".edif") || lower.endsWith(".edn")) {
      return true;
    }
    if (!text) return false;
    return /^\s*\(\s*edif\b/i.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseEdif(ctx.text);
    ctx.setParsedModel(doc);

    const rootId = ctx.addSymbol(
      doc.name,
      "Package",
      null,
      doc.span?.startOffset ?? 0,
      doc.span?.endOffset ?? ctx.text.length,
      {
        edifVersion: doc.edifVersion?.join("."),
        designName: doc.design?.name,
      },
      {
        ruleName: "EdifFile",
        namePath: "name",
      },
    );

    const allLibs = [...doc.externals, ...doc.libraries];
    for (const lib of allLibs) {
      const libId = ctx.addSymbol(
        lib.name,
        "Package",
        rootId,
        lib.span?.startOffset ?? 0,
        lib.span?.endOffset ?? 0,
        { isExternal: lib.isExternal },
        {
          ruleName: lib.isExternal ? "External" : "Library",
          namePath: "name",
        },
      );

      for (const cell of lib.cells) {
        const cellId = ctx.addSymbol(
          cell.name,
          "Class",
          libId,
          cell.span?.startOffset ?? 0,
          cell.span?.endOffset ?? 0,
          { cellType: cell.cellType, library: lib.name },
          {
            ruleName: "Cell",
            namePath: "name",
            aliases: [`${lib.name}.${cell.name}`],
          },
        );

        for (const view of cell.views) {
          for (const inst of view.instances) {
            ctx.addSymbol(
              inst.name,
              "Component",
              cellId,
              inst.span?.startOffset ?? 0,
              inst.span?.endOffset ?? 0,
              {
                cellRef: inst.viewRef.cellName,
                libraryRef: inst.viewRef.libraryName,
                viewRef: inst.viewRef.viewName,
              },
              {
                ruleName: "Instance",
                namePath: "name",
              },
            );
          }

          for (const net of view.nets) {
            ctx.addSymbol(
              net.name,
              "Variable",
              cellId,
              net.span?.startOffset ?? 0,
              net.span?.endOffset ?? 0,
              { pinCount: net.joined.length },
              {
                ruleName: "Net",
                namePath: "name",
              },
            );
          }
        }
      }
    }
  },
};
