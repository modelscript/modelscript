// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runRelap5Benchmark } from "./relap5-benchmark-runner.js";

test("RELAP5 Nuclear Benchmark: PWR Primary System SCRAM & 6-Group Point Kinetics", () => {
  const rep = runRelap5Benchmark();

  assert.equal(rep.title, "PWR 4-Loop Reactor Primary System Benchmark");
  assert.equal(rep.initialPowerMW, 3000.0);
  assert.ok(rep.powerDropRatio < 0.2, "Power drops below 20% following SCRAM rod insertion");
  assert.ok(rep.peakFuelTempK >= 850.0, "Doppler feedback bounds fuel temperature");
  assert.ok(rep.simStepsCount >= 400, "High-resolution trajectory recorded");
  assert.equal(rep.isSquare, true, "DAE arena must be structurally square");
});
