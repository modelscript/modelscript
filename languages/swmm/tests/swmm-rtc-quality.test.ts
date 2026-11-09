// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeSwmmWaterQuality, parseSwmm, simulateSwmmRtc, type SwmmControlRule } from "../src/index.js";

describe("SWMM Real-Time Control (RTC) & Water Quality Engine", () => {
  const SAMPLE_SWMM_DECK = `[TITLE]
Combined Sewer Network with Controllable Gate and Subcatchment Washoff

[OPTIONS]
FLOW_UNITS           CMS
INFILTRATION         HORTON
FLOW_ROUTING         DYNWAVE

[JUNCTIONS]
;;Name           Elevation  MaxDepth   InitDepth  SurDepth   Aponded   
J1               15.0       3.0        0.5        0.0        0.0       
J2               14.0       3.0        0.5        0.0        0.0       
J_OVERFLOW       14.2       2.0        0.0        1.0        50.0      

[OUTFALLS]
;;Name           Elevation  Type       Stage Data       Gated    
OUT1             12.0       FREE                        NO       

[CONDUITS]
;;Name           From Node        To Node          Length     Roughness  InOffset   OutOffset  InitFlow   MaxFlow   
C1               J1               J2               100.0      0.013      0.0        0.0        0.0        0.0       
C_CSO            J2               J_OVERFLOW       50.0       0.015      0.0        0.0        0.0        0.0       
C_OUT            J2               OUT1             200.0      0.013      0.0        0.0        0.0        0.0       

[XSECTIONS]
;;Link           Shape        Geom1      Geom2      Geom3      Geom4      Barrels    Culvert   
C1               CIRCULAR     1.2        0.0        0.0        0.0        1                    
C_CSO            CIRCULAR     0.8        0.0        0.0        0.0        1                    
C_OUT            CIRCULAR     1.5        0.0        0.0        0.0        1                    

[SUBCATCHMENTS]
;;Name           Rain Gage        Outlet           Area     %Imperv  Width    %Slope   CurbLen 
SUB1             GAGE1            J1               5.0      65.0     250.0    1.5      0       
`;

  it("simulates Real-Time Control (RTC) rule triggering and CSO spill volume mitigation", () => {
    const deck = parseSwmm(SAMPLE_SWMM_DECK);

    const rules: SwmmControlRule[] = [
      {
        id: "RULE_THROTTLE_CSO",
        linkId: "C_CSO",
        linkType: "ORIFICE",
        actionSetting: 0.25, // throttle CSO gate to 25% when downstream is safe
        nodeId: "J2",
        operator: "<",
        thresholdDepth: 2.0,
      },
    ];

    const rtcResult = simulateSwmmRtc(deck, rules, {
      durationSeconds: 60,
      timeStepSeconds: 5,
      rainfallIntensityMmPerHr: 50.0,
    });

    assert.strictEqual(rtcResult.activeRulesCount, 1);
    assert.ok(rtcResult.timeSeries.length > 0);
    // Verify that the rule executed
    assert.ok(rtcResult.ruleExecutions.length > 0);
    const exec = rtcResult.ruleExecutions[0]!;
    assert.strictEqual(exec.ruleId, "RULE_THROTTLE_CSO");
    assert.strictEqual(exec.linkId, "C_CSO");
    assert.strictEqual(exec.appliedSetting, 0.25);
  });

  it("computes exponential pollutant buildup and washoff kinetics (TSS, BOD, TN, TP)", () => {
    const deck = parseSwmm(SAMPLE_SWMM_DECK);

    const runoffMap = new Map<string, number>();
    runoffMap.set("SUB1", 1250.0); // 1250 m^3 runoff

    const qualityResult = computeSwmmWaterQuality(deck, runoffMap, 7.0);

    assert.ok(qualityResult.subcatchments.has("SUB1"));
    const subQ = qualityResult.subcatchments.get("SUB1")!;
    assert.strictEqual(subQ.subcatchmentId, "SUB1");

    // Check exported masses (kg)
    const tssKg = subQ.pollutantMassesKg["TSS"]!;
    const bodKg = subQ.pollutantMassesKg["BOD"]!;
    const tnKg = subQ.pollutantMassesKg["TN"]!;
    const tpKg = subQ.pollutantMassesKg["TP"]!;

    assert.ok(tssKg > 0);
    assert.ok(bodKg > 0);
    assert.ok(tnKg > 0);
    assert.ok(tpKg > 0);
    assert.ok(tssKg > bodKg); // TSS mass typically dominates BOD

    // Check Event Mean Concentrations (mg/L)
    const tssEmc = subQ.eventMeanConcentrationsMgL["TSS"]!;
    assert.ok(tssEmc > 0);
    assert.strictEqual(qualityResult.dominantPollutant, "TSS");
  });
});
