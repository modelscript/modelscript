// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAvailableInspectorSubtabs,
  normalizeInspectorDialect,
} from "../src/workbench/panels/inspector-capabilities.js";

describe("Inspector Dialect Normalization & Capability Gating", () => {
  it("normalizes common file-extension dialect aliases to canonical language IDs", () => {
    assert.equal(normalizeInspectorDialect("mo"), "modelica");
    assert.equal(normalizeInspectorDialect("msx"), "modelica");
    assert.equal(normalizeInspectorDialect("modelscript"), "modelica");
    assert.equal(normalizeInspectorDialect("raw"), "psse");
    assert.equal(normalizeInspectorDialect("dyr"), "psse");
    assert.equal(normalizeInspectorDialect("reqifz"), "reqif");
    assert.equal(normalizeInspectorDialect("aml"), "automationml");
    assert.equal(normalizeInspectorDialect("sysml"), "sysml2");
  });

  it("shows only Domain Inspector for single-file PSS/E (eliminating blind 6-tab clutter)", () => {
    const tabs = getAvailableInspectorSubtabs("psse", { "ieee14.raw": "..." });
    assert.deepEqual(
      tabs.map((t) => t.id),
      ["domain"],
    );
  });

  it("shows only Domain Inspector and Digital Thread for multi-file PSS/E (.raw + .dyr)", () => {
    const tabs = getAvailableInspectorSubtabs("psse", { "case.raw": "...", "case.dyr": "..." });
    assert.deepEqual(
      tabs.map((t) => t.id),
      ["domain", "thread"],
    );
  });

  it("exposes Modelica capabilities (Calibration, RTM, Opt/UQ, REPL) for Modelica models", () => {
    const tabs = getAvailableInspectorSubtabs("mo", { "pendulum.mo": "model Pendulum end Pendulum;" });
    assert.deepEqual(
      tabs.map((t) => t.id),
      ["domain", "calibrate", "rtm", "uq", "repl"],
    );
  });

  it("exposes RTM & Contracts for SysML2 without Modelica-only Calibration/Opt-UQ/REPL", () => {
    const tabs = getAvailableInspectorSubtabs("sysml2", { "reqs.sysml": "requirement R1;" });
    assert.deepEqual(
      tabs.map((t) => t.id),
      ["domain", "rtm"],
    );
  });
});
