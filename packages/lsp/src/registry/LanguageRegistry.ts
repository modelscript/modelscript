// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryEngine } from "@modelscript/runtime";
import type { Disposable } from "vscode-languageserver";

/**
 * Descriptor and runtime handle for a registered language in ModelScript LSP.
 */
export interface LanguagePlugin {
  /** Unique language identifier (e.g. "modelica", "sysml2", "minirobot") */
  id: string;
  /** Human-readable language display name */
  name: string;
  /** Recognized file extensions including dot (e.g. [".mo", ".mos"]) */
  extensions: string[];
  /** Tree-sitter / WASM parser instance */
  parser?: any;
  /** WASM LspFacade providing instant symbols, completions, folding, and AST queries */
  facade?: any;
  /** Monaco Monarch token definition rules for client-side syntax highlighting */
  monarch?: any;
  /** TextMate grammar JSON structure */
  textmate?: any;
  /** Workspace index instance for multi-file cross-referencing */
  workspaceIndex?: any;
  /** Salsa QueryEngine for memoized semantic queries */
  queryEngine?: QueryEngine;
  /** Dynamic LSP capability registrations (client/registerCapability disposables) */
  disposables?: Disposable[];
  /** Compiled WebAssembly bytecode buffer */
  wasmBytes?: Uint8Array;
  /** WebAssembly linear memory reference */
  memory?: WebAssembly.Memory;
  /** Custom language-specific handler overrides */
  customHandlers?: {
    validate?: (doc: any) => Promise<any[]> | any[];
    complete?: (offset: number, text: string) => any[];
    hover?: (offset: number, text: string) => any | null;
    definition?: (offset: number, text: string) => any | null;
    symbols?: (tree: any) => any[];
    folding?: (tree: any) => any[];
  };
}

/**
 * High-performance, thread-safe Language Registry for the ModelScript Polyglot LSP.
 * Enables zero-restart hot-loading, reloading, and unloading of language DSLs at runtime.
 */
export class LanguageRegistry {
  private plugins = new Map<string, LanguagePlugin>();
  private extMap = new Map<string, LanguagePlugin>();

  /**
   * Registers a new language plugin or updates an existing one in-place.
   */
  register(plugin: LanguagePlugin): void {
    const id = plugin.id.toLowerCase();
    const existing = this.plugins.get(id);
    if (existing && !plugin.disposables) {
      plugin.disposables = existing.disposables;
    }
    this.plugins.set(id, plugin);

    for (const ext of plugin.extensions) {
      const normalizedExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
      this.extMap.set(normalizedExt, plugin);
    }
  }

  /**
   * Unregisters a language plugin, disposes its dynamic capabilities, and clears its extension routes.
   */
  async unregister(id: string): Promise<LanguagePlugin | undefined> {
    const normId = id.toLowerCase();
    const plugin = this.plugins.get(normId);
    if (!plugin) return undefined;

    // 1. Dispose dynamic LSP capabilities (sends client/unregisterCapability)
    if (plugin.disposables && plugin.disposables.length > 0) {
      for (const d of plugin.disposables) {
        try {
          d.dispose();
        } catch {}
      }
      plugin.disposables = [];
    }

    // 2. Remove extension mappings
    for (const ext of plugin.extensions) {
      const normalizedExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
      if (this.extMap.get(normalizedExt) === plugin) {
        this.extMap.delete(normalizedExt);
      }
    }

    // 3. Clear linear memory documents if facade supports it
    if (plugin.facade?.exports?.lsp_clearDocuments) {
      try {
        plugin.facade.exports.lsp_clearDocuments();
      } catch {}
    }

    this.plugins.delete(normId);
    return plugin;
  }

  /**
   * Looks up a registered language plugin by its identifier.
   */
  getPluginById(id: string): LanguagePlugin | undefined {
    return this.plugins.get(id.toLowerCase());
  }

  /**
   * Resolves a language plugin by file URI extension.
   */
  getPluginForUri(uri: string): LanguagePlugin | undefined {
    const dotIdx = uri.lastIndexOf(".");
    if (dotIdx === -1) return undefined;
    const ext = uri.slice(dotIdx).toLowerCase();
    return this.extMap.get(ext);
  }

  /**
   * Resolves a language plugin by extension string (e.g. ".mo" or "mo").
   */
  getPluginForExtension(ext: string): LanguagePlugin | undefined {
    const normalized = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    return this.extMap.get(normalized);
  }

  /**
   * Returns all currently active language plugins.
   */
  getAllPlugins(): LanguagePlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Returns all currently registered file extensions.
   */
  getAllExtensions(): string[] {
    return Array.from(this.extMap.keys());
  }
}

/** Global singleton registry for the LSP server process. */
export const globalLanguageRegistry = new LanguageRegistry();
