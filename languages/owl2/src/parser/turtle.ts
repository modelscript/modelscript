// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OWL2Axiom } from "@modelscript/runtime";
import { BUILTIN_OWL2_PREFIXES } from "../cst-lowering.js";

export interface RdfTriple {
  subject: string;
  predicate: string;
  object: string;
}

const META_TYPES = new Set([
  "owl:Ontology",
  "owl:Class",
  "rdfs:Class",
  "owl:Restriction",
  "owl:ObjectProperty",
  "owl:DatatypeProperty",
  "owl:AnnotationProperty",
  "owl:OntologyProperty",
  "owl:NamedIndividual",
  "owl:TransitiveProperty",
  "owl:SymmetricProperty",
  "owl:AsymmetricProperty",
  "owl:ReflexiveProperty",
  "owl:IrreflexiveProperty",
  "owl:FunctionalProperty",
  "owl:InverseFunctionalProperty",
  "owl:AllDisjointClasses",
  "owl:AllDisjointProperties",
  "owl:AllDifferent",
  "owl:Axiom",
  "owl:NegativePropertyAssertion",
  "rdfs:Datatype",
  "rdf:Property",
  "rdf:List",
]);

const META_PREDICATES = new Set([
  "rdf:type",
  "rdfs:subClassOf",
  "rdfs:subPropertyOf",
  "rdfs:domain",
  "rdfs:range",
  "rdfs:label",
  "rdfs:comment",
  "rdfs:seeAlso",
  "rdfs:isDefinedBy",
  "owl:equivalentClass",
  "owl:disjointWith",
  "owl:disjointUnionOf",
  "owl:equivalentProperty",
  "owl:inverseOf",
  "owl:propertyDisjointWith",
  "owl:propertyChainAxiom",
  "owl:sameAs",
  "owl:differentFrom",
  "owl:intersectionOf",
  "owl:unionOf",
  "owl:complementOf",
  "owl:oneOf",
  "owl:onProperty",
  "owl:someValuesFrom",
  "owl:allValuesFrom",
  "owl:hasValue",
  "owl:hasSelf",
  "owl:minCardinality",
  "owl:maxCardinality",
  "owl:cardinality",
  "owl:minQualifiedCardinality",
  "owl:maxQualifiedCardinality",
  "owl:qualifiedCardinality",
  "owl:onClass",
  "owl:onDataRange",
  "owl:onDatatype",
  "owl:withRestrictions",
  "owl:members",
  "owl:distinctMembers",
  "owl:sourceIndividual",
  "owl:assertionProperty",
  "owl:targetIndividual",
  "owl:targetValue",
  "owl:imports",
  "owl:versionIRI",
  "owl:versionInfo",
]);

function isBlankNode(term: string): boolean {
  return term.startsWith("_:");
}

function isLiteral(term: string): boolean {
  return term.startsWith('"') || term.startsWith("'") || /^[+-]?\d/.test(term) || term === "true" || term === "false";
}

function extractLiteralValue(term: string): string {
  const m = term.match(/^"(.*)"(?:\^\^.*|@[a-zA-Z0-9-]+)?$/s) ?? term.match(/^'(.*)'(?:\^\^.*|@[a-zA-Z0-9-]+)?$/s);
  if (m) return m[1]!;
  return term;
}

/**
 * Tokenizes a W3C Turtle (`.ttl`) document into lexical tokens while preserving literals, IRIs, and punctuation.
 */
function tokenizeTurtle(source: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "#") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (ch === ";" || ch === "," || ch === "[" || ch === "]" || ch === "(" || ch === ")") {
      tokens.push(ch);
      i++;
      continue;
    }
    if (ch === ".") {
      // Check if '.' is a statement terminator vs decimal point in a number
      const next = source[i + 1];
      if (!next || !/\d/.test(next)) {
        tokens.push(".");
        i++;
        continue;
      }
    }
    if (ch === "<") {
      const start = i;
      while (i < n && source[i] !== ">") i++;
      if (i < n) i++;
      tokens.push(source.slice(start, i));
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const isTriple = source.slice(i, i + 3) === quote.repeat(3);
      const start = i;
      if (isTriple) {
        i += 3;
        while (i < n && source.slice(i, i + 3) !== quote.repeat(3)) {
          if (source[i] === "\\") i++;
          i++;
        }
        if (i < n) i += 3;
      } else {
        i++;
        while (i < n && source[i] !== quote) {
          if (source[i] === "\\") i++;
          i++;
        }
        if (i < n) i++;
      }
      // Optional language tag @en or datatype ^^...
      if (source.slice(i, i + 2) === "^^") {
        i += 2;
        if (source[i] === "<") {
          while (i < n && source[i] !== ">") i++;
          if (i < n) i++;
        } else {
          while (i < n && !/\s|[;,[\]()."]/.test(source[i]!)) i++;
        }
      } else if (source[i] === "@") {
        i++;
        while (i < n && /[a-zA-Z0-9-]/.test(source[i]!)) i++;
      }
      tokens.push(source.slice(start, i));
      continue;
    }

    // Read word token; stop before whitespace or Turtle punctuation (note: trailing '.' is separate)
    const start = i;
    while (i < n && !/\s|[;,[\]()#"']/.test(source[i]!)) {
      if (source[i] === "." && (i + 1 >= n || /\s|[;,[\]()#"']/.test(source[i + 1]!))) {
        break;
      }
      i++;
    }
    if (i > start) {
      tokens.push(source.slice(start, i));
    } else {
      i++;
    }
  }

  return tokens;
}

/**
 * Parses a W3C Turtle (`.ttl`) ontology document into normalized `OWL2Axiom[]`
 * with recursive Tseitin auxiliary concept normalization for nested restrictions and boolean class expressions.
 */
export function parseTurtleToOwl2Axioms(source: string): OWL2Axiom[] {
  const tokens = tokenizeTurtle(source);
  const prefixes = new Map<string, string>(BUILTIN_OWL2_PREFIXES);
  const triples: RdfTriple[] = [];
  const collections = new Map<string, string[]>();
  let bnodeCounter = 0;
  let pos = 0;

  const freshBnode = (): string => `_:b${++bnodeCounter}`;

  const normTerm = (raw: string): string => {
    const trimmed = raw.trim();
    if (trimmed === "a") return "rdf:type";
    if (isBlankNode(trimmed) || isLiteral(trimmed)) return trimmed;
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
      const fullIri = trimmed.slice(1, -1);
      for (const [pfx, baseIri] of prefixes) {
        if (baseIri && fullIri.startsWith(baseIri) && fullIri.length > baseIri.length) {
          const local = fullIri.slice(baseIri.length);
          if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(local)) {
            return `${pfx}${local}`;
          }
        }
      }
      return fullIri;
    }
    return trimmed;
  };

  function parseTerm(): string {
    const tok = tokens[pos];
    if (!tok) return "owl:Thing";
    if (tok === "[") {
      pos++; // consume '['
      const bnode = freshBnode();
      if (tokens[pos] !== "]") {
        parsePredicateObjectList(bnode);
      }
      if (tokens[pos] === "]") pos++;
      return bnode;
    }
    if (tok === "(") {
      pos++; // consume '('
      const listId = freshBnode();
      const items: string[] = [];
      while (pos < tokens.length && tokens[pos] !== ")") {
        items.push(parseTerm());
      }
      if (tokens[pos] === ")") pos++;
      collections.set(listId, items);
      return listId;
    }
    pos++;
    return normTerm(tok);
  }

  function parseObjectList(subject: string, predicate: string): void {
    while (pos < tokens.length) {
      const obj = parseTerm();
      triples.push({ subject, predicate, object: obj });
      if (tokens[pos] === ",") {
        pos++;
      } else {
        break;
      }
    }
  }

  function parsePredicateObjectList(subject: string): void {
    while (pos < tokens.length && tokens[pos] !== "." && tokens[pos] !== "]") {
      if (tokens[pos] === ";") {
        pos++;
        continue;
      }
      const predTok = tokens[pos];
      if (!predTok || predTok === "." || predTok === "]") break;
      const predicate = parseTerm();
      parseObjectList(subject, predicate);
      if (tokens[pos] === ";") {
        pos++;
      } else {
        break;
      }
    }
  }

  while (pos < tokens.length) {
    const tok = tokens[pos]!;
    if (tok === ".") {
      pos++;
      continue;
    }
    if (tok === "@prefix" || tok.toLowerCase() === "prefix") {
      pos++;
      const pfx = tokens[pos++] ?? ":";
      const iriRaw = tokens[pos++] ?? "";
      if (tokens[pos] === ".") pos++;
      const cleanIri = iriRaw.startsWith("<") && iriRaw.endsWith(">") ? iriRaw.slice(1, -1) : iriRaw;
      prefixes.set(pfx.endsWith(":") ? pfx : `${pfx}:`, cleanIri);
      continue;
    }
    if (tok === "@base" || tok.toLowerCase() === "base") {
      pos++;
      const iriRaw = tokens[pos++] ?? "";
      if (tokens[pos] === ".") pos++;
      const cleanIri = iriRaw.startsWith("<") && iriRaw.endsWith(">") ? iriRaw.slice(1, -1) : iriRaw;
      if (!prefixes.has(":")) prefixes.set(":", cleanIri);
      continue;
    }

    const subject = parseTerm();
    if (tokens[pos] !== ".") {
      parsePredicateObjectList(subject);
    }
    if (tokens[pos] === ".") pos++;
  }

  // Index triples by subject
  const bySubject = new Map<string, Map<string, string[]>>();
  for (const t of triples) {
    let predMap = bySubject.get(t.subject);
    if (!predMap) {
      predMap = new Map();
      bySubject.set(t.subject, predMap);
    }
    let objs = predMap.get(t.predicate);
    if (!objs) {
      objs = [];
      predMap.set(t.predicate, objs);
    }
    objs.push(t.object);
  }

  const getFirstObj = (subj: string, pred: string): string | undefined => bySubject.get(subj)?.get(pred)?.[0];

  const getObjs = (subj: string, pred: string): string[] => bySubject.get(subj)?.get(pred) ?? [];

  const getListItems = (listTerm: string): string[] => {
    if (collections.has(listTerm)) return collections.get(listTerm)!;
    // Also support explicit rdf:first / rdf:rest chains
    const out: string[] = [];
    let curr: string | undefined = listTerm;
    const visited = new Set<string>();
    while (curr && curr !== "rdf:nil" && !visited.has(curr)) {
      visited.add(curr);
      const first = getFirstObj(curr, "rdf:first");
      if (first) out.push(first);
      curr = getFirstObj(curr, "rdf:rest");
    }
    return out;
  };

  const axioms: OWL2Axiom[] = [];
  const declaredClasses = new Set<string>();
  const declaredObjProps = new Set<string>();
  const declaredDataProps = new Set<string>();
  const declaredIndividuals = new Set<string>();
  const bnodeToAuxIri = new Map<string, string>();
  let auxCounter = 0;
  const freshAuxIri = (): string => `__aux_${++auxCounter}`;

  const ensureClassDecl = (iri: string): void => {
    if (
      !isBlankNode(iri) &&
      !isLiteral(iri) &&
      iri !== "owl:Thing" &&
      iri !== "owl:Nothing" &&
      !declaredClasses.has(iri)
    ) {
      declaredClasses.add(iri);
      axioms.push({ type: "ClassDeclaration", iri });
    }
  };

  // Pass 1: Explicit entity declarations
  for (const [subj, predMap] of bySubject) {
    if (isBlankNode(subj)) continue;
    const types = predMap.get("rdf:type") ?? [];
    for (const t of types) {
      if (t === "owl:Class" || t === "rdfs:Class") {
        ensureClassDecl(subj);
      } else if (t === "owl:ObjectProperty") {
        if (!declaredObjProps.has(subj)) {
          declaredObjProps.add(subj);
          axioms.push({ type: "ObjectPropertyDeclaration", iri: subj });
        }
      } else if (t === "owl:DatatypeProperty") {
        if (!declaredDataProps.has(subj)) {
          declaredDataProps.add(subj);
          axioms.push({ type: "DataPropertyDeclaration", iri: subj });
        }
      } else if (t === "owl:NamedIndividual") {
        if (!declaredIndividuals.has(subj)) {
          declaredIndividuals.add(subj);
          axioms.push({ type: "IndividualDeclaration", iri: subj });
        }
      }
    }
  }

  /**
   * Resolves a class term (named IRI or blank-node restriction/boolean expression)
   * into a class IRI, emitting auxiliary Tseitin definitions when needed.
   */
  const resolveClassTerm = (term: string, targetIri?: string): string => {
    if (!isBlankNode(term)) {
      ensureClassDecl(term);
      return term;
    }
    if (!targetIri && bnodeToAuxIri.has(term)) {
      return bnodeToAuxIri.get(term)!;
    }

    const auxIri = targetIri ?? freshAuxIri();
    if (!targetIri) {
      bnodeToAuxIri.set(term, auxIri);
    }

    const predMap = bySubject.get(term);
    if (!predMap) return auxIri;

    // 1. owl:intersectionOf
    const interList = getFirstObj(term, "owl:intersectionOf");
    if (interList) {
      const opIris = getListItems(interList).map((item) => resolveClassTerm(item));
      if (!targetIri) {
        axioms.push({
          type: "ClassDeclaration",
          iri: auxIri,
          intersectionOf: opIris,
        } as unknown as OWL2Axiom);
      } else {
        axioms.push({
          type: "ClassDeclaration",
          iri: auxIri,
          intersectionOf: opIris,
        } as unknown as OWL2Axiom);
      }
      for (const op of opIris) {
        axioms.push({ type: "SubClassOf", subClassIri: auxIri, superClassIri: op });
      }
      return auxIri;
    }

    // 2. owl:unionOf
    const unionList = getFirstObj(term, "owl:unionOf");
    if (unionList) {
      const opIris = getListItems(unionList).map((item) => resolveClassTerm(item));
      axioms.push({
        type: "ClassDeclaration",
        iri: auxIri,
        unionOf: opIris,
      } as unknown as OWL2Axiom);
      axioms.push({
        type: "DisjunctiveClass",
        superClassIri: auxIri,
        classIris: opIris,
        unionEquiv: true,
      } as unknown as OWL2Axiom);
      return auxIri;
    }

    // 3. owl:complementOf
    const compTerm = getFirstObj(term, "owl:complementOf");
    if (compTerm) {
      const opIri = resolveClassTerm(compTerm);
      axioms.push({
        type: "ClassDeclaration",
        iri: auxIri,
        complementOf: opIri,
      } as unknown as OWL2Axiom);
      axioms.push({ type: "DisjointClasses", classIris: [auxIri, opIri] });
      return auxIri;
    }

    // 4. owl:oneOf
    const oneOfList = getFirstObj(term, "owl:oneOf");
    if (oneOfList) {
      const inds = getListItems(oneOfList);
      if (!targetIri) {
        axioms.push({ type: "ClassDeclaration", iri: auxIri });
      }
      axioms.push({
        type: "ObjectOneOf",
        classIri: auxIri,
        individualIris: inds,
      } as unknown as OWL2Axiom);
      return auxIri;
    }

    // 5. owl:Restriction
    const onProp = getFirstObj(term, "owl:onProperty");
    if (onProp) {
      const someFiller = getFirstObj(term, "owl:someValuesFrom");
      if (someFiller) {
        if (someFiller.startsWith("xsd:") || declaredDataProps.has(onProp)) {
          axioms.push({
            type: "DataSomeValuesFrom",
            subClassIri: auxIri,
            propertyIri: onProp,
            fillerDatatypeIri: someFiller,
          } as unknown as OWL2Axiom);
        } else {
          const fillerIri = resolveClassTerm(someFiller);
          axioms.push({
            type: "ClassDeclaration",
            iri: auxIri,
            someValuesFrom: { propertyIri: onProp, fillerClassIri: fillerIri },
          } as unknown as OWL2Axiom);
          axioms.push({
            type: "ObjectSomeValuesFrom",
            subClassIri: auxIri,
            propertyIri: onProp,
            fillerClassIri: fillerIri,
          });
        }
        return auxIri;
      }

      const allFiller = getFirstObj(term, "owl:allValuesFrom");
      if (allFiller) {
        if (allFiller.startsWith("xsd:") || declaredDataProps.has(onProp)) {
          axioms.push({
            type: "DataAllValuesFrom",
            subClassIri: auxIri,
            propertyIri: onProp,
            fillerDatatypeIri: allFiller,
          } as unknown as OWL2Axiom);
        } else {
          const fillerIri = resolveClassTerm(allFiller);
          axioms.push({
            type: "ClassDeclaration",
            iri: auxIri,
            allValuesFrom: { propertyIri: onProp, targetClassIri: fillerIri },
          } as unknown as OWL2Axiom);
          axioms.push({
            type: "UniversalRestriction",
            classIri: auxIri,
            propertyIri: onProp,
            targetClassIri: fillerIri,
          });
        }
        return auxIri;
      }

      const hasVal = getFirstObj(term, "owl:hasValue");
      if (hasVal) {
        if (isLiteral(hasVal) || declaredDataProps.has(onProp)) {
          axioms.push({
            type: "DataHasValue",
            classIri: auxIri,
            propertyIri: onProp,
            value: extractLiteralValue(hasVal),
          } as unknown as OWL2Axiom);
        } else {
          axioms.push({
            type: "ObjectSomeValuesFrom",
            subClassIri: auxIri,
            propertyIri: onProp,
            fillerClassIri: hasVal,
            isNominal: true,
          } as unknown as OWL2Axiom);
        }
        return auxIri;
      }

      const hasSelf = getFirstObj(term, "owl:hasSelf");
      if (hasSelf && extractLiteralValue(hasSelf) === "true") {
        axioms.push({
          type: "SelfRestriction",
          classIri: auxIri,
          propertyIri: onProp,
        } as unknown as OWL2Axiom);
        return auxIri;
      }

      const minCard = getFirstObj(term, "owl:minQualifiedCardinality") ?? getFirstObj(term, "owl:minCardinality");
      const maxCard = getFirstObj(term, "owl:maxQualifiedCardinality") ?? getFirstObj(term, "owl:maxCardinality");
      const exactCard = getFirstObj(term, "owl:qualifiedCardinality") ?? getFirstObj(term, "owl:cardinality");
      const cardRaw = minCard ?? maxCard ?? exactCard;
      if (cardRaw !== undefined) {
        const cardType: "min" | "max" | "exact" =
          minCard !== undefined ? "min" : maxCard !== undefined ? "max" : "exact";
        const count = Math.max(0, parseInt(extractLiteralValue(cardRaw), 10) || 0);
        const onCls = getFirstObj(term, "owl:onClass");
        const fillerIri = onCls ? resolveClassTerm(onCls) : "owl:Thing";
        axioms.push({
          type: "QualifiedCardinality",
          classIri: auxIri,
          propertyIri: onProp,
          cardinalityType: cardType,
          count,
          fillerClassIri: fillerIri,
        });
        return auxIri;
      }
    }

    return auxIri;
  };

  // Pass 2: TBox, RBox, and ABox axioms
  for (const [subj, predMap] of bySubject) {
    const types = predMap.get("rdf:type") ?? [];

    // Special blank node constructs: AllDisjointClasses, AllDifferent, NegativePropertyAssertion
    if (types.includes("owl:AllDisjointClasses")) {
      const membersList = getFirstObj(subj, "owl:members");
      if (membersList) {
        const classIris = getListItems(membersList).map((c) => resolveClassTerm(c));
        if (classIris.length >= 2) {
          axioms.push({ type: "DisjointClasses", classIris });
        }
      }
      continue;
    }

    if (types.includes("owl:AllDifferent")) {
      const membersList = getFirstObj(subj, "owl:distinctMembers") ?? getFirstObj(subj, "owl:members");
      if (membersList) {
        const individualIris = getListItems(membersList);
        if (individualIris.length >= 2) {
          axioms.push({ type: "DifferentIndividuals", individualIris });
        }
      }
      continue;
    }

    if (types.includes("owl:NegativePropertyAssertion")) {
      const srcInd = getFirstObj(subj, "owl:sourceIndividual");
      const prop = getFirstObj(subj, "owl:assertionProperty");
      const tgtInd = getFirstObj(subj, "owl:targetIndividual");
      const tgtVal = getFirstObj(subj, "owl:targetValue");
      if (srcInd && prop && tgtInd) {
        axioms.push({
          type: "NegativeObjectPropertyAssertion",
          propertyIri: prop,
          subjectIri: srcInd,
          objectIri: tgtInd,
        });
      } else if (srcInd && prop && tgtVal) {
        axioms.push({
          type: "NegativeDataPropertyAssertion",
          propertyIri: prop,
          subjectIri: srcInd,
          value: extractLiteralValue(tgtVal),
        });
      }
      continue;
    }

    // Property characteristics via rdf:type
    for (const t of types) {
      if (t === "owl:TransitiveProperty") {
        axioms.push({ type: "TransitiveObjectProperty", propertyIri: subj });
      } else if (t === "owl:SymmetricProperty") {
        axioms.push({ type: "SymmetricObjectProperty", propertyIri: subj });
      } else if (t === "owl:AsymmetricProperty") {
        axioms.push({ type: "AsymmetricObjectProperty", propertyIri: subj });
      } else if (t === "owl:ReflexiveProperty") {
        axioms.push({ type: "ReflexiveObjectProperty", propertyIri: subj });
      } else if (t === "owl:IrreflexiveProperty") {
        axioms.push({ type: "IrreflexiveObjectProperty", propertyIri: subj });
      } else if (t === "owl:FunctionalProperty") {
        if (declaredDataProps.has(subj)) {
          axioms.push({ type: "FunctionalDataProperty", propertyIri: subj });
        } else {
          axioms.push({ type: "FunctionalObjectProperty", propertyIri: subj });
        }
      } else if (t === "owl:InverseFunctionalProperty") {
        axioms.push({ type: "InverseFunctionalObjectProperty", propertyIri: subj });
      }
    }

    // rdfs:subClassOf
    for (const sup of getObjs(subj, "rdfs:subClassOf")) {
      const subIri = isBlankNode(subj) ? resolveClassTerm(subj) : subj;
      if (!isBlankNode(subj)) ensureClassDecl(subj);
      if (isBlankNode(sup)) {
        const supAux = resolveClassTerm(sup);
        axioms.push({ type: "SubClassOf", subClassIri: subIri, superClassIri: supAux });
      } else {
        ensureClassDecl(sup);
        axioms.push({ type: "SubClassOf", subClassIri: subIri, superClassIri: sup });
      }
    }

    // owl:equivalentClass
    for (const eq of getObjs(subj, "owl:equivalentClass")) {
      const subIri = isBlankNode(subj) ? resolveClassTerm(subj) : subj;
      if (!isBlankNode(subj)) ensureClassDecl(subj);
      const eqIri = resolveClassTerm(eq);
      axioms.push({ type: "EquivalentClasses", classIris: [subIri, eqIri] });
    }

    // owl:disjointWith
    for (const disj of getObjs(subj, "owl:disjointWith")) {
      const subIri = isBlankNode(subj) ? resolveClassTerm(subj) : subj;
      const disjIri = resolveClassTerm(disj);
      axioms.push({ type: "DisjointClasses", classIris: [subIri, disjIri] });
    }

    // owl:disjointUnionOf
    for (const duList of getObjs(subj, "owl:disjointUnionOf")) {
      const subIri = resolveClassTerm(subj);
      const memberIris = getListItems(duList).map((c) => resolveClassTerm(c));
      if (memberIris.length >= 2) {
        axioms.push({ type: "DisjointClasses", classIris: memberIris });
        axioms.push({
          type: "DisjunctiveClass",
          superClassIri: subIri,
          classIris: memberIris,
          unionEquiv: true,
        } as unknown as OWL2Axiom);
      }
    }

    // If subj is a named class with inline owl:intersectionOf / owl:unionOf / owl:complementOf / owl:oneOf
    if (!isBlankNode(subj)) {
      if (
        predMap.has("owl:intersectionOf") ||
        predMap.has("owl:unionOf") ||
        predMap.has("owl:complementOf") ||
        predMap.has("owl:oneOf")
      ) {
        ensureClassDecl(subj);
        resolveClassTerm(subj, subj);
      }
    }

    // RBox axioms
    for (const supProp of getObjs(subj, "rdfs:subPropertyOf")) {
      axioms.push({ type: "SubObjectPropertyOf", subPropertyIri: subj, superPropertyIri: supProp });
    }
    for (const eqProp of getObjs(subj, "owl:equivalentProperty")) {
      axioms.push({ type: "SubObjectPropertyOf", subPropertyIri: subj, superPropertyIri: eqProp });
      axioms.push({ type: "SubObjectPropertyOf", subPropertyIri: eqProp, superPropertyIri: subj });
    }
    for (const invProp of getObjs(subj, "owl:inverseOf")) {
      axioms.push({ type: "InverseObjectProperty", propertyIri: subj, inversePropertyIri: invProp });
    }
    for (const disjProp of getObjs(subj, "owl:propertyDisjointWith")) {
      axioms.push({
        type: "DisjointObjectProperties",
        propertyIris: [subj, disjProp],
      } as unknown as OWL2Axiom);
    }
    for (const chainList of getObjs(subj, "owl:propertyChainAxiom")) {
      const chainIris = getListItems(chainList);
      if (chainIris.length >= 2) {
        axioms.push({
          type: "SubObjectPropertyChainOf",
          propertyChainIris: chainIris,
          superPropertyIri: subj,
        } as unknown as OWL2Axiom);
      }
    }
    for (const dom of getObjs(subj, "rdfs:domain")) {
      const domIri = resolveClassTerm(dom);
      if (declaredDataProps.has(subj)) {
        axioms.push({ type: "DataPropertyDomain", propertyIri: subj, domainIri: domIri });
      } else {
        axioms.push({ type: "ObjectPropertyDomain", propertyIri: subj, domainIri: domIri });
      }
    }
    for (const rng of getObjs(subj, "rdfs:range")) {
      if (declaredDataProps.has(subj) || rng.startsWith("xsd:") || rng.startsWith("rdfs:Literal")) {
        axioms.push({ type: "DataPropertyRange", propertyIri: subj, rangeIri: rng });
      } else {
        const rngIri = resolveClassTerm(rng);
        axioms.push({ type: "ObjectPropertyRange", propertyIri: subj, rangeIri: rngIri });
      }
    }

    // Individual equality / inequality
    for (const same of getObjs(subj, "owl:sameAs")) {
      axioms.push({ type: "SameIndividual", individualIris: [subj, same] });
    }
    for (const diff of getObjs(subj, "owl:differentFrom")) {
      axioms.push({ type: "DifferentIndividuals", individualIris: [subj, diff] });
    }

    // ABox ClassAssertions and PropertyAssertions (only for non-blank subjects)
    if (!isBlankNode(subj)) {
      for (const t of types) {
        if (!META_TYPES.has(t)) {
          const clsIri = resolveClassTerm(t);
          if (!declaredIndividuals.has(subj)) {
            declaredIndividuals.add(subj);
            axioms.push({ type: "IndividualDeclaration", iri: subj });
          }
          axioms.push({ type: "ClassAssertion", classIri: clsIri, individualIri: subj });
        }
      }

      for (const [pred, objs] of predMap) {
        if (
          META_PREDICATES.has(pred) ||
          pred.startsWith("rdf:") ||
          pred.startsWith("rdfs:") ||
          pred.startsWith("owl:")
        ) {
          continue;
        }
        for (const obj of objs) {
          if (isLiteral(obj) || declaredDataProps.has(pred)) {
            axioms.push({
              type: "DataPropertyAssertion",
              propertyIri: pred,
              subjectIri: subj,
              value: extractLiteralValue(obj),
            });
          } else if (!isBlankNode(obj)) {
            axioms.push({
              type: "ObjectPropertyAssertion",
              propertyIri: pred,
              subjectIri: subj,
              objectIri: obj,
            });
          }
        }
      }
    }
  }

  return axioms;
}
