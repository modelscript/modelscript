// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FileSystem } from "../util/filesystem.js";
import type { Parser, Tree } from "../util/tree-sitter.js";

export class Context {
  #fs: FileSystem;
  static #parsers = new Map<string, Parser>();

  constructor(fs: FileSystem) {
    this.#fs = fs;
  }

  get fs(): FileSystem {
    return this.#fs;
  }

  getParser(extname: string): Parser {
    const parser = Context.#parsers.get(extname);
    if (!parser) throw new Error(`no parser registered for extension '${extname}'`);
    return parser;
  }

  parse(extname: string, input: string, oldTree?: Tree): Tree {
    const parser = this.getParser(extname);
    return parser.parse(input, oldTree, { bufferSize: input.length * 2 });
  }

  static registerParser(extname: string, parser: Parser) {
    Context.#parsers.set(extname, parser);
  }
}
