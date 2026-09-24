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
      startByte: 10,
      endByte: 50,
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
      startByte: 60,
      endByte: 100,
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
      startByte: 110,
      endByte: 140,
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
});
