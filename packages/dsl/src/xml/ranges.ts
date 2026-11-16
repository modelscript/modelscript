// SPDX-License-Identifier: AGPL-3.0-or-later

import type { XmlAttribute, XmlElement } from "./types.js";

function xmlLocalName(name: string): string {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

/**
 * Find an XML attribute on `el` by case-insensitive local name or full name.
 */
export function getXmlAttr(el: XmlElement, attrName: string): XmlAttribute | undefined {
  const target = attrName.toLowerCase();
  return el.attributes.find((a) => xmlLocalName(a.name).toLowerCase() === target || a.name.toLowerCase() === target);
}

/**
 * Return the `[valueStart, valueEnd]` byte/char span (inside quotes) for an attribute,
 * or `undefined` if the attribute is not present.
 */
export function getXmlAttrValueSpan(el: XmlElement, attrName: string): { start: number; end: number } | undefined {
  const attr = getXmlAttr(el, attrName);
  if (!attr) return undefined;
  return { start: attr.valueStart, end: attr.valueEnd };
}

/**
 * Return the trimmed text-content span `[start, end]` between `openEnd` and `closeStart`,
 * falling back to the open tag span for self-closing or empty elements.
 */
export function getXmlTextContentSpan(el: XmlElement, sourceText: string): { start: number; end: number } {
  if (el.selfClosing || el.closeStart <= el.openEnd) {
    return { start: el.start, end: el.openEnd > el.start ? el.openEnd : el.end };
  }
  let start = el.openEnd;
  let end = el.closeStart;
  while (start < end && /\s/.test(sourceText[start]!)) start++;
  while (end > start && /\s/.test(sourceText[end - 1]!)) end--;
  if (start >= end) {
    return { start: el.openEnd, end: el.closeStart };
  }
  return { start, end };
}

/**
 * Return the opening-tag span `[start, openEnd]` of an XML element,
 * useful when a required attribute is missing on an element.
 */
export function getXmlOpenTagSpan(el: XmlElement): { start: number; end: number } {
  return { start: el.start, end: el.openEnd > el.start ? el.openEnd : el.end };
}
