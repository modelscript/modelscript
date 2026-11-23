// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Zero-wrapper linear-memory CST accessor for `@modelscript/acsl`.
 *
 * Operates directly on WebAssembly linear memory node pointers (`number`) using
 * `WasmTreeCursor` and `RuntimeAdapter` without allocating intermediate AST wrapper objects.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AcslLinearCstNodeSummary {
  ptr: number;
  kind: string;
  startIndex: number;
  endIndex: number;
  depth: number;
}

export interface AcslWasmRuntimeLike {
  parse(oldTreePtr: number, editStart: number, editOldEnd: number, editNewEnd: number): number;
  getNodeFirstChild(ptr: number): number;
  getNodeNextSibling(ptr: number): number;
  getNodeType?(ptr: number): number;
  getNodeStartIndex?(ptr: number): number;
  getNodeEndIndex?(ptr: number): number;
}

export interface AcslWasmTreeLike {
  rootNode: {
    type: string;
    startIndex: number;
    endIndex: number;
    hasError?: boolean;
    childCount?: number;
    namedChildCount?: number;
    walk?: () => AcslWasmCursorLike;
  };
}

export interface AcslWasmCursorLike {
  nodeType: string;
  startIndex: number;
  endIndex: number;
  gotoFirstChild(): boolean;
  gotoNextSibling(): boolean;
  gotoParent(): boolean;
}

export interface AcslWasmParserLike {
  parse(input: string): AcslWasmTreeLike;
}

/**
 * Resolves the path to the compiled `dist/parser.wasm` binary whether invoked from `src/` or `dist/src/`.
 */
export function resolveAcslWasmPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../dist/parser.wasm"),
    path.resolve(here, "../../../dist/parser.wasm"),
    path.resolve(here, "../parser.wasm"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]!;
}

let cachedParserPromise: Promise<AcslWasmParserLike> | null = null;

/**
 * Loads and caches the native WebAssembly GLR parser for ACSL.
 */
export async function getAcslWasmParser(): Promise<AcslWasmParserLike> {
  if (cachedParserPromise) return cachedParserPromise;
  cachedParserPromise = (async () => {
    const wasmPath = resolveAcslWasmPath();
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bindingsCandidates = [
      path.resolve(here, "../../src-gen/bindings.js"),
      path.resolve(here, "../../../src-gen/bindings.js"),
    ];
    const bindingsPath = bindingsCandidates.find((p) => fs.existsSync(p)) ?? bindingsCandidates[0]!;
    const bindings = (await import(bindingsPath)) as {
      createWasmParser: (p: string) => Promise<{ parser: AcslWasmParserLike }>;
    };
    const { parser } = await bindings.createWasmParser(wasmPath);
    return parser;
  })();
  return cachedParserPromise;
}

/**
 * Data-oriented linear CST view backed by flat typed arrays (`Int32Array` for offsets/depths)
 * with zero per-node AST class wrapper allocations.
 */
export class AcslLinearCstView {
  readonly source: string;
  readonly nodeKinds: string[];
  readonly startOffsets: Int32Array;
  readonly endOffsets: Int32Array;
  readonly depths: Int32Array;
  readonly hasError: boolean;

  constructor(
    source: string,
    nodeKinds: string[],
    startOffsets: Int32Array,
    endOffsets: Int32Array,
    depths: Int32Array,
    hasError: boolean,
  ) {
    this.source = source;
    this.nodeKinds = nodeKinds;
    this.startOffsets = startOffsets;
    this.endOffsets = endOffsets;
    this.depths = depths;
    this.hasError = hasError;
  }

  get nodeCount(): number {
    return this.nodeKinds.length;
  }

  /**
   * Returns the source slice for linear CST node `idx`.
   */
  textOf(idx: number): string {
    const s = this.startOffsets[idx] ?? 0;
    const e = this.endOffsets[idx] ?? s;
    return this.source.slice(s, e);
  }

  /**
   * Finds all linear node indices matching a given CST rule kind.
   */
  findIndicesByKind(kind: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.nodeKinds.length; i++) {
      if (this.nodeKinds[i] === kind) out.push(i);
    }
    return out;
  }
}

/**
 * Parses ACSL source with the native WebAssembly GLR parser and flattens the CST
 * into a zero-wrapper `AcslLinearCstView` via cursor traversal.
 */
export async function parseAcslWasmCst(source: string): Promise<AcslLinearCstView> {
  const parser = await getAcslWasmParser();
  const tree = parser.parse(source);
  const root = tree.rootNode;

  const kinds: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const depths: number[] = [];

  if (typeof root.walk === "function") {
    const cursor = root.walk();
    let depth = 0;
    let reachedRoot = false;
    while (!reachedRoot) {
      kinds.push(cursor.nodeType);
      starts.push(cursor.startIndex);
      ends.push(cursor.endIndex);
      depths.push(depth);

      if (cursor.gotoFirstChild()) {
        depth++;
        continue;
      }
      if (cursor.gotoNextSibling()) {
        continue;
      }
      while (true) {
        if (!cursor.gotoParent()) {
          reachedRoot = true;
          break;
        }
        depth--;
        if (cursor.gotoNextSibling()) {
          break;
        }
      }
    }
  } else {
    kinds.push(root.type);
    starts.push(root.startIndex);
    ends.push(root.endIndex);
    depths.push(0);
  }

  return new AcslLinearCstView(
    source,
    kinds,
    Int32Array.from(starts),
    Int32Array.from(ends),
    Int32Array.from(depths),
    Boolean(root.hasError),
  );
}
