// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_ENTERPRISE_FEATURES,
  generateLicenseKeyPair,
  REVOKED_LICENSE_JTIS,
  signEnterpriseLicense,
  verifyEnterpriseLicense,
} from "../src/license/verifier.js";

describe("Enterprise Ed25519 Offline License Verifier", () => {
  const { publicKeyPem, privateKeyPem } = generateLicenseKeyPair();
  const nowSec = Math.floor(Date.now() / 1000);

  it("signs and verifies a valid Ed25519 license token offline", () => {
    const token = signEnterpriseLicense(
      {
        sub: "acme-aero",
        org: "Acme Aerospace",
        tier: "appliance",
        seats: 25,
        features: ["airgap_compliance", "slurm_hpc"],
        exp: nowSec + 86400,
      },
      privateKeyPem,
    );

    const res = verifyEnterpriseLicense(token, { publicKeyPem, nowSeconds: nowSec });
    assert.equal(res.valid, true);
    assert.equal(res.mode, "licensed");
    assert.equal(res.claims?.sub, "acme-aero");
    assert.equal(res.claims?.seats, 25);
    assert.deepEqual(res.claims?.features, ["airgap_compliance", "slurm_hpc"]);
  });

  it("rejects tokens signed with a different Ed25519 keypair", () => {
    const other = generateLicenseKeyPair();
    const token = signEnterpriseLicense(
      {
        sub: "rogue",
        org: "Rogue Corp",
        tier: "cloud-enterprise",
        seats: 10,
        features: [...ALL_ENTERPRISE_FEATURES],
        exp: nowSec + 3600,
      },
      other.privateKeyPem,
    );

    const res = verifyEnterpriseLicense(token, { publicKeyPem, nowSeconds: nowSec });
    assert.equal(res.valid, false);
    assert.equal(res.mode, "invalid");
  });

  it("rejects tampered payloads", () => {
    const token = signEnterpriseLicense(
      {
        sub: "acme",
        org: "Acme",
        tier: "appliance",
        seats: 5,
        features: ["slurm_hpc"],
        exp: nowSec + 3600,
      },
      privateKeyPem,
    );

    const [, sig] = token.slice("msx_lic_".length).split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        v: 1,
        jti: "lic_forged",
        sub: "acme",
        org: "Acme",
        tier: "appliance",
        seats: 0,
        features: [...ALL_ENTERPRISE_FEATURES],
        iat: nowSec,
        exp: nowSec + 9999999,
      }),
    ).toString("base64url");

    const res = verifyEnterpriseLicense(`msx_lic_${forgedPayload}.${sig}`, { publicKeyPem, nowSeconds: nowSec });
    assert.equal(res.valid, false);
    assert.equal(res.mode, "invalid");
  });

  it("rejects expired licenses", () => {
    const token = signEnterpriseLicense(
      {
        sub: "expired-org",
        org: "Expired Org",
        tier: "appliance",
        seats: 5,
        features: ["airgap_compliance"],
        iat: nowSec - 7200,
        exp: nowSec - 60,
      },
      privateKeyPem,
    );

    const res = verifyEnterpriseLicense(token, { publicKeyPem, nowSeconds: nowSec });
    assert.equal(res.valid, false);
    assert.equal(res.mode, "expired");
  });

  it("rejects explicitly revoked license JTIs", () => {
    const revokedJti = Array.from(REVOKED_LICENSE_JTIS)[0];
    assert.ok(revokedJti, "Expected at least one revoked JTI in REVOKED_LICENSE_JTIS");

    const token = signEnterpriseLicense(
      {
        jti: revokedJti,
        sub: "revoked-org",
        org: "Revoked Org",
        tier: "appliance",
        seats: 1,
        features: ["slurm_hpc"],
        exp: nowSec + 86400,
      },
      privateKeyPem,
    );

    const res = verifyEnterpriseLicense(token, { publicKeyPem, nowSeconds: nowSec });
    assert.equal(res.valid, false);
    assert.equal(res.mode, "invalid");
    assert.match(res.reason ?? "", /revoked/i);
  });

  it("rejects malformed tokens missing the msx_lic_ prefix", () => {
    const res = verifyEnterpriseLicense("not-a-license-token", { publicKeyPem });
    assert.equal(res.valid, false);
    assert.equal(res.mode, "invalid");
  });
});
