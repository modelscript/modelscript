// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Covering 6-Way Triple Index, Cost-Based BGP Join Evaluator,
 * Live Triple Matcher, and SPARQL 1.1 Property Path Evaluator.
 */

import type { BgpQuery, BgpQueryResult, PropertyPathOp, TriplePattern } from "./owl2-types.js";
import type { BgpCompiledIndex, ClassNode, PropertyEdge, ReasonerState } from "./reasoner-state.js";

/** Appends a single deduplicated `(s, p, o)` triple into all 6 covering maps of `idx`. */
export function bgpIndexAddFact(idx: BgpCompiledIndex, s: string, p: string, o: string): void {
  const spoKey = `${s}\0${p}\0${o}`;
  if (idx.exactSet.has(spoKey)) return;
  idx.exactSet.add(spoKey);
  idx.allFacts.push({ s, p, o });

  const spKey = `${s}\0${p}`;
  let spList = idx.bySubjPred.get(spKey);
  if (!spList) {
    spList = [];
    idx.bySubjPred.set(spKey, spList);
  }
  spList.push(o);

  const poKey = `${p}\0${o}`;
  let poList = idx.byPredObj.get(poKey);
  if (!poList) {
    poList = [];
    idx.byPredObj.set(poKey, poList);
  }
  poList.push(s);

  const soKey = `${s}\0${o}`;
  let soList = idx.bySubjObj.get(soKey);
  if (!soList) {
    soList = [];
    idx.bySubjObj.set(soKey, soList);
  }
  soList.push(p);

  let pList = idx.byPred.get(p);
  if (!pList) {
    pList = [];
    idx.byPred.set(p, pList);
  }
  pList.push({ s, o });

  let sList = idx.bySubj.get(s);
  if (!sList) {
    sList = [];
    idx.bySubj.set(s, sList);
  }
  sList.push({ p, o });

  let oList = idx.byObj.get(o);
  if (!oList) {
    oList = [];
    idx.byObj.set(o, oList);
  }
  oList.push({ s, p });
}

/** Compiles a 6-way covering BGP index from the materialized triples in `state`. */
export function buildBgpIndex(state: ReasonerState): BgpCompiledIndex {
  const idx: BgpCompiledIndex = {
    allFacts: [],
    exactSet: new Set<string>(),
    bySubjPred: new Map<string, string[]>(),
    byPredObj: new Map<string, string[]>(),
    bySubjObj: new Map<string, string[]>(),
    byPred: new Map<string, { s: string; o: string }[]>(),
    bySubj: new Map<string, { p: string; o: string }[]>(),
    byObj: new Map<string, { s: string; p: string }[]>(),
  };

  for (const [p, edges] of state.objectPropertyAssertions) {
    for (const e of edges) bgpIndexAddFact(idx, e.subjectIri, p, e.objectIri);
  }

  for (const [p, asserts] of state.dataPropertyAssertions) {
    for (const a of asserts) bgpIndexAddFact(idx, a.subjectIri, p, a.value);
  }

  for (const [ind, types] of state.individualTypes) {
    for (const t of types) bgpIndexAddFact(idx, ind, "rdf:type", t);
  }

  for (const ax of state.axioms) {
    if (ax.type === "SubClassOf") {
      bgpIndexAddFact(idx, ax.subClassIri, "rdfs:subClassOf", ax.superClassIri);
    }
  }

  return idx;
}

/** Evaluates a SPARQL 1.1 property path expression from `fromIri` over in-memory property edges. */
export function evaluatePropertyPathInMemory(
  objectPropertyAssertions: ReadonlyMap<string, readonly PropertyEdge[]>,
  propertyIri: string,
  pathOp: PropertyPathOp,
  fromIri: string,
  stepPropertyIri2?: string,
): readonly string[] {
  const reachable = new Set<string>();

  switch (pathOp) {
    case "direct": {
      const edges = objectPropertyAssertions.get(propertyIri) ?? [];
      for (const e of edges) {
        if (e.subjectIri === fromIri) reachable.add(e.objectIri);
      }
      break;
    }

    case "inverse": {
      const edges = objectPropertyAssertions.get(propertyIri) ?? [];
      for (const e of edges) {
        if (e.objectIri === fromIri) reachable.add(e.subjectIri);
      }
      break;
    }

    case "star": {
      reachable.add(fromIri);
      const queue = [fromIri];
      const visited = new Set<string>([fromIri]);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        const edges = objectPropertyAssertions.get(propertyIri) ?? [];
        for (const e of edges) {
          if (e.subjectIri === curr && !visited.has(e.objectIri)) {
            visited.add(e.objectIri);
            reachable.add(e.objectIri);
            queue.push(e.objectIri);
          }
        }
      }
      break;
    }

    case "plus": {
      const queue = [fromIri];
      const visited = new Set<string>([fromIri]);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        const edges = objectPropertyAssertions.get(propertyIri) ?? [];
        for (const e of edges) {
          if (e.subjectIri === curr && !visited.has(e.objectIri)) {
            visited.add(e.objectIri);
            reachable.add(e.objectIri);
            queue.push(e.objectIri);
          }
        }
      }
      break;
    }

    case "inverse-plus": {
      const queue = [fromIri];
      const visited = new Set<string>([fromIri]);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        const edges = objectPropertyAssertions.get(propertyIri) ?? [];
        for (const e of edges) {
          if (e.objectIri === curr && !visited.has(e.subjectIri)) {
            visited.add(e.subjectIri);
            reachable.add(e.subjectIri);
            queue.push(e.subjectIri);
          }
        }
      }
      break;
    }

    case "sequence": {
      const step1Targets = new Set<string>();
      const edges1 = objectPropertyAssertions.get(propertyIri) ?? [];
      for (const e of edges1) {
        if (e.subjectIri === fromIri) step1Targets.add(e.objectIri);
      }
      if (stepPropertyIri2) {
        const edges2 = objectPropertyAssertions.get(stepPropertyIri2) ?? [];
        for (const s of step1Targets) {
          for (const e of edges2) {
            if (e.subjectIri === s) reachable.add(e.objectIri);
          }
        }
      }
      break;
    }

    case "alternation": {
      const edges1 = objectPropertyAssertions.get(propertyIri) ?? [];
      for (const e of edges1) {
        if (e.subjectIri === fromIri) reachable.add(e.objectIri);
      }
      if (stepPropertyIri2) {
        const edges2 = objectPropertyAssertions.get(stepPropertyIri2) ?? [];
        for (const e of edges2) {
          if (e.subjectIri === fromIri) reachable.add(e.objectIri);
        }
      }
      break;
    }
  }

  return Array.from(reachable);
}

/** Evaluates a Basic Graph Pattern (BGP) conjunctive query using selectivity-guided index joins. */
export function queryBgpOnIndex(idx: BgpCompiledIndex, query: BgpQuery): BgpQueryResult {
  const start = performance.now();

  const varSet = new Set<string>();
  for (const pat of query.patterns) {
    if (pat.subject.startsWith("?")) varSet.add(pat.subject);
    if (pat.predicate.startsWith("?")) varSet.add(pat.predicate);
    if (pat.object.startsWith("?")) varSet.add(pat.object);
  }
  const variables = Array.from(varSet);

  if (query.patterns.length === 0) {
    return { variables, bindings: [], executionTimeMs: performance.now() - start };
  }

  // 1. Selectivity-guided pattern reordering using covering index cardinalities
  const remainingPatterns = [...query.patterns];
  const orderedPatterns: TriplePattern[] = [];
  const boundVars = new Set<string>();

  while (remainingPatterns.length > 0) {
    let bestIdx = 0;
    let bestScore = -1;

    for (let i = 0; i < remainingPatterns.length; i++) {
      const pat = remainingPatterns[i]!;
      const sConst = !pat.subject.startsWith("?");
      const pConst = !pat.predicate.startsWith("?");
      const oConst = !pat.object.startsWith("?");
      const sBound = sConst || boundVars.has(pat.subject);
      const pBound = pConst || boundVars.has(pat.predicate);
      const oBound = oConst || boundVars.has(pat.object);

      let score = 0;
      if (sBound && pBound && oBound) {
        score = 10000;
      } else if (sBound && pBound) {
        const card =
          sConst && pConst
            ? (idx.bySubjPred.get(`${pat.subject}\0${pat.predicate}`)?.length ?? 0)
            : (idx.byPred.get(pat.predicate)?.length ?? 100);
        score = 5000 + 1000 / (card + 1);
      } else if (pBound && oBound) {
        const card =
          pConst && oConst
            ? (idx.byPredObj.get(`${pat.predicate}\0${pat.object}`)?.length ?? 0)
            : (idx.byPred.get(pat.predicate)?.length ?? 100);
        score = 5000 + 1000 / (card + 1);
      } else if (sBound && oBound) {
        const card = sConst && oConst ? (idx.bySubjObj.get(`${pat.subject}\0${pat.object}`)?.length ?? 0) : 100;
        score = 4000 + 1000 / (card + 1);
      } else if (pBound) {
        const card = pConst ? (idx.byPred.get(pat.predicate)?.length ?? 0) : 500;
        score = 2000 + 1000 / (card + 1);
      } else if (sBound) {
        const card = sConst ? (idx.bySubj.get(pat.subject)?.length ?? 0) : 500;
        score = 1500 + 1000 / (card + 1);
      } else if (oBound) {
        const card = oConst ? (idx.byObj.get(pat.object)?.length ?? 0) : 500;
        score = 1500 + 1000 / (card + 1);
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    const selected = remainingPatterns.splice(bestIdx, 1)[0]!;
    orderedPatterns.push(selected);
    if (selected.subject.startsWith("?")) boundVars.add(selected.subject);
    if (selected.predicate.startsWith("?")) boundVars.add(selected.predicate);
    if (selected.object.startsWith("?")) boundVars.add(selected.object);
  }

  // 2. Zero-wrapper-allocation index join execution across all 6 covering maps
  let currentBindings: Record<string, string>[] = [{}];

  for (const pat of orderedPatterns) {
    const nextBindings: Record<string, string>[] = [];
    const sVar = pat.subject.startsWith("?") ? pat.subject : null;
    const pVar = pat.predicate.startsWith("?") ? pat.predicate : null;
    const oVar = pat.object.startsWith("?") ? pat.object : null;

    for (let bIdx = 0; bIdx < currentBindings.length; bIdx++) {
      const env = currentBindings[bIdx]!;
      const sVal = sVar !== null ? env[sVar] : pat.subject;
      const pVal = pVar !== null ? env[pVar] : pat.predicate;
      const oVal = oVar !== null ? env[oVar] : pat.object;

      if (sVal !== undefined && pVal !== undefined && oVal !== undefined) {
        if (idx.exactSet.has(`${sVal}\0${pVal}\0${oVal}`)) {
          nextBindings.push(env);
        }
      } else if (sVal !== undefined && pVal !== undefined) {
        const objs = idx.bySubjPred.get(`${sVal}\0${pVal}`);
        if (objs !== undefined) {
          for (let i = 0; i < objs.length; i++) {
            nextBindings.push({ ...env, [oVar!]: objs[i]! });
          }
        }
      } else if (pVal !== undefined && oVal !== undefined) {
        const subjs = idx.byPredObj.get(`${pVal}\0${oVal}`);
        if (subjs !== undefined) {
          for (let i = 0; i < subjs.length; i++) {
            nextBindings.push({ ...env, [sVar!]: subjs[i]! });
          }
        }
      } else if (sVal !== undefined && oVal !== undefined) {
        const preds = idx.bySubjObj.get(`${sVal}\0${oVal}`);
        if (preds !== undefined) {
          for (let i = 0; i < preds.length; i++) {
            nextBindings.push({ ...env, [pVar!]: preds[i]! });
          }
        }
      } else if (pVal !== undefined) {
        const edges = idx.byPred.get(pVal);
        if (edges !== undefined) {
          const sameSO = sVar === oVar;
          for (let i = 0; i < edges.length; i++) {
            const e = edges[i]!;
            if (sameSO && e.s !== e.o) continue;
            nextBindings.push({ ...env, [sVar!]: e.s, [oVar!]: e.o });
          }
        }
      } else if (sVal !== undefined) {
        const edges = idx.bySubj.get(sVal);
        if (edges !== undefined) {
          const samePO = pVar === oVar;
          for (let i = 0; i < edges.length; i++) {
            const e = edges[i]!;
            if (samePO && e.p !== e.o) continue;
            nextBindings.push({ ...env, [pVar!]: e.p, [oVar!]: e.o });
          }
        }
      } else if (oVal !== undefined) {
        const edges = idx.byObj.get(oVal);
        if (edges !== undefined) {
          const sameSP = sVar === pVar;
          for (let i = 0; i < edges.length; i++) {
            const e = edges[i]!;
            if (sameSP && e.s !== e.p) continue;
            nextBindings.push({ ...env, [sVar!]: e.s, [pVar!]: e.p });
          }
        }
      } else {
        for (let i = 0; i < idx.allFacts.length; i++) {
          const f = idx.allFacts[i]!;
          if (sVar === pVar && f.s !== f.p) continue;
          if (sVar === oVar && f.s !== f.o) continue;
          if (pVar === oVar && f.p !== f.o) continue;
          nextBindings.push({
            ...env,
            [sVar!]: f.s,
            [pVar!]: f.p,
            [oVar!]: f.o,
          });
        }
      }
    }

    currentBindings = nextBindings;
    if (currentBindings.length === 0) break;
  }

  return {
    variables,
    bindings: currentBindings,
    executionTimeMs: performance.now() - start,
  };
}

/** O(1) cardinality estimate for a triple pattern `(subject, predicate, object)` over a 6-way covering index. */
export function estimateTripleCardinalityOnIndex(
  idx: BgpCompiledIndex,
  subject?: string | null,
  predicate?: string | null,
  object?: string | null,
): number {
  const RDF_TYPE_IRI = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const RDFS_SUBCLASS_IRI = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
  const pKey =
    predicate === RDF_TYPE_IRI ? "rdf:type" : predicate === RDFS_SUBCLASS_IRI ? "rdfs:subClassOf" : (predicate ?? null);

  if (subject && pKey && object) {
    return idx.exactSet.has(`${subject}\0${pKey}\0${object}`) ? 1 : 0;
  }
  if (subject && pKey) return idx.bySubjPred.get(`${subject}\0${pKey}`)?.length ?? 0;
  if (pKey && object) return idx.byPredObj.get(`${pKey}\0${object}`)?.length ?? 0;
  if (subject && object) return idx.bySubjObj.get(`${subject}\0${object}`)?.length ?? 0;
  if (pKey) return idx.byPred.get(pKey)?.length ?? 0;
  if (subject) return idx.bySubj.get(subject)?.length ?? 0;
  if (object) return idx.byObj.get(object)?.length ?? 0;
  return idx.allFacts.length;
}

/** Live, zero-snapshot triple matcher over a compiled covering index and taxonomy class map. */
export function* matchTriplesLiveOnIndex(
  idx: BgpCompiledIndex,
  classes: ReadonlyMap<string, ClassNode>,
  subject?: string | null,
  predicate?: string | null,
  object?: string | null,
): Iterable<{ s: string; p: string; o: string }> {
  const RDF_TYPE_IRI = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const RDFS_SUBCLASS_IRI = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
  const OWL_CLASS_IRI = "http://www.w3.org/2002/07/owl#Class";

  const normPredOut = (p: string): string =>
    p === "rdf:type" ? RDF_TYPE_IRI : p === "rdfs:subClassOf" ? RDFS_SUBCLASS_IRI : p;

  const pKey =
    predicate === RDF_TYPE_IRI ? "rdf:type" : predicate === RDFS_SUBCLASS_IRI ? "rdfs:subClassOf" : (predicate ?? null);

  const emitted = new Set<string>();
  const emitIfNew = (s: string, p: string, o: string): { s: string; p: string; o: string } | null => {
    const k = `${s}\0${p}\0${o}`;
    if (emitted.has(k)) return null;
    emitted.add(k);
    return { s, p, o };
  };

  // 1. Direct O(1)/O(K) lookup in the 6-way covering index
  if (subject && pKey && object) {
    if (idx.exactSet.has(`${subject}\0${pKey}\0${object}`)) {
      const t = emitIfNew(subject, normPredOut(pKey), object);
      if (t) yield t;
    }
  } else if (subject && pKey) {
    const objs = idx.bySubjPred.get(`${subject}\0${pKey}`);
    if (objs) {
      const outP = normPredOut(pKey);
      for (let i = 0; i < objs.length; i++) {
        const t = emitIfNew(subject, outP, objs[i]!);
        if (t) yield t;
      }
    }
  } else if (pKey && object) {
    const subjs = idx.byPredObj.get(`${pKey}\0${object}`);
    if (subjs) {
      const outP = normPredOut(pKey);
      for (let i = 0; i < subjs.length; i++) {
        const t = emitIfNew(subjs[i]!, outP, object);
        if (t) yield t;
      }
    }
  } else if (subject && object) {
    const preds = idx.bySubjObj.get(`${subject}\0${object}`);
    if (preds) {
      for (let i = 0; i < preds.length; i++) {
        const t = emitIfNew(subject, normPredOut(preds[i]!), object);
        if (t) yield t;
      }
    }
  } else if (pKey) {
    const edges = idx.byPred.get(pKey);
    if (edges) {
      const outP = normPredOut(pKey);
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]!;
        const t = emitIfNew(e.s, outP, e.o);
        if (t) yield t;
      }
    }
  } else if (subject) {
    const edges = idx.bySubj.get(subject);
    if (edges) {
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]!;
        const t = emitIfNew(subject, normPredOut(e.p), e.o);
        if (t) yield t;
      }
    }
  } else if (object) {
    const edges = idx.byObj.get(object);
    if (edges) {
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]!;
        const t = emitIfNew(e.s, normPredOut(e.p), object);
        if (t) yield t;
      }
    }
  } else {
    for (let i = 0; i < idx.allFacts.length; i++) {
      const f = idx.allFacts[i]!;
      const t = emitIfNew(f.s, normPredOut(f.p), f.o);
      if (t) yield t;
    }
  }

  // 2. Live taxonomy declarations (`?c rdf:type owl:Class`) & direct superclasses (`?c rdfs:subClassOf ?sup`)
  const wantClassType =
    (!predicate || predicate === RDF_TYPE_IRI || predicate === "rdf:type") && (!object || object === OWL_CLASS_IRI);
  const wantSubClass = !predicate || predicate === RDFS_SUBCLASS_IRI || predicate === "rdfs:subClassOf";

  if (wantClassType || wantSubClass) {
    if (subject) {
      const node = classes.get(subject);
      if (node) {
        if (wantClassType) {
          const t = emitIfNew(subject, RDF_TYPE_IRI, OWL_CLASS_IRI);
          if (t) yield t;
        }
        if (wantSubClass) {
          for (const sup of node.superClasses) {
            if (!object || object === sup) {
              const t = emitIfNew(subject, RDFS_SUBCLASS_IRI, sup);
              if (t) yield t;
            }
          }
        }
      }
    } else {
      for (const [clsIri, node] of classes) {
        if (wantClassType) {
          const t = emitIfNew(clsIri, RDF_TYPE_IRI, OWL_CLASS_IRI);
          if (t) yield t;
        }
        if (wantSubClass) {
          for (const sup of node.superClasses) {
            if (!object || object === sup) {
              const t = emitIfNew(clsIri, RDFS_SUBCLASS_IRI, sup);
              if (t) yield t;
            }
          }
        }
      }
    }
  }
}
