// SPDX-License-Identifier: AGPL-3.0-or-later

import { Connection, TextDocuments, TextEdit } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";

export { formatModelicaTree, restructureModelicaTree, type ModelicaFormatOptions } from "@modelscript/modelica";
export { formatStepDocument } from "@modelscript/step";

export function registerFormattingProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  getDocumentTree: (uri: string) => any,
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
