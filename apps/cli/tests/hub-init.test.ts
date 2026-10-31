// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  generateEnvConfig,
  Hub,
  HubInit,
  HubStatus,
  runHubAccounts,
  runHubDomains,
  runHubPruneRemote,
  runHubRelay,
  runHubUpgrade,
} from "../src/commands/hub.js";

describe("CLI Hub Initialization & Profiles", () => {
  let origLog: typeof console.log;
  let origError: typeof console.error;
  let origWrite: typeof process.stdout.write;

  before(() => {
    origLog = console.log;
    origError = console.error;
    origWrite = process.stdout.write;
    console.log = () => {};
    console.error = () => {};
    (process.stdout as any).write = () => true;
  });

  after(() => {
    console.log = origLog;
    console.error = origError;
    process.stdout.write = origWrite;
  });
  it("generateEnvConfig emits correct standalone profile configuration", () => {
    const env = generateEnvConfig({
      profile: "standalone",
      port: 3000,
      domain: "localhost",
      adminUser: "admin",
      adminEmail: "admin@localhost",
      adminPass: "TestPass123!",
      jwtSecret: "test-secret-12345",
    });

    assert.ok(env.includes("PORT=3000"));
    assert.ok(env.includes("FEDERATION_MODE=disabled"));
    assert.ok(env.includes("EMAIL_DRIVER=console"));
    assert.ok(env.includes("ADMIN_INIT_USERNAME=admin"));
    assert.ok(env.includes("SEED_EXAMPLES=true"));
  });

  it("generateEnvConfig emits correct internal intranet profile configuration", () => {
    const env = generateEnvConfig({
      profile: "internal",
      port: 3000,
      domain: "modelscript.corp.internal",
      adminUser: "corp_admin",
      adminEmail: "admin@corp.internal",
      adminPass: "CorpSecret123!",
      jwtSecret: "corp-jwt-secret",
    });

    assert.ok(env.includes("FEDERATION_MODE=disabled"));
    assert.ok(env.includes("OIDC_ISSUER_URL="));
    assert.ok(env.includes("OIDC_ADMIN_GROUP=Engineering-Admins"));
    assert.ok(env.includes("PUBLIC_URL=http://modelscript.corp.internal:3000"));
  });

  it("generateEnvConfig emits correct federated profile configuration", () => {
    const env = generateEnvConfig({
      profile: "federated",
      port: 3000,
      domain: "hub.aerospace.com",
      adminUser: "hub_admin",
      adminEmail: "admin@aerospace.com",
      adminPass: "HubSecret123!",
      jwtSecret: "federated-jwt-secret",
    });

    assert.ok(env.includes("FEDERATION_MODE=mesh"));
    assert.ok(env.includes("PUBLIC_DOMAIN=hub.aerospace.com"));
    assert.ok(env.includes("PUBLIC_URL=https://hub.aerospace.com"));
    assert.ok(env.includes("TURNSTILE_SECRET_KEY="));
  });

  it("HubInit and HubStatus builders and Hub root builder", () => {
    const mockYargs: any = {
      option: () => mockYargs,
      positional: () => mockYargs,
      command: () => mockYargs,
      demandCommand: () => mockYargs,
    };
    (HubInit.builder as any)(mockYargs);
    (HubStatus.builder as any)(mockYargs);
    (Hub.builder as any)(mockYargs);
    (Hub.handler as any)({});
  });

  it("HubInit.handler creates configuration files for standalone, internal, federated", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-hub-test-"));
    try {
      // 1. Standalone profile
      const standaloneDir = path.join(tempDir, "standalone");
      fs.mkdirSync(standaloneDir);
      await (HubInit.handler as any)({
        profile: "standalone",
        dir: standaloneDir,
        port: 4000,
        yes: true,
      });
      const standaloneEnv = fs.readFileSync(path.join(standaloneDir, ".env"), "utf8");
      assert.ok(standaloneEnv.includes("PORT=4000"));
      assert.ok(standaloneEnv.includes("FEDERATION_MODE=disabled"));

      // Overwrite test
      await (HubInit.handler as any)({
        profile: "standalone",
        dir: standaloneDir,
        port: 4001,
        yes: true,
      });
      const overwrittenEnv = fs.readFileSync(path.join(standaloneDir, ".env"), "utf8");
      assert.ok(overwrittenEnv.includes("PORT=4001"));

      // 2. Internal profile
      const internalDir = path.join(tempDir, "internal");
      fs.mkdirSync(internalDir);
      await (HubInit.handler as any)({
        profile: "internal",
        dir: internalDir,
        port: 5000,
        domain: "internal.corp",
        adminUser: "lead_engineer",
        adminEmail: "lead@internal.corp",
        adminPass: "SuperSecret123",
        yes: true,
      });
      const internalEnv = fs.readFileSync(path.join(internalDir, ".env"), "utf8");
      assert.ok(internalEnv.includes("ADMIN_INIT_USERNAME=lead_engineer"));
      assert.ok(internalEnv.includes("ADMIN_INIT_PASSWORD=SuperSecret123"));
      assert.ok(internalEnv.includes("PUBLIC_URL=http://internal.corp:5000"));

      // 3. Federated profile
      const federatedDir = path.join(tempDir, "federated");
      fs.mkdirSync(federatedDir);
      await (HubInit.handler as any)({
        profile: "federated",
        dir: federatedDir,
        port: 18002,
        domain: "mesh.engineering.org",
        yes: true,
      });
      const fedEnv = fs.readFileSync(path.join(federatedDir, ".env"), "utf8");
      assert.ok(fedEnv.includes("FEDERATION_MODE=mesh"));
      assert.ok(fedEnv.includes("PUBLIC_DOMAIN=mesh.engineering.org"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("HubStatus.handler probes readiness and prints reports", async () => {
    const origFetch = globalThis.fetch;

    try {
      // Ready status
      globalThis.fetch = (async () => ({
        json: async () => ({
          status: "ready",
          environment: "production",
          timestamp: "2026-10-08T12:00:00Z",
          checks: {
            exportControls: { status: "passed", sanctionedCountriesCount: 0, sanctionedRegionsCount: 0 },
            services: {
              geolocation: { dbLoaded: true },
              mailer: { driver: "console" },
              database: { hasAdminUser: true },
            },
            secrets: {
              jwtSecretIsSecure: true,
              turnstileConfigured: false,
            },
          },
        }),
      })) as any;

      await (HubStatus.handler as any)({ url: "http://localhost:3000" });

      // Degraded status
      globalThis.fetch = (async () => ({
        json: async () => ({
          status: "degraded",
          environment: "staging",
          timestamp: "2026-10-08T12:05:00Z",
          checks: {
            exportControls: { status: "warn", sanctionedCountriesCount: 1, sanctionedRegionsCount: 1 },
            services: {
              geolocation: { dbLoaded: false },
              mailer: { driver: "smtp" },
              database: { hasAdminUser: false },
            },
            secrets: {
              jwtSecretIsSecure: false,
              turnstileConfigured: true,
            },
          },
        }),
      })) as any;

      await (HubStatus.handler as any)({ url: "http://localhost:3000/" });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("runHubUpgrade with dryRun orchestrates readiness check and compose command generation", async () => {
    const origFetch = globalThis.fetch;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-hub-upgrade-test-"));
    try {
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: "ready",
          ready: true,
          edition: "ce",
          instanceName: "Ansatz Test Hub",
          database: { pendingMigrations: 0 },
        }),
      })) as any;

      const result = await runHubUpgrade({
        url: "http://127.0.0.1:3000",
        tag: "v1.2.0",
        profile: "federated-lite",
        composeDir: tempDir,
        dryRun: true,
        token: "mock-admin-token",
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.rolledBack, false);
      assert.strictEqual(result.targetTag, "v1.2.0");
      assert.match(
        result.composeCommand,
        /docker compose -f docker-compose\.yml -f docker-compose\.prod\.yml --profile federated-lite pull/,
      );
    } finally {
      globalThis.fetch = origFetch;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("runHubDomains, runHubRelay, runHubPruneRemote, and runHubAccounts dispatch to API", async () => {
    const origFetch = globalThis.fetch;
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    try {
      globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
        calls.push({
          url,
          method: init?.method,
          body: init?.body ? JSON.parse(init.body) : undefined,
        });
        if (url.includes("/domains")) return { ok: true, json: async () => ({ success: true }) } as any;
        if (url.includes("/relays")) return { ok: true, json: async () => ({ relays: [] }) } as any;
        if (url.includes("/prune")) return { ok: true, json: async () => ({ success: true }) } as any;
        if (url.includes("/users")) return { ok: true, json: async () => ({ users: [] }) } as any;
        return { ok: true, json: async () => ({}) } as any;
      }) as any;

      const dom = await runHubDomains({
        action: "silence",
        domain: "test.org",
        url: "http://127.0.0.1:3000",
        token: "tok",
      });
      assert.strictEqual(dom["success"], true);

      const rel = await runHubRelay({
        action: "list",
        url: "http://127.0.0.1:3000",
        token: "tok",
      });
      assert.deepStrictEqual(rel["relays"], []);

      const prune = await runHubPruneRemote({
        days: 30,
        mediaDays: 7,
        accountDays: 60,
        url: "http://127.0.0.1:3000",
        token: "tok",
      });
      assert.strictEqual(prune["success"], true);

      const acct = await runHubAccounts({
        action: "list",
        username: "alice",
        url: "http://127.0.0.1:3000",
        token: "tok",
      });
      assert.deepStrictEqual(acct["users"], []);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
