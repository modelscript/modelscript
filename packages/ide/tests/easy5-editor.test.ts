// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { Easy5EditorProvider } from "../src/easy5-editor-provider.js";

const TEST_EASY5_MODEL = `MODEL: FlightControl
COMPONENTS:
  GA01 TYPE=GP/GA TITLE="Sensor Gain"
    XP: K=5.0
  IN01 TYPE=GP/IN TITLE="Command Integrator"
    XP: GAIN=1.0
    S0: S1=0.0
  LA01 TYPE=GP/LA TITLE="Lead-Lag Compensator"
    XP: P1=1.0, P2=2.0
    S0: S1=0.0

CONNECTIONS:
  GA01.OUT -> IN01.IN
  IN01.OUT -> LA01.IN
`;

describe("EASY5 Schematic & Linear Control Visual Custom Editor Provider", () => {
  it("registers modelscript.easy5Editor viewType", () => {
    assert.equal(Easy5EditorProvider.viewType, "modelscript.easy5Editor");
  });

  it("resolves custom text editor and emits schematic SVG, matrices, eigenvalues, and Bode data", async () => {
    const mockContext: any = {
      extensionUri: vscode.Uri.parse("file:///workspace"),
      subscriptions: [],
    };

    const provider = new Easy5EditorProvider(mockContext);

    const postedMessages: any[] = [];
    const mockWebview: any = {
      options: {},
      html: "",
      postMessage: (msg: any) => {
        postedMessages.push(msg);
      },
      onDidReceiveMessage: () => ({ dispose: () => {} }),
    };

    const mockPanel: any = {
      webview: mockWebview,
      onDidDispose: () => ({ dispose: () => {} }),
    };

    const mockDoc: any = {
      uri: { toString: () => "file:///workspace/flight.ez5" },
      getText: () => TEST_EASY5_MODEL,
    };

    await provider.resolveCustomTextEditor(mockDoc, mockPanel, {} as any);

    assert.ok(mockWebview.html.includes("EASY5 Model Editor"));
    assert.ok(mockWebview.html.includes("Schematic Diagram"));
    assert.ok(mockWebview.html.includes("Linear Control &amp; Bode"));

    assert.ok(postedMessages.length > 0, "Expected at least one postMessage call");
    const updateMsg = postedMessages.find((m) => m.type === "update");
    assert.ok(updateMsg, "Expected update postMessage");
    assert.equal(updateMsg.name, "FlightControl");
    assert.equal(updateMsg.components.length, 3);
    assert.equal(updateMsg.connections.length, 2);

    assert.ok(updateMsg.svg.includes("<svg"), "Expected rendered schematic SVG");
    assert.ok(updateMsg.sys.A.length >= 2, "Expected state-space matrix A");
    assert.ok(updateMsg.eigenvalues.length >= 2, "Expected computed eigenvalues");
    assert.ok(updateMsg.bode.frequenciesRadS.length > 0, "Expected Bode frequency sweep");
    assert.ok(updateMsg.modelicaCode.includes("model FlightControl"), "Expected Modelica projection");
  });
});
