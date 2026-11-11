// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeInspectorSubTabs, PolyglotDomainPanel } from "../src/components/morsel/panels/PolyglotDomainPanel.js";
import { analyzeModelBlt } from "../src/components/morsel/panels/blt-analysis.js";
import { analyzeBiochemStoichiometry } from "../src/components/morsel/panels/inspectors/BiochemInspector.js";
import { analyzeCaeContinuum } from "../src/components/morsel/panels/inspectors/CaeContinuumInspector.js";
import { analyzeDaePhysics } from "../src/components/morsel/panels/inspectors/DaeAdvancedInspector.js";
import { analyzeMultibodyKinematics } from "../src/components/morsel/panels/inspectors/MultibodyInspector.js";
import { indexLocalSymbolLines } from "../src/components/morsel/panels/modelica-scanner.js";

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

  it("short-circuits rendering and heavy analysis when isVisible is false", () => {
    const html = renderToStaticMarkup(
      React.createElement(PolyglotDomainPanel, {
        dialect: "modelica",
        code: "model HiddenModel\n  Real x;\nequation\n  der(x) = -x;\nend HiddenModel;",
        colorMode: "dark",
        isVisible: false,
      }),
    );
    assert.equal(html, "", "Hidden inspector should render nothing and skip computation");
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

  it("computes balanced BLT causalization, Tarjan SCC, and tearing for coupled ODE + algebraic loops", () => {
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
    assert.equal(analysis.equations.length, 3, "Should extract exact 3 scalar equations");
    assert.equal(analysis.variables.length, 3, "Should have 3 algebraic/derivative unknowns (der(x), y, z)");
    assert.ok(
      analysis.stateVariables.some((v) => v.name === "x"),
      "Should record x as a differentiated state",
    );
    assert.ok(
      analysis.variables.some((v) => v.name === "der(x)"),
      "Should extract derivative der(x) as solved unknown",
    );
    assert.equal(analysis.diagnostics.status, "balanced", "3 equations / 3 unknowns must be balanced (DOF = 0)");
    assert.equal(analysis.diagnostics.degreesOfFreedom, 0);
    assert.equal(analysis.blocks.length, 2, "Should partition into algebraic loop block and ODE state block");

    const loopBlock = analysis.blocks.find((b) => b.isLoop);
    assert.ok(loopBlock, "Should identify the coupled algebraic loop between y and z");
    assert.equal(loopBlock?.size, 2, "Loop dimension should be 2x2");
    assert.ok(loopBlock?.tearing, "Should compute tearing decomposition for loop");
    assert.equal(loopBlock?.tearing?.tearingVars.length, 1, "Should pick 1 tearing iteration variable");
  });

  it("ignores HTML Documentation prose, comments, annotations, final parameters, and component modifiers", () => {
    const realFftLikeCode = `
model RealFFT1 "Example with rich HTML documentation and subcomponent modifiers"
  parameter Real f_max = 50 "Maximum frequency of interest";
  parameter Real f_max_factor = 5 "Safety factor";
  final parameter Real THD = 0.02 "Total harmonic distortion = 2%";
  Modelica.Blocks.Sources.Sine sin1(f = 5, amplitude = 2) annotation(Placement(transformation(extent={{-80,20},{-60,40}})));
  Real u_filtered(unit="V");
  Real x_state(start = 0, fixed = true);
equation
  /* Multi-line comment with fake equation:
     fake_var = 123;
  */
  // Single-line comment: another_fake = 456;
  u_filtered = 2.0 * x_state;
  der(x_state) = -f_max * x_state + u_filtered;
  annotation (
    experiment(StopTime = 1.0, Interval = 0.001),
    Documentation(info="<html>
<p>
We
to acquire <code>n&nbsp;= 2*f_max*f_max_factor</code> samples in order to avoid aliasing.
For n points in the buffer,
In id mode we compute <code>y = sin(2*pi*f*t)</code>.
</p>
</html>")
  );
end RealFFT1;
    `;

    const analysis = analyzeModelBlt(realFftLikeCode, realFftLikeCode.split("\n"));
    const varNames = analysis.variables.map((v) => v.name);
    const eqTexts = analysis.equations.map((e) => e.text);

    assert.ok(!varNames.includes("to"), "Must not extract prose word 'to' from HTML docs");
    assert.ok(!varNames.includes("n"), "Must not extract prose word 'n' from HTML docs");
    assert.ok(!varNames.includes("id"), "Must not extract prose word 'id' from HTML docs");
    assert.ok(!varNames.includes("THD"), "Must not treat final parameter THD as unknown");
    assert.ok(!varNames.includes("sin1"), "Must not treat subcomponent instance sin1 as scalar unknown");
    assert.deepEqual(varNames.sort(), ["der(x_state)", "u_filtered"]);
    assert.equal(analysis.equations.length, 2, "Must only extract the 2 true equations");
    assert.ok(
      !eqTexts.some((t) => t.includes("acquire") || t.includes("THD") || t.includes("sin1") || t.includes("StopTime")),
      "Equations must never contain HTML prose, final parameter bindings, or annotations",
    );
    assert.equal(analysis.diagnostics.status, "balanced");
  });

  it("handles flattened DAE dotted, quoted, and array-subscripted variables with localLineMap", () => {
    const editorSource = `model Chua\n  Resistor R1(R=10);\n  Capacitor C1(C=1e-3);\nend Chua;`;
    const flattenedDae = `
class Chua
  parameter Real R1.R = 10.0;
  parameter Real C1.C = 0.001;
  Real R1.v;
  Real R1.i;
  Real C1.v;
  Real 'arr.x'[1];
equation
  R1.v = R1.R * R1.i;
  R1.v = C1.v;
  C1.C * der(C1.v) = -R1.i;
  'arr.x'[1] = C1.v * 0.5;
end Chua;
    `;
    const lineMap = indexLocalSymbolLines(editorSource);
    const analysis = analyzeModelBlt(flattenedDae, flattenedDae.split("\n"), "Chua", {
      localLineMap: lineMap,
      sourceKind: "flattened",
    });

    assert.equal(analysis.diagnostics.status, "balanced", "Flattened 4x4 DAE must be balanced");
    assert.equal(analysis.equations.length, 4);
    assert.equal(analysis.variables.length, 4);
    const r1v = analysis.variables.find((v) => v.name === "R1.v");
    assert.equal(r1v?.line, 2, "Dotted flattened variable R1.v should map back to R1 component line 2 in editor");
  });

  it("does not leak false-positive domain sub-tabs when Modelica code mentions keywords like reaction or PIPE", () => {
    const tabs = computeInspectorSubTabs(
      "modelica",
      `model TorquePipe\n  // reaction torque in PIPE for PROGRAM 1\n  Real tau;\nequation\n  tau = 1.0;\nend TorquePipe;`,
      true,
    );
    const ids = tabs.map((t) => t.id);
    assert.ok(ids.includes("blt"), "Should include BLT tab");
    assert.ok(ids.includes("entities"), "Should include Entities tab");
    assert.ok(!ids.includes("biochem"), "Must NOT leak biochem tab into Modelica");
    assert.ok(!ids.includes("thermo_fluid"), "Must NOT leak thermo_fluid tab into Modelica");
    assert.ok(!ids.includes("automation"), "Must NOT leak automation tab into Modelica");
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
    assert.ok(
      html.includes("Causal Blocks &amp; Tearing") || html.includes("Causal Blocks & Tearing"),
      "Should render Causal Blocks tab",
    );
    assert.ok(html.includes("Dependency DAG"), "Should render Dependency DAG tab");
    assert.ok(
      html.includes("Pantelides &amp; Kirchhoff") || html.includes("Pantelides & Kirchhoff"),
      "Should include Pantelides tab",
    );
    assert.ok(
      !html.includes("Power Grid &amp; Y-Bus") && !html.includes("Power Grid & Y-Bus"),
      "Should hide Power Grid for Modelica",
    );
    assert.ok(
      !html.includes("Multibody &amp; Mobility") && !html.includes("Multibody & Mobility"),
      "Should hide Multibody for Modelica",
    );
    assert.ok(
      !html.includes("CAD B-Rep &amp; FEA") && !html.includes("CAD B-Rep & FEA"),
      "Should hide CAD B-Rep for Modelica",
    );
  });

  it("dynamically shows appropriate inspector tabs and hides inappropriate ones per opened model", () => {
    const urdfHtml = renderToStaticMarkup(
      React.createElement(PolyglotDomainPanel, {
        dialect: "urdf",
        code: `<robot name="arm"><link name="base"/><joint name="j1" type="revolute"><parent link="base"/><child link="l1"/></joint></robot>`,
        colorMode: "dark",
      }),
    );
    assert.ok(
      urdfHtml.includes("Multibody &amp; Mobility") || urdfHtml.includes("Multibody & Mobility"),
      "Should show Multibody for URDF",
    );
    assert.ok(!urdfHtml.includes("BLT Causal Architecture"), "Should hide BLT for URDF");
    assert.ok(
      !urdfHtml.includes("Power Grid &amp; Y-Bus") && !urdfHtml.includes("Power Grid & Y-Bus"),
      "Should hide Power Grid for URDF",
    );

    const stepHtml = renderToStaticMarkup(
      React.createElement(PolyglotDomainPanel, {
        dialect: "step",
        code: `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('STEP CAD'),'2;1');\nDATA;\n#1 = CARTESIAN_POINT('',(0.0,0.0,0.0));\nENDSEC;\nEND-ISO-10303-21;\n`,
        colorMode: "dark",
      }),
    );
    assert.ok(
      stepHtml.includes("CAD B-Rep &amp; FEA") || stepHtml.includes("CAD B-Rep & FEA"),
      "Should show CAD B-Rep for STEP",
    );
    assert.ok(!stepHtml.includes("BLT Causal Architecture"), "Should hide BLT for STEP");
    assert.ok(
      !stepHtml.includes("Multibody &amp; Mobility") && !stepHtml.includes("Multibody & Mobility"),
      "Should hide Multibody for STEP",
    );

    const psseHtml = renderToStaticMarkup(
      React.createElement(PolyglotDomainPanel, {
        dialect: "psse",
        code: `0, 100.0 / PSSE RAW\n1, 'BUS_1', 230.0, 1, 1, 1, 1, 1.02, -1.5\n2, 'BUS_2', 138.0, 1, 1, 1, 1, 0.99, -4.2\n0 / END OF BUS DATA\n1, 2, '1', 0.01, 0.05, 0.04, 150.0\n0 / END OF BRANCH DATA\n`,
        colorMode: "dark",
      }),
    );
    assert.ok(
      psseHtml.includes("Power Grid &amp; Y-Bus") || psseHtml.includes("Power Grid & Y-Bus"),
      "Should show Power Grid for PSSE",
    );
    assert.ok(!psseHtml.includes("BLT Causal Architecture"), "Should hide BLT for PSSE");
    assert.ok(
      !psseHtml.includes("CAD B-Rep &amp; FEA") && !psseHtml.includes("CAD B-Rep & FEA"),
      "Should hide CAD B-Rep for PSSE",
    );
  });

  it("verifies mathematical accuracy across specialized domain inspectors (SI units, Kirchhoff, STEP Euler, Grübler, RREF moieties)", () => {
    // 1. DAE Physics: SI unit mismatch + Union-Find Kirchhoff junction + Index-2 holonomic constraint
    const dae = analyzeDaePhysics(`
model BadUnitsAndPendulum
  Real x(unit="m");
  Real y(unit="m");
  Real vx(unit="m/s");
  Real vy(unit="m/s");
  Real badV(unit="V");
  Real badI(unit="A");
equation
  connect(R1.n, C1.p);
  connect(C1.p, L1.p);
  der(x) = vx;
  der(y) = vy;
  x^2 + y^2 = 1.0;
  badV = badI;
end BadUnitsAndPendulum;
    `);
    assert.equal(
      dae.pantelides.estimatedIndex,
      2,
      "Holonomic constraint x^2 + y^2 = 1 without algebraic unknown is Index-2",
    );
    assert.equal(
      dae.kirchhoffNodes.length,
      1,
      "Transitive connect(R1.n,C1.p) + connect(C1.p,L1.p) must merge into 1 junction",
    );
    assert.equal(dae.kirchhoffNodes[0]?.ports.length, 3, "Merged junction must contain all 3 connected ports");
    const mismatch = dae.unitChecks.find((u) => u.expr.includes("badV"));
    assert.ok(mismatch && !mismatch.isHomogeneous, "Volt = Ampere equation must fail SI dimensional homogeneity");

    // 2. STEP B-Rep Euler-Poincaré: 8 vertices, 12 edges, 24 oriented half-edges, 6 faces -> χ = 8 - 12 + 6 = 2
    const stepLines = [
      "ISO-10303-21;",
      "DATA;",
      ...Array.from({ length: 16 }, (_, i) => `#${i + 1} = CARTESIAN_POINT('',(0.,0.,0.));`),
      ...Array.from({ length: 8 }, (_, i) => `#${100 + i} = VERTEX_POINT('',#${i + 1});`),
      ...Array.from({ length: 12 }, (_, i) => `#${200 + i} = EDGE_CURVE('',#100,#101,#300,.T.);`),
      ...Array.from({ length: 24 }, (_, i) => `#${400 + i} = ORIENTED_EDGE('',*,*,#${200 + (i % 12)},.T.);`),
      ...Array.from({ length: 6 }, (_, i) => `#${500 + i} = ADVANCED_FACE('',(#600),#700,.T.);`),
      "#800 = CLOSED_SHELL('',(#500,#501,#502,#503,#504,#505));",
      "ENDSEC;",
    ];
    const cae = analyzeCaeContinuum(stepLines.join("\n"), stepLines);
    assert.equal(cae.brep.vertices, 8);
    assert.equal(cae.brep.edges, 12);
    assert.equal(cae.brep.faces, 6);
    assert.equal(cae.brep.eulerChi, 2);
    assert.equal(cae.brep.isWatertightManifold, true);

    // 3. Multibody Grübler-Kutzbach: base + 2 links + 2 revolute joints => N=3, J=2, sum(f_i)=2 => M = 6*(3 - 1 - 2) + 2 = 2 DOF
    const urdf = `<robot name="two_dof"><link name="base"/><link name="l1"/><link name="l2"/><joint name="j1" type="revolute"><parent link="base"/><child link="l1"/></joint><joint name="j2" type="revolute"><parent link="l1"/><child link="l2"/></joint></robot>`;
    const mb = analyzeMultibodyKinematics(urdf, urdf.split("\n"));
    assert.equal(mb.bodyCountWithGround, 3);
    assert.equal(mb.grublerMobility, 2);
    assert.equal(mb.hasClosedLoops, false);

    // 4. Biochemistry RREF Left-Nullspace Conserved Moieties: Glc + ATP -> G6P + ADP
    const rxnCode = `J1: Glc + ATP -> G6P + ADP; k1*Glc*ATP`;
    const bio = analyzeBiochemStoichiometry(rxnCode, [rxnCode]);
    assert.equal(bio.species.length, 4);
    assert.equal(bio.reactions.length, 1);
    assert.equal(bio.conservedMoieties.length >= 2, true, "Should discover hexose and adenylate conserved pools");
  });
});
