// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OWL2Axiom } from "@modelscript/runtime";
import { lowerCstToAxioms, type CstNodeLike } from "../cst-lowering.js";
import { parseOwlXmlToAxioms } from "./owl-xml.js";
import { parseTurtleToOwl2Axioms, type RdfTriple } from "./turtle.js";

export { parseOwlXmlToAxioms, parseTurtleToOwl2Axioms, type RdfTriple };

export type Owl2Format = "ofn" | "ttl" | "owx";

/**
 * Auto-detects the serialization format of an OWL 2 ontology document (`ofn`, `ttl`, or `owx`).
 */
export function detectOwl2Format(source: string, fileUri?: string): Owl2Format {
  if (fileUri) {
    const lower = fileUri.toLowerCase();
    if (lower.endsWith(".ttl")) return "ttl";
    if (lower.endsWith(".owx")) return "owx";
    if (lower.endsWith(".ofn")) return "ofn";
  }
  const trimmed = source.trimStart();
  if (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<Ontology") ||
    trimmed.startsWith("<rdf:RDF") ||
    trimmed.startsWith("<owl:Ontology")
  ) {
    return "owx";
  }
  if (
    /^@prefix\b/m.test(trimmed) ||
    /^@base\b/m.test(trimmed) ||
    /^PREFIX\s+[A-Za-z0-9_-]*:\s*<[^>]*>/im.test(trimmed) ||
    (/\ba\s+owl:(?:Class|Ontology|ObjectProperty|DatatypeProperty|NamedIndividual|Restriction)\b/.test(trimmed) &&
      !/\bOntology\s*\(/.test(trimmed))
  ) {
    return "ttl";
  }
  return "ofn";
}

/**
 * Parses an OWL 2 ontology document in Functional-Style Syntax (`.ofn`), Turtle (`.ttl`),
 * or OWL/XML / RDF/XML (`.owx` / `.owl`) into normalized `OWL2Axiom[]`.
 */
export function parseOwl2ToAxioms(
  source: string,
  options?: {
    fileUri?: string;
    format?: Owl2Format;
    ofnParser?: { parse(text: string): { rootNode: CstNodeLike } };
  },
): OWL2Axiom[] {
  const format = options?.format ?? detectOwl2Format(source, options?.fileUri);
  if (format === "ttl") {
    return parseTurtleToOwl2Axioms(source);
  }
  if (format === "owx") {
    return parseOwlXmlToAxioms(source);
  }
  if (options?.ofnParser) {
    const tree = options.ofnParser.parse(source);
    return lowerCstToAxioms(tree.rootNode, source);
  }
  return [];
}
