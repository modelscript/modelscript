// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { validateBody, validateObject, type ObjectSchema } from "../src/middleware/validate.js";
import { signHmacToken, verifyHmacToken } from "../src/util/hmac-token.js";
import { PeriodicWorker } from "../src/util/periodic-worker.js";

test("API Hardening & OpenAPI 3.1.0 Integration", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-hardening-openapi-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });

  t.after(() => {
    try {
      db.close();
    } catch {
      // Ignore close errors during cleanup
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("GET /api/v1/openapi.json returns OpenAPI 3.1.0 spec with required schemas and paths", async () => {
    const res = await request(app).get("/api/v1/openapi.json").expect(200);

    assert.match(res.headers["content-type"] ?? "", /application\/json/i);
    assert.strictEqual(res.body.openapi, "3.1.0");

    const schemas = res.body.components?.schemas as Record<string, unknown> | undefined;
    assert.ok(schemas && typeof schemas === "object", "components.schemas must be present");

    const requiredSchemas = ["ApiError", "LoginRequest", "OAuthExchangeRequest", "WalletResponse", "SimulateRequest"];
    for (const schemaName of requiredSchemas) {
      assert.ok(schemaName in schemas, `Expected components.schemas to include '${schemaName}'`);
    }

    const paths = res.body.paths as Record<string, unknown> | undefined;
    assert.ok(paths && typeof paths === "object", "paths must be present");

    const requiredPaths = [
      "/api/v1/auth/login",
      "/api/v1/auth/oauth/exchange",
      "/api/v1/billing/wallet",
      "/api/v1/spaces",
    ];
    for (const routePath of requiredPaths) {
      assert.ok(routePath in paths, `Expected paths to include '${routePath}'`);
    }
  });

  await t.test("POST /api/v1/auth/oauth/exchange rejects missing or unknown exchange codes", async () => {
    const missingRes = await request(app).post("/api/v1/auth/oauth/exchange").send({});
    assert.ok(
      missingRes.status === 400 || missingRes.status === 401,
      `Expected 400 or 401 for missing code, got ${missingRes.status}`,
    );
    assert.match(missingRes.headers["content-type"] ?? "", /application\/json/i);
    assert.strictEqual(typeof missingRes.body.error, "string");

    const blankRes = await request(app).post("/api/v1/auth/oauth/exchange").send({ code: "   " });
    assert.ok(
      blankRes.status === 400 || blankRes.status === 401,
      `Expected 400 or 401 for blank code, got ${blankRes.status}`,
    );
    assert.match(blankRes.headers["content-type"] ?? "", /application\/json/i);
    assert.strictEqual(typeof blankRes.body.error, "string");

    const unknownRes = await request(app)
      .post("/api/v1/auth/oauth/exchange")
      .send({ code: "unknown-exchange-code-000000" });
    assert.ok(
      unknownRes.status === 400 || unknownRes.status === 401,
      `Expected 400 or 401 for unknown code, got ${unknownRes.status}`,
    );
    assert.match(unknownRes.headers["content-type"] ?? "", /application\/json/i);
    assert.strictEqual(typeof unknownRes.body.error, "string");
  });

  await t.test("Unmatched /api/v1/does-not-exist returns JSON 404 rather than HTML", async () => {
    const res = await request(app)
      .get("/api/v1/does-not-exist")
      .set("Accept", "text/html,application/json")
      .expect(404);

    assert.match(res.headers["content-type"] ?? "", /application\/json/i);
    assert.ok(!res.text.trimStart().startsWith("<"), "Response body must not be HTML");
    assert.strictEqual(typeof res.body.error, "string");
    assert.match(res.body.error, /not found/i);
  });

  await t.test("Express 5 JSON error handler returns JSON 400 on malformed JSON body", async () => {
    const res = await request(app)
      .post("/api/v1/auth/oauth/exchange")
      .set("Content-Type", "application/json")
      .send('{"code": invalid-json}')
      .expect(400);

    assert.match(res.headers["content-type"] ?? "", /application\/json/i);
    assert.strictEqual(typeof res.body.error, "string");
  });
});

test("validateObject() & validateBody() schema validation", async (t) => {
  const sampleSchema: ObjectSchema = {
    type: "object",
    required: ["name", "count", "mode"],
    properties: {
      name: { type: "string", minLength: 2, maxLength: 32 },
      count: { type: "number", min: 1, max: 100 },
      mode: { type: "string", enum: ["fast", "accurate", "adaptive"] },
      enabled: { type: "boolean" },
    },
  };

  await t.test("validateObject() passes valid payloads and reports structured issues", () => {
    const validIssues = validateObject({ name: "RLC", count: 10, mode: "fast", enabled: true }, sampleSchema);
    assert.deepStrictEqual(validIssues, []);

    const missingIssues = validateObject({ name: "RLC" }, sampleSchema);
    assert.strictEqual(missingIssues.length, 2);
    assert.deepStrictEqual(missingIssues.map((i) => i.field).sort(), ["count", "mode"]);

    const wrongTypeIssues = validateObject({ name: 123, count: "ten", mode: "fast", enabled: "yes" }, sampleSchema);
    assert.strictEqual(wrongTypeIssues.length, 3);
    assert.deepStrictEqual(wrongTypeIssues.map((i) => i.field).sort(), ["count", "enabled", "name"]);

    const lowRangeIssues = validateObject({ name: "RLC", count: 0, mode: "fast" }, sampleSchema);
    assert.strictEqual(lowRangeIssues.length, 1);
    assert.strictEqual(lowRangeIssues[0]?.field, "count");

    const highRangeIssues = validateObject({ name: "RLC", count: 101, mode: "fast" }, sampleSchema);
    assert.strictEqual(highRangeIssues.length, 1);
    assert.strictEqual(highRangeIssues[0]?.field, "count");

    const invalidEnumIssues = validateObject({ name: "RLC", count: 5, mode: "turbo" }, sampleSchema);
    assert.strictEqual(invalidEnumIssues.length, 1);
    assert.strictEqual(invalidEnumIssues[0]?.field, "mode");
  });

  await t.test(
    "validateBody() middleware passes valid payloads and rejects invalid ones with 400 { error, details }",
    async () => {
      const app = express();
      app.use(express.json());
      app.post("/validate-test", validateBody(sampleSchema), (req, res) => {
        res.status(200).json({ ok: true, body: req.body });
      });

      // Valid payload passes
      const okRes = await request(app)
        .post("/validate-test")
        .send({ name: "Pendulum", count: 25, mode: "adaptive", enabled: false })
        .expect(200);
      assert.strictEqual(okRes.body.ok, true);

      // Missing required fields
      const missingRes = await request(app).post("/validate-test").send({ name: "Pendulum" }).expect(400);
      assert.strictEqual(typeof missingRes.body.error, "string");
      assert.ok(Array.isArray(missingRes.body.details));
      assert.ok(missingRes.body.details.length >= 2);

      // Wrong types
      const wrongTypeRes = await request(app)
        .post("/validate-test")
        .send({ name: true, count: "50", mode: "fast" })
        .expect(400);
      assert.strictEqual(typeof wrongTypeRes.body.error, "string");
      assert.ok(Array.isArray(wrongTypeRes.body.details));
      assert.ok(wrongTypeRes.body.details.some((d: { field: string }) => d.field === "name"));
      assert.ok(wrongTypeRes.body.details.some((d: { field: string }) => d.field === "count"));

      // Out-of-range number
      const outOfRangeRes = await request(app)
        .post("/validate-test")
        .send({ name: "Pendulum", count: 500, mode: "fast" })
        .expect(400);
      assert.strictEqual(typeof outOfRangeRes.body.error, "string");
      assert.ok(Array.isArray(outOfRangeRes.body.details));
      assert.strictEqual(outOfRangeRes.body.details[0]?.field, "count");

      // Invalid enum
      const invalidEnumRes = await request(app)
        .post("/validate-test")
        .send({ name: "Pendulum", count: 10, mode: "invalid-mode" })
        .expect(400);
      assert.strictEqual(typeof invalidEnumRes.body.error, "string");
      assert.ok(Array.isArray(invalidEnumRes.body.details));
      assert.strictEqual(invalidEnumRes.body.details[0]?.field, "mode");
    },
  );
});

test("signHmacToken / verifyHmacToken", async (t) => {
  const secret = "test-hmac-secret-key-2026";

  await t.test("round-trips valid payloads", () => {
    const token = signHmacToken({ userId: 42, role: "engineer" }, secret, 60_000);
    const result = verifyHmacToken<{ userId: number; role: string }>(token, secret);

    assert.strictEqual(result.valid, true);
    if (result.valid) {
      assert.strictEqual(result.payload.userId, 42);
      assert.strictEqual(result.payload.role, "engineer");
      assert.strictEqual(typeof result.payload.expiresAt, "number");
      assert.ok(result.payload.expiresAt > Date.now());
    }
  });

  await t.test("rejects tampered signatures and wrong secrets", () => {
    const token = signHmacToken({ userId: 7 }, secret, 60_000);
    const [payloadB64, sig] = token.split(".");
    assert.ok(payloadB64 && sig);

    const flippedChar = sig[0] === "A" ? "B" : "A";
    const tamperedSigToken = `${payloadB64}.${flippedChar}${sig.slice(1)}`;
    const tamperedResult = verifyHmacToken(tamperedSigToken, secret);
    assert.strictEqual(tamperedResult.valid, false);
    if (!tamperedResult.valid) {
      assert.strictEqual(tamperedResult.code, "invalid_signature");
    }

    const wrongSecretResult = verifyHmacToken(token, "wrong-secret");
    assert.strictEqual(wrongSecretResult.valid, false);
    if (!wrongSecretResult.valid) {
      assert.strictEqual(wrongSecretResult.code, "invalid_signature");
    }

    const malformedResult = verifyHmacToken("not-a-valid-token", secret);
    assert.strictEqual(malformedResult.valid, false);
    if (!malformedResult.valid) {
      assert.strictEqual(malformedResult.code, "malformed");
    }
  });

  await t.test("rejects expired tokens", () => {
    const expiredToken = signHmacToken({ userId: 99 }, secret, -1_000);
    const result = verifyHmacToken<{ userId: number }>(expiredToken, secret);

    assert.strictEqual(result.valid, false);
    if (!result.valid) {
      assert.strictEqual(result.code, "expired");
    }
  });
});

test("PeriodicWorker lifecycle, skip predicate, and re-entrancy protection", async (t) => {
  await t.test("skips ticks when shouldSkip() returns true", async () => {
    let skip = true;
    let runs = 0;

    const worker = new PeriodicWorker({
      name: "test-skip-worker",
      intervalMs: 1_000,
      shouldSkip: () => skip,
      task: () => {
        runs += 1;
      },
    });

    await worker.tick();
    assert.strictEqual(runs, 0, "Tick should be skipped when shouldSkip() is true");

    skip = false;
    await worker.tick();
    assert.strictEqual(runs, 1, "Tick should run when shouldSkip() is false");
  });

  await t.test("prevents re-entrant overlapping execution", async () => {
    let activeCount = 0;
    let maxConcurrent = 0;
    let completedRuns = 0;
    let releaseFirstRun: (() => void) | undefined;

    const firstRunGate = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });

    const worker = new PeriodicWorker({
      name: "test-reentrancy-worker",
      intervalMs: 1_000,
      task: async () => {
        activeCount += 1;
        maxConcurrent = Math.max(maxConcurrent, activeCount);
        if (completedRuns === 0) {
          await firstRunGate;
        }
        completedRuns += 1;
        activeCount -= 1;
      },
    });

    const firstTick = worker.tick();
    // Overlapping ticks while first is still running must be ignored
    const overlappingTick1 = worker.tick();
    const overlappingTick2 = worker.tick();
    await Promise.all([overlappingTick1, overlappingTick2]);

    assert.strictEqual(activeCount, 1);
    assert.strictEqual(maxConcurrent, 1);

    releaseFirstRun?.();
    await firstTick;

    assert.strictEqual(completedRuns, 1);
    assert.strictEqual(activeCount, 0);

    // Subsequent tick after completion should run normally
    await worker.tick();
    assert.strictEqual(completedRuns, 2);
  });

  await t.test("stops cleanly on stop()", async () => {
    let runs = 0;
    const worker = new PeriodicWorker({
      name: "test-stop-worker",
      intervalMs: 15,
      task: () => {
        runs += 1;
      },
    });

    assert.strictEqual(worker.isActive, false);
    worker.start();
    assert.strictEqual(worker.isActive, true);

    await new Promise((resolve) => setTimeout(resolve, 45));
    worker.stop();
    assert.strictEqual(worker.isActive, false);

    const runsAtStop = runs;
    assert.ok(runsAtStop >= 1, "Expected at least one tick before stop()");

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(runs, runsAtStop, "No ticks should execute after stop()");
  });
});
