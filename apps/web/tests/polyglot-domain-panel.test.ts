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
});
