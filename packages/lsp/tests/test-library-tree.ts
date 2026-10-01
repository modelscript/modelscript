// SPDX-License-Identifier: AGPL-3.0-or-later

import { LanguageWorkspaceIndex, UnifiedWorkspace } from "@modelscript/runtime";
import assert from "assert";
import { getTreeChildrenFast } from "../src/utils/hierarchy-utils.js";

async function testLibraryTree() {
  console.log("Starting Library Tree test...");

  const ws = new LanguageWorkspaceIndex();
  ws.hookMap = new Map([["ClassDefinition", { kind: "Class", ruleName: "ClassDefinition", namePath: "name" }]]);

  function makeNode(name: string) {
    return {
      type: "ClassDefinition",
      childForFieldName: (field: string) => (field === "name" ? { text: name } : null),
      children: [],
    };
  }

  // Simulate MSL registration:
  // Root package: Modelica (parentFQN: "")
  ws.register("modelica:/lib/Modelica/package.mo", () => makeNode("Modelica"), "");

  // Root package: Complex (parentFQN: "")
  ws.register("modelica:/lib/Complex.mo", () => makeNode("Complex"), "");

  // Subpackages of Modelica (parentFQN: "Modelica")
  ws.register("modelica:/lib/Modelica/Electrical/package.mo", () => makeNode("Electrical"), "Modelica");
  ws.register("modelica:/lib/Modelica/Blocks/package.mo", () => makeNode("Blocks"), "Modelica");

  // Subpackages of Electrical (parentFQN: "Modelica.Electrical")
  ws.register("modelica:/lib/Modelica/Electrical/Analog/package.mo", () => makeNode("Analog"), "Modelica.Electrical");

  // Models inside Analog (parentFQN: "Modelica.Electrical.Analog")
  ws.register(
    "modelica:/lib/Modelica/Electrical/Analog/Basic/Resistor.mo",
    () => makeNode("Resistor"),
    "Modelica.Electrical.Analog",
  );

  // Workspace model (not in library)
  ws.register("file:///workspace/BouncingBall.mo", () => makeNode("BouncingBall"), undefined);
  // Eagerly index workspace file
  ws.ensureIndexed("file:///workspace/BouncingBall.mo");

  const unifiedWs = new UnifiedWorkspace();
  unifiedWs.workspaces.set("modelica", ws);

  // Step 1: Root request (parentId: undefined)
  unifiedWs.ensureChildrenIndexed("");
  const rootIndex = unifiedWs.toTreeIndex();
  const rootNodes = await getTreeChildrenFast(rootIndex, undefined, unifiedWs);
  console.log(
    "Root nodes:",
    rootNodes.map((n: any) => ({ name: n.name, id: n.id, hasChildren: n.hasChildren })),
  );

  assert(
    rootNodes.some((n: any) => n.name === "BouncingBall"),
    "BouncingBall must be in root nodes",
  );
  assert(
    rootNodes.some((n: any) => n.name === "Modelica Standard Library"),
    "Modelica Standard Library must be in root nodes",
  );

  // Step 2: Expand __LIB__:Modelica Standard Library
  const libNodes = await getTreeChildrenFast(rootIndex, "__LIB__:Modelica Standard Library", unifiedWs);
  console.log(
    "Library nodes:",
    libNodes.map((n: any) => ({ name: n.name, id: n.id, hasChildren: n.hasChildren })),
  );

  assert(
    libNodes.some((n: any) => n.name === "Modelica"),
    "Modelica must be in library nodes",
  );
  assert(
    libNodes.some((n: any) => n.name === "Complex"),
    "Complex must be in library nodes",
  );
  const modelicaNode = libNodes.find((n: any) => n.name === "Modelica");
  assert(modelicaNode?.hasChildren, "Modelica must have hasChildren: true");

  // Step 3: Expand Modelica (parentId: "Modelica")
  unifiedWs.ensureChildrenIndexed("Modelica");
  const modelicaIndex = unifiedWs.toTreeIndex();
  const modelicaChildren = await getTreeChildrenFast(modelicaIndex, "Modelica", unifiedWs);
  console.log(
    "Modelica children:",
    modelicaChildren.map((n: any) => ({ name: n.name, id: n.id, hasChildren: n.hasChildren })),
  );

  assert(
    modelicaChildren.some((n: any) => n.name === "Electrical"),
    "Electrical must be in Modelica children",
  );
  assert(
    modelicaChildren.some((n: any) => n.name === "Blocks"),
    "Blocks must be in Modelica children",
  );
  const electricalNode = modelicaChildren.find((n: any) => n.name === "Electrical");
  assert(electricalNode?.hasChildren, "Electrical must have hasChildren: true");

  // Step 4: Expand Modelica.Electrical (parentId: "Modelica.Electrical")
  unifiedWs.ensureChildrenIndexed("Modelica.Electrical");
  const elecIndex = unifiedWs.toTreeIndex();
  const elecChildren = await getTreeChildrenFast(elecIndex, "Modelica.Electrical", unifiedWs);
  console.log(
    "Electrical children:",
    elecChildren.map((n: any) => ({ name: n.name, id: n.id, hasChildren: n.hasChildren })),
  );

  assert(
    elecChildren.some((n: any) => n.name === "Analog"),
    "Analog must be in Electrical children",
  );

  // Step 5: Expand Modelica.Electrical.Analog (parentId: "Modelica.Electrical.Analog")
  unifiedWs.ensureChildrenIndexed("Modelica.Electrical.Analog");
  const analogIndex = unifiedWs.toTreeIndex();
  const analogChildren = await getTreeChildrenFast(analogIndex, "Modelica.Electrical.Analog", unifiedWs);
  console.log(
    "Analog children:",
    analogChildren.map((n: any) => ({ name: n.name, id: n.id, hasChildren: n.hasChildren })),
  );

  assert(
    analogChildren.some((n: any) => n.name === "Resistor"),
    "Resistor must be in Analog children",
  );
  const resistorNode = analogChildren.find((n: any) => n.name === "Resistor");
  assert(!resistorNode?.hasChildren, "Resistor must have hasChildren: false (leaf model)");

  // ---------------------------------------------------------------------------
  // Step 6: OWL 2 Unified Library Tree Integration Tests
  // ---------------------------------------------------------------------------
  console.log("\nTesting OWL 2 Unified Library Tree Integration...");

  const dummyOwlUri = "file:///workspace/drone.owl";
  unifiedWs.documents.set(dummyOwlUri, { uri: dummyOwlUri, language: "owl2" } as any);

  const sampleOwlAxioms: any[] = [
    { type: "ClassDeclaration", iri: ":Vehicle" },
    { type: "ClassDeclaration", iri: ":Drone" },
    { type: "ClassDeclaration", iri: ":Motor" },
    { type: "ClassDeclaration", iri: ":ElectricMotor" },
    { type: "SubClassOf", subClassIri: ":Drone", superClassIri: ":Vehicle" },
    { type: "EquivalentClasses", classIris: [":Motor", ":ElectricMotor"] },
    { type: "ObjectPropertyDeclaration", iri: ":hasPart" },
    { type: "ObjectPropertyDeclaration", iri: ":poweredBy" },
    { type: "FunctionalObjectProperty", propertyIri: ":poweredBy" },
    { type: "DataPropertyDeclaration", iri: ":nominalVoltage" },
    { type: "DataPropertyRange", propertyIri: ":nominalVoltage", range: "xsd:double" },
    { type: "IndividualDeclaration", iri: ":drone_01" },
    { type: "ClassAssertion", individual: ":drone_01", classExpr: ":Drone" },
  ];

  unifiedWs.owl2Store.addAxioms("owl2", sampleOwlAxioms);

  // 6a. Check Root Nodes for Ontology Container
  const rootNodesWithOwl = await getTreeChildrenFast(rootIndex, undefined, unifiedWs);
  console.log(
    "Root nodes with OWL:",
    rootNodesWithOwl.map((n: any) => ({ name: n.name, id: n.id, classKind: n.classKind })),
  );
  assert(
    rootNodesWithOwl.some((n: any) => n.name === "drone.owl" && n.classKind === "ontology"),
    "drone.owl ontology container must be present in root nodes",
  );

  // 6b. Expand Ontology Node -> Categories (Classes, Object Properties, Data Properties, Individuals)
  const ontologyCategories = await getTreeChildrenFast(rootIndex, `__ONTOLOGY__:${dummyOwlUri}`, unifiedWs);
  console.log(
    "Ontology categories:",
    ontologyCategories.map((n: any) => ({ name: n.name, id: n.id, icon: n.icon })),
  );
  assert(
    ontologyCategories.some((n: any) => n.name === "Classes" && n.id === `__OWL_CLASSES__:${dummyOwlUri}`),
    "Classes folder must exist",
  );
  assert(
    ontologyCategories.some((n: any) => n.name === "Object Properties" && n.id === `__OWL_OBJ_PROPS__:${dummyOwlUri}`),
    "Object Properties folder must exist",
  );
  assert(
    ontologyCategories.some((n: any) => n.name === "Data Properties" && n.id === `__OWL_DATA_PROPS__:${dummyOwlUri}`),
    "Data Properties folder must exist",
  );
  assert(
    ontologyCategories.some((n: any) => n.name === "Individuals" && n.id === `__OWL_INDIVIDUALS__:${dummyOwlUri}`),
    "Individuals folder must exist when individuals are present",
  );

  // 6c. Expand Classes Folder -> Root Classes (:Vehicle, :Motor)
  const owlRootClasses = await getTreeChildrenFast(rootIndex, `__OWL_CLASSES__:${dummyOwlUri}`, unifiedWs);
  console.log(
    "OWL Root classes:",
    owlRootClasses.map((n: any) => ({
      name: n.name,
      id: n.id,
      description: n.description,
      hasChildren: n.hasChildren,
    })),
  );
  assert(
    owlRootClasses.some((n: any) => n.name === "Vehicle" && n.hasChildren === true),
    ":Vehicle root class must have children (:Drone)",
  );
  assert(
    owlRootClasses.some((n: any) => n.name === "Motor" && n.description === "≡ defined"),
    ":Motor must be labeled as ≡ defined",
  );

  // 6d. Expand Subclass :Vehicle -> :Drone
  const vehicleSubClasses = await getTreeChildrenFast(rootIndex, "__OWL_CLASS__::Vehicle", unifiedWs);
  console.log(
    ":Vehicle subclasses:",
    vehicleSubClasses.map((n: any) => ({ name: n.name, id: n.id })),
  );
  assert(
    vehicleSubClasses.some((n: any) => n.name === "Drone"),
    ":Drone must be a subclass of :Vehicle",
  );

  // 6e. Expand Object Properties Folder
  const objectProperties = await getTreeChildrenFast(rootIndex, `__OWL_OBJ_PROPS__:${dummyOwlUri}`, unifiedWs);
  console.log(
    "Object properties:",
    objectProperties.map((n: any) => ({ name: n.name, id: n.id, description: n.description })),
  );
  assert(
    objectProperties.some((n: any) => n.name === "poweredBy" && n.description.includes("Functional")),
    ":poweredBy must have description Functional",
  );
  assert(
    objectProperties.some((n: any) => n.name === "hasPart"),
    ":hasPart must be present",
  );

  // 6f. Expand Data Properties Folder
  const dataProperties = await getTreeChildrenFast(rootIndex, `__OWL_DATA_PROPS__:${dummyOwlUri}`, unifiedWs);
  console.log(
    "Data properties:",
    dataProperties.map((n: any) => ({ name: n.name, id: n.id, description: n.description })),
  );
  assert(
    dataProperties.some((n: any) => n.name === "nominalVoltage" && n.description.includes("xsd:double")),
    ":nominalVoltage must indicate xsd:double range",
  );

  // 6g. Expand Individuals Folder
  const individuals = await getTreeChildrenFast(rootIndex, `__OWL_INDIVIDUALS__:${dummyOwlUri}`, unifiedWs);
  console.log(
    "Individuals:",
    individuals.map((n: any) => ({ name: n.name, id: n.id, description: n.description })),
  );
  assert(
    individuals.some((n: any) => n.name === "drone_01" && n.description === ":Drone"),
    ":drone_01 must be displayed with type :Drone",
  );

  console.log("All Library Tree tests passed successfully!");
}

testLibraryTree().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
