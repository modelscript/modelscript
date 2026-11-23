// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { enrichDiagramWithEmbeddedPortals } from "../src/services/diagram-service.js";

describe("LSP Nested Embedded 3D Portal Extraction (CAD / FEA / CFD in Modelica)", () => {
  test("extracts CAD, FEA, and CFD annotations into DiagramNode.portal specs", () => {
    const modelicaSource = `
      model ActuatorSystem
        Modelica.Mechanics.MultiBody.Parts.Body housing(m = 2.14)
          annotation(Placement(transformation(extent={{-20,-20},{20,20}})), CAD(uri="cad/housing.step"));
        StructuralFrame bracket
          annotation(Placement(transformation(extent={{40,-20},{80,20}})), FEA(uri="sim/bracket_stress.vtu"));
        CoolingChannel manifold
          annotation(Placement(transformation(extent={{-80,-20},{-40,20}})), CFD(uri="sim/flow_field.vtk"));
        Modelica.Electrical.Analog.Basic.Resistor r1(R=100)
          annotation(Placement(transformation(extent={{-20,40},{20,80}})));
      end ActuatorSystem;
    `;

    const diagramData = {
      nodes: [{ id: "housing" }, { id: "bracket" }, { id: "manifold" }, { id: "r1" }] as {
        id: string;
        portal?: { kind: string; artifactUri: string; animateWithSimulation: boolean };
      }[],
    };

    enrichDiagramWithEmbeddedPortals(diagramData, modelicaSource);

    assert.deepEqual(diagramData.nodes[0]?.portal, {
      kind: "step",
      artifactUri: "cad/housing.step",
      animateWithSimulation: true,
    });
    assert.deepEqual(diagramData.nodes[1]?.portal, {
      kind: "fea",
      artifactUri: "sim/bracket_stress.vtu",
      animateWithSimulation: true,
    });
    assert.deepEqual(diagramData.nodes[2]?.portal, {
      kind: "cfd",
      artifactUri: "sim/flow_field.vtk",
      animateWithSimulation: true,
    });
    assert.equal(diagramData.nodes[3]?.portal, undefined);
  });
});
