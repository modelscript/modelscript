// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */
import { TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Tree as CstTree } from "../utils/cst-facade.js";

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
  public documentTrees = new Map<string, any>();
  /** Map from library file URI to lazily parsed CST and source text for non-open files. */
  public lazyLibTrees = new Map<string, any>();
  /** Optional shared compiler context used for fallback parsing and virtual filesystem reads. */
  public sharedContext: any;
  /** Accessor returning the shared CST tree wrapper used by Salsa `QueryEngine` instances. */
  public getSharedCstTreeWrapper: () => any;

  /**
   * Creates a new `DocumentManager`.
   *
   * @param documents - The LSP `TextDocuments` collection managing open files.
   * @param getSharedCstTreeWrapper - Callback providing the shared CST tree wrapper for query engines.
   */
  constructor(documents: TextDocuments<TextDocument>, getSharedCstTreeWrapper: () => any) {
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
  public getDocumentTree(uri: string): CstTree | null {
    if (this.documentTrees.has(uri)) {
      return this.documentTrees.get(uri)!;
    }
    if (this.lazyLibTrees.has(uri)) {
      return this.lazyLibTrees.get(uri)!;
    }
    return null;
  }

  /**
   * Retrieves the line offset index for a document if available.
   *
   * @param uri - The document URI to look up.
   * @returns The line index instance, or `null` if unavailable.
   */
  public getLineIndexForDoc(uri: string): any | null {
    const doc = this.documents.get(uri);
    const tree = this.getDocumentTree(uri);
    if (!doc || !tree) return null;
    return null;
  }
}
