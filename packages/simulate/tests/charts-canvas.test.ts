// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CanvasPlotController,
  renderDatasetCanvas,
  rowsToDataset,
  type Canvas2DContextLike,
} from "../src/charts/index.js";

function createMockCtx() {
  const ops: { kind: string; args: unknown[] }[] = [];
  const texts: string[] = [];
  const ctx: Canvas2DContextLike = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "top",
    save: () => ops.push({ kind: "save", args: [] }),
    restore: () => ops.push({ kind: "restore", args: [] }),
    scale: (x, y) => ops.push({ kind: "scale", args: [x, y] }),
    clearRect: (x, y, w, h) => ops.push({ kind: "clearRect", args: [x, y, w, h] }),
    fillRect: (x, y, w, h) => ops.push({ kind: "fillRect", args: [x, y, w, h] }),
    strokeRect: (x, y, w, h) => ops.push({ kind: "strokeRect", args: [x, y, w, h] }),
    beginPath: () => ops.push({ kind: "beginPath", args: [] }),
    rect: (x, y, w, h) => ops.push({ kind: "rect", args: [x, y, w, h] }),
    clip: () => ops.push({ kind: "clip", args: [] }),
    moveTo: (x, y) => ops.push({ kind: "moveTo", args: [x, y] }),
    lineTo: (x, y) => ops.push({ kind: "lineTo", args: [x, y] }),
    arc: (x, y, r, s, e) => ops.push({ kind: "arc", args: [x, y, r, s, e] }),
    fill: () => ops.push({ kind: "fill", args: [] }),
    stroke: () => ops.push({ kind: "stroke", args: [] }),
    setLineDash: (seg) => ops.push({ kind: "setLineDash", args: [seg] }),
    fillText: (text, x, y) => {
      texts.push(text);
      ops.push({ kind: "fillText", args: [text, x, y] });
    },
  };
  return { ctx, ops, texts };
}

describe("Unified Canvas2D Plotting Engine", () => {
  const wellLogDataset = rowsToDataset(
    [
      { DEPT: 1000, GR: 40, RT: 10, RHOB: 2.35, NPHI: 0.22 },
      { DEPT: 1001, GR: 55, RT: 25, RHOB: 2.42, NPHI: 0.18 },
      { DEPT: 1002, GR: 70, RT: 100, RHOB: 2.51, NPHI: 0.14 },
      { DEPT: 1003, GR: 85, RT: -999.25, RHOB: 2.6, NPHI: 0.11 },
    ],
    { nullValue: -999.25, indexUnit: "m", sourceFormat: "las" },
  );

  it("renders overlay mode with dual cursors and normalization", () => {
    const { ctx, ops, texts } = createMockCtx();
    const res = renderDatasetCanvas(ctx, wellLogDataset, {
      width: 800,
      height: 400,
      mode: "overlay",
      isDark: true,
      cursors: { c1: 1001, c2: 1002 },
      overlay: { normalize: true },
    });

    assert.equal(res.mode, "overlay");
    assert.equal(res.indexBounds.min, 1000);
    assert.equal(res.indexBounds.max, 1003);
    assert.ok(ops.some((o) => o.kind === "lineTo"));
    assert.ok(texts.some((t) => t.startsWith("C1:")));
    assert.ok(texts.some((t) => t.startsWith("C2:")));
  });

  it("renders multitrack mode with auto-grouped tracks, log resistivity scale, and depth header", () => {
    const { ctx, texts } = createMockCtx();
    const res = renderDatasetCanvas(ctx, wellLogDataset, {
      width: 900,
      height: 500,
      mode: "multitrack",
      isDark: false,
      cursors: { c1: 1001.5 },
    });

    assert.equal(res.mode, "multitrack");
    assert.equal(res.tracks?.length, 4);
    assert.ok(texts.some((t) => t.includes("Depth (m)")));
    assert.ok(texts.includes("log"), "RT track should default to log scale");
    assert.ok(texts.some((t) => t.startsWith("C1:")));
  });

  it("renders crossplot mode with 3rd-variable coloring and linear regression", () => {
    const { ctx, ops, texts } = createMockCtx();
    const res = renderDatasetCanvas(ctx, wellLogDataset, {
      width: 600,
      height: 450,
      mode: "crossplot",
      crossplot: {
        xSeries: "RHOB",
        ySeries: "NPHI",
        colorSeries: "GR",
        showRegression: true,
      },
    });

    assert.equal(res.mode, "crossplot");
    assert.ok(res.regression !== null && res.regression !== undefined);
    assert.ok(res.regression!.slope < 0, "NPHI should decrease as RHOB increases");
    assert.ok(ops.some((o) => o.kind === "arc"));
    assert.ok(texts.some((t) => t.includes("R²=")));
  });

  it("renders histogram mode with binned distribution and summary stats", () => {
    const { ctx, texts } = createMockCtx();
    const res = renderDatasetCanvas(ctx, wellLogDataset, {
      width: 600,
      height: 400,
      mode: "histogram",
      histogram: { seriesName: "GR", binCount: 4 },
    });

    assert.equal(res.mode, "histogram");
    assert.equal(res.histogram?.totalCount, 4);
    assert.equal(res.histogram?.bins.length, 4);
    assert.ok(texts.some((t) => t.includes("GR Histogram")));
    assert.ok(texts.some((t) => t.includes("n=4")));
  });

  it("coordinates cursors, zoom, and mode switching in CanvasPlotController", () => {
    const ctrl = new CanvasPlotController({ mode: "multitrack" });
    ctrl.setDataset(wellLogDataset);

    const { ctx } = createMockCtx();
    const first = ctrl.render(ctx, 800, 400);
    assert.ok(first !== null);

    // Place C1 and C2 via pixel coordinates inside plotRect
    const midY = first!.plotRect.y + first!.plotRect.height * 0.5;
    const c1 = ctrl.placeCursorAtPixel(first!.plotRect.x + 20, midY);
    assert.ok(c1 !== null && Math.abs(c1 - 1001.5) < 0.05);

    const zoomed = ctrl.zoomToPixelRange(0, 0, first!.plotRect.y, first!.plotRect.y + first!.plotRect.height * 0.5);
    assert.equal(zoomed, true);

    const second = ctrl.render(ctx, 800, 400);
    assert.ok(second !== null);
    assert.ok(Math.abs(second!.indexBounds.max - 1001.5) < 0.05);

    ctrl.resetZoom();
    const third = ctrl.render(ctx, 800, 400);
    assert.equal(third?.indexBounds.max, 1003);
  });

  it("supports Dual-Y overlay rendering, zoomAtFraction, panByFraction, and 10k-sample spike preservation", () => {
    const n = 10_000;
    const indexValues = Array.from({ length: n }, (_, i) => i * 0.0001);
    const vVals = indexValues.map((t, i) => (i === 2500 ? 500 : 100 * Math.sin(2 * Math.PI * 60 * t)));
    const iVals = indexValues.map((t) => 2.5 * Math.cos(2 * Math.PI * 60 * t));

    const ctrl = new CanvasPlotController({
      mode: "overlay",
      isDark: true,
      overlay: {
        rightAxisSeries: ["I_LINE"],
        yTitle: "Voltage (kV)",
        rightYTitle: "Current (kA)",
        seriesColors: { V_BUS: "#38bdf8", I_LINE: "#f59e0b" },
      },
    });
    ctrl.setDataset({
      sourceFormat: "simulation",
      indexAxis: { key: "time", label: "Time", unit: "s" },
      indexValues,
      series: [
        { name: "V_BUS", unit: "kV", values: vVals },
        { name: "I_LINE", unit: "kA", values: iVals },
      ],
    });

    const texts: string[] = [];
    const strokes: { y: number }[] = [];
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "left" as CanvasTextAlign,
      textBaseline: "alphabetic" as CanvasTextBaseline,
      save() {},
      restore() {},
      scale() {},
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      rect() {},
      clip() {},
      moveTo(_x: number, y: number) {
        strokes.push({ y });
      },
      lineTo(_x: number, y: number) {
        strokes.push({ y });
      },
      arc() {},
      fill() {},
      stroke() {},
      setLineDash() {},
      fillText(t: string) {
        texts.push(t);
      },
    };

    const r1 = ctrl.render(ctx, 800, 400);
    assert.ok(r1 !== null);
    assert.ok(r1!.plotRect.width < 700, "Dual-Y must reserve right-hand margin for second Y-axis");
    assert.ok(texts.includes("Voltage (kV)") && texts.includes("Current (kA)"));
    assert.ok(
      strokes.some((p) => p.y <= r1!.plotRect.y + 2),
      "Min-max decimation must preserve 10k-sample impulse spike at yMax",
    );

    assert.equal(ctrl.zoomAtFraction(0.5, 0.5), true);
    const zoomed = ctrl.getState().viewport;
    assert.ok(zoomed.maxIndex! - zoomed.minIndex! < 0.6);

    const beforeMin = zoomed.minIndex!;
    assert.equal(ctrl.panByFraction(0.1), true);
    assert.ok(ctrl.getState().viewport.minIndex! > beforeMin);
  });
});
