// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AssemblyBVH,
  LoDTier,
  computeProjectedScreenDiameter,
  generateBoxProxyMesh,
  selectLoDTier,
  type BVHItem,
  type FrustumPlane,
} from "../src/index.js";

describe("CAD Assembly BVH & Level of Detail", () => {
  describe("AssemblyBVH", () => {
    it("constructs a balanced AABB tree and roots total bounding volume", () => {
      const items: BVHItem[] = [
        {
          id: 0,
          aabb: { min: [0, 0, 0], max: [10, 10, 10] },
        },
        {
          id: 1,
          aabb: { min: [100, 0, 0], max: [110, 10, 10] },
        },
        {
          id: 2,
          aabb: { min: [0, 100, 0], max: [10, 110, 10] },
        },
        {
          id: 3,
          aabb: { min: [100, 100, 0], max: [110, 110, 10] },
        },
      ];

      const bvh = new AssemblyBVH(items, 2);
      const root = bvh.root;

      assert.ok(root !== null);
      assert.deepEqual(root.aabb.min, [0, 0, 0]);
      assert.deepEqual(root.aabb.max, [110, 110, 10]);
      assert.equal(bvh.totalItems, 4);
    });

    it("performs O(log N) raycast intersection and identifies nearest hit instance", () => {
      const items: BVHItem[] = [
        {
          id: 0, // front_cube
          aabb: { min: [0, 0, 10], max: [2, 2, 12] },
        },
        {
          id: 1, // back_cube
          aabb: { min: [0, 0, 50], max: [2, 2, 52] },
        },
        {
          id: 2, // off_axis_cube
          aabb: { min: [20, 20, 0], max: [25, 25, 5] },
        },
      ];

      const bvh = new AssemblyBVH(items);

      // Ray from (1, 1, 0) pointing along +Z towards front_cube and back_cube
      const hit = bvh.raycast([1, 1, 0], [0, 0, 1], 100);

      assert.ok(hit !== null);
      assert.equal(hit.id, 0);
      // Distance from z=0 to z=10 is 10
      assert.ok(Math.abs(hit.distance - 10) < 1e-4);
      assert.deepEqual(hit.point, [1, 1, 10]);

      // Ray pointing in opposite direction should miss
      const miss = bvh.raycast([1, 1, 0], [0, 0, -1], 100);
      assert.equal(miss, null);
    });

    it("culls instances outside camera frustum planes", () => {
      const items: BVHItem[] = [
        {
          id: 0, // inside part
          aabb: { min: [5, 5, -10], max: [6, 6, -9] },
        },
        {
          id: 1, // behind camera part
          aabb: { min: [5, 5, 10], max: [6, 6, 11] },
        },
      ];

      const bvh = new AssemblyBVH(items);

      // Frustum near plane: z <= 0 is in front (normal pointing into frustum: [0, 0, -1], distance = 0)
      // px for normal [0, 0, -1]: since normal[2] is -1 < 0, px picks min[2].
      // For inside part: min[2] = -10. px * normal[2] = (-10) * (-1) = 10 >= 0 -> visible.
      // For behind part: min[2] = 10. px * normal[2] = 10 * (-1) = -10 < 0 -> culled.
      const nearPlane: FrustumPlane = {
        normal: [0, 0, -1],
        distance: 0,
      };

      const visible = bvh.queryFrustum([nearPlane]);
      assert.equal(visible.length, 1);
      assert.equal(visible[0], 0);
    });
  });

  describe("Dynamic Level of Detail (LoD)", () => {
    it("estimates screen-space pixel diameter accurately", () => {
      const config = {
        distance: 100,
        fovDegrees: 60,
        viewportHeightPx: 1080,
      };

      // Part of radius 5 at distance 100
      const pixelDiameter = computeProjectedScreenDiameter(5, config);
      // tan(30 deg) ~= 0.57735
      // 1080 / (100 * 0.57735) ~= 18.7 pixels per unit radius
      // 5 * 18.7 ~= 93.5 pixels
      assert.ok(pixelDiameter > 80 && pixelDiameter < 110, `Got diameter ${pixelDiameter}`);
    });

    it("classifies objects into appropriate LoD tiers based on distance & size", () => {
      const config = {
        distance: 100,
        fovDegrees: 60,
        viewportHeightPx: 1080,
      };

      // Near large object: ~93px (> 80px) -> Tier Full
      const bigNearBox = { min: [-5, -5, -5] as [number, number, number], max: [5, 5, 5] as [number, number, number] };
      assert.equal(selectLoDTier(bigNearBox, config), LoDTier.Full);

      // Tiny far object: radius 0.05 at distance 100 -> ~0.9px (< 2px) -> Tier Culled
      const tinyFarBox = {
        min: [-0.05, -0.05, -0.05] as [number, number, number],
        max: [0.05, 0.05, 0.05] as [number, number, number],
      };
      assert.equal(selectLoDTier(tinyFarBox, config), LoDTier.Culled);
    });

    it("generates lightweight box proxy mesh for Tier 2", () => {
      const aabb = { min: [0, 0, 0] as [number, number, number], max: [10, 20, 30] as [number, number, number] };
      const proxy = generateBoxProxyMesh(aabb);

      // 8 vertices * 3 coords = 24 floats
      assert.equal(proxy.vertices.length, 24);
      // 12 triangles * 3 indices = 36 indices
      assert.equal(proxy.indices.length, 36);
    });
  });
});
