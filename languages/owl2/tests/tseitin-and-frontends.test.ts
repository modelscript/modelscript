// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  detectOwl2Format,
  lowerCstToAxioms,
  Owl2TableauReasoner,
  Owl2WorkspaceIndex,
  parseOwl2ToAxioms,
  parseOwlXmlToAxioms,
  parseTurtleToOwl2Axioms,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(wasmPath);

describe("OWL 2 Recursive Tseitin Normalization & Turtle/OWL-XML Frontends", () => {
  function parseAndLowerOfn(source: string) {
    const tree = parser.parse(source);
    assert.ok(tree?.rootNode, "Expected parse tree");
    return lowerCstToAxioms(tree.rootNode as any, source);
  }

  it("recursively normalizes nested ObjectSomeValuesFrom and ObjectIntersectionOf via Tseitin auxiliary concepts", () => {
    const src = `
      Prefix(: = <http://example.org/veh#>)
      Ontology(<http://example.org/veh>
        Declaration(Class(:ElectricVehicle))
        Declaration(Class(:BatteryPack))
        Declaration(Class(:HighVoltageCell))
        Declaration(Class(:ThermalSensor))
        Declaration(ObjectProperty(:hasSubsystem))
        Declaration(ObjectProperty(:hasPart))

        SubClassOf(
          :ElectricVehicle
          ObjectSomeValuesFrom(
            :hasSubsystem
            ObjectIntersectionOf(
              :BatteryPack
              ObjectSomeValuesFrom(:hasPart :HighVoltageCell)
              ObjectAllValuesFrom(:hasPart :ThermalSensor)
            )
          )
        )
      )
    `;

    const axioms = parseAndLowerOfn(src);
    const auxDecls = axioms.filter((a) => a.type === "ClassDeclaration" && a.iri.startsWith("__aux_"));
    assert.ok(auxDecls.length >= 3, `Expected at least 3 Tseitin auxiliary concepts, got ${auxDecls.length}`);

    // Load lowered axioms into Owl2TableauReasoner and verify entailments
    const reasoner = new Owl2TableauReasoner(axioms);
    assert.equal(reasoner.isConsistent(), true);

    // If HighVoltageCell and ThermalSensor are made disjoint, ElectricVehicle must become unsatisfiable!
    reasoner.addAxiom({
      type: "DisjointClasses",
      classIris: [":HighVoltageCell", ":ThermalSensor"],
    });
    assert.equal(
      reasoner.isClassSatisfiable(":ElectricVehicle"),
      false,
      "Expected :ElectricVehicle to be unsatisfiable when nested someValuesFrom and allValuesFrom fillers are disjoint",
    );
  });

  it("normalizes General Concept Inclusions (GCIs) where SubClassOf has a complex LHS expression", () => {
    const src = `
      Prefix(: = <http://example.org/safety#>)
      Ontology(<http://example.org/safety>
        Declaration(Class(:Actuator))
        Declaration(Class(:SafetyCritical))
        Declaration(Class(:CertifiedComponent))
        Declaration(NamedIndividual(:brakeUnit))

        SubClassOf(
          ObjectIntersectionOf(:Actuator :SafetyCritical)
          :CertifiedComponent
        )

        ClassAssertion(:Actuator :brakeUnit)
        ClassAssertion(:SafetyCritical :brakeUnit)
      )
    `;

    const axioms = parseAndLowerOfn(src);
    const reasoner = new Owl2TableauReasoner(axioms);
    assert.equal(reasoner.isConsistent(), true);
    assert.equal(
      reasoner.isInstanceOf(":brakeUnit", ":CertifiedComponent"),
      true,
      "Expected :brakeUnit to be inferred as :CertifiedComponent via GCI normalization",
    );
    const types = reasoner.getIndividualTypes(":brakeUnit");
    assert.ok(types.includes(":CertifiedComponent"));
    assert.ok(
      types.every((t) => !t.startsWith("__aux_")),
      "Auxiliary concepts should not leak into getIndividualTypes",
    );
  });

  it("normalizes EquivalentClasses and DisjointClasses with complex nested class expressions", () => {
    const src = `
      Prefix(: = <http://example.org/eq#>)
      Ontology(<http://example.org/eq>
        Declaration(Class(:AutonomousCar))
        Declaration(Class(:Car))
        Declaration(Class(:LidarUnit))
        Declaration(Class(:ManualOnlyVehicle))
        Declaration(ObjectProperty(:hasSensor))
        Declaration(NamedIndividual(:waymo1))

        EquivalentClasses(
          :AutonomousCar
          ObjectIntersectionOf(:Car ObjectSomeValuesFrom(:hasSensor :LidarUnit))
        )

        DisjointClasses(
          ObjectSomeValuesFrom(:hasSensor :LidarUnit)
          :ManualOnlyVehicle
        )

        ClassAssertion(:Car :waymo1)
        ClassAssertion(:LidarUnit :lidarA)
        ObjectPropertyAssertion(:hasSensor :waymo1 :lidarA)
      )
    `;

    const axioms = parseAndLowerOfn(src);
    const reasoner = new Owl2TableauReasoner(axioms);
    assert.equal(reasoner.isInstanceOf(":waymo1", ":AutonomousCar"), true);
    assert.equal(reasoner.isSubClassOf(":AutonomousCar", ":Car"), true);
    assert.equal(
      reasoner.isClassSatisfiable({
        kind: "ObjectIntersectionOf",
        operands: [
          { kind: "NamedClass", iri: ":AutonomousCar" },
          { kind: "NamedClass", iri: ":ManualOnlyVehicle" },
        ],
      }),
      false,
    );
  });

  it("parses W3C Turtle (.ttl) ontologies with prefixes, blank-node restrictions, and collections into OWL2Axiom[]", () => {
    const ttlSource = `
      @prefix : <http://example.org/aero#> .
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

      <http://example.org/aero> a owl:Ontology .

      :hasEngine a owl:ObjectProperty .
      :JetEngine a owl:Class .
      :PropellerEngine a owl:Class ;
        owl:disjointWith :JetEngine .

      :Aircraft a owl:Class .
      :JetAircraft a owl:Class ;
        rdfs:subClassOf :Aircraft ,
          [ a owl:Restriction ;
            owl:onProperty :hasEngine ;
            owl:someValuesFrom :JetEngine
          ] .

      :DualJetAircraft a owl:Class ;
        owl:equivalentClass [
          a owl:Class ;
          owl:intersectionOf (
            :Aircraft
            [ a owl:Restriction ;
              owl:onProperty :hasEngine ;
              owl:someValuesFrom :JetEngine
            ]
          )
        ] .

      :e1 a owl:NamedIndividual , :JetEngine .
      :plane1 a owl:NamedIndividual , :Aircraft ;
        :hasEngine :e1 .
    `;

    assert.equal(detectOwl2Format(ttlSource, "aero.ttl"), "ttl");
    const axioms = parseTurtleToOwl2Axioms(ttlSource);
    assert.ok(axioms.length > 0);

    const reasoner = new Owl2TableauReasoner(ttlSource);
    assert.equal(reasoner.isConsistent(), true);
    assert.equal(reasoner.isSubClassOf(":JetAircraft", ":Aircraft"), true);
    assert.equal(reasoner.isInstanceOf(":plane1", ":DualJetAircraft"), true);

    const ws = new Owl2WorkspaceIndex();
    const symIdx = ws.indexFile("file:///aero.ttl", ttlSource);
    assert.ok(symIdx.byName.has("JetAircraft"));
    assert.ok(symIdx.byName.has("hasEngine"));
  });

  it("parses W3C OWL/XML (.owx) and RDF/XML (.owl) ontologies into OWL2Axiom[] and reasons over them", () => {
    const owxSource = `<?xml version="1.0"?>
      <Ontology xmlns="http://www.w3.org/2002/07/owl#" ontologyIRI="http://example.org/power">
        <Prefix name="" IRI="http://example.org/power#"/>
        <Prefix name="owl" IRI="http://www.w3.org/2002/07/owl#"/>
        <Declaration><Class abbreviatedIRI=":Inverter"/></Declaration>
        <Declaration><Class abbreviatedIRI=":GridFormingInverter"/></Declaration>
        <Declaration><Class abbreviatedIRI=":DroopController"/></Declaration>
        <Declaration><ObjectProperty abbreviatedIRI=":hasController"/></Declaration>
        <Declaration><NamedIndividual abbreviatedIRI=":inv1"/></Declaration>
        <Declaration><NamedIndividual abbreviatedIRI=":ctrl1"/></Declaration>

        <EquivalentClasses>
          <Class abbreviatedIRI=":GridFormingInverter"/>
          <ObjectIntersectionOf>
            <Class abbreviatedIRI=":Inverter"/>
            <ObjectSomeValuesFrom>
              <ObjectProperty abbreviatedIRI=":hasController"/>
              <Class abbreviatedIRI=":DroopController"/>
            </ObjectSomeValuesFrom>
          </ObjectIntersectionOf>
        </EquivalentClasses>

        <ClassAssertion>
          <Class abbreviatedIRI=":Inverter"/>
          <NamedIndividual abbreviatedIRI=":inv1"/>
        </ClassAssertion>
        <ClassAssertion>
          <Class abbreviatedIRI=":DroopController"/>
          <NamedIndividual abbreviatedIRI=":ctrl1"/>
        </ClassAssertion>
        <ObjectPropertyAssertion>
          <ObjectProperty abbreviatedIRI=":hasController"/>
          <NamedIndividual abbreviatedIRI=":inv1"/>
          <NamedIndividual abbreviatedIRI=":ctrl1"/>
        </ObjectPropertyAssertion>
      </Ontology>
    `;

    assert.equal(detectOwl2Format(owxSource, "power.owx"), "owx");
    const owxAxioms = parseOwlXmlToAxioms(owxSource);
    assert.ok(owxAxioms.length > 0);

    const reasoner = new Owl2TableauReasoner(owxSource);
    assert.equal(reasoner.isConsistent(), true);
    assert.equal(reasoner.isSubClassOf(":GridFormingInverter", ":Inverter"), true);
    assert.equal(reasoner.isInstanceOf(":inv1", ":GridFormingInverter"), true);

    // Also test RDF/XML (.owl) format
    const rdfXmlSource = `<?xml version="1.0"?>
      <rdf:RDF xmlns="http://example.org/med#"
               xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
               xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"
               xmlns:owl="http://www.w3.org/2002/07/owl#">
        <owl:Ontology rdf:about="http://example.org/med"/>
        <owl:ObjectProperty rdf:about="#treats"/>
        <owl:Class rdf:about="#Condition"/>
        <owl:Class rdf:about="#Medication">
          <rdfs:subClassOf>
            <owl:Restriction>
              <owl:onProperty rdf:resource="#treats"/>
              <owl:someValuesFrom rdf:resource="#Condition"/>
            </owl:Restriction>
          </rdfs:subClassOf>
        </owl:Class>
      </rdf:RDF>
    `;

    const rdfAxioms = parseOwl2ToAxioms(rdfXmlSource, { fileUri: "med.owl" });
    assert.ok(rdfAxioms.some((a) => a.type === "ObjectSomeValuesFrom" && a.propertyIri === ":treats"));
  });
});
