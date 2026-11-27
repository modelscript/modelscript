// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parsePscx, tryPlanPscadLocalEdits } from "../src/index.js";

const SAMPLE_PATH = path.resolve("examples/04-ieee2800-gfm-inverter/gfm_inverter.pscx");
const SAMPLE_XML = fs.existsSync(SAMPLE_PATH)
  ? fs.readFileSync(SAMPLE_PATH, "utf-8")
  : fs.readFileSync(path.resolve("languages/pscad/examples/04-ieee2800-gfm-inverter/gfm_inverter.pscx"), "utf-8");

describe("tryPlanPscadLocalEdits", () => {
  it("synchronously plans addComponent, move, updateParameter, and connect edits", () => {
    const project = parsePscx(SAMPLE_XML);
    const c0 = project.rootModule.components[0]!;
    const c1 = project.rootModule.components[1]!;

    const addRes = tryPlanPscadLocalEdits(
      SAMPLE_XML,
      [{ type: "addComponent", className: "PSCAD.master:resistor", x: 180, y: 180 }],
      { uri: "file:///gfm_inverter.pscx" },
    );
    assert.ok(addRes, "native PSCAD addComponent should plan locally");
    assert.ok(addRes.edits.length > 0);
    assert.equal(addRes.renderHint, "immediate");

    const moveRes = tryPlanPscadLocalEdits(
      SAMPLE_XML,
      [
        {
          type: "move",
          items: [{ name: `cmp_${c0.id}`, x: c0.position.x + 36, y: c0.position.y, width: 54, height: 36 }],
        },
      ],
      { uri: "file:///gfm_inverter.pscx" },
    );
    assert.ok(moveRes, "move should plan locally");
    assert.ok(moveRes.edits.length > 0);

    const paramRes = tryPlanPscadLocalEdits(
      SAMPLE_XML,
      [{ type: "updateParameter", name: `cmp_${c0.id}`, parameter: "Name", value: "UpdatedCmp" }],
      { uri: "file:///gfm_inverter.pscx" },
    );
    assert.ok(paramRes, "updateParameter should plan locally");
    assert.ok(paramRes.edits.length > 0);

    const connectRes = tryPlanPscadLocalEdits(
      SAMPLE_XML,
      [{ type: "connect", source: `cmp_${c0.id}`, target: `cmp_${c1.id}` }],
      { uri: "file:///gfm_inverter.pscx" },
    );
    assert.ok(connectRes, "connect should plan locally");
    assert.ok(connectRes.edits.length > 0);
    assert.equal(connectRes.renderHint, "immediate");
  });

  it("scaffolds an empty document on addComponent", () => {
    const res = tryPlanPscadLocalEdits("", [{ type: "addComponent", className: "master:resistor", x: 100, y: 100 }], {
      uri: "file:///NewCircuit.pscx",
    });
    assert.ok(res, "empty PSCAD doc should scaffold locally");
    assert.equal(res.edits.length, 1);
    assert.match(res.edits[0]!.newText, /<project name="NewCircuit"/);
    assert.match(res.edits[0]!.newText, /master:resistor/);
  });

  it("defers foreign cross-language drops without foreignInfo and pasteSubgraph to the LSP backend", () => {
    const foreign = tryPlanPscadLocalEdits(
      SAMPLE_XML,
      [{ type: "addComponent", className: "Modelica.Electrical.Analog.Basic.Resistor", x: 120, y: 120 }],
      { uri: "file:///gfm_inverter.pscx" },
    );
    assert.equal(
      foreign,
      null,
      "foreign Modelica component drop without foreignInfo must return null for LSP fallback",
    );

    const paste = tryPlanPscadLocalEdits(SAMPLE_XML, [{ type: "pasteSubgraph" }], {
      uri: "file:///gfm_inverter.pscx",
    });
    assert.equal(paste, null, "pasteSubgraph must return null for LSP fallback");
  });

  it("handles foreign cross-language drops locally when foreignInfo is attached (zero LSP)", () => {
    const res = tryPlanPscadLocalEdits(
      SAMPLE_XML,
      [
        {
          type: "addComponent",
          className: "Modelica.Electrical.Analog.Basic.Resistor",
          x: 240,
          y: 180,
          foreignInfo: {
            cleanName: "Modelica.Electrical.Analog.Basic.Resistor",
            shortName: "Resistor",
            sourceLanguage: "modelica",
            explicitLanguage: "modelica",
            params: [{ name: "R", defaultValue: "10.0" }],
          },
        },
      ],
      { uri: "file:///gfm_inverter.pscx" },
    );
    assert.ok(res, "foreign drop with foreignInfo should plan locally via CST without LSP");
    assert.ok(res.edits.length > 0);
    assert.equal(res.renderHint, "immediate");
    const combinedNew = res.edits.map((e) => e.newText).join("\n");
    assert.match(combinedNew, /Resistor/);
  });

  it("remains error-tolerant when sibling XML is broken or </schematic> is missing", () => {
    const brokenXml = [
      `<project name="BrokenPscad" version="5.0.2">`,
      `  <definitions>`,
      `    <Definition name="Main" classid="UserCmpDefn">`,
      `      <schematic classid="UserCanvas">`,
      `        <User classid="UserCmp" id="101" name="master:resistor" defn="master:resistor" x="180" y="180" w="54" h="36" orient="0" disable="false">`,
      `          <paramlist link="-1" name="" crc="0">`,
      `            <param name="Name" value="R1" />`,
      `            <param name="R" value="10" />`,
      `          </paramlist>`,
      `        </User>`,
      `        <User classid="UserCmp" id="999" broken_unclosed_attr="oops`,
      `    </Definition>`,
      `  </definitions>`,
      `</project>`,
      "",
    ].join("\n");

    const moveRes = tryPlanPscadLocalEdits(
      brokenXml,
      [{ type: "move", items: [{ name: "cmp_101", x: 360, y: 216, width: 54, height: 36 }] }],
      { uri: "file:///broken.pscx" },
    );
    assert.ok(moveRes, "moving a healthy component must succeed despite a broken sibling element");
    assert.ok(moveRes.edits.length >= 2);
    // Apply edits and verify broken sibling bytes remain untouched while R1 moved
    const lines = brokenXml.split("\n");
    const toOff = (p: { line: number; character: number }) =>
      lines.slice(0, p.line).reduce((acc, l) => acc + l.length + 1, 0) + p.character;
    let out = brokenXml;
    for (const ed of [...moveRes.edits].sort((a, b) => toOff(b.range.start) - toOff(a.range.start))) {
      out = out.slice(0, toOff(ed.range.start)) + ed.newText + out.slice(toOff(ed.range.end));
    }
    assert.match(out, /id="101"[^>]*x="387" y="234"/);
    assert.ok(out.includes('broken_unclosed_attr="oops'), "broken sibling must be preserved verbatim");
  });
});
