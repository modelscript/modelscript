// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { generateEnvConfig, Hub, HubInit, HubStatus } from "../src/commands/hub.js";

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
});
