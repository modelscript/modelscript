// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for SPICE analog netlists (.cir, .sp, .net, .lib).
 * Indexes subcircuits (.SUBCKT), models (.MODEL), components, and cross-file
 * inclusions (.INCLUDE, .LIB) across the workspace for instant lookup and LSP navigation.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseSpice } from "./parser/spice-parser.js";
import type { SpiceCircuit } from "./types.js";

export class SpiceWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileCircuits = new Map<string, SpiceCircuit>();
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

  public getDocument(uri: string): SpiceCircuit | undefined {
    return this.fileCircuits.get(uri);
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
        // Ignore loader errors during incremental reindexing
      }
    }
  }

  public indexFile(uri: string, text: string): SymbolIndex {
    let circuit: SpiceCircuit;
    try {
      circuit = parseSpice(text);
      this.fileCircuits.set(uri, circuit);
    } catch {
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

    const circuitTitle = circuit.title || this.deriveNameFromUri(uri);

    // Root symbol for the circuit package
    const rootId = idCounter++;
    const rootEntry: SymbolEntry = {
      id: rootId,
      kind: "Package",
      name: circuitTitle,
      ruleName: "spice_circuit",
      namePath: circuitTitle,
      startOffset: 0,
      endOffset: text.length,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: {
        language: "spice",
        componentCount: circuit.components.length,
        subcircuitCount: circuit.subcircuits.size,
        modelCount: circuit.models.size,
      },
      fieldName: null,
      resourceId: uri,
      language: "spice",
    };

    symbols.set(rootId, rootEntry);
    byName.set(circuitTitle, [rootId]);

    const rootChildren: SymbolId[] = [];
    childrenOf.set(null, [rootId]);
    childrenOf.set(rootId, rootChildren);

    // Helper to register a symbol
    const addSymbol = (
      name: string,
      kind: string,
      ruleName: string,
      span: { startOffset?: number; endOffset?: number } | undefined,
      meta: Record<string, unknown>,
    ) => {
      const symId = idCounter++;
      const entry: SymbolEntry = {
        id: symId,
        kind,
        name,
        ruleName,
        namePath: `${circuitTitle}.${name}`,
        startOffset: span?.startOffset ?? 0,
        endOffset: span?.endOffset ?? 0,
        parentId: rootId,
        exports: [],
        inherits: [],
        metadata: {
          language: "spice",
          ...meta,
        },
        fieldName: null,
        resourceId: uri,
        language: "spice",
      };

      symbols.set(symId, entry);
      rootChildren.push(symId);

      const existing = byName.get(name) || [];
      existing.push(symId);
      byName.set(name, existing);

      // Case-insensitive lookup alias
      const upper = name.toUpperCase();
      if (upper !== name) {
        const existingUpper = byName.get(upper) || [];
        existingUpper.push(symId);
        byName.set(upper, existingUpper);
      }

      return symId;
    };

    // 1. Index Subcircuits (.SUBCKT)
    for (const sub of circuit.subcircuits.values()) {
      addSymbol(sub.name, "Class", "spice_subcircuit", sub.span, {
        ports: sub.ports,
        componentCount: sub.components.length,
      });
    }

    // 2. Index Models (.MODEL)
    for (const model of circuit.models.values()) {
      addSymbol(model.name, "Class", "spice_model", model.span, {
        modelType: model.type,
        params: Array.from(model.params.entries()),
      });
    }

    // 3. Index Components
    for (const comp of circuit.components) {
      addSymbol(comp.name, "Variable", "spice_component", comp.span, {
        kind: comp.kind,
        nodes: comp.nodes,
        value: comp.value,
        subcktName: comp.subcktName,
      });
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
            if (sym && !results.includes(sym)) results.push(sym);
          }
        }
      }
    }
    return results;
  }

  public resolveQualified(name: string, fromUri?: string): SymbolEntry | undefined {
    const upperName = name.toUpperCase();

    // Prefer local document first
    if (fromUri) {
      const idx = this.fileIndices.get(fromUri);
      if (idx) {
        const ids = idx.byName.get(name) ?? idx.byName.get(upperName);
        if (ids && ids.length > 0) return idx.symbols.get(ids[0]!);
      }
    }

    // Search globally across all indexed documents
    for (const idx of this.fileIndices.values()) {
      const ids = idx.byName.get(name) ?? idx.byName.get(upperName);
      if (ids && ids.length > 0) return idx.symbols.get(ids[0]!);
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
        targetName = sym.name.toUpperCase();
        break;
      }
    }

    if (!targetName) return refs;

    // Search across all circuits for subcircuit instances or model usages matching targetName
    for (const [uri, circuit] of this.fileCircuits) {
      for (const comp of circuit.components) {
        if (comp.subcktName?.toUpperCase() === targetName || comp.model?.toUpperCase() === targetName) {
          if (comp.span) {
            refs.push({
              uri,
              startOffset: comp.span.startOffset,
              endOffset: comp.span.endOffset,
            });
          }
        }
      }
    }

    return refs;
  }

  private deriveNameFromUri(uri: string): string {
    const filename = uri.split("/").pop() || "circuit.cir";
    return filename.replace(/\.(cir|sp|net|lib|mod)$/i, "");
  }
}
