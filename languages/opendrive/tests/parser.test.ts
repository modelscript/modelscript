// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseOpenDrive } from "../src/parser/index.js";

const sampleOpenDriveXml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <header revMajor="1" revMinor="6" name="Highway_Interchange" version="1.0" date="2026-10-25" north="1000.0" south="-1000.0" east="1000.0" west="-1000.0" vendor="ModelScript"/>
  <road name="Northbound_Highway" length="500.00000000" id="1" junction="-1">
    <link>
      <successor elementType="road" elementId="2" contactPoint="start"/>
    </link>
    <planView>
      <geometry s="0.00000000" x="0.00000000" y="0.00000000" hdg="0.00000000" length="200.00000000">
        <line/>
      </geometry>
      <geometry s="200.00000000" x="200.00000000" y="0.00000000" hdg="0.00000000" length="100.00000000">
        <spiral curvStart="0.00000000" curvEnd="0.01000000"/>
      </geometry>
      <geometry s="300.00000000" x="299.16700000" y="1.66600000" hdg="0.50000000" length="200.00000000">
        <arc curvature="0.01000000"/>
      </geometry>
    </planView>
    <elevationProfile>
      <elevation s="0.00000000" a="12.50000000" b="0.02000000" c="0.00000000" d="0.00000000"/>
    </elevationProfile>
    <lateralProfile>
      <superelevation s="0.00000000" a="0.02500000" b="0.00000000" c="0.00000000" d="0.00000000"/>
    </lateralProfile>
    <lanes>
      <laneSection s="0.00000000">
        <left>
          <lane id="1" type="driving" level="false">
            <link>
              <successor id="1"/>
            </link>
            <width sOffset="0.00000000" a="3.75000000" b="0.00000000" c="0.00000000" d="0.00000000"/>
          </lane>
        </left>
        <center>
          <lane id="0" type="none" level="false"/>
        </center>
        <right>
          <lane id="-1" type="driving" level="false">
            <link>
              <successor id="-1"/>
            </link>
            <width sOffset="0.00000000" a="3.75000000" b="0.00000000" c="0.00000000" d="0.00000000"/>
          </lane>
        </right>
      </laneSection>
    </lanes>
    <signals>
      <signal s="150.00000000" t="4.00000000" id="sig_101" name="SpeedLimit_100" dynamic="no" orientation="+" zOffset="0.0" country="USA" type="100"/>
    </signals>
  </road>
  <road name="Interchange_Ramp" length="150.00000000" id="2" junction="10">
    <planView>
      <geometry s="0.00000000" x="450.00000000" y="100.00000000" hdg="0.50000000" length="150.00000000">
        <line/>
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0.00000000">
        <center>
          <lane id="0" type="none" level="false"/>
        </center>
        <right>
          <lane id="-1" type="driving" level="false">
            <width sOffset="0.00000000" a="3.50000000" b="0.00000000" c="0.00000000" d="0.00000000"/>
          </lane>
        </right>
      </laneSection>
    </lanes>
  </road>
  <junction id="10" name="Highway_Split">
    <connection id="0" incomingRoad="1" connectingRoad="2" contactPoint="start"/>
  </junction>
</OpenDRIVE>`;

describe("ASAM OpenDRIVE Zero-Regex XML Parser", () => {
  it("parses header metadata correctly", () => {
    const doc = parseOpenDrive(sampleOpenDriveXml);
    assert.strictEqual(doc.header.revMajor, 1);
    assert.strictEqual(doc.header.revMinor, 6);
    assert.strictEqual(doc.header.name, "Highway_Interchange");
    assert.strictEqual(doc.header.vendor, "ModelScript");
    assert.strictEqual(doc.header.north, 1000.0);
  });

  it("parses road records, linkages, and signals", () => {
    const doc = parseOpenDrive(sampleOpenDriveXml);
    assert.strictEqual(doc.roads.length, 2);

    const r1 = doc.roads[0]!;
    assert.strictEqual(r1.id, "1");
    assert.strictEqual(r1.name, "Northbound_Highway");
    assert.strictEqual(r1.length, 500.0);
    assert.strictEqual(r1.junction, "-1");
    assert.strictEqual(r1.link?.successor?.elementType, "road");
    assert.strictEqual(r1.link?.successor?.elementId, "2");

    // Signals
    assert.strictEqual(r1.signals.length, 1);
    assert.strictEqual(r1.signals[0]!.id, "sig_101");
    assert.strictEqual(r1.signals[0]!.name, "SpeedLimit_100");
    assert.strictEqual(r1.signals[0]!.s, 150.0);
  });

  it("parses composite planView geometry segments", () => {
    const doc = parseOpenDrive(sampleOpenDriveXml);
    const r1 = doc.roads[0]!;
    assert.strictEqual(r1.planView.length, 3);

    // Segment 0: Line
    assert.strictEqual(r1.planView[0]!.type, "line");
    assert.strictEqual(r1.planView[0]!.length, 200.0);

    // Segment 1: Spiral (Clothoid)
    const sp = r1.planView[1]!;
    assert.strictEqual(sp.type, "spiral");
    if (sp.type === "spiral") {
      assert.strictEqual(sp.curvStart, 0.0);
      assert.strictEqual(sp.curvEnd, 0.01);
    }

    // Segment 2: Arc
    const arc = r1.planView[2]!;
    assert.strictEqual(arc.type, "arc");
    if (arc.type === "arc") {
      assert.strictEqual(arc.curvature, 0.01);
    }
  });

  it("parses elevation profile, lateral profile, and lane sections", () => {
    const doc = parseOpenDrive(sampleOpenDriveXml);
    const r1 = doc.roads[0]!;

    // Elevation
    assert.strictEqual(r1.elevationProfile.length, 1);
    assert.strictEqual(r1.elevationProfile[0]!.a, 12.5);
    assert.strictEqual(r1.elevationProfile[0]!.b, 0.02);

    // Lateral profile
    assert.strictEqual(r1.lateralProfile.length, 1);
    assert.strictEqual(r1.lateralProfile[0]!.a, 0.025);

    // Lanes
    assert.strictEqual(r1.lanes.laneSections.length, 1);
    const sec = r1.lanes.laneSections[0]!;
    assert.strictEqual(sec.s, 0.0);
    assert.strictEqual(sec.centerLane.id, 0);
    assert.strictEqual(sec.leftLanes.length, 1);
    assert.strictEqual(sec.leftLanes[0]!.id, 1);
    assert.strictEqual(sec.leftLanes[0]!.widthRecords[0]!.a, 3.75);
    assert.strictEqual(sec.rightLanes.length, 1);
    assert.strictEqual(sec.rightLanes[0]!.id, -1);
  });

  it("parses junction and connecting road definitions", () => {
    const doc = parseOpenDrive(sampleOpenDriveXml);
    assert.strictEqual(doc.junctions.length, 1);
    const junc = doc.junctions[0]!;
    assert.strictEqual(junc.id, "10");
    assert.strictEqual(junc.name, "Highway_Split");
    assert.strictEqual(junc.connections.length, 1);
    assert.strictEqual(junc.connections[0]!.incomingRoad, "1");
    assert.strictEqual(junc.connections[0]!.connectingRoad, "2");
  });
});
