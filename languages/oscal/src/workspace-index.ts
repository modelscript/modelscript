// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/oscal — Multi-File Workspace Indexer.
 *
 * Implements `IWorkspaceIndex` for NIST OSCAL 1.1.x documents (.oscal.json, .oscal.yaml, .oscal.xml).
 * Indexes catalogs, groups, controls, parameters, profiles, components, implemented-requirements,
 * findings, and POA&M items across workspace files.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseOscal } from "./parser/index.js";
import type { OscalControl, OscalDocument, OscalGroup } from "./types.js";

export class OscalWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, OscalDocument>();
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

  public getDocument(uri: string): OscalDocument | undefined {
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

    const addByName = (key: string, id: SymbolId) => {
      if (!key) return;
      const existing = byName.get(key) ?? [];
      if (!existing.includes(id)) {
        existing.push(id);
        byName.set(key, existing);
      }
    };

    const doc = parseOscal(text, uri);
    this.fileDocuments.set(uri, doc);

    const rootChildren: SymbolId[] = [];

    // 1. Root Document Symbol
    const docId = idCounter++ as SymbolId;
    rootChildren.push(docId);
    const docEntry: SymbolEntry = {
      id: docId,
      name: doc.metadata.title || doc.uuid,
      kind: "Package",
      ruleName: `oscal_${doc.kind.replace(/-/g, "_")}`,
      namePath: doc.metadata.title || doc.uuid,
      fieldName: null,
      parentId: null,
      startOffset: doc.range.startOffset,
      endOffset: doc.range.endOffset,
      exports: [],
      inherits: [],
      language: "oscal",
      resourceId: uri,
      metadata: {
        kind: doc.kind,
        uuid: doc.uuid,
        version: doc.metadata.version,
      },
    };
    symbols.set(docId, docEntry);
    addByName(docEntry.name, docId);
    addByName(doc.uuid, docId);

    const docChildren: SymbolId[] = [];

    const indexControl = (ctrl: OscalControl, parentId: SymbolId, parentPath: string) => {
      const ctrlId = idCounter++ as SymbolId;
      const ctrlPath = `${parentPath}.${ctrl.id}`;
      const ctrlEntry: SymbolEntry = {
        id: ctrlId,
        name: ctrl.id,
        kind: "Class",
        ruleName: "oscal_control",
        namePath: ctrlPath,
        fieldName: null,
        parentId,
        startOffset: ctrl.range?.startOffset ?? 0,
        endOffset: ctrl.range?.endOffset ?? 0,
        exports: [],
        inherits: [],
        language: "oscal",
        resourceId: uri,
        metadata: {
          title: ctrl.title,
          class: ctrl.class,
        },
      };
      symbols.set(ctrlId, ctrlEntry);
      addByName(ctrl.id, ctrlId);
      addByName(ctrl.title, ctrlId);

      const ctrlChildren: SymbolId[] = [];
      for (const param of ctrl.params ?? []) {
        const paramSymId = idCounter++ as SymbolId;
        ctrlChildren.push(paramSymId);
        const paramEntry: SymbolEntry = {
          id: paramSymId,
          name: param.id,
          kind: "Property",
          ruleName: "oscal_parameter",
          namePath: `${ctrlPath}.${param.id}`,
          fieldName: null,
          parentId: ctrlId,
          startOffset: param.range?.startOffset ?? 0,
          endOffset: param.range?.endOffset ?? 0,
          exports: [],
          inherits: [],
          language: "oscal",
          resourceId: uri,
          metadata: {
            label: param.label,
            values: param.values,
          },
        };
        symbols.set(paramSymId, paramEntry);
        addByName(param.id, paramSymId);
      }

      for (const subCtrl of ctrl.controls ?? []) {
        const subId = indexControl(subCtrl, ctrlId, ctrlPath);
        ctrlChildren.push(subId);
      }

      childrenOf.set(ctrlId, ctrlChildren);
      return ctrlId;
    };

    const indexGroup = (group: OscalGroup, parentId: SymbolId, parentPath: string) => {
      const grpId = idCounter++ as SymbolId;
      const grpPath = `${parentPath}.${group.id}`;
      const grpEntry: SymbolEntry = {
        id: grpId,
        name: group.id,
        kind: "Package",
        ruleName: "oscal_group",
        namePath: grpPath,
        fieldName: null,
        parentId,
        startOffset: group.range?.startOffset ?? 0,
        endOffset: group.range?.endOffset ?? 0,
        exports: [],
        inherits: [],
        language: "oscal",
        resourceId: uri,
        metadata: {
          title: group.title,
        },
      };
      symbols.set(grpId, grpEntry);
      addByName(group.id, grpId);

      const grpChildren: SymbolId[] = [];
      for (const ctrl of group.controls ?? []) {
        grpChildren.push(indexControl(ctrl, grpId, grpPath));
      }
      for (const subGrp of group.groups ?? []) {
        grpChildren.push(indexGroup(subGrp, grpId, grpPath));
      }
      childrenOf.set(grpId, grpChildren);
      return grpId;
    };

    // 2. Index Groups & Controls
    for (const grp of doc.groups ?? []) {
      docChildren.push(indexGroup(grp, docId, docEntry.name));
    }
    for (const ctrl of doc.controls ?? []) {
      docChildren.push(indexControl(ctrl, docId, docEntry.name));
    }

    // 3. Index Components
    const allComponents = [...(doc.components ?? []), ...(doc.systemImplementation?.components ?? [])];
    for (const comp of allComponents) {
      const compId = idCounter++ as SymbolId;
      docChildren.push(compId);
      const compEntry: SymbolEntry = {
        id: compId,
        name: comp.title,
        kind: "Component",
        ruleName: "oscal_component",
        namePath: `${docEntry.name}.${comp.title}`,
        fieldName: null,
        parentId: docId,
        startOffset: comp.range?.startOffset ?? 0,
        endOffset: comp.range?.endOffset ?? 0,
        exports: [],
        inherits: [],
        language: "oscal",
        resourceId: uri,
        metadata: {
          uuid: comp.uuid,
          type: comp.type,
          status: comp.status,
        },
      };
      symbols.set(compId, compEntry);
      addByName(comp.title, compId);
      addByName(comp.uuid, compId);
    }

    // 4. Index Implemented Requirements
    for (const ir of doc.controlImplementation?.implementedRequirements ?? []) {
      const irId = idCounter++ as SymbolId;
      docChildren.push(irId);
      const irEntry: SymbolEntry = {
        id: irId,
        name: ir.controlId,
        kind: "Interface",
        ruleName: "oscal_implemented_requirement",
        namePath: `${docEntry.name}.${ir.controlId}`,
        fieldName: null,
        parentId: docId,
        startOffset: ir.range?.startOffset ?? 0,
        endOffset: ir.range?.endOffset ?? 0,
        exports: [],
        inherits: [],
        language: "oscal",
        resourceId: uri,
        metadata: {
          uuid: ir.uuid,
          controlId: ir.controlId,
          description: ir.description,
        },
      };
      symbols.set(irId, irEntry);
      addByName(ir.controlId, irId);
      addByName(ir.uuid, irId);
    }

    // 5. Index Findings & POA&M Items
    for (const finding of doc.findings ?? []) {
      const fId = idCounter++ as SymbolId;
      docChildren.push(fId);
      const fEntry: SymbolEntry = {
        id: fId,
        name: finding.title,
        kind: "Event",
        ruleName: "oscal_finding",
        namePath: `${docEntry.name}.${finding.title}`,
        fieldName: null,
        parentId: docId,
        startOffset: finding.range?.startOffset ?? 0,
        endOffset: finding.range?.endOffset ?? 0,
        exports: [],
        inherits: [],
        language: "oscal",
        resourceId: uri,
        metadata: {
          uuid: finding.uuid,
          targetControlId: finding.targetControlId,
          severity: finding.severity,
          status: finding.status,
        },
      };
      symbols.set(fId, fEntry);
      addByName(finding.title, fId);
      addByName(finding.uuid, fId);
    }

    for (const poam of doc.poamItems ?? []) {
      const pId = idCounter++ as SymbolId;
      docChildren.push(pId);
      const pEntry: SymbolEntry = {
        id: pId,
        name: poam.title,
        kind: "Variable",
        ruleName: "oscal_poam_item",
        namePath: `${docEntry.name}.${poam.title}`,
        fieldName: null,
        parentId: docId,
        startOffset: poam.range?.startOffset ?? 0,
        endOffset: poam.range?.endOffset ?? 0,
        exports: [],
        inherits: [],
        language: "oscal",
        resourceId: uri,
        metadata: {
          uuid: poam.uuid,
          relatedFindingUuid: poam.relatedFindingUuid,
          targetControlId: poam.targetControlId,
          status: poam.status,
        },
      };
      symbols.set(pId, pEntry);
      addByName(poam.title, pId);
      addByName(poam.uuid, pId);
    }

    childrenOf.set(docId, docChildren);
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
      for (const sym of fileIndex.symbols.values()) {
        if (sym.name.toLowerCase() === name.toLowerCase()) {
          return sym;
        }
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
