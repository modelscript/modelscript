// SPDX-License-Identifier: AGPL-3.0-or-later

import { Range, TextEdit } from "vscode-languageserver";
import { type GenericSyntaxNode, getNodeChildren } from "../cst-lowering.js";
import { detectOwl2Format } from "../parser/index.js";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deduplicateAndSort(edits: TextEdit[]): TextEdit[] {
  edits.sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
    return a.range.start.character - b.range.start.character;
  });

  return edits.filter((edit, i) => {
    if (i === 0) return true;
    const prev = edits[i - 1]!;
    if (
      edit.range.start.line < prev.range.end.line ||
      (edit.range.start.line === prev.range.end.line && edit.range.start.character < prev.range.end.character)
    ) {
      return false;
    }
    return true;
  });
}

function formatIri(name: string): string {
  if (name.startsWith(":") || name.startsWith("<") || name.includes(":")) {
    return name;
  }
  return `:${name}`;
}

function findOntologyInsertionLine(lines: string[]): number {
  // Search backward for closing parenthesis of Ontology(...)
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (trimmed.endsWith(")") || trimmed === ")") {
      return i;
    }
  }
  return lines.length;
}

interface AxiomSpan {
  type: string;
  start: { line: number; character: number };
  end: { line: number; character: number };
  text: string;
}

/**
 * Parses balanced Functional-Style Syntax axiom spans from source text or directly from CST nodes.
 * Accurately tracks nested parentheses, strings, and IRIs across single or multi-line declarations.
 */
function findFunctionalAxiomSpans(docText: string, cstRoot?: GenericSyntaxNode | null): AxiomSpan[] {
  const spans: AxiomSpan[] = [];
  const lines = docText.split("\n");

  const lineStarts: number[] = [0];
  for (let i = 0; i < lines.length; i++) {
    lineStarts.push(lineStarts[i]! + lines[i]!.length + 1);
  }

  const offsetToPos = (offset: number) => {
    let l = 0;
    let r = lines.length - 1;
    while (l <= r) {
      const mid = (l + r) >> 1;
      if (lineStarts[mid]! <= offset) {
        l = mid + 1;
      } else {
        r = mid - 1;
      }
    }
    const line = r;
    const character = Math.max(0, offset - lineStarts[line]!);
    return { line, character };
  };

  const expandSpan = (startIndex: number, endIndex: number, axiomType: string) => {
    let expandStart = startIndex;
    const startPos = offsetToPos(startIndex);
    const lineStartOffset = lineStarts[startPos.line]!;
    const prefix = docText.substring(lineStartOffset, startIndex);
    if (/^\s*$/.test(prefix)) {
      expandStart = lineStartOffset;
    }

    let expandEnd = endIndex;
    const endPos = offsetToPos(endIndex);
    const nextLineStart = lineStarts[endPos.line + 1];
    if (nextLineStart !== undefined) {
      const suffix = docText.substring(endIndex, nextLineStart - 1);
      if (/^\s*$/.test(suffix)) {
        expandEnd = nextLineStart;
      }
    }

    spans.push({
      type: axiomType,
      start: offsetToPos(expandStart),
      end: offsetToPos(expandEnd),
      text: docText.substring(startIndex, endIndex),
    });
  };

  // 1. Direct CST Tree Traversal (Zero Regex)
  if (cstRoot) {
    const isAxiomType = (type: string) => {
      return (
        type.endsWith("Axiom") ||
        type === "Declaration" ||
        type === "SubClassOf" ||
        type === "EquivalentClasses" ||
        type === "DisjointClasses" ||
        type === "DisjointUnion" ||
        type === "ClassAssertion" ||
        type === "SameIndividual" ||
        type === "DifferentIndividuals" ||
        type.includes("ObjectProperty") ||
        type.includes("DataProperty") ||
        type.includes("Annotation") ||
        type === "HasKey" ||
        type === "DatatypeDefinition"
      );
    };

    const walk = (node: GenericSyntaxNode) => {
      const start = node.startIndex ?? node.startOffset;
      const end = node.endIndex ?? node.endOffset;
      if (isAxiomType(node.type) && typeof start === "number" && typeof end === "number" && end > start) {
        expandSpan(start, end, node.type);
        return;
      }
      for (const child of getNodeChildren(node)) {
        walk(child);
      }
    };
    walk(cstRoot);

    if (spans.length > 0) {
      return spans;
    }
  }

  // 2. Robust lexical scanner for Functional-Style Syntax
  // Accurately skips comments, strings, and IRIs while locating axiom productions
  let i = 0;
  while (i < docText.length) {
    const ch = docText[i]!;

    // Skip line comments (# or //)
    if (ch === "#" || (ch === "/" && i + 1 < docText.length && docText[i + 1] === "/")) {
      while (i < docText.length && docText[i] !== "\n") i++;
      continue;
    }

    // Skip block comments (/* ... */)
    if (ch === "/" && i + 1 < docText.length && docText[i + 1] === "*") {
      i += 2;
      while (i + 1 < docText.length && !(docText[i] === "*" && docText[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // Skip string literals ("...")
    if (ch === '"') {
      i++;
      while (i < docText.length) {
        if (docText[i] === "\\" && i + 1 < docText.length) i += 2;
        else if (docText[i] === '"') {
          i++;
          break;
        } else i++;
      }
      continue;
    }

    // Skip full IRI references (<...>)
    if (ch === "<") {
      i++;
      while (i < docText.length && docText[i] !== ">") i++;
      if (i < docText.length) i++;
      continue;
    }

    // Match identifier followed by (
    if (/[A-Za-z]/.test(ch)) {
      const idStart = i;
      while (i < docText.length && /[A-Za-z0-9_]/.test(docText[i]!)) i++;
      const id = docText.substring(idStart, i);

      let p = i;
      while (p < docText.length && /\s/.test(docText[p]!)) p++;

      if (p < docText.length && docText[p] === "(") {
        if (id !== "Prefix" && id !== "Ontology") {
          const startIndex = idStart;
          const parenStart = p;
          let depth = 1;
          let inString = false;
          let inIri = false;
          let escaped = false;
          let endIndex = parenStart + 1;

          while (endIndex < docText.length && depth > 0) {
            const c = docText[endIndex]!;
            if (escaped) {
              escaped = false;
            } else if (c === "\\") {
              escaped = true;
            } else if (c === '"' && !inIri) {
              inString = !inString;
            } else if (c === "<" && !inString) {
              inIri = true;
            } else if (c === ">" && inIri) {
              inIri = false;
            } else if (!inString && !inIri) {
              if (c === "(") depth++;
              else if (c === ")") depth--;
            }
            endIndex++;
          }

          if (depth === 0) {
            expandSpan(startIndex, endIndex, id);
            i = endIndex;
            continue;
          }
        }
      }
    }
    i++;
  }

  return spans;
}

/**
 * Inserts a new OWL 2 declaration into an ontology document.
 * Automatically adapts between Functional-Style Syntax and Turtle.
 */
export function computeOWL2ElementInsert(docText: string, elementType: string, elementName: string): TextEdit[] {
  const format = detectOwl2Format(docText);
  const iri = formatIri(elementName);

  if (format === "ttl") {
    const lines = docText.split("\n");
    let targetLine = lines.length;
    let typeTriple = "owl:Class";
    switch (elementType) {
      case "ObjectProperty":
      case "ObjectPropertyDeclaration":
        typeTriple = "owl:ObjectProperty";
        break;
      case "DataProperty":
      case "DataPropertyDeclaration":
        typeTriple = "owl:DatatypeProperty";
        break;
      case "Individual":
      case "NamedIndividual":
      case "IndividualDeclaration":
        typeTriple = "owl:NamedIndividual";
        break;
    }
    const snippet = `\n${iri} a ${typeTriple} .\n`;
    return [TextEdit.insert({ line: targetLine, character: 0 }, snippet)];
  }

  const lines = docText.split("\n");
  const targetLine = findOntologyInsertionLine(lines);

  let snippet = "";
  switch (elementType) {
    case "ObjectProperty":
    case "ObjectPropertyDeclaration":
      snippet = `  Declaration(ObjectProperty(${iri}))\n`;
      break;
    case "DataProperty":
    case "DataPropertyDeclaration":
      snippet = `  Declaration(DataProperty(${iri}))\n`;
      break;
    case "Individual":
    case "NamedIndividual":
    case "IndividualDeclaration":
      snippet = `  Declaration(NamedIndividual(${iri}))\n`;
      break;
    case "Class":
    case "ClassDeclaration":
    default:
      snippet = `  Declaration(Class(${iri}))\n`;
      break;
  }

  return [TextEdit.insert({ line: targetLine, character: 0 }, snippet)];
}

/**
 * Deletes OWL 2 element declarations and all associated relationship axioms.
 * Uses exact balanced AST spans in Functional-Style Syntax to prevent syntax corruption.
 */
export function computeOWL2ElementDelete(
  docText: string,
  elementNames: string[],
  cstRoot?: GenericSyntaxNode | null,
): TextEdit[] {
  const format = detectOwl2Format(docText);
  const edits: TextEdit[] = [];
  const namePatterns = elementNames.map((n) => escapeRegex(n.replace(/^:/, "")));

  if (format === "ofn") {
    const spans = findFunctionalAxiomSpans(docText, cstRoot);
    for (const span of spans) {
      for (const pat of namePatterns) {
        const reg = new RegExp(`[:#<]?\\b${pat}\\b[>]?`);
        if (reg.test(span.text)) {
          edits.push(
            TextEdit.del(Range.create(span.start.line, span.start.character, span.end.line, span.end.character)),
          );
          break;
        }
      }
    }
    if (edits.length > 0) {
      return deduplicateAndSort(edits);
    }
  }

  // Fallback for Turtle or unstructured syntax
  const lines = docText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const pat of namePatterns) {
      const reg = new RegExp(`[:#<]?\\b${pat}\\b[>]?`);
      if (reg.test(line)) {
        if (i + 1 < lines.length) {
          edits.push(TextEdit.del(Range.create(i, 0, i + 1, 0)));
        } else {
          edits.push(TextEdit.del(Range.create(i, 0, i, line.length)));
        }
        break;
      }
    }
  }

  return deduplicateAndSort(edits);
}

/**
 * Inserts a relationship axiom (SubClassOf, EquivalentClasses, DisjointClasses, etc.) connecting source and target.
 * Automatically adapts between Functional-Style Syntax and Turtle.
 */
export function computeOWL2ConnectionInsert(
  docText: string,
  source: string,
  target: string,
  edgeType: string = "subClassOf",
): TextEdit[] {
  const format = detectOwl2Format(docText);
  const srcIri = formatIri(source);
  const tgtIri = formatIri(target);

  if (format === "ttl") {
    const lines = docText.split("\n");
    let targetLine = lines.length;
    let snippet = "";
    if (edgeType === "equivalentTo") {
      snippet = `\n${srcIri} owl:equivalentClass ${tgtIri} .\n`;
    } else if (edgeType === "disjointWith") {
      snippet = `\n${srcIri} owl:disjointWith ${tgtIri} .\n`;
    } else if (edgeType === "objectProperty") {
      snippet = `\n${srcIri} rdfs:subClassOf [ a owl:Restriction ; owl:onProperty :relatedTo ; owl:someValuesFrom ${tgtIri} ] .\n`;
    } else {
      snippet = `\n${srcIri} rdfs:subClassOf ${tgtIri} .\n`;
    }
    return [TextEdit.insert({ line: targetLine, character: 0 }, snippet)];
  }

  const lines = docText.split("\n");
  const targetLine = findOntologyInsertionLine(lines);

  let snippet = "";
  if (edgeType === "equivalentTo") {
    snippet = `  EquivalentClasses(${srcIri} ${tgtIri})\n`;
  } else if (edgeType === "disjointWith") {
    snippet = `  DisjointClasses(${srcIri} ${tgtIri})\n`;
  } else if (edgeType === "objectProperty") {
    snippet = `  SubClassOf(${srcIri} ObjectSomeValuesFrom(:relatedTo ${tgtIri}))\n`;
  } else {
    snippet = `  SubClassOf(${srcIri} ${tgtIri})\n`;
  }

  return [TextEdit.insert({ line: targetLine, character: 0 }, snippet)];
}

/**
 * Deletes a relationship axiom connecting source and target.
 * Uses exact balanced AST spans in Functional-Style Syntax to cleanly delete multi-line or single-line axioms.
 */
export function computeOWL2ConnectionDelete(
  docText: string,
  source: string,
  target: string,
  cstRoot?: GenericSyntaxNode | null,
): TextEdit[] {
  const format = detectOwl2Format(docText);
  const edits: TextEdit[] = [];

  const srcPat = escapeRegex(source.replace(/^:/, ""));
  const tgtPat = escapeRegex(target.replace(/^:/, ""));
  const srcReg = new RegExp(`[:#<]?\\b${srcPat}\\b[>]?`);
  const tgtReg = new RegExp(`[:#<]?\\b${tgtPat}\\b[>]?`);

  if (format === "ofn") {
    const spans = findFunctionalAxiomSpans(docText, cstRoot);
    for (const span of spans) {
      if (srcReg.test(span.text) && tgtReg.test(span.text)) {
        edits.push(
          TextEdit.del(Range.create(span.start.line, span.start.character, span.end.line, span.end.character)),
        );
      }
    }
    if (edits.length > 0) {
      return deduplicateAndSort(edits);
    }
  }

  // Fallback for Turtle or unstructured syntax
  const lines = docText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (srcReg.test(line) && tgtReg.test(line)) {
      if (i + 1 < lines.length) {
        edits.push(TextEdit.del(Range.create(i, 0, i + 1, 0)));
      } else {
        edits.push(TextEdit.del(Range.create(i, 0, i, line.length)));
      }
    }
  }

  return deduplicateAndSort(edits);
}

/**
 * Updates a class or property name/IRI throughout the document.
 */
export function computeOWL2NameEdit(docText: string, oldName: string, newName: string): TextEdit[] {
  const lines = docText.split("\n");
  const edits: TextEdit[] = [];
  const cleanOld = oldName.replace(/^:/, "");
  const cleanNew = newName.replace(/^:/, "");

  const pattern = new RegExp(`([:#<]|^|\\s)(${escapeRegex(cleanOld)})(?=[>\\s\\)]|$)`, "g");

  lines.forEach((line, i) => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const prefixLen = match[1] ? match[1].length : 0;
      const startCol = match.index + prefixLen;
      edits.push(TextEdit.replace(Range.create(i, startCol, i, startCol + cleanOld.length), cleanNew));
    }
  });

  return deduplicateAndSort(edits);
}
