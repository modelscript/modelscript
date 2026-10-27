// SPDX-License-Identifier: AGPL-3.0-or-later

import { InlayHint, InlayHintKind, Position, Range } from "vscode-languageserver";
import type { LspContext } from "../lsp-context.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";

export function registerInlayHintProvider(context: LspContext) {
  context.connection.onRequest(
    "textDocument/inlayHint",
    (params: { textDocument: { uri: string }; range: Range }): InlayHint[] => {
      const uri = params.textDocument.uri;
      const hints: InlayHint[] = [];

      const inlayCfg = context.settings?.inlayHints;
      if (inlayCfg?.enabled === false) {
        return hints;
      }
      const showUnitsAndBounds = inlayCfg?.unitsAndBounds ?? true;
      const showVariabilityPrefixes = inlayCfg?.variabilityPrefixes ?? false;

      const document = context.documents.get(uri);
      if (!document) return hints;

      const plugin = globalLanguageRegistry.getPluginForLanguageIdOrUri(document.languageId, uri);
      if (plugin && !globalLanguageRegistry.isLanguageEnabled(plugin.id)) {
        return hints;
      }

      const fileIndex =
        context.workspaceManager.getWorkspaceIndex("modelica")?.getFileIndex(uri) ??
        context.workspaceManager.getWorkspaceIndex("sysml2")?.getFileIndex(uri);

      if (!fileIndex) return hints;

      const { start: reqStart, end: reqEnd } = params.range;

      for (const [, symbol] of fileIndex.symbols.entries()) {
        const sym = symbol as any;
        if (!sym.name) continue;

        let symStart = sym.selectionRange?.start ?? sym.range?.start;
        let symEnd = sym.selectionRange?.end ?? sym.range?.end;
        if (!symStart && (sym.startOffset !== undefined || sym.startOffset !== undefined)) {
          symStart = document.positionAt(sym.startOffset);
        }
        if (!symEnd && (sym.endOffset !== undefined || sym.endOffset !== undefined)) {
          symEnd = document.positionAt(sym.endOffset);
        }
        if (!symStart || !symEnd) continue;

        // Filter to requested visible range
        if (symEnd.line < reqStart.line || symStart.line > reqEnd.line) {
          continue;
        }

        // 1. Parameter Unit Inlay Hint (e.g. `R = 100` -> ` [Ω]`)
        if (showUnitsAndBounds) {
          const unit = sym.metadata?.unit ?? sym.metadata?.displayUnit;
          if (unit && typeof unit === "string") {
            hints.push({
              position: Position.create(symEnd.line, symEnd.character),
              label: ` [${unit}]`,
              kind: InlayHintKind.Type,
              paddingLeft: true,
            });
          }
        }

        // 2. Inferred Causality/Flow Inlay Hint (e.g. `in` / `out`)
        if (showVariabilityPrefixes || inlayCfg?.variabilityPrefixes === undefined) {
          const causality = sym.metadata?.causality;
          if (causality && (causality === "input" || causality === "output")) {
            hints.push({
              position: Position.create(symStart.line, symStart.character),
              label: `${causality} `,
              kind: InlayHintKind.Parameter,
              paddingRight: true,
            });
          }
        }
      }

      return hints;
    },
  );
}
