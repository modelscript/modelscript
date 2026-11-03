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

  it("wires interactive wheel-zoom, 3-layer collision-free SVG routing, and Protégé-style Tree explorer in Owl2Viewer", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const owlViewerSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/Owl2Viewer.tsx"),
      "utf8",
    );

    assert.ok(owlViewerSrc.includes("useWheelZoom"), "Owl2Viewer must wire useWheelZoom on the primary graph viewport");
    assert.ok(
      owlViewerSrc.includes("ZoomHintBadge"),
      "Owl2Viewer must display ZoomHintBadge for feed scroll protection",
    );
    assert.ok(
      owlViewerSrc.includes("owl-edges-layer") &&
        owlViewerSrc.includes("owl-nodes-layer") &&
        owlViewerSrc.includes("owl-edge-labels-layer"),
      "Owl2Viewer must render SVG in 3 layers (edges -> nodes -> edge labels) so labels are never occluded by cards",
    );
    assert.ok(
      owlViewerSrc.includes("TreeSplitContainer") && owlViewerSrc.includes("totalEntities > 20"),
      "Owl2Viewer must include a hierarchical Tree explorer and auto-switch to Tree view for large ontologies",
    );
  });

  it("wires interactive 3D Three.js viewport, C3D8 hexahedral tessellation, BC/load vectors, and Stress/Deform HUD in FeaDeckViewer", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const feaViewerSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/FeaDeckViewer.tsx"),
      "utf8",
    );

    assert.ok(
      feaViewerSrc.includes("<Canvas") && feaViewerSrc.includes("ViewportCameraControls"),
      "FeaDeckViewer must mount an interactive 3D Three.js Canvas with ViewportCameraControls",
    );
    assert.ok(
      feaViewerSrc.includes("build3DDeckGeometries") && feaViewerSrc.includes("clippingPlanes"),
      "FeaDeckViewer must build 3D solid/edge BufferGeometries and support X/Y/Z section clipping planes",
    );
    assert.ok(
      feaViewerSrc.includes("STRESS") && feaViewerSrc.includes("DEFORM") && feaViewerSrc.includes("QUALITY"),
      "FeaDeckViewer must provide Stress, Deform, and Quality 3D inspection modes in the viewport HUD",
    );
  });
});
