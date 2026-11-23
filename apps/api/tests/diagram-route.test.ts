// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedGraph } from "@modelscript/canvas";
import express from "express";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import {
  diagramRouter,
  type DiagramDataPayload,
  type DiagramEdgeSpec,
  type DiagramNodeSpec,
} from "../src/routes/diagram.js";

interface DiagramResponseBody {
  uri: string;
  diagramData: DiagramDataPayload;
}

function assertValidDiagramGraph(data: DiagramDataPayload): void {
  assert.ok(Array.isArray(data.nodes), "diagramData.nodes must be an array");
  assert.ok(Array.isArray(data.edges), "diagramData.edges must be an array");
  assert.ok(data.nodes.length > 0, "diagramData.nodes must not be empty");
  assert.ok(data.edges.length > 0, "diagramData.edges must not be empty");

  const nodeById = new Map<string, DiagramNodeSpec>();
  for (const node of data.nodes) {
    assert.equal(typeof node.id, "string");
    assert.ok(node.id.length > 0);
    assert.equal(typeof node.x, "number");
    assert.equal(typeof node.y, "number");
    assert.ok(node.width > 0);
    assert.ok(node.height > 0);
    assert.ok(node.attrs && typeof node.attrs === "object");
    assert.ok(node.attrs.body && typeof node.attrs.body === "object");
    assert.ok(node.attrs.label && typeof node.attrs.label === "object");
    assert.ok(node.ports && Array.isArray(node.ports.items));
    nodeById.set(node.id, node);
  }

  for (const edge of data.edges as DiagramEdgeSpec[]) {
    assert.equal(typeof edge.id, "string");
    assert.ok(edge.id.length > 0);
    const srcNode = nodeById.get(edge.source.cell);
    const tgtNode = nodeById.get(edge.target.cell);
    assert.ok(srcNode, `Edge '${edge.id}' source cell '${edge.source.cell}' must exist`);
    assert.ok(tgtNode, `Edge '${edge.id}' target cell '${edge.target.cell}' must exist`);
    assert.ok(
      srcNode.ports.items.some((p) => p.id === edge.source.port),
      `Edge '${edge.id}' source port '${edge.source.port}' must exist on '${edge.source.cell}'`,
    );
    assert.ok(
      tgtNode.ports.items.some((p) => p.id === edge.target.port),
      `Edge '${edge.id}' target port '${edge.target.port}' must exist on '${edge.target.cell}'`,
    );
    assert.ok(edge.attrs?.line?.stroke, `Edge '${edge.id}' must specify stroke color`);
    assert.ok(Array.isArray(edge.labels) && edge.labels.length > 0, `Edge '${edge.id}' must include labels`);
  }
}

async function withDiagramServer(
  options: { workspaceRoot?: string | undefined } | undefined,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/diagram", diagramRouter(options));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("Diagram Hydration REST API (/api/v1/diagram)", () => {
  test("rejects missing, empty, path traversal, null-byte, and absolute filesystem URIs with 400", async () => {
    await withDiagramServer(undefined, async (baseUrl) => {
      const invalidRequests = [
        `${baseUrl}/api/v1/diagram`,
        `${baseUrl}/api/v1/diagram?uri=`,
        `${baseUrl}/api/v1/diagram?uri=%20%20`,
        `${baseUrl}/api/v1/diagram?uri=../../etc/passwd`,
        `${baseUrl}/api/v1/diagram?uri=models/../../etc/passwd`,
        `${baseUrl}/api/v1/diagram?uri=%252e%252e%252fetc/passwd`,
        `${baseUrl}/api/v1/diagram?uri=/etc/passwd`,
        `${baseUrl}/api/v1/diagram?uri=/proc/self/environ`,
        `${baseUrl}/api/v1/diagram?uri=models/ActuatorPlant.mo%00.txt`,
        `${baseUrl}/api/v1/diagram?uri=file:///etc/passwd`,
        `${baseUrl}/api/v1/diagram?uri=C:\\Windows\\System32\\drivers\\etc\\hosts`,
      ];

      for (const url of invalidRequests) {
        const res = await fetch(url);
        assert.equal(res.status, 400, `Expected 400 for ${url}, got ${res.status}`);
        const body = (await res.json()) as { error?: string };
        assert.equal(typeof body.error, "string");
        assert.ok((body.error ?? "").length > 0);
      }
    });
  });

  test("hydrates canonical Modelica ActuatorPlant.mo with valid nodes, edges, and embedded CAD 3D portal", async () => {
    await withDiagramServer(undefined, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/diagram?uri=${encodeURIComponent("models/ActuatorPlant.mo")}`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as DiagramResponseBody;
      assert.equal(body.uri, "models/ActuatorPlant.mo");
      assertValidDiagramGraph(body.diagramData);

      const housingNode = body.diagramData.nodes.find((n) => n.id === "housing");
      assert.ok(housingNode, "Expected 'housing' component node in ActuatorPlant diagram");
      assert.deepEqual(housingNode.portal, {
        kind: "cad",
        artifactUri: "cad/actuator_housing.step",
      });
      assert.deepEqual(housingNode.data["portal"], {
        kind: "cad",
        artifactUri: "cad/actuator_housing.step",
      });

      // Verify direct hydration compatibility with UnifiedGraph + embedded 3D portal registration
      const graph = new UnifiedGraph({ width: 800, height: 400, renderMode: "canvas2d" });
      try {
        for (const node of body.diagramData.nodes) {
          graph.addNode(node as unknown as Record<string, unknown>);
        }
        for (const edge of body.diagramData.edges) {
          graph.addEdge(edge as unknown as Record<string, unknown>);
        }
        assert.equal(graph.getNodes().length, body.diagramData.nodes.length);
        assert.equal(graph.getEdges().length, body.diagramData.edges.length);
        const registeredPortal = graph.portal3DManager.getPortal("housing");
        assert.ok(registeredPortal);
        assert.equal(registeredPortal.kind, "cad");
        assert.equal(registeredPortal.artifactUri, "cad/actuator_housing.step");
      } finally {
        graph.dispose();
      }
    });
  });

  test("hydrates Simulink PIDController.slx with controller blocks and signal edges", async () => {
    await withDiagramServer(undefined, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/diagram?uri=${encodeURIComponent("controls/PIDController.slx")}`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as DiagramResponseBody;
      assert.equal(body.uri, "controls/PIDController.slx");
      assertValidDiagramGraph(body.diagramData);

      const nodeIds = new Set(body.diagramData.nodes.map((n) => n.id));
      assert.ok(nodeIds.has("sum_err"), "Expected error summing junction block");
      assert.ok(nodeIds.has("pid_p"), "Expected proportional gain block");
      assert.ok(nodeIds.has("pid_i"), "Expected integrator block");
      assert.ok(nodeIds.has("pid_d"), "Expected derivative block");
      assert.ok(nodeIds.has("sat_clamp"), "Expected saturation clamp block");
      assert.ok(
        body.diagramData.nodes.every((n) => n.properties.className.startsWith("Simulink.")),
        "Expected all blocks to have Simulink.* classNames",
      );
      assert.ok(body.diagramData.edges.length >= 8);
    });
  });

  test("synthesizes polyglot domain diagrams for SPICE, SysML v2, and FMU URIs", async () => {
    await withDiagramServer(undefined, async (baseUrl) => {
      for (const uri of ["circuits/filter.cir", "arch/actuator.sysml", "fmus/thermal_plant.fmu"]) {
        const res = await fetch(`${baseUrl}/api/v1/diagram?uri=${encodeURIComponent(uri)}`);
        assert.equal(res.status, 200, `Expected 200 for ${uri}`);
        const body = (await res.json()) as DiagramResponseBody;
        assert.equal(body.uri, uri);
        assertValidDiagramGraph(body.diagramData);
      }
    });
  });

  test("parses real workspace .mo component declarations, connect equations, and CAD/FEA/CFD annotations", async () => {
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "ms-diagram-route-"));
    try {
      const modelsDir = path.join(tmpWorkspace, "models");
      fs.mkdirSync(modelsDir, { recursive: true });
      const moPath = path.join(modelsDir, "CustomActuator.mo");
      fs.writeFileSync(
        moPath,
        `model CustomActuator "Workspace test actuator"
  // Electrical drive and mechanical assembly
  Modelica.Electrical.Analog.Basic.Resistor R1(R = 2.5);
  Modelica.Electrical.Analog.Basic.EMF drive(k = 0.18);
  Mechanics.Housing body(mass = 1.92)
    "CNC housing"
    annotation(CAD(uri="cad/actuator_housing.step"));
  Thermal.SolverMesh stressMesh
    annotation(FEA(uri="fea/housing_stress.vtk"));
  Fluid.CoolingDuct duct
    annotation(CFD(uri="cfd/cooling_flow.vtu"));
  parameter Real Kp = 1.5;
equation
  connect(R1.n, drive.p);
  connect(drive.flange, body.flange);
  connect(body.thermalPort, stressMesh.heatIn);
  connect(stressMesh.coolantPort, duct.inlet);
end CustomActuator;
`,
        "utf8",
      );

      await withDiagramServer({ workspaceRoot: tmpWorkspace }, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/v1/diagram?uri=${encodeURIComponent("models/CustomActuator.mo")}`);
        assert.equal(res.status, 200);
        const body = (await res.json()) as DiagramResponseBody;
        assert.equal(body.uri, "models/CustomActuator.mo");
        assertValidDiagramGraph(body.diagramData);

        const nodeById = new Map(body.diagramData.nodes.map((n) => [n.id, n]));
        assert.ok(nodeById.has("R1"));
        assert.ok(nodeById.has("drive"));
        assert.ok(nodeById.has("body"));
        assert.ok(nodeById.has("stressMesh"));
        assert.ok(nodeById.has("duct"));
        assert.ok(!nodeById.has("Kp"), "Scalar parameter Kp should not be emitted as a schematic block");

        assert.deepEqual(nodeById.get("body")?.portal, {
          kind: "cad",
          artifactUri: "cad/actuator_housing.step",
        });
        assert.deepEqual(nodeById.get("stressMesh")?.portal, {
          kind: "fea",
          artifactUri: "fea/housing_stress.vtk",
        });
        assert.deepEqual(nodeById.get("duct")?.portal, {
          kind: "cfd",
          artifactUri: "cfd/cooling_flow.vtu",
        });

        assert.equal(body.diagramData.edges.length, 4);
        assert.ok(
          body.diagramData.edges.some(
            (e) =>
              e.source.cell === "R1" && e.source.port === "n" && e.target.cell === "drive" && e.target.port === "p",
          ),
        );
        assert.ok(
          body.diagramData.edges.some(
            (e) =>
              e.source.cell === "drive" &&
              e.source.port === "flange" &&
              e.target.cell === "body" &&
              e.target.port === "flange",
          ),
        );
      });
    } finally {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    }
  });
});
