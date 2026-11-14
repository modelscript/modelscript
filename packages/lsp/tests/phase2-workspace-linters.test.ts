// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { lintAutomationMLWorkspace } from "../../../languages/automationml/dist/src/index.js";
import { lintAutosarWorkspace } from "../../../languages/autosar/dist/src/index.js";
import { lintOscalWorkspace } from "../../../languages/oscal/dist/src/index.js";
import { lintPlcopenWorkspace } from "../../../languages/plcopen/dist/src/index.js";
import { lintSimulinkWorkspace } from "../../../languages/simulink/dist/src/index.js";
import { lintSspWorkspace } from "../../../languages/ssp/dist/src/index.js";

test("Phase 2: SSP workspace linter resolves FMU/SSV component sources", () => {
  const ssd = `<SystemStructureDescription version="1.0" name="Sys"><System name="Root"><Elements><Component name="Plant" source="plant/modelDescription.xml"/></Elements></System></SystemStructureDescription>`;
  const ok = new Map([
    ["SystemStructure.ssd", ssd],
    ["plant/modelDescription.xml", `<fmiModelDescription fmiVersion="2.0" modelName="Plant"/>`],
  ]);
  assert.equal(
    lintSspWorkspace(ok, "SystemStructure.ssd").filter((d) => d.rule === "unresolved-ssp-component-source").length,
    0,
  );

  const bad = new Map([["SystemStructure.ssd", ssd]]);
  assert.ok(lintSspWorkspace(bad, "SystemStructure.ssd").some((d) => d.rule === "unresolved-ssp-component-source"));
});

test("Phase 2: OSCAL workspace linter resolves import href and checks catalog control IDs", () => {
  const cat = JSON.stringify({
    catalog: {
      uuid: "11111111-2222-4333-8444-555555555555",
      metadata: { title: "Cat", version: "1.0" },
      controls: [{ id: "ac-3", title: "Access Enforcement" }],
    },
  });
  const sspOk = JSON.stringify({
    "system-security-plan": {
      uuid: "22222222-2222-4333-8444-555555555555",
      metadata: { title: "SSP", version: "1.0" },
      "import-profile": { href: "cat.json" },
      "control-implementation": {
        "implemented-requirements": [{ uuid: "33333333-2222-4333-8444-555555555555", "control-id": "ac-3" }],
      },
    },
  });
  assert.equal(
    lintOscalWorkspace(
      new Map([
        ["cat.json", cat],
        ["ssp.json", sspOk],
      ]),
    ).filter((d) => d.code === "O3001" || d.code === "O3002").length,
    0,
  );

  const sspBad = JSON.stringify({
    "system-security-plan": {
      uuid: "22222222-2222-4333-8444-555555555555",
      metadata: { title: "SSP", version: "1.0" },
      "import-profile": { href: "missing-profile.json" },
      "control-implementation": {
        "implemented-requirements": [{ uuid: "33333333-2222-4333-8444-555555555555", "control-id": "zz-99" }],
      },
    },
  });
  const diags = lintOscalWorkspace(
    new Map([
      ["cat.json", cat],
      ["ssp.json", sspBad],
    ]),
  );
  assert.ok(diags.some((d) => d.rule === "unresolved-oscal-href"));
  assert.ok(diags.some((d) => d.rule === "unknown-oscal-control-id"));
});

test("Phase 2: AUTOSAR workspace linter resolves cross-file ARXML *-REF targets", () => {
  const iface = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>Interfaces</SHORT-NAME><ELEMENTS><SENDER-RECEIVER-INTERFACE><SHORT-NAME>SpeedIF</SHORT-NAME></SENDER-RECEIVER-INTERFACE></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
  const swcOk = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>SWC</SHORT-NAME><ELEMENTS><R-PORT-PROTOTYPE><SHORT-NAME>RpSpeed</SHORT-NAME><REQUIRED-INTERFACE-TREF DEST="SENDER-RECEIVER-INTERFACE">/Interfaces/SpeedIF</REQUIRED-INTERFACE-TREF></R-PORT-PROTOTYPE></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
  assert.equal(
    lintAutosarWorkspace(
      new Map([
        ["if.arxml", iface],
        ["swc.arxml", swcOk],
      ]),
    ).filter((d) => d.rule === "unresolved-autosar-ref").length,
    0,
  );

  const swcBad = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>SWC</SHORT-NAME><ELEMENTS><R-PORT-PROTOTYPE><SHORT-NAME>RpSpeed</SHORT-NAME><REQUIRED-INTERFACE-TREF DEST="SENDER-RECEIVER-INTERFACE">/Interfaces/MissingIF</REQUIRED-INTERFACE-TREF></R-PORT-PROTOTYPE></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
  assert.ok(
    lintAutosarWorkspace(
      new Map([
        ["if.arxml", iface],
        ["swc.arxml", swcBad],
      ]),
    ).some((d) => d.rule === "unresolved-autosar-ref"),
  );
});

test("Phase 2: AutomationML workspace linter resolves ExternalReference and library class paths", () => {
  const lib = `<CAEXFile FileName="lib.aml" SchemaVersion="2.15"><RoleClassLib Name="BaseLib"><RoleClass Name="Actuator"/></RoleClassLib></CAEXFile>`;
  const topOk = `<CAEXFile FileName="top.aml" SchemaVersion="2.15"><ExternalReference Path="lib.aml" Alias="BaseLib"/><InstanceHierarchy Name="IH"><InternalElement Name="M1" RefBaseSystemUnitPath="BaseLib/Actuator"/></InstanceHierarchy></CAEXFile>`;
  assert.equal(
    lintAutomationMLWorkspace(
      new Map([
        ["lib.aml", lib],
        ["top.aml", topOk],
      ]),
    ).filter((d) => d.code.startsWith("AM30")).length,
    0,
  );

  const topBad = `<CAEXFile FileName="top.aml" SchemaVersion="2.15"><ExternalReference Path="missing.aml" Alias="M"/><InstanceHierarchy Name="IH"><InternalElement Name="M1" RefBaseSystemUnitPath="BaseLib/UnknownRole"/></InstanceHierarchy></CAEXFile>`;
  const diags = lintAutomationMLWorkspace(
    new Map([
      ["lib.aml", lib],
      ["top.aml", topBad],
    ]),
  );
  assert.ok(diags.some((d) => d.rule === "unresolved-aml-external-reference"));
  assert.ok(diags.some((d) => d.rule === "unresolved-aml-class-path"));
});

test("Phase 2: PLCopen workspace linter resolves cross-file derived POU types", () => {
  const lib = `<project xmlns="http://www.plcopen.org/xml/tc6_0201"><fileHeader companyName="X" productName="P" productVersion="1" creationDateTime="2026-01-01T00:00:00"/><contentHeader name="Lib"/><types><dataTypes/><pous><pou name="ValveCtrl" pouType="functionBlock"><interface/></pou></pous></types></project>`;
  const mainOk = `<project xmlns="http://www.plcopen.org/xml/tc6_0201"><fileHeader companyName="X" productName="P" productVersion="1" creationDateTime="2026-01-01T00:00:00"/><contentHeader name="Main"/><types><dataTypes/><pous><pou name="Main" pouType="program"><interface><localVars><variable name="v1"><type><derived name="ValveCtrl"/></type></variable></localVars></interface></pou></pous></types></project>`;
  assert.equal(
    lintPlcopenWorkspace(
      new Map([
        ["lib.xml", lib],
        ["main.xml", mainOk],
      ]),
    ).filter((d) => d.rule === "unresolved-plcopen-derived-type").length,
    0,
  );

  const mainBad = mainOk.replace("ValveCtrl", "MissingFB");
  assert.ok(
    lintPlcopenWorkspace(
      new Map([
        ["lib.xml", lib],
        ["main.xml", mainBad],
      ]),
    ).some((d) => d.rule === "unresolved-plcopen-derived-type"),
  );
});

test("Phase 2: Simulink workspace linter resolves ModelReference and DataDictionary targets", () => {
  const sub = `<ModelInformation><Model Name="Controller"><System/></Model></ModelInformation>`;
  const topOk = `<ModelInformation><Model Name="Top"><P Name="DataDictionary">params.sldd</P><System><Block BlockType="ModelReference" Name="Ctrl"><P Name="ModelName">Controller</P></Block></System></Model></ModelInformation>`;
  assert.equal(
    lintSimulinkWorkspace(
      new Map([
        ["Top.slx", topOk],
        ["Controller.slx", sub],
        ["params.sldd", "{}"],
      ]),
    ).filter((d) => d.code.startsWith("SL30")).length,
    0,
  );

  const topBad = `<ModelInformation><Model Name="Top"><P Name="DataDictionary">missing.sldd</P><System><Block BlockType="ModelReference" Name="Ctrl"><P Name="ModelName">MissingModel</P></Block></System></Model></ModelInformation>`;
  const diags = lintSimulinkWorkspace(new Map([["Top.slx", topBad]]));
  assert.ok(diags.some((d) => d.rule === "unresolved-simulink-modelref"));
  assert.ok(diags.some((d) => d.rule === "unresolved-simulink-sldd"));
});
