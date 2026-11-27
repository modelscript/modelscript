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

  it("wires unified language panel for OWL2 in languages/owl2/src/ui/Owl2Panel.tsx", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const owlPanelPath = path.resolve(import.meta.dirname, "../../../languages/owl2/src/ui/Owl2Panel.tsx");
    assert.ok(fs.existsSync(owlPanelPath), "Owl2Panel.tsx must exist in languages/owl2/src/ui/");
    const owlPanelSrc = fs.readFileSync(owlPanelPath, "utf8");
    assert.ok(owlPanelSrc.length > 0, "Owl2Panel.tsx must be non-empty");
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

  it("wires dynamic client-side OSCAL Authorization Boundary SVG rendering in PolyglotArtifactViewer", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const polyglotSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/PolyglotArtifactViewer.tsx"),
      "utf8",
    );

    assert.ok(
      polyglotSrc.includes('import { renderOscalBoundarySvg } from "@modelscript/diagram/oscal-diagram-builder"'),
      "PolyglotArtifactViewer must import renderOscalBoundarySvg",
    );
    assert.ok(
      polyglotSrc.includes('import { parseOscal } from "@modelscript/oscal"'),
      "PolyglotArtifactViewer must import parseOscal",
    );
    assert.ok(
      polyglotSrc.includes('if (normalizedLang === "oscal") {'),
      "PolyglotArtifactViewer must handle oscal in renderSourceToDiagramSvg",
    );
    assert.ok(
      polyglotSrc.includes("renderOscalBoundarySvg(diagramDoc)"),
      "PolyglotArtifactViewer must render OSCAL boundary SVG from source",
    );
  });

  it("verifies PscadPanel and SspViewer statically import and bind client-side parsers", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const pscadPanelPath = path.resolve(import.meta.dirname, "../../../languages/pscad/src/ui/PscadPanel.tsx");
    assert.ok(fs.existsSync(pscadPanelPath), "PscadPanel.tsx must exist in languages/pscad/src/ui/");

    const sspSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/SspViewer.tsx"),
      "utf8",
    );
    assert.match(
      sspSrc,
      /import\s*\{[^}]*parseSsdClientModel[^}]*\}\s*from\s*["']\.\/ssp-client-parser\.js["']/,
      "SspViewer must explicitly import parseSsdClientModel to bind it in local scope",
    );
  });

  it("supports animated digital twin formulation cell posts with program steps and 3D toolpath traces in UrdfPanel/MultibodyViewport3D", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const urdfPanelPath = path.resolve(import.meta.dirname, "../../../languages/urdf/src/ui/UrdfPanel.tsx");
    assert.ok(fs.existsSync(urdfPanelPath), "UrdfPanel.tsx must exist in languages/urdf/src/ui/");

    const viewportSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/MultibodyViewport3D.tsx"),
      "utf8",
    );
    assert.ok(
      viewportSrc.includes("toolpathCurve") && viewportSrc.includes("CatmullRomCurve3"),
      "MultibodyViewport3D must construct a 3D CatmullRom spline ribbon for toolpath tracing",
    );
    assert.ok(
      viewportSrc.includes("environment") && viewportSrc.toLowerCase().includes("workstation"),
      "MultibodyViewport3D must support environment fixtures such as tables and collision hulls",
    );

    const cadMeshesSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/UrdfRobotCadMeshes.tsx"),
      "utf8",
    );
    assert.ok(
      cadMeshesSrc.includes("ur3e_base") &&
        cadMeshesSrc.includes("ur3e_shoulder") &&
        cadMeshesSrc.includes("ur3e_upper_arm") &&
        cadMeshesSrc.includes("robotiq_gripper") &&
        cadMeshesSrc.includes("cnc_gantry_carriage") &&
        cadMeshesSrc.includes("workstation_cabinet") &&
        cadMeshesSrc.includes("reactor_mixer") &&
        cadMeshesSrc.includes("vial_rack"),
      "UrdfRobotCadMeshes must provide detailed procedural 3D CAD sub-assemblies for UR3e cobot, Robotiq gripper, CNC gantry, and workstation fixtures",
    );
  });

  it("verifies Ecosystem Cards (SolutionViewCard, PackageViewCard, RepositoryViewCard, LinkPreviewViewer) imports and routing safety", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const solutionSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/SolutionViewCard.tsx"),
      "utf8",
    );
    assert.ok(
      solutionSrc.includes("Button") && solutionSrc.includes("Text") && solutionSrc.includes("Spinner"),
      "SolutionViewCard must import Button, Text, and Spinner for fullscreen modal rendering",
    );
    assert.ok(solutionSrc.includes("`/@${author}`"), "SolutionViewCard must link author profiles using /@${author}");

    const repoSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/RepositoryViewCard.tsx"),
      "utf8",
    );
    assert.ok(
      repoSrc.includes('pathSegments.slice(0, -1).join("/")'),
      "RepositoryViewCard must preserve multi-segment GitLab subgroup namespaces",
    );

    const editorRoutingSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/util/editor-routing.ts"),
      "utf8",
    );
    for (const nonEditable of ["package", "library", "repository", "repo", "solution"]) {
      assert.ok(
        editorRoutingSrc.includes(`"${nonEditable}"`),
        `NON_EDITABLE_MEDIA_VIEW_TYPES must include '${nonEditable}'`,
      );
    }
  });

  it("verifies Media & Document Viewers (PictureViewer, VideoViewer, AudioViewer, PdfViewer) spatial pins, audio controls, and double-download prevention", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const pictureSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/PictureViewer.tsx"),
      "utf8",
    );
    assert.ok(
      pictureSrc.includes("ImageStageWrapper") && pictureSrc.includes("imgRef.current"),
      "PictureViewer must render spatial pins inside ImageStageWrapper within ImageTransformLayer and normalize against imgRef bounding rect",
    );

    const videoSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/VideoViewer.tsx"),
      "utf8",
    );
    assert.ok(
      videoSrc.includes("muted={isMuted}") && videoSrc.includes("VolumeSlider"),
      "VideoViewer must bind muted={isMuted} and render unmute/volume controls",
    );

    const audioSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/AudioViewer.tsx"),
      "utf8",
    );
    assert.ok(
      audioSrc.includes('preload="metadata"') && audioSrc.includes("AbortController"),
      "AudioViewer must use preload='metadata' and AbortController to prevent duplicate full-file downloads",
    );
  });

  it("verifies unified Domain Engineering Panels (LpsPanel, OlgaPanel, PsseSldViewer, SimaPanel) exist", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    for (const rel of [
      "../../../languages/lps/src/ui/LpsPanel.tsx",
      "../../../languages/olga/src/ui/OlgaPanel.tsx",
      "../src/components/artifacts/PsseSldViewer.tsx",
      "../../../languages/sima/src/ui/SimaPanel.tsx",
    ]) {
      const fullPath = path.resolve(import.meta.dirname, rel);
      assert.ok(fs.existsSync(fullPath), `Expected domain panel at ${rel}`);
    }
  });

  it("verifies 3D & Multiphysics Viewers (CadStepViewer, SimulationResultViewer, FlowStreaks, vtu-parser) B-Rep ear-clipping and CellData support", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const cadStepSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/CadStepViewer.tsx"),
      "utf8",
    );
    assert.ok(
      cadStepSrc.includes("triangulatePolygonEarClip") && cadStepSrc.includes("sameSense"),
      "CadStepViewer must use 2D projected ear-clipping triangulation and respect EDGE_CURVE same_sense",
    );

    const vtuSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/util/vtu-parser.ts"), "utf8");
    assert.ok(
      vtuSrc.includes("CellData") && vtuSrc.includes("Float64Array"),
      "vtu-parser must promote CellData scalar fields and support typed binary arrays",
    );
  });
});
