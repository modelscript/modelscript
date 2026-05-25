import { LSPBridge } from "@modelscript/compiler";
import { CompletionItem, CompletionItemKind, Connection, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { keywords, typeKeywords } from "../utils/keywords";

export function registerCompletionProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  documentLSPBridges: Map<string, LSPBridge>,
) {
  connection.onCompletion((params): CompletionItem[] => {
    // NOTE: We intentionally do NOT call flushValidation() here.
    // The bridge/resolver already have valid state from the last validation cycle.
    // Flushing synchronously blocks the completion response while the full
    // parse → index → resolve → lint pipeline runs, causing "loading..." hangs.
    const document = documents.get(params.textDocument.uri);
    const bridge = documentLSPBridges.get(params.textDocument.uri);
    if (!document || !bridge) return [];

    const text = document.getText();
    const offset = document.offsetAt(params.position);
    const items = bridge.completion(offset, text) as unknown as CompletionItem[];

    if (items.length > 0) {
      return items;
    }

    // Fallback: keyword completions (language-specific)
    if (params.textDocument.uri.endsWith(".sysml")) {
      const sysml2Keywords = [
        // Structural
        "package",
        "part",
        "part def",
        "attribute",
        "attribute def",
        "port",
        "port def",
        "item",
        "item def",
        "enum def",
        "occurrence",
        "occurrence def",
        // Behavioral
        "action",
        "action def",
        "state",
        "state def",
        "calc",
        "calc def",
        "transition",
        "accept",
        "send",
        "assign",
        "perform",
        "exhibit",
        // Requirements
        "requirement",
        "requirement def",
        "constraint",
        "constraint def",
        "concern",
        "concern def",
        "assume",
        "require",
        // Analysis
        "use case",
        "use case def",
        "case",
        "case def",
        "analysis",
        "analysis case",
        "verification",
        // Interconnection
        "connection",
        "connection def",
        "connect",
        "interface",
        "interface def",
        "allocation",
        "allocation def",
        "flow",
        "flow def",
        "binding",
        "succession",
        // Views
        "view",
        "view def",
        "viewpoint",
        "viewpoint def",
        "rendering",
        "rendering def",
        // Modifiers
        "abstract",
        "readonly",
        "derived",
        "end",
        "ordered",
        "nonunique",
        "in",
        "out",
        "inout",
        "ref",
        "redefines",
        "subsets",
        "specializes",
        // Control
        "if",
        "else",
        "while",
        "for",
        "loop",
        "return",
        // Types
        "Boolean",
        "Integer",
        "Real",
        "String",
        "Natural",
        // Meta
        "import",
        "alias",
        "doc",
        "comment",
        "about",
        "actor",
        "stakeholder",
        "subject",
        "objective",
      ];
      return sysml2Keywords.map((kw, index) => ({
        label: kw,
        kind: CompletionItemKind.Keyword,
        data: index,
        // Provide snippets for definition keywords
        ...(kw.endsWith(" def")
          ? {
              insertText: `${kw} $1 {\n\t$0\n}`,
              insertTextFormat: 2, // Snippet
            }
          : {}),
      }));
    }

    const allKeywords = [...keywords, ...typeKeywords];
    return allKeywords.map((kw, index) => ({
      label: kw,
      kind: CompletionItemKind.Keyword,
      data: index,
    }));
  });
}
