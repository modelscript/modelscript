// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { LspSymbolKind, getAptCompletions, getAptDocumentSymbols, getAptHover, validateApt } from "../src/index.js";

const SAMPLE_PROGRAM = [
  "PARTNO LSP DEMO PART",
  "UNITS / INCHES",
  "CUTTER / 0.5",
  "SPINDL / 1800, CLW",
  "FEDRAT / 12.0",
  "P1 = POINT / 0.0, 0.0, 0.0",
  "P2 = POINT / 4.0, 0.0, 0.0",
  "L1 = LINE / P1, P2",
  "C1 = CIRCLE / CENTER, P2, RADIUS, 1.0",
  "FROM / P1",
  "GOTO / P2",
  "FINI",
].join("\n");

test("APT LSP: validateApt returns empty diagnostics for valid program and structured errors for invalid program", () => {
  const clean = validateApt(SAMPLE_PROGRAM, "demo.apt");
  assert.equal(clean.length, 0);

  const invalid = ["PARTNO BROKEN", "CUTTER / -1", "GOTO / P_UNKNOWN"].join("\n");

  const diags = validateApt(invalid, "broken.apt");
  assert.ok(diags.length >= 3);
  assert.ok(diags.some((d) => d.code === "APT3001" && d.severity === 1 && d.source === "modelscript-apt"));
  assert.ok(diags.some((d) => d.code === "APT4001"));
  assert.ok(diags.some((d) => d.code === "APT2002"));
  assert.ok(diags.some((d) => d.code === "APT5002" && d.severity === 2));
});

test("APT LSP: getAptDocumentSymbols returns hierarchical part program and geometry symbols", () => {
  const symbols = getAptDocumentSymbols(SAMPLE_PROGRAM);
  assert.equal(symbols.length, 1);
  const root = symbols[0]!;
  assert.equal(root.name, "LSP DEMO PART");
  assert.equal(root.kind, LspSymbolKind.Package);
  assert.ok(root.children && root.children.length >= 7);

  const p1 = root.children.find((c) => c.name === "P1");
  assert.ok(p1);
  assert.equal(p1.kind, LspSymbolKind.Variable);
  assert.ok(p1.detail?.includes("POINT"));

  const cutter = root.children.find((c) => c.name === "CUTTER");
  assert.ok(cutter);
  assert.equal(cutter.kind, LspSymbolKind.Constant);
});

test("APT LSP: getAptHover resolves stdlib keywords, postprocessor directives, and user geometry labels", () => {
  // Hover over CUTTER on line 2
  const cutterHover = getAptHover(SAMPLE_PROGRAM, { line: 2, character: 2 });
  assert.ok(cutterHover);
  assert.ok(cutterHover.contents.value.includes("CUTTER"));

  // Hover over FINI on line 11
  const finiHover = getAptHover(SAMPLE_PROGRAM, { line: 11, character: 1 });
  assert.ok(finiHover);
  assert.ok(finiHover.contents.value.includes("FINI"));

  // Hover over user-defined geometry label C1 on line 8
  const c1Hover = getAptHover(SAMPLE_PROGRAM, { line: 8, character: 1 });
  assert.ok(c1Hover);
  assert.ok(c1Hover.contents.value.includes("C1"));
  assert.ok(c1Hover.contents.value.includes("radius `1.0000`"));

  // Hover over empty / out-of-bounds line returns null
  assert.equal(getAptHover(SAMPLE_PROGRAM, { line: 99, character: 0 }), null);
});

test("APT LSP: getAptCompletions returns APT geometry, motion, and modifier completions", () => {
  const items = getAptCompletions();
  assert.ok(items.length >= 25);
  const labels = new Set(items.map((i) => i.label));
  assert.ok(labels.has("POINT"));
  assert.ok(labels.has("LINE"));
  assert.ok(labels.has("CIRCLE"));
  assert.ok(labels.has("CUTTER"));
  assert.ok(labels.has("GOLFT"));
  assert.ok(labels.has("TANTO"));
  assert.ok(labels.has("FINI"));
});
