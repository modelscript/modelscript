// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTabularMutation,
  compileTabularConfig,
  completeTabularCell,
  executeTabularSheet,
  exportTabularSheetToCsv,
  exportTabularSheetToTsv,
  language,
  validateTabularCell,
  type TabularConfig,
} from "../src/index.js";

describe("Bidirectional Tabular View & Spreadsheet Editor DSL (@modelscript/dsl)", () => {
  const sampleTabularConfig: TabularConfig = {
    defaultSheet: "items",
    enableSearch: true,
    enableDenseMode: true,
    sheets: {
      items: {
        id: "items",
        label: "Engineering Items",
        kind: "tree",
        columns: [
          {
            id: "id",
            header: "ID",
            type: "string",
            editable: false,
            pinned: "left",
          },
          {
            id: "name",
            header: "Name",
            type: "string",
            editable: true,
          },
          {
            id: "severity",
            header: "Severity",
            type: "enum",
            editable: true,
            options: ["Low", "Medium", "High", "Critical"],
          },
          {
            id: "limit",
            header: "Limit",
            type: "number",
            editable: true,
            unit: "ms",
          },
        ],
        dynamicColumns: (docText) => {
          if (docText.includes("custom_owner")) {
            return [
              {
                id: "owner",
                header: "Owner",
                type: "string",
                editable: true,
              },
            ];
          }
          return [];
        },
        extractRows: (docText) => {
          return docText
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [id = "", name = "", severity = "Low", limit = "10"] = line.split("|");
              return {
                id,
                cells: {
                  id,
                  name,
                  severity,
                  limit: Number(limit),
                },
              };
            });
        },
        mutations: {
          updateCell: (docText, rowId, colId, newVal) => {
            const lines = docText.trim().split("\n");
            const updated = lines.map((line) => {
              const parts = line.split("|");
              if (parts[0] !== rowId) return line;
              if (colId === "name") parts[1] = String(newVal);
              if (colId === "severity") parts[2] = String(newVal);
              if (colId === "limit") parts[3] = String(newVal);
              return parts.join("|");
            });
            const newText = updated.join("\n");
            return {
              success: true,
              edits: [{ startOffset: 0, endOffset: docText.length, newText }],
              newText,
              affectedRowId: rowId,
            };
          },
          insertRow: (docText, options) => {
            const id = String(options.initialCells?.id ?? "ITEM-NEW");
            const appended = `${docText.trim()}\n${id}|New Item|Medium|25`;
            return {
              success: true,
              edits: [{ startOffset: 0, endOffset: docText.length, newText: appended }],
              newText: appended,
              affectedRowId: id,
            };
          },
          deleteRow: (docText, rowId) => {
            const kept = docText
              .trim()
              .split("\n")
              .filter((l) => !l.startsWith(`${rowId}|`))
              .join("\n");
            return {
              success: true,
              edits: [{ startOffset: 0, endOffset: docText.length, newText: kept }],
              newText: kept,
              affectedRowId: rowId,
            };
          },
        },
        kpis: [
          {
            id: "criticalCount",
            label: "Critical Items",
            compute: (rows) => ({
              value: rows.filter((r) => r.cells.severity === "Critical").length,
              status: "warn",
            }),
            filterPredicate: (row) => row.cells.severity === "Critical",
          },
        ],
      },
    },
  };

  it("registers tabular configuration on language() definitions and compiles descriptors", () => {
    const testLang = language({
      name: "test-tabular-lang",
      tabular: sampleTabularConfig,
      rules: {
        Root: () => "root",
      },
    });

    assert.ok(testLang.tabular);
    const compiled = compileTabularConfig(testLang.tabular);
    assert.ok(compiled);
    assert.equal(compiled.defaultSheet, "items");
    assert.deepEqual(compiled.sheetIds, ["items"]);
    assert.equal(compiled.capabilities.enableSearch, true);
  });

  it("executes sheets, discovers dynamic columns, and computes KPIs", () => {
    const doc = "ITM-1|Brake Controller|Critical|5\nITM-2|Steering Sensor|High|12\n# custom_owner";
    const payload = executeTabularSheet(sampleTabularConfig, doc, "items");

    assert.equal(payload.sheetId, "items");
    assert.equal(payload.sheetKind, "tree");
    assert.equal(payload.rows.length, 3);
    assert.ok(payload.columns.some((c) => c.id === "owner" && c.isDynamic));
    assert.equal(payload.kpis.length, 1);
    assert.equal(payload.kpis[0]!.value, 1);
    assert.equal(payload.kpis[0]!.hasFilter, true);
  });

  it("validates cells, computes completions, and applies bidirectional mutations", () => {
    const doc = "ITM-1|Brake Controller|Critical|5\nITM-2|Steering Sensor|High|12";

    const invalidEnum = validateTabularCell(sampleTabularConfig, doc, "items", "ITM-1", "severity", "UnknownLevel");
    assert.equal(invalidEnum.valid, false);

    const invalidNum = validateTabularCell(sampleTabularConfig, doc, "items", "ITM-1", "limit", "not-a-number");
    assert.equal(invalidNum.valid, false);

    const completions = completeTabularCell(sampleTabularConfig, doc, "items", "ITM-1", "severity", "Cri");
    assert.equal(completions.length, 1);
    assert.equal(completions[0]!.label, "Critical");

    const updated = applyTabularMutation(sampleTabularConfig, doc, {
      kind: "updateCell",
      sheetId: "items",
      rowId: "ITM-1",
      columnId: "limit",
      value: 2.5,
    });
    assert.equal(updated.success, true);
    assert.ok(updated.newText.includes("ITM-1|Brake Controller|Critical|2.5"));

    const inserted = applyTabularMutation(sampleTabularConfig, updated.newText, {
      kind: "insertRow",
      sheetId: "items",
      initialCells: { id: "ITM-3" },
    });
    assert.equal(inserted.success, true);
    assert.ok(inserted.newText.includes("ITM-3|New Item|Medium|25"));

    const deleted = applyTabularMutation(sampleTabularConfig, inserted.newText, {
      kind: "deleteRow",
      sheetId: "items",
      rowId: "ITM-2",
    });
    assert.equal(deleted.success, true);
    assert.ok(!deleted.newText.includes("ITM-2|"));
  });

  it("exports tabular sheets to RFC 4180 CSV and clipboard TSV", () => {
    const doc = "ITM-1|Brake, Primary|Critical|5\nITM-2|Steering|High|12";
    const payload = executeTabularSheet(sampleTabularConfig, doc, "items");
    const csv = exportTabularSheetToCsv(payload);
    const tsv = exportTabularSheetToTsv(payload);

    assert.ok(csv.includes('"Brake, Primary"'));
    assert.ok(tsv.includes("ITM-1\tBrake, Primary\tCritical\t5"));
  });
});
