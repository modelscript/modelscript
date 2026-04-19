/* eslint-disable @typescript-eslint/no-explicit-any */
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryEngine } from "@modelscript/polyglot/query-engine";
import type { WorkspaceIndex } from "@modelscript/polyglot/workspace-index";
import { MODELSCRIPT_CAS_PACKAGE, ModelicaDAE, ModelicaDAEPrinter } from "@modelscript/symbolics";
import type { FileSystem, Parser, Tree } from "@modelscript/utils";
import { StringWriter } from "@modelscript/utils";
import { ModelicaFlattener, findAlgebraicLoops } from "./modelica/flattener.js";
import {
  QueryBackedClassInstance,
  createModelicaQueryEngine,
  createModelicaWorkspaceIndex,
  injectPredefinedTypes,
} from "./modelica/metascript-bridge.js";
import { ModelicaPoParser, ModelicaTranslation } from "./modelica/po.js";
import { Scope } from "./scope.js";
export type HomotopyMode = "none" | "residual" | "symbolic" | "fixed-point" | "parameter" | "auto";
export type PreconditionerMode = "none" | "branch-and-bound";
export interface InitSolverConfig {
  preconditioner?: PreconditionerMode;
  homotopyMode?: HomotopyMode;
  mccormickRelaxation?: boolean;
  maxHomotopySteps?: number;
}

export interface ModelicaCompilerOptions {
  arrayMode?: "scalarize" | "preserve";
  fmiVersion?: "2.0" | "3.0";
  solver?: InitSolverConfig;
}

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
 */
export class Context extends Scope {
  #classes: QueryBackedClassInstance[] = [];
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

  get queryEngine(): QueryEngine {
    return this.#queryEngine;
  }

  getTree(uri: string): Tree | undefined {
    return this.#trees.get(uri);
  }

  static _parsers = new Map<string, Parser>();

  /**
   * Initializes a new compiler Context.
   *
   * @param fs - The FileSystem implementation to use for reading files and checking paths.
   */
  constructor(fs: FileSystem) {
    super(null);
    this.#fs = fs;
    this.#workspaceIndex = createModelicaWorkspaceIndex();

    // Provide a CSTTree that looks up trees by resourceId cached in Context
    const contextTree = {
      getText: (startByte: number, endByte: number, entry?: any) => {
        if (!entry || !entry.resourceId) return null;
        const tree = this.#trees.get(entry.resourceId);
        if (!tree) return null;
        return tree.rootNode.text.substring(startByte, endByte);
      },
      getNode: (startByte: number, endByte: number, entry?: any) => {
        console.log(
          "getNode called. startByte:",
          startByte,
          "endByte:",
          endByte,
          "entry?",
          !!entry,
          "resourceId:",
          entry?.resourceId,
        );
        if (!entry || !entry.resourceId) return null;
        const tree = this.#trees.get(entry.resourceId);
        if (!tree) {
          console.log("tree not found for resourceId:", entry.resourceId);
          return null;
        }
        const node = tree.rootNode.descendantForIndex(startByte, endByte);
        console.log("found descendant?", !!node, "type:", node?.type);
        return node;
      },
    };

    this.#queryEngine = createModelicaQueryEngine(this.#workspaceIndex.toUnified(), contextTree);
    this.load(MODELSCRIPT_CAS_PACKAGE, "modelscript-cas.mo");
  }

  readonly hash = "root";

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
        if (dir.endsWith(".mo")) {
          const basename = dir.split(/[/\\]/).pop();
          let parentFQN: string | undefined = currentFQN;

          if (basename === "package.mo") {
            const parts = currentFQN.split(".");
            parts.pop();
            parentFQN = parts.length > 0 ? parts.join(".") : undefined;
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
        }
      } else if (s.isDirectory()) {
        for (const entry of this.#fs.readdir(dir)) {
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
      if (entry && entry.parentId === null && entry.kind === "Class") {
        if (!this.#classes.some((c) => c.id === id)) {
          this.#classes.push(new QueryBackedClassInstance(id, this.#queryEngine.toQueryDB()));
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
      if (entry && entry.parentId === null && entry.kind === "Class") {
        if (!this.#classes.some((c) => c.id === id)) {
          this.#classes.push(new QueryBackedClassInstance(id, this.#queryEngine.toQueryDB()));
        }
      }
    }
  }

  get elements(): IterableIterator<any> {
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
  get classes(): readonly QueryBackedClassInstance[] {
    return this.#classes;
  }

  /**
   * Flattens a loaded Modelica class by name, generating the flattened DAE textual representation.
   *
   * @param name - The fully qualified name of the Modelica class to flatten.
   * @returns The flattened DAE (Differential Algebraic Equation) output as a string, or null if the class is not found or has errors.
   */
  flatten(name: string, options?: ModelicaCompilerOptions): string | null {
    const dae = this.flattenDAE(name, options);
    if (!dae) return null;
    const out = new StringWriter();
    dae.accept(new ModelicaDAEPrinter(out));
    return out.toString();
  }

  flattenDAE(name: string, options?: ModelicaCompilerOptions): ModelicaDAE | null {
    const parts = name.split(".");
    let instance: QueryBackedClassInstance | undefined = this.classes.find((c) => c.name === parts[0]);
    for (let i = 1; i < parts.length && instance; i++) {
      const next = [...instance.declaredElements].find((e: any) => e.name === parts[i] && e.isClassInstance);
      instance = next as QueryBackedClassInstance | undefined;
    }
    if (!instance) return null;

    const dae = new ModelicaDAE(
      name ?? instance.name ?? "DAE",
      (instance.entry?.metadata?.description as string) ?? null,
    );

    if (instance.classKind === "function" || instance.classKind === "operator function") {
      dae.classKind = instance.classKind;
    }
    const flattener = new ModelicaFlattener(options);
    instance.accept(flattener, ["", dae]);
    flattener.generateFlowBalanceEquations(dae);
    flattener.foldDAEConstants(dae);
    findAlgebraicLoops(dae);

    // Check for flattener-level diagnostics (e.g. invalid for-loop iterators, assignment to input/constant)
    const hasDAEErrors = (d: ModelicaDAE): boolean =>
      d.diagnostics.some((diag) => diag.severity === "error") || d.functions.some(hasDAEErrors);
    if (hasDAEErrors(dae)) return null;

    return dae;
  }

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
    const unified = this.#workspaceIndex.toUnified();
    injectPredefinedTypes(unified);
    this.#queryEngine.updateIndex(unified);

    this.#classes = this.#classes.filter((c) => c.db.symbol(c.id)?.resourceId !== uri);
    for (const id of this.#queryEngine.index.symbols.keys()) {
      const entry = this.#queryEngine.index.symbols.get(id);
      if (entry && entry.parentId === null && entry.kind === "Class" && entry.resourceId === uri) {
        this.#classes.push(new QueryBackedClassInstance(id, this.#queryEngine.toQueryDB()));
      }
    }
    return tree;
  }

  /**
   * Manually injects a pre-constructed Modelica class into the compiler context.
   *
   * @param classInstance - The root class instance to attach.
   */
  addClass(classInstance: QueryBackedClassInstance): void {
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
