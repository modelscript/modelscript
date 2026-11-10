// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  processTelemetryStream,
  scaleEngineeringToRaw,
  scaleRawToEngineering,
} from "../src/analysis/telemetry-processor.js";
import type { Dnp3AnalogInput } from "../src/types.js";

describe("DNP3 SCADA Telemetry & Deadband Benchmark Suite", () => {
  const analogPt: Dnp3AnalogInput = {
    index: 0,
    name: "PIPE_PRESSURE_PSI",
    eventClass: 2,
    deadband: 2.0, // 2.0 psi threshold
    scalingMultiplier: 0.05, // 20 counts per psi
    scalingOffset: 14.7, // Atmospheric datum
    units: "psi",
    minVal: 0,
    maxVal: 200,
  };

  it("scales raw counts to physical engineering units with exact tolerance", () => {
    const rawVal = 1000;
    // 1000 * 0.05 + 14.7 = 50 + 14.7 = 64.7 psi
    const eng = scaleRawToEngineering(rawVal, analogPt);
    const tolerance = 1e-4;
    assert.ok(Math.abs(eng - 64.7) < tolerance);

    const invertedRaw = scaleEngineeringToRaw(eng, analogPt);
    assert.ok(Math.abs(invertedRaw - rawVal) < tolerance);
  });

  it("filters telemetry samples by deadband with bounded residual and RMSE convergence within tolerance", () => {
    // Generate synthetic signal fluctuating within and outside deadband
    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      // Base raw count 1000 + small noise within deadband + larger step changes
      const noise = (i % 5) * 5; // small variation (up to 25 counts = 1.25 psi < 2.0 psi deadband)
      const step = Math.floor(i / 20) * 100; // big step every 20 samples (5.0 psi > deadband)
      samples.push(1000 + step + noise);
    }

    const tolerance = 2.5; // Deadband is 2.0, so reconstructed residual must be <= 2.0 < 2.5
    const result = processTelemetryStream(samples, analogPt, { tolerance });

    assert.equal(result.converged, true, "Telemetry stream filtering must converge within tolerance");
    assert.ok(result.reportedEventCount < result.rawSampleCount, "Deadband must compress event rate");
    assert.ok(
      result.residualMax <= analogPt.deadband + 1e-4,
      `Max residual ${result.residualMax} must not exceed deadband`,
    );
    assert.ok(result.rmse < tolerance, `RMSE ${result.rmse} must remain within tolerance`);
  });
});
