// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, Variability, initBltWasm, performBltTransformationArena } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DYR_MODEL_SCHEMAS,
  DYR_SCHEMA_LIST,
  EXACT_LOWERED_MODELS,
  calculateSotaDiscrepancy,
  getDyrModelLoweringTier,
  lintPsse,
  lowerPsseComponentToDae,
  parseDyr,
  parseRaw,
  simulatePsseTransient,
  solveQvCurve,
  validatePsse,
} from "../src/index.js";

describe("PSS/E Standard Model Library Schema Completeness & Structural DAE Balance", () => {
  it("exposes >= 350 clean-room standard PSS/E Model Library schemas with valid metadata", () => {
    const count = DYR_SCHEMA_LIST.length;
    assert.ok(count >= 350, `Expected >= 350 schemas in DYR_MODEL_SCHEMAS, found ${count}`);

    for (const schema of DYR_SCHEMA_LIST) {
      assert.ok(schema.model.length >= 2, `Invalid model name: ${schema.model}`);
      assert.ok(schema.title.trim().length > 5, `Missing title on ${schema.model}`);
      assert.ok(schema.description.trim().length > 10, `Missing description on ${schema.model}`);
      assert.ok(schema.params.length >= 1, `Expected >= 1 parameter on ${schema.model}`);
      assert.ok(schema.daeArchetype.length > 3, `Missing daeArchetype on ${schema.model}`);
      for (const pm of schema.params) {
        assert.ok(pm.name.length > 0, `Empty param name on ${schema.model}`);
        assert.ok(pm.unit.length > 0, `Empty param unit on ${schema.model}.${pm.name}`);
      }
    }

    // Spot-check key IEEE 421.5, WECC, IEC, and relay schemas
    for (const required of [
      "GENROU",
      "GENSAL",
      "GENTPJ",
      "GENCLS",
      "ESDC1A",
      "ESAC1A",
      "ESAC8B",
      "ESST1A",
      "ESST4B",
      "MAXEX1",
      "UEL1",
      "VHZL1",
      "COMP",
      "IEEEG1",
      "HYGOV",
      "PIDGOV",
      "GGOV1",
      "LCFB1",
      "PSS2A",
      "PSS2B",
      "PSS4B",
      "REGC_A",
      "REGCA1",
      "REEC_A",
      "REEC_C",
      "REPC_A",
      "DER_A",
      "REGFM_A1",
      "CMPLDW",
      "CIM5BL",
      "IEELAL",
      "SVSMO1",
      "SVSMO3",
      "CDC4T",
      "VSC_DC",
      "LDSHBL",
      "LVSHBL",
      "DISTRL",
      "FRQTPAT",
      "BUSFRQ",
    ]) {
      assert.ok(DYR_MODEL_SCHEMAS[required], `Missing required standard schema: ${required}`);
    }
  });

  it("lowers 100% of all standard DYR_MODEL_SCHEMAS into structurally square, BLT-causalizable DAEBuilder arenas", async () => {
    await initBltWasm();
    for (const schema of DYR_SCHEMA_LIST) {
      const dae = new DAEBuilder(undefined, `Test_${schema.model}`);
      lowerPsseComponentToDae(dae, schema.model, "u1");
      let nonParamVars = 0;
      for (let i = 0; i < dae.getVarCount(); i++) {
        if (dae.getVarVariability(i) !== Variability.Parameter) nonParamVars++;
      }
      assert.ok(nonParamVars > 0, `${schema.model} produced 0 continuous DAE variables`);
      assert.equal(
        nonParamVars,
        dae.getEqCount(),
        `Structural imbalance on ${schema.model}: ${nonParamVars} continuous vars vs ${dae.getEqCount()} eqs`,
      );
      const blt = performBltTransformationArena(dae);
      assert.equal(
        blt.sortedEquations.length,
        dae.getEqCount(),
        `BLT causalization mismatch on ${schema.model}: sorted ${blt.sortedEquations.length} vs ${dae.getEqCount()} eqs`,
      );
    }
  });

  it("enforces P5013-P5019 ICON, physical bounds, saturation, load-fraction, and remote-bus lints", () => {
    const raw = `0, 100.0, 33, 0, 1, 60.0 / LINT TEST
TEST CASE
LINT
1, 'BUS1', 138.0, 3, 1, 1, 1, 1.02, 0.0
2, 'BUS2', 138.0, 1, 1, 1, 1, 1.00, 0.0
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 50.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 50.0, 10.0, 100.0, -50.0, 1.02, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01, 0.1, 0.0, 100.0, 100.0, 100.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
Q
`;
    const c = parseRaw(raw);
    c.dyr = parseDyr(`
1 'GENROU' '1' 6.5 0.035 1.0 0.05 4.5 1.0 1.8 1.7 0.3 0.55 0.2 0.14 0.40 0.20 /
1 'REEC_A' '1' 999 0 1 1 9 0.85 1.15 0.01 -0.05 0.05 2.0 1.05 -1.05 1.0 0.0 0.0 0.0 0.05 0.436 -0.436 1.1 0.9 0.0 0.1 0.0 40.0 0.0 0.02 99.0 -99.0 1.0 0.0 1.3 0.02 /
2 'CMPLDW' '1' 1 1.0 0.04 0.04 1.0 0.4 0.4 0.4 0.2 0.1 0.6 0.033 0.12 0.12 0.08 30.0 5.0 /
'MISSING_DC' 'CDC4T' 5.0 15.0 0.02 0.02 0.35 100.0 0.3 350.0 1.0 /
`);

    const rawDiags = lintPsse(c);
    const codes = new Set(rawDiags.map((d) => d.code));
    assert.ok(codes.has("P5013"), "Expected P5013 on invalid pqflag=9");
    assert.ok(codes.has("P5016"), "Expected P5016 on S10=0.4 > S12=0.2");
    assert.ok(codes.has("P5017"), "Expected P5017 on CMPLDW fraction sum > 1");
    assert.ok(codes.has("P5018"), "Expected P5018 on remote bus 999 not found");
    assert.ok(codes.has("P5019"), "Expected P5019 on missing DC link MISSING_DC");

    const lspDiags = validatePsse(
      `1 'REEC_A' '1' 999 0 1 1 9 0.85 1.15 0.01 -0.05 0.05 2.0 1.05 -1.05 1.0 0.0 0.0 0.0 0.05 0.436 -0.436 1.1 0.9 0.0 0.1 0.0 40.0 0.0 0.02 99.0 -99.0 1.0 0.0 1.3 0.02 /`,
      "test.dyr",
    );
    assert.ok(
      lspDiags.some((d) => d.code === "P5013"),
      "Expected P5013 from validatePsse(.dyr)",
    );
  });

  it("tracks 100% (366/366) of DYR_SCHEMA_LIST in EXACT_LOWERED_MODELS", () => {
    assert.equal(
      EXACT_LOWERED_MODELS.size,
      DYR_SCHEMA_LIST.length,
      `Expected 100% parity (${DYR_SCHEMA_LIST.length}), got ${EXACT_LOWERED_MODELS.size}`,
    );
    for (const schema of DYR_SCHEMA_LIST) {
      assert.ok(EXACT_LOWERED_MODELS.has(schema.model), `Schema ${schema.model} missing from EXACT_LOWERED_MODELS`);
    }
  });

  it("holds steady-state flat-run equilibrium with zero disturbance on GENROU + ESST1A + TGOV1 + PSS2A", () => {
    const raw = `0, 100.0, 33, 0, 1, 60.0 / FLAT RUN TEST
FLAT RUN
TEST
1, 'GEN1', 138.0, 3, 1, 1, 1, 1.02, 0.0
2, 'LOAD2', 138.0, 1, 1, 1, 1, 1.00, -2.0
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 50.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 50.0, 10.0, 100.0, -50.0, 1.02, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01, 0.05, 0.0, 200.0, 200.0, 200.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
Q
`;
    const c = parseRaw(raw);
    c.dyr = parseDyr(`
1 'GENROU' '1' 6.5 0.035 1.0 0.05 4.5 0.0 1.8 1.7 0.3 0.55 0.2 0.14 0.05 0.15 /
1 'ESST1A' '1' 0.02 0.0 0.0 1.0 1.0 0.0 0.0 200.0 0.02 5.0 -5.0 5.0 -5.0 0.05 0.0 1.0 0.0 0.0 0.0 /
1 'TGOV1' '1' 0.05 0.5 1.05 0.0 2.1 7.0 0.0 /
1 'PSS2A' '1' 1 1 5.0 5.0 0.0 5.0 0.0 10.0 0.5 0.1 0.5 1.0 0.25 0.04 0.15 0.03 0.0 0.0 0.1 -0.1 /
`);
    const sim = simulatePsseTransient(c, {
      stopTime: 2.0,
      timeStep: 0.01,
      faultStartSec: 999.0,
      faultClearSec: 999.0,
    });
    assert.ok(sim.summary.convergedPowerFlow, "Flat-run power flow should converge");
    assert.ok(sim.summary.stable, "Flat-run simulation should remain stable");
    assert.ok(
      sim.summary.maxFreqDeviationHz < 0.05,
      `Expected minimal flat-run frequency drift, got ${sim.summary.maxFreqDeviationHz} Hz`,
    );
  });

  it("executes multi-event sequences (bus_fault, clear_fault, shed_load, step_reference) in simulatePsseTransient", () => {
    const raw = `0, 100.0, 33, 0, 1, 60.0 / MULTI-EVENT TEST
MULTI EVENT
TEST
1, 'GEN1', 138.0, 3, 1, 1, 1, 1.02, 0.0
2, 'LOAD2', 138.0, 1, 1, 1, 1, 1.00, -2.0
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 60.0, 15.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 60.0, 15.0, 100.0, -50.0, 1.02, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01, 0.05, 0.0, 200.0, 200.0, 200.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
Q
`;
    const c = parseRaw(raw);
    const sim = simulatePsseTransient(c, {
      stopTime: 1.5,
      timeStep: 0.01,
      events: [
        { timeSec: 0.1, type: "bus_fault", busNumber: 2 },
        { timeSec: 0.2, type: "clear_fault" },
        { timeSec: 0.25, type: "shed_load", busNumber: 2, loadScale: 0.8 },
        { timeSec: 0.3, type: "step_reference", busNumber: 1, pmechStepPu: 0.02 },
      ],
    });
    assert.ok(sim.summary.convergedPowerFlow, "Multi-event power flow should converge");
    assert.ok(sim.summary.minBusVoltagePu < 0.95, "Fault at Bus 2 should depress voltage");
    assert.ok(sim.t.length >= 150, "Expected >= 150 time steps");
  });

  it("verifies SOTA NRMSE & Theil TIC trajectory parity across DYR variants (GENROU vs GENROE)", () => {
    const raw = `0, 100.0, 33, 0, 1, 60.0 / NRMSE BENCHMARK
NRMSE
TEST
1, 'GEN1', 138.0, 3, 1, 1, 1, 1.02, 0.0
2, 'LOAD2', 138.0, 1, 1, 1, 1, 1.00, -2.0
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 50.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 50.0, 10.0, 100.0, -50.0, 1.02, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01, 0.05, 0.0, 200.0, 200.0, 200.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
Q
`;
    const c1 = parseRaw(raw);
    c1.dyr = parseDyr(`
1 'GENROU' '1' 6.5 0.035 1.0 0.05 4.5 0.0 1.8 1.7 0.3 0.55 0.2 0.14 0.05 0.15 /
1 'ESST1A' '1' 0.02 0.0 0.0 1.0 1.0 0.0 0.0 200.0 0.02 5.0 -5.0 5.0 -5.0 0.05 0.0 1.0 0.0 0.0 0.0 /
1 'TGOV1' '1' 0.05 0.5 1.05 0.0 2.1 7.0 0.0 /
`);
    const c2 = parseRaw(raw);
    c2.dyr = parseDyr(`
1 'GENROE' '1' 6.5 0.035 1.0 0.05 4.5 0.0 1.8 1.7 0.3 0.55 0.2 0.14 0.05 0.15 /
1 'ESST1A' '1' 0.02 0.0 0.0 1.0 1.0 0.0 0.0 200.0 0.02 5.0 -5.0 5.0 -5.0 0.05 0.0 1.0 0.0 0.0 0.0 /
1 'TGOV1' '1' 0.05 0.5 1.05 0.0 2.1 7.0 0.0 /
`);
    const s1 = simulatePsseTransient(c1, {
      stopTime: 1.5,
      timeStep: 0.01,
      faultBus: 2,
      faultStartSec: 0.1,
      faultClearSec: 0.2,
    });
    const s2 = simulatePsseTransient(c2, {
      stopTime: 1.5,
      timeStep: 0.01,
      faultBus: 2,
      faultStartSec: 0.1,
      faultClearSec: 0.2,
    });
    const vKey = s1.states.find((k) => k.startsWith("vt_")) ?? s1.states[0]!;
    const metrics = calculateSotaDiscrepancy(s1.variables[vKey]!, s2.variables[vKey]!);
    assert.ok(metrics.theilTic < 0.05, `Expected Theil TIC < 0.05, got ${metrics.theilTic}`);
    assert.ok(metrics.pearsonR > 0.95, `Expected Pearson r > 0.95, got ${metrics.pearsonR}`);
  });

  it("verifies honest loweringTier classification, solverMode: dae_ida, and solveQvCurve", () => {
    assert.equal(getDyrModelLoweringTier("GENROU"), "canonical_exact");
    assert.equal(getDyrModelLoweringTier("GENCC"), "archetype_mapped");
    assert.equal(getDyrModelLoweringTier("NONEXISTENT_MODEL_XYZ"), "unmapped");

    const raw = `0, 100.0, 33, 0, 1, 60.0 / PHASE B TEST
PHASE B
TEST
1, 'GEN1', 138.0, 3, 1, 1, 1, 1.02, 0.0
2, 'LOAD2', 138.0, 1, 1, 1, 1, 1.00, -2.0
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 50.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 50.0, 10.0, 100.0, -50.0, 1.02, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01, 0.05, 0.0, 200.0, 200.0, 200.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
Q
`;
    const c = parseRaw(raw);
    c.dyr = parseDyr(`
1 'GENROU' '1' 6.5 0.035 1.0 0.05 4.5 0.0 1.8 1.7 0.3 0.55 0.2 0.14 0.05 0.15 /
1 'TGOV1' '1' 0.05 0.5 1.05 0.0 2.1 7.0 0.0 /
`);

    const daeRes = simulatePsseTransient(c, {
      solverMode: "dae_ida",
      stopTime: 0.4,
      timeStep: 0.02,
      events: [{ timeSec: 0.1, type: "shed_load", busNumber: 2, loadScale: 0.8 }],
    });
    assert.ok(daeRes.t.length > 10, "Expected dae_ida time points");
    assert.ok(daeRes.variables["Bus_2_Vm"]!.length === daeRes.t.length);

    const qv = solveQvCurve(c, 2, { vStartPu: 1.05, vEndPu: 0.85, vStepPu: 0.05 });
    assert.equal(qv.targetBus, 2);
    assert.ok(qv.points.length >= 4, "Expected Q-V curve points");
    assert.ok(qv.reportText.includes("Q-V REACTIVE POWER MARGIN CURVE"));
  });
});
