// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ModelicaCosimParticipantInfo {
  id: string;
  type: "fmu" | "modelica";
  className: string;
  fileName?: string | undefined;
}

export interface ModelicaCosimCouplingInfo {
  from: { participantId: string; variable: string };
  to: { participantId: string; variable: string };
}

export interface ModelicaCosimGraphResult {
  ok: boolean;
  participants?: ModelicaCosimParticipantInfo[] | undefined;
  couplings?: ModelicaCosimCouplingInfo[] | undefined;
  error?: string | undefined;
}

interface CstNodeLike {
  type: string;
  text: string;
  children?: readonly CstNodeLike[] | undefined;
}

function isAsciiUpperCode(code: number): boolean {
  return code >= 65 && code <= 90;
}

function isIdentStartCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function isIdentContCode(code: number): boolean {
  return isIdentStartCode(code) || (code >= 48 && code <= 57);
}

function skipWs(text: string, idx: number): number {
  let i = idx;
  while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\r" || text[i] === "\n")) i++;
  return i;
}

function readIdentAt(text: string, idx: number): { token: string; next: number } | null {
  if (idx >= text.length || !isIdentStartCode(text.charCodeAt(idx))) return null;
  let i = idx + 1;
  while (i < text.length && isIdentContCode(text.charCodeAt(i))) i++;
  return { token: text.slice(idx, i), next: i };
}

function extractFirstQuotedLiteral(text: string): string | undefined {
  const start = text.indexOf('"');
  if (start === -1) return undefined;
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i += 2;
      continue;
    }
    if (text[i] === '"') {
      return text.slice(start + 1, i);
    }
    i++;
  }
  return undefined;
}

function collectLeafTexts(node: CstNodeLike | null | undefined): string[] {
  const out: string[] = [];
  const stack: (CstNodeLike | null | undefined)[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    const ch = cur.children || [];
    if (ch.length === 0) {
      const t = cur.text?.trim();
      if (t) out.push(t);
    } else {
      for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
    }
  }
  return out;
}

function collectNodesByType(root: CstNodeLike | null | undefined, targetType: string): CstNodeLike[] {
  const results: CstNodeLike[] = [];
  const stack: (CstNodeLike | null | undefined)[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur.type === targetType) results.push(cur);
    const ch = cur.children || [];
    for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
  }
  return results;
}

function collectFirstNodeByTypes(root: CstNodeLike | null | undefined, types: string[]): CstNodeLike | null {
  const typeSet = new Set(types);
  const stack: (CstNodeLike | null | undefined)[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    if (typeSet.has(cur.type)) return cur;
    const ch = cur.children || [];
    for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
  }
  return null;
}

function extractModelicaModStringAttr(modNode: CstNodeLike | null | undefined, attrName: string): string | undefined {
  for (const em of collectNodesByType(modNode, "element_modification")) {
    const nameNode = collectFirstNodeByTypes(em, ["name", "identifier", "IDENT"]);
    if (nameNode && nameNode.text.trim() === attrName) {
      const strNode = collectFirstNodeByTypes(em, ["STRING", "string_literal"]);
      return strNode ? extractFirstQuotedLiteral(strNode.text) : extractFirstQuotedLiteral(em.text);
    }
  }
  return undefined;
}

const BUILTIN_TYPES = new Set(["Real", "Integer", "Boolean", "String", "StateSelect"]);
const EXCLUDED_PREFIXES = new Set(["parameter", "constant", "discrete", "input", "output"]);
const KEYWORDS = new Set([
  "parameter",
  "constant",
  "discrete",
  "input",
  "output",
  "flow",
  "stream",
  "replaceable",
  "redeclare",
  "inner",
  "outer",
  "final",
  "extends",
  "import",
  "equation",
  "algorithm",
  "initial",
  "end",
  "model",
  "class",
  "block",
  "connector",
  "record",
  "type",
  "package",
  "function",
  "when",
  "if",
  "for",
  "while",
  "connect",
  "protected",
  "public",
  "annotation",
  "external",
  "partial",
  "encapsulated",
  "within",
]);

export function extractModelicaCosimGraph(text: string, rootNode?: CstNodeLike | null): ModelicaCosimGraphResult {
  try {
    const participants: ModelicaCosimParticipantInfo[] = [];
    const componentNames = new Set<string>();
    const couplings: ModelicaCosimCouplingInfo[] = [];

    const isAcceptedComponent = (className: string, instanceName: string): boolean => {
      if (!className || !instanceName) return false;
      if (!isAsciiUpperCode(className.charCodeAt(0))) return false;
      const instCode = instanceName.charCodeAt(0);
      if (!((instCode >= 97 && instCode <= 122) || instCode === 95)) return false;
      if (BUILTIN_TYPES.has(className) || KEYWORDS.has(className.toLowerCase())) return false;
      if (className.includes("Interface")) return false;
      return true;
    };

    const addConnectPair = (ref1: string, ref2: string) => {
      const dot1 = ref1.indexOf(".");
      const dot2 = ref2.indexOf(".");
      if (dot1 === -1 || dot2 === -1) return;
      const comp1 = ref1.substring(0, dot1);
      const var1 = ref1.substring(dot1 + 1);
      const comp2 = ref2.substring(0, dot2);
      const var2 = ref2.substring(dot2 + 1);
      if (!componentNames.has(comp1) || !componentNames.has(comp2)) return;
      couplings.push({
        from: { participantId: comp1, variable: var1 },
        to: { participantId: comp2, variable: var2 },
      });
    };

    if (rootNode) {
      const stack: CstNodeLike[] = [rootNode];
      const connectNodes: CstNodeLike[] = [];

      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;

        if (node.type === "component_clause") {
          const prefixNode = (node.children || []).find((c) => c.type === "type_prefix");
          let hasExcludedPrefix = false;
          if (prefixNode) {
            if (collectLeafTexts(prefixNode).some((tok) => EXCLUDED_PREFIXES.has(tok))) {
              hasExcludedPrefix = true;
            }
          }
          if (!hasExcludedPrefix) {
            const typeSpecNode = (node.children || []).find((c) => c.type === "type_specifier");
            const className = typeSpecNode ? typeSpecNode.text.trim() : "";
            for (const declWrap of collectNodesByType(node, "component_declaration")) {
              const declNode = (declWrap.children || []).find((c) => c.type === "declaration") ?? declWrap;
              const idNode = collectFirstNodeByTypes(declNode, ["identifier", "IDENT"]);
              const instanceName = idNode ? idNode.text.trim() : "";
              if (!isAcceptedComponent(className, instanceName)) continue;

              const modNode = (declNode.children || []).find((c) => c.type === "modification");
              const fileName = modNode ? extractModelicaModStringAttr(modNode, "fileName") : undefined;
              participants.push({
                id: instanceName,
                type: fileName !== undefined ? "fmu" : "modelica",
                className,
                fileName,
              });
              componentNames.add(instanceName);
            }
          }
          continue;
        }

        if (node.type === "connect_equation" || node.type === "connect_clause") {
          connectNodes.push(node);
          continue;
        }

        for (let i = (node.children?.length ?? 0) - 1; i >= 0; i--) {
          const ch = node.children?.[i];
          if (ch) stack.push(ch);
        }
      }

      for (const cn of connectNodes) {
        const refs = collectNodesByType(cn, "component_reference");
        if (refs.length >= 2) {
          addConnectPair(refs[0]!.text.trim(), refs[1]!.text.trim());
        }
      }

      return { ok: true, participants, couplings };
    }

    // Lexical fallback when Modelica WASM parser is unavailable
    for (const rawLine of text.split(/\r?\n/)) {
      const leadWsEnd = skipWs(rawLine, 0);
      if (leadWsEnd === 0) continue;
      const firstTok = readIdentAt(rawLine, leadWsEnd);
      if (!firstTok || EXCLUDED_PREFIXES.has(firstTok.token)) continue;

      let typeEnd = firstTok.next;
      while (typeEnd < rawLine.length && rawLine[typeEnd] === ".") {
        const nextPart = readIdentAt(rawLine, typeEnd + 1);
        if (!nextPart) break;
        typeEnd = nextPart.next;
      }
      const className = rawLine.slice(leadWsEnd, typeEnd);
      const wsAfterType = skipWs(rawLine, typeEnd);
      if (wsAfterType === typeEnd) continue;
      const instTok = readIdentAt(rawLine, wsAfterType);
      if (!instTok || !isAcceptedComponent(className, instTok.token)) continue;

      let cur = skipWs(rawLine, instTok.next);
      let fileName: string | undefined;
      if (rawLine[cur] === "(") {
        const closeParen = rawLine.indexOf(")", cur + 1);
        if (closeParen !== -1) {
          const modSpan = rawLine.slice(cur + 1, closeParen);
          const eq = modSpan.indexOf("fileName");
          if (eq !== -1) {
            fileName = extractFirstQuotedLiteral(modSpan.slice(eq));
          }
          cur = skipWs(rawLine, closeParen + 1);
        }
      }
      if (rawLine.slice(cur).trim().endsWith(";")) {
        participants.push({
          id: instTok.token,
          type: fileName !== undefined ? "fmu" : "modelica",
          className,
          fileName,
        });
        componentNames.add(instTok.token);
      }
    }

    let scanPos = 0;
    while (scanPos < text.length) {
      const idx = text.indexOf("connect", scanPos);
      if (idx === -1) break;
      const prevOk = idx === 0 || !isIdentContCode(text.charCodeAt(idx - 1));
      const afterConnect = skipWs(text, idx + 7);
      if (prevOk && !isIdentContCode(text.charCodeAt(idx + 7)) && text[afterConnect] === "(") {
        const closeIdx = text.indexOf(")", afterConnect + 1);
        if (closeIdx !== -1) {
          const args = text.slice(afterConnect + 1, closeIdx);
          const comma = args.indexOf(",");
          if (comma !== -1) {
            addConnectPair(args.slice(0, comma).trim(), args.slice(comma + 1).trim());
          }
          scanPos = closeIdx + 1;
          continue;
        }
      }
      scanPos = idx + 7;
    }

    return { ok: true, participants, couplings };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
