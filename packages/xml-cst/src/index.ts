// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParserSync, type SyntaxNode } from "../src-gen/bindings.js";

export interface XmlAttribute {
  name: string;
  /** Decoded value (no quotes, entities decoded). */
  value: string;
  /** Range of the whole `name="value"` text. */
  start: number;
  end: number;
  /** Range of the value text between the quotes. */
  valueStart: number;
  valueEnd: number;
  quote: string;
}

export interface XmlElement {
  name: string;
  /** Whole element, from `<` to the end of the closing tag. */
  start: number;
  end: number;
  /** End offset of the open tag (after `>` or `/>`). */
  openEnd: number;
  /** Start of the closing tag; equals `end` for self-closing elements. */
  closeStart: number;
  selfClosing: boolean;
  attributes: XmlAttribute[];
  children: XmlElement[];
  /** Raw CDATA payloads (without the CDATA delimiters), in document order. */
  cdata: { start: number; end: number; text: string }[];
  /** Decoded plain character data (trimmed), concatenated. */
  text: string;
  parent: XmlElement | null;
}

export interface XmlDocument {
  source: string;
  root: XmlElement | null;
  /** Syntax-error ranges; empty when the document is well formed. */
  errors: { start: number; end: number }[];
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    switch (e) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
    }
    return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

export function encodeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

type Parser = ReturnType<typeof createWasmParserSync>["parser"];
let cached: Parser | null = null;

/** Initializes the shared parser from a `parser.wasm` path or bytes. */
export function initXmlParser(wasm: string | Uint8Array): void {
  cached = createWasmParserSync(wasm).parser;
}

/** Node-only convenience: locates the packaged `parser.wasm` and initializes once. */
export function ensureXmlParser(): void {
  if (cached) return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../dist/parser.wasm", "../parser.wasm"]) {
    const p = path.resolve(here, rel);
    if (existsSync(p)) {
      initXmlParser(p);
      return;
    }
  }
  throw new Error("xml-cst: parser.wasm not found; run `npm run build --workspace=@modelscript/xml-cst`");
}

function collectErrors(n: SyntaxNode, out: { start: number; end: number }[]): void {
  if (n.type === "ERROR" || n.isMissing()) {
    out.push({ start: n.startOffset, end: n.endOffset });
    return;
  }
  if (!n.hasError()) return;
  for (const c of n.children) collectErrors(c, out);
}

function convert(n: SyntaxNode, source: string, parent: XmlElement | null): XmlElement {
  const openNode = n.childForFieldName("open")!;
  const closeNode = n.childForFieldName("endName");
  const openText = openNode.text;
  const nameMatch = /^<([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(openText)!;
  const el: XmlElement = {
    name: nameMatch[1]!,
    start: n.startOffset,
    end: n.endOffset,
    openEnd: openNode.endOffset,
    closeStart: closeNode && closeNode.type === "CloseTag" ? closeNode.startOffset : n.endOffset,
    selfClosing: openNode.type === "EmptyTag",
    attributes: [],
    children: [],
    cdata: [],
    text: "",
    parent,
  };
  const attrRe = /([A-Za-z_:][A-Za-z0-9_.:-]*)[ \t\r\n]*=[ \t\r\n]*("([^"]*)"|'([^']*)')/g;
  attrRe.lastIndex = nameMatch[0].length;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(openText))) {
    const base = openNode.startOffset + m.index;
    const raw = m[3] ?? m[4] ?? "";
    const valueStart = base + m[0].length - raw.length - 1;
    el.attributes.push({
      name: m[1]!,
      value: decodeEntities(raw),
      start: base,
      end: base + m[0].length,
      valueStart,
      valueEnd: valueStart + raw.length,
      quote: m[2]![0]!,
    });
  }
  for (const c of n.childrenForFieldName("children")) {
    if (c.type === "CData") {
      el.cdata.push({
        start: c.startOffset + 9,
        end: c.endOffset - 3,
        text: source.slice(c.startOffset + 9, c.endOffset - 3),
      });
    } else if (c.type === "Text") {
      el.text += decodeEntities(c.text.trim());
    } else if (c.type === "Element") {
      el.children.push(convert(c, source, el));
    }
  }
  return el;
}

export function parseXml(source: string): XmlDocument {
  if (!cached) throw new Error("xml-cst parser not initialized; call initXmlParser(wasmPath) first");
  const tree = cached.parse(source);
  if (!tree) return { source, root: null, errors: [{ start: 0, end: source.length }] };
  const errors: { start: number; end: number }[] = [];
  collectErrors(tree.rootNode, errors);
  const rootNode = tree.rootNode.childForFieldName("root");
  return { source, root: rootNode ? convert(rootNode, source, null) : null, errors };
}

// ---- offset-exact edit helpers (return new source text; minimal splices) ----

export interface Splice {
  start: number;
  end: number;
  text: string;
}

export function applySplices(source: string, splices: Splice[]): string {
  const sorted = [...splices].sort((a, b) => b.start - a.start);
  let out = source;
  for (const s of sorted) out = out.slice(0, s.start) + s.text + out.slice(s.end);
  return out;
}

export function setAttributeSplice(el: XmlElement, name: string, value: string, source: string): Splice {
  const attr = el.attributes.find((a) => a.name === name);
  if (attr) return { start: attr.valueStart, end: attr.valueEnd, text: encodeAttr(value) };
  const last = el.attributes[el.attributes.length - 1];
  const at = last ? last.end : el.start + 1 + el.name.length;
  const sep =
    last && source.slice(last.start - 1, last.start).match(/\s/) ? source.slice(last.start - 1, last.start) : " ";
  return { start: at, end: at, text: `${sep}${name}="${encodeAttr(value)}"` };
}

/** Removes an element together with its leading indentation and trailing line break. */
export function removeElementSplice(el: XmlElement, source: string): Splice {
  let start = el.start;
  while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
  let end = el.end;
  if (source[end] === "\r") end++;
  if (source[end] === "\r") end++;
  if (source[end] === "\n") end++;
  return { start, end, text: "" };
}

/** Inserts element text as the last child, matching the parent's child indentation and EOL. */
export function appendChildSplice(parent: XmlElement, childXml: string, source: string): Splice {
  const eol = /\r\r\n/.test(source) ? "\r\r\n" : /\r\n/.test(source) ? "\r\n" : "\n";
  const first = parent.children[0];
  let indent = "  ";
  if (first) {
    let s = first.start;
    while (s > 0 && (source[s - 1] === " " || source[s - 1] === "\t")) s--;
    indent = source.slice(s, first.start);
  }
  let at = parent.closeStart;
  while (at > parent.openEnd && (source[at - 1] === " " || source[at - 1] === "\t")) at--;
  return { start: at, end: at, text: `${indent}${childXml}${eol}` };
}
