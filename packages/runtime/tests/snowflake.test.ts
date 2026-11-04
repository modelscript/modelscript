// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  FEB_26_2022_EPOCH,
  MODELSCRIPT_EPOCH,
  generateSnowflakeId,
  isSnowflakeId,
  normalizeWorkspaceTemplate,
  parseSnowflakeId,
} from "../src/util/snowflake.js";

describe("Snowflake IDs & Workspace Normalization", () => {
  describe("generateSnowflakeId", () => {
    it("generates 64-bit snowflake IDs with Feb 26, 2022 epoch", () => {
      assert.strictEqual(MODELSCRIPT_EPOCH, 1645833600000n);
      assert.strictEqual(FEB_26_2022_EPOCH, 1645833600000n);

      const id = generateSnowflakeId();
      assert.strictEqual(typeof id, "string");
      assert.match(id, /^\d{18,19}$/);
      assert.strictEqual(isSnowflakeId(id), true);

      // Verify that it is larger than JavaScript's Number.MAX_SAFE_INTEGER
      const big = BigInt(id);
      assert.ok(
        big > BigInt(Number.MAX_SAFE_INTEGER),
        `Generated snowflake ${id} should exceed Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER})`,
      );
    });

    it("generates monotonically increasing IDs", () => {
      const id1 = generateSnowflakeId();
      const id2 = generateSnowflakeId();
      const id3 = generateSnowflakeId();

      const b1 = BigInt(id1);
      const b2 = BigInt(id2);
      const b3 = BigInt(id3);

      assert.ok(b2 >= b1, `Expected ${b2} >= ${b1}`);
      assert.ok(b3 >= b2, `Expected ${b3} >= ${b2}`);
    });
  });

  describe("parseSnowflakeId", () => {
    it("correctly parses timestamp, workerId, and sequence using Feb 26, 2022 epoch", () => {
      const now = Date.now();
      const id = generateSnowflakeId(now, 7);
      const parsed = parseSnowflakeId(id);

      assert.strictEqual(parsed.workerId, 7);
      // Timestamp should match within a 5ms range
      assert.ok(Math.abs(parsed.timestamp - now) < 5, `Expected parsed timestamp ${parsed.timestamp} to match ${now}`);
      assert.ok(parsed.date instanceof Date);
      assert.ok(parsed.timestamp > Number(FEB_26_2022_EPOCH));
      assert.ok(parsed.date.getFullYear() >= 2026);
    });

    it("parses snowflake IDs when specifying a custom epoch", () => {
      const customEpoch = 1420070400000n; // 2015-01-01T00:00:00.000Z
      const targetTs = 1700000000000;
      const id = generateSnowflakeId(targetTs, 42, customEpoch);
      assert.strictEqual(isSnowflakeId(id), true);

      const parsed = parseSnowflakeId(id, customEpoch);
      assert.strictEqual(parsed.timestamp, targetTs);
      assert.strictEqual(parsed.workerId, 42);
      assert.strictEqual(parsed.sequence, 0);
      assert.strictEqual(parsed.date.getTime(), targetTs);
    });
  });

  describe("normalizeWorkspaceTemplate", () => {
    it("normalizes legacy artifact-<id> templates to pure workspace IDs", () => {
      const res1 = normalizeWorkspaceTemplate("artifact-53");
      assert.deepStrictEqual(res1, { isWorkspace: true, workspaceId: "53" });

      const res2 = normalizeWorkspaceTemplate("/artifact-2117825138435453369");
      assert.deepStrictEqual(res2, { isWorkspace: true, workspaceId: "2117825138435453369" });
    });

    it("normalizes pure numeric snowflake workspace IDs", () => {
      const res1 = normalizeWorkspaceTemplate("2117825138435453369");
      assert.deepStrictEqual(res1, { isWorkspace: true, workspaceId: "2117825138435453369" });

      const res2 = normalizeWorkspaceTemplate("53");
      assert.deepStrictEqual(res2, { isWorkspace: true, workspaceId: "53" });

      const res3 = normalizeWorkspaceTemplate("/2117825138435453369");
      assert.deepStrictEqual(res3, { isWorkspace: true, workspaceId: "2117825138435453369" });
    });

    it("normalizes scratch workspace template", () => {
      const res = normalizeWorkspaceTemplate("scratch");
      assert.deepStrictEqual(res, { isWorkspace: true, workspaceId: "scratch" });
    });

    it("recognizes standard catalog templates as non-workspace", () => {
      assert.deepStrictEqual(normalizeWorkspaceTemplate("rlc-circuit"), {
        isWorkspace: false,
        workspaceId: "rlc-circuit",
      });
      assert.deepStrictEqual(normalizeWorkspaceTemplate("bouncing-ball"), {
        isWorkspace: false,
        workspaceId: "bouncing-ball",
      });
      assert.deepStrictEqual(normalizeWorkspaceTemplate("sysml-satellite"), {
        isWorkspace: false,
        workspaceId: "sysml-satellite",
      });
    });
  });
});
