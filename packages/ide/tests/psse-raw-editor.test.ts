// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { RawEditorProvider } from "../src/raw-editor-provider.js";

const IEEE_14_RAW = `0, 100.00, 33, 0, 0, 60.00 / PSS/E-33.0 IEEE 14 BUS TEST CASE
IEEE 14 BUS TEST CASE
TRANSMISSION PLANNING MODEL
1, 'BUS 1       ', 0.6900, 3, 1, 1, 1, 1.0600, 0.0000
2, 'BUS 2       ', 0.6900, 2, 1, 1, 1, 1.0450, -4.9800
3, 'BUS 3       ', 0.6900, 2, 1, 1, 1, 1.0100, -12.7200
4, 'BUS 4       ', 0.6900, 1, 1, 1, 1, 1.0190, -10.3300
5, 'BUS 5       ', 0.6900, 1, 1, 1, 1, 1.0200, -8.7800
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 21.700, 12.700, 0.000, 0.000, 0.000, 0.000, 1, 1, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 232.400, -16.900, 10.000, -9999.000, 1.0600, 0, 100.00, 0.00000, 1.00000, 0.00000, 0.00000, 1.0000, 1, 100.0, 9999.000, -9999.000
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01938, 0.05917, 0.05280, 0.00, 0.00, 0.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
`;

describe("PSS/E RAW Visual Custom Editor Provider", () => {
  it("registers modelscript.rawEditor viewType", () => {
    assert.equal(RawEditorProvider.viewType, "modelscript.rawEditor");
  });

  it("resolves custom text editor and renders dual-mode SLD and Grid interface", async () => {
    const mockContext: any = {
      extensionUri: vscode.Uri.parse("file:///workspace"),
      subscriptions: [],
    };

    const provider = new RawEditorProvider(mockContext);

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
      uri: { toString: () => "file:///workspace/case.raw" },
      getText: () => IEEE_14_RAW,
    };

    await provider.resolveCustomTextEditor(mockDoc, mockPanel, {} as any);

    // Verify HTML content structure
    assert.ok(mockWebview.html.includes("PSS/E Power Flow Case Editor"));
    assert.ok(mockWebview.html.includes("⚡ SLD Diagram"));
    assert.ok(mockWebview.html.includes("📋 Grid Tables"));
    assert.ok(mockWebview.html.includes("diag-banner"));
    assert.ok(mockWebview.html.includes("kpi-row"));

    // Verify posted data message
    const updateMsg = postedMessages.find((m) => m.type === "update");
    assert.ok(updateMsg, "Must post update message with parsed case and netlist data");
    assert.equal(updateMsg.title1, "IEEE 14 BUS TEST CASE");
    assert.equal(updateMsg.buses.length, 5);
    assert.equal(updateMsg.generators.length, 1);
    assert.equal(updateMsg.branches.length, 1);
    assert.ok(updateMsg.svg.includes("<svg"));
    assert.ok(updateMsg.metrics.totalGenMw > 200);
  });
});
