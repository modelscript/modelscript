// SPDX-License-Identifier: AGPL-3.0-or-later

import { Range, TextEdit } from "vscode-languageserver";

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
    const prev = edits[i - 1];
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
    const trimmed = lines[i].trim();
    if (trimmed.endsWith(")") || trimmed === ")") {
      return i;
    }
  }
  return lines.length;
}

/**
 * Inserts a new OWL 2 declaration into an ontology document (Functional-Style Syntax).
 */
export function computeOWL2ElementInsert(docText: string, elementType: string, elementName: string): TextEdit[] {
  const lines = docText.split("\n");
  const targetLine = findOntologyInsertionLine(lines);
  const iri = formatIri(elementName);

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
 */
export function computeOWL2ElementDelete(docText: string, elementNames: string[]): TextEdit[] {
  const lines = docText.split("\n");
  const edits: TextEdit[] = [];
  const namePatterns = elementNames.map((n) => escapeRegex(n.replace(/^:/, "")));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pat of namePatterns) {
      const reg = new RegExp(`[:#<]?\\b${pat}\\b[>]?`);
      if (reg.test(line)) {
        // Delete entire statement line
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
 */
export function computeOWL2ConnectionInsert(
  docText: string,
  source: string,
  target: string,
  edgeType: string = "subClassOf",
): TextEdit[] {
  const lines = docText.split("\n");
  const targetLine = findOntologyInsertionLine(lines);
  const srcIri = formatIri(source);
  const tgtIri = formatIri(target);

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
 */
export function computeOWL2ConnectionDelete(docText: string, source: string, target: string): TextEdit[] {
  const lines = docText.split("\n");
  const edits: TextEdit[] = [];

  const srcPat = escapeRegex(source.replace(/^:/, ""));
  const tgtPat = escapeRegex(target.replace(/^:/, ""));
  const srcReg = new RegExp(`[:#<]?\\b${srcPat}\\b[>]?`);
  const tgtReg = new RegExp(`[:#<]?\\b${tgtPat}\\b[>]?`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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

  const pattern = new RegExp(`(?<=[:#<]|^|\\s)(${escapeRegex(cleanOld)})(?=[>\\s\\)]|$)`, "g");

  lines.forEach((line, i) => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      edits.push(TextEdit.replace(Range.create(i, match.index, i, match.index + match[0].length), cleanNew));
    }
  });

  return deduplicateAndSort(edits);
}
