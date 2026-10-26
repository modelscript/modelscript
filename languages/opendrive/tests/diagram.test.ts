// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { renderOpenDriveSvg } from "../src/diagram/index.js";
import { parseOpenDrive } from "../src/parser/index.js";

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <header revMajor="1" revMinor="6" name="Highway_Visual"/>
  <road id="1" name="Main_Route" length="100.0" junction="-1">
    <planView>
      <geometry s="0" x="0" y="0" hdg="0" length="50"><line/></geometry>
      <geometry s="50" x="50" y="0" hdg="0" length="50"><arc curvature="0.02"/></geometry>
    </planView>
    <lanes>
      <laneSection s="0">
        <left><lane id="1" type="driving"><width sOffset="0" a="3.5" b="0" c="0" d="0"/></lane></left>
        <center><lane id="0" type="none"/></center>
        <right><lane id="-1" type="driving"><width sOffset="0" a="3.5" b="0" c="0" d="0"/></lane></right>
      </laneSection>
    </lanes>
  </road>
  <junction id="20" name="Junction_A">
    <connection id="0" incomingRoad="1" connectingRoad="1" contactPoint="start"/>
  </junction>
</OpenDRIVE>`;

describe("OpenDRIVE Vector SVG Road Visualizer", () => {
  it("renders well-formed dark-mode SVG markup with asphalt and reference lines", () => {
    const doc = parseOpenDrive(sampleXml);
    const svg = renderOpenDriveSvg(doc, { theme: "dark" });

    assert(svg.startsWith("<svg"), "Must start with <svg root tag");
    assert(svg.endsWith("</svg>"), "Must end with </svg> close tag");
    assert(svg.includes("viewBox="), "Must contain dynamic viewBox");
    assert(svg.includes("<polygon"), "Must contain asphalt road polygon");
    assert(svg.includes("<path"), "Must contain road center line path");
    assert(svg.includes("#f59e0b") || svg.includes("#d97706"), "Must contain yellow/golden center line");
    assert(svg.includes("Main_Route (#1)"), "Must render road label");
    assert(svg.includes("Junction 20"), "Must render junction badge");
  });

  it("supports light mode theme rendering", () => {
    const doc = parseOpenDrive(sampleXml);
    const svg = renderOpenDriveSvg(doc, { theme: "light" });

    assert(svg.includes("#f8fafc"), "Must use light background color");
    assert(svg.includes("<polygon"), "Must render asphalt polygon in light mode");
  });
});
