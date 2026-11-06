// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lightweight, zero-dependency XML CST node representation and recursive pull parser.
 * Designed for schematic diagram builders (PLCopen, Simulink, PSCAD) in both Node.js and browser environments.
 */

export interface MiniXmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: MiniXmlElement[];
  text: string;
}

/**
 * Safely decodes common XML character entities (&lt;, &gt;, &quot;, &apos;, &amp;).
 */
export function unescapeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Recursively parses an XML string into a lightweight MiniXmlElement CST tree.
 * Handles self-closing tags, CDATA blocks, processing instructions, and comments.
 */
export function parseMiniXml(source: string): MiniXmlElement | null {
  let pos = 0;
  const len = source.length;

  function parseAttributes(attrStr: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    let p = 0;
    while (p < attrStr.length) {
      while (p < attrStr.length && /\s/.test(attrStr[p]!)) p++;
      if (p >= attrStr.length) break;
      const eqIdx = attrStr.indexOf("=", p);
      if (eqIdx === -1) break;
      const key = attrStr.slice(p, eqIdx).trim();
      p = eqIdx + 1;
      while (p < attrStr.length && /\s/.test(attrStr[p]!)) p++;
      if (p >= attrStr.length) break;
      const quote = attrStr[p];
      if (quote === '"' || quote === "'") {
        p++;
        const endQuote = attrStr.indexOf(quote, p);
        if (endQuote === -1) {
          attrs[key] = attrStr.slice(p);
          break;
        }
        attrs[key] = attrStr.slice(p, endQuote);
        p = endQuote + 1;
      } else {
        let endP = p;
        while (endP < attrStr.length && !/\s/.test(attrStr[endP]!)) endP++;
        attrs[key] = attrStr.slice(p, endP);
        p = endP;
      }
    }
    return attrs;
  }

  function parseNode(): MiniXmlElement | null {
    while (pos < len) {
      const openTag = source.indexOf("<", pos);
      if (openTag === -1) return null;
      pos = openTag + 1;

      if (source.startsWith("!--", pos)) {
        const commentEnd = source.indexOf("-->", pos);
        pos = commentEnd === -1 ? len : commentEnd + 3;
        continue;
      }
      if (source.startsWith("?", pos)) {
        const piEnd = source.indexOf("?>", pos);
        pos = piEnd === -1 ? len : piEnd + 2;
        continue;
      }
      if (source.startsWith("/", pos)) {
        const closeEnd = source.indexOf(">", pos);
        pos = closeEnd === -1 ? len : closeEnd + 1;
        return null;
      }

      const tagEnd = source.indexOf(">", pos);
      if (tagEnd === -1) return null;
      const tagContent = source.slice(pos, tagEnd);
      pos = tagEnd + 1;

      const isSelfClosing = tagContent.endsWith("/");
      const cleanContent = isSelfClosing ? tagContent.slice(0, -1).trim() : tagContent.trim();
      const spaceIdx = cleanContent.search(/\s/);
      const fullTagName = spaceIdx === -1 ? cleanContent : cleanContent.slice(0, spaceIdx);
      const rawAttrs = spaceIdx === -1 ? "" : cleanContent.slice(spaceIdx);
      const tag = fullTagName.includes(":") ? fullTagName.slice(fullTagName.indexOf(":") + 1) : fullTagName;
      const attrs = parseAttributes(rawAttrs);

      const node: MiniXmlElement = { tag, attrs, children: [], text: "" };
      if (isSelfClosing) return node;

      const closeMarker = `</${fullTagName}>`;
      const shortCloseMarker = `</${tag}>`;
      while (pos < len) {
        if (source.startsWith("<![CDATA[", pos)) {
          const cdataEnd = source.indexOf("]]>", pos);
          node.text += cdataEnd === -1 ? source.slice(pos + 9) : source.slice(pos + 9, cdataEnd);
          pos = cdataEnd === -1 ? len : cdataEnd + 3;
          continue;
        }

        const nextLt = source.indexOf("<", pos);
        if (nextLt === -1) {
          node.text += source.slice(pos);
          pos = len;
          break;
        }
        if (nextLt > pos) {
          node.text += source.slice(pos, nextLt);
          pos = nextLt;
        }

        if (source.startsWith(closeMarker, pos) || source.startsWith(shortCloseMarker, pos)) {
          const end = source.indexOf(">", pos);
          pos = end === -1 ? len : end + 1;
          break;
        }

        if (source.startsWith("</", pos)) {
          const end = source.indexOf(">", pos);
          pos = end === -1 ? len : end + 1;
          break;
        }

        const child = parseNode();
        if (child) {
          node.children.push(child);
        }
      }

      return node;
    }
    return null;
  }

  return parseNode();
}

/**
 * Searches the CST tree for all descendant elements matching `tag` (case-insensitive).
 */
export function findXmlNodes(node: MiniXmlElement | null, tag: string): MiniXmlElement[] {
  const res: MiniXmlElement[] = [];
  if (!node) return res;
  if (node.tag.toLowerCase() === tag.toLowerCase()) {
    res.push(node);
  }
  for (const ch of node.children) {
    res.push(...findXmlNodes(ch, tag));
  }
  return res;
}

/**
 * Searches the CST tree for the first descendant element matching `tag` (case-insensitive).
 */
export function findXmlNode(node: MiniXmlElement | null, tag: string): MiniXmlElement | null {
  if (!node) return null;
  if (node.tag.toLowerCase() === tag.toLowerCase()) {
    return node;
  }
  for (const ch of node.children) {
    const found = findXmlNode(ch, tag);
    if (found) return found;
  }
  return null;
}
