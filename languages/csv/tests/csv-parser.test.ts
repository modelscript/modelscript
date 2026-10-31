// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bsearchTimeInterval,
  interpolateCsvColumn,
  interpolateCsvTimeTable,
  lintCsv,
  parseCsvHeaderAnnotation,
  parseCsvMeasurements,
  parseCsvToModelica,
  toColumnarTimeTable,
} from "../src/csv-parser.js";
import { csvVirtualComponentQueries } from "../src/language.js";

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

  it("should parse header unit and scalar type annotations (omega [rad/s], temp (K), flag : Boolean)", () => {
    const h1 = parseCsvHeaderAnnotation("omega [rad/s]");
    assert.equal(h1.name, "omega");
    assert.equal(h1.unit, "rad/s");

    const h2 = parseCsvHeaderAnnotation("temp (K)");
    assert.equal(h2.name, "temp");
    assert.equal(h2.unit, "K");

    const h3 = parseCsvHeaderAnnotation("flag : Boolean");
    assert.equal(h3.name, "flag");
    assert.equal(h3.declaredType, "Boolean");

    const csv = [
      "time [s],omega [rad/s],temp (K),flag : Boolean,step : Integer",
      "0.0,10.5,293.15,true,1",
      "1.0,20.0,300.00,false,2",
    ].join("\n");
    const parsed = parseCsvMeasurements(csv);

    assert.deepEqual(parsed.columns, ["omega", "temp", "flag", "step"]);
    assert.equal(parsed.units.get("time"), "s");
    assert.equal(parsed.units.get("omega"), "rad/s");
    assert.equal(parsed.units.get("temp"), "K");
    assert.equal(parsed.columnTypes.get("omega"), "Real");
    assert.equal(parsed.columnTypes.get("temp"), "Real");
    assert.equal(parsed.columnTypes.get("flag"), "Boolean");
    assert.equal(parsed.columnTypes.get("step"), "Integer");
    assert.deepEqual(parsed.data.get("flag"), [1, 0]);
    assert.ok(parsed.timeBuffer instanceof Float64Array);
    assert.ok(parsed.columnar.get("omega") instanceof Float64Array);

    // Verify CSVVirtualComponent queries resolve unit and varType from header annotations
    assert.equal(csvVirtualComponentQueries.unit({} as any, { name: "omega [rad/s]" } as any), "rad/s");
    assert.equal(csvVirtualComponentQueries.unit({} as any, { name: "temp (K)" } as any), "K");
    assert.equal(csvVirtualComponentQueries.varType({} as any, { name: "flag : Boolean" } as any), "Boolean");
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

describe("languages/csv: lintCsv semantic linter & narrow ranges", () => {
  it("reports zero diagnostics on valid telemetry CSV", () => {
    const csv = `time,temp,pressure\n0.0,20.5,1013.25\n1.0,21.0,1012.80`;
    assert.strictEqual(lintCsv(csv).length, 0);
  });

  it("underlines only duplicate header cells, excess row cells, invalid numeric cells, and non-monotonic time cells", () => {
    const csv = `time,temp,temp\n0.0,20.5,20.5\n1.0,bad_num,21.0,extra_col\n0.5,22.0,22.0`;
    const diags = lintCsv(csv);

    const dupHeader = diags.find((d) => d.code === "CSV_DUPLICATE_HEADER");
    assert.ok(dupHeader, "Expected CSV_DUPLICATE_HEADER");
    assert.strictEqual(csv.slice(dupHeader.startOffset, dupHeader.endOffset), "temp");
    assert.strictEqual(dupHeader.line, 1);
    assert.strictEqual(dupHeader.column, 11);

    const excessCol = diags.find((d) => d.code === "CSV_COLUMN_COUNT_MISMATCH");
    assert.ok(excessCol, "Expected CSV_COLUMN_COUNT_MISMATCH");
    assert.strictEqual(csv.slice(excessCol.startOffset, excessCol.endOffset), "extra_col");

    const badNum = diags.find((d) => d.code === "CSV_INVALID_NUMERIC_CELL");
    assert.ok(badNum, "Expected CSV_INVALID_NUMERIC_CELL");
    assert.strictEqual(csv.slice(badNum.startOffset, badNum.endOffset), "bad_num");

    const nonMonoTime = diags.find((d) => d.code === "CSV_NON_MONOTONIC_TIME");
    assert.ok(nonMonoTime, "Expected CSV_NON_MONOTONIC_TIME");
    assert.strictEqual(csv.slice(nonMonoTime.startOffset, nonMonoTime.endOffset), "0.5");
  });

  it("detects mixed delimiters within rows (CSV_MIXED_DELIMITER)", () => {
    const csv = ["time,omega,temp", "0.0,10.5,293.15", "1.0,12.0;300.0"].join("\n");
    const diags = lintCsv(csv);
    const mixed = diags.find((d) => d.code === "CSV_MIXED_DELIMITER");
    assert.ok(mixed, "Expected CSV_MIXED_DELIMITER diagnostic");
    assert.strictEqual(mixed.line, 3);
    assert.strictEqual(csv.slice(mixed.startOffset, mixed.endOffset), "12.0;300.0");
  });

  it("handles # comment lines and double-quote escaped quotes across parseCsvMeasurements and lintCsv", () => {
    const csvWithCommentsAndEscapes = [
      "# Telemetry export; sensor=T1",
      'time,"sensor ""alpha""\nunit",value',
      "# Mid-file comment line",
      "0.0,10.5,100.0",
      "1.0,11.0,200.0",
    ].join("\n");

    const parsed = parseCsvMeasurements(csvWithCommentsAndEscapes);
    assert.deepEqual(parsed.time, [0.0, 1.0]);
    assert.equal(parsed.columns.length, 2);
    assert.ok(parsed.columns[0]!.includes('sensor "alpha"'));
    assert.deepEqual(parsed.data.get("value"), [100.0, 200.0]);

    const diags = lintCsv(csvWithCommentsAndEscapes);
    assert.equal(diags.length, 0, `Expected 0 diagnostics on commented CSV, got: ${JSON.stringify(diags)}`);
  });
});

describe("languages/csv: columnar time-table interpolation (constant, linear, akima)", () => {
  it("performs O(log N) binary search and interpolates constant, linear, and Akima splines over Float64Array columns", () => {
    // y = t^2 for column "quad", step function for "step"
    const csv = [
      "time [s],quad [m],step",
      "0.0,0.0,10.0",
      "1.0,1.0,10.0",
      "2.0,4.0,10.0",
      "3.0,9.0,50.0",
      "4.0,16.0,50.0",
      "5.0,25.0,50.0",
    ].join("\n");

    const table = toColumnarTimeTable(csv);
    assert.ok(table.time instanceof Float64Array);
    assert.ok(table.data.get("quad") instanceof Float64Array);
    assert.equal(bsearchTimeInterval(table.time, 2.5), 2);

    // 1. Constant (zero-order hold) interpolation at t = 2.5 -> value at t = 2.0 is 4.0
    const constVals = interpolateCsvTimeTable(table, 2.5, "constant");
    assert.equal(constVals.quad, 4.0);
    assert.equal(constVals.step, 10.0);

    // 2. Linear interpolation at t = 2.5 -> 0.5 * (4.0 + 9.0) = 6.5
    const linVals = interpolateCsvTimeTable(table, 2.5, "linear");
    assert.ok(Math.abs(linVals.quad! - 6.5) < 1e-12);
    assert.ok(Math.abs(linVals.step! - 30.0) < 1e-12);

    // 3. Akima spline interpolation at t = 2.5 -> closer to true 2.5^2 = 6.25 than linear (6.5),
    // and zero overshoot on flat plateau [0, 2] for step column at t = 1.5
    const akimaVals = interpolateCsvTimeTable(table, 2.5, "akima");
    assert.ok(Math.abs(akimaVals.quad! - 6.25) < 0.05, `Expected Akima ~6.25, got ${akimaVals.quad}`);
    const akimaPlateau = interpolateCsvColumn(table.time, table.data.get("step")!, 1.5, "akima");
    assert.equal(akimaPlateau, 10.0, "Akima spline should have zero overshoot on flat segments");

    // 4. Boundary clamping
    assert.equal(interpolateCsvTimeTable(table, -5.0, "linear").quad, 0.0);
    assert.equal(interpolateCsvTimeTable(table, 99.0, "akima").quad, 25.0);
  });
});
