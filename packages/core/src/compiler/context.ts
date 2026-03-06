// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FileSystem } from "../util/filesystem.js";
import { StringWriter } from "../util/io.js";
import type { Parser, Tree } from "../util/tree-sitter.js";
import { ModelicaDAE, ModelicaDAEPrinter } from "./modelica/dae.js";
import { ModelicaFlattener } from "./modelica/flattener.js";
import { ModelicaClassInstance, ModelicaLibrary, type ModelicaElement } from "./modelica/model.js";
import { ModelicaPoParser, ModelicaTranslation } from "./modelica/po.js";
import { ModelicaStoredDefinitionSyntaxNode } from "./modelica/syntax.js";
import { Scope } from "./scope.js";

export class Context extends Scope {
  #classes: ModelicaClassInstance[] = [];
  #fs: FileSystem;
  #libraries: ModelicaLibrary[] = [];
  #translations = new Map<string, ModelicaTranslation>();
  #language: string | null = null;

  static #parsers = new Map<string, Parser>();

  constructor(fs: FileSystem) {
    super(null);
    this.#fs = fs;
  }

  readonly hash = "root";

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

    library = new ModelicaLibrary(this, path);
    this.#libraries.push(library);
    if (this.#language) {
      this.loadTranslationsForLibrary(library, this.#language);
    }
    return library;
  }

  get elements(): IterableIterator<ModelicaElement> {
    const classes = this.#classes;
    const libraries = this.#libraries;
    return (function* () {
      yield* classes;
      for (const library of libraries) {
        if (library) yield* library.elements;
      }
    })();
  }

  flatten(name: string): string | null {
    const instance = this.query(name);
    if (!instance) return null;
    const dae = new ModelicaDAE(instance.name ?? "DAE", instance.description);
    instance.accept(new ModelicaFlattener(), ["", dae]);
    const out = new StringWriter();
    dae.accept(new ModelicaDAEPrinter(out));
    return out.toString();
  }

  get fs(): FileSystem {
    return this.#fs;
  }

  getLibrary(path: string): ModelicaLibrary | null {
    for (const library of this.#libraries) {
      if (library.path == path) return library;
    }
    return null;
  }

  getParser(extname: string): Parser {
    const parser = Context.#parsers.get(extname);
    if (!parser) throw new Error(`no parser registered for extension '${extname}'`);
    return parser;
  }

  listLibraries(): IterableIterator<ModelicaLibrary> {
    const libraries = this.#libraries;
    return (function* () {
      yield* libraries;
    })();
  }

  load(input: string): void {
    const tree = this.parse(".mo", input);
    const node = ModelicaStoredDefinitionSyntaxNode.new(null, tree.rootNode);
    for (const classDefinition of node?.classDefinitions ?? [])
      this.#classes.push(ModelicaClassInstance.new(this, classDefinition));
  }

  parse(extname: string, input: string, oldTree?: Tree): Tree {
    const parser = this.getParser(extname);
    return parser.parse(input, oldTree, { bufferSize: input.length * 2 });
  }

  static registerParser(extname: string, parser: Parser) {
    Context.#parsers.set(extname, parser);
  }

  get language(): string | null {
    return this.#language;
  }

  setLanguage(lang: string | null) {
    this.#language = lang;
    if (lang && !this.#translations.has(lang)) {
      this.#translations.set(lang, new ModelicaTranslation());
      for (const library of this.#libraries) {
        this.loadTranslationsForLibrary(library, lang);
      }
    }
  }

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

  translate(id: string, ctxt?: string): string {
    if (!this.#language) return id;
    const translation = this.#translations.get(this.#language);
    return translation?.translate(id, ctxt) ?? id;
  }

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
