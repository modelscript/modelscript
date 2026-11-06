// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { animateCells, turboColormap, type ReactiveAnimationBinding } from "../src/telemetry.js";

describe("Live Telemetry & Turbo Colormap", () => {
  it("should calculate continuous Turbo colormap colors with clamping", () => {
    const c0 = turboColormap(0);
    assert.ok(c0.startsWith("rgb("));

    const cMid = turboColormap(0.5);
    assert.ok(cMid.startsWith("rgb("));

    const c1 = turboColormap(1);
    assert.ok(c1.startsWith("rgb("));

    // Must be distinct colors
    assert.notStrictEqual(c0, cMid);
    assert.notStrictEqual(cMid, c1);
    assert.notStrictEqual(c0, c1);

    // Clamping checks
    assert.strictEqual(turboColormap(-10), c0);
    assert.strictEqual(turboColormap(10), c1);
  });

  it("should apply simulation frame animations to graph cells", () => {
    const attrCalls: { selector: string; attrs: any }[] = [];
    const translationCalls: { dx: number; dy: number }[] = [];

    const mockNode = {
      isNode: () => true,
      isEdge: () => false,
      attr: (path: string, val: any) => {
        attrCalls.push({ selector: path, attrs: val });
      },
      translate: (dx: number, dy: number) => {
        translationCalls.push({ dx, dy });
      },
    };

    const mockEdge = {
      isNode: () => false,
      isEdge: () => true,
      attr: (path: string, val: any) => {
        attrCalls.push({ selector: path, attrs: val });
      },
    };

    const cellsMap = new Map<string, any>([
      ["cell_node", mockNode],
      ["cell_edge", mockEdge],
    ]);

    const mockGraph = {
      getCellById: (id: string) => cellsMap.get(id),
    };

    const bindings: ReactiveAnimationBinding[] = [
      {
        cellId: "cell_node",
        property: "fillColor",
        variableName: "temp",
        transform: "turbo",
        range: [0, 100],
      },
      {
        cellId: "cell_node",
        property: "dx",
        variableName: "displacementX",
      },
      {
        cellId: "cell_node",
        property: "label",
        variableName: "temp",
      },
      {
        cellId: "cell_edge",
        property: "flowRate",
        variableName: "current",
      },
    ];

    const frameValues = {
      temp: 50,
      displacementX: 15,
      current: 4.5,
      pressureNorm: 0.5,
    };

    (mockNode as any).getData = () => ({
      animations: [
        { property: "dx", variableName: "displacementX" },
        { property: "label", variableName: "temp" },
        { property: "colormap", variableName: "pressureNorm" },
      ],
    });
    (mockEdge as any).getData = () => ({ animations: [{ property: "flow", variableName: "current" }] });

    animateCells({ nodes: [mockNode as any], edges: [mockEdge as any] }, frameValues);

    // Verify node color was mapped via Turbo colormap
    assert.ok(attrCalls.some((c) => c.selector === "body/fill" && c.attrs === turboColormap(0.5)));

    // Verify translation was applied
    assert.strictEqual(translationCalls.length, 1);
    assert.strictEqual(translationCalls[0].dx, 15);
    assert.strictEqual(translationCalls[0].dy, 0);

    // Verify label text was formatted
    assert.ok(attrCalls.some((c) => c.selector === "label/text" && c.attrs === "50.00"));

    // Verify edge flow animation offset was decremented
    assert.ok(attrCalls.some((c) => c.selector === "line/strokeDashoffset" && c.attrs < 10));
  });

  it("should animate breaker state badges between OPEN and CLOSED", () => {
    const attrCalls: { selector: string; attrs: any }[] = [];
    const mockBreaker = {
      attr: (path: string, val: any) => attrCalls.push({ selector: path, attrs: val }),
      getData: () => ({ animations: [{ property: "breaker", variableName: "brk_status" }] }),
    };

    // Open breaker (0)
    animateCells({ nodes: [mockBreaker as any], edges: [] }, { brk_status: 0 });
    assert.ok(attrCalls.some((c) => c.selector === "breaker/text" && c.attrs === "OPEN"));
    assert.ok(attrCalls.some((c) => c.selector === "breaker/fill" && c.attrs === "#22c55e"));

    // Closed breaker (1)
    attrCalls.length = 0;
    animateCells({ nodes: [mockBreaker as any], edges: [] }, { brk_status: 1 });
    assert.ok(attrCalls.some((c) => c.selector === "breaker/text" && c.attrs === "CLOSED"));
    assert.ok(attrCalls.some((c) => c.selector === "breaker/fill" && c.attrs === "#ef4444"));
  });

  it("should animate wire voltage colormaps normalized to range", () => {
    const attrCalls: { selector: string; attrs: any }[] = [];
    const mockWire = {
      attr: (path: string, val: any) => attrCalls.push({ selector: path, attrs: val }),
      getData: () => ({
        animations: [{ property: "voltage", variableName: "V_bus", range: [100, 200] as [number, number] }],
      }),
    };

    // 150 is exactly 50% between 100 and 200
    animateCells({ nodes: [], edges: [mockWire as any] }, { V_bus: 150 });
    assert.ok(attrCalls.some((c) => c.selector === "line/stroke" && c.attrs === turboColormap(0.5)));
  });

  it("should configure dasharray particles for active current flow", () => {
    const attrCalls: { selector: string; attrs: any }[] = [];
    const mockWire = {
      attr: (path: string, val: any) => attrCalls.push({ selector: path, attrs: val }),
      getData: () => ({ animations: [{ property: "flow", variableName: "I_line" }] }),
    };

    animateCells({ nodes: [], edges: [mockWire as any] }, { I_line: 12.5 });
    assert.ok(attrCalls.some((c) => c.selector === "line/strokeDasharray" && c.attrs === "6 4"));
    assert.ok(attrCalls.some((c) => c.selector === "line/strokeDashoffset" && c.attrs === 12.5));
  });
});
