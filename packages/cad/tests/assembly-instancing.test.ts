// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AssemblyClusteringEngine,
  InstanceBatchBuffer,
  composeTransformMatrixDirect,
  type InstancedPartDescriptor,
} from "../src/index.js";

describe("CAD Large-Assembly Instancing Engine", () => {
  describe("composeTransformMatrixDirect", () => {
    it("writes 4x4 identity matrix for default arguments", () => {
      const buf = new Float32Array(16);
      composeTransformMatrixDirect(buf, 0);

      // Identity matrix in column-major:
      // [ 1, 0, 0, 0,
      //   0, 1, 0, 0,
      //   0, 0, 1, 0,
      //   0, 0, 0, 1 ]
      const expected = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      for (let i = 0; i < 16; i++) {
        assert.ok(Math.abs(buf[i] - expected[i]) < 1e-5, `Mismatch at index ${i}: ${buf[i]} vs ${expected[i]}`);
      }
    });

    it("composes translation, scaling and rotation into column-major layout", () => {
      const buf = new Float32Array(32); // Offset test at 16
      const pos: [number, number, number] = [10, 20, 30];
      const scale: [number, number, number] = [2, 3, 4];
      // 90 deg rotation around Z
      const rot: [number, number, number] = [0, 0, 90];

      composeTransformMatrixDirect(buf, 16, pos, rot, scale);

      // In column-major:
      // Column 0 (X basis rotated 90 deg around Z and scaled by 2):
      // cos(90)*2 = 0, sin(90)*2 = 2, 0, 0
      assert.ok(Math.abs(buf[16 + 0] - 0) < 1e-4);
      assert.ok(Math.abs(buf[16 + 1] - 2) < 1e-4);
      assert.ok(Math.abs(buf[16 + 2] - 0) < 1e-4);
      assert.ok(Math.abs(buf[16 + 3] - 0) < 1e-4);

      // Column 1 (Y basis rotated 90 deg around Z and scaled by 3):
      // -sin(90)*3 = -3, cos(90)*3 = 0, 0, 0
      assert.ok(Math.abs(buf[16 + 4] - -3) < 1e-4);
      assert.ok(Math.abs(buf[16 + 5] - 0) < 1e-4);
      assert.ok(Math.abs(buf[16 + 6] - 0) < 1e-4);
      assert.ok(Math.abs(buf[16 + 7] - 0) < 1e-4);

      // Column 2 (Z basis scaled by 4):
      // 0, 0, 4, 0
      assert.ok(Math.abs(buf[16 + 8] - 0) < 1e-4);
      assert.ok(Math.abs(buf[16 + 9] - 0) < 1e-4);
      assert.ok(Math.abs(buf[16 + 10] - 4) < 1e-4);
      assert.ok(Math.abs(buf[16 + 11] - 0) < 1e-4);

      // Column 3 (Translation):
      // 10, 20, 30, 1
      assert.ok(Math.abs(buf[16 + 12] - 10) < 1e-4);
      assert.ok(Math.abs(buf[16 + 13] - 20) < 1e-4);
      assert.ok(Math.abs(buf[16 + 14] - 30) < 1e-4);
      assert.ok(Math.abs(buf[16 + 15] - 1) < 1e-4);
    });

    it("accepts direct quaternion [x, y, z, w]", () => {
      const buf = new Float32Array(16);
      // 180 deg around Y: quat = [0, 1, 0, 0]
      composeTransformMatrixDirect(buf, 0, [5, 5, 5], [0, 1, 0, 0], [1, 1, 1]);

      // X basis -> -X (buf[0] = -1)
      assert.ok(Math.abs(buf[0] - -1) < 1e-4);
      // Y basis -> Y (buf[5] = 1)
      assert.ok(Math.abs(buf[5] - 1) < 1e-4);
      // Z basis -> -Z (buf[10] = -1)
      assert.ok(Math.abs(buf[10] - -1) < 1e-4);
      // Position -> 5, 5, 5
      assert.ok(Math.abs(buf[12] - 5) < 1e-4);
      assert.ok(Math.abs(buf[13] - 5) < 1e-4);
      assert.ok(Math.abs(buf[14] - 5) < 1e-4);
    });
  });

  describe("InstanceBatchBuffer", () => {
    it("allocates contiguous matrix and color buffers and tracks dirty state", () => {
      const batch = new InstanceBatchBuffer(4);
      assert.equal(batch.count, 4);
      assert.equal(batch.matrixBuffer.length, 64);
      assert.equal(batch.colorBuffer.length, 12);
      assert.equal(batch.matrixNeedsUpdate, true);
      assert.equal(batch.colorNeedsUpdate, true);

      batch.markMatrixUpdated();
      batch.markColorUpdated();
      assert.equal(batch.matrixNeedsUpdate, false);
      assert.equal(batch.colorNeedsUpdate, false);

      batch.setInstanceTransform(2, [1, 2, 3], [0, 0, 0], [1, 1, 1]);
      assert.equal(batch.matrixNeedsUpdate, true);
      assert.equal(batch.colorNeedsUpdate, false);

      // Verify matrix at index 2
      const pos = batch.getInstancePosition(2);
      assert.equal(pos[0], 1);
      assert.equal(pos[1], 2);
      assert.equal(pos[2], 3);

      batch.setInstanceColor(2, 0.2, 0.5, 0.8);
      assert.equal(batch.colorNeedsUpdate, true);
      assert.ok(Math.abs(batch.colorBuffer[6] - 0.2) < 1e-5);
      assert.ok(Math.abs(batch.colorBuffer[7] - 0.5) < 1e-5);
      assert.ok(Math.abs(batch.colorBuffer[8] - 0.8) < 1e-5);
    });
  });

  describe("AssemblyClusteringEngine", () => {
    it("groups parts with identical geometry into instanced clusters", () => {
      const parts: InstancedPartDescriptor[] = [
        { name: "bolt_1", geometryKey: "M8_HexBolt_20mm", position: [0, 0, 0] },
        { name: "bolt_2", geometryKey: "M8_HexBolt_20mm", position: [10, 0, 0] },
        { name: "bolt_3", geometryKey: "M8_HexBolt_20mm", position: [20, 0, 0] },
        { name: "nut_1", geometryKey: "M8_Nut", position: [0, 0, 5] },
        { name: "nut_2", geometryKey: "M8_Nut", position: [10, 0, 5] },
        { name: "engine_block", geometryKey: "V8_Block", position: [0, 0, 0] }, // singleton
      ];

      const result = AssemblyClusteringEngine.cluster(parts, { minInstanceCount: 2 });

      assert.equal(result.totalParts, 6);
      assert.equal(result.clusters.length, 2);
      assert.equal(result.singletons.length, 1);
      assert.equal(result.singletons[0].name, "engine_block");

      // Verify bolt cluster
      const boltCluster = result.clusters.find((c) => c.geometryKey === "M8_HexBolt_20mm");
      assert.ok(boltCluster);
      assert.equal(boltCluster.count, 3);
      assert.deepEqual(boltCluster.instanceNames, ["bolt_1", "bolt_2", "bolt_3"]);
      assert.equal(boltCluster.batchBuffer.matrixBuffer.length, 3 * 16);

      // Verify nut cluster
      const nutCluster = result.clusters.find((c) => c.geometryKey === "M8_Nut");
      assert.ok(nutCluster);
      assert.equal(nutCluster.count, 2);
      assert.deepEqual(nutCluster.instanceNames, ["nut_1", "nut_2"]);
    });

    it("respects minInstanceCount option to leave low-cardinality parts unclustered", () => {
      const parts: InstancedPartDescriptor[] = [
        { name: "bracket_L", geometryKey: "Bracket_A", position: [0, 0, 0] },
        { name: "bracket_R", geometryKey: "Bracket_A", position: [10, 0, 0] },
        { name: "pin_1", geometryKey: "Pin", position: [0, 5, 0] },
      ];

      // minInstanceCount: 3 -> Bracket_A has 2 parts, so it stays as singletons
      const result = AssemblyClusteringEngine.cluster(parts, { minInstanceCount: 3 });
      assert.equal(result.clusters.length, 0);
      assert.equal(result.singletons.length, 3);
    });
  });
});
