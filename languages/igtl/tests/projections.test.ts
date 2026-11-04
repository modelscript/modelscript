// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseIgtl } from "../src/parser/index.js";
import { igtlToModelica, igtlToUrdf } from "../src/projections/index.js";

describe("OpenIGTLink / PLUS Projections to ROS URDF and Modelica", () => {
  const sampleDoc = parseIgtl(`<PlusConfiguration version="2.1">
    <DataCollection>
      <DeviceSet Name="Nav">
        <Device Id="TrackerDevice" Type="PolarisTracker" AcquisitionRate="60">
          <OutputChannels><OutputChannel Id="TrackerStream"/></OutputChannels>
        </Device>
      </DeviceSet>
    </DataCollection>
    <CoordinateDefinitions>
      <Transform From="StylusTip" To="Stylus" Matrix="1 0 0 0  0 1 0 0  0 0 1 150  0 0 0 1" Error="0.35"/>
      <Transform From="Stylus" To="Reference" Matrix="1 0 0 10  0 1 0 20  0 0 1 30  0 0 0 1" Error="0.22"/>
    </CoordinateDefinitions>
  </PlusConfiguration>`);

  it("projects coordinate frame transforms to ROS URDF (<robot>) XML", () => {
    const urdf = igtlToUrdf(sampleDoc, "PolarisNavigationRig");
    assert(urdf.includes('<robot name="PolarisNavigationRig">'));
    assert(urdf.includes('<link name="StylusTip"/>'));
    assert(urdf.includes('<link name="Reference"/>'));
    assert(urdf.includes('<joint name="StylusTipToStylus_joint" type="fixed">'));
    assert(urdf.includes('<origin xyz="0 0 0.15"'));
  });

  it("projects surgical navigation setup and SE(3) transforms to Modelica 3.x (.mo)", () => {
    const mo = igtlToModelica(sampleDoc, "PolarisNavModel");
    assert(mo.includes("model PolarisNavModel"));
    assert(mo.includes('parameter Real TrackerDevice_AcquisitionRate(unit="Hz") = 60;'));
    assert(mo.includes('parameter Real StylusTipToStylus_Tz(unit="mm") = 150;'));
    assert(mo.includes("end PolarisNavModel;"));
  });
});
