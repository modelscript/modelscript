// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/qif — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for ISO 23952 / ANSI DMSC QIF 3.0 files (.qif, .qif.xml).
 * Indexes datum definitions, features, GD&T characteristics, measurement devices,
 * inspection plan steps, and metrology actuals.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseQif } from "./parser/index.js";
import type { QifDocument } from "./types.js";

export class QifWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, QifDocument>();
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

  public getDocument(uri: string): QifDocument | undefined {
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

    const doc = parseQif(text, uri);
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

    // 1. Index Datum Definitions
    for (const d of doc.datumDefinitions) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);

      const entry: SymbolEntry = {
        id: symId,
        name: d.label,
        kind: "Constant",
        ruleName: "qif_datum",
        namePath: d.label,
        fieldName: null,
        parentId: null,
        startOffset: d.range.startOffset,
        endOffset: d.range.endOffset,
        exports: [],
        inherits: [],
        language: "qif",
        resourceId: uri,
        metadata: {
          datumId: d.id,
          qpId: d.qpId,
          featureId: d.featureId,
        },
      };
      symbols.set(symId, entry);
      addByName(d.label, symId);
      addByName(d.id, symId);
    }

    // 2. Index Features
    for (const f of doc.features) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);

      const entry: SymbolEntry = {
        id: symId,
        name: f.name,
        kind: "Component",
        ruleName: "qif_feature",
        namePath: f.name,
        fieldName: null,
        parentId: null,
        startOffset: f.range.startOffset,
        endOffset: f.range.endOffset,
        exports: [],
        inherits: [],
        language: "qif",
        resourceId: uri,
        metadata: {
          featureId: f.id,
          qpId: f.qpId,
          featureType: f.featureType,
          isFeatureOfSize: f.isFeatureOfSize,
          nominalSize: f.nominalSize,
          stepEntityId: f.stepEntityId,
          probingPoints: f.probingPoints,
        },
      };
      symbols.set(symId, entry);
      addByName(f.name, symId);
      addByName(f.id, symId);
    }

    // 3. Index Characteristics & Child Actuals
    for (const c of doc.characteristics) {
      const charSymId = idCounter++ as SymbolId;
      rootChildren.push(charSymId);

      const charEntry: SymbolEntry = {
        id: charSymId,
        name: c.name,
        kind: "Property",
        ruleName: "qif_characteristic",
        namePath: c.name,
        fieldName: null,
        parentId: null,
        startOffset: c.range.startOffset,
        endOffset: c.range.endOffset,
        exports: [],
        inherits: [],
        language: "qif",
        resourceId: uri,
        metadata: {
          characteristicId: c.id,
          qpId: c.qpId,
          gdtType: c.gdtType,
          toleranceZone: c.toleranceZone,
          materialCondition: c.materialCondition,
          balloonNumber: c.balloonNumber,
        },
      };
      symbols.set(charSymId, charEntry);
      addByName(c.name, charSymId);
      addByName(c.id, charSymId);

      const charChildren: SymbolId[] = [];
      const matchingActuals = doc.actuals.filter(
        (a) => a.characteristicId === c.id || (c.qpId && a.characteristicId === c.qpId),
      );
      for (const act of matchingActuals) {
        const actSymId = idCounter++ as SymbolId;
        charChildren.push(actSymId);

        const actEntry: SymbolEntry = {
          id: actSymId,
          name: act.id,
          kind: "Variable",
          ruleName: "qif_actual",
          namePath: `${c.name}.${act.id}`,
          fieldName: null,
          parentId: charSymId,
          startOffset: act.range.startOffset,
          endOffset: act.range.endOffset,
          exports: [],
          inherits: [],
          language: "qif",
          resourceId: uri,
          metadata: {
            partSerialNumber: act.partSerialNumber,
            measuredValue: act.measuredValue,
            actualFeatureSize: act.actualFeatureSize,
            status: act.status,
          },
        };
        symbols.set(actSymId, actEntry);
        addByName(act.id, actSymId);
      }
      childrenOf.set(charSymId, charChildren);
    }

    // 4. Index Measurement Devices
    for (const dev of doc.devices) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);

      const entry: SymbolEntry = {
        id: symId,
        name: dev.name,
        kind: "Class",
        ruleName: "qif_device",
        namePath: dev.name,
        fieldName: null,
        parentId: null,
        startOffset: dev.range.startOffset,
        endOffset: dev.range.endOffset,
        exports: [],
        inherits: [],
        language: "qif",
        resourceId: uri,
        metadata: {
          deviceId: dev.id,
          qpId: dev.qpId,
          deviceType: dev.deviceType,
          calibrationUncertainty: dev.calibrationUncertainty,
        },
      };
      symbols.set(symId, entry);
      addByName(dev.name, symId);
      addByName(dev.id, symId);
    }

    // 5. Index Plan Steps
    for (const step of doc.planSteps) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);

      const entry: SymbolEntry = {
        id: symId,
        name: step.id,
        kind: "Event",
        ruleName: "qif_plan_step",
        namePath: step.id,
        fieldName: null,
        parentId: null,
        startOffset: step.range.startOffset,
        endOffset: step.range.endOffset,
        exports: [],
        inherits: [],
        language: "qif",
        resourceId: uri,
        metadata: {
          stepNumber: step.stepNumber,
          featureId: step.featureId,
          characteristicId: step.characteristicId,
          deviceId: step.deviceId,
          probingPointCount: step.probingPointCount,
        },
      };
      symbols.set(symId, entry);
      addByName(step.id, symId);
    }

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
