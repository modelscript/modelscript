// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { lowerEnergyPlusToDae } from "../src/dae/index.js";
import { parseIdf } from "../src/parser/index.js";

const SAMPLE_BUILDING_IDF = `
Building, HouseModel, 0, Suburbs;
Zone, LivingArea, 0, 0, 0, 0, 1, 1, 3.0, 120.0;
Zone, SleepingArea, 0, 6, 0, 0, 1, 1, 3.0, 90.0;
Material, Brick, MediumRough, 0.15, 0.8, 1900, 840;
Construction, BrickWall, Brick;
BuildingSurface:Detailed, LivingWall, Wall, BrickWall, LivingArea, Outdoors, , SunExposed, WindExposed, 0.5, 4, 0,0,3, 0,0,0, 6,0,0, 6,0,3;
BuildingSurface:Detailed, SleepingWall, Wall, BrickWall, SleepingArea, Outdoors, , SunExposed, WindExposed, 0.5, 4, 6,0,3, 6,0,0, 11,0,0, 11,0,3;
ZoneHVAC:IdealLoadsAirSystem, LivingHVAC, LivingArea;
`;

export const energyplusBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "energyplus",
  referenceTool: "DOE EnergyPlus / 3R2C Multi-Zone Thermal DAE",
  defaultTolerance: 0,
  metricKind: "dae-parity",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const doc = parseIdf(SAMPLE_BUILDING_IDF);
    const arena = lowerEnergyPlusToDae(doc);
    const d1 = performance.now() - t0;

    return [
      {
        id: "energyplus-3r2c-dae",
        name: "Multi-Zone 3R2C Building Thermal Model to DAEBuilder",
        scale: "standard",
        referenceTool: "DOE EnergyPlus / 3R2C Multi-Zone Thermal DAE",
        metricKind: "dae-parity",
        threshold: 0,
        measuredError: arena.getVarCount() >= 8 && arena.getEqCount() >= 8 ? 0 : 1,
        passed: arena.getVarCount() >= 8 && arena.getEqCount() >= 8,
        durationMs: d1,
        details: `${arena.getVarCount()} vars, ${arena.getEqCount()} eqs`,
      },
    ];
  },
};
