// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Pure mapping validator for engineering artifact formats and their corresponding
 * view categories and placeholder fallbacks in ModelScript Web.
 */
function resolveArtifactPlaceholderType(vt?: string): string {
  if (!vt) return "generic";
  const v = vt.toLowerCase();
  if (v === "cfd" || v === "cfd-result" || v === "cfd-animation") return "cfd";
  if (v === "fea" || v === "fea-result") return "fea";
  if (
    v === "cad" ||
    v === "cad-step" ||
    v === "cad_step" ||
    v === "cad-3d-viewer" ||
    v === "step" ||
    v === "stp" ||
    v === "3d-model"
  )
    return "cad";
  if (v === "gcode" || v === "cam-result" || v === "cam") return "gcode";
  if (v === "fmu" || v === "fmi" || v === "fmu-package" || v === "fmu-simulator" || v === "ssp" || v === "ssd")
    return "fmu";
  if (v === "sysml" || v === "sysml2" || v === "sysml-architecture-viewer" || v === "kerml") return "sysml";
  if (v === "dataset" || v === "dataset-table" || v === "csv" || v === "tsv" || v === "json-table") return "dataset";
  if (v === "simulation-plot" || v === "vega" || v === "vega-plot" || v === "psout") return "plot";
  if (
    v === "pscad" ||
    v === "pscx" ||
    v === "pslx" ||
    v === "psse" ||
    v === "raw" ||
    v === "easy5" ||
    v === "rocets" ||
    v === "lps" ||
    v === "sima" ||
    v === "gtsuite" ||
    v === "gensys" ||
    v === "calc" ||
    v === "simpack" ||
    v === "spck" ||
    v === "sim" ||
    v === "aspen" ||
    v === "swmm" ||
    v === "touchstone" ||
    v === "ibis" ||
    v === "opendss" ||
    v === "openscenario" ||
    v === "relap5" ||
    v === "eclipse" ||
    v === "sbml" ||
    v === "jsbsim"
  )
    return "plot";
  if (v === "fea-deck" || v === "fea-inp") return "fea";
  if (v === "cfd-config" || v === "cfd-su2") return "cfd";
  if (v === "pdf" || v === "tei-document") return "pdf";
  return "generic";
}

describe("Engineering Artifact Viewers & Domain Dispatch", () => {
  it("resolves power systems and EMT formats to schematic / telemetry plot placeholders", () => {
    assert.strictEqual(resolveArtifactPlaceholderType("pscad"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("pscx"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("psout"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("psse"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("raw"), "plot");
  });

  it("resolves domain modeling languages (process, water, RF, power, AV, nuclear, reservoir, bio, aero)", () => {
    assert.strictEqual(resolveArtifactPlaceholderType("aspen"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("swmm"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("touchstone"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("ibis"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("opendss"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("openscenario"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("relap5"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("eclipse"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("sbml"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("jsbsim"), "plot");
  });

  it("resolves aerospace, marine, pipeline, railway, and multibody engineering formats", () => {
    assert.strictEqual(resolveArtifactPlaceholderType("easy5"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("rocets"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("lps"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("sima"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("gtsuite"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("gensys"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("calc"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("simpack"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("spck"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("sim"), "plot");
    assert.strictEqual(resolveArtifactPlaceholderType("ssp"), "fmu");
    assert.strictEqual(resolveArtifactPlaceholderType("ssd"), "fmu");
  });

  it("resolves CAE solver decks and aerodynamic configs to physics categories", () => {
    assert.strictEqual(resolveArtifactPlaceholderType("fea-deck"), "fea");
    assert.strictEqual(resolveArtifactPlaceholderType("fea-inp"), "fea");
    assert.strictEqual(resolveArtifactPlaceholderType("cfd-config"), "cfd");
    assert.strictEqual(resolveArtifactPlaceholderType("cfd-su2"), "cfd");
  });

  it("resolves CAD and tabular datasets accurately", () => {
    assert.strictEqual(resolveArtifactPlaceholderType("cad-step"), "cad");
    assert.strictEqual(resolveArtifactPlaceholderType("3d-model"), "cad");
    assert.strictEqual(resolveArtifactPlaceholderType("csv"), "dataset");
    assert.strictEqual(resolveArtifactPlaceholderType("tsv"), "dataset");
  });

  it("handles empty or unknown view types gracefully with generic fallback", () => {
    assert.strictEqual(resolveArtifactPlaceholderType(undefined), "generic");
    assert.strictEqual(resolveArtifactPlaceholderType("unknown-type"), "generic");
  });
});
