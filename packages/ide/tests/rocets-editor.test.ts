// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { RocetsEditorProvider } from "../src/rocets-editor-provider.js";

const TEST_ROCETS_DECK = `DECK: TestRocketEngine
TITLE: "Expander Cycle Rocket Engine"
COMPONENTS:
  CHAMBER TYPE=CHAMBER TITLE="Main Chamber"
    PARAMS: PC=12.0E6, MR=6.0, AT=0.035, EPS=50.0, VC=0.02
  PUMP01 TYPE=PUMP TITLE="LH2 Fuel Pump"
    PARAMS: DELTA_P=18.0E6, ETA=0.76
  TURB01 TYPE=TURBINE TITLE="Drive Turbine"
    PARAMS: PR=1.6, ETA=0.74, T_IN=920.0
CONNECTIONS:
  PUMP01.OUT_P -> CHAMBER.IN_FUEL
  TURB01.OUT_P -> CHAMBER.IN_GAS
`;

describe("ROCETS Propulsion Visual Custom Editor Provider", () => {
  it("registers modelscript.rocetsEditor viewType", () => {
    assert.equal(RocetsEditorProvider.viewType, "modelscript.rocetsEditor");
  });

  it("resolves custom text editor and emits P&ID diagram, balance solve, and transient trajectory", async () => {
    const mockContext: any = {
      extensionUri: vscode.Uri.parse("file:///workspace"),
      subscriptions: [],
    };

    const provider = new RocetsEditorProvider(mockContext);

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
      uri: { toString: () => "file:///workspace/engine.roc" },
      getText: () => TEST_ROCETS_DECK,
    };

    await provider.resolveCustomTextEditor(mockDoc, mockPanel, {} as any);

    assert.ok(mockWebview.html.includes("ROCETS Liquid Rocket Propulsion Editor"));
    assert.ok(mockWebview.html.includes("P&amp;ID Schematic"));

    assert.equal(postedMessages.length, 1);
    const updateMsg = postedMessages[0];
    assert.equal(updateMsg.type, "update");
    assert.equal(updateMsg.name, "TestRocketEngine");
    assert.equal(updateMsg.components.length, 3);
    assert.ok(updateMsg.balance, "Expected engine balance result");
    assert.equal(updateMsg.balance.chamberPressurePa, 12.0e6);
    assert.ok(updateMsg.transient, "Expected transient trajectory result");
    assert.ok(updateMsg.svg.includes("<svg"), "Expected SVG P&ID diagram");
    assert.ok(updateMsg.modelicaCode.includes("model TestRocketEngine"));
    assert.ok(updateMsg.sspXml.includes('name="TestRocketEngine"'));
  });
});
