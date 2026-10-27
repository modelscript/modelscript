// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolvePlaceholder } from "../src/components/artifacts/card/utils.js";

describe("Engineering Artifact Viewers & Domain Dispatch", () => {
  it("resolves power systems and EMT formats to circuit / network / plot placeholders", () => {
    assert.strictEqual(resolvePlaceholder("pscad"), "circuit");
    assert.strictEqual(resolvePlaceholder("pscx"), "circuit");
    assert.strictEqual(resolvePlaceholder("psout"), "plot");
    assert.strictEqual(resolvePlaceholder("psse"), "network");
    assert.strictEqual(resolvePlaceholder("raw"), "network");
  });

  it("resolves domain modeling languages (process, water, RF, power, AV, nuclear, reservoir, bio, aero)", () => {
    assert.strictEqual(resolvePlaceholder("aspen"), "schematic");
    assert.strictEqual(resolvePlaceholder("swmm"), "hydraulic");
    assert.strictEqual(resolvePlaceholder("touchstone"), "schematic");
    assert.strictEqual(resolvePlaceholder("ibis"), "circuit");
    assert.strictEqual(resolvePlaceholder("opendss"), "network");
    assert.strictEqual(resolvePlaceholder("openscenario"), "schematic");
    assert.strictEqual(resolvePlaceholder("relap5"), "hydraulic");
    assert.strictEqual(resolvePlaceholder("eclipse"), "hydraulic");
    assert.strictEqual(resolvePlaceholder("sbml"), "schematic");
    assert.strictEqual(resolvePlaceholder("jsbsim"), "schematic");
  });

  it("resolves aerospace, marine, pipeline, railway, and multibody engineering formats", () => {
    assert.strictEqual(resolvePlaceholder("easy5"), "schematic");
    assert.strictEqual(resolvePlaceholder("rocets"), "hydraulic");
    assert.strictEqual(resolvePlaceholder("lps"), "hydraulic");
    assert.strictEqual(resolvePlaceholder("sima"), "schematic");
    assert.strictEqual(resolvePlaceholder("gtsuite"), "schematic");
    assert.strictEqual(resolvePlaceholder("gensys"), "schematic");
    assert.strictEqual(resolvePlaceholder("simpack"), "schematic");
    assert.strictEqual(resolvePlaceholder("spck"), "schematic");
    assert.strictEqual(resolvePlaceholder("sim"), "schematic");
    assert.strictEqual(resolvePlaceholder("ssp"), "fmu");
  });

  it("resolves CAE solver decks and aerodynamic configs to physics categories", () => {
    assert.strictEqual(resolvePlaceholder("fea-deck"), "fea");
    assert.strictEqual(resolvePlaceholder("fea-inp"), "fea");
    assert.strictEqual(resolvePlaceholder("cfd-config"), "cfd");
    assert.strictEqual(resolvePlaceholder("cfd-su2"), "cfd");
  });

  it("resolves CAD and tabular datasets accurately", () => {
    assert.strictEqual(resolvePlaceholder("cad-step"), "cad");
    assert.strictEqual(resolvePlaceholder("3d-model"), "cad");
    assert.strictEqual(resolvePlaceholder("csv"), "dataset");
    assert.strictEqual(resolvePlaceholder("tsv"), "dataset");
  });

  it("handles empty or unknown view types gracefully with generic fallback", () => {
    assert.strictEqual(resolvePlaceholder(undefined), "generic");
    assert.strictEqual(resolvePlaceholder("unknown-type"), "generic");
  });
});
