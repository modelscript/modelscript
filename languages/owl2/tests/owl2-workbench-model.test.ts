// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOwl2WorkbenchModel, evaluateDlQuery } from "../src/ui/owl2-workbench-model.js";

describe("OWL 2 Protégé-Parity Workbench Model", () => {
  it("builds asserted & inferred class hierarchies, property hierarchies, and inferred facts", () => {
    const fss = `
      Prefix(:=<http://example.org/bio#>)
      Ontology(<http://example.org/bio>
        Declaration(Class(:Organism))
        Declaration(Class(:Mammal))
        Declaration(Class(:Dog))
        Declaration(ObjectProperty(:ancestorOf))
        Declaration(ObjectProperty(:parentOf))
        Declaration(DataProperty(:age))
        Declaration(NamedIndividual(:rex))
        Declaration(NamedIndividual(:max))
        Declaration(NamedIndividual(:pup))

        SubClassOf(:Mammal :Organism)
        SubClassOf(:Dog :Mammal)
        SubObjectPropertyOf(:parentOf :ancestorOf)
        TransitiveObjectProperty(:ancestorOf)
        FunctionalDataProperty(:age)
        ObjectPropertyDomain(:parentOf :Organism)
        ObjectPropertyRange(:parentOf :Organism)

        ClassAssertion(:Dog :rex)
        ObjectPropertyAssertion(:parentOf :rex :max)
        ObjectPropertyAssertion(:parentOf :max :pup)
      )
    `;

    const model = buildOwl2WorkbenchModel(fss);
    assert.equal(model.consistent, true);
    assert.equal(model.format, "ofn");
    assert.equal(model.ontologyIri, "http://example.org/bio");

    // Transitive SubClassOf inference: :Dog ⊑ :Organism
    const dog = model.classes.get(":Dog");
    assert.ok(dog);
    assert.deepEqual(dog.assertedSuperClasses, [":Mammal"]);
    assert.ok(dog.inferredSuperClasses.includes(":Organism"));

    // Inferred individual types: :rex ∈ :Mammal, :Organism
    const rex = model.individuals.get(":rex");
    assert.ok(rex);
    assert.deepEqual(rex.assertedTypes, [":Dog"]);
    assert.ok(rex.inferredTypes.includes(":Mammal"));
    assert.ok(rex.inferredTypes.includes(":Organism"));

    // Property hierarchy & characteristics
    const ancestorProp = model.properties.get(":ancestorOf");
    assert.ok(ancestorProp);
    assert.ok(ancestorProp.characteristics.includes("Transitive"));
    assert.ok(ancestorProp.subProperties.includes(":parentOf"));
    assert.equal(model.objectPropertyTree.length, 1);
    assert.equal(model.objectPropertyTree[0]!.iri, ":ancestorOf");
    assert.equal(model.objectPropertyTree[0]!.children[0]!.iri, ":parentOf");

    const ageProp = model.properties.get(":age");
    assert.ok(ageProp);
    assert.equal(ageProp.kind, "DataProperty");
    assert.ok(ageProp.characteristics.includes("Functional"));

    // Inferred facts include SubClassOf, ClassAssertion, and RoleAssertion
    assert.ok(
      model.inferredFacts.some((f) => f.kind === "subClassOf" && f.subject === ":Dog" && f.object === ":Organism"),
    );
    assert.ok(
      model.inferredFacts.some((f) => f.kind === "classAssertion" && f.subject === ":rex" && f.object === ":Organism"),
    );
    assert.ok(
      model.inferredFacts.some(
        (f) =>
          f.kind === "roleAssertion" && f.subject === ":rex" && f.predicate === ":ancestorOf" && f.object === ":pup",
      ),
    );

    // Faceted browser entities
    assert.ok(model.facetedEntities.some((e) => e.iri === ":Dog" && e.kind === "Class" && e.hasInferredFacts));
    assert.ok(model.facetedEntities.some((e) => e.iri === ":ancestorOf" && e.characteristics.includes("Transitive")));

    // DL Query evaluation
    const subs = evaluateDlQuery(model, "subclasses(:Organism)");
    assert.ok(subs.matches.some((m) => m.iri === ":Dog" && m.inferred === true));
    const insts = evaluateDlQuery(model, "instances(:Organism)");
    assert.ok(insts.matches.some((m) => m.iri === ":rex" && m.inferred === true));
    const types = evaluateDlQuery(model, "types(:rex)");
    assert.ok(types.matches.some((m) => m.iri === ":Dog" && m.inferred === false));
    assert.ok(types.matches.some((m) => m.iri === ":Organism" && m.inferred === true));
  });

  it("detects unsatisfiable classes and supports Turtle (.ttl) ontologies", () => {
    const ttl = `
      @prefix : <http://example.org/veh#> .
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

      :Electric a owl:Class .
      :Combustion a owl:Class .
      :Electric owl:disjointWith :Combustion .
      :ImpossibleCar a owl:Class ;
        rdfs:subClassOf :Electric ;
        rdfs:subClassOf :Combustion .
    `;

    const model = buildOwl2WorkbenchModel(ttl);
    assert.equal(model.format, "ttl");
    assert.ok(model.unsatisfiableClasses.includes(":ImpossibleCar"));
    assert.equal(model.classes.get(":ImpossibleCar")?.unsatisfiable, true);
    assert.ok(model.inferredFacts.some((f) => f.kind === "unsatisfiableClass" && f.subject === ":ImpossibleCar"));

    const unsatQuery = evaluateDlQuery(model, "unsatisfiable()");
    assert.ok(unsatQuery.matches.some((m) => m.iri === ":ImpossibleCar"));
  });
});
