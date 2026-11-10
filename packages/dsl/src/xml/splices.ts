// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AttributeSpan, ElementSpan, Splice, XmlElement } from "./types.js";

export function encodeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

export function applySplices(source: string, splices: Splice[]): string {
  const sorted = [...splices].sort((a, b) => b.start - a.start);
  let out = source;
  for (const s of sorted) out = out.slice(0, s.start) + s.text + out.slice(s.end);
  return out;
}

/** Span-based attribute setter: updates existing attribute value or inserts new attribute without allocating AST nodes. */
export function setAttributeSpanSplice(
  source: string,
  element: ElementSpan,
  name: string,
  value: string,
  existingAttrSpan?: AttributeSpan | null
): Splice {
  if (existingAttrSpan) {
    return { start: existingAttrSpan.valueStart, end: existingAttrSpan.valueEnd, text: encodeAttr(value) };
  }
  if (element.attributes && element.attributes.length > 0) {
    const attr = element.attributes.find((a) => a.name === name);
    if (attr) return { start: attr.valueStart, end: attr.valueEnd, text: encodeAttr(value) };
    const last = element.attributes[element.attributes.length - 1]!;
    const at = last.end;
    const sep = source.slice(last.start - 1, last.start).match(/\s/) ? source.slice(last.start - 1, last.start) : " ";
    return { start: at, end: at, text: `${sep}${name}="${encodeAttr(value)}"` };
  }

  const openEnd = element.openEnd ?? element.end;
  const openTagSlice = source.slice(element.start, openEnd);
  const nameMatch = /^<([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(openTagSlice);
  const tagLen = nameMatch ? nameMatch[0].length : 1;
  const at = element.start + tagLen;
  return { start: at, end: at, text: ` ${name}="${encodeAttr(value)}"` };
}

export function setAttributeSplice(el: XmlElement, name: string, value: string, source: string): Splice {
  return setAttributeSpanSplice(source, el, name, value);
}

/** Removes an element span together with its leading indentation and trailing line break. */
export function removeElementSpanSplice(source: string, span: { start: number; end: number }): Splice {
  let start = span.start;
  while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
  let end = span.end;
  if (source[end] === "\r") end++;
  if (source[end] === "\r") end++;
  if (source[end] === "\n") end++;
  return { start, end, text: "" };
}

/** Removes an element together with its leading indentation and trailing line break. */
export function removeElementSplice(el: XmlElement, source: string): Splice {
  return removeElementSpanSplice(source, el);
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

/** Replaces the inner text content of a non-self-closing XML element. */
export function setElementTextSplice(el: XmlElement, newText: string): Splice {
  const encoded = newText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    start: el.openEnd,
    end: el.closeStart,
    text: encoded,
  };
}

/** CST node convenience for setting an attribute */
export function setAttributeCstSplice(
  node: { element: XmlElement; source: string },
  name: string,
  value: string
): Splice {
  return setAttributeSplice(node.element, name, value, node.source);
}

/** CST node convenience for removing an element */
export function removeElementCstSplice(node: { element: XmlElement; source: string }): Splice {
  return removeElementSplice(node.element, node.source);
}

/** CST node convenience for appending a child */
export function appendChildCstSplice(
  parent: { element: XmlElement; source: string },
  childXml: string
): Splice {
  return appendChildSplice(parent.element, childXml, parent.source);
}
