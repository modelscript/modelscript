// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintAsmPlant } from "../src/lints/index.js";
import { parseAsmPlant } from "../src/parser/asm-parser.js";

describe("IWA ASM Diagnostic Linter", () => {
  it("should flag ASM2001 when a bioreactor has non-positive volume", () => {
    const zeroVolText = `plant TEST_PLANT {
  bioreactor BAD_TANK {
    type: Anoxic;
    volume: 0.0 m3;
  }
}`;
    const plant = parseAsmPlant(zeroVolText);
    const diags = lintAsmPlant(plant);
    const asm2001 = diags.find((d) => d.code === "ASM2001");
    assert.ok(asm2001, "Expected ASM2001 for non-positive reactor volume");
  });

  it("should flag ASM2002 when an aerobic reactor lacks aeration", () => {
    const noKlaText = `plant TEST_PLANT {
  bioreactor NO_AIR {
    type: Aerobic;
    volume: 1000.0 m3;
    kla: 0.0;
  }
}`;
    const plant = parseAsmPlant(noKlaText);
    const diags = lintAsmPlant(plant);
    const asm2002 = diags.find((d) => d.code === "ASM2002");
    assert.ok(asm2002, "Expected ASM2002 for aerobic reactor without aeration");
  });

  it("should flag ASM3001 when an influent concentration is negative", () => {
    const negConcText = `plant TEST_PLANT {
  influent {
    S_S: -50.0;
  }
}`;
    const plant = parseAsmPlant(negConcText);
    const diags = lintAsmPlant(plant);
    const asm3001 = diags.find((d) => d.code === "ASM3001");
    assert.ok(asm3001, "Expected ASM3001 for negative concentration");
  });

  it("should flag ASM4001 when a clarifier has non-positive dimensions", () => {
    const badClarifierText = `plant TEST_PLANT {
  clarifier ZERO_AREA {
    area: 0.0 m2;
    depth: 4.0 m;
  }
}`;
    const plant = parseAsmPlant(badClarifierText);
    const diags = lintAsmPlant(plant);
    const asm4001 = diags.find((d) => d.code === "ASM4001");
    assert.ok(asm4001, "Expected ASM4001 for zero clarifier surface area");
  });
});
