// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * JESD3 `V` Test-Vector Logic Simulator.
 *
 * Evaluates each `V<n> <pins>*` test vector against the extracted PAL/GAL SOP Boolean equations,
 * checking expected output states (`H`, `L`, `Z`, `X`) and computing exact pass rate & RMSE.
 */

import type { JedecDocument, JedecSimulationResult, JedecVectorPinCheck, JedecVectorSimRow } from "../types.js";
import { evaluateOutputEquation, extractJedecEquations } from "./boolean-extractor.js";
import type { JedecDeviceProfile } from "./device-profiles.js";

/**
 * Simulates all JESD3 `V` test vectors in `doc` against the extracted Boolean equations.
 */
export function simulateJedecVectors(doc: JedecDocument, profileOverride?: JedecDeviceProfile): JedecSimulationResult {
  const extraction = extractJedecEquations(doc, profileOverride);
  const eqByPin = new Map(extraction.equations.map((eq) => [eq.pin, eq]));

  const rows: JedecVectorSimRow[] = [];
  let passedVectors = 0;
  let failedVectors = 0;
  let totalChecks = 0;
  let passedChecks = 0;
  let sumSquaredError = 0;
  let numericChecks = 0;

  for (const vec of doc.testVectors) {
    // 1. Apply driven input stimuli (0, 1, C -> 1, K -> 0)
    const pinStates = new Map<number, boolean>();
    for (let i = 0; i < vec.pins.length; i++) {
      const pin = i + 1;
      const ch = vec.pins.charAt(i);
      if (ch === "1" || ch === "C") {
        pinStates.set(pin, true);
      } else if (ch === "0" || ch === "K") {
        pinStates.set(pin, false);
      }
    }

    // 2. Two-pass evaluation so combinational feedback between I/O pins settles
    const computedOutputs = new Map<number, "H" | "L" | "Z">();
    for (let pass = 0; pass < 2; pass++) {
      for (const eq of extraction.equations) {
        const result = evaluateOutputEquation(eq, pinStates);
        computedOutputs.set(eq.pin, result);
        // Only update feedback state if the pin wasn't explicitly driven as an input (0/1)
        const vecChar = vec.pins.charAt(eq.pin - 1);
        if (vecChar !== "0" && vecChar !== "1" && result !== "Z") {
          pinStates.set(eq.pin, result === "H");
        }
      }
    }

    // 3. Check expected outputs (H, L, Z)
    const checks: JedecVectorPinCheck[] = [];
    let vectorPassed = true;

    for (let i = 0; i < vec.pins.length; i++) {
      const pin = i + 1;
      const expected = vec.pins.charAt(i);
      if (expected !== "H" && expected !== "L" && expected !== "Z") {
        continue;
      }

      const eq = eqByPin.get(pin);
      const actual = computedOutputs.get(pin) ?? "Z";
      const passed = actual === expected;

      checks.push({
        pin,
        signalName: eq?.signalName ?? `P${pin}`,
        expected,
        actual,
        passed,
      });

      totalChecks++;
      if (passed) passedChecks++;
      else vectorPassed = false;

      if (expected === "H" || expected === "L") {
        const expNum = expected === "H" ? 1.0 : 0.0;
        const actNum = actual === "H" ? 1.0 : actual === "L" ? 0.0 : 0.5;
        const err = actNum - expNum;
        sumSquaredError += err * err;
        numericChecks++;
      }
    }

    if (vectorPassed) passedVectors++;
    else failedVectors++;

    rows.push({
      vectorNumber: vec.number,
      rawPins: vec.pins,
      passed: vectorPassed,
      checks,
    });
  }

  const totalVectors = doc.testVectors.length;
  const passRate = totalVectors > 0 ? passedVectors / totalVectors : 1.0;
  const rmse = numericChecks > 0 ? Math.sqrt(sumSquaredError / numericChecks) : 0.0;

  return {
    deviceName: extraction.deviceName,
    totalVectors,
    passedVectors,
    failedVectors,
    totalChecks,
    passedChecks,
    passRate,
    rmse,
    rows,
  };
}
