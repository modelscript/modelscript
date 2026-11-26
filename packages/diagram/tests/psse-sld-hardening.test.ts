// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderPsseSvg, type PsseCaseLike, type PssePowerFlowOverlay } from "../src/psse-diagram-builder.js";

function buildMeshed10BusCase(): { psseCase: PsseCaseLike; overlay: PssePowerFlowOverlay } {
  const buses = new Map<number, Record<string, unknown>>();
  for (let i = 1; i <= 10; i++) {
    buses.set(i, {
      i,
      name: `BUS_${i}_345`,
      baseKv: 345,
      ide: i === 1 ? 3 : i <= 4 ? 2 : 1,
      vm: 1.01 + (i % 3) * 0.01,
      va: -i * 0.5,
      span: { line: 10 + i },
    });
  }

  const generators = [1, 2, 3, 4].map((bus, idx) => ({
    i: bus,
    id: "1",
    pg: 250 + idx * 30,
    qg: 20 + idx * 10,
    stat: 1,
    span: { line: 30 + idx },
  }));

  const loads = [5, 6, 7, 8, 9, 10].map((bus, idx) => ({
    i: bus,
    id: "1",
    pl: 150 + idx * 20,
    ql: 40 + idx * 5,
    status: 1,
  }));

  const pairs: Array<[number, number]> = [
    [1, 5],
    [1, 7],
    [2, 6],
    [2, 9],
    [3, 6],
    [3, 7],
    [3, 8],
    [4, 5],
    [4, 7],
    [5, 7],
    [6, 9],
    [7, 10],
    [8, 9],
  ];

  const branches = pairs.map(([from, to], idx) => ({
    i: from,
    j: to,
    ckt: "1",
    r: 0.005,
    x: 0.05,
    b: 0.02,
    rateA: 500,
    st: 1,
    span: { line: 50 + idx },
  }));

  const overlay: PssePowerFlowOverlay = {
    converged: true,
    buses: Array.from(buses.keys()).map((b) => ({
      busNumber: b,
      vm: 1.01,
      va: -b * 0.5,
    })),
    branches: pairs.map(([from, to], idx) => ({
      fromBus: from,
      toBus: to,
      ckt: "1",
      pFromMw: 80 + idx * 12,
      qFromMvar: 5 + idx,
      loadingPercent: 15 + idx * 4,
    })),
  };

  return {
    psseCase: {
      header: { sbase: 100 },
      buses,
      generators,
      loads,
      branches,
      transformers: [],
      fixedShunts: [],
      switchedShunts: [],
    } as unknown as PsseCaseLike,
    overlay,
  };
}

describe("PSS/E SLD SVG Hardening", () => {
  it("supports crisp light theme with zero dark background leaks", () => {
    const { psseCase, overlay } = buildMeshed10BusCase();
    const svg = renderPsseSvg(psseCase, overlay, { theme: "light" });
    assert.match(svg, /background:#f8fafc/);
    assert.doesNotMatch(svg, /background:#0b0f19/);
    assert.match(svg, /fill="#ffffff"/);
  });

  it("preserves dark blueprint theme when theme='dark'", () => {
    const { psseCase, overlay } = buildMeshed10BusCase();
    const svg = renderPsseSvg(psseCase, overlay, { theme: "dark" });
    assert.match(svg, /background:#0b0f19/);
  });

  it("renders generators as IEEE circles with gen-ring instead of busbar rectangles", () => {
    const { psseCase, overlay } = buildMeshed10BusCase();
    const svg = renderPsseSvg(psseCase, overlay, { theme: "light" });
    const genNodes = svg.match(/class="sld-node gen-node"/g) ?? [];
    const genRings = svg.match(/class="gen-ring"/g) ?? [];
    assert.equal(genNodes.length, 4, "All 4 generators should render as gen-node");
    assert.equal(genRings.length, 4, "All 4 generators should render IEEE generator circles");
  });

  it("emits data-line and data-entity-id attributes for click-to-source interactivity", () => {
    const { psseCase, overlay } = buildMeshed10BusCase();
    const svg = renderPsseSvg(psseCase, overlay, { theme: "light" });
    assert.match(svg, /data-entity-id="bus_1"[^>]*data-line="11"/);
    assert.match(svg, /data-entity-kind="branch"[^>]*data-line="50"/);
    assert.match(svg, /data-entity-kind="generator"[^>]*data-line="30"/);
  });

  it("prevents edge label pills from overlapping substation busbar bounding boxes", () => {
    const { psseCase, overlay } = buildMeshed10BusCase();
    const svg = renderPsseSvg(psseCase, overlay, { theme: "light" });

    // Extract all busbar rects
    const busBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    const busRe =
      /class="sld-node bus-node"[\s\S]*?<rect class="node-body" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = busRe.exec(svg)) !== null) {
      busBoxes.push({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) });
    }
    assert.equal(busBoxes.length, 10);

    // Extract all branch label pill rects
    const pillBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    const pillRe = /<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="16" rx="4"/g;
    while ((m = pillRe.exec(svg)) !== null) {
      pillBoxes.push({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: 16 });
    }
    assert.ok(pillBoxes.length >= 10, "Expected branch flow label pills");

    let overlaps = 0;
    for (const p of pillBoxes) {
      for (const b of busBoxes) {
        if (p.x < b.x + b.w && p.x + p.w > b.x && p.y < b.y + b.h && p.y + p.h > b.y) {
          overlaps++;
        }
      }
    }
    assert.equal(overlaps, 0, `Expected 0 edge-label/busbar collisions, found ${overlaps}`);
  });
});
