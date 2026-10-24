// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Splice, XmlElement } from "./types.js";

export function encodeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
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
