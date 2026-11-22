// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OWL2AxiomDelta, WasmOntologyReasoner } from "@modelscript/runtime";
import type { SparqlQuery, SparqlTerm } from "./ast.js";
import {
  createOntologyReasonerSource,
  executeSparqlAlgebra,
  type SparqlBindingRow,
  type SparqlExecutionOptions,
  type SparqlMutableTripleSource,
  type SparqlQuad,
  type SparqlTripleSource,
} from "./engine.js";

/**
 * Incremental Z-Set change notification emitted by a `ReactiveSparqlView`.
 * `added` contains newly appearing binding rows (weight +1 delta);
 * `removed` contains retracted binding rows (weight -1 delta).
 */
export interface ReactiveSparqlDelta {
  readonly added: readonly SparqlBindingRow[];
  readonly removed: readonly SparqlBindingRow[];
  readonly revision: number;
  readonly executionTimeMs: number;
}

export type ReactiveSparqlListener = (delta: ReactiveSparqlDelta) => void;

/**
 * Live, DBSP Z-Set-maintained materialized SPARQL view.
 * Tracks binding multiplicities with integer weights (+1 / -1) and emits minimal
 * incremental deltas (`added` / `removed`) as the underlying ontology or triple store mutates.
 */
export interface ReactiveSparqlView {
  readonly revision: number;
  readonly stats: { readonly incrementalUpdates: number; readonly fullRecomputes: number };
  snapshot(): SparqlBindingRow[];
  subscribe(listener: ReactiveSparqlListener): () => void;
  refresh(): ReactiveSparqlDelta;
  applyOntologyDelta(delta: OWL2AxiomDelta): ReactiveSparqlDelta;
  applyTripleDelta(delta: {
    insertions?: readonly SparqlQuad[] | undefined;
    deletions?: readonly SparqlQuad[] | undefined;
  }): ReactiveSparqlDelta;
}

function bindingTermKey(t: Exclude<SparqlTerm, { termType: "Variable" }>): string {
  if (t.termType === "NamedNode") return `I:${t.value}`;
  if (t.termType === "BlankNode") return `B:${t.value}`;
  return `L:${t.value}|${t.datatype ?? ""}|${t.language ?? ""}`;
}

function bindingRowKey(row: SparqlBindingRow): string {
  const keys = Object.keys(row).sort();
  let out = "";
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (i > 0) out += "\0";
    out += `${k}=${bindingTermKey(row[k]!)}`;
  }
  return out;
}

/**
 * Creates a live, Z-Set-maintained reactive SPARQL SELECT view over either a `WasmOntologyReasoner`
 * (using $O(\Delta)$ incremental reasoning) or any `SparqlTripleSource` / `SparqlMutableTripleSource`.
 */
export function createReactiveSparqlView(
  query: SparqlQuery,
  target: WasmOntologyReasoner | SparqlTripleSource,
  options: SparqlExecutionOptions = {},
): ReactiveSparqlView {
  const isReasoner =
    typeof (target as WasmOntologyReasoner).applyDelta === "function" &&
    typeof (target as WasmOntologyReasoner).matchTriplesLive === "function";

  const reasoner = isReasoner ? (target as WasmOntologyReasoner) : null;
  const source: SparqlTripleSource = reasoner ? createOntologyReasonerSource(reasoner) : (target as SparqlTripleSource);

  // Z-Set representation: canonical binding key -> { weight, row }
  let zset = new Map<string, { weight: number; row: SparqlBindingRow }>();
  let revision = 0;
  let incrementalUpdates = 0;
  let fullRecomputes = 0;
  const listeners = new Set<ReactiveSparqlListener>();

  // Detect whether this query is eligible for O(|Δ| * deg) DBSP bilinear join maintenance
  const canBilinearBgp =
    query.queryType === "SELECT" &&
    !query.distinct &&
    !query.reduced &&
    query.modifier.groupBy.length === 0 &&
    query.modifier.having.length === 0 &&
    query.modifier.orderBy.length === 0 &&
    query.modifier.limit === undefined &&
    query.modifier.offset === undefined &&
    (!query.projections || query.projections.every((p) => !p.expr)) &&
    query.where.kind === "bgp" &&
    query.where.triples.length >= 1 &&
    query.where.triples.every((tp) => tp.predicate.termType !== "PropertyPath");

  const matchQuadToPattern = (
    q: SparqlQuad,
    tp: Extract<SparqlQuery["where"], { kind: "bgp" }>["triples"][number],
  ): SparqlBindingRow | null => {
    const row: SparqlBindingRow = {};
    const bindOrCheck = (term: SparqlTerm, actual: Exclude<SparqlTerm, { termType: "Variable" }>): boolean => {
      if (term.termType === "Variable") {
        const existing = row[term.value];
        if (existing) return bindingTermKey(existing) === bindingTermKey(actual);
        row[term.value] = actual;
        return true;
      }
      return bindingTermKey(term) === bindingTermKey(actual);
    };
    if (!bindOrCheck(tp.subject, q.subject)) return null;
    if (tp.predicate.termType === "PropertyPath") return null;
    if (!bindOrCheck(tp.predicate, q.predicate)) return null;
    if (!bindOrCheck(tp.object, q.object)) return null;
    return row;
  };

  const projectRow = (row: SparqlBindingRow): SparqlBindingRow => {
    if (!query.projections || query.projections.length === 0) return row;
    const out: SparqlBindingRow = {};
    for (const p of query.projections) {
      if (row[p.variable] !== undefined) out[p.variable] = row[p.variable]!;
    }
    return out;
  };

  const joinSeedWithOtherPatterns = (
    seedRow: SparqlBindingRow,
    otherTriples: Extract<SparqlQuery["where"], { kind: "bgp" }>["triples"],
  ): SparqlBindingRow[] => {
    if (otherTriples.length === 0) return [seedRow];
    // Substitute seed bindings into otherTriples and evaluate via live source
    const subQuery: SparqlQuery = {
      queryType: "SELECT",
      prefixes: query.prefixes,
      hasServiceClause: false,
      modifier: { groupBy: [], having: [], orderBy: [] },
      where: {
        kind: "bgp",
        triples: otherTriples.map((tp) => ({
          subject:
            tp.subject.termType === "Variable" && seedRow[tp.subject.value] ? seedRow[tp.subject.value]! : tp.subject,
          predicate:
            tp.predicate.termType === "Variable" && seedRow[tp.predicate.value]?.termType === "NamedNode"
              ? (seedRow[tp.predicate.value] as { termType: "NamedNode"; value: string })
              : tp.predicate,
          object: tp.object.termType === "Variable" && seedRow[tp.object.value] ? seedRow[tp.object.value]! : tp.object,
        })),
      },
    };
    const subRes = executeSparqlAlgebra(subQuery, source, options);
    if (subRes.queryType !== "SELECT") return [];
    return subRes.bindings.map((r) => ({ ...seedRow, ...r }));
  };

  const buildZSet = (rows: readonly SparqlBindingRow[]): Map<string, { weight: number; row: SparqlBindingRow }> => {
    const map = new Map<string, { weight: number; row: SparqlBindingRow }>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const k = bindingRowKey(row);
      const entry = map.get(k);
      if (entry) entry.weight++;
      else map.set(k, { weight: 1, row });
    }
    return map;
  };

  const recomputeAndDiff = (notify: boolean): ReactiveSparqlDelta => {
    const t0 = performance.now();
    fullRecomputes++;
    const res = executeSparqlAlgebra(query, source, options);
    const nextRows = res.queryType === "SELECT" ? res.bindings : [];
    const nextZSet = buildZSet(nextRows);

    const added: SparqlBindingRow[] = [];
    const removed: SparqlBindingRow[] = [];

    // Positive Z-Set delta (+weight)
    for (const [k, nextEntry] of nextZSet) {
      const prevWeight = zset.get(k)?.weight ?? 0;
      const diff = nextEntry.weight - prevWeight;
      for (let i = 0; i < diff; i++) added.push(nextEntry.row);
    }

    // Negative Z-Set delta (-weight)
    for (const [k, prevEntry] of zset) {
      const nextWeight = nextZSet.get(k)?.weight ?? 0;
      const diff = prevEntry.weight - nextWeight;
      for (let i = 0; i < diff; i++) removed.push(prevEntry.row);
    }

    zset = nextZSet;
    if (added.length > 0 || removed.length > 0) {
      revision++;
    }

    const delta: ReactiveSparqlDelta = {
      added,
      removed,
      revision,
      executionTimeMs: performance.now() - t0,
    };

    if (notify && (added.length > 0 || removed.length > 0)) {
      for (const listener of listeners) {
        listener(delta);
      }
    }

    return delta;
  };

  // Initial materialization (does not notify listeners)
  recomputeAndDiff(false);

  return {
    get revision(): number {
      return revision;
    },
    get stats() {
      return { incrementalUpdates, fullRecomputes };
    },
    snapshot(): SparqlBindingRow[] {
      const out: SparqlBindingRow[] = [];
      for (const entry of zset.values()) {
        for (let i = 0; i < entry.weight; i++) out.push(entry.row);
      }
      return out;
    },
    subscribe(listener: ReactiveSparqlListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh(): ReactiveSparqlDelta {
      return recomputeAndDiff(true);
    },
    applyOntologyDelta(delta: OWL2AxiomDelta): ReactiveSparqlDelta {
      if (!reasoner) {
        throw new Error("applyOntologyDelta() requires a WasmOntologyReasoner-backed ReactiveSparqlView");
      }
      reasoner.applyDelta(delta);
      return recomputeAndDiff(true);
    },
    applyTripleDelta(delta): ReactiveSparqlDelta {
      const mut = source as Partial<SparqlMutableTripleSource>;
      if (typeof mut.addQuad !== "function" || typeof mut.deleteQuad !== "function") {
        throw new Error("applyTripleDelta() requires a SparqlMutableTripleSource-backed ReactiveSparqlView");
      }

      // True DBSP bilinear incremental join maintenance for pure BGPs:
      // Process each deletion/insertion sequentially so Δ(A ⋈ B) = ΔA ⋈ B_cur (exact telescopic identity!)
      if (canBilinearBgp && query.where.kind === "bgp") {
        const t0 = performance.now();
        const triples = query.where.triples;
        const deltaWeights = new Map<string, { weight: number; row: SparqlBindingRow }>();
        const addWeight = (row: SparqlBindingRow, w: number) => {
          const proj = projectRow(row);
          const k = bindingRowKey(proj);
          const prev = deltaWeights.get(k);
          if (prev) prev.weight += w;
          else deltaWeights.set(k, { weight: w, row: proj });
        };

        // 1. Deletions: remove quad from source first, then join deleted quad against remaining triples
        if (delta.deletions) {
          for (const q of delta.deletions) {
            if (!mut.deleteQuad(q)) continue;
            for (let pi = 0; pi < triples.length; pi++) {
              const seed = matchQuadToPattern(q, triples[pi]!);
              if (!seed) continue;
              const others = triples.filter((_, idx) => idx !== pi);
              for (const joined of joinSeedWithOtherPatterns(seed, others)) {
                addWeight(joined, -1);
              }
            }
          }
        }

        // 2. Insertions: insert quad into source first, then join inserted quad against remaining triples
        if (delta.insertions) {
          for (const q of delta.insertions) {
            if (!mut.addQuad(q)) continue;
            for (let pi = 0; pi < triples.length; pi++) {
              const seed = matchQuadToPattern(q, triples[pi]!);
              if (!seed) continue;
              const others = triples.filter((_, idx) => idx !== pi);
              for (const joined of joinSeedWithOtherPatterns(seed, others)) {
                addWeight(joined, +1);
              }
            }
          }
        }

        const added: SparqlBindingRow[] = [];
        const removed: SparqlBindingRow[] = [];
        for (const [k, dEntry] of deltaWeights) {
          if (dEntry.weight === 0) continue;
          const cur = zset.get(k);
          const nextW = (cur?.weight ?? 0) + dEntry.weight;
          if (nextW <= 0) zset.delete(k);
          else zset.set(k, { weight: nextW, row: dEntry.row });

          if (dEntry.weight > 0) {
            for (let i = 0; i < dEntry.weight; i++) added.push(dEntry.row);
          } else {
            for (let i = 0; i < -dEntry.weight; i++) removed.push(dEntry.row);
          }
        }

        incrementalUpdates++;
        if (added.length > 0 || removed.length > 0) revision++;

        const outDelta: ReactiveSparqlDelta = {
          added,
          removed,
          revision,
          executionTimeMs: performance.now() - t0,
        };
        if (added.length > 0 || removed.length > 0) {
          for (const listener of listeners) listener(outDelta);
        }
        return outDelta;
      }

      if (delta.deletions) {
        for (const q of delta.deletions) mut.deleteQuad(q);
      }
      if (delta.insertions) {
        for (const q of delta.insertions) mut.addQuad(q);
      }
      return recomputeAndDiff(true);
    },
  };
}
