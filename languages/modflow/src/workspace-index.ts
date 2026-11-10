// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseModflow } from "./parser/index.js";
import type { ModflowModel } from "./types.js";

export class ModflowWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileModels = new Map<string, ModflowModel>();
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

  public getModel(uri: string): ModflowModel | undefined {
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
        ruleName: "modflow_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "modflow",
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
      const model = parseModflow(text);
      this.fileModels.set(uri, model);

      const rootName = model.name || "MODFLOW_Aquifer";
      const rootId = addSymbol(rootName, "package", null, 0, text.length);

      addSymbol(
        `DIS_${model.dis.nlay}x${model.dis.nrow}x${model.dis.ncol}`,
        "class",
        rootId,
        0,
        50,
        { nlay: model.dis.nlay, nrow: model.dis.nrow, ncol: model.dis.ncol },
      );

      addSymbol(
        `NPF_K${model.npf.k}`,
        "property",
        rootId,
        0,
        50,
        { k: model.npf.k, k33: model.npf.k33, ss: model.npf.ss, sy: model.npf.sy },
      );

      for (let i = 0; i < model.wells.length; i++) {
        const w = model.wells[i]!;
        const name = w.name ?? `WELL_${w.cell.layer}_${w.cell.row}_${w.cell.col}`;
        addSymbol(name, "variable", rootId, 0, 50, {
          layer: w.cell.layer,
          row: w.cell.row,
          col: w.cell.col,
          q: w.q,
        });
      }

      for (let i = 0; i < model.rivers.length; i++) {
        const r = model.rivers[i]!;
        const name = `RIV_${r.cell.layer}_${r.cell.row}_${r.cell.col}`;
        addSymbol(name, "variable", rootId, 0, 50, {
          layer: r.cell.layer,
          row: r.cell.row,
          col: r.cell.col,
          stage: r.stage,
          cond: r.cond,
        });
      }

      for (let i = 0; i < model.chds.length; i++) {
        const chd = model.chds[i]!;
        const name = `CHD_${chd.cell.layer}_${chd.cell.row}_${chd.cell.col}`;
        addSymbol(name, "variable", rootId, 0, 50, {
          layer: chd.cell.layer,
          row: chd.cell.row,
          col: chd.cell.col,
          head: chd.head,
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
