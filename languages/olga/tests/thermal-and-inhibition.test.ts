// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  calculateHydrateDepression,
  calculateInhibitorDosing,
  evaluateHydrateInhibition,
} from "../src/solver/hydrate-inhibition.js";
import { evaluatePipelineCooldown } from "../src/solver/thermal-cooldown.js";

console.log("=== Testing OLGA Thermal Cooldown & Thermodynamic Hydrate Inhibition ===");

// ---------------------------------------------------------------------------
// 1. Transient Thermal Cooldown & No-Touch Time
// ---------------------------------------------------------------------------
console.log("1. Testing Transient Pipeline Cooldown & No-Touch Time...");

const cooldownResult = evaluatePipelineCooldown({
  innerDiameter: 0.3048, // 12-inch
  pipeLength: 5000, // 5 km
  initialTemperatureK: 338.15, // 65 C
  ambientTemperatureK: 277.15, // 4 C deepwater seabed
  shutInPressurePa: 120.0e5, // 120 bar
  liquidHoldup: 0.4,
  heatTransfer: {
    type: "WATER",
    ambientTemperature: 277.15,
    ambientHeatTransferCoeff: 50.0,
    layers: [
      { material: "Steel", thickness: 0.018, conductivity: 45.0, density: 7850, heatCapacity: 480 },
      { material: "Polypropylene Foam", thickness: 0.06, conductivity: 0.15, density: 750, heatCapacity: 1900 },
    ],
  },
});

assert.ok(
  cooldownResult.uHeatTransfer > 0.5 && cooldownResult.uHeatTransfer < 10.0,
  `U-value (${cooldownResult.uHeatTransfer.toFixed(2)} W/m^2K) should be in insulated pipeline range`,
);
assert.ok(
  cooldownResult.timeConstantSeconds > 10000,
  `Time constant (${(cooldownResult.timeConstantSeconds / 3600).toFixed(1)} h) should be several hours`,
);
assert.ok(
  cooldownResult.hydrateTempK > 285.0 && cooldownResult.hydrateTempK < 300.0,
  `Hydrate temp (${cooldownResult.hydrateTempK.toFixed(1)} K) should be ~18-22 C`,
);
assert.ok(
  cooldownResult.noTouchTimeSeconds > 7200,
  `No-touch time (${(cooldownResult.noTouchTimeSeconds / 3600).toFixed(2)} h) should provide at least 2 hours window`,
);

// Verify trajectory monotonic cooling
assert.ok(cooldownResult.trajectory.length >= 20);
const firstPt = cooldownResult.trajectory[0]!;
const lastPt = cooldownResult.trajectory[cooldownResult.trajectory.length - 1]!;
assert.strictEqual(firstPt.temperatureC, 65.0);
assert.ok(lastPt.temperatureC < firstPt.temperatureC);
assert.ok(lastPt.inHydrateZone === true, "Unmanaged 48h deadleg should cool into hydrate zone");

console.log(
  `✔ Cooldown verified: U=${cooldownResult.uHeatTransfer.toFixed(2)} W/m²K, tau=${(cooldownResult.timeConstantSeconds / 3600).toFixed(1)}h, No-Touch Time=${(cooldownResult.noTouchTimeSeconds / 3600).toFixed(1)} hours`,
);

// ---------------------------------------------------------------------------
// 2. Thermodynamic Hydrate Inhibition (Hammerschmidt / Nielsen)
// ---------------------------------------------------------------------------
console.log("2. Testing Hydrate Temperature Depression (MEG vs Methanol)...");

// 0 wt% -> 0 K depression
assert.strictEqual(calculateHydrateDepression(0.0, "MEG"), 0.0);

// 30 wt% MEG: DeltaT ~ (1297 * 30) / (62.07 * 70) = 8.95 K
const meg30 = calculateHydrateDepression(30.0, "MEG");
assert.ok(meg30 > 8.0 && meg30 < 10.0, `30 wt% MEG depression (${meg30.toFixed(2)} K)`);

// 50 wt% MEG: DeltaT ~ (1297 * 50) / (62.07 * 50) = 20.89 K
const meg50 = calculateHydrateDepression(50.0, "MEG");
assert.ok(meg50 > 19.5 && meg50 < 22.0, `50 wt% MEG depression (${meg50.toFixed(2)} K)`);

// Compare Methanol efficiency: MeOH molecular weight (32.04) is half of MEG (62.07)
const meoh30 = calculateHydrateDepression(30.0, "METHANOL");
assert.ok(meoh30 > meg30 * 1.8, `Methanol should provide ~1.9x depression compared to MEG per wt%`);

console.log(
  `✔ Hydrate depression verified: 30% MEG = ${meg30.toFixed(1)} K, 50% MEG = ${meg50.toFixed(1)} K, 30% MeOH = ${meoh30.toFixed(1)} K`,
);

// ---------------------------------------------------------------------------
// 3. Flowline Inhibition Evaluation & Dosing Calculation
// ---------------------------------------------------------------------------
console.log("3. Testing Flowline Inhibition Evaluation & Dosing Calculation...");

// At 80 bar and 10 C fluid temp:
const P_80bar = 80.0e5;
const T_10C = 283.15; // 10 C
const uninhibited = evaluateHydrateInhibition(P_80bar, T_10C, 0.0, "MEG");
assert.strictEqual(uninhibited.isSafe, false, "Uninhibited 10C fluid at 80 bar should form hydrates");

const inhibited = evaluateHydrateInhibition(P_80bar, T_10C, 45.0, "MEG", 3.0);
assert.strictEqual(inhibited.isSafe, true, "45 wt% MEG should suppress hydrate formation with >3K margin");
assert.ok(inhibited.subcoolingMarginK > 3.0);

// Test dosing calculation:
// Water rate: 2500 kg/h, lowest seabed temp: 4 C (277.15 K), pressure: 90 bar
const dosing = calculateInhibitorDosing(90.0e5, 277.15, 2500.0, "MEG", 3.0);
assert.ok(dosing.requiredInhibitorWeightPercent > 35.0 && dosing.requiredInhibitorWeightPercent < 60.0);
assert.ok(dosing.injectionMassRateKgPerHour > 1000.0, "Mass rate should be positive and substantial");
assert.ok(dosing.injectionVolumeRateLitersPerHour > 0.0);

console.log(
  `✔ Inhibitor dosing verified: required MEG = ${dosing.requiredInhibitorWeightPercent.toFixed(1)} wt%, injection rate = ${dosing.injectionMassRateKgPerHour.toFixed(0)} kg/h (${dosing.injectionVolumeRateLitersPerHour.toFixed(0)} L/h)`,
);

console.log("=== All OLGA Thermal Cooldown & Hydrate Inhibition Tests Passed! ===");
