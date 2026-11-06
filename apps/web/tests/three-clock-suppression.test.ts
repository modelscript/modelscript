// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import * as THREE from "three";
import { setConsoleFunction } from "three";

test("THREE.Clock deprecation suppression", async (t) => {
  await t.test("suppresses Clock deprecation warning while preserving legitimate warnings", () => {
    const warnings: string[] = [];

    // Install suppression handler matching apps/web/src/main.tsx
    setConsoleFunction((type: string, message: unknown, ...params: unknown[]) => {
      if (
        type === "warn" &&
        typeof message === "string" &&
        (message.includes("Clock: This module has been deprecated") || message.includes("THREE.Clock"))
      ) {
        return;
      }
      warnings.push(String(message));
    });

    // Instantiating Clock should NOT trigger any warnings
    const clock = new THREE.Clock();
    assert.ok(clock);
    assert.strictEqual(warnings.length, 0, "THREE.Clock deprecation warning should be filtered");

    // Other THREE warnings must still pass through
    THREE.warn("TestWarning: legitimate warning");
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0]?.includes("TestWarning: legitimate warning"));
  });
});
