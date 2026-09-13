// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileDslToWasm } from "@modelscript/dsl";
import { createWasmParser } from "@modelscript/dsl/bindings";
import {
  CompletionRequest,
  DefinitionRequest,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  Disposable,
  DocumentSymbolRequest,
  FoldingRangeRequest,
  HoverRequest,
  TextDocumentSyncKind,
  type Connection,
  type TextDocuments,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry, type LanguagePlugin } from "../registry/LanguageRegistry.js";

export interface RegisterLanguageRequest {
  id: string;
  name?: string;
  extensions?: string[];
  wasmBytes?: number[] | Uint8Array | string;
  monarch?: any;
  textmate?: any;
  languageDef?: any;
}

export interface ReloadLanguageRequest {
  id: string;
  wasmBytes?: number[] | Uint8Array | string;
  monarch?: any;
  languageDef?: any;
}

export interface UnregisterLanguageRequest {
  id: string;
}

/**
 * Registers dynamic polyglot runtime management JSON-RPC endpoints on the LSP connection:
 * - `modelscript/registerLanguage`: Compiles or hot-loads a new DSL into WASM, registers capabilities.
 * - `modelscript/reloadLanguage`: Atomic hot-swap of WASM bytecode and Monarch tokens.
 * - `modelscript/unregisterLanguage`: Disposes dynamic capabilities and unloads the language.
 * - `modelscript/listLanguages`: Lists all active language plugins.
 */
export function registerPolyglotEndpoints(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  validationService: any,
  documentManager: any,
  workspaceManager?: any,
) {
  // ── 1. Register Language (Dynamic Compile / Load) ────────────────────────
  connection.onRequest("modelscript/registerLanguage", async (params: RegisterLanguageRequest) => {
    try {
      connection.console.info(`[polyglot-lsp] Registering language '${params.id}'...`);
      let wasmBytes: Uint8Array | null = null;
      let monarch = params.monarch;
      let textmate = params.textmate;
      let extensions = params.extensions || [];
      const id = params.id.toLowerCase();
      const name = params.name || params.id;

      // Case A: Compile from language definition on-the-fly
      if (params.languageDef) {
        connection.console.info(`[polyglot-lsp] Compiling language '${id}' in-memory via AssemblyScript...`);
        const compiled = await compileDslToWasm(params.languageDef, { extensions });
        wasmBytes = compiled.wasmBytes;
        if (!monarch) monarch = compiled.monarch;
        if (!textmate) textmate = compiled.textmate;
        if (extensions.length === 0) extensions = compiled.extensions;
      } else if (params.wasmBytes) {
        if (typeof params.wasmBytes === "string") {
          // Base64 string
          const binaryStr = atob(params.wasmBytes);
          const len = binaryStr.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          wasmBytes = bytes;
        } else if (Array.isArray(params.wasmBytes)) {
          wasmBytes = new Uint8Array(params.wasmBytes);
        } else if (params.wasmBytes instanceof Uint8Array) {
          wasmBytes = params.wasmBytes;
        }
      }

      if (!wasmBytes) {
        return { success: false, error: "Neither languageDef nor wasmBytes provided" };
      }

      if (extensions.length === 0) {
        extensions = [`.${id}`];
      }

      // Instantiate WASM parser and LspFacade
      const { facade, parser } = await createWasmParser(wasmBytes);

      // Create and register plugin
      const plugin: LanguagePlugin = {
        id,
        name,
        extensions,
        parser,
        facade,
        monarch,
        textmate,
        wasmBytes,
        disposables: [],
      };

      // Register dynamic LSP capabilities with client if supported
      const documentSelector = extensions.map((ext) => ({ pattern: `**/*${ext}` }));
      const disposables: Disposable[] = [];

      try {
        const regOpen = await connection.client.register(DidOpenTextDocumentNotification.type, {
          documentSelector,
        });
        disposables.push(regOpen);
      } catch (e: any) {
        connection.console.warn(`[polyglot-lsp] dynamic register didOpen warning: ${e.message}`);
      }

      try {
        const regChange = await connection.client.register(DidChangeTextDocumentNotification.type, {
          documentSelector,
          syncKind: TextDocumentSyncKind.Full,
        });
        disposables.push(regChange);
      } catch (e: any) {
        connection.console.warn(`[polyglot-lsp] dynamic register didChange warning: ${e.message}`);
      }

      try {
        const regComp = await connection.client.register(CompletionRequest.type, {
          documentSelector,
          triggerCharacters: [".", ":", " "],
        });
        disposables.push(regComp);
      } catch {}

      try {
        const regHover = await connection.client.register(HoverRequest.type, { documentSelector });
        disposables.push(regHover);
      } catch {}

      try {
        const regDef = await connection.client.register(DefinitionRequest.type, { documentSelector });
        disposables.push(regDef);
      } catch {}

      try {
        const regSym = await connection.client.register(DocumentSymbolRequest.type, { documentSelector });
        disposables.push(regSym);
      } catch {}

      try {
        const regFold = await connection.client.register(FoldingRangeRequest.type, { documentSelector });
        disposables.push(regFold);
      } catch {}

      plugin.disposables = disposables;
      globalLanguageRegistry.register(plugin);

      // Notify client to register Monaco Monarch syntax highlighting & tokenizer
      connection.sendNotification("modelscript/languageRegistered", {
        id: plugin.id,
        name: plugin.name,
        extensions: plugin.extensions,
        monarch: plugin.monarch,
      });

      // Validate any open documents matching the newly registered extensions
      for (const doc of documents.all()) {
        if (plugin.extensions.some((ext) => doc.uri.endsWith(ext))) {
          connection.console.info(
            `[polyglot-lsp] Early-validating open document '${doc.uri}' for new language '${id}'`,
          );
          if (validationService?.validateTextDocument) {
            await validationService.validateTextDocument(doc);
          }
        }
      }

      connection.console.info(
        `[polyglot-lsp] Language '${id}' registered successfully with extensions: ${extensions.join(", ")}`,
      );
      return {
        success: true,
        id: plugin.id,
        extensions: plugin.extensions,
      };
    } catch (err: any) {
      connection.console.error(`[polyglot-lsp] Failed to register language: ${err?.message || err}`);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── 2. Reload Language (Atomic Hot-Swap) ──────────────────────────────────
  connection.onRequest("modelscript/reloadLanguage", async (params: ReloadLanguageRequest) => {
    try {
      const id = params.id.toLowerCase();
      const existing = globalLanguageRegistry.getPluginById(id);
      if (!existing) {
        return { success: false, error: `Language '${id}' is not registered` };
      }

      connection.console.info(`[polyglot-lsp] Hot-reloading language '${id}'...`);
      let wasmBytes: Uint8Array | null = null;
      let monarch = params.monarch || existing.monarch;

      if (params.languageDef) {
        const compiled = await compileDslToWasm(params.languageDef, { extensions: existing.extensions });
        wasmBytes = compiled.wasmBytes;
        if (compiled.monarch) monarch = compiled.monarch;
      } else if (params.wasmBytes) {
        if (Array.isArray(params.wasmBytes)) {
          wasmBytes = new Uint8Array(params.wasmBytes);
        } else if (params.wasmBytes instanceof Uint8Array) {
          wasmBytes = params.wasmBytes;
        }
      } else if (existing.wasmBytes) {
        wasmBytes = existing.wasmBytes;
      }

      if (!wasmBytes) {
        return { success: false, error: "No WASM bytecode available for reload" };
      }

      // Re-instantiate WASM parser
      const { facade, parser } = await createWasmParser(wasmBytes);
      existing.parser = parser;
      existing.facade = facade;
      existing.monarch = monarch;
      existing.wasmBytes = wasmBytes;

      // Invalidate tree caches in documentManager for this language's files
      for (const [uri] of documentManager.documentTrees) {
        if (existing.extensions.some((ext) => uri.endsWith(ext))) {
          documentManager.documentTrees.delete(uri);
        }
      }

      // Notify client of updated Monarch syntax tokens
      connection.sendNotification("modelscript/languageRegistered", {
        id: existing.id,
        name: existing.name,
        extensions: existing.extensions,
        monarch: existing.monarch,
      });

      // Re-validate all open documents of this language
      for (const doc of documents.all()) {
        if (existing.extensions.some((ext) => doc.uri.endsWith(ext))) {
          if (validationService?.validateTextDocument) {
            await validationService.validateTextDocument(doc);
          }
        }
      }

      connection.console.info(`[polyglot-lsp] Language '${id}' hot-reloaded successfully.`);
      return { success: true, id };
    } catch (err: any) {
      connection.console.error(`[polyglot-lsp] Failed to reload language: ${err?.message || err}`);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── 3. Unregister Language ───────────────────────────────────────────────
  connection.onRequest("modelscript/unregisterLanguage", async (params: UnregisterLanguageRequest) => {
    try {
      const id = params.id.toLowerCase();
      const existing = globalLanguageRegistry.getPluginById(id);
      if (!existing) {
        return { success: false, error: `Language '${id}' is not registered` };
      }

      connection.console.info(`[polyglot-lsp] Unregistering language '${id}'...`);
      const extensions = [...existing.extensions];

      // Unregister from registry (disposes dynamic capability handles)
      await globalLanguageRegistry.unregister(id);

      // Unregister from UnifiedWorkspace if present
      if (workspaceManager?.unifiedWorkspace?.unregisterWorkspace) {
        workspaceManager.unifiedWorkspace.unregisterWorkspace(id);
      }

      // Notify client to unregister syntax tokens
      connection.sendNotification("modelscript/languageUnregistered", {
        id,
        extensions,
      });

      // Clear diagnostics for all open documents of this language
      for (const doc of documents.all()) {
        if (extensions.some((ext) => doc.uri.endsWith(ext))) {
          connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
          documentManager.documentTrees.delete(doc.uri);
        }
      }

      connection.console.info(`[polyglot-lsp] Language '${id}' unregistered successfully.`);
      return { success: true, id, extensions };
    } catch (err: any) {
      connection.console.error(`[polyglot-lsp] Failed to unregister language: ${err?.message || err}`);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // ── 4. List Registered Languages ─────────────────────────────────────────
  connection.onRequest("modelscript/listLanguages", () => {
    const plugins = globalLanguageRegistry.getAllPlugins();
    return plugins.map((p) => ({
      id: p.id,
      name: p.name,
      extensions: p.extensions,
      hasParser: !!p.parser,
      hasMonarch: !!p.monarch,
    }));
  });
}
