// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseAutomationML } from "../src/parser/index.js";
import { amlToModelica, amlToSsp, amlToSysML2 } from "../src/projections/index.js";

describe("AutomationML Projections (SSP, SysML v2, Modelica 3.x)", () => {
  const sampleAml = `
    aml "PackagingLine.aml" version "2.15"
    instanceHierarchy "PackagingSystem" {
      element FeederUnit [id="feed-1", ppr=Resource] {
        frame (x=1.0, y=2.0, z=0.0, rx=0, ry=0, rz=0)
        attribute feedRate: REAL = 3.5 [m/s]
        interface partReady: Out BOOL
      }
      element SealerUnit [id="seal-1", ppr=Resource] {
        attribute sealTemp: REAL = 180.0 [degC]
        interface triggerSeal: In BOOL
      }
      link "FeedToSeal" feed-1:partReady -> seal-1:triggerSeal
    }
  `;

  it("exports AutomationML topology to SSP 1.0 (.ssd) XML", () => {
    const doc = parseAutomationML(sampleAml);
    const ssd = amlToSsp(doc);
    assert(ssd.includes("<ssd:SystemStructureDescription"));
    assert(ssd.includes('<ssd:Component name="FeederUnit"'));
    assert(ssd.includes('<ssd:Component name="SealerUnit"'));
    assert(ssd.includes('<ssd:Connector name="partReady" kind="output">'));
    assert(ssd.includes('<ssd:Connector name="triggerSeal" kind="input">'));
    assert(ssd.includes("<ssd:ElementGeometry"));
    assert(
      ssd.includes(
        '<ssd:Connection startElement="FeederUnit" startConnector="partReady" endElement="SealerUnit" endConnector="triggerSeal" />',
      ),
    );
  });

  it("projects AutomationML topology to OMG SysML v2 part def, part, port, and connect", () => {
    const doc = parseAutomationML(sampleAml);
    const sysml = amlToSysML2(doc);
    assert(sysml.includes("package PackagingSystem"));
    assert(sysml.includes("part def FeederUnitDef"));
    assert(sysml.includes("attribute feedRate : Real = 3.5;"));
    assert(sysml.includes("out port partReady : Signal;"));
    assert(sysml.includes("in port triggerSeal : Signal;"));
    assert(sysml.includes("connect FeederUnit.partReady to SealerUnit.triggerSeal;"));
  });

  it("projects AutomationML topology to Modelica 3.x system model with connect(...) equations", () => {
    const doc = parseAutomationML(sampleAml);
    const mo = amlToModelica(doc);
    assert(mo.includes("model PackagingSystem"));
    assert(mo.includes("parameter Real FeederUnit_feedRate = 3.5;"));
    assert(mo.includes("parameter Real SealerUnit_sealTemp = 180;"));
    assert(mo.includes("connect(FeederUnit.partReady, SealerUnit.triggerSeal);"));
    assert(mo.includes("end PackagingSystem;"));
  });
});
