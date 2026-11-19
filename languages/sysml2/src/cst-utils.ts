// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Shared Native WASM GLR Parser & CST Traversal Utilities.
 *
 * Provides zero-regex access to the compiled `@modelscript/sysml2` WASM GLR CST,
 * linear-memory CST traversal primitives, expression token stream extraction from
 * CST leaves, constraint block body unwrapping, and documentation comment extraction.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParserSync } from "../src-gen/bindings.js";

export interface SysmlCstTree {
  sourceCode?: string | undefined;
  _encoding?: number | undefined;
  mem32?: Uint32Array | undefined;
  facade?:
    | {
        getInputEncoding?(): number;
        syntaxNames?: string[] | undefined;
        exports?:
          | {
              getInputBuffer?(): number;
              lsp_getInputBuffer?(): number;
              getFatPaddingPtr?(rawPad: number): number;
            }
          | undefined;
      }
    | undefined;
}

export type SysmlCstNodeConstructor = new (
  tree: SysmlCstTree,
  ptr: number,
  startOffset: number,
  parent: SysmlCstNode | null | undefined,
  pad: number,
  len: number,
  typeId: number,
  fieldId: number,
) => SysmlCstNode;

export interface SysmlCstNode {
  type: string;
  text: string;
  name?: string | undefined;
  ptr?: number | undefined;
  typeId?: number | undefined;
  _startOffset?: number | undefined;
  _cachedPad?: number | undefined;
  _cachedLen?: number | undefined;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  startPosition?: { row: number; column: number } | undefined;
  endPosition?: { row: number; column: number } | undefined;
  tree?: SysmlCstTree | undefined;
  parent?: SysmlCstNode | null | undefined;
  childCount?: number | undefined;
  children?: SysmlCstNode[] | undefined;
  child?(index: number): SysmlCstNode | null | undefined;
  childForFieldName?(name: string): SysmlCstNode | null | undefined;
  childrenForFieldName?(name: string): SysmlCstNode[];
  hasError?: boolean | (() => boolean) | undefined;
}

export type SysmlWasmParser = NonNullable<ReturnType<typeof createWasmParserSync>>["parser"] & {
  parse(text: string): { rootNode?: SysmlCstNode | null | undefined } | null | undefined;
};

let cachedSysmlParser: SysmlWasmParser | null = null;

const SYSML_PARSE_LRU_CAPACITY = 512;
const sysmlParseLruCache = new Map<string, SysmlCstNode | null>();

/**
 * Injects an initialized WebAssembly GLR parser instance (e.g., in browser/web worker environments).
 */
export function registerSysmlWasmParser(parser: SysmlWasmParser): void {
  cachedSysmlParser = parser;
  sysmlParseLruCache.clear();
}

/**
 * Lazily loads and caches the synchronous WebAssembly GLR parser for SysML v2 (`parser.wasm`).
 */
export function getSysmlParser(): SysmlWasmParser | null {
  if (cachedSysmlParser) return cachedSysmlParser;
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidatePaths = [
      path.resolve(currentDir, "../dist/parser.wasm"),
      path.resolve(currentDir, "../parser.wasm"),
      path.resolve(currentDir, "../.cache/parser.wasm"),
      path.resolve(currentDir, "../../dist/parser.wasm"),
      path.resolve(currentDir, "../../parser.wasm"),
    ];
    const wasmPath = candidatePaths.find((p) => fs.existsSync(p));
    if (wasmPath) {
      cachedSysmlParser = (createWasmParserSync(wasmPath)?.parser as SysmlWasmParser | undefined) ?? null;
    }
  } catch {
    // Parser fallback
  }
  return cachedSysmlParser;
}

/**
 * Parses SysML v2 source text using the native WASM GLR parser with an O(1) bounded LRU cache.
 */
export function parseSysmlSource(sourceText: string): SysmlCstNode | null {
  if (sysmlParseLruCache.has(sourceText)) {
    const cached = sysmlParseLruCache.get(sourceText) ?? null;
    sysmlParseLruCache.delete(sourceText);
    sysmlParseLruCache.set(sourceText, cached);
    return cached;
  }
  const parser = getSysmlParser();
  if (!parser) return null;
  const root = parser.parse(sourceText)?.rootNode ?? null;
  if (sysmlParseLruCache.size >= SYSML_PARSE_LRU_CAPACITY) {
    const oldestKey = sysmlParseLruCache.keys().next().value;
    if (oldestKey !== undefined) {
      sysmlParseLruCache.delete(oldestKey);
    }
  }
  sysmlParseLruCache.set(sourceText, root);
  return root;
}

/**
 * Zero-allocation linear-memory CST text extractor from raw `(startOffset, pad, len)` in `Tree`.
 */
export function extractLinearNodeText(tree: SysmlCstTree, startOffset: number, pad: number, len: number): string {
  const enc = tree.facade?.getInputEncoding ? tree.facade.getInputEncoding() : (tree._encoding ?? 1);
  const wasmMemory = (tree.facade as { wasmMemory?: WebAssembly.Memory } | undefined)?.wasmMemory;
  if ((enc === 0 || enc === 3 || enc === 4) && tree.facade && wasmMemory) {
    const getInputBuf = tree.facade.exports?.getInputBuffer || tree.facade.exports?.lsp_getInputBuffer;
    if (getInputBuf) {
      const inputBufPtr = getInputBuf();
      const rawBytes = new Uint8Array(wasmMemory.buffer, inputBufPtr + startOffset + pad, len);
      if (enc === 3 || enc === 4) {
        const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
        const cps: number[] = [];
        for (let k = 0; k + 3 < len; k += 4) {
          cps.push(view.getUint32(k, enc === 3));
        }
        return String.fromCodePoint(...cps);
      }
      return typeof TextDecoder !== "undefined"
        ? new TextDecoder("utf-8").decode(rawBytes)
        : String.fromCharCode(...rawBytes);
    }
  }
  if (!tree.sourceCode) return "";
  const s = startOffset + pad;
  const e = startOffset + pad + len;
  if (enc === 3 || enc === 4) {
    return Array.from(tree.sourceCode).slice(s, e).join("");
  }
  return tree.sourceCode.substring(s, e);
}

/**
 * Returns direct visible CST children matching `type`, descending transparently through hidden rules (`_`).
 */
export function findCstChildren(
  node: SysmlCstNode | null | undefined,
  type: string,
  results: SysmlCstNode[] = [],
): SysmlCstNode[] {
  if (!node) return results;
  if (
    typeof node.ptr === "number" &&
    node.ptr > 0 &&
    node.tree?.mem32 &&
    node.tree?.facade?.syntaxNames &&
    !(node as { _cachedChildren?: unknown })._cachedChildren
  ) {
    const mem32: Uint32Array = node.tree.mem32;
    const syntaxNames: string[] = node.tree.facade.syntaxNames;
    const NodeCtor = node.constructor as unknown as SysmlCstNodeConstructor;

    const ptrStack: number[] = [];
    const offsetStack: number[] = [];
    let currentChildPtr = mem32[(node.ptr + 12) >>> 2]!;
    let currentOffset = (node._startOffset ?? 0) + (node._cachedPad ?? 0);

    while (true) {
      if (currentChildPtr !== 0) {
        const typeFlags = mem32[currentChildPtr >>> 2]!;
        const typeId = typeFlags & 0xffff;
        const name = syntaxNames[typeId] || "";
        const flags = typeFlags >>> 16;
        const len = mem32[(currentChildPtr + 4) >>> 2]!;
        const pad = mem32[(currentChildPtr + 8) >>> 2]!;
        const isInvisible = (flags & 4) !== 0;

        const nextChildPtr = mem32[(currentChildPtr + 16) >>> 2]!;
        const nextOffset = currentOffset + pad + len;

        if (name.startsWith("_") || isInvisible) {
          if (nextChildPtr !== 0) {
            ptrStack.push(nextChildPtr);
            offsetStack.push(nextOffset);
          }
          currentChildPtr = mem32[(currentChildPtr + 12) >>> 2]!;
          currentOffset = currentOffset + pad;
          continue;
        } else if (name === type) {
          results.push(new NodeCtor(node.tree, currentChildPtr, currentOffset, node, pad, len, typeId, -1));
        }

        currentOffset = nextOffset;
        currentChildPtr = nextChildPtr;
      } else {
        if (ptrStack.length === 0) break;
        currentChildPtr = ptrStack.pop()!;
        currentOffset = offsetStack.pop()!;
      }
    }
    return results;
  }

  const count = node.childCount ?? node.children?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const child = node.child ? node.child(i) : node.children?.[i];
    if (!child) continue;
    if (child.type === type) {
      results.push(child);
    }
  }
  return results;
}

/**
 * Recursively finds all visible CST descendants matching `type`.
 */
export function findCstDescendants(
  node: SysmlCstNode | null | undefined,
  type: string,
  results: SysmlCstNode[] = [],
): SysmlCstNode[] {
  if (!node) return results;
  if (typeof node.ptr === "number" && node.ptr > 0 && node.tree?.mem32 && node.tree?.facade?.syntaxNames) {
    if (node.type === type) results.push(node);
    const mem32: Uint32Array = node.tree.mem32;
    const syntaxNames: string[] = node.tree.facade.syntaxNames;
    const NodeCtor = node.constructor as unknown as SysmlCstNodeConstructor;

    const ptrStack: number[] = [];
    const offsetStack: number[] = [];
    let currentChildPtr = mem32[(node.ptr + 12) >>> 2]!;
    let currentOffset = (node._startOffset ?? 0) + (node._cachedPad ?? 0);

    while (true) {
      if (currentChildPtr !== 0) {
        const typeFlags = mem32[currentChildPtr >>> 2]!;
        const typeId = typeFlags & 0xffff;
        const name = syntaxNames[typeId] || "";
        const flags = typeFlags >>> 16;
        const len = mem32[(currentChildPtr + 4) >>> 2]!;
        const pad = mem32[(currentChildPtr + 8) >>> 2]!;
        const isInvisible = (flags & 4) !== 0;

        if (!isInvisible && name === type) {
          results.push(new NodeCtor(node.tree, currentChildPtr, currentOffset, node, pad, len, typeId, -1));
        }

        const nextChildPtr = mem32[(currentChildPtr + 16) >>> 2]!;
        const nextOffset = currentOffset + pad + len;
        const grandChildPtr = mem32[(currentChildPtr + 12) >>> 2]!;

        if (grandChildPtr !== 0) {
          if (nextChildPtr !== 0) {
            ptrStack.push(nextChildPtr);
            offsetStack.push(nextOffset);
          }
          currentChildPtr = grandChildPtr;
          currentOffset = currentOffset + pad;
        } else {
          currentChildPtr = nextChildPtr;
          currentOffset = nextOffset;
        }
      } else {
        if (ptrStack.length === 0) break;
        currentChildPtr = ptrStack.pop()!;
        currentOffset = offsetStack.pop()!;
      }
    }
    return results;
  }

  if (node.type === type) results.push(node);
  const count = node.childCount ?? node.children?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const child = node.child ? node.child(i) : node.children?.[i];
    if (child) findCstDescendants(child, type, results);
  }
  return results;
}

/**
 * Finds the first visible CST descendant matching `type`.
 */
export function findFirstDescendant(node: SysmlCstNode | null | undefined, type: string): SysmlCstNode | null {
  if (!node) return null;
  if (typeof node.ptr === "number" && node.ptr > 0 && node.tree?.mem32 && node.tree?.facade?.syntaxNames) {
    if (node.type === type) return node;
    const mem32: Uint32Array = node.tree.mem32;
    const syntaxNames: string[] = node.tree.facade.syntaxNames;
    const NodeCtor = node.constructor as unknown as SysmlCstNodeConstructor;

    const ptrStack: number[] = [];
    const offsetStack: number[] = [];
    let currentChildPtr = mem32[(node.ptr + 12) >>> 2]!;
    let currentOffset = (node._startOffset ?? 0) + (node._cachedPad ?? 0);

    while (true) {
      if (currentChildPtr !== 0) {
        const typeFlags = mem32[currentChildPtr >>> 2]!;
        const typeId = typeFlags & 0xffff;
        const name = syntaxNames[typeId] || "";
        const flags = typeFlags >>> 16;
        const len = mem32[(currentChildPtr + 4) >>> 2]!;
        const pad = mem32[(currentChildPtr + 8) >>> 2]!;
        const isInvisible = (flags & 4) !== 0;

        if (!isInvisible && name === type) {
          return new NodeCtor(node.tree, currentChildPtr, currentOffset, node, pad, len, typeId, -1);
        }

        const nextChildPtr = mem32[(currentChildPtr + 16) >>> 2]!;
        const nextOffset = currentOffset + pad + len;
        const grandChildPtr = mem32[(currentChildPtr + 12) >>> 2]!;

        if (grandChildPtr !== 0) {
          if (nextChildPtr !== 0) {
            ptrStack.push(nextChildPtr);
            offsetStack.push(nextOffset);
          }
          currentChildPtr = grandChildPtr;
          currentOffset = currentOffset + pad;
        } else {
          currentChildPtr = nextChildPtr;
          currentOffset = nextOffset;
        }
      } else {
        if (ptrStack.length === 0) break;
        currentChildPtr = ptrStack.pop()!;
        currentOffset = offsetStack.pop()!;
      }
    }
    return null;
  }

  if (node.type === type) return node;
  const count = node.childCount ?? node.children?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const child = node.child ? node.child(i) : node.children?.[i];
    const found = findFirstDescendant(child, type);
    if (found) return found;
  }
  return null;
}

/**
 * Direct children array helper supporting both lazy `child(i)` and materialized `children`.
 */
export function getCstChildren(node: SysmlCstNode | null | undefined): SysmlCstNode[] {
  if (!node) return [];
  if (node.children) return node.children;
  const count = node.childCount ?? 0;
  if (count === 0 || !node.child) return [];
  const out: SysmlCstNode[] = [];
  for (let i = 0; i < count; i++) {
    const c = node.child(i);
    if (c) out.push(c);
  }
  return out;
}

export interface CstLeaf {
  type: string;
  text: string;
  start: number;
  end: number;
}

/**
 * Collects all non-empty lexical leaf tokens from a SysML v2 CST subtree in source order.
 * Skips zero-length GLR error-recovery tokens and excludes comments (which the WASM lexer drops).
 */
export function collectCstLeaves(node: SysmlCstNode | null | undefined, out: CstLeaf[] = []): CstLeaf[] {
  if (!node) return out;
  const children = getCstChildren(node);
  if (children.length === 0) {
    const start = node.startIndex ?? -1;
    const end = node.endIndex ?? -1;
    if (end >= 0 && start >= 0 ? end > start : node.text.length > 0) {
      out.push({
        type: node.type,
        text: node.text,
        start,
        end,
      });
    }
    return out;
  }
  for (const child of children) {
    collectCstLeaves(child, out);
  }
  return out;
}

/**
 * Collapses runs of ASCII whitespace in `text` to single spaces and trims ends without regexes.
 */
export function collapseWhitespace(text: string): string {
  let out = "";
  let inWs = true;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isWs = code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
    if (isWs) {
      if (!inWs) {
        out += " ";
        inWs = true;
      }
    } else {
      out += text[i]!;
      inWs = false;
    }
  }
  return out.endsWith(" ") ? out.slice(0, -1) : out;
}

/**
 * Finds the matching closing `* /` index for a block comment starting with `/*` at `openPos`,
 * properly counting nested block comment depth. Returns `-1` if unclosed.
 */
export function findMatchingBlockCommentEnd(source: string, openPos: number): number {
  if (!source.startsWith("/*", openPos)) return -1;
  let depth = 1;
  let i = openPos + 2;
  while (i + 1 < source.length) {
    const c0 = source.charCodeAt(i);
    const c1 = source.charCodeAt(i + 1);
    if (c0 === 47 /* / */ && c1 === 42 /* * */) {
      depth++;
      i += 2;
      continue;
    }
    if (c0 === 42 /* * */ && c1 === 47 /* / */) {
      depth--;
      if (depth === 0) return i;
      i += 2;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Extracts documentation comment text from a `Documentation` CST node and backing source string.
 */
export function getDocumentationCommentText(docNode: SysmlCstNode, fullSource: string): string | undefined {
  const leaves = collectCstLeaves(docNode);
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!;
    if (leaf.text.length >= 2 && leaf.text.startsWith('"') && leaf.text.endsWith('"')) {
      const prev = i > 0 ? leaves[i - 1]?.text.toLowerCase() : "";
      if (prev === "locale") continue;
      return collapseWhitespace(leaf.text.slice(1, -1));
    }
  }
  const candidateStarts: number[] = [];
  if (leaves.length > 0 && leaves[leaves.length - 1]!.end >= 0) {
    candidateStarts.push(leaves[leaves.length - 1]!.end);
  }
  if ((docNode.endIndex ?? -1) >= 0) {
    candidateStarts.push(docNode.endIndex!);
  }
  for (const searchFrom of candidateStarts) {
    if (searchFrom < 0 || searchFrom > fullSource.length) continue;
    let pos = searchFrom;
    while (pos < fullSource.length) {
      const code = fullSource.charCodeAt(pos);
      if (code === 32 || code === 9 || code === 10 || code === 13) {
        pos++;
        continue;
      }
      break;
    }
    if (fullSource.startsWith("/*", pos)) {
      const closeIdx = findMatchingBlockCommentEnd(fullSource, pos);
      if (closeIdx !== -1) {
        return collapseWhitespace(fullSource.slice(pos + 2, closeIdx));
      }
    }
  }
  return undefined;
}

export interface SysmlExprToken {
  type: "number" | "ident" | "string" | "op" | "punct" | "eof";
  text: string;
}

function isAsciiDigit(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57;
}

function isAsciiDigits(s: string): boolean {
  if (!s.length) return false;
  for (let i = 0; i < s.length; i++) {
    if (!isAsciiDigit(s[i]!)) return false;
  }
  return true;
}

function isExponentDigitsToken(s: string): boolean {
  if (!s.length || !isAsciiDigit(s[0]!)) return false;
  let i = 0;
  while (i < s.length && isAsciiDigit(s[i]!)) i++;
  if (i === s.length) return true;
  if (s[i] !== "e" && s[i] !== "E") return false;
  i++;
  if (i < s.length && (s[i] === "+" || s[i] === "-")) i++;
  return i < s.length && isAsciiDigits(s.slice(i));
}

function isIdentStartCode(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function isSuperscriptDigitCode(c: number): boolean {
  return c === 0x00b2 || c === 0x00b3 || c === 0x00b9 || (c >= 0x2070 && c <= 0x2079);
}

function isIdentPartCode(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || isSuperscriptDigitCode(c);
}

function stripSingleQuotes(raw: string): string {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1);
  }
  return raw;
}

function isIdentLeaf(leaf: CstLeaf): boolean {
  return isSysmlIdentLeaf(leaf.text);
}

const LOGICAL_OP_WORDS = new Set(["and", "or", "xor", "implies", "not"]);
const NON_IDENT_KEYWORDS = new Set(["if", "then", "else"]);

/**
 * Converts WASM GLR parser CST leaf tokens into normalized expression tokens
 * (coalescing decimals, exponents, dotted paths, measurement units, and shorthand operators).
 */
export function cstLeavesToExprTokens(leaves: readonly CstLeaf[]): SysmlExprToken[] {
  const tokens: SysmlExprToken[] = [];
  let i = 0;

  while (i < leaves.length) {
    const leaf = leaves[i]!;
    const text = leaf.text;

    // 1. Strip SI unit brackets following a primary value (`100 [kg]`, `mass [kg]`, `(a + b) [m/s^2]`)
    if (text === "[" && tokens.length > 0) {
      const prev = tokens[tokens.length - 1]!;
      if (
        prev.type === "number" ||
        (prev.type === "ident" && !NON_IDENT_KEYWORDS.has(prev.text)) ||
        (prev.type === "punct" && prev.text === ")")
      ) {
        let depth = 1;
        i++;
        while (i < leaves.length && depth > 0) {
          if (leaves[i]!.text === "[") depth++;
          else if (leaves[i]!.text === "]") depth--;
          i++;
        }
        continue;
      }
    }

    // 2. Double-quoted string literals ONLY (single-quoted `'...'` are SysML v2 unrestricted names)
    if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
      tokens.push({ type: "string", text: text.slice(1, -1) });
      i++;
      continue;
    }

    // 3. Numbers (integers, floats `9.81`, leading dot `.5`, scientific notation `1e-5` / `1.5e+3`)
    if (isExponentDigitsToken(text)) {
      let numText = text;
      const next = leaves[i + 1];
      const after = leaves[i + 2];
      if (
        isAsciiDigits(text) &&
        next &&
        next.text === "." &&
        leaf.end === next.start &&
        after &&
        isExponentDigitsToken(after.text) &&
        next.end === after.start
      ) {
        numText = `${text}.${after.text}`;
        i += 3;
      } else {
        i++;
      }
      tokens.push({ type: "number", text: numText });
      continue;
    }
    if (
      text === "." &&
      leaves[i + 1] &&
      isExponentDigitsToken(leaves[i + 1]!.text) &&
      leaf.end === leaves[i + 1]!.start
    ) {
      tokens.push({ type: "number", text: `.${leaves[i + 1]!.text}` });
      i += 2;
      continue;
    }

    // 4. Identifiers (including `'...'` unrestricted names), dotted chains (`a.b.c`), qualified names (`a::b`), and word operators
    if (isIdentLeaf(leaf)) {
      const isQuotedIdent = text.startsWith("'") && text.endsWith("'");
      if (!isQuotedIdent) {
        const lower = text.toLowerCase();
        if (LOGICAL_OP_WORDS.has(lower)) {
          tokens.push({ type: "op", text: lower });
          i++;
          continue;
        }
        if (NON_IDENT_KEYWORDS.has(lower)) {
          tokens.push({ type: "ident", text: lower });
          i++;
          continue;
        }
      }

      let name = stripSingleQuotes(text);
      let j = i + 1;
      while (j + 1 < leaves.length) {
        const sep = leaves[j]!;
        const seg = leaves[j + 1]!;
        if ((sep.text === "." || sep.text === "::") && isIdentLeaf(seg)) {
          name += `${sep.text}${stripSingleQuotes(seg.text)}`;
          j += 2;
        } else {
          break;
        }
      }
      tokens.push({ type: "ident", text: name });
      i = j;
      continue;
    }

    // 5. Two-leaf contiguous operator sequences split by GLR recovery (`||`, `&&`, `<>`, `=>`, `->`, `**`)
    const next = leaves[i + 1];
    if (next && leaf.end === next.start) {
      const pair = text + next.text;
      if (pair === "&&") {
        tokens.push({ type: "op", text: "and" });
        i += 2;
        continue;
      }
      if (pair === "||") {
        tokens.push({ type: "op", text: "or" });
        i += 2;
        continue;
      }
      if (pair === "<>") {
        tokens.push({ type: "op", text: "!=" });
        i += 2;
        continue;
      }
      if (pair === "=>" || pair === "->") {
        tokens.push({ type: "op", text: "implies" });
        i += 2;
        continue;
      }
      if (pair === "**") {
        tokens.push({ type: "op", text: "^" });
        i += 2;
        continue;
      }
      if (pair === "<=" || pair === ">=" || pair === "==" || pair === "!=") {
        tokens.push({ type: "op", text: pair });
        i += 2;
        continue;
      }
    }

    // 6. Single-leaf multi-char & single-char operators
    if (text === "&&") {
      tokens.push({ type: "op", text: "and" });
      i++;
      continue;
    }
    if (text === "||") {
      tokens.push({ type: "op", text: "or" });
      i++;
      continue;
    }
    if (text === "=>" || text === "->") {
      tokens.push({ type: "op", text: "implies" });
      i++;
      continue;
    }
    if (text === "**") {
      tokens.push({ type: "op", text: "^" });
      i++;
      continue;
    }
    if (text === "===" || text === "==" || text === "=") {
      tokens.push({ type: "op", text: "==" });
      i++;
      continue;
    }
    if (text === "!==" || text === "!=" || text === "<>") {
      tokens.push({ type: "op", text: "!=" });
      i++;
      continue;
    }
    if (text === "!" || text === "~") {
      tokens.push({ type: "op", text: "not" });
      i++;
      continue;
    }
    if (
      text === "<=" ||
      text === ">=" ||
      text === "<" ||
      text === ">" ||
      text === "+" ||
      text === "-" ||
      text === "*" ||
      text === "/" ||
      text === "%" ||
      text === "^"
    ) {
      tokens.push({ type: "op", text });
      i++;
      continue;
    }

    // 7. Punctuation
    if (
      text === "(" ||
      text === ")" ||
      text === "," ||
      text === "?" ||
      text === ":" ||
      text === ";" ||
      text === "{" ||
      text === "}"
    ) {
      tokens.push({ type: "punct", text });
      i++;
      continue;
    }

    i++;
  }

  tokens.push({ type: "eof", text: "" });
  return tokens;
}

const EXPR_WRAP_PREFIX = "attribute __e = (\n";
const EXPR_WRAP_SUFFIX = "\n);";

/**
 * Tokenizes a SysML v2 expression string using the native WASM GLR parser (zero regexes).
 */
export function tokenizeSysmlExpressionCst(exprText: string): SysmlExprToken[] {
  const wrapped = `${EXPR_WRAP_PREFIX}${exprText}${EXPR_WRAP_SUFFIX}`;
  const root = parseSysmlSource(wrapped);
  if (!root) {
    return [{ type: "eof", text: "" }];
  }
  const minOffset = EXPR_WRAP_PREFIX.length;
  const maxOffset = minOffset + exprText.length;
  const allLeaves = collectCstLeaves(root);
  const exprLeaves = allLeaves.filter((l) => l.start >= minOffset && l.end <= maxOffset);
  return cstLeavesToExprTokens(exprLeaves);
}

const DECL_START_KEYWORDS = new Set([
  "attribute",
  "in",
  "out",
  "inout",
  "subject",
  "objective",
  "part",
  "port",
  "ref",
  "verify",
  "satisfy",
]);

const CONSTRAINT_HEADER_PREFIXES = new Set(["require", "assert", "assume"]);

function hasBlockCommentInGap(source: string, fromOffset: number, toOffset: number): boolean {
  if (fromOffset < 0 || toOffset <= fromOffset) return false;
  const end = Math.min(toOffset, source.length);
  let i = fromOffset;
  while (i + 1 < end) {
    const c0 = source.charCodeAt(i);
    const c1 = source.charCodeAt(i + 1);
    if (c0 === 47 /* / */ && c1 === 47 /* / */) {
      i += 2;
      while (i < end && source.charCodeAt(i) !== 10) i++;
      continue;
    }
    if (c0 === 47 /* / */ && c1 === 42 /* * */) {
      return true;
    }
    i++;
  }
  return false;
}

function skipLeadingAnnotatingLeaves(slice: readonly CstLeaf[], source: string): readonly CstLeaf[] {
  let cur = slice;
  while (cur.length > 0) {
    const head = cur[0]!.text.toLowerCase();
    if (head === "doc") {
      let k = 1;
      let prevEnd = cur[0]!.end;
      if (!hasBlockCommentInGap(source, prevEnd, cur[k]?.start ?? source.length)) {
        if (cur[k]?.text === "<" && cur[k + 2]?.text === ">") {
          prevEnd = cur[k + 2]!.end;
          k += 3;
        }
        if (
          !hasBlockCommentInGap(source, prevEnd, cur[k]?.start ?? source.length) &&
          cur[k] &&
          isIdentLeaf(cur[k]!) &&
          cur[k]!.text.toLowerCase() !== "locale"
        ) {
          const nextLeaf = cur[k + 1];
          const followedByDocMeta =
            !nextLeaf ||
            hasBlockCommentInGap(source, cur[k]!.end, nextLeaf.start) ||
            nextLeaf.text.toLowerCase() === "locale" ||
            nextLeaf.text.startsWith('"') ||
            nextLeaf.text.startsWith("/*") ||
            nextLeaf.text === ";";
          if (followedByDocMeta) {
            prevEnd = cur[k]!.end;
            k++;
          }
        }
        if (
          !hasBlockCommentInGap(source, prevEnd, cur[k]?.start ?? source.length) &&
          cur[k]?.text.toLowerCase() === "locale" &&
          cur[k + 1]?.text.startsWith('"')
        ) {
          prevEnd = cur[k + 1]!.end;
          k += 2;
        }
        if (
          !hasBlockCommentInGap(source, prevEnd, cur[k]?.start ?? source.length) &&
          (cur[k]?.text.startsWith('"') || cur[k]?.text.startsWith("/*"))
        ) {
          prevEnd = cur[k]!.end;
          k++;
        }
      }
      if (cur[k]?.text.startsWith("/*")) k++;
      if (cur[k]?.text === ";") k++;
      cur = cur.slice(k);
      continue;
    }

    if (head === "comment") {
      let k = 1;
      let prevEnd = cur[0]!.end;
      if (!hasBlockCommentInGap(source, prevEnd, cur[k]?.start ?? source.length)) {
        if (cur[k]?.text === "<" && cur[k + 2]?.text === ">") {
          prevEnd = cur[k + 2]!.end;
          k += 3;
        }
        if (
          !hasBlockCommentInGap(source, prevEnd, cur[k]?.start ?? source.length) &&
          cur[k] &&
          isIdentLeaf(cur[k]!) &&
          cur[k]!.text.toLowerCase() !== "about" &&
          cur[k]!.text.toLowerCase() !== "locale"
        ) {
          const nextLeaf = cur[k + 1];
          const followedByCommentMeta =
            !nextLeaf ||
            hasBlockCommentInGap(source, cur[k]!.end, nextLeaf.start) ||
            nextLeaf.text.toLowerCase() === "about" ||
            nextLeaf.text.toLowerCase() === "locale" ||
            nextLeaf.text.startsWith('"') ||
            nextLeaf.text.startsWith("/*") ||
            nextLeaf.text === ";";
          if (followedByCommentMeta) {
            prevEnd = cur[k]!.end;
            k++;
          }
        }
        if (
          !hasBlockCommentInGap(source, prevEnd, cur[k]?.start ?? source.length) &&
          cur[k]?.text.toLowerCase() === "about"
        ) {
          prevEnd = cur[k]!.end;
          k++;
          while (k < cur.length && !hasBlockCommentInGap(source, prevEnd, cur[k]!.start)) {
            if (!isIdentLeaf(cur[k]!)) break;
            prevEnd = cur[k]!.end;
            k++;
            while (k + 1 < cur.length && (cur[k]!.text === "::" || cur[k]!.text === ".") && isIdentLeaf(cur[k + 1]!)) {
              prevEnd = cur[k + 1]!.end;
              k += 2;
            }
            if (cur[k]?.text === "," && !hasBlockCommentInGap(source, prevEnd, cur[k]!.start)) {
              prevEnd = cur[k]!.end;
              k++;
            } else {
              break;
            }
          }
        }
        if (
          !hasBlockCommentInGap(source, prevEnd, cur[k]?.start ?? source.length) &&
          cur[k]?.text.toLowerCase() === "locale" &&
          cur[k + 1]?.text.startsWith('"')
        ) {
          prevEnd = cur[k + 1]!.end;
          k += 2;
        }
        if (
          !hasBlockCommentInGap(source, prevEnd, cur[k]?.start ?? source.length) &&
          (cur[k]?.text.startsWith('"') || cur[k]?.text.startsWith("/*"))
        ) {
          prevEnd = cur[k]!.end;
          k++;
        }
      }
      if (cur[k]?.text.startsWith("/*")) k++;
      if (cur[k]?.text === ";") k++;
      cur = cur.slice(k);
      continue;
    }

    if (head === "rep" || (head === "language" && cur[1]?.text.startsWith('"'))) {
      let k = 0;
      let prevEnd = cur[0]!.start;
      if (cur[k]?.text.toLowerCase() === "rep") {
        prevEnd = cur[k]!.end;
        k++;
        if (cur[k]?.text === "<" && cur[k + 2]?.text === ">") {
          prevEnd = cur[k + 2]!.end;
          k += 3;
        }
        if (cur[k] && isIdentLeaf(cur[k]!) && cur[k]!.text.toLowerCase() !== "language") {
          prevEnd = cur[k]!.end;
          k++;
        }
      }
      if (cur[k]?.text.toLowerCase() === "language") {
        prevEnd = cur[k]!.end;
        k++;
        if (cur[k]?.text.startsWith('"')) {
          prevEnd = cur[k]!.end;
          k++;
        }
        if (
          !hasBlockCommentInGap(source, prevEnd, cur[k]?.start ?? source.length) &&
          (cur[k]?.text.startsWith('"') || cur[k]?.text.startsWith("/*"))
        ) {
          prevEnd = cur[k]!.end;
          k++;
        }
      }
      if (k > 0) {
        if (cur[k]?.text.startsWith("/*")) k++;
        if (cur[k]?.text === ";") k++;
        cur = cur.slice(k);
        continue;
      }
    }

    break;
  }
  return cur;
}

/**
 * Unwraps outer constraint blocks (`require constraint Name { ... }`) using WASM GLR CST leaves,
 * dropping declaration/documentation items and joining multiple statements with `and`.
 */
export function unwrapSysmlConstraintBodyCst(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) return "";

  const lowerTrimmed = trimmed.toLowerCase();
  const hasOuterConstraintSyntax =
    trimmed.startsWith("{") ||
    lowerTrimmed.startsWith("require ") ||
    lowerTrimmed.startsWith("assert ") ||
    lowerTrimmed.startsWith("assume ") ||
    lowerTrimmed.startsWith("constraint ") ||
    lowerTrimmed.startsWith("constraint{");

  const parseInput = hasOuterConstraintSyntax ? trimmed : `constraint {\n${trimmed}\n}`;
  const root = parseSysmlSource(parseInput);
  if (!root) return trimmed;

  const leaves = collectCstLeaves(root);
  let innerStart = 0;
  let innerEnd = leaves.length;

  // Find matching outermost `{ ... }` brace pair if the block starts with `{` or a constraint header
  const firstBrace = leaves.findIndex((l) => l.text === "{");
  let lastBrace = -1;
  for (let k = leaves.length - 1; k >= 0; k--) {
    if (leaves[k]!.text === "}") {
      lastBrace = k;
      break;
    }
  }
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    innerStart = firstBrace + 1;
    innerEnd = lastBrace;
  }

  // Split inner leaves at `;` at brace/paren depth 0
  const statements: CstLeaf[][] = [];
  let cur: CstLeaf[] = [];
  let parenDepth = 0;
  let braceDepth = 0;
  for (let i = innerStart; i < innerEnd; i++) {
    const lf = leaves[i]!;
    if (lf.text === "(") parenDepth++;
    else if (lf.text === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (lf.text === "{") braceDepth++;
    else if (lf.text === "}") braceDepth = Math.max(0, braceDepth - 1);

    if (lf.text === ";" && parenDepth === 0 && braceDepth === 0) {
      if (cur.length > 0) {
        statements.push(cur);
        cur = [];
      }
      continue;
    }
    cur.push(lf);
  }
  if (cur.length > 0) {
    statements.push(cur);
  }

  const exprParts: string[] = [];
  let skippedAny = false;
  for (const stmt of statements) {
    let slice: readonly CstLeaf[] = skipLeadingAnnotatingLeaves(stmt, parseInput);
    if (slice.length < stmt.length) skippedAny = true;
    while (slice.length > 0) {
      const fw = slice[0]!.text.toLowerCase();
      if (DECL_START_KEYWORDS.has(fw)) {
        skippedAny = true;
        slice = [];
        break;
      }
      break;
    }
    if (slice.length === 0) continue;

    // Strip nested `(require | assert | assume)? constraint Name? { ... }` wrapper inside a statement
    const firstWord = slice[0]?.text.toLowerCase() ?? "";
    const isPrefixedConstraint =
      (CONSTRAINT_HEADER_PREFIXES.has(firstWord) && slice[1]?.text.toLowerCase() === "constraint") ||
      firstWord === "constraint";
    if (isPrefixedConstraint) {
      const sb = slice.findIndex((l) => l.text === "{");
      if (sb !== -1) {
        const eb = slice[slice.length - 1]?.text === "}" ? slice.length - 1 : slice.length;
        slice = slice.slice(sb + 1, eb);
      } else {
        slice = slice.slice(firstWord === "constraint" ? 1 : 2);
      }
      slice = skipLeadingAnnotatingLeaves(slice, parseInput);
    }

    if (slice.length === 0) continue;
    const spanStart = slice[0]!.start;
    const spanEnd = slice[slice.length - 1]!.end;
    const stmtText = parseInput.slice(spanStart, spanEnd).trim();
    if (stmtText) exprParts.push(stmtText);
  }

  if (exprParts.length === 0) {
    if (skippedAny) return "";
    if (innerEnd > innerStart) {
      const s = leaves[innerStart]!.start;
      const e = leaves[innerEnd - 1]!.end;
      let fallback = parseInput.slice(s, e).trim();
      while (fallback.endsWith(";")) fallback = fallback.slice(0, -1).trimEnd();
      return fallback.trim();
    }
    return trimmed;
  }

  if (exprParts.length === 1) return exprParts[0]!;
  return exprParts.map((p) => `(${p})`).join(" and ");
}

/**
 * Returns the unqualified last identifier segment from a SysML2 CST type/name node or qualified string.
 */
export function extractLastNameSegment(nodeOrText: SysmlCstNode | string | null | undefined): string {
  if (!nodeOrText) return "";
  if (typeof nodeOrText !== "string") {
    const qn = findFirstDescendant(nodeOrText, "QualifiedName") ?? nodeOrText;
    const nameNodes = findCstDescendants(qn, "Name");
    if (nameNodes.length > 0) {
      return nameNodes[nameNodes.length - 1]!.text.trim();
    }
    return extractLastNameSegment(nodeOrText.text);
  }
  const s = nodeOrText.trim();
  const idx = s.lastIndexOf("::");
  return idx !== -1 ? s.slice(idx + 2).trim() : s;
}

/**
 * Returns true when `text` is a single SysML2 identifier leaf (standard identifier with optional Unicode superscripts, or `'...'` unrestricted name).
 */
export function isSysmlIdentLeaf(text: string | undefined): text is string {
  if (!text || text.length === 0) return false;
  if (text.length > 2 && text.startsWith("'") && text.endsWith("'")) {
    return true;
  }
  if (!isIdentStartCode(text.charCodeAt(0))) return false;
  for (let i = 1; i < text.length; i++) {
    if (!isIdentPartCode(text.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

/**
 * Returns true when `text` consists exclusively of ASCII digits `[0-9]+`.
 */
export function isDigitsOnly(text: string | undefined): text is string {
  if (!text || text.length === 0) return false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/**
 * Given `leaves[openIdx]?.text === "{"`, returns the index of the matching `"}"` leaf,
 * or `leaves.length - 1` if unbalanced.
 */
export function findMatchingBraceLeaf(leaves: readonly CstLeaf[], openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < leaves.length; i++) {
    const t = leaves[i]!.text;
    if (t === "{") depth++;
    else if (t === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return leaves.length - 1;
}

function isExpLeaf(text: string | undefined): text is string {
  if (!text || text.length < 3) return false;
  let i = 0;
  while (i < text.length && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) i++;
  if (i === 0 || i >= text.length) return false;
  if (text[i] !== "e" && text[i] !== "E") return false;
  i++;
  if (text[i] === "+" || text[i] === "-") i++;
  if (i >= text.length) return false;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c < 48 || c > 57) return false;
    i++;
  }
  return true;
}

/**
 * Reads a signed numeric literal starting at `leaves[idx]` using WASM CST leaves,
 * assembling `DECIMAL_VALUE "." DECIMAL_VALUE | EXP_VALUE` split across `RealValue` leaves.
 */
export function parseSignedNumberFromLeaves(
  leaves: readonly CstLeaf[],
  idx: number,
): { value: number; nextIdx: number } | null {
  let j = idx;
  if (j >= leaves.length) return null;
  let negative = false;
  if (leaves[j]!.text === "-" || leaves[j]!.text === "+") {
    negative = leaves[j]!.text === "-";
    j++;
  }
  const first = leaves[j]?.text;
  if (!first) return null;

  let raw: string;
  let nextIdx: number;
  if (first === ".") {
    const frac = leaves[j + 1]?.text;
    if (!isDigitsOnly(frac) && !isExpLeaf(frac)) return null;
    raw = "." + frac;
    nextIdx = j + 2;
  } else if (isDigitsOnly(first)) {
    raw = first;
    nextIdx = j + 1;
    if (leaves[nextIdx]?.text === ".") {
      const frac = leaves[nextIdx + 1]?.text;
      if (isDigitsOnly(frac) || isExpLeaf(frac)) {
        raw += "." + frac;
        nextIdx += 2;
      } else {
        raw += ".";
        nextIdx += 1;
      }
    }
  } else if (isExpLeaf(first)) {
    raw = first;
    nextIdx = j + 1;
  } else {
    return null;
  }

  const num = Number((negative ? "-" : "") + raw);
  return Number.isFinite(num) ? { value: num, nextIdx } : null;
}

/**
 * Reads a dotted or qualified identifier chain (`<ident> (( "." | "::" ) <ident>)*`) starting at `leaves[idx]`.
 */
export function readDottedChainFromLeaves(
  leaves: readonly CstLeaf[],
  idx: number,
): { text: string; nextIdx: number } | null {
  const first = leaves[idx];
  if (!first || !isSysmlIdentLeaf(first.text)) return null;
  let text = first.text;
  let j = idx + 1;
  while (j + 1 < leaves.length) {
    const sep = leaves[j]!.text;
    const nxt = leaves[j + 1]!.text;
    if ((sep === "." || sep === "::") && isSysmlIdentLeaf(nxt)) {
      text += sep + nxt;
      j += 2;
    } else {
      break;
    }
  }
  return { text, nextIdx: j };
}

/**
 * Returns true when `text` is a non-empty dotted identifier (`[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*`).
 */
export function isDottedIdentText(text: string): boolean {
  if (!text) return false;
  const parts = text.split(".");
  if (!isSysmlIdentLeaf(parts[0])) return false;
  for (let p = 1; p < parts.length; p++) {
    const seg = parts[p];
    if (!seg) return false;
    if (seg.length > 2 && seg.startsWith("'") && seg.endsWith("'")) continue;
    for (let i = 0; i < seg.length; i++) {
      if (!isIdentPartCode(seg.charCodeAt(i))) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Returns true when `text` matches an unsigned numeric literal (`[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?`).
 */
export function isUnsignedNumberText(text: string): boolean {
  if (!text) return false;
  let i = 0;
  let digits = 0;
  while (i < text.length && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) {
    i++;
    digits++;
  }
  if (digits === 0) return false;
  if (i < text.length && text[i] === ".") {
    i++;
    let fracDigits = 0;
    while (i < text.length && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) {
      i++;
      fracDigits++;
    }
    if (fracDigits === 0) return false;
  }
  if (i < text.length && (text[i] === "e" || text[i] === "E")) {
    i++;
    if (i < text.length && (text[i] === "+" || text[i] === "-")) i++;
    let expDigits = 0;
    while (i < text.length && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) {
      i++;
      expDigits++;
    }
    if (expDigits === 0) return false;
  }
  return i === text.length;
}

/**
 * Strips any leading characters in `chars` from `raw` and trims outer whitespace.
 */
export function stripLeadingChars(raw: string | undefined, chars: string): string {
  if (!raw) return "";
  let i = 0;
  while (i < raw.length && chars.includes(raw[i]!)) i++;
  return raw.slice(i).trim();
}

/**
 * Trims surrounding whitespace and a trailing `;` from a CST text fragment.
 */
export function trimTrailingSemicolon(raw: string): string {
  const s = raw.trim();
  return s.endsWith(";") ? s.slice(0, -1).trim() : s;
}

/**
 * Returns CST leaves whose source offsets lie completely within `[startOffset, endOffset]`.
 */
export function sliceLeavesInRange(leaves: readonly CstLeaf[], startOffset: number, endOffset: number): CstLeaf[] {
  const out: CstLeaf[] = [];
  for (const leaf of leaves) {
    if (leaf.start >= startOffset && leaf.end <= endOffset) {
      out.push(leaf);
    } else if (leaf.start > endOffset) {
      break;
    }
  }
  return out;
}

/**
 * Extracts and trims source text strictly between `openLeaf.end` and `closeLeaf.start`.
 */
export function sliceBetweenLeaves(source: string, openLeaf: CstLeaf, closeLeaf: CstLeaf): string {
  if (openLeaf.end < 0 || closeLeaf.start < openLeaf.end || closeLeaf.start > source.length) {
    return "";
  }
  return source.slice(openLeaf.end, closeLeaf.start).trim();
}

/**
 * Returns true if the last CST leaf ending at or before `offset` matches `keyword`.
 */
export function hasImmediateLeadingKeyword(leaves: readonly CstLeaf[], offset: number, keyword: string): boolean {
  let prev: CstLeaf | undefined;
  for (const leaf of leaves) {
    if (leaf.end <= offset) prev = leaf;
    else break;
  }
  return prev?.text === keyword && offset - prev.end <= 30;
}

/**
 * Strips trailing `::*` or `::**` wildcard suffixes from a qualified SysML2 import path.
 */
export function stripNamespaceWildcard(pathText: string): string {
  let end = pathText.length;
  while (end > 0 && pathText[end - 1] === "*") end--;
  if (end < pathText.length && end >= 2 && pathText.slice(end - 2, end) === "::") {
    return pathText.slice(0, end - 2);
  }
  return pathText;
}

/**
 * Trims surrounding whitespace and removes a single leading conjugation `~` prefix if present.
 */
export function stripLeadingTilde(raw: string): string {
  const s = raw.trim();
  return s.startsWith("~") ? s.slice(1).trim() : s;
}

/**
 * Strips one matching or unpaired surrounding single/double quote character from `raw`.
 */
export function stripSurroundingQuotes(raw: string): string {
  let s = raw;
  if (s.startsWith('"') || s.startsWith("'")) s = s.slice(1);
  if (s.endsWith('"') || s.endsWith("'")) s = s.slice(0, -1);
  return s;
}

/**
 * Returns true if `text` is an optional leading `-` followed by an unsigned numeric literal.
 */
export function isSignedNumberText(text: string): boolean {
  const unsigned = text.startsWith("-") ? text.slice(1) : text;
  return isUnsignedNumberText(unsigned);
}

/**
 * Splits `source` into lines handling both LF and CRLF line endings.
 */
export function splitLinesCrLf(source: string): string[] {
  const rawLines = source.split("\n");
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!;
    if (line.endsWith("\r")) {
      rawLines[i] = line.slice(0, -1);
    }
  }
  return rawLines;
}

/**
 * Trims any trailing characters belonging to `chars` from `raw`.
 */
export function trimTrailingChars(raw: string, chars: string): string {
  let end = raw.length;
  while (end > 0 && chars.includes(raw[end - 1]!)) {
    end--;
  }
  return raw.slice(0, end);
}

/**
 * Finds the index of the matching closing delimiter leaf for `leaves[openIdx]`.
 * Returns `-1` when unbalanced or `openIdx` is not `openTok`.
 */
export function findMatchingDelimiterLeaf(
  leaves: readonly CstLeaf[],
  openIdx: number,
  openTok: string,
  closeTok: string,
): number {
  if (openIdx < 0 || openIdx >= leaves.length || leaves[openIdx]!.text !== openTok) {
    return -1;
  }
  let depth = 0;
  for (let i = openIdx; i < leaves.length; i++) {
    const tok = leaves[i]!.text;
    if (tok === openTok) depth++;
    else if (tok === closeTok) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Converts a 0-based byte/character offset in `source` into 0-based `{ line, character }`.
 */
export function offsetToLineColumn(source: string, offset: number): { line: number; character: number } {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: clamped - lineStart };
}

/**
 * Locates the first `doc /* ... * /` comment within `text` using CST `"doc"` keyword leaves.
 * Falls back gracefully when parsing a partial block slice.
 */
export function extractDocCommentSpan(
  text: string,
  leaves?: readonly CstLeaf[],
): { commentBodyStart: number; commentBodyEnd: number; text: string } | null {
  const docLeaves = leaves ?? collectCstLeaves(parseSysmlSource(text));
  for (let idx = 0; idx < docLeaves.length; idx++) {
    const leaf = docLeaves[idx]!;
    if (leaf.text !== "doc") continue;
    let pos = leaf.end;
    let lookIdx = idx + 1;
    while (pos < text.length) {
      while (
        pos < text.length &&
        (text[pos] === " " || text[pos] === "\t" || text[pos] === "\n" || text[pos] === "\r")
      ) {
        pos++;
      }
      if (text.startsWith("/*", pos)) {
        const bodyStart = pos + 2;
        const bodyEnd = findMatchingBlockCommentEnd(text, pos);
        if (bodyEnd !== -1) {
          return {
            commentBodyStart: bodyStart,
            commentBodyEnd: bodyEnd,
            text: text.slice(bodyStart, bodyEnd).trim(),
          };
        }
        break;
      }
      // Advance past optional identification/locale leaves in `doc Name locale "en" /* ... */`
      const nextLeaf = docLeaves[lookIdx];
      if (nextLeaf && nextLeaf.start === pos && nextLeaf.text !== ";" && nextLeaf.text !== "}") {
        pos = nextLeaf.end;
        lookIdx++;
        continue;
      }
      break;
    }
  }
  return null;
}
