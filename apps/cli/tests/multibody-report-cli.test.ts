// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { GensysCommand } from "../src/commands/gensys.js";
import { SimpackCommand } from "../src/commands/simpack.js";

test("CLI: Multibody Homologation Report Generation (msx gensys / simpack report)", async (t) => {
  const scratchDir = path.resolve("scratch_cli_reports");
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  t.after(() => {
    if (fs.existsSync(scratchDir)) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  const dummyGensys = path.join(scratchDir, "PassengerCoach.calc");
  fs.writeFileSync(dummyGensys, "body carbody 32000.0 65000.0 1800000.0 1700000.0 0.0 0.0 1.2\n", "utf-8");

  // 1. msx gensys report PassengerCoach.calc --format=html --out=report.html
  const htmlOut = path.join(scratchDir, "report.html");
  await (GensysCommand.handler as any)({
    action: "report",
    files: [dummyGensys],
    format: "html",
    out: htmlOut,
    "y-force": 20.0,
    "q-force": 80.0,
    "axle-load": 160.0,
  });

  assert.ok(fs.existsSync(htmlOut));
  const htmlContent = fs.readFileSync(htmlOut, "utf-8");
  assert.ok(htmlContent.includes("<!DOCTYPE html>"));
  assert.ok(htmlContent.includes("PassengerCoach"));
  assert.ok(htmlContent.includes("PASSED"));

  // 2. msx gensys report PassengerCoach.calc --format=sarif --out=report.sarif
  const sarifOut = path.join(scratchDir, "report.sarif");
  await (GensysCommand.handler as any)({
    action: "report",
    files: [dummyGensys],
    format: "sarif",
    out: sarifOut,
    "y-force": 75.0, // High force to fail Y/Q
    "q-force": 80.0,
    "axle-load": 160.0,
  });

  assert.ok(fs.existsSync(sarifOut));
  const sarifContent = JSON.parse(fs.readFileSync(sarifOut, "utf-8"));
  assert.equal(sarifContent.version, "2.1.0");

  // 3. msx gensys report PassengerCoach.calc --format=junit --out=report.xml
  const junitOut = path.join(scratchDir, "report.xml");
  await (GensysCommand.handler as any)({
    action: "report",
    files: [dummyGensys],
    format: "junit",
    out: junitOut,
  });

  assert.ok(fs.existsSync(junitOut));
  const junitContent = fs.readFileSync(junitOut, "utf-8");
  assert.ok(junitContent.includes('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(junitContent.includes('<testsuites name="Railway Homologation"'));

  // 4. msx simpack report model.spck --format=html
  const dummySpck = path.join(scratchDir, "Suspension.spck");
  fs.writeFileSync(dummySpck, '<simpack_model name="Suspension"></simpack_model>', "utf-8");
  const simpackHtmlOut = path.join(scratchDir, "simpack_report.html");

  await (SimpackCommand.handler as any)({
    action: "report",
    files: [dummySpck],
    format: "html",
    out: simpackHtmlOut,
  });

  assert.ok(fs.existsSync(simpackHtmlOut));
  const spckContent = fs.readFileSync(simpackHtmlOut, "utf-8");
  assert.ok(spckContent.includes("Suspension"));
});
