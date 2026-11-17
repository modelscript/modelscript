// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  applyPasteBlock,
  deleteGridColumn,
  deleteGridRow,
  insertGridColumn,
  insertGridRow,
  normalizeGridRange,
  parseTabularGrid,
  serializeGridToCsv,
  serializeRangeToTsv,
  updateGridCell,
} from "../src/components/artifacts/tabular-grid-utils.js";

describe("Tabular Grid Parser & Editor Helpers", () => {
  it("parses CSV with leading comments and preserves line numbers", () => {
    const csv = `# Sensor sweep\ntime,voltage,current\n0.0,0.0,0.0\n0.1,3.3,0.12\n`;
    const parsed = parseTabularGrid(csv, { dialect: "csv" });

    assert.equal(parsed.format, "csv");
    assert.equal(parsed.delimiter, ",");
    assert.equal(parsed.editable, true);
    assert.deepEqual(parsed.leadingComments, ["# Sensor sweep"]);
    assert.deepEqual(parsed.headers, ["time", "voltage", "current"]);
    assert.deepEqual(parsed.rows, [
      ["0.0", "0.0", "0.0"],
      ["0.1", "3.3", "0.12"],
    ]);
    assert.deepEqual(parsed.rowLineNumbers, [3, 4]);
  });

  it("auto-detects TSV and semicolon delimiters", () => {
    const tsv = "a\tb\tc\n1\t2\t3\n";
    const parsedTsv = parseTabularGrid(tsv, { format: "tsv" });
    assert.equal(parsedTsv.format, "tsv");
    assert.equal(parsedTsv.delimiter, "\t");
    assert.deepEqual(parsedTsv.headers, ["a", "b", "c"]);
    assert.deepEqual(parsedTsv.rows, [["1", "2", "3"]]);

    const semi = "x;y\n10;20\n";
    const parsedSemi = parseTabularGrid(semi, { dialect: "csv" });
    assert.equal(parsedSemi.delimiter, ";");
    assert.deepEqual(parsedSemi.headers, ["x", "y"]);
    assert.deepEqual(parsedSemi.rows, [["10", "20"]]);
  });

  it("parses PDB, Touchstone, SMILES, and multi-table JSON into read-only grids", () => {
    const pdb = [
      "HEADER    PEPTIDE",
      "ATOM      1  N   ALA A   1      11.104   6.134  -6.504  1.00 12.40           N",
      "ATOM      2  CA  ALA A   1      11.639   6.071  -5.147  1.00 11.80           C",
    ].join("\n");
    const parsedPdb = parseTabularGrid(pdb, { dialect: "pdb" });
    assert.equal(parsedPdb.editable, false);
    assert.equal(parsedPdb.rows.length, 2);
    assert.equal(parsedPdb.rows[0]?.[2], "N");
    assert.equal(parsedPdb.rows[1]?.[3], "ALA");
    assert.deepEqual(parsedPdb.rowLineNumbers, [2, 3]);

    const s2p = "! Filter\n# GHz S MA R 50\n1.00 0.88 -35.0 0.45 55.0\n";
    const parsedS2p = parseTabularGrid(s2p, { dialect: "touchstone" });
    assert.equal(parsedS2p.editable, false);
    assert.equal(parsedS2p.headers[0], "Freq (GHz)");
    assert.deepEqual(parsedS2p.rows[0], ["1.00", "0.88", "-35.0", "0.45", "55.0"]);

    const smi = "# SMILES\tID\tMW\nCCO\tEthanol\t46.07\n";
    const parsedSmi = parseTabularGrid(smi, { dialect: "smiles" });
    assert.equal(parsedSmi.editable, false);
    assert.deepEqual(parsedSmi.headers, ["SMILES", "ID", "MW"]);
    assert.deepEqual(parsedSmi.rows, [["CCO", "Ethanol", "46.07"]]);

    const json = JSON.stringify({
      nodes: [{ id: "N1", v: 1.0 }],
      branches: [{ from: "N1", to: "N2" }],
    });
    const parsedJson = parseTabularGrid(json, { dialect: "json" });
    assert.equal(parsedJson.editable, false);
    assert.equal(parsedJson.tables?.length, 2);
  });

  it("supports cell, row, and column edits and round-trips to CSV/TSV", () => {
    let headers = ["time", "voltage"];
    let rows = [
      ["0.0", "0.0"],
      ["0.1", "3.3"],
    ];

    ({ headers, rows } = updateGridCell(headers, rows, 1, 1, "3.35"));
    assert.equal(rows[1]?.[1], "3.35");

    ({ headers, rows } = updateGridCell(headers, rows, -1, 1, "voltage_V"));
    assert.equal(headers[1], "voltage_V");

    rows = insertGridRow(headers, rows, 0);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[1], ["", ""]);

    rows = deleteGridRow(rows, 1);
    assert.equal(rows.length, 2);

    ({ headers, rows } = insertGridColumn(headers, rows, 1, "current"));
    assert.deepEqual(headers, ["time", "voltage_V", "current"]);
    assert.deepEqual(rows[0], ["0.0", "0.0", ""]);

    ({ headers, rows } = deleteGridColumn(headers, rows, 2));
    assert.deepEqual(headers, ["time", "voltage_V"]);

    const serialized = serializeGridToCsv(headers, rows, "\t", ["# comment"]);
    assert.equal(serialized, "# comment\ntime\tvoltage_V\n0.0\t0.0\n0.1\t3.35\n");
  });

  it("parses LAS well-log files and supports range copy/paste expansion", () => {
    const las = [
      "~CURVE INFORMATION",
      "DEPT.M     : Depth",
      "GR.GAPI    : Gamma Ray",
      "~ASCII",
      "1000.0  45.2",
      "1000.5  48.7",
    ].join("\n");
    const parsedLas = parseTabularGrid(las, { dialect: "las" });
    assert.equal(parsedLas.format, "las");
    assert.equal(parsedLas.editable, false);
    assert.deepEqual(parsedLas.headers, ["DEPT [M]", "GR [GAPI]"]);
    assert.deepEqual(parsedLas.rows, [
      ["1000.0", "45.2"],
      ["1000.5", "48.7"],
    ]);
    assert.deepEqual(parsedLas.rowLineNumbers, [5, 6]);

    const range = normalizeGridRange({ row: 1, col: 1 }, { row: 0, col: 0 });
    assert.equal(serializeRangeToTsv(parsedLas.rows, range), "1000.0\t45.2\n1000.5\t48.7");

    const pasted = applyPasteBlock(["a", "b"], [["1", "2"]], 0, 1, "10\t20\n30\t40");
    assert.deepEqual(pasted.headers, ["a", "b", "col_3"]);
    assert.deepEqual(pasted.rows, [
      ["1", "10", "20"],
      ["", "30", "40"],
    ]);
  });

  it("wires CsvViewer into PolyglotDomainPanel, inspectors, and labels CSV tab as Table", () => {
    const panelPath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/PolyglotDomainPanel.tsx");
    const powerPath = path.resolve(
      import.meta.dirname,
      "../src/components/morsel/panels/inspectors/PowerGridInspector.tsx",
    );
    const biochemPath = path.resolve(
      import.meta.dirname,
      "../src/components/morsel/panels/inspectors/BiochemInspector.tsx",
    );
    const subHeaderPath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselViewSubHeader.tsx");
    const navbarPath = path.resolve(import.meta.dirname, "../src/pages/playground/components/PlaygroundNavbar.tsx");

    const panelSrc = fs.readFileSync(panelPath, "utf-8");
    assert.ok(panelSrc.includes("CsvViewer"), "PolyglotDomainPanel should import CsvViewer");
    assert.ok(panelSrc.includes('d === "csv"'), "PolyglotDomainPanel should route csv dialect to CsvViewer");
    assert.ok(panelSrc.includes('d === "pdb"'), "PolyglotDomainPanel should route pdb dialect to CsvViewer");
    assert.ok(panelSrc.includes('d === "las"'), "PolyglotDomainPanel should route las dialect to CsvViewer");

    const powerSrc = fs.readFileSync(powerPath, "utf-8");
    assert.ok(powerSrc.includes("S-Parameter Grid"), "PowerGridInspector should expose Touchstone S-Parameter Grid");

    const biochemSrc = fs.readFileSync(biochemPath, "utf-8");
    assert.ok(biochemSrc.includes("Compound Table"), "BiochemInspector should expose SMILES Compound Table");

    const subHeaderSrc = fs.readFileSync(subHeaderPath, "utf-8");
    assert.ok(subHeaderSrc.includes('"Table"'), "MorselViewSubHeader should label csv tab as Table");

    const navbarSrc = fs.readFileSync(navbarPath, "utf-8");
    assert.ok(navbarSrc.includes('"Table"'), "PlaygroundNavbar should label csv tab as Table");
  });
});
