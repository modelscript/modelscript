// SPDX-License-Identifier: AGPL-3.0-or-later

import { detectOwl2Format } from "../parser/index.js";
import {
  Owl2TableauReasoner,
  type DataRangeSpec,
  type Owl2ReasoningResult,
  type TableauClassExpr,
} from "../reasoner/tableau.js";

export type Owl2EntityKind = "Class" | "ObjectProperty" | "DataProperty" | "Individual";

export type Owl2PropertyCharacteristic =
  "Functional" | "InverseFunctional" | "Transitive" | "Symmetric" | "Asymmetric" | "Reflexive" | "Irreflexive";

export interface Owl2ClassInfo {
  iri: string;
  label: string;
  line: number;
  unsatisfiable: boolean;
  assertedSuperClasses: string[];
  inferredSuperClasses: string[];
  assertedSubClasses: string[];
  inferredSubClasses: string[];
  complexSuperExpressions: string[];
  disjointWith: string[];
  assertedInstances: string[];
  inferredInstances: string[];
  domainOfProperties: string[];
  rangeOfProperties: string[];
}

export interface Owl2PropertyInfo {
  iri: string;
  label: string;
  kind: "ObjectProperty" | "DataProperty";
  line: number;
  superProperties: string[];
  subProperties: string[];
  inverseOf: string[];
  characteristics: Owl2PropertyCharacteristic[];
  domains: string[];
  ranges: string[];
  propertyChains: string[][];
  disjointWith: string[];
  assertionCount: number;
}

export interface Owl2IndividualInfo {
  iri: string;
  label: string;
  line: number;
  assertedTypes: string[];
  inferredTypes: string[];
  assertedRoleAssertions: Array<{ property: string; target: string }>;
  inferredRoleAssertions: Array<{ property: string; target: string }>;
  dataAssertions: Array<{ property: string; value: string }>;
  sameAs: string[];
  differentFrom: string[];
}

export type InferredFactKind =
  "subClassOf" | "classAssertion" | "roleAssertion" | "sameIndividual" | "unsatisfiableClass";

export interface Owl2InferredFact {
  id: string;
  kind: InferredFactKind;
  subject: string;
  predicate: string;
  object: string;
  displayText: string;
  explanation: string;
}

export interface Owl2HierarchyNode {
  iri: string;
  label: string;
  kind: Owl2EntityKind;
  inferredLink: boolean;
  unsatisfiable?: boolean | undefined;
  instanceCount?: number | undefined;
  characteristics?: Owl2PropertyCharacteristic[] | undefined;
  children: Owl2HierarchyNode[];
}

export interface Owl2FacetedEntity {
  iri: string;
  label: string;
  kind: Owl2EntityKind;
  line: number;
  unsatisfiable: boolean;
  hasInferredFacts: boolean;
  characteristics: Owl2PropertyCharacteristic[];
  topLevelBranches: string[];
  summary: string;
  searchText: string;
}

export interface Owl2WorkbenchModel {
  format: "ofn" | "ttl" | "owx";
  formatLabel: string;
  ontologyIri?: string | undefined;
  consistent: boolean;
  truncated: boolean;
  reasoningTimeMs: number;
  clashes: string[];
  unsatisfiableClasses: string[];
  classes: Map<string, Owl2ClassInfo>;
  properties: Map<string, Owl2PropertyInfo>;
  individuals: Map<string, Owl2IndividualInfo>;
  assertedClassTree: Owl2HierarchyNode[];
  inferredClassTree: Owl2HierarchyNode[];
  mergedClassTree: Owl2HierarchyNode[];
  objectPropertyTree: Owl2HierarchyNode[];
  dataPropertyTree: Owl2HierarchyNode[];
  inferredFacts: Owl2InferredFact[];
  facetedEntities: Owl2FacetedEntity[];
  topLevelBranches: string[];
  assertedSubClassEdges: Array<{ child: string; parent: string; line: number }>;
  inferredSubClassEdges: Array<{ child: string; parent: string }>;
}

export function shortOwlLabel(iri: string): string {
  const trimmed = iri.trim().replace(/^<|>$/g, "");
  if (!trimmed) return "";
  if (trimmed === "owl:Thing" || trimmed === "owl:Nothing") return trimmed;
  const hashIdx = trimmed.lastIndexOf("#");
  if (hashIdx >= 0 && hashIdx < trimmed.length - 1) return trimmed.slice(hashIdx + 1);
  const slashIdx = trimmed.lastIndexOf("/");
  if (slashIdx >= 0 && slashIdx < trimmed.length - 1) return trimmed.slice(slashIdx + 1);
  const colonIdx = trimmed.lastIndexOf(":");
  if (colonIdx >= 0 && colonIdx < trimmed.length - 1) return trimmed.slice(colonIdx + 1);
  return trimmed;
}

export function formatClassExpr(expr: TableauClassExpr): string {
  switch (expr.kind) {
    case "NamedClass":
      return expr.iri;
    case "ObjectComplementOf":
      return `¬${formatClassExpr(expr.operand)}`;
    case "ObjectIntersectionOf":
      return `(${expr.operands.map(formatClassExpr).join(" ⊓ ")})`;
    case "ObjectUnionOf":
      return `(${expr.operands.map(formatClassExpr).join(" ⊔ ")})`;
    case "ObjectSomeValuesFrom":
      return `∃${expr.property}.${formatClassExpr(expr.filler)}`;
    case "ObjectAllValuesFrom":
      return `∀${expr.property}.${formatClassExpr(expr.filler)}`;
    case "ObjectHasValue":
      return `∃${expr.property}.{${expr.individual}}`;
    case "ObjectOneOf":
      return `{${expr.individuals.join(", ")}}`;
    case "ObjectHasSelf":
      return `∃${expr.property}.Self`;
    case "ObjectCardinality": {
      const sym = expr.cardType === "min" ? "≥" : expr.cardType === "max" ? "≤" : "=";
      return `${sym}${expr.count} ${expr.property}.${formatClassExpr(expr.filler)}`;
    }
    case "DataCardinality": {
      const sym = expr.cardType === "min" ? "≥" : expr.cardType === "max" ? "≤" : "=";
      return `${sym}${expr.count} ${expr.property}.${formatDataRange(expr.range)}`;
    }
    case "DataSomeValuesFrom":
      return `∃${expr.property}.${formatDataRange(expr.range)}`;
    case "DataAllValuesFrom":
      return `∀${expr.property}.${formatDataRange(expr.range)}`;
    case "DataHasValue":
      return `∃${expr.property}.{${expr.value}}`;
    default:
      return "owl:Thing";
  }
}

function formatDataRange(range: DataRangeSpec): string {
  if (!range.facets || range.facets.length === 0) return range.datatypeIri;
  const facetStr = range.facets
    .map((f) => {
      const op =
        f.facet === "minInclusive" ? "≥" : f.facet === "maxInclusive" ? "≤" : f.facet === "minExclusive" ? ">" : "<";
      return `${op} ${f.value}`;
    })
    .join(", ");
  return `${range.datatypeIri}[${facetStr}]`;
}

function indexEntityLines(code: string): { lineByTerm: Map<string, number>; ontologyIri?: string | undefined } {
  const lineByTerm = new Map<string, number>();
  const lines = code.split(/\r?\n/);
  let ontologyIri: string | undefined;

  const record = (raw: string, lineNum: number) => {
    const clean = raw.trim();
    if (!clean) return;
    if (!lineByTerm.has(clean)) lineByTerm.set(clean, lineNum);
    const short = shortOwlLabel(clean);
    if (short && !lineByTerm.has(short)) lineByTerm.set(short, lineNum);
    if (!clean.startsWith(":") && !clean.includes(":")) {
      if (!lineByTerm.has(`:${clean}`)) lineByTerm.set(`:${clean}`, lineNum);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i]!;
    if (!ontologyIri) {
      const m =
        /Ontology\s*\(\s*<([^>]+)>/i.exec(line) ??
        /ontologyIRI=["']([^"']+)["']/i.exec(line) ??
        /<([^>]+)>\s+a\s+owl:Ontology/i.exec(line);
      if (m?.[1]) ontologyIri = m[1];
    }

    // FSS Declarations
    const declM =
      /Declaration\s*\(\s*(?:Class|ObjectProperty|DataProperty|NamedIndividual|AnnotationProperty)\s*\(\s*([^\s)]+)\s*\)\s*\)/i.exec(
        line,
      );
    if (declM?.[1]) record(declM[1], lineNum);

    // Turtle / XML tokens
    const rdfAbout = /(?:rdf:about|rdf:ID|IRI|abbreviatedIRI)=["']([^"']+)["']/i.exec(line);
    if (rdfAbout?.[1]) record(rdfAbout[1], lineNum);

    const ttlSubj =
      /^\s*(:[A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9_-]*:[A-Za-z0-9_-]+|<[^>]+>)\s+(?:a|rdf:type|rdfs:subClassOf)/i.exec(
        line,
      );
    if (ttlSubj?.[1]) record(ttlSubj[1], lineNum);

    // Any prefixed IRI occurrence as fallback
    const iriRe = /(?:^|[\s(])(:[A-Za-z_][A-Za-z0-9_.-]*|[A-Za-z][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_.-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = iriRe.exec(line)) !== null) {
      if (m[1]) record(m[1], lineNum);
    }
  }

  return { lineByTerm, ontologyIri };
}

function lookupLine(lineByTerm: ReadonlyMap<string, number>, iri: string): number {
  return lineByTerm.get(iri) ?? lineByTerm.get(shortOwlLabel(iri)) ?? 1;
}

function isUserIri(iri: string): boolean {
  return (
    Boolean(iri) && iri !== "owl:Thing" && iri !== "owl:Nothing" && !iri.startsWith("__aux_") && !iri.startsWith("_:")
  );
}

function buildHierarchyTree(
  iris: string[],
  parentMap: Map<string, Set<string>>,
  inferredEdgeSet: Set<string>,
  makeNode: (iri: string, inferredLink: boolean, children: Owl2HierarchyNode[]) => Owl2HierarchyNode,
): Owl2HierarchyNode[] {
  const childrenOf = new Map<string, Array<{ child: string; inferred: boolean }>>();
  const roots: string[] = [];

  const validSet = new Set(iris);
  for (const iri of iris) {
    const rawParents = Array.from(parentMap.get(iri) ?? []).filter((p) => p !== iri && validSet.has(p));
    if (rawParents.length === 0) {
      roots.push(iri);
    } else {
      for (const p of rawParents) {
        let arr = childrenOf.get(p);
        if (!arr) {
          arr = [];
          childrenOf.set(p, arr);
        }
        arr.push({ child: iri, inferred: inferredEdgeSet.has(`${iri}=>${p}`) });
      }
    }
  }

  // Handle pure cycles where no root exists
  if (roots.length === 0 && iris.length > 0) {
    roots.push(...iris);
  }

  const sortByLabel = (a: string, b: string) => shortOwlLabel(a).localeCompare(shortOwlLabel(b));
  roots.sort(sortByLabel);

  const buildNode = (iri: string, inferredLink: boolean, ancestors: Set<string>): Owl2HierarchyNode => {
    const nextAnc = new Set(ancestors);
    nextAnc.add(iri);
    const kids = (childrenOf.get(iri) ?? [])
      .filter((k) => !nextAnc.has(k.child))
      .sort((a, b) => sortByLabel(a.child, b.child))
      .map((k) => buildNode(k.child, k.inferred, nextAnc));
    return makeNode(iri, inferredLink, kids);
  };

  return roots.map((r) => buildNode(r, false, new Set()));
}

/**
 * Computes transitive reduction of direct parents from a full transitive ancestor map
 * so the inferred hierarchy tree mirrors Protégé's clean direct-inferred parent view.
 */
function computeDirectParents(iris: string[], ancestorMap: Map<string, Set<string>>): Map<string, Set<string>> {
  const validSet = new Set(iris);
  const direct = new Map<string, Set<string>>();

  for (const c of iris) {
    const ancs = Array.from(ancestorMap.get(c) ?? []).filter((a) => a !== c && validSet.has(a));
    const directSet = new Set<string>();
    for (const p of ancs) {
      // p is a direct parent of c if no other ancestor m of c (m != p) has p as an ancestor
      const isIndirect = ancs.some((m) => m !== p && ancestorMap.get(m)?.has(p) && !ancestorMap.get(p)?.has(m));
      if (!isIndirect) {
        directSet.add(p);
      }
    }
    direct.set(c, directSet);
  }
  return direct;
}

/**
 * Builds the complete Protégé-parity OWL 2 workbench model from raw ontology source text
 * using the native SROIQ(D) tableau reasoner.
 */
export function buildOwl2WorkbenchModel(code: string): Owl2WorkbenchModel {
  const format = detectOwl2Format(code);
  const formatLabel =
    format === "ttl" ? "Turtle (.ttl)" : format === "owx" ? "OWL/XML / RDF/XML (.owx)" : "Functional Syntax (.ofn)";

  const { lineByTerm, ontologyIri } = indexEntityLines(code);

  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const reasoner = new Owl2TableauReasoner();
  let result: Owl2ReasoningResult;
  try {
    if (code.trim().length > 0) {
      reasoner.loadSource(code);
    }
    result = reasoner.checkConsistency();
  } catch (err) {
    result = {
      consistent: false,
      unsatisfiableClasses: [],
      clashes: [err instanceof Error ? err.message : String(err)],
      inferredSubClasses: new Map(),
      inferredTypes: new Map(),
      inferredRoleAssertions: [],
      sameIndividuals: new Map(),
    };
  }
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const reasoningTimeMs = Math.max(0.1, Number((t1 - t0).toFixed(1)));

  const unsatisfiableSet = new Set(result.unsatisfiableClasses.filter((c) => isUserIri(c)));

  // ── Collect Classes ───────────────────────────────────────────────────────
  const classIris = Array.from(reasoner.classes)
    .filter(isUserIri)
    .sort((a, b) => shortOwlLabel(a).localeCompare(shortOwlLabel(b)));
  const assertedSupers = new Map<string, Set<string>>();
  const complexSupers = new Map<string, Set<string>>();
  const disjointMap = new Map<string, Set<string>>();
  const assertedSubClassEdges: Array<{ child: string; parent: string; line: number }> = [];

  for (const c of classIris) {
    assertedSupers.set(c, new Set());
    complexSupers.set(c, new Set());
    disjointMap.set(c, new Set());
  }

  for (const ax of reasoner.subClassAxioms) {
    if (ax.sub.kind === "NamedClass" && isUserIri(ax.sub.iri)) {
      if (ax.sup.kind === "NamedClass" && isUserIri(ax.sup.iri) && ax.sup.iri !== ax.sub.iri) {
        assertedSupers.get(ax.sub.iri)?.add(ax.sup.iri);
        assertedSubClassEdges.push({
          child: ax.sub.iri,
          parent: ax.sup.iri,
          line: lookupLine(lineByTerm, ax.sub.iri),
        });
      } else if (ax.sup.kind !== "NamedClass") {
        complexSupers.get(ax.sub.iri)?.add(formatClassExpr(ax.sup));
      }
    }
  }

  for (const dset of reasoner.disjointClassSets) {
    const named = dset.filter(
      (e): e is { kind: "NamedClass"; iri: string } => e.kind === "NamedClass" && isUserIri(e.iri),
    );
    for (let i = 0; i < named.length; i++) {
      for (let j = 0; j < named.length; j++) {
        if (i !== j) {
          disjointMap.get(named[i]!.iri)?.add(named[j]!.iri);
        }
      }
    }
  }

  // Inferred superclasses (all ancestors minus asserted)
  const fullAncestorMap = new Map<string, Set<string>>();
  const inferredSupersMap = new Map<string, Set<string>>();
  const inferredSubClassEdges: Array<{ child: string; parent: string }> = [];
  const inferredFacts: Owl2InferredFact[] = [];

  for (const c of classIris) {
    const allSupers = new Set<string>(assertedSupers.get(c) ?? []);
    const reasonerSupers = result.inferredSubClasses.get(c);
    if (reasonerSupers) {
      for (const s of reasonerSupers) {
        if (isUserIri(s) && s !== c) allSupers.add(s);
      }
    }
    fullAncestorMap.set(c, allSupers);

    const asserted = assertedSupers.get(c) ?? new Set<string>();
    const newlyInferred = new Set<string>();
    for (const s of allSupers) {
      if (!asserted.has(s)) {
        newlyInferred.add(s);
        inferredSubClassEdges.push({ child: c, parent: s });
        inferredFacts.push({
          id: `sub:${c}:${s}`,
          kind: "subClassOf",
          subject: c,
          predicate: "⊑",
          object: s,
          displayText: `${shortOwlLabel(c)} ⊑ ${shortOwlLabel(s)}`,
          explanation: `Inferred subsumption: every instance of '${shortOwlLabel(c)}' is also an instance of '${shortOwlLabel(s)}'.`,
        });
      }
    }
    inferredSupersMap.set(c, newlyInferred);
  }

  for (const unsat of unsatisfiableSet) {
    inferredFacts.push({
      id: `unsat:${unsat}`,
      kind: "unsatisfiableClass",
      subject: unsat,
      predicate: "≡",
      object: "owl:Nothing",
      displayText: `${shortOwlLabel(unsat)} ≡ ⊥ (Unsatisfiable)`,
      explanation: `Class '${shortOwlLabel(unsat)}' cannot have any instances without causing a logical contradiction.`,
    });
  }

  // ── Collect Individuals ───────────────────────────────────────────────────
  const individualIris = Array.from(reasoner.namedIndividuals)
    .filter(isUserIri)
    .sort((a, b) => shortOwlLabel(a).localeCompare(shortOwlLabel(b)));

  const assertedTypesByInd = new Map<string, Set<string>>();
  for (const ind of individualIris) assertedTypesByInd.set(ind, new Set());
  for (const ca of reasoner.classAssertions) {
    if (isUserIri(ca.individual) && ca.concept.kind === "NamedClass" && isUserIri(ca.concept.iri)) {
      if (!assertedTypesByInd.has(ca.individual)) assertedTypesByInd.set(ca.individual, new Set());
      assertedTypesByInd.get(ca.individual)!.add(ca.concept.iri);
    }
  }

  const assertedRolesKeySet = new Set<string>();
  const assertedRolesByInd = new Map<string, Array<{ property: string; target: string }>>();
  for (const ra of reasoner.roleAssertions) {
    const key = `${ra.subject}|${ra.property}|${ra.object}`;
    assertedRolesKeySet.add(key);
    const list = assertedRolesByInd.get(ra.subject) ?? [];
    list.push({ property: ra.property, target: ra.object });
    assertedRolesByInd.set(ra.subject, list);
  }

  const inferredRolesByInd = new Map<string, Array<{ property: string; target: string }>>();
  for (const ra of result.inferredRoleAssertions) {
    const key = `${ra.subject}|${ra.property}|${ra.object}`;
    if (!assertedRolesKeySet.has(key) && isUserIri(ra.subject) && isUserIri(ra.object)) {
      const list = inferredRolesByInd.get(ra.subject) ?? [];
      list.push({ property: ra.property, target: ra.object });
      inferredRolesByInd.set(ra.subject, list);
      inferredFacts.push({
        id: `role:${ra.subject}:${ra.property}:${ra.object}`,
        kind: "roleAssertion",
        subject: ra.subject,
        predicate: ra.property,
        object: ra.object,
        displayText: `${shortOwlLabel(ra.subject)} —[${shortOwlLabel(ra.property)}]→ ${shortOwlLabel(ra.object)}`,
        explanation: `Inferred role assertion via property hierarchy, inverse, symmetry, transitivity, or property chain.`,
      });
    }
  }

  const dataAssertionsByInd = new Map<string, Array<{ property: string; value: string }>>();
  for (const da of reasoner.dataAssertions) {
    const list = dataAssertionsByInd.get(da.subject) ?? [];
    list.push({ property: da.property, value: da.value });
    dataAssertionsByInd.set(da.subject, list);
  }

  const differentByInd = new Map<string, Set<string>>();
  for (const diffSet of reasoner.differentIndividualSets) {
    for (let i = 0; i < diffSet.length; i++) {
      for (let j = 0; j < diffSet.length; j++) {
        if (i !== j) {
          const s = differentByInd.get(diffSet[i]!) ?? new Set<string>();
          s.add(diffSet[j]!);
          differentByInd.set(diffSet[i]!, s);
        }
      }
    }
  }

  const assertedSamePairs = new Set<string>();
  for (const sameSet of reasoner.sameIndividualSets) {
    for (let i = 0; i < sameSet.length; i++) {
      for (let j = 0; j < sameSet.length; j++) {
        if (i !== j) assertedSamePairs.add(`${sameSet[i]}|${sameSet[j]}`);
      }
    }
  }

  const individuals = new Map<string, Owl2IndividualInfo>();
  const assertedInstancesByClass = new Map<string, Set<string>>();
  const inferredInstancesByClass = new Map<string, Set<string>>();

  for (const ind of individualIris) {
    const assertedTypes = Array.from(assertedTypesByInd.get(ind) ?? []).sort();
    const allTypes = result.inferredTypes.get(ind) ?? new Set<string>();
    const inferredTypes = Array.from(allTypes)
      .filter((t) => isUserIri(t) && !assertedTypesByInd.get(ind)?.has(t))
      .sort();

    for (const t of assertedTypes) {
      const s = assertedInstancesByClass.get(t) ?? new Set<string>();
      s.add(ind);
      assertedInstancesByClass.set(t, s);
    }
    for (const t of inferredTypes) {
      const s = inferredInstancesByClass.get(t) ?? new Set<string>();
      s.add(ind);
      inferredInstancesByClass.set(t, s);
      inferredFacts.push({
        id: `type:${ind}:${t}`,
        kind: "classAssertion",
        subject: ind,
        predicate: "∈",
        object: t,
        displayText: `${shortOwlLabel(ind)} ∈ ${shortOwlLabel(t)}`,
        explanation: `Inferred type membership from class hierarchy, domain/range, or restriction entailment.`,
      });
    }

    const sameAs = Array.from(result.sameIndividuals.get(ind) ?? [])
      .filter((other) => other !== ind && isUserIri(other))
      .sort();
    for (const other of sameAs) {
      if (!assertedSamePairs.has(`${ind}|${other}`) && ind < other) {
        inferredFacts.push({
          id: `same:${ind}:${other}`,
          kind: "sameIndividual",
          subject: ind,
          predicate: "≡",
          object: other,
          displayText: `${shortOwlLabel(ind)} ≡ ${shortOwlLabel(other)}`,
          explanation: `Inferred individual equality via Functional / InverseFunctional property or cardinality restriction.`,
        });
      }
    }

    individuals.set(ind, {
      iri: ind,
      label: shortOwlLabel(ind),
      line: lookupLine(lineByTerm, ind),
      assertedTypes,
      inferredTypes,
      assertedRoleAssertions: assertedRolesByInd.get(ind) ?? [],
      inferredRoleAssertions: inferredRolesByInd.get(ind) ?? [],
      dataAssertions: dataAssertionsByInd.get(ind) ?? [],
      sameAs,
      differentFrom: Array.from(differentByInd.get(ind) ?? []).sort(),
    });
  }

  // ── Collect Properties ────────────────────────────────────────────────────
  const properties = new Map<string, Owl2PropertyInfo>();
  const objPropParents = new Map<string, Set<string>>();
  const dataPropParents = new Map<string, Set<string>>();
  const domainOfByClass = new Map<string, Set<string>>();
  const rangeOfByClass = new Map<string, Set<string>>();

  const objPropIris = Array.from(reasoner.objectProperties)
    .filter(isUserIri)
    .sort((a, b) => shortOwlLabel(a).localeCompare(shortOwlLabel(b)));
  const dataPropIris = Array.from(reasoner.dataProperties)
    .filter(isUserIri)
    .sort((a, b) => shortOwlLabel(a).localeCompare(shortOwlLabel(b)));

  for (const p of objPropIris) {
    const characteristics: Owl2PropertyCharacteristic[] = [];
    if (reasoner.functionalObjectProperties.has(p)) characteristics.push("Functional");
    if (reasoner.inverseFunctionalObjectProperties.has(p)) characteristics.push("InverseFunctional");
    if (reasoner.transitiveProperties.has(p)) characteristics.push("Transitive");
    if (reasoner.symmetricProperties.has(p)) characteristics.push("Symmetric");
    if (reasoner.asymmetricProperties.has(p)) characteristics.push("Asymmetric");
    if (reasoner.reflexiveProperties.has(p)) characteristics.push("Reflexive");
    if (reasoner.irreflexiveProperties.has(p)) characteristics.push("Irreflexive");

    const superProperties = reasoner.subObjectProperties.filter((s) => s.sub === p).map((s) => s.sup);
    const subProperties = reasoner.subObjectProperties.filter((s) => s.sup === p).map((s) => s.sub);
    objPropParents.set(p, new Set(superProperties));

    const inverseOf = reasoner.inverseProperties
      .filter((inv) => inv.p1 === p || inv.p2 === p)
      .map((inv) => (inv.p1 === p ? inv.p2 : inv.p1));

    const domains = (reasoner.objectPropertyDomains.get(p) ?? []).map(formatClassExpr);
    const ranges = (reasoner.objectPropertyRanges.get(p) ?? []).map(formatClassExpr);
    for (const d of reasoner.objectPropertyDomains.get(p) ?? []) {
      if (d.kind === "NamedClass" && isUserIri(d.iri)) {
        const s = domainOfByClass.get(d.iri) ?? new Set<string>();
        s.add(p);
        domainOfByClass.set(d.iri, s);
      }
    }
    for (const r of reasoner.objectPropertyRanges.get(p) ?? []) {
      if (r.kind === "NamedClass" && isUserIri(r.iri)) {
        const s = rangeOfByClass.get(r.iri) ?? new Set<string>();
        s.add(p);
        rangeOfByClass.set(r.iri, s);
      }
    }

    const propertyChains = reasoner.propertyChains.filter((c) => c.superProperty === p).map((c) => c.chain);
    const disjointWith = reasoner.disjointObjectPropertySets
      .filter((set) => set.includes(p))
      .flatMap((set) => set.filter((other) => other !== p));
    const assertionCount =
      reasoner.roleAssertions.filter((r) => r.property === p).length +
      result.inferredRoleAssertions.filter((r) => r.property === p).length;

    properties.set(p, {
      iri: p,
      label: shortOwlLabel(p),
      kind: "ObjectProperty",
      line: lookupLine(lineByTerm, p),
      superProperties,
      subProperties,
      inverseOf,
      characteristics,
      domains,
      ranges,
      propertyChains,
      disjointWith,
      assertionCount,
    });
  }

  for (const p of dataPropIris) {
    const characteristics: Owl2PropertyCharacteristic[] = [];
    if (reasoner.functionalDataProperties.has(p)) characteristics.push("Functional");
    const superProperties = reasoner.subDataProperties.filter((s) => s.sub === p).map((s) => s.sup);
    const subProperties = reasoner.subDataProperties.filter((s) => s.sup === p).map((s) => s.sub);
    dataPropParents.set(p, new Set(superProperties));

    const domains = (reasoner.dataPropertyDomains.get(p) ?? []).map(formatClassExpr);
    const ranges = (reasoner.dataPropertyRanges.get(p) ?? []).map(formatDataRange);
    for (const d of reasoner.dataPropertyDomains.get(p) ?? []) {
      if (d.kind === "NamedClass" && isUserIri(d.iri)) {
        const s = domainOfByClass.get(d.iri) ?? new Set<string>();
        s.add(p);
        domainOfByClass.set(d.iri, s);
      }
    }
    const assertionCount = reasoner.dataAssertions.filter((d) => d.property === p).length;

    properties.set(p, {
      iri: p,
      label: shortOwlLabel(p),
      kind: "DataProperty",
      line: lookupLine(lineByTerm, p),
      superProperties,
      subProperties,
      inverseOf: [],
      characteristics,
      domains,
      ranges,
      propertyChains: [],
      disjointWith: [],
      assertionCount,
    });
  }

  // ── Finalize ClassInfo Map ────────────────────────────────────────────────
  const classes = new Map<string, Owl2ClassInfo>();
  for (const c of classIris) {
    const assertedSubs: string[] = [];
    const inferredSubs: string[] = [];
    for (const other of classIris) {
      if (other === c) continue;
      if (assertedSupers.get(other)?.has(c)) assertedSubs.push(other);
      else if (inferredSupersMap.get(other)?.has(c)) inferredSubs.push(other);
    }

    classes.set(c, {
      iri: c,
      label: shortOwlLabel(c),
      line: lookupLine(lineByTerm, c),
      unsatisfiable: unsatisfiableSet.has(c),
      assertedSuperClasses: Array.from(assertedSupers.get(c) ?? []).sort(),
      inferredSuperClasses: Array.from(inferredSupersMap.get(c) ?? []).sort(),
      assertedSubClasses: assertedSubs.sort(),
      inferredSubClasses: inferredSubs.sort(),
      complexSuperExpressions: Array.from(complexSupers.get(c) ?? []),
      disjointWith: Array.from(disjointMap.get(c) ?? []).sort(),
      assertedInstances: Array.from(assertedInstancesByClass.get(c) ?? []).sort(),
      inferredInstances: Array.from(inferredInstancesByClass.get(c) ?? []).sort(),
      domainOfProperties: Array.from(domainOfByClass.get(c) ?? []).sort(),
      rangeOfProperties: Array.from(rangeOfByClass.get(c) ?? []).sort(),
    });
  }

  // ── Build Hierarchy Trees ─────────────────────────────────────────────────
  const makeClassNode = (iri: string, inferredLink: boolean, children: Owl2HierarchyNode[]): Owl2HierarchyNode => {
    const info = classes.get(iri);
    return {
      iri,
      label: shortOwlLabel(iri),
      kind: "Class",
      inferredLink,
      unsatisfiable: info?.unsatisfiable ?? false,
      instanceCount: (info?.assertedInstances.length ?? 0) + (info?.inferredInstances.length ?? 0),
      children,
    };
  };

  const assertedClassTree = buildHierarchyTree(classIris, assertedSupers, new Set(), makeClassNode);

  const directInferredParents = computeDirectParents(classIris, fullAncestorMap);
  const inferredEdgeKeys = new Set<string>();
  for (const [c, parents] of directInferredParents.entries()) {
    for (const p of parents) {
      if (!assertedSupers.get(c)?.has(p)) {
        inferredEdgeKeys.add(`${c}=>${p}`);
      }
    }
  }
  const inferredClassTree = buildHierarchyTree(classIris, directInferredParents, inferredEdgeKeys, makeClassNode);

  const mergedParents = new Map<string, Set<string>>();
  for (const c of classIris) {
    const s = new Set<string>(assertedSupers.get(c) ?? []);
    for (const p of directInferredParents.get(c) ?? []) s.add(p);
    mergedParents.set(c, s);
  }
  const mergedClassTree = buildHierarchyTree(classIris, mergedParents, inferredEdgeKeys, makeClassNode);

  const objectPropertyTree = buildHierarchyTree(
    objPropIris,
    objPropParents,
    new Set(),
    (iri, inferredLink, children) => ({
      iri,
      label: shortOwlLabel(iri),
      kind: "ObjectProperty",
      inferredLink,
      characteristics: properties.get(iri)?.characteristics ?? [],
      children,
    }),
  );

  const dataPropertyTree = buildHierarchyTree(
    dataPropIris,
    dataPropParents,
    new Set(),
    (iri, inferredLink, children) => ({
      iri,
      label: shortOwlLabel(iri),
      kind: "DataProperty",
      inferredLink,
      characteristics: properties.get(iri)?.characteristics ?? [],
      children,
    }),
  );

  // ── Top-Level Branches & Faceted Browser Entities ─────────────────────────
  const topLevelBranches = assertedClassTree.map((n) => n.iri);
  const topLevelBranchSet = new Set(topLevelBranches);

  const getBranchesForClass = (clsIri: string): string[] => {
    const branches: string[] = [];
    if (topLevelBranchSet.has(clsIri)) branches.push(clsIri);
    for (const anc of fullAncestorMap.get(clsIri) ?? []) {
      if (topLevelBranchSet.has(anc) && !branches.includes(anc)) branches.push(anc);
    }
    return branches;
  };

  const facetedEntities: Owl2FacetedEntity[] = [];

  for (const cls of classes.values()) {
    const hasInferred =
      cls.inferredSuperClasses.length > 0 ||
      cls.inferredSubClasses.length > 0 ||
      cls.inferredInstances.length > 0 ||
      cls.unsatisfiable;
    const branches = getBranchesForClass(cls.iri);
    const parentPreview =
      cls.assertedSuperClasses.length > 0 ? `⊑ ${cls.assertedSuperClasses.map(shortOwlLabel).join(", ")}` : "owl:Thing";
    facetedEntities.push({
      iri: cls.iri,
      label: cls.label,
      kind: "Class",
      line: cls.line,
      unsatisfiable: cls.unsatisfiable,
      hasInferredFacts: hasInferred,
      characteristics: [],
      topLevelBranches: branches,
      summary: cls.unsatisfiable ? "⊥ Unsatisfiable" : parentPreview,
      searchText:
        `${cls.iri} ${cls.label} ${cls.assertedSuperClasses.join(" ")} ${cls.inferredSuperClasses.join(" ")} ${cls.complexSuperExpressions.join(" ")}`.toLowerCase(),
    });
  }

  for (const prop of properties.values()) {
    const domStr = prop.domains.length > 0 ? prop.domains.map(shortOwlLabel).join(", ") : "?";
    const rngStr = prop.ranges.length > 0 ? prop.ranges.map(shortOwlLabel).join(", ") : "?";
    facetedEntities.push({
      iri: prop.iri,
      label: prop.label,
      kind: prop.kind,
      line: prop.line,
      unsatisfiable: false,
      hasInferredFacts:
        prop.propertyChains.length > 0 || prop.characteristics.includes("Transitive") || prop.inverseOf.length > 0,
      characteristics: prop.characteristics,
      topLevelBranches: [],
      summary:
        prop.domains.length > 0 || prop.ranges.length > 0
          ? `${domStr} → ${rngStr}`
          : prop.characteristics.length > 0
            ? prop.characteristics.join(", ")
            : prop.kind,
      searchText:
        `${prop.iri} ${prop.label} ${prop.kind} ${prop.characteristics.join(" ")} ${prop.domains.join(" ")} ${prop.ranges.join(" ")}`.toLowerCase(),
    });
  }

  for (const ind of individuals.values()) {
    const hasInferred = ind.inferredTypes.length > 0 || ind.inferredRoleAssertions.length > 0 || ind.sameAs.length > 0;
    const branches = new Set<string>();
    for (const t of [...ind.assertedTypes, ...ind.inferredTypes]) {
      for (const b of getBranchesForClass(t)) branches.add(b);
    }
    const allTypeLabels = [...ind.assertedTypes, ...ind.inferredTypes].map(shortOwlLabel);
    facetedEntities.push({
      iri: ind.iri,
      label: ind.label,
      kind: "Individual",
      line: ind.line,
      unsatisfiable: false,
      hasInferredFacts: hasInferred,
      characteristics: [],
      topLevelBranches: Array.from(branches),
      summary: allTypeLabels.length > 0 ? `∈ ${allTypeLabels.slice(0, 3).join(", ")}` : "NamedIndividual",
      searchText: `${ind.iri} ${ind.label} ${ind.assertedTypes.join(" ")} ${ind.inferredTypes.join(" ")}`.toLowerCase(),
    });
  }

  return {
    format,
    formatLabel,
    ontologyIri,
    consistent: result.consistent,
    truncated: Boolean(result.truncated),
    reasoningTimeMs,
    clashes: [...result.clashes],
    unsatisfiableClasses: Array.from(unsatisfiableSet),
    classes,
    properties,
    individuals,
    assertedClassTree,
    inferredClassTree,
    mergedClassTree,
    objectPropertyTree,
    dataPropertyTree,
    inferredFacts,
    facetedEntities,
    topLevelBranches,
    assertedSubClassEdges,
    inferredSubClassEdges,
  };
}

export interface DlQueryMatch {
  iri: string;
  label: string;
  kind: Owl2EntityKind;
  inferred: boolean;
  line: number;
}

/**
 * Evaluates interactive DL Query / SPARQL-DL expressions against the reasoned workbench model.
 * Supported forms:
 * - `subclasses(:Class)` / `superclasses(:Class)` / `instances(:Class)` / `types(:Individual)`
 * - `disjoint(:Class)` / `unsatisfiable()` / `inferred()`
 * - Plain class/entity name (returns subclasses + instances)
 */
export function evaluateDlQuery(
  model: Owl2WorkbenchModel,
  rawQuery: string,
): { title: string; matches: DlQueryMatch[]; note?: string | undefined } {
  const q = rawQuery.trim();
  if (!q) return { title: "Enter a DL query", matches: [] };

  const resolveClassIri = (arg: string): string | undefined => {
    const cleaned = arg.trim();
    if (model.classes.has(cleaned)) return cleaned;
    const short = shortOwlLabel(cleaned).toLowerCase();
    for (const c of model.classes.values()) {
      if (c.label.toLowerCase() === short || c.iri.toLowerCase() === cleaned.toLowerCase()) return c.iri;
    }
    return undefined;
  };

  const resolveIndIri = (arg: string): string | undefined => {
    const cleaned = arg.trim();
    if (model.individuals.has(cleaned)) return cleaned;
    const short = shortOwlLabel(cleaned).toLowerCase();
    for (const ind of model.individuals.values()) {
      if (ind.label.toLowerCase() === short || ind.iri.toLowerCase() === cleaned.toLowerCase()) return ind.iri;
    }
    return undefined;
  };

  if (/^unsatisfiable\s*\(\s*\)$/i.test(q)) {
    return {
      title: "Unsatisfiable Classes (≡ owl:Nothing)",
      matches: model.unsatisfiableClasses.map((iri) => {
        const c = model.classes.get(iri);
        return { iri, label: shortOwlLabel(iri), kind: "Class", inferred: true, line: c?.line ?? 1 };
      }),
    };
  }

  const subM = /^subclasses\s*\(\s*([^)]+)\s*\)$/i.exec(q);
  if (subM?.[1]) {
    const target = resolveClassIri(subM[1]);
    if (!target) return { title: `subclasses(${subM[1]})`, matches: [], note: `Class '${subM[1]}' not found.` };
    const cls = model.classes.get(target)!;
    return {
      title: `Subclasses of ${cls.label}`,
      matches: [
        ...cls.assertedSubClasses.map((iri) => ({
          iri,
          label: shortOwlLabel(iri),
          kind: "Class" as const,
          inferred: false,
          line: model.classes.get(iri)?.line ?? 1,
        })),
        ...cls.inferredSubClasses.map((iri) => ({
          iri,
          label: shortOwlLabel(iri),
          kind: "Class" as const,
          inferred: true,
          line: model.classes.get(iri)?.line ?? 1,
        })),
      ],
    };
  }

  const supM = /^superclasses\s*\(\s*([^)]+)\s*\)$/i.exec(q);
  if (supM?.[1]) {
    const target = resolveClassIri(supM[1]);
    if (!target) return { title: `superclasses(${supM[1]})`, matches: [], note: `Class '${supM[1]}' not found.` };
    const cls = model.classes.get(target)!;
    return {
      title: `Superclasses of ${cls.label}`,
      matches: [
        ...cls.assertedSuperClasses.map((iri) => ({
          iri,
          label: shortOwlLabel(iri),
          kind: "Class" as const,
          inferred: false,
          line: model.classes.get(iri)?.line ?? 1,
        })),
        ...cls.inferredSuperClasses.map((iri) => ({
          iri,
          label: shortOwlLabel(iri),
          kind: "Class" as const,
          inferred: true,
          line: model.classes.get(iri)?.line ?? 1,
        })),
      ],
    };
  }

  const instM = /^instances\s*\(\s*([^)]+)\s*\)$/i.exec(q);
  if (instM?.[1]) {
    const target = resolveClassIri(instM[1]);
    if (!target) return { title: `instances(${instM[1]})`, matches: [], note: `Class '${instM[1]}' not found.` };
    const cls = model.classes.get(target)!;
    return {
      title: `Instances of ${cls.label}`,
      matches: [
        ...cls.assertedInstances.map((iri) => ({
          iri,
          label: shortOwlLabel(iri),
          kind: "Individual" as const,
          inferred: false,
          line: model.individuals.get(iri)?.line ?? 1,
        })),
        ...cls.inferredInstances.map((iri) => ({
          iri,
          label: shortOwlLabel(iri),
          kind: "Individual" as const,
          inferred: true,
          line: model.individuals.get(iri)?.line ?? 1,
        })),
      ],
    };
  }

  const typesM = /^types\s*\(\s*([^)]+)\s*\)$/i.exec(q);
  if (typesM?.[1]) {
    const target = resolveIndIri(typesM[1]);
    if (!target) return { title: `types(${typesM[1]})`, matches: [], note: `Individual '${typesM[1]}' not found.` };
    const ind = model.individuals.get(target)!;
    return {
      title: `Types of ${ind.label}`,
      matches: [
        ...ind.assertedTypes.map((iri) => ({
          iri,
          label: shortOwlLabel(iri),
          kind: "Class" as const,
          inferred: false,
          line: model.classes.get(iri)?.line ?? 1,
        })),
        ...ind.inferredTypes.map((iri) => ({
          iri,
          label: shortOwlLabel(iri),
          kind: "Class" as const,
          inferred: true,
          line: model.classes.get(iri)?.line ?? 1,
        })),
      ],
    };
  }

  const disjM = /^disjoint\s*\(\s*([^)]+)\s*\)$/i.exec(q);
  if (disjM?.[1]) {
    const target = resolveClassIri(disjM[1]);
    if (!target) return { title: `disjoint(${disjM[1]})`, matches: [], note: `Class '${disjM[1]}' not found.` };
    const cls = model.classes.get(target)!;
    return {
      title: `Classes disjoint with ${cls.label}`,
      matches: cls.disjointWith.map((iri) => ({
        iri,
        label: shortOwlLabel(iri),
        kind: "Class" as const,
        inferred: false,
        line: model.classes.get(iri)?.line ?? 1,
      })),
    };
  }

  // Fallback: match class name directly and show subclasses + instances
  const directCls = resolveClassIri(q);
  if (directCls) {
    const cls = model.classes.get(directCls)!;
    return {
      title: `Subclasses & Instances of ${cls.label}`,
      matches: [
        ...cls.assertedSubClasses.map((iri) => ({
          iri,
          label: shortOwlLabel(iri),
          kind: "Class" as const,
          inferred: false,
          line: model.classes.get(iri)?.line ?? 1,
        })),
        ...cls.inferredSubClasses.map((iri) => ({
          iri,
          label: shortOwlLabel(iri),
          kind: "Class" as const,
          inferred: true,
          line: model.classes.get(iri)?.line ?? 1,
        })),
        ...cls.assertedInstances.map((iri) => ({
          iri,
          label: shortOwlLabel(iri),
          kind: "Individual" as const,
          inferred: false,
          line: model.individuals.get(iri)?.line ?? 1,
        })),
        ...cls.inferredInstances.map((iri) => ({
          iri,
          label: shortOwlLabel(iri),
          kind: "Individual" as const,
          inferred: true,
          line: model.individuals.get(iri)?.line ?? 1,
        })),
      ],
    };
  }

  return {
    title: `Query: ${q}`,
    matches: [],
    note: "Try subclasses(:Class), superclasses(:Class), instances(:Class), types(:Individual), disjoint(:Class), or unsatisfiable().",
  };
}
