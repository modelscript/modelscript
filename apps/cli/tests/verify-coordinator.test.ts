// SPDX-License-Identifier: AGPL-3.0-or-later

import { COORDINATOR_SCENARIOS } from "@modelscript/runtime";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliMain = path.resolve(__dirname, "../dist/main.js");

test("CLI verify --coordinator evaluates multi-file CAE digital thread", () => {
  const scenario = COORDINATOR_SCENARIOS[0]!;
  const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-verify-coord-"));
  try {
    const filePaths: string[] = [];
    for (const pane of scenario.panes) {
      const fp = path.join(tmpDir, pane.fileName);
      fs.writeFileSync(fp, pane.defaultCode, "utf-8");
      filePaths.push(fp);
    }

    const stdout = execFileSync(
      process.execPath,
      [cliMain, "verify", "--coordinator", "--format", "json", ...filePaths],
      {
        encoding: "utf-8",
        timeout: 30000,
      },
    );

    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.scenarioId, scenario.id);
    assert.strictEqual(parsed.isSat, true);
    assert.ok(Array.isArray(parsed.portBindings) && parsed.portBindings.length > 0, "Expected non-empty portBindings");
    assert.ok(
      Array.isArray(parsed.variableLinks) && parsed.variableLinks.length > 0,
      "Expected non-empty variableLinks",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("CLI verify --coordinator evaluates arbitrary 2-file SysML2 + SPICE digital thread", () => {
  const tmpDir = fs.mkdtempSync(path.join(__dirname, ".tmp-verify-generic-"));
  try {
    const sysmlPath = path.join(tmpDir, "PowerSupply.sysml");
    const spicePath = path.join(tmpDir, "FilterStage.sp");
    fs.writeFileSync(
      sysmlPath,
      `package PowerSupply {
  part def FilterStage {
    attribute v_out = 5.0 [V];
    attribute r_series = 1000 [Ohm];
  }
}`,
      "utf-8",
    );
    fs.writeFileSync(
      spicePath,
      `* @twin: v_out <-> PowerSupply::FilterStage.v_out
* @twin: R1 <-> PowerSupply::FilterStage.r_series
* @unit: v_out = mV
.param v_out=5000
R1 in out 1k`,
      "utf-8",
    );

    const stdout = execFileSync(
      process.execPath,
      [cliMain, "verify", "--coordinator", "--format", "json", sysmlPath, spicePath],
      {
        encoding: "utf-8",
        timeout: 30000,
      },
    );

    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.mode, "generic");
    assert.strictEqual(parsed.fileCount, 2);
    assert.strictEqual(parsed.isSat, true);
    assert.strictEqual(parsed.variableLinks.length, 2);

    // Also verify auto-detection WITHOUT --coordinator and --format sarif
    const sarifOut = execFileSync(process.execPath, [cliMain, "verify", "--format", "sarif", sysmlPath, spicePath], {
      encoding: "utf-8",
      timeout: 30000,
    });
    const sarif = JSON.parse(sarifOut);
    assert.ok(Array.isArray(sarif.runs), "Expected valid SARIF runs array without --coordinator");

    // Verify drifted SPICE file emits suggestedEdits and --sync rewrites it to SAT on disk
    fs.writeFileSync(
      spicePath,
      `* @twin: v_out <-> PowerSupply::FilterStage.v_out
* @unit: v_out = mV
.param v_out=3300
R1 in out 1k`,
      "utf-8",
    );
    let driftJson = "";
    try {
      driftJson = execFileSync(
        process.execPath,
        [cliMain, "verify", "--coordinator", "--format", "json", sysmlPath, spicePath],
        { encoding: "utf-8", timeout: 30000 },
      );
    } catch (e: unknown) {
      driftJson = String((e as { stdout?: unknown }).stdout ?? "");
    }
    const driftParsed = JSON.parse(driftJson);
    assert.strictEqual(
      driftParsed.isSat,
      false,
      `Expected UNSAT drift, got: ${JSON.stringify({ status: driftParsed.status, links: driftParsed.variableLinks, conflicts: driftParsed.conflicts })}`,
    );
    assert.ok(
      Array.isArray(driftParsed.suggestedEdits) && driftParsed.suggestedEdits.length > 0,
      "Expected suggestedEdits in JSON output",
    );

    const syncedJson = execFileSync(
      process.execPath,
      [cliMain, "verify", "--coordinator", "--sync", "--format", "json", sysmlPath, spicePath],
      { encoding: "utf-8", timeout: 30000 },
    );
    const syncedParsed = JSON.parse(syncedJson);
    assert.strictEqual(syncedParsed.isSat, true, "Expected --sync to bring digital thread to SAT");
    assert.ok(
      fs.readFileSync(spicePath, "utf-8").includes("5000"),
      "Expected FilterStage.sp to be synced to 5000 mV on disk",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
