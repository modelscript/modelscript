// SPDX-License-Identifier: AGPL-3.0-or-later

import { Connection, TextDocuments, TextEdit } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";

import type { Tree } from "../utils/cst-facade.js";
import { formatWasmCstDocument } from "./cst-formatter.js";

export { formatModelicaTree, restructureModelicaTree, type ModelicaFormatOptions } from "@modelscript/modelica";
export { formatStepDocument } from "@modelscript/step";

type FormattingTreeLike = Tree & {
  rootPtr?: number;
  rootNode: Tree["rootNode"] & { id?: number; ptr?: number };
};

export function registerFormattingProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  getDocumentTree: (uri: string) => Tree | { tree?: Tree | null } | null | undefined,
  isParserReady: () => boolean,
) {
  connection.onDocumentFormatting(async (params): Promise<TextEdit[]> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const plugin =
      globalLanguageRegistry.getPluginForUri(params.textDocument.uri, document.getText()) ??
      globalLanguageRegistry.getPluginById(document.languageId);
    if (plugin?.customHandlers?.format) {
      const edits = await plugin.customHandlers.format(document, params.options, {
        getDocumentTree,
        isParserReady,
      });
      if (Array.isArray(edits)) return edits;
    }
    const facade = plugin?.facade as
      | {
          formatDocument?: (rootPtr: number, indentSize?: number) => string | TextEdit[] | null;
          loadSource?: (src: string) => void;
        }
      | undefined;
    if (facade && typeof facade.formatDocument === "function") {
      try {
        const cached = getDocumentTree(params.textDocument.uri);
        const tree = (cached && "tree" in cached ? cached.tree : cached) as FormattingTreeLike | null | undefined;
        const rootPtr = tree?.rootNode?.id ?? tree?.rootNode?.ptr ?? tree?.rootPtr ?? 0;
        if (rootPtr) {
          facade.loadSource?.(document.getText());
          const formatted = facade.formatDocument(rootPtr, params.options?.tabSize ?? 2);
          if (Array.isArray(formatted)) return formatted;
          if (typeof formatted === "string" && formatted.length > 0 && formatted !== document.getText()) {
            return [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: document.positionAt(document.getText().length),
                },
                newText: formatted,
              },
            ];
          }
        }
      } catch {
        // Ignore WASM formatting fallback errors
      }
    }
    try {
      const cached = getDocumentTree(params.textDocument.uri);
      const tree = (cached && "tree" in cached ? cached.tree : cached) as Tree | null | undefined;
      if (tree?.rootNode) {
        const sourceText = document.getText();
        const formatted = formatWasmCstDocument(tree, sourceText, {
          tabSize: params.options?.tabSize,
          insertSpaces: params.options?.insertSpaces,
          languageId: plugin?.id ?? document.languageId,
          uri: params.textDocument.uri,
        });
        if (formatted !== sourceText) {
          return [
            {
              range: {
                start: { line: 0, character: 0 },
                end: document.positionAt(sourceText.length),
              },
              newText: formatted,
            },
          ];
        }
      }
    } catch {
      // Ignore generic CST formatting fallback errors
    }
    return [];
  });

  connection.onDocumentRangeFormatting(async (params): Promise<TextEdit[]> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const plugin =
      globalLanguageRegistry.getPluginForUri(params.textDocument.uri, document.getText()) ??
      globalLanguageRegistry.getPluginById(document.languageId);
    if (plugin?.customHandlers?.rangeFormat) {
      const edits = await plugin.customHandlers.rangeFormat(document, params.range, params.options, {
        getDocumentTree,
        isParserReady,
      });
      if (Array.isArray(edits)) return edits;
    }
    return [];
  });
}
