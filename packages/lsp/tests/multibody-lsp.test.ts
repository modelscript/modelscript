// SPDX-License-Identifier: AGPL-3.0-or-later

import { GensysWorkspaceIndex, getGensysDocumentSymbols, getGensysHover, validateGensys } from "@modelscript/gensys";
import {
  getSimpackDocumentSymbols,
  getSimpackHover,
  SimpackWorkspaceIndex,
  validateSimpack,
} from "@modelscript/simpack";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalLanguageRegistry } from "../src/registry/LanguageRegistry.js";

const sampleSpckXml = `
<simpack_model name="QuarterCar">
  <body id="b_chassis" name="Chassis" mass="350.0" ixx="80.0" iyy="120.0" izz="150.0" />
  <body id="b_wheel" name="Wheel" mass="45.0" ixx="2.0" iyy="3.5" izz="2.0" />
  <marker id="m_ground" body="$inertial" x="0" y="0" z="0" />
  <marker id="m_wheel_center" body="b_wheel" x="0" y="0" z="0.3" />
  <marker id="m_chassis_mount" body="b_chassis" x="0" y="0" z="0.6" />
  <joint id="j_susp" type="prismatic" from="m_wheel_center" to="m_chassis_mount" />
  <spring id="s_strut" from="m_wheel_center" to="m_chassis_mount" kz="45000" cz="2800" />
</simpack_model>
`;

const sampleGensysDeck = `
# Manchester Benchmark Vehicle Subsystem
body carbody 32000.0 25000.0 180000.0 190000.0 0.0 0.0 1.80
body bogie_front 3200.0 1200.0 1800.0 2200.0 7.5 0.0 0.65
wheelset ws1 1800.0 800.0 120.0 800.0 1.435 0.46 0.15 S1002
spring sec_front carbody bogie_front 180000 180000 420000 15000 30000 35000
sub bogie_rear_module
speed 40.0
`;

describe("LSP Multi-File Language Services for SIMPACK & GENSYS", () => {
  it("generates hierarchical DocumentSymbols for SIMPACK models", () => {
    const symbols = getSimpackDocumentSymbols(sampleSpckXml);

    assert.ok(symbols.length >= 4, "Should extract bodies, joints, and forces");

    // Chassis body
    const chassisSym = symbols.find((s) => s.name.includes("b_chassis"));
    assert.ok(chassisSym);
    assert.equal(chassisSym.kind, 5); // Class
    assert.ok(chassisSym.detail?.includes("350"));

    // Joint
    const jointSym = symbols.find((s) => s.name === "j_susp");
    assert.ok(jointSym);
    assert.equal(jointSym.kind, 11); // Interface
    assert.ok(jointSym.detail?.includes("prismatic"));

    // Spring
    const springSym = symbols.find((s) => s.name === "s_strut");
    assert.ok(springSym);
    assert.equal(springSym.kind, 12); // Function
    assert.ok(springSym.detail?.includes("45000"));
  });

  it("evaluates SIMPACK hover tooltips with Markdown formatting", () => {
    // Hover on body
    const offsetBody = sampleSpckXml.indexOf("b_chassis");
    const hoverBody = getSimpackHover(sampleSpckXml, offsetBody);
    assert.ok(hoverBody);
    assert.ok(hoverBody.contents.value.includes("### SIMPACK Rigid Body `b_chassis`"));
    assert.ok(hoverBody.contents.value.includes("350 kg"));

    // Hover on joint
    const offsetJoint = sampleSpckXml.indexOf("j_susp");
    const hoverJoint = getSimpackHover(sampleSpckXml, offsetJoint);
    assert.ok(hoverJoint);
    assert.ok(hoverJoint.contents.value.includes("### SIMPACK Kinematic Joint `j_susp`"));
    assert.ok(hoverJoint.contents.value.includes("PRISMATIC"));
  });

  it("validates SIMPACK model and produces LSP diagnostics", () => {
    const diags = validateSimpack(sampleSpckXml);
    assert.equal(diags.length, 0, "Valid model should have zero diagnostics");

    const invalidXml = `<simpack_model name="Bad"><marker id="m1" body="ghost_body" /></simpack_model>`;
    const errDiags = validateSimpack(invalidXml);
    assert.ok(errDiags.length > 0, "Dangling marker reference should trigger diagnostic");
    assert.equal(errDiags[0]!.source, "simpack");
  });

  it("generates DocumentSymbols for GENSYS vehicle decks", () => {
    const symbols = getGensysDocumentSymbols(sampleGensysDeck);
    assert.ok(symbols.length >= 4);

    // Carbody
    const carbodySym = symbols.find((s) => s.name === "carbody");
    assert.ok(carbodySym);
    assert.equal(carbodySym.kind, 5); // Class
    assert.ok(carbodySym.detail?.includes("32000"));

    // Wheelset
    const wsSym = symbols.find((s) => s.name === "ws1");
    assert.ok(wsSym);
    assert.equal(wsSym.kind, 23); // Struct
    assert.ok(wsSym.detail?.includes("0.46"));

    // Spring
    const springSym = symbols.find((s) => s.name === "sec_front");
    assert.ok(springSym);
    assert.equal(springSym.kind, 8); // Field
    assert.ok(springSym.detail?.includes("420000"));

    // Subsystem
    const subSym = symbols.find((s) => s.name === "bogie_rear_module");
    assert.ok(subSym);
    assert.equal(subSym.kind, 2); // Module
  });

  it("evaluates GENSYS hover tooltips with Markdown formatting", () => {
    // Hover on carbody
    const offsetBody = sampleGensysDeck.indexOf("carbody");
    const hoverBody = getGensysHover(sampleGensysDeck, offsetBody);
    assert.ok(hoverBody);
    assert.ok(hoverBody.contents.value.includes("### GENSYS Vehicle Body `carbody`"));
    assert.ok(hoverBody.contents.value.includes("32000 kg"));

    // Hover on wheelset
    const offsetWs = sampleGensysDeck.indexOf("ws1");
    const hoverWs = getGensysHover(sampleGensysDeck, offsetWs);
    assert.ok(hoverWs);
    assert.ok(hoverWs.contents.value.includes("### GENSYS Wheelset `ws1`"));
    assert.ok(hoverWs.contents.value.includes("0.46 m"));

    // Hover on speed command
    const offsetSpeed = sampleGensysDeck.indexOf("speed");
    const hoverSpeed = getGensysHover(sampleGensysDeck, offsetSpeed);
    assert.ok(hoverSpeed);
    assert.ok(hoverSpeed.contents.value.includes("40 m/s"));
    assert.ok(hoverSpeed.contents.value.includes("144.0 km/h"));
  });

  it("validates GENSYS deck and produces LSP diagnostics", () => {
    const diags = validateGensys(sampleGensysDeck);
    assert.equal(diags.length, 0, "Valid GENSYS deck should have zero diagnostics");

    const invalidDeck = "body ghost -500 0 0 0\n";
    const errDiags = validateGensys(invalidDeck);
    assert.ok(errDiags.length > 0, "Negative mass should trigger diagnostic");
    assert.equal(errDiags[0]!.source, "gensys");
  });

  it("registers simpack and gensys plugins in LanguageRegistry with workspace indexing", async () => {
    const { simpackLanguage } = await import("@modelscript/simpack");
    const { gensysLanguage } = await import("@modelscript/gensys");

    globalLanguageRegistry.register({
      id: "simpack",
      name: "SIMPACK",
      extensions: [".spck", ".sim", ".mbs"],
      languageDef: simpackLanguage,
      workspaceIndex: new SimpackWorkspaceIndex(),
      customHandlers: {
        symbols: (text: any) => getSimpackDocumentSymbols(typeof text === "string" ? text : (text?.text ?? "")),
        hover: (offset: number, text: string) => getSimpackHover(text, offset),
        validate: (doc: any) => validateSimpack(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
      },
      actionHandlers: {
        export_simpack_fmu: async () => null,
        simulate_simpack: async () => null,
      },
    });

    globalLanguageRegistry.register({
      id: "gensys",
      name: "GENSYS",
      extensions: [".calc", ".ins", ".run", ".sub", ".geom", ".trax", ".wheel"],
      languageDef: gensysLanguage,
      workspaceIndex: new GensysWorkspaceIndex(),
      customHandlers: {
        symbols: (text: any) => getGensysDocumentSymbols(typeof text === "string" ? text : (text?.text ?? "")),
        hover: (offset: number, text: string) => getGensysHover(text, offset),
        validate: (doc: any) => validateGensys(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
      },
      actionHandlers: {
        export_gensys_fmu: async () => null,
        simulate_gensys: async () => null,
      },
    });

    const simpackPlugin = globalLanguageRegistry.getPluginById("simpack");
    assert.ok(simpackPlugin, "SIMPACK plugin should be registered in globalLanguageRegistry");
    assert.ok(simpackPlugin.extensions.includes(".spck"));
    assert.ok(simpackPlugin.extensions.includes(".sim"));
    assert.ok(simpackPlugin.workspaceIndex instanceof SimpackWorkspaceIndex);
    assert.ok(typeof simpackPlugin.customHandlers?.symbols === "function");
    assert.ok(typeof simpackPlugin.customHandlers?.hover === "function");

    // Action handlers
    assert.ok(typeof simpackPlugin.actionHandlers?.export_simpack_fmu === "function");
    assert.ok(typeof simpackPlugin.actionHandlers?.simulate_simpack === "function");

    const gensysPlugin = globalLanguageRegistry.getPluginById("gensys");
    assert.ok(gensysPlugin, "GENSYS plugin should be registered in globalLanguageRegistry");
    assert.ok(gensysPlugin.extensions.includes(".calc"));
    assert.ok(gensysPlugin.extensions.includes(".ins"));
    assert.ok(gensysPlugin.workspaceIndex instanceof GensysWorkspaceIndex);
    assert.ok(typeof gensysPlugin.customHandlers?.symbols === "function");
    assert.ok(typeof gensysPlugin.customHandlers?.hover === "function");

    // Action handlers
    assert.ok(typeof gensysPlugin.actionHandlers?.export_gensys_fmu === "function");
    assert.ok(typeof gensysPlugin.actionHandlers?.simulate_gensys === "function");
  });
});
