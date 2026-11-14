// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildGatekeeperPackageFromInput } from "../src/commands/gatekeeper-package.js";

const SAMPLE_RAW = `0, 100.00, 33, 0, 0, 60.00 / PSS/E-33.0 SAMPLE
TEST PLANT
SAMPLE CASE
1, 'GENBUS      ', 20.000, 3, 1, 1, 1, 1.0000, 0.0000
0 / END OF BUS DATA
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
0 / END OF GENERATOR DATA
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
`;

describe("Gatekeeper Submission Package Inspector", () => {
  it("inspects ZIP submissions for real artifact presence without fabricating missing files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-gk-zip-"));
    try {
      const zipPath = path.join(tmpDir, "plant-sub.zip");
      const zip = new AdmZip();
      zip.addFile("model.raw", Buffer.from(SAMPLE_RAW, "utf-8"));
      zip.writeZip(zipPath);

      const pkg = buildGatekeeperPackageFromInput(zipPath);
      assert.equal(pkg["hasRawPowerFlow"], true);
      assert.equal(pkg["hasDyrDynamics"], false);
      assert.equal(pkg["hasPscadModel"], false);
      assert.equal(pkg["hasWasmFirmware"], false);
      assert.ok(pkg["staticDiagnosticCount"] !== undefined);
      assert.equal(pkg["flatStartMaxDriftPercent"], undefined);
      assert.equal(pkg["lowestStableScr"], undefined);
      assert.equal(pkg["lvrtPass"], undefined);
      assert.equal(pkg["hvrtPass"], undefined);
      assert.equal(pkg["emtRmsNrmse"], undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("inspects directory submissions and preserves explicit manifest telemetry", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-gk-dir-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "base.raw"), SAMPLE_RAW, "utf-8");
      fs.writeFileSync(path.join(tmpDir, "dyn.dyr"), "1 'GENROU' 1 6.0 0.03 /\n", "utf-8");
      fs.writeFileSync(
        path.join(tmpDir, "manifest.json"),
        JSON.stringify({
          plantName: "SOLAR_TEST",
          flatStartMaxDriftPercent: 0.01,
          lowestStableScr: 1.3,
          lvrtPass: true,
          hvrtPass: true,
        }),
        "utf-8",
      );

      const pkg = buildGatekeeperPackageFromInput(tmpDir);
      assert.equal(pkg["plantName"], "SOLAR_TEST");
      assert.equal(pkg["hasRawPowerFlow"], true);
      assert.equal(pkg["hasDyrDynamics"], true);
      assert.equal(pkg["hasPscadModel"], false);
      assert.equal(pkg["flatStartMaxDriftPercent"], 0.01);
      assert.equal(pkg["lowestStableScr"], 1.3);
      assert.equal(pkg["lvrtPass"], true);
      assert.equal(pkg["hvrtPass"], true);
      assert.equal(pkg["emtRmsNrmse"], undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
