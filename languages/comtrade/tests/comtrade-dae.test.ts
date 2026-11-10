// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerComtradeToDae } from "../src/dae/comtrade-to-dae.js";
import type { ComtradeRecord } from "../src/types.js";

describe("COMTRADE Domain Lowering to Linear-Memory DAE Arena", () => {
  const threePhaseRecord: ComtradeRecord = {
    cfg: {
      stationName: "SUBSTATION_DAE",
      recDevId: "FAULT_RECORDER",
      revYear: 1999,
      totalChannels: 5,
      analogCount: 3,
      digitalCount: 2,
      analogs: [
        {
          index: 1,
          chId: "VA",
          phase: "A",
          ccbm: "",
          uu: "V",
          a: 1.0,
          b: 0.0,
          skew: 0,
          minVal: -32768,
          maxVal: 32767,
          primary: 1,
          secondary: 1,
          scaling: "P",
        },
        {
          index: 2,
          chId: "VB",
          phase: "B",
          ccbm: "",
          uu: "V",
          a: 1.0,
          b: 0.0,
          skew: 0,
          minVal: -32768,
          maxVal: 32767,
          primary: 1,
          secondary: 1,
          scaling: "P",
        },
        {
          index: 3,
          chId: "VC",
          phase: "C",
          ccbm: "",
          uu: "V",
          a: 1.0,
          b: 0.0,
          skew: 0,
          minVal: -32768,
          maxVal: 32767,
          primary: 1,
          secondary: 1,
          scaling: "P",
        },
      ],
      digitals: [
        {
          index: 1,
          chId: "50P_TRIP",
          phase: "",
          ccbm: "",
          normalState: 0,
        },
        {
          index: 2,
          chId: "50G_TRIP",
          phase: "",
          ccbm: "",
          normalState: 0,
        },
      ],
      nominalFrequency: 60,
      sampleRateCount: 1,
      sampleRates: [{ rate: 10000, lastSampleNumber: 5 }],
      startTime: "01/01/2026,00:00:00.000000",
      triggerTime: "01/01/2026,00:00:00.000100",
      fileType: "ASCII",
      timeMult: 1.0,
    },
    analogData: [
      [120.0, 110.0, 10.0, 5.0, 120.0],
      [-60.0, -55.0, -5.0, -2.5, -60.0],
      [-60.0, -55.0, -5.0, -2.5, -60.0],
    ],
    digitalData: [
      [0, 0, 1, 1, 0],
      [0, 0, 1, 1, 0],
    ],
    timestamps: [0, 0.0001, 0.0002, 0.0003, 0.0004],
  };

  it("should lower COMTRADE record to DAEBuilder with correct variable and equation allocations", () => {
    const dae = lowerComtradeToDae(threePhaseRecord);

    // Expected variables:
    // 1 time var ('time')
    // 3 analog channels ('VA', 'VB', 'VC')
    // 2 digital channels ('d_50P_TRIP', 'd_50G_TRIP')
    // Total = 6 variables
    assert.equal(dae.varCount, 6, "Expected 6 DAE variables for time, 3 analogs, and 2 digitals");

    // Expected equations:
    // 3 analog playback equations (interpolated waveform values)
    // 2 digital playback equations (discrete status values)
    // Total = 5 equations
    assert.equal(dae.eqCount, 5, "Expected 5 DAE equations for analog and digital channel playback");
  });

  it("should handle single channel records without crashing", () => {
    const singleChannelRecord: ComtradeRecord = {
      cfg: {
        stationName: "MINIMAL_SUB",
        recDevId: "SENSOR_1",
        revYear: 1999,
        totalChannels: 1,
        analogCount: 1,
        digitalCount: 0,
        analogs: [
          {
            index: 1,
            chId: "I_LOAD",
            phase: "",
            ccbm: "",
            uu: "A",
            a: 1.0,
            b: 0.0,
            skew: 0,
            minVal: -100,
            maxVal: 100,
            primary: 1,
            secondary: 1,
            scaling: "P",
          },
        ],
        digitals: [],
        nominalFrequency: 60,
        sampleRateCount: 1,
        sampleRates: [{ rate: 1000, lastSampleNumber: 2 }],
        startTime: "01/01/2026,00:00:00.000000",
        triggerTime: "01/01/2026,00:00:00.000000",
        fileType: "ASCII",
        timeMult: 1.0,
      },
      analogData: [[10.0, 15.0]],
      digitalData: [],
      timestamps: [0, 0.001],
    };

    const dae = lowerComtradeToDae(singleChannelRecord);
    assert.equal(dae.varCount, 2); // time + I_LOAD
    assert.equal(dae.eqCount, 1); // equation for I_LOAD
  });
});
