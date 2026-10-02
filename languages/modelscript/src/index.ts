// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { JsEmitter } from "./codegen/js-emitter.js";
import { NativeEmitter, type NativeCompileOptions } from "./codegen/native-emitter.js";
import { WasmEmitter } from "./codegen/wasm-emitter.js";

import { ModelScriptErrorCode, type ModelScriptDiagnostic } from "./errors.js";
import { ModelScriptLinter } from "./linter.js";
import {
  ModelScriptQueryEngine,
  unwrapNode,
  type ModelScriptType,
  type StructFieldLayout,
  type StructLayout,
} from "./queries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultWasmPath = path.join(__dirname, "../dist/parser.wasm");

export interface CompileOptions {
  wasmPath?: string;
  target?: "js" | "wasm" | "native";
}

export class ModelScriptCompiler {
  private parser: any = null;
  public linter = new ModelScriptLinter();
  public queries = new ModelScriptQueryEngine();

  async init(wasmPath = defaultWasmPath): Promise<void> {
    if (this.parser) return;
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    this.parser = parser;
  }

  parse(source: string) {
    if (!this.parser) throw new Error("ModelScriptCompiler not initialized. Call await compiler.init() first.");
    return this.parser.parse(source);
  }

  lint(source: string): ModelScriptDiagnostic[] {
    const tree = this.parse(source);
    return this.linter.lint(tree.rootNode);
  }

  compileToJs(source: string): { js: string; tree: any } {
    const tree = this.parse(source);
    const emitter = new JsEmitter();
    const js = emitter.emit(tree.rootNode);
    return { js, tree };
  }

  executeJs(source: string, context: Record<string, unknown> = {}): unknown {
    const { js } = this.compileToJs(source);
    const contextKeys = Object.keys(context);
    const contextVals = Object.values(context);
    const fn = new Function(...contextKeys, `${js}`);
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

  async executeWasm(source: string, entryFn = "main", args: number[] = []): Promise<any> {
    const wasmBytes = await this.compileToWasm(source);
    const res: any = await WebAssembly.instantiate(wasmBytes);
    const exports = res.instance ? res.instance.exports : res.exports;
    const fn = exports[entryFn];
    if (typeof fn !== "function") {
      throw new Error(`Exported WASM function '${entryFn}' not found`);
    }
    return fn(...args);
  }

  async compileToNative(source: string, options: NativeCompileOptions): Promise<string> {
    const tree = this.parse(source);
    const emitter = new NativeEmitter();
    return await emitter.compileToNative(tree.rootNode, options);
  }
}

export {
  JsEmitter,
  ModelScriptErrorCode,
  ModelScriptLinter,
  ModelScriptQueryEngine,
  NativeEmitter,
  unwrapNode,
  WasmEmitter,
  type ModelScriptDiagnostic,
  type ModelScriptType,
  type NativeCompileOptions,
  type StructFieldLayout,
  type StructLayout,
};
