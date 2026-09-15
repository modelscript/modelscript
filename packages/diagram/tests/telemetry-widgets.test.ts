// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { animateCells, SparklineRingBuffer } from "../src/telemetry.js";

describe("Telemetry Widgets (Dials, Meters, Sparklines)", () => {
  it("SparklineRingBuffer manages rolling history and outputs SVG points", () => {
    const buf = new SparklineRingBuffer(5);
    buf.push(10);
    buf.push(20);
    buf.push(30);

    const arr = buf.toArray();
    assert.deepStrictEqual(arr, [10, 20, 30]);

    const pts = buf.toPoints(100, 50);
    assert.ok(pts.includes(","), "Must format points as x,y pairs");

    // Push past capacity
    buf.push(40);
    buf.push(50);
    buf.push(60); // Evicts 10
    assert.deepStrictEqual(buf.toArray(), [20, 30, 40, 50, 60]);
  });

  it("animates dial needle with angle transform", () => {
    const attrs: Record<string, any> = {};
    const node = {
      id: "gauge1",
      getData: () => ({
        animations: [{ property: "dial", variableName: "speed" }],
      }),
      attr: (path: string, val: any) => {
        attrs[path] = val;
      },
    };

    animateCells({ nodes: [node], edges: [] }, { speed: 75 });
    assert.strictEqual(attrs["needle/transform"], "rotate(75 50 50)");
  });

  it("animates meter with percentage width", () => {
    const attrs: Record<string, any> = {};
    const node = {
      id: "tank1",
      getData: () => ({
        animations: [{ property: "meter", variableName: "level", range: [0, 200] as [number, number] }],
      }),
      attr: (path: string, val: any) => {
        attrs[path] = val;
      },
    };

    animateCells({ nodes: [node], edges: [] }, { level: 100 });
    assert.strictEqual(attrs["meter/width"], "50.0%");
    assert.ok(attrs["meter/fill"].startsWith("rgb("), "Meter fill should use colormap");
  });

  it("animates sparkline mini history points", () => {
    const attrs: Record<string, any> = {};
    const node = {
      id: "sensor1",
      getData: () => ({
        animations: [{ property: "sparkline", variableName: "temp" }],
      }),
      attr: (path: string, val: any) => {
        attrs[path] = val;
      },
    };

    animateCells({ nodes: [node], edges: [] }, { temp: 21.5 });
    animateCells({ nodes: [node], edges: [] }, { temp: 22.0 });
    animateCells({ nodes: [node], edges: [] }, { temp: 23.5 });

    assert.ok(attrs["sparkline/points"], "Sparkline points should be updated");
    assert.ok(attrs["sparkline/points"].split(" ").length >= 3, "Should have multiple points");
  });
});
