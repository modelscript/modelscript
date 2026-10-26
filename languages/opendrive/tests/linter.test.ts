// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintOpenDrive, OpenDriveErrorCode } from "../src/lints/index.js";
import { parseOpenDrive } from "../src/parser/index.js";

describe("OpenDRIVE Pre-Flight Diagnostic Linters (M7801–M7808)", () => {
  it("M7807: detects duplicate road ID in roadway network", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <OpenDRIVE>
      <header revMajor="1" revMinor="6"/>
      <road id="1" length="100.0" junction="-1">
        <planView><geometry s="0" x="0" y="0" hdg="0" length="100"><line/></geometry></planView>
        <lanes><laneSection s="0"><center><lane id="0" type="none"/></center></laneSection></lanes>
      </road>
      <road id="1" length="100.0" junction="-1">
        <planView><geometry s="0" x="200" y="0" hdg="0" length="100"><line/></geometry></planView>
        <lanes><laneSection s="0"><center><lane id="0" type="none"/></center></laneSection></lanes>
      </road>
    </OpenDRIVE>`;

    const doc = parseOpenDrive(xml);
    const diags = lintOpenDrive(doc);
    assert(diags.some((d) => d.code === OpenDriveErrorCode.DUPLICATE_ROAD_ID.code));
  });

  it("M7801: detects road tangency discontinuity between geometry segments", () => {
    // Segment 1 ends at (100, 0), but segment 2 starts at (150, 20)
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <OpenDRIVE>
      <header revMajor="1" revMinor="6"/>
      <road id="10" length="200.0" junction="-1">
        <planView>
          <geometry s="0" x="0" y="0" hdg="0" length="100"><line/></geometry>
          <geometry s="100" x="150" y="20" hdg="0" length="100"><line/></geometry>
        </planView>
        <lanes><laneSection s="0"><center><lane id="0" type="none"/></center></laneSection></lanes>
      </road>
    </OpenDRIVE>`;

    const doc = parseOpenDrive(xml);
    const diags = lintOpenDrive(doc);
    assert(diags.some((d) => d.code === OpenDriveErrorCode.ROAD_TANGENCY_DISCONTINUITY.code));
  });

  it("M7803: detects clothoid curvature rate divergence", () => {
    // Curvature goes from 0 to 100 1/m over length 1m -> kDot = 100 > 10.0
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <OpenDRIVE>
      <header revMajor="1" revMinor="6"/>
      <road id="1" length="1.0" junction="-1">
        <planView>
          <geometry s="0" x="0" y="0" hdg="0" length="1.0">
            <spiral curvStart="0.0" curvEnd="100.0"/>
          </geometry>
        </planView>
        <lanes><laneSection s="0"><center><lane id="0" type="none"/></center></laneSection></lanes>
      </road>
    </OpenDRIVE>`;

    const doc = parseOpenDrive(xml);
    const diags = lintOpenDrive(doc);
    assert(diags.some((d) => d.code === OpenDriveErrorCode.CLOTHOID_CURVATURE_DIVERGENCE.code));
  });

  it("M7805: detects extreme elevation gradient exceeding 15%", () => {
    // b = 0.25 -> slope 25% > 15%
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <OpenDRIVE>
      <header revMajor="1" revMinor="6"/>
      <road id="1" length="100.0" junction="-1">
        <planView><geometry s="0" x="0" y="0" hdg="0" length="100"><line/></geometry></planView>
        <elevationProfile>
          <elevation s="0" a="0" b="0.25" c="0" d="0"/>
        </elevationProfile>
        <lanes><laneSection s="0"><center><lane id="0" type="none"/></center></laneSection></lanes>
      </road>
    </OpenDRIVE>`;

    const doc = parseOpenDrive(xml);
    const diags = lintOpenDrive(doc);
    assert(diags.some((d) => d.code === OpenDriveErrorCode.ELEVATION_GRADIENT_EXTREME.code));
  });

  it("M7806: detects negative or zero lane width in driving lane", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <OpenDRIVE>
      <header revMajor="1" revMinor="6"/>
      <road id="1" length="100.0" junction="-1">
        <planView><geometry s="0" x="0" y="0" hdg="0" length="100"><line/></geometry></planView>
        <lanes>
          <laneSection s="0">
            <center><lane id="0" type="none"/></center>
            <right>
              <lane id="-1" type="driving">
                <width sOffset="0" a="-2.5" b="0" c="0" d="0"/>
              </lane>
            </right>
          </laneSection>
        </lanes>
      </road>
    </OpenDRIVE>`;

    const doc = parseOpenDrive(xml);
    const diags = lintOpenDrive(doc);
    assert(diags.some((d) => d.code === OpenDriveErrorCode.NEGATIVE_LANE_WIDTH.code));
  });

  it("M7808: detects missing center lane (ID 0) in lane section", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <OpenDRIVE>
      <header revMajor="1" revMinor="6"/>
      <road id="1" length="100.0" junction="-1">
        <planView><geometry s="0" x="0" y="0" hdg="0" length="100"><line/></geometry></planView>
        <lanes>
          <laneSection s="0">
            <!-- Missing center lane -->
            <right>
              <lane id="-1" type="driving">
                <width sOffset="0" a="3.5" b="0" c="0" d="0"/>
              </lane>
            </right>
          </laneSection>
        </lanes>
      </road>
    </OpenDRIVE>`;

    const doc = parseOpenDrive(xml);
    // Since centerLane is initialized as ID 0 with type "none" in parser when omitted,
    // let's test directly with corrupted document or missing center lane
    doc.roads[0]!.lanes.laneSections[0]!.centerLane = undefined as any;
    const diags = lintOpenDrive(doc);
    assert(diags.some((d) => d.code === OpenDriveErrorCode.MISSING_CENTER_LANE.code));
  });

  it("M7804: warns on duplicate overlapping junction paths", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <OpenDRIVE>
      <header revMajor="1" revMinor="6"/>
      <junction id="1">
        <connection id="0" incomingRoad="1" connectingRoad="2" contactPoint="start"/>
        <connection id="1" incomingRoad="1" connectingRoad="2" contactPoint="start"/>
      </junction>
    </OpenDRIVE>`;

    const doc = parseOpenDrive(xml);
    const diags = lintOpenDrive(doc);
    assert(diags.some((d) => d.code === OpenDriveErrorCode.OVERLAPPING_JUNCTION_PATHS.code));
  });

  it("passes clean road model with zero diagnostics", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <OpenDRIVE>
      <header revMajor="1" revMinor="6"/>
      <road id="1" length="100.0" junction="-1">
        <planView>
          <geometry s="0" x="0" y="0" hdg="0" length="50"><line/></geometry>
          <geometry s="50" x="50" y="0" hdg="0" length="50"><line/></geometry>
        </planView>
        <lanes>
          <laneSection s="0">
            <center><lane id="0" type="none"/></center>
            <right>
              <lane id="-1" type="driving">
                <width sOffset="0" a="3.5" b="0" c="0" d="0"/>
              </lane>
            </right>
          </laneSection>
        </lanes>
      </road>
    </OpenDRIVE>`;

    const doc = parseOpenDrive(xml);
    const diags = lintOpenDrive(doc);
    assert.strictEqual(diags.length, 0);
  });
});
