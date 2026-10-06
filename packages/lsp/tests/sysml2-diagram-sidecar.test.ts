// SPDX-License-Identifier: AGPL-3.0-or-later

import * as sysmlOps from "@modelscript/sysml2/diagram";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SysML2DiagramBackend } from "../src/diagramApi.js";
import { DiagramService } from "../src/services/diagram-service.js";

describe("SysML v2 Diagram Sidecar Layout Persistence", () => {
  const uri = "file:///workspace/VehicleModel.sysml";
  const docText = `package VehicleModel {
  part def Chassis;
  part def Engine;
  connection c1 connect Chassis to Engine;
}`;

  it("should generate sidecarUri and sidecarContent on node move", () => {
    let storedLayout: any = null;

    const backend = new SysML2DiagramBackend({
      getDocumentText: () => docText,
      getLayout: () => storedLayout,
      setLayout: (_uri, layout) => {
        storedLayout = layout;
      },
      createEmptyLayout: () => sysmlOps.createEmptyLayout(),
      updateElementPositions: (...args: any[]) => (sysmlOps as any).updateElementPositions(...args),
      updateConnectionVertices: (...args: any[]) => (sysmlOps as any).updateConnectionVertices(...args),
      removeElements: (...args: any[]) => (sysmlOps as any).removeElements(...args),
      renameElement: (...args: any[]) => (sysmlOps as any).renameElement(...args),
      serializeLayout: (l) => sysmlOps.serializeLayout(l),
      parseLayout: (t) => sysmlOps.parseLayout(t),
      getSidecarUri: (u) => sysmlOps.layoutUriFromSysmlUri(u),
      buildDiagramData: () => ({ nodes: [], edges: [] }),
      getSysML2Parser: () => null,
      computeConnectionInsert: () => [],
      computeConnectionDelete: () => [],
      computeElementInsert: () => [],
      computeElementDelete: () => [],
      generateUniqueName: () => "element_1",
      computeNameEdit: () => [],
      computeDescriptionEdit: () => [],
      computeParameterEdit: () => [],
    });

    const result = backend.applyEdits({
      uri,
      seq: 1,
      actions: [
        {
          type: "move",
          items: [{ name: "Chassis", x: 150, y: 220, width: 180, height: 60 }],
        },
      ],
    });

    assert.strictEqual(result.seq, 1);
    assert.strictEqual(result.renderHint, "none");
    assert.deepStrictEqual(result.edits, []);
    assert.strictEqual(result.sidecarUri, "file:///workspace/VehicleModel.sysml.layout");
    assert.ok(result.sidecarContent, "sidecarContent should be defined");

    const parsed = JSON.parse(result.sidecarContent);
    assert.strictEqual(parsed.version, 1);
    assert.deepStrictEqual(parsed.elements["Chassis"], {
      x: 150,
      y: 220,
      width: 180,
      height: 60,
    });
  });

  it("should update connection vertices in sidecar on moveEdge and connect", () => {
    let storedLayout: any = {
      version: 1,
      elements: {
        Chassis: { x: 100, y: 100, width: 180, height: 60 },
        Engine: { x: 400, y: 100, width: 180, height: 60 },
      },
      connections: {},
    };

    const backend = new SysML2DiagramBackend({
      getDocumentText: () => docText,
      getLayout: () => storedLayout,
      setLayout: (_uri, layout) => {
        storedLayout = layout;
      },
      createEmptyLayout: () => sysmlOps.createEmptyLayout(),
      updateElementPositions: (...args: any[]) => (sysmlOps as any).updateElementPositions(...args),
      updateConnectionVertices: (...args: any[]) => (sysmlOps as any).updateConnectionVertices(...args),
      removeElements: (...args: any[]) => (sysmlOps as any).removeElements(...args),
      renameElement: (...args: any[]) => (sysmlOps as any).renameElement(...args),
      serializeLayout: (l) => sysmlOps.serializeLayout(l),
      parseLayout: (t) => sysmlOps.parseLayout(t),
      getSidecarUri: (u) => sysmlOps.layoutUriFromSysmlUri(u),
      buildDiagramData: () => ({ nodes: [], edges: [] }),
      getSysML2Parser: () => null,
      computeConnectionInsert: () => [],
      computeConnectionDelete: () => [],
      computeElementInsert: () => [],
      computeElementDelete: () => [],
      generateUniqueName: () => "element_1",
      computeNameEdit: () => [],
      computeDescriptionEdit: () => [],
      computeParameterEdit: () => [],
    });

    const result = backend.applyEdits({
      uri,
      seq: 2,
      actions: [
        {
          type: "moveEdge",
          edges: [
            {
              source: "Chassis",
              target: "Engine",
              points: [
                { x: 190, y: 130 },
                { x: 300, y: 200 },
                { x: 400, y: 130 },
              ],
            },
          ],
        },
      ],
    });

    assert.ok(result.sidecarContent);
    const parsed = JSON.parse(result.sidecarContent);
    assert.ok(parsed.connections["Chassis→Engine"]);
    assert.strictEqual(parsed.connections["Chassis→Engine"].vertices.length, 3);
    assert.deepStrictEqual(parsed.connections["Chassis→Engine"].vertices[1], { x: 300, y: 200 });
  });

  it("should synchronize element rename and update referencing connection keys in sidecar", () => {
    let storedLayout: any = {
      version: 1,
      elements: {
        Chassis: { x: 100, y: 100, width: 180, height: 60 },
        Engine: { x: 400, y: 100, width: 180, height: 60 },
      },
      connections: {
        "Chassis→Engine": {
          vertices: [
            { x: 190, y: 130 },
            { x: 400, y: 130 },
          ],
        },
      },
    };

    const backend = new SysML2DiagramBackend({
      getDocumentText: () => docText,
      getLayout: () => storedLayout,
      setLayout: (_uri, layout) => {
        storedLayout = layout;
      },
      createEmptyLayout: () => sysmlOps.createEmptyLayout(),
      updateElementPositions: (...args: any[]) => (sysmlOps as any).updateElementPositions(...args),
      updateConnectionVertices: (...args: any[]) => (sysmlOps as any).updateConnectionVertices(...args),
      removeElements: (...args: any[]) => (sysmlOps as any).removeElements(...args),
      renameElement: (...args: any[]) => (sysmlOps as any).renameElement(...args),
      serializeLayout: (l) => sysmlOps.serializeLayout(l),
      parseLayout: (t) => sysmlOps.parseLayout(t),
      getSidecarUri: (u) => sysmlOps.layoutUriFromSysmlUri(u),
      buildDiagramData: () => ({ nodes: [], edges: [] }),
      getSysML2Parser: () => null,
      computeConnectionInsert: () => [],
      computeConnectionDelete: () => [],
      computeElementInsert: () => [],
      computeElementDelete: () => [],
      generateUniqueName: () => "element_1",
      computeNameEdit: () => [],
      computeDescriptionEdit: () => [],
      computeParameterEdit: () => [],
    });

    const result = backend.applyEdits({
      uri,
      seq: 3,
      actions: [
        {
          type: "updateName",
          oldName: "Chassis",
          newName: "MainBody",
        },
      ],
    });

    assert.ok(result.sidecarContent);
    const parsed = JSON.parse(result.sidecarContent);
    assert.strictEqual(parsed.elements["Chassis"], undefined);
    assert.deepStrictEqual(parsed.elements["MainBody"], { x: 100, y: 100, width: 180, height: 60 });
    assert.strictEqual(parsed.connections["Chassis→Engine"], undefined);
    assert.ok(parsed.connections["MainBody→Engine"]);
  });

  it("should remove deleted components from sidecar", () => {
    let storedLayout: any = {
      version: 1,
      elements: {
        Chassis: { x: 100, y: 100, width: 180, height: 60 },
        Engine: { x: 400, y: 100, width: 180, height: 60 },
      },
      connections: {
        "Chassis→Engine": {
          vertices: [
            { x: 190, y: 130 },
            { x: 400, y: 130 },
          ],
        },
      },
    };

    const backend = new SysML2DiagramBackend({
      getDocumentText: () => docText,
      getLayout: () => storedLayout,
      setLayout: (_uri, layout) => {
        storedLayout = layout;
      },
      createEmptyLayout: () => sysmlOps.createEmptyLayout(),
      updateElementPositions: (...args: any[]) => (sysmlOps as any).updateElementPositions(...args),
      updateConnectionVertices: (...args: any[]) => (sysmlOps as any).updateConnectionVertices(...args),
      removeElements: (...args: any[]) => (sysmlOps as any).removeElements(...args),
      renameElement: (...args: any[]) => (sysmlOps as any).renameElement(...args),
      serializeLayout: (l) => sysmlOps.serializeLayout(l),
      parseLayout: (t) => sysmlOps.parseLayout(t),
      getSidecarUri: (u) => sysmlOps.layoutUriFromSysmlUri(u),
      buildDiagramData: () => ({ nodes: [], edges: [] }),
      getSysML2Parser: () => null,
      computeConnectionInsert: () => [],
      computeConnectionDelete: () => [],
      computeElementInsert: () => [],
      computeElementDelete: () => [],
      generateUniqueName: () => "element_1",
      computeNameEdit: () => [],
      computeDescriptionEdit: () => [],
      computeParameterEdit: () => [],
    });

    const result = backend.applyEdits({
      uri,
      seq: 4,
      actions: [
        {
          type: "deleteComponents",
          names: ["Engine"],
        },
      ],
    });

    assert.ok(result.sidecarContent);
    const parsed = JSON.parse(result.sidecarContent);
    assert.strictEqual(parsed.elements["Engine"], undefined);
    assert.ok(parsed.elements["Chassis"]);
    assert.strictEqual(parsed.connections["Chassis→Engine"], undefined);
  });

  it("should parse sidecarContent in handleGetDiagramData and merge layout into diagram nodes and edges", async () => {
    (globalThis as any).sysml2DiagramOps = {
      ...sysmlOps,
      buildSysML2DiagramData: (_unified: any, _uri: string, _class: any, _type: any) => ({
        nodes: [
          { id: "n_s1", x: 0, y: 0, width: 100, height: 50, autoLayout: true },
          { id: "n_s2", x: 0, y: 0, width: 100, height: 50, autoLayout: true },
        ],
        edges: [
          {
            id: "e1",
            source: { cell: "n_s1", port: "p1", anchor: "", connectionPoint: { name: "" } },
            target: { cell: "n_s2", port: "p2", anchor: "", connectionPoint: { name: "" } },
          },
        ],
      }),
    };

    const mockConn = { console: { error: () => {}, info: () => {} } } as any;
    const mockDocManager = { documents: new Map() } as any;
    const mockWorkspaceManager = {
      unifiedWorkspace: {
        toUnified: () => ({
          symbols: new Map([
            ["s1", { id: "s1", name: "Chassis", resourceId: uri }],
            ["s2", { id: "s2", name: "Engine", resourceId: uri }],
          ]),
        }),
      },
    } as any;

    const diagramService = new DiagramService(mockConn, mockDocManager, mockWorkspaceManager);

    const sidecarContent = JSON.stringify({
      version: 1,
      elements: {
        Chassis: { x: 250, y: 350, width: 180, height: 70 },
      },
      connections: {
        e1: {
          vertices: [
            { x: 250, y: 350 },
            { x: 500, y: 350 },
          ],
        },
      },
    });

    const result = await diagramService.handleGetDiagramData({
      uri,
      diagramType: "All",
      sidecarContent,
    });

    assert.ok(result);
    const chassisNode = result.nodes.find((n: any) => n.id === "n_s1");
    assert.ok(chassisNode);
    assert.strictEqual(chassisNode.x, 250);
    assert.strictEqual(chassisNode.y, 350);
    assert.strictEqual(chassisNode.width, 180);
    assert.strictEqual(chassisNode.height, 70);
    assert.strictEqual(chassisNode.autoLayout, false);

    const edge = result.edges.find((e: any) => e.id === "e1");
    assert.ok(edge);
    assert.deepStrictEqual(edge.vertices, [
      { x: 250, y: 350 },
      { x: 500, y: 350 },
    ]);
  });
});
