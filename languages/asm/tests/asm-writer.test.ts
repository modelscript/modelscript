// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAsmPlant } from "../src/parser/asm-parser.js";
import { writeAsmPlant } from "../src/parser/asm-writer.js";
import type { AsmPlantModel } from "../src/types.js";

describe("IWA ASM Plant Writer & Roundtrip Serialization", () => {
  const initialPlant: AsmPlantModel = {
    name: "MUNICIPAL_WRRF",
    modelType: "ASM1",
    influentFlowM3Day: 20000.0,
    influentConcentrations: {
      S_S: 80.0,
      S_NH: 35.0,
      X_BH: 30.0,
    },
    internalRecycleRatio: 2.5,
    sludgeRecycleRatio: 0.8,
    wasteFlowM3Day: 400.0,
    reactors: [
      {
        name: "ANOXIC_TANK",
        type: "Anoxic",
        volumeM3: 1500.0,
      },
      {
        name: "AERATION_TANK",
        type: "Aerobic",
        volumeM3: 3500.0,
        klaHr: 180.0,
        doTargetMgL: 2.0,
      },
    ],
    clarifiers: [
      {
        name: "FINAL_CLARIFIER",
        surfaceAreaM2: 1200.0,
        heightM: 4.5,
        layers: 10,
        feedLayer: 5,
        v0: 474.0,
        v0Prime: 250.0,
        rh: 0.000576,
        rp: 0.00286,
        fns: 0.00228,
      },
    ],
  };

  it("should serialize plant model to valid ASM DSL text", () => {
    const text = writeAsmPlant(initialPlant);
    assert.ok(text.includes("plant MUNICIPAL_WRRF"));
    assert.ok(text.includes("model: ASM1"));
    assert.ok(text.includes("flow: 20000.0 m3/day"));
    assert.ok(text.includes("internal_ratio: 2.50"));
    assert.ok(text.includes("bioreactor ANOXIC_TANK"));
    assert.ok(text.includes("bioreactor AERATION_TANK"));
    assert.ok(text.includes("clarifier FINAL_CLARIFIER"));
  });

  it("should parse back serialized text without data loss", () => {
    const text = writeAsmPlant(initialPlant);
    const parsed = parseAsmPlant(text);

    assert.equal(parsed.name, "MUNICIPAL_WRRF");
    assert.equal(parsed.modelType, "ASM1");
    assert.equal(parsed.influentFlowM3Day, 20000.0);
    assert.equal(parsed.internalRecycleRatio, 2.5);
    assert.equal(parsed.reactors.length, 2);
    assert.equal(parsed.reactors[1]?.klaHr, 180.0);
    assert.equal(parsed.clarifiers.length, 1);
    assert.equal(parsed.clarifiers[0]?.surfaceAreaM2, 1200.0);
  });
});
