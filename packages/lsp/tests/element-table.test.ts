// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry, SymbolIndex } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ElementTableEngine } from "../src/rtm/elementTableEngine.js";

describe("SysML v2 Element Table & Attribute Rewriting Engine", () => {
  it("should provide standardized column definitions for Part, Action, Port, and State", () => {
    const partCols = ElementTableEngine.getColumnDefinitions("part");
    assert.ok(partCols.some((c) => c.id === "name"));
    assert.ok(partCols.some((c) => c.id === "type" && c.editable));
    assert.ok(partCols.some((c) => c.id === "mass" && c.editable));

    const portCols = ElementTableEngine.getColumnDefinitions("port");
    assert.ok(portCols.some((c) => c.id === "direction" && c.type === "select"));
    assert.ok(portCols.some((c) => c.id === "isConjugated" && c.type === "boolean"));

    const actionCols = ElementTableEngine.getColumnDefinitions("action");
    assert.ok(actionCols.some((c) => c.id === "behaviorType"));

    const stateCols = ElementTableEngine.getColumnDefinitions("state");
    assert.ok(stateCols.some((c) => c.id === "isParallel" && c.type === "boolean"));
  });

  it("should extract elements from a SymbolIndex into tabular rows", () => {
    const mockSymbols = new Map<number, SymbolEntry>();

    mockSymbols.set(1, {
      id: 1,
      name: "Vehicle.engine",
      ruleName: "PartUsage",
      resourceId: "file:///workspace/vehicle.sysml",
      startOffset: 10,
      endOffset: 50,
      metadata: {
        typeName: "CombustionEngine",
        multiplicity: "1",
        mass: "180 [kg]",
        power: "150 [kW]",
      },
    });

    mockSymbols.set(2, {
      id: 2,
      name: "Vehicle.transmission",
      ruleName: "PartUsage",
      resourceId: "file:///workspace/vehicle.sysml",
      startOffset: 60,
      endOffset: 100,
      metadata: {
        typeName: "AutomaticGearbox",
        multiplicity: "1",
        mass: "75 [kg]",
      },
    });

    mockSymbols.set(3, {
      id: 3,
      name: "Vehicle.controlPort",
      ruleName: "PortUsage",
      resourceId: "file:///workspace/vehicle.sysml",
      startOffset: 110,
      endOffset: 140,
      metadata: {
        portType: "CanBusPort",
        direction: "inout",
      },
    });

    const mockIndex: SymbolIndex = {
      symbols: mockSymbols,
      byName: new Map(),
      childrenOf: new Map(),
    };

    const table = ElementTableEngine.buildElementsTable(mockIndex, "part");
    assert.strictEqual(table.totalCount, 2);
    assert.strictEqual(table.rows[0].name, "engine");
    assert.strictEqual(table.rows[0].type, "CombustionEngine");
    assert.strictEqual(table.rows[0].mass, "180 [kg]");
    assert.strictEqual(table.rows[1].name, "transmission");

    const portTable = ElementTableEngine.buildElementsTable(mockIndex, "port");
    assert.strictEqual(portTable.totalCount, 1);
    assert.strictEqual(portTable.rows[0].name, "controlPort");
    assert.strictEqual(portTable.rows[0].direction, "inout");
  });

  it("should synthesize text edits to update an element attribute inside a block", () => {
    const sysmlText = `package Powertrain {
    part engine : CombustionEngine {
        attribute mass = 150 [kg];
        attribute power = 120 [kW];
    }
}`;

    // Update existing attribute mass
    const edits = ElementTableEngine.updateElementAttribute(sysmlText, "Powertrain.engine", "mass", "185 [kg]");

    assert.ok(edits.length === 1);
    assert.ok(edits[0].newText.includes("attribute mass = 185 [kg];"));

    // Add new attribute cost to engine
    const addEdits = ElementTableEngine.updateElementAttribute(sysmlText, "Powertrain.engine", "cost", "4500 [USD]");

    assert.ok(addEdits.length === 1);
    assert.ok(addEdits[0].newText.includes("attribute cost = 4500 [USD];"));
  });

  it("should provide context-sensitive cell completions", () => {
    const mockSymbols = new Map<number, SymbolEntry>();
    mockSymbols.set(1, {
      id: 1,
      name: "HydraulicActuator",
      ruleName: "PartDefinition",
    });

    const mockIndex: SymbolIndex = {
      symbols: mockSymbols,
      byName: new Map(),
      childrenOf: new Map(),
    };

    // Completing type with prefix "Hyd"
    const typeComps = ElementTableEngine.getTableCellCompletions(mockIndex, "part", "type", "Hyd");
    assert.ok(typeComps.some((c) => c.label === "HydraulicActuator"));

    // Completing direction
    const dirComps = ElementTableEngine.getTableCellCompletions(mockIndex, "port", "direction", "in");
    assert.ok(dirComps.some((c) => c.label === "in"));
    assert.ok(dirComps.some((c) => c.label === "inout"));

    // Completing unit with prefix "k"
    const unitComps = ElementTableEngine.getTableCellCompletions(mockIndex, "part", "unit", "k");
    assert.ok(unitComps.some((c) => c.label === "[kg]"));
    assert.ok(unitComps.some((c) => c.label === "[kW]"));
  });

  it("should validate table cell inputs", () => {
    const validUnit = ElementTableEngine.validateTableCell("mass", "25.4 [kg]");
    assert.strictEqual(validUnit.valid, true);

    const invalidUnit = ElementTableEngine.validateTableCell("mass", "25.4 [kg");
    assert.strictEqual(invalidUnit.valid, false);
    assert.ok(invalidUnit.error?.includes("Unbalanced unit brackets"));

    const validBool = ElementTableEngine.validateTableCell("isComposite", "true");
    assert.strictEqual(validBool.valid, true);

    const invalidBool = ElementTableEngine.validateTableCell("isComposite", "maybe");
    assert.strictEqual(invalidBool.valid, false);
  });

  it("should bridge declarative DSL TabularConfig into ElementsTablePayload and TextEdits", async () => {
    const reqCols = ElementTableEngine.getColumnDefinitions("reqif");
    assert.ok(reqCols.some((c) => c.id === "identifier" && !c.editable));
    assert.ok(reqCols.some((c) => c.id === "contract" && c.editable));
    assert.ok(reqCols.some((c) => c.id === "asilLevel" && c.type === "select"));

    const { reqifTabularConfig } = await import("@modelscript/reqif/tabular");
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-01" LONG-NAME="Brake Torque" ASIL="ASIL-C" STATUS="Proposed">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING>
              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>AD-TEXT</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
              <THE-VALUE>The brake controller shall satisfy torque &lt;= 420 N*m.</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

    const payload = ElementTableEngine.buildFromTabularConfig(
      reqifTabularConfig,
      sampleXml,
      "requirements",
      "file:///safety.reqif",
    );
    assert.strictEqual(payload.totalCount, 1);
    assert.strictEqual(payload.rows[0]?.qualifiedName, "REQ-01");
    assert.strictEqual(payload.rows[0]?.attributes.asilLevel, "ASIL-C");

    const edits = ElementTableEngine.updateFromTabularConfig(
      reqifTabularConfig,
      sampleXml,
      "requirements",
      "REQ-01",
      "asilLevel",
      "ASIL-D",
    );
    assert.ok(edits && edits.length === 1);
    assert.ok(edits[0]?.newText.includes("ASIL-D"));

    // Verify SysML v2 TabularConfig execution & writeback
    const { sysml2TabularConfig } = await import("../../../languages/sysml2/src/tabular.js");
    const sysmlSrc = `package Powertrain {\n  part engine : Engine {\n    attribute mass = 150 [kg];\n  }\n}`;
    const sysmlTable = ElementTableEngine.buildFromTabularConfig(sysml2TabularConfig, sysmlSrc, "parts");
    assert.strictEqual(sysmlTable.totalCount, 1);
    assert.strictEqual(sysmlTable.rows[0]?.mass, "150 [kg]");
    const sysmlEdits = ElementTableEngine.updateFromTabularConfig(
      sysml2TabularConfig,
      sysmlSrc,
      "parts",
      "engine",
      "mass",
      "175 [kg]",
    );
    assert.ok(sysmlEdits.length === 1);
    assert.strictEqual(sysmlEdits[0]?.newText, "175 [kg]");

    // Verify SSP TabularConfig execution & writeback
    const { sspTabularConfig } = await import("@modelscript/ssp");
    const ssdSrc = `<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription" name="Drive" version="1.0">
  <ssd:System name="Root">
    <ssd:Elements>
      <ssd:Component name="Motor" source="resources/Motor.fmu" type="application/x-fmu-sharedlibrary"/>
    </ssd:Elements>
  </ssd:System>
</ssd:SystemStructureDescription>`;
    const sspTable = ElementTableEngine.buildFromTabularConfig(sspTabularConfig, ssdSrc, "components");
    assert.strictEqual(sspTable.totalCount, 1);
    assert.strictEqual(sspTable.rows[0]?.source, "resources/Motor.fmu");
    const sspEdits = ElementTableEngine.updateFromTabularConfig(
      sspTabularConfig,
      ssdSrc,
      "components",
      "Motor",
      "source",
      "resources/MotorV2.fmu",
    );
    assert.ok(sspEdits.length === 1);
    assert.ok(sspEdits[0]?.newText.includes("resources/MotorV2.fmu"));
  });
});
