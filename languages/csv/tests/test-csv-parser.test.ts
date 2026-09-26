import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsvMeasurements } from "../src/csv-parser.js";

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
});
