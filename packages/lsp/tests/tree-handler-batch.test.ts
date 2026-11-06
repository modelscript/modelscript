// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { getClassIconSvg } from "@modelscript/modelica/diagram";
import { FIELD_NAMES, SYNTAX_NAMES as modelicaSyntaxNames } from "@modelscript/modelica/parser";
import assert from "assert";
import { readFileSync } from "fs";
import test from "node:test";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { iconCache, registerTreeHandlers } from "../src/handlers/treeHandler.js";
import { DocumentManager } from "../src/services/document-manager.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");

test("test-tree-handler-batch-icons", async () => {
  const wasmPath = resolve(repoRoot, "languages/modelica/dist/parser.wasm");
  const wasmBytes = readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes, {
    syntaxNames: modelicaSyntaxNames,
    fieldNames: FIELD_NAMES,
  });
  (globalThis as any).modelicaParser = parser;
  (globalThis as any).getClassIconSvg = getClassIconSvg;

  const docManager = new DocumentManager();
  const wm = new WorkspaceManager(docManager);

  // Load Resistor.mo
  const resistorPath = resolve(
    repoRoot,
    "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Basic/Resistor.mo",
  );
  const resistorText = readFileSync(resistorPath, "utf-8");

  (globalThis as any).sharedFs = {
    exists: () => true,
    read: () => resistorText,
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

  const handlers = new Map<string, (...args: any[]) => any>();
  const mockContext: any = {
    connection: {
      onRequest: (name: string, fn: (...args: any[]) => any) => {
        handlers.set(name, fn);
      },
    },
    workspaceManager: wm,
  };

  registerTreeHandlers(mockContext);

  assert(handlers.has("modelscript/getClassIcons"), "Must register modelscript/getClassIcons");
  assert(handlers.has("modelscript/getClassIcon"), "Must register modelscript/getClassIcon");
  assert(handlers.has("modelscript/getLibraryTree"), "Must register modelscript/getLibraryTree");

  // Clear icon cache to test fresh resolution
  iconCache.clear();

  const getClassIcons = handlers.get("modelscript/getClassIcons")!;
  const result = await getClassIcons({
    classNames: ["Modelica.Electrical.Analog.Basic.Resistor", "NonExistentClass"],
    uri: "modelica:/lib/Modelica/Electrical/Analog/Basic/Resistor.mo",
  });

  assert(result, "Result must not be null");
  assert(result["Modelica.Electrical.Analog.Basic.Resistor"], "Resistor icon must be resolved");
  assert(result["Modelica.Electrical.Analog.Basic.Resistor"].startsWith("<svg"), "Must return valid SVG");
  assert.strictEqual(result["NonExistentClass"], null, "NonExistentClass must return null");

  // Verify iconCache was populated
  assert(iconCache.has("Modelica.Electrical.Analog.Basic.Resistor"), "iconCache must have Resistor");

  // Verify __LIB__:Modelica resolves through getClassIcon
  const getClassIcon = handlers.get("modelscript/getClassIcon")!;
  const libIcon = await getClassIcon({ className: "__LIB__:Modelica" });
  assert(libIcon, "__LIB__:Modelica icon must be resolved");
  assert(libIcon.startsWith("<svg"), "__LIB__:Modelica icon must be valid SVG");

  // Test that getLibraryTree now returns nodes with pre-populated iconSvg
  const getLibraryTree = handlers.get("modelscript/getLibraryTree")!;
  const treeNodes = await getLibraryTree({
    uri: "file:///",
    parentId: "__LIB__:Modelica Standard Library",
  });

  assert(Array.isArray(treeNodes), "treeNodes must be an array");
  const resistorNode = treeNodes.find((n: any) => n.name === "Resistor" || n.compositeName?.endsWith(".Resistor"));
  assert(resistorNode, "Resistor node must be in library tree");
  assert(resistorNode.iconSvg, "Resistor node iconSvg must be pre-populated from iconCache");
  assert(resistorNode.iconSvg.startsWith("<svg"), "Resistor node iconSvg must be valid SVG");

  // Test root library tree pre-population
  const rootNodes = await getLibraryTree({ uri: "file:///" });
  assert(Array.isArray(rootNodes), "rootNodes must be an array");
  const modelicaRoot = rootNodes.find((n: any) => n.id === "__LIB__:Modelica" || n.name === "Modelica");
  if (modelicaRoot) {
    assert(modelicaRoot.iconSvg, "Modelica root node iconSvg must be pre-populated from iconCache");
  }

  console.log("test-tree-handler-batch-icons passed successfully!");
});
