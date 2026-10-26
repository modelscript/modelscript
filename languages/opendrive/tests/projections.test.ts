// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseOpenDrive } from "../src/parser/index.js";
import { opendriveToGensys } from "../src/projections/index.js";

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <header revMajor="1" revMinor="6" name="TestTrack"/>
  <road id="42" length="50.0" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="50">
        <line/>
      </geometry>
    </planView>
    <elevationProfile>
      <elevation s="0" a="10" b="0.01" c="0" d="0"/>
    </elevationProfile>
    <lateralProfile>
      <superelevation s="0" a="0.03" b="0" c="0" d="0"/>
    </lateralProfile>
    <lanes>
      <laneSection s="0">
        <center><lane id="0" type="none"/></center>
      </laneSection>
    </lanes>
  </road>
</OpenDRIVE>`;

describe("OpenDRIVE Projections to GENSYS Railway & Road Dynamics", () => {
  it("projects OpenDRIVE road to GENSYS track geometry format", () => {
    const doc = parseOpenDrive(sampleXml);
    const gensysDeck = opendriveToGensys(doc, 10.0);

    assert(gensysDeck.includes("! GENSYS Track / Road Geometry Deck"));
    assert(gensysDeck.includes("! Columns: s [m], x [m], y [m], z [m], hdg [rad], curvature [1/m], cant/roll [rad]"));
    assert(gensysDeck.includes("track_data ="));
    assert(gensysDeck.includes("! --- Begin Road: Road_42"));
    assert(gensysDeck.includes("! --- End Road ---"));

    const lines = gensysDeck.split("\n");
    const dataLines = lines.filter((l) => /^\s+\d+\.\d+/.test(l));
    assert(dataLines.length >= 5);

    // Check first sample at s=0: s=0.000, x=0.0000, y=0.0000, z=10.0000, hdg=0.00000, curvature=0.000000, cant/roll=0.03000
    const firstLine = dataLines[0]!.trim().split(/\s+/);
    assert.strictEqual(firstLine[0], "0.000");
    assert.strictEqual(firstLine[1], "0.0000");
    assert.strictEqual(firstLine[2], "0.0000");
    assert.strictEqual(firstLine[3], "10.0000");
    assert.strictEqual(firstLine[6], "0.03000");
  });
});
