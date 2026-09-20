import { createWasmParser } from "@modelscript/dsl/bindings";
import { getClassIconSvg } from "@modelscript/modelica/diagram";
import assert from "assert";
import { readFileSync } from "fs";
import { resolve } from "path";
import { DocumentManager } from "../src/services/DocumentManager.js";
import { WorkspaceManager } from "../src/services/WorkspaceManager.js";

import { SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";

async function testClassIcon() {
  console.log("Starting test-class-icon...");

  const wasmPath = resolve("languages/modelica/dist/parser.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes, {
    syntaxNames: modelicaSyntaxNames,
  });
  (globalThis as any).modelicaParser = parser;

  const docManager = new DocumentManager();
  const wm = new WorkspaceManager(docManager);

  // Load Resistor.mo
  const resistorPath = resolve("data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Basic/Resistor.mo");
  const resistorText = readFileSync(resistorPath, "utf-8");

  // Register in sharedFs
  (globalThis as any).sharedFs = {
    exists: (p: string) => true,
    read: (p: string) => resistorText,
  };

  wm.unifiedWorkspace.registerWorkspace("modelica", wm.globalWorkspaceIndex);

  const tree = parser.parse(resistorText);
  wm.globalWorkspaceIndex.register(
    "modelica:/lib/Modelica/Electrical/Analog/Basic/Resistor.mo",
    () => tree.rootNode,
    "Modelica.Electrical.Analog.Basic",
  );
  wm.globalWorkspaceIndex.ensureIndexed("modelica:/lib/Modelica/Electrical/Analog/Basic/Resistor.mo");
  wm.unifiedWorkspace.ensureChildrenIndexed("Modelica.Electrical.Analog.Basic");

  const partialIdx = wm.unifiedWorkspace.toUnifiedPartial();
  console.log("Index symbols count:", partialIdx.symbols.size);
  for (const [id, e] of partialIdx.symbols) {
    console.log(`Symbol ${id}: name=${e.name}, kind=${e.kind}, res=${e.resourceId}`);
  }
  console.log("byName keys:", Array.from(partialIdx.byName.keys()));

  console.log("Resolving Modelica.Electrical.Analog.Basic.Resistor...");
  const cls = wm.resolveModelicaClassInstance(
    "modelica:/lib/Modelica/Electrical/Analog/Basic/Resistor.mo",
    "Modelica.Electrical.Analog.Basic.Resistor",
  );

  assert(cls, "Resolved class instance must not be null");
  assert.strictEqual(cls.name, "Resistor", "Class name must be Resistor");

  const icon = cls.annotation("Icon");
  console.log("Icon graphics count:", icon?.graphics?.length);
  assert(icon, "Icon annotation must not be null");
  assert.strictEqual(icon["@type"], "Icon", "Icon type must be Icon");
  assert(Array.isArray(icon.graphics) && icon.graphics.length > 0, "Icon must have graphics");

  const svg = getClassIconSvg(cls, 20, false);
  console.log("Generated SVG length:", svg?.length);
  assert(svg, "getClassIconSvg must return non-null SVG string");
  assert(svg.startsWith("<svg"), "SVG must start with <svg");
  assert(svg.includes("<path"), "SVG must contain graphic elements like <path");
  assert(svg.includes("Resistor"), "SVG text must contain Resistor");

  console.log("test-class-icon passed successfully!");
}

testClassIcon().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
