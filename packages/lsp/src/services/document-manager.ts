// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CSTTree } from "@modelscript/runtime";
import { TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { PositionIndex } from "../lsp-bridge.js";
import type { CstNodeLike, CstTreeLike, XmlFallbackTree } from "../utils/ast-utils.js";
import type { SyntaxNode as CstSyntaxNode, Tree as CstTree } from "../utils/cst-facade.js";
import type { LineIndex } from "../utils/line-index.js";

/** Structural view of a WASM parser facade stored on cached trees or plugins. */
export interface DocumentTreeFacadeLike {
  removeDocument?: (uri: string) => void;
  lastAstRoot?: number;
  getDocumentRoot?: (uriOrFileId?: string | number) => number;
  getDocumentSymbols?: (rootPtr: number) => unknown[];
  getFoldingRanges?: (rootPtr: number) => unknown[];
  exports?: { lsp_clearDocuments?: () => void };
}

/** Cached CST parse tree with optional WASM arena handles and XML fallback metadata. */
export type CachedCstTree = CstTree & {
  rootPtr?: number;
  facade?: DocumentTreeFacadeLike | null;
  delete?(): void;
  tree?: CstTree | null;
  __isXmlCstFallback?: boolean;
  __xmlErrors?: unknown[];
};

/** Minimal fallback tree accepted when writing non-WASM / custom-parsed documents into `documentTrees`. */
export interface MinimalFallbackTree {
  rootNode?: CstSyntaxNode | { text: string; data?: unknown; type?: string } | null;
  rootPtr?: number;
  facade?: DocumentTreeFacadeLike | null;
  delete?(): void;
  tree?: CstTree | null;
  __isXmlCstFallback?: boolean;
  __xmlErrors?: unknown[];
}

/** Normalized parse tree union stored in `DocumentTreeMap` and `LazyTreeMap`. */
export type StoredCstTree = CachedCstTree | CstTreeLike | XmlFallbackTree | null;

/** Accepted input tree union when writing into `DocumentTreeMap` or `LazyTreeMap`. */
export type StoredCstTreeInput = StoredCstTree | MinimalFallbackTree;

function isNormalizedTree(
  tree: Exclude<StoredCstTreeInput, null>,
): tree is CachedCstTree | CstTreeLike | XmlFallbackTree {
  return "rootNode" in tree && tree.rootNode != null && typeof (tree.rootNode as { type?: unknown }).type === "string";
}

function normalizeStoredTree(tree: StoredCstTreeInput, fallbackText: string): StoredCstTree {
  if (!tree) return null;
  if (isNormalizedTree(tree)) return tree;
  const raw = tree.rootNode;
  const text = raw?.text ?? fallbackText;
  const normalizedRoot: CstNodeLike & { data?: unknown } = {
    type: raw?.type ?? "document",
    text,
    startIndex: 0,
    endIndex: text.length,
    children: [],
    ...(raw && "data" in raw && raw.data !== undefined ? { data: raw.data } : {}),
  };
  return {
    rootNode: normalizedRoot,
    ...(tree.rootPtr !== undefined ? { rootPtr: tree.rootPtr } : {}),
    ...(tree.facade !== undefined ? { facade: tree.facade } : {}),
    ...(tree.delete !== undefined ? { delete: tree.delete } : {}),
  };
}

/** Cached parse tree entry stored per document URI. */
export interface DocumentTreeEntry {
  text: string;
  tree: StoredCstTree;
  classCache?: Map<string, unknown> | undefined;
  lineIndex?: LineIndex | undefined;
  tokens?: CstSyntaxNode[] | undefined;
  positionIndex?: PositionIndex | undefined;
  positionIndexVersion?: number | undefined;
  positionIndexText?: string | undefined;
}

/** Input entry accepted by `DocumentTreeMap.set`. */
export interface DocumentTreeInputEntry {
  text: string;
  tree: StoredCstTreeInput;
  classCache?: Map<string, unknown> | undefined;
  lineIndex?: LineIndex | undefined;
  tokens?: CstSyntaxNode[] | undefined;
  positionIndex?: PositionIndex | undefined;
  positionIndexVersion?: number | undefined;
  positionIndexText?: string | undefined;
}

/** Map subclass storing normalized document CST entries (full WASM trees, CstTreeLike fallbacks, or null). */
export class DocumentTreeMap extends Map<string, DocumentTreeEntry> {
  override set(key: string, value: DocumentTreeInputEntry): this {
    return super.set(key, { ...value, tree: normalizeStoredTree(value.tree, value.text) });
  }
}

/** Lazily cached library tree entry stored per document URI. */
export interface LazyTreeEntry {
  text: string;
  tree: StoredCstTree;
  classCache?: Map<string, unknown> | undefined;
  positionIndex?: PositionIndex | undefined;
  positionIndexText?: string | undefined;
}

/** Input entry accepted by `LazyTreeMap.set`. */
export interface LazyTreeInputEntry {
  text: string;
  tree: StoredCstTreeInput;
  classCache?: Map<string, unknown> | undefined;
  positionIndex?: PositionIndex | undefined;
  positionIndexText?: string | undefined;
}

/** Map subclass for lazily parsed library trees. */
export class LazyTreeMap extends Map<string, LazyTreeEntry> {
  override set(key: string, value: LazyTreeInputEntry): this {
    return super.set(key, { ...value, tree: normalizeStoredTree(value.tree, value.text) });
  }
}

/** Minimal filesystem interface exposed by `SharedCompilerContext`. */
export interface SharedCompilerFileSystem {
  read(path: string): string | undefined;
  readFile?(path: string): string | undefined;
  exists(path: string): boolean;
  write?(path: string, content: string): void;
  delete?(path: string): void;
  readdir?(path: string): unknown[];
  listDir?(dir: string): string[];
}

/** Shared compiler context exposed by `ParserService` and `DocumentManager`. */
export interface SharedCompilerContext {
  fs: SharedCompilerFileSystem;
  parse(ext: string, input: string, ...rest: unknown[]): CachedCstTree | null;
  flattenArena?(name: string, classId?: number, uri?: string, options?: Record<string, unknown>): unknown;
  queryEngine?: unknown;
  workspaceIndex?: unknown;
  setQueryEngine?(engine: unknown): void;
  setWorkspaceIndex?(wsIndex: unknown): void;
  parsers?: ReadonlyMap<string, { parse(text: string): unknown }> | undefined;
  attachExternalUnifiedWorkspace?: ((uw: unknown) => void) | undefined;
  syncExternalWorkspace?: (() => void) | undefined;
  __attachedExternalUw?: unknown;
}

/**
 * Manages open text documents and their cached Concrete Syntax Trees (CSTs).
 *
 * Provides unified lookup across active editor buffers (`documentTrees`) and
 * on-demand background library files (`lazyLibTrees`).
 */
export class DocumentManager {
  /** LSP text document synchronization manager tracking open editor files. */
  public documents: TextDocuments<TextDocument>;
  /** Map from document URI to cached parse tree entry (`{ text, tree, classCache }`). */
  public documentTrees: DocumentTreeMap = new DocumentTreeMap();
  /** Map from library file URI to lazily parsed CST and source text for non-open files. */
  public lazyLibTrees: LazyTreeMap = new LazyTreeMap();
  /** Optional shared compiler context used for fallback parsing and virtual filesystem reads. */
  public sharedContext?: SharedCompilerContext | null | undefined;
  /** Accessor returning the shared CST tree wrapper used by Salsa `QueryEngine` instances. */
  public getSharedCstTreeWrapper: () => CSTTree;

  /**
   * Creates a new `DocumentManager`.
   *
   * @param documents - The LSP `TextDocuments` collection managing open files.
   * @param getSharedCstTreeWrapper - Callback providing the shared CST tree wrapper for query engines.
   */
  constructor(documents: TextDocuments<TextDocument>, getSharedCstTreeWrapper: () => CSTTree) {
    this.documents = documents;
    this.getSharedCstTreeWrapper = getSharedCstTreeWrapper;
  }

  /**
   * Retrieves the cached CST entry for a document URI, checking active editor trees first
   * and falling back to lazily parsed library trees.
   *
   * @param uri - The document URI to look up.
   * @returns The cached tree entry, or `null` if the URI has not been parsed.
   */
  public getDocumentTree(uri: string): DocumentTreeEntry | LazyTreeEntry | null {
    if (this.documentTrees.has(uri)) {
      return this.documentTrees.get(uri)!;
    }
    if (this.lazyLibTrees.has(uri)) {
      return this.lazyLibTrees.get(uri)!;
    }
    return null;
  }

  /** Fallback cached `PositionIndex` entries for open documents that do not yet have a `DocumentTreeEntry`. */
  private openDocPositionIndices = new Map<string, { version: number; index: PositionIndex }>();

  /**
   * Retrieves the line offset index for a document if available, reusing a cached `PositionIndex`
   * when the document version or cached tree text has not changed.
   *
   * @param uri - The document URI to look up.
   * @returns The line index instance, or `null` if unavailable.
   */
  public getLineIndexForDoc(uri: string): PositionIndex | null {
    const doc = this.documents.get(uri);
    if (doc) {
      const treeEntry = this.documentTrees.get(uri);
      if (treeEntry) {
        if (treeEntry.positionIndex && treeEntry.positionIndexVersion === doc.version) {
          return treeEntry.positionIndex;
        }
        const text = doc.getText();
        if (treeEntry.positionIndex && treeEntry.positionIndexText === text) {
          treeEntry.positionIndexVersion = doc.version;
          return treeEntry.positionIndex;
        }
        const index = new PositionIndex(text);
        treeEntry.positionIndex = index;
        treeEntry.positionIndexVersion = doc.version;
        treeEntry.positionIndexText = text;
        this.openDocPositionIndices.delete(uri);
        return index;
      }

      const cached = this.openDocPositionIndices.get(uri);
      if (cached && cached.version === doc.version) {
        return cached.index;
      }
      const index = new PositionIndex(doc.getText());
      if (!this.openDocPositionIndices.has(uri) && this.openDocPositionIndices.size >= 200) {
        const oldest = this.openDocPositionIndices.keys().next().value;
        if (oldest !== undefined) {
          this.openDocPositionIndices.delete(oldest);
        }
      }
      this.openDocPositionIndices.set(uri, { version: doc.version, index });
      return index;
    }

    this.openDocPositionIndices.delete(uri);
    const treeEntry = this.documentTrees.get(uri) ?? this.lazyLibTrees.get(uri);
    if (treeEntry?.text) {
      if (treeEntry.positionIndex && treeEntry.positionIndexText === treeEntry.text) {
        return treeEntry.positionIndex;
      }
      const index = new PositionIndex(treeEntry.text);
      treeEntry.positionIndex = index;
      treeEntry.positionIndexText = treeEntry.text;
      return index;
    }
    return null;
  }
}
