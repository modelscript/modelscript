// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnsatzSketchIcon, DraftingTriangleIcon, SketchIcon } from "../src/components/icons/AnsatzSketchIcon";

describe("Ansatz Sketch Blueprint Icon & Routing Architecture", () => {
  it("verifies public/ansatz-sketch.svg contains authentic blueprint drafting geometry", () => {
    const svgPath = path.resolve(import.meta.dirname, "../public/ansatz-sketch.svg");
    assert.ok(fs.existsSync(svgPath), "public/ansatz-sketch.svg must exist");
    const svgContent = fs.readFileSync(svgPath, "utf-8");

    // Dimensions and canvas
    assert.ok(svgContent.includes('viewBox="0 0 48 48"'), "SVG must use 48x48 coordinate viewBox");
    assert.ok(svgContent.includes("blueprintBg"), "Must define deep blueprint linear gradient");
    assert.ok(svgContent.includes("blueprintGlow"), "Must define blueprint radial glow gradient");

    // Blueprint gridlines
    assert.ok(svgContent.includes('<line x1="8" y1="4"'), "Must include vertical drafting gridlines");
    assert.ok(svgContent.includes('<line x1="4" y1="8"'), "Must include horizontal drafting gridlines");

    // Technical registration corner marks
    assert.ok(svgContent.includes("M 4 8 L 7 8"), "Must include top-left registration corner mark");

    // Axonometric / isometric engineering block
    assert.ok(svgContent.includes('points="22,13 33,19 22,25 11,19"'), "Must render isometric top face");
    assert.ok(svgContent.includes('points="11,19 22,25 22,37 11,31"'), "Must render isometric left face");
    assert.ok(svgContent.includes('points="22,25 33,19 33,31 22,37"'), "Must render isometric right face");

    // Cylindrical bore with center crosshair
    assert.ok(svgContent.includes('<ellipse cx="22" cy="19"'), "Must render cylindrical bore on top face");

    // Hidden projection lines (dashed)
    assert.ok(svgContent.includes('stroke-dasharray="2 1.5"'), "Must include dashed hidden projection lines");

    // Dimension witness lines
    assert.ok(svgContent.includes('line x1="10" y1="19" x2="6.5" y2="19"'), "Must include extension witness line");
    assert.ok(svgContent.includes('line x1="7.5" y1="19" x2="7.5" y2="31"'), "Must include dimension line");

    // Drafting pencil / technical stylus
    assert.ok(svgContent.includes('id="drafting-stylus"'), "Must contain drafting stylus element");
    assert.ok(svgContent.includes("pencilSpark"), "Must render active drawing spark/glow at stylus point");
  });

  it("renders AnsatzSketchIcon React component with blueprint mode by default", () => {
    const html = renderToStaticMarkup(React.createElement(AnsatzSketchIcon, { size: 32 }));

    assert.ok(html.includes('width="32"'), "Should apply requested size width");
    assert.ok(html.includes('height="32"'), "Should apply requested size height");
    assert.ok(html.includes('viewBox="0 0 48 48"'), "Blueprint variant should have 48x48 viewBox");
    assert.ok(html.includes("drafting-stylus"), "Should include drafting stylus in blueprint mode");
    assert.ok(html.includes("ansatz-sketch-icon"), "Should apply default CSS class");
  });

  it("renders AnsatzSketchIcon React component with crisp outline mode", () => {
    const html = renderToStaticMarkup(
      React.createElement(AnsatzSketchIcon, {
        size: 20,
        variant: "outline",
        color: "#38bdf8",
      }),
    );

    assert.ok(html.includes('width="20"'), "Should apply size 20");
    assert.ok(html.includes('viewBox="0 0 24 24"'), "Outline variant should have 24x24 viewBox");
    assert.ok(html.includes('points="11,6 16.5,9 11,12 5.5,9"'), "Should render compact isometric block");
    assert.ok(html.includes('<line x1="16.5" y1="14.5" x2="20.5" y2="10.5"'), "Should render stylus drafting line");
  });

  it("renders AnsatzSketchIcon React component with crisp drafting triangle mode", () => {
    const html = renderToStaticMarkup(
      React.createElement(AnsatzSketchIcon, {
        size: 16,
        variant: "triangle",
        color: "#ffffff",
      }),
    );

    assert.ok(html.includes('width="16"'), "Should apply size 16");
    assert.ok(html.includes('viewBox="0 0 24 24"'), "Triangle variant should have 24x24 viewBox");
    assert.ok(html.includes('d="M3 21h18L3 3v18z"'), "Should render outer set square right triangle");
    assert.ok(html.includes('d="M7 17h6L7 11v6z"'), "Should render inner set square cutout");
    assert.ok(html.includes("ansatz-sketch-triangle"), "Should include ansatz-sketch-triangle CSS class");

    const helperHtml = renderToStaticMarkup(
      React.createElement(DraftingTriangleIcon, {
        size: 18,
      }),
    );
    assert.ok(helperHtml.includes('d="M3 21h18L3 3v18z"'), "DraftingTriangleIcon helper must render triangle geometry");
  });

  it("exports SketchIcon as an alias for AnsatzSketchIcon", () => {
    assert.strictEqual(SketchIcon, AnsatzSketchIcon, "SketchIcon must be an exact alias of AnsatzSketchIcon");
  });

  it("verifies Caddyfile redirects morsel.modelscript.org to ansatz.org/sketch", () => {
    const caddyPath = path.resolve(import.meta.dirname, "../../../config/Caddyfile");
    const caddySrc = fs.readFileSync(caddyPath, "utf-8");

    assert.ok(
      caddySrc.includes("morsel.modelscript.org {"),
      "Caddyfile must define morsel.modelscript.org server block",
    );
    assert.ok(
      caddySrc.includes("redir @embed https://ansatz.org/embed/sketch{?query} permanent"),
      "Caddyfile must redirect embed paths to https://ansatz.org/embed/sketch",
    );
    assert.ok(
      caddySrc.includes("redir @root https://ansatz.org/sketch{?query} permanent"),
      "Caddyfile must redirect root path to https://ansatz.org/sketch",
    );
    assert.ok(
      caddySrc.includes("redir https://ansatz.org/sketch{uri} permanent"),
      "Caddyfile must redirect arbitrary paths under https://ansatz.org/sketch",
    );
    assert.ok(caddySrc.includes("ide.modelscript.org {"), "Caddyfile must define ide.modelscript.org server block");
    assert.ok(
      caddySrc.includes("redir @root https://ansatz.social/studio{?query} permanent"),
      "Caddyfile must redirect ide.modelscript.org root to https://ansatz.social/studio",
    );
    assert.ok(
      caddySrc.includes("redir @ide https://ansatz.social/studio{?query} permanent"),
      "Caddyfile must redirect ide.modelscript.org /ide to https://ansatz.social/studio",
    );
    assert.ok(
      caddySrc.includes("redir https://ansatz.social/studio{uri} permanent"),
      "Caddyfile must redirect ide.modelscript.org arbitrary paths under https://ansatz.social/studio",
    );
  });

  it("verifies App.tsx mounts /sketch and /studio with backward-compatible redirects", () => {
    const appPath = path.resolve(import.meta.dirname, "../src/App.tsx");
    const appSrc = fs.readFileSync(appPath, "utf-8");

    assert.ok(
      appSrc.includes('<Route path="/sketch" element={<PlaygroundPage />} />'),
      "App.tsx must route /sketch to PlaygroundPage",
    );
    assert.ok(
      appSrc.includes('<Route path="/embed/sketch" element={<EmbedPlaygroundPage />} />'),
      "App.tsx must route /embed/sketch to EmbedPlaygroundPage",
    );
    assert.ok(
      appSrc.includes('<Route path="/morsel" element={<PreserveParamsNavigate to="/sketch" />} />'),
      "App.tsx must redirect /morsel to /sketch",
    );
    assert.ok(
      appSrc.includes('<Route path="/embed/morsel" element={<PreserveParamsNavigate to="/embed/sketch" />} />'),
      "App.tsx must redirect /embed/morsel to /embed/sketch",
    );
    assert.ok(
      appSrc.includes('<Route path="/studio" element={hasIde ? <IdeWorkspacePage /> : <IdeFallbackNavigate />} />'),
      "App.tsx must route /studio to IdeWorkspacePage",
    );
    assert.ok(
      appSrc.includes('<Route path="/ide" element={<PreserveParamsNavigate to="/studio" />} />'),
      "App.tsx must redirect /ide to /studio",
    );
  });

  it("verifies Sidebar.tsx integrates AnsatzSketchIcon in split button pointing to /sketch and omits redundant top-left icon", () => {
    const sidebarPath = path.resolve(import.meta.dirname, "../src/components/Sidebar.tsx");
    const sidebarSrc = fs.readFileSync(sidebarPath, "utf-8");

    assert.ok(sidebarSrc.includes('to="/sketch"'), "Sidebar.tsx must link sketch button to /sketch");
    assert.ok(sidebarSrc.includes("AnsatzSketchIcon"), "Sidebar.tsx must render AnsatzSketchIcon");
    assert.ok(
      sidebarSrc.includes('title="Ansatz Sketch"'),
      "Sidebar.tsx sketch button must have title='Ansatz Sketch'",
    );
    assert.ok(
      !sidebarSrc.includes("<BrandSketchLink") && !sidebarSrc.includes("<BrandPlaygroundLink"),
      "Sidebar.tsx must not render redundant BrandSketchLink in brand row",
    );
  });

  it("verifies post components and artifact card viewers use DraftingTriangleIcon and 'Sketch' label", () => {
    // CardFooter.tsx
    const cardFooterPath = path.resolve(import.meta.dirname, "../src/components/artifacts/card/CardFooter.tsx");
    const cardFooterSrc = fs.readFileSync(cardFooterPath, "utf-8");
    assert.ok(cardFooterSrc.includes("DraftingTriangleIcon"), "CardFooter must import and render DraftingTriangleIcon");
    assert.ok(
      cardFooterSrc.includes('aria-label="Open in Sketch"'),
      "CardFooter must have aria-label='Open in Sketch'",
    );
    assert.ok(
      cardFooterSrc.includes('data-tip={"Sketch\\nEdit and run in the browser"}'),
      "CardFooter must have Sketch tooltip",
    );

    // ModelicaCodeViewer.tsx
    const codeViewerPath = path.resolve(import.meta.dirname, "../src/components/artifacts/ModelicaCodeViewer.tsx");
    const codeViewerSrc = fs.readFileSync(codeViewerPath, "utf-8");
    assert.ok(
      codeViewerSrc.includes("leadingVisual={DraftingTriangleIcon}"),
      "ModelicaCodeViewer must use DraftingTriangleIcon",
    );
    assert.ok(codeViewerSrc.includes("Open in Sketch"), "ModelicaCodeViewer must say 'Open in Sketch'");
    assert.ok(codeViewerSrc.includes("navigate(`/sketch"), "ModelicaCodeViewer must navigate to /sketch");

    // ModelicaDiagramViewer.tsx
    const diagViewerPath = path.resolve(import.meta.dirname, "../src/components/artifacts/ModelicaDiagramViewer.tsx");
    const diagViewerSrc = fs.readFileSync(diagViewerPath, "utf-8");
    assert.ok(
      diagViewerSrc.includes("leadingVisual={DraftingTriangleIcon}"),
      "ModelicaDiagramViewer must use DraftingTriangleIcon",
    );
    assert.ok(diagViewerSrc.includes("return `/sketch"), "ModelicaDiagramViewer must return /sketch in getForkUrl");

    // PostBodyContent.tsx
    const postBodyPath = path.resolve(import.meta.dirname, "../src/components/post/PostBodyContent.tsx");
    const postBodySrc = fs.readFileSync(postBodyPath, "utf-8");
    assert.ok(postBodySrc.includes("<DraftingTriangleIcon"), "PostBodyContent must render DraftingTriangleIcon");
    assert.ok(postBodySrc.includes("Open in Sketch"), "PostBodyContent must say 'Open in Sketch'");

    // PostMarkdownContent.tsx
    const postMdPath = path.resolve(import.meta.dirname, "../src/components/post/PostMarkdownContent.tsx");
    const postMdSrc = fs.readFileSync(postMdPath, "utf-8");
    assert.ok(postMdSrc.includes("Open in Sketch"), "PostMarkdownContent must say 'Open in Sketch'");
    assert.ok(postMdSrc.includes("navigate(`/sketch#m="), "PostMarkdownContent must navigate to /sketch");

    // PostActionMenu.tsx
    const postActionPath = path.resolve(import.meta.dirname, "../src/components/post/PostActionMenu.tsx");
    const postActionSrc = fs.readFileSync(postActionPath, "utf-8");
    assert.ok(
      postActionSrc.includes("<DraftingTriangleIcon size={16} /> Edit Artifact in Sketch / VS Code"),
      "PostActionMenu must say Sketch / VS Code",
    );

    // Polyglot and specialized viewers
    const specializedViewers = [
      "CadStepViewer.tsx",
      "CfdConfigViewer.tsx",
      "Easy5Viewer.tsx",
      "FeaDeckViewer.tsx",
      "FmuViewer.tsx",
      "FortranViewer.tsx",
      "GensysViewer.tsx",
      "GtSuiteViewer.tsx",
      "OlgaFlowViewer.tsx",
      "Owl2Viewer.tsx",
      "PipelineLpsViewer.tsx",
      "PolyglotArtifactViewer.tsx",
      "PscadViewer.tsx",
      "PsoutViewer.tsx",
      "PsseSldViewer.tsx",
      "QifViewer.tsx",
      "ReqifViewer.tsx",
      "RocetsViewer.tsx",
      "SimaViewer.tsx",
      "SimpackViewer.tsx",
      "SspViewer.tsx",
      "SysmlViewer.tsx",
    ];

    for (const viewerFile of specializedViewers) {
      const viewerPath = path.resolve(import.meta.dirname, "../src/components/artifacts", viewerFile);
      const viewerSrc = fs.readFileSync(viewerPath, "utf-8");
      assert.ok(viewerSrc.includes("DraftingTriangleIcon"), `${viewerFile} must import and use DraftingTriangleIcon`);
      assert.ok(!viewerSrc.includes("Open in Playground"), `${viewerFile} must not contain 'Open in Playground'`);
    }
  });
});
