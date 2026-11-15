// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeHistogram,
  computeLinearRegression,
  computeRowsVariableStats,
  computeVariableStats,
  datasetToCsv,
  datasetToRows,
  detectIndexAxis,
  downsampleDataset,
  downsampleMinMaxRows,
  isValidSample,
  lttbDecimate,
  rowsToDataset,
  simulationToDataset,
  sliceDatasetByRange,
  transformSeriesValue,
} from "../src/charts/index.js";

describe("@modelscript/simulate/charts", () => {
  it("converts simulation output to IndexedDataset and back to rows/CSV", () => {
    const ds = simulationToDataset({
      t: [0, 0.5, 1.0],
      states: ["v", "i"],
      y: [
        [0, 1],
        [5, 2],
        [10, 3],
      ],
      variableMetadata: { v: { unit: "V", description: "Voltage" } },
      title: "Circuit",
    });

    assert.equal(ds.indexAxis.key, "time");
    assert.equal(ds.indexAxis.unit, "s");
    assert.equal(ds.indexAxis.inverted, false);
    assert.equal(ds.series[0]?.unit, "V");
    assert.deepEqual(ds.series[0]?.values, [0, 5, 10]);

    const rows = datasetToRows(ds);
    assert.deepEqual(rows[1], { time: 0.5, v: 5, i: 2 });

    const csv = datasetToCsv(ds);
    assert.equal(csv, "time,v,i\n0,0,1\n0.5,5,2\n1,10,3");
  });

  it("auto-detects depth-indexed tabular rows and handles null sentinel values", () => {
    const rows = [
      { DEPT: 1000, GR: 45, RHOB: -999.25 },
      { DEPT: 1000.5, GR: 55, RHOB: 2.35 },
      { DEPT: 1001.0, GR: 65, RHOB: 2.45 },
    ];
    const axis = detectIndexAxis(rows);
    assert.equal(axis.key, "DEPT");
    assert.equal(axis.label, "Depth");
    assert.equal(axis.inverted, true);

    const ds = rowsToDataset(rows, { nullValue: -999.25, indexUnit: "m", sourceFormat: "las" });
    assert.equal(ds.indexAxis.inverted, true);
    assert.equal(ds.indexAxis.nullValue, -999.25);

    const stats = computeVariableStats(ds);
    const rhob = stats.find((s) => s.name === "RHOB")!;
    assert.equal(rhob.count, 2);
    assert.equal(rhob.min, 2.35);
    assert.equal(rhob.max, 2.45);
    assert.ok(Math.abs(rhob.mean - 2.4) < 1e-9);
  });

  it("computes windowed variable stats, percentiles, histograms, and linear regression", () => {
    const ds = rowsToDataset([
      { time: 0, x: 0, y: 1 },
      { time: 1, x: 1, y: 3 },
      { time: 2, x: 2, y: 5 },
      { time: 3, x: 3, y: 7 },
      { time: 4, x: 4, y: 9 },
    ]);

    const sliced = sliceDatasetByRange(ds, 1, 3);
    assert.deepEqual(sliced.indexValues, [1, 2, 3]);

    const stats = computeVariableStats(ds, { minIndex: 1, maxIndex: 3 });
    const yStats = stats.find((s) => s.name === "y")!;
    assert.equal(yStats.min, 3);
    assert.equal(yStats.max, 7);
    assert.equal(yStats.p50, 5);
    assert.ok(Math.abs(yStats.mean - 5) < 1e-9);

    const rowStats = computeRowsVariableStats(datasetToRows(ds), ["y"], { indexKey: "time", minIndex: 1, maxIndex: 3 });
    assert.equal(rowStats[0]?.min, 3);
    assert.equal(rowStats[0]?.max, 7);

    const hist = computeHistogram([1, 2, 2, 3, 4, 5, -999.25], { binCount: 4, nullValue: -999.25 });
    assert.equal(hist.totalCount, 6);
    assert.equal(hist.bins.length, 4);
    assert.equal(
      hist.bins.reduce((acc, b) => acc + b.count, 0),
      6,
    );

    const reg = computeLinearRegression(ds.series[0]!.values, ds.series[1]!.values);
    assert.ok(reg !== null);
    assert.ok(Math.abs(reg.slope - 2) < 1e-9);
    assert.ok(Math.abs(reg.intercept - 1) < 1e-9);
    assert.ok(Math.abs(reg.r2 - 1) < 1e-9);
  });

  it("decimates large series with LTTB and min-max envelope downsampling", () => {
    const pts = Array.from({ length: 5000 }, (_, i) => ({ x: i, y: Math.sin(i * 0.05) * 10 }));
    const decimated = lttbDecimate(pts, 500);
    assert.equal(decimated.length, 500);
    assert.equal(decimated[0]?.x, 0);
    assert.equal(decimated[decimated.length - 1]?.x, 4999);

    const rows = pts.map((p) => ({ time: p.x, sig: p.y }));
    const downRows = downsampleMinMaxRows(rows, "sig", 200, 1000);
    assert.ok(downRows.length <= 200);
    assert.equal(downRows[0]?.time, 0);
    assert.equal(downRows[downRows.length - 1]?.time, 4999);

    const ds = rowsToDataset(rows);
    const downDs = downsampleDataset(ds, "sig", 200, 1000);
    assert.ok(downDs.indexValues.length <= 200);
  });

  it("validates samples and transforms values with normalization and log scale", () => {
    assert.equal(isValidSample(-999.25, -999.25), false);
    assert.equal(isValidSample(NaN), false);
    assert.equal(isValidSample(42, -999.25), true);

    assert.equal(transformSeriesValue(5, { normalize: { min: 0, span: 10 } }), 0.5);
    assert.equal(transformSeriesValue(0, { normalize: { min: 0, span: 10 }, logScale: true }), 1e-6);
    assert.equal(transformSeriesValue(-1, { logScale: true }), null);
  });
});
