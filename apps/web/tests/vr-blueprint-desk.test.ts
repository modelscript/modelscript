// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  buildCanvasAnalyticsPlotSpec,
  buildCanvasRequirementTableSpec,
  CANVAS_BOARD_THEME_ORDER,
  CANVAS_BOARD_THEMES,
  createCanonicalPolyglotDemoBoard,
  createEmptyCanvasDocument,
  nextCanvasBoardTheme,
  paintCanvasBlueprintFrame,
  paintCanvasCad3DPreview,
  paintCanvasCodeListing,
  paintCanvasEcadPreview,
  paintCanvasPlot,
  paintCanvasSchematicPreview,
  paintCanvasTable,
  paintCanvasTileBody,
  paintCanvasTitleBlock,
  paintStickyBadge,
  POLYGLOT_LANGUAGE_CATALOG,
  resolveCanvasBoardTheme,
  resolveCanvasEcadLayers,
  TileAdapterRegistry,
  type CanvasBoardPaintContext,
  type CanvasBoardThemeId,
  type CanvasDocument,
  type CanvasTile,
  type TileArchetype,
} from "@modelscript/canvas";
import {
  createInitialRotundaState,
  DEFAULT_DESK_THEME,
  DEFAULT_VR_BOARD_THEME,
  EngineeringRotunda,
  paintBoardToTextureCanvas,
  ROTUNDA_BOARD_CANVAS_HEIGHT,
  ROTUNDA_BOARD_CANVAS_WIDTH,
  rotundaReducer,
} from "@modelscript/editor/workbench/vr-rotunda/index.js";
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

interface RecordedCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasBoardPaintContext;
  texts: string[];
  fillStyles: string[];
  strokeStyles: string[];
  fillRectCount: number;
  strokeRectCount: number;
  strokeCount: number;
  fillCount: number;
  arcCount: number;
}

function createRecordingCanvas(
  width = ROTUNDA_BOARD_CANVAS_WIDTH,
  height = ROTUNDA_BOARD_CANVAS_HEIGHT,
): RecordedCanvas {
  const texts: string[] = [];
  const fillStyles: string[] = [];
  const strokeStyles: string[] = [];
  let fillRectCount = 0;
  let strokeRectCount = 0;
  let strokeCount = 0;
  let fillCount = 0;
  let arcCount = 0;

  let currentFill: unknown = "#000000";
  let currentStroke: unknown = "#000000";

  const makeGradient = () => {
    const stops: string[] = [];
    return {
      addColorStop(_offset: number, color: string) {
        stops.push(color);
        fillStyles.push(color);
      },
      stops,
    };
  };

  const ctxImpl: Record<string, unknown> = {
    get fillStyle() {
      return currentFill;
    },
    set fillStyle(v: unknown) {
      currentFill = v;
      if (typeof v === "string") fillStyles.push(v);
    },
    get strokeStyle() {
      return currentStroke;
    },
    set strokeStyle(v: unknown) {
      currentStroke = v;
      if (typeof v === "string") strokeStyles.push(v);
    },
    lineWidth: 1,
    globalAlpha: 1,
    font: "12px sans-serif",
    textAlign: "left",
    textBaseline: "alphabetic",
    lineCap: "butt",
    lineJoin: "miter",
    shadowColor: "transparent",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    rect() {},
    roundRect() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    arc() {
      arcCount++;
    },
    ellipse() {},
    clip() {},
    translate() {},
    scale() {},
    rotate() {},
    setLineDash() {},
    clearRect() {},
    drawImage() {},
    fillRect() {
      fillRectCount++;
    },
    strokeRect() {
      strokeRectCount++;
    },
    fill() {
      fillCount++;
    },
    stroke() {
      strokeCount++;
    },
    fillText(text: string) {
      texts.push(String(text));
    },
    measureText(text: string) {
      return { width: String(text).length * 7 };
    },
    createLinearGradient() {
      return makeGradient();
    },
    createRadialGradient() {
      return makeGradient();
    },
  };

  const canvas = {
    width,
    height,
    getContext(kind: string) {
      return kind === "2d" ? ctxImpl : null;
    },
  } as unknown as HTMLCanvasElement;

  return {
    canvas,
    ctx: ctxImpl as unknown as CanvasBoardPaintContext,
    texts,
    fillStyles,
    strokeStyles,
    get fillRectCount() {
      return fillRectCount;
    },
    get strokeRectCount() {
      return strokeRectCount;
    },
    get strokeCount() {
      return strokeCount;
    },
    get fillCount() {
      return fillCount;
    },
    get arcCount() {
      return arcCount;
    },
  };
}

describe("VR Blueprint Desk & Shared 2D↔VR Canvas Painters", () => {
  test("board theme defaults, ordering, aliases, and rotundaReducer transitions", () => {
    assert.equal(DEFAULT_VR_BOARD_THEME, "blueprint");
    assert.equal(DEFAULT_DESK_THEME, "blueprint");
    assert.deepEqual([...CANVAS_BOARD_THEME_ORDER], ["blueprint", "light", "dark"]);

    assert.equal(nextCanvasBoardTheme("blueprint"), "light");
    assert.equal(nextCanvasBoardTheme("light"), "dark");
    assert.equal(nextCanvasBoardTheme("dark"), "blueprint");

    // Legacy "studio" alias maps cleanly onto "light"
    assert.equal(resolveCanvasBoardTheme("studio").id, "light");
    assert.equal(resolveCanvasBoardTheme(undefined, "blueprint").id, "blueprint");

    // Rotunda reducer defaults to blueprint and cycles deterministically
    let state = createInitialRotundaState();
    assert.equal(state.deskTheme, "blueprint");
    state = rotundaReducer(state, { type: "cycleDeskTheme" });
    assert.equal(state.deskTheme, "light");
    state = rotundaReducer(state, { type: "cycleDeskTheme" });
    assert.equal(state.deskTheme, "dark");
    state = rotundaReducer(state, { type: "cycleDeskTheme" });
    assert.equal(state.deskTheme, "blueprint");
    state = rotundaReducer(state, { type: "setDeskTheme", theme: "dark" });
    assert.equal(state.deskTheme, "dark");
  });

  test("paints canonical polyglot demo board in blueprint (default), light, and dark themes", () => {
    const doc = createCanonicalPolyglotDemoBoard();

    // 1. Default omitted theme === blueprint
    const recDefault = createRecordingCanvas();
    assert.doesNotThrow(() => {
      paintBoardToTextureCanvas(recDefault.canvas, doc, 1.25, null, null, "tile_step");
    });

    // Prussian blue cyanotype paper fill
    assert.ok(
      recDefault.fillStyles.includes("#0a2e52") || recDefault.fillStyles.includes("#0d3b66"),
      "blueprint theme must paint Prussian blue paper fill",
    );
    // Major + minor architectural grid + tile linework
    assert.ok(recDefault.strokeCount > 50, `expected >50 stroke calls, got ${recDefault.strokeCount}`);

    // Engineering title block & ANSI/ISO zone border frame
    for (const expected of ["DWG NO", "SCALE", "SHEET", "INVENTORY", "DATE / REV", "A", "D", "1", "6"]) {
      assert.ok(
        recDefault.texts.some((t) => t.includes(expected)),
        `blueprint sheet should render border/title-block text "${expected}"`,
      );
    }

    // Grouping frames
    for (const frameTitle of [
      "Plant & Closed-Loop Controls",
      "ECAD & Mechanical Packaging",
      "Requirements & Monte Carlo UQ",
    ]) {
      assert.ok(
        recDefault.texts.some((t) => t.includes(frameTitle)),
        `expected grouping frame title "${frameTitle}"`,
      );
    }

    // Digital thread routed wire live values
    for (const wireVal of ["24.0 V", "142.3 rad/s"]) {
      assert.ok(
        recDefault.texts.some((t) => t.includes(wireVal)),
        `expected Digital Thread wire live value "${wireVal}"`,
      );
    }

    // Every canonical demo tile painted via shared @modelscript/canvas painters
    for (const expectedTileText of [
      "ActuatorPlant",
      "PID Torque",
      "U1 DRV8353",
      "Mass: 2.14 kg",
      "REQ-014",
      "REQ-042",
      "Monte Carlo",
    ]) {
      assert.ok(
        recDefault.texts.some((t) => t.includes(expectedTileText)),
        `expected demo tile text "${expectedTileText}" in blueprint desk`,
      );
    }

    // 2. Explicit light & dark themes render all demo tiles cleanly without blueprint title block
    const themeExpectations: { theme: CanvasBoardThemeId; paperHex: string; hasTitleBlock: boolean }[] = [
      { theme: "blueprint", paperHex: "#0a2e52", hasTitleBlock: true },
      { theme: "light", paperHex: "#f8fafc", hasTitleBlock: false },
      { theme: "dark", paperHex: "#0b1120", hasTitleBlock: false },
    ];

    for (const spec of themeExpectations) {
      const rec = createRecordingCanvas();
      assert.doesNotThrow(() => {
        paintBoardToTextureCanvas(rec.canvas, doc, 2.0, null, null, "tile_step", undefined, {
          theme: spec.theme,
        });
      });
      assert.ok(
        rec.fillStyles.includes(spec.paperHex),
        `theme "${spec.theme}" should paint paper color ${spec.paperHex}`,
      );
      assert.equal(
        rec.texts.includes("DWG NO"),
        spec.hasTitleBlock,
        `theme "${spec.theme}" title-block presence should be ${String(spec.hasTitleBlock)}`,
      );
      assert.ok(
        rec.texts.some((t) => t.includes("ActuatorPlant")),
        `theme "${spec.theme}" should draw ActuatorPlant schematic`,
      );
      assert.ok(
        rec.texts.some((t) => t.includes("REQ-014")),
        `theme "${spec.theme}" should draw ReqIF table`,
      );
    }
  });

  test("shared @modelscript/canvas widget painters render cleanly under blueprint theme", () => {
    const blueprint = CANVAS_BOARD_THEMES.blueprint;
    const demo = createCanonicalPolyglotDemoBoard();

    // paintCanvasPlot with blueprint palette
    {
      const rec = createRecordingCanvas(600, 360);
      const uqTile = demo.tiles["tile_montecarlo"];
      assert.ok(uqTile);
      const plotSpec = buildCanvasAnalyticsPlotSpec(uqTile, {
        simulationTime: 3.2,
        dark: blueprint.graphDark,
        palette: blueprint.widget,
      });
      assert.doesNotThrow(() => paintCanvasPlot(rec.ctx, plotSpec, 0, 0, 600, 360));
      assert.ok(rec.fillStyles.includes(blueprint.widget.background), "plot uses blueprint widget background");
      assert.ok(rec.strokeCount > 4, "plot draws grid/curves");
    }

    // paintCanvasTable with blueprint palette
    {
      const rec = createRecordingCanvas(540, 360);
      const reqTile = demo.tiles["tile_reqif"];
      assert.ok(reqTile);
      const tableSpec = buildCanvasRequirementTableSpec(reqTile, {
        dark: blueprint.graphDark,
        palette: blueprint.widget,
        highlightedRowIds: ["REQ-014"],
      });
      assert.doesNotThrow(() => paintCanvasTable(rec.ctx, tableSpec, 0, 0, 540, 360));
      assert.ok(rec.fillStyles.includes(blueprint.widget.background), "table uses blueprint widget background");
      assert.ok(
        rec.texts.some((t) => t.includes("REQ-014")),
        "table draws REQ-014",
      );
    }

    // paintStickyBadge with blueprint palette
    {
      const rec = createRecordingCanvas(240, 120);
      assert.doesNotThrow(() =>
        paintStickyBadge(
          rec.ctx,
          {
            label: "REV A SIGN-OFF",
            value: "17.4",
            unit: "°C",
            status: "ok",
            dark: true,
            palette: blueprint.widget,
          },
          10,
          10,
          160,
          44,
        ),
      );
      assert.ok(rec.fillStyles.includes(blueprint.widget.background), "sticky badge uses blueprint widget background");
      assert.ok(rec.texts.some((t) => t.includes("REV A SIGN-OFF")));
      assert.ok(rec.texts.some((t) => t.includes("17.4 °C")));
    }

    // paintCanvasSchematicPreview, paintCanvasEcadPreview, paintCanvasCad3DPreview, paintCanvasCodeListing
    {
      const rec = createRecordingCanvas(640, 420);
      const schem = demo.tiles["tile_modelica"];
      const ecad = demo.tiles["tile_kicad"];
      const cad = demo.tiles["tile_step"];
      assert.ok(schem && ecad && cad);

      assert.doesNotThrow(() =>
        paintCanvasSchematicPreview(rec.ctx, schem, 0, 0, 400, 260, blueprint, {
          accent: "#38bdf8",
          simulationTime: 1.0,
        }),
      );
      assert.doesNotThrow(() =>
        paintCanvasEcadPreview(rec.ctx, ecad, 0, 0, 400, 260, resolveCanvasEcadLayers(ecad.viewState), blueprint.ecad),
      );
      assert.doesNotThrow(() => paintCanvasCad3DPreview(rec.ctx, cad, 0, 0, 400, 260, blueprint));
      assert.doesNotThrow(() =>
        paintCanvasCodeListing(
          rec.ctx,
          "model ActuatorPlant\n  parameter Real R = 0.42;\nequation\n  v = R * i;\nend ActuatorPlant;",
          0,
          0,
          400,
          260,
          blueprint,
        ),
      );
      assert.doesNotThrow(() => paintCanvasBlueprintFrame(rec.ctx, 0, 0, 640, 420, blueprint));
      assert.doesNotThrow(() =>
        paintCanvasTitleBlock(rec.ctx, 280, 320, 340, 80, blueprint, {
          title: "ACTUATOR ASSEMBLY",
          drawingNumber: "MS-ACT-001",
          scale: "1:2",
          tileCount: 6,
          wireCount: 7,
          date: "2026-11-24",
          revision: "REV B",
        }),
      );

      assert.ok(rec.fillStyles.includes(blueprint.code.background), "code listing uses blueprint paper");
      assert.ok(
        rec.texts.some((t) => t.includes("U1 DRV8353")),
        "ECAD blueprint renders U1 DRV8353",
      );
      assert.ok(
        rec.texts.some((t) => t.includes("MS-ACT-001")),
        "title block renders drawing number",
      );
      assert.ok(
        rec.texts.some((t) => t.includes("6 TILES · 7 WIRES")),
        "title block renders inventory",
      );
    }
  });

  test("paints a synthetic board containing EVERY registered tile archetype and catalog language with zero crashes", () => {
    const registry = new TileAdapterRegistry();
    const allArchetypes: TileArchetype[] = ["schematic", "fmu", "ecad", "cad3d", "table", "analytics", "code"];

    const tiles: Record<string, CanvasTile> = {};

    // 1. Rich bespoke tiles for every canonical archetype (exercising custom viewState branches)
    const richArchetypeTiles: CanvasTile[] = [
      {
        id: "arch_schematic",
        title: "Rich Schematic Tile",
        artifactUri: "/models/plant.mo",
        languageId: "modelica",
        archetype: "schematic",
        bounds: { x: 40, y: 40, width: 420, height: 300 },
        zIndex: 1,
        health: "ok",
        pinnedAnchors: [
          { path: "in.u", label: "u", kind: "fmi-input", side: "left", currentValue: "12.0 V" },
          { path: "out.w", label: "w", kind: "fmi-output", side: "right", currentValue: "98 rad/s" },
        ],
        viewState: {
          diagramData: {
            nodes: [
              { id: "n1", x: 20, y: 40, width: 90, height: 54, label: "Driver" },
              { id: "n2", x: 180, y: 40, width: 90, height: 54, label: "Rotor" },
            ],
            edges: [{ id: "e1", source: { cell: "n1" }, target: { cell: "n2" } }],
          },
        },
      },
      {
        id: "arch_fmu",
        title: "FMU Co-Sim Controller",
        artifactUri: "/cosim/ctrl.fmu",
        languageId: "fmu",
        archetype: "fmu",
        bounds: { x: 500, y: 40, width: 340, height: 240 },
        zIndex: 2,
        health: "ok",
        pinnedAnchors: [
          { path: "tau_cmd", label: "tau_cmd", kind: "fmi-output", side: "right", currentValue: "4.2 N·m" },
        ],
      },
      {
        id: "arch_ecad",
        title: "Power Stage PCB",
        artifactUri: "/pcb/power.ato",
        languageId: "atopile",
        archetype: "ecad",
        bounds: { x: 880, y: 40, width: 420, height: 320 },
        zIndex: 3,
        health: "ok",
        viewState: {
          ecadLayers: { fCu: true, bCu: true, silk: true, mask: true },
        },
      },
      {
        id: "arch_cad3d",
        title: "Housing Assembly STEP",
        artifactUri: "/cad/housing.step",
        languageId: "step",
        archetype: "cad3d",
        bounds: { x: 40, y: 390, width: 420, height: 320 },
        zIndex: 4,
        health: "ok",
        pinnedAnchors: [{ path: "mass", label: "mass", kind: "parameter", side: "bottom", currentValue: "1.85 kg" }],
      },
      {
        id: "arch_table",
        title: "Safety Requirements",
        artifactUri: "/reqs/safety.reqif",
        languageId: "reqif",
        archetype: "table",
        bounds: { x: 500, y: 390, width: 480, height: 320 },
        zIndex: 5,
        health: "warning",
        viewState: {
          rows: [
            { id: "SAF-01", requirement: "Peak housing temp <= 85 C", status: "PASS", margin: "+12 C" },
            { id: "SAF-02", requirement: "Overspeed trip < 15 ms", status: "WARN", margin: "+1.1 ms" },
          ],
        },
      },
      {
        id: "arch_analytics",
        title: "Trajectory Analytics",
        artifactUri: "/sim/run.ms-sim",
        languageId: "ms-sim",
        archetype: "analytics",
        bounds: { x: 1020, y: 390, width: 480, height: 320 },
        zIndex: 6,
        health: "ok",
        viewState: {
          simulationSeries: [
            { id: "s1", label: "omega", color: "#38bdf8", x: [0, 1, 2, 3, 4], y: [0, 42, 85, 96, 98] },
            { id: "s2", label: "torque", color: "#f59e0b", x: [0, 1, 2, 3, 4], y: [6, 5.2, 3.8, 2.4, 2.1] },
          ],
        },
      },
      {
        id: "arch_code",
        title: "ModelScript Spec (Error State)",
        artifactUri: "/specs/constraints.ms",
        languageId: "modelscript",
        archetype: "code",
        bounds: { x: 40, y: 760, width: 420, height: 280 },
        zIndex: 7,
        health: "error",
        viewState: {
          sourceCode: "// Safety envelope\nmodel Envelope\n  parameter Real T_max = 85.0;\nend Envelope;",
        },
      },
    ];

    for (const tile of richArchetypeTiles) {
      tiles[tile.id] = tile;
    }

    // 2. Also synthesize a tile for EVERY single registered language/descriptor in POLYGLOT_LANGUAGE_CATALOG
    assert.ok(POLYGLOT_LANGUAGE_CATALOG.length >= 100, "expected >=100 catalog descriptors");
    const seenArchetypes = new Set<TileArchetype>();
    POLYGLOT_LANGUAGE_CATALOG.forEach((desc, idx) => {
      seenArchetypes.add(desc.archetype);
      const ext = desc.extensions[0] ?? `.${desc.languageId}`;
      const col = idx % 10;
      const row = Math.floor(idx / 10);
      const tile = registry.createTileForDrop({
        id: `cat_${desc.languageId}`,
        artifactUri: `/catalog/${desc.languageId}_sample${ext}`,
        languageId: desc.languageId,
        x: 1600 + col * 480,
        y: 40 + row * 400,
        zIndex: 10 + idx,
      });
      tiles[tile.id] = tile;
    });

    for (const arch of allArchetypes) {
      assert.ok(seenArchetypes.has(arch), `catalog must cover archetype "${arch}"`);
    }

    const baseEmpty = createEmptyCanvasDocument(
      "doc_exhaustive_all_archetypes",
      "Exhaustive Polyglot Coverage Board",
      "2026-11-24T00:00:00Z",
    );
    const syntheticDoc: CanvasDocument = {
      ...baseEmpty,
      tiles,
      frames: {
        frame_all: {
          id: "frame_all",
          title: "All 7 Registered Archetypes",
          bounds: { x: 10, y: 10, width: 1520, height: 1060 },
          color: "#0284c7",
          zIndex: 0,
        },
      },
      wires: {
        w_fmi: {
          id: "w_fmi",
          kind: "fmi-signal",
          source: { tileId: "arch_fmu", anchorPath: "tau_cmd" },
          target: { tileId: "arch_schematic", anchorPath: "in.u" },
          origin: "user-authored",
          status: "synced",
          liveValue: "4.2 N·m",
        },
        w_param: {
          id: "w_param",
          kind: "shared-parameter",
          source: { tileId: "arch_cad3d", anchorPath: "mass" },
          target: { tileId: "arch_analytics", anchorPath: "omega" },
          origin: "auto-inferred",
          status: "stale",
          liveValue: "1.85 kg",
        },
        w_req: {
          id: "w_req",
          kind: "requirement-trace",
          source: { tileId: "arch_table", anchorPath: "SAF-01" },
          target: { tileId: "arch_ecad", anchorPath: "VBUS" },
          origin: "user-authored",
          status: "conflict",
        },
        w_note: {
          id: "w_note",
          kind: "annotation-link",
          source: { tileId: "arch_code", anchorPath: "T_max" },
          target: { tileId: "arch_table", anchorPath: "SAF-01" },
          origin: "user-authored",
          status: "synced",
        },
      },
      comments: {
        c_open: {
          id: "c_open",
          authorId: "u_lead",
          authorName: "Lead Systems Eng",
          text: "Confirm thermal margin before PDR.",
          position: { x: 960, y: 760 },
          resolved: false,
          createdAt: "2026-11-24T00:00:00Z",
          replies: [],
        },
        c_done: {
          id: "c_done",
          authorId: "u_qa",
          authorName: "QA Reviewer",
          text: "Resolved comment should be skipped.",
          position: { x: 1200, y: 760 },
          resolved: true,
          createdAt: "2026-11-24T00:00:00Z",
          replies: [],
        },
      },
    };

    // Paint the entire exhaustive board across all 3 themes
    for (const theme of CANVAS_BOARD_THEME_ORDER) {
      const rec = createRecordingCanvas();
      assert.doesNotThrow(
        () => {
          paintBoardToTextureCanvas(
            rec.canvas,
            syntheticDoc,
            1.5,
            "arch_schematic",
            "arch_fmu",
            "arch_cad3d",
            undefined,
            {
              theme,
            },
          );
        },
        `painting exhaustive ${Object.keys(tiles).length}-tile board in "${theme}" theme must not throw`,
      );
      assert.ok(
        rec.texts.some((t) => t.includes("Lead Systems Eng")),
        `unresolved comment rendered in "${theme}"`,
      );
      assert.ok(
        !rec.texts.some((t) => t.includes("QA Reviewer")),
        `resolved comment should not be rendered in "${theme}"`,
      );
    }

    // Paint full-screen zoom mode for every single canonical archetype
    for (const tile of richArchetypeTiles) {
      const rec = createRecordingCanvas();
      assert.doesNotThrow(() => {
        paintBoardToTextureCanvas(rec.canvas, syntheticDoc, 2.0, null, null, "arch_cad3d", undefined, {
          theme: "blueprint",
          focusedTileId: tile.id,
        });
      }, `full-screen blueprint focus for archetype "${tile.archetype}" must not throw`);
      assert.ok(
        rec.texts.some((t) => t.includes("All Blocks")),
        `back button rendered for "${tile.archetype}"`,
      );
      assert.ok(
        rec.texts.some((t) => t.includes(tile.title)),
        `title rendered for "${tile.archetype}"`,
      );

      // Also verify macro LOD path directly on paintCanvasTileBody
      const macroRec = createRecordingCanvas(320, 200);
      const rendered = paintCanvasTileBody(
        macroRec.ctx,
        tile,
        { x: 0, y: 0, width: 320, height: 200 },
        CANVAS_BOARD_THEMES.blueprint,
        { accent: "#38bdf8", lod: "macro" },
      );
      assert.equal(rendered, "macro");
    }
  });

  test("EngineeringRotunda SSR defaults to blueprint desk theme and respects initialDeskTheme prop", () => {
    const defaultHtml = renderToStaticMarkup(React.createElement(EngineeringRotunda));
    assert.ok(defaultHtml.includes('data-desk-theme="blueprint"'), "SSR defaults to blueprint desk theme");
    assert.ok(defaultHtml.includes('data-testid="rotunda-cycle-desk-theme"'), "renders desktop desk theme toggle");
    assert.ok(
      defaultHtml.includes(`>${CANVAS_BOARD_THEMES.blueprint.label}<`),
      "toggle button displays Blueprint label by default",
    );

    const lightHtml = renderToStaticMarkup(React.createElement(EngineeringRotunda, { initialDeskTheme: "light" }));
    assert.ok(lightHtml.includes('data-desk-theme="light"'), "SSR honors initialDeskTheme='light'");
    assert.ok(lightHtml.includes(`>${CANVAS_BOARD_THEMES.light.label}<`), "toggle button displays Studio Light label");
  });
});
