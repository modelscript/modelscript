import Modelica from "@modelscript/modelica/parser";
import Parser from "tree-sitter";
import { createModelicaScopeResolver, createModelicaWorkspaceIndex } from "../../../languages/modelica/factory.js";

const parser = new Parser();
parser.setLanguage(Modelica);

async function runTest() {
  const wsIndex = createModelicaWorkspaceIndex();
  const uri = "file:///test.mo";

  const text = `model BouncingBall
  parameter Real e = 0.8;
  parameter Real g = 9.81;
  Real h(start = 1);
  Real v "Velocity";
equation
  der(h) = v;
  der(v) = -g;
  when h < 0 then
    reinit(v, -e * pre(v));
  end when;
end BouncingBall;`;

  let tree = parser.parse(text);
  wsIndex.register(uri, () => tree.rootNode);
  wsIndex.getFileIndex(uri);
  const resolver = createModelicaScopeResolver(wsIndex.toUnifiedPartial());
  let refs = await resolver.resolveAllReferencesAsync(uri, async () => false);
  console.log(
    "Initial unresolved:",
    refs.map((r) => r.name),
  );

  // Edit 1: Real v -> Real v1
  const text2 = text.replace("Real v", "Real v1");
  tree = parser.parse(text2);
  wsIndex.markDirty(uri, () => tree.rootNode, [{ startByte: 94, endByte: 101 }], 1);
  wsIndex.getFileIndex(uri);
  const decls = Array.from(wsIndex.toUnifiedPartial().symbols.values()).filter(
    (s) => s.name === "v" && resolver["isDeclaration"](s),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oldProcessed = (wsIndex as any).files.get(uri).index.processedOldIds;
  console.log("processedOldIds array:", Array.from(oldProcessed || []));
  console.log(
    "Declarations named v:",
    decls.map((s) => `${s.ruleName} (${s.id})`),
    "processedOldIds has 9?",
    oldProcessed?.has(9),
  );

  refs = await resolver.resolveAllReferencesAsync(uri, async () => false);
  console.log(
    "After Edit 1 unresolved:",
    refs.map((r) => r.name),
  );

  // Edit 2: Real g -> Real g2
  const text3 = text2.replace("Real g =", "Real g2 =");
  const editStart = text2.indexOf("Real g =");
  tree = parser.parse(text3);
  wsIndex.markDirty(uri, () => tree.rootNode, [{ startByte: editStart, endByte: editStart + 8 }], 1);
  wsIndex.getFileIndex(uri);
  resolver.updateIndex(wsIndex.toUnifiedPartial());
  const changed2 = wsIndex.takeGlobalChangedIds();
  console.log("Edit 2 changedIds:", changed2.changedIds);
  // Simulate Validation 1 consumed it
  resolver.setChangedIds(changed2.changedIds);
  refs = await resolver.resolveAllReferencesAsync(uri, async () => false);
  console.log(
    "After Edit 2 unresolved:",
    refs.map((r) => r.name),
  );
}

runTest().catch(console.error);
