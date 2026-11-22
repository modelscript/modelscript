// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry, SymbolId, SymbolIndex } from "../runtime.js";

/**
 * Metadata declared in `package.json#modelscript` for a pre-indexed component library package.
 * Allows any language (PSCAD, Modelica, SPICE, etc.) to distribute symbol stubs, diagram/port
 * geometry, and WASM/FMU runtime implementations using standard npm packages.
 */
export type StandardActivationMode = "import" | "explicit" | "workspace";

export interface StandardCalculatorBinding {
  /** SysML v2 `calc def` qualified name or short name (e.g., `"ASME_BPVC_VIII_1::allowableStress"`). */
  calcName: string;
  /** Exported WASM function name inside `runtime.wasm` (scalar ABI or `msx_run_json`). */
  wasmExport?: string | undefined;
  /** Key into `runtime.tables` for deterministic tabular/piecewise-linear evaluation. */
  tableKey?: string | undefined;
  /** Ordered parameter names used when invoking by named or positional arguments. */
  params?: string[] | undefined;
  /** Optional physical unit label for the returned scalar. */
  returnUnit?: string | undefined;
}

export interface StandardLookupTable1D {
  kind: "piecewise-linear";
  /** Monotonically increasing independent variable samples (e.g., temperature). */
  x: number[];
  /** Dependent variable values matching `x` length (e.g., allowable stress). */
  y: number[];
  /** Out-of-bounds behavior (default: `"clamp"`). */
  extrapolation?: "clamp" | "error" | undefined;
}

export interface StandardLookupTableKeyed {
  kind: "keyed-piecewise-linear";
  /** Material / grade keyed curves (e.g., `"SA-516-70": { x: [...], y: [...] }`). */
  series: Record<string, { x: number[]; y: number[] }>;
  /** Optional numeric code mapping (e.g., `{ "1": "SA-516-70" }`) when callers pass numeric material IDs. */
  codeMap?: Record<string, string> | undefined;
  extrapolation?: "clamp" | "error" | undefined;
}

export type StandardLookupTable = StandardLookupTable1D | StandardLookupTableKeyed;

export interface StandardPackMetadata {
  /** Canonical standard identifier (e.g., `"ASME-BPVC-VIII-1"`). */
  code: string;
  /** Code edition / year (e.g., `"2023"`). */
  edition?: string | undefined;
  /** Domain compliance profile identifier (e.g., `"pressure-vessel"`). */
  profile?: string | undefined;
  /** Human-readable standard pack title. */
  title?: string | undefined;
  /** Activation policy (defaults to `"import"`). */
  activation?: StandardActivationMode | undefined;
  /** Root namespaces exported by the pack (e.g., `["ASME_BPVC_VIII_1"]`). */
  namespaces?: string[] | undefined;
  /** Bound TheoryOracle names (e.g., `["PressureVesselOracle", "CaeContractOracle"]`). */
  oracles?: string[] | undefined;
  /** Declarative lookup table or WASM calculator bindings. */
  calculators?: StandardCalculatorBinding[] | undefined;
}

/**
 * Metadata declared in `package.json#modelscript` for a library or standard-pack package.
 * Allows any language (SysML2, Modelica, PSCAD, SPICE, etc.) to distribute symbols,
 * compliance rules, diagram geometry, lookup tables, and WASM/FMU runtimes.
 */
export interface ModelscriptLibraryManifest {
  category: "library" | "standard-pack";
  language?: string | undefined;
  languages?: string[] | undefined;
  /** Relative path to a JSON file containing `LibrarySymbolStub[]`. */
  symbols?: string | undefined;
  /** Optional relative path to a JSON file containing `DiagramComponentSpec[]`. */
  diagrams?: string | undefined;
  /** Optional standard-pack compliance metadata. */
  standard?: StandardPackMetadata | undefined;
  /** Optional sandboxed runtime implementations (WASM module, lookup tables, or FMI 3.0 FMUs). */
  runtime?:
    | {
        wasm?: string | undefined;
        fmus?: string | undefined;
        tables?: Record<string, string> | undefined;
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
  languages: string[];
  symbols: LibrarySymbolStub[];
  diagrams: DiagramComponentSpec[];
  wasmBytes?: Uint8Array | undefined;
  wasmExports?: Record<string, unknown> | undefined;
  tables?: Record<string, unknown> | undefined;
}

function resolveManifestLanguages(manifest: Partial<ModelscriptLibraryManifest>): string[] {
  const langs = new Set<string>();
  if (typeof manifest.language === "string" && manifest.language.trim()) {
    langs.add(manifest.language.trim().toLowerCase());
  }
  if (Array.isArray(manifest.languages)) {
    for (const l of manifest.languages) {
      if (typeof l === "string" && l.trim()) {
        langs.add(l.trim().toLowerCase());
      }
    }
  }
  if (langs.size === 0 && manifest.category === "standard-pack") {
    langs.add("sysml2");
  }
  return [...langs];
}

function interpolate1D(
  x: number[],
  y: number[],
  queryX: number,
  extrapolation: "clamp" | "error" = "clamp",
): number | null {
  const n = Math.min(x.length, y.length);
  if (n === 0 || !Number.isFinite(queryX)) return null;
  if (n === 1) return Number.isFinite(y[0]) ? y[0]! : null;

  if (queryX <= x[0]!) {
    return extrapolation === "error" && queryX < x[0]! ? null : y[0]!;
  }
  if (queryX >= x[n - 1]!) {
    return extrapolation === "error" && queryX > x[n - 1]! ? null : y[n - 1]!;
  }

  for (let i = 0; i < n - 1; i++) {
    const x0 = x[i]!;
    const x1 = x[i + 1]!;
    if (queryX >= x0 && queryX <= x1) {
      const y0 = y[i]!;
      const y1 = y[i + 1]!;
      if (x1 === x0) return y0;
      const t = (queryX - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return null;
}

/**
 * Evaluates a declarative JSON lookup table (`StandardLookupTable`) deterministically.
 */
export function evaluateStandardLookupTable(table: unknown, args: Array<number | string | boolean>): number | null {
  if (!table || typeof table !== "object") return null;
  const obj = table as StandardLookupTable;
  const extrap = obj.extrapolation === "error" ? "error" : "clamp";

  if (obj.kind === "piecewise-linear" && Array.isArray(obj.x) && Array.isArray(obj.y)) {
    const qx = typeof args[0] === "number" ? args[0] : Number(args[0]);
    return interpolate1D(obj.x, obj.y, qx, extrap);
  }

  if (obj.kind === "keyed-piecewise-linear" && obj.series && typeof obj.series === "object") {
    if (args.length < 2) return null;
    const rawKey = String(args[0] ?? "").trim();
    const resolvedKey = obj.codeMap?.[rawKey] ?? rawKey;
    const entry = obj.series[resolvedKey] ?? obj.series[rawKey];
    if (!entry || !Array.isArray(entry.x) || !Array.isArray(entry.y)) return null;
    const qx = typeof args[1] === "number" ? args[1] : Number(args[1]);
    return interpolate1D(entry.x, entry.y, qx, extrap);
  }

  return null;
}

function tryInstantiateWasmSync(wasmBytes: Uint8Array | undefined): Record<string, unknown> | undefined {
  if (!wasmBytes || wasmBytes.byteLength === 0 || typeof WebAssembly === "undefined") return undefined;
  try {
    const mod = new WebAssembly.Module(wasmBytes as BufferSource);
    const inst = new WebAssembly.Instance(mod, {
      env: {
        abort: () => {
          throw new Error("Standard-pack WASM module aborted.");
        },
        emtdc_host_io: (_op: number, _a0: number, a1: number) => a1,
        emtdc_host_plot: () => {},
      },
    });
    return inst.exports as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Type-guard for `package.json` objects that declare a `modelscript` library or standard-pack manifest.
 */
export function isModelscriptLibraryPackageJson(
  pkgJson: unknown,
): pkgJson is { name: string; version?: string; modelscript: ModelscriptLibraryManifest } {
  if (!pkgJson || typeof pkgJson !== "object") return false;
  const obj = pkgJson as Record<string, unknown>;
  const ms = obj["modelscript"];
  if (!ms || typeof ms !== "object") return false;
  const m = ms as Record<string, unknown>;
  const cat = m["category"];
  if (cat !== "library" && cat !== "standard-pack") return false;

  const hasSingleLang = typeof m["language"] === "string" && m["language"].length > 0;
  const hasMultiLang =
    Array.isArray(m["languages"]) && m["languages"].some((l) => typeof l === "string" && l.length > 0);
  if (cat === "library") {
    const hasSymbols = typeof m["symbols"] === "string" && m["symbols"].length > 0;
    return (hasSingleLang || hasMultiLang) && (hasSymbols || Boolean(m["standard"]));
  }

  const std = m["standard"];
  const hasStandardCode = Boolean(
    std && typeof std === "object" && typeof (std as Record<string, unknown>)["code"] === "string",
  );
  return hasStandardCode || hasSingleLang || hasMultiLang;
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
 * Process-wide registry of pre-indexed `package.json#modelscript` libraries and standard packs.
 * Browser-safe: `registerLibraryBundle` accepts in-memory JSON/WASM payloads for Morsel.
 */
export class LibraryPackageRegistry {
  private readonly packages = new Map<string, LoadedLibraryPackage>();
  private readonly diagramsByLang = new Map<string, Map<string, DiagramComponentSpec>>();

  registerLibraryBundle(
    pkgJson: { name: string; version?: string; modelscript: ModelscriptLibraryManifest },
    payload: {
      symbols?: LibrarySymbolStub[] | undefined;
      diagrams?: DiagramComponentSpec[] | undefined;
      wasmBytes?: Uint8Array | undefined;
      tables?: Record<string, unknown> | undefined;
    } = {},
  ): LoadedLibraryPackage {
    const languages = resolveManifestLanguages(pkgJson.modelscript);
    const primaryLang = languages[0] ?? "sysml2";
    const wasmExports = tryInstantiateWasmSync(payload.wasmBytes);

    const loaded: LoadedLibraryPackage = {
      packageName: pkgJson.name,
      version: pkgJson.version ?? "0.0.0",
      manifest: {
        ...pkgJson.modelscript,
        language: pkgJson.modelscript.language ?? primaryLang,
        languages,
      },
      languages,
      symbols: payload.symbols ?? [],
      diagrams: payload.diagrams ?? [],
      wasmBytes: payload.wasmBytes,
      wasmExports,
      tables: payload.tables,
    };

    for (const lang of languages.length > 0 ? languages : [primaryLang]) {
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
    }
    return loaded;
  }

  async ensureWasmInstantiated(pkg: LoadedLibraryPackage): Promise<Record<string, unknown> | undefined> {
    if (pkg.wasmExports) return pkg.wasmExports;
    if (!pkg.wasmBytes || typeof WebAssembly === "undefined") return undefined;
    try {
      const compiled = await WebAssembly.compile(pkg.wasmBytes as BufferSource);
      const instance = await WebAssembly.instantiate(compiled, {
        env: {
          abort: () => {
            throw new Error("Standard-pack WASM module aborted.");
          },
          emtdc_host_io: (_op: number, _a0: number, a1: number) => a1,
          emtdc_host_plot: () => {},
        },
      });
      pkg.wasmExports = instance.exports as Record<string, unknown>;
      return pkg.wasmExports;
    } catch {
      return undefined;
    }
  }

  getPackagesForLanguage(language: string): LoadedLibraryPackage[] {
    const lang = language.toLowerCase();
    const out: LoadedLibraryPackage[] = [];
    const seen = new Set<LoadedLibraryPackage>();
    for (const pkg of this.packages.values()) {
      if (pkg.languages.includes(lang) && !seen.has(pkg)) {
        seen.add(pkg);
        out.push(pkg);
      }
    }
    return out;
  }

  getStandardPacks(): LoadedLibraryPackage[] {
    const out: LoadedLibraryPackage[] = [];
    const seen = new Set<LoadedLibraryPackage>();
    for (const pkg of this.packages.values()) {
      if ((pkg.manifest.category === "standard-pack" || pkg.manifest.standard) && !seen.has(pkg)) {
        seen.add(pkg);
        out.push(pkg);
      }
    }
    return out;
  }

  getStandardPack(codeOrName: string): LoadedLibraryPackage | undefined {
    const needle = codeOrName.toLowerCase();
    for (const pkg of this.getStandardPacks()) {
      if (
        pkg.packageName.toLowerCase() === needle ||
        pkg.manifest.standard?.code.toLowerCase() === needle ||
        pkg.manifest.standard?.profile?.toLowerCase() === needle ||
        pkg.manifest.standard?.namespaces?.some((ns) => ns.toLowerCase() === needle)
      ) {
        return pkg;
      }
    }
    return undefined;
  }

  /**
   * Synchronously evaluates a standard-pack calculator via its bound WASM export or lookup table.
   * Returns `undefined` if no matching standard calculator is registered.
   */
  invokeCalculator(calcNameOrFqn: string, args: Array<number | string | boolean>): number | boolean | undefined {
    const shortName = calcNameOrFqn.includes("::") ? calcNameOrFqn.split("::").pop()! : calcNameOrFqn;
    for (const pkg of this.getStandardPacks()) {
      const bindings = pkg.manifest.standard?.calculators;
      if (!bindings || bindings.length === 0) continue;

      const binding = bindings.find(
        (b) =>
          b.calcName === calcNameOrFqn ||
          b.calcName === shortName ||
          (b.calcName.includes("::") && b.calcName.split("::").pop() === shortName),
      );
      if (!binding) continue;

      if (binding.tableKey && pkg.tables?.[binding.tableKey] !== undefined) {
        const res = evaluateStandardLookupTable(pkg.tables[binding.tableKey], args);
        if (res !== null) return res;
      }

      if (binding.wasmExport && pkg.wasmExports) {
        const fn = pkg.wasmExports[binding.wasmExport];
        if (typeof fn === "function") {
          const numArgs = args.map((a) => (typeof a === "number" ? a : Number(a)));
          if (numArgs.every((n) => Number.isFinite(n))) {
            const raw = (fn as (...xs: number[]) => unknown)(...numArgs);
            if (typeof raw === "number" || typeof raw === "boolean") return raw;
          }
        }
      }
    }

    // Fallback: direct tableKey or wasmExport name lookup across standard packs
    for (const pkg of this.getStandardPacks()) {
      const table = pkg.tables?.[calcNameOrFqn] ?? pkg.tables?.[shortName];
      if (table !== undefined) {
        const res = evaluateStandardLookupTable(table, args);
        if (res !== null) return res;
      }
      const fn = pkg.wasmExports?.[calcNameOrFqn] ?? pkg.wasmExports?.[shortName];
      if (typeof fn === "function") {
        const numArgs = args.map((a) => (typeof a === "number" ? a : Number(a)));
        if (numArgs.every((n) => Number.isFinite(n))) {
          const raw = (fn as (...xs: number[]) => unknown)(...numArgs);
          if (typeof raw === "number" || typeof raw === "boolean") return raw;
        }
      }
    }
    return undefined;
  }

  getDiagramSpec(language: string, nameOrAlias: string): DiagramComponentSpec | undefined {
    const diagMap = this.diagramsByLang.get(language.toLowerCase());
    if (!diagMap) return undefined;
    return diagMap.get(nameOrAlias) ?? diagMap.get(nameOrAlias.toLowerCase());
  }

  materializeSymbolIndex(language: string, target?: SymbolIndex): SymbolIndex {
    let idx = target;
    const lang = language.toLowerCase();
    for (const pkg of this.getPackagesForLanguage(lang)) {
      if (pkg.symbols.length === 0) continue;
      idx = materializeLibrarySymbols(pkg.packageName, pkg.manifest.language ?? lang, pkg.symbols, idx);
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
   * Node.js helper: loads a `modelscript.yaml` library or standard-pack directory from disk
   * (typically located under `.modelscript/packages/<pkg>/`).
   */
  async loadLibraryFromDir(dirPath: string): Promise<LoadedLibraryPackage | undefined> {
    const fsId = "node:fs";
    const pathId = "node:path";
    const fs = await import(fsId);
    const path = await import(pathId);
    const { MANIFEST_FILENAME, parseModelScriptYaml } = await import("./manifest.js");

    const yamlPath = path.join(dirPath, MANIFEST_FILENAME);
    if (!fs.existsSync(yamlPath)) return undefined;

    const manifest = parseModelScriptYaml(fs.readFileSync(yamlPath, "utf-8"), yamlPath);
    if (!manifest.library) return undefined;
    const bundleMeta = {
      name: manifest.name,
      version: manifest.version,
      modelscript: manifest.library,
    };
    if (!isModelscriptLibraryPackageJson(bundleMeta)) return undefined;

    let symbols: LibrarySymbolStub[] = [];
    if (bundleMeta.modelscript.symbols) {
      const symbolsPath = path.resolve(dirPath, bundleMeta.modelscript.symbols);
      if (fs.existsSync(symbolsPath)) {
        symbols = JSON.parse(fs.readFileSync(symbolsPath, "utf-8"));
      }
    }

    let diagrams: DiagramComponentSpec[] | undefined;
    if (bundleMeta.modelscript.diagrams) {
      const diagPath = path.resolve(dirPath, bundleMeta.modelscript.diagrams);
      if (fs.existsSync(diagPath)) {
        diagrams = JSON.parse(fs.readFileSync(diagPath, "utf-8"));
      }
    }

    let wasmBytes: Uint8Array | undefined;
    if (bundleMeta.modelscript.runtime?.wasm) {
      const wasmPath = path.resolve(dirPath, bundleMeta.modelscript.runtime.wasm);
      if (fs.existsSync(wasmPath)) {
        wasmBytes = new Uint8Array(fs.readFileSync(wasmPath));
      }
    }

    let tables: Record<string, unknown> | undefined;
    if (bundleMeta.modelscript.runtime?.tables) {
      tables = {};
      for (const [key, relPath] of Object.entries(bundleMeta.modelscript.runtime.tables)) {
        const tablePath = path.resolve(dirPath, relPath);
        if (fs.existsSync(tablePath)) {
          tables[key] = JSON.parse(fs.readFileSync(tablePath, "utf-8"));
        }
      }
    }

    const loaded = this.registerLibraryBundle(bundleMeta, { symbols, diagrams, wasmBytes, tables });
    if (loaded.wasmBytes && !loaded.wasmExports) {
      await this.ensureWasmInstantiated(loaded);
    }
    return loaded;
  }

  unregisterPackage(packageName: string): boolean {
    const target = packageName.toLowerCase();
    let removed = false;
    for (const [k, pkg] of [...this.packages.entries()]) {
      if (pkg.packageName.toLowerCase() === target) {
        this.packages.delete(k);
        removed = true;
      }
    }
    return removed;
  }

  clear(): void {
    this.packages.clear();
    this.diagramsByLang.clear();
  }
}

export const globalLibraryRegistry = new LibraryPackageRegistry();
