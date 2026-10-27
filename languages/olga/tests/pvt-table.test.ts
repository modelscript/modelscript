// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — PVT Fluid Property Table Test Suite.
 *
 * Validates:
 * 1. Multi-phase table ingestion (2-phase and 3-phase oil/water/gas)
 * 2. Multi-unit system handling (Field, Metric, SI)
 * 3. Multi-block matrix layouts vs. columnar layouts
 * 4. 2D Bilinear interpolation with analytical partial derivatives (dRho/dP, dRho/dT)
 * 5. Sound speed calculation and smooth Taylor boundary extrapolation
 * 6. Emulsion inversion rheology coupling across water cuts
 * 7. Integrated 1D Drift-Flux simulation using tabular PVT
 * 8. Pre-flight multiphase linter rule M7008
 */

import assert from "node:assert";
import {
  evaluateCellFluidProperties,
  evaluateCellFluidPropertiesFlat,
  interpolatePvt,
  lintOlgaModel,
  parsePvtTable,
  simulateDriftFlux,
  type OlgaModel,
} from "../src/index.js";

console.log("=== Testing OLGA Tabular PVT Fluid Table Subsystem ===");

// ---------------------------------------------------------------------------
// 1. Field Units Columnar Table (PSIA, F, LB/FT3, CP)
// ---------------------------------------------------------------------------
console.log("1. Testing Field Units Columnar Ingestion...");
const fieldUnitsTableText = `
TITLE = "Deepwater GoM Black Oil - Field Units"
PHASE = TWO-PHASE
UNITS = FIELD
PRESSURE = 500, 1000, 2000, 4000 PSIA
TEMPERATURE = 60, 100, 150, 200 F
COLUMNS = PRESSURE, TEMPERATURE, ROG, ROL, VISG, VISL, STG
500, 60, 1.85, 52.4, 0.0135, 3.25, 24.5
1000, 100, 3.92, 51.6, 0.0152, 2.45, 22.0
2000, 150, 8.45, 50.1, 0.0191, 1.65, 18.5
4000, 200, 18.2, 47.8, 0.0265, 0.95, 14.0
`;

const fieldTable = parsePvtTable(fieldUnitsTableText);
assert.strictEqual(fieldTable.title, "Deepwater GoM Black Oil - Field Units");
assert.strictEqual(fieldTable.units.pressure, "PSIA");
assert.strictEqual(fieldTable.units.temperature, "F");
assert.strictEqual(fieldTable.units.density, "LB/FT3");

// Verify pressure conversion (500 psia ~ 3.447 MPa)
assert.ok(Math.abs(fieldTable.pressures[0]! - 500 * 6894.757) < 1.0);
// Verify temperature conversion (60 F ~ 288.7 K)
assert.ok(Math.abs(fieldTable.temperatures[0]! - 288.7) < 0.2);
// Verify density conversion (52.4 lb/ft3 ~ 839.3 kg/m3)
assert.ok(fieldTable.rhoL[0]![0]! > 800 && fieldTable.rhoL[0]![0]! < 860);
console.log("✔ Field units converted to SI correctly!");

// ---------------------------------------------------------------------------
// 2. Three-Phase Oil / Water / Gas Table & Emulsion Inversion Coupling
// ---------------------------------------------------------------------------
console.log("2. Testing Three-Phase Oil/Water/Gas Ingestion & Rheology...");
const threePhaseTableText = `
TITLE = "North Sea Three-Phase Separator Feed"
PHASE = THREE-PHASE
UNITS = METRIC
PRESSURE = 20, 50, 100, 150 BAR
TEMPERATURE = 15, 30, 50, 75 C
COLUMNS = PRESSURE, TEMPERATURE, ROG, ROO, ROW, VISG, VISO, VISW, STG, SIGOW
20, 15, 17.5, 845.0, 1015.0, 0.013, 14.5, 1.15, 0.028, 0.038
50, 30, 44.0, 835.0, 1008.0, 0.015, 9.8, 0.85, 0.026, 0.035
100, 50, 92.0, 818.0, 998.0, 0.018, 5.4, 0.58, 0.023, 0.032
150, 75, 148.0, 795.0, 982.0, 0.022, 2.8, 0.42, 0.019, 0.028
`;

const threePhaseTable = parsePvtTable(threePhaseTableText);
assert.strictEqual(threePhaseTable.fluidType, "THREE_PHASE");
assert.ok(threePhaseTable.rhoO != null && threePhaseTable.rhoW != null);
assert.ok(threePhaseTable.visO != null && threePhaseTable.visW != null);

// Test fluid property evaluation across water cuts
const evalP = 50.0e5; // 50 bar
const evalT = 303.15; // 30 C

// Dry oil (WC = 0)
const dryOil = evaluateCellFluidProperties(threePhaseTable, evalP, evalT, 0.0);
assert.ok(dryOil.rhoL < 840 && dryOil.rhoL > 830);

// Inversion peak (WC ~ 0.42)
const peakEmulsion = evaluateCellFluidProperties(threePhaseTable, evalP, evalT, 0.42);
// 100% water (WC = 1.0)
const pureWater = evaluateCellFluidProperties(threePhaseTable, evalP, evalT, 1.0);

assert.ok(pureWater.rhoL > 1000);
// Emulsion viscosity at inversion peak must be significantly greater than pure oil and pure water
assert.ok(peakEmulsion.muL > dryOil.muL, "Emulsion peak must exceed dry oil viscosity");
assert.ok(peakEmulsion.muL > pureWater.muL, "Emulsion peak must exceed pure water viscosity");
console.log(
  `✔ Three-phase rheology verified: mu_oil=${(dryOil.muL * 1000).toFixed(1)} cP, ` +
    `mu_peak=${(peakEmulsion.muL * 1000).toFixed(1)} cP, mu_wat=${(pureWater.muL * 1000).toFixed(1)} cP!`,
);

// ---------------------------------------------------------------------------
// 3. Multi-Block Matrix Table Ingestion (PVTsim Style)
// ---------------------------------------------------------------------------
console.log("3. Testing Multi-Block Matrix Table Ingestion...");
const multiBlockTableText = `
TITLE = "PVTsim Multi-Block Table"
PRESSURE = 10, 50, 100 BAR
TEMPERATURE = 20, 60 C
VARIABLE = ROG
10 20 8.2
10 60 7.1
50 20 43.5
50 60 38.2
100 20 95.0
100 60 84.0

VARIABLE = ROL
10 20 830.0
10 60 810.0
50 20 835.0
50 60 815.0
100 20 842.0
100 60 822.0

VARIABLE = VISG
10 20 0.012
10 60 0.014
50 20 0.015
50 60 0.017
100 20 0.019
100 60 0.021

VARIABLE = VISL
10 20 3.5
10 60 1.5
50 20 3.7
50 60 1.6
100 20 4.0
100 60 1.8
`;

const mbTable = parsePvtTable(multiBlockTableText);
assert.strictEqual(mbTable.title, "PVTsim Multi-Block Table");
assert.strictEqual(mbTable.pressures.length, 3);
assert.strictEqual(mbTable.temperatures.length, 2);

// Check parsed matrix values
const interpMb = interpolatePvt(mbTable, 50.0e5, 293.15); // 50 bar, 20 C
assert.ok(Math.abs(interpMb.rhoG - 43.5) < 0.5);
assert.ok(Math.abs(interpMb.rhoL - 835.0) < 0.5);

// Test 2D Bicubic Hermite Spline interpolation with C1 continuity
const interpBicubic = interpolatePvt(mbTable, 50.0e5, 313.15, { method: "bicubic" }); // 50 bar, 40 C
assert.ok(interpBicubic.rhoG > 38.0 && interpBicubic.rhoG < 44.0);
assert.ok(interpBicubic.dRhoGdP > 0);
assert.ok(interpBicubic.soundSpeedGas > 200.0);
console.log("✔ Multi-block matrix layout & 2D Bicubic Hermite spline parsed and verified cleanly!");

// ---------------------------------------------------------------------------
// 4. Thermodynamic Derivatives & Sound Speed
// ---------------------------------------------------------------------------
console.log("4. Testing Analytical Derivatives & Sound Speed...");
const derivTest = interpolatePvt(mbTable, 75.0e5, 313.15); // 75 bar, 40 C
assert.ok(derivTest.dRhoGdP > 0, "Gas density must increase with pressure (dRho/dP > 0)");
assert.ok(derivTest.dRhoGdT < 0, "Gas density must decrease with temperature (dRho/dT < 0)");
assert.ok(derivTest.soundSpeedGas > 150 && derivTest.soundSpeedGas < 600, "Gas sound speed in physical range");
assert.ok(
  derivTest.soundSpeedLiquid > 800 && derivTest.soundSpeedLiquid < 2000,
  "Liquid sound speed in physical range",
);
console.log(
  `✔ Derivatives & Sound speed: dRhoG/dP=${derivTest.dRhoGdP.toExponential(2)}, ` +
    `c_gas=${derivTest.soundSpeedGas.toFixed(0)} m/s, c_liq=${derivTest.soundSpeedLiquid.toFixed(0)} m/s!`,
);

// Smooth Taylor extrapolation outside bounds
const extrapTest = interpolatePvt(mbTable, 120.0e5, 343.15); // 120 bar (> 100), 70 C (> 60)
assert.strictEqual(extrapTest.isExtrapolated, true);
assert.ok(extrapTest.rhoG > 84.0, "Extrapolated density continues increasing with pressure");
console.log(`✔ Taylor extrapolation verified: rhoG=${extrapTest.rhoG.toFixed(1)} kg/m^3 (isExtrapolated=true)!`);

// ---------------------------------------------------------------------------
// 5. Coupled Drift-Flux Flowline Simulation with Tabular PVT
// ---------------------------------------------------------------------------
console.log("5. Testing Integrated simulateDriftFlux with Tabular PVT...");
const sampleModel: OlgaModel = {
  title: "Subsea Tieback with Tabular Fluid",
  tableFile: "gom_fluid.tab",
  startTime: 0,
  endTime: 60,
  minDt: 0.1,
  maxDt: 1.0,
  flowpaths: [
    {
      name: "TIEBACK_1",
      pipes: [
        { label: "P1", length: 1000, diameter: 0.25, elevation: -20, roughness: 4.5e-5, discretization: 4 },
        { label: "P2", length: 1500, diameter: 0.25, elevation: 200, roughness: 4.5e-5, discretization: 4 },
      ],
      valves: [{ name: "CHOKE_1", position: 2500, diameter: 0.12, opening: 0.85, cd: 0.84 }],
      sources: [
        { name: "WELL_1", position: 0, totalMassRate: 35.0, gasMassFraction: 0.3, waterCut: 0.2, temperature: 343.15 },
      ],
      controllers: [],
    },
  ],
  nodes: [
    {
      name: "INLET",
      type: "TERMINAL",
      flowpath: "TIEBACK_1",
      boundaryPosition: 0.0,
      massRate: 35.0,
      temperature: 343.15,
    },
    { name: "OUTLET", type: "SEPARATOR", flowpath: "TIEBACK_1", boundaryPosition: 1.0, pressure: 40.0e5 },
  ],
};

const simResult = simulateDriftFlux(sampleModel, {
  durationSeconds: 30,
  timeStepSeconds: 1.0,
  pvtTable: threePhaseTable,
});

assert.strictEqual(simResult.times.length, 31);
assert.ok(simResult.trends.arrivalPressure.length === 31);
assert.ok(simResult.trends.arrivalPressure[30]! > 35.0e5);
assert.ok(simResult.trends.accumulatedLiquidVolume[30]! > 0);
console.log(
  `✔ Drift-flux simulation complete with tabular PVT (Surge liquid: ${simResult.trends.peakLiquidSurgeVolume.toFixed(2)} m^3)!`,
);

// ---------------------------------------------------------------------------
// 6. Pre-Flight Multiphase Linter Rule M7008
// ---------------------------------------------------------------------------
console.log("6. Testing Linter Rule M7008 (PVT table validation)...");
const invalidExtModel: OlgaModel = {
  ...sampleModel,
  tableFile: "fluid_properties.csv", // invalid extension
};
const diagsInvalidExt = lintOlgaModel(invalidExtModel);
const m7008Ext = diagsInvalidExt.find((d) => d.code === "M7008");
assert.ok(m7008Ext, "M7008 should flag invalid table file extension (.csv)");
console.log(`✔ Linter detected M7008: "${m7008Ext.message}"`);

const diagsExtrap = lintOlgaModel(sampleModel, {
  pvtTable: `
PRESSURE = 10, 20 BAR
TEMPERATURE = 10, 20 C
COLUMNS = PRESSURE, TEMPERATURE, ROG, ROL, VISG, VISL
10, 10, 8, 800, 1e-5, 0.002
20, 20, 16, 790, 1.2e-5, 0.0018
`,
});
const m7008Out = diagsExtrap.find((d) => d.code === "M7008" && d.message.includes("deviates significantly"));
// ---------------------------------------------------------------------------
// 7. Zero-Allocation Flat Buffer Fluid Property Evaluation
// ---------------------------------------------------------------------------
console.log("7. Testing Zero-Allocation Flat Buffer Fluid Property Evaluation...");
const cellCount = 5;
const pArr = new Float64Array([20e5, 30e5, 40e5, 50e5, 60e5]);
const tArr = new Float64Array([293.15, 303.15, 313.15, 323.15, 333.15]);
const wcArr = new Float64Array([0.0, 0.25, 0.42, 0.6, 1.0]);

const flatRhoG = new Float64Array(cellCount);
const flatRhoL = new Float64Array(cellCount);
const flatMuG = new Float64Array(cellCount);
const flatMuL = new Float64Array(cellCount);

evaluateCellFluidPropertiesFlat(threePhaseTable, cellCount, pArr, tArr, wcArr, flatRhoG, flatRhoL, flatMuG, flatMuL);

for (let i = 0; i < cellCount; i++) {
  const scalar = evaluateCellFluidProperties(threePhaseTable, pArr[i]!, tArr[i]!, wcArr[i]!);
  assert.ok(Math.abs(flatRhoG[i]! - scalar.rhoG) < 1e-9);
  assert.ok(Math.abs(flatRhoL[i]! - scalar.rhoL) < 1e-9);
  assert.ok(Math.abs(flatMuG[i]! - scalar.muG) < 1e-9);
  assert.ok(Math.abs(flatMuL[i]! - scalar.muL) < 1e-9);
}
console.log(`✔ Flat buffer evaluation verified identical to scalar across ${cellCount} spatial cells!`);

console.log("=== All OLGA PVT Fluid Table Tests Passed! ===");
