// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseOpenScenario } from "./parser/openscenario-parser.js";
import type { OpenScenarioDocument } from "./types.js";

/**
 * Multi-file workspace indexer for ASAM OpenSCENARIO documents (.xosc, .osc).
 */
export class OpenScenarioWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, OpenScenarioDocument>();
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

  public getDocument(uri: string): OpenScenarioDocument | undefined {
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

  public reindexDocument(uri: string, loader?: () => unknown): void {
    this._version++;
    if (loader) {
      try {
        const res = loader();
        const obj = typeof res === "object" && res !== null ? (res as { sourceText?: unknown; text?: unknown }) : null;
        const text = typeof res === "string" ? res : (obj?.sourceText ?? obj?.text);
        if (typeof text === "string") {
          this.indexFile(uri, text);
        }
      } catch {
        // Ignore loader errors during incremental re-indexing
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
        ruleName: "openscenario_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "openscenario",
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
      const doc = parseOpenScenario(text, uri);
      this.fileDocuments.set(uri, doc);

      // Root Scenario symbol
      const rootName = doc.header.description || "OpenSCENARIO";
      const rootId = addSymbol(rootName, "package", null, 0, text.length, {
        author: doc.header.author,
        revMajor: doc.header.revMajor,
      });

      // Index Parameters
      for (const p of doc.parameters) {
        addSymbol(p.name, "variable", rootId, 0, 50, {
          type: p.parameterType,
          value: p.value,
        });
      }

      // Index Entities
      for (const [name, ent] of doc.entities) {
        const start = ent.range?.startOffset ?? 0;
        const end = ent.range?.endOffset ?? 50;
        addSymbol(name, "class", rootId, start, end, {
          objectType: ent.objectType,
          isEgo: ent.isEgo,
          category: ent.category,
        });
      }

      // Index Stories, Acts, Maneuvers, Events
      for (const story of doc.stories) {
        const sStart = story.range?.startOffset ?? 0;
        const sEnd = story.range?.endOffset ?? 50;
        const storyId = addSymbol(story.name, "package", rootId, sStart, sEnd);

        for (const act of story.acts) {
          const aStart = act.range?.startOffset ?? 0;
          const aEnd = act.range?.endOffset ?? 50;
          const actId = addSymbol(act.name, "class", storyId, aStart, aEnd);

          for (const mg of act.maneuverGroups) {
            for (const m of mg.maneuvers) {
              const mStart = m.range?.startOffset ?? 0;
              const mEnd = m.range?.endOffset ?? 50;
              const mId = addSymbol(m.name, "component", actId, mStart, mEnd);

              for (const ev of m.events) {
                const evStart = ev.range?.startOffset ?? 0;
                const evEnd = ev.range?.endOffset ?? 50;
                addSymbol(ev.name, "method", mId, evStart, evEnd, {
                  priority: ev.priority,
                  actionsCount: ev.actions.length,
                });
              }
            }
          }
        }
      }
    } catch {
      // Return partial symbol map if parsing failed
    }

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  public getSymbols(uri: string): SymbolEntry[] {
    const idx = this.fileIndices.get(uri);
    return idx ? Array.from(idx.symbols.values()) : [];
  }

  public findDefinition(name: string): SymbolEntry | undefined {
    for (const idx of this.fileIndices.values()) {
      const ids = idx.byName.get(name);
      if (ids && ids.length > 0 && ids[0] !== undefined) {
        const sym = idx.symbols.get(ids[0]);
        if (sym) return sym;
      }
    }
    return undefined;
  }

  public findReferences(name: string): SymbolEntry[] {
    const refs: SymbolEntry[] = [];
    for (const idx of this.fileIndices.values()) {
      const ids = idx.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const sym = idx.symbols.get(id);
          if (sym) refs.push(sym);
        }
      }
    }
    return refs;
  }

  public clear(): void {
    this.fileIndices.clear();
    this.fileDocuments.clear();
    this.fileBaseIds.clear();
    this.nextFileSlot = 1;
    this._version++;
  }
}
