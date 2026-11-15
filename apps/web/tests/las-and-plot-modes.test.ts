// SPDX-License-Identifier: AGPL-3.0-or-later

import { lasToDataset, parseLas } from "@modelscript/las/las-parser";
import {
  CanvasPlotController,
  computeHistogram,
  computeLinearRegression,
  computeVariableStats,
  datasetToRows,
} from "@modelscript/simulate/charts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Web Viewer LAS Ingestion & Multi-Mode Plot Integration", () => {
  it("routes las and well-log artifacts to SimulationPlotViewer in ViewerDispatcher", () => {
    const dispatcherSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/components/artifacts/card/ViewerDispatcher.tsx"),
      "utf-8",
    );
    assert.ok(dispatcherSrc.includes('"las"') && dispatcherSrc.includes('"well-log"'));
    assert.ok(dispatcherSrc.includes("SimulationPlotViewer"));
  });

  it("integrates parseLas, lasToDataset, exportLas, and IndexedCanvasPlot modes in SimulationPlotViewer", () => {
    const viewerSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/components/artifacts/SimulationPlotViewer.tsx"),
      "utf-8",
    );
    const canvasHostSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/components/artifacts/IndexedCanvasPlot.tsx"),
      "utf-8",
    );

    assert.ok(viewerSrc.includes("parseLas"));
    assert.ok(viewerSrc.includes("lasToDataset"));
    assert.ok(viewerSrc.includes("exportLas"));
    assert.ok(viewerSrc.includes("IndexedCanvasPlot"));
    assert.ok(viewerSrc.includes("multitrack") && viewerSrc.includes("crossplot") && viewerSrc.includes("histogram"));

    assert.ok(canvasHostSrc.includes("CanvasPlotController"));
    assert.ok(canvasHostSrc.includes("placeCursorAtPixel"));
    assert.ok(canvasHostSrc.includes("zoomToPixelRange"));
    assert.ok(canvasHostSrc.includes("resetZoom"));
  });

  it("bridges LAS 2.0 well log into CanvasPlotController across Multi-Track, Crossplot, and Histogram modes", () => {
    const lasText = [
      "~Version Information",
      " VERS. 2.0 : CWLS LOG ASCII STANDARD",
      " WRAP.  NO : ONE LINE PER DEPTH STEP",
      "~Well Information",
      " STRT.M   2000.0 : START DEPTH",
      " STOP.M   2004.0 : STOP DEPTH",
      " STEP.M      1.0 : STEP",
      " NULL.   -999.25 : NULL VALUE",
      "~Curve Information",
      " DEPT.M          : 1 DEPTH",
      " GR  .GAPI       : 2 GAMMA RAY",
      " RHOB.G/C3       : 3 BULK DENSITY",
      " RT  .OHMM       : 4 DEEP RESISTIVITY",
      "~A",
      " 2000.0   40.0   2.45   10.0",
      " 2001.0   50.0   2.35   20.0",
      " 2002.0  -999.25 2.30   30.0",
      " 2003.0   70.0   2.15   40.0",
      " 2004.0   80.0   2.05   50.0",
    ].join("\n");

    const doc = parseLas(lasText);
    const dataset = lasToDataset(doc, { title: "Well_Test" });
    assert.equal(dataset.indexAxis.inverted, true);
    assert.equal(dataset.series.length, 3);

    const rows = datasetToRows(dataset);
    assert.equal(rows.length, 5);
    assert.equal(rows[0]!.DEPT, 2000.0);
    assert.ok(Number.isNaN(rows[2]!.GR!));

    const stats = computeVariableStats(dataset);
    const grStats = stats.find((s) => s.name === "GR");
    assert.ok(grStats);
    assert.equal(grStats.count, 4);
    assert.equal(grStats.min, 40.0);
    assert.equal(grStats.max, 80.0);

    const grVals = dataset.series.find((s) => s.name === "GR")!.values;
    const rhobVals = dataset.series.find((s) => s.name === "RHOB")!.values;
    const reg = computeLinearRegression(grVals, rhobVals);
    assert.ok(reg);
    assert.ok(reg.slope < 0, "RHOB decreases as GR increases");
    assert.ok(reg.r2 > 0.98);

    const hist = computeHistogram(rhobVals, { binCount: 4 });
    assert.equal(hist.bins.length, 4);

    // Smoke-test CanvasPlotController with a minimal 2D context mock
    const calls: string[] = [];
    const mockCtx: any = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      scale: () => {},
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      rect: () => {},
      clip: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      setLineDash: () => {},
      fillText: () => {},
    };

    const ctrl = new CanvasPlotController({ mode: "multitrack", isDark: true });
    ctrl.setDataset(dataset);
    const mt = ctrl.render(mockCtx, 800, 480, 1);
    assert.equal(mt?.mode, "multitrack");
    assert.equal(mt?.tracks?.length, 3);

    ctrl.updateConfig({
      mode: "crossplot",
      crossplot: { xSeries: "GR", ySeries: "RHOB", showRegression: true },
    });
    const cp = ctrl.render(mockCtx, 800, 480, 1);
    assert.equal(cp?.mode, "crossplot");
    assert.ok((cp?.regression?.r2 ?? 0) > 0.98);

    ctrl.updateConfig({ mode: "histogram", histogram: { seriesName: "RT", binCount: 5 } });
    const hg = ctrl.render(mockCtx, 800, 480, 1);
    assert.equal(hg?.mode, "histogram");
    assert.equal(hg?.histogram?.bins.length, 5);
  });
});
