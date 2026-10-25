// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  decodeOlgaFlowRegime,
  parseOlgaPpl,
  parseOlgaPplSnapshots,
  parseOlgaTpl,
  parseOlgaTplDataset,
  parseTrendVariableHeader,
} from "../src/index.js";

console.log("=== Testing OLGA Multi-Axis Trend (.tpl) and Spatial Profile (.ppl) Subsystem ===");

// 1. Test parseTrendVariableHeader unit parsing
console.log("1. Testing parseTrendVariableHeader...");
const v1 = parseTrendVariableHeader("PT:MAIN_RISER(1) [PA]");
assert.strictEqual(v1.variable, "PT");
assert.strictEqual(v1.branch, "MAIN_RISER");
assert.strictEqual(v1.sectionIndex, 1);
assert.strictEqual(v1.unit, "PA");

const v2 = parseTrendVariableHeader("HOL:FLOWLINE(12)", "[-]");
assert.strictEqual(v2.variable, "HOL");
assert.strictEqual(v2.branch, "FLOWLINE");
assert.strictEqual(v2.sectionIndex, 12);
assert.strictEqual(v2.unit, "-");

const v3 = parseTrendVariableHeader("QLT_OUTLET", "[KG/S]");
assert.strictEqual(v3.variable, "QLT_OUTLET");
assert.strictEqual(v3.unit, "KG/S");
console.log("✔ parseTrendVariableHeader passed!");

// 2. Test parseOlgaTplDataset with arbitrary multi-variable CATALOG
console.log("2. Testing parseOlgaTplDataset with arbitrary multi-channel columns...");
const sampleTplMulti = `
OLGA 7.3.4 INDUSTRIAL TREND PLOT FILE
CASE: SUBSEA_TIEBACK_TRANSIENT
CATALOG
  PT:WELL_A(1) [BAR]
  PT:MAIN_RISER(24) [BAR]
  TM:MAIN_RISER(24) [C]
  HOL:MAIN_RISER(24) [-]
  QLT:MAIN_RISER(24) [KG/S]
  QGT:MAIN_RISER(24) [SM3/D]
  DPSLUG:MAIN_RISER(18) [PA]
TIME   PT_INLET  PT_OUTLET  TM_OUTLET  HOL_OUTLET  QLT_OUTLET  QGT_OUTLET  DPSLUG
[S]    [BAR]     [BAR]      [C]        [-]         [KG/S]      [SM3/D]     [PA]
0.0    145.5     32.0       58.2       0.18        22.4        125000.0    1200.0
10.0   148.0     31.8       58.0       0.21        24.0        124500.0    1500.0
20.0   152.4     31.5       57.5       0.29        31.2        121000.0    4800.0
30.0   158.1     31.2       56.9       0.42        45.8        115000.0    9200.0
40.0   151.0     31.9       57.4       0.25        26.5        123000.0    2100.0
`;

const tplDataset = parseOlgaTplDataset(sampleTplMulti);
assert.strictEqual(tplDataset.times.length, 5);
assert.strictEqual(tplDataset.times[0], 0.0);
assert.strictEqual(tplDataset.times[4], 40.0);
assert.strictEqual(tplDataset.variables.length, 7);
assert.strictEqual(tplDataset.variables[0]!.variable, "PT");
assert.strictEqual(tplDataset.variables[0]!.unit, "BAR");
assert.strictEqual(tplDataset.variables[5]!.variable, "QGT");
assert.strictEqual(tplDataset.variables[5]!.unit, "SM3/D");
assert.strictEqual(tplDataset.variables[6]!.variable, "DPSLUG");
assert.strictEqual(tplDataset.data[6]![3], 9200.0);
console.log(
  `✔ parseOlgaTplDataset extracted ${tplDataset.variables.length} arbitrary channels over ${tplDataset.times.length} timesteps!`,
);

// 3. Test parseOlgaTpl backward-compatibility and trendDataset attachment
console.log("3. Testing parseOlgaTpl canonical simulation result synthesis...");
const simRes = parseOlgaTpl(sampleTplMulti);
assert.ok(simRes.trendDataset);
assert.strictEqual(simRes.trendDataset.variables.length, 7);
assert.strictEqual(simRes.times.length, 5);
assert.strictEqual(simRes.trends.inletPressure[0], 145.5);
assert.strictEqual(simRes.trends.arrivalPressure[0], 32.0);
assert.ok(simRes.trends.arrivalTemperature[0]! > 300); // 58.2 C -> Kelvin
assert.strictEqual(simRes.trends.arrivalLiquidHoldup[3], 0.42);
assert.ok(simRes.trends.peakLiquidSurgeVolume > 0);
console.log("✔ parseOlgaTpl backward compatibility verified!");

// 4. Test decodeOlgaFlowRegime
console.log("4. Testing flow regime decoding...");
assert.strictEqual(decodeOlgaFlowRegime(1), "Stratified Smooth");
assert.strictEqual(decodeOlgaFlowRegime(2), "Stratified Wavy");
assert.strictEqual(decodeOlgaFlowRegime(3), "Slug Flow");
assert.strictEqual(decodeOlgaFlowRegime(4), "Annular Mist");
assert.strictEqual(decodeOlgaFlowRegime(5), "Dispersed Bubble");
assert.strictEqual(decodeOlgaFlowRegime(6), "Severe Slugging");
console.log("✔ decodeOlgaFlowRegime verified!");

// 5. Test parseOlgaPpl spatial profile parsing
console.log("5. Testing parseOlgaPpl with multi-timestep spatial snapshots...");
const samplePpl = `
OLGA 7.3 PROFILE PLOT FILE
BRANCH = MAIN_RISER
CATALOG
  PT [PA]
  TM [C]
  HOL [-]
  UG [M/S]
  UL [M/S]
  ID [-]

TIME = 0.0000000E+00 [S]
X [M]     PT [PA]     TM [C]    HOL [-]   UG [M/S]   UL [M/S]   ID [-]
0.0       1.500E+07   65.0      0.15      6.2        1.1        2
500.0     1.420E+07   61.5      0.18      6.8        1.2        2
1000.0    1.310E+07   55.0      0.24      7.5        1.4        3
1500.0    1.180E+07   48.2      0.32      8.4        1.7        3
2000.0    0.950E+07   42.0      0.55      9.9        2.1        3

TIME = 1.0000000E+02 [S]
X [M]     PT [PA]     TM [C]    HOL [-]   UG [M/S]   UL [M/S]   ID [-]
0.0       1.520E+07   65.0      0.14      6.1        1.1        2
500.0     1.450E+07   61.8      0.17      6.7        1.2        2
1000.0    1.340E+07   55.4      0.22      7.3        1.3        2
1500.0    1.210E+07   49.0      0.28      8.1        1.5        3
2000.0    1.020E+07   43.1      0.48      9.5        1.9        3

TIME = 2.0000000E+02 [S]
X [M]     PT [PA]     TM [C]    HOL [-]   UG [M/S]   UL [M/S]   ID [-]
0.0       1.550E+07   65.0      0.12      6.5        1.1        2
500.0     1.490E+07   62.1      0.15      7.0        1.3        2
1000.0    1.390E+07   56.2      0.19      7.6        1.4        2
1500.0    1.280E+07   50.5      0.23      8.5        1.6        2
2000.0    1.110E+07   45.0      0.35      9.8        1.8        3
`;

const pplDataset = parseOlgaPpl(samplePpl);
assert.strictEqual(pplDataset.branch, "MAIN_RISER");
assert.strictEqual(pplDataset.snapshots.length, 3);
assert.strictEqual(pplDataset.snapshots[0]!.time, 0.0);
assert.strictEqual(pplDataset.snapshots[1]!.time, 100.0);
assert.strictEqual(pplDataset.snapshots[2]!.time, 200.0);

// Check spatial coordinates and variable lengths
const s0 = pplDataset.snapshots[0]!;
assert.strictEqual(s0.x.length, 5);
assert.strictEqual(s0.x[0], 0.0);
assert.strictEqual(s0.x[4], 2000.0);
assert.strictEqual(s0.variables["PT"]![0], 1.5e7);
assert.strictEqual(s0.variables["HOL"]![4], 0.55);
assert.strictEqual(s0.flowRegimes![0], "Stratified Wavy");
assert.strictEqual(s0.flowRegimes![4], "Slug Flow");
console.log(`✔ parseOlgaPpl parsed ${pplDataset.snapshots.length} spatial snapshots with 5 grid cells each!`);

// 6. Test conversion to SpatialProfileSnapshot[]
console.log("6. Testing profileDatasetToSnapshots conversion...");
const snapshots = parseOlgaPplSnapshots(samplePpl);
assert.strictEqual(snapshots.length, 3);
assert.strictEqual(snapshots[0]!.pressure.length, 5);
assert.strictEqual(snapshots[0]!.temperature.length, 5);
assert.ok(snapshots[0]!.temperature[0]! > 300); // 65 C -> Kelvin
assert.strictEqual(snapshots[0]!.liquidHoldup[4], 0.55);
assert.strictEqual(snapshots[0]!.gasVelocity[4], 9.9);
assert.strictEqual(snapshots[0]!.liquidVelocity[4], 2.1);
console.log("✔ profileDatasetToSnapshots successfully converted to canonical diagram snapshots!");

console.log("=== All OLGA .tpl and .ppl Subsystem Tests Passed! ===");
