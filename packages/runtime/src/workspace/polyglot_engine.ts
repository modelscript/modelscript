// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview `PolyglotEngine` vs. `PolyglotContext` Separation (GraalVM Engine/Context pattern).
 *
 * Splits ModelScript's polyglot runtime into:
 *   1. `PolyglotEngine` — Immutable, shareable across tenants, API requests, LSP workers, and
 *      design branches. Owns compiled `WebAssembly.Module` binaries, frozen Tier-1 standard-library
 *      symbol snapshots (e.g. MSL's 10,000+ classes), `SymbolInteropRegistry`, and compiled TGG PICs.
 *   2. `PolyglotContext` — Lightweight, mutable, disposable per-session / per-branch overlay.
 *      Provides zero-copy read access to the parent engine's frozen libraries while isolating user
 *      edits, branch hypergraph state, and capability-based security policies.
 */

import { SymbolInteropRegistry } from "../interop/symbol_interop.js";
import { TggPicDispatcher } from "../interop/tgg_pic_dispatch.js";
import { DigitalThreadHypergraph } from "../interop/thread_hypergraph.js";
import { getSymbolDomain, type SymbolEntry, type SymbolId, type SymbolIndex } from "../runtime.js";
import { getOrCompileWasmModule } from "./wasm-kernel-host.js";

/**
 * Capability-based sandbox policy enforced by a `PolyglotContext`.
 */
export interface PolyglotCapabilities {
  /** Whether the context may invoke external native/WASM solvers. */
  allowExternalSolvers: boolean;
  /** Allowlisted filesystem root prefixes for reading external assets/tables. */
  allowFileSystemRead: readonly string[];
  /** Whether outbound network access (e.g. OSLC gateways, remote registries) is allowed. */
  allowNetwork: boolean;
  /** Maximum WebAssembly linear-memory pages (64 KiB each) permitted for isolated instances. */
  maxWasmMemoryPages: number;
  /** Wall-clock budget in milliseconds for simulation / verification calls. */
  maxSimulationWallTimeMs: number;
  /** Optional allowlist of 8-bit `LanguageDomainId`s enabled in this context. */
  enabledDomains?: ReadonlySet<number> | undefined;
}

export const DEFAULT_POLYGLOT_CAPABILITIES: Readonly<PolyglotCapabilities> = Object.freeze({
  allowExternalSolvers: true,
  allowFileSystemRead: [],
  allowNetwork: false,
  maxWasmMemoryPages: 4096, // 256 MiB
  maxSimulationWallTimeMs: 30_000,
});

export class CapabilityViolationError extends Error {
  public readonly capability: string;
  constructor(capability: string, detail: string) {
    super(`PolyglotContext capability violation [${capability}]: ${detail}`);
    this.name = "CapabilityViolationError";
    this.capability = capability;
  }
}

/**
 * Immutable, frozen standard-library symbol snapshot stored inside a `PolyglotEngine`
 * and shared zero-copy across all child `PolyglotContext` instances.
 */
export interface FrozenLibrarySnapshot {
  readonly libraryId: string;
  readonly version: string;
  readonly symbols: ReadonlyMap<SymbolId, Readonly<SymbolEntry>>;
  readonly byName: ReadonlyMap<string, readonly SymbolId[]>;
  readonly childrenOf: ReadonlyMap<SymbolId | null, readonly SymbolId[]>;
}

/**
 * Freezes a mutable `SymbolIndex` into a read-only `FrozenLibrarySnapshot`.
 */
export function freezeSymbolIndex(libraryId: string, version: string, index: SymbolIndex): FrozenLibrarySnapshot {
  const symbols = new Map<SymbolId, Readonly<SymbolEntry>>();
  for (const [id, entry] of index.symbols.entries()) {
    symbols.set(id, Object.freeze({ ...entry }));
  }
  const byName = new Map<string, readonly SymbolId[]>();
  for (const [name, ids] of index.byName.entries()) {
    byName.set(name, Object.freeze([...ids]));
  }
  const childrenOf = new Map<SymbolId | null, readonly SymbolId[]>();
  for (const [parentId, ids] of index.childrenOf.entries()) {
    childrenOf.set(parentId, Object.freeze([...ids]));
  }
  return Object.freeze({ libraryId, version, symbols, byName, childrenOf });
}

/**
 * Shared, long-lived polyglot engine holding immutable compiled modules,
 * frozen standard-library snapshots, interop trait libraries, and TGG PIC tables.
 */
export class PolyglotEngine {
  private readonly wasmModules = new Map<string, WebAssembly.Module>();
  private readonly frozenLibraries = new Map<string, FrozenLibrarySnapshot>();
  public readonly interopRegistry: SymbolInteropRegistry;
  public readonly tggPic: TggPicDispatcher;
  private disposed = false;

  constructor(options?: { interopRegistry?: SymbolInteropRegistry; tggPic?: TggPicDispatcher }) {
    this.interopRegistry = options?.interopRegistry ?? new SymbolInteropRegistry();
    this.tggPic = options?.tggPic ?? new TggPicDispatcher();
  }

  /** Compiles (if needed) and caches a shared immutable `WebAssembly.Module` by key. */
  public registerWasmModule(key: string, wasmBytes: Uint8Array): WebAssembly.Module | undefined {
    this.assertNotDisposed();
    const existing = this.wasmModules.get(key);
    if (existing) return existing;
    const mod = getOrCompileWasmModule(wasmBytes);
    if (mod) this.wasmModules.set(key, mod);
    return mod;
  }

  public getWasmModule(key: string): WebAssembly.Module | undefined {
    return this.wasmModules.get(key);
  }

  /** Attaches an immutable `FrozenLibrarySnapshot` shared zero-copy across all contexts. */
  public registerFrozenLibrary(snapshot: FrozenLibrarySnapshot): this {
    this.assertNotDisposed();
    this.frozenLibraries.set(snapshot.libraryId, snapshot);
    return this;
  }

  public getFrozenLibrary(libraryId: string): FrozenLibrarySnapshot | undefined {
    return this.frozenLibraries.get(libraryId);
  }

  public listFrozenLibraries(): readonly FrozenLibrarySnapshot[] {
    return Array.from(this.frozenLibraries.values());
  }

  /** Spawns a lightweight, isolated `PolyglotContext` backed by this engine. */
  public createContext(options?: {
    contextId?: string;
    branchId?: number;
    capabilities?: Partial<PolyglotCapabilities>;
  }): PolyglotContext {
    this.assertNotDisposed();
    const caps: PolyglotCapabilities = {
      ...DEFAULT_POLYGLOT_CAPABILITIES,
      ...options?.capabilities,
    };
    return new PolyglotContext(this, {
      contextId: options?.contextId ?? `ctx_${Math.random().toString(36).slice(2, 10)}`,
      branchId: options?.branchId ?? 0,
      capabilities: caps,
    });
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("PolyglotEngine has been disposed.");
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tggPic.dispose();
    this.wasmModules.clear();
    this.frozenLibraries.clear();
  }
}

/**
 * Lightweight, mutable, capability-sandboxed session/branch context sharing a parent `PolyglotEngine`.
 */
export class PolyglotContext {
  public readonly engine: PolyglotEngine;
  public readonly contextId: string;
  public readonly branchId: number;
  public readonly capabilities: Readonly<PolyglotCapabilities>;
  public readonly hypergraph: DigitalThreadHypergraph;

  // Per-context mutable overlay on top of frozen engine libraries (copy-on-write)
  private readonly overlaySymbols = new Map<SymbolId, SymbolEntry>();
  private readonly overlayByName = new Map<string, SymbolId[]>();
  private readonly overlayChildrenOf = new Map<SymbolId | null, SymbolId[]>();
  private readonly tombstones = new Set<SymbolId>();
  private revision = 0;
  private disposed = false;

  constructor(
    engine: PolyglotEngine,
    config: {
      contextId: string;
      branchId: number;
      capabilities: PolyglotCapabilities;
    },
  ) {
    this.engine = engine;
    this.contextId = config.contextId;
    this.branchId = config.branchId;
    this.capabilities = Object.freeze({ ...config.capabilities });
    this.hypergraph = new DigitalThreadHypergraph();
  }

  public get version(): number {
    return this.revision;
  }

  /** Enforces whether a given 8-bit `domainId` is enabled by this context's capability policy. */
  public assertDomainAllowed(domainId: number): void {
    this.assertActive();
    if (this.capabilities.enabledDomains && !this.capabilities.enabledDomains.has(domainId)) {
      throw new CapabilityViolationError(
        "enabledDomains",
        `Domain ${domainId} is disabled in context '${this.contextId}'.`,
      );
    }
  }

  /** Enforces external solver execution capability. */
  public assertExternalSolversAllowed(): void {
    this.assertActive();
    if (!this.capabilities.allowExternalSolvers) {
      throw new CapabilityViolationError(
        "allowExternalSolvers",
        `External solver execution is disabled in context '${this.contextId}'.`,
      );
    }
  }

  /** Enforces filesystem read allowlist. */
  public assertFileReadAllowed(path: string): void {
    this.assertActive();
    const allowed = this.capabilities.allowFileSystemRead.some((prefix) => path.startsWith(prefix));
    if (!allowed) {
      throw new CapabilityViolationError(
        "allowFileSystemRead",
        `Path '${path}' is outside allowlisted roots in context '${this.contextId}'.`,
      );
    }
  }

  /** Enforces WASM linear memory page limit. */
  public assertWasmMemoryAllowed(requestedPages: number): void {
    this.assertActive();
    if (requestedPages > this.capabilities.maxWasmMemoryPages) {
      throw new CapabilityViolationError(
        "maxWasmMemoryPages",
        `Requested ${requestedPages} pages exceeds cap of ${this.capabilities.maxWasmMemoryPages}.`,
      );
    }
  }

  /** Adds or overrides a symbol in this context's isolated overlay without mutating the shared engine. */
  public upsertSymbol(entry: SymbolEntry): void {
    this.assertDomainAllowed(getSymbolDomain(entry.id));
    this.tombstones.delete(entry.id);
    this.overlaySymbols.set(entry.id, entry);

    let list = this.overlayByName.get(entry.name);
    if (!list) {
      list = [];
      this.overlayByName.set(entry.name, list);
    }
    if (!list.includes(entry.id)) list.push(entry.id);

    let kids = this.overlayChildrenOf.get(entry.parentId);
    if (!kids) {
      kids = [];
      this.overlayChildrenOf.set(entry.parentId, kids);
    }
    if (!kids.includes(entry.id)) kids.push(entry.id);

    this.revision++;
  }

  /** Masks a symbol (either from overlay or frozen engine library) in this context only. */
  public removeSymbol(symbolId: SymbolId): void {
    this.assertActive();
    this.overlaySymbols.delete(symbolId);
    this.tombstones.add(symbolId);
    this.revision++;
  }

  /** Resolves a symbol by ID, checking the mutable overlay first, then zero-copy frozen engine libraries. */
  public getSymbol(symbolId: SymbolId): Readonly<SymbolEntry> | undefined {
    this.assertActive();
    if (this.tombstones.has(symbolId)) return undefined;
    const local = this.overlaySymbols.get(symbolId);
    if (local) return local;
    for (const lib of this.engine.listFrozenLibraries()) {
      const found = lib.symbols.get(symbolId);
      if (found) return found;
    }
    return undefined;
  }

  /** Resolves symbols by name across both overlay and frozen engine libraries (excluding tombstones). */
  public findSymbolsByName(name: string): Readonly<SymbolEntry>[] {
    this.assertActive();
    const seen = new Set<SymbolId>();
    const results: Readonly<SymbolEntry>[] = [];

    const localIds = this.overlayByName.get(name);
    if (localIds) {
      for (const id of localIds) {
        if (this.tombstones.has(id) || seen.has(id)) continue;
        const entry = this.overlaySymbols.get(id);
        if (entry) {
          seen.add(id);
          results.push(entry);
        }
      }
    }

    for (const lib of this.engine.listFrozenLibraries()) {
      const libIds = lib.byName.get(name);
      if (!libIds) continue;
      for (const id of libIds) {
        if (this.tombstones.has(id) || seen.has(id)) continue;
        const entry = lib.symbols.get(id);
        if (entry) {
          seen.add(id);
          results.push(entry);
        }
      }
    }

    return results;
  }

  /**
   * Materializes a `SymbolIndex` view combining frozen `PolyglotEngine` libraries
   * with this context's mutable overlay (excluding tombstoned symbols) for interop
   * with `WasmQueryEngine` and `TggCorrespondenceIndexer`.
   */
  public toSymbolIndex(): SymbolIndex {
    this.assertActive();
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    const addEntry = (entry: Readonly<SymbolEntry>) => {
      if (this.tombstones.has(entry.id)) return;
      symbols.set(entry.id, entry as SymbolEntry);
      let nameList = byName.get(entry.name);
      if (!nameList) {
        nameList = [];
        byName.set(entry.name, nameList);
      }
      if (!nameList.includes(entry.id)) nameList.push(entry.id);

      let childList = childrenOf.get(entry.parentId);
      if (!childList) {
        childList = [];
        childrenOf.set(entry.parentId, childList);
      }
      if (!childList.includes(entry.id)) childList.push(entry.id);
    };

    for (const lib of this.engine.listFrozenLibraries()) {
      for (const entry of lib.symbols.values()) {
        addEntry(entry);
      }
    }
    for (const entry of this.overlaySymbols.values()) {
      addEntry(entry);
    }

    return { symbols, byName, childrenOf };
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error(`PolyglotContext '${this.contextId}' has been disposed.`);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.overlaySymbols.clear();
    this.overlayByName.clear();
    this.overlayChildrenOf.clear();
    this.tombstones.clear();
  }
}
