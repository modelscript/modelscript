// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ParameterInversionEngine, type SafeRegionGuard } from "../src/index.js";

describe("CAD Certified Safe Parameter Inversion Engine", () => {
  const sampleMcadSource = `
// Drone arm specification
const ARM_LENGTH = 120.0;
const WALL_THICKNESS = 3.0;
const MOTOR_MOUNT_RADIUS = 15.0;
`;

  it("should certify and apply valid parameter update within safe region", () => {
    const guard: SafeRegionGuard = {
      parameterBounds: {
        ARM_LENGTH: { min: 80.0, max: 200.0 },
        WALL_THICKNESS: { min: 2.0, max: 8.0 },
      },
      constraints: [
        {
          name: "BendingStiffness",
          description: "Arm length to wall thickness ratio must not exceed 60 to prevent buckling",
          evaluate: (params) => {
            const l = params.ARM_LENGTH ?? 120.0;
            const t = params.WALL_THICKNESS ?? 3.0;
            return l / t <= 60.0;
          },
        },
      ],
    };

    // Valid update: ARM_LENGTH = 140.0, WALL_THICKNESS = 4.0 => ratio 35 <= 60
    const result = ParameterInversionEngine.patchMcadSourceCertified(
      sampleMcadSource,
      { ARM_LENGTH: 140.0, WALL_THICKNESS: 4.0 },
      guard,
    );

    assert.strictEqual(result.isCertifiedSafe, true);
    assert.strictEqual(result.isSuccess, true);
    assert.strictEqual(result.violations.length, 0);
    assert.strictEqual(result.appliedUpdates.length, 2);
    assert(result.updatedSource.includes("const ARM_LENGTH = 140;"));
    assert(result.updatedSource.includes("const WALL_THICKNESS = 4;"));
    assert(result.summary.includes("SUCCESSFUL"));
  });

  it("should reject parameter update exceeding explicit parameter bounds", () => {
    const guard: SafeRegionGuard = {
      parameterBounds: {
        ARM_LENGTH: { min: 80.0, max: 200.0 },
      },
    };

    // Attempt to set ARM_LENGTH to 250.0 > max 200.0
    const result = ParameterInversionEngine.patchMcadSourceCertified(sampleMcadSource, { ARM_LENGTH: 250.0 }, guard);

    assert.strictEqual(result.isCertifiedSafe, false);
    assert.strictEqual(result.isSuccess, false);
    assert.strictEqual(result.violations.length, 1);
    assert(result.violations[0]!.includes("violates maximum allowable bound 200"));
    // Source code must remain completely untouched
    assert.strictEqual(result.updatedSource, sampleMcadSource);
    assert.strictEqual(result.appliedUpdates.length, 0);
  });

  it("should reject parameter update violating coupled physical buckling/stiffness constraint", () => {
    const guard: SafeRegionGuard = {
      constraints: [
        {
          name: "BucklingResistance",
          description: "Buckling limit: ARM_LENGTH / WALL_THICKNESS <= 40",
          evaluate: (params) => {
            const l = params.ARM_LENGTH ?? 120.0;
            const t = params.WALL_THICKNESS ?? 3.0;
            return l / t <= 40.0;
          },
        },
      ],
    };

    // Length 180, thickness 2 => ratio 90 > 40!
    const result = ParameterInversionEngine.patchMcadSourceCertified(
      sampleMcadSource,
      { ARM_LENGTH: 180.0, WALL_THICKNESS: 2.0 },
      guard,
    );

    assert.strictEqual(result.isCertifiedSafe, false);
    assert.strictEqual(result.isSuccess, false);
    assert.strictEqual(result.violations.length, 1);
    assert(result.violations[0]!.includes("Buckling limit"));
    assert.strictEqual(result.updatedSource, sampleMcadSource);
  });
});
