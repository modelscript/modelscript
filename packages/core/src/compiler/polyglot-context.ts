/* eslint-disable @typescript-eslint/no-explicit-any */
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryEngine } from "@modelscript/polyglot/query-engine";
import type { WorkspaceIndex } from "@modelscript/polyglot/workspace-index";
import { MODELSCRIPT_CAS_PACKAGE, ModelicaDAE, ModelicaDAEPrinter } from "@modelscript/symbolics";
import type { FileSystem, Parser, Tree } from "@modelscript/utils";
import { StringWriter } from "@modelscript/utils";
import {
  QueryBackedClassInstance,
  createModelicaQueryEngine,
  createModelicaWorkspaceIndex,
} from "./modelica/metascript-bridge.js";
import { ModelicaLibrary, type ModelicaElement } from "./modelica/model.js";
import { ModelicaPoParser, ModelicaTranslation } from "./modelica/po.js";
import { ModelicaFlattener, findAlgebraicLoops } from "./modelica/polyglot-flattener.js";
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

/**
 * The polyglot compiler context managing file system resources and loaded Modelica code.
 */
export class PolyglotContext extends Scope {
  #classes: QueryBackedClassInstance[] = [];
  #fs: FileSystem;
  #libraries: ModelicaLibrary[] = [];
  #translations = new Map<string, ModelicaTranslation>();
  #language: string | null = null;
  #workspaceIndex: WorkspaceIndex;
  #queryEngine: QueryEngine;

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
    this.#queryEngine = createModelicaQueryEngine(this.#workspaceIndex);
    this.load(MODELSCRIPT_CAS_PACKAGE);
  }

  readonly hash = "root";

  /**
   * Adds and parses a Modelica library from the specified file system path.
   *
   * @param path - The absolute file system path to the directory or file representing the library.
   * @returns The loaded ModelicaLibrary instance, or null if the path does not point to a valid library.
   */
  addLibrary(path: string): ModelicaLibrary | null {
    let library = this.getLibrary(path);
    if (library) return library;

    const stats = this.#fs.stat(path);
    if (stats?.isDirectory()) {
      const pkgPath = this.#fs.join(path, "package.mo");
      if (!this.#fs.stat(pkgPath)?.isFile()) {
        return null;
      }
    }

    library = new ModelicaLibrary(this as any, path);
    this.#libraries.push(library);
    if (this.#language) {
      this.loadTranslationsForLibrary(library, this.#language);
    }
    return library;
  }

  /**
   * Gets all loaded Modelica elements across the context and its loaded libraries.
   *
   * @returns An iterable iterator over all top-level ModelicaElements.
   */
  get elements(): IterableIterator<ModelicaElement> {
    const classes = this.#classes;
    const libraries = this.#libraries;
    return (function* () {
      yield* classes;
      for (const library of libraries) {
        if (library) yield* library.elements;
      }
    })() as IterableIterator<ModelicaElement>;
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
    const instanceId = this.#queryEngine.resolveName(name.split("."));
    if (!instanceId) return null;
    const instance = new QueryBackedClassInstance(instanceId, this.#queryEngine.db);
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
    const parser = (PolyglotContext as any)._parsers.get(extname);
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
  load(input: string): void {
    const tree = this.parse(".mo", input);
    const result = this.#workspaceIndex.updateIndex(tree.rootNode);
    (this.#queryEngine as any).invalidate(result.changedIds);
    for (const id of result.addedIds) {
      const entry = this.#workspaceIndex.symbol(id);
      if (entry && entry.parentId === null && entry.kind === "Class") {
        this.#classes.push(new QueryBackedClassInstance(id, this.#queryEngine.db));
      }
    }
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
    (PolyglotContext as any)._parsers.set(extname, parser);
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
