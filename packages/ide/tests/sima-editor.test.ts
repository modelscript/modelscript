// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { SimaEditorProvider } from "../src/sima-editor-provider.js";

const TEST_SIMO_DECK = `
SYS 200.0 1025.0 9.81
BODY semi_hull OC4_Semi 13444000 13989 0.0 0.0 -13.46 32.0 32.0 34.0 4.5 5.0
FAIRLEAD fl_1 semi_hull 40.868 0.0 -14.0
FAIRLEAD fl_2 semi_hull -20.434 35.393 -14.0
FAIRLEAD fl_3 semi_hull -20.434 -35.393 -14.0

CRS chain_type 0.137 385.5 3200 1.25e9 1.0e5 1.8e7 1.2 2.0
LINE line_1 catenary fl_1 837.6 0.0 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_2 catenary fl_2 -418.8 725.4 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_3 catenary fl_3 -418.8 -725.4 -200.0
SEGM chain_type 835.5 1.8e7

WAVE JONSWAP 8.0 12.5 3.3 0.0
WIND 20.0 0.0
CURR 1.2 0.0
TIME 0.05 3600.0
`;

describe("SIMA / SIMO Visual Marine & Station-Keeping Custom Editor Provider", () => {
  it("registers modelscript.simaEditor viewType", () => {
    assert.equal(SimaEditorProvider.viewType, "modelscript.simaEditor");
  });

  it("resolves custom text editor, emits catenary SVG, polar spread SVG, DNV and projection payloads", async () => {
    const mockContext: any = {
      extensionUri: vscode.Uri.parse("file:///workspace"),
      subscriptions: [],
    };

    const provider = new SimaEditorProvider(mockContext);

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
      uri: { toString: () => "file:///workspace/oc4_semi.inp" },
      getText: () => TEST_SIMO_DECK,
    };

    await provider.resolveCustomTextEditor(mockDoc, mockPanel, {} as any);

    assert.ok(mockWebview.html.includes("SIMA Offshore Custom Editor"));
    assert.ok(mockWebview.html.includes("2D Catenary Sag Profile Preview"));
    assert.ok(mockWebview.html.includes("Overhead Polar Mooring Spread"));
    assert.ok(mockWebview.html.includes("tab-3d"));
    assert.ok(mockWebview.html.includes("sima-3d-canvas"));
    assert.ok(mockWebview.html.includes("hudTelemetry"));
    assert.ok(mockWebview.html.includes("sliderHs"));
    assert.ok(mockWebview.html.includes("sliderTp"));
    assert.ok(mockWebview.html.includes("hudEta"));
    assert.ok(mockWebview.html.includes("hudStation"));
    assert.ok(mockWebview.html.includes("DNV-OS-E301"));

    assert.equal(postedMessages.length, 1);
    const msg = postedMessages[0];
    assert.equal(msg.type, "update");
    assert.equal(msg.waterDepth, 200.0);
    assert.equal(msg.lineCount, 3);
    assert.ok(msg.catenarySvg && msg.catenarySvg.includes("<svg"));
    assert.ok(msg.spreadSvg && msg.spreadSvg.includes("<svg"));
    assert.ok(msg.dnvReport && msg.dnvReport.summary);
    assert.ok(msg.offsetReport && msg.offsetReport.watchCircleRadiusMeters > 0);
    assert.ok(msg.modelicaCode && msg.modelicaCode.includes("model"));
    assert.ok(msg.sysml2Code && msg.sysml2Code.includes("package"));
  });
});
