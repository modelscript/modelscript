// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Axiom Indexing, Retraction, and State Reset Operations for `WasmOntologyReasoner`.
 */

import { axiomEqual } from "./axiom-utils.js";
import type { OWL2Axiom } from "./owl2-types.js";
import { ensureClassInState, unifyIndividualsInState, type ReasonerState } from "./reasoner-state.js";

/** Indexes a single OWL 2 axiom into the reasoner's internal class, property, and individual tables. */
export function indexAxiomIntoState(state: ReasonerState, axiom: OWL2Axiom): void {
  switch (axiom.type) {
    case "ClassDeclaration": {
      ensureClassInState(state.classes, axiom.iri);
      break;
    }

    case "SubClassOf": {
      const sub = ensureClassInState(state.classes, axiom.subClassIri);
      const sup = ensureClassInState(state.classes, axiom.superClassIri);
      sub.superClasses.add(axiom.superClassIri);
      sup.subClasses.add(axiom.subClassIri);
      break;
    }

    case "EquivalentClasses": {
      for (let i = 0; i < axiom.classIris.length; i++) {
        const aIri = axiom.classIris[i];
        if (!aIri) continue;
        const a = ensureClassInState(state.classes, aIri);
        for (let j = 0; j < axiom.classIris.length; j++) {
          if (i === j) continue;
          const bIri = axiom.classIris[j];
          if (!bIri) continue;
          a.equivalents.add(bIri);
          a.superClasses.add(bIri);
          const b = ensureClassInState(state.classes, bIri);
          b.subClasses.add(aIri);
        }
      }
      break;
    }

    case "DisjointClasses": {
      for (let i = 0; i < axiom.classIris.length; i++) {
        const classIri = axiom.classIris[i];
        if (!classIri) continue;
        ensureClassInState(state.classes, classIri);
        for (let j = i + 1; j < axiom.classIris.length; j++) {
          const a = classIri;
          const b = axiom.classIris[j];
          if (!b) continue;
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          state.disjointPairs.add(key);
        }
      }
      break;
    }

    case "ObjectPropertyDeclaration": {
      state.objectProperties.add(axiom.iri);
      if (axiom.characteristics?.includes("Transitive")) {
        state.transitiveProperties.add(axiom.iri);
      }
      break;
    }

    case "DataPropertyDeclaration": {
      state.dataProperties.add(axiom.iri);
      break;
    }

    case "TransitiveObjectProperty": {
      state.transitiveProperties.add(axiom.propertyIri);
      break;
    }

    case "ObjectPropertyAssertion": {
      const edges = state.objectPropertyAssertions.get(axiom.propertyIri);
      const edge = { subjectIri: axiom.subjectIri, objectIri: axiom.objectIri };
      if (edges) {
        edges.push(edge);
      } else {
        state.objectPropertyAssertions.set(axiom.propertyIri, [edge]);
      }
      break;
    }

    case "DataPropertyAssertion": {
      state.rawDataPropertyAssertions.push(axiom);
      const assertions = state.dataPropertyAssertions.get(axiom.propertyIri);
      const assertion = { subjectIri: axiom.subjectIri, value: axiom.value };
      if (assertions) {
        assertions.push(assertion);
      } else {
        state.dataPropertyAssertions.set(axiom.propertyIri, [assertion]);
      }
      break;
    }

    case "IndividualDeclaration": {
      if (!state.individualTypes.has(axiom.iri)) {
        state.individualTypes.set(axiom.iri, new Set());
      }
      break;
    }

    case "ClassAssertion": {
      const types = state.individualTypes.get(axiom.individualIri);
      if (types) {
        types.add(axiom.classIri);
      } else {
        state.individualTypes.set(axiom.individualIri, new Set([axiom.classIri]));
      }
      break;
    }

    case "FunctionalObjectProperty": {
      state.functionalObjectProperties.add(axiom.propertyIri);
      break;
    }

    case "FunctionalDataProperty": {
      state.dataProperties.add(axiom.propertyIri);
      state.functionalDataProperties.add(axiom.propertyIri);
      break;
    }

    case "SameIndividual": {
      for (let i = 0; i < axiom.individualIris.length; i++) {
        for (let j = i + 1; j < axiom.individualIris.length; j++) {
          const a = axiom.individualIris[i]!;
          const b = axiom.individualIris[j]!;
          unifyIndividualsInState(state.sameIndividualGroups, state.individualTypes, a, b);
        }
      }
      break;
    }

    case "ObjectSomeValuesFrom": {
      state.objectProperties.add(axiom.propertyIri);
      ensureClassInState(state.classes, axiom.fillerClassIri);
      if (axiom.subClassIri) {
        ensureClassInState(state.classes, axiom.subClassIri);
      }
      break;
    }

    case "DataSomeValuesFrom": {
      state.dataProperties.add(axiom.propertyIri);
      if (axiom.subClassIri) {
        ensureClassInState(state.classes, axiom.subClassIri);
      }
      break;
    }

    case "InverseFunctionalObjectProperty": {
      state.objectProperties.add(axiom.propertyIri);
      state.inverseFunctionalObjectProperties.add(axiom.propertyIri);
      break;
    }

    case "ReflexiveObjectProperty": {
      state.objectProperties.add(axiom.propertyIri);
      state.reflexiveProperties.add(axiom.propertyIri);
      break;
    }

    case "SubObjectPropertyOf": {
      state.objectProperties.add(axiom.subPropertyIri);
      state.objectProperties.add(axiom.superPropertyIri);
      let sups = state.subObjectPropertyEdges.get(axiom.subPropertyIri);
      if (!sups) {
        sups = new Set();
        state.subObjectPropertyEdges.set(axiom.subPropertyIri, sups);
      }
      sups.add(axiom.superPropertyIri);
      break;
    }

    case "SubDataPropertyOf": {
      state.dataProperties.add(axiom.subPropertyIri);
      state.dataProperties.add(axiom.superPropertyIri);
      let sups = state.subDataPropertyEdges.get(axiom.subPropertyIri);
      if (!sups) {
        sups = new Set();
        state.subDataPropertyEdges.set(axiom.subPropertyIri, sups);
      }
      sups.add(axiom.superPropertyIri);
      break;
    }

    case "ObjectPropertyDomain": {
      state.objectProperties.add(axiom.propertyIri);
      ensureClassInState(state.classes, axiom.domainIri);
      let doms = state.objectPropertyDomains.get(axiom.propertyIri);
      if (!doms) {
        doms = new Set();
        state.objectPropertyDomains.set(axiom.propertyIri, doms);
      }
      doms.add(axiom.domainIri);
      break;
    }

    case "ObjectPropertyRange": {
      state.objectProperties.add(axiom.propertyIri);
      ensureClassInState(state.classes, axiom.rangeIri);
      let rngs = state.objectPropertyRanges.get(axiom.propertyIri);
      if (!rngs) {
        rngs = new Set();
        state.objectPropertyRanges.set(axiom.propertyIri, rngs);
      }
      rngs.add(axiom.rangeIri);
      break;
    }

    case "DataPropertyDomain": {
      state.dataProperties.add(axiom.propertyIri);
      ensureClassInState(state.classes, axiom.domainIri);
      let doms = state.dataPropertyDomains.get(axiom.propertyIri);
      if (!doms) {
        doms = new Set();
        state.dataPropertyDomains.set(axiom.propertyIri, doms);
      }
      doms.add(axiom.domainIri);
      break;
    }

    case "DataPropertyRange": {
      state.dataProperties.add(axiom.propertyIri);
      let rngs = state.dataPropertyRanges.get(axiom.propertyIri);
      if (!rngs) {
        rngs = new Set();
        state.dataPropertyRanges.set(axiom.propertyIri, rngs);
      }
      rngs.add(axiom.rangeIri);
      break;
    }

    case "NegativeObjectPropertyAssertion": {
      state.objectProperties.add(axiom.propertyIri);
      state.negativeObjectAssertions.push(axiom);
      break;
    }

    case "NegativeDataPropertyAssertion": {
      state.dataProperties.add(axiom.propertyIri);
      state.negativeDataAssertions.push(axiom);
      break;
    }

    case "SymmetricObjectProperty": {
      const edges = state.objectPropertyAssertions.get(axiom.propertyIri) ?? [];
      const toAdd: { subjectIri: string; objectIri: string }[] = [];
      for (const e of edges) {
        if (!edges.some((ex) => ex.subjectIri === e.objectIri && ex.objectIri === e.subjectIri)) {
          toAdd.push({ subjectIri: e.objectIri, objectIri: e.subjectIri });
        }
      }
      for (const add of toAdd) edges.push(add);
      state.objectPropertyAssertions.set(axiom.propertyIri, edges);
      break;
    }

    case "InverseObjectProperty": {
      const edgesR = state.objectPropertyAssertions.get(axiom.propertyIri) ?? [];
      const edgesS = state.objectPropertyAssertions.get(axiom.inversePropertyIri) ?? [];
      for (const e of edgesR) {
        if (!edgesS.some((ex) => ex.subjectIri === e.objectIri && ex.objectIri === e.subjectIri)) {
          edgesS.push({ subjectIri: e.objectIri, objectIri: e.subjectIri });
        }
      }
      for (const e of edgesS) {
        if (!edgesR.some((ex) => ex.subjectIri === e.objectIri && ex.objectIri === e.subjectIri)) {
          edgesR.push({ subjectIri: e.objectIri, objectIri: e.subjectIri });
        }
      }
      state.objectPropertyAssertions.set(axiom.propertyIri, edgesR);
      state.objectPropertyAssertions.set(axiom.inversePropertyIri, edgesS);
      break;
    }

    case "UniversalRestriction": {
      const edges = state.objectPropertyAssertions.get(axiom.propertyIri) ?? [];
      for (const e of edges) {
        if (!axiom.classIri || (state.individualTypes.get(e.subjectIri)?.has(axiom.classIri) ?? false)) {
          const types = state.individualTypes.get(e.objectIri) ?? new Set();
          types.add(axiom.targetClassIri);
          state.individualTypes.set(e.objectIri, types);
        }
      }
      break;
    }

    case "DisjunctiveClass": {
      if (axiom.superClassIri && axiom.classIris.length > 0) {
        for (const c of axiom.classIris) {
          const sub = ensureClassInState(state.classes, c);
          sub.superClasses.add(axiom.superClassIri);
        }
      }
      break;
    }

    case "SelfRestriction": {
      for (const [indIri, types] of state.individualTypes) {
        if (types.has(axiom.classIri)) {
          const edges = state.objectPropertyAssertions.get(axiom.propertyIri) ?? [];
          if (!edges.some((e) => e.subjectIri === indIri && e.objectIri === indIri)) {
            edges.push({ subjectIri: indIri, objectIri: indIri });
            state.objectPropertyAssertions.set(axiom.propertyIri, edges);
          }
        }
      }
      break;
    }

    case "NominalClass":
    case "ObjectOneOf": {
      ensureClassInState(state.classes, axiom.classIri);
      let nomSet = state.objectOneOfMap.get(axiom.classIri);
      if (!nomSet) {
        nomSet = new Set<string>();
        state.objectOneOfMap.set(axiom.classIri, nomSet);
      }
      for (const ind of axiom.individualIris) {
        nomSet.add(ind);
        const types = state.individualTypes.get(ind) ?? new Set();
        types.add(axiom.classIri);
        state.individualTypes.set(ind, types);
      }
      break;
    }

    case "DifferentIndividuals": {
      for (let i = 0; i < axiom.individualIris.length; i++) {
        for (let j = i + 1; j < axiom.individualIris.length; j++) {
          const a = axiom.individualIris[i]!;
          const b = axiom.individualIris[j]!;
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          state.differentIndividualPairs.add(key);
        }
      }
      break;
    }

    case "SwrlRule": {
      state.swrlRules.push(axiom);
      break;
    }

    case "QualifiedCardinality": {
      state.qualifiedCardinalities.push(axiom);
      ensureClassInState(state.classes, axiom.classIri);
      state.objectProperties.add(axiom.propertyIri);
      if (axiom.fillerClassIri) {
        ensureClassInState(state.classes, axiom.fillerClassIri);
      }
      break;
    }

    case "SubPropertyChainOf": {
      state.subPropertyChains.push(axiom);
      state.objectProperties.add(axiom.superPropertyIri);
      for (const p of axiom.subPropertyChain) {
        state.objectProperties.add(p);
      }
      break;
    }

    case "LinearConstraint": {
      state.linearConstraints.push(axiom);
      for (const t of axiom.terms) {
        state.dataProperties.add(t.propertyIri);
      }
      break;
    }

    case "AsymmetricObjectProperty": {
      state.objectProperties.add(axiom.propertyIri);
      state.asymmetricProperties.add(axiom.propertyIri);
      break;
    }

    case "IrreflexiveObjectProperty": {
      state.objectProperties.add(axiom.propertyIri);
      state.irreflexiveProperties.add(axiom.propertyIri);
      break;
    }

    case "DisjointObjectProperties": {
      for (let i = 0; i < axiom.propertyIris.length; i++) {
        const p1 = axiom.propertyIris[i]!;
        state.objectProperties.add(p1);
        for (let j = i + 1; j < axiom.propertyIris.length; j++) {
          const p2 = axiom.propertyIris[j]!;
          state.objectProperties.add(p2);
          const key = p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
          state.disjointPropertyPairs.add(key);
        }
      }
      break;
    }
  }
}

/** Retracts a single OWL 2 axiom from the reasoner's internal tables. */
export function removeAxiomFromState(state: ReasonerState, axiom: OWL2Axiom): void {
  const idx = state.axioms.findIndex((a) => axiomEqual(a, axiom));
  if (idx !== -1) state.axioms.splice(idx, 1);

  switch (axiom.type) {
    case "SubClassOf": {
      const sub = state.classes.get(axiom.subClassIri);
      const sup = state.classes.get(axiom.superClassIri);
      sub?.superClasses.delete(axiom.superClassIri);
      sup?.subClasses.delete(axiom.subClassIri);
      break;
    }

    case "EquivalentClasses": {
      for (const iri of axiom.classIris) {
        const node = state.classes.get(iri);
        if (node) {
          for (const other of axiom.classIris) {
            if (other !== iri) {
              node.equivalents.delete(other);
              node.superClasses.delete(other);
            }
          }
        }
      }
      break;
    }

    case "DisjointClasses": {
      for (let i = 0; i < axiom.classIris.length; i++) {
        for (let j = i + 1; j < axiom.classIris.length; j++) {
          const a = axiom.classIris[i];
          const b = axiom.classIris[j];
          if (!a || !b) continue;
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          state.disjointPairs.delete(key);
        }
      }
      break;
    }

    case "ObjectPropertyAssertion": {
      const edges = state.objectPropertyAssertions.get(axiom.propertyIri);
      if (edges) {
        const edgeIdx = edges.findIndex((e) => e.subjectIri === axiom.subjectIri && e.objectIri === axiom.objectIri);
        if (edgeIdx !== -1) edges.splice(edgeIdx, 1);
      }
      break;
    }

    case "ClassAssertion": {
      const types = state.individualTypes.get(axiom.individualIri);
      types?.delete(axiom.classIri);
      break;
    }

    case "FunctionalObjectProperty": {
      state.functionalObjectProperties.delete(axiom.propertyIri);
      break;
    }

    case "FunctionalDataProperty": {
      state.functionalDataProperties.delete(axiom.propertyIri);
      break;
    }

    case "InverseFunctionalObjectProperty": {
      state.inverseFunctionalObjectProperties.delete(axiom.propertyIri);
      break;
    }

    case "ReflexiveObjectProperty": {
      state.reflexiveProperties.delete(axiom.propertyIri);
      break;
    }

    case "SubObjectPropertyOf": {
      state.subObjectPropertyEdges.get(axiom.subPropertyIri)?.delete(axiom.superPropertyIri);
      break;
    }

    case "SubDataPropertyOf": {
      state.subDataPropertyEdges.get(axiom.subPropertyIri)?.delete(axiom.superPropertyIri);
      break;
    }

    case "ObjectPropertyDomain": {
      state.objectPropertyDomains.get(axiom.propertyIri)?.delete(axiom.domainIri);
      break;
    }

    case "ObjectPropertyRange": {
      state.objectPropertyRanges.get(axiom.propertyIri)?.delete(axiom.rangeIri);
      break;
    }

    case "DataPropertyDomain": {
      state.dataPropertyDomains.get(axiom.propertyIri)?.delete(axiom.domainIri);
      break;
    }

    case "DataPropertyRange": {
      state.dataPropertyRanges.get(axiom.propertyIri)?.delete(axiom.rangeIri);
      break;
    }

    case "NegativeObjectPropertyAssertion": {
      const nIdx = state.negativeObjectAssertions.findIndex((a) => axiomEqual(a, axiom));
      if (nIdx !== -1) state.negativeObjectAssertions.splice(nIdx, 1);
      break;
    }

    case "NegativeDataPropertyAssertion": {
      const nIdx = state.negativeDataAssertions.findIndex((a) => axiomEqual(a, axiom));
      if (nIdx !== -1) state.negativeDataAssertions.splice(nIdx, 1);
      break;
    }

    case "AsymmetricObjectProperty": {
      state.asymmetricProperties.delete(axiom.propertyIri);
      break;
    }

    case "IrreflexiveObjectProperty": {
      state.irreflexiveProperties.delete(axiom.propertyIri);
      break;
    }

    case "DisjointObjectProperties": {
      for (let i = 0; i < axiom.propertyIris.length; i++) {
        for (let j = i + 1; j < axiom.propertyIris.length; j++) {
          const p1 = axiom.propertyIris[i]!;
          const p2 = axiom.propertyIris[j]!;
          const key = p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
          state.disjointPropertyPairs.delete(key);
        }
      }
      break;
    }

    case "DataPropertyAssertion": {
      const rawIdx = state.rawDataPropertyAssertions.findIndex((a) => axiomEqual(a, axiom));
      if (rawIdx !== -1) state.rawDataPropertyAssertions.splice(rawIdx, 1);
      const assertions = state.dataPropertyAssertions.get(axiom.propertyIri);
      if (assertions) {
        const aIdx = assertions.findIndex((a) => a.subjectIri === axiom.subjectIri && a.value === axiom.value);
        if (aIdx !== -1) assertions.splice(aIdx, 1);
      }
      break;
    }

    case "SubPropertyChainOf": {
      const chainIdx = state.subPropertyChains.findIndex((a) => axiomEqual(a, axiom));
      if (chainIdx !== -1) state.subPropertyChains.splice(chainIdx, 1);
      break;
    }

    case "QualifiedCardinality": {
      const qcIdx = state.qualifiedCardinalities.findIndex((a) => axiomEqual(a, axiom));
      if (qcIdx !== -1) state.qualifiedCardinalities.splice(qcIdx, 1);
      break;
    }

    case "LinearConstraint": {
      const lcIdx = state.linearConstraints.findIndex((a) => axiomEqual(a, axiom));
      if (lcIdx !== -1) state.linearConstraints.splice(lcIdx, 1);
      break;
    }

    case "NominalClass":
    case "ObjectOneOf": {
      state.objectOneOfMap.delete(axiom.classIri);
      break;
    }

    case "DifferentIndividuals": {
      for (let i = 0; i < axiom.individualIris.length; i++) {
        for (let j = i + 1; j < axiom.individualIris.length; j++) {
          const a = axiom.individualIris[i]!;
          const b = axiom.individualIris[j]!;
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          state.differentIndividualPairs.delete(key);
        }
      }
      break;
    }

    case "SwrlRule": {
      const ruleIdx = state.swrlRules.findIndex((r) => axiomEqual(r, axiom));
      if (ruleIdx !== -1) state.swrlRules.splice(ruleIdx, 1);
      break;
    }

    default:
      break;
  }
}

/** Clears all Maps, Sets, and Arrays in `state` in place (preserving object identity). */
export function clearReasonerState(state: ReasonerState): void {
  state.axioms.length = 0;
  state.classes.clear();
  state.disjointPairs.clear();
  state.objectProperties.clear();
  state.dataProperties.clear();
  state.transitiveProperties.clear();
  state.functionalObjectProperties.clear();
  state.functionalDataProperties.clear();
  state.inverseFunctionalObjectProperties.clear();
  state.reflexiveProperties.clear();
  state.subObjectPropertyEdges.clear();
  state.subDataPropertyEdges.clear();
  state.objectPropertyDomains.clear();
  state.objectPropertyRanges.clear();
  state.dataPropertyDomains.clear();
  state.dataPropertyRanges.clear();
  state.negativeObjectAssertions.length = 0;
  state.negativeDataAssertions.length = 0;
  state.asymmetricProperties.clear();
  state.irreflexiveProperties.clear();
  state.disjointPropertyPairs.clear();
  state.rawDataPropertyAssertions.length = 0;
  state.subPropertyChains.length = 0;
  state.qualifiedCardinalities.length = 0;
  state.linearConstraints.length = 0;
  state.objectOneOfMap.clear();
  state.differentIndividualPairs.clear();
  state.swrlRules.length = 0;
  state.sameIndividualGroups.clear();
  state.individualTypes.clear();
  state.objectPropertyAssertions.clear();
  state.dataPropertyAssertions.clear();
}
