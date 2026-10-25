// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { getOlgaQuickFixes } from "../src/lints/quick-fixes.js";

test("OLGA LSP Quick-Fixes", async (t) => {
  await t.test("M7008: should fix invalid PVT table extension (.csv -> .tab)", () => {
    const opi = `<OlgaCase name="TestM7008" tableFile="fluids/fluid.csv" maxDt="1.0">
  <Flowpath name="Main">
    <Pipe label="P1" length="1000" diameter="0.3" discretization="20" elevation="0" roughness="0.000045" />
    <Source name="Inlet" boundaryPosition="0" totalMassRate="25" />
    <Node name="Sep" boundaryPosition="1" type="PRESSURE" pressure="20bar" temperature="20C" />
  </Flowpath>
</OlgaCase>`;

    const fixes = getOlgaQuickFixes(opi, "file:///test.opi");
    const fix7008 = fixes.find((f) => f.code === "M7008");
    assert.ok(fix7008, "Should offer QuickFix for M7008");
    assert.ok(fix7008.title.includes("Change fluid table extension from .csv to .tab"));
    const edits = fix7008.edit.changes["file:///test.opi"];
    assert.ok(edits && edits.length > 0);
    assert.ok(edits[0].newText.includes(".tab"));
  });

  await t.test("M7009: should inject Polyurethane insulation layer for wax mitigation", () => {
    const opi = `<OlgaCase name="TestM7009" maxDt="1.0">
  <Flowpath name="SubseaLine">
    <Wax cloudPointTemp="293.15" />
    <HeatTransfer ambientTemperature="277.15" />
    <Pipe label="P1" length="2000" diameter="0.3" discretization="20" elevation="-200" roughness="0.000045" />
    <Source name="WellSource" boundaryPosition="0" totalMassRate="20" />
    <Node name="Platform" boundaryPosition="1" type="PRESSURE" pressure="15bar" />
  </Flowpath>
</OlgaCase>`;

    const fixes = getOlgaQuickFixes(opi, "file:///test.opi");
    const fix7009 = fixes.find((f) => f.code === "M7009");
    assert.ok(fix7009, "Should offer QuickFix for M7009");
    assert.ok(fix7009.title.includes("Polyurethane insulation"));
    const edits = fix7009.edit.changes["file:///test.opi"];
    assert.ok(edits && edits.length > 0);
    assert.ok(edits[0].newText.includes('material="Polyurethane"'));
    assert.ok(edits[0].newText.includes('thickness="0.05"'));
  });

  await t.test("M7010: should throttle choke opening when sand erosion limit is exceeded", () => {
    const opi = `<OlgaCase name="TestM7010Erosion" maxDt="1.0">
  <Flowpath name="ErosionLine">
    <Sand sandMassRate="0.5" />
    <Pipe label="P1" length="500" diameter="0.05" discretization="10" elevation="0" roughness="0.000045" />
    <Valve name="WellChoke" position="250" opening="1.0" cv="50" />
    <Source name="GasWell" boundaryPosition="0" totalMassRate="30" />
    <Node name="Header" boundaryPosition="1" type="PRESSURE" pressure="50bar" />
  </Flowpath>
</OlgaCase>`;

    const fixes = getOlgaQuickFixes(opi, "file:///test.opi");
    const fix7010 = fixes.find((f) => f.code === "M7010");
    assert.ok(fix7010, "Should offer QuickFix for M7010");
    assert.ok(fix7010.title.includes("0.60") || fix7010.title.includes("diameter"));
  });

  await t.test("M7005: should crack fully closed choke valve to 0.05", () => {
    const opi = `<OlgaCase name="TestM7005" maxDt="1.0">
  <Flowpath name="ClosedChokeLine">
    <Pipe label="P1" length="500" diameter="0.3" discretization="10" elevation="0" roughness="0.000045" />
    <Valve name="EmergencyChoke" position="250" opening="0.0" cv="50" />
    <Source name="Well" boundaryPosition="0" totalMassRate="20" />
    <Node name="Sep" boundaryPosition="1" type="PRESSURE" pressure="20bar" />
  </Flowpath>
</OlgaCase>`;

    const fixes = getOlgaQuickFixes(opi, "file:///test.opi");
    const fix7005 = fixes.find((f) => f.code === "M7005");
    assert.ok(fix7005, "Should offer QuickFix for M7005");
    assert.ok(fix7005.title.includes("0.05"));
    const edits = fix7005.edit.changes["file:///test.opi"];
    assert.ok(edits && edits.length > 0);
    assert.ok(edits[0].newText.includes('opening="0.05"'));
  });

  await t.test("M7001: should reduce maxDt when CFL stability condition is violated", () => {
    const opi = `<OlgaCase name="TestM7001" maxDt="5.0">
  <Flowpath name="FineLine">
    <Pipe label="FinePipe" length="50" diameter="0.3" discretization="50" elevation="0" roughness="0.000045" />
    <Source name="Well" boundaryPosition="0" totalMassRate="20" />
    <Node name="Sep" boundaryPosition="1" type="PRESSURE" pressure="20bar" />
  </Flowpath>
</OlgaCase>`;

    const fixes = getOlgaQuickFixes(opi, "file:///test.opi");
    const fix7001 = fixes.find((f) => f.code === "M7001");
    assert.ok(fix7001, "Should offer QuickFix for M7001");
    assert.ok(fix7001.title.includes("0.1s"));
    const edits = fix7001.edit.changes["file:///test.opi"];
    assert.ok(edits && edits.length > 0);
    assert.ok(edits[0].newText.includes('maxDt="0.1"'));
  });
});
