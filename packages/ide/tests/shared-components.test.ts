// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { getNonce } from "../src/utils/nonce.js";
import { extractFromZip } from "../src/utils/zip.js";
import {
  computeCursorMetrics,
  formatSeriesToCsv,
  isWebGLAvailable,
  psoutTracesToDataSeries,
  type DataSeries,
} from "../src/webview/shared/index.js";

describe("Shared Webview Components & Utilities Suite", () => {
  describe("Nonce Utility", () => {
    it("generates a high-entropy 32-character or UUID string", () => {
      const n1 = getNonce();
      const n2 = getNonce();
      assert.ok(n1 && typeof n1 === "string");
      assert.ok(n2 && typeof n2 === "string");
      assert.notStrictEqual(n1, n2, "Nonces should be distinct across calls");
      assert.ok(n1.length >= 16, "Nonce should have sufficient length");
    });
  });

  describe("WebGL Safe Detection", () => {
    it("safely returns false in headless/Node environment without throwing", () => {
      const available = isWebGLAvailable();
      assert.strictEqual(available, false);
    });
  });

  describe("TimeSeriesViewer: computeCursorMetrics", () => {
    const seriesA: DataSeries = {
      id: "series_a",
      name: "Voltage",
      color: "#ff0000",
      points: [
        { x: 0.0, y: 0.0 },
        { x: 1.0, y: 10.0 },
        { x: 2.0, y: 30.0 },
        { x: 3.0, y: 30.0 },
      ],
    };

    const seriesB: DataSeries = {
      id: "series_b",
      name: "Current",
      color: "#00ff00",
      points: [
        { x: 0.0, y: 5.0 },
        { x: 2.0, y: 5.0 },
        { x: 4.0, y: 15.0 },
      ],
    };

    it("accurately computes dx, frequency, dy, and slope between two cursor points", () => {
      const metrics = computeCursorMetrics(0.5, 1.5, [seriesA, seriesB]);

      assert.strictEqual(metrics.x1, 0.5);
      assert.strictEqual(metrics.x2, 1.5);
      assert.strictEqual(metrics.dx, 1.0);
      assert.strictEqual(metrics.frequency, 1.0);

      // Series A at x=0.5: linearly interpolated between (0, 0) and (1, 10) -> 5.0
      // Series A at x=1.5: linearly interpolated between (1, 10) and (2, 30) -> 20.0
      // dy = 20 - 5 = 15, slope = 15 / 1.0 = 15.0
      assert.strictEqual(metrics.dyPerSeries["series_a"], 15.0);
      assert.strictEqual(metrics.slopePerSeries["series_a"], 15.0);

      // Series B at x=0.5: linearly interpolated between (0, 5) and (2, 5) -> 5.0
      // Series B at x=1.5: linearly interpolated between (0, 5) and (2, 5) -> 5.0
      // dy = 0, slope = 0
      assert.strictEqual(metrics.dyPerSeries["series_b"], 0.0);
      assert.strictEqual(metrics.slopePerSeries["series_b"], 0.0);
    });

    it("handles reverse cursor placement (c1X > c2X) correctly", () => {
      const metrics = computeCursorMetrics(2.0, 1.0, [seriesA]);
      assert.strictEqual(metrics.x1, 1.0);
      assert.strictEqual(metrics.x2, 2.0);
      assert.strictEqual(metrics.dx, 1.0);
      assert.strictEqual(metrics.frequency, 1.0);
      assert.strictEqual(metrics.dyPerSeries["series_a"], 20.0);
    });

    it("handles zero delta x without division by zero or NaN", () => {
      const metrics = computeCursorMetrics(1.5, 1.5, [seriesA]);
      assert.strictEqual(metrics.dx, 0);
      assert.strictEqual(metrics.frequency, 0);
      assert.strictEqual(metrics.dyPerSeries["series_a"], 0);
      assert.strictEqual(metrics.slopePerSeries["series_a"], 0);
    });

    it("clamps to boundary values when cursors lie outside series domain", () => {
      const metrics = computeCursorMetrics(-1.0, 5.0, [seriesA]);
      // At -1: clamped to first point y=0
      // At 5.0: clamped to last point y=30
      assert.strictEqual(metrics.dyPerSeries["series_a"], 30.0);
    });
  });

  describe("TimeSeriesViewer: formatSeriesToCsv", () => {
    it("formats multi-series time waveforms into valid RFC 4180 CSV", () => {
      const time = [0.0, 0.1, 0.2];
      const series = [
        { name: "Voltage", values: [10.0, 12.5, 15.0] },
        { name: "Current", values: [1.0, 1.2, 1.4] },
      ];

      const csv = formatSeriesToCsv(time, series);
      const lines = csv.trim().split("\n");

      assert.strictEqual(lines[0], "Time (s),Voltage,Current");
      assert.strictEqual(lines[1], "0,10,1");
      assert.strictEqual(lines[2], "0.1,12.5,1.2");
      assert.strictEqual(lines[3], "0.2,15,1.4");
    });
  });

  describe("TimeSeriesViewer: psoutTracesToDataSeries", () => {
    it("converts PSCAD psout traces and time vector to DataSeries array", () => {
      const time = [0.0, 0.001, 0.002];
      const traces = [
        { id: 1, name: "V_BUS1", unit: "kV", values: [230.0, 231.2, 229.8] },
        { id: 2, name: "I_LINE1", unit: "kA", values: [1.2, 1.25, 1.18] },
      ];

      const series = psoutTracesToDataSeries(traces, time);
      assert.strictEqual(series.length, 2);
      assert.strictEqual(series[0]?.id, "trace_1");
      assert.strictEqual(series[0]?.name, "V_BUS1");
      assert.strictEqual(series[0]?.unit, "kV");
      assert.strictEqual(series[0]?.points.length, 3);
      assert.deepStrictEqual(series[0]?.points[0], { x: 0.0, y: 230.0 });
      assert.deepStrictEqual(series[0]?.points[1], { x: 0.001, y: 231.2 });
      assert.strictEqual(series[1]?.name, "I_LINE1");
      assert.strictEqual(series[1]?.unit, "kA");
      assert.strictEqual(series[1]?.points.length, 3);
    });
  });

  describe("ZIP Extraction Utility", () => {
    it("safely handles empty buffer or invalid ZIP signatures gracefully", () => {
      const dummyBuffer = new Uint8Array([0, 1, 2, 3]);
      const extracted = extractFromZip(dummyBuffer, "modelDescription.xml");
      assert.strictEqual(extracted, null);
    });
  });
});
