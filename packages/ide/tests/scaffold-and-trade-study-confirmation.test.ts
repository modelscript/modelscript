// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { CandidateTradeStudyPanel } from "../src/candidateTradeStudyPanel.js";
import {
  generateMultiDomainScaffold,
  registerMultiDomainScaffolding,
  SysmlScaffoldCodeLensProvider,
} from "../src/multiDomainScaffolding.js";

describe("Phase 5: One-Click Multi-Domain Scaffolding & Browser Physics Confirmation", () => {
  const sampleSysml = `
package DroneAero {
  part def DroneArm {
    attribute length : Real = 180.0;
    attribute width : Real = 45.0;
    attribute height : Real = 25.0;
    attribute wallThickness : Real = 3.5;
    attribute filletRadius : Real = 2.8;
    attribute mass : Real = 0.42;

    port p_mount : PowerPort;
    port p_motor : MotorPort;
  }
}
`;

  it("synthesizes Modelica, OpenSCAD CSG, FEA study, and CFD study from SysML v2", () => {
    const artifacts = generateMultiDomainScaffold(sampleSysml, "DroneArm");

    assert.strictEqual(artifacts.name, "DroneArm");

    // 1. Modelica physical model
    assert.ok(artifacts.modelicaSource.includes("model DroneArm"), "Modelica source should define model DroneArm");
    assert.ok(
      artifacts.modelicaSource.includes("parameter Real length = 180"),
      "Modelica source should preserve length parameter",
    );
    assert.ok(artifacts.modelicaSource.includes("end DroneArm;"), "Modelica source should properly close model");

    // 2. OpenSCAD CSG solid geometry
    assert.ok(artifacts.scadSource.includes("length = 180"), "OpenSCAD source should preserve length parameter");
    assert.ok(artifacts.scadSource.includes("width = 45"), "OpenSCAD source should preserve width parameter");
    assert.ok(artifacts.scadSource.includes("height = 25"), "OpenSCAD source should preserve height parameter");
    assert.ok(
      artifacts.scadSource.includes("module DroneArm_solid()"),
      "OpenSCAD source should declare parametric solid module",
    );
    assert.ok(
      artifacts.scadSource.includes("difference()"),
      "OpenSCAD source should use CSG difference for cavity and mounting holes",
    );

    // 3. Structural FEA study file
    assert.ok(
      artifacts.feaMoSource.includes("model DroneArm_FEA_Study"),
      "FEA study should define model DroneArm_FEA_Study",
    );
    assert.ok(artifacts.feaMoSource.includes("extends DroneArm;"), "FEA study should extend DroneArm base model");
    assert.ok(artifacts.feaMoSource.includes("maxVonMisesStress"), "FEA study should calculate maxVonMisesStress");
    assert.ok(artifacts.feaMoSource.includes("safetyMargin"), "FEA study should calculate safetyMargin");

    // 4. Aerodynamic CFD study file
    assert.ok(
      artifacts.cfdMoSource.includes("model DroneArm_CFD_Study"),
      "CFD study should define model DroneArm_CFD_Study",
    );
    assert.ok(artifacts.cfdMoSource.includes("extends DroneArm;"), "CFD study should extend DroneArm base model");
    assert.ok(
      artifacts.cfdMoSource.includes("aerodynamicDragForce"),
      "CFD study should calculate aerodynamicDragForce",
    );
    assert.ok(artifacts.cfdMoSource.includes("pressureDropPa"), "CFD study should calculate pressureDropPa");
  });

  it("provides CodeLens for one-click multi-domain scaffolding above SysML definitions", () => {
    const provider = new SysmlScaffoldCodeLensProvider();

    const mockDocument = {
      uri: vscode.Uri.file("/workspace/drone.sysml"),
      fileName: "/workspace/drone.sysml",
      getText: () => sampleSysml,
      positionAt: (offset: number) => {
        const lines = sampleSysml.slice(0, offset).split("\n");
        return new vscode.Position(lines.length - 1, lines[lines.length - 1]!.length);
      },
    } as any;

    const token = {} as vscode.CancellationToken;
    const lenses = provider.provideCodeLenses(mockDocument, token);

    assert.ok(lenses.length >= 1, "Should provide at least one CodeLens");
    const scaffoldLens = lenses[0]!;
    assert.ok(scaffoldLens.command, "CodeLens must have a command");
    assert.strictEqual(scaffoldLens.command.command, "modelscript.scaffoldMultiDomain");
    assert.ok(
      scaffoldLens.command.title.includes("Scaffold Multi-Domain"),
      "CodeLens title should indicate multi-domain scaffolding",
    );
  });

  it("registers modelscript.scaffoldMultiDomain command in IDE context", () => {
    const registeredCommands: string[] = [];
    const origRegisterCommand = vscode.commands.registerCommand;
    (vscode.commands as any).registerCommand = (id: string, handler: any) => {
      registeredCommands.push(id);
      return origRegisterCommand(id, handler);
    };

    try {
      const mockContext: any = {
        extensionUri: vscode.Uri.file("/mock/ext"),
        subscriptions: [],
      };

      const disposable = registerMultiDomainScaffolding(mockContext);
      assert.ok(
        registeredCommands.includes("modelscript.scaffoldMultiDomain"),
        "modelscript.scaffoldMultiDomain must be registered",
      );

      disposable.dispose();
    } finally {
      (vscode.commands as any).registerCommand = origRegisterCommand;
    }
  });

  it("executes local WASM FEA stress solver, WebGPU LBM CFD, and confirms safe candidate", async () => {
    const origCreateWebviewPanel = vscode.window.createWebviewPanel;
    let postedMessage: any = null;

    (vscode.window as any).createWebviewPanel = () => {
      return {
        webview: {
          html: "",
          onDidReceiveMessage: () => ({ dispose: () => {} }),
          postMessage: async (msg: any) => {
            postedMessage = msg;
            return true;
          },
        },
        onDidDispose: () => ({ dispose: () => {} }),
        reveal: () => {},
        dispose: () => {},
      };
    };

    try {
      CandidateTradeStudyPanel.createOrShow(vscode.Uri.file("/mock/ext"));
      const panel = CandidateTradeStudyPanel.currentPanel;
      assert.ok(panel, "CandidateTradeStudyPanel must be active");

      // Verify initial candidate state
      const cand1 = panel.getCandidate("cand_1");
      assert.ok(cand1, "Candidate cand_1 must exist");
      assert.strictEqual(cand1.tier3Status, "unverified");

      // Launch local Tier-3 confirmation
      const verifiedCand = await panel.launchLocalTier3("cand_1");
      assert.ok(verifiedCand, "launchLocalTier3 should return verified candidate");
      assert.strictEqual(verifiedCand.tier3Status, "confirmed");
      assert.ok(
        verifiedCand.maxStressMPa! <= verifiedCand.allowableStressMPa!,
        "Computed max stress must be <= allowable stress",
      );
      assert.ok(verifiedCand.safetyMarginPct > 0, "Safety margin percentage must be positive for confirmed candidate");
      assert.ok(verifiedCand.dragN > 0, "LBM CFD must compute non-zero aerodynamic drag force");

      assert.ok(postedMessage, "Webview should receive updated candidates message");
      assert.strictEqual(postedMessage.type, "update");
    } finally {
      (vscode.window as any).createWebviewPanel = origCreateWebviewPanel;
      if (CandidateTradeStudyPanel.currentPanel) {
        CandidateTradeStudyPanel.currentPanel.dispose();
      }
    }
  });

  it("detects overstressed candidate and refutes Tier 3 compliance", async () => {
    const origCreateWebviewPanel = vscode.window.createWebviewPanel;

    (vscode.window as any).createWebviewPanel = () => {
      return {
        webview: {
          html: "",
          onDidReceiveMessage: () => ({ dispose: () => {} }),
          postMessage: async () => true,
        },
        onDidDispose: () => ({ dispose: () => {} }),
        reveal: () => {},
        dispose: () => {},
      };
    };

    try {
      CandidateTradeStudyPanel.createOrShow(vscode.Uri.file("/mock/ext"));
      const panel = CandidateTradeStudyPanel.currentPanel;
      assert.ok(panel, "CandidateTradeStudyPanel must be active");

      // Candidate 4 has higher stress exceeding allowable limit
      const cand4 = panel.getCandidate("cand_4");
      cand4.allowableStressMPa = 10.0; // Enforce tight allowable stress limit to guarantee refutation
      cand4.parameters.wallThickness = 0.5;

      const verifiedCand = await panel.launchLocalTier3("cand_4");
      assert.ok(verifiedCand, "launchLocalTier3 should return candidate");
      assert.strictEqual(verifiedCand.tier3Status, "refuted");
    } finally {
      (vscode.window as any).createWebviewPanel = origCreateWebviewPanel;
      if (CandidateTradeStudyPanel.currentPanel) {
        CandidateTradeStudyPanel.currentPanel.dispose();
      }
    }
  });
});
