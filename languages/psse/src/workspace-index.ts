// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { isLikelyDyrContent, parseDyr } from "./parser/dyr-parser.js";
import { parseRaw } from "./parser/raw-parser.js";
import type { PsseCase, PsseDyrCase } from "./types.js";

/**
 * Workspace indexer for PSS/E RAW (`.raw`) power flow cases and Dynamic Data (`.dyr`) files.
 * Automatically links companion `.raw` and `.dyr` files in the same workspace directory.
 */
export class PsseWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileCases = new Map<string, PsseCase>();
  private fileDyrCases = new Map<string, PsseDyrCase>();
  private fileTexts = new Map<string, string>();
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

  public getCase(uri: string): PsseCase | undefined {
    const c = this.fileCases.get(uri);
    if (c && !c.dyr) {
      const companion = this.findCompanionDyr(uri);
      if (companion) {
        c.dyr = companion.dyr;
      }
    }
    return c;
  }

  public getDyrCase(uri: string): PsseDyrCase | undefined {
    return this.fileDyrCases.get(uri);
  }

  public getFileText(uri: string): string | undefined {
    return this.fileTexts.get(uri);
  }

  /**
   * Finds a companion `.dyr` dynamic data model for a given `.raw` URI.
   * Prioritizes exact basename match (e.g. `ieee14.raw` -> `ieee14.dyr`),
   * then falls back to any `.dyr` file in the same directory or workspace.
   */
  public findCompanionDyr(rawUri: string): { uri: string; dyr: PsseDyrCase } | undefined {
    if (this.fileDyrCases.size === 0) return undefined;
    const stem = rawUri.replace(/\.[^./\\]+$/, "").toLowerCase();
    const dir = rawUri.slice(0, Math.max(0, rawUri.lastIndexOf("/")));

    // 1. Exact stem match
    for (const [dyrUri, dyr] of this.fileDyrCases.entries()) {
      const dyrStem = dyrUri.replace(/\.[^./\\]+$/, "").toLowerCase();
      if (dyrStem === stem) {
        return { uri: dyrUri, dyr };
      }
    }

    // 2. Same directory match
    for (const [dyrUri, dyr] of this.fileDyrCases.entries()) {
      const dyrDir = dyrUri.slice(0, Math.max(0, dyrUri.lastIndexOf("/")));
      if (dir && dyrDir === dir) {
        return { uri: dyrUri, dyr };
      }
    }

    // 3. Any indexed .dyr in workspace
    const first = this.fileDyrCases.entries().next();
    if (!first.done) {
      return { uri: first.value[0], dyr: first.value[1] };
    }
    return undefined;
  }

  /**
   * Finds a companion `.raw` power-flow case for a given `.dyr` URI.
   */
  public findCompanionRaw(dyrUri: string): { uri: string; psseCase: PsseCase } | undefined {
    if (this.fileCases.size === 0) return undefined;
    const stem = dyrUri.replace(/\.[^./\\]+$/, "").toLowerCase();
    const dir = dyrUri.slice(0, Math.max(0, dyrUri.lastIndexOf("/")));

    for (const [rawUri, psseCase] of this.fileCases.entries()) {
      const rawStem = rawUri.replace(/\.[^./\\]+$/, "").toLowerCase();
      if (rawStem === stem) {
        return { uri: rawUri, psseCase };
      }
    }

    for (const [rawUri, psseCase] of this.fileCases.entries()) {
      const rawDir = rawUri.slice(0, Math.max(0, rawUri.lastIndexOf("/")));
      if (dir && rawDir === dir) {
        return { uri: rawUri, psseCase };
      }
    }

    const first = this.fileCases.entries().next();
    if (!first.done) {
      return { uri: first.value[0], psseCase: first.value[1] };
    }
    return undefined;
  }

  /**
   * Parses or retrieves a `PsseCase` and automatically attaches any companion `.dyr` dynamic data.
   */
  public getMergedCase(uri: string, text?: string): PsseCase {
    const parsed = text ? parseRaw(text) : (this.fileCases.get(uri) ?? parseRaw(""));
    if (text && !uri.toLowerCase().endsWith(".dyr")) {
      this.fileCases.set(uri, parsed);
    }
    if (!parsed.dyr) {
      const companion = this.findCompanionDyr(uri);
      if (companion) {
        parsed.dyr = companion.dyr;
      }
    }
    return parsed;
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
        // Ignore loader errors during incremental re-indexing
      }
    }
  }

  public indexFile(uri: string, text: string): SymbolIndex {
    this.fileTexts.set(uri, text);
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    let baseId = this.fileBaseIds.get(uri);
    if (baseId === undefined) {
      baseId = this.nextFileSlot++ * 100_000;
      this.fileBaseIds.set(uri, baseId);
    }
    let idCounter = baseId;

    const isDyr = uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(text);
    if (isDyr) {
      const dyrCase = parseDyr(text);
      this.fileDyrCases.set(uri, dyrCase);

      // Attach to any matching companion .raw case already indexed
      const companionRaw = this.findCompanionRaw(uri);
      if (companionRaw) {
        companionRaw.psseCase.dyr = dyrCase;
      }

      const rootId = idCounter++ as SymbolId;
      const rootName = "PsseDynamicData";
      const rootEntry: SymbolEntry = {
        id: rootId,
        name: rootName,
        kind: "Class",
        ruleName: "psse_dyr_case",
        namePath: rootName,
        fieldName: null,
        parentId: null,
        startOffset: 0,
        endOffset: text.length,
        exports: [],
        inherits: [],
        language: "psse",
        resourceId: uri,
        metadata: {
          recordCount: dyrCase.records.length,
        },
      };
      symbols.set(rootId, rootEntry);
      byName.set(rootName, [rootId]);
      childrenOf.set(null, [rootId]);

      const childIds: SymbolId[] = [];
      for (const rec of dyrCase.records) {
        const id = idCounter++ as SymbolId;
        const symName = `Dyr_${rec.model}_${rec.ibus}_${rec.id}`;
        const entry: SymbolEntry = {
          id,
          name: symName,
          kind: "Component",
          ruleName: "psse_dyr_record",
          namePath: symName,
          fieldName: null,
          parentId: rootId,
          startOffset: rec.span?.startOffset ?? 0,
          endOffset: rec.span?.endOffset ?? 0,
          exports: [],
          inherits: [],
          language: "psse",
          resourceId: uri,
          metadata: {
            busNumber: rec.ibus,
            model: rec.model,
            machineId: rec.id,
            category: rec.category,
            namedParams: rec.namedParams,
          },
        };
        symbols.set(id, entry);
        const existing = byName.get(symName) ?? [];
        existing.push(id);
        byName.set(symName, existing);
        childIds.push(id);
      }
      childrenOf.set(rootId, childIds);
      const index: SymbolIndex = { symbols, byName, childrenOf };
      this.fileIndices.set(uri, index);
      return index;
    }

    const parsedCase = parseRaw(text);
    const companionDyr = this.findCompanionDyr(uri);
    if (companionDyr) {
      parsedCase.dyr = companionDyr.dyr;
    }
    this.fileCases.set(uri, parsedCase);

    // Root Case Class Symbol
    const rootId = idCounter++ as SymbolId;
    const caseName = parsedCase.title1 || "PsseCase";
    const rootEntry: SymbolEntry = {
      id: rootId,
      name: caseName,
      kind: "Class",
      ruleName: "psse_case",
      namePath: caseName,
      fieldName: null,
      parentId: null,
      startOffset: parsedCase.header.span?.startOffset ?? 0,
      endOffset: parsedCase.header.span?.endOffset ?? text.length,
      exports: [],
      inherits: [],
      language: "psse",
      resourceId: uri,
      metadata: {
        sbase: parsedCase.header.sbase,
        rev: parsedCase.header.rev,
        basfrq: parsedCase.header.basfrq,
        nBuses: parsedCase.buses.size,
        nBranches: parsedCase.branches.length,
        nGenerators: parsedCase.generators.length,
        nLoads: parsedCase.loads.length,
      },
    };
    symbols.set(rootId, rootEntry);
    byName.set(caseName, [rootId]);
    childrenOf.set(null, [rootId]);

    const childIds: SymbolId[] = [];

    // Helper to register child symbol
    function addChild(
      name: string,
      kind: string,
      span?: { startOffset: number; endOffset: number },
      meta?: Record<string, unknown>,
    ) {
      const id = idCounter++ as SymbolId;
      const entry: SymbolEntry = {
        id,
        name,
        kind,
        ruleName: "psse_component",
        namePath: name,
        fieldName: null,
        parentId: rootId,
        startOffset: span?.startOffset ?? 0,
        endOffset: span?.endOffset ?? 0,
        exports: [],
        inherits: [],
        language: "psse",
        resourceId: uri,
        metadata: meta ?? {},
      };
      symbols.set(id, entry);
      const existing = byName.get(name) ?? [];
      existing.push(id);
      byName.set(name, existing);
      childIds.push(id);
    }

    // Index Buses
    for (const b of parsedCase.buses.values()) {
      addChild(`Bus_${b.i}`, "Component", b.span, {
        busNumber: b.i,
        busName: b.name,
        baseKv: b.baseKv,
        ide: b.ide,
        vm: b.vm,
        va: b.va,
      });
      // Also register plain bus number for fast navigation
      const strId = String(b.i);
      const existing = byName.get(strId) ?? [];
      const busSymId = (idCounter - 1) as SymbolId;
      if (!existing.includes(busSymId)) {
        existing.push(busSymId);
        byName.set(strId, existing);
      }
    }

    // Index Generators
    for (const g of parsedCase.generators) {
      addChild(`Gen_${g.i}_${g.id}`, "Component", g.span, {
        busNumber: g.i,
        genId: g.id,
        pg: g.pg,
        qg: g.qg,
        status: g.stat,
      });
    }

    // Index Branches
    for (const br of parsedCase.branches) {
      addChild(`Branch_${br.i}_${br.j}_${br.ckt}`, "Component", br.span, {
        fromBus: br.i,
        toBus: br.j,
        ckt: br.ckt,
        r: br.r,
        x: br.x,
        rateA: br.rateA,
        status: br.st,
      });
    }

    // Index Transformers
    for (const t of parsedCase.transformers) {
      addChild(`Xfmr_${t.i}_${t.j}_${t.ckt}`, "Component", t.span, {
        fromBus: t.i,
        toBus: t.j,
        ckt: t.ckt,
        windv1: t.windv1,
        status: t.stat,
      });
    }

    // Index Loads
    for (const l of parsedCase.loads) {
      addChild(`Load_${l.i}_${l.id}`, "Component", l.span, {
        busNumber: l.i,
        loadId: l.id,
        pl: l.pl,
        ql: l.ql,
        status: l.status,
      });
    }

    childrenOf.set(rootId, childIds);

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }
}
