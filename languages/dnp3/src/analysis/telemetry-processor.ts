// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SCADA Telemetry Deadband & Scaling Benchmark Processor.
 *
 * Implements DNP3 analog input event generation with deadband thresholding,
 * engineering unit transformation, signal reconstruction, residual tracking,
 * and RMSE convergence verification.
 */

import type { Dnp3AnalogInput } from "../types.js";

export interface TelemetryProcessingResult {
  rawSampleCount: number;
  reportedEventCount: number;
  compressionRatio: number;
  residualMax: number;
  rmse: number;
  converged: boolean;
}

/**
 * Converts raw integer/counts from RTU/PLC to engineering units.
 */
export function scaleRawToEngineering(raw: number, ai: Dnp3AnalogInput): number {
  return raw * ai.scalingMultiplier + ai.scalingOffset;
}

/**
 * Inverts engineering units to raw counts.
 */
export function scaleEngineeringToRaw(eng: number, ai: Dnp3AnalogInput): number {
  if (ai.scalingMultiplier === 0) return 0;
  return (eng - ai.scalingOffset) / ai.scalingMultiplier;
}

/**
 * Processes a sequence of telemetry samples through DNP3 deadband filtering
 * and evaluates signal reconstruction accuracy.
 */
export function processTelemetryStream(
  samples: number[],
  ai: Dnp3AnalogInput,
  options?: { tolerance?: number | undefined },
): TelemetryProcessingResult {
  const tolerance = options?.tolerance ?? Math.max(ai.deadband * 1.5, 1e-4);
  if (samples.length === 0) {
    return {
      rawSampleCount: 0,
      reportedEventCount: 0,
      compressionRatio: 1.0,
      residualMax: 0.0,
      rmse: 0.0,
      converged: true,
    };
  }

  const events: Array<{ index: number; value: number }> = [];
  let lastReported = scaleRawToEngineering(samples[0]!, ai);
  events.push({ index: 0, value: lastReported });

  for (let i = 1; i < samples.length; i++) {
    const currentEng = scaleRawToEngineering(samples[i]!, ai);
    if (Math.abs(currentEng - lastReported) >= ai.deadband) {
      events.push({ index: i, value: currentEng });
      lastReported = currentEng;
    }
  }

  // Reconstruct zero-order hold signal
  let eventIdx = 0;
  let currentHold = events[0]!.value;
  let sse = 0.0;
  let residualMax = 0.0;

  for (let i = 0; i < samples.length; i++) {
    if (eventIdx + 1 < events.length && events[eventIdx + 1]!.index === i) {
      eventIdx++;
      currentHold = events[eventIdx]!.value;
    }
    const trueEng = scaleRawToEngineering(samples[i]!, ai);
    const residual = Math.abs(trueEng - currentHold);
    if (residual > residualMax) residualMax = residual;
    sse += residual * residual;
  }

  const rmse = Math.sqrt(sse / samples.length);
  const compressionRatio = events.length / samples.length;
  // DNP3 deadband guarantee: residual is bounded by deadband
  const converged = residualMax <= tolerance;

  return {
    rawSampleCount: samples.length,
    reportedEventCount: events.length,
    compressionRatio,
    residualMax,
    rmse,
    converged,
  };
}
