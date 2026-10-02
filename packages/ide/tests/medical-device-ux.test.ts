// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { CadViewerPanel } from "../src/cad-viewer-panel.js";
import { MultiBodyAnimationPanel } from "../src/multibody-animation-panel.js";
import { PacemakerProgrammerPanel } from "../src/pacemaker-programmer-panel.js";
import { AnimationController } from "../src/webview/cad-viewer/animation-controller.js";
import { parseCadAnnotationString } from "../src/webview/cad-viewer/parse-cad-annotations.js";

describe("Medical Device & 4D Deformable Organ UX Studio", () => {
  describe("Workstream 1: 3D Soft-Tissue Mesh Morphing & Clearance Vectors", () => {
    it("computes volume-radial scaling s = (V/V0)^(1/3) for deforming organ cavities", () => {
      const controller = new AnimationController();

      // Timeseries: chamber volume V from 1.0 down to 0.125 (e.g. ventricular contraction / collapse)
      const t = [0.0, 0.5, 1.0];
      const y = [
        [1.0], // t = 0.0 -> V = 1.0 (s = 1.0)
        [0.512], // t = 0.5 -> V = 0.512 (s = 0.8)
        [0.125], // t = 1.0 -> V = 0.125 (s = 0.5)
      ];
      controller.loadTimeseries(t, y, ["ventricle.V"]);

      controller.setBindings([
        {
          componentName: "LeftVentricle",
          bindings: [],
          deformation: {
            mode: "volume_radial",
            volumeVariable: "ventricle.V",
            referenceVolume: 1.0,
          },
        },
      ]);

      // At t = 0.0, scale should be [1.0, 1.0, 1.0]
      controller.seek(0.0);
      const tf0 = controller.getTransform("LeftVentricle");
      assert.strictEqual(Math.round(tf0.scale[0] * 100) / 100, 1.0);
      assert.strictEqual(Math.round(tf0.scale[1] * 100) / 100, 1.0);
      assert.strictEqual(Math.round(tf0.scale[2] * 100) / 100, 1.0);

      // At t = 0.5, scale should be (0.512)^(1/3) = 0.8
      controller.seek(0.5);
      const tf05 = controller.getTransform("LeftVentricle");
      assert.strictEqual(Math.round(tf05.scale[0] * 100) / 100, 0.8);
      assert.strictEqual(Math.round(tf05.scale[1] * 100) / 100, 0.8);
      assert.strictEqual(Math.round(tf05.scale[2] * 100) / 100, 0.8);

      // At t = 1.0, scale should be (0.125)^(1/3) = 0.5
      controller.seek(1.0);
      const tf1 = controller.getTransform("LeftVentricle");
      assert.strictEqual(Math.round(tf1.scale[0] * 100) / 100, 0.5);
      assert.strictEqual(Math.round(tf1.scale[1] * 100) / 100, 0.5);
      assert.strictEqual(Math.round(tf1.scale[2] * 100) / 100, 0.5);
    });

    it("parses dynamicScale and dynamicDeformation annotations from CAD definitions", () => {
      const cadAnnotation =
        'CAD(uri="modelica://Physiological/Ventricle.glb", feature="LeftVentricle", dynamicScale="{s_x, s_y, s_z}", dynamicDeformation="volume_radial(V=chamber.V, V0=1.0)")';
      const parsed = parseCadAnnotationString(cadAnnotation);

      assert.notStrictEqual(parsed, null);
      assert.strictEqual(parsed!.feature, "LeftVentricle");
      assert.strictEqual((parsed as any).dynamicScale, "{s_x, s_y, s_z}");
      assert.strictEqual((parsed as any).dynamicDeformation, "volume_radial(V=chamber.V, V0=1.0)");
    });

    it("manages dynamic clearance segments and computes real-time minimum distance", () => {
      const controller = new AnimationController();

      controller.setDefault("CannulaTip", {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      });
      controller.setDefault("VentricleWall", {
        position: [4, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      });

      // Default distance based on positions
      const defaultDist = controller.computeClearanceDistance("CannulaTip", "VentricleWall");
      assert.strictEqual(defaultDist, 4);

      // Register explicit closest-points segment (e.g. from geometric AABB clearance solver)
      controller.setClearanceSegments([
        {
          partA: "CannulaTip",
          partB: "VentricleWall",
          pointA: [0, 0, 0],
          pointB: [1.2, 0, 0],
          distance: 1.2,
          status: "danger",
        },
      ]);

      const segments = controller.getClearanceSegments();
      assert.strictEqual(segments.length, 1);
      assert.strictEqual(segments[0].status, "danger");
      assert.strictEqual(segments[0].distance, 1.2);

      const computedDist = controller.computeClearanceDistance("CannulaTip", "VentricleWall");
      assert.strictEqual(computedDist, 1.2);
    });
  });

  describe("Workstream 3: Virtual Electrophysiology & Device Programmer Panel", () => {
    it("creates PacemakerProgrammerPanel with standard clinical dual-chamber DDD defaults", () => {
      const extensionUri = vscode.Uri.file("/extension");
      PacemakerProgrammerPanel.createOrShow(extensionUri);

      const panel = PacemakerProgrammerPanel.currentPanel;
      assert.notStrictEqual(panel, undefined);

      const state = panel!.getCurrentState();
      assert.strictEqual(state.parameters.mode, "DDD");
      assert.strictEqual(state.parameters.lowerRateLimit, 60);
      assert.strictEqual(state.parameters.upperTrackingLimit, 130);
      assert.strictEqual(state.parameters.pacedAvDelay, 150);
      assert.strictEqual(state.parameters.sensedAvDelay, 120);
      assert.strictEqual(state.parameters.ventricularVoltage, 2.5);
      assert.strictEqual(state.parameters.pvarp, 250);
      assert.strictEqual(state.parameters.ventricularBlanking, 28);

      panel!.dispose();
      assert.strictEqual(PacemakerProgrammerPanel.currentPanel, undefined);
    });

    it("updates pacing mode and electrophysiology parameters dynamically", () => {
      const extensionUri = vscode.Uri.file("/extension");
      PacemakerProgrammerPanel.createOrShow(extensionUri);

      const panel = PacemakerProgrammerPanel.currentPanel!;

      // Change pacing mode to rate-responsive CRT-D
      panel.updateParameter("mode", "CRT-D");
      panel.updateParameter("lowerRateLimit", 70);
      panel.updateParameter("pacedAvDelay", 130);
      panel.updateParameter("ventricularVoltage", 3.0);

      const updated = panel.getCurrentState();
      assert.strictEqual(updated.parameters.mode, "CRT-D");
      assert.strictEqual(updated.parameters.lowerRateLimit, 70);
      assert.strictEqual(updated.parameters.pacedAvDelay, 130);
      assert.strictEqual(updated.parameters.ventricularVoltage, 3.0);

      panel.dispose();
    });

    it("triggers arrhythmia and stress disturbances: 3° AV Block, Bradycardia, PVC, Lead Dislodgement", () => {
      const extensionUri = vscode.Uri.file("/extension");
      PacemakerProgrammerPanel.createOrShow(extensionUri);
      const panel = PacemakerProgrammerPanel.currentPanel!;

      // 1. Induce Complete 3° AV Block
      const blockRes = panel.injectDisturbance("avBlock");
      assert.strictEqual(blockRes.name, "avBlock");
      assert.strictEqual(blockRes.appliedParameters["avBlock"], true);
      assert.strictEqual(panel.getCurrentState().telemetry.activeDisturbance, "3° AV Block");
      assert.strictEqual(panel.getCurrentState().telemetry.vpPercent, 100);

      // 2. Trigger Vasovagal Bradycardia
      const bradyRes = panel.injectDisturbance("bradycardia");
      assert.strictEqual(bradyRes.name, "bradycardia");
      assert.strictEqual(bradyRes.appliedParameters["intrinsicSinusRate"], 35.0);
      assert.strictEqual(panel.getCurrentState().telemetry.activeDisturbance, "Bradycardia (35 bpm)");

      // 3. Inject Premature Ventricular Contraction (PVC)
      const pvcRes = panel.injectDisturbance("pvc");
      assert.strictEqual(pvcRes.appliedParameters["ectopicVentricularBeat"], true);

      // 4. Simulate Lead Micro-Dislodgement
      const dislodgeRes = panel.injectDisturbance("leadDislodgement");
      assert.strictEqual(dislodgeRes.appliedParameters["pacingCaptureThreshold"], 4.2);
      assert.strictEqual(panel.getCurrentState().telemetry.rvLeadImpedance, 1580);

      // 5. Restore Normal Sinus Rhythm
      const restoreRes = panel.injectDisturbance("resetNormal");
      assert.strictEqual(restoreRes.appliedParameters["avBlock"], false);
      assert.strictEqual(restoreRes.appliedParameters["intrinsicSinusRate"], 72.0);
      assert.strictEqual(panel.getCurrentState().telemetry.activeDisturbance, null);

      panel.dispose();
    });
  });

  describe("Workstream 4: Cross-Domain Semantic Navigation (LSP Hover <-> 3D Mesh)", () => {
    it("provides focusPart and reveal methods on CadViewerPanel and MultiBodyAnimationPanel", () => {
      const extensionUri = vscode.Uri.file("/extension");
      const clientMock: any = { onNotification: () => ({ dispose: () => {} }), sendRequest: async () => [] };

      // MultiBodyAnimationPanel
      const multiPanel = vscode.window.createWebviewPanel("modelscript.multibodyAnimation", "MultiBody", 1);
      const animPanel = new (MultiBodyAnimationPanel as any)(multiPanel, extensionUri, clientMock, "file:///model.mo");
      MultiBodyAnimationPanel.currentPanel = animPanel;

      let postedMsg: any = null;
      (multiPanel.webview as any).postMessage = async (msg: any) => {
        postedMsg = msg;
        return true;
      };

      animPanel.focusPart("rv_lead_anchor");
      assert.deepStrictEqual(postedMsg, { type: "focusPart", partName: "rv_lead_anchor" });

      animPanel.dispose();
      assert.strictEqual(MultiBodyAnimationPanel.currentPanel, undefined);

      // CadViewerPanel
      const cadPanelRaw = vscode.window.createWebviewPanel("modelscript.cadViewer", "CadViewer", 1);
      const cadPanel = new (CadViewerPanel as any)(cadPanelRaw, extensionUri, clientMock);
      CadViewerPanel.currentPanel = cadPanel;

      let cadPostedMsg: any = null;
      (cadPanelRaw.webview as any).postMessage = async (msg: any) => {
        cadPostedMsg = msg;
        return true;
      };

      cadPanel.focusPart("cannula_tip");
      assert.deepStrictEqual(cadPostedMsg, { type: "focusPart", partName: "cannula_tip" });

      cadPanel.dispose();
      assert.strictEqual(CadViewerPanel.currentPanel, undefined);
    });
  });
});
