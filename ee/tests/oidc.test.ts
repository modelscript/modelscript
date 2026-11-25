// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import { OidcService } from "../src/auth/oidc.js";

describe("Enterprise OidcService (RS256 Verification & Security Hardening)", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const ISSUER = "https://idp.example.com/v2.0";
  const CLIENT_ID = "msx-enterprise-client";

  function makeService(): OidcService {
    const svc = new OidcService({
      issuerUrl: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: "secret",
      adminGroup: "Engineering-Admins",
    });
    svc.registerStaticSigningKey("rsa-key-1", publicKey);
    return svc;
  }

  it("verifies a valid RS256 ID token signed with a registered public key", async () => {
    const svc = makeService();
    const token = jwt.sign(
      {
        sub: "sub-001",
        email: "Alice@Example.COM",
        name: "Alice",
        preferred_username: "alice",
        groups: ["Engineering-Admins"],
      },
      privateKey,
      { algorithm: "RS256", keyid: "rsa-key-1", issuer: ISSUER, audience: CLIENT_ID },
    );

    const claims = await svc.verifyIdToken(token);
    assert.equal(claims.sub, "sub-001");
    assert.equal(claims.email, "alice@example.com");
    assert.equal(claims.preferred_username, "alice");
    assert.deepEqual(claims.groups, ["Engineering-Admins"]);
  });

  it("rejects HS256 symmetric tokens even when NODE_ENV === 'test'", async () => {
    const prev = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "test";
    try {
      const svc = makeService();
      const hsToken = jwt.sign({ sub: "attacker", email: "attacker@example.com" }, "dummy-secret", {
        algorithm: "HS256",
        issuer: ISSUER,
        audience: CLIENT_ID,
      });

      await assert.rejects(() => svc.verifyIdToken(hsToken));
    } finally {
      process.env["NODE_ENV"] = prev;
    }
  });

  it("rejects unsigned alg=none tokens", async () => {
    const svc = makeService();
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "u1", email: "u1@example.com" })).toString("base64url");
    await assert.rejects(() => svc.verifyIdToken(`${header}.${payload}.`), /unsigned tokens/i);
  });

  it("rejects RS256 tokens with mismatched audience or issuer", async () => {
    const svc = makeService();
    const badAud = jwt.sign({ sub: "u2", email: "u2@example.com" }, privateKey, {
      algorithm: "RS256",
      keyid: "rsa-key-1",
      issuer: ISSUER,
      audience: "wrong-client",
    });
    await assert.rejects(() => svc.verifyIdToken(badAud), /jwt audience invalid/i);

    const badIss = jwt.sign({ sub: "u2", email: "u2@example.com" }, privateKey, {
      algorithm: "RS256",
      keyid: "rsa-key-1",
      issuer: "https://evil.example.com",
      audience: CLIENT_ID,
    });
    await assert.rejects(() => svc.verifyIdToken(badIss), /jwt issuer invalid/i);
  });

  it("rejects empty or non-string ID tokens", async () => {
    const svc = makeService();
    await assert.rejects(() => svc.verifyIdToken(""), /non-empty string/i);
  });
});
