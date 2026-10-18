// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { getClassIconSvg } from "@modelscript/modelica/diagram";
import assert from "assert";
import { readFileSync } from "fs";
import test from "node:test";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { DocumentManager } from "../src/services/document-manager.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";

import { FIELD_NAMES, SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");

test("test-class-icon", async () => {
  console.log("Starting test-class-icon...");

  const wasmPath = resolve(repoRoot, "languages/modelica/dist/parser.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes, {
    syntaxNames: modelicaSyntaxNames,
    fieldNames: FIELD_NAMES,
  });
  (globalThis as any).modelicaParser = parser;

  const docManager = new DocumentManager();
  const wm = new WorkspaceManager(docManager);

  // Load Resistor.mo
  const resistorPath = resolve(
    repoRoot,
    "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Basic/Resistor.mo",
  );
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

  const heatPortLine = icon.graphics.find(
    (g: any) =>
      g["@type"] === "Line" &&
      Array.isArray(g.points) &&
      g.points.length === 2 &&
      g.points[0]?.[0] === 0 &&
      g.points[0]?.[1] === -100,
  );
  assert(heatPortLine, "Resistor Icon must include the conditional heatPort Line");
  assert.strictEqual(heatPortLine.visible, false, "Resistor heatPort Line must have visible === false by default");

  const svg = getClassIconSvg(cls, 20, false);
  console.log("Generated SVG length:", svg?.length);
  assert(svg, "getClassIconSvg must return non-null SVG string");
  assert(svg.startsWith("<svg"), "SVG must start with <svg");
  assert(svg.includes("<path"), "SVG must contain graphic elements like <path");
  assert(svg.includes('visibility="hidden"'), 'SVG must mark conditional heatPort line as visibility="hidden"');
  console.log("test-class-icon passed successfully!");
});

test("test-package-icon", async () => {
  console.log("Starting test-package-icon...");
  const docManager = new DocumentManager();
  const wm = new WorkspaceManager(docManager);

  const electricalPath = resolve(repoRoot, "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/package.mo");
  const electricalText = readFileSync(electricalPath, "utf-8");
  const iconsPath = resolve(repoRoot, "data/libraries/Modelica/4.1.0/extracted/Modelica/Icons.mo");
  const iconsText = readFileSync(iconsPath, "utf-8");

  (globalThis as any).sharedFs = {
    exists: () => true,
    read: (p: string) => {
      if (p.includes("Icons")) return iconsText;
      return electricalText;
    },
  };

  wm.unifiedWorkspace.registerWorkspace("modelica", wm.globalWorkspaceIndex);

  const electricalTree = (globalThis as any).modelicaParser.parse(electricalText);
  wm.globalWorkspaceIndex.register(
    "modelica:/lib/Modelica/Electrical/package.mo",
    () => electricalTree.rootNode,
    "Modelica",
  );
  const iconsTree = (globalThis as any).modelicaParser.parse(iconsText);
  wm.globalWorkspaceIndex.register("modelica:/lib/Modelica/Icons.mo", () => iconsTree.rootNode, "Modelica");

  wm.globalWorkspaceIndex.ensureIndexed("modelica:/lib/Modelica/Electrical/package.mo");
  wm.globalWorkspaceIndex.ensureIndexed("modelica:/lib/Modelica/Icons.mo");
  wm.unifiedWorkspace.ensureChildrenIndexed("Modelica");

  const cls = wm.resolveModelicaClassInstance("modelica:/lib/Modelica/Electrical/package.mo", "Modelica.Electrical");

  assert(cls, "Resolved class instance for Modelica.Electrical must not be null");
  assert(cls.extendsClassInstances?.length > 0, "Modelica.Electrical must have extendsClassInstances");
  assert.strictEqual(
    cls.extendsClassInstances[0]?.classInstance?.name,
    "Package",
    "Base class must resolve to Modelica.Icons.Package",
  );
  const icon = cls.annotation("Icon");
  assert(icon, "Modelica.Electrical must have an Icon annotation");
  const svg = getClassIconSvg(cls, 20, false);
  assert(svg && svg.startsWith("<svg"), "Modelica.Electrical must produce a valid SVG icon");
  assert(svg.includes("linearGradient"), "SVG must include gradient definition for cylinder fill");
  assert(svg.includes("A 25 25"), "SVG must include rounded corners (radius 25) from Modelica.Icons.Package");
  assert(svg.includes("<line"), "SVG must include electrical circuit line graphics");
  console.log("test-package-icon passed successfully! SVG length:", svg.length);
});

test("test-nested-package-icons", async () => {
  console.log("Starting test-nested-package-icons...");
  const docManager = new DocumentManager();
  const wm = new WorkspaceManager(docManager);

  const electricalPath = resolve(repoRoot, "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/package.mo");
  const electricalText = readFileSync(electricalPath, "utf-8");
  const analogPath = resolve(repoRoot, "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/package.mo");
  const analogText = readFileSync(analogPath, "utf-8");
  const basicPath = resolve(
    repoRoot,
    "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Basic/package.mo",
  );
  const basicText = readFileSync(basicPath, "utf-8");
  const iconsPath = resolve(repoRoot, "data/libraries/Modelica/4.1.0/extracted/Modelica/Icons.mo");
  const iconsText = readFileSync(iconsPath, "utf-8");

  (globalThis as any).sharedFs = {
    exists: () => true,
    read: (p: string) => {
      if (p.includes("Icons")) return iconsText;
      if (p.includes("Basic")) return basicText;
      if (p.includes("Analog")) return analogText;
      return electricalText;
    },
  };

  wm.unifiedWorkspace.registerWorkspace("modelica", wm.globalWorkspaceIndex);

  // Register lazy loaders (simulating on-demand lazy indexing without pre-indexing Icons.mo)
  wm.globalWorkspaceIndex.register(
    "modelica:/lib/Modelica/Electrical/package.mo",
    () => (globalThis as any).modelicaParser.parse(electricalText).rootNode,
    "Modelica",
  );
  wm.globalWorkspaceIndex.register(
    "modelica:/lib/Modelica/Electrical/Analog/package.mo",
    () => (globalThis as any).modelicaParser.parse(analogText).rootNode,
    "Modelica.Electrical",
  );
  wm.globalWorkspaceIndex.register(
    "modelica:/lib/Modelica/Electrical/Analog/Basic/package.mo",
    () => (globalThis as any).modelicaParser.parse(basicText).rootNode,
    "Modelica.Electrical.Analog",
  );
  wm.globalWorkspaceIndex.register(
    "modelica:/lib/Modelica/Icons.mo",
    () => (globalThis as any).modelicaParser.parse(iconsText).rootNode,
    "Modelica",
  );

  // 1. Resolve Analog package
  const analogCls = wm.resolveModelicaClassInstance("file:///", "Modelica.Electrical.Analog");
  assert(analogCls, "Modelica.Electrical.Analog must resolve");
  assert(analogCls.extendsClassInstances?.length > 0, "Analog must have extendsClassInstances");
  const analogSvg = getClassIconSvg(analogCls, 20, false);
  assert(analogSvg && analogSvg.startsWith("<svg"), "Analog SVG must be generated");
  assert(analogSvg.includes("linearGradient"), "Analog SVG must include cylinder gradient");
  assert(
    analogSvg.includes("A 25 25"),
    "Analog SVG must include rounded corners (radius 25) from Modelica.Icons.Package",
  );
  assert(analogSvg.includes("<line"), "Analog SVG must include capacitor line graphics");

  // 2. Resolve Basic package
  const basicCls = wm.resolveModelicaClassInstance("file:///", "Modelica.Electrical.Analog.Basic");
  assert(basicCls, "Modelica.Electrical.Analog.Basic must resolve");
  assert(basicCls.extendsClassInstances?.length > 0, "Basic must have extendsClassInstances");
  const basicSvg = getClassIconSvg(basicCls, 20, false);
  assert(basicSvg && basicSvg.startsWith("<svg"), "Basic SVG must be generated");
  assert(basicSvg.includes("linearGradient"), "Basic SVG must include cylinder gradient");
  assert(
    basicSvg.includes("A 25 25"),
    "Basic SVG must include rounded corners (radius 25) from Modelica.Icons.Package",
  );
  assert(basicSvg.includes("<line"), "Basic SVG must include basic component line graphics");

  console.log("test-nested-package-icons passed successfully!");
});
