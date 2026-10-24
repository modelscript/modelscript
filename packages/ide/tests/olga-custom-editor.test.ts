// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { OlgaEditorProvider } from "../src/olga-editor-provider.js";

const SAMPLE_OPI_XML = `<?xml version="1.0" encoding="utf-8"?>
<Model Name="Subsea Production Flowline" StartTime="0" EndTime="1800" MinDt="0.1" MaxDt="1.0">
  <Flowpath Name="FLOWLINE_A">
    <Pipe Name="SEABED_LINE" Length="3000.0" Diameter="0.254" Elevation="-80.0" Roughness="0.000045" Discretization="10" />
    <Pipe Name="RISER" Length="800.0" Diameter="0.254" Elevation="120.0" Roughness="0.000045" Discretization="8" />
    <Valve Name="CHOKE_VALVE" Position="3750.0" Diameter="0.15" Opening="0.8" Cd="0.84" />
    <Pig Name="BATCH_PIG" LaunchTime="60.0" Mass="85.0" FrictionForce="2000.0" />
  </Flowpath>
  <Node Name="WELL_MANIFOLD" Type="TERMINAL" Flowpath="FLOWLINE_A" Fraction="0.0" Pressure="14000000" Temperature="340.15" MassRate="35.0" />
  <Node Name="TOPSIDE_SEP" Type="SEPARATOR" Flowpath="FLOWLINE_A" Fraction="1.0" Pressure="3000000" Temperature="295.15" />
</Model>`;

describe("OLGA Transient Multiphase Flow Assurance Custom Editor Provider", () => {
  it("registers modelscript.olgaEditor viewType", () => {
    assert.equal(OlgaEditorProvider.viewType, "modelscript.olgaEditor");
  });

  it("resolves custom text editor and renders Bathymetry, Schematic, and Verification panels", async () => {
    const mockContext: any = {
      extensionUri: vscode.Uri.parse("file:///workspace"),
      subscriptions: [],
    };

    const provider = new OlgaEditorProvider(mockContext);

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
      uri: { toString: () => "file:///workspace/subsea.opi" },
      getText: () => SAMPLE_OPI_XML,
    };

    await provider.resolveCustomTextEditor(mockDoc, mockPanel, {} as any);

    // Verify HTML structure
    assert.ok(mockWebview.html.includes("OLGA Multiphase Flow Assurance Editor"));
    assert.ok(mockWebview.html.includes("Bathymetry Z(X)"));
    assert.ok(mockWebview.html.includes("Schematic P&ID"));
    assert.ok(mockWebview.html.includes("Flow Assurance"));
    assert.ok(mockWebview.html.includes("Thermal & Dosing"));
    assert.ok(mockWebview.html.includes("scrubber-slider"));

    // Verify posted data message
    const updateMsg = postedMessages.find((m) => m.type === "update");
    assert.ok(updateMsg, "Must post update message with model and simulation data");
    assert.equal(updateMsg.data.title, "Subsea Production Flowline");
    assert.equal(updateMsg.data.flowpathsCount, 1);
    assert.equal(updateMsg.data.pipesCount, 2);
    assert.equal(updateMsg.data.nodesCount, 2);
    assert.equal(updateMsg.data.valvesCount, 1);
    assert.equal(updateMsg.data.pigsCount, 1);

    // Verify simulation trajectory
    assert.ok(updateMsg.data.simulation.times.length > 0);
    assert.ok(typeof updateMsg.data.simulation.peakSurgeM3 === "number");

    // Verify verification checks
    assert.ok(typeof updateMsg.data.verification.passed === "boolean");
    assert.ok(updateMsg.data.verification.checks.maopOverpressure);
    assert.ok(updateMsg.data.verification.checks.hydrateAvoidance);

    // Verify thermal cooldown & inhibition
    assert.ok(updateMsg.data.cooldown.noTouchTimeSeconds > 0);
    assert.ok(updateMsg.data.cooldown.uHeatTransfer > 0);
    assert.ok(updateMsg.data.inhibition.megDepressionK > 0);

    // Verify SVG vector graphics
    assert.ok(updateMsg.data.profileSvg.includes("<svg"));
    assert.ok(updateMsg.data.schematicSvg.includes("<svg"));
  });
});
