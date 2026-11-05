// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeUtcTimestamp } from "../src/database.js";

describe("UTC Timestamp Normalization", () => {
  it("normalizes SQLite UTC datetime strings (YYYY-MM-DD HH:MM:SS) to ISO format with Z", () => {
    const raw = "2026-11-05 03:32:26";
    const normalized = normalizeUtcTimestamp(raw);
    assert.strictEqual(normalized, "2026-11-05T03:32:26Z");
  });

  it("normalizes SQLite UTC datetime strings with fractional seconds", () => {
    const raw = "2026-11-05 03:32:26.789";
    const normalized = normalizeUtcTimestamp(raw);
    assert.strictEqual(normalized, "2026-11-05T03:32:26.789Z");
  });

  it("normalizes ISO string missing Z to ISO format with Z", () => {
    const raw = "2026-11-05T03:32:26";
    const normalized = normalizeUtcTimestamp(raw);
    assert.strictEqual(normalized, "2026-11-05T03:32:26Z");
  });

  it("leaves standard ISO strings with Z untouched", () => {
    const raw = "2026-11-05T03:32:26.000Z";
    const normalized = normalizeUtcTimestamp(raw);
    assert.strictEqual(normalized, "2026-11-05T03:32:26.000Z");
  });

  it("handles Date objects and numbers", () => {
    const d = new Date("2026-11-05T03:32:26.000Z");
    assert.strictEqual(normalizeUtcTimestamp(d), "2026-11-05T03:32:26.000Z");
    assert.strictEqual(normalizeUtcTimestamp(d.getTime()), "2026-11-05T03:32:26.000Z");
  });
});
