/* eslint-disable @typescript-eslint/no-explicit-any */
import { LSPBridge } from "@modelscript/compiler";
import { Connection, Definition, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { symbolEntryToLocation } from "../utils/lspUtils";

function isStepDocument(document: TextDocument): boolean {
  return document.languageId === "step" || /\.(step|stp|p21)$/i.test(document.uri);
}

export function registerDefinitionProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  documentLSPBridges: Map<string, LSPBridge>,
  documentTrees: Map<string, any>,
) {
  connection.onDefinition((params): Definition | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const offset = document.offsetAt(params.position);

    // ── STEP-specific go-to-definition (does NOT require an LSPBridge) ──
    if (isStepDocument(document)) {
      const text = document.getText();
      let start = offset;
      while (start > 0 && /[0-9#]/.test(text[start - 1])) start--;
      let end = offset;
      while (end < text.length && /[0-9]/.test(text[end])) end++;

      const token = text.slice(start, end);
      if (/^#\d+$/.test(token)) {
        const defRegex = new RegExp(`^${token.replace("#", "\\#")}\\s*=`, "m");
        const match = defRegex.exec(text);
        if (match) {
          return {
            uri: document.uri,
            range: {
              start: document.positionAt(match.index),
              end: document.positionAt(match.index + match[0].length),
            },
          };
        }
      }
      return null; // STEP file — don't fall through to bridge
    }

    // ── Standard polyglot go-to-definition (requires bridge) ──
    const bridge = documentLSPBridges.get(params.textDocument.uri);
    if (!bridge) return null;

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
