// SPDX-License-Identifier: AGPL-3.0-or-later

import { createXmlCstTree, parseXmlSync, type XmlSyntaxError } from "@modelscript/dsl/xml";
import type { LanguagePlugin } from "../registry/LanguageRegistry.js";
import type { Parser, SyntaxNode, Tree } from "./cst-facade.js";

/** Maximum source length before routing XML documents to Option-B streaming CST fallback (2 MiB). */
export const XML_WASM_BYTE_LIMIT = 2 * 1024 * 1024;

export interface XmlFallbackTree extends Tree {
  __isXmlCstFallback?: boolean;
  __xmlErrors?: XmlSyntaxError[];
}

export interface CstNodeLike {
  id?: number;
  type: string;
  typeId?: number;
  text: string;
  isNamed?: boolean;
  isMissing?: boolean;
  hasError?: boolean;
  isError?: boolean;
  getPtr?(): number;
  startIndex?: number;
  endIndex?: number;
  startOffset?: number;
  endOffset?: number;
  startPosition?: { row: number; column: number };
  endPosition?: { row: number; column: number };
  parent?: CstNodeLike | null;
  children?: readonly CstNodeLike[];
  namedChildren?: readonly CstNodeLike[];
  childCount?: number;
  child?(index: number): CstNodeLike | null;
  childForFieldName?(name: string): CstNodeLike | null;
  childForFieldId?(id: number): CstNodeLike | null;
  descendantsOfType?(types: string | string[]): CstNodeLike[];
  walk?(): unknown;
  runtime?: { getSemanticTokens?(rootPtr: number, text: string): Uint32Array };
}

export interface CstTreeLike {
  rootNode: CstNodeLike;
  rootPtr?: number;
  sourceCode?: string;
  runtime?: { getSemanticTokens?(rootPtr: number, text: string): Uint32Array };
  getSemanticTokens?(): Uint32Array;
  delete?(): void;
}

export interface CstParserLike {
  parse(
    input: string,
    oldTree?: CstTreeLike | Tree | null,
    startIndex?: number,
    oldEndIndex?: number,
    newEndIndex?: number,
    uri?: string,
  ): CstTreeLike | Tree | null;
}

const XML_FILE_EXT_RE =
  /\.(?:xml|arxml|pscx|pslx|scd|cid|icd|ssd|ssv|ssm|ssb|iid|scl|reqif|reqifz|ssp|qif|urdf|xacro|sbml|cellml|aml|caex|xodr|xosc|osim|rdf|cim|svg|dae|opi|3mf|gtm|wml|wml2)$/i;

const MULTI_FORMAT_XML_EXT_RE = /\.(?:oscal|feb|scn|xtce|rtplan|rtstruct|rtdose|dicom-rt|igtl)$/i;

function hasXmlGrammarRules(plugin?: LanguagePlugin | null | undefined): boolean {
  const rules = plugin?.languageDef?.rules as Record<string, unknown> | undefined;
  return Boolean(rules && "Element" in rules && "StartTag" in rules && "CloseTag" in rules && "EmptyTag" in rules);
}

/**
 * Returns true when `text` exceeds {@link XML_WASM_BYTE_LIMIT} and represents an XML document
 * (via coarse `xmlRules` grammar, known XML extension, or XML declaration header).
 */
export function isLargeXmlForWasm(uri: string, text: string, plugin?: LanguagePlugin | null | undefined): boolean {
  if (text.length <= XML_WASM_BYTE_LIMIT) return false;
  if (hasXmlGrammarRules(plugin)) {
    return true;
  }
  const cleanPath = uri.split(/[?#]/, 1)[0] ?? uri;
  if (XML_FILE_EXT_RE.test(cleanPath)) return true;
  const head = text
    .slice(0, 512)
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (head.startsWith("<?xml") || /^<!DOCTYPE\b/i.test(head)) return true;
  return MULTI_FORMAT_XML_EXT_RE.test(cleanPath) && head.startsWith("<");
}

function shouldUseXmlFallback(uri: string, text: string, plugin?: LanguagePlugin | null | undefined): boolean {
  if (isLargeXmlForWasm(uri, text, plugin)) return true;
  if (plugin && !hasXmlGrammarRules(plugin)) {
    const cleanPath = (uri.split(/[?#]/, 1)[0] ?? uri).toLowerCase();
    const head = text
      .slice(0, 512)
      .replace(/^\uFEFF/, "")
      .trimStart();
    if (head.startsWith("<?xml") || /^<!DOCTYPE\b/i.test(head)) return true;
    if ((cleanPath.endsWith(".xml") || MULTI_FORMAT_XML_EXT_RE.test(cleanPath)) && head.startsWith("<")) return true;
  }
  return false;
}

/**
 * Parses an XML document using the Option-B TS streaming scanner and wraps it as an LSP CST tree.
 */
export function parseXmlFallbackTree(text: string): XmlFallbackTree {
  const xmlDoc = parseXmlSync(text);
  const tree = createXmlCstTree(xmlDoc) as XmlFallbackTree;
  tree.__isXmlCstFallback = true;
  tree.__xmlErrors = xmlDoc.errors;
  return tree;
}

/**
 * Returns true when a cached CST tree is still live inside the active WASM parser facade.
 */
export function isWasmTreeActiveInFacade(
  tree: unknown,
  facade?: { lastAstRoot?: number; getDocumentRoot?: (uriOrFileId?: string | number) => number } | null | undefined,
  uri?: string,
): boolean {
  if (!tree || (tree as XmlFallbackTree).__isXmlCstFallback) return false;
  const t = tree as { rootPtr?: number; rootNode?: { id?: number } };
  const rootPtr = t.rootPtr ?? t.rootNode?.id ?? 0;
  if (!rootPtr || !facade) return false;
  if (facade.lastAstRoot === rootPtr) return true;
  if (uri && typeof facade.getDocumentRoot === "function" && facade.getDocumentRoot(uri) === rootPtr) {
    return true;
  }
  return false;
}

/**
 * Parses `text` with `parser` unless `text` is a >2 MiB XML document (or an XML file under a non-XML
 * grammar plugin such as `.oadr.xml`), in which case it falls back to Option-B CST parsing via {@link parseXmlFallbackTree}.
 */
export function parseTreeWithXmlGuard(opts: {
  uri: string;
  text: string;
  plugin?: LanguagePlugin | null | undefined;
  parser?: CstParserLike | Parser | null | undefined;
  oldCached?: { text: string; tree: CstTreeLike | Tree | null | undefined } | null | undefined;
  onIncrementalEdit?: ((edit: ReturnType<typeof computeTreeEdit>) => void) | undefined;
}): CstTreeLike | Tree | null {
  const { uri, text, plugin, parser, oldCached, onIncrementalEdit } = opts;
  if (shouldUseXmlFallback(uri, text, plugin)) {
    if (oldCached && oldCached.text === text && (oldCached.tree as XmlFallbackTree | undefined)?.__isXmlCstFallback) {
      return oldCached.tree ?? null;
    }
    return parseXmlFallbackTree(text);
  }
  if (!parser) return null;
  const oldIsFallback = Boolean((oldCached?.tree as XmlFallbackTree | undefined)?.__isXmlCstFallback);
  const oldTree = oldCached?.tree as { delete?: unknown; rootPtr?: unknown; rootNode?: { id?: unknown } } | undefined;
  const isRealWasmTree = Boolean(
    oldTree &&
    !oldIsFallback &&
    (typeof oldTree.delete === "function" ||
      typeof oldTree.rootPtr === "number" ||
      typeof oldTree.rootNode?.id === "number"),
  );
  if (oldCached && oldCached.text !== text && isRealWasmTree) {
    const edit = computeTreeEdit(oldCached.text, text);
    onIncrementalEdit?.(edit);
    return (parser as CstParserLike).parse(
      text,
      oldCached.tree,
      edit.startIndex,
      edit.oldEndIndex,
      edit.newEndIndex,
      uri,
    );
  }
  if (oldCached && oldCached.text === text && isRealWasmTree) {
    return oldCached.tree ?? null;
  }
  return (parser as CstParserLike).parse(text, null, 0, 0, 0, uri);
}

export function isClassInstance(obj: unknown): boolean {
  return Boolean(obj && typeof obj === "object" && "classKind" in obj);
}

/**
 * Compute the position (row, column) at a given byte index in a string.
 */
export function indexToPoint(text: string, index: number): { row: number; column: number } {
  let row = 0;
  let lastNewline = -1;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") {
      row++;
      lastNewline = i;
    }
  }
  return { row, column: index - lastNewline - 1 };
}

/**
 * Compute a tree-sitter Edit by finding the common prefix and suffix between
 * old and new text. This is O(n) but practically near-instant since we stop
 * at the first/last differing character.
 */
export function computeTreeEdit(
  oldText: string,
  newText: string,
): {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: { row: number; column: number };
  oldEndPosition: { row: number; column: number };
  newEndPosition: { row: number; column: number };
} {
  // Find common prefix
  const minLen = Math.min(oldText.length, newText.length);
  let prefixLen = 0;
  while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
    prefixLen++;
  }

  // Ensure prefixLen does not split a UTF-16 surrogate pair
  if (
    prefixLen > 0 &&
    prefixLen < oldText.length &&
    oldText.charCodeAt(prefixLen - 1) >= 0xd800 &&
    oldText.charCodeAt(prefixLen - 1) <= 0xdbff &&
    oldText.charCodeAt(prefixLen) >= 0xdc00 &&
    oldText.charCodeAt(prefixLen) <= 0xdfff
  ) {
    prefixLen--;
  }

  // Find common suffix (not overlapping with prefix)
  let oldSuffix = oldText.length;
  let newSuffix = newText.length;
  while (oldSuffix > prefixLen && newSuffix > prefixLen && oldText[oldSuffix - 1] === newText[newSuffix - 1]) {
    oldSuffix--;
    newSuffix--;
  }

  // Ensure suffix boundary does not split a UTF-16 surrogate pair
  if (
    oldSuffix > 0 &&
    oldSuffix < oldText.length &&
    oldText.charCodeAt(oldSuffix - 1) >= 0xd800 &&
    oldText.charCodeAt(oldSuffix - 1) <= 0xdbff &&
    oldText.charCodeAt(oldSuffix) >= 0xdc00 &&
    oldText.charCodeAt(oldSuffix) <= 0xdfff
  ) {
    if (oldSuffix + 1 <= oldText.length && newSuffix + 1 <= newText.length) {
      oldSuffix++;
      newSuffix++;
    } else if (oldSuffix > prefixLen && newSuffix > prefixLen) {
      oldSuffix--;
      newSuffix--;
    }
  }

  return {
    startIndex: prefixLen,
    oldEndIndex: oldSuffix,
    newEndIndex: newSuffix,
    get startPosition() {
      return indexToPoint(oldText, prefixLen);
    },
    get oldEndPosition() {
      return indexToPoint(oldText, oldSuffix);
    },
    get newEndPosition() {
      return indexToPoint(newText, newSuffix);
    },
  };
}

export function nodeRange(node: SyntaxNode): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return {
    start: { line: node.startPosition.row, character: node.startPosition.column },
    end: { line: node.endPosition.row, character: node.endPosition.column },
  };
}

/**
 * Recursively find all CST nodes matching the specified type name.
 */
export function findCstNodesByType<T extends CstNodeLike = CstNodeLike>(
  root: T | CstNodeLike | null | undefined,
  typeName: string,
): T[] {
  const results: T[] = [];
  const target = (typeName || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  function walk(node: CstNodeLike | null | undefined) {
    if (!node) return;
    if ((node.type || "").toLowerCase().replace(/[^a-z0-9]/g, "") === target) {
      results.push(node as T);
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(root);
  return results;
}
