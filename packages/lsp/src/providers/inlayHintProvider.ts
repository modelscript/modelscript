import { InlayHint, InlayHintKind, Position, Range } from "vscode-languageserver";
import type { LspContext } from "../LspContext.js";

export function registerInlayHintProvider(context: LspContext) {
  context.connection.onRequest(
    "textDocument/inlayHint",
    (params: { textDocument: { uri: string }; range: Range }): InlayHint[] => {
      const uri = params.textDocument.uri;
      const hints: InlayHint[] = [];
      const document = context.documents.get(uri);
      if (!document) return hints;

      const fileIndex =
        context.workspaceManager.globalWorkspaceIndex.getFileIndex(uri) ??
        context.workspaceManager.sysml2WorkspaceIndex.getFileIndex(uri);

      if (!fileIndex) return hints;

      const { start: reqStart, end: reqEnd } = params.range;

      for (const [, symbol] of fileIndex.symbols.entries()) {
        const sym = symbol as any;
        if (!sym.name || (!sym.selectionRange && !sym.range)) continue;

        const symStart = sym.selectionRange?.start ?? sym.range?.start;
        const symEnd = sym.selectionRange?.end ?? sym.range?.end;
        if (!symStart || !symEnd) continue;

        // Filter to requested visible range
        if (symEnd.line < reqStart.line || symStart.line > reqEnd.line) {
          continue;
        }

        // 1. Parameter Unit Inlay Hint (e.g. `R = 100` -> ` [Ω]`)
        const unit = sym.metadata?.unit ?? sym.metadata?.displayUnit;
        if (unit && typeof unit === "string") {
          hints.push({
            position: Position.create(symEnd.line, symEnd.character),
            label: ` [${unit}]`,
            kind: InlayHintKind.Type,
            paddingLeft: true,
          });
        }

        // 2. Inferred Causality/Flow Inlay Hint (e.g. `in` / `out`)
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

      return hints;
    },
  );
}
