// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { Owl2TableauReasoner, reasonOwl2Ontology } from "../src/reasoner/tableau.js";

export const owl2BenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "owl2",
  referenceTool: "HermiT / Konclude OWL 2 SROIQ(D) Tableau",
  defaultTolerance: 0,
  metricKind: "exact",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const consistentOnt = `
      Prefix(: = <http://example.org/cps#>)
      Ontology(<http://example.org/cps>
        Declaration(Class(:PrimaryController))
        Declaration(Class(:RedundantSystem))
        Declaration(ObjectProperty(:controlledBy))
        Declaration(NamedIndividual(:ctrlA))
        Declaration(NamedIndividual(:ctrlB))
        Declaration(NamedIndividual(:plant1))
        EquivalentClasses(:PrimaryController ObjectOneOf(:ctrlA :ctrlB))
        SubClassOf(:RedundantSystem ObjectHasValue(:controlledBy :ctrlA))
        ClassAssertion(:RedundantSystem :plant1)
      )
    `;
    const clashOnt = `
      Prefix(: = <http://example.org/cps#>)
      Ontology(<http://example.org/cps>
        SubClassOf(:SingletonMaster ObjectOneOf(:master0))
        ClassAssertion(:SingletonMaster :m1)
        ClassAssertion(:SingletonMaster :m2)
        DifferentIndividuals(:m1 :m2)
      )
    `;

    const t0 = performance.now();
    const r = new Owl2TableauReasoner(consistentOnt);
    const ok1 =
      r.isConsistent() &&
      r.hasRoleRelationship(":controlledBy", ":plant1", ":ctrlA") &&
      r.isInstanceOf(":ctrlA", ":PrimaryController");
    const d1 = performance.now() - t0;

    const t1 = performance.now();
    const clash = reasonOwl2Ontology(clashOnt);
    const d2 = performance.now() - t1;

    return [
      {
        id: "owl2-sroiq-nominal-entailment",
        name: "SROIQ(D) Nominal & ObjectHasValue Tableau Entailment",
        scale: "micro",
        referenceTool: "HermiT / Konclude OWL 2 SROIQ(D) Tableau",
        metricKind: "exact",
        threshold: 0,
        measuredError: ok1 ? 0 : 1,
        passed: ok1,
        durationMs: d1,
        details: "consistent=true, inferred ctrlA:PrimaryController",
      },
      {
        id: "owl2-sroiq-clash-detection",
        name: "SROIQ(D) Singleton Nominal Pigeonhole Clash Detection",
        scale: "micro",
        referenceTool: "HermiT / Konclude OWL 2 SROIQ(D) Tableau",
        metricKind: "exact",
        threshold: 0,
        measuredError: clash.consistent ? 1 : 0,
        passed: !clash.consistent,
        durationMs: d2,
        details: "unsatisfiable nominal cardinality clash detected",
      },
    ];
  },
};
