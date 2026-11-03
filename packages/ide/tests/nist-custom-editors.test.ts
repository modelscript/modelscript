// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { AmlEditorProvider } from "../src/aml-editor-provider.js";
import { OscalEditorProvider } from "../src/oscal-editor-provider.js";
import { QifEditorProvider } from "../src/qif-editor-provider.js";

const SAMPLE_QIF_XML = `<?xml version="1.0" encoding="utf-8"?>
<QIFDocument xmlns="http://qifstandards.org/xsd/qif3" versionQIF="3.0.0" idMax="20">
  <QPId>550e8400-e29b-41d4-a716-446655440000</QPId>
  <DatumDefinitions>
    <DatumDefinition id="1"><DatumLabel>A</DatumLabel></DatumDefinition>
  </DatumDefinitions>
  <Features>
    <CylinderFeatureNominal id="2" name="Bore_1" nominalSize="25.0" stepEntityId="101" probingPoints="8"/>
  </Features>
  <Characteristics>
    <PositionCharacteristicNominal id="3" name="Pos_Bore_1" toleranceZone="0.05" isDiametrical="true" materialCondition="MMC" featureIds="2" datumReferences="A"/>
  </Characteristics>
  <MeasurementDevices>
    <MeasurementDevice id="4" name="Hexagon_CMM" deviceType="CMM" calibrationUncertainty="0.002"/>
  </MeasurementDevices>
  <MeasuredActuals>
    <GeometricCharacteristicActual id="5" characteristicId="3" partSerialNumber="SN-001" measuredValue="0.02" actualFeatureSize="25.02" status="PASS"/>
  </MeasuredActuals>
</QIFDocument>`;

const SAMPLE_OSCAL_JSON = JSON.stringify({
  "system-security-plan": {
    uuid: "11111111-2222-4333-8444-555555555555",
    metadata: {
      title: "Smart Factory Cell SSP",
      version: "1.0.0",
      "oscal-version": "1.1.2",
    },
    "import-profile": {
      href: "nist-sp-800-82-ot",
    },
    "system-characteristics": {
      "system-name": "NIST Smart Manufacturing Cell",
      "security-sensitivity-level": "moderate",
    },
    "system-implementation": {
      components: [
        {
          uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          type: "plc",
          title: "Safety_Cell_PLC",
          status: { state: "operational" },
        },
      ],
    },
    "control-implementation": {
      description: "OT Control Implementations",
      "implemented-requirements": [
        {
          uuid: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
          "control-id": "sc-7",
          "by-components": [
            {
              "component-uuid": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
              description: "Industrial firewall enforces zone boundary.",
            },
          ],
        },
      ],
    },
  },
});

const SAMPLE_AML_XML = `<?xml version="1.0" encoding="utf-8"?>
<CAEXFile FileName="SmartWorkcell.aml" SchemaVersion="3.0">
  <InstanceHierarchy Name="WorkcellHierarchy">
    <InternalElement Name="ControllerPLC" ID="plc-1" RefBaseSystemUnitPath="SystemUnitClassLib/ControllerUnit">
      <ExternalInterface Name="MotorCmd" ID="p-out" Direction="Out" Category="Signal"/>
    </InternalElement>
    <InternalElement Name="ConveyorDrive" ID="drv-1" RefBaseSystemUnitPath="SystemUnitClassLib/DriveUnit">
      <ExternalInterface Name="SpeedIn" ID="p-in" Direction="In" Category="Signal"/>
    </InternalElement>
    <InternalLink Name="CmdLink" RefPartnerSideA="plc-1:MotorCmd" RefPartnerSideB="drv-1:SpeedIn"/>
  </InstanceHierarchy>
</CAEXFile>`;

describe("NIST Top 3 Custom Visual Editor Providers (QIF, OSCAL, AutomationML)", () => {
  it("resolves QifEditorProvider and renders 3D MBD Heatmap & SPC Capability SVG", async () => {
    assert.equal(QifEditorProvider.viewType, "modelscript.qifEditor");
    const mockContext = { extensionUri: vscode.Uri.parse("file:///workspace"), subscriptions: [] };
    const provider = new QifEditorProvider(mockContext as unknown as vscode.ExtensionContext);
    const posted: any[] = [];
    const mockWebview = {
      options: {},
      html: "",
      postMessage: (m: any) => posted.push(m),
      onDidReceiveMessage: () => ({ dispose: () => {} }),
    };
    const mockPanel = { webview: mockWebview, onDidDispose: () => ({ dispose: () => {} }) };
    const mockDoc = { uri: { toString: () => "file:///workspace/part.qif" }, getText: () => SAMPLE_QIF_XML };

    await provider.resolveCustomTextEditor(
      mockDoc as unknown as vscode.TextDocument,
      mockPanel as unknown as vscode.WebviewPanel,
      {} as vscode.CancellationToken,
    );

    const update = posted.find((m) => m.type === "update");
    assert.ok(update, "Must post update payload for QIF");
    assert.ok(update.heatmapSvg.includes("<svg"), "Must render 3D MBD GD&T heatmap SVG");
    assert.ok(update.spcChartSvg.includes("<svg"), "Must render SPC Cp/Cpk chart SVG");
    assert.ok(update.sysml2Code.includes("package"), "Must project QIF to SysML v2");
  });

  it("resolves OscalEditorProvider and renders Authorization Boundary & Control Matrix SVG", async () => {
    assert.equal(OscalEditorProvider.viewType, "modelscript.oscalEditor");
    const mockContext = { extensionUri: vscode.Uri.parse("file:///workspace"), subscriptions: [] };
    const provider = new OscalEditorProvider(mockContext as unknown as vscode.ExtensionContext);
    const posted: any[] = [];
    const mockWebview = {
      options: {},
      html: "",
      postMessage: (m: any) => posted.push(m),
      onDidReceiveMessage: () => ({ dispose: () => {} }),
    };
    const mockPanel = { webview: mockWebview, onDidDispose: () => ({ dispose: () => {} }) };
    const mockDoc = { uri: { toString: () => "file:///workspace/ssp.oscal.json" }, getText: () => SAMPLE_OSCAL_JSON };

    await provider.resolveCustomTextEditor(
      mockDoc as unknown as vscode.TextDocument,
      mockPanel as unknown as vscode.WebviewPanel,
      {} as vscode.CancellationToken,
    );

    const update = posted.find((m) => m.type === "update");
    assert.ok(update, "Must post update payload for OSCAL");
    assert.ok(update.boundarySvg.includes("<svg"), "Must render OSCAL Authorization Boundary SVG");
    assert.ok(update.matrixSvg.includes("<svg"), "Must render SP 800-53 Family Matrix SVG");
    assert.ok(update.sysml2Code.includes("package"), "Must project OSCAL to SysML v2");
  });

  it("resolves AmlEditorProvider and renders PPR Plant Topology, 3D Workcell & Virtual Commissioning", async () => {
    assert.equal(AmlEditorProvider.viewType, "modelscript.amlEditor");
    const mockContext = { extensionUri: vscode.Uri.parse("file:///workspace"), subscriptions: [] };
    const provider = new AmlEditorProvider(mockContext as unknown as vscode.ExtensionContext);
    const posted: any[] = [];
    const mockWebview = {
      options: {},
      html: "",
      postMessage: (m: any) => posted.push(m),
      onDidReceiveMessage: () => ({ dispose: () => {} }),
    };
    const mockPanel = { webview: mockWebview, onDidDispose: () => ({ dispose: () => {} }) };
    const mockDoc = { uri: { toString: () => "file:///workspace/cell.aml" }, getText: () => SAMPLE_AML_XML };

    await provider.resolveCustomTextEditor(
      mockDoc as unknown as vscode.TextDocument,
      mockPanel as unknown as vscode.WebviewPanel,
      {} as vscode.CancellationToken,
    );

    const update = posted.find((m) => m.type === "update");
    assert.ok(update, "Must post update payload for AutomationML");
    assert.ok(update.topologySvg.includes("<svg"), "Must render AutomationML PPR topology SVG");
    assert.ok(update.workcell3dSvg.includes("<svg"), "Must render 3D workcell frame SVG");
    assert.equal(update.sim.interlockStatus, "OK");
    assert.ok(update.sspXml.includes("SystemStructureDescription"), "Must project AutomationML to SSP");
  });
});
