// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WasmOntologyReasoner, WasmOntologyStore } from "@modelscript/runtime";
import {
  lowerSparqlCst,
  type GenericSyntaxNode,
  type SparqlExpr,
  type SparqlGraphPattern,
  type SparqlPropertyPath,
  type SparqlQuery,
  type SparqlTerm,
  type SparqlTriplePattern,
} from "./ast.js";

export interface SparqlQuad {
  subject: Exclude<SparqlTerm, { termType: "Variable" }>;
  predicate: { termType: "NamedNode"; value: string };
  object: Exclude<SparqlTerm, { termType: "Variable" }>;
  graph?: { termType: "NamedNode"; value: string } | undefined;
}

/**
 * Unified triple/quad source interface consumed by the native ModelScript SPARQL 1.1 engine.
 */
export interface SparqlTripleSource {
  match(
    subject?: Exclude<SparqlTerm, { termType: "Variable" }> | null,
    predicate?: { termType: "NamedNode"; value: string } | null,
    object?: Exclude<SparqlTerm, { termType: "Variable" }> | null,
    graph?: { termType: "NamedNode"; value: string } | null,
  ): Iterable<SparqlQuad>;
}

/**
 * Mutable triple/quad source supporting SPARQL 1.1 Update (`INSERT DATA`, `DELETE DATA`, `DELETE/INSERT WHERE`).
 */
export interface SparqlMutableTripleSource extends SparqlTripleSource {
  addQuad(quad: SparqlQuad): boolean;
  deleteQuad(quad: SparqlQuad): boolean;
}

export interface SparqlUpdateResult {
  queryType: "INSERT_DATA" | "DELETE_DATA" | "MODIFY";
  insertedCount: number;
  deletedCount: number;
  executionTimeMs: number;
}

export type SparqlBindingRow = Record<string, Exclude<SparqlTerm, { termType: "Variable" }>>;

export interface SparqlJsonTerm {
  type: "uri" | "literal" | "bnode";
  value: string;
  datatype?: string | undefined;
  "xml:lang"?: string | undefined;
}

export interface SparqlSelectResult {
  queryType: "SELECT";
  variables: string[];
  bindings: SparqlBindingRow[];
  /** W3C SPARQL 1.1 Query Results JSON Format payload. */
  json: {
    head: { vars: string[] };
    results: { bindings: Array<Record<string, SparqlJsonTerm>> };
  };
  executionTimeMs: number;
}

export interface SparqlAskResult {
  queryType: "ASK";
  boolean: boolean;
  json: { head: Record<string, never>; boolean: boolean };
  executionTimeMs: number;
}

export interface SparqlGraphResult {
  queryType: "CONSTRUCT" | "DESCRIBE";
  quads: SparqlQuad[];
  executionTimeMs: number;
}

export type SparqlExecutionResult = SparqlSelectResult | SparqlAskResult | SparqlGraphResult;

export interface SparqlExecutionOptions {
  /** Reject federated `SERVICE` clauses at the AST level (default: true). */
  disallowService?: boolean | undefined;
  /** Maximum number of SELECT bindings returned (default: 50000). */
  maxBindings?: number | undefined;
}

const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";

function termKey(t: SparqlTerm): string {
  if (t.termType === "NamedNode") return `I:${t.value}`;
  if (t.termType === "BlankNode") return `B:${t.value}`;
  if (t.termType === "Literal") return `L:${t.value}|${t.datatype ?? ""}|${t.language ?? ""}`;
  return `V:${t.value}`;
}

function termsEqual(a: SparqlTerm, b: SparqlTerm): boolean {
  if (a.termType !== b.termType) return false;
  if (a.termType === "Literal" && b.termType === "Literal") {
    const aNum = toNumber(a);
    const bNum = toNumber(b);
    if (aNum !== null && bNum !== null) return aNum === bNum;
    return a.value === b.value && (a.language ?? "") === (b.language ?? "");
  }
  return a.value === b.value;
}

function toNumber(t: SparqlTerm | undefined): number | null {
  if (!t || t.termType !== "Literal") return null;
  if (
    t.datatype === `${XSD_NS}integer` ||
    t.datatype === `${XSD_NS}decimal` ||
    t.datatype === `${XSD_NS}double` ||
    t.datatype === `${XSD_NS}float` ||
    t.datatype === `${XSD_NS}int` ||
    t.datatype === `${XSD_NS}long`
  ) {
    const n = Number(t.value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function effectiveBooleanValue(t: SparqlTerm | undefined): boolean {
  if (!t) return false;
  if (t.termType === "Literal") {
    if (t.datatype === `${XSD_NS}boolean`) return t.value === "true" || t.value === "1";
    const num = toNumber(t);
    if (num !== null) return num !== 0 && !Number.isNaN(num);
    return t.value.length > 0;
  }
  return true;
}

function toJsonTerm(t: Exclude<SparqlTerm, { termType: "Variable" }>): SparqlJsonTerm {
  if (t.termType === "NamedNode") return { type: "uri", value: t.value };
  if (t.termType === "BlankNode") return { type: "bnode", value: t.value };
  const entry: SparqlJsonTerm = { type: "literal", value: t.value };
  if (t.language) {
    entry["xml:lang"] = t.language;
  } else if (
    t.datatype &&
    t.datatype !== `${XSD_NS}string` &&
    t.datatype !== "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"
  ) {
    entry.datatype = t.datatype;
  }
  return entry;
}

function resolveTermInEnv(t: SparqlTerm, env: SparqlBindingRow): Exclude<SparqlTerm, { termType: "Variable" }> | null {
  if (t.termType === "Variable") return env[t.value] ?? null;
  return t;
}

/**
 * Creates a mutable indexed in-memory `SparqlMutableTripleSource` over an array of `SparqlQuad`s.
 */
export function createArrayTripleSource(initialQuads: readonly SparqlQuad[]): SparqlMutableTripleSource {
  const quads: SparqlQuad[] = [...initialQuads];
  const exactKeys = new Set<string>();
  const bySubject = new Map<string, SparqlQuad[]>();
  const byPredicate = new Map<string, SparqlQuad[]>();
  const byObject = new Map<string, SparqlQuad[]>();

  const quadKey = (q: SparqlQuad): string =>
    `${termKey(q.subject)}\0${q.predicate.value}\0${termKey(q.object)}\0${q.graph?.value ?? ""}`;

  const indexQuad = (q: SparqlQuad): void => {
    const sList = bySubject.get(q.subject.value);
    if (sList) sList.push(q);
    else bySubject.set(q.subject.value, [q]);

    const pList = byPredicate.get(q.predicate.value);
    if (pList) pList.push(q);
    else byPredicate.set(q.predicate.value, [q]);

    const oList = byObject.get(q.object.value);
    if (oList) oList.push(q);
    else byObject.set(q.object.value, [q]);
  };

  for (const q of quads) {
    exactKeys.add(quadKey(q));
    indexQuad(q);
  }

  return {
    addQuad(q) {
      const k = quadKey(q);
      if (exactKeys.has(k)) return false;
      exactKeys.add(k);
      quads.push(q);
      indexQuad(q);
      return true;
    },
    deleteQuad(q) {
      const k = quadKey(q);
      if (!exactKeys.has(k)) return false;
      exactKeys.delete(k);
      const removeFrom = (arr: SparqlQuad[] | undefined): void => {
        if (!arr) return;
        const idx = arr.findIndex((item) => quadKey(item) === k);
        if (idx !== -1) arr.splice(idx, 1);
      };
      removeFrom(quads);
      removeFrom(bySubject.get(q.subject.value));
      removeFrom(byPredicate.get(q.predicate.value));
      removeFrom(byObject.get(q.object.value));
      return true;
    },
    match(subject, predicate, object, graph) {
      let candidates: readonly SparqlQuad[];
      if (subject) candidates = bySubject.get(subject.value) ?? [];
      else if (object) candidates = byObject.get(object.value) ?? [];
      else if (predicate) candidates = byPredicate.get(predicate.value) ?? [];
      else candidates = quads;

      const out: SparqlQuad[] = [];
      for (const q of candidates) {
        if (subject && !termsEqual(q.subject, subject)) continue;
        if (predicate && q.predicate.value !== predicate.value) continue;
        if (object && !termsEqual(q.object, object)) continue;
        if (graph && q.graph?.value !== graph.value) continue;
        out.push(q);
      }
      return out;
    },
  };
}

/**
 * Adapts a `WasmOntologyReasoner` (including inferred taxonomy, types, and property assertions)
 * into a `SparqlTripleSource`.
 */
export function createOntologyReasonerSource(reasoner: WasmOntologyReasoner): SparqlTripleSource {
  reasoner.classify();
  const quads: SparqlQuad[] = [];
  const seen = new Set<string>();
  const pushQuad = (s: string, p: string, o: Exclude<SparqlTerm, { termType: "Variable" }>): void => {
    const q: SparqlQuad = {
      subject: { termType: "NamedNode", value: s },
      predicate: { termType: "NamedNode", value: p },
      object: o,
    };
    const k = `${s}\0${p}\0${termKey(o)}`;
    if (!seen.has(k)) {
      seen.add(k);
      quads.push(q);
    }
  };

  for (const node of reasoner.getTaxonomy()) {
    pushQuad(node.iri, RDF_TYPE, { termType: "NamedNode", value: "http://www.w3.org/2002/07/owl#Class" });
    for (const sup of node.directSuperClasses) {
      pushQuad(node.iri, RDFS_SUBCLASS, { termType: "NamedNode", value: sup });
    }
  }

  const allBgp = reasoner.queryBgp({ patterns: [{ subject: "?s", predicate: "?p", object: "?o" }] });
  for (const row of allBgp.bindings) {
    const s = row["?s"]!;
    const p = row["?p"]!;
    const o = row["?o"]!;
    const isIri = o.includes(":") || o.startsWith("http://") || o.startsWith("https://") || o.startsWith("urn:");
    pushQuad(
      s,
      p === "rdf:type" ? RDF_TYPE : p === "rdfs:subClassOf" ? RDFS_SUBCLASS : p,
      isIri
        ? { termType: "NamedNode", value: o }
        : {
            termType: "Literal",
            value: o,
            datatype: !Number.isNaN(Number(o)) && o.trim() !== "" ? `${XSD_NS}double` : `${XSD_NS}string`,
          },
    );
  }

  return createArrayTripleSource(quads);
}

/**
 * Adapts a `WasmOntologyStore` (using its WASM RoaringBitmap triple index when attached,
 * or JS axioms otherwise) into a `SparqlTripleSource`.
 */
export function createOntologyStoreSource(store: WasmOntologyStore): SparqlTripleSource {
  const quads: SparqlQuad[] = [];
  for (const ax of store.axioms) {
    if (ax.type === "SubClassOf") {
      quads.push({
        subject: { termType: "NamedNode", value: ax.subClassIri },
        predicate: { termType: "NamedNode", value: RDFS_SUBCLASS },
        object: { termType: "NamedNode", value: ax.superClassIri },
      });
    } else if (ax.type === "ClassAssertion") {
      quads.push({
        subject: { termType: "NamedNode", value: ax.individualIri },
        predicate: { termType: "NamedNode", value: RDF_TYPE },
        object: { termType: "NamedNode", value: ax.classIri },
      });
    } else if (ax.type === "ObjectPropertyAssertion") {
      quads.push({
        subject: { termType: "NamedNode", value: ax.subjectIri },
        predicate: { termType: "NamedNode", value: ax.propertyIri },
        object: { termType: "NamedNode", value: ax.objectIri },
      });
    } else if (ax.type === "DataPropertyAssertion") {
      quads.push({
        subject: { termType: "NamedNode", value: ax.subjectIri },
        predicate: { termType: "NamedNode", value: ax.propertyIri },
        object: { termType: "Literal", value: ax.value, datatype: ax.datatype ?? `${XSD_NS}string` },
      });
    }
  }
  return createArrayTripleSource(quads);
}

/**
 * Adapts a WASM `PagedStorageEngine` (4KB slotted B+Tree with SPO/POS/OSP indices)
 * into a `SparqlTripleSource` executing O(log N + K) B+Tree range scans directly.
 */
export function createPagedStorageSource(engine: {
  findTriples(pattern: {
    subject?: string | number | undefined;
    predicate?: string | number | undefined;
    object?: string | number | boolean | undefined;
  }): Array<{ subjectId: number; predicateId: number; objectId: number }>;
  decodeTerm(nodeId: number): string | number | boolean | undefined;
}): SparqlTripleSource {
  return {
    match(subject, predicate, object) {
      const rows = engine.findTriples({
        subject: subject?.value,
        predicate: predicate?.value,
        object: object?.value,
      });
      const out: SparqlQuad[] = [];
      for (const r of rows) {
        const sVal = engine.decodeTerm(r.subjectId);
        const pVal = engine.decodeTerm(r.predicateId);
        const oVal = engine.decodeTerm(r.objectId);
        if (sVal === undefined || pVal === undefined || oVal === undefined) continue;
        const oTerm: Exclude<SparqlTerm, { termType: "Variable" }> =
          typeof oVal === "number"
            ? {
                termType: "Literal",
                value: String(oVal),
                datatype: Number.isInteger(oVal) ? `${XSD_NS}integer` : `${XSD_NS}double`,
              }
            : typeof oVal === "boolean"
              ? { termType: "Literal", value: String(oVal), datatype: `${XSD_NS}boolean` }
              : oVal.startsWith("http://") ||
                  oVal.startsWith("https://") ||
                  oVal.startsWith("urn:") ||
                  oVal.includes(":")
                ? { termType: "NamedNode", value: oVal }
                : { termType: "Literal", value: oVal, datatype: `${XSD_NS}string` };
        out.push({
          subject: { termType: "NamedNode", value: String(sVal) },
          predicate: { termType: "NamedNode", value: String(pVal) },
          object: oTerm,
        });
      }
      return out;
    },
  };
}

// ── Expression & Aggregate Evaluation ────────────────────────────────────────

function evalExpr(
  expr: SparqlExpr,
  env: SparqlBindingRow,
  groupRows?: SparqlBindingRow[],
): Exclude<SparqlTerm, { termType: "Variable" }> | undefined {
  switch (expr.kind) {
    case "term":
      return resolveTermInEnv(expr.term, env) ?? undefined;
    case "unary": {
      const val = evalExpr(expr.arg, env, groupRows);
      if (expr.op === "!") {
        return { termType: "Literal", value: String(!effectiveBooleanValue(val)), datatype: `${XSD_NS}boolean` };
      }
      const num = toNumber(val);
      if (num === null) return undefined;
      return { termType: "Literal", value: String(expr.op === "-" ? -num : num), datatype: `${XSD_NS}double` };
    }
    case "binary": {
      if (expr.op === "||") {
        const l = effectiveBooleanValue(evalExpr(expr.left, env, groupRows));
        const r = l ? true : effectiveBooleanValue(evalExpr(expr.right, env, groupRows));
        return { termType: "Literal", value: String(l || r), datatype: `${XSD_NS}boolean` };
      }
      if (expr.op === "&&") {
        const l = effectiveBooleanValue(evalExpr(expr.left, env, groupRows));
        const r = l ? effectiveBooleanValue(evalExpr(expr.right, env, groupRows)) : false;
        return { termType: "Literal", value: String(l && r), datatype: `${XSD_NS}boolean` };
      }
      const l = evalExpr(expr.left, env, groupRows);
      const r = evalExpr(expr.right, env, groupRows);
      if (!l || !r) return undefined;
      if (expr.op === "=")
        return { termType: "Literal", value: String(termsEqual(l, r)), datatype: `${XSD_NS}boolean` };
      if (expr.op === "!=")
        return { termType: "Literal", value: String(!termsEqual(l, r)), datatype: `${XSD_NS}boolean` };

      const ln = toNumber(l);
      const rn = toNumber(r);
      if (expr.op === "+" || expr.op === "-" || expr.op === "*" || expr.op === "/") {
        if (ln === null || rn === null) return undefined;
        const res =
          expr.op === "+" ? ln + rn : expr.op === "-" ? ln - rn : expr.op === "*" ? ln * rn : rn === 0 ? NaN : ln / rn;
        return { termType: "Literal", value: String(res), datatype: `${XSD_NS}double` };
      }
      const cmp = ln !== null && rn !== null ? ln - rn : l.value.localeCompare(r.value);
      const ok = expr.op === "<" ? cmp < 0 : expr.op === "<=" ? cmp <= 0 : expr.op === ">" ? cmp > 0 : cmp >= 0;
      return { termType: "Literal", value: String(ok), datatype: `${XSD_NS}boolean` };
    }
    case "in": {
      const target = evalExpr(expr.expr, env, groupRows);
      if (!target) return { termType: "Literal", value: String(expr.negated), datatype: `${XSD_NS}boolean` };
      const found = expr.list.some((item) => {
        const v = evalExpr(item, env, groupRows);
        return v !== undefined && termsEqual(target, v);
      });
      return { termType: "Literal", value: String(expr.negated ? !found : found), datatype: `${XSD_NS}boolean` };
    }
    case "call": {
      const fn = expr.fn.toUpperCase();
      // Aggregates
      if (groupRows && ["COUNT", "SUM", "AVG", "MIN", "MAX", "GROUP_CONCAT", "SAMPLE"].includes(fn)) {
        return evalAggregate(fn, expr, groupRows);
      }
      if (fn === "BOUND") {
        const arg = expr.args[0];
        const ok =
          arg?.kind === "term" && arg.term.termType === "Variable"
            ? env[arg.term.value] !== undefined
            : evalExpr(arg!, env) !== undefined;
        return { termType: "Literal", value: String(ok), datatype: `${XSD_NS}boolean` };
      }
      if (fn === "COALESCE") {
        for (const a of expr.args) {
          const v = evalExpr(a, env, groupRows);
          if (v !== undefined) return v;
        }
        return undefined;
      }
      if (fn === "IF" && expr.args.length >= 3) {
        const cond = effectiveBooleanValue(evalExpr(expr.args[0]!, env, groupRows));
        return evalExpr(cond ? expr.args[1]! : expr.args[2]!, env, groupRows);
      }
      const a0 = expr.args[0] ? evalExpr(expr.args[0], env, groupRows) : undefined;
      const a1 = expr.args[1] ? evalExpr(expr.args[1], env, groupRows) : undefined;
      const a2 = expr.args[2] ? evalExpr(expr.args[2], env, groupRows) : undefined;
      if (!a0) return undefined;

      switch (fn) {
        case "STR":
          return { termType: "Literal", value: a0.value, datatype: `${XSD_NS}string` };
        case "LANG":
          return {
            termType: "Literal",
            value: a0.termType === "Literal" ? (a0.language ?? "") : "",
            datatype: `${XSD_NS}string`,
          };
        case "DATATYPE":
          return a0.termType === "Literal"
            ? { termType: "NamedNode", value: a0.datatype ?? `${XSD_NS}string` }
            : undefined;
        case "ISIRI":
        case "ISURI":
          return { termType: "Literal", value: String(a0.termType === "NamedNode"), datatype: `${XSD_NS}boolean` };
        case "ISLITERAL":
          return { termType: "Literal", value: String(a0.termType === "Literal"), datatype: `${XSD_NS}boolean` };
        case "ISBLANK":
          return { termType: "Literal", value: String(a0.termType === "BlankNode"), datatype: `${XSD_NS}boolean` };
        case "ISNUMERIC":
          return { termType: "Literal", value: String(toNumber(a0) !== null), datatype: `${XSD_NS}boolean` };
        case "STRLEN":
          return { termType: "Literal", value: String(a0.value.length), datatype: `${XSD_NS}integer` };
        case "LCASE":
          return { termType: "Literal", value: a0.value.toLowerCase(), datatype: `${XSD_NS}string` };
        case "UCASE":
          return { termType: "Literal", value: a0.value.toUpperCase(), datatype: `${XSD_NS}string` };
        case "CONTAINS":
          return {
            termType: "Literal",
            value: String(a1 ? a0.value.includes(a1.value) : false),
            datatype: `${XSD_NS}boolean`,
          };
        case "STRSTARTS":
          return {
            termType: "Literal",
            value: String(a1 ? a0.value.startsWith(a1.value) : false),
            datatype: `${XSD_NS}boolean`,
          };
        case "STRENDS":
          return {
            termType: "Literal",
            value: String(a1 ? a0.value.endsWith(a1.value) : false),
            datatype: `${XSD_NS}boolean`,
          };
        case "REGEX": {
          if (!a1) return { termType: "Literal", value: "false", datatype: `${XSD_NS}boolean` };
          try {
            const re = new RegExp(a1.value, a2?.value ?? "");
            return { termType: "Literal", value: String(re.test(a0.value)), datatype: `${XSD_NS}boolean` };
          } catch {
            return { termType: "Literal", value: "false", datatype: `${XSD_NS}boolean` };
          }
        }
        default:
          return undefined;
      }
    }
  }
}

function evalAggregate(
  fn: string,
  expr: Extract<SparqlExpr, { kind: "call" }>,
  rows: SparqlBindingRow[],
): Exclude<SparqlTerm, { termType: "Variable" }> | undefined {
  if (fn === "COUNT") {
    if (expr.star) {
      return { termType: "Literal", value: String(rows.length), datatype: `${XSD_NS}integer` };
    }
    const vals = rows.map((r) => evalExpr(expr.args[0]!, r)).filter((v): v is NonNullable<typeof v> => v !== undefined);
    const count = expr.distinct ? new Set(vals.map(termKey)).size : vals.length;
    return { termType: "Literal", value: String(count), datatype: `${XSD_NS}integer` };
  }
  const vals = rows.map((r) => evalExpr(expr.args[0]!, r)).filter((v): v is NonNullable<typeof v> => v !== undefined);
  const uniq = expr.distinct ? Array.from(new Map(vals.map((v) => [termKey(v), v])).values()) : vals;
  if (uniq.length === 0) return undefined;

  if (fn === "SAMPLE") return uniq[0];
  if (fn === "GROUP_CONCAT") {
    return { termType: "Literal", value: uniq.map((v) => v.value).join(" "), datatype: `${XSD_NS}string` };
  }
  const nums = uniq.map(toNumber).filter((n): n is number => n !== null);
  if (fn === "SUM") {
    const s = nums.reduce((a, b) => a + b, 0);
    return { termType: "Literal", value: String(s), datatype: `${XSD_NS}double` };
  }
  if (fn === "AVG") {
    if (nums.length === 0) return undefined;
    const s = nums.reduce((a, b) => a + b, 0) / nums.length;
    return { termType: "Literal", value: String(s), datatype: `${XSD_NS}double` };
  }
  if (fn === "MIN" || fn === "MAX") {
    let best = uniq[0]!;
    for (let i = 1; i < uniq.length; i++) {
      const cur = uniq[i]!;
      const bn = toNumber(best);
      const cn = toNumber(cur);
      const cmp = bn !== null && cn !== null ? cn - bn : cur.value.localeCompare(best.value);
      if ((fn === "MIN" && cmp < 0) || (fn === "MAX" && cmp > 0)) best = cur;
    }
    return best;
  }
  return undefined;
}

// ── Property Path & Pattern Evaluation ───────────────────────────────────────

function evalPathPairs(
  path: SparqlPropertyPath,
  source: SparqlTripleSource,
  boundSubj: Exclude<SparqlTerm, { termType: "Variable" }> | null,
  boundObj: Exclude<SparqlTerm, { termType: "Variable" }> | null,
  graph: { termType: "NamedNode"; value: string } | null,
): Array<[Exclude<SparqlTerm, { termType: "Variable" }>, Exclude<SparqlTerm, { termType: "Variable" }>]> {
  switch (path.kind) {
    case "iri": {
      const pred: { termType: "NamedNode"; value: string } = { termType: "NamedNode", value: path.iri };
      const out: Array<[Exclude<SparqlTerm, { termType: "Variable" }>, Exclude<SparqlTerm, { termType: "Variable" }>]> =
        [];
      for (const q of source.match(boundSubj, pred, boundObj, graph)) {
        out.push([q.subject, q.object]);
      }
      return out;
    }
    case "inverse": {
      return evalPathPairs(path.path, source, boundObj, boundSubj, graph).map(([s, o]) => [o, s]);
    }
    case "alternation": {
      const seen = new Set<string>();
      const out: Array<[Exclude<SparqlTerm, { termType: "Variable" }>, Exclude<SparqlTerm, { termType: "Variable" }>]> =
        [];
      for (const b of path.branches) {
        for (const pair of evalPathPairs(b, source, boundSubj, boundObj, graph)) {
          const k = `${termKey(pair[0])}\0${termKey(pair[1])}`;
          if (!seen.has(k)) {
            seen.add(k);
            out.push(pair);
          }
        }
      }
      return out;
    }
    case "sequence": {
      if (path.steps.length === 0) return [];
      let curr = evalPathPairs(path.steps[0]!, source, boundSubj, null, graph);
      for (let i = 1; i < path.steps.length; i++) {
        const step = path.steps[i]!;
        const isLast = i === path.steps.length - 1;
        const next: Array<
          [Exclude<SparqlTerm, { termType: "Variable" }>, Exclude<SparqlTerm, { termType: "Variable" }>]
        > = [];
        const seen = new Set<string>();
        for (const [start, mid] of curr) {
          for (const [, end] of evalPathPairs(step, source, mid, isLast ? boundObj : null, graph)) {
            const k = `${termKey(start)}\0${termKey(end)}`;
            if (!seen.has(k)) {
              seen.add(k);
              next.push([start, end]);
            }
          }
        }
        curr = next;
        if (curr.length === 0) break;
      }
      return curr;
    }
    case "zeroOrOne": {
      const seen = new Set<string>();
      const out: Array<[Exclude<SparqlTerm, { termType: "Variable" }>, Exclude<SparqlTerm, { termType: "Variable" }>]> =
        [];
      if (boundSubj && (!boundObj || termsEqual(boundSubj, boundObj))) {
        seen.add(`${termKey(boundSubj)}\0${termKey(boundSubj)}`);
        out.push([boundSubj, boundSubj]);
      } else if (boundObj && !boundSubj) {
        seen.add(`${termKey(boundObj)}\0${termKey(boundObj)}`);
        out.push([boundObj, boundObj]);
      }
      for (const pair of evalPathPairs(path.path, source, boundSubj, boundObj, graph)) {
        const k = `${termKey(pair[0])}\0${termKey(pair[1])}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push(pair);
        }
      }
      return out;
    }
    case "negatedPropertySet": {
      const excluded = new Set(path.iris);
      const out: Array<[Exclude<SparqlTerm, { termType: "Variable" }>, Exclude<SparqlTerm, { termType: "Variable" }>]> =
        [];
      for (const q of source.match(boundSubj, null, boundObj, graph)) {
        if (!excluded.has(q.predicate.value)) {
          out.push([q.subject, q.object]);
        }
      }
      return out;
    }
    case "oneOrMore":
    case "zeroOrMore": {
      const includeZero = path.kind === "zeroOrMore";
      const allStarts: Exclude<SparqlTerm, { termType: "Variable" }>[] = [];
      if (boundSubj) {
        allStarts.push(boundSubj);
      } else {
        const seenStart = new Set<string>();
        for (const [s] of evalPathPairs(path.path, source, null, null, graph)) {
          const k = termKey(s);
          if (!seenStart.has(k)) {
            seenStart.add(k);
            allStarts.push(s);
          }
        }
      }

      const out: Array<[Exclude<SparqlTerm, { termType: "Variable" }>, Exclude<SparqlTerm, { termType: "Variable" }>]> =
        [];
      for (const start of allStarts) {
        const visited = new Set<string>();
        const queue: Exclude<SparqlTerm, { termType: "Variable" }>[] = [start];
        if (includeZero) {
          visited.add(termKey(start));
          if (!boundObj || termsEqual(start, boundObj)) out.push([start, start]);
        }
        let head = 0;
        while (head < queue.length) {
          const cur = queue[head++]!;
          for (const [, nxt] of evalPathPairs(path.path, source, cur, null, graph)) {
            const nk = termKey(nxt);
            if (!visited.has(nk)) {
              visited.add(nk);
              queue.push(nxt);
              if (!boundObj || termsEqual(nxt, boundObj)) out.push([start, nxt]);
            }
          }
        }
      }
      return out;
    }
  }
}

function evalTriplePattern(
  pat: SparqlTriplePattern,
  envs: SparqlBindingRow[],
  source: SparqlTripleSource,
  graph: { termType: "NamedNode"; value: string } | null,
): SparqlBindingRow[] {
  const next: SparqlBindingRow[] = [];
  for (const env of envs) {
    const sVal = resolveTermInEnv(pat.subject, env);
    const oVal = resolveTermInEnv(pat.object, env);

    if (pat.predicate.termType === "PropertyPath") {
      for (const [s, o] of evalPathPairs(pat.predicate.path, source, sVal, oVal, graph)) {
        if (
          pat.subject.termType === "Variable" &&
          pat.object.termType === "Variable" &&
          pat.subject.value === pat.object.value &&
          !termsEqual(s, o)
        ) {
          continue;
        }
        const row: SparqlBindingRow = { ...env };
        if (pat.subject.termType === "Variable") row[pat.subject.value] = s;
        if (pat.object.termType === "Variable") row[pat.object.value] = o;
        next.push(row);
      }
      continue;
    }

    const pVal = resolveTermInEnv(pat.predicate, env);
    const pNamed = pVal && pVal.termType === "NamedNode" ? pVal : null;
    if (pVal && pVal.termType !== "NamedNode") continue;

    for (const q of source.match(sVal, pNamed, oVal, graph)) {
      if (
        pat.subject.termType === "Variable" &&
        pat.object.termType === "Variable" &&
        pat.subject.value === pat.object.value &&
        !termsEqual(q.subject, q.object)
      ) {
        continue;
      }
      const row: SparqlBindingRow = { ...env };
      if (pat.subject.termType === "Variable") row[pat.subject.value] = q.subject;
      if (pat.predicate.termType === "Variable") row[pat.predicate.value] = q.predicate;
      if (pat.object.termType === "Variable") row[pat.object.value] = q.object;
      next.push(row);
    }
  }
  return next;
}

function areCompatible(a: SparqlBindingRow, b: SparqlBindingRow): boolean {
  for (const k of Object.keys(b)) {
    if (a[k] !== undefined && !termsEqual(a[k]!, b[k]!)) return false;
  }
  return true;
}

/**
 * Generalized Leapfrog Triejoin (Worst-Case Optimal Join) for multi-pattern BGPs without
 * property paths. Chooses variables in decreasing incidence-degree order and intersects sorted
 * candidate term arrays via binary-search leapfrogging across all patterns sharing that variable.
 */
function evalBgpLeapfrog(
  triples: SparqlTriplePattern[],
  initialEnvs: SparqlBindingRow[],
  source: SparqlTripleSource,
  graph: { termType: "NamedNode"; value: string } | null,
): SparqlBindingRow[] {
  // Collect all variables and their pattern-incidence degree
  const varDegree = new Map<string, number>();
  const addVar = (t: SparqlTerm): void => {
    if (t.termType === "Variable") varDegree.set(t.value, (varDegree.get(t.value) ?? 0) + 1);
  };
  for (const tp of triples) {
    addVar(tp.subject);
    if (tp.predicate.termType !== "PropertyPath") addVar(tp.predicate);
    addVar(tp.object);
  }
  const orderedVars = [...varDegree.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);

  // Intersect sorted arrays of (key, term) using multi-way leapfrog binary search
  const leapfrogIntersect = (
    lists: Array<Array<{ key: string; term: Exclude<SparqlTerm, { termType: "Variable" }> }>>,
  ): Array<Exclude<SparqlTerm, { termType: "Variable" }>> => {
    if (lists.length === 0) return [];
    if (lists.some((l) => l.length === 0)) return [];
    if (lists.length === 1) return lists[0]!.map((x) => x.term);

    const k = lists.length;
    const idxs = new Array<number>(k).fill(0);
    // Order lists by first key
    const order = Array.from({ length: k }, (_, i) => i).sort((a, b) =>
      lists[a]![0]!.key.localeCompare(lists[b]![0]!.key),
    );
    let p = 0;
    let maxKey = lists[order[k - 1]!]![0]!.key;
    const out: Array<Exclude<SparqlTerm, { termType: "Variable" }>> = [];

    const seek = (
      arr: Array<{ key: string; term: Exclude<SparqlTerm, { termType: "Variable" }> }>,
      loStart: number,
      target: string,
    ): number => {
      let lo = loStart;
      let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid]!.key < target) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };

    while (true) {
      const listIdx = order[p]!;
      const arr = lists[listIdx]!;
      const curKey = arr[idxs[listIdx]!]!.key;
      if (curKey === maxKey) {
        out.push(arr[idxs[listIdx]!]!.term);
        idxs[listIdx]!++;
        if (idxs[listIdx]! >= arr.length) break;
        maxKey = arr[idxs[listIdx]!]!.key;
        p = (p + 1) % k;
      } else {
        const nextPos = seek(arr, idxs[listIdx]!, maxKey);
        if (nextPos >= arr.length) break;
        idxs[listIdx] = nextPos;
        maxKey = arr[nextPos]!.key;
        p = (p + 1) % k;
      }
    }
    return out;
  };

  const results: SparqlBindingRow[] = [];

  const search = (env: SparqlBindingRow, varIdx: number): void => {
    // Check any fully bound patterns early (pruning)
    for (const tp of triples) {
      if (tp.predicate.termType === "PropertyPath") continue;
      const s = resolveTermInEnv(tp.subject, env);
      const p = resolveTermInEnv(tp.predicate, env);
      const o = resolveTermInEnv(tp.object, env);
      if (s && p && o) {
        if (p.termType !== "NamedNode") return;
        let found = false;
        for (const _q of source.match(s, p, o, graph)) {
          found = true;
          break;
        }
        if (!found) return;
      }
    }

    if (varIdx >= orderedVars.length) {
      results.push(env);
      return;
    }

    const vName = orderedVars[varIdx]!;
    if (env[vName] !== undefined) {
      search(env, varIdx + 1);
      return;
    }

    const candidateLists: Array<Array<{ key: string; term: Exclude<SparqlTerm, { termType: "Variable" }> }>> = [];
    for (const tp of triples) {
      if (tp.predicate.termType === "PropertyPath") continue;
      const inS = tp.subject.termType === "Variable" && tp.subject.value === vName;
      const inP = tp.predicate.termType === "Variable" && tp.predicate.value === vName;
      const inO = tp.object.termType === "Variable" && tp.object.value === vName;
      if (!inS && !inP && !inO) continue;

      const sVal = resolveTermInEnv(tp.subject, env);
      const pVal = resolveTermInEnv(tp.predicate, env);
      const oVal = resolveTermInEnv(tp.object, env);
      if (pVal && pVal.termType !== "NamedNode") return;
      const pNamed = pVal && pVal.termType === "NamedNode" ? pVal : null;

      const uniq = new Map<string, Exclude<SparqlTerm, { termType: "Variable" }>>();
      for (const q of source.match(sVal, pNamed, oVal, graph)) {
        const cand = inS ? q.subject : inP ? q.predicate : q.object;
        if (inS && inO && !termsEqual(q.subject, q.object)) continue;
        if (inS && inP && !termsEqual(q.subject, q.predicate)) continue;
        if (inP && inO && !termsEqual(q.predicate, q.object)) continue;
        uniq.set(termKey(cand), cand);
      }
      const sorted = [...uniq.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([key, term]) => ({ key, term }));
      if (sorted.length === 0) return;
      candidateLists.push(sorted);
    }

    const commonTerms = leapfrogIntersect(candidateLists);
    for (const term of commonTerms) {
      search({ ...env, [vName]: term }, varIdx + 1);
    }
  };

  for (const env of initialEnvs) {
    search(env, 0);
  }
  return results;
}

function evalGraphPattern(
  pat: SparqlGraphPattern,
  envs: SparqlBindingRow[],
  source: SparqlTripleSource,
  graph: { termType: "NamedNode"; value: string } | null,
  options: SparqlExecutionOptions,
): SparqlBindingRow[] {
  switch (pat.kind) {
    case "bgp": {
      if (pat.triples.length >= 2 && pat.triples.every((t) => t.predicate.termType !== "PropertyPath")) {
        return evalBgpLeapfrog(pat.triples, envs, source, graph);
      }
      let cur = envs;
      for (const tp of pat.triples) {
        cur = evalTriplePattern(tp, cur, source, graph);
        if (cur.length === 0) break;
      }
      return cur;
    }
    case "subselect": {
      const subRes = executeSparqlAlgebra(pat.query, source, options);
      if (subRes.queryType !== "SELECT") return envs;
      const out: SparqlBindingRow[] = [];
      for (const l of envs) {
        for (const r of subRes.bindings) {
          if (areCompatible(l, r)) out.push({ ...l, ...r });
        }
      }
      return out;
    }
    case "group": {
      let cur = envs;
      for (const sub of pat.patterns) {
        cur = evalGraphPattern(sub, cur, source, graph, options);
        if (cur.length === 0 && sub.kind !== "optional") break;
      }
      return cur;
    }
    case "optional": {
      const out: SparqlBindingRow[] = [];
      for (const env of envs) {
        const matched = evalGraphPattern(pat.pattern, [env], source, graph, options);
        if (matched.length > 0) out.push(...matched);
        else out.push(env);
      }
      return out;
    }
    case "union": {
      const out: SparqlBindingRow[] = [];
      for (const branch of pat.branches) {
        out.push(...evalGraphPattern(branch, envs, source, graph, options));
      }
      return out;
    }
    case "minus": {
      const rhs = evalGraphPattern(pat.pattern, [{}], source, graph, options);
      return envs.filter((l) => {
        const lKeys = new Set(Object.keys(l));
        return !rhs.some((r) => {
          const rKeys = Object.keys(r);
          const sharesVar = rKeys.some((k) => lKeys.has(k));
          return sharesVar && areCompatible(l, r);
        });
      });
    }
    case "graph": {
      if (pat.graph.termType === "NamedNode") {
        return evalGraphPattern(pat.pattern, envs, source, pat.graph, options);
      }
      return evalGraphPattern(pat.pattern, envs, source, graph, options);
    }
    case "service": {
      if (options.disallowService !== false) {
        throw new Error("Federated SPARQL SERVICE clauses are not permitted");
      }
      return pat.silent ? envs : [];
    }
    case "filter": {
      return envs.filter((env) => effectiveBooleanValue(evalExpr(pat.expr, env)));
    }
    case "bind": {
      return envs.map((env) => {
        const val = evalExpr(pat.expr, env);
        return val !== undefined ? { ...env, [pat.variable]: val } : env;
      });
    }
    case "values": {
      const out: SparqlBindingRow[] = [];
      for (const env of envs) {
        for (const r of pat.rows) {
          const cand: SparqlBindingRow = { ...env };
          let ok = true;
          for (let i = 0; i < pat.variables.length; i++) {
            const vName = pat.variables[i]!;
            const val = r[i];
            if (val === null || val === undefined) continue;
            if (val.termType === "Variable") continue;
            if (cand[vName] !== undefined && !termsEqual(cand[vName]!, val)) {
              ok = false;
              break;
            }
            cand[vName] = val;
          }
          if (ok) out.push(cand);
        }
      }
      return out;
    }
  }
}

function hasAggregateCall(expr: SparqlExpr): boolean {
  if (expr.kind === "call") {
    if (["COUNT", "SUM", "AVG", "MIN", "MAX", "GROUP_CONCAT", "SAMPLE"].includes(expr.fn.toUpperCase())) return true;
    return expr.args.some(hasAggregateCall);
  }
  if (expr.kind === "unary") return hasAggregateCall(expr.arg);
  if (expr.kind === "binary") return hasAggregateCall(expr.left) || hasAggregateCall(expr.right);
  if (expr.kind === "in") return hasAggregateCall(expr.expr) || expr.list.some(hasAggregateCall);
  return false;
}

/**
 * Executes a lowered `SparqlQuery` algebra object against any `SparqlTripleSource`.
 */
export function executeSparqlAlgebra(
  query: SparqlQuery,
  source: SparqlTripleSource,
  options: SparqlExecutionOptions = {},
): SparqlExecutionResult {
  const start = performance.now();
  if (query.hasServiceClause && options.disallowService !== false) {
    throw new Error("Federated SPARQL SERVICE clauses are not permitted");
  }

  let rows = evalGraphPattern(query.where, [{}], source, null, options);
  if (query.trailingValues) {
    rows = evalGraphPattern({ kind: "values", ...query.trailingValues }, rows, source, null, options);
  }

  if (query.queryType === "ASK") {
    const result = rows.length > 0;
    return {
      queryType: "ASK",
      boolean: result,
      json: { head: {}, boolean: result },
      executionTimeMs: performance.now() - start,
    };
  }

  // GROUP BY & Aggregates
  const needsAggregation =
    query.modifier.groupBy.length > 0 || (query.projections?.some((p) => p.expr && hasAggregateCall(p.expr)) ?? false);

  if (needsAggregation) {
    const groups = new Map<string, { keyRow: SparqlBindingRow; rows: SparqlBindingRow[] }>();
    for (const r of rows) {
      const keyParts: string[] = [];
      const keyRow: SparqlBindingRow = {};
      for (const gc of query.modifier.groupBy) {
        const v = evalExpr(gc.expr, r);
        keyParts.push(v ? termKey(v) : "UNDEF");
        if (v) {
          if (gc.alias) keyRow[gc.alias] = v;
          else if (gc.expr.kind === "term" && gc.expr.term.termType === "Variable") {
            keyRow[gc.expr.term.value] = v;
          }
        }
      }
      const gk = keyParts.join("\0");
      const entry = groups.get(gk);
      if (entry) entry.rows.push(r);
      else groups.set(gk, { keyRow, rows: [r] });
    }
    if (groups.size === 0 && query.modifier.groupBy.length === 0) {
      groups.set("", { keyRow: {}, rows: [] });
    }

    const aggregatedRows: SparqlBindingRow[] = [];
    for (const { keyRow, rows: gRows } of groups.values()) {
      const baseRow: SparqlBindingRow = { ...(gRows[0] ?? {}), ...keyRow };
      if (query.modifier.having.length > 0) {
        const ok = query.modifier.having.every((h) => effectiveBooleanValue(evalExpr(h, baseRow, gRows)));
        if (!ok) continue;
      }
      const outRow: SparqlBindingRow = { ...keyRow };
      if (query.projections) {
        for (const p of query.projections) {
          if (p.expr) {
            const val = evalExpr(p.expr, baseRow, gRows);
            if (val !== undefined) outRow[p.variable] = val;
          } else if (baseRow[p.variable] !== undefined) {
            outRow[p.variable] = baseRow[p.variable]!;
          }
        }
      }
      aggregatedRows.push(outRow);
    }
    rows = aggregatedRows;
  } else if (query.queryType === "SELECT" && !query.star && query.projections) {
    rows = rows.map((r) => {
      const projRow: SparqlBindingRow = {};
      for (const p of query.projections!) {
        if (p.expr) {
          const val = evalExpr(p.expr, r);
          if (val !== undefined) projRow[p.variable] = val;
        } else if (r[p.variable] !== undefined) {
          projRow[p.variable] = r[p.variable]!;
        }
      }
      return projRow;
    });
  }

  // ORDER BY
  if (query.modifier.orderBy.length > 0) {
    rows = [...rows].sort((a, b) => {
      for (const cond of query.modifier.orderBy) {
        const av = evalExpr(cond.expr, a);
        const bv = evalExpr(cond.expr, b);
        if (!av && !bv) continue;
        if (!av) return cond.direction === "ASC" ? -1 : 1;
        if (!bv) return cond.direction === "ASC" ? 1 : -1;
        const an = toNumber(av);
        const bn = toNumber(bv);
        const cmp = an !== null && bn !== null ? an - bn : av.value.localeCompare(bv.value);
        if (cmp !== 0) return cond.direction === "ASC" ? cmp : -cmp;
      }
      return 0;
    });
  }

  // DISTINCT / REDUCED
  if (query.distinct || query.reduced) {
    const seen = new Set<string>();
    const deduped: SparqlBindingRow[] = [];
    for (const r of rows) {
      const key = Object.keys(r)
        .sort()
        .map((k) => `${k}=${termKey(r[k]!)}`)
        .join("\0");
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(r);
      }
    }
    rows = deduped;
  }

  // OFFSET / LIMIT
  const offset = query.modifier.offset ?? 0;
  const maxBindings = options.maxBindings ?? 50000;
  const limit = query.modifier.limit !== undefined ? Math.min(query.modifier.limit, maxBindings) : maxBindings;
  rows = rows.slice(offset, offset + limit);

  if (query.queryType === "CONSTRUCT") {
    const quads: SparqlQuad[] = [];
    const seen = new Set<string>();
    for (const env of rows) {
      for (const tp of query.template ?? []) {
        const s = resolveTermInEnv(tp.subject, env);
        const p = tp.predicate.termType === "PropertyPath" ? null : resolveTermInEnv(tp.predicate, env);
        const o = resolveTermInEnv(tp.object, env);
        if (!s || !p || p.termType !== "NamedNode" || !o) continue;
        const k = `${termKey(s)}\0${p.value}\0${termKey(o)}`;
        if (!seen.has(k)) {
          seen.add(k);
          quads.push({ subject: s, predicate: p, object: o });
        }
      }
    }
    return { queryType: "CONSTRUCT", quads, executionTimeMs: performance.now() - start };
  }

  if (query.queryType === "DESCRIBE") {
    const targets: Array<Exclude<SparqlTerm, { termType: "Variable" }>> = [];
    const seenTarget = new Set<string>();
    const addTarget = (t: Exclude<SparqlTerm, { termType: "Variable" }>): void => {
      const k = termKey(t);
      if (!seenTarget.has(k)) {
        seenTarget.add(k);
        targets.push(t);
      }
    };
    if (query.star) {
      for (const env of rows) {
        for (const v of Object.values(env)) addTarget(v);
      }
    } else {
      for (const t of query.describeTargets ?? []) {
        if (t.termType === "Variable") {
          for (const env of rows) {
            const v = env[t.value];
            if (v) addTarget(v);
          }
        } else {
          addTarget(t);
        }
      }
    }
    const quads: SparqlQuad[] = [];
    const seen = new Set<string>();
    for (const t of targets) {
      for (const q of source.match(t, null, null, null)) {
        const k = `${termKey(q.subject)}\0${q.predicate.value}\0${termKey(q.object)}`;
        if (!seen.has(k)) {
          seen.add(k);
          quads.push(q);
        }
      }
    }
    return { queryType: "DESCRIBE", quads, executionTimeMs: performance.now() - start };
  }

  // SELECT
  const variables: string[] = query.star
    ? Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
    : (query.projections ?? []).map((p) => p.variable);

  const jsonBindings = rows.map((r) => {
    const out: Record<string, SparqlJsonTerm> = {};
    for (const v of variables) {
      const t = r[v];
      if (t) out[v] = toJsonTerm(t);
    }
    return out;
  });

  return {
    queryType: "SELECT",
    variables,
    bindings: rows,
    json: { head: { vars: variables }, results: { bindings: jsonBindings } },
    executionTimeMs: performance.now() - start,
  };
}

/**
 * Parses and executes a SPARQL 1.1 Update (`INSERT DATA`, `DELETE DATA`, `DELETE/INSERT WHERE`)
 * against a `SparqlMutableTripleSource`.
 */
export function executeSparqlUpdate(
  parser: { parse(text: string): { rootNode: GenericSyntaxNode } },
  updateText: string,
  source: SparqlMutableTripleSource,
  options: SparqlExecutionOptions = {},
): SparqlUpdateResult {
  const start = performance.now();
  const tree = parser.parse(updateText);
  const root = tree?.rootNode;
  if (!root) throw new Error("SPARQL parser returned an empty parse tree");
  const hasErr = typeof root.hasError === "function" ? root.hasError() : Boolean(root.hasError);
  if (hasErr) throw new Error("SPARQL syntax error in update");

  const algebra = lowerSparqlCst(root, updateText);
  if (algebra.queryType !== "INSERT_DATA" && algebra.queryType !== "DELETE_DATA" && algebra.queryType !== "MODIFY") {
    throw new Error(`Expected SPARQL Update operation, got ${algebra.queryType}`);
  }
  if (algebra.hasServiceClause && options.disallowService !== false) {
    throw new Error("Federated SPARQL SERVICE clauses are not permitted");
  }

  let insertedCount = 0;
  let deletedCount = 0;

  const instantiateQuads = (patterns: SparqlTriplePattern[] | undefined, env: SparqlBindingRow): SparqlQuad[] => {
    const out: SparqlQuad[] = [];
    for (const tp of patterns ?? []) {
      const s = resolveTermInEnv(tp.subject, env);
      const p = tp.predicate.termType === "PropertyPath" ? null : resolveTermInEnv(tp.predicate, env);
      const o = resolveTermInEnv(tp.object, env);
      if (s && p && p.termType === "NamedNode" && o) {
        out.push({ subject: s, predicate: p, object: o });
      }
    }
    return out;
  };

  if (algebra.queryType === "INSERT_DATA") {
    for (const q of instantiateQuads(algebra.insertTemplate, {})) {
      if (source.addQuad(q)) insertedCount++;
    }
  } else if (algebra.queryType === "DELETE_DATA") {
    for (const q of instantiateQuads(algebra.deleteTemplate, {})) {
      if (source.deleteQuad(q)) deletedCount++;
    }
  } else {
    const rows = evalGraphPattern(algebra.where, [{}], source, null, options);
    const toDelete: SparqlQuad[] = [];
    const toInsert: SparqlQuad[] = [];
    for (const env of rows) {
      toDelete.push(...instantiateQuads(algebra.deleteTemplate, env));
      toInsert.push(...instantiateQuads(algebra.insertTemplate, env));
    }
    for (const q of toDelete) {
      if (source.deleteQuad(q)) deletedCount++;
    }
    for (const q of toInsert) {
      if (source.addQuad(q)) insertedCount++;
    }
  }

  return {
    queryType: algebra.queryType,
    insertedCount,
    deletedCount,
    executionTimeMs: performance.now() - start,
  };
}

/**
 * Parses a SPARQL 1.1 query using the native WASM GLR parser and executes it against `source`.
 */
export function executeSparqlQuery(
  parser: { parse(text: string): { rootNode: GenericSyntaxNode } },
  queryText: string,
  source: SparqlTripleSource,
  options: SparqlExecutionOptions = {},
): SparqlExecutionResult {
  const tree = parser.parse(queryText);
  const root = tree?.rootNode;
  if (!root) {
    throw new Error("SPARQL parser returned an empty parse tree");
  }
  const hasErr = typeof root.hasError === "function" ? root.hasError() : Boolean(root.hasError);
  if (hasErr) {
    throw new Error("SPARQL syntax error in query");
  }
  const algebra = lowerSparqlCst(root, queryText);
  return executeSparqlAlgebra(algebra, source, options);
}
