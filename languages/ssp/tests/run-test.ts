// SPDX-License-Identifier: AGPL-3.0-or-later

import { createZipArchive, defaultContainerToolkit, extractContainerArchive } from "@modelscript/runtime";
import { sspLanguage } from "../src/language.js";
import { lintSsd } from "../src/linter.js";
import { sspToModelicaBlock } from "../src/projection.js";
import { parseSsd, parseSsv } from "../src/ssd-parser.js";

async function main() {
  console.log("Starting @modelscript/ssp and Container Toolkit Verification...");

  const ssdXml = `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"
                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"
                                name="DualDriveController"
                                version="1.0"
                                description="Closed loop dual-drive vehicle control system">
  <ssd:System name="DualDriveController">
    <ssd:Connectors>
      <ssd:Connector name="throttle_in" kind="input">
        <ssc:Real unit="percent" />
      </ssd:Connector>
      <ssd:Connector name="steering_in" kind="input">
        <ssc:Real unit="rad" />
      </ssd:Connector>
      <ssd:Connector name="torque_left_out" kind="output">
        <ssc:Real unit="N.m" />
      </ssd:Connector>
      <ssd:Connector name="torque_right_out" kind="output">
        <ssc:Real unit="N.m" />
      </ssd:Connector>
      <ssd:Connector name="gain" kind="parameter">
        <ssc:Real />
      </ssd:Connector>
    </ssd:Connectors>
    <ssd:Elements>
      <ssd:Component name="MotorLeft" source="resources/Motor.fmu">
        <ssd:Connectors>
          <ssd:Connector name="u" kind="input"><ssc:Real /></ssd:Connector>
          <ssd:Connector name="tau" kind="output"><ssc:Real /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="MotorRight" source="resources/Motor.fmu">
        <ssd:Connectors>
          <ssd:Connector name="u" kind="input"><ssc:Real /></ssd:Connector>
          <ssd:Connector name="tau" kind="output"><ssc:Real /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
    </ssd:Elements>
    <ssd:Connections>
      <ssd:Connection startElement="MotorLeft" startConnector="tau" endElement="DualDriveController" endConnector="torque_left_out" />
    </ssd:Connections>
  </ssd:System>
</ssd:SystemStructureDescription>`;

  const ssvXml = `<?xml version="1.0" encoding="UTF-8"?>
<ssv:ParameterSet xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues"
                  version="1.0"
                  name="DefaultParams">
  <ssv:Parameters>
    <ssv:Parameter name="maxTorque">
      <ssv:Real value="350.0" />
    </ssv:Parameter>
    <ssv:Parameter name="enableRegen">
      <ssv:Boolean value="true" />
    </ssv:Parameter>
    <ssv:Parameter name="gearCount">
      <ssv:Integer value="2" />
    </ssv:Parameter>
  </ssv:Parameters>
</ssv:ParameterSet>`;

  // 1. Test SSD / SSV Parsing
  const system = parseSsd(ssdXml);
  if (system.name !== "DualDriveController") throw new Error(`Unexpected system name: ${system.name}`);
  if (system.connectors?.length !== 5) throw new Error(`Unexpected connector count: ${system.connectors?.length}`);
  if (system.components.length !== 2) throw new Error(`Unexpected component count: ${system.components.length}`);

  const ssvParams = parseSsv(ssvXml);
  if (ssvParams.length !== 3) throw new Error(`Unexpected ssv param count: ${ssvParams.length}`);
  const maxTorque = ssvParams.find((p) => p.name === "maxTorque");
  if (maxTorque?.value !== 350.0) throw new Error(`Unexpected maxTorque: ${maxTorque?.value}`);
  console.log("✓ SSD and SSV parser tests passed");

  // 2. Test Modelica Projection
  const modelicaBlock = sspToModelicaBlock(ssdXml, { sspFilePath: "DualDrive.ssp" });
  if (!modelicaBlock.includes("block DualDriveController")) throw new Error("Modelica block name missing");
  if (!modelicaBlock.includes('input Real throttle_in(unit="percent")')) throw new Error("Input throttle_in missing");
  if (!modelicaBlock.includes('output Real torque_left_out(unit="N.m")'))
    throw new Error("Output torque_left_out missing");
  if (!modelicaBlock.includes('__modelscript_external(type="ssp", file="DualDrive.ssp")'))
    throw new Error("External annotation missing");
  console.log("✓ Modelica Block Projection test passed");

  // 3. Test Container Extraction & In-Memory ZIP Pipeline
  const sspZip = createZipArchive({
    "SystemStructure.ssd": ssdXml,
    "resources/DefaultParams.ssv": ssvXml,
    "resources/Motor.fmu": new Uint8Array([1, 2, 3, 4, 5]),
  });
  if (!sspLanguage.container) throw new Error("Missing sspLanguage container definition");
  const extractResult = await extractContainerArchive(sspZip, sspLanguage.container, defaultContainerToolkit);
  if (!extractResult) throw new Error("Container extraction returned null");
  if (extractResult.manifest?.path !== "SystemStructure.ssd") throw new Error("Manifest path mismatch");
  if (extractResult.entries?.length !== 3) throw new Error("Entry count mismatch");

  const fmuEntry = extractResult.entries.find((e) => e.path === "resources/Motor.fmu");
  if (fmuEntry?.action !== "extract_nested") throw new Error("Nested FMU action mismatch");

  const projected = extractResult.project?.("modelica");
  if (!projected || !projected.includes("block DualDriveController"))
    throw new Error("Projection from container failed");
  console.log("✓ Container extraction & projection test passed");

  // 4. Test Semantic Linter & Narrow Attribute Value Ranges
  const cleanDiags = lintSsd(ssdXml);
  if (cleanDiags.length !== 0) {
    throw new Error(`Expected 0 diagnostics on valid SSD, got: ${JSON.stringify(cleanDiags)}`);
  }

  const invalidSsd = `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription name="BrokenSys" version="1.0">
  <ssd:System name="BrokenSys">
    <ssd:Elements>
      <ssd:Component name="Ctrl" source="resources/Ctrl.fmu">
        <ssd:Connectors>
          <ssd:Connector name="cmd" kind="output"><ssc:Real /></ssd:Connector>
          <ssd:Connector name="cmd" kind="output"><ssc:Real /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="Plant" source="resources/Plant.fmu">
        <ssd:Connectors>
          <ssd:Connector name="enable" kind="input"><ssc:Boolean /></ssd:Connector>
          <ssd:Connector name="y" kind="output"><ssc:Real /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
    </ssd:Elements>
    <ssd:Connections>
      <ssd:Connection startElement="GhostComp" startConnector="cmd" endElement="Plant" endConnector="enable" />
      <ssd:Connection startElement="Ctrl" startConnector="missingPort" endElement="Plant" endConnector="enable" />
      <ssd:Connection startElement="Ctrl" startConnector="cmd" endElement="Plant" endConnector="enable" />
      <ssd:Connection startElement="Ctrl" startConnector="cmd" endElement="Plant" endConnector="y" />
    </ssd:Connections>
  </ssd:System>
  <ssd:DefaultExperiment startTime="10.0" stopTime="5.0" />
</ssd:SystemStructureDescription>`;

  const diags = lintSsd(invalidSsd);
  const findByCode = (code: string) => diags.find((d) => d.code === code);

  const dupConn = findByCode("SSP_DUPLICATE_CONNECTOR");
  if (!dupConn || invalidSsd.slice(dupConn.startOffset, dupConn.endOffset) !== "cmd") {
    throw new Error(`Expected narrow 'cmd' range for SSP_DUPLICATE_CONNECTOR, got: ${JSON.stringify(dupConn)}`);
  }

  const unresolvedEl = findByCode("SSP_UNRESOLVED_ELEMENT");
  if (!unresolvedEl || invalidSsd.slice(unresolvedEl.startOffset, unresolvedEl.endOffset) !== "GhostComp") {
    throw new Error(
      `Expected narrow 'GhostComp' range for SSP_UNRESOLVED_ELEMENT, got: ${JSON.stringify(unresolvedEl)}`,
    );
  }

  const unresolvedConn = findByCode("SSP_UNRESOLVED_CONNECTOR");
  if (!unresolvedConn || invalidSsd.slice(unresolvedConn.startOffset, unresolvedConn.endOffset) !== "missingPort") {
    throw new Error(
      `Expected narrow 'missingPort' range for SSP_UNRESOLVED_CONNECTOR, got: ${JSON.stringify(unresolvedConn)}`,
    );
  }

  const typeMismatch = findByCode("SSP_CONNECTOR_TYPE_MISMATCH");
  if (!typeMismatch || invalidSsd.slice(typeMismatch.startOffset, typeMismatch.endOffset) !== "enable") {
    throw new Error(
      `Expected narrow 'enable' range for SSP_CONNECTOR_TYPE_MISMATCH, got: ${JSON.stringify(typeMismatch)}`,
    );
  }

  const causalConflict = findByCode("SSP_CONNECTOR_CAUSALITY_CONFLICT");
  if (!causalConflict || invalidSsd.slice(causalConflict.startOffset, causalConflict.endOffset) !== "y") {
    throw new Error(
      `Expected narrow 'y' range for SSP_CONNECTOR_CAUSALITY_CONFLICT, got: ${JSON.stringify(causalConflict)}`,
    );
  }

  const expBounds = findByCode("SSP_INVALID_EXPERIMENT_BOUNDS");
  if (!expBounds || invalidSsd.slice(expBounds.startOffset, expBounds.endOffset) !== "5.0") {
    throw new Error(`Expected narrow '5.0' range for SSP_INVALID_EXPERIMENT_BOUNDS, got: ${JSON.stringify(expBounds)}`);
  }

  // 5. Test SSV Semantic Linter & Narrow Attribute Value Ranges
  const { lintSsv } = await import("../src/linter.js");
  if (lintSsv(ssvXml).length !== 0) {
    throw new Error("Expected 0 diagnostics on valid SSV XML");
  }

  const invalidSsv = `<?xml version="1.0" encoding="UTF-8"?>
<ssv:ParameterSet version="1.0" name="BrokenParams">
  <ssv:Parameters>
    <ssv:Parameter name="gain"><ssv:Real value="1.5" /></ssv:Parameter>
    <ssv:Parameter name="gain"><ssv:Real value="not_a_float" /></ssv:Parameter>
    <ssv:Parameter name="count"><ssv:Integer value="3.14" /></ssv:Parameter>
    <ssv:Parameter name="flag"><ssv:Boolean value="maybe" /></ssv:Parameter>
    <ssv:Parameter name="untyped"></ssv:Parameter>
  </ssv:Parameters>
</ssv:ParameterSet>`;

  const ssvDiags = lintSsv(invalidSsv);
  const findSsv = (code: string) => ssvDiags.find((d) => d.code === code);

  const dupParam = findSsv("SSV_DUPLICATE_PARAMETER");
  if (!dupParam || invalidSsv.slice(dupParam.startOffset, dupParam.endOffset) !== "gain") {
    throw new Error(`Expected narrow 'gain' range for SSV_DUPLICATE_PARAMETER, got: ${JSON.stringify(dupParam)}`);
  }

  const badReal = findSsv("SSV_INVALID_REAL_VALUE");
  if (!badReal || invalidSsv.slice(badReal.startOffset, badReal.endOffset) !== "not_a_float") {
    throw new Error(`Expected narrow 'not_a_float' range for SSV_INVALID_REAL_VALUE, got: ${JSON.stringify(badReal)}`);
  }

  const badInt = findSsv("SSV_INVALID_INTEGER_VALUE");
  if (!badInt || invalidSsv.slice(badInt.startOffset, badInt.endOffset) !== "3.14") {
    throw new Error(`Expected narrow '3.14' range for SSV_INVALID_INTEGER_VALUE, got: ${JSON.stringify(badInt)}`);
  }

  const badBool = findSsv("SSV_INVALID_BOOLEAN_VALUE");
  if (!badBool || invalidSsv.slice(badBool.startOffset, badBool.endOffset) !== "maybe") {
    throw new Error(`Expected narrow 'maybe' range for SSV_INVALID_BOOLEAN_VALUE, got: ${JSON.stringify(badBool)}`);
  }

  const missingType = findSsv("SSV_MISSING_PARAMETER_TYPE");
  if (!missingType || invalidSsv.slice(missingType.startOffset, missingType.endOffset) !== "untyped") {
    throw new Error(
      `Expected narrow 'untyped' range for SSV_MISSING_PARAMETER_TYPE, got: ${JSON.stringify(missingType)}`,
    );
  }
  console.log("✓ SSP & SSV semantic linter & narrow XML attribute range tests passed");

  // 6. Test Native SSP 2D Diagram Builder & Bidirectional XML Writeback
  const { applySspDiagramEdits, applySspTextEdits, buildSspDiagramData, getSspPaletteCategories } =
    await import("../src/diagram.js");
  const ssdWithGeometry = `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"
                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"
                                name="GeoSys" version="1.0">
  <ssd:System name="GeoSys">
    <ssd:SystemGeometry x1="-200" y1="-200" x2="600" y2="400" />
    <ssd:Connectors>
      <ssd:Connector name="sys_in" kind="input">
        <ssc:Real />
        <ssd:ConnectorGeometry x="0.0" y="0.5" />
      </ssd:Connector>
    </ssd:Connectors>
    <ssd:Elements>
      <ssd:Component name="Ctrl" source="resources/Ctrl.fmu">
        <ssd:ElementGeometry x1="50" y1="60" x2="230" y2="160" rotation="0" />
        <ssd:Connectors>
          <ssd:Connector name="u" kind="input"><ssc:Real /></ssd:Connector>
          <ssd:Connector name="y" kind="output"><ssc:Real /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="Plant" source="resources/Plant.fmu">
        <ssd:Connectors>
          <ssd:Connector name="in1" kind="input"><ssc:Real /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
    </ssd:Elements>
    <ssd:Connections>
      <ssd:Connection startElement="Ctrl" startConnector="y" endElement="Plant" endConnector="in1">
        <ssd:ConnectionGeometry pointsX="240 300" pointsY="110 110" />
      </ssd:Connection>
    </ssd:Connections>
  </ssd:System>
</ssd:SystemStructureDescription>`;

  const diagramData = buildSspDiagramData(ssdWithGeometry);
  if (diagramData.nodes.length < 3) {
    throw new Error(`Expected at least 3 nodes (2 components + 1 system port), got ${diagramData.nodes.length}`);
  }
  const ctrlNode = diagramData.nodes.find((n) => n.id === "Ctrl");
  if (!ctrlNode || ctrlNode.x !== 50 || ctrlNode.y !== 60 || ctrlNode.width !== 180 || ctrlNode.height !== 100) {
    throw new Error(`Unexpected Ctrl node geometry: ${JSON.stringify(ctrlNode)}`);
  }
  if (diagramData.edges.length !== 1 || diagramData.edges[0].vertices?.length !== 2) {
    throw new Error(`Unexpected SSP diagram edges: ${JSON.stringify(diagramData.edges)}`);
  }

  // Test move edit writeback
  const moveEdits = applySspDiagramEdits(ssdWithGeometry, [{ action: "move", name: "Ctrl", x: 120, y: 140 }]);
  const movedXml = applySspTextEdits(ssdWithGeometry, moveEdits);
  const movedData = buildSspDiagramData(movedXml);
  const movedCtrl = movedData.nodes.find((n) => n.id === "Ctrl");
  if (!movedCtrl || movedCtrl.x !== 120 || movedCtrl.y !== 140) {
    throw new Error(`Expected Ctrl moved to (120, 140), got (${movedCtrl?.x}, ${movedCtrl?.y})`);
  }

  // Test addComponent + connect writeback
  const addEdits = applySspDiagramEdits(movedXml, [
    { action: "addComponent", className: "FMUComponent", x: 320, y: 180 },
    {
      action: "connect",
      sourceComponent: "",
      sourcePort: "sys_in",
      targetComponent: "Ctrl",
      targetPort: "u",
    },
  ]);
  const withAddedXml = applySspTextEdits(movedXml, addEdits);
  const addedData = buildSspDiagramData(withAddedXml);
  if (!addedData.nodes.some((n) => n.id === "FMUComponent")) {
    throw new Error(`Expected newly added FMUComponent in SSP diagram, got: ${addedData.nodes.map((n) => n.id)}`);
  }
  if (addedData.edges.length !== 2) {
    throw new Error(`Expected 2 connections after connect edit, got ${addedData.edges.length}`);
  }

  const palette = getSspPaletteCategories();
  if (palette.length === 0) throw new Error("Expected non-empty SSP palette categories");
  console.log("✓ Native SSP 2D diagram builder & bidirectional XML writeback tests passed");

  console.log("ALL TESTS PASSED SUCCESSFULLY! ✨");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
