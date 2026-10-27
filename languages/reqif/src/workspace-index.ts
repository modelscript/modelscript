// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for OMG ReqIF 1.2 requirement models (.reqif, .reqifz).
 * Indexes specifications, requirements (SPEC-OBJECT), relations, and formal contracts
 * across the workspace for instant cross-file lookup and LSP navigation.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseReqIf } from "./parser/reqif-parser.js";
import type { ReqIfDocument } from "./types.js";

export class ReqIfWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocs = new Map<string, ReqIfDocument>();
  private fileBaseIds = new Map<string, number>();
  private nextFileSlot = 1;

  get version(): number {
    return this._version;
  }

  get fileCount(): number {
    return this.fileIndices.size;
  }

  public has(uri: string): boolean {
    return this.fileIndices.has(uri);
  }

  public getFileIndex(uri: string): SymbolIndex | undefined {
    return this.fileIndices.get(uri);
  }

  public getDocument(uri: string): ReqIfDocument | undefined {
    return this.fileDocs.get(uri);
  }

  public register(uri: string): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(
    uri: string,
    loader?: () => string | { sourceText?: string; text?: string } | null | undefined,
  ): void {
    this._version++;
    if (loader) {
      try {
        const res = loader();
        const text = typeof res === "string" ? res : (res?.sourceText ?? res?.text);
        if (typeof text === "string") {
          this.indexFile(uri, text);
        }
      } catch {
        // Ignore loader errors during incremental re-indexing
      }
    }
  }

  /**
   * Indexes a ReqIF document from its XML source.
   */
  public indexFile(uri: string, text: string): SymbolIndex {
    let doc: ReqIfDocument;
    try {
      doc = parseReqIf(text);
      this.fileDocs.set(uri, doc);
    } catch {
      // Return empty index on fatal parse failure
      const emptyIdx: SymbolIndex = {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      };
      this.fileIndices.set(uri, emptyIdx);
      return emptyIdx;
    }

    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    let baseId = this.fileBaseIds.get(uri);
    if (baseId === undefined) {
      baseId = this.nextFileSlot++ * 100_000;
      this.fileBaseIds.set(uri, baseId);
    }
    let idCounter = baseId;

    const specTitle = doc.header.title || this.deriveNameFromUri(uri);

    // Root symbol for the requirement specification package
    const rootId = idCounter++;
    const rootEntry: SymbolEntry = {
      id: rootId,
      kind: "Package",
      name: specTitle,
      ruleName: "reqif_specification",
      namePath: specTitle,
      startOffset: 0,
      endOffset: text.length,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: {
        language: "reqif",
        reqIfVersion: doc.header.reqIfVersion,
        reqCount: doc.specObjects.size,
      },
      fieldName: null,
      resourceId: uri,
      language: "reqif",
    };

    symbols.set(rootId, rootEntry);
    byName.set(specTitle, [rootId]);

    const rootChildren: SymbolId[] = [];
    childrenOf.set(null, [rootId]);
    childrenOf.set(rootId, rootChildren);

    // Index all requirements (SPEC-OBJECT)
    for (const obj of doc.specObjects.values()) {
      const reqSymId = idCounter++;
      const reqName = obj.identifier;

      const reqEntry: SymbolEntry = {
        id: reqSymId,
        kind: "Class",
        name: reqName,
        ruleName: "reqif_requirement",
        namePath: `${specTitle}.${reqName}`,
        startOffset: obj.span?.startOffset ?? 0,
        endOffset: obj.span?.endOffset ?? 0,
        parentId: rootId,
        exports: [],
        inherits: [],
        metadata: {
          language: "reqif",
          text: obj.text,
          longName: obj.longName,
          asilLevel: obj.asilLevel,
          contract: obj.contract,
          typeRef: obj.typeRef,
        },
        fieldName: null,
        resourceId: uri,
        language: "reqif",
      };

      symbols.set(reqSymId, reqEntry);
      rootChildren.push(reqSymId);

      const existingByName = byName.get(reqName) || [];
      existingByName.push(reqSymId);
      byName.set(reqName, existingByName);

      if (obj.longName && obj.longName !== reqName) {
        const existingByLongName = byName.get(obj.longName) || [];
        existingByLongName.push(reqSymId);
        byName.set(obj.longName, existingByLongName);
      }
    }

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  public findSymbols(query: string): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    const lowerQuery = query.toLowerCase();

    for (const index of this.fileIndices.values()) {
      for (const [name, ids] of index.byName) {
        if (name.toLowerCase().includes(lowerQuery)) {
          for (const id of ids) {
            const sym = index.symbols.get(id);
            if (sym) results.push(sym);
          }
        }
      }
    }
    return results;
  }

  public resolveQualified(name: string, fromUri?: string): SymbolEntry | undefined {
    if (fromUri) {
      const idx = this.fileIndices.get(fromUri);
      if (idx) {
        const firstId = idx.byName.get(name)?.[0];
        if (firstId !== undefined) return idx.symbols.get(firstId);
      }
    }
    for (const idx of this.fileIndices.values()) {
      const firstId = idx.byName.get(name)?.[0];
      if (firstId !== undefined) return idx.symbols.get(firstId);
    }
    return undefined;
  }

  public symbolsInScope(uri: string, _scope?: string): SymbolEntry[] {
    const idx = this.fileIndices.get(uri);
    if (!idx) return [];
    return Array.from(idx.symbols.values());
  }

  public referencesTo(symbolId: SymbolId): { uri: string; startOffset: number; endOffset: number }[] {
    const refs: { uri: string; startOffset: number; endOffset: number }[] = [];
    let targetName: string | undefined;

    for (const idx of this.fileIndices.values()) {
      const sym = idx.symbols.get(symbolId);
      if (sym) {
        targetName = sym.name;
        break;
      }
    }

    if (!targetName) return refs;

    // Search across spec relations for references to targetName
    for (const [uri, doc] of this.fileDocs) {
      for (const rel of doc.specRelations) {
        if (rel.sourceId === targetName || rel.targetId === targetName) {
          if (rel.span?.startOffset !== undefined && rel.span?.endOffset !== undefined) {
            refs.push({
              uri,
              startOffset: rel.span.startOffset,
              endOffset: rel.span.endOffset,
            });
          }
        }
      }
    }

    return refs;
  }

  private deriveNameFromUri(uri: string): string {
    const filename = uri.split("/").pop() || "requirements.reqif";
    return filename.replace(/\.(reqif|reqifz|xml)$/i, "");
  }
}
