// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  extractExperimentAnnotation,
  synthesizeModelSource,
} from "../src/pages/class-detail/hooks/useClassSimulation.js";

describe("Package Model Simulation Tab — Suitability & Logic", () => {
  it("extracts experiment annotations from Modelica source correctly", () => {
    const code = `
      model ChuaCircuit
        parameter Real R = 12.5;
        Real v1(start = 0.1);
        Real v2(start = 0.0);
      equation
        der(v1) = (v2 - v1) / R;
        annotation(experiment(StartTime = 0.0, StopTime = 25.0, Interval = 0.05, Tolerance = 1e-5));
      end ChuaCircuit;
    `;

    const exp = extractExperimentAnnotation(code);
    assert.strictEqual(exp.startTime, 0.0);
    assert.strictEqual(exp.stopTime, 25.0);
    assert.strictEqual(exp.tolerance, 1e-5);
    assert.strictEqual(exp.numberOfIntervals, 500); // 25.0 / 0.05 = 500
  });

  it("handles missing or partial experiment annotations safely", () => {
    const code = `
      model SimpleOscillator
        Real x(start = 1.0);
      equation
        der(x) = -x;
      end SimpleOscillator;
    `;

    const exp = extractExperimentAnnotation(code);
    assert.strictEqual(exp.startTime, undefined);
    assert.strictEqual(exp.stopTime, undefined);
    assert.strictEqual(exp.numberOfIntervals, undefined);
  });

  it("synthesizes valid model source when sourceCode is missing", () => {
    const mockCls: any = {
      classKind: "model",
      components: [
        { component_name: "x", type_name: "Real", variability: "continuous" },
        { component_name: "k", type_name: "Real", variability: "parameter" },
      ],
      equations: ["der(x) = -k * x", "k = 2.0"],
    };

    const synthesized = synthesizeModelSource(mockCls, "TestPkg.Models.Decay");
    assert.match(synthesized, /model Decay/);
    assert.match(synthesized, /Real x;/);
    assert.match(synthesized, /parameter Real k;/);
    assert.match(synthesized, /der\(x\) = -k \* x;/);
    assert.match(synthesized, /end Decay;/);
  });

  it("preserves exact existing sourceCode when available", () => {
    const original = "model Custom\n  Real y;\nequation\n  y = 42;\nend Custom;";
    const mockCls: any = {
      classKind: "model",
      sourceCode: original,
      components: [],
      equations: [],
    };

    const synthesized = synthesizeModelSource(mockCls, "Custom");
    assert.strictEqual(synthesized, original);
  });

  it("correctly identifies simulatable models vs non-simulatable building blocks", () => {
    // Suitability check helper mimicking ClassDetailView logic
    function isModelSimulatable(cls: any, className: string): boolean {
      const kind = (cls.classKind || "").toLowerCase();
      if (kind !== "model" && kind !== "block" && kind !== "class") return false;
      if (kind.includes("partial")) return false;

      const hasExperiment = Boolean(cls.sourceCode && /\bexperiment\s*\(/i.test(cls.sourceCode));
      const isExample = Boolean(
        className.includes(".Examples.") ||
        className.includes(".Tests.") ||
        className.endsWith("Example") ||
        className.endsWith("Test"),
      );

      const connectors = (cls.components || []).filter(
        (c: any) => c.causality === "connector" || c.type_name?.includes("Pin"),
      );
      const hasEquations = (cls.equations && cls.equations.length > 0) || (cls.components && cls.components.length > 0);

      if (connectors.length > 0 && !hasExperiment && !isExample) {
        return false;
      }

      return (hasExperiment || isExample || connectors.length === 0) && hasEquations;
    }

    // 1. Concrete Example Model with experiment -> SIMULATABLE
    const chuaModel = {
      classKind: "model",
      sourceCode: "model ChuaCircuit ... annotation(experiment(StopTime=10)); end ChuaCircuit;",
      components: [{ component_name: "R", type_name: "Real", variability: "parameter" }],
      equations: ["der(v1) = (v2-v1)/R;"],
    };
    assert.strictEqual(isModelSimulatable(chuaModel, "Modelica.Electrical.Analog.Examples.ChuaCircuit"), true);

    // 2. Component Resistor with open pins -> NOT SIMULATABLE (requires testbench)
    const resistor = {
      classKind: "model",
      sourceCode: "model Resistor ... Pin p, n; ... end Resistor;",
      components: [
        { component_name: "p", type_name: "Pin", causality: "connector" },
        { component_name: "n", type_name: "Pin", causality: "connector" },
      ],
      equations: ["v = p.v - n.v;"],
    };
    assert.strictEqual(isModelSimulatable(resistor, "Modelica.Electrical.Analog.Basic.Resistor"), false);

    // 3. Partial Model -> NOT SIMULATABLE
    const partialModel = {
      classKind: "partial model",
      sourceCode: "partial model TwoPin ... end TwoPin;",
      components: [],
      equations: [],
    };
    assert.strictEqual(isModelSimulatable(partialModel, "Modelica.Electrical.Analog.Interfaces.TwoPin"), false);

    // 4. Connector -> NOT SIMULATABLE
    const pin = {
      classKind: "connector",
      sourceCode: "connector Pin ... end Pin;",
      components: [],
      equations: [],
    };
    assert.strictEqual(isModelSimulatable(pin, "Modelica.Electrical.Analog.Interfaces.Pin"), false);

    // 5. Closed Model without connectors -> SIMULATABLE
    const closedSystem = {
      classKind: "model",
      sourceCode: "model FreeFall Real h(start=100); equation der(h) = -9.81 * time; end FreeFall;",
      components: [{ component_name: "h", type_name: "Real", variability: "continuous" }],
      equations: ["der(h) = -9.81 * time;"],
    };
    assert.strictEqual(isModelSimulatable(closedSystem, "Physics.Mechanics.FreeFall"), true);
  });
});
