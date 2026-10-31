// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser, type Tree, type TreeSitterParser } from "../src-gen/bindings.js";
import { JsEmitter } from "./codegen/js-emitter.js";
import { NativeEmitter, type NativeCompileOptions } from "./codegen/native-emitter.js";
import { WasmEmitter } from "./codegen/wasm-emitter.js";

import { ModelScriptErrorCode, type ModelScriptDiagnostic } from "./errors.js";
import { ModelScriptLinter } from "./linter.js";
import {
  ModelScriptQueryEngine,
  unwrapNode,
  type ModelScriptCstNode,
  type ModelScriptType,
  type StructFieldLayout,
  type StructLayout,
} from "./queries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultWasmPath = path.join(__dirname, "../dist/parser.wasm");

type DynamicJsRunner = (...args: unknown[]) => unknown;
const createDynamicFunction = Object.getPrototypeOf(function () {}).constructor as (
  ...paramsAndBody: string[]
) => DynamicJsRunner;

export interface CompileOptions {
  wasmPath?: string | undefined;
  target?: "js" | "wasm" | "native" | undefined;
}

export class ModelScriptCompiler {
  private parser: TreeSitterParser | null = null;
  public linter = new ModelScriptLinter();
  public queries = new ModelScriptQueryEngine();

  async init(wasmPath = defaultWasmPath): Promise<void> {
    if (this.parser) return;
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    this.parser = parser;
  }

  parse(source: string): Tree {
    if (!this.parser) throw new Error("ModelScriptCompiler not initialized. Call await compiler.init() first.");
    const tree = this.parser.parse(source);
    if (!tree) throw new Error("Failed to parse ModelScript source.");
    return tree;
  }

  lint(source: string): ModelScriptDiagnostic[] {
    const tree = this.parse(source);
    return this.linter.lint(tree.rootNode);
  }

  compileToJs(source: string): { js: string; tree: Tree } {
    const tree = this.parse(source);
    const emitter = new JsEmitter();
    const js = emitter.emit(tree.rootNode);
    return { js, tree };
  }

  executeJs(source: string, context: Record<string, unknown> = {}): unknown {
    const { js } = this.compileToJs(source);
    const executableJs = js.replace(/^\s*import\s+[\s\S]*?\s+from\s+["'][^"']*["']\s*;\s*$/gm, "");
    const contextKeys = Object.keys(context);
    const contextVals = Object.values(context);
    const fn = createDynamicFunction(...contextKeys, executableJs);
    return fn(...contextVals);
  }

  compileToWat(source: string): string {
    const tree = this.parse(source);
    const emitter = new WasmEmitter();
    return emitter.emitWat(tree.rootNode);
  }

  async compileToWasm(source: string): Promise<Uint8Array> {
    const tree = this.parse(source);
    const emitter = new WasmEmitter();
    return await emitter.compile(tree.rootNode);
  }

  async executeWasm(source: string, entryFn = "main", args: number[] = []): Promise<number> {
    const wasmBytes = await this.compileToWasm(source);
    const res = (await WebAssembly.instantiate(wasmBytes)) as
      | WebAssembly.WebAssemblyInstantiatedSource
      | WebAssembly.Instance;
    const exports = "instance" in res ? res.instance.exports : res.exports;
    const fn = exports[entryFn];
    if (typeof fn !== "function") {
      throw new Error(`Exported WASM function '${entryFn}' not found`);
    }
    return (fn as (...callArgs: number[]) => number)(...args);
  }

  async compileToNative(source: string, options: NativeCompileOptions): Promise<string> {
    const tree = this.parse(source);
    const emitter = new NativeEmitter();
    return await emitter.compileToNative(tree.rootNode, options);
  }
}

export * from "./polyglot/resolver.js";
export {
  JsEmitter,
  ModelScriptErrorCode,
  ModelScriptLinter,
  ModelScriptQueryEngine,
  NativeEmitter,
  unwrapNode,
  WasmEmitter,
  type ModelScriptCstNode,
  type ModelScriptDiagnostic,
  type ModelScriptType,
  type NativeCompileOptions,
  type StructFieldLayout,
  type StructLayout,
};
