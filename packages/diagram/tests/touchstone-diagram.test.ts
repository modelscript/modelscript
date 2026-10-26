// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTouchstoneDiagram,
  renderIbisBufferSvg,
  renderTouchstoneSvg,
  type IbisModelLike,
  type TouchstoneNetworkLike,
} from "../src/touchstone-diagram-builder.js";

const sampleNetwork: TouchstoneNetworkLike = {
  portCount: 4,
  referenceImpedance: 50.0,
  isPassive: true,
  maxGainDb: -0.05,
};

const sampleIbis: IbisModelLike = {
  componentName: "ASIC_CONTROLLER",
  modelName: "DDR_DQ_IO",
  modelType: "I/O",
  pins: [{ pin: "A12", signal: "DQ0", model: "DDR_DQ_IO", r: 0.05, l: 0.8, c: 0.3 }],
};

test("Touchstone Diagram: Builds X6 graph cells for N-port S-parameter blackbox and terminals", () => {
  const diag = buildTouchstoneDiagram(sampleNetwork);
  assert.equal(diag.title, "4-Port RF S-Parameter Network");
  assert.ok(diag.cells.length >= 9); // 1 central block + 4 ports + 4 lead wires

  const rfBlock = diag.cells.find((c) => c.id === "rf_block");
  assert.ok(rfBlock);
  assert.equal(rfBlock.shape, "rect");
  assert.equal((rfBlock.data as any)?.portCount, 4);

  const p1 = diag.cells.find((c) => c.id === "port_1");
  assert.ok(p1);
  assert.equal(p1.shape, "circle");

  const p4 = diag.cells.find((c) => c.id === "port_4");
  assert.ok(p4);
});

test("Touchstone SVG: Renders standalone N-port schematic with passivity badge", () => {
  const svg = renderTouchstoneSvg(sampleNetwork);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("4-Port RF S-Parameter Network"));
  assert.ok(svg.includes("P1"));
  assert.ok(svg.includes("P2"));
  assert.ok(svg.includes("P3"));
  assert.ok(svg.includes("P4"));
  assert.ok(svg.includes("50 Ω"));
  assert.ok(svg.includes("PASSIVE"));
  assert.ok(svg.endsWith("</svg>\n"));
});

test("IBIS SVG: Renders standalone semiconductor buffer circuit with RLC parasitics and pad", () => {
  const svg = renderIbisBufferSvg(sampleIbis);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("IBIS Buffer: DDR_DQ_IO"));
  assert.ok(svg.includes("R_pkg"));
  assert.ok(svg.includes("L_pkg"));
  assert.ok(svg.includes("0.3pF"));
  assert.ok(svg.includes("PIN: A12"));
  assert.ok(svg.endsWith("</svg>\n"));
});
