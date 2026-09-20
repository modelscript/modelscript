import { LanguageWorkspaceIndex, UnifiedWorkspace } from "@modelscript/runtime";
import assert from "assert";
import { getTreeChildrenFast } from "../src/utils/hierarchyUtils.js";

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
  const rootNodes = getTreeChildrenFast(rootIndex, undefined, unifiedWs);
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
  const libNodes = getTreeChildrenFast(rootIndex, "__LIB__:Modelica Standard Library", unifiedWs);
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
  const modelicaChildren = getTreeChildrenFast(modelicaIndex, "Modelica", unifiedWs);
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
  const elecChildren = getTreeChildrenFast(elecIndex, "Modelica.Electrical", unifiedWs);
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
  const analogChildren = getTreeChildrenFast(analogIndex, "Modelica.Electrical.Analog", unifiedWs);
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

  console.log("All Library Tree tests passed successfully!");
}

testLibraryTree().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
