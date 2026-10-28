// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../../apps/api/src/app.js";
import { LibraryDatabase } from "../../apps/api/src/database.js";
import { OidcService as BridgeOidcService } from "../../apps/api/src/services/oidc.js";
import {
  ALL_ENTERPRISE_FEATURES,
  checkEnterpriseDesktopAirgapCompliance,
  ENTERPRISE_HIL_TARGETS,
  ENTERPRISE_PLM_CONNECTORS,
  generateLicenseKeyPair,
  isOfacSanctioned,
  OidcService,
  runLicenseCli,
  signComplianceAttestation,
  signEnterpriseLicense,
  verifyBlackboxFmuEntitlement,
  verifyComplianceAttestation,
  verifyEnterpriseCliCommand,
  verifyEnterpriseCollabSession,
  verifyEnterpriseLicense,
  verifyPrivateVisibilityEntitlement,
} from "../src/index.js";

describe("Enterprise Edition (ee/) Subsystems (Batches A–I) & CE/EE Isolation", () => {
  let tmpDir: string;
  let db: LibraryDatabase;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-ee-test-"));
    db = new LibraryDatabase(path.join(tmpDir, "ee-test.db"));
  });

  after(() => {
    delete process.env["MSX_EDITION"];
    delete process.env["MSX_LICENSE_ENFORCE"];
    delete process.env["MSX_LICENSE_KEY"];
    delete process.env["ENTERPRISE_APPLIANCE"];
    delete process.env["AIRGAP_ENFORCED"];
    try {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("1. signs and verifies offline Ed25519 enterprise license tokens and rejects tampering or expiry", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = signEnterpriseLicense({
      sub: "ercot-grid-ops",
      org: "ERCOT Transmission Planning",
      tier: "appliance",
      seats: 50,
      features: [...ALL_ENTERPRISE_FEATURES],
      exp: nowSec + 3600,
    });

    assert.ok(token.startsWith("msx_lic_"));
    const verified = verifyEnterpriseLicense(token);
    assert.equal(verified.valid, true);
    assert.equal(verified.mode, "licensed");
    assert.equal(verified.claims?.org, "ERCOT Transmission Planning");
    assert.equal(verified.claims?.tier, "appliance");
    assert.equal(verified.claims?.seats, 50);

    // Verify CLI verify subcommand returns 0 for valid token and 1 for tampered token
    assert.equal(runLicenseCli(["verify", token]), 0);
    const [prefixAndPayload, sig] = token.split(".");
    const tamperedToken = `${prefixAndPayload}A.${sig}`;
    const tamperedRes = verifyEnterpriseLicense(tamperedToken);
    assert.equal(tamperedRes.valid, false);
    assert.equal(tamperedRes.mode, "invalid");
    assert.equal(runLicenseCli(["verify", tamperedToken]), 1);

    // Verify with wrong public key
    const otherKeyPair = generateLicenseKeyPair();
    const wrongKeyRes = verifyEnterpriseLicense(token, { publicKeyPem: otherKeyPair.publicKeyPem });
    assert.equal(wrongKeyRes.valid, false);
    assert.equal(wrongKeyRes.mode, "invalid");

    // Expired license check
    const expiredToken = signEnterpriseLicense({
      sub: "expired-corp",
      org: "Expired Corp",
      tier: "commercial-sdk",
      seats: 10,
      features: ["airgap_compliance"],
      iat: nowSec - 7200,
      exp: nowSec - 60,
    });
    const expiredRes = verifyEnterpriseLicense(expiredToken);
    assert.equal(expiredRes.valid, false);
    assert.equal(expiredRes.mode, "expired");
  });

  it("2. enforces MSX_LICENSE_KEY and per-feature entitlements across Batches A–I", async () => {
    process.env["MSX_EDITION"] = "ee";
    process.env["ENTERPRISE_APPLIANCE"] = "true";
    process.env["AIRGAP_ENFORCED"] = "true";
    process.env["MSX_LICENSE_ENFORCE"] = "true";
    delete process.env["MSX_LICENSE_KEY"];

    const app = createApp({ database: db });

    // 2a. Unlicensed request must return 402 Payment Required across EE subsystems
    const unlicensedAirgap = await request(app).get("/api/v1/compliance/airgap");
    assert.equal(unlicensedAirgap.status, 402);

    const unlicensedOrgs = await request(app).get("/api/v1/organizations/my");
    assert.equal(unlicensedOrgs.status, 402);

    const unlicensedBilling = await request(app).get("/api/v1/billing/wallet");
    assert.equal(unlicensedBilling.status, 402);

    const unlicensedTwins = await request(app).get("/api/v1/twins");
    assert.equal(unlicensedTwins.status, 402);

    const unlicensedSysml = await request(app).get("/api/v1/sysml2/projects");
    assert.equal(unlicensedSysml.status, 402);

    const unlicensedThreads = await request(app).get("/api/v1/threads/graph");
    assert.equal(unlicensedThreads.status, 402);

    const unlicensedHil = await request(app).post("/api/v1/ee/hil/authorize").send({ target: "dspace" });
    assert.equal(unlicensedHil.status, 402);

    const unlicensedAdmin = await request(app).get("/api/v1/admin/stats");
    assert.equal(unlicensedAdmin.status, 402);

    const unlicensedWebhooks = await request(app).get("/api/v1/webhooks");
    assert.equal(unlicensedWebhooks.status, 402);

    const unlicensedDesktop = await request(app).get("/api/v1/ee/desktop/compliance");
    assert.equal(unlicensedDesktop.status, 402);

    const unlicensedCollab = await request(app).get("/api/v1/ee/collab/status");
    assert.equal(unlicensedCollab.status, 402);

    const unlicensedReviews = await request(app).get("/api/v1/repos/1/reviews");
    assert.equal(unlicensedReviews.status, 402);

    const unlicensedAasx = await request(app).get("/api/v1/libraries/Modelica/4.0.0/export/aasx");
    assert.equal(unlicensedAasx.status, 402);

    // 2b. Expired license key must return 403 Forbidden
    const nowSec = Math.floor(Date.now() / 1000);
    process.env["MSX_LICENSE_KEY"] = signEnterpriseLicense({
      sub: "utility-expired",
      org: "Expired Utility",
      tier: "appliance",
      seats: 25,
      features: [...ALL_ENTERPRISE_FEATURES],
      exp: nowSec - 10,
    });
    const expiredRes = await request(app).get("/api/v1/compliance/airgap");
    assert.equal(expiredRes.status, 403);
    assert.equal(expiredRes.body.code, "EE_LICENSE_EXPIRED");

    // 2c. Scoped license missing 'airgap_compliance', 'digital_twins', 'sso_rbac', or 'hil_codegen' returns 403 on those features
    process.env["MSX_LICENSE_KEY"] = signEnterpriseLicense({
      sub: "sdk-only-customer",
      org: "SDK Only Startup",
      tier: "commercial-sdk",
      seats: 5,
      features: ["mcp_sse_gateway"],
      exp: nowSec + 3600,
    });
    const missingFeatureRes = await request(app).get("/api/v1/compliance/airgap");
    assert.equal(missingFeatureRes.status, 403);
    assert.equal(missingFeatureRes.body.code, "EE_FEATURE_NOT_ENTITLED");

    const missingTwinsFeature = await request(app).get("/api/v1/twins");
    assert.equal(missingTwinsFeature.status, 403);
    assert.equal(missingTwinsFeature.body.requiredFeature, "digital_twins");

    const missingThreadFeature = await request(app).get("/api/v1/threads/graph");
    assert.equal(missingThreadFeature.status, 403);
    assert.equal(missingThreadFeature.body.requiredFeature, "digital_thread_governance");

    const missingHilFeature = await request(app).post("/api/v1/ee/hil/authorize").send({ target: "dspace" });
    assert.equal(missingHilFeature.status, 403);
    assert.equal(missingHilFeature.body.requiredFeature, "hil_codegen");

    const missingWebhooksFeature = await request(app).get("/api/v1/webhooks");
    assert.equal(missingWebhooksFeature.status, 403);
    assert.equal(missingWebhooksFeature.body.requiredFeature, "plm_connectors");

    const missingSparqlFeature = await request(app).get("/api/v1/libraries/sparql");
    assert.equal(missingSparqlFeature.status, 403);
    assert.equal(missingSparqlFeature.body.requiredFeature, "plm_connectors");

    const missingCollabFeature = await request(app).get("/api/v1/ee/collab/status");
    assert.equal(missingCollabFeature.status, 403);
    assert.equal(missingCollabFeature.body.requiredFeature, "saml_oidc_sso");

    const missingKparFeature = await request(app).get("/api/v1/libraries/Modelica/4.0.0/export/kpar");
    assert.equal(missingKparFeature.status, 403);
    assert.equal(missingKparFeature.body.requiredFeature, "sysml2_omg_api");

    // CLI, Desktop & Collab entitlement checks with scoped license missing hil_codegen / airgap_compliance / sso_rbac
    const autosarCliCheck = verifyEnterpriseCliCommand("autosar");
    assert.equal(autosarCliCheck.allowed, false);
    assert.equal(autosarCliCheck.requiredFeature, "hil_codegen");
    assert.equal(verifyBlackboxFmuEntitlement().allowed, false);
    assert.equal(checkEnterpriseDesktopAirgapCompliance().compliant, false);
    assert.equal(verifyEnterpriseCollabSession().allowed, false);
    assert.equal(verifyPrivateVisibilityEntitlement().allowed, false);

    // 2d. Full Appliance license key unlocks Batches A–I
    process.env["MSX_LICENSE_KEY"] = signEnterpriseLicense({
      sub: "pjm-interconnection",
      org: "PJM Interconnection",
      tier: "appliance",
      seats: 100,
      features: [...ALL_ENTERPRISE_FEATURES],
      exp: nowSec + 86400,
    });
    const validRes = await request(app).get("/api/v1/compliance/airgap");
    assert.equal(validRes.status, 200);
    assert.equal(validRes.body.edition, "ee");
    assert.equal(validRes.body.ceiiCompliant, true);
    assert.equal(validRes.body.licenseMode, "licensed");
    assert.equal(validRes.headers["x-airgap-enforced"], "true");
    assert.equal(validRes.headers["x-ceii-compliance"], "FERC-18-CFR-388.113");

    // Test Batch A: FDA 21 CFR Part 11 / NERC CIP Ed25519 Compliance Attestation endpoint
    const sampleDigest = crypto.createHash("sha256").update("drone-dhf-dossier-v1").digest("hex");
    const attestRes = await request(app).post("/api/v1/ee/compliance/attest").send({
      workspaceId: "drone-reachability",
      standard: "FDA-21-CFR-Part-11",
      artifactSha256: sampleDigest,
    });
    assert.equal(attestRes.status, 201);
    assert.ok(attestRes.body.bundleToken.startsWith("msx_att_"));
    assert.equal(attestRes.body.payload.organization, "PJM Interconnection");

    const verifyAttestRes = await request(app).post("/api/v1/ee/compliance/verify-attestation").send({
      bundleToken: attestRes.body.bundleToken,
    });
    assert.equal(verifyAttestRes.status, 200);
    assert.equal(verifyAttestRes.body.valid, true);
    assert.equal(verifyAttestRes.body.payload.artifactSha256, sampleDigest);

    // Test Batch G: HIL & PLM capability catalog and authorization
    const capRes = await request(app).get("/api/v1/ee/capabilities");
    assert.equal(capRes.status, 200);
    assert.equal(capRes.body.hilTargets.length, ENTERPRISE_HIL_TARGETS.length);
    assert.equal(capRes.body.plmConnectors.length, ENTERPRISE_PLM_CONNECTORS.length);

    const hilAuthRes = await request(app).post("/api/v1/ee/hil/authorize").send({ target: "dspace" });
    assert.equal(hilAuthRes.status, 200);
    assert.equal(hilAuthRes.body.authorized, true);
    assert.equal(hilAuthRes.body.target.id, "dspace");

    const plmAuthRes = await request(app).post("/api/v1/ee/plm/authorize").send({ connector: "oslc" });
    assert.equal(plmAuthRes.status, 200);
    assert.equal(plmAuthRes.body.authorized, true);
    assert.equal(plmAuthRes.body.connector.id, "oslc");

    // Test Batch H: Desktop Air-Gap Compliance & Black-Box Binary FMU Authorization
    const desktopCompRes = await request(app).get("/api/v1/ee/desktop/compliance");
    assert.equal(desktopCompRes.status, 200);
    assert.equal(desktopCompRes.body.compliant, true);
    assert.equal(desktopCompRes.body.edition, "ee");

    const blackboxAuthRes = await request(app)
      .post("/api/v1/ee/desktop/authorize-blackbox")
      .send({ filename: "TurbineController.fmu", executionMode: "native" });
    assert.equal(blackboxAuthRes.status, 200);
    assert.equal(blackboxAuthRes.body.authorized, true);
    assert.equal(blackboxAuthRes.body.filename, "TurbineController.fmu");

    // Test Batch I: Real-Time Co-Editing Status & Private Visibility
    const collabStatusRes = await request(app).get("/api/v1/ee/collab/status");
    assert.equal(collabStatusRes.status, 200);
    assert.equal(collabStatusRes.body.collabEnabled, true);
    assert.equal(collabStatusRes.body.maxConcurrentPeersPerRoom, 100);

    // CLI, Desktop & Collab entitlement checks with full license
    assert.equal(verifyEnterpriseCliCommand("autosar").allowed, true);
    assert.equal(verifyEnterpriseCliCommand("oslc").allowed, true);
    assert.equal(verifyEnterpriseCliCommand("simulate").allowed, true);
    assert.equal(verifyBlackboxFmuEntitlement().allowed, true);
    assert.equal(checkEnterpriseDesktopAirgapCompliance().compliant, true);
    assert.equal(verifyEnterpriseCollabSession().allowed, true);
    assert.equal(verifyPrivateVisibilityEntitlement().allowed, true);
  });

  it("3. signs and verifies standalone DHF compliance attestations, ITAR/EAR export controls, and OidcService in EE mode", () => {
    process.env["MSX_EDITION"] = "ee";
    const digest = crypto.createHash("sha256").update("ieee-2800-pscad-evidence").digest("hex");
    const signed = signComplianceAttestation({
      organization: "ERCOT Grid Compliance",
      standard: "IEEE-2800-2022",
      workspaceId: "pscad-microgrid",
      artifactSha256: digest,
    });
    const verified = verifyComplianceAttestation(signed.bundleToken);
    assert.equal(verified.valid, true);
    assert.equal(verified.payload?.standard, "IEEE-2800-2022");

    // Verify ITAR/EAR/OFAC export control lookup in ee/src/compliance/export-control.ts
    assert.equal(isOfacSanctioned("IR"), true);
    assert.equal(isOfacSanctioned("KP"), true);
    assert.equal(isOfacSanctioned("UA", "43"), true);
    assert.equal(isOfacSanctioned("US"), false);

    // Verify OidcService works in EE mode
    const oidc = new OidcService({
      issuerUrl: "https://sso.utility.internal",
      clientId: "msx-client",
      clientSecret: "msx-secret",
    });
    assert.equal(oidc.isConfigured(), true);

    const bridgeOidc = new BridgeOidcService({
      issuerUrl: "https://sso.utility.internal",
      clientId: "msx-client",
      clientSecret: "msx-secret",
    });
    assert.equal(bridgeOidc.isConfigured(), true);
  });

  it("4. isolates Community Edition (MSX_EDITION=ce) by returning 501 across Batches A–I while keeping AGPL routes active", async () => {
    process.env["MSX_EDITION"] = "ce";
    process.env["ENTERPRISE_APPLIANCE"] = "true";
    process.env["AIRGAP_ENFORCED"] = "true";
    delete process.env["MSX_LICENSE_ENFORCE"];
    delete process.env["MSX_LICENSE_KEY"];

    const ceApp = createApp({ database: db });

    // OIDC bridge reports unconfigured in CE mode
    const bridgeOidc = new BridgeOidcService({
      issuerUrl: "https://sso.utility.internal",
      clientId: "msx-client",
      clientSecret: "msx-secret",
    });
    assert.equal(bridgeOidc.isConfigured(), false);

    // Enterprise CLI commands, Desktop Black-Box FMU execution, and Collab/Private visibility are rejected in CE mode
    assert.equal(verifyEnterpriseCliCommand("autosar").allowed, false);
    assert.equal(verifyEnterpriseCliCommand("oslc").allowed, false);
    assert.equal(verifyEnterpriseCliCommand("simulink").allowed, false);
    assert.equal(verifyEnterpriseCliCommand("simulate").allowed, true);
    assert.equal(verifyBlackboxFmuEntitlement().allowed, false);
    assert.equal(checkEnterpriseDesktopAirgapCompliance().compliant, false);
    assert.equal(verifyEnterpriseCollabSession().allowed, false);
    assert.equal(verifyEnterpriseCollabSession().statusCode, 501);
    assert.equal(verifyPrivateVisibilityEntitlement().allowed, false);
    assert.equal(verifyPrivateVisibilityEntitlement().statusCode, 501);

    // Core AGPL health & legal routes remain 200 OK and do NOT inject EE appliance headers
    const healthRes = await request(ceApp).get("/health");
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.headers["x-airgap-enforced"], undefined);
    assert.equal(healthRes.headers["x-ceii-compliance"], undefined);

    // All EE batches (A–I) return 501 Not Implemented in CE mode
    for (const endpoint of [
      "/api/v1/ee/license/status",
      "/api/v1/ee/capabilities",
      "/api/v1/ee/desktop/compliance",
      "/api/v1/ee/collab/status",
      "/api/v1/compliance/airgap",
      "/api/v1/compliance/readiness",
      "/api/v1/organizations/my",
      "/api/v1/cloud/profiles",
      "/api/v1/billing/wallet",
      "/api/v1/cosim/sessions",
      "/api/v1/mqtt/participants",
      "/api/v1/twins",
      "/api/v1/instances",
      "/api/v1/historian/sessions",
      "/api/v1/sysml2/projects",
      "/api/v1/mcp/sse",
      "/api/v1/threads/graph",
      "/api/v1/admin/stats",
      "/api/v1/webhooks",
      "/api/v1/git/commits",
      "/api/v1/gitlab/status",
      "/api/v1/libraries/sparql",
      "/api/v1/repos/1/reviews",
      "/api/v1/libraries/Modelica/4.0.0/export/kpar",
      "/api/v1/libraries/Modelica/4.0.0/export/aasx",
    ]) {
      const res = await request(ceApp).get(endpoint);
      assert.equal(res.status, 501, `Expected 501 in CE mode for ${endpoint}, got ${res.status}`);
      assert.equal(res.body.edition, "ce");
      assert.equal(res.body.licenseSpdx, "AGPL-3.0-or-later");
    }
  });
});
