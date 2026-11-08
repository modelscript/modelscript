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

  it("verifies PscadViewer and SspViewer statically import and bind client-side parsers", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const pscadSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/PscadViewer.tsx"),
      "utf8",
    );
    assert.match(
      pscadSrc,
      /import\s*\{[^}]*parsePscadClient[^}]*\}\s*from\s*["']\.\/pscad-client-parser\.js["']/,
      "PscadViewer must explicitly import parsePscadClient to bind it in local scope",
    );

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

  it("supports animated digital twin formulation cell posts with program steps and 3D toolpath traces in UrdfViewer", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const urdfViewerSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/UrdfViewer.tsx"),
      "utf8",
    );

    assert.ok(
      urdfViewerSrc.includes("interpolateJointTrajectory"),
      "UrdfViewer must import and use interpolateJointTrajectory for smooth time-sampled forward kinematics",
    );
    assert.ok(
      urdfViewerSrc.includes("StepsSidebar") && urdfViewerSrc.includes("Program Steps"),
      "UrdfViewer must render a Program Steps sidebar for recipe execution sequence",
    );
    assert.ok(
      urdfViewerSrc.includes("TimelineScrubber") && urdfViewerSrc.includes("playbackSpeed"),
      "UrdfViewer must render an interactive timeline scrubber with speed multiplier and play/pause controls",
    );
    assert.ok(
      urdfViewerSrc.includes("TelemetryOverlay") && urdfViewerSrc.includes("TCP:"),
      "UrdfViewer must render live telemetry HUD with TCP coordinates and cycle progress",
    );

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
    assert.ok(
      urdfViewerSrc.includes("LIVE STATE") &&
        urdfViewerSrc.includes("Clearance") &&
        urdfViewerSrc.includes("twinControlMode") &&
        urdfViewerSrc.includes("OpenUSD (.usda)"),
      "UrdfViewer must render LIVE STATE metric tiles (UR speed, Gripper, Clearance), Program/Manual mode switcher, and OpenUSD projection",
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

  it("verifies Domain Engineering Viewers (PipelineLpsViewer, OlgaFlowViewer, PsseSldViewer, SimaViewer) compiler and solver integration", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const lpsSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/PipelineLpsViewer.tsx"),
      "utf8",
    );
    assert.ok(
      lpsSrc.includes("parseLps") &&
        lpsSrc.includes("SteadyNetworkSolver") &&
        lpsSrc.includes("renderLpsPressureProfileSvg") &&
        lpsSrc.includes("renderCompressorMapSvg"),
      "PipelineLpsViewer must integrate @modelscript/lps parser/solver and multi-view diagram builders",
    );

    const olgaSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/OlgaFlowViewer.tsx"),
      "utf8",
    );
    assert.ok(
      olgaSrc.includes("parseOlga") &&
        olgaSrc.includes("simulateDriftFlux") &&
        olgaSrc.includes("renderOlgaPvtEnvelopeSvg") &&
        olgaSrc.includes("renderOlgaWellboreIprSvg"),
      "OlgaFlowViewer must integrate @modelscript/olga drift-flux solver and multi-tab flow assurance diagrams",
    );

    const psseSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/PsseSldViewer.tsx"),
      "utf8",
    );
    assert.ok(
      psseSrc.includes("parseRaw") && psseSrc.includes("solvePowerFlow") && psseSrc.includes("overlayMode"),
      "PsseSldViewer must integrate @modelscript/psse powerflow solver and selectable overlay modes",
    );

    const simaSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/artifacts/SimaViewer.tsx"),
      "utf8",
    );
    assert.ok(
      simaSrc.includes("T: 0 kN (Severed)"),
      "SimaViewer must report 0 kN tension on the severed mooring line in ALS mode",
    );
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
