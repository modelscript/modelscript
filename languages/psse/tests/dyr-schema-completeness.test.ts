// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, Variability, initBltWasm, performBltTransformationArena } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DYR_MODEL_SCHEMAS,
  DYR_SCHEMA_LIST,
  lintPsse,
  lowerPsseComponentToDae,
  parseDyr,
  parseRaw,
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
});
