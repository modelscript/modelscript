// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import {
  createArrayTripleSource,
  executeSparqlQuery,
  type GenericSyntaxNode,
  type SparqlAskResult,
  type SparqlExecutionResult,
  type SparqlGraphResult,
  type SparqlQuad,
  type SparqlSelectResult,
  type SparqlTerm,
} from "@modelscript/sparql";
import {
  buildOwl2WorkbenchModel,
  shortOwlLabel,
  type Owl2EntityKind,
  type Owl2WorkbenchModel,
} from "./ui/owl2-workbench-model.js";

export const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
export const OWL_NS = "http://www.w3.org/2002/07/owl#";
export const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
export const DEFAULT_ONTO_BASE = "http://example.org/ontology#";

export const RDF_TYPE = `${RDF_NS}type`;
export const RDFS_SUBCLASS_OF = `${RDFS_NS}subClassOf`;
export const RDFS_SUBPROPERTY_OF = `${RDFS_NS}subPropertyOf`;
export const RDFS_DOMAIN = `${RDFS_NS}domain`;
export const RDFS_RANGE = `${RDFS_NS}range`;
export const OWL_CLASS = `${OWL_NS}Class`;
export const OWL_THING = `${OWL_NS}Thing`;
export const OWL_NOTHING = `${OWL_NS}Nothing`;
export const OWL_OBJ_PROP = `${OWL_NS}ObjectProperty`;
export const OWL_DATA_PROP = `${OWL_NS}DatatypeProperty`;
export const OWL_NAMED_IND = `${OWL_NS}NamedIndividual`;
export const OWL_DISJOINT_WITH = `${OWL_NS}disjointWith`;
export const OWL_EQUIVALENT_CLASS = `${OWL_NS}equivalentClass`;
export const OWL_INVERSE_OF = `${OWL_NS}inverseOf`;
export const OWL_SAME_AS = `${OWL_NS}sameAs`;
export const OWL_DIFFERENT_FROM = `${OWL_NS}differentFrom`;

export interface SparqlParserLike {
  parse(text: string): { rootNode: GenericSyntaxNode };
}

export interface MaterializedTripleRow {
  subject: string;
  predicate: string;
  object: string;
  objectType: "uri" | "literal";
  datatype?: string | undefined;
  inferred: boolean;
}

export interface MaterializedOwl2Kb {
  baseIri: string;
  prefixes: Record<string, string>;
  quads: SparqlQuad[];
  triples: MaterializedTripleRow[];
  inferredTripleKeys: Set<string>;
}

export interface KgNode {
  id: string;
  label: string;
  kind: Owl2EntityKind | "Literal" | "External";
  unsatisfiable?: boolean | undefined;
  line?: number | undefined;
}

export interface KgEdge {
  id: string;
  source: string;
  target: string;
  predicate: string;
  label: string;
  inferred: boolean;
}

export interface KgSubgraph {
  nodes: KgNode[];
  edges: KgEdge[];
}

export interface Owl2SparqlExecutionOutput {
  queryType: "SELECT" | "ASK" | "CONSTRUCT" | "DESCRIBE";
  executionTimeMs: number;
  variables: string[];
  rows: Array<
    Record<string, { value: string; label: string; type: "uri" | "literal" | "bnode"; datatype?: string | undefined }>
  >;
  boolean?: boolean | undefined;
  triples: MaterializedTripleRow[];
  graph: KgSubgraph;
  rawResult: SparqlExecutionResult;
  formattedSummary: string;
}

function normalizeBaseIri(ontologyIri?: string): string {
  if (!ontologyIri) return DEFAULT_ONTO_BASE;
  const trimmed = ontologyIri.trim().replace(/^<|>$/g, "");
  if (!trimmed) return DEFAULT_ONTO_BASE;
  if (trimmed.endsWith("#") || trimmed.endsWith("/")) return trimmed;
  return `${trimmed}#`;
}

export function expandTermToFullIri(raw: string, baseIri: string): string {
  const s = raw.trim().replace(/^<|>$/g, "");
  if (!s) return `${baseIri}Unknown`;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s;
  if (s.startsWith(":")) return `${baseIri}${s.slice(1)}`;
  if (s.startsWith("rdf:")) return `${RDF_NS}${s.slice(4)}`;
  if (s.startsWith("rdfs:")) return `${RDFS_NS}${s.slice(5)}`;
  if (s.startsWith("owl:")) return `${OWL_NS}${s.slice(4)}`;
  if (s.startsWith("xsd:")) return `${XSD_NS}${s.slice(4)}`;
  const colonIdx = s.indexOf(":");
  if (colonIdx > 0) {
    return `${baseIri}${s.slice(colonIdx + 1)}`;
  }
  return `${baseIri}${s}`;
}

function tripleKey(s: string, p: string, o: string): string {
  return `${s}\u0000${p}\u0000${o}`;
}

function parseLiteralValue(raw: string): { value: string; datatype?: string | undefined } {
  const m = /^"([\s\S]*)"(?:\^\^([^\s]+))?$/.exec(raw.trim());
  if (m) {
    const val = m[1]!;
    const dt = m[2] ? expandTermToFullIri(m[2], DEFAULT_ONTO_BASE) : undefined;
    return { value: val, datatype: dt };
  }
  if (/^[+-]?\d+$/.test(raw.trim())) {
    return { value: raw.trim(), datatype: `${XSD_NS}integer` };
  }
  if (/^[+-]?\d+\.\d+(?:[eE][+-]?\d+)?$/.test(raw.trim())) {
    return { value: raw.trim(), datatype: `${XSD_NS}double` };
  }
  if (raw.trim() === "true" || raw.trim() === "false") {
    return { value: raw.trim(), datatype: `${XSD_NS}boolean` };
  }
  return { value: raw.trim() };
}

/**
 * Materializes a reasoned `Owl2WorkbenchModel` (both asserted and inferred facts)
 * into W3C RDF/OWL 2 `SparqlQuad[]` ready for `@modelscript/sparql`.
 */
export function materializeOwl2KnowledgeBase(
  model: Owl2WorkbenchModel,
  options: { includeInferred?: boolean | undefined } = {},
): MaterializedOwl2Kb {
  const includeInferred = options.includeInferred ?? true;
  const baseIri = normalizeBaseIri(model.ontologyIri);
  const prefixes: Record<string, string> = {
    "": baseIri,
    rdf: RDF_NS,
    rdfs: RDFS_NS,
    owl: OWL_NS,
    xsd: XSD_NS,
  };

  const quads: SparqlQuad[] = [];
  const triples: MaterializedTripleRow[] = [];
  const seen = new Map<string, boolean>(); // key -> asserted(false) or inferred(true)
  const inferredTripleKeys = new Set<string>();

  const addUriTriple = (sRaw: string, pFull: string, oRaw: string, inferred: boolean) => {
    if (inferred && !includeInferred) return;
    const s = expandTermToFullIri(sRaw, baseIri);
    const p = expandTermToFullIri(pFull, baseIri);
    const o = expandTermToFullIri(oRaw, baseIri);
    const key = tripleKey(s, p, o);
    const prev = seen.get(key);
    if (prev !== undefined) {
      // Asserted takes precedence over inferred if both occur
      if (!inferred && prev) {
        seen.set(key, false);
        inferredTripleKeys.delete(key);
        const existing = triples.find((t) => t.subject === s && t.predicate === p && t.object === o);
        if (existing) existing.inferred = false;
      }
      return;
    }
    seen.set(key, inferred);
    if (inferred) inferredTripleKeys.add(key);
    quads.push({
      subject: { termType: "NamedNode", value: s },
      predicate: { termType: "NamedNode", value: p },
      object: { termType: "NamedNode", value: o },
    });
    triples.push({ subject: s, predicate: p, object: o, objectType: "uri", inferred });
  };

  const addLitTriple = (sRaw: string, pFull: string, rawLiteral: string, inferred: boolean) => {
    if (inferred && !includeInferred) return;
    const s = expandTermToFullIri(sRaw, baseIri);
    const p = expandTermToFullIri(pFull, baseIri);
    const parsed = parseLiteralValue(rawLiteral);
    const key = tripleKey(s, p, `"${parsed.value}"`);
    if (seen.has(key)) return;
    seen.set(key, inferred);
    if (inferred) inferredTripleKeys.add(key);
    quads.push({
      subject: { termType: "NamedNode", value: s },
      predicate: { termType: "NamedNode", value: p },
      object: {
        termType: "Literal",
        value: parsed.value,
        ...(parsed.datatype ? { datatype: parsed.datatype } : {}),
      },
    });
    triples.push({
      subject: s,
      predicate: p,
      object: parsed.value,
      objectType: "literal",
      datatype: parsed.datatype,
      inferred,
    });
  };

  // Classes
  for (const cls of model.classes.values()) {
    addUriTriple(cls.iri, RDF_TYPE, OWL_CLASS, false);
    for (const sup of cls.assertedSuperClasses) {
      addUriTriple(cls.iri, RDFS_SUBCLASS_OF, sup, false);
    }
    for (const sup of cls.inferredSuperClasses) {
      addUriTriple(cls.iri, RDFS_SUBCLASS_OF, sup, true);
    }
    for (const disj of cls.disjointWith) {
      addUriTriple(cls.iri, OWL_DISJOINT_WITH, disj, false);
    }
    if (cls.unsatisfiable) {
      addUriTriple(cls.iri, OWL_EQUIVALENT_CLASS, OWL_NOTHING, true);
    }
  }

  // Properties
  for (const prop of model.properties.values()) {
    addUriTriple(prop.iri, RDF_TYPE, prop.kind === "ObjectProperty" ? OWL_OBJ_PROP : OWL_DATA_PROP, false);
    for (const ch of prop.characteristics) {
      addUriTriple(prop.iri, RDF_TYPE, `${OWL_NS}${ch}Property`, false);
    }
    for (const sp of prop.superProperties) {
      addUriTriple(prop.iri, RDFS_SUBPROPERTY_OF, sp, false);
    }
    for (const inv of prop.inverseOf) {
      addUriTriple(prop.iri, OWL_INVERSE_OF, inv, false);
    }
    for (const d of prop.domains) {
      if (!d.includes(" ") && !d.includes("(")) {
        addUriTriple(prop.iri, RDFS_DOMAIN, d, false);
      }
    }
    for (const r of prop.ranges) {
      if (!r.includes(" ") && !r.includes("(")) {
        addUriTriple(prop.iri, RDFS_RANGE, r, false);
      }
    }
  }

  // Individuals & ABox (Asserted + Inferred)
  for (const ind of model.individuals.values()) {
    addUriTriple(ind.iri, RDF_TYPE, OWL_NAMED_IND, false);
    for (const t of ind.assertedTypes) {
      addUriTriple(ind.iri, RDF_TYPE, t, false);
    }
    for (const t of ind.inferredTypes) {
      addUriTriple(ind.iri, RDF_TYPE, t, true);
    }
    for (const ra of ind.assertedRoleAssertions) {
      addUriTriple(ind.iri, ra.property, ra.target, false);
    }
    for (const ra of ind.inferredRoleAssertions) {
      addUriTriple(ind.iri, ra.property, ra.target, true);
    }
    for (const da of ind.dataAssertions) {
      addLitTriple(ind.iri, da.property, da.value, false);
    }
    for (const same of ind.sameAs) {
      addUriTriple(ind.iri, OWL_SAME_AS, same, true);
    }
    for (const diff of ind.differentFrom) {
      addUriTriple(ind.iri, OWL_DIFFERENT_FROM, diff, false);
    }
  }

  return { baseIri, prefixes, quads, triples, inferredTripleKeys };
}

/**
 * Converts a list of RDF triples into a Cytoscape-style Knowledge Graph (`KgNode[]`, `KgEdge[]`),
 * enriching nodes with OWL 2 entity kind, satisfiability, and source line numbers.
 */
export function buildKnowledgeGraphFromTriples(
  triples: readonly MaterializedTripleRow[],
  model: Owl2WorkbenchModel,
  baseIri: string,
  options: { includeMetaTriples?: boolean | undefined; includeLiterals?: boolean | undefined } = {},
): KgSubgraph {
  const includeMeta = options.includeMetaTriples ?? false;
  const includeLiterals = options.includeLiterals ?? true;

  const fullIriToEntity = new Map<string, { kind: Owl2EntityKind; unsatisfiable?: boolean; line?: number }>();
  for (const c of model.classes.values()) {
    fullIriToEntity.set(expandTermToFullIri(c.iri, baseIri), {
      kind: "Class",
      unsatisfiable: c.unsatisfiable,
      line: c.line,
    });
  }
  for (const p of model.properties.values()) {
    fullIriToEntity.set(expandTermToFullIri(p.iri, baseIri), {
      kind: p.kind,
      line: p.line,
    });
  }
  for (const i of model.individuals.values()) {
    fullIriToEntity.set(expandTermToFullIri(i.iri, baseIri), {
      kind: "Individual",
      line: i.line,
    });
  }

  const metaObjects = new Set([OWL_CLASS, OWL_OBJ_PROP, OWL_DATA_PROP, OWL_NAMED_IND, OWL_THING]);

  const nodesMap = new Map<string, KgNode>();
  const edges: KgEdge[] = [];

  const ensureNode = (id: string, isLiteral = false): KgNode => {
    const existing = nodesMap.get(id);
    if (existing) return existing;
    if (isLiteral) {
      const node: KgNode = { id, label: id.length > 24 ? `${id.slice(0, 23)}…` : id, kind: "Literal" };
      nodesMap.set(id, node);
      return node;
    }
    const meta = fullIriToEntity.get(id);
    const node: KgNode = {
      id,
      label: shortOwlLabel(id),
      kind: meta?.kind ?? "External",
      unsatisfiable: meta?.unsatisfiable,
      line: meta?.line,
    };
    nodesMap.set(id, node);
    return node;
  };

  for (let i = 0; i < triples.length; i++) {
    const t = triples[i]!;
    if (!includeLiterals && t.objectType === "literal") continue;
    if (!includeMeta && t.predicate === RDF_TYPE && (metaObjects.has(t.object) || t.object.startsWith(OWL_NS))) {
      continue;
    }

    ensureNode(t.subject, false);
    const targetId = t.objectType === "literal" ? `lit:${t.subject}:${t.predicate}:${t.object}` : t.object;
    if (t.objectType === "literal") {
      if (!nodesMap.has(targetId)) {
        nodesMap.set(targetId, {
          id: targetId,
          label: `"${t.object}"`,
          kind: "Literal",
        });
      }
    } else {
      ensureNode(targetId, false);
    }

    const predLabel =
      t.predicate === RDF_TYPE
        ? "a"
        : t.predicate === RDFS_SUBCLASS_OF
          ? "subClassOf"
          : t.predicate === RDFS_SUBPROPERTY_OF
            ? "subPropertyOf"
            : shortOwlLabel(t.predicate);

    edges.push({
      id: `e:${i}:${t.subject}:${t.predicate}:${targetId}`,
      source: t.subject,
      target: targetId,
      predicate: t.predicate,
      label: predLabel,
      inferred: t.inferred,
    });
  }

  return {
    nodes: Array.from(nodesMap.values()),
    edges,
  };
}

let cachedSparqlParserPromise: Promise<SparqlParserLike> | null = null;

/**
 * Loads the native `@modelscript/sparql` WASM GLR parser in both Node and Browser environments.
 */
export async function loadSparqlWasmParser(): Promise<SparqlParserLike> {
  if (cachedSparqlParserPromise) return cachedSparqlParserPromise;

  const promise: Promise<SparqlParserLike> = (async () => {
    const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);
    if (isNode) {
      const { createRequire } = await import("node:module");
      const req = createRequire(import.meta.url);
      const wasmPath = req.resolve("@modelscript/sparql/parser.wasm");
      const { parser } = await createWasmParser(wasmPath);
      return parser as unknown as SparqlParserLike;
    }

    // Browser environment: try Ansatz/Vite served WASM endpoints
    const candidateUrls = ["/lsp/server/dist/sparql.wasm", "/lsp/wasm/sparql.wasm", "/wasm/sparql.wasm"];
    let lastErr: unknown;
    for (const url of candidateUrls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        const header = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
        // Skip SPA HTML fallbacks (e.g., <!doctype html>) by verifying WASM magic bytes (\0asm)
        if (header.length < 4 || header[0] !== 0x00 || header[1] !== 0x61 || header[2] !== 0x73 || header[3] !== 0x6d) {
          lastErr = new Error(`Non-WASM response from ${url}`);
          continue;
        }
        const { parser } = await createWasmParser(buf);
        return parser as unknown as SparqlParserLike;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(
      `Unable to load @modelscript/sparql WASM parser (${lastErr instanceof Error ? lastErr.message : String(lastErr)})`,
    );
  })();

  cachedSparqlParserPromise = promise;
  try {
    return await promise;
  } catch (err) {
    cachedSparqlParserPromise = null;
    throw err;
  }
}

/**
 * Auto-prepends missing standard PREFIX declarations (`:`, `rdf:`, `rdfs:`, `owl:`, `xsd:`)
 * so users can run concise SPARQL 1.1 queries directly against the active ontology.
 */
export function prepareSparqlWithDefaultPrefixes(queryText: string, prefixes: Record<string, string>): string {
  const lines: string[] = [];
  for (const [prefix, iri] of Object.entries(prefixes)) {
    const re = new RegExp(`\\bPREFIX\\s+${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "i");
    if (!re.test(queryText)) {
      lines.push(`PREFIX ${prefix}: <${iri}>`);
    }
  }
  return lines.length > 0 ? `${lines.join("\n")}\n${queryText}` : queryText;
}

function formatTermCell(term: Exclude<SparqlTerm, { termType: "Variable" }>): {
  value: string;
  label: string;
  type: "uri" | "literal" | "bnode";
  datatype?: string | undefined;
} {
  if (term.termType === "NamedNode") {
    return { value: term.value, label: shortOwlLabel(term.value), type: "uri" };
  }
  if (term.termType === "Literal") {
    return { value: term.value, label: term.value, type: "literal", datatype: term.datatype };
  }
  return { value: term.value, label: term.value, type: "bnode" };
}

/**
 * Executes a full SPARQL 1.1 query (`SELECT`, `ASK`, `CONSTRUCT`, `DESCRIBE`) via
 * `@modelscript/sparql` against the reasoned OWL 2 knowledge base (asserted + inferred facts).
 */
export async function executeOwl2SparqlQuery(
  modelOrSource: Owl2WorkbenchModel | string,
  queryText: string,
  options: {
    includeInferred?: boolean | undefined;
    parser?: SparqlParserLike | undefined;
  } = {},
): Promise<Owl2SparqlExecutionOutput> {
  const model = typeof modelOrSource === "string" ? buildOwl2WorkbenchModel(modelOrSource) : modelOrSource;
  const kb = materializeOwl2KnowledgeBase(model, { includeInferred: options.includeInferred ?? true });
  const source = createArrayTripleSource(kb.quads);
  const parser = options.parser ?? (await loadSparqlWasmParser());
  const prepared = prepareSparqlWithDefaultPrefixes(queryText.trim(), kb.prefixes);
  const rawResult = executeSparqlQuery(parser, prepared, source);

  if (rawResult.queryType === "ASK") {
    const askRes = rawResult as SparqlAskResult;
    return {
      queryType: "ASK",
      executionTimeMs: askRes.executionTimeMs,
      variables: ["result"],
      rows: [{ result: { value: String(askRes.boolean), label: askRes.boolean ? "true" : "false", type: "literal" } }],
      boolean: askRes.boolean,
      triples: [],
      graph: { nodes: [], edges: [] },
      rawResult,
      formattedSummary: `ASK → ${askRes.boolean ? "true ✓" : "false ✗"} (${askRes.executionTimeMs.toFixed(1)}ms)`,
    };
  }

  if (rawResult.queryType === "CONSTRUCT" || rawResult.queryType === "DESCRIBE") {
    const graphRes = rawResult as SparqlGraphResult;
    const outTriples: MaterializedTripleRow[] = graphRes.quads.map((q) => {
      const objVal = q.object.value;
      const key = tripleKey(
        q.subject.value,
        q.predicate.value,
        q.object.termType === "Literal" ? `"${objVal}"` : objVal,
      );
      return {
        subject: q.subject.value,
        predicate: q.predicate.value,
        object: objVal,
        objectType: q.object.termType === "Literal" ? "literal" : "uri",
        datatype: q.object.termType === "Literal" ? q.object.datatype : undefined,
        inferred: kb.inferredTripleKeys.has(key),
      };
    });
    const rows = outTriples.map((t) => ({
      subject: { value: t.subject, label: shortOwlLabel(t.subject), type: "uri" as const },
      predicate: { value: t.predicate, label: shortOwlLabel(t.predicate), type: "uri" as const },
      object: {
        value: t.object,
        label: t.objectType === "uri" ? shortOwlLabel(t.object) : t.object,
        type: t.objectType,
        datatype: t.datatype,
      },
    }));
    const graph = buildKnowledgeGraphFromTriples(outTriples, model, kb.baseIri, { includeMetaTriples: true });
    return {
      queryType: rawResult.queryType,
      executionTimeMs: graphRes.executionTimeMs,
      variables: ["subject", "predicate", "object"],
      rows,
      triples: outTriples,
      graph,
      rawResult,
      formattedSummary: `${rawResult.queryType} returned ${outTriples.length} triple(s) in ${graphRes.executionTimeMs.toFixed(1)}ms.`,
    };
  }

  // SELECT
  const selectRes = rawResult as SparqlSelectResult;
  const rows = selectRes.bindings.map((b) => {
    const row: Record<
      string,
      { value: string; label: string; type: "uri" | "literal" | "bnode"; datatype?: string | undefined }
    > = {};
    for (const v of selectRes.variables) {
      const term = b[v];
      if (term) row[v] = formatTermCell(term);
    }
    return row;
  });

  // Extract a subgraph from SELECT bindings:
  // 1) If variables look like (s, p, o) or 3+ terms matching triples in KB, use those triples.
  // 2) Otherwise project all KB triples connecting any two bound URIs (or pair adjacent URI columns).
  const boundUris = new Set<string>();
  for (const r of rows) {
    for (const cell of Object.values(r)) {
      if (cell.type === "uri") boundUris.add(cell.value);
    }
  }
  let matchedTriples = kb.triples.filter(
    (t) => boundUris.has(t.subject) && (t.objectType === "uri" ? boundUris.has(t.object) : false),
  );
  if (matchedTriples.length === 0 && selectRes.variables.length >= 2) {
    const v0 = selectRes.variables[0]!;
    const v1 = selectRes.variables[1]!;
    const v2 = selectRes.variables[2];
    matchedTriples = [];
    for (const r of rows.slice(0, 150)) {
      const c0 = r[v0];
      const c1 = r[v1];
      const c2 = v2 ? r[v2] : undefined;
      if (c0 && c1 && c2 && c0.type === "uri" && c1.type === "uri") {
        const key = tripleKey(c0.value, c1.value, c2.type === "literal" ? `"${c2.value}"` : c2.value);
        matchedTriples.push({
          subject: c0.value,
          predicate: c1.value,
          object: c2.value,
          objectType: c2.type === "literal" ? "literal" : "uri",
          datatype: c2.datatype,
          inferred: kb.inferredTripleKeys.has(key),
        });
      } else if (c0 && c1 && c0.type === "uri") {
        matchedTriples.push({
          subject: c0.value,
          predicate: `${kb.baseIri}${v1}`,
          object: c1.value,
          objectType: c1.type === "literal" ? "literal" : "uri",
          datatype: c1.datatype,
          inferred: false,
        });
      }
    }
  }
  const graph = buildKnowledgeGraphFromTriples(matchedTriples.slice(0, 250), model, kb.baseIri, {
    includeMetaTriples: false,
  });

  return {
    queryType: "SELECT",
    executionTimeMs: selectRes.executionTimeMs,
    variables: selectRes.variables,
    rows,
    triples: matchedTriples,
    graph,
    rawResult,
    formattedSummary: `SELECT returned ${rows.length} row(s) (${selectRes.variables.length} column(s)) in ${selectRes.executionTimeMs.toFixed(1)}ms.`,
  };
}
