// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { GtSuiteCommand } from "../src/commands/gtsuite.js";

const SAMPLE_GTM_MODEL = `MODEL: Test_Turbo_4Cyl
SPEED: 3000.0
LAMBDA: 1.0

COMPONENTS:
  INLET = environment_inlet (P = 101325, T = 298.15)
  COMP = turbo_compressor (PR = 2.0, EFF = 0.76, MASS_FLOW = 0.14)
  PLENUM_IN = plenum (VOL = 0.0035, P = 180000, T = 315)
  RUNNER1 = intake_runner (D = 0.045, L = 0.35)
  CYL1 = cylinder (BORE = 0.0825, STROKE = 0.0928, ROD = 0.144, CR = 10.0, ANCHOR = 15, DURATION = 45)
  EXH = exhaust_runner (D = 0.040, L = 0.40)
  TURB = turbo_turbine (ER = 1.9, EFF = 0.72)
  OUTLET = environment_outlet (P = 101325, T = 298.15)

CONNECTIONS:
  INLET.out -> COMP.in
  COMP.out -> PLENUM_IN.in
  PLENUM_IN.port1 -> RUNNER1.in
  RUNNER1.out -> CYL1.intake
  CYL1.exhaust -> EXH.in
  EXH.out -> TURB.in
  TURB.out -> OUTLET.in
`;

test("GT-SUITE CLI Commands (msx gtsuite inspect, lint, to-dae, to-modelica)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_gtsuite_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const gtmFile = path.join(tmpDir, "engine.gtm");
  fs.writeFileSync(gtmFile, SAMPLE_GTM_MODEL, "utf-8");

  await t.test("msx gtsuite inspect / summary", async () => {
    const outputs: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      outputs.push(String(chunk));
      return true;
    };

    try {
      await (GtSuiteCommand.handler as any)({
        action: "inspect",
        files: [gtmFile],
      });
      const combined = outputs.join("");
      assert.ok(combined.includes("GT-SUITE Model Summary: Test_Turbo_4Cyl"));
      assert.ok(combined.includes("Cylinders:       1"));
      assert.ok(combined.includes("Rated Speed:     3000 RPM"));
    } finally {
      process.stdout.write = origWrite;
    }
  });

  await t.test("msx gtsuite lint", async () => {
    const outputs: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      outputs.push(String(chunk));
      return true;
    };

    try {
      await (GtSuiteCommand.handler as any)({
        action: "lint",
        files: [gtmFile],
      });
      const combined = outputs.join("");
      assert.ok(combined.includes("Test_Turbo_4Cyl"));
    } finally {
      process.stdout.write = origWrite;
    }
  });

  await t.test("msx gtsuite to-dae", async () => {
    const outDae = path.join(tmpDir, "engine_dae.json");
    await (GtSuiteCommand.handler as any)({
      action: "to-dae",
      files: [gtmFile],
      out: outDae,
    });

    assert.ok(fs.existsSync(outDae));
    const meta = JSON.parse(fs.readFileSync(outDae, "utf-8"));
    assert.ok(meta.varCount > 5);
    assert.ok(meta.eqCount >= 5);
  });

  await t.test("msx gtsuite to-modelica", async () => {
    const outMo = path.join(tmpDir, "engine.mo");
    await (GtSuiteCommand.handler as any)({
      action: "to-modelica",
      files: [gtmFile],
      out: outMo,
    });

    assert.ok(fs.existsSync(outMo));
    const content = fs.readFileSync(outMo, "utf-8");
    assert.ok(content.includes("model Test_Turbo_4Cyl"));
    assert.ok(content.includes("Real P_intake"));
  });
});
