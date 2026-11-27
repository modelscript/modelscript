// SPDX-License-Identifier: AGPL-3.0-or-later

import { CompletionItem, CompletionItemKind, Connection, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LSPBridge } from "../lsp-bridge.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import type { CstTreeLike } from "../utils/ast-utils.js";
import type { Tree } from "../utils/cst-facade.js";
import { getWasmCstCompletions } from "./wasm-cst-intelligence.js";

export type CompletionTreeEntryLike =
  { tree?: Tree | CstTreeLike | null | undefined } | Tree | CstTreeLike | null | undefined;

export function registerCompletionProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  documentLSPBridges: Map<string, LSPBridge>,
  documentTrees?: ReadonlyMap<string, CompletionTreeEntryLike>,
) {
  connection.onCompletion((params): CompletionItem[] => {
    // NOTE: We intentionally do NOT call flushValidation() here.
    // The bridge/resolver already have valid state from the last validation cycle.
    // Flushing synchronously blocks the completion response while the full
    // parse → index → resolve → lint pipeline runs, causing "loading..." hangs.
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const text = document.getText();
    const offset = document.offsetAt(params.position);

    const plugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri, text);
    if (plugin?.customHandlers?.complete) {
      const customItems = plugin.customHandlers.complete(offset, text, params.textDocument.uri);
      if (customItems && customItems.length > 0) {
        return customItems;
      }
    }

    const resolveDocTree = (): Tree | null => {
      const entry = documentTrees?.get(params.textDocument.uri);
      if (!entry) return null;
      const tree = "tree" in entry ? entry.tree : entry;
      return tree && "rootNode" in tree && tree.rootNode ? (tree as Tree) : null;
    };

    const bridge = documentLSPBridges.get(params.textDocument.uri);

    if (!bridge) {
      if (plugin) {
        if (plugin.facade?.getCompletions) {
          try {
            const comps = plugin.facade.getCompletions(offset, text);
            if (comps && comps.length > 0) return comps;
          } catch {
            // Facade completion failed; fall back to CST / Monarch keyword completions below.
          }
        }
        const cstItems = getWasmCstCompletions(resolveDocTree(), plugin.facade?.syntaxNames);
        if (plugin.monarch?.keywords) {
          const seen = new Set(cstItems.map((i) => i.label));
          const merged = [...cstItems];
          for (const kw of plugin.monarch.keywords) {
            if (!seen.has(kw)) {
              seen.add(kw);
              merged.push({ label: kw, kind: CompletionItemKind.Keyword });
            }
          }
          if (merged.length > 0) return merged;
        }
        if (cstItems.length > 0) return cstItems;
      } else {
        const cstItems = getWasmCstCompletions(resolveDocTree());
        if (cstItems.length > 0) return cstItems;
      }
      return [];
    }

    const items = bridge.completion(offset, text) as unknown as CompletionItem[];

    if (items.length > 0) {
      return items;
    }

    // Fallback: keyword completions dynamically from language definition or monarch
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

    const cstItems = getWasmCstCompletions(resolveDocTree(), plugin?.facade?.syntaxNames);
    if (cstItems.length > 0) {
      return cstItems;
    }

    return [];
  });
}
