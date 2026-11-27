// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "../../utils/cst-facade.js";
import { decodeEntities } from "../../xml/parser.js";
import type { XmlElement } from "../../xml/types.js";
import {
  getNodeChildrenSafe,
  isNodeError,
  isNodeHealthy,
  isNodeMissing,
  nodeEndOffset,
  nodeStartOffset,
  walkHealthyCst,
} from "../session.js";
import { CstTransaction } from "../transaction.js";

/**
 * Attribute view extracted directly from a CST `Attribute` node (or streaming `XmlCstNode`).
 */
export interface CstXmlAttribute {
  name: string;
  value: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  valueStartOffset: number;
  valueEndOffset: number;
  attrNode?: SyntaxNode | undefined;
  valueNode?: SyntaxNode | undefined;
}

export function encodeXmlAttrValue(value: string, quote = '"'): string {
  let out = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (quote === "'") {
    out = out.replace(/'/g, "&apos;");
  } else {
    out = out.replace(/"/g, "&quot;");
  }
  return out;
}

export function encodeXmlTextContent(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getEmbeddedXmlElement(node: SyntaxNode): XmlElement | null {
  const raw = node as unknown as { element?: XmlElement };
  return raw.element && typeof raw.element.name === "string" ? raw.element : null;
}

function isXmlElementNode(node: SyntaxNode): boolean {
  if (!isNodeHealthy(node)) return false;
  if (node.type === "Element") return true;
  return getEmbeddedXmlElement(node) !== null;
}

function getOpenTagNode(elNode: SyntaxNode): SyntaxNode | null {
  if (typeof elNode.childForFieldName === "function") {
    const open = elNode.childForFieldName("open");
    if (open) return open;
  }
  for (const ch of getNodeChildrenSafe(elNode)) {
    if (ch.type === "StartTag" || ch.type === "EmptyTag") return ch;
  }
  return null;
}

function getCloseTagNode(elNode: SyntaxNode): SyntaxNode | null {
  if (typeof elNode.childForFieldName === "function") {
    const close = elNode.childForFieldName("endName");
    if (close && close.type === "CloseTag" && !isNodeMissing(close) && !isNodeError(close)) {
      return close;
    }
  }
  const kids = getNodeChildrenSafe(elNode);
  for (let i = kids.length - 1; i >= 0; i--) {
    const ch = kids[i]!;
    if (ch.type === "CloseTag" && !isNodeMissing(ch) && !isNodeError(ch)) return ch;
  }
  return null;
}

function getTagHeadNode(openNode: SyntaxNode): SyntaxNode {
  for (const ch of getNodeChildrenSafe(openNode)) {
    if (ch.type === "TagHead") return ch;
  }
  return openNode;
}

function findErrorAttributeMatch(
  openNode: SyntaxNode,
  source: string,
  attrName: string,
): { start: number; end: number } | null {
  const wantLower = attrName.toLowerCase();
  const stack: SyntaxNode[] = [...getNodeChildrenSafe(openNode)];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (isNodeError(cur)) {
      const start = nodeStartOffset(cur);
      const end = nodeEndOffset(cur);
      const slice = source.slice(start, end);
      const trimmed = slice.trimStart();
      if (trimmed.toLowerCase().startsWith(wantLower)) {
        const after = trimmed[wantLower.length];
        if (after === "=" || after === " " || after === "\t" || after === undefined) {
          const leadWs = slice.length - trimmed.length;
          return { start: start + leadWs, end };
        }
      }
      continue;
    }
    for (const ch of getNodeChildrenSafe(cur)) stack.push(ch);
  }
  return null;
}

/**
 * Language-agnostic, error-tolerant XML CST query & edit adapter.
 *
 * Works identically on:
 * - Native `xmlRules` v2 WASM GLR CSTs (`Element` → `StartTag`/`EmptyTag` → `TagHead` → `XmlName` + `Attribute`)
 * - Legacy `xmlRules` v1 WASM GLR CSTs
 * - Streaming `XmlCstNode` fallback trees (for `> 2 MiB` XML files or pre-WASM cold-start)
 *
 * All mutations emit surgical byte-preserving edits into a {@link CstTransaction} and never
 * touch sibling `ERROR` subtrees.
 */
export class CstXmlAdapter {
  /** Returns the XML element's tag name (or `null` if not an element node). */
  static getTagName(elNode: SyntaxNode, source?: string): string | null {
    const embedded = getEmbeddedXmlElement(elNode);
    if (embedded) return embedded.name;
    if (elNode.type !== "Element") return null;
    const open = getOpenTagNode(elNode);
    if (!open) return null;
    const head = getTagHeadNode(open);
    const nameField = typeof head.childForFieldName === "function" ? head.childForFieldName("name") : null;
    if (nameField) {
      const s = nodeStartOffset(nameField);
      const e = nodeEndOffset(nameField);
      return source ? source.slice(s, e) : nameField.text;
    }
    for (const ch of getNodeChildrenSafe(head)) {
      if (ch.type === "XmlName") {
        return source ? source.slice(nodeStartOffset(ch), nodeEndOffset(ch)) : ch.text;
      }
    }
    // Legacy v1 coarse StartTag/EmptyTag fallback
    const openText = source ? source.slice(nodeStartOffset(open), nodeEndOffset(open)) : open.text;
    const m = /^<([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(openText.trimStart());
    return m?.[1] ?? null;
  }

  /** Returns true when `elNode` is self-closing (`<Tag .../>`). */
  static isSelfClosing(elNode: SyntaxNode, source?: string): boolean {
    const embedded = getEmbeddedXmlElement(elNode);
    if (embedded) return embedded.selfClosing;
    const open = getOpenTagNode(elNode);
    if (!open) return false;
    if (open.type === "EmptyTag") return true;
    if (source) {
      const text = source.slice(nodeStartOffset(open), nodeEndOffset(open)).trimEnd();
      return text.endsWith("/>");
    }
    return false;
  }

  /** Extracts all healthy attributes of an XML element directly from its CST nodes. */
  static getAttributes(elNode: SyntaxNode, source: string): CstXmlAttribute[] {
    const embedded = getEmbeddedXmlElement(elNode);
    if (embedded) {
      return embedded.attributes.map((a) => ({
        name: a.name,
        value: a.value,
        quote: a.quote || '"',
        startOffset: a.start,
        endOffset: a.end,
        valueStartOffset: a.valueStart,
        valueEndOffset: a.valueEnd,
      }));
    }

    const open = getOpenTagNode(elNode);
    if (!open) return [];
    const head = getTagHeadNode(open);
    const out: CstXmlAttribute[] = [];
    let sawStructuredHead = false;

    const visitForAttrs = (cur: SyntaxNode): void => {
      if (isNodeError(cur) || isNodeMissing(cur)) return;
      if (cur.type === "XmlName") {
        sawStructuredHead = true;
        return;
      }
      if (cur.type === "Attribute") {
        sawStructuredHead = true;
        const aNameNode =
          (typeof cur.childForFieldName === "function" ? cur.childForFieldName("name") : null) ??
          getNodeChildrenSafe(cur).find((c) => c.type === "XmlName");
        const aValNode =
          (typeof cur.childForFieldName === "function" ? cur.childForFieldName("value") : null) ??
          getNodeChildrenSafe(cur).find((c) => c.type === "AttrValue");
        if (!aNameNode || !aValNode || isNodeError(aNameNode) || isNodeError(aValNode)) return;
        const vStart = nodeStartOffset(aValNode);
        const vEnd = nodeEndOffset(aValNode);
        const quoted = source.slice(vStart, vEnd);
        if (quoted.length < 2) return;
        const quote = quoted[0]!;
        const raw = quoted.slice(1, -1);
        out.push({
          name: source.slice(nodeStartOffset(aNameNode), nodeEndOffset(aNameNode)),
          value: decodeEntities(raw),
          quote,
          startOffset: nodeStartOffset(cur),
          endOffset: nodeEndOffset(cur),
          valueStartOffset: vStart + 1,
          valueEndOffset: vEnd - 1,
          attrNode: cur,
          valueNode: aValNode,
        });
        return;
      }
      for (const ch of getNodeChildrenSafe(cur)) visitForAttrs(ch);
    };
    visitForAttrs(head);

    if (out.length > 0 || sawStructuredHead) return out;

    // Legacy v1 coarse StartTag/EmptyTag fallback (only for un-rebuilt v1 WASM parsers)
    const openStart = nodeStartOffset(open);
    const openText = source.slice(openStart, nodeEndOffset(open));
    const nameMatch = /^<([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(openText.trimStart());
    const attrRe = /([A-Za-z_:][A-Za-z0-9_.:-]*)[ \t\r\n]*=[ \t\r\n]*("([^"]*)"|'([^']*)')/g;
    attrRe.lastIndex = nameMatch ? nameMatch[0].length : 0;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(openText))) {
      const base = openStart + m.index;
      const raw = m[3] ?? m[4] ?? "";
      const valueStart = base + m[0].length - raw.length - 1;
      out.push({
        name: m[1]!,
        value: decodeEntities(raw),
        quote: m[2]![0]!,
        startOffset: base,
        endOffset: base + m[0].length,
        valueStartOffset: valueStart,
        valueEndOffset: valueStart + raw.length,
      });
    }
    return out;
  }

  /** Looks up an attribute on `elNode` (case-insensitive by default for XML dialect resilience). */
  static getAttribute(
    elNode: SyntaxNode,
    name: string,
    source: string,
    caseInsensitive = true,
  ): CstXmlAttribute | undefined {
    const attrs = this.getAttributes(elNode, source);
    if (!caseInsensitive) return attrs.find((a) => a.name === name);
    const want = name.toLowerCase();
    return attrs.find((a) => a.name.toLowerCase() === want);
  }

  /** Returns direct healthy child XML `Element` nodes of `elNode`, skipping `ERROR` nodes cleanly. */
  static getChildElements(elNode: SyntaxNode): SyntaxNode[] {
    const out: SyntaxNode[] = [];
    const visit = (kids: readonly SyntaxNode[]): void => {
      for (const ch of kids) {
        if (!isNodeHealthy(ch)) continue;
        if (isXmlElementNode(ch)) {
          out.push(ch);
        } else if (
          ch.type !== "StartTag" &&
          ch.type !== "EmptyTag" &&
          ch.type !== "CloseTag" &&
          ch.type !== "TagHead"
        ) {
          // Descend through anonymous grammar repetition wrappers (`_(Element | CData | Text)*`)
          visit(getNodeChildrenSafe(ch));
        }
      }
    };
    visit(getNodeChildrenSafe(elNode));
    return out;
  }

  /** Finds all healthy XML elements matching `predicate` in pre-order. */
  static findElements(
    root: SyntaxNode | null | undefined,
    source: string,
    predicate: (elNode: SyntaxNode, tagName: string) => boolean,
  ): SyntaxNode[] {
    const out: SyntaxNode[] = [];
    walkHealthyCst(root, (node) => {
      if (!isXmlElementNode(node)) return;
      const tag = this.getTagName(node, source);
      if (tag && predicate(node, tag)) {
        out.push(node);
      }
    });
    return out;
  }

  /** Finds the first healthy XML element with matching tag name (optional) and attribute value. */
  static findElementByAttr(
    root: SyntaxNode | null | undefined,
    source: string,
    attrName: string,
    attrValue: string,
    tagName?: string,
  ): SyntaxNode | null {
    let found: SyntaxNode | null = null;
    const wantTag = tagName?.toLowerCase();
    walkHealthyCst(root, (node) => {
      if (found) return false;
      if (!isXmlElementNode(node)) return undefined;
      const tag = this.getTagName(node, source);
      if (!tag) return undefined;
      if (wantTag && tag.toLowerCase() !== wantTag) return undefined;
      const a = this.getAttribute(node, attrName, source);
      if (a && a.value === attrValue) {
        found = node;
        return false;
      }
      return undefined;
    });
    return found;
  }

  /**
   * Sets or inserts an XML attribute on `elNode` using CST node boundaries.
   * Preserves existing quote style (`"` or `'`) and recovers cleanly if the target attribute
   * was partially malformed inside a localized `ERROR` node.
   */
  static setAttribute(tx: CstTransaction, elNode: SyntaxNode, name: string, value: string): boolean {
    const source = tx.session.text;
    const existing = this.getAttribute(elNode, name, source, true);
    if (existing) {
      const encoded = encodeXmlAttrValue(value, existing.quote);
      tx.replaceRange(existing.valueStartOffset, existing.valueEndOffset, encoded);
      return true;
    }

    // Error-recovery: if the open tag has a malformed copy of this attribute in an ERROR node, heal it in place
    const open = getOpenTagNode(elNode);
    if (open) {
      const broken = findErrorAttributeMatch(open, source, name);
      if (broken) {
        tx.replaceRange(broken.start, broken.end, `${name}="${encodeXmlAttrValue(value, '"')}"`);
        return true;
      }
    }

    // Insert cleanly before closing `>` or `/>` of the opening tag
    const embedded = getEmbeddedXmlElement(elNode);
    let insertAt: number;
    if (embedded) {
      const openSlice = source.slice(embedded.start, embedded.openEnd);
      const closeLen = openSlice.trimEnd().endsWith("/>") ? 2 : 1;
      let pos = embedded.openEnd;
      while (pos > embedded.start && /\s/.test(source[pos - 1]!)) pos--;
      insertAt = Math.max(embedded.start, pos - closeLen);
    } else if (open) {
      const attrs = this.getAttributes(elNode, source);
      if (attrs.length > 0) {
        insertAt = attrs[attrs.length - 1]!.endOffset;
      } else {
        const openStart = nodeStartOffset(open);
        const openEnd = nodeEndOffset(open);
        const openSlice = source.slice(openStart, openEnd);
        const closeLen = openSlice.trimEnd().endsWith("/>") ? 2 : 1;
        let pos = openEnd;
        while (pos > openStart && /\s/.test(source[pos - 1]!)) pos--;
        insertAt = Math.max(openStart, pos - closeLen);
      }
    } else {
      tx.recordSkipped(`cannot locate open tag on element '${this.getTagName(elNode, source) ?? elNode.type}'`, name);
      return false;
    }

    tx.insertAt(insertAt, ` ${name}="${encodeXmlAttrValue(value, '"')}"`);
    return true;
  }

  /** Removes an attribute CST node (together with its preceding separator whitespace). */
  static removeAttribute(tx: CstTransaction, elNode: SyntaxNode, name: string): boolean {
    const source = tx.session.text;
    const existing = this.getAttribute(elNode, name, source, true);
    if (!existing) return false;
    let start = existing.startOffset;
    while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) {
      start--;
    }
    tx.deleteRange(start, existing.endOffset);
    return true;
  }

  /**
   * Appends a child XML fragment inside `parentElNode`, preserving document EOL (`\r\r\n`/`\r\n`/`\n`)
   * and sibling indentation.
   *
   * Handles:
   * 1. Normal `<Tag>...</Tag>` elements (inserts before `CloseTag`)
   * 2. Self-closing `<Tag .../>` elements (expands to `<Tag ...>\n  child\n</Tag>`)
   * 3. Error-recovered unclosed `<Tag>` elements whose `CloseTag` is `isMissing` (anchors safely after
   *    the last healthy child or `StartTag.endOffset`)
   */
  static appendChild(tx: CstTransaction, parentElNode: SyntaxNode, childXml: string): boolean {
    const source = tx.session.text;
    const eol = tx.session.eol;
    const parentTag = this.getTagName(parentElNode, source);
    if (!parentTag) {
      tx.recordSkipped("appendChild target is not a valid XML element");
      return false;
    }

    const parentIndent = tx.session.lineIndentAt(nodeStartOffset(parentElNode));
    const childElements = this.getChildElements(parentElNode);
    const childIndent =
      childElements.length > 0 ? tx.session.lineIndentAt(nodeStartOffset(childElements[0]!)) : `${parentIndent}  `;

    // Case 1: Self-closing parent `<Tag .../>` → expand into container
    if (this.isSelfClosing(parentElNode, source)) {
      const embedded = getEmbeddedXmlElement(parentElNode);
      const open = getOpenTagNode(parentElNode);
      const openEnd = embedded ? embedded.openEnd : open ? nodeEndOffset(open) : nodeEndOffset(parentElNode);
      let slashPos = openEnd;
      while (slashPos > 0 && /\s/.test(source[slashPos - 1]!)) slashPos--;
      if (source.slice(slashPos - 2, slashPos) === "/>") {
        tx.replaceRange(slashPos - 2, slashPos, `>${eol}${childIndent}${childXml}${eol}${parentIndent}</${parentTag}>`);
        return true;
      }
    }

    // Case 2: Normal element with a healthy `CloseTag`
    const embedded = getEmbeddedXmlElement(parentElNode);
    if (embedded && embedded.closeStart > embedded.openEnd && embedded.closeStart < embedded.end) {
      let at = embedded.closeStart;
      while (at > embedded.openEnd && (source[at - 1] === " " || source[at - 1] === "\t")) at--;
      const needsLeadingEol = at > 0 && source[at - 1] !== "\n";
      tx.insertAt(at, `${needsLeadingEol ? eol : ""}${childIndent}${childXml}${eol}`);
      return true;
    }

    const closeNode = getCloseTagNode(parentElNode);
    const openNode = getOpenTagNode(parentElNode);
    const openEnd = openNode ? nodeEndOffset(openNode) : nodeStartOffset(parentElNode);

    if (closeNode) {
      let at = nodeStartOffset(closeNode);
      while (at > openEnd && (source[at - 1] === " " || source[at - 1] === "\t")) at--;
      const needsLeadingEol = at > 0 && source[at - 1] !== "\n";
      tx.insertAt(at, `${needsLeadingEol ? eol : ""}${childIndent}${childXml}${eol}`);
      return true;
    }

    // Case 3: Error-recovered unclosed element (`CloseTag` missing due to syntax error elsewhere)
    const anchorOffset = childElements.length > 0 ? nodeEndOffset(childElements[childElements.length - 1]!) : openEnd;
    tx.insertAt(anchorOffset, `${eol}${childIndent}${childXml}`);
    return true;
  }

  /** Deletes an XML element together with its leading horizontal indentation and trailing line break. */
  static deleteElement(tx: CstTransaction, elNode: SyntaxNode): void {
    const source = tx.session.text;
    let start = nodeStartOffset(elNode);
    while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
    let end = nodeEndOffset(elNode);
    if (source[end] === "\r") end++;
    if (source[end] === "\r") end++;
    if (source[end] === "\n") end++;
    tx.deleteRange(start, end);
  }

  /** Extracts decoded inner text of a non-self-closing XML element directly from CST spans. */
  static getElementText(elNode: SyntaxNode, source: string): string {
    const embedded = getEmbeddedXmlElement(elNode);
    if (embedded) return embedded.text;
    const open = getOpenTagNode(elNode);
    const close = getCloseTagNode(elNode);
    if (!open || !close) return "";
    const start = nodeEndOffset(open);
    const end = nodeStartOffset(close);
    if (end <= start) return "";
    return decodeEntities(source.slice(start, end).trim());
  }

  /** Replaces an entire XML element node's span with `replacementXml`. */
  static replaceElement(tx: CstTransaction, elNode: SyntaxNode, replacementXml: string): void {
    tx.replaceRange(nodeStartOffset(elNode), nodeEndOffset(elNode), replacementXml);
  }

  /** Replaces the inner text content of a non-self-closing XML element. */
  static setElementText(tx: CstTransaction, elNode: SyntaxNode, newText: string): boolean {
    const embedded = getEmbeddedXmlElement(elNode);
    const encoded = encodeXmlTextContent(newText);
    if (embedded && !embedded.selfClosing) {
      tx.replaceRange(embedded.openEnd, embedded.closeStart, encoded);
      return true;
    }
    const open = getOpenTagNode(elNode);
    const close = getCloseTagNode(elNode);
    if (!open || !close) {
      tx.recordSkipped(
        `cannot setElementText on self-closing or unclosed element '${this.getTagName(elNode) ?? elNode.type}'`,
      );
      return false;
    }
    tx.replaceRange(nodeEndOffset(open), nodeStartOffset(close), encoded);
    return true;
  }
}
