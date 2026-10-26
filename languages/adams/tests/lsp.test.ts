// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { getAdamsDocumentSymbols, getAdamsHover, validateAdams } from "../src/lsp.js";

const DECK = `
PART/1, GROUND
PART/2, MASS = 5.0, IP = 0.2, 0.2, 0.2
MARKER/1, PART = 1, QP = 0, 0, 0
MARKER/2, PART = 2, QP = 0, 0, 0
JOINT/1, REVOLUTE, I = 1, J = 2
SPRINGDAMPER/1, TRANSLATIONAL, I = 1, J = 2, K = 500, C = 20
`;

test("Adams LSP - validate clean model", () => {
  const diags = validateAdams(DECK);
  // No fatal errors in this clean deck
  const errors = diags.filter((d) => d.severity === 1);
  assert.equal(errors.length, 0);
});

test("Adams LSP - document symbols hierarchy", () => {
  const symbols = getAdamsDocumentSymbols(DECK);
  assert.ok(symbols.length >= 4);

  const part2 = symbols.find((s) => s.name.includes("PART/2"));
  assert.ok(part2);
  assert.ok(part2.children && part2.children.length > 0);

  const j1 = symbols.find((s) => s.name.includes("JOINT/1"));
  assert.ok(j1);
});

test("Adams LSP - contextual hover", () => {
  const partIdx = DECK.indexOf("PART/2");
  const hoverPart = getAdamsHover(DECK, partIdx + 2);
  assert.ok(hoverPart);
  assert.ok(hoverPart.contents.value.includes("MSC Adams Part"));
  assert.ok(hoverPart.contents.value.includes("5 kg"));

  const jointIdx = DECK.indexOf("JOINT/1");
  const hoverJoint = getAdamsHover(DECK, jointIdx + 2);
  assert.ok(hoverJoint);
  assert.ok(hoverJoint.contents.value.includes("REVOLUTE"));
});
