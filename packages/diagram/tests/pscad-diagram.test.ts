// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  buildPscadDiagram,
  diffPscadProjects,
  evalPscadCond,
  renderPscadSvg,
  type PscadProjectLike,
} from "../src/pscad-diagram-builder.js";

console.log("=== Testing PSCAD Schematic Builder, SVG Renderer & Semantic Diff ===");

const projA: PscadProjectLike = {
  name: "WindFarmSubstation",
  rootModule: {
    buses: [
      { id: "B1", name: "Bus1_33kV", voltageBaseKv: 33, position: { x: 100, y: 150 }, length: 120 },
      { id: "B2", name: "Bus2_230kV", voltageBaseKv: 230, position: { x: 400, y: 150 }, length: 120 },
    ],
    components: [
      {
        id: "WTG1",
        definitionName: "inverter_fmu",
        instanceName: "WindTurbine_1",
        position: { x: 50, y: 150 },
        parameters: { rated_mva: 10.0, rated_kv: 33.0 },
      },
      {
        id: "T1",
        definitionName: "xfmr-3p",
        instanceName: "MainSubstationTransformer",
        position: { x: 250, y: 150 },
        parameters: { MVA: 100.0, V1: 33.0, V2: 230.0, X: 0.08 },
      },
    ],
    wires: [
      {
        id: "w1",
        vertices: [
          { x: 100, y: 150 },
          { x: 250, y: 150 },
        ],
      },
      {
        id: "w2",
        vertices: [
          { x: 320, y: 150 },
          { x: 400, y: 150 },
        ],
      },
    ],
  },
};

// 1. Test X6 Diagram Builder
{
  console.log("Test 1: buildPscadDiagram");
  const diag = buildPscadDiagram(projA);
  assert.strictEqual(diag.metadata.projectName, "WindFarmSubstation");
  assert.strictEqual(diag.metadata.nodeCount, 4); // 2 buses + 2 components
  assert.strictEqual(diag.metadata.edgeCount, 2); // 2 wires

  // Verify busbar node
  const busCell = diag.cells.find((c) => c.id === "B2");
  assert.ok(busCell, "Bus2 cell must exist");
  assert.strictEqual(busCell.data?.vbase, 230);

  // Verify transformer node has transformer markup
  const xfmrCell = diag.cells.find((c) => c.id === "T1");
  assert.ok(xfmrCell, "T1 cell must exist");
  assert.ok(xfmrCell.markup && xfmrCell.markup.length > 0, "Transformer must have custom power glyph markup");
}

// 2. Test Headless SVG Renderer
{
  console.log("Test 2: renderPscadSvg");
  const svg = renderPscadSvg(projA);
  assert.ok(svg.includes("<svg"), "Must emit valid SVG root tag");
  assert.ok(svg.includes("Bus2_230kV"), "Must include Bus label in SVG");
  assert.ok(svg.includes("MainSubstationTransformer"), "Must include Transformer label in SVG");
  assert.ok(svg.includes('<path d="M 100 150 L 250 150"'), "Must include routed wire path in SVG");
  console.log(`   Generated standalone SVG: ${svg.length} bytes`);
}

// 3. Test Semantic Git Diff
{
  console.log("Test 3: diffPscadProjects");
  const projB: PscadProjectLike = {
    name: "WindFarmSubstation",
    rootModule: {
      buses: [...projA.rootModule.buses],
      components: [
        // Modified T1: rating increased from 100 to 120 MVA
        {
          id: "T1",
          definitionName: "xfmr-3p",
          instanceName: "MainSubstationTransformer",
          position: { x: 250, y: 150 },
          parameters: { MVA: 120.0, V1: 33.0, V2: 230.0, X: 0.08 },
        },
        // Added WTG2
        {
          id: "WTG2",
          definitionName: "inverter_fmu",
          instanceName: "WindTurbine_2",
          position: { x: 50, y: 250 },
          parameters: { rated_mva: 10.0, rated_kv: 33.0 },
        },
        // WTG1 removed
      ],
      wires: [...projA.rootModule.wires],
    },
  };

  const diff = diffPscadProjects(projA, projB);
  console.log(`   ${diff.diffSummary.replace(/\n/g, "\n   ")}`);

  assert.strictEqual(diff.addedComponents.length, 1, "Must detect 1 added component (WTG2)");
  assert.strictEqual(diff.addedComponents[0]?.id, "WTG2");

  assert.strictEqual(diff.removedComponents.length, 1, "Must detect 1 removed component (WTG1)");
  assert.strictEqual(diff.removedComponents[0]?.id, "WTG1");

  assert.strictEqual(diff.modifiedComponents.length, 1, "Must detect 1 modified component (T1)");
  assert.strictEqual(diff.modifiedComponents[0]?.changedParams[0]?.param, "MVA");
  assert.strictEqual(diff.modifiedComponents[0]?.changedParams[0]?.oldValue, 100.0);
  assert.strictEqual(diff.modifiedComponents[0]?.changedParams[0]?.newValue, 120.0);
}

// 4. Test Annotations, Dividers, Sub-Module Navigation Buttons, and Definition SVGs
{
  console.log("Test 4: Annotations, Dividers, Module Links & Definition SVGs");
  const projC: PscadProjectLike = {
    name: "MasterCatalogTest",
    projectType: "library",
    definitions: new Map([
      [
        "Transformers",
        {
          description: "Power Transformers",
        },
      ],
      [
        "mult",
        {
          description: "Multiplier",
          svgXml: `<svg viewBox="-200 -200 200 200">
            <rect x="-13" y="-13" width="26" height="26" stroke="Black" stroke-dasharray="none" stroke-width="0.2" fill-style="Hollow" fill-fg="Black" fill-bg="" />
            <text x="0" y="6" stroke="Black" fill="Black" font-size="Small" text-anchor="Middle"><![CDATA[*]]></text>
          </svg>`,
        },
      ],
    ]),
    rootModule: {
      buses: [],
      wires: [],
      stickies: [{ id: "s1", position: { x: 36, y: 18 }, width: 234, height: 54, text: "PASSIVE ELEMENTS" }],
      lines: [
        { id: "div1", classId: "Divider", x1: 36, y1: 378, x2: 36, y2: 18 },
        { id: "div2", classId: "Divider", x1: 270, y1: 378, x2: 36, y2: 378 },
      ],
      components: [
        // Text Annotation
        {
          id: "ann1",
          definitionName: "master:annotation",
          instanceName: "annotation_1",
          position: { x: 100, y: 100 },
          rotation: 180, // Flipped 180 degrees in PSCAD
          parameters: { AL1: "Three Phase", AL2: "Voltage" },
        },
        // Module Navigation Button
        {
          id: "modBtn1",
          definitionName: "master:Transformers",
          instanceName: "Transformers_27416314",
          position: { x: 200, y: 350 },
          width: 239,
          height: 58,
          parameters: {},
        },
        // Math block with definition SVG
        {
          id: "mult1",
          definitionName: "master:mult",
          instanceName: "mult_381769",
          position: { x: 150, y: 200 },
          width: 50,
          height: 50,
          parameters: { Dim: 1 },
        },
      ],
    },
    subModules: new Map([["Transformers", { name: "Transformers", buses: [], wires: [], components: [] }]]),
  };

  const diag = buildPscadDiagram(projC);

  // Verify divider edges
  const divCell = diag.cells.find((c) => c.id === "div1");
  assert.ok(divCell, "div1 edge must exist");
  assert.strictEqual(divCell.data?.kind, "divider");
  assert.strictEqual(divCell.source?.x, 36);
  assert.strictEqual(divCell.source?.y, 378);

  // Verify annotation cell
  const annCell = diag.cells.find((c) => c.id === "ann1");
  assert.ok(annCell, "ann1 cell must exist");
  assert.strictEqual(annCell.data?.kind, "annotation");
  assert.strictEqual(annCell.angle, 0, "Annotation text must not be flipped upside down");
  assert.strictEqual(annCell.attrs?.body?.fill, "none", "Annotation background must be transparent");
  assert.strictEqual(annCell.attrs?.line1?.text, "Three Phase");
  assert.strictEqual(annCell.attrs?.line2?.text, "Voltage");
  assert.strictEqual(annCell.ports, undefined, "Annotation must have 0 port pins");

  // Verify module link button
  const modCell = diag.cells.find((c) => c.id === "modBtn1");
  assert.ok(modCell, "modBtn1 cell must exist");
  assert.strictEqual(modCell.data?.kind, "module-link");
  assert.strictEqual(modCell.data?.targetModule, "Transformers");
  assert.strictEqual(modCell.attrs?.btnLabel?.text, "More on Power Transformers");
  assert.strictEqual(modCell.ports, undefined, "Module navigation button must have 0 port pins");

  // Verify math block definition SVG
  const multCell = diag.cells.find((c) => c.id === "mult1");
  assert.ok(multCell, "mult1 cell must exist");
  assert.ok(multCell.markup && multCell.markup.length >= 2, "mult1 must have vector markup from definition SVG");
  const hasStarText = Object.values(multCell.attrs || {}).some((a: any) => a.text === "*");
  assert.ok(hasStarText, "mult1 must have '*' text primitive extracted from SVG");

  // Verify SVG generation renders all 4 cleanly
  const svg = renderPscadSvg(projC);
  assert.ok(svg.includes("Three Phase"), "SVG must include annotation text");
  assert.ok(svg.includes("More on Power Transformers"), "SVG must include module button label");
  assert.ok(svg.includes("*"), "SVG must include multiplier star text");
  console.log("   Test 4 passed: All alignment features verified.");
}

// Test 5: Category Card Synthesis, Library Mode Port Suppression & Vector Primitives (ellipse, path)
{
  console.log("Test 5: Category Card Synthesis & Vector Primitives");
  const projD: PscadProjectLike = {
    name: "MasterLibTest",
    projectType: "library",
    definitions: new Map([
      [
        "inv",
        {
          name: "inv",
          svgXml: `
            <svg viewBox="-200 -200 200 200">
              <line x1="0" y1="0" x2="7" y2="0" stroke="Black" />
              <line x1="24" y1="0" x2="7" y2="-9" stroke="Black" />
              <ellipse cx="27" cy="0" rx="3" ry="3" stroke="Black" fill-style="Solid" fill-fg="Black" />
              <path d="M-5 -5 A10 10 0 0 1 5 5" stroke="Black" />
            </svg>
          `,
        },
      ],
    ]),
    rootModule: {
      name: "Main",
      buses: [],
      wires: [],
      components: [
        {
          id: "inv1",
          definitionName: "master:inv",
          position: { x: 100, y: 150 },
          width: 60,
          height: 40,
          parameters: {},
          ports: [
            { id: "p1", name: "in", position: { x: -20, y: 0 } },
            { id: "p2", name: "out", position: { x: 20, y: 0 } },
          ],
        },
      ],
      stickies: [
        {
          id: "s1",
          position: { x: 36, y: 18 },
          width: 234,
          height: 54,
          text: "LOGICAL",
        },
      ],
      lines: [
        { id: "l1", classId: "Divider", x1: 36, y1: 18, x2: 36, y2: 378 },
        { id: "l2", classId: "Divider", x1: 270, y1: 18, x2: 270, y2: 378 },
        { id: "l3", classId: "Divider", x1: 36, y1: 378, x2: 270, y2: 378 },
        { id: "l4", classId: "Divider", x1: 36, y1: 72, x2: 270, y2: 72 },
      ],
    },
  };

  const diag = buildPscadDiagram(projD);

  // 1. Assert Category Card is synthesized
  const cardCell = diag.cells.find((c) => c.data?.kind === "category-card");
  assert.ok(cardCell, "Category card must be synthesized from sticky and 4 divider lines");
  assert.strictEqual(cardCell.x, 36);
  assert.strictEqual(cardCell.y, 18);
  assert.strictEqual(cardCell.width, 234);
  assert.strictEqual(cardCell.height, 360);
  assert.strictEqual(cardCell.data?.title, "LOGICAL");
  assert.strictEqual(cardCell.zIndex, -10, "Card must have zIndex -10");

  // Divider lines and stickies should have been consumed
  assert.ok(!diag.cells.some((c) => c.id === "l1"), "l1 line should be consumed by category card");
  assert.ok(!diag.cells.some((c) => c.id === "s1"), "s1 sticky should be consumed by category card");

  // 2. Assert Library Mode suppresses port magnets on components
  const comp = diag.cells.find((c) => c.id === "inv1");
  assert.ok(comp, "inv1 component must exist");
  assert.strictEqual(comp.ports, undefined, "Component must have ports suppressed in library mode");

  // 3. Assert Ellipse and Path markup
  assert.ok(comp.markup && comp.markup.length >= 4, "inv1 must contain markup for lines, ellipse, and path");
  const hasEllipse = comp.markup.some((m: any) => m.tagName === "ellipse");
  const hasPath = comp.markup.some((m: any) => m.tagName === "path");
  assert.ok(hasEllipse, "inv1 must have ellipse markup");
  assert.ok(hasPath, "inv1 must have path markup");

  // 4. Test renderPscadSvg produces clean light mode SVG
  const svg = renderPscadSvg(projD, { theme: "light" });
  assert.ok(svg.includes("LOGICAL"), "SVG must include category card header title");
  assert.ok(svg.includes("<ellipse"), "SVG must render ellipse tag");
  assert.ok(svg.includes("<path"), "SVG must render path tag");
  assert.ok(svg.includes('style="background-color: #ffffff;"'), "SVG must use light background");
  console.log("   Test 5 passed: Category cards, library port suppression & vector primitives verified.");
}

// 6. Test Conditional SVG Evaluation, Upright Text Normalization & Button Sanitization
{
  console.log("Test 6: Conditional SVG Evaluation, Upright Text Counter-Rotation & Button Sanitization");

  // 1. Assert evalPscadCond logic
  assert.strictEqual(evalPscadCond("true", {}), true);
  assert.strictEqual(evalPscadCond("false", {}), false);
  assert.strictEqual(evalPscadCond("State==0", { State: 0 }), true);
  assert.strictEqual(evalPscadCond("State==0", { State: 1 }), false);
  assert.strictEqual(evalPscadCond("NC>=4", { NC: 3 }), false);
  assert.strictEqual(evalPscadCond("NC>=4", { NC: 4 }), true);
  assert.strictEqual(evalPscadCond("(WaitType==3)&&(CrossDir==-1)", { WaitType: 3, CrossDir: -1 }), true);
  assert.strictEqual(evalPscadCond("(WaitType==3)&&(CrossDir==-1)", { WaitType: 2, CrossDir: -1 }), false);

  // 2. Test Component SVG with <cond> branches and rotation
  const projE: PscadProjectLike = {
    name: "CondAndRotationTest",
    projectType: "library",
    definitions: new Map([
      [
        "Sequencer_Wait",
        {
          description: "Wait condition sequencer",
          svgXml: `<svg viewBox="-200 -200 200 200">
            <cond><![CDATA[true]]></cond>
            <rect x="-43" y="-32" width="92" height="58" stroke="Silver" fill-style="Solid" fill-fg="Gray" />
            <cond><![CDATA[State==0]]></cond>
            <rect x="-46" y="-29" width="92" height="58" stroke="Silver" fill-style="Solid" fill-fg="White" />
            <cond><![CDATA[State==1]]></cond>
            <rect x="-46" y="-29" width="92" height="58" stroke="Black" fill-style="Solid" fill-fg="Silver" />
            <cond><![CDATA[WaitType<2]]></cond>
            <text x="0" y="-7"><![CDATA[Wait For]]></text>
            <cond><![CDATA[WaitType==2]]></cond>
            <text x="0" y="-7"><![CDATA[Wait Until]]></text>
            <cond><![CDATA[WaitType==2]]></cond>
            <text x="1" y="16"><![CDATA[%UntilTime]]></text>
          </svg>`,
        },
      ],
      [
        "xnode",
        {
          description: "Electrical XNode Pin",
          svgXml: `<svg viewBox="-200 -200 200 200">
            <circle cx="0" cy="0" r="7" stroke="Blue" fill="none" />
            <text x="0" y="15" stroke="Blue" fill="Blue"><![CDATA[XNode]]></text>
          </svg>`,
        },
      ],
      [
        "io",
        {
          description: "Slider, switch, dial, push button, Output channel, Meter, Control Panel, etc.",
        },
      ],
    ]),
    subModules: new Map([["io", { name: "io", buses: [], wires: [], components: [] }]]),
    rootModule: {
      buses: [],
      wires: [],
      components: [
        {
          id: "seq1",
          instanceName: "seq1",
          definitionName: "master:Sequencer_Wait",
          position: { x: 100, y: 100 },
          parameters: { State: 0, WaitType: 2, UntilTime: "5.0" },
        },
        {
          id: "node1",
          instanceName: "node1",
          definitionName: "master:xnode",
          position: { x: 200, y: 200 },
          rotation: 180,
          parameters: {},
        },
        {
          id: "io_nav",
          instanceName: "io",
          definitionName: "master:io",
          position: { x: 300, y: 300 },
          parameters: {},
        },
      ],
    },
  };

  const diagE = buildPscadDiagram(projE);

  // Assert Sequencer_Wait has evaluated condition:
  // - State==0 (White face) is rendered, State==1 (Silver face) is skipped
  // - WaitType==2 ("Wait Until" & "5.0") are rendered, WaitType<2 is skipped
  const seqCell = diagE.cells.find((c) => c.id === "seq1");
  assert.ok(seqCell, "seq1 cell must exist");
  assert.strictEqual(
    seqCell.markup?.length,
    4,
    "seq1 must only contain 4 elements (shadow, white face, Wait Until, 5.0)",
  );
  const texts = Object.values(seqCell.attrs || {})
    .map((a: any) => a.text)
    .filter(Boolean);
  assert.ok(texts.includes("Wait Until"), "seq1 must render 'Wait Until'");
  assert.ok(texts.includes("5.0"), "seq1 must substitute %UntilTime with '5.0'");
  assert.ok(!texts.includes("Wait For"), "seq1 must NOT render 'Wait For'");

  // Assert xnode text is counter-rotated
  const nodeCell = diagE.cells.find((c) => c.id === "node1");
  assert.ok(nodeCell, "node1 cell must exist");
  assert.strictEqual(nodeCell.angle, 180, "node1 cell angle must be 180");
  const nodeTextAttr = Object.values(nodeCell.attrs || {}).find((a: any) => a.text === "XNode");
  assert.ok(nodeTextAttr, "node1 must contain XNode text");
  assert.ok(
    nodeTextAttr.transform?.startsWith("rotate(-180,"),
    `XNode text must be counter-rotated by -180 deg, got: ${nodeTextAttr.transform}`,
  );

  // Assert navigation button label is sanitized and truncated
  const ioBtn = diagE.cells.find((c) => c.id === "io_nav");
  assert.ok(ioBtn, "io_nav cell must exist");
  assert.strictEqual(
    ioBtn.attrs?.btnLabel?.text,
    "More on I/O Devices",
    "Button label must be sanitized to 'More on I/O Devices'",
  );

  // Assert renderPscadSvg emits transform on text
  const svgE = renderPscadSvg(projE);
  assert.ok(svgE.includes('transform="rotate(-180,'), "SVG must preserve counter-rotation transform on text");
  assert.ok(svgE.includes("Wait Until"), "SVG must include 'Wait Until'");
  assert.ok(!svgE.includes("Wait For"), "SVG must not include 'Wait For'");

  console.log("   Test 6 passed: Conditional SVGs, upright text counter-rotation & button sanitization verified.");
}

// ── Test 7: Sub-module Diagram Drill-down & Module Navigation ──
{
  console.log("Test 7: Sub-module Diagram Drill-down & Module Navigation");
  const projF: PscadProjectLike = {
    name: "MasterTest",
    projectType: "library",
    definitions: new Map(),
    rootModule: {
      name: "Main",
      buses: [],
      wires: [],
      components: [
        {
          id: "passive_btn",
          definitionName: "master:Passive",
          position: { x: 100, y: 300 },
          width: 180,
          height: 30,
          parameters: {},
        },
      ],
      stickies: [],
      lines: [],
    },
    subModules: new Map([
      [
        "Passive",
        {
          id: "sub_passive",
          name: "Passive",
          buses: [
            {
              id: "bus_pass",
              name: "Bus_Passive",
              position: { x: 50, y: 50 },
              length: 100,
              voltageBaseKv: 230,
            },
          ],
          wires: [],
          components: [
            {
              id: "res1",
              definitionName: "master:resistor",
              position: { x: 100, y: 100 },
              width: 60,
              height: 40,
              parameters: { R: "10.0 [ohm]" },
            },
            {
              id: "cap1",
              definitionName: "master:capacitor",
              position: { x: 200, y: 100 },
              width: 60,
              height: 40,
              parameters: { C: "5.0 [uF]" },
            },
          ],
          stickies: [],
          lines: [],
        },
      ],
    ]),
  };

  // 1. Root module builds navigation button with kind: "module-link" and targetModule: "Passive"
  const rootDiag = buildPscadDiagram(projF);
  const btnCell = rootDiag.cells.find((c) => c.id === "passive_btn");
  assert.ok(btnCell, "Button cell must exist in root diagram");
  assert.strictEqual(btnCell.data?.kind, "module-link");
  assert.strictEqual(btnCell.data?.targetModule, "Passive");
  assert.strictEqual(rootDiag.metadata.moduleName, "Main");

  // 2. Drill-down into "Passive" builds sub-module diagram with its components and bus
  const passiveDiag = buildPscadDiagram(projF, "Passive");
  assert.strictEqual(passiveDiag.metadata.moduleName, "Passive");
  const resCell = passiveDiag.cells.find((c) => c.id === "res1");
  const capCell = passiveDiag.cells.find((c) => c.id === "cap1");
  const busCell = passiveDiag.cells.find((c) => c.id === "bus_pass");
  assert.ok(resCell, "Resistor must exist in Passive sub-module");
  assert.ok(capCell, "Capacitor must exist in Passive sub-module");
  assert.ok(busCell, "Bus must exist in Passive sub-module");
  assert.ok(!passiveDiag.cells.some((c) => c.id === "passive_btn"), "Root button must not exist in sub-module");

  // 3. renderPscadSvg with moduleName renders the sub-module
  const passiveSvg = renderPscadSvg(projF, { moduleName: "Passive" });
  assert.ok(passiveSvg.includes("Bus_Passive"), "SVG must include sub-module bus");
  assert.ok(passiveSvg.includes("res1"), "SVG must include resistor component");
  assert.ok(passiveSvg.includes("cap1"), "SVG must include capacitor component");

  console.log("   Test 7 passed: Sub-module drill-down, module-link metadata & SVG rendering verified.");
}

console.log("ALL PSCAD DIAGRAM & DIFF TESTS PASSED SUCCESSFULLY! Milestone 2 verified.");
