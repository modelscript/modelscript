/* eslint-disable @typescript-eslint/no-explicit-any */
import { LSPBridge } from "@modelscript/compiler";
import { Connection, Definition, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { symbolEntryToLocation } from "../utils/lspUtils";

export function registerDefinitionProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  documentLSPBridges: Map<string, LSPBridge>,
  documentTrees: Map<string, any>,
) {
  connection.onDefinition((params): Definition | null => {
    const document = documents.get(params.textDocument.uri);
    const bridge = documentLSPBridges.get(params.textDocument.uri);
    if (!document || !bridge) return null;

    const offset = document.offsetAt(params.position);
    const rawTarget = (bridge as any).definitionRaw(offset);
    if (!rawTarget) return null;
    return symbolEntryToLocation(rawTarget, documentLSPBridges, documentTrees) as any;
  });

  /* Go to Type Definition — jumps to the class definition of a component's type */
  connection.onTypeDefinition((params): Definition | null => {
    const document = documents.get(params.textDocument.uri);
    const bridge = documentLSPBridges.get(params.textDocument.uri);
    if (!document || !bridge) return null;

    const offset = document.offsetAt(params.position);
    const typeTarget = (bridge as any).typeDefinitionRaw(offset);
    if (!typeTarget) return null;

    return symbolEntryToLocation(typeTarget, documentLSPBridges, documentTrees) as any;
  });
}
