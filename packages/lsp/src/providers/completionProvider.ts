import { CompletionItem, CompletionItemKind, Connection, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LSPBridge } from "../lsp-bridge.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";

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
    if (!document) return [];

    const bridge = documentLSPBridges.get(params.textDocument.uri);
    const text = document.getText();
    const offset = document.offsetAt(params.position);

    if (!bridge) {
      const plugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri);
      if (plugin) {
        if (plugin.customHandlers?.complete) {
          return plugin.customHandlers.complete(offset, text);
        }
        if (plugin.facade?.getCompletions) {
          try {
            const comps = plugin.facade.getCompletions(offset, text);
            if (comps && comps.length > 0) return comps;
          } catch {}
        }
        if (plugin.monarch?.keywords) {
          return plugin.monarch.keywords.map((kw: string) => ({
            label: kw,
            kind: CompletionItemKind.Keyword,
          }));
        }
      }
      return [];
    }

    const items = bridge.completion(offset, text) as unknown as CompletionItem[];

    if (items.length > 0) {
      return items;
    }

    // Fallback: keyword completions dynamically from language definition or monarch
    const plugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri);
    const kws: string[] =
      (plugin?.languageDef?.keywords as string[]) ??
      (plugin?.monarch?.keywords as string[]) ??
      (plugin?.languageDef?.symbols ? Object.keys(plugin.languageDef.symbols) : []);
    if (Array.isArray(kws) && kws.length > 0) {
      return kws.map((kw: string, index: number) => ({
        label: kw,
        kind: CompletionItemKind.Keyword,
        data: index,
        ...(kw.endsWith(" def")
          ? {
              insertText: `${kw} $1 {\n\t$0\n}`,
              insertTextFormat: 2, // Snippet
            }
          : {}),
      }));
    }

    return [];
  });
}
