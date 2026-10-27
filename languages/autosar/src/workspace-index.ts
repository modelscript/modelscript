// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseArxml } from "./parser/index.js";
import type { AutosarModel, AutosarPackage, AutosarSwComponent } from "./types.js";

/**
 * Multi-File Workspace Indexer for AUTOSAR Classic and Adaptive ARXML architectures.
 * Indexes packages, software component types, port prototypes, interfaces, and PDUs.
 */
export class AutosarWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileModels = new Map<string, AutosarModel>();
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

  public getModel(uri: string): AutosarModel | undefined {
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
        // Fallback
      }
    }
  }

  public indexFile(uri: string, content: string): SymbolIndex {
    this._version++;
    let baseId = this.fileBaseIds.get(uri);
    if (!baseId) {
      baseId = this.nextFileSlot * 100_000;
      this.nextFileSlot++;
      this.fileBaseIds.set(uri, baseId);
    }

    const fileBaseId = baseId;
    let localIdCounter = 1;
    const nextId = (): SymbolId => (fileBaseId + localIdCounter++) as SymbolId;

    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    const record = (
      name: string,
      kind: string,
      parentId: SymbolId | null,
      namePath: string[],
      metadata: Record<string, unknown> = {},
    ): SymbolId => {
      const id = nextId();
      const entry: SymbolEntry = {
        id,
        name,
        kind,
        ruleName: kind,
        namePath: namePath.join("."),
        fieldName: name,
        parentId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "autosar",
        resourceId: uri,
        metadata,
      };

      symbols.set(id, entry);

      const list = byName.get(name) ?? [];
      list.push(id);
      byName.set(name, list);

      const children = childrenOf.get(parentId) ?? [];
      children.push(id);
      childrenOf.set(parentId, children);

      return id;
    };

    try {
      const model = parseArxml(content);
      this.fileModels.set(uri, model);

      const indexPackage = (pkg: AutosarPackage, parentId: SymbolId | null, pathPrefix: string[]) => {
        const currentPath = [...pathPrefix, pkg.shortName];
        const pkgId = record(pkg.shortName, "Package", parentId, currentPath);

        // Elements inside package
        for (const [elName, el] of pkg.elements) {
          if ("kind" in el && typeof el.kind === "string" && el.kind.includes("SW-COMPONENT")) {
            const swc = el as AutosarSwComponent;
            const swcPath = [...currentPath, elName];
            const swcId = record(elName, "Class", pkgId, swcPath, { swcKind: swc.kind });

            // Index ports
            for (const [portName, port] of swc.ports) {
              record(portName, "Component", swcId, [...swcPath, portName], {
                direction: port.direction,
                interfaceRef: port.interfaceRef,
              });
            }
          } else {
            record(elName, "Interface", pkgId, [...currentPath, elName]);
          }
        }

        // Subpackages
        for (const sub of pkg.subPackages.values()) {
          indexPackage(sub, pkgId, currentPath);
        }
      };

      for (const pkg of model.packages.values()) {
        indexPackage(pkg, null, []);
      }
    } catch {
      // Return empty index on failure
    }

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  public lookup(name: string): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    for (const fileIndex of this.fileIndices.values()) {
      const ids = fileIndex.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const entry = fileIndex.symbols.get(id);
          if (entry) results.push(entry);
        }
      }
    }
    return results;
  }

  public unregister(uri: string): void {
    this._version++;
    this.fileIndices.delete(uri);
    this.fileModels.delete(uri);
    this.fileBaseIds.delete(uri);
  }
}
