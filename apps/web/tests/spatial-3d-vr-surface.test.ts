// SPDX-License-Identifier: AGPL-3.0-or-later

import { createCanonicalPolyglotDemoBoard, serializeCanvasDocument, type CanvasTile } from "@modelscript/canvas";
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  LiveCanvasPlotTile,
  LiveCodeTile,
  LiveEcadCanvasTile,
  LiveTableTile,
  LiveUnifiedSchematicTile,
  renderLiveWebTileContent,
} from "../src/components/canvas/LivePolyglotTileRenderer.js";
import { Scissor3DViewport, SharedScissor3DHost } from "../src/components/canvas/SharedScissor3DHost.js";
import { SpatialVrSurface } from "../src/components/canvas/SpatialVrSurface.js";
import SpatialCanvasPage from "../src/pages/SpatialCanvasPage.js";
import { SpaceCanvasTab } from "../src/pages/space/SpaceCanvasTab.js";

describe("Shared Single-Context Scissor 3D Host, Live CanvasPlot Tile & 3D/VR Surface", () => {
  test("SharedScissor3DHost renders multiple embedded CAD/FEA/CFD viewports on 1 shared WebGL context", () => {
    const vtkBytes = new TextEncoder().encode('<VTKFile type="PolyData"><PolyData></PolyData></VTKFile>');
    const html = renderToStaticMarkup(
      React.createElement(
        SharedScissor3DHost,
        null,
        React.createElement(Scissor3DViewport, {
          kind: "cad",
          artifactUri: "/assets/actuator.glb",
          simulationTime: 1.5,
          badgeLabel: "CAD Assembly",
        }),
        React.createElement(Scissor3DViewport, {
          kind: "fea",
          simulationTime: 1.5,
          interactive: false,
          badgeLabel: "FEA Stress",
        }),
        React.createElement(Scissor3DViewport, {
          kind: "cfd",
          vtkBuffer: vtkBytes,
          simulationTime: 1.5,
          badgeLabel: "CFD Flow",
        }),
      ),
    );

    assert.ok(html.includes('data-testid="shared-scissor-3d-host"'));
    assert.ok(html.includes('data-webgl-contexts="1"'));
    assert.ok(html.includes('data-3d-kind="cad"'));
    assert.ok(html.includes('data-3d-kind="fea"'));
    assert.ok(html.includes('data-3d-kind="cfd"'));
    assert.ok(html.includes('data-3d-source="gltf"'));
    assert.ok(html.includes('data-3d-source="procedural"'));
    assert.ok(html.includes('data-3d-source="vtk"'));
    assert.ok(html.includes('data-3d-interactive="false"'));
  });

  test("renderLiveWebTileContent uses Scissor3DViewport for cad3d and live Canvas2D plot for analytics", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const stepTile = board.tiles["tile_step"];
    const mcTile = board.tiles["tile_montecarlo"];
    assert.ok(stepTile && mcTile);

    const cadHtml = renderToStaticMarkup(
      React.createElement(
        SharedScissor3DHost,
        null,
        renderLiveWebTileContent(stepTile, "interactive", true, { simulationTime: 2.0 }),
      ),
    );
    assert.ok(cadHtml.includes('data-testid="scissor-3d-viewport"'));
    assert.ok(cadHtml.includes("Shared-Scissor 3D"));

    const plotHtml = renderToStaticMarkup(
      React.createElement("div", null, renderLiveWebTileContent(mcTile, "interactive", false, { simulationTime: 3.5 })),
    );
    assert.ok(plotHtml.includes('data-testid="live-canvas-plot-tile_montecarlo"'));
    assert.ok(plotHtml.includes('data-plot-source="parametric"'));
  });

  test("LiveUnifiedSchematicTile renders headless UnifiedGraph Canvas2D schematic for schematic and fmu tiles", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const modelicaTile = board.tiles["tile_modelica"];
    assert.ok(modelicaTile);

    const synthHtml = renderToStaticMarkup(
      React.createElement(
        "div",
        null,
        renderLiveWebTileContent(modelicaTile, "interactive", false, { simulationTime: 1.25 }),
      ),
    );
    assert.ok(synthHtml.includes('data-testid="live-unified-schematic-tile_modelica"'));
    assert.ok(synthHtml.includes('data-schematic-source="synthesized"'));

    const diagramTile: CanvasTile = {
      ...modelicaTile,
      id: "tile_fmu_custom",
      archetype: "fmu",
      viewState: {
        diagramData: {
          nodes: [
            { id: "src", x: 10, y: 20, width: 80, height: 40, label: "Input" },
            { id: "dst", x: 180, y: 20, width: 80, height: 40, label: "Plant" },
          ],
          edges: [{ id: "e1", source: { cell: "src" }, target: { cell: "dst" } }],
        },
      },
    };
    const diagramHtml = renderToStaticMarkup(
      React.createElement(LiveUnifiedSchematicTile, { tile: diagramTile, simulationTime: 0.5 }),
    );
    assert.ok(diagramHtml.includes('data-testid="live-unified-schematic-tile_fmu_custom"'));
    assert.ok(diagramHtml.includes('data-schematic-source="diagram-data"'));
  });

  test("LiveCanvasPlotTile accepts real tile.viewState.simulationSeries trajectories", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const mcTile = board.tiles["tile_montecarlo"];
    assert.ok(mcTile);

    const livePlotTile: CanvasTile = {
      ...mcTile,
      viewState: {
        ...mcTile.viewState,
        simulationSeries: [
          { id: "omega", label: "omega (rad/s)", color: "#38bdf8", x: [0, 1, 2, 3], y: [0, 62, 124, 142] },
          { id: "T_max", label: "T_max (K)", color: "#f59e0b", x: [0, 1, 2, 3], y: [300, 322, 341, 348] },
        ],
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(LiveCanvasPlotTile, {
        tile: livePlotTile,
        lod: "interactive",
        simulationTime: 1.5,
      }),
    );
    assert.ok(html.includes('data-testid="live-canvas-plot-tile_montecarlo"'));
    assert.ok(html.includes('data-plot-source="simulation-series"'));
    assert.ok(html.includes('data-series-count="2"'));
  });

  test("SpaceCanvasTab renders SharedScissor3DHost with single WebGL context in SSR markup", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(SpaceCanvasTab, { spaceSlug: "actuator-lab", spaceName: "Actuator Lab" }),
      ),
    );
    assert.ok(html.includes('data-testid="shared-scissor-3d-host"'));
    assert.ok(html.includes('data-webgl-contexts="1"'));
    assert.ok(html.includes("Actuator Lab — Polyglot System Canvas"));
  });

  test("SpatialVrSurface renders 3D Spatial and WebXR VR workstation host with return-to-2D control", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const html = renderToStaticMarkup(
      React.createElement(SpatialVrSurface, {
        document: board,
        mode: "webxr-vr",
        simulationTime: 4.0,
        onExitTo2D: () => undefined,
      }),
    );

    assert.ok(html.includes('data-testid="spatial-vr-surface"'));
    assert.ok(html.includes('data-surface-mode="webxr-vr"'));
    assert.ok(html.includes("Return to 2D Canvas"));
  });

  test("LiveUnifiedSchematicTile and LiveCanvasPlotTile paint DPR-scaled Canvas2D output with real simulationSeries", async () => {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>");
    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    const prevHTMLElement = globalThis.HTMLElement;
    const prevPath2D = (globalThis as { Path2D?: unknown }).Path2D;
    const prevActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;

    const drawnTexts: string[] = [];
    const strokeColors: string[] = [];
    let rectCount = 0;
    let strokeCount = 0;

    class MockPath2D {
      public readonly path: string;
      constructor(d?: string) {
        this.path = d ?? "";
      }
    }

    const mockCtx = {
      fillStyle: "#000000",
      strokeStyle: "#000000",
      lineWidth: 1,
      globalAlpha: 1,
      font: "12px sans-serif",
      textAlign: "left",
      textBaseline: "middle",
      save: () => undefined,
      restore: () => undefined,
      setTransform: () => undefined,
      clearRect: () => undefined,
      fillRect: () => undefined,
      translate: () => undefined,
      rotate: () => undefined,
      scale: () => undefined,
      beginPath: () => undefined,
      closePath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      rect: () => {
        rectCount++;
      },
      roundRect: () => {
        rectCount++;
      },
      arc: () => undefined,
      ellipse: () => undefined,
      fill: () => undefined,
      stroke: () => {
        strokeCount++;
        strokeColors.push(String(mockCtx.strokeStyle));
      },
      fillText: (text: string) => {
        drawnTexts.push(text);
      },
      setLineDash: () => undefined,
    };

    try {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      Object.defineProperty(dom.window, "devicePixelRatio", { value: 2, configurable: true });
      Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", {
        value: () => mockCtx,
        configurable: true,
      });
      Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
      Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });
      (globalThis as { Path2D?: unknown }).Path2D = MockPath2D;
      const { createRoot } = await import("react-dom/client");

      const board = createCanonicalPolyglotDemoBoard();
      const modelicaTile = board.tiles["tile_modelica"];
      const mcTile = board.tiles["tile_montecarlo"];
      assert.ok(modelicaTile && mcTile);

      const livePlotTile: CanvasTile = {
        ...mcTile,
        viewState: {
          simulationSeries: [
            { id: "v_out", label: "V_out", color: "#a855f7", x: [0, 2, 4, 6], y: [0, 12, 24, 24] },
            { id: "i_out", label: "I_out", color: "#ec4899", x: [0, 2, 4, 6], y: [0, 1.5, 3.0, 2.8] },
          ],
        },
      };

      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      await React.act(async () => {
        root.render(
          React.createElement(
            React.Fragment,
            null,
            React.createElement(LiveUnifiedSchematicTile, { tile: modelicaTile, simulationTime: 1.0 }),
            React.createElement(LiveCanvasPlotTile, { tile: livePlotTile, lod: "interactive", simulationTime: 2.0 }),
          ),
        );
      });

      const schemCanvas = container.querySelector(
        '[data-testid="live-unified-schematic-tile_modelica"]',
      ) as HTMLCanvasElement | null;
      const plotCanvas = container.querySelector(
        '[data-testid="live-canvas-plot-tile_montecarlo"]',
      ) as HTMLCanvasElement | null;
      assert.ok(schemCanvas && plotCanvas);
      assert.equal(schemCanvas.width, 712);
      assert.equal(schemCanvas.height, 350);
      assert.ok(drawnTexts.includes("ActuatorPlant"));
      assert.ok(drawnTexts.includes("motor.u"));
      assert.ok(rectCount > 0);
      assert.ok(strokeCount > 0);
      assert.ok(strokeColors.includes("#a855f7"), "Expected real simulationSeries #a855f7 waveform stroke");
      assert.ok(strokeColors.includes("#ec4899"), "Expected real simulationSeries #ec4899 waveform stroke");
      assert.ok(!strokeColors.includes("#14b8a6"), "Should not fall back to parametric #14b8a6 trajectory");

      await React.act(async () => {
        root.unmount();
      });
    } finally {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true });
      Object.defineProperty(globalThis, "document", { value: prevDocument, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: prevHTMLElement, configurable: true });
      (globalThis as { Path2D?: unknown }).Path2D = prevPath2D;
      dom.window.close();
    }
  });

  test("LiveEcadCanvasTile renders data-testid and paints multi-layer PCB traces, footprints, silkscreen & mounting holes onto Canvas2D", async () => {
    const board = createCanonicalPolyglotDemoBoard();
    const kicadTile = board.tiles["tile_kicad"];
    assert.ok(kicadTile);

    const ssrHtml = renderToStaticMarkup(
      React.createElement("div", null, renderLiveWebTileContent(kicadTile, "interactive", false)),
    );
    assert.ok(ssrHtml.includes('data-testid="live-ecad-canvas-tile_kicad"'));
    assert.ok(ssrHtml.includes("F.Cu"));
    assert.ok(ssrHtml.includes("B.Cu"));
    assert.ok(ssrHtml.includes("F.SilkS"));

    const { JSDOM } = await import("jsdom");
    const { createRoot } = await import("react-dom/client");
    const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>");
    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    const prevHTMLElement = globalThis.HTMLElement;
    const prevActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;

    const drawnTexts: string[] = [];
    const strokeColors: string[] = [];
    let arcCount = 0;
    let fillRectCount = 0;
    let strokeRectCount = 0;

    const mockCtx = {
      fillStyle: "#000000",
      strokeStyle: "#000000",
      lineWidth: 1,
      font: "10px sans-serif",
      textAlign: "left",
      textBaseline: "middle",
      save: () => undefined,
      restore: () => undefined,
      setTransform: () => undefined,
      fillRect: () => {
        fillRectCount++;
      },
      strokeRect: () => {
        strokeRectCount++;
      },
      beginPath: () => undefined,
      closePath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      rect: () => undefined,
      roundRect: () => undefined,
      arc: () => {
        arcCount++;
      },
      fill: () => undefined,
      stroke: () => {
        strokeColors.push(String(mockCtx.strokeStyle));
      },
      fillText: (text: string) => {
        drawnTexts.push(text);
      },
    };

    try {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      Object.defineProperty(dom.window, "devicePixelRatio", { value: 2, configurable: true });
      Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", {
        value: () => mockCtx,
        configurable: true,
      });
      Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
      Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });

      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      await React.act(async () => {
        root.render(React.createElement(LiveEcadCanvasTile, { tile: kicadTile }));
      });

      const ecadCanvas = container.querySelector(
        '[data-testid="live-ecad-canvas-tile_kicad"]',
      ) as HTMLCanvasElement | null;
      assert.ok(ecadCanvas);
      assert.equal(ecadCanvas.width, 712);
      assert.equal(ecadCanvas.height, 304);
      assert.ok(strokeColors.includes("#ef4444"), "Expected F.Cu red copper traces");
      assert.ok(strokeColors.includes("#3b82f6"), "Expected B.Cu blue copper traces");
      assert.ok(strokeColors.includes("#f59e0b"), "Expected Edge.Cuts PCB outline");
      assert.ok(arcCount >= 8, "Expected corner mounting-hole anchors and vias");
      assert.ok(fillRectCount > 10 && strokeRectCount >= 2, "Expected SMD footprints and pads");
      assert.ok(drawnTexts.includes("U1 DRV8353"), "Expected silkscreen IC label");
      assert.ok(drawnTexts.includes("Q1-Q6"), "Expected MOSFET silkscreen label");
      assert.ok(drawnTexts.includes("VBUS_24V"), "Expected pinned PCB net callout");

      await React.act(async () => {
        root.unmount();
      });
    } finally {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true });
      Object.defineProperty(globalThis, "document", { value: prevDocument, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: prevHTMLElement, configurable: true });
      dom.window.close();
    }
  });

  test("LiveCodeTile renders syntax preview at interactive LOD and switches to editable textarea at focus LOD with parameter sync & Esc exit", async () => {
    const codeTile: CanvasTile = {
      id: "tile_code_ctrl",
      title: "Actuator Controller (ModelScript)",
      artifactUri: "src/actuator_ctrl.ms",
      languageId: "modelscript",
      archetype: "code",
      targetSymbol: "ActuatorCtrl",
      bounds: { x: 40, y: 40, width: 420, height: 320 },
      zIndex: 1,
      pinnedAnchors: [{ path: "ctrl.mass", label: "mass", kind: "parameter", currentValue: "2.14 kg" }],
    };

    const previewHtml = renderToStaticMarkup(
      React.createElement("div", null, renderLiveWebTileContent(codeTile, "interactive", false)),
    );
    assert.ok(previewHtml.includes('data-testid="live-code-preview-tile_code_ctrl"'));
    assert.ok(!previewHtml.includes('data-testid="live-code-editor-tile_code_ctrl"'));
    assert.ok(previewHtml.includes("parameter"));
    assert.ok(previewHtml.includes("ActuatorCtrl"));

    const focusHtml = renderToStaticMarkup(
      React.createElement("div", null, renderLiveWebTileContent(codeTile, "focus", false)),
    );
    assert.ok(focusHtml.includes('data-testid="live-code-editor-tile_code_ctrl"'));
    assert.ok(focusHtml.includes("<textarea"));

    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>");
    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    const prevHTMLElement = globalThis.HTMLElement;
    const prevActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;

    try {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
      Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });
      const { createRoot } = await import("react-dom/client");

      const codeChanges: { tileId: string; code: string }[] = [];
      const paramEdits: { tileId: string; path: string; val: number }[] = [];
      let exitedFocus = false;

      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      await React.act(async () => {
        root.render(
          React.createElement(LiveCodeTile, {
            tile: codeTile,
            lod: "focus",
            onCodeChange: (tileId, nextCode) => codeChanges.push({ tileId, code: nextCode }),
            onParameterEdit: (tileId, path, val) => paramEdits.push({ tileId, path, val }),
            onExitFocus: () => {
              exitedFocus = true;
            },
          }),
        );
      });

      const editor = container.querySelector(
        '[data-testid="live-code-editor-tile_code_ctrl"]',
      ) as HTMLTextAreaElement | null;
      assert.ok(editor);

      const updatedSource = "model ActuatorCtrl\n  parameter Real mass = 2.65;\nend ActuatorCtrl;";
      const nativeValueSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set;
      assert.ok(nativeValueSetter);

      await React.act(async () => {
        const polyfillTarget = editor as HTMLTextAreaElement & {
          attachEvent?: () => void;
          detachEvent?: () => void;
        };
        polyfillTarget.attachEvent = () => undefined;
        polyfillTarget.detachEvent = () => undefined;
        editor.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true }));
        nativeValueSetter.call(editor, updatedSource);
        editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        editor.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "5", bubbles: true }));
      });

      assert.equal(codeChanges.length, 1);
      assert.equal(codeChanges[0]?.tileId, "tile_code_ctrl");
      assert.equal(codeChanges[0]?.code, updatedSource);
      assert.equal(paramEdits.length, 1);
      assert.deepEqual(paramEdits[0], { tileId: "tile_code_ctrl", path: "ctrl.mass", val: 2.65 });

      await React.act(async () => {
        editor.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      assert.equal(exitedFocus, true);

      await React.act(async () => {
        root.unmount();
      });
    } finally {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true });
      Object.defineProperty(globalThis, "document", { value: prevDocument, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: prevHTMLElement, configurable: true });
      dom.window.close();
    }
  });

  test("Brush-linked ReqIF table rows highlight with data-brushed=true and plot brushing emits linked requirement IDs", async () => {
    const board = createCanonicalPolyglotDemoBoard();
    const reqTile = board.tiles["tile_reqif"];
    const mcTile = board.tiles["tile_montecarlo"];
    assert.ok(reqTile && mcTile);

    const highlightedHtml = renderToStaticMarkup(
      React.createElement(
        "div",
        null,
        renderLiveWebTileContent(reqTile, "interactive", false, {
          highlightedRowIds: ["REQ-042"],
        }),
      ),
    );
    assert.ok(highlightedHtml.includes('data-row-id="REQ-042" data-brushed="true"'));
    assert.ok(highlightedHtml.includes('data-row-id="REQ-014" data-brushed="false"'));
    assert.ok(highlightedHtml.includes('data-brushed-count="1"'));

    const { JSDOM } = await import("jsdom");
    const { createRoot } = await import("react-dom/client");
    const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>");
    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    const prevHTMLElement = globalThis.HTMLElement;
    const prevActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;

    const mockCtx = {
      fillStyle: "#000",
      strokeStyle: "#000",
      lineWidth: 1,
      font: "10px sans-serif",
      textAlign: "left",
      textBaseline: "middle",
      save: () => undefined,
      restore: () => undefined,
      setTransform: () => undefined,
      clearRect: () => undefined,
      translate: () => undefined,
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      rect: () => undefined,
      roundRect: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      fillText: () => undefined,
      setLineDash: () => undefined,
    };

    try {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", {
        value: () => mockCtx,
        configurable: true,
      });
      Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
      Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });

      const LinkedBrushHarness = (): React.ReactElement => {
        const [brushedIds, setBrushedIds] = React.useState<string[]>([]);
        return React.createElement(
          React.Fragment,
          null,
          React.createElement(LiveCanvasPlotTile, {
            tile: mcTile,
            lod: "interactive",
            simulationTime: 2.0,
            onBrushLinkedIds: setBrushedIds,
          }),
          React.createElement(LiveTableTile, {
            tile: reqTile,
            highlightedRowIds: brushedIds,
          }),
        );
      };

      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      await React.act(async () => {
        root.render(React.createElement(LinkedBrushHarness));
      });

      const plotCanvas = container.querySelector(
        '[data-testid="live-canvas-plot-tile_montecarlo"]',
      ) as HTMLCanvasElement | null;
      const reqRow042Before = container.querySelector('[data-row-id="REQ-042"]');
      assert.ok(plotCanvas && reqRow042Before);
      assert.equal(reqRow042Before.getAttribute("data-brushed"), "false");

      await React.act(async () => {
        plotCanvas.dispatchEvent(
          new dom.window.MouseEvent("pointerdown", {
            bubbles: true,
            clientX: 210,
            clientY: 80,
            buttons: 1,
          }),
        );
      });

      const reqRow042After = container.querySelector('[data-row-id="REQ-042"]');
      assert.ok(reqRow042After);
      assert.equal(reqRow042After.getAttribute("data-brushed"), "true");

      await React.act(async () => {
        root.unmount();
      });
    } finally {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true });
      Object.defineProperty(globalThis, "document", { value: prevDocument, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: prevHTMLElement, configurable: true });
      dom.window.close();
    }
  });

  test("SpatialVrSurface accepts onMoveTile and onCreateSpatialWire and renders cleanly in SSR and JSDOM without React 19 hook errors", async () => {
    const board = createCanonicalPolyglotDemoBoard();
    const moved: { tileId: string; x: number; y: number }[] = [];
    const createdWires: { src: string; dst: string; anchor?: string | undefined }[] = [];

    const ssrHtml = renderToStaticMarkup(
      React.createElement(SpatialVrSurface, {
        document: board,
        mode: "spatial-3d",
        simulationTime: 2.5,
        onExitTo2D: () => undefined,
        onMoveTile: (tileId, x, y) => moved.push({ tileId, x, y }),
        onCreateSpatialWire: (src, dst, anchor) => createdWires.push({ src, dst, anchor }),
      }),
    );

    assert.ok(ssrHtml.includes('data-testid="spatial-vr-surface"'));
    assert.ok(ssrHtml.includes('data-surface-mode="spatial-3d"'));
    assert.ok(ssrHtml.includes('data-testid="spatial-vr-hud-status"'));
    assert.ok(ssrHtml.includes("CADPort"));

    const { JSDOM } = await import("jsdom");
    const { createRoot } = await import("react-dom/client");
    const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>");
    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    const prevHTMLElement = globalThis.HTMLElement;
    const prevPath2D = (globalThis as { Path2D?: unknown }).Path2D;
    const prevActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    const prevConsoleError = console.error;
    const consoleErrors: string[] = [];

    const drawnTexts: string[] = [];
    class MockPath2D {
      public readonly path: string;
      constructor(d?: string) {
        this.path = d ?? "";
      }
    }

    const mockCtx = {
      fillStyle: "#000",
      strokeStyle: "#000",
      lineWidth: 1,
      globalAlpha: 1,
      font: "12px sans-serif",
      textAlign: "left",
      textBaseline: "middle",
      save: () => undefined,
      restore: () => undefined,
      setTransform: () => undefined,
      clearRect: () => undefined,
      fillRect: () => undefined,
      strokeRect: () => undefined,
      translate: () => undefined,
      rotate: () => undefined,
      scale: () => undefined,
      clip: () => undefined,
      beginPath: () => undefined,
      closePath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      rect: () => undefined,
      roundRect: () => undefined,
      arc: () => undefined,
      ellipse: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      fillText: (text: string) => {
        drawnTexts.push(text);
      },
      setLineDash: () => undefined,
    };

    try {
      console.error = (...args: unknown[]) => {
        consoleErrors.push(args.map((a) => String(a)).join(" "));
      };
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", {
        value: (contextId: string) => (contextId === "2d" ? mockCtx : null),
        configurable: true,
      });
      Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
      Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });
      (globalThis as { Path2D?: unknown }).Path2D = MockPath2D;

      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);

      await React.act(async () => {
        root.render(
          React.createElement(SpatialVrSurface, {
            document: board,
            mode: "webxr-vr",
            simulationTime: 3.0,
            onExitTo2D: () => undefined,
            onMoveTile: (tileId, x, y) => moved.push({ tileId, x, y }),
            onCreateSpatialWire: (src, dst, anchor) => createdWires.push({ src, dst, anchor }),
          }),
        );
      });

      const surfaceEl = container.querySelector('[data-testid="spatial-vr-surface"]');
      const hudEl = container.querySelector('[data-testid="spatial-vr-hud-status"]');
      const fallbackCanvas = container.querySelector(
        '[data-testid="spatial-vr-fallback-canvas"]',
      ) as HTMLCanvasElement | null;
      assert.ok(surfaceEl && hudEl && fallbackCanvas);
      assert.equal(fallbackCanvas.width, 1600);
      assert.equal(fallbackCanvas.height, 1000);
      // Verify real UnifiedGraph schematic labels were painted onto the VR board texture canvas
      assert.ok(drawnTexts.includes("ActuatorPlant"), "Expected UnifiedGraph schematic core block painted in VR");
      assert.ok(drawnTexts.includes("motor.u"), "Expected UnifiedGraph schematic port block painted in VR");
      assert.equal(consoleErrors.length, 0, `Unexpected console errors: ${consoleErrors.join("; ")}`);

      await React.act(async () => {
        root.unmount();
      });
    } finally {
      console.error = prevConsoleError;
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true });
      Object.defineProperty(globalThis, "document", { value: prevDocument, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: prevHTMLElement, configurable: true });
      (globalThis as { Path2D?: unknown }).Path2D = prevPath2D;
      dom.window.close();
    }
  });

  test("LiveCad3DTile lazily fetches binary .vtu payload into Scissor3DViewport when artifactUri ends with .vtu", async () => {
    const { JSDOM } = await import("jsdom");
    const { createRoot } = await import("react-dom/client");
    const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>");
    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    const prevHTMLElement = globalThis.HTMLElement;
    const prevFetch = globalThis.fetch;
    const prevActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;

    const vtkPayload = new TextEncoder().encode('<VTKFile type="UnstructuredGrid"></VTKFile>');
    const fetchedUrls: string[] = [];

    try {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
      Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });
      globalThis.fetch = (async (input: string | URL | Request) => {
        fetchedUrls.push(String(input));
        return {
          ok: true,
          arrayBuffer: async () =>
            vtkPayload.buffer.slice(vtkPayload.byteOffset, vtkPayload.byteOffset + vtkPayload.byteLength),
        } as Response;
      }) as typeof fetch;

      const board = createCanonicalPolyglotDemoBoard();
      const stepTile = board.tiles["tile_step"];
      assert.ok(stepTile);
      const vtkTile: CanvasTile = {
        ...stepTile,
        id: "tile_cfd_vtk",
        languageId: "cfd",
        artifactUri: "/assets/thermal_field.vtu",
      };

      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);
      await React.act(async () => {
        root.render(
          React.createElement(
            "div",
            null,
            renderLiveWebTileContent(vtkTile, "interactive", true, { simulationTime: 1.0 }),
          ),
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      assert.deepEqual(fetchedUrls, ["/assets/thermal_field.vtu"]);
      const viewport = container.querySelector('[data-testid="scissor-3d-viewport"]');
      assert.ok(viewport);
      assert.equal(viewport.getAttribute("data-3d-source"), "vtk");

      await React.act(async () => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = prevFetch;
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true });
      Object.defineProperty(globalThis, "document", { value: prevDocument, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: prevHTMLElement, configurable: true });
      dom.window.close();
    }
  });

  test("SpatialVrSurface delegates initialEnvironment, models, title, and onSimulationTimeChange to EngineeringRotunda", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const html = renderToStaticMarkup(
      React.createElement(SpatialVrSurface, {
        document: board,
        mode: "spatial-3d",
        initialEnvironment: "warehouse",
        title: "Turbofan Rotunda Review",
        models: [
          {
            id: "custom-rotor",
            title: "Turbofan Ducted Rotor",
            subtitle: "CFD Velocity Streamlines",
            kind: "cfd",
          },
        ],
        simulationTime: 1.5,
        onSimulationTimeChange: () => undefined,
        onExitTo2D: () => undefined,
      }),
    );

    assert.ok(html.includes('data-testid="spatial-vr-surface"'));
    assert.ok(html.includes('data-rotunda="engineering-rotunda"'));
    assert.ok(html.includes('data-rotunda-env="warehouse"'));
    assert.ok(html.includes('data-active-model="custom-rotor"'));
    assert.ok(html.includes("Turbofan Ducted Rotor"));
    assert.ok(html.includes("Return to 2D Canvas"));
  });

  test("SpatialCanvasPage honors ?mode=, ?env=, #vrBoard= UTF-8 base64url handoff, and exposes VR Rotunda toggle", () => {
    const handoffBoard = createCanonicalPolyglotDemoBoard();
    handoffBoard.id = "vscode-handoff-rotunda";
    handoffBoard.name = "Rotor Assembly — 45° Pitch Ω";
    const jsonBytes = new TextEncoder().encode(serializeCanvasDocument(handoffBoard));
    let binary = "";
    for (let i = 0; i < jsonBytes.length; i++) {
      binary += String.fromCharCode(jsonBytes[i]!);
    }
    const encodedBoard = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

    const vrHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: [`/canvas?mode=webxr-vr&env=warehouse#vrBoard=${encodedBoard}`] },
        React.createElement(SpatialCanvasPage),
      ),
    );

    assert.ok(vrHtml.includes('data-testid="spatial-vr-surface"'));
    assert.ok(vrHtml.includes('data-surface-mode="webxr-vr"'));
    assert.ok(vrHtml.includes('data-rotunda-env="warehouse"'));
    assert.ok(vrHtml.includes('data-testid="canvas-vr-rotunda-toggle"'));
    assert.ok(vrHtml.includes("VR Rotunda"));
    assert.ok(vrHtml.includes("Rotor Assembly — 45° Pitch Ω"));
    assert.ok(vrHtml.includes("VR Handoff · Local Mode"));

    // Invalid #vrBoard hash must fall back gracefully without throwing
    const fallbackHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/canvas?mode=spatial-3d&env=outdoors#vrBoard=%%%invalid%%%"] },
        React.createElement(SpatialCanvasPage),
      ),
    );
    assert.ok(fallbackHtml.includes('data-surface-mode="spatial-3d"'));
    assert.ok(fallbackHtml.includes('data-rotunda-env="outdoors"'));
    assert.ok(fallbackHtml.includes("Offline-First Local Mode"));
  });

  test("SpaceCanvasTab renders VR Rotunda toggle button in header bar", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(SpaceCanvasTab, { spaceSlug: "vr-lab", spaceName: "VR Lab" }),
      ),
    );
    assert.ok(html.includes('data-testid="space-canvas-vr-rotunda-toggle"'));
    assert.ok(html.includes("VR Rotunda"));
  });

  test("SpatialVrSurface accepts peers and animationController pass-through props cleanly", () => {
    const board = createCanonicalPolyglotDemoBoard();
    const html = renderToStaticMarkup(
      React.createElement(SpatialVrSurface, {
        document: board,
        mode: "spatial-3d",
        initialEnvironment: "dark-lab",
        peers: [
          {
            peerId: "peer-vr-1",
            name: "Ada Lovelace",
            color: "#38bdf8",
            cursorX: 220,
            cursorY: 180,
            lastSeen: Date.now(),
          },
        ],
        animationController: {
          hasData: true,
          getTransform: () => ({ position: [0, 0.1, 0], rotation: [0, 0.25, 0], scale: [1, 1, 1] }),
        },
        onExitTo2D: () => undefined,
      }),
    );

    assert.ok(html.includes('data-testid="spatial-vr-surface"'));
    assert.ok(html.includes('data-surface-mode="spatial-3d"'));
  });

  test("SpatialCanvasPage ?handoffId= opens BroadcastChannel('modelscript-vr-handoff'), requests payload, and hydrates local file & .mscanvas into Rotunda", async () => {
    const { JSDOM } = await import("jsdom");
    const { createRoot } = await import("react-dom/client");
    const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>");

    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    const prevHTMLElement = globalThis.HTMLElement;
    const prevPath2D = (globalThis as { Path2D?: unknown }).Path2D;
    const prevBroadcastChannel = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    const prevResizeObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    const prevScreen = (globalThis as { screen?: unknown }).screen;
    const prevActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;

    const postedMessages: Array<{ channel: string; message: unknown }> = [];
    const activeChannels: MockBroadcastChannel[] = [];

    class MockResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }

    class MockBroadcastChannel {
      public readonly name: string;
      public onmessage: ((ev: MessageEvent<unknown>) => void) | null = null;
      public closed = false;

      constructor(name: string) {
        this.name = name;
        activeChannels.push(this);
      }

      postMessage(message: unknown): void {
        postedMessages.push({ channel: this.name, message });
      }

      dispatchIncoming(data: unknown): void {
        this.onmessage?.({ data } as MessageEvent<unknown>);
      }

      close(): void {
        this.closed = true;
      }
    }

    class MockPath2D {
      public readonly path: string;
      constructor(d?: string) {
        this.path = d ?? "";
      }
    }

    const mockCtx = {
      fillStyle: "#000",
      strokeStyle: "#000",
      lineWidth: 1,
      globalAlpha: 1,
      font: "12px sans-serif",
      textAlign: "left",
      textBaseline: "middle",
      save: () => undefined,
      restore: () => undefined,
      setTransform: () => undefined,
      clearRect: () => undefined,
      fillRect: () => undefined,
      strokeRect: () => undefined,
      translate: () => undefined,
      rotate: () => undefined,
      scale: () => undefined,
      clip: () => undefined,
      beginPath: () => undefined,
      closePath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      rect: () => undefined,
      roundRect: () => undefined,
      arc: () => undefined,
      ellipse: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      fillText: () => undefined,
      setLineDash: () => undefined,
    };

    try {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", {
        value: (contextId: string) => (contextId === "2d" ? mockCtx : null),
        configurable: true,
      });
      Object.defineProperty(dom.window, "ResizeObserver", { value: MockResizeObserver, configurable: true });
      Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
      Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });
      (globalThis as { Path2D?: unknown }).Path2D = MockPath2D;
      (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = MockBroadcastChannel;
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver;
      (globalThis as { screen?: unknown }).screen = dom.window.screen;

      const container = dom.window.document.getElementById("root");
      assert.ok(container);
      const root = createRoot(container);

      await React.act(async () => {
        root.render(
          React.createElement(
            MemoryRouter,
            { initialEntries: ["/canvas?handoffId=local-handoff-99"] },
            React.createElement(SpatialCanvasPage),
          ),
        );
      });

      assert.equal(activeChannels.length, 1);
      const ch = activeChannels[0]!;
      assert.equal(ch.name, "modelscript-vr-handoff");
      assert.deepEqual(postedMessages[0], {
        channel: "modelscript-vr-handoff",
        message: { type: "vr-handoff-request", handoffId: "local-handoff-99" },
      });

      // 1. Hydrate local Modelica file payload -> synthesizes board & enters Rotunda cleanly
      await React.act(async () => {
        ch.dispatchIncoming({
          type: "vr-handoff-payload",
          handoffId: "local-handoff-99",
          fileContent: "model ThermalPlant\n  parameter Real R = 4.2;\nend ThermalPlant;",
          languageId: "modelica",
          artifactUri: "ThermalPlant.mo",
          title: "Thermal Plant Local",
          environment: "office",
        });
      });

      const surfaceAfterSynth = container.querySelector('[data-testid="spatial-vr-surface"]');
      assert.ok(surfaceAfterSynth, "Expected SpatialCanvasPage to enter VR Rotunda upon local-file handoff");
      assert.equal(surfaceAfterSynth.getAttribute("data-rotunda-env"), "office");
      assert.ok(container.textContent?.includes("Thermal Plant Local"));
      assert.ok(container.textContent?.includes("VR Handoff · Local Mode"));

      // 2. Hydrate explicit .mscanvas boardJson payload on the same channel
      const customBoard = createCanonicalPolyglotDemoBoard();
      customBoard.id = "relay-board-42";
      customBoard.name = "Relayed .mscanvas Board";
      await React.act(async () => {
        ch.dispatchIncoming({
          type: "vr-handoff-payload",
          handoffId: "local-handoff-99",
          boardJson: serializeCanvasDocument(customBoard),
          environment: "warehouse",
        });
      });

      const surfaceAfterBoard = container.querySelector('[data-testid="spatial-vr-surface"]');
      assert.ok(surfaceAfterBoard);
      assert.equal(surfaceAfterBoard.getAttribute("data-rotunda-env"), "warehouse");
      assert.ok(container.textContent?.includes("Relayed .mscanvas Board"));

      await React.act(async () => {
        root.unmount();
      });
      assert.equal(ch.closed, true, "Expected BroadcastChannel to close cleanly on unmount");
    } finally {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true });
      Object.defineProperty(globalThis, "document", { value: prevDocument, configurable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: prevHTMLElement, configurable: true });
      (globalThis as { Path2D?: unknown }).Path2D = prevPath2D;
      (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = prevBroadcastChannel;
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = prevResizeObserver;
      (globalThis as { screen?: unknown }).screen = prevScreen;
      dom.window.close();
    }
  });
});
