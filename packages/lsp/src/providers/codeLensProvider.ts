import { CodeLens, Range } from "vscode-languageserver";
import type { LspContext } from "../LspContext";

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
      // Find classes with the "study" kind
      // @ts-expect-error missing type properties
      if (symbol.classKind === "study" && symbol.name) {
        // We only want the top-level declaration range, not the whole body
        const range = Range.create(
          // @ts-expect-error missing type properties
          symbol.selectionRange?.start.line ?? symbol.range.start.line,
          // @ts-expect-error missing type properties
          symbol.selectionRange?.start.character ?? symbol.range.start.character,
          // @ts-expect-error missing type properties
          symbol.selectionRange?.start.line ?? symbol.range.start.line,
          // @ts-expect-error missing type properties
          symbol.selectionRange?.start.character ?? symbol.range.start.character,
        );

        lenses.push({
          range,
          command: {
            title: "▶ Run Study",
            command: "modelscript.openSimulationView",
            arguments: [uri, symbol.name],
          },
        });
      }
    }

    return lenses;
  });
}
