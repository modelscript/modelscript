// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAsmPlant } from "../src/parser/asm-parser.js";

describe("IWA ASM Wastewater Plant Parser", () => {
  const sampleBsm1 = `plant Benchmark_BSM1 {
  model: ASM1;

  influent {
    flow: 18446.0 m3/day;
    S_S: 69.5;
    S_I: 30.0;
    X_I: 51.2;
    X_S: 202.32;
    X_BH: 28.17;
    S_NH: 31.56;
    S_NO: 0.0;
    S_ND: 6.95;
    X_ND: 10.59;
    S_ALK: 7.0;
  }

  recycle {
    internal_ratio: 3.0;
    sludge_ratio: 1.0;
    waste_flow: 385.0 m3/day;
  }

  bioreactor ANOXIC_1 {
    type: Anoxic;
    volume: 1000.0 m3;
    kla: 0.0;
  }

  bioreactor ANOXIC_2 {
    type: Anoxic;
    volume: 1000.0 m3;
    kla: 0.0;
  }

  bioreactor AEROBIC_3 {
    type: Aerobic;
    volume: 1333.0 m3;
    kla: 240.0;
    do_target: 2.0;
  }

  bioreactor AEROBIC_4 {
    type: Aerobic;
    volume: 1333.0 m3;
    kla: 240.0;
    do_target: 2.0;
  }

  bioreactor AEROBIC_5 {
    type: Aerobic;
    volume: 1333.0 m3;
    kla: 84.0;
    do_target: 2.0;
  }

  clarifier SECONDARY_CLARIFIER {
    area: 1500.0 m2;
    depth: 4.0 m;
    layers: 10;
    feed_layer: 5;
  }
}`;

  it("should parse plant configuration and global hydraulics", () => {
    const plant = parseAsmPlant(sampleBsm1);
    assert.equal(plant.name, "Benchmark_BSM1");
    assert.equal(plant.modelType, "ASM1");
    assert.equal(plant.influentFlowM3Day, 18446.0);
    assert.equal(plant.internalRecycleRatio, 3.0);
    assert.equal(plant.sludgeRecycleRatio, 1.0);
    assert.equal(plant.wasteFlowM3Day, 385.0);

    assert.equal(plant.influentConcentrations["S_S"], 69.5);
    assert.equal(plant.influentConcentrations["S_NH"], 31.56);
  });

  it("should parse bioreactors and aeration parameters", () => {
    const plant = parseAsmPlant(sampleBsm1);
    assert.equal(plant.reactors.length, 5);

    const anox1 = plant.reactors[0]!;
    assert.equal(anox1.name, "ANOXIC_1");
    assert.equal(anox1.type, "Anoxic");
    assert.equal(anox1.volumeM3, 1000.0);
    assert.equal(anox1.klaHr, 0.0);

    const aero3 = plant.reactors[2]!;
    assert.equal(aero3.name, "AEROBIC_3");
    assert.equal(aero3.type, "Aerobic");
    assert.equal(aero3.volumeM3, 1333.0);
    assert.equal(aero3.klaHr, 240.0);
    assert.equal(aero3.doTargetMgL, 2.0);
  });

  it("should parse secondary clarifier geometry", () => {
    const plant = parseAsmPlant(sampleBsm1);
    assert.equal(plant.clarifiers.length, 1);

    const clarifier = plant.clarifiers[0]!;
    assert.equal(clarifier.name, "SECONDARY_CLARIFIER");
    assert.equal(clarifier.surfaceAreaM2, 1500.0);
    assert.equal(clarifier.heightM, 4.0);
    assert.equal(clarifier.layers, 10);
    assert.equal(clarifier.feedLayer, 5);
  });
});
