// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import assert from "node:assert/strict";
import test from "node:test";
import {
  LspSymbolKind,
  gcodeIndexing,
  getGCodeCompletions,
  getGCodeDocumentSymbols,
  getGCodeHover,
  validateGCode,
} from "../src/index.js";

const VALID_PROGRAM = [
  "%",
  "O4001 (LSP TEST PROGRAM)",
  "#100 = 25.5",
  "G21 G90 G17 G54",
  "T1 M06",
  "S8000 M03",
  "G00 X0 Y0 Z10",
  "G01 Z-2 F300",
  "G01 X#100 Y#101 F600",
  "G02 X35.5 Y10 I0 J10",
  "G00 Z10",
  "T2",
  "M98 P4002 L1",
  "M05",
  "M30",
  "O4002 (SUBPROGRAM)",
  "S8000 M03",
  "G01 X0 Y0 F500",
  "M99",
  "%",
].join("\n");

test("G-code LSP validateGCode: returns empty diagnostics for valid program and LSP diagnostics for errors", () => {
  const clean = validateGCode(VALID_PROGRAM, "valid.nc");
  assert.equal(clean.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(clean)}`);

  const faulty = [
    "G21 G90 G17",
    "G01 X10 Y10", // missing feedrate
    "G02 X20 Y20", // missing I/J/K/R
  ].join("\n");

  const diags = validateGCode(faulty, "faulty.nc");
  assert.ok(diags.length >= 2, `Expected at least 2 diagnostics, got ${diags.length}`);
  for (const d of diags) {
    assert.equal(d.source, "modelscript-gcode");
    assert.ok(d.severity === 1 || d.severity === 2 || d.severity === 3);
    assert.ok(d.code.length > 0);
    assert.ok(d.message.length > 0);
    assert.ok(d.range.start.line >= 0);
    assert.ok(d.range.end.character > d.range.start.character);
  }
});

test("G-code LSP getGCodeDocumentSymbols: extracts root program, tools, and subprograms", () => {
  const symbols = getGCodeDocumentSymbols(VALID_PROGRAM);
  assert.equal(symbols.length, 1);

  const root = symbols[0]!;
  assert.equal(root.name, "O4001");
  assert.equal(root.kind, LspSymbolKind.Package);
  assert.ok(root.detail?.includes("CNC G-code Program"));
  assert.ok(Array.isArray(root.children));

  const t1 = root.children!.find((c) => c.name === "T1");
  assert.ok(t1, "Expected T1 tool change symbol");
  assert.equal(t1.kind, LspSymbolKind.Variable);
  assert.equal(t1.detail, "Tool Change");

  const t2 = root.children!.find((c) => c.name === "T2");
  assert.ok(t2, "Expected T2 tool select symbol");
  assert.equal(t2.kind, LspSymbolKind.Variable);
  assert.equal(t2.detail, "Tool Select");

  const sub = root.children!.find((c) => c.name === "O4002");
  assert.ok(sub, "Expected O4002 subprogram symbol");
  assert.equal(sub.kind, LspSymbolKind.Function);
  assert.ok(sub.detail?.includes("Subprogram"));
  assert.ok(sub.range.end.line >= sub.range.start.line);
});

test("G-code LSP getGCodeHover: provides markdown docs for catalog G/M codes, modal codes, and # parameters", () => {
  // Line 3: "G21 G90 G17 G54"
  const hoverG21 = getGCodeHover(VALID_PROGRAM, { line: 3, character: 1 });
  assert.ok(hoverG21, "Expected hover for G21");
  assert.equal(hoverG21.contents.kind, "markdown");
  assert.ok(hoverG21.contents.value.includes("G21"));
  assert.deepEqual(hoverG21.range, {
    start: { line: 3, character: 0 },
    end: { line: 3, character: 3 },
  });

  // Line 7: "G01 Z-2 F300" (catalog schema lookup)
  const hoverG01 = getGCodeHover(VALID_PROGRAM, { line: 7, character: 1 });
  assert.ok(hoverG01, "Expected hover for G01");
  assert.ok(hoverG01.contents.value.includes("G01"));
  assert.ok(hoverG01.contents.value.includes("Standard:"));

  // Line 8: "G01 X#100 Y#101 F600" — set parameter #100
  const idx100 = VALID_PROGRAM.split("\n")[8]!.indexOf("#100");
  const hoverParamSet = getGCodeHover(VALID_PROGRAM, { line: 8, character: idx100 + 1 });
  assert.ok(hoverParamSet, "Expected hover for #100");
  assert.ok(hoverParamSet.contents.value.includes("#100"));
  assert.ok(hoverParamSet.contents.value.includes("25.5"));

  // Unset parameter #101
  const idx101 = VALID_PROGRAM.split("\n")[8]!.indexOf("#101");
  const hoverParamUnset = getGCodeHover(VALID_PROGRAM, { line: 8, character: idx101 + 1 });
  assert.ok(hoverParamUnset, "Expected hover for #101");
  assert.ok(hoverParamUnset.contents.value.includes("#101"));
  assert.ok(hoverParamUnset.contents.value.includes("unset"));

  // Out-of-bounds line returns null
  assert.equal(getGCodeHover(VALID_PROGRAM, { line: 999, character: 0 }), null);
});

test("G-code LSP getGCodeCompletions: returns unique ISO 6983 G/M code completions", () => {
  const items = getGCodeCompletions();
  assert.ok(items.length >= 25, `Expected >= 25 completions, got ${items.length}`);

  const labels = items.map((i) => i.label);
  assert.equal(new Set(labels).size, labels.length, "Completion labels must be unique");

  for (const expected of ["G00", "G01", "G02", "G03", "G17", "G21", "G90", "M03", "M30"]) {
    const item = items.find((i) => i.label === expected);
    assert.ok(item, `Expected completion item for ${expected}`);
    assert.ok(item.detail.length > 0);
    assert.ok(item.documentation.length > 0);
  }
});

test("G-code Indexing: recognizes G-code files and indexes program, subprograms, and tools", () => {
  assert.equal(gcodeIndexing.canIndex("part.nc", ""), true);
  assert.equal(gcodeIndexing.canIndex("part.gcode", ""), true);
  assert.equal(gcodeIndexing.canIndex("part.ngc", ""), true);
  assert.equal(gcodeIndexing.canIndex("unknown.txt", "O1000\nG01 X10 F100"), true);
  assert.equal(gcodeIndexing.canIndex("notes.txt", "plain text document"), false);

  const added: Array<{ name: string; kind: string; parentId: unknown }> = [];
  let parsedModel: unknown = null;
  let nextId = 1;

  const mockCtx = {
    uri: "file:///part.nc",
    text: VALID_PROGRAM,
    setParsedModel(model: unknown) {
      parsedModel = model;
    },
    addSymbol(name: string, kind: string, parentId: unknown) {
      added.push({ name, kind, parentId });
      return nextId++;
    },
  } as unknown as DslIndexFileContext;

  gcodeIndexing.indexFile(mockCtx);
  assert.ok(parsedModel !== null);
  assert.ok(added.some((s) => s.name === "O4001" && s.kind === "Package" && s.parentId === null));
  assert.ok(added.some((s) => s.name === "O4002" && s.kind === "Function" && s.parentId === 1));
  assert.ok(added.some((s) => s.name === "T1" && s.kind === "Variable" && s.parentId === 1));
  assert.ok(added.some((s) => s.name === "T2" && s.kind === "Variable" && s.parentId === 1));
});
