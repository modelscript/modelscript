// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { renderKinematicDiagramSvg } from "@modelscript/diagram/kinematic-diagram-builder";
import { renderOlgaSchematicSvg } from "@modelscript/diagram/olga-diagram-builder";
import { renderPscadSvg } from "@modelscript/diagram/pscad-diagram-builder";
import { renderPsseSldSvg } from "@modelscript/diagram/psse-diagram-builder";
import { renderQifMbdHeatmapSvg } from "@modelscript/diagram/qif-diagram-builder";
import {
  buildSimulinkDiagram,
  parseSimulinkTextToSystem,
  renderSimulinkSvg,
} from "@modelscript/diagram/simulink-diagram-builder";
import { adaptSvgMarkupForTheme } from "../src/components/artifacts/svg-theme.js";
import {
  extractCadComponents,
  parseSourceCadVariables,
} from "../src/components/morsel/cad-viewer/parse-cad-annotations.js";
import { applyLspTextEditsToString } from "../src/components/morsel/util/text-edits.js";

describe("Embedded Artifact Viewers UX/UI & Diagram Editing Regression Suite", () => {
  describe("1. Diagram-Only Editing Without Mounted Monaco Editor (applyLspTextEditsToString)", () => {
    it("applies single-line LSP text edits accurately when Monaco is unmounted", () => {
      const source = [
        "model RC",
        "  Resistor R1(R=10);",
        "  Capacitor C1(C=0.01);",
        "equation",
        "  connect(R1.n, C1.p);",
        "end RC;",
      ].join("\n");

      const updated = applyLspTextEditsToString(source, [
        {
          range: {
            start: { line: 1, character: 16 },
            end: { line: 1, character: 18 },
          },
          newText: "47",
        },
      ]);

      assert.ok(updated.includes("Resistor R1(R=47);"));
      assert.ok(updated.includes("connect(R1.n, C1.p);"));
    });

    it("applies multiple non-overlapping LSP edits in reverse document order without offset drift", () => {
      const source = ["line0", "line1", "line2"].join("\n");
      const updated = applyLspTextEditsToString(source, [
        {
          range: {
            start: { line: 0, character: 4 },
            end: { line: 0, character: 5 },
          },
          newText: "_A",
        },
        {
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 5 },
          },
          newText: "_C",
        },
      ]);

      assert.strictEqual(updated, ["line_A", "line1", "line_C"].join("\n"));
    });

    it("returns original text unchanged when edits array is empty", () => {
      const source = "model Test\nend Test;";
      assert.strictEqual(applyLspTextEditsToString(source, []), source);
    });
  });

  describe("2. Client-Side Engineering Schematic Synthesis Fallbacks", () => {
    it("synthesizes PSCAD EMT schematic SVG from source when viewConfig.svg is absent", () => {
      const svg = renderPscadSvg({
        name: "IEEE 39-Bus EMT Feeder",
        rootModule: {
          name: "Main",
          buses: [],
          components: [
            {
              id: "G1",
              definitionName: "master:source_3",
              instanceName: "SyncGen1",
              position: { x: 120, y: 140 },
              parameters: { Name: "SyncGen1", Vbase: "345" },
            },
            {
              id: "T1",
              definitionName: "master:xfmr-3p2w",
              instanceName: "StepUp_T1",
              position: { x: 320, y: 140 },
              parameters: { Name: "StepUp_T1", Tmva: "500" },
            },
          ],
          wires: [
            {
              id: "W1",
              vertices: [
                { x: 160, y: 140 },
                { x: 320, y: 140 },
              ],
            },
          ],
        },
      });
      assert.ok(svg.includes("<svg"), "Must produce valid SVG markup");
      assert.ok(svg.includes("SyncGen1"), "Must include generator label");
    });

    it("synthesizes PSS/E Single-Line Diagram SVG from buses and branches", () => {
      const svg = renderPsseSldSvg({
        title1: "WECC 9-Bus System",
        buses: [
          { i: 1, name: "BUS-1", baseKv: 230, ide: 3, vm: 1.04, va: 0 },
          { i: 2, name: "BUS-2", baseKv: 230, ide: 2, vm: 1.025, va: 9.3 },
        ],
        branches: [{ i: 1, j: 2, ckt: "1", r: 0.01, x: 0.085, b: 0.176, st: 1 }],
        generators: [{ i: 1, id: "1", pg: 71.6, qg: 27.0, stat: 1 }],
        loads: [{ i: 2, id: "1", pl: 125.0, ql: 50.0, status: 1 }],
      });
      assert.ok(svg.includes("<svg"), "Must produce valid SLD SVG");
      assert.ok(svg.includes("BUS-1"), "Must render bus labels");
    });

    it("synthesizes OLGA multiphase pipeline profile and kinematic multibody schematics", () => {
      const olgaSvg = renderOlgaSchematicSvg({
        title: "Subsea Tieback Flowline",
        flowpaths: [
          {
            name: "Flowline-1",
            pipes: [
              { label: "P1", length: 2500, elevation: -120, diameter: 0.3 },
              { label: "P2", length: 800, elevation: 450, diameter: 0.25 },
            ],
            valves: [{ name: "CHOKE-1", position: 3000, diameter: 0.2, opening: 0.8 }],
          },
        ],
        nodes: [
          { name: "WELLHEAD", type: "MASS", flowpath: "Flowline-1", boundaryPosition: 0, pressure: 120 },
          { name: "SEPARATOR", type: "PRESSURE", flowpath: "Flowline-1", boundaryPosition: 3300, pressure: 45 },
        ],
      });
      assert.ok(olgaSvg.includes("<svg"), "Must produce OLGA schematic SVG");

      const mbdSvg = renderKinematicDiagramSvg({
        name: "BoBo Railway Bogie",
        dialect: "SIMPACK",
        bodies: [
          { id: "Ground", name: "Inertial Ground", isGround: true },
          { id: "Carbody", name: "Carbody", mass: 32000 },
          { id: "Bogie1", name: "Bogie1", mass: 2600 },
        ],
        joints: [
          { id: "J_Yaw", name: "J_Yaw", type: "revolute", fromBody: "Ground", toBody: "Bogie1" },
          { id: "J_Sec", name: "J_Sec", type: "spring_damper", fromBody: "Bogie1", toBody: "Carbody" },
        ],
      });
      assert.ok(mbdSvg.includes("<svg"), "Must produce SIMPACK/GENSYS kinematic SVG");
    });

    it("synthesizes Easy5 / Simulink control block schematics with explicit dark background rect and topological ranks", () => {
      const mdlText = `
Model {
  Name "CAT3b_Autoland_Flare_Decrab"
  System {
    Name "CAT3b_Autoland_Flare_Decrab"
    Block { BlockType Inport Name "Radio_Altimeter_h" }
    Block { BlockType Gain Name "Flare_Law_Gain" Gain "-0.18" }
    Block { BlockType Sum Name "Summing_Junction" Inputs "+-" }
    Block { BlockType TransferFcn Name "Elevator_Servo" Numerator "[25]" Denominator "[1 25]" }
    Block { BlockType TransferFcn Name "Pitch_Rate_Dynamics" Numerator "[1.4 0.8]" Denominator "[1 2.1 4.5]" }
    Block { BlockType Outport Name "Pitch_Command_deg" }
    Block { BlockType Step Name "Autoland_Mode_Engage" }
    Line { SrcBlock "Radio_Altimeter_h" SrcPort 1 DstBlock "Flare_Law_Gain" DstPort 1 }
    Line { SrcBlock "Flare_Law_Gain" SrcPort 1 DstBlock "Summing_Junction" DstPort 1 }
    Line { SrcBlock "Autoland_Mode_Engage" SrcPort 1 DstBlock "Summing_Junction" DstPort 2 }
    Line { SrcBlock "Summing_Junction" SrcPort 1 DstBlock "Elevator_Servo" DstPort 1 }
    Line { SrcBlock "Elevator_Servo" SrcPort 1 DstBlock "Pitch_Rate_Dynamics" DstPort 1 }
    Line { SrcBlock "Pitch_Rate_Dynamics" SrcPort 1 DstBlock "Pitch_Command_deg" DstPort 1 }
  }
}
`;
      const parsed = parseSimulinkTextToSystem(mdlText, "CAT3b_Autoland_Flare_Decrab");
      assert.ok(parsed, "Must parse ASCII .mdl text into SimulinkModelLike");
      assert.strictEqual(parsed.rootSystem.blocks.length, 7);
      assert.strictEqual(parsed.rootSystem.lines.length, 6);

      const layout = buildSimulinkDiagram(parsed);
      const flareCell = layout.cells.find((c) => c.id === "block_Flare_Law_Gain");
      const engageCell = layout.cells.find((c) => c.id === "block_Autoland_Mode_Engage");
      const sumCell = layout.cells.find((c) => c.id === "block_Summing_Junction");
      assert.ok(flareCell && engageCell && sumCell, "Must lay out all blocks");
      assert.strictEqual(
        engageCell.x,
        flareCell.x,
        "Source block feeding Summing_Junction must be pulled forward to the column immediately preceding Summing_Junction",
      );
      assert.ok(
        (sumCell.x ?? 0) > (flareCell.x ?? 0),
        "Summing_Junction must be in the column to the right of its inputs",
      );

      const svg = renderSimulinkSvg(parsed);
      assert.ok(
        svg.includes('fill="#0b0f19"'),
        "Must include explicit dark background <rect> so DOMPurify cannot strip it",
      );
      assert.ok(svg.includes("1.4s + 0.8"), "Must render multi-line TransferFcn numerator");
      assert.ok(svg.includes("s² + 2.1s + 4.5"), "Must render multi-line TransferFcn denominator");
    });
  });

  describe("3. Multi-Instance Isolation & Responsive Viewport Contracts", () => {
    it("isolates X6 Graph instances per container in @modelscript/diagram", () => {
      const diagramSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../../../packages/diagram/src/index.ts"),
        "utf8",
      );
      assert.ok(
        diagramSrc.includes("containerInstances = new Map<HTMLElement, ContainerDiagramInstance>()"),
        "packages/diagram/src/index.ts must maintain a per-container Map<HTMLElement, ContainerDiagramInstance> instead of a global singleton",
      );
    });

    it("assigns unique LSP document URIs per Morsel instance and allows diagram-only edits", () => {
      const morselSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/morsel/Morsel.tsx"),
        "utf8",
      );
      assert.ok(
        morselSrc.includes("file:///embed_${nextEmbedMorselId++}_document"),
        "Morsel must assign a unique per-instance LSP URI to prevent cross-card AST collisions",
      );
      assert.ok(
        morselSrc.includes("applyLspTextEditsToString"),
        "Morsel must apply LSP text edits directly to source state when Monaco is unmounted",
      );
    });

    it("preserves data-* attributes and unclamps fullscreen SVG height in PolyglotArtifactViewer", () => {
      const polyglotSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/PolyglotArtifactViewer.tsx"),
        "utf8",
      );
      assert.ok(
        polyglotSrc.includes('"data-fmu"') &&
          polyglotSrc.includes('"data-line-index"') &&
          polyglotSrc.includes('"data-reqif-id"'),
        "sanitizeSvgMarkup must preserve data-* attributes for interactive SVG node selection",
      );
      assert.ok(
        polyglotSrc.includes("export const InteractiveSvgStage"),
        "PolyglotArtifactViewer must export reusable InteractiveSvgStage for pan/zoom SVG inspection",
      );
    });

    it("avoids duplicate title repetition in CardFooter for self-titled engineering viewers", () => {
      const footerSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/card/CardFooter.tsx"),
        "utf8",
      );
      assert.ok(
        footerSrc.includes("isUntitledMediaOr3dViewer"),
        "CardFooter must distinguish untitled media/3D viewers from self-titled engineering viewers",
      );
    });

    it("forces standalone: false in ViewerDispatcher and removes cluttered right-side telemetry panels", () => {
      const dispatcherSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/card/ViewerDispatcher.tsx"),
        "utf8",
      );
      assert.ok(
        dispatcherSrc.includes("standalone: false"),
        "ViewerDispatcher must force standalone: false so embedded viewers do not duplicate CardFooter's Open in Playground button",
      );

      const viewersWithoutTelemetrySidebar = [
        "PolyglotArtifactViewer.tsx",
        "RocetsViewer.tsx",
        "PipelineLpsViewer.tsx",
        "FeaDeckViewer.tsx",
        "CfdConfigViewer.tsx",
        "PscadViewer.tsx",
        "PsseSldViewer.tsx",
        "OlgaFlowViewer.tsx",
        "Easy5Viewer.tsx",
        "GtSuiteViewer.tsx",
      ];
      for (const file of viewersWithoutTelemetrySidebar) {
        const src = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/artifacts", file), "utf8");
        assert.ok(
          !src.includes("Hide Telemetry"),
          `${file} must not include a cluttered right-side Telemetry sidebar toggle`,
        );
      }

      const reqifSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/ReqifViewer.tsx"),
        "utf8",
      );
      assert.ok(
        !reqifSrc.includes("/morsel?m="),
        "ReqifViewer must route to /playground#m= rather than legacy /morsel?m=",
      );
    });

    it("extracts primary simulatable Modelica class and ensures LSP parser readiness before simulation", async () => {
      const { extractPrimaryModelicaClassName } = await import("../src/components/morsel/util/lsp-bridge.js");
      const multiClassSnippet = [
        "connector Pin",
        "  Real v;",
        "  flow Real i;",
        "end Pin;",
        "model Resistor",
        "  Pin p, n;",
        "  parameter Real R = 100;",
        "equation",
        "  p.v - n.v = R * p.i;",
        "  p.i + n.i = 0;",
        "end Resistor;",
        "model Capacitor",
        "  Pin p, n;",
        "  parameter Real C = 1e-3;",
        "equation",
        "  C * der(p.v - n.v) = p.i;",
        "  p.i + n.i = 0;",
        "end Capacitor;",
        "model MySystem",
        "  Resistor R1(R=100);",
        "  Capacitor C1(C=1e-3);",
        "equation",
        "  connect(R1.n, C1.p);",
        "  annotation(experiment(StopTime=1.0));",
        "end MySystem;",
      ].join("\n");

      assert.strictEqual(
        extractPrimaryModelicaClassName(multiClassSnippet),
        "MySystem",
        "Must select MySystem (with experiment annotation / system model) over preceding connector/component classes",
      );

      const simEndpointsSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../../../packages/lsp/src/handlers/simulationEndpoints.ts"),
        "utf8",
      );
      assert.ok(
        simEndpointsSrc.includes("ensureLanguageParserLoaded") && simEndpointsSrc.includes("flushValidation"),
        "modelscript/simulate handler must ensure WASM parser is loaded and flush validation before resolving target class",
      );

      const parserServiceSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../../../packages/lsp/src/services/parser-service.ts"),
        "utf8",
      );
      assert.ok(
        parserServiceSrc.includes("ensureSharedContext()"),
        "ParserService must initialize sharedContext immediately so early didOpen validations index symbols",
      );
    });

    it("gates Run on HPC behind cae_cloud_solver feature flag and enforces high-contrast light/dark mode tokens", () => {
      const gatedFiles = [
        "../src/components/artifacts/ArtifactViewCard.tsx",
        "../src/components/artifacts/card/CardFooter.tsx",
        "../src/components/artifacts/card/StudioHeader.tsx",
        "../src/components/morsel/panels/MorselFloatingDock.tsx",
        "../src/components/morsel/panels/MorselVisualizerPane.tsx",
      ];
      for (const relPath of gatedFiles) {
        const src = fs.readFileSync(path.resolve(import.meta.dirname, relPath), "utf8");
        assert.ok(
          src.includes('useFeatureFlag("cae_cloud_solver")'),
          `${relPath} must gate Cloud HPC actions behind useFeatureFlag("cae_cloud_solver")`,
        );
      }

      const modelicaViewerSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/ModelicaDiagramViewer.tsx"),
        "utf8",
      );
      assert.ok(
        !modelicaViewerSrc.includes('bg="rgba(0,0,0,0.25)"'),
        "ModelicaDiagramViewer must not use low-contrast muddy rgba(0,0,0,0.25) tab bar background in light mode",
      );
      assert.ok(
        modelicaViewerSrc.includes('svg.includes("RC Step Response")'),
        "ModelicaDiagramViewer must reject legacy hardcoded RC Step Response placeholder SVGs",
      );

      const postBodySrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/post/PostBodyContent.tsx"),
        "utf8",
      );
      assert.ok(
        !postBodySrc.includes('background: "rgba(0, 0, 0, 0.18)"'),
        "PostBodyContent must not use muddy rgba(0, 0, 0, 0.18) figure caption background",
      );
      assert.ok(
        postBodySrc.includes('cell.caption.trim() !== (cell.title || "").trim()'),
        "PostBodyContent must omit redundant Fig. N caption when caption is empty or identical to card title",
      );
    });

    it("unifies RenderArtifactPage with Full-Screen Studio shell while preserving chromeless thumbnail mode", () => {
      const renderArtifactSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/pages/RenderArtifactPage.tsx"),
        "utf8",
      );
      assert.ok(
        renderArtifactSrc.includes("StudioHeader") && renderArtifactSrc.includes("StudioInspectorSidebar"),
        "RenderArtifactPage must render StudioHeader and StudioInspectorSidebar for full-screen Studio parity",
      );
      assert.ok(
        renderArtifactSrc.includes("isChromeless") &&
          renderArtifactSrc.includes('searchParams.get("thumbnail")') &&
          renderArtifactSrc.includes("__ARTIFACT_READY"),
        "RenderArtifactPage must preserve chromeless rendering and __ARTIFACT_READY for headless thumbnail capture",
      );
      assert.ok(
        renderArtifactSrc.includes('useFeatureFlag("cae_cloud_solver")'),
        "RenderArtifactPage must gate Cloud HPC actions behind cae_cloud_solver feature flag",
      );
    });

    it("supports multi-file maps, stateful view permalinks, and ?morsel=<id> parity across Playground and Embed", async () => {
      const { compressMorselPayload, decompressMorselPayload, resolveMorselShortlink } =
        await import("../src/components/morsel/util/permalink");
      assert.strictEqual(typeof resolveMorselShortlink, "function");

      const multiFilePayload = {
        v: 1,
        lang: "modelica",
        code: "model Main\n  Real x;\nend Main;",
        files: {
          "Main.mo": "model Main\n  Real x;\nend Main;",
          "Sub.mo": "model Sub\n  Real y;\nend Sub;",
        },
        activeFile: "Main.mo",
        isMultiFile: true,
        title: "Multi-File System",
        view: "simulation",
      };
      const token = compressMorselPayload(multiFilePayload);
      const decoded = decompressMorselPayload(`#m=${token}`);
      assert.ok(decoded, "Must decompress multi-file morsel payload");
      assert.strictEqual(decoded?.activeFile, "Main.mo");
      assert.strictEqual(decoded?.view, "simulation");
      assert.deepStrictEqual(decoded?.files, multiFilePayload.files);

      const playgroundSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/pages/PlaygroundPage.tsx"),
        "utf8",
      );
      const embedSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/pages/EmbedPlaygroundPage.tsx"),
        "utf8",
      );
      assert.ok(
        playgroundSrc.includes("resolveMorselShortlink") && embedSrc.includes("resolveMorselShortlink"),
        "Both PlaygroundPage and EmbedPlaygroundPage must share resolveMorselShortlink for ?morsel=<id> parity",
      );
      assert.ok(
        playgroundSrc.includes('aria-label="Project files"') && playgroundSrc.includes("onActiveViewChange"),
        "PlaygroundPage must render multi-file project tabs and synchronize active view changes",
      );
    });

    it("provides interactive Diagram/Simulate modes in ModelicaCodeViewer and dual cursors/stats in SimulationPlotViewer", () => {
      const codeViewerSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/ModelicaCodeViewer.tsx"),
        "utf8",
      );
      assert.ok(
        codeViewerSrc.includes("MorselEditor") &&
          codeViewerSrc.includes('"simulate"') &&
          codeViewerSrc.includes('"split"'),
        "ModelicaCodeViewer must support interactive Diagram, Simulate, and Split modes backed by MorselEditor",
      );

      const simPlotSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/SimulationPlotViewer.tsx"),
        "utf8",
      );
      assert.ok(
        simPlotSrc.includes("cursorReadout") &&
          simPlotSrc.includes("ReferenceLine") &&
          simPlotSrc.includes("Norm [0,1]") &&
          simPlotSrc.includes("variableStats"),
        "SimulationPlotViewer must support dual measurement cursors (C1/C2), [0,1] normalization, and variable statistics drawer",
      );
    });

    it("uses a single bluish container without duplicate inner grey rounded borders or top/bottom margin gaps", () => {
      const cardSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/ArtifactViewCard.tsx"),
        "utf8",
      );
      assert.ok(
        cardSrc.includes('background="var(--ms-brand-soft)"') &&
          cardSrc.includes("var(--color-accent-blue-border") &&
          !cardSrc.includes("mt={2}"),
        "ArtifactViewCard must be the single canonical bluish container without mt={2} top gaps",
      );

      const postBodySrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/post/PostBodyContent.tsx"),
        "utf8",
      );
      assert.ok(
        postBodySrc.includes("figureNumber={currentFigNum}") && postBodySrc.includes("caption={distinctCaption}"),
        "PostBodyContent must delegate figure caption rendering to ArtifactViewCard without double-wrapping in a second bordered box",
      );

      const dispatcherSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/card/ViewerDispatcher.tsx"),
        "utf8",
      );
      assert.ok(
        dispatcherSrc.includes("EmbeddedViewerSlot") && dispatcherSrc.includes("border-radius: 0 !important"),
        "ViewerDispatcher must strip inner borders and border-radius from embedded viewer root nodes",
      );

      const modelicaDiagramSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/ModelicaDiagramViewer.tsx"),
        "utf8",
      );
      assert.ok(
        modelicaDiagramSrc.includes("props.$isFullScreen || !props.$standalone") &&
          modelicaDiagramSrc.includes("background: var(--ms-brand-soft"),
        "ModelicaDiagramViewer must omit inner rounded borders when embedded and use the bluish container background on CardToolbar",
      );

      const footerSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/card/CardFooter.tsx"),
        "utf8",
      );
      assert.ok(
        footerSrc.includes('backgroundColor="var(--ms-brand-soft, var(--color-canvas-subtle))"'),
        "CardFooter must use the bluish container background seamlessly with the outer ArtifactViewCard",
      );
    });

    it("maintains deterministic viewer height before, during, and after loading spinners disappear", () => {
      const dispatcherSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/card/ViewerDispatcher.tsx"),
        "utf8",
      );
      assert.ok(
        dispatcherSrc.includes("export function getViewerExpectedHeight") &&
          dispatcherSrc.includes("height={expectedHeight}") &&
          !dispatcherSrc.includes('minHeight="120px"'),
        "ViewerDispatcher Suspense fallback must match the target viewer's exact height instead of collapsing to 120px",
      );

      const cardSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/ArtifactViewCard.tsx"),
        "utf8",
      );
      assert.ok(
        cardSrc.includes("getViewerExpectedHeight") && cardSrc.includes("height={expectedViewerHeight}"),
        "ArtifactViewCard loading state must reserve the expected viewer height plus 40px footer bar",
      );

      const lazyHeavySrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/LazyHeavyViewer.tsx"),
        "utf8",
      );
      assert.ok(
        lazyHeavySrc.includes("<Suspense"),
        "LazyHeavyViewer must wrap lazy 3D children in a local Suspense boundary to preserve its 450px container",
      );

      const polyglotSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/PolyglotArtifactViewer.tsx"),
        "utf8",
      );
      assert.ok(
        polyglotSrc.includes('height: ${(p) => (p.$isFullScreen ? "100%" : "440px")}'),
        "PolyglotArtifactViewer must use a fixed 440px non-fullscreen height so loadingText spinner completion does not shift height",
      );

      const fortranSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/FortranViewer.tsx"),
        "utf8",
      );
      assert.ok(
        fortranSrc.includes('height: ${(p) => (p.$isFullScreen ? "100%" : "440px")}'),
        "FortranViewer must use a fixed 440px non-fullscreen height across loading and loaded states",
      );

      const vegaSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/VegaViewer.tsx"),
        "utf8",
      );
      assert.ok(
        !vegaSrc.includes('"340px"'),
        "VegaViewer loading state must match its 440px loaded Wrapper height instead of 340px",
      );

      const gcodeSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/GCodeViewer.tsx"),
        "utf8",
      );
      assert.ok(
        !gcodeSrc.includes('height="300px"') &&
          !gcodeSrc.includes('height={isFullScreen ? "100%" : "400px"}') &&
          gcodeSrc.includes('height={isFullScreen ? "100%" : "450px"}'),
        "GCodeViewer loading, empty, and loaded states must match LazyHeavyViewer's 450px height",
      );
    });

    it("provides 3D section cutting planes, surface point probing, context-aware Command Palette actions, and stateful parameter permalinks", () => {
      const camControlsSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/ViewportCameraControls.tsx"),
        "utf8",
      );
      assert.ok(
        camControlsSrc.includes("export type ClipAxis") &&
          camControlsSrc.includes("onClipAxisChange") &&
          camControlsSrc.includes("Section cutting plane offset"),
        "ViewportCameraControls must support X/Y/Z section cutting plane controls and offset slider",
      );

      const cadStepSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/CadStepViewer.tsx"),
        "utf8",
      );
      assert.ok(
        cadStepSrc.includes("localClippingEnabled: true") &&
          cadStepSrc.includes("activeClippingPlanes") &&
          cadStepSrc.includes("probedPoint"),
        "CadStepViewer must support localClippingEnabled section planes and 3D surface point coordinate probing",
      );

      const morselCadSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/morsel/cad-viewer/CadViewer.tsx"),
        "utf8",
      );
      assert.ok(
        morselCadSrc.includes("clipAxis") &&
          morselCadSrc.includes("explosionFactor") &&
          morselCadSrc.includes("Assembly explode factor"),
        "Morsel CadViewer must include interactive section cutting planes and assembly explosion slider",
      );

      const cmdPaletteSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/CommandPalette.tsx"),
        "utf8",
      );
      assert.ok(
        cmdPaletteSrc.includes("action-eng-simulate") &&
          cmdPaletteSrc.includes("modelscript:morsel-command") &&
          cmdPaletteSrc.includes("Switch View: Simulation Oscilloscope"),
        "CommandPalette must expose context-aware Engineering & Simulation actions on /playground and /render-artifact routes",
      );

      const playgroundSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/pages/PlaygroundPage.tsx"),
        "utf8",
      );
      assert.ok(
        playgroundSrc.includes("handleParametersChange") && playgroundSrc.includes("externalParams={payload?.params}"),
        "PlaygroundPage must synchronize parameter overrides into compressed #m=... permalinks",
      );
    });
  });

  describe("4. Modelica.Mechanics.MultiBody.Visualizers 3D Animation & Post-Artifact Viewer Support", () => {
    it("extracts procedural 3D meshes, MSL frame defaults, and dynamic bindings from MultiBody Visualizers source", () => {
      const code = `
model DoublePendulum3D
  Modelica.Mechanics.MultiBody.Visualizers.FixedShape arm(
    shapeType="cylinder",
    length=0.8,
    width=0.06,
    height=0.06,
    lengthDirection={0, 1, 0},
    widthDirection={1, 0, 0},
    r_shape={0.1, 0.2, 0.3},
    color={255, 60, 60}
  );
  Modelica.Mechanics.MultiBody.Visualizers.SignalArrow forceVec(
    diameter=0.03,
    color={0, 180, 255}
  );
  Modelica.Mechanics.MultiBody.Visualizers.Torus wheel(
    ri=0.35,
    ro=0.05,
    color={40, 40, 40}
  );
  Modelica.Mechanics.MultiBody.Visualizers.PipeWithScalarField pipe(
    length=1.2,
    outerRadius=0.08,
    n_s=10,
    n_phi=12
  );
  Modelica.Mechanics.MultiBody.Parts.BodyCylinder link1(
    r={0.5, 0, 0},
    diameter=0.05,
    color={0, 128, 255}
  );
  Modelica.Mechanics.MultiBody.Forces.Spring damperSpring(
    width=0.08,
    coilWidth=0.015,
    numberOfWindings=6
  );
  Modelica.Mechanics.MultiBody.Joints.Revolute rev(n={0, 0, 1});
end DoublePendulum3D;
`;
      const rawVars = parseSourceCadVariables(code);
      const cadComponents = extractCadComponents(rawVars);

      assert.strictEqual(cadComponents.length, 7, "Must extract all 7 MultiBody 3D components");

      const arm = cadComponents.find((c) => c.name === "arm");
      assert.ok(arm, "Must extract FixedShape 'arm'");
      assert.strictEqual(arm.cad.uri, "procedural://msl/cylinder");
      assert.ok(
        arm.proceduralMesh && arm.proceduralMesh.vertices.length > 0 && arm.proceduralMesh.indices.length > 0,
        "FixedShape must include proceduralMesh vertices and indices",
      );
      assert.deepStrictEqual(arm.defaults?.lengthDirection, [0, 1, 0]);
      assert.deepStrictEqual(arm.defaults?.widthDirection, [1, 0, 0]);
      assert.deepStrictEqual(arm.defaults?.shapeOffset, [0.1, 0.2, 0.3]);
      assert.ok(
        arm.dynamicBindings?.some((b) => b.property === "position" && b.variable === "arm.frame_a.r_0[1]"),
        "FixedShape must bind frame_a.r_0[1] to position",
      );

      const forceVec = cadComponents.find((c) => c.name === "forceVec");
      assert.ok(forceVec, "Must extract SignalArrow 'forceVec'");
      assert.strictEqual(forceVec.cad.uri, "procedural://msl/arrow");
      assert.strictEqual(forceVec.defaults?.vectorCoordinates, true);
      assert.ok(
        forceVec.dynamicBindings?.some((b) => b.property === "position" && b.variable === "forceVec.frame_a.r_0[1]"),
      );
      assert.ok(
        forceVec.dynamicBindings?.some(
          (b) => b.property === "vectorCoordinates" && b.variable === "forceVec.r_head[1]",
        ),
      );

      const wheel = cadComponents.find((c) => c.name === "wheel");
      assert.ok(wheel && wheel.proceduralMesh, "Must extract Torus 'wheel' with procedural mesh");
      assert.strictEqual(wheel.cad.uri, "procedural://msl-surface/torus");

      const pipe = cadComponents.find((c) => c.name === "pipe");
      assert.ok(pipe && pipe.proceduralMesh, "Must extract PipeWithScalarField 'pipe' with procedural mesh");
      assert.strictEqual(pipe.cad.uri, "procedural://msl-surface/pipe");

      const link1 = cadComponents.find((c) => c.name === "link1");
      assert.ok(link1 && link1.proceduralMesh, "Must extract Parts.BodyCylinder 'link1'");
      assert.deepStrictEqual(link1.defaults?.lengthDirection, [1, 0, 0]);

      const spring = cadComponents.find((c) => c.name === "damperSpring");
      assert.ok(spring && spring.proceduralMesh, "Must extract Forces.Spring 'damperSpring'");
      assert.strictEqual(spring.cad.uri, "procedural://msl/spring");
      assert.strictEqual(spring.defaults?.vectorCoordinates, true);

      const rev = cadComponents.find((c) => c.name === "rev");
      assert.ok(rev && rev.proceduralMesh, "Must extract Joints.Revolute 'rev'");
      assert.ok(
        rev.dynamicBindings?.some((b) => b.property === "rotation" && b.variable === "rev.phi"),
        "Joints.Revolute must bind rev.phi to rotation",
      );
    });

    it("wires procedural meshes, quaternion transforms, and 3D preview tabs across CadViewer, Morsel, and Post-Artifact Viewers", () => {
      const cadViewerSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/morsel/cad-viewer/CadViewer.tsx"),
        "utf8",
      );
      assert.ok(
        cadViewerSrc.includes("ProceduralMeshObject") &&
          cadViewerSrc.includes("tf.quaternion") &&
          cadViewerSrc.includes("tf.color"),
        "CadViewer must render ProceduralMeshObject without calling useGLTF on procedural:// URIs and apply MSL quaternion and dynamic color transforms",
      );

      const instancedSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/morsel/cad-viewer/InstancedCadAssembly.tsx"),
        "utf8",
      );
      assert.ok(
        instancedSrc.includes("!c.proceduralMesh") && instancedSrc.includes('!c.cad.uri?.startsWith("procedural://")'),
        "InstancedCadAssembly must bypass useGLTF instancing for procedural visualizer meshes",
      );

      const engineSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/morsel/hooks/useMorselEngine.ts"),
        "utf8",
      );
      assert.ok(
        engineSrc.includes("parseSourceCadVariables") &&
          engineSrc.includes("...(comp.defaults ?? {})") &&
          engineSrc.includes("lastSimTrajectoryRef"),
        "useMorselEngine must synchronously extract source 3D visualizers, pass MSL defaults to AnimationController, and retain simulation trajectory across async CAD resolution",
      );

      const diagramViewerSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/ModelicaDiagramViewer.tsx"),
        "utf8",
      );
      assert.ok(
        diagramViewerSrc.includes("export function hasModelica3dVisualizers") &&
          diagramViewerSrc.includes('{ id: "3d", label: "3D"') &&
          diagramViewerSrc.includes('viewMode === "3d"'),
        "ModelicaDiagramViewer must detect 3D MultiBody visualizers and expose a first-class 3D tab mode",
      );

      const codeViewerSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/ModelicaCodeViewer.tsx"),
        "utf8",
      );
      assert.ok(
        codeViewerSrc.includes('viewMode === "3d"') && codeViewerSrc.includes("initialView={morselInitialView}"),
        "ModelicaCodeViewer must include a 3D animation tab wired to Morsel initialView={morselInitialView}",
      );

      const visualizerPaneSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselVisualizerPane.tsx"),
        "utf8",
      );
      assert.ok(
        visualizerPaneSrc.includes("Modelica.Mechanics.MultiBody.Visualizers.FixedShape") &&
          visualizerPaneSrc.includes("Modelica.Mechanics.MultiBody.Visualizers.SignalArrow") &&
          visualizerPaneSrc.includes("Modelica.Mechanics.MultiBody.Visualizers.Torus"),
        "MorselVisualizerPane must provide 3D MultiBody Visualizer drag-and-drop stencils",
      );
    });
  });

  describe("8. Light-Mode Theme Adaptation Across Embedded Artifact Viewers", () => {
    it("adapts dark AUTOSAR, Simulink, PSCAD, and PSS/E schematic SVGs to light mode idempotently", () => {
      const autosarDarkSvg = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 420" style="background:#0b0f19;">',
        '  <rect width="880" height="420" fill="#0b0f19" />',
        '  <rect x="30" y="64" width="820" height="320" rx="10" fill="#0f172a" stroke="#1e293b" />',
        '  <rect x="60" y="130" width="210" height="90" rx="8" fill="#111827" stroke="#06b6d4" stroke-width="1.8" />',
        '  <text x="30" y="34" fill="#f8fafc" font-size="14" font-weight="700">ZonalBrakeByWireComposition — AUTOSAR VFB &amp; RTE Architecture</text>',
        '  <text x="30" y="52" fill="#94a3b8" font-size="11">ISO 26262 ASIL-D · 3 SW-Components · 2 Assembly Connectors</text>',
        "</svg>",
      ].join("\n");

      // Dark mode leaves SVG unchanged
      assert.strictEqual(adaptSvgMarkupForTheme(autosarDarkSvg, true), autosarDarkSvg);

      // Light mode converts dark canvas/node rects and light text to high-contrast light palette
      const lightAutosar = adaptSvgMarkupForTheme(autosarDarkSvg, false);
      assert.ok(
        !lightAutosar.includes('fill="#0b0f19"') &&
          !lightAutosar.includes('fill="#111827"') &&
          lightAutosar.includes('<rect width="880" height="420" fill="#f8fafc" />') &&
          lightAutosar.includes(
            '<rect x="30" y="64" width="820" height="320" rx="10" fill="#ffffff" stroke="#cbd5e1" />',
          ) &&
          lightAutosar.includes('<rect x="60" y="130" width="210" height="90" rx="8" fill="#ffffff" stroke="#06b6d4"'),
        "Must replace dark background and SWC box fills with light surfaces (#f8fafc / #ffffff)",
      );
      assert.ok(
        lightAutosar.includes('<text x="30" y="34" fill="#0f172a"') &&
          lightAutosar.includes('<text x="30" y="52" fill="#475569"'),
        "Must convert light text labels (#f8fafc, #94a3b8) to dark slate (#0f172a, #475569)",
      );
      assert.ok(lightAutosar.includes('stroke="#06b6d4"'), "Must preserve semantic domain accent strokes (#06b6d4)");

      // Must be idempotent when called multiple times
      assert.strictEqual(
        adaptSvgMarkupForTheme(lightAutosar, false),
        lightAutosar,
        "adaptSvgMarkupForTheme must be idempotent in light mode",
      );
    });

    it("wires canonical useTheme (theme === 'dark') and SVG light-mode adaptation across artifact viewers", () => {
      const viewers = [
        "PolyglotArtifactViewer.tsx",
        "ModelicaDiagramViewer.tsx",
        "ModelicaCodeViewer.tsx",
        "SspViewer.tsx",
        "SysmlViewer.tsx",
        "SimaViewer.tsx",
        "Easy5Viewer.tsx",
        "RocetsViewer.tsx",
        "PipelineLpsViewer.tsx",
        "GtSuiteViewer.tsx",
        "CfdConfigViewer.tsx",
        "CadStepViewer.tsx",
        "VegaViewer.tsx",
        "MermaidViewer.tsx",
        "ArtifactViewCard.tsx",
      ];

      for (const file of viewers) {
        const src = fs.readFileSync(path.resolve(import.meta.dirname, `../src/components/artifacts/${file}`), "utf8");
        assert.ok(
          src.includes('from "../../theme"'),
          `${file} must import useTheme from ../../theme so light/dark mode state is consistent`,
        );
        assert.ok(
          !src.includes('resolvedColorMode === "dark"'),
          `${file} must not compare Primer resolvedColorMode against "dark" (Primer uses "night"/"day")`,
        );
      }
    });
  });

  describe("10. Removal of Study Creation from Artifact Viewers & cae_cloud_solver Feature Flag Gating", () => {
    it("removes study creation and inline solver execution from CadStepViewer, FeaDeckViewer, and CfdConfigViewer while gating Cloud/HPC UI behind useFeatureFlag('cae_cloud_solver')", () => {
      const cadStepSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/CadStepViewer.tsx"),
        "utf8",
      );
      assert.ok(
        !cadStepSrc.includes("Create Simulation") &&
          !cadStepSrc.includes('title="Create Physics Configuration"') &&
          !cadStepSrc.includes("solveCadStudySync"),
        "CadStepViewer must not expose study creation dialogs or inline simulation execution (moved to VS Code extension)",
      );

      const headerBarSrc = fs.readFileSync(
        path.resolve(
          import.meta.dirname,
          "../src/components/artifacts/simulation-result/components/ViewerHeaderBar.tsx",
        ),
        "utf8",
      );
      assert.ok(
        headerBarSrc.includes('useFeatureFlag("cae_cloud_solver")') &&
          headerBarSrc.includes("hasCloudSolver && (viewConfig.profile || viewConfig.hpc?.profile)"),
        "ViewerHeaderBar must gate HPC profile and credit badges behind useFeatureFlag('cae_cloud_solver')",
      );

      const inspectorSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/card/StudioInspectorSidebar.tsx"),
        "utf8",
      );
      assert.ok(
        inspectorSrc.includes('useFeatureFlag("cae_cloud_solver")') && inspectorSrc.includes("hasCloudSolver"),
        "StudioInspectorSidebar must gate HPC Telemetry section behind useFeatureFlag('cae_cloud_solver')",
      );

      const studyTemplateSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/StudyTemplateViewer.tsx"),
        "utf8",
      );
      assert.ok(
        studyTemplateSrc.includes('useFeatureFlag("cae_cloud_solver")') && studyTemplateSrc.includes("hasCloudSolver"),
        "StudyTemplateViewer must gate Compute Node Profile behind useFeatureFlag('cae_cloud_solver')",
      );

      const feaDeckSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/FeaDeckViewer.tsx"),
        "utf8",
      );
      const cfdConfigSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/CfdConfigViewer.tsx"),
        "utf8",
      );
      assert.ok(
        !feaDeckSrc.includes("Run Solver") &&
          !feaDeckSrc.includes("solveCadStudySync") &&
          !feaDeckSrc.includes("runPhysicsJob"),
        "FeaDeckViewer must not expose inline solver execution buttons in the artifact viewer",
      );
      assert.ok(
        !cfdConfigSrc.includes("Run Solver") &&
          !cfdConfigSrc.includes("runPhysicsJob") &&
          cfdConfigSrc.includes('useState<"3d" | "diagram" | "code">("3d")') &&
          cfdConfigSrc.includes("<SimulationResultViewer"),
        "CfdConfigViewer must default to the interactive 3D CFD overlay (SimulationResultViewer) without inline solver execution buttons",
      );
    });

    it("tracks diagram drag mousemove/mouseup on window and guards e.buttons so mouseup outside the artifact box ends the drag", () => {
      const pannableViewers = ["PolyglotArtifactViewer.tsx", "MermaidViewer.tsx", "PictureViewer.tsx", "SspViewer.tsx"];

      for (const file of pannableViewers) {
        const src = fs.readFileSync(path.resolve(import.meta.dirname, `../src/components/artifacts/${file}`), "utf8");
        assert.ok(
          src.includes('window.addEventListener("mousemove"') &&
            src.includes('window.addEventListener("mouseup"') &&
            src.includes('window.addEventListener("pointerup"'),
          `${file} must attach window mousemove/mouseup/pointerup listeners during drag so releasing the mouse outside the artifact box terminates dragging`,
        );
        assert.ok(
          src.includes("(e.buttons & 1) === 0") || src.includes("(ev.buttons & 1) === 0"),
          `${file} must verify the primary mouse button is still pressed during move events to recover if mouseup occurred outside the window`,
        );
      }
    });
  });

  describe("11. 3D MBD / QIF + STEP AP242 CAD Overlay Viewer & Non-Overlapping GD&T Schematic", () => {
    it("renders collision-free radial STEP #ID callout badges and multi-tiered 3D CAD geometry in renderQifMbdHeatmapSvg", () => {
      const svg = renderQifMbdHeatmapSvg({
        qpId: "9f8e7d6c-5b4a-4f3e-8d2c-1a0b9c8d7e6f",
        datumDefinitions: [
          { id: "DAT_A", label: "A", featureId: "FEAT_DATUM_A" },
          { id: "DAT_B", label: "B", featureId: "FEAT_BORE_B" },
          { id: "DAT_C", label: "C", featureId: "FEAT_SLOT_C" },
        ],
        features: [
          {
            id: "FEAT_DATUM_A",
            name: "FirTreePlatformDatumPlaneA",
            featureType: "Plane",
            stepEntityId: 101,
            location: [0, 0, 0],
            normal: [0, 0, 1],
          },
          {
            id: "FEAT_BORE_B",
            name: "RootInternalCoolingBoreB",
            featureType: "Cylinder",
            stepEntityId: 108,
            location: [12.5, 0, -15],
            normal: [0, 0, 1],
            nominalSize: 8.5,
          },
          {
            id: "FEAT_SLOT_C",
            name: "AxialLockingPinSlotC",
            featureType: "OppositeParallelPlanes",
            stepEntityId: 114,
            location: [-18, 0, -8],
            normal: [0, 1, 0],
            nominalSize: 4.0,
          },
          {
            id: "FEAT_PIN_HOLE_1",
            name: "DamperWirePinBore",
            featureType: "Cylinder",
            stepEntityId: 118,
            location: [24, 6.5, -4],
            normal: [1, 0, 0],
            nominalSize: 3.2,
          },
        ],
        characteristics: [
          {
            id: "CHAR_FLAT_A",
            name: "Datum A Flatness",
            gdtType: "Flatness",
            featureIds: ["FEAT_DATUM_A"],
            toleranceZone: 0.008,
          },
          {
            id: "CHAR_POS_PIN",
            name: "Damper Pin Bore True Position",
            gdtType: "Position",
            featureIds: ["FEAT_PIN_HOLE_1"],
            toleranceZone: 0.025,
            materialCondition: "MMC",
            datumReferences: [{ datumLabel: "A" }, { datumLabel: "B", materialCondition: "MMC" }, { datumLabel: "C" }],
          },
        ],
        actuals: [
          { id: "ACT_1", characteristicId: "CHAR_FLAT_A", measuredValue: 0.0031, status: "PASS" },
          { id: "ACT_2", characteristicId: "CHAR_POS_PIN", measuredValue: 0.011, status: "PASS" },
        ],
      });

      assert.ok(svg.includes("STEP #101"), "Must render STEP AP242 entity #101 badge in FCF panel");
      assert.ok(svg.includes("STEP #118"), "Must render STEP AP242 entity #118 badge in FCF panel");
      assert.ok(svg.includes("#101 · Datum A"), "Must render compact radial callout badge for Datum A");
      assert.ok(svg.includes("#108 · Datum B"), "Must render compact radial callout badge for Datum B");
    });

    it("dispatches qif artifacts to dedicated 3D MBD QifViewer with STEP AP242 B-Rep pairing", () => {
      const dispatcherSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/card/ViewerDispatcher.tsx"),
        "utf8",
      );
      assert.ok(
        dispatcherSrc.includes('case "qif":') && dispatcherSrc.includes("<QifViewer"),
        "ViewerDispatcher must route 'qif' artifacts to dedicated <QifViewer />",
      );

      const qifViewerSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/QifViewer.tsx"),
        "utf8",
      );
      assert.ok(
        qifViewerSrc.includes('useState<QifViewTab>("3d")') &&
          qifViewerSrc.includes("buildQif3dMbdScene") &&
          qifViewerSrc.includes("STEP AP242"),
        "QifViewer must default to the 3D CAD + GD&T tab and synthesize STEP AP242 B-Rep surface meshes via buildQif3dMbdScene",
      );
      assert.ok(
        qifViewerSrc.includes("Boolean(viewConfig?.standalone)"),
        "QifViewer must gate Open in Playground header button behind viewConfig.standalone",
      );
      assert.ok(
        !qifViewerSrc.includes('width="335px"') && !qifViewerSrc.includes("top={10} left={10}"),
        "QifViewer 3D viewport must use full width without a docked 335px right panel or overlapping top-left layer toggles",
      );
    });
  });
});
