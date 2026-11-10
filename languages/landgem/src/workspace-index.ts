// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseLandgem } from "./parser/index.js";
import type { LandgemModel } from "./types.js";

export class LandgemWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileModels = new Map<string, LandgemModel>();
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

  public getModel(uri: string): LandgemModel | undefined {
    return this.fileModels.get(uri);
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
        // Ignore
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

    let localId = 1;
    function addSymbol(
      name: string,
      kind: string,
      parentId: SymbolId | null,
      startOffset: number,
      endOffset: number,
      metadata: Record<string, unknown> = {},
    ): SymbolId {
      const symId = (baseId! + localId++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind,
        ruleName: "landgem_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "landgem",
        resourceId: uri,
        metadata,
      };

      symbols.set(symId, entry);

      const existingByName = byName.get(name) ?? [];
      existingByName.push(symId);
      byName.set(name, existingByName);

      const existingChildren = childrenOf.get(parentId) ?? [];
      existingChildren.push(symId);
      childrenOf.set(parentId, existingChildren);

      return symId;
    }

    try {
      const model = parseLandgem(text);
      this.fileModels.set(uri, model);

      const rootName = model.sites[0]?.name ?? model.digesters[0]?.name ?? "Biogas_Model";
      const rootId = addSymbol(rootName, "package", null, 0, text.length);

      for (const site of model.sites) {
        const sId = addSymbol(site.name, "class", rootId, 0, 50, {
          openYear: site.openYear,
          closeYear: site.closeYear,
          k: site.params.k,
          l0: site.params.l0,
        });
        for (const c of site.cohorts) {
          addSymbol(`Cohort_${c.year}`, "variable", sId, 0, 30, {
            year: c.year,
            massMg: c.massMg,
          });
        }
      }

      for (const d of model.digesters) {
        addSymbol(d.name, "class", rootId, 0, 50, {
          volumeM3: d.volumeM3,
          temperatureC: d.temperatureC,
          hrtDays: d.hrtDays,
          ph: d.ph,
        });
      }
    } catch {
      // Ignore
    }

    const symbolIndex: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, symbolIndex);
    return symbolIndex;
  }
}
