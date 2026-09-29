// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { parseTerminalsAndIcons } from "../src/fmu/model-description.js";

console.log("=== Running FMI-LS-TI Terminals XML Parser Tests ===");

// 1. Standard FMI-LS-TI XML with Fluid, Thermal, and Electrical Terminals
const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<fmiTerminalsAndIcons fmiVersion="3.0">
  <Terminals>
    <Terminal name="port_a" terminalKind="org.modelica.types.fluid.FluidPort_a" matchingRule="fluid" description="Inlet fluid port">
      <TerminalMemberVariable variableName="port_a.p" memberName="p" variableKind="potential" />
      <TerminalMemberVariable variableName="port_a.m_flow" memberName="m_flow" variableKind="flow" />
      <TerminalMemberVariable variableName="port_a.h_outflow" memberName="h_outflow" variableKind="stream" />
      <Position x1="-110" y1="10" x2="-90" y2="30" />
    </Terminal>
    <Terminal name="port_b" terminalKind="org.modelica.types.fluid.FluidPort_b" matchingRule="fluid" description="Outlet fluid port">
      <TerminalMemberVariable variableName="port_b.p" memberName="p" variableKind="potential" />
      <TerminalMemberVariable variableName="port_b.m_flow" memberName="m_flow" variableKind="flow" />
      <TerminalMemberVariable variableName="port_b.h_outflow" memberName="h_outflow" variableKind="stream" />
      <Position x1="90" y1="-30" x2="110" y2="-10" />
    </Terminal>
    <Terminal name="heatPort" terminalKind="org.modelica.types.thermal.HeatPort_a" description="Thermal boundary port">
      <TerminalMemberVariable variableName="heatPort.T" memberName="T" variableKind="potential" />
      <TerminalMemberVariable variableName="heatPort.Q_flow" memberName="Q_flow" variableKind="flow" />
    </Terminal>
    <Terminal name="pin_pos" terminalKind="org.modelica.types.electrical.PositivePin">
      <TerminalMemberVariable variableName="pin_pos.v" memberName="v" variableKind="potential" />
      <TerminalMemberVariable variableName="pin_pos.i" memberName="i" variableKind="flow" />
    </Terminal>
  </Terminals>
  <TerminalsGraphicalRepresentation>
    <TerminalGraphicalRepresentation terminalName="heatPort">
      <Position x1="-10" y1="90" x2="10" y2="110" />
    </TerminalGraphicalRepresentation>
    <TerminalGraphicalRepresentation terminalName="pin_pos">
      <Position x="-100" y="-50" />
    </TerminalGraphicalRepresentation>
  </TerminalsGraphicalRepresentation>
</fmiTerminalsAndIcons>`;

const terminals = parseTerminalsAndIcons(sampleXml);

assert.strictEqual(terminals.length, 4, "Should parse 4 terminals");

// Verify port_a (FluidPort_a)
const portA = terminals.find((t) => t.name === "port_a");
assert.ok(portA, "port_a should exist");
assert.strictEqual(portA.terminalKind, "org.modelica.types.fluid.FluidPort_a");
assert.strictEqual(portA.matchingRule, "fluid");
assert.strictEqual(portA.description, "Inlet fluid port");
assert.strictEqual(portA.memberVariables.length, 3);
assert.deepStrictEqual(portA.memberVariables[0], {
  variableName: "port_a.p",
  memberName: "p",
  variableKind: "potential",
});
assert.deepStrictEqual(portA.memberVariables[1], {
  variableName: "port_a.m_flow",
  memberName: "m_flow",
  variableKind: "flow",
});
assert.deepStrictEqual(portA.memberVariables[2], {
  variableName: "port_a.h_outflow",
  memberName: "h_outflow",
  variableKind: "stream",
});
assert.ok(portA.graphicalRepresentation, "port_a should have graphicalRepresentation");
assert.strictEqual(portA.graphicalRepresentation?.x1, -110);
assert.strictEqual(portA.graphicalRepresentation?.y1, 10);
assert.strictEqual(portA.graphicalRepresentation?.x2, -90);
assert.strictEqual(portA.graphicalRepresentation?.y2, 30);

// Verify heatPort graphical representation from external TerminalsGraphicalRepresentation
const heatPort = terminals.find((t) => t.name === "heatPort");
assert.ok(heatPort, "heatPort should exist");
assert.strictEqual(heatPort.terminalKind, "org.modelica.types.thermal.HeatPort_a");
assert.strictEqual(heatPort.memberVariables.length, 2);
assert.ok(heatPort.graphicalRepresentation, "heatPort should have graphical representation from external section");
assert.strictEqual(heatPort.graphicalRepresentation?.x1, -10);
assert.strictEqual(heatPort.graphicalRepresentation?.y1, 90);
assert.strictEqual(heatPort.graphicalRepresentation?.x2, 10);
assert.strictEqual(heatPort.graphicalRepresentation?.y2, 110);

// Verify pin_pos with center x, y
const pinPos = terminals.find((t) => t.name === "pin_pos");
assert.ok(pinPos, "pin_pos should exist");
assert.strictEqual(pinPos.graphicalRepresentation?.x, -100);
assert.strictEqual(pinPos.graphicalRepresentation?.y, -50);

// 2. Empty / invalid XML handling
assert.deepStrictEqual(parseTerminalsAndIcons(""), []);
assert.deepStrictEqual(parseTerminalsAndIcons("not xml"), []);
assert.deepStrictEqual(parseTerminalsAndIcons("<root></root>"), []);

console.log("✓ All FMI-LS-TI Terminals XML Parser tests passed successfully!");
