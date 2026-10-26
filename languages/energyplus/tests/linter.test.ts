// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { EnergyPlusErrorCode, lintEnergyPlus } from "../src/lints/index.js";
import { parseIdf } from "../src/parser/index.js";

describe("EnergyPlus Pre-Flight Diagnostic Linters (M7901–M7908)", () => {
  it("M7906: detects duplicate thermal zone names", () => {
    const idf = `
      Zone, LivingRoom, 0, 0, 0, 0, 1, 1, 3.0, 100.0;
      Zone, LivingRoom, 0, 5, 0, 0, 1, 1, 3.0, 100.0;
    `;
    const doc = parseIdf(idf);
    const diags = lintEnergyPlus(doc);

    assert(diags.some((d) => d.code === EnergyPlusErrorCode.DUPLICATE_ZONE_NAME.code));
    assert(diags.some((d) => d.message.includes("'LivingRoom'") && d.message.endsWith(".")));
  });

  it("M7908: detects zero or negative thickness material", () => {
    const idf = `
      Material, BadLayer, MediumRough, 0.0, 1.5, 2000, 800;
    `;
    const doc = parseIdf(idf);
    const diags = lintEnergyPlus(doc);

    assert(diags.some((d) => d.code === EnergyPlusErrorCode.ZERO_THICKNESS_MATERIAL.code));
  });

  it("M7903: detects non-positive physical properties (conductivity, density, cp)", () => {
    const idf = `
      Material, ZeroKMat, MediumRough, 0.1, 0.0, 2000, 800;
      Material, NegativeRhoMat, MediumRough, 0.1, 1.2, -100, 800;
    `;
    const doc = parseIdf(idf);
    const diags = lintEnergyPlus(doc);

    const m7903s = diags.filter((d) => d.code === EnergyPlusErrorCode.MISSING_THERMAL_PROPERTIES.code);
    assert.strictEqual(m7903s.length, 2);
  });

  it("M7905: warns on excessive solar absorptance (> 1.0)", () => {
    const idf = `
      Material, SuperBlack, MediumRough, 0.1, 1.0, 2000, 800, 0.9, 1.25, 0.9;
    `;
    const doc = parseIdf(idf);
    const diags = lintEnergyPlus(doc);

    assert(diags.some((d) => d.code === EnergyPlusErrorCode.EXCESSIVE_SURFACE_ABSORPTION.code));
  });

  it("M7907: detects unreferenced construction on surface", () => {
    const idf = `
      Zone, BedRoom, 0, 0, 0, 0, 1, 1, 3.0, 80.0;
      BuildingSurface:Detailed, Wall1, Wall, NonExistentConst, BedRoom, Outdoors, , SunExposed, WindExposed, 0.5, 4, 0,0,3, 0,0,0, 4,0,0, 4,0,3;
    `;
    const doc = parseIdf(idf);
    const diags = lintEnergyPlus(doc);

    assert(diags.some((d) => d.code === EnergyPlusErrorCode.UNREFERENCED_CONSTRUCTION.code));
  });

  it("M7901: detects unmatched interzone reciprocal surface", () => {
    const idf = `
      Zone, ZoneA, 0, 0, 0, 0, 1, 1, 3.0, 80.0;
      Zone, ZoneB, 0, 5, 0, 0, 1, 1, 3.0, 80.0;
      BuildingSurface:Detailed, PartitionAB, Wall, WallConst, ZoneA, Surface, MissingPartitionBA, NoSun, NoWind, 0.0, 4, 0,0,3, 0,0,0, 4,0,0, 4,0,3;
      Construction, WallConst, SomeMat;
      Material, SomeMat, Rough, 0.1, 1.0, 2000, 800;
    `;
    const doc = parseIdf(idf);
    const diags = lintEnergyPlus(doc);

    assert(diags.some((d) => d.code === EnergyPlusErrorCode.UNMATCHED_INTERZONE_SURFACE.code));
  });

  it("M7904: detects HVAC component referencing non-existent zone", () => {
    const idf = `
      Zone, RealZone, 0, 0, 0, 0, 1, 1, 3.0, 80.0;
      ZoneHVAC:IdealLoadsAirSystem, FakeHVAC, GhostZone;
    `;
    const doc = parseIdf(idf);
    const diags = lintEnergyPlus(doc);

    assert(diags.some((d) => d.code === EnergyPlusErrorCode.UNCONNECTED_HVAC_ZONE.code));
  });

  it("passes valid building model with 0 diagnostics", () => {
    const idf = `
      Building, GoodBldg, 0.0, Suburbs;
      Zone, GoodZone, 0, 0, 0, 0, 1, 1, 3.0, 90.0;
      Material, GoodMat, MediumRough, 0.2, 1.5, 2200, 850, 0.9, 0.7, 0.7;
      Construction, GoodConst, GoodMat;
      BuildingSurface:Detailed, GoodWall, Wall, GoodConst, GoodZone, Outdoors, , SunExposed, WindExposed, 0.5, 4, 0,0,3, 0,0,0, 5,0,0, 5,0,3;
      ZoneHVAC:IdealLoadsAirSystem, GoodHVAC, GoodZone;
    `;
    const doc = parseIdf(idf);
    const diags = lintEnergyPlus(doc);

    assert.strictEqual(diags.length, 0);
  });
});
