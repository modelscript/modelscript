// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OWL2Axiom } from "@modelscript/runtime";
import type { SparqlGraphPattern, SparqlQuery, SparqlTerm, SparqlTriplePattern } from "./ast.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

interface QlTBoxIndex {
  /** Class -> all transitive subclasses (including self and equivalents). */
  subClassesOf: Map<string, Set<string>>;
  /** Class -> object properties whose domain is a subclass of this class. */
  domainPropsOf: Map<string, Set<string>>;
  /** Class -> object properties whose range is a subclass of this class. */
  rangePropsOf: Map<string, Set<string>>;
  /** Class -> data properties whose domain is a subclass of this class. */
  dataDomainPropsOf: Map<string, Set<string>>;
  /** Property -> all transitive subproperties (with `inverse: boolean` flag). */
  subPropsOf: Map<string, Array<{ iri: string; inverse: boolean }>>;
}

function buildQlTBoxIndex(axioms: readonly OWL2Axiom[]): QlTBoxIndex {
  const directSub = new Map<string, Set<string>>();
  const directPropSub = new Map<string, Array<{ iri: string; inverse: boolean }>>();
  const rawDomains: Array<{ prop: string; cls: string }> = [];
  const rawRanges: Array<{ prop: string; cls: string }> = [];
  const rawDataDomains: Array<{ prop: string; cls: string }> = [];

  const addSub = (sup: string, sub: string) => {
    let set = directSub.get(sup);
    if (!set) {
      set = new Set();
      directSub.set(sup, set);
    }
    set.add(sub);
  };

  const addPropSub = (sup: string, sub: string, inverse: boolean) => {
    let list = directPropSub.get(sup);
    if (!list) {
      list = [];
      directPropSub.set(sup, list);
    }
    if (!list.some((x) => x.iri === sub && x.inverse === inverse)) {
      list.push({ iri: sub, inverse });
    }
  };

  for (const ax of axioms) {
    switch (ax.type) {
      case "SubClassOf":
        addSub(ax.superClassIri, ax.subClassIri);
        break;
      case "EquivalentClasses":
        for (let i = 0; i < ax.classIris.length; i++) {
          for (let j = 0; j < ax.classIris.length; j++) {
            if (i !== j) addSub(ax.classIris[i]!, ax.classIris[j]!);
          }
        }
        break;
      case "SubObjectPropertyOf":
        addPropSub(ax.superPropertyIri, ax.subPropertyIri, false);
        break;
      case "SubDataPropertyOf":
        addPropSub(ax.superPropertyIri, ax.subPropertyIri, false);
        break;
      case "InverseObjectProperty":
        addPropSub(ax.propertyIri, ax.inversePropertyIri, true);
        addPropSub(ax.inversePropertyIri, ax.propertyIri, true);
        break;
      case "SymmetricObjectProperty":
        addPropSub(ax.propertyIri, ax.propertyIri, true);
        break;
      case "ObjectPropertyDomain":
        rawDomains.push({ prop: ax.propertyIri, cls: ax.domainIri });
        break;
      case "ObjectPropertyRange":
        rawRanges.push({ prop: ax.propertyIri, cls: ax.rangeIri });
        break;
      case "DataPropertyDomain":
        rawDataDomains.push({ prop: ax.propertyIri, cls: ax.domainIri });
        break;
    }
  }

  // Compute transitive subclass closure (sup -> all subs)
  const subClassesOf = new Map<string, Set<string>>();
  const computeSubs = (cls: string): Set<string> => {
    const cached = subClassesOf.get(cls);
    if (cached) return cached;
    const visited = new Set<string>([cls]);
    const queue = [cls];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      const children = directSub.get(cur);
      if (!children) continue;
      for (const ch of children) {
        if (!visited.has(ch)) {
          visited.add(ch);
          queue.push(ch);
        }
      }
    }
    subClassesOf.set(cls, visited);
    return visited;
  };

  for (const sup of directSub.keys()) computeSubs(sup);

  // Compute transitive subproperty closure (with inverse parity)
  const subPropsOf = new Map<string, Array<{ iri: string; inverse: boolean }>>();
  const computeSubProps = (prop: string): Array<{ iri: string; inverse: boolean }> => {
    const cached = subPropsOf.get(prop);
    if (cached) return cached;
    const seen = new Set<string>([`${prop}|0`]);
    const result: Array<{ iri: string; inverse: boolean }> = [{ iri: prop, inverse: false }];
    let head = 0;
    while (head < result.length) {
      const cur = result[head++]!;
      const children = directPropSub.get(cur.iri);
      if (!children) continue;
      for (const ch of children) {
        const nextInv = cur.inverse !== ch.inverse;
        const key = `${ch.iri}|${nextInv ? 1 : 0}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ iri: ch.iri, inverse: nextInv });
        }
      }
    }
    subPropsOf.set(prop, result);
    return result;
  };

  for (const sup of directPropSub.keys()) computeSubProps(sup);

  // Propagate domain/range axioms upward to all superclasses of domain/range
  const domainPropsOf = new Map<string, Set<string>>();
  const rangePropsOf = new Map<string, Set<string>>();
  const dataDomainPropsOf = new Map<string, Set<string>>();

  // Build reverse (sub -> sups) map from subClassesOf
  const superClassesOf = new Map<string, Set<string>>();
  for (const [sup, subs] of subClassesOf) {
    for (const sub of subs) {
      let s = superClassesOf.get(sub);
      if (!s) {
        s = new Set();
        superClassesOf.set(sub, s);
      }
      s.add(sup);
    }
  }

  for (const { prop, cls } of rawDomains) {
    const targets = superClassesOf.get(cls) ?? new Set([cls]);
    const props = computeSubProps(prop);
    for (const targetCls of targets) {
      let dSet = domainPropsOf.get(targetCls);
      if (!dSet) {
        dSet = new Set();
        domainPropsOf.set(targetCls, dSet);
      }
      for (const p of props) {
        if (!p.inverse) dSet.add(p.iri);
      }
    }
  }

  for (const { prop, cls } of rawRanges) {
    const targets = superClassesOf.get(cls) ?? new Set([cls]);
    const props = computeSubProps(prop);
    for (const targetCls of targets) {
      let rSet = rangePropsOf.get(targetCls);
      if (!rSet) {
        rSet = new Set();
        rangePropsOf.set(targetCls, rSet);
      }
      for (const p of props) {
        if (!p.inverse) rSet.add(p.iri);
      }
    }
  }

  for (const { prop, cls } of rawDataDomains) {
    const targets = superClassesOf.get(cls) ?? new Set([cls]);
    for (const targetCls of targets) {
      let dSet = dataDomainPropsOf.get(targetCls);
      if (!dSet) {
        dSet = new Set();
        dataDomainPropsOf.set(targetCls, dSet);
      }
      dSet.add(prop);
    }
  }

  return { subClassesOf, domainPropsOf, rangePropsOf, dataDomainPropsOf, subPropsOf };
}

function termSignature(t: SparqlTerm): string {
  if (t.termType === "Variable") return `?${t.value}`;
  if (t.termType === "NamedNode") return `<${t.value}>`;
  if (t.termType === "BlankNode") return `_:${t.value}`;
  return `"${t.value}"`;
}

function tripleSignature(tp: SparqlTriplePattern): string {
  const p = tp.predicate.termType === "PropertyPath" ? "PATH" : termSignature(tp.predicate);
  return `${termSignature(tp.subject)} ${p} ${termSignature(tp.object)}`;
}

/**
 * Rewrites a SPARQL 1.1 `SparqlQuery` algebra using OWL 2 QL backward-chaining (PerfectRef-style)
 * over the provided TBox axioms.
 *
 * Enables **zero-materialization virtual inferred querying** over raw ABox triple stores
 * (e.g., `PagedStorageEngine` with millions of explicit triples): queries for superclasses,
 * superproperties, inverse properties, and domain/range-inferred types are expanded into a
 * `UNION` of explicit BGPs.
 */
export function rewriteSparqlQueryOwl2QL(
  query: SparqlQuery,
  tboxAxioms: readonly OWL2Axiom[],
  options: { maxUnionBranches?: number | undefined } = {},
): SparqlQuery {
  const maxBranches = options.maxUnionBranches ?? 256;
  const idx = buildQlTBoxIndex(tboxAxioms);
  let freshCounter = 0;

  const rewriteTriple = (tp: SparqlTriplePattern): SparqlTriplePattern[] => {
    if (tp.predicate.termType !== "NamedNode") return [tp];

    const predIri = tp.predicate.value;
    const out: SparqlTriplePattern[] = [];
    const seen = new Set<string>();
    const addUnique = (cand: SparqlTriplePattern) => {
      const sig = tripleSignature(cand);
      if (!seen.has(sig)) {
        seen.add(sig);
        out.push(cand);
      }
    };

    // Case 1: (?x, rdf:type, C) with bound named class C
    if (predIri === RDF_TYPE && tp.object.termType === "NamedNode") {
      const cls = tp.object.value;
      const subs = idx.subClassesOf.get(cls) ?? new Set([cls]);
      for (const subCls of subs) {
        addUnique({
          subject: tp.subject,
          predicate: tp.predicate,
          object: { termType: "NamedNode", value: subCls },
        });
      }
      const domProps = idx.domainPropsOf.get(cls);
      if (domProps) {
        for (const pIri of domProps) {
          addUnique({
            subject: tp.subject,
            predicate: { termType: "NamedNode", value: pIri },
            object: { termType: "Variable", value: `__ql_dom_${freshCounter++}` },
          });
        }
      }
      const rngProps = idx.rangePropsOf.get(cls);
      if (rngProps) {
        for (const pIri of rngProps) {
          addUnique({
            subject: { termType: "Variable", value: `__ql_rng_${freshCounter++}` },
            predicate: { termType: "NamedNode", value: pIri },
            object: tp.subject,
          });
        }
      }
      const dataDomProps = idx.dataDomainPropsOf.get(cls);
      if (dataDomProps) {
        for (const pIri of dataDomProps) {
          addUnique({
            subject: tp.subject,
            predicate: { termType: "NamedNode", value: pIri },
            object: { termType: "Variable", value: `__ql_ddom_${freshCounter++}` },
          });
        }
      }
      return out.length > 0 ? out : [tp];
    }

    // Case 2: (?x, P, ?y) with bound object/data property P
    const subProps = idx.subPropsOf.get(predIri);
    if (subProps && subProps.length > 1) {
      for (const sp of subProps) {
        addUnique(
          sp.inverse
            ? {
                subject: tp.object,
                predicate: { termType: "NamedNode", value: sp.iri },
                object: tp.subject,
              }
            : {
                subject: tp.subject,
                predicate: { termType: "NamedNode", value: sp.iri },
                object: tp.object,
              },
        );
      }
      return out;
    }

    return [tp];
  };

  const rewritePattern = (pat: SparqlGraphPattern): SparqlGraphPattern => {
    switch (pat.kind) {
      case "bgp": {
        const perTriple = pat.triples.map(rewriteTriple);
        if (perTriple.every((alts) => alts.length === 1)) {
          return pat;
        }
        // Cartesian product across triple alternatives (capped at maxBranches)
        let branches: SparqlTriplePattern[][] = [[]];
        for (const alts of perTriple) {
          const next: SparqlTriplePattern[][] = [];
          for (const prefix of branches) {
            for (const alt of alts) {
              next.push([...prefix, alt]);
              if (next.length >= maxBranches) break;
            }
            if (next.length >= maxBranches) break;
          }
          branches = next;
        }
        if (branches.length === 1) {
          return { kind: "bgp", triples: branches[0]! };
        }
        return {
          kind: "union",
          branches: branches.map((triples) => ({ kind: "bgp" as const, triples })),
        };
      }
      case "group":
        return { kind: "group", patterns: pat.patterns.map(rewritePattern) };
      case "union":
        return { kind: "union", branches: pat.branches.map(rewritePattern) };
      case "optional":
        return { kind: "optional", pattern: rewritePattern(pat.pattern) };
      case "minus":
        return { kind: "minus", pattern: rewritePattern(pat.pattern) };
      case "graph":
        return { kind: "graph", graph: pat.graph, pattern: rewritePattern(pat.pattern) };
      case "subselect":
        return { kind: "subselect", query: rewriteSparqlQueryOwl2QL(pat.query, tboxAxioms, options) };
      default:
        return pat;
    }
  };

  return {
    ...query,
    where: rewritePattern(query.where),
    distinct: query.distinct || true, // UCQ rewriting uses set semantics to avoid duplicate derivations
  };
}
