// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  AspenWorkspaceIndex,
  aspenToModelica,
  lintAspen,
  lowerAspenToDae,
  parseAspen,
  serializeAspen,
  solveFlashRachfordRice,
} from "../src/index.js";

const VALID_ASPEN_DECK = `TITLE 'METHANOL-WATER FLASH AND SEPARATION'
IN-UNITS MET
DEF-STREAMS CONV ALL

COMPONENTS
    METHANOL CH4O
    WATER    H2O

FLOWSHEET
    BLOCK FLASH1 IN=FEED OUT=VAP1 LIQ1
    BLOCK PUMP1 IN=LIQ1 OUT=PROD
    BLOCK COL1 IN=VAP1 OUT=DISTIL BOTT

PROPERTIES NRTL

STREAM FEED
    SUBSTREAM MIXED TEMP=65.0 PRES=1.5 MOLE-FLOW=100.0
    MOLE-FRAC METHANOL 0.5 / WATER 0.5

BLOCK FLASH1 FLASH2
    PARAM TEMP=75.0 PRES=1.2

BLOCK PUMP1 PUMP
    PARAM PRES=3.0

BLOCK COL1 RADFRAC
    PARAM NSTAGE=15
    FEED VAP1 8
    PRODUCTS DISTIL 1 V / BOTT 15 L
    COL-SPECS RR=2.5
`;

test("Aspen Parser: parses valid Aspen Plus input deck into structured AST", () => {
  const deck = parseAspen(VALID_ASPEN_DECK);

  assert.equal(deck.title, "METHANOL-WATER FLASH AND SEPARATION");
  assert.equal(deck.units, "MET");
  assert.equal(deck.propertyMethod, "NRTL");

  // Components
  assert.equal(deck.components.size, 2);
  assert.ok(deck.components.has("METHANOL"));
  assert.ok(deck.components.has("WATER"));
  assert.equal(deck.components.get("METHANOL")?.formula, "CH4O");

  // Flowsheet
  assert.equal(deck.flowsheet.length, 3);
  const flashEntry = deck.flowsheet.find((f) => f.blockId === "FLASH1");
  assert.ok(flashEntry);
  assert.deepEqual(flashEntry.inlets, ["FEED"]);
  assert.deepEqual(flashEntry.outlets, ["VAP1", "LIQ1"]);

  // Stream FEED
  const feed = deck.streams.get("FEED");
  assert.ok(feed);
  assert.equal(feed.temperature, 65.0);
  assert.equal(feed.pressure, 1.5);
  assert.equal(feed.moleFlow, 100.0);
  assert.equal(feed.moleFractions.get("METHANOL"), 0.5);
  assert.equal(feed.moleFractions.get("WATER"), 0.5);

  // Blocks
  const flash1 = deck.blocks.get("FLASH1");
  assert.ok(flash1);
  assert.equal(flash1.type, "FLASH2");
  assert.equal(flash1.params["TEMP"], 75.0);
  assert.equal(flash1.params["PRES"], 1.2);

  const col1 = deck.blocks.get("COL1");
  assert.ok(col1);
  assert.equal(col1.type, "RADFRAC");
  assert.equal(col1.nStages, 15);
  assert.equal(col1.colSpecs?.["RR"], 2.5);
  assert.equal(col1.feedStages?.[0]?.stream, "VAP1");
  assert.equal(col1.feedStages?.[0]?.stage, 8);
});

test("Aspen Serializer: round-trips deck back to valid Aspen syntax", () => {
  const deck = parseAspen(VALID_ASPEN_DECK);
  const serialized = serializeAspen(deck);
  const reParsed = parseAspen(serialized);

  assert.equal(reParsed.title, deck.title);
  assert.equal(reParsed.units, deck.units);
  assert.equal(reParsed.propertyMethod, deck.propertyMethod);
  assert.equal(reParsed.components.size, deck.components.size);
  assert.equal(reParsed.flowsheet.length, deck.flowsheet.length);
  assert.equal(reParsed.streams.size, deck.streams.size);
  assert.equal(reParsed.blocks.size, deck.blocks.size);
});

test("Aspen Linter: detects unconnected stream inlet (M8101)", () => {
  const badDeckText = `FLOWSHEET
    BLOCK FLASH1 IN=GHOST_STREAM OUT=VAP1 LIQ1
`;
  const deck = parseAspen(badDeckText);
  const diags = lintAspen(deck);

  const m8101 = diags.find((d) => d.code === "M8101");
  assert.ok(m8101, "Expected M8101 for unconnected stream");
  assert.match(m8101.message, /Stream 'GHOST_STREAM' connected to block 'FLASH1' inlet has no producing source/);
});

test("Aspen Linter: detects negative component mole fraction (M8104)", () => {
  const badDeckText = `COMPONENTS
    ETHANOL C2H6O
    WATER   H2O

STREAM FEED
    SUBSTREAM MIXED TEMP=25.0 PRES=1.0 MOLE-FLOW=50.0
    MOLE-FRAC ETHANOL -0.2 / WATER 1.2
`;
  const deck = parseAspen(badDeckText);
  const diags = lintAspen(deck);

  const m8104 = diags.find((d) => d.code === "M8104");
  assert.ok(m8104, "Expected M8104 for negative component fraction");
  assert.match(m8104.message, /specifies negative component molar fraction for 'ETHANOL'/);
});

test("Aspen Linter: detects fractions sum invalid (M8108)", () => {
  const badDeckText = `STREAM FEED
    SUBSTREAM MIXED TEMP=25.0 PRES=1.0 MOLE-FLOW=50.0
    MOLE-FRAC A 0.4 / B 0.4
`;
  const deck = parseAspen(badDeckText);
  const diags = lintAspen(deck);

  const m8108 = diags.find((d) => d.code === "M8108");
  assert.ok(m8108, "Expected M8108 for sum != 1.0");
  assert.match(m8108.message, /mole fractions in stream 'FEED' sum to 0.8000, expected 1.0/);
});

test("Aspen Linter: detects RadFrac feed stage out of range (M8109)", () => {
  const badDeckText = `FLOWSHEET
    BLOCK COL1 IN=FEED OUT=D B

BLOCK COL1 RADFRAC
    PARAM NSTAGE=10
    FEED FEED 25
`;
  const deck = parseAspen(badDeckText);
  const diags = lintAspen(deck);

  const m8109 = diags.find((d) => d.code === "M8109");
  assert.ok(m8109, "Expected M8109 for feed stage out of range");
  assert.match(m8109.message, /Column 'COL1' feed stage 25 is out of bounds \(1\.\.10\)/);
});

test("Aspen Linter: detects negative temperature and pressure (M8112 & M8113)", () => {
  const badDeckText = `IN-UNITS SI
STREAM S1
    SUBSTREAM MIXED TEMP=-50.0 PRES=-2.0
`;
  const deck = parseAspen(badDeckText);
  const diags = lintAspen(deck);

  const m8112 = diags.find((d) => d.code === "M8112");
  assert.ok(m8112, "Expected M8112 for negative absolute temperature");

  const m8113 = diags.find((d) => d.code === "M8113");
  assert.ok(m8113, "Expected M8113 for negative pressure");
});

test("Aspen Linter: detects circular flowsheet without tear stream (M8102)", () => {
  const cycleDeckText = `FLOWSHEET
    BLOCK B1 IN=S3 OUT=S1
    BLOCK B2 IN=S1 OUT=S2
    BLOCK B3 IN=S2 OUT=S3
`;
  const deck = parseAspen(cycleDeckText);
  const diags = lintAspen(deck);

  const m8102 = diags.find((d) => d.code === "M8102");
  assert.ok(m8102, "Expected M8102 for circular flowsheet");
  assert.match(m8102.message, /Circular flowsheet loop detected/);
});

test("Aspen Flash Solver: solves Rachford-Rice VLE for Methanol-Water mixture", () => {
  const result = solveFlashRachfordRice({
    temperature: 75.0, // Celsius
    pressure: 0.7, // bar (within VLE two-phase envelope)
    components: ["METHANOL", "WATER"],
    moleFractions: [0.5, 0.5],
    totalFlow: 100.0,
  });

  assert.equal(result.state, "TWO_PHASE");
  assert.ok(result.vaporFraction > 0.0 && result.vaporFraction < 1.0);
  assert.equal(result.liquidFractions.length, 2);
  assert.equal(result.vaporFractions.length, 2);

  // Methanol is more volatile than water -> y_methanol > x_methanol
  assert.ok(result.vaporFractions[0]! > result.liquidFractions[0]!);

  // Conservation of mass: F = L + V
  assert.ok(Math.abs(result.liquidFlow + result.vaporFlow - 100.0) < 1e-4);

  // Sum of mole fractions should be 1.0
  const sumX = result.liquidFractions.reduce((a, b) => a + b, 0);
  const sumY = result.vaporFractions.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumX - 1.0) < 1e-4);
  assert.ok(Math.abs(sumY - 1.0) < 1e-4);
});

test("Aspen Flash Solver: correctly detects subcooled liquid state", () => {
  const result = solveFlashRachfordRice({
    temperature: 10.0, // Low temperature
    pressure: 5.0, // High pressure
    components: ["METHANOL", "WATER"],
    moleFractions: [0.5, 0.5],
    totalFlow: 100.0,
  });

  assert.equal(result.state, "SUBCOOLED_LIQUID");
  assert.equal(result.vaporFraction, 0.0);
  assert.equal(result.liquidFlow, 100.0);
  assert.equal(result.vaporFlow, 0.0);
});

test("Aspen DAE Lowering: builds valid linear memory DAEBuilder arena", () => {
  const deck = parseAspen(VALID_ASPEN_DECK);
  const dae = lowerAspenToDae(deck);

  assert.ok(dae.variables().length > 10, "Expected at least 10 state variables");
  assert.ok(dae.equations().length > 5, "Expected at least 5 equations");
  assert.equal(
    dae.variables().length,
    dae.equations().length,
    "Expected structurally square DAE system (N_vars === N_eqs)",
  );

  // Verify stream state variables
  assert.ok(dae.lookupVariable("F_FEED") !== -1);
  assert.ok(dae.lookupVariable("T_FEED") !== -1);
  assert.ok(dae.lookupVariable("P_FEED") !== -1);
  assert.ok(dae.lookupVariable("F_FEED_METHANOL") !== -1);
  assert.ok(dae.lookupVariable("F_FEED_WATER") !== -1);

  // Verify flash variables
  assert.ok(dae.lookupVariable("psi_FLASH1") !== -1);
  assert.ok(dae.lookupVariable("Q_FLASH1") !== -1);

  // Verify pump variables
  assert.ok(dae.lookupVariable("W_pump_PUMP1") !== -1);
});

test("Aspen Linter: detects duplicate component ID (M8107) and missing EOS properties (M8103)", () => {
  const badDeckText = `COMPONENTS
    METHANOL CH4O
    METHANOL CH4O
    MYSTERY_CHEM XYZ99
PROPERTIES PENG-ROB
`;
  const deck = parseAspen(badDeckText);
  const diags = lintAspen(deck);

  const m8107 = diags.find((d) => d.code === "M8107");
  assert.ok(m8107, "Expected M8107 for duplicate component ID");
  assert.match(m8107.message, /Duplicate component ID 'METHANOL'/);

  const m8103 = diags.find((d) => d.code === "M8103");
  assert.ok(m8103, "Expected M8103 for unknown component lacking critical properties");
  assert.match(m8103.message, /Component 'MYSTERY_CHEM' lacks critical properties for property method 'PENG-ROB'/);
});

test("Aspen Flash Solver: solves non-ideal NRTL VLE flash with liquid activity coefficients", () => {
  const res = solveFlashRachfordRice({
    temperature: 78.0,
    pressure: 0.9,
    components: ["ETHANOL", "WATER"],
    moleFractions: [0.4, 0.6],
    totalFlow: 100.0,
    propertyMethod: "NRTL",
  });

  assert.equal(res.activityCoefficients.length, 2);
  // Ethanol-water exhibits positive deviation from Raoult's Law (gamma_i > 1)
  assert.ok(res.activityCoefficients[0]! > 1.0, "Expected ethanol NRTL activity coefficient > 1");
  assert.ok(res.activityCoefficients[1]! > 1.0, "Expected water NRTL activity coefficient > 1");
  assert.equal(res.state, "TWO_PHASE");
  assert.ok(res.vaporFraction > 0.0 && res.vaporFraction < 1.0);
});

test("Aspen Modelica Projection: generates syntactically valid Modelica 3.x code", () => {
  const deck = parseAspen(VALID_ASPEN_DECK);
  const moCode = aspenToModelica(deck);

  assert.match(moCode, /model METHANOL_WATER_FLASH_AND_SEPARATION/);
  assert.match(moCode, /import Modelica\.Units\.SI;/);
  assert.match(moCode, /SI\.MolarFlowRate F_FEED/);
  assert.match(moCode, /F_FEED = F_VAP1 \+ F_LIQ1;/);
  assert.match(moCode, /end METHANOL_WATER_FLASH_AND_SEPARATION;/);
});

test("Aspen Workspace Index: indexes multi-file symbols accurately", () => {
  const index = new AspenWorkspaceIndex();
  const uri = "file:///workspace/plant.in";
  const symIdx = index.indexFile(uri, VALID_ASPEN_DECK);

  assert.ok(index.has(uri));
  assert.ok(symIdx.symbols.size > 0);

  // Name based lookup
  assert.ok(symIdx.byName.has("METHANOL"));
  assert.ok(symIdx.byName.has("FLASH1"));
  assert.ok(symIdx.byName.has("FEED"));
});
