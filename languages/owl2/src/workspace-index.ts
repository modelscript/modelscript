// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";

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
 * Multi-File Workspace Indexer for OWL 2 Functional-Style Syntax ontologies (.owl, .ofn, .owx, .ttl).
 *
 * Implements IWorkspaceIndex tracking document versions, structural revisions,
 * declared entity IRIs (Class, ObjectProperty, DataProperty, NamedIndividual),
 * and inter-ontology `Import(<IRI>)` dependencies.
 */
export class Owl2WorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private _structuralRevision = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileInfos = new Map<string, Owl2FileInfo>();
  private fileBaseIds = new Map<string, number>();
  private nextFileSlot = 1;

  get version(): number {
    return this._version;
  }

  get structuralRevision(): number {
    return this._structuralRevision;
  }

  get fileCount(): number {
    return this.fileIndices.size;
  }

  public has(uri: string): boolean {
    return this.fileIndices.has(uri);
  }

  public getFileIndex(uri: string): SymbolIndex | undefined {
    return this.fileIndices.get(uri);
  }

  public getFileInfo(uri: string): Owl2FileInfo | undefined {
    return this.fileInfos.get(uri);
  }

  public getOntologyIri(uri: string): string | undefined {
    return this.fileInfos.get(uri)?.ontologyIri;
  }

  public getImports(uri: string): string[] {
    return this.fileInfos.get(uri)?.imports ?? [];
  }

  public register(uri: string, _loader?: () => any): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: () => any): void {
    this._version++;
    if (loader) {
      try {
        const res = loader();
        const text = typeof res === "string" ? res : (res?.sourceText ?? res?.text);
        if (typeof text === "string") {
          this.indexFile(uri, text);
        }
      } catch {
        // incremental guard
      }
    }
  }

  /**
   * Parses an OWL 2 Functional-Style Syntax document and indexes all prefixes,
   * ontology declaration, imports, and entity declarations.
   */
  public indexFile(uri: string, text: string): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    let baseId = this.fileBaseIds.get(uri);
    if (baseId === undefined) {
      baseId = this.nextFileSlot++ * 100_000;
      this.fileBaseIds.set(uri, baseId);
    }
    let idCounter = baseId;

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

    // Root Ontology Symbol
    const rootId = idCounter++ as SymbolId;
    const fileName = uri.split("/").pop() || uri;

    const childIds: SymbolId[] = [];

    // Parse functional-style syntax declarations using stateful scanner
    let i = 0;
    const len = text.length;

    while (i < len) {
      if (text.charCodeAt(i) <= 32) {
        i++;
        continue;
      }

      // Line comment (# or //)
      if (text.charCodeAt(i) === 35 || (text.charCodeAt(i) === 47 && text.charCodeAt(i + 1) === 47)) {
        while (i < len && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++;
        continue;
      }

      // Prefix(prefix: = <IRI>)
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

      // Ontology(<IRI> ...
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

      // Import(<IRI>)
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

      // Declaration(Class(<IRI>))
      // Declaration(ObjectProperty(<IRI>))
      // Declaration(DataProperty(<IRI>))
      // Declaration(NamedIndividual(<IRI>))
      if (text.startsWith("Declaration", i) && text.charCodeAt(i + 11) === 40) {
        const start = i;
        const closeParen = findMatchingParen(text, i + 11);
        if (closeParen !== -1) {
          const inner = text.slice(i + 12, closeParen).trim();
          const kindMatch = parseEntityDeclaration(inner);
          if (kindMatch) {
            const symId = idCounter++ as SymbolId;
            const fullIri = expandIri(kindMatch.iri, prefixes);
            const shortName = getShortName(kindMatch.iri);

            const entry: SymbolEntry = {
              id: symId,
              name: shortName,
              kind: kindMatch.kind,
              ruleName: `owl2_${kindMatch.kind.toLowerCase()}`,
              namePath: fullIri,
              fieldName: null,
              parentId: rootId,
              startOffset: start,
              endOffset: closeParen + 1,
              exports: [],
              inherits: [],
              language: "owl2",
              metadata: {},
            };

            symbols.set(symId, entry);

            // Index by short name, full IRI, and prefixed IRI
            for (const key of [shortName, fullIri, kindMatch.iri]) {
              const list = byName.get(key) || [];
              list.push(symId);
              byName.set(key, list);
            }

            childIds.push(symId);

            if (kindMatch.kind === "Class") classes.set(fullIri, entry);
            else if (kindMatch.kind === "ObjectProperty") objectProperties.set(fullIri, entry);
            else if (kindMatch.kind === "DataProperty") dataProperties.set(fullIri, entry);
            else if (kindMatch.kind === "Individual") individuals.set(fullIri, entry);
          }
          i = closeParen + 1;
          continue;
        }
      }

      i++;
    }

    const ontName = ontologyIri ? getShortName(ontologyIri) : fileName;
    const rootEntry: SymbolEntry = {
      id: rootId,
      name: ontName,
      kind: "Class",
      ruleName: "owl2_ontology",
      namePath: ontologyIri || fileName,
      fieldName: null,
      parentId: null,
      startOffset: 0,
      endOffset: text.length,
      exports: [],
      inherits: [],
      language: "owl2",
      metadata: {},
    };
    symbols.set(rootId, rootEntry);
    byName.set(ontName, [rootId]);
    if (ontologyIri) byName.set(ontologyIri, [rootId]);
    childrenOf.set(null, [rootId]);
    childrenOf.set(rootId, childIds);

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    this.fileInfos.set(uri, {
      uri,
      ontologyIri,
      prefixes,
      classes,
      objectProperties,
      dataProperties,
      individuals,
      imports,
      index,
    });

    this._structuralRevision++;
    return index;
  }

  public toSymbolIndex(): SymbolIndex {
    return this.toUnified();
  }

  public toUnified(): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    const rootChildren: SymbolId[] = [];

    for (const fileIdx of this.fileIndices.values()) {
      for (const [id, entry] of fileIdx.symbols.entries()) {
        symbols.set(id, entry);
        if (entry.parentId === null) {
          rootChildren.push(id);
        }
      }
      for (const [name, ids] of fileIdx.byName.entries()) {
        const existing = byName.get(name) || [];
        existing.push(...ids);
        byName.set(name, existing);
      }
      for (const [parentId, ids] of fileIdx.childrenOf.entries()) {
        if (parentId !== null) {
          const existing = childrenOf.get(parentId) || [];
          existing.push(...ids);
          childrenOf.set(parentId, existing);
        }
      }
    }

    childrenOf.set(null, rootChildren);
    return { symbols, byName, childrenOf };
  }

  public async toUnifiedAsync(): Promise<SymbolIndex> {
    return this.toUnified();
  }

  public toUnifiedPartial(): SymbolIndex {
    return this.toUnified();
  }

  public getSkeletonIndex(): SymbolIndex {
    return this.toUnified();
  }

  /**
   * Resolves an entity declaration across imported ontologies.
   */
  public resolveEntity(iriOrName: string, fromUri?: string): SymbolEntry | undefined {
    // 1. Direct match in fromUri if provided
    if (fromUri) {
      const info = this.fileInfos.get(fromUri);
      if (info) {
        const local =
          info.classes.get(iriOrName) ||
          info.objectProperties.get(iriOrName) ||
          info.dataProperties.get(iriOrName) ||
          info.individuals.get(iriOrName);
        if (local) return local;

        // Try expanding if it is an abbreviated IRI
        const expanded = expandIri(iriOrName, info.prefixes);
        const expandedLocal =
          info.classes.get(expanded) ||
          info.objectProperties.get(expanded) ||
          info.dataProperties.get(expanded) ||
          info.individuals.get(expanded);
        if (expandedLocal) return expandedLocal;

        // Check imported ontologies
        for (const imp of info.imports) {
          for (const [otherUri, otherInfo] of this.fileInfos.entries()) {
            if (otherUri === fromUri) continue;
            if (otherInfo.ontologyIri === imp || otherUri.endsWith(imp) || otherUri.endsWith(`/${imp}`)) {
              const res = this.resolveEntity(iriOrName, otherUri);
              if (res) return res;
            }
          }
        }
      }
    }

    // 2. Global search across all indexed files
    for (const info of this.fileInfos.values()) {
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
