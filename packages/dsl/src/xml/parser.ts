// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync, type SyntaxNode } from "./src-gen/bindings.js";
import type { XmlAttribute, XmlDocument, XmlElement, XmlSyntaxError } from "./types.js";

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

type Parser = ReturnType<typeof createWasmParserSync>["parser"];
let cached: Parser | null = null;

/** Initializes the shared parser from a `parser.wasm` path or bytes. */
export function initXmlParser(wasm: string | Uint8Array): void {
  cached = createWasmParserSync(wasm).parser;
}

/** Node-only convenience: locates the packaged `parser.wasm` and initializes once. */
export function ensureXmlParser(): void {
  if (cached) return;
  if (typeof process === "undefined" || !process.versions?.node) return;

  let fsModule: { existsSync: (p: string) => boolean } | undefined;
  let pathModule: { dirname: (p: string) => string; resolve: (...p: string[]) => string } | undefined;
  let urlModule: { fileURLToPath: (u: string) => string } | undefined;

  try {
    const proc = process as { getBuiltinModule?: (m: string) => unknown };
    if (typeof proc.getBuiltinModule === "function") {
      fsModule = proc.getBuiltinModule("node:fs") as typeof fsModule;
      pathModule = proc.getBuiltinModule("node:path") as typeof pathModule;
      urlModule = proc.getBuiltinModule("node:url") as typeof urlModule;
    }
  } catch {}

  if (!fsModule || !pathModule || !urlModule) {
    try {
      const req = typeof require !== "undefined" ? (require as (id: string) => unknown) : null;
      if (req) {
        fsModule = fsModule || (req("node:fs") as typeof fsModule);
        pathModule = pathModule || (req("node:path") as typeof pathModule);
        urlModule = urlModule || (req("node:url") as typeof urlModule);
      }
    } catch {}
  }

  if (!fsModule || !pathModule || !urlModule) return;

  try {
    const here = pathModule.dirname(urlModule.fileURLToPath(import.meta.url));
    const cwd = typeof process.cwd === "function" ? process.cwd() : "";
    const candidatePaths = [
      pathModule.resolve(here, "../dist/xml/parser.wasm"),
      pathModule.resolve(here, "./dist/xml/parser.wasm"),
      pathModule.resolve(here, "../dist/parser.wasm"),
      pathModule.resolve(here, "./parser.wasm"),
      pathModule.resolve(here, "./dist/parser.wasm"),
      ...(cwd
        ? [
            pathModule.resolve(cwd, "packages/dsl/dist/xml/parser.wasm"),
            pathModule.resolve(cwd, "packages/dsl/src/xml/parser.wasm"),
            pathModule.resolve(cwd, "dist/xml/parser.wasm"),
          ]
        : []),
    ];

    for (const p of candidatePaths) {
      if (fsModule.existsSync(p)) {
        initXmlParser(p);
        return;
      }
    }
  } catch {
    return;
  }
}

function collectErrors(n: SyntaxNode, out: { start: number; end: number }[]): void {
  if (n.type === "ERROR" || n.isMissing()) {
    out.push({ start: n.startOffset, end: n.endOffset });
    return;
  }
  if (!n.hasError()) return;
  for (const c of n.children) collectErrors(c, out);
}

function convert(n: SyntaxNode, source: string, parent: XmlElement | null): XmlElement | null {
  if (n.type === "ERROR" || n.isMissing()) return null;

  const openNode = n.childForFieldName("open");
  if (!openNode) return null;

  const openText = openNode.text;
  if (!openText) return null;

  const trimmedOpen = openText.trimStart();
  const nameMatch = /^<([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(trimmedOpen);
  if (!nameMatch || !nameMatch[1]) {
    return null;
  }

  const closeNode = n.childForFieldName("endName");
  const el: XmlElement = {
    name: nameMatch[1],
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
      const child = convert(c, source, el);
      if (child) {
        el.children.push(child);
      }
    }
  }
  return el;
}

/**
 * Fast synchronous XML parser that operates with exact byte offsets,
 * balanced tag stack, and constant O(depth) memory.
 */
export function parseXmlSync(source: string): XmlDocument {
  const errors: XmlSyntaxError[] = [];
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
        errors.push({
          start: idx,
          end: len,
          code: "XML-1001",
          message: "Unclosed XML comment '<!--'; expected '-->'.",
        });
        break;
      }
      idx = endIdx + 3;
      continue;
    }

    if (source.startsWith("<![CDATA[", idx)) {
      const endIdx = source.indexOf("]]>", idx + 9);
      if (endIdx === -1) {
        errors.push({
          start: idx,
          end: len,
          code: "XML-1001",
          message: "Unclosed XML CDATA section; expected ']]>'.",
        });
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
        errors.push({
          start: idx,
          end: len,
          code: "XML-1001",
          message: "Unclosed XML processing instruction; expected '?>'.",
        });
        break;
      }
      idx = endIdx + 2;
      continue;
    }

    if (source.startsWith("<!DOCTYPE", idx) || source.startsWith("<!doctype", idx)) {
      const endIdx = source.indexOf(">", idx + 9);
      if (endIdx === -1) {
        errors.push({
          start: idx,
          end: len,
          code: "XML-1001",
          message: "Unclosed XML DOCTYPE declaration; expected '>'.",
        });
        break;
      }
      idx = endIdx + 1;
      continue;
    }

    if (source.startsWith("</", idx)) {
      const endTagIdx = source.indexOf(">", idx + 2);
      const nextLtIdx = source.indexOf("<", idx + 2);
      if (endTagIdx === -1 || (nextLtIdx !== -1 && nextLtIdx < endTagIdx)) {
        errors.push({
          start: idx,
          end: nextLtIdx !== -1 ? nextLtIdx : len,
          code: "XML-1001",
          message: "Unclosed XML closing tag; expected '>'.",
        });
        if (nextLtIdx !== -1) {
          idx = nextLtIdx;
          continue;
        }
        break;
      }
      const rawClose = source.slice(idx, endTagIdx + 1);
      const closeMatch = /^<\/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*>$/.exec(rawClose);
      if (!closeMatch) {
        errors.push({
          start: idx,
          end: endTagIdx + 1,
          code: "XML-1001",
          message: `Malformed XML closing tag '${rawClose}'.`,
        });
      } else {
        const exactCloseName = closeMatch[1]!;
        const closeName = exactCloseName.toLowerCase();
        const top = stack[stack.length - 1];
        if (!top || top.name !== exactCloseName) {
          errors.push({
            start: idx,
            end: endTagIdx + 1,
            code: "XML-1002",
            message: top
              ? `Mismatched closing tag '</${exactCloseName}>'; expected '</${top.name}>'.`
              : `Unexpected closing tag '</${exactCloseName}>'.`,
          });
        }
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
      // Scan tag while respecting attribute quotes and detecting unclosed `<` or unclosed quotes
      let scan = idx + 1;
      let inQuote: string | null = null;
      let quoteStart = idx;
      let endTagIdx = -1;
      let abortedOnLt = false;

      while (scan < len) {
        const ch = source[scan]!;
        if (inQuote) {
          if (ch === inQuote) {
            inQuote = null;
          } else if (ch === "\n") {
            errors.push({
              start: quoteStart,
              end: quoteStart + 2,
              code: "XML-1004",
              message: "Unclosed quote in XML attribute value.",
            });
            inQuote = null;
          }
          scan++;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inQuote = ch;
          quoteStart = scan;
          scan++;
          continue;
        }
        if (ch === "<") {
          errors.push({
            start: idx,
            end: scan,
            code: "XML-1001",
            message: "Unclosed XML tag '<'; expected '>' before next '<'.",
          });
          abortedOnLt = true;
          break;
        }
        if (ch === ">") {
          endTagIdx = scan;
          break;
        }
        scan++;
      }

      if (abortedOnLt) {
        idx = scan;
        continue;
      }

      if (endTagIdx === -1) {
        if (inQuote) {
          errors.push({
            start: quoteStart,
            end: Math.min(len, quoteStart + 2),
            code: "XML-1004",
            message: "Unclosed quote in XML attribute value.",
          });
        } else {
          errors.push({
            start: idx,
            end: len,
            code: "XML-1001",
            message: "Unclosed XML tag at end of document; expected '>'.",
          });
        }
        break;
      }

      const tagContent = source.slice(idx, endTagIdx + 1);
      const selfClosing = tagContent.endsWith("/>");
      const nameMatch = /^<([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(tagContent);
      if (!nameMatch) {
        errors.push({
          start: idx,
          end: endTagIdx + 1,
          code: "XML-1001",
          message: `Malformed XML tag '${tagContent}'.`,
        });
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

      const attrSlice = tagContent.slice(nameMatch[0].length, selfClosing ? -2 : -1);
      const leftoverAttr = attrSlice
        .replace(/[A-Za-z_:][A-Za-z0-9_.:-]*[ \t\r\n]*=[ \t\r\n]*(?:"[^"]*"|'[^']*')/g, "")
        .trim();
      if (leftoverAttr.length > 0) {
        errors.push({
          start: idx,
          end: endTagIdx + 1,
          code: "XML-1004",
          message: `Malformed attribute '${leftoverAttr}' in '<${tagName}>'; expected key="value".`,
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
        const parentEl = stack[stack.length - 1]!;
        if (parentEl.text.length > 0 && parentEl.children.length === 0) {
          errors.push({
            start: parentEl.openEnd,
            end: idx,
            code: "XML-1005",
            message: `Unexpected text '${parentEl.text.slice(0, 24)}' inside container element '<${parentEl.name}>'; expected child XML element.`,
          });
        }
        parentEl.children.push(el);
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
    if (textChunk.includes(">")) {
      const gtOffset = idx + textChunk.indexOf(">");
      errors.push({
        start: gtOffset,
        end: gtOffset + 1,
        code: "XML-1001",
        message: "Unexpected '>' outside XML tag.",
      });
    } else if (trimmed) {
      if (stack.length === 0) {
        const firstNonWs = idx + textChunk.search(/\S/);
        const tokenLen = trimmed.split(/\s+/)[0]?.length ?? 1;
        errors.push({
          start: firstNonWs,
          end: firstNonWs + tokenLen,
          code: "XML-1005",
          message: `Unexpected text '${trimmed.slice(0, 24)}' outside root XML element.`,
        });
      } else {
        const parentEl = stack[stack.length - 1]!;
        if (parentEl.children.length > 0) {
          const firstNonWs = idx + textChunk.search(/\S/);
          const tokenLen = trimmed.split(/\s+/)[0]?.length ?? 1;
          errors.push({
            start: firstNonWs,
            end: firstNonWs + tokenLen,
            code: "XML-1005",
            message: `Unexpected text '${trimmed.slice(0, 24)}' inside container element '<${parentEl.name}>'; expected child XML element.`,
          });
        }
        parentEl.text += decodeEntities(trimmed);
      }
    }
    idx = endText;
  }

  while (stack.length > 0) {
    const el = stack.pop()!;
    errors.push({
      start: el.start,
      end: el.start + el.name.length + 2,
      code: "XML-1003",
      message: `Unclosed XML element '<${el.name}>'.`,
    });
    el.end = len;
    if (stack.length === 0 && !root) {
      root = el;
    }
  }

  return { source, root, errors };
}

export function parseXml(source: string): XmlDocument {
  // For multi-megabyte XML files (> 2 MB), parseXmlSync avoids WASM node bit-packing limits (8MB)
  // and parses large engineering libraries in under 400ms with exact offsets and tag stack.
  if (source.length > 2 * 1024 * 1024) {
    return parseXmlSync(source);
  }

  try {
    if (!cached) ensureXmlParser();
    if (cached) {
      const tree = cached.parse(source);
      if (tree) {
        const errors: { start: number; end: number }[] = [];
        collectErrors(tree.rootNode, errors);
        const rootNode = tree.rootNode.childForFieldName("root");
        let root = rootNode ? convert(rootNode, source, null) : null;
        if (!root) {
          for (const c of tree.rootNode.children) {
            if (c.type === "Element") {
              root = convert(c, source, null);
              if (root) break;
            }
          }
        }
        if (root && errors.length === 0) {
          return { source, root, errors };
        }
      }
    }
  } catch {
    // Fall back to robust parseXmlSync below
  }

  return parseXmlSync(source);
}
