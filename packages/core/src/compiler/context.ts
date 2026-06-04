/* eslint-disable @typescript-eslint/no-explicit-any */
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Context as BaseContext,
  printArenaDAE,
  type ArenaDAEBuilder,
  type HomotopyMode,
  type InitSolverConfig,
  type ModelicaCompilerOptions,
  type PreconditionerMode,
  type QueryEngine,
  type WorkspaceIndex,
} from "@modelscript/compiler";
import {
  createModelicaQueryEngine,
  createModelicaWorkspaceIndex,
  injectPredefinedTypes,
} from "@modelscript/modelica/factory";
import { ArenaQueryFlattener, type FlattenOptions } from "@modelscript/modelica/flattener-query";
import { ModelicaPoParser, ModelicaTranslation } from "@modelscript/modelica/po";
import { ModelicaClassInstance, type ModelicaElement } from "@modelscript/modelica/semantic-model";
import { MODELSCRIPT_CAS_PACKAGE } from "@modelscript/symbolics";
import type { FileSystem, Parser, Tree } from "@modelscript/utils";

import { MODELSCRIPT_GEOMETRY_PACKAGE } from "./modelica/builtins/geometry.js";
import { MODELSCRIPT_STUDIES_PACKAGE } from "./modelica/builtins/studies.js";

export type { HomotopyMode, InitSolverConfig, ModelicaCompilerOptions, PreconditionerMode };

export class ModelicaLibrary {
  name: string;
  constructor(
    public context: Context,
    public path: string,
  ) {
    this.name = path.split(/[/\\]/).pop()?.replace(/\.mo$/, "") ?? "Untitled";

    const stat = context.fs.stat(path);
    if (stat?.isDirectory()) {
      const pkgPath = context.fs.join(path, "package.mo");
      if (context.fs.stat(pkgPath)?.isFile()) {
        const text = context.fs.read(pkgPath);
        const match = text.match(/package\s+([a-zA-Z0-9_]+)/);
        if (match && match[1]) {
          this.name = match[1];
        }
      }
    }
  }
}

/**
 * The polyglot compiler context managing file system resources and loaded Modelica code.
 *
 * NOTE: Context no longer extends Scope. It was historically the root scope with
 * no parent, but it doesn't participate in name resolution chains. Instead, it
 * owns a QueryEngine (Salsa-style incremental computation) and a WorkspaceIndex
 * (arena-backed symbol storage). Name resolution is handled by the QueryDB.
 */
export class Context extends BaseContext {
  #classes: ModelicaClassInstance[] = [];
  #fs: FileSystem;
  #libraries: ModelicaLibrary[] = [];
  #translations = new Map<string, ModelicaTranslation>();
  #language: string | null = null;
  #workspaceIndex: WorkspaceIndex;
  #queryEngine: QueryEngine;
  #trees = new Map<string, Tree>();

  get workspaceIndex(): WorkspaceIndex {
    return this.#workspaceIndex;
  }

  setWorkspaceIndex(index: WorkspaceIndex): void {
    this.#workspaceIndex = index;
  }

  get queryEngine(): QueryEngine {
    return this.#queryEngine;
  }

  setQueryEngine(engine: QueryEngine): void {
    this.#queryEngine = engine;
  }

  getTree(uri: string): Tree | undefined {
    return this.#trees.get(uri);
  }

  static _parsers = new Map<string, Parser>();

  /**
   * Initializes a new compiler Context.
   *
   * @param fs - The FileSystem implementation to use for reading files and checking paths.
   * @param cacheStore - Optional external store for memoizing queries
   * @param maxMemos - Optional max number of memos to keep in memory
   */
  constructor(fs: FileSystem, cacheStore?: any, maxMemos?: number) {
    const workspaceIndex = createModelicaWorkspaceIndex();

    // Provide a CSTTree that looks up trees by resourceId cached in Context
    const contextTree = {
      getText: (startByte: number, endByte: number, entry?: any) => {
        if (!entry || !entry.resourceId) return null;
        const tree = this.#trees.get(entry.resourceId);
        if (!tree) return null;
        const offset = tree.rootNode.startIndex;
        return tree.rootNode.text.substring(startByte - offset, endByte - offset);
      },
      getNode: (startByte: number, endByte: number, entry?: any) => {
        if (!entry || !entry.resourceId) return null;
        const tree = this.#trees.get(entry.resourceId);
        if (!tree) return null;
        return tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte));
      },
    };

    const queryEngine = createModelicaQueryEngine(workspaceIndex.toUnified(), contextTree, cacheStore, maxMemos);
    super(fs, workspaceIndex, queryEngine);
    this._trees = this.#trees;

    this.#fs = fs;
    this.#workspaceIndex = workspaceIndex;
    this.#queryEngine = queryEngine;
    this.load(MODELSCRIPT_CAS_PACKAGE, "modelscript-cas.mo");
    this.load(MODELSCRIPT_STUDIES_PACKAGE, "modelscript-studies.mo");
    this.load(MODELSCRIPT_GEOMETRY_PACKAGE, "modelscript-geometry.mo");
  }

  /**
   * Create a Context optimized for batch (one-shot) compilation.
   * Disables Salsa memoization to minimize memory usage.
   */
  static createBatch(fs: FileSystem): Context {
    return new Context(fs, undefined, 0);
  }

  /**
   * Trigger a manual GC pass if `--expose-gc` is enabled.
   * No-op in environments without `globalThis.gc`.
   */
  static gcBetweenPhases(): void {
    if (typeof globalThis.gc === "function") {
      globalThis.gc();
    }
  }

  readonly hash = "root";

  get elements(): IterableIterator<any> {
    const classes = this.#classes;
    const libraries = this.#libraries;
    return (function* () {
      yield* classes;
      yield* libraries;
    })();
  }

  readonly parent: null = null;

  getNamedElement(name: string): ModelicaElement | null {
    for (const element of this.elements) {
      if ("name" in element && (element as { name?: string }).name === name) {
        return element as ModelicaElement;
      }
    }
    return null;
  }

  /**
   * Resolve a dot-separated name to a named element within the loaded classes.
   * This replaces the `Scope.query()` method that was previously inherited.
   */
  query(name: string): ModelicaElement | null {
    return this.resolveName(name.split("."));
  }

  /**
   * Resolve a name (as an array of parts) through the loaded class hierarchy.
   * This replaces the `Scope.resolveName()` method that was previously inherited.
   */
  resolveName(parts: string[] | null | undefined): ModelicaElement | null {
    if (!parts || parts.length === 0) return null;
    const first = parts[0];
    if (!first) return null;
    let element = this.getNamedElement(first);
    if (!element) return null;
    for (let i = 1; i < parts.length; i++) {
      const nameStr = parts[i];
      if (!nameStr) return null;
      if (typeof (element as any).resolveSimpleName !== "function") return null;
      element = (element as any).resolveSimpleName(nameStr, false, true) as any;
      if (!element) return null;
    }
    return element;
  }

  /**
   * Adds and parses a Modelica library from the specified file system path.
   *
   * @param path - The absolute file system path to the directory or file representing the library.
   * @returns The loaded ModelicaLibrary instance, or null if the path does not point to a valid library.
   */
  async addLibrary(path: string, options?: { skipIndex?: boolean }): Promise<ModelicaLibrary | null> {
    let library = this.getLibrary(path);
    if (library) return library;

    const stats = this.#fs.stat(path);
    if (stats?.isDirectory()) {
      const pkgPath = this.#fs.join(path, "package.mo");
      if (!this.#fs.stat(pkgPath)?.isFile()) {
        return null;
      }
    }

    library = new ModelicaLibrary(this, path);
    this.#libraries.push(library);

    // Crawl and register Modelica files
    const crawl = (dir: string, currentFQN: string) => {
      const s = this.#fs.stat(dir);
      if (!s) return;
      if (s.isFile()) {
        if (dir.endsWith(".mo") || dir.endsWith(".msim")) {
          const basename = dir.split(/[/\\]/).pop();
          let parentFQN: string | undefined = currentFQN;

          if (basename === "package.mo") {
            const parts = currentFQN.split(".");
            parts.pop();
            parentFQN = parts.length > 0 ? parts.join(".") : undefined;
          }

          // For single-file libraries (path IS the .mo file), the top-level
          // class is a root class with no enclosing package.  Setting parentFQN
          // to the library name would create a self-referential parent in the
          // symbol table (parentId === symbolId), causing infinite loops in
          // the flattener's scope traversal.
          if (dir === path && basename !== "package.mo") {
            parentFQN = undefined;
          }

          // Register for lazy loading
          this.#workspaceIndex.register(
            dir,
            () => {
              const text = this.#fs.read(dir);
              const tree = this.parse(".mo", text);
              this.#trees.set(dir, tree);
              return tree.rootNode as any;
            },
            parentFQN,
          );
        } else if (dir.endsWith(".csv")) {
          const parentFQN = currentFQN || undefined;
          this.#workspaceIndex.register(
            dir,
            () => {
              const text = this.#fs.read(dir);
              const tree = this.parse(".csv", text);
              this.#trees.set(dir, tree);
              return tree.rootNode as any;
            },
            parentFQN,
          );
        }
      } else if (s.isDirectory()) {
        const ignoreList = new Set(["node_modules", "dist", ".git", "testsuite"]);
        for (const entry of this.#fs.readdir(dir)) {
          if (ignoreList.has(entry.name)) continue;

          const entryMode = this.#fs.stat(this.#fs.join(dir, entry.name));
          if (entryMode?.isDirectory()) {
            const nextFQN = `${currentFQN}.${entry.name}`;
            crawl(this.#fs.join(dir, entry.name), nextFQN);
          } else {
            crawl(this.#fs.join(dir, entry.name), currentFQN);
          }
        }
      }
    };
    crawl(path, library.name);

    // Skip the expensive indexing step when batching multiple addLibrary calls.
    // The caller should call finalizeLibraries() once after all libraries are registered.
    if (options?.skipIndex) {
      if (this.#language) {
        this.loadTranslationsForLibrary(library, this.#language);
      }
      return library;
    }

    // Update the engine
    const unified = await this.#workspaceIndex.toUnifiedAsync();
    injectPredefinedTypes(unified);
    this.#queryEngine.updateIndex(unified);

    // Hydrate root classes
    for (const id of this.#queryEngine.index.symbols.keys()) {
      const entry = this.#queryEngine.index.symbols.get(id);
      if (entry && (entry.parentId === null || entry.parentId === id) && entry.kind === "Class") {
        if (!this.#classes.some((c) => c.id === id)) {
          this.#classes.push(new ModelicaClassInstance(id, this.#queryEngine.toQueryDB()));
        }
      }
    }

    if (this.#language) {
      this.loadTranslationsForLibrary(library, this.#language);
    }
    return library;
  }

  /**
   * Finalize all libraries that were added with `skipIndex: true`.
   * Performs a single indexing pass and hydrates root classes.
   * Call this once after batching multiple `addLibrary({ skipIndex: true })` calls.
   */
  async finalizeLibraries(): Promise<void> {
    const unified = await this.#workspaceIndex.toUnifiedAsync();
    injectPredefinedTypes(unified);
    this.#queryEngine.updateIndex(unified);

    // Hydrate root classes
    for (const id of this.#queryEngine.index.symbols.keys()) {
      const entry = this.#queryEngine.index.symbols.get(id);
      if (entry && (entry.parentId === null || entry.parentId === id) && entry.kind === "Class") {
        if (!this.#classes.some((c) => c.id === id)) {
          this.#classes.push(new ModelicaClassInstance(id, this.#queryEngine.toQueryDB()));
        }
      }
    }
  }

  /**
   * @deprecated Use `classes` or `listLibraries()` instead.
   */
  get allElements(): IterableIterator<any> {
    const classes = this.#classes;
    const libraries = this.#libraries;
    return (function* () {
      yield* classes;
      yield* libraries;
    })();
  }

  /**
   * Returns the array of top-level classes loaded via `load()`.
   */
  get classes(): readonly ModelicaClassInstance[] {
    return this.#classes;
  }

  /**
   * Flattens a loaded Modelica class by name, generating the flattened DAE textual representation.
   *
   * @param name - The fully qualified name of the Modelica class to flatten.
   * @returns The flattened DAE output as a string, or null if the class is not found.
   */
  flatten(name: string, options?: FlattenOptions): string | null {
    const arena = this.flattenArena(name, undefined, undefined, options);
    if (!arena) return null;
    return printArenaDAE(arena, options?.omcCompatibility);
  }

  /**
   * Flatten a Modelica class using the arena-native pipeline.
   *
   * This is the new canonical flattening API. It bypasses the legacy object graph entirely,
   * using `ArenaQueryFlattener` → `ArenaDAEBuilder` directly.
   *
   * @param name - The fully qualified name of the Modelica class to flatten.
   * @returns An `ArenaDAEBuilder` containing the flattened DAE, or null if the class is not found.
   */
  flattenArena(name: string, classId?: any, uri?: string, options?: FlattenOptions): ArenaDAEBuilder | null {
    let symbolIds: any[] | undefined = undefined;

    if (classId !== undefined) {
      symbolIds = [classId];
    } else {
      // 1. Try simple name lookup (which works if name is not fully qualified)
      const candidates = this.#queryEngine.index.byName.get(name);
      if (candidates && candidates.length > 0) {
        if (uri) {
          const matching = candidates.filter((id: any) => {
            const entry = this.#queryEngine.index.symbols.get(id);
            return entry && entry.resourceId === uri;
          });
          if (matching.length > 0) {
            symbolIds = matching;
          }
        }
        if (!symbolIds) {
          symbolIds = candidates;
        }
      }

      // 2. Try multi-part resolution for fully qualified names ("A.B.C")
      if (!symbolIds || symbolIds.length === 0) {
        const parts = name.split(".");
        if (parts.length > 1) {
          let currentIds = this.#queryEngine.index.byName.get(parts[0] as string);
          if (uri && currentIds) {
            const matching = currentIds.filter((id: any) => {
              const entry = this.#queryEngine.index.symbols.get(id);
              return entry && entry.resourceId === uri;
            });
            if (matching.length > 0) {
              currentIds = matching;
            }
          }

          for (let i = 1; i < parts.length && currentIds && currentIds.length > 0; i++) {
            const part = parts[i];
            const nextIds: any[] = [];
            for (const parentId of currentIds) {
              const children = this.#queryEngine.index.childrenOf.get(parentId);
              if (children) {
                for (const childId of children) {
                  const childEntry = this.#queryEngine.index.symbols.get(childId);
                  if (childEntry && childEntry.name === part) {
                    nextIds.push(childId);
                  }
                }
              }
            }
            currentIds = nextIds;
          }
          if (currentIds && currentIds.length > 0) {
            symbolIds = currentIds;
          }
        }
      }
    }

    if (!symbolIds || symbolIds.length === 0) {
      console.error(`[Context] flattenArena: class '${name}' not found in index.`);
      return null;
    }

    const firstId = symbolIds[0];
    if (firstId === undefined) return null;

    const queryDB = this.#queryEngine.toQueryDB();
    const flattener = new ArenaQueryFlattener(queryDB, options);

    const currentStructuralRevision = this.#workspaceIndex.structuralRevision;
    const cacheKey = firstId;
    const cached = (this as any)._daeBodyCache?.get(cacheKey);

    let clonedBuilder = null;
    if (cached) {
      if (cached.revision === currentStructuralRevision) {
        clonedBuilder = cached.builder.clone();
      }
    }

    // Flatten from scratch (or partially from scratch)
    const dae = flattener.flatten(firstId, clonedBuilder, options);

    if (flattener.bodySnapshot == null) {
      throw new Error(
        `flattener.bodySnapshot is ${flattener.bodySnapshot}. cached was ${!!cached}. builder was ${cached?.builder}`,
      );
    }

    // Save snapshot of the body phase
    if (!(this as any)._daeBodyCache) (this as any)._daeBodyCache = new Map();
    (this as any)._daeBodyCache.set(cacheKey, {
      builder: flattener.bodySnapshot, // already cloned inside flatten()
      revision: currentStructuralRevision,
    });

    return dae;
  }

  /**
   * Alias for flatten(), generating textual DAE output via the Arena printer.
   *
   * @param name - The fully qualified name of the Modelica class to flatten.
   * @returns The flattened DAE text, or null if the class is not found.
   */
  flattenText(name: string): string | null {
    return this.flatten(name);
  }

  /**
   * Validates a class instance before flattening, rejecting semantically invalid models.
   * Each check here has a corresponding linter rule in linter.ts for IDE feedback.
   * @throws Error if the class is not valid for flattening.
   */

  /**
   * Retrieves the current FileSystem instance used by the context.
   *
   * @returns The active FileSystem instance.
   */
  get fs(): FileSystem {
    return this.#fs;
  }

  /**
   * Retrieves an already loaded library by its file system path.
   *
   * @param path - The file system path of the library to retrieve.
   * @returns The ModelicaLibrary if loaded, otherwise null.
   */
  getLibrary(path: string): ModelicaLibrary | null {
    for (const library of this.#libraries) {
      if (library.path == path) return library;
    }
    return null;
  }

  /**
   * Retrieves a registered tree-sitter parser for a specific file extension.
   *
   * @param extname - The file extension (e.g., ".mo") to find a parser for.
   * @returns The tree-sitter Parser instance.
   * @throws Error if no parser is registered for the given extension.
   */
  getParser(extname: string): Parser {
    const parser = (Context as any)._parsers.get(extname);
    if (!parser) throw new Error(`no parser registered for extension '${extname}'`);
    return parser;
  }

  /**
   * Lists all loaded libraries within this context.
   *
   * @returns An iterable iterator over all loaded ModelicaLibrary instances.
   */
  listLibraries(): IterableIterator<ModelicaLibrary> {
    const libraries = this.#libraries;
    return (function* () {
      yield* libraries;
    })();
  }

  /**
   * Parses and loads raw Modelica source code into the context's classes array.
   *
   * @param input - The raw Modelica source code string.
   */
  load(input: string, resourceId?: string): Tree {
    const tree = this.parse(".mo", input);
    const uri = resourceId ?? "synthetic-" + Math.random().toString();
    this.#trees.set(uri, tree);

    this.#workspaceIndex.register(uri, () => tree.rootNode as any);
    const t0 = Date.now();
    const unified = this.#workspaceIndex.toUnified();
    console.error(`[Context] toUnified took ${Date.now() - t0}ms for uri ${uri}`);
    injectPredefinedTypes(unified);
    this.#queryEngine.updateIndex(unified);

    this.#classes = this.#classes.filter((c) => c.db.symbol(c.id)?.resourceId !== uri);
    for (const id of this.#queryEngine.index.symbols.keys()) {
      const entry = this.#queryEngine.index.symbols.get(id);
      if (
        entry &&
        (entry.parentId === null || entry.parentId === id) &&
        entry.kind === "Class" &&
        entry.resourceId === uri
      ) {
        this.#classes.push(new ModelicaClassInstance(id, this.#queryEngine.toQueryDB()));
      }
    }
    this.#classes.sort((a, b) => a.id - b.id);
    return tree;
  }

  /**
   * Manually injects a pre-constructed Modelica class into the compiler context.
   *
   * @param classInstance - The root class instance to attach.
   */
  addClass(classInstance: ModelicaClassInstance): void {
    this.#classes.push(classInstance);
  }

  /**
   * Parses source code using the registered parser for the given extension.
   *
   * @param extname - The file extension determining which parser to use.
   * @param input - The source code to parse.
   * @param oldTree - An optional previous tree-sitter Tree for incremental parsing.
   * @returns The parsed tree-sitter Tree.
   */
  parse(extname: string, input: string, oldTree?: Tree): Tree {
    const parser = this.getParser(extname);
    return parser.parse(input, oldTree, { bufferSize: input.length * 2 });
  }

  /**
   * Registers a tree-sitter parser for a specific file extension globally.
   *
   * @param extname - The file extension (e.g., ".mo").
   * @param parser - The tree-sitter Parser instance to register.
   */
  static registerParser(extname: string, parser: Parser) {
    (Context as any)._parsers.set(extname, parser);
  }

  /**
   * Gets the currently active translation language for the context.
   *
   * @returns The active language code (e.g., "en_US") or null if none is set.
   */
  get language(): string | null {
    return this.#language;
  }

  /**
   * Sets the active translation language for the context, loading PO files if necessary.
   *
   * @param lang - The language code to set (e.g., "en_US"), or null to disable translation.
   */
  setLanguage(lang: string | null) {
    this.#language = lang;
    if (lang && !this.#translations.has(lang)) {
      this.#translations.set(lang, new ModelicaTranslation());
      for (const library of this.#libraries) {
        this.loadTranslationsForLibrary(library, lang);
      }
    }
  }

  /**
   * Loads translation entries from PO files within a specific library for a given language.
   *
   * @param library - The library to load translations for.
   * @param lang - The language code corresponding to the PO files.
   */
  loadTranslationsForLibrary(library: ModelicaLibrary, lang: string) {
    const translation = this.#translations.get(lang);
    if (!translation) return;

    const poPaths = [
      this.#fs.join(library.path, "i18n", `${lang}.po`),
      this.#fs.join(library.path, `package.${lang}.po`),
    ];

    for (const poPath of poPaths) {
      if (this.#fs.stat(poPath)?.isFile()) {
        const content = this.#fs.read(poPath);
        const entries = ModelicaPoParser.parse(content);
        for (const entry of entries) {
          translation.addEntry(entry);
        }
      }
    }
  }

  /**
   * Translates a string identifier into the currently active language, matching on an optional context.
   *
   * @param id - The message identifier to translate.
   * @param ctxt - The optional context string for disambiguation.
   * @returns The translated string, or the original message identifier if no translation exists.
   */
  translate(id: string, ctxt?: string): string {
    if (!this.#language) return id;
    const translation = this.#translations.get(this.#language);
    return translation?.translate(id, ctxt) ?? id;
  }

  /**
   * Scans loaded libraries to determine which translation languages are available.
   *
   * @returns An array of available language codes (e.g., ["de", "en_US", "fr"]).
   */
  availableLanguages(): string[] {
    const languages = new Set<string>();
    for (const library of this.#libraries) {
      const i18nPath = this.#fs.join(library.path, "i18n");
      const stats = this.#fs.stat(i18nPath);
      if (stats?.isDirectory()) {
        try {
          for (const entry of this.#fs.readdir(i18nPath)) {
            const name = entry.name;
            if (name.endsWith(".po")) {
              languages.add(name.replace(/\.po$/, ""));
            }
          }
        } catch {
          // ignore readdir errors
        }
      }
    }
    return [...languages].sort();
  }

  /**
   * Removes a loaded library from the context.
   *
   * @param path - The file system path of the library to remove.
   * @returns True if the library was found and removed, false otherwise.
   */
  removeLibrary(path: string): boolean {
    let i = this.#libraries.length;
    while (i--) {
      if (this.#libraries[i]?.path === path) {
        this.#libraries.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * Resolves a 'modelica://' URI into an absolute file system path.
   *
   * @param uri - The Modelica URI to resolve.
   * @returns The resolved absolute file path, or null if the URI is invalid or the library is not found.
   */
  resolveURI(uri: string): string | null {
    if (!uri.startsWith("modelica://")) return null;
    const parts = uri.substring(11).split("/");
    const libraryName = parts.shift();
    if (!libraryName) return null;
    const relativePath = parts.join(this.#fs.sep);

    for (const library of this.#libraries) {
      if (library.name === libraryName) {
        const stats = this.#fs.stat(library.path);
        const result = stats?.isDirectory()
          ? this.#fs.resolve(this.#fs.join(library.path, relativePath))
          : this.#fs.resolve(this.#fs.join(this.#fs.join(library.path, ".."), libraryName, relativePath));
        console.log(`resolveURI: ${uri} -> ${result}`);
        return result;
      }
    }
    console.warn(
      `resolveURI failed for ${uri}: library ${libraryName} not found among [${this.#libraries.map((l) => l.name).join(", ")}]`,
    );

    return null;
  }
}
