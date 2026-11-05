// SPDX-License-Identifier: AGPL-3.0-or-later

import { AnnotationEvaluator, buildDiagramData } from "@modelscript/modelica/diagram";
import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DocumentManager } from "../src/services/document-manager.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";

describe("Modelica Conditional HeatPort LSP & Diagram Integration", () => {
  it("should resolve real MSL Resistor heatPort dynamically when useHeatPort=true in WorkspaceManager and buildDiagramData", async () => {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("@modelscript/modelica/parser.wasm");
    const { parser } = await createWasmParser(wasmPath);
    (globalThis as any).modelicaParser = parser;
    (globalThis as any).AnnotationEvaluator = AnnotationEvaluator;

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(__dirname, "../../..");

    const docManager = new DocumentManager(null as any, () => null);
    const wm = new WorkspaceManager(docManager);
    wm.unifiedWorkspace.registerWorkspace("modelica", wm.globalWorkspaceIndex);

    const filesToIndex = [
      [
        "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Basic/Resistor.mo",
        "Modelica.Electrical.Analog.Basic",
      ],
      [
        "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Interfaces/OnePort.mo",
        "Modelica.Electrical.Analog.Interfaces",
      ],
      [
        "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Interfaces/TwoPin.mo",
        "Modelica.Electrical.Analog.Interfaces",
      ],
      [
        "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Interfaces/ConditionalHeatPort.mo",
        "Modelica.Electrical.Analog.Interfaces",
      ],
      [
        "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Interfaces/Pin.mo",
        "Modelica.Electrical.Analog.Interfaces",
      ],
      [
        "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Interfaces/PositivePin.mo",
        "Modelica.Electrical.Analog.Interfaces",
      ],
      [
        "data/libraries/Modelica/4.1.0/extracted/Modelica/Electrical/Analog/Interfaces/NegativePin.mo",
        "Modelica.Electrical.Analog.Interfaces",
      ],
      [
        "data/libraries/Modelica/4.1.0/extracted/Modelica/Thermal/HeatTransfer/Interfaces/HeatPort_a.mo",
        "Modelica.Thermal.HeatTransfer.Interfaces",
      ],
      [
        "data/libraries/Modelica/4.1.0/extracted/Modelica/Thermal/HeatTransfer/Interfaces/PartialHeatPort.mo",
        "Modelica.Thermal.HeatTransfer.Interfaces",
      ],
    ];

    (globalThis as any).sharedFs = {
      exists: (p: string) => existsSync(p),
      read: (p: string) => readFileSync(p, "utf-8"),
    };

    for (const [relPath, pkg] of filesToIndex) {
      const fullPath = resolve(repoRoot, relPath);
      if (!existsSync(fullPath)) continue;
      const text = readFileSync(fullPath, "utf-8");
      const uri = "file://" + fullPath;
      const tree = parser.parse(text);
      docManager.documentTrees.set(uri, tree);
      wm.globalWorkspaceIndex.register(uri, () => tree.rootNode, pkg);
    }

    const circuitSrc = `model TestCircuitHeated
      Modelica.Electrical.Analog.Basic.Resistor R1(R=100, useHeatPort=true) annotation(Placement(transformation(extent={{-20,-10},{20,10}}, rotation=90)));
      Modelica.Electrical.Analog.Basic.Resistor R2(R=100, useHeatPort=false) annotation(Placement(transformation(extent={{20,-10},{60,10}})));
      annotation(Diagram(coordinateSystem(extent={{-100,-100},{100,100}})));
    end TestCircuitHeated;`;

    const circuitUri = "file:///workspace/TestCircuitHeated.mo";
    const circuitTree = parser.parse(circuitSrc);
    docManager.documentTrees.set(circuitUri, circuitTree);
    wm.globalWorkspaceIndex.register(circuitUri, () => circuitTree.rootNode);

    const circuitCls = wm.resolveModelicaClassInstance(circuitUri, "TestCircuitHeated");
    assert(circuitCls, "Circuit class instance must be resolved");

    const diagData = await buildDiagramData(circuitCls);
    assert(diagData, "DiagramData must be generated");

    const r1Node = diagData.nodes.find((n) => n.id === "R1");
    assert(r1Node, "R1 node must exist");
    const r1PortIds = ((r1Node.ports as any)?.items ?? []).map((p: any) => p.id);
    assert.deepStrictEqual(
      r1PortIds,
      ["p", "n", "heatPort"],
      "R1 (useHeatPort=true) must have ports p, n, and heatPort",
    );

    const r2Node = diagData.nodes.find((n) => n.id === "R2");
    assert(r2Node, "R2 node must exist");
    const r2PortIds = ((r2Node.ports as any)?.items ?? []).map((p: any) => p.id);
    assert.deepStrictEqual(
      r2PortIds,
      ["p", "n"],
      "R2 (useHeatPort=false) must have ports p and n only (heatPort hidden)",
    );
  });
});
