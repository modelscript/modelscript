// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { FileSystem, Parser, Tree } from "@modelscript/utils";
import type { QueryEngine } from "./query-engine.js";
import type { WorkspaceIndex } from "./workspace-index.js";

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
  functionInlining?: "inline" | "preserve";
  fmiVersion?: "2.0" | "3.0";
  solver?: InitSolverConfig;
  canonicalizeEquations?: boolean;
  /**
   * Batch mode: disables Salsa memoization and triggers manual GC between
   * compilation phases (parse → index → flatten).
   *
   * This should be enabled implicitly by one-shot execution environments
   * (like the CLI or CI pipelines) to stay within V8 heap limits. It should
   * NOT be used by long-lived processes (LSP, Web IDE) which rely on the cache.
   *
   * Requires Node.js to be started with `--expose-gc` for GC to take effect.
   */
  batch?: boolean;
}

export class Context {
  protected _fs: FileSystem;
  protected _workspaceIndex: WorkspaceIndex;
  protected _queryEngine: QueryEngine;
  protected _trees = new Map<string, Tree>();

  static _parsers = new Map<string, Parser>();

  constructor(fs: FileSystem, workspaceIndex: WorkspaceIndex, queryEngine: QueryEngine) {
    this._fs = fs;
    this._workspaceIndex = workspaceIndex;
    this._queryEngine = queryEngine;
  }

  get workspaceIndex(): WorkspaceIndex {
    return this._workspaceIndex;
  }

  setWorkspaceIndex(index: WorkspaceIndex): void {
    this._workspaceIndex = index;
  }

  get queryEngine(): QueryEngine {
    return this._queryEngine;
  }

  setQueryEngine(engine: QueryEngine): void {
    this._queryEngine = engine;
  }

  get fs(): FileSystem {
    return this._fs;
  }

  getTree(uri: string): Tree | undefined {
    return this._trees.get(uri);
  }

  getTreeText(resourceId: string | undefined, startByte: number, endByte: number): string | null {
    if (!resourceId) return null;
    const tree = this._trees.get(resourceId);
    if (!tree) return null;
    return tree.rootNode.text.substring(startByte, endByte);
  }

  getTreeNode(resourceId: string | undefined, startByte: number, endByte: number): any | null {
    if (!resourceId) return null;
    const tree = this._trees.get(resourceId);
    if (!tree) return null;
    return tree.rootNode.descendantForIndex(startByte, endByte);
  }

  getParser(extname: string): Parser {
    const parser = Context._parsers.get(extname);
    if (!parser) throw new Error(`no parser registered for extension '${extname}'`);
    return parser;
  }

  parse(extname: string, input: string, oldTree?: Tree): Tree {
    const parser = this.getParser(extname);
    return parser.parse(input, oldTree, { bufferSize: input.length * 2 });
  }

  load(input: string, resourceId?: string): Tree {
    const tree = this.parse(".mo", input);
    const uri = resourceId ?? "synthetic-" + Math.random().toString();
    this._trees.set(uri, tree);

    this._workspaceIndex.register(uri, () => tree.rootNode as any);
    return tree;
  }

  static registerParser(extname: string, parser: Parser) {
    Context._parsers.set(extname, parser);
  }
}
