// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { owl2Language } from "../src/language.js";

function getAction(id: string) {
  const action = owl2Language.actions?.find((a) => a.id === id);
  assert.ok(action, `Expected action '${id}' to be defined on owl2Language`);
  assert.equal(typeof action.execute, "function", `Expected action '${id}' to have an execute handler`);
  return action as typeof action & { execute: NonNullable<typeof action.execute> };
}

describe("OWL 2 Language Actions", () => {
  it("provides execute handlers for all declared actions", () => {
    for (const id of ["validate_consistency", "open_ontology_diagram", "explain_inferences", "query_sparql"]) {
      getAction(id);
    }
  });

  it("validate_consistency returns consistent=true for a valid ontology", async () => {
    const action = getAction("validate_consistency");
    const doc = `
      Prefix(:=<http://example.org/test#>)
      Ontology(<http://example.org/test>
        Declaration(Class(:Animal))
        Declaration(Class(:Dog))
        Declaration(NamedIndividual(:fido))
        SubClassOf(:Dog :Animal)
        ClassAssertion(:Dog :fido)
      )
    `;
    const res = (await action.execute({ languageId: "owl2", documentText: doc }, {})) as {
      consistent: boolean;
      passed: boolean;
      unsatisfiableClasses: string[];
      inferredSubClasses: Record<string, string[]>;
      formattedSummary: string;
    };

    assert.equal(res.consistent, true);
    assert.equal(res.passed, true);
    assert.deepEqual(res.unsatisfiableClasses, []);
    assert.ok(res.inferredSubClasses[":Dog"]?.includes(":Animal"));
    assert.match(res.formattedSummary, /consistent/i);
  });

  it("validate_consistency detects logical contradictions", async () => {
    const action = getAction("validate_consistency");
    const doc = `
      Prefix(:=<http://example.org/test#>)
      Ontology(<http://example.org/test>
        Declaration(Class(:A))
        Declaration(Class(:B))
        Declaration(NamedIndividual(:x))
        DisjointClasses(:A :B)
        ClassAssertion(:A :x)
        ClassAssertion(:B :x)
      )
    `;
    const res = (await action.execute({ languageId: "owl2", documentText: doc }, {})) as {
      consistent: boolean;
      passed: boolean;
      clashes: string[];
      formattedSummary: string;
    };

    assert.equal(res.consistent, false);
    assert.equal(res.passed, false);
    assert.ok(res.clashes.length > 0);
    assert.match(res.formattedSummary, /inconsistent/i);
  });

  it("explain_inferences and query_sparql evaluate inferred subsumptions", async () => {
    const doc = `
      Prefix(:=<http://example.org/test#>)
      Ontology(<http://example.org/test>
        Declaration(Class(:Living))
        Declaration(Class(:Mammal))
        Declaration(Class(:Cat))
        SubClassOf(:Mammal :Living)
        SubClassOf(:Cat :Mammal)
      )
    `;

    const explain = getAction("explain_inferences");
    const expRes = (await explain.execute(
      { languageId: "owl2", documentText: doc },
      { subClass: ":Cat", superClass: ":Living" },
    )) as { entailed: boolean };
    assert.equal(expRes.entailed, true);

    const sparql = getAction("query_sparql");
    const qRes = (await sparql.execute(
      { languageId: "owl2", documentText: doc },
      { query: "subclasses(:Living)" },
    )) as { results: string[] };
    assert.ok(qRes.results.includes(":Mammal"));
    assert.ok(qRes.results.includes(":Cat"));
  });
});
