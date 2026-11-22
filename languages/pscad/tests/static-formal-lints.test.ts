// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  extractEmtNetlist,
  lintPscx,
  parsePscx,
  runPscadFastStaticLints,
  runPscadFormalVerificationLints,
  type EmtControlBlock,
  type EmtNetlist,
  type PscxProject,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PSCAD_FIXTURES = path.resolve(__dirname, "./fixtures");

test("PSCAD Tier 1 fast static lints (M6084-M6088) detect algebraic loops, voltage-source loops, dead/positive feedback, unbounded PI, and UDM div-by-zero", () => {
  const controlBlocks: EmtControlBlock[] = [
    // Zero-delay algebraic loop: G1 -> SUM1 -> G1
    { id: "G1", kind: "gain", inputs: ["SUM1"], params: { gain: 2.0 } },
    { id: "SUM1", kind: "sum", inputs: ["G1", "REF"], params: {} },
    // Dead zero-gain branch
    { id: "DEAD_G", kind: "gain", inputs: ["REF"], params: { gain: 0 } },
    // Unbounded PI integrator (missing anti-windup limits)
    { id: "PI_UNBOUND", kind: "pi", inputs: ["ERR"], params: { kp: 1.0, ki: 10.0 } },
  ];

  const netlist: EmtNetlist = {
    buses: new Map([["B1", { id: "B1", name: "B1", baseKv: 230, phaseCount: 3, connectedBranchIds: [] }]]),
    branches: [
      { id: "C_LOOP", kind: "rlc", fromBus: "B1", toBus: "GND", resistanceOhm: 0, inductanceH: 0, capacitanceF: 1e-6 },
    ],
    transformers: [],
    transmissionLines: [],
    fmuInstances: [],
    sources: [
      {
        id: "SRC1",
        name: "SRC1",
        bus: "B1",
        vPeakKv: 187.8,
        frequencyHz: 60,
        phaseRad: 0,
        mvaRating: 100,
        rSourceOhm: 0,
        lSourceH: 0,
      },
      {
        id: "SRC2",
        name: "SRC2",
        bus: "B1",
        vPeakKv: 187.8,
        frequencyHz: 60,
        phaseRad: 0,
        mvaRating: 100,
        rSourceOhm: 0,
        lSourceH: 0,
      },
    ],
    controlBlocks,
    nominalFrequencyHz: 60,
  };

  const proj: PscxProject = {
    name: "FaultyUdmTest",
    version: "5.0",
    settings: { timeStepUs: 50, durationSec: 0.1, startType: "flat", frequencyHz: 60 },
    rootModule: { id: "Main", name: "Main", buses: [], components: [], wires: [] },
    subModules: new Map(),
    linkedLibraries: [],
    definitions: new Map([
      [
        "BadUdm",
        {
          name: "BadUdm",
          ports: [],
          scriptSegments: new Map([
            [
              "Fortran",
              {
                name: "Fortran",
                content: "      X = 0.0\n      Y = 1.0 / X\n",
                startLine: 10,
              },
            ],
          ]),
        },
      ],
    ]),
  };

  const diags = runPscadFastStaticLints(proj, netlist);
  const codes = new Set(diags.map((d) => d.code));

  assert.ok(codes.has("M6084"), `Expected M6084 algebraic loop, got [${[...codes].join(", ")}]`);
  assert.ok(codes.has("M6085"), `Expected M6085 high-index singularity, got [${[...codes].join(", ")}]`);
  assert.ok(codes.has("M6086"), `Expected M6086 dead/positive feedback, got [${[...codes].join(", ")}]`);
  assert.ok(codes.has("M6087"), `Expected M6087 HC4 unbounded PI saturation, got [${[...codes].join(", ")}]`);
  assert.ok(codes.has("M6088"), `Expected M6088 UDM div-by-zero hazard, got [${[...codes].join(", ")}]`);
});

test("PSCAD Tier 2 formal verification lints (M6089-M6091) detect Star-Set IBR FRT headroom violation, DDE delay instability, and Zeno switch conflict", () => {
  const netlist: EmtNetlist = {
    buses: new Map([["B1", { id: "B1", name: "B1", baseKv: 230, phaseCount: 3, connectedBranchIds: [] }]]),
    branches: [
      {
        id: "SW_ZENO",
        kind: "switch",
        fromBus: "B1",
        toBus: "GND",
        resistanceOhm: 0.01,
        inductanceH: 0,
        capacitanceF: 0,
        metadata: { closeTimeSec: 0.02, openTimeSec: 0.02 },
      },
    ],
    transformers: [],
    transmissionLines: [],
    fmuInstances: [],
    sources: [],
    controlBlocks: [
      { id: "IBR_CTRL", kind: "wecc_ibr", inputs: [], params: { iMaxPu: 0.9, kQv: 3.0 } },
      { id: "FAST_PLL", kind: "pll", inputs: [], params: { kp: 15.0, delaySec: 0.001 } },
    ],
    nominalFrequencyHz: 60,
  };

  const proj: PscxProject = {
    name: "FormalEmtTest",
    version: "5.0",
    settings: { timeStepUs: 50, durationSec: 0.1, startType: "flat", frequencyHz: 60 },
    rootModule: { id: "Main", name: "Main", buses: [], components: [], wires: [] },
    subModules: new Map(),
    linkedLibraries: [],
  };

  const diags = runPscadFormalVerificationLints(proj, netlist, 50e-6);
  const codes = new Set(diags.map((d) => d.code));

  assert.ok(codes.has("M6089"), `Expected M6089 Star-Set IBR FRT warning, got [${[...codes].join(", ")}]`);
  assert.ok(codes.has("M6090"), `Expected M6090 DDE delay instability, got [${[...codes].join(", ")}]`);
  assert.ok(codes.has("M6091"), `Expected M6091 SMT Zeno switch conflict, got [${[...codes].join(", ")}]`);
});

test("PSCAD fast static lints execute in < 20 ms on real IEEE9Bus_IBR_v2.pscx", () => {
  const xml = fs.readFileSync(path.join(PSCAD_FIXTURES, "IEEE9Bus_IBR_v2.pscx"), "utf-8");
  const proj = parsePscx(xml);
  const netlist = extractEmtNetlist(proj);

  const t0 = Date.now();
  const diags = runPscadFastStaticLints(proj, netlist);
  const elapsedMs = Date.now() - t0;

  assert.ok(elapsedMs < 20, `Expected IEEE9Bus_IBR_v2.pscx fast static lints < 20 ms, took ${elapsedMs} ms`);
  assert.equal(diags.filter((d) => d.severity === "error").length, 0);

  const integrated = lintPscx(proj, { tier: "fast", netlist });
  assert.ok(Array.isArray(integrated));
});
