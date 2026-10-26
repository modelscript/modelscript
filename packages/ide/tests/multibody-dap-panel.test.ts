// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import * as vscode from "vscode";
import { ModelScriptDebugSession, setLspDebugCallbacks } from "../src/debug-adapter.js";
import {
  MultiBodyAnimationPanel,
  createBoxMesh,
  createCylinderMesh,
  createSphereMesh,
  generateProceduralMultibodyGeometry,
} from "../src/multibody-animation-panel.js";

describe("VS Code DAP Debugger & 3D Multibody Animation Panel", () => {
  describe("Procedural Multibody Geometry & Bindings Generator", () => {
    it("should generate 3D box, cylinder, and sphere meshes with valid vertex buffers", () => {
      const box = createBoxMesh(1, "chassis", 1.2, 0.4, 0.6, [0.2, 0.4, 0.8]);
      assert.equal(box.id, 1);
      assert.equal(box.name, "chassis");
      assert.equal(box.type, "body");
      assert.equal(box.vertices.length, 72); // 24 verts * 3
      assert.equal(box.normals.length, 72);
      assert.equal(box.indices.length, 36); // 12 tris * 3

      const cyl = createCylinderMesh(2, "axle", 0.46, 1.5, 16);
      assert.equal(cyl.id, 2);
      assert.equal(cyl.name, "axle");
      assert.equal(cyl.type, "wheelset");
      assert.ok(cyl.vertices.length > 0);
      assert.ok(cyl.indices.length > 0);

      const sphere = createSphereMesh(3, "joint", 0.2, 8);
      assert.equal(sphere.id, 3);
      assert.equal(sphere.name, "joint");
      assert.equal(sphere.type, "marker");
      assert.ok(sphere.vertices.length > 0);
      assert.ok(sphere.indices.length > 0);
    });

    it("should extract SIMPACK bodies and joints into 3D meshes and coordinate bindings", () => {
      const spckContent = `
        <simpack_model version="2024">
          <body id="chassis" mass="1200" />
          <body id="wheel_fl" mass="35" />
          <joint id="rev_joint" type="revolute" />
        </simpack_model>
      `;

      const res = generateProceduralMultibodyGeometry("file:///models/suspension.spck", spckContent);
      assert.equal(res.meshes.length, 3); // 2 bodies + 1 joint
      assert.equal(res.components.length, 2);

      const chassisComp = res.components.find((c) => c.name === "chassis");
      assert.ok(chassisComp);
      assert.deepEqual(chassisComp.bindings?.position, ["chassis.r[1]", "chassis.r[2]", "chassis.r[3]"]);
      assert.deepEqual(chassisComp.bindings?.rotation, ["chassis.phi", "chassis.theta", "chassis.psi"]);
    });

    it("should extract GENSYS railway vehicle decks into bodies, wheelsets, and DOF bindings", () => {
      const gensysDeck = `
        rigid_body carbody  32000.0  1.4e6  1.8e6  2.2e6
        rigid_body bogie_1   2500.0  1200.0 1500.0 2000.0
        wheelset   ws_11     1400.0  0.7175 0.460  0.025
        wheelset   ws_12     1400.0  0.7175 0.460  0.025
        spring_k   k_sec_z   120000.0
      `;

      const res = generateProceduralMultibodyGeometry("file:///models/vehicle.ins", gensysDeck);
      assert.equal(res.meshes.length, 4); // 2 rigid bodies + 2 wheelsets
      assert.equal(res.components.length, 4);

      const carbodyMesh = res.meshes.find((m) => m.name === "carbody");
      assert.ok(carbodyMesh);
      assert.equal(carbodyMesh.type, "body");

      const wsMesh = res.meshes.find((m) => m.name === "ws_11");
      assert.ok(wsMesh);
      assert.equal(wsMesh.type, "wheelset");

      const wsComp = res.components.find((c) => c.name === "ws_11");
      assert.ok(wsComp);
      assert.deepEqual(wsComp.bindings?.position, ["ws_11.x", "ws_11.y", "ws_11.z"]);
      assert.deepEqual(wsComp.bindings?.rotation, ["ws_11.fi", "ws_11.th", "ws_11.ps"]);
    });

    it("should extract SIMPACK .fbi flexible body into mesh with modal deformation configuration", () => {
      const fbiContent = `
        $FBI_VERSION 2024
        $HEADER
        NAME 'FlexCantilever'
        NUM_NODES 2
        NUM_MODES 2
        $NODES
        1  0.0  0.0  0.0
        2  1.5  0.0  0.0
        $MODES
        MODE 1  FREQ 12.5  MASS 1.0  STIFF 616.85
        MODE 2  FREQ 45.0  MASS 1.0  STIFF 8000.0
        $MODE_SHAPES
        MODE 1
        1  0.0  0.0  0.0
        2  0.0  0.0  0.15
        MODE 2
        1  0.0  0.0  0.0
        2  0.0  0.08 0.0
      `;

      const res = generateProceduralMultibodyGeometry("file:///models/cantilever.fbi", fbiContent);
      assert.equal(res.meshes.length, 1);
      assert.equal(res.components.length, 1);

      const comp = res.components[0]!;
      assert.equal(comp.name, "FlexCantilever");
      assert.ok(comp.deformation);
      assert.equal(comp.deformation.mode, "modal");
      assert.deepEqual(comp.deformation.modalVariables, ["FlexCantilever.q1", "FlexCantilever.q2"]);
      assert.equal(comp.deformation.modeShapes?.length, 2);
    });
  });

  describe("MultiBodyAnimationPanel Webview & Debugger Sync", () => {
    let postedMessages: any[] = [];
    let mockPanel: any;
    let mockClient: any;

    beforeEach(() => {
      postedMessages = [];
      mockPanel = {
        webview: {
          postMessage: (msg: any) => {
            postedMessages.push(msg);
          },
          onDidReceiveMessage: () => ({ dispose: () => {} }),
          asWebviewUri: (uri: any) => uri,
          cspSource: "mock-csp",
          html: "",
        },
        reveal: () => {},
        dispose: () => {},
        onDidDispose: () => ({ dispose: () => {} }),
      };

      mockClient = {
        sendRequest: async (method: string) => {
          if (method === "modelscript/getCadComponents" || method === "modelscript/getStepMeshes") {
            return []; // empty -> triggers procedural fallback
          }
          return null;
        },
      };

      MultiBodyAnimationPanel.currentPanel = undefined;
    });

    it("should initialize panel with procedural meshes when no CAD files are present", async () => {
      const extUri = vscode.Uri.parse("file:///extension");
      const sourceUri = "file:///models/rail_vehicle.ins";
      const deck = "rigid_body carbody 30000\nwheelset ws1 1400";

      // Mock createWebviewPanel
      const originalCreate = vscode.window.createWebviewPanel;
      (vscode.window as any).createWebviewPanel = () => mockPanel;

      try {
        await MultiBodyAnimationPanel.createOrShow(
          extUri,
          mockClient,
          {
            t: [0, 0.1],
            y: [
              [0, 0],
              [0.1, 0.05],
            ],
            states: ["time", "carbody.z"],
          },
          sourceUri,
          deck,
        );

        assert.ok(MultiBodyAnimationPanel.currentPanel);
        assert.equal(MultiBodyAnimationPanel.currentPanel.sourceUri, sourceUri);

        const initMsg = postedMessages.find((m) => m.type === "init");
        assert.ok(initMsg);
        assert.equal(initMsg.data.stepMeshes.length, 2);
        assert.equal(initMsg.data.cadComponents.length, 2);
      } finally {
        (vscode.window as any).createWebviewPanel = originalCreate;
        MultiBodyAnimationPanel.currentPanel?.dispose();
      }
    });

    it("should dispatch liveValues to 3D webview via syncWithDebugger", async () => {
      const extUri = vscode.Uri.parse("file:///extension");
      const originalCreate = vscode.window.createWebviewPanel;
      (vscode.window as any).createWebviewPanel = () => mockPanel;

      try {
        await MultiBodyAnimationPanel.createOrShow(
          extUri,
          mockClient,
          { t: [0], y: [[0]], states: ["time"] },
          "file:///models/test.spck",
          "body chassis 100",
        );

        const panel = MultiBodyAnimationPanel.currentPanel!;
        panel.syncWithDebugger([
          { name: "time", value: "0.25" },
          { name: "chassis.r[1]", value: "0.015" },
          { name: "chassis.phi", value: "0.002" },
        ]);

        const liveMsg = postedMessages.find((m) => m.type === "liveValues");
        assert.ok(liveMsg);
        assert.equal(liveMsg.data.time, 0.25);
        assert.equal(liveMsg.data.values["chassis.r[1]"], 0.015);
        assert.equal(liveMsg.data.values["chassis.phi"], 0.002);
      } finally {
        (vscode.window as any).createWebviewPanel = originalCreate;
        MultiBodyAnimationPanel.currentPanel?.dispose();
      }
    });
  });

  describe("ModelScriptDebugSession DAP Step & Breakpoint Sync", () => {
    let stepsRun = 0;
    let mockVariables: { name: string; value: string; variablesReference: number }[] = [];

    beforeEach(() => {
      stepsRun = 0;
      mockVariables = [
        { name: "time", value: "1.05", variablesReference: 0 },
        { name: "carbody.z", value: "0.0042", variablesReference: 0 },
        { name: "ws11.y", value: "0.0018", variablesReference: 0 },
        { name: "der(carbody.z)", value: "0.012", variablesReference: 0 },
      ];

      setLspDebugCallbacks(
        async () => {},
        async () => {},
        async () => mockVariables,
        async () => {},
        async () => {
          stepsRun++;
        },
      );
    });

    it("should synchronize 3D viewport when stepping over (nextRequest)", async () => {
      const session = new ModelScriptDebugSession();

      // Create a mock active panel
      const receivedLiveValues: any[] = [];
      const mockPanel = {
        syncWithDebugger: (vars: any[], time?: number) => {
          receivedLiveValues.push({ vars, time });
        },
      } as any;
      MultiBodyAnimationPanel.currentPanel = mockPanel;

      let responseSent = false;
      const response: any = {};
      session["sendResponse"] = () => {
        responseSent = true;
      };

      await (session as any).nextRequest(response);

      assert.equal(stepsRun, 1);
      assert.equal(responseSent, true);
      assert.equal(receivedLiveValues.length, 1);
      assert.equal(receivedLiveValues[0]!.vars.length, 4);

      MultiBodyAnimationPanel.currentPanel = undefined;
    });

    it("should synchronize 3D viewport on variablesRequest when paused on a breakpoint", async () => {
      const session = new ModelScriptDebugSession();

      const receivedLiveValues: any[] = [];
      const mockPanel = {
        syncWithDebugger: (vars: any[]) => {
          receivedLiveValues.push(vars);
        },
      } as any;
      MultiBodyAnimationPanel.currentPanel = mockPanel;

      const response: any = {};
      session["sendResponse"] = () => {};

      await (session as any).variablesRequest(response, { variablesReference: 1 });

      assert.equal(receivedLiveValues.length, 1);
      assert.equal(response.body.variables.length >= 1, true); // der(carbody.z) matched states filter

      MultiBodyAnimationPanel.currentPanel = undefined;
    });
  });
});
