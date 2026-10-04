// SPDX-License-Identifier: AGPL-3.0-or-later

import expect from "expect";
import { describe, it } from "node:test";
import { PolyglotNode, PolyglotTransformer } from "../src/index.js";

describe("TGG Level 2 Semantic Envelope & Mathematical Expression Tests", () => {
  const transformer = new PolyglotTransformer();

  it("should project Level 2 differential rate equations between Modelica and SysML v2", () => {
    // Modelica node with continuous derivative equations
    const modelicaNode: PolyglotNode = {
      name: "RotationalInertia",
      kind: "model",
      attributes: [
        { name: "J", type: "Real", value: "0.05" },
        { name: "b", type: "Real", value: "0.01" },
        { name: "torque", type: "Real" },
        { name: "speed", type: "Real" },
      ],
      ports: [{ name: "flange_a", type: "Flange", acrossVar: "phi", flowVar: "tau", domain: "rotational" }],
      equations: ["der(speed) = (torque - b * speed) / J"],
      constraints: ["speed >= 0.0"],
    };

    // Transform to SysML v2
    const sysmlCode = transformer.transform(modelicaNode, "sysml2");
    expect(sysmlCode).toContain("part def RotationalInertia");
    expect(sysmlCode).toContain("attribute J: Real = 0.05;");
    expect(sysmlCode).toContain("attribute b: Real = 0.01;");
    expect(sysmlCode).toContain("port flange_a: Flange;");
    // Equation and constraint emission
    expect(sysmlCode).toContain("assert constraint { der(speed) = (torque - b * speed) / J }");
    expect(sysmlCode).toContain("assert constraint { speed >= 0.0 }");

    // Reverse projection: SysML v2 node back to Modelica
    const sysmlNode: PolyglotNode = {
      name: "RotationalInertia",
      kind: "part def",
      attributes: [
        { name: "J", type: "Real", value: "0.05" },
        { name: "b", type: "Real", value: "0.01" },
      ],
      ports: [
        { name: "flange_a", type: "Flange", isConjugated: false, acrossVar: "phi", flowVar: "tau" },
        { name: "flange_b", type: "Flange", isConjugated: true, acrossVar: "phi", flowVar: "tau" },
      ],
      equations: ["der(speed) = (torque - b * speed) / J"],
      constraints: ["speed >= 0.0"],
    };

    const modelicaCode = transformer.transform(sysmlNode, "modelica");
    expect(modelicaCode).toContain("model RotationalInertia");
    expect(modelicaCode).toContain("parameter Real J = 0.05;");
    expect(modelicaCode).toContain("Flange flange_a;");
    expect(modelicaCode).toContain("Flange_b flange_b;");
    expect(modelicaCode).toContain("equation");
    expect(modelicaCode).toContain("der(speed) = (torque - b * speed) / J;");
    expect(modelicaCode).toContain('assert(speed >= 0.0, "Constraint violated: speed >= 0.0");');
    expect(modelicaCode).toContain("end RotationalInertia;");
  });

  it("should preserve physical across and flow variables across acausal domains", () => {
    const multiDomainNode: PolyglotNode = {
      name: "ThermoElectricCoupler",
      kind: "model",
      ports: [
        { name: "p_pos", type: "Pin", isConjugated: false, acrossVar: "v", flowVar: "i", domain: "electrical" },
        { name: "p_neg", type: "Pin", isConjugated: true, acrossVar: "v", flowVar: "i", domain: "electrical" },
        {
          name: "th_port",
          type: "HeatPort",
          isConjugated: false,
          acrossVar: "T",
          flowVar: "Q_flow",
          domain: "thermal",
        },
      ],
      components: [
        {
          name: "cells",
          typeSpecifier: "PeltierCell",
          dimensions: "4",
          multiplicity: "4",
          modifications: { alpha: 0.05, R: 1.2 },
        },
      ],
    };

    const sysmlCode = transformer.transform(multiDomainNode, "sysml2");
    expect(sysmlCode).toContain("port p_pos: Pin;");
    expect(sysmlCode).toContain("port p_neg: ~Pin;");
    expect(sysmlCode).toContain("port th_port: HeatPort;");
    expect(sysmlCode).toContain("part cells: PeltierCell[4] {");
    expect(sysmlCode).toContain("attribute alpha = 0.05;");
    expect(sysmlCode).toContain("attribute R = 1.2;");

    // Verify reverse projection to Modelica
    const modelicaCode = transformer.transform(multiDomainNode, "modelica");
    expect(modelicaCode).toContain("Pin p_pos;");
    expect(modelicaCode).toContain("NegativePin p_neg;");
    expect(modelicaCode).toContain("HeatPort th_port;");
    expect(modelicaCode).toContain("PeltierCell cells[4](alpha = 0.05, R = 1.2);");
  });

  it("should handle conjugated port inversion and causality preservation", () => {
    const signalNode: PolyglotNode = {
      name: "ControllerInterface",
      kind: "part def",
      ports: [
        { name: "refSignal", type: "RealInput", direction: "in", isConjugated: false },
        { name: "cmdSignal", type: "RealInput", direction: "in", isConjugated: true }, // conjugated input becomes output
      ],
    };

    const modelicaCode = transformer.transform(signalNode, "modelica");
    expect(modelicaCode).toContain("RealInput refSignal;");
    expect(modelicaCode).toContain("RealOutput cmdSignal;");
  });
});
