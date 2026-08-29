import { CodeLens, Range } from "vscode-languageserver";
import type { LspContext } from "../LspContext.js";

export function registerCodeLensProvider(context: LspContext) {
  context.connection.onRequest("textDocument/codeLens", (params): CodeLens[] => {
    const uri = params.textDocument.uri;
    const lenses: CodeLens[] = [];

    // Only apply to Modelica files
    if (!uri.endsWith(".mo")) {
      return lenses;
    }

    const index = context.workspaceManager.globalWorkspaceIndex.getFileIndex(uri);
    if (!index) return lenses;

    for (const [, symbol] of index.symbols.entries()) {
      // Find classes with the "study", "model", "block", or "process" kind
      const sym = symbol as any;
      const kind = sym.classKind;
      if ((kind === "study" || kind === "model" || kind === "block" || kind === "process") && sym.name) {
        // We only want the top-level declaration range, not the whole body
        const range = Range.create(
          sym.selectionRange?.start.line ?? sym.range?.start?.line ?? 0,
          sym.selectionRange?.start.character ?? sym.range?.start?.character ?? 0,
          sym.selectionRange?.start.line ?? sym.range?.start?.line ?? 0,
          sym.selectionRange?.start.character ?? sym.range?.start?.character ?? 0,
        );

        const title = kind === "study" ? "▶ Run Study" : `▶ Simulate ${kind}`;

        lenses.push({
          range,
          command: {
            title,
            command: "modelscript.openSimulationView",
            arguments: [uri, symbol.name],
          },
        });
      }
    }

    return lenses;
  });
}
