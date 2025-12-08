// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FileSystem } from "../util/filesystem.js";
import type { Parser, Tree } from "../util/tree-sitter.js";
import { ModelicaLibrary, ModelicaNamedElement, type ModelicaElement } from "./modelica/model.js";
import { Scope } from "./scope.js";

export class Context extends Scope {
  #fs: FileSystem;
  #libraries: ModelicaLibrary[] = [];
  static #parsers = new Map<string, Parser>();

  constructor(fs: FileSystem) {
    super(null);
    this.#fs = fs;
  }

  addLibrary(path: string): ModelicaLibrary {
    let library = this.getLibrary(path);
    if (library) return library;
    library = new ModelicaLibrary(this, path);
    this.#libraries.push(library);
    return library;
  }

  get elements(): IterableIterator<ModelicaElement> {
    const libraries = this.#libraries;
    return (function* () {
      for (const library of libraries) {
        if (library) yield* library.elements;
      }
    })();
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

  parse(extname: string, input: string, oldTree?: Tree): Tree {
    const parser = this.getParser(extname);
    return parser.parse(input, oldTree, { bufferSize: input.length * 2 });
  }

  query(name: string): ModelicaNamedElement | null {
    for (const library of this.#libraries) {
      const instance = library.query(name);
      if (instance) return instance;
    }
    return null;
  }

  static registerParser(extname: string, parser: Parser) {
    Context.#parsers.set(extname, parser);
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
}
