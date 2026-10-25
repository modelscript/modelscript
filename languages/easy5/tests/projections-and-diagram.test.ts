// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Easy5WorkspaceIndex,
  buildEasy5DiagramData,
  easy5ToModelica,
  easy5ToSsp,
  parseEasy5,
  renderEasy5SchematicSvg,
} from "../src/index.js";

describe("@modelscript/easy5 Projections, Diagram & Workspace Suite", () => {
  const sampleModel = `MODEL: ActuatorSystem
TITLE: "Electromechanical Actuator"

COMPONENTS:
  LA01 TYPE=GP/LA TITLE="Filter" X=100 Y=150
    XP: GAIN=2.0, TAU1=0.01, TAU2=0.05
  IN01 TYPE=GP/IN TITLE="Integrator" X=300 Y=150
    XP: GAIN=10.0, S0=0.0

CONNECTIONS:
  LA01.OUT -> IN01.IN
`;

  it("projects EASY5 model into Modelica 3.x continuous blocks", () => {
    const model = parseEasy5(sampleModel);
    const mo = easy5ToModelica(model);

    assert.ok(mo.includes("model ActuatorSystem"));
    assert.ok(mo.includes("Modelica.Blocks.Continuous.TransferFunction LA01"));
    assert.ok(mo.includes("Modelica.Blocks.Continuous.Integrator IN01"));
    assert.ok(mo.includes("connect(LA01.y, IN01.u);"));
    assert.ok(mo.includes("end ActuatorSystem;"));
  });

  it("projects EASY5 model into FMI SystemStructure.ssd XML", () => {
    const model = parseEasy5(sampleModel);
    const ssp = easy5ToSsp(model);

    assert.ok(ssp.includes("<ssd:SystemStructureDescription"));
    assert.ok(ssp.includes('<ssd:Component name="LA01"'));
    assert.ok(ssp.includes('<ssd:Component name="IN01"'));
    assert.ok(
      ssp.includes('<ssd:Connection startElement="LA01" startConnector="OUT" endElement="IN01" endConnector="IN" />'),
    );
  });

  it("builds AntV X6 graph data and renders SVG diagram", () => {
    const model = parseEasy5(sampleModel);
    const graph = buildEasy5DiagramData(model);

    assert.strictEqual(graph.nodes.length, 2);
    assert.strictEqual(graph.edges.length, 1);
    assert.strictEqual(graph.nodes[0]!.id, "LA01");
    assert.strictEqual(graph.nodes[1]!.id, "IN01");

    const svg = renderEasy5SchematicSvg(model);
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.includes("ActuatorSystem - EASY5 Schematic"));
    assert.ok(svg.includes("LA01"));
    assert.ok(svg.includes("IN01"));
  });

  it("indexes EASY5 models in Easy5WorkspaceIndex for multi-file workspace navigation", () => {
    const ws = new Easy5WorkspaceIndex();
    const uri = "file:///workspace/models/actuator.ez5";
    const symIndex = ws.indexFile(uri, sampleModel);

    assert.ok(ws.has(uri));
    assert.strictEqual(ws.fileCount, 1);

    const modelSym = symIndex.byName.get("ActuatorSystem");
    assert.ok(modelSym && modelSym.length > 0);

    const laSym = symIndex.byName.get("LA01 [GP/LA]");
    assert.ok(laSym && laSym.length > 0);
  });
});
