// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { registerMiscEndpoints } from "../src/handlers/miscEndpoints.js";

test("LSP Endpoint: modelscript/generateMultibodyReport", async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const mockConnection: any = {
    onRequest: (method: string, handler: (...args: any[]) => any) => {
      handlers.set(method, handler);
    },
    onNotification: () => {},
    console: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  const mockContext: any = {
    connection: mockConnection,
    parserService: {
      getParser: () => undefined,
    },
    workspaceManager: {
      hypergraph: {
        recordTheorySat: () => {},
        getDomainNode: () => undefined,
      },
      threadMetadataMap: new Map(),
    },
  };

  registerMiscEndpoints(mockContext);

  const handler = handlers.get("modelscript/generateMultibodyReport");
  assert.ok(handler, "modelscript/generateMultibodyReport must be registered");

  // 1. Generate HTML report for compliant train
  const htmlRes = await handler({
    uri: "file:///trains/HighSpeed_EMU.ins",
    format: "html",
    maxNadalYOverQ: 0.65,
    maxLateralForceYKn: 40.0,
    nominalAxleLoadQ0Kn: 180.0,
    sperlingVerticalWz: 2.1,
    sperlingHorizontalWz: 2.2,
    crossWindUnloadingRatio: 0.7,
    equivalentConicity: 0.15,
  });

  assert.equal(htmlRes.format, "html");
  assert.equal(htmlRes.report.modelName, "HighSpeed_EMU");
  assert.equal(htmlRes.report.summary.passed, true);
  assert.ok(htmlRes.content.includes("<!DOCTYPE html>"));
  assert.ok(htmlRes.content.includes("HighSpeed_EMU"));
  assert.ok(htmlRes.content.includes("PASSED"));

  // 2. Generate SARIF report for failing vehicle
  const sarifRes = await handler({
    uri: "file:///trains/FailingWagon.ins",
    format: "sarif",
    maxNadalYOverQ: 0.96, // Fail!
    maxLateralForceYKn: 95.0, // Fail!
    nominalAxleLoadQ0Kn: 180.0,
  });

  assert.equal(sarifRes.format, "sarif");
  assert.equal(sarifRes.report.summary.passed, false);
  const sarifObj = JSON.parse(sarifRes.content);
  assert.equal(sarifObj.version, "2.1.0");
  assert.ok(sarifObj.runs[0].results.length >= 2);

  // 3. Generate JUnit XML report
  const junitRes = await handler({
    uri: "file:///trains/TestCoach.calc",
    format: "junit",
  });
  assert.equal(junitRes.format, "junit");
  assert.ok(junitRes.content.includes('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(junitRes.content.includes('<testsuites name="Railway Homologation"'));
});
