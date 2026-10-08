// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOWL2DiagramData, getShortLabel } from "../src/diagram/data.js";
import {
  computeOWL2ConnectionDelete,
  computeOWL2ConnectionInsert,
  computeOWL2ElementDelete,
  computeOWL2ElementInsert,
  computeOWL2NameEdit,
} from "../src/diagram/edits.js";

describe("OWL2 Diagram Data Generator", () => {
  it("computes short labels from IRIs correctly", () => {
    assert.strictEqual(getShortLabel("http://example.org/ontology#Person"), "Person");
    assert.strictEqual(getShortLabel("http://example.org/ontology/Car"), "Car");
    assert.strictEqual(getShortLabel(":Engine"), "Engine");
    assert.strictEqual(getShortLabel("SimpleName"), "SimpleName");
  });

  it("builds AntV X6 DiagramData from varied OWL2 axioms", () => {
    const axioms = [
      { type: "ClassDeclaration", iri: "http://example.org/ont#Vehicle" },
      { type: "ClassDeclaration", iri: "http://example.org/ont#Car" },
      { type: "ClassDeclaration", iri: "http://example.org/ont#Truck" },
      { type: "ObjectPropertyDeclaration", iri: "http://example.org/ont#hasEngine" },
      { type: "DataPropertyDeclaration", iri: "http://example.org/ont#vinNumber" },
      { type: "IndividualDeclaration", iri: "http://example.org/ont#myCar" },
      {
        type: "SubClassOf",
        subClassIri: "http://example.org/ont#Car",
        superClassIri: "http://example.org/ont#Vehicle",
      },
      {
        type: "EquivalentClasses",
        classIris: ["http://example.org/ont#Car", "http://example.org/ont#Automobile"],
      },
      {
        type: "DisjointClasses",
        classIris: ["http://example.org/ont#Car", "http://example.org/ont#Truck"],
      },
      {
        type: "UniversalRestriction",
        propertyIri: "http://example.org/ont#hasEngine",
        targetClassIri: "http://example.org/ont#Vehicle",
      },
    ];

    const layout = {
      elements: {
        "http://example.org/ont#Vehicle": { x: 100, y: 50, width: 140, height: 40 },
      },
    };

    // "All" diagram type
    const dataAll = buildOWL2DiagramData(axioms, layout, "All");
    assert.ok(dataAll.nodes.length >= 4);
    assert.ok(dataAll.edges.length >= 2);

    const vehicleNode = dataAll.nodes.find((n) => n.id === "http://example.org/ont#Vehicle");
    assert.ok(vehicleNode);
    assert.strictEqual(vehicleNode?.x, 100);
    assert.strictEqual(vehicleNode?.y, 50);

    // "ClassTaxonomy" diagram type
    const dataTaxonomy = buildOWL2DiagramData(axioms, undefined, "ClassTaxonomy");
    assert.ok(dataTaxonomy.nodes.length > 0);
  });
});

describe("OWL2 Diagram Edits Synthesizer", () => {
  const sampleDoc = `Prefix(: = <http://example.org/test#>)
Ontology(
  Declaration(Class(:Vehicle))
  Declaration(Class(:Car))
  SubClassOf(:Car :Vehicle)
)`;

  it("computes element insertions for classes, properties, and individuals", () => {
    const editsClass = computeOWL2ElementInsert(sampleDoc, "Class", "Truck");
    assert.strictEqual(editsClass.length, 1);
    assert.ok(editsClass[0]!.newText.includes("Declaration(Class(:Truck))"));

    const editsObjProp = computeOWL2ElementInsert(sampleDoc, "ObjectProperty", ":hasWheel");
    assert.strictEqual(editsObjProp.length, 1);
    assert.ok(editsObjProp[0]!.newText.includes("Declaration(ObjectProperty(:hasWheel))"));

    const editsDataProp = computeOWL2ElementInsert(sampleDoc, "DataProperty", "weight");
    assert.strictEqual(editsDataProp.length, 1);
    assert.ok(editsDataProp[0]!.newText.includes("Declaration(DataProperty(:weight))"));

    const editsInd = computeOWL2ElementInsert(sampleDoc, "NamedIndividual", "chassis01");
    assert.strictEqual(editsInd.length, 1);
    assert.ok(editsInd[0]!.newText.includes("Declaration(NamedIndividual(:chassis01))"));
  });

  it("computes connection insertions for relationships", () => {
    const editSub = computeOWL2ConnectionInsert(sampleDoc, ":Truck", ":Vehicle", "subClassOf");
    assert.strictEqual(editSub.length, 1);
    assert.ok(editSub[0]!.newText.includes("SubClassOf(:Truck :Vehicle)"));

    const editEq = computeOWL2ConnectionInsert(sampleDoc, ":Car", ":Auto", "equivalentTo");
    assert.strictEqual(editEq.length, 1);
    assert.ok(editEq[0]!.newText.includes("EquivalentClasses(:Car :Auto)"));

    const editDisj = computeOWL2ConnectionInsert(sampleDoc, ":Car", ":Bicycle", "disjointWith");
    assert.strictEqual(editDisj.length, 1);
    assert.ok(editDisj[0]!.newText.includes("DisjointClasses(:Car :Bicycle)"));

    const editRel = computeOWL2ConnectionInsert(sampleDoc, ":Car", ":Part", "objectProperty");
    assert.strictEqual(editRel.length, 1);
    assert.ok(editRel[0]!.newText.includes("ObjectSomeValuesFrom"));

    const editDelConn = computeOWL2ConnectionDelete(sampleDoc, ":Car", ":Vehicle");
    assert.ok(editDelConn.length >= 1);
  });

  it("computes deletion edits", () => {
    const delEdits = computeOWL2ElementDelete(sampleDoc, [":Car"]);
    assert.ok(delEdits.length >= 1);
  });

  it("computes rename edits across document", () => {
    const renameEdits = computeOWL2NameEdit(sampleDoc, ":Vehicle", ":AutomotiveUnit");
    assert.ok(renameEdits.length >= 1);
  });
});
