// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CstLinkSynthesizer, RtmIndexEngine, type RtmPresetKind } from "../src/rtm/index.js";

describe("RTM Allocation, N^2 Matrix & Batch CST Synthesis", () => {
  it("should provide standard MBSE matrix preset definitions", () => {
    const presets = RtmIndexEngine.getMatrixPresets();
    assert.ok(presets.length >= 6);

    const presetIds: RtmPresetKind[] = [
      "allocations",
      "requirements_satisfy",
      "verification_matrix",
      "interface_n2",
      "derivation_matrix",
      "risk_mitigation",
    ];

    for (const id of presetIds) {
      const p = presets.find((pr) => pr.id === id);
      assert.ok(p, `Preset ${id} must be defined`);
      assert.ok(p.title && p.description);
    }

    const n2 = presets.find((p) => p.id === "interface_n2");
    assert.strictEqual(n2?.rowDomain, "sysml_port");
    assert.strictEqual(n2?.colDomain, "sysml_port");
    assert.strictEqual(n2?.defaultLinkKind, "connect");
  });

  it("should synthesize connect statement between ports", () => {
    const sysmlText = `package Architecture {
  part def Controller {
    port cmdOut;
  }
  part def Motor {
    port cmdIn;
  }
}`;

    const edits = CstLinkSynthesizer.synthesizeSysMLTraceLink(sysmlText, "Controller.cmdOut", "Motor.cmdIn", "connect");

    assert.ok(edits && edits.length === 1);
    assert.ok(edits[0].newText.includes("connect Controller.cmdOut to Motor.cmdIn;"));
  });

  it("should synthesize allocate statement between logical and physical elements", () => {
    const sysmlText = `package AllocationSystem {
  action def CalculateTrajectory;
  part def NavigationComputer;
}`;

    const edits = CstLinkSynthesizer.synthesizeSysMLTraceLink(
      sysmlText,
      "CalculateTrajectory",
      "NavigationComputer",
      "allocate",
    );

    assert.ok(edits && edits.length === 1);
    assert.ok(
      edits[0].newText.includes("allocate to NavigationComputer;") ||
        edits[0].newText.includes("allocate CalculateTrajectory to NavigationComputer;"),
    );
  });

  it("should remove connect and allocate statements cleanly", () => {
    const sysmlText = `package Connections {
  connect p1 to p2;
  allocate act1 to comp1;
  satisfy REQ_001;
}`;

    // Remove connect
    const connectEdits = CstLinkSynthesizer.removeSysMLTraceLink(sysmlText, "p2", "connect", undefined, "p1");
    assert.ok(connectEdits && connectEdits.length === 1);
    assert.strictEqual(connectEdits[0].newText, "");

    // Remove allocate
    const allocEdits = CstLinkSynthesizer.removeSysMLTraceLink(sysmlText, "comp1", "allocate", undefined, "act1");
    assert.ok(allocEdits && allocEdits.length === 1);
    assert.strictEqual(allocEdits[0].newText, "");

    // Remove satisfy
    const satEdits = CstLinkSynthesizer.removeSysMLTraceLink(sysmlText, "REQ_001", "satisfy");
    assert.ok(satEdits && satEdits.length === 1);
    assert.strictEqual(satEdits[0].newText, "");
  });

  it("should classify domains accurately into sysml_port, sysml_activity, and sysml_logical", () => {
    const portEntry: any = { id: 1, name: "pIn", ruleName: "PortUsage" };
    assert.strictEqual(RtmIndexEngine.classifyDomain(portEntry), "sysml_port");

    const actionEntry: any = { id: 2, name: "filterSignal", ruleName: "ActionUsage" };
    assert.strictEqual(RtmIndexEngine.classifyDomain(actionEntry), "sysml_activity");

    const partEntry: any = { id: 3, name: "actuator", ruleName: "PartUsage" };
    assert.strictEqual(RtmIndexEngine.classifyDomain(partEntry), "sysml_logical");

    const hwEntry: any = { id: 4, name: "hw_microcontroller", ruleName: "PartUsage" };
    assert.strictEqual(RtmIndexEngine.classifyDomain(hwEntry), "physical_component");
  });
});
