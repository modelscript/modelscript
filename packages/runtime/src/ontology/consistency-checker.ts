// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OWL 2 Consistency Checker (Disjointness, Property Characteristics, Numeric Intervals,
 * Qualified Cardinalities, Multivariate Linear Constraints, Nominals, Negative Assertions)
 * and Shortest-Path Subsumption Justification Builder.
 */

import type { ConsistencyResult, OWL2Axiom, OWL2DataPropertyAssertion } from "./owl2-types.js";
import {
  computeAllSuperClassesInState,
  isDifferentInState,
  type ClassNode,
  type ReasonerState,
} from "./reasoner-state.js";

/** Performs internal consistency checks across disjointness, property characteristics, intervals, cardinalities, and nominals. */
export function checkConsistencyOnState(state: ReasonerState): ConsistencyResult {
  const conflicts: OWL2Axiom[] = [];
  const explanations: string[] = [];

  for (const pairKey of state.disjointPairs) {
    const [aIri, bIri] = pairKey.split("|");
    if (!aIri || !bIri) continue;

    const aSuper = computeAllSuperClassesInState(state.classes, aIri);
    const bSuper = computeAllSuperClassesInState(state.classes, bIri);

    let hasClassConflict = aSuper.has(bIri) || bSuper.has(aIri);
    let candIri: string | null = null;
    if (!hasClassConflict) {
      for (const [cIri] of state.classes) {
        const cSuper = computeAllSuperClassesInState(state.classes, cIri);
        if (cSuper.has(aIri) && cSuper.has(bIri)) {
          hasClassConflict = true;
          candIri = cIri;
          break;
        }
      }
    }

    if (hasClassConflict) {
      conflicts.push({
        type: "DisjointClasses",
        classIris: [aIri, bIri],
        subClassIri: candIri ?? undefined,
        sourceLang: "inferred",
      });
      if (candIri) {
        explanations.push(
          `Class '${candIri}' cannot inherit from both '${aIri}' and '${bIri}' because they are declared disjoint.`,
        );
      } else {
        explanations.push(
          `Classes '${aIri}' and '${bIri}' are declared disjoint, but one is a superclass of the other.`,
        );
      }
    }

    for (const [indIri, types] of state.individualTypes) {
      if (types.has(aIri) && types.has(bIri)) {
        conflicts.push({
          type: "ClassAssertion",
          classIri: aIri,
          individualIri: indIri,
          sourceLang: "inferred",
        });
        explanations.push(
          `Individual '${indIri}' cannot be an instance of both '${aIri}' and '${bIri}' because they are declared disjoint.`,
        );
      }
    }
  }

  // Disjoint object properties
  for (const pairKey of state.disjointPropertyPairs) {
    const [p1, p2] = pairKey.split("|");
    if (!p1 || !p2) continue;
    const edges1 = state.objectPropertyAssertions.get(p1) ?? [];
    const edges2 = state.objectPropertyAssertions.get(p2) ?? [];
    for (const e1 of edges1) {
      const match = edges2.find((e2) => e2.subjectIri === e1.subjectIri && e2.objectIri === e1.objectIri);
      if (match) {
        conflicts.push({
          type: "DisjointObjectProperties",
          propertyIris: [p1, p2],
          sourceLang: "inferred",
        });
        conflicts.push({
          type: "ObjectPropertyAssertion",
          propertyIri: p1,
          subjectIri: e1.subjectIri,
          objectIri: e1.objectIri,
          sourceLang: "inferred",
        });
        conflicts.push({
          type: "ObjectPropertyAssertion",
          propertyIri: p2,
          subjectIri: match.subjectIri,
          objectIri: match.objectIri,
          sourceLang: "inferred",
        });
        break;
      }
    }
  }

  // Asymmetric object properties
  for (const propIri of state.asymmetricProperties) {
    const edges = state.objectPropertyAssertions.get(propIri) ?? [];
    for (const e of edges) {
      const rev = edges.find((r) => r.subjectIri === e.objectIri && r.objectIri === e.subjectIri);
      if (rev) {
        conflicts.push({
          type: "AsymmetricObjectProperty",
          propertyIri: propIri,
          sourceLang: "inferred",
        });
        conflicts.push({
          type: "ObjectPropertyAssertion",
          propertyIri: propIri,
          subjectIri: e.subjectIri,
          objectIri: e.objectIri,
          sourceLang: "inferred",
        });
        conflicts.push({
          type: "ObjectPropertyAssertion",
          propertyIri: propIri,
          subjectIri: rev.subjectIri,
          objectIri: rev.objectIri,
          sourceLang: "inferred",
        });
        break;
      }
    }
  }

  // Irreflexive object properties
  for (const propIri of state.irreflexiveProperties) {
    const edges = state.objectPropertyAssertions.get(propIri) ?? [];
    for (const e of edges) {
      if (e.subjectIri === e.objectIri) {
        conflicts.push({
          type: "IrreflexiveObjectProperty",
          propertyIri: propIri,
          sourceLang: "inferred",
        });
        conflicts.push({
          type: "ObjectPropertyAssertion",
          propertyIri: propIri,
          subjectIri: e.subjectIri,
          objectIri: e.objectIri,
          sourceLang: "inferred",
        });
        break;
      }
    }
  }

  // Functional data properties
  for (const propIri of state.functionalDataProperties) {
    const asserts = state.dataPropertyAssertions.get(propIri) ?? [];
    const bySubj = new Map<string, string[]>();
    for (const a of asserts) {
      const list = bySubj.get(a.subjectIri) ?? [];
      list.push(a.value);
      bySubj.set(a.subjectIri, list);
    }
    for (const [subj, vals] of bySubj) {
      const uniqueVals = Array.from(new Set(vals));
      if (uniqueVals.length > 1) {
        conflicts.push({
          type: "FunctionalDataProperty",
          propertyIri: propIri,
          sourceLang: "inferred",
        });
        for (const v of uniqueVals) {
          conflicts.push({
            type: "DataPropertyAssertion",
            propertyIri: propIri,
            subjectIri: subj,
            value: v,
            sourceLang: "inferred",
          });
        }
      }
    }
  }

  // Quantitative and numeric intervals
  const numericIntervals = new Map<string, { min: number; max: number; axioms: OWL2DataPropertyAssertion[] }>();
  for (const dpa of state.rawDataPropertyAssertions) {
    const key = `${dpa.subjectIri}|${dpa.propertyIri}`;
    let bounds = numericIntervals.get(key);
    if (!bounds) {
      bounds = { min: -Infinity, max: Infinity, axioms: [] };
      numericIntervals.set(key, bounds);
    }
    bounds.axioms.push(dpa);

    const eps = 1e-9;
    if (dpa.minVal !== undefined) {
      bounds.min = Math.max(bounds.min, dpa.minVal);
    }
    if (dpa.maxVal !== undefined) {
      bounds.max = Math.min(bounds.max, dpa.maxVal);
    }

    if (dpa.op) {
      const numVal = Number(dpa.value);
      if (!isNaN(numVal)) {
        switch (dpa.op) {
          case ">":
            bounds.min = Math.max(bounds.min, numVal + eps);
            break;
          case ">=":
            bounds.min = Math.max(bounds.min, numVal);
            break;
          case "<":
            bounds.max = Math.min(bounds.max, numVal - eps);
            break;
          case "<=":
            bounds.max = Math.min(bounds.max, numVal);
            break;
          case "=":
            bounds.min = Math.max(bounds.min, numVal);
            bounds.max = Math.min(bounds.max, numVal);
            break;
        }
      }
    } else if (dpa.value !== undefined) {
      const numVal = Number(dpa.value);
      if (!isNaN(numVal) && state.functionalDataProperties.has(dpa.propertyIri)) {
        bounds.min = Math.max(bounds.min, numVal);
        bounds.max = Math.min(bounds.max, numVal);
      }
    }
  }

  for (const [, bounds] of numericIntervals) {
    if (bounds.min > bounds.max) {
      for (const ax of bounds.axioms) {
        conflicts.push(ax);
      }
    }
  }

  // Qualified cardinality restrictions
  for (const qc of state.qualifiedCardinalities) {
    for (const [indIri, types] of state.individualTypes) {
      if (!types.has(qc.classIri)) continue;

      const edges = state.objectPropertyAssertions.get(qc.propertyIri) ?? [];
      const rawFillers = edges.filter((e) => e.subjectIri === indIri).map((e) => e.objectIri);

      const matchingFillers = qc.fillerClassIri
        ? rawFillers.filter((fillerIri) => state.individualTypes.get(fillerIri)?.has(qc.fillerClassIri!))
        : rawFillers;

      const distinctFillers = new Set<string>();
      for (const filler of matchingFillers) {
        let rep = filler;
        const group = state.sameIndividualGroups.get(filler);
        if (group && group.size > 0) {
          rep = Array.from(group).sort()[0]!;
        }
        distinctFillers.add(rep);
      }

      const count = distinctFillers.size;

      if (qc.cardinalityType === "max" || qc.cardinalityType === "exact") {
        if (count > qc.count) {
          conflicts.push({
            type: "QualifiedCardinality",
            classIri: qc.classIri,
            propertyIri: qc.propertyIri,
            fillerClassIri: qc.fillerClassIri,
            cardinalityType: qc.cardinalityType,
            count: qc.count,
            sourceLang: "inferred",
          });
          for (const f of distinctFillers) {
            conflicts.push({
              type: "ObjectPropertyAssertion",
              propertyIri: qc.propertyIri,
              subjectIri: indIri,
              objectIri: f,
              sourceLang: "inferred",
            });
          }
        }
      }
    }
  }

  // Multivariate Linear Constraints (D reasoning)
  for (const lc of state.linearConstraints) {
    const targetIndividuals: string[] = [];
    if (state.individualTypes.has(lc.subjectIri)) {
      targetIndividuals.push(lc.subjectIri);
    } else if (state.classes.has(lc.subjectIri)) {
      for (const [ind, types] of state.individualTypes) {
        if (types.has(lc.subjectIri)) targetIndividuals.push(ind);
      }
    } else {
      targetIndividuals.push(lc.subjectIri);
    }

    for (const ind of targetIndividuals) {
      let exprMin = 0;
      let exprMax = 0;
      let allTermsResolved = true;
      const contributingAxioms: OWL2Axiom[] = [];

      for (const term of lc.terms) {
        const key = `${ind}|${term.propertyIri}`;
        const bounds = numericIntervals.get(key);
        if (!bounds || bounds.min === -Infinity || bounds.max === Infinity) {
          const asserts = state.dataPropertyAssertions.get(term.propertyIri)?.filter((a) => a.subjectIri === ind) ?? [];
          if (asserts.length > 0) {
            const numVal = Number(asserts[0]!.value);
            if (!isNaN(numVal)) {
              exprMin += term.coefficient * numVal;
              exprMax += term.coefficient * numVal;
              continue;
            }
          }
          allTermsResolved = false;
          break;
        }

        for (const ax of bounds.axioms) contributingAxioms.push(ax);

        if (term.coefficient >= 0) {
          exprMin += term.coefficient * bounds.min;
          exprMax += term.coefficient * bounds.max;
        } else {
          exprMin += term.coefficient * bounds.max;
          exprMax += term.coefficient * bounds.min;
        }
      }

      if (allTermsResolved && lc.terms.length > 0) {
        const eps = 1e-9;
        let clash = false;
        switch (lc.op) {
          case "<=":
            if (exprMin > lc.bound + eps) clash = true;
            break;
          case "<":
            if (exprMin >= lc.bound - eps) clash = true;
            break;
          case ">=":
            if (exprMax < lc.bound - eps) clash = true;
            break;
          case ">":
            if (exprMax <= lc.bound + eps) clash = true;
            break;
          case "=":
            if (lc.bound < exprMin - eps || lc.bound > exprMax + eps) clash = true;
            break;
        }

        if (clash) {
          conflicts.push(lc);
          for (const ax of contributingAxioms) conflicts.push(ax);
        }
      }
    }
  }

  // DifferentIndividuals vs SameIndividual conflicts
  for (const pair of state.differentIndividualPairs) {
    const [a, b] = pair.split("|");
    if (a && b) {
      const ga = state.sameIndividualGroups.get(a);
      if (ga && ga.has(b)) {
        conflicts.push({
          type: "DifferentIndividuals",
          individualIris: [a, b],
          sourceLang: "inferred",
        });
        conflicts.push({
          type: "SameIndividual",
          individualIris: [a, b],
          sourceLang: "inferred",
        });
        explanations.push(
          `Individuals '${a}' and '${b}' are declared DifferentIndividuals, but are unified via SameIndividual or functional/inverse-functional property reasoning.`,
        );
      }
    }
  }

  // Reflexive vs Irreflexive / Asymmetric property characteristic conflicts
  for (const propIri of state.reflexiveProperties) {
    if (state.irreflexiveProperties.has(propIri)) {
      conflicts.push({
        type: "ReflexiveObjectProperty",
        propertyIri: propIri,
        sourceLang: "inferred",
      });
      conflicts.push({
        type: "IrreflexiveObjectProperty",
        propertyIri: propIri,
        sourceLang: "inferred",
      });
      explanations.push(
        `Object property '${propIri}' cannot be both ReflexiveObjectProperty and IrreflexiveObjectProperty.`,
      );
    }
    if (state.asymmetricProperties.has(propIri)) {
      conflicts.push({
        type: "ReflexiveObjectProperty",
        propertyIri: propIri,
        sourceLang: "inferred",
      });
      conflicts.push({
        type: "AsymmetricObjectProperty",
        propertyIri: propIri,
        sourceLang: "inferred",
      });
      explanations.push(
        `Object property '${propIri}' cannot be both ReflexiveObjectProperty and AsymmetricObjectProperty.`,
      );
    }
  }

  // NegativeObjectPropertyAssertion conflicts
  for (const neg of state.negativeObjectAssertions) {
    const edges = state.objectPropertyAssertions.get(neg.propertyIri) ?? [];
    const subjGroup = state.sameIndividualGroups.get(neg.subjectIri);
    const objGroup = state.sameIndividualGroups.get(neg.objectIri);
    const match = edges.find((e) => {
      const sameSubj = e.subjectIri === neg.subjectIri || (subjGroup?.has(e.subjectIri) ?? false);
      const sameObj = e.objectIri === neg.objectIri || (objGroup?.has(e.objectIri) ?? false);
      return sameSubj && sameObj;
    });
    if (match) {
      conflicts.push(neg);
      conflicts.push({
        type: "ObjectPropertyAssertion",
        propertyIri: neg.propertyIri,
        subjectIri: match.subjectIri,
        objectIri: match.objectIri,
        sourceLang: "inferred",
      });
      explanations.push(
        `NegativeObjectPropertyAssertion(${neg.propertyIri} ${neg.subjectIri} ${neg.objectIri}) clashes with asserted or inferred ${neg.propertyIri}(${match.subjectIri}, ${match.objectIri}).`,
      );
    }
  }

  // NegativeDataPropertyAssertion conflicts
  for (const neg of state.negativeDataAssertions) {
    const assertions = state.dataPropertyAssertions.get(neg.propertyIri) ?? [];
    const subjGroup = state.sameIndividualGroups.get(neg.subjectIri);
    const match = assertions.find((a) => {
      const sameSubj = a.subjectIri === neg.subjectIri || (subjGroup?.has(a.subjectIri) ?? false);
      return sameSubj && a.value === neg.value;
    });
    if (match) {
      conflicts.push(neg);
      conflicts.push({
        type: "DataPropertyAssertion",
        propertyIri: neg.propertyIri,
        subjectIri: match.subjectIri,
        value: match.value,
        sourceLang: "inferred",
      });
      explanations.push(
        `NegativeDataPropertyAssertion(${neg.propertyIri} ${neg.subjectIri} "${neg.value}") clashes with asserted or inferred ${neg.propertyIri}(${match.subjectIri}, "${match.value}").`,
      );
    }
  }

  // Individual asserted or inferred to be an instance of owl:Nothing
  for (const [indIri, types] of state.individualTypes) {
    if (types.has("owl:Nothing") || types.has("http://www.w3.org/2002/07/owl#Nothing")) {
      conflicts.push({
        type: "ClassAssertion",
        classIri: "owl:Nothing",
        individualIri: indIri,
        sourceLang: "inferred",
      });
      explanations.push(`Individual '${indIri}' is inferred to be an instance of 'owl:Nothing'.`);
    }
  }

  // ObjectOneOf conflicts: individual has type C, but is DifferentFrom ALL nominals of C
  for (const [classIri, nominals] of state.objectOneOfMap) {
    const nominalArr = Array.from(nominals);
    for (const [ind, types] of state.individualTypes) {
      if (!types.has(classIri)) continue;

      let diffCount = 0;
      for (const nom of nominalArr) {
        if (isDifferentInState(state.sameIndividualGroups, state.differentIndividualPairs, ind, nom)) diffCount++;
      }

      if (diffCount === nominalArr.length) {
        conflicts.push({
          type: "ObjectOneOf",
          classIri,
          individualIris: nominalArr,
          sourceLang: "inferred",
        });
        conflicts.push({
          type: "ClassAssertion",
          classIri,
          individualIri: ind,
          sourceLang: "inferred",
        });
      }
    }
  }

  if (conflicts.length > 0) {
    return {
      isConsistent: false,
      conflictingAxioms: conflicts,
      explanation:
        explanations.length > 0
          ? explanations.join("; ")
          : `Found ${conflicts.length} consistency violation(s) in the ontology.`,
    };
  }

  return { isConsistent: true };
}

/** Finds a shortest-path justification trail of `SubClassOf` / `EquivalentClasses` axioms from `subIri` to `superIri`. */
export function buildJustificationOnState(
  classes: ReadonlyMap<string, ClassNode>,
  subIri: string,
  superIri: string,
): OWL2Axiom[] {
  const visited = new Set<string>();
  const queue: { iri: string; trail: OWL2Axiom[] }[] = [{ iri: subIri, trail: [] }];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const { iri, trail } = item;
    if (iri === superIri) return trail;
    if (visited.has(iri)) continue;
    visited.add(iri);

    const node = classes.get(iri);
    if (!node) continue;

    for (const supIri of node.superClasses) {
      const axiom: OWL2Axiom = {
        type: "SubClassOf",
        subClassIri: iri,
        superClassIri: supIri,
        sourceLang: "asserted",
      };
      queue.push({ iri: supIri, trail: [...trail, axiom] });
    }

    for (const eqIri of node.equivalents) {
      const axiom: OWL2Axiom = {
        type: "EquivalentClasses",
        classIris: [iri, eqIri],
        sourceLang: "asserted",
      };
      queue.push({ iri: eqIri, trail: [...trail, axiom] });
    }
  }

  return [];
}
