// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildSemanticTagTable, SemanticCstTag, type TaggableCstNode } from "@modelscript/dsl";
import assert from "node:assert";
import { describe, it } from "node:test";
import {
  extractBreakpointLinesByTags,
  extractDocumentSymbolsByTags,
  extractFoldingRangesByTags,
} from "../src/providers/semantic-tag-provider.js";

describe("Semantic Tag Generic LSP Provider (Workstream B)", () => {
  it("extracts DocumentSymbols, FoldingRanges, and DAP breakpoint lines purely from CST tags", () => {
    const table = buildSemanticTagTable([
      "stored_definition",
      "class_definition",
      "port_usage",
      "parameter_decl",
      "equation_section",
      "simple_equation",
      "line_comment",
    ]);

    const fakeCst: TaggableCstNode = {
      type: "stored_definition",
      kindId: 0,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 12, column: 0 },
      namedChildren: [
        {
          type: "class_definition",
          kindId: 1,
          text: "model RC",
          startPosition: { row: 1, column: 0 },
          endPosition: { row: 10, column: 6 },
          childForFieldName: (f) => (f === "name" ? { type: "ident", text: "RC" } : null),
          namedChildren: [
            {
              type: "port_usage",
              kindId: 2,
              text: "Pin p",
              startPosition: { row: 2, column: 2 },
              endPosition: { row: 2, column: 7 },
              childForFieldName: (f) => (f === "name" ? { type: "ident", text: "p" } : null),
            },
            {
              type: "parameter_decl",
              kindId: 3,
              text: "parameter Real R = 100",
              startPosition: { row: 3, column: 2 },
              endPosition: { row: 3, column: 24 },
              childForFieldName: (f) => (f === "name" ? { type: "ident", text: "R" } : null),
            },
            {
              type: "equation_section",
              kindId: 4,
              startPosition: { row: 5, column: 0 },
              endPosition: { row: 9, column: 0 },
              namedChildren: [
                {
                  type: "simple_equation",
                  kindId: 5,
                  text: "v = R * i",
                  startPosition: { row: 6, column: 2 },
                  endPosition: { row: 6, column: 11 },
                },
                {
                  type: "simple_equation",
                  kindId: 5,
                  text: "der(v) = -v / (R * C)",
                  startPosition: { row: 7, column: 2 },
                  endPosition: { row: 7, column: 23 },
                },
              ],
            },
          ],
        },
      ],
    };

    const symbols = extractDocumentSymbolsByTags(fakeCst, table);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]?.name, "RC");
    assert.strictEqual(symbols[0]?.children?.length, 2);
    assert.deepStrictEqual(
      symbols[0]?.children?.map((c) => c.name),
      ["p", "R"],
    );

    const folds = extractFoldingRangesByTags(fakeCst, table);
    assert.strictEqual(folds.length, 2); // class_definition + equation_section
    assert.strictEqual(folds[0]?.startLine, 1);
    assert.strictEqual(folds[0]?.endLine, 10);
    assert.strictEqual(folds[1]?.startLine, 5);
    assert.strictEqual(folds[1]?.endLine, 9);

    const breakpoints = extractBreakpointLinesByTags(fakeCst, table);
    assert.deepStrictEqual(breakpoints, [6, 7]);
    assert.ok((table.byKindId[5]! & SemanticCstTag.Equation) !== 0);
  });

  it("projects cross-language PolyglotDiagnostic traces into ThreadDiagnostic.relatedInformation (Workstream F)", async () => {
    const { ThreadDiagnosticsProvider } = await import("../src/providers/threadDiagnosticsProvider.js");
    const diags = ThreadDiagnosticsProvider.diagnoseThread(
      9001,
      [
        { domain: "reqif", name: "REQ_THERMAL", uri: "file:///reqs/thermal.reqif", line: 4, column: 2 },
        { domain: "sysml2", name: "BatteryPack", uri: "file:///arch/battery.sysml", line: 12, column: 5 },
        { domain: "modelica", name: "ThermalCell", uri: "file:///sim/cell.mo", line: 28, column: 3 },
      ],
      0.05,
      { explanation: "Cell temperature exceeds REQ_THERMAL limit", culpritEntities: ["BatteryPack"] },
    );

    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0]?.code, "THREAD_THEORY_CONFLICT");
    assert.strictEqual(diags[0]?.relatedInformation?.length, 3);
    assert.ok(diags[0]?.relatedInformation?.some((r) => r.location.uri === "file:///reqs/thermal.reqif"));
    assert.ok(diags[0]?.relatedInformation?.some((r) => r.location.uri === "file:///sim/cell.mo"));

    const fromRuntime = ThreadDiagnosticsProvider.fromPolyglotDiagnostic({
      code: "MS_BLT_SINGULAR",
      severity: "error",
      summary: "Singular equation block across Modelica + SPICE",
      frames: [
        {
          domainId: 1,
          languageId: "modelica",
          symbolId: 0x01000001,
          symbolName: "Circuit",
          uri: "file:///sim/circuit.mo",
          range: { startOffset: 10, endOffset: 30 },
          role: "inlined_dae",
          message: "Host circuit",
          threadId: 9001,
        },
        {
          domainId: 0x20,
          languageId: "spice",
          symbolId: 0x20000002,
          symbolName: "R1",
          uri: "file:///sim/r1.cir",
          range: { startOffset: 0, endOffset: 12 },
          role: "propagated_via_tgg",
          message: "Inlined SPICE resistor",
          threadId: 9001,
        },
      ],
    });

    assert.ok(fromRuntime);
    assert.strictEqual(fromRuntime.domain, "modelica");
    assert.strictEqual(fromRuntime.relatedInformation?.length, 2);
    assert.strictEqual(fromRuntime.relatedInformation?.[1]?.location.uri, "file:///sim/r1.cir");
  });
});
