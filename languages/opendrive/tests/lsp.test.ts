// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  executeOpenDriveAction,
  getOpenDriveDocumentSymbols,
  getOpenDriveHover,
  validateOpenDrive,
} from "../src/lsp.js";

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <header revMajor="1" revMinor="6" name="Urban_Corridor"/>
  <road id="1" name="Main_Street" length="200.0" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="100"><line/></geometry>
      <geometry s="100" x="100" y="0" hdg="0" length="100"><arc curvature="0.01"/></geometry>
    </planView>
    <elevationProfile>
      <elevation s="0" a="5.0" b="0.01" c="0" d="0"/>
    </elevationProfile>
    <lanes>
      <laneSection s="0">
        <center><lane id="0" type="none"/></center>
        <right><lane id="-1" type="driving"><width sOffset="0" a="3.5" b="0" c="0" d="0"/></lane></right>
      </laneSection>
    </lanes>
  </road>
</OpenDRIVE>`;

describe("OpenDRIVE LSP Language Services", () => {
  it("validates clean OpenDRIVE XML with zero diagnostics", () => {
    const diags = validateOpenDrive(sampleXml);
    assert.strictEqual(diags.length, 0);
  });

  it("reports diagnostic on invalid XML syntax", () => {
    const diags = validateOpenDrive("<invalid_root></invalid_root>");
    assert(diags.length > 0);
    assert.strictEqual(diags[0]!.code, "M7800");
  });

  it("extracts LSP document symbols for roads and geometries", () => {
    const symbols = getOpenDriveDocumentSymbols(sampleXml);
    assert(symbols.length > 0);
    const roadSym = symbols.find((s) => s.name.includes("Main_Street"));
    assert(roadSym !== undefined);
    assert(roadSym.children && roadSym.children.length >= 2);
  });

  it("provides hover details for road headers and geometries", () => {
    // Hover near start of file inside road
    const hover = getOpenDriveHover(sampleXml, 150);
    assert(hover !== null);
    assert(hover.contents.value.includes("OpenDRIVE Road"));
    assert(hover.contents.value.includes("Main_Street"));
  });

  it("executes language server custom actions", async () => {
    // Action 1: opendrive_lint
    const lintResult = await executeOpenDriveAction("opendrive_lint", sampleXml);
    assert(Array.isArray(lintResult));
    assert.strictEqual(lintResult.length, 0);

    // Action 2: opendrive_sample_track
    const trackResult = await executeOpenDriveAction("opendrive_sample_track", sampleXml, { step: 50.0 });
    assert(Array.isArray(trackResult));
    assert.strictEqual(trackResult[0]!.roadId, "1");
    assert(trackResult[0]!.points.length >= 4);

    // Action 3: opendrive_to_dae
    const daeResult = await executeOpenDriveAction("opendrive_to_dae", sampleXml);
    assert(daeResult.variableCount >= 7);
    assert(daeResult.equationCount >= 7);

    // Action 4: opendrive_to_gensys
    const gensysResult = await executeOpenDriveAction("opendrive_to_gensys", sampleXml, { step: 50.0 });
    assert(typeof gensysResult === "string");
    assert(gensysResult.includes("track_data ="));
  });
});
