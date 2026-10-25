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
    let messageHandler: ((msg: any) => Promise<void>) | null = null;
    const mockWebview: any = {
      options: {},
      html: "",
      postMessage: (msg: any) => {
        postedMessages.push(msg);
      },
      onDidReceiveMessage: (handler: any) => {
        messageHandler = handler;
        return { dispose: () => {} };
      },
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

    // Verify HTML structure with all new tabs & What-If modal
    assert.ok(mockWebview.html.includes("OLGA Multiphase Flow Assurance Editor"));
    assert.ok(mockWebview.html.includes("Bathymetry Z(X)"));
    assert.ok(mockWebview.html.includes("Schematic P&ID"));
    assert.ok(mockWebview.html.includes("Plots & Trends"), "Must include Plots & Trends tab");
    assert.ok(mockWebview.html.includes("PVT Envelope"), "Must include PVT Envelope tab");
    assert.ok(mockWebview.html.includes("Wellbore & IPR"), "Must include Wellbore & IPR tab");
    assert.ok(mockWebview.html.includes("Slugging & Surge"), "Must include Slugging & Surge tab");
    assert.ok(mockWebview.html.includes("Flow Assurance"));
    assert.ok(mockWebview.html.includes("Thermal & Dosing"));
    assert.ok(mockWebview.html.includes("Tuning & Match"), "Must include Tuning & Match tab");
    assert.ok(mockWebview.html.includes("tuningTab"), "Must include tuningTab view");
    assert.ok(mockWebview.html.includes("safetyGateCard"), "Must include safetyGateCard banner");
    assert.ok(mockWebview.html.includes("Save Checkpoint"), "Must include Save Checkpoint action");
    assert.ok(mockWebview.html.includes("What-If Scratchpad"), "Must include What-If Scratchpad modal");
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

    // Verify verification checks & safety gate
    assert.ok(typeof updateMsg.data.verification.passed === "boolean");
    assert.ok(updateMsg.data.verification.checks.maopOverpressure);
    assert.ok(updateMsg.data.verification.checks.hydrateAvoidance);
    assert.ok(updateMsg.data.safetyGate, "Must include safetyGate evaluation in update payload");
    assert.ok(typeof updateMsg.data.safetyGate.passed === "boolean");

    // Verify thermal cooldown & inhibition
    assert.ok(updateMsg.data.cooldown.noTouchTimeSeconds > 0);
    assert.ok(updateMsg.data.cooldown.uHeatTransfer > 0);
    assert.ok(updateMsg.data.inhibition.megDepressionK > 0);

    // Verify SVG vector graphics for all views
    assert.ok(updateMsg.data.profileSvg.includes("<svg"));
    assert.ok(updateMsg.data.schematicSvg.includes("<svg"));
    assert.ok(updateMsg.data.pvtSvg.includes("<svg"), "Must generate PVT Phase Envelope SVG");
    assert.ok(updateMsg.data.wellboreSvg.includes("<svg"), "Must generate Wellbore IPR SVG");
    assert.ok(updateMsg.data.slugSvg.includes("<svg"), "Must generate Slug Statistics SVG");

    // Verify simulateWhatIf message handling
    assert.ok(messageHandler, "Message handler must be registered");
    await (messageHandler as any)({
      type: "simulateWhatIf",
      whatIf: { chokeOpening: 0.35, massRateFactor: 0.8 },
    });
    const whatIfMsg = postedMessages.filter((m) => m.type === "update").pop();
    assert.ok(whatIfMsg.data.whatIfSimulation, "Must include whatIfSimulation in update after perturbation");
    assert.ok(whatIfMsg.data.whatIfSimulation.times.length > 0);

    // Verify runCalibration message handling
    await (messageHandler as any)({
      type: "runCalibration",
      csvText: `TIME,PT_INLET,PT_ARRIVAL,TM_ARRIVAL,QLT\n0.0,14000000,3000000,295.15,35.0\n10.0,14100000,3050000,294.85,35.2\n`,
      parameters: ["roughness", "choke-cd"],
      maxEvaluations: 10,
    });
    const calibMsg = postedMessages.find((m) => m.type === "calibrationResult");
    assert.ok(calibMsg, "Must post calibrationResult message");
    assert.ok(calibMsg.data.evaluations > 0);
    assert.ok(Array.isArray(calibMsg.data.calibratedParameters));

    // Verify Compositional Flash & Phase Envelope Studio in PVT Tab
    assert.ok(mockWebview.html.includes("compositionalFlashPanel"), "Must include compositionalFlashPanel");
    assert.ok(mockWebview.html.includes("pvtPresetSelect"), "Must include pvtPresetSelect");
    assert.ok(mockWebview.html.includes("pvtEosModel"), "Must include pvtEosModel");
    assert.ok(mockWebview.html.includes("flashPressureInput"), "Must include flashPressureInput");
    assert.ok(mockWebview.html.includes("flashTempInput"), "Must include flashTempInput");
    assert.ok(mockWebview.html.includes("btnRunFlash"), "Must include btnRunFlash");
    assert.ok(mockWebview.html.includes("btnTraceEnvelope"), "Must include btnTraceEnvelope");
    assert.ok(mockWebview.html.includes("btnBindPvt"), "Must include btnBindPvt");

    // Verify flashPTComposition message handling
    await (messageHandler as any)({
      type: "flashPTComposition",
      pressureBar: 60,
      temperatureC: 35,
      modelType: "PENG_ROBINSON",
      composition: { C1: 0.8, C2: 0.1, C3: 0.1 },
    });
    const flashMsg = postedMessages.find((m) => m.type === "flashResult");
    assert.ok(flashMsg, "Must post flashResult message");
    assert.equal(flashMsg.data.pressureBar, 60);
    assert.ok(typeof flashMsg.data.vaporFraction === "number");
    assert.ok(flashMsg.data.gas.densityKgM3 > 0);

    // Verify tracePhaseEnvelope message handling
    await (messageHandler as any)({
      type: "tracePhaseEnvelope",
      modelType: "PENG_ROBINSON",
      composition: { C1: 0.8, C2: 0.1, C3: 0.1 },
    });
    const envMsg = postedMessages.find((m) => m.type === "phaseEnvelopeResult");
    assert.ok(envMsg, "Must post phaseEnvelopeResult message");
    assert.ok(envMsg.data.bubblePoints.length > 0);
    assert.ok(envMsg.data.dewPoints.length > 0);
    assert.ok(envMsg.data.cricondenbar.pressurePa > 0);
  });

  it("resolves custom text editor for multi-axis .tpl trend curves and activates plots tab", async () => {
    const mockContext: any = {
      extensionUri: vscode.Uri.parse("file:///workspace"),
      subscriptions: [],
    };
    const provider = new OlgaEditorProvider(mockContext);
    const postedMessages: any[] = [];
    const mockWebview: any = {
      options: {},
      html: "",
      postMessage: (msg: any) => postedMessages.push(msg),
      onDidReceiveMessage: () => ({ dispose: () => {} }),
    };
    const mockPanel: any = {
      webview: mockWebview,
      onDidDispose: () => ({ dispose: () => {} }),
    };

    const SAMPLE_TPL_TEXT = `'Subsea Flowline Trend'
CATALOG
1 'TIME' 'S' ''
2 'PT:INLET' 'PA' 'Inlet Pressure'
3 'PT:OUTLET' 'PA' 'Outlet Pressure'
4 'TM:OUTLET' 'C' 'Arrival Temperature'
5 'HOL:OUTLET' '-' 'Liquid Holdup'
DATA
 0.0000E+00  1.4000E+07  3.0000E+06  6.5000E+01  1.5000E-01
 1.0000E+02  1.4200E+07  3.0500E+06  6.4200E+01  1.6000E-01
 2.0000E+02  1.4500E+07  3.1000E+06  6.3500E+01  1.7000E-01
`;

    const mockDoc: any = {
      uri: { toString: () => "file:///workspace/cases/transient.tpl" },
      getText: () => SAMPLE_TPL_TEXT,
    };

    await provider.resolveCustomTextEditor(mockDoc, mockPanel, {} as any);

    assert.ok(mockWebview.html.includes("plotsVariablesContainer"), "Must include plotsVariablesContainer");
    const updateMsg = postedMessages.find((m) => m.type === "update");
    assert.ok(updateMsg, "Must post update message for .tpl");
    assert.equal(updateMsg.data.mode, "tpl");
    assert.ok(updateMsg.data.trendDataset, "Must include parsed trendDataset");
    assert.equal(updateMsg.data.trendDataset.variables.length, 4);
    assert.equal(updateMsg.data.trendDataset.times.length, 3);
    assert.equal(updateMsg.data.trendDataset.variables[0].id, "PT:INLET");
    assert.equal(updateMsg.data.trendDataset.variables[0].name, "PT:INLET");
    assert.equal(updateMsg.data.trendDataset.variables[0].unit, "PA");
  });

  it("resolves custom text editor for spatial profile .ppl snapshots and activates profile tab", async () => {
    const mockContext: any = {
      extensionUri: vscode.Uri.parse("file:///workspace"),
      subscriptions: [],
    };
    const provider = new OlgaEditorProvider(mockContext);
    const postedMessages: any[] = [];
    const mockWebview: any = {
      options: {},
      html: "",
      postMessage: (msg: any) => postedMessages.push(msg),
      onDidReceiveMessage: () => ({ dispose: () => {} }),
    };
    const mockPanel: any = {
      webview: mockWebview,
      onDidDispose: () => ({ dispose: () => {} }),
    };

    const SAMPLE_PPL_TEXT = `'Subsea Flowline Profile'
'BRANCH_1'
CATALOG
1 'X' 'M' 'Coordinate'
2 'PT' 'PA' 'Pressure'
3 'TM' 'C' 'Temperature'
4 'HOL' '-' 'Liquid Holdup'
5 'ID' '-' 'Flow Regime'
PROFILE 0.0000E+00
   0.0000E+00  1.4000E+07  6.5000E+01  1.5000E-01  1.0000E+00
1000.0000E+00  1.1000E+07  5.5000E+01  2.0000E-01  1.0000E+00
2000.0000E+00  8.0000E+06  4.5000E+01  2.5000E-01  2.0000E+00
3000.0000E+00  3.0000E+06  3.5000E+01  3.0000E-01  3.0000E+00
PROFILE 1.0000E+02
   0.0000E+00  1.4200E+07  6.4000E+01  1.6000E-01  1.0000E+00
1000.0000E+00  1.1200E+07  5.4000E+01  2.1000E-01  1.0000E+00
2000.0000E+00  8.1000E+06  4.4000E+01  2.6000E-01  2.0000E+00
3000.0000E+00  3.0500E+06  3.4000E+01  3.1000E-01  3.0000E+00
`;

    const mockDoc: any = {
      uri: { toString: () => "file:///workspace/cases/flowline.ppl" },
      getText: () => SAMPLE_PPL_TEXT,
    };

    await provider.resolveCustomTextEditor(mockDoc, mockPanel, {} as any);
    const updateMsg = postedMessages.find((m) => m.type === "update");
    assert.ok(updateMsg, "Must post update message for .ppl");
    assert.equal(updateMsg.data.mode, "ppl");
    assert.ok(updateMsg.data.profileDataset, "Must include parsed profileDataset");
    assert.equal(updateMsg.data.profileDataset.snapshots.length, 2);
    assert.equal(updateMsg.data.simulation.profilesCount, 2);
    assert.ok(updateMsg.data.profileSvg.includes("<svg"), "Must render Bathymetry/Profile SVG");
  });
});
