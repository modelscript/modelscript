// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FileSystem } from "../util/filesystem.js";
import { StringWriter } from "../util/io.js";
import type { Parser, Tree } from "../util/tree-sitter.js";
import { ModelicaDAE, ModelicaDAEPrinter } from "./modelica/dae.js";
import { ModelicaFlattener } from "./modelica/flattener.js";
import { ModelicaClassInstance, ModelicaLibrary, type ModelicaElement } from "./modelica/model.js";
import { ModelicaStoredDefinitionSyntaxNode } from "./modelica/syntax.js";
import { Scope } from "./scope.js";

export class Context extends Scope {
  #classes: ModelicaClassInstance[] = [];
  #fs: FileSystem;
  #libraries: ModelicaLibrary[] = [];

  static #parsers = new Map<string, Parser>();

  constructor(fs: FileSystem) {
    super(null);
    this.#fs = fs;
  }

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
        if (stats?.isDirectory()) {
          return this.#fs.resolve(this.#fs.join(library.path, relativePath));
        } else {
          return this.#fs.resolve(this.#fs.join(this.#fs.join(library.path, ".."), libraryName, relativePath));
        }
      }
    }

    return null;
  }
}
