// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { Owl2TableauReasoner, reasonOwl2Ontology } from "../src/reasoner/tableau.js";

describe("OWL 2 SROIQ(D) Tableau Reasoner Extensions (reasoner/tableau.ts)", () => {
  it("reasons over Nominals (ObjectOneOf and ObjectHasValue) and detects nominal clashes", () => {
    const ontology = `
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
    const reasoner = new Owl2TableauReasoner(ontology);
    assert.strictEqual(reasoner.isConsistent(), true);
    assert.strictEqual(reasoner.hasRoleRelationship(":controlledBy", ":plant1", ":ctrlA"), true);
    assert.strictEqual(reasoner.isInstanceOf(":ctrlA", ":PrimaryController"), true);

    // Now test pigeonhole clash: 2 distinct individuals belonging to a singleton nominal ObjectOneOf(:ctrlA)
    const clashOntology = `
      Prefix(: = <http://example.org/cps#>)
      Ontology(<http://example.org/cps>
        SubClassOf(:SingletonMaster ObjectOneOf(:master0))
        ClassAssertion(:SingletonMaster :m1)
        ClassAssertion(:SingletonMaster :m2)
        DifferentIndividuals(:m1 :m2)
      )
    `;
    const clashRes = reasonOwl2Ontology(clashOntology);
    assert.strictEqual(clashRes.consistent, false);
  });

  it("reasons over Qualified Cardinality Restrictions (ObjectMinCardinality, ObjectMaxCardinality, ObjectExactCardinality)", () => {
    const clashCardOntology = `
      Prefix(: = <http://example.org/cps#>)
      Ontology(<http://example.org/cps>
        Declaration(Class(:TripleRedundantNode))
        Declaration(Class(:Sensor))
        Declaration(ObjectProperty(:hasSensor))

        SubClassOf(:TripleRedundantNode ObjectMinCardinality(3 :hasSensor :Sensor))
        SubClassOf(:TripleRedundantNode ObjectMaxCardinality(2 :hasSensor :Sensor))
      )
    `;
    const reasoner = new Owl2TableauReasoner(clashCardOntology);
    assert.strictEqual(reasoner.isClassSatisfiable(":TripleRedundantNode"), false);
    assert.ok(reasoner.getUnsatisfiableClasses().includes(":TripleRedundantNode"));

    // Satisfiable exact cardinality + merging two non-distinct role fillers under ObjectMaxCardinality(1 ...)
    const mergeCardOntology = `
      Prefix(: = <http://example.org/cps#>)
      Ontology(<http://example.org/cps>
        SubClassOf(:SingleSensorActuator ObjectMaxCardinality(1 :hasSensor :Sensor))
        ClassAssertion(:SingleSensorActuator :act1)
        ClassAssertion(:Sensor :sA)
        ClassAssertion(:Sensor :sB)
        ObjectPropertyAssertion(:hasSensor :act1 :sA)
        ObjectPropertyAssertion(:hasSensor :act1 :sB)
      )
    `;
    const mergeRes = reasonOwl2Ontology(mergeCardOntology);
    assert.strictEqual(mergeRes.consistent, true);
    assert.ok(mergeRes.sameIndividuals.get(":sA")?.has(":sB"));
  });

  it("infers multi-step role compositions via SubObjectPropertyOf(ObjectPropertyChain(...)) and TransitiveObjectProperty", () => {
    const chainOntology = `
      Prefix(: = <http://example.org/cps#>)
      Ontology(<http://example.org/cps>
        Declaration(ObjectProperty(:hasSubsystem))
        Declaration(ObjectProperty(:hasPart))
        Declaration(ObjectProperty(:hostsSensor))
        Declaration(ObjectProperty(:monitorsReading))
        Declaration(ObjectProperty(:dependsOnReading))

        TransitiveObjectProperty(:hasPart)
        SubObjectPropertyOf(:hasSubsystem :hasPart)
        SubObjectPropertyOf(ObjectPropertyChain(:hasPart :hostsSensor :monitorsReading) :dependsOnReading)

        ObjectPropertyAssertion(:hasSubsystem :aircraft :flightComputer)
        ObjectPropertyAssertion(:hasPart :flightComputer :imuBoard)
        ObjectPropertyAssertion(:hostsSensor :imuBoard :gyro1)
        ObjectPropertyAssertion(:monitorsReading :gyro1 :pitchRate)
      )
    `;
    const reasoner = new Owl2TableauReasoner(chainOntology);
    assert.strictEqual(reasoner.isConsistent(), true);
    assert.strictEqual(reasoner.hasRoleRelationship(":hasPart", ":aircraft", ":imuBoard"), true);
    assert.strictEqual(reasoner.hasRoleRelationship(":dependsOnReading", ":aircraft", ":pitchRate"), true);
  });

  it("verifies numeric DatatypeRestriction facets (minInclusive, maxInclusive, minExclusive, maxExclusive)", () => {
    const datatypeOntology = `
      Prefix(: = <http://example.org/cps#>)
      Prefix(xsd: = <http://www.w3.org/2001/XMLSchema#>)
      Ontology(<http://example.org/cps>
        Declaration(Class(:SafeBatteryCell))
        Declaration(Class(:OvervoltedCell))
        Declaration(Class(:ImpossibleIntSensor))
        Declaration(DataProperty(:voltage))
        Declaration(DataProperty(:channelCount))

        SubClassOf(:SafeBatteryCell DataAllValuesFrom(:voltage DatatypeRestriction(xsd:double xsd:minInclusive "2.5"^^xsd:double xsd:maxInclusive "4.2"^^xsd:double)))
        SubClassOf(:OvervoltedCell :SafeBatteryCell)
        SubClassOf(:OvervoltedCell DataSomeValuesFrom(:voltage DatatypeRestriction(xsd:double xsd:minExclusive "4.2"^^xsd:double)))

        SubClassOf(:ImpossibleIntSensor DataSomeValuesFrom(:channelCount DatatypeRestriction(xsd:integer xsd:minExclusive "2"^^xsd:integer xsd:maxExclusive "3"^^xsd:integer)))
      )
    `;
    const reasoner = new Owl2TableauReasoner(datatypeOntology);
    assert.strictEqual(reasoner.isClassSatisfiable(":SafeBatteryCell"), true);
    assert.strictEqual(reasoner.isClassSatisfiable(":OvervoltedCell"), false);
    assert.strictEqual(reasoner.isClassSatisfiable(":ImpossibleIntSensor"), false);
  });
});
