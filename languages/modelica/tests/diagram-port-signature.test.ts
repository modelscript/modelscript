// SPDX-License-Identifier: AGPL-3.0-or-later

import { evaluateModelScriptPortCompatibility, type DiagramPortSignature } from "@modelscript/diagram/protocol";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDiagramData, extractModelicaPortSignature } from "../src/diagram/data.js";
import { ModelicaClassKind, ModelicaVariability } from "../src/types.js";

function placement(x: number, y: number) {
  return (name: string) => {
    if (name === "Placement") {
      return {
        transformation: {
          origin: [x, y],
          extent: [
            [-10, -10],
            [10, 10],
          ],
        },
      };
    }
    return null;
  };
}

describe("Modelica extractModelicaPortSignature & buildDiagramData integration", () => {
  it("extracts SI type aliases, flow/stream prefixes, inherited vars, and skips parameters/protected members", () => {
    const electricPotentialType: any = {
      name: "ElectricPotential",
      compositeName: "Modelica.Units.SI.ElectricPotential",
      classKind: ModelicaClassKind.TYPE,
      cstNode: { text: 'type ElectricPotential = Real(quantity="ElectricPotential", unit="V");' },
    };
    const currentType: any = {
      name: "Current",
      compositeName: "Modelica.Units.SI.Current",
      classKind: ModelicaClassKind.TYPE,
      extendsClassInstances: [{ name: "Real" }],
    };

    const basePinClass: any = {
      name: "Pin",
      compositeName: "Custom.BasePin",
      classKind: ModelicaClassKind.CONNECTOR,
      components: [
        {
          name: "v",
          typeSpecifier: "Modelica.Units.SI.ElectricPotential",
          classInstance: electricPotentialType,
        },
        {
          name: "nPhases",
          typeSpecifier: "Integer",
          variability: ModelicaVariability.PARAMETER,
        },
        {
          name: "internalScratch",
          typeSpecifier: "Real",
          isProtected: true,
        },
      ],
    };

    const positivePinClass: any = {
      name: "PositivePin",
      compositeName: "Custom.PositivePin",
      classKind: ModelicaClassKind.CONNECTOR,
      extendsClassInstances: [basePinClass],
      components: [
        {
          name: "i",
          typeSpecifier: "Modelica.Units.SI.Current",
          flowPrefix: "flow",
          classInstance: currentType,
        },
      ],
    };

    const sig = extractModelicaPortSignature({
      name: "p",
      classInstance: positivePinClass,
    });

    assert.ok(sig);
    assert.equal(sig.isExpandable, undefined);
    assert.deepEqual(sig.variables, [
      { name: "v", type: "Real", flowKind: "potential", direction: "inout" },
      { name: "i", type: "Real", flowKind: "flow", direction: "inout" },
    ]);
  });

  it("extracts stream variables and expandable connectors accurately", () => {
    const fluidPortClass: any = {
      name: "FluidPort_a",
      classKind: ModelicaClassKind.CONNECTOR,
      components: [
        { name: "p", typeSpecifier: "Real" },
        { name: "m_flow", typeSpecifier: "Real", flowPrefix: "flow" },
        { name: "h_outflow", typeSpecifier: "Real", flowPrefix: "stream" },
      ],
    };
    const fluidSig = extractModelicaPortSignature({ name: "port_a", classInstance: fluidPortClass });
    assert.ok(fluidSig);
    assert.deepEqual(
      fluidSig.variables.map((v) => `${v.flowKind}:${v.name}:${v.type}`),
      ["potential:p:Real", "flow:m_flow:Real", "stream:h_outflow:Real"],
    );

    const busClass: any = {
      name: "ControlBus",
      classKind: ModelicaClassKind.EXPANDABLE_CONNECTOR,
      components: [],
    };
    const busSig = extractModelicaPortSignature({ name: "bus", classInstance: busClass });
    assert.ok(busSig);
    assert.equal(busSig.isExpandable, true);
  });

  it("emits portSignature on sub-component ports and isInsideConnector on top-level connector nodes in buildDiagramData", async () => {
    const realInputClass: any = {
      name: "RealInput",
      compositeName: "Modelica.Blocks.Interfaces.RealInput",
      classKind: ModelicaClassKind.CONNECTOR,
      cstNode: { text: "connector RealInput = input Real;" },
      components: [],
    };
    const realOutputClass: any = {
      name: "RealOutput",
      compositeName: "Modelica.Blocks.Interfaces.RealOutput",
      classKind: ModelicaClassKind.CONNECTOR,
      cstNode: { text: "connector RealOutput = output Real;" },
      components: [],
    };
    const gainClass: any = {
      name: "Gain",
      compositeName: "Modelica.Blocks.Math.Gain",
      classKind: ModelicaClassKind.BLOCK,
      components: [
        { name: "u", classInstance: realInputClass, annotation: placement(-100, 0) },
        { name: "y", classInstance: realOutputClass, annotation: placement(100, 0) },
      ],
    };
    const enclosingModel: any = {
      name: "SubBlock",
      classKind: ModelicaClassKind.BLOCK,
      components: [
        { name: "u", classInstance: realInputClass, annotation: placement(-80, 0) },
        { name: "gain", classInstance: gainClass, annotation: placement(0, 0) },
        { name: "y", classInstance: realOutputClass, annotation: placement(80, 0) },
      ],
    };

    const diagram = await buildDiagramData(enclosingModel);
    const uNode = diagram.nodes.find((n) => n.id === "u");
    const gainNode = diagram.nodes.find((n) => n.id === "gain");
    const yNode = diagram.nodes.find((n) => n.id === "y");

    assert.ok(uNode && gainNode && yNode);

    const uSig = (uNode.data as Record<string, unknown> | undefined)?.["portSignature"] as
      DiagramPortSignature | undefined;
    const ySig = (yNode.data as Record<string, unknown> | undefined)?.["portSignature"] as
      DiagramPortSignature | undefined;
    const gainPorts = Array.isArray(gainNode.ports) ? gainNode.ports : (gainNode.ports?.items ?? []);
    const gainU = gainPorts.find((p) => p.id === "u");
    const gainY = gainPorts.find((p) => p.id === "y");

    assert.ok(uSig?.isInsideConnector);
    assert.ok(ySig?.isInsideConnector);
    assert.ok(gainU?.portSignature);
    assert.ok(gainY?.portSignature);

    // Inside input `u` -> component input `gain.u` is valid (Modelica §9.3)
    assert.equal(
      evaluateModelScriptPortCompatibility(
        { nodeId: "u", portId: "u", portSignature: uSig },
        { nodeId: "gain", portId: "u", portSignature: gainU.portSignature },
        { languageId: "modelica" },
      ).compatible,
      true,
    );

    // Inside input `u` -> component output `gain.y` is invalid
    assert.equal(
      evaluateModelScriptPortCompatibility(
        { nodeId: "u", portId: "u", portSignature: uSig },
        { nodeId: "gain", portId: "y", portSignature: gainY.portSignature },
        { languageId: "modelica" },
      ).compatible,
      false,
    );

    // Component output `gain.y` -> inside output `y` is valid
    assert.equal(
      evaluateModelScriptPortCompatibility(
        { nodeId: "gain", portId: "y", portSignature: gainY.portSignature },
        { nodeId: "y", portId: "y", portSignature: ySig },
        { languageId: "modelica" },
      ).compatible,
      true,
    );
  });

  it("differentiates Modelica.Fluid ports with incompatible redeclared Medium packages", () => {
    const fluidPortClass: any = {
      name: "FluidPort_a",
      classKind: ModelicaClassKind.CONNECTOR,
      components: [
        { name: "p", typeSpecifier: "Real" },
        { name: "m_flow", typeSpecifier: "Real", flowPrefix: "flow" },
        { name: "h_outflow", typeSpecifier: "Real", flowPrefix: "stream" },
      ],
    };

    const waterOwner: any = {
      name: "waterPipe",
      cstNode: {
        text: "Modelica.Fluid.Pipes.StaticPipe waterPipe(redeclare package Medium = Modelica.Media.Water.StandardWater);",
      },
    };
    const airOwner: any = {
      name: "airPipe",
      cstNode: {
        text: "Modelica.Fluid.Pipes.StaticPipe airPipe(redeclare package Medium = Modelica.Media.Air.SimpleAir);",
      },
    };
    const waterValveOwner: any = {
      name: "waterValve",
      cstNode: {
        text: "Modelica.Fluid.Valves.ValveLinear waterValve(redeclare package Medium = Modelica.Media.Water.StandardWater);",
      },
    };

    const waterSig = extractModelicaPortSignature({ name: "port_b", classInstance: fluidPortClass }, waterOwner);
    const airSig = extractModelicaPortSignature({ name: "port_a", classInstance: fluidPortClass }, airOwner);
    const valveSig = extractModelicaPortSignature({ name: "port_a", classInstance: fluidPortClass }, waterValveOwner);

    assert.equal(waterSig?.redeclarePackages?.["Medium"], "Modelica.Media.Water.StandardWater");
    assert.equal(airSig?.redeclarePackages?.["Medium"], "Modelica.Media.Air.SimpleAir");

    const waterVsAir = evaluateModelScriptPortCompatibility(
      { nodeId: "waterPipe", portId: "port_b", portSignature: waterSig },
      { nodeId: "airPipe", portId: "port_a", portSignature: airSig },
      { languageId: "modelica" },
    );
    assert.equal(waterVsAir.compatible, false);
    assert.equal(waterVsAir.rule, "structural-signature-mismatch");
    assert.match(waterVsAir.reason ?? "", /Incompatible Medium/);

    const waterVsWater = evaluateModelScriptPortCompatibility(
      { nodeId: "waterPipe", portId: "port_b", portSignature: waterSig },
      { nodeId: "waterValve", portId: "port_a", portSignature: valveSig },
      { languageId: "modelica" },
    );
    assert.equal(waterVsWater.compatible, true);
    assert.equal(waterVsWater.rule, "structural-signature-match");
  });
});
