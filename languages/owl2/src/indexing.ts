// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext, SyntaxNode } from "@modelscript/dsl";
import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";
import type { SymbolEntry, SymbolIndex, UnifiedWorkspace } from "@modelscript/runtime";
import { detectOwl2Format, parseOwlXmlToAxioms, parseTurtleToOwl2Axioms } from "./parser/index.js";

type Owl2CstNodeLike = Omit<SyntaxNode, "hasError"> & { hasError?: boolean | (() => boolean) };

interface PendingOwl2Entity {
  shortName: string;
  kind: "Class" | "ObjectProperty" | "DataProperty" | "Individual";
  fullIri: string;
  rawIri: string;
  startOffset: number;
  endOffset: number;
  nameStartOffset?: number | undefined;
  nameEndOffset?: number | undefined;
}

function extractValidCstRoot(tree: unknown): SyntaxNode | null {
  if (!tree || typeof tree !== "object") return null;
  const candidate = ("rootNode" in tree ? (tree as { rootNode?: unknown }).rootNode : tree) as
    Owl2CstNodeLike | undefined;
  if (!candidate || typeof candidate !== "object" || typeof candidate.type !== "string") return null;
  const hasErr = typeof candidate.hasError === "function" ? candidate.hasError() : Boolean(candidate.hasError);
  if (hasErr || candidate.isError) return null;
  return candidate as SyntaxNode;
}

function cstNodeText(node: SyntaxNode, source: string): string {
  if (typeof node.text === "string" && node.text.length > 0) return node.text;
  if (typeof node.startIndex === "number" && typeof node.endIndex === "number" && node.endIndex >= node.startIndex) {
    return source.slice(node.startIndex, node.endIndex);
  }
  return "";
}

function fieldChild(node: SyntaxNode, fieldName: string): SyntaxNode | null {
  return typeof node.childForFieldName === "function" ? node.childForFieldName(fieldName) : null;
}

function extractOwl2FromCst(
  rootNode: SyntaxNode,
  text: string,
  prefixes: Map<string, string>,
  imports: string[],
  pendingEntities: PendingOwl2Entity[],
): {
  ontologyIri?: string | undefined;
  ontologyNameRange?: { startOffset: number; endOffset: number } | undefined;
} {
  let ontologyIri: string | undefined;
  let ontologyNameRange: { startOffset: number; endOffset: number } | undefined;

  const stack: SyntaxNode[] = [rootNode];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const type = node.type;

    if (type === "PrefixDeclaration") {
      const nameNode =
        fieldChild(node, "name") ??
        (node.namedChildren ?? node.children ?? []).find((c) => c.type === "PrefixName") ??
        null;
      const iriNode =
        fieldChild(node, "iri") ??
        (node.namedChildren ?? node.children ?? []).find((c) => c.type === "FullIRI" || c.type === "IRI") ??
        null;
      if (iriNode) {
        const pfx = nameNode ? cstNodeText(nameNode, text).trim() : ":";
        const val = extractIri(cstNodeText(iriNode, text));
        if (val) {
          prefixes.set(pfx.endsWith(":") ? pfx : `${pfx}:`, val);
        }
      }
      continue;
    }

    if (type === "Ontology") {
      const iriNode = fieldChild(node, "iri");
      if (iriNode) {
        const extracted = extractIri(cstNodeText(iriNode, text));
        if (extracted) {
          ontologyIri = extracted;
          ontologyNameRange = { startOffset: iriNode.startIndex, endOffset: iriNode.endIndex };
        }
      }
      const kids = node.namedChildren ?? node.children ?? [];
      for (let i = kids.length - 1; i >= 0; i--) {
        stack.push(kids[i]!);
      }
      continue;
    }

    if (type === "ImportDeclaration") {
      const iriNode =
        fieldChild(node, "iri") ??
        (node.namedChildren ?? node.children ?? []).find(
          (c) => c.type === "IRI" || c.type === "FullIRI" || c.type === "AbbreviatedIRI",
        ) ??
        null;
      if (iriNode) {
        const target = extractIri(cstNodeText(iriNode, text));
        if (target) imports.push(target);
      }
      continue;
    }

    if (type === "Declaration") {
      const entityNode =
        fieldChild(node, "entity") ??
        (node.namedChildren ?? node.children ?? []).find(
          (c) =>
            c.type === "ClassEntity" ||
            c.type === "ObjectPropertyEntity" ||
            c.type === "DataPropertyEntity" ||
            c.type === "NamedIndividualEntity",
        ) ??
        null;
      if (entityNode) {
        let kind: PendingOwl2Entity["kind"] | null = null;
        if (entityNode.type === "ClassEntity") kind = "Class";
        else if (entityNode.type === "ObjectPropertyEntity") kind = "ObjectProperty";
        else if (entityNode.type === "DataPropertyEntity") kind = "DataProperty";
        else if (entityNode.type === "NamedIndividualEntity") kind = "Individual";

        if (kind) {
          const iriNode =
            fieldChild(entityNode, "iri") ??
            (entityNode.namedChildren ?? entityNode.children ?? []).find(
              (c) => c.type === "IRI" || c.type === "FullIRI" || c.type === "AbbreviatedIRI",
            ) ??
            null;
          if (iriNode) {
            const rawIri = extractIri(cstNodeText(iriNode, text));
            if (rawIri) {
              pendingEntities.push({
                shortName: getShortName(rawIri),
                kind,
                fullIri: expandIri(rawIri, prefixes),
                rawIri,
                startOffset: node.startIndex,
                endOffset: node.endIndex,
                nameStartOffset: iriNode.startIndex,
                nameEndOffset: iriNode.endIndex,
              });
            }
          }
        }
      }
      continue;
    }

    const kids = node.namedChildren ?? node.children ?? [];
    for (let i = kids.length - 1; i >= 0; i--) {
      stack.push(kids[i]!);
    }
  }

  return { ontologyIri, ontologyNameRange };
}

export interface Owl2FileInfo {
  uri: string;
  ontologyIri?: string | undefined;
  prefixes: Map<string, string>;
  classes: Map<string, SymbolEntry>;
  objectProperties: Map<string, SymbolEntry>;
  dataProperties: Map<string, SymbolEntry>;
  individuals: Map<string, SymbolEntry>;
  imports: string[];
  index: SymbolIndex;
}

/**
 * Declarative DSL `indexing.indexFile` hook for OWL 2 Functional-Style (`.ofn`),
 * Turtle (`.ttl`), and OWL/XML or RDF/XML (`.owx` / `.owl` / `.rdf`) ontologies.
 *
 * Uses CST-first indexing when a valid compiled WASM `SyntaxNode` tree is provided via `ctx.tree`
 * for Functional-Style Syntax documents, falling back gracefully to format-specific parsers/scanners.
 */
export function indexOwl2Document(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const fileIndex = ctx.getFileIndex() as SymbolIndex;

  const prefixes = new Map<string, string>([
    ["owl:", "http://www.w3.org/2002/07/owl#"],
    ["rdf:", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"],
    ["rdfs:", "http://www.w3.org/2000/01/rdf-schema#"],
    ["xsd:", "http://www.w3.org/2001/XMLSchema#"],
  ]);

  const classes = new Map<string, SymbolEntry>();
  const objectProperties = new Map<string, SymbolEntry>();
  const dataProperties = new Map<string, SymbolEntry>();
  const individuals = new Map<string, SymbolEntry>();
  const imports: string[] = [];
  let ontologyIri: string | undefined;
  let ontologyNameRange: { startOffset: number; endOffset: number } | undefined;

  const fileName = uri.split("/").pop() || uri;
  const pendingEntities: PendingOwl2Entity[] = [];

  const format = detectOwl2Format(text, uri);
  const cstRoot = format === "ofn" ? extractValidCstRoot(ctx.tree) : null;
  let usedCst = false;

  if (cstRoot) {
    const extracted = extractOwl2FromCst(cstRoot, text, prefixes, imports, pendingEntities);
    ontologyIri = extracted.ontologyIri;
    ontologyNameRange = extracted.ontologyNameRange;
    usedCst = true;
  } else if (format === "ttl" || format === "owx") {
    if (format === "ttl") {
      extractTurtlePrefixes(text, prefixes);
    } else {
      const xmlDoc = parseXmlSync(text);
      if (xmlDoc.root) {
        const extractedXml = extractOwlXmlMetadata(xmlDoc.root, prefixes, imports);
        if (extractedXml.ontologyIri) {
          ontologyIri = extractedXml.ontologyIri;
          ontologyNameRange = extractedXml.ontologyNameRange;
        }
      }
    }
    const loweredAxioms = format === "ttl" ? parseTurtleToOwl2Axioms(text) : parseOwlXmlToAxioms(text);
    for (const ax of loweredAxioms) {
      let kind: "Class" | "ObjectProperty" | "DataProperty" | "Individual" | null = null;
      let rawIri = "";
      if (ax.type === "ClassDeclaration" && !ax.iri.startsWith("__aux_")) {
        kind = "Class";
        rawIri = ax.iri;
      } else if (ax.type === "ObjectPropertyDeclaration") {
        kind = "ObjectProperty";
        rawIri = ax.iri;
      } else if (ax.type === "DataPropertyDeclaration") {
        kind = "DataProperty";
        rawIri = ax.iri;
      } else if (ax.type === "IndividualDeclaration") {
        kind = "Individual";
        rawIri = ax.iri;
      }
      if (kind && rawIri) {
        pendingEntities.push({
          shortName: getShortName(rawIri),
          kind,
          fullIri: expandIri(rawIri, prefixes),
          rawIri,
          startOffset: 0,
          endOffset: text.length,
        });
      }
    }
  }

  let i = !usedCst && format === "ofn" ? 0 : text.length;
  const len = text.length;

  while (i < len) {
    if (text.charCodeAt(i) <= 32) {
      i++;
      continue;
    }

    if (text.charCodeAt(i) === 35 || (text.charCodeAt(i) === 47 && text.charCodeAt(i + 1) === 47)) {
      while (i < len && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++;
      continue;
    }

    if (text.startsWith("Prefix", i) && text.charCodeAt(i + 6) === 40) {
      const closeParen = findMatchingParen(text, i + 6);
      if (closeParen !== -1) {
        const body = text.slice(i + 7, closeParen).trim();
        const eqIdx = body.indexOf("=");
        if (eqIdx !== -1) {
          const pfx = body.slice(0, eqIdx).trim();
          const val = extractIri(body.slice(eqIdx + 1).trim());
          prefixes.set(pfx.endsWith(":") ? pfx : `${pfx}:`, val);
        }
        i = closeParen + 1;
        continue;
      }
    }

    if (text.startsWith("Ontology", i) && text.charCodeAt(i + 8) === 40) {
      let j = i + 9;
      while (j < len && text.charCodeAt(j) <= 32) j++;
      if (j < len && text.charCodeAt(j) === 60) {
        const closeAngle = text.indexOf(">", j);
        if (closeAngle !== -1) {
          ontologyIri = text.slice(j + 1, closeAngle).trim();
        }
      }
      i += 9;
      continue;
    }

    if (text.startsWith("Import", i) && text.charCodeAt(i + 6) === 40) {
      const closeParen = text.indexOf(")", i + 6);
      if (closeParen !== -1) {
        const raw = text.slice(i + 7, closeParen).trim();
        const target = extractIri(raw);
        if (target) imports.push(target);
        i = closeParen + 1;
        continue;
      }
    }

    if (text.startsWith("Declaration", i) && text.charCodeAt(i + 11) === 40) {
      const start = i;
      const closeParen = findMatchingParen(text, i + 11);
      if (closeParen !== -1) {
        const inner = text.slice(i + 12, closeParen).trim();
        const kindMatch = parseEntityDeclaration(inner);
        if (kindMatch) {
          pendingEntities.push({
            shortName: getShortName(kindMatch.iri),
            kind: kindMatch.kind,
            fullIri: expandIri(kindMatch.iri, prefixes),
            rawIri: kindMatch.iri,
            startOffset: start,
            endOffset: closeParen + 1,
          });
        }
        i = closeParen + 1;
        continue;
      }
    }

    i++;
  }

  const ontName = ontologyIri ? getShortName(ontologyIri) : fileName;
  const rootId = ctx.addSymbol(
    ontName,
    "Class",
    null,
    0,
    text.length,
    {},
    {
      ruleName: "owl2_ontology",
      namePath: ontologyIri || fileName,
      ...(ontologyIri ? { aliases: [ontologyIri] } : {}),
      ...(ontologyNameRange ? { fieldRanges: { name: ontologyNameRange } } : {}),
    },
  );

  for (const ent of pendingEntities) {
    const symId = ctx.addSymbol(
      ent.shortName,
      ent.kind,
      rootId,
      ent.startOffset,
      ent.endOffset,
      {},
      {
        ruleName: `owl2_${ent.kind.toLowerCase()}`,
        namePath: ent.fullIri,
        aliases: [ent.fullIri, ent.rawIri],
        ...(ent.nameStartOffset !== undefined && ent.nameEndOffset !== undefined
          ? { fieldRanges: { name: { startOffset: ent.nameStartOffset, endOffset: ent.nameEndOffset } } }
          : {}),
      },
    );
    const entry = fileIndex.symbols.get(symId);
    if (entry) {
      if (ent.kind === "Class") classes.set(ent.fullIri, entry);
      else if (ent.kind === "ObjectProperty") objectProperties.set(ent.fullIri, entry);
      else if (ent.kind === "DataProperty") dataProperties.set(ent.fullIri, entry);
      else if (ent.kind === "Individual") individuals.set(ent.fullIri, entry);
    }
  }

  ctx.setParsedModel<Owl2FileInfo>(
    {
      uri,
      ontologyIri,
      prefixes,
      classes,
      objectProperties,
      dataProperties,
      individuals,
      imports,
      index: fileIndex,
    },
    "owl2Info",
  );
}

/** Retrieves the indexed `Owl2FileInfo` for `uri` from `workspace`. */
export function getOwl2FileInfo(workspace: UnifiedWorkspace, uri: string): Owl2FileInfo | undefined {
  return workspace.getParsedModel<Owl2FileInfo>(uri, "owl2Info");
}

/** Retrieves the declared ontology IRI for `uri` from `workspace`. */
export function getOwl2OntologyIri(workspace: UnifiedWorkspace, uri: string): string | undefined {
  return getOwl2FileInfo(workspace, uri)?.ontologyIri;
}

/** Retrieves the `Import(<IRI>)` targets declared in `uri` from `workspace`. */
export function getOwl2Imports(workspace: UnifiedWorkspace, uri: string): string[] {
  return getOwl2FileInfo(workspace, uri)?.imports ?? [];
}

/**
 * Resolves an OWL 2 entity declaration across `fromUri` and its imported ontologies in `workspace`.
 */
export function resolveOwl2Entity(
  workspace: UnifiedWorkspace,
  iriOrName: string,
  fromUri?: string,
  visited = new Set<string>(),
): SymbolEntry | undefined {
  const allInfos = workspace.getAllParsedModels<Owl2FileInfo>("owl2Info");

  if (fromUri && !visited.has(fromUri)) {
    visited.add(fromUri);
    const info = allInfos.get(fromUri);
    if (info) {
      const local =
        info.classes.get(iriOrName) ||
        info.objectProperties.get(iriOrName) ||
        info.dataProperties.get(iriOrName) ||
        info.individuals.get(iriOrName);
      if (local) return local;

      const expanded = expandIri(iriOrName, info.prefixes);
      const expandedLocal =
        info.classes.get(expanded) ||
        info.objectProperties.get(expanded) ||
        info.dataProperties.get(expanded) ||
        info.individuals.get(expanded);
      if (expandedLocal) return expandedLocal;

      for (const entry of [
        ...info.classes.values(),
        ...info.objectProperties.values(),
        ...info.dataProperties.values(),
        ...info.individuals.values(),
      ]) {
        if (entry.name === iriOrName || entry.namePath === iriOrName) {
          return entry;
        }
      }

      for (const imp of info.imports) {
        for (const [otherUri, otherInfo] of allInfos.entries()) {
          if (otherUri === fromUri) continue;
          if (otherInfo.ontologyIri === imp || otherUri.endsWith(imp) || otherUri.endsWith(`/${imp}`)) {
            const res = resolveOwl2Entity(workspace, iriOrName, otherUri, visited);
            if (res) return res;
          }
        }
      }
    }
  }

  for (const info of allInfos.values()) {
    const match =
      info.classes.get(iriOrName) ||
      info.objectProperties.get(iriOrName) ||
      info.dataProperties.get(iriOrName) ||
      info.individuals.get(iriOrName);
    if (match) return match;

    for (const entry of [
      ...info.classes.values(),
      ...info.objectProperties.values(),
      ...info.dataProperties.values(),
      ...info.individuals.values(),
    ]) {
      if (entry.name === iriOrName || entry.namePath === iriOrName) {
        return entry;
      }
    }
  }

  return undefined;
}

function localXmlName(name: string): string {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function getXmlAttr(
  elem: XmlElement,
  nameLower: string,
): { value: string; valueStart: number; valueEnd: number } | undefined {
  for (const attr of elem.attributes) {
    if (attr.name.toLowerCase() === nameLower) {
      return { value: attr.value, valueStart: attr.valueStart, valueEnd: attr.valueEnd };
    }
  }
  return undefined;
}

function extractOwlXmlMetadata(
  root: XmlElement,
  prefixes: Map<string, string>,
  imports: string[],
): {
  ontologyIri?: string | undefined;
  ontologyNameRange?: { startOffset: number; endOffset: number } | undefined;
} {
  let ontologyIri: string | undefined;
  let ontologyNameRange: { startOffset: number; endOffset: number } | undefined;

  const stack: XmlElement[] = [root];
  while (stack.length > 0) {
    const elem = stack.pop()!;
    const tag = localXmlName(elem.name).toLowerCase();

    if (tag === "prefix") {
      const nameAttr = getXmlAttr(elem, "name");
      const iriAttr = getXmlAttr(elem, "iri");
      if (nameAttr !== undefined && iriAttr !== undefined) {
        const p = nameAttr.value;
        prefixes.set(p.endsWith(":") ? p : `${p}:`, iriAttr.value);
      }
    } else if (tag === "ontology" && !ontologyIri) {
      const iriAttr = getXmlAttr(elem, "ontologyiri") ?? getXmlAttr(elem, "rdf:about");
      if (iriAttr && iriAttr.value) {
        ontologyIri = iriAttr.value;
        ontologyNameRange = { startOffset: iriAttr.valueStart, endOffset: iriAttr.valueEnd };
      }
    } else if (tag === "import") {
      const target = extractIri(elem.text);
      if (target) imports.push(target);
    }

    for (let i = elem.children.length - 1; i >= 0; i--) {
      stack.push(elem.children[i]!);
    }
  }

  return { ontologyIri, ontologyNameRange };
}

function isPrefixNameChar(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || (ch >= 48 && ch <= 57) || ch === 95 || ch === 45;
}

function extractTurtlePrefixes(text: string, prefixes: Map<string, string>): void {
  const len = text.length;
  let i = 0;

  while (i < len) {
    const ch = text.charCodeAt(i);
    if (ch <= 32) {
      i++;
      continue;
    }
    if (ch === 35) {
      // '#' comment
      while (i < len && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++;
      continue;
    }
    if (ch === 34 || ch === 39) {
      // Skip string literals
      const quote = ch;
      i++;
      while (i < len) {
        const c = text.charCodeAt(i);
        if (c === 92) {
          i += 2;
          continue;
        }
        if (c === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    const rem7 = text.slice(i, i + 7).toLowerCase();
    const rem6 = text.slice(i, i + 6).toLowerCase();
    let advance = 0;
    if (rem7 === "@prefix" && (i + 7 >= len || text.charCodeAt(i + 7) <= 32)) {
      advance = 7;
    } else if (
      rem6 === "prefix" &&
      (i === 0 || text.charCodeAt(i - 1) <= 32) &&
      (i + 6 >= len || text.charCodeAt(i + 6) <= 32)
    ) {
      advance = 6;
    }

    if (advance > 0) {
      let j = i + advance;
      while (j < len && text.charCodeAt(j) <= 32) j++;
      const pfxStart = j;
      while (j < len && isPrefixNameChar(text.charCodeAt(j))) j++;
      if (j < len && text.charCodeAt(j) === 58) {
        // ':'
        const pfx = text.slice(pfxStart, j + 1);
        j++;
        while (j < len && text.charCodeAt(j) <= 32) j++;
        if (j < len && text.charCodeAt(j) === 60) {
          // '<'
          const iriStart = j + 1;
          let iriEnd = iriStart;
          while (iriEnd < len) {
            const c = text.charCodeAt(iriEnd);
            if (c === 62 || c === 60 || c <= 32) break;
            iriEnd++;
          }
          if (iriEnd < len && text.charCodeAt(iriEnd) === 62) {
            prefixes.set(pfx, text.slice(iriStart, iriEnd));
            i = iriEnd + 1;
            continue;
          }
        }
      }
    }

    i++;
  }
}

function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text.charCodeAt(i) === 40) depth++;
    else if (text.charCodeAt(i) === 41) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractIri(raw: string): string {
  const clean = raw.trim();
  if (clean.startsWith("<") && clean.endsWith(">")) {
    return clean.slice(1, -1);
  }
  return clean;
}

function parseEntityDeclaration(
  inner: string,
): { kind: "Class" | "ObjectProperty" | "DataProperty" | "Individual"; iri: string } | null {
  const openParen = inner.indexOf("(");
  const closeParen = inner.lastIndexOf(")");
  if (openParen === -1 || closeParen === -1) return null;

  const entityType = inner.slice(0, openParen).trim();
  const iri = extractIri(inner.slice(openParen + 1, closeParen).trim());

  if (entityType === "Class") return { kind: "Class", iri };
  if (entityType === "ObjectProperty") return { kind: "ObjectProperty", iri };
  if (entityType === "DataProperty") return { kind: "DataProperty", iri };
  if (entityType === "NamedIndividual") return { kind: "Individual", iri };

  return null;
}

function expandIri(rawIri: string, prefixes: ReadonlyMap<string, string>): string {
  const clean = extractIri(rawIri);
  const colonIdx = clean.indexOf(":");
  if (colonIdx !== -1 && !clean.includes("//")) {
    const pfx = clean.slice(0, colonIdx + 1);
    const local = clean.slice(colonIdx + 1);
    const base = prefixes.get(pfx);
    if (base) return `${base}${local}`;
  }
  return clean;
}

function getShortName(iri: string): string {
  const clean = extractIri(iri);
  const hashIdx = clean.lastIndexOf("#");
  if (hashIdx !== -1 && hashIdx < clean.length - 1) return clean.slice(hashIdx + 1);
  const slashIdx = clean.lastIndexOf("/");
  if (slashIdx !== -1 && slashIdx < clean.length - 1) return clean.slice(slashIdx + 1);
  const colonIdx = clean.indexOf(":");
  if (colonIdx !== -1 && !clean.includes("//")) return clean.slice(colonIdx + 1);
  return clean;
}
