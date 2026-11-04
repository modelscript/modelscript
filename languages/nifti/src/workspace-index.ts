// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nifti — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for NIfTI (.nii) and NRRD (.nrrd, .nhdr) volumetric files.
 * Indexes volume headers, anatomical segmentation labels, and compartmental ROIs.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseNifti } from "./parser/index.js";
import type { NiftiDocument } from "./types.js";

export class NiftiWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, NiftiDocument>();
  private fileBaseIds = new Map<string, number>();
  private nextFileSlot = 1;

  get version(): number {
    return this._version;
  }

  get structuralRevision(): number {
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

  public getDocument(uri: string): NiftiDocument | undefined {
    return this.fileDocuments.get(uri);
  }

  public register(uri: string, _loader?: () => unknown): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: () => string | { sourceText?: string; text?: string } | null): void {
    this._version++;
    if (loader) {
      try {
        const res = loader();
        const text = typeof res === "string" ? res : (res?.sourceText ?? res?.text);
        if (typeof text === "string") {
          this.indexFile(uri, text);
        }
      } catch {
        // incremental reindex guard
      }
    }
  }

  public indexFile(uri: string, text: string): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    let baseId = this.fileBaseIds.get(uri);
    if (baseId === undefined) {
      baseId = this.nextFileSlot++ * 100_000;
      this.fileBaseIds.set(uri, baseId);
    }
    let idCounter = baseId;

    const doc = parseNifti(text, uri);
    this.fileDocuments.set(uri, doc);

    const rootChildren: SymbolId[] = [];

    const addByName = (key: string, symId: SymbolId) => {
      if (!key) return;
      const list = byName.get(key) ?? [];
      if (!list.includes(symId)) {
        list.push(symId);
        byName.set(key, list);
      }
    };

    // 1. Index Volume Header as Root Class Symbol
    const volSymId = idCounter++ as SymbolId;
    rootChildren.push(volSymId);
    const volEntry: SymbolEntry = {
      id: volSymId,
      name: doc.title,
      kind: "Class",
      ruleName: "nifti_volume",
      namePath: doc.title,
      fieldName: null,
      parentId: null,
      startOffset: doc.range.startOffset,
      endOffset: doc.range.endOffset,
      exports: [],
      inherits: [],
      language: "nifti",
      resourceId: uri,
      metadata: {
        format: doc.format,
        datatype: doc.header.datatypeName,
        dim: doc.header.dim.slice(0, 4),
        pixdim: doc.header.pixdim.slice(0, 4),
      },
    };
    symbols.set(volSymId, volEntry);
    addByName(doc.title, volSymId);

    const volChildren: SymbolId[] = [];

    // 2. Index Anatomical Segmentation Labels
    for (const lbl of doc.labels) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);
      volChildren.push(symId);
      const entry: SymbolEntry = {
        id: symId,
        name: lbl.name,
        kind: "Constant",
        ruleName: "nifti_label",
        namePath: `${doc.title}.${lbl.name}`,
        fieldName: null,
        parentId: volSymId,
        startOffset: lbl.range.startOffset,
        endOffset: lbl.range.endOffset,
        exports: [],
        inherits: [],
        language: "nifti",
        resourceId: uri,
        metadata: {
          labelId: lbl.id,
          color: lbl.color,
        },
      };
      symbols.set(symId, entry);
      addByName(lbl.name, symId);
      addByName(String(lbl.id), symId);
    }

    // 3. Index Compartmental ROIs
    for (const roi of doc.rois) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);
      volChildren.push(symId);
      const entry: SymbolEntry = {
        id: symId,
        name: roi.name,
        kind: "Component",
        ruleName: "nifti_roi",
        namePath: `${doc.title}.${roi.name}`,
        fieldName: null,
        parentId: volSymId,
        startOffset: roi.range.startOffset,
        endOffset: roi.range.endOffset,
        exports: [],
        inherits: [],
        language: "nifti",
        resourceId: uri,
        metadata: {
          roiId: roi.id,
          labelId: roi.labelId,
          diffusionCoeffD: roi.diffusionCoeffD,
          clearanceRateK: roi.clearanceRateK,
        },
      };
      symbols.set(symId, entry);
      addByName(roi.name, symId);
      addByName(roi.id, symId);
    }

    childrenOf.set(volSymId, volChildren);
    childrenOf.set(null, rootChildren);

    const index: SymbolIndex = {
      symbols,
      byName,
      childrenOf,
    };

    this.fileIndices.set(uri, index);
    return index;
  }

  public resolveInScope(name: string, scopeId: SymbolId | null, uri: string): SymbolEntry | null {
    const idx = this.fileIndices.get(uri);
    if (!idx) return null;

    if (scopeId !== null) {
      const children = idx.childrenOf.get(scopeId);
      if (children) {
        for (const cid of children) {
          const sym = idx.symbols.get(cid);
          if (sym && sym.name.toLowerCase() === name.toLowerCase()) {
            return sym;
          }
        }
      }
    }

    for (const fileIndex of this.fileIndices.values()) {
      const candidates = fileIndex.byName.get(name);
      const firstCandidate = candidates?.[0];
      if (firstCandidate !== undefined) {
        const found = fileIndex.symbols.get(firstCandidate);
        if (found) return found;
      }
    }

    return null;
  }

  public lookupExact(id: SymbolId): SymbolEntry | undefined {
    for (const index of this.fileIndices.values()) {
      const sym = index.symbols.get(id);
      if (sym) return sym;
    }
    return undefined;
  }

  public findByName(name: string): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    for (const index of this.fileIndices.values()) {
      const ids = index.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const s = index.symbols.get(id);
          if (s) results.push(s);
        }
      }
    }
    return results;
  }

  public getAllSymbols(uri: string): SymbolEntry[] {
    const idx = this.fileIndices.get(uri);
    if (!idx) return [];
    return Array.from(idx.symbols.values());
  }

  public getAllFiles(): string[] {
    return Array.from(this.fileIndices.keys());
  }

  public clear(): void {
    this._version++;
    this.fileIndices.clear();
    this.fileDocuments.clear();
    this.fileBaseIds.clear();
    this.nextFileSlot = 1;
  }
}
