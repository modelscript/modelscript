// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatEditorialDate, formatRelativeTime, formatTooltipDate, parseUtcDate } from "../src/util/date.js";

describe("Date & Relative Time Utilities", () => {
  describe("parseUtcDate", () => {
    it("safely handles null, undefined, and empty string", () => {
      assert.ok(Number.isNaN(parseUtcDate(null).getTime()));
      assert.ok(Number.isNaN(parseUtcDate(undefined).getTime()));
      assert.ok(Number.isNaN(parseUtcDate("").getTime()));
      assert.ok(Number.isNaN(parseUtcDate("   ").getTime()));
    });

    it("handles Date objects and numeric timestamps", () => {
      const now = new Date();
      assert.strictEqual(parseUtcDate(now).getTime(), now.getTime());

      const ms = 1730761234000;
      assert.strictEqual(parseUtcDate(ms).getTime(), ms);
    });

    it("parses SQLite UTC datetimes (YYYY-MM-DD HH:MM:SS) as UTC, not local time", () => {
      const parsed = parseUtcDate("2026-11-05 03:32:26");
      assert.strictEqual(parsed.toISOString(), "2026-11-05T03:32:26.000Z");
    });

    it("parses SQLite UTC datetimes with milliseconds as UTC", () => {
      const parsed = parseUtcDate("2026-11-05 03:32:26.456");
      assert.strictEqual(parsed.toISOString(), "2026-11-05T03:32:26.456Z");
    });

    it("parses ISO strings without timezone indicator as UTC", () => {
      const parsed = parseUtcDate("2026-11-05T03:32:26");
      assert.strictEqual(parsed.toISOString(), "2026-11-05T03:32:26.000Z");
    });

    it("preserves standard ISO strings with Z and offset", () => {
      const parsedZ = parseUtcDate("2026-11-05T03:32:26.000Z");
      assert.strictEqual(parsedZ.toISOString(), "2026-11-05T03:32:26.000Z");

      const parsedOffset = parseUtcDate("2026-11-05T03:32:26+02:00");
      assert.strictEqual(parsedOffset.toISOString(), "2026-11-05T01:32:26.000Z");
    });
  });

  describe("formatRelativeTime", () => {
    it("returns empty string for invalid inputs", () => {
      assert.strictEqual(formatRelativeTime(""), "");
      assert.strictEqual(formatRelativeTime(null), "");
      assert.strictEqual(formatRelativeTime("invalid-date"), "");
    });

    it("formats seconds accurately (1s to 59s)", () => {
      const now = Date.now();
      assert.strictEqual(formatRelativeTime(new Date(now).toISOString()), "1s");
      assert.strictEqual(formatRelativeTime(new Date(now - 1000).toISOString()), "1s");
      assert.strictEqual(formatRelativeTime(new Date(now - 25000).toISOString()), "25s");
      assert.strictEqual(formatRelativeTime(new Date(now - 59000).toISOString()), "59s");
    });

    it("handles slight future clock skew gracefully (returns 1s)", () => {
      const now = Date.now();
      assert.strictEqual(formatRelativeTime(new Date(now + 3000).toISOString()), "1s");
      assert.strictEqual(formatRelativeTime(new Date(now + 45000).toISOString()), "1s");
    });

    it("formats minutes accurately", () => {
      const now = Date.now();
      assert.strictEqual(formatRelativeTime(new Date(now - 60000).toISOString()), "1m");
      assert.strictEqual(formatRelativeTime(new Date(now - 1800000).toISOString()), "30m");
      assert.strictEqual(formatRelativeTime(new Date(now - 3540000).toISOString()), "59m");
    });

    it("formats hours accurately", () => {
      const now = Date.now();
      assert.strictEqual(formatRelativeTime(new Date(now - 3600000).toISOString()), "1h");
      assert.strictEqual(formatRelativeTime(new Date(now - 14400000).toISOString()), "4h");
      assert.strictEqual(formatRelativeTime(new Date(now - 82800000).toISOString()), "23h");
    });

    it("formats SQLite datetimes accurately instead of returning 1s", () => {
      // Simulate post created 30 minutes ago in UTC format 'YYYY-MM-DD HH:MM:SS'
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);

      const formatted = formatRelativeTime(thirtyMinutesAgo);
      assert.strictEqual(formatted, "30m");

      // Simulate post created 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);

      assert.strictEqual(formatRelativeTime(twoHoursAgo), "2h");
    });
  });

  describe("formatTooltipDate & formatEditorialDate", () => {
    it("formats tooltip date accurately", () => {
      const dateStr = "2026-11-05 03:32:26";
      const tooltip = formatTooltipDate(dateStr);
      assert.ok(tooltip.includes("2026"));
      assert.ok(tooltip.includes("·"));
    });

    it("formats editorial date accurately", () => {
      const dateStr = "2026-11-05 03:32:26";
      const editorial = formatEditorialDate(dateStr);
      assert.ok(editorial.includes("2026"));
      assert.ok(editorial.includes("Nov"));
    });
  });
});
