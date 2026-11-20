// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";

const TOKEN_TYPE_INDEX = new Map<string, number>([
  ["keyword", 0],
  ["type", 1],
  ["class", 2],
  ["variable", 3],
  ["parameter", 4],
  ["function", 5],
  ["string", 6],
  ["number", 7],
  ["operator", 8],
  ["comment", 9],
  ["namespace", 10],
  ["enumMember", 11],
]);

interface CstNodeLike {
  type: string;
  text?: string;
  isError?: boolean;
  startIndex?: number;
  endIndex?: number;
  startPosition?: { row: number; column: number };
  endPosition?: { row: number; column: number };
  children?: readonly CstNodeLike[];
  childCount?: number;
  child?: (index: number) => CstNodeLike | null | undefined;
}

class LineIndex {
  private readonly lineStarts: number[];
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
    this.lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
    }
  }

  public lineRange(lineIdx: number): { start: number; end: number } {
    const start = this.lineStarts[lineIdx] ?? this.text.length;
    const rawEnd = lineIdx + 1 < this.lineStarts.length ? this.lineStarts[lineIdx + 1]! - 1 : this.text.length;
    const end = rawEnd > start && this.text.charCodeAt(rawEnd - 1) === 13 ? rawEnd - 1 : rawEnd;
    return { start, end };
  }

  public positionAt(offset: number): { line: number; char: number } {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const start = this.lineStarts[mid]!;
      if (start <= clamped) {
        if (mid + 1 >= this.lineStarts.length || this.lineStarts[mid + 1]! > clamped) {
          return { line: mid, char: clamped - start };
        }
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return { line: 0, char: clamped };
  }
}

class TokenCollector {
  private readonly rawTokens: Array<{
    line: number;
    char: number;
    length: number;
    typeIndex: number;
    modifier: number;
  }> = [];
  private readonly seenPositions = new Set<string>();

  public push(line: number, char: number, length: number, typeName: string, modifier = 0): void {
    if (length <= 0 || line < 0 || char < 0) return;
    const typeIndex = TOKEN_TYPE_INDEX.get(typeName);
    if (typeIndex === undefined) return;
    const key = `${line}:${char}`;
    if (this.seenPositions.has(key)) return;
    this.seenPositions.add(key);
    this.rawTokens.push({ line, char, length, typeIndex, modifier });
  }

  public pushNode(node: CstNodeLike | null | undefined, typeName: string, modifier = 0): void {
    const start = node?.startPosition;
    const end = node?.endPosition;
    if (!start || !end) return;
    if (start.row === end.row) {
      this.push(start.row, start.column, end.column - start.column, typeName, modifier);
      return;
    }
    const text = String(node.text ?? "");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i]!;
      const len = rawLine.endsWith("\r") ? rawLine.length - 1 : rawLine.length;
      if (len > 0) this.push(start.row + i, i === 0 ? start.column : 0, len, typeName, modifier);
    }
  }

  public pushOffsetSpan(
    _text: string,
    lineIndex: LineIndex,
    startOffset: number,
    endOffset: number,
    typeName: string,
    modifier = 0,
  ): void {
    if (endOffset <= startOffset) return;
    const startPos = lineIndex.positionAt(startOffset);
    const endPos = lineIndex.positionAt(endOffset);
    if (startPos.line === endPos.line) {
      this.push(startPos.line, startPos.char, endPos.char - startPos.char, typeName, modifier);
      return;
    }
    for (let line = startPos.line; line <= endPos.line; line++) {
      const range = lineIndex.lineRange(line);
      const segStart = line === startPos.line ? startOffset : range.start;
      const segEnd = line === endPos.line ? Math.min(endOffset, range.end) : range.end;
      const len = segEnd - segStart;
      if (len > 0) this.push(line, segStart - range.start, len, typeName, modifier);
    }
  }

  public buildData(): number[] {
    this.rawTokens.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.char - b.char));
    const data: number[] = [];
    let lastLine = -1;
    let lastEndChar = -1;
    let prevLine = 0;
    let prevChar = 0;
    for (const token of this.rawTokens) {
      if (token.line > lastLine || token.char >= lastEndChar) {
        lastLine = token.line;
        lastEndChar = token.char + token.length;
        const deltaLine = token.line - prevLine;
        const deltaChar = deltaLine === 0 ? token.char - prevChar : token.char;
        data.push(deltaLine, deltaChar, token.length, token.typeIndex, token.modifier);
        prevLine = token.line;
        prevChar = token.char;
      }
    }
    return data;
  }
}

function getChildren(node: CstNodeLike | null | undefined): readonly CstNodeLike[] {
  if (!node) return [];
  if (Array.isArray(node.children) && node.children.length > 0) return node.children;
  const count = node.childCount ?? 0;
  if (count <= 0 || typeof node.child !== "function") return [];
  const res: CstNodeLike[] = [];
  for (let i = 0; i < count; i++) {
    const c = node.child(i);
    if (c) res.push(c);
  }
  return res;
}

function isIdentStart(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95;
}

function isIdentPart(ch: number): boolean {
  return isIdentStart(ch) || (ch >= 48 && ch <= 57);
}

function isDigit(ch: number): boolean {
  return ch >= 48 && ch <= 57;
}

function readNumberEnd(text: string, start: number, limit: number): number {
  let i = start;
  if (i < limit && (text[i] === "+" || text[i] === "-")) i++;
  let sawDigit = false;
  while (i < limit && isDigit(text.charCodeAt(i))) {
    sawDigit = true;
    i++;
  }
  if (i < limit && text[i] === ".") {
    const nextIsDigit = i + 1 < limit && isDigit(text.charCodeAt(i + 1));
    if (sawDigit || nextIsDigit) {
      i++;
      while (i < limit && isDigit(text.charCodeAt(i))) {
        sawDigit = true;
        i++;
      }
    }
  }
  if (!sawDigit) return -1;
  if (i < limit && (text[i] === "e" || text[i] === "E" || text[i] === "d" || text[i] === "D")) {
    let exp = i + 1;
    if (exp < limit && (text[exp] === "+" || text[exp] === "-")) exp++;
    if (exp < limit && isDigit(text.charCodeAt(exp))) {
      i = exp + 1;
      while (i < limit && isDigit(text.charCodeAt(i))) i++;
    }
  }
  return i;
}

function collectCstGapLineComments(
  rootNode: CstNodeLike,
  text: string,
  lineIndex: LineIndex,
  collector: TokenCollector,
  markers: readonly string[],
): void {
  const emitGap = (gapStart: number, gapEnd: number) => {
    let i = gapStart;
    while (i < gapEnd) {
      let matched = false;
      for (const m of markers) {
        if (text.startsWith(m, i)) {
          let end = text.indexOf("\n", i);
          if (end === -1 || end > gapEnd) end = gapEnd;
          if (end > i && text.charCodeAt(end - 1) === 13) end--;
          collector.pushOffsetSpan(text, lineIndex, i, end, "comment");
          i = end;
          matched = true;
          break;
        }
      }
      if (!matched) i++;
    }
  };

  let cursor = 0;
  const visitLeaves = (node: CstNodeLike): void => {
    const children = getChildren(node);
    if (children.length === 0) {
      const start = typeof node.startIndex === "number" ? node.startIndex : cursor;
      const end = typeof node.endIndex === "number" ? node.endIndex : start;
      if (start > cursor) emitGap(cursor, start);
      if (end > cursor) cursor = end;
      return;
    }
    for (const child of children) visitLeaves(child);
  };
  visitLeaves(rootNode);
  if (cursor < text.length) emitGap(cursor, text.length);
}

const OWL2_KEYWORDS = new Set([
  "Prefix",
  "Ontology",
  "Import",
  "Declaration",
  "Class",
  "Datatype",
  "ObjectProperty",
  "DataProperty",
  "AnnotationProperty",
  "NamedIndividual",
  "Annotation",
  "SubClassOf",
  "EquivalentClasses",
  "DisjointClasses",
  "DisjointUnion",
  "SubObjectPropertyOf",
  "ObjectPropertyChain",
  "EquivalentObjectProperties",
  "DisjointObjectProperties",
  "InverseObjectProperties",
  "ObjectPropertyDomain",
  "ObjectPropertyRange",
  "FunctionalObjectProperty",
  "InverseFunctionalObjectProperty",
  "ReflexiveObjectProperty",
  "IrreflexiveObjectProperty",
  "SymmetricObjectProperty",
  "AsymmetricObjectProperty",
  "TransitiveObjectProperty",
  "SubDataPropertyOf",
  "EquivalentDataProperties",
  "DisjointDataProperties",
  "DataPropertyDomain",
  "DataPropertyRange",
  "FunctionalDataProperty",
  "DatatypeDefinition",
  "HasKey",
  "SameIndividual",
  "DifferentIndividuals",
  "ClassAssertion",
  "ObjectPropertyAssertion",
  "NegativeObjectPropertyAssertion",
  "DataPropertyAssertion",
  "NegativeDataPropertyAssertion",
  "AnnotationAssertion",
  "SubAnnotationPropertyOf",
  "AnnotationPropertyDomain",
  "AnnotationPropertyRange",
  "ObjectIntersectionOf",
  "ObjectUnionOf",
  "ObjectComplementOf",
  "ObjectOneOf",
  "ObjectSomeValuesFrom",
  "ObjectAllValuesFrom",
  "ObjectHasValue",
  "ObjectHasSelf",
  "ObjectMinCardinality",
  "ObjectMaxCardinality",
  "ObjectExactCardinality",
  "ObjectInverseOf",
  "DataIntersectionOf",
  "DataUnionOf",
  "DataComplementOf",
  "DataOneOf",
  "DataSomeValuesFrom",
  "DataAllValuesFrom",
  "DataHasValue",
  "DataMinCardinality",
  "DataMaxCardinality",
  "DataExactCardinality",
  "DatatypeRestriction",
]);

interface Owl2EntityRoles {
  classes: Set<string>;
  properties: Set<string>;
  individuals: Set<string>;
  datatypes: Set<string>;
}

function classifyOwl2Iri(iri: string, roles: Owl2EntityRoles): "type" | "class" | "function" | "enumMember" {
  const colonIdx = iri.indexOf(":");
  const prefix = colonIdx >= 0 ? iri.slice(0, colonIdx) : "";
  const local = colonIdx >= 0 ? iri.slice(colonIdx + 1) : iri;
  if (
    roles.datatypes.has(iri) ||
    prefix === "xsd" ||
    prefix === "rdfs" ||
    prefix === "rdf" ||
    iri === "owl:Thing" ||
    iri === "owl:Nothing"
  ) {
    return "type";
  }
  if (roles.classes.has(iri)) return "class";
  if (roles.properties.has(iri)) return "function";
  if (roles.individuals.has(iri)) return "enumMember";
  if (local.length > 0 && local[0]! >= "A" && local[0]! <= "Z") return "class";
  return "function";
}

function isOwl2CstTree(tree: { rootNode?: CstNodeLike | null } | null | undefined): boolean {
  const rootType = tree?.rootNode?.type;
  return rootType === "OntologyDocument" || rootType === "Ontology" || rootType === "PrefixDeclaration";
}

function emitOwl2XmlTokens(text: string, lineIndex: LineIndex, collector: TokenCollector): void {
  let c = 0;
  while (c < text.length) {
    const start = text.indexOf("<!--", c);
    if (start === -1) break;
    const endIdx = text.indexOf("-->", start + 4);
    const end = endIdx !== -1 ? endIdx + 3 : text.length;
    collector.pushOffsetSpan(text, lineIndex, start, end, "comment");
    c = end;
  }

  const doc = parseXmlSync(text);
  const visitEl = (el: XmlElement): void => {
    const openNameStart = el.start + 1;
    const openNameEnd = openNameStart + el.name.length;
    collector.pushOffsetSpan(text, lineIndex, openNameStart, openNameEnd, "keyword");

    for (const attr of el.attributes) {
      collector.pushOffsetSpan(text, lineIndex, attr.start, attr.start + attr.name.length, "parameter");
      collector.pushOffsetSpan(
        text,
        lineIndex,
        Math.max(attr.start, attr.valueStart - 1),
        Math.min(attr.end, attr.valueEnd + 1),
        "string",
      );
    }

    for (const child of el.children) visitEl(child);

    if (!el.selfClosing && el.closeStart >= 0 && el.closeStart + 2 + el.name.length <= el.end) {
      collector.pushOffsetSpan(text, lineIndex, el.closeStart + 2, el.closeStart + 2 + el.name.length, "keyword");
    }
  };
  if (doc.root) visitEl(doc.root);
}

function emitOwl2LiteralLeaf(node: CstNodeLike, text: string, lineIndex: LineIndex, collector: TokenCollector): void {
  const leafText = String(node.text ?? "");
  const startOffset = node.startIndex ?? 0;
  const caret = leafText.indexOf("^^");
  if (caret !== -1) {
    collector.pushOffsetSpan(text, lineIndex, startOffset, startOffset + caret, "string");
    collector.pushOffsetSpan(text, lineIndex, startOffset + caret, startOffset + caret + 2, "operator");
    collector.pushOffsetSpan(text, lineIndex, startOffset + caret + 2, startOffset + leafText.length, "type");
    return;
  }
  collector.pushNode(node, "string");
}

function scanOwl2FunctionalSpan(
  text: string,
  start: number,
  end: number,
  lineIndex: LineIndex,
  collector: TokenCollector,
  roles: Owl2EntityRoles,
  isDeclContext: boolean,
): void {
  let i = start;
  while (i < end) {
    const ch = text[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "#" || (ch === "/" && text[i + 1] === "/")) {
      let lineEnd = text.indexOf("\n", i);
      if (lineEnd === -1 || lineEnd > end) lineEnd = end;
      if (lineEnd > i && text.charCodeAt(lineEnd - 1) === 13) lineEnd--;
      collector.pushOffsetSpan(text, lineIndex, i, lineEnd, "comment");
      i = lineEnd;
      continue;
    }
    if (ch === "<") {
      const close = text.indexOf(">", i + 1);
      if (close !== -1 && close < end) {
        collector.pushOffsetSpan(text, lineIndex, i, close + 1, "string");
        i = close + 1;
        continue;
      }
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < end) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      collector.pushOffsetSpan(text, lineIndex, i, j, "string");
      i = j;
      continue;
    }
    if (ch === "^" && text[i + 1] === "^") {
      collector.pushOffsetSpan(text, lineIndex, i, i + 2, "operator");
      i += 2;
      continue;
    }
    if (ch === ":") {
      let j = i + 1;
      while (j < end && (isIdentPart(text.charCodeAt(j)) || text[j] === "." || text[j] === "-")) j++;
      if (j > i + 1) {
        const iri = text.slice(i, j);
        const tokenType = classifyOwl2Iri(iri, roles);
        const mod = isDeclContext && tokenType !== "type" ? 1 : 0;
        collector.pushOffsetSpan(text, lineIndex, i, j, tokenType, mod);
        i = j;
        continue;
      }
    }
    const numEnd = readNumberEnd(text, i, end);
    if (numEnd > i) {
      collector.pushOffsetSpan(text, lineIndex, i, numEnd, "number");
      i = numEnd;
      continue;
    }
    if (isIdentStart(ch.charCodeAt(0))) {
      let j = i + 1;
      while (j < end && (isIdentPart(text.charCodeAt(j)) || text[j] === "." || text[j] === "-")) j++;
      if (j < end && text[j] === ":") {
        let k = j + 1;
        while (k < end && (isIdentPart(text.charCodeAt(k)) || text[k] === "." || text[k] === "-")) k++;
        if (k === j + 1) {
          collector.pushOffsetSpan(text, lineIndex, i, k, "namespace", 1);
        } else {
          const iri = text.slice(i, k);
          const tokenType = classifyOwl2Iri(iri, roles);
          const mod = isDeclContext && tokenType !== "type" ? 1 : 0;
          collector.pushOffsetSpan(text, lineIndex, i, k, tokenType, mod);
        }
        i = k;
        continue;
      }
      const word = text.slice(i, j);
      if (OWL2_KEYWORDS.has(word) || word === "@prefix" || word === "prefix" || word === "base") {
        collector.pushOffsetSpan(text, lineIndex, i, j, "keyword");
      }
      i = j;
      continue;
    }
    i++;
  }
}

function collectOwl2RolesFromText(text: string): Owl2EntityRoles {
  const roles: Owl2EntityRoles = {
    classes: new Set<string>(),
    properties: new Set<string>(),
    individuals: new Set<string>(),
    datatypes: new Set<string>(),
  };
  let pos = 0;
  const isWsCode = (code: number): boolean =>
    code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11;
  const readHeadToken = (from: number): { word: string; afterOpenParen: number } | null => {
    let i = from;
    while (i < text.length && isWsCode(text.charCodeAt(i))) i++;
    const wStart = i;
    if (i < text.length && isIdentStart(text.charCodeAt(i))) {
      i++;
      while (i < text.length && isIdentPart(text.charCodeAt(i))) i++;
    }
    const word = text.slice(wStart, i);
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    if (text[i] === "(") return { word, afterOpenParen: i + 1 };
    return null;
  };
  const readArgs = (from: number): string[] => {
    const args: string[] = [];
    let i = from;
    while (i < text.length && text[i] !== ")") {
      while (i < text.length && isWsCode(text.charCodeAt(i))) i++;
      if (i >= text.length || text[i] === ")" || text[i] === "(") break;
      const start = i;
      while (i < text.length && !isWsCode(text.charCodeAt(i)) && text[i] !== "(" && text[i] !== ")") i++;
      if (i > start) args.push(text.slice(start, i));
    }
    return args;
  };

  while (pos < text.length) {
    const idx = text.indexOf("(", pos);
    if (idx === -1) break;
    let kEnd = idx;
    while (kEnd > 0 && (text[kEnd - 1] === " " || text[kEnd - 1] === "\t")) kEnd--;
    let kStart = kEnd;
    while (kStart > 0 && isIdentPart(text.charCodeAt(kStart - 1))) kStart--;
    const kw = text.slice(kStart, kEnd);

    if (kw === "Declaration") {
      const inner = readHeadToken(idx + 1);
      if (inner) {
        const innerArgs = readArgs(inner.afterOpenParen);
        const iri = innerArgs[0];
        if (iri) {
          if (inner.word === "Class") roles.classes.add(iri);
          else if (inner.word === "Datatype") roles.datatypes.add(iri);
          else if (
            inner.word === "ObjectProperty" ||
            inner.word === "DataProperty" ||
            inner.word === "AnnotationProperty"
          ) {
            roles.properties.add(iri);
          } else if (inner.word === "NamedIndividual") {
            roles.individuals.add(iri);
          }
        }
      }
    } else if (kw === "SubClassOf") {
      const args = readArgs(idx + 1);
      if (args[0] && !OWL2_KEYWORDS.has(args[0])) roles.classes.add(args[0]);
      if (args[1] && !OWL2_KEYWORDS.has(args[1])) roles.classes.add(args[1]);
    } else if (kw === "ClassAssertion") {
      const args = readArgs(idx + 1);
      if (args[0] && !OWL2_KEYWORDS.has(args[0])) roles.classes.add(args[0]);
      if (args[1] && !OWL2_KEYWORDS.has(args[1])) roles.individuals.add(args[1]);
    } else if (kw === "ObjectPropertyDomain" || kw === "ObjectPropertyRange" || kw === "DataPropertyDomain") {
      const args = readArgs(idx + 1);
      if (args[0] && !OWL2_KEYWORDS.has(args[0])) roles.properties.add(args[0]);
      if (args[1] && !OWL2_KEYWORDS.has(args[1])) roles.classes.add(args[1]);
    } else if (kw === "DataPropertyRange") {
      const args = readArgs(idx + 1);
      if (args[0] && !OWL2_KEYWORDS.has(args[0])) roles.properties.add(args[0]);
      if (args[1] && !OWL2_KEYWORDS.has(args[1])) roles.datatypes.add(args[1]);
    } else if (kw === "ObjectPropertyAssertion") {
      const args = readArgs(idx + 1);
      if (args[0] && !OWL2_KEYWORDS.has(args[0])) roles.properties.add(args[0]);
      if (args[1] && !OWL2_KEYWORDS.has(args[1])) roles.individuals.add(args[1]);
      if (args[2] && !OWL2_KEYWORDS.has(args[2])) roles.individuals.add(args[2]);
    } else if (kw === "DataPropertyAssertion") {
      const args = readArgs(idx + 1);
      if (args[0] && !OWL2_KEYWORDS.has(args[0])) roles.properties.add(args[0]);
      if (args[1] && !OWL2_KEYWORDS.has(args[1])) roles.individuals.add(args[1]);
    }
    pos = idx + 1;
  }
  return roles;
}

/**
 * Computes LSP delta-encoded semantic token data for OWL 2 documents (Functional-Style Syntax, OWL/XML, and Turtle).
 */
export function computeOwl2SemanticTokensData(
  text: string,
  tree?: { rootNode?: CstNodeLike | null } | null,
  uri?: string,
): number[] {
  const collector = new TokenCollector();
  const lineIndex = new LineIndex(text);

  if ((uri && /\.owx($|\?|#)/i.test(uri)) || text.trimStart().startsWith("<")) {
    emitOwl2XmlTokens(text, lineIndex, collector);
    return collector.buildData();
  }

  if (tree?.rootNode && isOwl2CstTree(tree)) {
    const roles: Owl2EntityRoles = {
      classes: new Set<string>(),
      properties: new Set<string>(),
      individuals: new Set<string>(),
      datatypes: new Set<string>(),
    };

    const getChildIris = (node: CstNodeLike): string[] => {
      const iris: string[] = [];
      for (const child of getChildren(node)) {
        if (child.type === "IRI") iris.push(String(child.text ?? ""));
      }
      return iris;
    };

    const collectRolesFromCst = (node: CstNodeLike | null | undefined): void => {
      if (!node) return;
      const children = getChildren(node);
      if (node.type === "Declaration") {
        for (const entity of children) {
          const iri = getChildIris(entity)[0];
          if (!iri) continue;
          if (entity.type === "ClassEntity") roles.classes.add(iri);
          else if (entity.type === "DatatypeEntity") roles.datatypes.add(iri);
          else if (
            entity.type === "ObjectPropertyEntity" ||
            entity.type === "DataPropertyEntity" ||
            entity.type === "AnnotationPropertyEntity"
          ) {
            roles.properties.add(iri);
          } else if (entity.type === "NamedIndividualEntity") roles.individuals.add(iri);
        }
      } else if (node.type === "SubClassOfAxiom") {
        const headKw = String(children[0]?.text ?? "");
        if (headKw === "SubClassOf") {
          for (const iri of getChildIris(node)) roles.classes.add(iri);
        }
      } else if (node.type === "ClassAssertionAxiom") {
        const iris = getChildIris(node);
        if (iris[0]) roles.classes.add(iris[0]);
        if (iris[1]) roles.individuals.add(iris[1]);
      } else if (
        node.type === "ObjectPropertyDomainAxiom" ||
        node.type === "ObjectPropertyRangeAxiom" ||
        node.type === "DataPropertyDomainAxiom"
      ) {
        const iris = getChildIris(node);
        if (iris[0]) roles.properties.add(iris[0]);
        if (iris[1]) roles.classes.add(iris[1]);
      } else if (node.type === "DataPropertyRangeAxiom") {
        const iris = getChildIris(node);
        if (iris[0]) roles.properties.add(iris[0]);
        if (iris[1]) roles.datatypes.add(iris[1]);
      } else if (node.type === "ObjectPropertyAssertionAxiom") {
        const iris = getChildIris(node);
        if (iris[0]) roles.properties.add(iris[0]);
        if (iris[1]) roles.individuals.add(iris[1]);
        if (iris[2]) roles.individuals.add(iris[2]);
      } else if (node.type === "DataPropertyAssertionAxiom") {
        const iris = getChildIris(node);
        if (iris[0]) roles.properties.add(iris[0]);
        if (iris[1]) roles.individuals.add(iris[1]);
      }
      for (const child of children) collectRolesFromCst(child);
    };

    collectRolesFromCst(tree.rootNode);

    const visit = (node: CstNodeLike | null | undefined, inDeclaration: boolean): void => {
      if (!node) return;
      const nType = node.type;
      const nText = String(node.text ?? "");

      if (nType === "ERROR" || node.isError) {
        if (typeof node.startIndex === "number" && typeof node.endIndex === "number") {
          const errChildren = getChildren(node);
          if (nText.startsWith('"') && errChildren.length === 1 && getChildren(errChildren[0]).length === 0) {
            emitOwl2LiteralLeaf(node, text, lineIndex, collector);
          } else {
            scanOwl2FunctionalSpan(text, node.startIndex, node.endIndex, lineIndex, collector, roles, inDeclaration);
          }
        }
        return;
      }

      if (nType === "PrefixName") {
        collector.pushNode(node, "namespace", 1);
        return;
      }
      if (nType === "FullIRI") {
        collector.pushNode(node, "string");
        return;
      }
      if (nType === "AbbreviatedIRI") {
        const tokenType = classifyOwl2Iri(nText, roles);
        const mod = inDeclaration && tokenType !== "type" ? 1 : 0;
        collector.pushNode(node, tokenType, mod);
        return;
      }
      if (nType === "TypedLiteral" || nType === "StringLiteral" || nText.startsWith('"')) {
        if (getChildren(node).length === 0 || nType === "TypedLiteral") {
          emitOwl2LiteralLeaf(node, text, lineIndex, collector);
          return;
        }
      }
      if (nType === "INTEGER" || nType === "DECIMAL" || nType === "FLOAT") {
        collector.pushNode(node, "number");
        return;
      }
      if (nText === "^^") {
        collector.pushNode(node, "operator");
        return;
      }

      const nextDecl = inDeclaration || nType === "Declaration";
      const children = getChildren(node);
      if (children.length === 0) {
        if (OWL2_KEYWORDS.has(nText)) {
          collector.pushNode(node, "keyword");
        }
        return;
      }
      for (const child of children) visit(child, nextDecl);
    };

    visit(tree.rootNode, false);
    collectCstGapLineComments(tree.rootNode, text, lineIndex, collector, ["#", "//"]);
    return collector.buildData();
  }

  const roles = collectOwl2RolesFromText(text);
  scanOwl2FunctionalSpan(text, 0, text.length, lineIndex, collector, roles, false);
  return collector.buildData();
}
