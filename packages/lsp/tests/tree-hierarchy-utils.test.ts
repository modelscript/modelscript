// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classKindFromEntry,
  getCompositeName,
  getTreeChildrenFast,
  isTreeVisible,
} from "../src/utils/hierarchy-utils.js";
import {
  getOntologyCategoryNodes,
  getOntologyDisplayName,
  getOntologyRootNodes,
  getOwlClassTreeNodes,
  getOwlIndividualTreeNodes,
  getOwlPropertyTreeNodes,
  getShortLabel,
} from "../src/utils/owl2-tree-utils.js";

describe("LSP Tree Hierarchy & OWL 2 Tree Utilities", () => {
  describe("OWL2 IRI and Label Formatting", () => {
    it("extracts short labels from hash, slash, and prefix IRIs", () => {
      assert.strictEqual(getShortLabel("http://example.org/onto#Car"), "Car");
      assert.strictEqual(getShortLabel("http://example.org/ontology/Vehicle"), "Vehicle");
      assert.strictEqual(getShortLabel("ex:Engine"), "Engine");
      assert.strictEqual(getShortLabel("PlainClass"), "PlainClass");
      assert.strictEqual(getShortLabel(""), "");
    });

    it("extracts ontology display names from URIs", () => {
      assert.strictEqual(getOntologyDisplayName("file:///workspace/automotive.ofn"), "automotive.ofn");
      assert.strictEqual(getOntologyDisplayName("urn:modelscript:robotics"), "robotics");
      assert.strictEqual(getOntologyDisplayName(""), "Ontology");
    });
  });

  describe("Ontology Container and Category Nodes", () => {
    it("generates ontology root nodes from workspace documents", () => {
      const mockWorkspace = {
        documents: new Map([
          ["file:///workspace/model.ofn", { language: "owl2" }],
          ["file:///workspace/sys.sysml", { language: "sysml2" }],
        ]),
      };

      const nodes = getOntologyRootNodes(mockWorkspace);
      assert.strictEqual(nodes.length, 1);
      assert.strictEqual(nodes[0]?.name, "model.ofn");
      assert.strictEqual(nodes[0]?.classKind, "ontology");
      assert.strictEqual(nodes[0]?.language, "owl2");
    });

    it("generates fallback ontology root node when store has axioms but no documents", () => {
      const mockStore = {
        axioms: [{ type: "ClassDeclaration", classIri: "ex:Car" }],
      };

      const nodes = getOntologyRootNodes({}, mockStore);
      assert.strictEqual(nodes.length, 1);
      assert.strictEqual(nodes[0]?.name, "Workspace Ontology");
    });

    it("generates ontology category folder nodes (Classes, Properties, Individuals)", () => {
      const mockStoreWithInds = {
        axioms: [
          { type: "ClassDeclaration", classIri: "ex:Car" },
          { type: "IndividualDeclaration", individualIri: "ex:MyCar" },
        ],
      };

      const categoriesWithInds = getOntologyCategoryNodes("__ONTOLOGY__:file:///test.ofn", mockStoreWithInds);
      assert.strictEqual(categoriesWithInds.length, 4);
      assert.strictEqual(categoriesWithInds[0]?.name, "Classes");
      assert.strictEqual(categoriesWithInds[1]?.name, "Object Properties");
      assert.strictEqual(categoriesWithInds[2]?.name, "Data Properties");
      assert.strictEqual(categoriesWithInds[3]?.name, "Individuals");

      const mockStoreNoInds = {
        axioms: [{ type: "ClassDeclaration", classIri: "ex:Car" }],
      };
      const categoriesNoInds = getOntologyCategoryNodes("__ONTOLOGY__:file:///test.ofn", mockStoreNoInds);
      assert.strictEqual(categoriesNoInds.length, 3);
    });
  });

  describe("OWL2 Class, Property, and Individual Taxonomy Tree Nodes", () => {
    const mockStore = {
      axioms: [
        { type: "ClassDeclaration", classIri: "ex:Vehicle" },
        { type: "ClassDeclaration", classIri: "ex:Car" },
        { type: "SubClassOf", subClassIri: "ex:Car", superClassIri: "ex:Vehicle" },
        { type: "ObjectPropertyDeclaration", iri: "ex:hasEngine" },
        { type: "DataPropertyDeclaration", iri: "ex:maxSpeed" },
        { type: "NamedIndividualDeclaration", iri: "ex:TeslaModel3" },
        { type: "ClassAssertion", classIri: "ex:Car", individualIri: "ex:TeslaModel3" },
      ],
    };

    it("builds OWL class taxonomy tree nodes", async () => {
      const roots = await getOwlClassTreeNodes(mockStore, null);
      assert.ok(roots.length > 0);
      const vehicleNode = roots.find((r) => r.compositeName === "ex:Vehicle");
      assert.ok(vehicleNode !== undefined, "ex:Vehicle must be a root node");
      assert.strictEqual(vehicleNode.classKind, "owl2-class");

      const subNodes = await getOwlClassTreeNodes(mockStore, "ex:Vehicle");
      const carNode = subNodes.find((s) => s.compositeName === "ex:Car");
      assert.ok(carNode !== undefined, "ex:Car must be a sub-class of ex:Vehicle");
    });

    it("builds OWL property tree nodes (object and data properties)", () => {
      const dataNodes = getOwlPropertyTreeNodes(mockStore, "data");
      assert.strictEqual(dataNodes.length, 1);
      assert.strictEqual(dataNodes[0]?.compositeName, "ex:maxSpeed");
      assert.strictEqual(dataNodes[0]?.classKind, "owl2-data-property");

      const objNodes = getOwlPropertyTreeNodes(mockStore, "object");
      assert.strictEqual(objNodes.length, 1);
      assert.strictEqual(objNodes[0]?.compositeName, "ex:hasEngine");
      assert.strictEqual(objNodes[0]?.classKind, "owl2-object-property");
    });

    it("builds OWL individual tree nodes", () => {
      const indNodes = getOwlIndividualTreeNodes(mockStore);
      assert.strictEqual(indNodes.length, 1);
      assert.strictEqual(indNodes[0]?.compositeName, "ex:TeslaModel3");
      assert.strictEqual(indNodes[0]?.classKind, "owl2-individual");
      assert.ok(indNodes[0]?.description?.includes("Car"));
    });
  });

  describe("Hierarchy Utilities", () => {
    it("determines class kinds from symbol table entries", () => {
      assert.strictEqual(classKindFromEntry({ metadata: { classPrefixes: "model" } }), "model");
      assert.strictEqual(classKindFromEntry({ metadata: { classPrefixes: "connector" } }), "connector");
      assert.strictEqual(classKindFromEntry({ metadata: { classPrefixes: "block" } }), "block");
      assert.strictEqual(classKindFromEntry({ language: "sysml2", ruleName: "PartDefinition" }), "part def");
      assert.strictEqual(
        classKindFromEntry({ language: "sysml2", ruleName: "RequirementDefinition" }),
        "requirement def",
      );
      assert.strictEqual(classKindFromEntry({}), "class");
    });

    it("determines tree visibility for various symbols", () => {
      assert.strictEqual(isTreeVisible({ metadata: { isPredefined: true } }), false);
      assert.strictEqual(isTreeVisible({ name: "'quoted'" }), false);
      assert.strictEqual(isTreeVisible({ language: "owl2" }), false);
      assert.strictEqual(isTreeVisible({ language: "sysml2", kind: "Definition" }), true);
      assert.strictEqual(isTreeVisible({ language: "sysml2", kind: "Usage" }), false);
      assert.strictEqual(isTreeVisible({ kind: "Class" }), true);
    });

    it("constructs composite qualified names recursively", () => {
      const mockIndex = {
        symbols: new Map([
          [1, { id: 1, name: "Modelica", parentId: null }],
          [2, { id: 2, name: "Mechanics", parentId: 1 }],
          [3, { id: 3, name: "Rotational", parentId: 2 }],
        ]),
      };

      const entry = mockIndex.symbols.get(3);
      const compositeName = getCompositeName(entry, mockIndex);
      assert.strictEqual(compositeName, "Modelica.Mechanics.Rotational");
    });

    it("retrieves tree children quickly via getTreeChildrenFast", async () => {
      const mockIndex = {
        symbols: new Map([
          [
            1,
            {
              id: 1,
              name: "TopModel",
              kind: "Class",
              parentId: null,
              resourceId: "file:///workspace/TopModel.mo",
              metadata: { classPrefixes: "model" },
            },
          ],
        ]),
        childrenOf: new Map([[0, [1]]]),
      };

      const roots = await getTreeChildrenFast(mockIndex);
      assert.strictEqual(roots.length, 1);
      assert.strictEqual(roots[0]?.name, "TopModel");
      assert.strictEqual(roots[0]?.classKind, "model");
    });
  });
});
