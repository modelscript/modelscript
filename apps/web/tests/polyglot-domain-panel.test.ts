// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PolyglotDomainPanel } from "../src/components/morsel/panels/PolyglotDomainPanel.js";

describe("PolyglotDomainPanel Render & Variable Scope Integrity", () => {
  it("renders without reference errors for general dialects", () => {
    const html = renderToStaticMarkup(
      React.createElement(PolyglotDomainPanel, {
        dialect: "modelica",
        code: "model Test\n  Real x;\nequation\n  der(x) = 1;\nend Test;",
        colorMode: "dark",
      }),
    );
    assert.ok(html.length > 0, "Should generate HTML output");
    assert.ok(html.includes("MODELICA Model Structure"), "Should display domain label");
  });

  it("renders without reference errors for multibody / URDF models", () => {
    const urdfCode = `
      <robot name="simple_arm">
        <link name="base_link">
          <inertial>
            <mass value="1.0" />
            <origin xyz="0 0 0" />
            <inertia ixx="0.1" iyy="0.1" izz="0.1" />
          </inertial>
        </link>
        <link name="link1" />
        <joint name="joint1" type="revolute">
          <parent link="base_link" />
          <child link="link1" />
          <axis xyz="0 0 1" />
        </joint>
      </robot>
    `;
    const html = renderToStaticMarkup(
      React.createElement(PolyglotDomainPanel, {
        dialect: "urdf",
        code: urdfCode,
        colorMode: "dark",
      }),
    );
    assert.ok(html.includes("URDF Multibody Kinematics"), "Should render multibody domain label");
    assert.ok(html.includes("base_link"), "Should render base_link body");
  });

  it("renders without reference errors for PLCopen / ST automation models", () => {
    const plcCode = `
      PROGRAM MainProgram
        VAR_INPUT
          start_btn : BOOL;
        END_VAR
        VAR_OUTPUT
          motor_on : BOOL;
        END_VAR
        IF start_btn THEN
          motor_on := TRUE;
        END_IF;
      END_PROGRAM
    `;
    const html = renderToStaticMarkup(
      React.createElement(PolyglotDomainPanel, {
        dialect: "plcopen",
        code: plcCode,
        colorMode: "light",
      }),
    );
    assert.ok(html.includes("IEC 61131-3 / PLCopen TC6 Safety"), "Should render PLCopen title");
    assert.ok(html.includes("start_btn"), "Should render input variable");
  });

  it("renders without reference errors for power grid / SPICE circuits", () => {
    const spiceCode = `
      * Simple RC Circuit
      R1 1 2 100
      C1 2 0 1u
      V1 1 0 DC 5
    `;
    const html = renderToStaticMarkup(
      React.createElement(PolyglotDomainPanel, {
        dialect: "spice",
        code: spiceCode,
        colorMode: "dark",
      }),
    );
    assert.ok(html.includes("SPICE Power Grid"), "Should render circuit label");
  });

  it("consumes LSP documentSymbols directly without regex fallback errors", () => {
    const symbols = [
      {
        name: "TestModel",
        kind: 5, // Class
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 15 } },
        children: [
          {
            name: "param_gain",
            detail: "parameter Real",
            kind: 14, // Constant
            value: "10.5",
            range: { start: { line: 1, character: 2 }, end: { line: 1, character: 30 } },
          },
          {
            name: "sensor_input",
            detail: "input Real",
            kind: 13, // Variable
            value: "0.0",
            range: { start: { line: 2, character: 2 }, end: { line: 2, character: 25 } },
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(PolyglotDomainPanel, {
        dialect: "modelscript",
        code: "/* complex multi-line comment */\n",
        colorMode: "dark",
        documentSymbols: symbols,
      }),
    );

    assert.ok(html.includes("param_gain"), "Should include symbol name from documentSymbols");
    assert.ok(html.includes("sensor_input"), "Should include symbol name from documentSymbols");
    assert.ok(html.includes("parameter"), "Should classify variability as parameter");
    assert.ok(html.includes("input"), "Should classify variability as input");
  });

  it("computes BLT causalization, Tarjan SCC, and tearing for coupled algebraic equations", async () => {
    const { analyzeModelBlt } = await import("../src/components/morsel/panels/blt-analysis.js");

    const coupledCode = `
model CoupledCircuit
  Real x;
  Real y;
  Real z;
equation
  der(x) = -x + y;
  y = 2.0 * z;
  z = y - 3.0;
end CoupledCircuit;
    `;

    const lines = coupledCode.split("\n");
    const analysis = analyzeModelBlt(coupledCode, lines, "CoupledCircuit");

    assert.equal(analysis.className, "CoupledCircuit");
    assert.ok(analysis.equations.length >= 3, "Should extract all 3 equations");
    assert.ok(analysis.variables.some((v) => v.name === "x"), "Should extract variable x");
    assert.ok(analysis.variables.some((v) => v.name === "der(x)"), "Should extract derivative der(x)");
    assert.ok(analysis.blocks.length >= 2, "Should partition into ODE state block and algebraic loop block");

    // Check coupled loop detection (y and z form an algebraic loop)
    const loopBlock = analysis.blocks.find((b) => b.isLoop);
    assert.ok(loopBlock, "Should identify the coupled algebraic loop between y and z");
    assert.equal(loopBlock?.size, 2, "Loop dimension should be 2x2");
    assert.ok(loopBlock?.tearing, "Should compute tearing decomposition for loop");
    assert.equal(loopBlock?.tearing?.tearingVars.length, 1, "Should pick 1 tearing iteration variable");
  });

  it("renders world-class BLT visualizer and matrix in PolyglotDomainPanel for Modelica", () => {
    const modelicaCode = `
model RLC
  parameter Real R = 10;
  parameter Real L = 0.1;
  Real i;
  Real v;
equation
  v = R * i;
  der(i) = (10 - v) / L;
end RLC;
    `;

    const html = renderToStaticMarkup(
      React.createElement(PolyglotDomainPanel, {
        dialect: "modelica",
        code: modelicaCode,
        colorMode: "dark",
      }),
    );

    assert.ok(html.includes("BLT Causal Architecture"), "Should render BLT Architecture title");
    assert.ok(html.includes("Incidence Matrix"), "Should render Incidence Matrix header");
    assert.ok(html.includes("Causal Match Pivot"), "Should display Causal Match Pivot legend");
    assert.ok(html.includes("Matrix Sparsity"), "Should render Matrix Sparsity view tab");
    assert.ok(html.includes("Causal Blocks &amp; Tearing") || html.includes("Causal Blocks & Tearing"), "Should render Causal Blocks tab");
    assert.ok(html.includes("Dependency DAG"), "Should render Dependency DAG tab");
    // Assert Pantelides & Kirchhoff is available because der() is in code
    assert.ok(html.includes("Pantelides &amp; Kirchhoff") || html.includes("Pantelides & Kirchhoff"), "Should include Pantelides tab");
    // Assert inappropriate domain tabs are completely hidden
    assert.ok(!html.includes("Power Grid &amp; Y-Bus") && !html.includes("Power Grid & Y-Bus"), "Should hide Power Grid for Modelica");
    assert.ok(!html.includes("Multibody &amp; Mobility") && !html.includes("Multibody & Mobility"), "Should hide Multibody for Modelica");
    assert.ok(!html.includes("CAD B-Rep &amp; FEA") && !html.includes("CAD B-Rep & FEA"), "Should hide CAD B-Rep for Modelica");
  });

  it("dynamically shows appropriate inspector tabs and hides inappropriate ones per opened model", () => {
    // 1. URDF Robot model: should show Multibody, hide BLT and Power Grid
    const urdfHtml = renderToStaticMarkup(
      React.createElement(PolyglotDomainPanel, {
        dialect: "urdf",
        code: `<robot name="arm"><link name="base"/><joint name="j1" type="revolute"><parent link="base"/><child link="l1"/></joint></robot>`,
        colorMode: "dark",
      }),
    );
    assert.ok(urdfHtml.includes("Multibody &amp; Mobility") || urdfHtml.includes("Multibody & Mobility"), "Should show Multibody for URDF");
    assert.ok(!urdfHtml.includes("BLT Causal Architecture"), "Should hide BLT for URDF");
    assert.ok(!urdfHtml.includes("Power Grid &amp; Y-Bus") && !urdfHtml.includes("Power Grid & Y-Bus"), "Should hide Power Grid for URDF");

    // 2. STEP CAD model: should show CAD B-Rep, hide BLT and Multibody
    const stepHtml = renderToStaticMarkup(
      React.createElement(PolyglotDomainPanel, {
        dialect: "step",
        code: `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('STEP CAD'),'2;1');\nDATA;\n#1 = CARTESIAN_POINT('',(0.0,0.0,0.0));\nENDSEC;\nEND-ISO-10303-21;\n`,
        colorMode: "dark",
      }),
    );
    assert.ok(stepHtml.includes("CAD B-Rep &amp; FEA") || stepHtml.includes("CAD B-Rep & FEA"), "Should show CAD B-Rep for STEP");
    assert.ok(!stepHtml.includes("BLT Causal Architecture"), "Should hide BLT for STEP");
    assert.ok(!stepHtml.includes("Multibody &amp; Mobility") && !stepHtml.includes("Multibody & Mobility"), "Should hide Multibody for STEP");

    // 3. PSSE Power Grid model: should show Power Grid, hide BLT and CAD
    const psseHtml = renderToStaticMarkup(
      React.createElement(PolyglotDomainPanel, {
        dialect: "psse",
        code: `0, 100.0 / PSSE RAW\n1, 'BUS_1', 230.0, 1, 1, 1, 1, 1.02, -1.5\n2, 'BUS_2', 138.0, 1, 1, 1, 1, 0.99, -4.2\n0 / END OF BUS DATA\n1, 2, '1', 0.01, 0.05, 0.04, 150.0\n0 / END OF BRANCH DATA\n`,
        colorMode: "dark",
      }),
    );
    assert.ok(psseHtml.includes("Power Grid &amp; Y-Bus") || psseHtml.includes("Power Grid & Y-Bus"), "Should show Power Grid for PSSE");
    assert.ok(!psseHtml.includes("BLT Causal Architecture"), "Should hide BLT for PSSE");
    assert.ok(!psseHtml.includes("CAD B-Rep &amp; FEA") && !psseHtml.includes("CAD B-Rep & FEA"), "Should hide CAD B-Rep for PSSE");
  });
});

