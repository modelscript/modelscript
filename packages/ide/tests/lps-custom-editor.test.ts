// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { LpsEditorProvider } from "../src/lps-editor-provider.js";

const SAMPLE_LPS_XML = `<?xml version="1.0" encoding="utf-8"?>
<PipelineStudioStudy Version="4.2.0">
  <StudyHeader Title="Interstate Gas Corridor" FluidType="Gas" EngineeringUnits="SI" />
  <NetworkModel>
    <Nodes>
      <Node Name="RECEIPT_POINT" Type="SupplySource" Elevation="350.0" Pressure="7000000.0" Temperature="293.15" />
      <Node Name="JUNCTION_1" Type="Junction" Elevation="250.0" />
      <Node Name="CITY_GATE" Type="DeliveryPoint" Elevation="80.0" FlowRate="80.0" MinDeliveryPressure="3500000.0" />
    </Nodes>
    <Pipes>
      <Pipe Name="SEGMENT_1" FromNode="RECEIPT_POINT" ToNode="JUNCTION_1" Length="50000.0" Diameter="0.762" Roughness="0.000015" MAOP="8000000.0" />
      <Pipe Name="SEGMENT_2" FromNode="JUNCTION_1" ToNode="CITY_GATE" Length="75000.0" Diameter="0.6096" Roughness="0.000015" MAOP="7500000.0" />
    </Pipes>
    <Compressors>
      <Compressor Name="CS_1" FromNode="RECEIPT_POINT" ToNode="JUNCTION_1" RatedPowerKw="12000.0" />
    </Compressors>
  </NetworkModel>
  <FluidProperties Model="AGA8">
    <Composition Methane="0.95" Ethane="0.03" Nitrogen="0.01" CarbonDioxide="0.01" />
  </FluidProperties>
</PipelineStudioStudy>`;

describe("PipelineStudio LPS Visual Custom Editor Provider", () => {
  it("registers modelscript.lpsEditor viewType", () => {
    assert.equal(LpsEditorProvider.viewType, "modelscript.lpsEditor");
  });

  it("resolves custom text editor and renders Schematic, Profile, and Line Pack panels", async () => {
    const mockContext = {
      extensionUri: vscode.Uri.parse("file:///workspace"),
      subscriptions: [],
    };

    const provider = new LpsEditorProvider(mockContext as unknown as vscode.ExtensionContext);

    const postedMessages: any[] = [];
    const mockWebview = {
      options: {},
      html: "",
      postMessage: (msg: any) => {
        postedMessages.push(msg);
      },
      onDidReceiveMessage: () => ({ dispose: () => {} }),
    };

    const mockPanel = {
      webview: mockWebview,
      onDidDispose: () => ({ dispose: () => {} }),
    };

    const mockDoc = {
      uri: { toString: () => "file:///workspace/study.lps" },
      getText: () => SAMPLE_LPS_XML,
    };

    await provider.resolveCustomTextEditor(
      mockDoc as unknown as vscode.TextDocument,
      mockPanel as unknown as vscode.WebviewPanel,
      {} as vscode.CancellationToken,
    );

    // Verify HTML shell contains tabs and layout elements
    assert.ok(mockWebview.html.includes("PipelineStudio Visual Workspace"));
    assert.ok(mockWebview.html.includes("Network Schematic"));
    assert.ok(mockWebview.html.includes("Hydraulic Profile P(x)"));
    assert.ok(mockWebview.html.includes("Line Pack & Storage"));
    assert.ok(mockWebview.html.includes("ASME Safety Compliance"));
    assert.ok(mockWebview.html.includes("SysML v2 Specification"));

    // Verify posted update message
    const updateMsg = postedMessages.find((m) => m.type === "update");
    assert.ok(updateMsg, "Must post update message with pipeline data");
    assert.equal(updateMsg.title, "Interstate Gas Corridor");
    assert.equal(updateMsg.nodeCount, 3);
    assert.equal(updateMsg.pipeCount, 2);
    assert.equal(updateMsg.compressorCount, 1);
    assert.ok(updateMsg.schematicSvg.includes("<svg"), "Must produce vector schematic SVG");
    assert.ok(updateMsg.profileSvg.includes("<svg"), "Must produce hydraulic profile SVG");
    assert.ok(updateMsg.linePack, "Must produce line pack analytics");
    assert.ok(updateMsg.sysml2Code.includes("package"), "Must produce formal SysML v2 projection");
  });
});
