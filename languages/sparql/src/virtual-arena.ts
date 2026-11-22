// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SparqlTerm } from "./ast.js";
import type { SparqlQuad, SparqlTripleSource } from "./engine.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
const XSD_INT = "http://www.w3.org/2001/XMLSchema#integer";

/** Canonical ModelScript compiler-arena RDF vocabulary IRIs. */
export const MS_VOCAB = {
  NS: "https://modelscript.org/vocab#",
  Symbol: "https://modelscript.org/vocab#Symbol",
  Class: "https://modelscript.org/vocab#Class",
  Component: "https://modelscript.org/vocab#Component",
  Variable: "https://modelscript.org/vocab#Variable",
  Equation: "https://modelscript.org/vocab#Equation",
  name: "https://modelscript.org/vocab#name",
  qualifiedName: "https://modelscript.org/vocab#qualifiedName",
  kind: "https://modelscript.org/vocab#kind",
  parent: "https://modelscript.org/vocab#parent",
  typeName: "https://modelscript.org/vocab#typeName",
  sourceUri: "https://modelscript.org/vocab#sourceUri",
  variability: "https://modelscript.org/vocab#variability",
  causality: "https://modelscript.org/vocab#causality",
  startOffset: "https://modelscript.org/vocab#startOffset",
  endOffset: "https://modelscript.org/vocab#endOffset",
} as const;

export interface VirtualSymbolEntryLike {
  readonly id: number | string;
  readonly name: string;
  readonly kind: string;
  readonly parentId?: number | string | null | undefined;
  readonly typeName?: string | undefined;
  readonly qualifiedName?: string | undefined;
  readonly uri?: string | undefined;
  readonly startOffset?: number | undefined;
  readonly endOffset?: number | undefined;
}

export interface VirtualSymbolIndexLike {
  readonly symbols: ReadonlyMap<number | string, VirtualSymbolEntryLike>;
  readonly byName?: ReadonlyMap<string, readonly (number | string)[]> | undefined;
  readonly childrenOf?: ReadonlyMap<number | string | null, readonly (number | string)[]> | undefined;
}

export interface VirtualDaeVariableLike {
  readonly name: string;
  readonly typeName?: string | undefined;
  readonly variability?: string | undefined;
  readonly causality?: string | undefined;
}

export interface VirtualDaeLike {
  readonly variables: readonly VirtualDaeVariableLike[];
  readonly equationCount?: number | undefined;
}

function matchObj(
  candidate: Exclude<SparqlTerm, { termType: "Variable" }>,
  filter: Exclude<SparqlTerm, { termType: "Variable" }> | null | undefined,
): boolean {
  if (!filter) return true;
  if (candidate.termType !== filter.termType) return false;
  return candidate.value === filter.value;
}

/**
 * Exposes a ModelScript compiler `SymbolIndex` (from any of the 104 supported languages)
 * as a zero-copy, zero-ETL virtual `SparqlTripleSource`.
 */
export function createSymbolIndexTripleSource(
  index: VirtualSymbolIndexLike,
  options: { baseIri?: string | undefined } = {},
): SparqlTripleSource {
  const base = options.baseIri ?? "https://modelscript.org/symbol/";
  const symIri = (id: number | string): string => `${base}${id}`;
  const parseSymId = (iri: string): string | null => (iri.startsWith(base) ? iri.slice(base.length) : null);

  const emitForEntry = function* (
    entry: VirtualSymbolEntryLike,
    predicate: { termType: "NamedNode"; value: string } | null | undefined,
    object: Exclude<SparqlTerm, { termType: "Variable" }> | null | undefined,
  ): Iterable<SparqlQuad> {
    const subj: { termType: "NamedNode"; value: string } = { termType: "NamedNode", value: symIri(entry.id) };
    const pFilter = predicate?.value ?? null;

    if (!pFilter || pFilter === RDF_TYPE) {
      const symType: { termType: "NamedNode"; value: string } = { termType: "NamedNode", value: MS_VOCAB.Symbol };
      if (matchObj(symType, object)) {
        yield { subject: subj, predicate: { termType: "NamedNode", value: RDF_TYPE }, object: symType };
      }
      const lowerKind = entry.kind.toLowerCase();
      if (lowerKind.includes("class") || lowerKind.includes("model") || lowerKind.includes("block")) {
        const clsType: { termType: "NamedNode"; value: string } = { termType: "NamedNode", value: MS_VOCAB.Class };
        if (matchObj(clsType, object)) {
          yield { subject: subj, predicate: { termType: "NamedNode", value: RDF_TYPE }, object: clsType };
        }
      } else if (lowerKind.includes("component") || lowerKind.includes("part") || lowerKind.includes("var")) {
        const compType: { termType: "NamedNode"; value: string } = {
          termType: "NamedNode",
          value: MS_VOCAB.Component,
        };
        if (matchObj(compType, object)) {
          yield { subject: subj, predicate: { termType: "NamedNode", value: RDF_TYPE }, object: compType };
        }
      }
    }

    if (!pFilter || pFilter === MS_VOCAB.name) {
      const o: Exclude<SparqlTerm, { termType: "Variable" }> = {
        termType: "Literal",
        value: entry.name,
        datatype: XSD_STRING,
      };
      if (matchObj(o, object)) {
        yield { subject: subj, predicate: { termType: "NamedNode", value: MS_VOCAB.name }, object: o };
      }
    }

    if (!pFilter || pFilter === MS_VOCAB.kind) {
      const o: Exclude<SparqlTerm, { termType: "Variable" }> = {
        termType: "Literal",
        value: entry.kind,
        datatype: XSD_STRING,
      };
      if (matchObj(o, object)) {
        yield { subject: subj, predicate: { termType: "NamedNode", value: MS_VOCAB.kind }, object: o };
      }
    }

    if (entry.parentId !== undefined && entry.parentId !== null && (!pFilter || pFilter === MS_VOCAB.parent)) {
      const o: Exclude<SparqlTerm, { termType: "Variable" }> = {
        termType: "NamedNode",
        value: symIri(entry.parentId),
      };
      if (matchObj(o, object)) {
        yield { subject: subj, predicate: { termType: "NamedNode", value: MS_VOCAB.parent }, object: o };
      }
    }

    if (entry.typeName && (!pFilter || pFilter === MS_VOCAB.typeName)) {
      const o: Exclude<SparqlTerm, { termType: "Variable" }> = {
        termType: "Literal",
        value: entry.typeName,
        datatype: XSD_STRING,
      };
      if (matchObj(o, object)) {
        yield { subject: subj, predicate: { termType: "NamedNode", value: MS_VOCAB.typeName }, object: o };
      }
    }

    if (entry.qualifiedName && (!pFilter || pFilter === MS_VOCAB.qualifiedName)) {
      const o: Exclude<SparqlTerm, { termType: "Variable" }> = {
        termType: "Literal",
        value: entry.qualifiedName,
        datatype: XSD_STRING,
      };
      if (matchObj(o, object)) {
        yield { subject: subj, predicate: { termType: "NamedNode", value: MS_VOCAB.qualifiedName }, object: o };
      }
    }

    if (entry.uri && (!pFilter || pFilter === MS_VOCAB.sourceUri)) {
      const o: Exclude<SparqlTerm, { termType: "Variable" }> = {
        termType: "Literal",
        value: entry.uri,
        datatype: XSD_STRING,
      };
      if (matchObj(o, object)) {
        yield { subject: subj, predicate: { termType: "NamedNode", value: MS_VOCAB.sourceUri }, object: o };
      }
    }

    if (entry.startOffset !== undefined && (!pFilter || pFilter === MS_VOCAB.startOffset)) {
      const o: Exclude<SparqlTerm, { termType: "Variable" }> = {
        termType: "Literal",
        value: String(entry.startOffset),
        datatype: XSD_INT,
      };
      if (matchObj(o, object)) {
        yield { subject: subj, predicate: { termType: "NamedNode", value: MS_VOCAB.startOffset }, object: o };
      }
    }
  };

  const lookupById = (rawId: string): VirtualSymbolEntryLike | undefined => {
    const direct = index.symbols.get(rawId);
    if (direct) return direct;
    const num = Number(rawId);
    if (!Number.isNaN(num)) return index.symbols.get(num);
    return undefined;
  };

  return {
    *match(subject, predicate, object, graph) {
      if (graph) return;

      // Fast O(1) lookup by bound subject IRI
      if (subject) {
        if (subject.termType !== "NamedNode") return;
        const idStr = parseSymId(subject.value);
        if (idStr === null) return;
        const entry = lookupById(idStr);
        if (entry) yield* emitForEntry(entry, predicate, object);
        return;
      }

      // Fast O(1) index lookup by ms:name when `byName` map is available
      if (predicate?.value === MS_VOCAB.name && object?.termType === "Literal" && index.byName) {
        const ids = index.byName.get(object.value);
        if (!ids) return;
        for (const id of ids) {
          const entry = index.symbols.get(id);
          if (entry) yield* emitForEntry(entry, predicate, object);
        }
        return;
      }

      // Fast O(deg) lookup by ms:parent when `childrenOf` map is available
      if (predicate?.value === MS_VOCAB.parent && object?.termType === "NamedNode" && index.childrenOf) {
        const parentStr = parseSymId(object.value);
        if (parentStr === null) return;
        const num = Number(parentStr);
        const childIds =
          index.childrenOf.get(parentStr) ?? (!Number.isNaN(num) ? index.childrenOf.get(num) : undefined);
        if (!childIds) return;
        for (const id of childIds) {
          const entry = index.symbols.get(id);
          if (entry) yield* emitForEntry(entry, predicate, object);
        }
        return;
      }

      for (const entry of index.symbols.values()) {
        yield* emitForEntry(entry, predicate, object);
      }
    },
  };
}

/**
 * Exposes flattened DAE variables & equations as a zero-copy virtual `SparqlTripleSource`.
 */
export function createDaeArenaTripleSource(
  dae: VirtualDaeLike,
  options: { baseIri?: string | undefined } = {},
): SparqlTripleSource {
  const base = options.baseIri ?? "https://modelscript.org/dae/var/";

  return {
    *match(subject, predicate, object, graph) {
      if (graph) return;
      const pFilter = predicate?.value ?? null;

      for (let i = 0; i < dae.variables.length; i++) {
        const v = dae.variables[i]!;
        const sIri = `${base}${v.name}`;
        if (subject && (subject.termType !== "NamedNode" || subject.value !== sIri)) continue;
        const subj: { termType: "NamedNode"; value: string } = { termType: "NamedNode", value: sIri };

        if (!pFilter || pFilter === RDF_TYPE) {
          const o: Exclude<SparqlTerm, { termType: "Variable" }> = {
            termType: "NamedNode",
            value: MS_VOCAB.Variable,
          };
          if (matchObj(o, object)) {
            yield { subject: subj, predicate: { termType: "NamedNode", value: RDF_TYPE }, object: o };
          }
        }
        if (!pFilter || pFilter === MS_VOCAB.name) {
          const o: Exclude<SparqlTerm, { termType: "Variable" }> = {
            termType: "Literal",
            value: v.name,
            datatype: XSD_STRING,
          };
          if (matchObj(o, object)) {
            yield { subject: subj, predicate: { termType: "NamedNode", value: MS_VOCAB.name }, object: o };
          }
        }
        if (v.variability && (!pFilter || pFilter === MS_VOCAB.variability)) {
          const o: Exclude<SparqlTerm, { termType: "Variable" }> = {
            termType: "Literal",
            value: v.variability,
            datatype: XSD_STRING,
          };
          if (matchObj(o, object)) {
            yield { subject: subj, predicate: { termType: "NamedNode", value: MS_VOCAB.variability }, object: o };
          }
        }
        if (v.causality && (!pFilter || pFilter === MS_VOCAB.causality)) {
          const o: Exclude<SparqlTerm, { termType: "Variable" }> = {
            termType: "Literal",
            value: v.causality,
            datatype: XSD_STRING,
          };
          if (matchObj(o, object)) {
            yield { subject: subj, predicate: { termType: "NamedNode", value: MS_VOCAB.causality }, object: o };
          }
        }
        if (v.typeName && (!pFilter || pFilter === MS_VOCAB.typeName)) {
          const o: Exclude<SparqlTerm, { termType: "Variable" }> = {
            termType: "Literal",
            value: v.typeName,
            datatype: XSD_STRING,
          };
          if (matchObj(o, object)) {
            yield { subject: subj, predicate: { termType: "NamedNode", value: MS_VOCAB.typeName }, object: o };
          }
        }
      }
    },
  };
}

/**
 * Federates multiple `SparqlTripleSource`s (e.g., `WasmOntologyReasoner` + `SymbolIndex` + `DAEBuilder`
 * + `PagedStorageEngine`) into a single zero-copy composite view.
 */
export function createCompositeTripleSource(...sources: SparqlTripleSource[]): SparqlTripleSource {
  return {
    *match(subject, predicate, object, graph) {
      for (let i = 0; i < sources.length; i++) {
        yield* sources[i]!.match(subject, predicate, object, graph);
      }
    },
  };
}
