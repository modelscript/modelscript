// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { owl2Language } from "../src/language.js";
import { executeOwl2SparqlQuery } from "../src/sparql-kb.js";

describe("OWL 2 Inferred Knowledge Base + @modelscript/sparql Integration", () => {
  const fssOntology = `
    Prefix(:=<http://example.org/bio#>)
    Ontology(<http://example.org/bio>
      Declaration(Class(:Organism))
      Declaration(Class(:Mammal))
      Declaration(Class(:Dog))
      Declaration(ObjectProperty(:ancestorOf))
      Declaration(ObjectProperty(:parentOf))
      Declaration(NamedIndividual(:rex))
      Declaration(NamedIndividual(:max))
      Declaration(NamedIndividual(:pup))

      SubClassOf(:Mammal :Organism)
      SubClassOf(:Dog :Mammal)
      SubObjectPropertyOf(:parentOf :ancestorOf)
      TransitiveObjectProperty(:ancestorOf)

      ClassAssertion(:Dog :rex)
      ObjectPropertyAssertion(:parentOf :rex :max)
      ObjectPropertyAssertion(:parentOf :max :pup)
    )
  `;

  it("executes SPARQL 1.1 SELECT queries against inferred types and transitive role assertions", async () => {
    const res = await executeOwl2SparqlQuery(
      fssOntology,
      `
      SELECT ?ind ?cls WHERE {
        ?ind a ?cls .
        ?cls a owl:Class .
      }
      `,
    );

    assert.equal(res.queryType, "SELECT");
    const pairs = res.rows.map((r) => `${r["ind"]?.label}:${r["cls"]?.label}`);
    assert.ok(pairs.includes("rex:Dog"), "should include asserted type rex:Dog");
    assert.ok(pairs.includes("rex:Mammal"), "should include inferred type rex:Mammal");
    assert.ok(pairs.includes("rex:Organism"), "should include inferred type rex:Organism");

    // Transitive + subproperty inferred role assertion: :rex :ancestorOf :pup
    const roleRes = await executeOwl2SparqlQuery(
      fssOntology,
      `
      SELECT ?s ?o WHERE {
        ?s :ancestorOf ?o .
      }
      `,
    );
    const rolePairs = roleRes.rows.map((r) => `${r["s"]?.label}->${r["o"]?.label}`);
    assert.ok(rolePairs.includes("rex->pup"), "should infer transitive role assertion rex->pup");
    assert.ok(roleRes.graph.nodes.length >= 2);
    assert.ok(roleRes.graph.edges.some((e) => e.inferred));
  });

  it("supports includeInferred=false to query asserted triples only", async () => {
    const res = await executeOwl2SparqlQuery(fssOntology, `ASK { :rex a :Organism }`, { includeInferred: false });
    assert.equal(res.queryType, "ASK");
    assert.equal(res.boolean, false);

    const resInf = await executeOwl2SparqlQuery(fssOntology, `ASK { :rex a :Organism }`, { includeInferred: true });
    assert.equal(resInf.queryType, "ASK");
    assert.equal(resInf.boolean, true);
  });

  it("executes CONSTRUCT and GROUP BY COUNT against a Turtle (.ttl) ontology", async () => {
    const ttl = `
      @prefix : <http://example.org/fleet#> .
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

      :Vehicle a owl:Class .
      :Drone a owl:Class ;
        rdfs:subClassOf :Vehicle .
      :d1 a :Drone .
      :d2 a :Drone .
    `;

    const constructRes = await executeOwl2SparqlQuery(ttl, `CONSTRUCT { ?i a ?c } WHERE { ?i a ?c . ?c a owl:Class }`);
    assert.equal(constructRes.queryType, "CONSTRUCT");
    assert.ok(constructRes.triples.some((t) => t.inferred && t.object.endsWith("#Vehicle")));
    assert.ok(constructRes.graph.nodes.length >= 3);
    assert.ok(constructRes.graph.edges.some((e) => e.inferred));

    const aggRes = await executeOwl2SparqlQuery(
      ttl,
      `SELECT ?c (COUNT(?i) AS ?n) WHERE { ?i a ?c . ?c a owl:Class } GROUP BY ?c`,
    );
    assert.equal(aggRes.queryType, "SELECT");
    const vehicleRow = aggRes.rows.find((r) => r["c"]?.label === "Vehicle");
    assert.equal(vehicleRow?.["n"]?.value, "2");
  });

  it("routes full SPARQL 1.1 queries through the owl2 query_sparql language action", async () => {
    const action = owl2Language.actions?.find((a) => a.id === "query_sparql");
    assert.ok(action?.execute);
    const out = (await action.execute(
      { languageId: "owl2", documentText: fssOntology },
      { query: "SELECT ?x WHERE { ?x a :Organism }" },
    )) as { queryType: string; results: Array<Record<string, { label: string }>> };
    assert.equal(out.queryType, "SELECT");
    assert.ok(out.results.some((r) => r["x"]?.label === "rex"));
  });
});
