// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  createConverterBridgeState,
  emitMmcValveKernelWGSL,
  MmcValveArmBank,
  stepConverterBridge,
  type ConverterBridgeConfig,
  type MmcValveKernelConfig,
} from "../src/solvers/emt/index.js";

console.log("=== Testing Phase 2: WebGPU-Accelerated Valve-Level MMC Formulation ===");

// Test 1: WGSL Shader Generation & 401-Level HVDC MMC Valve Bank Balancing
{
  console.log("Test 1: 400-Submodule/Arm (401-Level) HVDC MMC Valve Bank Capacitor Balancing & Foster Thermal");
  const kernelCfg: MmcValveKernelConfig = {
    numSubmodulesPerArm: 400,
    submoduleType: "half_bridge",
    submoduleCapacitanceF: 10e-3,
    armInductanceH: 0.04,
    armResistanceOhm: 0.15,
    nominalDcKv: 400.0,
    dtSec: 25e-6,
    deadTimeUs: 2.0,
  };

  const wgsl = emitMmcValveKernelWGSL(kernelCfg);
  assert.ok(wgsl.includes("@compute @workgroup_size(256)"), "WGSL shader must declare @workgroup_size(256)");
  assert.ok(wgsl.includes("wg_sort_v"), "WGSL shader must include wg_sort_v bitonic sort array");
  assert.ok(wgsl.includes("wg_v_th_ds"), "WGSL shader must include wg_v_th_ds parallel tree reduction");
  assert.ok(wgsl.includes("ds_add"), "WGSL shader must implement dual-float vec2<f32> Kahan/Knuth addition");

  // Instantiate a 400-SM/arm (2400 submodules total across 6 arms) MMC valve bank
  const bank = new MmcValveArmBank(kernelCfg);

  const omega = 2.0 * Math.PI * 50.0;
  let maxSpreadPct = 0.0;
  let maxTj = 40.0;
  let totalLossW = 0.0;

  // Simulate 400 steps (10 ms = half fundamental cycle) with sinusoidal arm currents and modulation
  for (let s = 0; s < 400; s++) {
    const t = s * kernelCfg.dtSec;
    const mA = 0.85 * Math.sin(omega * t);
    const nInsertUpperA = Math.round(0.5 * (1 - mA) * kernelCfg.numSubmodulesPerArm);
    const iUpperA = 450 * Math.sin(omega * t - 0.1) + 150;

    const out = bank.stepArm(0, nInsertUpperA, iUpperA, 200_000.0, false);
    const meanV = out.vCapSumVolts / kernelCfg.numSubmodulesPerArm;
    maxSpreadPct = ((out.vCapMaxVolts - out.vCapMinVolts) / Math.max(1.0, meanV)) * 100.0;
    maxTj = out.maxJunctionTempDegC;
    totalLossW = out.armPowerLossWatts;
  }

  console.log(
    `   Post-balancing within-arm spread: ${maxSpreadPct.toFixed(4)}%, Max Tj=${maxTj.toFixed(2)} degC, Arm Loss=${(totalLossW / 1e3).toFixed(2)} kW`,
  );

  // Verify sorting-based balancing maintains within-arm spread well below 1.0%
  assert.ok(maxSpreadPct < 1.0, `Expected within-arm capacitor voltage spread < 1.0%, got ${maxSpreadPct.toFixed(3)}%`);
  assert.ok(
    maxTj > 40.0 && maxTj < 150.0,
    `IGBT junction temperature must rise physically above 40 degC ambient, got ${maxTj}`,
  );
  assert.ok(totalLossW > 0, "Total valve arm loss must be positive");
}

// Test 2: Integration with ConverterBridgeConfig topology: "mmc_valve_gpu"
{
  console.log("Test 2: ConverterBridge 'mmc_valve_gpu' Integration & Dead-Time/Thermal Tracking");
  const cfg: ConverterBridgeConfig = {
    id: "HVDC_MMC_1",
    bus: "PCC",
    topology: "mmc_valve_gpu",
    ratedMva: 500.0,
    ratedAcKv: 220.0,
    nominalDcKv: 400.0,
    dcCapacitanceF: 5e-3,
    filterInductanceH: 0.04,
    filterResistanceOhm: 0.2,
    numSubmodulesPerArm: 100,
    submoduleType: "full_bridge",
    deadTimeUs: 2.5,
  };

  const dt = 50e-6;
  const state = createConverterBridgeState(cfg, [0, 1, 2], dt, 50.0);
  assert.ok(state.valveArmBank !== undefined, "valveArmBank should be initialized for mmc_valve_gpu");
  assert.ok(state.wgslShaderSource && state.wgslShaderSource.length > 500, "wgslShaderSource should be populated");

  const vPeak = (220e3 * Math.sqrt(2)) / Math.sqrt(3);
  const omega = 2 * Math.PI * 50.0;
  const vVec = new Float64Array(3);
  for (let s = 0; s < 100; s++) {
    const t = s * dt;
    vVec[0] = vPeak * Math.sin(omega * t);
    vVec[1] = vPeak * Math.sin(omega * t - (2 * Math.PI) / 3);
    vVec[2] = vPeak * Math.sin(omega * t + (2 * Math.PI) / 3);
    stepConverterBridge(state, vVec, t, dt);
  }

  assert.ok(state.submoduleWithinArmSpreadPct !== undefined && state.submoduleWithinArmSpreadPct < 1.0);
  assert.ok(state.maxJunctionTempDegC !== undefined && state.maxJunctionTempDegC >= 40.0);
  assert.ok(state.totalValveLossWatts !== undefined && state.totalValveLossWatts > 0);
  console.log(
    `   ConverterBridge mmc_valve_gpu: Vdc=${(state.vDcVolts / 1e3).toFixed(1)} kV, spread=${state.submoduleWithinArmSpreadPct?.toFixed(4)}%, Tj=${state.maxJunctionTempDegC?.toFixed(2)} degC, Loss=${((state.totalValveLossWatts ?? 0) / 1e3).toFixed(1)} kW`,
  );
}

console.log("=== All Phase 2 WebGPU MMC Valve Tests Passed! ===");
