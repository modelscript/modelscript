// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createHomologationReport,
  exportHomologationCtrf,
  exportHomologationHtml,
  exportHomologationJunit,
  exportHomologationSarif,
} from "../src/index.js";

describe("Railway Safety & Homologation Reporting Engine", () => {
  it("should generate a passing homologation report for compliant vehicle", () => {
    const report = createHomologationReport({
      modelName: "PassengerCoach_X2000",
      vehicleType: "High-Speed Coach",
      maxNadalYOverQ: 0.65, // Limit 0.80 -> Pass
      maxLateralForceYKn: 45.0, // Limit 10 + 2*100/3 = 76.67 kN -> Pass
      nominalAxleLoadQ0Kn: 200.0,
      sperlingVerticalWz: 2.3, // Limit 3.0 -> Pass
      sperlingHorizontalWz: 2.4, // Limit 3.0 -> Pass
      crossWindUnloadingRatio: 0.72, // Limit 0.90 -> Pass
      equivalentConicity: 0.18, // Limit 0.40 -> Pass
    });

    assert.equal(report.summary.passed, true);
    assert.equal(report.summary.checksFailed, 0);
    assert.ok(report.summary.checksPassed >= 6);
    assert.equal(report.checks.length, 6);
  });

  it("should flag failures when criteria exceed standard thresholds", () => {
    const report = createHomologationReport({
      modelName: "UnstableFreightWagon",
      vehicleType: "Freight Wagon",
      maxNadalYOverQ: 0.95, // Limit 0.80 -> FAIL!
      maxLateralForceYKn: 90.0, // Limit 10 + 2*100/3 = 76.67 kN -> FAIL!
      nominalAxleLoadQ0Kn: 200.0,
      crossWindUnloadingRatio: 0.94, // Limit 0.90 -> FAIL!
      sperlingVerticalWz: 3.2, // Limit 3.0 -> FAIL!
    });

    assert.equal(report.summary.passed, false);
    assert.ok(report.summary.checksFailed >= 4);

    const yqCheck = report.checks.find((c) => c.id === "EN14363-DERAILMENT-YQ");
    assert.ok(yqCheck);
    assert.equal(yqCheck.status, "FAIL");
    assert.ok(yqCheck.recommendation !== undefined);

    const windCheck = report.checks.find((c) => c.id === "EN14067-WHEEL-UNLOADING");
    assert.ok(windCheck);
    assert.equal(windCheck.status, "FAIL");
  });

  it("should export report to SARIF 2.1.0 format", () => {
    const report = createHomologationReport({
      modelName: "TestVehicle",
      maxNadalYOverQ: 0.92, // Fail
      maxLateralForceYKn: 50.0,
      nominalAxleLoadQ0Kn: 200.0,
    });

    const sarifJson = exportHomologationSarif(report);
    const parsed = JSON.parse(sarifJson);

    assert.equal(parsed.version, "2.1.0");
    assert.ok(parsed.runs.length > 0);
    const run = parsed.runs[0];
    assert.ok(run.tool.driver.rules.length > 0);
    assert.ok(run.results.length > 0);
    assert.equal(run.results[0].ruleId, "EN14363-DERAILMENT-YQ");
    assert.equal(run.results[0].level, "error");
  });

  it("should export report to JUnit XML format", () => {
    const report = createHomologationReport({
      modelName: "TestVehicle",
      maxNadalYOverQ: 0.95, // Fail (> 0.90)
      maxLateralForceYKn: 50.0,
      nominalAxleLoadQ0Kn: 200.0,
    });

    const junitXml = exportHomologationJunit(report);

    assert.ok(junitXml.includes('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(junitXml.includes('<testsuites name="Railway Homologation"'));
    assert.ok(junitXml.includes('<testsuite name="TestVehicle"'));
    assert.ok(junitXml.includes("<failure message="));
  });

  it("should export report to CTRF JSON format", () => {
    const report = createHomologationReport({
      modelName: "TestVehicle",
      maxNadalYOverQ: 0.7,
      maxLateralForceYKn: 40.0,
      nominalAxleLoadQ0Kn: 200.0,
    });

    const ctrfJson = exportHomologationCtrf(report);
    const parsed = JSON.parse(ctrfJson);

    assert.equal(parsed.results.tool.name, "ModelScript Railway Homologation Engine");
    assert.equal(parsed.results.summary.tests, 2);
    assert.equal(parsed.results.summary.passed, 2);
    assert.equal(parsed.results.summary.failed, 0);
  });

  it("should export interactive HTML report with modern dark theme and badges", () => {
    const report = createHomologationReport({
      modelName: "PassengerCoach_HTML",
      vehicleType: "Passenger Coach",
      maxNadalYOverQ: 0.62,
      maxLateralForceYKn: 38.0,
      nominalAxleLoadQ0Kn: 200.0,
      sperlingVerticalWz: 2.1,
      crossWindUnloadingRatio: 0.65,
    });

    const html = exportHomologationHtml(report);

    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("PassengerCoach_HTML"));
    assert.ok(html.includes("PASSED"));
    assert.ok(html.includes("#10b981")); // Green status badge
    assert.ok(html.includes("EN 14363"));
    assert.ok(html.includes("EN 14067-6"));
  });
});
