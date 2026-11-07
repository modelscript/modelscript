// SPDX-License-Identifier: AGPL-3.0-or-later

import type { XmlAttribute, XmlDocument, XmlElement } from "../../../../../../packages/dsl/src/xml/types.js";

export type { Splice, XmlAttribute, XmlDocument, XmlElement } from "../../../../../../packages/dsl/src/xml/types.js";

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

export function parseXmlSync(source: string): XmlDocument {
  const errors: { start: number; end: number }[] = [];
  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];

  let idx = 0;
  const len = source.length;

  while (idx < len) {
    while (idx < len && /\s/.test(source[idx]!)) idx++;
    if (idx >= len) break;

    if (source.startsWith("<!--", idx)) {
      const endIdx = source.indexOf("-->", idx + 4);
      if (endIdx === -1) {
        errors.push({ start: idx, end: len });
        break;
      }
      idx = endIdx + 3;
      continue;
    }

    if (source.startsWith("<![CDATA[", idx)) {
      const endIdx = source.indexOf("]]>", idx + 9);
      if (endIdx === -1) {
        errors.push({ start: idx, end: len });
        break;
      }
      const cdataText = source.slice(idx + 9, endIdx);
      if (stack.length > 0) {
        stack[stack.length - 1]!.cdata.push({
          start: idx + 9,
          end: endIdx,
          text: cdataText,
        });
      }
      idx = endIdx + 3;
      continue;
    }

    if (source.startsWith("<?", idx)) {
      const endIdx = source.indexOf("?>", idx + 2);
      if (endIdx === -1) {
        errors.push({ start: idx, end: len });
        break;
      }
      idx = endIdx + 2;
      continue;
    }

    if (source.startsWith("<!DOCTYPE", idx) || source.startsWith("<!doctype", idx)) {
      const endIdx = source.indexOf(">", idx + 9);
      if (endIdx === -1) {
        errors.push({ start: idx, end: len });
        break;
      }
      idx = endIdx + 1;
      continue;
    }

    if (source.startsWith("</", idx)) {
      const endTagIdx = source.indexOf(">", idx + 2);
      if (endTagIdx === -1) {
        errors.push({ start: idx, end: len });
        break;
      }
      const closeMatch = /^<\/([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(source.slice(idx, endTagIdx + 1));
      if (closeMatch) {
        const closeName = closeMatch[1]!.toLowerCase();
        let matchIdx = -1;
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i]!.name.toLowerCase() === closeName) {
            matchIdx = i;
            break;
          }
        }
        if (matchIdx !== -1) {
          while (stack.length > matchIdx + 1) {
            const unclosed = stack.pop()!;
            unclosed.end = idx;
          }
          const current = stack.pop()!;
          current.end = endTagIdx + 1;
          current.closeStart = idx;
          if (stack.length === 0 && !root) {
            root = current;
          }
        }
      }
      idx = endTagIdx + 1;
      continue;
    }

    if (source[idx] === "<") {
      const endTagIdx = source.indexOf(">", idx + 1);
      if (endTagIdx === -1) {
        errors.push({ start: idx, end: len });
        break;
      }
      const tagContent = source.slice(idx, endTagIdx + 1);
      const selfClosing = tagContent.endsWith("/>");
      const nameMatch = /^<([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(tagContent);
      if (!nameMatch) {
        idx = endTagIdx + 1;
        continue;
      }
      const tagName = nameMatch[1]!;
      const start = idx;
      const attributes: XmlAttribute[] = [];
      const attrRe = /([A-Za-z_:][A-Za-z0-9_.:-]*)[ \t\r\n]*=[ \t\r\n]*("([^"]*)"|'([^']*)')/g;
      attrRe.lastIndex = nameMatch[0].length;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(tagContent))) {
        const raw = m[3] ?? m[4] ?? "";
        const attrStart = start + m.index;
        const valStart = attrStart + m[0].length - raw.length - 1;
        attributes.push({
          name: m[1]!,
          value: decodeEntities(raw),
          start: attrStart,
          end: attrStart + m[0].length,
          valueStart: valStart,
          valueEnd: valStart + raw.length,
          quote: m[2]![0]!,
        });
      }

      const el: XmlElement = {
        name: tagName,
        start,
        end: endTagIdx + 1,
        openEnd: endTagIdx + 1,
        closeStart: endTagIdx + 1,
        selfClosing,
        attributes,
        children: [],
        cdata: [],
        text: "",
        parent: stack.length > 0 ? stack[stack.length - 1]! : null,
      };

      if (stack.length > 0) {
        stack[stack.length - 1]!.children.push(el);
      }

      idx = endTagIdx + 1;

      if (!selfClosing) {
        stack.push(el);
      } else if (stack.length === 0 && !root) {
        root = el;
      }
      continue;
    }

    const nextAngle = source.indexOf("<", idx);
    const endText = nextAngle === -1 ? len : nextAngle;
    const textChunk = source.slice(idx, endText);
    const trimmed = textChunk.trim();
    if (trimmed && stack.length > 0) {
      stack[stack.length - 1]!.text += decodeEntities(trimmed);
    }
    idx = endText;
  }

  while (stack.length > 0) {
    const el = stack.pop()!;
    el.end = len;
    if (stack.length === 0 && !root) {
      root = el;
    }
  }

  return { source, root, errors };
}

export function parseXml(source: string): XmlDocument {
  return parseXmlSync(source);
}
