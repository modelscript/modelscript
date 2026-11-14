// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry, SymbolId, SymbolIndex } from "../runtime.js";

/**
 * Metadata declared in `package.json#modelscript` for a pre-indexed component library package.
 * Allows any language (PSCAD, Modelica, SPICE, etc.) to distribute symbol stubs, diagram/port
 * geometry, and WASM/FMU runtime implementations using standard npm packages.
 */
export interface ModelscriptLibraryManifest {
  category: "library";
  language: string;
  /** Relative path to a JSON file containing `LibrarySymbolStub[]`. */
  symbols: string;
  /** Optional relative path to a JSON file containing `DiagramComponentSpec[]`. */
  diagrams?: string | undefined;
  /** Optional sandboxed runtime implementations (WASM module or FMI 3.0 FMUs). */
  runtime?:
    | {
        wasm?: string | undefined;
        fmus?: string | undefined;
      }
    | undefined;
}

/**
 * Serialized symbol stub that materializes directly into `SymbolEntry` without parsing raw source.
 */
export interface LibrarySymbolStub {
  name: string;
  kind: string;
  ruleName?: string | undefined;
  namePath: string;
  parentNamePath?: string | undefined;
  exports?: string[] | undefined;
  inherits?: string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Language-agnostic port geometry and domain specification for diagram editors/builders.
 */
export interface DiagramPortSpec {
  name: string;
  kind: "electrical" | "signal" | "thermal" | "mechanical" | "fluid" | string;
  side: "left" | "right" | "top" | "bottom";
  dx: number;
  dy: number;
}

/**
 * Language-agnostic component diagram specification loaded from `package.json#modelscript.diagrams`.
 */
export interface DiagramComponentSpec {
  namePath: string;
  aliases?: string[] | undefined;
  label?: string | undefined;
  category?: string | undefined;
  domain?: string | undefined;
  width: number;
  height: number;
  ports: DiagramPortSpec[];
  svg?: string | undefined;
}

export interface LoadedLibraryPackage {
  packageName: string;
  version: string;
  manifest: ModelscriptLibraryManifest;
  symbols: LibrarySymbolStub[];
  diagrams: DiagramComponentSpec[];
  wasmBytes?: Uint8Array | undefined;
}

/**
 * Type-guard for `package.json` objects that declare a `modelscript` library manifest.
 */
export function isModelscriptLibraryPackageJson(
  pkgJson: unknown,
): pkgJson is { name: string; version?: string; modelscript: ModelscriptLibraryManifest } {
  if (!pkgJson || typeof pkgJson !== "object") return false;
  const obj = pkgJson as Record<string, unknown>;
  const ms = obj["modelscript"];
  if (!ms || typeof ms !== "object") return false;
  const m = ms as Record<string, unknown>;
  return (
    m["category"] === "library" &&
    typeof m["language"] === "string" &&
    m["language"].length > 0 &&
    typeof m["symbols"] === "string" &&
    m["symbols"].length > 0
  );
}

/**
 * Materializes `LibrarySymbolStub[]` into a `SymbolIndex` (or augments an existing one).
 */
export function materializeLibrarySymbols(
  pkgName: string,
  language: string,
  stubs: LibrarySymbolStub[],
  target?: SymbolIndex,
): SymbolIndex {
  const index: SymbolIndex = target ?? {
    symbols: new Map<SymbolId, SymbolEntry>(),
    byName: new Map<string, SymbolId[]>(),
    childrenOf: new Map<SymbolId | null, SymbolId[]>(),
  };

  let nextId = 1;
  for (const existingId of index.symbols.keys()) {
    if (existingId >= nextId) nextId = existingId + 1;
  }

  const pathToId = new Map<string, SymbolId>();
  for (const entry of index.symbols.values()) {
    pathToId.set(entry.namePath, entry.id);
  }

  for (const stub of stubs) {
    if (pathToId.has(stub.namePath)) continue;
    const id = nextId++;
    const parentId = stub.parentNamePath ? (pathToId.get(stub.parentNamePath) ?? null) : null;
    const entry: SymbolEntry = {
      id,
      kind: stub.kind,
      name: stub.name,
      ruleName: stub.ruleName ?? "library_stub",
      namePath: stub.namePath,
      startOffset: 0,
      endOffset: 0,
      parentId,
      exports: stub.exports ?? [],
      inherits: stub.inherits ?? [],
      metadata: stub.metadata ?? {},
      fieldName: null,
      resourceId: pkgName,
      documentUri: `pkg://${pkgName}/${stub.namePath}`,
      language,
    };

    index.symbols.set(id, entry);
    pathToId.set(stub.namePath, id);

    const byNameList = index.byName.get(stub.name) ?? [];
    byNameList.push(id);
    index.byName.set(stub.name, byNameList);

    const childrenList = index.childrenOf.get(parentId) ?? [];
    childrenList.push(id);
    index.childrenOf.set(parentId, childrenList);
  }

  return index;
}

/**
 * Process-wide registry of pre-indexed `package.json#modelscript` libraries.
 * Browser-safe: `registerLibraryBundle` accepts in-memory JSON/WASM payloads for Morsel.
 */
export class LibraryPackageRegistry {
  private readonly packages = new Map<string, LoadedLibraryPackage>();
  private readonly diagramsByLang = new Map<string, Map<string, DiagramComponentSpec>>();

  registerLibraryBundle(
    pkgJson: { name: string; version?: string; modelscript: ModelscriptLibraryManifest },
    payload: {
      symbols: LibrarySymbolStub[];
      diagrams?: DiagramComponentSpec[] | undefined;
      wasmBytes?: Uint8Array | undefined;
    },
  ): LoadedLibraryPackage {
    const lang = pkgJson.modelscript.language.toLowerCase();
    const loaded: LoadedLibraryPackage = {
      packageName: pkgJson.name,
      version: pkgJson.version ?? "0.0.0",
      manifest: pkgJson.modelscript,
      symbols: payload.symbols,
      diagrams: payload.diagrams ?? [],
      wasmBytes: payload.wasmBytes,
    };
    this.packages.set(`${lang}:${pkgJson.name}`, loaded);

    let diagMap = this.diagramsByLang.get(lang);
    if (!diagMap) {
      diagMap = new Map<string, DiagramComponentSpec>();
      this.diagramsByLang.set(lang, diagMap);
    }
    for (const d of loaded.diagrams) {
      diagMap.set(d.namePath, d);
      diagMap.set(d.namePath.toLowerCase(), d);
      for (const alias of d.aliases ?? []) {
        diagMap.set(alias, d);
        diagMap.set(alias.toLowerCase(), d);
      }
    }
    return loaded;
  }

  getPackagesForLanguage(language: string): LoadedLibraryPackage[] {
    const lang = language.toLowerCase();
    const out: LoadedLibraryPackage[] = [];
    for (const pkg of this.packages.values()) {
      if (pkg.manifest.language.toLowerCase() === lang) out.push(pkg);
    }
    return out;
  }

  getDiagramSpec(language: string, nameOrAlias: string): DiagramComponentSpec | undefined {
    const diagMap = this.diagramsByLang.get(language.toLowerCase());
    if (!diagMap) return undefined;
    return diagMap.get(nameOrAlias) ?? diagMap.get(nameOrAlias.toLowerCase());
  }

  materializeSymbolIndex(language: string, target?: SymbolIndex): SymbolIndex {
    let idx = target;
    for (const pkg of this.getPackagesForLanguage(language)) {
      idx = materializeLibrarySymbols(pkg.packageName, pkg.manifest.language, pkg.symbols, idx);
    }
    return (
      idx ?? {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      }
    );
  }

  /**
   * Node.js helper: loads a `package.json#modelscript` library directory from disk.
   */
  async loadLibraryFromDir(dirPath: string): Promise<LoadedLibraryPackage | undefined> {
    const fsId = "node:fs";
    const pathId = "node:path";
    const fs = await import(fsId);
    const path = await import(pathId);
    const pkgPath = path.join(dirPath, "package.json");
    if (!fs.existsSync(pkgPath)) return undefined;

    const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (!isModelscriptLibraryPackageJson(pkgJson)) return undefined;

    const symbolsPath = path.resolve(dirPath, pkgJson.modelscript.symbols);
    const symbols: LibrarySymbolStub[] = fs.existsSync(symbolsPath)
      ? JSON.parse(fs.readFileSync(symbolsPath, "utf-8"))
      : [];

    let diagrams: DiagramComponentSpec[] | undefined;
    if (pkgJson.modelscript.diagrams) {
      const diagPath = path.resolve(dirPath, pkgJson.modelscript.diagrams);
      if (fs.existsSync(diagPath)) {
        diagrams = JSON.parse(fs.readFileSync(diagPath, "utf-8"));
      }
    }

    let wasmBytes: Uint8Array | undefined;
    if (pkgJson.modelscript.runtime?.wasm) {
      const wasmPath = path.resolve(dirPath, pkgJson.modelscript.runtime.wasm);
      if (fs.existsSync(wasmPath)) {
        wasmBytes = new Uint8Array(fs.readFileSync(wasmPath));
      }
    }

    return this.registerLibraryBundle(pkgJson, { symbols, diagrams, wasmBytes });
  }

  clear(): void {
    this.packages.clear();
    this.diagramsByLang.clear();
  }
}

export const globalLibraryRegistry = new LibraryPackageRegistry();
