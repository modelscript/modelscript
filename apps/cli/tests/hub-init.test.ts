// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { generateEnvConfig } from "../src/commands/hub.js";

test("CLI Hub Initialization & Profiles", async (t) => {
  await t.test("generateEnvConfig emits correct standalone profile configuration", () => {
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

  await t.test("generateEnvConfig emits correct internal intranet profile configuration", () => {
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

  await t.test("generateEnvConfig emits correct federated profile configuration", () => {
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
});
