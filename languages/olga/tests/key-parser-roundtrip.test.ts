// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { parseKeyDeck, serializeKeyDeck } from "../src/parser/key-parser.js";

console.log("=== Testing OLGA Keyword Parser & Serializer Full Roundtrip ===");

const deck = `CASE TITLE = "Subsea Production Flowline with Topsides & Machinery", AUTHOR = "Deepwater Flow Assurance Team"
INTEGRATION STARTTIME = 0.0 s, ENDTIME = 14400.0 s, MINDT = 0.01 s, MAXDT = 1.0 s
FILES TABLE = "fluids/north_sea_pvt.tab"
RESTART FILE = "checkpoints/flowline_t1800.rst", TIME = 1800.0 s
OUTPUT TREND = 5.0 s, PROFILE = 30.0 s, VARIABLES = (PT, TM, HOL, QLT, ROG)

FLOWPATH NAME = PROD_FLOWLINE
HEATTRANSFER TYPE = WATER, TAMB = 277.15 K, HAMB = 250.0 W/m2-C
WALL THICKNESS = (0.025 m, 0.05 m), CONDUCTIVITY = (45.0 W/m-C, 0.035 W/m-C)

PIPE LABEL = FLOWLINE_SEC1, LENGTH = 4500.0 m, DIAMETER = 0.3048 m, ELEVATION = -50.0 m, ROUGHNESS = 4.5e-5 m, NSEGMENT = 25, METALLURGY = API_5L_X65MS, CLADDING = INCONEL_625
PIPE LABEL = RISER_SEC2, LENGTH = 950.0 m, DIAMETER = 0.254 m, ELEVATION = 320.0 m, ROUGHNESS = 4.5e-5 m, NSEGMENT = 15, METALLURGY = API_5L_X65

VALVE NAME = TOPSIDE_CHOKE, POSITION = 5450.0 m, DIAMETER = 0.12 m, OPENING = 0.75, CD = 0.84, TIMEOPEN = 5.0 s, TIMECLOSE = 5.0 s

MASSSOURCE NAME = WELL_SRC, POSITION = 0.0 m, TOTALMASSRATE = 36.5 kg/s, GASFRACTION = 0.22, WATERCUT = 0.08, TEMPERATURE = 345.15 K, PRESSURE = 160.0 bar, H2S = 0.008, CO2 = 0.035

CONTROLLER NAME = CHOKE_PID, TYPE = PID, SETPOINT = 22.0, GAIN = 1.5, TI = 25.0 s, TD = 0.5 s, TRANSMITTER = "PT_INLET", VALVE = "TOPSIDE_CHOKE"

PUMP NAME = SUBSEA_BOOSTER, ABSPOSITION = 1200.0 m, TYPE = MULTIPHASE_TWIN_SCREW, HEAD = 180.0 m, FLOWRATE = 0.06 m3/s, SPEED = 3200.0 rpm, POWER = 750.0 kW, GVFLIMIT = 0.35

COMPRESSOR NAME = EXPORT_COMP, ABSPOSITION = 5400.0 m, TYPE = CENTRIFUGAL, PRESSRATIO = 2.8, EFFICIENCY = 0.81, POWER = 3500.0 kW, ANTISURGEMARGIN = 0.12

WELL NAME = RESERVOIR_IPR, TYPE = VOGEL, PRES = 190.0 bar, TRES = 355.0 K, GASFRACTION = 0.22, WATERCUT = 0.08, PBUBBLE = 145.0 bar, QMAX = 52.0 kg/s

WAX CLOUDPOINT = 312.15 K, DIFFUSION = 1.6e-9, DENSITY = 885.0 kg/m3

SAND MASSRATE = 0.04 kg/s, DIAMETER = 0.00015 m, DENSITY = 2650.0 kg/m3
ASPHALTENE SATURATES = 42.0 %, AROMATICS = 28.0 %, RESINS = 18.0 %, ASPHALTENES = 12.0 %, BUBBLEPOINT = 135.0 bar, EXPOSURETIME = 720.0 h

HEATEXCHANGER NAME = SUBSEA_COOLER, ABSPOSITION = 2200.0 m, TYPE = CROSS_FLOW, CAPACITY = 1200.0 kW, TARGETTEMP = 310.15 K, UA = 45000.0 W/K, TAMB = 277.15 K

PIG NAME = CLEANING_PIG_01, LAUNCHTIME = 1800.0 s, MASS = 110.0 kg, DIAMETER = 0.29 m, BYPASS = 0.05, FRICTION = 2800.0 N
NODE NAME = WELLHEAD_MANIFOLD, TYPE = MASS_SOURCE, FLOWPATH = PROD_FLOWLINE, FRACTION = 0.0, PRESSURE = 160.0 bar, TEMPERATURE = 345.15 K, TOTALMASSRATE = 36.5 kg/s, GASFRACTION = 0.22, WATERCUT = 0.08, H2S = 0.008, CO2 = 0.035
NODE NAME = TOPSIDE_RECEIVER, TYPE = TERMINAL, FLOWPATH = PROD_FLOWLINE, FRACTION = 1.0, PRESSURE = 22.0 bar, TEMPERATURE = 295.15 K
`;

// -----------------------------------------------------------------------------
// 1. Parse Original Deck
// -----------------------------------------------------------------------------
console.log("1. Parsing extended OLGA keyword deck...");
const model1 = parseKeyDeck(deck);

assert.strictEqual(model1.title, "Subsea Production Flowline with Topsides & Machinery");
assert.strictEqual(model1.author, "Deepwater Flow Assurance Team");
assert.strictEqual(model1.startTime, 0.0);
assert.strictEqual(model1.endTime, 14400.0);
assert.strictEqual(model1.tableFile, "fluids/north_sea_pvt.tab");

// Header directives
assert.ok(model1.restartConfig);
assert.strictEqual(model1.restartConfig.file, "checkpoints/flowline_t1800.rst");
assert.strictEqual(model1.restartConfig.time, 1800.0);

assert.ok(model1.outputConfig);
assert.strictEqual(model1.outputConfig.trendInterval, 5.0);
assert.strictEqual(model1.outputConfig.profileInterval, 30.0);
assert.deepStrictEqual(model1.outputConfig.variables, ["PT", "TM", "HOL", "QLT", "ROG"]);

// Pipes with metallurgy & cladding
const fp = model1.flowpaths[0]!;
assert.strictEqual(fp.name, "PROD_FLOWLINE");
assert.strictEqual(fp.pipes.length, 2);
assert.strictEqual(fp.pipes[0]!.metallurgy, "API_5L_X65MS");
assert.strictEqual(fp.pipes[0]!.cladding, "INCONEL_625");
assert.strictEqual(fp.pipes[1]!.metallurgy, "API_5L_X65");

// Sources with sour gas
assert.strictEqual(fp.sources[0]!.h2sMoleFraction, 0.008);
assert.strictEqual(fp.sources[0]!.co2MoleFraction, 0.035);

// Machinery
assert.ok(fp.pumps && fp.pumps.length === 1);
assert.strictEqual(fp.pumps[0]!.name, "SUBSEA_BOOSTER");
assert.strictEqual(fp.pumps[0]!.type, "MULTIPHASE_TWIN_SCREW");
assert.strictEqual(fp.pumps[0]!.ratedHead, 180.0);
assert.strictEqual(fp.pumps[0]!.speedRpm, 3200.0);
assert.strictEqual(fp.pumps[0]!.gasVoidFractionLimit, 0.35);

assert.ok(fp.compressors && fp.compressors.length === 1);
assert.strictEqual(fp.compressors[0]!.name, "EXPORT_COMP");
assert.strictEqual(fp.compressors[0]!.pressureRatio, 2.8);
assert.strictEqual(fp.compressors[0]!.polytropicEfficiency, 0.81);
assert.strictEqual(fp.compressors[0]!.ratedPowerKw, 3500.0);

// IPR
assert.ok(fp.ipr);
assert.strictEqual(fp.ipr.type, "VOGEL");
assert.strictEqual(fp.ipr.reservoirPressure, 190e5);
assert.strictEqual(fp.ipr.bubblePointPressure, 145e5);
assert.strictEqual(fp.ipr.maxLiquidRate, 52.0);

// Wax & Sand
assert.ok(fp.waxConfig);
assert.strictEqual(fp.waxConfig.cloudPointTemp, 312.15);
assert.strictEqual(fp.waxConfig.molecularDiffusionCoeff, 1.6e-9);

assert.ok(fp.sandConfig);
assert.strictEqual(fp.sandConfig.sandMassRate, 0.04);
assert.strictEqual(fp.sandConfig.particleDiameter, 0.00015);

// Asphaltene
assert.ok(fp.asphalteneConfig);
assert.strictEqual(fp.asphalteneConfig.sara.saturatesPercent, 42.0);
assert.strictEqual(fp.asphalteneConfig.sara.aromaticsPercent, 28.0);
assert.strictEqual(fp.asphalteneConfig.sara.resinsPercent, 18.0);
assert.strictEqual(fp.asphalteneConfig.sara.asphaltenesPercent, 12.0);
assert.strictEqual(fp.asphalteneConfig.bubblePointPressure, 135e5);
assert.strictEqual(fp.asphalteneConfig.exposureTimeHours, 720.0);

// Heat Exchanger
assert.ok(fp.heatExchangers && fp.heatExchangers.length === 1);
assert.strictEqual(fp.heatExchangers[0]!.name, "SUBSEA_COOLER");
assert.strictEqual(fp.heatExchangers[0]!.type, "CROSS_FLOW");
assert.strictEqual(fp.heatExchangers[0]!.dutyKw, 1200.0);
assert.strictEqual(fp.heatExchangers[0]!.targetTemperature, 310.15);
assert.strictEqual(fp.heatExchangers[0]!.overallUa, 45000.0);
assert.strictEqual(fp.heatExchangers[0]!.ambientTemperature, 277.15);

// Nodes
assert.strictEqual(model1.nodes[0]!.h2sMoleFraction, 0.008);
assert.strictEqual(model1.nodes[0]!.co2MoleFraction, 0.035);

console.log("✔ Initial parse verified all extended directives!");

// -----------------------------------------------------------------------------
// 2. Serialize and Roundtrip
// -----------------------------------------------------------------------------
console.log("2. Serializing back to keyword deck and roundtrip parsing...");
const serialized = serializeKeyDeck(model1);

assert.ok(serialized.includes('RESTART FILE = "checkpoints/flowline_t1800.rst"'));
assert.ok(serialized.includes("OUTPUT TREND = 5 s, PROFILE = 30 s, VARIABLES = (PT, TM, HOL, QLT, ROG)"));
assert.ok(serialized.includes("METALLURGY = API_5L_X65MS, CLADDING = INCONEL_625"));
assert.ok(serialized.includes("PUMP NAME = SUBSEA_BOOSTER"));
assert.ok(serialized.includes("COMPRESSOR NAME = EXPORT_COMP"));
assert.ok(serialized.includes("WELL NAME = WELL_IPR"));
assert.ok(serialized.includes("WAX CLOUDPOINT = 312.15 K"));
assert.ok(serialized.includes("SAND MASSRATE = 0.04 kg/s"));
assert.ok(
  serialized.includes(
    "HEATEXCHANGER NAME = SUBSEA_COOLER, ABSPOSITION = 2200 m, TYPE = CROSS_FLOW, DUTY = 1200 kW, TARGETTEMP = 310.15 K, UA = 45000 W/K, TAMB = 277.15 K",
  ),
);
assert.ok(serialized.includes("H2S = 0.008, CO2 = 0.035"));

const model2 = parseKeyDeck(serialized);

// Verify exact equivalence after 2nd parse
assert.strictEqual(model2.title, model1.title);
assert.strictEqual(model2.startTime, model1.startTime);
assert.strictEqual(model2.endTime, model1.endTime);
assert.strictEqual(model2.restartConfig?.file, model1.restartConfig?.file);
assert.strictEqual(model2.outputConfig?.trendInterval, model1.outputConfig?.trendInterval);
assert.deepStrictEqual(model2.outputConfig?.variables, model1.outputConfig?.variables);

const fp2 = model2.flowpaths[0]!;
assert.strictEqual(fp2.pipes[0]!.metallurgy, fp.pipes[0]!.metallurgy);
assert.strictEqual(fp2.pipes[0]!.cladding, fp.pipes[0]!.cladding);
assert.strictEqual(fp2.pumps?.[0]!.type, fp.pumps?.[0]!.type);
assert.strictEqual(fp2.compressors?.[0]!.pressureRatio, fp.compressors?.[0]!.pressureRatio);
assert.strictEqual(fp2.heatExchangers?.[0]!.dutyKw, fp.heatExchangers?.[0]!.dutyKw);
assert.strictEqual(fp2.heatExchangers?.[0]!.targetTemperature, fp.heatExchangers?.[0]!.targetTemperature);
assert.strictEqual(fp2.ipr?.type, fp.ipr?.type);
assert.strictEqual(fp2.waxConfig?.cloudPointTemp, fp.waxConfig?.cloudPointTemp);
assert.strictEqual(fp2.sandConfig?.sandMassRate, fp.sandConfig?.sandMassRate);
assert.strictEqual(fp2.asphalteneConfig?.sara.asphaltenesPercent, fp.asphalteneConfig?.sara.asphaltenesPercent);

console.log("✔ 2-Way roundtrip equivalence verified!");
console.log("=== All OLGA Keyword Parser & Serializer Roundtrip Tests Passed! ===");
