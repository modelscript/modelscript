// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lowerOpenDriveToDae } from "../src/dae/index.js";
import { parseOpenDrive } from "../src/parser/index.js";

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <header revMajor="1" revMinor="6" name="Highway_Section"/>
  <road id="101" length="250.0" junction="-1">
    <planView>
      <geometry s="0" x="10" y="20" hdg="0.5" length="250">
        <line/>
      </geometry>
    </planView>
    <elevationProfile>
      <elevation s="0" a="100.0" b="0.03" c="0" d="0"/>
    </elevationProfile>
    <lateralProfile>
      <superelevation s="0" a="0.04" b="0" c="0" d="0"/>
    </lateralProfile>
    <lanes>
      <laneSection s="0">
        <center><lane id="0" type="none"/></center>
        <right><lane id="-1" type="driving"><width sOffset="0" a="3.5" b="0" c="0" d="0"/></lane></right>
      </laneSection>
    </lanes>
  </road>
</OpenDRIVE>`;

describe("OpenDRIVE Zero-GC Linear DAE Lowering", () => {
  it("lowers road tracking states and kinematic equations into DAEBuilder", () => {
    const doc = parseOpenDrive(sampleXml);
    const arena = lowerOpenDriveToDae(doc);

    assert(arena.getVarCount() >= 7, `Expected at least 7 variables, got ${arena.getVarCount()}`);
    assert(arena.getEqCount() >= 7, `Expected at least 7 equations, got ${arena.getEqCount()}`);

    // Verify variable definitions
    const varNames = arena.variables().map((v) => v.name);

    assert(varNames.includes("road_101_s"), "Must contain arc length state s");
    assert(varNames.includes("road_101_v"), "Must contain velocity state/parameter v");
    assert(varNames.includes("road_101_x"), "Must contain Cartesian X coordinate");
    assert(varNames.includes("road_101_y"), "Must contain Cartesian Y coordinate");
    assert(varNames.includes("road_101_z"), "Must contain Cartesian Z elevation");
    assert(varNames.includes("road_101_curvature"), "Must contain curvature");
    assert(varNames.includes("road_101_roll"), "Must contain roll (banking)");
  });

  it("handles multiple roads in road network", () => {
    const multiRoadXml = `<?xml version="1.0" encoding="UTF-8"?>
    <OpenDRIVE>
      <header revMajor="1" revMinor="6"/>
      <road id="1" length="100.0" junction="-1">
        <planView><geometry s="0" x="0" y="0" hdg="0" length="100"><line/></geometry></planView>
        <lanes><laneSection s="0"><center><lane id="0" type="none"/></center></laneSection></lanes>
      </road>
      <road id="2" length="100.0" junction="-1">
        <planView><geometry s="0" x="100" y="0" hdg="0" length="100"><line/></geometry></planView>
        <lanes><laneSection s="0"><center><lane id="0" type="none"/></center></laneSection></lanes>
      </road>
    </OpenDRIVE>`;

    const doc = parseOpenDrive(multiRoadXml);
    const arena = lowerOpenDriveToDae(doc);

    assert(arena.getVarCount() >= 14, `Expected at least 14 variables for 2 roads, got ${arena.getVarCount()}`);
  });
});
