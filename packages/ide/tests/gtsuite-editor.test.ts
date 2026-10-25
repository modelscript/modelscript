// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { GtSuiteEditorProvider } from "../src/gtsuite-editor-provider.js";

const TEST_GTSUITE_MODEL = `
[MODEL]
NAME = TurboChargedInline4
SPEED_RPM = 3000

[COMPONENT: CYLINDER]
ID = cyl_1
BORE = 0.082
STROKE = 0.092
CR = 10.5

[COMPONENT: ENVIRONMENT]
ID = ambient_air
PRESSURE = 1.013e5
TEMPERATURE = 298.15
`;

describe("GT-SUITE / GT-POWER Visual Powertrain Custom Editor Provider", () => {
  it("registers modelscript.gtsuiteEditor viewType", () => {
    assert.equal(GtSuiteEditorProvider.viewType, "modelscript.gtsuiteEditor");
  });

  it("resolves custom text editor, emits schematic SVG, kinematics, and gate report", async () => {
    const mockContext: any = {
      extensionUri: vscode.Uri.parse("file:///workspace"),
      subscriptions: [],
    };

    const provider = new GtSuiteEditorProvider(mockContext);

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
      uri: { toString: () => "file:///workspace/engine.gtm" },
      getText: () => TEST_GTSUITE_MODEL,
    };

    await provider.resolveCustomTextEditor(mockDoc, mockPanel, {} as any);

    assert.ok(mockWebview.html.includes("GT-SUITE / GT-POWER Engine Studio"));
    assert.ok(mockWebview.html.includes("Indicator Diagram (P-V)"));
    assert.ok(mockWebview.html.includes("Combustion &amp; Emissions"));

    assert.equal(postedMessages.length, 1);
    const msg = postedMessages[0];
    assert.equal(msg.type, "update");
    assert.ok(msg.name);
    assert.ok(msg.schematicSvg && msg.schematicSvg.includes("<svg"));
    assert.ok(msg.kinematics && msg.kinematics.angles.length > 50);
    assert.ok(msg.verification);
    assert.ok(msg.modelicaCode && msg.modelicaCode.includes("model"));
    assert.ok(msg.sysml2Code && msg.sysml2Code.includes("package"));
  });
});
