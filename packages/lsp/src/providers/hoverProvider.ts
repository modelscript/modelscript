/* eslint-disable @typescript-eslint/no-explicit-any */
import { LSPBridge } from "@modelscript/compiler";
import { Connection, Hover, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

export function registerHoverProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  documentLSPBridges: Map<string, LSPBridge>,
) {
  connection.onHover((params): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    const bridge = documentLSPBridges.get(params.textDocument.uri);
    if (!document || !bridge) return null;

    const text = document.getText();
    const offset = document.offsetAt(params.position);
    const hoverDef = bridge.hover(offset, text);
    if (!hoverDef) return null;

    return {
      contents: {
        kind: "markdown" as const,
        value: hoverDef.contents,
      },
      range: hoverDef.range as any,
    };
  });
}
