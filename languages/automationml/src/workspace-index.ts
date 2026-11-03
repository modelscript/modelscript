// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/automationml — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for IEC 62714 AutomationML (.aml, .caex) documents.
 * Indexes InstanceHierarchies, InternalElements, ExternalInterfaces, Attributes,
 * SystemUnitClasses, RoleClasses, and InterfaceClasses.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseAutomationML } from "./parser/index.js";
import type { AmlDocument, AmlInternalElement } from "./types.js";

export class AutomationMLWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, AmlDocument>();
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

  public getDocument(uri: string): AmlDocument | undefined {
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

    const addByName = (key: string, id: SymbolId): void => {
      const list = byName.get(key) ?? [];
      if (!list.includes(id)) {
        list.push(id);
        byName.set(key, list);
      }
    };

    const doc = parseAutomationML(text, uri);
    this.fileDocuments.set(uri, doc);

    const rootChildren: SymbolId[] = [];

    // 1. Index SystemUnitClassLibs
    for (const lib of doc.systemUnitClassLibs) {
      for (const cls of lib.classes) {
        const clsId = idCounter++ as SymbolId;
        rootChildren.push(clsId);
        const fullPath = `${lib.name}/${cls.name}`;
        const entry: SymbolEntry = {
          id: clsId,
          name: cls.name,
          kind: "Class",
          ruleName: "aml_system_unit_class",
          namePath: fullPath,
          fieldName: null,
          parentId: null,
          startOffset: cls.range.startOffset,
          endOffset: cls.range.endOffset,
          exports: [],
          inherits: cls.refBaseClassPath ? [cls.refBaseClassPath] : [],
          language: "automationml",
          resourceId: uri,
          metadata: {
            library: lib.name,
            refBaseClassPath: cls.refBaseClassPath,
          },
        };
        symbols.set(clsId, entry);
        addByName(cls.name, clsId);
        addByName(fullPath, clsId);
      }
    }

    // 2. Index RoleClassLibs
    for (const lib of doc.roleClassLibs) {
      for (const cls of lib.classes) {
        const clsId = idCounter++ as SymbolId;
        rootChildren.push(clsId);
        const fullPath = `${lib.name}/${cls.name}`;
        const entry: SymbolEntry = {
          id: clsId,
          name: cls.name,
          kind: "Class",
          ruleName: "aml_role_class",
          namePath: fullPath,
          fieldName: null,
          parentId: null,
          startOffset: cls.range.startOffset,
          endOffset: cls.range.endOffset,
          exports: [],
          inherits: cls.refBaseClassPath ? [cls.refBaseClassPath] : [],
          language: "automationml",
          resourceId: uri,
          metadata: {
            library: lib.name,
            pprCategory: cls.pprCategory,
            refBaseClassPath: cls.refBaseClassPath,
          },
        };
        symbols.set(clsId, entry);
        addByName(cls.name, clsId);
        addByName(fullPath, clsId);
      }
    }

    // 3. Index InterfaceClassLibs
    for (const lib of doc.interfaceClassLibs) {
      for (const cls of lib.classes) {
        const clsId = idCounter++ as SymbolId;
        rootChildren.push(clsId);
        const fullPath = `${lib.name}/${cls.name}`;
        const entry: SymbolEntry = {
          id: clsId,
          name: cls.name,
          kind: "Interface",
          ruleName: "aml_interface_class",
          namePath: fullPath,
          fieldName: null,
          parentId: null,
          startOffset: cls.range.startOffset,
          endOffset: cls.range.endOffset,
          exports: [],
          inherits: cls.refBaseClassPath ? [cls.refBaseClassPath] : [],
          language: "automationml",
          resourceId: uri,
          metadata: {
            library: lib.name,
            category: cls.category,
            refBaseClassPath: cls.refBaseClassPath,
          },
        };
        symbols.set(clsId, entry);
        addByName(cls.name, clsId);
        addByName(fullPath, clsId);
      }
    }

    // 4. Index InstanceHierarchies and InternalElements recursively
    const indexElement = (el: AmlInternalElement, parentSymId: SymbolId, parentPath: string): SymbolId => {
      const elSymId = idCounter++ as SymbolId;
      const elPath = `${parentPath}.${el.name}`;
      const elEntry: SymbolEntry = {
        id: elSymId,
        name: el.name,
        kind: "Component",
        ruleName: "aml_internal_element",
        namePath: elPath,
        fieldName: null,
        parentId: parentSymId,
        startOffset: el.range.startOffset,
        endOffset: el.range.endOffset,
        exports: [],
        inherits: el.refBaseSystemUnitPath ? [el.refBaseSystemUnitPath] : [],
        language: "automationml",
        resourceId: uri,
        metadata: {
          elementId: el.id,
          pprCategory: el.pprCategory,
          refBaseSystemUnitPath: el.refBaseSystemUnitPath,
          frame: el.frame,
        },
      };
      symbols.set(elSymId, elEntry);
      addByName(el.name, elSymId);
      addByName(el.id, elSymId);

      const elChildren: SymbolId[] = [];

      for (const attr of el.attributes) {
        const attrId = idCounter++ as SymbolId;
        elChildren.push(attrId);
        const attrEntry: SymbolEntry = {
          id: attrId,
          name: attr.name,
          kind: "Variable",
          ruleName: "aml_attribute",
          namePath: `${elPath}.${attr.name}`,
          fieldName: null,
          parentId: elSymId,
          startOffset: attr.range.startOffset,
          endOffset: attr.range.endOffset,
          exports: [],
          inherits: [],
          language: "automationml",
          resourceId: uri,
          metadata: {
            dataType: attr.dataType,
            unit: attr.unit,
            value: attr.value,
          },
        };
        symbols.set(attrId, attrEntry);
        addByName(attr.name, attrId);
      }

      for (const iface of el.interfaces) {
        const ifId = idCounter++ as SymbolId;
        elChildren.push(ifId);
        const ifEntry: SymbolEntry = {
          id: ifId,
          name: iface.name,
          kind: "Component",
          ruleName: "aml_external_interface",
          namePath: `${elPath}.${iface.name}`,
          fieldName: null,
          parentId: elSymId,
          startOffset: iface.range.startOffset,
          endOffset: iface.range.endOffset,
          exports: [],
          inherits: iface.refBaseClassPath ? [iface.refBaseClassPath] : [],
          language: "automationml",
          resourceId: uri,
          metadata: {
            interfaceId: iface.id,
            direction: iface.direction,
            category: iface.category,
            dataType: iface.dataType,
            refUri: iface.refUri,
          },
        };
        symbols.set(ifId, ifEntry);
        addByName(iface.name, ifId);
        addByName(`${el.id}:${iface.name}`, ifId);
        addByName(`${el.name}:${iface.name}`, ifId);
      }

      for (const childEl of el.children) {
        elChildren.push(indexElement(childEl, elSymId, elPath));
      }

      childrenOf.set(elSymId, elChildren);
      return elSymId;
    };

    for (const ih of doc.instanceHierarchies) {
      const ihId = idCounter++ as SymbolId;
      rootChildren.push(ihId);
      const ihEntry: SymbolEntry = {
        id: ihId,
        name: ih.name,
        kind: "Package",
        ruleName: "aml_instance_hierarchy",
        namePath: ih.name,
        fieldName: null,
        parentId: null,
        startOffset: ih.range.startOffset,
        endOffset: ih.range.endOffset,
        exports: [],
        inherits: [],
        language: "automationml",
        resourceId: uri,
        metadata: {
          version: ih.version,
          elementCount: ih.elements.length,
        },
      };
      symbols.set(ihId, ihEntry);
      addByName(ih.name, ihId);

      const ihChildren: SymbolId[] = [];
      for (const el of ih.elements) {
        ihChildren.push(indexElement(el, ihId, ih.name));
      }
      childrenOf.set(ihId, ihChildren);
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
