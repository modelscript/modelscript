// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { LinePackEngine } from "../src/solver/line-pack/line-pack-engine.js";
import { SteadyNetworkSolver } from "../src/solver/steady/steady-network-solver.js";
import type { LpsModel } from "../types.js";

const TX_GAS_GRID: LpsModel = {
  id: "tx_gas_grid",
  title: "Texas Gas Transmission Grid",
  type: "TGNET",
  nodes: [
    { name: "Waha_Hub", type: "SUPPLY", elevation: 0, pressure: 70e5, flowRate: 80 },
    { name: "Midland_Compressor", type: "JUNCTION", elevation: 15 },
    { name: "Midland_Discharge", type: "JUNCTION", elevation: 15 },
    { name: "DFW_CityGate", type: "DELIVERY", elevation: 5, minDeliveryPressure: 35e5, flowRate: 80 },
  ],
  pipes: [
    {
      name: "Trunk_West",
      fromNode: "Waha_Hub",
      toNode: "Midland_Compressor",
      length: 120000,
      diameter: 0.762,
      roughness: 0.000045,
      maop: 90e5,
    },
    {
      name: "Trunk_East",
      fromNode: "Midland_Discharge",
      toNode: "DFW_CityGate",
      length: 180000,
      diameter: 0.762,
      roughness: 0.000045,
      maop: 90e5,
    },
  ],
  compressors: [
    {
      name: "Midland_Station",
      fromNode: "Midland_Compressor",
      toNode: "Midland_Discharge",
      type: "CENTRIFUGAL",
      maxPower: 25e6,
      maxPressureRatio: 1.8,
      polytropicEfficiency: 0.84,
      status: "RUNNING",
      controlMode: "DISCHARGE_PRESSURE",
      setpoint: 80e5,
    },
  ],
  pumps: [],
  regulators: [],
  valves: [],
  gasComposition: {
    methane: 0.92,
    ethane: 0.05,
    propane: 0.015,
    nButane: 0.005,
    iButane: 0.005,
    pentanes: 0.002,
    hexanePlus: 0.001,
    nitrogen: 0.002,
    carbonDioxide: 0.005,
    hydrogen: 0.02,
    grossHeatingValue: 39.0,
    standardDensity: 0.77,
  },
  simulationControls: { startTime: 0, endTime: 3600, timeStep: 10, steadyStateFirst: true, equationOfState: "AGA8" },
};

export const lpsBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "lps",
  referenceTool: "DNV Synergi Gas / AGA8 Steady Network",
  defaultTolerance: 1e-4,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const steady = SteadyNetworkSolver.solve(TX_GAS_GRID);
    const d1 = performance.now() - t0;
    const dischargeP = steady.nodeStates["Midland_Discharge"]?.pressure ?? 0;
    const dfwP = steady.nodeStates["DFW_CityGate"]?.pressure ?? 0;
    const setpointErr = Math.abs(dischargeP - 80e5) / 80e5;

    const t1 = performance.now();
    const pack = LinePackEngine.analyze(TX_GAS_GRID, steady);
    const d2 = performance.now() - t1;

    return [
      {
        id: "lps-tx-gas-steady-aga8",
        name: "Texas Gas Transmission Steady-State AGA8 Pressure Drop",
        scale: "standard",
        referenceTool: "DNV Synergi Gas / AGA8 Steady Network",
        metricKind: "max-relative-error",
        threshold: 1e-4,
        measuredError: setpointErr,
        passed: steady.converged && setpointErr < 1e-4 && dfwP < 80e5 && dfwP > 35e5,
        durationMs: d1,
        details: `P_disch=${(dischargeP / 1e5).toFixed(2)}bar, P_DFW=${(dfwP / 1e5).toFixed(2)}bar`,
      },
      {
        id: "lps-line-pack-inventory",
        name: "Transmission Line-Pack Energy & Hydrogen Blend Inventory",
        scale: "standard",
        referenceTool: "DNV Synergi Gas / AGA8 Steady Network",
        metricKind: "exact",
        threshold: 0,
        measuredError: Math.abs(pack.hydrogenVolumePercent - 2.0),
        passed: pack.totalEnergyStoredGWh > 10 && pack.deliverableLinePackSm3 > 0 && pack.hydrogenVolumePercent === 2.0,
        durationMs: d2,
        details: `E_pack=${pack.totalEnergyStoredGWh.toFixed(2)}GWh, H2=${pack.hydrogenVolumePercent}%`,
      },
    ];
  },
};
