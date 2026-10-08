// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsvMeasurements, parseCsvToModelica } from "../src/csv-parser.js";

describe("languages/csv: parseCsvMeasurements", () => {
  it("should parse standard comma-delimited time-series data", () => {
    const csvContent = `time,temp,pressure\n0.0,20.5,1013.25\n1.0,21.0,1012.80\n2.0,21.5,1012.40`;
    const result = parseCsvMeasurements(csvContent);

    assert.deepEqual(result.columns, ["temp", "pressure"]);
    assert.deepEqual(result.time, [0.0, 1.0, 2.0]);
    assert.deepEqual(result.data.get("temp"), [20.5, 21.0, 21.5]);
    assert.deepEqual(result.data.get("pressure"), [1013.25, 1012.8, 1012.4]);
  });

  it("should support custom delimiters and column mapping", () => {
    const csvContent = `t;sensor_1\n0;100\n5;150`;
    const mapping = new Map([["sensor_1", "motor.temperature"]]);
    const result = parseCsvMeasurements(csvContent, { columnMapping: mapping });

    assert.deepEqual(result.time, [0, 5]);
    assert.ok(result.data.has("motor.temperature"));
    assert.deepEqual(result.data.get("motor.temperature"), [100, 150]);
  });

  it("should support tab delimiter, case-insensitive time column, and CRLF endings", () => {
    const csvContent = "Time\tSpeed\tVoltage\r\n0.0\t10.5\t220.0\r\n1.0\t12.0\t221.5\r\n";
    const result = parseCsvMeasurements(csvContent);

    assert.deepEqual(result.columns, ["Speed", "Voltage"]);
    assert.deepEqual(result.time, [0.0, 1.0]);
    assert.deepEqual(result.data.get("Speed"), [10.5, 12.0]);
    assert.deepEqual(result.data.get("Voltage"), [220.0, 221.5]);
  });

  it("should parse quoted fields with escaped quotes and embedded commas", () => {
    const csvContent = `time,"measured, \\"temp\\"",rpm\n0.0,25.4,3000\n1.0,26.1,3100`;
    const result = parseCsvMeasurements(csvContent);

    assert.deepEqual(result.time, [0.0, 1.0]);
    assert.ok(result.columns.some((c) => c.includes("temp")));
  });

  it("should skip NaN rows when skipNaN is enabled", () => {
    const csvContent = `t,val\n0,10\n1,NaN\n2,20\n3,invalid\n4,30`;
    const result = parseCsvMeasurements(csvContent, { skipNaN: true });

    assert.deepEqual(result.time, [0, 2, 4]);
    assert.deepEqual(result.data.get("val"), [10, 20, 30]);
  });

  it("should pad short rows with NaN and handle blank lines", () => {
    const csvContent = `time,a,b\n\n0,1,2\n\n1,3\n\n`;
    const result = parseCsvMeasurements(csvContent, { skipNaN: true });

    assert.deepEqual(result.time, [0]);
    assert.deepEqual(result.data.get("a"), [1]);
    assert.deepEqual(result.data.get("b"), [2]);
  });

  it("should throw error on missing header or empty rows", () => {
    assert.throws(() => parseCsvMeasurements("time"), /at least a header row/);
    assert.throws(() => parseCsvMeasurements(""), /at least a header row/);
  });

  it("should throw error when no time column can be found", () => {
    assert.throws(() => parseCsvMeasurements("varA,varB\n1,2"), /Could not find a time column/);
  });

  it("should throw error when specified time column does not exist", () => {
    assert.throws(
      () => parseCsvMeasurements("time,val\n0,1", { timeColumn: "nonExistent" }),
      /Time column "nonExistent" not found/,
    );
  });

  it("should throw error on invalid time value when skipNaN is false", () => {
    assert.throws(() => parseCsvMeasurements("time,val\nbad_time,10"), /Invalid time value at row 2/);
  });

  it("should throw error when no valid data rows exist", () => {
    assert.throws(() => parseCsvMeasurements("time,val\n"), /at least a header row and one data row/);
  });
});

describe("languages/csv: parseCsvToModelica", () => {
  it("should generate empty package if CSV contains fewer than 2 lines", () => {
    const mo = parseCsvToModelica("header_only\n", "EmptyPackage");
    assert.strictEqual(mo, "package EmptyPackage\nend EmptyPackage;");
  });

  it("should transcompile CSV table to Modelica constant 2D matrix and 1D arrays", () => {
    const csv = `time,flow_rate,temp-celsius\n0.0,1.5,20.0\n1.0,2.5,22.5\n2.0,3.0,25.0`;
    const mo = parseCsvToModelica(csv, "PumpCalibrationData");

    assert.ok(mo.includes("package PumpCalibrationData"));
    assert.ok(mo.includes("constant Integer numRows = 3;"));
    assert.ok(mo.includes("constant Integer numCols = 3;"));
    assert.ok(mo.includes("constant Real values[3, 3] = {"));
    assert.ok(mo.includes("{0, 1.5, 20}"));
    assert.ok(mo.includes("constant Real time[3] = {0, 1, 2};"));
    assert.ok(mo.includes("constant Real flow_rate[3] = {1.5, 2.5, 3};"));
    assert.ok(mo.includes("constant Real temp_celsius[3] = {20, 22.5, 25};"));
    assert.ok(mo.includes("end PumpCalibrationData;"));
  });

  it("should support semicolon and tab delimited formats in parseCsvToModelica", () => {
    const semiCsv = `t;speed\n0;100\n1;200`;
    const moSemi = parseCsvToModelica(semiCsv, "SemiPkg");
    assert.ok(moSemi.includes("package SemiPkg"));
    assert.ok(moSemi.includes("constant Real speed[2] = {100, 200};"));

    const tabCsv = `t\tspeed\n0\t100\n1\t200`;
    const moTab = parseCsvToModelica(tabCsv, "TabPkg");
    assert.ok(moTab.includes("package TabPkg"));
    assert.ok(moTab.includes("constant Real speed[2] = {100, 200};"));
  });
});
